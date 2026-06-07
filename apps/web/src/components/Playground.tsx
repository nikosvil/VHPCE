"use client";

import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { drawScaling } from "@vhpce/viz";
import { fmt } from "@vhpce/profile-schema";
import { health, runJob, type Phase } from "../lib/runner";
import { EXAMPLES } from "./playground-examples";
import Term from "./Term";
import { GLOSSARY } from "./glossary";
import Glossed from "./Glossed";

const SWEEP = [1, 2, 4, 8, 12, 16, 20, 24];

// Wrap a label in a hover-glossary <Term> when it matches a known term, else plain text.
const termify = (label: string) =>
  GLOSSARY[label.toLowerCase()] ? <Term k={label.toLowerCase()}>{label}</Term> : label;

const STARTER = EXAMPLES[0].source;   // "Parallel sum" — the default starting point

type Point = { p: number; ms: number };
type Cache = { d1MissPct?: number; lldMissPct?: number; llMissPct?: number; irefs?: number; error?: string };
type RunData = { points?: Point[]; error?: string; message?: string; cores?: number; cache?: Cache };
type Metric = { k: string; v: string; tone: string };

function missTone(p?: number) { const v = p ?? 0; return v > 20 ? "bad" : v > 5 ? "warn" : "good"; }

function cacheInsight(c: Cache): string {
  const d1 = c.d1MissPct ?? 0;
  if (d1 > 20)
    return "High L1 data-cache miss rate — this kernel is memory latency/bandwidth bound, not compute bound. Better locality (cache blocking, contiguous access, a smaller working set) helps far more than adding threads.";
  if (d1 > 5)
    return "Moderate cache misses — some locality is being lost. Restructuring the access order or tiling the loops could help.";
  return "Low miss rate — cache-friendly access; the working set fits the caches well, so scaling is limited by compute or synchronization, not memory.";
}

function buildResult(points: Point[]) {
  const t1 = points[0].ms || 1;
  const sweep = points.map((pt) => {
    const sp = t1 / (pt.ms || 1);
    return { x: pt.p, time: pt.ms, speedup: sp, efficiency: sp / pt.p };
  });
  const current = sweep[sweep.length - 1];
  const peak = sweep.reduce((a, b) => (b.speedup > a.speedup ? b : a), sweep[0]);
  const e = current.efficiency;
  const tone = e > 0.7 ? "good" : e > 0.4 ? "warn" : "bad";
  const metrics: Metric[] = [
    { k: "Wall time", v: fmt(current.time, 0) + " ms", tone: "warn" },
    { k: "Speedup", v: fmt(current.speedup, 1) + "×", tone },
    { k: "Efficiency", v: fmt(e * 100, 0) + "%", tone },
    { k: "Peak speedup", v: fmt(peak.speedup, 1) + "× @ " + peak.x + "t", tone: "accent" },
    { k: "Single-thread", v: fmt(t1, 0) + " ms", tone: "" },
  ];
  return { sweep, current, peak, metrics };
}

function heroColor(e: number) {
  return e > 0.7 ? "var(--good)" : e > 0.4 ? "var(--warn)" : "var(--bad)";
}

function reading(r: ReturnType<typeof buildResult>): string {
  const e = r.current.efficiency, sp = r.current.speedup, peak = r.peak;
  const declines = peak.x < r.current.x && r.current.speedup < peak.speedup * 0.9;
  if (declines)
    return `Speedup peaks at ${fmt(peak.speedup, 1)}× around ${peak.x} threads, then drops — a hallmark of contention: false sharing, lock/atomic serialization, or memory-bandwidth saturation. The flagship experiments isolate each.`;
  if (e > 0.7)
    return `Strong scaling — ${fmt(sp, 1)}× on ${r.current.x} cores (${fmt(e * 100, 0)}% efficiency). The hot path is genuinely parallel and not memory-bound.`;
  if (e > 0.4)
    return `Partial scaling — ${fmt(sp, 1)}× (${fmt(e * 100, 0)}% efficiency). Likely a serial fraction (Amdahl's law), synchronization overhead, or memory pressure. See the flagship's Synchronization and Bandwidth experiments.`;
  return `Weak scaling — only ${fmt(sp, 1)}× (${fmt(e * 100, 0)}% efficiency) on ${r.current.x} cores. A real bottleneck: memory-bandwidth saturation, false sharing, lock contention, or load imbalance — the four flagship experiments each reproduce one.`;
}

export default function Playground() {
  const [source, setSource] = useState(STARTER);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [data, setData] = useState<RunData | null>(null);
  const [profile, setProfile] = useState(false);
  const [runnerOk, setRunnerOk] = useState<boolean | null>(null);
  const [dockerOk, setDockerOk] = useState<boolean | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    health()
      .then((j) => { setRunnerOk(true); setDockerOk(!!j.docker); })
      .catch(() => { setRunnerOk(false); setDockerOk(false); });
  }, []);

  // Deep-link: /playground?ex=<id> preloads a worked example (e.g. from a /learn card).
  useEffect(() => {
    const ex = new URLSearchParams(window.location.search).get("ex");
    const found = ex ? EXAMPLES.find((e) => e.id === ex) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional URL sync on mount (SSR-safe)
    if (found) setSource(found.source);
  }, []);

  const points = data?.points || null;
  const result = points && points.length ? buildResult(points) : null;

  useEffect(() => {
    if (result && svgRef.current) drawScaling(svgRef.current, result as never);
  }, [result]);

  async function run() {
    if (running) return;
    const my = ++runIdRef.current;
    setRunning(true);
    setData(null);
    setPhase("queued");
    try {
      const result = await runJob(
        { kind: "code", source, threads: SWEEP, reps: 2, profile },
        { onStatus: (p) => { if (my === runIdRef.current) setPhase(p); } },
      );
      if (my !== runIdRef.current) return; // superseded by a newer run
      setData(result as RunData);
    } catch (e: unknown) {
      if (my !== runIdRef.current) return;
      setData({ error: "network", message: String((e as Error)?.message || e) });
    } finally {
      if (my === runIdRef.current) { setRunning(false); setPhase(null); }
    }
  }

  // Allow Run whenever the runner is reachable; the Docker banner is a soft hint
  // (a genuinely-down Docker surfaces as a clear error in the result panel). The
  // /health docker probe can briefly read false while Docker Desktop is starting.
  const canRun = runnerOk === true && !running;

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Code</span> Playground</h1>
          <div className="sub">Visual HPC for Engineers · write OpenMP C, run it on 24 real cores, watch it scale</div>
        </div>
      </header>

      {runnerOk === false && (
        <div className="banner">Gateway offline — start it with <code>docker compose -f infra/docker/compose.yml up</code>.</div>
      )}
      {runnerOk === true && dockerOk === false && (
        <div className="banner">Docker isn&apos;t ready — start Docker Desktop, enable Ubuntu WSL integration, and build the images (<code>docker compose -f infra/docker/compose.yml --profile build build</code>).</div>
      )}

      <div className="pg-grid">
        <section className="card pg-editor">
          <h2>OpenMP C source</h2>
          <div className="pg-examples">
            <span className="pg-examples-label">Examples:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.id} className="pg-ex-btn" title={ex.blurb} onClick={() => setSource(ex.source)}>{ex.label}</button>
            ))}
          </div>
          <Editor
            height="440px"
            defaultLanguage="c"
            theme="vs-dark"
            value={source}
            onChange={(v) => setSource(v ?? "")}
            options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, fontFamily: "ui-monospace, monospace", tabSize: 4 }}
          />
          <div className="pg-runrow">
            <button className="pg-run" disabled={!canRun} onClick={run}>
              {running
                ? phase === "queued"
                  ? "Queued…"
                  : profile ? "Running + profiling…" : "Running on 24 cores…"
                : "Run ▸"}
            </button>
            <label className="pg-check">
              <input type="checkbox" checked={profile} onChange={(e) => setProfile(e.target.checked)} />
              Profile cache misses (cachegrind, slower)
            </label>
          </div>
          <div className="pg-hint" style={{ marginTop: 8 }}>
            Compiled <code>-O2 -fopenmp -march=native</code>, timed at {SWEEP.join(", ")} threads (best of 2).
          </div>
        </section>

        <section className="card">
          <h2>Result</h2>
          {!data && !running && (
            <div className="askai-note">Edit the code and hit Run. It compiles and runs in a locked-down container — no network, dropped capabilities, memory/PID/time limits.</div>
          )}
          {running && <div className="askai-note">{phase === "queued" ? "Queued — waiting for the runner…" : "Compiling and sweeping thread counts on your 24 cores…"}</div>}
          {data?.error === "compile" && (
            <div className="pg-cc"><div className="pg-cc-title">Compile error</div><pre>{data.message}</pre></div>
          )}
          {data?.error && data.error !== "compile" && (
            <div className="pg-cc"><div className="pg-cc-title">Error</div><pre>{data.message || data.error}</pre></div>
          )}
          {result && (
            <>
              <div className="hero">
                <div className="big" style={{ color: heroColor(result.current.efficiency) }}>{fmt(result.current.speedup, 1)}×</div>
                <div className="cap">speedup on {result.current.x} of {data?.cores ?? 24} cores</div>
              </div>
              <div>
                {result.metrics.map((m, i) => (
                  <div className="metric" key={i}>
                    <span className="k">{termify(m.k)}</span>
                    <span className={"v " + m.tone}>{m.v}</span>
                  </div>
                ))}
              </div>
              <div className="chart" style={{ marginTop: 12 }}><svg ref={svgRef} /></div>
              <div className="eb why" style={{ marginTop: 12 }}>
                <div className="t">Reading</div>
                <div className="body"><Glossed>{reading(result)}</Glossed></div>
              </div>
              {data?.cache && !data.cache.error && (
                <div className="eb how" style={{ marginTop: 12 }}>
                  <div className="t">Cache · cachegrind (1 thread, simulated)</div>
                  <div className="body">
                    <div className="metric"><span className="k">L1 data miss rate</span><span className={"v " + missTone(data.cache.d1MissPct)}>{fmt(data.cache.d1MissPct ?? 0, 1)}%</span></div>
                    <div className="metric"><span className="k">Last-level data miss</span><span className={"v " + missTone(data.cache.lldMissPct)}>{fmt(data.cache.lldMissPct ?? 0, 1)}%</span></div>
                    <div className="metric"><span className="k">Instructions executed</span><span className="v">{(data.cache.irefs ?? 0).toLocaleString()}</span></div>
                    <div style={{ marginTop: 8 }}><Glossed>{cacheInsight(data.cache)}</Glossed></div>
                  </div>
                </div>
              )}
              {data?.cache?.error && (
                <div className="pg-hint" style={{ marginTop: 10 }}>Cache profiling: {data.cache.error}</div>
              )}
            </>
          )}
        </section>
      </div>

      <footer className="note">
        Your code runs in an isolated Docker container (<code>infra/docker/runner.Dockerfile</code>):
        <code> --network none --cap-drop ALL --read-only</code>, 2 GB memory, 256 PIDs, per-run timeout.
        Timing is whole-program wall clock at each <code>OMP_NUM_THREADS</code> (best of 2) — the same way you&apos;d benchmark by hand.
      </footer>
    </main>
  );
}
