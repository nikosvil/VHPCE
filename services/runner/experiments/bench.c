/* VHPCE benchmark harness — real OpenMP kernels for the flagship experiments.
 *
 * Usage:   ./bench <exp> <variant> <maxthreads>
 *   exp:      falsesharing | sync | bandwidth | imbalance |
 *             numaeffects | cachehierarchy | simdvec | tasks
 *   variant:  falsesharing   -> shared | padded
 *             sync           -> critical | atomic | reduction
 *             bandwidth      -> triad
 *             imbalance      -> static | guided | dynamic
 *             numaeffects    -> aware | unaware
 *             cachehierarchy -> L1 | L2 | L3 | DRAM
 *             simdvec        -> SoA | AoS
 *             tasks          -> coarse | fine
 *
 * Emits one JSON object on stdout:
 *   {"exp":..,"variant":..,"points":[{"p":1,"ms":..[,"gbps":..,"gflops":..]}, ...]}
 *
 * Each point is the BEST (min) wall time over a few repetitions at that thread count.
 * Build: gcc -O2 -fopenmp -march=native -o bench bench.c -lm
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <omp.h>

#define MAXT 64
#define REPS 2

/* ----------------------------- False sharing ----------------------------- */
/* Controlled experiment: ONE array, ONE loop body, identical machine code for both
 * variants. The only difference is the per-thread index stride:
 *   shared  (stride 1): threads 0..7 land in the same 64 B line -> coherence ping-pong.
 *   padded  (stride 8): each thread gets its own 64 B line      -> no false sharing.
 * Because the code is identical, the single-thread baseline is identical too (thread 0
 * uses index 0 either way). "volatile" forces every increment to hit memory so the
 * coherence traffic is real and the loop is not collapsed into one add. */
static volatile long fs_data[MAXT * 8];   /* room for the stride-8 layout */

static double run_false_sharing(int p, int padded) {
    const long TOTAL = 300000000L;        /* fixed total work, split across threads */
    long per = TOTAL / p;
    int stride = padded ? 8 : 1;          /* 8 longs = 64 bytes = one cache line */
    for (int i = 0; i < MAXT * 8; i++) fs_data[i] = 0;
    double t0 = omp_get_wtime();
    #pragma omp parallel num_threads(p)
    { int t = omp_get_thread_num(); long idx = (long)t * stride;
      for (long i = 0; i < per; i++) fs_data[idx]++; }
    double t1 = omp_get_wtime();
    volatile long sink = 0; for (int i = 0; i < MAXT * 8; i++) sink += fs_data[i]; (void)sink;
    return (t1 - t0) * 1000.0;
}

/* ---------------------------- Synchronization ---------------------------- */
/* Sum a derived value over a hot loop three ways. Per-variant work sizes keep
 * single-thread time in a measurable band despite very different per-op costs. */
static double run_sync(int p, const char *variant) {
    long TOTAL;
    if      (strcmp(variant, "reduction") == 0) TOTAL = 200000000L;
    else if (strcmp(variant, "atomic")    == 0) TOTAL = 20000000L;
    else                                        TOTAL = 2000000L;   /* critical */
    double sum = 0.0;
    double t0 = omp_get_wtime();
    if (strcmp(variant, "reduction") == 0) {
        #pragma omp parallel for num_threads(p) reduction(+:sum) schedule(static)
        for (long i = 0; i < TOTAL; i++) { double v = (double)(i & 1023) * 0.5 + 1.0; sum += v; }
    } else if (strcmp(variant, "atomic") == 0) {
        #pragma omp parallel for num_threads(p) schedule(static)
        for (long i = 0; i < TOTAL; i++) { double v = (double)(i & 1023) * 0.5 + 1.0;
            #pragma omp atomic
            sum += v; }
    } else { /* critical */
        #pragma omp parallel for num_threads(p) schedule(static)
        for (long i = 0; i < TOTAL; i++) { double v = (double)(i & 1023) * 0.5 + 1.0;
            #pragma omp critical
            { sum += v; } }
    }
    double t1 = omp_get_wtime();
    volatile double sink = sum; (void)sink;
    return (t1 - t0) * 1000.0;
}

/* ------------------------------- Bandwidth ------------------------------- */
/* STREAM triad a = b + s*c over arrays far larger than LLC -> DRAM-bound. */
static double *ba = NULL, *bb = NULL, *bc = NULL;
static const long BW_N = 8000000L;       /* doubles per array (~64 MB each) */
static const int  BW_R = 12;             /* repetitions per timed run       */
static void bw_init(void) {
    ba = malloc(BW_N * sizeof(double));
    bb = malloc(BW_N * sizeof(double));
    bc = malloc(BW_N * sizeof(double));
    for (long i = 0; i < BW_N; i++) { bb[i] = 1.0; bc[i] = 2.0; ba[i] = 0.0; }
}
static double run_bw(int p, double *gbps_out, double *gflops_out) {
    const double s = 3.0;
    double t0 = omp_get_wtime();
    for (int r = 0; r < BW_R; r++) {
        #pragma omp parallel for num_threads(p) schedule(static)
        for (long i = 0; i < BW_N; i++) ba[i] = bb[i] + s * bc[i];
    }
    double t1 = omp_get_wtime();
    double secs  = (t1 - t0);
    double bytes = (double)BW_N * 24.0 * BW_R;   /* 2 reads + 1 write, 8 B each */
    double flops = (double)BW_N * 2.0  * BW_R;   /* one mul + one add           */
    *gbps_out   = bytes / secs / 1e9;
    *gflops_out = flops / secs / 1e9;
    return secs * 1000.0;
}

/* ------------------------------- Imbalance ------------------------------- */
/* Triangular loop: row i does i units of work. static scheduling gives late
 * threads more -> idle early threads; dynamic/guided rebalance. */
static double run_imbalance(int p, const char *sched) {
    const long M = 12000;
    double acc = 0.0;
    double t0 = omp_get_wtime();
    if (strcmp(sched, "dynamic") == 0) {
        #pragma omp parallel for num_threads(p) schedule(dynamic,16) reduction(+:acc)
        for (long i = 0; i < M; i++) { double a = 0; for (long j = 0; j < i; j++) a += 1.0 / (double)(j + 1); acc += a; }
    } else if (strcmp(sched, "guided") == 0) {
        #pragma omp parallel for num_threads(p) schedule(guided) reduction(+:acc)
        for (long i = 0; i < M; i++) { double a = 0; for (long j = 0; j < i; j++) a += 1.0 / (double)(j + 1); acc += a; }
    } else { /* static */
        #pragma omp parallel for num_threads(p) schedule(static) reduction(+:acc)
        for (long i = 0; i < M; i++) { double a = 0; for (long j = 0; j < i; j++) a += 1.0 / (double)(j + 1); acc += a; }
    }
    double t1 = omp_get_wtime();
    volatile double sink = acc; (void)sink;
    return (t1 - t0) * 1000.0;
}

/* ----------------------------- NUMA effects ----------------------------- */
/* "aware": each thread first-touches its own portion (data lands in local cache).
 * "unaware": thread 0 touches everything, then all threads access -> remote misses. */
static double run_numa(int p, int aware) {
    const long N = 64L * 1024 * 1024 / (long)sizeof(double); /* 64 MB */
    const int PASSES = 50;
    double *arr = (double *)malloc(N * sizeof(double));
    if (!arr) { fprintf(stderr, "malloc failed in run_numa\n"); return -1; }

    if (aware) {
        /* parallel first-touch: each thread inits its own portion */
        #pragma omp parallel for num_threads(p) schedule(static)
        for (long i = 0; i < N; i++) arr[i] = 1.0;
    } else {
        /* serial init: thread 0 touches everything */
        for (long i = 0; i < N; i++) arr[i] = 1.0;
    }

    volatile double sink = 0.0;
    double t0 = omp_get_wtime();
    for (int pass = 0; pass < PASSES; pass++) {
        double local_sum = 0.0;
        #pragma omp parallel for num_threads(p) schedule(static) reduction(+:local_sum)
        for (long i = 0; i < N; i++) local_sum += arr[i];
        sink = local_sum;
    }
    double t1 = omp_get_wtime();
    (void)sink;
    free(arr);
    return (t1 - t0) * 1000.0;
}

/* --------------------------- Cache hierarchy ---------------------------- */
/* Vary working-set size to target L1 / L2 / L3 / DRAM bandwidth. */
static double run_cache(int p, const char *level) {
    long per_thread;
    int reps;
    if      (strcmp(level, "L1")   == 0) { per_thread = 8L   * 1024 / (long)sizeof(double); reps = 50000; }
    else if (strcmp(level, "L2")   == 0) { per_thread = 64L  * 1024 / (long)sizeof(double); reps = 6000;  }
    else if (strcmp(level, "L3")   == 0) { per_thread = 1L   * 1024 * 1024 / (long)sizeof(double); reps = 400; }
    else /* DRAM */                      { per_thread = 16L  * 1024 * 1024 / (long)sizeof(double); reps = 20;  }

    long N = per_thread * p;
    double *arr = (double *)malloc(N * sizeof(double));
    if (!arr) { fprintf(stderr, "malloc failed in run_cache\n"); return -1; }
    for (long i = 0; i < N; i++) arr[i] = 1.0;

    volatile double sink = 0.0;
    double t0 = omp_get_wtime();
    for (int r = 0; r < reps; r++) {
        double local_sum = 0.0;
        #pragma omp parallel for num_threads(p) schedule(static) reduction(+:local_sum)
        for (long i = 0; i < N; i++) local_sum += arr[i];
        sink = local_sum;
    }
    double t1 = omp_get_wtime();
    (void)sink;
    free(arr);
    return (t1 - t0) * 1000.0;
}

/* ----------------------------- SIMD / vec ------------------------------- */
/* AoS vs SoA data layout: SoA enables contiguous SIMD loads, AoS forces gathers. */
typedef struct { float x, y, z, w; } AoS4;

static double run_simd(int p, int soa) {
    const long N = 4L * 1024 * 1024;   /* 4M elements */
    const int PASSES = 20;

    if (soa) {
        float *bx = (float *)malloc(N * sizeof(float));
        float *cx = (float *)malloc(N * sizeof(float));
        float *dx = (float *)malloc(N * sizeof(float));
        float *ax = (float *)malloc(N * sizeof(float));
        if (!bx || !cx || !dx || !ax) { fprintf(stderr, "malloc failed in run_simd SoA\n"); return -1; }
        for (long i = 0; i < N; i++) { bx[i] = 1.0f; cx[i] = 2.0f; dx[i] = 3.0f; ax[i] = 0.0f; }

        double t0 = omp_get_wtime();
        for (int pass = 0; pass < PASSES; pass++) {
            #pragma omp parallel for num_threads(p) schedule(static)
            for (long i = 0; i < N; i++) ax[i] = bx[i] * cx[i] + dx[i];
        }
        double t1 = omp_get_wtime();
        volatile float sink = ax[N - 1]; (void)sink;
        free(bx); free(cx); free(dx); free(ax);
        return (t1 - t0) * 1000.0;
    } else {
        AoS4 *src1 = (AoS4 *)malloc(N * sizeof(AoS4));
        AoS4 *src2 = (AoS4 *)malloc(N * sizeof(AoS4));
        AoS4 *src3 = (AoS4 *)malloc(N * sizeof(AoS4));
        AoS4 *dst  = (AoS4 *)malloc(N * sizeof(AoS4));
        if (!src1 || !src2 || !src3 || !dst) { fprintf(stderr, "malloc failed in run_simd AoS\n"); return -1; }
        for (long i = 0; i < N; i++) {
            src1[i].x = 1.0f; src1[i].y = 1.0f; src1[i].z = 1.0f; src1[i].w = 1.0f;
            src2[i].x = 2.0f; src2[i].y = 2.0f; src2[i].z = 2.0f; src2[i].w = 2.0f;
            src3[i].x = 3.0f; src3[i].y = 3.0f; src3[i].z = 3.0f; src3[i].w = 3.0f;
            dst[i].x  = 0.0f; dst[i].y  = 0.0f; dst[i].z  = 0.0f; dst[i].w  = 0.0f;
        }

        double t0 = omp_get_wtime();
        for (int pass = 0; pass < PASSES; pass++) {
            #pragma omp parallel for num_threads(p) schedule(static)
            for (long i = 0; i < N; i++) {
                dst[i].x = src1[i].x * src2[i].x + src3[i].x;
                dst[i].y = src1[i].y * src2[i].y + src3[i].y;
                dst[i].z = src1[i].z * src2[i].z + src3[i].z;
                dst[i].w = src1[i].w * src2[i].w + src3[i].w;
            }
        }
        double t1 = omp_get_wtime();
        volatile float sink = dst[N - 1].w; (void)sink;
        free(src1); free(src2); free(src3); free(dst);
        return (t1 - t0) * 1000.0;
    }
}

/* -------------------------------- Tasks --------------------------------- */
/* coarse: p tasks each doing TOTAL/p work  — minimal overhead.
 * fine:   10000 small tasks               — task queue contention at scale. */
static double run_tasks(int p, int fine) {
    const long TOTAL = 200000000L;
    int num_tasks = fine ? 10000 : p;
    long work_per = TOTAL / num_tasks;
    volatile long result = 0;

    double t0 = omp_get_wtime();
    #pragma omp parallel num_threads(p)
    {
        #pragma omp single
        {
            for (int t = 0; t < num_tasks; t++) {
                #pragma omp task firstprivate(work_per)
                {
                    long local = 0;
                    for (long i = 0; i < work_per; i++) local++;
                    #pragma omp atomic
                    result += local;
                }
            }
        }
    }
    double t1 = omp_get_wtime();
    volatile long sink = result; (void)sink;
    return (t1 - t0) * 1000.0;
}

/* --------------------------------- main --------------------------------- */
int main(int argc, char **argv) {
    if (argc < 4) { fprintf(stderr, "usage: bench <exp> <variant> <maxthreads>\n"); return 2; }
    const char *exp = argv[1], *variant = argv[2];
    int maxt = atoi(argv[3]); if (maxt > MAXT) maxt = MAXT; if (maxt < 1) maxt = 1;
    int is_bw = (strcmp(exp, "bandwidth") == 0);
    if (is_bw) bw_init();

    printf("{\"exp\":\"%s\",\"variant\":\"%s\",\"points\":[", exp, variant);
    int first = 1;
    for (int p = 1; p <= maxt; p++) {
        double best = 1e18, gbps = 0, gflops = 0;
        for (int r = 0; r < REPS; r++) {
            double ms = 0, g = 0, f = 0;
            if      (strcmp(exp, "falsesharing") == 0) ms = run_false_sharing(p, strcmp(variant, "padded") == 0);
            else if (strcmp(exp, "sync") == 0)         ms = run_sync(p, variant);
            else if (is_bw)                            ms = run_bw(p, &g, &f);
            else if (strcmp(exp, "imbalance") == 0)    ms = run_imbalance(p, variant);
            else if (strcmp(exp, "numaeffects") == 0)  ms = run_numa(p, strcmp(variant, "aware") == 0);
            else if (strcmp(exp, "cachehierarchy") == 0) ms = run_cache(p, variant);
            else if (strcmp(exp, "simdvec") == 0)      ms = run_simd(p, strcmp(variant, "SoA") == 0);
            else if (strcmp(exp, "tasks") == 0)         ms = run_tasks(p, strcmp(variant, "fine") == 0);
            else { fprintf(stderr, "unknown exp: %s\n", exp); return 2; }
            if (ms < best) { best = ms; gbps = g; gflops = f; }
        }
        if (!first) printf(",");
        first = 0;
        if (is_bw) printf("{\"p\":%d,\"ms\":%.3f,\"gbps\":%.2f,\"gflops\":%.3f}", p, best, gbps, gflops);
        else       printf("{\"p\":%d,\"ms\":%.3f}", p, best);
        fflush(stdout);
    }
    printf("]}\n");
    return 0;
}
