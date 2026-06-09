"use client";

import { useEffect, useState } from "react";
import { BADGES, getState, EVENT, type BadgeState } from "../../lib/badges";

export default function Badges() {
  const [st, setSt] = useState<BadgeState | null>(null);

  useEffect(() => {
    const read = () => setSt(getState());
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);

  const s = st ?? { unlocked: [], hits: 0, total: 0, streak: 0, best: 0 };
  const acc = s.total ? Math.round((100 * s.hits) / s.total) : 0;

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <section className="card">
        <h2><span>Your prediction record</span></h2>
        <div className="hero">
          <div className="big" style={{ color: s.streak >= 3 ? "var(--good)" : s.streak > 0 ? "var(--warn)" : "var(--muted)" }}>
            {s.streak > 0 ? "🔥 " + s.streak : "—"}
          </div>
          <div className="cap">{s.streak > 0 ? "correct predictions in a row" : "no active streak — make a prediction!"}</div>
        </div>
        {s.total > 0 ? (
          <div>
            <div className="metric"><span className="k">Best streak</span><span className="v accent">{s.best}</span></div>
            <div className="metric"><span className="k">Correct</span><span className="v">{s.hits} / {s.total}</span></div>
            <div className="metric"><span className="k">Accuracy</span><span className={"v " + (acc > 66 ? "good" : acc > 33 ? "warn" : "bad")}>{acc}%</span></div>
          </div>
        ) : (
          <div className="askai-note">Predict a result before you run it — in the <a href="/playground">Playground</a> or on <a href="/start">Start Here</a> — and your streak builds up here.</div>
        )}
      </section>

      <section className="card">
        <h2><span>Badges · {s.unlocked.length}/{BADGES.length}</span></h2>
        <div className="badge-grid">
          {BADGES.map((b) => {
            const got = s.unlocked.includes(b.id);
            return (
              <div key={b.id} className={"badge" + (got ? " got" : "")}>
                <span className="badge-icon">{got ? b.icon : "🔒"}</span>
                <div>
                  <div className="badge-title">{b.title}</div>
                  <div className="badge-desc">{b.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
