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

function buildResult(
  expId: string,
  params: Record<string, any>,
  timeOf: (p: number) => number,
  extra: Extra,
  source: "model" | "measured" = "model",
): ExperimentResult {
  const t1 = timeOf(1);
  const sweep: SweepPoint[] = range1(MAXP).map((p) => {
    const t = timeOf(p);
    const sp = t1 / t;
    return { x: p, time: t, speedup: sp, efficiency: sp / p };
  });
  const cur = sweep[clamp(params.threads, 1, MAXP) - 1];
  return {
    experimentId: expId,
    source,
    referenceMachine: REF.id,
    params,
    sweep,
    current: cur,
    metrics: [],
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
];

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
};
