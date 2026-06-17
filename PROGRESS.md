# VHPCE — Progress Snapshot

_Last updated: 2026-06-17 · branch `main`_

**Visual HPC for Engineers** — an interactive performance laboratory.
**Phases P0–P4 + the Cloud Phase + the engagement & GPU-lesson layer are complete.**
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
| **Engagement** | Intro, Start (predict-before-you-run), Compare, Play/Race, Reference Essentials + ~190 entries, Playground predict + diagnostics + thread-count explorer, predict streaks + badge system | ✅ done (quiz + Amdahl/Gustafson sandbox in next PR) |
| **Rollout** | LICENSE (AGPL-3.0), rewritten README, SETUP.md, CI (GitHub Actions), devcontainer (Codespaces) | ✅ done |
| P5 | Engineering domain modules, classrooms/LMS, K8s autoscaling, true PMU counters | ⬜ not started |

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
- **Command Reference** (`/reference`) — a searchable, filterable library of **OpenMP, MPI & OpenACC
  directives/commands** (~190 entries: OpenMP 72 / MPI 59 / OpenACC 27 — incl. OpenMP `target`
  offloading + advanced (metadirective/declare variant) + runtime env; MPI one-sided RMA (+ shared
  windows), parallel I/O, neighborhood collectives, persistent requests, graph topologies, dynamic
  processes), each with a "smart" looping animation, syntax, a
  plain-English summary, a "good to know" note, hover-glossary `<Term>`s, related links (cross-tech
  navigation resets the filter), and a "▶ Run in the Playground" link where it maps to a runnable
  example. **Archetype-driven**: **14** reusable Canvas animations (`reference/archetypes.ts`) — incl.
  OpenACC `offload` (host↔device), `accData` (copyin/out/create/present/update), and `gangs`
  (gang/worker/vector) — + a data table (`reference/entries.ts`) where each entry maps to an
  archetype + params, so coverage grows by adding *data*, not code. Deep-linkable via
  `/reference?id=<entryId>`. The selected entry follows the active filter/search. A **C | Fortran**
  toggle shows each signature in both languages (derived: `!$omp`/`!$acc` sentinels + `end` directives,
  `for`→`do`; MPI `call …(…, ierror)` with Fortran type names — overridable via `signatureF`).
  A **★ Essentials** filter narrows the full library to the must-knows for newcomers.
- **Heat Lab** (`/lab`) — an interactive **2-D heat-equation** mini-lab (P5 domain module): an explicit
  finite-difference (FTCS Jacobi) stencil on a 128×128 grid, animated as a heatmap (offline, no
  backend). Controls: play/step/reset, diffusivity α (with a visible α≤0.25 stability cliff), speed.
  A **domain-decomposition overlay** (none / OpenMP / MPI / GPU) shows how the same stencil splits —
  OpenMP shared rows, MPI blocks + **halo rings** (links to the MPI Halo Exchange experiment), GPU
  tiles. Picking a model also swaps in the **actual stencil code** for it (serial → `omp parallel for`
  → `MPI_Sendrecv` halo exchange → CUDA kernel) with links to the matching Reference entry + Flagship
  experiment — the direct tie from the picture to real OpenMP/MPI/GPU code. A live **convergence
  plot** (log-scale max |Δu| per step) shows the solver converging — and **diverging** (red) when α>0.25.
- **Flagship** (`/`) — **nine experiments** (false sharing, synchronization, bandwidth saturation,
  load imbalance, MPI halo exchange, GPU occupancy, GPU coalescing, GPU divergence, GPU atomics),
  each with: model + **measured** data behind a **Model | Measured** toggle; a deterministic
  what/why/how/expected diagnosis; a **2D | 3D** visualization toggle; D3 scaling chart (+
  roofline for bandwidth, occupancy chart for CUDA). The scaling axis generalizes to **ranks** for
  MPI (`ExperimentResult.xUnits`); weak scaling uses scaled-speedup/efficiency in `buildResult`.
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
  (predict the winner, then run both). More games land here over time. Badge/streak system rewards
  correct predictions across Start, Playground, and Flagship experiments.
- **Cloud gateway** (`services/api`) — **FastAPI + Redis + Arq**, run via `docker-compose`. The
  Flagship's Measured mode and the Playground both **submit jobs and poll**: `POST /api/jobs`
  (`{kind:"bench"|"code", ...}`) → `GET /api/jobs/{id}`. The Arq worker (`max_jobs=1`, serialized for
  clean timing) mounts the host Docker socket and spawns sibling sandbox containers —
  **`vhpce-bench`** (the four fixed kernels, pre-compiled) and **`vhpce-runner`** (untrusted code,
  locked down). Fixed-kernel results are cached in Redis. The old stdlib runner (`server.py`) is
  **retired**; `experiments/bench.c` lives on as the `vhpce-bench` source.

---

## 3. Current app state — how to run

**Environment (this machine):** Windows 11; WSL2 Ubuntu (24 logical cores); **RTX 5060 Laptop**
(CUDA passthrough works in WSL); Docker Desktop (WSL integration on); Node 24 (Windows-native) +
pnpm 11; Next.js **16** / React 19 / Tailwind v4.

```powershell
# --- Cloud gateway (needed for Measured mode + the Playground; Docker Desktop must be running) ---
# 1) build the sandbox images (tags vhpce-bench + vhpce-runner) — one-time / after kernel changes:
docker compose -f infra/docker/compose.yml --profile build build
# 2) start redis + api + worker:
docker compose -f infra/docker/compose.yml up -d                               # api -> :8000, redis -> :6379
#    logs / stop:
docker compose -f infra/docker/compose.yml logs -f
docker compose -f infra/docker/compose.yml down

# --- Web app (Next 16) ---
# PATH note: spawned shells here inherit a stale PATH; refresh before node/pnpm:
$env:Path="$([Environment]::GetEnvironmentVariable('Path','Machine'));$([Environment]::GetEnvironmentVariable('Path','User'))"
pnpm --filter web dev                                                          # -> http://localhost:3000
# Preview/launch config alternative (.claude/launch.json "web") uses absolute node.exe + Next bin,
# because the preview spawner lacks node on PATH.
```

- **Ports:** web `:3000`, gateway api `:8000`, redis `:6379`. Browser reaches the gateway at
  `http://localhost:8000` (override with `NEXT_PUBLIC_VHPCE_API`).
- **Routes:** `/intro` (Introduction — orientation), `/start` (Start Here — guided first runs),
  `/learn` (Basics — concept animations), `/reference` (command library — offline),
  `/lab` (Heat-equation mini-lab — offline), `/` (Flagship — 9 experiments),
  `/compare` (model vs measured overlay), `/playground` (Code Playground),
  `/play` (Play hub — Race game + more), `POST|GET /api/ask` (LLM, Next route).
  Gateway: `GET /api/health`, `POST /api/jobs`, `GET /api/jobs/{id}`.
- **Ask-the-AI:** set `ANTHROPIC_API_KEY` in `apps/web/.env.local` (then restart) **or** paste a key
  in the panel (kept per-tab only).

---

## 4. Repo layout / key files

```
vhpce/
├─ README.md                       decisions log + reading order
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
│           ├─ Flagship.tsx        flagship shell: 9 experiments, Model|Measured, charts, AskAI
│           ├─ Compare.tsx         /compare model-vs-measured overlay for the same kernel
│           ├─ Play.tsx            /play hub (tabs) + play/Race.tsx head-to-head kernel race
│           ├─ Playground.tsx      Monaco editor + predict + run/profile + diagnostics + thread explorer
│           ├─ AskAI.tsx           streaming LLM panel (grounded)
│           ├─ Nav.tsx             top nav (Intro | Start | Learn | Reference | Lab | Flagship | Compare | Playground | Play)
│           ├─ Lab.tsx             /lab 2-D heat-equation sim + domain-decomposition overlay
│           ├─ Learn.tsx           /learn beginner concept cards (+ learn/scenes.ts Canvas animations)
│           ├─ Reference.tsx       /reference command library (+ reference/archetypes.ts + entries.ts + Essentials filter)
│           ├─ Term.tsx · glossary.ts   hover-glossary tooltips (/reference + Flagship/Playground metric labels & hints)
│           ├─ Glossed.tsx          auto-glosser: wraps glossary terms in any prose string with <Term> (Reference/Learn/Playground)
│           └─ scenes/             R3F 3D hero scenes: Shell + {FalseSharing,Synchronization,Bandwidth,Imbalance,Mpi,Cuda}Scene3D
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
- **Next PR (`feat/badges-pr30`)** — guess-the-bottleneck quiz (#31) + Amdahl & Gustafson
  interactive sandbox (#32) + `explain` bugfix (undefined peak in falseSharing/mpiHalo).

---

## 6. Next implementation steps

The core product and engagement layer are complete. Candidate next steps:

1. **Merge `feat/badges-pr30`** — guess-the-bottleneck quiz, Amdahl & Gustafson interactive
   sandbox, and a bugfix for `explain.falseSharing`/`mpiHalo` when `r.peak` is undefined.

2. **Engineering-domain modules (P5).** FEM/FDTD/CFD/stencil/FFT mini-labs with interactive
   domain decomposition and convergence plots, built on the same `ProfileResult` seam and the
   gateway job kinds (OpenMP/MPI/CUDA) already in place.

3. **Classrooms + true cloud scale (P5).** Multi-user — raise the worker's `max_jobs` / add
   replicas (the queue already supports it), move sandboxes to K8s Jobs, and unlock **true PMU
   counters** (perf/LIKWID) on a bare-metal/cloud node (WSL2 has no host PMU; cachegrind + the
   CUDA Occupancy API are the local stand-ins). LMS integration for classroom deployments.

---

## 7. Gotchas worth remembering (hit during P0–P2)

- **Canvas/SVG ignore CSS `var()`** — use literal hex/JS palette in `viz`/canvas code, not `var(--x)`.
- **`next/dynamic({ssr:false})` under a conditional mount** caused a React "useEffect deps changed
  size" error — use a **static import** for client-only components (R3F scenes are client-safe via effects).
- **Cachegrind** needs `--cache-sim=yes` (off by default in modern valgrind); summary spacing is
  `D1  miss rate` (two spaces), `I refs` (one space).
- **Stop the gateway** with `docker compose -f infra/docker/compose.yml down` (no more
  `pkill python3` — the stdlib runner is gone). Rebuild the sandbox images after editing `bench.c`
  or a Dockerfile: `docker compose ... --profile build build`.
- **Docker-out-of-Docker works on Docker Desktop:** the api/worker bind-mount
  `/var/run/docker.sock` and `docker run` siblings against the host daemon — verified even with WSL
  integration *off* (compose talks to the Linux engine, which owns the socket). Build needs internet
  (static docker client + pip + apt).
- **PowerShell wraps native stderr as `NativeCommandError`** — `docker build`/`up` print progress to
  stderr, which shows as red "RemoteException" lines even on success; trust `$LASTEXITCODE`, not the
  red text.
- **Preview screenshots can time out on the flagship** (the R3F animation loop keeps the renderer
  busy). Verify with `preview_eval` (read DOM/state, fetch the gateway) instead of `preview_screenshot`.
- **Model mode is the only offline path now** — Measured (both producers) needs the gateway + Docker.
- **MPI weak scaling needs a compute-bound kernel.** A plain memory-bound stencil makes ranks
  contend for shared DRAM bandwidth on one node, so weak scaling *degrades* (the opposite of the
  lesson). `halo.c` adds a per-cell arithmetic chain (`FLOP`) to push it compute-bound → weak stays
  ~flat. (The model carries the clean comm-wall lesson; measured shows this node's reality.)
- **`mpirun` launches occasionally stall.** `mpi-driver.sh` wraps each launch in `timeout -k 5 45`
  and uses `--bind-to none`, with a prev-value fallback so a missed point never emits `ms:0`
  (which would divide-by-zero the speedup). Without the per-launch cap a single stall ate the whole
  300s job timeout.
- **`vhpce-mpi`'s ENTRYPOINT is the driver**, not the kernel: args are `<mode> <maxranks> <Nbase>
  <iters>` — don't confuse with `halo`'s `<mode> <Nbase> <iters>` (passing maxranks=Nbase launches a
  runaway sweep).
- **`--network none` is fine for single-node MPI** — OpenMPI uses the loopback/shared-memory
  transport, which works inside the locked-down container (verified).
- **GPU passes into containers** via `docker run --gpus all` (Docker Desktop has the `nvidia` runtime
  registered; the RTX 5060 shows up as cc 12.0 / sm_120 inside the container). The locked-down flags
  (`--cap-drop ALL --network none --read-only` + tmpfs `/tmp`) coexist with `--gpus all`; CUDA's JIT
  cache needs a writable dir → `CUDA_CACHE_PATH=/tmp/.nv`.
- **sm_120 (Blackwell) needs a recent toolkit.** `cuda.Dockerfile` tries `nvcc -arch=sm_120` and falls
  back to `compute_90` **PTX** (the new driver JITs it forward to sm_120). The CUDA **Occupancy API**
  queries the real device, so measured occupancy is accurate regardless of the compile arch.
- **The CUDA devel image is ~5–7 GB** (one-time pull, several minutes). Occupancy is real (Occupancy
  API); Nsight Compute counters on WSL2 remain future work.
- **GPU occupancy needs its own chart** (`drawOccupancy`) and result builder — block size (32→1024)
  is a different x-domain than threads/ranks (1→24), so the cuda experiment does **not** use
  `buildResult` (mirrors how bandwidth has the roofline).
- **Spawned PowerShell inherits a stale PATH** — refresh from registry before `node`/`pnpm`
  (snippet in §3). The preview launch config uses absolute `node.exe` + Next's bin for the same reason.
- **`.gitattributes` forces LF** so `bench-driver.sh`/Dockerfile stay LF (CRLF breaks the container entrypoint).
- **Docker `/health` can briefly read "not ready"** while Docker Desktop starts/auto-updates — the
  Playground Run button is intentionally not hard-gated on it.
- **WSL2 has no host PMU** — measured cache counters come from **cachegrind (simulated)**; true
  `perf`/LIKWID counters are a bare-metal/cloud concern.
