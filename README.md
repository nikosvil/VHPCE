# Visual HPC for Engineers (VHPCE)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520.9-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11.5.1-F69220?logo=pnpm&logoColor=white)

An interactive performance laboratory for learning High Performance Computing. Students edit
code, run experiments, watch hardware behavior animate, and get explanations of *why*
performance changes — built around the principle **performance intuition over syntax
memorization**. Covers **OpenMP, MPI, OpenACC, and CUDA**, with both a built-in physics-based
**model** (works offline, in your browser) and **real measured runs** (your CPU/GPU, via Docker)
behind the same UI.

---

## What's inside

- **[Learn the Basics](apps/web/src/components/Learn.tsx)** (`/learn`) — six animated, offline
  walkthroughs of core OpenMP/MPI concepts (fork-join, parallel-for, shared vs. private,
  ranks/memory, send/recv, collectives), each linking onward to a runnable example or experiment.
- **[Command Reference](apps/web/src/app/reference)** (`/reference`) — a searchable library of
  ~158 OpenMP/MPI/OpenACC directives, each with a looping animation, a plain-English summary, a
  C\|Fortran toggle, and a "▶ Run in the Playground" link.
- **[Heat Lab](apps/web/src/components/Lab.tsx)** (`/lab`) — an interactive 2-D heat-equation
  solver with a domain-decomposition overlay (serial / OpenMP / MPI / GPU) that ties the picture
  to real stencil code, plus a live convergence plot.
- **[Flagship](apps/web/src/components/Flagship.tsx)** (`/`) — six experiments (false sharing,
  synchronization, bandwidth saturation, load imbalance, MPI halo exchange, GPU occupancy), each
  with a **Model | Measured** toggle, a 2D\|3D visualization, a scaling chart, and a
  deterministic what/why/how/expected diagnosis (+ optional "Ask the AI" panel).
- **[Code Playground](apps/web/src/components/Playground.tsx)** (`/playground`) — write
  arbitrary OpenMP C, compile it, and run a thread-count sweep in a locked-down Docker sandbox,
  with optional cachegrind cache-miss profiling and one-click worked examples.

Everything above shares one data contract — `ProfileResult`/`ExperimentResult`
(`@vhpce/profile-schema`) — so the **model** (runs entirely in your browser) and **measured**
(runs in Docker, on your own CPU/GPU) producers are interchangeable: same charts, same metrics,
same explanations.

---

## Get started

| Tier | What you get | Requires |
|---|---|---|
| **0 — Quick Start** | The full UI in **Model** mode — every page, every experiment, fully interactive | Node ≥20.9 + pnpm. Any OS, any hardware. |
| **1 — Measured (CPU)** | Real OpenMP/MPI runs on *your own* cores; the Playground actually compiles and executes your code | + Docker |
| **2 — Measured (GPU)** | The CUDA experiments (occupancy, coalescing, divergence, atomics) run on *your own* NVIDIA GPU | + NVIDIA GPU + `nvidia-container-toolkit` |

The fastest path (Tier 0 — Windows, macOS, or Linux, no Docker needed):

```bash
git clone https://github.com/nikosvil/VHPCE.git
cd VHPCE
corepack enable && pnpm install
pnpm --filter web dev          # → http://localhost:3000  (Model mode, no Docker needed)
```

**No local install at all?** Open this repo in **GitHub Codespaces** ("Code → Codespaces →
Create codespace") — the [devcontainer](.devcontainer/devcontainer.json) installs everything
automatically and forwards the right ports.

**→ See [SETUP.md](SETUP.md)** for the full guide: a requirements matrix, per-OS Docker setup,
GPU/CUDA setup, environment variables, a "verify your install" checklist, and troubleshooting.

### For instructors

A single shared gateway lets a whole class get **Measured** mode and a working **Playground**
without installing Docker on student machines — see
[SETUP.md § "For instructors: a shared classroom gateway"](SETUP.md#6-for-instructors-a-shared-classroom-gateway)
for setup steps and a security note.

---

## Architecture & design docs

For contributors, or anyone extending the platform:

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [docs/01-architecture.md](docs/01-architecture.md) | System architecture, tech stack + rationale, monorepo layout, the `ProfileResult` seam |
| 2 | [docs/02-roadmap.md](docs/02-roadmap.md) | Phased plan P0→P5 with deliverables and definition-of-done |
| 3 | [docs/03-flagship-mvp-spec.md](docs/03-flagship-mvp-spec.md) | The flagship demo: *"Why Parallel Code Gets Slower"* — full spec |
| 4 | [docs/04-performance-models.md](docs/04-performance-models.md) | The physics/math engine behind the simulations (the honest core) |
| 5 | [docs/05-ai-explanation-layer.md](docs/05-ai-explanation-layer.md) | The "Both" explanation design: deterministic + optional LLM |
| 6 | [docs/06-data-contracts.md](docs/06-data-contracts.md) | The `ProfileResult` schema in full — the seam everything depends on |

[`PROGRESS.md`](PROGRESS.md) has the operational summary: what's built, how to run it, the repo
layout, and known gotchas.

---

## Project history & decisions log

<details>
<summary>Expand for the full dated decisions log (2026-06-02 → present)</summary>

VHPCE started as a planning-only repo (the architecture docs in `docs/01-06`, written before any
application code existed) and was built out phase by phase (P0 → P4 + the Cloud Phase) on a
single development machine — Windows 11 + WSL2 Ubuntu (24 logical cores), Docker Desktop, and an
RTX 5060 Laptop GPU with working CUDA passthrough. That machine's WSL2 kernel doesn't expose the
hardware PMU, so cache-miss/IPC counters in the Playground use **simulated** counters (Valgrind
cachegrind) rather than `perf`/LIKWID/PAPI; every timing-based metric (speedup, efficiency,
occupancy, bandwidth) is a real measurement. None of this affects how the app runs for *you* —
see [SETUP.md](SETUP.md) — it's kept here as the historical record of why things are built the
way they are.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-02 | Start with a **plan/architecture doc** before app code | User choice; lets direction be reviewed first |
| 2026-06-02 | AI explanations = **Both** (deterministic default + optional LLM panel) | Works offline with no key; LLM adds depth and grounds on deterministic findings to reduce hallucination |
| 2026-06-02 | P0 flagship = **zero-build** (HTML + CDN Three.js/D3), folded into Next.js at P1 | Node not installed; need an immediate visual artifact |
| 2026-06-02 | The `ProfileResult` schema is the **single seam** between data producers and the UI | Makes "simulated now, real later" a drop-in swap |
| 2026-06-02 | WSL2 + Docker confirmed → **execution is local-first**, not cloud-first | Real compile/run/timing of OpenMP/MPI/CUDA on a 24-core laptop with RTX 5060; cloud reserved for scale + true PMU |
| 2026-06-02 | Counters come from **cachegrind (simulated) + timing**; PMU tools deferred | WSL2 has no host-PMU passthrough; the `ProfileResult` seam absorbs the difference |
| 2026-06-02 | **P0 flagship built + browser-verified** (4 experiments, fix toggles, D3 charts, no console errors) | Phase 0 DoD met; runs at `apps/flagship-zero-build/index.html` (Canvas 2D + D3, zero-build) |
| 2026-06-02 | Next agreed step: **Phase 2 WSL real-measurement runner**; paused pending user "go" | "Model now, real right after" — install `build-essential/gfortran/valgrind`, OpenMP C experiments + FastAPI runner → measured `ProfileResult` behind a Model\|Measured toggle |
| 2026-06-03 | **Phase 2 landed for OpenMP**: real 24-core measured sweeps in the flagship behind a Model\|Measured toggle | `services/runner` compiles+runs OpenMP kernels (gcc 15.2); same charts/metrics/explanations render model *and* measured — the seam works with real data |
| 2026-06-03 | Runner is **stdlib HTTP** (not FastAPI yet); counters from timing only | Zero-dependency on a bare WSL Ubuntu; FastAPI gateway deferred to full P2. WSL2 has no PMU, so cache-miss/IPC counters wait for bare-metal/cloud |
| 2026-06-03 | Fixed an async **render race** (slow `/run` painting the wrong tab) with a render token | Surfaced during browser verification; measured data now always lands on the tab that requested it |
| 2026-06-03 | **P1 foundation up**: Node 24 (Windows-native) + pnpm 11 Turborepo; `apps/web` Next 16 / React 19 / Tailwind v4 boots + renders via preview | Web stack on Windows (fast file-watching); C toolchain stays in WSL. Preview launch uses absolute `node.exe` + Next bin (spawner lacks node on PATH) |
| 2026-06-03 | **Heads-up: Next.js is v16** (newer than training data); template ships an AGENTS.md to consult `node_modules/next/dist/docs` | Verify Next-specific APIs against installed docs before writing components during the flagship port |
| 2026-06-03 | **P1 core port complete + browser-verified**: flagship runs in `apps/web` on shared packages (`profile-schema`, `perf-models`, `explain`, `viz`), Model + Measured, no console errors | React rebuild of the flagship; `transpilePackages` ships TS source (no build step); render-token guards the async measured fetch. Remaining: Three.js hero scenes + optional "Ask the AI" LLM panel |
| 2026-06-03 | **Three.js hero scene** (R3F: `three` + `@react-three/fiber` + `drei`) for false sharing, with a 2D \| 3D toggle | Glowing cores over a shared cache line with a coherence packet ping-ponging (shared/red) vs calm per-core lines (padded/green). Use a **static import, not `next/dynamic`** — `dynamic({ssr:false})` under conditional mount caused a React "useEffect deps changed size" error |
| 2026-06-03 | **All four experiments now have 3D hero scenes** (shared `Scene3DShell`); 2D\|3D toggle on every tab | sync = lock-hop pillars + token; bandwidth = DRAM-bus pipe + flowing packets (color by util); imbalance = workload ramp pillars vs a finish line. Browser-verified: all render, zero console errors |
| 2026-06-03 | **"Ask the AI" panel → P1 complete**: optional live-LLM layer (Anthropic SDK, `claude-opus-4-8`, streaming) **grounded on the deterministic findings** | Server route `app/api/ask` (key never reaches the browser); key via `ANTHROPIC_API_KEY` or a per-tab bring-your-own key; built-in explanations always on (the "Both" design). `cache_control` breakpoint on the system prompt (won't cache until it exceeds Opus's 4096-tok min). Verified panel/route/streaming/error-path; live answers need a real key |
| 2026-06-03 | **P2 core landed**: a **Code Playground** runs arbitrary user OpenMP C in a **locked-down Docker container** | `infra/docker/runner.Dockerfile` (`--network none --cap-drop ALL --read-only --tmpfs /tmp:exec`, 2 GB mem, 256 pids, per-run timeout; source via stdin, non-root). Runner `/run-code` (serialized for clean timing); Monaco editor at `/playground` reusing the scaling chart + a generic reading. Browser-verified end-to-end on 24 cores. Deferred: FastAPI gateway + Redis/Arq queue (stdlib runner for now) and cachegrind cache-miss counters |
| 2026-06-03 | **P2: cachegrind cache-miss profiling** added to the playground (opt-in toggle) | Image gains `valgrind`; driver runs `cachegrind --cache-sim=yes` single-threaded, parses D1/LLd/LL miss rates + instruction count into the result; the UI shows them with a memory-bound vs cache-friendly reading. Browser-verified |
| 2026-06-03 | **FastAPI gateway + Redis/Arq queue deferred to the cloud phase (P5)** — user decision | The serialized stdlib runner is correct/sufficient for local single-user; a job queue earns its keep under concurrent multi-user load. Trigger to build: "Go with the Cloud Phase". P2 otherwise complete for local use |
| 2026-06-04 | **Cloud Phase built — FastAPI gateway + Redis + Arq worker** (`services/api`, `infra/docker/compose.yml`); the stdlib runner is **retired** | User chose to **unify both producers on the gateway**: Flagship Measured *and* Playground now `POST /api/jobs` → poll `GET /api/jobs/{id}`. The Arq worker (`max_jobs=1`, clean timing) mounts the host Docker socket and spawns sibling sandboxes — `vhpce-bench` (fixed kernels, pre-compiled `-march=native`) and `vhpce-runner` (untrusted code, locked down); bench results cached in Redis. Verified end-to-end (health/bench+cache/code/compile-error/cachegrind via API; Measured + Playground submit→poll in-browser). Trade-off: Measured now needs Docker; **Model mode is the offline path** |
| 2026-06-04 | **P3 (MPI) built — "MPI Halo Exchange" experiment + a third execution model through the seam** | A 1-D Jacobi stencil with ring halo exchange (`vhpce-mpi`, OpenMPI; `{kind:"mpi"}` gateway job → `mpirun` rank sweep). The fifth flagship experiment contrasts **strong vs weak scaling** (user choice): strong saturates as the comm fraction grows; weak holds ~ideal efficiency. The scaling axis generalizes to **ranks** (`xUnits`), `buildResult` gained weak-scaling (scaled-speedup) metrics. Kernel made **compute-bound** (per-cell FLOP chain) so single-node weak scaling stays flat; driver hardened with a per-`mpirun` timeout. Verified end-to-end (strong/weak via API + browser, 2D/3D scenes, no console errors). Model shows the vivid comm wall; measured shows this node's shared-memory reality |
| 2026-06-04 | **Heat Lab convergence plot** (idea folded in) | A live log-scale **convergence chart** (max \|Δu\| per step) beside the controls: the residual falls green as the solver nears steady state and flips **red "diverging"** when α>0.25 — a concrete numerical-methods + stability lesson. Fixed internal canvas resolution (CSS-scaled) to avoid a per-frame resize feedback loop. Verified in-browser (chart renders, stable size, no console errors); tsc + lint clean |
| 2026-06-04 | **Heat Lab model-code connection + Reference C\|Fortran toggle** (user feedback) | (1) The Heat Lab decomposition selector now swaps in the **actual stencil code** for each model (serial → `omp parallel for collapse(2)` → `MPI_Sendrecv` halo exchange → CUDA `__global__` kernel) with links to the matching Reference entry + Flagship experiment — a concrete tie from the picture to real OpenMP/MPI/GPU code (the grid overlay alone wasn't enough). (2) Every Reference entry now has a **C \| Fortran** toggle via a new `reference/fortran.ts` deriver (`#pragma omp/acc`→`!$omp/!$acc` sentinels + paired `end` directives, `for`→`do`; MPI `call …(…, ierror)` with Fortran type names), overridable per entry via `signatureF`. Verified in-browser (Lab MPI/OpenMP code + links; Fortran forms for OpenMP/MPI/OpenACC; no console errors); tsc + lint clean |
| 2026-06-04 | **Heat Lab (`/lab`) — 2-D heat-equation mini-lab** (HPC direction, P5 domain module) | An interactive, offline 2-D heat-equation solver: explicit FTCS Jacobi stencil on a 128×128 grid animated as a heatmap (`Lab.tsx`, offscreen-canvas + scaled drawImage). Controls: play/step/reset, diffusivity α (visible α≤0.25 stability cliff), speed. A **domain-decomposition overlay** (none/OpenMP/MPI/GPU) shows how the same stencil splits — OpenMP shared rows, MPI blocks + halo rings (links to the MPI Halo Exchange experiment), GPU tiles — the bridge that ties OpenMP/MPI/GPU together. Verified in-browser (sim advances, hot-centre/cold-edge field, MPI halo overlay, no console errors; screenshot captured); tsc + lint clean |
| 2026-06-04 | **`<Glossed>` auto-glosser + `/reference` long tail, slice 4** (beginner aids) | New `Glossed.tsx` auto-wraps glossary terms in any prose string (longest-match-first, word-boundary, once each) — turns the glossary into a project-wide capability; wired into Reference summaries/notes, Learn blurbs, and Playground readings/cache insights (no manual tagging). Reference grew to **~158 entries** (OpenMP 72 / MPI 59 / OpenACC 27): OpenMP atomic memory orders, scope, interop, metadirective/declare variant (new **Advanced** category), runtime env (wtick/STACKSIZE/WAIT_POLICY); MPI Sendrecv_replace, Testall/Cancel, Reduce_local, Dist_graph, Type_commit, shared-memory windows, **Dynamic processes** (Comm_spawn), Info objects, Wtick. Verified (158 entries, summaries auto-gloss e.g. mpi_bcast → rank/communicator, new categories, no console errors); tsc + lint clean |
| 2026-06-04 | **Hover-glossary wired into Flagship + Playground** (beginner aids) | The `<Term>` tooltip now covers the live metric labels (Speedup, Efficiency, Occupancy, …) on every Flagship tab and in the Playground results, plus key terms in the control hints (cache line, reduction, arithmetic intensity, warps/occupancy). A `termify(label)` helper auto-wraps any label matching the glossary; glossary expanded (+bandwidth, arithmetic intensity, cache line, coherence, atomic, critical, simd, amdahl). Diagnosis HTML left untouched (it's dangerouslySetInnerHTML). Verified in-browser (terms render with definitions on Flagship/GPU tabs, no console errors); tsc + lint clean |
| 2026-06-04 | **`/reference` long tail, slice 3** (more OpenMP/MPI, post-merge) | Grew to **~140 entries** (OpenMP 64 / MPI 49 / OpenACC 27). OpenMP: parallel-for-simd, named critical, dist_schedule, set_dynamic, and more `target` offloading (enter/exit data, target update, requires/unified-memory, defaultmap). MPI: neighborhood collectives, Pack/Unpack, persistent requests (Send_init/Start), Type_create_struct, Group/Comm_create, Dims_create, Comm_free, and a new **Parallel I/O** category (MPI_File_open/set_view, write_at_all/read_at_all). Pure data on existing archetypes; verified (140 entries, Parallel I/O category, no console errors); tsc + lint clean |
| 2026-06-04 | **`/reference` long tail, slice 2** (beginner aids; user wants more OpenMP/MPI ongoing) | Grew to **~123 entries** (OpenMP 56 / MPI 40 / OpenACC 27). OpenMP: atomic capture/read/write, cancel, loop, masked, proc_bind/OMP_PLACES (affinity), linear, scan, declare reduction, taskyield, nested, num_procs. MPI: send modes (Ssend/Bsend/Rsend), Waitany/Waitsome, **one-sided RMA** (Win_create/fence, Put/Get, Accumulate — new category), non-blocking collectives (Iallreduce), MPI_IN_PLACE, Allgatherv/Alltoallv, Op_create, Comm_dup, Cart_shift, Get_processor_name. All pure data on existing archetypes. Verified (123 entries, RMA category, no console errors); tsc + lint clean |
| 2026-06-04 | **`/reference` long tail** (beginner aids, "keep going") | Grew the library to **~99 entries** (OpenMP 44 / MPI 28 / OpenACC 27) — added OpenMP **target offloading** (`target`/`teams`/`distribute`/`map`, reusing the `offload`/`accData` archetypes), runtime + extra clauses, MPI `Probe`/`Test`/`Scatterv`/`Scan`/`Reduce_scatter`/non-blocking collectives/`Cart_create`/datatypes, and OpenACC `host_data`/`cache`/`tile`/`seq`/device queries — all pure data on the existing archetypes. New Playground example **"Sync cost (atomic)"** (5 total); `critical`/`atomic` entries now link to it. Verified in-browser (counts, new categories, `?ex=sync` loads, no console errors); tsc + lint clean |
| 2026-06-04 | **OpenACC added to `/reference`** (the planned next tranche, per user "go") | Three new archetypes — `offload` (host↔device launch: parallel/kernels/loop/routine/wait), `accData` (copyin/copyout/copy/create/present/update), `gangs` (gang/worker/vector hierarchy) — and ~21 OpenACC entries (compute, data, parallelism levels). `OpenACC` added to the tech filter. Also a UX refinement: the detail follows the active filter/search, and cross-tech "related" links reset the filter so they always resolve. ~68 entries / 14 archetypes total. Verified in-browser (OpenACC filter → 21, all 3 new archetypes draw, cross-tech related jump, no console errors); tsc + lint clean |
| 2026-06-04 | **`/reference`: archetype-driven command library** (newcomer aids II, per user request) | A searchable/filterable library of **every OpenMP & MPI directive** (~47 seeded) — each entry maps to one of ~11 reusable "smart" Canvas **archetypes** (`reference/archetypes.ts`) + params via a data table (`reference/entries.ts`), so coverage grows by adding data, not code. Plus syntax, plain-English summary + "good to know", **hover-glossary** (`Term.tsx`/`glossary.ts`), related links, "▶ Run in the Playground" (reuses `?ex=`), and `?id=` deep-links. Aids chosen: search/filter + run-in-playground + hover glossary. Fully additive (new route + components + Nav link + CSS); verified in-browser (search/filter, all 11 archetypes draw, deep-link, no console errors); tsc + lint clean. **OpenACC** (an `offload` archetype + entries) is the planned next tranche |
| 2026-06-04 | **Learning journey: connect Learn → Playground → Flagship** (beginner follow-on) | Added curated, one-click **worked examples** to the Playground (parallel sum, hello-threads, false sharing, STREAM triad) so beginners run real OpenMP without writing C; deep-linkable via `/playground?ex=<id>`. The `/learn` cards now link onward (OpenMP → a runnable example, MPI → `/?exp=mpiHalo`), and the Flagship opens a specific experiment by URL. All additive (a new `playground-examples.ts` + mount-time `?ex`/`?exp` URL reads + links); the two URL-sync effects are `eslint-disable`d for `set-state-in-effect` (SSR-safe, intentional). Verified in-browser (deep-links load the right example/tab, preset buttons swap source, no console errors); tsc + lint clean |
| 2026-06-04 | **Beginner "Learn the Basics" section (`/learn`)** — a visual on-ramp for OpenMP & MPI, added per user request | Six offline Canvas2D concept animations (fork–join, parallel-for, shared vs private, MPI ranks/memory, send/recv, collectives) with annotated code, play/step controls, and a glossary. Purely **additive** (new route + `Learn.tsx`/`learn/scenes.ts` + nav link + CSS; no backend, no code executed) — does not touch the verified Flagship/Playground/gateway. Fills the gap below the pathology-focused Flagship: *how* parallelism works before *why* it gets slower. Verified in-browser (all 6 concepts, controls, no console errors); tsc + lint clean (new files add no lint debt) |
| 2026-06-04 | **P4 (GPU/CUDA) built — "GPU Occupancy" experiment + a fourth execution model (the RTX 5060) through the seam** | A CUDA kernel swept across **threads/block (32→1024)** (`vhpce-cuda`, nvcc sm_120/PTX-JIT; `{kind:"cuda"}` gateway job → `docker run --gpus all`). The sixth flagship experiment contrasts **light vs heavy register pressure** (user choice): heavy (104 regs/thread measured) is register-limited (~33% occupancy, can't even launch large blocks); light (10 regs) reaches ~100%. Occupancy is **real** — the kernel queries the CUDA Occupancy API on the device (no Nsight). New x-domain (block size) gets its own `drawOccupancy` chart + a dedicated result builder (not `buildResult`); `SweepPoint`/`RunnerPoint` gained `occ`. Verified end-to-end (heavy/light via API + browser, occupancy chart, 2D/3D scenes, no console errors). GPU-in-container passthrough confirmed working |
| 2026-06-10 | **Global student-lab rollout**: `LICENSE` (AGPL-3.0), rewritten `README.md`/new `SETUP.md`, `.devcontainer` (Codespaces), CI workflow, `apps/web/.env.example` | The platform is feature-complete (P0→P4 + Cloud); this phase makes it usable by **student labs anywhere** — clone-and-run on Tier 0 (Node+pnpm only, any OS), with optional Tier 1 (Docker, measured CPU) and Tier 2 (NVIDIA GPU, CUDA) clearly documented and gracefully optional. Also fixed a `Flagship`/`Explain.falseSharing` crash on `r.peak` being `undefined` for a freshly-switched experiment, and added the missing `apps/web` `typecheck` script (root `pnpm typecheck` was previously a silent no-op) |

</details>

---

## License

[GNU AGPL-3.0](LICENSE) — you're free to use, study, modify, and share this project, including
running a modified version as a network service, **provided you preserve copyright/attribution
and make your source available to users under the same license.** See [LICENSE](LICENSE) for the
full text.
