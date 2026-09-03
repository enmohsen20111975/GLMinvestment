#!/usr/bin/env python3
"""
fetch_earnings_calendar.py
==========================
سكربت سحب تقويم الأرباح والتوزيعات من TradingView لمصر.

بيسحب بيانات الأرباح (earnings) + التوزيعات (dividends) للأسهم المصرية.
بيتشغل أسبوعياً (cron job) عشان نعرف أي أسهم فيها توزيعات قريبة.

التشغيل:
  python vps-service/jobs/fetch_earnings_calendar.py

Cron (أسبوعياً كل أحد):
  0 6 * * 0 cd /path/to/project && python vps-service/jobs/fetch_earnings_calendar.py >> logs/earnings.log 2>&1
"""

import json
import sqlite3
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

# إضافة المسارات
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

DB_PATH = PROJECT_ROOT / 'db' / 'stocks.db'
TABLE_NAME = 'earnings_calendar'


def init_db():
    """إنشاء جدول تقويم الأرباح لو مش موجود."""
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            date TEXT NOT NULL,
            type TEXT,
            -- 'earnings' or 'dividend'
            eps_estimate REAL,
            eps_actual REAL,
            revenue_estimate REAL,
            revenue_actual REAL,
            dividend_amount REAL,
            dividend_yield REAL,
            ex_dividend_date TEXT,
            record_date TEXT,
            payment_date TEXT,
            source TEXT DEFAULT 'tradingview',
            fetched_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, date, type)
        )
    ''')
    c.execute(f'CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_date ON {TABLE_NAME}(date)')
    c.execute(f'CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_ticker ON {TABLE_NAME}(ticker)')
    conn.commit()
    conn.close()
    print(f"[earnings] ✅ Table {TABLE_NAME} ready in {DB_PATH}")


def fetch_from_tradingview():
    """سحب بيانات تقويم الأرباح من TradingView API."""
    import urllib.request
    import urllib.error

    # TradingView earnings calendar API for Egypt
    # country=eg يعني مصر
    url = "https://scanner.tradingview.com/e/calendar/earnings?country=eg&from=now&to=30d"

    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('data', []) or data.get('items', [])
    except Exception as e:
        print(f"[earnings] ⚠️ TradingView fetch failed: {e}")
        return []


def fetch_dividends_from_tradingview():
    """سحب بيانات التوزيعات من TradingView."""
    import urllib.request

    url = "https://scanner.tradingview.com/e/calendar/dividends?country=eg&from=now&to=90d"

    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('data', []) or data.get('items', [])
    except Exception as e:
        print(f"[earnings] ⚠️ Dividends fetch failed: {e}")
        return []


def store_earnings(earnings_data):
    """تخزين بيانات الأرباح في DB."""
    if not earnings_data:
        print("[earnings] مفيش بيانات أرباح للتخزين")
        return 0

    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    count = 0

    for item in earnings_data:
        try:
            ticker = item.get('ticker', item.get('symbol', ''))
            name = item.get('name', item.get('description', ''))
            date = item.get('date', item.get('earningsDate', ''))
            eps_est = item.get('epsActual', item.get('eps_est', None))
            eps_act = item.get('epsActual', None)
            rev_est = item.get('revenueEstimated', None)
            rev_act = item.get('revenueActual', None)

            if not ticker or not date:
                continue

            c.execute(f'''
                INSERT OR REPLACE INTO {TABLE_NAME}
                (ticker, name, date, type, eps_estimate, eps_actual, 
                 revenue_estimate, revenue_actual, source)
                VALUES (?, ?, ?, 'earnings', ?, ?, ?, ?, 'tradingview')
            ''', (ticker, name, date, eps_est, eps_act, rev_est, rev_act))
            count += 1
        except Exception as e:
            print(f"[earnings] ⚠️ Skip {item.get('ticker', '?')}: {e}")
            continue

    conn.commit()
    conn.close()
    print(f"[earnings] ✅ Stored {count} earnings records")
    return count


def store_dividends(dividend_data):
    """تخزين بيانات التوزيعات في DB."""
    if not dividend_data:
        print("[earnings] مفيش بيانات توزيعات للتخزين")
        return 0

    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    count = 0

    for item in dividend_data:
        try:
            ticker = item.get('ticker', item.get('symbol', ''))
            name = item.get('name', item.get('description', ''))
            date = item.get('date', item.get('exDate', item.get('paymentDate', '')))
            amount = item.get('amount', item.get('dividendAmount', None))
            yield_pct = item.get('yield', item.get('dividendYield', None))
            ex_date = item.get('exDate', date)
            record_date = item.get('recordDate', '')
            payment_date = item.get('paymentDate', '')

            if not ticker or not date:
                continue

            c.execute(f'''
                INSERT OR REPLACE INTO {TABLE_NAME}
                (ticker, name, date, type, dividend_amount, dividend_yield,
                 ex_dividend_date, record_date, payment_date, source)
                VALUES (?, ?, ?, 'dividend', ?, ?, ?, ?, ?, 'tradingview')
            ''', (ticker, name, date, amount, yield_pct, ex_date, record_date, payment_date))
            count += 1
        except Exception as e:
            print(f"[earnings] ⚠️ Skip dividend {item.get('ticker', '?')}: {e}")
            continue

    conn.commit()
    conn.close()
    print(f"[earnings] ✅ Stored {count} dividend records")
    return count


def get_upcoming_events(days=14):
    """جيب الأحداث القادمة في الـ N يوم الجاية."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    today = datetime.now().strftime('%Y-%m-%d')
    future = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')

    events = c.execute(f'''
        SELECT * FROM {TABLE_NAME}
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
    ''', (today, future)).fetchall()

    conn.close()
    return events


def main():
    print("=" * 60)
    print("  TradingView Earnings Calendar Fetcher (Egypt)")
    print("=" * 60)

    init_db()

    # سحب الأرباح
    print("\n[1/4] سحب بيانات الأرباح من TradingView...")
    earnings = fetch_from_tradingview()
    print(f"  → {len(earnings)} سجل")

    # سحب التوزيعات
    print("\n[2/4] سحب بيانات التوزيعات من TradingView...")
    dividends = fetch_dividends_from_tradingview()
    print(f"  → {len(dividends)} سجل")

    # تخزين
    print("\n[3/4] تخزين البيانات...")
    store_earnings(earnings)
    store_dividends(dividends)

    # عرض الأحداث القادمة
    print("\n[4/4] الأحداث القادمة (14 يوم):")
    events = get_upcoming_events(14)
    if events:
        for e in events:
            event_type = "📊 أرباح" if e['type'] == 'earnings' else "💰 توزيع"
            print(f"  {e['date']} | {e['ticker']:<8} | {e['name'] or '—':<30} | {event_type}")
    else:
        print("  مفيش أحداث قادمة")

    print("\n" + "=" * 60)
    print("  ✅ Done")
    print("=" * 60)


if __name__ == '__main__':
    main()
