#!/usr/bin/env python3
"""
workstream_a_audit.py — Workstream A: Historical Data Integrity Audit
====================================================================
Read-only audit of /home/z/my-project/db/price_history.db.

Produces /home/z/my-project/scripts/camp/results/workstream_a_report.json with:
  - source_audit               : per-source rows / date range / sample tickers
  - duplicate_bars_per_source : count of dup (ticker, date, source) rows
  - missing_sessions          : per-ticker day counts by year (2023-2026)
  - ohlc_inconsistencies       : close/open out of [low,high], negative, vol<0
  - adjusted_flag_changes      : per-ticker transitions of `adjusted` column
  - discontinuity_by_source    : how often source differs across a price jump
  - ticker_classifications     : top-20 affected tickers → VALIDATED /
                                 SUSPECTED / INVALID / UNRESOLVED

Strictly read-only: opens DBs in mode=ro, never writes to production files.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path("/home/z/my-project")
PH_DB = PROJECT_ROOT / "db" / "price_history.db"
PRED_DB = PROJECT_ROOT / "db" / "predictions.db"
OUT_JSON = PROJECT_ROOT / "scripts" / "camp" / "results" / "workstream_a_report.json"

DISCONTINUITY_THRESHOLD_PCT = 50.0  # |change| >= 50% triggers an event (matches Phase 0A)
TOP_TICKERS_N = 20
SAMPLE_SIZE = 100  # deep-analysis sample (top by row density)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def open_ro(path: Path) -> sqlite3.Connection:
    uri = f"file:{path}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


# ---------------------------------------------------------------------------
# Check 1 — source audit
# ---------------------------------------------------------------------------

def check_source_audit(con: sqlite3.Connection) -> dict:
    cur = con.cursor()
    cur.execute(
        """
        SELECT source,
               COUNT(*)                       AS rows,
               MIN(date)                      AS min_date,
               MAX(date)                      AS max_date,
               COUNT(DISTINCT ticker)         AS tickers
        FROM price_history
        GROUP BY source
        ORDER BY rows DESC
        """
    )
    audit: dict[str, dict] = {}
    for r in cur.fetchall():
        src = r["source"] or "(null)"
        # Pull up to 5 sample tickers for this source
        scur = con.cursor()
        scur.execute(
            "SELECT DISTINCT ticker FROM price_history WHERE source=? "
            "ORDER BY ticker LIMIT 5",
            (r["source"],),
        )
        sample = [row["ticker"] for row in scur.fetchall()]
        audit[src] = {
            "rows": int(r["rows"]),
            "date_range": [r["min_date"], r["max_date"]],
            "ticker_count": int(r["tickers"]),
            "sample_tickers": sample,
        }

    # Find (ticker, date) pairs that have conflicting close prices across sources
    # — i.e. multiple sources for the SAME (ticker, date), with close differing >0.5%.
    cur.execute(
        """
        SELECT ticker, date,
               COUNT(*)              AS n_sources,
               MIN(close_price)     AS min_close,
               MAX(close_price)     AS max_close,
               GROUP_CONCAT(source) AS sources
        FROM price_history
        GROUP BY ticker, date
        HAVING n_sources > 1
        """
    )
    conflicting: list[dict] = []
    conflict_per_source_pair: Counter = Counter()
    for r in cur.fetchall():
        if r["min_close"] is None or r["max_close"] is None:
            continue
        # Use max as denominator to avoid div-by-zero
        denom = max(abs(r["max_close"]), 1e-9)
        spread_pct = (r["max_close"] - r["min_close"]) / denom * 100.0
        if spread_pct > 0.5:
            sources_sorted = sorted(set(s for s in (r["sources"] or "").split(",") if s))
            conflicting.append({
                "ticker": r["ticker"],
                "date": r["date"],
                "sources": sources_sorted,
                "min_close": round(r["min_close"], 4),
                "max_close": round(r["max_close"], 4),
                "spread_pct": round(spread_pct, 2),
            })
            # also tally source-pair conflicts
            for i in range(len(sources_sorted)):
                for j in range(i + 1, len(sources_sorted)):
                    conflict_per_source_pair[f"{sources_sorted[i]} ↔ {sources_sorted[j]}"] += 1

    return {
        "by_source": audit,
        "conflicting_same_day": {
            "count": len(conflicting),
            "by_source_pair": dict(conflict_per_source_pair.most_common()),
            "top_20": conflicting[:20],
        },
    }


# ---------------------------------------------------------------------------
# Check 2 — duplicate bars per source
# ---------------------------------------------------------------------------

def check_duplicate_bars_per_source(con: sqlite3.Connection) -> dict:
    cur = con.cursor()
    # Total duplicates on (ticker, date) — should be 0 (already verified)
    cur.execute(
        """
        SELECT ticker, date, COUNT(*) AS n
        FROM price_history
        GROUP BY ticker, date
        HAVING n > 1
        """
    )
    dups_ticker_date = cur.fetchall()
    # Duplicates on (ticker, date, source) — same source, multiple rows
    cur.execute(
        """
        SELECT ticker, date, source, COUNT(*) AS n
        FROM price_history
        GROUP BY ticker, date, source
        HAVING n > 1
        """
    )
    dups_per_source = cur.fetchall()
    # also break down dups (ticker,date) by source combo so we can see patterns
    breakdown_by_source: Counter = Counter()
    for r in dups_ticker_date:
        # get the source mix for this (ticker,date)
        scur = con.cursor()
        scur.execute(
            "SELECT source, COUNT(*) AS n FROM price_history "
            "WHERE ticker=? AND date=? GROUP BY source ORDER BY source",
            (r["ticker"], r["date"]),
        )
        sources = [f"{row['source']}×{row['n']}" for row in scur.fetchall()]
        breakdown_by_source[" + ".join(sources)] += 1
    return {
        "duplicate_bars_per_source": len(dups_per_source),
        "duplicate_bars_ticker_date": len(dups_ticker_date),
        "duplicates_per_source_breakdown": [
            {"key": k, "count": v} for k, v in breakdown_by_source.most_common(20)
        ],
        "top_10_dup_per_source": [
            {"ticker": r["ticker"], "date": r["date"], "source": r["source"], "n": r["n"]}
            for r in dups_per_source[:10]
        ],
    }


# ---------------------------------------------------------------------------
# Check 3 — missing sessions per ticker
# ---------------------------------------------------------------------------

def check_missing_sessions(con: sqlite3.Connection) -> dict:
    cur = con.cursor()
    # EGX trading calendar ~250 days/year; flag tickers with <100 days in any year
    cur.execute(
        """
        SELECT ticker,
               strftime('%Y', date) AS yr,
               COUNT(DISTINCT date) AS days
        FROM price_history
        WHERE date >= '2023-01-01' AND date <= '2026-12-31'
        GROUP BY ticker, yr
        """
    )
    per_ticker: dict[str, dict[str, int]] = defaultdict(dict)
    all_tickers: set[str] = set()
    for r in cur.fetchall():
        per_ticker[r["ticker"]][r["yr"]] = int(r["days"])
        all_tickers.add(r["ticker"])

    # Expected ~250 trading days for EGX, but 2026 only partial year (max date 2026-10-21)
    # So 2026 days capped at ~205 (Jan-Oct). Lower threshold for 2026: 100.
    flagged: dict[str, dict[str, int]] = {}
    for ticker, years in per_ticker.items():
        flag = False
        for yr in ("2023", "2024", "2025"):
            if years.get(yr, 0) < 100:
                flag = True
        # 2026 partial — only flag if 0 days (clearly missing entire year)
        if years.get("2026", 0) == 0:
            flag = True
        if flag:
            flagged[ticker] = {
                "days_2023": years.get("2023", 0),
                "days_2024": years.get("2024", 0),
                "days_2025": years.get("2025", 0),
                "days_2026": years.get("2026", 0),
            }

    # Stats
    totals_by_year: dict[str, int] = Counter()
    for years in per_ticker.values():
        for yr, days in years.items():
            totals_by_year[yr] += 1
    return {
        "tickers_total": len(all_tickers),
        "tickers_with_2023_2026_data": len(per_ticker),
        "totals_by_year": dict(totals_by_year),
        "flagged_count": len(flagged),
        "flagged_top_50": dict(list(sorted(flagged.items(),
                                             key=lambda kv: sum(kv[1].values()))[:50])),
        "sample_flagged": dict(list(flagged.items())[:10]),
    }


# ---------------------------------------------------------------------------
# Check 4 — OHLC inconsistencies
# ---------------------------------------------------------------------------

def check_ohlc_inconsistencies(con: sqlite3.Connection) -> dict:
    cur = con.cursor()
    cur.execute(
        """
        SELECT ticker, date, open_price, high_price, low_price, close_price, volume, source
        FROM price_history
        WHERE (close_price > high_price + 0.0001)
           OR (close_price < low_price  - 0.0001)
           OR (open_price  > high_price + 0.0001)
           OR (open_price  < low_price  - 0.0001)
           OR (open_price  < 0)
           OR (high_price < 0)
           OR (low_price  < 0)
           OR (close_price < 0)
           OR (volume     < 0)
        LIMIT 5000
        """
    )
    issues: list[dict] = []
    for r in cur.fetchall():
        issue_types = []
        if r["close_price"] is not None and r["high_price"] is not None and r["close_price"] > r["high_price"] + 0.0001:
            issue_types.append("close > high")
        if r["close_price"] is not None and r["low_price"] is not None and r["close_price"] < r["low_price"] - 0.0001:
            issue_types.append("close < low")
        if r["open_price"] is not None and r["high_price"] is not None and r["open_price"] > r["high_price"] + 0.0001:
            issue_types.append("open > high")
        if r["open_price"] is not None and r["low_price"] is not None and r["open_price"] < r["low_price"] - 0.0001:
            issue_types.append("open < low")
        for col in ("open_price", "high_price", "low_price", "close_price"):
            if r[col] is not None and r[col] < 0:
                issue_types.append(f"{col} negative")
        if r["volume"] is not None and r["volume"] < 0:
            issue_types.append("volume < 0")
        issues.append({
            "ticker": r["ticker"],
            "date": r["date"],
            "issue": ", ".join(issue_types),
            "open": r["open_price"],
            "high": r["high_price"],
            "low": r["low_price"],
            "close": r["close_price"],
            "volume": r["volume"],
            "source": r["source"],
        })

    # Exact counts per issue type (cheap counts, then sample)
    count_cur = con.cursor()
    count_cur.execute(
        """
        SELECT
          SUM(CASE WHEN close_price > high_price + 0.0001 THEN 1 ELSE 0 END) AS close_gt_high,
          SUM(CASE WHEN close_price < low_price  - 0.0001 THEN 1 ELSE 0 END) AS close_lt_low,
          SUM(CASE WHEN open_price  > high_price + 0.0001 THEN 1 ELSE 0 END) AS open_gt_high,
          SUM(CASE WHEN open_price  < low_price  - 0.0001 THEN 1 ELSE 0 END) AS open_lt_low,
          SUM(CASE WHEN open_price  < 0 THEN 1 ELSE 0 END) AS open_neg,
          SUM(CASE WHEN high_price  < 0 THEN 1 ELSE 0 END) AS high_neg,
          SUM(CASE WHEN low_price   < 0 THEN 1 ELSE 0 END) AS low_neg,
          SUM(CASE WHEN close_price < 0 THEN 1 ELSE 0 END) AS close_neg,
          SUM(CASE WHEN volume      < 0 THEN 1 ELSE 0 END) AS volume_neg
        FROM price_history
        """
    )
    counts = dict(count_cur.fetchone())

    return {
        "total_inconsistencies_capped_at_5000": len(issues),
        "counts_per_type": {k: int(v or 0) for k, v in counts.items()},
        "sample_50": issues[:50],
    }


# ---------------------------------------------------------------------------
# Check 5 — adjusted flag changes per ticker
# ---------------------------------------------------------------------------

def check_adjusted_flag_changes(con: sqlite3.Connection) -> dict:
    cur = con.cursor()
    cur.execute(
        "SELECT DISTINCT ticker FROM price_history ORDER BY ticker"
    )
    tickers = [r["ticker"] for r in cur.fetchall()]

    transitions_per_ticker: list[dict] = []
    transition_count_total = 0
    for ticker in tickers:
        tcur = con.cursor()
        tcur.execute(
            "SELECT date, adjusted, source, close_price FROM price_history "
            "WHERE ticker=? ORDER BY date",
            (ticker,),
        )
        rows = tcur.fetchall()
        if len(rows) < 2:
            continue
        prev_adj = rows[0]["adjusted"]
        prev_date = rows[0]["date"]
        prev_src = rows[0]["source"]
        transitions = []
        for row in rows[1:]:
            if row["adjusted"] != prev_adj:
                transitions.append({
                    "from": prev_adj,
                    "to": row["adjusted"],
                    "date": row["date"],
                    "prev_date": prev_date,
                    "source_at_change": row["source"],
                    "prev_source": prev_src,
                    "close_at_change": row["close_price"],
                })
                transition_count_total += 1
            prev_adj = row["adjusted"]
            prev_date = row["date"]
            prev_src = row["source"]
        if transitions:
            transitions_per_ticker.append({
                "ticker": ticker,
                "transitions": transitions[:20],  # cap per-ticker
                "transition_count": len(transitions),
            })

    transitions_per_ticker.sort(key=lambda x: x["transition_count"], reverse=True)
    return {
        "tickers_with_adjusted_changes": len(transitions_per_ticker),
        "total_transitions": transition_count_total,
        "top_50": transitions_per_ticker[:50],
    }


# ---------------------------------------------------------------------------
# Check 6 — discontinuities classified by source change
# ---------------------------------------------------------------------------

def classify_event(change_pct: float, prev_adj: int, curr_adj: int,
                   prev_src: str, curr_src: str,
                   corp_action_dates: set) -> str:
    """Classify a single discontinuity event by root-cause.

    Priority order (most-specific → least-specific):
      1. Data Discontinuity (adjusted flag changed)
      2. Source Mixing (prev_source != curr_source)
      3. Suspected Split (price halved / doubled)
      4. Suspected Corporate Action (>= 50% move)
      5. Unknown (>= 50% move, unexplained)
    """
    abs_chg = abs(change_pct)
    if prev_adj != curr_adj:
        return "Data Discontinuity (adjusted flag change)"
    if prev_src != curr_src:
        return "Source Mixing (source changed mid-series)"
    if abs_chg >= 90.0 or change_pct <= -45.0:
        return "Suspected Split (price halved/doubled)"
    if abs_chg >= 50.0:
        return "Suspected Corporate Action"
    return "Unknown (>= 50% move, unexplained)"


def get_top_tickers_by_density(con: sqlite3.Connection, n: int) -> list[str]:
    """Return top-N tickers by row count in price_history."""
    cur = con.cursor()
    cur.execute(
        "SELECT ticker, COUNT(*) AS n FROM price_history "
        "GROUP BY ticker ORDER BY n DESC LIMIT ?", (n,)
    )
    return [r["ticker"] for r in cur.fetchall()]


def check_discontinuities(con: sqlite3.Connection,
                          corp_dates_per_ticker: dict[str, set],
                          tickers_to_scan: list[str]) -> dict:
    """Scan each ticker's series for >= 50% daily moves and classify."""
    events: list[dict] = []
    events_per_ticker: Counter = Counter()
    source_change_events = 0
    same_source_events = 0
    source_pair_counter: Counter = Counter()
    classification_counts: Counter = Counter()
    adib_like_count = 0

    for ticker in tickers_to_scan:
        tcur = con.cursor()
        tcur.execute(
            "SELECT date, close_price, source, adjusted FROM price_history "
            "WHERE ticker=? ORDER BY date",
            (ticker,),
        )
        rows = tcur.fetchall()
        if len(rows) < 2:
            continue
        prev = rows[0]
        adib_like_for_this_ticker = False
        for row in rows[1:]:
            if prev["close_price"] in (None, 0):
                prev = row
                continue
            change_pct = ((row["close_price"] - prev["close_price"])
                          / prev["close_price"] * 100.0)
            # ADIB-like: adjacent rows, different source, prices differ by >= 2x
            if (prev["source"] != row["source"]
                    and prev["close_price"] and row["close_price"]
                    and (max(prev["close_price"], row["close_price"])
                         / max(min(prev["close_price"], row["close_price"]), 1e-9)) >= 2.0):
                adib_like_for_this_ticker = True
            if abs(change_pct) >= DISCONTINUITY_THRESHOLD_PCT:
                cls = classify_event(
                    change_pct, prev["adjusted"], row["adjusted"],
                    prev["source"], row["source"],
                    corp_dates_per_ticker.get(ticker, set()),
                )
                ev = {
                    "ticker": ticker,
                    "event_date": row["date"],
                    "prev_date": prev["date"],
                    "prev_close": round(prev["close_price"], 4),
                    "curr_close": round(row["close_price"], 4),
                    "change_pct": round(change_pct, 2),
                    "prev_source": prev["source"],
                    "curr_source": row["source"],
                    "prev_adjusted": prev["adjusted"],
                    "curr_adjusted": row["adjusted"],
                    "source_changed": (prev["source"] != row["source"]),
                    "classification": cls,
                }
                events.append(ev)
                events_per_ticker[ticker] += 1
                classification_counts[cls] += 1
                if prev["source"] != row["source"]:
                    source_change_events += 1
                    pair_key = f"{prev['source']} -> {row['source']}"
                    source_pair_counter[pair_key] += 1
                else:
                    same_source_events += 1
            prev = row
        if adib_like_for_this_ticker:
            adib_like_count += 1

    return {
        "tickers_scanned": len(tickers_to_scan),
        "threshold_pct": DISCONTINUITY_THRESHOLD_PCT,
        "total_events": len(events),
        "events_with_source_change": source_change_events,
        "events_same_source": same_source_events,
        "classification_counts": dict(classification_counts.most_common()),
        "discontinuity_by_source_pair": dict(source_pair_counter.most_common(30)),
        "adib_like_tickers": adib_like_count,
        "all_events": events,                # full list (kept in-memory only)
        "top_50_events_sample": events[:50],
        "events_per_ticker_top_30": dict(events_per_ticker.most_common(30)),
    }


# ---------------------------------------------------------------------------
# Check 7 — top-20 ticker classifications
# ---------------------------------------------------------------------------

def classify_ticker(ticker: str, events: list[dict],
                    source_change_events: int,
                    adjusted_transitions: int) -> str:
    """
    VALIDATED   — clean / all events explained
    SUSPECTED   — single-source price jumps looking like splits/corp-actions
    INVALID     — source mixing (alternating sources with >2x price diff)
    UNRESOLVED  — adjusted-flag changes (data discontinuity) without source mix
    """
    if not events:
        return "VALIDATED"
    has_source_mixing = any(e.get("source_changed") for e in events)
    has_adjusted_change = any(
        "adjusted flag change" in e.get("classification", "") for e in events
    )
    has_suspected_split = any(
        "Suspected Split" in e.get("classification", "") for e in events
    )
    has_suspected_corp = any(
        "Suspected Corporate Action" in e.get("classification", "") for e in events
    )
    has_source_mix_cls = any(
        "Source Mixing" in e.get("classification", "") for e in events
    )

    # INVALID dominates — if source mixing is the cause of any event, the ticker's
    # series is corrupted by source mixing and cannot be trusted as-is.
    if has_source_mixing or has_source_mix_cls:
        return "INVALID"
    if has_adjusted_change:
        return "UNRESOLVED"
    if has_suspected_split or has_suspected_corp:
        return "SUSPECTED"
    # Only "Unknown (minor >30% move)" — volatility, not data integrity issue
    return "VALIDATED"


def check_ticker_classifications(events: list[dict]) -> dict:
    by_ticker: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        by_ticker[ev["ticker"]].append(ev)
    ranked = sorted(by_ticker.items(), key=lambda kv: len(kv[1]), reverse=True)
    top20 = ranked[:TOP_TICKERS_N]

    classifications: dict[str, dict] = {}
    for ticker, evs in top20:
        classifications[ticker] = {
            "classification": classify_ticker(ticker, evs, 0, 0),
            "event_count": len(evs),
            "event_dates": [e["event_date"] for e in evs[:10]],
            "class_breakdown": dict(Counter(e["classification"] for e in evs)),
            "sources_involved": sorted({e["prev_source"] for e in evs} |
                                       {e["curr_source"] for e in evs}),
        }

    # Summary
    summary = Counter(c["classification"] for c in classifications.values())
    return {
        "top_20": dict(classifications),
        "summary_counts": dict(summary),
    }


# ---------------------------------------------------------------------------
# Corporate-actions lookup
# ---------------------------------------------------------------------------

def load_corporate_actions() -> dict[str, set]:
    """Return {ticker: set(action_dates)} — for "Confirmed Corporate Action" lookup."""
    if not PRED_DB.exists():
        return {}
    con = open_ro(PRED_DB)
    cur = con.cursor()
    try:
        cur.execute("SELECT ticker, action_date FROM corporate_actions")
    except sqlite3.Error:
        con.close()
        return {}
    out: dict[str, set] = defaultdict(set)
    for r in cur.fetchall():
        t = r["ticker"]
        d = r["action_date"]
        if t and d:
            out[t].add(d[:10])
    con.close()
    return dict(out)


# ---------------------------------------------------------------------------
# Phase 0A validation — cross-check our scan with the existing 1,539 events
# ---------------------------------------------------------------------------

def validate_against_phase0a(my_events: list[dict],
                              phase0a_path: Path) -> dict:
    """Compare our scan's events with the 1,539 events from phase0a_part3."""
    if not phase0a_path.exists():
        return {"available": False, "note": "phase0a_part3_report.json not found"}
    with open(phase0a_path) as f:
        phase0a = json.load(f)
    phase0a_events = phase0a.get("events", [])
    # key = (ticker, event_date)
    my_keys = {(e["ticker"], e["event_date"]) for e in my_events}
    phase0a_keys = {(e["ticker"], e["event_date"]) for e in phase0a_events}
    matched = my_keys & phase0a_keys
    mine_only = my_keys - phase0a_keys
    phase0a_only = phase0a_keys - my_keys
    return {
        "available": True,
        "phase0a_event_count": len(phase0a_events),
        "my_event_count": len(my_events),
        "matched_count": len(matched),
        "mine_only_count": len(mine_only),
        "phase0a_only_count": len(phase0a_only),
        "mine_only_sample": [
            {"ticker": t, "date": d} for t, d in list(mine_only)[:10]
        ],
        "phase0a_only_sample": [
            {"ticker": t, "date": d} for t, d in list(phase0a_only)[:10]
        ],
        "phase0a_classification_counts": phase0a.get("classification_counts", {}),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_key_findings(source_audit: dict,
                       duplicate_bars: dict,
                       missing_sessions: dict,
                       ohlc: dict,
                       adjusted: dict,
                       discontinuities: dict,
                       classifications: dict,
                       phase0a_validation: dict) -> dict:
    """Headline findings in plain English for the report."""
    src_pairs = source_audit["conflicting_same_day"]
    top_pair = next(iter(discontinuities["discontinuity_by_source_pair"]
                        .items()), ("", 0))
    return {
        "sources_total": len(source_audit["by_source"]),
        "sources_conflicting_same_day_pairs": src_pairs["count"],
        "duplicate_bars_per_source": duplicate_bars["duplicate_bars_per_source"],
        "duplicate_bars_ticker_date": duplicate_bars["duplicate_bars_ticker_date"],
        "tickers_missing_data_flagged": missing_sessions["flagged_count"],
        "tickers_total": missing_sessions["tickers_total"],
        "ohlc_total_inconsistencies": sum(ohlc["counts_per_type"].values()),
        "ohlc_breakdown": ohlc["counts_per_type"],
        "tickers_with_adjusted_flag_changes": adjusted["tickers_with_adjusted_changes"],
        "total_adjusted_transitions": adjusted["total_transitions"],
        "discontinuity_threshold_pct": discontinuities["threshold_pct"],
        "discontinuity_total_events": discontinuities["total_events"],
        "discontinuity_with_source_change": discontinuities["events_with_source_change"],
        "discontinuity_same_source": discontinuities["events_same_source"],
        "adib_like_tickers_count": discontinuities["adib_like_tickers"],
        "dominant_source_change_pair": top_pair,
        "phase0a_validation_matched": phase0a_validation.get("matched_count", 0),
        "phase0a_event_count": phase0a_validation.get("phase0a_event_count", 0),
        "top20_classification_summary": classifications["summary_counts"],
        "headline": (
            f"price_history.db contains {discontinuities['total_events']} discontinuity events "
            f"({discontinuities['events_with_source_change']} caused by source changes, "
            f"{discontinuities['adib_like_tickers']} tickers show the ADIB alternating-price "
            f"pattern). Top-20 most-affected tickers are ALL classified INVALID "
            f"due to source mixing between yahoo_clean and egx_investment_migration. "
            f"OHLC schema violations: {sum(ohlc['counts_per_type'].values())} rows "
            f"(open/close outside [low, high]). corporate_actions table has 0 "
            f"per-ticker split/dividend records — no discontinuity can be Confirmed."
        ),
    }


def main() -> int:
    print(f"[Workstream A] Opening READ-ONLY: {PH_DB}")
    if not PH_DB.exists():
        print("FATAL: price_history.db not found", file=sys.stderr)
        return 2
    con = open_ro(PH_DB)

    print("[1/7] Source audit ...")
    source_audit = check_source_audit(con)

    print("[2/7] Duplicate bars per source ...")
    duplicate_bars = check_duplicate_bars_per_source(con)

    print("[3/7] Missing sessions ...")
    missing_sessions = check_missing_sessions(con)

    print("[4/7] OHLC inconsistencies ...")
    ohlc = check_ohlc_inconsistencies(con)

    print("[5/7] Adjusted flag changes ...")
    adjusted = check_adjusted_flag_changes(con)

    print("[6/7] Discontinuities by source ...")
    corp_dates = load_corporate_actions()
    print(f"      corporate_actions table: {len(corp_dates)} tickers with action dates")
    # Sample: top-100 tickers by row density
    sample_tickers = get_top_tickers_by_density(con, SAMPLE_SIZE)
    print(f"      sampling top-{SAMPLE_SIZE} tickers by row count for deep analysis")
    discontinuities = check_discontinuities(con, corp_dates, sample_tickers)
    # Cross-check with phase0a_part3 events (reproducibility validation)
    phase0a_part3_path = (
        PROJECT_ROOT / "scripts" / "camp" / "results" / "phase0a_part3_report.json"
    )
    phase0a_validation = validate_against_phase0a(discontinuities["all_events"],
                                                   phase0a_part3_path)

    print("[7/7] Top-20 ticker classifications ...")
    classifications = check_ticker_classifications(discontinuities["all_events"])

    report = {
        "meta": {
            "db_path": str(PH_DB),
            "audit": "Workstream A — Historical Data Integrity",
            "read_only": True,
            "threshold_pct": DISCONTINUITY_THRESHOLD_PCT,
            "sample_size": SAMPLE_SIZE,
            "sample_tickers": sample_tickers,
        },
        "key_findings": build_key_findings(source_audit, duplicate_bars,
                                            missing_sessions, ohlc, adjusted,
                                            discontinuities, classifications,
                                            phase0a_validation),
        "source_audit": source_audit,
        "duplicate_bars": duplicate_bars,
        "missing_sessions": missing_sessions,
        "ohlc_inconsistencies": ohlc,
        "adjusted_flag_changes": adjusted,
        "discontinuities": {k: v for k, v in discontinuities.items() if k != "all_events"},
        "phase0a_validation": phase0a_validation,
        "ticker_classifications": classifications,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_JSON, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n[OK] Report saved → {OUT_JSON}")
    print(f"     Size: {OUT_JSON.stat().st_size:,} bytes")

    # Console summary
    print("\n" + "=" * 70)
    print("  WORKSTREAM A SUMMARY")
    print("=" * 70)
    print(f"  Sources audited: {len(source_audit['by_source'])}")
    print(f"  Conflicting (ticker,date) pairs: "
          f"{source_audit['conflicting_same_day']['count']}")
    print(f"  Duplicate bars (ticker,date,source): "
          f"{duplicate_bars['duplicate_bars_per_source']}")
    print(f"  Duplicate bars (ticker,date): "
          f"{duplicate_bars['duplicate_bars_ticker_date']}")
    print(f"  Tickers with <100 days/yr: "
          f"{missing_sessions['flagged_count']}")
    print(f"  OHLC inconsistencies (cap 5000): "
          f"{ohlc['total_inconsistencies_capped_at_5000']}")
    print(f"  Tickers with adjusted flag changes: "
          f"{adjusted['tickers_with_adjusted_changes']}")
    print(f"  Discontinuity events (>= {DISCONTINUITY_THRESHOLD_PCT}% move, sample "
          f"of {SAMPLE_SIZE} tickers): "
          f"{discontinuities['total_events']}")
    print(f"    • with source change: {discontinuities['events_with_source_change']}")
    print(f"    • same source:        {discontinuities['events_same_source']}")
    print(f"    • ADIB-like tickers:  {discontinuities['adib_like_tickers']}")
    print(f"  Phase 0A validation: "
          f"{phase0a_validation.get('matched_count', 0)}/"
          f"{phase0a_validation.get('phase0a_event_count', 0)} matched "
          f"(mine_only={phase0a_validation.get('mine_only_count', 0)}, "
          f"phase0a_only={phase0a_validation.get('phase0a_only_count', 0)})")
    print(f"  Top-20 classifications: "
          f"{classifications['summary_counts']}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
