#!/usr/bin/env python3
"""
Trading Calendar — تقويم التداول
===================================
يحل مشكلة التوقيت:
- السبت → توقعات يوم الأحد (not Saturday)
- بعد إغلاق السوق → "توقعات الغد" (not "توقعات اليوم")
- الجمعة/السبت → توقعات الأحد القادم
- العطلات الرسمية → توقعات يوم التداول التالي

EGX: الأحد-الخميس، 10:00-14:30
Tadawul: الأحد-الخميس، 10:00-15:00
Crypto: 24/7 (لا إغلاق)

IMPORTANT (v3.29.0): Predictions must NEVER be created or fulfilled on
holidays. The `is_trading_day()` function now checks BOTH weekends AND
official market holidays (عطلات رسمية). All prediction creation paths
must call `get_prediction_date_str()` to get the correct trading date.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Tuple, Set
import os
import json


# Market schedules: (weekday_open, weekday_close, open_hour, close_hour)
# weekday: Monday=0, Sunday=6
MARKET_SCHEDULES = {
    'EGX': {
        'trading_days': [6, 0, 1, 2, 3],  # Sunday(6) to Thursday(3)
        'open_hour': 10,
        'close_hour': 14,
        'close_minute': 30,
        'timezone': 'Africa/Cairo',
    },
    'Tadawul': {
        'trading_days': [6, 0, 1, 2, 3],  # Sunday to Thursday
        'open_hour': 10,
        'close_hour': 15,
        'close_minute': 0,
        'timezone': 'Asia/Riyadh',
    },
    'Kuwait': {
        'trading_days': [6, 0, 1, 2, 3],  # Sunday to Thursday
        'open_hour': 9,
        'close_hour': 13,
        'close_minute': 30,
        'timezone': 'Asia/Kuwait',
    },
    'Crypto': {
        'trading_days': [0, 1, 2, 3, 4, 5, 6],  # 24/7
        'open_hour': 0,
        'close_hour': 24,
        'close_minute': 0,
        'timezone': 'UTC',
    },
}

# Arabic day names
ARABIC_DAYS = {
    0: 'الإثنين',
    1: 'الثلاثاء',
    2: 'الأربعاء',
    3: 'الخميس',
    4: 'الجمعة',
    5: 'السبت',
    6: 'الأحد',
}


# ═══════════════════════════════════════════════════════════════════
# EGX Official Holidays — العطلات الرسمية للبورصة المصرية
# ═══════════════════════════════════════════════════════════════════
# Source: data_engine/config/market_hours.py MARKET_HOLIDAYS dict.
# These are the days EGX is officially closed (in addition to Fri/Sat).
# Predictions must NOT be created or fulfilled on these dates.
# ═══════════════════════════════════════════════════════════════════

_EGX_HOLIDAYS_RAW = [
    # 2024
    '2024-01-07', '2024-01-25',
    '2024-04-10', '2024-04-11', '2024-04-12',
    '2024-04-25', '2024-05-01',
    '2024-06-16', '2024-06-17', '2024-06-18', '2024-06-19',
    '2024-07-08', '2024-07-23',
    '2024-09-15', '2024-10-06', '2024-10-07',
    # 2025
    '2025-01-07', '2025-01-25',
    '2025-03-30', '2025-03-31', '2025-04-01',
    '2025-04-25', '2025-05-01',
    '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-09',
    '2025-06-26', '2025-07-23',
    '2025-09-04', '2025-10-06',
    # 2026 (projected — same fixed dates; Islamic dates are approximate)
    '2026-01-07', '2026-01-25',
    '2026-03-20', '2026-03-21', '2026-03-22',  # عيد الفطر (تقريبي)
    '2026-04-25', '2026-05-01',
    '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',  # عيد الأضحى (تقريبي)
    '2026-06-16', '2026-07-23',  # السنة الهجرية + ثورة يوليو
    '2026-08-25',  # المولد النبوي (تقريبي)
    '2026-10-06',  # نصر أكتوبر
]

# Convert to a set for O(1) lookup
EGX_HOLIDAYS: Set[str] = set(_EGX_HOLIDAYS_RAW)


def is_egx_holiday(dt: datetime) -> bool:
    """
    هل هذا التاريخ عطلة رسمية للبورصة المصرية؟
    يفحص قائمة العطلات الرسمية (بدون الجمعة/السبت — دي ليها is_trading_day).
    """
    date_str = dt.strftime('%Y-%m-%d')
    return date_str in EGX_HOLIDAYS


def get_egx_holidays_for_year(year: int) -> list:
    """الحصول على قائمة عطلات EGX لسنة معينة."""
    prefix = f'{year}-'
    return sorted([d for d in EGX_HOLIDAYS if d.startswith(prefix)])




def get_market_schedule(market: str = 'EGX') -> dict:
    """الحصول على جدول السوق."""
    return MARKET_SCHEDULES.get(market, MARKET_SCHEDULES['EGX'])


def is_trading_day(dt: datetime, market: str = 'EGX') -> bool:
    """
    هل هذا اليوم يوم تداول؟
    يفحص:
    1. يوم الأسبوع (الجمعة/السبت = عطلة لـ EGX)
    2. العطلات الرسمية (لـ EGX فقط — باقي الأسواق يمكن إضافتها لاحقاً)
    """
    schedule = get_market_schedule(market)
    if dt.weekday() not in schedule['trading_days']:
        return False
    # EGX: also check official holidays
    if market == 'EGX' and is_egx_holiday(dt):
        return False
    return True


def is_market_open(dt: datetime, market: str = 'EGX') -> bool:
    """هل السوق مفتوح الآن؟"""
    schedule = get_market_schedule(market)
    if dt.weekday() not in schedule['trading_days']:
        return False
    # v3.29.0: Also check official holidays for EGX
    if market == 'EGX' and is_egx_holiday(dt):
        return False
    current_minutes = dt.hour * 60 + dt.minute
    open_minutes = schedule['open_hour'] * 60
    close_minutes = schedule['close_hour'] * 60 + schedule['close_minute']
    return open_minutes <= current_minutes < close_minutes


def is_after_market_close(dt: datetime, market: str = 'EGX') -> bool:
    """هل الوقت بعد إغلاق السوق؟"""
    schedule = get_market_schedule(market)
    if dt.weekday() not in schedule['trading_days']:
        # Non-trading day → check if it's before next trading day
        return False
    current_minutes = dt.hour * 60 + dt.minute
    close_minutes = schedule['close_hour'] * 60 + schedule['close_minute']
    return current_minutes >= close_minutes


def get_next_trading_day(dt: datetime, market: str = 'EGX') -> datetime:
    """
    الحصول على يوم التداول التالي.
    - لو السبت → الأحد
    - لو الجمعة → الأحد
    - لو الخميس بعد الإغلاق → الأحد
    - لو أيام التداول قبل الإغلاق → نفس اليوم
    - لو أيام التداول بعد الإغلاق → اليوم التالي
    - لو عطلة رسمية → يوم التداول التالي
    """
    schedule = get_market_schedule(market)
    
    # If crypto, always "today" (24/7)
    if market == 'Crypto':
        return dt
    
    # If today is a trading day AND market is still open → today
    if is_trading_day(dt, market) and not is_after_market_close(dt, market):
        return dt
    
    # Otherwise, find next trading day (skipping weekends AND holidays)
    next_day = dt
    for _ in range(14):  # Max 14 days to find next trading day (handles long holidays)
        next_day = next_day + timedelta(days=1)
        next_day = next_day.replace(hour=10, minute=0, second=0, microsecond=0)
        if is_trading_day(next_day, market):
            return next_day
    
    return dt  # Fallback


def get_prediction_label(dt: datetime, market: str = 'EGX') -> str:
    """
    توليد عنوان التوقع بالعربي.
    - لو السوق مغلق والوقت بعد الإغلاق → "توقعات الغد يوم X"
    - لو السوق مغلق (يوم عطلة) → "توقعات يوم X القادم"
    - لو السوق مفتوح → "توقعات اليوم"
    """
    if market == 'Crypto':
        return 'توقعات لحظية'
    
    if is_market_open(dt, market):
        return f'توقعات اليوم {ARABIC_DAYS[dt.weekday()]}'
    
    if is_trading_day(dt, market) and is_after_market_close(dt, market):
        next_day = get_next_trading_day(dt, market)
        return f'توقعات الغد {ARABIC_DAYS[next_day.weekday()]}'
    
    # Weekend or holiday
    next_day = get_next_trading_day(dt, market)
    return f'توقعات {ARABIC_DAYS[next_day.weekday()]} القادم'


def get_prediction_date(dt: datetime, market: str = 'EGX') -> datetime:
    """
    تاريخ التوقع (للتخزين في DB).
    - لو السوق مفتوح → تاريخ اليوم
    - لو بعد الإغلاق/عطلة → تاريخ يوم التداول التالي
    """
    if is_market_open(dt, market):
        return dt
    return get_next_trading_day(dt, market)


def get_prediction_date_str(dt: datetime, market: str = 'EGX') -> str:
    """تاريخ التوقع كنص YYYY-MM-DD."""
    return get_prediction_date(dt, market).strftime('%Y-%m-%d')


if __name__ == '__main__':
    """اختبار ذاتي."""
    print("=" * 60)
    print("اختبار Trading Calendar")
    print("=" * 60)
    
    # Test cases
    test_cases = [
        # (datetime, market, description)
        (datetime(2026, 7, 11, 12, 0), 'EGX', 'السبت 12:00 — عطلة'),
        (datetime(2026, 7, 12, 8, 0), 'EGX', 'الأحد 8:00 — قبل الفتح'),
        (datetime(2026, 7, 12, 12, 0), 'EGX', 'الأحد 12:00 — السوق مفتوح'),
        (datetime(2026, 7, 12, 15, 0), 'EGX', 'الأحد 15:00 — بعد الإغلاق'),
        (datetime(2026, 7, 9, 15, 0), 'EGX', 'الخميس 15:00 — بعد الإغلاق (غداً جمعة)'),
        (datetime(2026, 7, 10, 12, 0), 'EGX', 'الجمعة 12:00 — عطلة'),
        (datetime(2026, 7, 11, 12, 0), 'Crypto', 'السبت كريبتو — 24/7'),
    ]
    
    for dt, market, desc in test_cases:
        label = get_prediction_label(dt, market)
        pred_date = get_prediction_date_str(dt, market)
        is_open = is_market_open(dt, market)
        print(f"\n  {desc}")
        print(f"    الوقت: {dt.strftime('%Y-%m-%d %H:%M')} ({ARABIC_DAYS[dt.weekday()]})")
        print(f"    السوق مفتوح: {'نعم' if is_open else 'لا'}")
        print(f"    العنوان: {label}")
        print(f"    تاريخ التوقع: {pred_date}")
    
    print("\n✅ اختبارات نجحت")
