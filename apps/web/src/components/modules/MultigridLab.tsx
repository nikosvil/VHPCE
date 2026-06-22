"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "../Glossed";

// 1-D Poisson: -u'' = f on [0,1], u(0)=u(1)=0
// f = sin(pi*x) + sin(8*pi*x) — low + high frequency
// Jacobi: u_new[i] = 0.5*(u[i-1]+u[i+1]+h^2*f[i])
// Multigrid V-cycle: smooth → restrict → recurse → prolongate → smooth

const N_FINE = 64;

type Method = "jacobi" | "vcycle";
type Model = "serial" | "openmp" | "mpi" | "gpu";
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
    t: "Serial V-cycle (recursive)",
    note: "The V-cycle is recursive: each level smooths, restricts the residual to a coarser grid, solves there (recursively), and prolongates the correction back. The total work is O(N) because each coarser level has half the points.",
    code: `void vcycle(double *u, double *f, int n, int levels) {
  if (levels == 1) { solve_exact(u, f, n); return; }
  smooth(u, f, n, nu1);           // pre-smooth
  residual(u, f, r, n);           // r = f - Au
  restrict(r, r_c, n);            // full-weight to coarse
  zero(e_c, n/2);
  vcycle(e_c, r_c, n/2, levels-1);// recurse
  prolongate(e_c, e, n);          // interpolate back
  correct(u, e, n);               // u += e
  smooth(u, f, n, nu2);           // post-smooth
}`,
    links: [],
  },
  openmp: {
    label: "OpenMP",
    t: "OpenMP — parallel smoothing + transfers",
    note: "Smoothing and grid transfers (restrict/prolongate) are parallel across grid points. The challenge: coarser levels have fewer points, so thread utilisation drops — a classic load-balance problem across the V-cycle levels.",
    code: `void smooth(double *u, double *f, int n, int steps) {
  for (int s = 0; s < steps; s++) {
    #pragma omp parallel for
    for (int i = 1; i < n-1; i++)
      u_new[i] = 0.5*(u[i-1]+u[i+1]+h2*f[i]);
    swap(u, u_new);
  }
}
/* restrict + prolongate: also parallel for */`,
    links: [
      { href: "/reference?id=omp_parallel_for", label: "omp parallel for" },
      { href: "/?exp=imbalance", label: "Load Imbalance experiment" },
    ],
  },
  mpi: {
    label: "MPI",
    t: "MPI — distributed slab with halo exchange",
    note: "At each coarser level, the number of grid points halves — so either ranks share fewer points (poor scaling) or half the ranks idle out. Distributed multigrid is a classic example of the tension between parallelism and hierarchy.",
    code: `/* each rank owns a contiguous slab of grid points */
void smooth_mpi(double *u, double *f, int lo,
                int hi, MPI_Comm comm) {
  /* exchange boundary values with neighbours */
  MPI_Sendrecv(&u[lo], 1, MPI_DOUBLE, left, 0,
               &u[hi+1], 1, MPI_DOUBLE, right, 0,
               comm, &st);
  MPI_Sendrecv(&u[hi], 1, MPI_DOUBLE, right, 1,
               &u[lo-1], 1, MPI_DOUBLE, left, 1,
               comm, &st);
  for (int i = lo; i <= hi; i++)
    u_new[i] = 0.5*(u[i-1]+u[i+1]+h2*f[i]);
}
/* at coarser levels, some ranks go idle */`,
    links: [
      { href: "/reference?id=mpi_sendrecv", label: "MPI_Sendrecv" },
      { href: "/?exp=mpiHalo", label: "MPI Halo Exchange experiment" },
    ],
  },
  gpu: {
    label: "GPU",
    t: "GPU — one kernel per operation, occupancy drops on coarse levels",
    note: "Fine levels have enough parallelism to fill the GPU. Coarse levels have so few points that kernel launches barely occupy a few warps — the GPU is mostly idle. This motivates batched multigrid (solving many independent systems simultaneously) to maintain occupancy.",
    code: `__global__ void jacobi_smooth(double *u,
    double *u_new, const double *f,
    int n, double h2) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i > 0 && i < n-1)
    u_new[i] = 0.5*(u[i-1]+u[i+1]+h2*f[i]);
}
// V-cycle: one kernel per smooth/restrict/prolong
// coarse levels: fewer threads, lower occupancy
for (int lev = 0; lev < levels; lev++) {
  int n_lev = n >> lev;
  jacobi_smooth<<<(n_lev+255)/256, 256>>>(
      u[lev], tmp[lev], f[lev], n_lev, h2[lev]);
}`,
    links: [
      { href: "/reference?id=cuda_occupancy", label: "Occupancy API" },
      { href: "/?exp=cuda", label: "GPU Occupancy experiment" },
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Numerical helpers                                                  */
/* ------------------------------------------------------------------ */

function makeRHS(n: number): Float64Array {
  const f = new Float64Array(n);
  const h = 1 / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = i * h;
    f[i] = Math.sin(Math.PI * x) + Math.sin(8 * Math.PI * x);
  }
  return f;
}

function jacobiSmooth(u: Float64Array, f: Float64Array, n: number, steps: number) {
  const h = 1 / (n - 1);
  const h2 = h * h;
  const tmp = new Float64Array(n);
  for (let s = 0; s < steps; s++) {
    for (let i = 1; i < n - 1; i++) {
      tmp[i] = 0.5 * (u[i - 1] + u[i + 1] + h2 * f[i]);
    }
    tmp[0] = 0;
    tmp[n - 1] = 0;
    u.set(tmp);
  }
}

function computeResidual(u: Float64Array, f: Float64Array, n: number): Float64Array {
  const r = new Float64Array(n);
  const h = 1 / (n - 1);
  const h2 = h * h;
  for (let i = 1; i < n - 1; i++) {
    r[i] = f[i] - (u[i - 1] - 2 * u[i] + u[i + 1]) / h2;
  }
  return r;
}

function residualNorm(u: Float64Array, f: Float64Array, n: number): number {
  const r = computeResidual(u, f, n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += r[i] * r[i];
  return Math.sqrt(sum);
}

function restrict(fine: Float64Array, nFine: number): Float64Array {
  const nCoarse = ((nFine - 1) >> 1) + 1;
  const coarse = new Float64Array(nCoarse);
  for (let i = 1; i < nCoarse - 1; i++) {
    const j = 2 * i;
    coarse[i] = 0.25 * fine[j - 1] + 0.5 * fine[j] + 0.25 * fine[j + 1];
  }
  coarse[0] = 0;
  coarse[nCoarse - 1] = 0;
  return coarse;
}

function prolongate(coarse: Float64Array, nCoarse: number, nFine: number): Float64Array {
  const fine = new Float64Array(nFine);
  for (let i = 0; i < nCoarse; i++) {
    fine[2 * i] = coarse[i];
  }
  for (let i = 0; i < nCoarse - 1; i++) {
    fine[2 * i + 1] = 0.5 * (coarse[i] + coarse[i + 1]);
  }
  return fine;
}

/* ------------------------------------------------------------------ */
/*  V-cycle step generator (yields operations for animation)           */
/* ------------------------------------------------------------------ */

type VCycleOp =
  | { type: "presmooth"; level: number }
  | { type: "restrict"; level: number }
  | { type: "coarsesolve"; level: number }
  | { type: "prolongate"; level: number }
  | { type: "postsmooth"; level: number };

function buildVCycleOps(levels: number): VCycleOp[] {
  const ops: VCycleOp[] = [];
  function recurse(lev: number) {
    if (lev === levels - 1) {
      ops.push({ type: "coarsesolve", level: lev });
      return;
    }
    ops.push({ type: "presmooth", level: lev });
    ops.push({ type: "restrict", level: lev });
    recurse(lev + 1);
    ops.push({ type: "prolongate", level: lev });
    ops.push({ type: "postsmooth", level: lev });
  }
  recurse(0);
  return ops;
}

/* ------------------------------------------------------------------ */
/*  State for one multigrid simulation                                 */
/* ------------------------------------------------------------------ */

interface MGState {
  levels: number;
  smoothSteps: number;
  /* per-level arrays */
  u: Float64Array[];
  f: Float64Array[];
  sizes: number[];
  /* convergence history */
  jacobiResiduals: number[];
  vcycleResiduals: number[];
  /* animation */
  ops: VCycleOp[];
  opIndex: number;
  jacobiU: Float64Array;
  jacobiF: Float64Array;
  vcycleCount: number;
  jacobiCount: number;
}

function initMGState(levels: number, smoothSteps: number): MGState {
  const sizes: number[] = [];
  let n = N_FINE;
  for (let l = 0; l < levels; l++) {
    sizes.push(n);
    n = ((n - 1) >> 1) + 1;
  }

  const u: Float64Array[] = sizes.map((s) => new Float64Array(s));
  const f: Float64Array[] = [makeRHS(sizes[0])];
  for (let l = 1; l < levels; l++) f.push(new Float64Array(sizes[l]));

  const jacobiU = new Float64Array(sizes[0]);
  const jacobiF = makeRHS(sizes[0]);

  const r0 = residualNorm(new Float64Array(sizes[0]), jacobiF, sizes[0]);

  return {
    levels,
    smoothSteps,
    u,
    f,
    sizes,
    jacobiResiduals: [r0],
    vcycleResiduals: [r0],
    ops: buildVCycleOps(levels),
    opIndex: 0,
    jacobiU,
    jacobiF,
    vcycleCount: 0,
    jacobiCount: 0,
  };
}

/* Execute one V-cycle operation, advancing the state */
function stepVCycleOp(st: MGState): VCycleOp {
  const op = st.ops[st.opIndex];
  const lev = op.level;
  const n = st.sizes[lev];

  switch (op.type) {
    case "presmooth":
      jacobiSmooth(st.u[lev], st.f[lev], n, st.smoothSteps);
      break;
    case "restrict": {
      const r = computeResidual(st.u[lev], st.f[lev], n);
      const rc = restrict(r, n);
      st.f[lev + 1] = rc;
      st.u[lev + 1].fill(0);
      break;
    }
    case "coarsesolve":
      jacobiSmooth(st.u[lev], st.f[lev], n, 50);
      break;
    case "prolongate": {
      const nCoarse = st.sizes[lev + 1];
      const correction = prolongate(st.u[lev + 1], nCoarse, n);
      for (let i = 0; i < n; i++) st.u[lev][i] += correction[i];
      break;
    }
    case "postsmooth":
      jacobiSmooth(st.u[lev], st.f[lev], n, st.smoothSteps);
      break;
  }

  st.opIndex++;

  /* If we completed a full V-cycle, record residual and reset */
  if (st.opIndex >= st.ops.length) {
    st.opIndex = 0;
    st.vcycleCount++;
    const rn = residualNorm(st.u[0], st.f[0], st.sizes[0]);
    st.vcycleResiduals.push(rn);
  }

  return op;
}

/* Run Jacobi-only steps (one "iteration" worth of smoothing for comparison) */
function stepJacobi(st: MGState) {
  jacobiSmooth(st.jacobiU, st.jacobiF, st.sizes[0], st.smoothSteps);
  st.jacobiCount++;
  const rn = residualNorm(st.jacobiU, st.jacobiF, st.sizes[0]);
  st.jacobiResiduals.push(rn);
}

/* ------------------------------------------------------------------ */
/*  Error-magnitude color ramp: red = high, green = low, dark = zero   */
/* ------------------------------------------------------------------ */

function errorColor(err: number, maxErr: number): string {
  if (maxErr < 1e-15) return "#0a1020";
  const t = Math.min(1, Math.abs(err) / maxErr);
  if (t < 0.01) return "#0a1020";
  if (t < 0.3) {
    const s = t / 0.3;
    const r = Math.round(10 + 51 * s);
    const g = Math.round(16 + 204 * s);
    const b = Math.round(32 + 119 * s);
    return `rgb(${r},${g},${b})`;
  }
  const s = (t - 0.3) / 0.7;
  const r = Math.round(61 + 194 * s);
  const g = Math.round(220 - 127 * s);
  const b = Math.round(151 - 38 * s);
  return `rgb(${r},${g},${b})`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MultigridLab() {
  const [levels, setLevels] = useState(3);
  const [smoothSteps, setSmoothSteps] = useState(2);
  const [method, setMethod] = useState<Method>("vcycle");
  const [model, setModel] = useState<Model>("serial");
  const [playing, setPlaying] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<MGState>(initMGState(3, 2));
  const currentOp = useRef<VCycleOp | null>(null);
  const opTimer = useRef(0);
  const cfg = useRef({ levels, smoothSteps, method, model, playing });
  useEffect(() => {
    cfg.current = { levels, smoothSteps, method, model, playing };
  });

  const reset = (newLevels?: number, newSmooth?: number) => {
    const l = newLevels ?? levels;
    const s = newSmooth ?? smoothSteps;
    stateRef.current = initMGState(l, s);
    currentOp.current = null;
    opTimer.current = 0;
  };

  const handleLevels = (v: number) => {
    setLevels(v);
    reset(v, undefined);
  };

  const handleSmooth = (v: number) => {
    setSmoothSteps(v);
    reset(undefined, v);
  };

  const handleMethod = (m: Method) => {
    setMethod(m);
    reset();
  };

  /* Main animation loop */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 1, h = 1, raf = 0;
    let lastTs = -1;
    let accumMs = 0;

    const resize = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr);
      cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = rect.width;
      h = rect.height;
    };

    /* ---- drawing helpers ---- */

    const drawGridLevel = (
      cx: CanvasRenderingContext2D,
      ox: number, oy: number,
      cellW: number, cellH: number,
      values: Float64Array, n: number,
      maxErr: number,
      highlighted: boolean,
      label: string,
    ) => {
      /* draw cells */
      for (let i = 0; i < n; i++) {
        const x = ox + i * cellW;
        cx.fillStyle = errorColor(values[i], maxErr);
        cx.fillRect(x, oy, cellW - 1, cellH);
      }
      /* border for highlighted level */
      if (highlighted) {
        cx.strokeStyle = "#4cc9f0";
        cx.lineWidth = 2;
        cx.strokeRect(ox - 1, oy - 1, n * cellW + 2, cellH + 2);
      }
      /* label */
      cx.fillStyle = "#8a9bb4";
      cx.font = "10px ui-monospace, monospace";
      cx.textAlign = "right";
      cx.fillText(label, ox - 6, oy + cellH / 2 + 3);
    };

    const drawArrow = (
      cx: CanvasRenderingContext2D,
      x: number, y1: number, y2: number,
      color: string, label: string,
    ) => {
      cx.strokeStyle = color;
      cx.lineWidth = 1.5;
      cx.beginPath();
      cx.moveTo(x, y1);
      cx.lineTo(x, y2);
      cx.stroke();
      const dir = y2 > y1 ? 1 : -1;
      cx.beginPath();
      cx.moveTo(x - 4, y2 - dir * 6);
      cx.lineTo(x, y2);
      cx.lineTo(x + 4, y2 - dir * 6);
      cx.stroke();
      cx.fillStyle = color;
      cx.font = "9px ui-monospace, monospace";
      cx.textAlign = "left";
      cx.fillText(label, x + 6, (y1 + y2) / 2 + 3);
    };

    const drawConvergence = (
      cx: CanvasRenderingContext2D,
      ox: number, oy: number, pw: number, ph: number,
      jacResid: number[], vcResid: number[],
    ) => {
      /* background */
      cx.fillStyle = "#080e1c";
      cx.fillRect(ox, oy, pw, ph);
      cx.strokeStyle = "#1a2535";
      cx.lineWidth = 1;
      cx.strokeRect(ox, oy, pw, ph);

      /* title */
      cx.fillStyle = "#e0e8f0";
      cx.font = "bold 11px ui-monospace, monospace";
      cx.textAlign = "center";
      cx.fillText("Convergence (log residual)", ox + pw / 2, oy + 14);

      const plotX = ox + 36;
      const plotY = oy + 24;
      const plotW = pw - 48;
      const plotH = ph - 44;

      /* find y range */
      const allVals = [...jacResid, ...vcResid].filter((v) => v > 0);
      if (allVals.length === 0) return;
      let yMax = Math.log10(Math.max(...allVals)) + 0.5;
      let yMin = yMax - 10;
      if (yMin > -1) yMin = -1;
      if (yMax < 2) yMax = 2;

      const maxIter = Math.max(jacResid.length, vcResid.length, 10);

      const toX = (i: number) => plotX + (i / maxIter) * plotW;
      const toY = (v: number) => {
        const lv = v > 0 ? Math.log10(v) : yMin;
        return plotY + plotH - ((lv - yMin) / (yMax - yMin)) * plotH;
      };

      /* grid lines */
      cx.strokeStyle = "#1a2535";
      cx.lineWidth = 0.5;
      cx.fillStyle = "#5e6e88";
      cx.font = "9px ui-monospace, monospace";
      cx.textAlign = "right";
      for (let e = Math.ceil(yMin); e <= Math.floor(yMax); e++) {
        const y = toY(Math.pow(10, e));
        cx.beginPath();
        cx.moveTo(plotX, y);
        cx.lineTo(plotX + plotW, y);
        cx.stroke();
        cx.fillText(`10^${e}`, plotX - 3, y + 3);
      }

      /* x axis label */
      cx.fillStyle = "#5e6e88";
      cx.font = "9px ui-monospace, monospace";
      cx.textAlign = "center";
      cx.fillText("iteration", plotX + plotW / 2, plotY + plotH + 14);

      /* Jacobi line (red dashed) */
      if (jacResid.length > 1) {
        cx.strokeStyle = "#ff5d73";
        cx.lineWidth = 1.5;
        cx.setLineDash([4, 3]);
        cx.beginPath();
        for (let i = 0; i < jacResid.length; i++) {
          const x = toX(i);
          const y = toY(jacResid[i]);
          if (i === 0) cx.moveTo(x, y);
          else cx.lineTo(x, y);
        }
        cx.stroke();
        cx.setLineDash([]);
      }

      /* V-cycle line (green solid) */
      if (vcResid.length > 1) {
        cx.strokeStyle = "#3ddc97";
        cx.lineWidth = 2;
        cx.beginPath();
        for (let i = 0; i < vcResid.length; i++) {
          const x = toX(i);
          const y = toY(vcResid[i]);
          if (i === 0) cx.moveTo(x, y);
          else cx.lineTo(x, y);
        }
        cx.stroke();
      }

      /* legend */
      const ly = plotY + plotH + 10;
      cx.setLineDash([4, 3]);
      cx.strokeStyle = "#ff5d73";
      cx.lineWidth = 1.5;
      cx.beginPath();
      cx.moveTo(plotX, ly);
      cx.lineTo(plotX + 18, ly);
      cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = "#ff5d73";
      cx.font = "9px ui-monospace, monospace";
      cx.textAlign = "left";
      cx.fillText("Jacobi: O(N²)", plotX + 22, ly + 3);

      cx.strokeStyle = "#3ddc97";
      cx.lineWidth = 2;
      cx.beginPath();
      cx.moveTo(plotX + plotW / 2, ly);
      cx.lineTo(plotX + plotW / 2 + 18, ly);
      cx.stroke();
      cx.fillStyle = "#3ddc97";
      cx.fillText("V-cycle: O(N)", plotX + plotW / 2 + 22, ly + 3);
    };

    /* ---- main loop ---- */

    /* timing constants (ms) */
    const SMOOTH_MS = 300;
    const TRANSFER_MS = 200;

    const loop = (ts: number) => {
      if (lastTs < 0) lastTs = ts;
      const dt = Math.min(ts - lastTs, 100); // cap to avoid big jumps
      lastTs = ts;

      const st = stateRef.current;
      const { method: meth, playing: pl } = cfg.current;

      if (pl) {
        accumMs += dt;

        /* decide how long the current op takes */
        const curOp = currentOp.current ?? st.ops[st.opIndex];
        const opDuration =
          curOp.type === "restrict" || curOp.type === "prolongate"
            ? TRANSFER_MS
            : SMOOTH_MS;

        if (accumMs >= opDuration) {
          accumMs -= opDuration;

          if (meth === "vcycle") {
            const op = stepVCycleOp(st);
            currentOp.current = op;
          } else {
            /* Jacobi only: just smooth on finest */
            jacobiSmooth(st.u[0], st.f[0], st.sizes[0], st.smoothSteps);
            st.jacobiCount++;
            const rn = residualNorm(st.u[0], st.f[0], st.sizes[0]);
            st.jacobiResiduals.push(rn);
            currentOp.current = { type: "presmooth", level: 0 };
          }

          /* also step Jacobi comparison line while vcycle runs */
          if (meth === "vcycle" && st.jacobiResiduals.length < st.vcycleResiduals.length + 30) {
            stepJacobi(st);
          }

          /* cap history to avoid unbounded growth */
          if (st.jacobiResiduals.length > 200) {
            st.jacobiResiduals = st.jacobiResiduals.slice(-200);
          }
          if (st.vcycleResiduals.length > 200) {
            st.vcycleResiduals = st.vcycleResiduals.slice(-200);
          }
        }
      }

      /* ---- Draw ---- */
      ctx.clearRect(0, 0, w, h);

      const leftW = w * 0.58;
      const rightW = w * 0.38;
      const rightX = leftW + w * 0.04;

      const nLevels = st.levels;
      const levelH = Math.max(12, Math.min(24, (h - 60) / (nLevels * 2.5)));
      const gap = Math.max(levelH * 0.8, 16);
      const totalLevelH = nLevels * levelH + (nLevels - 1) * gap;
      const startY = Math.max(20, (h - totalLevelH) / 2);

      /* find global max error for color scaling */
      let maxErr = 0;
      for (let l = 0; l < nLevels; l++) {
        for (let i = 0; i < st.sizes[l]; i++) {
          const a = Math.abs(st.u[l][i]);
          if (a > maxErr) maxErr = a;
        }
      }
      if (maxErr < 1e-10) maxErr = 1;

      /* label area on the left */
      const labelW = 46;
      const gridOx = labelW;

      /* highlighted level */
      const hlLevel = currentOp.current ? currentOp.current.level : -1;

      /* draw grid levels */
      for (let l = 0; l < nLevels; l++) {
        const n = st.sizes[l];
        const maxCellW = (leftW - gridOx - 8) / n;
        const cellW = Math.max(2, Math.min(maxCellW, 10));
        const oy = startY + l * (levelH + gap);

        drawGridLevel(
          ctx, gridOx, oy, cellW, levelH,
          st.u[l], n, maxErr,
          l === hlLevel,
          `${n}`,
        );

        /* operation label */
        if (l === hlLevel && currentOp.current) {
          const opLabels: Record<string, string> = {
            presmooth: "pre-smooth",
            postsmooth: "post-smooth",
            restrict: "restrict ↓",
            prolongate: "prolongate ↑",
            coarsesolve: "exact solve",
          };
          ctx.fillStyle = "#4cc9f0";
          ctx.font = "bold 10px ui-monospace, monospace";
          ctx.textAlign = "left";
          ctx.fillText(
            opLabels[currentOp.current.type] ?? "",
            gridOx + n * cellW + 8,
            oy + levelH / 2 + 4,
          );
        }
      }

      /* draw V-path arrows between levels (showing restriction/prolongation) */
      if (cfg.current.method === "vcycle" && currentOp.current) {
        const op = currentOp.current;
        if (op.type === "restrict" && op.level < nLevels - 1) {
          const y1 = startY + op.level * (levelH + gap) + levelH;
          const y2 = startY + (op.level + 1) * (levelH + gap);
          drawArrow(ctx, gridOx + 20, y1 + 2, y2 - 2, "#ffb454", "restrict");
        } else if (op.type === "prolongate" && op.level < nLevels - 1) {
          const y1 = startY + (op.level + 1) * (levelH + gap);
          const y2 = startY + op.level * (levelH + gap) + levelH;
          drawArrow(ctx, gridOx + 36, y1 - 2, y2 + 2, "#3ddc97", "prolongate");
        }
      }

      /* V-cycle path indicator */
      if (cfg.current.method === "vcycle") {
        const pathX = leftW - 30;
        ctx.fillStyle = "#5e6e88";
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("V-path", pathX, startY - 6);

        /* draw V shape from ops */
        const ops = st.ops;
        const pathPoints: { x: number; y: number }[] = [];
        const pxPerOp = Math.min(20, (leftW - pathX - 40) / ops.length);
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          const px = pathX - ops.length * pxPerOp / 2 + i * pxPerOp;
          const py = startY + op.level * (levelH + gap) + levelH / 2;
          pathPoints.push({ x: px, y: py });
        }

        ctx.strokeStyle = "#1a2535";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < pathPoints.length; i++) {
          if (i === 0) ctx.moveTo(pathPoints[i].x, pathPoints[i].y);
          else ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
        }
        ctx.stroke();

        /* highlight current position */
        if (st.opIndex < pathPoints.length) {
          const pp = pathPoints[st.opIndex];
          ctx.fillStyle = "#4cc9f0";
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      /* title for left region */
      ctx.fillStyle = "#e0e8f0";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        cfg.current.method === "vcycle"
          ? `V-cycle multigrid · ${nLevels} levels · cycle ${st.vcycleCount}`
          : `Jacobi only · iteration ${st.jacobiCount}`,
        gridOx,
        startY - 10,
      );

      /* convergence plot (right side) */
      drawConvergence(
        ctx, rightX, startY - 10,
        rightW, totalLevelH + 20,
        st.jacobiResiduals, st.vcycleResiduals,
      );

      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const m = MODELS[model];
  return (
    <div className="grid">
      <section className="card">
        <h2>Controls</h2>
        <div className="ctrl">
          <div className="step-row" style={{ marginTop: 0 }}>
            <button className="step-btn play" onClick={() => setPlaying((p) => !p)}>
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button className="step-btn" onClick={() => reset()}>
              ↻ Reset
            </button>
            <span className="pg-hint">
              {method === "vcycle"
                ? `V-cycle ${stateRef.current.vcycleCount}`
                : `iteration ${stateRef.current.jacobiCount}`}
            </span>
          </div>
        </div>
        <div className="ctrl">
          <label>Method</label>
          <div className="seg fix">
            {(["jacobi", "vcycle"] as Method[]).map((m_) => (
              <button key={m_} className={method === m_ ? "on" : ""} onClick={() => handleMethod(m_)}>
                {m_ === "jacobi" ? "Jacobi only" : "V-cycle multigrid"}
              </button>
            ))}
          </div>
          <div className="fixhint">
            {method === "jacobi"
              ? "Pure Jacobi iteration on the finest grid — watch it stall on low-frequency error"
              : "Multigrid V-cycle: restrict low-freq error to coarser grids where it damps quickly"}
          </div>
        </div>
        <div className="ctrl">
          <label>
            Grid levels <b>{levels}</b>
          </label>
          <div className="seg fix">
            {[2, 3, 4].map((v) => (
              <button key={v} className={levels === v ? "on" : ""} onClick={() => handleLevels(v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="fixhint">
            {levels === 2
              ? "64 → 33 cells"
              : levels === 3
                ? "64 → 33 → 17 cells"
                : "64 → 33 → 17 → 9 cells"}
          </div>
        </div>
        <div className="ctrl">
          <label>
            Smoother steps <b>{smoothSteps}</b>
          </label>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={smoothSteps}
            onChange={(e) => handleSmooth(+e.target.value)}
          />
          <div className="fixhint">
            Pre/post-smoothing Jacobi iterations per level (more = fewer V-cycles needed, but more work per cycle)
          </div>
        </div>
        <div className="ctrl">
          <label>Parallel model</label>
          <div className="seg">
            {(["serial", "openmp", "mpi", "gpu"] as Model[]).map((k) => (
              <button key={k} className={model === k ? "on" : ""} onClick={() => setModel(k)}>
                {MODELS[k].label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card vizwrap">
        <h2>
          <span>
            Multigrid V-cycle · {N_FINE} cells · {levels} levels
          </span>
          <span className="scene-tag">
            {method === "vcycle" ? "-u″ = f (V-cycle)" : "-u″ = f (Jacobi)"}
          </span>
        </h2>
        <canvas className="viz lab-canvas" ref={canvasRef} />
      </section>

      <section className="card explain">
        <h2>
          <span>Multigrid in {m.label}</span>
          <span className="scene-tag">pick a model →</span>
        </h2>
        <p className="learn-blurb">
          <Glossed>
            {
              "The 1-D Poisson equation -u″ = f is discretised as (u[i-1] - 2u[i] + u[i+1]) / h² = f[i]. Jacobi iteration updates each point from its two neighbours. The V-cycle nests Jacobi smoothing inside a recursive hierarchy of coarser grids: smooth, restrict the residual, recurse, prolongate the correction, smooth again."
            }
          </Glossed>
        </p>
        <div className="code">
          {m.code.split("\n").map((ln, i) => (
            <div className="ln" key={i}>
              {ln || " "}
            </div>
          ))}
        </div>
        <div className="eb how" style={{ marginTop: 12 }}>
          <div className="t">{m.t}</div>
          <div className="body">
            <Glossed>{m.note}</Glossed>
          </div>
        </div>
        <div className="ref-related" style={{ marginTop: 10 }}>
          {m.links.map((l) => (
            <Link key={l.href} className="learn-link" style={{ marginTop: 0 }} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="eb how" style={{ marginTop: 16 }}>
          <div className="t" style={{ color: "#ff5d73" }}>Why Jacobi stalls</div>
          <div className="body">
            <Glossed>
              {
                "Jacobi smoothing reduces the i-th frequency component by a factor of cos(iπ/N). Low frequencies (small i) have damping factors near 1 — they barely change. After a few iterations, only the slow-to-decay low-frequency error remains."
              }
            </Glossed>
          </div>
        </div>
        <div className="eb how" style={{ marginTop: 8 }}>
          <div className="t" style={{ color: "#3ddc97" }}>Why multigrid works</div>
          <div className="body">
            <Glossed>
              {
                "On a grid with half the points, frequency i on the fine grid maps to frequency i on the coarse grid — but now it’s a higher relative frequency and damps quickly. The V-cycle exploits this: each level efficiently kills the error frequencies that are high-frequency at its scale."
              }
            </Glossed>
          </div>
        </div>
        <div className="eb how" style={{ marginTop: 8 }}>
          <div className="t" style={{ color: "#ffb454" }}>Complexity</div>
          <div className="body">
            <Glossed>
              {
                "One V-cycle costs O(N) work (geometric sum: N + N/2 + N/4 + … = 2N). Reaching discretisation-level accuracy takes O(1) V-cycles — total cost O(N). Jacobi alone needs O(N) iterations of O(N) work each = O(N²)."
              }
            </Glossed>
          </div>
        </div>
        <div className="ref-related" style={{ marginTop: 10 }}>
          <Link className="learn-link" style={{ marginTop: 0 }} href="/labs/heat">
            Heat Lab — watch Jacobi stall on fine grids →
          </Link>
        </div>
      </section>
    </div>
  );
}
