#!/usr/bin/env python3
"""
update_market_indices.py — تحديث مؤشرات السوق من TradingView REST
================================================================================

FIX v2 (2026-10-08):
  - إصلاح HTTP 400: استخدام نفس طريقة tradingview_rest.py (POST JSON مع columns)
  - إصلاح schema: auto-migration (ALTER TABLE + CREATE IF NOT EXISTS)
  - استخدام scanner.tradingview.com/egypt/scan مع filter للمؤشرات

الاستخدام:
  cd ~/my_apps/GLMinvestment (أو /root/GLMinvestment)
  .venv/bin/python vps-service/scripts/update_market_indices.py --dry-run
  .venv/bin/python vps-service/scripts/update_market_indices.py
================================================================================
"""

import sqlite3
import urllib.request
import urllib.error
import json
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'stocks.db'
DRY_RUN = '--dry-run' in sys.argv

# TradingView Scanner — نفس طريقة tradingview_rest.py
TV_SCANNER_URL = 'https://scanner.tradingview.com/egypt/scan'
TV_COLUMNS = [
    'name', 'description', 'logoid', 'currency_code',
    'last', 'change', 'change_abs', 'Recommend.All',
    'high', 'low', 'volume', 'market_cap_basic',
    'sector', 'industry',
]

# المؤشرات المطلوبة (نبحث عنها في نتائج scan)
# TradingView يرجع المؤشرات كجزء من scan نتائج EGX
INDEX_NAMES = {
    'EGX30': {'tv_name': 'EGX 30 PR', 'name_ar': 'مؤشر egx 30'},
    'EGX70': {'tv_name': 'EGX 70 PR', 'name_ar': 'مؤشر egx 70'},
    'EGX100': {'tv_name': 'EGX 100 PR', 'name_ar': 'مؤشر egx 100'},
}


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


def fetch_indices_from_tv() -> list:
    """جلب كل بيانات EGX من TradingView scanner ثم فلترة المؤشرات"""
    try:
        body = {
            'range': [0, 500],
            'columns': TV_COLUMNS,
            'sort': {'sortBy': 'name', 'sortOrder': 'asc'},
            'markets': ['egypt'],
        }
        payload = json.dumps(body).encode('utf-8')
        req = urllib.request.Request(
            TV_SCANNER_URL,
            data=payload,
            headers={
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Content-Type': 'application/json',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        if not data or not data.get('data'):
            log("  ❌ TradingView رجع 0 نتائج", 'ERROR')
            return []

        results = []
        for row in data['data']:
            symbol = row.get('s', '')
            d = row.get('d', {})
            name = d.get('description', '') or d.get('name', '')

            # ابحث عن المؤشرات بالاسم
            for idx_symbol, idx_info in INDEX_NAMES.items():
                tv_name = idx_info['tv_name']
                # TradingView يستخدم رموز مثل "EGX30" أو "EGX:EGX30"
                if symbol == f"EGX:{idx_symbol}" or symbol == idx_symbol or tv_name in name:
                    value = d.get('last', 0) or d.get('close', 0)
                    if value and value > 0:
                        results.append({
                            'symbol': idx_symbol,
                            'name_ar': idx_info['name_ar'],
                            'value': float(value),
                            'change': float(d.get('change', 0) or 0),
                            'change_percent': float(d.get('change_abs', d.get('change', 0)) or 0),
                            'high': float(d.get('high', 0) or 0),
                            'low': float(d.get('low', 0) or 0),
                            'volume': float(d.get('volume', 0) or 0),
                        })
                        break

        return results
    except Exception as e:
        log(f"  ❌ خطأ في جلب المؤشرات: {e}", 'ERROR')
        return []


def ensure_table_schema(conn):
    """تأكد من وجود جدول market_indices بالـ schema الصحيح"""
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_indices'")
    exists = cur.fetchone()

    if not exists:
        log("  إنشاء جدول market_indices...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_indices (
                symbol TEXT PRIMARY KEY,
                name_ar TEXT,
                value REAL,
                change REAL,
                change_percent REAL,
                high REAL,
                low REAL,
                volume REAL,
                last_update TEXT,
                source TEXT DEFAULT 'tradingview_rest'
            )
        """)
        conn.commit()
        return

    # الجدول موجود — تحقق من الأعمدة
    cols = [row[1] for row in cur.execute("PRAGMA table_info(market_indices)").fetchall()]
    migrations = [
        ('value', 'REAL'),
        ('change', 'REAL'),
        ('change_percent', 'REAL'),
        ('high', 'REAL'),
        ('low', 'REAL'),
        ('volume', 'REAL'),
        ('last_update', 'TEXT'),
        ('source', "TEXT DEFAULT 'tradingview_rest'"),
    ]
    for col_name, col_type in migrations:
        if col_name not in cols:
            try:
                cur.execute(f"ALTER TABLE market_indices ADD COLUMN {col_name} {col_type}")
                log(f"  ✅ أضيف عمود {col_name}")
            except Exception:
                pass
    conn.commit()


def update_market_indices():
    log("=" * 60)
    log("📊 تحديث مؤشرات السوق (market_indices) من TradingView REST")
    log("=" * 60)

    if not DB_PATH.exists():
        log(f"❌ قاعدة البيانات غير موجودة: {DB_PATH}", 'ERROR')
        return

    conn = sqlite3.connect(str(DB_PATH))
    ensure_table_schema(conn)
    cur = conn.cursor()

    log("  جلب المؤشرات من TradingView...")
    indices = fetch_indices_from_tv()

    if not indices:
        log("  ⚠️ تعذر جلب أي مؤشرات")
        conn.close()
        return

    now_iso = datetime.now().isoformat()
    updated = 0

    for idx in indices:
        symbol = idx['symbol']
        log(f"  ✅ {symbol}: {idx['value']:.2f} ({idx['change_percent']:+.2f}%)")

        if DRY_RUN:
            log(f"  [DRY-RUN] لم أكتب {symbol}")
            continue

        cur.execute("""
            INSERT INTO market_indices (symbol, name_ar, value, change, change_percent, high, low, volume, last_update, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'tradingview_rest')
            ON CONFLICT(symbol) DO UPDATE SET
                name_ar = excluded.name_ar,
                value = excluded.value,
                change = excluded.change,
                change_percent = excluded.change_percent,
                high = excluded.high,
                low = excluded.low,
                volume = excluded.volume,
                last_update = excluded.last_update,
                source = excluded.source
        """, (symbol, idx['name_ar'], idx['value'], idx['change'], idx['change_percent'],
              idx['high'], idx['low'], idx['volume'], now_iso))
        updated += 1

    conn.commit()

    # تقرير نهائي
    log("")
    log("📋 تقرير نهائي:")
    try:
        cur.execute("SELECT symbol, value, change_percent, last_update FROM market_indices ORDER BY symbol")
        for row in cur.fetchall():
            val = f"{row[1]:.2f}" if row[1] else "—"
            chg = f"{row[2]:+.2f}%" if row[2] else "—"
            log(f"  {row[0]}: {val} ({chg}) | آخر تحديث: {row[3]}")
    except Exception as e:
        log(f"  (تقرير: {e})")

    conn.close()
    log(f"\n✅ تم تحديث {updated} مؤشر")


if __name__ == '__main__':
    log("=" * 60)
    log(f"📊 update_market_indices.py — تحديث مؤشرات السوق")
    log(f"   Project: {PROJECT_ROOT}")
    log(f"   Mode: {'DRY-RUN' if DRY_RUN else 'LIVE'}")
    log("=" * 60)
    update_market_indices()
    log("=" * 60)
    log("✅ اكتمل")
    log("=" * 60)
