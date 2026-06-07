# VHPCE GPU image - the flagship "GPU Occupancy" kernel, compiled with nvcc.
# Build context is the REPO ROOT (to COPY the kernel source):
#   docker build -t vhpce-cuda -f infra/docker/cuda.Dockerfile .
# Run with the GPU passed in (and locked down otherwise):
#   docker run --rm --gpus all --network none --cap-drop ALL --read-only \
#     --tmpfs /tmp:rw,exec vhpce-cuda <light|heavy>
# Emits {"exp":"cuda","variant":..,"points":[{"p":<block>,"ms":..,"occ":..,"gflops":..}],"sm":..,...}
#
# devel image carries nvcc + the CUDA runtime. A multi-GB pull (one-time).
FROM nvidia/cuda:12.6.2-devel-ubuntu24.04

COPY services/runner/experiments/occupancy.cu /tmp/occupancy.cu
# Target this GPU (Blackwell sm_120) natively if the toolkit supports it; otherwise emit
# compute_90 PTX and let the (newer) driver JIT it forward to sm_120 at runtime.
RUN (nvcc -O2 -arch=sm_120 -o /usr/local/bin/occupancy /tmp/occupancy.cu \
      || nvcc -O2 -gencode arch=compute_90,code=compute_90 -o /usr/local/bin/occupancy /tmp/occupancy.cu) \
 && rm /tmp/occupancy.cu

# Read-only rootfs: keep the CUDA JIT cache on the tmpfs.
ENV CUDA_CACHE_PATH=/tmp/.nv
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/occupancy"]
