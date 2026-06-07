/* VHPCE GPU occupancy kernel - the flagship "GPU Occupancy" experiment.
 *
 * Two compute-bound kernels with deliberately different register footprints:
 *   light : a few live variables -> low registers/thread -> high occupancy.
 *   heavy : many simultaneously-live accumulators -> high registers/thread -> the SM
 *           runs out of registers before it runs out of warp slots, so occupancy is
 *           register-limited (worse at large block sizes). This is the lesson.
 *
 * For each block size in a fixed sweep we:
 *   1) ask the CUDA Occupancy API for the max active blocks/SM for that launch config
 *      (this is *real* occupancy from the compiled kernel's resource usage on this GPU),
 *   2) launch over a fixed total problem size and time it with CUDA events (best of REPS).
 *
 * Emits one JSON object on stdout (rank-0-style), matching the RunnerData seam:
 *   {"exp":"cuda","variant":"...","points":[{"p":<block>,"ms":..,"occ":0..1,"gflops":..}, ...],
 *    "sm":"<device name>","regs":<regs/thread>,"maxWarpsPerSM":<n>,"cc":"<major.minor>"}
 *
 * Build: nvcc -O2 -arch=sm_120 occupancy.cu -o occupancy   (PTX-JIT fallback: compute_90)
 * Run:   occupancy <light|heavy>
 */
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cuda_runtime.h>

#define REPS 3
#define ITERS 1024      /* arithmetic iterations per thread (compute-bound) */
#define ACC 96          /* heavy kernel: live accumulators -> forces high register pressure */

static const int BLOCK_SIZES[] = {32, 64, 96, 128, 160, 192, 256, 320, 384, 512, 640, 768, 896, 1024};
static const int NBS = (int)(sizeof(BLOCK_SIZES) / sizeof(BLOCK_SIZES[0]));

/* Light kernel: minimal live state -> few registers. */
__global__ void k_light(const float *in, float *out, int n, int iters) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    float a = in[i];
    for (int k = 0; k < iters; k++) a = a * 0.9999998f + 1.0e-6f;
    out[i] = a;
}

/* Heavy kernel: ACC simultaneously-live accumulators kept in registers (fully unrolled,
 * cross-coupled so nvcc can't eliminate or schedule them down) -> high register pressure,
 * so the SM's register file fills before its warp slots and occupancy is register-limited. */
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

int main(int argc, char **argv) {
    const char *variant = (argc > 1) ? argv[1] : "heavy";
    int heavy = (strcmp(variant, "heavy") == 0);

    int dev = 0;
    cudaDeviceProp prop;
    if (cudaGetDevice(&dev) != cudaSuccess || cudaGetDeviceProperties(&prop, dev) != cudaSuccess) {
        printf("{\"error\":\"run\",\"message\":\"no CUDA device\"}\n");
        return 0;
    }
    int maxWarpsPerSM = prop.maxThreadsPerMultiProcessor / prop.warpSize;

    /* Fixed total problem size (independent of block size); rounded up per launch. */
    const int N = 1 << 22;   /* ~4.2M threads of work */
    float *din = nullptr, *dout = nullptr;
    cudaMalloc(&din, (size_t)N * sizeof(float));
    cudaMalloc(&dout, (size_t)N * sizeof(float));
    cudaMemset(din, 0, (size_t)N * sizeof(float));

    void *kern = heavy ? (void *)k_heavy : (void *)k_light;
    cudaFuncAttributes attr;
    cudaFuncGetAttributes(&attr, heavy ? (const void *)k_heavy : (const void *)k_light);
    int regs = attr.numRegs;

    cudaEvent_t t0, t1;
    cudaEventCreate(&t0); cudaEventCreate(&t1);

    printf("{\"exp\":\"cuda\",\"variant\":\"%s\",\"points\":[", variant);
    int first = 1;
    for (int bi = 0; bi < NBS; bi++) {
        int B = BLOCK_SIZES[bi];
        if (B > prop.maxThreadsPerBlock) continue;

        /* Real occupancy from the compiled kernel's resource use on this device. */
        int maxBlocks = 0;
        cudaOccupancyMaxActiveBlocksPerMultiprocessor(&maxBlocks, heavy ? (void *)k_heavy : (void *)k_light, B, 0);
        /* If not even one block fits (registers exhausted at this block size), the launch is
         * infeasible — skip it rather than erroring. For the heavy kernel this is itself the
         * lesson: large blocks of a register-hungry kernel simply can't launch. */
        if (maxBlocks < 1) continue;
        int activeWarps = maxBlocks * (B / prop.warpSize);
        double occ = (double)activeWarps / (double)maxWarpsPerSM;
        if (occ > 1.0) occ = 1.0;

        int grid = (N + B - 1) / B;
        /* warm-up */
        if (heavy) k_heavy<<<grid, B>>>(din, dout, N, ITERS); else k_light<<<grid, B>>>(din, dout, N, ITERS);
        cudaDeviceSynchronize();

        float best = 1e30f;
        for (int r = 0; r < REPS; r++) {
            cudaEventRecord(t0);
            if (heavy) k_heavy<<<grid, B>>>(din, dout, N, ITERS); else k_light<<<grid, B>>>(din, dout, N, ITERS);
            cudaEventRecord(t1);
            cudaEventSynchronize(t1);
            float ms = 0.f; cudaEventElapsedTime(&ms, t0, t1);
            if (ms < best) best = ms;
        }
        if (cudaGetLastError() != cudaSuccess) continue;   // skip a bad launch, don't poison the JSON
        /* FLOPs/thread/iter: heavy does ACC FMA-pairs (~2 each), light does ~2. */
        double flopsPerThread = (double)ITERS * (heavy ? (double)ACC * 2.0 : 2.0);
        double gflops = ((double)N * flopsPerThread) / (best * 1.0e-3) / 1.0e9;

        printf("%s{\"p\":%d,\"ms\":%.4f,\"occ\":%.4f,\"gflops\":%.2f}", first ? "" : ",", B, best, occ, gflops);
        first = 0;
        fflush(stdout);
        (void)kern;
    }
    printf("],\"sm\":\"%s\",\"regs\":%d,\"maxWarpsPerSM\":%d,\"cc\":\"%d.%d\"}\n",
           prop.name, regs, maxWarpsPerSM, prop.major, prop.minor);

    cudaFree(din); cudaFree(dout);
    cudaEventDestroy(t0); cudaEventDestroy(t1);
    return 0;
}
