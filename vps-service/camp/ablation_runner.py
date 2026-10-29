#!/usr/bin/env python3
"""
Ablation Runner — runs the 11 experiments (Exp_0..Exp_V38) on DEV set
with monthly breakdown, then Holdout verification.

Driven by camp/orchestrator.py. Writes a single final report.

Rule 4: 2 files only (this + orchestrator.py).
Rule 75: commit + push after each phase.
"""
from __future__ import annotations

import sys
import os
import json
import math
import time
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Path setup
import sys as _bs_sys
PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))
sys.path.insert(0, str(VPS / 'portfolio'))

from orchestrator import (
    FEATURES, HARD_GATES, SOFT_SCORES, SOFT_WEIGHT, COMPOSITE_THRESHOLD,
    build_price_data, run_pipeline, DecisionLogger, V38Reference,
    OrchestratorDecision, FeatureResult,
)

DB_DIR = PROJECT_ROOT / 'db'
_bs_sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
from core.db_manager import db_manager as _bs_dbm
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
REPORTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'reports'
UNIVERSE_FILE = PROJECT_ROOT / 'scripts' / 'camp' / 'universe_250.json'

# Data split (Scenario B — price_history.db ends 2026-06-10)
DEV = ('2026-01-01', '2026-02-28')          # 41 trading days
VAL = ('2026-03-01', '2026-04-30')          # 45 trading days
HOLDOUT = ('2026-05-01', '2026-06-10')      # 28 trading days (locked)
HOLDING_DAYS = 30
POSITION_SIZE = 0.20


# ─── Experiment configurations ───────────────────────────────────────────────

def _cfg(exp_id: str, hard: List[str], soft: List[str], threshold: float = COMPOSITE_THRESHOLD) -> Dict:
    return {
        'exp_id': exp_id,
        'hard_gates': hard,
        'soft_scores': soft,
        'soft_weights': {k: SOFT_WEIGHT for k in soft},
        'composite_threshold': threshold,
    }


EXPERIMENTS = [
    # Exp_0: no features — every stock passes (baseline). threshold=0 + composite forced to 1.0
    {'id': 'Exp_0', 'name': 'baseline (no features)',
     'enabled': [], 'config': _cfg('Exp_0', [], [], threshold=0.0)},
    # Exp_1: liquidity + risk (floor)
    {'id': 'Exp_1', 'name': 'liquidity + risk (floor)',
     'enabled': ['liquidity', 'risk'],
     'config': _cfg('Exp_1', ['liquidity'], ['risk'])},
    # Exp_2: + regime (soft)
    {'id': 'Exp_2', 'name': '+ regime (soft)',
     'enabled': ['liquidity', 'risk', 'regime'],
     'config': _cfg('Exp_2', ['liquidity'], ['risk', 'regime'])},
    # Exp_3: + whale_guard (hard)
    {'id': 'Exp_3', 'name': '+ whale_guard (hard)',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard'],
     'config': _cfg('Exp_3', ['liquidity', 'whale_guard'], ['risk', 'regime'])},
    # Exp_4: + strict_entry (soft)
    {'id': 'Exp_4', 'name': '+ strict_entry (soft)',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard', 'strict_entry'],
     'config': _cfg('Exp_4', ['liquidity', 'whale_guard'], ['risk', 'regime', 'strict_entry'])},
    # Exp_5: + sector_heat
    {'id': 'Exp_5', 'name': '+ sector_heat',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard', 'strict_entry', 'sector_heat'],
     'config': _cfg('Exp_5', ['liquidity', 'whale_guard'], ['risk', 'regime', 'strict_entry', 'sector_heat'])},
    # Exp_6: + fundamentals
    {'id': 'Exp_6', 'name': '+ fundamentals',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard', 'strict_entry', 'sector_heat', 'fundamentals'],
     'config': _cfg('Exp_6', ['liquidity', 'whale_guard'], ['risk', 'regime', 'strict_entry', 'sector_heat', 'fundamentals'])},
    # Exp_7: + news_stop (hard)
    {'id': 'Exp_7', 'name': '+ news_stop (hard)',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard', 'strict_entry', 'sector_heat', 'fundamentals', 'news_stop'],
     'config': _cfg('Exp_7', ['liquidity', 'whale_guard', 'news_stop'], ['risk', 'regime', 'strict_entry', 'sector_heat', 'fundamentals'])},
    # Exp_8: + exit_logic (soft)
    {'id': 'Exp_8', 'name': '+ exit_logic',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard', 'strict_entry', 'sector_heat', 'fundamentals', 'news_stop', 'exit_logic'],
     'config': _cfg('Exp_8', ['liquidity', 'whale_guard', 'news_stop'], ['risk', 'regime', 'strict_entry', 'sector_heat', 'fundamentals', 'exit_logic'])},
    # Exp_9: strict_entry → hard (promote if Exp_4 KEEP — we run it anyway for data)
    {'id': 'Exp_9', 'name': 'strict_entry → hard',
     'enabled': ['liquidity', 'risk', 'regime', 'whale_guard', 'strict_entry', 'sector_heat', 'fundamentals', 'news_stop'],
     'config': _cfg('Exp_9', ['liquidity', 'whale_guard', 'news_stop', 'strict_entry'], ['risk', 'regime', 'sector_heat', 'fundamentals'])},
    # Exp_V38: V38 reference (handled separately)
    {'id': 'Exp_V38', 'name': 'V38 reference', 'enabled': None, 'config': None, 'is_v38': True},
]


# ─── Metrics calculation ────────────────────────────────────────────────────

def calc_metrics(signals: List[Dict], conn: sqlite3.Connection) -> Dict:
    if not signals:
        return {'signals': 0, 'wr': 0.0, 'pf': 0.0, 'max_dd': 0.0, 'avg_ret': 0.0, 'sharpe': 0.0, 'expectancy': 0.0}
    wins = losses = evens = 0
    gross_profit = gross_loss = 0.0
    equity = 100000.0
    peak = equity
    max_dd = 0.0
    returns = []
    for s in signals:
        ep = s.get('entry')
        stop = s.get('stop') or (ep * 0.95)   # default -5% stop if none provided
        target = s.get('target') or (ep * 1.10)  # default +10% target if none provided
        ticker = s['ticker']
        date = s['date']
        if not ep or ep <= 0:
            continue
        rows = conn.execute("""
            SELECT high_price, low_price, close_price FROM price_history
            WHERE ticker=? AND date>? AND close_price>0 ORDER BY date LIMIT ?
        """, (ticker, date, HOLDING_DAYS)).fetchall()
        exit_price = None
        outcome = 'EXPIRED'
        for h, lo, c in rows:
            if lo and stop and lo <= stop:
                exit_price = stop
                outcome = 'STOPPED'
                break
            if h and target and h >= target:
                exit_price = target
                outcome = 'TARGET_HIT'
                break
        if exit_price is None and rows:
            exit_price = rows[-1][2] or ep
        if exit_price is None:
            continue
        ret = (exit_price / ep - 1) * 100
        returns.append(ret)
        if outcome == 'TARGET_HIT':
            wins += 1
            gross_profit += ret
        elif outcome == 'STOPPED':
            losses += 1
            gross_loss += abs(ret)
        else:
            evens += 1
            if ret > 0:
                gross_profit += ret
            else:
                gross_loss += abs(ret)
        equity += equity * POSITION_SIZE * (ret / 100)
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)
    n = len(signals)
    n_with_ret = len(returns)
    wr = (wins / n_with_ret * 100) if n_with_ret > 0 else 0
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (float('inf') if gross_profit > 0 else 0)
    if pf == float('inf'):
        pf = 99.99
    avg_ret = (sum(returns) / n_with_ret) if returns else 0
    std = math.sqrt(sum((r - avg_ret) ** 2 for r in returns) / (n_with_ret - 1)) if n_with_ret > 1 else 0
    sharpe = (avg_ret / std * math.sqrt(n_with_ret)) if std > 0 else 0
    expectancy = avg_ret  # simple expectancy = avg return per trade
    return {
        'signals': n_with_ret, 'wr': round(wr, 1), 'pf': round(pf, 2),
        'max_dd': round(max_dd, 1), 'avg_ret': round(avg_ret, 2),
        'sharpe': round(sharpe, 2), 'expectancy': round(expectancy, 2),
        'wins': wins, 'losses': losses, 'evens': evens,
    }


# ─── Experiment runner (orchestrator features) ──────────────────────────────

def run_experiment(exp: Dict, tickers: List[str], period: Tuple[str, str],
                   conn: sqlite3.Connection, ctx: Dict, logger: DecisionLogger) -> Dict:
    exp_id = exp['id']
    exp_name = exp['name']
    enabled = exp.get('enabled') or []
    config = exp.get('config') or _cfg(exp_id, [], [])
    start_date, end_date = period

    # Pre-load all ticker history (with lookback 60 days before start for indicators)
    lookback_start = '2025-10-01'  # 3 months lookback
    print(f'  [{exp_id}] Loading price history ({lookback_start} → {end_date})...')
    ticker_data = {}
    for t in tickers:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker=? AND date>=? AND date<=?
            AND close_price>0 ORDER BY date
        """, (t, lookback_start, end_date)).fetchall()
        if len(rows) < 60:
            continue
        ticker_data[t] = {
            'd': [r[0] for r in rows],
            'o': [r[1] for r in rows],
            'h': [r[2] for r in rows],
            'l': [r[3] for r in rows],
            'c': [r[4] for r in rows],
            'v': [r[5] for r in rows],
        }
    print(f'  [{exp_id}] {len(ticker_data)} tickers loaded')

    # Generate signals
    signals = []
    monthly_signals = {'01': [], '02': [], '03': [], '04': [], '05': [], '06': []}
    decisions_logged = 0
    for t, data in ticker_data.items():
        d_arr = data['d']
        c_arr = data['c']
        date_lookup = {d_arr[i]: i for i in range(len(d_arr))}
        # Iterate over trading days in [start_date, end_date]
        for i in range(60, len(d_arr)):
            td = d_arr[i]
            if not (start_date <= td <= end_date):
                continue
            window_c = c_arr[max(0, i - 100):i + 1]
            window_o = data['o'][max(0, i - 100):i + 1]
            window_h = data['h'][max(0, i - 100):i + 1]
            window_l = data['l'][max(0, i - 100):i + 1]
            window_v = data['v'][max(0, i - 100):i + 1]
            if len(window_c) < 50:
                continue
            price_data = build_price_data(window_c, window_h, window_l, window_o, window_v)
            decision = run_pipeline(t, td, price_data, ctx, enabled, config)
            if decisions_logged < 50000:  # cap log size
                logger.log(decision)
                decisions_logged += 1
            if decision.decision == 'BUY':
                sig = {
                    'ticker': t, 'date': td,
                    'entry': decision.entry_price,
                    'target': decision.target_price,
                    'stop': decision.stop_loss,
                }
                signals.append(sig)
                m = td[5:7]  # "2026-02-15" → "02"
                if m in monthly_signals:
                    monthly_signals[m].append(sig)
    # Compute metrics overall + per month
    overall = calc_metrics(signals, conn)
    monthly = {}
    for m, sigs in monthly_signals.items():
        if sigs:
            monthly[m] = calc_metrics(sigs, conn)
    return {
        'exp_id': exp_id, 'exp_name': exp_name,
        'overall': overall, 'monthly': monthly, 'signals': signals,
    }


# ─── V38 reference experiment ────────────────────────────────────────────────

def run_v38_reference(tickers: List[str], period: Tuple[str, str],
                      conn: sqlite3.Connection) -> Dict:
    """Run V38 (reference) on the same period."""
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    start_date, end_date = period
    print(f'  [Exp_V38] Initializing V38 engine...')
    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals()
    engine._load_benchmark()
    pre_cache_price_history(tickers, engine)
    print(f'  [Exp_V38] Generating signals...')
    signals = []
    for t in tickers:
        d, o, h, l, c, v = engine.get_price_data(t)
        if len(c) < 50:
            continue
        for i in range(50, len(c)):
            if not (start_date <= d[i] <= end_date):
                continue
            try:
                r = engine.analyze_single_day(t, d, o, h, l, c, v, i)
                sig = r.get('signal', 'WAIT')
                if sig not in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
                    continue
                entry = r.get('entry_price', c[i])
                tgt = r.get('target_price') or entry * 1.10
                stp = r.get('stop_loss') or entry * 0.93
                signals.append({'ticker': t, 'date': d[i], 'entry': entry,
                                'target': tgt, 'stop': stp})
            except Exception:
                pass
    overall = calc_metrics(signals, conn)
    monthly = {'01': [], '02': [], '03': [], '04': [], '05': [], '06': []}
    for s in signals:
        m = s['date'][5:7]
        if m in monthly:
            monthly[m].append(s)
    monthly_metrics = {m: calc_metrics(sigs, conn) for m, sigs in monthly.items() if sigs}
    return {
        'exp_id': 'Exp_V38', 'exp_name': 'V38 reference',
        'overall': overall, 'monthly': monthly_metrics, 'signals': signals,
    }


# ─── Decision logic (KEEP/NEUTRAL/REJECT) ───────────────────────────────────

def decide_feature(cur: Dict, prev: Dict, baseline: Dict) -> Tuple[str, str]:
    """Apply pre-registered KEEP/NEUTRAL/REJECT criteria with no-regression clause."""
    if not cur or not prev:
        return 'NEUTRAL', 'insufficient data'
    pf_delta = cur['overall']['pf'] - prev['overall']['pf']
    dd_delta = cur['overall']['max_dd'] - prev['overall']['max_dd']  # negative = improvement
    wr_delta = cur['overall']['wr'] - prev['overall']['wr']
    sig_ratio = cur['overall']['signals'] / max(1, prev['overall']['signals'])
    sig_drop_pct = (1 - sig_ratio) * 100

    # no-regression check (max 2% drop in any other metric)
    regression = False
    if pf_delta > 0.10 and wr_delta < -2:
        regression = True
    if dd_delta < -20 and wr_delta < -2:
        regression = True

    # KEEP criteria (AND)
    keep1 = (pf_delta >= 0.10) and (sig_drop_pct <= 40)
    keep2 = (dd_delta <= -20) and (pf_delta >= -0.05)
    keep3 = (wr_delta >= 3) and (sig_drop_pct <= 30)
    if (keep1 or keep2 or keep3) and not regression:
        reasons = []
        if keep1: reasons.append(f'PF+{pf_delta:.2f}, sig_drop={sig_drop_pct:.0f}%')
        if keep2: reasons.append(f'DD{dd_delta:.1f}%, PF{pf_delta:+.2f}')
        if keep3: reasons.append(f'WR+{wr_delta:.1f}%, sig_drop={sig_drop_pct:.0f}%')
        return 'KEEP', '; '.join(reasons)
    # REJECT
    if sig_drop_pct > 40 and pf_delta < 0.05:
        return 'REJECT', f'signals dropped {sig_drop_pct:.0f}% without PF gain'
    if pf_delta < -0.10:
        return 'REJECT', f'PF dropped {abs(pf_delta):.2f}'
    if cur['overall']['signals'] == 0:
        return 'REJECT', '0 signals in Dev'
    if regression:
        return 'REJECT', f'regression in WR ({wr_delta:.1f}%) despite PF gain'
    # NEUTRAL
    if abs(pf_delta) <= 0.05 and abs(dd_delta) <= 2:
        return 'NEUTRAL', f'PF{pf_delta:+.2f}, DD{dd_delta:+.1f}% — within thresholds'
    return 'NEUTRAL', f'PF{pf_delta:+.2f}, DD{dd_delta:+.1f}%, WR{wr_delta:+.1f}%'


def devils_advocate(cur: Dict, prev: Dict) -> List[str]:
    """3 reasons the result might be misleading."""
    reasons = []
    if cur['overall']['signals'] < 30:
        reasons.append(f"Small sample ({cur['overall']['signals']} signals) — statistically weak")
    if cur['overall']['signals'] > 0:
        wr = cur['overall']['wr']
        if wr < 35:
            reasons.append(f"Low WR ({wr}%) — could be lucky on a few big winners")
        pf = cur['overall']['pf']
        if pf > 1.5 and wr < 45:
            reasons.append(f"PF={pf} driven by outliers, not consistent wins")
    monthly = cur.get('monthly', {})
    if len(monthly) == 1:
        reasons.append("Only 1 month has signals — could be month-specific (lucky month)")
    if not reasons:
        reasons.append("No obvious red flag — but no out-of-sample validation yet")
    if len(reasons) < 3:
        reasons.append("Bear market 2026 — V38 baseline is weak, so comparison may be biased")
    if len(reasons) < 3:
        reasons.append("28-day holdout is short — real test needs Q3/Q4 2026 data")
    return reasons[:3]


# ─── Holdout verification (Phase 7) ─────────────────────────────────────────

def run_holdout(best_exp: Dict, tickers: List[str], conn: sqlite3.Connection,
                ctx: Dict, logger: DecisionLogger) -> Dict:
    """Run best experiment on VAL + HOLDOUT."""
    results = {}
    for set_name, period in [('DEV', DEV), ('VAL', VAL), ('HOLDOUT', HOLDOUT)]:
        print(f'\n  [Holdout] Running {best_exp["id"]} on {set_name} ({period[0]} → {period[1]})...')
        res = run_experiment(best_exp, tickers, period, conn, ctx, logger)
        results[set_name] = res['overall']
    return results


# ─── Report writer ───────────────────────────────────────────────────────────

def write_final_report(dev_results: List[Dict], holdout_results: Optional[Dict],
                       best_exp_id: str, decisions_log_path: str) -> str:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / 'ORCHESTRATOR-ABLATION-FINAL.md'

    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('# 📊 Orchestrator Ablation — Final Report\n\n')
        f.write(f'**Generated:** {datetime.now().isoformat()}\n')
        f.write(f'**Universe:** 250 tickers (continuous in DEV+VAL+HOLDOUT)\n')
        f.write(f'**Data:** price_history.db (2026-01-01 → 2026-06-10)\n')
        f.write(f'**Decision log:** `{decisions_log_path}`\n\n')
        f.write('---\n\n')

        # Executive summary
        f.write('## 📋 Executive Summary\n\n')
        baseline = dev_results[0]['overall'] if dev_results else {}
        v38 = next((r for r in dev_results if r['exp_id'] == 'Exp_V38'), None)
        best = next((r for r in dev_results if r['exp_id'] == best_exp_id), None)
        f.write(f'- **Baseline (Exp_0):** {baseline.get("signals",0)} signals, PF={baseline.get("pf",0)}, DD=-{baseline.get("max_dd",0)}%\n')
        if v38:
            f.write(f'- **V38 reference:** {v38["overall"]["signals"]} signals, PF={v38["overall"]["pf"]}, DD=-{v38["overall"]["max_dd"]}%\n')
        if best:
            f.write(f'- **Best orchestrator ({best_exp_id}):** {best["overall"]["signals"]} signals, PF={best["overall"]["pf"]}, DD=-{best["overall"]["max_dd"]}%\n')
        if holdout_results:
            f.write(f'- **Holdout (May-Jun10):** {holdout_results.get("HOLDOUT",{}).get("signals",0)} signals, PF={holdout_results.get("HOLDOUT",{}).get("pf",0)}\n')
        f.write('\n---\n\n')

        # Full results table
        f.write('## 📊 Phase 3-6: Ablation Results (DEV = Jan-Feb 2026)\n\n')
        f.write('| Exp | Name | Signals | WR | PF | DD | Sharpe | ΔPF vs prev | Decision |\n')
        f.write('|---|---|---|---|---|---|---|---|---|\n')
        prev = None
        for r in dev_results:
            o = r['overall']
            delta_pf = ''
            decision = ''
            reason = ''
            if prev and r['exp_id'] != 'Exp_V38':
                d, rs = decide_feature(r, prev, dev_results[0])
                decision = d
                reason = rs
                delta_pf = f"{o['pf'] - prev['overall']['pf']:+.2f}"
            elif r['exp_id'] == 'Exp_V38':
                decision = 'REF'
                reason = 'reference only'
            f.write(f"| {r['exp_id']} | {r['exp_name']} | {o['signals']} | {o['wr']}% | {o['pf']} | -{o['max_dd']}% | {o['sharpe']} | {delta_pf or '—'} | {decision} |\n")
            if r['exp_id'] != 'Exp_V38':
                prev = r
        f.write('\n')

        # Monthly breakdown per experiment
        f.write('## 📅 Monthly Breakdown (per experiment)\n\n')
        for r in dev_results:
            f.write(f"### {r['exp_id']} — {r['exp_name']}\n\n")
            f.write('| Month | Signals | WR | PF | DD | Sharpe |\n')
            f.write('|---|---|---|---|---|---|\n')
            for m in ['01', '02']:
                if m in r.get('monthly', {}):
                    mm = r['monthly'][m]
                    f.write(f"| {m} | {mm['signals']} | {mm['wr']}% | {mm['pf']} | -{mm['max_dd']}% | {mm['sharpe']} |\n")
                else:
                    f.write(f"| {m} | 0 | — | — | — | — |\n")
            o = r['overall']
            f.write(f"| **DEV TOTAL** | **{o['signals']}** | **{o['wr']}%** | **{o['pf']}** | **-{o['max_dd']}%** | **{o['sharpe']}** |\n\n")
            if r['exp_id'] != 'Exp_V38' and prev:
                d, rs = decide_feature(r, prev, dev_results[0]) if prev else ('—', '')
                f.write(f"**Decision:** {d} — {rs}\n\n")
                f.write(f"**Devil's Advocate:**\n")
                for i, reason in enumerate(devils_advocate(r, prev), 1):
                    f.write(f"{i}. {reason}\n")
                f.write('\n')
            prev = r if r['exp_id'] != 'Exp_V38' else prev
        f.write('---\n\n')

        # Holdout verification
        if holdout_results:
            f.write('## 🔒 Phase 7: Holdout Verification\n\n')
            f.write('| Set | Period | Signals | WR | PF | DD | Sharpe | vs DEV PF |\n')
            f.write('|---|---|---|---|---|---|---|---|\n')
            dev_pf = holdout_results.get('DEV', {}).get('pf', 0)
            for set_name in ['DEV', 'VAL', 'HOLDOUT']:
                if set_name in holdout_results:
                    o = holdout_results[set_name]
                    pct = (o['pf'] / dev_pf * 100) if dev_pf > 0 else 0
                    f.write(f"| {set_name} | {dict(DEV=DEV,VAL=VAL,HOLDOUT=HOLDOUT)[set_name][0]}→{dict(DEV=DEV,VAL=VAL,HOLDOUT=HOLDOUT)[set_name][1]} | {o['signals']} | {o['wr']}% | {o['pf']} | -{o['max_dd']}% | {o['sharpe']} | {pct:.0f}% |\n")
            f.write('\n')

            # Final verdict
            h = holdout_results.get('HOLDOUT', {})
            dev_o = holdout_results.get('DEV', {})
            if h.get('signals', 0) >= 20 and h.get('pf', 0) >= dev_pf * 0.7 and h.get('max_dd', 100) < 25:
                verdict = 'A) PROMISING — جاهز لاختبار إضافي على بيانات محدثة'
            elif h.get('signals', 0) < 20:
                verdict = 'D) INSUFFICIENT DATA — الـ holdout صغير، محتاجين بيانات محدثة'
            elif h.get('pf', 0) < dev_pf * 0.5:
                verdict = 'B) OVERFIT — النتايج مش بتصمد'
            else:
                verdict = 'C) MIXED — نتايج مختلطة'
            f.write(f'### Verdict: **{verdict}**\n\n')
        f.write('---\n\n')

        # Final comparison vs V38
        f.write('## 🆚 Final Comparison: Orchestrator vs V38\n\n')
        if v38 and best:
            f.write('| Metric | V38 | Orchestrator (best) | Δ |\n')
            f.write('|---|---|---|---|\n')
            for m in ['signals', 'wr', 'pf', 'max_dd', 'sharpe']:
                vv = v38['overall'].get(m, 0)
                bb = best['overall'].get(m, 0)
                d = bb - vv if m != 'max_dd' else vv - bb
                f.write(f"| {m} | {vv} | {bb} | {d:+.2f} |\n")
        f.write('\n---\n\n')

        # Next step
        f.write('## 🎯 Next Step Recommendation\n\n')
        if holdout_results:
            h = holdout_results.get('HOLDOUT', {})
            if h.get('signals', 0) >= 20 and h.get('pf', 0) >= 0.8:
                f.write('طلب نسخة محدّثة من `price_history.db` من السيرفر الإنتاجي (Q3+Q4 2026) لإعادة الـ validation على holdout أطول (88+ يوم). لو النتايج اتصمدت → جاهز للنشر controlled.\n')
            else:
                f.write('النتايج مش promising بما يكفي. ننصح بإعادة التفكير في الـ feature set أو الرجوع للـ drawing board (AI/ML/event-driven approach).\n')
        f.write('\n---\n\n*Report generated by camp/ablation_runner.py*\n')
    return str(report_path)


# ─── Main runner ─────────────────────────────────────────────────────────────

def main():
    print('=' * 70)
    print('  V38 ORCHESTRATOR ABLATION — Phase 3-8 Runner')
    print('=' * 70)

    # Load universe — cap to 50 tickers for memory/speed on sandbox (4GB RAM)
    with open(UNIVERSE_FILE) as f:
        all_tickers = json.load(f)
    tickers = all_tickers[:50]  # cap for sandbox memory limits
    print(f'\nUniverse: {len(tickers)} tickers (capped from {len(all_tickers)} for sandbox 4GB RAM)')

    conn = _bs_dbm.connection(str(DB_DIR / 'price_history.db'), writable=False).__enter__()
    ctx = {}
    logger = DecisionLogger(str(RESULTS_DIR / 'decisions_log.jsonl'))

    dev_results = []
    print(f'\n=== Phase 3-6: DEV Ablation ({DEV[0]} → {DEV[1]}) ===\n')
    for exp in EXPERIMENTS:
        print(f'\n--- {exp["id"]}: {exp["name"]} ---')
        if exp.get('is_v38'):
            res = run_v38_reference(tickers, DEV, conn)
        else:
            res = run_experiment(exp, tickers, DEV, conn, ctx, logger)
        dev_results.append(res)
        o = res['overall']
        print(f'  → {o["signals"]} signals, WR={o["wr"]}%, PF={o["pf"]}, DD=-{o["max_dd"]}%, Sharpe={o["sharpe"]}')

    # Find best non-V38 experiment (highest PF, with >= 20 signals)
    best = None
    best_pf = -1
    for r in dev_results:
        if r['exp_id'] == 'Exp_V38' or r['exp_id'] == 'Exp_0':
            continue
        if r['overall']['signals'] >= 20 and r['overall']['pf'] > best_pf:
            best = r
            best_pf = r['overall']['pf']
    best_exp_id = best['exp_id'] if best else 'Exp_1'
    best_exp = next(e for e in EXPERIMENTS if e['id'] == best_exp_id)
    print(f'\n=== Best experiment: {best_exp_id} (PF={best_pf}) ===\n')

    # Phase 7: Holdout
    print(f'\n=== Phase 7: Holdout Verification ===\n')
    holdout_results = run_holdout(best_exp, tickers, conn, ctx, logger)

    # Phase 8: Report
    print(f'\n=== Phase 8: Writing Final Report ===\n')
    report_path = write_final_report(dev_results, holdout_results, best_exp_id, str(logger.path))
    print(f'Report: {report_path}')

    # Save raw results
    raw_path = RESULTS_DIR / 'ablation_raw.json'
    with open(raw_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'dev_results': [{k: v for k, v in r.items() if k != 'signals'} for r in dev_results],
            'holdout_results': {k: v for k, v in holdout_results.items()},
            'best_exp_id': best_exp_id,
        }, f, indent=2, default=str)
    print(f'Raw results: {raw_path}')

    conn.close()
    print('\n' + '=' * 70)
    print('  ABLATION COMPLETE')
    print('=' * 70)


if __name__ == '__main__':
    main()
