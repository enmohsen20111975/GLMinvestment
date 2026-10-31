#!/usr/bin/env bash
# Bravo ↔ Alpha continuous sync. Runs under PM2.
# Pulls Alpha's frontend commits from origin/main every 5 min.
# Safe: --ff-only (never rewrites local history), skips if working tree dirty.
set -u
cd /home/z/my-project || exit 1
INTERVAL=300
while true; do
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  if ! git fetch origin main 2>/dev/null; then
    echo "[$ts] FETCH FAILED (network?) — retry in ${INTERVAL}s"
  else
    behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
    if [ "$behind" -gt 0 ]; then
      dirty=$(git status --porcelain 2>/dev/null | wc -l)
      if [ "$dirty" -gt 0 ]; then
        echo "[$ts] BEHIND by $behind but working tree dirty ($dirty files) — SKIPPING pull (commit your work first)"
      else
        if git pull --ff-only origin main >/dev/null 2>&1; then
          newhead=$(git rev-parse --short HEAD)
          echo "[$ts] SYNCED +$behind commits → $newhead"
        else
          echo "[$ts] PULL --ff-only FAILED (diverged?) — manual merge needed"
        fi
      fi
    fi
  fi
  sleep "$INTERVAL"
done
