#!/bin/bash
# scripts/watchdog.sh — Sandbox watchdog (auto-restart on crash)
# ============================================
# Architecture:
#   - next dev  → port 3001 (Next.js dev server — no build required)
#   - proxy-server.js → port 3000 (static files + proxy to :3001 + WS upgrade)
#
# IMPORTANT: `next dev` spawns a child `next-server` process. We use pgrep
# to check if the next-server child is alive (not the stored parent PID,
# which exits immediately after spawning the child).
#
# Logs: dev.log (proxy) + /tmp/next.log (next dev)
cd /home/z/my-project

LOG=/home/z/my-project/dev.log

echo "[$(date)] watchdog: starting sandbox stack..." > "$LOG"

# Only kill existing processes if next-server is NOT already running
if ! pgrep -f "next-server" > /dev/null 2>&1; then
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
  echo "[$(date)] watchdog: cleaned stale processes" >> "$LOG"
fi

start_next() {
  echo "[$(date)] watchdog: starting next dev on :3001..." >> "$LOG"
  ( setsid env NODE_ENV=development NODE_OPTIONS='--max-old-space-size=2048 --no-warnings' node_modules/.bin/next dev -p 3001 > /tmp/next.log 2>&1 < /dev/null & )
  echo "[$(date)] watchdog: next dev launched" >> "$LOG"
}

start_proxy() {
  echo "[$(date)] watchdog: starting proxy-server.js on :3000..." >> "$LOG"
  setsid bash -c 'exec node /home/z/my-project/proxy-server.js' >> "$LOG" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  echo "[$(date)] watchdog: proxy launched" >> "$LOG"
}

# Initial start — only start if not already running
if ! pgrep -f "next-server" > /dev/null 2>&1; then
  start_next
  sleep 5
else
  echo "[$(date)] watchdog: next-server already running, skipping start" >> "$LOG"
fi
if ! pgrep -f "proxy-server.js" > /dev/null 2>&1; then
  start_proxy
else
  echo "[$(date)] watchdog: proxy already running, skipping start" >> "$LOG"
fi

# Trigger initial compile of / in the background
echo "[$(date)] watchdog: triggering initial / compile..." >> "$LOG"
( curl -s --max-time 180 http://127.0.0.1:3001/ > /dev/null 2>&1 ) &

# Infinite watchdog loop — uses pgrep to check PROCESS health
echo "[$(date)] watchdog: entering monitor loop..." >> "$LOG"
while true; do
  sleep 20
  # Check next-server child process is alive
  if ! pgrep -f "next-server" > /dev/null 2>&1; then
    echo "[$(date)] watchdog: next-server not running, restarting..." >> "$LOG"
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "next-server" 2>/dev/null || true
    sleep 3
    start_next
    sleep 5
    # Trigger compile
    ( curl -s --max-time 180 http://127.0.0.1:3001/ > /dev/null 2>&1 ) &
  fi
  # Check proxy-server.js
  if ! pgrep -f "proxy-server.js" > /dev/null 2>&1; then
    echo "[$(date)] watchdog: proxy-server not running, restarting..." >> "$LOG"
    pkill -f "proxy-server.js" 2>/dev/null || true
    sleep 2
    start_proxy
  fi
done
