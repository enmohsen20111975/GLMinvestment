#!/bin/bash
cd /home/z/my-project
while true; do
  echo "Starting dev server at $(date)..."
  npx next dev -p 3000 --webpack 2>&1
  echo "Server crashed at $(date), restarting in 3s..."
  sleep 3
done
