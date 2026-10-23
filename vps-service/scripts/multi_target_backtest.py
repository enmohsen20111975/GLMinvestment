#!/usr/bin/env python3
"""
Multi-Target Exit Backtest Harness
====================================
بيشغّل 3 سياسات خروج على نفس الـ entries (التوقعات التاريخية المقفلة) ويقارن
الأداء. ده بـ يجاوب على سؤال المالك: "هل سياسة T1/T2/T3 + الـ dynamic stop
بتجيب أرباح أحسن من الـ production exit الحالي؟"

الـ 3 سياسات:
  A) **production** — العائد الفعلي المسجّل في predictions.actual_return (ground truth
     من الـ daily_closer الإنتاجي). ده الـ baseline.
  B) **multi_target** — بـ يـ re-simulate كل صفقة بـ simulate_multi_target_exit()
     (T1/T2/T3 + breakeven + persona trail). نفس الـ entries، بس exit مختلف.
  C) **multi_target_dynamic** — نفس B + volatility-expand (widen stop +0.5 ATR
     لو ATR spike > 1.5×) + win-lesson bias (hold-through + target-raise من
     learned_lessons). ده السياسة الكاملة اللي بـ enable الـ RL.

المنهجية:
  1. اقرأ كل التوقعات المقفلة من predictions.db (outcome_date IS NOT NULL)
  2. لكل توقع: اقرأ price_history للسهم من entry_date لـ outcome_date+5
  3. شغّل simulate_multi_target_exit() للسياسات B و C
  4. قارن العائد المتحقق (A) بالعائد المحاكى (B, C)
  5. احسب: win rate, avg win, avg loss, profit factor, max gain, % >+50%

Usage:
  python3 scripts/multi_target_backtest.py [--predictions-db PATH] [--price-history-db PATH] [--output PATH]
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ──────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────
_VPS_ROOT = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

from portfolio.multi_target_exit import simulate_multi_target_exit  # noqa: E402

DEFAULT_PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
DEFAULT_PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
DEFAULT_OUTPUT = str(_VPS_ROOT / 'backtest_results' / f'multi_target_backtest_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Data loading
# ──────────────────────────────────────────────────────────────────────────
def load_closed_predictions(db_path: str) -> List[Dict]:
    """حمّل كل التوقعات المقفلة من predictions.db."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # بس التوقعات اللي مقفولة فعلًا + ليها entry_price/stop_loss/actual_return
    cur.execute('''
        SELECT id, ticker, signal, persona, entry_price, target_price, stop_loss,
               atr_at_entry, actual_return, holding_days, exit_type,
               outcome_date, created_at, highest_price_reached
        FROM predictions
        WHERE outcome_date IS NOT NULL
          AND entry_price > 0
          AND stop_loss > 0
          AND target_price > 0
          AND actual_return IS NOT NULL
        ORDER BY created_at ASC
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    logger.info(f"Loaded {len(rows)} closed predictions from {db_path}")
    return rows


def load_price_history_for_ticker(db_path: str, ticker: str) -> List[Dict]:
    """حمّل price_history لسهم معيّن (مرتبة بالـ date)."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''
        SELECT date, open_price AS open, high_price AS high, low_price AS low,
               close_price AS close, volume
        FROM price_history
        WHERE ticker = ? AND close_price > 0
        ORDER BY date ASC
    ''', (ticker,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def find_entry_idx(price_history: List[Dict], entry_date: str) -> int:
    """لقّي index يوم الدخول في price_history."""
    if not entry_date:
        return -1
    entry_date_str = entry_date.split('T')[0].split(' ')[0] if entry_date else ''
    for i, bar in enumerate(price_history):
        if str(bar.get('date', '')) == entry_date_str:
            return i
    # fallback: أول bar >= entry_date
    for i, bar in enumerate(price_history):
        if str(bar.get('date', '')) >= entry_date_str:
            return i
    return -1


# ──────────────────────────────────────────────────────────────────────────
# Simulation policies
# ──────────────────────────────────────────────────────────────────────────
def simulate_policy_b(pred: Dict, price_history: List[Dict], entry_idx: int) -> Dict:
    """Policy B: multi-target exit (T1/T2/T3 + breakeven + persona trail)."""
    result = simulate_multi_target_exit(
        signal=pred.get('signal', ''),
        entry_price=float(pred['entry_price']),
        stop_loss=float(pred['stop_loss']),
        target_price=float(pred['target_price']),
        entry_idx=entry_idx,
        price_history=price_history,
        persona=(pred.get('persona') or 'balanced').lower(),
        atr_at_entry=float(pred.get('atr_at_entry') or 0),
        holdthrough_bias=0.0,   # Policy B: no RL bias
        target_raise_r=0.0,     # Policy B: no target raise
    )
    return {
        'exited': result.exited,
        'return_pct': result.realized_return_pct,
        'exit_type': result.exit_type,
        'days': result.days_to_exit,
        't1_hit': result.t1_hit,
        't2_hit': result.t2_hit,
        't3_hit': result.t3_hit,
        'highest': result.highest_price_reached,
    }


def simulate_policy_c(pred: Dict, price_history: List[Dict], entry_idx: int) -> Dict:
    """Policy C: multi-target + dynamic stop + win-lesson bias.

    بـ يستورد win_lesson_store عشان يقرأ الـ bias من learned_lessons (لو موجودة).
    لو مفيش lessons بعد → bias=0 (نفس Policy B). ده بـ يـ show الـ progression.
    """
    try:
        from utils.win_lesson_store import (
            compute_bounded_target_raise,
            compute_t1_holdthrough_bias,
        )
        persona = (pred.get('persona') or 'balanced').lower()
        raise_r = compute_bounded_target_raise(persona)
        hold_bias = compute_t1_holdthrough_bias(persona)
    except Exception:
        raise_r = 0.0
        hold_bias = 0.0

    result = simulate_multi_target_exit(
        signal=pred.get('signal', ''),
        entry_price=float(pred['entry_price']),
        stop_loss=float(pred['stop_loss']),
        target_price=float(pred['target_price']),
        entry_idx=entry_idx,
        price_history=price_history,
        persona=(pred.get('persona') or 'balanced').lower(),
        atr_at_entry=float(pred.get('atr_at_entry') or 0),
        holdthrough_bias=hold_bias,
        target_raise_r=raise_r,
    )
    return {
        'exited': result.exited,
        'return_pct': result.realized_return_pct,
        'exit_type': result.exit_type,
        'days': result.days_to_exit,
        't1_hit': result.t1_hit,
        't2_hit': result.t2_hit,
        't3_hit': result.t3_hit,
        'highest': result.highest_price_reached,
        'raise_r': raise_r,
        'hold_bias': hold_bias,
    }


# ──────────────────────────────────────────────────────────────────────────
# Metrics
# ──────────────────────────────────────────────────────────────────────────
def compute_metrics(returns: List[float], label: str) -> Dict:
    """احسب metrics من قائمة عوائد.

    🔥 data-quality: بنـ cap الـ outliers عند +500% / -100% عشان نـ avoid
    تشويه الـ avg من data errors (splits, bad bars). الـ max_gain الفعلي
    بـ يتـ report في max_gain_raw.
    """
    if not returns:
        return {'label': label, 'n': 0, 'win_rate': 0, 'avg_return': 0, 'profit_factor': 0,
                'avg_win': 0, 'avg_loss': 0, 'max_gain': 0, 'pct_gt_50': 0}
    # cap outliers for the aggregated stats (but keep raw max for transparency)
    capped = [max(-100.0, min(500.0, r)) for r in returns]
    wins = [r for r in capped if r > 0]
    losses = [r for r in capped if r < 0]
    total_profit = sum(wins)
    total_loss = abs(sum(losses))
    pf = total_profit / total_loss if total_loss > 0 else (999.0 if total_profit > 0 else 0.0)
    return {
        'label': label,
        'n': len(returns),
        'win_rate': round(len(wins) / len(returns) * 100, 1),
        'avg_return': round(sum(capped) / len(capped), 2),
        'profit_factor': round(pf, 2),
        'avg_win': round(sum(wins) / len(wins), 2) if wins else 0,
        'avg_loss': round(sum(losses) / len(losses), 2) if losses else 0,
        'max_gain': round(max(capped), 2) if capped else 0,
        'max_gain_raw': round(max(returns), 2) if returns else 0,
        'max_loss': round(min(capped), 2) if capped else 0,
        'pct_gt_50': round(len([r for r in capped if r > 50]) / len(capped) * 100, 1),
        'pct_gt_25': round(len([r for r in capped if r > 25]) / len(capped) * 100, 1),
        'total_return_pct': round(sum(capped), 2),
    }


# ──────────────────────────────────────────────────────────────────────────
# Main backtest
# ──────────────────────────────────────────────────────────────────────────
def run_backtest(predictions_db: str, price_history_db: str) -> Dict:
    """شغّل الـ backtest الكامل."""
    start_time = time.time()
    preds = load_closed_predictions(predictions_db)
    if not preds:
        return {'error': 'No closed predictions found'}

    # cache price_history per ticker (avoid re-loading)
    ph_cache: Dict[str, List[Dict]] = {}
    # 🔥 skip-reason breakdown (قبل كده كان silent skip → صعب التشخيص).
    # دلوقتي بنـ track كل سبب على حدة علشان نـ detect الـ stale price_history
    # وغيرها من مشاكل الـ data alignment بسرعة.
    skip_no_ph = 0            # السهم مش موجود في price_history خالص
    skip_short_ph = 0         # السهم موجود بس < 20 شمعة
    skip_entry_not_found = 0  # تاريخ الدخول مش موجود (غالباً price_history stale)
    skip_entry_at_end = 0     # الدخول عند آخر شمعة (مفيش forward data للمحاكاة)
    skipped = 0
    prod_returns: List[float] = []
    mt_returns: List[float] = []
    mtd_returns: List[float] = []
    per_trade: List[Dict] = []

    for i, pred in enumerate(preds):
        ticker = pred['ticker']
        if i % 100 == 0:
            logger.info(f"Processing {i+1}/{len(preds)} (ticker={ticker})...")

        if ticker not in ph_cache:
            ph_cache[ticker] = load_price_history_for_ticker(price_history_db, ticker)
        ph = ph_cache[ticker]
        if len(ph) < 20:
            if len(ph) == 0:
                skip_no_ph += 1
            else:
                skip_short_ph += 1
            skipped += 1
            continue

        entry_date = pred.get('created_at', '') or pred.get('prediction_date', '')
        entry_idx = find_entry_idx(ph, entry_date)
        if entry_idx < 0:
            skip_entry_not_found += 1
            skipped += 1
            continue
        if entry_idx >= len(ph) - 1:
            skip_entry_at_end += 1
            skipped += 1
            continue

        prod_ret = float(pred.get('actual_return') or 0)
        prod_returns.append(prod_ret)

        # Policy B: multi-target (no RL)
        b_result = simulate_policy_b(pred, ph, entry_idx)
        mt_returns.append(b_result['return_pct'])

        # Policy C: multi-target + dynamic + RL
        c_result = simulate_policy_c(pred, ph, entry_idx)
        mtd_returns.append(c_result['return_pct'])

        per_trade.append({
            'id': pred['id'],
            'ticker': ticker,
            'signal': pred['signal'],
            'persona': pred.get('persona'),
            'prod_return': round(prod_ret, 2),
            'mt_return': round(b_result['return_pct'], 2),
            'mtd_return': round(c_result['return_pct'], 2),
            'mt_exit_type': b_result['exit_type'],
            'mtd_exit_type': c_result['exit_type'],
            'mt_t1_t2_t3': f"{b_result['t1_hit']}/{b_result['t2_hit']}/{b_result['t3_hit']}",
            'mtd_raise_r': c_result.get('raise_r', 0),
            'mtd_hold_bias': c_result.get('hold_bias', 0),
        })

    elapsed = round(time.time() - start_time, 1)
    logger.info(f"Backtest complete: {len(prod_returns)} trades simulated in {elapsed}s ({skipped} skipped)")

    # 🔥 skip-reason breakdown + stale price_history detection.
    # لو >50% اتـ skip بسبب entry_not_found → على الأرجح price_history.db stale
    # (آخر شمعة أقدم من تواريخ الدخول). بنـ detect ده أوتوماتيكياً ونبعت warning واضح.
    skip_breakdown = {
        'no_price_history': skip_no_ph,
        'short_price_history': skip_short_ph,
        'entry_date_not_found': skip_entry_not_found,
        'entry_at_last_bar': skip_entry_at_end,
        'total_skipped': skipped,
    }
    if skipped > 0:
        logger.info(
            f"  Skip breakdown: no_price_history={skip_no_ph}, "
            f"<20_bars={skip_short_ph}, entry_date_not_found={skip_entry_not_found}, "
            f"entry_at_last_bar={skip_entry_at_end}"
        )

    stale_warning = None
    if skip_entry_not_found > len(preds) * 0.5:
        try:
            # آخر شمعة في كل price_history
            last_ph_dates = [
                str(ph[-1].get('date', '')) for ph in ph_cache.values()
                if ph and ph[-1].get('date')
            ]
            last_ph_date = max(last_ph_dates) if last_ph_dates else 'unknown'
            # أحدث توقع مقفول
            latest_pred_date = max(
                (str(p.get('created_at', '') or '') for p in preds),
                default='unknown'
            )[:10]
            stale_warning = (
                f"⚠️ {skip_entry_not_found}/{len(preds)} predictions have entry_date NOT FOUND in price_history. "
                f"price_history last date: {last_ph_date} | latest prediction created_at: {latest_pred_date}. "
                f"→ price_history.db is likely STALE (data-engine not backfilling recent bars)."
            )
            logger.warning(stale_warning)
        except Exception:
            pass

    return {
        'timestamp': datetime.now().isoformat(),
        'elapsed_seconds': elapsed,
        'total_predictions': len(preds),
        'simulated_trades': len(prod_returns),
        'skipped': skipped,
        'skip_breakdown': skip_breakdown,
        'stale_price_history_warning': stale_warning,
        'metrics': {
            'A_production': compute_metrics(prod_returns, 'A) Production (actual_return)'),
            'B_multi_target': compute_metrics(mt_returns, 'B) Multi-Target (T1/T2/T3)'),
            'C_multi_target_dynamic': compute_metrics(mtd_returns, 'C) Multi-Target + Dynamic + RL'),
        },
        'improvement': {
            'B_vs_A_avg_return': round(
                compute_metrics(mt_returns, 'B')['avg_return'] -
                compute_metrics(prod_returns, 'A')['avg_return'], 2
            ),
            'C_vs_A_avg_return': round(
                compute_metrics(mtd_returns, 'C')['avg_return'] -
                compute_metrics(prod_returns, 'A')['avg_return'], 2
            ),
            'C_vs_A_profit_factor': round(
                compute_metrics(mtd_returns, 'C')['profit_factor'] -
                compute_metrics(prod_returns, 'A')['profit_factor'], 2
            ),
        },
        'per_trade_sample': per_trade[:50],  # أول 50 للـ inspection
    }


def print_report(report: Dict) -> None:
    """اطبع تقرير مقروء للـ human."""
    print("\n" + "=" * 80)
    print("  MULTI-TARGET EXIT BACKTEST REPORT")
    print("=" * 80)
    print(f"  Timestamp: {report['timestamp']}")
    print(f"  Elapsed: {report['elapsed_seconds']}s")
    print(f"  Total predictions: {report['total_predictions']}")
    print(f"  Simulated trades: {report['simulated_trades']} ({report['skipped']} skipped)")

    # 🔥 skip-reason breakdown (للتشخيص السريع لمشاكل الـ data alignment)
    sb = report.get('skip_breakdown')
    if sb and sb.get('total_skipped', 0) > 0:
        print(f"  Skip breakdown:")
        print(f"    no_price_history:     {sb.get('no_price_history', 0)}")
        print(f"    <20_bars:             {sb.get('short_price_history', 0)}")
        print(f"    entry_date_not_found: {sb.get('entry_date_not_found', 0)}")
        print(f"    entry_at_last_bar:    {sb.get('entry_at_last_bar', 0)}")

    # 🔥 stale price_history warning (لو entry_not_found > 50%)
    sw = report.get('stale_price_history_warning')
    if sw:
        print(f"\n  {sw}")
    print()

    for key in ['A_production', 'B_multi_target', 'C_multi_target_dynamic']:
        m = report['metrics'][key]
        print(f"  {m['label']}")
        print(f"    N={m['n']}  Win rate={m['win_rate']}%  Avg return={m['avg_return']}%")
        print(f"    Profit factor={m['profit_factor']}  Avg win={m['avg_win']}%  Avg loss={m['avg_loss']}%")
        print(f"    Max gain={m['max_gain']}%  Max loss={m['max_loss']}%")
        print(f"    % trades >+25%: {m.get('pct_gt_25', 0)}%  >+50%: {m.get('pct_gt_50', 0)}%")
        print(f"    Total return: {m.get('total_return_pct', 0)}%")
        print()

    imp = report['improvement']
    print("  " + "-" * 76)
    print("  IMPROVEMENT (vs Production baseline):")
    print(f"    B (Multi-Target)            avg return: {imp['B_vs_A_avg_return']:+.2f}pp")
    print(f"    C (Multi-Target+Dynamic+RL) avg return: {imp['C_vs_A_avg_return']:+.2f}pp")
    print(f"    C (Multi-Target+Dynamic+RL) profit factor: {imp['C_vs_A_profit_factor']:+.2f}")
    print("=" * 80 + "\n")


def main():
    parser = argparse.ArgumentParser(description='Multi-Target Exit Backtest')
    parser.add_argument('--predictions-db', default=DEFAULT_PREDICTIONS_DB)
    parser.add_argument('--price-history-db', default=DEFAULT_PRICE_HISTORY_DB)
    parser.add_argument('--output', default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    report = run_backtest(args.predictions_db, args.price_history_db)
    print_report(report)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    logger.info(f"Report saved to {args.output}")


if __name__ == '__main__':
    main()
