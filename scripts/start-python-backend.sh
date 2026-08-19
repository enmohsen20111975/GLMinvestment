#!/bin/bash
# ============================================================
# Start Python Backend (port 8010) — آمن للـ 3 بيئات
# ============================================================
# - لو Python backend شغال على port 8010 (PM2 في الإنتاج، أو يدوي في اللابتوب):
#   → يطبع "already running" ويفضل Next.js يشتغل
# - لو مش شغال (sandbox):
#   → يبدأه في الـ background مع nohup
#
# هذا السكربت آمن للاستخدام في:
#   1. السيرفر الإنتاجي (PM2 يدير Python backend على 8010)
#   2. اللابتوب (الـ user يدير Python backend يدوياً)
#   3. sandbox (هذا السكربت يبدأ Python backend تلقائياً)
# ============================================================

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${PROJECT_ROOT}/python_backend.log"

# Check if port 8010 is in use (the only reliable cross-environment check)
if ss -tlnp 2>/dev/null | grep -q ":8010 "; then
  echo "[dev] ✓ Port 8010 already in use (Python backend running)"
  exit 0
fi

# Start Python backend in background
# Use venv if available (sandbox/laptop), else system python3 (production with PM2)
VENV_PYTHON="${PROJECT_ROOT}/vps-service/venv/bin/python3"
if [ -x "$VENV_PYTHON" ]; then
  PYTHON_CMD="$VENV_PYTHON"
  echo "[dev] Using venv python: $PYTHON_CMD"
else
  PYTHON_CMD="python3"
  echo "[dev] Using system python3 (no venv found)"
fi

echo "[dev] Starting Python backend on port 8010..."
cd "${PROJECT_ROOT}/vps-service"
nohup $PYTHON_CMD -u main.py > "${LOG_FILE}" 2>&1 < /dev/null &
BACKEND_PID=$!
disown $BACKEND_PID 2>/dev/null

# Wait for it to bind to port
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if ss -tlnp 2>/dev/null | grep -q ":8010 "; then
    echo "[dev] ✓ Python backend started (PID ${BACKEND_PID}) on port 8010"
    exit 0
  fi
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "[dev] ⚠ Python backend died during startup — check ${LOG_FILE}"
    exit 0  # Continue anyway so Next.js can start
  fi
done

echo "[dev] ⚠ Python backend didn't bind to 8010 in 10s — check ${LOG_FILE}"
exit 0  # Continue anyway so Next.js can start
