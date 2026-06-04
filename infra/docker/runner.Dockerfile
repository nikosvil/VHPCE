# VHPCE code-runner image — compiles and benchmarks untrusted OpenMP C.
# Run locked down: --network none --cap-drop ALL --read-only --tmpfs /tmp:exec
# --memory 2g --pids-limit 256, with a host-side timeout. Source arrives on stdin.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev valgrind \
 && rm -rf /var/lib/apt/lists/*

COPY bench-driver.sh /usr/local/bin/bench-driver.sh
RUN chmod +x /usr/local/bin/bench-driver.sh

# Run as a non-root uid (no passwd entry needed); only /tmp (tmpfs) is writable.
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/bench-driver.sh"]
