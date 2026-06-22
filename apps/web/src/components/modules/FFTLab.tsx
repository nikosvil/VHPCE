"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "../Glossed";

// Cooley-Tukey radix-2 DIT FFT
// N must be a power of 2.  log2(N) sequential stages, each with N/2 independent butterflies.
// Complexity: O(N log N) vs O(N^2) for the naive DFT.

type Signal = "single tone" | "two tones" | "square wave" | "impulse";
type Model = "serial" | "openmp" | "mpi" | "gpu";

const N_OPTIONS = [16, 32, 64, 128] as const;

function generateSignal(n: number, sig: Signal): number[] {
  const x: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    switch (sig) {
      case "single tone":
        x[i] = Math.sin(2 * Math.PI * 4 * t);
        break;
      case "two tones":
        x[i] = 0.7 * Math.sin(2 * Math.PI * 4 * t) + 0.5 * Math.sin(2 * Math.PI * 11 * t);
        break;
      case "square wave":
        x[i] = Math.sin(2 * Math.PI * 3 * t) >= 0 ? 1 : -1;
        break;
      case "impulse":
        x[i] = i === 0 ? 1 : 0;
        break;
    }
  }
  return x;
}

function computeFFT(x: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  const re = x.slice();
  const im = new Array(n).fill(0);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Cooley-Tukey stages
  for (let s = 1; s <= Math.log2(n); s++) {
    const m = 1 << s;
    const wmRe = Math.cos(-2 * Math.PI / m);
    const wmIm = Math.sin(-2 * Math.PI / m);
    for (let k = 0; k < n; k += m) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < m / 2; j++) {
        const tRe = wRe * re[k + j + m / 2] - wIm * im[k + j + m / 2];
        const tIm = wRe * im[k + j + m / 2] + wIm * re[k + j + m / 2];
        re[k + j + m / 2] = re[k + j] - tRe;
        im[k + j + m / 2] = im[k + j] - tIm;
        re[k + j] = re[k + j] + tRe;
        im[k + j] = im[k + j] + tIm;
        const newWRe = wRe * wmRe - wIm * wmIm;
        wIm = wRe * wmIm + wIm * wmRe;
        wRe = newWRe;
      }
    }
  }

  return { re, im };
}

function magnitude(re: number[], im: number[]): number[] {
  return re.map((r, i) => Math.sqrt(r * r + im[i] * im[i]));
}

type ModelEntry = {
  label: string;
  code: string;
  note: string;
  links: { href: string; label: string }[];
};

const MODELS: Record<Model, ModelEntry> = {
  serial: {
    label: "Serial",
    code: `// Cooley-Tukey radix-2 DIT
for (s = 1; s <= log2(N); s++) {
  m = 1 << s;
  wm = exp(-2*PI*I/m);
  for (k = 0; k < N; k += m) {
    w = 1;
    for (j = 0; j < m/2; j++) {
      t = w * X[k+j+m/2];
      X[k+j+m/2] = X[k+j] - t;
      X[k+j]     = X[k+j] + t;
      w *= wm;
    }
  }
}`,
    note: "Each of the log2(N) stages has N/2 independent butterfly operations — but the stages themselves are sequential: stage s+1 depends on stage s.",
    links: [],
  },
  openmp: {
    label: "OpenMP",
    code: `for (s = 1; s <= log2N; s++) {
  m = 1 << s;
  #pragma omp parallel for private(w, t, j)
  for (k = 0; k < N; k += m)
    for (j = 0; j < m/2; j++) {
      w = exp(-2*PI*I*j/m);
      t = w * X[k+j+m/2];
      X[k+j+m/2] = X[k+j] - t;
      X[k+j]     = X[k+j] + t;
    }
  /* implicit barrier between stages */
}`,
    note: "Within each stage, all N/2 butterfly pairs are independent — parallelize the inner loop. The implicit barrier at the end of each parallel region synchronizes before the next stage.",
    links: [
      { href: "/reference?id=omp_parallel_for", label: "omp parallel for" },
      { href: "/?exp=synchronization", label: "Synchronization experiment" },
    ],
  },
  mpi: {
    label: "MPI",
    code: `/* each rank owns N/nproc elements */
for (s = 1; s <= log2N; s++) {
  partner = myrank ^ (1 << (s-1));
  MPI_Sendrecv(local, cnt, MPI_C_FLOAT_COMPLEX,
               partner, 0, remote, cnt,
               MPI_C_FLOAT_COMPLEX, partner, 0,
               comm, &st);
  /* butterfly with local + remote data */
  for (j = 0; j < cnt; j++) { /* ... */ }
}`,
    note: "In distributed FFT, each stage pairs ranks whose indices differ by one bit — an XOR partner. Early stages communicate with distant ranks (all-to-all pattern); later stages are local. This is why FFT communication cost scales as O(N log N / P).",
    links: [
      { href: "/reference?id=mpi_sendrecv", label: "MPI_Sendrecv" },
      { href: "/?exp=mpiCollective", label: "MPI Collectives experiment" },
    ],
  },
  gpu: {
    label: "GPU",
    code: `__global__ void fft_stage(complex *X, int N,
                          int s) {
  int tid = blockIdx.x * blockDim.x + threadIdx.x;
  if (tid >= N/2) return;
  int m = 1 << s;
  int k = (tid / (m/2)) * m;
  int j = tid % (m/2);
  complex w = exp(-2*PI*I*j/m);
  complex t = w * X[k+j+m/2];
  X[k+j+m/2] = X[k+j] - t;
  X[k+j]     = X[k+j] + t;
}
// launch one kernel per stage
for (s = 1; s <= log2N; s++)
  fft_stage<<<N/512, 256>>>(d_X, N, s);`,
    note: "Each stage launches N/2 threads — one per butterfly. The kernel is memory-bound: two reads + two writes per thread, with stride-m access in early stages (poor coalescing) improving to stride-1 in later stages.",
    links: [
      { href: "/reference?id=cuda_kernel", label: "CUDA kernel launch" },
      { href: "/?exp=cudaCoalesce", label: "GPU Coalescing experiment" },
    ],
  },
};

export default function FFTLab() {
  const [nSize, setNSize] = useState<number>(64);
  const [signal, setSignal] = useState<Signal>("single tone");
  const [model, setModel] = useState<Model>("serial");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ nSize, signal, model });
  useEffect(() => { cfg.current = { nSize, signal, model }; });

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
      const { nSize: n, signal: sig } = cfg.current;

      const log2N = Math.log2(n);
      const totalStages = log2N;
      // Advance one stage per ~400ms, cycle through all stages
      const activeStage = Math.floor(elapsed / 400) % (totalStages + 1); // 0..log2N, wraps

      // Generate signal and compute FFT
      const x = generateSignal(n, sig);
      const fft = computeFFT(x.slice());
      const mag = magnitude(fft.re, fft.im);
      const maxMag = Math.max(...mag.slice(0, n / 2)) || 1;

      // Panel layout
      const pad = 12;
      const topH = (h - pad * 4) * 0.30;
      const midH = (h - pad * 4) * 0.40;
      const botH = (h - pad * 4) * 0.30;
      const topY = pad;
      const midY = topY + topH + pad;
      const botY = midY + midH + pad;
      const plotL = pad * 3;
      const plotR = w - pad;
      const plotW = plotR - plotL;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#070a10";
      ctx.fillRect(0, 0, w, h);

      // --- Top panel: time-domain signal ---
      ctx.fillStyle = "#1a2535";
      ctx.fillRect(plotL, topY, plotW, topH);

      // Grid lines
      ctx.strokeStyle = "#1a2535";
      ctx.lineWidth = 0.5;
      const midLine = topY + topH / 2;
      ctx.beginPath(); ctx.moveTo(plotL, midLine); ctx.lineTo(plotR, midLine); ctx.stroke();

      // Label
      ctx.fillStyle = "#8a9bb4";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("TIME DOMAIN  x[n]", plotL, topY - 3);

      // Signal line
      ctx.strokeStyle = "#4cc9f0";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const maxAbs = Math.max(...x.map(Math.abs)) || 1;
      for (let i = 0; i < n; i++) {
        const px = plotL + (i / (n - 1)) * plotW;
        const py = midLine - (x[i] / maxAbs) * (topH / 2 - 4);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Sample dots
      ctx.fillStyle = "#4cc9f0";
      for (let i = 0; i < n; i++) {
        const px = plotL + (i / (n - 1)) * plotW;
        const py = midLine - (x[i] / maxAbs) * (topH / 2 - 4);
        ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fill();
      }

      // --- Middle panel: butterfly diagram ---
      ctx.fillStyle = "#0c111c";
      ctx.fillRect(plotL, midY, plotW, midH);

      ctx.fillStyle = "#8a9bb4";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`BUTTERFLY DIAGRAM  ${Math.round(log2N)} stages, ${n / 2} butterflies/stage`, plotL, midY - 3);

      // Draw butterfly connections for each stage
      // Vertical element positions: distribute n elements evenly in midH
      const elemH = midH / (n + 1);
      const stageW = plotW / (totalStages + 1);

      // Draw element dots at each stage column
      for (let s = 0; s <= totalStages; s++) {
        const sx = plotL + (s + 0.5) * stageW;

        // Determine color based on animation state
        let dotColor: string;
        if (s < activeStage) dotColor = "rgba(61,220,151,0.5)"; // completed: dim green
        else if (s === activeStage && s < totalStages) dotColor = "#4cc9f0"; // active: cyan
        else dotColor = "rgba(26,37,53,0.8)"; // future: dark gray

        for (let i = 0; i < n; i++) {
          const ey = midY + (i + 1) * elemH;
          ctx.fillStyle = dotColor;
          ctx.beginPath(); ctx.arc(sx, ey, 2, 0, Math.PI * 2); ctx.fill();
        }

        // Draw butterfly connections for stage s (1-indexed: stages 1..log2N)
        if (s < totalStages) {
          const stageIdx = s + 1;
          const m = 1 << stageIdx;
          const halfM = m / 2;
          const x0 = plotL + (s + 0.5) * stageW;
          const x1 = plotL + (s + 1.5) * stageW;

          let lineColor: string;
          let lineAlpha: number;
          if (s < activeStage) { lineColor = "rgba(61,220,151,0.3)"; lineAlpha = 0.3; }
          else if (s === activeStage) { lineColor = "#4cc9f0"; lineAlpha = 0.8; }
          else { lineColor = "rgba(26,37,53,0.4)"; lineAlpha = 0.15; }

          ctx.strokeStyle = lineColor;
          ctx.lineWidth = s === activeStage ? 1.2 : 0.6;
          ctx.globalAlpha = s === activeStage ? 0.8 : lineAlpha;

          for (let k = 0; k < n; k += m) {
            for (let j = 0; j < halfM; j++) {
              const topIdx = k + j;
              const botIdx = k + j + halfM;
              const y0top = midY + (topIdx + 1) * elemH;
              const y0bot = midY + (botIdx + 1) * elemH;

              // Top element to top output (straight)
              ctx.beginPath(); ctx.moveTo(x0, y0top); ctx.lineTo(x1, y0top); ctx.stroke();
              // Bottom element to bottom output (straight)
              ctx.beginPath(); ctx.moveTo(x0, y0bot); ctx.lineTo(x1, y0bot); ctx.stroke();

              // Cross connections (twiddle factor): curved lines
              const cpx = (x0 + x1) / 2;

              // Top to bottom (butterfly cross)
              ctx.beginPath();
              ctx.moveTo(x0, y0top);
              ctx.quadraticCurveTo(cpx + stageW * 0.15, (y0top + y0bot) / 2, x1, y0bot);
              ctx.stroke();

              // Bottom to top (butterfly cross)
              ctx.beginPath();
              ctx.moveTo(x0, y0bot);
              ctx.quadraticCurveTo(cpx - stageW * 0.15, (y0top + y0bot) / 2, x1, y0top);
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      // Stage labels
      ctx.font = "500 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      for (let s = 0; s < totalStages; s++) {
        const sx = plotL + (s + 1) * stageW;
        ctx.fillStyle = s === activeStage ? "#4cc9f0" : "#5e6e88";
        ctx.fillText(`s${s + 1}`, sx, midY + midH + 10);
      }

      // --- Bottom panel: frequency-domain magnitude spectrum ---
      ctx.fillStyle = "#0c111c";
      ctx.fillRect(plotL, botY, plotW, botH);

      ctx.fillStyle = "#8a9bb4";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("FREQUENCY DOMAIN  |X[k]|", plotL, botY - 3);

      // Only show first N/2 bins (Nyquist)
      const nBins = n / 2;
      const barW = Math.max(1, plotW / nBins - 1);
      const barGap = plotW / nBins;
      for (let k = 0; k < nBins; k++) {
        const barH = (mag[k] / maxMag) * (botH - 8);
        const bx = plotL + k * barGap;
        const by = botY + botH - barH;

        // Color by magnitude: dim = low, bright cyan = high
        const intensity = mag[k] / maxMag;
        const r = Math.round(10 + 66 * intensity);
        const g = Math.round(30 + 171 * intensity);
        const b = Math.round(60 + 180 * intensity);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(bx, by, barW, barH);
      }

      // Baseline
      ctx.strokeStyle = "#1a2535";
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(plotL, botY + botH); ctx.lineTo(plotR, botY + botH); ctx.stroke();

      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const m = MODELS[model];
  const log2N = Math.log2(nSize);

  return (
    <>
      <div className="info" style={{ marginBottom: 16 }}>
        <Glossed>{"The Fast Fourier Transform decomposes a signal into its constituent frequencies in O(N log N) operations instead of the O(N²) required by the naive DFT. The Cooley-Tukey algorithm achieves this through log2(N) stages of butterfly operations — each stage combines pairs of elements using complex twiddle factors. FFT is one of the most important algorithms in scientific computing: it powers spectral methods, convolution, signal processing, and the multiplication step inside large-integer arithmetic."}</Glossed>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Controls</h2>
          <div className="ctrl">
            <label>Transform size N<b>{nSize}</b></label>
            <div className="seg fix">
              {N_OPTIONS.map((v) => (
                <button key={v} className={nSize === v ? "on" : ""} onClick={() => setNSize(v)}>{v}</button>
              ))}
            </div>
            <div className="fixhint">N must be a power of 2 for radix-2 Cooley-Tukey. Larger N = more stages, finer frequency resolution.</div>
          </div>
          <div className="ctrl">
            <label>Input signal</label>
            <div className="seg fix">
              {(["single tone", "two tones", "square wave", "impulse"] as Signal[]).map((s) => (
                <button key={s} className={signal === s ? "on" : ""} onClick={() => setSignal(s)}>{s}</button>
              ))}
            </div>
            <div className="fixhint">
              {signal === "single tone" && "Pure sine at bin 4 — one spike in the spectrum."}
              {signal === "two tones" && "Two sines at bins 4 and 11 — two spikes."}
              {signal === "square wave" && "Odd harmonics of a square wave — many spectral peaks."}
              {signal === "impulse" && "Delta function — flat (white) spectrum."}
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
          <div className="ctrl" style={{ marginTop: 8 }}>
            <div className="eb how">
              <div className="t">
                N = {nSize} → {Math.round(log2N)} stages × {nSize / 2} butterflies = {Math.round(log2N) * (nSize / 2)} ops
              </div>
              <div className="body" style={{ fontSize: 12, marginTop: 4 }}>
                DFT would need N² = {(nSize * nSize).toLocaleString()} ops — FFT is {(nSize / log2N).toFixed(1)}× faster
              </div>
            </div>
          </div>
        </section>

        <section className="card vizwrap">
          <h2>
            <span>FFT · N={nSize} · {signal}</span>
            <span className="scene-tag">{Math.round(log2N)} Cooley-Tukey stages</span>
          </h2>
          <canvas className="viz lab-canvas" ref={canvasRef} />
        </section>

        <section className="card explain">
          <h2>
            <span>FFT in {m.label}</span>
            <span className="scene-tag">pick a model →</span>
          </h2>
          <p className="learn-blurb">
            <Glossed>{"The Cooley-Tukey radix-2 decimation-in-time FFT splits the N-point DFT into two N/2-point DFTs recursively. The iterative form processes log2(N) stages: in stage s, elements separated by 2^(s-1) are combined with twiddle factors W_N^k = exp(-2πik/N). Within each stage the N/2 butterfly operations are independent — the parallelism target — but stage s+1 cannot begin until stage s finishes."}</Glossed>
          </p>
          <div className="code">
            {m.code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
          </div>
          <div className="eb how" style={{ marginTop: 12 }}>
            <div className="t">{m.label} approach</div>
            <div className="body"><Glossed>{m.note}</Glossed></div>
          </div>
          {m.links.length > 0 && (
            <div className="ref-related" style={{ marginTop: 10 }}>
              {m.links.map((l) => (
                <Link key={l.href} className="learn-link" style={{ marginTop: 0 }} href={l.href}>{l.label}</Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="info" style={{ marginTop: 16 }}>
        <div className="eb how">
          <div className="t">FFT parallelism summary</div>
          <div className="body">
            <Glossed>{"Complexity: O(N log N) vs O(N²) for the naive DFT — for N=1024 that is 10K vs 1M operations. Each of the log2(N) stages has N/2 independent butterfly operations, giving abundant intra-stage parallelism. MPI FFT requires log2(P) exchange rounds with XOR-paired ranks. GPU FFT launches one kernel per stage; early stages have strided memory access (poor coalescing) while later stages access contiguous elements."}</Glossed>
          </div>
        </div>
      </div>
    </>
  );
}
