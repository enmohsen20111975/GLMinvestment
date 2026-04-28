#!/bin/bash
# =============================================================================
# start.sh — EGXPy Bridge Service Manager
# =============================================================================
# Usage:
#   ./start.sh          Start the service
#   ./start.sh stop     Stop the service
#   ./start.sh restart  Restart the service
#   ./start.sh status   Check status
#   ./start.sh logs     Tail logs
#   ./start.sh test     Run health check
# =============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$DIR/venv"
PORT="${EGXPY_PORT:-8010}"
PID_FILE="$DIR/.service.pid"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/service.log"

mkdir -p "$LOG_DIR"

# Ensure venv exists
if [ ! -d "$VENV_DIR" ]; then
    echo "Virtual environment not found. Run deploy.sh first."
    echo "  cd $DIR && ./deploy.sh"
    exit 1
fi

# Source venv
source "$VENV_DIR/bin/activate"

start_service() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Service is already running (PID: $(cat "$PID_FILE"))"
        return
    fi

    echo "[$(date)] Starting EGXPy Bridge on port $PORT..." | tee -a "$LOG_FILE"
    nohup python3 -m uvicorn main:app \
        --host 0.0.0.0 \
        --port "$PORT" \
        --log-level warning \
        >> "$LOG_FILE" 2>&1 &
    
    echo $! > "$PID_FILE"
    sleep 2

    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Service started successfully (PID: $(cat "$PID_FILE"))"
        echo "  Health: http://localhost:$PORT/health"
        echo "  Logs:   $LOG_FILE"
    else
        echo "ERROR: Service failed to start. Check $LOG_FILE"
        rm -f "$PID_FILE"
    fi
}

stop_service() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Service is not running (no PID file found)."
        return
    fi

    PID="$(cat "$PID_FILE")"
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping service (PID: $PID)..."
        kill "$PID"
        sleep 2
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null || true
            echo "Force killed."
        else
            echo "Service stopped."
        fi
    else
        echo "Process $PID is not running."
    fi
    rm -f "$PID_FILE"
}

restart_service() {
    stop_service
    sleep 1
    start_service
}

show_status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        PID="$(cat "$PID_FILE")"
        echo "Service: RUNNING (PID: $PID)"
        echo "Port:    $PORT"
        echo "Since:   $(ps -o lstart= -p "$PID" 2>/dev/null || echo 'unknown')"
        echo "Memory:  $(ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "%.1f MB", $1/1024}' || echo 'unknown')"
        
        # Quick health check
        HEALTH=$(curl -s --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || echo "")
        if echo "$HEALTH" | grep -q "healthy"; then
            echo "Health:  OK"
        else
            echo "Health:  UNRESPONSIVE"
        fi
    else
        echo "Service: STOPPED"
    fi
}

show_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -50 "$LOG_FILE"
    else
        echo "No log file found at $LOG_FILE"
    fi
}

test_health() {
    echo "Testing EGXPy Bridge API..."
    echo ""
    
    # Health check
    echo -n "  Health: "
    HEALTH=$(curl -s --max-time 5 "http://localhost:$PORT/health" 2>/dev/null)
    if echo "$HEALTH" | grep -q "healthy"; then
        echo "OK"
    else
        echo "FAILED ($HEALTH)"
        return 1
    fi

    # Data stats
    echo -n "  Stats: "
    STATS=$(curl -s --max-time 5 "http://localhost:$PORT/api/data/stats" 2>/dev/null)
    if echo "$STATS" | grep -q "success"; then
        echo "OK"
    else
        echo "FAILED"
    fi

    # Single quote
    echo -n "  Quote (COMI): "
    QUOTE=$(curl -s --max-time 10 "http://localhost:$PORT/api/stocks/COMI" 2>/dev/null)
    if echo "$QUOTE" | grep -q "current_price"; then
        PRICE=$(echo "$QUOTE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('current_price','?'))" 2>/dev/null || echo "?")
        echo "OK (price: $PRICE)"
    else
        echo "FAILED (data may not be available for this ticker)"
    fi

    echo ""
    echo "All basic tests complete."
}

# ---- Main ----
case "${1:-start}" in
    start)   start_service ;;
    stop)    stop_service ;;
    restart) restart_service ;;
    status)  show_status ;;
    logs)    show_logs ;;
    test)    test_health ;;
    *)       echo "Usage: $0 {start|stop|restart|status|logs|test}" ;;
esac
