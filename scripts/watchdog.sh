#!/bin/bash
# scripts/watchdog.sh — Sandbox watchdog (auto-restart on crash)
# ============================================
# Keeps the GLMinvestment sandbox stack alive even if the parent bash
# session that launched it exits. The kata sandbox reaps processes that
# belong to a terminated session, so we use `setsid` (new session) +
# an infinite restart loop.
#
# Architecture (same as start-sandbox.sh):
#   - next start  → port 3001 (Next.js production server)
#   - proxy-server.js → port 3000 (static files + proxy to :3001 + WS upgrade)
#
# Logs: dev.log (proxy) + /tmp/next.log (next start)
cd /home/z/my-project

LOG=/home/z/my-project/dev.log

echo "[$(date)] watchdog: starting sandbox stack..." > "$LOG"

# Ensure clean state
pkill -f "next start" 2>/dev/null || true
pkill -f "proxy-server.js" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

start_next() {
  echo "[$(date)] watchdog: starting next start on :3001..." >> "$LOG"
  setsid env NODE_ENV=production \
    UV_THREADPOOL_SIZE=1 \
    SWC_THREADPOOL=1 \
    RAYON_NUM_THREADS=1 \
    NODE_OPTIONS='--max-old-space-size=512 --no-warnings' \
    node_modules/.bin/next start -p 3001 >> /tmp/next.log 2>&1 < /dev/null &
  NEXT_PID=$!
  disown $NEXT_PID 2>/dev/null || true
  echo "[$(date)] watchdog: next start PID=$NEXT_PID" >> "$LOG"
}

start_proxy() {
  echo "[$(date)] watchdog: starting proxy-server.js on :3000..." >> "$LOG"
  setsid node /home/z/my-project/proxy-server.js >> "$LOG" 2>&1 < /dev/null &
  PROXY_PID=$!
  disown $PROXY_PID 2>/dev/null || true
  echo "[$(date)] watchdog: proxy PID=$PROXY_PID" >> "$LOG"
}

# Initial start
start_next
# Wait for next start to be ready
for i in $(seq 1 30); do
  if curl -s --max-time 2 http://127.0.0.1:3001/ > /dev/null 2>&1; then
    echo "[$(date)] watchdog: next start ready on :3001 (after ${i}s)" >> "$LOG"
    break
  fi
  sleep 1
done
start_proxy

# Infinite watchdog loop
echo "[$(date)] watchdog: entering monitor loop..." >> "$LOG"
while true; do
  sleep 10
  # Check next start
  if ! curl -s --max-time 3 http://127.0.0.1:3001/ > /dev/null 2>&1; then
    echo "[$(date)] watchdog: next start died, restarting..." >> "$LOG"
    pkill -f "next start" 2>/dev/null || true
    pkill -f "next-server" 2>/dev/null || true
    sleep 2
    start_next
    # Wait for readiness
    for i in $(seq 1 20); do
      if curl -s --max-time 2 http://127.0.0.1:3001/ > /dev/null 2>&1; then
        echo "[$(date)] watchdog: next start recovered (after ${i}s)" >> "$LOG"
        break
      fi
      sleep 1
    done
  fi
  # Check proxy-server.js
  if ! curl -s --max-time 3 http://127.0.0.1:3000/ > /dev/null 2>&1; then
    echo "[$(date)] watchdog: proxy-server died, restarting..." >> "$LOG"
    pkill -f "proxy-server.js" 2>/dev/null || true
    sleep 2
    start_proxy
  fi
done
