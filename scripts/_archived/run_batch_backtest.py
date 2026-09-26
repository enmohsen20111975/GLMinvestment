#!/usr/bin/env python3
"""Run the V40.2 generator in batches to avoid OOM in the sandbox.

Each batch processes 50 tickers, using --keep-old to accumulate predictions.
"""
import subprocess
import sys
import time
import os

BATCH_SIZE = 50
TOTAL_TICKERS = 313

def run_batch(offset, size, keep_old):
    cmd = [
        'python3', 'vps-service/jobs/v40_2_daily_generator.py',
        '--start', '2025-12-01',
        '--end', '2026-08-27',
        '--scan-interval', '3',
        '--max-picks', '5',
        '--force',
        '--max-tickers', str(size),
        '--tickers-offset', str(offset),
    ]
    if keep_old:
        cmd.append('--keep-old')

    print(f"\n{'='*60}")
    print(f"BATCH: offset={offset}, size={size}, keep_old={keep_old}")
    print(f"{'='*60}", flush=True)

    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    elapsed = time.time() - start

    # Print last 15 lines of output
    lines = result.stdout.strip().split('\n')
    for line in lines[-15:]:
        print(line, flush=True)
    if result.stderr:
        err_lines = result.stderr.strip().split('\n')
        for line in err_lines[-5:]:
            print(f"  STDERR: {line}", flush=True)
    print(f"  ({elapsed:.1f}s, exit={result.returncode})", flush=True)
    return result.returncode == 0

def main():
    os.chdir('/home/z/my-project')
    batch_num = 0
    offset = 0
    all_ok = True

    while offset < TOTAL_TICKERS:
        size = min(BATCH_SIZE, TOTAL_TICKERS - offset)
        keep_old = batch_num > 0  # First batch deletes old, rest keep
        ok = run_batch(offset, size, keep_old)
        if not ok:
            print(f"❌ Batch at offset {offset} FAILED", flush=True)
            all_ok = False
        batch_num += 1
        offset += size

    print(f"\n{'='*60}")
    print(f"ALL BATCHES DONE: {batch_num} batches, success={all_ok}")
    print(f"{'='*60}", flush=True)

    # Count predictions
    import sqlite3
    c = sqlite3.connect('db/predictions.db')
    total = c.execute('SELECT COUNT(*) FROM predictions').fetchone()[0]
    by_date = c.execute("SELECT prediction_date, COUNT(*) FROM predictions GROUP BY prediction_date ORDER BY prediction_date").fetchall()
    print(f"\n📊 Total predictions: {total}")
    print(f"📅 Dates with picks: {len(by_date)}")
    c.close()

if __name__ == '__main__':
    main()
