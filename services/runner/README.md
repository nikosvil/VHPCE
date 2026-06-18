# services/runner — fixed-kernel source

`experiments/` holds the C/CUDA kernels behind the Flagship's Measured mode:

| File | What it is |
|---|---|
| `bench.c` | OpenMP kernels: false sharing, synchronization, bandwidth saturation, load imbalance |
| `halo.c` | MPI 1-D Jacobi stencil with ring halo exchange |
| `occupancy.cu` | CUDA kernel swept across threads/block to measure occupancy |

Each is a self-contained program that runs a sweep and prints results as JSON — the shape the `ProfileResult` seam expects.

## How execution works

The old stdlib HTTP runner (`server.py`) is retired. Execution goes through the gateway in [`services/api`](../api/README.md): an Arq worker spawns sibling Docker containers and serializes them for clean timing.

- `bench.c` is compiled into `vhpce-bench` (`infra/docker/bench.Dockerfile`, `-O2 -fopenmp -march=native`)
- `halo.c` is compiled into `vhpce-mpi` (`infra/docker/mpi.Dockerfile`, OpenMPI)
- `occupancy.cu` is compiled into `vhpce-cuda` (`infra/docker/cuda.Dockerfile`, nvcc sm_120/PTX fallback)
- Arbitrary Playground code runs in `vhpce-runner` (`infra/docker/runner.Dockerfile`)

```bash
pnpm gateway:build:cpu   # builds bench + runner + mpi images
pnpm gateway:build:gpu   # builds the CUDA image (large, one-time)
pnpm gateway:up          # starts redis + api + worker
```

## What's measured vs modeled

**Real:** compilation, execution, wall-clock timing, thread/rank scaling, achieved DRAM bandwidth, GFLOP/s, GPU occupancy (via CUDA Occupancy API).

**Simulated:** cache-miss / IPC counters — the Playground uses Valgrind cachegrind for these. True hardware PMU counters (`perf`/LIKWID) require a bare-metal Linux node without WSL2's PMU restrictions.

The Flagship's **Model** mode is the fully offline path: pure client-side physics, no Docker needed.
