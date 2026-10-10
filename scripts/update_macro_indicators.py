#!/usr/bin/env python3
"""
update_macro_indicators.py — تحديث بيانات الاقتصاد الكلي
========================================================
يحدّث جدول macro_indicators بأسعار الدولار والفائدة.
يحاول جلب البيانات من data_engine.db (exchange_rates) لو متاحة.
"""
import sqlite3
import os
import json
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).parent.parent
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'


def get_usd_from_data_engine():
    """يجلب سعر الدولار من data_engine.db لو متاح."""
    try:
        conn = sqlite3.connect(str(DATA_ENGINE_DB))
        cur = conn.cursor()
        cur.execute("""
            SELECT rate, date FROM exchange_rates
            WHERE currency LIKE '%USD%' OR currency LIKE '%دولار%'
            ORDER BY date DESC LIMIT 1
        """)
        row = cur.fetchone()
        conn.close()
        if row and row[0] and row[0] > 0:
            return row[0], row[1]
    except Exception:
        pass
    return None, None


def calculate_usd_change_3d():
    """يحسب نسبة تغير الدولار خلال 3 أيام."""
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        cur = conn.cursor()
        cur.execute("""
            SELECT usd_to_egp, date FROM macro_indicators
            ORDER BY date DESC LIMIT 4
        """)
        rows = cur.fetchall()
        conn.close()
        if len(rows) >= 2:
            latest = rows[0][0]
            oldest = rows[-1][0]
            if oldest and oldest > 0 and latest:
                return round(((latest - oldest) / oldest) * 100, 2)
        return 0.0
    except Exception:
        return 0.0


def get_egypt_inflation():
    """ROBO-ADVISOR-P3: جلب معدل التضخم المصري السنوي.
    
    بيحاول يجيب القيمة من مصادر عامة (TradingView/CBE). لو فشل،
    بيستخدم آخر قيمة معروفة أو قيمة افتراضية معقولة.
    """
    # 1. محاولة جلب من TradingView widget API (CPI Egypt)
    try:
        import urllib.request
        url = "https://www.tradingview.com/symbols/CPIEGY/"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
        # بحث عن نسبة التضخم في الـ HTML
        import re
        m = re.search(r'(\d{1,2}\.\d)\s*%', html)
        if m:
            val = float(m.group(1))
            if 5 < val < 60:  # نطاق معقول للتضخم المصري
                return val
    except Exception:
        pass

    # 2. قيمة افتراضية معقولة (تضخم مصر التقريبي 2025-2026)
    # ملاحظة: دي قيمة احتياطية — المفروض تتحدث من CBE أو CAPMAS
    return 30.0


def main():
    print("═══ تحديث بيانات الاقتصاد الكلي ═══")

    # 1. تأكد من وجود الجدول
    conn = sqlite3.connect(str(STOCKS_DB))
    conn.execute('''CREATE TABLE IF NOT EXISTS macro_indicators (
        date TEXT PRIMARY KEY,
        usd_to_egp REAL,
        cbe_interest_rate REAL,
        usd_change_3d REAL,
        created_at TEXT DEFAULT (datetime('now'))
    )''')
    conn.commit()

    # 2. جلب سعر الدولار
    usd_rate, usd_date = get_usd_from_data_engine()
    if usd_rate is None:
        # استخدم آخر قيمة معروفة أو القيمة الافتراضية
        cur = conn.cursor()
        cur.execute("SELECT usd_to_egp FROM macro_indicators ORDER BY date DESC LIMIT 1")
        row = cur.fetchone()
        usd_rate = row[0] if row and row[0] else 48.5
        print(f"  ℹ️ لا توجد بيانات دولار من data_engine — استخدام: {usd_rate}")

    # 3. سعر الفائدة (ثابت حالياً — يحتاج تحديث يدوي)
    cbe_rate = 27.25  # القيمة الحالية للسوق المصري

    # 4. حساب تغير 3 أيام
    usd_change_3d = calculate_usd_change_3d()

    # 5. إدراج/تحديث بيانات اليوم
    today = datetime.now().strftime('%Y-%m-%d')
    conn.execute('''
        INSERT OR REPLACE INTO macro_indicators (date, usd_to_egp, cbe_interest_rate, usd_change_3d)
        VALUES (?, ?, ?, ?)
    ''', (today, usd_rate, cbe_rate, usd_change_3d))
    conn.commit()

    print(f"  ✅ USD/EGP: {usd_rate}")
    print(f"  ✅ CBE Interest Rate: {cbe_rate}%")
    print(f"  ✅ USD Change 3d: {usd_change_3d}%")

    # ROBO-ADVISOR-P3: جلب معدل التضخم المصري
    inflation_rate = get_egypt_inflation()
    print(f"  ✅ Egypt Inflation: {inflation_rate}%")
    # إرسال التضخم للـ finance DB (عشان محرك العائد الحقيقي يستخدمه)
    try:
        import urllib.request
        url = "http://127.0.0.1:3000/api/finance/inflation"
        data = json.dumps({"rate": inflation_rate, "source": "update_macro_indicators"}).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"  ✅ Inflation posted to finance DB: {resp.status}")
    except Exception as ie:
        print(f"  ⚠️ Could not post inflation to finance DB: {ie}")

    # 6. عرض آخر 5 سجلات
    cur = conn.cursor()
    cur.execute("SELECT * FROM macro_indicators ORDER BY date DESC LIMIT 5")
    print("\n  آخر 5 سجلات:")
    for r in cur.fetchall():
        print(f"    {r[0]}: USD={r[1]}, Rate={r[2]}%, Change3d={r[3]}%")

    conn.close()
    print("\n═══ تم ═══")


if __name__ == '__main__':
    main()
