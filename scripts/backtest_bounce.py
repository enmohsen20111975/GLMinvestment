#!/usr/bin/env python3
"""
backtest_bounce.py — Backtest the BOUNCE path + other radar paths on historical data.

For each trading day D in [start_date, end_date]:
  For each active ticker:
    Fetch its series UP TO day D (no future data leakage)
    Run scan_ticker (with BOUNCE path) → record path + under_microscope
  Then for each detection, compute forward returns at +1, +3, +5, +10 days.

Output:
  /tmp/backtest_bounce_report.json — full detections + forward returns
  stdout — summary stats (success rate per path)

Usage:
  python3 scripts/backtest_bounce.py --start 2026-09-15 --end 2026-10-28
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
import os
from datetime import datetime, date
from pathlib import Path
from collections import defaultdict, Counter

# Setup paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))  # so `import scripts.maker_radar` works
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))  # so `import maker_radar` works

# Radar globals (must be set before importing scan_ticker)
# Try both import styles
try:
    import scripts.maker_radar as mr
except ImportError:
    import maker_radar as mr
mr.PROD_DB = PROJECT_ROOT / 'db' / 'stocks.db'
mr.PROD_TABLE = 'stock_daily_prices'
mr.TICKER_COL = 'ticker'
mr.PRICE_COL = 'close'
mr.VOL_COL = 'volume'
mr.TURN_COL = 'turnover'
mr.DATE_COL = 'price_date'
mr.OPEN_COL = 'open'
mr.HIGH_COL = 'high'
mr.LOW_COL = 'low'
mr.DB_SOURCE_ID = 'stocks.db::stock_daily_prices'

from core.db_manager import db_manager


def fetch_series_up_to(conn, ticker, cutoff_date, days=40):
    """Fetch ticker series UP TO cutoff_date (no future leakage)."""
    query = f"""
        SELECT {mr.DATE_COL} as price_date, {mr.OPEN_COL} as open,
               {mr.HIGH_COL} as high, {mr.LOW_COL} as low,
               {mr.PRICE_COL} as close, {mr.VOL_COL} as volume,
               {mr.TURN_COL} as turnover
        FROM {mr.PROD_TABLE}
        WHERE {mr.TICKER_COL} = ? AND {mr.PRICE_COL} > 0
          AND {mr.DATE_COL} <= ?
        ORDER BY {mr.DATE_COL} DESC
        LIMIT ?
    """
    rows = conn.execute(query, (ticker, cutoff_date, days)).fetchall()
    normalized = []
    for r in rows:
        d = dict(r)
        d['price_date'] = str(d.get('price_date', ''))[:10]
        d['close'] = float(d.get('close') or 0)
        d['volume'] = d.get('volume') or 0
        d['open'] = d.get('open') or d.get('close')
        d['high'] = d.get('high') or d.get('close')
        d['low'] = d.get('low') or d.get('close')
        d['turnover'] = d.get('turnover')
        normalized.append(d)
    return list(reversed(normalized))  # chronological


def get_active_tickers(conn, backtest_start):
    """Get tickers active in the 60 days BEFORE backtest_start (so they have enough history).
    We need tickers that were trading actively leading up to the backtest period."""
    # Go 60 days back from backtest_start to find active tickers
    cur = conn.execute("""
        SELECT ticker, COUNT(*) as days, AVG(volume) as avg_vol
        FROM stock_daily_prices
        WHERE price_date >= date(?, '-60 days') AND volume > 0
        GROUP BY ticker
        HAVING days >= 20 AND avg_vol > 100000
        ORDER BY ticker
    """, (backtest_start,))
    return [r[0] for r in cur.fetchall()]


def get_trading_days(conn, start_date, end_date):
    """Get distinct trading days in range."""
    cur = conn.execute("""
        SELECT DISTINCT price_date FROM stock_daily_prices
        WHERE price_date >= ? AND price_date <= ?
        ORDER BY price_date
    """, (start_date, end_date))
    return [str(r[0])[:10] for r in cur.fetchall()]


def get_forward_prices(conn, ticker, detection_date, lookforward_days=(1, 3, 5, 10)):
    """Get closing prices N days AFTER detection_date for return calculation."""
    cur = conn.execute("""
        SELECT price_date, close FROM stock_daily_prices
        WHERE ticker = ? AND price_date > ?
        ORDER BY price_date ASC
        LIMIT ?
    """, (ticker, detection_date, max(lookforward_days) + 5))  # +5 buffer
    rows = cur.fetchall()
    result = {}
    for n in lookforward_days:
        if len(rows) >= n:
            result[f'+{n}d_close'] = float(rows[n-1][1])
            result[f'+{n}d_date'] = str(rows[n-1][0])[:10]
    return result


def run_backtest(start_date, end_date, sample_limit=0):
    """Run the backtest."""
    conn = db_manager.get_connection(str(mr.PROD_DB), writable=False)
    conn.row_factory = sqlite3.Row

    tickers = get_active_tickers(conn, start_date)
    if sample_limit > 0:
        tickers = tickers[:sample_limit]
    print(f'[backtest] {len(tickers)} active tickers', file=sys.stderr)

    trading_days = get_trading_days(conn, start_date, end_date)
    print(f'[backtest] {len(trading_days)} trading days ({trading_days[0]} → {trading_days[-1]})', file=sys.stderr)

    # All detections: {path: [{ticker, date, price, ...forward_returns}]}
    detections_by_path = defaultdict(list)
    total_scans = 0
    errors = 0

    for day_idx, scan_date in enumerate(trading_days):
        if day_idx % 5 == 0:
            print(f'[backtest] day {day_idx+1}/{len(trading_days)}: {scan_date} — detections so far: {sum(len(v) for v in detections_by_path.values())}', file=sys.stderr)

        for ticker in tickers:
            try:
                rows = fetch_series_up_to(conn, ticker, scan_date, days=40)
                if not rows or len(rows) < 15:
                    continue
                result = mr.scan_ticker(rows, ticker, regime='NORMAL')
                if not result:
                    continue
                total_scans += 1
                path = result.get('path')
                if not path or path == 'distribution':
                    continue
                # Record detection
                detection = {
                    'ticker': ticker,
                    'date': scan_date,
                    'path': path,
                    'price': result.get('current_price'),
                    'under_microscope': result.get('under_microscope'),
                    'position_size': result.get('position_size'),
                    'drop_from_peak': result.get('drop_from_peak'),
                    'buy_pct': result.get('buy_pct'),
                    'price_action': result.get('price_action'),
                }
                # Forward returns
                fwd = get_forward_prices(conn, ticker, scan_date)
                detection_close = result.get('current_price')
                for n in (1, 3, 5, 10):
                    key = f'+{n}d_close'
                    if key in fwd and detection_close and detection_close > 0:
                        ret_pct = ((fwd[key] - detection_close) / detection_close) * 100
                        detection[f'+{n}d_return_pct'] = round(ret_pct, 2)
                        detection[f'+{n}d_date'] = fwd.get(f'+{n}d_date')
                detections_by_path[path].append(detection)
            except Exception as e:
                errors += 1
                if errors <= 3:
                    print(f'[backtest] ERROR {ticker} @ {scan_date}: {e}', file=sys.stderr)

    conn.close()
    print(f'[backtest] done. total_scans={total_scans}, errors={errors}', file=sys.stderr)
    return detections_by_path, total_scans, errors


def analyze_detections(detections_by_path):
    """Compute success/failure stats per path."""
    stats = {}
    for path, dets in detections_by_path.items():
        if not dets:
            continue
        # Filter detections that have +5d return (our primary metric)
        with_5d = [d for d in dets if '+5d_return_pct' in d]
        with_10d = [d for d in dets if '+10d_return_pct' in d]

        def metrics(dlist, key):
            if not dlist:
                return {}
            returns = [d[key] for d in dlist]
            wins = [r for r in returns if r > 3]
            losses = [r for r in returns if r < -5]
            flat = [r for r in returns if -5 <= r <= 3]
            avg = sum(returns) / len(returns)
            median = sorted(returns)[len(returns)//2]
            return {
                'count': len(dlist),
                'avg_return': round(avg, 2),
                'median_return': round(median, 2),
                'wins_gt3pct': len(wins),
                'losses_lt_minus5pct': len(losses),
                'flat': len(flat),
                'win_rate': round(len(wins)/len(dlist)*100, 1),
                'loss_rate': round(len(losses)/len(dlist)*100, 1),
                'best': round(max(returns), 2),
                'worst': round(min(returns), 2),
            }

        stats[path] = {
            'total_detections': len(dets),
            'at_5d': metrics(with_5d, '+5d_return_pct'),
            'at_10d': metrics(with_10d, '+10d_return_pct'),
        }
    return stats


def main():
    parser = argparse.ArgumentParser(description='Backtest BOUNCE path on historical data')
    parser.add_argument('--start', default='2026-09-15', help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', default='2026-10-28', help='End date (YYYY-MM-DD)')
    parser.add_argument('--limit', type=int, default=0, help='Limit tickers (0=all)')
    parser.add_argument('--output', default='/tmp/backtest_bounce_report.json')
    args = parser.parse_args()

    print(f'[backtest] period: {args.start} → {args.end}', file=sys.stderr)

    detections, total_scans, errors = run_backtest(args.start, args.end, args.limit)
    stats = analyze_detections(detections)

    # Save full report
    report = {
        'generated_at': datetime.now().isoformat(),
        'period': {'start': args.start, 'end': args.end},
        'total_scans': total_scans,
        'errors': errors,
        'summary_by_path': stats,
        'detections_by_path': dict(detections),
    }
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)

    # Print summary table
    print()
    print('═' * 90)
    print(f'  BACKTEST RESULTS: {args.start} → {args.end}')
    print('═' * 90)
    print(f'  Total scans: {total_scans}')
    print()
    print(f'  {"path":<30} {"detections":>10} {"avg_5d%":>10} {"win%":>8} {"loss%":>8} {"median_5d%":>12}')
    print(f'  {"-"*30} {"-"*10} {"-"*10} {"-"*8} {"-"*8} {"-"*12}')
    for path in sorted(stats.keys()):
        s = stats[path]
        a5 = s['at_5d']
        if a5:
            print(f'  {path:<30} {a5["count"]:>10} {a5["avg_return"]:>10} {a5["win_rate"]:>8} {a5["loss_rate"]:>8} {a5["median_return"]:>12}')
        else:
            print(f'  {path:<30} {s["total_detections"]:>10}  (no 5d data)')
    print()
    print('  Legend: win% = % with +5d return > 3% | loss% = % with +5d return < -5%')
    print()
    print(f'  Full report: {args.output}')
    print('═' * 90)


if __name__ == '__main__':
    main()
