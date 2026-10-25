#!/usr/bin/env python3
"""
V82 Backtest Engine — باك تيست محرك القرار المؤسسي V82
=========================================================
يحاكي V82 Analyzer على البيانات التاريخية لقياس الأداء.

المنطق:
  1. لكل سهم، نحمّل OHLCV لفترة طويلة (365 يوم)
  2. نمرّ على كل يوم ونشغّل V82 Analyzer
  3. لو Gate Passed → نفتح صفقة (entry/sl/tp1/tp2)
  4. نتتبّع الصفقة لحد ما تخرج (hit tp2 / hit sl / kill switch)
  5. نحسب: win_rate, profit_factor, avg_return, max_drawdown

Usage:
  python3 vps-service/scripts/v82_backtest.py --market EGX --days 365
  python3 vps-service/scripts/v82_backtest.py --ticker COMI --days 90
"""

import sys
import os
import sqlite3
import argparse
import logging
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from dataclasses import asdict

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

from analyzers.v82_analyzer import V82Analyzer, V82DataLoader, V82Signal

STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')


def load_all_tickers(market: str = 'EGX', limit: int = 50) -> list:
    """تحميل قائمة الأسهم من stocks.db."""
    if not Path(STOCKS_DB).exists():
        return []
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(STOCKS_DB, writable=False)
        conn.row_factory = sqlite3.Row
        cur = conn.execute("""
            SELECT ticker FROM stocks
            WHERE market = ? AND ticker IS NOT NULL AND ticker != ''
            ORDER BY ticker ASC
            LIMIT ?
        """, (market, limit))
        tickers = [r['ticker'] for r in cur]
        conn.close()
        return tickers
    except Exception as e:
        print(f'⚠️ cannot load tickers: {e}')
        return []


def run_v82_backtest(ticker: str, market: str, days: int, account_balance: float = 10000) -> dict:
    """تشغيل V82 backtest على سهم واحد."""
    loader = V82DataLoader()
    ohlcv = loader.load_ohlcv(ticker, market, days)

    if not ohlcv or len(ohlcv) < 60:
        return {'ticker': ticker, 'error': 'insufficient data', 'signals': 0}

    market_data = loader.load_market_benchmark(market)

    analyzer = V82Analyzer(account_balance=account_balance, risk_per_trade=1.0)
    signals_generated = 0
    trades_closed = 0
    wins = 0
    losses = 0
    returns = []

    # Walk-forward: نمرّ على كل يوم من اليوم 60 لحد آخر يوم
    for i in range(60, len(ohlcv)):
        window = ohlcv[:i + 1]  # كل البيانات لحد اليوم ده

        signal = analyzer.analyze(ticker, window, market_data)

        # لو فيه صفقة مفتوحة، فحص هل خرجت
        if analyzer.active_entry is not None:
            current = ohlcv[i]
            hit_tp2 = float(current.get('high', 0)) >= (analyzer.active_tp2 or 0)
            hit_sl = float(current.get('low', 0)) <= (analyzer.active_sl or 0)
            kill = signal.kill_switch_triggered

            if hit_tp2 or hit_sl or kill:
                # V82-FIX: save entry/tp2/sl BEFORE close_trade (which sets them to None)
                saved_entry = analyzer.active_entry
                saved_tp2 = analyzer.active_tp2
                saved_sl = analyzer.active_sl
                exit_price = float(current.get('close', 0))

                analyzer.close_trade(hit_tp2, hit_sl, kill, exit_price)
                trades_closed += 1

                # حساب العائد (باستخدام القيم المحفوظة)
                if hit_tp2:
                    ret = ((saved_tp2 - saved_entry) / saved_entry) * 100 if saved_entry else 0
                    wins += 1
                elif hit_sl:
                    ret = ((saved_sl - saved_entry) / saved_entry) * 100 if saved_entry else 0
                    losses += 1
                else:  # kill switch
                    ret = ((exit_price - saved_entry) / saved_entry) * 100 if saved_entry else 0
                    # V82-FIX: kill switch exit ≠ automatic loss. 
                    # If ret > 0 → it's a WIN (locked in profit before reversal)
                    if ret > 0:
                        wins += 1
                    else:
                        losses += 1

                returns.append(ret)

        # لو مفيش صفقة مفتوحة + Gate Passed → افتح صفقة
        if analyzer.active_entry is None and signal.action == 'BUY' and signal.gate_passed:
            analyzer.open_trade(signal, i)
            signals_generated += 1

    # إحصائيات
    resolved = wins + losses
    win_rate = (wins / resolved * 100) if resolved > 0 else 0
    avg_return = (sum(returns) / len(returns)) if returns else 0
    total_return = sum(returns) if returns else 0

    # Max drawdown
    max_dd = 0
    peak = 0
    cumulative = 0
    for r in returns:
        cumulative += r
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    return {
        'ticker': ticker,
        'market': market,
        'data_points': len(ohlcv),
        'signals_generated': signals_generated,
        'trades_closed': trades_closed,
        'wins': wins,
        'losses': losses,
        'win_rate': round(win_rate, 2),
        'avg_return': round(avg_return, 4),
        'total_return': round(total_return, 2),
        'max_drawdown': round(max_dd, 2),
        'analyzer_stats': analyzer.get_stats(),
    }


def main():
    parser = argparse.ArgumentParser(description='V82 Backtest Engine')
    parser.add_argument('--ticker', type=str, default=None, help='سهم محدد')
    parser.add_argument('--market', type=str, default='EGX', help='السوق')
    parser.add_argument('--days', type=int, default=365, help='عدد الأيام')
    parser.add_argument('--limit', type=int, default=20, help='عدد الأسهم (لو --ticker مش محدد)')
    parser.add_argument('--balance', type=float, default=10000, help='رأس المال')
    args = parser.parse_args()

    print(f'\n{"#"*70}')
    print(f'# V82 BACKTEST ENGINE')
    print(f'# Date: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'# Market: {args.market} | Days: {args.days} | Balance: {args.balance}')
    print(f'{"#"*70}')

    if args.ticker:
        tickers = [args.ticker]
    else:
        tickers = load_all_tickers(args.market, args.limit)
        print(f'\n📊 Loaded {len(tickers)} tickers from {args.market}')

    all_results = []
    total_signals = 0
    total_wins = 0
    total_losses = 0

    for ticker in tickers:
        print(f'\n{"="*60}')
        print(f'Analyzing: {ticker}')
        result = run_v82_backtest(ticker, args.market, args.days, args.balance)

        if 'error' in result:
            print(f'  ⚠️ {result["error"]}')
            continue

        print(f'  📊 Data: {result["data_points"]} candles')
        print(f'  📡 Signals: {result["signals_generated"]}')
        print(f'  ✅ Wins: {result["wins"]} | ❌ Losses: {result["losses"]}')
        print(f'  🎯 Win Rate: {result["win_rate"]}%')
        print(f'  💰 Avg Return: {result["avg_return"]:+.2f}%')
        print(f'  📈 Total Return: {result["total_return"]:+.2f}%')
        print(f'  📉 Max Drawdown: {result["max_drawdown"]:.2f}%')

        all_results.append(result)
        total_signals += result['signals_generated']
        total_wins += result['wins']
        total_losses += result['losses']

    # Summary
    total_resolved = total_wins + total_losses
    overall_win_rate = (total_wins / total_resolved * 100) if total_resolved > 0 else 0

    print(f'\n{"="*70}')
    print(f'🎯 V82 BACKTEST SUMMARY')
    print(f'{"="*70}')
    print(f'  Tickers analyzed: {len(all_results)}')
    print(f'  Total signals: {total_signals}')
    print(f'  Total trades closed: {total_resolved}')
    print(f'  Wins: {total_wins} | Losses: {total_losses}')
    print(f'  Overall Win Rate: {overall_win_rate:.2f}%')
    print(f'\n  {"✅ QUALIFIED" if overall_win_rate >= 65 else "⚠️ NEEDS TUNING"} (target: 65%)')
    print(f'{"="*70}\n')


if __name__ == '__main__':
    main()
