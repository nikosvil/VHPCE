"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { drawScaling } from "@vhpce/viz";
import { fmt } from "@vhpce/profile-schema";
import { health, runJob, type Phase } from "../lib/runner";
import { PRED_BUCKETS, bucketOf, bucketLabel } from "../lib/buckets";
import { EXAMPLES } from "./playground-examples";

// A hands-on "New to HPC? Start here" path: three runs on real cores that tell one story —
// parallel works (hello) -> the obvious sum doesn't scale (atomic) -> the fix scales (reduction).
// Each step runs live through the gateway; if it's offline, the narrative still teaches.

const SWEEP = [1, 2, 4, 8, 16, 24];
const src = (id: string) => EXAMPLES.find((e) => e.id === id)?.source ?? "";

type Step = {
  exId: string;
  kicker: string;
  title: string;
  intro: string;
  expect: string;
  verdict: (sp: number | null) => string;
};

const STEPS: Step[] = [
  {
    exId: "hello",
    kicker: "Step 1 — Meet your threads",
    title: "Run your first parallel program",
    intro:
      "Parallel code splits work across your CPU's cores so a job finishes sooner. This first program just proves the cores are there: it forks a team of threads, and each one does a little work and prints its id. Hit Run — it compiles and runs on 24 real cores.",
    expect:
      "You'll see output from many threads at once. The wall time barely changes as threads are added here, because every thread does the SAME work — that's exactly the trap we look at next.",
    verdict: () =>
      "Those lines came from threads running at the same time. Now let's make them share real work — and watch what goes wrong.",
  },
  {
    exId: "sync",
    kicker: "Step 2 — The trap",
    title: "Sum 60 million numbers… the obvious way",
    intro:
      "Now the threads do something useful: add up 60 million values. The obvious approach — every thread adds into ONE shared counter, guarded by #pragma omp atomic so they don't corrupt it. Run it and watch the speedup.",
    expect:
      "Surprise: 24 cores barely beat 1. Every thread has to take turns at the single counter, so they spend their time waiting in line, not adding. This is a synchronization bottleneck — the #1 reason \"parallel\" code isn't faster.",
    verdict: (sp) =>
      sp == null
        ? "With the gateway running you'd measure almost no speedup — the atomic counter serializes every iteration."
        : sp < 1
          ? `Worse than useless: ${fmt(sp, 1)}× means it ran SLOWER than a single thread. The threads spend their time queuing for the one shared counter instead of adding. There is a better way →`
          : `Only ${fmt(sp, 1)}× on 24 cores — barely faster than one thread. The shared counter serialized everything. There is a better way →`,
  },
  {
    exId: "reduction",
    kicker: "Step 3 — The fix",
    title: "Same sum, one change",
    intro:
      "Same problem, one keyword: reduction(+:sum). Each thread keeps its OWN private partial total, and OpenMP combines them once at the very end — no shared counter, no waiting in line. Run it.",
    expect:
      "Now it scales: many times faster on 24 cores. Same hardware, same arithmetic — the only difference is avoiding contention on shared memory.",
    verdict: (sp) =>
      sp == null
        ? "With the gateway running this scales near-linearly — private partials remove the bottleneck."
        : `${fmt(sp, 1)}× on 24 cores — that's the payoff. You just turned a non-scaling program into a scaling one by changing how threads share memory.`,
  },
];

type Res = { points?: { p: number; ms: number }[]; cores?: number; error?: string; message?: string };

function speedupOf(res?: Res): number | null {
  if (!res?.points?.length) return null;
  const t1 = res.points[0].ms || 1;
  const last = res.points[res.points.length - 1];
  return t1 / (last.ms || 1);
}

function toScaling(points: { p: number; ms: number }[]) {
  const t1 = points[0].ms || 1;
  const sweep = points.map((p) => {
    const sp = t1 / (p.ms || 1);
    return { x: p.p, time: p.ms, speedup: sp, efficiency: sp / p.p };
  });
  return { sweep, current: sweep[sweep.length - 1], experimentId: "firstrun", source: "measured", xUnits: "threads" };
}

export default function FirstRun() {
  const [step, setStep] = useState(0);
  const [runnerOk, setRunnerOk] = useState(false);
  const [predict, setPredict] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, Res>>({});
  const [running, setRunning] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const runId = useRef(0);

  useEffect(() => {
    let alive = true;
    health().then((j) => { if (alive && j?.ok) setRunnerOk(true); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const s = STEPS[step];
  const res = results[step];
  const sp = speedupOf(res);
  const isRunning = running === step;

  // draw the scaling chart whenever this step's result changes
  useEffect(() => {
    if (res?.points && res.points.length && svgRef.current) drawScaling(svgRef.current, toScaling(res.points) as never);
  }, [res]);

  function run() {
    if (running != null) return;
    const my = ++runId.current;
    const idx = step;
    setRunning(idx);
    setPhase("queued");
    runJob(
      { kind: "code", source: src(s.exId), threads: SWEEP, reps: 1 },
      { onStatus: (p) => { if (my === runId.current) setPhase(p); } },
    )
      .then((d) => { if (my === runId.current) setResults((prev) => ({ ...prev, [idx]: d as Res })); })
      .catch((e) => { if (my === runId.current) setResults((prev) => ({ ...prev, [idx]: { error: "network", message: String((e as Error)?.message || e) } })); })
      .finally(() => { if (my === runId.current) { setRunning(null); setPhase(null); } });
  }

  const codeLines = src(s.exId).split("\n");
  const done = step === STEPS.length - 1 && !!res?.points;

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Start</span> Here</h1>
          <div className="sub">New to HPC? Three runs on real cores tell the whole story — parallel works, the obvious way is slow, and the fix.</div>
        </div>
        <div className="fr-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={"fr-dot" + (i === step ? " on" : "") + (results[i]?.points ? " done" : "")} />
          ))}
        </div>
      </header>

      {!runnerOk && (
        <div className="banner">The gateway is offline, so the runs won&apos;t execute — but the story below still teaches. Start it with <code>docker compose -f infra/docker/compose.yml up</code> to run on real cores.</div>
      )}

      <div className="fr-grid">
        <section className="card">
          <div className="fr-kicker">{s.kicker}</div>
          <h2><span>{s.title}</span></h2>
          <p className="learn-blurb">{s.intro}</p>
          <div className="code">
            {codeLines.map((ln, i) => <div key={i} className="ln">{ln || " "}</div>)}
          </div>
          <div className="pg-predict">
            <span className="pg-predict-q">🔮 First, predict: speedup on 24 cores?</span>
            <div className="seg fix">
              {PRED_BUCKETS.map((b) => (
                <button key={b.id} className={predict[step] === b.id ? "on" : ""} onClick={() => setPredict((p) => ({ ...p, [step]: b.id }))}>{b.label}</button>
              ))}
            </div>
          </div>
          <div className="fr-runrow">
            <button className="pg-run" disabled={!runnerOk || isRunning} onClick={run}>
              {isRunning ? (phase === "queued" ? "Queued…" : "Running on 24 cores…") : res?.points ? "Run again ▸" : "Run on 24 cores ▸"}
            </button>
            <div className="fr-nav">
              <button className="step-btn" disabled={step === 0} onClick={() => setStep((x) => Math.max(0, x - 1))}>◀ Back</button>
              <button className="step-btn play" disabled={step === STEPS.length - 1} onClick={() => setStep((x) => Math.min(STEPS.length - 1, x + 1))}>Next ▶</button>
            </div>
          </div>
        </section>

        <section className="card">
          <h2><span>What happens</span></h2>
          {!res && !isRunning && (
            <div className="eb what"><div className="t">Before you run</div><div className="body">{s.expect}</div></div>
          )}
          {isRunning && <div className="askai-note">{phase === "queued" ? "Queued — waiting for the runner…" : "Compiling and sweeping 1 → 24 threads on your cores…"}</div>}
          {res?.error && (
            <div className="pg-cc"><div className="pg-cc-title">{res.error === "compile" ? "Compile error" : "Error"}</div><pre>{res.message || res.error}</pre></div>
          )}
          {res?.points && (
            <>
              <div className="hero">
                <div className="big" style={{ color: sp && sp > 4 ? "var(--good)" : sp && sp > 1.5 ? "var(--warn)" : "var(--bad)" }}>{sp ? fmt(sp, 1) + "×" : "—"}</div>
                <div className="cap">speedup on {res.cores ?? 24} cores</div>
              </div>
              <div className="chart" style={{ marginTop: 8 }}><svg ref={svgRef} /></div>
              {predict[step] && (
                <div className={"pg-reveal " + (bucketOf(sp ?? 0) === predict[step] ? "hit" : "miss")} style={{ marginTop: 12 }}>
                  {bucketOf(sp ?? 0) === predict[step] ? "✓ Nice call — " : "✗ Not what you guessed — "}
                  you predicted <b>{bucketLabel(predict[step])}</b>; measured <b>{fmt(sp ?? 0, 1)}×</b> ({bucketLabel(bucketOf(sp ?? 0))}).
                </div>
              )}
              <div className={"eb " + (sp && sp > 4 ? "exp" : "why")} style={{ marginTop: 12 }}>
                <div className="t">What you just saw</div>
                <div className="body">{s.verdict(sp)}</div>
              </div>
            </>
          )}
        </section>
      </div>

      {done && (
        <section className="card fr-finale" style={{ marginTop: 14 }}>
          <h2><span>🎉 You just learned the core of HPC</span></h2>
          <p className="learn-blurb">The hardware is fast — but <b>how</b> you use it decides everything. The same loop went from no speedup to real speedup with one idea: avoid contention. Where to next?</p>
          <div className="fr-links">
            <Link className="learn-link" href="/playground">▶ Try all 11 examples in the Playground</Link>
            <Link className="learn-link" href="/">→ Isolate each kind of slowdown in the Flagship</Link>
            <Link className="learn-link" href="/compare">→ Compare the textbook model vs the real silicon</Link>
            <Link className="learn-link" href="/reference">→ Look up any OpenMP / MPI / OpenACC directive</Link>
          </div>
        </section>
      )}

      <footer className="note">
        Each step compiles and runs real OpenMP C in a locked-down container, timed across {SWEEP.join(", ")} threads on your CPU.
        Prefer the mechanics first? <Link href="/learn">Learn the basics</Link> shows how threads and ranks work with no code.
      </footer>
    </main>
  );
}
