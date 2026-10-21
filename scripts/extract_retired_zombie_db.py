#!/usr/bin/env python3
"""
=============================================================================
💎 EXTRACT RETIRED ZOMBIE DB — استخراج الضالة من market.db القديمة
=============================================================================

هذا السكربت يُشغّل على اللاب توب حيث توجد:
    db/retired_zombie_dbs/market.db  (≈1.7 GB — نسخة قديمة من data_engine.db)

بيعمل 3 حاجات:
  1. فحص شامل: كل الجداول، الـ schemas، عدد الصفوف، المدى التاريخي لكل جدول
  2. كشف الفجوات: بيقارن مع قواعد الإنتاج (لو موجودة على اللاب توب) ويحدد
     بالظبط إيه اللي موجود في market.db ومفقود في الإنتاج
  3. استخراج محمول: بينشئ ملف SQLite صغير (`market_db_extracts_<ts>.db`)
     فيه الصفوف اللي تعبّي فجوات الإنتاج، جاهز للرفع للسيرفر

Usage (على اللاب توب):
    cd /path/to/GLMinvestment
    python3 scripts/extract_retired_zombie_db.py
    python3 scripts/extract_retired_zombie_db.py --market-db /custom/path/market.db
    python3 scripts/extract_retired_zombie_db.py --no-extract   # فحص فقط بدون استخراج
=============================================================================
"""
import sqlite3
import argparse
import sys
import os
import shutil
from pathlib import Path
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[1] if (Path(__file__).resolve().parent.name == 'scripts') else Path(__file__).resolve().parent.parent

DEFAULT_MARKET_DB = PROJECT_ROOT / 'db' / 'retired_zombie_dbs' / 'market.db'
PROD_DB_DIR = PROJECT_ROOT / 'db'
PROD_STOCKS_DB = PROD_DB_DIR / 'stocks.db'
PROD_DATA_ENGINE_DB = PROD_DB_DIR / 'data_engine.db'
PROD_PRICE_HISTORY_DB = PROD_DB_DIR / 'price_history.db'
PROD_INTRADAY_DB = PROD_DB_DIR / 'intraday.db'

OUTPUT_DIR = PROJECT_ROOT / 'Documentation'
EXTRACT_DIR = PROJECT_ROOT / 'db' / 'retired_zombie_extracts'

DATE_COLS = ['date', 'datetime', 'price_date', 'price_time', 'timestamp',
             'trade_date', 'last_update', 'last_updated', 'updated_at',
             'created_at', 'fiscal_end', 'fetch_time', 'fetch_date']

# The gaps we're trying to fill (from production audit)
GAP_TARGETS = {
    'price_history_TADAWUL_KSE_QSE': {
        'desc': 'price_history.db متجمد لـ TADAWUL/KSE/QSE منذ Oct 14',
        'need_dates_after': '2026-10-14',
        'markets': ['TADAWUL', 'KSE', 'QSE'],
    },
    'data_engine_egksco_stocks_empty': {
        'desc': 'data_engine.db.egksco_stocks فاضي (0 صف) في الإنتاج',
        'need_any': True,
    },
    'historical_data_frozen': {
        'desc': 'data_engine.db.historical_data متجمد منذ سبتمبر لكل الأسواق',
        'need_dates_after': '2026-09-07',
        'markets': ['TADAWUL', 'KSE', 'QSE', 'EGX', 'US'],
    },
    'us_intraday_missing_75': {
        'desc': '75 سهم US ناقصين في intraday.db',
        'need_any': True,
        'markets': ['US'],
    },
}


def q(db_path, sql, args=()):
    """read-only query helper"""
    if not db_path.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            return conn.execute(sql, args).fetchall()
        finally:
            conn.close()
    except Exception as e:
        return f'ERR: {e}'


def get_tables(db_path):
    r = q(db_path, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    if not r or isinstance(r, str):
        return []
    return [row[0] for row in r if not row[0].startswith('sqlite_')]


def get_schema(db_path, table):
    r = q(db_path, f"PRAGMA table_info({table})")
    if not r or isinstance(r, str):
        return []
    return [(col[1], col[2]) for col in r]


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: Full inventory of market.db
# ─────────────────────────────────────────────────────────────────────────────

def section1_full_inventory(market_db, out):
    out.append("\n# SECTION 1 — الفحص الشامل لـ market.db\n")
    out.append(f"**المسار:** `{market_db}`\n")
    size_gb = market_db.stat().st_size / (1024**3)
    out.append(f"**الحجم:** {size_gb:.2f} GB\n")

    tables = get_tables(market_db)
    out.append(f"**عدد الجداول:** {len(tables)}\n")

    out.append("\n| # | الجدول | عدد الصفوف | أقدم تاريخ | أحدث تاريخ | الأعمدة |")
    out.append("|---:|---|---:|---|---|---|")

    table_info = {}
    for i, t in enumerate(tables, 1):
        cnt_r = q(market_db, f"SELECT COUNT(*) FROM '{t}'")
        cnt = cnt_r[0][0] if cnt_r and not isinstance(cnt_r, str) else 0

        cols = get_schema(market_db, t)
        col_names = [c[0] for c in cols]

        # find date column
        date_col = None
        for dc in DATE_COLS:
            for cn in col_names:
                if cn.lower() == dc or dc in cn.lower():
                    date_col = cn
                    break
            if date_col:
                break

        min_d = max_d = '—'
        if date_col and cnt > 0:
            r = q(market_db, f"SELECT MIN({date_col}), MAX({date_col}) FROM '{t}' WHERE {date_col} IS NOT NULL AND {date_col} != ''")
            if r and not isinstance(r, str) and r[0][0]:
                min_d = str(r[0][0])[:16]
                max_d = str(r[0][1])[:19]

        cols_str = ', '.join(col_names[:6])
        if len(col_names) > 6:
            cols_str += f' (+{len(col_names)-6})'

        out.append(f"| {i} | `{t}` | {cnt:,} | {min_d} | {max_d} | {cols_str} |")
        table_info[t] = {'count': cnt, 'cols': col_names, 'date_col': date_col, 'min': min_d, 'max': max_d}

    return table_info


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: Deep dive on price-related tables (the ones that can fill gaps)
# ─────────────────────────────────────────────────────────────────────────────

PRICE_TABLES = ['historical_data', 'egksco_stocks', 'egksco_price_history',
                'stock_prices', 'stocks', 'crypto_prices', 'gold_prices',
                'silver_prices', 'exchange_rates', 'btc_local_prices',
                'sharia_history', 'sharia_metrics', 'sharia_purification_rates',
                'tab_balance_sheet', 'tab_income_statement', 'tab_cash_flow']


def section2_price_tables_deep(market_db, table_info, out):
    out.append("\n# SECTION 2 — الفحص العميق لجداول الأسعار\n")

    for t in PRICE_TABLES:
        if t not in table_info:
            continue
        info = table_info[t]
        if info['count'] == 0:
            out.append(f"\n## `{t}` — فاضي (0 صف) ⚪\n")
            continue

        out.append(f"\n## `{t}` — {info['count']:,} صف | المدى: {info['min']} → {info['max']}\n")
        out.append(f"**الأعمدة:** {', '.join(info['cols'])}\n")

        # Per-market breakdown if market column exists
        if 'market' in info['cols']:
            out.append("\n| market/symbol-cat | tickers | rows | min | max |")
            out.append("|---|---:|---:|---|---|")
            dc = info['date_col'] or '1=1'
            r = q(market_db, f"SELECT market, COUNT(DISTINCT CASE WHEN symbol IS NOT NULL THEN symbol WHEN ticker IS NOT NULL THEN ticker END), COUNT(*), MIN({dc}), MAX({dc}) FROM '{t}' GROUP BY market ORDER BY 2 DESC")
            if r and not isinstance(r, str):
                for row in r:
                    mkt = row[0] if row[0] else '(NULL)'
                    out.append(f"| {mkt} | {row[1]} | {row[2]:,} | {str(row[3])[:10] if row[3] else '—'} | {str(row[4])[:10] if row[4] else '—'} |")
        elif 'category' in info['cols']:
            out.append("\n| category | symbols | rows | min | max |")
            out.append("|---|---:|---:|---|---|")
            dc = info['date_col'] or '1=1'
            r = q(market_db, f"SELECT category, COUNT(DISTINCT symbol), COUNT(*), MIN({dc}), MAX({dc}) FROM '{t}' GROUP BY category ORDER BY 3 DESC")
            if r and not isinstance(r, str):
                for row in r:
                    cat = row[0] if row[0] else '(NULL)'
                    out.append(f"| {cat} | {row[1]} | {row[2]:,} | {str(row[3])[:10] if row[3] else '—'} | {str(row[4])[:10] if row[4] else '—'} |")

        # Sample rows
        out.append("\n<details><summary>عينة 5 صفوف</summary>\n")
        out.append("```")
        sample = q(market_db, f"SELECT * FROM '{t}' LIMIT 5")
        if sample and not isinstance(sample, str):
            for row in sample:
                out.append(str(row)[:200])
        out.append("```\n</details>")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3: Gap detection vs production
# ─────────────────────────────────────────────────────────────────────────────

def section3_gap_detection(market_db, out):
    out.append("\n# SECTION 3 — كشف الفجوات: market.db vs الإنتاج\n")

    if not PROD_STOCKS_DB.exists():
        out.append(f"⚠️ **قواعد الإنتاج مش موجودة على هذا الجهاز** (`{PROD_STOCKS_DB}`).\n")
        out.append("سيتم فحص market.db بشكل مستقل وتحديد ما قد يكون مفيداً.\n")
        prod_available = False
    else:
        prod_available = True
        out.append(f"✅ قواعد الإنتاج موجودة على `{PROD_DB_DIR}`. سيتم المقارنة.\n")

    findings = []

    # ── GAP 1: egksco_stocks in data_engine.db (production = EMPTY)
    out.append("\n## فجوة #1: `data_engine.db.egksco_stocks` (فاضي في الإنتاج)\n")
    if 'egksco_stocks' in get_tables(market_db):
        mkt_cnt = q(market_db, "SELECT COUNT(*) FROM egksco_stocks")[0][0]
        if mkt_cnt > 0:
            # get date range and market breakdown
            cols = [c[0] for c in get_schema(market_db, 'egksco_stocks')]
            dcol = 'last_updated' if 'last_updated' in cols else ('last_update' if 'last_update' in cols else None)
            if dcol:
                mn, mx = q(market_db, f"SELECT MIN({dcol}), MAX({dcol}) FROM egksco_stocks")[0]
            else:
                mn = mx = '—'
            out.append(f"- 🎯 **market.db فيه {mkt_cnt:,} صف** في egksco_stocks | المدى: {mn} → {mx}")
            out.append(f"- **هذا هو المصدر #2 في `get_live_price()` الذي يفشل في الإنتاج!**")
            findings.append(('egksco_stocks', mkt_cnt, f'{mn} → {mx}', 'CRITICAL — fills production empty table'))

            # symbol count
            sym_col = 'symbol' if 'symbol' in cols else 'ticker'
            r = q(market_db, f"SELECT COUNT(DISTINCT {sym_col}) FROM egksco_stocks")
            if r: out.append(f"- تيكرات فريدة: {r[0][0]:,}")
        else:
            out.append("- ⚪ market.db أيضاً فاضي في egksco_stocks")
    else:
        out.append("- ⚪ جدول egksco_stocks غير موجود في market.db")

    # ── GAP 2: historical_data freshness for TADAWUL/KSE/QSE
    out.append("\n## فجوة #2: `data_engine.db.historical_data` (متجمد منذ سبتمبر في الإنتاج)\n")
    if 'historical_data' in get_tables(market_db):
        cols = [c[0] for c in get_schema(market_db, 'historical_data')]
        mcol = 'market' if 'market' in cols else None
        scol = 'symbol' if 'symbol' in cols else ('ticker' if 'ticker' in cols else None)
        dcol = 'date' if 'date' in cols else None

        if mcol and scol and dcol:
            out.append(f"| market | symbols | rows | latest_date | هل أحدث من الإنتاج؟ |")
            out.append(f"|---|---:|---:|---|---|")
            for mkt in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'السعودية', 'الكويت', 'قطر', 'مصر']:
                r = q(market_db, f"SELECT COUNT(DISTINCT {scol}), COUNT(*), MAX({dcol}) FROM historical_data WHERE {mcol}=?", (mkt,))
                if r and r[0][0] > 0:
                    prod_latest = '—'
                    newer = '?'
                    if prod_available and PROD_DATA_ENGINE_DB.exists():
                        pr = q(PROD_DATA_ENGINE_DB, f"SELECT MAX({dcol}) FROM historical_data WHERE {mcol}=?", (mkt,))
                        prod_latest = pr[0][0] if pr and pr[0][0] else '—'
                        if r[0][2] and prod_latest != '—' and str(r[0][2])[:10] > str(prod_latest)[:10]:
                            newer = '✅ نعم — market.db أحدث!'
                        elif r[0][2] and prod_latest != '—' and str(r[0][2])[:10] == str(prod_latest)[:10]:
                            newer = '= نفس التاريخ'
                        else:
                            newer = '❌ أقدم'
                    out.append(f"| {mkt} | {r[0][0]} | {r[0][1]:,} | {r[0][2]} | {newer} |")
                    if newer.startswith('✅'):
                        findings.append(('historical_data', mkt, r[0][2], f'market.db أحدث من الإنتاج لـ {mkt}'))

        # Also: rows in market.db with date > prod latest (the actual gap-fillers)
        if prod_available and PROD_DATA_ENGINE_DB.exists() and dcol:
            prod_max = q(PROD_DATA_ENGINE_DB, f"SELECT MAX({dcol}) FROM historical_data")[0][0]
            if prod_max:
                gap_rows = q(market_db, f"SELECT COUNT(*) FROM historical_data WHERE {dcol} > ?", (str(prod_max)[:10],))[0][0]
                out.append(f"\n- **الإنتاج متجمد عند:** {prod_max}")
                out.append(f"- **market.db فيه {gap_rows:,} صف بعد هذا التاريخ** — دي الضالة بالظبط! 🎯")
                if gap_rows > 0:
                    findings.append(('historical_data_gap_rows', gap_rows, f'>{prod_max}', 'fills the freeze gap'))
    else:
        out.append("- ⚪ جدول historical_data غير موجود في market.db")

    # ── GAP 3: egksco_price_history (deprecated but daily_predictor still uses it)
    out.append("\n## فجوة #3: `data_engine.db.egksco_price_history` (daily_predictor لسه بيستخدمها)\n")
    if 'egksco_price_history' in get_tables(market_db):
        cnt = q(market_db, "SELECT COUNT(*) FROM egksco_price_history")[0][0]
        if cnt > 0:
            cols = [c[0] for c in get_schema(market_db, 'egksco_price_history')]
            dcol = 'price_date' if 'price_date' in cols else 'date'
            mn, mx = q(market_db, f"SELECT MIN({dcol}), MAX({dcol}) FROM egksco_price_history")[0]
            out.append(f"- 🎯 market.db فيه **{cnt:,} صف** | المدى: {mn} → {mx}")
            if prod_available and PROD_DATA_ENGINE_DB.exists():
                pcnt = q(PROD_DATA_ENGINE_DB, "SELECT COUNT(*) FROM egksco_price_history")[0][0]
                pmn, pmx = q(PROD_DATA_ENGINE_DB, f"SELECT MIN({dcol}), MAX({dcol}) FROM egksco_price_history")[0] if pcnt > 0 else (None, None)
                out.append(f"- الإنتاج: {pcnt:,} صف | المدى: {pmn} → {pmx}")
                if mx and pmx and str(mx)[:10] > str(pmx)[:10]:
                    extra = q(market_db, f"SELECT COUNT(*) FROM egksco_price_history WHERE {dcol} > ?", (str(pmx)[:10],))[0][0]
                    out.append(f"- **market.db فيه {extra:,} صف أحدث من الإنتاج** 🎯")
                    findings.append(('egksco_price_history', extra, f'>{pmx}', 'fills deprecated-table gap'))
        else:
            out.append("- ⚪ فاضي")
    else:
        out.append("- ⚪ غير موجود")

    # ── GAP 4: stock_prices (another candidate)
    out.append("\n## فجوة #4: `data_engine.db.stock_prices` (متجمد 2026-06 في الإنتاج)\n")
    if 'stock_prices' in get_tables(market_db):
        cnt = q(market_db, "SELECT COUNT(*) FROM stock_prices")[0][0]
        cols = [c[0] for c in get_schema(market_db, 'stock_prices')]
        dcol = 'timestamp' if 'timestamp' in cols else None
        if cnt > 0 and dcol:
            mn, mx = q(market_db, f"SELECT MIN({dcol}), MAX({dcol}) FROM stock_prices")[0]
            out.append(f"- market.db: {cnt:,} صف | {mn} → {mx}")
        else:
            out.append(f"- market.db: {cnt} صف")

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4: Extract gap-filling rows to portable SQLite
# ─────────────────────────────────────────────────────────────────────────────

def section4_extract(market_db, findings, out, args):
    out.append("\n# SECTION 4 — استخراج الضالة لملف محمول\n")

    if args.no_extract:
        out.append("⏭️ تم تخطي الاستخراج (--no-extract)\n")
        return None

    if not findings:
        out.append("⚠️ مفيش فجوات محددة للتعبيئة — لا استخراج.\n")
        return None

    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    extract_path = EXTRACT_DIR / f'market_db_extracts_{ts}.db'

    # remove if exists
    if extract_path.exists():
        extract_path.unlink()

    out.append(f"**ملف الاستخراج:** `{extract_path}`\n")

    # create extract DB
    ex = sqlite3.connect(str(extract_path))
    ex.execute("PRAGMA journal_mode=WAL")
    cur = ex.cursor()

    total_extracted = 0

    # Extract 1: egksco_stocks (full copy if production empty)
    if any(f[0] == 'egksco_stocks' for f in findings):
        out.append("\n## استخراج egksco_stocks (كامل)\n")
        cols = [c[0] for c in get_schema(market_db, 'egksco_stocks')]
        cols_def = ', '.join(f'"{c}"' for c in cols)
        cur.execute(f"CREATE TABLE egksco_stocks ({cols_def})")

        # copy in chunks
        src = sqlite3.connect(f"file:{market_db}?mode=ro", uri=True)
        placeholders = ', '.join('?' * len(cols))
        batch = []
        BATCH_SIZE = 5000
        for row in src.execute(f"SELECT {cols_def} FROM egksco_stocks"):
            batch.append(row)
            if len(batch) >= BATCH_SIZE:
                cur.executemany(f"INSERT INTO egksco_stocks VALUES ({placeholders})", batch)
                batch = []
        if batch:
            cur.executemany(f"INSERT INTO egksco_stocks VALUES ({placeholders})", batch)
        src.close()
        cnt = cur.execute("SELECT COUNT(*) FROM egksco_stocks").fetchone()[0]
        out.append(f"- ✅ استخرجنا {cnt:,} صف من egksco_stocks")
        total_extracted += cnt

    # Extract 2: historical_data rows newer than production's max date
    if any(f[0] == 'historical_data_gap_rows' for f in findings):
        out.append("\n## استخراج historical_data (الصفوف الأحدث من الإنتاج)\n")
        cols = [c[0] for c in get_schema(market_db, 'historical_data')]
        cols_def = ', '.join(f'"{c}"' for c in cols)
        cur.execute(f"CREATE TABLE historical_data_gap ({cols_def})")

        # find production max date
        prod_max = q(PROD_DATA_ENGINE_DB, "SELECT MAX(date) FROM historical_data")[0][0]
        prod_max_str = str(prod_max)[:10]
        out.append(f"- الإنتاج متجمد عند: {prod_max_str}")
        out.append(f"- استخراج كل صفوف market.db بعد هذا التاريخ...")

        src = sqlite3.connect(f"file:{market_db}?mode=ro", uri=True)
        placeholders = ', '.join('?' * len(cols))
        batch = []
        BATCH_SIZE = 5000
        for row in src.execute(f"SELECT {cols_def} FROM historical_data WHERE date > ?", (prod_max_str,)):
            batch.append(row)
            if len(batch) >= BATCH_SIZE:
                cur.executemany(f"INSERT INTO historical_data_gap VALUES ({placeholders})", batch)
                batch = []
        if batch:
            cur.executemany(f"INSERT INTO historical_data_gap VALUES ({placeholders})", batch)
        src.close()
        cnt = cur.execute("SELECT COUNT(*) FROM historical_data_gap").fetchone()[0]
        out.append(f"- ✅ استخرجنا {cnt:,} صف من historical_data (الضالة بعد {prod_max_str})")

        # per-market breakdown of extracted
        out.append("\n  تفصيل المستخرج حسب السوق:")
        for mkt, c in cur.execute("SELECT market, COUNT(*) FROM historical_data_gap GROUP BY market ORDER BY 2 DESC").fetchall():
            out.append(f"  - {mkt}: {c:,} صف")
        total_extracted += cnt

    # Extract 3: egksco_price_history gap rows
    if any(f[0] == 'egksco_price_history' for f in findings):
        out.append("\n## استخراج egksco_price_history (الصفوف الأحدث من الإنتاج)\n")
        cols = [c[0] for c in get_schema(market_db, 'egksco_price_history')]
        cols_def = ', '.join(f'"{c}"' for c in cols)
        cur.execute(f"CREATE TABLE egksco_price_history_gap ({cols_def})")

        prod_max = q(PROD_DATA_ENGINE_DB, "SELECT MAX(price_date) FROM egksco_price_history")[0][0]
        if prod_max:
            prod_max_str = str(prod_max)[:10]
            src = sqlite3.connect(f"file:{market_db}?mode=ro", uri=True)
            placeholders = ', '.join('?' * len(cols))
            batch = []
            for row in src.execute(f"SELECT {cols_def} FROM egksco_price_history WHERE price_date > ?", (prod_max_str,)):
                batch.append(row)
                if len(batch) >= 5000:
                    cur.executemany(f"INSERT INTO egksco_price_history_gap VALUES ({placeholders})", batch)
                    batch = []
            if batch:
                cur.executemany(f"INSERT INTO egksco_price_history_gap VALUES ({placeholders})", batch)
            src.close()
            cnt = cur.execute("SELECT COUNT(*) FROM egksco_price_history_gap").fetchone()[0]
            out.append(f"- ✅ استخرجنا {cnt:,} صف (بعد {prod_max_str})")
            total_extracted += cnt

    ex.commit()
    ex.close()

    out.append(f"\n**إجمالي الصفوف المستخرجة:** {total_extracted:,}\n")
    out.append(f"**حجم الملف:** {extract_path.stat().st_size / (1024*1024):.2f} MB\n")
    out.append(f"\n📦 **الخطوة التالية:** ارفع `{extract_path.name}` للسيرفر ثم شغّل سكربت الدمج.\n")

    return extract_path


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Extract retired zombie market.db')
    parser.add_argument('--market-db', type=str, default=str(DEFAULT_MARKET_DB),
                        help=f'مسار market.db (default: {DEFAULT_MARKET_DB})')
    parser.add_argument('--no-extract', action='store_true', help='فحص فقط بدون استخراج')
    args = parser.parse_args()

    market_db = Path(args.market_db).resolve()

    print("=" * 80)
    print("💎 EXTRACT RETIRED ZOMBIE DB")
    print(f"   market.db: {market_db}")
    print(f"   وقت الفحص: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)

    if not market_db.exists():
        print(f"\n❌ market.db غير موجود في: {market_db}")
        print(f"   ضع الملف في: {DEFAULT_MARKET_DB}")
        print(f"   أو حدد المسار: --market-db /path/to/market.db")
        return 1

    size_gb = market_db.stat().st_size / (1024**3)
    print(f"   الحجم: {size_gb:.2f} GB")

    out = []
    out.append(f"# 💎 تقرير استخراج الضالة من market.db — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    out.append(f"**الملف:** `{market_db}` ({size_gb:.2f} GB)\n")
    out.append(f"**الوصف:** نسخة قديمة من data_engine.db (تجريبية) — البحث عن بيانات مفقودة في الإنتاج.\n")

    print("\n[1/4] Section 1: الفحص الشامل...")
    table_info = section1_full_inventory(market_db, out)
    print(f"   وجد {len(table_info)} جدول")

    print("[2/4] Section 2: الفحص العميق لجداول الأسعار...")
    section2_price_tables_deep(market_db, table_info, out)

    print("[3/4] Section 3: كشف الفجوات...")
    findings = section3_gap_detection(market_db, out)
    print(f"   {len(findings)} فجوة محتملة للتعبيئة")

    print("[4/4] Section 4: استخراج الضالة...")
    extract_path = section4_extract(market_db, findings, out, args)

    # save report
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    report_path = OUTPUT_DIR / f'MARKET-DB-INVENTORY_{ts}.md'
    report_path.write_text('\n'.join(out), encoding='utf-8')

    print(f"\n{'='*80}")
    print(f"✅ التقرير: {report_path} ({report_path.stat().st_size/1024:.1f} KB)")
    if extract_path:
        print(f"✅ الاستخراج: {extract_path} ({extract_path.stat().st_size/1024/1024:.2f} MB)")
    print(f"{'='*80}")

    # console summary
    print("\n" + "="*60)
    print("ملخص الفجوات المكتشفة:")
    for f in findings:
        print(f"  • {f[0]}: {f[1]} ({f[2]}) — {f[3]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
