#!/bin/bash
cd /home/z/my-project/vps-service
exec python3 -u scripts/maestro_backfill_v2.py --days 365 --markets EGX --per-day 50 --clear
