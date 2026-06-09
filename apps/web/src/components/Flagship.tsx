"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import FalseSharingScene3D from "./scenes/FalseSharingScene3D";
import SynchronizationScene3D from "./scenes/SynchronizationScene3D";
import BandwidthScene3D from "./scenes/BandwidthScene3D";
import ImbalanceScene3D from "./scenes/ImbalanceScene3D";
import MpiScene3D from "./scenes/MpiScene3D";
import CudaScene3D from "./scenes/CudaScene3D";
import CoalesceScene3D from "./scenes/CoalesceScene3D";
import DivergenceScene3D from "./scenes/DivergenceScene3D";
import AtomicsScene3D from "./scenes/AtomicsScene3D";
import AskAI from "./AskAI";
import {
  Models, Measured, runnerSpec, EXPERIMENTS, MAXP, TRIAD_AI,
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

const SCENES_3D: Record<string, ComponentType<{ result: ExperimentResult | null }>> = {
  falseSharing: FalseSharingScene3D,
  synchronization: SynchronizationScene3D,
  bandwidth: BandwidthScene3D,
  imbalance: ImbalanceScene3D,
  mpiHalo: MpiScene3D,
  cuda: CudaScene3D,
  cudaCoalesce: CoalesceScene3D,
  cudaDivergence: DivergenceScene3D,
  cudaAtomics: AtomicsScene3D,
};

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

type ExpId = "falseSharing" | "synchronization" | "bandwidth" | "imbalance" | "mpiHalo" | "cuda" | "cudaCoalesce" | "cudaDivergence" | "cudaAtomics";
type Mode = "model" | "measured";

const DEFAULT_PARAMS: Record<ExpId, any> = {
  falseSharing: { threads: 24, padded: false, intensity: 1 },
  synchronization: { threads: 24, mode: "critical" },
  bandwidth: { threads: 24, ai: 0.1 },
  imbalance: { threads: 24, sched: "static" },
  mpiHalo: { ranks: 24, mode: "strong" },
  cuda: { blockSize: 256, variant: "heavy" },
  cudaCoalesce: { stride: 8 },
  cudaDivergence: { paths: 8 },
  cudaAtomics: { targets: 1 },
};

const STRIDES = [1, 2, 4, 8, 16, 32];
const ATOMS = [1, 4, 16, 64, 256, 1024, 4096];

export default function Flagship() {
  const [exp, setExp] = useState<ExpId>("falseSharing");
  const [mode, setMode] = useState<Mode>("model");
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [params, setParams] = useState<Record<ExpId, any>>(DEFAULT_PARAMS);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runnerOk, setRunnerOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scalingRef = useRef<SVGSVGElement>(null);
  const rooflineRef = useRef<SVGSVGElement>(null);
  const resultRef = useRef<ExperimentResult | null>(null);
  const cacheRef = useRef<Record<string, RunnerData>>({});
  const tokenRef = useRef(0);
  resultRef.current = result;

  const p = params[exp];
  const measured = mode === "measured";
  const use3D = view === "3d";
  const Scene3D = SCENES_3D[exp];
  const isCuda = exp === "cuda";
  const isCoalesce = exp === "cudaCoalesce";
  const isDiverge = exp === "cudaDivergence";
  const isAtomics = exp === "cudaAtomics";
  const cudaFam = isCuda || isCoalesce || isDiverge || isAtomics;
  const xKey = exp === "mpiHalo" ? "ranks" : "threads";   // degree-of-parallelism param
  const xLabel = exp === "mpiHalo" ? "Ranks" : "Threads";
  const xUnits = result?.xUnits === "ranks" ? "ranks" : "threads";

  const setParam = useCallback(
    (patch: any) => setParams((prev) => ({ ...prev, [exp]: { ...prev[exp], ...patch } })),
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

  // Recompute on experiment / mode / params change (model = sync, measured = async fetch)
  useEffect(() => {
    const my = ++tokenRef.current;
    const cp = params[exp];
    if (mode === "model") {
      setResult(Models[exp](cp));
      setLoading(false);
      return;
    }
    const isMpi = exp === "mpiHalo";
    const isCuda = exp === "cuda";
    const isCoalesce = exp === "cudaCoalesce";
    const isDiverge = exp === "cudaDivergence";
    const isAtomics = exp === "cudaAtomics";
    const cudaExp = isDiverge ? "divergence" : isCoalesce ? "coalesce" : isAtomics ? "atomics" : "occupancy";
    const { bexp, variant } = runnerSpec(exp, cp);
    // The CUDA runner sweeps the whole range in one pass, so the sweep experiments cache by
    // experiment only — moving the slider just re-selects a point from the same measured data.
    const key = isDiverge ? "cuda/divergence"
      : isCoalesce ? "cuda/coalesce"
      : isAtomics ? "cuda/atomics"
      : isCuda ? "cuda/" + cp.variant
      : isMpi ? "mpi/" + cp.mode
      : bexp + "/" + variant;
    const cached = cacheRef.current[key];
    if (cached) { setResult(Measured[exp](cp, cached)); return; }
    setLoading(true);
    const body = isCuda || isCoalesce || isDiverge || isAtomics
      ? { kind: "cuda" as const, experiment: cudaExp, variant: cp.variant ?? "heavy" }
      : isMpi
        ? { kind: "mpi" as const, variant: cp.mode, maxranks: MAXP }
        : { kind: "bench" as const, exp: bexp, variant, maxthreads: MAXP };
    runJob(body)
      .then((data) => {
        if (my !== tokenRef.current) return; // superseded
        const d = data as RunnerData & { error?: string; message?: string };
        if (!d || d.error) throw new Error(d?.message || d?.error || "run failed");
        cacheRef.current[key] = d;
        setLoading(false);
        setResult(Measured[exp](cp, d));
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
    if (scalingRef.current) {
      if (result.experimentId === "cuda") drawOccupancy(scalingRef.current, result);
      else if (result.experimentId === "cudaCoalesce" || result.experimentId === "cudaDivergence" || result.experimentId === "cudaAtomics") drawSweep(scalingRef.current, result);
      else drawScaling(scalingRef.current, result);
    }
    if (result.experimentId === "bandwidth" && rooflineRef.current) drawRoofline(rooflineRef.current, result);
  }, [result]);

  // Redraw charts on window resize
  useEffect(() => {
    const onResize = () => {
      const r = resultRef.current;
      if (!r) return;
      if (scalingRef.current) {
        if (r.experimentId === "cuda") drawOccupancy(scalingRef.current, r);
        else if (r.experimentId === "cudaCoalesce" || r.experimentId === "cudaDivergence" || r.experimentId === "cudaAtomics") drawSweep(scalingRef.current, r);
        else drawScaling(scalingRef.current, r);
      }
      if (r.experimentId === "bandwidth" && rooflineRef.current) drawRoofline(rooflineRef.current, r);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Canvas scene animation loop (2D mode only; reads latest result via ref)
  useEffect(() => {
    if (use3D) return;
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
      if (r) { const fn = scenes[r.experimentId]; if (fn) fn(ctx, w, h, now, r); }
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
  }, [use3D]);

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
            className={"pill " + (runnerOk ? "click" : "disabled") + (mode === "measured" ? " sel" : "")}
            title={runnerOk ? "live gateway · 24 cores" : "gateway offline — start it with  docker compose -f infra/docker/compose.yml up"}
            onClick={() => { if (runnerOk) setMode("measured"); }}
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
          <button key={e.id} className={"tab" + (e.id === exp ? " active" : "")} onClick={() => setExp(e.id as ExpId)}>
            <span className="ix">0{i + 1}</span>{e.name}
          </button>
        ))}
      </nav>

      <div className="grid">
        <section className="card">
          <h2>Controls</h2>
          {!cudaFam && (
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
                  <label>Write intensity<b>×{fmt(p.intensity, 1)}</b></label>
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
                  <label>Arithmetic intensity<b>{fmt(p.ai, 2)} F/B</b></label>
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
        </section>

        <section className="card vizwrap">
          <h2>
            <span>Visualization</span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="view-toggle">
                <button className={view === "2d" ? "on" : ""} onClick={() => setView("2d")}>2D</button>
                <button className={view === "3d" ? "on" : ""} onClick={() => setView("3d")}>3D</button>
              </span>
              <span className="scene-tag">{expMeta.scene}</span>
            </span>
          </h2>
          {use3D ? <Scene3D result={result} /> : <canvas className="viz" ref={canvasRef} />}
        </section>

        <section className="card">
          <h2>Live metrics</h2>
          <div className="hero">
            <div className="big" style={{ color: heroColor }}>
              {loading ? "•••"
                : cur
                  ? isCuda ? fmt((result?.occupancy ?? cur.efficiency) * 100, 0) + "%"
                  : isCoalesce ? fmt(result?.bw ?? 0, 0)
                  : isDiverge ? fmt(result?.factor ?? 1 / (cur.efficiency || 1), 1) + "×"
                  : isAtomics ? fmt(result?.factor ?? 1 / (cur.efficiency || 1), 1) + "×"
                  : fmt(cur.speedup, 1) + "×"
                  : "—"}
            </div>
            <div className="cap">
              {loading
                ? (cudaFam ? "measuring on the RTX 5060…" : `measuring on 24 ${xUnits === "ranks" ? "ranks" : "cores"}…`)
                : cur
                  ? isCuda ? `occupancy at ${cur.x} threads/block`
                    : isCoalesce ? `GB/s · stride ${cur.x} · ${fmt(cur.efficiency * 100, 0)}% of coalesced peak`
                    : isDiverge ? `slower than uniform · ${cur.x} path${cur.x > 1 ? "s" : ""} · ${fmt(cur.efficiency * 100, 0)}% lanes active`
                    : isAtomics ? `slower than spread · ${cur.x} target${cur.x > 1 ? "s" : ""} · ${fmt(cur.efficiency * 100, 0)}% throughput`
                    : `speedup on ${cur.x} of 24 ${xUnits === "ranks" ? "ranks" : "cores"}`
                  : (isCuda ? "occupancy" : isCoalesce ? "GB/s" : isDiverge ? "warp slowdown" : isAtomics ? "atomic slowdown" : "speedup")}
            </div>
          </div>
          <div>
            {loading ? (
              <div className="metric"><span className="k">{cudaFam ? "Compiling & running CUDA sweep…" : "Compiling & running OpenMP sweep…"}</span><span className="v accent">live</span></div>
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
          <h2>{isCuda ? "Occupancy · 32 → 1024 threads/block" : isCoalesce ? "Bandwidth efficiency · stride 1 → 32" : isDiverge ? "Throughput vs uniform · 1 → 32 paths" : isAtomics ? "Atomic throughput · 1 → 4096 targets" : `Scaling · 1 → ${MAXP} ${xUnits}`}</h2>
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
