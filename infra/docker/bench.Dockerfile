# VHPCE fixed-kernel image — the four flagship OpenMP experiments, pre-compiled.
# Build context is the REPO ROOT so it can COPY the kernel source:
#   docker build -t vhpce-bench -f infra/docker/bench.Dockerfile .
# Run locked down (it only computes and prints JSON — no network, no caps):
#   docker run --rm --network none --cap-drop ALL --read-only --memory 2g \
#     vhpce-bench <exp> <variant> <maxthreads>
# Emits {"exp":..,"variant":..,"points":[{"p":..,"ms":..[,"gbps":..,"gflops":..]}, ...]}
# — exactly the RunnerData shape the ProfileResult seam consumes.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

# Compiled at build time with -march=native: on WSL2 the build daemon sees this host's CPU.
COPY services/runner/experiments/bench.c /tmp/bench.c
RUN gcc -O2 -fopenmp -march=native -o /usr/local/bin/bench /tmp/bench.c -lm \
 && rm /tmp/bench.c

USER 1000:1000
ENTRYPOINT ["/usr/local/bin/bench"]
