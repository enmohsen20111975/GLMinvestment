#!/bin/bash
while true; do
  cd /home/z/my-project
  NODE_ENV=production UV_THREADPOOL_SIZE=1 SWC_THREADPOOL=1 RAYON_NUM_THREADS=1 \
    NODE_OPTIONS="--max-old-space-size=2048 --no-warnings" \
    node ./node_modules/.bin/next start -p 3000 2>&1 | tee -a dev.log
  echo "[restart] Server died at $(date), restarting in 2s..."
  sleep 2
done
