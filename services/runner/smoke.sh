#!/usr/bin/env bash
set -e
DIR=/mnt/c/Users/nikos/Documents/HPC/VHPCE/services/runner
BIN=/tmp/vhpce_bench
gcc -O2 -fopenmp -march=native -o "$BIN" "$DIR/experiments/bench.c" -lm
echo "compiled OK"
for spec in "falsesharing shared" "falsesharing padded" "sync critical" "sync reduction" "bandwidth triad" "imbalance static" "imbalance dynamic"; do
  echo "== $spec =="
  s=$(date +%s%3N)
  $BIN $spec 24
  echo
  e=$(date +%s%3N)
  echo "elapsed_ms=$((e-s))"
done
