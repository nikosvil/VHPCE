# VHPCE — Progress Snapshot

_Last updated: 2026-06-04 · branch `mpi-phase` (off `cloud-phase`)_

A working build of **Visual HPC for Engineers** — an interactive performance laboratory.
**Phases P0, P1, P2, the Cloud Phase (FastAPI gateway + Redis/Arq queue), and P3 (MPI) are complete.**
This file is the resume point: what's done, how to run it, what changed, and the next concrete steps.

> The design contract lives in `docs/` (`01-architecture.md` … `06-data-contracts.md`) and the
> running decisions log is in `README.md`. This file is the operational summary.

---

## 1. Status by phase

| Phase | Scope | Status |
|------|-------|--------|
| **P0** | Zero-build flagship "Why Parallel Code Gets Slower" (Canvas2D + D3) | ✅ done (`apps/flagship-zero-build/index.html`) |
| **P1** | Next.js monorepo; flagship on shared packages; Model\|Measured; 3D hero scenes; Ask-the-AI | ✅ done |
| **P2** | Code Playground (arbitrary OpenMP C in a locked-down Docker container) + cachegrind | ✅ **complete for local use** |
| **Cloud** | FastAPI gateway + Redis/Arq job queue; both producers async submit/poll; stdlib runner retired | ✅ **done** |
| **P3** | MPI execution (`{kind:"mpi"}` → `vhpce-mpi`) + "MPI Halo Exchange" experiment (strong vs weak) | ✅ **done** |
| P4 | GPU/CUDA (RTX 5060, local via WSL2 passthrough) + occupancy | ⬜ not started |
| P5 | Engineering modules, gamification, classrooms, cloud scale (incl. the deferred queue) | ⬜ not started |

### The core idea that holds it together
One **`ProfileResult` seam** (`@vhpce/profile-schema`). Two producers — the in-browser
**model** (`@vhpce/perf-models`) and **measured** runs (the gateway → Docker containers) — feed the
same charts, metrics, and deterministic explanations. Swapping the data source changes nothing
downstream. As of the Cloud Phase, *both* measured producers (fixed flagship kernels and arbitrary
Playground code) go through one async backend; **Model mode is the only offline path.**

---

## 2. What's built (concise)

- **Flagship** (`/`) — five experiments (false sharing, synchronization, bandwidth saturation,
  load imbalance, **MPI halo exchange**), each with: model + **measured** data behind a
  **Model | Measured** toggle; a deterministic what/why/how/expected diagnosis; a **2D | 3D**
  visualization toggle (Canvas2D scenes in `@vhpce/viz`; R3F/Three.js hero scenes per experiment);
  D3 scaling chart (+ roofline for bandwidth). The scaling axis generalizes to **ranks** for MPI
  (`ExperimentResult.xUnits`); weak scaling uses scaled-speedup/efficiency in `buildResult`.
- **MPI Halo Exchange** (P3) — a 1-D Jacobi stencil with ring halo exchange, swept across ranks.
  The **strong vs weak** toggle is the lesson: strong (fixed grid) saturates as the comm fraction
  grows; weak (grid ∝ ranks) holds efficiency near ideal. Measured runs go through the gateway's
  `{kind:"mpi"}` job → `vhpce-mpi` (OpenMPI, `mpirun` rank sweep). The model shows the vivid
  comm wall; measured shows this one node's shared-memory reality (gentler) — the seam carries both.
- **Ask the AI** (`apps/web/src/app/api/ask/route.ts` + `AskAI.tsx`) — optional Claude panel
  (`claude-opus-4-8`, streaming), **grounded on the deterministic findings**; key via
  `ANTHROPIC_API_KEY` or a per-tab bring-your-own key; built-in explanations always on.
- **Code Playground** (`/playground`) — Monaco editor → compile + thread-sweep arbitrary OpenMP C
  in a **locked-down Docker container**; measured scaling + generic reading + **opt-in cachegrind**
  cache-miss profiling (D1/LLd miss rates).
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
- **Routes:** `/` (Flagship), `/playground` (Code Playground), `POST|GET /api/ask` (LLM, Next route).
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
│           ├─ Flagship.tsx        flagship shell: state, Model|Measured, recompute, charts, AskAI
│           ├─ Playground.tsx      Monaco editor + run/profile + result + cache panel
│           ├─ AskAI.tsx           streaming LLM panel (grounded)
│           ├─ Nav.tsx             top nav (Flagship | Playground)
│           └─ scenes/             R3F 3D hero scenes: Shell + {FalseSharing,Synchronization,Bandwidth,Imbalance,Mpi}Scene3D
│
├─ packages/                       shared TS (transpiled by Next, no build step)
│  ├─ profile-schema/src/index.ts  the seam: ExperimentResult/Explanation types + fmt/clamp
│  ├─ perf-models/src/index.ts     Producer A (models) + Measured adapters + runnerSpec
│  ├─ explain/src/index.ts         deterministic Explain + ExplainMeasured
│  └─ viz/src/index.ts             drawScaling/drawRoofline (D3) + Canvas2D scenes
│
├─ services/
│  ├─ api/                         Producer B gateway (Cloud Phase)
│  │  ├─ app.py                    FastAPI: /api/health, POST /api/jobs ({bench|code|mpi}), GET /api/jobs/{id}
│  │  ├─ worker.py                 Arq worker (max_jobs=1): run_bench_task / run_code_task / run_mpi_task → docker run
│  │  ├─ settings.py · requirements.txt · Dockerfile · README.md
│  └─ runner/
│     └─ experiments/             bench.c (vhpce-bench, OpenMP) · halo.c (vhpce-mpi, MPI 1-D stencil)
│
└─ infra/docker/
   ├─ compose.yml                  redis + api + worker; build profile tags vhpce-bench/runner/mpi
   ├─ runner.Dockerfile            gcc + valgrind image, non-root, ENTRYPOINT bench-driver.sh (untrusted code)
   ├─ bench-driver.sh              compile-from-stdin → thread sweep (best-of-N) → JSON [+ cachegrind]
   ├─ bench.Dockerfile             bakes bench.c (-march=native) → vhpce-bench, ENTRYPOINT bench
   ├─ mpi.Dockerfile               OpenMPI; bakes halo.c (mpicc) → vhpce-mpi, ENTRYPOINT mpi-driver.sh
   └─ mpi-driver.sh                rank sweep: mpirun --oversubscribe -np k (best-of-2) → JSON
```

---

## 5. Pending decisions / triggers

- ✅ **"Go with the Cloud Phase" — done.** FastAPI gateway + Redis + Arq worker
  (`services/api`, `infra/docker/compose.yml`, docker-socket-mounted). **Both** producers now
  submit/poll; the stdlib runner is retired; verified end-to-end (API + browser) on this machine.
- **P4 (GPU/CUDA) is available locally** — RTX 5060 + CUDA passthrough already confirmed in WSL.
- Git identity was set to `nikos <nikosvil@hotmail.com>` (history re-authored). No CI/secrets yet.

---

## 6. Next 3 implementation steps

Recommended forward path is **P4 (GPU / CUDA)** — the RTX 5060 + CUDA passthrough is confirmed in
WSL, and it reuses the seam, the gateway job pattern, and `Scene3DShell` exactly like P3 did.

1. **CUDA execution path (a fourth job kind).** Add a `vhpce-cuda` image
   (`infra/docker/cuda.Dockerfile`: CUDA toolkit / `nvcc`; the container needs `--gpus all` so the
   worker's `docker run` must pass GPU access — verify Docker Desktop GPU passthrough first). Bake a
   sample CUDA kernel (e.g. SAXPY/stencil); time it across a **block/occupancy sweep**, emitting the
   same `{points:[…]}` plus occupancy fields. Add `run_cuda_task` to `services/api/worker.py` and a
   `{kind:"cuda"}` branch to `POST /api/jobs` (reuse the submit/poll plumbing + `lib/runner.ts`).

2. **"GPU Occupancy" as a sixth flagship experiment.** Add it to `EXPERIMENTS`/`Models`/`Measured`
   in `@vhpce/perf-models` (occupancy model: warps vs registers/shared-mem/block-size → achieved
   occupancy and the limiter), an `Explain`/`ExplainMeasured` entry, a Canvas2D scene + a 3D scene
   (`CudaScene3D` via `Scene3DShell`: SM/warp grid, divergence/coalescing). The x-axis becomes
   block size or active warps (extend `xUnits`).

3. **Nsight parsing for measured occupancy.** Parse Nsight Systems/Compute output (or the CUDA
   occupancy API) in the kernel/driver to populate real occupancy + the limiter (register pressure,
   shared memory, block size) into the result — proving the seam carries a third execution model
   (GPU) end-to-end, with a suggested fix. (Nsight Compute on WSL2 may be limited — verify; timing +
   occupancy-API works regardless.)

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
- **Spawned PowerShell inherits a stale PATH** — refresh from registry before `node`/`pnpm`
  (snippet in §3). The preview launch config uses absolute `node.exe` + Next's bin for the same reason.
- **`.gitattributes` forces LF** so `bench-driver.sh`/Dockerfile stay LF (CRLF breaks the container entrypoint).
- **Docker `/health` can briefly read "not ready"** while Docker Desktop starts/auto-updates — the
  Playground Run button is intentionally not hard-gated on it.
- **WSL2 has no host PMU** — measured cache counters come from **cachegrind (simulated)**; true
  `perf`/LIKWID counters are a bare-metal/cloud concern.
