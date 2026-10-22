#!/usr/bin/env python3
"""
=============================================================================
⚡ sync_market_indices_live.py — تحديث لحظي للمؤشرات من الأسعار الحية
=============================================================================

سكريبت خفيف وسريع (~2 ثانية) بيقرا آخر الأسعار من:
  - stocks.db.stocks (current_price + previous_close + change_percent)
  - intraday.db.stock_intraday (لو فيه ticks أحدث من stocks.current_price)

وبيحسب المؤشرات التخليقية:
  - EGX30  (Capped Market-Cap Weighted)
  - EGX70  (Equal-Weighted Index)
  - EGX100 (Composite EWI 30+70)
  - EGX33_SHARIAH (Shariah capped)
  - KSE_PREMIER (Kuwait Premier)
  - QSE_INDEX (Qatar)

ويكتبها في stocks.db → market_indices (UPSERT).
مصمم عشان يشتغل كل 5 دقايق مع كل تحديث أسعار (مش زي apply_master اللي ثقيل).

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

    # 1. اقرا من stocks.db (current_price + previous_close + change_percent)
    conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    try:
        rows = conn.execute("""
            SELECT ticker, market, current_price, previous_close, change_percent,
                   market_cap, free_float_shares, is_egx30, is_egx70, is_egx100
            FROM stocks WHERE is_active = 1 AND current_price > 0
        """).fetchall()
    finally:
        conn.close()

    for ticker, market, cp, pc, chg, mcap, ff_shares, e30, e70, e100 in rows:
        prices[ticker] = {
            'price': float(cp) if cp else 0,
            'prev_close': float(pc) if pc else 0,
            'change_pct': float(chg) if chg else 0,
            'market': market,
            'mcap': float(mcap) if mcap else 0,
            'free_float': int(ff_shares) if ff_shares else 0,
            'is_egx30': int(e30) if e30 else 0,
            'is_egx70': int(e70) if e70 else 0,
            'is_egx100': int(e100) if e100 else 0,
            'source': 'stocks.db',
            'timestamp': None,
        }

    # 2. لو فيه intraday أحدث من stocks.current_price، استخدمه
    if INTRADAY_DB.exists():
        try:
            iconn = sqlite3.connect(f"file:{INTRADAY_DB}?mode=ro", uri=True)
            try:
                # آخر tick لكل سهم
                intra_rows = iconn.execute("""
                    SELECT ticker, price, timestamp
                    FROM stock_intraday
                    WHERE price > 0
                    GROUP BY ticker
                    HAVING timestamp = MAX(timestamp)
                """).fetchall()
            finally:
                iconn.close()

            # بس استبدل لو الـ intraday سعره مختلف وأحدث
            for ticker, price, ts in intra_rows:
                if ticker in prices:
                    # لو الـ intraday من النهاردة، نستخدمه
                    if ts and str(ts)[:10] == datetime.now().strftime('%Y-%m-%d'):
                        p = float(price) if price else 0
                        if p > 0:
                            # احسب change_pct من previous_close
                            pc = prices[ticker]['prev_close']
                            new_chg = ((p - pc) / pc * 100) if pc > 0 else 0
                            prices[ticker]['price'] = p
                            prices[ticker]['change_pct'] = new_chg
                            prices[ticker]['source'] = 'intraday.db'
                            prices[ticker]['timestamp'] = str(ts)[:19]
        except Exception:
            pass  # intraday optional

    return prices


def compute_egx30_weighted(prices, constituents):
    """EGX30: Capped Market-Cap Weighted Index"""
    total_mcap = 0
    weighted_change = 0
    matched = 0
    base_value = 30000  # نقطة مرجعية

    for ticker in constituents:
        if ticker not in prices:
            continue
        p = prices[ticker]
        mcap = p['mcap'] or (p['price'] * p['free_float'] if p['free_float'] > 0 else p['price'] * 1_000_000)
        if mcap <= 0 or p['change_pct'] is None:
            continue
        total_mcap += mcap
        weighted_change += mcap * p['change_pct']
        matched += 1

    if total_mcap == 0 or matched < 15:
        return None

    avg_change = weighted_change / total_mcap
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': 'EGX30',
        'name': 'EGX 30 Index',
        'name_ar': 'مؤشر إيجي إكس 30 الرئيسي',
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': 0,
        'coverage': f'{matched}/30',
    }


def compute_egx70_ewi(prices, constituents):
    """EGX70: Equal-Weighted Index (EWI)"""
    changes = []
    for ticker in constituents:
        if ticker in prices and prices[ticker]['change_pct'] is not None:
            changes.append(prices[ticker]['change_pct'])

    if len(changes) < 35:
        return None

    avg_change = sum(changes) / len(changes)
    base_value = 8000
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': 'EGX70',
        'name': 'EGX 70 EWI Index',
        'name_ar': 'مؤشر إيجي إكس 70 متساوي الأوزان',
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': 0,
        'coverage': f'{len(changes)}/70',
    }


def compute_egx100_ewi(prices, constituents):
    """EGX100: Composite EWI (30 + 70 deduplicated)"""
    seen = set()
    changes = []
    for ticker in constituents:
        if ticker in seen:
            continue
        seen.add(ticker)
        if ticker in prices and prices[ticker]['change_pct'] is not None:
            changes.append(prices[ticker]['change_pct'])

    if len(changes) < 50:
        return None

    avg_change = sum(changes) / len(changes)
    base_value = 11000
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': 'EGX100',
        'name': 'EGX 100 EWI Index',
        'name_ar': 'مؤشر إيجي إكس 100 الأوسع نطاقاً',
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': 0,
        'coverage': f'{len(changes)}/100',
    }


def compute_egx33_shariah(prices, constituents):
    """EGX33: Shariah Capped Weighted Index"""
    total_mcap = 0
    weighted_change = 0
    matched = 0
    base_value = 3300

    for ticker in constituents:
        if ticker not in prices:
            continue
        p = prices[ticker]
        mcap = p['mcap'] or (p['price'] * 1_000_000)
        if mcap <= 0 or p['change_pct'] is None:
            continue
        total_mcap += mcap
        weighted_change += mcap * p['change_pct']
        matched += 1

    if total_mcap == 0 or matched < 15:
        return None

    avg_change = weighted_change / total_mcap
    current_value = base_value * (1 + avg_change / 100)
    prev_value = base_value
    change = current_value - prev_value

    return {
        'symbol': 'EGX33',
        'name': 'EGX 33 Shariah Index',
        'name_ar': 'مؤشر إيجي إكس 33 الشرعي',
        'current_value': round(current_value, 2),
        'previous_close': round(prev_value, 2),
        'change': round(change, 2),
        'change_percent': round(avg_change, 2),
        'is_shariah': 1,
        'coverage': f'{matched}/33',
    }


def compute_market_composite(prices, market, base_value, name, name_ar):
    """حساب مؤشر مركب لأي سوق (KSE/QSE) — market-cap weighted من كل أسهم السوق"""
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
        'symbol': f'{market}_COMPOSITE',
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

    # 2. اقرا canonical constituents
    if not CANONICAL_FILE.exists():
        print(f"  ✗ canonical_indices.json not found at {CANONICAL_FILE}")
        return 1
    with open(CANONICAL_FILE, encoding='utf-8') as f:
        canonical = json.load(f)

    # 3. احسب المؤشرات
    indices = []

    egx30 = compute_egx30_weighted(prices, canonical.get('EGX30', []))
    if egx30:
        indices.append(egx30)
        print(f"  ✓ EGX30: {egx30['current_value']:,.2f} ({egx30['change_percent']:+.2f}%) [{egx30['coverage']}]")

    egx70 = compute_egx70_ewi(prices, canonical.get('EGX70', []))
    if egx70:
        indices.append(egx70)
        print(f"  ✓ EGX70: {egx70['current_value']:,.2f} ({egx70['change_percent']:+.2f}%) [{egx70['coverage']}]")

    egx100 = compute_egx100_ewi(prices, canonical.get('EGX100', []))
    if egx100:
        indices.append(egx100)
        print(f"  ✓ EGX100: {egx100['current_value']:,.2f} ({egx100['change_percent']:+.2f}%) [{egx100['coverage']}]")

    # EGX33 — reuse EGX30 constituents as approximation if no separate list
    egx33 = compute_egx33_shariah(prices, canonical.get('EGX33', canonical.get('EGX30', [])[:33]))
    if egx33:
        indices.append(egx33)
        print(f"  ✓ EGX33: {egx33['current_value']:,.2f} ({egx33['change_percent']:+.2f}%) [{egx33['coverage']}]")

    # KSE composite
    kse = compute_market_composite(prices, 'KSE', 7000, 'KSE Composite', 'مؤشر بورصة الكويت المركب')
    if kse:
        indices.append(kse)
        print(f"  ✓ KSE: {kse['current_value']:,.2f} ({kse['change_percent']:+.2f}%) [{kse['coverage']} stocks]")

    # QSE composite
    qse = compute_market_composite(prices, 'QSE', 10000, 'QSE Composite', 'مؤشر بورصة قطر المركب')
    if qse:
        indices.append(qse)
        print(f"  ✓ QSE: {qse['current_value']:,.2f} ({qse['change_percent']:+.2f}%) [{qse['coverage']} stocks]")

    # TADAWUL composite
    tadawul = compute_market_composite(prices, 'TADAWUL', 12000, 'TADAWUL Composite', 'مؤشر تداول المركب')
    if tadawul:
        indices.append(tadawul)
        print(f"  ✓ TADAWUL: {tadawul['current_value']:,.2f} ({tadawul['change_percent']:+.2f}%) [{tadawul['coverage']} stocks]")

    print(f"  → computed {len(indices)} indices")

    # 4. اكتب في market_indices
    if not args.dry_run:
        now_iso = datetime.now().isoformat()
        conn = sqlite3.connect(str(STOCKS_DB), timeout=30.0)
        try:
            for idx in indices:
                upsert_index(conn, idx, now_iso)
            conn.commit()
            print(f"  ✅ upserted {len(indices)} indices into market_indices")
        finally:
            conn.close()
    else:
        print(f"  [DRY RUN] would upsert {len(indices)} indices")

    print(f"[{datetime.now().isoformat()[:19]}] ✅ done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
