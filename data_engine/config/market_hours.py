#!/usr/bin/env python3
"""
📊 أوقات عمل البورصات العربية
==============================
جميع الأوقات بالتوقيت المصري (GMT+2 / Africa/Cairo)

الأسواق المدعومة:
- مصر (EGX)
- السعودية (TADAWUL)
- الكويت (Boursa Kuwait)
- قطر (QSE)
"""

from datetime import datetime, time, timedelta
from typing import Dict, List, Optional, Tuple

# Safe pytz import with zoneinfo fallback (Python 3.9+)
try:
    import pytz
    EGYPT_TZ = pytz.timezone('Africa/Cairo')
except ImportError:
    from zoneinfo import ZoneInfo
    EGYPT_TZ = ZoneInfo('Africa/Cairo')

# فرق التوقيت عن مصر (بالساعات)
TIMEZONE_OFFSET = {
    'مصر': 0,        # GMT+2
    'السعودية': 1,   # GMT+3
    'الكويت': 1,     # GMT+3
    'قطر': 1,        # GMT+3
}

# أوقات العمل بالتوقيت المحلي لكل سوق
MARKET_HOURS_LOCAL = {
    'مصر': {
        'name': 'EGX - البورصة المصرية',
        'days': [6, 0, 1, 2, 3],  # الأحد=6، الإثنين=0، ... الخميس=3
        'pre_open': (9, 30),      # 9:30 ص
        'open': (10, 0),          # 10:00 ص
        'close': (14, 30),        # 2:30 م — 🔥 P0 FIX: كان 14:15 (غلط)، الصحيح 14:30 حسب EGX
        'timezone': 'Africa/Cairo'
    },
    'السعودية': {
        'name': 'TADAWUL - السوق المالية السعودية',
        'days': [6, 0, 1, 2, 3],  # الأحد - الخميس
        'pre_open': (9, 30),      # 9:30 ص (بتوقيت السعودية)
        'open': (10, 0),          # 10:00 ص (بتوقيت السعودية)
        'close': (15, 0),         # 3:00 م (بتوقيت السعودية)
        'timezone': 'Asia/Riyadh'
    },
    'الكويت': {
        'name': 'Boursa Kuwait - بورصة الكويت',
        'days': [6, 0, 1, 2, 3],  # الأحد - الخميس
        'pre_open': (7, 30),      # 7:30 ص (بتوقيت الكويت)
        'open': (9, 0),           # 9:00 ص (بتوقيت الكويت)
        'close': (13, 0),         # 1:00 م (بتوقيت الكويت)
        'timezone': 'Asia/Kuwait'
    },
    'قطر': {
        'name': 'QSE - بورصة قطر',
        'days': [6, 0, 1, 2, 3],  # الأحد - الخميس
        'pre_open': (9, 0),       # 9:00 ص (بتوقيت قطر)
        'open': (9, 30),          # 9:30 ص (بتوقيت قطر)
        'close': (13, 15),        # 1:15 م (بتوقيت قطر)
        'timezone': 'Asia/Qatar'
    }
}

# الأجازات الرسمية لكل سوق (2024-2026)
MARKET_HOLIDAYS = {
    'مصر': {
        '2024': [
            '2024-01-07',  # عيد الميلاد المجيد (الأقباط)
            '2024-01-25',  # ثورة 25 يناير
            '2024-04-10',  # عيد الفطر
            '2024-04-11',
            '2024-04-12',
            '2024-04-25',  # سيناء
            '2024-05-01',  # عيد العمال
            '2024-06-16',  # عيد الأضحى
            '2024-06-17',
            '2024-06-18',
            '2024-06-19',
            '2024-07-08',  # السنة الهجرية
            '2024-07-23',  # ثورة يوليو
            '2024-09-15',  # المولد النبوي
            '2024-10-06',  # نصر أكتوبر
            '2024-10-07',
        ],
        '2025': [
            '2025-01-07',  # عيد الميلاد المجيد (الأقباط)
            '2025-01-25',  # ثورة 25 يناير
            '2025-03-30',  # عيد الفطر (تقريبي)
            '2025-03-31',
            '2025-04-01',
            '2025-04-25',  # سيناء
            '2025-05-01',  # عيد العمال
            '2025-06-06',  # عيد الأضحى (تقريبي)
            '2025-06-07',
            '2025-06-08',
            '2025-06-09',
            '2025-06-26',  # السنة الهجرية (تقريبي)
            '2025-07-23',  # ثورة يوليو
            '2025-09-04',  # المولد النبوي (تقريبي)
            '2025-10-06',  # نصر أكتوبر
        ],
        # 🔥 P0 FIX: 2026 كانت ناقصة بالكامل → كل فحوصات العطل كانت no-op
        # تواريخ إسلامية تقريبية (بتعتمد على رؤية الهلال، ممكن تختلف ±1 يوم)
        '2026': [
            '2026-01-07',  # عيد الميلاد المجيد (الأقباط)
            '2026-01-25',  # ثورة 25 يناير
            '2026-03-20',  # عيد الفطر (تقريبي)
            '2026-03-21',
            '2026-03-22',
            '2026-04-25',  # تحرير سيناء
            '2026-05-01',  # عيد العمال
            '2026-05-27',  # عيد الأضحى (تقريبي)
            '2026-05-28',
            '2026-05-29',
            '2026-05-30',
            '2026-06-16',  # السنة الهجرية (تقريبي)
            '2026-07-23',  # ثورة يوليو
            '2026-09-04',  # المولد النبوي (تقريبي)
            '2026-10-06',  # نصر أكتوبر
        ],
    },
    'السعودية': {
        '2024': [
            '2024-02-22',  # يوم التأسيس
            '2024-03-11',  # بداية رمضان
            '2024-04-10',  # عيد الفطر
            '2024-04-11',
            '2024-04-12',
            '2024-04-13',
            '2024-04-14',
            '2024-09-23',  # اليوم الوطني
            '2024-06-16',  # عيد الأضحى
            '2024-06-17',
            '2024-06-18',
            '2024-06-19',
            '2024-06-20',
            '2024-06-21',
            '2024-07-08',  # السنة الهجرية
        ],
        '2025': [
            '2025-02-22',  # يوم التأسيس
            '2025-03-30',  # عيد الفطر (تقريبي)
            '2025-03-31',
            '2025-04-01',
            '2025-04-02',
            '2025-04-03',
            '2025-09-23',  # اليوم الوطني
            '2025-06-06',  # عيد الأضحى (تقريبي)
            '2025-06-07',
            '2025-06-08',
            '2025-06-09',
            '2025-06-10',
            '2025-06-11',
            '2025-06-26',  # السنة الهجرية (تقريبي)
        ]
    },
    'الكويت': {
        '2024': [
            '2024-02-25',  # اليوم الوطني
            '2024-02-26',  # يوم التحرير
            '2024-04-10',  # عيد الفطر
            '2024-04-11',
            '2024-04-12',
            '2024-06-16',  # عيد الأضحى
            '2024-06-17',
            '2024-06-18',
            '2024-07-08',  # السنة الهجرية
            '2024-09-15',  # المولد النبوي
        ],
        '2025': [
            '2025-02-25',  # اليوم الوطني
            '2025-02-26',  # يوم التحرير
            '2025-03-30',  # عيد الفطر (تقريبي)
            '2025-03-31',
            '2025-04-01',
            '2025-06-06',  # عيد الأضحى (تقريبي)
            '2025-06-07',
            '2025-06-08',
            '2025-06-26',  # السنة الهجرية (تقريبي)
            '2025-09-04',  # المولد النبوي (تقريبي)
        ]
    },
    'قطر': {
        '2024': [
            '2024-02-06',  # يوم الرياضة
            '2024-04-10',  # عيد الفطر
            '2024-04-11',
            '2024-04-12',
            '2024-06-16',  # عيد الأضحى
            '2024-06-17',
            '2024-06-18',
            '2024-07-08',  # السنة الهجرية
            '2024-09-15',  # المولد النبوي
            '2024-12-18',  # اليوم الوطني
        ],
        '2025': [
            '2025-02-11',  # يوم الرياضة
            '2025-03-30',  # عيد الفطر (تقريبي)
            '2025-03-31',
            '2025-04-01',
            '2025-06-06',  # عيد الأضحى (تقريبي)
            '2025-06-07',
            '2025-06-08',
            '2025-06-26',  # السنة الهجرية (تقريبي)
            '2025-09-04',  # المولد النبوي (تقريبي)
            '2025-12-18',  # اليوم الوطني
        ]
    }
}


def get_egypt_time() -> datetime:
    """الحصول على الوقت الحالي بالتوقيت المصري"""
    return datetime.now(EGYPT_TZ)


def convert_to_egypt_time(local_time: time, market: str) -> time:
    """تحويل الوقت المحلي للسوق إلى التوقيت المصري"""
    offset = TIMEZONE_OFFSET.get(market, 0)
    hours = local_time.hour - offset
    minutes = local_time.minute
    
    # التعامل مع تجاوز اليوم
    if hours < 0:
        hours += 24
    elif hours >= 24:
        hours -= 24
    
    return time(hours, minutes)


def is_market_open(market: str, check_time: Optional[datetime] = None) -> Tuple[bool, str]:
    """
    التحقق مما إذا كان السوق مفتوحاً
    
    Returns:
        (is_open, status_message)
    """
    if check_time is None:
        check_time = get_egypt_time()
    
    config = MARKET_HOURS_LOCAL.get(market)
    if not config:
        return False, f"السوق '{market}' غير معروف"
    
    # التحقق من اليوم
    weekday = check_time.weekday()  # 0=الإثنين، 6=الأحد
    if weekday not in config['days']:
        day_names = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']
        return False, f"السوق مغلق اليوم ({day_names[weekday]})"
    
    # التحقق من الأجازات
    date_str = check_time.strftime('%Y-%m-%d')
    year = str(check_time.year)
    holidays = MARKET_HOLIDAYS.get(market, {}).get(year, [])
    if date_str in holidays:
        return False, f"السوق مغلق (أجازة رسمية)"
    
    # تحويل وقت التحقق إلى توقيت السوق المحلي
    try:
        import pytz
        market_tz = pytz.timezone(config['timezone'])
    except ImportError:
        from zoneinfo import ZoneInfo
        market_tz = ZoneInfo(config['timezone'])
    market_time = check_time.astimezone(market_tz)
    current_time = market_time.time()
    
    # التحقق من وقت العمل
    open_time = time(*config['open'])
    close_time = time(*config['close'])
    
    if open_time <= current_time < close_time:
        return True, "السوق مفتوح"
    elif current_time < open_time:
        return False, f"السوق مغلق (يفتح الساعة {config['open'][0]:02d}:{config['open'][1]:02d})"
    else:
        return False, "السوق مغلق (انتهى التداول)"


def get_market_status(market: str) -> Dict:
    """الحصول على حالة السوق الكاملة"""
    now = get_egypt_time()
    is_open, message = is_market_open(market, now)
    config = MARKET_HOURS_LOCAL[market]
    
    # تحويل الأوقات للتوقيت المصري
    open_egypt = convert_to_egypt_time(time(*config['open']), market)
    close_egypt = convert_to_egypt_time(time(*config['close']), market)
    
    return {
        'market': market,
        'name': config['name'],
        'is_open': is_open,
        'status': message,
        'local_time': now.strftime('%H:%M:%S'),
        'market_open_local': f"{config['open'][0]:02d}:{config['open'][1]:02d}",
        'market_close_local': f"{config['close'][0]:02d}:{config['close'][1]:02d}",
        'market_open_egypt': open_egypt.strftime('%H:%M'),
        'market_close_egypt': close_egypt.strftime('%H:%M'),
        'working_days': 'الأحد - الخميس'
    }


def get_all_markets_status() -> List[Dict]:
    """الحصول على حالة جميع الأسواق"""
    return [get_market_status(market) for market in MARKET_HOURS_LOCAL.keys()]


def should_fetch_data(market: str) -> Tuple[bool, str]:
    """
    تحديد ما إذا كان يجب سحب البيانات للسوق
    
    Returns:
        (should_fetch, reason)
    """
    is_open, message = is_market_open(market)
    
    if is_open:
        return True, "السوق مفتوح - سحب البيانات"
    else:
        return False, message


def get_next_market_event(market: str) -> Dict:
    """الحصول على الحدث القادم للسوق (فتح أو إغلاق)"""
    now = get_egypt_time()
    config = MARKET_HOURS_LOCAL[market]
    
    is_open, _ = is_market_open(market, now)
    
    if is_open:
        # السوق مفتوح - متى يغلق؟
        close_egypt = convert_to_egypt_time(time(*config['close']), market)
        next_event = now.replace(hour=close_egypt.hour, minute=close_egypt.minute, second=0)
        return {
            'event': 'close',
            'time': next_event.strftime('%H:%M'),
            'message': f'يغلق الساعة {next_event.strftime("%H:%M")} بتوقيت مصر'
        }
    else:
        # السوق مغلق - متى يفتح؟
        open_egypt = convert_to_egypt_time(time(*config['open']), market)
        
        # لو اليوم من أيام العمل
        if now.weekday() in config['days']:
            open_time = now.replace(hour=open_egypt.hour, minute=open_egypt.minute, second=0)
            if open_time > now:
                return {
                    'event': 'open',
                    'time': open_time.strftime('%H:%M'),
                    'message': f'يفتح الساعة {open_time.strftime("%H:%M")} بتوقيت مصر'
                }
        
        # لو اجازة أو انتهى التداول - يفتح يوم العمل القادم
        days_ahead = 0
        for i in range(1, 8):
            next_day = now + timedelta(days=i)
            if next_day.weekday() in config['days']:
                days_ahead = i
                break
        
        next_work_day = now + timedelta(days=days_ahead)
        next_open = next_work_day.replace(hour=open_egypt.hour, minute=open_egypt.minute, second=0)
        
        day_names = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']
        return {
            'event': 'open',
            'time': next_open.strftime('%H:%M'),
            'day': day_names[next_work_day.weekday()],
            'message': f'يفتح يوم {day_names[next_work_day.weekday()]} الساعة {next_open.strftime("%H:%M")} بتوقيت مصر'
        }


def print_market_schedule():
    """طباعة جدول عمل الأسواق"""
    print("\n" + "=" * 80)
    print("📊 جدول عمل البورصات العربية (بالتوقيت المصري)")
    print("=" * 80)
    
    print(f"\n{'السوق':<25} {'يفتح':<12} {'يغلق':<12} {'الحالة':<15} {'الحدث القادم':<20}")
    print("-" * 80)
    
    now = get_egypt_time()
    print(f"التوقيت الحالي: {now.strftime('%Y-%m-%d %H:%M:%S')} (توقيت مصر)")
    print("-" * 80)
    
    for market in MARKET_HOURS_LOCAL.keys():
        status = get_market_status(market)
        next_event = get_next_market_event(market)
        
        state = "🟢 مفتوح" if status['is_open'] else "🔴 مغلق"
        
        print(f"{status['name']:<25} {status['market_open_egypt']:<12} {status['market_close_egypt']:<12} {state:<15} {next_event['message']:<20}")
    
    print("\n" + "=" * 80)


if __name__ == '__main__':
    # طباعة جدول الأسواق
    print_market_schedule()
    
    # طباعة حالة كل سوق
    print("\n📋 تفاصيل كل سوق:")
    for market in MARKET_HOURS_LOCAL.keys():
        status = get_market_status(market)
        should_fetch, reason = should_fetch_data(market)
        print(f"\n{status['name']}:")
        print(f"  الحالة: {status['status']}")
        print(f"  سحب البيانات: {'✅ نعم' if should_fetch else '❌ لا'} - {reason}")
        print(f"  وقت الفتح (توقيت مصر): {status['market_open_egypt']}")
        print(f"  وقت الإغلاق (توقيت مصر): {status['market_close_egypt']}")
