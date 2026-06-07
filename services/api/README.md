# services/api — VHPCE gateway (FastAPI + Redis/Arq)

The cloud-phase backend. One async HTTP gateway in front of a Redis job queue; an Arq worker
pulls jobs and runs them in **sibling Docker containers** spawned on the host daemon. This
replaces the retired stdlib runner (`services/runner/server.py`) and serves **both** producers
behind the `ProfileResult` seam:

- **Flagship Measured mode** → `{kind:"bench", exp, variant, maxthreads}` → `vhpce-bench`
  (the four pre-compiled OpenMP kernels).
- **Code Playground** → `{kind:"code", source, threads, reps, profile}` → `vhpce-runner`
  (arbitrary untrusted OpenMP C, locked down).

## Why a queue

The worker runs with **`max_jobs = 1`**: one benchmark container at a time, so wall-clock
sweeps aren't polluted by a concurrent run (this is what the stdlib runner's in-process lock
did). The difference is that the queue *absorbs* concurrency instead of blocking the HTTP
server — submissions return immediately with a job id and the client polls. Scale out later by
raising `max_jobs` or adding worker replicas.

Fixed-kernel (`bench`) results are cached in Redis (`bench:{exp}:{variant}:{maxt}`, ~24 h), so
a repeat request returns instantly without re-entering the queue — keeping the Flagship's
Measured toggle snappy.

## Endpoints

| Method | Path | Body / result |
|---|---|---|
| `GET`  | `/api/health` | `{ok, redis, docker, cores}` — `ok` = gateway+queue reachable |
| `POST` | `/api/jobs` | submit (see kinds above) → `{id, status:"queued"}`, or `{status:"done", result, cached:true}` on a bench cache hit |
| `GET`  | `/api/jobs/{id}` | `{id, status: queued\|running\|done\|error\|not_found, result?}` |

`result` is the same JSON the old `/run` and `/run-code` returned (`{exp,variant,points,...}` or
`{points,cache?,...}`, or `{error,message}`), so the frontend's `Measured[...]` adapters and the
Playground render it unchanged.

## Run

Requires Docker Desktop running with Ubuntu WSL integration on. From the repo root:

```bash
# 1) Build the sandbox images (tags vhpce-bench + vhpce-runner in the host daemon)
docker compose -f infra/docker/compose.yml --profile build build
# 2) Start redis + api + worker
docker compose -f infra/docker/compose.yml up -d
# 3) Logs / stop
docker compose -f infra/docker/compose.yml logs -f
docker compose -f infra/docker/compose.yml down
```

API on `:8000`, Redis on `:6379`. The Next app (`apps/web`, `:3000`) reaches the gateway at
`http://localhost:8000` (override with `NEXT_PUBLIC_VHPCE_API`).

## Security model

The api/worker run as **root and mount the Docker socket** — they orchestrate `docker run` but
execute nothing untrusted themselves. All isolation is on the **sibling** containers:
`--network none --cap-drop ALL --security-opt no-new-privileges --read-only`, memory/PID limits,
and a per-run timeout (`vhpce-runner` adds a `tmpfs /tmp` for the compile step). Mounting the host
socket is a privileged grant appropriate for this single-user local/dev setup; a multi-tenant
deployment would move to rootless Docker, Sysbox, or Kubernetes Jobs with a restricted runtime.
