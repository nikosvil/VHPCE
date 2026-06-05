# services/runner — fixed-kernel source (the four flagship experiments)

`experiments/bench.c` holds the real OpenMP kernels behind the flagship's **Measured** mode:
false sharing, synchronization, bandwidth saturation, load imbalance. It is a self-contained
program — `bench <exp> <variant> <maxthreads>` — that runs a 1→N thread sweep and prints the
measured points as JSON:

```
{"exp":..,"variant":..,"points":[{"p":1,"ms":..[,"gbps":..,"gflops":..]}, ...]}
```

— exactly the `RunnerData` shape the `ProfileResult` seam consumes.

## How it runs now

The original **stdlib HTTP runner (`server.py`) is retired.** Execution moved to the
cloud-phase backend in **[`services/api`](../api/README.md)** (FastAPI + Redis/Arq): the worker
spawns sibling Docker containers and serializes them for clean timing. `bench.c` is compiled
into the **`vhpce-bench`** image at build time (`infra/docker/bench.Dockerfile`, `-O2 -fopenmp
-march=native`); arbitrary Playground code runs in **`vhpce-runner`**
(`infra/docker/runner.Dockerfile`).

```bash
docker compose -f infra/docker/compose.yml --profile build build   # builds vhpce-bench + vhpce-runner
docker compose -f infra/docker/compose.yml up -d                   # redis + api + worker
```

## What's real vs modeled

Real: compilation, execution, wall-clock timing, thread scaling on 24 cores, achieved DRAM
bandwidth (bytes/time) and GFLOP/s for the triad. Not measured locally (WSL2 has no host PMU):
hardware cache-miss / IPC counters — those arrive on bare-metal/cloud (Phase 5). The Playground
adds **simulated** cache-miss counters via cachegrind. The offline path is the flagship's
**Model** mode (pure client-side, no backend, no Docker).
