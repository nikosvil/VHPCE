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
MPI_IMAGE = os.environ.get("VHPCE_MPI_IMAGE", "vhpce-mpi")
CUDA_IMAGE = os.environ.get("VHPCE_CUDA_IMAGE", "vhpce-cuda")

MAX_SOURCE = 64 * 1024                       # bytes of user C source
DEFAULT_SWEEP = [1, 2, 4, 8, 12, 16, 20, 24]
BENCH_CACHE_TTL = 24 * 3600                  # seconds a fixed-kernel/MPI result stays cached
JOB_TIMEOUT = 360                            # arq per-job timeout (s)
CODE_RUN_TIMEOUT = 300                       # docker run timeout for user code (s)
BENCH_RUN_TIMEOUT = 240                      # docker run timeout for the fixed kernels (s)
MPI_RUN_TIMEOUT = 300                        # docker run timeout for the MPI rank sweep (s)
CUDA_RUN_TIMEOUT = 240                        # docker run timeout for the GPU block-size sweep (s)

# MPI halo kernel sizing (cells / stencil iterations). The kernel is compute-bound (see
# halo.c FLOP), so per-rank work is constant under weak scaling and compute dominates the
# per-launch mpirun overhead at low rank counts on this 24-core node.
HALO_NBASE = 400000
HALO_ITERS = 30

# Allow-list: frontend exp id -> {allowed bench variants}  (ported from services/runner/server.py).
ALLOWED = {
    "falsesharing":   {"shared", "padded"},
    "sync":           {"critical", "atomic", "reduction"},
    "bandwidth":      {"triad"},
    "imbalance":      {"static", "guided", "dynamic"},
    "numaeffects":    {"aware", "unaware"},
    "cachehierarchy": {"L1", "L2", "L3", "DRAM"},
    "simdvec":        {"SoA", "AoS"},
    "tasks":          {"coarse", "fine"},
}
# MPI experiments: halo scaling + collective benchmarking + hybrid MPI+OMP.
ALLOWED_MPI = {"strong", "weak"}
ALLOWED_MPI_COLL = {"broadcast", "reduce", "allreduce", "alltoall"}
ALLOWED_MPI_HYBRID = {"1", "4", "12"}
# GPU occupancy experiment: the two register-pressure profiles.
ALLOWED_CUDA = {"light", "heavy"}
# GPU experiments the vhpce-cuda image dispatches on.
ALLOWED_CUDA_EXP = {"occupancy", "coalesce", "divergence", "atomics", "sharedmem"}
