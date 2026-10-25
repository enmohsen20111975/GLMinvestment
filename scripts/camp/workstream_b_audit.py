#!/usr/bin/env python3
"""
workstream_b_audit.py — Workstream B: Signal & Execution Integrity Audit
========================================================================
Read-only audit of /home/z/my-project/db/predictions.db (2256 rows)
vs /home/z/my-project/db/price_history.db (1,311,000 rows; ends 2026-10-21).

Seven checks:
  1. prediction_price_match       : MATCH / MISMATCH / MISSING_DATE / MISSING_TICKER
  2. stale_entries                : open predictions whose signal date is
                                    significantly before last candle (>=30d)
  3. future_data_predictions      : prediction_date > price_history max (2026-10-21)
  4. ticker_mapping_issues        : predictions.ticker not present in price_history
                                    (with fuzzy-match suggestions)
  5. exit_verification            : exit_price vs price_history close on outcome_date
  6. stop_target_verification     : hit_target=1 / hit_stop=1 verified against
                                    high/low within holding window
  7. deep_dive_sample             : 20 predictions traced fully

Strictly read-only: opens DBs in mode=ro, never writes to production files.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path("/home/z/my-project")
PH_DB = PROJECT_ROOT / "db" / "price_history.db"
PRED_DB = PROJECT_ROOT / "db" / "predictions.db"
OUT_JSON = PROJECT_ROOT / "scripts" / "camp" / "results" / "workstream_b_report.json"

PRICE_HISTORY_MAX_DATE = "2026-10-21"
ENTRY_MATCH_TOLERANCE_PCT = 0.5   # |entry_price - close| / close <= 0.5% → MATCH
EXIT_MATCH_TOLERANCE_PCT = 1.0   # |exit_price - close| / close > 1.0% → mismatch
STALE_GAP_DAYS = 30              # active & gap >= 30d → stale
DEEP_DIVE_N = 20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def open_ro(path: Path) -> sqlite3.Connection:
    uri = f"file:{path}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def _date_only(s: str | None) -> str | None:
    """Reduce 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD' to 'YYYY-MM-DD'."""
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    # Format A: 'YYYY-MM-DD HH:MM:SS' → take first 10 chars
    if len(s) >= 10:
        return s[:10]
    return s


def _pct_diff(a: float, b: float) -> float:
    """Absolute percentage difference relative to b (denominator)."""
    if b == 0:
        return float("inf") if a != 0 else 0.0
    return abs(a - b) / abs(b) * 100.0


# ---------------------------------------------------------------------------
# Check 1 — Prediction vs price_history match (entry_price vs close)
# ---------------------------------------------------------------------------

def check_prediction_price_match(pred_con, ph_con) -> dict:
    cur = pred_con.cursor()
    cur.execute(
        "SELECT id, ticker, prediction_date, entry_price, signal "
        "FROM predictions WHERE entry_price IS NOT NULL"
    )
    rows = cur.fetchall()
    total = len(rows)

    # Cache price_history (ticker, date) → close_price
    # Do this in two passes: first collect distinct (ticker, date) keys,
    # then bulk-select to avoid 2256 round-trips.
    keys = set()
    for r in rows:
        d = _date_only(r["prediction_date"])
        if d is not None:
            keys.add((r["ticker"], d))

    ph_cur = ph_con.cursor()
    # Build a lookup table for needed (ticker, date) pairs
    price_lookup: dict[tuple[str, str], float] = {}
    # Batch via temp table on ph_con? ph_con is read-only — use IN-clause
    # batches.
    keys_list = sorted(keys)
    BATCH = 500
    for i in range(0, len(keys_list), BATCH):
        chunk = keys_list[i:i + BATCH]
        placeholders = ",".join(["(?,?)"] * len(chunk))
        params = []
        for k in chunk:
            params.extend([k[0], k[1]])
        ph_cur.execute(
            f"SELECT ticker, date, close_price FROM price_history "
            f"WHERE (ticker, date) IN ({placeholders})",
            params,
        )
        for pr in ph_cur.fetchall():
            if pr["close_price"] is not None:
                price_lookup[(pr["ticker"], pr["date"])] = pr["close_price"]

    # Also cache: which tickers exist in price_history at all
    ph_cur.execute("SELECT DISTINCT ticker FROM price_history")
    ph_tickers = {r["ticker"] for r in ph_cur.fetchall()}

    classification = {"MATCH": 0, "MISMATCH": 0, "MISSING_DATE": 0, "MISSING_TICKER": 0}
    mismatch_samples: list[dict] = []
    missing_date_samples: list[dict] = []
    missing_ticker_samples: list[dict] = []
    match_samples: list[dict] = []

    for r in rows:
        pred_id = r["id"]
        ticker = r["ticker"]
        pred_date = _date_only(r["prediction_date"])
        entry_price = r["entry_price"]

        if ticker not in ph_tickers:
            classification["MISSING_TICKER"] += 1
            if len(missing_ticker_samples) < 50:
                missing_ticker_samples.append({
                    "prediction_id": pred_id,
                    "ticker": ticker,
                    "pred_date": pred_date,
                    "entry_price": entry_price,
                })
            continue

        key = (ticker, pred_date)
        if key not in price_lookup:
            classification["MISSING_DATE"] += 1
            if len(missing_date_samples) < 50:
                missing_date_samples.append({
                    "prediction_id": pred_id,
                    "ticker": ticker,
                    "pred_date": pred_date,
                    "entry_price": entry_price,
                    "signal": r["signal"],
                })
            continue

        close = price_lookup[key]
        diff_pct = _pct_diff(entry_price, close)
        if diff_pct <= ENTRY_MATCH_TOLERANCE_PCT:
            classification["MATCH"] += 1
            if len(match_samples) < 10:
                match_samples.append({
                    "prediction_id": pred_id,
                    "ticker": ticker,
                    "pred_date": pred_date,
                    "entry_price": entry_price,
                    "price_history_close": close,
                    "diff_pct": round(diff_pct, 4),
                })
        else:
            classification["MISMATCH"] += 1
            if len(mismatch_samples) < 50:
                mismatch_samples.append({
                    "prediction_id": pred_id,
                    "ticker": ticker,
                    "pred_date": pred_date,
                    "entry_price": entry_price,
                    "price_history_close": close,
                    "diff_pct": round(diff_pct, 4),
                    "signal": r["signal"],
                })

    return {
        "totals": classification,
        "total_checked": total,
        "tolerance_pct": ENTRY_MATCH_TOLERANCE_PCT,
        "samples": {
            "match": match_samples,
            "mismatch": mismatch_samples,
            "missing_date": missing_date_samples,
            "missing_ticker": missing_ticker_samples,
        },
    }


# ---------------------------------------------------------------------------
# Check 2 — Stale entries (signal on old data)
# ---------------------------------------------------------------------------

def check_stale_entries(pred_con, ph_con) -> list[dict]:
    """Predictions whose signal_date is BEFORE the last available price candle
    for that ticker AND prediction hasn't been resolved (exit_price IS NULL).
    Threshold: gap >= STALE_GAP_DAYS.
    """
    cur = pred_con.cursor()
    cur.execute(
        "SELECT id, ticker, prediction_date, entry_price, signal, status, "
        "exit_price, outcome_date FROM predictions "
        "WHERE exit_price IS NULL"
    )
    preds = cur.fetchall()

    # Cache last_price_date per ticker (only for tickers we need)
    needed_tickers = {r["ticker"] for r in preds}
    ph_cur = ph_con.cursor()
    last_date_by_ticker: dict[str, str] = {}
    ticker_list = sorted(needed_tickers)
    BATCH = 500
    for i in range(0, len(ticker_list), BATCH):
        chunk = ticker_list[i:i + BATCH]
        placeholders = ",".join(["?"] * len(chunk))
        ph_cur.execute(
            f"SELECT ticker, MAX(date) AS max_date FROM price_history "
            f"WHERE ticker IN ({placeholders}) GROUP BY ticker",
            chunk,
        )
        for r in ph_cur.fetchall():
            last_date_by_ticker[r["ticker"]] = r["max_date"]

    stale: list[dict] = []
    cutoff_date = datetime.strptime(PRICE_HISTORY_MAX_DATE, "%Y-%m-%d").date()
    for r in preds:
        d_str = _date_only(r["prediction_date"])
        if d_str is None:
            continue
        try:
            pred_date = datetime.strptime(d_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        # Use last_price_date for ticker (fallback to global max)
        lpd_str = last_date_by_ticker.get(r["ticker"], PRICE_HISTORY_MAX_DATE)
        try:
            lpd = datetime.strptime(lpd_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        gap_days = (lpd - pred_date).days
        if gap_days >= STALE_GAP_DAYS:
            stale.append({
                "prediction_id": r["id"],
                "ticker": r["ticker"],
                "pred_date": d_str,
                "last_price_date": lpd_str,
                "gap_days": gap_days,
                "status": r["status"],
                "signal": r["signal"],
                "entry_price": r["entry_price"],
            })

    # Sort: largest gap first
    stale.sort(key=lambda x: -x["gap_days"])
    return stale


# ---------------------------------------------------------------------------
# Check 3 — Future-data dependencies (prediction_date > price_history max)
# ---------------------------------------------------------------------------

def check_future_data_predictions(pred_con) -> list[dict]:
    cur = pred_con.cursor()
    cur.execute(
        "SELECT id, ticker, prediction_date, entry_price, signal, status, "
        "market FROM predictions "
        "WHERE date(prediction_date) > ? "
        "ORDER BY prediction_date ASC",
        (PRICE_HISTORY_MAX_DATE,),
    )
    out: list[dict] = []
    for r in cur.fetchall():
        out.append({
            "prediction_id": r["id"],
            "ticker": r["ticker"],
            "pred_date": r["prediction_date"],
            "entry_price": r["entry_price"],
            "signal": r["signal"],
            "status": r["status"],
            "market": r["market"],
        })
    return out


# ---------------------------------------------------------------------------
# Check 4 — Ticker mapping issues
# ---------------------------------------------------------------------------

def check_ticker_mapping(pred_con, ph_con) -> dict:
    pcur = pred_con.cursor()
    phcur = ph_con.cursor()

    pcur.execute("SELECT DISTINCT ticker FROM predictions")
    pred_tickers = {r["ticker"] for r in pcur.fetchall()}
    phcur.execute("SELECT DISTINCT ticker FROM price_history")
    ph_tickers = {r["ticker"] for r in phcur.fetchall()}

    missing = pred_tickers - ph_tickers
    ph_only = ph_tickers - pred_tickers

    # Fuzzy-match suggestions for missing tickers (simple: prefix match /
    # contains). Skip if missing is empty.
    suggestions: list[dict] = []
    if missing:
        ph_list = sorted(ph_tickers)
        for mt in sorted(missing):
            for pt in ph_list:
                # only short prefixes (avoid noise)
                if len(mt) >= 3 and (mt in pt or pt in mt) and abs(len(mt) - len(pt)) <= 2:
                    suggestions.append({
                        "predictions_ticker": mt,
                        "price_history_ticker": pt,
                        "match_type": "substring",
                    })

    # Map results: list of {predictions_ticker, price_history_ticker} pairs.
    mapping_issues: list[dict] = [
        {"predictions_ticker": mt, "price_history_ticker": None}
        for mt in sorted(missing)
    ]
    for s in suggestions:
        mapping_issues.append(s)

    return {
        "missing_in_price_history": sorted(missing),
        "missing_count": len(missing),
        "predictions_only_count": len(missing),
        "price_history_only_count": len(ph_only),
        "overlap_count": len(pred_tickers & ph_tickers),
        "predictions_ticker_count": len(pred_tickers),
        "price_history_ticker_count": len(ph_tickers),
        "ticker_mapping_issues": mapping_issues,
        "fuzzy_suggestions": suggestions,
    }


# ---------------------------------------------------------------------------
# Check 5 — Exit price verification
# ---------------------------------------------------------------------------

def check_exit_verification(pred_con, ph_con) -> dict:
    cur = pred_con.cursor()
    cur.execute(
        "SELECT id, ticker, prediction_date, entry_price, target_price, "
        "stop_loss, outcome_date, exit_price, actual_return, hit_target, "
        "hit_stop, status, signal FROM predictions "
        "WHERE exit_price IS NOT NULL"
    )
    preds = cur.fetchall()

    # Cache: (ticker, date) → close_price for outcome_date lookups
    needed = set()
    for r in preds:
        od = _date_only(r["outcome_date"])
        if od:
            needed.add((r["ticker"], od))

    ph_cur = ph_con.cursor()
    close_lookup: dict[tuple[str, str], float] = {}
    keys_list = sorted(needed)
    BATCH = 500
    for i in range(0, len(keys_list), BATCH):
        chunk = keys_list[i:i + BATCH]
        placeholders = ",".join(["(?,?)"] * len(chunk))
        params = []
        for k in chunk:
            params.extend([k[0], k[1]])
        ph_cur.execute(
            f"SELECT ticker, date, close_price FROM price_history "
            f"WHERE (ticker, date) IN ({placeholders})",
            params,
        )
        for pr in ph_cur.fetchall():
            if pr["close_price"] is not None:
                close_lookup[(pr["ticker"], pr["date"])] = pr["close_price"]

    # Also cache last_price_date per ticker for "cannot verify" cases
    needed_tickers = {r["ticker"] for r in preds}
    last_date_by_ticker: dict[str, str] = {}
    tlist = sorted(needed_tickers)
    for i in range(0, len(tlist), BATCH):
        chunk = tlist[i:i + BATCH]
        placeholders = ",".join(["?"] * len(chunk))
        ph_cur.execute(
            f"SELECT ticker, MAX(date) AS max_date FROM price_history "
            f"WHERE ticker IN ({placeholders}) GROUP BY ticker",
            chunk,
        )
        for r in ph_cur.fetchall():
            last_date_by_ticker[r["ticker"]] = r["max_date"]

    verified = 0
    mismatch = 0
    cannot_verify = 0
    mismatch_samples: list[dict] = []
    cannot_verify_samples: list[dict] = []

    for r in preds:
        exit_price = r["exit_price"]
        outcome_date = _date_only(r["outcome_date"])
        if outcome_date is None:
            cannot_verify += 1
            if len(cannot_verify_samples) < 30:
                cannot_verify_samples.append({
                    "prediction_id": r["id"],
                    "ticker": r["ticker"],
                    "outcome_date": r["outcome_date"],
                    "exit_price": exit_price,
                    "reason": "outcome_date is NULL",
                })
            continue

        key = (r["ticker"], outcome_date)
        if key not in close_lookup:
            cannot_verify += 1
            # Determine if it's because outcome_date is after last_price_date
            lpd = last_date_by_ticker.get(r["ticker"], PRICE_HISTORY_MAX_DATE)
            reason = "outcome_date not in price_history"
            if outcome_date > lpd:
                reason = (
                    f"outcome_date ({outcome_date}) > last_price_date ({lpd})"
                    " → look-ahead / future-data"
                )
            if len(cannot_verify_samples) < 30:
                cannot_verify_samples.append({
                    "prediction_id": r["id"],
                    "ticker": r["ticker"],
                    "outcome_date": outcome_date,
                    "last_price_date": lpd,
                    "exit_price": exit_price,
                    "reason": reason,
                })
            continue

        close = close_lookup[key]
        diff_pct = _pct_diff(exit_price, close)
        if diff_pct > EXIT_MATCH_TOLERANCE_PCT:
            mismatch += 1
            if len(mismatch_samples) < 50:
                mismatch_samples.append({
                    "prediction_id": r["id"],
                    "ticker": r["ticker"],
                    "outcome_date": outcome_date,
                    "exit_price": exit_price,
                    "price_history_close": close,
                    "diff_pct": round(diff_pct, 4),
                    "status": r["status"],
                    "hit_target": r["hit_target"],
                    "hit_stop": r["hit_stop"],
                })
        else:
            verified += 1

    return {
        "totals": {"verified": verified, "mismatch": mismatch, "cannot_verify": cannot_verify},
        "total_checked": len(preds),
        "tolerance_pct": EXIT_MATCH_TOLERANCE_PCT,
        "mismatch_samples": mismatch_samples,
        "cannot_verify_samples": cannot_verify_samples,
    }


# ---------------------------------------------------------------------------
# Check 6 — Stop/target hit verification
# ---------------------------------------------------------------------------

def check_stop_target_verification(pred_con, ph_con) -> dict:
    """
    For BUY signals:
      hit_target=1  → high_price >= target_price between [prediction_date, outcome_date]
      hit_stop=1    → low_price  <= stop_loss   between [prediction_date, outcome_date]
    For SELL signals (none in this DB — distribution is BUY/STRONG_BUY/HOLD/etc.),
    we still handle defensively:
      hit_target=1  → low_price  <= target_price
      hit_stop=1    → high_price >= stop_loss
    HOLD/WAIT signals are included but treated like BUY for direction-check.
    """
    SELL_SIGNALS = {"SELL", "STRONG_SELL", "SHORT"}

    cur = pred_con.cursor()
    cur.execute(
        "SELECT id, ticker, signal, prediction_date, entry_price, "
        "target_price, stop_loss, outcome_date, hit_target, hit_stop, "
        "holding_days, status FROM predictions "
        "WHERE hit_target=1 OR hit_stop=1"
    )
    preds = cur.fetchall()

    ph_cur = ph_con.cursor()

    target_hits_verified = 0
    target_hits_failed = 0
    stop_hits_verified = 0
    stop_hits_failed = 0
    target_fail_samples: list[dict] = []
    stop_fail_samples: list[dict] = []
    target_verified_samples: list[dict] = []
    stop_verified_samples: list[dict] = []

    for r in preds:
        is_sell = r["signal"] in SELL_SIGNALS
        pred_date = _date_only(r["prediction_date"])
        outcome_date = _date_only(r["outcome_date"]) or pred_date

        # Determine the holding window. If outcome_date is missing or same as
        # prediction_date, default to prediction_date + holding_days.
        try:
            pred_d = datetime.strptime(pred_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        try:
            out_d = datetime.strptime(outcome_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            out_d = pred_d + timedelta(days=int(r["holding_days"] or 0))
        if out_d < pred_d:
            out_d = pred_d + timedelta(days=int(r["holding_days"] or 0))

        # Pull high/low price bars for this ticker over the window
        ph_cur.execute(
            "SELECT date, high_price, low_price FROM price_history "
            "WHERE ticker=? AND date>=? AND date<=? ORDER BY date ASC",
            (r["ticker"], pred_date, out_d.isoformat()),
        )
        bars = ph_cur.fetchall()

        # hit_target check
        if r["hit_target"] == 1 and r["target_price"] is not None:
            target = r["target_price"]
            if not bars:
                target_hits_failed += 1
                if len(target_fail_samples) < 30:
                    target_fail_samples.append({
                        "prediction_id": r["id"],
                        "ticker": r["ticker"],
                        "pred_date": pred_date,
                        "outcome_date": outcome_date,
                        "target_price": target,
                        "entry_price": r["entry_price"],
                        "reason": "no price_history bars in window",
                    })
            else:
                if not is_sell:
                    # BUY: high must reach >= target
                    max_high = max(b["high_price"] for b in bars if b["high_price"] is not None) if any(b["high_price"] is not None for b in bars) else None
                    ok = (max_high is not None and max_high >= target)
                else:
                    # SELL: low must reach <= target
                    min_low = min(b["low_price"] for b in bars if b["low_price"] is not None) if any(b["low_price"] is not None for b in bars) else None
                    ok = (min_low is not None and min_low <= target)
                if ok:
                    target_hits_verified += 1
                    if len(target_verified_samples) < 10:
                        target_verified_samples.append({
                            "prediction_id": r["id"],
                            "ticker": r["ticker"],
                            "target_price": target,
                            "extreme_price": max_high if not is_sell else min_low,
                            "outcome_date": outcome_date,
                        })
                else:
                    target_hits_failed += 1
                    if len(target_fail_samples) < 30:
                        target_fail_samples.append({
                            "prediction_id": r["id"],
                            "ticker": r["ticker"],
                            "pred_date": pred_date,
                            "outcome_date": outcome_date,
                            "entry_price": r["entry_price"],
                            "target_price": target,
                            "max_high_in_window": max_high if not is_sell else None,
                            "min_low_in_window": min_low if is_sell else None,
                            "reason": f"target not reached in [{pred_date}, {out_d.isoformat()}]",
                        })

        # hit_stop check
        if r["hit_stop"] == 1 and r["stop_loss"] is not None:
            stop = r["stop_loss"]
            if not bars:
                stop_hits_failed += 1
                if len(stop_fail_samples) < 30:
                    stop_fail_samples.append({
                        "prediction_id": r["id"],
                        "ticker": r["ticker"],
                        "pred_date": pred_date,
                        "outcome_date": outcome_date,
                        "stop_loss": stop,
                        "entry_price": r["entry_price"],
                        "reason": "no price_history bars in window",
                    })
            else:
                if not is_sell:
                    # BUY: low must reach <= stop
                    min_low = min(b["low_price"] for b in bars if b["low_price"] is not None) if any(b["low_price"] is not None for b in bars) else None
                    ok = (min_low is not None and min_low <= stop)
                else:
                    # SELL: high must reach >= stop
                    max_high = max(b["high_price"] for b in bars if b["high_price"] is not None) if any(b["high_price"] is not None for b in bars) else None
                    ok = (max_high is not None and max_high >= stop)
                if ok:
                    stop_hits_verified += 1
                    if len(stop_verified_samples) < 10:
                        stop_verified_samples.append({
                            "prediction_id": r["id"],
                            "ticker": r["ticker"],
                            "stop_loss": stop,
                            "extreme_price": min_low if not is_sell else max_high,
                            "outcome_date": outcome_date,
                        })
                else:
                    stop_hits_failed += 1
                    if len(stop_fail_samples) < 30:
                        stop_fail_samples.append({
                            "prediction_id": r["id"],
                            "ticker": r["ticker"],
                            "pred_date": pred_date,
                            "outcome_date": outcome_date,
                            "entry_price": r["entry_price"],
                            "stop_loss": stop,
                            "min_low_in_window": min_low if not is_sell else None,
                            "max_high_in_window": max_high if is_sell else None,
                            "reason": f"stop not hit in [{pred_date}, {out_d.isoformat()}]",
                        })

    return {
        "totals": {
            "target_hits_verified": target_hits_verified,
            "target_hits_failed": target_hits_failed,
            "stop_hits_verified": stop_hits_verified,
            "stop_hits_failed": stop_hits_failed,
        },
        "target_fail_samples": target_fail_samples,
        "stop_fail_samples": stop_fail_samples,
        "target_verified_samples": target_verified_samples,
        "stop_verified_samples": stop_verified_samples,
    }


# ---------------------------------------------------------------------------
# Check 7 — Deep-dive sample (20 predictions, mix recent + old)
# ---------------------------------------------------------------------------

def check_deep_dive(pred_con, ph_con) -> list[dict]:
    cur = pred_con.cursor()
    # Mix: 10 most recent, 5 oldest, 5 random from the middle
    cur.execute(
        "SELECT id, ticker, signal, signal_type, prediction_date, entry_price, "
        "target_price, stop_loss, outcome_date, exit_price, actual_return, "
        "hit_target, hit_stop, is_correct, holding_days, status, market, "
        "atr_at_entry, highest_price_reached, lowest_price_reached, "
        "closed_at FROM predictions ORDER BY prediction_date DESC LIMIT 10"
    )
    recent = list(cur.fetchall())
    cur.execute(
        "SELECT id, ticker, signal, signal_type, prediction_date, entry_price, "
        "target_price, stop_loss, outcome_date, exit_price, actual_return, "
        "hit_target, hit_stop, is_correct, holding_days, status, market, "
        "atr_at_entry, highest_price_reached, lowest_price_reached, "
        "closed_at FROM predictions ORDER BY prediction_date ASC LIMIT 5"
    )
    oldest = list(cur.fetchall())
    # 5 random from the middle — use OFFSET 1128 on the full ordered list
    # (predictions ID range is 50215-53881, so 1128 lands mid-set)
    cur.execute(
        "SELECT id, ticker, signal, signal_type, prediction_date, entry_price, "
        "target_price, stop_loss, outcome_date, exit_price, actual_return, "
        "hit_target, hit_stop, is_correct, holding_days, status, market, "
        "atr_at_entry, highest_price_reached, lowest_price_reached, "
        "closed_at FROM predictions ORDER BY id LIMIT 5 OFFSET 1128"
    )
    middle = list(cur.fetchall())

    sample_rows = recent + oldest + middle
    ph_cur = ph_con.cursor()

    traces: list[dict] = []
    for r in sample_rows:
        pred_id = r["id"]
        ticker = r["ticker"]
        pred_date = _date_only(r["prediction_date"])
        outcome_date = _date_only(r["outcome_date"])
        entry_price = r["entry_price"]
        exit_price = r["exit_price"]
        target_price = r["target_price"]
        stop_loss = r["stop_loss"]

        # Look up price_history on pred_date
        ph_price_pred_date = None
        ph_high_in_window = None
        ph_low_in_window = None
        ph_close_outcome = None
        bars_in_window: list[dict] = []

        if pred_date is not None:
            ph_cur.execute(
                "SELECT date, open_price, high_price, low_price, close_price, "
                "volume, source FROM price_history "
                "WHERE ticker=? AND date=? LIMIT 1",
                (ticker, pred_date),
            )
            row = ph_cur.fetchone()
            if row is not None:
                ph_price_pred_date = {
                    "date": row["date"],
                    "open": row["open_price"],
                    "high": row["high_price"],
                    "low": row["low_price"],
                    "close": row["close_price"],
                    "volume": row["volume"],
                    "source": row["source"],
                }

        # Determine end of window
        end_date = outcome_date or (
            datetime.strptime(pred_date, "%Y-%m-%d").date() + timedelta(days=int(r["holding_days"] or 0))
        ).isoformat() if pred_date else None

        if pred_date is not None and end_date is not None:
            ph_cur.execute(
                "SELECT date, open_price, high_price, low_price, close_price, "
                "volume, source FROM price_history "
                "WHERE ticker=? AND date>=? AND date<=? ORDER BY date ASC",
                (ticker, pred_date, end_date),
            )
            bars = ph_cur.fetchall()
            bars_in_window = [
                {
                    "date": b["date"],
                    "open": b["open_price"],
                    "high": b["high_price"],
                    "low": b["low_price"],
                    "close": b["close_price"],
                    "source": b["source"],
                }
                for b in bars
            ]
            highs = [b["high_price"] for b in bars if b["high_price"] is not None]
            lows = [b["low_price"] for b in bars if b["low_price"] is not None]
            ph_high_in_window = max(highs) if highs else None
            ph_low_in_window = min(lows) if lows else None

        # Look up close on outcome_date
        if outcome_date is not None:
            ph_cur.execute(
                "SELECT close_price FROM price_history "
                "WHERE ticker=? AND date=? LIMIT 1",
                (ticker, outcome_date),
            )
            row = ph_cur.fetchone()
            ph_close_outcome = row["close_price"] if row is not None else None

        # Verification flags
        entry_diff_pct = (
            round(_pct_diff(entry_price, ph_price_pred_date["close"]), 4)
            if (entry_price is not None and ph_price_pred_date and ph_price_pred_date["close"] is not None)
            else None
        )
        exit_diff_pct = None
        if exit_price is not None and ph_close_outcome is not None:
            exit_diff_pct = round(_pct_diff(exit_price, ph_close_outcome), 4)

        # Target/stop verification
        target_verified = None
        stop_verified = None
        signal_is_sell = r["signal"] in {"SELL", "STRONG_SELL", "SHORT"}
        if r["hit_target"] == 1 and target_price is not None and ph_high_in_window is not None:
            if not signal_is_sell:
                target_verified = ph_high_in_window >= target_price
            else:
                # sell: target below entry, low must hit it
                target_verified = (ph_low_in_window is not None and ph_low_in_window <= target_price)
        if r["hit_stop"] == 1 and stop_loss is not None and ph_low_in_window is not None:
            if not signal_is_sell:
                stop_verified = ph_low_in_window <= stop_loss
            else:
                stop_verified = (ph_high_in_window is not None and ph_high_in_window >= stop_loss)

        # Build the trace string
        bits: list[str] = []
        bits.append(f"prediction_id={pred_id}")
        bits.append(f"ticker={ticker}")
        bits.append(f"signal={r['signal']}({r['signal_type']})")
        bits.append(f"market={r['market']}")
        bits.append(f"pred_date={pred_date}")
        bits.append(f"entry_price={entry_price}")
        if ph_price_pred_date:
            bits.append(f"ph_close_on_pred_date={ph_price_pred_date['close']}")
            bits.append(f"ph_source={ph_price_pred_date['source']}")
            if entry_diff_pct is not None:
                verdict = "MATCH" if entry_diff_pct <= ENTRY_MATCH_TOLERANCE_PCT else "MISMATCH"
                bits.append(f"entry_diff_pct={entry_diff_pct}({verdict})")
        else:
            bits.append("ph_close_on_pred_date=NONE(missing_date)")
        bits.append(f"target={target_price} stop={stop_loss}")
        bits.append(f"holding_days={r['holding_days']}")
        bits.append(f"outcome_date={outcome_date}")
        bits.append(f"exit_price={exit_price}")
        if ph_close_outcome is not None:
            bits.append(f"ph_close_on_outcome={ph_close_outcome}")
            if exit_diff_pct is not None:
                verdict = "OK" if exit_diff_pct <= EXIT_MATCH_TOLERANCE_PCT else "MISMATCH"
                bits.append(f"exit_diff_pct={exit_diff_pct}({verdict})")
        elif outcome_date is not None:
            bits.append(f"ph_close_on_outcome=NONE(outcome_date not in price_history)")
        if ph_high_in_window is not None:
            bits.append(f"ph_max_high_in_window={ph_high_in_window}")
        if ph_low_in_window is not None:
            bits.append(f"ph_min_low_in_window={ph_low_in_window}")
        if r["hit_target"] == 1:
            bits.append(f"hit_target=1 verified={target_verified}")
        if r["hit_stop"] == 1:
            bits.append(f"hit_stop=1 verified={stop_verified}")
        bits.append(f"status={r['status']}")
        trace = " | ".join(bits)

        traces.append({
            "prediction_id": pred_id,
            "ticker": ticker,
            "signal": r["signal"],
            "market": r["market"],
            "pred_date": pred_date,
            "entry_price": entry_price,
            "target_price": target_price,
            "stop_loss": stop_loss,
            "outcome_date": outcome_date,
            "exit_price": exit_price,
            "ph_close_on_pred_date": ph_price_pred_date["close"] if ph_price_pred_date else None,
            "ph_source_on_pred_date": ph_price_pred_date["source"] if ph_price_pred_date else None,
            "entry_diff_pct": entry_diff_pct,
            "ph_close_on_outcome_date": ph_close_outcome,
            "exit_diff_pct": exit_diff_pct,
            "ph_max_high_in_window": ph_high_in_window,
            "ph_min_low_in_window": ph_low_in_window,
            "bars_in_window_count": len(bars_in_window),
            "hit_target": r["hit_target"],
            "hit_stop": r["hit_stop"],
            "target_verified": target_verified,
            "stop_verified": stop_verified,
            "status": r["status"],
            "holding_days": r["holding_days"],
            "actual_return": r["actual_return"],
            "is_correct": r["is_correct"],
            "full_trace": trace,
        })

    return traces


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"[WS-B] Opening DBs (read-only): {PRED_DB}, {PH_DB}")
    pred_con = open_ro(PRED_DB)
    ph_con = open_ro(PH_DB)

    print("[WS-B] Check 1: prediction vs price_history match (entry_price vs close)...")
    c1 = check_prediction_price_match(pred_con, ph_con)
    print(f"       {c1['totals']} (total {c1['total_checked']})")

    print("[WS-B] Check 2: stale entries (signal on old data)...")
    c2 = check_stale_entries(pred_con, ph_con)
    print(f"       {len(c2)} stale entries (gap >= {STALE_GAP_DAYS}d, exit_price IS NULL)")

    print("[WS-B] Check 3: future-data dependencies (pred_date > 2026-10-21)...")
    c3 = check_future_data_predictions(pred_con)
    print(f"       {len(c3)} predictions on future dates")

    print("[WS-B] Check 4: ticker mapping issues...")
    c4 = check_ticker_mapping(pred_con, ph_con)
    print(f"       {c4['missing_count']} predictions-tickers missing in price_history; "
          f"{c4['overlap_count']}/{c4['predictions_ticker_count']} overlap exactly")

    print("[WS-B] Check 5: exit price verification...")
    c5 = check_exit_verification(pred_con, ph_con)
    print(f"       {c5['totals']} (total {c5['total_checked']})")

    print("[WS-B] Check 6: stop/target hit verification...")
    c6 = check_stop_target_verification(pred_con, ph_con)
    print(f"       {c6['totals']}")

    print("[WS-B] Check 7: deep-dive 20-prediction sample...")
    c7 = check_deep_dive(pred_con, ph_con)
    print(f"       {len(c7)} traces captured")

    report = {
        "meta": {
            "audit": "Workstream B — Signal & Execution Integrity",
            "read_only": True,
            "predictions_db": str(PRED_DB),
            "price_history_db": str(PH_DB),
            "predictions_total_rows": 2256,
            "price_history_max_date": PRICE_HISTORY_MAX_DATE,
            "entry_match_tolerance_pct": ENTRY_MATCH_TOLERANCE_PCT,
            "exit_match_tolerance_pct": EXIT_MATCH_TOLERANCE_PCT,
            "stale_gap_days_threshold": STALE_GAP_DAYS,
            "generated_at": datetime.utcnow().isoformat() + "Z",
        },
        "prediction_price_match": c1["totals"],
        "prediction_price_match_detail": c1,
        "stale_entries": c2,
        "stale_entries_count": len(c2),
        "future_data_predictions": c3,
        "future_data_predictions_count": len(c3),
        "ticker_mapping": c4,
        "ticker_mapping_issues": c4["ticker_mapping_issues"],
        "exit_verification": c5["totals"],
        "exit_verification_detail": c5,
        "stop_target_verification": c6["totals"],
        "stop_target_verification_detail": c6,
        "deep_dive_sample": c7,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n[WS-B] Report saved to: {OUT_JSON}")
    print(f"[WS-B] File size: {OUT_JSON.stat().st_size / 1024:.1f} KB")

    pred_con.close()
    ph_con.close()


if __name__ == "__main__":
    main()
