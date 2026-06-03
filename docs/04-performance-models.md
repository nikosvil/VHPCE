# 04 — Performance Models (the honest core)

These are the formulas behind **Producer A** (`packages/perf-models`). They let us show real,
defensible performance behavior without real hardware. Every number on screen traces back to
one of these — there are no magic constants. Each model is labeled in the `ProfileResult` as
`source: "model"` and references a named reference machine (§6) so it can later be replaced or
calibrated by measured data (`source: "measured"`).

> Modeling honesty rule: a model is allowed to be *approximate* but never *arbitrary*. If we
> can't write the formula, we don't draw the curve.

## 1. Amdahl & Gustafson (the speedup ceilings)

- **Amdahl (fixed problem):** `S(p) = 1 / ( (1 − f) + f/p )`, where `f` = parallelizable
  fraction, `p` = workers. Used to ghost the ceiling and to bound the synchronization
  experiment (serial fraction = lock-held fraction).
- **Gustafson (scaled problem):** `S(p) = p − α(p − 1)`, `α` = serial fraction. Used for the
  weak-scaling view.
- **Efficiency:** `E(p) = S(p) / p`. Drives the efficiency curve everywhere.

## 2. Roofline

`P_attainable(AI) = min( P_peak , AI × BW_peak )`

- `AI` = arithmetic intensity (FLOP / byte). `P_peak` = compute ceiling (GFLOP/s).
  `BW_peak` = memory bandwidth ceiling (GB/s). Ridge point at `AI* = P_peak / BW_peak`.
- A kernel left of the ridge is **memory-bound**; right of it, **compute-bound**. The
  bandwidth experiment places the STREAM triad on the memory-bound side and shows moving the
  operating point.

## 3. False sharing (cache-line coherence cost)

Independent variables in one 64 B line force the cache-coherence protocol (MESI-style) to
invalidate the line on every write from a different core. Model the runtime as compute time
plus coherence penalty:

```
T(p)        = T_compute(p) + T_coherence(p)
T_compute(p)= W / p                                 # ideal parallel work
T_coherence(p) ≈ writes_per_thread × C_inval × g(p) # ping-pong cost
g(p)        = (p − 1)/p   for vars sharing a line    # contention grows with sharers
```

`C_inval` ≈ remote-cache/line-transfer latency from the reference machine. With padding,
`vars_per_line → 1`, so `T_coherence → 0` and `T(p) → W/p` (near-ideal). This reproduces the
hallmark: *more threads, slower runtime* in broken mode.

## 4. Synchronization & load imbalance

- **Critical section / lock:** serialized fraction `f_s = (lock-held time) / (iteration time)`.
  Feed `f_s` into Amdahl → the speedup ceiling collapses as `f_s` rises. Lock contention adds a
  queueing term `T_queue ≈ (p − 1) × t_crit` for the fully-contended case.
- **Barrier:** `T_barrier(p) ≈ c_b × log2(p)` (tree barrier) — small but non-zero, shown when
  barriers are frequent.
- **Load imbalance:** `T(p) = max_t( work_t )` rather than `mean_t(work_t)`. Imbalance factor
  `I = max_t / mean_t ≥ 1`. Static schedule on a triangular loop gives `work_t ∝ t`, so
  `I → ~2`; dynamic/guided drives `I → ~1` (minus a small scheduling overhead per chunk).

## 5. Memory-bandwidth saturation

Effective bandwidth rises with threads then saturates at the bus limit:

```
BW_eff(p) = BW_peak × p / (p + p_half)
```

`p_half` = threads at which half of peak bandwidth is reached (reference-machine constant).
For a memory-bound kernel moving `Q` bytes:

```
T(p) = Q / BW_eff(p)
```

As `p ≫ p_half`, `BW_eff → BW_peak` and `T` flattens — extra threads stop helping. This is the
"saturates after k threads" story, and the speedup curve bends away from ideal exactly there.

## 6. Reference machine profiles

Models are parameterized by a named profile so the curves are concrete and swappable. Default
`ref/generic-8core`:

| Parameter | Value | Used by |
|-----------|-------|---------|
| cores | 8 | all |
| cache line | 64 B | false sharing |
| L1/L2/L3 | 32 KB / 256 KB / 16 MB | working-set effects |
| DRAM `BW_peak` | 40 GB/s | roofline, bandwidth |
| `p_half` | 3 | bandwidth saturation |
| compute `P_peak` | 200 GFLOP/s (FMA, AVX2) | roofline |
| `C_inval` | ~80 ns | false sharing |
| `t_crit` (lock) | ~50 ns | synchronization |

These are documented, not hidden. When Producer B (real profilers) comes online, a measured
profile replaces the reference profile and the same formulas calibrate to the real machine —
or the model is bypassed entirely in favor of measured counters.

## 7. Validation

`packages/perf-models` ships unit tests asserting analytic limits, e.g.: `S(1) = 1`;
`S(p) → 1/(1−f)` as `p → ∞`; false-sharing `T` is monotone *increasing* in `p` when
`vars_per_line > 1` and monotone *decreasing* when padded; `BW_eff` monotone, bounded by
`BW_peak`. Tests guard against the models silently becoming arbitrary.
