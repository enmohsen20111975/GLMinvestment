#!/usr/bin/env python3
"""
diagnose_price_data.py — فحص جودة بيانات الأسعار قبل التدريب.

يجاوب على السؤال: ليه أسهم كتير مرفوضة بسبب insufficient_history؟

Usage:
  python3 -m learning_engine.cli.diagnose_price_data --market EGX
  python3 -m learning_engine.cli.diagnose_price_data --market ALL
"""
from __future__ import annotations
import sys
import sqlite3
from pathlib import Path
from collections import Counter
import argparse

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_PROJECT_ROOT))


def _connect(db_name: str) -> sqlite3.Connection:
    db_path = _PROJECT_ROOT / "db" / db_name
    if not db_path.exists():
        print(f"  [SKIP] {db_path} — not found")
        return None
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def _audit_market(market: str, min_history: int = 30, horizon: int = 5):
    """يفحص بيانات السوق ويطبع تقرير واضح."""
    threshold = min_history + 20  # min_history + max_future
    print(f"\n{'='*70}")
    print(f"Price Data Audit — Market: {market}")
    print(f"  Need ≥ {threshold} bars per symbol (min_history={min_history} + future={horizon}+15)")
    print(f"{'='*70}")

    # ─── data_engine.db.egksco_price_history ───────────────────────
    conn = _connect("data_engine.db")
    if conn:
        print(f"\n[data_engine.db.egksco_price_history]")
        cur = conn.cursor()
        # متغيرات اسم السوق (مصر بالعربي في قاعدة البيانات)
        market_variants = [market] if market != "EGX" else ["EGX", "مصر"]

        # كل الأسعار في كل المصادر
        for mv in market_variants:
            cur.execute(
                "SELECT COUNT(DISTINCT symbol), COUNT(*) FROM egksco_price_history WHERE market = ?",
                (mv,)
            )
            n_sym, n_rows = cur.fetchone()
            print(f"  market='{mv}': {n_sym} symbols, {n_rows} rows")

        # عدد البارات لكل سهم
        placeholders = ",".join(["?"] * len(market_variants))
        cur.execute(
            f"""SELECT symbol, COUNT(*) as c, MIN(price_date), MAX(price_date)
                FROM egksco_price_history
                WHERE market IN ({placeholders})
                GROUP BY symbol
                ORDER BY c DESC""",
            market_variants
        )
        rows = cur.fetchall()
        bar_counts = [r[1] for r in rows]
        buckets = Counter()
        for c in bar_counts:
            if c < 10: buckets['<10'] += 1
            elif c < 30: buckets['10-29'] += 1
            elif c < 50: buckets['30-49'] += 1
            elif c < 100: buckets['50-99'] += 1
            elif c < 250: buckets['100-249'] += 1
            else: buckets['250+'] += 1

        print(f"\n  Total symbols: {len(rows)}")
        print(f"  Bar count distribution:")
        for b in ['<10', '10-29', '30-49', '50-99', '100-249', '250+']:
            if buckets[b] > 0:
                print(f"    {b:8} bars: {buckets[b]:5} symbols")

        passed = sum(1 for c in bar_counts if c >= threshold)
        failed = sum(1 for c in bar_counts if c < threshold)
        print(f"\n  Pass threshold (≥{threshold} bars): {passed} symbols")
        print(f"  Fail (insufficient_history): {failed} symbols  ({failed*100/max(len(rows),1):.1f}٪)")

        # Top 5 symbols by bar count (الأغنى بالبيانات)
        print(f"\n  Top 5 symbols by bar count:")
        for r in rows[:5]:
            print(f"    {r[0]:12} bars={r[1]:4}  range={r[2]} → {r[3]}")

        # Bottom 5 (الأقل بيانات)
        print(f"\n  Bottom 5 symbols by bar count:")
        for r in rows[-5:]:
            print(f"    {r[0]:12} bars={r[1]:4}  range={r[2]} → {r[3]}")

        conn.close()

    # ─── stocks.db.stock_daily_prices ───────────────────────────────
    conn = _connect("stocks.db")
    if conn:
        print(f"\n[stocks.db.stock_daily_prices]")
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(DISTINCT ticker), COUNT(*) FROM stock_daily_prices WHERE market = ?",
            (market,)
        )
        n_sym, n_rows = cur.fetchone()
        print(f"  market='{market}': {n_sym} symbols, {n_rows} rows")

        cur.execute(
            """SELECT ticker, COUNT(*) as c, MIN(price_date), MAX(price_date)
                FROM stock_daily_prices
                WHERE market = ?
                GROUP BY ticker
                ORDER BY c DESC""",
            (market,)
        )
        rows = cur.fetchall()
        bar_counts = [r[1] for r in rows]
        buckets = Counter()
        for c in bar_counts:
            if c < 10: buckets['<10'] += 1
            elif c < 30: buckets['10-29'] += 1
            elif c < 50: buckets['30-49'] += 1
            elif c < 100: buckets['50-99'] += 1
            elif c < 250: buckets['100-249'] += 1
            else: buckets['250+'] += 1

        print(f"\n  Total symbols: {len(rows)}")
        print(f"  Bar count distribution:")
        for b in ['<10', '10-29', '30-49', '50-99', '100-249', '250+']:
            if buckets[b] > 0:
                print(f"    {b:8} bars: {buckets[b]:5} symbols")

        passed = sum(1 for c in bar_counts if c >= threshold)
        failed = sum(1 for c in bar_counts if c < threshold)
        print(f"\n  Pass threshold (≥{threshold} bars): {passed} symbols")
        print(f"  Fail (insufficient_history): {failed} symbols  ({failed*100/max(len(rows),1):.1f}٪)")

        if rows:
            # النطاق الزمني الكلي للسوق
            min_dates = [r[2] for r in rows if r[2]]
            max_dates = [r[3] for r in rows if r[3]]
            if min_dates and max_dates:
                print(f"\n  Overall date range: {min(min_dates)} → {max(max_dates)}")
                days_span = (datetime.date.fromisoformat(max(max_dates)) -
                            datetime.date.fromisoformat(min(min_dates))).days
                print(f"  Span: ~{days_span} days (~{days_span/30:.1f} months)")

        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Diagnose price data quality before training")
    parser.add_argument("--market", default="ALL", help="Market (EGX, US, ALL)")
    parser.add_argument("--min-history", type=int, default=30, help="Min history threshold")
    parser.add_argument("--horizon", type=int, default=5, help="Label horizon")
    args = parser.parse_args()

    if args.market == "ALL":
        for m in ["EGX", "US"]:
            _audit_market(m, args.min_history, args.horizon)
    else:
        _audit_market(args.market, args.min_history, args.horizon)

    print(f"\n{'='*70}")
    print(f"AUDIT COMPLETE")
    print(f"{'='*70}")
    print(f"\nتوصية:")
    print(f"  لو معظم الأسهم < 50 bars → المشكلة بيانات (نقص تاريخي)، لا حل برمجي.")
    print(f"  لازم تجمع بيانات أعمق (>= 6 شهور لكل سهم).")
    print(f"  لو في أسهم كويسة (>= 250 bars) → ركّز عليها للتدريب (subset quality > quantity).")


if __name__ == "__main__":
    # local import لـ datetime.date
    import datetime
    main()
