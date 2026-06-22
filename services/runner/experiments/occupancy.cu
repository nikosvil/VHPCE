/* VHPCE GPU experiments for the flagship — one program, five lessons (dispatch on argv[1]):
 *   occupancy   : register pressure caps warps/SM (light vs heavy). argv[2] = light|heavy.
 *   coalesce    : strided global access wastes memory bandwidth (stride sweep 1..32).
 *   divergence  : divergent branches within a warp serialize execution (paths sweep 1..32).
 *   atomics     : global-atomic contention — many threads hammering few counters serialize;
 *                 spreading the updates across more targets recovers throughput (targets 1..4096).
 *   sharedmem   : shared-memory bank conflicts — stride-way access patterns collide on banks;
 *                 padding the shared array ([32][33] vs [32][32]) eliminates conflicts.
 *                 argv[2] = padded|unpadded.
 *
 * Each emits one JSON object on stdout matching the RunnerData seam:
 *   {"exp":..,"variant":..,"points":[{"p":<x>,"ms":..[,"occ"|"gbps"|...]}], "sm":..,"cc":..}
 *
 * Build: nvcc -O2 -arch=sm_120 occupancy.cu -o occupancy   (PTX-JIT fallback: compute_90)
 * Run:   occupancy <occupancy|coalesce|divergence|atomics|sharedmem> [variant]
 */
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cuda_runtime.h>

#define REPS 3
#define ITERS 1024      /* occupancy: arithmetic iterations per thread (compute-bound) */
#define ACC 96          /* occupancy heavy kernel: live accumulators -> high register pressure */

static const int BLOCK_SIZES[] = {32, 64, 96, 128, 160, 192, 256, 320, 384, 512, 640, 768, 896, 1024};
static const int NBS = (int)(sizeof(BLOCK_SIZES) / sizeof(BLOCK_SIZES[0]));
static const int SWEEP6[] = {1, 2, 4, 8, 16, 32};

/* ----- occupancy kernels ----- */
__global__ void k_light(const float *in, float *out, int n, int iters) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    float a = in[i];
    for (int k = 0; k < iters; k++) a = a * 0.9999998f + 1.0e-6f;
    out[i] = a;
}
__global__ void k_heavy(const float *in, float *out, int n, int iters) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    float x = in[i];
    float a[ACC];
    #pragma unroll
    for (int j = 0; j < ACC; j++) a[j] = x + 0.01f * (float)j;
    for (int k = 0; k < iters; k++) {
        #pragma unroll
        for (int j = 0; j < ACC; j++) a[j] = a[j] * 0.9999998f + a[(j + 1) % ACC] * 1.0e-3f;
    }
    float s = 0.0f;
    #pragma unroll
    for (int j = 0; j < ACC; j++) s += a[j];
    out[i] = s;
}

/* ----- coalescing kernel: thread t reads in[t*stride + r]. stride 1 = coalesced (adjacent
 *       threads hit adjacent addresses); larger stride scatters reads across cache lines,
 *       wasting bandwidth -> the useful GB/s drops. ----- */
__global__ void k_stride(const float *in, float *out, int n, int stride, int reps) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    if (t >= n) return;
    float acc = 0.0f;
    long base = (long)t * stride;
    for (int r = 0; r < reps; r++) acc += in[base + r];
    out[t] = acc;
}

/* ----- divergence kernel: same total work, but threads in a warp split into D branches.
 *       The warp executes all D paths serially, so time grows ~D even though useful work
 *       is constant -> divergence serializes. ----- */
__global__ void k_diverge(const float *in, float *out, int n, int D, int work) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    if (t >= n) return;
    float a = in[t];
    int branch = (threadIdx.x & 31) % D;
    for (int b = 0; b < D; b++) {
        if (branch == b) { for (int k = 0; k < work; k++) a = a * 0.9999998f + 1.0e-6f; }
    }
    out[t] = a;
}

/* ----- atomics kernel: every thread does `reps` atomicAdds to counters[tid % ntargets].
 *       ntargets=1 funnels ALL threads through one address (serialized in the L2 atomic unit);
 *       more targets spread the traffic so updates proceed in parallel -> time drops. ----- */
__global__ void k_atomics(unsigned long long *counters, int n, int ntargets, int reps) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    if (t >= n) return;
    int idx = t % ntargets;
    for (int r = 0; r < reps; r++) atomicAdd(&counters[idx], 1ULL);
}

static void run_occupancy(const cudaDeviceProp &prop, const char *variant) {
    int heavy = (strcmp(variant, "heavy") == 0);
    int maxWarpsPerSM = prop.maxThreadsPerMultiProcessor / prop.warpSize;
    const int N = 1 << 22;
    float *din = nullptr, *dout = nullptr;
    cudaMalloc(&din, (size_t)N * sizeof(float)); cudaMalloc(&dout, (size_t)N * sizeof(float)); cudaMemset(din, 0, (size_t)N * sizeof(float));
    cudaFuncAttributes attr; cudaFuncGetAttributes(&attr, heavy ? (const void *)k_heavy : (const void *)k_light);
    int regs = attr.numRegs;
    cudaEvent_t t0, t1; cudaEventCreate(&t0); cudaEventCreate(&t1);
    printf("{\"exp\":\"cuda\",\"variant\":\"%s\",\"points\":[", variant);
    int first = 1;
    for (int bi = 0; bi < NBS; bi++) {
        int B = BLOCK_SIZES[bi];
        if (B > prop.maxThreadsPerBlock) continue;
        int maxBlocks = 0;
        cudaOccupancyMaxActiveBlocksPerMultiprocessor(&maxBlocks, heavy ? (void *)k_heavy : (void *)k_light, B, 0);
        if (maxBlocks < 1) continue;
        double occ = (double)(maxBlocks * (B / prop.warpSize)) / (double)maxWarpsPerSM; if (occ > 1.0) occ = 1.0;
        int grid = (N + B - 1) / B;
        if (heavy) k_heavy<<<grid, B>>>(din, dout, N, ITERS); else k_light<<<grid, B>>>(din, dout, N, ITERS);
        cudaDeviceSynchronize();
        float best = 1e30f;
        for (int r = 0; r < REPS; r++) { cudaEventRecord(t0); if (heavy) k_heavy<<<grid, B>>>(din, dout, N, ITERS); else k_light<<<grid, B>>>(din, dout, N, ITERS); cudaEventRecord(t1); cudaEventSynchronize(t1); float ms = 0.f; cudaEventElapsedTime(&ms, t0, t1); if (ms < best) best = ms; }
        if (cudaGetLastError() != cudaSuccess) continue;
        double gflops = ((double)N * (double)ITERS * (heavy ? (double)ACC * 2.0 : 2.0)) / (best * 1.0e-3) / 1.0e9;
        printf("%s{\"p\":%d,\"ms\":%.4f,\"occ\":%.4f,\"gflops\":%.2f}", first ? "" : ",", B, best, occ, gflops); first = 0; fflush(stdout);
    }
    printf("],\"sm\":\"%s\",\"regs\":%d,\"maxWarpsPerSM\":%d,\"cc\":\"%d.%d\"}\n", prop.name, regs, maxWarpsPerSM, prop.major, prop.minor);
    cudaFree(din); cudaFree(dout); cudaEventDestroy(t0); cudaEventDestroy(t1);
}

static void run_coalesce(const cudaDeviceProp &prop) {
    const int N = 1 << 22, RC = 24, B = 256, grid = (N + B - 1) / B;
    size_t inN = (size_t)N * 32 + RC;
    float *din = nullptr, *dout = nullptr;
    cudaMalloc(&din, inN * sizeof(float)); cudaMalloc(&dout, (size_t)N * sizeof(float)); cudaMemset(din, 0, inN * sizeof(float));
    cudaEvent_t t0, t1; cudaEventCreate(&t0); cudaEventCreate(&t1);
    printf("{\"exp\":\"cuda-coalesce\",\"variant\":\"copy\",\"points\":[");
    int first = 1; double peak = 0;
    for (int s = 0; s < 6; s++) {
        int stride = SWEEP6[s];
        k_stride<<<grid, B>>>(din, dout, N, stride, RC); cudaDeviceSynchronize();
        float best = 1e30f;
        for (int r = 0; r < REPS; r++) { cudaEventRecord(t0); k_stride<<<grid, B>>>(din, dout, N, stride, RC); cudaEventRecord(t1); cudaEventSynchronize(t1); float ms = 0.f; cudaEventElapsedTime(&ms, t0, t1); if (ms < best) best = ms; }
        if (cudaGetLastError() != cudaSuccess) continue;
        double gbps = ((double)N * RC * 4.0) / (best * 1.0e-3) / 1.0e9;
        if (gbps > peak) peak = gbps;
        printf("%s{\"p\":%d,\"ms\":%.4f,\"gbps\":%.2f}", first ? "" : ",", stride, best, gbps); first = 0; fflush(stdout);
    }
    printf("],\"sm\":\"%s\",\"peakGBps\":%.2f,\"cc\":\"%d.%d\"}\n", prop.name, peak, prop.major, prop.minor);
    cudaFree(din); cudaFree(dout); cudaEventDestroy(t0); cudaEventDestroy(t1);
}

static void run_divergence(const cudaDeviceProp &prop) {
    const int N = 1 << 22, WORK = 2048, B = 256, grid = (N + B - 1) / B;
    float *din = nullptr, *dout = nullptr;
    cudaMalloc(&din, (size_t)N * sizeof(float)); cudaMalloc(&dout, (size_t)N * sizeof(float)); cudaMemset(din, 0, (size_t)N * sizeof(float));
    cudaEvent_t t0, t1; cudaEventCreate(&t0); cudaEventCreate(&t1);
    printf("{\"exp\":\"cuda-divergence\",\"variant\":\"branch\",\"points\":[");
    int first = 1;
    for (int s = 0; s < 6; s++) {
        int D = SWEEP6[s];
        k_diverge<<<grid, B>>>(din, dout, N, D, WORK); cudaDeviceSynchronize();
        float best = 1e30f;
        for (int r = 0; r < REPS; r++) { cudaEventRecord(t0); k_diverge<<<grid, B>>>(din, dout, N, D, WORK); cudaEventRecord(t1); cudaEventSynchronize(t1); float ms = 0.f; cudaEventElapsedTime(&ms, t0, t1); if (ms < best) best = ms; }
        if (cudaGetLastError() != cudaSuccess) continue;
        printf("%s{\"p\":%d,\"ms\":%.4f}", first ? "" : ",", D, best); first = 0; fflush(stdout);
    }
    printf("],\"sm\":\"%s\",\"cc\":\"%d.%d\"}\n", prop.name, prop.major, prop.minor);
    cudaFree(din); cudaFree(dout); cudaEventDestroy(t0); cudaEventDestroy(t1);
}

static void run_atomics(const cudaDeviceProp &prop) {
    const int N = 1 << 19, REPSA = 16, B = 256, grid = (N + B - 1) / B, MAXT = 4096;
    static const int ATOM[] = {1, 4, 16, 64, 256, 1024, 4096};
    unsigned long long *dc = nullptr;
    cudaMalloc(&dc, (size_t)MAXT * sizeof(unsigned long long));
    cudaEvent_t t0, t1; cudaEventCreate(&t0); cudaEventCreate(&t1);
    printf("{\"exp\":\"cuda-atomics\",\"variant\":\"add\",\"points\":[");
    int first = 1;
    for (int s = 0; s < 7; s++) {
        int T = ATOM[s];
        cudaMemset(dc, 0, (size_t)MAXT * sizeof(unsigned long long));
        k_atomics<<<grid, B>>>(dc, N, T, REPSA); cudaDeviceSynchronize();
        float best = 1e30f;
        for (int r = 0; r < REPS; r++) { cudaEventRecord(t0); k_atomics<<<grid, B>>>(dc, N, T, REPSA); cudaEventRecord(t1); cudaEventSynchronize(t1); float ms = 0.f; cudaEventElapsedTime(&ms, t0, t1); if (ms < best) best = ms; }
        if (cudaGetLastError() != cudaSuccess) continue;
        printf("%s{\"p\":%d,\"ms\":%.4f}", first ? "" : ",", T, best); first = 0; fflush(stdout);
    }
    printf("],\"sm\":\"%s\",\"cc\":\"%d.%d\"}\n", prop.name, prop.major, prop.minor);
    cudaFree(dc); cudaEventDestroy(t0); cudaEventDestroy(t1);
}

/* ----- shared-memory bank-conflict kernel: each warp reads/writes shared memory at
 *       the given stride. Without padding, stride-way bank conflicts serialize accesses;
 *       with padding (width 33 instead of 32), every stride maps to a distinct bank
 *       and conflicts disappear -> bandwidth recovers. ----- */
__global__ void shmem_bank_kernel(float *out, int stride, int padded) {
    extern __shared__ float smem[];
    int tid = threadIdx.x;
    int lane = tid & 31;
    float sum = 0.0f;

    int idx = padded ? (lane * stride + lane * stride / 32) : (lane * stride);
    for (int rep = 0; rep < 1000; rep++) {
        smem[idx % (32 * 33)] = (float)lane;
        __syncthreads();
        sum += smem[idx % (32 * 33)];
        __syncthreads();
    }
    if (tid == 0) out[blockIdx.x] = sum; /* prevent optimization */
}

static void run_sharedmem(const cudaDeviceProp &prop, int padded) {
    const int B = 256, NBLOCKS = 256;
    float *dout = nullptr;
    cudaMalloc(&dout, (size_t)NBLOCKS * sizeof(float));

    size_t smem_sz = 32 * 33 * sizeof(float); /* enough for padded layout */
    cudaEvent_t t0, t1; cudaEventCreate(&t0); cudaEventCreate(&t1);

    const char *variant = padded ? "padded" : "unpadded";
    printf("{\"exp\":\"cuda-sharedmem\",\"variant\":\"%s\",\"points\":[", variant);
    int first = 1;
    for (int s = 0; s < 6; s++) {
        int stride = SWEEP6[s];
        /* warm-up */
        shmem_bank_kernel<<<NBLOCKS, B, smem_sz>>>(dout, stride, padded);
        cudaDeviceSynchronize();
        float best = 1e30f;
        for (int r = 0; r < REPS; r++) {
            cudaEventRecord(t0);
            shmem_bank_kernel<<<NBLOCKS, B, smem_sz>>>(dout, stride, padded);
            cudaEventRecord(t1);
            cudaEventSynchronize(t1);
            float ms = 0.f;
            cudaEventElapsedTime(&ms, t0, t1);
            if (ms < best) best = ms;
        }
        if (cudaGetLastError() != cudaSuccess) continue;
        /* Effective bandwidth: each thread does 1000 reps of 1 write + 1 read (8 bytes per rep).
         * Total bytes = NBLOCKS * B * 1000 * 8. */
        double bytes = (double)NBLOCKS * (double)B * 1000.0 * 8.0;
        double gbps = bytes / (best * 1.0e-3) / 1.0e9;
        printf("%s{\"p\":%d,\"ms\":%.4f,\"gbps\":%.2f}", first ? "" : ",", stride, best, gbps);
        first = 0; fflush(stdout);
    }
    printf("],\"sm\":\"%s\",\"cc\":\"%d.%d\"}\n", prop.name, prop.major, prop.minor);
    cudaFree(dout); cudaEventDestroy(t0); cudaEventDestroy(t1);
}

int main(int argc, char **argv) {
    const char *experiment = (argc > 1) ? argv[1] : "occupancy";
    const char *variant = (argc > 2) ? argv[2] : "heavy";
    cudaDeviceProp prop; int dev = 0;
    if (cudaGetDevice(&dev) != cudaSuccess || cudaGetDeviceProperties(&prop, dev) != cudaSuccess) {
        printf("{\"error\":\"run\",\"message\":\"no CUDA device\"}\n"); return 0;
    }
    if (strcmp(experiment, "coalesce") == 0) run_coalesce(prop);
    else if (strcmp(experiment, "divergence") == 0) run_divergence(prop);
    else if (strcmp(experiment, "atomics") == 0) run_atomics(prop);
    else if (strcmp(experiment, "sharedmem") == 0) run_sharedmem(prop, strcmp(variant, "padded") == 0);
    else run_occupancy(prop, variant);
    return 0;
}
