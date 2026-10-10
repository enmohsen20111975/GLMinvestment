#!/bin/bash
# scripts/start-sandbox.sh — Sandbox startup script (robust version)
# ============================================
# Starts the GLMinvestment platform in the cloud sandbox using the
# lightweight proxy-server.js pattern (production build + static file
# serving from disk) to avoid Next.js dev-server OOM on the huge codebase.
#
# Architecture:
#   - next start  → port 3001 (Next.js production server, serves API + pages)
#   - proxy-server.js → port 3000 (serves static files from disk +
#     proxies dynamic requests to :3001 + handles WebSocket upgrades
#     to ws-service :3005 so Next.js never sees the upgrade that was
#     crashing it with "Cannot read properties of undefined (reading 'bind')")
#
# This script is invoked by `bun run dev` (see package.json scripts.dev).
# NOTE: no `set -e` — we want the proxy to keep running even if next.js
# dies, and vice-versa. Each process writes to its own log file.

cd /home/z/my-project

# Stop any previous instances
pkill -f "next start" 2>/dev/null || true
pkill -f "proxy-server.js" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

LOG_FILE="${1:-dev.log}"

echo "[sandbox] $(date) Starting GLMinvestment sandbox stack..." | tee -a "$LOG_FILE"
echo "[sandbox] Next.js production server → port 3001" | tee -a "$LOG_FILE"
echo "[sandbox] proxy-server.js         → port 3000 (gateway)" | tee -a "$LOG_FILE"

# Start Next.js production server on port 3001 (detached, survives parent exit)
# Writes its own log to /tmp/next-3001.log so we can inspect without interfering.
nohup env NODE_ENV=production \
  UV_THREADPOOL_SIZE=1 \
  SWC_THREADPOOL=1 \
  RAYON_NUM_THREADS=1 \
  NODE_OPTIONS='--max-old-space-size=512 --no-warnings' \
  node_modules/.bin/next start -p 3001 > /tmp/next-3001.log 2>&1 &
NEXT_PID=$!
disown $NEXT_PID 2>/dev/null || true
echo "[sandbox] Next.js PID: $NEXT_PID (logs: /tmp/next-3001.log)" | tee -a "$LOG_FILE"

# Wait for Next.js to be ready on 3001
echo "[sandbox] Waiting for Next.js on :3001..." | tee -a "$LOG_FILE"
READY=0
for i in $(seq 1 30); do
  if curl -s --max-time 2 http://127.0.0.1:3001/ > /dev/null 2>&1; then
    echo "[sandbox] Next.js ready on :3001 (after ${i}s)" | tee -a "$LOG_FILE"
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "[sandbox] WARNING: Next.js did not become ready on :3001, proxy will still start" | tee -a "$LOG_FILE"
fi

# Start proxy-server.js on port 3000 — this is the foreground process
# that keeps the bun run dev job alive. It writes to dev.log.
echo "[sandbox] Starting proxy-server.js on port 3000..." | tee -a "$LOG_FILE"
exec node proxy-server.js
