#!/usr/bin/env bash
# Reads C source on stdin, compiles it, and times the program across a thread
# sweep (best-of-REPS wall time per thread count). Emits JSON on stdout:
#   {"points":[{"p":1,"ms":...}, ...]}  or  {"error":"compile","message":"..."}
set -uo pipefail

SWEEP="${1:-1 2 4 8 12 16 24}"
REPS="${2:-2}"

cat > /tmp/user.c

if ! gcc -O2 -fopenmp -march=native -o /tmp/a.out /tmp/user.c -lm 2> /tmp/cc.err; then
  msg=$(tr '\n\t' '  ' < /tmp/cc.err | sed 's/[\\"]/ /g' | cut -c1-1500)
  printf '{"error":"compile","message":"%s"}\n' "$msg"
  exit 0
fi

printf '{"points":['
first=1
for p in $SWEEP; do
  best=2147483647
  for _ in $(seq 1 "$REPS"); do
    s=$(date +%s%N)
    OMP_NUM_THREADS="$p" timeout 12 /tmp/a.out > /dev/null 2>&1
    e=$(date +%s%N)
    ms=$(( (e - s) / 1000000 ))
    [ "$ms" -lt "$best" ] && best=$ms
  done
  [ "$first" -eq 1 ] || printf ','
  first=0
  printf '{"p":%d,"ms":%d}' "$p" "$best"
done
printf ']}\n'
