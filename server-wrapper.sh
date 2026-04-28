#!/bin/bash
while true; do
  cd /home/z/my-project
  echo "[$(date)] Starting..." >> /home/z/my-project/dev.log
  UV_THREADPOOL_SIZE=2 node --max-old-space-size=256 /home/z/my-project/node-server.js >> /home/z/my-project/dev.log 2>&1
  echo "[$(date)] Exited, restarting in 2s..." >> /home/z/my-project/dev.log
  sleep 2
done
