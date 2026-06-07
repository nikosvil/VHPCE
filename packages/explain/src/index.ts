/**
 * @vhpce/explain — deterministic explainers (docs/05). Pure functions over an
 * ExperimentResult → {what, why, how, exp}. `Explain` reads model results;
 * `ExplainMeasured` reads measured results (and handles negative scaling etc.).
 * The optional LLM panel will be layered on top later, grounded on these findings.
 */
import { type ExperimentResult, type Explanation, fmt } from "@vhpce/profile-schema";

type ExplainFn = (r: ExperimentResult) => Explanation;

export const Explain: Record<string, ExplainFn> = {
  falseSharing(r) {
    const c = r.current, peak = r.peak!, padded = r.params.padded;
    if (padded)
      return {
        sev: "info",
        what: `Padded: speedup reaches <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads — close to the ideal ${c.x}×.`,
        why: `Each thread's counter sits on its <b>own 64-byte cache line</b>, so a write by one core never invalidates another core's line. No coherence ping-pong.`,
        how: `Already fixed. Turn padding <b>off</b> to watch false sharing wreck the same loop.`,
        exp: `This <b>is</b> the target curve — near-linear scaling.`,
      };
    return {
      sev: "critical",
      what: `Speedup peaks at only <b>${fmt(peak.speedup, 1)}×</b> around ${peak.x} threads, then <b>falls to ${fmt(c.speedup, 1)}×</b> at ${c.x}. Adding threads makes it slower.`,
      why: `All ${c.x} counters share <b>one 64-byte cache line</b>. Every increment invalidates that line in every other core, so it ping-pongs across cores over the bus — coherence traffic grows ~linearly with thread count and now dominates (${fmt(r.coh!, 0)} ms of the ${fmt(c.time, 0)} ms runtime).`,
      how: `<b>Pad/align each thread's counter to its own cache line</b> (64-byte alignment, or per-thread padded struct). Flip "Pad to cache line".`,
      exp: `Near-linear speedup restored (~${c.x}× at ${c.x} threads); coherence stall → ~0%.`,
    };
  },
  synchronization(r) {
    const c = r.current, mode = r.params.mode;
    if (mode === "reduction")
      return {
        sev: "info",
        what: `Per-thread accumulation + one reduction scales to <b>${fmt(c.speedup, 1)}×</b> (efficiency ${fmt(c.efficiency * 100, 0)}%).`,
        why: `Threads sum into <b>private</b> partials with no shared writes in the hot loop; only a tiny <b>O(log p)</b> merge at the end is serial.`,
        how: `Already the right pattern. Switch to <b>critical</b> or <b>atomic</b> to see synchronization bite.`,
        exp: `This is the target — near-ideal scaling.`,
      };
    return {
      sev: mode === "critical" ? "critical" : "warn",
      what: `Speedup stalls at <b>${fmt(c.speedup, 1)}×</b> on ${c.x} threads and won't pass <b>${fmt(r.ceiling!, 1)}×</b> no matter how many you add.`,
      why: `The <b>${mode}</b> update serializes the hot loop: ${fmt(r.serialPct!, 0)}% of the work runs one-thread-at-a-time, and <b>Amdahl's law</b> caps speedup at 1 / serial-fraction = ${fmt(r.ceiling!, 1)}×. Threads also queue for the lock, adding contention.`,
      how: `Accumulate into <b>per-thread partials</b> and combine once at the end (reduction). Pick "reduction".`,
      exp: `Serial fraction → ~1%, speedup tracks the near-ideal reduction curve (~${c.x}× achievable).`,
    };
  },
  bandwidth(r) {
    const c = r.current;
    if (r.bound === "Compute")
      return {
        sev: "info",
        what: `At arithmetic intensity ${fmt(r.params.ai, 2)} FLOP/byte the kernel is now <b>compute-bound</b>: ${fmt(r.gf!, 0)} GFLOP/s.`,
        why: `Above the roofline ridge (AI > ${fmt(r.ridge!, 1)}), performance is limited by compute, not the memory bus — so extra threads help again.`,
        how: `This is the goal of cache blocking / fusion: do more FLOPs per byte moved.`,
        exp: `Operating point sits under the compute ceiling; scaling resumes.`,
      };
    return {
      sev: "critical",
      what: `Speedup saturates near <b>${fmt(c.speedup, 1)}×</b> and barely moves past ~${(r.ridge ? 4 : 4)} threads — even with 24 cores available.`,
      why: `The STREAM-triad is <b>memory-bound</b> (AI ${fmt(r.params.ai, 2)} FLOP/byte, below the ridge ${fmt(r.ridge!, 1)}). DRAM bandwidth is <b>${fmt(r.util! * 100, 0)}% saturated</b>; extra threads contend for the same bus instead of doing new work.`,
      how: `Don't add threads — <b>raise arithmetic intensity</b> (cache blocking, loop fusion) or cut memory traffic. Drag "Arithmetic intensity" right to move the operating point.`,
      exp: `The kernel's point on the roofline moves right toward the compute ceiling; >2× headroom unlocked.`,
    };
  },
  imbalance(r) {
    const c = r.current, sched = r.params.sched;
    if (sched === "dynamic")
      return {
        sev: "info",
        what: `Dynamic scheduling reaches <b>${fmt(c.speedup, 1)}×</b> (imbalance factor ${fmt(r.factor!, 2)}, only ${fmt(r.idlePct!, 0)}% idle).`,
        why: `Chunks are handed out on demand, so a thread that finishes early <b>steals</b> more work instead of idling. Load stays even.`,
        how: `Already balanced. Switch to <b>static</b> to see idle cores.`,
        exp: `This is the target — cores stay busy until the end.`,
      };
    return {
      sev: sched === "static" ? "critical" : "warn",
      what: `Speedup stuck at <b>${fmt(c.speedup, 1)}×</b> on ${c.x} threads; <b>${fmt(r.idlePct!, 0)}% of core-time is idle</b>.`,
      why: `The triangular loop with <b>${sched}</b> scheduling gives early threads little work and late threads a lot. Total time = the <b>slowest</b> thread (imbalance factor ${fmt(r.factor!, 2)}×), so finished cores sit idle waiting.`,
      how: `Use <b>schedule(dynamic)</b> or <b>guided</b> so idle threads grab remaining chunks.`,
      exp: `Imbalance factor → ~1.05, idle time → near 0, speedup approaches ${c.x}×.`,
    };
  },
  mpiHalo(r) {
    const c = r.current, weak = r.params.mode === "weak", commPct = r.idlePct ?? 0, peak = r.peak!;
    if (weak)
      return {
        sev: c.efficiency > 0.7 ? "info" : "warn",
        what: `Weak scaling: as the grid grows with the ranks, scaled speedup reaches <b>${fmt(c.speedup, 1)}×</b> on ${c.x} ranks at <b>${fmt(c.efficiency * 100, 0)}% efficiency</b> — close to ideal.`,
        why: `Every rank keeps the <b>same local work</b>, so compute time is constant; only the halo exchange grows (~log p), a small ${fmt(commPct, 0)}% of the runtime. Efficiency barely drops.`,
        how: `Already the scalable regime. Switch to <b>strong</b> to watch a fixed problem hit the communication wall.`,
        exp: `This is how HPC fills a big machine — size the problem to the ranks and efficiency stays flat.`,
      };
    return {
      sev: "warn",
      what: `Strong scaling: speedup climbs then <b>saturates near ${fmt(peak.speedup, 1)}×</b> — at ${c.x} ranks you get <b>${fmt(c.speedup, 1)}×</b> (${fmt(c.efficiency * 100, 0)}% efficiency), and more ranks barely help.`,
      why: `The global grid is <b>fixed</b>, so per-rank compute shrinks (∝ 1/p) while the halo exchange stays roughly constant and its <b>latency grows ~log(p)</b>. Communication is now <b>${fmt(commPct, 0)}%</b> of the time — the comm wall.`,
      how: `Either <b>grow the problem with the machine</b> (switch to weak scaling) or cut communication — larger subdomains, fewer/aggregated messages, comm/compute overlap.`,
      exp: `Weak scaling holds efficiency near ideal; on a real multi-node cluster the strong-scaling wall is even sharper than on one shared-memory node.`,
    };
  },
  cuda(r) {
    const occ = (r.occupancy ?? 0) * 100, heavy = r.params.variant === "heavy", B = r.current.x;
    if (!heavy)
      return {
        sev: occ > 66 ? "info" : "warn",
        what: `Light kernel: at <b>${B} threads/block</b> the SM reaches <b>${fmt(occ, 0)}% occupancy</b> (${r.regsPerThread} registers/thread).`,
        why: `Few live variables means low register pressure, so the SM can host enough warps to hide memory and pipeline latency. Occupancy is bounded by block geometry, not resources.`,
        how: `Already healthy. Switch to <b>heavy</b> to watch register pressure throttle occupancy on the same GPU.`,
        exp: `High occupancy keeps the SMs busy; throughput tracks the occupancy curve.`,
      };
    return {
      sev: occ < 50 ? "critical" : "warn",
      what: `Heavy kernel: at <b>${B} threads/block</b> occupancy is only <b>${fmt(occ, 0)}%</b> — limited by <b>${r.limiter}</b> (${r.regsPerThread} registers/thread).`,
      why: `Each thread needs ${r.regsPerThread} registers, so a ${B}-thread block claims a big slice of the SM's 64K register file. The SM runs out of registers before warp slots, leaving warps unscheduled — low occupancy and idle latency-hiding capacity. Bigger blocks make it worse.`,
      how: `<b>Cut register pressure</b> (fewer live variables, recompute instead of cache, <code>__launch_bounds__</code> to cap regs) or pick the occupancy sweet-spot block size (~${r.optimalBlock}).`,
      exp: `Reducing registers (flip to <b>light</b>) lifts occupancy toward 100% — more warps per SM, better latency hiding.`,
    };
  },
};

export const ExplainMeasured: Record<string, ExplainFn> = {
  falseSharing(r) {
    const c = r.current, eff = c.efficiency * 100, loss = 100 - eff;
    if (r.params.padded)
      return {
        sev: eff > 55 ? "info" : "warn",
        what: `Measured on your 24 cores: the <b>padded</b> layout reaches <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads (${fmt(eff, 0)}% efficiency).`,
        why: `Each thread's counter has its <b>own 64-byte cache line</b> (stride 8), so cores never invalidate one another — the loop scales close to linear.`,
        how: `This is the good layout. Toggle padding <b>off</b> to measure the false-sharing penalty on this exact CPU.`,
        exp: `Compare against the shared layout: identical work, far less speedup.`,
      };
    return {
      sev: "critical",
      what: `Measured: the <b>shared</b> layout reaches only <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads — ${fmt(eff, 0)}% efficiency, so <b>~${fmt(loss, 0)}% of your cores are wasted</b>.`,
      why: `All threads' counters pack into the <b>same cache line(s)</b>. Every write invalidates the line in the other cores, so it ping-pongs over the coherence fabric — pure overhead, no extra work done.`,
      how: `<b>Pad each counter to its own 64-byte line.</b> Flip "Pad to cache line" — same code, just the index stride changes.`,
      exp: `On this machine padding lifts the same loop to a markedly higher speedup — toggle it and watch the curve.`,
    };
  },
  synchronization(r) {
    const c = r.current, mode = r.params.mode, eff = c.efficiency * 100, slower = c.speedup < 1;
    if (mode === "reduction")
      return {
        sev: eff > 50 ? "info" : "warn",
        what: `Measured: per-thread + reduction reaches <b>${fmt(c.speedup, 1)}×</b> on ${c.x} cores (${fmt(eff, 0)}% efficiency).`,
        why: `Threads sum into <b>private partials</b> — no shared writes in the hot loop, just one O(log p) merge. It scales until memory bandwidth becomes the limit.`,
        how: `This is the right pattern. Switch to <b>critical</b> or <b>atomic</b> to measure the synchronization tax.`,
        exp: `The lock-based strategies fall far short of this on the same cores.`,
      };
    return {
      sev: "critical",
      what: slower
        ? `Measured: <b>${mode}</b> gets <b>SLOWER</b> as you add cores — ${fmt(c.speedup, 2)}× at ${c.x} threads (≈ ${fmt(1 / c.speedup, 1)}× slower than a single thread!).`
        : `Measured: <b>${mode}</b> stalls at <b>${fmt(c.speedup, 1)}×</b> on ${c.x} cores (${fmt(eff, 0)}% efficiency).`,
      why: `Every iteration takes the <b>${mode}</b> lock, so the hot loop runs one-thread-at-a-time and threads queue for it. More cores add contention, not throughput.`,
      how: `Accumulate into <b>per-thread partials</b> and combine once (reduction). Pick "reduction".`,
      exp: `Reduction removes the shared write — measure it jump to many× on the very same cores.`,
    };
  },
  bandwidth(r) {
    const c = r.current;
    return {
      sev: "critical",
      what: `Measured: the triad saturates at <b>${fmt(c.speedup, 1)}×</b> (peak ${fmt(r.peakSpeedup!, 1)}×) and plateaus by ~${r.satThreads} threads — your 24 cores can't push past it.`,
      why: `The STREAM-triad is <b>memory-bound</b>. It hits <b>${fmt(r.bw!, 1)} GB/s</b> = ${fmt(r.util! * 100, 0)}% of this laptop's measured DRAM ceiling (<b>${fmt(r.peakBW!, 1)} GB/s</b>). Past saturation, extra threads just wait on the bus.`,
      how: `Don't add threads — <b>raise arithmetic intensity</b> (cache blocking / fusion) so each byte moved does more FLOPs.`,
      exp: `Higher AI lifts the kernel off the memory roofline; until then bandwidth is the hard wall.`,
    };
  },
  imbalance(r) {
    const c = r.current, sched = r.params.sched, eff = c.efficiency * 100;
    if (sched !== "static")
      return {
        sev: eff > 50 ? "info" : "warn",
        what: `Measured: <b>${sched}</b> scheduling reaches <b>${fmt(c.speedup, 1)}×</b> on ${c.x} cores (${fmt(eff, 0)}% efficiency, imbalance ${fmt(r.factor!, 2)}×).`,
        why: `Chunks are handed out on demand, so threads that finish early <b>steal</b> remaining rows instead of idling.`,
        how: `Good. Switch to <b>static</b> to measure the idle-core penalty of the triangular loop.`,
        exp: `Static overloads late-indexed threads while the rest sit idle.`,
      };
    return {
      sev: "critical",
      what: `Measured: <b>static</b> scheduling reaches only <b>${fmt(c.speedup, 1)}×</b> on ${c.x} cores (${fmt(eff, 0)}% efficiency), imbalance factor ${fmt(r.factor!, 2)}×.`,
      why: `The triangular loop gives late-indexed threads far more work; with fixed static chunks they finish last while early threads idle. Total time = the slowest thread.`,
      how: `Use <b>schedule(dynamic)</b> or <b>guided</b> so idle threads grab the remaining rows.`,
      exp: `Dynamic rebalances the load — measure the speedup climb on the same cores.`,
    };
  },
  mpiHalo(r) {
    const c = r.current, weak = r.params.mode === "weak", eff = c.efficiency * 100, lost = r.idlePct ?? 0;
    if (weak)
      return {
        sev: eff > 60 ? "info" : "warn",
        what: `Measured (weak): on ${c.x} ranks the grid grows with the machine — scaled speedup <b>${fmt(c.speedup, 1)}×</b>, efficiency <b>${fmt(eff, 0)}%</b>.`,
        why: `Per-rank work is constant, so wall time stays roughly flat as ranks (and the global problem) grow; only halo exchange adds a little (~${fmt(lost, 0)}% overhead).`,
        how: `This is the scalable regime. Switch to <b>strong</b> to measure the fixed-problem comm wall on this node.`,
        exp: `Weak scaling is how you keep efficiency high as you add hardware.`,
      };
    return {
      sev: eff > 40 ? "warn" : "critical",
      what: `Measured (strong): a fixed grid reaches <b>${fmt(c.speedup, 1)}×</b> on ${c.x} ranks (${fmt(eff, 0)}% efficiency); ~${fmt(lost, 0)}% is lost to communication and coordination.`,
      why: `With the problem fixed, each rank computes less while halo exchange and launch/coordination overhead don't shrink — so efficiency falls as ranks rise.`,
      how: `Grow the problem with the ranks (weak scaling) or cut communication. <b>Note:</b> on one node MPI uses shared memory, so this wall is gentler than on a real multi-node cluster.`,
      exp: `Flip to weak scaling and watch efficiency stay high on the very same ranks.`,
    };
  },
  cuda(r) {
    const occ = (r.occupancy ?? 0) * 100, heavy = r.params.variant === "heavy", B = r.current.x;
    const dev = r.smName || "the GPU";
    if (!heavy)
      return {
        sev: occ > 60 ? "info" : "warn",
        what: `Measured on ${dev}: the <b>light</b> kernel hits <b>${fmt(occ, 0)}% occupancy</b> at ${B} threads/block (${r.regsPerThread} regs/thread).`,
        why: `Low register usage lets many warps reside per SM, so latency is hidden and the SMs stay busy.`,
        how: `This is the healthy case. Switch to <b>heavy</b> to measure register-limited occupancy on the same card.`,
        exp: `Compare the two: same GPU, register pressure is the only difference.`,
      };
    return {
      sev: occ < 50 ? "critical" : "warn",
      what: `Measured on ${dev}: the <b>heavy</b> kernel reaches only <b>${fmt(occ, 0)}%</b> occupancy at ${B} threads/block — limiter: <b>${r.limiter}</b> (${r.regsPerThread} regs/thread).`,
      why: `At ${r.regsPerThread} registers/thread the SM's register file fills before its warp slots do, so fewer warps run concurrently and latency isn't fully hidden.`,
      how: `Reduce registers (<code>__launch_bounds__</code>, fewer live values) or choose the measured sweet-spot block (~${r.optimalBlock}). Flip to <b>light</b> to see occupancy recover.`,
      exp: `The light kernel measures markedly higher occupancy on the very same GPU.`,
    };
  },
};
