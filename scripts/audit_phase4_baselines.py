#!/usr/bin/env python3
"""
PHASE 4 Audit Agent — Baseline Challenge.

Compares GLMinvestment (balanced channel, morning_bell=0) against 5 simple
baselines to determine whether the "edge" is real or just complexity noise.

READ-ONLY on DBs (uses URI mode=ro).
Output: scripts/audit_phase4_baselines.json
"""
from __future__ import annotations

import json
import random
import re
import sqlite3
import statistics
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path("/home/z/my-project")
PRED_DB = f"file:{PROJECT_ROOT}/db/predictions.db?mode=ro"
PRICE_DB = f"file:{PROJECT_ROOT}/db/price_history.db?mode=ro"
OUT_JSON = PROJECT_ROOT / "scripts" / "audit_phase4_baselines.json"

# Exit logic proxy (per task spec)
TP_PCT = 8.0   # +8% take-profit
SL_PCT = -6.0  # -6% stop-loss
MC_RUNS = 1000  # Monte Carlo runs for Baseline A
RANDOM_SEED = 20240819

# Universe filter — same universe as GLMinvestment predictions
PERSONA = "balanced"
MORNING_BELL = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def connect(db_uri: str) -> sqlite3.Connection:
    return sqlite3.connect(db_uri, uri=True)


def compute_kpis(returns: list[float]) -> dict:
    """Compute n, WR, PF, Exp, MaxLoss from a list of return percentages."""
    n = len(returns)
    if n == 0:
        return {"n": 0, "WR": 0.0, "PF": 0.0, "Exp": 0.0, "MaxLoss": 0.0}
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]
    gross_win = sum(wins)
    gross_loss = -sum(losses)  # positive number
    WR = (len(wins) / n) * 100
    PF = (gross_win / gross_loss) if gross_loss > 0 else float("inf")
    if PF == float("inf"):
        PF = 999.0
    Exp = sum(returns) / n
    MaxLoss = min(returns) if returns else 0.0
    return {
        "n": n,
        "WR": round(WR, 2),
        "PF": round(PF, 3),
        "Exp": round(Exp, 4),
        "MaxLoss": round(MaxLoss, 4),
    }


def load_glm_trades(conn: sqlite3.Connection) -> list[dict]:
    """Load GLMinvestment balanced trades after dedup + quality filter."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, ticker, signal, prediction_date, entry_price, target_price,
               stop_loss, outcome_date, exit_price, actual_return, hit_target,
               hit_stop, holding_days, evidence_count, kill_filter_result
        FROM predictions
        WHERE persona = ? AND morning_bell = ? AND status = 'EXPIRED'
          AND kill_filter_result != ''
        ORDER BY prediction_date, ticker, id
        """,
        (PERSONA, MORNING_BELL),
    )
    rows = cur.fetchall()
    # Dedup by (ticker, prediction_date) — keep first (lowest id)
    seen: set[tuple[str, str]] = set()
    trades: list[dict] = []
    for r in rows:
        key = (r[1], r[3])
        if key in seen:
            continue
        seen.add(key)
        trades.append({
            "id": r[0], "ticker": r[1], "signal": r[2], "prediction_date": r[3],
            "entry_price": r[4], "target_price": r[5], "stop_loss": r[6],
            "outcome_date": r[7], "exit_price": r[8], "actual_return": r[9],
            "hit_target": r[10], "hit_stop": r[11], "holding_days": r[12],
            "evidence_count": r[13], "kill_filter_result": r[14],
        })
    return trades


def get_universe_tickers(trades: list[dict]) -> list[str]:
    return sorted({t["ticker"] for t in trades})


def get_egx_universe(pconn: sqlite3.Connection, start: str, end: str) -> list[str]:
    """
    Build a broad EGX universe by filtering price_history tickers in the GLM
    window. Filters out crypto/forex/metals tickers by price-range sanity check.
    """
    cur = pconn.cursor()
    cur.execute(
        "SELECT DISTINCT ticker FROM price_history WHERE date BETWEEN ? AND ?",
        (start, end),
    )
    all_tickers = [r[0] for r in cur.fetchall()]
    crypto_blocklist = {
        "BTC", "ETH", "XRP", "XLM", "XMR", "ZEC", "ZMID", "ZEOT", "XAUT",
        "ADA", "DOT", "SOL", "DOGE", "LINK", "AVAX", "MATIC", "USDT", "USDC",
        "BNB", "TRX", "HYPE", "USDS", "LEO", "WBT", "CC", "BCH", "TON", "DAI",
        "HBAR", "LTC", "NEAR", "SHIB", "PYUSD", "USYC", "CRO", "USDG", "BUIDL",
    }
    egx = []
    for t in all_tickers:
        if re.fullmatch(r"\d{3,4}", t):
            egx.append(t)
        elif re.fullmatch(r"[A-Z0-9]{2,7}", t) and t not in crypto_blocklist:
            cur.execute(
                "SELECT MAX(close_price), MIN(close_price) FROM price_history "
                "WHERE ticker=? AND date BETWEEN ? AND ?",
                (t, start, end),
            )
            mp, mn = cur.fetchone()
            if mp and mn and 0.5 < mp < 50000 and 0.5 < mn < 50000:
                egx.append(t)
    return sorted(egx)


def get_trading_days(conn: sqlite3.Connection, start: str, end: str) -> list[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT date FROM price_history WHERE date BETWEEN ? AND ? ORDER BY date",
        (start, end),
    )
    return [r[0] for r in cur.fetchall()]


def simulate_trade(
    pconn: sqlite3.Connection,
    ticker: str,
    entry_date: str,
    outcome_date: str,
    *,
    tp_pct: float = TP_PCT,
    sl_pct: float = SL_PCT,
    use_intraday: bool = True,
) -> tuple[float, str] | None:
    """
    Simulate a single BUY trade using TP/SL exit logic.

    Entry: close_price on entry_date.
    Iterate forward each trading day after entry_date up to outcome_date.
      - If high >= entry*(1+tp) and low <= entry*(1+sl): assume SL hit first
        (conservative) → exit at sl_pct.
      - elif high >= entry*(1+tp): exit at +tp_pct.
      - elif low <= entry*(1+sl): exit at +sl_pct.
      - elif date == outcome_date: exit at close_price.
    Returns (return_pct, exit_reason) or None if data missing.
    """
    cur = pconn.cursor()
    cur.execute(
        "SELECT close_price FROM price_history WHERE ticker=? AND date=?",
        (ticker, entry_date),
    )
    row = cur.fetchone()
    if not row or row[0] is None or row[0] <= 0:
        return None
    entry = row[0]
    tp_level = entry * (1 + tp_pct / 100.0)
    sl_level = entry * (1 + sl_pct / 100.0)

    cur.execute(
        """SELECT date, high_price, low_price, close_price
           FROM price_history
           WHERE ticker=? AND date > ? AND date <= ?
           ORDER BY date""",
        (ticker, entry_date, outcome_date),
    )
    ph_rows = cur.fetchall()
    if not ph_rows:
        # No forward data — exit at close on entry_date
        return (0.0, "no_forward_data")

    for d, hi, lo, cl in ph_rows:
        if use_intraday and hi is not None and lo is not None:
            hit_tp = hi >= tp_level
            hit_sl = lo <= sl_level
            if hit_tp and hit_sl:
                # Conservative: assume SL hit first
                return (sl_pct, "SL+TP_same_day_SL")
            elif hit_tp:
                return (tp_pct, "TP")
            elif hit_sl:
                return (sl_pct, "SL")
        # Time-stop on outcome_date
        if d == outcome_date and cl is not None:
            return ((cl / entry - 1) * 100.0, "time_stop")
    # Outcome_date may not have data — fallback to last available close
    last = ph_rows[-1][3]
    if last is not None:
        return ((last / entry - 1) * 100.0, "fallback_close")
    return None


def date_minus_days(date_str: str, days: int) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=days)
    return d.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Baseline A: Random Selection (Monte Carlo)
# ---------------------------------------------------------------------------
def baseline_a_random(
    pconn: sqlite3.Connection,
    universe: list[str],
    trading_days: list[str],
    glm_trades: list[dict],
    n_per_run: int = 108,
    runs: int = MC_RUNS,
    rng: random.Random | None = None,
) -> dict:
    """
    For each MC run: sample n_per_run (ticker, entry_date) pairs from
    universe x trading_days, then simulate using TP/SL exit logic.

    Use the GLM trades' (entry_date, outcome_date) windows to bound max holding.
    We sample one of the GLM trades' windows per random trade so that the
    holding-period distribution matches GLMinvestment's.
    """
    rng = rng or random.Random(RANDOM_SEED)
    # Build a pool of (entry_date, outcome_date) windows from GLM trades
    windows = [(t["prediction_date"], t["outcome_date"]) for t in glm_trades]

    run_returns: list[float] = []  # average return per MC run
    all_kpis = []
    # We need the average KPIs across runs; KPIs are not linear in returns,
    # so we collect per-run returns then average the KPI vector.
    kpi_acc = {"n": 0, "WR": 0.0, "PF": 0.0, "Exp": 0.0, "MaxLoss": 0.0}
    pf_samples = []
    wr_samples = []
    exp_samples = []
    maxloss_samples = []
    for run_idx in range(runs):
        sampled_returns: list[float] = []
        # Sample n_per_run trades
        attempts = 0
        while len(sampled_returns) < n_per_run and attempts < n_per_run * 5:
            attempts += 1
            ticker = rng.choice(universe)
            window = rng.choice(windows)
            entry_date = window[0]
            outcome_date = window[1]
            res = simulate_trade(pconn, ticker, entry_date, outcome_date)
            if res is None:
                continue
            sampled_returns.append(res[0])
        if len(sampled_returns) < n_per_run // 2:
            continue
        kpi = compute_kpis(sampled_returns)
        wr_samples.append(kpi["WR"])
        pf_samples.append(kpi["PF"])
        exp_samples.append(kpi["Exp"])
        maxloss_samples.append(kpi["MaxLoss"])
        run_returns.append(statistics.mean(sampled_returns))

    if not wr_samples:
        return {"n": n_per_run, "WR": 0.0, "PF": 0.0, "Exp": 0.0, "MaxLoss": 0.0, "mc_runs": runs}

    return {
        "n": n_per_run,
        "WR": round(statistics.mean(wr_samples), 2),
        "PF": round(statistics.mean(pf_samples), 3),
        "Exp": round(statistics.mean(exp_samples), 4),
        "MaxLoss": round(statistics.mean(maxloss_samples), 4),
        "mc_runs": len(wr_samples),
        # Confidence intervals (approx)
        "WR_std": round(statistics.pstdev(wr_samples), 2) if len(wr_samples) > 1 else 0.0,
        "PF_std": round(statistics.pstdev(pf_samples), 3) if len(pf_samples) > 1 else 0.0,
        "Exp_std": round(statistics.pstdev(exp_samples), 4) if len(exp_samples) > 1 else 0.0,
    }


# ---------------------------------------------------------------------------
# Baseline B: Momentum Only
# ---------------------------------------------------------------------------
def baseline_b_momentum(
    pconn: sqlite3.Connection,
    universe: list[str],
    prediction_dates: list[str],
    glm_trades: list[dict],
    top_n: int = 3,
) -> dict:
    """
    For each prediction_date: rank universe by 20-day return
    (close today / close 20 trading days ago - 1).
    Pick top_n. Use the GLM trade's outcome_date as time-stop (median holding).
    """
    cur = pconn.cursor()
    # Build mapping: prediction_date -> median outcome_date from GLM trades
    outcomes_by_date: dict[str, list[str]] = {}
    for t in glm_trades:
        outcomes_by_date.setdefault(t["prediction_date"], []).append(t["outcome_date"])
    median_outcome = {}
    for d, ods in outcomes_by_date.items():
        ods_sorted = sorted(ods)
        median_outcome[d] = ods_sorted[len(ods_sorted) // 2]

    # Pre-load price history per ticker (date, close_price) — for momentum calc
    # Get all historical close prices per universe ticker
    ticker_prices: dict[str, dict[str, float]] = {}
    for tk in universe:
        cur.execute(
            "SELECT date, close_price FROM price_history WHERE ticker=? AND close_price IS NOT NULL ORDER BY date",
            (tk,),
        )
        ticker_prices[tk] = {r[0]: r[1] for r in cur.fetchall()}

    returns: list[float] = []
    n_trades = 0
    for pdate in prediction_dates:
        # Compute 20-day return for each ticker: need close_price at pdate and
        # at the trading day 20 days before. We need a sorted list of trading days
        # for each ticker. Approximate: use 20 calendar days before pdate.
        scored = []
        lookback_date = date_minus_days(pdate, 30)  # 30 calendar days back to be safe
        for tk in universe:
            px = ticker_prices.get(tk, {})
            today_close = px.get(pdate)
            # Find the latest close on or before lookback_date
            past_closes = [(d, c) for d, c in px.items() if d <= lookback_date]
            if not past_closes or today_close is None or today_close <= 0:
                continue
            past_closes.sort()
            past_close = past_closes[-1][1]
            if past_close <= 0:
                continue
            ret = (today_close / past_close - 1) * 100
            scored.append((tk, ret))
        scored.sort(key=lambda x: -x[1])  # highest momentum first
        outcome_date = median_outcome.get(pdate, pdate)
        # Pick top_n with positive momentum
        for tk, _ in scored[:top_n]:
            res = simulate_trade(pconn, tk, pdate, outcome_date)
            if res is not None:
                returns.append(res[0])
                n_trades += 1
    return compute_kpis(returns)


# ---------------------------------------------------------------------------
# Baseline C: RVOL Only
# ---------------------------------------------------------------------------
def baseline_c_rvol(
    pconn: sqlite3.Connection,
    universe: list[str],
    prediction_dates: list[str],
    glm_trades: list[dict],
    top_n: int = 3,
) -> dict:
    """
    For each prediction_date: rank universe by RVOL = today_volume / avg_volume_20d.
    """
    cur = pconn.cursor()
    outcomes_by_date: dict[str, list[str]] = {}
    for t in glm_trades:
        outcomes_by_date.setdefault(t["prediction_date"], []).append(t["outcome_date"])
    median_outcome = {}
    for d, ods in outcomes_by_date.items():
        ods_sorted = sorted(ods)
        median_outcome[d] = ods_sorted[len(ods_sorted) // 2]

    # Pre-load full price history per ticker (date, volume, close_price)
    ticker_data: dict[str, dict[str, tuple]] = {}
    for tk in universe:
        cur.execute(
            "SELECT date, volume, close_price FROM price_history WHERE ticker=? ORDER BY date",
            (tk,),
        )
        ticker_data[tk] = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

    returns: list[float] = []
    n_trades = 0
    for pdate in prediction_dates:
        scored = []
        for tk in universe:
            data = ticker_data.get(tk, {})
            today = data.get(pdate)
            if not today or today[0] is None or today[0] <= 0:
                continue
            today_vol = today[0]
            # Compute 20-day average volume: last 20 trading days before pdate
            past = [(d, v) for d, (v, c) in data.items() if d < pdate and v is not None and v > 0]
            past.sort()
            past_20 = past[-20:]
            if len(past_20) < 5:
                continue
            avg_vol = sum(v for _, v in past_20) / len(past_20)
            if avg_vol <= 0:
                continue
            rvol = today_vol / avg_vol
            scored.append((tk, rvol))
        scored.sort(key=lambda x: -x[1])
        outcome_date = median_outcome.get(pdate, pdate)
        for tk, _ in scored[:top_n]:
            res = simulate_trade(pconn, tk, pdate, outcome_date)
            if res is not None:
                returns.append(res[0])
                n_trades += 1
    return compute_kpis(returns)


# ---------------------------------------------------------------------------
# Baseline D: EGX Benchmark (Buy-the-market)
# ---------------------------------------------------------------------------
def baseline_d_benchmark(
    pconn: sqlite3.Connection,
    start_date: str,
    end_date: str,
    universe: list[str],
) -> dict:
    """
    Equal-weight 'buy the market' — buy at start_date close, sell at end_date
    close for every universe ticker. Treat each ticker's return as a 'trade'.
    """
    cur = pconn.cursor()
    returns: list[float] = []
    for tk in universe:
        cur.execute(
            "SELECT close_price FROM price_history WHERE ticker=? AND date=? AND close_price IS NOT NULL",
            (tk, start_date),
        )
        row = cur.fetchone()
        if not row:
            continue
        start_close = row[0]
        cur.execute(
            "SELECT close_price FROM price_history WHERE ticker=? AND date<=? AND close_price IS NOT NULL ORDER BY date DESC LIMIT 1",
            (tk, end_date),
        )
        row = cur.fetchone()
        if not row:
            continue
        end_close = row[0]
        if start_close <= 0:
            continue
        returns.append((end_close / start_close - 1) * 100)
    kpis = compute_kpis(returns)
    kpis["n_tickers"] = len(returns)
    return kpis


# ---------------------------------------------------------------------------
# Baseline E: Buy & Hold per ticker (prediction_date → outcome_date)
# ---------------------------------------------------------------------------
def baseline_e_buyhold(
    pconn: sqlite3.Connection,
    glm_trades: list[dict],
) -> dict:
    """
    For each GLMinvestment trade: buy at close on prediction_date, sell at
    close on outcome_date. NO TP/SL — pure time-stop.
    """
    cur = pconn.cursor()
    returns: list[float] = []
    for t in glm_trades:
        cur.execute(
            "SELECT close_price FROM price_history WHERE ticker=? AND date=? AND close_price IS NOT NULL",
            (t["ticker"], t["prediction_date"]),
        )
        row = cur.fetchone()
        if not row:
            continue
        entry = row[0]
        cur.execute(
            "SELECT close_price FROM price_history WHERE ticker=? AND date<=? AND close_price IS NOT NULL ORDER BY date DESC LIMIT 1",
            (t["ticker"], t["outcome_date"]),
        )
        row = cur.fetchone()
        if not row or entry <= 0:
            continue
        exit_close = row[0]
        returns.append((exit_close / entry - 1) * 100)
    return compute_kpis(returns)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("=" * 70)
    print("PHASE 4 — BASELINE CHALLENGE")
    print("=" * 70)

    # ---- Load GLM reference trades ----
    pconn_pred = connect(PRED_DB)
    glm_trades = load_glm_trades(pconn_pred)
    print(f"GLMinvestment trades (after dedup+quality): {len(glm_trades)}")
    glm_returns = [t["actual_return"] for t in glm_trades if t["actual_return"] is not None]
    glm_kpis = compute_kpis(glm_returns)
    print(f"GLMinvestment KPIs: {glm_kpis}")

    universe = get_universe_tickers(glm_trades)
    print(f"Universe: {len(universe)} tickers — {universe}")
    pdate_min = min(t["prediction_date"] for t in glm_trades)
    pdate_max = max(t["prediction_date"] for t in glm_trades)
    print(f"Prediction date range: {pdate_min} → {pdate_max}")

    pconn = connect(PRICE_DB)
    trading_days = get_trading_days(pconn, pdate_min, pdate_max)
    print(f"Trading days in GLM window: {len(trading_days)}")

    prediction_dates = sorted({t["prediction_date"] for t in glm_trades})
    print(f"Distinct prediction dates: {len(prediction_dates)}")

    # ---- Baseline A: Random (Monte Carlo) ----
    print("\n[Baseline A] Random selection — Monte Carlo...")
    rng = random.Random(RANDOM_SEED)
    baseline_a = baseline_a_random(
        pconn, universe, trading_days, glm_trades,
        n_per_run=len(glm_trades), runs=MC_RUNS, rng=rng,
    )
    print(f"  → {baseline_a}")

    # ---- Baseline B: Momentum ----
    print("\n[Baseline B] Momentum (top 3 by 20-day return)...")
    baseline_b = baseline_b_momentum(pconn, universe, prediction_dates, glm_trades, top_n=3)
    print(f"  → {baseline_b}")

    # ---- Baseline C: RVOL ----
    print("\n[Baseline C] RVOL (top 3 by today_vol/avg_vol_20d)...")
    baseline_c = baseline_c_rvol(pconn, universe, prediction_dates, glm_trades, top_n=3)
    print(f"  → {baseline_c}")

    # ---- Baseline D: EGX Benchmark ----
    print("\n[Baseline D] EGX Benchmark (buy-market, equal weight, full EGX universe)...")
    egx_universe = get_egx_universe(pconn, pdate_min, pdate_max)
    print(f"  EGX universe size: {len(egx_universe)}")
    baseline_d = baseline_d_benchmark(pconn, pdate_min, pdate_max, egx_universe)
    print(f"  → {baseline_d}")

    # ---- Baseline E: Buy & Hold ----
    print("\n[Baseline E] Buy & Hold per ticker (no TP/SL)...")
    baseline_e = baseline_e_buyhold(pconn, glm_trades)
    print(f"  → {baseline_e}")

    # ---- Verdict ----
    glm_pf = glm_kpis["PF"]
    glm_exp = glm_kpis["Exp"]
    baseline_pfs = {
        "baseline_a_random": baseline_a["PF"],
        "baseline_b_momentum": baseline_b["PF"],
        "baseline_c_rvol": baseline_c["PF"],
        "baseline_d_benchmark": baseline_d["PF"],
        "baseline_e_buyhold": baseline_e["PF"],
    }
    baseline_exps = {
        "baseline_a_random": baseline_a["Exp"],
        "baseline_b_momentum": baseline_b["Exp"],
        "baseline_c_rvol": baseline_c["Exp"],
        "baseline_d_benchmark": baseline_d["Exp"],
        "baseline_e_buyhold": baseline_e["Exp"],
    }
    print("\nPF / Exp comparison:")
    print(f"  GLMinvestment  PF={glm_pf:.3f}  Exp={glm_exp:.3f}%")
    for name in baseline_pfs:
        pf = baseline_pfs[name]
        exp = baseline_exps[name]
        pf_better = pf > glm_pf
        exp_better = exp > glm_exp
        tag_pf = "✗ BL beats GLM" if pf_better else "✓ GLM >"
        tag_exp = "✗ BL beats GLM" if exp_better else "✓ GLM >"
        print(f"  {name:25s} PF={pf:.3f}  Exp={exp:.3f}%   PF:{tag_pf}  Exp:{tag_exp}")

    # Verdict: GLM outperforms if BOTH PF and Exp beat ALL baselines (10% margin)
    MARGIN = 0.10
    pf_outperforms = all(
        glm_pf >= pf * (1 - MARGIN)  # GLM PF >= baseline PF * 0.9 (allow 10% slack)
        for pf in baseline_pfs.values()
    )
    exp_outperforms = all(
        glm_exp >= exp * (1 - MARGIN)
        for exp in baseline_exps.values()
    )
    pf_underperforms = any(
        glm_pf < pf * (1 - MARGIN)
        for pf in baseline_pfs.values()
    )
    exp_underperforms = any(
        glm_exp < exp * (1 - MARGIN)
        for exp in baseline_exps.values()
    )
    if pf_outperforms and exp_outperforms:
        verdict = "GLMinvestment_outperforms"
    elif pf_underperforms or exp_underperforms:
        verdict = "GLMinvestment_underperforms"
    else:
        verdict = "GLMinvestment_matches"

    print(f"\nVERDICT: {verdict}")

    # ---- Compose output ----
    out = {
        "glminvestment_balanced": {
            "n": glm_kpis["n"],
            "WR": glm_kpis["WR"],
            "PF": glm_kpis["PF"],
            "Exp": glm_kpis["Exp"],
            "MaxLoss": glm_kpis["MaxLoss"],
        },
        "baseline_a_random": baseline_a,
        "baseline_b_momentum": baseline_b,
        "baseline_c_rvol": baseline_c,
        "baseline_d_benchmark": baseline_d,
        "baseline_e_buyhold": baseline_e,
        "verdict": verdict,
        "comparison": {
            "glm_pf": glm_pf,
            "glm_exp": glm_exp,
            "baselines_pf": baseline_pfs,
            "baselines_exp": baseline_exps,
            "baselines_beating_glm_by_pf": [
                name for name, pf in baseline_pfs.items() if pf > glm_pf * 1.10
            ],
            "baselines_beating_glm_by_exp": [
                name for name, exp in baseline_exps.items() if exp > glm_exp * 1.10
            ],
        },
        "meta": {
            "tp_pct_proxy": TP_PCT,
            "sl_pct_proxy": SL_PCT,
            "mc_runs": MC_RUNS,
            "universe_size_glm": len(universe),
            "universe_size_egx": len(egx_universe),
            "universe_tickers_glm": universe,
            "prediction_dates_count": len(prediction_dates),
            "date_range": [pdate_min, pdate_max],
            "exit_logic": (
                "TP=+8%, SL=-6%, time-stop=outcome_date close, "
                "intraday high/low used; if TP+SL hit same day, "
                "assume SL hit first (conservative)"
            ),
            "glm_filter": (
                "persona='balanced' AND morning_bell=0 AND status='EXPIRED' "
                "AND kill_filter_result != '' (dedup by ticker+prediction_date)"
            ),
            "verdict_logic": (
                "outperforms if GLM PF and Exp >= 90% of every baseline; "
                "underperforms if any baseline beats GLM by >10% on PF or Exp"
            ),
        },
    }

    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"\n✓ Written: {OUT_JSON}")
    pconn.close()
    pconn_pred.close()


if __name__ == "__main__":
    main()
