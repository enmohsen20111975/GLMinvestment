#!/usr/bin/env python3
"""
exit_policy_optimizer.py — إيجاد سياسة الخروج المثلى للأسهم الانفجارية
=========================================================================
المالك: "إزاي الأرباح لسه 6.2% مع كل التطوير ده؟ محتاجين نوصل +100%"

التشخيص:
- الإنتاج (daily_closer.py): partial 50% عند 1R (+7%) + trailing 2×ATR (tight)
  + max_hold 35 يوم → avg win = +6.2% (بـ يقطّف الفايزين بدري)
- الباك-تست: trailing 30% of profit + window 30 يوم → أفضل بس الـ window قصيرة

الـ script ده بـ يقارن 4 سياسات خروج على نفس الأسهم الانفجارية (real VPS data):
  A. Production (current): partial 50% at 1R + 2×ATR trail, 35-day max
  B. Backtest (current): trailing 30% of profit, 30-day window
  C. Proposed: trailing 30% of profit, 90-day window, no partial
  D. Aggressive trend-follow: close < 20-day SMA exit, 90-day window, no partial

الـ goal: لقي السياسة اللي بـ تـ let الأسهم الانفجارية توصل +50%/+100%.

Usage:
  python3 scripts/exit_policy_optimizer.py
  python3 scripts/exit_policy_optimizer.py --min-momentum 10 --top 50
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ─── Paths ───────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_REAL_DIR = PROJECT_ROOT / "db" / "vps_real"
PRICE_DB = VPS_REAL_DIR / "price_history.db" if VPS_REAL_DIR.exists() else PROJECT_ROOT / "db" / "price_history.db"

OUTPUT_DIR = PROJECT_ROOT / "db" / "backtest_results"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Candle:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class TradeResult:
    ticker: str
    entry_date: str
    entry_price: float
    exit_type: str  # WIN | LOSS | TRAILING | TREND_EXIT | TIMEOUT
    exit_price: float
    pnl_pct: float
    days_held: int
    highest_price: float
    max_gain_pct: float  # highest gain reached before exit


def load_all_candles(conn: sqlite3.Connection) -> Dict[str, List[Candle]]:
    """Load all tickers' candles, sorted by date."""
    tickers: Dict[str, List[Candle]] = {}
    try:
        rows = conn.execute(
            "SELECT ticker, date, open_price, high_price, low_price, close_price, volume "
            "FROM price_history ORDER BY ticker, date"
        ).fetchall()
    except sqlite3.OperationalError:
        # Fallback column names
        rows = conn.execute(
            "SELECT ticker, date, open, high, low, close, volume "
            "FROM price_history ORDER BY ticker, date"
        ).fetchall()

    for r in rows:
        ticker = r[0]
        if ticker not in tickers:
            tickers[ticker] = []
        tickers[ticker].append(Candle(
            date=str(r[1]),
            open=float(r[2] or 0),
            high=float(r[3] or 0),
            low=float(r[4] or 0),
            close=float(r[5] or 0),
            volume=float(r[6] or 0),
        ))
    return tickers


def find_explosive_entries(candles: List[Candle], min_momentum: float = 10.0) -> List[Tuple[int, float, float]]:
    """Find entry points where a stock is explosive (momentum + volume + breakout).

    Returns list of (index_in_candles, entry_price, atr_at_entry).
    Entry criteria (checked at day i, looking back 20 days):
      - 5-day momentum >= min_momentum%
      - volume_ratio >= 1.5×
      - close >= max(high_20d) * 0.99 (breakout or near)
      - enough data (>= 25 candles before, >= 90 after for forward window)
    """
    if len(candles) < 115:
        return []

    entries = []
    for i in range(20, len(candles) - 90):
        c = candles[i]
        if c.close <= 0:
            continue

        # 5-day momentum
        ref = candles[i - 5].close
        if ref <= 0:
            continue
        mom_5d = (c.close - ref) / ref * 100
        if mom_5d < min_momentum:
            continue

        # Volume ratio
        recent_vols = [candles[j].volume for j in range(i - 20, i) if candles[j].volume > 0]
        if not recent_vols:
            continue
        avg_vol = sum(recent_vols) / len(recent_vols)
        if avg_vol <= 0:
            continue
        vol_ratio = c.volume / avg_vol
        if vol_ratio < 1.2:
            continue

        # Breakout/near-high: close >= 20-day high * 0.97 (relaxed for low-volume EGX)
        high_20d = max(candles[j].high for j in range(i - 20, i) if candles[j].high > 0)
        if c.close < high_20d * 0.97:
            continue

        # ATR at entry (14-day)
        atr_vals = []
        for j in range(max(1, i - 14), i):
            tr = max(
                candles[j].high - candles[j].low,
                abs(candles[j].high - candles[j-1].close),
                abs(candles[j].low - candles[j-1].close),
            )
            atr_vals.append(tr)
        atr = sum(atr_vals) / len(atr_vals) if atr_vals else 0
        if atr <= 0:
            continue

        # Bad-data filter: skip splits/errors (momentum > 200%)
        mom_20d = (c.close - candles[i - 20].close) / candles[i - 20].close * 100
        if abs(mom_5d) > 200 or abs(mom_20d) > 400:
            continue

        entries.append((i, c.close, atr))

    return entries


# ─── Policy A: Production (partial 50% at 1R + 2×ATR trailing, 35-day max) ──
def simulate_policy_A(entry: float, stop: float, forward: List[Candle], atr: float) -> TradeResult:
    """Production: partial 50% at 1R, then trail at 2×ATR, max 35 days."""
    risk = entry - stop
    target_1r = entry + risk
    trail_mult = 2.0
    max_days = 35
    partial_fraction = 0.50

    highest = entry
    partial_done = False
    partial_ret = 0.0
    trailing_stop = stop

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue

        highest = max(highest, c.high)

        # Check original stop first (before partial)
        if not partial_done and c.low <= stop:
            return TradeResult("", "", entry, "LOSS", stop,
                               (stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        # Check 1R partial
        if not partial_done and c.high >= target_1r:
            partial_done = True
            partial_ret = (target_1r - entry) / entry * 100
            trailing_stop = highest - atr * trail_mult

        # After partial: trailing stop
        if partial_done:
            trailing_stop = max(trailing_stop, highest - atr * trail_mult)
            if c.close < trailing_stop:
                final_ret = (trailing_stop - entry) / entry * 100
                blended = partial_fraction * partial_ret + (1 - partial_fraction) * final_ret
                return TradeResult("", "", entry, "TRAILING", trailing_stop,
                                   blended, i + 1, highest,
                                   (highest - entry) / entry * 100)

    # Timeout
    last = forward[min(max_days - 1, len(forward) - 1)].close
    if partial_done:
        final_ret = (last - entry) / entry * 100
        blended = partial_fraction * partial_ret + (1 - partial_fraction) * final_ret
        return TradeResult("", "", entry, "TIMEOUT", last,
                           blended, max_days, highest,
                           (highest - entry) / entry * 100)
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


# ─── Policy B: Backtest current (trailing 30% of profit, 30-day window) ──────
def simulate_policy_B(entry: float, stop: float, forward: List[Candle], atr: float) -> TradeResult:
    """Backtest: trailing 30% of profit, activation at +8%, 30-day window."""
    trailing_ratio = 0.30
    activation_gain = 8.0
    max_days = 30

    trailing_stop = stop
    highest = entry

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue

        # Update trailing before checking
        if highest > entry:
            gain_pct = (highest - entry) / entry * 100
            if gain_pct >= activation_gain:
                profit = highest - entry
                new_trail = entry + profit * trailing_ratio
                trailing_stop = max(trailing_stop, new_trail)

        if c.low <= trailing_stop:
            exit_type = "LOSS" if trailing_stop <= stop else "TRAILING"
            return TradeResult("", "", entry, exit_type, trailing_stop,
                               (trailing_stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        if c.close > highest:
            highest = c.close

    last = forward[min(max_days - 1, len(forward) - 1)].close
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


# ─── Policy C: Proposed (trailing 30% of profit, 90-day window, no partial) ──
def simulate_policy_C(entry: float, stop: float, forward: List[Candle], atr: float) -> TradeResult:
    """Proposed: same trailing as B but 90-day window (let explosive run)."""
    trailing_ratio = 0.30
    activation_gain = 8.0
    max_days = 90

    trailing_stop = stop
    highest = entry

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue

        if highest > entry:
            gain_pct = (highest - entry) / entry * 100
            if gain_pct >= activation_gain:
                profit = highest - entry
                new_trail = entry + profit * trailing_ratio
                trailing_stop = max(trailing_stop, new_trail)

        if c.low <= trailing_stop:
            exit_type = "LOSS" if trailing_stop <= stop else "TRAILING"
            return TradeResult("", "", entry, exit_type, trailing_stop,
                               (trailing_stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        if c.close > highest:
            highest = c.close

    last = forward[min(max_days - 1, len(forward) - 1)].close
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


# ─── Policy D: Aggressive trend-follow (close < 20-day SMA, 90-day, no trail) ─
def simulate_policy_D(entry: float, stop: float, forward: List[Candle], atr: float,
                      prior_candles: List[Candle]) -> TradeResult:
    """Aggressive: hold until close < 20-day SMA (trend break) OR stop, 90-day max.

    No partial, no ATR trailing — pure trend-following. The 20-day SMA is
    computed using prior_candles + forward candles up to current day.
    """
    max_days = 90
    all_closes = [c.close for c in prior_candles[-20:] if c.close > 0]

    highest = entry

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue

        highest = max(highest, c.high)

        # Check hard stop (15% for explosive)
        if c.low <= stop:
            return TradeResult("", "", entry, "LOSS", stop,
                               (stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        # Compute 20-day SMA
        all_closes.append(c.close)
        if len(all_closes) > 20:
            all_closes = all_closes[-20:]
        if len(all_closes) >= 20:
            sma_20 = sum(all_closes) / len(all_closes)
            # Trend exit: close below 20-day SMA (only after some gain to avoid early whipsaw)
            gain_pct = (highest - entry) / entry * 100
            if gain_pct >= 10.0 and c.close < sma_20:
                return TradeResult("", "", entry, "TREND_EXIT", c.close,
                                   (c.close - entry) / entry * 100, i + 1, highest,
                                   (highest - entry) / entry * 100)

    last = forward[min(max_days - 1, len(forward) - 1)].close
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


# ─── Policy E: Trend-follow SMA20 + TIGHT stop 8% + 90-day ───────────────────
# نفس D بس stop أضيق (8% بدل 15%) عشان نقلل الخسائر.
# ─── Policy F: Trailing 40% of profit + stop 10% + 90-day ────────────────────
# trailing أوسع (40% بدل 30%) عشان السهم يـ run أكتر قبل الـ exit.
# ─── Policy G: Trend-follow SMA10 (faster) + stop 8% + 90-day ────────────────
# SMA أسرع (10 بدل 20) عشان نـ exit بدري في الـ reversal.


def simulate_policy_E(entry: float, stop: float, forward: List[Candle], atr: float,
                      prior_candles: List[Candle], stop_pct: float = 8.0) -> TradeResult:
    """Trend-follow SMA20 + tight stop 8% + 90-day max."""
    tight_stop = entry * (1 - stop_pct / 100)
    max_days = 90
    all_closes = [c.close for c in prior_candles[-20:] if c.close > 0]
    highest = entry

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue
        highest = max(highest, c.high)

        if c.low <= tight_stop:
            return TradeResult("", "", entry, "LOSS", tight_stop,
                               (tight_stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        all_closes.append(c.close)
        if len(all_closes) > 20:
            all_closes = all_closes[-20:]
        if len(all_closes) >= 20:
            sma_20 = sum(all_closes) / len(all_closes)
            gain_pct = (highest - entry) / entry * 100
            if gain_pct >= 10.0 and c.close < sma_20:
                return TradeResult("", "", entry, "TREND_EXIT", c.close,
                                   (c.close - entry) / entry * 100, i + 1, highest,
                                   (highest - entry) / entry * 100)

    last = forward[min(max_days - 1, len(forward) - 1)].close
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


def simulate_policy_F(entry: float, stop: float, forward: List[Candle], atr: float,
                      stop_pct: float = 10.0) -> TradeResult:
    """Trailing 40% of profit + stop 10% + 90-day window."""
    tight_stop = entry * (1 - stop_pct / 100)
    trailing_ratio = 0.40  # wider than B/C (was 0.30)
    activation_gain = 8.0
    max_days = 90

    trailing_stop = tight_stop
    highest = entry

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue

        if highest > entry:
            gain_pct = (highest - entry) / entry * 100
            if gain_pct >= activation_gain:
                profit = highest - entry
                new_trail = entry + profit * trailing_ratio
                trailing_stop = max(trailing_stop, new_trail)

        if c.low <= trailing_stop:
            exit_type = "LOSS" if trailing_stop <= tight_stop else "TRAILING"
            return TradeResult("", "", entry, exit_type, trailing_stop,
                               (trailing_stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        if c.close > highest:
            highest = c.close

    last = forward[min(max_days - 1, len(forward) - 1)].close
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


def simulate_policy_G(entry: float, stop: float, forward: List[Candle], atr: float,
                      prior_candles: List[Candle], stop_pct: float = 8.0) -> TradeResult:
    """Trend-follow SMA10 (faster) + tight stop 8% + 90-day max.

    SMA10 بـ react أسرع من SMA20 → بـ exit بدري في الـ reversal بس ممكن
    يـ whipsaw. نجربها ونشوف.
    """
    tight_stop = entry * (1 - stop_pct / 100)
    max_days = 90
    all_closes = [c.close for c in prior_candles[-10:] if c.close > 0]
    highest = entry

    for i, c in enumerate(forward):
        if i >= max_days:
            break
        if c.close <= 0:
            continue
        highest = max(highest, c.high)

        if c.low <= tight_stop:
            return TradeResult("", "", entry, "LOSS", tight_stop,
                               (tight_stop - entry) / entry * 100, i + 1, highest,
                               (highest - entry) / entry * 100)

        all_closes.append(c.close)
        if len(all_closes) > 10:
            all_closes = all_closes[-10:]
        if len(all_closes) >= 10:
            sma_10 = sum(all_closes) / len(all_closes)
            gain_pct = (highest - entry) / entry * 100
            if gain_pct >= 10.0 and c.close < sma_10:
                return TradeResult("", "", entry, "TREND_EXIT", c.close,
                                   (c.close - entry) / entry * 100, i + 1, highest,
                                   (highest - entry) / entry * 100)

    last = forward[min(max_days - 1, len(forward) - 1)].close
    return TradeResult("", "", entry, "TIMEOUT", last,
                       (last - entry) / entry * 100, max_days, highest,
                       (highest - entry) / entry * 100)


def summarize(trades: List[TradeResult], label: str) -> Dict:
    if not trades:
        return {"label": label, "count": 0}
    wins = [t for t in trades if t.pnl_pct > 0]
    losses = [t for t in trades if t.pnl_pct <= 0]
    avg_win = sum(t.pnl_pct for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0
    total_win = sum(t.pnl_pct for t in wins)
    total_loss = abs(sum(t.pnl_pct for t in losses))
    pf = total_win / total_loss if total_loss > 0 else float("inf")
    max_gain = max((t.max_gain_pct for t in trades), default=0)
    avg_max_gain = sum(t.max_gain_pct for t in trades) / len(trades)
    # How much profit we captured vs the max available
    capture_rate = (avg_win / avg_max_gain * 100) if avg_max_gain > 0 else 0

    return {
        "label": label,
        "count": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "profit_factor": round(pf, 2),
        "avg_max_gain_pct": round(avg_max_gain, 2),
        "max_gain_pct": round(max_gain, 2),
        "capture_rate_pct": round(capture_rate, 1),  # key metric: % of available profit captured
        "avg_days_held": round(sum(t.days_held for t in trades) / len(trades), 1),
    }


def main():
    ap = argparse.ArgumentParser(description="Exit policy optimizer for explosive stocks")
    ap.add_argument("--min-momentum", type=float, default=10.0, help="Min 5d momentum %% for entry")
    ap.add_argument("--stop-pct", type=float, default=15.0, help="Stop loss %% (explosive)")
    ap.add_argument("--top", type=int, default=100, help="Max trades to simulate")
    args = ap.parse_args()

    print(f"[OPT] Loading price history from {PRICE_DB}...", flush=True)
    if not PRICE_DB.exists():
        print(f"[OPT] ERROR: {PRICE_DB} not found", file=sys.stderr)
        sys.exit(1)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_DB, writable=False).__enter__()
    all_candles = load_all_candles(conn)
    conn.close()
    print(f"[OPT] Loaded {len(all_candles)} tickers", flush=True)

    # Find explosive entries across all tickers
    print(f"[OPT] Scanning for explosive entries (min_momentum={args.min_momentum}%)...", flush=True)
    all_entries = []
    for ticker, candles in all_candles.items():
        entries = find_explosive_entries(candles, min_momentum=args.min_momentum)
        for idx, entry_price, atr in entries:
            all_entries.append((ticker, candles, idx, entry_price, atr))

    print(f"[OPT] Found {len(all_entries)} explosive entries", flush=True)
    if not all_entries:
        print("[OPT] No entries found. Try --min-momentum 5", file=sys.stderr)
        sys.exit(1)

    # Limit
    if len(all_entries) > args.top:
        all_entries = all_entries[:args.top]
        print(f"[OPT] Limited to {args.top} entries", flush=True)

    stop_pct = args.stop_pct
    results = {"A": [], "B": [], "C": [], "D": [], "E": [], "F": [], "G": []}

    for ticker, candles, idx, entry_price, atr in all_entries:
        stop = entry_price * (1 - stop_pct / 100)
        forward = candles[idx + 1: idx + 91]  # 90 days forward
        prior = candles[max(0, idx - 20): idx]
        if len(forward) < 30:
            continue

        r_a = simulate_policy_A(entry_price, stop, forward, atr)
        r_b = simulate_policy_B(entry_price, stop, forward, atr)
        r_c = simulate_policy_C(entry_price, stop, forward, atr)
        r_d = simulate_policy_D(entry_price, stop, forward, atr, prior)
        r_e = simulate_policy_E(entry_price, stop, forward, atr, prior)
        r_f = simulate_policy_F(entry_price, stop, forward, atr)
        r_g = simulate_policy_G(entry_price, stop, forward, atr, prior)

        for r, key in [(r_a, "A"), (r_b, "B"), (r_c, "C"), (r_d, "D"), (r_e, "E"), (r_f, "F"), (r_g, "G")]:
            r.ticker = ticker
            r.entry_date = candles[idx].date
            results[key].append(r)

    # Summarize
    print("\n" + "=" * 90, flush=True)
    print(f"{'Policy':<45} {'Trades':>7} {'WR%':>6} {'AvgWin':>8} {'AvgLoss':>9} {'PF':>6} {'MaxGain':>8} {'Capture':>9}", flush=True)
    print("=" * 90, flush=True)

    summaries = {}
    labels = {
        "A": "A: Production (partial 1R + 2×ATR trail, 35d)",
        "B": "B: Backtest (trail 30% profit, 30d)",
        "C": "C: Proposed (trail 30% profit, 90d)",
        "D": "D: Trend-follow SMA20, stop15%, 90d",
        "E": "E: Trend-follow SMA20, stop8%, 90d",
        "F": "F: Trail 40% profit, stop10%, 90d",
        "G": "G: Trend-follow SMA10, stop8%, 90d",
    }
    for key in ["A", "B", "C", "D", "E", "F", "G"]:
        s = summarize(results[key], labels[key])
        summaries[key] = s
        print(f"{labels[key]:<45} {s['count']:>7} {s['win_rate']:>5}% {s['avg_win_pct']:>7}% {s['avg_loss_pct']:>8}% {s['profit_factor']:>6} {s['max_gain_pct']:>7}% {s['capture_rate_pct']:>8}%", flush=True)

    print("=" * 90, flush=True)
    print(f"\n[OPT] Capture rate = avg_win / avg_max_gain (how much of the available profit we captured)", flush=True)
    print(f"[OPT] Max gain = the highest %% any single trade reached before exit", flush=True)

    # Save
    out_file = OUTPUT_DIR / f"exit_policy_comparison_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    out_file.write_text(json.dumps({
        "generated_at": datetime.now().isoformat(),
        "params": {"min_momentum": args.min_momentum, "stop_pct": args.stop_pct, "top": args.top},
        "summaries": summaries,
        "sample_trades": {
            "A": [{"ticker": t.ticker, "entry": t.entry_price, "exit": t.exit_price, "pnl": t.pnl_pct, "max_gain": t.max_gain_pct, "type": t.exit_type} for t in results["A"][:10]],
            "C": [{"ticker": t.ticker, "entry": t.entry_price, "exit": t.exit_price, "pnl": t.pnl_pct, "max_gain": t.max_gain_pct, "type": t.exit_type} for t in results["C"][:10]],
            "D": [{"ticker": t.ticker, "entry": t.entry_price, "exit": t.exit_price, "pnl": t.pnl_pct, "max_gain": t.max_gain_pct, "type": t.exit_type} for t in results["D"][:10]],
        },
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[OPT] Report saved to {out_file}", flush=True)


if __name__ == "__main__":
    main()
