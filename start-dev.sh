#!/bin/bash
cd /home/z/my-project
while true; do
  bun run dev
  echo "Server died, restarting in 2s..."
  sleep 2
done
