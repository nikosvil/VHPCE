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

  const reset = () => { seed(uRef.current); iterRef.current = 0; setIter(0); };

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
      for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
        const c = idx(i, j);
        v[c] = u[c] + a * (u[c - N] + u[c + N] + u[c - 1] + u[c + 1] - 4 * u[c]);
      }
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
    const loop = () => {
      if (cfg.current.playing) {
        for (let s = 0; s < cfg.current.speed; s++) { step(cfg.current.alpha); iterRef.current++; }
        if (++frame % 6 === 0) setIter(iterRef.current);
      }
      draw();
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
        </section>

        <section className="card vizwrap">
          <h2><span>Temperature field · {N}×{N}</span><span className="scene-tag">u_t = α∇²u (FTCS)</span></h2>
          <canvas className="viz lab-canvas" ref={canvasRef} />
        </section>

        <section className="card explain">
          <h2>What you&apos;re seeing</h2>
          <div className="blocks" style={{ gridTemplateColumns: "1fr" }}>
            <div className="eb what"><div className="t">The stencil</div><div className="body"><Glossed>{"Each step, every cell relaxes toward the average of its 4 neighbours — a 5-point stencil. A hot square in the centre is held fixed; the cold edges are held at 0, so heat diffuses outward to a steady state."}</Glossed></div></div>
            <div className="eb why"><div className="t">Why it parallelizes well</div><div className="body"><Glossed>{"Every cell's update is independent within a step and only reads neighbours — embarrassingly parallel with a thin dependency. That is exactly the structure OpenMP, MPI and GPUs exploit."}</Glossed></div></div>
            <div className="eb how"><div className="t">…and where it gets hard</div><div className="body"><Glossed>{"Split across MPI ranks, each block needs its neighbours' edge rows — the halo. Exchanging halos every step is the communication that the "}</Glossed><Link href="/?exp=mpiHalo">MPI Halo Exchange</Link> experiment measures.</div></div>
            <div className="eb exp"><div className="t">Try</div><div className="body">Flip the decomposition overlay; raise α past 0.25 to break stability; speed it up to reach steady state. Then see the directives in the <Link href="/reference">Reference</Link> (e.g. <Link href="/reference?id=mpi_sendrecv">MPI_Sendrecv</Link>, <Link href="/reference?id=omp_parallel_for">omp parallel for</Link>).</div></div>
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
