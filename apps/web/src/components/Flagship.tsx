"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AskAI from "./AskAI";
import {
  Models, Measured, runnerSpec, EXPERIMENTS, MAXP, TRIAD_AI,
  SIMD_WIDTHS, BANK_STRIDES,
} from "@vhpce/perf-models";
import { Explain, ExplainMeasured } from "@vhpce/explain";
import { drawScaling, drawRoofline, drawOccupancy, drawSweep, scenes } from "@vhpce/viz";
import { fmt, type ExperimentResult, type RunnerData, type Explanation } from "@vhpce/profile-schema";
import { health, runJob } from "../lib/runner";
import Term from "./Term";
import { GLOSSARY } from "./glossary";

// Wrap a label in a hover-glossary <Term> when it matches a known term, else plain text.
const termify = (label: string) =>
  GLOSSARY[label.toLowerCase()] ? <Term k={label.toLowerCase()}>{label}</Term> : label;

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "");

// Compact, authoritative grounding block for the LLM — the computed numbers + the
// deterministic finding, so the model explains/extends them instead of inventing figures.
function buildAiSummary(name: string, mode: string, r: ExperimentResult, e: Explanation): string {
  const c = r.current;
  const metrics = r.metrics.map((m) => `${m.k} ${m.v}`).join("; ");
  return [
    `Experiment: ${name} (${mode} data; source=${r.source}).`,
    r.experimentId === "cuda"
      ? `Current point: ${c.x} threads/block — occupancy ${fmt((r.occupancy ?? c.efficiency) * 100, 0)}%, performance ${fmt(c.speedup * 100, 0)}% of the sweep's best (limiter: ${r.limiter ?? "n/a"}).`
      : r.experimentId === "cudaCoalesce"
        ? `Current point: stride ${c.x} — achieved bandwidth ${fmt(r.bw ?? 0, 0)} GB/s = ${fmt(c.efficiency * 100, 0)}% of the coalesced (stride-1) peak; ${fmt((1 - c.efficiency) * 100, 0)}% of fetched bandwidth wasted.`
        : r.experimentId === "cudaDivergence"
          ? `Current point: ${c.x} divergent path${c.x > 1 ? "s" : ""} — warp runs ${fmt(r.factor ?? 1 / (c.efficiency || 1), 1)}× slower than uniform; ~${fmt(c.efficiency * 100, 0)}% of lanes active per pass (${fmt((1 - c.efficiency) * 100, 0)}% of lane-cycles idle).`
          : r.experimentId === "cudaAtomics"
            ? `Current point: ${c.x} atomic target${c.x > 1 ? "s" : ""} — ${fmt(c.efficiency * 100, 0)}% of peak atomic throughput, ${fmt(r.factor ?? 1 / (c.efficiency || 1), 1)}× off the spread-wide best (1 target = all threads serialized on one address).`
            : `Current point: ${c.x} of 24 ${r.xUnits === "ranks" ? "ranks" : "threads"} — speedup ${fmt(c.speedup, 2)}×, efficiency ${fmt(c.efficiency * 100, 0)}%.`,
    `On-screen metrics: ${metrics}.`,
    `Deterministic finding:`,
    `- What: ${stripHtml(e.what)}`,
    `- Why: ${stripHtml(e.why)}`,
    `- How to fix: ${stripHtml(e.how)}`,
    `- Expected after fix: ${stripHtml(e.exp)}`,
  ].join("\n");
}

type ExpId = "falseSharing" | "synchronization" | "bandwidth" | "imbalance" | "mpiHalo" | "cuda" | "cudaCoalesce" | "cudaDivergence" | "cudaAtomics" | "numaEffects" | "cacheHierarchy" | "simdVec" | "openmpTasks" | "cudaSharedMem" | "mpiCollective" | "hybridMpi";
type Mode = "model" | "measured";

// Union of every per-experiment params shape; each experiment only sets its own subset.
type ExpParams = {
  threads?: number;
  ranks?: number;
  padded?: boolean;
  intensity?: number;
  mode?: string;
  ai?: number;
  sched?: string;
  blockSize?: number;
  variant?: string;
  stride?: number;
  paths?: number;
  targets?: number;
  // new experiments
  numaAware?: boolean;
  level?: string;
  vectorWidth?: number;
  layout?: string;
  granularity?: string;
  bankStride?: number;
  padding?: boolean;
  collective?: string;
  threadsPerRank?: number;
};

// Experiments that have no Measured backend — Measured pill is disabled for these.
const MODEL_ONLY = new Set<ExpId>([]);

const DEFAULT_PARAMS: Record<ExpId, ExpParams> = {
  falseSharing:   { threads: 24, padded: false, intensity: 1 },
  synchronization:{ threads: 24, mode: "critical" },
  bandwidth:      { threads: 24, ai: 0.1 },
  imbalance:      { threads: 24, sched: "static" },
  mpiHalo:        { ranks: 24, mode: "strong" },
  cuda:           { blockSize: 256, variant: "heavy" },
  cudaCoalesce:   { stride: 8 },
  cudaDivergence: { paths: 8 },
  cudaAtomics:    { targets: 1 },
  numaEffects:    { threads: 24, numaAware: false },
  cacheHierarchy: { threads: 24, level: "DRAM" },
  simdVec:        { vectorWidth: 8, layout: "AoS" },
  openmpTasks:    { threads: 8,  granularity: "fine" },
  cudaSharedMem:  { bankStride: 4, padding: false },
  mpiCollective:  { ranks: 8,   collective: "alltoall" },
  hybridMpi:      { ranks: 4,   threadsPerRank: 4 },
};

const STRIDES = [1, 2, 4, 8, 16, 32];
const ATOMS = [1, 4, 16, 64, 256, 1024, 4096];

export default function Flagship() {
  const [exp, setExp] = useState<ExpId>("falseSharing");
  const [mode, setMode] = useState<Mode>("model");
  const [params, setParams] = useState<Record<ExpId, ExpParams>>(DEFAULT_PARAMS);
  const [measuredResult, setMeasuredResult] = useState<ExperimentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runnerOk, setRunnerOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scalingRef = useRef<SVGSVGElement>(null);
  const rooflineRef = useRef<SVGSVGElement>(null);
  const resultRef = useRef<ExperimentResult | null>(null);
  const cacheRef = useRef<Record<string, RunnerData>>({});
  const tokenRef = useRef(0);

  // Model results are pure functions of (exp, params), so compute them during render.
  const modelResult = useMemo(() => Models[exp](params[exp]), [exp, params]);
  const result = mode === "model" ? modelResult : measuredResult;
  const showLoading = mode === "measured" && loading;

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  const p = params[exp];
  const measured = mode === "measured";
  const isCuda = exp === "cuda";
  const isCoalesce = exp === "cudaCoalesce";
  const isDiverge = exp === "cudaDivergence";
  const isAtomics = exp === "cudaAtomics";
  const isSimd = exp === "simdVec";
  const isCudaSharedMem = exp === "cudaSharedMem";
  const cudaFam = isCuda || isCoalesce || isDiverge || isAtomics || isCudaSharedMem;
  const ranksFam = exp === "mpiHalo" || exp === "mpiCollective" || exp === "hybridMpi";
  const xKey = ranksFam ? "ranks" : "threads";
  const xLabel = ranksFam ? "Ranks" : "Threads";
  const xUnits = result?.xUnits === "ranks" ? "ranks" : "threads";
  const isModelOnly = MODEL_ONLY.has(exp);

  const setParam = useCallback(
    (patch: Partial<ExpParams>) => setParams((prev) => ({ ...prev, [exp]: { ...prev[exp], ...patch } })),
    [exp],
  );

  // Gateway health check (enables the Measured pill)
  useEffect(() => {
    let alive = true;
    health()
      .then((j) => { if (alive && j?.ok) setRunnerOk(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Deep-link: /?exp=<id> opens a specific experiment (e.g. from a /learn card).
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("exp");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional URL sync on mount (SSR-safe)
    if (e && e in DEFAULT_PARAMS) setExp(e as ExpId);
  }, []);

  // Recompute on experiment / mode / params change (model = sync via useMemo above, measured = async fetch)
  useEffect(() => {
    const my = ++tokenRef.current;
    if (mode === "model") return;
    const cp = params[exp];
    const isMpi = exp === "mpiHalo";
    const isCuda = exp === "cuda";
    const isCoalesce = exp === "cudaCoalesce";
    const isDiverge = exp === "cudaDivergence";
    const isAtomics = exp === "cudaAtomics";
    const isCudaShared = exp === "cudaSharedMem";
    const isMpiColl = exp === "mpiCollective";
    const isHybrid = exp === "hybridMpi";
    const cudaExp = isDiverge ? "divergence" : isCoalesce ? "coalesce" : isAtomics ? "atomics"
      : isCudaShared ? "sharedmem" : "occupancy";
    const spec = runnerSpec(exp, cp);
    const { bexp, variant } = spec;
    const key = (spec.kind === "cuda" || isCuda || isCoalesce || isDiverge || isAtomics)
      ? "cuda/" + cudaExp + "/" + variant
      : (spec.kind === "mpi" || isMpi)
        ? "mpi/" + (spec.experiment ?? "halo") + "/" + variant
        : bexp + "/" + variant;
    const cached = cacheRef.current[key];
    if (cached) { setMeasuredResult(Measured[exp](cp, cached)); return; }
    setLoading(true);
    const anyCuda = isCuda || isCoalesce || isDiverge || isAtomics || isCudaShared;
    const anyMpi = isMpi || isMpiColl || isHybrid;
    const body = anyCuda
      ? { kind: "cuda" as const, experiment: cudaExp, variant: variant }
      : anyMpi
        ? { kind: "mpi" as const, experiment: spec.experiment ?? "halo", variant, maxranks: MAXP }
        : { kind: "bench" as const, exp: bexp, variant, maxthreads: MAXP };
    runJob(body)
      .then((data) => {
        if (my !== tokenRef.current) return; // superseded
        const d = data as RunnerData & { error?: string; message?: string };
        if (!d || d.error) throw new Error(d?.message || d?.error || "run failed");
        cacheRef.current[key] = d;
        setLoading(false);
        setMeasuredResult(Measured[exp](cp, d));
      })
      .catch((e) => {
        if (my !== tokenRef.current) return;
        setLoading(false);
        setErr(String(e?.message || e));
        setMode("model"); // revert; this effect re-runs in model mode
      });
  }, [exp, mode, params]);

  // Redraw D3 charts when the result changes
  useEffect(() => {
    if (!result) return;
    const SWEEP_IDS = new Set(["cudaCoalesce", "cudaDivergence", "cudaAtomics", "simdVec", "cudaSharedMem"]);
    if (scalingRef.current) {
      if (result.experimentId === "cuda") drawOccupancy(scalingRef.current, result);
      else if (SWEEP_IDS.has(result.experimentId)) drawSweep(scalingRef.current, result);
      else drawScaling(scalingRef.current, result);
    }
    if (result.experimentId === "bandwidth" && rooflineRef.current) drawRoofline(rooflineRef.current, result);
  }, [result]);

  // Redraw charts on window resize
  useEffect(() => {
    const SWEEP_IDS = new Set(["cudaCoalesce", "cudaDivergence", "cudaAtomics", "simdVec", "cudaSharedMem"]);
    const onResize = () => {
      const r = resultRef.current;
      if (!r) return;
      if (scalingRef.current) {
        if (r.experimentId === "cuda") drawOccupancy(scalingRef.current, r);
        else if (SWEEP_IDS.has(r.experimentId)) drawSweep(scalingRef.current, r);
        else drawScaling(scalingRef.current, r);
      }
      if (r.experimentId === "bandwidth" && rooflineRef.current) drawRoofline(rooflineRef.current, r);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Canvas scene animation loop (reads latest result via ref)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const resize = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr);
      cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = rect.width; h = rect.height;
    };
    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const r = resultRef.current;
      if (r) { const fn = scenes[r.experimentId]; if (fn) fn(ctx, w, h, now * 0.35, r); }
    };
    resize();
    window.addEventListener("resize", resize);
    if (!reduce) {
      const loop = (now: number) => { draw(now); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    } else {
      draw(0);
    }
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // Reduced-motion: draw a single static frame whenever the result changes
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduce || !result) return;
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const rect = cv.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    const fn = scenes[result.experimentId];
    if (fn) fn(ctx, rect.width, rect.height, 0, result);
  }, [result]);

  const expMeta = EXPERIMENTS.find((e) => e.id === exp)!;
  const E = measured ? ExplainMeasured : Explain;
  const explanation = result ? E[exp](result) : null;
  const aiSummary = result && explanation ? buildAiSummary(expMeta.name, mode, result, explanation) : "";
  const cur = result?.current;
  const heroColor = cur
    ? cur.efficiency > 0.7 ? "var(--good)" : cur.efficiency > 0.4 ? "var(--warn)" : "var(--bad)"
    : "var(--muted)";

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Why</span> Parallel Code Gets Slower</h1>
          <div className="sub">Visual HPC for Engineers · flagship — flip the fix and watch the hardware react</div>
        </div>
        <div className="src-badge">
          <span style={{ marginRight: 2 }}>data source:</span>
          <span className={"pill click" + (mode === "model" ? " sel" : "")} onClick={() => setMode("model")}>
            <span className="dot" />Model
          </span>
          <span
            className={"pill " + (runnerOk && !isModelOnly ? "click" : "disabled") + (mode === "measured" ? " sel" : "")}
            title={isModelOnly ? "model-only experiment — no backend runner yet" : runnerOk ? "live gateway · 24 cores" : "gateway offline — start it with  docker compose -f infra/docker/compose.yml up"}
            onClick={() => { if (runnerOk && !isModelOnly) setMode("measured"); }}
          >
            <span className="dot" />Measured · 24 cores
          </span>
        </div>
      </header>

      {err && (
        <div className="banner">
          Runner error: {err} — showing Model.{" "}
          <a style={{ cursor: "pointer" }} onClick={() => setErr(null)}>dismiss</a>
        </div>
      )}

      <nav className="tabs">
        {EXPERIMENTS.map((e, i) => (
          <button key={e.id} className={"tab" + (e.id === exp ? " active" : "")} onClick={() => { setExp(e.id as ExpId); if (MODEL_ONLY.has(e.id as ExpId)) setMode("model"); }}>
            <span className="ix">{String(i + 1).padStart(2, "0")}</span>{e.name}
          </button>
        ))}
      </nav>

      <div className="grid">
        <section className="card">
          <h2>Controls</h2>
          {!cudaFam && !isSimd && (
            <div className="ctrl">
              <label>{xLabel}<b>{p[xKey]}</b></label>
              <input type="range" min={1} max={MAXP} step={1} value={p[xKey]}
                onChange={(e) => setParam({ [xKey]: +e.target.value })} />
            </div>
          )}

          {exp === "falseSharing" && (
            <>
              <div className="ctrl">
                <label>Pad to cache line
                  <span style={{ fontFamily: "var(--mono)", color: "var(--good)" }}>{p.padded ? "FIXED" : "off"}</span>
                </label>
                <div className={"toggle" + (p.padded ? " on" : "")} onClick={() => setParam({ padded: !p.padded })}>
                  <div className="track"><div className="knob" /></div>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>align each counter to 64 B</span>
                </div>
                <div className="fixhint">The fix: give every thread its own <Term k="cache line">cache line</Term> so writes stop invalidating each other.</div>
              </div>
              {!measured && (
                <div className="ctrl">
                  <label>Write intensity<b>×{fmt(p.intensity ?? 1, 1)}</b></label>
                  <input type="range" min={0.5} max={2} step={0.1} value={p.intensity}
                    onChange={(e) => setParam({ intensity: +e.target.value })} />
                </div>
              )}
            </>
          )}

          {exp === "synchronization" && (
            <div className="ctrl">
              <label>Accumulation strategy</label>
              <div className="seg fix">
                {[["critical", "critical"], ["atomic", "atomic"], ["reduction", "reduction ✓"]].map(([k, lab]) => (
                  <button key={k} className={p.mode === k ? "on" : ""} onClick={() => setParam({ mode: k })}>{lab}</button>
                ))}
              </div>
              <div className="fixhint">The fix: <Term k="reduction">reduction</Term> — sum into private partials, combine once at the end.</div>
            </div>
          )}

          {exp === "bandwidth" && (
            <div className="ctrl">
              {!measured ? (
                <>
                  <label>Arithmetic intensity<b>{fmt(p.ai ?? 0.1, 2)} F/B</b></label>
                  <input type="range" min={0.03} max={8} step={0.01} value={p.ai}
                    onChange={(e) => setParam({ ai: +e.target.value })} />
                  <div className="fixhint">The fix: raise <Term k="arithmetic intensity">arithmetic intensity</Term> (FLOPs per byte) to climb off the memory ceiling.</div>
                </>
              ) : (
                <div className="fixhint">
                  Arithmetic intensity is fixed by the real triad kernel (~{fmt(TRIAD_AI, 2)} F/B).
                  Here the lesson is the <b>measured saturation</b>, not a what-if.
                </div>
              )}
            </div>
          )}

          {exp === "imbalance" && (
            <div className="ctrl">
              <label>OpenMP schedule</label>
              <div className="seg fix">
                {[["static", "static"], ["guided", "guided"], ["dynamic", "dynamic ✓"]].map(([k, lab]) => (
                  <button key={k} className={p.sched === k ? "on" : ""} onClick={() => setParam({ sched: k })}>{lab}</button>
                ))}
              </div>
              <div className="fixhint">The fix: dynamic/guided scheduling lets idle threads steal remaining work.</div>
            </div>
          )}

          {exp === "mpiHalo" && (
            <div className="ctrl">
              <label>Scaling regime</label>
              <div className="seg fix">
                {[["strong", "strong"], ["weak", "weak ✓"]].map(([k, lab]) => (
                  <button key={k} className={p.mode === k ? "on" : ""} onClick={() => setParam({ mode: k })}>{lab}</button>
                ))}
              </div>
              <div className="fixhint">The fix: weak scaling — grow the grid with the ranks so each rank keeps the same work; efficiency stays flat instead of hitting the communication wall.</div>
            </div>
          )}

          {exp === "cuda" && (
            <>
              <div className="ctrl">
                <label>Threads / block<b>{p.blockSize}</b></label>
                <input type="range" min={32} max={1024} step={32} value={p.blockSize}
                  onChange={(e) => setParam({ blockSize: +e.target.value })} />
              </div>
              <div className="ctrl">
                <label>Register pressure</label>
                <div className="seg fix">
                  {[["heavy", "heavy"], ["light", "light ✓"]].map(([k, lab]) => (
                    <button key={k} className={p.variant === k ? "on" : ""} onClick={() => setParam({ variant: k })}>{lab}</button>
                  ))}
                </div>
                <div className="fixhint">The fix: cut registers/thread (a lighter kernel or <code>__launch_bounds__</code>) so more <Term k="warp">warps</Term> fit per SM — <Term k="occupancy">occupancy</Term> climbs.</div>
              </div>
            </>
          )}

          {exp === "cudaCoalesce" && (
            <div className="ctrl">
              <label>Access stride<b>{p.stride === 1 ? "1 (coalesced)" : p.stride}</b></label>
              <div className="seg fix">
                {STRIDES.map((s) => (
                  <button key={s} className={p.stride === s ? "on" : ""} onClick={() => setParam({ stride: s })}>{s === 1 ? "1 ✓" : s}</button>
                ))}
              </div>
              <div className="fixhint">The fix: make the inner index <b>unit-stride</b> so a <Term k="warp">warp</Term>’s 32 lanes fall in one 128-byte cache line — <Term k="coalescing">coalesced</Term> access, full bandwidth.</div>
            </div>
          )}

          {exp === "cudaDivergence" && (
            <div className="ctrl">
              <label>Divergent paths<b>{p.paths === 1 ? "1 (uniform)" : p.paths}</b></label>
              <div className="seg fix">
                {STRIDES.map((d) => (
                  <button key={d} className={p.paths === d ? "on" : ""} onClick={() => setParam({ paths: d })}>{d === 1 ? "1 ✓" : d}</button>
                ))}
              </div>
              <div className="fixhint">The fix: keep branches <b>warp-uniform</b> (sort/bin by condition, or go branchless) so a <Term k="warp">warp</Term> takes one path and never serializes — no <Term k="warp divergence">divergence</Term>.</div>
            </div>
          )}

          {exp === "cudaAtomics" && (
            <div className="ctrl">
              <label>Atomic targets<b>{p.targets === 1 ? "1 (one counter)" : p.targets}</b></label>
              <div className="seg fix">
                {ATOMS.map((t) => (
                  <button key={t} className={p.targets === t ? "on" : ""} onClick={() => setParam({ targets: t })}>{t}</button>
                ))}
              </div>
              <div className="fixhint">The fix: <b>privatize</b> the updates — accumulate in per-block <code>__shared__</code> counters, then one global <Term k="atomic">atomic</Term> per block. Fewer threads per address = far less contention.</div>
            </div>
          )}

          {exp === "numaEffects" && (
            <div className="ctrl">
              <label>NUMA binding
                <span style={{ fontFamily: "var(--mono)", color: p.numaAware ? "var(--good)" : "var(--bad)" }}>{p.numaAware ? "ON" : "off"}</span>
              </label>
              <div className={"toggle" + (p.numaAware ? " on" : "")} onClick={() => setParam({ numaAware: !p.numaAware })}>
                <div className="track"><div className="knob" /></div>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>pin threads to local NUMA socket</span>
              </div>
              <div className="fixhint">The fix: bind threads to their local socket (<code>OMP_PROC_BIND=close</code> or <code>numactl --cpunodebind</code>) so every access hits local DRAM — no cross-socket penalty.</div>
            </div>
          )}

          {exp === "cacheHierarchy" && (
            <div className="ctrl">
              <label>Working set level</label>
              <div className="seg fix">
                {["L1", "L2", "L3", "DRAM"].map((lv) => (
                  <button key={lv} className={p.level === lv ? "on" : ""} onClick={() => setParam({ level: lv })}>{lv}{lv === "L1" || lv === "L2" ? " ✓" : ""}</button>
                ))}
              </div>
              <div className="fixhint">The fix: <b>cache block / tile</b> the computation so the hot data fits in L1 or L2 — each core then brings its own private bandwidth and scaling stays near-linear.</div>
            </div>
          )}

          {exp === "simdVec" && (
            <>
              <div className="ctrl">
                <label>Data layout</label>
                <div className="seg fix">
                  {[["SoA", "SoA ✓"], ["AoS", "AoS"]].map(([k, lab]) => (
                    <button key={k} className={p.layout === k ? "on" : ""} onClick={() => setParam({ layout: k })}>{lab}</button>
                  ))}
                </div>
                <div className="fixhint">The fix: <b>Structure-of-Arrays</b> stores each field contiguously — a vector load fills all lanes with no gather overhead.</div>
              </div>
              <div className="ctrl">
                <label>SIMD width<b>{p.vectorWidth} lanes</b></label>
                <div className="seg fix">
                  {SIMD_WIDTHS.map((w) => (
                    <button key={w} className={p.vectorWidth === w ? "on" : ""} onClick={() => setParam({ vectorWidth: w })}>{w === 1 ? "1 (scalar)" : w === 8 ? "8 (AVX)" : w === 16 ? "16 (AVX-512)" : String(w)}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {exp === "openmpTasks" && (
            <div className="ctrl">
              <label>Task granularity</label>
              <div className="seg fix">
                {[["coarse", "coarse ✓"], ["fine", "fine"]].map(([k, lab]) => (
                  <button key={k} className={p.granularity === k ? "on" : ""} onClick={() => setParam({ granularity: k })}>{lab}</button>
                ))}
              </div>
              <div className="fixhint">The fix: <b>merge tasks into coarser chunks</b> so each task does enough work to amortize the runtime scheduling overhead (target ≥ 1 µs per task).</div>
            </div>
          )}

          {exp === "cudaSharedMem" && (
            <>
              <div className="ctrl">
                <label>Bank stride<b>{p.bankStride === 1 ? "1 (conflict-free)" : p.bankStride + "-way conflict"}</b></label>
                <div className="seg fix">
                  {BANK_STRIDES.map((s) => (
                    <button key={s} className={p.bankStride === s ? "on" : ""} onClick={() => setParam({ bankStride: s })}>{s === 1 ? "1 ✓" : s}</button>
                  ))}
                </div>
              </div>
              <div className="ctrl">
                <label>Row padding
                  <span style={{ fontFamily: "var(--mono)", color: p.padding ? "var(--good)" : "var(--bad)" }}>{p.padding ? "FIXED" : "off"}</span>
                </label>
                <div className={"toggle" + (p.padding ? " on" : "")} onClick={() => setParam({ padding: !p.padding })}>
                  <div className="track"><div className="knob" /></div>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>+1 element per row → shifts bank mapping</span>
                </div>
                <div className="fixhint">The fix: add <b>1 element of padding</b> per shared-memory row to rotate the bank mapping so stride-N access hits N different banks — conflict-free.</div>
              </div>
            </>
          )}

          {exp === "mpiCollective" && (
            <div className="ctrl">
              <label>Collective operation</label>
              <div className="seg fix">
                {[["broadcast", "bcast ✓"], ["reduce", "reduce ✓"], ["allreduce", "allreduce"], ["alltoall", "alltoall"]].map(([k, lab]) => (
                  <button key={k} className={p.collective === k ? "on" : ""} onClick={() => setParam({ collective: k })}>{lab}</button>
                ))}
              </div>
              <div className="fixhint">The fix: prefer <b>broadcast / reduce</b> (O(log p)) over alltoall (O(p)). If a global sum is needed, use <b>allreduce</b> — ring algorithm keeps cost logarithmic.</div>
            </div>
          )}

          {exp === "hybridMpi" && (
            <div className="ctrl">
              <label>Threads / rank<b>{p.threadsPerRank}</b></label>
              <div className="seg fix">
                {[1, 2, 4, 6, 12].map((t) => (
                  <button key={t} className={p.threadsPerRank === t ? "on" : ""} onClick={() => setParam({ threadsPerRank: t })}>{t === 1 ? "1 (pure MPI)" : t === 12 ? "12 (1 rank/socket)" : String(t)}</button>
                ))}
              </div>
              <div className="fixhint">The fix: <b>match the rank count to the number of NUMA nodes</b> (2 here), fill each socket with OpenMP threads. Reduces MPI collective cost and keeps memory accesses NUMA-local.</div>
            </div>
          )}
        </section>

        <section className="card vizwrap">
          <h2>
            <span>Visualization</span>
            <span className="scene-tag">{expMeta.scene}</span>
          </h2>
          <canvas className="viz" ref={canvasRef} />
        </section>

        <section className="card">
          <h2>Live metrics</h2>
          <div className="hero">
            <div className="big" style={{ color: heroColor }}>
              {showLoading ? "•••"
                : cur
                  ? isCuda        ? fmt((result?.occupancy ?? cur.efficiency) * 100, 0) + "%"
                  : isCoalesce    ? fmt(result?.bw ?? 0, 0)
                  : isDiverge     ? fmt(result?.factor ?? 1 / (cur.efficiency || 1), 1) + "×"
                  : isAtomics     ? fmt(result?.factor ?? 1 / (cur.efficiency || 1), 1) + "×"
                  : isCudaSharedMem ? fmt(result?.bw ?? 0, 0)
                  : isSimd        ? fmt(cur.speedup, 1) + "×"
                  : fmt(cur.speedup, 1) + "×"
                  : "—"}
            </div>
            <div className="cap">
              {showLoading
                ? (cudaFam ? "measuring on the RTX 5060…" : ranksFam ? `measuring on 24 ${xUnits}…` : `measuring on 24 cores…`)
                : cur
                  ? isCuda        ? `occupancy at ${cur.x} threads/block`
                    : isCoalesce  ? `GB/s · stride ${cur.x} · ${fmt(cur.efficiency * 100, 0)}% of coalesced peak`
                    : isDiverge   ? `slower than uniform · ${cur.x} path${cur.x > 1 ? "s" : ""} · ${fmt(cur.efficiency * 100, 0)}% lanes active`
                    : isAtomics   ? `slower than spread · ${cur.x} target${cur.x > 1 ? "s" : ""} · ${fmt(cur.efficiency * 100, 0)}% throughput`
                    : isCudaSharedMem ? `GB/s · stride ${cur.x} · ${fmt(cur.efficiency * 100, 0)}% of peak shared BW`
                    : isSimd      ? `throughput at ${cur.x} SIMD lanes (${fmt(cur.efficiency * 100, 0)}% lane utilization)`
                    : `speedup on ${cur.x} of 24 ${xUnits === "ranks" ? "ranks" : "cores"}`
                  : (isCuda ? "occupancy" : isCoalesce ? "GB/s" : isDiverge ? "warp slowdown" : isAtomics ? "atomic slowdown" : isCudaSharedMem ? "GB/s" : "speedup")}
            </div>
          </div>
          <div>
            {showLoading ? (
              <div className="metric"><span className="k">{cudaFam ? "Compiling & running CUDA sweep…" : ranksFam ? "Compiling & running MPI sweep…" : "Compiling & running OpenMP sweep…"}</span><span className="v accent">live</span></div>
            ) : (
              result?.metrics.map((m, idx) => (
                <div className="metric" key={idx}>
                  <span className="k">{termify(m.k)}</span>
                  <span className={"v " + (m.tone || "")}>{m.v}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="lower">
        <section className="card">
          <h2>{isCuda ? "Occupancy · 32 → 1024 threads/block" : isCoalesce ? "Bandwidth efficiency · stride 1 → 32" : isDiverge ? "Throughput vs uniform · 1 → 32 paths" : isAtomics ? "Atomic throughput · 1 → 4096 targets" : isSimd ? "Throughput vs SIMD width" : isCudaSharedMem ? "Shared memory BW vs bank stride" : `Scaling · 1 → ${MAXP} ${xUnits}`}</h2>
          <div className={"charts" + (exp === "bandwidth" ? " two" : "")}>
            <div className="chart">
              <svg ref={scalingRef} />
              <div className="legend">
                {isCuda ? (
                  <>
                    <span><i style={{ borderColor: "var(--accent)" }} />occupancy</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />performance</span>
                    <span><i style={{ borderColor: "var(--good)" }} />best block</span>
                  </>
                ) : isCoalesce ? (
                  <>
                    <span><i style={{ borderColor: "var(--accent)" }} />bandwidth vs coalesced peak</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />stride points</span>
                  </>
                ) : isAtomics ? (
                  <>
                    <span><i style={{ borderColor: "var(--accent)" }} />throughput vs spread</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />target points</span>
                  </>
                ) : isSimd ? (
                  <>
                    <span><i style={{ borderColor: "var(--accent)" }} />throughput gain vs scalar</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />SIMD width points</span>
                  </>
                ) : isCudaSharedMem ? (
                  <>
                    <span><i style={{ borderColor: "var(--accent)" }} />BW efficiency vs conflict-free</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />stride points</span>
                  </>
                ) : isDiverge ? (
                  <>
                    <span><i style={{ borderColor: "var(--accent)" }} />throughput vs uniform</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />path points</span>
                  </>
                ) : (
                  <>
                    <span><i style={{ borderColor: "#33405a" }} />ideal (linear)</span>
                    <span><i style={{ borderColor: "var(--accent)" }} />actual speedup</span>
                    <span><i style={{ borderColor: "var(--accent2)" }} />efficiency</span>
                  </>
                )}
              </div>
            </div>
            {exp === "bandwidth" && (
              <div className="chart">
                <svg ref={rooflineRef} />
                <div className="legend">
                  <span><i style={{ borderColor: "var(--bad)" }} />memory ceiling</span>
                  <span><i style={{ borderColor: "var(--warn)" }} />compute ceiling</span>
                  <span><i style={{ borderColor: "var(--accent)" }} />your kernel</span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card explain">
          <h2>Diagnosis {explanation && <span className={"sev " + explanation.sev}>{explanation.sev}</span>}</h2>
          {explanation && (
            <div className="blocks">
              <div className="eb what"><div className="t">What happened</div><div className="body" dangerouslySetInnerHTML={{ __html: explanation.what }} /></div>
              <div className="eb why"><div className="t">Why</div><div className="body" dangerouslySetInnerHTML={{ __html: explanation.why }} /></div>
              <div className="eb how"><div className="t">How to fix</div><div className="body" dangerouslySetInnerHTML={{ __html: explanation.how }} /></div>
              <div className="eb exp"><div className="t">Expected after fix</div><div className="body" dangerouslySetInnerHTML={{ __html: explanation.exp }} /></div>
            </div>
          )}
        </section>

        <AskAI context={{ experimentId: exp, mode, summary: aiSummary }} />
      </div>

      <footer className="note">
        <b>Model</b> numbers come from physically-grounded formulas (Amdahl, cache-coherence cost,
        bandwidth saturation, load-imbalance) in <code>@vhpce/perf-models</code>. <b>Measured</b> numbers
        are real OpenMP runs on this laptop&apos;s 24 cores, queued through the local gateway (Docker). Same
        <code> ProfileResult </code> seam feeds the charts, metrics, and explanations either way.
      </footer>
    </main>
  );
}
