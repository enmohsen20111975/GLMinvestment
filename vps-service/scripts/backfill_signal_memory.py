#!/usr/bin/env python3
"""
Back-Populate Signal Memory from Historical Data - SIMPLIFIED VERSION
ملء ذاكرة الإشارات من التاريخ - نسخة مبسطة

This script goes back in time and:
1. Runs simplified analysis for each day
2. Records signals with relaxed criteria
3. Calculates outcomes after 10 days
4. Records outcomes

@authorM2yDevelopers Team
"""

import sys
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import sqlite3
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import DatabaseManager
from pathlib import Path  # added by patch_db_paths.py


class SimplifiedSignalBackfiller:
    """ملء ذاكرة الإشارات من التاريخ - نسخة مبسطة"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.db = DatabaseManager(db_path)
    
    def get_all_dates(self) -> List[str]:
        """Get all trading dates from database"""
        query = '''
            SELECT DISTINCT date 
            FROM stock_price_history 
            ORDER BY date ASC
        '''
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(query)
            return [row[0] for row in cursor.fetchall()]
    
    def get_stocks_with_history(self, date: str) -> List[Dict]:
        """Get all stocks with price history up to a specific date"""
        query = '''
            SELECT DISTINCT s.id, s.ticker, s.name, s.name_ar, s.sector
            FROM stocks s
            INNER JOIN stock_price_history sph ON sph.stock_id = s.id
            WHERE sph.date <= ?
            GROUP BY s.ticker
            HAVING COUNT(sph.id) >= 50
        '''
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(query, (date,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_price_history_up_to(self, stock_id: int, date: str, days: int = 365) -> List[Dict]:
        """Get price history for a stock up to a specific date.

        PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        The unified reader takes a ticker (not stock_id), so we do a tiny
        metadata lookup on the stocks table (NOT a price table) to map
        stock_id → ticker, then call `load_price_history_until` which is the
        point-in-time variant (no look-ahead).
        """
        # 1) Resolve stock_id → ticker via stocks metadata (not a price table).
        ticker: Optional[str] = None
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT ticker FROM stocks WHERE id = ?", (stock_id,)
                ).fetchone()
                if row:
                    ticker = row['ticker']
        except Exception as e:
            print(f"[backfill] ⚠️ ticker lookup failed for stock_id={stock_id}: {e}")
            return []

        if not ticker:
            return []

        # 2) Delegate to the unified point-in-time reader.
        from data.prices import load_price_history_until
        return load_price_history_until(ticker, date, limit=days)
    
    def get_price_after_days(self, stock_id: int, start_date: str, days: int) -> Optional[Dict]:
        """Get price after N trading days"""
        query = '''
            SELECT date, close_price as close, high_price as high, low_price as low
            FROM stock_price_history
            WHERE stock_id = ? AND date > ?
            ORDER BY date ASC
            LIMIT ?
        '''
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(query, (stock_id, start_date, days + 5))
            results = cursor.fetchall()
            if len(results) >= days:
                return dict(results[days - 1])
            return None
    
    def calculate_technicals(self, price_history: List[Dict]) -> Dict:
        """Calculate technical indicators"""
        closes = [p['close'] for p in price_history if p.get('close')]
        
        if len(closes) < 20:
            return {'sma20': 0, 'sma50': 0, 'rsi': 50, 'regime': 'range'}
        
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
        
        avg_gain = sum(gains) / 14 if gains else 0
        avg_loss = sum(losses) / 14 if losses else 0.001
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        
        # Regime
        if sma20 > sma50 and current_price > sma20:
            regime = 'bull'
        elif sma20 < sma50 and current_price < sma20:
            regime = 'bear'
        else:
            regime = 'range'
        
        return {
            'sma20': sma20,
            'sma50': sma50,
            'rsi': rsi,
            'regime': regime,
            'current_price': current_price
        }
    
    def calculate_score(self, technicals: Dict, volume_ratio: float) -> float:
        """Calculate simplified score (0-100)"""
        score = 50.0
        
        # RSI component
        rsi = technicals['rsi']
        if 30 <= rsi <= 40:  # Oversold but not extreme
            score += 15
        elif 40 <= rsi <= 50:
            score += 10
        elif 50 <= rsi <= 60:
            score += 5
        elif rsi > 70:
            score -= 10
        
        # Regime component
        regime = technicals['regime']
        if regime == 'bull':
            score += 15
        elif regime == 'range':
            score += 5
        else:
            score -= 5
        
        # Price vs SMA
        current = technicals['current_price']
        sma20 = technicals['sma20']
        if current > sma20:
            score += 10
        elif current < sma20 * 0.95:  # 5% below SMA
            score += 5  # Potential bounce
        
        # Volume
        if volume_ratio > 1.5:
            score += 10
        elif volume_ratio > 1.0:
            score += 5
        elif volume_ratio < 0.5:
            score -= 5
        
        return max(0, min(100, score))
    
    def save_signal_log(self, signal_data: Dict) -> int:
        """Save signal to signal_logs table"""
        query = '''
            INSERT INTO signal_logs (
                ticker, stock_id, signal_date, direction, indicators_used, score,
                calculated_entry_price, calculated_stop_loss, calculated_target,
                has_news, news_summary, executed, execution_reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'backfill', datetime('now'))
        '''
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(query, (
                signal_data['ticker'],
                signal_data['stock_id'],
                signal_data['signal_date'],
                signal_data['signal_type'],
                signal_data.get('indicators_used', 'simplified'),
                signal_data['score'],
                signal_data['entry_price'],
                signal_data['stop_loss'],
                signal_data['target'],
                0,
                json.dumps({
                    'regime': signal_data['regime'],
                    'rsi': round(signal_data.get('rsi', 50), 1),
                    'volume_ratio': round(signal_data.get('volume_ratio', 1), 2),
                    'sector': signal_data.get('sector', 'Other')
                }),
            ))
            conn.commit()
            return cursor.lastrowid
    
    def save_outcome_log(self, outcome_data: Dict) -> int:
        """Save outcome to outcome_logs table"""
        query = '''
            INSERT INTO outcome_logs (
                trade_id, close_date, actual_exit_price, close_reason,
                gross_profit_loss, net_profit_loss, profit_loss_percent, days_open, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        '''
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(query, (
                outcome_data['signal_log_id'],
                outcome_data['outcome_date'],
                outcome_data['exit_price'],
                outcome_data['outcome'],
                outcome_data['pnl_percent'],
                outcome_data['pnl_percent'],
                outcome_data['pnl_percent'],
                outcome_data['holding_days'],
            ))
            conn.commit()
            return cursor.lastrowid
    
    def run_backfill(self, start_date: str = None, end_date: str = None, max_days: int = None):
        """Run the backfill process"""
        print("=" * 60)
        print("Simplified Signal Memory Backfill")
        print("ملء ذاكرة الإشارات من التاريخ - نسخة مبسطة")
        print("=" * 60)
        
        # Get all trading dates
        all_dates = self.get_all_dates()
        print(f"\nTotal trading days in database: {len(all_dates)}")
        print(f"Date range: {all_dates[0]} to {all_dates[-1]}")
        
        # Filter dates if specified
        if start_date:
            all_dates = [d for d in all_dates if d >= start_date]
        if end_date:
            all_dates = [d for d in all_dates if d <= end_date]
        if max_days:
            all_dates = all_dates[-max_days:]
        
        print(f"Processing: {len(all_dates)} days")
        
        total_signals = 0
        total_outcomes = 0
        
        # Process each date (skip last 10 days - no outcome data)
        dates_to_process = all_dates[:-10] if len(all_dates) > 10 else all_dates
        
        for i, date in enumerate(dates_to_process):
            progress = (i + 1) / len(dates_to_process) * 100
            
            if i % 20 == 0:
                print(f"\nProgress: {progress:.1f}% | Date: {date} | Signals: {total_signals} | Outcomes: {total_outcomes}")
            
            # Get stocks with enough history
            stocks = self.get_stocks_with_history(date)
            
            if not stocks:
                continue
            
            # Analyze each stock
            for stock in stocks:
                stock_id = stock['id']
                ticker = stock['ticker']
                
                try:
                    # Get price history
                    price_history = self.get_price_history_up_to(stock_id, date, 365)
                    
                    if len(price_history) < 50:
                        continue
                    
                    # Calculate technicals
                    technicals = self.calculate_technicals(price_history)
                    
                    # Volume ratio
                    volumes = [p.get('volume', 0) for p in price_history[-20:] if p.get('volume', 0) > 0]
                    avg_volume = sum(volumes) / len(volumes) if volumes else 1
                    current_volume = price_history[-1].get('volume', avg_volume)
                    volume_ratio = (current_volume / avg_volume) if avg_volume > 0 else 1.0
                    
                    # Calculate score
                    score = self.calculate_score(technicals, volume_ratio)
                    
                    # Determine signal (relaxed criteria)
                    if score >= 65:
                        signal_type = 'strong_buy'
                    elif score >= 55:
                        signal_type = 'buy'
                    elif score >= 45:
                        signal_type = 'hold'
                    elif score >= 35:
                        signal_type = 'sell'
                    else:
                        signal_type = 'strong_sell'
                    
                    # Record BUY signals only
                    if signal_type in ['buy', 'strong_buy']:
                        current_price = technicals['current_price']
                        
                        # Calculate stop and target
                        regime = technicals['regime']
                        if regime == 'bull':
                            stop_pct, target_pct = 7, 15
                        elif regime == 'range':
                            stop_pct, target_pct = 5, 8
                        else:
                            stop_pct, target_pct = 8, 10
                        
                        entry_price = round(current_price * 0.995, 2)
                        stop_loss = round(entry_price * (1 - stop_pct / 100), 2)
                        target = round(entry_price * (1 + target_pct / 100), 2)
                        
                        signal_data = {
                            'ticker': ticker,
                            'stock_id': stock_id,
                            'signal_date': date,
                            'signal_type': signal_type,
                            'score': score,
                            'entry_price': entry_price,
                            'stop_loss': stop_loss,
                            'target': target,
                            'regime': regime,
                            'rsi': technicals['rsi'],
                            'volume_ratio': volume_ratio,
                            'sector': stock.get('sector', 'Other')
                        }
                        
                        signal_id = self.save_signal_log(signal_data)
                        total_signals += 1
                        
                        # Get outcome after 10 trading days
                        outcome_price = self.get_price_after_days(stock_id, date, 10)
                        
                        if outcome_price:
                            exit_price = outcome_price['close']
                            pnl_percent = ((exit_price - entry_price) / entry_price) * 100
                            
                            # Determine outcome
                            if pnl_percent >= 3:
                                outcome = 'WIN'
                            elif pnl_percent <= -5:
                                outcome = 'LOSS'
                            else:
                                outcome = 'BREAKEVEN' if abs(pnl_percent) < 2 else ('WIN' if pnl_percent > 0 else 'LOSS')
                            
                            outcome_record = {
                                'signal_log_id': signal_id,
                                'outcome_date': outcome_price['date'],
                                'exit_price': exit_price,
                                'outcome': outcome,
                                'pnl_percent': round(pnl_percent, 2),
                                'holding_days': 10
                            }
                            
                            self.save_outcome_log(outcome_record)
                            total_outcomes += 1
                
                except Exception as e:
                    pass  # Skip errors silently
        
        print("\n" + "=" * 60)
        print("BACKFILL COMPLETE!")
        print(f"Total signals recorded: {total_signals}")
        print(f"Total outcomes recorded: {total_outcomes}")
        print("=" * 60)
        
        return total_signals, total_outcomes


def main():
    """Main entry point"""
    db_path = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")
    
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return
    
    backfiller = SimplifiedSignalBackfiller(db_path)
    
    # Run backfill for all available history
    backfiller.run_backfill()


if __name__ == '__main__':
    main()
