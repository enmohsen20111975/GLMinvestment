#!/bin/bash
# Auto-restart watchdog for Next.js dev server
# Keeps the server alive by restarting it whenever it dies

cd /home/z/my-project

while true; do
    # Check if Next.js is running
    if ! pgrep -f "next dev" > /dev/null 2>&1; then
        echo "[$(date)] Server not running, restarting..."
        nohup bun run dev > dev.log 2>&1 &
        sleep 5
    fi
    sleep 30  # Check every 30 seconds
done
