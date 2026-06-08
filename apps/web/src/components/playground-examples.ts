// Curated, ready-to-run OpenMP C examples for the Playground. Lets a beginner run real
// parallel code without writing any — and gives the /learn and /reference cards something
// concrete to link to ("▶ Run it in the Playground"). Each does enough work that the thread
// sweep is meaningful (~100 ms+). `tryThis` is a one-line coach shown when the example loads:
// what to run and what the result teaches. Ordered gentlest → most advanced.
// Note: printf newlines are escaped as \\n so the C source keeps a literal \n (the surrounding
// TS template would otherwise insert a real newline).

export type Example = { id: string; label: string; blurb: string; tryThis?: string; source: string };

export const EXAMPLES: Example[] = [
  {
    id: "hello",
    label: "Hello, threads",
    blurb: "The simplest parallel region: every thread runs the block and prints its id.",
    tryThis: "Run it. Each thread prints its own id; they all work at once, so wall time barely changes as you add threads.",
    source: `/* Your first OpenMP program: a parallel region. Each thread runs the block
   independently. The loop is just enough work to make the timing meaningful. */
#include <stdio.h>
#include <omp.h>

int main(void) {
    #pragma omp parallel
    {
        int t = omp_get_thread_num(), n = omp_get_num_threads();
        double x = 0;
        for (long i = 0; i < 60000000; i++) x += 1.0 / (double)(i + 1 + t);
        printf("thread %d of %d  (x=%.3f)\\n", t, n, x);
    }
    return 0;
}
`,
  },
  {
    id: "reduction",
    label: "Parallel sum",
    blurb: "A parallel-for reduction — the safe, scalable way to combine per-thread partials.",
    tryThis: "Run it. Speedup climbs near-linearly — a reduction has no shared-write bottleneck. Then compare with 'Sync cost'.",
    source: `/* Parallel sum with a reduction. Each thread keeps a private partial;
   OpenMP combines them once at the end — no shared-write race, scales well. */
#include <stdio.h>
#include <omp.h>

int main(void) {
    const long N = 300000000;
    double sum = 0.0;
    #pragma omp parallel for reduction(+:sum)
    for (long i = 0; i < N; i++)
        sum += 1.0 / (double)(i + 1);
    printf("sum=%f on %d threads\\n", sum, omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "sync",
    label: "Sync cost (atomic)",
    blurb: "Accumulate with #pragma omp atomic — every iteration serializes on one update, so it barely scales (or gets slower).",
    tryThis: "Run it. Speedup stays near 1× (or drops) — one atomic counter serializes every iteration. Compare with 'Parallel sum'.",
    source: `/* Synchronization cost: every iteration does an atomic update to ONE shared
   counter, so the threads serialize on it. Watch the speedup stay near 1 (or drop) —
   then compare with the 'Parallel sum' reduction example, which avoids the shared write. */
#include <stdio.h>
#include <omp.h>

int main(void) {
    const long N = 60000000;
    long sum = 0;
    #pragma omp parallel for
    for (long i = 0; i < N; i++) {
        #pragma omp atomic
        sum += 1;            /* the bottleneck: one shared counter */
    }
    printf("sum=%ld on %d threads\\n", sum, omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "falsesharing",
    label: "False sharing",
    blurb: "Per-thread counters that share cache lines — watch scaling collapse, then fix it.",
    tryThis: "Run it (STRIDE 1): scaling collapses. Change STRIDE to 8 — one cache line per thread — and re-run to see it recover.",
    source: `/* False sharing: each thread bumps its OWN counter, but the counters sit next
   to each other and share 64-byte cache lines, so the cores fight over them.
   Change STRIDE from 1 to 8 (one cache line per thread) and re-run to see the fix. */
#include <stdio.h>
#include <omp.h>
#define STRIDE 1
int main(void) {
    static volatile long c[64 * 8];
    const long ITERS = 200000000;
    #pragma omp parallel
    {
        int t = omp_get_thread_num();
        for (long i = 0; i < ITERS; i++) c[t * STRIDE]++;
    }
    long s = 0; for (int i = 0; i < 64 * 8; i++) s += c[i];
    printf("sum=%ld on %d threads\\n", s, omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "schedule",
    label: "Load balancing (schedule)",
    blurb: "A triangular loop where late iterations cost more — static scheduling leaves cores idle; dynamic fixes it.",
    tryThis: "Run it with SCHED = static: speedup is mediocre because late threads get the heavy iterations. Change SCHED to dynamic and re-run — it jumps.",
    source: `/* Load imbalance: iteration i does work proportional to i (a triangular loop).
   With static scheduling, the thread handed the high-i chunk is swamped while the
   others finish early and idle. Change SCHED to dynamic (or guided) and re-run —
   idle threads steal the remaining heavy chunks and the speedup climbs. */
#include <stdio.h>
#include <omp.h>
#define SCHED static          /* try: dynamic, guided */
int main(void) {
    const int N = 2500;
    double total = 0.0;
    #pragma omp parallel for schedule(SCHED) reduction(+:total)
    for (int i = 0; i < N; i++) {
        double s = 0;
        for (long j = 0; j < (long)i * 100; j++) s += 1.0 / (double)(j + 1);
        total += s;
    }
    printf("total=%.3f on %d threads\\n", total, omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "collapse",
    label: "Nested loops (collapse)",
    blurb: "collapse(2) shares all N×N iterations across threads — the kernel behind the Heat Lab.",
    tryThis: "Run it. Now delete 'collapse(2)' and re-run: only the outer loop is split across threads, so it scales worse.",
    source: `/* collapse(2) merges the two loop nests into one N*N iteration space, so every
   inner iteration is shared across the team — not just the outer N. This is a
   Jacobi stencil sweep, the same kernel that powers the Heat Lab. */
#include <stdio.h>
#include <stdlib.h>
#include <omp.h>
int main(void) {
    const int N = 1024;
    double *u = malloc((long)N * N * 8), *v = malloc((long)N * N * 8);
    for (long i = 0; i < (long)N * N; i++) u[i] = (i % 97) * 0.01;
    for (int rep = 0; rep < 200; rep++) {
        #pragma omp parallel for collapse(2)
        for (int i = 1; i < N - 1; i++)
            for (int j = 1; j < N - 1; j++)
                v[i*N+j] = 0.25 * (u[(i-1)*N+j] + u[(i+1)*N+j] + u[i*N+j-1] + u[i*N+j+1]);
        double *t = u; u = v; v = t;
    }
    printf("u[mid]=%.5f on %d threads\\n", u[(N/2)*N + N/2], omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "histogram",
    label: "Private state (histogram)",
    blurb: "Each thread fills its own private bins, combined with an array reduction — no locks, no contention.",
    tryThis: "Run it. It scales because each thread owns a private copy of the bins; OpenMP merges them once at the end. No shared writes in the hot loop.",
    source: `/* Parallel histogram done right: reduction(+:hist[:BINS]) gives each thread a
   PRIVATE copy of the bin array, with no contention in the hot loop; the copies are
   summed once at the end. Sharing one global histogram would need a lock per bump. */
#include <stdio.h>
#include <omp.h>
#define BINS 16
int main(void) {
    const long N = 200000000;
    long hist[BINS] = {0};
    #pragma omp parallel for reduction(+:hist[:BINS])
    for (long i = 0; i < N; i++)
        hist[(i * 2654435761UL >> 28) & (BINS - 1)]++;   /* cheap hash -> a bin */
    long tot = 0; for (int b = 0; b < BINS; b++) tot += hist[b];
    printf("counted %ld into %d bins on %d threads\\n", tot, BINS, omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "simd",
    label: "Vectorize + threads (simd)",
    blurb: "parallel for simd uses both axes: threads across cores AND SIMD lanes within each core.",
    tryThis: "Run it. Then tick 'Profile cache misses' — a near-zero miss rate confirms it's compute-bound (the vector units, not memory, are the limit).",
    source: `/* #pragma omp parallel for simd taps BOTH forms of parallelism: threads across
   cores and SIMD lanes within each core. The Horner-form polynomial per element is
   enough arithmetic to keep the vector units busy, so this is compute-bound. */
#include <stdio.h>
#include <stdlib.h>
#include <omp.h>
int main(void) {
    const long N = 40000000;
    float *a = malloc(N * 4), *b = malloc(N * 4);
    for (long i = 0; i < N; i++) b[i] = (float)(i % 1000) * 0.001f;
    for (int r = 0; r < 30; r++)
        #pragma omp parallel for simd
        for (long i = 0; i < N; i++) {
            float x = b[i];
            a[i] = ((((0.1f*x + 0.2f)*x + 0.3f)*x + 0.4f)*x + 0.5f)*x + 0.6f;
        }
    printf("a[0]=%f on %d threads\\n", a[0], omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "triad",
    label: "Bandwidth (triad)",
    blurb: "STREAM triad over big arrays — memory-bound, so it stops scaling once DRAM saturates.",
    tryThis: "Run it. Speedup climbs then flattens — once DRAM bandwidth saturates, extra threads just wait on memory.",
    source: `/* STREAM triad a = b + s*c over arrays far larger than cache -> memory-bound.
   Adding threads helps until DRAM bandwidth saturates, then it flattens. */
#include <stdio.h>
#include <stdlib.h>
#include <omp.h>
int main(void) {
    const long N = 8000000;
    double *a = malloc(N * 8), *b = malloc(N * 8), *c = malloc(N * 8);
    for (long i = 0; i < N; i++) { b[i] = 1.0; c[i] = 2.0; }
    for (int r = 0; r < 20; r++)
        #pragma omp parallel for
        for (long i = 0; i < N; i++) a[i] = b[i] + 3.0 * c[i];
    printf("a[0]=%f on %d threads\\n", a[0], omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "matmul",
    label: "Cache locality (matmul)",
    blurb: "Naive matrix multiply — the inner loop strides through B by columns, so it misses cache. A locality lesson.",
    tryThis: "Tick 'Profile cache misses' and run — note the L1 miss rate. The ijk order strides through B badly; swapping the j and k loops (ikj) makes B contiguous.",
    source: `/* Naive matrix multiply C = A*B in ijk order. The innermost k loop walks DOWN a
   column of B (B[k*N+j]), striding by N each step -> poor locality, cache misses.
   Tick "Profile cache misses" to see it, then swap the j and k loops (ikj order)
   so the inner loop is contiguous and the miss rate drops. */
#include <stdio.h>
#include <stdlib.h>
#include <omp.h>
int main(void) {
    const int N = 512;
    double *A = malloc((long)N*N*8), *B = malloc((long)N*N*8), *C = calloc((long)N*N, 8);
    for (long i = 0; i < (long)N*N; i++) { A[i] = i % 13; B[i] = i % 7; }
    #pragma omp parallel for
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            double s = 0;
            for (int k = 0; k < N; k++) s += A[i*N+k] * B[k*N+j];
            C[i*N+j] = s;
        }
    printf("C[mid]=%.1f on %d threads\\n", C[(N/2)*N + N/2], omp_get_max_threads());
    return 0;
}
`,
  },
  {
    id: "tasks",
    label: "Recursive tasks (Fibonacci)",
    blurb: "OpenMP tasking: recursive Fibonacci spawns tasks that idle threads steal — parallelism a for-loop can't express.",
    tryThis: "Run it. The recursion spreads across cores via tasks. Lower the cutoff (e.g. 20) to create many tiny tasks and watch overhead eat the speedup.",
    source: `/* OpenMP tasking: parallel recursive Fibonacci. Each fib(n) spawns two tasks;
   idle threads in the team pick them up (work-stealing). A cutoff runs small n
   serially so tiny tasks don't drown in overhead. Tasking expresses irregular,
   recursive parallelism that a parallel-for cannot. */
#include <stdio.h>
#include <omp.h>
long fib(int n) {
    if (n < 2) return n;
    if (n < 29) return fib(n - 1) + fib(n - 2);   /* cutoff: run small n serially */
    long a, b;
    #pragma omp task shared(a)
    a = fib(n - 1);
    #pragma omp task shared(b)
    b = fib(n - 2);
    #pragma omp taskwait
    return a + b;
}
int main(void) {
    long r = 0;
    #pragma omp parallel
    #pragma omp single
    r = fib(41);
    printf("fib(41)=%ld on %d threads\\n", r, omp_get_max_threads());
    return 0;
}
`,
  },
];
