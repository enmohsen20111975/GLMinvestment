#!/usr/bin/env python3
"""
Phase 0 — Measurement Integrity Fix  (CLI-driven, production-safe)
==================================================================
1. Backfill `highest_price_reached` + `lowest_price_reached` from price_history
   (between the prediction/entry date and the outcome date, + optional extended
   window to capture the "what if you held longer" upside).
2. Fix `is_correct = (actual_return > 0)` instead of `exit_type='target_hit'`.

Design notes
------------
- NEVER touches the production file blindly: auto-backs-up predictions.db to
  `<pred_db>.bak_phase0_<timestamp>` before any write (unless --no-backup).
- Supports `--dry-run` to preview counts without writing.
- Prints a verification block at the end (has_high count + avg_high_pct) so the
  operator can immediately confirm the backfill landed.
- Pure sqlite3 + stdlib — no vps-service imports, runs anywhere.

Usage
-----
    # Preview only (no writes)
    python3 scripts/backfill_phase0.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db \\
        --dry-run

    # Apply (auto-backup first)
    python3 scripts/backfill_phase0.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db

    # Custom extended window + report path
    python3 scripts/backfill_phase0.py \\
        --pred-db db/predictions.db \\
        --ph-db  db/price_history.db \\
        --extended-window-days 30 \\
        --out db/backups/phase0_backfill_report.json
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta

# How many days AFTER outcome_date to keep tracking the max-high. 0 = only the
# trade window [entry, outcome]. 30 captures the "missed upside" the Phase-0
# analysis surfaced (≈32% of trades had ≥2× realized upside if held longer).
DEFAULT_EXTENDED_WINDOW_DAYS = 30

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def parse_date(s):
    """Parse a date-ish string -> datetime, or None."""
    if not s:
        return None
    s = str(s).strip()
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%Y/%m/%d'):
        try:
            return datetime.strptime(s[:19] if (' ' in s or 'T' in s) else s[:10], fmt)
        except ValueError:
            continue
    try:
        return datetime.strptime(s[:10], '%Y-%m-%d')
    except Exception:
        return None


def backup_db(path, dry_run):
    """Copy path -> path.bak_phase0_<UTCish-timestamp>. Skip if dry-run."""
    if dry_run:
        print(f"  [dry-run] skipping backup of {path}")
        return None
    if not os.path.exists(path):
        return None
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    bak = f"{path}.bak_phase0_{ts}"
    shutil.copy2(path, bak)
    print(f"  [backup] {path} -> {bak}")
    return bak


def table_has_column(con, table, col):
    cols = {r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}
    return col in cols


# ──────────────────────────────────────────────────────────────────────────────
# Core backfill
# ──────────────────────────────────────────────────────────────────────────────

def backfill(pred_db, ph_db, extended_window_days, dry_run, no_backup, out_path):
    print(f"=== PHASE-0 Backfill (dry_run={dry_run}) ===")
    print(f"  predictions:   {pred_db}")
    print(f"  price_history: {ph_db}")
    print(f"  extended_window_days: {extended_window_days}")
    print()

    # 0. Schema sanity — price_history must have the columns we read.
    ph = sqlite3.connect(ph_db)
    ph.row_factory = sqlite3.Row
    for col in ('ticker', 'date', 'high_price', 'low_price'):
        if not table_has_column(ph, 'price_history', col):
            print(f"  [FATAL] price_history missing column: {col}")
            return 2

    pred = sqlite3.connect(pred_db)
    pred.row_factory = sqlite3.Row
    for col in ('id', 'ticker', 'prediction_date', 'created_at', 'outcome_date',
                'entry_price', 'highest_price_reached', 'lowest_price_reached',
                'actual_return', 'is_correct', 'market'):
        if not table_has_column(pred, 'predictions', col):
            print(f"  [FATAL] predictions missing column: {col}")
            return 2

    # 1. Backup before writes.
    bak = None if no_backup else backup_db(pred_db, dry_run)

    # 2. Load closed EGX predictions.
    rows = pred.execute("""
        SELECT id, ticker, prediction_date, created_at, outcome_date,
               entry_price, target_price, stop_loss, exit_price, actual_return,
               highest_price_reached, lowest_price_reached, exit_type
        FROM predictions
        WHERE outcome_date IS NOT NULL AND market='EGX'
    """).fetchall()
    print(f"  Closed EGX predictions to backfill: {len(rows)}")

    updated_high_low = 0
    already_filled = 0
    no_candles = 0
    no_dates = 0
    stats = []

    for r in rows:
        start_dt = parse_date(r['prediction_date'] or r['created_at'])
        end_dt = parse_date(r['outcome_date'])
        if not start_dt or not end_dt:
            no_dates += 1
            continue

        start_str = start_dt.strftime('%Y-%m-%d')
        end_str = end_dt.strftime('%Y-%m-%d')

        # Trade-window candles [entry, outcome].
        candles = ph.execute("""
            SELECT date, high_price, low_price, close_price
            FROM price_history
            WHERE ticker = ? AND date >= ? AND date <= ?
            ORDER BY date ASC
        """, (r['ticker'], start_str, end_str)).fetchall()

        if not candles:
            no_candles += 1
            continue

        highs = [c['high_price'] for c in candles if c['high_price'] and c['high_price'] > 0]
        lows = [c['low_price'] for c in candles if c['low_price'] and c['low_price'] > 0]
        if not highs or not lows:
            no_candles += 1
            continue

        max_high = max(highs)
        min_low = min(lows)

        # Extended window (post-outcome) — only raise the high, never lower it.
        ext_max_high = None
        if extended_window_days > 0:
            ext_end_str = (end_dt + timedelta(days=extended_window_days)).strftime('%Y-%m-%d')
            ext_candles = ph.execute("""
                SELECT date, high_price
                FROM price_history
                WHERE ticker = ? AND date > ? AND date <= ?
                ORDER BY date ASC
            """, (r['ticker'], end_str, ext_end_str)).fetchall()
            ext_highs = [c['high_price'] for c in ext_candles if c['high_price'] and c['high_price'] > 0]
            if ext_highs:
                ext_max_high = max(ext_highs)
                if ext_max_high > max_high:
                    max_high = ext_max_high

        # Skip the UPDATE if both columns are already correct (idempotency).
        cur_high = r['highest_price_reached']
        cur_low = r['lowest_price_reached']
        if cur_high == max_high and cur_low == min_low:
            already_filled += 1
        else:
            if not dry_run:
                pred.execute("""
                    UPDATE predictions
                    SET highest_price_reached = ?,
                        lowest_price_reached  = ?
                    WHERE id = ?
                """, (max_high, min_low, r['id']))
            updated_high_low += 1

        entry = r['entry_price'] or 0
        if entry > 0:
            upside_to_high = (max_high - entry) / entry * 100
            downside_to_low = (min_low - entry) / entry * 100
            ext_upside = (ext_max_high - entry) / entry * 100 if ext_max_high else None
            stats.append({
                'id': r['id'],
                'ticker': r['ticker'],
                'entry': entry,
                'target': r['target_price'] or 0,
                'stop': r['stop_loss'] or 0,
                'exit': r['exit_price'] or 0,
                'high': max_high,
                'low': min_low,
                'ret': r['actual_return'] or 0,
                'upside_to_high': round(upside_to_high, 2),
                'downside_to_low': round(downside_to_low, 2),
                'ext_high': ext_max_high,
                'ext_upside': round(ext_upside, 2) if ext_upside is not None else None,
                'days': len(candles),
                'exit_type': r['exit_type'],
            })

    if not dry_run:
        pred.commit()

    # 3. Fix is_correct = (actual_return > 0).
    print("\n  --- Fixing is_correct ---")
    before = pred.execute(
        "SELECT COUNT(*) FROM predictions WHERE is_correct=1 AND outcome_date IS NOT NULL AND market='EGX'"
    ).fetchone()[0]
    if not dry_run:
        pred.execute("""
            UPDATE predictions
            SET is_correct = CASE WHEN actual_return > 0 THEN 1 ELSE 0 END
            WHERE outcome_date IS NOT NULL AND market='EGX'
        """)
        pred.commit()
    after = pred.execute(
        "SELECT COUNT(*) FROM predictions WHERE is_correct=1 AND outcome_date IS NOT NULL AND market='EGX'"
    ).fetchone()[0]
    print(f"    is_correct=1 BEFORE: {before}")
    print(f"    is_correct=1 AFTER : {after}{'  (dry-run, not applied)' if dry_run else ''}")

    # 4. Summary + verification.
    print(f"\n  --- Backfill summary ---")
    print(f"    updated high/low : {updated_high_low}{'  (dry-run)' if dry_run else ''}")
    print(f"    already filled   : {already_filled}")
    print(f"    no candles found : {no_candles}")
    print(f"    no usable dates  : {no_dates}")
    if bak:
        print(f"    backup file      : {bak}")

    # Verification block — the operator's green light.
    print(f"\n  --- VERIFICATION (run-after-backfill snapshot) ---")
    ver = pred.execute("""
        SELECT COUNT(*) AS n,
          SUM(CASE WHEN highest_price_reached IS NOT NULL AND highest_price_reached > 0
                   THEN 1 ELSE 0 END) AS has_high,
          AVG(CASE WHEN entry_price > 0 AND highest_price_reached > 0
              THEN (highest_price_reached*1.0/entry_price - 1)*100 END) AS avg_high_pct,
          AVG(CASE WHEN entry_price > 0 AND lowest_price_reached > 0
              THEN (lowest_price_reached*1.0/entry_price - 1)*100 END) AS avg_low_pct
        FROM predictions
        WHERE outcome_date IS NOT NULL AND market='EGX'
    """).fetchone()
    n = ver['n']
    has_high = ver['has_high']
    avg_high = ver['avg_high_pct']
    avg_low = ver['avg_low_pct']
    print(f"    closed trades          : {n}")
    print(f"    has highest_price (>0) : {has_high} ({has_high*100//n if n else 0}% of closed)")
    print(f"    avg high% (vs entry)   : {avg_high:+.2f}%" if avg_high is not None else "    avg high% : N/A")
    print(f"    avg low%  (vs entry)   : {avg_low:+.2f}%" if avg_low is not None else "    avg low%  : N/A")
    ok = (has_high or 0) >= (n * 0.9) and (avg_high or 0) > 0
    print(f"    {'✓ PASS' if ok else '✗ CHECK'}: has_high ~ closed trades AND avg_high_pct > 0")

    # 5. Save report.
    report = {
        'run_at': datetime.now().isoformat(),
        'dry_run': dry_run,
        'databases': {'predictions': pred_db, 'price_history': ph_db},
        'backup': bak,
        'extended_window_days': extended_window_days,
        'summary': {
            'closed_egx': len(rows),
            'updated_high_low': updated_high_low,
            'already_filled': already_filled,
            'no_candles': no_candles,
            'no_dates': no_dates,
            'is_correct_before': before,
            'is_correct_after': after,
        },
        'verification': {
            'closed_trades': n,
            'has_high': has_high,
            'avg_high_pct': round(avg_high, 4) if avg_high is not None else None,
            'avg_low_pct': round(avg_low, 4) if avg_low is not None else None,
            'pass': ok,
        },
        'stats': stats,
    }
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n  Report saved -> {out_path}")

    pred.close()
    ph.close()
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser(description='Phase 0 — backfill high/low + fix is_correct')
    p.add_argument('--pred-db', required=True, help='Path to predictions.db')
    p.add_argument('--ph-db', required=True, help='Path to price_history.db')
    p.add_argument('--extended-window-days', type=int, default=DEFAULT_EXTENDED_WINDOW_DAYS,
                   help='Days after outcome_date to keep tracking max-high (default 30)')
    p.add_argument('--dry-run', action='store_true', help='Preview only — no writes, no backup')
    p.add_argument('--no-backup', action='store_true', help='Skip auto-backup (not recommended)')
    p.add_argument('--out', default='db/backups/phase0_backfill_report.json',
                   help='Output JSON report path')
    a = p.parse_args()
    return backfill(a.pred_db, a.ph_db, a.extended_window_days, a.dry_run, a.no_backup, a.out)


if __name__ == '__main__':
    sys.exit(main())
