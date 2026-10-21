#!/usr/bin/env python3
"""
=============================================================================
🔧 GAP FILL SCRIPT — تعبئة فجوات الأسعار من جداولنا الموجودة
=============================================================================

يعالج 3 فجوات (بناءً على الفحص):
  (أ) price_history.db متجمد لـ TADAWUL/KSE/QSE منذ Oct 14
      → نسخ Oct 15-21 من stocks.db.stock_daily_prices
  (ب) data_engine.db.egksco_stocks فاضي (0 صف)
      → تعميره من stocks.db.stocks (current_price → last_price)
  (ج) 75 US تيكر ناقصين في intraday.db.stock_intraday
      → إدراج صف synthetic لكل واحد (price=close)

السكربت آمن:
  - يشتغل على مجلد test_gap_fill/ افتراضياً (مش الإنتاج)
  - في mode --dry-run بفحص فقط ويقولك كم صف هيتضاف
  - قبل أي تعديل، يطبع before/after counts

Usage:
    python3 scripts/gap_fill_from_local_tables.py --dry-run
    python3 scripts/gap_fill_from_local_tables.py              # على test_gap_fill
    python3 scripts/gap_fill_from_local_tables.py --live       # على الإنتاج مباشرة (خطر!)
=============================================================================
"""
import sqlite3
import argparse
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LIVE_DB_DIR = PROJECT_ROOT / 'db'
TEST_DB_DIR = PROJECT_ROOT / 'db' / 'test_gap_fill'


def connect(db_path, read_only=False):
    if read_only:
        return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    return sqlite3.connect(str(db_path), timeout=30.0)


def q(db_path, sql, args=(), read_only=True):
    """read-only query helper"""
    conn = connect(db_path, read_only=True)
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# GAP (A): price_history.db ← stocks.db.stock_daily_prices
# Fill TADAWUL/KSE/QSE rows from Oct 15 onwards (production frozen at Oct 14)
# ─────────────────────────────────────────────────────────────────────────────

def gap_a_fill_price_history(db_dir, dry_run, out):
    out.append("\n## فجوة (أ): price_history.db ← stock_daily_prices لـ TADAWUL/KSE/QSE\n")

    stocks_db = db_dir / 'stocks.db'
    ph_db = db_dir / 'price_history.db'

    # 1. find latest date per market in price_history.db
    out.append("### قبل: آخر تاريخ لكل سوق في price_history.db")
    ticker_market = {r[0]: r[1] for r in q(stocks_db, "SELECT ticker, market FROM stocks WHERE is_active=1")}
    latest_by_market = {}
    for mkt in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']:
        mkt_tickers = [t for t, m in ticker_market.items() if m == mkt][:200]
        if not mkt_tickers:
            continue
        ph = ','.join('?' * len(mkt_tickers))
        r = q(ph_db, f"SELECT MAX(date) FROM price_history WHERE ticker IN ({ph})", mkt_tickers)
        latest = r[0][0] if r and r[0][0] else '—'
        latest_by_market[mkt] = latest
        out.append(f"- {mkt}: latest = `{latest}`")

    # 2. identify gap: rows in stock_daily_prices with date > price_history's latest
    frozen_markets = ['TADAWUL', 'KSE', 'QSE']
    total_to_add = 0
    added_by_market = {}

    conn_ph = connect(ph_db, read_only=False) if not dry_run else None
    if not dry_run:
        conn_ph.execute("BEGIN")

    for mkt in frozen_markets:
        latest_ph = latest_by_market.get(mkt, '—')
        if latest_ph == '—':
            out.append(f"\n⚠️ {mkt}: لا يوجد تاريخ في price_history — تخطي")
            continue

        # find stock_daily_prices rows for this market with date > latest_ph
        mkt_tickers = [t for t, m in ticker_market.items() if m == mkt]
        ph = ','.join('?' * len(mkt_tickers))
        gap_rows = q(stocks_db,
            f"""SELECT ticker, price_date, COALESCE(open, open_price), COALESCE(high, high_price),
                       COALESCE(low, low_price), COALESCE(close, close_price), volume
                FROM stock_daily_prices
                WHERE ticker IN ({ph}) AND price_date > ? AND COALESCE(close, close_price) > 0
                ORDER BY ticker, price_date""",
            mkt_tickers + [str(latest_ph)[:10]])

        added_by_market[mkt] = len(gap_rows)
        total_to_add += len(gap_rows)
        out.append(f"\n### {mkt}: {len(gap_rows)} صف جديد من stock_daily_prices (بعد {str(latest_ph)[:10]})")

        if gap_rows and not dry_run:
            # insert into price_history.db
            # schema: (id, ticker, date, open_price, high_price, low_price, close_price, volume, source, ...)
            inserted = 0
            for ticker, pdate, op, hp, lp, cp, vol in gap_rows:
                try:
                    conn_ph.execute("""
                        INSERT OR IGNORE INTO price_history
                        (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (ticker, pdate, op, hp, lp, cp, vol, 'stock_daily_prices_gapfill', mkt))
                    inserted += 1
                except Exception as e:
                    out.append(f"  ⚠️ {ticker} {pdate}: {e}")
            out.append(f"  ✅ تم إدراج {inserted} صف")

    if not dry_run and conn_ph:
        conn_ph.commit()
        conn_ph.close()

    if dry_run:
        out.append(f"\n**[DRY RUN] سيتم إضافة {total_to_add:,} صف إجمالاً**")
    else:
        out.append(f"\n**✅ تم إضافة {total_to_add:,} صف إجمالاً**")

    # verify
    out.append("\n### بعد: آخر تاريخ لكل سوق في price_history.db")
    for mkt in frozen_markets:
        mkt_tickers = [t for t, m in ticker_market.items() if m == mkt][:200]
        if not mkt_tickers:
            continue
        ph = ','.join('?' * len(mkt_tickers))
        r = q(ph_db, f"SELECT MAX(date) FROM price_history WHERE ticker IN ({ph})", mkt_tickers)
        latest = r[0][0] if r and r[0][0] else '—'
        out.append(f"- {mkt}: latest = `{latest}`")

    return total_to_add


# ─────────────────────────────────────────────────────────────────────────────
# GAP (B): data_engine.db.egksco_stocks ← stocks.db.stocks
# Production table is EMPTY — fill from stocks.current_price
# ─────────────────────────────────────────────────────────────────────────────

def gap_b_fill_egksco_stocks(db_dir, dry_run, out):
    out.append("\n## فجوة (ب): data_engine.db.egksco_stocks ← stocks.current_price\n")

    stocks_db = db_dir / 'stocks.db'
    de_db = db_dir / 'data_engine.db'

    # check current egksco_stocks count
    cols = [c[1] for c in q(de_db, "PRAGMA table_info(egksco_stocks)")]
    current = q(de_db, "SELECT COUNT(*) FROM egksco_stocks")[0][0]
    out.append(f"### قبل: egksco_stocks = {current} صف")
    out.append(f"### الأعمدة: {cols}")

    if current > 0:
        out.append("⚠️ الجدول مش فاضي — تخطي التعمير (يستخدم INSERT OR IGNORE)")
        # still proceed with INSERT OR IGNORE to add missing symbols

    # get source data from stocks.db.stocks
    src_rows = q(stocks_db, """
        SELECT ticker, name_ar, market, current_price, change_percent, volume, last_update
        FROM stocks WHERE is_active=1 AND current_price > 0
    """)
    out.append(f"### مصدر البيانات: {len(src_rows)} سهم نشط من stocks.db")

    if not dry_run:
        conn = connect(de_db, read_only=False)
        conn.execute("BEGIN")
        inserted = 0
        # try to insert — schema-dependent
        # egksco_stocks cols (production): id, symbol, name, market, sector, last_price, change, change_pct, volume, turnover, last_update
        # we'll use INSERT OR IGNORE to avoid breaking on schema differences
        for ticker, name_ar, market, cp, chg_pct, vol, last_up in src_rows:
            try:
                conn.execute("""
                    INSERT OR IGNORE INTO egksco_stocks
                    (symbol, name, market, last_price, change_percent, volume, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (ticker, name_ar, market, cp, chg_pct, vol, last_up))
                inserted += 1
            except Exception as e:
                # try with fewer cols if schema mismatch
                if 'no column' in str(e).lower():
                    try:
                        conn.execute("INSERT OR IGNORE INTO egksco_stocks (symbol, last_price) VALUES (?, ?)",
                                     (ticker, cp))
                        inserted += 1
                    except: pass
        conn.commit()
        conn.close()
        out.append(f"### ✅ تم إدراج/تجاهل {inserted} صف")
    else:
        out.append(f"### [DRY RUN] سيتم إدراج {len(src_rows)} صف (INSERT OR IGNORE)")

    # verify
    after = q(de_db, "SELECT COUNT(*) FROM egksco_stocks")[0][0]
    out.append(f"### بعد: egksco_stocks = {after} صف")
    if after > 0:
        mn, mx = q(de_db, "SELECT MIN(last_updated), MAX(last_updated) FROM egksco_stocks")[0]
        out.append(f"### المدى: {mn} → {mx}")

    return len(src_rows)


# ─────────────────────────────────────────────────────────────────────────────
# GAP (C): intraday.db.stock_intraday ← synthetic US rows
# 75 US tickers have no intraday — insert one synthetic row per ticker
# ─────────────────────────────────────────────────────────────────────────────

def gap_c_fill_us_intraday(db_dir, dry_run, out):
    out.append("\n## فجوة (ج): intraday.db.stock_intraday ← synthetic US rows\n")

    stocks_db = db_dir / 'stocks.db'
    intraday_db = db_dir / 'intraday.db'

    # find US tickers active in stocks.db but missing from intraday
    us_active = {r[0]: r for r in q(stocks_db,
        "SELECT ticker, current_price, volume, last_update FROM stocks WHERE is_active=1 AND market='US'")}
    us_in_intraday = set(r[0] for r in q(intraday_db, "SELECT DISTINCT ticker FROM stock_intraday WHERE ticker IN ({})".format(
        ','.join('?' * len(us_active))), list(us_active.keys())))

    missing = [t for t in us_active if t not in us_in_intraday]
    out.append(f"### قبل: US active = {len(us_active)}, in intraday = {len(us_in_intraday)}, missing = {len(missing)}")

    if not missing:
        out.append("### ✅ لا توجد فجوة — كل US موجود في intraday")
        return 0

    # show sample
    out.append(f"### عينة 10 من المفقودين: {missing[:10]}")

    if not dry_run:
        conn = connect(intraday_db, read_only=False)
        conn.execute("BEGIN")
        inserted = 0
        ts_now = datetime.now().isoformat()
        for ticker in missing:
            cp, vol, last_up = us_active[ticker][1], us_active[ticker][2], us_active[ticker][3]
            try:
                conn.execute("""
                    INSERT INTO stock_intraday
                    (ticker, market, timestamp, price, change_percent, volume, open, high, low)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ticker, 'US', ts_now, cp, 0, vol or 0, cp, cp, cp))
                inserted += 1
            except Exception as e:
                out.append(f"  ⚠️ {ticker}: {e}")
        conn.commit()
        conn.close()
        out.append(f"### ✅ تم إدراج {inserted} صف synthetic")
    else:
        out.append(f"### [DRY RUN] سيتم إدراج {len(missing)} صف synthetic (price=current_price, timestamp=now)")

    # verify
    us_in_intraday_after = len(set(r[0] for r in q(intraday_db,
        "SELECT DISTINCT ticker FROM stock_intraday WHERE market='US'")))
    out.append(f"### بعد: US tickers in intraday = {us_in_intraday_after}")

    return len(missing)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Gap fill from local tables')
    parser.add_argument('--dry-run', action='store_true', help='فحص فقط بدون تعديل')
    parser.add_argument('--live', action='store_true',
                        help='تطبيق على الإنتاج مباشرة (default: test_gap_fill/)')
    parser.add_argument('--skip-a', action='store_true', help='تخطي فجوة (أ)')
    parser.add_argument('--skip-b', action='store_true', help='تخطي فجوة (ب)')
    parser.add_argument('--skip-c', action='store_true', help='تخطي فجوة (ج)')
    args = parser.parse_args()

    db_dir = LIVE_DB_DIR if args.live else TEST_DB_DIR
    mode = 'LIVE (إنتاج)' if args.live else 'TEST (test_gap_fill/)'
    dry = 'DRY RUN' if args.dry_run else 'LIVE WRITE'

    print("=" * 80)
    print("🔧 GAP FILL FROM LOCAL TABLES")
    print(f"   DB dir: {db_dir}")
    print(f"   Mode: {mode} | {dry}")
    print(f"   Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)

    if not db_dir.exists():
        print(f"\n❌ {db_dir} غير موجود. شغّل بدون --live أولاً.")
        return 1

    out = []
    out.append(f"# 🔧 تقرير تعبئة الفجوات — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    out.append(f"**المسار:** `{db_dir}`\n")
    out.append(f"**النمط:** {mode} | {dry}\n")

    totals = {}
    if not args.skip_a:
        print("\n[1/3] فجوة (أ): price_history.db ← stock_daily_prices...")
        totals['a'] = gap_a_fill_price_history(db_dir, args.dry_run, out)
    if not args.skip_b:
        print("[2/3] فجوة (ب): egksco_stocks ← stocks.current_price...")
        totals['b'] = gap_b_fill_egksco_stocks(db_dir, args.dry_run, out)
    if not args.skip_c:
        print("[3/3] فجوة (ج): US intraday synthetic...")
        totals['c'] = gap_c_fill_us_intraday(db_dir, args.dry_run, out)

    # summary
    out.append("\n## ملخص\n")
    out.append("| الفجوة | الوصف | الصفوف |")
    out.append("|---|---|---:|")
    if 'a' in totals:
        out.append(f"| (أ) | price_history TADAWUL/KSE/QSE | {totals['a']:,} |")
    if 'b' in totals:
        out.append(f"| (ب) | egksco_stocks from stocks | {totals['b']:,} |")
    if 'c' in totals:
        out.append(f"| (ج) | US intraday synthetic | {totals['c']:,} |")
    out.append(f"| **الإجمالي** | | **{sum(totals.values()):,}** |")

    # save report
    REPORT_DIR = PROJECT_ROOT / 'Documentation'
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    suffix = '_live' if args.live else '_test'
    suffix += '_dryrun' if args.dry_run else ''
    report_path = REPORT_DIR / f'GAP-FILL-REPORT{suffix}_{ts}.md'
    report_path.write_text('\n'.join(out), encoding='utf-8')

    print(f"\n{'='*80}")
    print(f"✅ التقرير: {report_path}")
    print(f"\nملخص:")
    for k, v in totals.items():
        print(f"  فجوة ({k}): {v:,} صف")
    print(f"  الإجمالي: {sum(totals.values()):,}")
    print(f"{'='*80}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
