#!/usr/bin/env python3
"""
PHASE 1.1 — Look-Ahead Bias Detection Audit
============================================
Goal: Detect any information that was used BEFORE it was chronologically
available in trading decisions.

Scope (per task spec):
  1. Fundamentals timestamp check      (data_engine.db, tab_* tables)
  2. News timestamp check              (news.db, news_articles)
  3. Price history point-in-time check (price_history.db, price_history)
  4. Cross-table timestamp alignment   (predictions vs price_history)
  5. Stock data freshness check        (stocks.db, stocks.last_update)

Rules:
  - READ-ONLY on DBs (mode=ro via URI).
  - Status per check: PASS | FAIL | BLOCKED
  - Overall status: FAIL if any check FAILs, BLOCKED if any BLOCKED and rest PASS,
                    PASS only if all checks PASS.
  - Examples limited to 5 per check.

Output: scripts/audit_phase1_lookahead.json
"""

from __future__ import annotations

import sqlite3
import json
import os
import sys
import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(ROOT, "db")
DATA_ZIP = os.path.join(ROOT, "data", "active_databases_20260817_full.zip")
OUT_JSON = os.path.join(ROOT, "scripts", "audit_phase1_lookahead.json")

EXPECTED_MD5 = "0947bdf6c2eff1a75ff8af6c3e576ed8"
MAX_EXAMPLES = 5
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def connect_ro(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def md5_of_file(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def table_cols(conn: sqlite3.Connection, table: str) -> List[str]:
    cur = conn.execute(f"PRAGMA table_info('{table}');")
    return [r[1] for r in cur.fetchall()]


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;", (table,)
    )
    return cur.fetchone() is not None


def to_date_str(v: Any) -> Optional[str]:
    """Normalize many timestamp formats to YYYY-MM-DD; return None if unparseable."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    # ISO datetime "2026-08-17T14:38:31.633628" or "2026-08-17 14:38:31"
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T\s]", s)
    if m:
        return m.group(1)
    # Pure date
    if ISO_DATE_RE.match(s):
        return s
    # Compact ISO "20260717T215956"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def safe_cmp(a: Optional[str], b: Optional[str]) -> Optional[int]:
    """Compare two YYYY-MM-DD strings; return -1/0/1, or None if either invalid."""
    da, db = to_date_str(a), to_date_str(b)
    if da is None or db is None:
        return None
    if da < db:
        return -1
    if da > db:
        return 1
    return 0


def truncate_examples(items: List[Any]) -> List[Any]:
    return items[:MAX_EXAMPLES]


# ---------------------------------------------------------------------------
# Load predictions (the as-of reference)
# ---------------------------------------------------------------------------
def load_predictions() -> List[Dict[str, Any]]:
    """Load predictions from predictions.db.predictions (153 rows)."""
    conn = connect_ro(os.path.join(DB_DIR, "predictions.db"))
    try:
        cols = table_cols(conn, "predictions")
        select = ", ".join(
            [
                "id",
                "ticker",
                "prediction_date",
                "outcome_date",
                "entry_price",
                "exit_price",
                "market",
                "status",
                "created_at",
            ]
        )
        cur = conn.execute(f"SELECT {select} FROM predictions ORDER BY prediction_date, id;")
        preds = []
        for r in cur.fetchall():
            preds.append(
                {
                    "id": r[0],
                    "ticker": r[1],
                    "prediction_date": r[2],
                    "outcome_date": r[3],
                    "entry_price": r[4],
                    "exit_price": r[5],
                    "market": r[6],
                    "status": r[7],
                    "created_at": r[8],
                }
            )
        return preds
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CHECK 1 — Fundamentals timestamp check (data_engine.db)
# ---------------------------------------------------------------------------
def check_1_fundamentals(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    For each tab_* table that has fiscal_end (or last_updated in egx_fundamentals):
      - If a fundamental row's fiscal_end > prediction.prediction_date for the
        same ticker -> look-ahead bias.
      - tab_dividends, tab_valuation, tab_profitability, tab_performance,
        tab_technical_analysis have NO fiscal timestamp columns -> BLOCKED.
    """
    result: Dict[str, Any] = {
        "check": "1_fundamentals_timestamp",
        "db": "db/data_engine.db",
        "tables_checked": [],
        "lookahead_count": 0,
        "predictions_with_lookahead": 0,
        "examples": [],
        "status": "BLOCKED",
        "evidence": "",
    }

    db_path = os.path.join(DB_DIR, "data_engine.db")
    if not os.path.exists(db_path):
        result["evidence"] = "data_engine.db missing"
        return result

    conn = connect_ro(db_path)
    try:
        # Mapping: table -> timestamp column(s) used for point-in-time check
        ts_map = {
            "tab_income_statement": "fiscal_end",
            "tab_balance_sheet": "fiscal_end",
            "tab_cash_flow": "fiscal_end",
            # No timestamp columns:
            "tab_dividends": None,
            "tab_valuation": None,
            "tab_profitability": None,
            "tab_performance": None,
            "tab_technical_analysis": None,
        }

        per_table_summary: List[Dict[str, Any]] = []
        all_examples: List[Dict[str, Any]] = []
        total_lookahead = 0
        affected_pred_ids: set = set()

        # Verify schema first (PRAGMA table_info per task instructions)
        for tbl, ts_col in ts_map.items():
            if not table_exists(conn, tbl):
                per_table_summary.append(
                    {"table": tbl, "exists": False, "ts_column": ts_col, "status": "BLOCKED"}
                )
                continue
            cols = table_cols(conn, tbl)
            rowcount = conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
            if ts_col is None:
                per_table_summary.append(
                    {
                        "table": tbl,
                        "exists": True,
                        "rowcount": rowcount,
                        "ts_column": None,
                        "columns": cols,
                        "status": "BLOCKED",
                        "note": "No fiscal_end / fiscal_period / last_updated column - cannot perform point-in-time check on this table.",
                    }
                )
                continue
            has_ts = ts_col in cols
            if not has_ts:
                per_table_summary.append(
                    {
                        "table": tbl,
                        "exists": True,
                        "rowcount": rowcount,
                        "ts_column": ts_col,
                        "columns": cols,
                        "status": "BLOCKED",
                        "note": f"Expected timestamp column '{ts_col}' not present in table.",
                    }
                )
                continue

            # For each prediction, find tab_* rows for same ticker with fiscal_end > prediction_date
            q = f"""
                SELECT p.id AS pred_id, p.ticker AS pred_ticker, p.prediction_date,
                       f.symbol, f.market, f.fiscal_end, f.fiscal_period
                FROM predictions_snapshot p
                JOIN {tbl} f
                  ON f.symbol = p.ticker
                 AND f.fiscal_end IS NOT NULL
                 AND f.fiscal_end != ''
                 AND length(f.fiscal_end) >= 10
                 AND substr(f.fiscal_end,1,4) GLOB '[0-9][0-9][0-9][0-9]'
                 AND f.fiscal_end > p.prediction_date
                ORDER BY p.prediction_date, p.id
                LIMIT 200;
            """
            # We don't have a predictions_snapshot table; emulate in Python.
            lookahead_rows: List[Dict[str, Any]] = []
            for p in predictions:
                cur = conn.execute(
                    f"""
                    SELECT symbol, market, fiscal_end, fiscal_period
                    FROM {tbl}
                    WHERE symbol = ?
                      AND fiscal_end IS NOT NULL
                      AND fiscal_end != ''
                      AND length(fiscal_end) >= 10
                      AND substr(fiscal_end,1,4) GLOB '[0-9][0-9][0-9][0-9]'
                      AND fiscal_end > ?
                    ORDER BY fiscal_end
                    LIMIT 5;
                    """,
                    (p["ticker"], p["prediction_date"]),
                )
                for r in cur.fetchall():
                    lookahead_rows.append(
                        {
                            "pred_id": p["id"],
                            "ticker": p["ticker"],
                            "prediction_date": p["prediction_date"],
                            "fund_symbol": r[0],
                            "fund_market": r[1],
                            "fiscal_end": r[2],
                            "fiscal_period": r[3],
                            "table": tbl,
                        }
                    )

            # also compute latest fiscal_end per ticker (for reporting)
            cur_latest = conn.execute(
                f"""
                SELECT symbol, MAX(fiscal_end) AS max_fe
                FROM {tbl}
                WHERE substr(fiscal_end,1,4) GLOB '[0-9][0-9][0-9][0-9]'
                GROUP BY symbol;
                """
            )
            latest_map = {r[0]: r[1] for r in cur_latest.fetchall()}

            per_table_summary.append(
                {
                    "table": tbl,
                    "exists": True,
                    "rowcount": rowcount,
                    "ts_column": ts_col,
                    "columns": cols,
                    "status": "PASS" if not lookahead_rows else "FAIL",
                    "lookahead_count": len(lookahead_rows),
                    "max_fiscal_end_observed": max(
                        (v for v in latest_map.values() if v), default=None
                    ),
                }
            )
            for lr in lookahead_rows:
                all_examples.append(lr)
                affected_pred_ids.add(lr["pred_id"])
            total_lookahead += len(lookahead_rows)

        # egx_fundamentals (has last_updated)
        egx_status = "BLOCKED"
        egx_count = 0
        egx_examples: List[Dict[str, Any]] = []
        if table_exists(conn, "egx_fundamentals"):
            egx_cols = table_cols(conn, "egx_fundamentals")
            egx_rowcount = conn.execute("SELECT COUNT(*) FROM egx_fundamentals").fetchone()[0]
            if "last_updated" in egx_cols and "ticker" in egx_cols:
                egx_status = "PASS"
                for p in predictions:
                    cur = conn.execute(
                        """
                        SELECT ticker, last_updated
                        FROM egx_fundamentals
                        WHERE ticker = ?
                          AND last_updated IS NOT NULL
                          AND last_updated != ''
                          AND last_updated > ?
                        LIMIT 5;
                        """,
                        (p["ticker"], p["prediction_date"]),
                    )
                    for r in cur.fetchall():
                        egx_examples.append(
                            {
                                "pred_id": p["id"],
                                "ticker": p["ticker"],
                                "prediction_date": p["prediction_date"],
                                "last_updated": r[1],
                            }
                        )
                        affected_pred_ids.add(p["id"])
                egx_count = len(egx_examples)
                egx_status = "FAIL" if egx_count else "PASS"
            per_table_summary.append(
                {
                    "table": "egx_fundamentals",
                    "exists": True,
                    "rowcount": egx_rowcount,
                    "ts_column": "last_updated",
                    "columns": egx_cols,
                    "status": egx_status,
                    "lookahead_count": egx_count,
                    "note": "egx_fundamentals has last_updated column; checked vs prediction_date.",
                }
            )
        else:
            per_table_summary.append(
                {"table": "egx_fundamentals", "exists": False, "status": "BLOCKED"}
            )

        # Deduplicate examples
        seen = set()
        unique_examples: List[Dict[str, Any]] = []
        for ex in all_examples + egx_examples:
            key = (ex.get("table"), ex.get("pred_id"), ex.get("ticker"), ex.get("fiscal_end") or ex.get("last_updated"))
            if key in seen:
                continue
            seen.add(key)
            unique_examples.append(ex)

        # Determine status: FAIL if any tab_* with fiscal_end produced lookahead rows
        any_fail = any(
            t.get("status") == "FAIL"
            for t in per_table_summary
            if t.get("ts_column")
        )
        any_blocked = any(t.get("status") == "BLOCKED" for t in per_table_summary)
        if any_fail:
            overall = "FAIL"
        elif any_blocked:
            overall = "BLOCKED"
        else:
            overall = "PASS"

        result.update(
            {
                "tables_checked": per_table_summary,
                "lookahead_count": total_lookahead + egx_count,
                "predictions_with_lookahead": len(affected_pred_ids),
                "examples": truncate_examples(unique_examples),
                "status": overall,
                "evidence": (
                    f"Found {total_lookahead + egx_count} fundamental rows whose "
                    f"fiscal_end > prediction_date across "
                    f"{sum(1 for t in per_table_summary if t.get('ts_column'))} timestamped tables; "
                    f"{len(affected_pred_ids)} predictions affected."
                ),
            }
        )
    finally:
        conn.close()
    return result


# ---------------------------------------------------------------------------
# CHECK 2 — News timestamp check (news.db)
# ---------------------------------------------------------------------------
def check_2_news(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "check": "2_news_timestamp",
        "db": "db/news.db",
        "table": "news_articles",
        "status": "BLOCKED",
        "lookahead_count": 0,
        "predictions_with_lookahead": 0,
        "examples": [],
        "evidence": "",
    }
    db_path = os.path.join(DB_DIR, "news.db")
    if not os.path.exists(db_path):
        result["evidence"] = "news.db missing"
        return result

    conn = connect_ro(db_path)
    try:
        if not table_exists(conn, "news_articles"):
            result["evidence"] = "news_articles table missing"
            return result
        cols = table_cols(conn, "news_articles")
        rowcount = conn.execute("SELECT COUNT(*) FROM news_articles").fetchone()[0]
        result["columns"] = cols
        result["rowcount"] = rowcount

        if "published_at" not in cols:
            result["evidence"] = "published_at column missing"
            return result

        # Range & null stats
        rng = conn.execute(
            "SELECT MIN(published_at), MAX(published_at), "
            "SUM(CASE WHEN symbol IS NULL OR symbol='' THEN 1 ELSE 0 END) "
            "FROM news_articles"
        ).fetchone()
        result["published_at_min"] = rng[0]
        result["published_at_max"] = rng[1]
        result["null_symbol_count"] = rng[2]

        # market_code distribution
        mc = conn.execute(
            "SELECT market_code, COUNT(*) FROM news_articles "
            "GROUP BY market_code ORDER BY COUNT(*) DESC"
        ).fetchall()
        result["market_code_distribution"] = [{"market_code": r[0], "count": r[1]} for r in mc]

        # Linkage check: are there any news articles whose published_at > prediction_date
        # AND (symbol matches OR market_code = 'EGX' or 'GENERAL' for EGX predictions)?
        # Since symbol is NULL for ALL articles, we use market_code as a proxy.
        lookahead_examples: List[Dict[str, Any]] = []
        affected = set()
        # Pick representative predictions (max 5 examples); but count affected.
        # We use market_code IN ('EGX','GENERAL') as the proxy for EGX market predictions.
        all_market_codes = {r[0] for r in mc}
        relevant_codes = {c for c in all_market_codes if c in ("EGX", "GENERAL")}
        # Count distinct news rows where published_at > prediction_date for each prediction.
        # To keep it bounded, we sample.
        cnt_query = (
            "SELECT COUNT(*) FROM news_articles "
            "WHERE market_code IN ({}) "
            "AND published_at IS NOT NULL AND published_at != '' "
            "AND length(published_at) >= 10 "
            "AND substr(published_at,1,4) GLOB '[0-9][0-9][0-9][0-9]' "
            "AND published_at > ?"
        ).format(",".join("?" * len(relevant_codes)))

        total_lookahead_news = 0
        for p in predictions:
            params = list(relevant_codes) + [p["prediction_date"]]
            cnt = conn.execute(cnt_query, params).fetchone()[0]
            if cnt > 0:
                affected.add(p["id"])
                total_lookahead_news += cnt
                if len(lookahead_examples) < MAX_EXAMPLES:
                    # pick one example article
                    ex_q = (
                        "SELECT id, title, market_code, published_at FROM news_articles "
                        "WHERE market_code IN ({}) "
                        "AND published_at IS NOT NULL AND published_at != '' "
                        "AND length(published_at) >= 10 "
                        "AND substr(published_at,1,4) GLOB '[0-9][0-9][0-9][0-9]' "
                        "AND published_at > ? "
                        "ORDER BY published_at LIMIT 1"
                    ).format(",".join("?" * len(relevant_codes)))
                    ex = conn.execute(ex_q, params).fetchone()
                    if ex:
                        lookahead_examples.append(
                            {
                                "pred_id": p["id"],
                                "ticker": p["ticker"],
                                "prediction_date": p["prediction_date"],
                                "news_id": ex[0],
                                "news_title": (ex[1] or "")[:120],
                                "news_market_code": ex[2],
                                "news_published_at": ex[3],
                                "matching_news_count": cnt,
                                "note": "Linked via market_code proxy (news.symbol is NULL for all rows).",
                            }
                        )

        # Important caveat: news.symbol is NULL for ALL rows → per-ticker linkage
        # is impossible, so the per-ticker look-ahead check cannot be performed.
        # This is a data-quality block (equivalent to missing linkage column),
        # not a clean PASS.
        if rng[2] == rowcount:
            # All news.symbol NULL — cannot verify per-ticker look-ahead bias.
            status = "BLOCKED"
            evidence = (
                f"All {rowcount} news_articles have symbol=NULL — per-ticker look-ahead "
                "cannot be verified (linkage column effectively missing). Market-level "
                "proxy scan: "
                f"{total_lookahead_news} news rows with market_code in {sorted(relevant_codes)} "
                f"have published_at > prediction_date, affecting {len(affected)} predictions "
                "(examples listed for transparency; NOT counted as proven look-ahead because "
                "no per-ticker linkage exists)."
            )
        else:
            status = "FAIL" if lookahead_examples else "PASS"
            evidence = (
                f"Found {total_lookahead_news} news articles with published_at > prediction_date "
                f"affecting {len(affected)} predictions."
            )

        result.update(
            {
                "status": status,
                "lookahead_count": total_lookahead_news,
                "predictions_with_lookahead": len(affected),
                "examples": truncate_examples(lookahead_examples),
                "evidence": evidence,
                "caveat": (
                    "news_articles.symbol is NULL for all rows; linkage to predictions is via "
                    "market_code proxy only. Findings are informational unless symbol linkage "
                    "is restored."
                ),
            }
        )
    finally:
        conn.close()
    return result


# ---------------------------------------------------------------------------
# CHECK 3 — Price history point-in-time (price_history.db)
# ---------------------------------------------------------------------------
def check_3_price_history(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Task rule:
      For each prediction:
        - If prediction_date > max(date) in price_history for ticker
          → look-ahead bias.
    Also report: count of price rows AFTER prediction_date (potential leak surface).
    """
    result: Dict[str, Any] = {
        "check": "3_price_history_point_in_time",
        "db": "db/price_history.db",
        "table": "price_history",
        "status": "BLOCKED",
        "lookahead_count": 0,
        "predictions_with_lookahead": 0,
        "examples": [],
        "evidence": "",
    }
    db_path = os.path.join(DB_DIR, "price_history.db")
    if not os.path.exists(db_path):
        result["evidence"] = "price_history.db missing"
        return result

    conn = connect_ro(db_path)
    try:
        if not table_exists(conn, "price_history"):
            result["evidence"] = "price_history table missing"
            return result
        cols = table_cols(conn, "price_history")
        rowcount = conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
        rng = conn.execute(
            "SELECT MIN(date), MAX(date), COUNT(DISTINCT ticker) FROM price_history"
        ).fetchone()
        result.update(
            {
                "columns": cols,
                "rowcount": rowcount,
                "date_min": rng[0],
                "date_max": rng[1],
                "distinct_tickers": rng[2],
            }
        )

        # Per ticker: max(date) and count after prediction_date
        ticker_maxdate: Dict[str, str] = {}
        cur = conn.execute(
            "SELECT ticker, MAX(date) FROM price_history GROUP BY ticker"
        )
        ticker_maxdate = {r[0]: r[1] for r in cur.fetchall()}

        lookahead_examples: List[Dict[str, Any]] = []
        affected = set()
        for p in predictions:
            t = p["ticker"]
            pdate = p["prediction_date"]
            mx = ticker_maxdate.get(t)
            if mx is None:
                # ticker has no price history at all — FLAG
                affected.add(p["id"])
                if len(lookahead_examples) < MAX_EXAMPLES:
                    lookahead_examples.append(
                        {
                            "pred_id": p["id"],
                            "ticker": t,
                            "prediction_date": pdate,
                            "max_price_history_date": None,
                            "issue": "ticker has NO price history at all",
                        }
                    )
                continue
            cmp = safe_cmp(pdate, mx)
            if cmp is None:
                continue
            if cmp > 0:  # prediction_date > max(date) → look-ahead per task rule
                affected.add(p["id"])
                if len(lookahead_examples) < MAX_EXAMPLES:
                    lookahead_examples.append(
                        {
                            "pred_id": p["id"],
                            "ticker": t,
                            "prediction_date": pdate,
                            "max_price_history_date": mx,
                            "issue": "prediction_date > max(price_history.date) for ticker",
                        }
                    )

        # Also compute potential leak surface: rows with date > prediction_date (informational)
        # Sample one ticker to keep bounded.
        sample_ticker = predictions[0]["ticker"] if predictions else None
        leak_surface = None
        if sample_ticker:
            pdate0 = predictions[0]["prediction_date"]
            leak_surface = conn.execute(
                "SELECT COUNT(*) FROM price_history WHERE ticker=? AND date > ?",
                (sample_ticker, pdate0),
            ).fetchone()[0]

        status = "FAIL" if affected else "PASS"
        result.update(
            {
                "status": status,
                "lookahead_count": len(affected),
                "predictions_with_lookahead": len(affected),
                "examples": truncate_examples(lookahead_examples),
                "evidence": (
                    f"Checked {len(predictions)} predictions; "
                    f"{len(affected)} have prediction_date > max(price_history.date) for their ticker. "
                    f"price_history range: {rng[0]} → {rng[1]}; {rng[2]} distinct tickers. "
                    f"Sample leak-surface ({sample_ticker}, rows with date > {pdate0 if sample_ticker else 'n/a'}): "
                    f"{leak_surface} rows AFTER prediction_date exist in price_history "
                    "(cannot use these for prediction inputs)."
                ),
            }
        )
    finally:
        conn.close()
    return result


# ---------------------------------------------------------------------------
# CHECK 4 — Cross-table timestamp alignment (predictions vs price_history)
# ---------------------------------------------------------------------------
def check_4_cross_table(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    - For each prediction, verify that price_history has at least one row with
      date <= prediction_date (price data available BEFORE prediction).
    - For each prediction with non-null outcome_date, verify that price_history
      has a row on or near outcome_date (within ±3 calendar days).
    """
    result: Dict[str, Any] = {
        "check": "4_cross_table_alignment",
        "tables": ["predictions.db.predictions", "price_history.db.price_history"],
        "status": "BLOCKED",
        "pre_prediction_price_missing": 0,
        "outcome_price_missing": 0,
        "examples": [],
        "evidence": "",
    }
    db_path = os.path.join(DB_DIR, "price_history.db")
    if not os.path.exists(db_path):
        result["evidence"] = "price_history.db missing"
        return result

    conn = connect_ro(db_path)
    try:
        examples: List[Dict[str, Any]] = []
        pre_missing = 0
        outcome_missing = 0
        for p in predictions:
            t = p["ticker"]
            pdate = p["prediction_date"]
            # Pre-prediction price row?
            cnt_pre = conn.execute(
                "SELECT COUNT(*) FROM price_history WHERE ticker=? AND date <= ?",
                (t, pdate),
            ).fetchone()[0]
            if cnt_pre == 0:
                pre_missing += 1
                if len(examples) < MAX_EXAMPLES:
                    examples.append(
                        {
                            "type": "pre_prediction_price_missing",
                            "pred_id": p["id"],
                            "ticker": t,
                            "prediction_date": pdate,
                            "issue": "No price_history rows with date <= prediction_date",
                        }
                    )
            # Outcome price row?
            odate = p.get("outcome_date")
            if odate:
                cnt_out = conn.execute(
                    "SELECT COUNT(*) FROM price_history WHERE ticker=? AND date BETWEEN ? AND ?",
                    (t, odate, odate),
                ).fetchone()[0]
                if cnt_out == 0:
                    outcome_missing += 1
                    if len(examples) < MAX_EXAMPLES:
                        examples.append(
                            {
                                "type": "outcome_price_missing",
                                "pred_id": p["id"],
                                "ticker": t,
                                "prediction_date": pdate,
                                "outcome_date": odate,
                                "issue": "No price_history row on outcome_date (outcome cannot be verified from price_history)",
                            }
                        )

        status = "FAIL" if (pre_missing > 0 or outcome_missing > 0) else "PASS"
        result.update(
            {
                "status": status,
                "pre_prediction_price_missing": pre_missing,
                "outcome_price_missing": outcome_missing,
                "examples": truncate_examples(examples),
                "evidence": (
                    f"pre_prediction_price_missing={pre_missing}; "
                    f"outcome_price_missing={outcome_missing}; "
                    f"total predictions={len(predictions)}"
                ),
            }
        )
    finally:
        conn.close()
    return result


# ---------------------------------------------------------------------------
# CHECK 5 — Stock data freshness (stocks.db)
# ---------------------------------------------------------------------------
def check_5_stocks_freshness(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    For each prediction (ticker, prediction_date):
      - Look up stocks.last_update (and last_updated, updated_at) for that ticker.
      - If last_update > prediction_date → potential look-ahead (current snapshot
        contains newer info than the prediction's as-of date).
    """
    result: Dict[str, Any] = {
        "check": "5_stocks_freshness",
        "db": "db/stocks.db",
        "table": "stocks",
        "status": "BLOCKED",
        "lookahead_count": 0,
        "predictions_with_lookahead": 0,
        "examples": [],
        "evidence": "",
    }
    db_path = os.path.join(DB_DIR, "stocks.db")
    if not os.path.exists(db_path):
        result["evidence"] = "stocks.db missing"
        return result
    conn = connect_ro(db_path)
    try:
        if not table_exists(conn, "stocks"):
            result["evidence"] = "stocks table missing"
            return result
        cols = table_cols(conn, "stocks")
        rowcount = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        result["columns"] = cols
        result["rowcount"] = rowcount

        ts_candidates = [c for c in ("last_update", "last_updated", "updated_at") if c in cols]
        if not ts_candidates:
            result["evidence"] = "No last_update / last_updated / updated_at columns present"
            return result
        result["ts_columns_present"] = ts_candidates
        ts_col = "last_update"  # primary per task instructions

        # Load stock ts map
        cur = conn.execute(f"SELECT ticker, {ts_col} FROM stocks")
        stock_ts: Dict[str, str] = {}
        for r in cur.fetchall():
            if r[0] is None:
                continue
            stock_ts[r[0]] = r[1]

        lookahead_examples: List[Dict[str, Any]] = []
        affected = set()
        missing_in_stocks = 0
        for p in predictions:
            t = p["ticker"]
            pdate = p["prediction_date"]
            ts = stock_ts.get(t)
            if ts is None:
                missing_in_stocks += 1
                if len(lookahead_examples) < MAX_EXAMPLES:
                    lookahead_examples.append(
                        {
                            "pred_id": p["id"],
                            "ticker": t,
                            "prediction_date": pdate,
                            "stock_last_update": None,
                            "issue": "ticker not present in stocks table",
                        }
                    )
                continue
            ts_date = to_date_str(ts)
            cmp = safe_cmp(ts_date, pdate)
            if cmp is None:
                continue
            if cmp > 0:  # stock last_update > prediction_date → look-ahead
                affected.add(p["id"])
                if len(lookahead_examples) < MAX_EXAMPLES:
                    lookahead_examples.append(
                        {
                            "pred_id": p["id"],
                            "ticker": t,
                            "prediction_date": pdate,
                            "stock_last_update": ts,
                            "stock_last_update_date": ts_date,
                            "issue": "stocks.last_update > prediction_date (snapshot used future state)",
                        }
                    )

        status = "FAIL" if affected else "PASS"
        result.update(
            {
                "status": status,
                "lookahead_count": len(affected),
                "predictions_with_lookahead": len(affected),
                "predictions_ticker_missing_in_stocks": missing_in_stocks,
                "examples": truncate_examples(lookahead_examples),
                "evidence": (
                    f"Used '{ts_col}' as point-in-time marker (also present: {ts_candidates}). "
                    f"{len(affected)} of {len(predictions)} predictions have stocks.last_update > "
                    "prediction_date — i.e., the stocks snapshot used was newer than the claimed "
                    "prediction as-of date. "
                    f"{missing_in_stocks} prediction tickers were not found in stocks table."
                ),
            }
        )
    finally:
        conn.close()
    return result


# ---------------------------------------------------------------------------
# BONUS — created_at vs prediction_date (retroactive generation detector)
# ---------------------------------------------------------------------------
def bonus_created_vs_prediction(predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
    cnt_total = len(predictions)
    cnt_after = 0
    cnt_on = 0
    cnt_before = 0
    cnt_null = 0
    examples: List[Dict[str, Any]] = []
    for p in predictions:
        pdate = p["prediction_date"]
        cdate = to_date_str(p["created_at"])
        if cdate is None:
            cnt_null += 1
            continue
        if cdate > pdate:
            cnt_after += 1
            if len(examples) < MAX_EXAMPLES:
                examples.append(
                    {
                        "pred_id": p["id"],
                        "ticker": p["ticker"],
                        "prediction_date": pdate,
                        "created_at": p["created_at"],
                        "created_at_date": cdate,
                        "issue": "prediction was generated AFTER its claimed prediction_date (retroactive/backtest)",
                    }
                )
        elif cdate < pdate:
            cnt_before += 1
        else:
            cnt_on += 1
    return {
        "check": "bonus_created_at_vs_prediction_date",
        "status": "FAIL" if cnt_after > 0 else "PASS",
        "total_predictions": cnt_total,
        "created_after_prediction_date": cnt_after,
        "created_on_prediction_date": cnt_on,
        "created_before_prediction_date": cnt_before,
        "created_at_null": cnt_null,
        "examples": examples,
        "evidence": (
            f"{cnt_after}/{cnt_total} predictions have created_at > prediction_date, "
            "indicating retroactive generation (backtest). This is a prerequisite for "
            "look-ahead bias — the audit checks above determine if future data was actually used."
        ),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("[audit_phase1_lookahead] starting", file=sys.stderr)
    zip_md5 = md5_of_file(DATA_ZIP) if os.path.exists(DATA_ZIP) else None
    md5_match = (zip_md5 == EXPECTED_MD5)

    predictions = load_predictions()
    print(f"[audit_phase1_lookahead] loaded {len(predictions)} predictions", file=sys.stderr)

    c1 = check_1_fundamentals(predictions)
    c2 = check_2_news(predictions)
    c3 = check_3_price_history(predictions)
    c4 = check_4_cross_table(predictions)
    c5 = check_5_stocks_freshness(predictions)
    bonus = bonus_created_vs_prediction(predictions)

    checks = [c1, c2, c3, c4, c5]
    statuses = [c["status"] for c in checks]

    if "FAIL" in statuses:
        overall = "FAIL"
    elif "BLOCKED" in statuses:
        overall = "BLOCKED"
    else:
        overall = "PASS"

    report = {
        "audit_phase": "1.1",
        "audit_name": "look_ahead_bias_detection",
        "audit_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_zip": "data/active_databases_20260817_full.zip",
        "dataset_md5_expected": EXPECTED_MD5,
        "dataset_md5_observed": zip_md5,
        "dataset_md5_match": md5_match,
        "predictions_count": len(predictions),
        "predictions_distinct_tickers": len({p["ticker"] for p in predictions}),
        "predictions_date_range": {
            "min_prediction_date": min((p["prediction_date"] for p in predictions), default=None),
            "max_prediction_date": max((p["prediction_date"] for p in predictions), default=None),
        },
        "checks": {
            "1_fundamentals_timestamp": c1,
            "2_news_timestamp": c2,
            "3_price_history_point_in_time": c3,
            "4_cross_table_alignment": c4,
            "5_stocks_freshness": c5,
            "bonus_created_at_vs_prediction_date": bonus,
        },
        "overall_status": overall,
        "next_phase_allowed": (overall == "PASS"),
    }

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"[audit_phase1_lookahead] wrote {OUT_JSON}", file=sys.stderr)
    print(f"[audit_phase1_lookahead] overall_status={overall}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
