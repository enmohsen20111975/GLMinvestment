#!/usr/bin/env python3
"""
B1 — ADP / ADPC Isolation Script (Task 1-a / Bravo)
=====================================================
**ISOLATES — DOES NOT DELETE.** Per owner constraint #1.

Creates a side-table ``data_isolation`` in ``db/stocks.db`` and snapshots
every confirmed-invalid record that this investigation found for the ticker
``ADP`` (and any other ticker that trips the same contamination patterns).
The original rows in ``stocks``, ``stock_daily_prices``, and
``price_history.db.price_history`` are LEFT IN PLACE — untouched — so any
future audit can diff the isolation table against the live DB.

The runtime gate (``core.price_sanity.validate_price_data`` wired into
``jobs/daily_predictor.py``) is what actually prevents contaminated data from
reaching analyzers; this script just produces the audit trail + the
before/after SQL report required by the owner's acceptance criteria.

Run:
    python3 scripts/b1_isolate_adp.py
    python3 scripts/b1_isolate_adp.py --dry-run   # show report only, no writes

Author: Bravo (Z.ai Code) — Task 1-a
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'

ISOLATION_DDL = """
CREATE TABLE IF NOT EXISTS data_isolation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    db_path TEXT NOT NULL,
    ticker TEXT NOT NULL,
    record_date TEXT,
    reason_code TEXT NOT NULL,
    reason_text TEXT NOT NULL,
    original_value_json TEXT,
    isolated_at TEXT NOT NULL,
    isolated_by TEXT DEFAULT 'b1_isolate_adp.py',
    task_id TEXT DEFAULT '1-a',
    UNIQUE(table_name, db_path, ticker, record_date, reason_code)
)
"""


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def _connect(path: Path, writable: bool = False) -> sqlite3.Connection:
    # Always open a fresh connection (read-only by default).
    uri = f'file:{path}?mode={"rw" if writable else "ro"}'
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_isolation_table(conn: sqlite3.Connection):
    conn.execute(ISOLATION_DDL)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_data_isolation_ticker "
        "ON data_isolation(ticker, reason_code)"
    )
    conn.commit()


def _upsert_isolation(conn: sqlite3.Connection, *, table_name: str, db_path: str,
                      ticker: str, record_date, reason_code: str,
                      reason_text: str, original_value_json: str):
    conn.execute(
        """
        INSERT INTO data_isolation
            (table_name, db_path, ticker, record_date, reason_code,
             reason_text, original_value_json, isolated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(table_name, db_path, ticker, record_date, reason_code)
        DO UPDATE SET
            reason_text = excluded.reason_text,
            original_value_json = excluded.original_value_json,
            isolated_at = excluded.isolated_at
        """,
        (table_name, db_path, ticker, record_date, reason_code,
         reason_text, original_value_json, _ts()),
    )


# ──────────────────────────────────────────────────────────────────────────
# Snapshot helpers (read-only)
# ──────────────────────────────────────────────────────────────────────────

def _snapshot_stocks_row(conn: sqlite3.Connection, ticker: str):
    cur = conn.execute(
        "SELECT id, ticker, name, name_ar, market, currency, exchange, "
        "current_price, previous_close, open_price, high_price, low_price, "
        "close, change_percent, support, resistance, signal, trend, "
        "high_52w, low_52w, last_update, updated_at "
        "FROM stocks WHERE ticker = ?",
        (ticker,),
    )
    return [dict(r) for r in cur.fetchall()]


def _snapshot_stock_daily_prices(conn: sqlite3.Connection, ticker: str):
    cur = conn.execute(
        "SELECT id, ticker, price_date, open, high, low, close, volume, "
        "open_price, high_price, low_price, close_price, market, turnover "
        "FROM stock_daily_prices WHERE ticker = ? ORDER BY price_date",
        (ticker,),
    )
    return [dict(r) for r in cur.fetchall()]


def _snapshot_price_history(conn: sqlite3.Connection, ticker: str):
    cur = conn.execute(
        "SELECT id, ticker, date, open_price, high_price, low_price, "
        "close_price, volume, source, market "
        "FROM price_history WHERE ticker = ? ORDER BY date",
        (ticker,),
    )
    return [dict(r) for r in cur.fetchall()]


# ──────────────────────────────────────────────────────────────────────────
# Isolation logic for ADP
# ──────────────────────────────────────────────────────────────────────────

def isolate_adp(dry_run: bool = False) -> dict:
    """Snapshot + isolate the contaminated ADP records. Returns stats."""
    stats = {
        'stocks_rows_isolated': 0,
        'stock_daily_prices_rows_isolated': 0,
        'price_history_rows_isolated': 0,
        'reason_codes': set(),
    }

    if not STOCKS_DB.exists():
        print(f"  ⚠️  stocks.db not found at {STOCKS_DB}", flush=True)
        return stats

    # ── 1. Read-only snapshot from stocks.db ───────────────────────────
    ro = _connect(STOCKS_DB, writable=False)
    adp_stocks = _snapshot_stocks_row(ro, 'ADP')
    adp_sdp = _snapshot_stock_daily_prices(ro, 'ADP')

    adpc_stocks = _snapshot_stocks_row(ro, 'ADPC')
    adpc_sdp = _snapshot_stock_daily_prices(ro, 'ADPC')

    # ── 2. Read-only snapshot from price_history.db ───────────────────
    adp_ph = []
    if PRICE_HISTORY_DB.exists():
        ro_ph = _connect(PRICE_HISTORY_DB, writable=False)
        adp_ph = _snapshot_price_history(ro_ph, 'ADP')
        ro_ph.close()

    ro.close()

    # ── 3. Decide isolation records ────────────────────────────────────
    isolations = []  # list of (table, db_path, ticker, date, code, text, json)

    # 3a. stocks.stocks row for ADP — primary contamination
    if adp_stocks:
        row = adp_stocks[0]
        reasons = []
        if (row.get('currency') or '').upper() == 'USD' and (row.get('market') or '').upper() == 'EGX':
            reasons.append('currency_market_mismatch:EGX/USD')
        if row.get('low_price') is not None and row.get('high_price') is not None:
            lo, hi = float(row['low_price']), float(row['high_price'])
            if lo > 0 and hi > 0 and hi / lo > 2.0:
                reasons.append(f'impossible_ohlc_range:low={lo},high={hi},ratio={hi/lo:.1f}x')
        if (row.get('name_ar') or '').strip() == (adpc_stocks[0].get('name_ar') or '').strip() if adpc_stocks else False:
            reasons.append('duplicate_name_ar_with_adpc')
        reason_text = '; '.join(reasons) if reasons else 'contaminated_identity_pending_review'
        isolations.append((
            'stocks', str(STOCKS_DB), 'ADP', None,
            'ticker_collision_usd_contamination',
            reason_text,
            json.dumps(row, ensure_ascii=False, default=str),
        ))
        stats['stocks_rows_isolated'] += 1
        stats['reason_codes'].add('ticker_collision_usd_contamination')

    # 3b. stock_daily_prices rows for ADP — split into two regimes
    for r in adp_sdp:
        pd_ = r.get('price_date')
        o, h, l, c = r.get('open'), r.get('high'), r.get('low'), r.get('close')
        # old regime: flat OHLC=3.7 (matches ADPC's old EGP range)
        if o is not None and h is not None and l is not None and c is not None:
            if abs(float(o) - 3.7) < 0.01 and abs(float(h) - 3.7) < 0.01:
                isolations.append((
                    'stock_daily_prices', str(STOCKS_DB), 'ADP', pd_,
                    'cross_ticker_leakage_from_adpc',
                    f'flat OHLC=3.7 matches ADPC old EGP price range (volume={r.get("volume")})',
                    json.dumps(r, ensure_ascii=False, default=str),
                ))
                stats['stock_daily_prices_rows_isolated'] += 1
                stats['reason_codes'].add('cross_ticker_leakage_from_adpc')
                continue
        # new regime: open=269.94 / close=263.855 (US ADP price range, USD)
        if o is not None and float(o) > 100:
            isolations.append((
                'stock_daily_prices', str(STOCKS_DB), 'ADP', pd_,
                'us_market_source_contamination',
                f'OHLC in US-ADP price range (~$264 USD); open={o}, high={h}, low={l}, close={c}',
                json.dumps(r, ensure_ascii=False, default=str),
            ))
            stats['stock_daily_prices_rows_isolated'] += 1
            stats['reason_codes'].add('us_market_source_contamination')

    # 3c. price_history rows for ADP — flag the intraday_aggregated + US-market rows
    for r in adp_ph:
        d = r.get('date')
        src = (r.get('source') or '').lower()
        mkt = (r.get('market') or '').upper()
        if src == 'intraday_aggregated' or mkt == 'US':
            isolations.append((
                'price_history', str(PRICE_HISTORY_DB), 'ADP', d,
                'intraday_aggregated_us_contamination',
                f'source={src}, market={mkt}, open={r.get("open_price")}, close={r.get("close_price")}',
                json.dumps(r, ensure_ascii=False, default=str),
            ))
            stats['price_history_rows_isolated'] += 1
            stats['reason_codes'].add('intraday_aggregated_us_contamination')

    # 3d. historical_migration rows for ADP (the 2 rows with low=263.855 / high=269.94) —
    # these are the cross-walk between regimes; isolate with the same reason.
    for r in adp_ph:
        d = r.get('date')
        src = (r.get('source') or '').lower()
        mkt = (r.get('market') or '').upper()
        if src == 'historical_migration' and mkt == 'EGX':
            # only add if not already added
            already = any(
                x[0] == 'price_history' and x[3] == d
                for x in isolations
            )
            if not already:
                isolations.append((
                    'price_history', str(PRICE_HISTORY_DB), 'ADP', d,
                    'historical_migration_cross_regime',
                    f'EGX-tagged but US-ADP price range (~$264); open={r.get("open_price")}, close={r.get("close_price")}',
                    json.dumps(r, ensure_ascii=False, default=str),
                ))
                stats['price_history_rows_isolated'] += 1
                stats['reason_codes'].add('historical_migration_cross_regime')

    # ── 4. Write the isolation table (NO deletes anywhere) ─────────────
    if dry_run:
        print(f"\n  [DRY-RUN] would record {len(isolations)} isolation entries.", flush=True)
        for x in isolations[:5]:
            print(f"    - {x[0]}/{x[2]}/{x[3]} | {x[4]} | {x[5][:80]}", flush=True)
        if len(isolations) > 5:
            print(f"    ... and {len(isolations) - 5} more", flush=True)
    else:
        rw = _connect(STOCKS_DB, writable=True)
        _ensure_isolation_table(rw)
        for (tbl, dbp, tk, dt, code, text, jsn) in isolations:
            _upsert_isolation(
                rw, table_name=tbl, db_path=dbp, ticker=tk,
                record_date=dt, reason_code=code, reason_text=text,
                original_value_json=jsn,
            )
        rw.commit()
        rw.close()

    stats['reason_codes'] = sorted(stats['reason_codes'])
    stats['total_isolated'] = len(isolations)
    return stats


# ──────────────────────────────────────────────────────────────────────────
# Before/After SQL report
# ──────────────────────────────────────────────────────────────────────────

def sql_report(detailed: bool = False) -> str:
    """Generate the before/after SQL report required by acceptance criteria."""
    lines = []
    lines.append("=" * 78)
    lines.append("B1 — ADP / ADPC SQL INVESTIGATION REPORT (Task 1-a / Bravo)")
    lines.append("=" * 78)
    lines.append(f"Generated: {_ts()}")
    lines.append("")

    # ── stocks.stocks ───────────────────────────────────────────────────
    if STOCKS_DB.exists():
        ro = _connect(STOCKS_DB, writable=False)
        for tk in ('ADP', 'ADPC'):
            cur = ro.execute(
                "SELECT id, ticker, name, name_ar, market, currency, exchange, "
                "current_price, open_price, high_price, low_price, close, "
                "support, resistance, high_52w, low_52w, last_update, updated_at "
                "FROM stocks WHERE ticker = ?",
                (tk,),
            )
            row = cur.fetchone()
            if row:
                d = dict(row)
                lines.append(f"[stocks.stocks] {tk}:")
                lines.append(f"  id={d['id']} | market={d['market']} | currency={d['currency']} | exchange={d['exchange']}")
                lines.append(f"  name='{d['name']}' | name_ar='{d['name_ar']}'")
                lines.append(f"  current_price={d['current_price']} | open={d['open_price']} | high={d['high_price']} | low={d['low_price']} | close={d['close']}")
                lines.append(f"  support={d['support']} | resistance={d['resistance']} | 52w_high={d['high_52w']} | 52w_low={d['low_52w']}")
                lines.append(f"  last_update={d['last_update']}")
                # status verdict
                if (d['currency'] or '').upper() == 'USD' and (d['market'] or '').upper() == 'EGX':
                    lines.append(f"  STATUS: مشكوك فيه (USD on EGX — contaminated)")
                elif d['high_price'] and d['low_price'] and float(d['high_price']) / max(float(d['low_price']), 1e-9) > 5:
                    lines.append(f"  STATUS: مشكوك فيه (extreme OHLC range)")
                elif d['last_update']:
                    lines.append(f"  STATUS: سليم")
                else:
                    lines.append(f"  STATUS: غير صالح (no data)")
                lines.append("")

        # ── stock_daily_prices ───────────────────────────────────────
        for tk in ('ADP', 'ADPC'):
            cur = ro.execute(
                "SELECT COUNT(*) n, MIN(price_date) mn, MAX(price_date) mx, "
                "MIN(low) minl, MAX(high) maxh, MIN(close) minc, MAX(close) maxc "
                "FROM stock_daily_prices WHERE ticker = ?",
                (tk,),
            )
            r = dict(cur.fetchone())
            lines.append(f"[stock_daily_prices] {tk}: rows={r['n']} | {r['mn']} → {r['mx']} | low range=[{r['minl']}..{r['maxh']}] | close range=[{r['minc']}..{r['maxc']}]")
            if r['n'] and r['minl'] and r['maxh'] and float(r['maxh']) / max(float(r['minl']), 1e-9) > 5:
                lines.append(f"  STATUS: مشكوك فيه (extreme low/high spread → cross-regime contamination)")
            else:
                lines.append(f"  STATUS: سليم")
            lines.append("")

        # ── data_isolation summary ───────────────────────────────────
        try:
            cur = ro.execute(
                "SELECT ticker, table_name, reason_code, COUNT(*) n FROM data_isolation "
                "GROUP BY ticker, table_name, reason_code ORDER BY ticker, table_name"
            )
            iso_rows = [dict(r) for r in cur.fetchall()]
            lines.append("[data_isolation] (side-table — audit trail, NOT deletion):")
            if iso_rows:
                for r in iso_rows:
                    lines.append(f"  {r['ticker']:6s} | {r['table_name']:22s} | {r['reason_code']:38s} | {r['n']} rows")
            else:
                lines.append("  (empty — run with --write to populate)")
            lines.append("")
        except sqlite3.OperationalError:
            lines.append("[data_isolation] table not yet created (run with --write)")
            lines.append("")

        ro.close()

    # ── price_history.db ───────────────────────────────────────────────
    if PRICE_HISTORY_DB.exists():
        ro = _connect(PRICE_HISTORY_DB, writable=False)
        for tk in ('ADP', 'ADPC'):
            cur = ro.execute(
                "SELECT COUNT(*) n, MIN(date) mn, MAX(date) mx, "
                "MIN(close_price) minc, MAX(close_price) maxc, AVG(close_price) avgc "
                "FROM price_history WHERE ticker = ?",
                (tk,),
            )
            r = dict(cur.fetchone())
            lines.append(f"[price_history] {tk}: rows={r['n']} | {r['mn']} → {r['mx']} | close=[{r['minc']}..{r['maxc']}] avg={r['avgc']:.2f}" if r['avgc'] else f"[price_history] {tk}: rows={r['n']} | {r['mn']} → {r['mx']} | close=[{r['minc']}..{r['maxc']}]")
            # latest row
            cur2 = ro.execute(
                "SELECT date, open_price, high_price, low_price, close_price, volume, source, market "
                "FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                (tk,),
            )
            latest = dict(cur2.fetchone() or {})
            if latest:
                lines.append(f"  latest: date={latest['date']} | O={latest['open_price']} H={latest['high_price']} L={latest['low_price']} C={latest['close_price']} | source={latest['source']} | market={latest['market']}")
            # anomalies
            cur3 = ro.execute(
                "SELECT COUNT(*) n FROM price_history WHERE ticker = ? AND "
                "(low_price > high_price OR low_price < 0 OR high_price < 0 OR close_price <= 0)",
                (tk,),
            )
            anom = cur3.fetchone()['n']
            lines.append(f"  anomalous rows (low>high OR negative OR close<=0): {anom}")
            # status
            if (latest.get('market') or '').upper() == 'US' and tk == 'ADP':
                lines.append(f"  STATUS: مشكوك فيه (market=US for ticker that should be EGX)")
            elif r['n'] and r['minc'] and r['maxc'] and float(r['maxc']) / max(float(r['minc']), 1e-9) > 50:
                lines.append(f"  STATUS: مشكوك فيه (close spread >50× → cross-regime contamination)")
            else:
                lines.append(f"  STATUS: سليم")
            lines.append("")
        ro.close()

    lines.append("=" * 78)
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description='B1 — ADP/ADPC isolation (NO delete)')
    p.add_argument('--dry-run', action='store_true', help='Print report only — no DB writes')
    p.add_argument('--write', action='store_true', help='Write the data_isolation side-table')
    p.add_argument('--report-only', action='store_true', help='Print SQL report and exit')
    args = p.parse_args()

    if args.report_only or args.dry_run or not args.write:
        print(sql_report(detailed=args.dry_run))

    if args.dry_run or args.report_only:
        if args.dry_run:
            print("\n--- DRY-RUN isolation preview ---")
            isolate_adp(dry_run=True)
        return 0

    stats = isolate_adp(dry_run=False)
    print("\n--- ISOLATION COMPLETE (NO deletes performed) ---")
    print(f"  stocks rows isolated:            {stats['stocks_rows_isolated']}")
    print(f"  stock_daily_prices rows isolated: {stats['stock_daily_prices_rows_isolated']}")
    print(f"  price_history rows isolated:     {stats['price_history_rows_isolated']}")
    print(f"  total isolation entries:         {stats['total_isolated']}")
    print(f"  reason codes:                    {stats['reason_codes']}")
    print("\n--- AFTER isolation: SQL report ---")
    print(sql_report())
    return 0


if __name__ == '__main__':
    sys.exit(main())
