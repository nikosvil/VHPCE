// Guess-the-Bottleneck: six archetypal scaling curves the student must identify.
// Each entry is self-contained: curve data + choices + answer + explanation.
// No gateway needed — all data is pre-generated from analytical models.

export type Choice   = { id: string; label: string };
export type Question = {
  id:      string;
  prompt:  string;
  context: string;
  curve:   { x: number; y: number }[];
  choices: Choice[];
  answer:  string;
  explain: string;
};

const T = [1, 2, 4, 8, 12, 16, 20, 24] as const;

// Amdahl's law  S(p) = 1 / (s + (1-s)/p)
const ahl = (s: number): { x: number; y: number }[] =>
  T.map((p) => ({ x: p, y: +(1 / (s + (1 - s) / p)).toFixed(2) }));

export const QUESTIONS: Question[] = [
  // ── 1. Near-perfect ────────────────────────────────────────────────────────
  {
    id: "perfect",
    prompt: "What does this scaling curve tell you?",
    context:
      "24 independent tasks — each thread works on a completely separate slice of a large array and never touches any shared data.",
    curve: T.map((p) => ({ x: p, y: +(p * (1 - 0.002 * (p - 1))).toFixed(2) })),
    choices: [
      { id: "perfect", label: "Near-perfect (embarrassingly parallel)" },
      { id: "amdahl",  label: "Serial fraction — Amdahl's law" },
      { id: "bw",      label: "Memory bandwidth saturation" },
      { id: "sync",    label: "Synchronization contention" },
    ],
    answer: "perfect",
    explain:
      "Near-linear speedup — every core does proportional useful work, with only minor scheduling overhead. No shared state, no synchronization, and the working set still fits in cache. This is the gold standard every parallel programmer aims for.",
  },

  // ── 2. Synchronization contention ──────────────────────────────────────────
  {
    id: "sync",
    prompt: "What does this scaling curve tell you?",
    context:
      "All 24 threads increment a single shared global counter on every loop iteration, each acquisition guarded by #pragma omp atomic.",
    curve: [
      { x:  1, y: 1.00 }, { x:  2, y: 1.04 }, { x:  4, y: 0.96 },
      { x:  8, y: 0.84 }, { x: 12, y: 0.78 }, { x: 16, y: 0.74 },
      { x: 20, y: 0.71 }, { x: 24, y: 0.69 },
    ],
    choices: [
      { id: "falsesh", label: "False sharing" },
      { id: "sync",    label: "Synchronization contention" },
      { id: "imbal",   label: "Load imbalance" },
      { id: "bw",      label: "Memory bandwidth saturation" },
    ],
    answer: "sync",
    explain:
      "Every core must queue for the lock on every iteration — queuing time grows faster than the work done. 24 threads on one atomic counter ends up slower than 1 thread alone. The fix is a reduction: each thread keeps a private partial sum and OpenMP combines them once at the end.",
  },

  // ── 3. Amdahl's law ────────────────────────────────────────────────────────
  {
    id: "amdahl",
    prompt: "What does this scaling curve tell you?",
    context:
      "The kernel has a setup phase that always runs on a single thread (file I/O + initialisation), then a fully parallel compute section. Past ~8 threads the speedup barely improves.",
    curve: ahl(0.10),
    choices: [
      { id: "bw",      label: "Memory bandwidth saturation" },
      { id: "amdahl",  label: "Serial fraction — Amdahl's law" },
      { id: "imbal",   label: "Load imbalance" },
      { id: "perfect", label: "Near-perfect scaling" },
    ],
    answer: "amdahl",
    explain:
      "The curve follows Amdahl's law with ~10% serial code: S(N) = 1 ∕ (0.10 + 0.90∕N). No matter how many cores you add, the serial 10% dominates — the theoretical ceiling is 10× regardless of core count. The only fix is to parallelize or eliminate the serial section.",
  },

  // ── 4. False sharing ───────────────────────────────────────────────────────
  {
    id: "falsesh",
    prompt: "What does this scaling curve tell you?",
    context:
      "Each thread writes only to its own counter — no logical sharing — but all counters are packed next to each other inside one 64-byte cache line.",
    curve: [
      { x:  1, y: 1.00 }, { x:  2, y: 1.62 }, { x:  4, y: 2.18 },
      { x:  8, y: 2.48 }, { x: 12, y: 2.31 }, { x: 16, y: 2.09 },
      { x: 20, y: 1.91 }, { x: 24, y: 1.74 },
    ],
    choices: [
      { id: "amdahl",  label: "Serial fraction — Amdahl's law" },
      { id: "falsesh", label: "False sharing" },
      { id: "perfect", label: "Near-perfect scaling" },
      { id: "sync",    label: "Synchronization contention" },
    ],
    answer: "falsesh",
    explain:
      "Initial gains look promising, but every write by one core invalidates the same cache line in every other core's L1 cache (MESI protocol). As thread count grows, this coherence traffic escalates and the speedup reverses. The fingerprint is a peak followed by degradation. Fix: pad each counter to its own cache line.",
  },

  // ── 5. Memory bandwidth saturation ────────────────────────────────────────
  {
    id: "bw",
    prompt: "What does this scaling curve tell you?",
    context:
      "A memory-intensive stencil kernel. Each thread streams through a large array — the working set is far too big to fit in any level of cache.",
    curve: [
      { x:  1, y: 1.00 }, { x:  2, y: 1.88 }, { x:  4, y: 3.45 },
      { x:  8, y: 3.78 }, { x: 12, y: 3.90 }, { x: 16, y: 3.94 },
      { x: 20, y: 3.97 }, { x: 24, y: 3.98 },
    ],
    choices: [
      { id: "imbal",   label: "Load imbalance" },
      { id: "sync",    label: "Synchronization contention" },
      { id: "bw",      label: "Memory bandwidth saturation" },
      { id: "amdahl",  label: "Serial fraction — Amdahl's law" },
    ],
    answer: "bw",
    explain:
      "DRAM bandwidth is shared across all cores — once ~3–4 cores saturate the memory bus, extra cores idle waiting for data. The flat ceiling at ~4× is the bandwidth wall, not a code quality issue. The Roofline model predicts exactly this. Fix: tiling or prefetching to reuse data from cache before adding more threads.",
  },

  // ── 6. Load imbalance ─────────────────────────────────────────────────────
  {
    id: "imbal",
    prompt: "What does this scaling curve tell you?",
    context:
      "A triangular loop: iteration i costs O(i²) work. The N iterations are divided into equal-sized static chunks — the last threads get the heaviest iterations.",
    curve: [
      { x:  1, y: 1.00 }, { x:  2, y: 1.71 }, { x:  4, y: 2.85 },
      { x:  8, y: 4.22 }, { x: 12, y: 5.10 }, { x: 16, y: 5.52 },
      { x: 20, y: 5.63 }, { x: 24, y: 5.65 },
    ],
    choices: [
      { id: "bw",      label: "Memory bandwidth saturation" },
      { id: "falsesh", label: "False sharing" },
      { id: "amdahl",  label: "Serial fraction — Amdahl's law" },
      { id: "imbal",   label: "Load imbalance" },
    ],
    answer: "imbal",
    explain:
      "With schedule(static), the last threads receive the heaviest iterations. Every other thread finishes and idles while the unlucky ones grind through the expensive tail — total runtime equals the slowest thread. Fix: schedule(dynamic) or schedule(guided) lets idle threads steal remaining work and balances the load.",
  },
];
