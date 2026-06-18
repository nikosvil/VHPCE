"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "../Glossed";

// 2-D FDTD wave equation: u_tt = c²∇²u
// FTCS: u_new[i,j] = 2·u[i,j] − u_prev[i,j] + r²·(u[i±1,j] + u[i,j±1] − 4·u[i,j])
// Stability: Courant number r = c·dt/dx ≤ 1/√2 ≈ 0.707 in 2-D

const N = 150;
const idx = (i: number, j: number) => i * N + j;

function waveRamp(v: number): [number, number, number] {
  v = Math.max(-1, Math.min(1, v));
  if (v < 0) {
    const t = -v;
    return [Math.round(10 + 66 * t), Math.round(15 + 186 * t), Math.round(24 + 216 * t)];
  }
  return [Math.round(10 + 245 * v), Math.round(15 + 165 * v), Math.round(24 + 60 * v)];
}

type Src = "point" | "plane" | "slit";

function makeMask(src: Src): Uint8Array {
  const m = new Uint8Array(N * N);
  if (src !== "slit") return m;
  const bj = Math.floor(N / 3);
  const g1lo = Math.floor(N * 0.27), g1hi = Math.floor(N * 0.41);
  const g2lo = Math.floor(N * 0.59), g2hi = Math.floor(N * 0.73);
  for (let i = 1; i < N - 1; i++) {
    if (i < g1lo || (i >= g1hi && i < g2lo) || i >= g2hi) m[idx(i, bj)] = 1;
  }
  return m;
}

type Model = "off" | "openmp" | "mpi" | "gpu";
type ModelEntry = { label: string; t: string; note: string; code: string; links: { href: string; label: string }[] };
const MODELS: Record<Model, ModelEntry> = {
  off: {
    label: "serial", t: "Serial baseline",
    note: "Two nested loops advance every interior cell — the baseline every parallel version speeds up. Each cell depends only on its 4 spatial neighbours and its two previous time levels.",
    code: `for (i = 1; i < N-1; i++)
  for (j = 1; j < N-1; j++)
    un[i][j] = 2*u[i][j] - up[i][j]
             + r2*(u[i-1][j]+u[i+1][j]
                  +u[i][j-1]+u[i][j+1]
                  -4*u[i][j]);`,
    links: [],
  },
  openmp: {
    label: "OpenMP", t: "OpenMP — collapse(2)",
    note: "Cells within one time step are fully independent — add one directive. collapse(2) fuses the i and j loops for a wider thread pool to divide.",
    code: `#pragma omp parallel for collapse(2)
for (i = 1; i < N-1; i++)
  for (j = 1; j < N-1; j++)
    un[i][j] = 2*u[i][j] - up[i][j]
             + r2*(u[i-1][j]+u[i+1][j]
                  +u[i][j-1]+u[i][j+1]
                  -4*u[i][j]);`,
    links: [{ href: "/reference?id=omp_parallel_for", label: "omp parallel for" }, { href: "/reference?id=omp_collapse", label: "collapse(2)" }],
  },
  mpi: {
    label: "MPI", t: "MPI — slab decomposition + halo",
    note: "Each rank owns a horizontal slab of rows. Before each FDTD step it exchanges its top and bottom edge rows (the halo) with neighbours — the same pattern the Halo Exchange experiment benchmarks.",
    code: `/* exchange halo rows before each FDTD step */
MPI_Sendrecv(&u[lo][0],   N, MPI_FLOAT, up,   0,
             &u[hi+1][0], N, MPI_FLOAT, down, 0, comm, &st);
MPI_Sendrecv(&u[hi][0],   N, MPI_FLOAT, down, 1,
             &u[lo-1][0], N, MPI_FLOAT, up,   1, comm, &st);
for (i = lo; i <= hi; i++)
  for (j = 1; j < N-1; j++)
    un[i][j] = 2*u[i][j] - up[i][j] + r2*(stencil);`,
    links: [{ href: "/?exp=mpiHalo", label: "Halo Exchange experiment" }, { href: "/reference?id=mpi_sendrecv", label: "MPI_Sendrecv" }],
  },
  gpu: {
    label: "GPU", t: "GPU — one thread per cell",
    note: "A 2-D thread-block grid maps one CUDA thread to each grid cell. Staging each tile into shared memory cuts global-memory traffic to one read per cell per step.",
    code: `__global__ void fdtd_step(
    const float *u, const float *up,
    float *un, int N, float r2) {
  int i = blockIdx.y*blockDim.y + threadIdx.y;
  int j = blockIdx.x*blockDim.x + threadIdx.x;
  if (i>0 && i<N-1 && j>0 && j<N-1)
    un[i*N+j] = 2*u[i*N+j] - up[i*N+j]
      + r2*(u[(i-1)*N+j]+u[(i+1)*N+j]
           +u[i*N+j-1]+u[i*N+j+1]
           -4*u[i*N+j]);
}`,
    links: [{ href: "/?exp=cuda", label: "GPU Occupancy" }, { href: "/?exp=cudaCoalesce", label: "GPU Coalescing" }],
  },
};

export default function WaveLab() {
  const [playing, setPlaying]   = useState(true);
  const [src, setSrc]           = useState<Src>("point");
  const [courant, setCourant]   = useState(0.50);
  const [damping, setDamping]   = useState(0.002);
  const [decomp, setDecomp]     = useState<Model>("off");
  const [step, setStep]         = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uRef      = useRef(new Float32Array(N * N));
  const prevRef   = useRef(new Float32Array(N * N));
  const nextRef   = useRef(new Float32Array(N * N));
  const maskRef   = useRef<Uint8Array>(makeMask("point"));
  const tRef      = useRef(0);
  const stepRef   = useRef(0);
  const probeRef  = useRef<number[]>([]);
  const chartRef  = useRef<HTMLCanvasElement>(null);
  const cfg       = useRef({ playing, src, courant, damping, decomp });
  useEffect(() => { cfg.current = { playing, src, courant, damping, decomp }; });

  const reset = (newSrc?: Src) => {
    const s = newSrc ?? src;
    uRef.current.fill(0); prevRef.current.fill(0); nextRef.current.fill(0);
    maskRef.current = makeMask(s);
    tRef.current = 0; stepRef.current = 0; setStep(0); probeRef.current = [];
  };

  const handleSrc = (s: Src) => { setSrc(s); reset(s); };

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const off = document.createElement("canvas"); off.width = N; off.height = N;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(N, N);
    let w = 1, h = 1, raf = 0;

    const resize = () => {
      const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };

    const doStep = () => {
      const u = uRef.current, p = prevRef.current, n = nextRef.current;
      const mask = maskRef.current;
      const { src: s, courant: r, damping: d } = cfg.current;
      const r2 = r * r, freq = 0.07, A = 0.9;
      const phase = A * Math.sin(2 * Math.PI * freq * tRef.current);
      for (let i = 1; i < N - 1; i++) {
        for (let j = 1; j < N - 1; j++) {
          const c = idx(i, j);
          if (mask[c]) { n[c] = 0; continue; }
          n[c] = (2 * u[c] - p[c] + r2 * (u[c - N] + u[c + N] + u[c - 1] + u[c + 1] - 4 * u[c])) * (1 - d);
        }
      }
      if (s === "point") {
        n[idx(N >> 1, N >> 1)] = phase;
      } else {
        for (let i = 1; i < N - 1; i++) n[idx(i, 1)] = phase;
      }
      uRef.current = n; prevRef.current = u; nextRef.current = p;
      tRef.current++;
    };

    const drawOverlay = (mode: Model) => {
      if (mode === "off") return;
      const lbl = (s: string, col: string) => {
        ctx.fillStyle = col; ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(s, w / 2, h - 10);
      };
      if (mode === "openmp") {
        ctx.strokeStyle = "#4cc9f0"; ctx.lineWidth = 1.5;
        for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(0, h * k / 4); ctx.lineTo(w, h * k / 4); ctx.stroke(); }
        lbl("OpenMP: threads split row-blocks — shared memory, no halos", "#4cc9f0");
      } else if (mode === "mpi") {
        const halo = Math.max(2, h / N * 2);
        ctx.fillStyle = "rgba(255,180,84,.28)";
        for (let k = 1; k < 3; k++) ctx.fillRect(0, h * k / 3 - halo, w, 2 * halo);
        ctx.strokeStyle = "#ffb454"; ctx.lineWidth = 1.5;
        for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(0, h * k / 3); ctx.lineTo(w, h * k / 3); ctx.stroke(); }
        lbl("MPI: 3 ranks; amber band = halo rows exchanged each step", "#ffb454");
      } else {
        const P = 6; ctx.strokeStyle = "rgba(61,220,151,.4)"; ctx.lineWidth = 1;
        for (let k = 1; k < P; k++) {
          ctx.beginPath(); ctx.moveTo(w * k / P, 0); ctx.lineTo(w * k / P, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, h * k / P); ctx.lineTo(w, h * k / P); ctx.stroke();
        }
        lbl("GPU: 6×6 thread-block grid — one thread per cell", "#3ddc97");
      }
    };

    const drawSlitOverlay = () => {
      if (cfg.current.src !== "slit") return;
      const bj = Math.floor(N / 3);
      const bx = (bj / N) * w;
      const g1lo = Math.floor(N * 0.27), g1hi = Math.floor(N * 0.41);
      const g2lo = Math.floor(N * 0.59), g2hi = Math.floor(N * 0.73);
      ctx.fillStyle = "rgba(140,160,190,.55)";
      ctx.fillRect(bx - 1, 0, 3, (g1lo / N) * h);
      ctx.fillRect(bx - 1, (g1hi / N) * h, 3, ((g2lo - g1hi) / N) * h);
      ctx.fillRect(bx - 1, (g2hi / N) * h, 3, h - (g2hi / N) * h);
    };

    const drawChart = () => {
      const cc = chartRef.current; if (!cc) return;
      const cctx = cc.getContext("2d"); if (!cctx) return;
      const CW = 480, CH = 80;
      if (cc.width !== CW) { cc.width = CW; cc.height = CH; }
      cctx.clearRect(0, 0, CW, CH);
      const hist = probeRef.current; if (hist.length < 2) return;
      const unstable = cfg.current.courant > 0.707;
      cctx.strokeStyle = "#1a2840"; cctx.lineWidth = 1;
      cctx.beginPath(); cctx.moveTo(0, CH / 2); cctx.lineTo(CW, CH / 2); cctx.stroke();
      cctx.strokeStyle = unstable ? "#ff5d73" : "#4cc9f0"; cctx.lineWidth = 1.5; cctx.beginPath();
      hist.forEach((v, i) => {
        const x = (i / (hist.length - 1)) * CW;
        const y = CH / 2 - Math.max(-1, Math.min(1, v)) * (CH / 2 - 4);
        if (i) cctx.lineTo(x, y); else cctx.moveTo(x, y);
      });
      cctx.stroke();
      cctx.fillStyle = "#8a9bb4"; cctx.font = "13px ui-monospace, monospace"; cctx.textAlign = "left";
      cctx.fillText(`r = ${cfg.current.courant.toFixed(2)}  ${unstable ? "⚠ r > 1/√2 — diverging!" : "stable"}`, 6, 14);
    };

    const loop = () => {
      if (cfg.current.playing) {
        doStep();
        stepRef.current++;
        const probe = uRef.current[idx(N >> 1, Math.floor(N * 0.72))];
        probeRef.current.push(probe);
        if (probeRef.current.length > 360) probeRef.current.shift();
        if (stepRef.current % 6 === 0) setStep(stepRef.current);
      }
      // Draw heatmap
      const u = uRef.current, d = img.data;
      for (let k = 0; k < N * N; k++) {
        const [r, g, b] = waveRamp(u[k] * 1.6);
        const o = k * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0, w, h);
      drawSlitOverlay();
      drawOverlay(cfg.current.decomp);
      drawChart();
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const m = MODELS[decomp];
  return (
    <div className="grid">
      <section className="card">
        <h2>Controls</h2>
        <div className="ctrl">
          <div className="step-row" style={{ marginTop: 0 }}>
            <button className="step-btn play" onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
            <button className="step-btn" onClick={() => reset()}>↻ Reset</button>
            <span className="pg-hint">step {step.toLocaleString()}</span>
          </div>
        </div>
        <div className="ctrl">
          <label>Wave source</label>
          <div className="seg fix">
            {(["point", "plane", "slit"] as Src[]).map((s) => (
              <button key={s} className={src === s ? "on" : ""} onClick={() => handleSrc(s)}>{s}</button>
            ))}
          </div>
          <div className="fixhint">point: radial ripple · plane: uniform wavefront · slit: double-slit diffraction</div>
        </div>
        <div className="ctrl">
          <label>Courant number r<b style={{ color: courant > 0.707 ? "#ff5d73" : "#3ddc97" }}>{courant.toFixed(2)}</b></label>
          <input type="range" min={0.30} max={0.75} step={0.01} value={courant} onChange={(e) => setCourant(+e.target.value)} />
          <div className="fixhint">Stable for r ≤ 1/√2 ≈ 0.707 — push past it to trigger numerical blow-up.</div>
        </div>
        <div className="ctrl">
          <label>Damping<b>{damping.toFixed(3)}</b></label>
          <input type="range" min={0} max={0.015} step={0.001} value={damping} onChange={(e) => setDamping(+e.target.value)} />
          <div className="fixhint">Absorbs energy per step — models lossy media or PML-like boundaries.</div>
        </div>
        <div className="ctrl">
          <label>Domain decomposition</label>
          <div className="seg">
            {(["off", "openmp", "mpi", "gpu"] as Model[]).map((k) => (
              <button key={k} className={decomp === k ? "on" : ""} onClick={() => setDecomp(k)}>{MODELS[k].label}</button>
            ))}
          </div>
        </div>
        <div className="ctrl">
          <label>Probe amplitude (j = ¾N)</label>
          <canvas className="conv-canvas" style={{ width: "100%", height: 72 }} ref={chartRef} />
          <div className="fixhint">Amplitude at a fixed point — flat oscillation when stable, exponential growth when r &gt; 0.707.</div>
        </div>
      </section>

      <section className="card vizwrap">
        <h2><span>Wave field · {N}×{N}</span><span className="scene-tag">u_tt = c²∇²u (FDTD)</span></h2>
        <canvas className="viz lab-canvas" ref={canvasRef} />
      </section>

      <section className="card explain">
        <h2><span>This stencil in {m.label}</span><span className="scene-tag">pick a model →</span></h2>
        <p className="learn-blurb"><Glossed>{"Each cell's new value needs its 4 spatial neighbours and its two previous time levels (now and prev). The three-level time structure is the only difference from the heat equation — the 5-point spatial stencil is identical, and so is the parallelisation strategy."}</Glossed></p>
        <div className="code">
          {m.code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
        </div>
        <div className="eb how" style={{ marginTop: 12 }}>
          <div className="t">{m.t}</div>
          <div className="body"><Glossed>{m.note}</Glossed></div>
        </div>
        <div className="ref-related" style={{ marginTop: 10 }}>
          {m.links.map((l) => <Link key={l.href} className="learn-link" style={{ marginTop: 0 }} href={l.href}>{l.label}</Link>)}
        </div>
      </section>
    </div>
  );
}
