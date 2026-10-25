#!/usr/bin/env python3
"""
Stage E — Fundamentals Historical Test (Before/After)
=====================================================
يقيس: هل fundamental_score الحقيقي (من tab_*) يحسّن اختيار الأسهم؟

المنهجية (read-only على predictions.db):
1. حمّل كل التوقعات المغلقة (148 صفقة)
2. احسب fundamental_score لكل ticker (via fundamental_data_provider)
3. 3 سيناريوهات:
   S0: Baseline — كل الصفقات (score=50 للجميع، لا gate)
   S1: Informational — fundamental_score كمعلومة فقط (لا gate)، قِس الأداء حسب شريحة الـ score
   S2: Conservative gate — ارفض BUY لـ persona=conservative لو score < 40 AND confidence > 70
4. لكل سيناريو: WR, PF, AvgWin, AvgLoss, Expectancy, Total Return
5. HARD cap: ABS(actual_return) <= 50 (مخفي بالـ 50cap)
6. Dedup: السهم = صفقة واحدة في overall (أول صفقة مغلقة لكل ticker)

Output:
  vps-service/backtest_results/fundamentals_hist_test_YYYYMMDD.json
  Documentation/FUNDAMENTALS_HISTORICAL_TEST_REPORT.md
"""

import os
import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Add vps-service to path
_VPS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_VPS))
os.environ['DATA_ENGINE_DB'] = str(_VPS.parent / 'db' / 'vps_real' / 'data_engine.db')

from analyzers.fundamental_data_provider import get_fundamental_score

PREDICTIONS_DB = str(_VPS.parent / 'db' / 'vps_real' / 'predictions.db')
OUTPUT_DIR = _VPS / 'backtest_results'
OUTPUT_DIR.mkdir(exist_ok=True)

HARD_CAP = 50.0  # ABS(actual_return) <= 50


def load_closed_predictions():
    """Load all closed predictions from predictions.db (READ-ONLY)."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(PREDICTIONS_DB, writable=False)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT ticker, persona, prediction_date, signal, entry_price, target_price, stop_loss,
               actual_return, exit_type, hit_target, hit_stop, holding_days, market
        FROM predictions
        WHERE actual_return IS NOT NULL
          AND signal IN ('BUY', 'STRONG_BUY')
        ORDER BY ticker, prediction_date
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def apply_hard_cap(ret):
    """Clamp return to [-50, +50]."""
    if ret is None:
        return None
    return max(-HARD_CAP, min(HARD_CAP, ret))


def dedup_by_ticker(trades):
    """Keep only the FIRST closed trade per ticker (overall dedup)."""
    seen = set()
    out = []
    for t in trades:
        if t['ticker'] not in seen:
            seen.add(t['ticker'])
            out.append(t)
    return out


def compute_kpi(trades):
    """Compute WR, PF, AvgWin, AvgLoss, Expectancy, Total."""
    if not trades:
        return {'n': 0, 'wr': 0, 'pf': 0, 'avg_win': 0, 'avg_loss': 0, 'expectancy': 0, 'total': 0}
    n = len(trades)
    rets = [apply_hard_cap(t['actual_return']) for t in trades]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r < 0]
    wr = len(wins) / n * 100
    pf = sum(wins) / abs(sum(losses)) if losses else (float('inf') if wins else 0)
    avg_win = sum(wins) / len(wins) if wins else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    expectancy = sum(rets) / n
    total = sum(rets)
    return {
        'n': n, 'wr': round(wr, 2),
        'pf': round(pf, 3) if pf != float('inf') else 'inf',
        'avg_win': round(avg_win, 3), 'avg_loss': round(avg_loss, 3),
        'expectancy': round(expectancy, 3), 'total': round(total, 3),
    }


def run_scenarios(trades, scores):
    """Run the 3 scenarios."""
    # Attach scores to trades
    for t in trades:
        s = scores.get(t['ticker'], {})
        t['fundamental_score'] = s.get('score')
        t['fundamental_confidence'] = s.get('confidence', 0)
        t['fundamental_available'] = s.get('available', False)

    # Dedup for overall
    deduped = dedup_by_ticker(trades)

    # ─── S0: Baseline (all trades, no gate) ───
    s0 = compute_kpi(deduped)

    # ─── S1: Informational — score tiers (no gating, just measure) ───
    high_score = [t for t in deduped if t['fundamental_score'] is not None and t['fundamental_score'] >= 70]
    mid_score = [t for t in deduped if t['fundamental_score'] is not None and 40 <= t['fundamental_score'] < 70]
    low_score = [t for t in deduped if t['fundamental_score'] is not None and t['fundamental_score'] < 40]
    no_score = [t for t in deduped if t['fundamental_score'] is None]

    s1 = {
        'high_score_ge70': compute_kpi(high_score),
        'mid_score_40_70': compute_kpi(mid_score),
        'low_score_lt40': compute_kpi(low_score),
        'no_score': compute_kpi(no_score),
    }

    # ─── S2: Conservative gate ───
    # For persona=conservative: reject BUY if score < 40 AND confidence > 70
    # Other personas: keep all
    s2_trades = []
    s2_rejected = []
    for t in deduped:
        persona = (t.get('persona') or '').lower()
        if persona == 'conservative':
            if (t['fundamental_score'] is not None and t['fundamental_score'] < 40
                    and t['fundamental_confidence'] > 70):
                s2_rejected.append(t)
                continue
        s2_trades.append(t)
    s2 = {
        'result': compute_kpi(s2_trades),
        'rejected_n': len(s2_rejected),
        'rejected_tickers': [t['ticker'] for t in s2_rejected],
    }

    # ─── S3 (bonus): Hard veto — reject ALL BUY if score < 30 (any persona) ───
    s3_trades = [t for t in deduped if not (t['fundamental_score'] is not None and t['fundamental_score'] < 30)]
    s3_rejected = [t for t in deduped if t['fundamental_score'] is not None and t['fundamental_score'] < 30]
    s3 = {
        'result': compute_kpi(s3_trades),
        'rejected_n': len(s3_rejected),
        'rejected_tickers': [t['ticker'] for t in s3_rejected],
    }

    return {
        'S0_baseline': s0,
        'S1_informational_tiers': s1,
        'S2_conservative_gate': s2,
        'S3_hard_veto_lt30': s3,
    }


def main():
    print("=" * 70)
    print("Stage E — Fundamentals Historical Test")
    print("=" * 70)
    print(f"predictions.db: {PREDICTIONS_DB}")
    print(f"data_engine.db: {os.environ['DATA_ENGINE_DB']}")
    print()

    # Load trades
    trades = load_closed_predictions()
    print(f"Loaded {len(trades)} closed BUY/STRONG_BUY predictions")

    # Compute scores for all tickers
    tickers = list(set(t['ticker'] for t in trades))
    print(f"Computing fundamental_score for {len(tickers)} distinct tickers...")
    scores = {}
    for t in tickers:
        scores[t] = get_fundamental_score(t)
    avail = sum(1 for s in scores.values() if s['available'])
    print(f"  available: {avail}/{len(tickers)} ({avail/len(tickers)*100:.1f}%)")

    # Run scenarios
    results = run_scenarios(trades, scores)

    # Print summary
    print()
    print("=" * 70)
    print("RESULTS")
    print("=" * 70)

    print("\n--- S0: Baseline (all trades, dedup by ticker) ---")
    s0 = results['S0_baseline']
    print(f"  n={s0['n']} WR={s0['wr']}% PF={s0['pf']} Exp={s0['expectancy']}% Total={s0['total']}%")

    print("\n--- S1: Informational (score tiers) ---")
    for tier, kpi in results['S1_informational_tiers'].items():
        print(f"  {tier:25s} n={kpi['n']:>3} WR={kpi['wr']}% PF={kpi['pf']} Exp={kpi['expectancy']}% Total={kpi['total']}%")

    print("\n--- S2: Conservative gate (reject score<40 + conf>70 for conservative persona) ---")
    s2 = results['S2_conservative_gate']
    print(f"  result: n={s2['result']['n']} WR={s2['result']['wr']}% PF={s2['result']['pf']} Exp={s2['result']['expectancy']}% Total={s2['result']['total']}%")
    print(f"  rejected: {s2['rejected_n']} ({s2['rejected_tickers']})")

    print("\n--- S3: Hard veto (reject ALL score<30, any persona) ---")
    s3 = results['S3_hard_veto_lt30']
    print(f"  result: n={s3['result']['n']} WR={s3['result']['wr']}% PF={s3['result']['pf']} Exp={s3['result']['expectancy']}% Total={s3['result']['total']}%")
    print(f"  rejected: {s3['rejected_n']} ({s3['rejected_tickers']})")

    # Per-ticker detail
    print("\n--- Per-ticker detail (deduped) ---")
    deduped = dedup_by_ticker(trades)
    for t in sorted(deduped, key=lambda x: x['fundamental_score'] or -1, reverse=True):
        ret = apply_hard_cap(t['actual_return'])
        print(f"  {t['ticker']:10s} score={str(t['fundamental_score']):>6} conf={t['fundamental_confidence']:>5} "
              f"persona={str(t.get('persona'))[:12]:12s} ret={ret:>+7.2f}% exit={t.get('exit_type','')}")

    # Save JSON
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_json = OUTPUT_DIR / f'fundamentals_hist_test_{ts}.json'
    # Attach per-ticker detail to results
    results['_per_ticker'] = [
        {
            'ticker': t['ticker'],
            'fundamental_score': t['fundamental_score'],
            'fundamental_confidence': t['fundamental_confidence'],
            'persona': t.get('persona'),
            'actual_return_capped': apply_hard_cap(t['actual_return']),
            'exit_type': t.get('exit_type'),
            'prediction_date': t['prediction_date'],
        }
        for t in sorted(deduped, key=lambda x: x['fundamental_score'] or -1, reverse=True)
    ]
    results['_meta'] = {
        'archive': 'active_databases_20260817_full.zip',
        'predictions_db': PREDICTIONS_DB,
        'data_engine_db': os.environ['DATA_ENGINE_DB'],
        'total_trades': len(trades),
        'deduped_trades': len(deduped),
        'tickers_with_fundamentals': avail,
        'tickers_total': len(tickers),
        'hard_cap': HARD_CAP,
        'timestamp': ts,
    }
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n✅ JSON saved: {out_json}")

    return results, out_json


if __name__ == '__main__':
    main()
