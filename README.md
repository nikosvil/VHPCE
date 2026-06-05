# Visual HPC for Engineers (VHPCE)

An interactive performance laboratory for learning High Performance Computing. Students
edit code, run experiments, watch hardware behavior animate, and get explanations of
*why* performance changes — built around the principle **performance intuition over
syntax memorization**.

This repository currently holds the **planning set**. No application code has been
written yet (by decision — see below). These documents are the contract we build against.

---

## Read these in order

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [docs/01-architecture.md](docs/01-architecture.md) | System architecture, tech stack + rationale, monorepo layout, the `ProfileResult` seam |
| 2 | [docs/02-roadmap.md](docs/02-roadmap.md) | Phased plan P0→P5 with deliverables and definition-of-done |
| 3 | [docs/03-flagship-mvp-spec.md](docs/03-flagship-mvp-spec.md) | The first demo: *"Why Parallel Code Gets Slower"* — full spec |
| 4 | [docs/04-performance-models.md](docs/04-performance-models.md) | The physics/math engine behind the simulations (the honest core) |
| 5 | [docs/05-ai-explanation-layer.md](docs/05-ai-explanation-layer.md) | The "Both" explanation design: deterministic + optional LLM |
| 6 | [docs/06-data-contracts.md](docs/06-data-contracts.md) | The `ProfileResult` schema in full — the seam everything depends on |

---

## Key reality constraints (discovered, not assumed)

These shaped every decision in the architecture. They are not negotiable facts about the
current machine and the problem domain:

1. **Real HPC execution runs *locally* via WSL2 + Docker — with one caveat.** This machine has
   WSL2 (Ubuntu, **24 logical cores**), Docker Desktop, and an **RTX 5060 Laptop GPU** with
   working CUDA passthrough (`nvidia-smi` sees it inside WSL). So real compilation, execution,
   and **timing-based** profiling of C/C++/Fortran/OpenMP/MPI/CUDA happen on this laptop — no
   cloud needed for development. **The caveat:** WSL2's virtualized kernel does *not* expose the
   hardware PMU, so true hardware-counter tools (`perf` HW events, LIKWID, PAPI, VTune) do *not*
   work locally. We still get real counters via *simulation* (Valgrind cachegrind/callgrind) and
   real timing/scaling everywhere; true PMU counters are the bare-metal-Linux / cloud upgrade.
2. **Node.js is not installed** on this machine (Python 3.14 and git are). The blueprint's
   stack (Next.js/React/Three.js) needs Node. P0 is therefore designed to need *zero* build
   tooling so we can ship something visual immediately; P1 installs the real toolchain.
3. **"Visually exceptional" is a hard requirement, not a nice-to-have.** The blueprint says
   the platform fails if it becomes static or boring. The flagship demo is the proof.

**Local capability matrix (what's real on this laptop vs. what needs bare-metal/cloud):**

| Capability | Local via WSL2/Docker | Notes |
|-----------|:---------------------:|-------|
| Compile + run C/C++/Fortran/OpenMP/MPI/CUDA | ✅ | toolchains install into Ubuntu; 24 cores for scaling sweeps |
| Wall-clock timing → strong/weak scaling, speedup, efficiency | ✅ | backbone of the flagship and most lessons |
| Cache-miss rates + instruction counts | ✅ *simulated* | Valgrind cachegrind/callgrind — no PMU needed |
| MPI comm profiling (fractions, message sizes) | ✅ | mpiP / timing-based; multi-rank on one node |
| GPU kernel timing + occupancy | ✅ | nvcc + Nsight Systems; RTX 5060 via CUDA passthrough |
| Hardware PMU counters (cache-miss/IPC/bandwidth, *measured*) | ❌ locally | `perf` HW events / LIKWID / PAPI / VTune need the host PMU → bare-metal Linux or cloud |

The architectural answer to #1 is the **simulate-now / measure-later seam** (see
[docs/06-data-contracts.md](docs/06-data-contracts.md)): a single `ProfileResult` schema is
consumed by all visualizers and the explanation engine. Early on it is produced by a
physically-grounded **model** running in the browser; later the same schema is produced by
**real profilers** in cloud containers. Nothing downstream changes when we swap producers.

---

## Decisions log

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

## Open questions (for the user, when we resume building)

- **Flagship data source:** pure *model* (zero-build HTML, instant, no install) or *model + real
  local measurement* (install the WSL toolchain + a tiny local runner so the demo shows this
  laptop's real 24-core scaling)? See [docs/02-roadmap.md](docs/02-roadmap.md) Phase 0.
- **True PMU counters:** do you have/want a bare-metal Linux option (dual-boot or a real cluster)
  for `perf`/LIKWID hardware counters, or is simulated (cachegrind) + timing enough for now?
- Target browsers — is WebGPU acceptable, or must everything fall back to WebGL2? (affects viz engine)
- Preferred LLM provider for the live panel — Claude (Anthropic), or provider-agnostic?
- Node placement at P1 — install in WSL (nvm) for one Linux dev env, or Windows-native?

See [docs/02-roadmap.md](docs/02-roadmap.md) for what happens after this planning set is approved.
