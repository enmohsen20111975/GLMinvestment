#!/usr/bin/env python3
"""
V40 Backtest Batch Runner
Runs the V40 backtest on a batch of tickers and saves trades to a JSON file.
Designed to be run as a separate process for each batch to avoid OOM.
"""
import sys
import os
import json
import gc
import traceback

# Path setup
sys.path.insert(0, '/home/z/my-project/vps-service')
os.chdir('/home/z/my-project')

from engines.v38_backtest_engine import V38BacktestEngine

def run_batch(batch_num, tickers):
    print(f"[Batch {batch_num}] Starting with {len(tickers)} tickers", flush=True)
    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)

    summary = engine.run_backtest(
        tickers=tickers,
        start_date='2025-06-01',
        end_date='2026-08-12',
        scan_interval=5,
        max_daily_picks=10,
        verbose=False,
    )

    # Save trades
    from dataclasses import asdict
    trades_data = [asdict(t) for t in engine.trades]
    trades_path = f'/home/z/my-project/scratch/v40_backtest/batch_{batch_num}_trades.json'
    with open(trades_path, 'w', encoding='utf-8') as f:
        json.dump(trades_data, f, ensure_ascii=False, default=str)

    # Save summary
    summary_path = f'/home/z/my-project/scratch/v40_backtest/batch_{batch_num}_summary.json'
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(summary), f, ensure_ascii=False, default=str, indent=2)

    print(f"[Batch {batch_num}] Done: {len(trades_data)} trades, "
          f"WR={summary.win_rate:.1f}%, PF={summary.profit_factor:.2f}", flush=True)

    # Cleanup
    del engine
    gc.collect()

if __name__ == '__main__':
    batch_num = int(sys.argv[1])
    with open(f'/home/z/my-project/scratch/v40_backtest/batch_{batch_num}.json') as f:
        tickers = json.load(f)
    try:
        run_batch(batch_num, tickers)
    except Exception as e:
        print(f"[Batch {batch_num}] ERROR: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)
