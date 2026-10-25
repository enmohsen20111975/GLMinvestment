#!/usr/bin/env python3
"""
update_market_indices.py — تحديث مؤشرات السوق من TradingView REST
================================================================================

FIX v4 (2026-10-08):
  - استخدام global/scan مع tickers filter (وليس egypt/scan)
  - d هو list (ولس dict) — columns بترتيب محدد
  - EGX30 متاح في TradingView ✅ (قيمة ~53,265)
  - EGX70/100 قد لا يكونان متاحين — نحفظ ما يتوفر

الاستخدام:
  cd ~/my_apps/GLMinvestment
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

# TradingView global scanner مع tickers filter للمؤشرات
TV_SCANNER_URL = 'https://scanner.tradingview.com/global/scan'
TV_COLUMNS = ['name', 'description', 'close', 'change', 'change_abs', 'high', 'low', 'volume']

# المؤشرات المطلوبة (tickers في TradingView)
INDEX_TICKERS = ['EGX:EGX30', 'EGX:EGX70', 'EGX:EGX100']
INDEX_MAP = {
    'EGX:EGX30': {'symbol': 'EGX30', 'name_ar': 'مؤشر EGX 30'},
    'EGX:EGX70': {'symbol': 'EGX70', 'name_ar': 'مؤشر EGX 70'},
    'EGX:EGX100': {'symbol': 'EGX100', 'name_ar': 'مؤشر EGX 100'},
}


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


def fetch_indices_from_tv() -> list:
    """جلب المؤشرات من TradingView global scanner مع tickers filter"""
    try:
        body = {
            'symbols': {'tickers': INDEX_TICKERS},
            'columns': TV_COLUMNS,
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

        rows = []
        if isinstance(data, dict):
            rows = data.get('data', []) or []
        elif isinstance(data, list):
            rows = data

        if not rows:
            log(f"  ❌ TradingView رجع 0 نتائج (type={type(data).__name__})", 'ERROR')
            return []

        # columns = ['name', 'description', 'close', 'change', 'change_abs', 'high', 'low', 'volume']
        # d[0]=name, d[1]=description, d[2]=close, d[3]=change, d[4]=change_abs, d[5]=high, d[6]=low, d[7]=volume
        results = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            ticker = row.get('s', '') or ''
            d = row.get('d', [])
            if not isinstance(d, list) or len(d) < 3:
                continue

            idx_info = INDEX_MAP.get(ticker)
            if not idx_info:
                continue

            close_val = d[2]  # close
            if close_val is None or close_val <= 0:
                continue

            change_pct = d[4] if len(d) > 4 else 0  # change_abs (percentage)
            high = d[5] if len(d) > 5 else 0
            low = d[6] if len(d) > 6 else 0
            volume = d[7] if len(d) > 7 else 0

            results.append({
                'symbol': idx_info['symbol'],
                'name_ar': idx_info['name_ar'],
                'value': float(close_val),
                'change': float(d[3] if len(d) > 3 and d[3] else 0),
                'change_percent': float(change_pct or 0),
                'high': float(high or 0),
                'low': float(low or 0),
                'volume': float(volume or 0),
            })
            log(f"  ✅ {idx_info['symbol']}: {close_val:.2f} ({change_pct:+.2f}%)")

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

    # auto-migration للأعمدة المفقودة
    cols = [row[1] for row in cur.execute("PRAGMA table_info(market_indices)").fetchall()]
    migrations = [
        ('value', 'REAL'), ('change', 'REAL'), ('change_percent', 'REAL'),
        ('high', 'REAL'), ('low', 'REAL'), ('volume', 'REAL'),
        ('last_update', 'TEXT'), ('source', "TEXT DEFAULT 'tradingview_rest'"),
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

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(DB_PATH), writable=False)
    ensure_table_schema(conn)
    cur = conn.cursor()

    log("  جلب المؤشرات من TradingView (global/scan)...")
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
