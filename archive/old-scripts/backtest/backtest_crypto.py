#!/usr/bin/env python3
"""
Crypto Backtest - Breakout Strategy
اختبار الكريبتو - استراتيجية الاختراق

السوق: Crypto (عملات رقمية)
الاستراتيجية: Breakout (اختراق المقاومة)
المعاملات:
- الاختراق: السعر فوق أعلى 20 يوم بـ 2%
- السيولة: 2.0x (نشدد عشان الكريبتو فيه scam coins)
- الهدف: +8%
- الوقف: -5%
- رأس المال لكل صفقة: 5% (أقل من الأسهم عشان التقلب)
- أقصى صفقات مفتوحة: 2

التحقق:
- 60 يوم محاكاة
- الهدف: Win Rate > 40%
- لو فشل Breakout → نجرب "الهبوط للدعم" (Buy Dip)
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

# ==================== CRYPTO-SPECIFIC PARAMETERS ====================

MARKET = 'Crypto'
STRATEGY = 'Breakout'

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# Crypto Breakout Parameters (User Request)
BREAKOUT_THRESHOLD = 2.0   # اختراق 2% فوق أعلى 20 يوم
VOLUME_RATIO_MIN = 2.0     # السيولة: 2.0x

# Breakout targets - User specified
BREAKOUT_TARGET_PCT = 5.0  # هدف +5%
BREAKOUT_STOP_PCT = 3.0    # وقف -3%
MAX_DAYS = 10

CAPITAL_PER_TRADE = 0.05   # 5% رأس مال (أقل عشان التقلب)
MAX_OPEN_TRADES = 2

# Success Criteria (Crypto is harder)
TARGET_WIN_RATE = 40.0
TARGET_PNL = 10.0

# Known crypto tickers
CRYPTO_TICKERS = [
    'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'SOL', 'DOT', 'MATIC', 'LINK',
    'AVAX', 'ATOM', 'UNI', 'LTC', 'BCH', 'FIL', 'APT', 'ARB', 'OP', 'INJ',
    'STX', 'HBAR', 'VET', 'GRT', 'SAND', 'MANA', 'AAVE', 'MKR', 'SNX', 'CRV',
    'SUSHI', 'COMP', 'YFI', 'NEAR', 'TRX', 'LEO', 'WBT', 'RAIN', 'LAB', 'CC'
]

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
    breakout_pct: float = 0.0

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

def calculate_20_day_high(closes: list, period: int = 20) -> dict:
    """
    Calculate 20-day high for breakout detection.
    Crypto strategy: Buy when price breaks above resistance.
    """
    if len(closes) < period:
        period = len(closes)
    
    recent = closes[-period:]
    high_20 = max(recent)
    low_20 = min(recent)
    current = closes[-1]
    
    # Breakout = price above 20-day high
    breakout_pct = ((current - high_20) / high_20) * 100 if high_20 > 0 else 0
    
    # Distance to low (for buy dip alternative)
    distance_to_low = ((current - low_20) / current) * 100 if current > 0 else 0
    
    return {
        'high_20': round(high_20, 2),
        'low_20': round(low_20, 2),
        'current': round(current, 2),
        'breakout_pct': round(breakout_pct, 2),
        'is_breakout': breakout_pct >= BREAKOUT_THRESHOLD,
        'at_support': distance_to_low <= 5,  # Within 5% of low
        'range_pct': round(((high_20 - low_20) / low_20) * 100, 2) if low_20 > 0 else 0
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    
    return round(current / avg, 2) if avg > 0 else 1.0


def get_crypto_signal(breakout_pct: float, volume_ratio: float, at_support: bool) -> tuple:
    """
    Crypto Signal Logic - Breakout (NOT Support/Resistance):
    
    1. Breakout: Price above 20-day high by 2% + volume >= 2x
       - Target: +8%, Stop: -5%
    
    2. Buy Dip (alternative): At support (within 5% of 20-day low) + volume >= 1.5x
       - Target: +5%, Stop: -3%
    """
    # Primary: Breakout strategy
    if breakout_pct >= BREAKOUT_THRESHOLD and volume_ratio >= VOLUME_RATIO_MIN:
        return ('breakout_buy', BREAKOUT_TARGET_PCT, BREAKOUT_STOP_PCT)
    
    # Alternative: Buy Dip at support
    if at_support and volume_ratio >= 1.5:
        return ('buy_dip', 5.0, 3.0)
    
    return (None, 0, 0)


def simulate_crypto_trade(entry: float, stop: float, target: float, future_data: list, max_days: int) -> tuple:
    """Simulate crypto trade with higher volatility."""
    if not future_data:
        return entry, 'timeout', 0.0, 0
    
    for i, day in enumerate(future_data[:max_days]):
        high = day.get('high_price', day.get('close_price', 0))
        low = day.get('low_price', day.get('close_price', 0))
        
        # Check target first (crypto can spike)
        if target > 0 and high >= target:
            pnl = ((target - entry) / entry) * 100
            return target, 'win', round(pnl, 2), i + 1
        
        # Check stop (crypto can dump)
        if stop > 0 and low <= stop:
            pnl = ((stop - entry) / entry) * 100
            return stop, 'loss', round(pnl, 2), i + 1
    
    # Exit at last close
    last_close = future_data[min(max_days-1, len(future_data)-1)].get('close_price', entry)
    pnl = ((last_close - entry) / entry) * 100
    result = 'win' if last_close > entry else 'loss'
    return last_close, result, round(pnl, 2), max_days


# ==================== MAIN BACKTEST ====================

def run_crypto_backtest():
    print("\n" + "="*70)
    print(f"🪙 {MARKET} BACKTEST - {STRATEGY} STRATEGY")
    print("="*70)
    print(f"Period: {START_DATE} to {END_DATE}")
    print(f"Breakout: Price > 20-day high by {BREAKOUT_THRESHOLD}%")
    print(f"Volume: >= {VOLUME_RATIO_MIN}x")
    print(f"Target: +{BREAKOUT_TARGET_PCT}%, Stop: -{BREAKOUT_STOP_PCT}%")
    print(f"Capital: {CAPITAL_PER_TRADE*100}% per trade")
    print("="*70)
    
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found: {PRICE_HISTORY_DB}")
        return None
    
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all crypto tickers
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= ? AND date <= ?
    ''', (START_DATE, END_DATE))
    all_tickers = [row['ticker'] for row in cursor.fetchall()]
    
    # Filter to known crypto
    crypto_tickers = [t for t in all_tickers if t in CRYPTO_TICKERS]
    
    print(f"\n📊 Testing {len(crypto_tickers)} crypto tokens")
    
    all_trades = []
    by_signal = {'breakout_buy': {'count': 0, 'wins': 0, 'pnl': 0.0},
                 'buy_dip': {'count': 0, 'wins': 0, 'pnl': 0.0}}
    
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        
        for ticker in crypto_tickers:
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
                
                high_data = calculate_20_day_high(closes, 20)
                vol_ratio = calculate_volume_ratio(volumes)
                
                signal, target_pct, stop_pct = get_crypto_signal(
                    high_data['breakout_pct'],
                    vol_ratio,
                    high_data['at_support']
                )
                
                if not signal:
                    continue
                
                cursor.execute('''
                    SELECT date, open_price, high_price, low_price, close_price, volume 
                    FROM price_history 
                    WHERE ticker = ? AND date > ?
                    ORDER BY date ASC LIMIT 15
                ''', (ticker, date_str))
                
                future = [dict(r) for r in cursor.fetchall()]
                if not future:
                    continue
                
                entry = future[0]['open_price']
                if entry <= 0:
                    continue
                
                target = entry * (1 + target_pct / 100)
                stop = entry * (1 - stop_pct / 100)
                
                exit_price, result, pnl, days = simulate_crypto_trade(entry, stop, target, future[1:], MAX_DAYS)
                
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
                    breakout_pct=high_data['breakout_pct']
                )
                
                all_trades.append(trade)
                
                by_signal[signal]['count'] += 1
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
    print(f"   Realistic P&L (5% capital): {realistic_pnl:+.2f}%")
    
    print(f"\n📈 BY SIGNAL:")
    for sig, stats in by_signal.items():
        wr = (stats['wins'] / stats['count'] * 100) if stats['count'] > 0 else 0
        print(f"   {sig}: {stats['count']} trades, {wr:.1f}% WR, {stats['pnl']:+.2f}%")
    
    if all_trades:
        best = max(all_trades, key=lambda x: x.pnl_pct)
        worst = min(all_trades, key=lambda x: x.pnl_pct)
        print(f"\n🏆 BEST: {best.ticker} @ {best.signal_date}: +{best.pnl_pct:.2f}%")
        print(f"💀 WORST: {worst.ticker} @ {worst.signal_date}: {worst.pnl_pct:.2f}%")
    else:
        best = worst = None
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if win_rate >= TARGET_WIN_RATE and realistic_pnl >= TARGET_PNL:
        print(f"✅ SUCCESS - Win Rate {win_rate:.1f}% >= {TARGET_WIN_RATE}%")
        status = 'SUCCESS'
        decision = 'CONTINUE'
    elif win_rate >= 30:
        print(f"⚠️ NEEDS TUNING - Win Rate {win_rate:.1f}%")
        status = 'NEEDS_TUNING'
        decision = 'TRY_BUY_DIP'
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
        by_signal_type=by_signal,
        status=status,
        decision=decision
    )
    
    output_path = OUTPUT_DIR / f'backtest_{MARKET.lower()}.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(result), f, indent=2, ensure_ascii=False)
    
    print(f"📁 Results saved to: {output_path}")
    return asdict(result)


if __name__ == '__main__':
    result = run_crypto_backtest()
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
