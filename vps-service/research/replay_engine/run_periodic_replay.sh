#!/bin/bash
# V40.2 Periodic Replay Runner
# Suggested cron: 0 14 * * 0 (every Saturday 14:00 UTC / 16:00 Cairo)
# Run: bash /home/z/my-project/vps-service/research/replay_engine/run_periodic_replay.sh

set -euo pipefail

VPS_DIR="/home/z/my-project/vps-service"
RESULTS_DIR="$VPS_DIR/research/replay_engine/results"
LOG_FILE="$RESULTS_DIR/replay_log.txt"
RUNNER="$VPS_DIR/research/replay_engine/v40_2_replay_runner.py"

mkdir -p "$RESULTS_DIR"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "" >> "$LOG_FILE"
echo "================================================================================" >> "$LOG_FILE"
echo "  V40.2 Replay — $TIMESTAMP" >> "$LOG_FILE"
echo "================================================================================" >> "$LOG_FILE"

if cd "$VPS_DIR" && python -u "$RUNNER" >> "$LOG_FILE" 2>&1; then
    echo "  ✅ Completed successfully" >> "$LOG_FILE"
else
    echo "  ❌ FAILED with exit code $?" >> "$LOG_FILE"
fi

echo "" >> "$LOG_FILE"
