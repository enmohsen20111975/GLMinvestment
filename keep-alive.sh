#!/bin/bash
while true; do
  if ! pgrep -f "next dev" > /dev/null 2>&1; then
    echo "[$(date)] Server died, restarting..." >> dev.log
    rm -rf .next
    bun run dev >> dev.log 2>&1 &
    SERVER_PID=$!
    echo "[$(date)] Started server PID=$SERVER_PID" >> dev.log
  fi
  sleep 5
done
