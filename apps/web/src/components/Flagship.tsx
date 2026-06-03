"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import FalseSharingScene3D from "./scenes/FalseSharingScene3D";
import SynchronizationScene3D from "./scenes/SynchronizationScene3D";
import BandwidthScene3D from "./scenes/BandwidthScene3D";
import ImbalanceScene3D from "./scenes/ImbalanceScene3D";
import {
  Models, Measured, runnerSpec, EXPERIMENTS, MAXP, TRIAD_AI,
} from "@vhpce/perf-models";
import { Explain, ExplainMeasured } from "@vhpce/explain";
import { drawScaling, drawRoofline, scenes } from "@vhpce/viz";
import { fmt, type ExperimentResult, type RunnerData } from "@vhpce/profile-schema";

const RUNNER = "http://localhost:8099";

const SCENES_3D: Record<string, ComponentType<{ result: ExperimentResult | null }>> = {
  falseSharing: FalseSharingScene3D,
  synchronization: SynchronizationScene3D,
  bandwidth: BandwidthScene3D,
  imbalance: ImbalanceScene3D,
};

type ExpId = "falseSharing" | "synchronization" | "bandwidth" | "imbalance";
type Mode = "model" | "measured";

const DEFAULT_PARAMS: Record<ExpId, any> = {
  falseSharing: { threads: 24, padded: false, intensity: 1 },
  synchronization: { threads: 24, mode: "critical" },
  bandwidth: { threads: 24, ai: 0.1 },
  imbalance: { threads: 24, sched: "static" },
};

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

  const setParam = useCallback(
    (patch: any) => setParams((prev) => ({ ...prev, [exp]: { ...prev[exp], ...patch } })),
    [exp],
  );

  // Runner health check (enables the Measured pill)
  useEffect(() => {
    let alive = true;
    fetch(RUNNER + "/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j?.ok) setRunnerOk(true); })
      .catch(() => {});
    return () => { alive = false; };
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
    const { bexp, variant } = runnerSpec(exp, cp);
    const key = bexp + "/" + variant;
    const cached = cacheRef.current[key];
    if (cached) { setResult(Measured[exp](cp, cached)); return; }
    setLoading(true);
    fetch(`${RUNNER}/run?exp=${bexp}&variant=${variant}&maxthreads=${MAXP}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: RunnerData & { error?: string }) => {
        if (my !== tokenRef.current) return; // superseded
        if (data.error) throw new Error(data.error);
        cacheRef.current[key] = data;
        setLoading(false);
        setResult(Measured[exp](cp, data));
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
    if (scalingRef.current) drawScaling(scalingRef.current, result);
    if (result.experimentId === "bandwidth" && rooflineRef.current) drawRoofline(rooflineRef.current, result);
  }, [result]);

  // Redraw charts on window resize
  useEffect(() => {
    const onResize = () => {
      const r = resultRef.current;
      if (!r) return;
      if (scalingRef.current) drawScaling(scalingRef.current, r);
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
            title={runnerOk ? "live runner · 24 cores" : "runner offline — run  python3 services/runner/server.py  in WSL"}
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
          <div className="ctrl">
            <label>Threads<b>{p.threads}</b></label>
            <input type="range" min={1} max={MAXP} step={1} value={p.threads}
              onChange={(e) => setParam({ threads: +e.target.value })} />
          </div>

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
                <div className="fixhint">The fix: give every thread its own cache line so writes stop invalidating each other.</div>
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
              <div className="fixhint">The fix: reduction — sum into private partials, combine once at the end.</div>
            </div>
          )}

          {exp === "bandwidth" && (
            <div className="ctrl">
              {!measured ? (
                <>
                  <label>Arithmetic intensity<b>{fmt(p.ai, 2)} F/B</b></label>
                  <input type="range" min={0.03} max={8} step={0.01} value={p.ai}
                    onChange={(e) => setParam({ ai: +e.target.value })} />
                  <div className="fixhint">The fix: raise arithmetic intensity (FLOPs per byte) to climb off the memory ceiling.</div>
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
              {loading ? "•••" : cur ? fmt(cur.speedup, 1) + "×" : "—"}
            </div>
            <div className="cap">
              {loading ? "measuring on 24 cores…" : cur ? `speedup on ${cur.x} of 24 cores` : "speedup"}
            </div>
          </div>
          <div>
            {loading ? (
              <div className="metric"><span className="k">Compiling &amp; running OpenMP sweep…</span><span className="v accent">live</span></div>
            ) : (
              result?.metrics.map((m, idx) => (
                <div className="metric" key={idx}>
                  <span className="k">{m.k}</span>
                  <span className={"v " + (m.tone || "")}>{m.v}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="lower">
        <section className="card">
          <h2>Scaling · 1 → 24 threads</h2>
          <div className={"charts" + (exp === "bandwidth" ? " two" : "")}>
            <div className="chart">
              <svg ref={scalingRef} />
              <div className="legend">
                <span><i style={{ borderColor: "#33405a" }} />ideal (linear)</span>
                <span><i style={{ borderColor: "var(--accent)" }} />actual speedup</span>
                <span><i style={{ borderColor: "var(--accent2)" }} />efficiency</span>
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
      </div>

      <footer className="note">
        <b>Model</b> numbers come from physically-grounded formulas (Amdahl, cache-coherence cost,
        bandwidth saturation, load-imbalance) in <code>@vhpce/perf-models</code>. <b>Measured</b> numbers
        are real OpenMP runs on this laptop&apos;s 24 cores via the local WSL runner. Same
        <code> ProfileResult </code> seam feeds the charts, metrics, and explanations either way.
      </footer>
    </main>
  );
}
