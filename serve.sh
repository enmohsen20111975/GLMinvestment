#!/bin/bash
cd /home/z/my-project

echo "[$(date)] Starting EGX Analysis server..."

while true; do
  # Clean up any leftover processes
  fuser -k 3000/tcp 2>/dev/null
  sleep 1
  
  # Start Next.js directly (not via bun, to avoid tee pipe issues)
  node node_modules/.bin/next dev -p 3000 > /tmp/next-serve.log 2>&1 &
  echo "[$(date)] Next.js started"
  
  # Wait for port to be available
  for i in $(seq 1 60); do
    if ss -tlnp | grep -q ":3000 "; then
      # Warm up with HTTP/1.1 request
      sleep 2
      curl -s --max-time 30 --http1.1 http://127.0.0.1:3000/ > /dev/null 2>&1
      echo "[$(date)] Server warmed up"
      break
    fi
    sleep 1
  done
  
  # Monitor port instead of PID
  while ss -tlnp | grep -q ":3000 "; do
    sleep 3
  done
  
  echo "[$(date)] Server died, restarting in 2s..."
  sleep 2
done
