#!/usr/bin/env python3
"""
PHASE 1.2 + 1.3 Audit Agent
  - PHASE 1.2: Price History Completeness (db/price_history.db -> price_history)
  - PHASE 1.3: Entry/Exit Price Sanity  (db/predictions.db  -> predictions)
READ-ONLY: opens DBs in immutable mode, writes only the JSON report.

Dataset MD5 (declared): 0947bdf6c2eff1a75ff8af6c3e576ed8
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sqlite3
import sys
from collections import defaultdict
from typing import Any

# -----------------------------------------------------------------------------
# Paths & constants
# -----------------------------------------------------------------------------
PROJECT_ROOT   = "/home/z/my-project"
PRICE_DB_PATH   = os.path.join(PROJECT_ROOT, "db", "price_history.db")
PRED_DB_PATH    = os.path.join(PROJECT_ROOT, "db", "predictions.db")
REPORT_PATH     = os.path.join(PROJECT_ROOT, "scripts", "audit_phase1_price_sanity.json")

DECLARED_MD5    = "0947bdf6c2eff1a75ff8af6c3e576ed8"

# EGX market trades Sunday–Thursday ( Fri+Sat closed ).
EGX_WEEKEND     = {4, 5}          # Mon=0..Sun=6 -> Fri=4, Sat=5

MAX_EXAMPLES    = 5
RETURN_HARD_CAP = 50.0            # |return| <= 50 %
STALE_DAYS      = 30
RECENT_DAYS     = 7

TODAY           = dt.date.today()


def _open_ro(path: str) -> sqlite3.Connection:
    """Open DB in true read-only / immutable mode."""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    uri = f"file:{path}?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True)


def md5_of(path: str) -> str:
    if not os.path.exists(path):
        return ""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _ex(items: list[Any]) -> list[Any]:
    """Trim a list to MAX_EXAMPLES entries."""
    return items[:MAX_EXAMPLES]


def _serialise(ex: Any) -> Any:
    """Make any example object JSON-safe."""
    if isinstance(ex, (dict, list, str, int, float, bool)) or ex is None:
        return ex
    return str(ex)


# =============================================================================
# PHASE 1.2 - Price History Completeness
# =============================================================================
def phase_1_2() -> dict:
    out: dict = {"phase": "1.2", "name": "Price History Completeness",
                 "db": PRICE_DB_PATH, "checks": {}}

    conn = _open_ro(PRICE_DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ---- schema fingerprint -------------------------------------------------
    cur.execute("PRAGMA table_info(price_history)")
    schema = [dict(r) for r in cur.fetchall()]
    out["schema"] = schema

    cur.execute("SELECT COUNT(*) FROM price_history")
    total_rows = cur.fetchone()[0]
    out["total_rows"] = total_rows

    cur.execute("SELECT COUNT(DISTINCT ticker) FROM price_history")
    total_tickers = cur.fetchone()[0]
    out["total_tickers"] = total_tickers

    cur.execute("SELECT MIN(date), MAX(date) FROM price_history")
    min_date_str, max_date_str = cur.fetchone()
    out["date_range"] = {"min": min_date_str, "max": max_date_str}

    # ------------------------------------------------------------------ gaps
    # For each ticker find missing EGX trading days between first & last date.
    cur.execute("""
        SELECT ticker, MIN(date) AS first_date, MAX(date) AS last_date,
               COUNT(*) AS n_rows
        FROM price_history
        WHERE date IS NOT NULL
        GROUP BY ticker
    """)
    ticker_summary = cur.fetchall()

    ticker_gaps: list[dict] = []
    total_gap_days = 0
    tickers_with_gaps = 0
    for row in ticker_summary:
        tk, first_s, last_s, _ = row
        try:
            first_d = dt.date.fromisoformat(first_s)
            last_d  = dt.date.fromisoformat(last_s)
        except Exception:
            continue
        cur.execute("SELECT date FROM price_history WHERE ticker=? ORDER BY date",
                    (tk,))
        present = {r[0] for r in cur.fetchall()}
        missing: list[str] = []
        d = first_d
        while d <= last_d:
            if d.weekday() not in EGX_WEEKEND and d.isoformat() not in present:
                missing.append(d.isoformat())
            d += dt.timedelta(days=1)
        if missing:
            tickers_with_gaps += 1
            total_gap_days += len(missing)
            ticker_gaps.append({
                "ticker": tk,
                "first_date": first_s,
                "last_date": last_s,
                "missing_count": len(missing),
                "examples": _ex(missing),
            })

    gap_pct = (tickers_with_gaps / total_tickers * 100) if total_tickers else 0
    out["checks"]["gaps"] = {
        "status": "PASS" if tickers_with_gaps == 0 else "FAIL",
        "tickers_with_gaps": tickers_with_gaps,
        "total_missing_trading_days": total_gap_days,
        "pct_tickers_with_gaps": round(gap_pct, 2),
        "examples": _ex(ticker_gaps),
    }

    # ------------------------------------------------------------- stale
    stale_threshold = TODAY - dt.timedelta(days=STALE_DAYS)
    cur.execute("""
        SELECT ticker, MAX(date) AS last_date
        FROM price_history
        GROUP BY ticker
        HAVING MAX(date) < ?
    """, (stale_threshold.isoformat(),))
    stale_rows = cur.fetchall()
    stale_examples = [{"ticker": r[0], "last_date": r[1]} for r in stale_rows]
    out["checks"]["stale_prices"] = {
        "status": "PASS" if not stale_rows else "FAIL",
        "threshold_days": STALE_DAYS,
        "cutoff_date": stale_threshold.isoformat(),
        "count": len(stale_rows),
        "examples": _ex(stale_examples),
    }

    # ---------------------------------------------------- missing recent 7d
    recent_cutoff = TODAY - dt.timedelta(days=RECENT_DAYS)
    cur.execute("""
        SELECT ticker, MAX(date) AS last_date
        FROM price_history
        GROUP BY ticker
    """, )
    all_last = cur.fetchall()
    missing_recent = [r[0] for r in all_last
                      if (r[1] or "") < recent_cutoff.isoformat()]
    out["checks"]["missing_recent_sessions"] = {
        "status": "PASS" if not missing_recent else "FAIL",
        "window_days": RECENT_DAYS,
        "cutoff_date": recent_cutoff.isoformat(),
        "count": len(missing_recent),
        "examples": _ex(missing_recent),
    }

    # ----------------------------------------------------- duplicate dates
    cur.execute("""
        SELECT ticker, date, COUNT(*) AS c
        FROM price_history
        GROUP BY ticker, date
        HAVING c > 1
        ORDER BY c DESC
    """)
    dup_rows = cur.fetchall()
    dup_examples = [{"ticker": r[0], "date": r[1], "count": r[2]}
                    for r in dup_rows]
    out["checks"]["duplicate_dates"] = {
        "status": "PASS" if not dup_rows else "FAIL",
        "duplicate_groups": len(dup_rows),
        "examples": _ex(dup_examples),
    }

    # ------------------------------------------------------ invalid OHLC
    invalid_ohlc: list[dict] = []
    cur.execute("""
        SELECT id, ticker, date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE (high_price < low_price)
           OR (close_price > high_price)
           OR (close_price < low_price)
           OR (open_price  > high_price)
           OR (open_price  < low_price)
           OR (volume      < 0)
    """)
    for r in cur.fetchall():
        invalid_ohlc.append({
            "id": r[0], "ticker": r[1], "date": r[2],
            "open": r[3], "high": r[4], "low": r[5],
            "close": r[6], "volume": r[7],
        })
    pct_ohlc = (len(invalid_ohlc) / total_rows * 100) if total_rows else 0
    out["checks"]["invalid_ohlc"] = {
        "status": "PASS" if not invalid_ohlc else "FAIL",
        "count": len(invalid_ohlc),
        "pct_of_rows": round(pct_ohlc, 4),
        "examples": _ex(invalid_ohlc),
    }

    # --------------------------------------------- impossible prices <=0 / >10000
    impossible: list[dict] = []
    cur.execute("""
        SELECT id, ticker, date, open_price, high_price, low_price, close_price
        FROM price_history
        WHERE COALESCE(open_price,0)  <= 0
           OR COALESCE(high_price,0)  <= 0
           OR COALESCE(low_price,0)   <= 0
           OR COALESCE(close_price,0) <= 0
           OR open_price  > 10000
           OR high_price  > 10000
           OR low_price   > 10000
           OR close_price > 10000
    """)
    for r in cur.fetchall():
        impossible.append({
            "id": r[0], "ticker": r[1], "date": r[2],
            "open": r[3], "high": r[4], "low": r[5], "close": r[6],
        })
    pct_imp = (len(impossible) / total_rows * 100) if total_rows else 0
    out["checks"]["impossible_prices"] = {
        "status": "PASS" if not impossible else "FAIL",
        "count": len(impossible),
        "pct_of_rows": round(pct_imp, 4),
        "examples": _ex(impossible),
    }

    # -------------------------------------------- volume anomalies (0 / >10x avg)
    cur.execute("""
        SELECT ticker, AVG(volume) AS avg_vol
        FROM price_history
        WHERE volume IS NOT NULL
        GROUP BY ticker
    """)
    avg_vol_map = {r[0]: (r[1] or 0) for r in cur.fetchall()}

    cur.execute("""
        SELECT id, ticker, date, volume
        FROM price_history
        WHERE volume IS NOT NULL
          AND (volume = 0 OR volume > 0)
        ORDER BY ticker, date
    """)
    vol_anomalies: list[dict] = []
    zero_vol_count = 0
    spike_count = 0
    for r in cur.fetchall():
        rid, tk, dt_str, vol = r
        avg = avg_vol_map.get(tk, 0)
        if vol == 0:
            zero_vol_count += 1
            vol_anomalies.append({"id": rid, "ticker": tk, "date": dt_str,
                                  "volume": 0, "type": "zero_volume"})
        elif avg > 0 and vol > 10 * avg:
            spike_count += 1
            vol_anomalies.append({"id": rid, "ticker": tk, "date": dt_str,
                                  "volume": vol, "avg_volume": round(avg, 2),
                                  "ratio": round(vol / avg, 2),
                                  "type": "spike_10x_avg"})
        if len(vol_anomalies) > 5000:
            break  # safety – avoid runaway memory
    pct_vol = (len(vol_anomalies) / total_rows * 100) if total_rows else 0
    out["checks"]["volume_anomalies"] = {
        "status": "PASS" if not vol_anomalies else "FAIL",
        "zero_volume_count": zero_vol_count,
        "spike_10x_avg_count": spike_count,
        "total_anomalies": len(vol_anomalies),
        "pct_of_rows": round(pct_vol, 4),
        "examples": _ex(vol_anomalies),
    }

    conn.close()

    # ---- overall phase status --------------------------------------------
    failed = [k for k, v in out["checks"].items() if v["status"] != "PASS"]
    total_problems = sum(v.get("count", v.get("total_anomalies", 0))
                         for v in out["checks"].values())
    pct_problems = (total_problems / total_rows * 100) if total_rows else 0
    if not failed:
        out["status"] = "PASS"
    elif pct_problems > 5:
        out["status"] = "FAIL"
    else:
        out["status"] = "FAIL" if any(c["status"] == "FAIL"
                                      for c in out["checks"].values()) else "PASS"
    return out


# =============================================================================
# PHASE 1.3 - Entry/Exit Price Sanity
# =============================================================================
def _is_buy(signal: str | None) -> bool:
    s = (signal or "").upper().strip()
    return s in {"BUY", "STRONG_BUY", "ACCUMULATE", "LONG"}


def _is_sell(signal: str | None) -> bool:
    s = (signal or "").upper().strip()
    return s in {"SELL", "STRONG_SELL", "SHORT"}


def phase_1_3() -> dict:
    out: dict = {"phase": "1.3", "name": "Entry/Exit Price Sanity",
                 "db": PRED_DB_PATH, "checks": {}}

    conn = _open_ro(PRED_DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("PRAGMA table_info(predictions)")
    schema = [dict(r) for r in cur.fetchall()]
    out["schema"] = schema

    cur.execute("SELECT COUNT(*) FROM predictions")
    total_rows = cur.fetchone()[0]
    out["total_rows"] = total_rows

    # Pull everything we need in one shot
    cur.execute("""
        SELECT id, ticker, signal, entry_price, target_price, stop_loss,
               exit_price, actual_return, hit_target, hit_stop,
               highest_price, lowest_price, actual_exit_price,
               pnl_percent, pnl_pct
        FROM predictions
    """)
    rows = [dict(r) for r in cur.fetchall()]

    # 1. entry_price > 0 ------------------------------------------------------
    bad_entry = [r for r in rows
                 if r["entry_price"] is None or r["entry_price"] <= 0]
    out["checks"]["entry_price_positive"] = {
        "status": "PASS" if not bad_entry else "FAIL",
        "count": len(bad_entry),
        "examples": _ex([{"id": r["id"], "ticker": r["ticker"],
                          "signal": r["signal"],
                          "entry_price": r["entry_price"]} for r in bad_entry]),
    }

    # 2. stop_loss sensible --------------------------------------------------
    bad_stop = []
    for r in rows:
        ep, sl, sig = r["entry_price"], r["stop_loss"], r["signal"]
        if sl is None or ep is None:
            continue
        if _is_buy(sig) and not (sl < ep):
            bad_stop.append({**r, "reason": "BUY requires stop_loss < entry_price"})
        elif _is_sell(sig) and not (sl > ep):
            bad_stop.append({**r, "reason": "SELL requires stop_loss > entry_price"})
    out["checks"]["stop_loss_sensible"] = {
        "status": "PASS" if not bad_stop else "FAIL",
        "count": len(bad_stop),
        "examples": _ex([{"id": r["id"], "ticker": r["ticker"],
                          "signal": r["signal"], "entry_price": r["entry_price"],
                          "stop_loss": r["stop_loss"],
                          "reason": r["reason"]} for r in bad_stop]),
    }

    # 3. target_price sensible ----------------------------------------------
    bad_target = []
    for r in rows:
        ep, tp, sig = r["entry_price"], r["target_price"], r["signal"]
        if tp is None or ep is None:
            continue
        if _is_buy(sig) and not (tp > ep):
            bad_target.append({**r, "reason": "BUY requires target_price > entry_price"})
        elif _is_sell(sig) and not (tp < ep):
            bad_target.append({**r, "reason": "SELL requires target_price < entry_price"})
    out["checks"]["target_price_sensible"] = {
        "status": "PASS" if not bad_target else "FAIL",
        "count": len(bad_target),
        "examples": _ex([{"id": r["id"], "ticker": r["ticker"],
                          "signal": r["signal"], "entry_price": r["entry_price"],
                          "target_price": r["target_price"],
                          "reason": r["reason"]} for r in bad_target]),
    }

    # 4. exit_price > 0 ------------------------------------------------------
    # exit_price can be NULL for still-active predictions - flag only non-NULL <=0
    bad_exit = [r for r in rows
                if r["exit_price"] is not None and r["exit_price"] <= 0]
    null_exit = [r for r in rows if r["exit_price"] is None]
    out["checks"]["exit_price_positive"] = {
        "status": "PASS" if not bad_exit else "FAIL",
        "count": len(bad_exit),
        "null_exit_price_active_count": len(null_exit),
        "examples": _ex([{"id": r["id"], "ticker": r["ticker"],
                          "exit_price": r["exit_price"]} for r in bad_exit]),
    }

    # 5. return calc & HARD cap |return| <= 50 --------------------------------
    bad_return = []
    for r in rows:
        ep, tp, sl = r["entry_price"], r["target_price"], r["stop_loss"]
        ht, hs = r["hit_target"], r["hit_stop"]
        calc_ret = None
        if ht == 1 and tp and ep:
            calc_ret = (tp - ep) / ep * 100
        elif hs == 1 and sl and ep:
            calc_ret = (sl - ep) / ep * 100
        if calc_ret is not None and abs(calc_ret) > RETURN_HARD_CAP:
            bad_return.append({
                "id": r["id"], "ticker": r["ticker"], "signal": r["signal"],
                "entry_price": ep, "target_price": tp, "stop_loss": sl,
                "hit_target": ht, "hit_stop": hs,
                "calc_return_pct": round(calc_ret, 4),
                "stored_actual_return": r["actual_return"],
            })
    out["checks"]["return_calculation_cap"] = {
        "status": "PASS" if not bad_return else "FAIL",
        "hard_cap": RETURN_HARD_CAP,
        "count": len(bad_return),
        "examples": _ex(bad_return),
    }

    # 6. highest_price vs target --------------------------------------------
    bad_high = []
    for r in rows:
        hp, tp, ht = r["highest_price"], r["target_price"], r["hit_target"]
        if hp is None or tp is None:
            continue
        if hp > tp and ht != 1:
            bad_high.append({
                "id": r["id"], "ticker": r["ticker"], "signal": r["signal"],
                "entry_price": r["entry_price"], "target_price": tp,
                "highest_price": hp, "hit_target": ht,
            })
    out["checks"]["highest_vs_target"] = {
        "status": "PASS" if not bad_high else "FAIL",
        "count": len(bad_high),
        "examples": _ex(bad_high),
    }

    # 7. lowest_price vs stop -----------------------------------------------
    bad_low = []
    for r in rows:
        lp, sl, hs = r["lowest_price"], r["stop_loss"], r["hit_stop"]
        if lp is None or sl is None:
            continue
        if lp < sl and hs != 1:
            bad_low.append({
                "id": r["id"], "ticker": r["ticker"], "signal": r["signal"],
                "entry_price": r["entry_price"], "stop_loss": sl,
                "lowest_price": lp, "hit_stop": hs,
            })
    out["checks"]["lowest_vs_stop"] = {
        "status": "PASS" if not bad_low else "FAIL",
        "count": len(bad_low),
        "examples": _ex(bad_low),
    }

    conn.close()

    # overall phase status
    failed = [k for k, v in out["checks"].items() if v["status"] != "PASS"]
    total_problems = sum(v.get("count", 0) for v in out["checks"].values())
    pct_problems = (total_problems / total_rows * 100) if total_rows else 0
    out["failed_checks"] = failed
    out["total_problems"] = total_problems
    out["pct_problems"] = round(pct_problems, 2)
    if not failed:
        out["status"] = "PASS"
    elif pct_problems > 5:
        out["status"] = "FAIL"
    else:
        out["status"] = "FAIL"  # any sanity violation = FAIL
    return out


# =============================================================================
# Entry point
# =============================================================================
def main() -> int:
    report = {
        "agent": "PHASE 1.2 + 1.3 Audit Agent",
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "dataset_md5_declared": DECLARED_MD5,
        "dataset_md5_observed_price_history": md5_of(PRICE_DB_PATH),
        "dataset_md5_observed_predictions":   md5_of(PRED_DB_PATH),
        "today": TODAY.isoformat(),
    }

    # Phase 1.2
    try:
        report["phase_1_2"] = phase_1_2()
    except FileNotFoundError as e:
        report["phase_1_2"] = {"phase": "1.2", "status": "BLOCKED",
                              "error": f"DB missing: {e}"}
    except Exception as e:
        report["phase_1_2"] = {"phase": "1.2", "status": "BLOCKED",
                              "error": f"{type(e).__name__}: {e}"}

    # Phase 1.3
    try:
        report["phase_1_3"] = phase_1_3()
    except FileNotFoundError as e:
        report["phase_1_3"] = {"phase": "1.3", "status": "BLOCKED",
                              "error": f"DB missing: {e}"}
    except Exception as e:
        report["phase_1_3"] = {"phase": "1.3", "status": "BLOCKED",
                              "error": f"{type(e).__name__}: {e}"}

    # Overall
    s12 = report["phase_1_2"].get("status", "BLOCKED")
    s13 = report["phase_1_3"].get("status", "BLOCKED")
    if s12 == "PASS" and s13 == "PASS":
        report["status"] = "PASS"
        report["next_phase_allowed"] = True
    elif "BLOCKED" in (s12, s13):
        report["status"] = "BLOCKED"
        report["next_phase_allowed"] = False
    else:
        report["status"] = "FAIL"
        report["next_phase_allowed"] = False

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=_serialise)

    # Console summary
    print("=" * 78)
    print("PHASE 1.2 + 1.3 AUDIT REPORT")
    print("=" * 78)
    print(f"Declared dataset MD5 : {DECLARED_MD5}")
    print(f"price_history.db MD5 : {report['dataset_md5_observed_price_history']}")
    print(f"predictions.db  MD5  : {report['dataset_md5_observed_predictions']}")
    print(f"PHASE 1.2 status     : {s12}")
    print(f"PHASE 1.3 status     : {s13}")
    print(f"OVERALL              : {report['status']}")
    print(f"NEXT_PHASE_ALLOWED   : {report['next_phase_allowed']}")
    print(f"Report written to    : {REPORT_PATH}")
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
