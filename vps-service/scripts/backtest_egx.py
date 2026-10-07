#!/usr/bin/env python3
"""
EGX Backtest - T+1 Strategy Only
اختبار بورصة مصر - استراتيجية T+1 فقط

السوق: EGX (البورصة المصرية)
الاستراتيجية: T+1 (يوم واحد)
المعاملات:
- الدعم: قرب 3% (مش 2%)
- السيولة: 1.2x المتوسط (مش 1.5x)
- الهدف: +2%
- الوقف: -1.5%
- رأس المال لكل صفقة: 10%
- أقصى صفقات مفتوحة: 3

التحقق:
- 60 يوم محاكاة
- الهدف: Win Rate > 50%، P&L واقعي > +15%
"""

import sys
import os
import json
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
import sqlite3
from pathlib import Path

# ==================== PATHS ====================

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = Path(__file__).parent.parent / 'backtest_results'
OUTPUT_DIR.mkdir(exist_ok=True)

# ==================== EGX-SPECIFIC PARAMETERS ====================

MARKET = 'EGX'
STRATEGY = 'T+1'

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# EGX T+1 Parameters
SUPPORT_THRESHOLD = 3.0    # الدعم: قرب 3%
VOLUME_RATIO_MIN = 1.2     # السيولة: 1.2x المتوسط
TARGET_PCT = 2.0           # الهدف: +2%
STOP_LOSS_PCT = 1.5        # الوقف: -1.5%
CAPITAL_PER_TRADE = 0.10   # 10% رأس مال
MAX_OPEN_TRADES = 3        # أقصى 3 صفقات

# Success Criteria
TARGET_WIN_RATE = 50.0
TARGET_PNL = 15.0

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
    volume_ratio: float = 0.0
    position_pct: float = 0.0

@dataclass
class BacktestResult:
    market: str
    strategy: str
    period: str
    total_trades: int
    win_rate: float
    total_pnl: float
    realistic_pnl: float
    best_trade: dict
    worst_trade: dict
    by_signal_type: dict
    status: str
    decision: str

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
    
    # Distance to support in %
    distance_to_support = ((current - support) / current) * 100 if current > 0 else 0
    
    return {
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'current': round(current, 2),
        'position_pct': round(position_pct, 2),
        'distance_to_support_pct': round(distance_to_support, 2),
        'at_support': position_pct <= 15,  # Close to support
        'near_support': position_pct <= 30
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    
    return round(current / avg, 2) if avg > 0 else 1.0


def get_egx_signal(position_pct: float, distance_to_support: float, volume_ratio: float) -> tuple:
    """
    EGX T+1 Signal Logic:
    - Entry when price is within 3% of support
    - Volume must be >= 1.2x average
    - Returns: (signal_type, target_pct, stop_pct)
    """
    # T+1: At support (within 3%) + good volume (>= 1.2x)
    if distance_to_support <= SUPPORT_THRESHOLD and volume_ratio >= VOLUME_RATIO_MIN:
        return ('t1_buy', TARGET_PCT, STOP_LOSS_PCT)
    
    # Near support with higher volume
    if position_pct <= 20 and volume_ratio >= 1.5:
        return ('t1_buy', TARGET_PCT, STOP_LOSS_PCT)
    
    # No signal
    return (None, 0, 0)


def simulate_t1_trade(entry: float, stop: float, target: float, future_data: list) -> tuple:
    """
    Simulate T+1 trade (exit at end of day 1).
    Returns: (exit_price, result, pnl_pct)
    """
    if not future_data:
        return entry, 'timeout', 0.0
    
    # T+1: Only look at first day
    day1 = future_data[0]
    high = day1.get('high_price', day1.get('close_price', 0))
    low = day1.get('low_price', day1.get('close_price', 0))
    close = day1.get('close_price', entry)
    
    # Check if target hit first
    if target > 0 and high >= target:
        pnl = ((target - entry) / entry) * 100
        return target, 'win', round(pnl, 2)
    
    # Check if stop hit
    if stop > 0 and low <= stop:
        pnl = ((stop - entry) / entry) * 100
        return stop, 'loss', round(pnl, 2)
    
    # Exit at close
    pnl = ((close - entry) / entry) * 100
    result = 'win' if close > entry else 'loss'
    return close, result, round(pnl, 2)


# ==================== MAIN BACKTEST ====================

def run_egx_backtest():
    print("\n" + "="*70)
    print(f"📈 {MARKET} BACKTEST - {STRATEGY} STRATEGY")
    print("="*70)
    print(f"Period: {START_DATE} to {END_DATE}")
    print(f"Support Threshold: {SUPPORT_THRESHOLD}%")
    print(f"Volume Ratio: {VOLUME_RATIO_MIN}x")
    print(f"Target: +{TARGET_PCT}%, Stop: -{STOP_LOSS_PCT}%")
    print(f"Capital per trade: {CAPITAL_PER_TRADE*100}%")
    print("="*70)
    
    # Connect to DB
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found: {PRICE_HISTORY_DB}")
        return None
    
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Crypto and non-EGX tokens to exclude
    EXCLUDE_TOKENS = [
        'BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
        'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC',
        'BCH', 'FIL', 'APT', 'ARB', 'OP', 'INJ', 'STX', 'HBAR', 'VET', 'GRT',
        'SAND', 'MANA', 'AAVE', 'MKR', 'SNX', 'CRV', 'SUSHI', 'COMP', 'YFI',
        'USDT', 'USDC', 'DAI', 'BUSD'  # Stablecoins
    ]
    
    # Get all EGX tickers (3-4 uppercase letters)
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= ? AND date <= ?
    ''', (START_DATE, END_DATE))
    all_tickers = [row['ticker'] for row in cursor.fetchall()]
    
    # Filter: EGX stocks are typically 3-4 uppercase letters
    egx_tickers = [
        t for t in all_tickers 
        if t not in EXCLUDE_TOKENS 
        and not t.startswith('USD')
        and len(t) >= 3 
        and len(t) <= 5
        and t.isupper()
    ]
    
    print(f"\n📊 Found {len(egx_tickers)} EGX tickers")
    
    all_trades = []
    by_ticker = {}
    
    # Iterate through dates
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        
        for ticker in egx_tickers:
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
                signal, target_pct, stop_pct = get_egx_signal(
                    sr['position_pct'],
                    sr['distance_to_support_pct'],
                    vol_ratio
                )
                
                if not signal:
                    continue
                
                # Get next day for T+1 simulation
                cursor.execute('''
                    SELECT date, open_price, high_price, low_price, close_price, volume 
                    FROM price_history 
                    WHERE ticker = ? AND date > ?
                    ORDER BY date ASC LIMIT 1
                ''', (ticker, date_str))
                
                future = [dict(r) for r in cursor.fetchall()]
                if not future:
                    continue
                
                # Entry = next day open
                entry = future[0]['open_price']
                if entry <= 0:
                    continue
                    
                target = entry * (1 + target_pct / 100)
                stop = entry * (1 - stop_pct / 100)
                
                # Simulate T+1
                exit_price, result, pnl = simulate_t1_trade(entry, stop, target, future)
                
                trade = Trade(
                    ticker=ticker,
                    signal_date=date_str,
                    signal_type=signal,
                    entry_price=round(entry, 2),
                    stop_loss=round(stop, 2),
                    target=round(target, 2),
                    exit_price=round(exit_price, 2),
                    result=result,
                    pnl_pct=pnl,
                    holding_days=1,
                    volume_ratio=vol_ratio,
                    position_pct=sr['position_pct']
                )
                
                all_trades.append(trade)
                
                # Stats by ticker
                if ticker not in by_ticker:
                    by_ticker[ticker] = {'trades': 0, 'wins': 0, 'pnl': 0.0}
                by_ticker[ticker]['trades'] += 1
                if result == 'win':
                    by_ticker[ticker]['wins'] += 1
                by_ticker[ticker]['pnl'] += pnl
                
            except Exception as e:
                continue
        
        current += timedelta(days=1)
    
    conn.close()
    
    # ==================== RESULTS ====================
    
    wins = [t for t in all_trades if t.result == 'win']
    losses = [t for t in all_trades if t.result == 'loss']
    
    total = len(all_trades)
    win_count = len(wins)
    
    win_rate = (win_count / total * 100) if total > 0 else 0
    total_pnl = sum(t.pnl_pct for t in all_trades)
    avg_win = sum(t.pnl_pct for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0
    
    # Realistic P&L with capital allocation
    # Assume 10% per trade, max 3 concurrent
    realistic_pnl = total_pnl * CAPITAL_PER_TRADE
    
    print("\n" + "="*70)
    print("📊 RESULTS")
    print("="*70)
    print(f"\n📈 TOTAL: {total} trades")
    print(f"   Wins: {win_count}, Losses: {len(losses)}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total P&L: {total_pnl:+.2f}%")
    print(f"   Realistic P&L (10% capital): {realistic_pnl:+.2f}%")
    print(f"   Avg Win: +{avg_win:.2f}%, Avg Loss: {avg_loss:.2f}%")
    
    if all_trades:
        best = max(all_trades, key=lambda x: x.pnl_pct)
        worst = min(all_trades, key=lambda x: x.pnl_pct)
        print(f"\n🏆 BEST: {best.ticker} @ {best.signal_date}: +{best.pnl_pct:.2f}%")
        print(f"💀 WORST: {worst.ticker} @ {worst.signal_date}: {worst.pnl_pct:.2f}%")
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if win_rate >= TARGET_WIN_RATE and realistic_pnl >= TARGET_PNL:
        print(f"✅ SUCCESS - Win Rate {win_rate:.1f}% >= {TARGET_WIN_RATE}% AND P&L {realistic_pnl:+.1f}% >= +{TARGET_PNL}%")
        status = 'SUCCESS'
        decision = 'CONTINUE'
    elif win_rate >= 40:
        print(f"⚠️ NEEDS TUNING - Win Rate {win_rate:.1f}% (Target: {TARGET_WIN_RATE}%)")
        status = 'NEEDS_TUNING'
        decision = 'ADJUST_PARAMS'
    else:
        print(f"❌ FAILED - Win Rate {win_rate:.1f}% < {TARGET_WIN_RATE}%")
        status = 'FAILED'
        decision = 'STOP'
    print("="*70 + "\n")
    
    # ==================== SAVE RESULTS ====================
    
    result = BacktestResult(
        market=MARKET,
        strategy=STRATEGY,
        period=f"{START_DATE} to {END_DATE}",
        total_trades=total,
        win_rate=round(win_rate, 2),
        total_pnl=round(total_pnl, 2),
        realistic_pnl=round(realistic_pnl, 2),
        best_trade=asdict(best) if all_trades else {},
        worst_trade=asdict(worst) if all_trades else {},
        by_signal_type={'t1_buy': {'count': total, 'wins': win_count, 'pnl': round(total_pnl, 2)}},
        status=status,
        decision=decision
    )
    
    output_path = OUTPUT_DIR / f'backtest_{MARKET.lower()}.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(result), f, indent=2, ensure_ascii=False)
    
    print(f"📁 Results saved to: {output_path}")
    
    return asdict(result)


if __name__ == '__main__':
    result = run_egx_backtest()
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
