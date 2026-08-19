# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Market Status Image Routes
==========================

Endpoint:
- POST /api/market/publish-status-image
    Body: {image: "data:image/png;base64,...", market: "EGX", caption: "..."}
    1. يفكّ base64 من data URL
    2. يحفظه في ملف مؤقت
    3. يرسله لقناة تليجرام عبر auto_poster.send_photo
    4. يحذف الملف المؤقت

المكوّن معزول عن telegram_routes.py و hunter_routes.py — كل واحد منهم
بيستخدم نفس الـ singleton (telegram.auto_poster.auto_poster).
"""

import os
import sys
import base64
import asyncio
import threading
import tempfile
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify

# Create blueprint — prefix مختلف عن /api/market/report عشان نتجنب التعارض
market_status_bp = Blueprint('market_status_image', __name__, url_prefix='/api/market')

# إضافة parent لـ path عشان نقدر نستورد telegram.auto_poster
_vps_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _vps_root not in sys.path:
    sys.path.insert(0, _vps_root)


# ============================================================
# Lazy-loaded Telegram Auto Poster
# ============================================================

_auto_poster = None


def _get_auto_poster():
    global _auto_poster
    if _auto_poster is None:
        try:
            from telegram.auto_poster import auto_poster as ap
            _auto_poster = ap
        except ImportError as e:
            print(f"[market_status] Auto poster not available: {e}")
    return _auto_poster


# Event loop دائم (نفس نمط hunter_routes.py و telegram_routes.py)
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


def _run_async(coro, timeout=60):
    """تشغيل coroutine في الـ event loop الدائم."""
    loop = _get_bg_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


# ============================================================
# Helpers
# ============================================================

def _decode_data_url(data_url: str):
    """
    يفكّ data URL بصيغة:
        data:image/png;base64,iVBORw0KGgo...
    ويرجع (mime_type, raw_bytes).

    يدعم أيضاً base64 خام بدون prefix.
    """
    if not data_url:
        return None, None

    s = data_url.strip()

    # الصيغة الكاملة: data:image/png;base64,...
    if s.startswith('data:'):
        try:
            header, b64payload = s.split(',', 1)
            # header مثل: data:image/png;base64
            mime = 'image/png'
            if ';' in header:
                mime = header.split(':')[1].split(';')[0]
            raw = base64.b64decode(b64payload)
            return mime, raw
        except Exception:
            return None, None

    # base64 خام
    try:
        raw = base64.b64decode(s)
        return 'image/png', raw
    except Exception:
        return None, None


# خريطة أكواد الأسواق لأسمائها العربية (للـ caption الافتراضي)
_MARKET_NAMES_AR = {
    'EGX': 'البورصة المصرية',
    'TADAWUL': 'السوق السعودي',
    'KSE': 'بورصة الكويت',
    'QSE': 'بورصة قطر',
}


def _default_caption(market: str) -> str:
    market_name = _MARKET_NAMES_AR.get(market, market)
    now = datetime.now()
    date_str = now.strftime('%Y-%m-%d')
    return (
        f"📊 حالة السوق — {market_name}\n"
        f"📅 {date_str}\n\n"
        f"منصة دليل الاستثمار | invist.m2y.net"
    )


# ============================================================
# Market Status and Summary Endpoint
# ============================================================

_reporter = None

def _get_reporter():
    global _reporter
    if _reporter is None:
        try:
            from analyzers.market_daily_report import MarketDailyReport
            _reporter = MarketDailyReport()
        except Exception as e:
            print(f"[market_status] MarketDailyReport not available: {e}")
    return _reporter


@market_status_bp.route('/status', methods=['GET'])
def get_market_status():
    """
    حالة السوق الحالية مع إحصائيات للمزامنة والـ WebSocket

    RECOMMENDATIONS-FIX-022 (يوليو 2026):
    - تم إضافة most_active, top_gainers, top_losers, indices, summary
      عشان الواجهة تقدر تعرض بيانات حقيقية بدل ما تكون فاضية.
    - most_active: top 10 أسهم حسب volume
    - top_gainers: top 10 أسهم حسب change_percent DESC
    - top_losers: top 10 أسهم حسب change_percent ASC
    - indices: EGX30, EGX50, EGX70, EGX100 من market_indices table
    - summary: total_stocks, gainers, losers, unchanged, market_breadth
    """
    try:
        market = request.args.get('market', 'EGX').upper()
        limit = request.args.get('limit', 10, type=int)
        limit = min(max(limit, 1), 50)

        rep = _get_reporter()
        if not rep:
            return jsonify({'success': False, 'error': 'Reporter not initialized'}), 500

        status = rep.get_market_status(market)
        summary = rep.get_market_summary(market)

        # Calculate total volume from stocks table + build most_active list
        total_volume = 0
        most_active = []
        top_gainers = []
        top_losers = []
        try:
            from utils.helpers import parse_volume
            conn = rep._get_db_connection()
            conn.row_factory = sqlite3.Row  # type: ignore[attr-defined]
            cursor = conn.cursor()

            # Total volume (legacy calculation kept for backward compat)
            cursor.execute(
                "SELECT volume FROM stocks WHERE ticker LIKE ? OR market = ?",
                (f'%{market}%', market),
            )
            rows = cursor.fetchall()
            for row in rows:
                if row[0]:
                    total_volume += parse_volume(row[0])

            # Most active by parsed volume (top 10)
            cursor.execute(
                """
                SELECT ticker, name, name_ar, current_price, change_percent, volume, sector, market
                FROM stocks
                WHERE (ticker LIKE ? OR market = ?)
                  AND current_price > 0
                  AND volume IS NOT NULL AND volume != '' AND volume != '0'
                """,
                (f'%{market}%', market),
            )
            all_rows = [dict(r) for r in cursor.fetchall()]
            # Parse volume string ("5.29 M" → 5290000) for sorting
            def _vol_of(r):
                try:
                    return parse_volume(r.get('volume')) or 0
                except Exception:
                    return 0
            sorted_by_vol = sorted(all_rows, key=_vol_of, reverse=True)
            for r in sorted_by_vol[:limit]:
                vol_num = _vol_of(r)
                most_active.append({
                    'ticker': r.get('ticker'),
                    'name': r.get('name') or r.get('name_ar') or r.get('ticker'),
                    'name_ar': r.get('name_ar') or r.get('name') or r.get('ticker'),
                    'current_price': r.get('current_price'),
                    'change_percent': r.get('change_percent') or 0,
                    'volume': r.get('volume'),
                    'volume_int': vol_num,
                    'sector': r.get('sector') or '',
                })

            # Top gainers (change_percent DESC, > 0)
            cursor.execute(
                """
                SELECT ticker, name, name_ar, current_price, change_percent, volume, sector
                FROM stocks
                WHERE (ticker LIKE ? OR market = ?)
                  AND change_percent > 0
                ORDER BY change_percent DESC
                LIMIT ?
                """,
                (f'%{market}%', market, limit),
            )
            for r in cursor.fetchall():
                top_gainers.append({
                    'ticker': r[0],
                    'name': r[1] or r[2] or r[0],
                    'name_ar': r[2] or r[1] or r[0],
                    'current_price': r[3],
                    'change_percent': r[4] or 0,
                    'volume': r[5],
                    'sector': r[6] or '',
                })

            # Top losers (change_percent ASC, < 0)
            cursor.execute(
                """
                SELECT ticker, name, name_ar, current_price, change_percent, volume, sector
                FROM stocks
                WHERE (ticker LIKE ? OR market = ?)
                  AND change_percent < 0
                ORDER BY change_percent ASC
                LIMIT ?
                """,
                (f'%{market}%', market, limit),
            )
            for r in cursor.fetchall():
                top_losers.append({
                    'ticker': r[0],
                    'name': r[1] or r[2] or r[0],
                    'name_ar': r[2] or r[1] or r[0],
                    'current_price': r[3],
                    'change_percent': r[4] or 0,
                    'volume': r[5],
                    'sector': r[6] or '',
                })

            conn.close()
        except Exception as ex:
            print(f"Error calculating total volume / movers: {ex}")

        # Indices from market_indices table (EGX30 / EGX70 / EGX100 ...)
        indices = []
        try:
            conn = rep._get_db_connection()
            conn.row_factory = sqlite3.Row  # type: ignore[attr-defined]
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT symbol, name, current_value, previous_close, change, change_percent, last_update
                FROM market_indices
                WHERE symbol LIKE ? OR symbol IN ('EGX30','EGX50','EGX70','EGX100','EGX33')
                ORDER BY CASE symbol
                    WHEN 'EGX30' THEN 1
                    WHEN 'EGX70' THEN 2
                    WHEN 'EGX100' THEN 3
                    WHEN 'EGX50' THEN 4
                    WHEN 'EGX33' THEN 5
                    ELSE 99
                END
                """
                , (f'%{market}%',),
            )
            for r in cursor.fetchall():
                indices.append({
                    'symbol': r[0],
                    'name': r[1],
                    'current_value': r[2],
                    'previous_close': r[3],
                    'change': r[4],
                    'change_percent': r[5],
                    'last_update': r[6],
                })
            conn.close()
        except Exception as ex:
            # market_indices table might not exist on some DBs — safe skip
            print(f"Error fetching indices: {ex}")

        return jsonify({
            'success': True,
            'status': 'open' if status['market_status'] == 'مفتوح' else 'closed',
            'is_open': status['is_working_day'] and status['is_market_hours'],
            'gainers_count': summary['gainers'],
            'losers_count': summary['losers'],
            'unchanged_count': summary['unchanged'],
            'total_volume': total_volume,
            # NEW FIELDS (RECOMMENDATIONS-FIX-022)
            'most_active': most_active,
            'top_gainers': top_gainers,
            'top_losers': top_losers,
            'indices': indices,
            'summary': {
                'total_stocks': summary['total_stocks'],
                'gainers': summary['gainers'],
                'losers': summary['losers'],
                'unchanged': summary['unchanged'],
                'market_breadth': summary['market_breadth'],
            },
            'data': status,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500


# ============================================================
# Endpoint
# ============================================================

@market_status_bp.route('/publish-status-image', methods=['POST'])
def publish_status_image():
    """
    Feature 5 — نشر صورة "حالة السوق" على قناة تيليجرام.

    Body:
    {
        "image": "data:image/png;base64,iVBOR...",  # مطلوب
        "market": "EGX",                              # اختياري
        "caption": "نص تعليقي"                        # اختياري
    }

    Returns:
        {"success": true, "message_id": 123, "date": "..."}
        أو {"success": false, "error": "...", "error_ar": "..."}
    """
    data = request.get_json(silent=True) or {}

    image_field = data.get('image') or data.get('image_data') or data.get('data_url')
    if not image_field:
        return jsonify({
            "success": False,
            "error": "image is required (data:image/png;base64,...)",
            "error_ar": "صورة حالة السوق مطلوبة",
        }), 400

    mime, raw = _decode_data_url(image_field)
    if not raw or not mime:
        return jsonify({
            "success": False,
            "error": "Invalid image data URL",
            "error_ar": "بيانات الصورة غير صالحة",
        }), 400

    # حد أقصى 10MB لصورة تيليجرام
    if len(raw) > 10 * 1024 * 1024:
        return jsonify({
            "success": False,
            "error": "Image too large (>10MB)",
            "error_ar": "حجم الصورة كبير جداً (أكبر من 10MB)",
        }), 413

    market = (data.get('market') or 'EGX').upper()
    caption = data.get('caption') or _default_caption(market)

    # قصّ الـ caption لو تجاوز حد تيليجرام (1024 حرف للـ caption مع صورة)
    if len(caption) > 1000:
        caption = caption[:990] + '\n…'

    poster = _get_auto_poster()
    if poster is None:
        return jsonify({
            "success": False,
            "error": "Telegram auto-poster not available (telethon not installed)",
            "error_ar": "خدمة تيليجرام غير متاحة",
        }), 503

    # امتداد مؤقت حسب الـ mime
    ext = 'png'
    if 'jpeg' in (mime or '') or 'jpg' in (mime or ''):
        ext = 'jpg'

    # حفظ في ملف مؤقت عشان telethon.send_file يقدر يقرأه
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix='market_status_', suffix=f'.{ext}', delete=False
        ) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        # الإرسال — parse_mode=None عشان نتجنب مشاكل الـ markdown مع الرموز
        result = _run_async(
            poster.send_photo(tmp_path, caption=caption, parse_mode=None),
            timeout=60,
        )
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to send to Telegram: {e}",
            "error_ar": f"فشل الإرسال لتيليجرام: {e}",
        }), 500
    finally:
        # تنظيف الملف المؤقت
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    if not result.get('success'):
        return jsonify({
            "success": False,
            "error": result.get('error', 'Unknown error'),
            "error_ar": "فشل النشر على القناة",
        }), 503

    return jsonify({
        "success": True,
        "message": "تم نشر صورة حالة السوق",
        "message_id": result.get('message_id'),
        "date": result.get('date'),
        "market": market,
    })
