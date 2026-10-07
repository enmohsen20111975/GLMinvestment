"""
Indicator Trust Scores — نظام الثقة الديناميكي للمؤشرات
=========================================================
كل أسبوع: شوف التوقعات اللى فاتت → لو صحت → زود الـ trust
لو غلط → قلل الـ trust

Table: indicator_trust_scores (in predictions.db)

Author: GLMinvestment Platform
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta
from typing import Dict, Optional

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')


class IndicatorTrustScores:
    """
    نظام الثقة الديناميكي للمؤشرات.
    
    كل أسبوع:
    - شوف التوقعات اللى فاتت → لو صحت → زود الـ trust
    - لو غلط → قلل الـ trust (العقاب أقوى)
    """
    
    def __init__(self, predictions_db: str = None):
        self.predictions_db = predictions_db or PREDICTIONS_DB
        self.scores = self._load_scores()
    
    def _get_conn(self):
        conn = sqlite3.connect(self.predictions_db)
        conn.row_factory = sqlite3.Row
        return conn
    
    def _load_scores(self) -> Dict[str, float]:
        """تحميل الثقات من الداتابيز."""
        scores = {}
        try:
            conn = self._get_conn()
            rows = conn.execute("SELECT indicator_name, current_score FROM indicator_trust_scores WHERE status = 'active'").fetchall()
            for row in rows:
                scores[row['indicator_name']] = row['current_score']
            conn.close()
        except Exception as e:
            print(f"[TrustScores] Error loading scores: {e}")
        return scores
    
    def _save_score(self, indicator_name: str, score: float):
        """حفظ درجة ثقة مؤشر في الداتابيز."""
        try:
            conn = self._get_conn()
            conn.execute("""
                INSERT INTO indicator_trust_scores (indicator_name, current_score, last_updated)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(indicator_name) DO UPDATE SET
                    current_score = ?,
                    last_updated = datetime('now')
            """, (indicator_name, score, score))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[TrustScores] Error saving score for {indicator_name}: {e}")
    
    def get_trust(self, indicator_name: str) -> float:
        """الحصول على درجة ثقة مؤشر."""
        return self.scores.get(indicator_name, 50.0)  # default: 50 (neutral)
    
    def update_trust_from_predictions(self):
        """
        كل أسبوع: شوف التوقعات اللى فاتت → لو صحت → زود الـ trust
        لو غلط → قلل الـ trust
        
        العقاب أقوى من المكافأة: -3 للغلط vs +2 للصح
        """
        try:
            conn = self._get_conn()
            
            # جيب التوقعات اللى عدى عليها 5 أيام
            results = conn.execute("""
                SELECT engine_name, signal_type, target_hit, stop_hit 
                FROM predictions 
                WHERE created_at < datetime('now', '-5 days')
                  AND (target_hit IS NOT NULL OR stop_hit IS NOT NULL)
            """).fetchall()
            
            updated = 0
            for row in results:
                engine_name = row['engine_name'] or 'unknown'
                signal = row['signal_type'] or 'hold'
                target_hit = row['target_hit']
                stop_hit = row['stop_hit']
                
                # صح = target_hit=True OR (sell signal + stop_hit=False)
                correct = False
                if target_hit:
                    correct = True
                elif signal.lower() == 'sell' and stop_hit == False:
                    correct = True
                
                current = self.scores.get(engine_name, 50.0)
                if correct:
                    new_score = min(100, current + 2)   # زود 2
                else:
                    new_score = max(0, current - 3)     # قلل 3 (العقاب أقوى)
                
                self.scores[engine_name] = new_score
                self._save_score(engine_name, new_score)
                updated += 1
            
            conn.close()
            
            if updated > 0:
                print(f"[TrustScores] ✓ Updated {updated} indicator trust scores from prediction outcomes")
            
            return updated
            
        except Exception as e:
            print(f"[TrustScores] Error updating trust from predictions: {e}")
            return 0
    
    def get_all_scores(self) -> Dict[str, float]:
        """الحصول على كل درجات الثقة."""
        return self.scores.copy()
    
    def adjust_score(self, indicator_name: str, delta: float):
        """تعديل يدوي لدرجة ثقة مؤشر."""
        current = self.scores.get(indicator_name, 50.0)
        new_score = max(0, min(100, current + delta))
        self.scores[indicator_name] = new_score
        self._save_score(indicator_name, new_score)
        return new_score


# Singleton
_trust_instance = None

def get_trust_scores(predictions_db: str = None) -> IndicatorTrustScores:
    """Singleton factory."""
    global _trust_instance
    if _trust_instance is None:
        _trust_instance = IndicatorTrustScores(predictions_db)
    return _trust_instance
