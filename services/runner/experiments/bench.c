/* VHPCE benchmark harness — real OpenMP kernels for the flagship experiments.
 *
 * Usage:   ./bench <exp> <variant> <maxthreads>
 *   exp:      falsesharing | sync | bandwidth | imbalance
 *   variant:  falsesharing -> shared | padded
 *             sync         -> critical | atomic | reduction
 *             bandwidth    -> triad
 *             imbalance    -> static | guided | dynamic
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
