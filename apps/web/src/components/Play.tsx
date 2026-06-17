"use client";

import { useEffect, useState } from "react";
import { health } from "../lib/runner";
import Race from "./play/Race";
import Badges from "./play/Badges";
import Quiz from "./play/Quiz";
import Sandbox from "./play/Sandbox";
import KernelTuner from "./play/KernelTuner";

// The "Play" hub — the fun-first corner. Tabs are added here as each game lands.
const TABS = [
  { id: "race",    label: "⚡ Race" },
  { id: "quiz",    label: "🧩 Quiz" },
  { id: "sandbox", label: "🔬 Sandbox" },
  { id: "tuner",   label: "🎛 Kernel Tuner" },
  { id: "badges",  label: "🏅 Badges" },
];

export default function Play() {
  const [tab, setTab] = useState("race");
  const [runnerOk, setRunnerOk] = useState(false);

  useEffect(() => {
    let alive = true;
    health().then((j) => { if (alive && j?.ok) setRunnerOk(true); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Play</span> &amp; Learn</h1>
          <div className="sub">The hard truths of parallel performance, the fun way — race kernels head-to-head, test your instincts, and tinker.</div>
        </div>
      </header>

      {!runnerOk && (
        <div className="banner">Some games run real code — start the gateway with <code>docker compose -f infra/docker/compose.yml up</code> to play those. (Offline games still work.)</div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      {tab === "race"    && <Race runnerOk={runnerOk} />}
      {tab === "quiz"    && <Quiz />}
      {tab === "sandbox" && <Sandbox />}
      {tab === "tuner"   && <KernelTuner />}
      {tab === "badges"  && <Badges />}
    </main>
  );
}
