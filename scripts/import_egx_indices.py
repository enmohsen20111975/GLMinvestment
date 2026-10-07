#!/usr/bin/env python3
"""
import_egx_indices.py — استيراد بيانات مؤشرات EGX30 و EGX70 التاريخية
======================================================================

يقرأ ملفات CSV المرفوعة من Documentation/المؤشرات/ ويستوردها إلى:
  1. data_engine.db — جدول historical_data (الأسعار التاريخية)
  2. stocks.db — جدول market_indices (آخر قيمة + تحديث)

الملفات المتوقعة:
  - بيانات تاريخية - مؤشر EGX 30 (1).csv → EGX30 (174 يوم تاريخي)
  - بيانات تاريخية - مؤشر البورصة المصرية إيجي إكس 70 (1).csv → EGX70
  - (EGX30) مؤشر EGX 30.csv → مكونات EGX30 (الأسهم الأعضاء)

الـ CSV يحتوي:
  تاريخ, اخر سعر, سعر الفتح, عالي, منخفض, الحجم, التغير %
  التاريخ بصيغة: DD/MM/YYYY (مع علامات RLM/LRM)
  الأرقام بفواصل الآلاف: "53,776.69"
  الحجم: "289.98M" أو "1.60B"

Usage:
  python3 scripts/import_egx_indices.py
  python3 scripts/import_egx_indices.py --db=data_engine.db
"""

import csv
import os
import re
import sys
import sqlite3
import argparse
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INDICES_DIR = PROJECT_ROOT / "Documentation" / "المؤشرات"

# ملفات الـ CSV
HISTORICAL_FILES = {
    "EGX30": "بيانات تاريخية - مؤشر EGX 30 (1).csv",
    "EGX70": "بيانات تاريخية - مؤشر البورصة المصرية إيجي إكس 70 (1).csv",
}

CONSTITUENTS_FILE = "(EGX30) مؤشر EGX 30.csv"

DATA_ENGINE_DB = PROJECT_ROOT / "db" / "data_engine.db"
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"


def clean_str(s: str) -> str:
    """إزالة علامات RTL/LTR والتنظيف."""
    return (s.replace("\u200f", "")
             .replace("\u200e", "")
             .replace("\u202a", "")
             .replace("\u202c", "")
             .replace("\ufeff", "")
             .strip())


def parse_number(s: str) -> float:
    """تحويل النص لرقم (إزالة الفواصل وعلامات النسبة)."""
    s = clean_str(s).replace(",", "").replace("%", "").replace("+", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_volume(s: str) -> int:
    """تحويل الحجم (مثل 289.98M أو 1.60B)."""
    s = clean_str(s).upper().replace(",", "")
    m = re.match(r"^([\d.]+)\s*([BKMGT]?)$", s)
    if not m:
        try:
            return int(float(s))
        except ValueError:
            return 0
    val = float(m.group(1))
    unit = m.group(2)
    mult = {"B": 1_000_000_000, "M": 1_000_000, "K": 1_000, "T": 1_000_000_000_000}
    return int(val * mult.get(unit, 1))


def parse_date(s: str) -> str:
    """تحويل التاريخ من DD/MM/YYYY إلى YYYY-MM-DD."""
    s = clean_str(s)
    # أحياناً التاريخ فيه شرطة مائلة / أو شرطة عادية -
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


def import_historical_data(symbol: str, csv_file: Path, db_path: Path):
    """استيراد البيانات التاريخية إلى data_engine.db.historical_data."""
    print(f"\n{'='*60}")
    print(f"استيراد {symbol} من {csv_file.name}")
    print(f"{'='*60}")

    if not csv_file.exists():
        print(f"❌ الملف غير موجود: {csv_file}")
        return 0

    rows = []
    with open(csv_file, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = next(reader)
        print(f"الرؤوس: {headers}")

        for r in reader:
            if not r or len(r) < 7:
                continue
            try:
                date = parse_date(r[0])
                close = parse_number(r[1])
                open_price = parse_number(r[2])
                high = parse_number(r[3])
                low = parse_number(r[4])
                volume = parse_volume(r[5])
                change_pct = parse_number(r[6])

                if close <= 0:
                    continue

                rows.append({
                    "symbol": symbol,
                    "name": f"مؤشر {symbol}",
                    "market": "مصر",
                    "date": date,
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": volume,
                    "change_pct": change_pct,
                })
            except Exception as e:
                print(f"  ⚠️ خطأ في صف: {e}")
                continue

    if not rows:
        print("❌ لا توجد بيانات صالحة")
        return 0

    # ترتيب تصاعدي حسب التاريخ
    rows.sort(key=lambda x: x["date"])

    print(f"📊 عدد السجلات: {len(rows)}")
    print(f"📅 من {rows[0]['date']} إلى {rows[-1]['date']}")
    print(f"💰 آخر سعر: {rows[-1]['close']:.2f}")
    print(f"📈 أعلى سعر: {max(r['high'] for r in rows):.2f}")
    print(f"📉 أدنى سعر: {min(r['low'] for r in rows):.2f}")

    # حفظ في data_engine.db
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    # إنشاء الجدول لو مش موجود
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS historical_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT, name TEXT, market TEXT,
            date TEXT, open REAL, high REAL, low REAL, close REAL,
            volume INTEGER, last_fetch TEXT,
            UNIQUE(symbol, date)
        )
    """)

    saved = 0
    for r in rows:
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO historical_data
                (symbol, name, market, date, open, high, low, close, volume, last_fetch)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (
                r["symbol"], r["name"], r["market"],
                r["date"], r["open"], r["high"], r["low"], r["close"],
                r["volume"],
            ))
            saved += 1
        except Exception as e:
            print(f"  ⚠️ خطأ حفظ {r['date']}: {e}")

    conn.commit()

    # تحديث market_indices في stocks.db
    latest = rows[-1]
    prev = rows[-2] if len(rows) > 1 else latest
    change = latest["close"] - prev["close"]
    change_pct = (change / prev["close"] * 100) if prev["close"] > 0 else 0

    stocks_conn = sqlite3.connect(str(STOCKS_DB))
    stocks_cursor = stocks_conn.cursor()

    # إنشاء الجدول لو مش موجود
    stocks_cursor.execute("""
        CREATE TABLE IF NOT EXISTS market_indices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE,
            name TEXT, name_ar TEXT,
            current_value REAL, previous_close REAL,
            change REAL, change_percent REAL,
            is_shariah INTEGER DEFAULT 0,
            last_update TEXT
        )
    """)

    stocks_cursor.execute("""
        INSERT INTO market_indices (symbol, name, name_ar, current_value, previous_close, change, change_percent, last_update)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(symbol) DO UPDATE SET
            current_value = excluded.current_value,
            previous_close = excluded.previous_close,
            change = excluded.change,
            change_percent = excluded.change_percent,
            last_update = excluded.last_update
    """, (
        symbol,
        f"{symbol} Index",
        f"مؤشر {symbol}",
        latest["close"],
        prev["close"],
        round(change, 2),
        round(change_pct, 4),
    ))

    stocks_conn.commit()
    stocks_conn.close()
    conn.close()

    print(f"✅ تم حفظ {saved} سجل في data_engine.db.historical_data")
    print(f"✅ تم تحديث market_indices: {symbol} = {latest['close']:.2f} (prev: {prev['close']:.2f}, change: {change_pct:+.2f}%)")
    return saved


def import_constituents(csv_file: Path, db_path: Path):
    """استيراد مكونات المؤشر (الأسهم الأعضاء) وتحديث is_egx30 flags."""
    print(f"\n{'='*60}")
    print(f"استيراد مكونات EGX30 من {csv_file.name}")
    print(f"{'='*60}")

    if not csv_file.exists():
        print(f"❌ الملف غير موجود: {csv_file}")
        return 0

    constituents = []
    with open(csv_file, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = next(reader)
        print(f"الرؤوس: {headers}")

        for r in reader:
            if not r or len(r) < 2:
                continue
            name_ar = clean_str(r[0])
            price = parse_number(r[1]) if len(r) > 1 else 0
            if name_ar and len(name_ar) > 2:
                constituents.append({"name_ar": name_ar, "price": price})

    print(f"📊 عدد المكونات: {len(constituents)}")

    # تحديث is_egx30 = 1 للأسهم المطابقة بالاسم
    conn = sqlite3.connect(str(STOCKS_DB))
    cursor = conn.cursor()

    # أولاً: تصفير كل is_egx30
    try:
        cursor.execute("UPDATE stocks SET is_egx30 = 0 WHERE market = 'EGX'")
    except Exception:
        pass

    matched = 0
    for c in constituents:
        name_ar = c["name_ar"]
        # البحث بالاسم العربي أو جزء منه
        cursor.execute("""
            SELECT ticker FROM stocks
            WHERE market = 'EGX'
              AND (name_ar LIKE ? OR name LIKE ? OR name_ar = ?)
        """, (f"%{name_ar}%", f"%{name_ar}%", name_ar))
        result = cursor.fetchone()
        if result:
            ticker = result[0]
            try:
                cursor.execute("UPDATE stocks SET is_egx30 = 1 WHERE ticker = ?", (ticker,))
                matched += 1
                print(f"  ✓ {name_ar} → {ticker}")
            except Exception:
                pass
        else:
            print(f"  ✗ {name_ar} — غير موجود في stocks.db")

    conn.commit()
    conn.close()

    print(f"✅ تم تحديث {matched} سهم كأعضاء EGX30")
    return matched


def main():
    parser = argparse.ArgumentParser(description="استيراد بيانات مؤشرات EGX")
    parser.add_argument("--indices-dir", default=str(INDICES_DIR),
                        help="مجلد ملفات CSV")
    parser.add_argument("--data-engine-db", default=str(DATA_ENGINE_DB),
                        help="مسار data_engine.db")
    args = parser.parse_args()

    indices_dir = Path(args.indices_dir)
    data_engine_db = Path(args.data_engine_db)

    print("=" * 60)
    print("استيراد بيانات مؤشرات EGX (EGX30 + EGX70)")
    print("=" * 60)
    print(f"مجلد الملفات: {indices_dir}")
    print(f"data_engine.db: {data_engine_db}")
    print(f"stocks.db: {STOCKS_DB}")

    total = 0

    # 1. استيراد البيانات التاريخية
    for symbol, filename in HISTORICAL_FILES.items():
        csv_path = indices_dir / filename
        total += import_historical_data(symbol, csv_path, data_engine_db)

    # 2. استيراد مكونات EGX30
    constituents_path = indices_dir / CONSTITUENTS_FILE
    import_constituents(constituents_path, STOCKS_DB)

    print(f"\n{'='*60}")
    print(f"✅ اكتمل! إجمالي السجلات: {total}")
    print(f"{'='*60}")

    # عرض النتيجة النهائية
    conn = sqlite3.connect(str(STOCKS_DB))
    cursor = conn.cursor()
    print("\n📊 المؤشرات بعد التحديث:")
    cursor.execute("SELECT symbol, current_value, previous_close, change, change_percent, last_update FROM market_indices ORDER BY symbol")
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:.2f} | prev: {row[2]:.2f} | chg: {row[3]:.2f} | pct: {row[4]:.2f}% | {row[5]}")
    conn.close()


if __name__ == "__main__":
    main()
