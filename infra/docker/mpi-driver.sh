#!/usr/bin/env bash
# Runs the MPI rank sweep for the flagship "MPI Halo Exchange" experiment.
# For k = 1..MAXRANKS, launch the halo kernel on k ranks (best-of-REPS wall time),
# then emit one JSON object on stdout — the same {exp,variant,points:[{p,ms}]} shape
# the OpenMP bench produces, so the ProfileResult seam consumes it unchanged.
#
# Modes:
#   mpi-driver.sh <strong|weak> <maxranks> <Nbase> <iters>
#   mpi-driver.sh collective   <maxranks> <collective_type>      (broadcast|reduce|allreduce|alltoall)
#   mpi-driver.sh hybrid       <maxranks> <threads_per_rank>
set -uo pipefail

MODE="${1:-strong}"
MAXRANKS="${2:-24}"
REPS=2

# ── collective mode: sweep rank counts, run a single collective type ──
if [ "$MODE" = "collective" ]; then
  COLLTYPE="${3:-allreduce}"
  prev=""
  pts=""
  k=1
  while [ "$k" -le "$MAXRANKS" ]; do
    best=""
    for ((r = 0; r < REPS; r++)); do
      raw=$(timeout -k 5 45 mpirun --oversubscribe --bind-to none -np "$k" /usr/local/bin/halo collective "$COLLTYPE" 2>/dev/null)
      ms=$(printf '%s\n' "$raw" | grep -E '^[0-9]+(\.[0-9]+)?$' | tail -1)
      [ -z "$ms" ] && continue
      if [ -z "$best" ] || awk "BEGIN{exit !($ms < $best)}"; then best="$ms"; fi
    done
    [ -z "$best" ] && best="${prev:-1}"
    prev="$best"
    if [ -z "$pts" ]; then pts="{\"p\":$k,\"ms\":$best}"; else pts="$pts,{\"p\":$k,\"ms\":$best}"; fi
    # Power-of-2 sweep: 1, 2, 4, 8, ..., MAXRANKS
    if [ "$k" -eq 1 ]; then k=2; else k=$((k * 2)); fi
  done
  printf '{"exp":"collective","variant":"%s","points":[%s]}\n' "$COLLTYPE" "$pts"
  exit 0
fi

# ── hybrid mode: sweep rank counts, each rank runs tpr OpenMP threads ──
if [ "$MODE" = "hybrid" ]; then
  TPR="${3:-4}"
  prev=""
  pts=""
  k=1
  while [ "$k" -le "$MAXRANKS" ]; do
    best=""
    for ((r = 0; r < REPS; r++)); do
      raw=$(timeout -k 5 45 mpirun --oversubscribe --bind-to none -np "$k" -x OMP_NUM_THREADS="$TPR" /usr/local/bin/halo hybrid "$TPR" 2>/dev/null)
      ms=$(printf '%s\n' "$raw" | grep -E '^[0-9]+(\.[0-9]+)?$' | tail -1)
      [ -z "$ms" ] && continue
      if [ -z "$best" ] || awk "BEGIN{exit !($ms < $best)}"; then best="$ms"; fi
    done
    [ -z "$best" ] && best="${prev:-1}"
    prev="$best"
    if [ -z "$pts" ]; then pts="{\"p\":$k,\"ms\":$best}"; else pts="$pts,{\"p\":$k,\"ms\":$best}"; fi
    if [ "$k" -eq 1 ]; then k=2; else k=$((k * 2)); fi
  done
  printf '{"exp":"hybrid","variant":"%s","points":[%s]}\n' "$TPR" "$pts"
  exit 0
fi

# ── legacy strong|weak halo-exchange mode ──
NBASE="${3:-2000000}"
ITERS="${4:-60}"

case "$MODE" in strong|weak) ;; *) printf '{"error":"badrequest","message":"unknown mode: %s"}\n' "$MODE"; exit 0;; esac

prev=""
pts=""
for ((k = 1; k <= MAXRANKS; k++)); do
  best=""
  for ((r = 0; r < REPS; r++)); do
    # Per-launch timeout: OpenMPI's launcher occasionally stalls; cap each run so one stuck
    # launch can't consume the whole job budget (best-of-REPS usually still lands a number).
    # --bind-to none avoids binding contention when ranks approach/exceed the core count.
    raw=$(timeout -k 5 45 mpirun --oversubscribe --bind-to none -np "$k" /usr/local/bin/halo "$MODE" "$NBASE" "$ITERS" 2>/dev/null)
    ms=$(printf '%s\n' "$raw" | grep -E '^[0-9]+(\.[0-9]+)?$' | tail -1)
    [ -z "$ms" ] && continue
    if [ -z "$best" ] || awk "BEGIN{exit !($ms < $best)}"; then best="$ms"; fi
  done
  # Graceful fallback if both reps failed: reuse the previous point (never emit ms:0).
  [ -z "$best" ] && best="${prev:-1}"
  prev="$best"
  if [ -z "$pts" ]; then pts="{\"p\":$k,\"ms\":$best}"; else pts="$pts,{\"p\":$k,\"ms\":$best}"; fi
done

printf '{"exp":"mpi","variant":"%s","points":[%s]}\n' "$MODE" "$pts"
