"use client";

// Kernel Tuner game — tune GPU kernel parameters to beat the target throughput.
// Pure model, no backend required.

import { useState, useMemo } from "react";

// ── Model ─────────────────────────────────────────────────────────────────────
// A simplified GPU throughput model:
//   throughput = peak * occupancy(blockSize, regs) * coalesceFactor(stride) * simdFactor(vec)
// where:
//   occupancy = blockSize / (regs * warpSize * maxWarps) — register-limited occupancy [0..1]
//   coalesceFactor = 1 / stride  — L2 softens this but we use idealized here
//   simdFactor = vec == 4 ? 1.0 : vec == 2 ? 0.7 : 0.45  — vectorization gain
const PEAK_GFLOPS = 200;
const MAX_WARPS_PER_SM = 24;
const WARP_SIZE = 32;

function computeThroughput(blockSize: number, regsPerThread: number, stride: number, vec: number): number {
  const warpsPerBlock = blockSize / WARP_SIZE;
  const regsPerWarp = regsPerThread * WARP_SIZE;
  const maxBlocksFromRegs = Math.floor((65536 / regsPerWarp) / warpsPerBlock);
  const maxWarps = Math.min(MAX_WARPS_PER_SM, maxBlocksFromRegs * warpsPerBlock);
  const occupancy = maxWarps / MAX_WARPS_PER_SM;

  const coalesceFactor = stride === 1 ? 1.0 : stride === 2 ? 0.65 : stride <= 4 ? 0.4 : 0.2;
  const simdFactor = vec === 4 ? 1.0 : vec === 2 ? 0.75 : 0.5;
  const tiling = 1.0; // tiling handled separately below

  return PEAK_GFLOPS * occupancy * coalesceFactor * simdFactor * Math.min(1, occupancy + 0.2);
}

function computeOccupancy(blockSize: number, regsPerThread: number): number {
  const warpsPerBlock = blockSize / WARP_SIZE;
  const regsPerWarp = regsPerThread * WARP_SIZE;
  const maxBlocksFromRegs = Math.floor((65536 / regsPerWarp) / warpsPerBlock);
  const maxWarps = Math.min(MAX_WARPS_PER_SM, maxBlocksFromRegs * warpsPerBlock);
  return maxWarps / MAX_WARPS_PER_SM;
}

// ── Levels ────────────────────────────────────────────────────────────────────
const LEVELS: { name: string; target: number; hint: string }[] = [
  { name: "Beginner",      target: 60,  hint: "Start by increasing the block size above 128." },
  { name: "Intermediate",  target: 100, hint: "Reduce register pressure and enable vectorization." },
  { name: "Advanced",      target: 140, hint: "Combine large blocks, low registers, vec=4, stride=1." },
  { name: "Expert",        target: 160, hint: "Near-perfect occupancy + coalesced + max vec. Push to ≥160 GFLOPS." },
];

// ── Mini bar chart ────────────────────────────────────────────────────────────
function Bar({ val, max, col }: { val: number; max: number; col: string }) {
  const pct = Math.min(100, (val / max) * 100);
  return (
    <div style={{ background: "#0b111c", borderRadius: 4, height: 14, width: "100%", overflow: "hidden", border: "1px solid #15202f" }}>
      <div style={{ width: pct + "%", height: "100%", background: col, transition: "width .3s" }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function KernelTuner() {
  const [blockSize,     setBlockSize]     = useState(128);
  const [regsPerThread, setRegsPerThread] = useState(64);
  const [stride,        setStride]        = useState(4);
  const [vec,           setVec]           = useState(1);
  const [level,         setLevel]         = useState(0);
  const [bestScore,     setBestScore]     = useState(0);
  const [won,           setWon]           = useState(false);
  const [attempts,      setAttempts]      = useState(0);

  const lvl = LEVELS[level];
  const throughput = useMemo(
    () => computeThroughput(blockSize, regsPerThread, stride, vec),
    [blockSize, regsPerThread, stride, vec],
  );
  const occupancy = useMemo(
    () => computeOccupancy(blockSize, regsPerThread),
    [blockSize, regsPerThread],
  );
  const coalesceFactor = stride === 1 ? 1.0 : stride === 2 ? 0.65 : stride <= 4 ? 0.4 : 0.2;
  const simdFactor     = vec === 4 ? 1.0 : vec === 2 ? 0.75 : 0.5;

  const pct = (throughput / PEAK_GFLOPS) * 100;
  const targetPct = (lvl.target / PEAK_GFLOPS) * 100;
  const beats = throughput >= lvl.target;

  const toneOf = (v: number, good: number, ok: number) =>
    v >= good ? "var(--good)" : v >= ok ? "var(--warn)" : "var(--bad)";

  function handleApply() {
    setAttempts((a) => a + 1);
    if (throughput > bestScore) setBestScore(throughput);
    if (beats) setWon(true);
  }

  function nextLevel() {
    setWon(false);
    setAttempts(0);
    setBestScore(0);
    setLevel((l) => Math.min(l + 1, LEVELS.length - 1));
    setBlockSize(128); setRegsPerThread(64); setStride(4); setVec(1);
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 4px", color: "var(--fg)" }}>Kernel Tuner</h3>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Tune the GPU kernel parameters to beat the target throughput. Level: <b style={{ color: "var(--accent)" }}>{lvl.name}</b> — target <b style={{ color: "var(--accent2)" }}>{lvl.target} GFLOPS</b>.
        </p>
      </div>

      {/* Level tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {LEVELS.map((lv, i) => (
          <button
            key={i}
            onClick={() => { setLevel(i); setWon(false); setAttempts(0); setBestScore(0); setBlockSize(128); setRegsPerThread(64); setStride(4); setVec(1); }}
            style={{
              padding: "4px 10px", borderRadius: 6, border: "1px solid",
              borderColor: i === level ? "var(--accent)" : "#1c2940",
              background: i === level ? "rgba(76,201,240,.1)" : "transparent",
              color: i === level ? "var(--accent)" : "var(--muted)",
              cursor: "pointer", fontSize: 12,
            }}
          >{lv.name}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Controls */}
        <div>
          <div className="ctrl" style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Block size (threads)</span><b style={{ color: "var(--accent)" }}>{blockSize}</b>
            </label>
            <input type="range" min={32} max={1024} step={32} value={blockSize}
              onChange={(e) => setBlockSize(+e.target.value)} style={{ width: "100%" }} />
            <Bar val={blockSize} max={1024} col="var(--accent)" />
          </div>

          <div className="ctrl" style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Registers / thread</span><b style={{ color: toneOf(1/regsPerThread, 1/32, 1/48) }}>{regsPerThread}</b>
            </label>
            <input type="range" min={16} max={128} step={8} value={regsPerThread}
              onChange={(e) => setRegsPerThread(+e.target.value)} style={{ width: "100%" }} />
            <Bar val={129 - regsPerThread} max={113} col="var(--accent2)" />
          </div>

          <div className="ctrl" style={{ marginBottom: 14 }}>
            <label>Access stride</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {[1, 2, 4, 8].map((s) => (
                <button key={s}
                  onClick={() => setStride(s)}
                  style={{
                    padding: "3px 10px", borderRadius: 5, border: "1px solid",
                    borderColor: stride === s ? "var(--good)" : "#1c2940",
                    background: stride === s ? "rgba(61,220,151,.1)" : "transparent",
                    color: stride === s ? "var(--good)" : "var(--muted)",
                    cursor: "pointer", fontSize: 12,
                  }}>{s === 1 ? "1 ✓" : s}</button>
              ))}
            </div>
          </div>

          <div className="ctrl" style={{ marginBottom: 14 }}>
            <label>Vectorization</label>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {[1, 2, 4].map((v) => (
                <button key={v}
                  onClick={() => setVec(v)}
                  style={{
                    padding: "3px 10px", borderRadius: 5, border: "1px solid",
                    borderColor: vec === v ? "var(--accent2)" : "#1c2940",
                    background: vec === v ? "rgba(255,180,84,.1)" : "transparent",
                    color: vec === v ? "var(--accent2)" : "var(--muted)",
                    cursor: "pointer", fontSize: 12,
                  }}>{v === 1 ? "off" : "vec" + v}</button>
              ))}
            </div>
          </div>

          <button
            onClick={handleApply}
            style={{
              width: "100%", padding: "8px 0", borderRadius: 6, border: "none",
              background: beats ? "rgba(61,220,151,.15)" : "rgba(76,201,240,.1)",
              color: beats ? "var(--good)" : "var(--accent)",
              cursor: "pointer", fontWeight: 700, fontSize: 13, marginTop: 4,
            }}
          >▶ Apply kernel ({attempts} attempt{attempts !== 1 ? "s" : ""})</button>
        </div>

        {/* Metrics + gauge */}
        <div>
          {/* Throughput gauge */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 40, fontWeight: 800, color: beats ? "var(--good)" : "var(--accent)", lineHeight: 1 }}>
              {throughput.toFixed(0)}<span style={{ fontSize: 16, color: "var(--muted)" }}> GFLOPS</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              target: {lvl.target} GFLOPS — {beats ? "🎯 BEAT!" : `${(lvl.target - throughput).toFixed(0)} GFLOPS short`}
            </div>
            {/* Combined progress bar */}
            <div style={{ position: "relative", marginTop: 10, height: 20, background: "#0b111c", borderRadius: 6, overflow: "hidden", border: "1px solid #15202f" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct + "%", background: beats ? "var(--good)" : "var(--accent)", borderRadius: 6, transition: "width .4s" }} />
              <div style={{ position: "absolute", left: targetPct + "%", top: 0, width: 2, height: "100%", background: "var(--accent2)", opacity: 0.8 }} />
            </div>
          </div>

          {/* Factor breakdown */}
          {[
            { label: "Occupancy",     val: occupancy,      fmt: (v: number) => (v * 100).toFixed(0) + "%", col: toneOf(occupancy, 0.7, 0.4) },
            { label: "Coalescing",    val: coalesceFactor, fmt: (v: number) => (v * 100).toFixed(0) + "%", col: toneOf(coalesceFactor, 0.8, 0.5) },
            { label: "Vectorization", val: simdFactor,     fmt: (v: number) => (v * 100).toFixed(0) + "%", col: toneOf(simdFactor, 0.9, 0.6) },
          ].map(({ label, val, fmt, col }) => (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: "var(--muted)" }}>{label}</span>
                <b style={{ color: col }}>{fmt(val)}</b>
              </div>
              <Bar val={val} max={1} col={col} />
            </div>
          ))}

          {bestScore > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
              Best so far: <b style={{ color: "var(--accent2)" }}>{bestScore.toFixed(0)} GFLOPS</b>
            </div>
          )}

          {/* Hint */}
          <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 6, background: "rgba(76,201,240,.05)", border: "1px solid #1c2940", fontSize: 12, color: "var(--muted)" }}>
            💡 {lvl.hint}
          </div>
        </div>
      </div>

      {/* Win banner */}
      {won && (
        <div style={{ marginTop: 20, padding: "14px 16px", borderRadius: 8, background: "rgba(61,220,151,.08)", border: "1px solid rgba(61,220,151,.3)", textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--good)", marginBottom: 6 }}>
            🎯 Level complete — {throughput.toFixed(0)} GFLOPS in {attempts} attempt{attempts !== 1 ? "s" : ""}!
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
            Occupancy {(occupancy * 100).toFixed(0)}% · Coalescing {(coalesceFactor * 100).toFixed(0)}% · Vec×{vec}
          </div>
          {level < LEVELS.length - 1 && (
            <button onClick={nextLevel} style={{
              padding: "7px 20px", borderRadius: 6, border: "1px solid var(--good)",
              background: "rgba(61,220,151,.1)", color: "var(--good)",
              cursor: "pointer", fontWeight: 700, fontSize: 13,
            }}>Next level →</button>
          )}
        </div>
      )}
    </div>
  );
}
