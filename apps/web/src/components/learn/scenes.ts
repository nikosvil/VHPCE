// Canvas2D teaching animations for the beginner "/learn" section. These are NOT the
// ProfileResult scenes from @vhpce/viz — they're conceptual "how it works" animations with
// their own state (current step, thread/rank count, mode). Each draws one frame; the Learn
// component owns the rAF loop + step timeline. Literal hex (canvas ignores CSS var()).

export type LearnState = {
  step: number;        // current phase in the concept's step list
  threads: number;     // OpenMP threads / MPI ranks for the active scene
  mode: string;        // shared | private | reduction
  collective: string;  // broadcast | scatter | gather | reduce
};

export type LearnScene = (ctx: CanvasRenderingContext2D, w: number, h: number, now: number, st: LearnState) => void;

const C = {
  accent: "#4cc9f0", accent2: "#b388ff", good: "#3ddc97", warn: "#ffb454", bad: "#ff5d73",
  text: "#e6edf3", muted: "#8a9bb4", dim: "#5e6e88", line: "#1d2838", panel: "#0c1320", ink: "#0a0f18",
};

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, label?: string, glow = 0) {
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  rr(ctx, x, y, w, h, 8); ctx.fillStyle = C.ink; ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  if (label) { ctx.fillStyle = color; ctx.font = "600 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + w / 2, y + h / 2); }
  ctx.restore();
}
function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 2) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1), s = 6;
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - s * Math.cos(a - 0.4), y2 - s * Math.sin(a - 0.4));
  ctx.lineTo(x2 - s * Math.cos(a + 0.4), y2 - s * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}
function caption(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, color = C.muted) {
  ctx.fillStyle = color; ctx.font = "600 12.5px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText(text, w / 2, h - 14);
}
const laneXs = (n: number, w: number, pad: number) =>
  Array.from({ length: n }, (_, i) => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1)));

/* ============================ OpenMP: fork–join ============================ */
const forkJoin: LearnScene = (ctx, w, h, now, st) => {
  const n = Math.min(st.threads, 8);
  const xFork = w * 0.32, xJoin = w * 0.68, cyMid = h * 0.46;
  const phase = st.step; // 0 serial-before, 1 fork, 2 parallel, 3 join
  const laneYs = Array.from({ length: n }, (_, i) => (n === 1 ? cyMid : 70 + (i * (h - 150)) / (n - 1)));

  // master line in (left) and out (right)
  ctx.strokeStyle = phase >= 0 ? C.accent : C.dim; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(20, cyMid); ctx.lineTo(xFork, cyMid); ctx.stroke();
  box(ctx, 8, cyMid - 12, 30, 24, C.accent, "M");

  // fork: branch to N lanes
  for (let i = 0; i < n; i++) {
    const active = phase >= 1;
    ctx.strokeStyle = active ? (phase === 2 ? C.good : C.accent) : C.dim;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xFork, cyMid); ctx.lineTo(xFork + 18, laneYs[i]); ctx.lineTo(xJoin - 18, laneYs[i]); ctx.stroke();
    if (phase >= 1) box(ctx, xFork + 18, laneYs[i] - 10, 26, 20, phase === 2 ? C.good : C.accent, "T" + i, phase === 2 ? 10 : 0);
    // converge to join
    ctx.strokeStyle = phase >= 3 ? C.accent : C.dim;
    ctx.beginPath(); ctx.moveTo(xJoin - 18, laneYs[i]); ctx.lineTo(xJoin, cyMid); ctx.stroke();
  }
  // master out
  ctx.strokeStyle = phase >= 3 ? C.accent : C.dim; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(xJoin, cyMid); ctx.lineTo(w - 40, cyMid); ctx.stroke();
  box(ctx, w - 38, cyMid - 12, 30, 24, phase >= 3 ? C.accent : C.dim, "M");

  // moving "now" dots in the parallel region
  if (phase === 2) {
    for (let i = 0; i < n; i++) {
      const ph = (now / 1100 + i * 0.13) % 1;
      const px = xFork + 18 + ph * (xJoin - 18 - (xFork + 18));
      ctx.fillStyle = C.good; ctx.beginPath(); ctx.arc(px, laneYs[i], 3.5, 0, 7); ctx.fill();
    }
  }
  ctx.fillStyle = C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
  ctx.fillText("fork", xFork, 24); ctx.fillText("join", xJoin, 24);
};

/* ========================= OpenMP: parallel for ========================= */
const parallelFor: LearnScene = (ctx, w, h, now, st) => {
  const T = Math.min(st.threads, 6), N = 12;
  const pad = 24, top = 34, tileW = (w - 2 * pad) / N, tileH = 26;
  // iteration tiles (top row), colored by owning thread (contiguous chunks)
  const colors = [C.accent, C.good, C.accent2, C.warn, "#5ad1e6", "#9b7bff"];
  const owner = (i: number) => Math.floor(i / Math.ceil(N / T));
  const reveal = Math.min(N, Math.floor((now / 130) % (N + 8)));
  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(`for (i = 0; i < ${N}; i++)  →  ${T} thread${T > 1 ? "s" : ""}`, pad, top - 10);
  for (let i = 0; i < N; i++) {
    const o = Math.min(owner(i), T - 1);
    const lit = i < reveal;
    rr(ctx, pad + i * tileW + 2, top, tileW - 4, tileH, 5);
    ctx.fillStyle = lit ? colors[o % colors.length] : "#101a28"; ctx.globalAlpha = lit ? 0.85 : 1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = lit ? "#04121a" : C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i), pad + i * tileW + tileW / 2, top + tileH / 2);
  }
  ctx.textBaseline = "alphabetic";
  // thread lanes
  const laneTop = top + tileH + 22, laneH = 20, gap = 8;
  for (let tIdx = 0; tIdx < T; tIdx++) {
    const y = laneTop + tIdx * (laneH + gap);
    ctx.fillStyle = colors[tIdx % colors.length]; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText("T" + tIdx, pad + 22, y + laneH / 2);
    const mine = Array.from({ length: N }, (_, i) => i).filter((i) => Math.min(owner(i), T - 1) === tIdx);
    const bw = (w - 2 * pad - 30) ;
    rr(ctx, pad + 30, y, bw, laneH, 5); ctx.fillStyle = "#0a0f18"; ctx.fill();
    const frac = mine.length / N;
    rr(ctx, pad + 30, y, bw * frac, laneH, 5); ctx.fillStyle = colors[tIdx % colors.length]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.muted; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left";
    ctx.fillText(mine.length + " iters", pad + 36, y + laneH / 2);
  }
  ctx.textBaseline = "alphabetic";
  // wall-time comparison
  const wy = laneTop + T * (laneH + gap) + 14;
  const serialUnit = (w - 2 * pad - 90) / N;
  ctx.fillStyle = C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left";
  ctx.fillText("serial", pad, wy + 9);
  rr(ctx, pad + 50, wy, serialUnit * N, 12, 4); ctx.fillStyle = C.bad; ctx.globalAlpha = .6; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = C.dim; ctx.fillText(`${T} thr`, pad, wy + 27);
  const par = Math.ceil(N / T);
  rr(ctx, pad + 50, wy + 18, serialUnit * par, 12, 4); ctx.fillStyle = C.good; ctx.globalAlpha = .7; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = C.good; ctx.textAlign = "left"; ctx.fillText(`~${(N / par).toFixed(1)}× faster`, pad + 56 + serialUnit * par, wy + 28);
};

/* ===================== OpenMP: shared vs private ===================== */
const sharedPrivate: LearnScene = (ctx, w, h, now, st) => {
  const n = 4, mode = st.mode || "shared";
  const pad = 30, top = 50, tw = 52, th = 30;
  const xs = laneXs(n, w, pad + 40);
  // thread boxes
  for (let i = 0; i < n; i++) box(ctx, xs[i] - tw / 2, top, tw, th, C.accent, "T" + i);
  const memY = h - 92;
  if (mode === "shared") {
    const mx = w / 2 - 50, clash = Math.sin(now / 220) > 0;
    box(ctx, mx, memY, 100, 36, clash ? C.bad : C.muted, "sum", clash ? 14 : 0);
    for (let i = 0; i < n; i++) arrow(ctx, xs[i], top + th, w / 2, memY, i % 2 ? C.bad : C.warn, 1.5);
    ctx.fillStyle = C.bad; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("⚡ all threads write the SAME variable → data race", w / 2, memY - 12);
  } else if (mode === "private") {
    for (let i = 0; i < n; i++) { box(ctx, xs[i] - 26, memY, 52, 32, C.good, "s" + i); arrow(ctx, xs[i], top + th, xs[i], memY, C.good, 1.5); }
    ctx.fillStyle = C.good; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("each thread owns a PRIVATE partial — no sharing", w / 2, memY - 12);
  } else { // reduction
    for (let i = 0; i < n; i++) { box(ctx, xs[i] - 22, top + th + 16, 44, 26, C.good, "s" + i); arrow(ctx, xs[i], top + th, xs[i], top + th + 16, C.good, 1.5); }
    const fx = w / 2 - 50;
    box(ctx, fx, memY, 100, 36, C.accent2, "Σ sum", 8);
    for (let i = 0; i < n; i++) { const sy = top + th + 16 + 26; arrow(ctx, xs[i], sy, w / 2, memY, C.accent2, 1.5); }
    ctx.fillStyle = C.good; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("private partials COMBINED once at the end (+)", w / 2, memY - 12);
  }
};

/* ===================== MPI: ranks & separate memory ===================== */
const ranksMemory: LearnScene = (ctx, w, h, now, st) => {
  const n = Math.min(st.threads, 6);
  const pad = 24, bw = Math.min(120, (w - 2 * pad) / n - 12), bh = 96, top = h * 0.30;
  const xs = laneXs(n, w, pad + bw / 2);
  for (let i = 0; i < n; i++) {
    const x = xs[i] - bw / 2;
    rr(ctx, x, top, bw, bh, 10); ctx.fillStyle = "#0b1119"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent2; ctx.stroke();
    ctx.fillStyle = C.accent2; ctx.font = "600 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("rank " + i, xs[i], top + 18);
    // private memory cell
    box(ctx, xs[i] - 34, top + 32, 68, 34, C.accent, "x=" + (i * 10), Math.sin(now / 500 + i) > 0.9 ? 8 : 0);
    ctx.fillStyle = C.dim; ctx.font = "9px ui-monospace, monospace"; ctx.fillText("own memory", xs[i], top + bh - 8);
  }
  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`size = ${n}  ·  each rank is a separate process`, w / 2, top - 16);
  caption(ctx, w, h, "No shared memory — ranks cooperate only by passing messages.", C.accent2);
};

/* ========================= MPI: send / recv ========================= */
const sendRecv: LearnScene = (ctx, w, h, now, st) => {
  const phase = st.step; // 0 before, 1 in-flight, 2 delivered
  const cy = h * 0.42, bw = 120, bh = 80;
  const x0 = w * 0.18, x1 = w * 0.82;
  const drawRank = (cx: number, r: number, val: string | null) => {
    rr(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 10); ctx.fillStyle = "#0b1119"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent2; ctx.stroke();
    ctx.fillStyle = C.accent2; ctx.font = "600 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("rank " + r, cx, cy - bh / 2 + 18);
    box(ctx, cx - 30, cy - 6, 60, 30, val ? C.accent : C.dim, val ?? "—");
  };
  const delivered = phase >= 2;
  drawRank(x0, 0, "42");
  drawRank(x1, 1, delivered ? "42" : null);
  // message packet
  if (phase === 1) {
    const ph = (now / 1400) % 1;
    const px = x0 + bw / 2 + ph * (x1 - bw / 2 - (x0 + bw / 2));
    ctx.strokeStyle = C.warn; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0 + bw / 2, cy); ctx.lineTo(x1 - bw / 2, cy); ctx.stroke(); ctx.setLineDash([]);
    box(ctx, px - 16, cy - 13, 32, 26, C.warn, "42", 12);
  } else if (phase >= 2) {
    arrow(ctx, x0 + bw / 2, cy, x1 - bw / 2, cy, C.good, 2);
  }
  ctx.fillStyle = C.muted; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
  ctx.fillText("MPI_Send →", (x0 + x1) / 2, cy - 26); ctx.fillText("← MPI_Recv", (x0 + x1) / 2, cy + 40);
};

/* ========================= MPI: collectives ========================= */
const collectives: LearnScene = (ctx, w, h, now, st) => {
  const op = st.collective || "broadcast", n = 4;
  const rootX = w * 0.5, rootY = 46, bw = 56, bh = 30;
  const xs = laneXs(n, w, 60), ranksY = h * 0.62;
  const ph = (now / 1500) % 1;
  // root
  box(ctx, rootX - 46, rootY, 92, 34, C.accent2, op === "gather" || op === "reduce" ? "root" : "root", 6);
  // ranks
  for (let i = 0; i < n; i++) box(ctx, xs[i] - bw / 2, ranksY, bw, bh, C.accent, "r" + i);

  const flyDown = (frac: number, i: number, label: string, col: string) => {
    const x = rootX + (xs[i] - rootX) * frac, y = (rootY + 34) + (ranksY - rootY - 34) * frac;
    box(ctx, x - 14, y - 12, 28, 24, col, label, 10);
  };
  const flyUp = (frac: number, i: number, label: string, col: string) => {
    const x = xs[i] + (rootX - xs[i]) * frac, y = (ranksY) - (ranksY - rootY - 34) * frac;
    box(ctx, x - 14, y - 12, 28, 24, col, label, 10);
  };

  if (op === "broadcast") {
    for (let i = 0; i < n; i++) { arrow(ctx, rootX, rootY + 34, xs[i], ranksY, C.dim, 1); flyDown(ph, i, "v", C.good); }
    caption(ctx, w, h, "Broadcast: root sends the SAME value to every rank.", C.good);
  } else if (op === "scatter") {
    for (let i = 0; i < n; i++) { arrow(ctx, rootX, rootY + 34, xs[i], ranksY, C.dim, 1); flyDown(ph, i, String.fromCharCode(97 + i), C.warn); }
    caption(ctx, w, h, "Scatter: root splits an array — one chunk per rank.", C.warn);
  } else if (op === "gather") {
    for (let i = 0; i < n; i++) { arrow(ctx, xs[i], ranksY, rootX, rootY + 34, C.dim, 1); flyUp(ph, i, String.fromCharCode(97 + i), C.warn); }
    caption(ctx, w, h, "Gather: each rank's piece is collected into root.", C.warn);
  } else { // reduce
    for (let i = 0; i < n; i++) { arrow(ctx, xs[i], ranksY, rootX, rootY + 34, C.dim, 1); flyUp(ph, i, String(i + 1), C.good); }
    ctx.fillStyle = C.accent2; ctx.font = "600 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Σ=10", rootX, rootY + 17);
    caption(ctx, w, h, "Reduce: combine all ranks' values into one (e.g. sum) at root.", C.good);
  }
};

export const learnScenes: Record<string, LearnScene> = {
  forkJoin, parallelFor, sharedPrivate, ranksMemory, sendRecv, collectives,
};
