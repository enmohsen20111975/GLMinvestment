#!/usr/bin/env python3
"""
Reports Routes - نظام التقارير الذكية
=====================================
Flask Blueprint لإدارة التقارير اليومية والأسبوعية والشهرية.

Endpoints:
- GET  /api/reports/daily/tomorrow      → توليد توقعات الغد
- GET  /api/reports/daily/summary       → توليد ملخص اليوم
- GET  /api/reports/weekly/summary      → توليد ملخص الأسبوع
- GET  /api/reports/monthly/summary     → توليد ملخص الشهر
- POST /api/reports/generate            → توليد يدوي (body: {type, force})
- GET  /api/reports/list                → قائمة التقارير (query: limit, type)
- GET  /api/reports/<report_id>         → جلب تقرير محدد
- GET  /api/reports/<report_id>/image   → جلب صورة التقرير
- POST /api/reports/<report_id>/publish → نشر على تليجرام
- GET  /api/reports/scheduled/check     → فحص الجدولة

ملاحظة قانونية:
- نستخدم "توقعات" وليس "توصيات" (للتوافق مع القوانين)
- النصوص بالعربية
- التوقيت بـ Africa/Cairo timezone

Author: GLMinvestment Platform
"""

import os
from core.auth_middleware import require_admin
import sys
import json
from datetime import datetime
from typing import Dict, Optional, Any
from flask import Blueprint, request, jsonify, send_file

# Add vps-service root to path so we can import analyzers.* and data_engine.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

reports_bp = Blueprint('reports', __name__, url_prefix='/api/reports')

# ============================================================================
# LAZY ENGINE INITIALIZATION
# ============================================================================

_reports_engine = None


def get_engine():
    """تهيئة ReportsEngine بشكل lazy (مرة واحدة فقط)"""
    global _reports_engine
    if _reports_engine is None:
        try:
            from analyzers.reports_engine import ReportsEngine
            _reports_engine = ReportsEngine()
        except Exception as e:
            print(f"[Reports] Error initializing engine: {e}")
            return None
    return _reports_engine


def _err(msg: str, status: int = 503, extra: Optional[Dict] = None):
    """Helper لإنشاء error response موحّد"""
    payload = {'success': False, 'error': msg}
    if extra:
        payload.update(extra)
    return jsonify(payload), status


def _ok(data: Any, extra: Optional[Dict] = None):
    """Helper لإنشاء success response موحّد"""
    payload = {'success': True, 'data': data}
    if extra:
        payload.update(extra)
    return jsonify(payload)


# ============================================================================
# DEDICATED ENDPOINTS - توليد التقارير بأنواعها
# ============================================================================

@reports_bp.route('/daily/tomorrow', methods=['GET'])
def generate_tomorrow_picks():
    """توليد توقعات الغد (تقرير قبل افتتاح الجلسة القادمة)"""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        market = request.args.get('market', 'EGX').upper()
        force = request.args.get('force', 'false').lower() in ('1', 'true', 'yes')
        result = engine.generate_tomorrow_picks(force=True)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except AttributeError as e:
        # في حال ReportsEngine مفقود أو الـ method مش موجود
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to generate tomorrow picks: {e}', status=500)


@reports_bp.route('/daily/summary', methods=['GET'])
def generate_daily_summary():
    """توليد ملخص اليوم"""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        market = request.args.get('market', 'EGX').upper()
        force = request.args.get('force', 'false').lower() in ('1', 'true', 'yes')
        result = engine.generate_daily_summary(force=True)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to generate daily summary: {e}', status=500)


@reports_bp.route('/weekly/summary', methods=['GET'])
def generate_weekly_summary():
    """توليد ملخص الأسبوع"""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        market = request.args.get('market', 'EGX').upper()
        force = request.args.get('force', 'false').lower() in ('1', 'true', 'yes')
        result = engine.generate_weekly_summary(force=True)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to generate weekly summary: {e}', status=500)


@reports_bp.route('/monthly/summary', methods=['GET'])
def generate_monthly_summary():
    """توليد ملخص الشهر"""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        market = request.args.get('market', 'EGX').upper()
        force = request.args.get('force', 'false').lower() in ('1', 'true', 'yes')
        result = engine.generate_monthly_summary(force=True)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to generate monthly summary: {e}', status=500)


# ============================================================================
# GENERIC GENERATE ENDPOINT - توليد يدوي لأي نوع
# ============================================================================

@require_admin
@reports_bp.route('/generate', methods=['POST'])
def generate_report():
    """
    توليد تقرير يدوياً

    Body:
        {
            "type": "daily_tomorrow" | "daily_summary" | "weekly" | "monthly",
            "force": false,
            "market": "EGX"
        }

    لو force=false والتقرير موجود لنفس اليوم → يرجع الموجود
    لو force=true → يعيد التوليد
    """
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        data = request.get_json(silent=True) or {}
        report_type = data.get('type', '').strip().lower()
        force = bool(data.get('force', False))
        market = (data.get('market') or request.args.get('market', 'EGX')).upper()

        # خريطة الأنواع المسموحة للـ method اللي يقابله في الـ engine
        type_to_method = {
            'daily_tomorrow': 'generate_tomorrow_picks',
            'daily_summary':  'generate_daily_summary',
            'weekly':         'generate_weekly_summary',
            'monthly':        'generate_monthly_summary',
        }

        if report_type not in type_to_method:
            return _err(
                f'Invalid report type: {report_type}. '
                f'Must be one of: {", ".join(type_to_method.keys())}',
                status=400,
            )

        method_name = type_to_method[report_type]
        method = getattr(engine, method_name, None)
        if method is None:
            return _err(f'Engine method not available: {method_name}')

        # Pass force=True to skip holiday checks for manual generation
        result = method(force=True)

        return _ok(result, {
            'timestamp': datetime.now().isoformat(),
            'type': report_type,
            'force': force,
            'market': market,
        })
    except Exception as e:
        return _err(f'Failed to generate report: {e}', status=500)


# ============================================================================
# LISTING & RETRIEVAL
# ============================================================================

@reports_bp.route('/list', methods=['GET'])
def list_reports():
    """
    قائمة التقارير مع pagination

    Query:
        limit (default 50)
        type  (optional filter: daily_tomorrow|daily_summary|weekly|monthly)
        offset (default 0)
    """
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        report_type = request.args.get('type', None)
        if report_type:
            report_type = report_type.strip().lower()

        result = engine.get_reports_list(limit=limit, report_type=report_type)

        # normalize: نتأكد إن في items + total + pagination
        if isinstance(result, dict):
            items = result.get('items') or result.get('reports') or []
            total = result.get('total', len(items))
        else:
            items = result or []
            total = len(items)

        return _ok({
            'items': items,
            'total': total,
            'limit': limit,
            'offset': offset,
            'type': report_type,
        }, {'timestamp': datetime.now().isoformat()})
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to list reports: {e}', status=500)


@reports_bp.route('/<report_id>', methods=['GET'])
def get_report(report_id: str):
    """جلب تقرير محدد بالكامل"""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        report = engine.get_report(report_id)
        if not report:
            return _err(f'Report not found: {report_id}', status=404)

        # لو فيه image_path → ضيف image_url
        image_path = report.get('image_path') if isinstance(report, dict) else None
        if image_path:
            report['image_url'] = f'/api/reports/{report_id}/image'

        return _ok(report, {'timestamp': datetime.now().isoformat()})
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to fetch report: {e}', status=500)


@reports_bp.route('/<report_id>/image', methods=['GET'])
def get_report_image(report_id: str):
    """خدم صورة التقرير كـ file response"""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        report = engine.get_report(report_id)
        if not report:
            return _err(f'Report not found: {report_id}', status=404)

        image_path = report.get('image_path') if isinstance(report, dict) else None
        if not image_path or not os.path.exists(image_path):
            return _err('Image not available for this report', status=404)

        return send_file(image_path, mimetype='image/png')
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to fetch report image: {e}', status=500)


# ============================================================================
# TELEGRAM PUBLISHING
# ============================================================================

@require_admin
@reports_bp.route('/<report_id>/publish', methods=['POST'])
def publish_report(report_id: str):
    """نشر تقرير محدد على قناة التليجرام.

    V2.3: النشر يتطلب موافقة الأدمن مسبقاً (status='approved').
    لو status='pending' → بيرجع 400 مع needs_approval=True.
    """
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')

    try:
        result = engine.publish_to_telegram(report_id)
        if not isinstance(result, dict):
            result = {'success': False, 'error': 'Engine returned unexpected result'}

        success = bool(result.get('success', False))
        telegram_message_id = result.get('telegram_message_id') or result.get('message_id')

        response = {
            'success': success,
            'telegram_message_id': telegram_message_id,
            'report_id': report_id,
        }
        if not success:
            response['error'] = result.get('error', 'Unknown error')
            response['error_ar'] = result.get('error_ar', '')
            response['needs_approval'] = result.get('needs_approval', False)
            response['status'] = result.get('status')
            # V2.3: لو needs_approval → 400 (Bad Request) مش 502
            if result.get('needs_approval'):
                return jsonify(response), 400
            return jsonify(response), 502
        return jsonify(response)
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to publish report: {e}', status=500)


# ============================================================================
# V2.3: APPROVE / REJECT — موافقة الأدمن قبل النشر
# ============================================================================

@require_admin
@reports_bp.route('/<report_id>/approve', methods=['POST'])
def approve_report(report_id: str):
    """V2.3: موافقة الأدمن على التقرير (status: pending → approved)."""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')
    try:
        result = engine.approve_report(report_id)
        if not isinstance(result, dict):
            result = {'success': False, 'error': 'Engine returned unexpected result'}
        if not result.get('success'):
            return jsonify(result), 400
        return jsonify(result)
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to approve report: {e}', status=500)


@require_admin
@reports_bp.route('/<report_id>/reject', methods=['POST'])
def reject_report(report_id: str):
    """V2.3: رفض الأدمن للتقرير (status: pending → rejected)."""
    engine = get_engine()
    if engine is None:
        return _err('Reports engine not available')
    try:
        data = request.get_json(silent=True) or {}
        reason = data.get('reason', '')
        result = engine.reject_report(report_id, reason)
        if not isinstance(result, dict):
            result = {'success': False, 'error': 'Engine returned unexpected result'}
        if not result.get('success'):
            return jsonify(result), 400
        return jsonify(result)
    except AttributeError as e:
        return _err(f'Engine method not available: {e}')
    except Exception as e:
        return _err(f'Failed to reject report: {e}', status=500)


# ============================================================================
# SCHEDULED CHECK - هل فيه تقرير لازم يتولد دلوقتي؟
# ============================================================================

@reports_bp.route('/scheduled/check', methods=['GET'])
def scheduled_check():
    """
    فحص الجدولة: هل فيه تقرير لازم يتولد دلوقتي؟

    التوقيت بـ Africa/Cairo:
    - daily_tomorrow:  08:30 — أيام عمل (الأحد-الخميس)
    - daily_summary:   16:30 — أيام عمل (الأحد-الخميس)
    - weekly_summary:  09:00 — يوم الجمعة
    - monthly_summary: 10:00 — أول يوم في الشهر

    Returns:
        {
            "success": true,
            "data": {
                "should_generate": true,
                "type": "daily_tomorrow",
                "reason": "...",
                "now": "..."
            }
        }
    """
    try:
        import pytz
        cairo_tz = pytz.timezone('Africa/Cairo')
        now = datetime.now(cairo_tz)
        weekday = now.weekday()  # 0=Mon, 6=Sun
        is_working_day = weekday in [6, 0, 1, 2, 3]  # Sun-Thu
        current_hhmm = now.hour * 60 + now.minute  # دقائق من بداية اليوم

        # نسمح بنافذة ±15 دقيقة لتفادي مشاكل الـ polling
        def _in_window(hh: int, mm: int) -> bool:
            target = hh * 60 + mm
            return abs(current_hhmm - target) <= 15

        # أولوية الفحص: monthly > weekly > daily
        # monthly: أول يوم في الشهر، 10:00 ص
        if now.day == 1 and _in_window(10, 0):
            return _ok({
                'should_generate': True,
                'type': 'monthly',
                'reason': f'أول يوم في الشهر - {now.strftime("%Y-%m-%d")} 10:00 ص',
                'now': now.isoformat(),
            })

        # weekly: يوم الجمعة (weekday=4)، 9:00 ص
        if weekday == 4 and _in_window(9, 0):
            return _ok({
                'should_generate': True,
                'type': 'weekly',
                'reason': f'يوم الجمعة - {now.strftime("%Y-%m-%d")} 09:00 ص',
                'now': now.isoformat(),
            })

        # daily_tomorrow: 8:30 ص، أيام عمل
        if is_working_day and _in_window(8, 30):
            return _ok({
                'should_generate': True,
                'type': 'daily_tomorrow',
                'reason': f'توقعات الغد - {now.strftime("%Y-%m-%d")} 08:30 ص',
                'now': now.isoformat(),
            })

        # daily_summary: 4:30 م، أيام عمل
        if is_working_day and _in_window(16, 30):
            return _ok({
                'should_generate': True,
                'type': 'daily_summary',
                'reason': f'ملخص اليوم - {now.strftime("%Y-%m-%d")} 16:30 م',
                'now': now.isoformat(),
            })

        # مفيش تقرير لازم يتولد دلوقتي
        next_hint = 'لا يوجد تقرير مجدول الآن'
        if not is_working_day:
            next_hint = 'إجازة - تخطى التقارير اليومية'
        return _ok({
            'should_generate': False,
            'type': None,
            'reason': next_hint,
            'now': now.isoformat(),
            'current_time': now.strftime('%H:%M'),
            'weekday': weekday,
            'is_working_day': is_working_day,
        })
    except Exception as e:
        return _err(f'Scheduled check failed: {e}', status=500)


# ============================================================================
# REGISTRATION HELPER
# ============================================================================

def register_reports_routes(app):
    """Register the reports blueprint with the Flask app (optional helper)."""
    app.register_blueprint(reports_bp)
    print("✅ Reports routes registered at /api/reports/*")


# ============================================================================
# MAIN - smoke test
# ============================================================================

if __name__ == '__main__':
    print("=" * 60)
    print("Reports Routes - Test")
    print("=" * 60)
    print("\nAvailable endpoints:")
    print("  GET  /api/reports/daily/tomorrow")
    print("  GET  /api/reports/daily/summary")
    print("  GET  /api/reports/weekly/summary")
    print("  GET  /api/reports/monthly/summary")
    print("  POST /api/reports/generate")
    print("  GET  /api/reports/list")
    print("  GET  /api/reports/<report_id>")
    print("  GET  /api/reports/<report_id>/image")
    print("  POST /api/reports/<report_id>/publish")
    print("  GET  /api/reports/scheduled/check")
