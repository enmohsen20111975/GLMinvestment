#!/usr/bin/env python3
"""
R:R-FIX Before/After Simulation (READ-ONLY)
============================================
يقارن أداء التوقعات قبل وبعد إصلاح R:R (key mismatch + dynamic_rr + ATR clamp).

المنهجية:
  BEFORE = الأرشيف الحقيقي (active_databases_20260817_full.zip → predictions.db)
           - كل الصفقات لها R:R = 1.5 ثابت (بسبب key mismatch bug)
           - actual_return محسوب من المحاكاة الأصلية

  AFTER  = إعادة محاكاة نفس الصفقات بالإصلاح:
           - dynamic_rr: لو السهم outperforming الـ benchmark → R:R = 2.0
           - otherwise → R:R = 1.5 (كما هو)
           - ATR stop clamp: stop يبقى في [3%, 9%]
           - إعادة محاكاة using price_history الفعلية

القياس:
  - WR, PF, AvgWin, AvgLoss, Expectancy, Total Return
  - R:R distribution (1.5 vs 2.0)
  - عدد الصفقات (هل R:R gate رفض بعضها؟)

Usage:
  python3 vps-service/scripts/rr_fix_before_after.py

Output:
  vps-service/backtest_results/rr_fix_before_after_<timestamp>.json
  vps-service/backtest_results/rr_fix_before_after_<timestamp>.md
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# ─── Paths (relative only — CONSTITUTION Rule 17) ───
_VPS_ROOT = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'vps_real' / 'predictions.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'vps_real' / 'price_history.db')
OUTPUT_DIR = str(_VPS_ROOT / 'backtest_results')

# Settings (mirror engine_settings.py canonical values)
DYNAMIC_RR_NORMAL = 1.5
DYNAMIC_RR_OUTPERFORM = 2.0
ATR_STOP_MIN_PCT = 3.0
ATR_STOP_MAX_PCT = 9.0
HARD_CAP = 50.0  # CONSTITUTION Rule 7
MAX_HOLDING_DAYS = 30
BENCHMARK_TICKER = 'EGX30ETF'
ROC_WINDOW = 14  # 14-day rate of change for outperforming_market detection

# ─── Data loading (READ-ONLY) ──────────────────────────────────────────────


def _connect_ro(db_path: str) -> sqlite3.Connection:
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def load_closed_predictions(db_path: str) -> List[Dict]:
    """حمّل كل التوقعات المغلقة من الأرشيف الحقيقي."""
    conn = _connect_ro(db_path)
    cur = conn.cursor()
    cur.execute('''
        SELECT id, ticker, signal, signal_type, persona,
               prediction_date, entry_price, target_price, stop_loss,
               actual_return, holding_days, exit_type, outcome_date,
               market
        FROM predictions
        WHERE actual_return IS NOT NULL
          AND entry_price > 0
          AND target_price > entry_price
          AND stop_loss < entry_price
        ORDER BY prediction_date ASC, ticker ASC
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def load_benchmark_roc(db_path: str, ticker: str = BENCHMARK_TICKER) -> Dict[str, float]:
    """حمّل ROC-14 للـ benchmark لكل تاريخ. يرجع dict {date: roc_pct}."""
    conn = _connect_ro(db_path)
    cur = conn.cursor()
    cur.execute('''
        SELECT date, close_price FROM price_history
        WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
        ORDER BY date ASC
    ''', (ticker,))
    rows = cur.fetchall()
    conn.close()
    if len(rows) < ROC_WINDOW + 1:
        print(f"[WARN] Benchmark {ticker} has only {len(rows)} rows — need >= {ROC_WINDOW+1}")
        return {}
    roc_by_date = {}
    for i in range(ROC_WINDOW, len(rows)):
        past_close = rows[i - ROC_WINDOW]['close_price']
        cur_close = rows[i]['close_price']
        if past_close > 0:
            roc = (cur_close - past_close) / past_close * 100.0
            roc_by_date[rows[i]['date']] = roc
    return roc_by_date


def load_stock_prices(db_path: str, ticker: str) -> List[Dict]:
    """حمّل كل أسعار السهم (date, high, low, close) مرتبة تصاعدياً."""
    conn = _connect_ro(db_path)
    cur = conn.cursor()
    cur.execute('''
        SELECT date, high_price as high, low_price as low, close_price as close
        FROM price_history
        WHERE ticker = ? AND high_price IS NOT NULL AND low_price IS NOT NULL AND close_price IS NOT NULL
        ORDER BY date ASC
    ''', (ticker,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def load_stock_roc(db_path: str, ticker: str) -> Dict[str, float]:
    """حمّل ROC-14 للسهم لكل تاريخ."""
    prices = load_stock_prices(db_path, ticker)
    roc_by_date = {}
    for i in range(ROC_WINDOW, len(prices)):
        past_close = prices[i - ROC_WINDOW]['close']
        cur_close = prices[i]['close']
        if past_close > 0:
            roc = (cur_close - past_close) / past_close * 100.0
            roc_by_date[prices[i]['date']] = roc
    return roc_by_date


# ─── Simulation logic ──────────────────────────────────────────────────────


def compute_outperforming(stock_roc: Optional[float], benchmark_roc: Optional[float]) -> bool:
    """حدد هل السهم كان أقوى من المؤشر في تاريخ الدخول."""
    if stock_roc is None or benchmark_roc is None:
        return False
    return stock_roc > benchmark_roc


def compute_new_target(entry: float, stop: float, outperforming: bool) -> float:
    """احسب الهدف الجديد بالإصلاح:
    - outperforming → R:R = 2.0
    - otherwise → R:R = 1.5 (كما هو في الأرشيف)
    """
    risk = entry - stop
    rr = DYNAMIC_RR_OUTPERFORM if outperforming else DYNAMIC_RR_NORMAL
    return entry + (risk * rr)


def clamp_stop(entry: float, stop: float) -> float:
    """طبّق ATR stop clamp: stop في [3%, 9%] من entry."""
    if entry <= 0:
        return stop
    stop_pct = abs((entry - stop) / entry) * 100.0
    if stop_pct < ATR_STOP_MIN_PCT:
        return entry - (entry * ATR_STOP_MIN_PCT / 100.0)
    if stop_pct > ATR_STOP_MAX_PCT:
        return entry - (entry * ATR_STOP_MAX_PCT / 100.0)
    return stop


def simulate_trade_after(
    entry: float,
    target: float,
    stop: float,
    future_prices: List[Dict],
    max_days: int = MAX_HOLDING_DAYS,
) -> Tuple[float, str]:
    """أعد محاكاة الصفقة بالإصلاح. يرجع (actual_return_pct, exit_reason)."""
    if not future_prices:
        return 0.0, 'no_data'

    for i, day in enumerate(future_prices[:max_days]):
        # Check stop first (conservative — if both hit on same day, assume stop)
        if day['low'] <= stop:
            return (stop - entry) / entry * 100.0, 'stop_loss'
        if day['high'] >= target:
            return (target - entry) / entry * 100.0, 'target_hit'

    # Neither hit — use close at end of holding period
    last_day = future_prices[min(max_days - 1, len(future_prices) - 1)]
    final_price = last_day['close']
    return (final_price - entry) / entry * 100.0, 'time_exit'


def compute_metrics(trades: List[Dict], label: str) -> Dict:
    """احسب WR, PF, AvgWin, AvgLoss, Expectancy, etc."""
    if not trades:
        return {'label': label, 'n': 0, 'error': 'no trades'}

    returns = [t['actual_return'] for t in trades]
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]

    # Apply HARD cap (CONSTITUTION Rule 7)
    capped = [max(min(r, HARD_CAP), -HARD_CAP) for r in returns]
    wins_capped = [r for r in capped if r > 0]
    losses_capped = [r for r in capped if r < 0]

    n = len(capped)
    n_wins = len(wins_capped)
    n_losses = len(losses_capped)
    wr = (n_wins / n * 100.0) if n > 0 else 0.0
    avg_win = (sum(wins_capped) / n_wins) if n_wins else 0.0
    avg_loss = (sum(losses_capped) / n_losses) if n_losses else 0.0
    gross_profit = sum(wins_capped)
    gross_loss = abs(sum(losses_capped))
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    avg_return = sum(capped) / n if n > 0 else 0.0
    expectancy = avg_return  # equal-weight assumption
    total_return = sum(capped)
    max_gain = max(capped) if capped else 0.0
    max_loss = min(capped) if capped else 0.0

    return {
        'label': label,
        'n': n,
        'wins': n_wins,
        'losses': n_losses,
        'win_rate': round(wr, 2),
        'profit_factor': round(pf, 3),
        'avg_win': round(avg_win, 3),
        'avg_loss': round(avg_loss, 3),
        'avg_return': round(avg_return, 3),
        'expectancy': round(expectancy, 3),
        'total_return': round(total_return, 2),
        'max_gain': round(max_gain, 2),
        'max_loss': round(max_loss, 2),
    }


def compute_rr_distribution(trades: List[Dict]) -> Dict:
    """احسب توزيع R:R."""
    if not trades:
        return {}
    rr_buckets = {'1.5': 0, '2.0': 0, 'other': 0}
    for t in trades:
        rr = t.get('rr_after', 0)
        if abs(rr - 1.5) < 0.01:
            rr_buckets['1.5'] += 1
        elif abs(rr - 2.0) < 0.01:
            rr_buckets['2.0'] += 1
        else:
            rr_buckets['other'] += 1
    return rr_buckets


# ─── Main simulation ───────────────────────────────────────────────────────


def run_simulation() -> Dict:
    print(f"[RR-FIX-SIM] Starting before/after simulation...")
    print(f"  predictions_db: {PREDICTIONS_DB}")
    print(f"  price_history_db: {PRICE_HISTORY_DB}")

    # 1. Load closed predictions (BEFORE baseline)
    trades = load_closed_predictions(PREDICTIONS_DB)
    print(f"  loaded {len(trades)} closed trades from archive")

    if not trades:
        return {'error': 'no closed trades in archive'}

    # 2. Load benchmark ROC
    benchmark_roc = load_benchmark_roc(PRICE_HISTORY_DB, BENCHMARK_TICKER)
    print(f"  benchmark {BENCHMARK_TICKER}: {len(benchmark_roc)} dates with ROC-14")

    # 3. Cache stock prices and ROC per ticker
    stock_cache: Dict[str, Tuple[List[Dict], Dict[str, float]]] = {}

    # 4. For each trade, compute "after" target/stop/return
    after_trades = []
    skipped = 0
    for t in trades:
        ticker = t['ticker']
        entry_date = t['prediction_date']
        entry = t['entry_price']
        stop_before = t['stop_loss']
        target_before = t['target_price']
        return_before = t['actual_return']

        # Load stock data (cached)
        if ticker not in stock_cache:
            prices = load_stock_prices(PRICE_HISTORY_DB, ticker)
            roc = load_stock_roc(PRICE_HISTORY_DB, ticker)
            stock_cache[ticker] = (prices, roc)
        prices, stock_roc = stock_cache[ticker]

        if not prices:
            skipped += 1
            continue

        # Find index of entry_date
        date_to_idx = {p['date']: i for i, p in enumerate(prices)}
        if entry_date not in date_to_idx:
            # Try closest date after entry_date
            future_dates = [p['date'] for p in prices if p['date'] >= entry_date]
            if not future_dates:
                skipped += 1
                continue
            entry_idx = date_to_idx[future_dates[0]]
        else:
            entry_idx = date_to_idx[entry_date]

        # Get future prices for simulation
        future_prices = prices[entry_idx + 1:]

        # Compute outperforming_market
        s_roc = stock_roc.get(entry_date)
        b_roc = benchmark_roc.get(entry_date)
        outperforming = compute_outperforming(s_roc, b_roc)

        # Apply ATR stop clamp
        stop_after = clamp_stop(entry, stop_before)

        # Compute new target with dynamic R:R
        target_after = compute_new_target(entry, stop_after, outperforming)

        # Re-simulate with new target/stop
        return_after, exit_reason = simulate_trade_after(
            entry, target_after, stop_after, future_prices
        )

        # Compute R:R after
        risk = entry - stop_after
        rr_after = (target_after - entry) / risk if risk > 0 else 0.0

        after_trades.append({
            **t,
            'outperforming': outperforming,
            'stock_roc': round(s_roc, 2) if s_roc is not None else None,
            'benchmark_roc': round(b_roc, 2) if b_roc is not None else None,
            'stop_before': stop_before,
            'stop_after': stop_after,
            'target_before': target_before,
            'target_after': target_after,
            'rr_before': 1.5,  # All archive trades have R:R=1.5 (confirmed)
            'rr_after': round(rr_after, 2),
            'actual_return_before': return_before,
            'actual_return_after': round(return_after, 2),
            'exit_reason_after': exit_reason,
            # For metrics computation:
            'actual_return': return_after,  # after
        })

    print(f"  simulated {len(after_trades)} trades (skipped {skipped})")

    # 5. Build "before" and "after" trade lists for metrics
    before_trades = [{'actual_return': t['actual_return_before']} for t in after_trades]
    after_metrics_trades = [{'actual_return': t['actual_return_after']} for t in after_trades]

    # 6. Compute metrics
    before_metrics = compute_metrics(before_trades, 'BEFORE (archive: fixed R:R=1.5)')
    after_metrics = compute_metrics(after_metrics_trades, 'AFTER (fix: dynamic R:R 1.5/2.0)')

    # 7. R:R distribution
    rr_dist_before = {'1.5': len(after_trades), '2.0': 0, 'other': 0}
    rr_dist_after = compute_rr_distribution(after_trades)

    # 8. Outperforming breakdown
    outperforming_count = sum(1 for t in after_trades if t['outperforming'])
    outperforming_trades = [t for t in after_trades if t['outperforming']]
    outperforming_metrics = compute_metrics(
        [{'actual_return': t['actual_return_after']} for t in outperforming_trades],
        'AFTER — outperforming (R:R=2.0)'
    ) if outperforming_trades else {'n': 0}
    normal_trades = [t for t in after_trades if not t['outperforming']]
    normal_metrics = compute_metrics(
        [{'actual_return': t['actual_return_after']} for t in normal_trades],
        'AFTER — normal (R:R=1.5)'
    ) if normal_trades else {'n': 0}

    # 9. Monthly breakdown
    monthly = {}
    for t in after_trades:
        month = t['prediction_date'][:7]
        if month not in monthly:
            monthly[month] = {'before': [], 'after': []}
        monthly[month]['before'].append(t['actual_return_before'])
        monthly[month]['after'].append(t['actual_return_after'])

    monthly_metrics = []
    for month in sorted(monthly.keys()):
        b_returns = monthly[month]['before']
        a_returns = monthly[month]['after']
        monthly_metrics.append({
            'month': month,
            'n': len(b_returns),
            'before_avg': round(sum(b_returns) / len(b_returns), 3) if b_returns else 0,
            'after_avg': round(sum(a_returns) / len(a_returns), 3) if a_returns else 0,
            'before_total': round(sum(b_returns), 2),
            'after_total': round(sum(a_returns), 2),
        })

    # 10. Sample trades (for report)
    sample_trades = []
    for t in after_trades[:20]:
        sample_trades.append({
            'ticker': t['ticker'],
            'date': t['prediction_date'],
            'outperforming': t['outperforming'],
            'stock_roc': t['stock_roc'],
            'benchmark_roc': t['benchmark_roc'],
            'rr_before': t['rr_before'],
            'rr_after': t['rr_after'],
            'target_before': round(t['target_before'], 2),
            'target_after': round(t['target_after'], 2),
            'stop_before': round(t['stop_before'], 2),
            'stop_after': round(t['stop_after'], 2),
            'return_before': round(t['actual_return_before'], 2),
            'return_after': round(t['actual_return_after'], 2),
            'exit_reason_after': t['exit_reason_after'],
        })

    return {
        'meta': {
            'timestamp': datetime.now().strftime('%Y%m%d_%H%M%S'),
            'archive': 'active_databases_20260817_full.zip',
            'predictions_db': PREDICTIONS_DB,
            'price_history_db': PRICE_HISTORY_DB,
            'methodology': 'before=archive actual_return | after=re-simulated with dynamic R:R + ATR clamp',
            'settings': {
                'dynamic_rr_normal': DYNAMIC_RR_NORMAL,
                'dynamic_rr_outperform': DYNAMIC_RR_OUTPERFORM,
                'atr_stop_min_pct': ATR_STOP_MIN_PCT,
                'atr_stop_max_pct': ATR_STOP_MAX_PCT,
                'hard_cap': HARD_CAP,
                'max_holding_days': MAX_HOLDING_DAYS,
                'benchmark_ticker': BENCHMARK_TICKER,
                'roc_window': ROC_WINDOW,
            },
        },
        'data_inventory': {
            'closed_trades_in_archive': len(trades),
            'simulated': len(after_trades),
            'skipped': skipped,
            'date_range': f"{trades[0]['prediction_date']} → {trades[-1]['prediction_date']}" if trades else 'N/A',
            'benchmark_dates': len(benchmark_roc),
        },
        'before_metrics': before_metrics,
        'after_metrics': after_metrics,
        'rr_distribution': {
            'before': rr_dist_before,
            'after': rr_dist_after,
        },
        'outperforming_breakdown': {
            'count': outperforming_count,
            'pct': round(outperforming_count / len(after_trades) * 100, 2) if after_trades else 0,
            'metrics': outperforming_metrics,
        },
        'normal_breakdown': {
            'count': len(normal_trades),
            'metrics': normal_metrics,
        },
        'monthly_breakdown': monthly_metrics,
        'sample_trades': sample_trades,
    }


def render_markdown(results: Dict) -> str:
    lines = []
    lines.append("# R:R-FIX Before/After Simulation Report")
    lines.append("")
    lines.append(f"**Archive:** `{results['meta']['archive']}`")
    lines.append(f"**Timestamp:** {results['meta']['timestamp']}")
    lines.append(f"**Methodology:** {results['meta']['methodology']}")
    lines.append("")
    lines.append("## Settings Used")
    lines.append("")
    lines.append("| Setting | Value |")
    lines.append("|---|---|")
    for k, v in results['meta']['settings'].items():
        lines.append(f"| {k} | {v} |")
    lines.append("")
    lines.append("## Data Inventory")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|---|---|")
    for k, v in results['data_inventory'].items():
        lines.append(f"| {k} | {v} |")
    lines.append("")
    lines.append("## BEFORE vs AFTER Metrics")
    lines.append("")
    lines.append("| Metric | BEFORE (archive) | AFTER (fix) | Δ |")
    lines.append("|---|---:|---:|---:|")
    b = results['before_metrics']
    a = results['after_metrics']
    for key in ['n', 'win_rate', 'profit_factor', 'avg_win', 'avg_loss', 'avg_return', 'expectancy', 'total_return', 'max_gain', 'max_loss']:
        bv = b.get(key, 0)
        av = a.get(key, 0)
        delta = round(av - bv, 3) if isinstance(av, (int, float)) and isinstance(bv, (int, float)) else 'N/A'
        lines.append(f"| {key} | {bv} | {av} | {delta} |")
    lines.append("")
    lines.append("## R:R Distribution")
    lines.append("")
    lines.append("| Bucket | BEFORE | AFTER |")
    lines.append("|---|---:|---:|")
    for bucket in ['1.5', '2.0', 'other']:
        lines.append(f"| R:R={bucket} | {results['rr_distribution']['before'].get(bucket, 0)} | {results['rr_distribution']['after'].get(bucket, 0)} |")
    lines.append("")
    lines.append("## Outperforming vs Normal (AFTER)")
    lines.append("")
    op = results['outperforming_breakdown']
    nm = results['normal_breakdown']
    lines.append(f"- **Outperforming (R:R=2.0):** {op['count']} trades ({op['pct']}%)")
    if op.get('metrics'):
        m = op['metrics']
        lines.append(f"  - WR={m.get('win_rate', 0)}% | PF={m.get('profit_factor', 0)} | AvgWin=+{m.get('avg_win', 0)}% | AvgLoss={m.get('avg_loss', 0)}% | Exp={m.get('expectancy', 0)}%")
    lines.append(f"- **Normal (R:R=1.5):** {nm['count']} trades")
    if nm.get('metrics'):
        m = nm['metrics']
        lines.append(f"  - WR={m.get('win_rate', 0)}% | PF={m.get('profit_factor', 0)} | AvgWin=+{m.get('avg_win', 0)}% | AvgLoss={m.get('avg_loss', 0)}% | Exp={m.get('expectancy', 0)}%")
    lines.append("")
    lines.append("## Monthly Breakdown")
    lines.append("")
    lines.append("| Month | N | BEFORE Avg | AFTER Avg | BEFORE Total | AFTER Total |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for m in results['monthly_breakdown']:
        lines.append(f"| {m['month']} | {m['n']} | {m['before_avg']}% | {m['after_avg']}% | {m['before_total']}% | {m['after_total']}% |")
    lines.append("")
    lines.append("## Sample Trades (first 20)")
    lines.append("")
    lines.append("| Ticker | Date | Outperf | Stock ROC | Bench ROC | R:R Before | R:R After | Ret Before | Ret After | Exit |")
    lines.append("|---|---|---|---:|---:|---:|---:|---:|---:|---|")
    for t in results['sample_trades']:
        lines.append(f"| {t['ticker']} | {t['date']} | {'✅' if t['outperforming'] else '—'} | {t['stock_roc']}% | {t['benchmark_roc']}% | {t['rr_before']} | {t['rr_after']} | {t['return_before']}% | {t['return_after']}% | {t['exit_reason_after']} |")
    lines.append("")
    lines.append("## Methodology Notes")
    lines.append("")
    lines.append(f"- **BEFORE:** archive `actual_return` (from original V40.2 simulation, all R:R=1.5)")
    lines.append(f"- **AFTER:** re-simulated with dynamic R:R (1.5 normal / 2.0 outperforming) + ATR stop clamp [3%, 9%]")
    lines.append(f"- **outperforming_market:** stock 14-day ROC > EGX30ETF 14-day ROC on entry date")
    lines.append(f"- **Re-simulation:** scan forward prices; stop checked before target on same day (conservative)")
    lines.append(f"- **HARD cap:** ABS(return) <= 50% applied to all metrics (CONSTITUTION Rule 7)")
    lines.append(f"- **Holding period:** max 30 trading days; time_exit uses close at day 30")
    lines.append(f"- **Equal-weight:** 100% per trade notional (no position sizing)")
    lines.append("")
    return "\n".join(lines)


def main():
    results = run_simulation()

    if 'error' in results:
        print(f"ERROR: {results['error']}")
        sys.exit(1)

    out_dir = Path(OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = results['meta']['timestamp']
    json_path = out_dir / f'rr_fix_before_after_{ts}.json'
    md_path = out_dir / f'rr_fix_before_after_{ts}.md'

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(render_markdown(results))

    print(f"\n[OK] Results saved:")
    print(f"  JSON: {json_path}")
    print(f"  MD:   {md_path}")

    # Print summary
    b = results['before_metrics']
    a = results['after_metrics']
    print(f"\n{'='*70}")
    print(f"BEFORE vs AFTER SUMMARY")
    print(f"{'='*70}")
    print(f"  BEFORE: N={b['n']} | WR={b['win_rate']}% | PF={b['profit_factor']} | Exp={b['expectancy']}% | Total={b['total_return']}%")
    print(f"  AFTER:  N={a['n']} | WR={a['win_rate']}% | PF={a['profit_factor']} | Exp={a['expectancy']}% | Total={a['total_return']}%")
    print(f"  Δ PF:   {round(a['profit_factor'] - b['profit_factor'], 3)}")
    print(f"  Δ Exp:  {round(a['expectancy'] - b['expectancy'], 3)}%")
    print(f"  Outperforming: {results['outperforming_breakdown']['count']} trades ({results['outperforming_breakdown']['pct']}%)")
    print(f"{'='*70}")


if __name__ == '__main__':
    main()
