/* VHPCE GPU experiments for the flagship — one program, three lessons (dispatch on argv[1]):
 *   occupancy   : register pressure caps warps/SM (light vs heavy). argv[2] = light|heavy.
 *   coalesce    : strided global access wastes memory bandwidth (stride sweep 1..32).
 *   divergence  : divergent branches within a warp serialize execution (paths sweep 1..32).
 *
 * Each emits one JSON object on stdout matching the RunnerData seam:
 *   {"exp":..,"variant":..,"points":[{"p":<x>,"ms":..[,"occ"|"gbps"|...]}], "sm":..,"cc":..}
 *
 * Build: nvcc -O2 -arch=sm_120 occupancy.cu -o occupancy   (PTX-JIT fallback: compute_90)
 * Run:   occupancy <occupancy|coalesce|divergence> [variant]
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

int main(int argc, char **argv) {
    const char *experiment = (argc > 1) ? argv[1] : "occupancy";
    const char *variant = (argc > 2) ? argv[2] : "heavy";
    cudaDeviceProp prop; int dev = 0;
    if (cudaGetDevice(&dev) != cudaSuccess || cudaGetDeviceProperties(&prop, dev) != cudaSuccess) {
        printf("{\"error\":\"run\",\"message\":\"no CUDA device\"}\n"); return 0;
    }
    if (strcmp(experiment, "coalesce") == 0) run_coalesce(prop);
    else if (strcmp(experiment, "divergence") == 0) run_divergence(prop);
    else run_occupancy(prop, variant);
    return 0;
}
