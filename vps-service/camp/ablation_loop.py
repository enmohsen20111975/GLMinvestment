#!/usr/bin/env python3
"""
Ablation Loop on 4 months only (Jul-Oct 2026).

Step 1: Single-Block Test — each of 10 blocks alone, default params
Step 2: Parameter Tuning — 3 values for each of top 4 blocks
Step 3: Additive Combination — stack top 4 blocks one-by-one

Monthly breakdown: July, August, September, October 2026.
"""
from __future__ import annotations
import sys, json, sqlite3, math, gc, os
from pathlib import Path
from datetime import datetime
import numpy as np
from scipy.stats import spearmanr

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))
sys.path.insert(0, str(VPS / 'portfolio'))

DB_DIR = PROJECT_ROOT / 'db'
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# 4 months only
PERIOD_START = '2026-07-01'
PERIOD_END = '2026-10-31'
LOOKBACK_START = '2025-09-01'  # for SMA200 + indicators

# 15 EGX leaders (quick win universe)
UNIVERSE = [
    'COMI', 'HRHO', 'TMGH', 'ETEL', 'SWDY', 'ABUK', 'EAST',
    'MFPC', 'ORAS', 'ESRS', 'SKPC', 'CIEB', 'EKHO', 'JUFO', 'PHDC'
]

HOLDING_DAYS = 15  # exit after 15 days max
POSITION_SIZE = 0.20
STOP_LOSS_PCT = -5.0
TARGET_PCT = 10.0

# Parameter ranges (3 values each) for Step 2
PARAM_RANGES = {
    'momentum_20': {'window': [15, 20, 25]},
    'momentum_60': {'window': [40, 60, 80]},
    'volume_surge': {'threshold': [1.5, 2.0, 2.5]},
    'distance_52w': {'max_gap': [-5, -10, -15]},
    'breadth_trend': {'sma_period': [100, 150, 200]},
    'sector_leadership': {'top_n': [3, 5, 7]},
    'buy_sell_pressure': {'threshold': [20, 30, 40]},
    'volume_price_div': {'lookback': [10, 14, 20]},
}


def _sma(vals, period):
    if len(vals) < period: return None
    return sum(vals[-period:]) / period


def _load_ticker(conn, ticker):
    rows = conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker=? AND date>=? AND date<=?
        AND close_price>0 AND high_price>0 ORDER BY date
    """, (ticker, LOOKBACK_START, PERIOD_END)).fetchall()
    if len(rows) < 60: return None
    return {
        'd': [r[0] for r in rows], 'o': [float(r[1] or 0) for r in rows],
        'h': [float(r[2] or 0) for r in rows], 'l': [float(r[3] or 0) for r in rows],
        'c': [float(r[4]) for r in rows], 'v': [int(r[5] or 0) for r in rows],
    }


def calc_metrics(signals, conn):
    """Calculate PF, WR, DD, Sharpe per signal list."""
    if not signals:
        return {'signals': 0, 'wr': 0.0, 'pf': 0.0, 'max_dd': 0.0, 'sharpe': 0.0, 'avg_ret': 0.0}
    trades = []
    for s in signals:
        ep = s['entry']; stop = ep * 0.95; target = ep * 1.10
        rows = conn.execute("""
            SELECT high_price, low_price, close_price FROM price_history
            WHERE ticker=? AND date>? AND close_price>0 ORDER BY date LIMIT ?
        """, (s['ticker'], s['date'], HOLDING_DAYS)).fetchall()
        if not rows: continue
        exit_price = None
        for h, l, c in rows:
            if l and l <= stop: exit_price = stop; break
            if h and h >= target: exit_price = target; break
        if exit_price is None: exit_price = rows[-1][2] or ep
        ret = (exit_price / ep - 1) * 100
        trades.append({'ticker': s['ticker'], 'date': s['date'], 'ret': ret})
    if not trades:
        return {'signals': 0, 'wr': 0.0, 'pf': 0.0, 'max_dd': 0.0, 'sharpe': 0.0, 'avg_ret': 0.0}
    wins = [t for t in trades if t['ret'] > 0]
    losses = [t for t in trades if t['ret'] < 0]
    wr = len(wins) / len(trades) * 100
    gp = sum(t['ret'] for t in wins)
    gl = sum(abs(t['ret']) for t in losses)
    pf = gp / gl if gl > 0 else 99.99
    rets = [t['ret'] for t in trades]
    avg = sum(rets) / len(rets)
    std = math.sqrt(sum((r-avg)**2 for r in rets)/(len(rets)-1)) if len(rets) > 1 else 0
    sharpe = avg / std * math.sqrt(len(rets)) if std > 0 else 0
    # DD
    eq = 100000.0; peak = eq; dd = 0
    for t in trades:
        eq += eq * POSITION_SIZE * (t['ret'] / 100)
        peak = max(peak, eq)
        d = (peak - eq) / peak * 100
        dd = max(dd, d)
    return {'signals': len(trades), 'wr': round(wr, 1), 'pf': round(pf, 2),
            'max_dd': round(dd, 1), 'sharpe': round(sharpe, 2), 'avg_ret': round(avg, 2)}


def monthly_breakdown(signals, conn):
    """Return per-month metrics dict."""
    out = {}
    for m in ['2026-07', '2026-08', '2026-09', '2026-10']:
        msigs = [s for s in signals if s['date'].startswith(m)]
        out[m] = calc_metrics(msigs, conn)
    out['total'] = calc_metrics(signals, conn)
    return out


# ─── Step 1: Single-Block Test ───────────────────────────────────────────────

def step1_single_block(conn):
    """Test each block alone — entry if score >= 0.6."""
    print('\n' + '=' * 90)
    print('  STEP 1: Single-Block Test (10 blocks × 4 months)')
    print('=' * 90)
    from orchestrator import Orchestrator, build_price_data
    orch = Orchestrator()
    block_names = sorted(orch.blocks.keys())
    # Also add liquidity + strict_entry from old analyzers (per plan)
    extra_blocks = {}
    try:
        from analyzers.liquidity_filter import evaluate_kill_filters
        def _liquidity(ticker, date, price_data):
            closes = price_data.get('closes', [])
            volumes = price_data.get('volumes', [])
            if len(closes) < 20 or not volumes:
                return {'score': 0.5, 'raw': 0, 'reason': 'insufficient', 'metadata': {}}
            r = evaluate_kill_filters(ticker, closes=closes, volumes=volumes,
                                       current_price=closes[-1],
                                       avg_turnover=sum(c*v for c,v in zip(closes[-20:], volumes[-20:]) if c and v)/20,
                                       data_bars_count=len(closes))
            return {'score': 1.0 if r.get('passed') else 0.0, 'raw': r.get('passed', False),
                    'reason': 'PASS' if r.get('passed') else 'REJECT', 'metadata': {}}
        extra_blocks['liquidity'] = _liquidity
    except: pass
    try:
        from strict_entry_filters import evaluate_strict_entry
        def _strict_entry(ticker, date, price_data):
            closes = price_data.get('closes', [])
            highs = price_data.get('highs', [])
            lows = price_data.get('lows', [])
            volumes = price_data.get('volumes', [])
            if len(closes) < 25:
                return {'score': 0.5, 'raw': 0, 'reason': 'insufficient', 'metadata': {}}
            r = evaluate_strict_entry(closes, highs, lows, volumes)
            d = r.get('decision', 'REJECT')
            score = 0.9 if (d == 'ACCEPT' and (r.get('is_accumulation') or r.get('is_grab'))) else 0.6 if d == 'ACCEPT' else 0.2
            return {'score': score, 'raw': d, 'reason': d, 'metadata': {}}
        extra_blocks['strict_entry'] = _strict_entry
    except: pass

    all_blocks = {**orch.blocks, **extra_blocks}
    print(f'  Blocks: {sorted(all_blocks.keys())}')

    results = {}
    for bn, block_fn in all_blocks.items():
        print(f'\n  --- {bn} ---')
        signals = []
        for t in UNIVERSE:
            td = _load_ticker(conn, t)
            if not td: continue
            d, c = td['d'], td['c']
            h, l, o, v = td['h'], td['l'], td['o'], td['v']
            for i in range(60, len(c)):
                if not (PERIOD_START <= d[i] <= PERIOD_END): continue
                window_c = c[max(0,i-100):i+1]
                if len(window_c) < 50: continue
                pd = build_price_data(window_c, h[max(0,i-100):i+1], l[max(0,i-100):i+1],
                                      o[max(0,i-100):i+1], v[max(0,i-100):i+1])
                try:
                    r = block_fn(t, d[i], pd)
                    score = r.get('score', 0.5)
                except: score = 0.5
                if score >= 0.5:  # threshold lowered from 0.6 to 0.5
                    signals.append({'ticker': t, 'date': d[i], 'entry': c[i], 'block': bn})
        mb = monthly_breakdown(signals, conn)
        results[bn] = mb
        total = mb['total']
        print(f'    Total: sig={total["signals"]}, WR={total["wr"]}%, PF={total["pf"]}, DD=-{total["max_dd"]}%, Sharpe={total["sharpe"]}')
        for m in ['2026-07','2026-08','2026-09','2026-10']:
            mm = mb[m]
            print(f'      {m}: sig={mm["signals"]}, WR={mm["wr"]}%, PF={mm["pf"]}, DD=-{mm["max_dd"]}%')
        gc.collect()
    return results


# ─── Step 2: Parameter Tuning ────────────────────────────────────────────────

def step2_parameter_tuning(conn, top_blocks):
    """For top 4 blocks, try 3 param values each."""
    print('\n' + '=' * 90)
    print('  STEP 2: Parameter Tuning (3 values × top 4 blocks)')
    print('=' * 90)
    results = {}
    for bn in top_blocks:
        if bn not in PARAM_RANGES:
            print(f'\n  --- {bn}: no params to tune ---')
            results[bn] = {'default_only': True}
            continue
        print(f'\n  --- {bn} ---')
        param_name = list(PARAM_RANGES[bn].keys())[0]
        values = PARAM_RANGES[bn][param_name]
        results[bn] = {'param': param_name, 'values': {}}
        for val in values:
            print(f'    {param_name}={val}...')
            signals = _run_block_with_param(conn, bn, param_name, val)
            mb = monthly_breakdown(signals, conn)
            results[bn]['values'][val] = mb
            total = mb['total']
            print(f'      Total: sig={total["signals"]}, WR={total["wr"]}%, PF={total["pf"]}, DD=-{total["max_dd"]}%')
    return results


def _run_block_with_param(conn, block_name, param_name, param_value):
    """Run a block with a custom param value. Monkey-patch the block."""
    from orchestrator import Orchestrator, build_price_data
    orch = Orchestrator()
    if block_name not in orch.blocks:
        return []
    block = orch.blocks[block_name]
    # Save original compute
    orig_compute = block.compute
    # Wrap compute to inject param (block-specific)
    signals = []
    for t in UNIVERSE:
        td = _load_ticker(conn, t)
        if not td: continue
        d, c = td['d'], td['c']
        h, l, o, v = td['h'], td['l'], td['o'], td['v']
        for i in range(60, len(c)):
            if not (PERIOD_START <= d[i] <= PERIOD_END): continue
            window_c = c[max(0,i-100):i+1]
            if len(window_c) < 50: continue
            pd = build_price_data(window_c, h[max(0,i-100):i+1], l[max(0,i-100):i+1],
                                  o[max(0,i-100):i+1], v[max(0,i-100):i+1])
            try:
                # For momentum blocks, override window
                if block_name == 'momentum_20' and param_name == 'window':
                    closes = pd['closes']
                    if len(closes) >= param_value + 1:
                        mom = (closes[-1] - closes[-param_value-1]) / closes[-param_value-1] * 100
                        score = min(1.0, max(0.0, (mom + 10) / 20))
                    else: score = 0.5
                elif block_name == 'momentum_60' and param_name == 'window':
                    closes = pd['closes']
                    if len(closes) >= param_value + 1:
                        mom = (closes[-1] - closes[-param_value-1]) / closes[-param_value-1] * 100
                        score = min(1.0, max(0.0, (mom + 20) / 40))
                    else: score = 0.5
                elif block_name == 'volume_surge' and param_name == 'threshold':
                    volumes = pd['volumes']
                    if len(volumes) >= 21:
                        avg20 = sum(volumes[-21:-1]) / 20
                        ratio = volumes[-1] / avg20 if avg20 > 0 else 0
                        score = 1.0 if ratio >= param_value else 0.2
                    else: score = 0.5
                elif block_name == 'distance_52w' and param_name == 'max_gap':
                    highs = pd['highs']
                    closes = pd['closes']
                    high_52w = max(highs[-252:]) if len(highs) >= 252 else max(highs)
                    dist = (closes[-1] - high_52w) / high_52w * 100 if high_52w > 0 else 0
                    score = min(1.0, max(0.0, (dist - param_value) / abs(param_value)))
                else:
                    r = orig_compute(t, d[i], pd)
                    score = r.get('score', 0.5)
                if score >= 0.5:
                    signals.append({'ticker': t, 'date': d[i], 'entry': c[i], 'block': block_name})
            except: continue
    return signals


# ─── Step 3: Additive Combination ────────────────────────────────────────────

def step3_additive(conn, top_blocks):
    """Stack top blocks one-by-one. Entry if ALL active blocks have score >= 0.6."""
    print('\n' + '=' * 90)
    print('  STEP 3: Additive Combination (stack top blocks)')
    print('=' * 90)
    from orchestrator import Orchestrator, build_price_data
    orch = Orchestrator()
    results = {}
    active_blocks = []
    for step_idx, bn in enumerate(top_blocks, 1):
        active_blocks.append(bn)
        print(f'\n  --- Step {step_idx}: {active_blocks} ---')
        signals = []
        for t in UNIVERSE:
            td = _load_ticker(conn, t)
            if not td: continue
            d, c = td['d'], td['c']
            h, l, o, v = td['h'], td['l'], td['o'], td['v']
            for i in range(60, len(c)):
                if not (PERIOD_START <= d[i] <= PERIOD_END): continue
                window_c = c[max(0,i-100):i+1]
                if len(window_c) < 50: continue
                pd = build_price_data(window_c, h[max(0,i-100):i+1], l[max(0,i-100):i+1],
                                      o[max(0,i-100):i+1], v[max(0,i-100):i+1])
                # ALL active blocks must pass score >= 0.5
                all_pass = True
                for ab in active_blocks:
                    if ab in orch.blocks:
                        try:
                            r = orch.blocks[ab].compute(t, d[i], pd)
                            if r.get('score', 0) < 0.5:
                                all_pass = False; break
                        except:
                            all_pass = False; break
                if all_pass:
                    signals.append({'ticker': t, 'date': d[i], 'entry': c[i]})
        mb = monthly_breakdown(signals, conn)
        results[f'step_{step_idx}'] = {'blocks': list(active_blocks), 'metrics': mb}
        total = mb['total']
        print(f'    Total: sig={total["signals"]}, WR={total["wr"]}%, PF={total["pf"]}, DD=-{total["max_dd"]}%')
    return results


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print('=' * 90)
    print('  ABLATION LOOP — 4 months (Jul-Oct 2026)')
    print(f'  Universe: {len(UNIVERSE)} tickers')
    print('=' * 90)
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)

    # Step 1
    step1 = step1_single_block(conn)
    # Rank by PF (descending), take top 4 (only those with signals > 0)
    ranked = sorted(step1.items(), key=lambda x: -x[1]['total']['pf'])
    top_4 = [bn for bn, mb in ranked[:6] if mb['total']['signals'] > 0][:4]
    print(f'\n  Top 4 blocks: {top_4}')

    # Step 2
    step2 = step2_parameter_tuning(conn, top_4)

    # Step 3
    step3 = step3_additive(conn, top_4)

    conn.close()

    # Save
    report = {
        'period': f'{PERIOD_START} → {PERIOD_END}',
        'universe': UNIVERSE,
        'step1_single_block': step1,
        'top_4_blocks': top_4,
        'step2_param_tuning': step2,
        'step3_additive': step3,
        'timestamp': datetime.now().isoformat(),
    }
    with open(RESULTS_DIR / 'ablation_4months.json', 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f'\n  Saved: scripts/camp/results/ablation_4months.json')
    print('\n' + '=' * 90)
    print('  ABLATION LOOP COMPLETE')
    print('=' * 90)


if __name__ == '__main__':
    main()
