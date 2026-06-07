// Curated, ready-to-run OpenMP C examples for the Playground. Lets a beginner run real
// parallel code without writing any — and gives the /learn cards something concrete to
// link to ("▶ Run it in the Playground"). Each does enough work that the thread sweep is
// meaningful (~100 ms+). Note: printf newlines are escaped as \\n so the C source keeps a
// literal \n (the surrounding TS template would otherwise insert a real newline).

export type Example = { id: string; label: string; blurb: string; source: string };

export const EXAMPLES: Example[] = [
  {
    id: "reduction",
    label: "Parallel sum",
    blurb: "A parallel-for reduction — the safe, scalable way to combine per-thread partials.",
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
    id: "hello",
    label: "Hello, threads",
    blurb: "The simplest parallel region: every thread runs the block and prints its id.",
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
    id: "falsesharing",
    label: "False sharing",
    blurb: "Per-thread counters that share cache lines — watch scaling collapse, then fix it.",
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
    id: "sync",
    label: "Sync cost (atomic)",
    blurb: "Accumulate with #pragma omp atomic — every iteration serializes on one update, so it barely scales (or gets slower).",
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
    id: "triad",
    label: "Bandwidth (triad)",
    blurb: "STREAM triad over big arrays — memory-bound, so it stops scaling once DRAM saturates.",
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
];
