/**
 * @vhpce/viz — framework-agnostic draw functions. D3 chart renderers operate on an
 * <svg> element; Canvas "scenes" draw one animation frame into a 2D context. React
 * components own the refs + rAF loop and call these. (Three.js hero scenes land next.)
 */
import * as d3 from "d3";
import { type ExperimentResult, type SweepPoint, fmt } from "@vhpce/profile-schema";

export const C = {
  accent: "#4cc9f0", accent2: "#b388ff", good: "#3ddc97",
  warn: "#ffb454", bad: "#ff5d73", muted: "#8a9bb4", dim: "#5e6e88",
};
const SYNC_F: Record<string, number> = { reduction: 0.01, atomic: 0.08, critical: 0.3 };
const BW_FALLBACK = 40;
const P_PEAK = 200;
const MAXP = 24;

/* =============================== D3 charts =============================== */
export function drawScaling(svgEl: SVGSVGElement, res: ExperimentResult): void {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const W = svgEl.clientWidth || 560, H = svgEl.clientHeight || 260, m = { t: 14, r: 44, b: 34, l: 38 };
  const x = d3.scaleLinear().domain([1, MAXP]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, MAXP]).range([H - m.b, m.t]);
  const ye = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  svg.append("g").selectAll("line").data(y.ticks(6)).join("line")
    .attr("class", "grid-line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("line").attr("x1", x(1)).attr("y1", y(1)).attr("x2", x(MAXP)).attr("y2", y(MAXP))
    .attr("stroke", "#33405a").attr("stroke-width", 2).attr("stroke-dasharray", "5 5");
  const sw = res.sweep;
  const lineSp = d3.line<{ x: number; speedup: number }>().x((d) => x(d.x)).y((d) => y(d.speedup)).curve(d3.curveMonotoneX);
  const lineEf = d3.line<{ x: number; efficiency: number }>().x((d) => x(d.x)).y((d) => ye(d.efficiency)).curve(d3.curveMonotoneX);
  svg.append("path").datum(sw).attr("fill", "none").attr("stroke", C.accent2).attr("stroke-width", 1.5).attr("opacity", 0.7).attr("d", lineEf as any);
  svg.append("path").datum(sw).attr("fill", "none").attr("stroke", C.accent).attr("stroke-width", 2.5).attr("d", lineSp as any);
  const cur = res.current;
  svg.append("line").attr("x1", x(cur.x)).attr("x2", x(cur.x)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "#2a3850").attr("stroke-dasharray", "3 3");
  svg.append("circle").attr("cx", x(cur.x)).attr("cy", y(cur.speedup)).attr("r", 5).attr("fill", C.accent).attr("stroke", "#04121a").attr("stroke-width", 2);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")) as any);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5) as any);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${W - m.r},0)`).call(d3.axisRight(ye).ticks(4).tickFormat(d3.format(".0%")) as any);
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 2).attr("fill", C.dim).attr("font-size", 10).attr("text-anchor", "middle").text(res.xUnits === "ranks" ? "ranks" : "threads");
}

export function drawRoofline(svgEl: SVGSVGElement, res: ExperimentResult): void {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const W = svgEl.clientWidth || 560, H = svgEl.clientHeight || 260, m = { t: 14, r: 16, b: 34, l: 46 };
  const BWp = res.peakBW || BW_FALLBACK, Pp = res.peakCompute || P_PEAK;
  const x = d3.scaleLog().domain([0.03, 100]).range([m.l, W - m.r]);
  const y = d3.scaleLog().domain([1, Pp * 1.2]).range([H - m.b, m.t]);
  svg.append("g").selectAll("line").data(x.ticks(6)).join("line").attr("class", "grid-line")
    .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", m.t).attr("y2", H - m.b);
  const ridge = Pp / BWp;
  const memLine: [number, number][] = [[0.03, 0.03 * BWp], [ridge, Pp]];
  const cmpLine: [number, number][] = [[ridge, Pp], [100, Pp]];
  const ln = d3.line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1]));
  svg.append("path").datum(memLine).attr("fill", "none").attr("stroke", C.bad).attr("stroke-width", 2).attr("d", ln as any);
  svg.append("path").datum(cmpLine).attr("fill", "none").attr("stroke", C.warn).attr("stroke-width", 2).attr("d", ln as any);
  const ai = res.params.ai, gf = res.gf || 1;
  svg.append("line").attr("x1", x(ai)).attr("x2", x(ai)).attr("y1", y(gf)).attr("y2", H - m.b).attr("stroke", "#2a3850").attr("stroke-dasharray", "3 3");
  svg.append("circle").attr("cx", x(ai)).attr("cy", y(gf)).attr("r", 6).attr("fill", C.accent).attr("stroke", "#04121a").attr("stroke-width", 2);
  svg.append("text").attr("x", x(ai) + 9).attr("y", y(gf) - 6).attr("fill", C.accent).attr("font-size", 11).attr("font-family", "ui-monospace, monospace").text(fmt(gf, 0) + " GF/s");
  svg.append("text").attr("x", x(ridge)).attr("y", m.t + 10).attr("fill", C.dim).attr("font-size", 10).attr("text-anchor", "middle").text("ridge");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5, "~g") as any);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4, "~g") as any);
  svg.append("text").attr("x", W / 2).attr("y", H - 4).attr("fill", C.dim).attr("font-size", 10).attr("text-anchor", "middle").text("arithmetic intensity (FLOP/byte)");
}

export function drawOccupancy(svgEl: SVGSVGElement, res: ExperimentResult): void {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const W = svgEl.clientWidth || 560, H = svgEl.clientHeight || 260, m = { t: 14, r: 16, b: 36, l: 44 };
  const sw = res.sweep;
  const x = d3.scaleLinear().domain([0, 1024]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "grid-line")
    .attr("x1", m.l).attr("x2", W - m.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  if (res.optimalBlock) {
    svg.append("line").attr("x1", x(res.optimalBlock)).attr("x2", x(res.optimalBlock)).attr("y1", m.t).attr("y2", H - m.b)
      .attr("stroke", C.good).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 4").attr("opacity", 0.5);
    svg.append("text").attr("x", x(res.optimalBlock)).attr("y", m.t + 9).attr("fill", C.good).attr("font-size", 9).attr("text-anchor", "middle").text("best");
  }
  const linePerf = d3.line<SweepPoint>().x((d) => x(d.x)).y((d) => y(d.speedup)).curve(d3.curveMonotoneX);
  svg.append("path").datum(sw).attr("fill", "none").attr("stroke", C.accent2).attr("stroke-width", 1.5).attr("opacity", 0.7).attr("d", linePerf as any);
  const lineOcc = d3.line<SweepPoint>().x((d) => x(d.x)).y((d) => y(d.occ ?? 0)).curve(d3.curveMonotoneX);
  svg.append("path").datum(sw).attr("fill", "none").attr("stroke", C.accent).attr("stroke-width", 2.5).attr("d", lineOcc as any);
  const cur = res.current;
  svg.append("line").attr("x1", x(cur.x)).attr("x2", x(cur.x)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", "#2a3850").attr("stroke-dasharray", "3 3");
  svg.append("circle").attr("cx", x(cur.x)).attr("cy", y(cur.occ ?? 0)).attr("r", 5).attr("fill", C.accent).attr("stroke", "#04121a").attr("stroke-width", 2);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues([128, 256, 384, 512, 640, 768, 896, 1024]).tickFormat(d3.format("d")) as any);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")) as any);
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 2).attr("fill", C.dim).attr("font-size", 10).attr("text-anchor", "middle").text("threads / block");
}

// Generic GPU sweep chart: efficiency (0..1) vs a log2 x-axis (stride, paths, …). Used by the
// coalescing and divergence experiments. x-label comes from res.xLabel.
export function drawSweep(svgEl: SVGSVGElement, res: ExperimentResult): void {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const W = svgEl.clientWidth || 560, H = svgEl.clientHeight || 260, m = { t: 14, r: 16, b: 40, l: 48 };
  const sw = res.sweep, xs = sw.map((s) => s.x);
  const x = d3.scaleLog().base(2).domain([Math.min(...xs), Math.max(...xs)]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "grid-line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  const line = d3.line<SweepPoint>().x((d) => x(d.x)).y((d) => y(d.efficiency)).curve(d3.curveMonotoneX);
  svg.append("path").datum(sw).attr("fill", "none").attr("stroke", C.accent).attr("stroke-width", 2.5).attr("d", line as any);
  svg.append("g").selectAll("circle").data(sw).join("circle").attr("cx", (d) => x(d.x)).attr("cy", (d) => y(d.efficiency)).attr("r", 3).attr("fill", C.accent2);
  const cur = res.current;
  svg.append("circle").attr("cx", x(cur.x)).attr("cy", y(cur.efficiency)).attr("r", 6).attr("fill", C.accent).attr("stroke", "#04121a").attr("stroke-width", 2);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(xs).tickFormat(d3.format("d")) as any);
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")) as any);
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 2).attr("fill", C.dim).attr("font-size", 10).attr("text-anchor", "middle").text(res.xLabel || "x");
}

/* =============================== Canvas scenes =============================== */
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
function chip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, color: string, glow: number) {
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  rr(ctx, x, y, w, h, 8);
  ctx.fillStyle = "#0c1320"; ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = color; ctx.font = "600 11px ui-monospace, monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

export type SceneFn = (ctx: CanvasRenderingContext2D, w: number, h: number, now: number, res: ExperimentResult) => void;

const falseSharing: SceneFn = (ctx, VW, VH, now, res) => {
  const p = res.params.threads, padded = res.params.padded;
  const n = Math.min(p, 16);
  const pad = 22, topY = pad, coreW = Math.min(64, (VW - pad * 2) / n - 8), coreH = 34, gap = (VW - pad * 2 - coreW * n) / (n - 1 || 1);
  for (let i = 0; i < n; i++) {
    const cx = pad + i * (coreW + gap);
    let active = false, col = "#33405a";
    if (!padded) { const owner = Math.floor(now / 360) % n; active = i === owner; col = active ? C.bad : "#33405a"; }
    else { col = C.good; active = Math.floor(now / 700) % n === i; }
    chip(ctx, cx, topY, coreW, coreH, "C" + i, col, active ? 16 : 0);
    ctx.strokeStyle = active ? col : "#16202f"; ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(cx + coreW / 2, topY + coreH); ctx.lineTo(cx + coreW / 2, topY + coreH + 26); ctx.stroke();
  }
  const lineY = topY + coreH + 30, lineH = 46;
  if (!padded) {
    const lw = VW - pad * 2; rr(ctx, pad, lineY, lw, lineH, 10); ctx.fillStyle = "#0a0f18"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.bad; ctx.shadowColor = C.bad; ctx.shadowBlur = 18; ctx.stroke(); ctx.shadowBlur = 0;
    const cellW = lw / n; const owner = Math.floor(now / 360) % n;
    for (let i = 0; i < n; i++) {
      const flash = i === owner ? 0.5 + 0.5 * Math.sin(now / 80) : 0.12;
      ctx.fillStyle = `rgba(255,93,115,${flash})`; rr(ctx, pad + i * cellW + 2, lineY + 6, cellW - 4, lineH - 12, 5); ctx.fill();
      ctx.fillStyle = "#9fb0c8"; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("c" + i, pad + i * cellW + cellW / 2, lineY + lineH / 2);
    }
    ctx.fillStyle = C.bad; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("ONE 64-byte cache line — invalidated on every write → ping-pongs across cores", VW / 2, lineY + lineH + 22);
    const my = lineY + lineH + 40;
    for (let k = 0; k < n; k++) { const ph = (now / 600 + k / n) % 1; const px = pad + ph * (VW - pad * 2); ctx.fillStyle = "rgba(255,93,115,.8)"; ctx.beginPath(); ctx.arc(px, my + 14, 3, 0, 7); ctx.fill(); }
    ctx.fillStyle = C.dim; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("coherence bus traffic ↑ with thread count", pad, my + 34);
  } else {
    const lw = (VW - pad * 2) / n;
    for (let i = 0; i < n; i++) {
      const lx = pad + i * lw + 3, w = lw - 6;
      rr(ctx, lx, lineY, w, lineH, 8); ctx.fillStyle = "#0a0f18"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = C.good; ctx.stroke();
      const pulse = 0.25 + 0.2 * Math.sin(now / 300 + i); ctx.fillStyle = `rgba(61,220,151,${pulse})`; rr(ctx, lx + 3, lineY + 6, w - 6, lineH - 12, 5); ctx.fill();
      ctx.fillStyle = "#9fb0c8"; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("c" + i, lx + w / 2, lineY + lineH / 2);
    }
    ctx.fillStyle = C.good; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Each counter on its OWN cache line — no cross-core invalidation", VW / 2, lineY + lineH + 22);
  }
};

const synchronization: SceneFn = (ctx, VW, VH, now, res) => {
  const p = res.params.threads, mode = res.params.mode, f = SYNC_F[mode] ?? 0.3;
  const n = Math.min(p, 16), pad = 20, top = 14, rowH = Math.min(26, (VH - 70) / n), gapY = 4;
  const T1 = 1000, parallel = (T1 * (1 - f)) / p, per = (T1 * f) / p, total = parallel + T1 * f;
  const x0 = pad + 34, x1 = VW - pad, scale = (x1 - x0) / total;
  const play = ((now / 2200) % 1) * total;
  for (let i = 0; i < n; i++) {
    const y = top + i * (rowH + gapY);
    ctx.fillStyle = "#7c8aa3"; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("T" + i, x0 - 6, y + rowH / 2);
    rr(ctx, x0, y, x1 - x0, rowH, 5); ctx.fillStyle = "#0a0f18"; ctx.fill();
    const cEnd = Math.min(play, parallel); if (cEnd > 0) { rr(ctx, x0, y, cEnd * scale, rowH, 5); ctx.fillStyle = "rgba(76,201,240,.85)"; ctx.fill(); }
    const critStart = parallel + i * per, critEnd = critStart + per;
    if (play > parallel) {
      const ws = parallel, we = Math.min(play, critStart);
      if (we > ws) {
        ctx.fillStyle = "rgba(120,140,170,.18)"; ctx.fillRect(x0 + ws * scale, y + 2, (we - ws) * scale, rowH - 4);
        ctx.strokeStyle = "rgba(138,155,180,.25)"; ctx.lineWidth = 1;
        for (let hx = ws; hx < we; hx += 8) { ctx.beginPath(); ctx.moveTo(x0 + hx * scale, y + 2); ctx.lineTo(x0 + hx * scale + 6, y + rowH - 2); ctx.stroke(); }
      }
    }
    if (play > critStart) { const ce = Math.min(play, critEnd); rr(ctx, x0 + critStart * scale, y, (ce - critStart) * scale, rowH, 4); ctx.fillStyle = mode === "reduction" ? "rgba(61,220,151,.9)" : "rgba(255,180,84,.95)"; ctx.fill(); }
  }
  ctx.strokeStyle = "rgba(230,237,243,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0 + play * scale, top - 2); ctx.lineTo(x0 + play * scale, top + n * (rowH + gapY)); ctx.stroke();
  const ly = top + n * (rowH + gapY) + 14; ctx.textAlign = "left"; ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = "rgba(76,201,240,.85)"; ctx.fillRect(x0, ly, 12, 8); ctx.fillStyle = C.muted; ctx.fillText("parallel compute", x0 + 16, ly + 8);
  ctx.fillStyle = "rgba(120,140,170,.4)"; ctx.fillRect(x0 + 130, ly, 12, 8); ctx.fillStyle = C.muted; ctx.fillText("waiting for lock", x0 + 146, ly + 8);
  ctx.fillStyle = mode === "reduction" ? "rgba(61,220,151,.9)" : "rgba(255,180,84,.95)"; ctx.fillRect(x0 + 260, ly, 12, 8); ctx.fillStyle = C.muted; ctx.fillText(mode === "reduction" ? "merge" : mode + " (serialized)", x0 + 276, ly + 8);
};

const bandwidth: SceneFn = (ctx, VW, VH, now, res) => {
  const p = res.params.threads, util = res.util || 0, n = Math.min(p, 16);
  const pad = 24, busY = VH * 0.46, busH = 46, x0 = pad + 70, x1 = VW - pad - 90, left = pad;
  for (let i = 0; i < n; i++) {
    const ty = 24 + i * ((VH - 90) / Math.max(1, n));
    chip(ctx, left, ty, 34, 16, "t" + i, util > 0.9 ? C.bad : C.accent, 0);
    ctx.strokeStyle = util > 0.92 ? "rgba(255,93,115,.5)" : "rgba(76,201,240,.45)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left + 34, ty + 8); ctx.lineTo(x0, busY + busH / 2); ctx.stroke();
  }
  rr(ctx, x0, busY, x1 - x0, busH, 12); ctx.fillStyle = "#0a0f18"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#22324a"; ctx.stroke();
  const fillW = (x1 - x0) * util; const col = util > 0.92 ? C.bad : util > 0.7 ? C.warn : C.good;
  rr(ctx, x0, busY, fillW, busH, 12); ctx.fillStyle = col; ctx.globalAlpha = 0.28; ctx.fill(); ctx.globalAlpha = 1;
  const speed = Math.min(util, 1); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([12, 14]); ctx.lineDashOffset = -((now * 0.06 * speed) % 26);
  ctx.beginPath(); ctx.moveTo(x0 + 6, busY + busH / 2); ctx.lineTo(x0 + Math.max(10, fillW - 6), busY + busH / 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.muted; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("DRAM bus capacity " + (res.peakBW ? fmt(res.peakBW, 0) : BW_FALLBACK) + " GB/s", x0, busY - 8);
  ctx.textAlign = "right"; ctx.fillStyle = col; ctx.font = "700 22px ui-monospace, monospace"; ctx.fillText(fmt(res.bw || 0, 1), x1 + 86, busY + 18);
  ctx.fillStyle = C.muted; ctx.font = "10px ui-monospace, monospace"; ctx.fillText("GB/s · " + fmt(util * 100, 0) + "%", x1 + 86, busY + 34);
  if (util > 0.9) { ctx.fillStyle = C.bad; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("BUS SATURATED — extra threads stall waiting for memory", VW / 2, busY + busH + 30); }
  else { ctx.fillStyle = C.good; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("bandwidth headroom remains", VW / 2, busY + busH + 30); }
};

const imbalance: SceneFn = (ctx, VW, VH, now, res) => {
  const p = res.params.threads, sched = res.params.sched;
  const n = Math.min(p, 16), pad = 20, top = 14, rowH = Math.min(26, (VH - 70) / n), gapY = 4, T1 = 1000;
  let work: number[];
  if (sched === "static") { const w = d3.range(n).map((t) => 2 * t + 1); const s = w.reduce((a, b) => a + b, 0); work = w.map((v) => (T1 * v) / s); }
  else { const jit = sched === "guided" ? 0.12 : 0.04, base = T1 / n; work = d3.range(n).map((t) => base * (1 + jit * Math.sin(t * 1.7))); }
  const wall = Math.max.apply(null, work);
  const x0 = pad + 34, x1 = VW - pad, scale = (x1 - x0) / wall;
  const play = ((now / 2200) % 1) * wall;
  for (let i = 0; i < n; i++) {
    const y = top + i * (rowH + gapY);
    ctx.fillStyle = "#7c8aa3"; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("T" + i, x0 - 6, y + rowH / 2);
    rr(ctx, x0, y, x1 - x0, rowH, 5); ctx.fillStyle = "#0a0f18"; ctx.fill();
    const busyEnd = Math.min(play, work[i]); if (busyEnd > 0) { rr(ctx, x0, y, busyEnd * scale, rowH, 5); ctx.fillStyle = "rgba(76,201,240,.85)"; ctx.fill(); }
    if (play > work[i]) {
      const ie = Math.min(play, wall); ctx.fillStyle = "rgba(255,93,115,.12)"; ctx.fillRect(x0 + work[i] * scale, y + 2, (ie - work[i]) * scale, rowH - 4);
      if (Math.sin(now / 200 + i) > 0) { ctx.fillStyle = "rgba(255,93,115,.5)"; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("idle", x0 + work[i] * scale + 5, y + rowH / 2); }
    }
  }
  ctx.strokeStyle = "rgba(255,180,84,.6)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0 + wall * scale, top - 2); ctx.lineTo(x0 + wall * scale, top + n * (rowH + gapY)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.warn; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("everyone waits for the slowest →", x0, top + n * (rowH + gapY) + 16);
  ctx.strokeStyle = "rgba(230,237,243,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0 + play * scale, top - 2); ctx.lineTo(x0 + play * scale, top + n * (rowH + gapY)); ctx.stroke();
};

const mpiHalo: SceneFn = (ctx, VW, VH, now, res) => {
  const p = (res.params.ranks ?? res.params.threads ?? 24) as number;
  const weak = res.params.mode === "weak";
  const commPct = res.idlePct ?? 0;
  const n = Math.min(p, 16);
  const pad = 34, cy = VH * 0.44;
  const rad = Math.max(8, Math.min(18, (VW - pad * 2) / (n * 2.4)));
  const xs = Array.from({ length: n }, (_, i) => (n === 1 ? VW / 2 : pad + (i * (VW - pad * 2)) / (n - 1)));
  const commCol = commPct > 40 ? C.bad : commPct > 15 ? C.warn : C.good;

  // title
  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`${n} ranks · 1-D domain · each trades boundary cells with 2 neighbours`, VW / 2, 22);

  // neighbour links + animated halo packets (both directions)
  for (let i = 0; i < n - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    ctx.strokeStyle = "#1c2940"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a + rad, cy); ctx.lineTo(b - rad, cy); ctx.stroke();
    const speed = 0.0009 * (1 + commPct / 25);
    for (let d = 0; d < 2; d++) {
      const base = (now * speed + i * 0.13 + d * 0.5) % 1;
      const px = d === 0 ? a + rad + base * (b - a - 2 * rad) : b - rad - base * (b - a - 2 * rad);
      ctx.fillStyle = commCol; ctx.shadowColor = commCol; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(px, cy, 3.2, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    }
  }
  // ring wrap-around link (last ↔ first), drawn as a faint arc over the top
  if (n > 2) {
    ctx.strokeStyle = "#16223a"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(xs[n - 1], cy - rad); ctx.quadraticCurveTo(VW / 2, cy - VH * 0.34, xs[0], cy - rad); ctx.stroke();
    ctx.setLineDash([]);
  }
  // rank nodes
  for (let i = 0; i < n; i++) {
    ctx.beginPath(); ctx.arc(xs[i], cy, rad, 0, 7);
    ctx.fillStyle = "#0c1320"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke();
    ctx.fillStyle = C.accent; ctx.font = "600 10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("r" + i, xs[i], cy);
  }
  ctx.textBaseline = "alphabetic";

  // comm-fraction bar
  const barY = cy + rad + 34, barW = VW - pad * 2, barH = 14;
  rr(ctx, pad, barY, barW, barH, 6); ctx.fillStyle = "#0a0f18"; ctx.fill();
  rr(ctx, pad, barY, barW * Math.min(1, commPct / 100), barH, 6); ctx.fillStyle = commCol; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = C.muted; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left";
  ctx.fillText(`communication ${fmt(commPct, 0)}% of runtime`, pad, barY - 6);

  ctx.fillStyle = commCol; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(
    weak
      ? "WEAK scaling — grid grows with ranks; per-rank work fixed, efficiency stays high"
      : "STRONG scaling — fixed grid; comm fraction grows with ranks → speedup saturates",
    VW / 2, barY + barH + 22,
  );
};

const cuda: SceneFn = (ctx, VW, VH, now, res) => {
  const occ = res.occupancy ?? res.current.efficiency ?? 0;
  const heavy = res.params.variant === "heavy";
  const maxWarps = 48;
  const activeWarps = Math.round(occ * maxWarps);
  const col = occ > 0.66 ? C.good : occ > 0.4 ? C.warn : C.bad;
  const limiter = res.limiter || "";

  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`one SM · ${maxWarps} warp slots · ${activeWarps} active (${Math.round(occ * 100)}% occupancy)`, VW / 2, 22);

  const cols = 8, rows = Math.ceil(maxWarps / cols), pad = 30, gridTop = 40, gap = 6;
  const cw = (VW - pad * 2 - (cols - 1) * gap) / cols;
  const ch = Math.min(26, cw * 0.62);
  for (let i = 0; i < maxWarps; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const cx = pad + c * (cw + gap), cy = gridTop + r * (ch + gap);
    rr(ctx, cx, cy, cw, ch, 4);
    if (i < activeWarps) {
      ctx.fillStyle = col; ctx.globalAlpha = 0.25 + 0.22 * Math.sin(now / 380 + i * 0.5); ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    } else {
      ctx.fillStyle = "#0a0f18"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#1c2940"; ctx.stroke();
      ctx.strokeStyle = "#26344a"; ctx.beginPath(); ctx.moveTo(cx + 4, cy + 4); ctx.lineTo(cx + cw - 4, cy + ch - 4); ctx.stroke();
    }
  }
  const by = gridTop + rows * (ch + gap) + 18;
  ctx.fillStyle = col; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(
    heavy ? `register pressure caps occupancy — limiter: ${limiter}` : "low register pressure — warps fill the SM",
    VW / 2, by,
  );
};

// Memory coalescing: a warp's 32 lanes pull from DRAM in 128-byte (32-element) cache lines.
// stride 1 → all 32 values sit in ONE line (1 transaction, 0% waste). stride S → the warp spans
// S lines, each only 1/S used — the dim slots are fetched-then-discarded bandwidth.
const coalesce: SceneFn = (ctx, VW, VH, now, res) => {
  const stride = Math.max(1, Math.round(res.current.x));
  const eff = res.current.efficiency ?? 1 / stride;
  const col = eff > 0.6 ? C.good : eff > 0.3 ? C.warn : C.bad;
  const WARP = 32, LINE = 32;
  const lines = Math.min(stride, 8), capped = stride > 8;
  const pad = 24;

  ctx.fillStyle = C.muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`one warp · 32 lanes · stride ${stride} → ${stride} cache-line transaction${stride > 1 ? "s" : ""} for the same 32 values`, VW / 2, 18);

  // warp lane strip
  const wy = 32, wh = 18, ww = VW - pad * 2, cw = ww / WARP;
  for (let t = 0; t < WARP; t++) {
    const x = pad + t * cw; rr(ctx, x + 1, wy, cw - 2, wh, 3);
    ctx.fillStyle = col; ctx.globalAlpha = 0.22 + 0.2 * Math.sin(now / 400 + t * 0.3); ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.stroke();
  }
  ctx.fillStyle = C.dim; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("warp lanes t0…t31", pad, wy - 4);

  // cache-line rows: a slot is bright if some lane reads it, dim (wasted) otherwise
  const top = wy + wh + 20, gap = 6, lh = Math.min(28, (VH - top - 34) / lines - gap), sw = ww / LINE;
  for (let l = 0; l < lines; l++) {
    const ly = top + l * (lh + gap);
    rr(ctx, pad, ly, ww, lh, 6); ctx.fillStyle = "#0a0f18"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#22324a"; ctx.stroke();
    for (let e = 0; e < LINE; e++) {
      const touched = ((l * LINE + e) % stride) === 0, sx = pad + e * sw;
      rr(ctx, sx + 1, ly + 3, sw - 2, lh - 6, 2);
      if (touched) { ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; }
      else { ctx.fillStyle = "#13202f"; ctx.fill(); }
    }
  }
  const by = top + lines * (lh + gap) + 4;
  ctx.fillStyle = col; ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(
    stride === 1 ? "coalesced — one transaction serves the whole warp · 0% wasted"
                 : `${Math.round((1 - eff) * 100)}% of every fetched cache line is discarded` + (capped ? `  (showing 8 of ${stride} lines)` : ""),
    VW / 2, by + 12,
  );
};

export const scenes: Record<string, SceneFn> = { falseSharing, synchronization, bandwidth, imbalance, mpiHalo, cuda, cudaCoalesce: coalesce };
