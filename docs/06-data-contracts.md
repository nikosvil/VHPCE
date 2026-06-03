# 06 — Data Contracts: `ProfileResult`

This is the seam the whole platform pivots on (see [01-architecture.md](01-architecture.md) §1).
One schema, two producers (model now, real profilers later), many consumers (every visualizer,
both explainers, the benchmark UI). It lives in `packages/profile-schema` as a JSON Schema with
generated TypeScript types, a `zod` validator (frontend) and a mirrored Pydantic model
(backend), so producers and consumers cannot drift.

## Design rules

1. **Producer-agnostic.** A consumer must never branch on whether data was modeled or measured —
   only on the `source` field for labeling/disclaimers.
2. **Optional sections.** Not every run has GPU or MPI data. Sections are nullable; consumers
   render what's present.
3. **Self-describing units.** Every numeric field carries its unit in the field name or schema
   (`_gbps`, `_ns`, `_gflops`) — no ambiguity.
4. **Sweeps are first-class.** Scaling is the core lesson, so a result can carry a sweep over a
   parameter (threads/ranks/size), each point a full sub-result.

## Shape (TypeScript view)

```ts
type Source = "model" | "measured";

interface ProfileResult {
  schemaVersion: 1;
  source: Source;
  referenceMachine: string;          // e.g. "ref/generic-8core" or "node-aurora-gpu01"
  meta: {
    language: "c" | "cpp" | "fortran" | "python" | "cuda" | string;
    model: "openmp" | "mpi" | "cuda" | "serial" | string;
    sourceHash: string;              // identifies the code/params that produced this
    experimentId?: string;          // links to a flagship experiment when applicable
    timestamp: string;              // ISO 8601
  };

  timing: {
    wallSeconds: number;
    parallelFraction?: number;       // f, when known (drives Amdahl ghost)
  };

  // The scaling sweep — each point is a run at a given degree of parallelism.
  sweep?: {
    axis: "threads" | "ranks" | "problemSize";
    points: Array<{
      x: number;                     // threads / ranks / size
      wallSeconds: number;
      speedup: number;               // vs x=1 baseline
      efficiency: number;            // speedup / x
    }>;
  };

  roofline?: {
    arithmeticIntensity_flopPerByte: number;
    achieved_gflops: number;
    peakCompute_gflops: number;      // ceiling
    peakBandwidth_gbps: number;      // ceiling
  };

  counters?: {
    achievedBandwidth_gbps?: number;
    bandwidthUtilization?: number;   // 0..1 of peak
    l1MissRate?: number; l2MissRate?: number; l3MissRate?: number;
    ipc?: number;
    coherenceInvalidationsPerSec?: number;  // false sharing signal
    vectorizationEfficiency?: number;       // 0..1
  };

  threadsTimeline?: Array<{
    threadId: number;
    intervals: Array<{
      kind: "compute" | "wait" | "barrier" | "sync" | "idle" | "comm";
      startSeconds: number;
      endSeconds: number;
    }>;
  }>;

  imbalance?: { factor: number };    // max_t / mean_t, ≥ 1

  // MPI (P3): communication events for the animator.
  mpi?: {
    ranks: number;
    events: Array<{
      op: "send" | "recv" | "halo" | "reduce" | "bcast" | "alltoall";
      from: number; to: number | "all";
      bytes: number; startSeconds: number; endSeconds: number;
    }>;
    commFraction: number;            // 0..1 of wall time in communication
  };

  // GPU (P4): occupancy + stalls for the simulator.
  gpu?: {
    occupancy: number;               // 0..1
    registersPerThread: number;
    sharedMemPerBlock_bytes: number;
    warpDivergence: number;          // 0..1
    memoryCoalescing: number;        // 0..1
    occupancyLimiter: "registers" | "sharedMem" | "blockSize" | "none";
  };

  // Pre-computed findings travel with the result so the LLM can be grounded
  // even server-side; the deterministic engine can also (re)compute them client-side.
  diagnostics?: Array<{
    code: string;                    // e.g. "FALSE_SHARING", "MEM_BOUND_SATURATION"
    severity: "info" | "warn" | "critical";
    evidence: Array<{ metric: string; value: number; threshold: number }>;
  }>;
}
```

## Who produces / consumes what

| Section | Producer A (model) | Producer B (real) | Primary consumer |
|---------|--------------------|-------------------|------------------|
| `sweep` | Amdahl/BW/imbalance formulas | repeated runs at each `x` | scaling curve (D3) |
| `roofline` | roofline model | LIKWID / counters | roofline plot (D3) |
| `counters` | model constants | perf / LIKWID / PAPI | metrics panel |
| `threadsTimeline` | synthesized from model | Score-P / TAU trace | timeline (R3F/Canvas) |
| `mpi` | comm model | mpiP / Score-P | MPI animator |
| `gpu` | occupancy model | Nsight Compute | occupancy simulator |
| `diagnostics` | `packages/explain` rules | same rules, on measured data | both explainers |

## Versioning

`schemaVersion` is mandatory. Breaking changes bump it; `packages/profile-schema` keeps an
up-converter so older saved runs still render. Because the schema is generated to both TS and
Pydantic from one source, the gateway rejects any payload that fails validation before it
reaches a consumer.
