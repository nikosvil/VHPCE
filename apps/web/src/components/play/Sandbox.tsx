"use client";

// Amdahl & Gustafson sandbox — pure-client, no gateway needed.
// Drag the serial-fraction slider; the chart and metrics update instantly.

import { useState } from "react";

// ── Math helpers ──────────────────────────────────────────────────────────────
const amdahl    = (s: number, p: number): number => s > 0 ? 1 / (s + (1 - s) / p) : p;
const gustafson = (s: number, p: number): number => p * (1 - s) + s;

function niceStep(max: number): number {
  const raw = max / 5;
  const exp = Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const frac = raw / Math.pow(10, exp);
  const nice = frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

function fmt1(v: number): string {
  if (!isFinite(v)) return "∞";
  return v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

type Mode = "amdahl" | "gustafson" | "both";
const MAX_P_OPTS = [8, 24, 64, 256] as const;

// ── SVG chart ─────────────────────────────────────────────────────────────────
function SandboxChart({ serial, maxP, mode }: { serial: number; maxP: number; mode: Mode }) {
  const W = 500, H = 230;
  const ml = 44, mr = 14, mt = 14, mb = 28;
  const pw = W - ml - mr, ph = H - mt - mb;
  const logMax = Math.log(maxP);

  // X: log-linear  Y: linear
  const tx = (p: number) => ml + (Math.log(Math.max(p, 1)) / logMax) * pw;
  const ty = (y: number) => mt + (1 - Math.min(y, yMax * 1.01) / yMax) * ph;

  // Y axis ceiling
  const aMax = serial > 0 ? 1 / serial : maxP;
  const gMax = maxP * (1 - serial) + serial;

  let yMax: number;
  if (mode === "gustafson") yMax = gMax * 1.08;
  else if (mode === "both") yMax = Math.min(Math.max(aMax * 1.5, 4), maxP);
  else yMax = Math.min(aMax * 1.15, maxP * 1.06);

  // 100-point smooth curves in log space
  const curve = (fn: (p: number) => number) =>
    Array.from({ length: 100 }, (_, i) => {
      const p = Math.exp((logMax * i) / 99);
      return { x: p, y: fn(p) };
    });

  const aPts = curve((p) => amdahl(serial, p));
  const gPts = curve((p) => gustafson(serial, p));

  const toSVGPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(" ");

  // Ideal line (y=p), clipped to chart top
  const idealTop = Math.min(maxP, yMax);
  const idealPath = `M${tx(1).toFixed(1)},${ty(1).toFixed(1)} L${tx(idealTop).toFixed(1)},${ty(idealTop).toFixed(1)}`;

  // X ticks: powers of 2
  const xTicks: number[] = [];
  for (let p = 1; p <= maxP; p *= 2) xTicks.push(p);
  if (xTicks[xTicks.length - 1] < maxP) xTicks.push(maxP);

  // Y ticks
  const step = niceStep(yMax);
  const yTicks: number[] = [];
  for (let y = step; y < yMax * 0.99; y += step) yTicks.push(y);

  // Amdahl asymptote (only if it fits inside the chart)
  const showAsymp = serial > 0 && aMax < yMax * 0.97 && (mode === "amdahl" || mode === "both");

  const cy = mt + ph / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      {/* X grid */}
      {xTicks.map((x) => (
        <line key={`gx${x}`} x1={tx(x)} y1={mt} x2={tx(x)} y2={mt + ph}
              stroke="var(--line)" strokeWidth={0.5} />
      ))}
      {/* Y grid */}
      {yTicks.map((y) => (
        <line key={`gy${y}`} x1={ml} y1={ty(y)} x2={ml + pw} y2={ty(y)}
              stroke="var(--line)" strokeWidth={0.5} />
      ))}

      {/* Ideal (dashed) */}
      <path d={idealPath} stroke="var(--dim)" strokeWidth={1} strokeDasharray="4 3" fill="none" />

      {/* Amdahl asymptote */}
      {showAsymp && (
        <>
          <line x1={ml} y1={ty(aMax)} x2={ml + pw} y2={ty(aMax)}
                stroke="var(--warn)" strokeWidth={1} strokeDasharray="3 5" opacity={0.6} />
          <text x={ml + 6} y={ty(aMax) - 4} fontSize={9} fill="var(--warn)" opacity={0.9}>
            ceiling = {fmt1(aMax)}×
          </text>
        </>
      )}

      {/* Curves */}
      {(mode === "amdahl" || mode === "both") && (
        <path d={toSVGPath(aPts)} stroke="var(--accent)" strokeWidth={2.2}
              fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {(mode === "gustafson" || mode === "both") && (
        <path d={toSVGPath(gPts)} stroke="var(--accent2)" strokeWidth={2.2}
              fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* X labels */}
      {xTicks.map((x) => (
        <text key={`tx${x}`} x={tx(x)} y={H - 5} textAnchor="middle"
              fontSize={9} fill="var(--dim)">{x}</text>
      ))}

      {/* Y labels */}
      {yTicks.map((y) => (
        <text key={`ty${y}`} x={ml - 4} y={ty(y) + 3.5} textAnchor="end"
              fontSize={9} fill="var(--dim)">{y}×</text>
      ))}

      {/* Axis titles */}
      <text x={ml + pw / 2} y={H} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
        Threads (log scale)
      </text>
      <text transform={`translate(${ml / 2 - 2},${cy}) rotate(-90)`}
            textAnchor="middle" fontSize={9.5} fill="var(--muted)">
        Speedup
      </text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Sandbox() {
  const [serial, setSerial] = useState(0.20);
  const [maxP,   setMaxP]   = useState(24);
  const [mode,   setMode]   = useState<Mode>("amdahl");

  const aMax       = serial > 0 ? 1 / serial : Infinity;
  const spAmdahl   = amdahl(serial, maxP);
  const spGust     = gustafson(serial, maxP);
  const effAmdahl  = spAmdahl / maxP;

  // Threads needed to reach 90% of Amdahl ceiling:  n = 9*(1-s)/s
  const nFor90 = serial > 0 ? Math.ceil(9 * (1 - serial) / serial) : Infinity;

  function summaryText(): string {
    if (serial === 0)
      return "Zero serial code — every thread does only useful work. Speedup equals core count: doubling cores halves the runtime forever. Real programs always have some serial fraction, but this is the target.";
    if (serial >= 0.5)
      return "More than half the program is serial. The ceiling is ≤ 2× no matter how many cores you throw at it. More hardware cannot fix a serial bottleneck — you must parallelize the code first.";
    if (aMax < 4)
      return `With ${(serial*100).toFixed(0)}% serial code the ceiling is only ${fmt1(aMax)}×. Adding a hundred more cores won't help. This is a code problem, not a hardware problem.`;
    if (nFor90 <= maxP)
      return `You need ${nFor90} threads to reach 90% of the ${fmt1(aMax)}× ceiling — achievable on your ${maxP}-core system. You're spending hardware budget well.`;
    return `The ${fmt1(aMax)}× ceiling is attractive, but you'd need ${fmt1(nFor90)} threads to reach 90% of it. On ${maxP} cores you realise ${fmt1(spAmdahl)}× (${(effAmdahl*100).toFixed(0)}% of ceiling). Reducing the serial fraction from ${(serial*100).toFixed(0)}% to even ${(serial*50).toFixed(1)}% would double the ceiling.`;
  }

  const MODES: { id: Mode; label: string }[] = [
    { id: "amdahl",    label: "Amdahl" },
    { id: "gustafson", label: "Gustafson" },
    { id: "both",      label: "Both" },
  ];

  const sColor = serial > 0.2 ? "var(--bad)" : serial > 0.05 ? "var(--warn)" : "var(--good)";

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <section className="card">
        <h2><span>Amdahl &amp; Gustafson — interactive sandbox</span></h2>
        <p className="learn-blurb" style={{ margin: "0 0 14px" }}>
          Set the serial fraction and watch the theoretical speedup ceiling update. Switch to Gustafson&apos;s law to see how <em>scaling the problem</em> with the hardware changes the picture entirely.
        </p>

        {/* ── Controls ── */}
        <div className="sbox-controls">
          {/* Serial fraction slider */}
          <div className="sbox-slider-block">
            <div className="sbox-slider-label">
              <span>Serial fraction</span>
              <b style={{ color: sColor, fontFamily: "var(--mono)", fontSize: 16 }}>
                {serial === 0 ? "0%" : serial < 0.01 ? `${(serial * 100).toFixed(1)}%` : `${(serial * 100).toFixed(0)}%`}
              </b>
            </div>
            <input type="range" min={0} max={1} step={0.01}
                   value={serial}
                   onChange={(e) => setSerial(parseFloat(e.target.value))} />
            <div className="sbox-slider-ends">
              <span>0% — perfect scaling</span><span>100% — fully serial</span>
            </div>
          </div>

          <div className="sbox-row2">
            {/* Thread count presets */}
            <div className="sbox-group">
              <span className="sbox-group-label">Show up to</span>
              <div className="seg fix">
                {MAX_P_OPTS.map((p) => (
                  <button key={p} className={maxP === p ? "on" : ""} onClick={() => setMaxP(p)}>
                    {p}t
                  </button>
                ))}
              </div>
            </div>
            {/* Law selector */}
            <div className="sbox-group">
              <span className="sbox-group-label">Law</span>
              <div className="seg">
                {MODES.map((m) => (
                  <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Chart + legend ── */}
        <div style={{ marginTop: 14 }}>
          <div className="sbox-chart">
            <SandboxChart serial={serial} maxP={maxP} mode={mode} />
          </div>
          <div className="sbox-legend">
            {(mode === "amdahl" || mode === "both") && (
              <span><span className="sbox-dot" style={{ background: "var(--accent)" }} />Amdahl&apos;s law (fixed work)</span>
            )}
            {(mode === "gustafson" || mode === "both") && (
              <span><span className="sbox-dot" style={{ background: "var(--accent2)" }} />Gustafson&apos;s law (scaled work)</span>
            )}
            <span><span className="sbox-dot" style={{ background: "var(--dim)" }} />ideal (linear)</span>
            {serial > 0 && (mode === "amdahl" || mode === "both") && (
              <span><span className="sbox-dot" style={{ background: "var(--warn)" }} />ceiling (1/s)</span>
            )}
          </div>
        </div>

        {/* ── Metrics ── */}
        <div style={{ marginTop: 12 }}>
          {(mode === "amdahl" || mode === "both") && (
            <>
              <div className="metric">
                <span className="k">Amdahl ceiling — 1 ∕ s</span>
                <span className={"v " + (!isFinite(aMax) || aMax > 12 ? "good" : aMax > 4 ? "warn" : "bad")}>
                  {!isFinite(aMax) ? "∞ (perfect)" : `${fmt1(aMax)}×`}
                </span>
              </div>
              <div className="metric">
                <span className="k">Speedup at {maxP} threads (Amdahl)</span>
                <span className={"v " + (effAmdahl > 0.7 ? "good" : effAmdahl > 0.4 ? "warn" : "bad")}>
                  {fmt1(spAmdahl)}× · {(effAmdahl * 100).toFixed(0)}% efficiency
                </span>
              </div>
              {serial > 0 && (
                <div className="metric">
                  <span className="k">Threads to reach 90% of ceiling</span>
                  <span className="v accent">
                    {nFor90 > 999999 ? "millions" : nFor90 > 9999 ? `~${(nFor90 / 1000).toFixed(0)} k` : `${nFor90}`}
                  </span>
                </div>
              )}
            </>
          )}
          {(mode === "gustafson" || mode === "both") && (
            <div className="metric">
              <span className="k">Speedup at {maxP} threads (Gustafson)</span>
              <span className="v" style={{ color: "var(--accent2)" }}>{fmt1(spGust)}×</span>
            </div>
          )}
        </div>

        {/* ── Plain-English explanation ── */}
        <div className="eb what" style={{ marginTop: 14 }}>
          <div className="t">
            {mode === "gustafson" ? "Gustafson's view" : mode === "both" ? "The key difference" : "What this means"}
          </div>
          <div className="body">
            {mode === "gustafson"
              ? <>Gustafson&apos;s law says: if you scale the problem size with the hardware (more threads → bigger dataset, same wall time), speedup grows near-linearly regardless of the serial fraction. It doesn&apos;t contradict Amdahl — they answer different questions. Amdahl: <em>&ldquo;how much faster for the same work?&rdquo;</em> Gustafson: <em>&ldquo;how much more work in the same time?&rdquo;</em></>
              : mode === "both"
              ? <>The gap between the curves is the scalability premium from growing the problem with hardware. When work is fixed (Amdahl), the serial fraction is an iron ceiling. When the problem scales (Gustafson), even significant serial fractions allow near-linear throughput growth — which is why clusters with thousands of nodes are useful in practice.</>
              : summaryText()
            }
          </div>
        </div>
      </section>
    </div>
  );
}
