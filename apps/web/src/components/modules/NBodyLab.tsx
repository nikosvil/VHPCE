"use client";

import { useEffect, useRef, useState } from "react";
import Glossed from "../Glossed";

// N-body gravitational simulation — O(N²) all-pairs.
// Demonstrates embarrassingly-parallel force decomposition, O(N²/P) OpenMP,
// MPI all-gather pattern, and GPU thread-per-pair CUDA.

const MAX_N   = 128;
const TRAIL   = 28;   // trail length (steps)
const G_CONST = 0.5;

type Kind = "disk" | "cluster";

function initBodies(n: number, kind: Kind, eps: number) {
  const x  = new Float64Array(MAX_N);
  const y  = new Float64Array(MAX_N);
  const vx = new Float64Array(MAX_N);
  const vy = new Float64Array(MAX_N);
  const m  = new Float64Array(MAX_N).fill(1);

  if (kind === "disk") {
    // One heavy central body + (n-1) Keplerian orbits
    m[0] = n * 8;
    x[0] = 0; y[0] = 0; vx[0] = 0; vy[0] = 0;
    for (let i = 1; i < n; i++) {
      const r = 22 + 150 * Math.sqrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      x[i] = r * Math.cos(theta);
      y[i] = r * Math.sin(theta);
      const v = Math.sqrt(G_CONST * m[0] / (r + eps));
      vx[i] = -v * Math.sin(theta);
      vy[i] =  v * Math.cos(theta);
    }
  } else {
    // Two counter-moving clusters (galaxy collision)
    const half = Math.floor(n / 2);
    const SEP = 130, R = 65;
    for (let i = 0; i < n; i++) {
      const inA = i < half;
      const cx = inA ? -SEP / 2 : SEP / 2;
      const bulkVx = inA ? 1.0 : -1.0;
      const r = R * Math.sqrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      x[i] = cx + r * Math.cos(theta);
      y[i] = r * Math.sin(theta);
      // small tangential velocity within cluster
      const v = Math.sqrt(G_CONST * (half * 0.5) / (r + eps)) * 0.4;
      vx[i] = bulkVx + -v * Math.sin(theta);
      vy[i] =  v * Math.cos(theta);
    }
  }
  return { x, y, vx, vy, m };
}

type Model = "off" | "openmp" | "mpi" | "gpu";
const CODE: Record<Model, string> = {
  off: `/* O(N²/2) — Newton's 3rd law halves the work */
for (i = 0; i < N; i++)
  for (j = i+1; j < N; j++) {
    dx = x[j]-x[i]; dy = y[j]-y[i];
    r3 = pow(dx*dx+dy*dy+eps*eps, 1.5);
    f  = G / r3;
    ax[i] += m[j]*f*dx; ay[i] += m[j]*f*dy;
    ax[j] -= m[i]*f*dx; ay[j] -= m[i]*f*dy;
  }`,
  openmp: `/* outer loop is parallel — each i accumulates independently */
#pragma omp parallel for schedule(dynamic)
for (i = 0; i < N; i++)
  for (j = 0; j < N; j++) {   /* private accumulator per i */
    if (i==j) continue;
    dx = x[j]-x[i]; dy = y[j]-y[i];
    r3 = pow(dx*dx+dy*dy+eps*eps, 1.5);
    ax[i] += G*m[j]*(dx)/r3;
    ay[i] += G*m[j]*(dy)/r3;
  }`,
  mpi: `/* each rank owns a slice of bodies */
MPI_Allgather(x_local, n_local, MPI_DOUBLE,
              x_all,   N,       MPI_DOUBLE, comm);
/* each rank computes forces for its own bodies
   against ALL bodies (the gathered positions) */
for (i = lo; i < hi; i++)
  for (j = 0; j < N; j++) {
    if (i==j) continue;
    dx = x_all[j]-x[i]; dy = y_all[j]-y[i];
    r3 = pow(dx*dx+dy*dy+eps*eps, 1.5);
    ax[i] += G*m[j]*dx/r3;
  }`,
  gpu: `/* one thread per (i,j) pair — N² threads total */
__global__ void forces(
    const double *x, const double *y,
    const double *m, double *ax, int N) {
  int i = blockIdx.x*blockDim.x + threadIdx.x;
  int j = blockIdx.y*blockDim.y + threadIdx.y;
  if (i>=N || j>=N || i==j) return;
  double dx=x[j]-x[i], dy=y[j]-y[i];
  double r3=pow(dx*dx+dy*dy+EPS*EPS,1.5);
  atomicAdd(&ax[i], G*m[j]*dx/r3);  /* race → atomics */
}`,
};
const NOTE: Record<Model, string> = {
  off: "Force between every pair is computed once (Newton's 3rd law: action = −reaction), so the inner loop only runs for j > i. Work is O(N²/2) — doubles every time N doubles.",
  openmp: "The outer loop over i is parallel: each thread accumulates its own body's forces without touching other bodies' accumulators. dynamic schedule balances the triangular work distribution.",
  mpi: "Each rank owns a slab of bodies but needs all positions to compute forces — MPI_Allgather broadcasts them. Then each rank computes its slab's forces locally. Communication is O(N) per step, compute is O(N²/P).",
  gpu: "One thread per (i,j) pair = N² threads. Each thread writes to ax[i] concurrently — requiring atomicAdd. Shared-memory tiling (the GPU roofline pattern) hides memory latency and avoids redundant global reads.",
};

export default function NBodyLab() {
  const [playing, setPlaying]   = useState(true);
  const [n, setN]               = useState(32);
  const [kind, setKind]         = useState<Kind>("disk");
  const [eps, setEps]           = useState(8);
  const [decomp, setDecomp]     = useState<Model>("off");
  const [stepCount, setStepCount] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xRef  = useRef(new Float64Array(MAX_N));
  const yRef  = useRef(new Float64Array(MAX_N));
  const vxRef = useRef(new Float64Array(MAX_N));
  const vyRef = useRef(new Float64Array(MAX_N));
  const mRef  = useRef(new Float64Array(MAX_N).fill(1));
  // Trail ring-buffer: [TRAIL][MAX_N] flattened
  const trailX = useRef(new Float32Array(TRAIL * MAX_N));
  const trailY = useRef(new Float32Array(TRAIL * MAX_N));
  const trailHead = useRef(0);
  const stepRef = useRef(0);
  const cfg = useRef({ playing, n, kind, eps, decomp });
  useEffect(() => { cfg.current = { playing, n, kind, eps, decomp }; });

  const reset = (newN?: number, newKind?: Kind, newEps?: number) => {
    const nb = newN ?? n, k = newKind ?? kind, e = newEps ?? eps;
    const init = initBodies(nb, k, e);
    xRef.current.set(init.x); yRef.current.set(init.y);
    vxRef.current.set(init.vx); vyRef.current.set(init.vy);
    mRef.current.set(init.m);
    trailX.current.fill(0); trailY.current.fill(0);
    trailHead.current = 0; stepRef.current = 0; setStepCount(0);
  };

  // Initialize on mount and when n/kind changes
  useEffect(() => { reset(n, kind, eps); }, [n, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    let w = 1, h = 1, raf = 0;

    const resize = () => {
      const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };

    const doStep = () => {
      const { n: nb, eps: e } = cfg.current;
      const x = xRef.current, y = yRef.current;
      const vx = vxRef.current, vy = vyRef.current, m = mRef.current;
      const ax = new Float64Array(nb), ay = new Float64Array(nb);

      for (let i = 0; i < nb; i++) {
        for (let j = i + 1; j < nb; j++) {
          const dx = x[j] - x[i], dy = y[j] - y[i];
          const r2 = dx * dx + dy * dy + e * e;
          const inv_r3 = G_CONST / (r2 * Math.sqrt(r2));
          const fix = inv_r3 * dx, fiy = inv_r3 * dy;
          ax[i] += m[j] * fix; ay[i] += m[j] * fiy;
          ax[j] -= m[i] * fix; ay[j] -= m[i] * fiy;
        }
      }
      const dt = 0.9;
      for (let i = 0; i < nb; i++) {
        vx[i] += ax[i] * dt; vy[i] += ay[i] * dt;
        x[i]  += vx[i] * dt; y[i]  += vy[i] * dt;
      }
      // Store trail snapshot
      const h0 = trailHead.current % TRAIL;
      for (let i = 0; i < nb; i++) {
        trailX.current[h0 * MAX_N + i] = x[i];
        trailY.current[h0 * MAX_N + i] = y[i];
      }
      trailHead.current++;
    };

    const bodyColor = (i: number, nb: number, k: Kind) =>
      k === "disk" && i === 0 ? "#b388ff" : i < Math.floor(nb / 2) ? "#4cc9f0" : "#ffb454";

    const draw = () => {
      const { n: nb, kind: k } = cfg.current;
      const x = xRef.current, y = yRef.current, m = mRef.current;
      const cx = w / 2, cy = h / 2;

      ctx.fillStyle = "#04080f"; ctx.fillRect(0, 0, w, h);

      // Trails
      for (let i = 0; i < nb; i++) {
        const col = bodyColor(i, nb, k);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let t = 0; t < Math.min(TRAIL - 1, trailHead.current - 1); t++) {
          const age = (trailHead.current - 1 - t + TRAIL * 1000) % TRAIL;
          const px = cx + trailX.current[age * MAX_N + i];
          const py = cy + trailY.current[age * MAX_N + i];
          ctx.globalAlpha = (1 - t / TRAIL) * 0.35;
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Bodies
      for (let i = 0; i < nb; i++) {
        const px = cx + x[i], py = cy + y[i];
        const r = Math.min(12, Math.cbrt(m[i]) * 2.2);
        const col = bodyColor(i, nb, k);
        ctx.shadowColor = col; ctx.shadowBlur = 10;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // HUD
      ctx.fillStyle = "#8a9bb4"; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = "left";
      ctx.fillText(`N=${nb} · O(N²)=${nb * nb} force pairs/step · step ${stepRef.current}`, 10, h - 10);
    };

    const loop = () => {
      if (cfg.current.playing) {
        doStep();
        stepRef.current++;
        if (stepRef.current % 6 === 0) setStepCount(stepRef.current);
      }
      draw();
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const code = CODE[decomp];
  const note = NOTE[decomp];
  const opsPerStep = n * n;
  const opsParallel = Math.ceil(n * n / 24);

  return (
    <div className="grid">
      <section className="card">
        <h2>Controls</h2>
        <div className="ctrl">
          <div className="step-row" style={{ marginTop: 0 }}>
            <button className="step-btn play" onClick={() => setPlaying((p) => !p)}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
            <button className="step-btn" onClick={() => reset()}>↻ Reset</button>
            <span className="pg-hint">step {stepCount.toLocaleString()}</span>
          </div>
        </div>
        <div className="ctrl">
          <label>Scenario</label>
          <div className="seg fix">
            {(["disk", "cluster"] as Kind[]).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); reset(n, k, eps); }}>{k}</button>
            ))}
          </div>
          <div className="fixhint">disk: Keplerian orbits around a central mass · cluster: two galaxies collide</div>
        </div>
        <div className="ctrl">
          <label>Bodies N<b>{n}</b></label>
          <div className="seg fix">
            {[8, 16, 32, 64, 128].map((v) => (
              <button key={v} className={n === v ? "on" : ""} onClick={() => { setN(v); reset(v, kind, eps); }}>{v}</button>
            ))}
          </div>
        </div>
        <div className="ctrl">
          <label>Softening ε<b>{eps}</b></label>
          <input type="range" min={2} max={24} step={1} value={eps} onChange={(e) => setEps(+e.target.value)} />
          <div className="fixhint">Prevents singularities — larger ε smooths out close encounters.</div>
        </div>
        <div className="ctrl">
          <label>Decomposition model</label>
          <div className="seg">
            {(["off", "openmp", "mpi", "gpu"] as Model[]).map((k) => (
              <button key={k} className={decomp === k ? "on" : ""} onClick={() => setDecomp(k)}>
                {k === "off" ? "serial" : k}
              </button>
            ))}
          </div>
        </div>
        <div className="ctrl" style={{ marginTop: 8 }}>
          <div className="eb how">
            <div className="t">Complexity: O(N²) = {opsPerStep.toLocaleString()} pairs/step</div>
            <div className="body" style={{ fontSize: 12, marginTop: 4 }}>
              24-core OpenMP: ~{opsParallel.toLocaleString()} pairs/thread · N=128 → {(128*128).toLocaleString()} pairs · N=1024 → {(1024*1024).toLocaleString()}
            </div>
          </div>
        </div>
      </section>

      <section className="card vizwrap">
        <h2><span>{n} bodies · gravitational N-body</span><span className="scene-tag">F = Gm₁m₂/r²</span></h2>
        <canvas className="viz lab-canvas" ref={canvasRef} style={{ background: "#04080f" }} />
      </section>

      <section className="card explain">
        <h2><span>Force loop in {decomp === "off" ? "serial" : decomp}</span><span className="scene-tag">pick a model →</span></h2>
        <p className="learn-blurb"><Glossed>{"The force on body i from body j is F = G·mᵢ·mⱼ/r² along the line connecting them. Computing all N² pairs each step dominates the runtime — and unlike stencils, there is no spatial locality: any pair can interact. That makes N-body harder to cache-optimise than FDTD."}</Glossed></p>
        <div className="code">
          {code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
        </div>
        <div className="eb how" style={{ marginTop: 12 }}>
          <div className="t">Key challenge: {decomp === "gpu" ? "write conflicts → atomics" : decomp === "mpi" ? "all-to-all position broadcast" : decomp === "openmp" ? "triangular work distribution" : "O(N²) grows fast"}</div>
          <div className="body"><Glossed>{note}</Glossed></div>
        </div>
      </section>
    </div>
  );
}
