# 02 — Phased Roadmap

The blueprint defines Phases 1–5. This roadmap keeps that mapping but inserts a **Phase 0**:
a zero-build flagship that exists because Node isn't installed yet and because the blueprint
demands an immediately impressive visual artifact. Each phase below lists concrete
deliverables and a **Definition of Done (DoD)** — the phase is not "done" until the DoD is
demonstrably true.

Implementation priority order is inherited from the blueprint §14:
*profiling → AI explanation → visualization → benchmarking → OpenMP → MPI → GPU → apps →
gamification → cloud.* Notice the early phases front-load the **seam** and the **models** so
that profiling/explanation/viz are real from the start (model-sourced), and later phases
swap in measured data and add domains.

---

## Phase 0 — Zero-build flagship (no Node, runs by opening a file)

**Goal:** prove the core loop — *params → model → visualization → explanation* — and make it
visually exceptional, on this Windows machine, today.

Deliverables:
- `apps/flagship-zero-build/index.html` — single self-contained page, **Canvas 2D + D3 (CDN)**,
  no bundler, runs by double-click (Three.js hero scenes deferred to P1's web app).
- A TS-free port of the four experiments from
  [03-flagship-mvp-spec.md](03-flagship-mvp-spec.md): false sharing, synchronization,
  bandwidth saturation, load imbalance.
- `perf-models` formulas inlined (later extracted into the package).
- Deterministic explanations for each experiment (the "Both" default half).

**DoD:** open the file → toggle the "fix" on any experiment → the 3D animation **and** the
metrics **and** the written explanation all change together in a physically consistent way,
with no install and no network.

---

## Phase 1 — Platform shell + real toolchain

**Goal:** install Node, stand up the monorepo, and rehome the flagship inside the product.

Deliverables:
- Node.js + pnpm + Turborepo monorepo per [01-architecture.md](01-architecture.md) §3.
- `apps/web` Next.js shell: dark scientific theme, navigation, lesson scaffold.
- `packages/profile-schema` (JSON Schema + TS types + zod) — the seam, formalized.
- `packages/perf-models` extracted from P0, unit-tested against analytic limits.
- `packages/explain` deterministic engine with the full rule set.
- `packages/viz` reusable R3F scenes + D3 charts; flagship rebuilt on these.
- Monaco editor wired in (edit params/code, no remote execution yet).
- **Optional LLM panel** ("Ask the AI") — the second half of "Both"
  ([05-ai-explanation-layer.md](05-ai-explanation-layer.md)).

**DoD:** the flagship runs inside `apps/web`, identical experiments, now on shared packages;
LLM panel answers a follow-up question when a key is supplied and degrades gracefully without.

---

## Phase 2 — Real *local* execution backend (OpenMP / C / C++)

**Goal:** introduce **Producer B** — measured `ProfileResult`s, running on this laptop via WSL2.

Deliverables:
- `services/api` (FastAPI) + `services/runner` + Redis/Arq queue; runs in WSL2, optionally
  containerized via Docker Desktop.
- Profiler parsers viable locally: **wall-clock timing + thread sweeps** and **cachegrind**
  (simulated cache misses / instruction counts) → `ProfileResult`. (`perf`/LIKWID parsers are
  written too but only light up on bare-metal/cloud — see Phase 5.)
- Benchmark sweeps on 24 cores → strong/weak scaling, speedup, efficiency curves — *this
  machine's real numbers*.
- A toggle in the UI: "Model" vs "Measured" source for an experiment (same visuals).

**DoD:** a student submits an OpenMP snippet, gets a **measured** `ProfileResult` from WSL2, and
the existing visualizers + explainers render it with zero changes.

**Status (2026-06-03) — core achieved.** The flagship now has a working **Model | Measured**
toggle. `services/runner` (stdlib HTTP, not FastAPI yet) compiles and runs the four experiments
as real OpenMP kernels on 24 cores and returns measured sweeps; the existing charts, metrics, and
deterministic explanations render measured data unchanged — the seam is proven with real numbers.
**Update (P2 core done):** arbitrary user-submitted code now runs too — a Monaco **Code Playground**
at `/playground` compiles and benchmarks any OpenMP C in a **locked-down Docker container**
(`infra/docker/runner.Dockerfile`: `--network none --cap-drop ALL --read-only`, memory/PID/time
limits, source via stdin) through the runner's `/run-code` endpoint, and renders the measured
scaling + a generic reading. The playground also offers opt-in **cachegrind** cache-miss profiling (D1/LLd miss rates +
instruction count, via `--cache-sim=yes` in the container). **P2 is complete for local use.**

**Cloud Phase (2026-06-04) — landed.** The deferred **FastAPI gateway + Redis + Arq job queue**
is built (`services/api` + `infra/docker/compose.yml`). Per a user decision the backend is
**unified**: the stdlib runner is retired and *both* producers — the flagship's fixed kernels
(`vhpce-bench`) and arbitrary Playground code (`vhpce-runner`) — now `POST /api/jobs` and poll
`GET /api/jobs/{id}`. The Arq worker runs `max_jobs=1` (one container at a time → clean timing) and
mounts the host Docker socket to spawn the sandbox siblings; bench results are cached in Redis.
This is the cloud-scale groundwork from Phase 5, brought forward — true multi-user autoscaling
(K8s Jobs) and PMU counters remain the bare-metal/cloud upgrade.

---

## Phase 3 — MPI

Deliverables: OpenMPI image; rank sweeps; mpiP/Score-P trace parsing; the **MPI communication
animator** (halo exchange, reductions, broadcasts, all-to-all); latency-vs-bandwidth view.
**DoD:** a halo-exchange example animates real rank communication and explains comm-dominated
scaling.

## Phase 4 — GPU / CUDA (local on the RTX 5060)

Deliverables: CUDA toolkit in WSL2 (GPU already visible via passthrough); Nsight Systems parsing
(timeline, occupancy), Nsight Compute where WSL2 supports it; **occupancy simulator** (warps,
divergence, coalescing, shared memory, register pressure); PCIe transfer view.
**DoD:** a CUDA kernel run on the RTX 5060 reports occupancy with an explanation of the limiter
(e.g., register pressure) and a suggested fix.

## Phase 5 — Domains, gamification, classrooms, cloud scale

Deliverables: engineering modules (FEM, FDTD, CFD, sparse solvers, FFT, multigrid, stencils)
with interactive domain decomposition / Yee grids / convergence plots; optimization challenges,
scores, badges, leaderboards; collaborative classrooms + LMS hooks; Kubernetes autoscaling and
the Slurm bridge for real clusters. These bare-metal/cloud nodes also unlock **true PMU counters**
(`perf`/LIKWID/PAPI), upgrading measured `ProfileResult`s beyond what WSL2 can provide locally.
**DoD:** an instructor runs a class through a "speed up this code" challenge backed by real
cluster execution.

---

## What we are explicitly NOT doing early (and why)

- **No paid cloud/cluster infra until P5.** Not needed — WSL2 covers real CPU *and* GPU
  execution locally through P4; the cloud is only for scale and true PMU counters. Models
  cover P0/P1 faithfully.
- **No "support every language at once."** Execution lands per-toolchain (OpenMP first) because
  each profiler parser is real work. The *schema* supports all of them from day one.
- **No gamification/LMS before the core loop is excellent.** The blueprint warns the platform
  fails if the core experience is boring; we earn the extras.
