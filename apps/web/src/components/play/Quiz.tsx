"use client";

import { useState } from "react";
import Link from "next/link";
import { recordPredict } from "../../lib/badges";
import { QUESTIONS } from "./quiz-questions";

// ── Inline SVG scaling chart ──────────────────────────────────────────────────
// Draws the actual curve (accent color) + dashed ideal line, no canvas needed.
function CurveChart({ pts }: { pts: { x: number; y: number }[] }) {
  const W = 380, H = 196;
  const ml = 38, mr = 8, mt = 10, mb = 26;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const peakY = Math.max(...pts.map((p) => p.y));
  const yMax  = Math.max(3, peakY * 1.28);
  const idealEnd = Math.min(24, yMax); // clip ideal line to chart top

  const tx = (x: number) => ml + ((x - 1) / 23) * pw;
  const ty = (y: number) => mt + (1 - y / yMax) * ph;

  const pathD  = pts.map((p, i) => `${i === 0 ? "M" : "L"}${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(" ");
  const idealD = `M${tx(1).toFixed(1)},${ty(1).toFixed(1)} L${tx(idealEnd).toFixed(1)},${ty(idealEnd).toFixed(1)}`;

  const xTicks   = [1, 4, 8, 12, 16, 20, 24] as const;
  const yFracs   = [0.25, 0.5, 0.75, 1.0];
  const cy       = mt + ph / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      {/* Grid */}
      {xTicks.map((x) => (
        <line key={`gx${x}`} x1={tx(x)} y1={mt} x2={tx(x)} y2={mt + ph}
              stroke="var(--line)" strokeWidth={0.5} />
      ))}
      {yFracs.map((f) => (
        <line key={`gy${f}`} x1={ml} y1={ty(f * yMax)} x2={ml + pw} y2={ty(f * yMax)}
              stroke="var(--line)" strokeWidth={0.5} />
      ))}

      {/* Ideal line (dashed) */}
      <path d={idealD} stroke="var(--dim)" strokeWidth={1.2} strokeDasharray="4 3" fill="none" />

      {/* Actual curve */}
      <path d={pathD} stroke="var(--accent)" strokeWidth={2.2} fill="none"
            strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots */}
      {pts.map((p) => (
        <circle key={p.x} cx={tx(p.x)} cy={ty(p.y)} r={3} fill="var(--accent)" />
      ))}

      {/* X-axis ticks */}
      {xTicks.map((x) => (
        <text key={`tx${x}`} x={tx(x)} y={H - 5} textAnchor="middle"
              fontSize={9} fill="var(--dim)">{x}</text>
      ))}

      {/* Y-axis ticks */}
      {yFracs.map((f) => {
        const v = f * yMax;
        const label = v < 2 ? v.toFixed(1) : Math.round(v).toString();
        return (
          <text key={`ty${f}`} x={ml - 4} y={ty(v) + 3.5} textAnchor="end"
                fontSize={9} fill="var(--dim)">{label}×</text>
        );
      })}

      {/* Axis labels */}
      <text x={ml + pw / 2} y={H} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
        Threads
      </text>
      <text transform={`translate(${ml / 2 - 2},${cy}) rotate(-90)`}
            textAnchor="middle" fontSize={9.5} fill="var(--muted)">
        Speedup
      </text>

      {/* Legend */}
      <line x1={W - mr - 52} y1={mt + 6} x2={W - mr - 40} y2={mt + 6}
            stroke="var(--dim)" strokeWidth={1} strokeDasharray="4 3" />
      <text x={W - mr - 37} y={mt + 9.5} fontSize={9} fill="var(--dim)">ideal</text>
    </svg>
  );
}

// ── Quiz component ────────────────────────────────────────────────────────────
type Phase = "question" | "revealed" | "done";

export default function Quiz() {
  const [qi,       setQi]      = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase,    setPhase]    = useState<Phase>("question");
  const [answers,  setAnswers]  = useState<boolean[]>([]);

  const q     = QUESTIONS[qi];
  const total = QUESTIONS.length;
  const hit   = selected === q.answer;
  const score = answers.filter(Boolean).length;

  function pick(id: string) {
    if (phase !== "question") return;
    const isHit = id === q.answer;
    setSelected(id);
    setPhase("revealed");
    setAnswers((prev) => [...prev, isHit]);
    recordPredict(isHit); // feeds Oracle / On Fire badge streak
  }

  function advance() {
    if (qi < total - 1) {
      setQi((i) => i + 1);
      setSelected(null);
      setPhase("question");
    } else {
      setPhase("done");
    }
  }

  function restart() {
    setQi(0); setSelected(null); setPhase("question"); setAnswers([]);
  }

  // ── Done screen ──────────────────────────────────────────────────────────
  if (phase === "done") {
    const pct = Math.round((score / total) * 100);
    const verdict =
      pct === 100 ? "Perfect — you know every bottleneck cold. 🏆" :
      pct >= 83   ? "Excellent bottleneck detective. 🔬" :
      pct >= 66   ? "Solid — the curve shapes are sinking in. ✓" :
      pct >= 50   ? "Half right — a few more Flagship runs will sharpen the eye." :
                    "Good start — run the Flagship experiments, then retry.";
    const big = pct >= 66 ? "var(--good)" : pct >= 50 ? "var(--warn)" : "var(--bad)";

    return (
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <section className="card">
          <h2><span>Quiz complete</span></h2>
          <div className="hero">
            <div className="big" style={{ color: big }}>{score}/{total}</div>
            <div className="cap">{verdict}</div>
          </div>
          <div className="quiz-review">
            {QUESTIONS.map((qq, i) => (
              <div key={qq.id} className={"quiz-review-row " + ((answers[i] ?? false) ? "hit" : "miss")}>
                <span>{(answers[i] ?? false) ? "✓" : "✗"}</span>
                <span className="quiz-review-label">
                  {qq.choices.find((c) => c.id === qq.answer)?.label}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button className="pg-run" onClick={restart}>Play again ▸</button>
            <Link className="learn-link" href="/">→ See each bottleneck live: Flagship experiments</Link>
          </div>
        </section>
      </div>
    );
  }

  // ── Question / Revealed screen ───────────────────────────────────────────
  const correctChoice = q.choices.find((c) => c.id === q.answer);

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <section className="card">
        {/* Progress bar */}
        <div className="quiz-progress">
          {QUESTIONS.map((_, i) => (
            <span key={i} className={"quiz-dot" + (i < qi ? " done" : i === qi ? " on" : "")} />
          ))}
          <span className="quiz-count">Q {qi + 1} / {total}</span>
          {qi > 0 && (
            <span className="quiz-score">Score so far: {score}/{qi}</span>
          )}
        </div>

        <h2><span>{q.prompt}</span></h2>
        <p className="learn-blurb" style={{ margin: "0 0 14px" }}>{q.context}</p>

        <div className="quiz-layout">
          {/* Scaling chart */}
          <div className="quiz-chart">
            <CurveChart pts={q.curve} />
          </div>

          {/* Answer choices */}
          <div className="quiz-choices">
            {q.choices.map((c) => {
              let cls = "quiz-choice";
              if (phase === "revealed") {
                if (c.id === q.answer)  cls += " correct";
                else if (c.id === selected) cls += " wrong";
              }
              return (
                <button key={c.id} className={cls}
                        disabled={phase === "revealed"}
                        onClick={() => pick(c.id)}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Explanation after reveal */}
        {phase === "revealed" && (
          <div className={"eb " + (hit ? "exp" : "why")} style={{ marginTop: 14 }}>
            <div className="t">
              {hit ? "✓ Correct — " : "✗ Not quite — the answer is "}
              <b>{correctChoice?.label}</b>
            </div>
            <div className="body">{q.explain}</div>
          </div>
        )}

        {phase === "revealed" && (
          <div style={{ marginTop: 12, textAlign: "right" }}>
            <button className="pg-run" onClick={advance}>
              {qi < total - 1 ? "Next question →" : "See results →"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
