/**
 * @vhpce/profile-schema — the single seam every consumer renders from.
 * See docs/06-data-contracts.md. Producers: @vhpce/perf-models (model) and the
 * WSL runner (measured). Consumers: charts, the canvas scenes, and the explainers.
 */
export type Source = "model" | "measured";
export type Tone = "good" | "warn" | "bad" | "accent" | "";

export interface SweepPoint {
  /** degree of parallelism (threads/ranks) */
  x: number;
  /** wall time in ms */
  time: number;
  /** speedup vs x=1 */
  speedup: number;
  /** speedup / x */
  efficiency: number;
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
}

/** Runner payload shape (Producer B). */
export interface RunnerPoint {
  p: number;
  ms: number;
  gbps?: number;
  gflops?: number;
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
