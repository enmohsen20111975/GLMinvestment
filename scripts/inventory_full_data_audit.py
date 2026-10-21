#!/usr/bin/env python3
"""
=============================================================================
🔍 INVENTORY FULL DATA AUDIT — حصر شامل لكل الأسهم والأسواق والمصادر
=============================================================================

يفحص كل قواعد البيانات المحلية ويطلع تقرير مفصل جداً:
  - لكل سوق: كل تيكر، كل مصدر، المدى التاريخي الكامل (min → max)
  - الفجوات الزمنية (gaps) في كل مصدر
  - تصنيف كل تاريخ: intraday-only / daily-only / both
  - اتساق الأسعار عبر المصادر
  - تصنيف الطزاجة لكل تيكر (FRESH / STALE / EMPTY)

Usage:
    python3 scripts/inventory_full_data_audit.py
    python3 scripts/inventory_full_data_audit.py --market KSE
    python3 scripts/inventory_full_data_audit.py --ticker CLEANI
=============================================================================
"""
import sqlite3
import argparse
import sys
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'
REPORT_DIR = PROJECT_ROOT / 'Documentation'

STOCKS_DB = DB_DIR / 'stocks.db'
PRICE_HISTORY_DB = DB_DIR / 'price_history.db'
INTRADAY_DB = DB_DIR / 'intraday.db'
DATA_ENGINE_DB = DB_DIR / 'data_engine.db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'

TODAY = datetime.now().strftime('%Y-%m-%d')
YESTERDAY = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
FRESH_CUTOFF = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')  # last 3 days = fresh
STALE_CUTOFF = (datetime.now() - timedelta(days=14)).strftime('%Y-%m-%d')  # >14 days = stale

MARKETS = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']


def q(db_path, sql, args=()):
    """read-only query helper"""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def build_ticker_market_map():
    """ticker -> market (authoritative, from stocks.db)"""
    rows = q(STOCKS_DB, "SELECT ticker, market, is_active FROM stocks")
    return {r[0]: (r[1] or 'UNKNOWN', r[2]) for r in rows}


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1: per-DB / per-table / per-market freshness matrix
# ─────────────────────────────────────────────────────────────────────────────

def section1_db_freshness(ticker_map, out):
    out.append("\n# SECTION 1 — مصادر بيانات الأسعار: الحصر حسب السوق والمصدر\n")

    # (db, table, ticker_col, date_col, market_col, price_col, label)
    SOURCES = [
        (STOCKS_DB,        'stock_daily_prices', 'ticker', 'price_date',  'market', 'close',     'stocks.db / stock_daily_prices'),
        (PRICE_HISTORY_DB, 'price_history',      'ticker', 'date',        None,     'close_price','price_history.db / price_history'),
        (INTRADAY_DB,      'stock_intraday',     'ticker', 'timestamp',   'market', 'price',     'intraday.db / stock_intraday'),
        (DATA_ENGINE_DB,   'historical_data',    'ticker', 'date',        'market', 'close',     'data_engine.db / historical_data'),
        (DATA_ENGINE_DB,   'egksco_price_history','symbol','price_date',  'market', 'close_price','data_engine.db / egksco_price_history'),
    ]

    for db_path, table, tcol, dcol, mcol, pcol, label in SOURCES:
        out.append(f"\n## {label}")
        total = q(db_path, f"SELECT COUNT(*) FROM {table}")[0][0]
        n_tickers = q(db_path, f"SELECT COUNT(DISTINCT {tcol}) FROM {table}")[0][0]
        out.append(f"- إجمالي الصفوف: **{total:,}** | تيكرات فريدة: **{n_tickers:,}**")

        if total == 0:
            out.append("- ⚪ الجدول فاضي تماماً")
            continue

        # global min/max
        gmin, gmax = q(db_path, f"SELECT MIN({dcol}), MAX({dcol}) FROM {table} WHERE {dcol} IS NOT NULL")[0]
        out.append(f"- المدى الكامل: `{gmin}` → `{gmax}`")

        # per-market breakdown using ticker_map (authoritative) when mcol is unreliable
        out.append(f"\n| السوق | تيكرات | صفوف | أقدم تاريخ | أحدث تاريخ | طازج (≥{FRESH_CUTOFF}) | متجمد (<{STALE_CUTOFF}) |")
        out.append("|---|---:|---:|---|---|---:|---:|")

        for mkt in MARKETS:
            # get tickers belonging to this market from authoritative map
            mkt_tickers = [t for t, (m, _) in ticker_map.items() if m == mkt]
            if not mkt_tickers:
                out.append(f"| {mkt} | 0 | 0 | --- | --- | 0 | 0 |")
                continue

            # count rows for these tickers
            placeholders = ','.join('?' * min(len(mkt_tickers), 950))
            # SQLite variable limit ~999; chunk if needed
            total_rows = 0
            min_d = None
            max_d = None
            fresh = 0
            stale = 0
            seen_tickers = set()
            CHUNK = 900
            for i in range(0, len(mkt_tickers), CHUNK):
                chunk = mkt_tickers[i:i+CHUNK]
                ph = ','.join('?' * len(chunk))
                sql = f"SELECT {tcol}, {dcol} FROM {table} WHERE {tcol} IN ({ph}) AND {dcol} IS NOT NULL"
                for tk, dt in q(db_path, sql, chunk):
                    total_rows += 1
                    seen_tickers.add(tk)
                    dstr = str(dt)[:10]
                    if min_d is None or dstr < min_d:
                        min_d = dstr
                    if max_d is None or dstr > max_d:
                        max_d = dstr
                    if dstr >= FRESH_CUTOFF:
                        fresh += 1
                    if dstr < STALE_CUTOFF:
                        stale += 1

            md = min_d or '---'
            xd = max_d or '---'
            out.append(f"| {mkt} | {len(seen_tickers)} | {total_rows:,} | {md} | {xd} | {fresh:,} | {stale:,} |")

        # gap analysis: trading days present vs absent in the global min-max range
        # (lightweight: per-market, count distinct dates and compare to calendar business days)
        out.append(f"\n<details><summary>تحليل الفجوات (gap analysis) لكل سوق</summary>\n")
        out.append("| السوق | أيام تداول مسجلة | نطاق التواريخ | ملاحظة |")
        out.append("|---|---:|---|---|")
        for mkt in MARKETS:
            mkt_tickers = [t for t, (m, _) in ticker_map.items() if m == mkt]
            if not mkt_tickers:
                out.append(f"| {mkt} | 0 | --- | --- |")
                continue
            # distinct dates across all tickers in this market (sample first 200 tickers for speed)
            sample = mkt_tickers[:200]
            ph = ','.join('?' * len(sample))
            dates = set()
            for (d,) in q(db_path, f"SELECT DISTINCT substr({dcol},1,10) FROM {table} WHERE {tcol} IN ({ph}) AND {dcol} IS NOT NULL", sample):
                if d:
                    dates.add(d[:10])
            if not dates:
                out.append(f"| {mkt} | 0 | --- | لا توجد تواريخ |")
                continue
            dmin, dmax = min(dates), max(dates)
            # rough trading-day count (exclude Fri/Sat for EGX/TADAWUL, Fri for others)
            n_cal = 0
            cur = datetime.strptime(dmin, '%Y-%m-%d')
            end = datetime.strptime(dmax, '%Y-%m-%d')
            while cur <= end:
                wd = cur.weekday()  # Mon=0..Sun=6
                if mkt in ('EGX','TADAWUL'):
                    if wd not in (4, 5):  # exclude Fri(4), Sat(5)
                        n_cal += 1
                elif mkt == 'KSE':
                    if wd not in (4, 5):  # KSE: Fri/Sat closed
                        n_cal += 1
                elif mkt == 'QSE':
                    if wd not in (5, 6):  # QSE: Fri/Sat closed (different)
                        n_cal += 1
                else:
                    if wd not in (5, 6):  # US: Sat/Sun closed
                        n_cal += 1
                cur += timedelta(days=1)
            n_have = len(dates)
            gap = max(0, n_cal - n_have)
            pct = 100 * n_have / n_cal if n_cal else 0
            note = f"تغطية {pct:.0f}% — {gap} يوم تداول مفقود محتمل" if gap > 5 else "تغطية شبه كاملة"
            out.append(f"| {mkt} | {n_have} | {dmin} → {dmax} | {note} |")
        out.append("\n</details>")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2: per-ticker unified timeline (all sources merged)
# ─────────────────────────────────────────────────────────────────────────────

def section2_per_ticker_timeline(ticker_map, out, args):
    out.append("\n# SECTION 2 — الحصر التفصيلي لكل تيكر (Unified Timeline)\n")
    out.append("لكل تيكر نشط: أقدم/أحدث تاريخ في كل مصدر، وتصنيف الطزاجة.\n")

    # Filter
    target_tickers = None
    if args.ticker:
        target_tickers = {args.ticker.upper()}
    elif args.market:
        target_tickers = {t for t, (m, _) in ticker_map.items() if m == args.market}

    # Gather per-ticker min/max from each source
    def gather(db_path, table, tcol, dcol, price_col):
        sql = f"SELECT {tcol}, MIN(substr({dcol},1,10)), MAX(substr({dcol},1,10)), COUNT(*), MAX({price_col}) FROM {table} WHERE {dcol} IS NOT NULL GROUP BY {tcol}"
        try:
            return {r[0]: (r[1], r[2], r[3], r[4]) for r in q(db_path, sql) if r[0]}
        except:
            return {}

    src_daily    = gather(STOCKS_DB,        'stock_daily_prices', 'ticker', 'price_date', 'close')
    src_phist    = gather(PRICE_HISTORY_DB, 'price_history',      'ticker', 'date',       'close_price')
    src_intraday = gather(INTRADAY_DB,      'stock_intraday',     'ticker', 'timestamp',  'price')
    src_histde   = gather(DATA_ENGINE_DB,   'historical_data',    'ticker', 'date',       'close')
    src_egksco   = gather(DATA_ENGINE_DB,   'egksco_price_history','symbol','price_date', 'close_price')

    # Build per-market tables
    markets_to_show = [args.market] if args.market else MARKETS
    for mkt in markets_to_show:
        mkt_tickers = sorted([t for t, (m, act) in ticker_map.items() if m == mkt and (target_tickers is None or t in target_tickers)])
        if not mkt_tickers:
            continue
        out.append(f"\n## السوق: {mkt}  ({len(mkt_tickers)} تيكر)\n")
        out.append("| Ticker | daily (stocks.db) | price_history | intraday | historical (DE) | egksco | أحدث إجمالي | الطزاجة | آخر سعر |")
        out.append("|---|---|---|---|---|---|---|---|---:|")

        fresh_n = stale_n = empty_n = 0
        for t in mkt_tickers:
            d = src_daily.get(t, ('—','—',0,None))
            p = src_phist.get(t, ('—','—',0,None))
            i = src_intraday.get(t, ('—','—',0,None))
            h = src_histde.get(t, ('—','—',0,None))
            e = src_egksco.get(t, ('—','—',0,None))

            # latest across all sources
            dates = [x[1] for x in (d,p,i,h,e) if x[1] and x[1] != '—']
            latest = max(dates) if dates else '—'
            # latest price (prefer intraday, then daily)
            latest_price = i[3] if i[3] is not None else (d[3] if d[3] is not None else (p[3] if p[3] is not None else (h[3] if h[3] is not None else e[3])))

            # freshness classification
            if latest == '—':
                status = '🔴 EMPTY'
                empty_n += 1
            elif latest[:10] >= FRESH_CUTOFF:
                status = '🟢 FRESH'
                fresh_n += 1
            elif latest[:10] < STALE_CUTOFF:
                status = '🟠 STALE'
                stale_n += 1
            else:
                status = '🟡 AGING'

            def fmt(x):
                return f"{x[0]}→{x[1]} ({x[2]})" if x[2] else '—'

            out.append(f"| {t} | {fmt(d)} | {fmt(p)} | {fmt(i)} | {fmt(h)} | {fmt(e)} | {latest} | {status} | {latest_price if latest_price is not None else '—'} |")

        out.append(f"\n**ملخص {mkt}:** 🟢 طازج={fresh_n} | 🟡 متقادم={len(mkt_tickers)-fresh_n-stale_n-empty_n} | 🟠 متجمد={stale_n} | 🔴 فاضي={empty_n}")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3: date classification (intraday-only / daily-only / both)
# ─────────────────────────────────────────────────────────────────────────────

def section3_date_classification(ticker_map, out, args):
    out.append("\n# SECTION 3 — تصنيف التواريخ: لحظي فقط / يومي فقط / كلاهما\n")
    out.append("لكل سوق: كم تاريخ عنده بيانات intraday فقط (بدون EOD)، وكم يومي فقط، وكم الاثنين.\n")

    # For speed, sample up to 150 tickers per market
    markets_to_show = [args.market] if args.market else MARKETS
    for mkt in markets_to_show:
        mkt_tickers = sorted([t for t, (m, _) in ticker_map.items() if m == mkt])
        if not mkt_tickers:
            continue
        sample = mkt_tickers[:150]

        # gather dates
        intraday_dates = set()
        ph = ','.join('?' * len(sample))
        for (d,) in q(INTRADAY_DB, f"SELECT DISTINCT substr(timestamp,1,10) FROM stock_intraday WHERE ticker IN ({ph}) AND timestamp IS NOT NULL", sample):
            if d: intraday_dates.add(d[:10])

        daily_dates = set()
        for (d,) in q(STOCKS_DB, f"SELECT DISTINCT substr(price_date,1,10) FROM stock_daily_prices WHERE ticker IN ({ph}) AND price_date IS NOT NULL", sample):
            if d: daily_dates.add(d[:10])
        for (d,) in q(PRICE_HISTORY_DB, f"SELECT DISTINCT substr(date,1,10) FROM price_history WHERE ticker IN ({ph}) AND date IS NOT NULL", sample):
            if d: daily_dates.add(d[:10])

        both = intraday_dates & daily_dates
        intraday_only = intraday_dates - daily_dates
        daily_only = daily_dates - intraday_dates
        all_dates = intraday_dates | daily_dates

        out.append(f"\n## {mkt}  (عينة {len(sample)} تيكر)\n")
        out.append(f"- إجمالي التواريخ المسجلة: **{len(all_dates)}**")
        out.append(f"- تواريخ intraday فقط (بدون EOD): **{len(intraday_only)}**")
        out.append(f"- تواريخ يومي فقط (بدون intraday): **{len(daily_only)}**")
        out.append(f"- تواريخ فيها الاثنين: **{len(both)}**")
        if all_dates:
            out.append(f"- المدى: `{min(all_dates)} → {max(all_dates)}`")
        if intraday_only:
            s = sorted(intraday_only, reverse=True)[:5]
            out.append(f"- أمثلة intraday-only: {', '.join(s)}")
        if daily_only:
            s = sorted(daily_only, reverse=True)[:5]
            out.append(f"- أمثلة daily-only: {', '.join(s)}")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4: cross-source latest-price consistency
# ─────────────────────────────────────────────────────────────────────────────

def section4_cross_source_consistency(ticker_map, out, args):
    out.append("\n# SECTION 4 — اتساق الأسعار عبر المصادر\n")
    out.append("لكل تيكر: آخر سعر من intraday vs daily vs price_history. لو الفرق >5% → ⚠️\n")

    # latest price per ticker per source
    def latest_prices(db, table, tcol, dcol, pcol, market_filter_tickers):
        res = {}
        CHUNK = 900
        for i in range(0, len(market_filter_tickers), CHUNK):
            chunk = market_filter_tickers[i:i+CHUNK]
            ph = ','.join('?' * len(chunk))
            sql = f"SELECT {tcol}, {pcol}, {dcol} FROM {table} WHERE {tcol} IN ({ph}) AND {dcol} IS NOT NULL AND {pcol} IS NOT NULL ORDER BY {tcol}, {dcol} DESC"
            for tk, price, dt in q(db, sql, chunk):
                if tk not in res:
                    res[tk] = (price, str(dt)[:10])
        return res

    markets_to_show = [args.market] if args.market else MARKETS
    total_mismatch = 0
    for mkt in markets_to_show:
        mkt_tickers = sorted([t for t, (m, _) in ticker_map.items() if m == mkt])
        if not mkt_tickers:
            continue
        sample = mkt_tickers[:200]
        intra = latest_prices(INTRADAY_DB, 'stock_intraday', 'ticker', 'timestamp', 'price', sample)
        daily = latest_prices(STOCKS_DB, 'stock_daily_prices', 'ticker', 'price_date', 'close', sample)
        phist = latest_prices(PRICE_HISTORY_DB, 'price_history', 'ticker', 'date', 'close_price', sample)

        out.append(f"\n## {mkt}  (عينة {len(sample)} تيكر)\n")
        out.append("| Ticker | intraday | daily | price_history | تطابق |")
        out.append("|---|---:|---:|---:|---|")
        mism = 0
        shown = 0
        for t in sample:
            ip = intra.get(t, (None, None))[0]
            dp = daily.get(t, (None, None))[0]
            pp = phist.get(t, (None, None))[0]
            if ip is None and dp is None and pp is None:
                continue
            # check consistency
            vals = [v for v in (ip, dp, pp) if v is not None and v > 0]
            if len(vals) >= 2:
                mx, mn = max(vals), min(vals)
                agree = '✅' if (mx - mn) / mn < 0.05 else '⚠️'
                if agree == '⚠️':
                    mism += 1
            else:
                agree = '—'
            out.append(f"| {t} | {ip if ip else '—'} | {dp if dp else '—'} | {pp if pp else '—'} | {agree} |")
            shown += 1
            if shown >= 60:
                extra = len(sample) - shown
                out.append(f"| ... | | | | ({extra} تيكر إضافي محذوف للإيجاز) |")
                break
        total_mismatch += mism
        out.append(f"\n**{mkt}: {mism} تيكر فيه تضارب أسعار >5%**")
    out.append(f"\n**إجمالي التضارب عبر كل الأسواق: {total_mismatch} تيكر**")


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5: snapshot tables (stocks.db current state)
# ─────────────────────────────────────────────────────────────────────────────

def section5_stocks_snapshot(out):
    out.append("\n# SECTION 5 — لقطة stocks.db الحالية\n")
    total = q(STOCKS_DB, "SELECT COUNT(*) FROM stocks")[0][0]
    active = q(STOCKS_DB, "SELECT COUNT(*) FROM stocks WHERE is_active=1")[0][0]
    out.append(f"- إجمالي التيكرات: **{total}** | نشط: **{active}** | غير نشط: **{total-active}**\n")
    out.append("| السوق | إجمالي | نشط | غير نشط | طازج (last_update≥{}) | متجمد (<{}) |".format(FRESH_CUTOFF, STALE_CUTOFF))
    out.append("|---|---:|---:|---:|---:|---:|")
    for mkt in MARKETS:
        r = q(STOCKS_DB, "SELECT COUNT(*), SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END), SUM(CASE WHEN is_active=0 OR is_active IS NULL THEN 1 ELSE 0 END), SUM(CASE WHEN last_update>=? THEN 1 ELSE 0 END), SUM(CASE WHEN last_update<? OR last_update IS NULL THEN 1 ELSE 0 END) FROM stocks WHERE market=?", (FRESH_CUTOFF, STALE_CUTOFF, mkt))[0]
        out.append(f"| {mkt} | {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} |")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Full Data Inventory Audit')
    parser.add_argument('--market', choices=MARKETS, help='فحص سوق واحد')
    parser.add_argument('--ticker', type=str, help='فحص تيكر واحد')
    args = parser.parse_args()

    print("=" * 80)
    print("🔍 FULL DATA INVENTORY AUDIT")
    print(f"   وقت الفحص: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"   اليوم={TODAY} | طازج≥{FRESH_CUTOFF} | متجمد<{STALE_CUTOFF}")
    print("=" * 80)

    ticker_map = build_ticker_market_map()
    print(f"   ticker→market map: {len(ticker_map)} تيكر من stocks.db")

    out = []
    out.append(f"# 📊 تقرير الحصر الشامل للبيانات — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    out.append(f"**اليوم:** {TODAY} | **طازج:** ≥{FRESH_CUTOFF} | **متجمد:** <{STALE_CUTOFF}\n")

    print("\n[1/5] Section 1: مصادر البيانات حسب السوق...")
    section1_db_freshness(ticker_map, out)

    print("[2/5] Section 2: الحصر التفصيلي لكل تيكر...")
    section2_per_ticker_timeline(ticker_map, out, args)

    print("[3/5] Section 3: تصنيف التواريخ لحظي/يومي...")
    section3_date_classification(ticker_map, out, args)

    print("[4/5] Section 4: اتساق الأسعار عبر المصادر...")
    section4_cross_source_consistency(ticker_map, out, args)

    print("[5/5] Section 5: لقطة stocks.db...")
    section5_stocks_snapshot(out)

    # save report
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    suffix = f"_{args.market}" if args.market else (f"_{args.ticker}" if args.ticker else "")
    report_path = REPORT_DIR / f'DATA-INVENTORY{suffix}_{ts}.md'
    report_path.write_text('\n'.join(out), encoding='utf-8')

    print(f"\n{'='*80}")
    print(f"✅ التقرير الكامل محفوظ: {report_path}")
    print(f"   الحجم: {report_path.stat().st_size/1024:.1f} KB")
    print(f"{'='*80}")

    # also print a compact summary to console
    print("\n" + "\n".join(out[3:80]))  # first chunks
    return 0


if __name__ == "__main__":
    sys.exit(main())
