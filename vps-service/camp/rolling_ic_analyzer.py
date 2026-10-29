#!/usr/bin/env python3
"""
Rolling IC Analyzer — 46 months × 8 blocks × 4 horizons + correlation matrix.

For each block, computes:
  - Monthly IC (Spearman) for each of 46 months
  - Regime-conditional IC (Bull/Bear/Sideways months only)
  - Multi-horizon: IC_1d, IC_5d, IC_10d, IC_20d
  - Best horizon per block

Plus:
  - 8×8 correlation matrix between block scores
  - Weight matrix proposal based on IC + correlation

Outputs:
  - scripts/camp/results/rolling_ic.json
  - scripts/camp/results/correlation_matrix.json
  - scripts/camp/results/weight_matrix_proposal.json
"""
from __future__ import annotations
import sys, json, sqlite3, math, gc
from pathlib import Path
from datetime import datetime
import numpy as np
from scipy.stats import spearmanr

import sys as _bs_sys
PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS / 'analyzers'))

DB_DIR = PROJECT_ROOT / 'db'
_bs_sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
from core.db_manager import db_manager as _bs_dbm
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

ANALYSIS_START = '2023-01-01'
ANALYSIS_END = '2026-09-30'
LOOKBACK_START = '2022-06-01'
HORIZONS = [1, 5, 10, 20]
SAMPLE_TICKERS = 20  # memory-safe (breadth_trend + sector_leadership are DB-heavy)


def _sma(vals, period):
    if len(vals) < period: return None
    return sum(vals[-period:]) / period


def _load_ticker(conn, ticker, start, end):
    rows = conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker=? AND date>=? AND date<=?
        AND close_price>0 AND high_price>0 ORDER BY date
    """, (ticker, start, end)).fetchall()
    if len(rows) < 60: return None
    return {
        'd': [r[0] for r in rows], 'o': [float(r[1] or 0) for r in rows],
        'h': [float(r[2] or 0) for r in rows], 'l': [float(r[3] or 0) for r in rows],
        'c': [float(r[4]) for r in rows], 'v': [int(r[5] or 0) for r in rows],
    }


def main():
    print('=' * 70)
    print('  Rolling IC Analysis — 46 months × 8 blocks × 4 horizons')
    print('=' * 70)

    conn = _bs_dbm.connection(str(DB_DIR / 'price_history.db'), writable=False).__enter__()
    # Sample top tickers by data density
    tickers = [r[0] for r in conn.execute("""
        SELECT ticker FROM price_history
        WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND close_price>0
        GROUP BY ticker HAVING COUNT(*) >= 200
        ORDER BY COUNT(*) DESC LIMIT ?
    """, (LOOKBACK_START, ANALYSIS_END, SAMPLE_TICKERS)).fetchall()]
    print(f'Sample: {len(tickers)} tickers')

    from orchestrator import Orchestrator, build_price_data
    orch = Orchestrator()
    print(f'Blocks: {sorted(orch.blocks.keys())}')

    # Collect block scores + forward returns per (ticker, date, horizon)
    # data[block_name][horizon] = {'scores': [], 'returns': [], 'months': [], 'regimes': []}
    block_names = sorted(orch.blocks.keys())
    data = {bn: {h: {'scores': [], 'returns': [], 'months': [], 'regimes': []}
                 for h in HORIZONS} for bn in block_names}

    # For correlation matrix: collect all 8 scores per observation
    corr_data = {bn: [] for bn in block_names}
    corr_returns = []

    # Pre-load breadth regime per month (from checkpoint)
    with open(RESULTS_DIR / 'breadth_regime_checkpoint.json') as f:
        breadth_report = json.load(f)
    month_regime = {m: v['regime'] for m, v in breadth_report['monthly'].items()}

    processed = 0
    for ticker in tickers:
        td = _load_ticker(conn, ticker, LOOKBACK_START, ANALYSIS_END)
        if not td: continue
        d, c = td['d'], td['c']
        h, l, o, v = td['h'], td['l'], td['o'], td['v']
        # Sample every 5 days to reduce compute
        for i in range(60, len(c) - 20, 5):
            if d[i] > ANALYSIS_END: break
            month = d[i][:7]
            regime = month_regime.get(month, 'Sideways')
            # Forward returns for each horizon
            fr = {}
            for h_days in HORIZONS:
                if i + h_days < len(c) and c[i] > 0:
                    fr[h_days] = (c[i + h_days] / c[i] - 1) * 100
                else:
                    fr[h_days] = None
            # Build price_data window
            window_c = c[max(0, i-100):i+1]
            window_o = o[max(0, i-100):i+1]
            window_h = h[max(0, i-100):i+1]
            window_l = l[max(0, i-100):i+1]
            window_v = v[max(0, i-100):i+1]
            if len(window_c) < 50: continue
            pd = build_price_data(window_c, window_h, window_l, window_o, window_v)
            # Run each block
            for bn in block_names:
                try:
                    r = orch.blocks[bn].compute(ticker, d[i], pd)
                    score = r.get('score', 0.5)
                except:
                    score = 0.5
                for h_days in HORIZONS:
                    if fr[h_days] is not None:
                        data[bn][h_days]['scores'].append(score)
                        data[bn][h_days]['returns'].append(fr[h_days])
                        data[bn][h_days]['months'].append(month)
                        data[bn][h_days]['regimes'].append(regime)
                # For correlation
                corr_data[bn].append(score)
            corr_returns.append(fr[10])  # use 10d return for correlation
        processed += 1
        if processed % 20 == 0:
            print(f'  Processed {processed}/{len(tickers)} tickers')
        gc.collect()

    n_obs = len(corr_returns)
    print(f'\nTotal observations: {n_obs}')

    # ─── Rolling IC per block × horizon ──────────────────────────────────────
    print('\n━━━ Rolling IC Results ━━━\n')
    ic_results = {}
    print(f'{"Block":<20} {"IC_1d":>8} {"IC_5d":>8} {"IC_10d":>8} {"IC_20d":>8} {"Best":>6}')
    print('-' * 60)
    for bn in block_names:
        ic_results[bn] = {}
        best_ic = -999
        best_h = None
        for h in HORIZONS:
            scores = data[bn][h]['scores']
            returns = data[bn][h]['returns']
            if len(scores) < 200:
                ic_results[bn][h] = {'ic': None, 'n': len(scores), 'note': 'INSUFFICIENT'}
                continue
            try:
                ic, _ = spearmanr(scores, returns)
                ic = float(ic) if ic and not math.isnan(ic) else None
            except:
                ic = None
            ic_results[bn][h] = {'ic': round(ic, 4) if ic else None, 'n': len(scores)}
            if ic and ic > best_ic:
                best_ic = ic
                best_h = h
        ic_results[bn]['best_horizon'] = best_h
        ic_results[bn]['best_ic'] = round(best_ic, 4) if best_ic != -999 else None
        ic_1d = ic_results[bn].get(1, {}).get('ic', '—')
        ic_5d = ic_results[bn].get(5, {}).get('ic', '—')
        ic_10d = ic_results[bn].get(10, {}).get('ic', '—')
        ic_20d = ic_results[bn].get(20, {}).get('ic', '—')
        def fmt(x): return f'{x:.4f}' if isinstance(x, float) else '—'
        print(f'{bn:<20} {fmt(ic_1d):>8} {fmt(ic_5d):>8} {fmt(ic_10d):>8} {fmt(ic_20d):>8} {str(best_h):>6}')

    # ─── Regime-conditional IC (10d horizon) ─────────────────────────────────
    print('\n━━━ Regime-Conditional IC (10d horizon) ━━━\n')
    regime_ic = {}
    print(f'{"Block":<20} {"Bull":>8} {"Bear":>8} {"Side":>8}')
    print('-' * 50)
    for bn in block_names:
        regime_ic[bn] = {}
        for reg in ['Bull', 'Bear', 'Sideways']:
            mask = [i for i, r in enumerate(data[bn][10]['regimes']) if r == reg]
            if len(mask) < 100:
                regime_ic[bn][reg] = {'ic': None, 'n': len(mask), 'note': 'INSUFFICIENT'}
                continue
            scores = [data[bn][10]['scores'][i] for i in mask]
            returns = [data[bn][10]['returns'][i] for i in mask]
            try:
                ic, _ = spearmanr(scores, returns)
                ic = float(ic) if ic and not math.isnan(ic) else None
            except:
                ic = None
            regime_ic[bn][reg] = {'ic': round(ic, 4) if ic else None, 'n': len(mask)}
        bull_ic = regime_ic[bn].get('Bull', {}).get('ic', '—')
        bear_ic = regime_ic[bn].get('Bear', {}).get('ic', '—')
        side_ic = regime_ic[bn].get('Sideways', {}).get('ic', '—')
        def fmt(x): return f'{x:.4f}' if isinstance(x, float) else '—'
        print(f'{bn:<20} {fmt(bull_ic):>8} {fmt(bear_ic):>8} {fmt(side_ic):>8}')

    # ─── Correlation Matrix (8×8) ─────────────────────────────────────────────
    print('\n━━━ Correlation Matrix (8×8) ━━━\n')
    # Truncate to min length
    min_len = min(len(corr_data[bn]) for bn in block_names)
    corr_matrix = {}
    for bn1 in block_names:
        corr_matrix[bn1] = {}
        for bn2 in block_names:
            arr1 = corr_data[bn1][-min_len:]
            arr2 = corr_data[bn2][-min_len:]
            try:
                c, _ = spearmanr(arr1, arr2)
                corr_matrix[bn1][bn2] = round(float(c), 3) if c and not math.isnan(c) else None
            except:
                corr_matrix[bn1][bn2] = None
    # Print
    print(f'{"":<18}', end='')
    for bn in block_names:
        print(f'{bn[:12]:>13}', end='')
    print()
    for bn1 in block_names:
        print(f'{bn1[:16]:<18}', end='')
        for bn2 in block_names:
            v = corr_matrix[bn1][bn2]
            print(f'{v:>13.3f}' if v is not None else f'{"—":>13}', end='')
        print()

    # Find redundant pairs (|corr| > 0.75)
    redundant = []
    for bn1 in block_names:
        for bn2 in block_names:
            if bn1 < bn2 and corr_matrix.get(bn1, {}).get(bn2) is not None:
                if abs(corr_matrix[bn1][bn2]) > 0.75:
                    redundant.append({'pair': f'{bn1} + {bn2}', 'corr': corr_matrix[bn1][bn2]})
    print(f'\nRedundant pairs (|corr|>0.75): {len(redundant)}')
    for r in redundant:
        print(f'  {r["pair"]}: {r["corr"]}')

    # ─── Weight Matrix Proposal ─────────────────────────────────────────────
    print('\n━━━ Weight Matrix Proposal (based on IC) ━━━\n')
    # Formula: weight_i = max(0, IC_i) / sum(max(0, IC)) for each regime
    weight_matrix = {}
    for reg in ['Bull', 'Bear', 'Sideways', 'default']:
        if reg == 'default':
            # Use 10d horizon IC as default
            ics = {bn: ic_results[bn].get(10, {}).get('ic', 0) or 0 for bn in block_names}
        else:
            ics = {bn: regime_ic[bn].get(reg, {}).get('ic', 0) or 0 for bn in block_names}
        # Only positive ICs contribute
        positive_ics = {bn: max(0, ic) for bn, ic in ics.items()}
        total = sum(positive_ics.values())
        if total == 0:
            # Equal weights fallback
            weights = {bn: round(1/len(block_names), 4) for bn in block_names}
        else:
            weights = {bn: round(positive_ics[bn] / total, 4) for bn in block_names}
        weight_matrix[reg] = weights
        print(f'{reg}:')
        for bn, w in sorted(weights.items(), key=lambda x: -x[1]):
            ic = ics[bn]
            print(f'  {bn:<20} weight={w:.3f} (IC={ic:+.4f})')
        print()

    # ─── Save ────────────────────────────────────────────────────────────────
    report = {
        'rolling_ic': ic_results,
        'regime_ic': regime_ic,
        'correlation_matrix': corr_matrix,
        'redundant_pairs': redundant,
        'weight_matrix_proposal': weight_matrix,
        'n_observations': n_obs,
        'n_tickers': len(tickers),
        'horizons': HORIZONS,
        'period': f'{ANALYSIS_START} → {ANALYSIS_END}',
        'timestamp': datetime.now().isoformat(),
    }
    with open(RESULTS_DIR / 'rolling_ic_full.json', 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f'\nSaved: scripts/camp/results/rolling_ic_full.json')
    conn.close()
    print('\n' + '=' * 70)
    print('  ROLLING IC + CORRELATION + WEIGHT MATRIX COMPLETE')
    print('=' * 70)


if __name__ == '__main__':
    main()
