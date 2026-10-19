#!/usr/bin/env python3
"""
Scanner Cron Runner
====================
يُشغّل Day Trading Scanner كل 15 دقيقة
يُستدعى من PM2 cron أو يمكن تشغيله مباشرة

Usage:
  python scanner_cron.py           # Run once
  PM2 handles scheduling via cron_restart

PM2 Config (ecosystem.config.js):
  cron_restart: '*/15 * * * *'     # Run every 15 minutes
  autorestart: false               # Don't auto-restart - cron handles scheduling
"""

import sys
import os
import json
from datetime import datetime

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analyzers.day_trading_scanner import DayTradingScanner


def main():
    """Run the Day Trading Scanner."""
    start_time = datetime.now()
    print(f"[Cron] === Starting Day Trading Scanner at {start_time.isoformat()} ===")

    try:
        scanner = DayTradingScanner()
        stats = scanner.run_scan()

        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()

        print(f"\n[Cron] === Scanner Finished ===")
        print(f"[Cron] Start:  {start_time.isoformat()}")
        print(f"[Cron] End:    {end_time.isoformat()}")
        print(f"[Cron] Duration: {duration:.1f}s")
        print(f"[Cron] Results: {json.dumps(stats, indent=2, ensure_ascii=False, default=str)}")

    except Exception as e:
        print(f"[Cron] FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
