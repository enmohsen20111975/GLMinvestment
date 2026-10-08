#!/usr/bin/env python3
"""
update_market_indices.py — تحديث مؤشرات السوق من TradingView REST
================================================================================

المشكلة:
  market_indices (EGX30/70/100) متوقفة منذ 2026-09-27 (11+ يوم).
  هذا يسبب خطأ في محرك حالة السوق (Regime Engine) الذي يحسب "دفاعي"
  بناءً على بيانات قديمة.

الحل:
  جلب EGX30/70/100 من TradingView REST API (نفس المصدر الكناسي للأسعار)
  وكتابتها في stocks.db.market_indices.

الاستخدام:
  cd ~/my_apps/GLMinvestment (أو /root/GLMinvestment)
  .venv/bin/python vps-service/scripts/update_market_indices.py

  # أو dry-run:
  .venv/bin/python vps-service/scripts/update_market_indices.py --dry-run

Cron (يومي قبل daily_predictor):
  45 2 * * 0-4 cd /root/GLMinvestment && .venv/bin/python vps-service/scripts/update_market_indices.py >> logs/market_indices.log 2>&1
================================================================================
"""

import sqlite3
import urllib.request
import urllib.parse
import json
import sys
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'stocks.db'
DRY_RUN = '--dry-run' in sys.argv

# مؤشرات EGX المطلوبة + أسماؤها في TradingView
EGX_INDICES = [
    {'symbol': 'EGX30', 'tv_symbol': 'EGX:EGX30', 'name_ar': 'مؤشر egx 30'},
    {'symbol': 'EGX70', 'tv_symbol': 'EGX:EGX70', 'name_ar': 'مؤشر egx 70'},
    {'symbol': 'EGX100', 'tv_symbol': 'EGX:EGX100', 'name_ar': 'مؤشر egx 100'},
]

# TradingView Scanner API (نفس الموجود في tradingview_rest.py)
TV_SCANNER_URL = 'https://scanner.tradingview.com/egypt/scan'


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


def fetch_index_from_tv(tv_symbol: str) -> dict | None:
    """جلب بيانات مؤشر من TradingView REST API"""
    try:
        # TradingView scanner يتوقع symbol في payload
        payload = urllib.parse.urlencode({
            'symbols': json.dumps([tv_symbol]),
        }).encode()
        req = urllib.request.Request(
            TV_SCANNER_URL,
            data=payload,
            headers={
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            if data and data.get('data') and len(data['data']) > 0:
                d = data['data'][0].get('d', {})
                return {
                    'value': d.get('last', d.get('close', 0)),
                    'change': d.get('change', 0),
                    'change_percent': d.get('change_abs', d.get('percent', 0)),
                    'high': d.get('high', 0),
                    'low': d.get('low', 0),
                    'volume': d.get('volume', 0),
                }
        return None
    except Exception as e:
        log(f"  ❌ خطأ في جلب {tv_symbol}: {e}", 'ERROR')
        return None


def update_market_indices():
    log("=" * 60)
    log("📊 تحديث مؤشرات السوق (market_indices) من TradingView REST")
    log("=" * 60)

    if not DB_PATH.exists():
        log(f"❌ قاعدة البيانات غير موجودة: {DB_PATH}", 'ERROR')
        return

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # التحقق من وجود جدول market_indices
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_indices'")
    if not cur.fetchone():
        log("  ⚠️ جدول market_indices غير موجود — إنشاؤه...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_indices (
                symbol TEXT PRIMARY KEY,
                name TEXT,
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

    updated = 0
    now_iso = datetime.now().isoformat()

    for idx in EGX_INDICES:
        symbol = idx['symbol']
        tv_symbol = idx['tv_symbol']
        name_ar = idx['name_ar']

        log(f"  جلب {symbol} ({tv_symbol})...")
        data = fetch_index_from_tv(tv_symbol)

        if data and data['value'] and data['value'] > 0:
            log(f"  ✅ {symbol}: {data['value']:.2f} ({data['change_percent']:+.2f}%)")

            if DRY_RUN:
                log(f"  [DRY-RUN] لم أكتب {symbol}")
                continue

            # UPSERT
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
            """, (symbol, name_ar, data['value'], data['change'], data['change_percent'],
                  data['high'], data['low'], data['volume'], now_iso))
            updated += 1
        else:
            log(f"  ⚠️ تعذر جلب بيانات {symbol}")

    conn.commit()

    # تقرير نهائي
    log("")
    log("📋 تقرير نهائي:")
    cur.execute("SELECT symbol, value, change_percent, last_update FROM market_indices ORDER BY symbol")
    for row in cur.fetchall():
        log(f"  {row[0]}: {row[1]:.2f} ({row[2]:+.2f}%) | آخر تحديث: {row[3]}")

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
