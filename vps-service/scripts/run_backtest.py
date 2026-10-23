#!/usr/bin/env python3
"""
Run Walk-Forward Backtest - Standalone Script
تشغيل الـ Walk-Forward Backtest - سكربت مستقل

Usage: python scripts/run_backtest.py
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import without Flask
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
import sqlite3

# Database path - ALWAYS in project root: /db/stocks.db
from pathlib import Path
_project_root = Path(__file__).parent.parent.parent.resolve()  # GLMinvestment directory
DATABASE_PATH = str(_project_root / 'db' / 'stocks.db')

print(f"Database: {DATABASE_PATH}")
print(f"Database exists: {Path(DATABASE_PATH).exists()}")


# ==================== TYPES ====================

@dataclass
class Trade:
    """صفقة واحدة"""
    window: int
    ticker: str
    signal_date: str
    entry_price: float
    stop_loss: float
    target: float
    maestro_score: float
    recommendation: str
    persona: str
    regime: str
    exit_date: str = ''
    exit_price: float = 0.0
    result: str = 'pending'
    pnl_pct: float = 0.0
    holding_days: int = 0


@dataclass
class WindowResult:
    """نتائج نافذة واحدة"""
    window: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    total_signals: int
    trades: List[Trade] = field(default_factory=list)
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    profit_factor: float = 0.0


# ==================== HELPER FUNCTIONS ====================

def get_db():
    """Get database connection"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DATABASE_PATH, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def get_stock_history_range(conn, ticker: str, start_date: str, end_date: str) -> List[Dict]:
    """الحصول على تاريخ السهم في فترة معينة"""
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM stocks WHERE ticker = ?', (ticker,))
    row = cursor.fetchone()
    if not row:
        return []
    
    stock_id = row['id']
    
    cursor.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM stock_price_history
        WHERE stock_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
    ''', (stock_id, start_date, end_date))
    
    return [dict(row) for row in cursor.fetchall()]


def get_all_tickers(conn) -> List[str]:
    """الحصول على كل الأسهم اللي ليها بيانات"""
    cursor = conn.cursor()
    cursor.execute('''
        SELECT DISTINCT s.ticker
        FROM stocks s
        INNER JOIN stock_price_history h ON s.id = h.stock_id
        WHERE s.is_active = 1 OR s.is_active IS NULL
    ''')
    return [row['ticker'] for row in cursor.fetchall()]


def get_stock_info(conn, ticker: str) -> Optional[Dict]:
    """الحصول على معلومات السهم"""
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM stocks WHERE ticker = ?', (ticker,))
    row = cursor.fetchone()
    return dict(row) if row else None


def simulate_trade(
    entry_price: float,
    stop_loss: float,
    target: float,
    future_data: List[Dict],
    is_buy: bool = True,
    max_days: int = 10
) -> Tuple[float, str, int]:
    """محاكاة الصفقة"""
    if not future_data:
        return entry_price, 'timeout', 0
    
    for i, day in enumerate(future_data[:max_days]):
        high = day.get('high_price', day.get('close_price', 0))
        low = day.get('low_price', day.get('close_price', 0))
        
        if is_buy:
            if target > 0 and high >= target:
                return target, 'win', i + 1
            if stop_loss > 0 and low <= stop_loss:
                return stop_loss, 'loss', i + 1
    
    last_close = future_data[-1].get('close_price', entry_price) if future_data else entry_price
    return last_close, 'timeout', min(max_days, len(future_data))


def calculate_maestro_score_simple(closes: List[float], volumes: List[float]) -> Tuple[float, str]:
    """حساب Maestro Score مبسط (بدون MaestroOrchestrator)"""
    if len(closes) < 30:
        return 50.0, 'hold'
    
    current_price = closes[-1]
    sma20 = sum(closes[-20:]) / 20
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else sma20
    
    # RSI
    gains = []
    losses = []
    for i in range(1, min(15, len(closes))):
        change = closes[-i] - closes[-i-1]
        if change > 0:
            gains.append(change)
        else:
            losses.append(abs(change))
    
    avg_gain = sum(gains) / len(gains) if gains else 0.1
    avg_loss = sum(losses) / len(losses) if losses else 0.1
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    
    # Score calculation
    score = 50.0
    
    # Trend
    if current_price > sma20 > sma50:
        score += 20
    elif current_price > sma20:
        score += 10
    elif current_price < sma20 < sma50:
        score -= 20
    elif current_price < sma20:
        score -= 10
    
    # RSI
    if rsi < 30:
        score += 15
    elif rsi < 40:
        score += 10
    elif rsi > 70:
        score -= 15
    elif rsi > 60:
        score -= 5
    
    # Volume
    if volumes and len(volumes) > 5:
        avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
        current_vol = volumes[-1]
        if current_vol > avg_vol * 1.5:
            score += 10
        elif current_vol > avg_vol * 1.2:
            score += 5
    
    # Normalize
    score = max(0, min(100, score))
    
    # Recommendation
    if score >= 70:
        rec = 'strong_buy'
    elif score >= 55:
        rec = 'buy'
    elif score >= 40:
        rec = 'hold'
    elif score >= 25:
        rec = 'sell'
    else:
        rec = 'strong_sell'
    
    return score, rec


def get_regime(closes: List[float]) -> str:
    """تحديد حالة السوق"""
    if len(closes) < 50:
        return 'range'
    
    sma20 = sum(closes[-20:]) / 20
    sma50 = sum(closes[-50:]) / 50
    current = closes[-1]
    
    if sma20 > sma50 and current > sma20:
        return 'bull'
    elif sma20 < sma50 and current < sma20:
        return 'bear'
    return 'range'


# ==================== MAIN BACKTEST ====================

def run_backtest():
    """تشغيل الـ Backtest"""
    print("\n" + "="*60)
    print("WALK-FORWARD BACKTEST - MAESTRO SYSTEM")
    print("="*60)
    
    conn = get_db()
    
    # Get data range
    cursor = conn.cursor()
    cursor.execute('SELECT MIN(date), MAX(date) FROM stock_price_history')
    row = cursor.fetchone()
    print(f"Data Range: {row[0]} to {row[1]}")
    
    tickers = get_all_tickers(conn)
    print(f"Total Stocks: {len(tickers)}")
    
    # Define windows
    windows = [
        {
            'num': 1,
            'train_start': '2024-12-01',
            'train_end': '2025-02-28',
            'test_start': '2025-03-01',
            'test_end': '2025-03-31'
        },
        {
            'num': 2,
            'train_start': '2025-01-01',
            'train_end': '2025-03-31',
            'test_start': '2025-04-01',
            'test_end': '2025-04-30'
        }
    ]
    
    all_trades = []
    
    for window in windows:
        print(f"\n{'='*60}")
        print(f"Window {window['num']}")
        print(f"  Train: {window['train_start']} to {window['train_end']}")
        print(f"  Test: {window['test_start']} to {window['test_end']}")
        print("="*60)
        
        signals = 0
        window_trades = []
        
        for ticker in tickers[:50]:  # Limit for speed
            try:
                # Get training data
                train_data = get_stock_history_range(conn, ticker, window['train_start'], window['train_end'])
                if len(train_data) < 30:
                    continue
                
                # Get test data
                test_data = get_stock_history_range(conn, ticker, window['test_start'], window['test_end'])
                if not test_data:
                    continue
                
                # Calculate scores
                closes = [d['close_price'] for d in train_data if d.get('close_price', 0) > 0]
                volumes = [d.get('volume', 0) for d in train_data]
                
                if not closes:
                    continue
                
                score, rec = calculate_maestro_score_simple(closes, volumes)
                
                # Filter
                if score < 55 or rec not in ['buy', 'strong_buy']:
                    continue
                
                signals += 1
                
                # Entry
                entry_price = test_data[0].get('open_price', test_data[0].get('close_price', 0))
                if entry_price <= 0:
                    entry_price = closes[-1]
                
                # Stop and Target
                atr_pct = 3.0  # Simplified
                stop_loss = entry_price * (1 - atr_pct / 100 * 1.5)
                target = entry_price * 1.15  # 15% target
                
                # Simulate
                future_data = test_data[1:]
                exit_price, result, holding = simulate_trade(entry_price, stop_loss, target, future_data)
                
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                regime = get_regime(closes)
                
                trade = Trade(
                    window=window['num'],
                    ticker=ticker,
                    signal_date=window['train_end'],
                    entry_price=round(entry_price, 3),
                    stop_loss=round(stop_loss, 3),
                    target=round(target, 3),
                    maestro_score=score,
                    recommendation=rec,
                    persona='balanced',
                    regime=regime,
                    exit_date=test_data[-1].get('date', window['test_end']),
                    exit_price=round(exit_price, 3),
                    result=result,
                    pnl_pct=round(pnl_pct, 2),
                    holding_days=holding
                )
                
                window_trades.append(trade)
                all_trades.append(trade)
                
            except Exception as e:
                continue
        
        # Window stats
        wins = [t for t in window_trades if t.result == 'win']
        losses = [t for t in window_trades if t.result == 'loss']
        
        total = len(window_trades)
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / total * 100) if total > 0 else 0
        
        total_profit = sum(t.pnl_pct for t in wins)
        total_loss = abs(sum(t.pnl_pct for t in losses if t.pnl_pct < 0))
        profit_factor = total_profit / total_loss if total_loss > 0 else 0
        
        print(f"\n  Signals Found: {signals}")
        print(f"  Trades: {total}")
        print(f"  Wins: {win_count}, Losses: {loss_count}")
        print(f"  Win Rate: {win_rate:.1f}%")
        print(f"  Profit Factor: {profit_factor:.2f}")
        
        # Show top trades
        if window_trades:
            print(f"\n  Top 5 Trades:")
            sorted_trades = sorted(window_trades, key=lambda x: x.maestro_score, reverse=True)[:5]
            for t in sorted_trades:
                print(f"    {t.ticker}: Score={t.maestro_score:.0f}, PnL={t.pnl_pct:+.1f}%, Result={t.result}")
    
    conn.close()
    
    # Final aggregate
    print(f"\n{'='*60}")
    print("FINAL RESULTS")
    print("="*60)
    
    all_wins = [t for t in all_trades if t.result == 'win']
    all_losses = [t for t in all_trades if t.result == 'loss']
    
    total_trades = len(all_trades)
    total_wins = len(all_wins)
    total_losses = len(all_losses)
    
    win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
    
    total_profit = sum(t.pnl_pct for t in all_wins)
    total_loss = abs(sum(t.pnl_pct for t in all_losses if t.pnl_pct < 0))
    profit_factor = total_profit / total_loss if total_loss > 0 else 0
    
    print(f"\nTotal Trades: {total_trades}")
    print(f"Total Wins: {total_wins}")
    print(f"Total Losses: {total_losses}")
    print(f"Win Rate: {win_rate:.1f}%")
    print(f"Profit Factor: {profit_factor:.2f}")
    print(f"Total P&L: {total_profit - total_loss:.1f}%")
    
    # Decision
    print(f"\n{'='*60}")
    if win_rate >= 60 and profit_factor >= 1.5:
        print("DECISION: ✅ ننشر فوراً - النتائج ممتازة!")
    elif win_rate >= 55 and profit_factor >= 1.2:
        print("DECISION: ⚠️ ننشر بحذر - نتائج جيدة")
    elif win_rate >= 50 and profit_factor >= 1.0:
        print("DECISION: ❌ نعدل المعاملات - النتائج مقبولة")
    else:
        print("DECISION: ❌❌ نراجع النظام كله - النتائج ضعيفة")
    print("="*60 + "\n")
    
    return {
        'total_trades': total_trades,
        'wins': total_wins,
        'losses': total_losses,
        'win_rate': round(win_rate, 2),
        'profit_factor': round(profit_factor, 2)
    }


if __name__ == '__main__':
    result = run_backtest()
    print(f"\nResult: {result}")
