#!/usr/bin/env python3
"""
KSE (Kuwait) Backtest - CORRECTED
اختبار بورصة الكويت - مصحح

الإصلاحات:
1. Max 3 concurrent trades
2. Capital tracking (100K initial)
3. 10% position size FIXED
4. Volume filter ENFORCED (>= 1.0x)
5. Swing strategy (3-5 days)
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

# ==================== KSE PARAMETERS ====================

MARKET = 'KSE'
STRATEGY = 'Swing'

START_DATE = '2025-04-01'
END_DATE = '2025-05-31'

# Capital Management
INITIAL_CAPITAL = 100000.0    # 100,000 KWD
CAPITAL_PER_TRADE = 0.10      # 10% = 10,000 KWD
MAX_CONCURRENT_TRADES = 3     # أقصى 3 صفقات في نفس الوقت

# Signal Parameters
SUPPORT_THRESHOLD = 3.0       # قرب 3% من الدعم
VOLUME_RATIO_MIN = 1.0        # سيولة 1.0x (إجباري!)
TARGET_PCT = 2.0              # هدف +2%
STOP_LOSS_PCT = 1.5           # وقف -1.5%
MAX_HOLDING_DAYS = 5          # Swing: أقصى 5 أيام

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
class OpenPosition:
    ticker: str
    entry_date: str
    entry_price: float
    target: float
    stop_loss: float
    entry_day: int  # Day counter for tracking

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
    """Find all signals for a given day, ENFORCING volume filter."""
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
        
        # ENFORCE volume filter - لا تدخل لو volume < 1.0x
        if vol_ratio < VOLUME_RATIO_MIN:
            continue
        
        # Check signal conditions
        if sr['distance_to_support_pct'] <= SUPPORT_THRESHOLD:
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


def simulate_swing_trade(signal: dict, cursor, entry_date: str) -> Trade:
    """Simulate Swing trade (exit within 5 days)."""
    cursor.execute('''
        SELECT date, open_price, high_price, low_price, close_price 
        FROM price_history 
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC LIMIT ?
    ''', (signal['ticker'], entry_date, MAX_HOLDING_DAYS + 1))
    
    rows = list(cursor.fetchall())
    if not rows:
        return None
    
    entry_price = rows[0][1]  # Open price next day
    if entry_price <= 0:
        return None
    
    target = entry_price * (1 + TARGET_PCT / 100)
    stop = entry_price * (1 - STOP_LOSS_PCT / 100)
    
    # Check each day for exit
    for i, row in enumerate(rows[1:], 1):
        exit_date = row[0]
        high = row[2]
        low = row[3]
        close = row[4]
        
        if high >= target:
            pnl_pct = ((target - entry_price) / entry_price) * 100
            return Trade(
                ticker=signal['ticker'],
                entry_date=entry_date,
                entry_price=round(entry_price, 2),
                exit_date=exit_date,
                exit_price=round(target, 2),
                target=round(target, 2),
                stop_loss=round(stop, 2),
                result='win',
                pnl_pct=round(pnl_pct, 2),
                pnl_amount=round(INITIAL_CAPITAL * CAPITAL_PER_TRADE * pnl_pct / 100, 2),
                holding_days=i,
                volume_ratio=signal['volume_ratio']
            )
        
        if low <= stop:
            pnl_pct = ((stop - entry_price) / entry_price) * 100
            return Trade(
                ticker=signal['ticker'],
                entry_date=entry_date,
                entry_price=round(entry_price, 2),
                exit_date=exit_date,
                exit_price=round(stop, 2),
                target=round(target, 2),
                stop_loss=round(stop, 2),
                result='loss',
                pnl_pct=round(pnl_pct, 2),
                pnl_amount=round(INITIAL_CAPITAL * CAPITAL_PER_TRADE * pnl_pct / 100, 2),
                holding_days=i,
                volume_ratio=signal['volume_ratio']
            )
    
    # Exit at last close if no target/stop hit
    last_row = rows[-1]
    exit_date = last_row[0]
    exit_price = last_row[4]
    pnl_pct = ((exit_price - entry_price) / entry_price) * 100
    result = 'win' if exit_price > entry_price else 'loss'
    
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
        holding_days=min(len(rows) - 1, MAX_HOLDING_DAYS),
        volume_ratio=signal['volume_ratio']
    )


# ==================== MAIN BACKTEST ====================

def run_kse_backtest_corrected():
    print("\n" + "="*70)
    print(f"📈 {MARKET} BACKTEST - CORRECTED")
    print("="*70)
    print(f"Initial Capital: {INITIAL_CAPITAL:,.0f} KWD")
    print(f"Per Trade: {CAPITAL_PER_TRADE*100}% = {INITIAL_CAPITAL * CAPITAL_PER_TRADE:,.0f} KWD")
    print(f"Max Concurrent: {MAX_CONCURRENT_TRADES}")
    print(f"Target: +{TARGET_PCT}%, Stop: -{STOP_LOSS_PCT}%")
    print(f"Volume Filter: >= {VOLUME_RATIO_MIN}x (ENFORCED)")
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
    
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC', 'BTC', 'ETH',
              'USDT', 'USDC']
    
    all_tickers = [row[0] for row in cursor.fetchall()]
    kuwait_tickers = [t for t in all_tickers if t not in CRYPTO and len(t) >= 3 and len(t) <= 5 and t.isupper()]
    
    print(f"\n📊 Found {len(kuwait_tickers)} tickers")
    
    # State tracking
    capital = INITIAL_CAPITAL
    open_positions = []  # List of OpenPosition
    all_trades = []
    max_concurrent = 0
    
    total_signals = 0
    signals_taken = 0
    signals_rejected_volume = 0
    
    current = datetime.strptime(START_DATE, '%Y-%m-%d')
    end = datetime.strptime(END_DATE, '%Y-%m-%d')
    day_counter = 0
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        day_counter += 1
        
        # Check exit for open positions (swing trades)
        still_open = []
        for pos in open_positions:
            cursor.execute('''
                SELECT date, open_price, high_price, low_price, close_price 
                FROM price_history 
                WHERE ticker = ? AND date = ?
            ''', (pos.ticker, date_str))
            
            row = cursor.fetchone()
            if row:
                high = row[2]
                low = row[3]
                close = row[4]
                
                if high >= pos.target:
                    # Hit target - WIN
                    pnl_pct = ((pos.target - pos.entry_price) / pos.entry_price) * 100
                    trade = Trade(
                        ticker=pos.ticker,
                        entry_date=pos.entry_date,
                        entry_price=pos.entry_price,
                        exit_date=date_str,
                        exit_price=pos.target,
                        target=pos.target,
                        stop_loss=pos.stop_loss,
                        result='win',
                        pnl_pct=round(pnl_pct, 2),
                        pnl_amount=round(INITIAL_CAPITAL * CAPITAL_PER_TRADE * pnl_pct / 100, 2),
                        holding_days=day_counter - pos.entry_day,
                        volume_ratio=0
                    )
                    all_trades.append(trade)
                    capital += trade.pnl_amount
                    continue
                
                if low <= pos.stop_loss:
                    # Hit stop - LOSS
                    pnl_pct = ((pos.stop_loss - pos.entry_price) / pos.entry_price) * 100
                    trade = Trade(
                        ticker=pos.ticker,
                        entry_date=pos.entry_date,
                        entry_price=pos.entry_price,
                        exit_date=date_str,
                        exit_price=pos.stop_loss,
                        target=pos.target,
                        stop_loss=pos.stop_loss,
                        result='loss',
                        pnl_pct=round(pnl_pct, 2),
                        pnl_amount=round(INITIAL_CAPITAL * CAPITAL_PER_TRADE * pnl_pct / 100, 2),
                        holding_days=day_counter - pos.entry_day,
                        volume_ratio=0
                    )
                    all_trades.append(trade)
                    capital += trade.pnl_amount
                    continue
                
                # Check max holding days
                if day_counter - pos.entry_day >= MAX_HOLDING_DAYS:
                    # Force exit at close
                    pnl_pct = ((close - pos.entry_price) / pos.entry_price) * 100
                    result = 'win' if close > pos.entry_price else 'loss'
                    trade = Trade(
                        ticker=pos.ticker,
                        entry_date=pos.entry_date,
                        entry_price=pos.entry_price,
                        exit_date=date_str,
                        exit_price=close,
                        target=pos.target,
                        stop_loss=pos.stop_loss,
                        result=result,
                        pnl_pct=round(pnl_pct, 2),
                        pnl_amount=round(INITIAL_CAPITAL * CAPITAL_PER_TRADE * pnl_pct / 100, 2),
                        holding_days=MAX_HOLDING_DAYS,
                        volume_ratio=0
                    )
                    all_trades.append(trade)
                    capital += trade.pnl_amount
                    continue
            
            still_open.append(pos)
        
        open_positions = still_open
        
        # Find new signals
        signals = find_signals(cursor, kuwait_tickers, date_str)
        total_signals += len(signals)
        
        # Take only available slots
        available_slots = MAX_CONCURRENT_TRADES - len(open_positions)
        signals_to_take = signals[:available_slots]
        signals_taken += len(signals_to_take)
        
        # Open new positions
        for signal in signals_to_take:
            cursor.execute('''
                SELECT open_price FROM price_history 
                WHERE ticker = ? AND date > ?
                ORDER BY date ASC LIMIT 1
            ''', (signal['ticker'], date_str))
            
            row = cursor.fetchone()
            if row and row[0] > 0:
                entry_price = row[0]
                target = entry_price * (1 + TARGET_PCT / 100)
                stop = entry_price * (1 - STOP_LOSS_PCT / 100)
                
                pos = OpenPosition(
                    ticker=signal['ticker'],
                    entry_date=date_str,
                    entry_price=entry_price,
                    target=target,
                    stop_loss=stop,
                    entry_day=day_counter
                )
                open_positions.append(pos)
        
        max_concurrent = max(max_concurrent, len(open_positions))
        
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
    
    print(f"\n💰 CAPITAL ANALYSIS:")
    print(f"   Initial Capital: {INITIAL_CAPITAL:,.0f} KWD")
    print(f"   Final Capital: {capital:,.0f} KWD")
    print(f"   P&L Amount: {total_pnl:+,.0f} KWD")
    print(f"   P&L Percentage: {total_pnl_pct:+.2f}%")
    
    print(f"\n📊 TRADE ANALYSIS:")
    print(f"   Total Trades: {total_trades}")
    print(f"   Wins: {win_count}, Losses: {len(losses)}")
    print(f"   Win Rate: {win_rate:.1f}%")
    print(f"   Max Concurrent: {max_concurrent}")
    
    if all_trades:
        best = max(all_trades, key=lambda x: x.pnl_amount)
        worst = min(all_trades, key=lambda x: x.pnl_amount)
        print(f"\n🏆 BEST: {best.ticker} @ {best.entry_date}: {best.pnl_pct:+.2f}% = {best.pnl_amount:+,.0f} KWD")
        print(f"💀 WORST: {worst.ticker} @ {worst.entry_date}: {worst.pnl_pct:+.2f}% = {worst.pnl_amount:+,.0f} KWD")
    
    # ==================== DECISION ====================
    
    print("\n" + "="*70)
    if total_trades < 10:
        print(f"⚠️ LOW SIGNALS - Only {total_trades} trades")
        status = 'LOW_LIQUIDITY'
        decision = 'STOP'
    elif win_rate >= 50 and total_pnl_pct >= 5:
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
    
    output_path = OUTPUT_DIR / 'backtest_kse_corrected.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(asdict(result), f, indent=2, ensure_ascii=False)
    
    print(f"📁 Results saved to: {output_path}")
    return asdict(result)


if __name__ == '__main__':
    result = run_kse_backtest_corrected()
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
