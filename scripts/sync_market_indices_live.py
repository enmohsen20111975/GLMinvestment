#!/usr/bin/env python3
"""
=============================================================================
⚡ sync_market_indices_live.py — تحديث لحظي للمؤشرات من الأسعار الحية
=============================================================================

سكريبت خفيف وسريع (~2 ثانية) بيقرا آخر الأسعار من:
  - stocks.db.stocks (current_price + previous_close + change_percent)
  - intraday.db.stock_intraday (لو فيه ticks أحدث من stocks.current_price)

وبيحسب المؤشرات التخليقية:
  - EGX30  (Capped Market-Cap Weighted — with official weights)
  - EGX70  (Equal-Weighted Index)
  - EGX100 (Composite EWI = EGX30 ∪ EGX70)
  - EGX33  (Shariah Capped — with official weights)
  - KSE_PREMIER (Kuwait Premier — market-cap weighted)
  - QSE_QE_INDEX (Qatar QE Index — market-cap weighted)
  - TADAWUL_TASI (Saudi TASI — market-cap weighted)
  - US_SP500 / US_NASDAQ100 / US_DOW_JONES (composites)

ويكتبها في stocks.db → market_indices (UPSERT).
مصمم عشان يشتغل كل 5 دقايق مع كل تحديث أسعار.

Usage:
    python3 scripts/sync_market_indices_live.py
    python3 scripts/sync_market_indices_live.py --dry-run
=============================================================================
"""
import sqlite3
import json
import sys
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
INTRADAY_DB = PROJECT_ROOT / 'db' / 'intraday.db'
CANONICAL_FILE = PROJECT_ROOT / 'vps-service' / 'data' / 'canonical_indices.json'


def get_latest_prices():
    """
    يجيب آخر سعر لكل سهم من stocks.db + intraday.db (لو أحدث).
    يرجّع dict: ticker -> {price, prev_close, change_pct, market, mcap}
    """
    prices = {}

    # 1. اقرا من stocks.db
    conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    try:
        rows = conn.execute("""
            SELECT ticker, market, current_price, previous_close, change_percent,
                   market_cap, free_float_shares
            FROM stocks WHERE is_active = 1 AND current_price > 0
        """).fetchall()
    finally:
        conn.close()

    for ticker, market, cp, pc, chg, mcap, ff_shares in rows:
        prices[ticker] = {
            'price': float(cp) if cp else 0,
            'prev_close': float(pc) if pc else 0,
            'change_pct': float(chg) if chg else 0,
            'market': market,
            'mcap': float(mcap) if mcap else 0,
            'free_float': int(ff_shares) if ff_shares else 0,
            'source': 'stocks.db',
        }

    # 2. لو فيه intraday أحدث من النهاردة، استخدمه
    if INTRADAY_DB.exists():
        try:
            iconn = sqlite3.connect(f"file:{INTRADAY_DB}?mode=ro", uri=True)
            try:
                intra_rows = iconn.execute("""
                    SELECT ticker, price, timestamp
                    FROM stock_intraday
                    WHERE price > 0
                    GROUP BY ticker
                    HAVING timestamp = MAX(timestamp)
                """).fetchall()
            finally:
                iconn.close()

            today = datetime.now().strftime('%Y-%m-%d')
            for ticker, price, ts in intra_rows:
                if ticker in prices and ts and str(ts)[:10] == today:
                    p = float(price) if price else 0
                    if p > 0:
                        pc = prices[ticker]['prev_close']
                        new_chg = ((p - pc) / pc * 100) if pc > 0 else 0
                        prices[ticker]['price'] = p
                        prices[ticker]['change_pct'] = new_chg
                        prices[ticker]['source'] = 'intraday.db'
        except Exception:
            pass

    return prices


def get_latest_index_close(db_path, symbol):
    """Read the latest close from index_daily_prices for chaining.
    Returns None if table doesn't exist or no rows (first run).
    FIX (2026-10-22): base_value was hardcoded → flat line. Now chains
    from yesterday's real close so the index follows the real trajectory.
    """
    try:
        conn = sqlite3.connect(str(db_path))
        row = conn.execute(
            "SELECT close FROM index_daily_prices WHERE symbol = ? AND close > 0 "
            "ORDER BY price_date DESC LIMIT 1", (symbol,)
        ).fetchone()
        conn.close()
        return float(row[0]) if row else None
    except Exception:
        return None


def compute_weighted_index(prices, constituents, base_value, symbol, name, name_ar, is_shariah=0):
    """
    حساب مؤشر موزون بالأوزان الرسمية (للـ EGX30 و EGX33).
    constituents: list of {code, weight}
    """
    total_weight = 0
    weighted_change = 0
    matched = 0

    for c in constituents:
        ticker = c['code']
        weight = c.get('weight', 0)
        if ticker not in prices or weight <= 0:
            continue
        p = prices[ticker]
        if p['change_pct'] is None:
            continue
        total_weight += weight
        weighted_change += weight * p['change_pct']
        matched += 1

    if total_weight == 0 or matched < 5:
        return None

    avg_change = weighted_change / total_weight
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': symbol,
        'name': name,
        'name_ar': name_ar,
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': is_shariah,
        'coverage': f'{matched}/{len(constituents)}',
    }


def compute_ewi_index(prices, constituents, base_value, symbol, name, name_ar, min_matched=20):
    """
    حساب مؤشر متساوي الأوزان (EWI) — للـ EGX70 و EGX100.
    constituents: list of {code}
    """
    changes = []
    seen = set()
    for c in constituents:
        ticker = c['code']
        if ticker in seen:
            continue
        seen.add(ticker)
        if ticker in prices and prices[ticker]['change_pct'] is not None:
            changes.append(prices[ticker]['change_pct'])

    if len(changes) < min_matched:
        return None

    avg_change = sum(changes) / len(changes)
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': symbol,
        'name': name,
        'name_ar': name_ar,
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': 0,
        'coverage': f'{len(changes)}/{len(seen)}',
    }


def compute_market_composite(prices, market, base_value, symbol, name, name_ar):
    """حساب مؤشر مركب لأي سوق (market-cap weighted من كل أسهم السوق)"""
    total_mcap = 0
    weighted_change = 0
    matched = 0

    for ticker, p in prices.items():
        if p['market'] != market:
            continue
        mcap = p['mcap'] or (p['price'] * 1_000_000)
        if mcap <= 0 or p['change_pct'] is None or p['price'] <= 0:
            continue
        total_mcap += mcap
        weighted_change += mcap * p['change_pct']
        matched += 1

    if total_mcap == 0 or matched < 10:
        return None

    avg_change = weighted_change / total_mcap
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': symbol,
        'name': name,
        'name_ar': name_ar,
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': 0,
        'coverage': f'{matched}',
    }


def upsert_index(conn, idx, now_iso):
    """INSERT OR REPLACE في market_indices"""
    conn.execute("""
        INSERT INTO market_indices
        (symbol, name, name_ar, current_value, previous_close, change, change_percent, is_shariah, last_update, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            current_value = excluded.current_value,
            previous_close = excluded.previous_close,
            change = excluded.change,
            change_percent = excluded.change_percent,
            is_shariah = excluded.is_shariah,
            last_update = excluded.last_update,
            source = excluded.source
    """, (
        idx['symbol'], idx['name'], idx['name_ar'],
        idx['current_value'], idx['previous_close'], idx['change'],
        idx['change_percent'], idx['is_shariah'], now_iso,
        f'sync_live ({idx.get("coverage", "")})'
    ))


def main():
    parser = argparse.ArgumentParser(description='Sync market indices from live prices')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()[:19]}] 📈 sync_market_indices_live starting...")

    # 1. اقرا الأسعار
    prices = get_latest_prices()
    print(f"  ✓ loaded {len(prices)} active stocks with current_price > 0")

    # 2. اقرا canonical constituents (structure الجديد)
    if not CANONICAL_FILE.exists():
        print(f"  ✗ canonical_indices.json not found at {CANONICAL_FILE}")
        return 1
    with open(CANONICAL_FILE, encoding='utf-8') as f:
        canonical = json.load(f)

    indices = []

    # === EGX30 (Capped Market-Cap Weighted — with official weights) ===
    # FIX (2026-10-22): base_value was HARDCODED to 30000 → every day computed
    # as 30000*(1+change%) → flat line around 30000, NOT the real trajectory.
    # Now reads the REAL previous close from index_daily_prices (chains correctly).
    egx30_data = canonical.get('EGX30', {})
    egx30_base = get_latest_index_close(STOCKS_DB, 'EGX30') or 30000  # fallback only
    egx30 = compute_weighted_index(
        prices, egx30_data.get('constituents', []),
        base_value=egx30_base, symbol='EGX30',
        name='EGX 30 Index', name_ar='مؤشر إيجي إكس 30 الرئيسي'
    )
    if egx30:
        indices.append(egx30)
        print(f"  ✓ EGX30: {egx30['current_value']:,.2f} ({egx30['change_percent']:+.2f}%) [{egx30['coverage']}]")

    # === EGX70 EWI (Equal-Weighted) ===
    egx70_data = canonical.get('EGX70_EWI', {})
    egx70_base = get_latest_index_close(STOCKS_DB, 'EGX70') or 8000  # fallback only
    egx70 = compute_ewi_index(
        prices, egx70_data.get('constituents', []),
        base_value=egx70_base, symbol='EGX70',
        name='EGX 70 EWI Index', name_ar='مؤشر إيجي إكس 70 متساوي الأوزان',
        min_matched=20
    )
    if egx70:
        indices.append(egx70)
        print(f"  ✓ EGX70: {egx70['current_value']:,.2f} ({egx70['change_percent']:+.2f}%) [{egx70['coverage']}]")

    # === EGX100 EWI (Composite = EGX30 ∪ EGX70, deduplicated) ===
    egx30_constituents = egx30_data.get('constituents', [])
    egx70_constituents = egx70_data.get('constituents', [])
    # merge + dedupe
    seen = set()
    egx100_constituents = []
    for c in egx30_constituents + egx70_constituents:
        if c['code'] not in seen:
            seen.add(c['code'])
            egx100_constituents.append(c)
    egx100 = compute_ewi_index(
        prices, egx100_constituents,
        base_value=get_latest_index_close(STOCKS_DB, 'EGX100') or 11000, symbol='EGX100',
        name='EGX 100 EWI Index', name_ar='مؤشر إيجي إكس 100 الأوسع نطاقاً',
        min_matched=30
    )
    if egx100:
        indices.append(egx100)
        print(f"  ✓ EGX100: {egx100['current_value']:,.2f} ({egx100['change_percent']:+.2f}%) [{egx100['coverage']}]")

    # === EGX33 Shariah (Capped — with official weights) ===
    egx33_data = canonical.get('EGX33_SHARIAH', {})
    egx33 = compute_weighted_index(
        prices, egx33_data.get('constituents', []),
        base_value=3300, symbol='EGX33',
        name='EGX 33 Shariah Index', name_ar='مؤشر إيجي إكس 33 الشرعي',
        is_shariah=1
    )
    if egx33:
        indices.append(egx33)
        print(f"  ✓ EGX33: {egx33['current_value']:,.2f} ({egx33['change_percent']:+.2f}%) [{egx33['coverage']}]")

    # === KSE Premier (market-cap weighted with top constituents) ===
    kse_data = canonical.get('KSE_PREMIER', {})
    kse_constituents = kse_data.get('constituents', [])
    kse = compute_weighted_index(
        prices, kse_constituents,
        base_value=7000, symbol='KSE_PREMIER',
        name='KSE Premier Market', name_ar='مؤشر السوق الأول - الكويت'
    )
    # fallback: composite from all KSE stocks
    if not kse:
        kse = compute_market_composite(prices, 'KSE', 7000, 'KSE_COMPOSITE', 'KSE Composite', 'مؤشر بورصة الكويت المركب')
    if kse:
        indices.append(kse)
        print(f"  ✓ KSE: {kse['current_value']:,.2f} ({kse['change_percent']:+.2f}%) [{kse['coverage']}]")

    # === QSE QE Index (market-cap weighted with official constituents) ===
    qse_data = canonical.get('QSE_QE_INDEX', {})
    qse_constituents = qse_data.get('constituents', [])
    qse = compute_weighted_index(
        prices, qse_constituents,
        base_value=10000, symbol='QSE_QE_INDEX',
        name='QE Index', name_ar='مؤشر بورصة قطر العام'
    )
    if not qse:
        qse = compute_market_composite(prices, 'QSE', 10000, 'QSE_COMPOSITE', 'QSE Composite', 'مؤشر بورصة قطر المركب')
    if qse:
        indices.append(qse)
        print(f"  ✓ QSE: {qse['current_value']:,.2f} ({qse['change_percent']:+.2f}%) [{qse['coverage']}]")

    # === TADAWUL TASI (market-cap weighted with top constituents) ===
    tasi_data = canonical.get('TADAWUL_TASI', {})
    tasi_constituents = tasi_data.get('constituents', [])
    tasi = compute_weighted_index(
        prices, tasi_constituents,
        base_value=12000, symbol='TADAWUL_TASI',
        name='Tadawul TASI', name_ar='مؤشر تداول العام (TASI)'
    )
    if not tasi:
        tasi = compute_market_composite(prices, 'TADAWUL', 12000, 'TADAWUL_COMPOSITE', 'TADAWUL Composite', 'مؤشر تداول المركب')
    if tasi:
        indices.append(tasi)
        print(f"  ✓ TADAWUL: {tasi['current_value']:,.2f} ({tasi['change_percent']:+.2f}%) [{tasi['coverage']}]")

    # === US indices (composites — S&P500/NASDAQ100/Dow use top constituents + market composite fallback) ===
    us_composite = compute_market_composite(prices, 'US', 5000, 'US_COMPOSITE', 'US Composite', 'مؤشر الأسهم الأمريكية المركب')
    if us_composite:
        indices.append(us_composite)
        print(f"  ✓ US: {us_composite['current_value']:,.2f} ({us_composite['change_percent']:+.2f}%) [{us_composite['coverage']}]")

    print(f"  → computed {len(indices)} indices")

    # 4. اكتب في market_indices + index_daily_prices (تاريخ يومي)
    if not args.dry_run:
        now_iso = datetime.now().isoformat()
        today = datetime.now().strftime('%Y-%m-%d')
        conn = sqlite3.connect(str(STOCKS_DB), timeout=30.0)
        try:
            # 4a. تأكد إن index_daily_prices موجود
            conn.execute("""
                CREATE TABLE IF NOT EXISTS index_daily_prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    price_date TEXT NOT NULL,
                    open REAL, high REAL, low REAL, close REAL,
                    volume REAL, change_percent REAL,
                    UNIQUE(symbol, price_date)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_idx_dp_sym_date ON index_daily_prices(symbol, price_date)")

            # 4b. upsert في market_indices (القيمة اللحظية)
            for idx in indices:
                upsert_index(conn, idx, now_iso)

                # 4c. upsert في index_daily_prices (التاريخ اليومي)
                conn.execute("""
                    INSERT INTO index_daily_prices (symbol, price_date, open, high, low, close, volume, change_percent)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                    ON CONFLICT(symbol, price_date) DO UPDATE SET
                        close = excluded.close,
                        high = MAX(excluded.high, index_daily_prices.high),
                        low = CASE WHEN index_daily_prices.low = 0 OR excluded.low < index_daily_prices.low THEN excluded.low ELSE index_daily_prices.low END,
                        change_percent = excluded.change_percent
                """, (
                    idx['symbol'], today,
                    idx['current_value'],  # open = current (will be updated next day)
                    idx['current_value'],  # high
                    idx['current_value'],  # low
                    idx['current_value'],  # close
                    idx['change_percent'],
                ))
            conn.commit()
            print(f"  ✅ upserted {len(indices)} indices into market_indices + index_daily_prices")
        finally:
            conn.close()
    else:
        print(f"  [DRY RUN] would upsert {len(indices)} indices")

    print(f"[{datetime.now().isoformat()[:19]}] ✅ done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
