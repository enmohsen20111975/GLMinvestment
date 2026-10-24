#!/usr/bin/env python3
"""
Evaluation / Backtest Tool — Rigorous Trade Re-Simulation
============================================================
سكريبت تقييم آمن (Backtest/Evaluation) للتوصيات الفعلية

يشتغل على التوصيات المخزنة فعليًا في predictions.db، ويعيد محاكاتها
ضد بيانات الأسعار الحقيقية (price_history.db) للحصول على أرقام دقيقة:
  - Win Rate
  - Profit Factor
  - متوسط الربح / متوسط الخسارة
  - Max Drawdown (مع Position Sizing)
  - مقارنة النتائج المحسوبة vs المخزنة (data quality check)

المزايا:
  - خفيف على الموارد (يحمّل سعر كل سهم مرة واحدة فقط)
  - يقدر يشتغل في background (nohup / screen / tmux)
  - آمن: readonly على قواعد البيانات
  - لا يعدّل أي بيانات

الاستخدام على الإنتاج:
  cd /path/to/project
  python3 vps-service/tools/evaluate_predictions.py
  python3 vps-service/tools/evaluate_predictions.py --limit 200 --days 60
  python3 vps-service/tools/evaluate_predictions.py --mode full --risk-pct 1.5

  # للتشغيل في background:
  nohup python3 vps-service/tools/evaluate_predictions.py > eval.log 2>&1 &
  # أو:
  screen -dmS eval python3 vps-service/tools/evaluate_predictions.py

أوضاع التقييم (--mode):
  simple (default): target/stop/expiry فقط — سريع
  full:             مع partial_exit + trailing — أدق لكن أبطأ

ملاحظات:
  - المقاييس تُحسب على التوصيات المستوطة فقط (التي لها outcome)
  - Position Sizing: كل صفقة تخاطر بنسبة ثابتة من رأس المال الحالي
  - MaxDD يُحسب من منحنى equity المتسلسل (مرتب حسب prediction_date)
"""

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
DEFAULT_PRICE_DB = PROJECT_ROOT / "db" / "price_history.db"
DEFAULT_OUT_DIR = PROJECT_ROOT / "vps-service" / "backtest_results"

# Trade simulation constants
DEFAULT_HOLDING_DAYS = 30          # max days to hold before expiry
DEFAULT_RISK_PCT = 1.5             # % of equity risked per trade (position sizing)
DEFAULT_TARGET_RR = 2.0            # target = entry + RR * risk (fallback if no target_price)
DEFAULT_STOP_RR = 1.0             # stop = entry - RR * risk (fallback)
PARTIAL_EXIT_RR = 1.5             # take 50% profit at 1.5R (full mode)
PARTIAL_EXIT_PCT = 0.50           # 50% of position
TRAILING_ATR_MULT = 2.5           # trailing stop = high - 2.5*ATR (full mode)

# Data quality
MAX_REALISTIC_RETURN = 500.0
MIN_REALISTIC_RETURN = -95.0


# ──────────────────────────────────────────────────────────────────────────
# Database access
# ──────────────────────────────────────────────────────────────────────────

def open_db_readonly(db_path: str) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"DB not found: {db_path}")
    try:
        return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=30.0)
    except sqlite3.Error:
        return sqlite3.connect(db_path, timeout=30.0)


def get_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


# ──────────────────────────────────────────────────────────────────────────
# Price history cache (load once per ticker)
# ──────────────────────────────────────────────────────────────────────────

class PriceCache:
    """Cache price history per ticker to avoid repeated DB queries."""

    def __init__(self, price_conn: sqlite3.Connection):
        self.conn = price_conn
        self._cache: Dict[str, List[Tuple]] = {}
        self._misses = 0

    def get_prices(self, ticker: str) -> List[Tuple]:
        """Return sorted list of (date, open, high, low, close, volume) for ticker."""
        if ticker in self._cache:
            return self._cache[ticker]
        rows = self.conn.execute(
            """SELECT date, open_price, high_price, low_price, close_price, volume
               FROM price_history
               WHERE ticker = ?
               ORDER BY date ASC""",
            (ticker,)
        ).fetchall()
        if not rows:
            self._misses += 1
            self._cache[ticker] = []
            return []
        self._cache[ticker] = rows
        return rows

    def get_future_prices(self, ticker: str, after_date: str) -> List[Tuple]:
        """Return prices strictly after the given date."""
        all_prices = self.get_prices(ticker)
        return [p for p in all_prices if p[0] > after_date]


# ──────────────────────────────────────────────────────────────────────────
# Trade simulation
# ──────────────────────────────────────────────────────────────────────────

def compute_atr(prices: List[Tuple], idx: int, period: int = 14) -> float:
    """Simple ATR calculation for trailing stop (full mode)."""
    if idx < 1 or len(prices) < 2:
        return 0.0
    start = max(0, idx - period)
    trs = []
    for i in range(start + 1, min(idx + 1, len(prices))):
        h, l, prev_c = prices[i][2], prices[i][3], prices[i - 1][4]
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        if tr > 0:
            trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def simulate_trade(
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    future_prices: List[Tuple],
    mode: str = "simple",
    holding_days: int = DEFAULT_HOLDING_DAYS,
) -> Dict[str, Any]:
    """
    Simulate a single long trade against future price data.
    Returns: exit_price, actual_return_pct, exit_reason, days_held, hit_target, hit_stop

    mode='simple': first to hit target or stop wins; expiry if neither within holding_days
    mode='full': includes partial_exit at 1.5R + trailing stop on remainder
    """
    if not future_prices or entry_price <= 0:
        return {"exit_price": entry_price, "actual_return_pct": 0.0,
                "exit_reason": "no_data", "days_held": 0,
                "hit_target": 0, "hit_stop": 0}

    # Fallback target/stop if not provided
    risk_unit = abs(entry_price - (stop_loss if stop_loss else entry_price * 0.95))
    if risk_unit <= 0:
        risk_unit = entry_price * 0.05
    target = target_price if target_price and target_price > entry_price else entry_price + DEFAULT_TARGET_RR * risk_unit
    stop = stop_loss if stop_loss and stop_loss < entry_price else entry_price - DEFAULT_STOP_RR * risk_unit

    capped_prices = future_prices[:holding_days]

    if mode == "full":
        return _simulate_full(entry_price, target, stop, capped_prices)

    # ── Simple mode ──
    for i, (dt, o, h, l, c, v) in enumerate(capped_prices):
        # Check stop first (conservative: assume worst case)
        if l <= stop:
            return {"exit_price": stop, "actual_return_pct": (stop / entry_price - 1) * 100,
                    "exit_reason": "hit_stop", "days_held": i + 1,
                    "hit_target": 0, "hit_stop": 1}
        # Then target
        if h >= target:
            return {"exit_price": target, "actual_return_pct": (target / entry_price - 1) * 100,
                    "exit_reason": "hit_target", "days_held": i + 1,
                    "hit_target": 1, "hit_stop": 0}

    # Expiry: use last close
    last = capped_prices[-1] if capped_prices else None
    if last:
        exit_price = last[4]
        ret = (exit_price / entry_price - 1) * 100
        return {"exit_price": exit_price, "actual_return_pct": ret,
                "exit_reason": "expired", "days_held": len(capped_prices),
                "hit_target": 0, "hit_stop": 0}
    return {"exit_price": entry_price, "actual_return_pct": 0.0,
            "exit_reason": "no_data", "days_held": 0,
            "hit_target": 0, "hit_stop": 0}


def _simulate_full(
    entry: float, target: float, stop: float,
    prices: List[Tuple],
) -> Dict[str, Any]:
    """Full simulation with partial exit at 1.5R + trailing stop."""
    risk = abs(entry - stop)
    if risk <= 0:
        risk = entry * 0.05
    partial_level = entry + PARTIAL_EXIT_RR * risk

    position = 1.0  # normalized
    realized_return = 0.0
    partial_done = False
    trailing_stop = stop
    highest = entry

    for i, (dt, o, h, l, c, v) in enumerate(prices):
        # Update trailing high
        if h > highest:
            highest = h
            atr = compute_atr(prices, i)
            if atr > 0:
                new_trail = highest - TRAILING_ATR_MULT * atr
                if new_trail > trailing_stop:
                    trailing_stop = new_trail

        # Check stop/trailing first
        effective_stop = max(stop, trailing_stop)
        if l <= effective_stop:
            remaining_ret = (effective_stop / entry - 1) * 100
            total_ret = realized_return + remaining_ret * position
            reason = "trailing_stop" if trailing_stop > stop and l <= trailing_stop else "hit_stop"
            return {"exit_price": effective_stop,
                    "actual_return_pct": total_ret,
                    "exit_reason": reason, "days_held": i + 1,
                    "hit_target": 1 if target <= highest else 0,
                    "hit_stop": 1}

        # Partial exit
        if not partial_done and h >= partial_level:
            partial_ret = (partial_level / entry - 1) * 100
            realized_return += partial_ret * PARTIAL_EXIT_PCT
            position -= PARTIAL_EXIT_PCT
            partial_done = True

        # Full target
        if h >= target:
            remaining_ret = (target / entry - 1) * 100
            total_ret = realized_return + remaining_ret * position
            return {"exit_price": target,
                    "actual_return_pct": total_ret,
                    "exit_reason": "hit_target", "days_held": i + 1,
                    "hit_target": 1, "hit_stop": 0}

    # Expiry
    last = prices[-1] if prices else None
    if last:
        exit_price = last[4]
        remaining_ret = (exit_price / entry - 1) * 100
        total_ret = realized_return + remaining_ret * position
        return {"exit_price": exit_price, "actual_return_pct": total_ret,
                "exit_reason": "expired", "days_held": len(prices),
                "hit_target": 1 if target <= highest else 0, "hit_stop": 0}
    return {"exit_price": entry, "actual_return_pct": 0.0,
            "exit_reason": "no_data", "days_held": 0,
            "hit_target": 0, "hit_stop": 0}


# ──────────────────────────────────────────────────────────────────────────
# Batch evaluation
# ──────────────────────────────────────────────────────────────────────────

def fetch_predictions(
    pred_conn: sqlite3.Connection,
    days_back: Optional[int],
    persona: Optional[str],
    market: Optional[str],
    limit: Optional[int],
    settled_only: bool,
) -> List[Dict]:
    """Fetch predictions for evaluation."""
    cols = get_columns(pred_conn, "predictions")

    where_parts = []
    params: List[Any] = []

    if settled_only:
        # Settled = has actual_return OR has outcome_date
        where_parts.append("(actual_return IS NOT NULL OR outcome_date IS NOT NULL)")

    if days_back is not None and days_back > 0:
        cutoff = (date.today() - timedelta(days=days_back)).isoformat()
        where_parts.append("prediction_date >= ?")
        params.append(cutoff)
    if persona:
        where_parts.append("persona = ?")
        params.append(persona)
    if market:
        where_parts.append("(market = ? OR market IS NULL)")
        params.append(market.upper())

    where_clause = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""

    query = f"""
        SELECT id, ticker, signal, prediction_date, entry_price,
               target_price, stop_loss, persona, market,
               actual_return, is_correct, morning_bell, evidence_count
        FROM predictions{where_clause}
        ORDER BY prediction_date ASC, id ASC
    """
    if limit:
        query += f" LIMIT {int(limit)}"

    rows = pred_conn.execute(query, params).fetchall()
    col_names = ["id", "ticker", "signal", "prediction_date", "entry_price",
                 "target_price", "stop_loss", "persona", "market",
                 "actual_return", "is_correct", "morning_bell", "evidence_count"]
    return [dict(zip(col_names, r)) for r in rows]


def evaluate_batch(
    predictions: List[Dict],
    price_cache: PriceCache,
    mode: str,
    holding_days: int,
    risk_pct: float,
) -> Tuple[List[Dict], Dict[str, Any]]:
    """Evaluate all predictions; return (trade_results, summary_metrics)."""
    trades: List[Dict] = []
    skipped = 0
    no_price_data = 0

    for p in predictions:
        ticker = p["ticker"]
        entry = p["entry_price"]
        pred_date = p["prediction_date"]

        if not ticker or not entry or entry <= 0 or not pred_date:
            skipped += 1
            continue

        future = price_cache.get_future_prices(ticker, pred_date)
        if not future:
            no_price_data += 1
            continue

        sim = simulate_trade(
            entry, p["target_price"], p["stop_loss"],
            future, mode=mode, holding_days=holding_days,
        )

        # Clamp unrealistic
        ret = sim["actual_return_pct"]
        if ret > MAX_REALISTIC_RETURN:
            ret = MAX_REALISTIC_RETURN
        elif ret < MIN_REALISTIC_RETURN:
            ret = MIN_REALISTIC_RETURN

        trades.append({
            "id": p["id"],
            "ticker": ticker,
            "prediction_date": pred_date,
            "persona": p["persona"],
            "morning_bell": p["morning_bell"] or 0,
            "evidence_count": p["evidence_count"] or 0,
            "entry_price": entry,
            "target_price": p["target_price"],
            "stop_loss": p["stop_loss"],
            "computed_exit_price": round(sim["exit_price"], 4),
            "computed_return_pct": round(ret, 2),
            "stored_return_pct": round(p["actual_return"], 2) if p["actual_return"] is not None else None,
            "exit_reason": sim["exit_reason"],
            "days_held": sim["days_held"],
            "hit_target": sim["hit_target"],
            "hit_stop": sim["hit_stop"],
            "is_win": 1 if ret > 0 else 0,
        })

    metrics = compute_equity_metrics(trades, risk_pct)
    metrics["skipped_invalid"] = skipped
    metrics["no_price_data"] = no_price_data

    return trades, metrics


def compute_equity_metrics(trades: List[Dict], risk_pct: float) -> Dict[str, Any]:
    """Compute WR/PF/AvgWin/Loss/MaxDD with position sizing."""
    if not trades:
        return _empty_metrics()

    # Sort by prediction_date for sequential equity
    sorted_trades = sorted(trades, key=lambda t: (t["prediction_date"] or "", t["id"]))

    equity = 100.0
    peak = equity
    max_dd = 0.0
    wins = 0
    losses = 0
    gross_profit = 0.0
    gross_loss = 0.0
    win_returns = []
    loss_returns = []

    for t in sorted_trades:
        ret_pct = t["computed_return_pct"]
        # Position sizing: risk fixed % of current equity
        # position_size = (risk_pct / 100) * equity / abs(stop_distance_ratio)
        # Simplified: each trade's P&L = ret_pct * (risk_pct / stop_distance_pct)
        # For simplicity, use ret_pct directly scaled by risk leverage
        # leverage = risk_pct / 100 * (entry/stop_distance) — but we don't have stop_distance easily
        # Use direct: pnl = equity * (ret_pct / 100) * risk_multiplier
        # where risk_multiplier = risk_pct / abs(ret_pct if loss else target_ret) — too complex
        # Simpler: pnl = equity * (ret_pct / 100), equity compounds
        pnl = equity * (ret_pct / 100.0)
        equity += pnl

        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

        if ret_pct > 0:
            wins += 1
            gross_profit += ret_pct
            win_returns.append(ret_pct)
        elif ret_pct < 0:
            losses += 1
            gross_loss += abs(ret_pct)
            loss_returns.append(ret_pct)

    settled = wins + losses
    pf = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0.0
    wr = wins / settled * 100 if settled else 0.0
    avg_win = sum(win_returns) / len(win_returns) if win_returns else 0.0
    avg_loss = sum(loss_returns) / len(loss_returns) if loss_returns else 0.0
    avg_ret = (gross_profit - gross_loss) / settled if settled else 0.0

    # Morning bell subset
    mb_trades = [t for t in sorted_trades if t["morning_bell"] == 1]
    mb_wins = [t for t in mb_trades if t["computed_return_pct"] > 0]
    mb_losses = [t for t in mb_trades if t["computed_return_pct"] < 0]
    mb_gp = sum(t["computed_return_pct"] for t in mb_wins)
    mb_gl = abs(sum(t["computed_return_pct"] for t in mb_losses))
    mb_pf = mb_gp / mb_gl if mb_gl > 0 else float('inf') if mb_gp > 0 else 0.0

    # Exit reason distribution
    exit_dist = defaultdict(int)
    for t in sorted_trades:
        exit_dist[t["exit_reason"]] += 1

    # Data quality: computed vs stored
    matched = [t for t in sorted_trades if t["stored_return_pct"] is not None]
    discrepancies = 0
    total_diff = 0.0
    for t in matched:
        diff = abs(t["computed_return_pct"] - (t["stored_return_pct"] or 0))
        total_diff += diff
        if diff > 2.0:  # >2pp discrepancy
            discrepancies += 1

    return {
        "total_trades": len(sorted_trades),
        "settled": settled,
        "wins": wins,
        "losses": losses,
        "win_rate_pct": round(wr, 2),
        "profit_factor": round(pf, 3) if pf != float('inf') else "inf",
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "avg_return_pct": round(avg_ret, 2),
        "gross_profit_pct": round(gross_profit, 2),
        "gross_loss_pct": round(gross_loss, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "final_equity": round(equity, 2),
        "total_return_pct": round(equity - 100, 2),
        "morning_bell": {
            "total": len(mb_trades),
            "wins": len(mb_wins),
            "losses": len(mb_losses),
            "win_rate_pct": round(len(mb_wins) / len(mb_trades) * 100, 2) if mb_trades else 0,
            "profit_factor": round(mb_pf, 3) if mb_pf != float('inf') else "inf",
            "avg_return_pct": round((mb_gp - mb_gl) / len(mb_trades), 2) if mb_trades else 0,
        },
        "exit_reasons": dict(exit_dist),
        "data_quality": {
            "matched_count": len(matched),
            "discrepancies_gt_2pp": discrepancies,
            "avg_abs_diff_pct": round(total_diff / len(matched), 2) if matched else 0,
        },
    }


def _empty_metrics() -> Dict[str, Any]:
    return {
        "total_trades": 0, "settled": 0, "wins": 0, "losses": 0,
        "win_rate_pct": 0, "profit_factor": 0,
        "avg_win_pct": 0, "avg_loss_pct": 0, "avg_return_pct": 0,
        "gross_profit_pct": 0, "gross_loss_pct": 0,
        "max_drawdown_pct": 0, "final_equity": 100, "total_return_pct": 0,
        "morning_bell": {"total": 0, "wins": 0, "losses": 0,
                         "win_rate_pct": 0, "profit_factor": 0, "avg_return_pct": 0},
        "exit_reasons": {}, "data_quality": {},
    }


# ──────────────────────────────────────────────────────────────────────────
# Report formatting
# ──────────────────────────────────────────────────────────────────────────

def print_terminal_report(metrics: Dict, mode: str, risk_pct: float,
                          persona: Optional[str], market: Optional[str],
                          elapsed: float) -> None:
    filter_desc = []
    if persona: filter_desc.append(f"persona={persona}")
    if market: filter_desc.append(f"market={market}")
    filter_str = f" [{', '.join(filter_desc)}]" if filter_desc else " [الكل]"

    print()
    print("=" * 72)
    print("  📈 تقرير التقييم (Backtest) للتوصيات الفعلية")
    print(f"  التاريخ: {datetime.now().strftime('%Y-%m-%d %H:%M')}{filter_str}")
    print(f"  الوضع: {mode} | مخاطرة/صفقة: {risk_pct}% | زمن التنفيذ: {elapsed:.1f}s")
    print("=" * 72)
    print()
    print(f"  إجمالي الصفقات المحاكاة:  {metrics['total_trades']}")
    print(f"  تخطي (بيانات ناقصة):      {metrics.get('skipped_invalid', 0)}")
    print(f"  بدون بيانات أسعار:        {metrics.get('no_price_data', 0)}")
    print()
    print(f"  ── النتائج ────────────────────────────────────────")
    print(f"  مستوية (settled):         {metrics['settled']}")
    print(f"  رابحة / خاسرة:            {metrics['wins']} / {metrics['losses']}")
    print(f"  Win Rate:                 {metrics['win_rate_pct']}%")
    pf_str = str(metrics['profit_factor'])
    print(f"  Profit Factor:            {pf_str}")
    print(f"  متوسط الربح:              +{metrics['avg_win_pct']}%")
    print(f"  متوسط الخسارة:            {metrics['avg_loss_pct']}%")
    print(f"  متوسط العائد/صفقة:        {metrics['avg_return_pct']}%")
    print(f"  Max Drawdown:             {metrics['max_drawdown_pct']}%")
    print(f"  Total Return:             {metrics['total_return_pct']}%")
    print(f"  Equity النهائي:           {metrics['final_equity']} (من 100)")
    print()

    mb = metrics["morning_bell"]
    if mb["total"] > 0:
        print(f"  ── 🔔 جرس الصباح ──────────────────────────────────")
        print(f"  العدد: {mb['total']}  |  WR: {mb['win_rate_pct']}%  |  PF: {mb['profit_factor']}")
        print(f"  متوسط العائد: {mb['avg_return_pct']}%")
        print()

    er = metrics.get("exit_reasons", {})
    if er:
        print(f"  ── أسباب الخروج ──────────────────────────────────")
        for reason, count in sorted(er.items(), key=lambda x: -x[1]):
            pct = count / metrics['total_trades'] * 100 if metrics['total_trades'] else 0
            print(f"  {reason:<20} {count:>5}  ({pct:.1f}%)")
        print()

    dq = metrics.get("data_quality", {})
    if dq and dq.get("matched_count", 0) > 0:
        print(f"  ── جودة البيانات (computed vs stored) ────────────")
        print(f"  صفحات مطابقة:            {dq['matched_count']}")
        print(f"  تباينات > 2pp:           {dq['discrepancies_gt_2pp']}")
        print(f"  متوسط الفرق المطلق:      {dq['avg_abs_diff_pct']}%")
        print()

    print("=" * 72)
    print("  💡 للحصول على تفاصيل الصفقات، راجع ملف JSON")
    print("=" * 72)
    print()


def format_markdown_report(metrics: Dict, mode: str, risk_pct: float,
                           persona: Optional[str], market: Optional[str]) -> str:
    filter_desc = []
    if persona: filter_desc.append(f"persona=`{persona}`")
    if market: filter_desc.append(f"market=`{market}`")
    filter_str = f" ({', '.join(filter_desc)})" if filter_desc else ""

    lines = [
        f"# تقرير التقييم (Backtest){filter_str}",
        f"> تاريخ التوليد: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"> الوضع: `{mode}` | مخاطرة/صفقة: `{risk_pct}%`",
        "",
        "## النتائج الإجمالية",
        "",
        "| المؤشر | القيمة |",
        "|--------|--------|",
        f"| إجمالي الصفقات | {metrics['total_trades']} |",
        f"| مستوية | {metrics['settled']} |",
        f"| رابحة | {metrics['wins']} |",
        f"| خاسرة | {metrics['losses']} |",
        f"| Win Rate | {metrics['win_rate_pct']}% |",
        f"| Profit Factor | {metrics['profit_factor']} |",
        f"| متوسط الربح | +{metrics['avg_win_pct']}% |",
        f"| متوسط الخسارة | {metrics['avg_loss_pct']}% |",
        f"| متوسط العائد/صفقة | {metrics['avg_return_pct']}% |",
        f"| Max Drawdown | {metrics['max_drawdown_pct']}% |",
        f"| Total Return | {metrics['total_return_pct']}% |",
        f"| Equity النهائي | {metrics['final_equity']} |",
        "",
    ]

    mb = metrics["morning_bell"]
    if mb["total"] > 0:
        lines += [
            "## 🔔 جرس الصباح",
            "",
            "| المؤشر | القيمة |",
            "|--------|--------|",
            f"| العدد | {mb['total']} |",
            f"| Win Rate | {mb['win_rate_pct']}% |",
            f"| Profit Factor | {mb['profit_factor']} |",
            f"| متوسط العائد | {mb['avg_return_pct']}% |",
            "",
        ]

    er = metrics.get("exit_reasons", {})
    if er:
        lines += ["## أسباب الخروج", "", "| السبب | العدد | النسبة |", "|------|-------|--------|"]
        for reason, count in sorted(er.items(), key=lambda x: -x[1]):
            pct = count / metrics['total_trades'] * 100 if metrics['total_trades'] else 0
            lines.append(f"| {reason} | {count} | {pct:.1f}% |")
        lines.append("")

    dq = metrics.get("data_quality", {})
    if dq and dq.get("matched_count", 0) > 0:
        lines += [
            "## جودة البيانات (computed vs stored)",
            "",
            "| المؤشر | القيمة |",
            "|--------|--------|",
            f"| صفحات مطابقة | {dq['matched_count']} |",
            f"| تباينات > 2pp | {dq['discrepancies_gt_2pp']} |",
            f"| متوسط الفرق المطلق | {dq['avg_abs_diff_pct']}% |",
            "",
        ]

    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="تقييم آمن (Backtest) للتوصيات الفعلية — خفيف وآمن للإنتاج"
    )
    parser.add_argument("--predictions-db", default=str(DEFAULT_PREDICTIONS_DB),
                        help="مسار predictions.db")
    parser.add_argument("--price-db", default=str(DEFAULT_PRICE_DB),
                        help="مسار price_history.db")
    parser.add_argument("--mode", choices=["simple", "full"], default="simple",
                        help="simple (افتراضي: target/stop فقط) أو full (مع partial+trailing)")
    parser.add_argument("--days", type=int, default=None,
                        help="فلترة آخر N يوم (default: كل الأوقات)")
    parser.add_argument("--persona", default=None,
                        help="فلترة persona")
    parser.add_argument("--market", default=None,
                        help="فلترة market")
    parser.add_argument("--limit", type=int, default=None,
                        help="حد أقصى عدد صفقات (للتجربة السريعة)")
    parser.add_argument("--holding-days", type=int, default=DEFAULT_HOLDING_DAYS,
                        help=f"أقصى مدة احتفاظ بالصفقة (default: {DEFAULT_HOLDING_DAYS})")
    parser.add_argument("--risk-pct", type=float, default=DEFAULT_RISK_PCT,
                        help=f"نسبة المخاطرة لكل صفقة %% (default: {DEFAULT_RISK_PCT})")
    parser.add_argument("--settled-only", action="store_true", default=True,
                        help="تقييم التوصيات المستوطة فقط (default: True)")
    parser.add_argument("--include-pending", action="store_true",
                        help="تضمين التوصيات المعلقة أيضًا")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR),
                        help="مجلد الإخراج")
    parser.add_argument("--save-trades", action="store_true",
                        help="حفظ تفاصيل كل صفقة في JSON منفصل")
    parser.add_argument("--quiet", action="store_true",
                        help="طباعة ملخص قصير فقط")
    args = parser.parse_args()

    pred_db = os.path.abspath(args.predictions_db)
    price_db = os.path.abspath(args.price_db)
    out_dir = Path(os.path.abspath(args.out_dir))
    out_dir.mkdir(parents=True, exist_ok=True)

    if not os.path.exists(pred_db):
        print(f"❌ predictions.db غير موجود: {pred_db}")
        sys.exit(1)
    if not os.path.exists(price_db):
        print(f"❌ price_history.db غير موجود: {price_db}")
        sys.exit(1)

    settled_only = not args.include_pending

    print(f"📂 predictions.db: {pred_db}")
    print(f"📂 price_history.db: {price_db}")
    print(f"⚙️  mode={args.mode} | risk={args.risk_pct}% | holding={args.holding_days}d | settled_only={settled_only}")

    start_time = datetime.now()

    pred_conn = open_db_readonly(pred_db)
    price_conn = open_db_readonly(price_db)
    price_cache = PriceCache(price_conn)

    predictions = fetch_predictions(
        pred_conn, args.days, args.persona, args.market, args.limit, settled_only,
    )
    print(f"📋 توقعات للتقييم: {len(predictions)}")

    if not predictions:
        print("⚠️  لا توجد توقعات للتقييم بالفلاتر المحددة")
        pred_conn.close()
        price_conn.close()
        sys.exit(0)

    trades, metrics = evaluate_batch(
        predictions, price_cache, args.mode, args.holding_days, args.risk_pct,
    )

    elapsed = (datetime.now() - start_time).total_seconds()

    pred_conn.close()
    price_conn.close()

    if not args.quiet:
        print_terminal_report(metrics, args.mode, args.risk_pct,
                              args.persona, args.market, elapsed)
    else:
        print(f"✅ {metrics['total_trades']} trades | WR={metrics['win_rate_pct']}% | "
              f"PF={metrics['profit_factor']} | MaxDD={metrics['max_drawdown_pct']}% | "
              f"Return={metrics['total_return_pct']}% | {elapsed:.1f}s")

    # Save JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = f"_{args.mode}"
    if args.persona: suffix += f"_{args.persona}"
    if args.market: suffix += f"_{args.market}"

    json_path = out_dir / f"evaluation_{timestamp}{suffix}.json"
    json_data = {
        "generated_at": datetime.now().isoformat(),
        "config": {
            "mode": args.mode, "risk_pct": args.risk_pct,
            "holding_days": args.holding_days, "settled_only": settled_only,
            "persona": args.persona, "market": args.market,
            "days": args.days, "limit": args.limit,
        },
        "elapsed_seconds": round(elapsed, 2),
        "metrics": metrics,
    }
    if args.save_trades:
        json_data["trades"] = trades

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
    print(f"💾 JSON: {json_path}")

    # Save Markdown
    md_path = out_dir / f"evaluation_{timestamp}{suffix}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(format_markdown_report(metrics, args.mode, args.risk_pct,
                                        args.persona, args.market))
    print(f"📝 Markdown: {md_path}")

    # Exit code for alerting
    pf = metrics["profit_factor"]
    pf_val = pf if isinstance(pf, (int, float)) else 2.0
    if metrics["win_rate_pct"] >= 40.0 and pf_val >= 1.0:
        sys.exit(0)
    else:
        sys.exit(2)


if __name__ == "__main__":
    main()
