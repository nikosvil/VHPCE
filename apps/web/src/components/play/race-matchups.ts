// Head-to-head race matchups: two kernels that do the SAME work, differing only in technique,
// so racing their measured wall-times on the gateway makes "how you code it" visceral. The `b`
// side is always the better technique (the expected winner).

export type Racer = { label: string; source: string };
export type Matchup = { id: string; title: string; blurb: string; a: Racer; b: Racer };

const sum = (technique: "atomic" | "reduction") => `#include <stdio.h>
#include <omp.h>
int main(void) {
    const long N = 60000000;
    long sum = 0;
${technique === "atomic"
    ? `    #pragma omp parallel for
    for (long i = 0; i < N; i++) {
        #pragma omp atomic
        sum += (i & 1);           /* all threads serialize on one counter */
    }`
    : `    #pragma omp parallel for reduction(+:sum)
    for (long i = 0; i < N; i++)
        sum += (i & 1);           /* private partials, combined once */`}
    printf("sum=%ld on %d threads\\n", sum, omp_get_max_threads());
    return 0;
}
`;

const falseSharing = (stride: number) => `#include <stdio.h>
#include <omp.h>
#define STRIDE ${stride}
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
`;

const schedule = (kind: "static" | "dynamic") => `#include <stdio.h>
#include <omp.h>
int main(void) {
    const int N = 2500;
    double total = 0.0;
    #pragma omp parallel for schedule(${kind}) reduction(+:total)
    for (int i = 0; i < N; i++) {
        double s = 0;
        for (long j = 0; j < (long)i * 100; j++) s += 1.0 / (double)(j + 1);
        total += s;
    }
    printf("total=%.3f on %d threads\\n", total, omp_get_max_threads());
    return 0;
}
`;

export const MATCHUPS: Matchup[] = [
  {
    id: "sum",
    title: "Sum 60 million values",
    blurb: "Same loop, same total. One funnels every add through a shared counter with #pragma omp atomic; the other gives each thread a private partial via reduction.",
    a: { label: "atomic", source: sum("atomic") },
    b: { label: "reduction", source: sum("reduction") },
  },
  {
    id: "falsesharing",
    title: "Per-thread counters",
    blurb: "Each thread bumps its own counter. On the left they're packed together (STRIDE 1) and fight over cache lines; on the right each gets its own line (STRIDE 8).",
    a: { label: "shared line (stride 1)", source: falseSharing(1) },
    b: { label: "own line (stride 8)", source: falseSharing(8) },
  },
  {
    id: "schedule",
    title: "Imbalanced triangular loop",
    blurb: "Late iterations cost more. Static scheduling hands out fixed chunks up front (some threads idle); dynamic lets idle threads steal the remaining heavy work.",
    a: { label: "schedule(static)", source: schedule("static") },
    b: { label: "schedule(dynamic)", source: schedule("dynamic") },
  },
];
