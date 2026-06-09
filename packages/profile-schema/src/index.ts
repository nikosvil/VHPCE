/**
 * @vhpce/profile-schema — the single seam every consumer renders from.
 * See docs/06-data-contracts.md. Producers: @vhpce/perf-models (model) and the
 * WSL runner (measured). Consumers: charts, the canvas scenes, and the explainers.
 */
export type Source = "model" | "measured";
export type Tone = "good" | "warn" | "bad" | "accent" | "";

export interface SweepPoint {
  /** degree of parallelism (threads/ranks) or, for GPU, threads-per-block */
  x: number;
  /** wall time in ms */
  time: number;
  /** speedup vs x=1 */
  speedup: number;
  /** speedup / x */
  efficiency: number;
  /** GPU achieved occupancy (0..1), populated by the cuda experiment */
  occ?: number;
}

export interface Metric {
  k: string;
  v: string;
  tone?: Tone;
}

export interface Explanation {
  sev: "info" | "warn" | "critical";
  what: string;
  why: string;
  how: string;
  exp: string;
}

/**
 * The flagship's working shape — a focused subset of the full ProfileResult
 * (docs/06) carrying the scaling sweep plus experiment-specific extras the
 * charts and explainers read.
 */
export interface ExperimentResult {
  experimentId: string;
  source: Source;
  referenceMachine: string;
  params: Record<string, any>;
  sweep: SweepPoint[];
  current: SweepPoint;
  metrics: Metric[];
  /** x-axis unit for the sweep — "threads" (OpenMP), "ranks" (MPI), or "block" (GPU). Defaults to threads. */
  xUnits?: "threads" | "ranks" | "block";
  /** free-form x-axis label for the generic GPU sweep chart (e.g. "stride", "divergent paths"). */
  xLabel?: string;
  /** optional sweep x to highlight on the scaling chart (the Playground's thread-count explorer). */
  focusX?: number;

  // experiment-specific extras (optional; populated per experiment)
  peak?: SweepPoint;
  coh?: number;
  ceiling?: number;
  serialPct?: number;
  bw?: number;
  util?: number;
  gf?: number;
  ridge?: number;
  bound?: string;
  peakBW?: number;
  peakCompute?: number;
  peakSpeedup?: number;
  satThreads?: number;
  factor?: number;
  idlePct?: number;

  // GPU occupancy (cuda) extras
  occupancy?: number;       // achieved occupancy (0..1) at the current block size
  limiter?: string;         // what caps occupancy: "registers" | "block size" | "warps/SM" | "none"
  regsPerThread?: number;
  optimalBlock?: number;    // block size with the best occupancy in the sweep
  smName?: string;          // device name (measured)
  gflops?: number;
}

/** Runner payload shape (Producer B). */
export interface RunnerPoint {
  p: number;
  ms: number;
  gbps?: number;
  gflops?: number;
  occ?: number;   // GPU achieved occupancy (0..1), from the cuda runner
}
export interface RunnerData {
  exp: string;
  variant: string;
  source: "measured";
  cores?: number;
  points: RunnerPoint[];
}

// ---- shared formatting/util helpers (used by perf-models + explain) ----
export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

export const fmt = (x: number, d = 1): string => {
  if (!isFinite(x)) return "—";
  const f = Math.pow(10, d);
  return (Math.round(x * f) / f).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};
