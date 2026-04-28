#!/bin/bash
cd /home/z/my-project
while :; do
    node node_modules/.bin/next dev -p 3000 2>&1
    echo "[`date`] Server exited with code $?. Restarting in 3s..."
    sleep 3
done
