#!/bin/bash
# Wrapper to run full 750-ticker backtest truly daemonized
# Writes a "done" marker when complete so we can poll across bash sessions
cd /home/z/my-project

OUTDIR=vps-service/backtest_results/proof_20260817
mkdir -p "$OUTDIR"

run_backtest() {
  local mode=$1
  local extra=$2
  local outfile="$OUTDIR/${mode}_fresh_full750.json"
  local donefile="$OUTDIR/${mode}_fresh_full750.done"
  local logfile="$OUTDIR/${mode}_fresh_full750.log"

  rm -f "$donefile" "$outfile" "${outfile}_trades.json"

  python3 vps-service/engines/v38_backtest_engine.py \
    --all \
    $extra \
    --start 2026-02-01 --end 2026-06-02 \
    --scan-interval 3 --max-picks 10 --threshold 75 \
    --quiet \
    --output "$outfile" \
    > "$logfile" 2>&1

  echo "completed at $(date)" > "$donefile"
}

# Run V39.3 (the current/fixed version) - most important
run_backtest "v393" "--use-v393" &
V393_PID=$!

# Run V38 baseline (old version, for comparison) - in parallel
run_backtest "v38" "" &
V38_PID=$!

# Wait for both (with overall timeout of 25 minutes)
timeout 1500 wait $V393_PID $V38_PID 2>/dev/null

echo "Both backtests finished at $(date)"
ls -la "$OUTDIR"/*full750* 2>/dev/null
