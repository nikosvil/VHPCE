"""Shared configuration for the VHPCE gateway (app.py) and worker (worker.py).

Single source of truth for Redis, the sandbox image names, and the run limits — the same
allow-list and size/sweep caps the retired stdlib runner used, so behaviour is unchanged
behind the ProfileResult seam.
"""
import os

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

# Sibling sandbox images, spawned by the worker on the host daemon (via the mounted socket).
BENCH_IMAGE = os.environ.get("VHPCE_BENCH_IMAGE", "vhpce-bench")
RUNNER_IMAGE = os.environ.get("VHPCE_RUNNER_IMAGE", "vhpce-runner")

MAX_SOURCE = 64 * 1024                       # bytes of user C source
DEFAULT_SWEEP = [1, 2, 4, 8, 12, 16, 20, 24]
BENCH_CACHE_TTL = 24 * 3600                  # seconds a fixed-kernel result stays cached
JOB_TIMEOUT = 360                            # arq per-job timeout (s)
CODE_RUN_TIMEOUT = 300                       # docker run timeout for user code (s)
BENCH_RUN_TIMEOUT = 240                      # docker run timeout for the fixed kernels (s)

# Allow-list: frontend exp id -> {allowed bench variants}  (ported from services/runner/server.py).
ALLOWED = {
    "falsesharing": {"shared", "padded"},
    "sync":         {"critical", "atomic", "reduction"},
    "bandwidth":    {"triad"},
    "imbalance":    {"static", "guided", "dynamic"},
}
