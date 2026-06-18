"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "../Glossed";

// Matrix Multiply (GEMM): C = A × B
// Key lesson: naïve C triple loop accesses B in column-major order — stride N per k step.
// Blocked GEMM fits NB×NB tiles of A and B into L1/L2 cache, reusing them NB times.
// Arithmetic intensity: naïve ≈ 0.5 FLOP/byte → memory-bound on any machine.
//                       tiled  ≈ NB/4 FLOP/byte → crosses the ridge point into compute-bound.

const N = 8;   // visualisation grid size (all three matrices are N×N)

type Mode = "naive" | "tiled";
type Par  = "serial" | "openmp" | "gpu";

function ai(mode: Mode, nb: number) {
  return mode === "naive" ? 0.5 : nb / 4;
}

const NB_OPTIONS = [2, 4, 8] as const;

const CODES: Record<string, string> = {
  naive_serial: `/* Naïve — B is column-major access (stride N) */
for (i = 0; i < N; i++)
  for (j = 0; j < N; j++)
    for (k = 0; k < N; k++)
      C[i*N+j] += A[i*N+k] * B[k*N+j];
      /* B[k*N+j] jumps N floats per k  */
      /* = cache miss on every element  */`,

  tiled_serial: `/* Blocked — NB×NB tile lives in L1/L2 */
for (ii=0; ii<N; ii+=NB)
 for (jj=0; jj<N; jj+=NB)
  for (kk=0; kk<N; kk+=NB)
   for (i=ii; i<ii+NB; i++)
    for (j=jj; j<jj+NB; j++)
     for (k=kk; k<kk+NB; k++)
      C[i*N+j] += A[i*N+k]*B[k*N+j];
      /* tile in cache → hit (NB² reuses) */`,

  naive_openmp: `/* OpenMP — each thread owns its (i,j) row */
#pragma omp parallel for collapse(2)
for (i = 0; i < N; i++)
  for (j = 0; j < N; j++) {
    float sum = 0;
    for (k = 0; k < N; k++)
      sum += A[i*N+k] * B[k*N+j];
    C[i*N+j] = sum;  /* no race: (i,j) exclusive */
  }
/* bottleneck stays: all threads fight DRAM */`,

  tiled_openmp: `/* Blocked + OpenMP: parallelise tile loop */
#pragma omp parallel for collapse(2)
for (ii=0; ii<N; ii+=NB)
  for (jj=0; jj<N; jj+=NB)
    for (kk=0; kk<N; kk+=NB)
      for (i=ii; i<ii+NB; i++)
       for (j=jj; j<jj+NB; j++)
        for (k=kk; k<kk+NB; k++)
         C[i*N+j] += A[i*N+k]*B[k*N+j];
/* each thread's tile fits in its own L1 */`,

  gpu: `__global__ void gemm(
    const float *A, const float *B,
    float *C, int N) {
  int i = blockIdx.y*blockDim.y + threadIdx.y;
  int j = blockIdx.x*blockDim.x + threadIdx.x;
  if (i<N && j<N) {
    float sum = 0;
    for (int k=0; k<N; k++)
      sum += A[i*N+k] * B[k*N+j];
      /* B[:,j] non-coalesced across threads */
      /* fix: shared-memory tile of B       */
    C[i*N+j] = sum;
  }
}`,
};

const NOTES: Record<string, string> = {
  naive_serial: "B[k*N+j] in row-major C storage: as k increments the address jumps N floats. For N=1024 that is 4 KB per step — far beyond any cache line (64 B) — so every B element is a cache miss. Arithmetic intensity ≈ 0.5 FLOP/byte: squarely memory-bound on every modern CPU and GPU.",
  tiled_serial: "The NB×NB tile of B is loaded from DRAM once (4·NB² bytes) then reused NB times — once per row of A within the tile. Arithmetic intensity rises to NB/4 FLOP/byte. NB=32 → 8 FLOP/byte on a CPU with a ~4 FLOP/byte ridge point: the same algorithm crosses from memory-bound to compute-bound just by reordering the loops.",
  naive_openmp: "The outer two loops (i,j) are independent — no race when each thread accumulates into its own C[i][j]. But all threads still read B column-by-column, saturating shared DRAM bandwidth. Speedup is limited by memory, not parallelism.",
  tiled_openmp: "Tiling first, parallelise second: each thread owns an NB×NB tile of C and keeps its tile of A and B in its private L1. Threads no longer contend for the same cache lines. Speedup scales to the ridge point, then performance is compute-limited — the best possible outcome.",
  gpu: "One CUDA thread per C[i][j] maps cleanly to the 2-D grid. Problem: threads in the same warp share the same j but differ in i — B[k*N+j] accesses the same column location with stride N between threads → non-coalesced. The fix is shared-memory tiling: load a 32×32 tile of B into SMEM with coalesced 32-wide reads, then all threads in the block reuse it.",
};

export default function GemmLab() {
  const [mode, setMode] = useState<Mode>("naive");
  const [nb, setNb]     = useState(4);
  const [par, setPar]   = useState<Par>("serial");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg       = useRef({ mode, nb, par });
  useEffect(() => { cfg.current = { mode, nb, par }; });

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    let w = 1, h = 1, raf = 0, startTs = -1;

    const resize = () => {
      const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };

    // Draw an N×N grid at (ox,oy) with highlighted cells and optional tile border
    const drawGrid = (
      ox: number, oy: number, cs: number,
      rowHi: number, colHi: number,
      curR: number, curC: number,
      tile: [number, number, number, number] | null,  // [r0, c0, r1, c1] exclusive
      curCol: string, bandCol: string, tileCol: string,
    ) => {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const x = ox + c * cs, y = oy + r * cs;
          ctx.fillStyle = "#080e1c"; ctx.fillRect(x, y, cs - 1, cs - 1);
          if (tile && r >= tile[0] && r < tile[2] && c >= tile[1] && c < tile[3]) {
            ctx.fillStyle = tileCol + "22"; ctx.fillRect(x, y, cs - 1, cs - 1);
          }
          if (rowHi >= 0 && r === rowHi) { ctx.fillStyle = bandCol + "1e"; ctx.fillRect(x, y, cs - 1, cs - 1); }
          if (colHi >= 0 && c === colHi) { ctx.fillStyle = bandCol + "1e"; ctx.fillRect(x, y, cs - 1, cs - 1); }
          if (r === curR && c === curC) {
            ctx.shadowColor = curCol; ctx.shadowBlur = 12;
            ctx.fillStyle = curCol; ctx.fillRect(x, y, cs - 1, cs - 1);
            ctx.shadowBlur = 0;
          }
          ctx.strokeStyle = "#10192a"; ctx.lineWidth = 0.5;
          ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        }
      }
      if (tile) {
        ctx.strokeStyle = tileCol; ctx.lineWidth = 1.5;
        ctx.strokeRect(ox + tile[1] * cs, oy + tile[0] * cs,
          (tile[3] - tile[1]) * cs, (tile[2] - tile[0]) * cs);
      }
    };

    const loop = (ts: number) => {
      if (startTs < 0) startTs = ts;
      const elapsed = ts - startTs;
      const { mode: m, nb: nb_ } = cfg.current;
      const TOTAL = N * N * N;   // 512 steps for N=8
      const phase = Math.floor(elapsed * 0.006) % TOTAL;  // ~6 steps/s → 125ms per k-step

      let ci: number, cj: number, ck: number;
      let tile_A: [number, number, number, number] | null = null;
      let tile_B: [number, number, number, number] | null = null;
      let tile_C: [number, number, number, number] | null = null;

      if (m === "naive") {
        ci = Math.floor(phase / (N * N));
        cj = Math.floor(phase / N) % N;
        ck = phase % N;
      } else {
        const nb_s = Math.min(nb_, N);
        const nT = Math.ceil(N / nb_s);
        const innerTotal = nb_s * nb_s * nb_s;
        const tIdx = Math.floor(phase / innerTotal);
        const lPhase = phase % innerTotal;
        const ti_ = Math.floor(tIdx / (nT * nT));
        const tj_ = Math.floor(tIdx / nT) % nT;
        const tk_ = tIdx % nT;
        const li = Math.floor(lPhase / (nb_s * nb_s));
        const lj = Math.floor(lPhase / nb_s) % nb_s;
        const lk = lPhase % nb_s;
        ci = Math.min(ti_ * nb_s + li, N - 1);
        cj = Math.min(tj_ * nb_s + lj, N - 1);
        ck = Math.min(tk_ * nb_s + lk, N - 1);
        const r0A = ti_ * nb_s, c0A = tk_ * nb_s;
        const r0B = tk_ * nb_s, c0B = tj_ * nb_s;
        tile_A = [r0A, c0A, Math.min(r0A + nb_s, N), Math.min(c0A + nb_s, N)];
        tile_B = [r0B, c0B, Math.min(r0B + nb_s, N), Math.min(c0B + nb_s, N)];
        tile_C = [ti_ * nb_s, tj_ * nb_s, Math.min(ti_ * nb_s + nb_s, N), Math.min(tj_ * nb_s + nb_s, N)];
      }

      // Layout: A left, B and C right (B top, C bottom)
      const cs = Math.max(6, Math.min(18, Math.floor(Math.min(w * 0.43, h * 0.43) / N)));
      const gw = N * cs;
      const gap = Math.max(10, cs * 1.5);
      const ax = Math.max(8, (w - gw * 2 - gap) / 2);
      const bx = ax + gw + gap;
      const midPad = Math.max(8, cs * 1.2);
      const totalH = gw + midPad + gw;
      const topY = Math.max(20, (h - totalH) / 2);
      const ay = topY + (gw + midPad) / 2;  // A centred vertically
      const by = topY;
      const cy_ = topY + gw + midPad;

      ctx.clearRect(0, 0, w, h);

      // Matrix labels
      const label = (text: string, x: number, y: number, col: string) => {
        ctx.fillStyle = col; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center";
        ctx.fillText(text, x, y);
      };
      label("A", ax + gw / 2, ay - 7, "#4cc9f0");
      label("B", bx + gw / 2, by - 7, m === "naive" ? "#ff5d73" : "#3ddc97");
      label("C", bx + gw / 2, cy_ - 7, "#b388ff");
      label("×", ax + gw + gap / 2, ay + gw / 2, "#5e6e88");
      label("=", ax + gw + gap / 2, cy_ + gw / 2, "#5e6e88");

      if (m === "naive") {
        // A: row ci highlighted (contiguous = good), current cell A[ci][ck]
        drawGrid(ax, ay, cs, ci, -1, ci, ck, null, "#4cc9f0", "#4cc9f0", "");
        // B: col cj highlighted (strided = bad → red), current cell B[ck][cj]
        drawGrid(bx, by, cs, -1, cj, ck, cj, null, "#ff5d73", "#ff5d73", "");
        // C: current output cell C[ci][cj]
        drawGrid(bx, cy_, cs, ci, cj, ci, cj, null, "#b388ff", "#b388ff", "");
      } else {
        drawGrid(ax, ay, cs, -1, -1, ci, ck, tile_A, "#4cc9f0", "#4cc9f0", "#4cc9f0");
        drawGrid(bx, by, cs, -1, -1, ck, cj, tile_B, "#3ddc97", "#3ddc97", "#3ddc97");
        drawGrid(bx, cy_, cs, -1, -1, ci, cj, tile_C, "#b388ff", "#b388ff", "#b388ff");
      }

      // Caption
      const capCol = m === "naive" ? "#ff5d73" : "#3ddc97";
      ctx.fillStyle = capCol; ctx.font = "600 10px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText(
        m === "naive"
          ? `A[${ci}][${ck}] × B[${ck}][${cj}] → C[${ci}][${cj}]  ·  B column access = stride-N miss`
          : `tile (${Math.floor(ci/nb_)}·${nb_}) × tile (${Math.floor(ck/nb_)}·${nb_}) → C  ·  both tiles in cache`,
        w / 2, h - 8,
      );

      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const codeKey = par === "gpu" ? "gpu" : `${mode}_${par}`;
  const code = CODES[codeKey] ?? CODES.naive_serial;
  const note = NOTES[codeKey] ?? NOTES.naive_serial;
  const intensity = ai(mode, nb);
  const ridgePoint = 4;   // typical CPU ridge (FLOP/byte)
  const isComputeBound = intensity > ridgePoint;

  return (
    <div className="grid">
      <section className="card">
        <h2>Controls</h2>
        <div className="ctrl">
          <label>Access pattern</label>
          <div className="seg fix">
            <button className={mode === "naive" ? "on" : ""} onClick={() => setMode("naive")}>naïve</button>
            <button className={mode === "tiled" ? "on" : ""} onClick={() => setMode("tiled")}>tiled / blocked</button>
          </div>
          <div className="fixhint">
            {mode === "naive"
              ? "B[:,j] in row-major = stride N per k-step → cache miss every element"
              : `NB×NB tile loaded once, reused NB times → NB× fewer DRAM reads`}
          </div>
        </div>
        {mode === "tiled" && (
          <div className="ctrl">
            <label>Tile size NB<b>{nb}</b></label>
            <div className="seg fix">
              {NB_OPTIONS.map((v) => (
                <button key={v} className={nb === v ? "on" : ""} onClick={() => setNb(v)}>{v}</button>
              ))}
            </div>
            <div className="fixhint">
              NB=2 → 16 floats = 64 B · NB=4 → 64 floats = 256 B · NB=8 → 256 floats = 1 KB (all fit in L1)
            </div>
          </div>
        )}
        <div className="ctrl">
          <label>Parallelism</label>
          <div className="seg">
            {(["serial", "openmp", "gpu"] as Par[]).map((p) => (
              <button key={p} className={par === p ? "on" : ""} onClick={() => setPar(p)}>{p === "openmp" ? "OpenMP" : p}</button>
            ))}
          </div>
        </div>
        <div className="ctrl" style={{ marginTop: 8 }}>
          <div className="eb how">
            <div className="t" style={{ color: isComputeBound ? "#3ddc97" : intensity > 1 ? "#ffb454" : "#ff5d73" }}>
              Arithmetic intensity ≈ {intensity.toFixed(1)} FLOP/byte
              {isComputeBound ? " — compute-bound ✓" : ` — memory-bound (ridge ≈ ${ridgePoint})`}
            </div>
            <div className="body" style={{ fontSize: 12, marginTop: 4 }}>
              {mode === "naive"
                ? `Naïve N=1024: ~2 TFLOP, ~4 TB/s DRAM traffic — bandwidth is the wall`
                : `NB=${nb}: ${intensity.toFixed(1)}× better than naïve · NB=32 (prod): 8 FLOP/byte`}
            </div>
          </div>
        </div>
        <div className="ctrl">
          <div className="ref-related" style={{ marginTop: 4 }}>
            <Link className="learn-link" style={{ marginTop: 0 }} href="/?exp=cacheHierarchy">Cache Hierarchy experiment →</Link>
            <Link className="learn-link" style={{ marginTop: 0 }} href="/?exp=cudaCoalesce">GPU Coalescing →</Link>
            <Link className="learn-link" style={{ marginTop: 0 }} href="/?exp=simdVec">SIMD Vectorization →</Link>
          </div>
        </div>
      </section>

      <section className="card vizwrap">
        <h2>
          <span>C = A × B · {N}×{N} animation</span>
          <span className="scene-tag">{mode === "naive" ? "red = stride-N miss on B" : `green = NB=${nb} tile in cache`}</span>
        </h2>
        <canvas className="viz lab-canvas" ref={canvasRef} />
      </section>

      <section className="card explain">
        <h2>
          <span>{mode === "naive" ? "Naïve" : `Tiled NB=${nb}`} · {par === "serial" ? "serial" : par === "openmp" ? "OpenMP" : "CUDA"}</span>
          <span className="scene-tag">pick pattern + model →</span>
        </h2>
        <p className="learn-blurb">
          <Glossed>{"C[i][j] = Σₖ A[i][k]·B[k][j]. In row-major storage A[i][:] is contiguous (sequential reads — good), but B[:][j] jumps N floats between consecutive k values — one cache miss per element. Tiled GEMM reorders the loops to keep an NB×NB block of B in L1 cache and reuse it NB times, trading memory bandwidth for arithmetic intensity."}</Glossed>
        </p>
        <div className="code">
          {code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
        </div>
        <div className="eb how" style={{ marginTop: 12 }}>
          <div className="t">
            {mode === "naive" ? "Why it stalls" : `Why NB=${nb} helps`}
            {par === "gpu" ? " on GPU" : par === "openmp" ? " with OpenMP" : ""}
          </div>
          <div className="body"><Glossed>{note}</Glossed></div>
        </div>
      </section>
    </div>
  );
}
