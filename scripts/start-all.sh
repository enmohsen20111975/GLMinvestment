#!/bin/bash
# Master startup script — يبدأ كل الـ services المطلوبة للمشروع.
# Rule 29 (UNIFIED-SYSTEM): كل الـ services في مكان واحد.

set -e

# Resolve PROJECT_ROOT dynamically (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Resolve PYTHON_BIN: prefer project-local venv, fallback to system python3
if [ -x "$PROJECT_ROOT/.venv/bin/python3" ]; then
    PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python3"
elif [ -n "$VIRTUAL_ENV" ] && [ -x "$VIRTUAL_ENV/bin/python3" ]; then
    PYTHON_BIN="$VIRTUAL_ENV/bin/python3"
else
    PYTHON_BIN="python3"
fi

LOG_DIR="${LOG_DIR:-$PROJECT_ROOT/logs}"

mkdir -p "$LOG_DIR"

echo "================================================"
echo "  GLMinvestment Master Startup"
echo "================================================"
echo ""

# === 1. Python backend (port 8010) ===
echo "[1/3] Starting Python backend (port 8010)..."
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:8010/api/market-pulse" 2>&1; then
    echo "  ✓ Python backend already running"
else
    nohup $PYTHON_BIN -m uvicorn vps-service.main:app --host 0.0.0.0 --port 8010 --workers 1 > "$LOG_DIR/python-backend.log" 2>&1 < /dev/null &
    disown
    echo "  ✓ Started (waiting for ready...)"
    sleep 8
    if curl -s -o /dev/null --max-time 5 "http://127.0.0.1:8010/api/market-pulse" 2>&1; then
        echo "  ✓ Ready"
    else
        echo "  ⚠ Failed to start — check $LOG_DIR/python-backend.log"
    fi
fi

# === 2. Master scheduler (scrapers) ===
echo ""
echo "[2/3] Starting master scheduler (scrapers)..."
if pgrep -f "master_scheduler" > /dev/null 2>&1; then
    echo "  ✓ Master scheduler already running"
else
    nohup $PYTHON_BIN "$PROJECT_ROOT/scripts/master_scheduler.py" > "$LOG_DIR/master-scheduler.log" 2>&1 < /dev/null &
    disown
    echo "  ✓ Started"
fi

# === 3. Next.js dev server (port 3000/3001) ===
echo ""
echo "[3/3] Checking Next.js dev server..."
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:3000/api/health" 2>&1; then
    echo "  ✓ Next.js already running"
else
    echo "  ⚠ Next.js not running — start manually with: bun run dev"
fi

echo ""
echo "================================================"
echo "  Status Summary"
echo "================================================"
echo "Python backend (8010): $(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8010/api/market-pulse 2>&1 || echo '000')"
echo "Master scheduler:     $(pgrep -f master_scheduler > /dev/null && echo '✓ running' || echo '✗ not running')"
echo "Next.js (3000):       $(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/api/health 2>&1 || echo '000')"
echo ""
echo "Logs:"
echo "  Python backend: $LOG_DIR/python-backend.log"
echo "  Scheduler:      $LOG_DIR/master-scheduler.log"
echo "  Next.js:         $PROJECT_ROOT/dev.log"
echo "================================================"
