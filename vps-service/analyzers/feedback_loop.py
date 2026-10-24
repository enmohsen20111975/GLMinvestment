#!/usr/bin/env python3
"""
Prediction Feedback Loop — حلقة التغذية الراجعة
=================================================
القطعة المفقودة: النظام بـ يولّد توقعات بس مش بـ يقيس أداءها.

ده الـ module بـ:
  1. ينشئ جدول prediction_outcomes (لو مش موجود)
  2. يقيس التوقعات القديمة (بعد 5/10 أيام)
  3. يحسب win_rate لكل نمط
  4. يـ feed النتائج لـ V40.2 عشان يتحسن

Usage:
  from analyzers.feedback_loop import FeedbackLoop
  
  fb = FeedbackLoop()
  fb.ensure_table()
  fb.evaluate_pending()  # قيّم التوقعات اللي عدى عليها 5+ أيام
  stats = fb.get_stats()  # إحصائيات الأداء

Author: Z.ai Code
Date: 2026-09-01
"""

import sqlite3
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'


class FeedbackLoop:
    """
    حلقة التغذية الراجعة — بـ يقيس أداء التوقعات ويـ learn منها.
    """

    def __init__(self, db_path: str = None):
        self.db_path = db_path or str(PREDICTIONS_DB)

    def _conn(self):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=False)
        conn.row_factory = sqlite3.Row
        return conn

    def ensure_table(self) -> bool:
        """أنشئ جدول prediction_outcomes لو مش موجود (بـ schema جديد)."""
        try:
            conn = self._conn()
            # Check if table exists with old schema
            cols = [col[1] for col in conn.execute('PRAGMA table_info(prediction_outcomes)').fetchall()]
            if cols and 'ticker' not in cols:
                # Old schema exists — rename it and create new
                print("[FeedbackLoop] Old prediction_outcomes found, renaming...", flush=True)
                conn.execute('ALTER TABLE prediction_outcomes RENAME TO prediction_outcomes_old')
                cols = []
            
            if not cols:
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS prediction_outcomes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        prediction_id INTEGER NOT NULL,
                        ticker TEXT NOT NULL,
                        prediction_date TEXT NOT NULL,
                        signal TEXT,
                        confidence REAL,
                        entry_price REAL,
                        price_1d_later REAL,
                        price_3d_later REAL,
                        price_5d_later REAL,
                        price_10d_later REAL,
                        return_1d REAL,
                        return_3d REAL,
                        return_5d REAL,
                        return_10d REAL,
                        outcome TEXT,
                        evaluated_at TEXT,
                        UNIQUE(prediction_id)
                    )
                ''')
                conn.execute('CREATE INDEX IF NOT EXISTS idx_po_ticker ON prediction_outcomes(ticker)')
                conn.execute('CREATE INDEX IF NOT EXISTS idx_po_date ON prediction_outcomes(prediction_date)')
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"[FeedbackLoop] ensure_table error: {e}", flush=True)
            return False

    def _get_price_on_date(self, ticker: str, target_date: str) -> Optional[float]:
        """جيب سعر الإغلاق لتاريخ معين (أو أقرب يوم تداول)."""
        if not DATA_ENGINE_DB.exists():
            return None
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(str(DATA_ENGINE_DB), writable=False)
            # Try exact date first, then closest within 3 days
            row = conn.execute('''
                SELECT close_price FROM egksco_price_history
                WHERE symbol = ? AND price_date <= ? AND close_price IS NOT NULL AND close_price > 0
                ORDER BY price_date DESC LIMIT 1
            ''', (ticker, target_date)).fetchone()
            conn.close()
            return float(row[0]) if row else None
        except Exception:
            return None

    def evaluate_pending(self, days_threshold: int = 5) -> Dict[str, Any]:
        """
        قيّم التوقعات اللي عدى عليها 5+ أيام وما اتقيّمتش لسه.
        
        Returns:
            {
                'evaluated': int,
                'wins': int,
                'losses': int,
                'neutral': int,
                'errors': int,
            }
        """
        self.ensure_table()
        stats = {'evaluated': 0, 'wins': 0, 'losses': 0, 'neutral': 0, 'errors': 0}
        
        try:
            conn = self._conn()
            # Get predictions that are old enough but not yet evaluated
            cutoff_date = (datetime.now() - timedelta(days=days_threshold)).strftime('%Y-%m-%d')
            
            predictions = conn.execute('''
                SELECT p.id, p.ticker, p.prediction_date, p.signal, p.entry_price,
                       p.confidence, p.status
                FROM predictions p
                LEFT JOIN prediction_outcomes po ON po.prediction_id = p.id
                WHERE po.id IS NULL
                  AND p.prediction_date <= ?
                  AND p.entry_price > 0
                ORDER BY p.prediction_date DESC
                LIMIT 100
            ''', (cutoff_date,)).fetchall()
            
            print(f"[FeedbackLoop] Found {len(predictions)} predictions to evaluate", flush=True)
            
            for pred in predictions:
                try:
                    pred_id = pred['id']
                    ticker = pred['ticker']
                    pred_date = pred['prediction_date']
                    entry = float(pred['entry_price'] or 0)
                    
                    if entry <= 0:
                        stats['errors'] += 1
                        continue
                    
                    # Calculate prices at 1d, 3d, 5d, 10d later
                    dt_pred = datetime.strptime(pred_date[:10], '%Y-%m-%d')
                    dates_to_check = {
                        '1d': (dt_pred + timedelta(days=1)).strftime('%Y-%m-%d'),
                        '3d': (dt_pred + timedelta(days=3)).strftime('%Y-%m-%d'),
                        '5d': (dt_pred + timedelta(days=5)).strftime('%Y-%m-%d'),
                        '10d': (dt_pred + timedelta(days=10)).strftime('%Y-%m-%d'),
                    }
                    
                    prices = {}
                    returns = {}
                    for key, dt in dates_to_check.items():
                        price = self._get_price_on_date(ticker, dt)
                        prices[f'price_{key}_later'] = price
                        if price and entry > 0:
                            returns[f'return_{key}'] = round(((price - entry) / entry) * 100, 2)
                        else:
                            returns[f'return_{key}'] = None
                    
                    # Determine outcome based on 5d return
                    ret_5d = returns.get('return_5d')
                    if ret_5d is None:
                        ret_5d = returns.get('return_3d') or returns.get('return_1d') or 0
                    
                    if ret_5d > 3.0:
                        outcome = 'WIN'
                        stats['wins'] += 1
                    elif ret_5d < -3.0:
                        outcome = 'LOSS'
                        stats['losses'] += 1
                    else:
                        outcome = 'NEUTRAL'
                        stats['neutral'] += 1
                    
                    # Insert outcome
                    conn.execute('''
                        INSERT OR REPLACE INTO prediction_outcomes
                        (prediction_id, ticker, prediction_date, signal, confidence,
                         entry_price, price_1d_later, price_3d_later, price_5d_later, price_10d_later,
                         return_1d, return_3d, return_5d, return_10d, outcome, evaluated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        pred_id, ticker, pred_date, pred['signal'], pred['confidence'],
                        entry, prices['price_1d_later'], prices['price_3d_later'],
                        prices['price_5d_later'], prices['price_10d_later'],
                        returns['return_1d'], returns['return_3d'],
                        returns['return_5d'], returns['return_10d'],
                        outcome, datetime.now().strftime('%Y-%m-%d %H:%M')
                    ))
                    stats['evaluated'] += 1
                    
                except Exception as e:
                    stats['errors'] += 1
                    continue
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            print(f"[FeedbackLoop] evaluate_pending error: {e}", flush=True)
        
        return stats

    def get_stats(self) -> Dict[str, Any]:
        """إحصائيات أداء التوقعات."""
        self.ensure_table()
        try:
            conn = self._conn()
            
            # Overall stats
            overall = conn.execute('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
                    SUM(CASE WHEN outcome = 'NEUTRAL' THEN 1 ELSE 0 END) as neutral,
                    AVG(return_5d) as avg_return_5d
                FROM prediction_outcomes
            ''').fetchone()
            
            # By signal type
            by_signal = conn.execute('''
                SELECT signal,
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                    AVG(return_5d) as avg_return
                FROM prediction_outcomes
                GROUP BY signal
            ''').fetchall()
            
            # Recent predictions (last 30 days)
            recent_cutoff = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            recent = conn.execute('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                    AVG(return_5d) as avg_return
                FROM prediction_outcomes
                WHERE prediction_date >= ?
            ''', (recent_cutoff,)).fetchone()
            
            conn.close()
            
            total = overall['total'] or 0
            wins = overall['wins'] or 0
            
            return {
                'overall': {
                    'total': total,
                    'wins': wins,
                    'losses': overall['losses'] or 0,
                    'neutral': overall['neutral'] or 0,
                    'win_rate': round(wins / total * 100, 1) if total > 0 else 0,
                    'avg_return_5d': round(overall['avg_return_5d'] or 0, 2),
                },
                'by_signal': [
                    {
                        'signal': r['signal'] or 'UNKNOWN',
                        'total': r['total'],
                        'wins': r['wins'] or 0,
                        'win_rate': round((r['wins'] or 0) / r['total'] * 100, 1) if r['total'] > 0 else 0,
                        'avg_return': round(r['avg_return'] or 0, 2),
                    }
                    for r in by_signal
                ],
                'recent_30d': {
                    'total': recent['total'] or 0,
                    'wins': recent['wins'] or 0,
                    'win_rate': round((recent['wins'] or 0) / (recent['total'] or 1) * 100, 1),
                    'avg_return': round(recent['avg_return'] or 0, 2),
                },
            }
        except Exception as e:
            return {'error': str(e)}

    def get_pattern_win_rate(self, signal: str) -> float:
        """
        احسب win_rate لنمط معين (BUY, STRONG_BUY, etc).
        ده اللي V40.2 بـ يستخدمه عشان يـ adjust confidence.
        """
        self.ensure_table()
        try:
            conn = self._conn()
            row = conn.execute('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins
                FROM prediction_outcomes
                WHERE signal = ?
            ''', (signal,)).fetchone()
            conn.close()
            
            if not row or row['total'] == 0:
                return 0.5  # neutral default
            
            return row['wins'] / row['total']
        except Exception:
            return 0.5


if __name__ == '__main__':
    print("🧪 Feedback Loop — Self Test")
    print("=" * 60)
    
    fb = FeedbackLoop()
    fb.ensure_table()
    
    # Evaluate pending predictions
    print("\n=== Evaluating pending predictions ===")
    stats = fb.evaluate_pending(days_threshold=5)
    print(f"Evaluated: {stats['evaluated']}")
    print(f"Wins: {stats['wins']} | Losses: {stats['losses']} | Neutral: {stats['neutral']}")
    
    # Get stats
    print("\n=== Performance Stats ===")
    perf = fb.get_stats()
    overall = perf.get('overall', {})
    print(f"Total evaluated: {overall.get('total', 0)}")
    print(f"Win Rate: {overall.get('win_rate', 0)}%")
    print(f"Avg Return 5d: {overall.get('avg_return_5d', 0)}%")
    
    print("\n=== By Signal ===")
    for s in perf.get('by_signal', []):
        print(f"  {s['signal']:<12}: {s['total']} trades | WR={s['win_rate']}% | avg={s['avg_return']}%")
    
    print("\n=== Recent 30 days ===")
    recent = perf.get('recent_30d', {})
    print(f"Total: {recent.get('total', 0)} | WR={recent.get('win_rate', 0)}% | avg={recent.get('avg_return', 0)}%")
    
    print("\n✅ Feedback Loop ready")
