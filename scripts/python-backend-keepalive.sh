#!/bin/bash
# Keepalive script for Python backend - restarts it if it dies
LOG="/home/z/my-project/python_backend.log"
PID_FILE="/home/z/my-project/python_backend.pid"

while true; do
    # Check if port 8010 is in use
    if ! ss -tlnp 2>/dev/null | grep -q ":8010 "; then
        echo "[$(date)] Starting Python backend..." >> "$LOG"
        cd /home/z/my-project/vps-service
        python3 -u main.py >> "$LOG" 2>&1 &
        BACKEND_PID=$!
        echo $BACKEND_PID > "$PID_FILE"
        
        # Wait for it to bind
        for i in $(seq 1 10); do
            sleep 1
            if ss -tlnp 2>/dev/null | grep -q ":8010 "; then
                echo "[$(date)] Python backend started (PID $BACKEND_PID)" >> "$LOG"
                break
            fi
            if ! kill -0 $BACKEND_PID 2>/dev/null; then
                echo "[$(date)] Python backend died during startup" >> "$LOG"
                break
            fi
        done
    fi
    
    sleep 30
done
