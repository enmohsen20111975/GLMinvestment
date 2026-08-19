# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Hunter Routes - الصياد V2.2.1
==============================
نظام كشف أسهم المخاطر العالية (Multi-Baggers) — 3 مراحل:
  Screener → Expert Eye → Boss Pick

الـ endpoints القديمة (/screener, /stats) اتشالت — استبدلت بـ /daily-picks.

Feature 3: كل توصية بتتحفظ تلقائياً في جدول hunter_pick_tracking
عشان نتابع نسبة نجاح الصياد عبر الزمن.

Feature 4: زر "نسخ" و"نشر" على كل توقع — نشر فوري على تيليجرام.

Endpoints:
- GET  /api/hunter/daily-picks   — الصياد V2.2.1 (entry/stop/target/R-R/narrative/personas)
- POST /api/hunter/publish-pick   — نشر توقع على قناة تيليجرام (Feature 4)
"""

import os
import sys as _sys
import asyncio
import threading
import time
from datetime import datetime
from pathlib import Path as _Path
from flask import Blueprint, request, jsonify

# Create blueprint
hunter_bp = Blueprint('hunter', __name__, url_prefix='/api/hunter')

# ============================================================
# V2.2.1: Hunting Engine — 3 stages (Screener → Expert Eye → Boss Pick)
# ============================================================

_vps_root = _Path(__file__).parent.parent
if str(_vps_root) not in _sys.path:
    _sys.path.insert(0, str(_vps_root))

try:
    from analyzers.hunting_engine import run_hunting_pipeline
    HUNTING_ENGINE_V2_AVAILABLE = True
    _HUNTING_V2_ERROR = None
except Exception as _e:
    HUNTING_ENGINE_V2_AVAILABLE = False
    _HUNTING_V2_ERROR = str(_e)

# Feature 3: استيراد دالة الحفظ من prediction_tracking_routes
# (بدون ما نكسر الـ API لو الحفظ فشل)
try:
    from api.prediction_tracking_routes import save_pick as _save_pick
    _SAVE_PICK_AVAILABLE = True
except Exception as _e:  # pragma: no cover
    _SAVE_PICK_AVAILABLE = False
    _SAVE_PICK_ERROR = str(_e)


def _auto_save_picks(picks, market):
    """يحفظ كل توصية في hunter_pick_tracking (wrapped في try/except).

    أي خطأ في الحفظ لا يكسر الـ API الأساسي.
    """
    if not _SAVE_PICK_AVAILABLE or not picks:
        return {'saved': 0, 'skipped': 0, 'errors': 0}
    saved = 0
    skipped = 0
    errors = 0
    for pick in picks:
        try:
            res = _save_pick({
                'ticker': pick.get('ticker', ''),
                'market': pick.get('market', market),
                'entry_price': pick.get('entry', pick.get('entry_price')),
                'stop_loss': pick.get('stop_loss'),
                'target_price': pick.get('target', pick.get('target_price')),
                'risk_reward': pick.get('risk_reward'),
                'narrative': pick.get('narrative', []),
                'personas': pick.get('personas', {}),
            })
            if res.get('saved'):
                saved += 1
            else:
                # duplicate_today or invalid_fields → skip silently
                skipped += 1
        except Exception:
            errors += 1
    return {'saved': saved, 'skipped': skipped, 'errors': errors}


# ============================================================
# V2.3: Auto-refresh scheduler — كل 30 دقيقة
# ============================================================
# محرك التحديثات يشتغل في background thread ويحدّث الـ cache لكل الأسواق.
# الـ /daily-picks endpoint يقرأ من الـ cache (سريع) مش يشغل pipeline كل request.

_REFRESH_INTERVAL_SECONDS = 30 * 60  # 30 دقيقة
_ALL_MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE']

# module-level cache: {market: {'result': {...}, 'timestamp': ISO, 'age_seconds': int}}
_picks_cache: dict = {}
_cache_lock = threading.Lock()
_scheduler_started = False
_scheduler_thread = None
_last_full_refresh = None


def _run_pipeline_for_market(market: str) -> dict:
    """يشغل الـ pipeline ويرجع الـ result + tracking info."""
    result = run_hunting_pipeline(market)
    # حفظ التوصيات في tracking table
    save_summary = {'saved': 0, 'skipped': 0, 'errors': 0}
    try:
        save_summary = _auto_save_picks(result.get('picks', []), result.get('market', market))
    except Exception as _e:
        save_summary = {'saved': 0, 'skipped': 0, 'errors': 1, 'error': str(_e)}
    result['tracking'] = save_summary
    return result


def _refresh_all_markets():
    """يشغل الـ pipeline لكل الأسواق ويحدّث الـ cache."""
    global _last_full_refresh
    for market in _ALL_MARKETS:
        try:
            t0 = time.time()
            result = _run_pipeline_for_market(market)
            with _cache_lock:
                _picks_cache[market] = {
                    'result': result,
                    'timestamp': datetime.now().isoformat(),
                    'elapsed_ms': result.get('elapsed_ms', 0),
                }
            elapsed = time.time() - t0
            print(f"[hunter-scheduler] ✓ {market}: {len(result.get('picks', []))} picks in {elapsed:.1f}s")
        except Exception as _e:
            print(f"[hunter-scheduler] ✗ {market} failed: {_e}")
    _last_full_refresh = datetime.now().isoformat()
    print(f"[hunter-scheduler] Full refresh completed at {_last_full_refresh}")


def _scheduler_loop():
    """الـ background thread loop — كل 30 دقيقة يحدّث كل الأسواق."""
    # أول تشغيل فوري
    try:
        _refresh_all_markets()
    except Exception as _e:
        print(f"[hunter-scheduler] Initial refresh failed: {_e}")
    while True:
        time.sleep(_REFRESH_INTERVAL_SECONDS)
        try:
            _refresh_all_markets()
        except Exception as _e:
            print(f"[hunter-scheduler] Refresh cycle failed: {_e}")


def _ensure_scheduler_started():
    """يبدأ الـ scheduler thread مرة واحدة فقط (lazy start)."""
    global _scheduler_started, _scheduler_thread
    if _scheduler_started:
        return
    with _cache_lock:
        if _scheduler_started:
            return
        _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name='hunter-scheduler')
        _scheduler_thread.start()
        _scheduler_started = True
        print(f"[hunter-scheduler] ✓ Started (refresh every {_REFRESH_INTERVAL_SECONDS // 60} min)")


def _get_cached_picks(market: str):
    """يرجع الـ cached picks للسوق، أو None لو مفيش cache."""
    with _cache_lock:
        return _picks_cache.get(market)


def _force_refresh_market(market: str):
    """يجبر تحديث سوق واحد (للأدمن)."""
    result = _run_pipeline_for_market(market)
    with _cache_lock:
        _picks_cache[market] = {
            'result': result,
            'timestamp': datetime.now().isoformat(),
            'elapsed_ms': result.get('elapsed_ms', 0),
        }
    return result


@hunter_bp.route('/daily-picks', methods=['GET'])
def daily_picks():
    """
    الصياد V2.3 — 3 مراحل (Screener → Expert Eye → Boss Pick).
    بيرجع أحسن 7 فرص بـ entry/stop/target/R-R/narrative/personas.

    V2.3: يقرأ من الـ cache اللي بيتحدّث كل 30 دقيقة من الـ scheduler.
    لو الـ cache فاضي (أول مرة)، يشغل pipeline فوراً ويبدأ الـ scheduler.

    Feature 3: كل توصية بتتحفظ تلقائياً في hunter_pick_tracking.

    Query params:
    - market: EGX, TADAWUL, KSE, QSE, CRYPTO (default: EGX)
    - force_refresh: 1 = يجبر تحديث السوق ده (للأدمن)
    """
    if not HUNTING_ENGINE_V2_AVAILABLE:
        return jsonify({
            "success": False,
            "error": f"Hunting Engine V2 not available: {_HUNTING_V2_ERROR}",
            "picks": []
        }), 500

    try:
        market = request.args.get('market', 'EGX')
        force = request.args.get('force_refresh', '0') == '1'

        # نبدأ الـ scheduler لو مش شغال (lazy start)
        try:
            _ensure_scheduler_started()
        except Exception as _sched_err:
            print(f"[hunter] Scheduler start failed: {_sched_err}")

        # لو force_refresh، نشغل pipeline فوراً ونحدّث الـ cache
        if force:
            result = _force_refresh_market(market)
            return jsonify({
                "success": True,
                "date": result['date'],
                "timestamp": result['timestamp'],
                "market": result['market'],
                "elapsed_ms": result['elapsed_ms'],
                "stage1_count": result['stage1_count'],
                "stage2_count": result['stage2_count'],
                "stage3_count": result['stage3_count'],
                "meta": result['meta'],
                "picks": result['picks'],
                "tracking": result.get('tracking', {}),
                "cached": False,
                "cache_timestamp": None,
            })

        # نقرأ من الـ cache
        cached = _get_cached_picks(market)
        if cached:
            result = cached['result']
            return jsonify({
                "success": True,
                "date": result['date'],
                "timestamp": result['timestamp'],
                "market": result['market'],
                "elapsed_ms": result['elapsed_ms'],
                "stage1_count": result['stage1_count'],
                "stage2_count": result['stage2_count'],
                "stage3_count": result['stage3_count'],
                "meta": result['meta'],
                "picks": result['picks'],
                "tracking": result.get('tracking', {}),
                "cached": True,
                "cache_timestamp": cached['timestamp'],
            })

        # fallback: لو الـ cache فاضي (scheduler لسه ما اشتغلش)، شغّل pipeline فوراً
        result = _run_pipeline_for_market(market)
        # حدّث الـ cache
        with _cache_lock:
            _picks_cache[market] = {
                'result': result,
                'timestamp': datetime.now().isoformat(),
                'elapsed_ms': result.get('elapsed_ms', 0),
            }

        return jsonify({
            "success": True,
            "date": result['date'],
            "timestamp": result['timestamp'],
            "market": result['market'],
            "elapsed_ms": result['elapsed_ms'],
            "stage1_count": result['stage1_count'],
            "stage2_count": result['stage2_count'],
            "stage3_count": result['stage3_count'],
            "meta": result['meta'],
            "picks": result['picks'],
            "tracking": result.get('tracking', {}),
            "cached": False,
            "cache_timestamp": None,
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "picks": []
        }), 500


@hunter_bp.route('/refresh', methods=['POST'])
def refresh_picks():
    """
    V2.3: يجبر تحديث الـ picks لسوق معين (للأدمن).
    Body: {"market": "EGX"} أو refresh للأسواق كلها لو مفيش body.
    """
    if not HUNTING_ENGINE_V2_AVAILABLE:
        return jsonify({
            "success": False,
            "error": f"Hunting Engine V2 not available: {_HUNTING_V2_ERROR}"
        }), 500

    try:
        data = request.get_json(silent=True) or {}
        market = data.get('market')
        if market:
            result = _force_refresh_market(market)
            return jsonify({
                "success": True,
                "market": market,
                "picks_count": len(result.get('picks', [])),
                "timestamp": _picks_cache.get(market, {}).get('timestamp'),
            })
        else:
            # refresh كله
            _refresh_all_markets()
            return jsonify({
                "success": True,
                "markets": {m: len(_picks_cache.get(m, {}).get('result', {}).get('picks', [])) for m in _ALL_MARKETS},
                "last_full_refresh": _last_full_refresh,
            })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@hunter_bp.route('/cache-status', methods=['GET'])
def cache_status():
    """V2.3: حالة الـ cache لكل الأسواق — آخر تحديث + عدد picks."""
    try:
        with _cache_lock:
            status = {}
            for m in _ALL_MARKETS:
                cached = _picks_cache.get(m)
                if cached:
                    status[m] = {
                        'cached': True,
                        'picks_count': len(cached['result'].get('picks', [])),
                        'timestamp': cached['timestamp'],
                        'elapsed_ms': cached.get('elapsed_ms', 0),
                    }
                else:
                    status[m] = {'cached': False, 'picks_count': 0}
        return jsonify({
            "success": True,
            "scheduler_started": _scheduler_started,
            "refresh_interval_minutes": _REFRESH_INTERVAL_SECONDS // 60,
            "last_full_refresh": _last_full_refresh,
            "markets": status,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================
# Feature 4: Publish Pick to Telegram (نسخ & نشر)
# ============================================================

# Lazy load auto poster (مش نفس الـ instance بتاع telegram_routes — بس نفس
# الـ singleton داخل telegram.auto_poster لأنه module-level).
_auto_poster = None

def _get_auto_poster():
    global _auto_poster
    if _auto_poster is None:
        try:
            from telegram.auto_poster import auto_poster as ap
            _auto_poster = ap
        except ImportError as _e:
            print(f"[hunter] Auto poster not available: {_e}")
    return _auto_poster


# Event loop دائم عشان telethon يشتغل صح من ضمن Flask threads
_bg_loop = None
_bg_thread = None

def _get_bg_loop():
    global _bg_loop, _bg_thread
    if _bg_loop is None or _bg_loop.is_closed():
        _bg_loop = asyncio.new_event_loop()

        def _run():
            asyncio.set_event_loop(_bg_loop)
            _bg_loop.run_forever()

        _bg_thread = threading.Thread(target=_run, daemon=True)
        _bg_thread.start()
    return _bg_loop


def _run_async(coro, timeout=30):
    """تشغيل coroutine في الـ event loop الدائم."""
    loop = _get_bg_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


# خريطة أكواد الأسواق لأسمائها العربية
_MARKET_NAMES_AR = {
    'EGX': 'البورصة المصرية',
    'TADAWUL': 'السوق السعودي',
    'KSE': 'بورصة الكويت',
    'QSE': 'بورصة قطر',
    'CRYPTO': 'العملات الرقمية',
}

_SEP = '━━━━━━━━━━━━━━━━━━━━━'


def _format_pick_for_telegram(pick):
    """
    تنسيق توقع الصياد كنص عربي للنشر على تيليجرام.
    مطابق لتنسيق الـ frontend (src/lib/pick-formatter.ts).
    """
    market_code = pick.get('market') or 'EGX'
    market_name = _MARKET_NAMES_AR.get(market_code, market_code)

    ticker = pick.get('ticker', '') or ''
    name_ar = pick.get('name_ar') or pick.get('name') or ''

    def _fmt(v, digits=2):
        if v is None:
            return '—'
        try:
            return f'{float(v):.{digits}f}'
        except (TypeError, ValueError):
            return '—'

    # الدخول: نُفضّل entry_trigger (نص) وإلا entry (رقم)
    entry_trigger = pick.get('entry_trigger')
    if entry_trigger:
        entry_display = str(entry_trigger)
    elif pick.get('entry') is not None:
        entry_display = _fmt(pick.get('entry'))
    else:
        entry_display = '—'

    stop_loss = pick.get('stop_loss')
    stop_pct = pick.get('stop_pct')
    target = pick.get('target')
    target_pct = pick.get('target_pct')
    risk_reward = pick.get('risk_reward')
    timeframe = pick.get('timeframe')
    reason = pick.get('reason') or ''
    narrative = pick.get('narrative') or []
    if not isinstance(narrative, list):
        narrative = [str(narrative)]
    narrative = [str(l).strip() for l in narrative if l and str(l).strip()]

    lines = []
    lines.append(f'🚀 توقعات الصياد — {market_name}')
    lines.append(_SEP)
    lines.append(f'📊 {ticker}{(" — " + name_ar) if name_ar else ""}')
    lines.append(f'💰 السعر: {_fmt(pick.get("price"))} | الدخول: {entry_display}')
    lines.append(f'🛑 وقف الخسارة: {_fmt(stop_loss)} ({_fmt(stop_pct, 1)}%)')
    lines.append(f'🎯 الهدف: {_fmt(target)} ({_fmt(target_pct, 1)}%)')
    lines.append(f'⚖️ العائد/المخاطرة: {_fmt(risk_reward, 1)}')
    if timeframe:
        lines.append(f'⏱️ الإطار الزمني: {timeframe}')
    lines.append(_SEP)

    if reason:
        lines.append(f'📝 {reason}')

    if narrative:
        if reason:
            lines.append('')
        lines.append('\n'.join(narrative))

    lines.append(_SEP)
    lines.append('🔗 دليل الاستثمار')

    return '\n'.join(lines)


@hunter_bp.route('/publish-pick', methods=['POST'])
def publish_pick():
    """
    Feature 4 — نشر توقع الصياد على قناة تيليجرام (@Arabian_investment_guide).

    Body:
    {
        "ticker": "EGTS",
        "name_ar": "المصرية للمنتجعات السياحية",
        "market": "EGX",
        "price": 18.23,
        "entry": 18.23,
        "stop_loss": 17.34,
        "target": 21.41,
        "risk_reward": 3.6,
        "stop_pct": 4.9,
        "target_pct": 17.4,
        "timeframe": "3-6 أسابيع",
        "reason": "فرصة صياد",
        "narrative": ["السهم عند الدعم"],
        "personas": {"hunter": 35}
    }

    Returns:
        {"success": true, "message": "تم النشر", "message_id": 123}
        أو {"success": false, "error": "..."}
    """
    data = request.get_json(silent=True) or {}

    if not data.get('ticker'):
        return jsonify({
            "success": False,
            "error": "ticker مطلوب"
        }), 400

    poster = _get_auto_poster()
    if poster is None:
        return jsonify({
            "success": False,
            "error": "خدمة تيليجرام غير متاحة (telethon غير مثبّت)"
        }), 503

    # تنسيق النص
    try:
        text = _format_pick_for_telegram(data)
    except Exception as _fe:
        return jsonify({
            "success": False,
            "error": f"فشل تنسيق النص: {_fe}"
        }), 500

    # حد أقصى لرسالة تيليجرام ≈ 4096 حرف — نقصّ النص لو زاد
    if len(text) > 4000:
        text = text[:3990] + '\n…'

    # الإرسال (نص عادي بدون markdown عشان نتجنب أخطاء الـ parsing مع
    # الرموز الخاصة في الـ narrative)
    try:
        result = _run_async(poster.send_message(text, parse_mode=None), timeout=30)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"فشل الاتصال بتيليجرام: {e}"
        }), 500

    if not result.get('success'):
        return jsonify({
            "success": False,
            "error": result.get('error', 'فشل غير معروف')
        }), 503

    return jsonify({
        "success": True,
        "message": "تم النشر",
        "message_id": result.get('message_id'),
        "date": result.get('date'),
    })
