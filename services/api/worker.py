"""VHPCE Arq worker — runs the benchmark containers, one at a time, for clean timing.

Two tasks, both spawning sibling Docker containers via the mounted host socket:
  • run_bench_task — the four fixed OpenMP kernels        (vhpce-bench image)
  • run_code_task  — arbitrary untrusted OpenMP C, locked  (vhpce-runner image)

`max_jobs = 1` serializes execution so wall-clock sweeps aren't polluted by a concurrent
run (this replaces the in-process lock the stdlib runner used); the Redis queue absorbs
concurrency instead of blocking the API. Scale out later by raising max_jobs / adding
worker replicas. Bench results are cached in Redis so the gateway can skip the queue.

Untrusted code never executes in this process — it runs in the locked-down sibling
container; this worker only orchestrates `docker run`.
"""
import asyncio
import json
import os

from arq.connections import RedisSettings

import settings


async def _run(cmd, *, input_bytes=None, timeout):
    """Run a subprocess (optional stdin), return (returncode, stdout, stderr) as text."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE if input_bytes is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(input=input_bytes), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(f"timed out after {timeout}s")
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def run_bench_task(ctx, exp, variant, maxt):
    """Compile-baked fixed kernels: `docker run vhpce-bench <exp> <variant> <maxt>`."""
    if exp not in settings.ALLOWED or variant not in settings.ALLOWED[exp]:
        return {"error": "badrequest", "message": f"unknown exp/variant: {exp}/{variant}"}
    maxt = max(1, min(int(maxt), 64))
    cmd = [
        "docker", "run", "--rm",
        "--network", "none",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", "2g", "--memory-swap", "2g",
        "--pids-limit", "256",
        "--read-only",
        settings.BENCH_IMAGE,
        exp, variant, str(maxt),
    ]
    try:
        rc, out, err = await _run(cmd, timeout=settings.BENCH_RUN_TIMEOUT)
    except RuntimeError as e:
        return {"error": "run", "message": str(e)}
    if rc != 0:
        return {"error": "run", "message": (err.strip()[-1500:] or f"rc={rc}")}
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {"error": "run", "message": "bad output from bench container"}
    data["source"] = "measured"
    data["cores"] = os.cpu_count()
    data["machine"] = "docker-local"
    # Cache for the gateway's fixed-kernel fast-path (skips the queue on repeats).
    await ctx["redis"].set(f"bench:{exp}:{variant}:{maxt}", json.dumps(data), ex=settings.BENCH_CACHE_TTL)
    return data


async def run_code_task(ctx, source, threads, reps, profile):
    """Arbitrary user OpenMP C in the locked-down runner image (source via stdin).
    Ported from the stdlib runner's run_user_code — same flags, same JSON shape."""
    if not source or len(source) > settings.MAX_SOURCE:
        return {"error": "badrequest", "message": "source missing or too large"}
    sweep = [int(p) for p in (threads or settings.DEFAULT_SWEEP)
             if isinstance(p, (int, float)) and 1 <= int(p) <= 64][:32] or settings.DEFAULT_SWEEP
    reps = max(1, min(int(reps), 5))
    cmd = [
        "docker", "run", "--rm", "-i",
        "--network", "none",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", "2g", "--memory-swap", "2g",
        "--pids-limit", "256",
        "--read-only", "--tmpfs", "/tmp:rw,exec,size=512m",
        settings.RUNNER_IMAGE,
        " ".join(str(p) for p in sweep), str(reps), "1" if profile else "0",
    ]
    try:
        rc, out, err = await _run(cmd, input_bytes=source.encode(), timeout=settings.CODE_RUN_TIMEOUT)
    except RuntimeError as e:
        return {"error": "run", "message": str(e)}
    if rc != 0:
        return {"error": "run", "message": "docker run failed: " + (err.strip()[-1500:] or f"rc={rc}")}
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {"error": "run", "message": "bad output from runner container"}
    if "error" not in data:
        data["source"] = "measured"
        data["cores"] = os.cpu_count()
        data["sweepThreads"] = sweep
    return data


class WorkerSettings:
    functions = [run_bench_task, run_code_task]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 1                 # one benchmark container at a time → clean timing
    keep_result = 3600           # keep job results for an hour for polling
    job_timeout = settings.JOB_TIMEOUT
