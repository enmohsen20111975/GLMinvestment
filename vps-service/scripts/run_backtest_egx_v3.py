#!/usr/bin/env python3
"""
Backtest EGX Optimized Maestro v3.0 - Simplified
اختبار المايسترو المحسن للبورصة المصرية
"""

import sys
import os
from datetime import datetime, timedelta
from dataclasses import dataclass
import sqlite3
from pathlib import Path

# ==================== PATHS ====================

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

# ==================== BACKTEST PARAMETERS ====================

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# ==================== TYPES ====================

@dataclass
class Trade:
    ticker: str
    signal_date: str
    signal_type: str
    entry_price: float
    stop_loss: float
    target: float
    exit_price: float = 0.0
    result: str = 'pending'
    pnl_pct: float = 0.0
    holding_days: int = 0


# ==================== CORE FUNCTIONS ====================

def calculate_support_resistance(closes: list, period: int = 20) -> dict:
    """Calculate support and resistance from price data."""
    if len(closes) < period:
        period = len(closes)
    
    recent = closes[-period:]
    support = min(recent)
    resistance = max(recent)
    current = closes[-1]
    
    if resistance != support:
        position_pct = ((current - support) / (resistance - support)) * 100
    else:
        position_pct = 50.0
    
    return {
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'position_pct': round(position_pct, 2),
        'at_support': position_pct <= 10,
        'near_support': position_pct <= 30,
        'at_resistance': position_pct >= 90
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    
    return round(current / avg, 2) if avg > 0 else 1.0


def get_signal(position_pct: float, volume_ratio: float) -> tuple:
    """
    Determine signal based on position and volume.
    Returns: (signal_type, target_pct, stop_pct)
    
    Relaxed criteria for more signals:
    - T+1: At support (≤15%) + high volume (≥1.3x)
    - Swing: Near support (≤35%) + decent volume (≥0.8x)
    - Buy: Good position (≤50%)
    """
    # T+1: At support + high volume
    if position_pct <= 15 and volume_ratio >= 1.3:
        return ('t1_buy', 2.0, 1.5)
    
    # Swing: Near support + decent volume
    if position_pct <= 35 and volume_ratio >= 0.8:
        return ('swing_buy', 5.0, 3.0)
    
    # Buy: Good position
    if position_pct <= 50:
        return ('buy', 8.0, 5.0)
    
    # No signal
    return (None, 0, 0)


def simulate_trade(entry: float, stop: float, target: float, future_data: list, max_days: int = 20) -> tuple:
    """Simulate a trade and return (exit_price, result, days)."""
    if not future_data:
        return entry, 'timeout', 0
    
    for i, day in enumerate(future_data[:max_days]):
        high = day.get('high_price', day.get('close_price', 0))
        low = day.get('low_price', day.get('close_price', 0))
        
        if target > 0 and high >= target:
            return target, 'win', i + 1
        if stop > 0 and low <= stop:
            return stop, 'loss', i + 1
    
    return future_data[-1].get('close_price', entry), 'timeout', min(max_days, len(future_data))


# ==================== MAIN BACKTEST ====================

def run_backtest():
    print("\n" + "="*70)
    print("EGX MAESTRO v3.0 - BACKTEST (Support/Resistance)")
    print("="*70)
    print(f"Period: {START_DATE} to {END_DATE}")
    print("Logic: Buy at support, target 2-5%, stop 1.5-3%")
    print("="*70)
    
    # Connect to DB
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Crypto tokens to exclude
    CRYPTO_TOKENS = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
                     'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC',
                     'BCH', 'FIL', 'APT', 'ARB', 'OP', 'INJ', 'STX', 'HBAR', 'VET', 'GRT',
                     'SAND', 'MANA', 'AAVE', 'MKR', 'SNX', 'CRV', 'SUSHI', 'COMP', 'YFI']
    
    # Get all tickers with data in period (EGX stocks only)
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= ? AND date <= ?
        AND ticker GLOB "[A-Z][A-Z][A-Z]"
        OR ticker GLOB "[A-Z][A-Z][A-Z][A-Z]"
    ''', (START_DATE, END_DATE))
    all_tickers = [row['ticker'] for row in cursor.fetchall()]
    
    # Filter out crypto
    tickers = [t for t in all_tickers if t not in CRYPTO_TOKENS and not t.startswith('USD')]
    
    print(f"\nFound {len(tickers)} tickers with data")
    
    all_trades = []
    by_signal = {}
    
    # Iterate through dates
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        
        for ticker in tickers[:50]:  # Limit to 50 tickers for speed
            try:
                # Get history up to this date
                cursor.execute('''
                    SELECT date, open_price, high_price, low_price, close_price, volume 
                    FROM price_history 
                    WHERE ticker = ? AND date <= ?
                    ORDER BY date DESC LIMIT 60
                ''', (ticker, date_str))
                
                rows = list(cursor.fetchall())
                if len(rows) < 30:
                    continue
                
                # Reverse to get chronological order
                rows.reverse()
                
                closes = [r['close_price'] for r in rows if r['close_price'] > 0]
                volumes = [r['volume'] for r in rows]
                
                if len(closes) < 30:
                    continue
                
                # Calculate SR and volume
                sr = calculate_support_resistance(closes, 20)
                vol_ratio = calculate_volume_ratio(volumes)
                
                # Get signal
                signal, target_pct, stop_pct = get_signal(sr['position_pct'], vol_ratio)
                
                if not signal:
                    continue
                
                # Get next 20 days for simulation
                cursor.execute('''
                    SELECT date, open_price, high_price, low_price, close_price, volume 
                    FROM price_history 
                    WHERE ticker = ? AND date > ?
                    ORDER BY date ASC LIMIT 20
                ''', (ticker, date_str))
                
                future = [dict(r) for r in cursor.fetchall()]
                if not future:
                    continue
                
                # Entry = next day open
                entry = future[0]['open_price']
                target = entry * (1 + target_pct / 100)
                stop = entry * (1 - stop_pct / 100)
                
                # Simulate
                max_days = 1 if signal == 't1_buy' else 20
                exit_price, result, days = simulate_trade(entry, stop, target, future[1:], max_days)
                
                pnl = ((exit_price - entry) / entry) * 100
                
                trade = Trade(
                    ticker=ticker,
                    signal_date=date_str,
                    signal_type=signal,
                    entry_price=round(entry, 2),
                    stop_loss=round(stop, 2),
                    target=round(target, 2),
                    exit_price=round(exit_price, 2),
                    result=result,
                    pnl_pct=round(pnl, 2),
                    holding_days=days
                )
                
                all_trades.append(trade)
                
                # Stats by signal
                if signal not in by_signal:
                    by_signal[signal] = {'trades': 0, 'wins': 0, 'pnl': 0}
                by_signal[signal]['trades'] += 1
                if result == 'win':
                    by_signal[signal]['wins'] += 1
                by_signal[signal]['pnl'] += pnl
                
            except Exception as e:
                continue
        
        current += timedelta(days=1)
    
    conn.close()
    
    # ==================== RESULTS ====================
    
    wins = [t for t in all_trades if t.result == 'win']
    losses = [t for t in all_trades if t.result == 'loss']
    timeouts = [t for t in all_trades if t.result == 'timeout']
    
    total = len(all_trades)
    win_count = len(wins)
    
    win_rate = (win_count / total * 100) if total > 0 else 0
    total_pnl = sum(t.pnl_pct for t in all_trades)
    avg_win = sum(t.pnl_pct for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0
    
    print("\n" + "="*70)
    print("RESULTS")
    print("="*70)
    print(f"\n📊 TOTAL: {total} trades")
    print(f"   Wins: {win_count}, Losses: {len(losses)}, Timeouts: {len(timeouts)}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total P&L: {total_pnl:+.2f}%")
    print(f"   Avg Win: +{avg_win:.2f}%, Avg Loss: {avg_loss:.2f}%")
    
    print(f"\n📈 BY SIGNAL TYPE:")
    for sig, stats in sorted(by_signal.items()):
        wr = (stats['wins'] / stats['trades'] * 100) if stats['trades'] > 0 else 0
        print(f"   {sig}: {stats['trades']} trades, {wr:.1f}% WR, {stats['pnl']:+.2f}%")
    
    if all_trades:
        print(f"\n🏆 TOP 5:")
        for t in sorted(all_trades, key=lambda x: x.pnl_pct, reverse=True)[:5]:
            print(f"   {t.ticker} @ {t.signal_date}: {t.signal_type}, +{t.pnl_pct:.2f}%")
        
        print(f"\n💀 WORST 5:")
        for t in sorted(all_trades, key=lambda x: x.pnl_pct)[:5]:
            print(f"   {t.ticker} @ {t.signal_date}: {t.signal_type}, {t.pnl_pct:.2f}%")
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if win_rate >= 55 and total_pnl >= 2:
        print("✅ SUCCESS - Win Rate > 55% AND P&L > +2%")
        status = 'SUCCESS'
    elif win_rate >= 40:
        print("⚠️ NEEDS TUNING - Win Rate 40-55%")
        status = 'NEEDS_TUNING'
    else:
        print("❌ FAILED - Win Rate < 40%")
        status = 'FAILED'
    print("="*70 + "\n")
    
    return {
        'total_trades': total,
        'win_rate': round(win_rate, 2),
        'total_pnl': round(total_pnl, 2),
        'status': status
    }


if __name__ == '__main__':
    result = run_backtest()
