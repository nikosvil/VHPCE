#!/usr/bin/env bash
# Reads C source on stdin, compiles it, times the program across a thread sweep
# (best-of-REPS wall time), and optionally profiles cache misses with cachegrind.
# Emits one JSON object on stdout:
#   {"points":[{"p":1,"ms":...}, ...][,"cache":{...}]}   or   {"error":"compile","message":"..."}
set -uo pipefail

SWEEP="${1:-1 2 4 8 12 16 24}"
REPS="${2:-2}"
PROFILE="${3:-0}"

cat > /tmp/user.c

if ! gcc -O2 -fopenmp -march=native -o /tmp/a.out /tmp/user.c -lm 2> /tmp/cc.err; then
  msg=$(tr '\n\t' '  ' < /tmp/cc.err | sed 's/[\\"]/ /g' | cut -c1-1500)
  printf '{"error":"compile","message":"%s"}\n' "$msg"
  exit 0
fi

# --- timing sweep ---
pts=""
for p in $SWEEP; do
  best=2147483647
  for _ in $(seq 1 "$REPS"); do
    s=$(date +%s%N)
    OMP_NUM_THREADS="$p" timeout 12 /tmp/a.out > /dev/null 2>&1
    e=$(date +%s%N)
    ms=$(( (e - s) / 1000000 ))
    [ "$ms" -lt "$best" ] && best=$ms
  done
  if [ -z "$pts" ]; then pts="{\"p\":$p,\"ms\":$best}"; else pts="$pts,{\"p\":$p,\"ms\":$best}"; fi
done

out="{\"points\":[$pts]"

# --- optional cache profiling (cachegrind: simulated cache, single-threaded, ~20-50x slower) ---
if [ "$PROFILE" = "1" ]; then
  if OMP_NUM_THREADS=1 timeout 90 valgrind --tool=cachegrind --cache-sim=yes --cachegrind-out-file=/tmp/cg.out /tmp/a.out > /dev/null 2> /tmp/cg.err; then
    d1=$(grep -m1 -E 'D1 +miss rate'  /tmp/cg.err | grep -oE '[0-9.]+%' | head -1 | tr -d '%')
    lld=$(grep -m1 -E 'LLd +miss rate' /tmp/cg.err | grep -oE '[0-9.]+%' | head -1 | tr -d '%')
    ll=$(grep -m1 -E 'LL +miss rate'  /tmp/cg.err | grep -oE '[0-9.]+%' | head -1 | tr -d '%')
    irefs=$(grep -m1 -E 'I +refs'     /tmp/cg.err | grep -oE '[0-9,]+'  | tail -1 | tr -d ',')
    out="$out,\"cache\":{\"d1MissPct\":${d1:-null},\"lldMissPct\":${lld:-null},\"llMissPct\":${ll:-null},\"irefs\":${irefs:-null}}"
  else
    out="$out,\"cache\":{\"error\":\"cachegrind timed out or failed (try a smaller workload)\"}"
  fi
fi

out="$out}"
printf '%s\n' "$out"
