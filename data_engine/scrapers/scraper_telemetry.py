#!/usr/bin/env python3
"""
scraper_telemetry.py — تيليمتري السكرابرات لغرفة التحكم الصناعي
=================================================================================
Phase 5: DCS Metadata for scraper monitoring.

Records: scraper_name, last_run, success_count, fail_count, avg_duration_sec, status.
Provides API for: read status, start/stop scraper, date range backfill.

Usage:
    python3 data_engine/scrapers/scraper_telemetry.py status
    python3 data_engine/scrapers/scraper_telemetry.py update --name tradingview_scraper --status active --rows 384 --duration 45.2
"""
from __future__ import annotations
import argparse, sqlite3, json, sys
from datetime import datetime, timezone
from pathlib import Path

DB_FILE = Path(__file__).resolve().parent.parent.parent / "db" / "data_engine.db"

def log(msg): print(f"[telemetry] {msg}", flush=True)

def get_conn():
    conn = sqlite3.connect(str(DB_FILE), timeout=10)
    conn.execute('PRAGMA busy_timeout=5000')
    return conn

def cmd_status():
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT scraper_name, last_run, success_count, fail_count, avg_duration_sec, status, last_market, rows_fetched, last_error FROM scraper_telemetry ORDER BY scraper_name")
    rows = c.fetchall()
    print(f"{'Scraper':35} {'Status':8} {'Market':8} {'Success':8} {'Fail':5} {'AvgDur':8} {'Rows':8} {'Last Run':20}")
    print("─" * 115)
    for r in rows:
        print(f"{r[0]:35} {r[5]:8} {r[6] or '—':8} {r[2]:8} {r[3]:5} {r[4]:7.1f}s {r[7] or 0:8} {r[1] or '—':20}")
        if r[8]:
            print(f"  └─ last_error: {r[8][:80]}")
    conn.close()

def cmd_update(name, status, rows, duration, error, market):
    conn = get_conn(); c = conn.cursor()
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    if status == 'success':
        c.execute("UPDATE scraper_telemetry SET last_run=?, success_count=success_count+1, avg_duration_sec=?, status='active', rows_fetched=?, last_error=NULL, updated_at=? WHERE scraper_name=?",
                  (now, duration, rows, now, name))
    elif status == 'fail':
        c.execute("UPDATE scraper_telemetry SET last_run=?, fail_count=fail_count+1, status='stopped', last_error=?, updated_at=? WHERE scraper_name=?",
                  (now, error, now, name))
    else:
        c.execute("UPDATE scraper_telemetry SET status=?, last_run=?, updated_at=? WHERE scraper_name=?",
                  (status, now, now, name))
    conn.commit(); conn.close()
    log(f"Updated {name}: status={status}, rows={rows}, duration={duration}s")

def cmd_json():
    conn = get_conn(); c = conn.cursor()
    c.execute("SELECT scraper_name, last_run, success_count, fail_count, avg_duration_sec, status, last_market, rows_fetched FROM scraper_telemetry ORDER BY scraper_name")
    cols = [d[0] for d in c.description]
    data = [dict(zip(cols, r)) for r in c.fetchall()]
    print(json.dumps(data, ensure_ascii=False, indent=2))
    conn.close()

def main():
    p = argparse.ArgumentParser(description="Scraper Telemetry DCS")
    sub = p.add_subparsers(dest='cmd')
    sub.add_parser('status', help='Print telemetry table')
    sub.add_parser('json', help='JSON output for API')
    upd = sub.add_parser('update', help='Update scraper status')
    upd.add_argument('--name', required=True)
    upd.add_argument('--status', default='active', choices=['active','idle','stopped','success','fail'])
    upd.add_argument('--rows', type=int, default=0)
    upd.add_argument('--duration', type=float, default=0)
    upd.add_argument('--error', default=None)
    upd.add_argument('--market', default=None)
    args = p.parse_args()
    if args.cmd == 'status': cmd_status()
    elif args.cmd == 'json': cmd_json()
    elif args.cmd == 'update': cmd_update(args.name, args.status, args.rows, args.duration, args.error, args.market)
    else: p.print_help()

if __name__ == '__main__': sys.exit(main())
