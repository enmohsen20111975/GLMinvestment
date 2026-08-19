#!/usr/bin/env python3
"""
EGX 90-Day Analysis - T+1 Strategy Validation
تحليل 90 يوم للتحقق من استراتيجية T+1

This script analyzes the last 90 days of EGX data to validate the T+1 strategy.
For each day, it checks:
1. Was there a T+1 signal?
2. Did the stock go up 1.5% the next day?
3. Record Win/Loss

Output: CSV report with daily results
"""

import sys
import os
import csv
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
import sqlite3
from pathlib import Path

# ==================== PATHS ====================

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = Path(__file__).parent.parent / 'backtest_results'
OUTPUT_DIR.mkdir(exist_ok=True)

# ==================== STRATEGY PARAMETERS ====================

SUPPORT_THRESHOLD = 4.0       # قرب 4% من الدعم
VOLUME_RATIO_MIN = 1.2        # سيولة 1.2x
TARGET_PCT = 1.5              # هدف +1.5%
STOP_LOSS_PCT = 1.0           # وقف -1%
MAX_SIGNALS_PER_DAY = 3       # أقصى 3 إشارات يومياً

# ==================== TYPES ====================

@dataclass
class DailyResult:
    date: str
    signals_found: int
    signals_taken: int
    trades_won: int
    trades_lost: int
    daily_pnl_pct: float
    tickers: str  # comma-separated

# ==================== CORE FUNCTIONS ====================

def calculate_support_resistance(closes: list, period: int = 20) -> dict:
    """Calculate support and resistance."""
    if len(closes) < period:
        period = len(closes)
    
    recent = closes[-period:]
    support = min(recent)
    resistance = max(recent)
    current = closes[-1]
    
    distance_to_support = ((current - support) / current) * 100 if current > 0 else 0
    
    return {
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'current': round(current, 2),
        'distance_to_support_pct': round(distance_to_support, 2)
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    return round(current / avg, 2) if avg > 0 else 1.0


def find_signals(cursor, tickers: list, date_str: str) -> list:
    """Find T+1 signals for a given day."""
    signals = []
    
    for ticker in tickers:
        cursor.execute('''
            SELECT close_price, volume FROM price_history 
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 25
        ''', (ticker, date_str))
        
        rows = list(cursor.fetchall())
        if len(rows) < 20:
            continue
        
        closes = [r[0] for r in rows if r[0] > 0]
        volumes = [r[1] for r in rows]
        
        if len(closes) < 20:
            continue
        
        sr = calculate_support_resistance(closes, 20)
        vol_ratio = calculate_volume_ratio(volumes)
        
        # T+1 signal conditions
        if sr['distance_to_support_pct'] <= SUPPORT_THRESHOLD and vol_ratio >= VOLUME_RATIO_MIN:
            signals.append({
                'ticker': ticker,
                'current_price': sr['current'],
                'support': sr['support'],
                'dist_to_support': sr['distance_to_support_pct'],
                'volume_ratio': vol_ratio
            })
    
    # Sort by quality (closest to support, highest volume)
    signals.sort(key=lambda s: (s['dist_to_support'], -s['volume_ratio']))
    
    return signals


def simulate_trade(cursor, ticker: str, signal_date: str) -> dict:
    """
    Simulate T+1 trade.
    Returns: {result: win/loss, pnl_pct: float}
    """
    # Get entry price (next day open)
    cursor.execute('''
        SELECT date, open_price, high_price, low_price, close_price 
        FROM price_history 
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT 1
    ''', (ticker, signal_date))
    
    row = cursor.fetchone()
    if not row:
        return {'result': 'no_data', 'pnl_pct': 0.0}
    
    entry_date = row[0]
    entry_price = row[1]
    high = row[2]
    low = row[3]
    close = row[4]
    
    if entry_price <= 0:
        return {'result': 'no_data', 'pnl_pct': 0.0}
    
    target = entry_price * (1 + TARGET_PCT / 100)
    stop = entry_price * (1 - STOP_LOSS_PCT / 100)
    
    # Check result
    if high >= target:
        return {'result': 'win', 'pnl_pct': TARGET_PCT}
    elif low <= stop:
        return {'result': 'loss', 'pnl_pct': -STOP_LOSS_PCT}
    else:
        # Exit at close
        pnl = ((close - entry_price) / entry_price) * 100
        return {'result': 'win' if pnl > 0 else 'loss', 'pnl_pct': round(pnl, 2)}


def get_tickers_with_data(cursor, date_str: str) -> list:
    """Get all EGX tickers with data for a date."""
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC']
    
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date = ?
    ''', (date_str,))
    
    all_tickers = [row[0] for row in cursor.fetchall()]
    egx_tickers = [t for t in all_tickers if t not in CRYPTO and len(t) >= 3 and len(t) <= 5 and t.isupper()]
    
    return egx_tickers


# ==================== MAIN ANALYSIS ====================

def run_90_day_analysis():
    print("\n" + "="*70)
    print("📊 EGX 90-DAY ANALYSIS - T+1 STRATEGY VALIDATION")
    print("="*70)
    print(f"Support: <= {SUPPORT_THRESHOLD}% from 20-day low")
    print(f"Volume: >= {VOLUME_RATIO_MIN}x average")
    print(f"Target: +{TARGET_PCT}%")
    print(f"Stop: -{STOP_LOSS_PCT}%")
    print("="*70)
    
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found: {PRICE_HISTORY_DB}")
        return None
    
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    cursor = conn.cursor()
    
    # Get date range
    cursor.execute('SELECT MIN(date), MAX(date) FROM price_history')
    min_date, max_date = cursor.fetchone()
    
    print(f"\n📅 Data available: {min_date} to {max_date}")
    
    # Calculate 90 days from max date
    end_date = datetime.strptime(max_date, '%Y-%m-%d')
    start_date = end_date - timedelta(days=90)
    
    print(f"📅 Analyzing: {start_date.strftime('%Y-%m-%d')} to {max_date}")
    
    # Results storage
    all_results = []
    total_signals = 0
    total_trades = 0
    total_wins = 0
    total_losses = 0
    total_pnl = 0.0
    
    # Iterate through dates
    current = start_date
    while current <= end_date:
        date_str = current.strftime('%Y-%m-%d')
        
        # Get tickers for this date
        tickers = get_tickers_with_data(cursor, date_str)
        if not tickers:
            current += timedelta(days=1)
            continue
        
        # Find signals
        signals = find_signals(cursor, tickers, date_str)
        signals_to_take = signals[:MAX_SIGNALS_PER_DAY]
        
        if not signals_to_take:
            current += timedelta(days=1)
            continue
        
        total_signals += len(signals)
        
        # Simulate trades
        daily_wins = 0
        daily_losses = 0
        daily_pnl = 0.0
        tickers_traded = []
        
        for signal in signals_to_take:
            trade = simulate_trade(cursor, signal['ticker'], date_str)
            
            if trade['result'] in ['win', 'loss']:
                total_trades += 1
                tickers_traded.append(signal['ticker'])
                
                if trade['result'] == 'win':
                    daily_wins += 1
                    total_wins += 1
                else:
                    daily_losses += 1
                    total_losses += 1
                
                daily_pnl += trade['pnl_pct']
                total_pnl += trade['pnl_pct']
        
        if tickers_traded:
            result = DailyResult(
                date=date_str,
                signals_found=len(signals),
                signals_taken=len(signals_to_take),
                trades_won=daily_wins,
                trades_lost=daily_losses,
                daily_pnl_pct=round(daily_pnl, 2),
                tickers=','.join(tickers_traded)
            )
            all_results.append(result)
        
        current += timedelta(days=1)
    
    conn.close()
    
    # ==================== RESULTS ====================
    
    win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
    avg_daily_pnl = total_pnl / len(all_results) if all_results else 0
    
    print("\n" + "="*70)
    print("📊 90-DAY ANALYSIS RESULTS")
    print("="*70)
    
    print(f"\n📈 OVERALL:")
    print(f"   Days with signals: {len(all_results)}")
    print(f"   Total signals found: {total_signals}")
    print(f"   Total trades taken: {total_trades}")
    print(f"   Wins: {total_wins}, Losses: {total_losses}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total P&L: {total_pnl:+.2f}%")
    print(f"   Avg Daily P&L: {avg_daily_pnl:+.2f}%")
    
    # ==================== SAVE CSV ====================
    
    csv_path = OUTPUT_DIR / 'egx_90day_analysis.csv'
    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'signals_found', 'signals_taken', 
                                                'trades_won', 'trades_lost', 'daily_pnl_pct', 'tickers'])
        writer.writeheader()
        for r in all_results:
            writer.writerow(asdict(r))
    
    print(f"\n📁 CSV saved to: {csv_path}")
    
    # ==================== SAVE SUMMARY ====================
    
    summary = {
        'period': f"{start_date.strftime('%Y-%m-%d')} to {max_date}",
        'total_days': len(all_results),
        'total_signals': total_signals,
        'total_trades': total_trades,
        'wins': total_wins,
        'losses': total_losses,
        'win_rate': round(win_rate, 2),
        'total_pnl': round(total_pnl, 2),
        'avg_daily_pnl': round(avg_daily_pnl, 2),
        'parameters': {
            'support_threshold': SUPPORT_THRESHOLD,
            'volume_ratio_min': VOLUME_RATIO_MIN,
            'target_pct': TARGET_PCT,
            'stop_loss_pct': STOP_LOSS_PCT,
            'max_signals_per_day': MAX_SIGNALS_PER_DAY
        },
        'status': 'SUCCESS' if win_rate >= 50 else 'NEEDS_TUNING',
        'decision': 'OPEN_API' if win_rate >= 50 else 'ADJUST_PARAMS'
    }
    
    summary_path = OUTPUT_DIR / 'egx_90day_summary.json'
    import json
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"📁 Summary saved to: {summary_path}")
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if win_rate >= 50:
        print(f"✅ SUCCESS - Win Rate {win_rate:.1f}% >= 50%")
        print("🎯 DECISION: Open API to users")
    else:
        print(f"⚠️ NEEDS TUNING - Win Rate {win_rate:.1f}% < 50%")
        print("🎯 DECISION: Adjust parameters (target 1%, stop 0.8%)")
    print("="*70 + "\n")
    
    return summary


if __name__ == '__main__':
    result = run_90_day_analysis()
    if result:
        import json
        print(json.dumps(result, indent=2))
