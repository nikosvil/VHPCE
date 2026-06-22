# VHPCE MPI image — the flagship "MPI Halo Exchange" kernel, pre-compiled with OpenMPI.
# Build context is the REPO ROOT (to COPY the kernel source + driver):
#   docker build -t vhpce-mpi -f infra/docker/mpi.Dockerfile .
# Run (single node; ranks oversubscribe the 24 cores past k=24, capped at 24 here):
#   docker run --rm --network none --cap-drop ALL --read-only --tmpfs /tmp:rw,exec \
#     vhpce-mpi <strong|weak|collective|hybrid> <maxranks> ...
# Emits {"exp":"mpi"|"collective"|"hybrid","variant":..,"points":[{"p":k,"ms":..}, ...]} — the RunnerData shape.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev openmpi-bin libopenmpi-dev \
 && rm -rf /var/lib/apt/lists/*

COPY services/runner/experiments/halo.c /tmp/halo.c
RUN mpicc -O2 -fopenmp -lm -o /usr/local/bin/halo /tmp/halo.c && rm /tmp/halo.c

COPY infra/docker/mpi-driver.sh /usr/local/bin/mpi-driver.sh
RUN chmod +x /usr/local/bin/mpi-driver.sh

# OpenMPI/PRRTE wants a writable HOME + TMPDIR; with a read-only rootfs that's the /tmp tmpfs.
# Single-node shared-memory transport — no network needed.
ENV HOME=/tmp \
    TMPDIR=/tmp \
    OMPI_MCA_btl=vader,self \
    OMPI_MCA_plm_rsh_agent=false

USER 1000:1000
WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/mpi-driver.sh"]
