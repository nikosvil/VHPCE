"use client";

import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { drawScaling } from "@vhpce/viz";
import { fmt } from "@vhpce/profile-schema";

const RUNNER = "http://localhost:8099";
const SWEEP = [1, 2, 4, 8, 12, 16, 20, 24];

const STARTER = `/* OpenMP playground — your code runs on 24 real cores.
   Edit freely, then Run. We compile it and time the WHOLE program across
   thread counts (OMP_NUM_THREADS = 1..24), then chart the scaling.
   Tip: keep the work big enough that timing is meaningful (~100 ms+). */
#include <stdio.h>
#include <omp.h>

int main(void) {
    const long N = 300000000;          /* fixed total work, split across threads */
    double sum = 0.0;
    #pragma omp parallel for reduction(+:sum)
    for (long i = 0; i < N; i++)
        sum += 1.0 / (double)(i + 1);
    printf("sum=%f on %d threads\\n", sum, omp_get_max_threads());
    return 0;
}
`;

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
  const [data, setData] = useState<RunData | null>(null);
  const [profile, setProfile] = useState(false);
  const [runnerOk, setRunnerOk] = useState<boolean | null>(null);
  const [dockerOk, setDockerOk] = useState<boolean | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetch(RUNNER + "/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { setRunnerOk(true); setDockerOk(!!j.docker); })
      .catch(() => { setRunnerOk(false); setDockerOk(false); });
  }, []);

  const points = data?.points || null;
  const result = points && points.length ? buildResult(points) : null;

  useEffect(() => {
    if (result && svgRef.current) drawScaling(svgRef.current, result as never);
  }, [result]);

  async function run() {
    if (running) return;
    setRunning(true);
    setData(null);
    try {
      const res = await fetch(RUNNER + "/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, threads: SWEEP, reps: 2, profile }),
      });
      setData(await res.json());
    } catch (e: unknown) {
      setData({ error: "network", message: String((e as Error)?.message || e) });
    } finally {
      setRunning(false);
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
        <div className="banner">Runner offline — start it with <code>python3 services/runner/server.py</code> in WSL.</div>
      )}
      {runnerOk === true && dockerOk === false && (
        <div className="banner">Docker isn&apos;t ready — start Docker Desktop, enable Ubuntu WSL integration, and build the <code>vhpce-runner</code> image.</div>
      )}

      <div className="pg-grid">
        <section className="card pg-editor">
          <h2>OpenMP C source</h2>
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
              {running ? (profile ? "Running + profiling…" : "Running on 24 cores…") : "Run ▸"}
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
          {running && <div className="askai-note">Compiling and sweeping thread counts on your 24 cores…</div>}
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
                    <span className="k">{m.k}</span>
                    <span className={"v " + m.tone}>{m.v}</span>
                  </div>
                ))}
              </div>
              <div className="chart" style={{ marginTop: 12 }}><svg ref={svgRef} /></div>
              <div className="eb why" style={{ marginTop: 12 }}>
                <div className="t">Reading</div>
                <div className="body">{reading(result)}</div>
              </div>
              {data?.cache && !data.cache.error && (
                <div className="eb how" style={{ marginTop: 12 }}>
                  <div className="t">Cache · cachegrind (1 thread, simulated)</div>
                  <div className="body">
                    <div className="metric"><span className="k">L1 data miss rate</span><span className={"v " + missTone(data.cache.d1MissPct)}>{fmt(data.cache.d1MissPct ?? 0, 1)}%</span></div>
                    <div className="metric"><span className="k">Last-level data miss</span><span className={"v " + missTone(data.cache.lldMissPct)}>{fmt(data.cache.lldMissPct ?? 0, 1)}%</span></div>
                    <div className="metric"><span className="k">Instructions executed</span><span className="v">{(data.cache.irefs ?? 0).toLocaleString()}</span></div>
                    <div style={{ marginTop: 8 }}>{cacheInsight(data.cache)}</div>
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
