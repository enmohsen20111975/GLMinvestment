#!/bin/bash
cd /home/z/my-project
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:3000" 2>/dev/null)
  if [ "$STATUS" != "200" ]; then
    echo "$(date) Restarting server..." >> /home/z/my-project/keepalive.log
    pkill -f "next" 2>/dev/null
    sleep 2
    rm -rf .next
    npx next dev -p 3000 > /home/z/my-project/dev.log 2>&1 &
    disown
    sleep 10
    echo "$(date) Server started" >> /home/z/my-project/keepalive.log
  fi
  sleep 20
done
