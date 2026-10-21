#!/usr/bin/env python3
"""
CORRECTED EGX Backtest - Realistic Capital Tracking
اختبار مصحح للبورصة المصرية - تتبع رأس المال الواقعي

Fixes:
1. Max 3 concurrent trades (not all signals)
2. Realistic P&L calculation with capital tracking
3. Only take best 3 signals per day
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

# ==================== REALISTIC PARAMETERS ====================

MARKET = 'EGX'
STRATEGY = 'T+1'

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# Capital Management
INITIAL_CAPITAL = 100000.0    # 100,000 جنيه
CAPITAL_PER_TRADE = 0.10      # 10% = 10,000 جنيه
MAX_CONCURRENT_TRADES = 3     # أقصى 3 صفقات في نفس الوقت

# Signal Parameters
SUPPORT_THRESHOLD = 4.0       # قرب 4% من الدعم (وسعنا من 3%)
VOLUME_RATIO_MIN = 1.2        # سيولة 1.2x
TARGET_PCT = 1.5              # هدف +1.5% (خففنا من 2%)
STOP_LOSS_PCT = 1.0           # وقف -1% (خففنا من 1.5%)

# ==================== TYPES ====================

@dataclass
class Signal:
    ticker: str
    date: str
    entry_price: float
    target: float
    stop_loss: float
    score: float  # Higher is better (volume ratio × proximity to support)

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
    pnl_amount: float  # Actual money made/lost
    holding_days: int

@dataclass
class DayState:
    date: str
    capital: float
    open_trades: list
    daily_pnl: float

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
    """Calculate support and resistance."""
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
        'position_pct': round(position_pct, 2),
        'distance_to_support_pct': round(distance_to_support, 2)
    }


def calculate_volume_ratio(volumes: list) -> float:
    """Calculate volume ratio vs 20-day average."""
    if len(volumes) < 5:
        return 1.0
    current = volumes[-1]
    avg = sum(volumes[-20:]) / min(20, len(volumes))
    return round(current / avg, 2) if avg > 0 else 1.0


def find_signals(cursor, tickers: list, date_str: str, egx30_tickers: set = None) -> list:
    """
    Find all signals for a given day.
    
    Ranking (best signals first):
    1. distance_to_support (الأقل = أحسن) - السعر قرب الدعم
    2. volume_ratio (الأعلى = أحسن) - سيولة عالية
    3. EGX30 membership (في EGX30 = أحسن) - أسهم كبيرة
    """
    signals = []
    
    if egx30_tickers is None:
        egx30_tickers = set()
    
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
            # EGX30 bonus
            is_egx30 = 1 if ticker in egx30_tickers else 0
            
            signals.append({
                'ticker': ticker,
                'date': date_str,
                'entry_price': sr['support'] * 1.01,
                'target': sr['support'] * 1.01 * (1 + TARGET_PCT / 100),
                'stop_loss': sr['support'] * 1.01 * (1 - STOP_LOSS_PCT / 100),
                'dist_to_support': sr['distance_to_support_pct'],
                'volume_ratio': vol_ratio,
                'is_egx30': is_egx30
            })
    
    # Sort by: 1) closest to support, 2) highest volume, 3) EGX30 first
    signals.sort(key=lambda s: (
        s['dist_to_support'],      # الأقل أولاً (قرب الدعم)
        -s['volume_ratio'],        # الأعلى أولاً (سيولة عالية)
        -s['is_egx30']             # EGX30 أولاً
    ))
    
    return signals


def simulate_t1_trade(signal: dict, cursor, entry_date: str) -> Trade:
    """Simulate T+1 trade (exit next day). signal is a dict."""
    # Get next day's data
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
    entry_price = row[1]  # Open price
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
        holding_days=1
    )


# ==================== MAIN BACKTEST ====================

def run_corrected_backtest():
    print("\n" + "="*70)
    print(f"📈 {MARKET} CORRECTED BACKTEST - REALISTIC CAPITAL TRACKING")
    print("="*70)
    print(f"Initial Capital: {INITIAL_CAPITAL:,.0f}")
    print(f"Per Trade: {CAPITAL_PER_TRADE*100}% = {INITIAL_CAPITAL * CAPITAL_PER_TRADE:,.0f}")
    print(f"Max Concurrent: {MAX_CONCURRENT_TRADES}")
    print(f"Period: {START_DATE} to {END_DATE}")
    print("="*70)
    
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ Database not found")
        return None
    
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    cursor = conn.cursor()
    
    # Get EGX tickers
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= ? AND date <= ?
    ''', (START_DATE, END_DATE))
    
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC']
    
    all_tickers = [row[0] for row in cursor.fetchall()]
    egx_tickers = [t for t in all_tickers if t not in CRYPTO and len(t) >= 3 and len(t) <= 5 and t.isupper()]
    
    # EGX30 stocks (major stocks - higher priority)
    EGX30 = {
        'COMI', 'ETAL', 'HRHO', 'EKHO', 'PHDC', 'SWDY', 'AMOC', 'ESRS', 'MNHD', 'ORAS',
        'ALCN', 'AUTO', 'BTFH', 'CCAP', 'CHFI', 'DCRC', 'EGTS', 'ELFA', 'EMFD', 'FWRY',
        'GANO', 'GLBL', 'GVAL', 'HELI', 'IRON', 'ISPH', 'KABO', 'KOCK', 'LZEMA', 'MAAL',
        'MCQE', 'MFPC', 'MOIC', 'MPCI', 'MTIE', 'NINH', 'NTRA', 'OCDI', 'OCDI', 'OMOT',
        'ORHD', 'PACH', 'PRDC', 'PTSP', 'RAYA', 'RMTI', 'SAUD', 'SKPC', 'SPMD', 'TECH',
        'TMGH', 'TOUR', 'UEGC', 'UEIC', 'UPAP', 'ZMHD', 'EZDK', 'ALBL', 'BEME', 'EGP3'
    }
    
    print(f"\n📊 Found {len(egx_tickers)} EGX tickers ({len([t for t in egx_tickers if t in EGX30])} in EGX30)")
    
    # State tracking
    capital = INITIAL_CAPITAL
    open_trades = []  # T+1 trades close next day, so this is mostly empty
    all_trades = []
    max_concurrent = 0
    
    # Track signals rejected due to capacity
    total_signals = 0
    signals_taken = 0
    
    # Iterate through dates
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        
        # Find all signals for today (sorted by quality: closest to support, highest volume, EGX30 first)
        signals = find_signals(cursor, egx_tickers, date_str, EGX30)
        total_signals += len(signals)
        
        # How many trades can we open today?
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
    print(f"   Total signals generated: {total_signals}")
    print(f"   Signals taken (capacity limited): {signals_taken}")
    print(f"   Signals rejected: {total_signals - signals_taken}")
    
    print(f"\n💰 CAPITAL ANALYSIS:")
    print(f"   Initial Capital: {INITIAL_CAPITAL:,.0f}")
    print(f"   Final Capital: {capital:,.0f}")
    print(f"   P&L Amount: {total_pnl:+,.0f}")
    print(f"   P&L Percentage: {total_pnl_pct:+.2f}%")
    
    print(f"\n📊 TRADE ANALYSIS:")
    print(f"   Total Trades: {total_trades}")
    print(f"   Wins: {win_count}, Losses: {len(losses)}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Max Concurrent: {max_concurrent}")
    
    if all_trades:
        best = max(all_trades, key=lambda x: x.pnl_amount)
        worst = min(all_trades, key=lambda x: x.pnl_amount)
        print(f"\n🏆 BEST: {best.ticker} @ {best.entry_date}: {best.pnl_pct:+.2f}% = {best.pnl_amount:+,.0f}")
        print(f"💀 WORST: {worst.ticker} @ {worst.entry_date}: {worst.pnl_pct:+.2f}% = {worst.pnl_amount:+,.0f}")
    
    # ==================== COMPARISON ====================
    
    print("\n" + "="*70)
    print("📊 COMPARISON: WRONG vs CORRECT")
    print("="*70)
    print(f"\n❌ WRONG (old backtest):")
    print(f"   Trades: 1,312")
    print(f"   P&L: +63.36%")
    
    print(f"\n✅ CORRECT (this backtest):")
    print(f"   Trades: {total_trades}")
    print(f"   P&L: {total_pnl_pct:+.2f}%")
    
    print(f"\n📉 Difference:")
    print(f"   Trades reduced by: {((1312 - total_trades) / 1312 * 100):.1f}%")
    print(f"   P&L reduced by: {((63.36 - total_pnl_pct) / 63.36 * 100):.1f}%")
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if win_rate >= 50 and total_pnl_pct >= 5:
        print(f"✅ SUCCESS - Win Rate {win_rate:.1f}% >= 50% AND P&L {total_pnl_pct:+.2f}% >= +5%")
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
    
    output_path = OUTPUT_DIR / 'backtest_egx_corrected.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(result), f, indent=2, ensure_ascii=False)
    
    print(f"📁 Results saved to: {output_path}")
    return asdict(result)


if __name__ == '__main__':
    result = run_corrected_backtest()
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
