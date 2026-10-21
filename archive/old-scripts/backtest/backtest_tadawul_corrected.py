#!/usr/bin/env python3
"""
TADAWUL (Saudi) Backtest - CORRECTED
اختبار بورصة السعودية - مصحح

الإصلاحات:
1. Max 3 concurrent trades
2. Capital tracking (100K initial)
3. 10% position size FIXED
4. T+1 only (exit next day)
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

# ==================== TADAWUL PARAMETERS ====================

MARKET = 'TADAWUL'
STRATEGY = 'T+1'

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# Capital Management
INITIAL_CAPITAL = 100000.0    # 100,000 SAR
CAPITAL_PER_TRADE = 0.10      # 10% = 10,000 SAR
MAX_CONCURRENT_TRADES = 3     # أقصى 3 صفقات في نفس الوقت

# Signal Parameters
SUPPORT_THRESHOLD = 3.0       # قرب 3% من الدعم
VOLUME_RATIO_MIN = 1.2        # سيولة 1.2x
TARGET_PCT = 2.5              # هدف +2.5%
STOP_LOSS_PCT = 1.5           # وقف -1.5%

# ==================== TYPES ====================

@dataclass
class Trade:
    ticker: str
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    target: float
    stop_loss: float
    result: str
    pnl_pct: float
    pnl_amount: float
    holding_days: int
    volume_ratio: float

@dataclass
class BacktestResult:
    market: str
    strategy: str
    period: str
    initial_capital: float
    final_capital: float
    total_trades: int
    win_rate: float
    total_pnl_pct: float
    total_pnl_amount: float
    max_concurrent_trades: int
    best_trade: dict
    worst_trade: dict
    status: str
    decision: str

# ==================== CORE FUNCTIONS ====================

def calculate_support_resistance(closes: list, period: int = 20) -> dict:
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
    if len(volumes) < 5:
        return 1.0
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    return round(current / avg, 2) if avg > 0 else 1.0


def find_signals(cursor, tickers: list, date_str: str) -> list:
    """Find all signals for a given day, sorted by quality."""
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
        
        # Check signal conditions
        if sr['distance_to_support_pct'] <= SUPPORT_THRESHOLD and vol_ratio >= VOLUME_RATIO_MIN:
            signals.append({
                'ticker': ticker,
                'date': date_str,
                'entry_price': sr['support'] * 1.01,
                'dist_to_support': sr['distance_to_support_pct'],
                'volume_ratio': vol_ratio
            })
    
    # Sort by: closest to support, then highest volume
    signals.sort(key=lambda s: (s['dist_to_support'], -s['volume_ratio']))
    
    return signals


def simulate_t1_trade(signal: dict, cursor, entry_date: str) -> Trade:
    """Simulate T+1 trade (exit next day)."""
    cursor.execute('''
        SELECT date, open_price, high_price, low_price, close_price 
        FROM price_history 
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT 1
    ''', (signal['ticker'], entry_date))
    
    row = cursor.fetchone()
    if not row:
        return None
    
    exit_date = row[0]
    entry_price = row[1]
    high = row[2]
    low = row[3]
    close = row[4]
    
    if entry_price <= 0:
        return None
    
    target = entry_price * (1 + TARGET_PCT / 100)
    stop = entry_price * (1 - STOP_LOSS_PCT / 100)
    
    # Simulate the trade
    if high >= target:
        exit_price = target
        result = 'win'
    elif low <= stop:
        exit_price = stop
        result = 'loss'
    else:
        exit_price = close
        result = 'win' if close > entry_price else 'loss'
    
    pnl_pct = ((exit_price - entry_price) / entry_price) * 100
    
    return Trade(
        ticker=signal['ticker'],
        entry_date=entry_date,
        entry_price=round(entry_price, 2),
        exit_date=exit_date,
        exit_price=round(exit_price, 2),
        target=round(target, 2),
        stop_loss=round(stop, 2),
        result=result,
        pnl_pct=round(pnl_pct, 2),
        pnl_amount=round(INITIAL_CAPITAL * CAPITAL_PER_TRADE * pnl_pct / 100, 2),
        holding_days=1,
        volume_ratio=signal['volume_ratio']
    )


# ==================== MAIN BACKTEST ====================

def run_tadawul_backtest_corrected():
    print("\n" + "="*70)
    print(f"📈 {MARKET} BACKTEST - CORRECTED")
    print("="*70)
    print(f"Initial Capital: {INITIAL_CAPITAL:,.0f} SAR")
    print(f"Per Trade: {CAPITAL_PER_TRADE*100}% = {INITIAL_CAPITAL * CAPITAL_PER_TRADE:,.0f} SAR")
    print(f"Max Concurrent: {MAX_CONCURRENT_TRADES}")
    print(f"Target: +{TARGET_PCT}%, Stop: -{STOP_LOSS_PCT}%")
    print("="*70)
    
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found")
        return None
    
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    cursor = conn.cursor()
    
    # Get all tickers
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= ? AND date <= ?
    ''', (START_DATE, END_DATE))
    
    # Filter to Saudi-like tickers (not crypto)
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC', 'BTC', 'ETH']
    
    all_tickers = [row[0] for row in cursor.fetchall()]
    saudi_tickers = [t for t in all_tickers if t not in CRYPTO and len(t) >= 3 and len(t) <= 5 and t.isupper()]
    
    print(f"\n📊 Found {len(saudi_tickers)} tickers")
    
    # State tracking
    capital = INITIAL_CAPITAL
    open_trades = []
    all_trades = []
    max_concurrent = 0
    
    total_signals = 0
    signals_taken = 0
    
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        
        # Find all signals for today
        signals = find_signals(cursor, saudi_tickers, date_str)
        total_signals += len(signals)
        
        # Take only available slots
        available_slots = MAX_CONCURRENT_TRADES - len(open_trades)
        signals_to_take = signals[:available_slots]
        signals_taken += len(signals_to_take)
        
        # Open new trades
        for signal in signals_to_take:
            trade = simulate_t1_trade(signal, cursor, date_str)
            if trade:
                all_trades.append(trade)
                capital += trade.pnl_amount
        
        max_concurrent = max(max_concurrent, len(signals_to_take))
        
        current += timedelta(days=1)
    
    conn.close()
    
    # ==================== RESULTS ====================
    
    wins = [t for t in all_trades if t.result == 'win']
    losses = [t for t in all_trades if t.result == 'loss']
    
    total_trades = len(all_trades)
    win_count = len(wins)
    win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0
    
    total_pnl = capital - INITIAL_CAPITAL
    total_pnl_pct = (total_pnl / INITIAL_CAPITAL) * 100
    
    print("\n" + "="*70)
    print("📊 CORRECTED RESULTS")
    print("="*70)
    
    print(f"\n📈 SIGNAL ANALYSIS:")
    print(f"   Total signals: {total_signals}")
    print(f"   Signals taken: {signals_taken}")
    print(f"   Signals rejected: {total_signals - signals_taken}")
    
    print(f"\n💰 CAPITAL ANALYSIS:")
    print(f"   Initial Capital: {INITIAL_CAPITAL:,.0f} SAR")
    print(f"   Final Capital: {capital:,.0f} SAR")
    print(f"   P&L Amount: {total_pnl:+,.0f} SAR")
    print(f"   P&L Percentage: {total_pnl_pct:+.2f}%")
    
    print(f"\n📊 TRADE ANALYSIS:")
    print(f"   Total Trades: {total_trades}")
    print(f"   Wins: {win_count}, Losses: {len(losses)}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Max Concurrent: {max_concurrent}")
    
    if all_trades:
        best = max(all_trades, key=lambda x: x.pnl_amount)
        worst = min(all_trades, key=lambda x: x.pnl_amount)
        print(f"\n🏆 BEST: {best.ticker} @ {best.entry_date}: {best.pnl_pct:+.2f}% = {best.pnl_amount:+,.0f} SAR")
        print(f"💀 WORST: {worst.ticker} @ {worst.entry_date}: {worst.pnl_pct:+.2f}% = {worst.pnl_amount:+,.0f} SAR")
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if win_rate >= 50 and total_pnl_pct >= 5:
        print(f"✅ SUCCESS - Win Rate {win_rate:.1f}% >= 50%")
        status = 'SUCCESS'
        decision = 'CONTINUE'
    elif win_rate >= 40:
        print(f"⚠️ NEEDS TUNING - Win Rate {win_rate:.1f}%")
        status = 'NEEDS_TUNING'
        decision = 'ADJUST'
    else:
        print(f"❌ FAILED - Win Rate {win_rate:.1f}%")
        status = 'FAILED'
        decision = 'STOP'
    print("="*70 + "\n")
    
    result = BacktestResult(
        market=MARKET,
        strategy=STRATEGY,
        period=f"{START_DATE} to {END_DATE}",
        initial_capital=INITIAL_CAPITAL,
        final_capital=round(capital, 2),
        total_trades=total_trades,
        win_rate=round(win_rate, 2),
        total_pnl_pct=round(total_pnl_pct, 2),
        total_pnl_amount=round(total_pnl, 2),
        max_concurrent_trades=max_concurrent,
        best_trade=asdict(best) if all_trades else {},
        worst_trade=asdict(worst) if all_trades else {},
        status=status,
        decision=decision
    )
    
    output_path = OUTPUT_DIR / 'backtest_tadawul_corrected.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(result), f, indent=2, ensure_ascii=False)
    
    print(f"📁 Results saved to: {output_path}")
    return asdict(result)


if __name__ == '__main__':
    result = run_tadawul_backtest_corrected()
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
