#!/bin/bash
# ============================================================================
# check_cron.sh — Check EGX Sniper System cron status and recent logs
# ============================================================================

set -euo pipefail

VPS_DIR="/root/GLMinvestment/vps-service"
LOG_DIR="${VPS_DIR}/logs"

echo "========================================="
echo "  EGX Sniper System — Cron Status"
echo "========================================="
echo ""

# --- Show current crontab ---
echo "📋 Current crontab:"
echo "-------------------"
crontab -l 2>/dev/null || echo "(no crontab configured)"
echo ""

# --- Check closer log ---
CLOSER_LOG="${LOG_DIR}/closer.log"
echo "📝 Daily Closer log (last 20 lines):"
echo "-----------------------------------"
if [ -f "$CLOSER_LOG" ]; then
    tail -20 "$CLOSER_LOG"
else
    echo "(log file not found: $CLOSER_LOG)"
fi
echo ""

# --- Check learning log ---
LEARNING_LOG="${LOG_DIR}/learning.log"
echo "📝 Learning Engine log (last 20 lines):"
echo "--------------------------------------"
if [ -f "$LEARNING_LOG" ]; then
    tail -20 "$LEARNING_LOG"
else
    echo "(log file not found: $LEARNING_LOG)"
fi
echo ""

# --- Quick health summary ---
echo "🏥 Health Summary:"
echo "-----------------"
echo "  Closer log exists:  $([ -f "$CLOSER_LOG" ] && echo 'YES' || echo 'NO')"
echo "  Learning log exists: $([ -f "$LEARNING_LOG" ] && echo 'YES' || echo 'NO')"
echo "  Closer last run:    $([ -f "$CLOSER_LOG" ] && stat -c '%y' "$CLOSER_LOG" 2>/dev/null | cut -d'.' -f1 || echo 'N/A')"
echo "  Learning last run:  $([ -f "$LEARNING_LOG" ] && stat -c '%y' "$LEARNING_LOG" 2>/dev/null | cut -d'.' -f1 || echo 'N/A')"
