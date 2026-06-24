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
    const c = r.current, peak = r.peak, padded = r.params.padded;
    if (padded || !peak)
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
      why: `All ${c.x} counters share <b>one 64-byte cache line</b>. Every increment invalidates that line in every other core, so it ping-pongs across cores over the bus — coherence traffic grows ~linearly with thread count and now dominates (${fmt(r.coh ?? 0, 0)} ms of the ${fmt(c.time, 0)} ms runtime).`,
      how: `<b>Pad/align each thread's counter to its own cache line</b> (64-byte alignment, or per-thread padded struct). Flip "Pad to cache line".`,
      exp: `Near-linear speedup restored (~${c.x}× at ${c.x} threads); coherence stall → ~0%.`,
      secondary: [
        { bottleneck: "bandwidth saturation", note: "Coherence traffic also saturates the memory bus — even padded code won't scale past the bus limit." },
      ],
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
      secondary: [
        { bottleneck: "cache contention", note: "The lock variable itself causes coherence traffic similar to false sharing." },
      ],
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
      secondary: [
        { bottleneck: "NUMA effects", note: "On multi-socket systems, remote DRAM access compounds the bandwidth wall." },
      ],
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
      secondary: [
        { bottleneck: "synchronization", note: "The implicit barrier at the end of the parallel region forces all threads to wait for the slowest." },
      ],
    };
  },
  mpiHalo(r) {
    const c = r.current, weak = r.params.mode === "weak", commPct = r.idlePct ?? 0, peak = r.peak;
    if (weak || !peak)
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
      secondary: [
        { bottleneck: "load imbalance", note: "Non-uniform domain sizes at non-power-of-2 rank counts create residual imbalance." },
      ],
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
      secondary: [
        { bottleneck: "memory latency", note: "Low occupancy means fewer warps to switch to during memory stalls — the SM idles waiting for DRAM instead of hiding latency." },
      ],
    };
  },
  cudaCoalesce(r) {
    const stride = r.current.x, eff = (r.current.efficiency ?? 0) * 100, wasted = 100 - eff;
    if (stride === 1)
      return {
        sev: "info",
        what: `Coalesced access (<b>stride 1</b>): the warp's 32 lanes read 32 consecutive values, so the GPU fetches <b>one 128-byte cache line</b> per warp — <b>${fmt(r.bw ?? 0, 0)} GB/s</b>, 0% wasted.`,
        why: `Adjacent lanes touch adjacent addresses, so the memory controller services the whole warp with a single transaction. This is the bandwidth-optimal pattern.`,
        how: `Already optimal. Push the <b>stride</b> up to watch each warp scatter across more cache lines.`,
        exp: `Every doubling of the stride roughly halves the achieved bandwidth — the curve is ~1/stride.`,
      };
    return {
      sev: eff < 30 ? "critical" : "warn",
      what: `<b>Stride ${stride}</b>: the 32 lanes land in ${stride} different cache lines, so the GPU moves <b>${stride}×</b> the bytes for the same data — <b>${fmt(r.bw ?? 0, 0)} GB/s</b>, ~${fmt(wasted, 0)}% of fetched bandwidth discarded.`,
      why: `A 128-byte line is the smallest unit DRAM delivers. When lanes are spread <code>stride</code> apart, most of each fetched line is unused but still paid for — bandwidth wasted scales with the stride.`,
      how: `<b>Make the inner index unit-stride.</b> Transpose the loop nest or store the array so the fast-varying dimension matches <code>threadIdx.x</code> (Struct-of-Arrays, not Array-of-Structs).`,
      exp: `Drop the stride back toward 1 and the achieved bandwidth climbs back to the coalesced peak.`,
      secondary: [
        { bottleneck: "L2 cache thrashing", note: "Strided access pollutes the L2 with unused portions of each cache line, evicting useful data and increasing DRAM round-trips." },
      ],
    };
  },
  cudaDivergence(r) {
    const D = r.current.x, eff = (r.current.efficiency ?? 0) * 100, slow = r.factor ?? 1 / (r.current.efficiency || 1);
    if (D === 1)
      return {
        sev: "info",
        what: `Uniform control flow (<b>1 path</b>): all 32 lanes of the warp take the same branch, so they execute together in a single pass — full SIMT throughput.`,
        why: `A warp shares one program counter. When every lane agrees on the branch, there's nothing to serialize and all 32 lanes do useful work each cycle.`,
        how: `Already optimal. Increase the <b>divergent paths</b> to watch the warp split into serial passes.`,
        exp: `Each extra path the warp must take adds another serialized pass — runtime climbs roughly linearly.`,
      };
    return {
      sev: eff < 30 ? "critical" : "warn",
      what: `<b>${D} divergent paths</b>: the warp runs ${D} passes one after another (≈<b>${fmt(slow, 1)}× slower</b>), with only ~${fmt(eff, 0)}% of lanes active per pass.`,
      why: `All 32 lanes share one program counter. When lanes take different branches, the hardware masks off the inactive ones and replays the warp once per path — the idle lanes burn cycles doing nothing.`,
      how: `<b>Make branches warp-uniform.</b> Sort/bin data so a whole warp takes the same path, hoist the condition out of the warp, or replace small <code>if/else</code> with branchless arithmetic (<code>select</code>/predication).`,
      exp: `Collapse the paths back toward 1 and the warp re-converges — the serialized passes disappear and throughput recovers.`,
      secondary: [
        { bottleneck: "instruction cache pressure", note: "Highly divergent warps execute many code paths, increasing I-cache footprint and potentially causing I-cache misses on smaller SMs." },
      ],
    };
  },
  cudaAtomics(r) {
    const T = r.current.x, eff = (r.current.efficiency ?? 0) * 100, slow = r.factor ?? 1 / (r.current.efficiency || 1);
    if (T === 1)
      return {
        sev: "critical",
        what: `<b>One atomic target</b>: every thread does <code>atomicAdd</code> on the <b>same</b> address, so all the updates serialize at the L2 atomic unit — <b>${fmt(slow, 1)}× slower</b> than spreading them.`,
        why: `Atomics on one location must apply one-at-a-time to stay correct. With thousands of threads funneled through a single address, the hardware queues them — throughput collapses to that one unit's rate.`,
        how: `<b>Privatize the updates.</b> Accumulate into per-block <code>__shared__</code> counters (or many per-bin counters) and do just one global <code>atomicAdd</code> per block at the end — a hierarchical reduction.`,
        exp: `Spread the updates across more targets and the time falls steeply — until contention is gone and you hit the bandwidth/launch floor.`,
        secondary: [
          { bottleneck: "memory latency", note: "Serialized atomics stall warps waiting for the L2 atomic unit, reducing occupancy and preventing latency hiding." },
        ],
      };
    return {
      sev: eff > 60 ? "info" : "warn",
      what: `<b>${T} atomic targets</b>: the updates spread across ${T} addresses, so they proceed largely in parallel — <b>${fmt(eff, 0)}%</b> of peak throughput${slow > 1.5 ? `, still ${fmt(slow, 1)}× off the best` : ""}.`,
      why: `Distributing atomics over many locations lets independent atomic units work concurrently instead of queuing on one address. Throughput rises until something else (memory bandwidth, launch overhead) becomes the limit.`,
      how: `${eff > 80 ? "Already well-spread." : "Spread wider still"} — or, for a true sum, finish with a tree/shared-memory reduction so the final combine costs almost nothing.`,
      exp: `Drop back toward one target and watch the time climb steeply as contention returns.`,
    };
  },

  numaEffects(r) {
    const c = r.current, numaAware = r.params.numaAware;
    const NODE_SIZE = 12;
    const remotePct = numaAware ? 0 : Math.max(0, (c.x - NODE_SIZE) / c.x) * 100;
    if (numaAware)
      return {
        sev: "info",
        what: `NUMA-aware: threads are pinned to their local socket — speedup reaches <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads (${fmt(c.efficiency * 100, 0)}% efficiency).`,
        why: `Each thread accesses <b>local DRAM</b> through its socket's own memory controller. No inter-socket traffic, no remote-access latency penalty.`,
        how: `Already optimal. Toggle off NUMA binding to watch efficiency collapse when threads cross the socket boundary.`,
        exp: `This is the target curve — near-linear scaling regardless of thread count.`,
      };
    if (c.x <= NODE_SIZE)
      return {
        sev: "warn",
        what: `With ${c.x} threads all on socket 0, speedup is <b>${fmt(c.speedup, 1)}×</b> (${fmt(c.efficiency * 100, 0)}% efficiency) — no NUMA penalty yet.`,
        why: `All ${c.x} threads still live on the same socket as the data. Add more threads past ${NODE_SIZE} and the second socket's threads will access socket 0's memory over the slow inter-socket link.`,
        how: `Push threads beyond ${NODE_SIZE} to see the NUMA cliff. The fix is <b>NUMA-aware binding</b> (toggle above).`,
        exp: `When threads cross the socket boundary, efficiency drops sharply until cross-socket bandwidth is fully utilised.`,
      };
    return {
      sev: "critical",
      what: `<b>${fmt(remotePct, 0)}%</b> of threads access <b>remote socket memory</b> — speedup is only <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads instead of the expected ~${c.x}×.`,
      why: `Threads 13–${c.x} were placed on socket 1 by the OS, but the memory (allocated on socket 0 via first-touch) is a <b>2.5× slower</b> remote DRAM hop away. Inter-socket QPI/Infinity Fabric traffic eats the scaling headroom.`,
      how: `<b>Pin threads to their local socket</b>: <code>OMP_PROC_BIND=close</code>, <code>numactl --cpunodebind=0 --membind=0</code>, or allocate data after forking threads (first-touch on the right socket).`,
      exp: `NUMA-aware binding eliminates the remote-access penalty — efficiency climbs back to the local curve.`,
      secondary: [
        { bottleneck: "bandwidth saturation", note: "Remote DRAM accesses share the inter-socket link, which has lower bandwidth than local memory — adding threads saturates it sooner." },
      ],
    };
  },

  cacheHierarchy(r) {
    const c = r.current, level = r.params.level as string;
    const levelNames: Record<string, string> = { L1: "L1 (32 KB, private per core)", L2: "L2 (512 KB, private per core)", L3: "L3 (24 MB, shared)", DRAM: "DRAM (40 GB/s, shared bus)" };
    const friendly = levelNames[level] ?? level;
    if (level === "L1" || level === "L2")
      return {
        sev: "info",
        what: `${level} cache: data fits in each core's <b>private cache</b> — speedup reaches <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads (${fmt(c.efficiency * 100, 0)}% efficiency), near-linear.`,
        why: `Each core has its own ${level} cache. Adding a thread adds another independent cache with its own local bandwidth — the total BW scales almost linearly with thread count.`,
        how: `Already the best scenario. Switch to <b>L3</b> or <b>DRAM</b> to see shared bandwidth become the bottleneck.`,
        exp: `This is what cache blocking / tiling achieves — keep the hot data in the per-core private cache and scaling stays efficient.`,
      };
    return {
      sev: level === "DRAM" ? "critical" : "warn",
      what: `${friendly}: speedup saturates at only <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads — <b>${fmt(c.efficiency * 100, 0)}% efficiency</b>, far below ideal.`,
      why: `The working set lives in <b>${level}</b>, a ${level === "DRAM" ? "single shared DRAM bus" : "shared L3 ring"}. All threads compete for the same bandwidth; adding more cores doesn't help once that bus is full.`,
      how: `<b>Cache block / tile</b> the computation so the hot data fits in L1 or L2 — each core then has private bandwidth and the scaling curve returns to near-ideal.`,
      exp: `With L1 data, speedup climbs back toward linear — the same thread count, same bus, but each core now brings its own private bandwidth.`,
      secondary: level === "DRAM"
        ? [{ bottleneck: "NUMA effects", note: "On multi-socket systems, threads on the remote socket pay an extra latency penalty to reach DRAM on the other socket." }]
        : [{ bottleneck: "bandwidth saturation", note: "The shared L3 ring has finite bandwidth — threads saturate it before the DRAM bus even becomes relevant." }],
    };
  },

  simdVec(r) {
    const W = r.current.x, layout = r.params.layout as string;
    const eff = r.current.efficiency;
    if (layout === "SoA")
      return {
        sev: eff > 0.75 ? "info" : "warn",
        what: `Structure-of-Arrays layout at ${W} SIMD lanes: <b>${fmt(W, 0)}× throughput</b> over scalar — all lanes fully utilised (${fmt(eff * 100, 0)}% lane efficiency).`,
        why: `SoA stores each field contiguously, so a ${W}-wide SIMD load reads ${W} consecutive values of the same field — all lanes used, zero gather cost.`,
        how: `Already the optimal layout. Switch to <b>AoS</b> to see lane efficiency collapse with wider vectors.`,
        exp: `This is the target: throughput scales linearly with SIMD width when the data layout matches.`,
      };
    return {
      sev: eff < 0.4 ? "critical" : "warn",
      what: `Array-of-Structures layout at ${W} SIMD lanes: only <b>${fmt(Math.sqrt(W), 1)}× throughput</b> (${fmt(eff * 100, 0)}% lane efficiency) — scalar would give 1× at 100% efficiency.`,
      why: `AoS interleaves fields: <code>{x,y,z,x,y,z,…}</code>. Loading the <code>x</code> values for ${W} elements requires a <b>gather</b> with stride equal to the struct size — lanes fetch from non-consecutive addresses and the gather overhead grows with width. At ${W} lanes, only ${fmt(eff * 100, 0)}% of the SIMD throughput is useful work.`,
      how: `<b>Transpose to Structure-of-Arrays</b>: store all <code>x</code> values together, all <code>y</code> values together, etc. The ${W}-wide load becomes a single unit-stride fetch — no gather, all lanes busy.`,
      exp: `With SoA, throughput rises from ${fmt(Math.sqrt(W), 1)}× to the full ${W}× — the vector unit pays for itself.`,
      secondary: [
        { bottleneck: "cache pollution", note: "Gather loads pull in full cache lines but use only one element from each — the unwanted fields evict useful data from L1." },
      ],
    };
  },

  openmpTasks(r) {
    const c = r.current, gran = r.params.granularity as string;
    const ovhPct = gran === "coarse" ? (0.4 / c.time) * 100 : (0.005 * c.x * c.x / c.time) * 100;
    if (gran === "coarse")
      return {
        sev: ovhPct < 5 ? "info" : "warn",
        what: `Coarse tasks: speedup reaches <b>${fmt(c.speedup, 1)}×</b> at ${c.x} threads (${fmt(c.efficiency * 100, 0)}% efficiency) — task overhead only <b>${fmt(ovhPct, 1)}%</b> of runtime.`,
        why: `Large tasks amortize the per-task creation and scheduling cost across a lot of useful work. The runtime overhead is negligible.`,
        how: `Already balanced. Switch to <b>fine</b> granularity to watch task-queue contention overwhelm the computation.`,
        exp: `This is the target: task size large enough that overhead is a rounding error.`,
      };
    return {
      sev: "critical",
      what: `Fine tasks at ${c.x} threads: speedup collapses to <b>${fmt(c.speedup, 1)}×</b> — <b>${fmt(ovhPct, 1)}% of runtime is overhead</b>, not useful work.`,
      why: `Thousands of tiny tasks flood the runtime task queue. At ${c.x} threads, workers spend <b>${fmt(ovhPct, 1)}%</b> of their time creating tasks, stealing work, and synchronising the queue — the actual computation is a small fraction.`,
      how: `<b>Merge tasks into coarser chunks</b>: increase the minimum task size so each task does enough work to pay for its overhead (a good rule of thumb: each task should take ≥ 1000× more time than the scheduler overhead, typically 1–10 µs).`,
      exp: `Coarse tasks bring overhead to <1%, and the speedup tracks near-ideal scaling again.`,
      secondary: [
        { bottleneck: "cache contention", note: "Task-queue steal operations cause cache-line bouncing on the shared deque pointers, adding coherence overhead on top of the scheduling cost." },
      ],
    };
  },

  cudaSharedMem(r) {
    const S = r.current.x, padded = r.params.padding as boolean;
    const eff = r.current.efficiency;
    if (S === 1 || padded)
      return {
        sev: "info",
        what: `${padded ? "Padded: all strides are" : "Stride 1:"} <b>conflict-free</b> — all 32 banks serve different warp lanes in a single cycle, ${fmt(r.bw ?? 0, 0)} GB/s achieved (${fmt(eff * 100, 0)}% efficiency).`,
        why: `Shared memory is divided into 32 banks. When each of the warp's 32 lanes touches a <b>different bank</b>, the access is serviced in one hardware cycle — no serialisation.`,
        how: `Already optimal. ${padded ? "" : "Increase the stride to see bank conflicts serialise the access."} For non-unit strides, the fix is adding <b>1 element of padding</b> per row (toggle "Padding").`,
        exp: `Conflict-free accesses sustain peak shared memory bandwidth regardless of stride.`,
      };
    return {
      sev: eff < 0.2 ? "critical" : "warn",
      what: `<b>${S}-way bank conflict</b>: ${S} warp lanes map to the same bank, so the hardware serialises the access into <b>${S} passes</b> — only <b>${fmt(eff * 100, 0)}%</b> of peak bandwidth.`,
      why: `Shared memory has 32 banks; with a stride of ${S} banks, every ${S}th lane lands on the same bank. The hardware can only serve one access per bank per cycle, so it queues the ${S} conflicting lanes — the warp effectively runs the access ${S} times in serial.`,
      how: `<b>Add 1 element of padding per row</b> to shift each successive row's bank mapping, so stride-${S} access now hits ${S} different banks. Toggle "Padding" to see the fix.`,
      exp: `With padding, even stride-${S} access is conflict-free — peak bandwidth restored.`,
      secondary: [
        { bottleneck: "occupancy loss", note: "Bank conflicts stall warps at the shared memory unit, reducing effective occupancy and the SM's ability to hide global memory latency." },
      ],
    };
  },

  mpiCollective(r) {
    const c = r.current, collective = r.params.collective as string;
    const commPct = r.idlePct ?? 0;
    if (collective === "broadcast" || collective === "reduce")
      return {
        sev: c.efficiency > 0.6 ? "info" : "warn",
        what: `${collective.charAt(0).toUpperCase() + collective.slice(1)} (tree algorithm): speedup <b>${fmt(c.speedup, 1)}×</b> at ${c.x} ranks (${fmt(c.efficiency * 100, 0)}% efficiency) — comm is only <b>${fmt(commPct, 0)}%</b> of runtime.`,
        why: `A tree-based ${collective} takes <b>O(log₂ p)</b> steps, so the cost grows only 5× as you go from 2 to 32 ranks. The compute portion scales down linearly.`,
        how: `This is the efficient pattern. Switch to <b>alltoall</b> to see O(p) communication cost destroy scaling.`,
        exp: `For one-to-all or all-to-one patterns, always prefer broadcast/reduce over alltoall.`,
      };
    if (collective === "allreduce")
      return {
        sev: c.efficiency > 0.5 ? "info" : "warn",
        what: `Allreduce (ring algorithm): speedup <b>${fmt(c.speedup, 1)}×</b> at ${c.x} ranks — moderate comm fraction of <b>${fmt(commPct, 0)}%</b>.`,
        why: `A ring allreduce passes data around the ring in 2(p−1)/p steps, moving nearly the full message volume but amortising it — O(log p) effective cost with good bandwidth utilisation.`,
        how: `Allreduce is usually the right collective for distributed gradient sums. Switch to <b>alltoall</b> to see what poor collective choice looks like.`,
        exp: `Ring allreduce scales well; the bandwidth wall only appears at very high rank counts.`,
      };
    return {
      sev: "critical",
      what: `All-to-all communication: speedup <b>caps at ${fmt(r.peak?.speedup ?? c.speedup, 1)}×</b> and then degrades — at ${c.x} ranks comm overhead is <b>${fmt(commPct, 0)}%</b> of total time.`,
      why: `MPI_Alltoall sends O(p) messages per rank — total traffic grows as <b>p²</b>. At ${c.x} ranks each rank sends to ${c.x - 1} others, and the collective cost grows linearly with rank count. This obliterates any compute speedup.`,
      how: `Redesign the algorithm to use <b>allreduce</b> (O(log p)) or <b>reduce + broadcast</b> wherever a global all-to-all isn't strictly necessary.`,
      exp: `Switching to allreduce drops comm fraction from ${fmt(commPct, 0)}% toward single digits — scaling resumes.`,
      secondary: [
        { bottleneck: "bandwidth saturation", note: "The O(p²) message traffic saturates the network (or shared-memory bus on a single node), starving compute of memory bandwidth." },
      ],
    };
  },

  hybridMpi(r) {
    const c = r.current, tpr = r.params.threadsPerRank as number;
    const isPureMpi = tpr === 1;
    const threads = Math.min(tpr, Math.floor(24 / Math.max(1, c.x)));
    if (!isPureMpi && c.efficiency > 0.6)
      return {
        sev: "info",
        what: `Hybrid ${c.x}×${threads}: speedup <b>${fmt(c.speedup, 1)}×</b> at ${c.x} ranks × ${threads} threads/rank (${fmt(c.efficiency * 100, 0)}% efficiency) — good balance between MPI overhead and OMP scalability.`,
        why: `Fewer MPI ranks means less collective communication. Threads inside each rank share a NUMA-local L3 cache — no inter-socket traffic for the OpenMP work.`,
        how: `Already a good decomposition. Try <b>12 threads/rank</b> (2 ranks × 12 threads, matching NUMA nodes) for even better locality.`,
        exp: `This is the target region: rank count ≈ NUMA nodes, threads/rank ≈ cores/socket.`,
      };
    return {
      sev: isPureMpi ? "warn" : "critical",
      what: isPureMpi
        ? `Pure MPI (1 thread/rank): speedup only <b>${fmt(c.speedup, 1)}×</b> at ${c.x} ranks (${fmt(c.efficiency * 100, 0)}% efficiency) — MPI overhead and NUMA noise limit scaling.`
        : `${c.x} ranks × ${threads} threads: speedup <b>${fmt(c.speedup, 1)}×</b> (${fmt(c.efficiency * 100, 0)}%) — too many ranks for this node's memory topology.`,
      why: isPureMpi
        ? `With 1 thread/rank and ${c.x} ranks, multiple MPI processes share the same NUMA socket and compete for the same L3/memory bus. Communication overhead grows as O(log p) and inter-socket NUMA noise adds a hidden penalty.`
        : `Too many MPI ranks → too much collective communication and ranks that share a NUMA socket (sub-rank affinity groups compete for shared L3).`,
      how: `<b>Match the rank count to the number of NUMA nodes</b> (2 here), then fill each socket with OpenMP threads. Try <b>4 threads/rank</b> (6 ranks × 4 threads) or <b>12 threads/rank</b> (2 ranks × 12 threads).`,
      exp: `Switching to hybrid (e.g. 6 ranks × 4 threads) reduces MPI overhead and keeps threads NUMA-local — efficiency climbs toward 80–90%.`,
      secondary: [
        { bottleneck: "NUMA effects", note: "With many ranks per socket, MPI processes compete for shared L3 and memory bandwidth, amplifying the NUMA penalty." },
      ],
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
      secondary: [
        { bottleneck: "bandwidth saturation", note: "Coherence traffic also saturates the memory bus — even padded code won't scale past the bus limit." },
      ],
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
      secondary: [
        { bottleneck: "cache contention", note: "The lock variable itself causes coherence traffic similar to false sharing." },
      ],
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
      secondary: [
        { bottleneck: "NUMA effects", note: "On multi-socket systems, remote DRAM access compounds the bandwidth wall." },
      ],
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
      secondary: [
        { bottleneck: "synchronization", note: "The implicit barrier at the end of the parallel region forces all threads to wait for the slowest." },
      ],
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
      secondary: [
        { bottleneck: "load imbalance", note: "Non-uniform domain sizes at non-power-of-2 rank counts create residual imbalance." },
      ],
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
      secondary: [
        { bottleneck: "memory latency", note: "Low occupancy means fewer warps to switch to during memory stalls — the SM idles waiting for DRAM instead of hiding latency." },
      ],
    };
  },
  cudaCoalesce(r) {
    const stride = r.current.x, eff = (r.current.efficiency ?? 0) * 100, wasted = 100 - eff;
    const dev = r.smName || "the GPU";
    if (stride === 1)
      return {
        sev: "info",
        what: `Measured on ${dev}: <b>stride 1</b> (coalesced) sustains <b>${fmt(r.bw ?? 0, 0)} GB/s</b> — the warp's 32 reads collapse into one cache line.`,
        why: `Consecutive lanes hit consecutive addresses, so each warp costs a single 128-byte transaction. This is the achievable bandwidth ceiling for this kernel on this card.`,
        how: `This is the target. Increase the <b>stride</b> to measure the bandwidth you lose to scattered access on the same GPU.`,
        exp: `Bandwidth falls off as roughly 1/stride — the strided runs prove it on real silicon.`,
      };
    return {
      sev: eff < 30 ? "critical" : "warn",
      what: `Measured on ${dev}: <b>stride ${stride}</b> drops to <b>${fmt(r.bw ?? 0, 0)} GB/s</b> — only ${fmt(eff, 0)}% of the coalesced peak, ~${fmt(wasted, 0)}% of every fetched line thrown away.`,
      why: `Each warp now spans ${stride} cache lines; the controller still transfers full 128-byte lines but the kernel uses a fraction of each. The wasted bytes are real DRAM traffic you paid for.`,
      how: `Reorganise so the innermost (unit-stride) index maps to <code>threadIdx.x</code> — Structure-of-Arrays layout, or transpose before the kernel.`,
      exp: `Set the stride back to 1 and watch the measured bandwidth recover to the coalesced peak on this exact card.`,
      secondary: [
        { bottleneck: "L2 cache thrashing", note: "Strided access pollutes the L2 with unused portions of each cache line, evicting useful data and increasing DRAM round-trips." },
      ],
    };
  },
  cudaDivergence(r) {
    const D = r.current.x, eff = (r.current.efficiency ?? 0) * 100, slow = r.factor ?? 1 / (r.current.efficiency || 1);
    const dev = r.smName || "the GPU";
    if (D === 1)
      return {
        sev: "info",
        what: `Measured on ${dev}: <b>uniform</b> control flow runs the warp in one pass at full throughput (baseline ${fmt(r.current.time, 2)} ms).`,
        why: `Every lane takes the same branch, so the warp never replays — all 32 lanes do useful work together. This is the convergent baseline.`,
        how: `This is the target. Increase the <b>divergent paths</b> to measure the serialization penalty on the same card.`,
        exp: `Runtime grows almost linearly with the number of paths the warp is forced to take.`,
      };
    return {
      sev: eff < 30 ? "critical" : "warn",
      what: `Measured on ${dev}: <b>${D} divergent paths</b> run <b>${fmt(slow, 1)}× slower</b> than uniform — only ~${fmt(eff, 0)}% of lanes active per pass.`,
      why: `The warp shares one program counter, so the hardware serializes the ${D} branch paths into ${D} masked passes. The measured slowdown is the cost of those idle lane-cycles on real silicon.`,
      how: `Restructure so a whole warp takes one branch (sort/bin by condition), or go branchless with predication so there's nothing to serialize.`,
      exp: `Reduce the paths back toward 1 and the measured time drops as the warp re-converges.`,
      secondary: [
        { bottleneck: "instruction cache pressure", note: "Highly divergent warps execute many code paths, increasing I-cache footprint and potentially causing I-cache misses on smaller SMs." },
      ],
    };
  },
  cudaAtomics(r) {
    const T = r.current.x, eff = (r.current.efficiency ?? 0) * 100, slow = r.factor ?? 1 / (r.current.efficiency || 1);
    const dev = r.smName || "the GPU";
    if (T === 1)
      return {
        sev: "critical",
        what: `Measured on ${dev}: funneling every thread's <code>atomicAdd</code> through <b>one address</b> runs <b>${fmt(slow, 1)}× slower</b> than spreading the updates — pure serialization.`,
        why: `All atomic updates to a single location queue at one L2 atomic unit. The measured slowdown is thousands of threads waiting their turn on real silicon.`,
        how: `Accumulate into per-block <code>__shared__</code> counters (or per-bin private counters), then one global <code>atomicAdd</code> per block — hierarchical reduction.`,
        exp: `Increase the targets and the measured time drops sharply until contention disappears.`,
        secondary: [
          { bottleneck: "memory latency", note: "Serialized atomics stall warps waiting for the L2 atomic unit, reducing occupancy and preventing latency hiding." },
        ],
      };
    return {
      sev: eff > 60 ? "info" : "warn",
      what: `Measured on ${dev}: <b>${T} targets</b> reach <b>${fmt(eff, 0)}%</b> of the best throughput${slow > 1.5 ? ` (${fmt(slow, 1)}× off)` : ""} — the atomic traffic now spreads across many units.`,
      why: `With the updates distributed, independent atomic units run concurrently instead of queuing. Throughput keeps climbing until memory bandwidth or launch overhead caps it.`,
      how: `${eff > 80 ? "Well spread already" : "Spread wider"}; for a real total, finish with a shared-memory/tree reduction so the global combine is nearly free.`,
      exp: `Collapse back toward one target and the measured time climbs steeply as contention returns.`,
    };
  },
  numaEffects:     (r) => ({ ...Explain.numaEffects(r),     what: `<b>[Measured]</b> ` + Explain.numaEffects(r).what }),
  cacheHierarchy:  (r) => ({ ...Explain.cacheHierarchy(r),  what: `<b>[Measured]</b> ` + Explain.cacheHierarchy(r).what }),
  simdVec:         (r) => ({ ...Explain.simdVec(r),         what: `<b>[Measured]</b> ` + Explain.simdVec(r).what }),
  openmpTasks:     (r) => ({ ...Explain.openmpTasks(r),     what: `<b>[Measured]</b> ` + Explain.openmpTasks(r).what }),
  cudaSharedMem:   (r) => ({ ...Explain.cudaSharedMem(r),   what: `<b>[Measured]</b> ` + Explain.cudaSharedMem(r).what }),
  mpiCollective:   (r) => ({ ...Explain.mpiCollective(r),   what: `<b>[Measured]</b> ` + Explain.mpiCollective(r).what }),
  hybridMpi:       (r) => ({ ...Explain.hybridMpi(r),       what: `<b>[Measured]</b> ` + Explain.hybridMpi(r).what }),
};

/**
 * Compare model and measured results and return a plain-English explanation of
 * why they differ. Returns `null` when the two are within 10%.
 */
export function explainDivergence(
  model: ExperimentResult,
  measured: ExperimentResult,
): string | null {
  const ms = model.current.speedup;
  const es = measured.current.speedup;
  if (!ms || !es) return null;

  const ratio = es / ms;
  // Within 10% — close enough
  if (ratio >= 0.9 && ratio <= 1.1) return null;

  // GPU experiments: check occupancy divergence
  const isGpu =
    model.experimentId.startsWith("cuda") ||
    measured.experimentId.startsWith("cuda");
  if (isGpu) {
    return "The CUDA Occupancy API reports achievable occupancy, but actual occupancy depends on memory latency hiding and warp scheduling at runtime.";
  }

  // Measured is SLOWER than model by >20%
  if (ratio < 0.8) {
    const isBandwidth =
      model.experimentId === "bandwidth" ||
      measured.experimentId === "bandwidth";
    if (isBandwidth) {
      return "The model assumes peak DRAM bandwidth is always available. In practice, other processes and the OS compete for memory bandwidth.";
    }
    if (measured.current.x > 12) {
      return "Likely causes: OS scheduler jitter, thermal throttling under sustained load, or NUMA remote accesses on a multi-socket system.";
    }
    return "Hardware noise, thermal management, and cache effects not captured by the analytical model account for the gap.";
  }

  // Measured is FASTER than model by >20%
  if (ratio > 1.2) {
    return "The model may underestimate hardware capabilities — modern CPUs aggressively prefetch and turbo-boost beyond the model's reference profile.";
  }

  // Between 10-20% divergence in either direction — modest gap, no specific diagnosis
  return "Hardware noise, thermal management, and cache effects not captured by the analytical model account for the gap.";
}
