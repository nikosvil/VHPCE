"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "./Glossed";

// 2D heat-equation mini-lab (P5 domain module). Explicit finite-difference (FTCS) Jacobi
// sweep of u_t = α∇²u on an N×N grid, animated as a heatmap — fully client-side/offline.
// The decomposition overlay shows how the same stencil parallelizes under OpenMP (shared
// rows), MPI (blocks + halo cells → the Halo Exchange experiment), and GPU (tiled blocks).

const N = 128;
const idx = (i: number, j: number) => i * N + j;
// cold → hot colour ramp (project palette: ink → accent → accent2 → warn → bad)
const STOPS: [number, number, number][] = [[10, 15, 26], [76, 201, 240], [179, 136, 255], [255, 180, 84], [255, 93, 115]];
function ramp(t: number): [number, number, number] {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const seg = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(seg));
  const f = seg - i, a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Seed: cold plate (edges held at 0) with a persistent hot square in the centre.
function seed(u: Float32Array) {
  u.fill(0);
  const lo = Math.floor(N * 0.42), hi = Math.ceil(N * 0.58);
  for (let i = lo; i < hi; i++) for (let j = lo; j < hi; j++) u[idx(i, j)] = 1;
}

// The SAME stencil, written for each execution model — the direct tie to OpenMP/MPI/GPU.
const MODELS: Record<string, { label: string; t: string; note: string; code: string; links: { href: string; label: string }[] }> = {
  off: {
    label: "serial", t: "Serial baseline",
    note: "One thread sweeps the whole grid each step — the baseline every parallel version below speeds up.",
    code: `for (i = 1; i < N-1; i++)
  for (j = 1; j < N-1; j++)
    un[i][j] = u[i][j] + a*(u[i-1][j] + u[i+1][j]
             + u[i][j-1] + u[i][j+1] - 4*u[i][j]);`,
    links: [{ href: "/learn", label: "what parallel means →" }],
  },
  openmp: {
    label: "OpenMP", t: "OpenMP — shared memory",
    note: "Threads share the one grid, so you just split the rows — no copies, no halos. collapse(2) flattens the i,j loops for more parallelism.",
    code: `#pragma omp parallel for collapse(2)
for (i = 1; i < N-1; i++)
  for (j = 1; j < N-1; j++)
    un[i][j] = u[i][j] + a*(u[i-1][j] + u[i+1][j]
             + u[i][j-1] + u[i][j+1] - 4*u[i][j]);`,
    links: [{ href: "/reference?id=omp_parallel_for", label: "omp parallel for" }, { href: "/reference?id=omp_collapse", label: "collapse" }],
  },
  mpi: {
    label: "MPI", t: "MPI — halo exchange",
    note: "Each rank owns a slab of rows and must receive its neighbours' edge rows (the halo) before it can compute — that exchange is the communication the Halo Exchange experiment measures.",
    code: `/* exchange halo rows with neighbours, THEN compute */
MPI_Sendrecv(&u[lo][0],   N, MPI_DOUBLE, up,   0,
             &u[hi+1][0], N, MPI_DOUBLE, down, 0, comm, &st);
MPI_Sendrecv(&u[hi][0],   N, MPI_DOUBLE, down, 1,
             &u[lo-1][0], N, MPI_DOUBLE, up,   1, comm, &st);
for (i = lo; i <= hi; i++)              /* local rows only */
  for (j = 1; j < N-1; j++)
    un[i][j] = u[i][j] + a*( /* 4-neighbour stencil */ );`,
    links: [{ href: "/reference?id=mpi_sendrecv", label: "MPI_Sendrecv" }, { href: "/?exp=mpiHalo", label: "Halo Exchange experiment" }],
  },
  gpu: {
    label: "GPU / CUDA", t: "GPU — one thread per cell",
    note: "Launch a 2-D grid of thread blocks, one thread per cell. Fast versions stage each block's tile (plus its halo) into shared memory to cut global-memory traffic.",
    code: `__global__ void step(const double *u, double *un, int N, double a) {
  int i = blockIdx.y*blockDim.y + threadIdx.y;
  int j = blockIdx.x*blockDim.x + threadIdx.x;
  if (i>0 && i<N-1 && j>0 && j<N-1)
    un[i*N+j] = u[i*N+j] + a*(u[(i-1)*N+j] + u[(i+1)*N+j]
              + u[i*N+j-1] + u[i*N+j+1] - 4*u[i*N+j]);
}`,
    links: [{ href: "/?exp=cuda", label: "GPU Occupancy experiment" }],
  },
};

export default function Lab() {
  const [playing, setPlaying] = useState(true);
  const [alpha, setAlpha] = useState(0.20);   // diffusivity (stable for ≤ 0.25)
  const [speed, setSpeed] = useState(3);       // Jacobi sweeps per animation frame
  const [decomp, setDecomp] = useState<"off" | "openmp" | "mpi" | "gpu">("off");
  const [iter, setIter] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uRef = useRef<Float32Array>(new Float32Array(N * N));
  const vRef = useRef<Float32Array>(new Float32Array(N * N));
  const cfg = useRef({ playing, alpha, speed, decomp });
  useEffect(() => { cfg.current = { playing, alpha, speed, decomp }; });   // keep fresh for the rAF loop
  const iterRef = useRef(0);
  const residRef = useRef(1);            // max |Δu| this sweep (the residual)
  const histRef = useRef<number[]>([]);   // recent residuals, for the convergence plot
  const convRef = useRef<HTMLCanvasElement>(null);

  const reset = () => { seed(uRef.current); iterRef.current = 0; setIter(0); histRef.current = []; };

  useEffect(() => {
    seed(uRef.current);
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const off = document.createElement("canvas"); off.width = N; off.height = N;
    const octx = off.getContext("2d");
    if (!octx) return;
    const img = octx.createImageData(N, N);
    let w = 0, h = 0, raf = 0, frame = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const resize = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };
    const step = (a: number) => {
      const u = uRef.current, v = vRef.current;
      let maxd = 0;
      for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
        const c = idx(i, j);
        const nv = u[c] + a * (u[c - N] + u[c + N] + u[c - 1] + u[c + 1] - 4 * u[c]);
        const dd = nv - u[c]; const ad = dd < 0 ? -dd : dd;
        if (ad > maxd) maxd = ad;
        v[c] = nv;
      }
      residRef.current = maxd;
      // boundaries held cold (Dirichlet 0); central source held hot
      for (let i = 0; i < N; i++) { v[idx(i, 0)] = 0; v[idx(i, N - 1)] = 0; v[idx(0, i)] = 0; v[idx(N - 1, i)] = 0; }
      const lo = Math.floor(N * 0.42), hi = Math.ceil(N * 0.58);
      for (let i = lo; i < hi; i++) for (let j = lo; j < hi; j++) v[idx(i, j)] = 1;
      uRef.current = v; vRef.current = u;
    };
    const drawOverlay = (mode: string) => {
      if (mode === "off") return;
      const lineC = "#4cc9f0";
      const line = (x1: number, y1: number, x2: number, y2: number, col: string, wd = 1.5) => { ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      let cap = "", col = lineC;
      if (mode === "openmp") {
        for (let k = 1; k < 4; k++) line(0, (h * k) / 4, w, (h * k) / 4, lineC, 1.5);
        cap = "OpenMP: threads share one grid in memory — just split the rows, no halos."; col = lineC;
      } else if (mode === "mpi") {
        const P = 3, t = Math.max(3, w / N);
        ctx.fillStyle = "rgba(255,180,84,.34)";
        for (let k = 1; k < P; k++) { ctx.fillRect((w * k) / P - t, 0, 2 * t, h); ctx.fillRect(0, (h * k) / P - t, w, 2 * t); }
        for (let k = 1; k < P; k++) { line((w * k) / P, 0, (w * k) / P, h, lineC, 1.5); line(0, (h * k) / P, w, (h * k) / P, lineC, 1.5); }
        cap = "MPI: each rank owns a block + a halo ring exchanged with neighbours every step."; col = "#ffb454";
      } else {
        const P = 8;
        for (let k = 1; k < P; k++) { line((w * k) / P, 0, (w * k) / P, h, "rgba(61,220,151,.4)", 1); line(0, (h * k) / P, w, (h * k) / P, "rgba(61,220,151,.4)", 1); }
        cap = "GPU: a grid of thread blocks; each can stage its tile into fast shared memory."; col = "#3ddc97";
      }
      ctx.fillStyle = col; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(cap, w / 2, h - 12);
    };
    const draw = () => {
      const u = uRef.current, d = img.data;
      for (let k = 0; k < N * N; k++) { const [r, g, b] = ramp(u[k]); const o = k * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0, w, h);
      drawOverlay(cfg.current.decomp);
    };
    // mini log-scale convergence chart (residual vs step). Fixed internal resolution
    // (CSS scales it) — never read the rendered size, which would feed back and blow up.
    const cc = convRef.current;
    const cctx = cc?.getContext("2d") ?? null;
    const LO = -7, CW = 480, CH = 130;   // log10 floor 1e-7; internal canvas size
    if (cc) { cc.width = CW; cc.height = CH; }
    const drawConv = () => {
      if (!cc || !cctx) return;
      const hist = histRef.current;
      cctx.clearRect(0, 0, CW, CH);
      cctx.strokeStyle = "#121b28"; cctx.lineWidth = 1;
      for (let e = LO; e <= 0; e++) { const y = CH - ((e - LO) / -LO) * CH; cctx.beginPath(); cctx.moveTo(0, y); cctx.lineTo(CW, y); cctx.stroke(); }
      cctx.fillStyle = "#8a9bb4"; cctx.font = "15px ui-monospace, monospace"; cctx.textAlign = "left";
      cctx.fillText("max |Δu| = " + residRef.current.toExponential(1), 6, 18);
      if (hist.length < 2) return;
      const yOf = (r: number) => { const e = Math.max(LO, Math.log10(Math.max(r, 1e-12))); return CH - ((e - LO) / -LO) * CH; };
      const diverging = hist[hist.length - 1] > hist[0] * 1.5;
      cctx.strokeStyle = diverging ? "#ff5d73" : "#3ddc97"; cctx.lineWidth = 2.5; cctx.beginPath();
      hist.forEach((r, i) => { const x = (i / (hist.length - 1)) * CW; const y = yOf(r); if (i) cctx.lineTo(x, y); else cctx.moveTo(x, y); });
      cctx.stroke();
      cctx.textAlign = "right"; cctx.fillStyle = diverging ? "#ff5d73" : "#5e6e88";
      cctx.fillText(diverging ? "diverging!" : "converging", CW - 6, 18);
    };
    const loop = () => {
      if (cfg.current.playing) {
        for (let s = 0; s < cfg.current.speed; s++) { step(cfg.current.alpha); iterRef.current++; }
        const hist = histRef.current; hist.push(residRef.current); if (hist.length > 180) hist.shift();
        if (++frame % 6 === 0) setIter(iterRef.current);
      }
      draw();
      drawConv();
      raf = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener("resize", resize);
    if (!reduce) raf = requestAnimationFrame(loop); else draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Heat</span> Lab</h1>
          <div className="sub">A 2-D heat-equation stencil, live — and how the same computation parallelizes across OpenMP, MPI &amp; the GPU.</div>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Controls</h2>
          <div className="ctrl">
            <div className="step-row" style={{ marginTop: 0 }}>
              <button className="step-btn play" onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
              <button className="step-btn" onClick={reset}>↻ Reset</button>
              <span className="pg-hint">step {iter.toLocaleString()}</span>
            </div>
          </div>
          <div className="ctrl">
            <label>Diffusivity α<b>{alpha.toFixed(2)}</b></label>
            <input type="range" min={0.02} max={0.25} step={0.01} value={alpha} onChange={(e) => setAlpha(+e.target.value)} />
            <div className="fixhint">The explicit scheme is stable only for α ≤ 0.25 — push it higher and watch it blow up.</div>
          </div>
          <div className="ctrl">
            <label>Speed (sweeps / frame)<b>{speed}</b></label>
            <input type="range" min={1} max={10} step={1} value={speed} onChange={(e) => setSpeed(+e.target.value)} />
          </div>
          <div className="ctrl">
            <label>Domain decomposition</label>
            <div className="seg">
              {[["off", "none"], ["openmp", "OpenMP"], ["mpi", "MPI"], ["gpu", "GPU"]].map(([k, lab]) => (
                <button key={k} className={decomp === k ? "on" : ""} onClick={() => setDecomp(k as typeof decomp)}>{lab}</button>
              ))}
            </div>
            <div className="fixhint">Overlay how the grid is split — and where <Glossed>{"the halo cells that drive MPI communication"}</Glossed> live.</div>
          </div>
          <div className="ctrl">
            <label>Convergence (max |Δu| per step, log)</label>
            <canvas className="conv-canvas" style={{ width: "100%", height: 96 }} ref={convRef} />
            <div className="fixhint">The residual falls as it nears steady state — and <b>diverges</b> if you push α past 0.25.</div>
          </div>
        </section>

        <section className="card vizwrap">
          <h2><span>Temperature field · {N}×{N}</span><span className="scene-tag">u_t = α∇²u (FTCS)</span></h2>
          <canvas className="viz lab-canvas" ref={canvasRef} />
        </section>

        <section className="card explain">
          <h2><span>This stencil in {MODELS[decomp].label}</span><span className="scene-tag">pick a model →</span></h2>
          <p className="learn-blurb"><Glossed>{"Every cell relaxes toward the average of its 4 neighbours (a 5-point stencil) — independent within a step, so it parallelizes well. Here's the SAME update written for each model; switch the decomposition control to compare."}</Glossed></p>
          <div className="code">
            {MODELS[decomp].code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
          </div>
          <div className="eb how" style={{ marginTop: 12 }}>
            <div className="t">{MODELS[decomp].t}</div>
            <div className="body"><Glossed>{MODELS[decomp].note}</Glossed></div>
          </div>
          <div className="ref-related" style={{ marginTop: 10 }}>
            {MODELS[decomp].links.map((l) => <Link key={l.href} className="learn-link" style={{ marginTop: 0 }} href={l.href}>{l.label}</Link>)}
          </div>
        </section>
      </div>

      <footer className="note">
        Fully client-side (no backend): an explicit finite-difference solve of the 2-D heat equation,
        animated. The same math is the backbone of FDTD, CFD and many engineering simulations — and a
        textbook case for domain decomposition. Compare the model here with <Link href="/">the Flagship&apos;s</Link> measured runs.
      </footer>
    </main>
  );
}
