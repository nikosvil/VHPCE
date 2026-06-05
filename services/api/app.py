"""VHPCE FastAPI gateway — async submit/poll for benchmark jobs.

One entry point for both producers behind the ProfileResult seam:
  • Flagship Measured mode → {kind:"bench", exp, variant, maxthreads}
  • Code Playground        → {kind:"code", source, threads, reps, profile}

Jobs are enqueued to Redis (Arq) and run by the worker one at a time. Fixed-kernel
(bench) results are cached in Redis, so a repeat request returns immediately without
touching the queue. Untrusted code never runs in this process — the worker spawns a
locked-down sibling container for it.

    POST /api/jobs        → {id, status:"queued"}  (or {status:"done", result, cached} on a bench cache hit)
    GET  /api/jobs/{id}   → {id, status: queued|running|done|error|not_found, result?}
    GET  /api/health      → {ok, redis, docker, cores}
"""
import asyncio
import json
import os
import subprocess
from contextlib import asynccontextmanager
from typing import Annotated, Literal, Optional, Union

from arq import create_pool
from arq.connections import RedisSettings
from arq.jobs import Job, JobStatus
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    yield
    await app.state.redis.aclose()


app = FastAPI(title="VHPCE gateway", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # local dev: the Next app on :3000 plus bring-your-own
    allow_methods=["*"],
    allow_headers=["*"],
)


class BenchJob(BaseModel):
    kind: Literal["bench"]
    exp: str
    variant: str
    maxthreads: int = 24


class CodeJob(BaseModel):
    kind: Literal["code"]
    source: str
    threads: Optional[list[int]] = None
    reps: int = 2
    profile: bool = False


JobSubmit = Annotated[Union[BenchJob, CodeJob], Field(discriminator="kind")]


@app.post("/api/jobs")
async def submit(job: JobSubmit):
    redis = app.state.redis
    if job.kind == "bench":
        if job.exp not in settings.ALLOWED or job.variant not in settings.ALLOWED[job.exp]:
            return {"id": None, "status": "error",
                    "result": {"error": "badrequest", "message": f"unknown exp/variant: {job.exp}/{job.variant}"}}
        maxt = max(1, min(int(job.maxthreads), 64))
        cached = await redis.get(f"bench:{job.exp}:{job.variant}:{maxt}")
        if cached:
            return {"id": None, "status": "done", "result": json.loads(cached), "cached": True}
        j = await redis.enqueue_job("run_bench_task", job.exp, job.variant, maxt)
        return {"id": j.job_id, "status": "queued"}
    # kind == "code"
    j = await redis.enqueue_job("run_code_task", job.source, job.threads, job.reps, job.profile)
    return {"id": j.job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str):
    job = Job(job_id, app.state.redis)
    st = await job.status()
    if st == JobStatus.not_found:
        return {"id": job_id, "status": "not_found"}
    if st == JobStatus.complete:
        try:
            result = await job.result(timeout=5)
        except Exception as e:  # noqa: BLE001 — a task that raised: surface it instead of 500ing
            return {"id": job_id, "status": "done", "result": {"error": "run", "message": str(e)}}
        return {"id": job_id, "status": "done", "result": result}
    if st == JobStatus.in_progress:
        return {"id": job_id, "status": "running"}
    return {"id": job_id, "status": "queued"}   # deferred | queued


def _docker_version():
    try:
        r = subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    return None


@app.get("/api/health")
async def health():
    redis_ok = False
    try:
        await app.state.redis.ping()
        redis_ok = True
    except Exception:  # noqa: BLE001
        pass
    docker_ver = await asyncio.to_thread(_docker_version)
    # `ok` = the gateway+queue are reachable (enables the Flagship's Measured pill).
    # Docker problems surface as a clear error on first run rather than hard-gating the UI.
    return {"ok": redis_ok, "redis": redis_ok, "docker": docker_ver, "cores": os.cpu_count()}
