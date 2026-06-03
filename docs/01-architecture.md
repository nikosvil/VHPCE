# 01 — System Architecture

## 1. Guiding principle: one seam, two producers

The hardest constraint (real profiling needs Linux + real hardware; we develop on Windows
with no Node) is turned into the central design idea.

```
                        ┌─────────────────────────────┐
   PRODUCER A           │                             │        CONSUMERS
   perf-models (TS)  ─► │      ProfileResult JSON      │ ─►  viz/   (animations + charts)
   runs in browser      │   (the single seam/contract) │ ─►  explain/ (deterministic + LLM)
                        │                             │ ─►  benchmark UI (scaling curves)
   PRODUCER B           │                             │
   runner (real         └─────────────────────────────┘
   profilers, Linux) ─►          same schema
```

Everything the student sees is rendered from a `ProfileResult`. Whether that object came
from an instant in-browser physical model or from `perf`/Nsight/LIKWID parsing in a cloud
container is invisible to the UI. This is what makes the phased roadmap honest: we ship
real, defensible visualizations on day one (driven by models) and upgrade the *source of
truth* later without rewriting the front end. Full schema: [06-data-contracts.md](06-data-contracts.md).

## 2. Tech stack (decided, with rationale)

| Layer | Choice | Why this and not the alternative |
|-------|--------|----------------------------------|
| Monorepo | **pnpm workspaces + Turborepo** | Many packages share types (the schema); Turbo caches builds. npm workspaces lack good task graph caching. |
| Web app | **Next.js 15 (App Router) + React 19 + TypeScript** | Per blueprint; App Router for streaming + server components for content pages. |
| Styling | **TailwindCSS** + a thin token layer in `packages/ui` | Fast, consistent dark-first scientific theme; tokens keep it from becoming utility soup. |
| Client state | **Zustand** | Simulation/experiment state is local and high-frequency (sliders → recompute). Redux is overkill; Context re-renders too broadly. |
| Motion | **Framer Motion** | Declarative transitions for UI; not for the 3D scene. |
| 3D viz | **React Three Fiber (Three.js)**, WebGPU renderer with **WebGL2 fallback** | R3F makes Three.js components composable/declarative inside React. Raw Three.js would fight React's lifecycle. |
| 2D charts | **D3** (scales + custom SVG/Canvas) | Roofline, scaling curves, timelines need bespoke axes/log scales D3 does best. Charting libs can't draw a roofline cleanly. |
| Code editor | **Monaco** | Per blueprint; VSCode-grade editing, LSP-ready. |
| Backend gateway | **FastAPI (Python 3.12+)** | Per blueprint; async, great for orchestrating profiler subprocesses, Pydantic mirrors the schema. |
| Persistence | **PostgreSQL** (users, progress, saved runs) + **Redis** (cache + job queue) | Standard, boring, correct. |
| Job orchestration | **Arq** (async Redis queue) → **Kubernetes Jobs** at scale → **Slurm** bridge for real clusters | Arq is async-native (fits FastAPI). Celery is heavier and sync-first. |
| Execution sandboxes | **Docker** images per toolchain (gcc/clang+OpenMP, OpenMPI, CUDA, profilers) | Isolation + reproducible toolchains; the only sane way to run untrusted student code. |
| LLM | **Anthropic Claude** via official SDK, **prompt caching** on the static teaching context | Best reasoning for code+profiler explanation; caching cuts cost on the large fixed system prompt. Kept behind an interface so it's swappable. |

## 3. Monorepo layout

```
vhpce/
├─ apps/
│  ├─ web/                  # Next.js platform UI (the product) — added at P1
│  └─ flagship-zero-build/  # P0 no-Node HTML/Three.js demo; folded into web/ at P1
├─ packages/
│  ├─ profile-schema/       # ProfileResult: JSON Schema + TS types + zod + Pydantic mirror
│  ├─ perf-models/          # PRODUCER A — Amdahl, roofline, BW saturation, false sharing…
│  ├─ explain/              # deterministic explanation engine (consumes ProfileResult)
│  ├─ viz/                  # reusable R3F scenes + D3 chart components
│  └─ ui/                   # design tokens + shared primitives (buttons, panels, sliders)
├─ services/
│  ├─ api/                  # FastAPI gateway: auth, persistence, run orchestration
│  ├─ runner/               # PRODUCER B — compiles/runs/profiles code in containers
│  └─ ai/                   # LLM orchestration: profiler-aware prompting, RAG, caching
├─ infra/
│  ├─ docker/               # toolchain images (openmp, mpi, cuda, profilers)
│  ├─ k8s/                  # manifests / helm charts
│  └─ slurm/                # batch-cluster integration (P5)
├─ content/                 # lessons, modules, challenges (MDX + metadata)
└─ docs/                    # this planning set
```

`profile-schema` is the package every other package depends on. It is generated once and
mirrored to Pydantic so the Python backend and TS frontend cannot drift.

## 4. Runtime data flow (a single experiment)

```
[student moves a slider]                              (P0/P1: instant, client-only)
        │
        ▼
 Zustand store (experiment params)
        │
        ▼
 perf-models.compute(params)  ──►  ProfileResult ──►  viz/ renders 3D + charts
                                          │
                                          ▼
                                   explain/ runs rule checks ──► Explanation{what,why,how,gain}
                                          │
                                          ▼
                              (optional) "Ask the AI" panel sends
                              {ProfileResult summary + findings + question} to services/ai
```

At P2+ the `perf-models.compute(params)` step is replaced (for languages that support it)
by a POST to `services/api` → queued `runner` job → real profiler → parsed `ProfileResult`.
The three downstream steps are identical.

## 5. Execution & profiling layer (local-first via WSL2/Docker)

This machine *is* the first execution backend: WSL2 Ubuntu (24 cores) + Docker Desktop +
RTX 5060 with CUDA passthrough. Development and the first measured `ProfileResult`s happen
locally; cloud/cluster is reserved for scale and for true hardware-counter profiling.

Untrusted student code runs in locked-down containers (no network, dropped capabilities,
seccomp, CPU/mem/time limits, read-only FS except a scratch mount). Each toolchain is a
separate image so we can profile what's actually installed:

| Capability | Toolchain image | Profilers → `ProfileResult` | Local (WSL2)? |
|-----------|-----------------|------------------------------|:-------------:|
| C/C++/OpenMP | gcc + clang + libgomp | wall-clock + thread sweeps; cachegrind (cache, *simulated*) | ✅ |
| C/C++/OpenMP | + LIKWID / `perf` HW events | measured cache / bandwidth / IPC counters | ❌ needs host PMU |
| MPI | OpenMPI / MPICH | mpiP, Score-P/TAU (comm timeline, timing) | ✅ single node |
| CUDA | CUDA toolkit | Nsight Systems (timeline, occupancy) | ✅ |
| CUDA | CUDA toolkit | Nsight Compute (detailed kernel counters) | ⚠️ verify on WSL2 |

The PMU rows are exactly why the `ProfileResult` seam matters: locally we populate timing +
sweeps + simulated counters and let `perf-models` fill the rest; on bare-metal Linux or a cloud
node the same schema is filled from real PMU data — consumers don't change. The runner's only
job is: build → run (with sweeps) → collect raw profiler output → parse into `ProfileResult` →
return. The per-profiler parser is the real engineering work; the schema it targets exists from P0.

For *local development* we can run toolchains directly in WSL2 (fast, no image build) and reserve
Docker images for reproducibility/isolation and eventual K8s. Docker Desktop's WSL integration
must be enabled and the engine started before the runner uses containers.

## 6. AI layer (summary; full design in [05-ai-explanation-layer.md](05-ai-explanation-layer.md))

Two cooperating explainers, per the **Both** decision:

- **Deterministic explainer** (`packages/explain`, TS): rule checks over `ProfileResult`
  produce a structured `Explanation`. Always on, offline, reproducible, fast.
- **LLM panel** (`services/ai`): optional. Receives the `ProfileResult` summary *and the
  deterministic findings* as grounding, plus the student's question. Answers conversationally
  and handles follow-ups. Falls back to deterministic when no key is configured.

Grounding the LLM on deterministic findings is deliberate: it sharply reduces hallucinated
performance claims because the numbers are computed, not invented.

## 7. Cross-cutting concerns

- **Security:** student code is hostile by default — see §5 sandboxing. The web app has no
  direct execution; all runs go through `services/api`.
- **Reproducibility:** model-produced `ProfileResult`s are deterministic given params + a
  named reference-machine profile (see [04-performance-models.md](04-performance-models.md) §6).
- **Accessibility:** every animation has a non-animated data equivalent (the charts), and
  respects `prefers-reduced-motion`. Color is never the only signal.
- **Offline-first for learning:** P0/P1 core experiments need no backend and no API key.
