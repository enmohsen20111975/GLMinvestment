#!/bin/bash
# Auto-restart wrapper for Python backend.
# لو الـ uvicorn مات، يشتغل تاني تلقائياً.

PYTHON_BIN=/home/z/.venv/bin/python3
APP="vps-service.main:app"
PORT=8010
LOG=/home/z/my-project/logs/python-backend.log
MAX_RESTARTS=10
RESTART_DELAY=3

restart_count=0
while [ $restart_count -lt $MAX_RESTARTS ]; do
    echo "[$(date '+%H:%M:%S')] Starting Python backend (attempt $((restart_count+1))/$MAX_RESTARTS)..."
    $PYTHON_BIN -m uvicorn $APP --host 0.0.0.0 --port $PORT --workers 2 --limit-concurrency 10 >> $LOG 2>&1
    EXIT_CODE=$?
    echo "[$(date '+%H:%M:%S')] Python backend exited with code $EXIT_CODE. Restarting in ${RESTART_DELAY}s..."
    sleep $RESTART_DELAY
    restart_count=$((restart_count+1))
done
echo "[$(date '+%H:%M:%S')] Max restarts ($MAX_RESTARTS) reached. Giving up."
