"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Editor from "@monaco-editor/react";
import { drawScaling } from "@vhpce/viz";
import { fmt } from "@vhpce/profile-schema";
import { health, runJob, type Phase } from "../lib/runner";
import { PRED_BUCKETS, bucketOf, bucketLabel } from "../lib/buckets";
import { recordRun, recordPredict } from "../lib/badges";
import { EXAMPLES, type Example } from "./playground-examples";
import Term from "./Term";
import { GLOSSARY } from "./glossary";
import Glossed from "./Glossed";

const SWEEP = [1, 2, 4, 8, 12, 16, 20, 24];

// Wrap a label in a hover-glossary <Term> when it matches a known term, else plain text.
const termify = (label: string) =>
  GLOSSARY[label.toLowerCase()] ? <Term k={label.toLowerCase()}>{label}</Term> : label;

const STARTER = EXAMPLES[0].source;   // the gentlest example — the default starting point

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

// Thread-count explorer: pick a measured count and explain what that choice does to the run.
function threadEffect(r: ReturnType<typeof buildResult>, focusX: number) {
  const sw = r.sweep;
  const fp = sw.find((s) => s.x === focusX) ?? r.current;
  const idx = sw.indexOf(fp), prev = idx > 0 ? sw[idx - 1] : null;
  let note: string;
  if (fp.x === 1) note = "One thread — the serial baseline every speedup is measured against.";
  else if (fp.x > r.peak.x && fp.speedup < r.peak.speedup * 0.97)
    note = `Past the sweet spot: beyond ~${r.peak.x} threads this kernel gets no faster — the extra cores just add contention or wait on memory.`;
  else if (prev) {
    const gained = fp.speedup - prev.speedup;
    const perThread = gained / (fp.x - prev.x);
    if (perThread > 0.55) note = `Scaling well — going ${prev.x}→${fp.x} threads added +${fmt(gained, 1)}×, so most of the extra cores are paying off.`;
    else if (gained < 0.2) note = `Diminishing returns — ${prev.x}→${fp.x} threads added only +${fmt(gained, 1)}×; you're near this kernel's limit.`;
    else note = `Partial gains — ${prev.x}→${fp.x} threads added +${fmt(gained, 1)}×, but efficiency is sliding as coordination overhead grows.`;
  } else note = "";
  return { fp, note };
}

// Plain-language verdict + a "what now?" link to the Flagship experiment that isolates the cause.
type Dx = { tone: string; headline: string; next: { label: string; href: string } };
function diagnose(r: ReturnType<typeof buildResult>, cache?: Cache): Dx {
  const e = r.current.efficiency, sp = r.current.speedup;
  const cacheKnown = (cache?.d1MissPct ?? -1) >= 0;
  const memBound = (cache?.d1MissPct ?? -1) > 20;
  if (e > 0.7)
    return { tone: "good", headline: "Strong scaling — this kernel genuinely parallelizes. 🎉", next: { label: "→ What eventually limits it? Bandwidth Saturation", href: "/?exp=bandwidth" } };
  if (memBound)
    return { tone: "warn", headline: "Memory-bound: cache misses are high, so DRAM bandwidth is the wall — adding cores won't help.", next: { label: "→ See the memory wall: Bandwidth Saturation", href: "/?exp=bandwidth" } };
  if (sp < 1)
    return { tone: "bad", headline: "It ran SLOWER with more threads — a sign of heavy contention or all-core clock throttling.", next: { label: "→ See contention isolated: Synchronization", href: "/?exp=synchronization" } };
  if (cacheKnown)
    return { tone: "warn", headline: "Underscaling, but the cache is healthy — so a serial part, synchronization, or load imbalance is the cap, not memory.", next: { label: "→ Find the culprit: the Flagship experiments", href: "/" } };
  // cache not measured: be honest about the ambiguity and nudge toward the profiler.
  return { tone: "warn", headline: "It stopped scaling — could be memory bandwidth, false sharing, or a serial part. Tick “Profile cache misses” below to separate memory from the rest.", next: { label: "→ Explore the four bottlenecks: the Flagship", href: "/" } };
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
  const [activeEx, setActiveEx] = useState<Example | null>(EXAMPLES[0]);
  const [predict, setPredict] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
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
    if (found) { setSource(found.source); setActiveEx(found); }
  }, []);

  const points = data?.points || null;
  const result = points && points.length ? buildResult(points) : null;
  // thread-count explorer: which measured count is in focus (defaults to the full run, max threads)
  const focusX = result ? (focus ?? result.current.x) : null;
  const te = result && focusX != null ? threadEffect(result, focusX) : null;

  useEffect(() => {
    if (result && svgRef.current) drawScaling(svgRef.current, { ...result, focusX } as never);
  }, [result, focusX]);

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
      const d = result as RunData;
      setData(d);
      if (d.points && d.points.length) {
        const r = buildResult(d.points);
        recordRun({ speedup: r.current.speedup, profiled: profile && !!d.cache });
        if (predict) recordPredict(bucketOf(r.current.speedup) === predict);
      }
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
              <button key={ex.id} className={"pg-ex-btn" + (activeEx?.id === ex.id ? " on" : "")} title={ex.blurb} onClick={() => { setSource(ex.source); setActiveEx(ex); setPredict(null); }}>{ex.label}</button>
            ))}
          </div>
          {activeEx && (
            <div className="pg-coach">
              <span className="pg-coach-blurb">{activeEx.blurb}</span>
              {activeEx.tryThis && <span className="pg-coach-try"><b>▶ Try:</b> {activeEx.tryThis}</span>}
            </div>
          )}
          <Editor
            height="440px"
            defaultLanguage="c"
            theme="vs-dark"
            value={source}
            onChange={(v) => setSource(v ?? "")}
            options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, fontFamily: "ui-monospace, monospace", tabSize: 4 }}
          />
          <div className="pg-predict">
            <span className="pg-predict-q">🔮 Predict the speedup on 24 cores:</span>
            <div className="seg fix">
              {PRED_BUCKETS.map((b) => (
                <button key={b.id} className={predict === b.id ? "on" : ""} onClick={() => setPredict(b.id)}>{b.label}</button>
              ))}
            </div>
          </div>
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
            <div className="askai-note">Pick an example (or write your own), make a prediction, and hit Run. It compiles and benchmarks on 24 real cores, then explains the result in plain English — and points you to the experiment that isolates whatever it finds. New here? Try <Link href="/start">the guided first run →</Link></div>
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
              {predict && (
                <div className={"pg-reveal " + (bucketOf(result.current.speedup) === predict ? "hit" : "miss")}>
                  {bucketOf(result.current.speedup) === predict ? "✓ Nice call — " : "✗ Not quite — "}
                  you predicted <b>{bucketLabel(predict)}</b>; measured <b>{fmt(result.current.speedup, 1)}×</b> ({bucketLabel(bucketOf(result.current.speedup))}).
                </div>
              )}
              <div>
                {result.metrics.map((m, i) => (
                  <div className="metric" key={i}>
                    <span className="k">{termify(m.k)}</span>
                    <span className={"v " + m.tone}>{m.v}</span>
                  </div>
                ))}
              </div>
              <div className="chart" style={{ marginTop: 12 }}><svg ref={svgRef} /></div>
              {te && (
                <div className="pg-threads">
                  <div className="pg-threads-label">🧵 Explore thread count — how many cores actually help?</div>
                  <div className="seg fix">
                    {result.sweep.map((s) => (
                      <button key={s.x} className={focusX === s.x ? "on" : ""} onClick={() => setFocus(s.x)}>{s.x}</button>
                    ))}
                  </div>
                  <div className="pg-threads-read">
                    At <b>{te.fp.x} thread{te.fp.x > 1 ? "s" : ""}</b>: <b style={{ color: heroColor(te.fp.efficiency) }}>{fmt(te.fp.speedup, 1)}×</b> speedup · {fmt(te.fp.efficiency * 100, 0)}% efficiency. {te.note}
                  </div>
                </div>
              )}
              {(() => {
                const dx = diagnose(result, data?.cache);
                return (
                  <div className="eb why" style={{ marginTop: 12 }}>
                    <div className="t">Reading</div>
                    <div className="body">
                      <div className={"pg-verdict " + dx.tone}>{dx.headline}</div>
                      <Glossed>{reading(result)}</Glossed>
                      <Link className="learn-link" href={dx.next.href}>{dx.next.label}</Link>
                    </div>
                  </div>
                );
              })()}
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
