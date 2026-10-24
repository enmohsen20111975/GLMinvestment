"""
summary.py — Strangler Pattern module (Phase 8.2)
=================================================
Extracted from `vps-service/jobs/daily_predictor.py` run_generator()
(block at END of run_generator — lines ~4278-4329).

The original block computes:
    - Profit Factor (PF) from stored trades
    - Overall win rate + morning-bell win rate
    - Signal + evidence distributions
    - Saves a JSON summary to vps-service/backtest_results/v40_2_generation_*.json

Behavior is 100% equivalent (Strangler Pattern).
"""
from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime


def compute_and_save_summary(
    all_stored,
    daily_summary,
    total_generated,
    total_morning_bells,
    start_date,
    end_date,
    scan_interval,
    predictions_db,
    project_root,
):
    """Compute Profit Factor + win rate + signal/evidence distributions,
    print the generation-complete banner, and save a JSON summary.

    Args:
        all_stored:           list of stored signal dicts (each has pnl_pct, signal, evidence, ...).
        daily_summary:        list of per-day summary dicts.
        total_generated:      int — count of generated predictions.
        total_morning_bells:  int — count of morning bell picks.
        start_date:           str — period start.
        end_date:             str — period end.
        scan_interval:        int — date stride.
        predictions_db:       str — path to predictions.db (for the "Predictions in" print).
        project_root:         str — absolute project root (for backtest_results/ path).

    Returns:
        dict — the summary dict (also saved to JSON).
    """
    # Compute PF from stored trades
    wins_pnl = [s['pnl_pct'] for s in all_stored if s['pnl_pct'] > 0]
    losses_pnl = [abs(s['pnl_pct']) for s in all_stored if s['pnl_pct'] <= 0]
    gross_profit = sum(wins_pnl)
    gross_loss = sum(losses_pnl)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    total_wins = len(wins_pnl)
    total_picks = len(all_stored)
    overall_wr = total_wins / total_picks * 100 if total_picks else 0
    mb_wins = sum(1 for d in daily_summary if d['mb_win'])
    mb_wr = mb_wins / total_morning_bells * 100 if total_morning_bells else 0

    sig_dist = Counter(s['signal'] for s in all_stored)
    ev_dist = Counter(s['evidence'] for s in all_stored)

    print("\n" + "=" * 80, flush=True)
    print("  GENERATION COMPLETE", flush=True)
    print("=" * 80, flush=True)
    print(f"  Total predictions: {total_generated}")
    print(f"  Morning bells: {total_morning_bells} ({mb_wins} wins = {mb_wr:.1f}% WR)")
    print(f"  Overall win rate: {total_wins}/{total_picks} = {overall_wr:.1f}%")
    print(f"  Profit Factor (equity-impact): {pf:.3f}")
    print(f"  Gross profit: {gross_profit:.2f} | Gross loss: {gross_loss:.2f}")
    print(f"  Signal dist: {dict(sig_dist)}")
    print(f"  Evidence dist: {dict(sorted(ev_dist.items()))}")
    print(f"  Scan dates with picks: {len(daily_summary)}")

    summary = {
        'version': 'V40.2 (CLI-enabled, tightened entry + real benchmark + partial 1.5R)',
        'generated_at': datetime.now().isoformat(),
        'period': f'{start_date} → {end_date}',
        'scan_interval': scan_interval,
        'total_generated': total_generated,
        'total_morning_bells': total_morning_bells,
        'morning_bell_win_rate': round(mb_wr, 1),
        'overall_win_rate': round(overall_wr, 1),
        'profit_factor': round(pf, 3),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'signal_distribution': dict(sig_dist),
        'evidence_distribution': {str(k): v for k, v in sorted(ev_dist.items())},
        'scan_dates_with_picks': len(daily_summary),
        'daily': daily_summary,
    }
    summary_path = os.path.join(
        project_root, 'vps-service', 'backtest_results',
        f'v40_2_generation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json',
    )
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Summary saved: {summary_path}")
    print(f"📊 Predictions in: {predictions_db}")

    return summary
