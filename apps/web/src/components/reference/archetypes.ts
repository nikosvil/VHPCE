// Reusable "smart" Canvas2D animations for the /reference command library. Every directive/
// command entry maps to ONE archetype + params, so a small set of animations covers a large
// surface and new entries are pure data. Each draws one looping frame (phase from `now`);
// Reference.tsx owns the rAF loop. Literal hex (canvas ignores CSS var()). Self-contained
// helpers so /learn stays untouched.

export type ArchetypeParams = { threads?: number; kind?: string; op?: string; mode?: string; clause?: string; level?: string };
export type Archetype = (ctx: CanvasRenderingContext2D, w: number, h: number, now: number, p: ArchetypeParams) => void;

const C = {
  accent: "#4cc9f0", accent2: "#b388ff", good: "#3ddc97", warn: "#ffb454", bad: "#ff5d73",
  text: "#e6edf3", muted: "#8a9bb4", dim: "#5e6e88", ink: "#0a0f18", line: "#1d2838",
};
const TCOL = ["#4cc9f0", "#3ddc97", "#b388ff", "#ffb454", "#5ad1e6", "#9b7bff", "#36d39a", "#ffc978"];

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, label?: string, glow = 0) {
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  rr(ctx, x, y, w, h, 7); ctx.fillStyle = C.ink; ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  if (label) { ctx.fillStyle = color; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + w / 2, y + h / 2); }
  ctx.restore();
}
function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1.5) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1), s = 6;
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - s * Math.cos(a - 0.4), y2 - s * Math.sin(a - 0.4));
  ctx.lineTo(x2 - s * Math.cos(a + 0.4), y2 - s * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}
function caption(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, color = C.muted) {
  ctx.fillStyle = color; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.fillText(text, w / 2, h - 12);
}
const lanes = (n: number, lo: number, hi: number) =>
  Array.from({ length: n }, (_, i) => (n === 1 ? (lo + hi) / 2 : lo + (i * (hi - lo)) / (n - 1)));

/* ============================ OpenMP ============================ */

const forkJoin: Archetype = (ctx, w, h, now, p) => {
  const n = Math.min(p.threads ?? 6, 8);
  const xF = w * 0.3, xJ = w * 0.7, cy = h * 0.46;
  const ys = lanes(n, 64, h - 70);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(18, cy); ctx.lineTo(xF, cy); ctx.stroke();
  box(ctx, 6, cy - 12, 28, 24, C.accent, "M");
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = C.good; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xF, cy); ctx.lineTo(xF + 16, ys[i]); ctx.lineTo(xJ - 16, ys[i]); ctx.lineTo(xJ, cy); ctx.stroke();
    box(ctx, xF + 16, ys[i] - 9, 24, 18, C.good, "T" + i, 6);
    const ph = (now / 1100 + i * 0.13) % 1;
    const px = (xF + 16) + ph * (xJ - 16 - (xF + 16));
    ctx.fillStyle = C.good; ctx.beginPath(); ctx.arc(px, ys[i], 3, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = C.accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(xJ, cy); ctx.lineTo(w - 36, cy); ctx.stroke();
  box(ctx, w - 36, cy - 12, 28, 24, C.accent, "M");
  ctx.fillStyle = C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
  ctx.fillText("fork", xF, 26); ctx.fillText("join", xJ, 26);
  caption(ctx, w, h, "one master thread forks a team, runs in parallel, then joins", C.good);
};

const worksharing: Archetype = (ctx, w, h, now, p) => {
  const kind = p.kind ?? "for", T = Math.min(p.threads ?? 4, 6), pad = 26, top = 30;
  if (kind === "single" || kind === "master") {
    const ys = lanes(T, top + 10, h - 60);
    for (let i = 0; i < T; i++) {
      const doer = kind === "master" ? 0 : 1;
      const active = i === doer;
      box(ctx, pad, ys[i] - 12, 30, 22, active ? C.good : C.dim, "T" + i);
      rr(ctx, pad + 44, ys[i] - 11, w - pad - (pad + 44), 20, 5);
      ctx.fillStyle = active ? "rgba(61,220,151,.25)" : "rgba(40,52,74,.25)"; ctx.fill();
      ctx.strokeStyle = active ? C.good : C.line; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = active ? C.good : C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(active ? "runs the block" : "skips / waits", pad + 52, ys[i]); ctx.textBaseline = "alphabetic";
    }
    caption(ctx, w, h, kind === "master" ? "only the master thread runs the block" : "exactly one thread runs the block; others skip", C.good);
    return;
  }
  if (kind === "sections") {
    const secs = ["A", "B", "C"], sw = (w - pad * 2 - 16) / secs.length;
    for (let i = 0; i < secs.length; i++) {
      const x = pad + i * (sw + 8);
      box(ctx, x, top + 16, sw, 46, TCOL[i % TCOL.length], "section " + secs[i], 6);
      ctx.fillStyle = C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText("→ T" + i, x + sw / 2, top + 16 + 64);
    }
    caption(ctx, w, h, "each section runs once, on a different thread", C.accent);
    return;
  }
  // for (default): iteration tiles dealt to threads in chunks
  const N = 12, tileW = (w - pad * 2) / N;
  const reveal = Math.floor((now / 120) % (N + 6));
  for (let i = 0; i < N; i++) {
    const o = Math.min(Math.floor(i / Math.ceil(N / T)), T - 1);
    const lit = i < reveal;
    rr(ctx, pad + i * tileW + 2, top + 18, tileW - 4, 26, 5);
    ctx.fillStyle = lit ? TCOL[o % TCOL.length] : "#101a28"; ctx.globalAlpha = lit ? 0.85 : 1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = lit ? "#04121a" : C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i), pad + i * tileW + tileW / 2, top + 31); ctx.textBaseline = "alphabetic";
  }
  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`loop iterations split across ${T} threads`, w / 2, top + 8);
  caption(ctx, w, h, "the for-loop's iterations are divided among the team", C.accent);
};

const schedule: Archetype = (ctx, w, h, now, p) => {
  const kind = p.kind ?? "static", T = 4, N = 16, pad = 26, top = 40, tileW = (w - pad * 2) / N;
  // owner per schedule kind
  const owner = (i: number) => {
    if (kind === "static") return Math.floor(i / (N / T)) % T;
    if (kind === "guided") { // decreasing chunks
      const chunks = [6, 4, 3, 3]; let acc = 0; for (let c = 0; c < chunks.length; c++) { acc += chunks[c]; if (i < acc) return c % T; } return T - 1;
    }
    return Math.floor(i / 2) % T; // dynamic: small round-robin chunks
  };
  const reveal = Math.floor((now / 110) % (N + 6));
  for (let i = 0; i < N; i++) {
    const o = owner(i), lit = i < reveal;
    rr(ctx, pad + i * tileW + 1.5, top, tileW - 3, 26, 4);
    ctx.fillStyle = lit ? TCOL[o % TCOL.length] : "#101a28"; ctx.globalAlpha = lit ? 0.85 : 1; ctx.fill(); ctx.globalAlpha = 1;
  }
  const ly = top + 40; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  for (let t = 0; t < T; t++) { ctx.fillStyle = TCOL[t]; rr(ctx, pad + t * 84, ly, 12, 12, 3); ctx.fill(); ctx.fillStyle = C.muted; ctx.fillText("T" + t, pad + t * 84 + 18, ly + 6); }
  ctx.textBaseline = "alphabetic";
  const desc = kind === "static" ? "equal contiguous chunks, decided up front"
    : kind === "guided" ? "large chunks first, shrinking as work runs out"
    : "small chunks handed out on demand as threads finish";
  caption(ctx, w, h, `schedule(${kind}): ${desc}`, C.accent);
};

const barrier: Archetype = (ctx, w, h, now, p) => {
  const nowait = (p.kind ?? "barrier") === "nowait", T = 4, pad = 28, top = 30;
  const ys = lanes(T, top, h - 60), workEnd = [0.55, 0.8, 0.65, 1.0];
  const bx = pad + 30, x1 = w - pad, span = x1 - bx;
  const barX = bx + span * 0.82;
  const ph = (now / 2200) % 1;
  for (let i = 0; i < T; i++) {
    const y = ys[i];
    ctx.fillStyle = C.muted; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("T" + i, bx - 6, y);
    rr(ctx, bx, y - 9, span, 18, 5); ctx.fillStyle = "#0a0f18"; ctx.fill();
    const reach = bx + span * 0.82 * Math.min(1, ph / workEnd[i]);
    rr(ctx, bx, y - 9, Math.min(reach, barX) - bx, 18, 5); ctx.fillStyle = TCOL[i]; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
    if (!nowait && ph > workEnd[i]) { ctx.fillStyle = C.bad; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("wait", barX + 6, y); }
    if (nowait && ph > workEnd[i]) { const px = barX + (x1 - barX) * Math.min(1, (ph - workEnd[i]) / 0.3); ctx.fillStyle = TCOL[i]; ctx.beginPath(); ctx.arc(px, y, 3, 0, 7); ctx.fill(); }
  }
  ctx.textBaseline = "alphabetic";
  ctx.strokeStyle = nowait ? C.dim : C.warn; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(barX, top - 4); ctx.lineTo(barX, ys[T - 1] + 14); ctx.stroke(); ctx.setLineDash([]);
  caption(ctx, w, h, nowait ? "nowait: threads continue without waiting for the others" : "barrier: every thread waits for the slowest before continuing", nowait ? C.good : C.warn);
};

const criticalAtomic: Archetype = (ctx, w, h, now, p) => {
  const kind = p.kind ?? "critical", T = 4, pad = 30, top = 46;
  const xs = lanes(T, pad + 30, w - pad - 30), cellY = h - 96;
  const holder = Math.floor((now / 900) % T);
  box(ctx, w / 2 - 46, cellY, 92, 34, C.warn, "sum", 10);
  for (let i = 0; i < T; i++) {
    const active = i === holder;
    box(ctx, xs[i] - 16, top, 32, 22, active ? C.good : C.dim, "T" + i, active ? 8 : 0);
    if (active) arrow(ctx, xs[i], top + 22, w / 2, cellY, C.good, 2);
    else { ctx.strokeStyle = "rgba(138,155,180,.25)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xs[i], top + 22); ctx.lineTo(w / 2, cellY); ctx.stroke(); ctx.setLineDash([]); }
  }
  ctx.fillStyle = C.warn; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center";
  ctx.fillText("one at a time", w / 2, cellY - 10);
  const desc = kind === "atomic" ? "atomic: a single hardware-level update, one thread at a time"
    : kind === "lock" ? "locks: only the holder enters; others block until release"
    : "critical: the block runs mutually exclusive — one thread at a time";
  caption(ctx, w, h, desc, C.warn);
};

const reduction: Archetype = (ctx, w, h, now, p) => {
  const T = Math.min(p.threads ?? 4, 6), pad = 30, top = 40;
  const xs = lanes(T, pad + 24, w - pad - 24), partY = top + 24, sumY = h - 92;
  for (let i = 0; i < T; i++) {
    box(ctx, xs[i] - 22, partY, 44, 26, C.good, "s" + i);
    arrow(ctx, xs[i], partY + 26, w / 2, sumY, C.accent2, 1.5);
  }
  box(ctx, w / 2 - 46, sumY, 92, 34, C.accent2, "Σ result", 8);
  ctx.fillStyle = C.good; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("private partials", w / 2, partY - 8);
  caption(ctx, w, h, "each thread sums into a private partial; combined once at the end", C.good);
};

const dataSharing: Archetype = (ctx, w, h, now, p) => {
  const clause = p.clause ?? "shared", T = 4, pad = 30, top = 44;
  const xs = lanes(T, pad + 30, w - pad - 30), memY = h - 96;
  for (let i = 0; i < T; i++) box(ctx, xs[i] - 16, top, 32, 22, C.accent, "T" + i);
  if (clause === "shared") {
    box(ctx, w / 2 - 40, memY, 80, 34, C.warn, "x (shared)", 6);
    for (let i = 0; i < T; i++) arrow(ctx, xs[i], top + 22, w / 2, memY, C.warn, 1.3);
    caption(ctx, w, h, "shared: all threads see the SAME variable (guard writes!)", C.warn);
  } else {
    for (let i = 0; i < T; i++) { box(ctx, xs[i] - 22, memY, 44, 30, C.good, "x" + i); arrow(ctx, xs[i], top + 22, xs[i], memY, C.good, 1.3); }
    if (clause === "firstprivate") { box(ctx, w / 2 - 30, top - 4, 60, 18, C.accent2, "x₀"); for (let i = 0; i < T; i++) arrow(ctx, w / 2, top + 14, xs[i], memY - 2, "rgba(179,136,255,.4)", 1); }
    if (clause === "lastprivate") { box(ctx, w / 2 - 30, top - 4, 60, 18, C.accent2, "x ←last"); arrow(ctx, xs[T - 1], memY, w / 2, top + 14, C.accent2, 1.3); }
    const d = clause === "firstprivate" ? "firstprivate: private copies, each initialised from the original"
      : clause === "lastprivate" ? "lastprivate: private copies; the last iteration's value is copied out"
      : "private: each thread gets its own uninitialised copy";
    caption(ctx, w, h, d, C.good);
  }
};

const tasks: Archetype = (ctx, w, h, now, p) => {
  const T = Math.min(p.threads ?? 3, 4), pad = 26, top = 30, NT = 6;
  const done = Math.floor((now / 700) % (NT + 3));
  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillText("task queue", pad, top - 8);
  const qw = (w - pad * 2) / NT;
  for (let i = 0; i < NT; i++) {
    const taken = i < done;
    rr(ctx, pad + i * qw + 2, top, qw - 4, 26, 5);
    ctx.fillStyle = taken ? "#101a28" : "rgba(76,201,240,.2)"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = taken ? C.line : C.accent; ctx.stroke();
    ctx.fillStyle = taken ? C.dim : C.accent; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("t" + i, pad + i * qw + qw / 2, top + 13); ctx.textBaseline = "alphabetic";
  }
  const ys = lanes(T, top + 56, h - 56);
  for (let i = 0; i < T; i++) { box(ctx, pad, ys[i] - 11, 34, 22, TCOL[i], "T" + i); const busy = (done % T) === i || done < NT; if (busy) { ctx.fillStyle = C.good; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("running a task", pad + 42, ys[i] + 3); } }
  caption(ctx, w, h, "tasks go on a queue; idle threads pick them up (work-stealing)", C.accent);
};

/* ============================ MPI ============================ */

const ranksMemory: Archetype = (ctx, w, h, now, p) => {
  const n = Math.min(p.threads ?? 4, 6), split = p.kind === "split", pad = 24;
  const bw = Math.min(116, (w - pad * 2) / n - 12), bh = 92, top = h * 0.3;
  const xs = lanes(n, pad + bw / 2, w - pad - bw / 2);
  for (let i = 0; i < n; i++) {
    const col = split ? (i < Math.ceil(n / 2) ? C.accent : C.accent2) : C.accent2;
    rr(ctx, xs[i] - bw / 2, top, bw, bh, 9); ctx.fillStyle = "#0b1119"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("rank " + i, xs[i], top + 17);
    box(ctx, xs[i] - 30, top + 30, 60, 30, C.accent, "x=" + (i * 10), Math.sin(now / 500 + i) > 0.9 ? 6 : 0);
    ctx.fillStyle = C.dim; ctx.font = "9px ui-monospace, monospace"; ctx.fillText("own memory", xs[i], top + bh - 7);
  }
  caption(ctx, w, h, split ? "MPI_Comm_split: ranks partition into sub-communicators" : "each rank is a separate process with its OWN memory", split ? C.accent2 : C.accent2);
};

const pointToPoint: Archetype = (ctx, w, h, now, p) => {
  const nonblock = (p.mode ?? "blocking") === "nonblocking", cy = h * 0.42, bw = 116, bh = 74;
  const x0 = w * 0.2, x1 = w * 0.8, ph = (now / 1800) % 1;
  const drawRank = (cx: number, r: number, val: string | null) => {
    rr(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 9); ctx.fillStyle = "#0b1119"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent2; ctx.stroke();
    ctx.fillStyle = C.accent2; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText("rank " + r, cx, cy - bh / 2 + 16);
    box(ctx, cx - 28, cy - 4, 56, 28, val ? C.accent : C.dim, val ?? "—");
  };
  const arrived = ph > 0.75;
  drawRank(x0, 0, "42"); drawRank(x1, 1, arrived ? "42" : null);
  ctx.strokeStyle = C.warn; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0 + bw / 2, cy); ctx.lineTo(x1 - bw / 2, cy); ctx.stroke(); ctx.setLineDash([]);
  if (ph < 0.75) { const px = (x0 + bw / 2) + (ph / 0.75) * (x1 - bw / 2 - (x0 + bw / 2)); box(ctx, px - 15, cy - 12, 30, 24, C.warn, "42", 10); }
  if (nonblock) { // sender keeps computing (overlap)
    rr(ctx, x0 - bw / 2, cy + bh / 2 + 8, bw, 12, 4); ctx.fillStyle = C.good; ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.good; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("compute (overlaps)", x0, cy + bh / 2 + 32);
  }
  caption(ctx, w, h, nonblock ? "non-blocking: post Isend/Irecv, keep computing, then Wait" : "blocking: send, then the matching receive copies it across", nonblock ? C.good : C.warn);
};

const collective: Archetype = (ctx, w, h, now, p) => {
  const op = p.op ?? "bcast", n = 4, rootX = w * 0.5, rootY = 44, bw = 54, bh = 28;
  const xs = lanes(n, 64, w - 64), ranksY = h * 0.62, ph = (now / 1600) % 1;
  const hasRoot = op !== "barrier" && op !== "alltoall";
  if (hasRoot) box(ctx, rootX - 44, rootY, 88, 32, C.accent2, op === "reduce" || op === "allreduce" ? "Σ root" : "root", 6);
  for (let i = 0; i < n; i++) box(ctx, xs[i] - bw / 2, ranksY, bw, bh, C.accent, "r" + i);
  const fly = (frac: number, x: number, up: boolean, label: string, col: string) => {
    const y0 = rootY + 32, y1 = ranksY; const yy = up ? y1 - (y1 - y0) * frac : y0 + (y1 - y0) * frac;
    const xx = up ? x + (rootX - x) * frac : rootX + (x - rootX) * frac;
    box(ctx, xx - 13, yy - 11, 26, 22, col, label, 8);
  };
  let cap = "";
  if (op === "bcast") { for (let i = 0; i < n; i++) { arrow(ctx, rootX, rootY + 32, xs[i], ranksY, C.dim, 1); fly(ph, xs[i], false, "v", C.good); } cap = "Bcast: root sends the same value to all ranks"; }
  else if (op === "scatter") { for (let i = 0; i < n; i++) { arrow(ctx, rootX, rootY + 32, xs[i], ranksY, C.dim, 1); fly(ph, xs[i], false, String.fromCharCode(97 + i), C.warn); } cap = "Scatter: root splits an array, one chunk per rank"; }
  else if (op === "gather") { for (let i = 0; i < n; i++) { arrow(ctx, xs[i], ranksY, rootX, rootY + 32, C.dim, 1); fly(ph, xs[i], true, String.fromCharCode(97 + i), C.warn); } cap = "Gather: each rank's piece is collected at root"; }
  else if (op === "allgather") { for (let i = 0; i < n; i++) { arrow(ctx, xs[i], ranksY, rootX, rootY + 32, C.dim, 1); fly(ph, xs[i], true, String.fromCharCode(97 + i), C.accent); } cap = "Allgather: gather, then every rank gets the full result"; }
  else if (op === "reduce") { for (let i = 0; i < n; i++) { arrow(ctx, xs[i], ranksY, rootX, rootY + 32, C.dim, 1); fly(ph, xs[i], true, String(i + 1), C.good); } cap = "Reduce: combine all ranks' values (e.g. sum) at root"; }
  else if (op === "allreduce") { for (let i = 0; i < n; i++) { arrow(ctx, xs[i], ranksY, rootX, rootY + 32, C.dim, 1); fly(ph, xs[i], true, String(i + 1), C.accent); } cap = "Allreduce: reduce, then broadcast the result to all ranks"; }
  else if (op === "alltoall") {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { ctx.strokeStyle = "rgba(76,201,240,.18)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xs[i], ranksY); ctx.lineTo(xs[j], ranksY + (i < j ? -26 : 26)); ctx.stroke(); }
    const k = Math.floor(now / 500) % n; for (let j = 0; j < n; j++) if (j !== k) { const px = xs[k] + (xs[j] - xs[k]) * ph; box(ctx, px - 10, ranksY - 40, 20, 18, C.warn, "", 6); }
    cap = "Alltoall: every rank sends a distinct piece to every other rank";
  } else { // barrier
    ctx.strokeStyle = C.warn; ctx.setLineDash([4, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(64, ranksY - 40); ctx.lineTo(w - 64, ranksY - 40); ctx.stroke(); ctx.setLineDash([]);
    cap = "Barrier: no rank passes the line until all ranks reach it";
  }
  caption(ctx, w, h, cap, C.good);
};

/* ============================ OpenACC ============================ */

const offload: Archetype = (ctx, w, h, now, p) => {
  const kind = p.kind ?? "parallel";
  const hostX = w * 0.16, hbW = 116, bh = 150, cy = h * 0.42, top = cy - bh / 2;
  const devX = w * 0.6, dbW = Math.min(280, w * 0.36);
  // host
  rr(ctx, hostX - hbW / 2, top, hbW, bh, 10); ctx.fillStyle = "#0b1119"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent; ctx.stroke();
  ctx.fillStyle = C.accent; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText("Host (CPU)", hostX, top + 16);
  box(ctx, hostX - 24, cy - 11, 48, 22, C.accent, "main");
  // device
  rr(ctx, devX, top, dbW, bh, 10); ctx.fillStyle = "#0b1119"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.good; ctx.stroke();
  ctx.fillStyle = C.good; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("Device (GPU)", devX + dbW / 2, top + 16);
  const cols = 8, rows = 4, gx = devX + 14, gy = top + 28, cw = (dbW - 28) / cols, ch = (bh - 42) / rows;
  const compute = kind !== "routine" && kind !== "wait";
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; rr(ctx, gx + c * cw + 2, gy + r * ch + 2, cw - 4, ch - 4, 3);
    ctx.fillStyle = C.good; ctx.globalAlpha = compute ? 0.28 + 0.25 * Math.sin(now / 300 + i * 0.4) : 0.08; ctx.fill(); ctx.globalAlpha = 1;
  }
  arrow(ctx, hostX + hbW / 2, cy, devX, cy, C.warn, 2);
  const label = kind === "kernels" ? "kernels" : kind === "loop" ? "parallel loop" : kind === "routine" ? "routine" : kind === "wait" ? "wait" : "parallel";
  ctx.fillStyle = C.warn; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("#pragma acc " + label, (hostX + hbW / 2 + devX) / 2, cy - 10);
  const caps: Record<string, string> = {
    parallel: "acc parallel: you launch parallel work on the device (you control the levels)",
    kernels: "acc kernels: the compiler analyses the region and parallelizes loops for you",
    loop: "acc parallel loop: launch + distribute the loop's iterations across the device",
    routine: "acc routine: marks a function as callable from device code",
    wait: "acc wait: the host blocks until the async device work completes",
  };
  caption(ctx, w, h, caps[kind] ?? caps.parallel, C.good);
};

const accData: Archetype = (ctx, w, h, now, p) => {
  const clause = p.clause ?? "copy", hostX = w * 0.24, devX = w * 0.76, cy = h * 0.42, bw = 130, bh = 80;
  const node = (cx: number, label: string, col: string, cell: string) => {
    rr(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 9); ctx.fillStyle = "#0b1119"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "600 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText(label, cx, cy - bh / 2 + 16);
    box(ctx, cx - 30, cy - 6, 60, 30, col, cell);
  };
  node(hostX, "Host", C.accent, "a[…]");
  node(devX, "Device", C.good, clause === "create" ? "a[?]" : "a[…]");
  const ph = (now / 1500) % 1;
  const inDir = clause === "copyin" || clause === "copy" || clause === "update";
  const outDir = clause === "copyout" || clause === "copy";
  if (clause === "present") { ctx.fillStyle = C.good; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("already on device — no transfer", w / 2, cy - bh / 2 - 18); }
  else if (clause === "create") { ctx.fillStyle = C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("allocated on device — no transfer", w / 2, cy - bh / 2 - 18); }
  if (inDir) { const y = cy - bh / 2 - 6; arrow(ctx, hostX + bw / 2, y, devX - bw / 2, y, C.warn, 1.5); const x = hostX + bw / 2 + ph * (devX - bw / 2 - (hostX + bw / 2)); box(ctx, x - 12, y - 22, 24, 18, C.warn, "a", 8); }
  if (outDir) { const y = cy + bh / 2 + 6; arrow(ctx, devX - bw / 2, y, hostX + bw / 2, y, C.accent2, 1.5); const x = (devX - bw / 2) + ph * ((hostX + bw / 2) - (devX - bw / 2)); box(ctx, x - 12, y + 4, 24, 18, C.accent2, "a", 8); }
  const caps: Record<string, string> = {
    copyin: "copyin: host → device on entry (input data)",
    copyout: "copyout: device → host on exit (results)",
    copy: "copy: copied in on entry, out on exit",
    create: "create: allocate on the device, no transfer",
    present: "present: data is already on the device — reuse it (no copy)",
    update: "update: explicitly re-sync the host/device copies mid-region",
  };
  caption(ctx, w, h, caps[clause] ?? caps.copy, C.warn);
};

const gangs: Archetype = (ctx, w, h, now, p) => {
  const level = p.level ?? "gang", NG = 3, pad = 24, top = 40, gw = (w - pad * 2 - (NG - 1) * 14) / NG, gh = h - 108;
  for (let g = 0; g < NG; g++) {
    const gx = pad + g * (gw + 14);
    rr(ctx, gx, top, gw, gh, 8); ctx.fillStyle = "#0b1119"; ctx.fill();
    ctx.lineWidth = level === "gang" ? 2 : 1; ctx.strokeStyle = level === "gang" ? C.good : C.line; ctx.stroke();
    ctx.fillStyle = level === "gang" ? C.good : C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText("gang " + g, gx + gw / 2, top + 14);
    const NW = 2;
    for (let wk = 0; wk < NW; wk++) {
      const wh2 = (gh - 30) / NW - 8, wy = top + 22 + wk * ((gh - 30) / NW), wx = gx + 8, ww = gw - 16;
      rr(ctx, wx, wy, ww, wh2, 6); ctx.fillStyle = "#0a0f18"; ctx.fill();
      ctx.lineWidth = level === "worker" ? 2 : 1; ctx.strokeStyle = level === "worker" ? C.warn : "#1c2940"; ctx.stroke();
      ctx.fillStyle = level === "worker" ? C.warn : C.dim; ctx.font = "9px ui-monospace, monospace"; ctx.fillText("worker", wx + ww / 2, wy + 12);
      const NL = 6;
      for (let l = 0; l < NL; l++) {
        const lw = (ww - 16) / NL, lx = wx + 8 + l * lw, ly = wy + wh2 - 14;
        rr(ctx, lx + 1, ly, lw - 3, 8, 2);
        ctx.fillStyle = level === "vector" ? C.accent : C.dim;
        ctx.globalAlpha = level === "vector" ? 0.4 + 0.4 * Math.sin(now / 250 + l + g + wk) : 0.18; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }
  const caps: Record<string, string> = {
    gang: "gang: coarse parallel blocks (like CUDA thread blocks) — independent",
    worker: "worker: a group of threads within a gang",
    vector: "vector: SIMD lanes within a worker — the innermost, finest level",
  };
  caption(ctx, w, h, caps[level] ?? caps.gang, level === "gang" ? C.good : level === "worker" ? C.warn : C.accent);
};

export const archetypes: Record<string, Archetype> = {
  forkJoin, worksharing, schedule, barrier, criticalAtomic, reduction, dataSharing, tasks,
  ranksMemory, pointToPoint, collective, offload, accData, gangs,
};
