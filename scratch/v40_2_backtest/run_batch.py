#!/usr/bin/env python3
"""
V40.2 Backtest Batch Runner — tightened entry conditions
  - strong_buy_evidence_count 3 → 4
  - buy_evidence_count 2 → 3
  - rs_required_for_buy 0 → 1
  - kill_filter_min_relative_strength -2 → 0
  - kill_filter_min_turnover_egp 3M → 5M
  - absorption_min_volume_ratio 1.3 → 1.5
  - Fixed signal mapping bug (انفجار checked first; plain شراء → WAIT)
  - Real EGX30ETF benchmark_change (not 0.0)
  - Strict kill-filter mode (no market-open relaxation)
  - Position sizing 1.5% risk per trade (carried over from V40.1)

Runs one batch of tickers as a separate process (OOM avoidance).
"""
import sys
import os
import json
import gc
import traceback

sys.path.insert(0, '/home/z/my-project/vps-service')
os.chdir('/home/z/my-project')

from engines.v38_backtest_engine import V38BacktestEngine

# Same comparison period as V40.1 baseline
START_DATE = os.environ.get('V402_START', '2026-02-01')
END_DATE = os.environ.get('V402_END', '2026-06-08')
SCAN_INTERVAL = int(os.environ.get('V402_SCAN_INTERVAL', '3'))


def run_batch(batch_num, tickers):
    print(f"[Batch {batch_num}] Starting {len(tickers)} tickers | "
          f"{START_DATE} → {END_DATE} | scan every {SCAN_INTERVAL}d", flush=True)
    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)

    summary = engine.run_backtest(
        tickers=tickers,
        start_date=START_DATE,
        end_date=END_DATE,
        scan_interval=SCAN_INTERVAL,
        max_daily_picks=10,
        verbose=False,
    )

    from dataclasses import asdict
    trades_data = [asdict(t) for t in engine.trades]
    out_dir = '/home/z/my-project/scratch/v40_2_backtest'
    os.makedirs(out_dir, exist_ok=True)
    with open(f'{out_dir}/batch_{batch_num}_trades.json', 'w', encoding='utf-8') as f:
        json.dump(trades_data, f, ensure_ascii=False, default=str)
    with open(f'{out_dir}/batch_{batch_num}_summary.json', 'w', encoding='utf-8') as f:
        json.dump(asdict(summary), f, ensure_ascii=False, default=str, indent=2)

    print(f"[Batch {batch_num}] Done: {len(trades_data)} trades, "
          f"WR={summary.win_rate:.1f}%, PF={summary.profit_factor:.3f}, "
          f"MaxDD={summary.max_drawdown_pct:.1f}%", flush=True)

    del engine
    gc.collect()


if __name__ == '__main__':
    batch_num = int(sys.argv[1])
    # Reuse the existing ticker split from v40_backtest
    with open(f'/home/z/my-project/scratch/v40_backtest/batch_{batch_num}.json') as f:
        tickers = json.load(f)
    try:
        run_batch(batch_num, tickers)
    except Exception as e:
        print(f"[Batch {batch_num}] ERROR: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)
