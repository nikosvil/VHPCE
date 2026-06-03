# services/runner — local measurement runner (Phase 2 prototype)

**Producer B** for the flagship: compiles `experiments/bench.c` and runs the four OpenMP
experiments on this machine's 24 cores, serving the *measured* sweeps to the UI behind a
**Model | Measured** toggle. This is the seam from [docs/01-architecture.md](../../docs/01-architecture.md)
working with real data instead of the in-browser model.

Standard library only — no `pip install`. The production gateway will be FastAPI; this is a
zero-dependency stand-in so we can measure today.

## Prerequisites (one-time, in WSL Ubuntu)

```bash
sudo apt-get update && sudo apt-get install -y build-essential gfortran valgrind
```

## Run

```bash
python3 services/runner/server.py     # inside WSL; listens on :8099
```

WSL2 forwards `localhost`, so the Windows browser can reach `http://localhost:8099`.

## Endpoints

- `GET /health` → `{ok, cores, gcc}`
- `GET /run?exp=<falsesharing|sync|bandwidth|imbalance>&variant=<...>&maxthreads=24`
  → `{exp, variant, source:"measured", cores, points:[{p, ms[, gbps, gflops]}, ...]}`

The frontend derives speedup / efficiency / diagnostics from `points` using the *same*
code path as the model, so the visualizations and explanations are unchanged.

## What's real vs modeled here

Real: compilation, execution, wall-clock timing, thread scaling on 24 cores, achieved
DRAM bandwidth (bytes/time) and GFLOP/s for the triad. Not measured locally (WSL2 has no
host PMU): hardware cache-miss / IPC counters — those arrive on bare-metal/cloud (Phase 5).
The thread-timeline animations remain schematic; the metrics and charts use measured data.
