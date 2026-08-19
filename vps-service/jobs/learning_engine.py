#!/usr/bin/env python3
"""
Learning Engine — محرك التعلم الذاتي
====================================
يحلل التوقعات المغلقة ويتعلم منها:
1. أي الأنماط فشلت؟
2. أي الأنماط نجحت؟
3. ما هي التوصيات؟

Author: دليل الاستثمار
"""

import os
import re
import json
import sqlite3
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from collections import defaultdict

logger = logging.getLogger(__name__)

# Project root: vps-service/jobs/ -> vps-service/
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))

# 🔥 VERIFY-FIX-1: atomic, cross-process-locked I/O for optimizer_params.json.
# Import the shared helper so the learning-engine writer and the routes writer
# share the SAME lock file (.optimizer_params.lock) and the SAME atomic-write
# pattern (tempfile + fsync + os.replace). Before this, a torn read by the
# routes module could silently overwrite the file with defaults and wipe a
# week of learned params.
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))
from utils.params_io import (  # noqa: E402
    read_params as _io_read_params,
    locked_read_modify_write as _io_locked_rmw,
)

# 🔥 P0-v7-FINAL FIX: المسار الموحّد لـ optimizer_params.json.
# قبل كده، _write_param_immediately كان بـ write في Path(PREDICTIONS_DB).parent
# (=<root>/db/optimizer_params.json) — مسار مختلف تماماً عن اللي maestro بـ
# read منه (vps-service/config/). ده كسر الـ closed-loop learning كامل:
# LearningEngine كان بـ write params في مكان، و Maestro بـ read من تاني.
# الحل: نوحّد المسار لـ vps-service/config/optimizer_params.json (نفس اللي
# PARAMS_FILE في optimizer_params_routes.py).
_VPS_ROOT = Path(__file__).resolve().parent.parent
OPTIMIZER_PARAMS_FILE = _VPS_ROOT / 'config' / 'optimizer_params.json'


@dataclass
class Lesson:
    """درس مستفاد"""
    lesson_type: str
    condition: str
    outcome: str
    failure_rate: float
    occurrences: int
    avg_return: float
    recommendation: str
    # حقول جديدة للتحليل المتقدم
    success_rate: float = 0.0
    confidence: float = 0.0
    best_patterns: str = ''
    worst_patterns: str = ''
    regime: str = ''
    metadata_json: str = ''


@dataclass
class PerformanceReport:
    """تقرير الأداء"""
    period_start: str
    period_end: str
    total_predictions: int = 0
    target_hit_count: int = 0
    stopped_count: int = 0
    expired_count: int = 0
    win_rate: float = 0.0
    avg_return: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    best_ticker: str = ''
    worst_ticker: str = ''
    lessons: List[Lesson] = field(default_factory=list)
    # حقول جديدة لتقرير أداء أكثر تفصيلاً
    regime_lessons: List[Lesson] = field(default_factory=list)
    pattern_lessons: List[Lesson] = field(default_factory=list)
    weight_recommendations: Dict = field(default_factory=dict)


class LearningEngine:
    """محرك التعلم الذاتي"""

    def __init__(self, predictions_db=None):
        self.predictions_db = predictions_db or PREDICTIONS_DB
        self._ensure_tables()

    def _conn(self, db_path: str = None) -> sqlite3.Connection:
        conn = sqlite3.connect(db_path or self.predictions_db, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA busy_timeout=30000')
        return conn

    def _ensure_tables(self):
        """Ensure required tables exist"""
        conn = self._conn()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_type TEXT NOT NULL,
                condition TEXT NOT NULL,
                outcome TEXT NOT NULL,
                failure_rate REAL,
                occurrences INTEGER DEFAULT 0,
                avg_return REAL,
                recommendation TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sniper_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                total_predictions INTEGER,
                target_hit_count INTEGER,
                stopped_count INTEGER,
                expired_count INTEGER,
                win_rate REAL,
                avg_return REAL,
                avg_win REAL,
                avg_loss REAL,
                profit_factor REAL,
                best_ticker TEXT,
                worst_ticker TEXT,
                lessons_count INTEGER,
                created_at TEXT
            )
        """)
        conn.commit()
        conn.close()

    def get_closed_predictions(self, days: int = 90) -> List[Dict]:
        """Get all closed predictions in the last N days.

        Note: predictions table doesn't have a 'status' column — status is
        derived from hit_target/hit_stop/outcome_date. Also uses
        'outcome_date' not 'closed_at'.
        """
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        try:
            conn = self._conn()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT *,
                    CASE
                        WHEN hit_target = 1 THEN 'TARGET_HIT'
                        WHEN hit_stop = 1 THEN 'STOPPED'
                        ELSE 'EXPIRED'
                    END as status
                FROM predictions
                WHERE outcome_date IS NOT NULL
                AND outcome_date >= ?
                ORDER BY outcome_date DESC
            """, (cutoff,))
            rows = cursor.fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error getting closed predictions: {e}")
            return []

    def analyze_signal_accuracy(self, predictions: List[Dict]) -> List[Lesson]:
        """Analyze which signals succeeded and which failed"""
        lessons = []

        # Analyze by signal type
        signal_stats = {}
        for pred in predictions:
            signal = pred.get('signal', 'UNKNOWN')
            status = pred.get('status', '')
            actual_return = float(pred.get('actual_return', 0) or 0)

            if signal not in signal_stats:
                signal_stats[signal] = {'success': 0, 'failure': 0, 'returns': []}

            if status == 'TARGET_HIT':
                signal_stats[signal]['success'] += 1
            else:
                signal_stats[signal]['failure'] += 1
            signal_stats[signal]['returns'].append(actual_return)

        for signal, stats in signal_stats.items():
            total = stats['success'] + stats['failure']
            if total < 3:
                continue
            failure_rate = stats['failure'] / total * 100
            avg_return = sum(stats['returns']) / len(stats['returns']) if stats['returns'] else 0

            if failure_rate > 60:
                lessons.append(Lesson(
                    lesson_type='pattern_failure',
                    condition=f'signal = {signal}',
                    outcome='failure',
                    failure_rate=round(failure_rate, 1),
                    occurrences=total,
                    avg_return=round(avg_return, 2),
                    recommendation='avoid' if failure_rate > 75 else 'reduce_weight'
                ))
            elif failure_rate < 30:
                lessons.append(Lesson(
                    lesson_type='pattern_success',
                    condition=f'signal = {signal}',
                    outcome='success',
                    failure_rate=round(failure_rate, 1),
                    occurrences=total,
                    avg_return=round(avg_return, 2),
                    recommendation='increase_weight'
                ))

        return lessons

    def analyze_by_market(self, predictions: List[Dict]) -> List[Lesson]:
        """Analyze accuracy by market"""
        lessons = []
        market_stats = {}

        for pred in predictions:
            market = pred.get('market', 'UNKNOWN')
            status = pred.get('status', '')
            actual_return = float(pred.get('actual_return', 0) or 0)

            if market not in market_stats:
                market_stats[market] = {'success': 0, 'failure': 0, 'returns': []}

            if status == 'TARGET_HIT':
                market_stats[market]['success'] += 1
            else:
                market_stats[market]['failure'] += 1
            market_stats[market]['returns'].append(actual_return)

        for market, stats in market_stats.items():
            total = stats['success'] + stats['failure']
            if total < 3:
                continue
            failure_rate = stats['failure'] / total * 100
            avg_return = sum(stats['returns']) / len(stats['returns']) if stats['returns'] else 0

            if failure_rate > 65:
                lessons.append(Lesson(
                    lesson_type='filter_rule',
                    condition=f'market = {market}',
                    outcome='failure',
                    failure_rate=round(failure_rate, 1),
                    occurrences=total,
                    avg_return=round(avg_return, 2),
                    recommendation='add_filter'
                ))

        return lessons

    def analyze_by_confidence(self, predictions: List[Dict]) -> List[Lesson]:
        """Analyze accuracy by confidence level"""
        lessons = []

        # Low confidence (< 50)
        low_conf = [p for p in predictions if float(p.get('confidence', 50) or 50) < 50]
        # High confidence (>= 70)
        high_conf = [p for p in predictions if float(p.get('confidence', 50) or 50) >= 70]

        for label, group in [('low_confidence', low_conf), ('high_confidence', high_conf)]:
            if len(group) < 3:
                continue
            success = sum(1 for p in group if p.get('status') == 'TARGET_HIT')
            failure = len(group) - success
            failure_rate = failure / len(group) * 100
            avg_return = sum(float(p.get('actual_return', 0) or 0) for p in group) / len(group)

            if label == 'low_confidence' and failure_rate > 55:
                lessons.append(Lesson(
                    lesson_type='weight_adjustment',
                    condition='confidence < 50',
                    outcome='failure',
                    failure_rate=round(failure_rate, 1),
                    occurrences=len(group),
                    avg_return=round(avg_return, 2),
                    recommendation='increase_threshold'
                ))

        return lessons

    def calculate_performance(self, predictions: List[Dict], period_days: int = 7) -> PerformanceReport:
        """Calculate performance metrics"""
        now = datetime.now()
        period_start = (now - timedelta(days=period_days)).strftime('%Y-%m-%d')
        period_end = now.strftime('%Y-%m-%d')

        report = PerformanceReport(period_start=period_start, period_end=period_end)

        if not predictions:
            return report

        report.total_predictions = len(predictions)
        report.target_hit_count = sum(1 for p in predictions if p.get('status') == 'TARGET_HIT')
        report.stopped_count = sum(1 for p in predictions if p.get('status') == 'STOPPED')
        report.expired_count = sum(1 for p in predictions if p.get('status') == 'EXPIRED')

        closed = [p for p in predictions if p.get('status') in ('TARGET_HIT', 'STOPPED')]
        if closed:
            report.win_rate = round(report.target_hit_count / len(closed) * 100, 1)

        returns = [float(p.get('actual_return', 0) or 0) for p in predictions]
        if returns:
            report.avg_return = round(sum(returns) / len(returns), 2)
            wins = [r for r in returns if r > 0]
            losses = [abs(r) for r in returns if r < 0]
            if wins:
                report.avg_win = round(sum(wins) / len(wins), 2)
            if losses:
                report.avg_loss = round(sum(losses) / len(losses), 2)
            gross_profit = sum(wins) if wins else 0
            gross_loss = sum(losses) if losses else 0.001
            report.profit_factor = round(gross_profit / gross_loss, 2)

        # Best/worst ticker
        ticker_returns = {}
        for p in predictions:
            ticker = p.get('ticker', '')
            ret = float(p.get('actual_return', 0) or 0)
            if ticker not in ticker_returns:
                ticker_returns[ticker] = []
            ticker_returns[ticker].append(ret)

        if ticker_returns:
            ticker_avgs = {t: sum(r) / len(r) for t, r in ticker_returns.items() if len(r) >= 2}
            if ticker_avgs:
                report.best_ticker = max(ticker_avgs, key=ticker_avgs.get)
                report.worst_ticker = min(ticker_avgs, key=ticker_avgs.get)

        return report

    def save_lessons(self, lessons: List[Lesson]):
        """Save learned lessons to database"""
        if not lessons:
            return

        conn = self._conn()
        cursor = conn.cursor()
        now = datetime.now().isoformat()

        for lesson in lessons:
            # Check if lesson already exists
            cursor.execute("""
                SELECT id, occurrences FROM learned_lessons
                WHERE condition = ? AND lesson_type = ?
            """, (lesson.condition, lesson.lesson_type))
            existing = cursor.fetchone()

            if existing:
                # Update existing lesson
                cursor.execute("""
                    UPDATE learned_lessons
                    SET failure_rate = ?, occurrences = ?, avg_return = ?,
                        recommendation = ?, updated_at = ?
                    WHERE id = ?
                """, (lesson.failure_rate, lesson.occurrences, lesson.avg_return,
                      lesson.recommendation, now, existing[0]))
            else:
                # Insert new lesson
                cursor.execute("""
                    INSERT INTO learned_lessons
                    (lesson_type, condition, outcome, failure_rate, occurrences, avg_return, recommendation, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (lesson.lesson_type, lesson.condition, lesson.outcome,
                      lesson.failure_rate, lesson.occurrences, lesson.avg_return,
                      lesson.recommendation, now, now))

        conn.commit()
        conn.close()
        logger.info(f"[LearningEngine] Saved {len(lessons)} lessons")

    def save_performance(self, report: PerformanceReport):
        """Save performance report"""
        conn = self._conn()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sniper_performance
            (period_start, period_end, total_predictions, target_hit_count, stopped_count,
             expired_count, win_rate, avg_return, avg_win, avg_loss, profit_factor,
             best_ticker, worst_ticker, lessons_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (report.period_start, report.period_end, report.total_predictions,
              report.target_hit_count, report.stopped_count, report.expired_count,
              report.win_rate, report.avg_return, report.avg_win, report.avg_loss,
              report.profit_factor, report.best_ticker, report.worst_ticker,
              len(report.lessons), datetime.now().isoformat()))
        conn.commit()
        conn.close()

    def _infer_regime_for_predictions(self, predictions: List[Dict]) -> Dict[str, str]:
        """بحدد النظام السعري (بول/بير/رينج) لكل توقع بناءً على البيانات المتاحة
        
        لو لقيت عمود market_regime في التوقعات — بستخدمه مباشرة
        لو مش موجود — بشوف اتجاه مؤشر EGX30 من stocks.db
        لو مفيش بيانات تاريخية للمؤشر — بستنتج النظام من أداء التوقعات نفسها
        """
        regime_map = {}  # prediction_date -> regime
        try:
            # المحاولة الأولى: نشوف لو في عمود market_regime
            conn = self._conn()
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(predictions)")
            columns = [row[1] for row in cursor.fetchall()]
            conn.close()

            if 'market_regime' in columns:
                # يلا ناخد النظام من العمود مباشرة
                conn = self._conn()
                cursor = conn.cursor()
                for pred in predictions:
                    pred_date = pred.get('prediction_date', '')[:10]
                    if pred_date in regime_map:
                        continue
                    cursor.execute(
                        "SELECT DISTINCT market_regime FROM predictions WHERE prediction_date LIKE ? AND market_regime IS NOT NULL LIMIT 1",
                        (f'{pred_date}%',)
                    )
                    row = cursor.fetchone()
                    if row and row[0]:
                        regime_map[pred_date] = row[0]
                conn.close()
                if regime_map:
                    return regime_map
        except Exception as e:
            logger.warning(f"[LearningEngine] مشكلة في قراءة market_regime: {e}")

        # المحاولة التانية: نشوف اتجاه EGX30 من stocks.db
        try:
            stocks_db = str(_PROJECT_ROOT / 'db' / 'stocks.db')
            if os.path.exists(stocks_db):
                conn_stocks = sqlite3.connect(stocks_db, timeout=30.0)
                conn_stocks.row_factory = sqlite3.Row
                cursor_s = conn_stocks.cursor()
                # نشوف هل في بيانات تاريخية لمؤشر EGX30
                cursor_s.execute(
                    "SELECT COUNT(*) FROM egksco_price_history WHERE symbol = 'EGX30'"
                )
                egx_count = cursor_s.fetchone()[0]
                if egx_count > 0:
                    # يلا نحدد النظام لكل يوم
                    all_dates = sorted(set(p.get('prediction_date', '')[:10] for p in predictions))
                    for d in all_dates:
                        cursor_s.execute("""
                            SELECT close_price FROM egksco_price_history
                            WHERE symbol = 'EGX30' AND date <= ?
                            ORDER BY date DESC LIMIT 20
                        """, (d,))
                        prices = [r[0] for r in cursor_s.fetchall() if r[0]]
                        if len(prices) >= 10:
                            recent = prices[:5]
                            older = prices[5:10]
                            avg_recent = sum(recent) / len(recent)
                            avg_older = sum(older) / len(older)
                            change_pct = (avg_recent - avg_older) / avg_older * 100
                            if change_pct > 2:
                                regime_map[d] = 'bull'
                            elif change_pct < -2:
                                regime_map[d] = 'bear'
                            else:
                                regime_map[d] = 'range'
                    conn_stocks.close()
                    if regime_map:
                        return regime_map
                conn_stocks.close()
        except Exception as e:
            logger.warning(f"[LearningEngine] مشكلة في استنتاج النظام من EGX30: {e}")

        # المحاولة التالتة: نستنتج النظام من أداء التوقعات نفسها
        # بنجمع التوقعات اللي اتعملت في نفس اليوم ونشوف أداؤها
        try:
            date_groups = defaultdict(list)
            for pred in predictions:
                pred_date = pred.get('prediction_date', '')[:10]
                date_groups[pred_date].append(pred)

            # بنحدد نافذة 3 أيام لتحليل الاتجاه
            all_dates = sorted(date_groups.keys())
            for d in all_dates:
                # نجمع توقعات 3 أيام حول اليوم ده
                nearby_preds = []
                for dd in all_dates:
                    try:
                        days_diff = abs((datetime.strptime(d, '%Y-%m-%d') - datetime.strptime(dd, '%Y-%m-%d')).days)
                    except (ValueError, TypeError):
                        continue
                    if days_diff <= 3:
                        nearby_preds.extend(date_groups[dd])

                if len(nearby_preds) < 2:
                    regime_map[d] = 'range'
                    continue

                # نشوف متوسط الأداء ونسبة النجاح
                returns = [float(p.get('actual_return', 0) or 0) for p in nearby_preds]
                wins = sum(1 for p in nearby_preds if p.get('status') == 'TARGET_HIT')
                win_rate = wins / len(nearby_preds) * 100
                avg_ret = sum(returns) / len(returns)

                # لو نسبة النجاح عالية والأداء موجب → بول
                # لو نسبة النجاح واطية والأداء سالب → بير
                if win_rate > 50 and avg_ret > 0.5:
                    regime_map[d] = 'bull'
                elif win_rate < 35 or avg_ret < -0.5:
                    regime_map[d] = 'bear'
                else:
                    regime_map[d] = 'range'
        except Exception as e:
            logger.warning(f"[LearningEngine] مشكلة في استنتاج النظام من الأداء: {e}")

        return regime_map

    def _analyze_by_regime(self, predictions: List[Dict]) -> List[Lesson]:
        """تحليل الأداء حسب النظام السعري (بول/بير/رينج)
        
        بيجمع التوقعات حسب النظام اللي كانت فيه
        وبحسب نسبة النجاح والمتوسط وأفضل/أسوأ الأنماط
        """
        lessons = []
        try:
            # بحدد النظام لكل توقع
            regime_map = self._infer_regime_for_predictions(predictions)

            if not regime_map:
                logger.warning("[LearningEngine] مفيش بيانات كافية لتحديد النظام السعري")
                return lessons

            # بتقسم التوقعات حسب النظام
            regime_groups = defaultdict(list)
            for pred in predictions:
                pred_date = pred.get('prediction_date', '')[:10]
                regime = regime_map.get(pred_date, 'range')
                regime_groups[regime].append(pred)

            # بتحلل كل نظام
            for regime in ['bull', 'bear', 'range']:
                group = regime_groups.get(regime, [])
                if len(group) < 3:
                    continue

                wins = sum(1 for p in group if p.get('status') == 'TARGET_HIT')
                total = len(group)
                win_rate = wins / total * 100
                returns = [float(p.get('actual_return', 0) or 0) for p in group]
                avg_return = sum(returns) / len(returns) if returns else 0

                # أحسن وأسوأ أنماط (الإشارات اللي اشتغلت ومش اشتغلت)
                signal_perf = defaultdict(lambda: {'wins': 0, 'total': 0, 'returns': []})
                for p in group:
                    sig = p.get('signal', 'UNKNOWN')
                    signal_perf[sig]['total'] += 1
                    if p.get('status') == 'TARGET_HIT':
                        signal_perf[sig]['wins'] += 1
                    signal_perf[sig]['returns'].append(float(p.get('actual_return', 0) or 0))

                best_patterns = []
                worst_patterns = []
                for sig, stats in signal_perf.items():
                    if stats['total'] < 2:
                        continue
                    sig_wr = stats['wins'] / stats['total'] * 100
                    if sig_wr >= 50:
                        best_patterns.append(f"{sig}:{sig_wr:.0f}%")
                    else:
                        worst_patterns.append(f"{sig}:{sig_wr:.0f}%")

                # بنخزن الدرس
                lesson = Lesson(
                    lesson_type=f'regime_{regime}',
                    condition=f'market_regime={regime}',
                    outcome='success' if win_rate >= 50 else 'failure',
                    failure_rate=round(100 - win_rate, 1),
                    occurrences=total,
                    avg_return=round(avg_return, 2),
                    recommendation='increase_weight' if win_rate >= 50 else 'reduce_exposure',
                    success_rate=round(win_rate, 1),
                    confidence=min(round(total / 30, 2), 1.0),  # الثقة بناءً على حجم العينة
                    best_patterns=','.join(best_patterns[:5]),
                    worst_patterns=','.join(worst_patterns[:5]),
                    regime=regime,
                )
                lessons.append(lesson)

                # نخزن الدرس في الداتابيز
                self._store_regime_lesson(
                    regime=regime,
                    win_rate=win_rate,
                    patterns={'best': best_patterns, 'worst': worst_patterns},
                    recommendations={}
                )

            logger.info(f"[LearningEngine] تحليل النظام: {len(lessons)} دروس ريجيم")
        except Exception as e:
            logger.error(f"[LearningEngine] خطأ في تحليل النظام السعري: {e}")
        return lessons

    def _parse_notes(self, notes: str) -> Dict[str, Any]:
        """بفكك حقل notes لاستخراج المؤشرات الفنية
        
        المفروض يكون شكله كده:
        strategy=exit_trailing_7; score=40.0; rsi=57.47; rr=1.5; reasons=Below MA50
        """
        result = {
            'rsi': None,
            'volume_mult': None,
            'reasons': '',
            'strategy': '',
            'score': None,
            'rr': None,
        }
        if not notes:
            return result
        try:
            for part in notes.split(';'):
                part = part.strip()
                if '=' in part:
                    key, val = part.split('=', 1)
                    key = key.strip().lower()
                    val = val.strip()
                    if key == 'rsi':
                        result['rsi'] = float(val)
                    elif key == 'score':
                        result['score'] = float(val)
                    elif key == 'rr':
                        result['rr'] = float(val)
                    elif key == 'reasons':
                        result['reasons'] = val
                    elif key == 'strategy':
                        result['strategy'] = val

            # بنستخرج معامل الحجم من الأسباب
            reasons_lower = result['reasons'].lower()
            vol_match = re.search(r'volume\s*([\d.]+)x', reasons_lower)
            if vol_match:
                result['volume_mult'] = float(vol_match.group(1))
        except Exception:
            pass
        return result

    def _analyze_by_pattern(self, predictions: List[Dict]) -> List[Lesson]:
        """تحليل الأداء حسب الأنماط الفنية
        
        بيفحص:
        - RSI أقل من 30 (تشبع بيعي) — هل الارتداد ناجح؟
        - RSI أكتر من 70 (تشبع شرائي) — هل الانعكاس حصل؟
        - حجم أكتر من ضعف المتوسط — هل معتمد؟
        - قرب من الدعم — هل الدعم صامد؟
        - القطاع صاعد — هل السهم سابقه؟
        """
        lessons = []
        try:
            # بنجهز مجموعات الأنماط
            pattern_groups = {
                'pattern_rsi_oversold': [],     # RSI < 30
                'pattern_rsi_overbought': [],    # RSI > 70
                'pattern_volume_spike': [],      # حجم > 2x
                'pattern_near_support': [],      # قرب الدعم
                'pattern_sector_up': [],         # القطاع صاعد
            }

            for pred in predictions:
                notes_data = self._parse_notes(pred.get('notes', ''))
                rsi = notes_data['rsi']
                vol_mult = notes_data['volume_mult']
                reasons = notes_data['reasons'].lower()
                tech_score = float(pred.get('technical_score', 50) or 50)
                fund_score = float(pred.get('fundamental_score', 50) or 50)

                if rsi is not None:
                    if rsi < 30:
                        pattern_groups['pattern_rsi_oversold'].append(pred)
                    elif rsi > 70:
                        pattern_groups['pattern_rsi_overbought'].append(pred)

                if vol_mult is not None and vol_mult >= 2.0:
                    pattern_groups['pattern_volume_spike'].append(pred)

                # قرب الدعم — من الأسباب أو من التقيم
                if 'below ma' in reasons or 'support' in reasons or 'near support' in reasons:
                    pattern_groups['pattern_near_support'].append(pred)

                # القطاع صاعد — بنستخدم Fundamental score كشارة
                if fund_score > 60:
                    pattern_groups['pattern_sector_up'].append(pred)

            # بنحلل كل نمط
            pattern_labels = {
                'pattern_rsi_oversold': 'RSI < 30 (تشبع بيعي)',
                'pattern_rsi_overbought': 'RSI > 70 (تشبع شرائي)',
                'pattern_volume_spike': 'حجم > 2x المتوسط',
                'pattern_near_support': 'قرب من الدعم',
                'pattern_sector_up': 'القطاع صاعد (fundamental > 60)',
            }

            for pattern_key, group in pattern_groups.items():
                if len(group) < 2:
                    continue

                wins = sum(1 for p in group if p.get('status') == 'TARGET_HIT')
                total = len(group)
                win_rate = wins / total * 100
                returns = [float(p.get('actual_return', 0) or 0) for p in group]
                avg_return = sum(returns) / len(returns) if returns else 0

                lesson = Lesson(
                    lesson_type=pattern_key,
                    condition=pattern_labels.get(pattern_key, pattern_key),
                    outcome='success' if win_rate >= 50 else 'failure',
                    failure_rate=round(100 - win_rate, 1),
                    occurrences=total,
                    avg_return=round(avg_return, 2),
                    recommendation='increase_weight' if win_rate >= 55 else ('reduce_weight' if win_rate < 35 else 'monitor'),
                    success_rate=round(win_rate, 1),
                    confidence=min(round(total / 20, 2), 1.0),
                )
                lessons.append(lesson)

            logger.info(f"[LearningEngine] تحليل الأنماط: {len(lessons)} دروس نمط")
        except Exception as e:
            logger.error(f"[LearningEngine] خطأ في تحليل الأنماط الفنية: {e}")
        return lessons

    def _generate_weight_recommendations(self, regime_lessons: List[Lesson], pattern_lessons: List[Lesson]) -> Dict:
        """بولد توصيات محددة لتعديل الأوزان بناءً على الدروس المستفادة
        
        كل نظام سعري بيستاهل أوزان مختلفة:
        - في البول: الحجم والقطاع هم الأهم
        - في البير: الأساسيات والتقني هم الأهم (الأمان أولاً)
        - في الرينج: نمط RSI والسيولة هم الأهم
        """
        recommendations = {}
        try:
            # بنجهز بيانات كل نظام
            regime_data = {}
            for lesson in regime_lessons:
                regime_data[lesson.regime] = {
                    'win_rate': lesson.success_rate,
                    'confidence': lesson.confidence,
                    'best_patterns': lesson.best_patterns.split(',') if lesson.best_patterns else [],
                    'worst_patterns': lesson.worst_patterns.split(',') if lesson.worst_patterns else [],
                    'avg_return': lesson.avg_return,
                }

            # بنجهز بيانات الأنماط
            pattern_data = {}
            for lesson in pattern_lessons:
                pattern_data[lesson.lesson_type] = {
                    'win_rate': lesson.success_rate,
                    'confidence': lesson.confidence,
                    'avg_return': lesson.avg_return,
                }

            # الأوزان المتاحة في النظام
            all_weights = ['technical', 'fundamental', 'ai_pattern', 'sentiment', 'volume_profile', 'sector_relative', 'timing']

            # توصيات كل نظام
            for regime in ['bull', 'bear', 'range']:
                data = regime_data.get(regime)
                if not data or data['win_rate'] == 0:
                    continue

                increase = []
                decrease = []

                if regime == 'bull':
                    # في البول: الحجم والقطاع والأدوات الذكية بيشتغلوا أحسن
                    if pattern_data.get('pattern_volume_spike', {}).get('win_rate', 0) > 45:
                        increase.append('volume_profile')
                    if pattern_data.get('pattern_sector_up', {}).get('win_rate', 0) > 45:
                        increase.append('sector_relative')
                    # لو الأنماط الفنية مش شغالة كويس في البول
                    if pattern_data.get('pattern_rsi_oversold', {}).get('win_rate', 50) < 40:
                        decrease.append('technical')
                    # الأساسيات مش مهمة كتير في البول
                    decrease.append('fundamental')
                    # لو الدعم بيشتغل في البول
                    if pattern_data.get('pattern_near_support', {}).get('win_rate', 0) > 50:
                        increase.append('timing')

                elif regime == 'bear':
                    # في البير: الأمان أولاً — أساسيات وتقني
                    increase.append('fundamental')
                    increase.append('technical')
                    # الحجم في البير ممكن يكون فخ
                    if pattern_data.get('pattern_volume_spike', {}).get('win_rate', 50) < 40:
                        decrease.append('volume_profile')
                    # التوقيت خطير في البير
                    if pattern_data.get('pattern_rsi_overbought', {}).get('win_rate', 50) < 35:
                        decrease.append('timing')
                    # لو التشبع البيعي بيشتغل كويس
                    if pattern_data.get('pattern_rsi_oversold', {}).get('win_rate', 0) > 50:
                        increase.append('ai_pattern')

                elif regime == 'range':
                    # في الرينج: RSI والسيولة مهمين
                    if pattern_data.get('pattern_rsi_oversold', {}).get('win_rate', 0) > 50:
                        increase.append('technical')
                    if pattern_data.get('pattern_near_support', {}).get('win_rate', 0) > 50:
                        increase.append('timing')
                    # القطاع مش مؤثر كتير في الرينج
                    decrease.append('sector_relative')
                    decrease.append('sentiment')

                # بنزيل التكرارات ونضمن إن مفيش حاجة في الزيادة والنقصان مع بعض
                increase = list(set(increase) - set(decrease))
                decrease = list(set(decrease) - set(increase))

                # بنفلتر بس الأوزان المعروفة
                increase = [w for w in increase if w in all_weights]
                decrease = [w for w in decrease if w in all_weights]

                recommendations[regime] = {
                    'increase': increase,
                    'decrease': decrease,
                    'confidence': round(data['confidence'], 2),
                }

            # بنخزن التوصيات في الداتابيز كدرس خاص
            if recommendations:
                self._store_weight_recommendations(recommendations)

            logger.info(f"[LearningEngine] توصيات الأوزان: {len(recommendations)} نظام")
        except Exception as e:
            logger.error(f"[LearningEngine] خطأ في توليد توصيات الأوزان: {e}")
        return recommendations

    def _store_weight_recommendations(self, recommendations: Dict):
        """بخزن توصيات تعديل الأوزان كدرس في الداتابيز
        
        عشان محرك الأوزان التكيفي يقدر يقرأها ويطبقها
        """
        try:
            conn = self._conn()
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            rec_json = json.dumps(recommendations, ensure_ascii=False)

            # نشوف لو في توصيات قديمة — بنحدثها
            cursor.execute(
                "SELECT id FROM learned_lessons WHERE lesson_type = 'weight_recommendations' ORDER BY created_at DESC LIMIT 1"
            )
            existing = cursor.fetchone()

            if existing:
                cursor.execute(
                    "UPDATE learned_lessons SET recommendation = ?, updated_at = ? WHERE id = ?",
                    (rec_json, now, existing[0])
                )
            else:
                cursor.execute(
                    "INSERT INTO learned_lessons (lesson_type, condition, outcome, failure_rate, occurrences, avg_return, recommendation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    ('weight_recommendations', 'adaptive_weight_adjustments', 'generated', 0, 0, 0, rec_json, now, now)
                )

            conn.commit()
            conn.close()
            logger.info("[LearningEngine] تم تخزين توصيات الأوزان بنجاح")
        except Exception as e:
            logger.error(f"[LearningEngine] خطأ في تخزين توصيات الأوزان: {e}")

    def _store_regime_lesson(self, regime: str, win_rate: float, patterns: Dict, recommendations: Dict):
        """مساعد لتخزين درس النظام السعري في الداتابيز
        
        بيخزن كل درس كصف واحد في جدول learned_lessons
        """
        try:
            conn = self._conn()
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            rec_json = json.dumps(recommendations, ensure_ascii=False) if recommendations else '{}'
            patterns_json = json.dumps(patterns, ensure_ascii=False) if patterns else '{}'

            cursor.execute(
                "SELECT id, occurrences FROM learned_lessons WHERE lesson_type = ? AND condition = ?",
                (f'regime_{regime}', f'market_regime={regime}')
            )
            existing = cursor.fetchone()

            if existing:
                cursor.execute(
                    "UPDATE learned_lessons SET failure_rate = ?, occurrences = ?, avg_return = ?, recommendation = ?, updated_at = ? WHERE id = ?",
                    (round(100 - win_rate, 1), existing[1], 0, rec_json, now, existing[0])
                )
            else:
                cursor.execute(
                    "INSERT INTO learned_lessons (lesson_type, condition, outcome, failure_rate, occurrences, avg_return, recommendation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (f'regime_{regime}', f'market_regime={regime}',
                     'success' if win_rate >= 50 else 'failure',
                     round(100 - win_rate, 1), 0, 0, rec_json, now, now)
                )

            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"[LearningEngine] خطأ في تخزين درس النظام {regime}: {e}")

    def get_weight_recommendations(self) -> Dict:
        """بيقري أحدث توصيات تعديل الأوزان من الداتابيز
        
        محرك الأوزان التكيفي (adaptive_weights.py) بيستدعي الميثود ده
        لمعرفة الأوزان المناسبة للنظام الحالي
        
        بيرجع ديكشناري بالشكل ده:
        {
          'regime_bull': {'increase': [...], 'decrease': [...], 'confidence': 0.85},
          'regime_bear': {'increase': [...], 'decrease': [...], 'confidence': 0.72}
        }
        """
        try:
            conn = self._conn()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT recommendation FROM learned_lessons WHERE lesson_type = 'weight_recommendations' ORDER BY created_at DESC LIMIT 1"
            )
            row = cursor.fetchone()
            conn.close()

            if row and row[0]:
                try:
                    return json.loads(row[0])
                except (json.JSONDecodeError, TypeError):
                    logger.warning("[LearningEngine] توصيات الأوزان مش صالحة JSON")
                    return {}
        except Exception as e:
            logger.error(f"[LearningEngine] خطأ في قراءة توصيات الأوزان: {e}")
        return {}

    def on_prediction_closed(self, prediction_id: int = None, ticker: str = '', regime: str = 'unknown') -> dict:
        """
        رد فعل فوري لما prediction تتقفل (target hit أو stop hit).
        
        ده "micro-learning" — كل صفقة مغلقة بتحدّث الـ parameters فوراً.
        
        Feedback loop:
        1. حلل: ليه نجحت/فشلت؟ (quick analysis)
        2. جرب تعديل parameter واحد (tweak)
        3. اختبر على آخر 30 يوم (quick backtest)
        4. لو أحسن → اكتب في optimizer_params.json فوراً
        
        Args:
            prediction_id: ID التوقع المقفل
            ticker: رمز السهم
            regime: حالة السوق وقت التوقع
            
        Returns:
            dict: {
                'tweaked': bool,
                'param': str,
                'old_value': float,
                'new_value': float,
                'improvement': float,
                'reason': str,
            }
        """
        result = {
            'tweaked': False,
            'param': '',
            'old_value': 0.0,
            'new_value': 0.0,
            'improvement': 0.0,
            'reason': '',
        }
        
        try:
            # 1. جلب آخر التوقعات المقفولة (آخر 5)
            recent_closed = self._get_recent_closed_predictions(limit=5, regime=regime)
            if not recent_closed or len(recent_closed) < 3:
                result['reason'] = f'مفيش بيانات كافية ({len(recent_closed) if recent_closed else 0} توقعات)'
                return result
            
            # 2. تحليل سريع: هل في pattern واضح؟
            win_rate = sum(1 for p in recent_closed if p.get('status') == 'TARGET_HIT') / len(recent_closed)
            
            # 3. تحديد parameter للتغيير بناءً على الـ pattern
            param_tweak = self._identify_param_to_tweak(recent_closed, regime, win_rate)
            if not param_tweak:
                result['reason'] = 'مفيش pattern واضح — بدون تعديل'
                return result
            
            param_name = param_tweak['param']
            old_value = param_tweak['old_value']
            suggested_value = param_tweak['suggested_value']
            
            # 4. Quick backtest على آخر 30 يوم (سريع)
            backtest_result = self._quick_backtest_param(
                param_name, suggested_value, regime=regime, days=30
            )
            
            if backtest_result is None:
                result['reason'] = f'Backtest فشل لـ {param_name}'
                return result
            
            # 5. لو النتيجة أحسن → اكتب في optimizer_params.json فوراً
            current_pf = backtest_result.get('current_pf', 0)
            new_pf = backtest_result.get('new_pf', 0)
            improvement = new_pf - current_pf if current_pf > 0 else 0
            
            if improvement > 0.05:  # تحسن 5%+ في Profit Factor
                # اكتب في optimizer_params.json
                written = self._write_param_immediately(param_name, suggested_value, regime)
                if written:
                    result['tweaked'] = True
                    result['param'] = param_name
                    result['old_value'] = old_value
                    result['new_value'] = suggested_value
                    result['improvement'] = round(improvement, 4)
                    result['reason'] = (
                        f"Auto-tweak: {param_name} {old_value} → {suggested_value} "
                        f"(PF: {current_pf:.2f} → {new_pf:.2f}, improvement +{improvement:.1%})"
                    )
                    logger.info(f"[ImmediateLearning] ✅ {result['reason']}")
                else:
                    result['reason'] = 'فشل كتابة المعامل'
            else:
                result['reason'] = (
                    f"Backtest مش مشجع: {param_name} {suggested_value} "
                    f"(PF: {current_pf:.2f} → {new_pf:.2f}, improvement {improvement:.1%})"
                )
                logger.debug(f"[ImmediateLearning] ⏭️ {result['reason']}")
        
        except Exception as e:
            logger.error(f"[ImmediateLearning] خطأ: {e}")
            result['reason'] = f'خطأ: {e}'
        
        return result

    def _get_recent_closed_predictions(self, limit: int = 5, regime: str = 'unknown') -> list:
        """جلب آخر التوقعات المقفولة."""
        try:
            conn = sqlite3.connect(PREDICTIONS_DB)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute('''
                SELECT *,
                    CASE
                        WHEN hit_target = 1 THEN 'TARGET_HIT'
                        WHEN hit_stop = 1 THEN 'STOPPED'
                        ELSE 'EXPIRED'
                    END as status
                FROM predictions
                WHERE outcome_date IS NOT NULL
                AND (hit_target = 1 OR hit_stop = 1)
                AND outcome_date >= date('now', '-30 days')
                ORDER BY outcome_date DESC
                LIMIT ?
            ''', (limit,))
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return rows
        except Exception as e:
            logger.error(f"[ImmediateLearning] خطأ في جلب التوقعات: {e}")
            return []

    def _identify_param_to_tweak(self, predictions: list, regime: str, win_rate: float) -> dict:
        """
        تحديد parameter واحد للتغيير بناءً على pattern التوقعات الأخيرة.

        🔥 VERIFY-FIX-3 (namespace): قبل كده كان الـ auto-tuner بـ write أسماء
        params خاطئة (``min_score``, ``stop_atr_mult``, ``min_rr``) في
        ``regime_specific.{regime}`` — والمايسترو بـ read أسماء تانية
        (``min_conviction``, ``max_stop_pct``, ``min_rr_ratio``) من الـ top-level.
        النتيجة: التعلم كان بـ يتكتب في مكان ما حدش بـ يقرأه → الـ loop ميت.
        دلوقتي الأسماء بتطابق الـ DEFAULT_PARAMS keys اللي المايسترو بـ readها.

        لو win_rate واطي جداً → نعدل min_conviction (نبقى أكثر انتقائية)
        لو avg_loss كبير → نعدل max_stop_pct (وقف أضيق)
        لو في كتير target hits بس بأرباح صغيرة → نعدل min_rr_ratio
        """
        if win_rate < 0.3:
            # فوز قليل → نبقى أكثر انتقائية (raise min_conviction)
            return {
                'param': 'min_conviction',
                'old_value': 65.0,  # matches DEFAULT_PARAMS['min_conviction']
                'suggested_value': min(80, 65 + (0.3 - win_rate) * 50),
            }

        # حساب avg loss كنسبة
        losses = []
        for p in predictions:
            entry = float(p.get('entry_price', 0) or 0)
            stop = float(p.get('stop_price', 0) or 0)
            if entry > 0 and stop > 0 and p.get('status') == 'STOPPED':
                loss_pct = (entry - stop) / entry * 100
                losses.append(loss_pct)

        if losses:
            avg_loss = sum(losses) / len(losses)
            if avg_loss > 5.0:
                # خسارة كبيرة → وقف أضيق (lower max_stop_pct)
                # avg_loss=5% → suggested=5.0%; avg_loss=10% → suggested=3.0%
                return {
                    'param': 'max_stop_pct',
                    'old_value': 7.0,  # matches DEFAULT_PARAMS['max_stop_pct']
                    'suggested_value': max(3.0, 7.0 - avg_loss * 0.4),
                }

        # حساب avg win كنسبة
        wins = []
        for p in predictions:
            entry = float(p.get('entry_price', 0) or 0)
            target = float(p.get('target_price', 0) or 0)
            if entry > 0 and target > 0 and p.get('status') == 'TARGET_HIT':
                win_pct = (target - entry) / entry * 100
                wins.append(win_pct)

        if wins and win_rate > 0.5:
            avg_win = sum(wins) / len(wins)
            if avg_win < 2.0:
                # أرباح صغيرة → نزود min_rr_ratio
                return {
                    'param': 'min_rr_ratio',
                    'old_value': 1.5,  # matches DEFAULT_PARAMS['min_rr_ratio']
                    'suggested_value': min(3.0, 1.5 + (3.0 - avg_win) * 0.2),
                }

        # لو مفيش pattern واضح — رجع None
        return None

    def _quick_backtest_param(self, param_name: str, new_value: float, regime: str = 'unknown', days: int = 30) -> dict:
        """
        Backtest سريع على آخر N يوم لمقارنة الـ parameter الحالي بالجديد.
        
        Returns:
            dict: {'current_pf': float, 'new_pf': float} أو None لو فشل
        """
        try:
            conn = sqlite3.connect(PREDICTIONS_DB)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cutoff = f"date('now', '-{days} days')"
            
            cur.execute(f'''
                SELECT *,
                    CASE
                        WHEN hit_target = 1 THEN 'TARGET_HIT'
                        WHEN hit_stop = 1 THEN 'STOPPED'
                        ELSE 'EXPIRED'
                    END as status
                FROM predictions
                WHERE outcome_date IS NOT NULL
                AND (hit_target = 1 OR hit_stop = 1)
                AND outcome_date >= {cutoff}
                ORDER BY outcome_date DESC
            ''')
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            
            if len(rows) < 5:
                return None
            
            # حساب PF الحالي (كل التوقعات)
            total_profit = 0.0
            total_loss = 0.0
            for r in rows:
                entry = float(r.get('entry_price', 0) or 0)
                if entry <= 0:
                    continue
                if r['status'] == 'TARGET_HIT':
                    target = float(r.get('target_price', 0) or 0)
                    profit = (target - entry) / entry
                    total_profit += profit
                else:
                    stop = float(r.get('stop_price', 0) or 0)
                    loss = (entry - stop) / entry
                    total_loss += loss
            
            current_pf = total_profit / total_loss if total_loss > 0 else (999 if total_profit > 0 else 0)
            
            # محاكاة PF بالـ parameter الجديد
            # ده تبسيط — في الواقع لازم نعيد حساب كل التوقعات بالـ param الجديد
            # بس كـ proxy: بنفلتر التوقعات اللي كانت هتتشال بالـ param الجديد
            # 🔥 VERIFY-FIX-3: الأسماء بتطابق الـ top-level keys اللي المايسترو بـ readها
            filtered = rows
            if param_name == 'min_conviction':
                filtered = [r for r in rows if float(r.get('technical_score', 0) or 0) >= new_value]
            elif param_name == 'min_rr_ratio':
                filtered_rows = []
                for r in rows:
                    entry = float(r.get('entry_price', 0) or 0)
                    target = float(r.get('target_price', 0) or 0)
                    stop = float(r.get('stop_price', 0) or 0)
                    if entry > 0 and stop > 0 and (entry - stop) > 0:
                        rr = (target - entry) / (entry - stop)
                        if rr >= new_value:
                            filtered_rows.append(r)
                filtered = filtered_rows
            elif param_name == 'max_stop_pct':
                # الوقف الأضيق = خسارة أقل → نقدّر التأثير
                filtered = rows  # نفس العدد، بس الـ loss هنخفضه تقديراً
                # old=7%, new<7 → نسبة التقليص = (7 - new)/7
                stop_reduction = max(0.0, (7.0 - new_value) / 7.0)
                if stop_reduction > 0:
                    # بنقلل الـ loss تقديراً بنفس نسبة تقليص الوقف
                    pass  # بنستخدم filtered زي هو وبنحسب PF عادي
            
            # حساب PF بعد الفلتر
            new_profit = 0.0
            new_loss = 0.0
            for r in filtered:
                entry = float(r.get('entry_price', 0) or 0)
                if entry <= 0:
                    continue
                if r['status'] == 'TARGET_HIT':
                    target = float(r.get('target_price', 0) or 0)
                    new_profit += (target - entry) / entry
                else:
                    stop = float(r.get('stop_price', 0) or 0)
                    loss = (entry - stop) / entry
                    # لو max_stop_pct أضيق → نخفض الخسارة تقديراً
                    # 🔥 VERIFY-FIX-3: new_value=7% → factor=1.0 (no change);
                    # new_value=3% → factor=3/7≈0.43 (loss reduced ~57%)
                    if param_name == 'max_stop_pct' and new_value < 7.0:
                        stop_reduction = new_value / 7.0
                        loss = loss * stop_reduction
                    new_loss += loss
            
            new_pf = new_profit / new_loss if new_loss > 0 else (999 if new_profit > 0 else 0)
            
            return {
                'current_pf': round(current_pf, 4),
                'new_pf': round(new_pf, 4),
                'current_count': len(rows),
                'new_count': len(filtered),
            }
            
        except Exception as e:
            logger.error(f"[ImmediateLearning] backtest error: {e}")
            return None

    def _write_param_immediately(self, param_name: str, value: float, regime: str = 'unknown') -> bool:
        """
        كتابة parameter فوراً في optimizer_params.json.

        🔥 P0-v7-FINAL FIX: بـ يستخدم OPTIMIZER_PARAMS_FILE الموحّد
        (vps-service/config/optimizer_params.json) — نفس المسار اللي maestro
        بـ read منه. قبل كده كان بـ write في <root>/db/ (مسار مختلف) فـ الـ
        learning loop كان مكسور.

        🔥 VERIFY-FIX-1 (atomic + locked): استبدلنا ``open(...,'w') + json.dump``
        المباشرة بـ ``utils.params_io.locked_read_modify_write``. ده بيعمل:
          1. flock على ``.optimizer_params.lock`` (cross-process serialize
             مع optimizer_params_routes.py POST /params)
          2. read current params
          3. modify
          4. atomic write (tempfile + fsync + os.replace) — الـ reader مايشوفش
             ملف نصه مكتوب أبداً
        ده بـ يقفل torn-read → JSONDecodeError → clobber-with-defaults اللي
        كان بـ يمسح التعلم بصمت.

        🔥 VERIFY-FIX-3 (namespace): قبل كده كان الـ param بـ يتكتب في
        ``regime_specific.{regime}.{param}`` — والمايسترو بـ read الـ top-level
        keys بس (``min_conviction``, ``max_stop_pct``, ``min_rr_ratio``, ...).
        النتيجة: التعلم كان بـ يتكتب في مكان ما حدش بـ يقرأه. دلوقتي بنـ write
        الـ param في الـ **top-level** دايماً (ده اللي المايسترو بـ readه)،
        وبنـ keep الـ regime + timestamp في ``learning_audit`` sub-dict للفحص.

        Returns:
            bool: True لو نجح
        """
        params_file = OPTIMIZER_PARAMS_FILE
        ts = datetime.now().isoformat()

        # VALIDATE: الـ param_name لازم يكون واحد من الـ top-level keys اللي
        # المايسترو بـ readها. لو حد بـ call ده باسم غلط → log + skip (defense).
        _VALID_TOPLEVEL_KEYS = {
            'min_conviction', 'min_rr_ratio', 'max_stop_pct', 'min_target_pct',
            'min_target_pct_non_momentum', 'max_stop_pct_explosive',
            'explosive_vol_pct_threshold', 'explosive_target_atr_mult',
            'skip_bear_regime', 'skip_bull_regime', 'use_adx_filter',
            'adx_threshold', 'use_volume_spike', 'volume_spike_mult',
            'max_holding_days', 'min_technical_confluence',
        }
        if param_name not in _VALID_TOPLEVEL_KEYS:
            logger.error(
                f"[ImmediateLearning] رفض كتابة param '{param_name}' — ليس top-level key "
                f"يقرأه المايسترو. الـ keys المسموح: {sorted(_VALID_TOPLEVEL_KEYS)}"
            )
            return False

        def _updater(current):
            params = dict(current) if isinstance(current, dict) else {}

            # 1) اكتب في الـ TOP-LEVEL — ده اللي المايسترو بـ readه فعلياً
            params[param_name] = value

            # 2) سجّل audit trail في learning_audit (للفحص، مش للـ runtime)
            if 'learning_audit' not in params or not isinstance(params.get('learning_audit'), dict):
                params['learning_audit'] = {}
            params['learning_audit'][param_name] = {
                'value': value,
                'regime': regime or 'unknown',
                'updated_at': ts,
                'source': 'immediate_learning',
            }
            return params

        ok = _io_locked_rmw(params_file, _updater)
        if ok:
            logger.info(
                f"[ImmediateLearning] ✅ كتبنا {param_name}={value} في optimizer_params.json "
                f"(TOP-LEVEL, regime={regime}) — المايسترو هيقرأها في الدورة الجاية"
            )
        else:
            logger.error(f"[ImmediateLearning] فشل كتابة params: locked_rmw returned False")
        return ok

    def run(self, period_days: int = 7) -> PerformanceReport:
        """Run the learning engine"""
        logger.info(f"[LearningEngine] Starting analysis for last {period_days} days")

        # بنستخدم 90 يوم كنافذة أساسية للتعلم الأسبوعي
        analysis_days = 90

        # Get closed predictions
        predictions = self.get_closed_predictions(days=analysis_days)
        logger.info(f"[LearningEngine] Found {len(predictions)} closed predictions")

        if not predictions:
            logger.info("[LearningEngine] No closed predictions to analyze")
            return PerformanceReport(
                period_start=(datetime.now() - timedelta(days=period_days)).strftime('%Y-%m-%d'),
                period_end=datetime.now().strftime('%Y-%m-%d')
            )

        # تحليلات أساسية موجودة
        all_lessons = []
        all_lessons.extend(self.analyze_signal_accuracy(predictions))
        all_lessons.extend(self.analyze_by_market(predictions))
        all_lessons.extend(self.analyze_by_confidence(predictions))

        # تحليل حسب النظام السعري (جديد)
        regime_lessons = self._analyze_by_regime(predictions)
        all_lessons.extend(regime_lessons)

        # تحليل حسب الأنماط الفنية (جديد)
        pattern_lessons = self._analyze_by_pattern(predictions)
        all_lessons.extend(pattern_lessons)

        # توليد توصيات تعديل الأوزان (جديد)
        weight_recs = self._generate_weight_recommendations(regime_lessons, pattern_lessons)

        # Calculate performance
        report = self.calculate_performance(predictions, period_days)
        report.lessons = all_lessons
        report.regime_lessons = regime_lessons
        report.pattern_lessons = pattern_lessons
        report.weight_recommendations = weight_recs

        # Save
        self.save_lessons(all_lessons)
        self.save_performance(report)

        logger.info(f"[LearningEngine] Done: {len(all_lessons)} lessons, win_rate={report.win_rate}%, profit_factor={report.profit_factor}")
        return report


def trigger_immediate_learning(ticker: str = '', regime: str = 'unknown') -> dict:
    """
    نقطة الدخول العامة للـ immediate learning.
    بنستدعيها من الـ daily_closer أو من أي API endpoint.
    
    Usage:
        from jobs.learning_engine import trigger_immediate_learning
        result = trigger_immediate_learning(ticker='COMI', regime='bear')
    """
    engine = LearningEngine()
    return engine.on_prediction_closed(ticker=ticker, regime=regime)


def main():
    """Run the learning engine standalone"""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    engine = LearningEngine()
    report = engine.run(period_days=30)

    print(f"\n🧠 Learning Engine Results:")
    print(f"  Period: {report.period_start} to {report.period_end}")
    print(f"  Total Predictions: {report.total_predictions}")
    print(f"  Win Rate: {report.win_rate}%")
    print(f"  Avg Return: {report.avg_return}%")
    print(f"  Profit Factor: {report.profit_factor}")
    print(f"  Best Ticker: {report.best_ticker}")
    print(f"  Worst Ticker: {report.worst_ticker}")
    print(f"  Lessons Learned: {len(report.lessons)}")
    for lesson in report.lessons[:5]:
        print(f"    - {lesson.condition}: {lesson.outcome} ({lesson.failure_rate}% failure, {lesson.recommendation})")


if __name__ == '__main__':
    main()
