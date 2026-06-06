"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { learnScenes, type LearnState } from "./learn/scenes";

type Control =
  | { kind: "none" }
  | { kind: "slider"; label: string; min: number; max: number }
  | { kind: "seg"; key: "mode" | "collective"; options: string[] };

type Concept = {
  id: keyof typeof learnScenes;
  group: "OpenMP" | "MPI";
  name: string;
  blurb: string;
  code: string;
  highlight: number[];
  control: Control;
  steps: string[];
  key: string;
  link: { href: string; label: string };
};

const CONCEPTS: Concept[] = [
  {
    id: "forkJoin", group: "OpenMP", name: "Fork – Join",
    blurb: "A program starts with one thread. #pragma omp parallel forks a team that runs together, then joins back to one.",
    code: `printf("start\\n");        // one thread (the master)

#pragma omp parallel      // fork: spawn a team of N threads
{
    int id = omp_get_thread_num();
    work(id);             // every thread runs this
}                         // join: wait for all, back to one

printf("done\\n");`,
    highlight: [2],
    control: { kind: "slider", label: "Threads", min: 2, max: 8 },
    steps: [
      "The program runs with one thread — the master.",
      "#pragma omp parallel forks a team of N threads.",
      "All N threads execute the block at the same time.",
      "At the closing } the threads join — back to one master.",
    ],
    key: "Parallelism lives inside the parallel region; outside it, a single thread runs.",
    link: { href: "/playground?ex=hello", label: "▶ Run a parallel program in the Playground" },
  },
  {
    id: "parallelFor", group: "OpenMP", name: "Parallel For",
    blurb: "parallel for divides a loop's iterations across the threads — each does a slice, all at the same time.",
    code: `double sum = 0;

#pragma omp parallel for   // split the iterations across threads
for (int i = 0; i < 12; i++)
    compute(i);`,
    highlight: [2],
    control: { kind: "slider", label: "Threads", min: 1, max: 6 },
    steps: ["The 12 iterations are dealt to the threads in chunks — each thread runs its slice at the same time, so wall-time ≈ work ÷ threads."],
    key: "Splitting a loop is the most common way to parallelize. Wall-time ≈ work ÷ threads (until overhead bites — see the Flagship).",
    link: { href: "/playground?ex=reduction", label: "▶ Run a parallel loop in the Playground" },
  },
  {
    id: "sharedPrivate", group: "OpenMP", name: "Shared vs Private",
    blurb: "OpenMP threads share one address space. Writing a shared variable races; a reduction gives each thread a private partial, combined once.",
    code: `double sum = 0;

// shared    : #pragma omp parallel for            (threads race on sum)
// private   : each thread keeps its own partial
// reduction : partials are combined once at the end  ✓
#pragma omp parallel for reduction(+:sum)
for (int i = 0; i < N; i++)
    sum += a[i];`,
    highlight: [5],
    control: { kind: "seg", key: "mode", options: ["shared", "private", "reduction"] },
    steps: ["Pick a strategy and watch how the threads touch memory."],
    key: "Shared memory means unguarded shared writes race. reduction is the safe, fast pattern.",
    link: { href: "/playground?ex=falsesharing", label: "▶ See sharing wreck scaling in the Playground" },
  },
  {
    id: "ranksMemory", group: "MPI", name: "Ranks & Memory",
    blurb: "MPI runs N separate processes (ranks), each with its OWN private memory — the opposite of OpenMP's shared memory.",
    code: `int rank, size;
MPI_Comm_rank(MPI_COMM_WORLD, &rank);  // who am I? (0 .. size-1)
MPI_Comm_size(MPI_COMM_WORLD, &size);  // how many of us?

double x = rank * 10.0;   // each rank has its OWN x`,
    highlight: [1],
    control: { kind: "slider", label: "Ranks", min: 2, max: 6 },
    steps: ["Each MPI rank is its own process with its own private memory — they share nothing directly."],
    key: "MPI = separate processes, separate memory. They cooperate only by passing messages.",
    link: { href: "/?exp=mpiHalo", label: "→ See MPI scaling measured in the Flagship" },
  },
  {
    id: "sendRecv", group: "MPI", name: "Send / Recv",
    blurb: "Because memory isn't shared, ranks exchange data by messages: one rank sends, another receives.",
    code: `if (rank == 0)
    MPI_Send(&x, 1, MPI_INT, 1, 0, MPI_COMM_WORLD);   // → to rank 1
else if (rank == 1)
    MPI_Recv(&x, 1, MPI_INT, 0, 0, MPI_COMM_WORLD,    // ← from rank 0
             MPI_STATUS_IGNORE);`,
    highlight: [1, 4],
    control: { kind: "none" },
    steps: [
      "Before: rank 0 holds the value; rank 1 has nothing.",
      "MPI_Send / MPI_Recv: the value travels across as a message.",
      "Delivered: rank 1 now has its own copy of the value.",
    ],
    key: "Point-to-point messaging is the building block of MPI: one rank sends, another receives.",
    link: { href: "/?exp=mpiHalo", label: "→ See MPI scaling measured in the Flagship" },
  },
  {
    id: "collectives", group: "MPI", name: "Collectives",
    blurb: "Collectives move data among ALL ranks in one call: broadcast, scatter, gather, and reduce.",
    code: `MPI_Bcast(&v, 1, MPI_INT, root, comm);          // root → everyone
MPI_Scatter(send, 1, .., recv, 1, .., root, comm); // root splits an array
MPI_Gather (send, 1, .., recv, 1, .., root, comm); // pieces → root
MPI_Reduce (send, &sum, 1, .., MPI_SUM, root, comm); // combine → root`,
    highlight: [],
    control: { kind: "seg", key: "collective", options: ["broadcast", "scatter", "gather", "reduce"] },
    steps: ["Choose a collective to see how data moves between the root and the ranks."],
    key: "One collective call replaces a hand-written loop of sends/recvs — broadcast, scatter, gather, reduce.",
    link: { href: "/?exp=mpiHalo", label: "→ See MPI scaling measured in the Flagship" },
  },
];

export default function Learn() {
  const [id, setId] = useState<Concept["id"]>("forkJoin");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [n, setN] = useState(4);
  const [mode, setMode] = useState("shared");
  const [collective, setCollective] = useState("broadcast");

  const concept = CONCEPTS.find((c) => c.id === id)!;
  const multiStep = concept.steps.length > 1;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<LearnState & { id: Concept["id"] }>({ id, step, threads: n, mode, collective });
  // keep the ref fresh for the rAF loop (in an effect, not during render)
  useEffect(() => { stateRef.current = { id, step, threads: n, mode, collective }; });

  const selectConcept = (cid: Concept["id"]) => { setId(cid); setStep(0); setPlaying(true); };

  // auto-advance steps for multi-step concepts
  useEffect(() => {
    if (!playing || !multiStep) return;
    const t = setInterval(() => setStep((s) => (s + 1) % concept.steps.length), 1900);
    return () => clearInterval(t);
  }, [playing, multiStep, concept.steps.length]);

  // canvas + animation loop (reads latest state via ref; mirrors the Flagship pattern)
  useEffect(() => {
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
      const s = stateRef.current;
      const fn = learnScenes[s.id];
      if (fn) fn(ctx, w, h, now, s);
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
  }, []);

  // reduced-motion: redraw a static frame when state changes
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduce) return;
    const cv = canvasRef.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const rect = cv.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    learnScenes[id]?.(ctx, rect.width, rect.height, 0, stateRef.current);
  }, [id, step, n, mode, collective]);

  const ctrlVal = concept.control.kind === "seg"
    ? (concept.control.key === "mode" ? mode : collective)
    : "";
  const setSeg = (key: "mode" | "collective", v: string) => (key === "mode" ? setMode(v) : setCollective(v));
  const codeLines = concept.code.split("\n");

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Learn</span> the Basics</h1>
          <div className="sub">How OpenMP &amp; MPI actually work — watch the mechanics, no install. Then see <Link href="/">why parallel code gets slower →</Link></div>
        </div>
      </header>

      <nav className="tabs">
        <span className="tabgroup">OpenMP</span>
        {CONCEPTS.filter((c) => c.group === "OpenMP").map((c) => (
          <button key={c.id} className={"tab" + (c.id === id ? " active" : "")} onClick={() => selectConcept(c.id)}>{c.name}</button>
        ))}
        <span className="tabgroup">MPI</span>
        {CONCEPTS.filter((c) => c.group === "MPI").map((c) => (
          <button key={c.id} className={"tab" + (c.id === id ? " active" : "")} onClick={() => selectConcept(c.id)}>{c.name}</button>
        ))}
      </nav>

      <div className="learn-grid">
        <section className="card learn-canvas">
          <h2><span>{concept.group} · {concept.name}</span></h2>
          <canvas className="viz" ref={canvasRef} />
          <div className="step-row">
            {multiStep && (
              <>
                <button className="step-btn" onClick={() => { setPlaying(false); setStep((s) => (s - 1 + concept.steps.length) % concept.steps.length); }}>◀ Prev</button>
                <button className={"step-btn play"} onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
                <button className="step-btn" onClick={() => { setPlaying(false); setStep((s) => (s + 1) % concept.steps.length); }}>Next ▶</button>
                <span className="pg-hint">step {step + 1} / {concept.steps.length}</span>
              </>
            )}
            {concept.control.kind === "slider" && (
              <label className="learn-slider">
                {concept.control.label}: <b>{n}</b>
                <input type="range" min={concept.control.min} max={concept.control.max} step={1} value={n}
                  onChange={(e) => setN(+e.target.value)} />
              </label>
            )}
            {concept.control.kind === "seg" && (
              <div className="seg fix">
                {concept.control.options.map((o) => (
                  <button key={o} className={ctrlVal === o ? "on" : ""} onClick={() => setSeg((concept.control as { key: "mode" | "collective" }).key, o)}>{o}</button>
                ))}
              </div>
            )}
          </div>
          <div className="eb what" style={{ marginTop: 12 }}>
            <div className="t">What&apos;s happening</div>
            <div className="body">{concept.steps[Math.min(step, concept.steps.length - 1)]}</div>
          </div>
        </section>

        <section className="card">
          <h2><span>The idea</span></h2>
          <p className="learn-blurb">{concept.blurb}</p>
          <div className="code">
            {codeLines.map((ln, i) => (
              <div key={i} className={"ln" + (concept.highlight.includes(i) ? " hl" : "")}>{ln || " "}</div>
            ))}
          </div>
          <div className="eb how" style={{ marginTop: 12 }}>
            <div className="t">Key idea</div>
            <div className="body">{concept.key}</div>
          </div>
          <Link className="learn-link" href={concept.link.href}>{concept.link.label}</Link>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h2><span>Key terms</span></h2>
        <div className="terms">
          <div><b>Thread</b> — a stream of execution inside one process; OpenMP threads share memory.</div>
          <div><b>Process / Rank</b> — an independent program with its own memory; MPI numbers them 0…size−1.</div>
          <div><b>Shared vs distributed memory</b> — OpenMP threads see one address space; MPI ranks don&apos;t — they message.</div>
          <div><b>Fork–join</b> — a team of threads is spawned for a parallel region, then merged back.</div>
          <div><b>Reduction</b> — combine each thread/rank&apos;s partial result into one (e.g. a sum).</div>
          <div><b>Collective</b> — an MPI call involving all ranks at once: broadcast, scatter, gather, reduce.</div>
        </div>
      </section>

      <footer className="note">
        These are <b>conceptual animations</b> (no code is executed here) to build intuition for how the runtimes
        divide work. When you&apos;re ready for real numbers, the <Link href="/">Flagship</Link> runs measured OpenMP/MPI/GPU
        experiments and the <Link href="/playground">Playground</Link> compiles and benchmarks your own OpenMP C.
      </footer>
    </main>
  );
}
