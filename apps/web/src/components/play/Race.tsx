"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "@vhpce/profile-schema";
import { runJob } from "../../lib/runner";
import { MATCHUPS, type Racer } from "./race-matchups";

type Time = { t1: number; t24: number };
type Res = { a: Time; b: Time } | null;
type Phase = "idle" | "running" | "racing" | "done";

async function timeOf(source: string): Promise<Time> {
  const d = (await runJob({ kind: "code", source, threads: [1, 24], reps: 1 })) as {
    points?: { p: number; ms: number }[]; error?: string; message?: string;
  };
  if (!d || d.error) throw new Error(d?.message || d?.error || "run failed");
  const pts = d.points || [];
  const at = (p: number) => pts.find((x) => x.p === p)?.ms ?? pts[pts.length - 1]?.ms ?? 1;
  return { t1: at(1), t24: at(24) };
}

const ANIM_MS = 2800;

export default function Race({ runnerOk }: { runnerOk: boolean }) {
  const [mi, setMi] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [res, setRes] = useState<Res>(null);
  const [prog, setProg] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [err, setErr] = useState<string | null>(null);
  const raf = useRef(0);
  const m = MATCHUPS[mi];

  async function go() {
    if (phase === "running") return;
    setErr(null); setRes(null); setProg({ a: 0, b: 0 }); setPhase("running");
    try {
      const a = await timeOf(m.a.source);   // sequential: the gateway runs one job at a time
      const b = await timeOf(m.b.source);
      setRes({ a, b });
      setPhase("racing");
    } catch (e) {
      setErr(String((e as Error)?.message || e));
      setPhase("idle");
    }
  }

  // replay the measured times as an animated race
  useEffect(() => {
    if (phase !== "racing" || !res) return;
    const tMax = Math.max(res.a.t24, res.b.t24) || 1;
    const start = performance.now();
    const tick = (now: number) => {
      const el = now - start;
      setProg({
        a: Math.min(1, (el * tMax) / (res.a.t24 * ANIM_MS)),
        b: Math.min(1, (el * tMax) / (res.b.t24 * ANIM_MS)),
      });
      if (el < ANIM_MS) raf.current = requestAnimationFrame(tick);
      else { setProg({ a: 1, b: 1 }); setPhase("done"); }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [phase, res]);

  const select = (i: number) => { cancelAnimationFrame(raf.current); setMi(i); setPhase("idle"); setRes(null); setProg({ a: 0, b: 0 }); setErr(null); };

  const winner = res ? (res.a.t24 <= res.b.t24 ? "a" : "b") : null;
  const ratio = res ? Math.max(res.a.t24, res.b.t24) / Math.max(1e-6, Math.min(res.a.t24, res.b.t24)) : 0;

  const lane = (side: "a" | "b", r: Racer, t?: Time) => {
    const p = side === "a" ? prog.a : prog.b;
    const isWin = phase === "done" && winner === side;
    const finished = p >= 1;
    return (
      <div className="race-lane">
        <div className="race-lane-head">
          <span className="race-label">{r.label}</span>
          {phase === "done" && t && <span className="race-time">{fmt(t.t24, t.t24 < 10 ? 2 : 0)} ms · {fmt(t.t1 / t.t24, 1)}× scaling</span>}
        </div>
        <div className="race-track">
          <div className={"race-fill " + side + (isWin ? " win" : "")} style={{ width: p * 100 + "%" }} />
          <span className="race-runner" style={{ left: `calc(${p * 100}% - 9px)` }}>{finished ? (isWin ? "🏁" : "●") : "▸"}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <section className="card">
        <h2><span>Pick a matchup</span></h2>
        <div className="seg fix" style={{ flexWrap: "wrap" }}>
          {MATCHUPS.map((mu, i) => (
            <button key={mu.id} className={i === mi ? "on" : ""} onClick={() => select(i)}>{mu.title}</button>
          ))}
        </div>
        <p className="learn-blurb" style={{ margin: "12px 0 0" }}>{m.blurb}</p>
      </section>

      <section className="card">
        <h2><span>The race</span><span className="scene-tag">same work · run on 24 cores</span></h2>
        {lane("a", m.a, res?.a)}
        {lane("b", m.b, res?.b)}
        <div className="race-controls">
          <button className="pg-run" disabled={!runnerOk || phase === "running"} onClick={go}>
            {phase === "running" ? "Compiling & timing both…" : phase === "done" ? "Race again ▸" : "Race! ▸"}
          </button>
          {!runnerOk && <span className="pg-hint">Start the gateway to race on real cores.</span>}
        </div>
        {err && <div className="pg-cc" style={{ marginTop: 10 }}><div className="pg-cc-title">Error</div><pre>{err}</pre></div>}
        {phase === "done" && res && winner && (
          <div className="eb exp" style={{ marginTop: 12 }}>
            <div className="t">Photo finish</div>
            <div className="body">
              <b>{(winner === "a" ? m.a : m.b).label}</b> wins — it finished <b>{fmt(ratio, 1)}× sooner</b> than <b>{(winner === "a" ? m.b : m.a).label}</b>.
              Identical work, identical hardware: the only difference is how the threads coordinate.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
