"use client";

import Link from "next/link";

// A friendly, explanatory front door: what VHPCE is, the one big idea, a guided map of every
// section, and what the real-hardware gateway adds. No code, no jargon walls — just orientation.

type Card = { href: string; tag: string; title: string; body: string };

const SECTIONS: Card[] = [
  { href: "/start", tag: "5 min", title: "Start Here", body: "Brand new to parallel computing? Three live runs on real cores tell the whole story — parallel works, the obvious way is slow, and the one-line fix." },
  { href: "/learn", tag: "no code", title: "Learn the Basics", body: "How OpenMP threads and MPI ranks actually divide up work — animated, step by step, nothing to install." },
  { href: "/reference", tag: "~190 entries", title: "Command Reference", body: "Every OpenMP, MPI & OpenACC directive, each with a looping visual and a C/Fortran toggle. Filter to the ★ Essentials when it's a lot." },
  { href: "/playground", tag: "runs your code", title: "Code Playground", body: "Write OpenMP C (or load an example), run it on 24 real cores, and watch it scale — or not. It explains the result in plain English." },
  { href: "/", tag: "9 experiments", title: "Flagship", body: "The heart of it: nine experiments isolating exactly why parallel code gets slower — false sharing, contention, bandwidth, GPU occupancy, coalescing, divergence, atomics. Flip the fix, watch the hardware react." },
  { href: "/compare", tag: "model vs real", title: "Compare", body: "The same kernel through the textbook model and the real silicon, on one chart — so you can see where the napkin math and the hardware disagree, and why." },
  { href: "/lab", tag: "mini-lab", title: "Heat Lab", body: "A 2-D heat-equation playground: watch a stencil converge, and see the OpenMP / MPI / GPU code that drives each cell." },
];

export default function Intro() {
  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Welcome to</span> VHPCE</h1>
          <div className="sub">Visual HPC for Engineers — learn why parallel code gets slower (and faster) by running real experiments on real hardware and watching the physics.</div>
        </div>
      </header>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2><span>The one big idea</span></h2>
        <p className="learn-blurb">
          Throwing more cores at a program rarely makes it that many times faster — and sometimes makes it <i>slower</i>.
          Performance isn&apos;t magic: it&apos;s decided by how your code touches <b>memory</b>, how threads <b>coordinate</b>,
          and what the <b>hardware</b> can actually sustain. VHPCE makes those forces visible.
        </p>
        <p className="learn-blurb" style={{ marginBottom: 0 }}>
          Everything here is shown two ways: a <b style={{ color: "var(--accent2)" }}>model</b> — the textbook prediction — and a
          <b style={{ color: "var(--accent)" }}> measured</b> run on this very machine. When they agree, the theory holds; when they
          diverge, the gap teaches you something the textbook left out. That&apos;s the whole philosophy.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2><span>Find your way around</span></h2>
        <div className="intro-grid">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="intro-card">
              <div className="intro-card-head">
                <span className="intro-card-title">{s.title}</span>
                <span className="intro-card-tag">{s.tag}</span>
              </div>
              <div className="intro-card-body">{s.body}</div>
            </Link>
          ))}
        </div>
        <p className="learn-blurb" style={{ margin: "14px 0 0" }}>
          Not sure where to begin? <Link className="learn-link" href="/start" style={{ marginTop: 0 }}>▶ Start Here</Link> — it&apos;s a five-minute, hands-on tour.
        </p>
      </section>

      <section className="card">
        <h2><span>Running on real hardware</span></h2>
        <p className="learn-blurb">
          The <b>measured</b> numbers come from a small, sandboxed gateway that compiles and runs code on this machine:
          a <b>24-core CPU</b> for OpenMP &amp; MPI, and an <b>RTX 5060 GPU</b> for the CUDA lessons. Your code runs in a
          locked-down container (no network, dropped capabilities, time and memory limits) — it&apos;s safe to experiment.
        </p>
        <p className="learn-blurb" style={{ marginBottom: 0 }}>
          No gateway running? You still get <b>every model curve, animation, and the full reference</b> — the platform just
          shows the predictions instead of live measurements. To switch the real runs on, start it with{" "}
          <code>docker compose -f infra/docker/compose.yml up</code>, then look for the green <b>Measured</b> pill.
        </p>
      </section>

      <footer className="note">
        Built for everyone from the curious beginner to the practising engineer. The mechanics are real:
        physically-grounded models, measured timings, and conceptual animations — no hand-waving.
        Jump in at <Link href="/start">Start Here</Link> or explore the <Link href="/">Flagship</Link>.
      </footer>
    </main>
  );
}
