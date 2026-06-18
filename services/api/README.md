# services/api — gateway (FastAPI + Redis/Arq)

Async HTTP gateway in front of a Redis job queue. An Arq worker pulls jobs and runs them in sibling Docker containers spawned on the host daemon. Serves both measured-data producers behind the `ProfileResult` seam:

- **Flagship Measured mode** → `{kind:"bench", exp, variant, maxthreads}` → `vhpce-bench` (pre-compiled OpenMP kernels)
- **Code Playground** → `{kind:"code", source, threads, reps, profile}` → `vhpce-runner` (arbitrary untrusted OpenMP C, locked down)
- **MPI Halo Exchange** → `{kind:"mpi", ...}` → `vhpce-mpi` (OpenMPI rank sweep)
- **CUDA experiments** → `{kind:"cuda", ...}` → `vhpce-cuda` (NVIDIA GPU, Docker `--gpus all`)

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET`  | `/api/health` | `{ok, redis, docker, cores}` |
| `POST` | `/api/jobs`   | Submit a job → `{id, status:"queued"}`, or `{status:"done", result, cached:true}` on a bench cache hit |
| `GET`  | `/api/jobs/{id}` | `{id, status: queued\|running\|done\|error\|not_found, result?}` |

`result` is the same JSON shape the frontend's adapters and Playground already consume.

## Why a job queue

The worker runs `max_jobs=1` — one container at a time — so wall-clock sweeps aren't polluted by concurrent runs. Submissions return immediately with a job id; the client polls. Scale out later by raising `max_jobs` or adding worker replicas.

Fixed-kernel (`bench`) results are cached in Redis (~24 h), so repeat requests return instantly without re-entering the queue.

## Run

From the repo root (Docker must be running):

```bash
pnpm gateway:build:cpu   # build sandbox images (bench + runner + mpi)
pnpm gateway:up          # start redis + api + worker
pnpm gateway:logs        # follow logs
pnpm gateway:down        # stop
```

API on `:8000`, Redis on `:6379`. The web app reaches the gateway at `http://localhost:8000` (override with `NEXT_PUBLIC_VHPCE_API`).

## Security model

The api/worker mount the Docker socket to orchestrate `docker run`, but execute nothing untrusted themselves. Isolation lives on the sibling containers: `--network none --cap-drop ALL --security-opt no-new-privileges --read-only`, plus memory/PID limits and a per-run timeout. Mounting the host socket is appropriate for local/single-user use; a multi-tenant deployment would use rootless Docker or Kubernetes Jobs.
