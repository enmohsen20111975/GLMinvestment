#!/usr/bin/env python3
"""
PHASE 2.4 — Regime Breakdown Audit
==================================
Goal: Compute KPIs per market regime (Bull / Bear / Range) × channel
(balanced / morning_bell) using the gold-standard return methodology.

Regime Detection
----------------
EGX30 historical series is not available (only a single snapshot in
stocks.db.market_indices). EGX30ETF data stops at 2026-06-03, before the
end of the prediction window. We therefore use the documented proxy:

    proxy(t) = mean over all EGX tickers of  daily_return(ticker, t)
              = (close - prev_close) / prev_close * 100

We then compute a 20-day rolling SMA of proxy(t) and tag each trading
day t in [2026-01-01 .. 2026-08-17]:
    Bull  : SMA20 > +0.30%
    Bear  : SMA20 < -0.30%
    Range : -0.30% <= SMA20 <= +0.30%

Return Methodology (gold standard — same as Phase 1 gate)
----------------------------------------------------------
For each prediction row in predictions.db.predictions:
    hit_target=1 ->  ret = (target_price - entry_price) / entry_price * 100
    hit_stop  =1 ->  ret = (stop_loss   - entry_price) / entry_price * 100
    expired/no hit -> ret = None
    HARD cap: ABS(ret) <= 50  (ret is set to None if |ret| > 50)
    dedup key: ticker | prediction_date | channel(morning_bell) | entry_price(4dp)
               -> keep MIN(id) per group; extras excluded.

KPIs per regime × channel
-------------------------
    n_raw    : count of rows before dedup/cap
    n_valid  : count of rows with a non-null, HARD-capped return
    win_rate : wins / n_valid   (win = ret > 0)
    profit_factor : sum(wins) / |sum(losses)|   (None if denom==0)
    expectancy    : mean(ret) over n_valid
    avg_win       : mean(ret | ret > 0)
    avg_loss      : mean(ret | ret < 0)        (reported as negative)
    max_loss      : min(ret)                   (reported as negative or None)
    max_win       : max(ret)

Channels:
    balanced     = morning_bell == 0
    morning_bell = morning_bell == 1

Output: scripts/audit_phase2_regime.json
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths & constants (READ-ONLY on DBs)
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(ROOT, "db")
PRICE_DB = os.path.join(DB_DIR, "price_history.db")
PRED_DB = os.path.join(DB_DIR, "predictions.db")
OUT_JSON = os.path.join(ROOT, "scripts", "audit_phase2_regime.json")

# Window
PRED_START = "2026-01-01"
PRED_END = "2026-08-17"
# We need 20 trading days of warmup before PRED_START to seed SMA20
WARMUP_START = "2025-09-01"

SMA_WINDOW = 20          # trading days
BULL_TH = 0.30           # +0.30 %
BEAR_TH = -0.30          # -0.30 %
HARD_CAP = 50.0          # |ret| <= 50 (predictions)

# Per-stock daily-return sanity cap for the regime proxy.
# EGX daily price limit is +/-10%; allow +/-20% buffer for stale-price
# jumps, splits, and source-scale mismatches (egksco/yfinance_autofill vs
# egx_investment_migration close scale). Returns outside this band are
# excluded from the proxy mean.
PROXY_RET_CAP_PCT = 20.0


def _open_ro(path: str) -> sqlite3.Connection:
    """Open DB read-only via URI."""
    uri = f"file:{path}?mode=ro"
    return sqlite3.connect(uri, uri=True)


# ---------------------------------------------------------------------------
# 1. Regime detection
# ---------------------------------------------------------------------------
def detect_regimes() -> Tuple[
    Dict[str, str], Dict[str, float], Dict[str, int], Dict[str, float], int, int
]:
    """Return (regime_by_date, sma_by_date, n_stocks_per_date, median_ret_per_date,
    n_total_returns, n_capped) for dates in [PRED_START, PRED_END]."""

    con = _open_ro(PRICE_DB)
    cur = con.cursor()

    # Pull (ticker, date, close) for the warmup + prediction window
    rows = cur.execute(
        """
        SELECT ticker, date, close_price
        FROM price_history
        WHERE date BETWEEN ? AND ?
          AND close_price IS NOT NULL
          AND close_price > 0
        ORDER BY ticker, date
        """,
        (WARMUP_START, PRED_END),
    ).fetchall()
    con.close()

    # Group closes per ticker -> compute daily returns per ticker
    by_ticker: Dict[str, List[Tuple[str, float]]] = defaultdict(list)
    for ticker, date, close in rows:
        by_ticker[ticker].append((date, float(close)))

    # For each ticker, sort by date and compute daily_return % from prev close
    # daily_return[ticker, date] = (close - prev_close) / prev_close * 100
    # Filter out per-stock returns whose magnitude exceeds PROXY_RET_CAP_PCT
    # to exclude stale-price jumps, splits, and source-scale mismatches.
    daily_returns: Dict[str, List[Tuple[str, float]]] = defaultdict(list)
    n_capped: int = 0
    n_total_returns: int = 0
    for ticker, seq in by_ticker.items():
        seq.sort(key=lambda x: x[0])
        prev_close: Optional[float] = None
        for date, close in seq:
            if prev_close is not None and prev_close > 0:
                ret = (close - prev_close) / prev_close * 100.0
                n_total_returns += 1
                if abs(ret) <= PROXY_RET_CAP_PCT:
                    daily_returns[date].append(ret)
                else:
                    n_capped += 1
            prev_close = close

    # Build a sorted list of distinct trading dates that fall in [warmup..end]
    all_dates = sorted(daily_returns.keys())

    # Compute proxy(t) = mean(daily_return[ticker, t]) across tickers
    # Also keep median (robustness check) — not used for tagging but reported.
    proxy: List[Tuple[str, float, float, int]] = []  # (date, mean, median, n)
    for date in all_dates:
        rs = daily_returns[date]
        if rs:
            rs_sorted = sorted(rs)
            n = len(rs_sorted)
            med = rs_sorted[n // 2] if n % 2 == 1 else (rs_sorted[n // 2 - 1] + rs_sorted[n // 2]) / 2
            proxy.append((date, sum(rs) / n, med, n))

    # Rolling SMA(20) of proxy mean
    regime_by_date: Dict[str, str] = {}
    sma_by_date: Dict[str, float] = {}
    n_stocks_per_date: Dict[str, int] = {}
    median_ret_per_date: Dict[str, float] = {}

    for i, (date, p, med, n) in enumerate(proxy):
        n_stocks_per_date[date] = n
        median_ret_per_date[date] = med
        if i + 1 < SMA_WINDOW:
            continue  # not enough warmup
        window = proxy[i + 1 - SMA_WINDOW : i + 1]
        sma = sum(w[1] for w in window) / SMA_WINDOW
        sma_by_date[date] = sma
        # only tag dates in prediction window
        if PRED_START <= date <= PRED_END:
            if sma > BULL_TH:
                regime = "bull"
            elif sma < BEAR_TH:
                regime = "bear"
            else:
                regime = "range"
            regime_by_date[date] = regime

    return regime_by_date, sma_by_date, n_stocks_per_date, median_ret_per_date, n_total_returns, n_capped


# ---------------------------------------------------------------------------
# 1b. Sensitivity regime detection using EGX30ETF (direct EGX30 index tracker)
# ---------------------------------------------------------------------------
# The user spec says "use EGX30 index trend (if available) OR mean of all
# stocks". The strict literal reading is that the EGX30 index daily series is
# NOT available (only a single snapshot in stocks.db.market_indices), so the
# proxy (mean of all stocks) is used. That proxy yields "range" for every
# trading day in the prediction window because averaging across 750+ tickers
# cancels out market-wide moves.
#
# As a SENSITIVITY CHECK, we also detect regimes using EGX30ETF — the ETF
# listed in price_history that tracks the EGX30 index — for dates where its
# daily series is available, falling back to the proxy mean for dates where
# the ETF data is missing. This produces a meaningful Bull/Bear/Range split.


def detect_regimes_egx30etf(
    proxy_sma_by_date: Dict[str, float],
) -> Tuple[Dict[str, str], Dict[str, float], Dict[str, str]]:
    """Return (regime_by_date, sma_by_date, source_by_date).

    For each date in [PRED_START, PRED_END]:
      - If EGX30ETF has at least 20 prior closes (so 20-day SMA is computable),
        use the ETF daily-return 20-day SMA.
      - Otherwise, fall back to the proxy mean SMA20 (already computed).
    """
    con = _open_ro(PRICE_DB)
    cur = con.cursor()
    rows = cur.execute(
        """
        SELECT date, close_price
        FROM price_history
        WHERE ticker = 'EGX30ETF'
          AND date BETWEEN ? AND ?
          AND close_price IS NOT NULL
          AND close_price > 0
        ORDER BY date
        """,
        (WARMUP_START, PRED_END),
    ).fetchall()
    con.close()

    # Build daily-return series
    etf_daily: List[Tuple[str, float]] = []
    prev_close: Optional[float] = None
    for date, close in rows:
        close = float(close)
        if prev_close is not None and prev_close > 0:
            ret = (close - prev_close) / prev_close * 100.0
            etf_daily.append((date, ret))
        prev_close = close

    # Rolling SMA20 of ETF daily returns
    sma_by_date: Dict[str, float] = {}
    source_by_date: Dict[str, str] = {}
    for i, (date, _) in enumerate(etf_daily):
        if i + 1 < SMA_WINDOW:
            continue
        window = etf_daily[i + 1 - SMA_WINDOW : i + 1]
        sma = sum(w[1] for w in window) / SMA_WINDOW
        sma_by_date[date] = sma
        source_by_date[date] = "egx30etf"

    # For dates in prediction window where ETF SMA is not available,
    # fall back to the proxy mean SMA20.
    for d, sma in proxy_sma_by_date.items():
        if PRED_START <= d <= PRED_END and d not in sma_by_date:
            sma_by_date[d] = sma
            source_by_date[d] = "proxy_fallback"

    # Tag regimes for dates in prediction window
    regime_by_date: Dict[str, str] = {}
    for d in sorted(sma_by_date.keys()):
        if not (PRED_START <= d <= PRED_END):
            continue
        sma = sma_by_date[d]
        if sma > BULL_TH:
            regime = "bull"
        elif sma < BEAR_TH:
            regime = "bear"
        else:
            regime = "range"
        regime_by_date[d] = regime

    return regime_by_date, sma_by_date, source_by_date


# ---------------------------------------------------------------------------
# 2. Tag each prediction & compute gold-standard return
# ---------------------------------------------------------------------------
def load_predictions() -> List[Dict[str, Any]]:
    con = _open_ro(PRED_DB)
    cur = con.cursor()
    rows = cur.execute(
        """
        SELECT id, ticker, prediction_date, entry_price, target_price,
               stop_loss, hit_target, hit_stop, morning_bell, signal
        FROM predictions
        WHERE prediction_date BETWEEN ? AND ?
        """,
        (PRED_START, PRED_END),
    ).fetchall()
    con.close()

    preds: List[Dict[str, Any]] = []
    for r in rows:
        (pid, ticker, pdate, entry, target, stop,
         ht, hs, mb, signal) = r
        preds.append(
            {
                "id": pid,
                "ticker": ticker,
                "prediction_date": pdate,
                "entry_price": float(entry) if entry is not None else None,
                "target_price": float(target) if target is not None else None,
                "stop_loss": float(stop) if stop is not None else None,
                "hit_target": int(ht) if ht is not None else 0,
                "hit_stop": int(hs) if hs is not None else 0,
                "morning_bell": int(mb) if mb is not None else 0,
                "signal": signal,
            }
        )
    return preds


def gold_return(pred: Dict[str, Any]) -> Optional[float]:
    """Gold-standard return; None if expired/no-hit or invalid inputs."""
    if pred["entry_price"] in (None, 0):
        return None
    entry = pred["entry_price"]
    ht = pred["hit_target"]
    hs = pred["hit_stop"]

    if ht == 1 and hs == 1:
        # ambiguous — both flags set. Skip.
        return None

    if ht == 1:
        if pred["target_price"] is None:
            return None
        ret = (pred["target_price"] - entry) / entry * 100.0
    elif hs == 1:
        if pred["stop_loss"] is None:
            return None
        ret = (pred["stop_loss"] - entry) / entry * 100.0
    else:
        # expired no hit
        return None

    # HARD cap: |ret| <= 50
    if abs(ret) > HARD_CAP:
        return None
    return ret


def dedup(preds: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Dedup on (ticker, prediction_date, channel=morning_bell, entry_price@4dp).
    Keep MIN(id) per group. Return (deduped_preds, n_excluded)."""
    groups: Dict[Tuple[str, str, int, float], List[Dict[str, Any]]] = defaultdict(list)
    for p in preds:
        if p["entry_price"] is None:
            # if entry missing, key on None placeholder (rare/never)
            key = (p["ticker"], p["prediction_date"], p["morning_bell"], None)
        else:
            key = (
                p["ticker"],
                p["prediction_date"],
                p["morning_bell"],
                round(p["entry_price"], 4),
            )
        groups[key].append(p)

    deduped: List[Dict[str, Any]] = []
    n_excluded = 0
    for key, group in groups.items():
        # keep MIN(id)
        group.sort(key=lambda x: x["id"])
        deduped.append(group[0])
        n_excluded += len(group) - 1
    return deduped, n_excluded


# ---------------------------------------------------------------------------
# 3. KPI aggregation
# ---------------------------------------------------------------------------
def kpis(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    n_raw = len(rows)
    valid = [r for r in rows if r["ret"] is not None]
    n_valid = len(valid)
    wins = [r["ret"] for r in valid if r["ret"] > 0]
    losses = [r["ret"] for r in valid if r["ret"] < 0]

    sum_wins = sum(wins)
    sum_losses = sum(losses)  # negative
    profit_factor = (sum_wins / abs(sum_losses)) if sum_losses != 0 else None
    win_rate = (len(wins) / n_valid) if n_valid else None
    expectancy = (sum(r["ret"] for r in valid) / n_valid) if n_valid else None
    avg_win = (sum_wins / len(wins)) if wins else None
    avg_loss = (sum_losses / len(losses)) if losses else None
    max_win = max(wins) if wins else None
    max_loss = min(losses) if losses else None

    return {
        "n_raw": n_raw,
        "n_valid": n_valid,
        "win_rate": round(win_rate, 6) if win_rate is not None else None,
        "profit_factor": round(profit_factor, 6) if profit_factor is not None else None,
        "expectancy": round(expectancy, 6) if expectancy is not None else None,
        "avg_win": round(avg_win, 6) if avg_win is not None else None,
        "avg_loss": round(avg_loss, 6) if avg_loss is not None else None,
        "max_win": round(max_win, 6) if max_win is not None else None,
        "max_loss": round(max_loss, 6) if max_loss is not None else None,
        "n_wins": len(wins),
        "n_losses": len(losses),
    }


def main() -> None:
    # ------------------------------------------------------------------
    # 1) Regimes
    # ------------------------------------------------------------------
    (
        regime_by_date,
        sma_by_date,
        n_stocks_per_date,
        median_ret_per_date,
        n_total_returns,
        n_capped,
    ) = detect_regimes()

    # Trading-day distribution in prediction window
    trading_days_in_window = sorted(
        d for d in n_stocks_per_date if PRED_START <= d <= PRED_END
    )
    regime_day_counts = {"bull": 0, "bear": 0, "range": 0}
    for d in trading_days_in_window:
        r = regime_by_date.get(d)
        if r:
            regime_day_counts[r] += 1

    # ------------------------------------------------------------------
    # 2) Predictions + dedup + return
    # ------------------------------------------------------------------
    preds = load_predictions()
    preds_deduped, n_excluded = dedup(preds)

    # Tag regime & compute return
    no_regime_dates: set = set()
    for p in preds_deduped:
        d = p["prediction_date"]
        reg = regime_by_date.get(d)
        p["regime"] = reg
        if reg is None:
            no_regime_dates.add(d)
        p["ret"] = gold_return(p)

    # ------------------------------------------------------------------
    # 3) KPIs per regime × channel
    # ------------------------------------------------------------------
    regimes_out: Dict[str, Dict[str, Any]] = {}
    for reg_name in ["bull", "bear", "range"]:
        reg_rows = [p for p in preds_deduped if p["regime"] == reg_name]
        balanced = [p for p in reg_rows if p["morning_bell"] == 0]
        mb = [p for p in reg_rows if p["morning_bell"] == 1]
        regimes_out[reg_name] = {
            "predictions_count": len(reg_rows),
            "balanced": kpis(balanced),
            "morning_bell": kpis(mb),
        }

    # Aggregate (all regimes) for reference
    regimes_out["all"] = {
        "predictions_count": len(preds_deduped),
        "balanced": kpis([p for p in preds_deduped if p["morning_bell"] == 0]),
        "morning_bell": kpis([p for p in preds_deduped if p["morning_bell"] == 1]),
    }

    # ------------------------------------------------------------------
    # 3b) Sensitivity: EGX30ETF-based regime detection
    # ------------------------------------------------------------------
    etf_regime_by_date, etf_sma_by_date, etf_source_by_date = detect_regimes_egx30etf(
        sma_by_date
    )

    # Tag each prediction with the ETF-based regime
    for p in preds_deduped:
        d = p["prediction_date"]
        p["regime_etf"] = etf_regime_by_date.get(d)

    # ETF-based regime day distribution
    etf_regime_day_counts = {"bull": 0, "bear": 0, "range": 0}
    etf_source_counts = {"egx30etf": 0, "proxy_fallback": 0}
    for d in trading_days_in_window:
        r = etf_regime_by_date.get(d)
        if r:
            etf_regime_day_counts[r] += 1
        src = etf_source_by_date.get(d)
        if src:
            etf_source_counts[src] += 1

    # KPIs per ETF-regime × channel
    etf_regimes_out: Dict[str, Dict[str, Any]] = {}
    for reg_name in ["bull", "bear", "range"]:
        reg_rows = [p for p in preds_deduped if p["regime_etf"] == reg_name]
        balanced = [p for p in reg_rows if p["morning_bell"] == 0]
        mb = [p for p in reg_rows if p["morning_bell"] == 1]
        etf_regimes_out[reg_name] = {
            "predictions_count": len(reg_rows),
            "balanced": kpis(balanced),
            "morning_bell": kpis(mb),
        }
    etf_regimes_out["all"] = {
        "predictions_count": len(preds_deduped),
        "balanced": kpis([p for p in preds_deduped if p["morning_bell"] == 0]),
        "morning_bell": kpis([p for p in preds_deduped if p["morning_bell"] == 1]),
    }

    # ------------------------------------------------------------------
    # 4) Write JSON
    # ------------------------------------------------------------------
    out: Dict[str, Any] = {
        "phase": "2.4",
        "audit_name": "regime_breakdown",
        "dataset_md5": "0947bdf6c2eff1a75ff8af6c3e576ed8",
        "dataset_md5_source": "data/active_databases_20260817_full.zip",
        "regime_detection_method": (
            "proxy: avg daily return of all EGX stocks, 20-day SMA "
            "(EGX30 historical series unavailable; only snapshot in "
            "stocks.db.market_indices)"
        ),
        "window": {"start": PRED_START, "end": PRED_END},
        "thresholds_pct": {"bull_gt": BULL_TH, "bear_lt": BEAR_TH, "sma_window": SMA_WINDOW},
        "proxy_ret_cap_pct": PROXY_RET_CAP_PCT,
        "proxy_total_returns_input": n_total_returns,
        "proxy_returns_capped_out": n_capped,
        "hard_cap_abs_return": HARD_CAP,
        "dedup_key": "ticker|prediction_date|channel(morning_bell)|entry_price(4dp)",
        "return_formula": {
            "hit_target=1": "(target_price - entry_price)/entry_price*100",
            "hit_stop=1": "(stop_loss - entry_price)/entry_price*100",
            "expired_no_hit": "null",
        },
        "regime_day_distribution": regime_day_counts,
        "trading_days_in_window": len(trading_days_in_window),
        "predictions_raw": len(preds),
        "predictions_after_dedup": len(preds_deduped),
        "duplicates_excluded": n_excluded,
        "predictions_without_regime_tag": sum(
            1 for p in preds_deduped if p["regime"] is None
        ),
        "no_regime_dates_sample": sorted(no_regime_dates)[:10],
        "regimes": regimes_out,
        # A few diagnostic SMA samples for transparency
        "sma_samples": [
            {
                "date": d,
                "sma20_pct": round(sma_by_date[d], 6),
                "median_ret_pct": round(median_ret_per_date.get(d, 0.0), 6),
                "regime": regime_by_date.get(d),
                "n_stocks_avg": n_stocks_per_date.get(d),
            }
            for d in list(regime_by_date.keys())[:: max(1, len(regime_by_date) // 12)]
        ][:12],
        # Sensitivity: EGX30ETF-based regime detection
        "sensitivity_egx30etf": {
            "method": (
                "EGX30ETF daily-return 20-day SMA (ETF directly tracks the "
                "EGX30 index). Falls back to the proxy mean SMA20 when ETF "
                "data is missing (e.g. after 2026-06-03)."
            ),
            "regime_day_distribution": etf_regime_day_counts,
            "source_distribution": etf_source_counts,
            "regimes": etf_regimes_out,
            "sma_samples": [
                {
                    "date": d,
                    "sma20_pct": round(etf_sma_by_date[d], 6),
                    "regime": etf_regime_by_date.get(d),
                    "source": etf_source_by_date.get(d),
                }
                for d in list(etf_regime_by_date.keys())[
                    :: max(1, len(etf_regime_by_date) // 12)
                ]
            ][:12],
        },
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"[ok] wrote {OUT_JSON}")

    # ------------------------------------------------------------------
    # Console summary
    # ------------------------------------------------------------------
    print("\n=== Regime day distribution (trading days in window) ===")
    for k, v in regime_day_counts.items():
        print(f"  {k:6s}: {v}  days")
    print(f"  total trading days in window: {len(trading_days_in_window)}")
    print(f"  trading days with regime tag: {sum(regime_day_counts.values())}")

    print("\n=== Predictions ===")
    print(f"  raw:               {len(preds)}")
    print(f"  after dedup:       {len(preds_deduped)}  (excluded {n_excluded} dup)")
    print(f"  no regime tag:     {sum(1 for p in preds_deduped if p['regime'] is None)}")

    print("\n=== KPIs per regime × channel (PRIMARY: proxy mean of all stocks) ===")
    header = (
        f"{'regime':7s} {'channel':12s} {'n_raw':>6s} {'n_valid':>7s} "
        f"{'win%':>7s} {'PF':>6s} {'expect':>8s} {'avgW':>7s} "
        f"{'avgL':>7s} {'maxW':>7s} {'maxL':>7s}"
    )
    print(header)
    print("-" * len(header))
    for reg_name in ["bull", "bear", "range", "all"]:
        block = regimes_out[reg_name]
        for ch in ["balanced", "morning_bell"]:
            k = block[ch]
            wr = f"{k['win_rate']*100:.1f}" if k['win_rate'] is not None else "  -  "
            pf = f"{k['profit_factor']:.2f}" if k['profit_factor'] is not None else "  -  "
            ex = f"{k['expectancy']:.3f}" if k['expectancy'] is not None else "   -   "
            aw = f"{k['avg_win']:.3f}" if k['avg_win'] is not None else "   -   "
            al = f"{k['avg_loss']:.3f}" if k['avg_loss'] is not None else "   -   "
            mw = f"{k['max_win']:.3f}" if k['max_win'] is not None else "   -   "
            ml = f"{k['max_loss']:.3f}" if k['max_loss'] is not None else "   -   "
            print(
                f"{reg_name:7s} {ch:12s} {k['n_raw']:>6d} {k['n_valid']:>7d} "
                f"{wr:>7s} {pf:>6s} {ex:>8s} {aw:>7s} {al:>7s} {mw:>7s} {ml:>7s}"
            )

    print("\n=== Sensitivity: EGX30ETF-based regime day distribution ===")
    for k, v in etf_regime_day_counts.items():
        print(f"  {k:6s}: {v}  days")
    print(f"  source: {etf_source_counts}")

    print("\n=== KPIs per regime × channel (SENSITIVITY: EGX30ETF) ===")
    print(header)
    print("-" * len(header))
    for reg_name in ["bull", "bear", "range", "all"]:
        block = etf_regimes_out[reg_name]
        for ch in ["balanced", "morning_bell"]:
            k = block[ch]
            wr = f"{k['win_rate']*100:.1f}" if k['win_rate'] is not None else "  -  "
            pf = f"{k['profit_factor']:.2f}" if k['profit_factor'] is not None else "  -  "
            ex = f"{k['expectancy']:.3f}" if k['expectancy'] is not None else "   -   "
            aw = f"{k['avg_win']:.3f}" if k['avg_win'] is not None else "   -   "
            al = f"{k['avg_loss']:.3f}" if k['avg_loss'] is not None else "   -   "
            mw = f"{k['max_win']:.3f}" if k['max_win'] is not None else "   -   "
            ml = f"{k['max_loss']:.3f}" if k['max_loss'] is not None else "   -   "
            print(
                f"{reg_name:7s} {ch:12s} {k['n_raw']:>6d} {k['n_valid']:>7d} "
                f"{wr:>7s} {pf:>6s} {ex:>8s} {aw:>7s} {al:>7s} {mw:>7s} {ml:>7s}"
            )


if __name__ == "__main__":
    main()
