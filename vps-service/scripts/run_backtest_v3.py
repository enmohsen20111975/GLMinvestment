#!/usr/bin/env python3
"""
Run Walk-Forward Backtest - v3 More Conservative
تشغيل الـ Walk-Forward Backtest - نسخة محافظة أكتر

Key Changes from v2:
1. Even wider Stop Loss (10%)
2. Lower Target (8%) - Better R:R
3. Higher min score (65)
4. Add volume filter
5. Skip trades in bear regime
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
import sqlite3

from pathlib import Path
_project_root = Path(__file__).parent.parent.parent.resolve()  # GLMinvestment directory
DATABASE_PATH = str(_project_root / 'db' / 'stocks.db')

# ==================== ADJUSTED PARAMETERS v3 ====================

STOP_LOSS_PCT = 10.0  # Wider
TARGET_PCT = 8.0      # More realistic for EGX
MIN_SCORE = 65        # Higher threshold
MAX_HOLDING_DAYS = 20 # More time
MIN_VOLUME_RATIO = 1.0  # At least average volume

# ==================== TYPES ====================

@dataclass
class Trade:
    window: int
    ticker: str
    signal_date: str
    entry_price: float
    stop_loss: float
    target: float
    maestro_score: float
    recommendation: str
    regime: str
    exit_date: str = ''
    exit_price: float = 0.0
    result: str = 'pending'
    pnl_pct: float = 0.0
    holding_days: int = 0


# ==================== HELPER FUNCTIONS ====================

def get_db():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DATABASE_PATH, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_stock_history_range(conn, ticker: str, start_date: str, end_date: str) -> List[Dict]:
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
    cursor = conn.cursor()
    cursor.execute('''
        SELECT DISTINCT s.ticker
        FROM stocks s
        INNER JOIN stock_price_history h ON s.id = h.stock_id
        WHERE s.is_active = 1 OR s.is_active IS NULL
    ''')
    return [row['ticker'] for row in cursor.fetchall()]


def simulate_trade(
    entry_price: float,
    stop_loss: float,
    target: float,
    future_data: List[Dict],
    is_buy: bool = True,
    max_days: int = MAX_HOLDING_DAYS
) -> Tuple[float, str, int]:
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
    
    last_close = future_data[-1].get('close_price', entry_price) if len(future_data) > 0 else entry_price
    return last_close, 'timeout', min(max_days, len(future_data))


def calculate_maestro_score_v3(closes: List[float], volumes: List[float]) -> Tuple[float, str, Dict]:
    """
    Maestro Score v3 - More Conservative
    
    Key changes:
    - More weight on trend confirmation
    - Require volume confirmation
    - Avoid overbought conditions
    """
    if len(closes) < 30:
        return 50.0, 'hold', {'reason': 'insufficient_data'}
    
    current_price = closes[-1]
    sma20 = sum(closes[-20:]) / 20
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else sma20
    sma10 = sum(closes[-10:]) / 10
    
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
    rs = avg_gain / avg_loss if avg_loss > 0 else 1
    rsi = 100 - (100 / (1 + rs))
    
    # Momentum
    if len(closes) >= 5:
        momentum_5d = ((closes[-1] - closes[-5]) / closes[-5]) * 100
    else:
        momentum_5d = 0
    
    # Volume
    vol_ratio = 1.0
    if volumes and len(volumes) > 5:
        avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
        current_vol = volumes[-1]
        vol_ratio = current_vol / avg_vol if avg_vol > 0 else 1.0
    
    # Score calculation - More Conservative
    score = 50.0
    factors = {}
    
    # Factor 1: Trend - CRITICAL (must be bullish)
    if current_price > sma20 > sma50:
        trend_score = 30  # Strong bullish
        factors['trend'] = 'strong_bullish'
    elif current_price > sma20 and current_price > sma50:
        trend_score = 20
        factors['trend'] = 'bullish'
    elif current_price > sma10:
        trend_score = 10
        factors['trend'] = 'weak_bullish'
    elif current_price < sma20 < sma50:
        trend_score = -30  # Strong bearish - SKIP
        factors['trend'] = 'strong_bearish'
    elif current_price < sma20:
        trend_score = -20
        factors['trend'] = 'bearish'
    else:
        trend_score = 0
        factors['trend'] = 'neutral'
    score += trend_score
    
    # Factor 2: RSI - Prefer neutral to slightly oversold
    if rsi < 30:
        rsi_score = 20
        factors['rsi'] = 'oversold'
    elif rsi < 45:
        rsi_score = 15
        factors['rsi'] = 'low'
    elif rsi > 75:
        rsi_score = -25  # Very overbought - SKIP
        factors['rsi'] = 'extreme_overbought'
    elif rsi > 65:
        rsi_score = -15
        factors['rsi'] = 'overbought'
    elif rsi > 55:
        rsi_score = -5
        factors['rsi'] = 'high'
    else:
        rsi_score = 5
        factors['rsi'] = 'neutral'
    score += rsi_score
    
    # Factor 3: Momentum - Prefer slight pullback
    if momentum_5d > 8:
        mom_score = -15  # Too hot
        factors['momentum'] = 'too_hot'
    elif momentum_5d > 4:
        mom_score = -5
        factors['momentum'] = 'hot'
    elif momentum_5d > 0:
        mom_score = 10
        factors['momentum'] = 'positive'
    elif momentum_5d > -3:
        mom_score = 5
        factors['momentum'] = 'slight_pullback'
    elif momentum_5d > -6:
        mom_score = 5
        factors['momentum'] = 'pullback'
    else:
        mom_score = -10
        factors['momentum'] = 'falling'
    score += mom_score
    
    # Factor 4: Volume - MUST confirm
    if vol_ratio > 1.5:
        vol_score = 10
        factors['volume'] = 'high'
    elif vol_ratio > 1.0:
        vol_score = 5
        factors['volume'] = 'above_avg'
    elif vol_ratio < 0.7:
        vol_score = -10
        factors['volume'] = 'low'
    else:
        vol_score = 0
        factors['volume'] = 'normal'
    score += vol_score
    
    # Normalize
    score = max(0, min(100, score))
    
    # Recommendation
    if score >= 75:
        rec = 'strong_buy'
    elif score >= 65:
        rec = 'buy'
    elif score >= 45:
        rec = 'hold'
    elif score >= 30:
        rec = 'sell'
    else:
        rec = 'strong_sell'
    
    factors['vol_ratio'] = round(vol_ratio, 2)
    factors['rsi_value'] = round(rsi, 1)
    
    return score, rec, factors


def get_regime(closes: List[float]) -> str:
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
    print("\n" + "="*60)
    print("WALK-FORWARD BACKTEST - MAESTRO v3 (CONSERVATIVE)")
    print("="*60)
    print(f"Stop Loss: {STOP_LOSS_PCT}%")
    print(f"Target: {TARGET_PCT}%")
    print(f"Risk/Reward: {TARGET_PCT/STOP_LOSS_PCT:.2f}")
    print(f"Min Score: {MIN_SCORE}")
    print(f"Min Volume Ratio: {MIN_VOLUME_RATIO}x")
    print("="*60)
    
    conn = get_db()
    
    cursor = conn.cursor()
    cursor.execute('SELECT MIN(date), MAX(date) FROM stock_price_history')
    row = cursor.fetchone()
    print(f"\nData Range: {row[0]} to {row[1]}")
    
    tickers = get_all_tickers(conn)
    print(f"Total Stocks: {len(tickers)}")
    
    windows = [
        {'num': 1, 'train_start': '2024-12-01', 'train_end': '2025-02-28',
         'test_start': '2025-03-01', 'test_end': '2025-03-31'},
        {'num': 2, 'train_start': '2025-01-01', 'train_end': '2025-03-31',
         'test_start': '2025-04-01', 'test_end': '2025-04-30'}
    ]
    
    all_trades = []
    rejected = {'score': 0, 'regime': 0, 'volume': 0, 'rsi': 0, 'momentum': 0}
    
    for window in windows:
        print(f"\n{'='*60}")
        print(f"Window {window['num']}")
        print(f"  Train: {window['train_start']} to {window['train_end']}")
        print(f"  Test: {window['test_start']} to {window['test_end']}")
        print("="*60)
        
        signals = 0
        window_trades = []
        
        for ticker in tickers:
            try:
                train_data = get_stock_history_range(conn, ticker, window['train_start'], window['train_end'])
                if len(train_data) < 30:
                    continue
                
                test_data = get_stock_history_range(conn, ticker, window['test_start'], window['test_end'])
                if not test_data:
                    continue
                
                closes = [d['close_price'] for d in train_data if d.get('close_price', 0) > 0]
                volumes = [d.get('volume', 0) for d in train_data]
                
                if not closes:
                    continue
                
                score, rec, factors = calculate_maestro_score_v3(closes, volumes)
                
                # Filters
                if score < MIN_SCORE:
                    rejected['score'] += 1
                    continue
                
                if rec not in ['buy', 'strong_buy']:
                    rejected['score'] += 1
                    continue
                
                # Skip bear regime
                regime = get_regime(closes)
                if regime == 'bear':
                    rejected['regime'] += 1
                    continue
                
                # Volume filter
                if factors.get('vol_ratio', 1.0) < MIN_VOLUME_RATIO:
                    rejected['volume'] += 1
                    continue
                
                # Skip overbought
                if factors.get('rsi') in ['overbought', 'extreme_overbought']:
                    rejected['rsi'] += 1
                    continue
                
                # Skip too hot momentum
                if factors.get('momentum') in ['too_hot', 'hot']:
                    rejected['momentum'] += 1
                    continue
                
                signals += 1
                
                entry_price = test_data[0].get('open_price', test_data[0].get('close_price', 0))
                if entry_price <= 0:
                    entry_price = closes[-1]
                
                stop_loss = entry_price * (1 - STOP_LOSS_PCT / 100)
                target = entry_price * (1 + TARGET_PCT / 100)
                
                future_data = test_data[1:]
                exit_price, result, holding = simulate_trade(entry_price, stop_loss, target, future_data)
                
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100
                
                trade = Trade(
                    window=window['num'],
                    ticker=ticker,
                    signal_date=window['train_end'],
                    entry_price=round(entry_price, 3),
                    stop_loss=round(stop_loss, 3),
                    target=round(target, 3),
                    maestro_score=score,
                    recommendation=rec,
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
        timeouts = [t for t in window_trades if t.result == 'timeout']
        
        total = len(window_trades)
        win_count = len(wins)
        
        win_rate = (win_count / total * 100) if total > 0 else 0
        
        total_profit = sum(t.pnl_pct for t in wins)
        total_loss = abs(sum(t.pnl_pct for t in window_trades if t.pnl_pct < 0))
        profit_factor = total_profit / total_loss if total_loss > 0 else 0
        
        print(f"\n  Signals Found: {signals}")
        print(f"  Rejected: Score={rejected['score']}, Regime={rejected['regime']}, Vol={rejected['volume']}, RSI={rejected['rsi']}, Mom={rejected['momentum']}")
        print(f"  Trades: {total} (Wins: {win_count}, Losses: {len(losses)}, Timeouts: {len(timeouts)})")
        print(f"  Win Rate: {win_rate:.1f}%")
        print(f"  Profit Factor: {profit_factor:.2f}")
        print(f"  Total P&L: {sum(t.pnl_pct for t in window_trades):.1f}%")
        
        if window_trades:
            print(f"\n  Top 5 Trades:")
            sorted_trades = sorted(window_trades, key=lambda x: x.pnl_pct, reverse=True)[:5]
            for t in sorted_trades:
                print(f"    {t.ticker}: Score={t.maestro_score:.0f}, PnL={t.pnl_pct:+.1f}%, Result={t.result}")
    
    conn.close()
    
    # Final aggregate
    print(f"\n{'='*60}")
    print("FINAL RESULTS")
    print("="*60)
    
    all_wins = [t for t in all_trades if t.result == 'win']
    all_losses = [t for t in all_trades if t.result == 'loss']
    all_timeouts = [t for t in all_trades if t.result == 'timeout']
    
    total_trades = len(all_trades)
    total_wins = len(all_wins)
    
    win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
    
    total_profit = sum(t.pnl_pct for t in all_wins)
    total_loss = abs(sum(t.pnl_pct for t in all_trades if t.pnl_pct < 0))
    profit_factor = total_profit / total_loss if total_loss > 0 else 0
    
    # Max drawdown
    cumulative_pnl = 0
    max_cumulative = 0
    max_drawdown = 0
    
    for trade in all_trades:
        cumulative_pnl += trade.pnl_pct
        if cumulative_pnl > max_cumulative:
            max_cumulative = cumulative_pnl
        drawdown = max_cumulative - cumulative_pnl
        if drawdown > max_drawdown:
            max_drawdown = drawdown
    
    print(f"\nTotal Trades: {total_trades}")
    print(f"Wins: {total_wins}, Losses: {len(all_losses)}, Timeouts: {len(all_timeouts)}")
    print(f"Win Rate: {win_rate:.1f}%")
    print(f"Profit Factor: {profit_factor:.2f}")
    print(f"Total P&L: {sum(t.pnl_pct for t in all_trades):.1f}%")
    print(f"Max Drawdown: {max_drawdown:.1f}%")
    
    # By regime
    by_regime = {}
    for t in all_trades:
        if t.regime not in by_regime:
            by_regime[t.regime] = {'trades': 0, 'wins': 0, 'pnl': 0}
        by_regime[t.regime]['trades'] += 1
        if t.result == 'win':
            by_regime[t.regime]['wins'] += 1
        by_regime[t.regime]['pnl'] += t.pnl_pct
    
    print(f"\nBy Regime:")
    for regime, stats in by_regime.items():
        wr = (stats['wins'] / stats['trades'] * 100) if stats['trades'] > 0 else 0
        print(f"  {regime}: {stats['trades']} trades, {wr:.1f}% win rate, {stats['pnl']:+.1f}% PnL")
    
    # Decision
    print(f"\n{'='*60}")
    if win_rate >= 60 and profit_factor >= 1.5:
        print("DECISION: ✅ ننشر فوراً - النتائج ممتازة!")
        status = 'PUBLISH_NOW'
    elif win_rate >= 55 and profit_factor >= 1.2:
        print("DECISION: ⚠️ ننشر بحذر - نتائج جيدة")
        status = 'PUBLISH_CAUTIOUS'
    elif win_rate >= 50 and profit_factor >= 1.0:
        print("DECISION: ❌ نعدل المعاملات - النتائج مقبولة")
        status = 'ADJUST'
    else:
        print("DECISION: ❌❌ نراجع النظام كله - النتائج ضعيفة")
        status = 'OVERHAUL'
    print("="*60 + "\n")
    
    return {
        'total_trades': total_trades,
        'wins': total_wins,
        'losses': len(all_losses),
        'win_rate': round(win_rate, 2),
        'profit_factor': round(profit_factor, 2),
        'max_drawdown': round(max_drawdown, 2),
        'status': status
    }


if __name__ == '__main__':
    result = run_backtest()
    print(f"\nResult: {result}")
