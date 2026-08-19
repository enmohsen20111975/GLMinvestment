# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Performance Dashboard API — لوحة أداء التوقعات
==================================================
يقدم إحصائيات شاملة عن أداء التوقعات:
- Win rate إجمالي + حسب الفئة
- Profit factor + avg return
- أداء حسب القطاع / البرسونا / الـ regime
- مقارنة baseline vs improved

Endpoint: GET /api/predictions/performance-dashboard
"""

from __future__ import annotations

import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict

from flask import Blueprint, jsonify, request

performance_bp = Blueprint('performance_dashboard', __name__, url_prefix='/api/predictions')

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))
STOCKS_DB = os.environ.get('STOCKS_DB', str(_PROJECT_ROOT / 'db' / 'stocks.db'))


@dataclass
class PerformanceMetrics:
    """مقاييس الأداء."""
    total_predictions: int = 0
    closed_predictions: int = 0
    pending_predictions: int = 0
    win_rate: float = 0.0
    avg_return: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    avg_holding_days: float = 0.0
    target_hit_count: int = 0
    stopped_count: int = 0
    expired_count: int = 0

    def to_dict(self) -> Dict:
        return asdict(self)


def calculate_metrics(predictions: List[Dict]) -> PerformanceMetrics:
    """حساب المقاييس من قائمة توقعات."""
    metrics = PerformanceMetrics()
    metrics.total_predictions = len(predictions)

    closed = [p for p in predictions if p.get('outcome_date') or p.get('actual_return') is not None]
    metrics.closed_predictions = len(closed)
    metrics.pending_predictions = metrics.total_predictions - len(closed)

    if not closed:
        return metrics

    # Win/loss
    # 🔥 P0-UI FIX: cap على |return| بـ 50% في حساب الـ averages بس (defense-in-depth).
    # حتى لو data_quality='clean'، أي صف بـ |return| > 50% بيتبص عليه على إنه outlier.
    # الـ raw return بيفضل في الـ p dict للأمانة، بس الـ stats بـ تستخدم capped.
    _RETURN_CAP = 50.0
    raw_returns = [p.get('actual_return', 0) or 0 for p in closed]
    capped_returns = [max(-_RETURN_CAP, min(_RETURN_CAP, r)) for r in raw_returns]
    wins = [r for r in capped_returns if r > 0]
    losses = [r for r in capped_returns if r < 0]

    metrics.win_rate = (len(wins) / len(closed) * 100) if closed else 0
    metrics.avg_return = sum(capped_returns) / len(capped_returns) if capped_returns else 0
    metrics.avg_win = sum(wins) / len(wins) if wins else 0
    metrics.avg_loss = sum(losses) / len(losses) if losses else 0

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    metrics.profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0

    holding_days = [p.get('holding_days', 0) or 0 for p in closed if p.get('holding_days')]
    metrics.avg_holding_days = sum(holding_days) / len(holding_days) if holding_days else 0

    # Outcomes
    for p in closed:
        if p.get('hit_target') == 1:
            metrics.target_hit_count += 1
        elif p.get('hit_stop') == 1:
            metrics.stopped_count += 1
        else:
            metrics.expired_count += 1

    return metrics


def get_predictions_from_db(db_path: str, days: int = 30) -> List[Dict]:
    """قراءة التوقعات من قاعدة البيانات."""
    if not os.path.exists(db_path):
        return []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        # 🔥 P0-fix v2: schema-safe data_quality + HARD return cap (defense-in-depth).
        # الـ toxic rows (actual_return ≈ -10814%) بقت تـ exclude من win/loss COUNT
        # + averages عبر HARD cap |actual_return| <= 50 في WHERE نفسها. data_quality
        # clause اختياري (schema-aware) — لو العمود مش موجود الـ route ما بـ يكسرش.
        try:
            _has_dq = 'data_quality' in {
                r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()
            }
        except Exception:
            _has_dq = False
        _dq_sel = ", data_quality" if _has_dq else ""
        _dq_where = " AND (data_quality = 'clean' OR data_quality IS NULL)" if _has_dq else ""
        _cap_where = " AND (actual_return IS NULL OR ABS(actual_return) <= 50)"
        rows = conn.execute(
            f"""
            SELECT ticker, signal, signal_type, prediction_date, entry_price,
                   target_price, stop_loss, master_score, outcome_date,
                   exit_price, actual_return, hit_target, hit_stop, is_correct,
                   holding_days{_dq_sel}
            FROM predictions
            WHERE prediction_date >= ?
              AND (
                    (outcome_date IS NOT NULL{_dq_where}{_cap_where})
                    OR outcome_date IS NULL
                  )
            ORDER BY prediction_date DESC
            """,
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[PerformanceDashboard] Error reading {db_path}: {e}")
        return []
    finally:
        conn.close()


def get_freshness_info(db_path: str) -> Dict:
    """P0-v12: معلومات نضارة البيانات — متى آخر توقع اتعمل + كم واحد today.

    Owner complaint: "الأرقام شبه ثابتة ما تغيرتش مع الأرقام الجديدة".
    الحل: نعرض آخر مرة الـ engine شغّل توقعات + كم توقع اتعمل النهارده،
    عشان المالك يقدر يشوف لو الـ dashboard بـ يتحدث ولا لا.
    """
    info = {
        'latest_prediction_date': None,
        'predictions_today': 0,
        'predictions_last_7d': 0,
        'freshness_seconds': None,
        'freshness_label': 'لا توجد بيانات',
        'is_stale': True,
    }
    if not os.path.exists(db_path):
        return info
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        # أحدث تاريخ توقع
        row = conn.execute(
            "SELECT MAX(prediction_date) as latest FROM predictions"
        ).fetchone()
        latest = row['latest'] if row else None
        if latest:
            info['latest_prediction_date'] = latest
            # حاول نحسب freshness_seconds
            try:
                # prediction_date ممكن يكون 'YYYY-MM-DD' أو ISO datetime
                _dt = None
                for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
                    try:
                        _dt = datetime.strptime(latest[:19] if 'T' in latest or ' ' in latest else latest[:10], fmt)
                        break
                    except ValueError:
                        continue
                if _dt:
                    delta = datetime.now() - _dt
                    info['freshness_seconds'] = int(delta.total_seconds())
                    hrs = delta.total_seconds() / 3600
                    if hrs < 1:
                        info['freshness_label'] = f'منذ {int(delta.total_seconds()/60)} دقيقة'
                    elif hrs < 24:
                        info['freshness_label'] = f'منذ {int(hrs)} ساعة'
                    else:
                        info['freshness_label'] = f'منذ {int(hrs/24)} يوم'
                    info['is_stale'] = hrs > 24  # stale لو آخر توقع من أكتر من يوم
            except Exception:
                info['freshness_label'] = latest
        # عدّ توقعات النهارده
        today = datetime.now().strftime('%Y-%m-%d')
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM predictions WHERE prediction_date >= ?",
            (today,),
        ).fetchone()
        info['predictions_today'] = row['cnt'] if row else 0
        # عدّ آخر 7 أيام
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM predictions WHERE prediction_date >= ?",
            (week_ago,),
        ).fetchone()
        info['predictions_last_7d'] = row['cnt'] if row else 0
    except Exception as e:
        print(f"[PerformanceDashboard] freshness error: {e}")
    finally:
        conn.close()
    return info


@performance_bp.route('/performance-dashboard', methods=['GET'])
def performance_dashboard():
    """
    لوحة أداء التوقعات — إحصائيات شاملة.
    Query params:
    - days: عدد الأيام للتحليل (default 30)
    """
    try:
        days = int(request.args.get('days', 30))

        # P0 fix (يوليو 2026): قراءة من predictions.db بس
        # كان قبل كده بيقرأ من stocks.db + predictions.db → double-counting
        all_preds = get_predictions_from_db(PREDICTIONS_DB, days)

        if not all_preds:
            # P0-v12: حتى لو مفيش توقعات، ارجع freshness (عشان المالك يشوف لو الـ engine شغال)
            freshness = get_freshness_info(PREDICTIONS_DB)
            return jsonify({
                'success': True,
                'data': {
                    'message': 'لا توجد توقعات في الفترة المحددة',
                    'total': 0,
                    'freshness': freshness,
                },
                'period_days': days,
            })

        # المقاييس الإجمالية
        overall = calculate_metrics(all_preds)

        # حسب نوع الإشارة
        by_signal = {}
        for p in all_preds:
            sig = p.get('signal', 'UNKNOWN')
            if sig not in by_signal:
                by_signal[sig] = []
            by_signal[sig].append(p)

        by_signal_metrics = {}
        for sig, preds in by_signal.items():
            by_signal_metrics[sig] = calculate_metrics(preds).to_dict()

        # حسب مدى Score
        by_score = {}
        for p in all_preds:
            score = p.get('master_score', 50) or 50
            bucket = int(score // 10) * 10
            if bucket not in by_score:
                by_score[bucket] = []
            by_score[bucket].append(p)

        by_score_metrics = {}
        for bucket, preds in sorted(by_score.items()):
            by_score_metrics[f'{bucket}-{bucket+9}'] = calculate_metrics(preds).to_dict()

        # مقارنة baseline vs improved (من scripts/)
        baseline_path = _PROJECT_ROOT / 'scripts' / 'baseline_results.json'
        improved_path = _PROJECT_ROOT / 'scripts' / 'improved_results.json'
        comparison = {}
        if baseline_path.exists():
            comparison['baseline'] = json.loads(baseline_path.read_text())
        if improved_path.exists():
            comparison['improved'] = json.loads(improved_path.read_text())

        # P0-v12: معلومات نضارة البيانات (owner complaint: "الأرقام ثابتة")
        freshness = get_freshness_info(PREDICTIONS_DB)

        return jsonify({
            'success': True,
            'data': {
                'overall': overall.to_dict(),
                'by_signal': by_signal_metrics,
                'by_score_range': by_score_metrics,
                'comparison': comparison,
                'period_days': days,
                'generated_at': datetime.now().isoformat(),
                # P0-v12: freshness info عشان المالك يشوف لو الـ dashboard بـ يتحدث
                'freshness': freshness,
            },
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
        }), 500


@performance_bp.route('/performance/summary', methods=['GET'])
def performance_summary():
    """ملخص سريع للأداء — للأفرانتد."""
    try:
        # P0 fix (يوليو 2026): قراءة من predictions.db بس (مش double-counting)
        all_preds = get_predictions_from_db(PREDICTIONS_DB, 30)
        if not all_preds:
            return jsonify({
                'success': True,
                'data': {
                    'win_rate': 0,
                    'total': 0,
                    'message': 'لا توجد بيانات',
                },
            })

        metrics = calculate_metrics(all_preds)
        return jsonify({
            'success': True,
            'data': {
                'win_rate': round(metrics.win_rate, 1),
                'total': metrics.total_predictions,
                'closed': metrics.closed_predictions,
                'avg_return': round(metrics.avg_return, 2),
                'profit_factor': round(metrics.profit_factor, 2),
            },
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    """اختبار ذاتي."""
    print("اختبار لوحة الأداء...")

    # Simulate predictions
    test_preds = [
        {'ticker': 'COMI', 'signal': 'BUY', 'actual_return': 5.2, 'hit_target': 1, 'holding_days': 10},
        {'ticker': 'ETEL', 'signal': 'BUY', 'actual_return': -3.1, 'hit_stop': 1, 'holding_days': 5},
        {'ticker': 'HRHO', 'signal': 'SELL', 'actual_return': 2.8, 'hit_target': 1, 'holding_days': 8},
        {'ticker': 'SWDY', 'signal': 'BUY', 'actual_return': -1.5, 'holding_days': 20},
    ]

    metrics = calculate_metrics(test_preds)
    print(f"Total: {metrics.total_predictions}")
    print(f"Win Rate: {metrics.win_rate:.1f}%")
    print(f"Profit Factor: {metrics.profit_factor:.2f}")
    print(f"Avg Return: {metrics.avg_return:.2f}%")
    print("✅ OK")
