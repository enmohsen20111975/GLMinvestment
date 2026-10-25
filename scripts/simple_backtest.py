#!/usr/bin/env python3
"""
simple_backtest.py — باك تست مبسط (بدون V38 المعقد)
====================================================

الـ script ده بيجيب الأسهم اللي بتعدي فلاتر بسيطة:
  1. close > MA50 (uptrend)
  2. volume > 1.5x متوسط 20 يوم
  3. close > close_5d_ago * 1.02 (momentum +2%)

وبيولّد توقعات BUY لهم + بيحسب النتايج بعد 30 يوم.

الاستخدام:
  .venv/bin/python3 scripts/simple_backtest.py
  .venv/bin/python3 scripts/simple_backtest.py --start 2026-03-10 --end 2026-06-10

Author: برافو
"""
from __future__ import annotations

import os
import sys
import json
import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'


def get_buy_candidates(date: str, conn: sqlite3.Connection) -> list:
    """بيرجّع الأسهم اللي بتعدي فلاتر بسيطة في يوم معين."""
    query = """
    WITH daily AS (
        SELECT ticker, date, close_price, volume,
               AVG(close_price) OVER w AS ma50,
               AVG(volume) OVER w2 AS vol_ma20,
               LAG(close_price, 5) OVER (PARTITION BY ticker ORDER BY date) AS close_5d_ago
        FROM price_history
        WHERE date <= ? AND date >= date(?, '-90 days')
        WINDOW
            w AS (PARTITION BY ticker ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW),
            w2 AS (PARTITION BY ticker ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)
    )
    SELECT ticker, close_price, ROUND(ma50, 2), volume, ROUND(vol_ma20, 0),
           ROUND((close_price / close_5d_ago - 1) * 100, 2) as momentum_5d
    FROM daily
    WHERE date = ?
      AND close_price > ma50
      AND volume > vol_ma20 * 0.8
      AND close_price > close_5d_ago * 1.02
    ORDER BY volume DESC
    LIMIT 10
    """
    return conn.execute(query, (date, date, date)).fetchall()


def get_future_return(ticker: str, entry_date: str, days: int, conn: sqlite3.Connection):
    """بيحسب العائد بعد N أيام من الدخول."""
    rows = conn.execute("""
        SELECT date, close_price FROM price_history
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT ?
    """, (ticker, entry_date, days)).fetchall()
    if len(rows) < days:
        return None, None, None
    
    entry_price = conn.execute(
        "SELECT close_price FROM price_history WHERE ticker = ? AND date = ?",
        (ticker, entry_date)
    ).fetchone()
    if not entry_price:
        return None, None, None
    
    entry = entry_price[0]
    exit_row = rows[-1]
    exit_price = exit_row[1]
    return_pct = (exit_price / entry - 1) * 100
    
    # Also check if it hit +10% or -7% during the period
    max_high = max(r[1] for r in rows)
    min_low = min(r[1] for r in rows)
    max_return = (max_high / entry - 1) * 100
    min_return = (min_low / entry - 1) * 100
    
    # Determine outcome
    if max_return >= 10:
        outcome = 'TARGET_HIT'
        return_pct = 10.0
    elif min_return <= -7:
        outcome = 'STOPPED'
        return_pct = -7.0
    else:
        outcome = 'EXPIRED'
    
    return outcome, return_pct, exit_price


def main():
    parser = argparse.ArgumentParser(description='Simple Backtest — no V38 engine')
    parser.add_argument('--start', default='2026-03-10')
    parser.add_argument('--end', default='2026-06-10')
    parser.add_argument('--holding-days', type=int, default=30)
    args = parser.parse_args()

    print(f"\n{'='*70}")
    print(f"  📊 Simple Backtest — {args.start} → {args.end}")
    print(f"  Holding: {args.holding_days} days | Filters: MA50 + 0.8x vol + 2% momentum")
    print(f"{'='*70}\n")

    db_path = DB_DIR / 'price_history.db'
    if not db_path.exists():
        print(f"ERROR: {db_path} not found")
        return 1

    conn = sqlite3.connect(str(db_path), timeout=30.0)

    # Get trading dates
    dates = [r[0] for r in conn.execute("""
        SELECT DISTINCT date FROM price_history
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
    """, (args.start, args.end)).fetchall()]

    print(f"Trading dates: {len(dates)}")
    print()

    all_trades = []
    
    for date in dates:
        candidates = get_buy_candidates(date, conn)
        if candidates:
            print(f"  {date}: {len(candidates)} candidates")
            for c in candidates[:5]:  # Top 5 per day
                ticker = c[0]
                entry_price = c[1]
                
                outcome, return_pct, exit_price = get_future_return(
                    ticker, date, args.holding_days, conn
                )
                
                if outcome:
                    trade = {
                        'date': date,
                        'ticker': ticker,
                        'entry': entry_price,
                        'outcome': outcome,
                        'return_pct': return_pct,
                    }
                    all_trades.append(trade)
                    emoji = '🎯' if outcome == 'TARGET_HIT' else '🛑' if outcome == 'STOPPED' else '⏰'
                    print(f"    {emoji} {ticker}: entry={entry_price}, {outcome}, return={return_pct:+.1f}%")

    conn.close()

    # Summary
    print(f"\n{'='*70}")
    print(f"  📊 BACKTEST RESULTS")
    print(f"{'='*70}")
    print(f"  Total trades: {len(all_trades)}")
    
    if not all_trades:
        print("  No trades generated. Try relaxing filters.")
        return 0
    
    wins = [t for t in all_trades if t['outcome'] == 'TARGET_HIT']
    losses = [t for t in all_trades if t['outcome'] == 'STOPPED']
    expired = [t for t in all_trades if t['outcome'] == 'EXPIRED']
    
    print(f"  🎯 Target Hit: {len(wins)}")
    print(f"  🛑 Stopped:    {len(losses)}")
    print(f"  ⏰ Expired:    {len(expired)}")
    
    if all_trades:
        win_rate = len(wins) / len(all_trades) * 100
        avg_return = sum(t['return_pct'] for t in all_trades) / len(all_trades)
        gross_profit = sum(t['return_pct'] for t in all_trades if t['return_pct'] > 0)
        gross_loss = abs(sum(t['return_pct'] for t in all_trades if t['return_pct'] < 0))
        pf = gross_profit / gross_loss if gross_loss > 0 else 0
        
        print(f"\n  📊 Win Rate:      {win_rate:.1f}%")
        print(f"  📈 Avg Return:    {avg_return:+.2f}%")
        print(f"  💰 Profit Factor: {pf:.2f}")
        print(f"  💵 Gross Profit:  {gross_profit:+.2f}")
        print(f"  💸 Gross Loss:    {gross_loss:.2f}")
    
    # Save report
    report = {
        'period': f'{args.start} → {args.end}',
        'holding_days': args.holding_days,
        'total_trades': len(all_trades),
        'wins': len(wins),
        'losses': len(losses),
        'expired': len(expired),
        'win_rate': round(win_rate, 1) if all_trades else 0,
        'avg_return': round(avg_return, 2) if all_trades else 0,
        'profit_factor': round(pf, 2) if all_trades else 0,
        'trades': all_trades,
    }
    
    report_dir = PROJECT_ROOT / 'backtest_results'
    report_dir.mkdir(exist_ok=True)
    report_path = report_dir / f'simple_backtest_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"\n  💾 Report saved: {report_path}")
    print(f"{'='*70}\n")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
