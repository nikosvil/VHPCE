/**
 * @vhpce/perf-models — Producer A. Physically-grounded models (docs/04) plus the
 * measured-data adapters (Producer B). Both emit the same ExperimentResult shape,
 * so charts/explainers don't care where the numbers came from.
 */
import {
  type ExperimentResult,
  type SweepPoint,
  type RunnerData,
  fmt,
  clamp,
} from "@vhpce/profile-schema";

export const MAXP = 24;
export const REF = { id: "ref/this-laptop-24c", cores: 24, cacheLine: 64, BW_peak: 40, P_peak: 200, p_half: 3 };
export const TRIAD_AI = 2 / 24; // triad: 2 FLOPs per 24 bytes moved

const range1 = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

type Extra = (cur: SweepPoint, sweep: SweepPoint[]) => Partial<ExperimentResult>;
type BuildOpts = { scaling?: "strong" | "weak"; xUnits?: "threads" | "ranks" };

function buildResult(
  expId: string,
  params: Record<string, any>,
  timeOf: (p: number) => number,
  extra: Extra,
  source: "model" | "measured" = "model",
  opts: BuildOpts = {},
): ExperimentResult {
  const scaling = opts.scaling ?? "strong";
  const xUnits = opts.xUnits ?? "threads";
  const t1 = timeOf(1);
  const sweep: SweepPoint[] = range1(MAXP).map((p) => {
    const t = timeOf(p);
    const ratio = t1 / t;
    // Strong scaling (fixed work): speedup = t1/t(p). Weak scaling (work grows ∝ p):
    // the meaningful metrics are *scaled* speedup p·t1/t(p) and efficiency t1/t(p),
    // both of which still render against the y=x ideal and the right-axis efficiency.
    const speedup = scaling === "weak" ? p * ratio : ratio;
    const efficiency = scaling === "weak" ? ratio : ratio / p;
    return { x: p, time: t, speedup, efficiency };
  });
  const xparam = params.ranks ?? params.threads;
  const cur = sweep[clamp(xparam, 1, MAXP) - 1];
  return {
    experimentId: expId,
    source,
    referenceMachine: REF.id,
    params,
    sweep,
    current: cur,
    metrics: [],
    xUnits,
    ...extra(cur, sweep),
  };
}

export const SYNC: Record<string, { label: string; f: number; cont: number }> = {
  reduction: { label: "reduction", f: 0.01, cont: 0.0 },
  atomic: { label: "atomic", f: 0.08, cont: 0.5 },
  critical: { label: "critical", f: 0.3, cont: 1.0 },
};
export const SCHED: Record<string, { label: string }> = {
  static: { label: "static" },
  guided: { label: "guided" },
  dynamic: { label: "dynamic" },
};

export const EXPERIMENTS = [
  { id: "falseSharing", name: "False Sharing", scene: "cache lines · coherence ping-pong" },
  { id: "synchronization", name: "Synchronization", scene: "thread timeline · lock serialization" },
  { id: "bandwidth", name: "Bandwidth Saturation", scene: "memory bus · roofline" },
  { id: "imbalance", name: "Load Imbalance", scene: "thread timeline · idle tails" },
  { id: "mpiHalo", name: "MPI Halo Exchange", scene: "ranks · halo exchange · comm wall" },
  { id: "cuda", name: "GPU Occupancy", scene: "warps · SMs · register pressure" },
  { id: "cudaCoalesce", name: "GPU Coalescing", scene: "warp · memory transactions" },
  { id: "cudaDivergence", name: "GPU Divergence", scene: "warp · serialized branch paths" },
];

export const GPU_SWEEP = [1, 2, 4, 8, 16, 32];

// MPI halo model: compute that scales with ranks + a communication term that grows ~log(ranks).
export const HALO = { T1: 1000, Tc0: 8, Tc1: 18 };

/* ---- GPU occupancy model (the standard CUDA Occupancy Calculator) ---- */
export const CUDA_BLOCKS = Array.from({ length: 32 }, (_, i) => (i + 1) * 32); // 32..1024 step 32
export const REF_GPU = {
  name: "RTX 5060 Laptop (model)",
  warpSize: 32, maxWarpsPerSM: 48, regsPerSM: 65536, maxBlocksPerSM: 32, maxThreadsPerBlock: 1024,
  regsLight: 32, regsHeavy: 128,
};

// Active warps/SM and the binding limiter for a block of B threads using R registers/thread.
function cudaOccupancy(B: number, R: number): { occ: number; limiter: string } {
  const wpb = Math.ceil(B / REF_GPU.warpSize);
  const regsPerWarp = Math.ceil((R * REF_GPU.warpSize) / 256) * 256; // 256-reg warp granularity
  const regLimit = Math.floor(REF_GPU.regsPerSM / (regsPerWarp * wpb));
  const warpLimit = Math.floor(REF_GPU.maxWarpsPerSM / wpb);
  const active = Math.max(0, Math.min(regLimit, warpLimit, REF_GPU.maxBlocksPerSM));
  const occ = Math.min(1, (active * wpb) / REF_GPU.maxWarpsPerSM);
  let limiter = "none (full)";
  if (occ < 0.99) {
    if (regLimit <= warpLimit && regLimit <= REF_GPU.maxBlocksPerSM) limiter = "registers";
    else if (REF_GPU.maxBlocksPerSM <= warpLimit) limiter = "block count";
    else limiter = "block size";
  }
  return { occ, limiter };
}

/* ===================== Producer A — models ===================== */
export const Models: Record<string, (p: any) => ExperimentResult> = {
  falseSharing(params) {
    const { padded, intensity } = params;
    const T1 = 1000;
    const kCoh = padded ? 0 : 20 + intensity * 20;
    const timeOf = (p: number) => T1 / p + kCoh * (p - 1) + 0.5;
    return buildResult("falseSharing", params, timeOf, (cur, sw) => {
      const peak = sw.reduce((a, b) => (b.speedup > a.speedup ? b : a), sw[0]);
      const coh = kCoh * (cur.x - 1);
      const cohPct = (coh / cur.time) * 100;
      return {
        peak,
        coh,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: padded ? "good" : "bad" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.speedup > cur.x * 0.7 ? "good" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.4 ? "warn" : "bad" },
          { k: "Coherence stall", v: fmt(cohPct, 0) + "%", tone: cohPct < 5 ? "good" : cohPct < 40 ? "warn" : "bad" },
          { k: "Peak speedup", v: fmt(peak.speedup, 1) + "× @ " + peak.x + "t", tone: "accent" },
        ],
      };
    });
  },
  synchronization(params) {
    const m = SYNC[params.mode];
    const T1 = 1000, tcrit = 0.5;
    const timeOf = (p: number) => T1 * ((1 - m.f) / p + m.f) + m.cont * (p - 1) * tcrit;
    return buildResult("synchronization", params, timeOf, (cur) => {
      const ceiling = 1 / m.f;
      return {
        ceiling,
        serialPct: m.f * 100,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: params.mode === "reduction" ? "good" : params.mode === "atomic" ? "warn" : "bad" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.4 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.4 ? "warn" : "bad" },
          { k: "Serialized", v: fmt(m.f * 100, 0) + "%", tone: m.f < 0.05 ? "good" : m.f < 0.15 ? "warn" : "bad" },
          { k: "Amdahl ceiling", v: fmt(ceiling, 1) + "×", tone: "accent" },
        ],
      };
    });
  },
  bandwidth(params) {
    const { ai } = params, T1 = 1000;
    const bwEff = (p: number) => REF.BW_peak * (p / (p + REF.p_half));
    const timeOf = (p: number) => T1 / (bwEff(p) / bwEff(1));
    return buildResult("bandwidth", params, timeOf, (cur) => {
      const bw = bwEff(cur.x), util = bw / REF.BW_peak;
      const gf = Math.min(REF.P_peak, ai * bw), ridge = REF.P_peak / REF.BW_peak;
      const bound = ai < ridge ? "Memory" : "Compute";
      return {
        bw, util, gf, ridge, bound,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: "warn" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.4 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.5 ? "warn" : "bad" },
          { k: "Achieved BW", v: fmt(bw, 1) + " GB/s", tone: util > 0.9 ? "bad" : "warn" },
          { k: "BW utilization", v: fmt(util * 100, 0) + "%", tone: util > 0.9 ? "bad" : util > 0.7 ? "warn" : "good" },
          { k: "Performance", v: fmt(gf, 0) + " GFLOP/s", tone: "accent" },
          { k: "Bound by", v: bound, tone: bound === "Memory" ? "bad" : "good" },
        ],
      };
    });
  },
  imbalance(params) {
    const T1 = 1000, sched = params.sched;
    const factor = (p: number) => (sched === "static" ? 2 - 1 / p : sched === "guided" ? 1 + 0.15 * (1 - 1 / p) : 1.05);
    const ovh = (p: number) => (sched === "dynamic" ? 0.4 * p : sched === "guided" ? 0.18 * p : 0);
    const timeOf = (p: number) => (T1 / p) * factor(p) + ovh(p);
    return buildResult("imbalance", params, timeOf, (cur) => {
      const I = factor(cur.x), idlePct = (1 - 1 / I) * 100;
      return {
        factor: I,
        idlePct,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: sched === "static" ? "bad" : "good" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.45 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.45 ? "warn" : "bad" },
          { k: "Imbalance factor", v: fmt(I, 2) + "×", tone: I < 1.1 ? "good" : I < 1.4 ? "warn" : "bad" },
          { k: "Cores idle", v: fmt(idlePct, 0) + "%", tone: idlePct < 10 ? "good" : idlePct < 30 ? "warn" : "bad" },
        ],
      };
    });
  },
  mpiHalo(params) {
    const weak = params.mode === "weak";
    const comm = (p: number) => HALO.Tc0 + HALO.Tc1 * Math.log2(p || 1);
    const compute = (p: number) => (weak ? HALO.T1 : HALO.T1 / p); // weak: fixed work per rank
    const timeOf = (p: number) => compute(p) + comm(p);
    return buildResult("mpiHalo", params, timeOf, (cur, sw) => {
      const commPct = (comm(cur.x) / cur.time) * 100;
      const peak = sw.reduce((a, b) => (b.speedup > a.speedup ? b : a), sw[0]);
      return {
        peak,
        idlePct: commPct,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: weak ? "good" : "warn" },
          { k: weak ? "Scaled speedup" : "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.4 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.7 ? "good" : cur.efficiency > 0.4 ? "warn" : "bad" },
          { k: "Comm fraction", v: fmt(commPct, 0) + "%", tone: commPct < 15 ? "good" : commPct < 40 ? "warn" : "bad" },
          weak
            ? { k: "Ideal (linear)", v: cur.x + "×", tone: "accent" }
            : { k: "Comm wall", v: "≈ " + fmt(peak.speedup, 1) + "×", tone: "accent" },
        ],
      };
    }, "model", { scaling: weak ? "weak" : "strong", xUnits: "ranks" });
  },
  cuda(params) {
    const R = params.variant === "heavy" ? REF_GPU.regsHeavy : REF_GPU.regsLight;
    let sweep: SweepPoint[] = CUDA_BLOCKS.map((B) => {
      const { occ } = cudaOccupancy(B, R);
      const smallPenalty = B < 128 ? (128 - B) / 320 : 0;        // tiny blocks under-hide latency
      const throughput = Math.max(0.05, occ) * (1 - smallPenalty);
      return { x: B, time: 100 / throughput, speedup: throughput, efficiency: occ, occ };
    });
    const bestPerf = Math.max(...sweep.map((s) => s.speedup));
    sweep = sweep.map((s) => ({ ...s, speedup: s.speedup / bestPerf }));
    const cur = sweep.find((s) => s.x === params.blockSize) || sweep[sweep.length - 1];
    const optimal = sweep.reduce((a, b) => ((b.occ ?? 0) > (a.occ ?? 0) ? b : a), sweep[0]);
    const { limiter } = cudaOccupancy(cur.x, R);
    return {
      experimentId: "cuda", source: "model", referenceMachine: REF.id, params,
      sweep, current: cur, xUnits: "block",
      occupancy: cur.occ, limiter, regsPerThread: R, optimalBlock: optimal.x, smName: REF_GPU.name,
      metrics: [
        { k: "Occupancy", v: fmt((cur.occ ?? 0) * 100, 0) + "%", tone: (cur.occ ?? 0) > 0.66 ? "good" : (cur.occ ?? 0) > 0.4 ? "warn" : "bad" },
        { k: "Threads/block", v: String(cur.x), tone: "" },
        { k: "Active warps/SM", v: fmt((cur.occ ?? 0) * REF_GPU.maxWarpsPerSM, 0) + " / " + REF_GPU.maxWarpsPerSM, tone: "" },
        { k: "Registers/thread", v: String(R), tone: R > 64 ? "bad" : "good" },
        { k: "Limiter", v: limiter, tone: limiter === "registers" ? "bad" : limiter.startsWith("none") ? "good" : "warn" },
        { k: "Best @ block", v: optimal.x + " (" + fmt((optimal.occ ?? 0) * 100, 0) + "%)", tone: "accent" },
      ],
    } as ExperimentResult;
  },
  cudaCoalesce(params) {
    const peak = 220; // illustrative model peak GB/s; the lesson is the relative collapse
    const sweep: SweepPoint[] = GPU_SWEEP.map((S) => {
      const eff = 1 / S;                       // coalescing efficiency ≈ 1 / stride
      return { x: S, time: S, speedup: eff, efficiency: eff };
    });
    const cur = sweep.find((s) => s.x === params.stride) || sweep[0];
    const bw = peak * cur.efficiency;
    return {
      experimentId: "cudaCoalesce", source: "model", referenceMachine: REF.id, params,
      sweep, current: cur, xLabel: "stride — elements between adjacent threads", bw, util: cur.efficiency,
      metrics: [
        { k: "Stride", v: cur.x + (cur.x === 1 ? " (coalesced)" : ""), tone: cur.x === 1 ? "good" : cur.x <= 4 ? "warn" : "bad" },
        { k: "Achieved BW", v: fmt(bw, 0) + " GB/s", tone: cur.efficiency > 0.6 ? "good" : cur.efficiency > 0.3 ? "warn" : "bad" },
        { k: "Coalescing efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.6 ? "good" : cur.efficiency > 0.3 ? "warn" : "bad" },
        { k: "Bandwidth wasted", v: fmt((1 - cur.efficiency) * 100, 0) + "%", tone: 1 - cur.efficiency < 0.3 ? "good" : "bad" },
        { k: "Best", v: "stride 1", tone: "accent" },
      ],
    } as ExperimentResult;
  },
  cudaDivergence(params) {
    const sweep: SweepPoint[] = GPU_SWEEP.map((D) => ({ x: D, time: D, speedup: 1 / D, efficiency: 1 / D }));
    const cur = sweep.find((s) => s.x === params.paths) || sweep[0];
    const slowdown = 1 / cur.efficiency, active = cur.efficiency * 100;
    return {
      experimentId: "cudaDivergence", source: "model", referenceMachine: REF.id, params,
      sweep, current: cur, xLabel: "divergent branch paths taken within the warp", util: cur.efficiency, factor: slowdown,
      metrics: [
        { k: "Divergent paths", v: cur.x + (cur.x === 1 ? " (uniform)" : ""), tone: cur.x === 1 ? "good" : cur.x <= 4 ? "warn" : "bad" },
        { k: "Warp slowdown", v: fmt(slowdown, 1) + "×", tone: slowdown < 2 ? "good" : slowdown < 8 ? "warn" : "bad" },
        { k: "Active lanes (avg)", v: fmt(active, 0) + "%", tone: active > 50 ? "good" : active > 20 ? "warn" : "bad" },
        { k: "Lanes idled", v: fmt(100 - active, 0) + "%", tone: 100 - active < 30 ? "good" : "bad" },
        { k: "Best", v: "uniform (1 path)", tone: "accent" },
      ],
    } as ExperimentResult;
  },
};

/* ===================== Producer B — measured adapters ===================== */
export function runnerSpec(exp: string, p: any): { bexp: string; variant: string } {
  if (exp === "falseSharing") return { bexp: "falsesharing", variant: p.padded ? "padded" : "shared" };
  if (exp === "synchronization") return { bexp: "sync", variant: p.mode };
  if (exp === "bandwidth") return { bexp: "bandwidth", variant: "triad" };
  return { bexp: "imbalance", variant: p.sched };
}

const tLookup = (data: RunnerData) => (p: number) => data.points[clamp(p, 1, data.points.length) - 1].ms;

export const Measured: Record<string, (p: any, data: RunnerData) => ExperimentResult> = {
  falseSharing(params, data) {
    return buildResult("falseSharing", params, tLookup(data), (cur, sw) => {
      const peak = sw.reduce((a, b) => (b.speedup > a.speedup ? b : a), sw[0]);
      const loss = (1 - cur.efficiency) * 100;
      return {
        peak, coh: 0,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: params.padded ? "good" : "bad" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.6 ? "good" : cur.efficiency > 0.35 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.6 ? "good" : cur.efficiency > 0.35 ? "warn" : "bad" },
          { k: "Cores wasted", v: fmt(loss, 0) + "%", tone: loss < 25 ? "good" : loss < 55 ? "warn" : "bad" },
          { k: "Peak speedup", v: fmt(peak.speedup, 1) + "× @ " + peak.x + "t", tone: "accent" },
        ],
      };
    }, "measured");
  },
  synchronization(params, data) {
    return buildResult("synchronization", params, tLookup(data), (cur, sw) => {
      const fastest = sw.reduce((a, b) => (b.time < a.time ? b : a), sw[0]);
      return {
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: params.mode === "reduction" ? "good" : "bad" },
          { k: "Speedup", v: fmt(cur.speedup, 2) + "×", tone: cur.efficiency > 0.55 ? "good" : cur.speedup >= 1 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.55 ? "good" : cur.efficiency > 0.25 ? "warn" : "bad" },
          { k: "Fastest at", v: fastest.x + " thread" + (fastest.x > 1 ? "s" : ""), tone: fastest.x >= 12 ? "good" : "bad" },
        ],
      };
    }, "measured");
  },
  bandwidth(params, data) {
    const mp = { ...params, ai: TRIAD_AI };
    return buildResult("bandwidth", mp, tLookup(data), (cur, sw) => {
      const pt = data.points[clamp(cur.x, 1, data.points.length) - 1];
      const peakBW = Math.max(...data.points.map((p) => p.gbps || 0));
      const peakSp = sw.reduce((a, b) => Math.max(a, b.speedup), 0);
      const sat = (sw.find((s) => s.speedup >= 0.95 * peakSp) || { x: cur.x }).x;
      const bw = pt.gbps || 0, gf = pt.gflops || 0, util = peakBW ? bw / peakBW : 0;
      return {
        bw, gf, util, peakBW, peakCompute: REF.P_peak, ridge: REF.P_peak / (peakBW || REF.BW_peak),
        peakSpeedup: peakSp, satThreads: sat, bound: "Memory",
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: "warn" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.x > 8 && cur.speedup > peakSp * 0.9 ? "bad" : "warn" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: "bad" },
          { k: "Achieved BW", v: fmt(bw, 1) + " GB/s", tone: util > 0.9 ? "bad" : "warn" },
          { k: "BW utilization", v: fmt(util * 100, 0) + "%", tone: util > 0.9 ? "bad" : util > 0.7 ? "warn" : "good" },
          { k: "Performance", v: fmt(gf, 2) + " GFLOP/s", tone: "accent" },
          { k: "Peak BW (meas.)", v: fmt(peakBW, 1) + " GB/s", tone: "accent" },
        ],
      };
    }, "measured");
  },
  imbalance(params, data) {
    return buildResult("imbalance", params, tLookup(data), (cur) => {
      const factor = cur.efficiency > 0 ? 1 / cur.efficiency : 99, idle = (1 - cur.efficiency) * 100;
      return {
        factor, idlePct: idle,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: params.sched === "static" ? "bad" : "good" },
          { k: "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.55 ? "good" : cur.efficiency > 0.3 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.55 ? "good" : cur.efficiency > 0.3 ? "warn" : "bad" },
          { k: "Imbalance factor", v: fmt(factor, 2) + "×", tone: factor < 1.4 ? "good" : factor < 2.5 ? "warn" : "bad" },
          { k: "Cores idle", v: fmt(idle, 0) + "%", tone: idle < 25 ? "good" : idle < 55 ? "warn" : "bad" },
        ],
      };
    }, "measured");
  },
  mpiHalo(params, data) {
    const weak = params.mode === "weak";
    return buildResult("mpiHalo", params, tLookup(data), (cur, sw) => {
      const peak = sw.reduce((a, b) => (b.speedup > a.speedup ? b : a), sw[0]);
      const lost = Math.max(0, (1 - cur.efficiency) * 100); // gap to ideal = overhead/comm
      return {
        peak,
        idlePct: lost,
        metrics: [
          { k: "Wall time", v: fmt(cur.time, 0) + " ms", tone: weak ? "good" : "warn" },
          { k: weak ? "Scaled speedup" : "Speedup", v: fmt(cur.speedup, 1) + "×", tone: cur.efficiency > 0.6 ? "good" : cur.efficiency > 0.35 ? "warn" : "bad" },
          { k: "Efficiency", v: fmt(cur.efficiency * 100, 0) + "%", tone: cur.efficiency > 0.6 ? "good" : cur.efficiency > 0.35 ? "warn" : "bad" },
          { k: weak ? "Overhead" : "Lost to comm", v: fmt(lost, 0) + "%", tone: lost < 20 ? "good" : lost < 50 ? "warn" : "bad" },
          weak
            ? { k: "Ideal (linear)", v: cur.x + "×", tone: "accent" }
            : { k: "Peak speedup", v: fmt(peak.speedup, 1) + "× @ " + peak.x + "r", tone: "accent" },
        ],
      };
    }, "measured", { scaling: weak ? "weak" : "strong", xUnits: "ranks" });
  },
  cuda(params, data) {
    const meta = data as RunnerData & { regs?: number; sm?: string; maxWarpsPerSM?: number };
    const pts = data.points;
    const perfOf = (p: typeof pts[number]) => p.gflops ?? 1 / (p.ms || 1);
    const bestPerf = Math.max(...pts.map(perfOf));
    let sweep: SweepPoint[] = pts.map((pt) => ({
      x: pt.p, time: pt.ms, speedup: perfOf(pt) / bestPerf, efficiency: pt.occ ?? 0, occ: pt.occ ?? 0,
    }));
    const cur = sweep.find((s) => s.x === params.blockSize) || sweep[sweep.length - 1];
    const curPt = pts[sweep.indexOf(cur)] ?? pts[pts.length - 1];
    const optimal = sweep.reduce((a, b) => ((b.occ ?? 0) > (a.occ ?? 0) ? b : a), sweep[0]);
    const maxWarps = meta.maxWarpsPerSM ?? 48, regs = meta.regs ?? 0, occ = cur.occ ?? 0;
    // Structural warp limit for this block size; if achieved occ falls short of it, registers/shared cap it.
    const wpb = Math.max(1, Math.ceil(cur.x / 32));
    const warpLimited = Math.min(1, (Math.floor(maxWarps / wpb) * wpb) / maxWarps);
    const limiter = occ >= 0.99 ? "none (full)" : occ >= warpLimited - 0.02 ? "block size" : "registers";
    return {
      experimentId: "cuda", source: "measured", referenceMachine: REF.id, params,
      sweep, current: cur, xUnits: "block",
      occupancy: occ, limiter, regsPerThread: regs, optimalBlock: optimal.x, smName: meta.sm, gflops: curPt.gflops,
      metrics: [
        { k: "Occupancy", v: fmt(occ * 100, 0) + "%", tone: occ > 0.66 ? "good" : occ > 0.4 ? "warn" : "bad" },
        { k: "Threads/block", v: String(cur.x), tone: "" },
        { k: "Registers/thread", v: regs ? String(regs) : "—", tone: regs > 64 ? "bad" : "good" },
        { k: "Performance", v: fmt(curPt.gflops ?? 0, 0) + " GFLOP/s", tone: "accent" },
        { k: "Limiter", v: limiter, tone: limiter === "registers" ? "bad" : limiter.startsWith("none") ? "good" : "warn" },
        { k: "Best @ block", v: optimal.x + " (" + fmt((optimal.occ ?? 0) * 100, 0) + "%)", tone: "accent" },
      ],
    } as ExperimentResult;
  },
  cudaCoalesce(params, data) {
    const meta = data as RunnerData & { sm?: string };
    const pts = data.points;
    const peak = Math.max(...pts.map((p) => p.gbps ?? 0)) || 1;
    const sweep: SweepPoint[] = pts.map((pt) => ({ x: pt.p, time: pt.ms, speedup: (pt.gbps ?? 0) / peak, efficiency: (pt.gbps ?? 0) / peak }));
    const cur = sweep.find((s) => s.x === params.stride) || sweep[0];
    const curPt = pts[sweep.indexOf(cur)] ?? pts[0];
    const bw = curPt.gbps ?? 0, eff = cur.efficiency;
    return {
      experimentId: "cudaCoalesce", source: "measured", referenceMachine: REF.id, params,
      sweep, current: cur, xLabel: "stride — elements between adjacent threads", bw, util: eff, smName: meta.sm,
      metrics: [
        { k: "Stride", v: cur.x + (cur.x === 1 ? " (coalesced)" : ""), tone: cur.x === 1 ? "good" : cur.x <= 4 ? "warn" : "bad" },
        { k: "Achieved BW", v: fmt(bw, 0) + " GB/s", tone: eff > 0.6 ? "good" : eff > 0.3 ? "warn" : "bad" },
        { k: "vs coalesced", v: fmt(eff * 100, 0) + "%", tone: eff > 0.6 ? "good" : eff > 0.3 ? "warn" : "bad" },
        { k: "Bandwidth wasted", v: fmt((1 - eff) * 100, 0) + "%", tone: 1 - eff < 0.3 ? "good" : "bad" },
        { k: "Peak (meas.)", v: fmt(peak, 0) + " GB/s", tone: "accent" },
      ],
    } as ExperimentResult;
  },
  cudaDivergence(params, data) {
    const meta = data as RunnerData & { sm?: string };
    const pts = data.points;
    const t1 = pts[0]?.ms || 1;
    const sweep: SweepPoint[] = pts.map((pt) => ({ x: pt.p, time: pt.ms, speedup: t1 / pt.ms, efficiency: t1 / pt.ms }));
    const cur = sweep.find((s) => s.x === params.paths) || sweep[0];
    const slowdown = 1 / Math.max(cur.efficiency, 1e-6), active = cur.efficiency * 100;
    const curPt = pts[sweep.indexOf(cur)] ?? pts[0];
    return {
      experimentId: "cudaDivergence", source: "measured", referenceMachine: REF.id, params,
      sweep, current: cur, xLabel: "divergent branch paths taken within the warp", util: cur.efficiency, factor: slowdown, smName: meta.sm,
      metrics: [
        { k: "Divergent paths", v: cur.x + (cur.x === 1 ? " (uniform)" : ""), tone: cur.x === 1 ? "good" : cur.x <= 4 ? "warn" : "bad" },
        { k: "Warp slowdown", v: fmt(slowdown, 1) + "×", tone: slowdown < 2 ? "good" : slowdown < 8 ? "warn" : "bad" },
        { k: "Kernel time", v: fmt(curPt?.ms ?? 0, 2) + " ms", tone: "" },
        { k: "Active lanes (avg)", v: fmt(active, 0) + "%", tone: active > 50 ? "good" : active > 20 ? "warn" : "bad" },
        { k: "Lanes idled", v: fmt(100 - active, 0) + "%", tone: 100 - active < 30 ? "good" : "bad" },
      ],
    } as ExperimentResult;
  },
};
