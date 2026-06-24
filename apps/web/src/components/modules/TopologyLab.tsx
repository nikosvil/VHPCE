"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Glossed from "../Glossed";

// Hardware Topology Explorer
// Visualises sockets, NUMA domains, cache hierarchy, SMT, GPU SMs, and memory channels.
// Key lesson: where a thread runs determines which memory is fast.
// L1 ~1ns, L2 ~5ns, L3 ~15ns, DRAM ~60ns, remote DRAM ~120ns, GPU global ~500ns.

type System = "Single socket (desktop)" | "Dual socket (server)" | "GPU (SM view)";
type Highlight = "None" | "L1 sharing" | "L2 sharing" | "L3/LLC sharing" | "NUMA domains" | "SMT pairs";

const SYSTEMS: System[] = ["Single socket (desktop)", "Dual socket (server)", "GPU (SM view)"];
const HIGHLIGHTS: Highlight[] = ["None", "L1 sharing", "L2 sharing", "L3/LLC sharing", "NUMA domains", "SMT pairs"];

const INFO: Record<System, string> = {
  "Single socket (desktop)": "L1 access: ~1ns (4 cycles) · L2: ~5ns · L3: ~15ns · DRAM: ~60ns. A cache miss at L1 that hits DRAM is 60× slower.",
  "Dual socket (server)": "Local DRAM: ~60ns · Remote DRAM (cross-socket): ~120ns. The 2× NUMA penalty is why thread placement matters.",
  "GPU (SM view)": "Shared memory: ~5ns · L2: ~50ns · Global memory: ~500ns. Shared memory is 100× faster than global — use it for data reuse within a thread block.",
};

function getCode(highlight: Highlight): { title: string; code: string } {
  switch (highlight) {
    case "L1 sharing":
    case "SMT pairs":
      return {
        title: "SMT siblings share L1",
        code: `// SMT siblings share L1 — false sharing is worst here
// Two hyper-threads on the same core contend for
// the same 32 KB L1d.  If they write to addresses
// on the same 64-byte cache line, the line
// ping-pongs between \"modified\" states every store.
//
// Fix: pad shared structs to 64 bytes (one cache line).
struct alignas(64) PaddedCounter {
  long value;
  char pad[64 - sizeof(long)];
};`,
      };
    case "L2 sharing":
      return {
        title: "L2 tile cooperation",
        code: `// Threads sharing an L2 can cooperate on a tile
// without going to L3
//
// Two cores under the same L2 slice see each
// other’s stores in ~5ns instead of ~15ns.
// Bind producer/consumer pairs to the same L2:
#pragma omp parallel for schedule(static)
for (int i = 0; i < N; i += TILE)
  process_tile(data + i, TILE);
// static schedule keeps adjacent iterations on
// adjacent cores — sharing the L2 tile.`,
      };
    case "NUMA domains":
      return {
        title: "NUMA-aware placement",
        code: `# Bind process to NUMA node 0 (local memory)
numactl --membind=0 --cpunodebind=0 ./a.out

# OpenMP: keep threads close to their data
export OMP_PROC_BIND=close
export OMP_PLACES=cores

# First-touch policy: the OS allocates a page
# on the NUMA node of the thread that first
# writes to it.  Parallel init = local pages:
#pragma omp parallel for
for (int i = 0; i < N; i++)
  A[i] = 0.0;   // each thread touches its pages`,
      };
    case "L3/LLC sharing":
      return {
        title: "LLC (last-level cache) sharing",
        code: `// All cores on one socket share the L3 / LLC.
// Working sets that fit in L3 stay socket-local;
// exceeding it spills to DRAM (~60ns vs ~15ns).
//
// Check LLC size at runtime:
// $ getconf LEVEL3_CACHE_SIZE   # bytes
//
// Size your per-thread tile so total fits in L3:
size_t l3 = sysconf(_SC_LEVEL3_CACHE_SIZE);
size_t tile = l3 / nthreads / sizeof(double);`,
      };
    default:
      return {
        title: "Topology discovery commands",
        code: `# Show CPU topology (Linux)
lscpu
#   Thread(s) per core:  2        ← SMT / hyper-threading
#   Core(s) per socket:  6
#   Socket(s):           1
#   NUMA node(s):        1
#   L1d cache:           32K
#   L2 cache:            256K
#   L3 cache:            16384K

# Graphical topology (hwloc package)
hwloc-ls               # text tree
lstopo topology.png     # bitmap diagram`,
      };
  }
}

// ── Single-socket drawing ──────────────────────────────────────────

function drawSingleSocket(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number, w: number, h: number,
  highlight: Highlight, activeThreads: number, now: number,
  label?: string,
) {
  const CORES = 6;
  const THREADS_PER_CORE = 2;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.001);
  const dashOffset = now * 0.03;

  const pad = 8;
  const rowGap = 6;
  const dramH = 28;
  const l3H = 26;
  const l2H = 22;
  const l1H = 18;
  const coreR = 6;
  const coreRowH = coreR * 2 + 12;
  const totalContentH = dramH + rowGap + l3H + rowGap + l2H + rowGap + l1H + rowGap + coreRowH;
  const startY = oy + Math.max(pad, (h - totalContentH) / 2);

  // Widths
  const innerW = w - pad * 2;
  const dramW = innerW;
  const l3W = innerW - 4;
  const l2W = (l3W - (CORES - 1) * 4) / CORES;
  const l1W = (l2W - 4) / 2;

  // Title
  if (label) {
    ctx.fillStyle = "#8a9bb4";
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, ox + w / 2, oy + 10);
  }

  // DRAM box
  const dramX = ox + pad;
  const dramY = startY;
  ctx.fillStyle = "#1a2535";
  ctx.strokeStyle = "#3a4a5f";
  ctx.lineWidth = 1;
  ctx.fillRect(dramX, dramY, dramW, dramH);
  ctx.strokeRect(dramX, dramY, dramW, dramH);
  ctx.fillStyle = "#8a9bb4";
  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("DRAM", ox + w / 2 - 50, dramY + dramH / 2 + 4);
  ctx.fillStyle = "#5e6e88";
  ctx.font = "400 9px ui-monospace, monospace";
  ctx.fillText("DDR5 · ~40 GB/s", ox + w / 2 + 40, dramY + dramH / 2 + 4);

  // L3 / LLC box
  const l3X = ox + pad + 2;
  const l3Y = dramY + dramH + rowGap;
  ctx.fillStyle = "rgba(61,220,151,0.10)";
  ctx.strokeStyle = "#3ddc97";
  ctx.lineWidth = 1;
  ctx.fillRect(l3X, l3Y, l3W, l3H);
  ctx.strokeRect(l3X, l3Y, l3W, l3H);
  ctx.fillStyle = "#3ddc97";
  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("L3 / LLC", ox + w / 2 - 40, l3Y + l3H / 2 + 4);
  ctx.fillStyle = "#5e6e88";
  ctx.font = "400 9px ui-monospace, monospace";
  ctx.fillText("shared · 16 MB", ox + w / 2 + 40, l3Y + l3H / 2 + 4);

  // Data flow arrows (DRAM -> L3)
  drawDataFlowArrow(ctx, ox + w / 2, dramY + dramH, ox + w / 2, l3Y, now);

  // L2 boxes
  const l2Y = l3Y + l3H + rowGap;
  const l1Y = l2Y + l2H + rowGap;
  const coreY = l1Y + l1H + rowGap;

  let threadIdx = 0;
  for (let c = 0; c < CORES; c++) {
    const l2X = l3X + c * (l2W + 4);

    // Data flow arrow L3 -> L2
    drawDataFlowArrow(ctx, l2X + l2W / 2, l3Y + l3H, l2X + l2W / 2, l2Y, now);

    // L2 box
    ctx.fillStyle = "rgba(76,201,240,0.08)";
    ctx.strokeStyle = "#4cc9f0";
    ctx.lineWidth = 0.8;
    ctx.fillRect(l2X, l2Y, l2W, l2H);
    ctx.strokeRect(l2X, l2Y, l2W, l2H);
    ctx.fillStyle = "#4cc9f0";
    ctx.font = "600 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("L2 256K", l2X + l2W / 2, l2Y + l2H / 2 + 3);

    // Two L1d boxes per L2
    for (let t = 0; t < THREADS_PER_CORE; t++) {
      const l1X = l2X + t * (l1W + 4);

      // Data flow arrow L2 -> L1
      drawDataFlowArrow(ctx, l1X + l1W / 2, l2Y + l2H, l1X + l1W / 2, l1Y, now);

      ctx.fillStyle = "rgba(255,180,84,0.08)";
      ctx.strokeStyle = "#ffb454";
      ctx.lineWidth = 0.6;
      ctx.fillRect(l1X, l1Y, l1W, l1H);
      ctx.strokeRect(l1X, l1Y, l1W, l1H);
      ctx.fillStyle = "#ffb454";
      ctx.font = "600 7px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("L1d 32K", l1X + l1W / 2, l1Y + l1H / 2 + 3);

      // Core circle
      const coreX = l1X + l1W / 2;
      const coreCY = coreY + coreR + 2;
      const isActive = threadIdx < activeThreads;

      // Data flow arrow L1 -> Core
      drawDataFlowArrow(ctx, coreX, l1Y + l1H, coreX, coreCY - coreR, now);

      ctx.beginPath();
      ctx.arc(coreX, coreCY, coreR, 0, Math.PI * 2);
      if (isActive) {
        ctx.fillStyle = `rgba(76,201,240,${0.3 + 0.5 * pulse})`;
        ctx.shadowColor = "#4cc9f0";
        ctx.shadowBlur = 6 + 4 * pulse;
      } else {
        ctx.fillStyle = "#1a2535";
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isActive ? "#4cc9f0" : "#3a4a5f";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Thread dot inside core
      ctx.fillStyle = isActive ? "#e0e8f0" : "#3a4a5f";
      ctx.font = "600 6px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("T" + threadIdx, coreX, coreCY + 2);

      threadIdx++;
    }
  }

  // Highlight overlays
  if (highlight !== "None") {
    ctx.save();
    ctx.setLineDash([5, 3]);
    ctx.lineDashOffset = -dashOffset;
    ctx.lineWidth = 2;

    if (highlight === "SMT pairs") {
      ctx.strokeStyle = "#ff5d73";
      for (let c = 0; c < CORES; c++) {
        const l2X = l3X + c * (l2W + 4);
        ctx.strokeRect(l2X - 1, coreY - 2, l2W + 2, coreRowH + 2);
      }
    } else if (highlight === "L1 sharing") {
      ctx.strokeStyle = "#ffb454";
      for (let c = 0; c < CORES; c++) {
        const l2X = l3X + c * (l2W + 4);
        for (let t = 0; t < THREADS_PER_CORE; t++) {
          const l1X = l2X + t * (l1W + 4);
          ctx.strokeRect(l1X - 1, l1Y - 1, l1W + 2, l1H + rowGap + coreRowH + 3);
        }
      }
    } else if (highlight === "L2 sharing") {
      ctx.strokeStyle = "#4cc9f0";
      for (let c = 0; c < CORES; c++) {
        const l2X = l3X + c * (l2W + 4);
        ctx.strokeRect(l2X - 2, l2Y - 2, l2W + 4, l2H + rowGap + l1H + rowGap + coreRowH + 6);
      }
    } else if (highlight === "L3/LLC sharing") {
      ctx.strokeStyle = "#3ddc97";
      ctx.strokeRect(l3X - 3, l3Y - 3, l3W + 6, l3H + rowGap + l2H + rowGap + l1H + rowGap + coreRowH + 10);
    } else if (highlight === "NUMA domains") {
      ctx.strokeStyle = "#b388ff";
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.fillStyle = "#b388ff";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("single NUMA domain", ox + w / 2, oy + h - 6);
    }

    ctx.restore();
  }
}

// ── Data-flow arrow helper ─────────────────────────────────────────

function drawDataFlowArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number, now: number,
) {
  const speed = 0.0003;
  const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (len < 4) return;
  const t = (now * speed) % 1;
  // Faint line
  ctx.strokeStyle = "rgba(76,201,240,0.12)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Animated dot
  const dotX = x1 + (x2 - x1) * t;
  const dotY = y1 + (y2 - y1) * t;
  ctx.fillStyle = "rgba(76,201,240,0.7)";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

// ── GPU SM drawing ─────────────────────────────────────────────────

function drawGPU(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number, w: number, h: number,
  highlight: Highlight, activeThreads: number, now: number,
) {
  const SM_COLS = 4;
  const SM_ROWS = 4;
  const TOTAL_SM = SM_COLS * SM_ROWS;
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.001);
  const dashOffset = now * 0.03;

  const pad = 10;
  const rowGap = 6;
  const globalH = 26;
  const l2H = 20;
  const innerW = w - pad * 2;

  const smAreaH = h - pad * 2 - globalH - l2H - rowGap * 3;
  const smGap = 4;
  const smW = (innerW - (SM_COLS - 1) * smGap) / SM_COLS;
  const smH = (smAreaH - (SM_ROWS - 1) * smGap) / SM_ROWS;

  // Active SM count from thread slider (map 1-24 -> 1-16 SMs)
  const activeSMs = Math.min(TOTAL_SM, Math.max(1, Math.ceil(activeThreads * TOTAL_SM / 24)));

  // Global Memory box
  const globalX = ox + pad;
  const globalY = oy + pad;
  ctx.fillStyle = "#1a2535";
  ctx.strokeStyle = "#3a4a5f";
  ctx.lineWidth = 1;
  ctx.fillRect(globalX, globalY, innerW, globalH);
  ctx.strokeRect(globalX, globalY, innerW, globalH);
  ctx.fillStyle = "#8a9bb4";
  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("Global Memory (GDDR6/HBM)", ox + w / 2 - 30, globalY + globalH / 2 + 4);
  ctx.fillStyle = "#5e6e88";
  ctx.font = "400 9px ui-monospace, monospace";
  ctx.fillText("~900 GB/s", ox + w / 2 + 90, globalY + globalH / 2 + 4);

  // L2 Cache bar
  const l2Y = globalY + globalH + rowGap;
  ctx.fillStyle = "rgba(61,220,151,0.10)";
  ctx.strokeStyle = "#3ddc97";
  ctx.lineWidth = 1;
  ctx.fillRect(globalX, l2Y, innerW, l2H);
  ctx.strokeRect(globalX, l2Y, innerW, l2H);
  ctx.fillStyle = "#3ddc97";
  ctx.font = "600 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("L2 Cache · shared across all SMs", ox + w / 2, l2Y + l2H / 2 + 3);

  // Data flow arrow global -> L2
  drawDataFlowArrow(ctx, ox + w / 2, globalY + globalH, ox + w / 2, l2Y, now);

  // SM grid
  const smStartY = l2Y + l2H + rowGap;
  for (let r = 0; r < SM_ROWS; r++) {
    for (let c = 0; c < SM_COLS; c++) {
      const smIdx = r * SM_COLS + c;
      const smX = globalX + c * (smW + smGap);
      const smY = smStartY + r * (smH + smGap);
      const isActive = smIdx < activeSMs;

      // SM background
      if (isActive) {
        ctx.fillStyle = `rgba(76,201,240,${0.06 + 0.08 * pulse})`;
        ctx.shadowColor = "#4cc9f0";
        ctx.shadowBlur = 3 + 3 * pulse;
      } else {
        ctx.fillStyle = "#0c111c";
        ctx.shadowBlur = 0;
      }
      ctx.fillRect(smX, smY, smW, smH);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isActive ? "#4cc9f0" : "#1a2535";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(smX, smY, smW, smH);

      // Data flow arrow L2 -> SM
      drawDataFlowArrow(ctx, smX + smW / 2, l2Y + l2H, smX + smW / 2, smY, now);

      // SM label
      ctx.fillStyle = isActive ? "#e0e8f0" : "#3a4a5f";
      ctx.font = "600 8px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("SM " + smIdx, smX + smW / 2, smY + 10);

      // Warp scheduler slots (4 small squares)
      const slotSize = Math.min(6, (smW - 16) / 6);
      const slotsY = smY + 14;
      for (let s = 0; s < 4; s++) {
        const slotX = smX + smW / 2 - (4 * (slotSize + 2)) / 2 + s * (slotSize + 2);
        ctx.fillStyle = isActive ? `rgba(255,180,84,${0.3 + 0.3 * pulse})` : "#1a2535";
        ctx.fillRect(slotX, slotsY, slotSize, slotSize);
      }

      // Labels inside SM
      if (smH > 40) {
        ctx.fillStyle = isActive ? "#8a9bb4" : "#2a3545";
        ctx.font = "400 6px ui-monospace, monospace";
        ctx.fillText("Shared Mem/L1", smX + smW / 2, smY + smH - 14);
        ctx.fillText("32K registers", smX + smW / 2, smY + smH - 6);
      }
    }
  }

  // Highlight overlays
  if (highlight !== "None") {
    ctx.save();
    ctx.setLineDash([5, 3]);
    ctx.lineDashOffset = -dashOffset;
    ctx.lineWidth = 2;

    if (highlight === "L1 sharing") {
      // Each SM's shared memory
      ctx.strokeStyle = "#ffb454";
      for (let r = 0; r < SM_ROWS; r++) {
        for (let c = 0; c < SM_COLS; c++) {
          const smIdx = r * SM_COLS + c;
          if (smIdx < activeSMs) {
            const smX = globalX + c * (smW + smGap);
            const smY = smStartY + r * (smH + smGap);
            ctx.strokeRect(smX - 1, smY - 1, smW + 2, smH + 2);
          }
        }
      }
      ctx.fillStyle = "#ffb454";
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.fillText("shared memory is private to each SM", ox + w / 2, oy + h - 4);
    } else if (highlight === "L2 sharing") {
      ctx.strokeStyle = "#3ddc97";
      ctx.strokeRect(globalX - 2, l2Y - 2, innerW + 4, l2H + rowGap + smAreaH + 6);
      ctx.fillStyle = "#3ddc97";
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.setLineDash([]);
      ctx.textAlign = "center";
      ctx.fillText("all SMs share L2", ox + w / 2, oy + h - 4);
    }

    ctx.restore();
  }
}

// ── Main component ─────────────────────────────────────────────────

export default function TopologyLab() {
  const [system, setSystem] = useState<System>("Single socket (desktop)");
  const [highlight, setHighlight] = useState<Highlight>("None");
  const [threads, setThreads] = useState(8);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ system, highlight, threads });
  useEffect(() => { cfg.current = { system, highlight, threads }; });

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    let w = 1, h = 1, raf = 0;

    const resize = () => {
      const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };

    const loop = (ts: number) => {
      const { system: sys, highlight: hi, threads: thr } = cfg.current;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#070a10";
      ctx.fillRect(0, 0, w, h);

      if (sys === "GPU (SM view)") {
        drawGPU(ctx, 0, 0, w, h, hi, thr, ts);
      } else if (sys === "Dual socket (server)") {
        const socketW = (w - 40) / 2;
        const interY = h / 2;

        // Socket 0
        drawSingleSocket(ctx, 4, 0, socketW, h, hi, Math.min(thr, 12), ts, "Socket 0 / NUMA Node 0");

        // Socket 1
        const s1Active = Math.max(0, thr - 12);
        drawSingleSocket(ctx, socketW + 36, 0, socketW, h, hi, s1Active, ts, "Socket 1 / NUMA Node 1");

        // Interconnect bridge
        const bridgeX = socketW + 6;
        const bridgeW = 28;
        ctx.fillStyle = "rgba(255,93,115,0.12)";
        ctx.strokeStyle = "#ff5d73";
        ctx.lineWidth = 1;
        ctx.fillRect(bridgeX, interY - 16, bridgeW, 32);
        ctx.strokeRect(bridgeX, interY - 16, bridgeW, 32);

        // Double arrow
        ctx.strokeStyle = "#ff5d73";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bridgeX + 4, interY);
        ctx.lineTo(bridgeX + bridgeW - 4, interY);
        ctx.stroke();
        // Arrowheads
        ctx.beginPath();
        ctx.moveTo(bridgeX + 4, interY);
        ctx.lineTo(bridgeX + 8, interY - 3);
        ctx.moveTo(bridgeX + 4, interY);
        ctx.lineTo(bridgeX + 8, interY + 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bridgeX + bridgeW - 4, interY);
        ctx.lineTo(bridgeX + bridgeW - 8, interY - 3);
        ctx.moveTo(bridgeX + bridgeW - 4, interY);
        ctx.lineTo(bridgeX + bridgeW - 8, interY + 3);
        ctx.stroke();

        // UPI label
        ctx.save();
        ctx.fillStyle = "#ff5d73";
        ctx.font = "600 7px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.translate(bridgeX + bridgeW / 2, interY - 20);
        ctx.fillText("UPI", 0, 0);
        ctx.restore();

        // Cross-socket warning when threads spill
        if (thr > 12) {
          ctx.fillStyle = "#ff5d73";
          ctx.font = "600 9px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(
            `${thr - 12} thread${thr - 12 > 1 ? "s" : ""} on socket 1 — cross-socket DRAM access (+60ns)`,
            w / 2, h - 6,
          );
        }

        // NUMA highlight
        if (hi === "NUMA domains") {
          ctx.save();
          ctx.setLineDash([5, 3]);
          ctx.lineDashOffset = -(ts * 0.03);
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#b388ff";
          ctx.strokeRect(6, 14, socketW - 4, h - 22);
          ctx.strokeStyle = "#ffb454";
          ctx.strokeRect(socketW + 38, 14, socketW - 4, h - 22);
          ctx.restore();

          ctx.fillStyle = "#b388ff";
          ctx.font = "600 9px ui-monospace, monospace";
          ctx.textAlign = "left";
          ctx.fillText("NUMA 0", 10, h - 6);
          ctx.textAlign = "right";
          ctx.fillStyle = "#ffb454";
          ctx.fillText("NUMA 1", w - 10, h - 6);
        }
      } else {
        // Single socket
        drawSingleSocket(ctx, 0, 0, w, h, hi, thr, ts);
      }

      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const codeInfo = getCode(highlight);

  return (
    <>
      <div className="info" style={{ marginBottom: 16 }}>
        <Glossed>{"Hardware topology determines memory access latency. An L1 cache hit takes ~1ns; a DRAM access takes ~60ns; a cross-socket (NUMA) access costs ~120ns. On a GPU, shared memory is 100× faster than global memory. Understanding the cache hierarchy, NUMA domains, and SMT thread placement is essential for writing code that uses the hardware well."}</Glossed>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Controls</h2>
          <div className="ctrl">
            <label>System</label>
            <div className="seg fix">
              {SYSTEMS.map((s) => (
                <button key={s} className={system === s ? "on" : ""} onClick={() => setSystem(s)}>
                  {s === "Single socket (desktop)" ? "Single socket" : s === "Dual socket (server)" ? "Dual socket" : "GPU (SM)"}
                </button>
              ))}
            </div>
            <div className="fixhint">
              {system === "Single socket (desktop)" && "Desktop CPU: one socket, one NUMA domain, shared L3."}
              {system === "Dual socket (server)" && "Server: two sockets connected by UPI, two NUMA domains."}
              {system === "GPU (SM view)" && "GPU: streaming multiprocessors with shared memory and warps."}
            </div>
          </div>
          <div className="ctrl">
            <label>Highlight</label>
            <div className="seg fix">
              {HIGHLIGHTS.map((h) => (
                <button key={h} className={highlight === h ? "on" : ""} onClick={() => setHighlight(h)}>
                  {h === "L3/LLC sharing" ? "L3/LLC" : h === "NUMA domains" ? "NUMA" : h === "SMT pairs" ? "SMT" : h}
                </button>
              ))}
            </div>
            <div className="fixhint">
              {highlight === "None" && "No highlight — explore the topology tree."}
              {highlight === "L1 sharing" && "L1 cache is private per core (or per SMT sibling)."}
              {highlight === "L2 sharing" && "Two cores (SMT siblings) share each L2 slice."}
              {highlight === "L3/LLC sharing" && "All cores on a socket share the last-level cache."}
              {highlight === "NUMA domains" && "Each socket has its own DRAM — remote access costs 2×."}
              {highlight === "SMT pairs" && "Hyper-threaded siblings share the entire core pipeline and L1."}
            </div>
          </div>
          <div className="ctrl">
            <label>Thread placement<b>{threads}</b></label>
            <input type="range" min={1} max={24} step={1} value={threads} onChange={(e) => setThreads(+e.target.value)} />
            <div className="fixhint">
              {system === "Dual socket (server)"
                ? `Threads 1–12 fill socket 0; threads 13–24 spill to socket 1.`
                : system === "GPU (SM view)"
                  ? `Maps to ${Math.min(16, Math.max(1, Math.ceil(threads * 16 / 24)))} active SM${Math.ceil(threads * 16 / 24) > 1 ? "s" : ""} out of 16.`
                  : `${threads} of 12 hardware threads active (6 cores × 2 SMT).`}
            </div>
          </div>
          <div className="ctrl" style={{ marginTop: 4 }}>
            <div className="ref-related">
              <Link className="learn-link" style={{ marginTop: 0 }} href="/?exp=numaEffects">NUMA Effects →</Link>
              <Link className="learn-link" style={{ marginTop: 0 }} href="/?exp=cacheHierarchy">Cache Hierarchy →</Link>
              <Link className="learn-link" style={{ marginTop: 0 }} href="/?exp=cuda">GPU Occupancy →</Link>
            </div>
          </div>
        </section>

        <section className="card vizwrap">
          <h2>
            <span>Topology · {system === "Single socket (desktop)" ? "1S / 6C / 12T" : system === "Dual socket (server)" ? "2S / 12C / 24T" : "16 SMs / 64 warps"}</span>
            <span className="scene-tag">{highlight === "None" ? "select a highlight →" : highlight}</span>
          </h2>
          <canvas className="viz lab-canvas" ref={canvasRef} />
        </section>

        <section className="card explain">
          <h2>
            <span>{codeInfo.title}</span>
            <span className="scene-tag">{system === "GPU (SM view)" ? "GPU" : system === "Dual socket (server)" ? "dual socket" : "single socket"}</span>
          </h2>
          <p className="learn-blurb">
            <Glossed>{INFO[system]}</Glossed>
          </p>
          <div className="code">
            {codeInfo.code.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}
          </div>
          <div className="eb how" style={{ marginTop: 12 }}>
            <div className="t">Why topology matters</div>
            <div className="body">
              <Glossed>{"Thread placement determines which caches and DRAM banks are fast. A thread reading data allocated on a remote NUMA node pays 2× the latency. SMT siblings competing for the same L1 can suffer false sharing. On GPUs, threads within one SM share fast on-chip shared memory, but cross-SM communication must go through the slow L2 or global memory. The tools hwloc-ls, lscpu, and numactl let you inspect and control placement."}</Glossed>
            </div>
          </div>
          {highlight === "NUMA domains" && (
            <div className="eb how" style={{ marginTop: 8 }}>
              <div className="t" style={{ color: "#ffb454" }}>First-touch policy</div>
              <div className="body">
                <Glossed>{"Linux allocates physical pages on the NUMA node of the thread that first writes to them. If the main thread initializes all data, every page lands on node 0 — threads on node 1 pay the remote penalty on every access. Fix: parallel initialization so each thread touches (and thus allocates) its own pages locally."}</Glossed>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
