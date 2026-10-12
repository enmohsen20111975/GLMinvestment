#!/usr/bin/env python3
"""
P0-TICKER-PURGE — purge_and_align_egx_tickers.py
=================================================
Comprehensive EGX ticker purge + alignment for the GLMinvestment project.

Database state BEFORE this script (verified by field audit):
  - stocks table: 461 EGX rows
  - ticker_registry: 458 EGX entries, only 8 with valid tradingview_symbol
  - 79 stocks where name_ar == name (English placeholder in Arabic field)
  - 20 stocks with ticker LIKE 'EGS%' (ISIN codes used as tickers)
  - 6 duplicate name_ar groups
  - Confirmed duplicates: ADP/ADPC, CALT/COSG, EDBM, EGS220N1C016->NBCC,
    EGS3E071C013-EGP->ACRO, EGS65861C014->EABD

Six phases (all idempotent, dry-run by default):

  Phase 1 — Analysis + report (always runs; does NOT modify data)
  Phase 2 — Delete duplicates (ADP, COSG, less-used of 6 name_ar groups)
  Phase 3 — Merge ISIN-like tickers (EGS...) into canonical tickers
  Phase 4 — Fix name_ar (use ticker_registry's Arabic name, else deactivate)
  Phase 5 — Deactivate EDBM (delisted/unconfirmed)
  Phase 6 — Fill tradingview_symbol for all active EGX stocks

Rules enforced:
  - Rule 27 (NO-FAKE-DATA): no fabricated Arabic names. If unsure -> deactivate.
  - Rule 75 (PUSH-AFTER-EVERY-TASK): commit + push (handled by caller)
  - No destructive delete of stocks with predictions -> re-parent first.
  - Dry-run default; --execute to apply.
  - Idempotent: running twice yields the same result.

Usage:
  python3 scripts/purge_and_align_egx_tickers.py             # dry-run
  python3 scripts/purge_and_align_egx_tickers.py --execute   # apply changes
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = REPO_ROOT / "db" / "stocks.db"
PREDICTIONS_DB = REPO_ROOT / "db" / "predictions.db"
TODO_FILE = REPO_ROOT / "scripts" / "output" / "ticker_purge_TODO.txt"

# ---------------------------------------------------------------------------
# Ticker-referencing tables across both DBs (used for re-parenting refs)
# Format: (db_path, table_name, ticker_column)
# ---------------------------------------------------------------------------
STOCKS_DB_TICKER_TABLES = [
    ("portfolio_assets", "stock_ticker"),
    ("market_regime_log", "ticker"),
    ("cached_analysis", "ticker"),
    ("ExpertRecommendation", "stock_symbol"),
    ("stock_daily_prices", "ticker"),
    ("screener_presets", "ticker"),
    ("real_evaluated_predictions", "ticker"),
    ("stock_adaptive_profiles", "ticker"),
    ("user_notifications", "ticker"),
    ("radar_signal_tracking", "ticker"),
    ("predictions", "ticker"),
    ("news", "ticker"),
    ("news_items", "ticker"),
    ("prediction_logs", "ticker"),
    ("signal_logs", "ticker"),
    ("feature_usage", "ticker"),
    ("pending_settlements", "ticker"),
    ("paper_trades", "ticker"),
    ("trading_lessons", "ticker"),
    ("ticker_performance", "ticker"),
    ("price_alerts", "ticker"),
    ("alert_settings", "ticker"),
    ("alert_history", "ticker"),
]

PREDICTIONS_DB_TICKER_TABLES = [
    ("aiPrediction", "stock_symbol"),
    ("predictions", "ticker"),
    ("stored_analyses", "ticker"),
    ("persona_predictions", "ticker"),
    ("stock_stories", "ticker"),
    ("live_ai_signals", "ticker"),
    ("historical_trades", "ticker"),
    ("quant_cache", "ticker"),
    ("exit_notifications", "ticker"),
    ("morning_bell_signals", "ticker"),
    ("ExpertRecommendation", "stock_symbol"),
    ("corporate_actions", "ticker"),
    ("hunter_pick_tracking", "ticker"),
    ("liquidity_backtest_results", "ticker"),
    ("liquidity_signal_outcomes", "ticker"),
    ("trade_journal_entries", "ticker"),
]

# ---------------------------------------------------------------------------
# Phase 2 — Explicit duplicate directives (DELETE these, KEEP the canonical)
# ---------------------------------------------------------------------------
EXPLICIT_DUPLICATES = {
    # ticker_to_delete -> canonical_ticker_to_keep
    "ADP": "ADPC",     # per task directive
    "COSG": "CALT",    # per task directive (explicit, regardless of usage)
}

# The 6 name_ar-duplicate groups (from DB inspection).
# For each group we list both tickers; the script picks the less-used
# (by total references) as the one to delete, EXCEPT where ticker_registry
# reveals the two tickers are actually distinct companies (different name_ar)
# in which case the script FIXES stocks.name_ar from ticker_registry instead
# of deleting either.
NAME_AR_DUP_GROUPS = [
    ("MNHD", "MASR"),     # ticker_registry: "مدينة نصر..." vs "مدينة مصر" -> FIX
    ("ARAB", "ARAB_R2"),  # ticker_registry: same name_ar; ARAB_R2 is rights issue
    ("CALT", "COSG"),     # explicit directive (COSG deleted)
    ("KAHA", "POUL"),
    ("PACL", "EGCH"),
    ("AIUD", "ALXD"),
]

# ---------------------------------------------------------------------------
# Phase 3 — ISIN-like EGS ticker merges
# Each entry: (egs_ticker, canonical_ticker, notes)
# ---------------------------------------------------------------------------
EGS_MERGES = [
    # Confirmed by task directive
    ("EGS220N1C016",     "NBCC",    "ALNASR Building Construction (per task)"),
    ("EGS3E071C013",     "ACRO",    "Acrow Misr (variant of -EGP)"),
    ("EGS3E071C013-EGP", "ACRO",    "Acrow Misr (per task)"),
    ("EGS65861C014",     "EABD",    "Egyptian Contracting (per task)"),
    # Discovered by English-name match against existing canonical tickers
    ("EGS385S1C012",     "FERC",    "Ferchem Misr (name match)"),
    ("EGS3I0S1C019",     "FCMD",    "Future Care Medical (name match)"),
    ("EGS73M81C012",     "NAMI",    "National Asset Mgmt (name match)"),
    ("EGS924K1C018",     "LUTS_R1", "Subscription Rights of Lotus (name match)"),
    # Translation matches (English EGS name -> Arabic canonical name)
    ("EGS370O1C013",     "NAPR",    "National Printing -> الوطنية للطباعة"),
    ("EGS48271C018",     "ESAC",    "Egypt-South Africa Comm -> مصر جنوب افريقيا"),
    ("EGS48271C018-EGP", "ESAC",    "Egypt-South Africa Comm (variant)"),
    # Special: ticker 'EGS' (id=900) is Ferchem with swapped fields -> FERC
    ("EGS",              "FERC",    "Wrong-ticker Ferchem (id=900, fields swapped)"),
]

# EGS tickers with NO canonical replacement -> deactivate (do not delete)
EGS_DEACTIVATE_ONLY = [
    "EGS30AJ1C016",
    "EGS30AJ1C016-EGP",
    "EGS59231C018",    # MNT Tech Holding — no clear replacement (HALN is different)
    "EGS65101C015",    # National Investment & Reconstruction — no match
    "EGS65621C012",    # El Nasr Housing — NASR id=470 is corrupted + different co.
    "EGS659O1C015",    # Misr Kuwait Investment & Trading — no match
    "EGS72L31C011",    # SOLARSOL For Energy — SOLA id=907 corrupted; risky match
]

# Valid EGX tickers that LOOK like ISIN but are NOT — keep them.
EGS_KEEP = {"EGSA"}  # Egyptian Satellite Co. (Nilesat) — valid ticker

# ---------------------------------------------------------------------------
# Phase 5 — Stocks to deactivate (delisted / unconfirmed)
# Format: (ticker, reason)
# ---------------------------------------------------------------------------
DEACTIVATE_LIST = [
    ("EDBM", "Delisted/unconfirmed status (per task directive)"),
]

# Arabic-character detector
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")

# ---------------------------------------------------------------------------
# Backup helpers
# ---------------------------------------------------------------------------
def backup_db(db_path: Path) -> Path:
    """Create timestamped backup of a SQLite DB file."""
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    bak = db_path.with_name(f"{db_path.name}.bak.pre-ticker-purge-{ts}")
    shutil.copy2(db_path, bak)
    return bak


def create_snapshot_table(conn: sqlite3.Connection, snapshot_name: str):
    """Create a snapshot table of the current stocks table for recovery."""
    conn.execute(f"DROP TABLE IF EXISTS {snapshot_name}")
    conn.execute(f"CREATE TABLE {snapshot_name} AS SELECT * FROM stocks")
    conn.commit()


# ---------------------------------------------------------------------------
# Reference-counting helpers (across both DBs)
# ---------------------------------------------------------------------------
def count_ticker_refs(db_path: Path, table: str, col: str, ticker: str) -> int:
    """Count rows in (db.table.col) where col == ticker."""
    try:
        with sqlite3.connect(str(db_path)) as conn:
            cur = conn.cursor()
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {col}=?", (ticker,))
            return int(cur.fetchone()[0])
    except sqlite3.Error:
        return 0


def total_refs(ticker: str) -> tuple[int, int]:
    """Return (stocks_db_refs, predictions_db_refs) for a ticker."""
    s = sum(
        count_ticker_refs(STOCKS_DB, t, c, ticker)
        for t, c in STOCKS_DB_TICKER_TABLES
    )
    p = sum(
        count_ticker_refs(PREDICTIONS_DB, t, c, ticker)
        for t, c in PREDICTIONS_DB_TICKER_TABLES
    )
    return s, p


def reparent_ticker_refs(old_ticker: str, new_ticker: str, dry_run: bool = True) -> int:
    """Re-parent all ticker references from old_ticker to new_ticker in both DBs.
    Returns the total number of rows updated."""
    total = 0
    for db_path, tables in [
        (STOCKS_DB, STOCKS_DB_TICKER_TABLES),
        (PREDICTIONS_DB, PREDICTIONS_DB_TICKER_TABLES),
    ]:
        with sqlite3.connect(str(db_path)) as conn:
            cur = conn.cursor()
            for table, col in tables:
                # Check the column exists in this table (some may be missing in some DBs)
                try:
                    cur.execute(f"PRAGMA table_info({table})")
                    cols = [r[1] for r in cur.fetchall()]
                    if col not in cols:
                        continue
                except sqlite3.Error:
                    continue
                try:
                    cur.execute(
                        f"SELECT COUNT(*) FROM {table} WHERE {col}=?", (old_ticker,)
                    )
                    n = int(cur.fetchone()[0])
                except sqlite3.Error:
                    n = 0
                if n == 0:
                    continue
                if not dry_run:
                    try:
                        # If the table has a UNIQUE / PK constraint on the ticker col
                        # or has child FKs, a plain UPDATE could fail. We use a
                        # safe UPDATE that doesn't try to deduplicate.
                        cur.execute(
                            f"UPDATE {table} SET {col}=? WHERE {col}=?",
                            (new_ticker, old_ticker),
                        )
                    except sqlite3.Error as e:
                        # Log and continue — don't abort the whole purge
                        print(f"    [WARN] could not update {db_path.name}.{table}.{col}: {e}")
                        continue
                total += n
            if not dry_run:
                conn.commit()
    return total


# ---------------------------------------------------------------------------
# Phase 1 — Analysis + report
# ---------------------------------------------------------------------------
def phase1_report() -> dict:
    """Print comprehensive report; return a dict of findings (no DB writes)."""
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM stocks")
        total_stocks = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX'")
        egx_stocks = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX' AND is_active=1")
        egx_active = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM ticker_registry")
        total_tr = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM ticker_registry WHERE market='EGX'")
        egx_tr = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM ticker_registry WHERE market='EGX' "
            "AND tradingview_symbol IS NOT NULL AND tradingview_symbol != ''"
        )
        egx_tr_with_tv = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM stocks WHERE market='EGX' "
            "AND name_ar IS NOT NULL AND name_ar = name"
        )
        name_ar_eq_name = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX' AND ticker LIKE 'EGS%'")
        isin_tickers = cur.fetchone()[0]

        # Duplicate name_ar groups (>=2 active EGX rows share name_ar)
        cur.execute(
            "SELECT name_ar, COUNT(*) c FROM stocks "
            "WHERE market='EGX' AND name_ar IS NOT NULL AND name_ar != '' "
            "GROUP BY name_ar HAVING c >= 2 ORDER BY c DESC"
        )
        dup_groups = cur.fetchall()

        # Per-ticker reference counts for the explicit duplicates + groups + EGS
        explicit_counts = {}
        for old, new in EXPLICIT_DUPLICATES.items():
            explicit_counts[old] = (*total_refs(old), new)
            explicit_counts[new] = (*total_refs(new), None)

        group_counts = {}
        for a, b in NAME_AR_DUP_GROUPS:
            group_counts[a] = total_refs(a)
            group_counts[b] = total_refs(b)

        egs_counts = {}
        for egs, canon, _ in EGS_MERGES:
            egs_counts[egs] = (*total_refs(egs), canon)
        for egs in EGS_DEACTIVATE_ONLY:
            egs_counts[egs] = (*total_refs(egs), "(deactivate)")

    report = {
        "total_stocks": total_stocks,
        "egx_stocks": egx_stocks,
        "egx_active": egx_active,
        "total_ticker_registry": total_tr,
        "egx_ticker_registry": egx_tr,
        "egx_tr_with_tv": egx_tr_with_tv,
        "name_ar_eq_name": name_ar_eq_name,
        "isin_like_tickers": isin_tickers,
        "dup_groups": dup_groups,
        "explicit_counts": explicit_counts,
        "group_counts": group_counts,
        "egs_counts": egs_counts,
    }

    print("=" * 78)
    print("PHASE 1 — Analysis Report (dry-run; no DB writes)")
    print("=" * 78)
    print(f"  stocks table total:                  {total_stocks}")
    print(f"  EGX stocks:                           {egx_stocks}")
    print(f"  EGX active stocks:                    {egx_active}")
    print(f"  ticker_registry total:                {total_tr}")
    print(f"  EGX ticker_registry entries:          {egx_tr}")
    print(f"  EGX ticker_registry w/ TV symbol:     {egx_tr_with_tv}")
    print(f"  name_ar == name (data quality issue): {name_ar_eq_name}")
    print(f"  ISIN-like tickers (EGS...):           {isin_tickers}")
    print()

    print("  --- Duplicate name_ar groups (>=2 EGX rows share name_ar) ---")
    for name_ar, c in dup_groups:
        print(f"    [{c}x] {name_ar}")
    print()

    print("  --- Explicit duplicates (per task directive) ---")
    print(f"    {'ticker':<8} {'stocks.db':>10} {'pred.db':>10} {'canonical':<10}")
    for tk, (s, p, canon) in explicit_counts.items():
        label = canon if canon else "(KEEP)"
        print(f"    {tk:<8} {s:>10} {p:>10} {label:<10}")
    print()

    print("  --- 6 name_ar duplicate groups (less-used will be deleted/repurposed) ---")
    print(f"    {'group':<8} {'stocks.db':>10} {'pred.db':>10} {'TOTAL':>8}  decision")
    for a, b in NAME_AR_DUP_GROUPS:
        sa, pa = group_counts[a]
        sb, pb = group_counts[b]
        ta, tb = sa + pa, sb + pb
        # If explicit directive overrides this group, follow it
        if a in EXPLICIT_DUPLICATES or b in EXPLICIT_DUPLICATES:
            decision = "(explicit directive in EXPLICIT_DUPLICATES)"
        elif ta == tb:
            decision = f"tie -> keep {a} (lower id wins)"
        elif ta < tb:
            decision = f"delete {a} (less-used), keep {b}"
        else:
            decision = f"delete {b} (less-used), keep {a}"
        print(f"    {a:<8} {sa:>10} {pa:>10} {ta:>8}  {decision}")
        print(f"    {b:<8} {sb:>10} {pb:>10} {tb:>8}")
    print()

    print("  --- ISIN-like EGS tickers (Phase 3) ---")
    print(f"    {'EGS ticker':<22} {'stocks.db':>10} {'pred.db':>10} {'canonical':<12}")
    for egs, refs in egs_counts.items():
        s, p, canon = refs
        print(f"    {egs:<22} {s:>10} {p:>10} {str(canon):<12}")
    print()

    print("  --- Phase 5 — deactivate list ---")
    for tk, reason in DEACTIVATE_LIST:
        s, p = total_refs(tk)
        print(f"    {tk:<8} refs(s={s},p={p})  reason: {reason}")
    print()

    print("=" * 78)
    return report


# ---------------------------------------------------------------------------
# Phase 2 — Delete duplicates (after re-parenting references)
# ---------------------------------------------------------------------------
def phase2_delete_duplicates(dry_run: bool, todo_lines: list[str]) -> dict:
    """Delete ADP, COSG, and the less-used member of each name_ar dup group."""
    summary = {"deleted": [], "reparented": [], "name_ar_fixed": [], "deactivated": []}
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()

        # Step 2a — Explicit duplicates: ADP -> ADPC, COSG -> CALT
        for old, new in EXPLICIT_DUPLICATES.items():
            cur.execute("SELECT id, ticker FROM stocks WHERE ticker=?", (old,))
            row = cur.fetchone()
            if not row:
                print(f"  [Phase2][skip] {old} already gone")
                continue
            s_old, p_old = total_refs(old)
            s_new, p_new = total_refs(new)
            n_refs = reparent_ticker_refs(old, new, dry_run=dry_run)
            if not dry_run:
                # Mark ticker_registry entry as inactive (don't delete — keep audit trail)
                cur.execute(
                    "UPDATE ticker_registry SET is_active=0, "
                    "updated_at=datetime('now'), notes=COALESCE(notes,'') || "
                    "' [P0-TICKER-PURGE: merged into " + new + "]' "
                    "WHERE canonical_ticker=?",
                    (old,),
                )
                # Delete from stocks table
                cur.execute("DELETE FROM stocks WHERE ticker=?", (old,))
                conn.commit()
            print(f"  [Phase2][delete] {old} -> {new}: re-parented {n_refs} refs; "
                  f"deleted stocks row (id={row[0]})")
            summary["deleted"].append((old, new, n_refs, row[0]))

        # Step 2b — The 6 name_ar duplicate groups
        for a, b in NAME_AR_DUP_GROUPS:
            # Skip groups already handled by explicit directives
            if a in EXPLICIT_DUPLICATES or b in EXPLICIT_DUPLICATES:
                print(f"  [Phase2][skip-group] {a}/{b} handled by explicit directive")
                continue

            # Compare ticker_registry name_ar for both tickers
            cur.execute(
                "SELECT canonical_ticker, name_ar FROM ticker_registry "
                "WHERE canonical_ticker IN (?, ?)", (a, b)
            )
            tr_rows = {r[0]: r[1] for r in cur.fetchall()}

            na_a = tr_rows.get(a)
            na_b = tr_rows.get(b)
            # If both have Arabic names AND they differ -> fix stocks.name_ar from TR
            if (
                na_a and na_b
                and ARABIC_RE.search(na_a) and ARABIC_RE.search(na_b)
                and na_a != na_b
            ):
                # stocks.name_ar is corrupted for at least one — fix from ticker_registry
                for tk, na_correct in [(a, na_a), (b, na_b)]:
                    cur.execute(
                        "SELECT id, name_ar FROM stocks WHERE ticker=?", (tk,)
                    )
                    r = cur.fetchone()
                    if not r:
                        continue
                    sid, na_cur = r
                    if na_cur != na_correct:
                        if not dry_run:
                            cur.execute(
                                "UPDATE stocks SET name_ar=?, updated_at=datetime('now') "
                                "WHERE id=?",
                                (na_correct, sid),
                            )
                            conn.commit()
                        print(f"  [Phase2][fix-name_ar] {tk} (id={sid}): "
                              f"'{na_cur}' -> '{na_correct}' (from ticker_registry)")
                        summary["name_ar_fixed"].append((tk, sid, na_cur, na_correct))
                continue  # do NOT delete either — they're distinct companies

            # Otherwise, delete the less-used per predictions/total refs
            sa, pa = total_refs(a)
            sb, pb = total_refs(b)
            ta, tb = sa + pa, sb + pb
            if ta <= tb:
                old, new = a, b
            else:
                old, new = b, a

            cur.execute("SELECT id FROM stocks WHERE ticker=?", (old,))
            row = cur.fetchone()
            if not row:
                print(f"  [Phase2][skip] {old} already gone")
                continue
            n_refs = reparent_ticker_refs(old, new, dry_run=dry_run)
            if not dry_run:
                cur.execute(
                    "UPDATE ticker_registry SET is_active=0, "
                    "updated_at=datetime('now'), notes=COALESCE(notes,'') || "
                    "' [P0-TICKER-PURGE: merged into " + new + " (name_ar dup)]' "
                    "WHERE canonical_ticker=?",
                    (old,),
                )
                cur.execute("DELETE FROM stocks WHERE ticker=?", (old,))
                conn.commit()
            print(f"  [Phase2][delete] {old} -> {new}: re-parented {n_refs} refs; "
                  f"deleted stocks row (id={row[0]})")
            summary["deleted"].append((old, new, n_refs, row[0]))

            # Special handling: ARAB_R2 is a rights issue — if we deleted it as a
            # "duplicate" of ARAB, log a TODO for manual review (rights issues are
            # distinct instruments).
            if old == "ARAB_R2":
                todo_lines.append(
                    f"ARAB_R2 (rights issue of ARAB) was deleted as part of "
                    f"name_ar duplicate group. If this was wrong, restore from "
                    f"the snapshot table stocks_purge_snapshot_<ts>."
                )

            # PACL is a real EGX company (PACHIN); flag if deleted
            if old == "PACL":
                todo_lines.append(
                    f"PACL (Paints & Chemicals Industries / PACHIN) was deleted "
                    f"as the less-used member of the PACL/EGCH name_ar dup group. "
                    f"EGCH kept. Manual review recommended — these may be distinct "
                    f"companies with the same Arabic name in ticker_registry."
                )

    return summary


# ---------------------------------------------------------------------------
# Phase 3 — Merge ISIN-like EGS tickers into canonical tickers
# ---------------------------------------------------------------------------
def phase3_merge_egs(dry_run: bool, todo_lines: list[str]) -> dict:
    summary = {"merged": [], "deactivated": []}
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()

        for egs, canon, note in EGS_MERGES:
            cur.execute("SELECT id FROM stocks WHERE ticker=?", (egs,))
            row = cur.fetchone()
            if not row:
                print(f"  [Phase3][skip] {egs} already gone")
                continue
            cur.execute("SELECT id FROM stocks WHERE ticker=?", (canon,))
            if not cur.fetchone():
                print(f"  [Phase3][WARN] {egs} -> {canon}: canonical missing! "
                      f"deactivating instead")
                if not dry_run:
                    cur.execute(
                        "UPDATE stocks SET is_active=0 WHERE ticker=?", (egs,)
                    )
                    cur.execute(
                        "UPDATE ticker_registry SET is_active=0 WHERE canonical_ticker=?",
                        (egs,),
                    )
                    conn.commit()
                todo_lines.append(
                    f"EGS ticker {egs} had canonical {canon} which is missing from "
                    f"stocks. Deactivated {egs}; TODO: add {canon} canonical or "
                    f"supply a different mapping."
                )
                summary["deactivated"].append(egs)
                continue

            n_refs = reparent_ticker_refs(egs, canon, dry_run=dry_run)
            if not dry_run:
                # Deactivate ticker_registry entry (keep audit trail, don't delete)
                cur.execute(
                    "UPDATE ticker_registry SET is_active=0, "
                    "updated_at=datetime('now'), notes=COALESCE(notes,'') || "
                    "' [P0-TICKER-PURGE: merged into " + canon + "]' "
                    "WHERE canonical_ticker=?",
                    (egs,),
                )
                # Delete the EGS stocks row
                cur.execute("DELETE FROM stocks WHERE ticker=?", (egs,))
                conn.commit()
            print(f"  [Phase3][merge] {egs} -> {canon}: re-parented {n_refs} refs; "
                  f"deleted stocks row (id={row[0]}). note: {note}")
            summary["merged"].append((egs, canon, n_refs, row[0]))

        # Deactivate-only EGS tickers (no canonical replacement)
        for egs in EGS_DEACTIVATE_ONLY:
            cur.execute("SELECT id, is_active FROM stocks WHERE ticker=?", (egs,))
            row = cur.fetchone()
            if not row:
                print(f"  [Phase3][skip] {egs} already gone")
                continue
            if row[1] == 0:
                print(f"  [Phase3][skip] {egs} already is_active=0")
                continue
            if not dry_run:
                cur.execute(
                    "UPDATE stocks SET is_active=0 WHERE ticker=?", (egs,)
                )
                cur.execute(
                    "UPDATE ticker_registry SET is_active=0, "
                    "notes=COALESCE(notes,'') || "
                    "' [P0-TICKER-PURGE: no canonical replacement, deactivated]' "
                    "WHERE canonical_ticker=?",
                    (egs,),
                )
                conn.commit()
            print(f"  [Phase3][deactivate] {egs} (id={row[0]}): is_active=1 -> 0 "
                  f"(no canonical replacement)")
            summary["deactivated"].append(egs)
            todo_lines.append(
                f"EGS ticker {egs} (no canonical replacement found) was deactivated. "
                f"Manual review needed — confirm whether a real EGX ticker exists "
                f"for this company."
            )

    return summary


# ---------------------------------------------------------------------------
# Phase 4 — Fix name_ar for stocks where name_ar == name (English placeholder)
# ---------------------------------------------------------------------------
def phase4_fix_name_ar(dry_run: bool, todo_lines: list[str]) -> dict:
    summary = {"fixed_from_registry": [], "deactivated_no_arabic": []}
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, ticker, name, name_ar FROM stocks "
            "WHERE market='EGX' AND name_ar IS NOT NULL AND name_ar = name"
        )
        rows = cur.fetchall()
        for sid, ticker, name, name_ar in rows:
            # Look up Arabic name_ar from ticker_registry
            cur.execute(
                "SELECT name_ar FROM ticker_registry WHERE canonical_ticker=?",
                (ticker,),
            )
            r = cur.fetchone()
            tr_name_ar = r[0] if r else None

            if tr_name_ar and ARABIC_RE.search(tr_name_ar) and tr_name_ar != name_ar:
                # Fix from ticker_registry
                if not dry_run:
                    cur.execute(
                        "UPDATE stocks SET name_ar=?, updated_at=datetime('now') "
                        "WHERE id=?",
                        (tr_name_ar, sid),
                    )
                    conn.commit()
                print(f"  [Phase4][fix] {ticker} (id={sid}): name_ar "
                      f"'{name_ar}' -> '{tr_name_ar}' (from ticker_registry)")
                summary["fixed_from_registry"].append((ticker, sid, name_ar, tr_name_ar))
            elif not ARABIC_RE.search(name or ""):
                # name is ASCII (English) and no Arabic alternative available
                # Deactivate per Rule 27 (NO-FAKE-DATA)
                cur.execute("SELECT is_active FROM stocks WHERE id=?", (sid,))
                cur_active = cur.fetchone()[0]
                if cur_active == 0:
                    continue
                if not dry_run:
                    cur.execute(
                        "UPDATE stocks SET is_active=0, updated_at=datetime('now') "
                        "WHERE id=?",
                        (sid,),
                    )
                    conn.commit()
                print(f"  [Phase4][deactivate] {ticker} (id={sid}): "
                      f"no Arabic name available; is_active=1 -> 0")
                summary["deactivated_no_arabic"].append((ticker, sid, name))
                todo_lines.append(
                    f"Stock {ticker} (id={sid}, name='{name}'): name_ar is English "
                    f"placeholder and no Arabic name found in ticker_registry. "
                    f"Deactivated per Rule 27 (NO-FAKE-DATA). "
                    f"To re-activate: supply correct Arabic name in ticker_registry."
                )
            else:
                # name has Arabic chars already (just duplicated in name_ar)
                # This is fine — leave alone
                pass
    return summary


# ---------------------------------------------------------------------------
# Phase 5 — Deactivate EDBM and any delisted stocks
# ---------------------------------------------------------------------------
def phase5_deactivate_delisted(dry_run: bool) -> dict:
    summary = {"deactivated": []}
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()
        for ticker, reason in DEACTIVATE_LIST:
            cur.execute("SELECT id, is_active FROM stocks WHERE ticker=?", (ticker,))
            row = cur.fetchone()
            if not row:
                print(f"  [Phase5][skip] {ticker} not in stocks")
                continue
            sid, cur_active = row
            if cur_active == 0:
                print(f"  [Phase5][skip] {ticker} already is_active=0")
                continue
            if not dry_run:
                cur.execute(
                    "UPDATE stocks SET is_active=0, updated_at=datetime('now') "
                    "WHERE id=?",
                    (sid,),
                )
                cur.execute(
                    "UPDATE ticker_registry SET is_active=0, "
                    "notes=COALESCE(notes,'') || "
                    "' [P0-TICKER-PURGE: " + reason + "]' "
                    "WHERE canonical_ticker=?",
                    (ticker,),
                )
                conn.commit()
            print(f"  [Phase5][deactivate] {ticker} (id={sid}): {reason}")
            summary["deactivated"].append((ticker, sid, reason))
    return summary


# ---------------------------------------------------------------------------
# Phase 6 — Fill tradingview_symbol for all active EGX stocks
# ---------------------------------------------------------------------------
def phase6_fill_tv_symbol(dry_run: bool) -> dict:
    summary = {"filled": 0, "skipped_already_set": 0, "total_active_egx": 0}
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()
        # All active EGX rows in ticker_registry
        cur.execute(
            "SELECT canonical_ticker, egx_ticker, tradingview_symbol, is_active "
            "FROM ticker_registry WHERE market='EGX' AND is_active=1"
        )
        rows = cur.fetchall()
        summary["total_active_egx"] = len(rows)
        for canonical, egx_ticker, tv_current, _ in rows:
            desired_tv = None
            if canonical and re.match(r"^[A-Z0-9_]+$", canonical):
                desired_tv = f"EGX:{canonical}"
            elif egx_ticker and re.match(r"^[A-Z0-9_]+$", egx_ticker):
                desired_tv = f"EGX:{egx_ticker}"

            if not desired_tv:
                continue

            if tv_current == desired_tv:
                summary["skipped_already_set"] += 1
                continue

            if not dry_run:
                cur.execute(
                    "UPDATE ticker_registry SET tradingview_symbol=?, "
                    "updated_at=datetime('now') "
                    "WHERE canonical_ticker=?",
                    (desired_tv, canonical),
                )
                conn.commit()
            summary["filled"] += 1
        print(f"  [Phase6] Active EGX rows in ticker_registry: "
              f"{summary['total_active_egx']}; TV symbol filled: "
              f"{summary['filled']}; already set: {summary['skipped_already_set']}")
    return summary


# ---------------------------------------------------------------------------
# Final state report
# ---------------------------------------------------------------------------
def final_state_report() -> dict:
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX'")
        egx_total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX' AND is_active=1")
        egx_active = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM ticker_registry WHERE market='EGX' AND is_active=1"
        )
        tr_active = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM ticker_registry WHERE market='EGX' AND is_active=1 "
            "AND tradingview_symbol IS NOT NULL AND tradingview_symbol != ''"
        )
        tr_active_with_tv = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM stocks WHERE market='EGX' "
            "AND name_ar IS NOT NULL AND name_ar = name"
        )
        name_ar_still_eq_name = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM stocks WHERE market='EGX' AND ticker LIKE 'EGS%' "
            "AND is_active=1"
        )
        active_egs_remaining = cur.fetchone()[0]
        # Remaining duplicate name_ar groups (active only)
        cur.execute(
            "SELECT name_ar, COUNT(*) c FROM stocks "
            "WHERE market='EGX' AND is_active=1 AND name_ar IS NOT NULL AND name_ar != '' "
            "GROUP BY name_ar HAVING c >= 2"
        )
        remaining_dup_groups = cur.fetchall()
    return {
        "egx_total": egx_total,
        "egx_active": egx_active,
        "tr_active": tr_active,
        "tr_active_with_tv": tr_active_with_tv,
        "tr_active_tv_coverage_pct": (
            round(100.0 * tr_active_with_tv / tr_active, 2) if tr_active else 0.0
        ),
        "name_ar_still_eq_name": name_ar_still_eq_name,
        "active_egs_remaining": active_egs_remaining,
        "remaining_dup_groups": remaining_dup_groups,
    }


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Apply changes. Without this flag, only the Phase 1 report runs.",
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="Skip creating timestamped .db backup files (not recommended).",
    )
    args = parser.parse_args(argv)

    print(f"\n[mode] {'EXECUTE' if args.execute else 'DRY-RUN'}\n")

    # Always run Phase 1 report first
    phase1_report()

    # Preview each phase with dry_run=True so the user sees exactly what
    # the --execute run will do (without writing to DBs).
    todo_preview: list[str] = []
    print("\n" + "=" * 78)
    print("PHASE PREVIEW (dry-run; no DB writes)")
    print("=" * 78)
    print("\n--- Phase 2 preview: Delete duplicates ---")
    phase2_delete_duplicates(dry_run=True, todo_lines=todo_preview)
    print("\n--- Phase 3 preview: Merge ISIN-like EGS tickers ---")
    phase3_merge_egs(dry_run=True, todo_lines=todo_preview)
    print("\n--- Phase 4 preview: Fix name_ar ---")
    phase4_fix_name_ar(dry_run=True, todo_lines=todo_preview)
    print("\n--- Phase 5 preview: Deactivate delisted ---")
    phase5_deactivate_delisted(dry_run=True)
    print("\n--- Phase 6 preview: Fill tradingview_symbol ---")
    phase6_fill_tv_symbol(dry_run=True)

    if todo_preview:
        print("\n--- TODO items (manual review needed) ---")
        for line in todo_preview:
            print(f"  • {line}")

    if not args.execute:
        print("\n" + "=" * 78)
        print("DRY-RUN COMPLETE — no DB writes were made.")
        print("Run with --execute to apply changes.")
        print("=" * 78 + "\n")
        return 0

    # ------------------ EXECUTE mode ------------------
    print("\n" + "=" * 78)
    print("EXECUTE MODE — applying changes")
    print("=" * 78)

    # Step 0 — backups + snapshot
    if not args.skip_backup:
        print("\n[backup] Creating timestamped DB backups...")
        bak_stocks = backup_db(STOCKS_DB)
        bak_pred = backup_db(PREDICTIONS_DB)
        print(f"  stocks.db      -> {bak_stocks.name}")
        print(f"  predictions.db -> {bak_pred.name}")

    snapshot_name = f"stocks_purge_snapshot_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    with sqlite3.connect(str(STOCKS_DB)) as conn:
        create_snapshot_table(conn, snapshot_name)
    print(f"[backup] Snapshot table '{snapshot_name}' created (stocks.db)")

    # Write TODO file header
    TODO_FILE.parent.mkdir(parents=True, exist_ok=True)
    todo_lines: list[str] = [
        f"# P0-TICKER-PURGE TODO list — generated {datetime.now().isoformat()}",
        f"# Snapshot table: {snapshot_name} (in stocks.db)",
        f"# Backups: stocks.db.bak.*, predictions.db.bak.*",
        "",
    ]

    print("\n--- Phase 2: Delete duplicates ---")
    p2 = phase2_delete_duplicates(dry_run=False, todo_lines=todo_lines)

    print("\n--- Phase 3: Merge ISIN-like EGS tickers ---")
    p3 = phase3_merge_egs(dry_run=False, todo_lines=todo_lines)

    print("\n--- Phase 4: Fix name_ar ---")
    p4 = phase4_fix_name_ar(dry_run=False, todo_lines=todo_lines)

    print("\n--- Phase 5: Deactivate delisted ---")
    p5 = phase5_deactivate_delisted(dry_run=False)

    print("\n--- Phase 6: Fill tradingview_symbol ---")
    p6 = phase6_fill_tv_symbol(dry_run=False)

    # Write TODO file
    if todo_lines:
        with open(TODO_FILE, "w", encoding="utf-8") as fh:
            fh.write("\n".join(todo_lines) + "\n")
        print(f"\n[TODO] Manual-review items written to: {TODO_FILE}")

    # Final state report
    print("\n" + "=" * 78)
    print("FINAL STATE")
    print("=" * 78)
    final = final_state_report()
    print(f"  EGX stocks total:                   {final['egx_total']}")
    print(f"  EGX active stocks:                  {final['egx_active']}")
    print(f"  ticker_registry active EGX:         {final['tr_active']}")
    print(f"  ticker_registry w/ TV symbol:       {final['tr_active_with_tv']} "
          f"({final['tr_active_tv_coverage_pct']}%)")
    print(f"  name_ar == name remaining:          {final['name_ar_still_eq_name']}")
    print(f"  Active EGS-like tickers remaining:   {final['active_egs_remaining']}")
    print(f"  Active duplicate name_ar groups:    "
          f"{len(final['remaining_dup_groups'])}")
    for na, c in final["remaining_dup_groups"]:
        print(f"    [{c}x] {na}")

    print("\n--- Summary ---")
    print(f"  Phase 2 deleted stocks:                 {len(p2['deleted'])}")
    print(f"  Phase 2 name_ar fixed (not deleted):    {len(p2['name_ar_fixed'])}")
    print(f"  Phase 3 merged EGS -> canonical:        {len(p3['merged'])}")
    print(f"  Phase 3 deactivated EGS (no canon):    {len(p3['deactivated'])}")
    print(f"  Phase 4 name_ar fixed from registry:    {len(p4['fixed_from_registry'])}")
    print(f"  Phase 4 deactivated (no Arabic name):   {len(p4['deactivated_no_arabic'])}")
    print(f"  Phase 5 deactivated (delisted):         {len(p5['deactivated'])}")
    print(f"  Phase 6 TV symbols filled:              {p6['filled']}")
    print(f"  Phase 6 TV symbols already set:         {p6['skipped_already_set']}")

    print("\n" + "=" * 78)
    print("EXECUTE COMPLETE.")
    print(f"  Snapshot table: {snapshot_name}")
    print(f"  TODO file:      {TODO_FILE}")
    print("=" * 78 + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
