#!/usr/bin/env python3
"""
Alert System — نظام الإنذارات
================================
REALITY-CHECK-023: نظام الإنذارات للمنصة.

الوظائف:
1. فحص عمر البيانات في stocks.db — لو الأسعار أقدم من 24 ساعة
   → لوحة الأدمن تظهر فيها رسالة حمراء: "🚨 محرك البيانات متوقف"
2. لو فيه خطأ في الـ Python Backend (database is locked)
   → يتبعت إنذار على التليجرام فوراً

الاستخدام:
    from analyzers.alert_system import AlertSystem
    alert = AlertSystem()
    alert.check_data_engine_health()  # يفحص الأسعار
    alert.send_alert("database is locked", level='critical')  # إنذار طارئ
"""

from __future__ import annotations

import os
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# عتبة عمر البيانات (بالساعات) — لو الأسعار أقدم من كده → إنذار
DATA_STALENESS_THRESHOLD_HOURS = 24


class AlertSystem:
    """
    نظام الإنذارات — بيراقب صحة المنصة ويبعت إنذارات للـ admin/telegram.
    """

    def __init__(self, stocks_db: str = None):
        self.stocks_db = stocks_db or STOCKS_DB
        self._last_data_alert = None  # عشان منبعتش نفس الإنذار كل شوية
        self._last_error_alert = None

    # ----------------------------------------------------------------------
    # 1. فحص محرك البيانات (Data Engine Health)
    # ----------------------------------------------------------------------

    def check_data_engine_health(self) -> Dict:
        """
        فحص صحة محرك البيانات — هل الأسعار حديثة؟

        Returns:
            Dict: {is_healthy, latest_update, hours_since_update, alert_message}
        """
        result = {
            'is_healthy': True,
            'latest_update': None,
            'hours_since_update': 0,
            'stale_stocks_count': 0,
            'alert_message': '',
            'alert_level': 'none',  # none, warning, critical
        }

        if not os.path.exists(self.stocks_db):
            result['is_healthy'] = False
            result['alert_message'] = '🚨 محرك البيانات متوقف — stocks.db غير موجود'
            result['alert_level'] = 'critical'
            return result

        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.stocks_db, writable=False)
            cursor = conn.cursor()

            # فحص آخر تحديث لأسعار الأسهم
            cursor.execute('''
                SELECT MAX(last_update) FROM stocks WHERE last_update IS NOT NULL
            ''')
            row = cursor.fetchone()
            latest = row[0] if row and row[0] else None

            if not latest:
                result['is_healthy'] = False
                result['alert_message'] = '🚨 محرك البيانات متوقف — مفيش أسعار محدّثة في stocks.db'
                result['alert_level'] = 'critical'
                conn.close()
                return result

            # محاولة parse التاريخ
            try:
                # الصيغة المتوقعة: YYYY-MM-DD HH:MM:SS أو ISO
                if 'T' in latest:
                    latest_dt = datetime.fromisoformat(latest.replace('Z', '+00:00'))
                else:
                    latest_dt = datetime.strptime(latest, '%Y-%m-%d %H:%M:%S')
                # إزالة timezone لو موجود
                if latest_dt.tzinfo:
                    latest_dt = latest_dt.replace(tzinfo=None)

                hours_since = (datetime.now() - latest_dt).total_seconds() / 3600
                result['latest_update'] = latest
                result['hours_since_update'] = round(hours_since, 1)

                if hours_since > DATA_STALENESS_THRESHOLD_HOURS:
                    result['is_healthy'] = False
                    result['alert_message'] = (
                        f'🚨 محرك البيانات متوقف — آخر تحديث للأسعار منذ {hours_since:.1f} ساعة '
                        f'(أحدث من {DATA_STALENESS_THRESHOLD_HOURS} ساعة المطلوبة)'
                    )
                    result['alert_level'] = 'critical'
                elif hours_since > 6:
                    result['is_healthy'] = True
                    result['alert_message'] = (
                        f'⚠️ تحذير — آخر تحديث للأسعار منذ {hours_since:.1f} ساعة'
                    )
                    result['alert_level'] = 'warning'

                # عدّ الأسهم اللي بياناتها قديمة
                cursor.execute('''
                    SELECT COUNT(*) FROM stocks
                    WHERE last_update IS NOT NULL
                      AND last_update < datetime('now', '-{} hours')
                '''.format(DATA_STALENESS_THRESHOLD_HOURS))
                result['stale_stocks_count'] = cursor.fetchone()[0]

            except Exception as parse_err:
                logger.warning(f"[AlertSystem] Date parse error: {parse_err}")
                result['alert_message'] = f'⚠️ تعذّر قراءة تاريخ آخر تحديث: {latest}'
                result['alert_level'] = 'warning'

            conn.close()

        except sqlite3.OperationalError as e:
            if 'database is locked' in str(e).lower():
                result['is_healthy'] = False
                result['alert_message'] = '🚨 database is locked — الباك-إند مش قادر يقرأ stocks.db'
                result['alert_level'] = 'critical'
                # إرسال إنذار تليجرام فوراً
                self.send_alert(
                    message='🚨 database is locked — الباك-أند مش قادر يقرأ stocks.db',
                    level='critical',
                    context='check_data_engine_health'
                )
            else:
                result['is_healthy'] = False
                result['alert_message'] = f'🚨 خطأ في قاعدة البيانات: {e}'
                result['alert_level'] = 'critical'
        except Exception as e:
            result['is_healthy'] = False
            result['alert_message'] = f'🚨 خطأ غير متوقع: {e}'
            result['alert_level'] = 'critical'

        return result

    # ----------------------------------------------------------------------
    # 2. إرسال إنذار للتليجرام (Telegram Alert)
    # ----------------------------------------------------------------------

    def send_alert(self, message: str, level: str = 'warning',
                   context: str = '') -> Dict:
        """
        إرسال إنذار للتليجرام (لو متاح) + log.

        Args:
            message: نص الإنذار
            level: warning | critical
            context: السياق (اسم الدالة أو الموديول)

        Returns:
            Dict: {sent, channel, error}
        """
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        full_message = (
            f"{'🚨' if level == 'critical' else '⚠️'} *إنذار من المنصة*\n"
            f"التاريخ: {timestamp}\n"
            f"المستوى: {level.upper()}\n"
            f"السياق: {context or 'general'}\n"
            f"الرسالة: {message}\n"
        )

        # Log دائماً
        if level == 'critical':
            logger.critical(full_message)
        else:
            logger.warning(full_message)

        # منع الإرسال المتكرر لنفس الإنذار خلال 5 دقايق
        alert_key = f"{level}:{message[:50]}"
        now = datetime.now()
        if level == 'critical':
            if self._last_error_alert:
                last_time, last_key = self._last_error_alert
                if last_key == alert_key and (now - last_time).total_seconds() < 300:
                    return {'sent': False, 'reason': 'duplicate_within_5min'}
            self._last_error_alert = (now, alert_key)
        else:
            if self._last_data_alert:
                last_time, last_key = self._last_data_alert
                if last_key == alert_key and (now - last_time).total_seconds() < 300:
                    return {'sent': False, 'reason': 'duplicate_within_5min'}
            self._last_data_alert = (now, alert_key)

        # محاولة الإرسال للتليجرام (lazy import)
        try:
            import sys
            _vps_root = str(Path(__file__).resolve().parent.parent)
            if _vps_root not in sys.path:
                sys.path.insert(0, _vps_root)
            from telegram.auto_poster import AutoPoster
            from api.telegram_routes import run_async

            poster = AutoPoster()
            result = run_async(poster.send_message(full_message, 'md'))

            if result.get('success'):
                logger.info(f"[AlertSystem] Alert sent to Telegram: {message[:50]}...")
                return {'sent': True, 'channel': 'telegram', 'message_id': result.get('message_id')}
            else:
                logger.warning(f"[AlertSystem] Telegram send failed: {result.get('error')}")
                return {'sent': False, 'channel': 'telegram', 'error': result.get('error')}

        except ImportError:
            logger.info("[AlertSystem] Telegram modules not available — alert logged only")
            return {'sent': False, 'channel': 'none', 'error': 'telegram_not_available'}
        except Exception as e:
            logger.warning(f"[AlertSystem] Alert send error: {e}")
            return {'sent': False, 'channel': 'telegram', 'error': str(e)}


# ----------------------------------------------------------------------
# Singleton
# ----------------------------------------------------------------------

_alert_system: Optional[AlertSystem] = None


def get_alert_system() -> AlertSystem:
    """يرجّع نسخة مشتركة من AlertSystem."""
    global _alert_system
    if _alert_system is None:
        _alert_system = AlertSystem()
    return _alert_system


# ----------------------------------------------------------------------
# Convenience functions
# ----------------------------------------------------------------------

def check_data_health() -> Dict:
    """فحص سريع لصحة محرك البيانات."""
    return get_alert_system().check_data_engine_health()


def send_critical_alert(message: str, context: str = '') -> Dict:
    """إرسال إنذار حرج."""
    return get_alert_system().send_alert(message, level='critical', context=context)


def send_warning_alert(message: str, context: str = '') -> Dict:
    """إرسال إنذار تحذيري."""
    return get_alert_system().send_alert(message, level='warning', context=context)


# ----------------------------------------------------------------------
# اختبار ذاتي
# ----------------------------------------------------------------------

if __name__ == '__main__':
    print("=" * 60)
    print("اختبار AlertSystem")
    print("=" * 60)

    alert = AlertSystem()

    # فحص صحة البيانات
    health = alert.check_data_engine_health()
    print(f"\n📊 Data Engine Health:")
    print(f"  is_healthy: {health['is_healthy']}")
    print(f"  latest_update: {health['latest_update']}")
    print(f"  hours_since_update: {health['hours_since_update']}")
    print(f"  stale_stocks_count: {health['stale_stocks_count']}")
    print(f"  alert_level: {health['alert_level']}")
    print(f"  alert_message: {health['alert_message']}")
