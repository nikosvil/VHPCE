# VHPCE — Progress Snapshot

_Last updated: 2026-06-03 · HEAD `0ea48b8` · `main` in sync with `github.com/nikosvil/VHPCE`_

A working, committed, and pushed build of **Visual HPC for Engineers** — an interactive
performance laboratory. **Phases P0, P1, and P2 (local) are complete.** This file is the
resume point: what's done, how to run it, what changed, and the next concrete steps.

> The design contract lives in `docs/` (`01-architecture.md` … `06-data-contracts.md`) and the
> running decisions log is in `README.md`. This file is the operational summary.

---

## 1. Status by phase

| Phase | Scope | Status |
|------|-------|--------|
| **P0** | Zero-build flagship "Why Parallel Code Gets Slower" (Canvas2D + D3) | ✅ done (`apps/flagship-zero-build/index.html`) |
| **P1** | Next.js monorepo; flagship on shared packages; Model\|Measured; 3D hero scenes; Ask-the-AI | ✅ done |
| **P2** | Code Playground (arbitrary OpenMP C in a locked-down Docker container) + cachegrind | ✅ **complete for local use** |
| P2-defer | FastAPI gateway + Redis/Arq job queue | ⏸ **deferred to cloud phase** — trigger: **"Go with the Cloud Phase"** |
| P3 | MPI execution + communication animator | ⬜ not started |
| P4 | GPU/CUDA (RTX 5060, local via WSL2 passthrough) + occupancy | ⬜ not started |
| P5 | Engineering modules, gamification, classrooms, cloud scale (incl. the deferred queue) | ⬜ not started |

### The core idea that holds it together
One **`ProfileResult` seam** (`@vhpce/profile-schema`). Two producers — the in-browser
**model** (`@vhpce/perf-models`) and **measured** runs (the WSL runner / Docker) — feed the same
charts, metrics, and deterministic explanations. Swapping the data source changes nothing
downstream.

---

## 2. What's built (concise)

- **Flagship** (`/`) — four experiments (false sharing, synchronization, bandwidth saturation,
  load imbalance), each with: model + **measured** (real 24-core OpenMP) data behind a
  **Model | Measured** toggle; a deterministic what/why/how/expected diagnosis; a **2D | 3D**
  visualization toggle (Canvas2D scenes in `@vhpce/viz`; R3F/Three.js hero scenes per experiment);
  D3 scaling chart (+ roofline for bandwidth).
- **Ask the AI** (`apps/web/src/app/api/ask/route.ts` + `AskAI.tsx`) — optional Claude panel
  (`claude-opus-4-8`, streaming), **grounded on the deterministic findings**; key via
  `ANTHROPIC_API_KEY` or a per-tab bring-your-own key; built-in explanations always on.
- **Code Playground** (`/playground`) — Monaco editor → compile + thread-sweep arbitrary OpenMP C
  in a **locked-down Docker container**; measured scaling + generic reading + **opt-in cachegrind**
  cache-miss profiling (D1/LLd miss rates).
- **Local measurement runner** (`services/runner/server.py`) — stdlib HTTP, serialized:
  `/health`, `/run` (the four fixed kernels via `experiments/bench.c`), `/run-code` (arbitrary
  user code → `docker run vhpce-runner`).

---

## 3. Current app state — how to run

**Environment (this machine):** Windows 11; WSL2 Ubuntu (24 logical cores); **RTX 5060 Laptop**
(CUDA passthrough works in WSL); Docker Desktop (WSL integration on); Node 24 (Windows-native) +
pnpm 11; Next.js **16** / React 19 / Tailwind v4.

```powershell
# --- WSL measurement runner (needed for Measured mode + the Playground) ---
wsl python3 /mnt/c/Users/nikos/Documents/HPC/VHPCE/services/runner/server.py   # -> :8099 (run in background)

# --- Docker image (needed for the Playground; Docker Desktop must be running + WSL integration on) ---
wsl bash -lc "cd /mnt/c/Users/nikos/Documents/HPC/VHPCE && docker build -t vhpce-runner -f infra/docker/runner.Dockerfile infra/docker"

# --- Web app (Next 16) ---
# PATH note: spawned shells here inherit a stale PATH; refresh before node/pnpm:
$env:Path="$([Environment]::GetEnvironmentVariable('Path','Machine'));$([Environment]::GetEnvironmentVariable('Path','User'))"
pnpm --filter web dev                                                          # -> http://localhost:3000
# Preview/launch config alternative (.claude/launch.json "web") uses absolute node.exe + Next bin,
# because the preview spawner lacks node on PATH.
```

- **Ports:** web `:3000`, runner `:8099`. Browser reaches the WSL runner via WSL2 localhost forwarding.
- **Routes:** `/` (Flagship), `/playground` (Code Playground), `POST|GET /api/ask` (LLM).
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
│        └─ components/
│           ├─ Flagship.tsx        flagship shell: state, Model|Measured, recompute, charts, AskAI
│           ├─ Playground.tsx      Monaco editor + run/profile + result + cache panel
│           ├─ AskAI.tsx           streaming LLM panel (grounded)
│           ├─ Nav.tsx             top nav (Flagship | Playground)
│           └─ scenes/             R3F 3D hero scenes: Shell + {FalseSharing,Synchronization,Bandwidth,Imbalance}Scene3D
│
├─ packages/                       shared TS (transpiled by Next, no build step)
│  ├─ profile-schema/src/index.ts  the seam: ExperimentResult/Explanation types + fmt/clamp
│  ├─ perf-models/src/index.ts     Producer A (models) + Measured adapters + runnerSpec
│  ├─ explain/src/index.ts         deterministic Explain + ExplainMeasured
│  └─ viz/src/index.ts             drawScaling/drawRoofline (D3) + Canvas2D scenes
│
├─ services/runner/                Producer B (local)
│  ├─ server.py                    stdlib HTTP: /health, /run, /run-code (serialized)
│  ├─ experiments/bench.c          the four fixed OpenMP kernels
│  └─ smoke.sh, README.md
│
└─ infra/docker/
   ├─ runner.Dockerfile            gcc + valgrind image, non-root, ENTRYPOINT bench-driver.sh
   └─ bench-driver.sh              compile-from-stdin → thread sweep (best-of-N) → JSON [+ cachegrind]
```

---

## 5. Pending decisions / triggers

- **"Go with the Cloud Phase"** → build the deferred **FastAPI gateway + Redis/Arq job queue**
  (docker-compose: api + Arq worker + Redis, docker-socket-mounted) and migrate the Playground to
  async submit/poll. (Deferred because the serialized stdlib runner is correct for one local user.)
- **P4 (GPU/CUDA) is available locally** — RTX 5060 + CUDA passthrough already confirmed in WSL.
- Git identity was set to `nikos <nikosvil@hotmail.com>` (history re-authored). No CI/secrets yet.

---

## 6. Next 3 implementation steps

Recommended forward path is **P3 (MPI)** — self-contained, reuses the seam and `Scene3DShell`.
(The two triggers above can pre-empt this if you choose.)

1. **MPI execution path (`/run-mpi`).** Add OpenMPI to a runner image
   (`infra/docker/mpi.Dockerfile`: `gcc`, `libopenmpi-dev`, `openmpi-bin`); compile a user/sample
   MPI C program and run it across a **rank sweep** (`mpirun --oversubscribe -np k`) on the single
   node, timing each. Add `run_mpi()` + a `/run-mpi` POST to `services/runner/server.py`, returning
   the same `{points:[{p,ms}]}` shape so existing `buildResult`/charts work unchanged. Optionally
   parse **mpiP** for a communication fraction.

2. **"MPI halo exchange" as a fifth flagship experiment.** Add it to `EXPERIMENTS`/`Models`/
   `Measured` in `@vhpce/perf-models` (comm model: latency + bandwidth vs ranks → comm-dominated
   scaling), an `Explain`/`ExplainMeasured` entry, and a 3D scene (`MpiScene3D` via `Scene3DShell`:
   ranks as nodes, animated halo/reduce/broadcast messages) plus a Canvas2D fallback in `@vhpce/viz`.

3. **Generalize the scaling axis to "ranks" and wire measured MPI.** The D3 `drawScaling` and the
   flagship hard-code "threads"; parameterize the x-axis label/units (`threads` | `ranks`) on the
   result, point the MPI experiment's `runnerSpec` at `/run-mpi`, and show strong/weak scaling with
   the ideal line — proving the seam carries a second execution model end-to-end.

---

## 7. Gotchas worth remembering (hit during P0–P2)

- **Canvas/SVG ignore CSS `var()`** — use literal hex/JS palette in `viz`/canvas code, not `var(--x)`.
- **`next/dynamic({ssr:false})` under a conditional mount** caused a React "useEffect deps changed
  size" error — use a **static import** for client-only components (R3F scenes are client-safe via effects).
- **Cachegrind** needs `--cache-sim=yes` (off by default in modern valgrind); summary spacing is
  `D1  miss rate` (two spaces), `I refs` (one space).
- **WSL `pkill -f server.py` self-matches** its own shell — kill the runner by process name
  (`pkill python3`) instead. To stop the runner cleanly, that's the move.
- **Spawned PowerShell inherits a stale PATH** — refresh from registry before `node`/`pnpm`
  (snippet in §3). The preview launch config uses absolute `node.exe` + Next's bin for the same reason.
- **`.gitattributes` forces LF** so `bench-driver.sh`/Dockerfile stay LF (CRLF breaks the container entrypoint).
- **Docker `/health` can briefly read "not ready"** while Docker Desktop starts/auto-updates — the
  Playground Run button is intentionally not hard-gated on it.
- **WSL2 has no host PMU** — measured cache counters come from **cachegrind (simulated)**; true
  `perf`/LIKWID counters are a bare-metal/cloud concern.
