# VHPCE — Progress Snapshot

_Last updated: 2026-06-22 · branch `main`_

**Visual HPC for Engineers** — an interactive performance laboratory.
**Phases P0–P4 + the Cloud Phase + the engagement & GPU-lesson layer are complete; P5 domain labs underway.**
This file is the resume point: what's done, how to run it, what changed, and next steps.

> The design contract lives in `docs/` (`01-architecture.md` … `06-data-contracts.md`) and the
> running decisions log is in `README.md`. This file is the operational summary.

---

## 1. Status by phase

| Phase | Scope | Status |
|------|-------|--------|
| **P0** | Zero-build flagship "Why Parallel Code Gets Slower" (Canvas2D + D3) | ✅ done (`apps/flagship-zero-build/index.html`) |
| **P1** | Next.js monorepo; flagship on shared packages; Model\|Measured; 3D hero scenes; Ask-the-AI | ✅ done |
| **P2** | Code Playground (arbitrary OpenMP C in a locked-down Docker container) + cachegrind | ✅ done |
| **Cloud** | FastAPI gateway + Redis/Arq job queue; both producers async submit/poll; stdlib runner retired | ✅ done |
| **P3** | MPI execution (`{kind:"mpi"}` → `vhpce-mpi`) + "MPI Halo Exchange" experiment (strong vs weak) | ✅ done |
| **P4** | GPU/CUDA (`{kind:"cuda"}` → `vhpce-cuda`, RTX 5060) + GPU Occupancy, Coalescing, Divergence, Atomics | ✅ done |
| **Engagement** | Intro, Start (predict-before-you-run), Compare, Play (Race + Quiz + Sandbox + **Kernel Tuner** + Badges), Reference Essentials + ~228 entries (adds CUDA), Playground predict + diagnostics + thread-count explorer, badge + streak system | ✅ done |
| **Rollout** | LICENSE (AGPL-3.0), rewritten README, SETUP.md, CI (GitHub Actions), devcontainer (Codespaces) | ✅ done |
| P5 | Engineering domain modules, classrooms/LMS, K8s autoscaling, true PMU counters | 🔄 in progress — Domain Labs hub (`/modules`) live: Wave, N-Body, GEMM, FFT, SpMV, Multigrid |

### The core idea that holds it together
One **`ProfileResult` seam** (`@vhpce/profile-schema`). Two producers — the in-browser
**model** (`@vhpce/perf-models`) and **measured** runs (the gateway → Docker containers) — feed the
same charts, metrics, and deterministic explanations. Swapping the data source changes nothing
downstream. As of the Cloud Phase, *both* measured producers (fixed flagship kernels and arbitrary
Playground code) go through one async backend; **Model mode is the only offline path.**

---

## 2. What's built (concise)

- **Introduction** (`/intro`) — the front door: the one big idea (model vs. measured), and a
  guided map of every section with what it does and how long it takes. No backend.
- **Start Here** (`/start`) — three live runs on real cores that tell the whole story in five
  minutes: parallel works (`hello`), the naive sum doesn't scale (atomic synchronization
  bottleneck), and the one-line fix (reduction) does. Each step is a **predict-before-you-run**
  — guess the speedup before hitting Run, then compare to the measured result.
- **Learn the Basics** (`/learn`) — a beginner on-ramp (no backend, offline): six animated concept
  cards for **how OpenMP & MPI actually work** — fork–join, parallel-for loop splitting, shared vs
  private (race→reduction), MPI ranks & separate memory, send/recv, and collectives (bcast/scatter/
  gather/reduce). Each has a Canvas2D animation, an annotated code snippet, play/step controls, and a
  plain-language caption, plus a key-terms glossary. Pure teaching (no code executed) — the on-ramp
  *before* the "why it gets slower" Flagship. Each card **links onward** (the learning journey):
  OpenMP cards → a runnable Playground example (`/playground?ex=…`), MPI cards → the measured
  Flagship experiment (`/?exp=mpiHalo`).
- **Command Reference** (`/reference`) — a searchable, filterable library of **OpenMP, MPI, OpenACC &
  CUDA** directives/commands (~228 entries: OpenMP 72 / MPI 59 / OpenACC 27 / **CUDA 24** — incl.
  OpenMP `target` offloading + advanced (metadirective/declare variant) + runtime env; MPI one-sided
  RMA (+ shared windows), parallel I/O, neighborhood collectives, persistent requests, graph
  topologies, dynamic processes; **CUDA**: kernel launch (`__global__`/`__device__`/`launch_bounds`),
  memory management (`cudaMalloc`/`cudaMemcpy`/managed/pinned/async), shared memory + bank conflicts,
  synchronization (`__syncthreads`/`__syncwarp`/atomics), warp primitives (`__shfl_sync`), streams +
  events, memory model (constant cache, coalescing), and performance utilities (occupancy API, device
  props, error handling)), each with a "smart" looping animation, syntax, a plain-English summary, a
  "good to know" note, hover-glossary `<Term>`s, related links (cross-tech navigation resets the
  filter), and a "▶ Run in the Playground" link where it maps to a runnable example.
  **Archetype-driven**: **14** reusable Canvas animations (`reference/archetypes.ts`) + a data table
  (`reference/entries.ts`) where each entry maps to an archetype + params, so coverage grows by adding
  *data*, not code. Six tech filter tabs: OpenMP · MPI · OpenACC · CUDA · Slurm · pthreads.
  Deep-linkable via `/reference?id=<entryId>`. A **C | Fortran** toggle shows each signature in both
  languages. A **★ Essentials** filter narrows the full library to the must-knows for newcomers
  (11 CUDA essentials included).
- **Heat Lab** (`/lab`) — an interactive **2-D heat-equation** mini-lab (P5 domain module): an explicit
  finite-difference (FTCS Jacobi) stencil on a 128×128 grid, animated as a heatmap (offline, no
  backend). Controls: play/step/reset, diffusivity α (with a visible α≤0.25 stability cliff), speed.
  A **domain-decomposition overlay** (none / OpenMP / MPI / GPU) shows how the same stencil splits —
  OpenMP shared rows, MPI blocks + **halo rings** (links to the MPI Halo Exchange experiment), GPU
  tiles. Picking a model also swaps in the **actual stencil code** for it (serial → `omp parallel for`
  → `MPI_Sendrecv` halo exchange → CUDA kernel) with links to the matching Reference entry + Flagship
  experiment — the direct tie from the picture to real OpenMP/MPI/GPU code. A live **convergence
  plot** (log-scale max |Δu| per step) shows the solver converging — and **diverging** (red) when α>0.25.
- **Domain Labs** (`/modules`) — a **P5 engineering-domain hub** (offline, no backend): six
  interactive mini-labs, each with a tab-based view, a live Canvas animation loop, and
  domain-decomposition code snippets for serial / OpenMP / MPI / GPU parallel models:
  - **🌊 Wave (FDTD)** — 2-D FDTD wave solver. Controls: source type, Courant number, damping.
  - **🌌 N-Body Gravity** — N-body gravitational simulation (32 particles, Barnes–Hut model).
  - **🔢 Matrix Multiply (GEMM)** — C = A × B: naïve stride-N vs cache-tiled, arithmetic intensity readout.
  - **📊 FFT** — Cooley-Tukey radix-2: butterfly diagram animation, time/frequency domain plots,
    log2(N) stages with N/2 parallel butterflies per stage.
  - **🔗 Sparse SpMV** — CSR sparse matrix-vector multiply: sparse matrix visualization with access
    lines, nnz-per-worker bar chart exposing load imbalance (banded vs power-law patterns).
  - **🔻 Multigrid** — V-cycle solver: multi-level grid visualization with error coloring,
    convergence plot comparing Jacobi-stall vs O(N) multigrid, restrict/prolongate animation.
  The `/modules` hub links to the existing `/lab` (Heat Equation) as a seventh domain mini-lab.

- **Flagship** (`/`) — **sixteen experiments**: the original nine (false sharing, synchronization,
  bandwidth saturation, load imbalance, MPI halo exchange, GPU occupancy, GPU coalescing, GPU
  divergence, GPU atomics) plus **seven new** (NUMA Effects, Cache Hierarchy, SIMD Vectorization,
  OpenMP Tasks, GPU Shared Memory, MPI Collectives, Hybrid MPI+OMP), each with: model + **measured**
  data behind a **Model | Measured** toggle; a deterministic what/why/how/expected diagnosis; a
  2D Canvas visualization; D3 scaling chart (+ roofline for bandwidth, occupancy chart for
  CUDA). The scaling axis generalizes to **ranks** for MPI (`ExperimentResult.xUnits`); weak scaling
  uses scaled-speedup/efficiency in `buildResult`. The seven new experiments are model-only with 2D
  Canvas scenes (`packages/viz`); no Measured backend yet.
- **MPI Halo Exchange** — a 1-D Jacobi stencil with ring halo exchange, swept across ranks.
  The **strong vs weak** toggle is the lesson: strong (fixed grid) saturates as the comm fraction
  grows; weak (grid ∝ ranks) holds efficiency near ideal. Measured: `{kind:"mpi"}` → `vhpce-mpi`.
- **GPU Occupancy** — a CUDA kernel swept across **threads/block (32→1024)** on the **RTX 5060**,
  with a **light vs heavy register** toggle. Heavy is register-limited (~33% occupancy); light
  reaches ~100%. Occupancy is real — queried via the CUDA Occupancy API on the device. `{kind:"cuda"}`.
- **GPU Coalescing** — stride sweep (1→32) exposing the memory-transaction cost of non-contiguous
  warp access. Measured on the RTX 5060; model uses the transaction-count formula.
- **GPU Divergence** — branch-path sweep (1→16) exposing warp serialization cost. Measured;
  model uses the serialized-fraction formula.
- **GPU Atomics** — concurrent-target sweep (1→24) exposing contention on shared-memory atomics.
  Measured; model uses the queuing formula.
- **Compare** (`/compare`) — the same kernel through both producers at once: textbook model (dashed)
  overlaid on the measured run on real silicon (solid), with scenario knobs to see exactly where the
  napkin math and the hardware agree — and where they diverge.
- **Ask the AI** (`apps/web/src/app/api/ask/route.ts` + `AskAI.tsx`) — optional Claude panel
  (`claude-opus-4-8`, streaming), **grounded on the deterministic findings**; key via
  `ANTHROPIC_API_KEY` or a per-tab bring-your-own key; built-in explanations always on.
- **Code Playground** (`/playground`) — Monaco editor → compile + thread-sweep arbitrary OpenMP C
  in a **locked-down Docker container** (11 worked examples, deep-linkable via `?ex=<id>`).
  **predict-before-you-run** (guess your speedup, then see the real numbers); **plain-language
  diagnostics** with "what now?" routing to the exact Flagship experiment that explains the
  bottleneck; **thread-count explorer** (per-point breakdown); opt-in **cachegrind** cache-miss
  profiling (D1/LLd miss rates).
- **Play** (`/play`) — the fun-first corner: **⚡ Race** pits two kernel variants head-to-head
  (predict the winner, then run both); **🧩 Quiz** tests your bottleneck instincts;
  **🔬 Sandbox** lets you explore Amdahl's and Gustafson's laws interactively;
  **🎛 Kernel Tuner** — an interactive scratchpad for tuning launch parameters (threads/block,
  tile size) and instantly seeing how they shift occupancy and arithmetic intensity; **🏅 Badges**
  rewards correct predictions across Start, Playground, and Flagship experiments and tracks
  prediction streaks.
- **Cloud gateway** (`services/api`) — **FastAPI + Redis + Arq**, run via `docker-compose`. The
  Flagship's Measured mode and the Playground both **submit jobs and poll**: `POST /api/jobs`
  (`{kind:"bench"|"code", ...}`) → `GET /api/jobs/{id}`. The Arq worker (`max_jobs=1`, serialized for
  clean timing) mounts the host Docker socket and spawns sibling sandbox containers —
  **`vhpce-bench`** (the four fixed kernels, pre-compiled) and **`vhpce-runner`** (untrusted code,
  locked down). Fixed-kernel results are cached in Redis. The old stdlib runner (`server.py`) is
  **retired**; `experiments/bench.c` lives on as the `vhpce-bench` source.

---

## 3. Current app state — how to run

**Stack:** Next.js 16 / React 19 / Tailwind v4; Node 24 + pnpm 11; FastAPI + Redis/Arq gateway; Docker for sandbox containers.

```bash
# Gateway (needed for Measured mode + Playground; Docker must be running)
pnpm gateway:build:cpu          # one-time / after kernel changes
pnpm gateway:up                 # api -> :8000, redis -> :6379
pnpm gateway:logs               # follow logs
pnpm gateway:down               # stop

# Web app
pnpm --filter web dev           # -> http://localhost:3000
```

> **Windows note:** if `pnpm` or `node` aren't found in a fresh PowerShell, refresh PATH from the registry before running:
> `$env:Path="$([Environment]::GetEnvironmentVariable('Path','Machine'));$([Environment]::GetEnvironmentVariable('Path','User'))"`

- **Ports:** web `:3000`, gateway api `:8000`, redis `:6379`. Browser reaches the gateway at
  `http://localhost:8000` (override with `NEXT_PUBLIC_VHPCE_API`).
- **Routes:** `/intro` (Introduction — orientation), `/start` (Start Here — guided first runs),
  `/learn` (Basics — concept animations), `/reference` (command library — offline),
  `/modules` (Domain Labs hub — Wave/N-Body/GEMM/FFT/SpMV/Multigrid — offline), `/lab` (Heat-equation mini-lab — offline),
  `/` (Flagship — 16 experiments), `/compare` (model vs measured overlay),
  `/playground` (Code Playground), `/play` (Play hub — Race/Quiz/Sandbox/KernelTuner/Badges),
  `POST|GET /api/ask` (LLM, Next route).
  Gateway: `GET /api/health`, `POST /api/jobs`, `GET /api/jobs/{id}`.
- **Ask-the-AI:** set `ANTHROPIC_API_KEY` in `apps/web/.env.local` (then restart) **or** paste a key
  in the panel (kept per-tab only).

---

## 4. Repo layout / key files

```
vhpce/
├─ README.md                       project overview, quick start, docs index
├─ PROGRESS.md                     this file
├─ docs/01..06.md                  architecture, roadmap, flagship spec, perf-models, AI layer, ProfileResult contract
├─ package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, .gitattributes, .gitignore
│
├─ apps/
│  ├─ flagship-zero-build/index.html        P0 demo (Canvas2D + D3, runs by double-click)
│  └─ web/                                   P1/P2 Next.js app
│     └─ src/
│        ├─ app/ layout.tsx · page.tsx (→Flagship) · globals.css (dark theme)
│        │       playground/page.tsx (→Playground) · api/ask/route.ts (LLM, streaming)
│        ├─ lib/runner.ts          gateway client: health() + runJob() submit/poll (Flagship + Playground)
│        └─ components/
│           ├─ Intro.tsx           /intro orientation page — one big idea + section map
│           ├─ FirstRun.tsx        /start guided first runs with predict-before-you-run
│           ├─ Flagship.tsx        flagship shell: 16 experiments, Model|Measured, charts, AskAI
│           ├─ Compare.tsx         /compare model-vs-measured overlay for the same kernel
│           ├─ Play.tsx            /play hub (tabs) + play/Race.tsx head-to-head kernel race
│           ├─ Playground.tsx      Monaco editor + predict + run/profile + diagnostics + thread explorer
│           ├─ AskAI.tsx           streaming LLM panel (grounded)
│           ├─ Nav.tsx             top nav (Intro | Start | Learn | Reference | Labs | Flagship | Compare | Playground | Play)
│           ├─ Modules.tsx         /modules Domain Labs hub (6 tabs + Heat Equation link)
│           ├─ modules/WaveLab.tsx   🌊 2-D FDTD wave solver
│           ├─ modules/NBodyLab.tsx  🌌 N-body gravity (32 particles)
│           ├─ modules/GemmLab.tsx   🔢 GEMM (C=A×B) — naïve vs tiled
│           ├─ modules/FFTLab.tsx    📊 FFT — Cooley-Tukey butterfly animation
│           ├─ modules/SpMVLab.tsx   🔗 Sparse SpMV — CSR, load imbalance
│           ├─ modules/MultigridLab.tsx 🔻 Multigrid V-cycle vs Jacobi
│           ├─ Lab.tsx             /lab 2-D heat-equation sim + domain-decomposition overlay
│           ├─ Learn.tsx           /learn beginner concept cards (+ learn/scenes.ts Canvas animations)
│           ├─ Reference.tsx       /reference command library (+ reference/archetypes.ts + entries.ts + Essentials filter)
│           ├─ Term.tsx · glossary.ts   hover-glossary tooltips (/reference + Flagship/Playground metric labels & hints)
│           └─ Glossed.tsx          auto-glosser: wraps glossary terms in any prose string with <Term> (Reference/Learn/Playground)
│
├─ packages/                       shared TS (transpiled by Next, no build step)
│  ├─ profile-schema/src/index.ts  the seam: ExperimentResult/Explanation types + fmt/clamp
│  ├─ perf-models/src/index.ts     Producer A (models) + Measured adapters + runnerSpec
│  ├─ explain/src/index.ts         deterministic Explain + ExplainMeasured
│  └─ viz/src/index.ts             drawScaling/drawRoofline (D3) + Canvas2D scenes
│
├─ services/
│  ├─ api/                         Producer B gateway (Cloud Phase)
│  │  ├─ app.py                    FastAPI: /api/health, POST /api/jobs ({bench|code|mpi|cuda}), GET /api/jobs/{id}
│  │  ├─ worker.py                 Arq worker (max_jobs=1): run_bench/code/mpi/cuda_task → docker run
│  │  ├─ settings.py · requirements.txt · Dockerfile · README.md
│  └─ runner/
│     └─ experiments/             bench.c (vhpce-bench) · halo.c (vhpce-mpi) · occupancy.cu (vhpce-cuda)
│
└─ infra/docker/
   ├─ compose.yml                  redis + api + worker; build profile tags vhpce-bench/runner/mpi
   ├─ runner.Dockerfile            gcc + valgrind image, non-root, ENTRYPOINT bench-driver.sh (untrusted code)
   ├─ bench-driver.sh              compile-from-stdin → thread sweep (best-of-N) → JSON [+ cachegrind]
   ├─ bench.Dockerfile             bakes bench.c (-march=native) → vhpce-bench, ENTRYPOINT bench
   ├─ mpi.Dockerfile               OpenMPI; bakes halo.c (mpicc) → vhpce-mpi, ENTRYPOINT mpi-driver.sh
   ├─ mpi-driver.sh                rank sweep: mpirun --oversubscribe -np k (best-of-2) → JSON
   └─ cuda.Dockerfile              CUDA devel; bakes occupancy.cu (nvcc, sm_120/PTX) → vhpce-cuda
```

---

## 5. Status summary

- ✅ **Cloud Phase** — FastAPI + Redis + Arq; both producers submit/poll; stdlib runner retired.
- ✅ **GPU/CUDA** — RTX 5060 passthrough; Occupancy, Coalescing, Divergence, Atomics all measured.
- ✅ **CI** — GitHub Actions (`ci.yml`): install + typecheck + lint + build on every push/PR.
- ✅ **Global rollout** — LICENSE (AGPL-3.0), README (front door), SETUP.md (multi-OS/tier setup
  guide), devcontainer (Codespaces), CI.
- ✅ **Engagement layer** — Intro, Start (predict), Compare, Play/Race, badges/streaks system,
  Playground predict + diagnostics + thread-count explorer, Reference Essentials filter.
- ✅ **Engagement Play layer** — Race, Quiz, Amdahl/Gustafson Sandbox, Kernel Tuner, Badges/streaks;
  `explain` bugfix (undefined peak guard in falseSharing/mpiHalo).
- ✅ **7 new Flagship experiments** — numaEffects, cacheHierarchy, simdVec, openmpTasks,
  cudaSharedMem, mpiCollective, hybridMpi (model-only, 2D Canvas scenes in `packages/viz`).
- ✅ **CUDA Reference** — 24 entries across 8 categories, 11 essentials; CUDA added as 6th tech
  filter tab in `/reference`.
- ✅ **3D removal** — all React Three Fiber / Three.js code removed; 2D Canvas only.
- 🔄 **P5 Domain Labs** — `/modules` hub live with 6 labs: Wave, N-Body, GEMM, FFT, SpMV, Multigrid.
  Classrooms/LMS, K8s autoscaling, PMU counters remain future work.

---

## 6. Next implementation steps

The core product, engagement layer, and six P5 domain labs are complete. Candidate next steps:

1. **More domain modules (P5).** FEM (heat/stress), CFD (Navier-Stokes lid-driven cavity) — each as
   a new tab in the `/modules` hub, following the established lab pattern.

2. **Measured backends for the new experiments.** The 7 new Flagship experiments (numaEffects,
   cacheHierarchy, simdVec, openmpTasks, cudaSharedMem, mpiCollective, hybridMpi) are model-only;
   adding gateway job kinds + kernels + Docker images would bring them to the same Model | Measured
   parity as the original nine.

3. **Classrooms + true cloud scale (P5).** Multi-user — raise the worker's `max_jobs` / add
   replicas (the queue already supports it), move sandboxes to K8s Jobs, and unlock **true PMU
   counters** (perf/LIKWID) on a bare-metal/cloud node (WSL2 has no host PMU; cachegrind + the
   CUDA Occupancy API are the local stand-ins). LMS integration for classroom deployments.

---

## 7. Contributor notes

- **Canvas/SVG ignore CSS `var()`** — use literal hex/JS palette in `viz`/canvas code, not `var(--color)`.
- **`next/dynamic({ssr:false})` under a conditional mount** causes a React "useEffect deps changed size" error — use a static import for client-only components (R3F scenes are client-safe via effects).
- **Cachegrind** needs `--cache-sim=yes` (off by default in modern Valgrind).
- **Model mode is the only offline path** — Measured (both producers) requires the gateway + Docker.
- **MPI weak scaling needs a compute-bound kernel.** A memory-bound stencil causes ranks to contend for shared DRAM bandwidth on a single node, so weak scaling degrades. `halo.c` adds a per-cell arithmetic chain to push it compute-bound; the model shows the clean comm-wall lesson, measured shows the real node's behaviour.
- **`mpirun` launches can occasionally stall.** `mpi-driver.sh` wraps each launch in `timeout -k 5 45` with a prev-value fallback, so a missed point never emits `ms:0` (which would divide-by-zero the speedup).
- **`vhpce-mpi`'s ENTRYPOINT is the driver**, not the kernel: args are `<mode> <maxranks> <Nbase> <iters>` — `halo`'s own args are `<mode> <Nbase> <iters>` (one fewer field).
- **GPU containers** need `CUDA_CACHE_PATH=/tmp/.nv` — the JIT cache requires a writable directory, and the container FS is read-only except for the `/tmp` tmpfs.
- **`cuda.Dockerfile`** tries `nvcc -arch=sm_120` and falls back to `compute_90` PTX (the driver JITs it forward). Occupancy is queried via the CUDA Occupancy API, so measured values are accurate regardless of compile arch.
- **The CUDA devel image is ~5–7 GB** — one-time pull.
- **`.gitattributes` forces LF** — `bench-driver.sh` and the Dockerfiles must stay LF; CRLF breaks the container entrypoint on Linux.
- **`/api/health` can briefly return `"docker": false`** while Docker Desktop starts up — the Playground Run button is intentionally not hard-gated on this check.
- **WSL2 has no host PMU** — cache counters in the Playground come from Valgrind cachegrind (simulated). True `perf`/LIKWID counters require a bare-metal Linux node.
