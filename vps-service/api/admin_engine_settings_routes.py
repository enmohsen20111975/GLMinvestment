#!/usr/bin/env python3
"""
Admin Engine Settings Routes — مسارات إعدادات المحرك الديناميكي
=================================================================
Flask Blueprint for the Admin "Engine Settings" tab.

بيقدير الـ API اللي بيخلّي الأدمن يتحكم في كل thresholds المحرك
ديناميكياً بدون ما يلمس الكود. الإعدادات بتتخزن في جدول
`system_settings` في stocks.db.

الـ Backend logic موجود في `analyzers.engine_settings` — الـ Blueprint
ده مجرد طبقة HTTP فوقه.

Endpoints:
  - GET  /api/admin/engine-settings         — يرجّع كل الإعدادات + الأوصاف
  - POST /api/admin/engine-settings         — يحدّث إعداد واحد أو أكتر
  - POST /api/admin/engine-settings/reset   — يرجّع كل الإعدادات للافتراضي

Author: دليل الاستثمار / Investment Guide Team
Version: 1.0.0
"""

import os
from core.auth_middleware import require_admin
import sys
import logging
from datetime import datetime
from typing import Dict, Any

from flask import Blueprint, jsonify, request

# ============================================================================
# PATH SETUP — إعداد المسار
# ============================================================================

_vps_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _vps_root not in sys.path:
    sys.path.insert(0, _vps_root)

logger = logging.getLogger(__name__)


# ============================================================================
# BLUEPRINT DEFINITION — تعريف الـ Blueprint
# ============================================================================

admin_engine_settings_bp = Blueprint(
    'admin_engine_settings',
    __name__,
    url_prefix='/api/admin/engine-settings',
)


# ============================================================================
# SAFE IMPORTS — استيراد آمن (لا يكسر الـ API لو الموديول مش موجود)
# ============================================================================

try:
    from analyzers.engine_settings import (
        get_all_settings,
        get_settings_descriptions,
        update_many,
        reset_to_defaults,
        DEFAULT_SETTINGS,
    )
    ENGINE_SETTINGS_AVAILABLE = True
    _ENGINE_ERROR = None
except ImportError as e:
    print(f"Warning: Engine Settings module not available: {e}")
    logger.warning(f"Engine Settings module not available: {e}")
    ENGINE_SETTINGS_AVAILABLE = False
    _ENGINE_ERROR = str(e)
    get_all_settings = None  # type: ignore
    get_settings_descriptions = None  # type: ignore
    update_many = None  # type: ignore
    reset_to_defaults = None  # type: ignore
    DEFAULT_SETTINGS = {}  # type: ignore


# ============================================================================
# HELPER: Unavailable response — رد غير متاح
# ============================================================================

def _unavailable_response(endpoint: str) -> tuple:
    """
    رد موحّد لما الـ Engine Settings module مش متاح.
    Unified response when the Engine Settings module is unavailable.
    """
    return jsonify({
        "success": False,
        "settings": {},
        "descriptions": {},
        "timestamp": datetime.now().isoformat(),
        "source": "unavailable",
        "warning": f"Engine Settings module is not available: {_ENGINE_ERROR}",
        "endpoint": endpoint,
    }), 502


# ============================================================================
# ROUTE 1: GET /api/admin/engine-settings
# يرجّع كل الإعدادات + الأوصاف — Returns all settings + descriptions
# ============================================================================

@admin_engine_settings_bp.route('', methods=['GET'])
def get_engine_settings():
    """
    GET /api/admin/engine-settings

    بيرجّع كل إعدادات المحرك (DB overrides + defaults) مع الأوصاف
    والتصنيف لكل إعداد. بيستخدمه الـ Admin UI لرسم الـ form.

    Returns:
        JSON: { success, settings: {key: value}, descriptions: {key: {description, category}} }
    """
    try:
        if not ENGINE_SETTINGS_AVAILABLE:
            return _unavailable_response("/api/admin/engine-settings")

        settings = get_all_settings()  # type: ignore
        descriptions = get_settings_descriptions()  # type: ignore

        return jsonify({
            "success": True,
            "settings": settings,
            "descriptions": descriptions,
            "count": len(settings),
            "timestamp": datetime.now().isoformat(),
            "source": "engine_settings",
        })

    except Exception as e:
        logger.error(f"Error in GET /api/admin/engine-settings: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "settings": {},
            "descriptions": {},
            "timestamp": datetime.now().isoformat(),
            "source": "error",
            "error": str(e),
        }), 500


# ============================================================================
# ROUTE 2: POST /api/admin/engine-settings
# يحدّث إعداد واحد أو أكتر — Updates one or more settings
# ============================================================================

@admin_engine_settings_bp.route('', methods=['POST'])
def update_engine_settings():
    """
    POST /api/admin/engine-settings

    بيحدّث إعداد واحد أو أكتر دفعة واحدة. الـ body لازم يكون:
        { "updates": { "key1": value1, "key2": value2, ... } }

    الـ values ممكن تكون int, float, bool, أو str. الـ backend بيتعامل
    معاهم وبيخزّنهم كـ string مع حفظ النوع.

    Returns:
        JSON: { success, results: {key: bool}, timestamp }
    """
    try:
        if not ENGINE_SETTINGS_AVAILABLE:
            return _unavailable_response("/api/admin/engine-settings (POST)")

        body = request.get_json(silent=True) or {}
        updates = body.get('updates') if isinstance(body, dict) else None

        if not isinstance(updates, dict) or not updates:
            return jsonify({
                "success": False,
                "error": "missing or invalid 'updates' field — expected { updates: { key: value } }",
                "timestamp": datetime.now().isoformat(),
            }), 400

        # Coerce values to proper types (int/float/bool/str) based on DEFAULT_SETTINGS
        coerced: Dict[str, Any] = {}
        for key, value in updates.items():
            if not isinstance(key, str) or not key:
                continue
            default = DEFAULT_SETTINGS.get(key)  # type: ignore
            if isinstance(default, bool):
                if isinstance(value, bool):
                    coerced[key] = value
                elif isinstance(value, (int, float)):
                    coerced[key] = bool(value)
                elif isinstance(value, str):
                    coerced[key] = value.strip().lower() in ("1", "true", "yes", "on")
                else:
                    coerced[key] = bool(value)
            elif isinstance(default, int):
                try:
                    coerced[key] = int(float(value))
                except (ValueError, TypeError):
                    coerced[key] = int(default) if default is not None else 0
            elif isinstance(default, float):
                try:
                    coerced[key] = float(value)
                except (ValueError, TypeError):
                    coerced[key] = float(default) if default is not None else 0.0
            else:
                coerced[key] = str(value)

        if not coerced:
            return jsonify({
                "success": False,
                "error": "no valid keys supplied in 'updates'",
                "timestamp": datetime.now().isoformat(),
            }), 400

        results = update_many(coerced, updated_by="admin-ui")  # type: ignore
        success_count = sum(1 for v in results.values() if v)
        all_ok = success_count == len(results)

        return jsonify({
            "success": all_ok,
            "results": results,
            "updated_count": success_count,
            "total_count": len(results),
            "timestamp": datetime.now().isoformat(),
            "source": "engine_settings",
        })

    except Exception as e:
        logger.error(f"Error in POST /api/admin/engine-settings: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "results": {},
            "error": str(e),
            "timestamp": datetime.now().isoformat(),
        }), 500


# ============================================================================
# ROUTE 3: POST /api/admin/engine-settings/reset
# يرجّع كل الإعدادات للافتراضي — Resets all settings to defaults
# ============================================================================

@require_admin
@admin_engine_settings_bp.route('/reset', methods=['POST'])
def reset_engine_settings():
    """
    POST /api/admin/engine-settings/reset

    بيرجّع كل الإعدادات لقيمها الافتراضية المعرّفة في DEFAULT_SETTINGS.
    مفيد لو الأدمن لخّصها وعايز يبدأ من جديد.

    Returns:
        JSON: { success, timestamp }
    """
    try:
        if not ENGINE_SETTINGS_AVAILABLE:
            return _unavailable_response("/api/admin/engine-settings/reset")

        ok = reset_to_defaults()  # type: ignore

        return jsonify({
            "success": bool(ok),
            "timestamp": datetime.now().isoformat(),
            "source": "engine_settings",
            "message": "تمت استعادة كل الإعدادات لقيمها الافتراضية" if ok else "فشل الاستعادة — راجع اللوج",
        })

    except Exception as e:
        logger.error(f"Error in POST /api/admin/engine-settings/reset: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat(),
        }), 500
