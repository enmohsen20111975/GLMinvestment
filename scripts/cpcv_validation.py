#!/usr/bin/env python3
"""
cpcv_validation.py — Combinatorial Purged Cross-Validation + Monte Carlo.

الـ framework (مبني على research محسن):
  1. CPCV: تقسيم البيانات لـ combinations متعددة + purging (تجنب leakage)
  2. Monte Carlo: تشغيل على بيانات عشوائية (مع نفس الخصائص الإحصائية)
  3. Max Drawdown analysis (مش WR بس)
  4. Profit Factor (مش WR بس)

الـ CPCV:
  - نقسم البيانات لـ N groups (مثلاً 6)
  - نختار k groups لـ train، الباقي لـ test
  - نـ purge الـ boundaries (نـشيل أي توقعات قريبة من الـ boundary)
  - نحسب الـ WR + PF لكل combination
  - النتيجة: distribution مش رقم واحد

الـ Monte Carlo:
  - نـshuffle الـ predictions (نـكسر الترتيب الزمني)
  - نـحسب الـ WR + PF على الـ shuffled data
  - نكرر 1000 مرة
  - النتيجة: distribution + p-value
"""
import sys
import os
import json
import sqlite3
import random
from datetime import datetime
from pathlib import Path
from collections import Counter
from itertools import combinations

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))
PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'
sys.path.insert(0, str(PROJECT / 'scripts'))

from wyckoff_state_machine import detect_wyckoff_phase, get_threshold, is_exit_pattern

print("=" * 90)
print("  🧪 BRAVO CPCV + MONTE CARLO VALIDATION")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# 1. PARAMETER LOCK (نفس الـ parameters من TRAIN)
# ═══════════════════════════════════════════════════════════════════════
LOCKED_PATTERNS = {
    "LIQUIDITY_DRAIN_SURVIVOR": {
        "priority": 1, "conviction": 0.0,
        "conditions": {"regime": ["BULL","RANGE","BEAR"], "stock_type": ["small"],
                       "liquidity": ["OUTFLOW","STRONG_OUTFLOW"],
                       "cycle": ["STOPPING_ACTION","SPRING","MARKUP_START","MARKUP_MID","DISTRIBUTION_START","DISTRIBUTION_MID","ACCUMULATION","RANGE","MARKDOWN"]},
        "weights": {"v38": 0.55, "core": 0.10, "smc": 0.35, "vp": 0.00},
    },
    "BEAR_DEFENDER": {
        "priority": 2, "conviction": 0.10,
        "conditions": {"regime": ["BEAR"], "stock_type": ["large"],
                       "liquidity": ["OUTFLOW","STRONG_OUTFLOW"],
                       "cycle": ["DISTRIBUTION_MID","STOPPING_ACTION","MARKDOWN"]},
        "weights": {"v38": 0.10, "core": 0.20, "smc": 0.40, "vp": 0.30},
    },
    "SPRING_HUNTER": {
        "priority": 3, "conviction": 0.40,
        "conditions": {"regime": ["BEAR","RANGE","BULL"], "stock_type": ["mid","small"],
                       "liquidity": ["NEUTRAL","MODERATE_INFLOW","STRONG_INFLOW"],
                       "cycle": ["SPRING"]},
        "weights": {"v38": 0.15, "core": 0.10, "smc": 0.40, "vp": 0.35},
    },
    "DISTRIBUTION_EXIT": {
        "priority": 4, "conviction": 0.0,
        "conditions": {"regime": ["BULL","RANGE"], "stock_type": ["large","mid"],
                       "liquidity": ["OUTFLOW","STRONG_OUTFLOW"],
                       "cycle": ["DISTRIBUTION_START"]},
        "weights": {"v38": 0.10, "core": 0.20, "smc": 0.35, "vp": 0.35},
    },
    "BOTTOM_FISHER": {
        "priority": 5, "conviction": 0.15,
        "conditions": {"regime": ["BEAR","RANGE"], "stock_type": ["mid","small"],
                       "liquidity": ["STRONG_OUTFLOW","OUTFLOW"],
                       "cycle": ["STOPPING_ACTION"]},
        "weights": {"v38": 0.05, "core": 0.20, "smc": 0.35, "vp": 0.40},
    },
    "BREAKOUT_RIDER": {
        "priority": 6, "conviction": 0.30,
        "conditions": {"regime": ["BULL","RANGE"], "stock_type": ["small"],
                       "liquidity": ["MODERATE_INFLOW","STRONG_INFLOW"],
                       "cycle": ["MARKUP_START"]},
        "weights": {"v38": 0.40, "core": 0.10, "smc": 0.20, "vp": 0.30},
    },
    "TREND_RIDER": {
        "priority": 7, "conviction": 0.50,
        "conditions": {"regime": ["BULL"], "stock_type": ["large","mid"],
                       "liquidity": ["STRONG_INFLOW","MODERATE_INFLOW"],
                       "cycle": ["MARKUP_START","MARKUP_MID"]},
        "weights": {"v38": 0.65, "core": 0.20, "smc": 0.05, "vp": 0.10},
    },
    "VALUE_ACCUMULATOR": {
        "priority": 8, "conviction": 0.25,
        "conditions": {"regime": ["RANGE","BULL"], "stock_type": ["large"],
                       "liquidity": ["NEUTRAL","MODERATE_INFLOW"],
                       "cycle": ["STOPPING_ACTION","SPRING","ACCUMULATION"]},
        "weights": {"v38": 0.10, "core": 0.40, "smc": 0.20, "vp": 0.30},
    },
    "SAFE_HAVEN_LARGE_CAP": {
        "priority": 9, "conviction": 0.30,
        "conditions": {"regime": ["RANGE","BEAR"], "stock_type": ["large"],
                       "liquidity": ["MODERATE_INFLOW","NEUTRAL"],
                       "cycle": ["STOPPING_ACTION","SPRING","ACCUMULATION"]},
        "weights": {"v38": 0.10, "core": 0.45, "smc": 0.15, "vp": 0.30},
    },
    "MEAN_REVERSION_RANGE": {
        "priority": 10, "conviction": 0.20,
        "conditions": {"regime": ["RANGE","BULL","BEAR"], "stock_type": ["large","mid","small"],
                       "liquidity": ["NEUTRAL"],
                       "cycle": ["RANGE","DISTRIBUTION_MID","MARKUP_MID","ACCUMULATION"]},
        "weights": {"v38": 0.20, "core": 0.25, "smc": 0.25, "vp": 0.30},
    },
}

LOCKED_THRESHOLDS = {
    'TREND_RIDER': 65, 'BREAKOUT_RIDER': 60, 'SPRING_HUNTER': 55,
    'VALUE_ACCUMULATOR': 55, 'SAFE_HAVEN_LARGE_CAP': 50,
    'BEAR_DEFENDER': 45, 'BOTTOM_FISHER': 45,
    'MEAN_REVERSION_RANGE': 40, 'MARKDOWN': 30, 'ACCUMULATION': 50,
}

EXIT_PATTERNS = {'LIQUIDITY_DRAIN_SURVIVOR', 'DISTRIBUTION_EXIT'}


def select_pattern(regime, stock_type, liquidity, cycle):
    candidates = []
    for name, pat in LOCKED_PATTERNS.items():
        cond = pat['conditions']
        if (regime in cond['regime'] and stock_type in cond['stock_type']
            and liquidity in cond['liquidity'] and cycle in cond['cycle']):
            candidates.append((name, pat['priority'], pat['conviction'], pat['weights']))
    if not candidates:
        return 'MEAN_REVERSION_RANGE', 0.20, LOCKED_PATTERNS['MEAN_REVERSION_RANGE']['weights']
    candidates.sort(key=lambda x: x[1])
    name, _, conviction, weights = candidates[0]
    return name, conviction, weights


def evaluate_predictions(predictions, position_size=0.025):
    """قيم predictions بـ WR + PF + Max Drawdown + total return."""
    accepted = []
    for p in predictions:
        pattern_name, conviction, weights = select_pattern(
            p['regime'], p['stock_type'], p['liquidity'], p['cycle']
        )
        if pattern_name in EXIT_PATTERNS:
            continue
        score = (
            p['v38']  * weights['v38']  +
            p['core'] * weights['core'] +
            p['smc']  * weights['smc']  +
            p['vp']   * weights['vp']
        )
        score = max(0, min(100, round(score, 2)))
        threshold = LOCKED_THRESHOLDS.get(pattern_name, 50)
        if score < threshold:
            continue
        accepted.append(p)

    closed = [p for p in accepted if p['status'] in ('TARGET_HIT', 'STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']
    losses = [p for p in closed if p['status'] == 'STOPPED']

    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins / n_closed * 100) if n_closed > 0 else 0

    # returns
    win_returns = [float(p['actual_return']) for p in wins if p['actual_return'] is not None]
    loss_returns = [float(p['actual_return']) for p in losses if p['actual_return'] is not None]

    gross_profit = sum(r for r in win_returns if r > 0)
    gross_loss = sum(abs(r) for r in loss_returns if r < 0)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0

    # Max Drawdown
    closed_sorted = sorted(closed, key=lambda p: p['pred_date'])
    equity = 100.0
    peak = 100.0
    max_dd = 0.0
    for p in closed_sorted:
        if p['actual_return'] is not None:
            ret = float(p['actual_return'])
            equity_change = (ret / 100) * position_size * 100
            equity += equity_change
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak * 100
            if dd > max_dd:
                max_dd = dd

    total_return = equity - 100

    return {
        'n_accepted': len(accepted),
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'pf': pf,
        'max_dd': max_dd,
        'total_return': total_return,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
        'avg_win': sum(win_returns)/len(win_returns) if win_returns else 0,
        'avg_loss': sum(loss_returns)/len(loss_returns) if loss_returns else 0,
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. تحميل كل التوقعات + حساب inputs
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل التوقعات + حساب inputs...")

pred_db = DB_DIR / 'predictions.db'
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection(str(pred_db), writable=False).__enter__()
conn.row_factory = sqlite3.Row

all_rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, master_score, technical_score,
           risk_reward, entry_price, target_price, stop_loss, status, actual_return
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= '2025-08-01' AND prediction_date <= '2026-10-31'
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
    ORDER BY prediction_date
""").fetchall()
conn.close()
print(f"  ✅ {len(all_rows)} توقع")

# تحميل بيانات الأسعار
ph_db = DB_DIR / 'price_history.db'
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
ph_conn = db_manager.connection(str(ph_db), writable=False).__enter__()
ph_conn.row_factory = sqlite3.Row

ticker_date_cache = {}
for r in all_rows:
    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    cache_key = (ticker, pred_date)
    if cache_key in ticker_date_cache:
        continue
    hist = ph_conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? AND date <= ?
        ORDER BY date DESC LIMIT 100
    """, (ticker, pred_date)).fetchall()
    if len(hist) >= 30:
        hist = list(reversed(hist))
        ticker_date_cache[cache_key] = {
            'closes':  [h['close_price'] for h in hist],
            'opens':   [h['open_price'] for h in hist],
            'highs':   [h['high_price'] for h in hist],
            'lows':    [h['low_price'] for h in hist],
            'volumes': [h['volume'] or 0 for h in hist],
        }
ph_conn.close()

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer
from utils.shared_liquidity import compute_money_flow

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions = []
for idx, r in enumerate(all_rows):
    if idx % 200 == 0:
        print(f"  ... {idx}/{len(all_rows)}", flush=True)

    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    cache_key = (ticker, pred_date)
    if cache_key not in ticker_date_cache:
        continue

    data = ticker_date_cache[cache_key]
    filtered = [(o,h,l,c,v) for o,h,l,c,v in
                zip(data['opens'], data['highs'], data['lows'], data['closes'], data['volumes'])
                if c is not None and h is not None and l is not None and o is not None and c > 0]
    if len(filtered) < 30:
        continue
    opens = [f[0] for f in filtered]
    highs = [f[1] for f in filtered]
    lows = [f[2] for f in filtered]
    closes = [f[3] for f in filtered]
    volumes = [f[4] for f in filtered]

    v38 = float(r['technical_score']) if r['technical_score'] is not None else 50.0

    core = 50.0
    try:
        result = _cse.analyze(ticker=ticker, price_data={
            'closes': closes, 'opens': opens, 'highs': highs, 'lows': lows, 'volumes': volumes
        }, market='EGX', persona='trader')
        if result and result.score is not None:
            core = float(result.score)
    except Exception:
        pass

    smc = 50.0
    try:
        candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                   for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
        smc_r = calculate_smc_score(candles, closes[-1])
        if smc_r and 'score' in smc_r:
            smc = float(smc_r['score'])
    except Exception:
        pass

    vp = 50.0
    vp_result = None
    try:
        vp_result = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_result and vp_result.score is not None:
            vp = float(vp_result.score)
    except Exception:
        pass

    regime = 'RANGE'
    try:
        if len(closes) >= 50:
            ma20 = sum(closes[-20:]) / 20
            ma50 = sum(closes[-50:]) / 50
            roc20 = (closes[-1] - closes[-20]) / closes[-20] * 100
            if ma20 > ma50 * 1.02 and roc20 > 2:
                regime = 'BULL'
            elif ma20 < ma50 * 0.98 and roc20 < -2:
                regime = 'BEAR'
    except Exception:
        pass

    stock_type = 'mid'
    try:
        avg_vol_30 = sum(volumes[-30:]) / 30
        avg_price = sum(closes[-30:]) / 30
        adv_30 = avg_vol_30 * avg_price
        if adv_30 >= 10_000_000:
            stock_type = 'large'
        elif adv_30 >= 1_000_000:
            stock_type = 'mid'
        else:
            stock_type = 'small'
    except Exception:
        pass

    liquidity = 'NEUTRAL'
    try:
        mf = compute_money_flow(closes, volumes, highs, lows)
        state = mf.get('money_flow_state', 'neutral')
        if '🔥 دخول قوي' in state:
            liquidity = 'STRONG_INFLOW'
        elif '🟢 سيولة داخلة' in state:
            liquidity = 'MODERATE_INFLOW'
        elif '🔥 خروج قوي' in state:
            liquidity = 'STRONG_OUTFLOW'
        elif '🔴 سيولة خارجة' in state:
            liquidity = 'OUTFLOW'
    except Exception:
        pass

    cycle = 'RANGE'
    try:
        ctx = detect_wyckoff_phase(closes, highs, lows, volumes, vp_result)
        cycle = ctx.phase
    except Exception:
        pass

    predictions.append({
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'status': r['status'],
        'actual_return': float(r['actual_return']) if r['actual_return'] is not None else None,
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
        'regime': regime, 'stock_type': stock_type,
        'liquidity': liquidity, 'cycle': cycle,
    })

print(f"  ✅ {len(predictions)} توقع بـ inputs")

# ═══════════════════════════════════════════════════════════════════════
# 3. CPCV — Combinatorial Purged Cross-Validation
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] CPCV — Combinatorial Purged Cross-Validation...")

# تقسيم البيانات لـ 6 groups (حسب التاريخ)
predictions_sorted = sorted(predictions, key=lambda p: p['pred_date'])
n_groups = 6
group_size = len(predictions_sorted) // n_groups
groups = []
for i in range(n_groups):
    start = i * group_size
    end = start + group_size if i < n_groups - 1 else len(predictions_sorted)
    groups.append(predictions_sorted[start:end])

print(f"  {n_groups} groups × ~{group_size} predictions each")

# CPCV: اختيار 2 groups لـ test (الباقي train) — C(6,2) = 15 combinations
# Purging: نـشيل أي توقعات قريبة من الـ boundary (±3 أيام)
PURGE_DAYS = 3

combos = list(combinations(range(n_groups), 2))
print(f"  {len(combos)} combinations (C({n_groups},2))")

cpcv_results = []
for test_group_idxs in combos:
    test_groups = [groups[i] for i in test_group_idxs]
    train_groups = [groups[i] for i in range(n_groups) if i not in test_group_idxs]

    # purging: نـشيل الـ dates القريبة من الـ boundaries
    test_dates = set(p['pred_date'] for p in sum(test_groups, []))
    purge_dates = set()
    for d in test_dates:
        # نـشيل ±3 أيام
        from datetime import datetime as dt, timedelta
        try:
            date_obj = dt.strptime(d, '%Y-%m-%d')
            for offset in range(-PURGE_DAYS, PURGE_DAYS + 1):
                purge_dates.add((date_obj + timedelta(days=offset)).strftime('%Y-%m-%d'))
        except Exception:
            pass

    # train data (بعد purging)
    train_data = [p for p in sum(train_groups, []) if p['pred_date'] not in purge_dates]
    test_data = sum(test_groups, [])

    # قيم
    train_metrics = evaluate_predictions(train_data)
    test_metrics = evaluate_predictions(test_data)

    gen_ratio = (test_metrics['wr'] / train_metrics['wr']) if train_metrics['wr'] > 0 else 0

    cpcv_results.append({
        'test_groups': test_group_idxs,
        'train_n': len(train_data),
        'test_n': len(test_data),
        'train_wr': train_metrics['wr'],
        'test_wr': test_metrics['wr'],
        'train_pf': train_metrics['pf'],
        'test_pf': test_metrics['pf'],
        'train_dd': train_metrics['max_dd'],
        'test_dd': test_metrics['max_dd'],
        'gen_ratio': gen_ratio,
        'test_closed': test_metrics['n_closed'],
    })

# عرض نتائج CPCV
print(f"\n  {'combo':12s} | {'train_n':>7} | {'test_n':>6} | {'train_WR':>8} | {'test_WR':>7} | {'train_PF':>8} | {'test_PF':>7} | {'test_DD':>7} | {'Gen':>5}")
print("  " + "-" * 100)
for r in cpcv_results:
    combo = f"{r['test_groups'][0]+1},{r['test_groups'][1]+1}"
    print(f"  {combo:>12s} | {r['train_n']:>7} | {r['test_n']:>6} | "
          f"{r['train_wr']:>7.1f}% | {r['test_wr']:>6.1f}% | "
          f"{r['train_pf']:>8.2f} | {r['test_pf']:>7.2f} | "
          f"{r['test_dd']:>6.1f}% | {r['gen_ratio']:>5.2f}")

# إحصائيات CPCV
gen_ratios = [r['gen_ratio'] for r in cpcv_results if r['test_closed'] > 0]
test_wrs = [r['test_wr'] for r in cpcv_results if r['test_closed'] > 0]
test_pfs = [r['test_pf'] for r in cpcv_results if r['test_closed'] > 0]
test_dds = [r['test_dd'] for r in cpcv_results if r['test_closed'] > 0]

print(f"\n  CPCV Statistics (only combinations with closed test predictions):")
print(f"    combinations with closed: {len(gen_ratios)} / {len(cpcv_results)}")
if gen_ratios:
    print(f"    Gen Ratio:  min={min(gen_ratios):.2f}, max={max(gen_ratios):.2f}, avg={sum(gen_ratios)/len(gen_ratios):.2f}, median={sorted(gen_ratios)[len(gen_ratios)//2]:.2f}")
    print(f"    Test WR:    min={min(test_wrs):.1f}%, max={max(test_wrs):.1f}%, avg={sum(test_wrs)/len(test_wrs):.1f}%, median={sorted(test_wrs)[len(test_wrs)//2]:.1f}%")
    print(f"    Test PF:    min={min(test_pfs):.2f}, max={max(test_pfs):.2f}, avg={sum(test_pfs)/len(test_pfs):.2f}, median={sorted(test_pfs)[len(test_pfs)//2]:.2f}")
    print(f"    Test MaxDD: min={min(test_dds):.1f}%, max={max(test_dds):.1f}%, avg={sum(test_dds)/len(test_dds):.1f}%")

# ═══════════════════════════════════════════════════════════════════════
# 4. Monte Carlo — shuffle 1000 مرة
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/4] Monte Carlo — shuffle 1000 مرة...")

# الـ baseline (بدون shuffle)
baseline_metrics = evaluate_predictions(predictions)

# Monte Carlo: shuffle الـ actual_return + status (نـكسر الترتيب الزمني)
N_SIMULATIONS = 1000
mc_wrs = []
mc_pfs = []
mc_dds = []
mc_returns = []

random.seed(42)  # reproducible

for sim in range(N_SIMULATIONS):
    if sim % 200 == 0:
        print(f"  ... simulation {sim}/{N_SIMULATIONS}", flush=True)

    # shuffle الـ predictions (نـخلط الـ status + actual_return)
    shuffled = []
    statuses_returns = [(p['status'], p['actual_return']) for p in predictions]
    random.shuffle(statuses_returns)

    for i, p in enumerate(predictions):
        shuffled.append({**p, 'status': statuses_returns[i][0], 'actual_return': statuses_returns[i][1]})

    metrics = evaluate_predictions(shuffled)
    mc_wrs.append(metrics['wr'])
    mc_pfs.append(metrics['pf'])
    mc_dds.append(metrics['max_dd'])
    mc_returns.append(metrics['total_return'])

# إحصائيات Monte Carlo
mc_wrs_sorted = sorted(mc_wrs)
mc_pfs_sorted = sorted(mc_pfs)
mc_dds_sorted = sorted(mc_dds)
mc_returns_sorted = sorted(mc_returns)

print(f"\n  Monte Carlo Statistics ({N_SIMULATIONS} simulations):")
print(f"\n  {'Metric':15s} | {'baseline':>10s} | {'MC avg':>10s} | {'MC median':>10s} | {'MC 5th':>10s} | {'MC 95th':>10s} | {'p-value':>8s}")
print("  " + "-" * 95)

# p-value: كم نسبة الـ MC اللي أحسن من الـ baseline
def p_value(baseline, mc_values, higher_is_better=True):
    if higher_is_better:
        n_better = sum(1 for v in mc_values if v > baseline)
    else:
        n_better = sum(1 for v in mc_values if v < baseline)
    return n_better / len(mc_values) * 100

print(f"  {'WR':15s} | {baseline_metrics['wr']:>9.1f}% | {sum(mc_wrs)/len(mc_wrs):>9.1f}% | "
      f"{mc_wrs_sorted[len(mc_wrs)//2]:>9.1f}% | {mc_wrs_sorted[int(len(mc_wrs)*0.05)]:>9.1f}% | "
      f"{mc_wrs_sorted[int(len(mc_wrs)*0.95)]:>9.1f}% | {p_value(baseline_metrics['wr'], mc_wrs):>7.1f}%")

print(f"  {'Profit Factor':15s} | {baseline_metrics['pf']:>10.2f} | {sum(mc_pfs)/len(mc_pfs):>10.2f} | "
      f"{mc_pfs_sorted[len(mc_pfs)//2]:>10.2f} | {mc_pfs_sorted[int(len(mc_pfs)*0.05)]:>10.2f} | "
      f"{mc_pfs_sorted[int(len(mc_pfs)*0.95)]:>10.2f} | {p_value(baseline_metrics['pf'], mc_pfs):>7.1f}%")

print(f"  {'Max Drawdown':15s} | {baseline_metrics['max_dd']:>9.1f}% | {sum(mc_dds)/len(mc_dds):>9.1f}% | "
      f"{mc_dds_sorted[len(mc_dds)//2]:>9.1f}% | {mc_dds_sorted[int(len(mc_dds)*0.05)]:>9.1f}% | "
      f"{mc_dds_sorted[int(len(mc_dds)*0.95)]:>9.1f}% | {p_value(baseline_metrics['max_dd'], mc_dds, False):>7.1f}%")

print(f"  {'Total Return':15s} | {baseline_metrics['total_return']:>9.2f}% | {sum(mc_returns)/len(mc_returns):>9.2f}% | "
      f"{mc_returns_sorted[len(mc_returns)//2]:>9.2f}% | {mc_returns_sorted[int(len(mc_returns)*0.05)]:>9.2f}% | "
      f"{mc_returns_sorted[int(len(mc_returns)*0.95)]:>9.2f}% | {p_value(baseline_metrics['total_return'], mc_returns):>7.1f}%")

# الـ Verdict
print("\n" + "=" * 90)
print("  🎯 VERDICT")
print("=" * 90)

baseline_wr = baseline_metrics['wr']
mc_median_wr = mc_wrs_sorted[len(mc_wrs)//2]
wr_pvalue = p_value(baseline_wr, mc_wrs)

baseline_pf = baseline_metrics['pf']
mc_median_pf = mc_pfs_sorted[len(mc_pfs)//2]
pf_pvalue = p_value(baseline_pf, mc_pfs)

print(f"""
  Baseline WR: {baseline_wr:.1f}% | MC median WR: {mc_median_wr:.1f}% | p-value: {wr_pvalue:.1f}%
  Baseline PF: {baseline_pf:.2f} | MC median PF: {mc_median_pf:.2f} | p-value: {pf_pvalue:.1f}%

  التفسير:
  - p-value < 5% = النظام أحسن من random (edge حقيقي)
  - p-value > 5% = النظام مش أحسن من random (لا edge)
""")

if wr_pvalue < 5:
    print(f"  ✅ WR p-value = {wr_pvalue:.1f}% → النظام أحسن من random")
else:
    print(f"  ❌ WR p-value = {wr_pvalue:.1f}% → النظام مش أحسن من random")

if pf_pvalue < 5:
    print(f"  ✅ PF p-value = {pf_pvalue:.1f}% → النظام مربح أكثر من random")
else:
    print(f"  ❌ PF p-value = {pf_pvalue:.1f}% → النظام مش مربح أكثر من random")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'cpcv_monte_carlo_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'baseline': baseline_metrics,
        'cpcv': cpcv_results,
        'monte_carlo': {
            'n_simulations': N_SIMULATIONS,
            'wr_stats': {'baseline': baseline_wr, 'avg': sum(mc_wrs)/len(mc_wrs),
                        'median': mc_wrs_sorted[len(mc_wrs)//2],
                        'p5': mc_wrs_sorted[int(len(mc_wrs)*0.05)],
                        'p95': mc_wrs_sorted[int(len(mc_wrs)*0.95)],
                        'p_value': wr_pvalue},
            'pf_stats': {'baseline': baseline_pf, 'avg': sum(mc_pfs)/len(mc_pfs),
                        'median': mc_pfs_sorted[len(mc_pfs)//2],
                        'p5': mc_pfs_sorted[int(len(mc_pfs)*0.05)],
                        'p95': mc_pfs_sorted[int(len(mc_pfs)*0.95)],
                        'p_value': pf_pvalue},
            'dd_stats': {'baseline': baseline_metrics['max_dd'], 'avg': sum(mc_dds)/len(mc_dds),
                        'median': mc_dds_sorted[len(mc_dds)//2],
                        'p5': mc_dds_sorted[int(len(mc_dds)*0.05)],
                        'p95': mc_dds_sorted[int(len(mc_dds)*0.95)]},
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ CPCV + Monte Carlo خلص")
print("=" * 90)
