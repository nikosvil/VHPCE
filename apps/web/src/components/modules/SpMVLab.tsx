"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "../Glossed";

// Sparse Matrix-Vector Multiply (SpMV): y = A * x
// CSR format: row_ptr, col_idx, val arrays
// Arithmetic intensity: ~2 FLOP per 12 bytes loaded (0.17 FLOP/byte) — deeply memory-bound
// Key lesson: irregular access x[col_idx[p]] defeats caching; load imbalance dominates on power-law graphs

type Pattern = "banded" | "random" | "powerlaw";
type Model = "serial" | "openmp" | "mpi" | "gpu";

/** Build column indices for each row based on sparsity pattern */
function buildSparsity(N: number, pattern: Pattern): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < N; i++) {
    const cols: number[] = [];
    if (pattern === "banded") {
      // 5-point stencil: diagonals at -2, -1, 0, +1, +2
      for (let d = -2; d <= 2; d++) {
        const j = i + d;
        if (j >= 0 && j < N) cols.push(j);
      }
    } else if (pattern === "random") {
      // ~5 random entries per row
      const set = new Set<number>();
      set.add(i); // always include diagonal
      const rng = (seed: number) => {
        let s = seed;
        return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      };
      const rand = rng(i * 7919 + 31);
      while (set.size < Math.min(5, N)) {
        set.add(Math.floor(rand() * N));
      }
      cols.push(...Array.from(set).sort((a, b) => a - b));
    } else {
      // power-law: row 0 has many entries, row N-1 has few
      const nnz = Math.max(1, Math.round(N * 0.8 * Math.pow(1 - i / N, 2)) + 1);
      const set = new Set<number>();
      set.add(i); // always include diagonal
      const rng = (seed: number) => {
        let s = seed;
        return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      };
      const rand = rng(i * 6271 + 17);
      while (set.size < Math.min(nnz, N)) {
        set.add(Math.floor(rand() * N));
      }
      cols.push(...Array.from(set).sort((a, b) => a - b));
    }
    rows.push(cols);
  }
  return rows;
}

/** Compute how many nnz each worker gets for the bar chart */
function workerLoads(rows: number[][], nWorkers: number): number[] {
  const loads = new Array(nWorkers).fill(0);
  const chunkSize = Math.ceil(rows.length / nWorkers);
  for (let i = 0; i < rows.length; i++) {
    const w = Math.min(Math.floor(i / chunkSize), nWorkers - 1);
    loads[w] += rows[i].length;
  }
  return loads;
}

type ModelEntry = {
  label: string;
  t: string;
  note: string;
  code: string;
  links: { href: string; label: string }[];
};

const MODELS: Record<Model, ModelEntry> = {
  serial: {
    label: "serial",
    t: "Serial CSR SpMV",
    note: "CSR (Compressed Sparse Row) stores only non-zero values. Each row's entries are contiguous in memory, but the column indices are irregular — every x[col_idx[p]] access is a potential cache miss.",
    code: `// CSR SpMV: y = A * x
for (i = 0; i < N; i++) {
  sum = 0.0;
  for (p = row_ptr[i]; p < row_ptr[i+1]; p++)
    sum += val[p] * x[col_idx[p]];
  y[i] = sum;
}`,
    links: [],
  },
  openmp: {
    label: "OpenMP",
    t: "OpenMP — dynamic scheduling",
    note: "Rows are independent — parallelize the outer loop. Use schedule(dynamic) because row lengths vary: static scheduling assigns equal row ranges, but if some rows have 100× more non-zeros than others, the heaviest thread becomes the bottleneck.",
    code: `#pragma omp parallel for schedule(dynamic, 16)
for (i = 0; i < N; i++) {
  double sum = 0.0;
  for (p = row_ptr[i]; p < row_ptr[i+1]; p++)
    sum += val[p] * x[col_idx[p]];
  y[i] = sum;
}`,
    links: [
      { href: "/reference?id=omp_schedule", label: "schedule clause" },
      { href: "/?exp=imbalance", label: "Load Imbalance experiment" },
    ],
  },
  mpi: {
    label: "MPI",
    t: "MPI — row partitioning + Allgatherv",
    note: "The sparse structure means any row can reference any column — so every rank needs the full x vector (Allgatherv). For banded matrices, only neighbour communication is needed (like halo exchange); for unstructured matrices, the all-to-all pattern dominates.",
    code: `/* each rank owns rows [lo..hi) */
/* x may have remote entries — gather first */
MPI_Allgatherv(x_local, my_n, MPI_DOUBLE,
               x_full, counts, displs,
               MPI_DOUBLE, comm);
for (i = lo; i < hi; i++) {
  sum = 0.0;
  for (p = row_ptr[i]; p < row_ptr[i+1]; p++)
    sum += val[p] * x_full[col_idx[p]];
  y[i] = sum;
}`,
    links: [
      { href: "/reference?id=mpi_allgatherv", label: "MPI_Allgatherv" },
      { href: "/?exp=mpiCollective", label: "MPI Collectives experiment" },
    ],
  },
  gpu: {
    label: "GPU",
    t: "GPU — one warp per row",
    note: "Assigning one warp per row lets 32 threads cooperate on a single dot product, with warp-shuffle reduction avoiding shared memory. Short rows waste lanes; long rows keep them busy. The irregular x[col_idx[p]] access defeats coalescing — this is why SpMV is memory-bound on GPUs.",
    code: `// one warp (32 threads) per row
__global__ void spmv_csr(int N,
    const int *row_ptr, const int *col_idx,
    const double *val, const double *x,
    double *y) {
  int row = blockIdx.x * blockDim.y + threadIdx.y;
  if (row >= N) return;
  double sum = 0.0;
  for (int p = row_ptr[row] + threadIdx.x;
       p < row_ptr[row+1]; p += 32)
    sum += val[p] * x[col_idx[p]];
  // warp-level reduction
  for (int d = 16; d > 0; d >>= 1)
    sum += __shfl_down_sync(0xFFFFFFFF, sum, d);
  if (threadIdx.x == 0) y[row] = sum;
}`,
    links: [
      { href: "/reference?id=cuda_shfl", label: "__shfl_down_sync" },
      { href: "/?exp=cudaCoalesce", label: "GPU Coalescing experiment" },
    ],
  },
};

const PATTERN_LABELS: Record<Pattern, string> = {
  banded: "banded (5-point stencil)",
  random: "random sparse",
  powerlaw: "power-law (graph)",
};

export default function SpMVLab() {
  const [N, setN] = useState(16);
  const [pattern, setPattern] = useState<Pattern>("banded");
  const [model, setModel] = useState<Model>("serial");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ N, pattern, model });
  useEffect(() => { cfg.current = { N, pattern, model }; });

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    let w = 1, h = 1, raf = 0, startTs = -1;

    const resize = () => {
      const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };

    const loop = (ts: number) => {
      if (startTs < 0) startTs = ts;
      const elapsed = ts - startTs;
      const { N: n, pattern: pat, model: mod } = cfg.current;

      const rows = buildSparsity(n, pat);
      const totalNnz = rows.reduce((s, r) => s + r.length, 0);

      // Animation: advance through rows at ~8 rows/second for N=16
      const currentRow = Math.floor(elapsed * 0.008) % n;

      // Determine worker count based on model
      const nWorkers = mod === "serial" ? 1 : mod === "gpu" ? Math.min(8, n) : 4;
      const loads = workerLoads(rows, nWorkers);
      const maxLoad = Math.max(...loads, 1);

      // Check balance: coefficient of variation
      const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
      const variance = loads.reduce((s, l) => s + (l - avgLoad) ** 2, 0) / loads.length;
      const cv_ = avgLoad > 0 ? Math.sqrt(variance) / avgLoad : 0;
      const balanced = cv_ < 0.25;

      // Layout: left panel 65%, right panel 35%
      const leftW = w * 0.65;
      const rightW = w * 0.35;
      const rightX = leftW;

      // --- Matrix grid dimensions ---
      const matPad = 12;
      const xVecW = 24;  // width for x vector column
      const yVecW = 24;  // width for y vector column
      const availW = leftW - matPad * 2 - xVecW - 12 - yVecW - 8;
      const availH = h - matPad * 2 - 24; // leave room for labels
      const cellSize = Math.max(3, Math.min(20, Math.floor(Math.min(availW, availH) / n)));
      const gridW = n * cellSize;
      const gridH = n * cellSize;

      const gridX = matPad;
      const gridY = matPad + 18; // room for label

      const xVecX = gridX + gridW + 10;
      const xVecY = gridY;

      const yVecX = xVecX + xVecW + 8;
      const yVecY = gridY;

      ctx.clearRect(0, 0, w, h);

      // --- LEFT PANEL: Sparse matrix + vectors ---

      // Background for left panel
      ctx.fillStyle = "#070a10";
      ctx.fillRect(0, 0, leftW, h);

      // Labels
      ctx.fillStyle = "#8a9bb4";
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`A (${n}×${n})`, gridX + gridW / 2, gridY - 6);
      ctx.fillText("x", xVecX + xVecW / 2, xVecY - 6);
      ctx.fillText("y", yVecX + yVecW / 2, yVecY - 6);

      // Multiplication and equals signs
      ctx.fillStyle = "#5e6e88";
      ctx.font = "600 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      const midY = gridY + gridH / 2;
      ctx.fillText("·", xVecX - 4, midY + 4);
      ctx.fillText("=", yVecX - 4, midY + 4);

      // Draw sparse matrix grid
      for (let r = 0; r < n; r++) {
        const rowCols = rows[r];
        const isCurrentRow = r === currentRow;
        for (let c = 0; c < n; c++) {
          const x = gridX + c * cellSize;
          const y = gridY + r * cellSize;
          const isNonZero = rowCols.includes(c);

          // Cell background
          if (isCurrentRow) {
            ctx.fillStyle = "#0d1a2e";
          } else {
            ctx.fillStyle = "#080e1c";
          }
          ctx.fillRect(x, y, cellSize - 1, cellSize - 1);

          // Non-zero entries as dots
          if (isNonZero) {
            const dotR = Math.max(1.5, cellSize * 0.25);
            const cx = x + cellSize / 2;
            const cy = y + cellSize / 2;

            if (isCurrentRow) {
              // Bright cyan with glow for current row
              ctx.shadowColor = "#4cc9f0";
              ctx.shadowBlur = 6;
              ctx.fillStyle = "#4cc9f0";
            } else {
              ctx.fillStyle = "#4cc9f044";
              ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }

          // Grid lines
          ctx.strokeStyle = "#10192a";
          ctx.lineWidth = 0.3;
          ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
        }
      }

      // Draw x vector
      for (let r = 0; r < n; r++) {
        const x = xVecX;
        const y = xVecY + r * cellSize;
        const isAccessed = rows[currentRow].includes(r);

        ctx.fillStyle = isAccessed ? "#4cc9f033" : "#080e1c";
        ctx.fillRect(x, y, xVecW, cellSize - 1);

        if (isAccessed) {
          ctx.fillStyle = "#4cc9f0";
          ctx.fillRect(x + 2, y + 2, xVecW - 4, cellSize - 5);
        }

        ctx.strokeStyle = "#10192a";
        ctx.lineWidth = 0.3;
        ctx.strokeRect(x + 0.5, y + 0.5, xVecW, cellSize - 1);
      }

      // Draw y vector
      for (let r = 0; r < n; r++) {
        const x = yVecX;
        const y = yVecY + r * cellSize;
        const isCurrentOutput = r === currentRow;

        ctx.fillStyle = isCurrentOutput ? "#3ddc9744" : "#080e1c";
        ctx.fillRect(x, y, yVecW, cellSize - 1);

        if (isCurrentOutput) {
          ctx.shadowColor = "#3ddc97";
          ctx.shadowBlur = 6;
          ctx.fillStyle = "#3ddc97";
          ctx.fillRect(x + 2, y + 2, yVecW - 4, cellSize - 5);
          ctx.shadowBlur = 0;
        }

        ctx.strokeStyle = "#10192a";
        ctx.lineWidth = 0.3;
        ctx.strokeRect(x + 0.5, y + 0.5, yVecW, cellSize - 1);
      }

      // Draw access lines from current row non-zeros to x vector
      const currentCols = rows[currentRow];
      ctx.strokeStyle = "#4cc9f044";
      ctx.lineWidth = 1;
      for (const c of currentCols) {
        const fromX = gridX + c * cellSize + cellSize / 2;
        const fromY = gridY + currentRow * cellSize + cellSize / 2;
        const toX = xVecX;
        const toY = xVecY + c * cellSize + cellSize / 2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
      }

      // --- RIGHT PANEL: Row work distribution bar chart ---

      ctx.fillStyle = "#0a0f1a";
      ctx.fillRect(rightX, 0, rightW, h);

      // Divider line
      ctx.strokeStyle = "#1a2535";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rightX, 0);
      ctx.lineTo(rightX, h);
      ctx.stroke();

      const chartPadX = 16;
      const chartPadY = 36;
      const chartW = rightW - chartPadX * 2;
      const barAreaH = h - chartPadY * 2;
      const barH = Math.max(8, Math.min(28, (barAreaH - (nWorkers - 1) * 4) / nWorkers));

      // Chart title
      ctx.fillStyle = "#8a9bb4";
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("nnz per worker", rightX + rightW / 2, chartPadY - 12);

      // Balance indicator
      ctx.fillStyle = balanced ? "#3ddc97" : "#ff5d73";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.fillText(balanced ? "balanced" : "imbalanced", rightX + rightW / 2, chartPadY - 1);

      // Draw bars
      for (let i = 0; i < nWorkers; i++) {
        const barY = chartPadY + 8 + i * (barH + 4);
        const barW_ = maxLoad > 0 ? (loads[i] / maxLoad) * chartW * 0.8 : 0;
        const barX = rightX + chartPadX;

        // Bar color: green if balanced, red if not
        const barColor = balanced ? "#3ddc97" : (loads[i] > avgLoad * 1.3 ? "#ff5d73" : "#ffb454");
        ctx.fillStyle = barColor + "88";
        ctx.fillRect(barX, barY, barW_, barH);
        ctx.fillStyle = barColor;
        ctx.fillRect(barX, barY, barW_, 2); // top accent

        // Worker label
        ctx.fillStyle = "#8a9bb4";
        ctx.font = "10px ui-monospace, monospace";
        ctx.textAlign = "left";
        const workerLabel = mod === "serial" ? "CPU" : mod === "gpu" ? `w${i}` : mod === "mpi" ? `r${i}` : `t${i}`;
        ctx.fillText(workerLabel, barX + barW_ + 4, barY + barH * 0.7);

        // nnz count
        ctx.textAlign = "right";
        ctx.fillStyle = "#5e6e88";
        ctx.fillText(`${loads[i]}`, barX + chartW, barY + barH * 0.7);
      }

      // Total nnz label at bottom
      ctx.fillStyle = "#5e6e88";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`total nnz: ${totalNnz}`, rightX + rightW / 2, h - 10);

      // Caption
      ctx.fillStyle = "#4cc9f0";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        `row ${currentRow}: ${currentCols.length} non-zeros — ${PATTERN_LABELS[pat]}`,
        leftW / 2, h - 8,
      );

      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const m = MODELS[model];
  return (
    <div className="grid">
      <section className="card">
        <h2>Controls</h2>
        <div className="ctrl">
          <label>Matrix size N<b>{N}</b></label>
          <div className="seg fix">
            {([8, 16, 32] as const).map((v) => (
              <button key={v} className={N === v ? "on" : ""} onClick={() => setN(v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="ctrl">
          <label>Sparsity pattern</label>
          <div className="seg fix">
            {(["banded", "random", "powerlaw"] as Pattern[]).map((p) => (
              <button key={p} className={pattern === p ? "on" : ""} onClick={() => setPattern(p)}>
                {p === "powerlaw" ? "power-law" : p}
              </button>
            ))}
          </div>
          <div className="fixhint">
            {pattern === "banded"
              ? "5-point stencil: uniform 5 nnz per row — perfectly balanced across workers"
              : pattern === "random"
              ? "~5 random entries per row — varying positions, moderate imbalance"
              : "Row 0 has many entries, row N−1 has few — severe load imbalance"}
          </div>
        </div>
        <div className="ctrl">
          <label>Parallel model</label>
          <div className="seg">
            {(["serial", "openmp", "mpi", "gpu"] as Model[]).map((k) => (
              <button key={k} className={model === k ? "on" : ""} onClick={() => setModel(k)}>{MODELS[k].label}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="card vizwrap">
        <h2>
          <span>SpMV: y = A·x · {N}×{N}</span>
          <span className="scene-tag">{PATTERN_LABELS[pattern]}</span>
        </h2>
        <canvas className="viz lab-canvas" ref={canvasRef} />
      </section>

      <section className="card explain">
        <h2>
          <span>SpMV in {m.label}</span>
          <span className="scene-tag">pick a model →</span>
        </h2>
        <p className="learn-blurb">
          <Glossed>{"y[i] = Σ A[i][j]·x[j] over non-zero j only. CSR stores row_ptr (where each row starts), col_idx (which columns), and val (the non-zero values). The inner loop walks contiguous val[] and col_idx[] arrays — sequential and cacheable — but every x[col_idx[p]] access jumps to an unpredictable location in the x vector."}</Glossed>
        </p>
        <div className="code">
          {m.code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
        </div>
        <div className="eb how" style={{ marginTop: 12 }}>
          <div className="t">{m.t}</div>
          <div className="body"><Glossed>{m.note}</Glossed></div>
        </div>
        {m.links.length > 0 && (
          <div className="ref-related" style={{ marginTop: 10 }}>
            {m.links.map((l) => <Link key={l.href} className="learn-link" style={{ marginTop: 0 }} href={l.href}>{l.label}</Link>)}
          </div>
        )}
      </section>

      <section className="card explain" style={{ marginTop: 0 }}>
        <h2><span>Why SpMV matters</span></h2>
        <div className="eb how">
          <div className="t" style={{ color: "#ff5d73" }}>Inherently memory-bound</div>
          <div className="body">
            <Glossed>{"Most scientific simulations (FEM, CFD, graph analytics) spend their time in SpMV. It is inherently memory-bound: arithmetic intensity ≈ 2 FLOP per 12 bytes loaded (2 FLOP/12B ≈ 0.17) — far below any roofline ridge point."}</Glossed>
          </div>
        </div>
        <div className="eb how" style={{ marginTop: 8 }}>
          <div className="t" style={{ color: "#ffb454" }}>The load-balance problem</div>
          <div className="body">
            <Glossed>{"Banded matrices (structured grids) have uniform row lengths — easy to balance. Unstructured meshes and power-law graphs have wildly varying row lengths — dynamic scheduling or graph partitioning is essential."}</Glossed>
          </div>
        </div>
        <div className="ref-related" style={{ marginTop: 10 }}>
          <Link className="learn-link" style={{ marginTop: 0 }} href="/?lab=gemm">Compare with the Matrix Multiply lab, where every access pattern is regular →</Link>
        </div>
      </section>
    </div>
  );
}
