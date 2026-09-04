#!/usr/bin/env python3
"""
ab_liquidity_v2_backtest.py — Backtest فعلي لـ A/B Comparison
================================================================
يشغل backtest بسيط بـ يحاكي الـ trading على فترة 60 يوم، مرة بالـ LEGACY filter
ومرة بالـ DYNAMIC-V2، ويقارن:
  - عدد الصفقات
  - Win Rate (WR)
  - Profit Factor (PF)
  - Max Drawdown (MaxDD)
  - Return %

المنهجية:
  1. لكل يوم تداول في الفترة، امسح كل الأسهم EGX.
  2. طبّق الـ kill filter (LEGACY أو V2).
  3. لو السهم عدّى، ادخل صفقة (entry = close اليوم، stop = -7%, target = +15%).
  4. تابع الصفقات المفتوحة لحد exit (stop/target/trailing).
  5. احسب الـ metrics.

CLI:
  python3 scripts/ab_liquidity_v2_backtest.py
  python3 scripts/ab_liquidity_v2_backtest.py --position-size 0.08
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
from datetime import datetime, timedelta
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import (
    dynamic_min_turnover as v2_dynamic_min_turnover,
    should_reject_by_liquidity as v2_should_reject,
    classify_price_bucket as v2_classify_bucket,
    LIQUIDITY_BYPASS_POSITION_SIZE,
)

# ─── Thresholds ──────────────────────────────────────────────────────────
LEGACY_STRICT_TURNOVER = 3_000_000
LEGACY_CLOSED_TURNOVER = 500_000

# ─── Backtest params ────────────────────────────────────────────────────
STOP_LOSS_PCT = 0.07      # -7%
TAKE_PROFIT_PCT = 0.15    # +15%
TRAILING_STOP_PCT = 0.10  # -10% from peak
MAX_HOLD_DAYS = 14        # أسبوعين
MAX_OPEN_POSITIONS = 100  # خد كل المقبولين — عشان نشوف الفرق الحقيقي
SCAN_INTERVAL = 1         # daily


def parse_volume(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m
            s = s[:-1]
            break
    try:
        return float(s) * mult
    except Exception:
        return 0.0


def log(msg: str):
    print(msg, flush=True)


def legacy_kill_filter(avg_turnover: float, strict_mode: bool = True) -> bool:
    if avg_turnover <= 0:
        return False
    threshold = LEGACY_STRICT_TURNOVER if strict_mode else LEGACY_CLOSED_TURNOVER
    return avg_turnover >= threshold


def v2_kill_filter(avg_turnover: float, current_price: float, volumes: list, closes: list) -> tuple[bool, bool, float]:
    """يرجع (passed, bypass, threshold)."""
    rejected, reason, bypass, threshold = v2_should_reject(
        avg_turnover=avg_turnover,
        current_price=current_price,
        volumes=volumes,
        closes=closes,
        market_dead=False,
    )
    return (not rejected), bypass, threshold


def load_universe(window_days: int = 60):
    """حمّل كل الأسهم EGX مع تواريخ الأسعار + الأحجام."""
    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row

    # كل EGX tickers
    egx_tickers = [r[0] for r in conn.execute(
        "SELECT ticker FROM stocks WHERE market='EGX'"
    ).fetchall()]

    # آخر تاريخ
    last_date = conn.execute("SELECT MAX(price_date) FROM stock_daily_prices").fetchone()[0]
    first_date = (datetime.strptime(last_date, "%Y-%m-%d") - timedelta(days=window_days)).strftime("%Y-%m-%d")

    log(f"  فترة الـ backtest: {first_date} → {last_date} ({window_days} يوم)")

    # حمّل كل الأسعار لكل tickers في dict
    universe = {}
    for ticker in egx_tickers:
        rows = conn.execute("""
            SELECT price_date, open, high, low, close, volume, turnover
            FROM stock_daily_prices
            WHERE ticker = ? AND price_date >= ? AND close IS NOT NULL AND close > 0
            ORDER BY price_date
        """, (ticker, first_date)).fetchall()
        if len(rows) < 20:
            continue
        series = []
        for r in rows:
            vol = parse_volume(r["volume"])
            turn = r["turnover"]
            if turn is None or turn <= 0:
                turn = float(r["close"]) * vol
            series.append({
                "date": r["price_date"],
                "open": r["open"] or r["close"],
                "high": r["high"] or r["close"],
                "low": r["low"] or r["close"],
                "close": r["close"],
                "volume": vol,
                "turnover": turn,
            })
        universe[ticker] = series
    conn.close()

    log(f"  عدد الأسهم في الـ universe: {len(universe)}")
    # كل تواريخ التداول المتاحة
    all_dates = sorted({s["date"] for series in universe.values() for s in series})
    log(f"  عدد أيام التداول: {len(all_dates)}")
    return universe, all_dates


def run_backtest(universe: dict, all_dates: list, mode: str, position_size_pct: float = 0.08, initial_capital: float = 100_000):
    """يشغل backtest بسيط. mode = 'legacy_strict' | 'legacy_closed' | 'v2'."""
    capital = initial_capital
    open_positions = []  # {ticker, entry_date, entry_price, stop, target, peak, size_pct, size_amount, bypass}
    closed_trades = []   # {ticker, entry_date, exit_date, entry_price, exit_price, return_pct, exit_reason, size_amount}
    rejected_count = 0
    bypass_count = 0

    for current_date in all_dates:
        # 1. تحديث الـ open positions (هل وقعت stop/target؟)
        new_open = []
        for pos in open_positions:
            ticker = pos["ticker"]
            series = universe.get(ticker, [])
            today_data = next((s for s in series if s["date"] == current_date), None)
            if not today_data:
                new_open.append(pos)
                continue

            high = today_data["high"]
            low = today_data["low"]
            close = today_data["close"]
            peak = max(pos["peak"], high)
            trailing_stop = peak * (1 - TRAILING_STOP_PCT)

            # تحقق من exit
            exit_reason = None
            exit_price = None
            if low <= pos["stop"]:
                exit_reason = "stop_loss"
                exit_price = pos["stop"]
            elif high >= pos["target"]:
                exit_reason = "take_profit"
                exit_price = pos["target"]
            elif close <= trailing_stop and pos["peak"] > pos["entry_price"]:
                exit_reason = "trailing_stop"
                exit_price = trailing_stop
            elif (datetime.strptime(current_date, "%Y-%m-%d") - datetime.strptime(pos["entry_date"], "%Y-%m-%d")).days >= MAX_HOLD_DAYS:
                exit_reason = "time_exit"
                exit_price = close

            if exit_reason:
                return_pct = (exit_price - pos["entry_price"]) / pos["entry_price"]
                pnl_amount = return_pct * pos["size_amount"]
                capital += pnl_amount
                closed_trades.append({
                    "ticker": ticker,
                    "entry_date": pos["entry_date"],
                    "exit_date": current_date,
                    "entry_price": pos["entry_price"],
                    "exit_price": exit_price,
                    "return_pct": round(return_pct * 100, 2),
                    "exit_reason": exit_reason,
                    "size_amount": pos["size_amount"],
                    "pnl_amount": round(pnl_amount, 2),
                    "bypass": pos.get("bypass", False),
                })
            else:
                pos["peak"] = peak
                new_open.append(pos)
        open_positions = new_open

        # 2. امسح الأسهم الجديدة للدخول
        if len(open_positions) >= MAX_OPEN_POSITIONS:
            continue

        candidates = []
        for ticker, series in universe.items():
            # السهم لازم يكون عنده بيانات لـ current_date و 20 يوم قبله
            idx = next((i for i, s in enumerate(series) if s["date"] == current_date), None)
            if idx is None or idx < 20:
                continue

            today = series[idx]
            last_20 = series[max(0, idx-19):idx+1]
            closes_20 = [s["close"] for s in last_20]
            volumes_20 = [s["volume"] for s in last_20]
            turnovers_20 = [s["turnover"] for s in last_20]
            avg_turnover = statistics.mean(turnovers_20) if turnovers_20 else 0
            current_price = today["close"]

            # تطبيق الـ kill filter
            if mode == "legacy_strict":
                if not legacy_kill_filter(avg_turnover, strict_mode=True):
                    rejected_count += 1
                    continue
                bypass = False
            elif mode == "legacy_closed":
                if not legacy_kill_filter(avg_turnover, strict_mode=False):
                    rejected_count += 1
                    continue
                bypass = False
            elif mode == "v2":
                passed, bypass, threshold = v2_kill_filter(
                    avg_turnover, current_price, volumes_20, closes_20
                )
                if not passed:
                    rejected_count += 1
                    continue
            else:
                continue

            # فلتر بسيط: السعر قريب من MA20 (مسموح 5% تحت)
            ma20 = statistics.mean(closes_20)
            if current_price < ma20 * 0.95:
                continue
            # RSI بسيط (14)
            if len(closes_20) >= 15:
                changes = [closes_20[i] - closes_20[i-1] for i in range(1, len(closes_20))]
                gains = [c for c in changes if c > 0]
                losses = [-c for c in changes if c < 0]
                avg_gain = statistics.mean(gains) if gains else 0
                avg_loss = statistics.mean(losses) if losses else 0.0001
                if avg_loss == 0:
                    rsi = 100
                else:
                    rs = avg_gain / avg_loss
                    rsi = 100 - (100 / (1 + rs))
                if rsi > 75:  # رفعنا من 65 لـ 75
                    continue
            # مش لازم ندخل في نفس السهم لو فيه position مفتوح
            if any(p["ticker"] == ticker for p in open_positions):
                continue

            # تجنب الـ late entry (طلع +10% خلال 5 أيام)
            if len(closes_20) >= 6 and closes_20[-6] > 0:
                roc5 = (closes_20[-1] - closes_20[-6]) / closes_20[-6] * 100
                if roc5 >= 15:  # رفعنا من 10 لـ 15
                    continue

            candidates.append({
                "ticker": ticker,
                "entry_price": current_price,
                "avg_turnover": avg_turnover,
                "bypass": bypass,
            })

        # ترتيب حسب الـ avg_turnover (الأعلى سيولة = الأولوية) وادخل كل المقبولين
        candidates.sort(key=lambda x: x["avg_turnover"], reverse=True)
        for c in candidates[:MAX_OPEN_POSITIONS - len(open_positions)]:
            # position size: default 8% (أو 2.5% لو bypass)
            size_pct = LIQUIDITY_BYPASS_POSITION_SIZE if c["bypass"] else position_size_pct
            size_amount = capital * size_pct
            if size_amount < 1000:  # حد أدنى
                continue
            capital -= size_amount  # lock capital
            if c["bypass"]:
                bypass_count += 1
            open_positions.append({
                "ticker": c["ticker"],
                "entry_date": current_date,
                "entry_price": c["entry_price"],
                "stop": c["entry_price"] * (1 - STOP_LOSS_PCT),
                "target": c["entry_price"] * (1 + TAKE_PROFIT_PCT),
                "peak": c["entry_price"],
                "size_pct": size_pct,
                "size_amount": size_amount,
                "bypass": c["bypass"],
            })

    # إغلاق كل الصفقات المفتوحة في آخر يوم
    for pos in open_positions:
        ticker = pos["ticker"]
        series = universe.get(ticker, [])
        last_data = series[-1] if series else None
        if last_data:
            exit_price = last_data["close"]
            return_pct = (exit_price - pos["entry_price"]) / pos["entry_price"]
            pnl_amount = return_pct * pos["size_amount"]
            capital += pnl_amount
            closed_trades.append({
                "ticker": ticker,
                "entry_date": pos["entry_date"],
                "exit_date": last_data["date"],
                "entry_price": pos["entry_price"],
                "exit_price": exit_price,
                "return_pct": round(return_pct * 100, 2),
                "exit_reason": "end_of_test",
                "size_amount": pos["size_amount"],
                "pnl_amount": round(pnl_amount, 2),
                "bypass": pos.get("bypass", False),
            })

    return closed_trades, rejected_count, bypass_count, capital


def calc_metrics(trades: list, initial_capital: float = 100_000):
    if not trades:
        return {"n_trades": 0, "wr": 0, "pf": 0, "max_dd": 0, "return_pct": 0, "avg_win": 0, "avg_loss": 0}

    n = len(trades)
    wins = [t for t in trades if t["pnl_amount"] > 0]
    losses = [t for t in trades if t["pnl_amount"] <= 0]
    total_win = sum(t["pnl_amount"] for t in wins)
    total_loss = abs(sum(t["pnl_amount"] for t in losses))
    wr = len(wins) / n * 100
    pf = total_win / total_loss if total_loss > 0 else float("inf")

    # MaxDD: equity curve
    equity = initial_capital
    peak = equity
    max_dd = 0
    for t in trades:
        equity += t["pnl_amount"]
        if equity > peak:
            peak = equity
        dd = (equity - peak) / peak * 100
        if dd < max_dd:
            max_dd = dd

    return_pct = (equity - initial_capital) / initial_capital * 100
    avg_win = statistics.mean([t["return_pct"] for t in wins]) if wins else 0
    avg_loss = statistics.mean([t["return_pct"] for t in losses]) if losses else 0

    return {
        "n_trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "wr": round(wr, 2),
        "pf": round(pf, 2),
        "max_dd": round(max_dd, 2),
        "return_pct": round(return_pct, 2),
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "total_pnl": round(equity - initial_capital, 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--window-days", type=int, default=60)
    parser.add_argument("--position-size", type=float, default=0.08)
    args = parser.parse_args()

    log("═══ A/B Backtest: LEGACY (3M/500K) vs DYNAMIC-V2 (80K/200K/400K) ═══\n")
    universe, all_dates = load_universe(args.window_days)

    modes = [
        ("legacy_strict", "LEGACY (3M strict)"),
        ("legacy_closed", "LEGACY (500K closed)"),
        ("v2", "DYNAMIC-V2 (80K/200K/400K)"),
    ]

    results = {}
    for mode, label in modes:
        log(f"\n▶ تشغيل {label}...")
        trades, rejected, bypass_count, final_capital = run_backtest(
            universe, all_dates, mode, args.position_size
        )
        metrics = calc_metrics(trades, initial_capital=100_000)
        metrics["rejected_count"] = rejected
        metrics["bypass_count"] = bypass_count
        metrics["label"] = label
        results[mode] = {
            "metrics": metrics,
            "trades": trades,
        }
        log(f"  ✅ n_trades={metrics['n_trades']}  WR={metrics['wr']}%  PF={metrics['pf']}  "
            f"MaxDD={metrics['max_dd']}%  Return={metrics['return_pct']}%  "
            f"rejected={rejected}  bypass={bypass_count}")

    # جدول مقارنة
    log("\n\n═══ جدول المقارنة النهائي ═══\n")
    log(f"{'Metric':<20s} | {'LEGACY-3M':>12s} | {'LEGACY-500K':>12s} | {'DYNAMIC-V2':>12s} | {'Diff V2 vs 500K':>15s}")
    log("-" * 85)
    for metric_name in ["n_trades", "wins", "losses", "wr", "pf", "max_dd", "return_pct", "rejected_count", "bypass_count"]:
        v1 = results["legacy_strict"]["metrics"].get(metric_name, 0)
        v2 = results["legacy_closed"]["metrics"].get(metric_name, 0)
        v3 = results["v2"]["metrics"].get(metric_name, 0)
        diff = v3 - v2
        diff_str = f"{diff:>+15}" if isinstance(diff, (int, float)) else ""
        log(f"{metric_name:<20s} | {v1:>12} | {v2:>12} | {v3:>12} | {diff_str}")

    # مقارنة الـ tickers المقبولة في كل mode
    log("\n\n═══ مقارنة الـ tickers المقبولة ═══\n")
    tickers_per_mode = {}
    for mode, label in modes:
        trades = results[mode]["trades"]
        # الـ tickers الفريدة اللي دخلت في أي وقت
        tickers = sorted({t["ticker"] for t in trades})
        tickers_per_mode[mode] = set(tickers)
        log(f"  {label}: {len(tickers)} ticker فريد")

    # الفرق: V2 يقبل و LEGACY-500K ميرفضش
    only_v2 = tickers_per_mode["v2"] - tickers_per_mode["legacy_closed"]
    only_legacy = tickers_per_mode["legacy_closed"] - tickers_per_mode["v2"]
    common = tickers_per_mode["v2"] & tickers_per_mode["legacy_closed"]
    log(f"\n  Common (both V2 + LEGACY-500K): {len(common)}")
    log(f"  V2-only (V2 قبلها بس LEGACY-500K رفضها): {len(only_v2)}")
    if only_v2:
        for t in sorted(only_v2)[:20]:
            # نوجد الـ trade في V2
            v2_trade = next((x for x in results["v2"]["trades"] if x["ticker"] == t), None)
            if v2_trade:
                log(f"    {t:8s}  return={v2_trade['return_pct']:+.1f}%  exit={v2_trade['exit_reason']}")
    log(f"  LEGACY-500K-only (LEGACY قبلها بس V2 رفضها): {len(only_legacy)}")
    if only_legacy:
        for t in sorted(only_legacy)[:20]:
            leg_trade = next((x for x in results["legacy_closed"]["trades"] if x["ticker"] == t), None)
            if leg_trade:
                log(f"    {t:8s}  return={leg_trade['return_pct']:+.1f}%  exit={leg_trade['exit_reason']}")

    # تحليل الـ bypass trades
    v2_bypass_trades = [t for t in results["v2"]["trades"] if t.get("bypass")]
    log(f"\n📊 V2 Bypass Trades: {len(v2_bypass_trades)}")
    for t in v2_bypass_trades[:10]:
        log(f"  {t['ticker']:8s}  entry={t['entry_price']:.2f}  exit={t['exit_price']:.2f}  "
            f"return={t['return_pct']:+.1f}%  reason={t['exit_reason']}")

    # حفظ
    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"ab_liquidity_v2_backtest_{today_str}.json"
    # strip trades for JSON (lots of data)
    summary_json = {
        "generated_at": datetime.now().isoformat(),
        "window_days": args.window_days,
        "position_size": args.position_size,
        "modes": {m: {"metrics": r["metrics"]} for m, r in results.items()},
        "v2_bypass_trades_count": len(v2_bypass_trades),
        "v2_bypass_trades": v2_bypass_trades,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary_json, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")

    # تقرير عربي
    report = build_arabic_report(results, v2_bypass_trades, args.position_size, args.window_days)
    md_path = OUTPUT_DIR / f"ab_liquidity_v2_backtest_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    print("\n" + "="*80)
    print(report)
    return 0


def build_arabic_report(results, v2_bypass_trades, position_size, window_days):
    today = datetime.now().strftime("%Y-%m-%d")
    m_legacy_3m = results["legacy_strict"]["metrics"]
    m_legacy_500k = results["legacy_closed"]["metrics"]
    m_v2 = results["v2"]["metrics"]

    lines = []
    lines.append(f"# تقرير A/B Backtest — DYNAMIC-LIQUIDITY-V2 — {today}")
    lines.append("")
    lines.append(f"**فترة الـ backtest:** آخر {window_days} يوم")
    lines.append(f"**Position size الافتراضي:** {position_size*100}% | **Bypass:** {LIQUIDITY_BYPASS_POSITION_SIZE*100}%")
    lines.append(f"**Stop loss:** -{STOP_LOSS_PCT*100}% | **Take profit:** +{TAKE_PROFIT_PCT*100}% | **Trailing:** -{TRAILING_STOP_PCT*100}%")
    lines.append(f"**Max open positions:** {MAX_OPEN_POSITIONS} | **Max hold:** {MAX_HOLD_DAYS} أيام")
    lines.append("")
    lines.append("## 📊 جدول المقارنة النهائي")
    lines.append("")
    lines.append("| المتر | LEGACY-3M (strict) | LEGACY-500K (closed) | DYNAMIC-V2 (80K/200K/400K) | الفرق (V2 - 500K) |")
    lines.append("|-------|--------------------|-----------------------|----------------------------|-------------------|")
    for metric_name, label in [
        ("n_trades", "عدد الصفقات"),
        ("wins", "صفقات رابحة"),
        ("losses", "صفقات خاسرة"),
        ("wr", "Win Rate %"),
        ("pf", "Profit Factor"),
        ("max_dd", "Max Drawdown %"),
        ("return_pct", "Return %"),
        ("rejected_count", "أسهم مرفوضة"),
        ("bypass_count", "Bypass trades"),
    ]:
        v1 = m_legacy_3m.get(metric_name, 0)
        v2 = m_legacy_500k.get(metric_name, 0)
        v3 = m_v2.get(metric_name, 0)
        diff = v3 - v2
        diff_sign = "+" if diff > 0 else ""
        lines.append(f"| {label} | {v1} | {v2} | **{v3}** | {diff_sign}{diff} |")
    lines.append("")
    lines.append("## 📊 V2 Bypass Trades")
    lines.append("")
    if v2_bypass_trades:
        lines.append(f"عددها: {len(v2_bypass_trades)} (بـ position size {LIQUIDITY_BYPASS_POSITION_SIZE*100}%)")
        lines.append("")
        lines.append("| Ticker | Entry | Exit | Return% | Exit Reason |")
        lines.append("|--------|-------|------|---------|-------------|")
        for t in v2_bypass_trades[:10]:
            lines.append(f"| {t['ticker']} | {t['entry_price']:.2f} | {t['exit_price']:.2f} | {t['return_pct']:+.1f}% | {t['exit_reason']} |")
    else:
        lines.append("مفيش bypass trades في الفترة دي — الأسهم اللي بـ تتأهل بـ bypass قليلة.")
    lines.append("")
    lines.append("## الخلاصة")
    lines.append("")
    diff_trades = m_v2["n_trades"] - m_legacy_500k["n_trades"]
    diff_pf = m_v2["pf"] - m_legacy_500k["pf"]
    diff_dd = m_v2["max_dd"] - m_legacy_500k["max_dd"]
    diff_ret = m_v2["return_pct"] - m_legacy_500k["return_pct"]
    lines.append(f"- **عدد الصفقات:** {m_v2['n_trades']} (vs {m_legacy_500k['n_trades']} للـ 500K) → فرق {diff_trades:+d}")
    lines.append(f"- **Profit Factor:** {m_v2['pf']} (vs {m_legacy_500k['pf']} للـ 500K) → فرق {diff_pf:+.2f}")
    lines.append(f"- **Max Drawdown:** {m_v2['max_dd']}% (vs {m_legacy_500k['max_dd']}% للـ 500K) → فرق {diff_dd:+.2f}pp")
    lines.append(f"- **Return:** {m_v2['return_pct']}% (vs {m_legacy_500k['return_pct']}% للـ 500K) → فرق {diff_ret:+.2f}pp")
    lines.append(f"- **Bypass trades:** {m_v2['bypass_count']} (position size {LIQUIDITY_BYPASS_POSITION_SIZE*100}%)")
    lines.append("")
    lines.append("### القرار")
    lines.append("")
    if diff_trades > 0 and diff_pf >= 0 and diff_dd >= 0:
        lines.append("✅ **DYNAMIC-V2 أحسن أو مماثل** في كل الـ metrics. يُتطّبق.")
    elif diff_trades > 0 and diff_pf < 0:
        lines.append("⚠️ **V2 قبل صفقات أكتر بس PF نزل** — محتاج فحص الـ trades الجديدة.")
    elif diff_trades == 0:
        lines.append("ℹ️ **نفس العدد من الصفقات** — الـ dynamic threshold بـ يختار نفس الأسهم.")
    else:
        lines.append("❌ **V2 أسوأ** — راجع الـ thresholds.")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `ab_liquidity_v2_backtest.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
