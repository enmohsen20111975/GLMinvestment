# P1.6 (REFACTORING_REPORT §12): سُجّل الـ blueprint ده في lightweight_server.py
# بعد ما كان marked DEPRECATED بالغلط. الـ admin frontend بيستخدمه في
# src/components/admin/OptimizerParamsPanel.tsx (4 calls على /api/prediction-optimizer/*).
# `prediction_optimizer.py` (the analyzer) منفصل عن الـ route — الـ route بـ يستورده
# بس عند الحاجة (lazy import في line 263)، فأي تعديل للـ analyzer مش هيتأثر بالـ route.
#!/usr/bin/env python3
"""
Prediction Optimizer Parameters API
====================================
يسمح بقراءة وتحديث معاملات PredictionOptimizer من لوحة التحكم.
GET  /api/prediction-optimizer/params        → قراءة المعاملات الحالية
POST /api/prediction-optimizer/params        → تحديث المعاملات
POST /api/prediction-optimizer/params/reset  → استعادة الافتراضي
POST /api/prediction-optimizer/backtest      → باك-تست سريع
"""

from __future__ import annotations

import os
import json
import logging
from pathlib import Path
from flask import Blueprint, jsonify, request

import sys
if str(Path(__file__).resolve().parent.parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils.params_io import (
    read_params as _io_read_params,
    write_params_atomic as _io_write_params,
    locked_read_modify_write as _io_locked_rmw,
)

logger = logging.getLogger(__name__)

optimizer_params_bp = Blueprint('prediction_optimizer_params', __name__, url_prefix='/api/prediction-optimizer')

# _PROJECT_ROOT = parent of vps-service (used for sys.path in backtest route)
# _VPS_ROOT    = vps-service dir itself (where config/ actually lives)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_VPS_ROOT = Path(__file__).resolve().parent.parent

# 🔥 P0-v7-FINAL FIX: PARAMS_FILE لازم يشير لـ vps-service/config/optimizer_params.json
# (مش <project_root>/config/ اللي ملوش وجود). ده المسار اللي بـ يـ check عليه
# اختبار المالك + اللي بـ يـ read منه Maestro + اللي بـ يـ write فيه LearningEngine.
# قبل الإصلاح ده، كان فيه 3-way path mismatch:
#   - routes.py كان بـ read من <root>/config/           (غلط — مجلد مش موجود)
#   - learning_engine.py كان بـ write في <root>/db/      (غلط — مسار مختلف)
#   - اختبار المالك بـ check في vps-service/config/      (الصح)
# دلوقتي الاتنين بيـ read/write من نفس المسار الموحّد.
PARAMS_FILE = _VPS_ROOT / 'config' / 'optimizer_params.json'

# 🔥 P0-v7-FINAL: Default parameters — عدّلناها لتطابق طلب المالك (aggressive).
# المالك اشتكى من "مكاسب هابلة" — الحل:
#   - min_target_pct=10.0  → لا أهداف أقل من 10% (كانت 4% → مكاسب تافهة)
#   - min_rr_ratio=1.5     → لا صفقة بدون R:R ≥ 1.5
#   - max_stop_pct=7.0     → وقف خسارة أضيق (كان 8%)
#   - min_conviction=65    → جودة على الكمية (كان 5 → بـ يـ accept كل حاجة)
#   - skip_bear_regime=True → ممنوع الدخول في bear market
# الـ LearningEngine بـ يـ override القيم دي تلقائياً من نتائج الـ backtest.
DEFAULT_PARAMS = {
    'min_conviction': 65,
    'min_rr_ratio': 1.8,
    'max_stop_pct': 9.0,
    'min_target_pct': 10.0,
    'min_target_pct_non_momentum': 3.0,
    'max_stop_pct_explosive': 15.0,
    'explosive_vol_pct_threshold': 80.0,
    'explosive_target_atr_mult': 5.0,
    'skip_bear_regime': True,
    'skip_bull_regime': False,
    'use_adx_filter': True,
    'adx_threshold': 20.0,
    'use_volume_spike': True,
    'volume_spike_mult': 1.5,
    'max_holding_days': 20,
    'min_technical_confluence': 2,
}

# Runtime state (loaded from file on startup)
_runtime_params = None


def _load_params():
    """تحميل المعاملات من ملف أو استخدام الافتراضية.

    🔥 P0-v7-FINAL: مُحصَّن ضد FileNotFoundError + JSONDecodeError.
    لو الملف ناقص/تالف → ارجع DEFAULT_PARAMS من غير ما تـ crash.

    🔥 VERIFY-FIX-1 (atomic I/O): قراءة عبر utils.params_io.read_params.
    أهم تغيير: لو الملف تالف (JSONDecodeError) **مش بن overwriteه** بالـ
    defaults (ده كان بـ يمسح التعلم الأسبوعي بصمت لو الـ reader وقع في
    نص كتابة الـ writer). دلوقتي بنـ fallback لـ DEFAULT_PARAMS في
    الذاكرة بس، ونسيب الملف زي ما هو عشان أي حد يـ inspectه.
    Maestro + BackgroundAnalyzer بـ يستدعوا get_optimizer_params() في
    كل دورة تحليل، فـ لازم ترجع dict صالح دايماً (مش raise).
    """
    global _runtime_params
    if _runtime_params is not None:
        return _runtime_params

    # ابدأ دايماً بـ DEFAULT_PARAMS كـ base (safe fallback)
    _runtime_params = dict(DEFAULT_PARAMS)

    file_params = _io_read_params(PARAMS_FILE)
    if file_params is None:
        # ملف ناقص → أنشئه بـ DEFAULT_PARAMS (في الحالة دي بس، مش في الـ corrupt)
        if not PARAMS_FILE.exists():
            logger.info(f"[OptimizerParams] File missing — creating at {PARAMS_FILE}")
            _io_write_params_atomic(PARAMS_FILE, _runtime_params)
        # لو الملف موجود بس تالف → نسيبه زي ما هو (no clobber) ونـ fallback للذاكرة
        return _runtime_params

    # الملف سليم → يـ override الـ defaults (file = source of truth)
    _runtime_params = {**DEFAULT_PARAMS, **file_params}
    logger.info(f"[OptimizerParams] Loaded from {PARAMS_FILE}")
    return _runtime_params


def _save_params(params):
    """حفظ المعاملات في ملف (atomic + cross-process-locked).

    🔥 VERIFY-FIX-1: استبدلنا ``open(...,'w') + json.dump`` المباشرة بـ
    ``utils.params_io.write_params_atomic`` (tempfile + fsync + os.replace).
    ده بيمنع torn reads من الـ reader (المفروض مايشوفش ملف نصه مكتوب),
    والـ flock بيـ serialize مع الـ learning_engine writer.
    """
    global _runtime_params
    _runtime_params = params
    ok = _io_write_params_atomic(PARAMS_FILE, params)
    if ok:
        logger.info(f"[OptimizerParams] Saved to {PARAMS_FILE}")
    return ok


def get_optimizer_params():
    """الحصول على المعاملات الحالية (للاستخدام من PredictionOptimizer).

    🔥 P0-v7-FINAL: مضمون إنها ترجع dict صالح — ما بـ raiseش أبداً.
    Maestro + BackgroundAnalyzer بـ يعتمدوا على ده في كل دورة تحليل.
    """
    try:
        params = _load_params()
        if not isinstance(params, dict) or not params:
            return dict(DEFAULT_PARAMS)
        return params
    except Exception as e:
        logger.error(f"[OptimizerParams] get_optimizer_params fallback: {e}")
        return dict(DEFAULT_PARAMS)


def reload_optimizer_params():
    """P25-LIVING-ENGINE: إعادة قراءة optimizer_params.json من الديسك.

    الـ Background Analyzer بيناديها في بداية كل دورة تحليل كاملة عشان
    يلتقط أي تعديلات عملها السكريبت الأسبوعي (weekly_market_adjustment.py)
    أو الأدمن من لوحة التحكم. بدون ده، الـ params بتتبقى cached في الذاكرة
    من أول boot وكل التعلم الأسبوعي ملوش تأثير لحد الـ restart القادم.
    """
    global _runtime_params
    _runtime_params = None
    return _load_params()


def apply_params_to_optimizer(optimizer):
    """تطبيق المعاملات على instance من PredictionOptimizer."""
    params = _load_params()
    optimizer.min_conviction = params.get('min_conviction', 5)
    optimizer.min_rr_ratio = params.get('min_rr_ratio', 1.8)
    optimizer.max_stop_pct = params.get('max_stop_pct', 3.0)
    optimizer.min_target_pct = params.get('min_target_pct', 5.0)
    optimizer.skip_bear_regime = params.get('skip_bear_regime', True)
    optimizer.skip_bull_regime = params.get('skip_bull_regime', False)
    optimizer.use_adx_filter = params.get('use_adx_filter', True)
    optimizer.adx_threshold = params.get('adx_threshold', 20.0)
    optimizer.max_holding_days = params.get('max_holding_days', 20)
    return optimizer


@optimizer_params_bp.route('/params', methods=['GET'])
def get_params():
    """قراءة المعاملات الحالية."""
    params = _load_params()
    return jsonify({
        'success': True,
        'params': params,
        'defaults': DEFAULT_PARAMS,
    })


@optimizer_params_bp.route('/params', methods=['POST'])
def update_params():
    """تحديث المعاملات."""
    try:
        data = request.get_json() or {}

        # Validate + coerce types BEFORE entering the lock (cheap, no I/O).
        updated = {}
        for key, value in data.items():
            if key not in DEFAULT_PARAMS:
                continue
            default_type = type(DEFAULT_PARAMS[key])
            if default_type == bool:
                updated[key] = bool(value)
            elif default_type == int:
                updated[key] = int(value)
            elif default_type == float:
                updated[key] = float(value)
            else:
                updated[key] = value

        # 🔥 VERIFY-FIX-1: locked read-modify-write so a concurrent write from
        # the learning_engine (or another POST) can't be lost. The lock is held
        # across read + merge + atomic-write.
        def _merge_and_write(current):
            base = dict(DEFAULT_PARAMS)
            if current and isinstance(current, dict):
                base = {**DEFAULT_PARAMS, **current}
            new_params = {**base, **updated}
            return new_params

        ok = _io_locked_rmw(PARAMS_FILE, _merge_and_write)
        # Refresh the in-memory cache so the next get_optimizer_params() sees
        # the new values immediately.
        global _runtime_params
        _runtime_params = None
        new_params = _load_params()

        if not ok:
            return jsonify({
                'success': False,
                'error': 'فشل الكتابة الذرية للملف',
            }), 500

        return jsonify({
            'success': True,
            'message': 'تم تحديث المعاملات بنجاح',
            'params': new_params,
            'updated_keys': list(updated.keys()),
        })
    except Exception as e:
        logger.error(f"[OptimizerParams] Update error: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
        }), 500


@optimizer_params_bp.route('/params/reset', methods=['POST'])
def reset_params():
    """إعادة المعاملات للقيم الافتراضية."""
    global _runtime_params
    _runtime_params = dict(DEFAULT_PARAMS)
    _save_params(_runtime_params)
    return jsonify({
        'success': True,
        'message': 'تم إعادة التعيين',
        'params': _runtime_params,
    })


@optimizer_params_bp.route('/backtest', methods=['POST'])
def run_quick_backtest():
    """تشغيل backtest سريع بالمعاملات الحالية."""
    try:
        import sqlite3
        import sys
        sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))
        from analyzers.prediction_optimizer import PredictionOptimizer
        
        params = _load_params()
        engine = PredictionOptimizer()
        engine = apply_params_to_optimizer(engine)
        
        PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        
        stocks = conn.execute("""
            SELECT ticker, COUNT(*) as cnt FROM price_history
            GROUP BY ticker HAVING cnt >= 180
            ORDER BY cnt DESC LIMIT 100
        """).fetchall()
        
        all_returns = []
        for ticker, _ in stocks:
            rows = conn.execute("""
                SELECT close_price, high_price, low_price, volume
                FROM price_history WHERE ticker = ? AND close_price > 0
                ORDER BY date ASC
            """, (ticker,)).fetchall()
            if len(rows) < 180:
                continue
            prices = [r[0] for r in rows]
            highs = [r[1] or r[0] for r in rows]
            lows = [r[2] or r[0] for r in rows]
            volumes = [r[3] or 0 for r in rows]
            
            for sim_day in range(60):
                entry_idx = len(prices) - 80 + sim_day
                if entry_idx < 100 or entry_idx + 20 >= len(prices):
                    continue
                hp = prices[:entry_idx+1]
                hh = highs[:entry_idx+1]
                hl = lows[:entry_idx+1]
                hv = volumes[:entry_idx+1]
                fp = prices[entry_idx+1:]
                
                result = engine.analyze(hp, hh, hl, hv)
                if result.signal == 'HOLD':
                    continue
                if params.get('skip_bear_regime') and result.regime == 'bear':
                    continue
                if params.get('skip_bull_regime') and result.regime == 'bull':
                    continue
                
                # Simulate
                for i, price in enumerate(fp[:params.get('max_holding_days', 20)]):
                    if result.signal == 'BUY':
                        if price >= result.target:
                            all_returns.append((result.target - result.entry) / result.entry * 100)
                            break
                        if price <= result.stop:
                            all_returns.append((result.stop - result.entry) / result.entry * 100)
                            break
                    else:
                        if price <= result.target:
                            all_returns.append((result.entry - result.target) / result.entry * 100)
                            break
                        if price >= result.stop:
                            all_returns.append((result.entry - result.stop) / result.entry * 100)
                            break
                else:
                    last = fp[min(params.get('max_holding_days', 20) - 1, len(fp) - 1)]
                    if result.signal == 'BUY':
                        all_returns.append((last - result.entry) / result.entry * 100)
                    else:
                        all_returns.append((result.entry - last) / result.entry * 100)
        
        conn.close()
        
        if not all_returns:
            return jsonify({'success': True, 'data': {'trades': 0, 'message': 'لا توجد صفقات'}})
        
        total = len(all_returns)
        wins = sum(1 for r in all_returns if r > 0)
        wr = wins / total * 100
        avg_ret = sum(all_returns) / total
        gp = sum(r for r in all_returns if r > 0)
        gl = abs(sum(r for r in all_returns if r < 0))
        pf = gp / gl if gl > 0 else 0
        
        return jsonify({
            'success': True,
            'data': {
                'trades': total,
                'win_rate': round(wr, 1),
                'profit_factor': round(pf, 2),
                'avg_return': round(avg_ret, 2),
                'stocks_tested': len(stocks),
            },
        })
    except Exception as e:
        logger.error(f"[OptimizerParams] Backtest error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
