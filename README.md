# Visual HPC for Engineering students (VHPCE)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520.9-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11.5.1-F69220?logo=pnpm&logoColor=white)

An interactive lab for learning why parallel code gets slower — and how to fix it. Write or load an HPC kernel, run it on real CPU/GPU cores, watch the bottleneck animate in 2D/3D, and read a plain-English explanation. Covers **OpenMP, MPI, OpenACC, and CUDA**.

Every experiment has two modes: a physics-based **model** that runs offline in your browser, and **measured** runs on your actual hardware via Docker. Both produce the same charts and diagnostics — you can switch between them with one click.

---

## What's included

- **Introduction** (`/intro`) — orientation: what model vs. measured means, and a map of every page.
- **Start Here** (`/start`) — three short runs that make the core lesson concrete: parallel works, the naïve version doesn't scale, the one-line fix does. Predict the speedup before you run.
- **Learn the Basics** (`/learn`) — six animated concept walkthroughs: fork-join, parallel-for, shared vs. private memory, MPI ranks, send/recv, collectives.
- **Command Reference** (`/reference`) — ~214 OpenMP/MPI/OpenACC/CUDA entries, each with a looping animation, plain-English summary, and C/Fortran toggle. Filter by technology or use **★ Essentials** to see just the must-knows.
- **Domain Labs** (`/modules`) — engineering simulation mini-labs: Wave (FDTD), N-Body Gravity, Matrix Multiply (GEMM). Each shows how the same computation maps to serial, OpenMP, MPI, and GPU code.
- **Heat Lab** (`/lab`) — 2D heat-equation solver with a domain-decomposition overlay and a live convergence plot.
- **Flagship** (`/`) — sixteen experiments covering OpenMP, MPI, and GPU bottlenecks: false sharing, synchronization, bandwidth saturation, load imbalance, MPI halo exchange, GPU occupancy, coalescing, divergence, atomics, NUMA effects, cache hierarchy, SIMD vectorization, OpenMP tasks, GPU shared memory, MPI collectives, and hybrid MPI+OMP. Each has a Model/Measured toggle, 2D/3D visualization, scaling chart, and written diagnosis.
- **Compare** (`/compare`) — textbook model vs. your real hardware, on the same kernel, side by side.
- **Code Playground** (`/playground`) — write arbitrary OpenMP C, predict the speedup, then compile and run it in a locked-down container. Eleven worked examples, thread-count explorer, and optional cache-miss profiling.
- **Play** (`/play`) — **⚡ Race** (head-to-head kernel comparison), **🧩 Quiz** (guess the bottleneck), **🔬 Sandbox** (Amdahl's and Gustafson's laws, interactively), **🎛 Kernel Tuner** (tweak launch parameters and see the effect on occupancy), **🏅 Badges** (earned by predicting correctly across experiments).

---

## Quick start

Three tiers — pick the one that matches your setup:

| Tier | What you get | Requires |
|---|---|---|
| **0 — Model mode** | Full UI, every experiment, fully interactive | Node ≥ 20.9 + pnpm. Any OS. |
| **1 — Measured (CPU)** | Real OpenMP/MPI runs on your cores; Code Playground actually compiles and executes your code | + Docker |
| **2 — Measured (GPU)** | CUDA experiments run on your NVIDIA GPU | + NVIDIA GPU + `nvidia-container-toolkit` |

**Tier 0** (no Docker, any OS):

```bash
git clone https://github.com/nikosvil/VHPCE.git
cd VHPCE
corepack enable && pnpm install
pnpm --filter web dev
```

Open **http://localhost:3000**. Without Docker, every experiment works in Model mode. The Measured toggle and Playground Run button show a banner until Docker is running — nothing else breaks.

**No local install?** Open this repo in GitHub Codespaces ("Code → Codespaces → Create codespace") — Tier 0 is ready automatically.

→ **[SETUP.md](SETUP.md)** covers Tier 1/2 setup, GPU passthrough, environment variables, and troubleshooting.

### For instructors

One shared gateway gives a whole class Measured mode and a working Playground without requiring Docker on student machines. See [SETUP.md § Shared classroom gateway](SETUP.md#6-for-instructors-a-shared-classroom-gateway).

---

## Architecture & contributing

| # | Document | |
|---|----------|-|
| 1 | [docs/01-architecture.md](docs/01-architecture.md) | System design, tech stack, monorepo layout |
| 2 | [docs/02-roadmap.md](docs/02-roadmap.md) | Phased plan P0→P5, definition-of-done per phase |
| 3 | [docs/03-flagship-mvp-spec.md](docs/03-flagship-mvp-spec.md) | Flagship experiment specification |
| 4 | [docs/04-performance-models.md](docs/04-performance-models.md) | The physics and math behind the simulations |
| 5 | [docs/05-ai-explanation-layer.md](docs/05-ai-explanation-layer.md) | Deterministic + optional LLM explanation design |
| 6 | [docs/06-data-contracts.md](docs/06-data-contracts.md) | `ProfileResult` schema — the interface between data sources and the UI |

[`PROGRESS.md`](PROGRESS.md) has the operational summary: what's built, how to run it, and repo layout.

---

## Contributing

Bug reports and pull requests are welcome. For larger changes, open an issue first to discuss what you'd like to change. See [`PROGRESS.md`](PROGRESS.md) for the repo layout and contributor notes.

---

## License

[GNU AGPL-3.0](LICENSE) — free to use, study, modify, and share. If you run a modified version as a network service, you must make your source available to users under the same license.
