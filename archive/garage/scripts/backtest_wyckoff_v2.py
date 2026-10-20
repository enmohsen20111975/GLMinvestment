#!/usr/bin/env python3
"""
backtest_wyckoff_v2.py — باك تست بـ Wyckoff State Machine + Walk-Forward Validation.

الـ framework (مبني على research محسن):
  1. Wyckoff State Machine بدل if/else + fallback
  2. Volume Profile لتحديد الـ ranges الحقيقية
  3. Pattern-specific thresholds (مش threshold ثابت)
  4. Walk-Forward Validation (train 2mo + test 1mo)

الـ Walk-Forward:
  Window 1: train=2026-07-15→09-15, test=2026-09-15→10-15
  Window 2: train=2026-08-15→10-15, test=2026-10-15→11-15 (لو فيه بيانات)
"""
import sys
import os
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from collections import Counter

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'
sys.path.insert(0, str(PROJECT / 'scripts'))

from wyckoff_state_machine import detect_wyckoff_phase, get_threshold, is_exit_pattern, PATTERN_THRESHOLDS

print("=" * 90)
print("  🧪 BRAVO WYCKOFF STATE MACHINE v2 — Walk-Forward Validation")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# 1. الـ 10 PATTERNS (مع thresholds ديناميكية)
# ═══════════════════════════════════════════════════════════════════════
PATTERNS = {
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
        "weights": {"v38": 0.20, "core": 0.25, "smc": 0.25, "vp": 0.30},  # VP reduced from 0.50 to 0.30
    },
}


def select_pattern(regime, stock_type, liquidity, cycle):
    """اختر الـ pattern المناسب بـ priority."""
    candidates = []
    for name, pat in PATTERNS.items():
        cond = pat['conditions']
        if (regime in cond['regime'] and stock_type in cond['stock_type']
            and liquidity in cond['liquidity'] and cycle in cond['cycle']):
            candidates.append((name, pat['priority'], pat['conviction'], pat['weights']))
    if not candidates:
        return 'MEAN_REVERSION_RANGE', 0.20, PATTERNS['MEAN_REVERSION_RANGE']['weights']
    candidates.sort(key=lambda x: x[1])
    name, _, conviction, weights = candidates[0]
    return name, conviction, weights


# ═══════════════════════════════════════════════════════════════════════
# 2. تحميل التوقعات لـ train + test windows
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل التوقعات...")

# Walk-Forward: Window 1
TRAIN_START, TRAIN_END = '2026-07-15', '2026-09-15'
TEST_START, TEST_END = '2026-09-15', '2026-10-15'

pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row

# كل التوقعات في الـ period الكامل
all_rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, master_score, technical_score,
           risk_reward, entry_price, target_price, stop_loss, status, actual_return
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= ? AND prediction_date <= ?
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
    ORDER BY prediction_date
""", (TRAIN_START, TEST_END)).fetchall()
conn.close()

# تقسيم train / test
train_rows = [r for r in all_rows if r['prediction_date'][:10] < TEST_START]
test_rows = [r for r in all_rows if r['prediction_date'][:10] >= TEST_START]

print(f"  Train: {len(train_rows)} توقع ({TRAIN_START} → {TRAIN_END})")
print(f"  Test:  {len(test_rows)} توقع ({TEST_START} → {TEST_END})")

# ═══════════════════════════════════════════════════════════════════════
# 3. تحميل بيانات الأسعار
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] تحميل بيانات الأسعار...")
ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

ticker_data = {}
for r in all_rows:
    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    if ticker not in ticker_data:
        ticker_data[ticker] = {}
    if pred_date not in ticker_data[ticker]:
        hist = ph_conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 100
        """, (ticker, pred_date)).fetchall()
        if len(hist) >= 30:
            hist = list(reversed(hist))
            ticker_data[ticker][pred_date] = {
                'closes':  [h['close_price'] for h in hist],
                'opens':   [h['open_price'] for h in hist],
                'highs':   [h['high_price'] for h in hist],
                'lows':    [h['low_price'] for h in hist],
                'volumes': [h['volume'] or 0 for h in hist],
            }
ph_conn.close()
print(f"  ✅ {len(ticker_data)} ticker")

# ═══════════════════════════════════════════════════════════════════════
# 4. حساب inputs لكل توقع (4 dimensions + 5 scores)
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] حساب 4 dimensions (Wyckoff State Machine) + 5 inputs...")

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer
from utils.shared_liquidity import compute_money_flow

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()


def process_predictions(rows, label):
    """عالج توقعات + ارجع list بـ كل الـ inputs."""
    predictions = []
    fails = Counter()

    for idx, r in enumerate(rows):
        if idx % 50 == 0:
            print(f"  [{label}] ... {idx}/{len(rows)}", flush=True)

        ticker = r['ticker']
        pred_date = r['prediction_date'][:10]
        if ticker not in ticker_data or pred_date not in ticker_data[ticker]:
            continue

        data = ticker_data[ticker][pred_date]
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

        # V38
        v38 = float(r['technical_score']) if r['technical_score'] is not None else 50.0

        # CoreScoring
        core = 50.0
        try:
            result = _cse.analyze(ticker=ticker, price_data={
                'closes': closes, 'opens': opens, 'highs': highs, 'lows': lows, 'volumes': volumes
            }, market='EGX', persona='trader')
            if result and result.score is not None:
                core = float(result.score)
        except Exception:
            fails['core'] += 1

        # SMC
        smc = 50.0
        try:
            candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                       for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
            smc_r = calculate_smc_score(candles, closes[-1])
            if smc_r and 'score' in smc_r:
                smc = float(smc_r['score'])
        except Exception:
            fails['smc'] += 1

        # VP (للـ score + للـ Wyckoff State Machine)
        vp = 50.0
        vp_result = None
        try:
            vp_result = _vp.analyze(closes[-30:], volumes[-30:])
            if vp_result and vp_result.score is not None:
                vp = float(vp_result.score)
        except Exception:
            fails['vp'] += 1

        # === DIMENSION 1: Regime ===
        regime = 'RANGE'
        try:
            if len(closes) >= 50:
                ma20 = sum(closes[-20:]) / 20
                ma50 = sum(closes[-50:]) / 50
                roc20 = (closes[-1] - closes[-20]) / closes[-20] * 100 if len(closes) >= 20 else 0
                if ma20 > ma50 * 1.02 and roc20 > 2:
                    regime = 'BULL'
                elif ma20 < ma50 * 0.98 and roc20 < -2:
                    regime = 'BEAR'
                else:
                    regime = 'RANGE'
        except Exception:
            fails['regime'] += 1

        # === DIMENSION 2: Stock Type ===
        stock_type = 'mid'
        try:
            avg_vol_30 = sum(volumes[-30:]) / 30 if len(volumes) >= 30 else 0
            avg_price = sum(closes[-30:]) / 30 if len(closes) >= 30 else 0
            adv_30 = avg_vol_30 * avg_price
            if adv_30 >= 10_000_000:
                stock_type = 'large'
            elif adv_30 >= 1_000_000:
                stock_type = 'mid'
            else:
                stock_type = 'small'
        except Exception:
            fails['stock_type'] += 1

        # === DIMENSION 3: Liquidity ===
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
            else:
                liquidity = 'NEUTRAL'
        except Exception:
            fails['liquidity'] += 1

        # === DIMENSION 4: Wyckoff State Machine ===
        cycle = 'RANGE'
        cycle_confidence = 0.5
        try:
            ctx = detect_wyckoff_phase(closes, highs, lows, volumes, vp_result)
            cycle = ctx.phase
            cycle_confidence = ctx.confidence
        except Exception:
            fails['cycle'] += 1

        predictions.append({
            'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
            'signal': r['signal'], 'status': r['status'],
            'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
            'regime': regime, 'stock_type': stock_type,
            'liquidity': liquidity, 'cycle': cycle,
            'cycle_confidence': cycle_confidence,
        })

    print(f"  [{label}] ✅ {len(predictions)} توقع | fails: {dict(fails)}")
    return predictions


train_preds = process_predictions(train_rows, 'TRAIN')
test_preds = process_predictions(test_rows, 'TEST')

# ═══════════════════════════════════════════════════════════════════════
# 5. تشغيل الـ scenarios على train + test
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] تشغيل scenarios على train + test...")


def run_scenario(predictions, scen_name):
    """شغل scenario واحد على predictions وارجع النتائج."""
    accepted = []
    skipped_exit = 0
    skipped_below_thr = 0
    pattern_usage = Counter()
    pattern_results = {}

    for p in predictions:
        # اختار pattern
        pattern_name, conviction, weights = select_pattern(
            p['regime'], p['stock_type'], p['liquidity'], p['cycle']
        )
        pattern_usage[pattern_name] += 1

        # EXIT patterns → skip
        if is_exit_pattern(pattern_name):
            skipped_exit += 1
            continue

        # حساب dynamic score
        score = (
            p['v38']  * weights['v38']  +
            p['core'] * weights['core'] +
            p['smc']  * weights['smc']  +
            p['vp']   * weights['vp']
        )
        score = max(0, min(100, round(score, 2)))

        # Pattern-specific threshold
        threshold = get_threshold(pattern_name)

        if score < threshold:
            skipped_below_thr += 1
            continue

        accepted.append({
            'status': p['status'],
            'score': score,
            'pattern': pattern_name,
            'cycle': p['cycle'],
            'cycle_confidence': p['cycle_confidence'],
        })

        # تتبع pattern results
        if pattern_name not in pattern_results:
            pattern_results[pattern_name] = {'count': 0, 'wins': 0, 'closed': 0}
        pattern_results[pattern_name]['count'] += 1
        if p['status'] == 'TARGET_HIT':
            pattern_results[pattern_name]['wins'] += 1
        if p['status'] in ('TARGET_HIT', 'STOPPED'):
            pattern_results[pattern_name]['closed'] += 1

    closed = [p for p in accepted if p['status'] in ('TARGET_HIT', 'STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']

    return {
        'n_total': len(predictions),
        'n_accepted': len(accepted),
        'n_skipped_exit': skipped_exit,
        'n_skipped_below_thr': skipped_below_thr,
        'n_closed': len(closed),
        'n_wins': len(wins),
        'wr': (len(wins)/len(closed)*100) if closed else 0,
        'filter_rate': (1 - len(accepted)/len(predictions))*100 if predictions else 0,
        'pattern_usage': dict(pattern_usage),
        'pattern_results': pattern_results,
    }


# Run on train + test
train_results = run_scenario(train_preds, 'train')
test_results = run_scenario(test_preds, 'test')

# Also run baseline (static) on test for comparison
def run_static_baseline(predictions):
    """static baseline: v38×75% + smc×15% + vp×10%, thr=65."""
    accepted = []
    for p in predictions:
        score = p['v38']*0.75 + p['smc']*0.15 + p['vp']*0.10
        score = max(0, min(100, round(score, 2)))
        if score >= 65:
            accepted.append({'status': p['status'], 'score': score})
    closed = [p for p in accepted if p['status'] in ('TARGET_HIT','STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']
    return {
        'n_accepted': len(accepted),
        'n_closed': len(closed),
        'n_wins': len(wins),
        'wr': (len(wins)/len(closed)*100) if closed else 0,
    }

test_baseline = run_static_baseline(test_preds)

# ═══════════════════════════════════════════════════════════════════════
# 6. عرض النتائج
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] عرض النتائج...")
print("\n" + "=" * 90)
print("  📊 Walk-Forward Validation Results")
print("=" * 90)

print(f"\n{'Window':10s} | {'total':>5} | {'accept':>6} | {'exit':>4} | {'below':>5} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'filter':>7}")
print("-" * 90)

print(f"{'TRAIN':10s} | {train_results['n_total']:>5} | {train_results['n_accepted']:>6} | "
      f"{train_results['n_skipped_exit']:>4} | {train_results['n_skipped_below_thr']:>5} | "
      f"{train_results['n_closed']:>6} | {train_results['n_wins']:>4} | {train_results['wr']:>5.1f}% | "
      f"{train_results['filter_rate']:>6.1f}%")

print(f"{'TEST':10s} | {test_results['n_total']:>5} | {test_results['n_accepted']:>6} | "
      f"{test_results['n_skipped_exit']:>4} | {test_results['n_skipped_below_thr']:>5} | "
      f"{test_results['n_closed']:>6} | {test_results['n_wins']:>4} | {test_results['wr']:>5.1f}% | "
      f"{test_results['filter_rate']:>6.1f}%")

print(f"{'BASELINE':10s} | {len(test_preds):>5} | {test_baseline['n_accepted']:>6} | "
      f"{'-':>4} | {'-':>5} | {test_baseline['n_closed']:>6} | {test_baseline['n_wins']:>4} | "
      f"{test_baseline['wr']:>5.1f}% | {'-':>7}")

# Pattern distribution (TEST)
print("\n" + "=" * 90)
print("  📊 Pattern distribution في TEST window")
print("=" * 90)

print(f"\n{'Pattern':30s} | {'usage':>5} | {'accepted':>8} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'thr':>4}")
print("-" * 90)

# كل patterns
all_patterns = set(test_results['pattern_usage'].keys()) | set(test_results['pattern_results'].keys())
for pat in sorted(all_patterns, key=lambda p: -test_results['pattern_usage'].get(p, 0)):
    usage = test_results['pattern_usage'].get(pat, 0)
    if pat in test_results['pattern_results']:
        pr = test_results['pattern_results'][pat]
        wr = (pr['wins']/pr['closed']*100) if pr['closed'] > 0 else 0
        accepted = pr['count']
        closed = pr['closed']
        wins = pr['wins']
    else:
        accepted = closed = wins = 0
        wr = 0
    thr = get_threshold(pat)
    exit_mark = ' (EXIT)' if is_exit_pattern(pat) else ''
    print(f"{pat + exit_mark:30s} | {usage:>5} | {accepted:>8} | {closed:>6} | {wins:>4} | {wr:>5.1f}% | {thr:>4}")

# Cycle distribution (TEST)
print("\n" + "=" * 90)
print("  📊 Wyckoff phase distribution في TEST window")
print("=" * 90)
cycle_dist = Counter(p['cycle'] for p in test_preds).most_common()
print()
for phase, cnt in cycle_dist:
    pct = cnt/len(test_preds)*100
    bar = '█' * int(pct/2)
    print(f"  {phase:25s} | {cnt:>4} ({pct:>5.1f}%) {bar}")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'wyckoff_v2_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'walk_forward': {
            'train': {'period': f'{TRAIN_START} → {TRAIN_END}', 'results': train_results},
            'test':  {'period': f'{TEST_START} → {TEST_END}', 'results': test_results},
            'baseline_test': test_baseline,
        },
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 90)
print("  ✅ الباك تست خلص — Walk-Forward Validation")
print("=" * 90)
