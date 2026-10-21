#!/usr/bin/env python3
"""
KSE (Kuwait) Backtest - Swing Strategy Only
اختبار بورصة الكويت - استراتيجية Swing فقط

السوق: KSE (الكويت)
الاستراتيجية: Swing (3-5 أيام)
المعاملات:
- الدعم: قرب 3%
- السيولة: 1.0x (الكويت سيولته أقل، ماتشددش)
- الهدف: +5%
- الوقف: -3%
- رأس المال لكل صفقة: 10%
- أقصى صفقات مفتوحة: 3

التحقق:
- 60 يوم محاكاة
- الهدف: Win Rate > 45%
- T+1 في الكويت مش نشط → لو فشل Swing → نوقف الكويت
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

# ==================== KSE-SPECIFIC PARAMETERS ====================

MARKET = 'KSE'
STRATEGY = 'Swing'

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# KSE Swing Parameters (User Request)
SUPPORT_THRESHOLD = 3.0    # الدعم: قرب 3%
VOLUME_RATIO_MIN = 1.0     # السيولة: 1.0x

# Swing (3-5 days) - User specified
SWING_TARGET_PCT = 2.0    # هدف +2%
SWING_STOP_PCT = 1.5      # وقف -1.5%
SWING_MAX_DAYS = 5

CAPITAL_PER_TRADE = 0.10
MAX_OPEN_TRADES = 3

# Success Criteria
TARGET_WIN_RATE = 45.0
TARGET_PNL = 8.0

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
    
    distance_to_support = ((current - support) / current) * 100 if current > 0 else 0
    
    return {
        'support': round(support, 2),
        'resistance': round(resistance, 2),
        'current': round(current, 2),
        'position_pct': round(position_pct, 2),
        'distance_to_support_pct': round(distance_to_support, 2),
        'at_support': position_pct <= 15,
        'near_support': position_pct <= 30
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    
    return round(current / avg, 2) if avg > 0 else 1.0


def get_kse_signal(position_pct: float, distance_to_support: float, volume_ratio: float) -> tuple:
    """
    KSE Signal Logic - Swing Only:
    - Entry when price is within 3% of support
    - Volume >= 1.0x (not strict)
    """
    # Swing: Near support with any volume
    if distance_to_support <= SUPPORT_THRESHOLD or position_pct <= 25:
        return ('swing_buy', SWING_TARGET_PCT, SWING_STOP_PCT)
    
    return (None, 0, 0)


def simulate_swing_trade(entry: float, stop: float, target: float, future_data: list, max_days: int) -> tuple:
    """Simulate swing trade (3-5 days)."""
    if not future_data:
        return entry, 'timeout', 0.0, 0
    
    for i, day in enumerate(future_data[:max_days]):
        high = day.get('high_price', day.get('close_price', 0))
        low = day.get('low_price', day.get('close_price', 0))
        
        if target > 0 and high >= target:
            pnl = ((target - entry) / entry) * 100
            return target, 'win', round(pnl, 2), i + 1
        
        if stop > 0 and low <= stop:
            pnl = ((stop - entry) / entry) * 100
            return stop, 'loss', round(pnl, 2), i + 1
    
    last_close = future_data[min(max_days-1, len(future_data)-1)].get('close_price', entry)
    pnl = ((last_close - entry) / entry) * 100
    result = 'win' if last_close > entry else 'loss'
    return last_close, result, round(pnl, 2), max_days


# ==================== MAIN BACKTEST ====================

def run_kse_backtest():
    print("\n" + "="*70)
    print(f"📈 {MARKET} BACKTEST - {STRATEGY} STRATEGY")
    print("="*70)
    print(f"Period: {START_DATE} to {END_DATE}")
    print(f"Target: +{SWING_TARGET_PCT}%, Stop: -{SWING_STOP_PCT}%")
    print(f"Max Days: {SWING_MAX_DAYS}")
    print("="*70)
    
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found: {PRICE_HISTORY_DB}")
        return None
    
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= ? AND date <= ?
    ''', (START_DATE, END_DATE))
    all_tickers = [row['ticker'] for row in cursor.fetchall()]
    
    # Kuwait stocks
    kuwait_tickers = [t for t in all_tickers if len(t) >= 3 and t.isupper()][:80]
    
    print(f"\n📊 Testing {len(kuwait_tickers)} tickers")
    
    all_trades = []
    
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        
        for ticker in kuwait_tickers:
            try:
                cursor.execute('''
                    SELECT date, open_price, high_price, low_price, close_price, volume 
                    FROM price_history 
                    WHERE ticker = ? AND date <= ?
                    ORDER BY date DESC LIMIT 60
                ''', (ticker, date_str))
                
                rows = list(cursor.fetchall())
                if len(rows) < 30:
                    continue
                
                rows.reverse()
                closes = [r['close_price'] for r in rows if r['close_price'] > 0]
                volumes = [r['volume'] for r in rows]
                
                if len(closes) < 30:
                    continue
                
                sr = calculate_support_resistance(closes, 20)
                vol_ratio = calculate_volume_ratio(volumes)
                
                signal, target_pct, stop_pct = get_kse_signal(
                    sr['position_pct'],
                    sr['distance_to_support_pct'],
                    vol_ratio
                )
                
                if not signal:
                    continue
                
                cursor.execute('''
                    SELECT date, open_price, high_price, low_price, close_price, volume 
                    FROM price_history 
                    WHERE ticker = ? AND date > ?
                    ORDER BY date ASC LIMIT 10
                ''', (ticker, date_str))
                
                future = [dict(r) for r in cursor.fetchall()]
                if not future:
                    continue
                
                entry = future[0]['open_price']
                if entry <= 0:
                    continue
                
                target = entry * (1 + target_pct / 100)
                stop = entry * (1 - stop_pct / 100)
                
                exit_price, result, pnl, days = simulate_swing_trade(entry, stop, target, future[1:], SWING_MAX_DAYS)
                
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
                    holding_days=days,
                    volume_ratio=vol_ratio,
                    position_pct=sr['position_pct']
                )
                
                all_trades.append(trade)
                
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
    realistic_pnl = total_pnl * CAPITAL_PER_TRADE
    
    print("\n" + "="*70)
    print("📊 RESULTS")
    print("="*70)
    print(f"\n📈 TOTAL: {total} trades")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Total P&L: {total_pnl:+.2f}%")
    print(f"   Realistic P&L: {realistic_pnl:+.2f}%")
    
    if all_trades:
        best = max(all_trades, key=lambda x: x.pnl_pct)
        worst = min(all_trades, key=lambda x: x.pnl_pct)
        print(f"\n🏆 BEST: {best.ticker} @ {best.signal_date}: +{best.pnl_pct:.2f}%")
        print(f"💀 WORST: {worst.ticker} @ {worst.signal_date}: {worst.pnl_pct:.2f}%")
    else:
        best = worst = None
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if total < 10:
        print(f"⚠️ LOW SIGNALS - Only {total} trades in 60 days")
        status = 'LOW_LIQUIDITY'
        decision = 'STOP'
    elif win_rate >= TARGET_WIN_RATE:
        print(f"✅ SUCCESS - Win Rate {win_rate:.1f}% >= {TARGET_WIN_RATE}%")
        status = 'SUCCESS'
        decision = 'CONTINUE'
    elif win_rate >= 35:
        print(f"⚠️ NEEDS TUNING - Win Rate {win_rate:.1f}%")
        status = 'NEEDS_TUNING'
        decision = 'ADJUST_PARAMS'
    else:
        print(f"❌ FAILED - Win Rate {win_rate:.1f}% < {TARGET_WIN_RATE}%")
        status = 'FAILED'
        decision = 'STOP'
    print("="*70 + "\n")
    
    result = BacktestResult(
        market=MARKET,
        strategy=STRATEGY,
        period=f"{START_DATE} to {END_DATE}",
        total_trades=total,
        win_rate=round(win_rate, 2),
        total_pnl=round(total_pnl, 2),
        realistic_pnl=round(realistic_pnl, 2),
        best_trade=asdict(best) if best else {},
        worst_trade=asdict(worst) if worst else {},
        by_signal_type={'swing_buy': {'count': total, 'wins': win_count, 'pnl': round(total_pnl, 2)}},
        status=status,
        decision=decision
    )
    
    output_path = OUTPUT_DIR / f'backtest_{MARKET.lower()}.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(result), f, indent=2, ensure_ascii=False)
    
    print(f"📁 Results saved to: {output_path}")
    return asdict(result)


if __name__ == '__main__':
    result = run_kse_backtest()
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
