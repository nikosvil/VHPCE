# 03 — Flagship MVP Spec: "Why Parallel Code Gets Slower"

The blueprint names this as the first flagship demo and says it **must be visually
exceptional**. It teaches the most counter-intuitive lesson in parallel programming: adding
threads can make code *slower*. Four experiments, each a self-contained story with a "broken"
and a "fixed" mode, each driven by a real model (not faked numbers).

## Shared screen layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Experiment tabs:  [False Sharing] [Synchronization] [Bandwidth] [Imbalance]│
├──────────────┬───────────────────────────────────────┬──────────────────────┤
│  CONTROLS    │            VISUALIZATION (3D)          │   METRICS            │
│  threads ▢   │   live R3F scene for this experiment   │   time, speedup,     │
│  fix on/off  │   (cache lines / timeline / lanes /    │   efficiency, the    │
│  work size   │    gantt)                              │   experiment's key   │
│  [Run]       │                                        │   counter            │
├──────────────┴───────────────────────────────────────┴──────────────────────┤
│  SCALING CURVE (D3): speedup & efficiency vs thread count, ideal line ghosted │
├───────────────────────────────────────────────────────────────────────────┤
│  EXPLANATION  what happened · why · how to fix · expected gain   [Ask the AI ▸]│
└───────────────────────────────────────────────────────────────────────────┘
```

Dark, scientific palette. The "fix on/off" toggle is the emotional core of every experiment:
flip it and watch the animation calm down and the curve straighten toward ideal.

## Experiment 1 — False Sharing

**Story:** N threads each increment their own counter, but the counters sit in one cache line.
Cores fight over that line; performance collapses. Pad each counter to its own line → fixed.

- **Controls:** thread count (1–16), padding on/off, iterations.
- **Visualization:** a row of 64-byte cache lines (R3F). In broken mode all counters glow in
  one line and an "ownership" highlight ping-pongs between cores on every write (coherence
  traffic). In fixed mode each counter owns a line; no ping-pong.
- **Key metric:** coherence invalidations / sec; runtime.
- **Model:** false-sharing coherence cost (see [04-performance-models.md](04-performance-models.md) §3).
- **Explanation (broken):** *What:* runtime grows with threads instead of shrinking. *Why:*
  false sharing — independent variables share a cache line, forcing the coherence protocol to
  bounce the line between cores. *How:* pad/align each thread's data to 64 bytes. *Expected:*
  near-linear speedup restored.

## Experiment 2 — Synchronization Overhead

**Story:** sum an array three ways — (a) `critical` section, (b) `atomic`, (c) per-thread
partials + final reduction. Watch serialization eat the parallelism.

- **Controls:** thread count, mode {critical | atomic | reduction}, work per iteration.
- **Visualization:** a thread timeline (Gantt, R3F or Canvas). In `critical` mode threads
  queue at a lock — long serialized bars; in `reduction` mode bars run in parallel with a
  short merge at the end.
- **Key metric:** % time serialized; runtime.
- **Model:** critical-section serialization + barrier cost (§4).
- **Explanation:** *Why:* the critical section serializes the hot loop; Amdahl caps speedup at
  1/serial-fraction. *How:* accumulate per-thread, reduce once. *Expected:* speedup tracks the
  reduction model's near-ideal curve.

## Experiment 3 — Memory Bandwidth Saturation

**Story:** a STREAM-triad `a[i] = b[i] + s*c[i]`. It's memory-bound, so beyond a few threads
the DRAM bus saturates and extra threads add nothing.

- **Controls:** thread count, array size (sets working set vs cache), arithmetic intensity.
- **Visualization:** a **roofline plot** (D3, log-log) with the kernel's operating point, plus
  a "bandwidth vs threads" saturating curve; a lane view showing memory channels maxing out.
- **Key metric:** achieved GB/s vs peak; achieved GFLOP/s vs roofline ceiling.
- **Model:** bandwidth-saturation curve + roofline (§2, §5).
- **Explanation:** *Why:* the kernel is memory-bound (low arithmetic intensity); past k threads
  the memory subsystem is saturated and threads compete for the same bus. *How:* raise
  arithmetic intensity (tiling/fusion) or reduce traffic — not add threads. *Expected:* the
  operating point moves right toward the compute ceiling.

## Experiment 4 — Load Imbalance

**Story:** a triangular loop (`for j in 0..i`) with static scheduling gives early threads
little work and late threads a lot; everyone waits for the slowest. Dynamic/guided fixes it.

- **Controls:** thread count, schedule {static | dynamic | guided}, imbalance shape.
- **Visualization:** per-thread Gantt with idle tails clearly shown; in dynamic mode the tails
  shrink as chunks are stolen.
- **Key metric:** load-imbalance factor = max_thread_time / mean_thread_time; runtime.
- **Model:** runtime = max over threads of assigned work (§4).
- **Explanation:** *Why:* static scheduling assigned unequal work; total time = the slowest
  thread, so cores idle. *How:* `schedule(dynamic)` / `guided`. *Expected:* imbalance factor → ~1.

## Acceptance criteria (the demo is "done" when)

1. Runs by opening `index.html` — no install, no network.
2. For every experiment, flipping the fix changes **animation + metrics + scaling curve +
   explanation** together, and the numbers obey the documented model (no magic constants
   without a formula behind them).
3. The scaling curve always ghosts the *ideal* line so the gap is the lesson.
4. `prefers-reduced-motion` is respected; the charts carry the full story without animation.
5. It looks good enough to screenshot for a landing page.
