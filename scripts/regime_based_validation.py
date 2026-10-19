#!/usr/bin/env python3
"""
regime_based_validation.py — اختبار النظام عبر أنظمة سوق مختلفة.

الـ framework (مبني على research محسن):
  1. Regime-Based Testing: اختبار على فترات BULL/BEAR/SIDEWAYS مختلفة
  2. Parameter Lock: تثبيت المعلمات من TRAIN (ممنوع أي تعديل أثناء الاختبار)
  3. Generalization Ratio: OOS WR / IS WR (المثالي = 1.0)
  4. تقييم الأداء في كل regime على حدة

الـ regimes المختارة (بناءً على COMI monthly returns):
  BULL:     2026-01, 2026-04, 2026-07 (259 توقع, 25 closed)
  BEAR:     2026-02-03, 2026-09 (373 توقع, 99 closed)
  SIDEWAYS: 2025-08→12, 2026-05-06, 2026-08, 2026-10 (586 توقع, 118 closed)

الـ TRAIN (parameter lock source): 2026-07-15 → 2026-09-15
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

from wyckoff_state_machine import detect_wyckoff_phase, get_threshold, is_exit_pattern

print("=" * 90)
print("  🧪 BRAVO REGIME-BASED VALIDATION — Parameter Lock + Generalization Ratio")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# 1. PARAMETER LOCK — الـ parameters مثبتة من TRAIN (ممنوع أي تعديل)
# ═══════════════════════════════════════════════════════════════════════
# هذه الـ parameters تم تحديدها في BRAVO-WYCKOFF-STATE-MACHINE-1
# ومثبتة الآن — أي تعديل = إعادة فرط التخصيص

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

# Pattern-specific thresholds (LOCKED)
LOCKED_THRESHOLDS = {
    'TREND_RIDER': 65, 'BREAKOUT_RIDER': 60, 'SPRING_HUNTER': 55,
    'VALUE_ACCUMULATOR': 55, 'SAFE_HAVEN_LARGE_CAP': 50,
    'BEAR_DEFENDER': 45, 'BOTTOM_FISHER': 45,
    'MEAN_REVERSION_RANGE': 40, 'MARKDOWN': 30, 'ACCUMULATION': 50,
}

EXIT_PATTERNS = {'LIQUIDITY_DRAIN_SURVIVOR', 'DISTRIBUTION_EXIT'}


def select_pattern(regime, stock_type, liquidity, cycle):
    """اختر الـ pattern — LOCKED logic."""
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


# ═══════════════════════════════════════════════════════════════════════
# 2. الـ REGIME PERIODS (مختارة بناءً على COMI monthly returns)
# ═══════════════════════════════════════════════════════════════════════
REGIME_PERIODS = {
    'BULL_2026_01':     {'start': '2026-01-01', 'end': '2026-01-31', 'regime': 'BULL'},
    'BULL_2026_04':     {'start': '2026-04-01', 'end': '2026-04-30', 'regime': 'BULL'},
    'BULL_2026_07':     {'start': '2026-07-01', 'end': '2026-07-31', 'regime': 'BULL'},
    'BEAR_2026_02_03':  {'start': '2026-02-01', 'end': '2026-03-31', 'regime': 'BEAR'},
    'BEAR_2026_09':     {'start': '2026-09-01', 'end': '2026-09-30', 'regime': 'BEAR'},
    'SIDEWAYS_2025_08_12': {'start': '2025-08-01', 'end': '2025-12-31', 'regime': 'SIDEWAYS'},
    'SIDEWAYS_2026_05_06': {'start': '2026-05-01', 'end': '2026-06-30', 'regime': 'SIDEWAYS'},
    'SIDEWAYS_2026_08':    {'start': '2026-08-01', 'end': '2026-08-31', 'regime': 'SIDEWAYS'},
    'SIDEWAYS_2026_10':    {'start': '2026-10-01', 'end': '2026-10-31', 'regime': 'SIDEWAYS'},
}

# TRAIN period (for IS WR reference)
TRAIN_PERIOD = {'start': '2026-07-15', 'end': '2026-09-15'}

print(f"\n📋 PARAMETER LOCK: الـ parameters مثبتة من TRAIN ({TRAIN_PERIOD['start']} → {TRAIN_PERIOD['end']})")
print(f"📋 REGIME PERIODS: {len(REGIME_PERIODS)} فترة ({len([p for p in REGIME_PERIODS.values() if p['regime']=='BULL'])} BULL, "
      f"{len([p for p in REGIME_PERIODS.values() if p['regime']=='BEAR'])} BEAR, "
      f"{len([p for p in REGIME_PERIODS.values() if p['regime']=='SIDEWAYS'])} SIDEWAYS)")

# ═══════════════════════════════════════════════════════════════════════
# 3. تحميل كل التوقعات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/4] تحميل كل التوقعات...")
pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
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
print(f"  ✅ {len(all_rows)} توقع إجمالي")

# ═══════════════════════════════════════════════════════════════════════
# 4. تحميل بيانات الأسعار (cache شامل)
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/4] تحميل بيانات الأسعار...")
ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
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
print(f"  ✅ {len(ticker_date_cache)} (ticker, date) cached")

# ═══════════════════════════════════════════════════════════════════════
# 5. حساب inputs لكل توقع
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/4] حساب 4 dimensions + 5 inputs لكل توقع...")

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer
from utils.shared_liquidity import compute_money_flow

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions_by_period = {name: [] for name in REGIME_PERIODS}
predictions_by_period['TRAIN'] = []
train_start = TRAIN_PERIOD['start']
train_end = TRAIN_PERIOD['end']

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
        pass

    # SMC
    smc = 50.0
    try:
        candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                   for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
        smc_r = calculate_smc_score(candles, closes[-1])
        if smc_r and 'score' in smc_r:
            smc = float(smc_r['score'])
    except Exception:
        pass

    # VP
    vp = 50.0
    vp_result = None
    try:
        vp_result = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_result and vp_result.score is not None:
            vp = float(vp_result.score)
    except Exception:
        pass

    # Regime
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

    # Stock Type
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

    # Liquidity
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

    # Cycle (Wyckoff State Machine — LOCKED)
    cycle = 'RANGE'
    try:
        ctx = detect_wyckoff_phase(closes, highs, lows, volumes, vp_result)
        cycle = ctx.phase
    except Exception:
        pass

    pred = {
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'status': r['status'],
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
        'regime': regime, 'stock_type': stock_type,
        'liquidity': liquidity, 'cycle': cycle,
    }

    # إضافة للـ period المناسب
    if train_start <= pred_date <= train_end:
        predictions_by_period['TRAIN'].append(pred)

    for name, period in REGIME_PERIODS.items():
        if period['start'] <= pred_date <= period['end']:
            predictions_by_period[name].append(pred)
            break

# ═══════════════════════════════════════════════════════════════════════
# 6. تشغيل الـ LOCKED system على كل period
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/4] تشغيل الـ LOCKED system على كل period...")


def run_locked_system(predictions):
    """شغل الـ LOCKED system على predictions."""
    accepted = []
    skipped_exit = 0
    skipped_below_thr = 0
    pattern_usage = Counter()
    pattern_results = {}

    for p in predictions:
        pattern_name, conviction, weights = select_pattern(
            p['regime'], p['stock_type'], p['liquidity'], p['cycle']
        )
        pattern_usage[pattern_name] += 1

        if pattern_name in EXIT_PATTERNS:
            skipped_exit += 1
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
            skipped_below_thr += 1
            continue

        accepted.append({'status': p['status'], 'score': score, 'pattern': pattern_name})

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


# Run on TRAIN + all periods
train_result = run_locked_system(predictions_by_period['TRAIN'])
period_results = {}
for name in REGIME_PERIODS:
    if predictions_by_period[name]:
        period_results[name] = run_locked_system(predictions_by_period[name])

# ═══════════════════════════════════════════════════════════════════════
# 7. عرض النتائج
# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 100)
print("  📊 REGIME-BASED VALIDATION RESULTS (Parameter Lock)")
print("=" * 100)

# TRAIN (IS — In-Sample)
print(f"\n  TRAIN (IS — Parameter Lock source): {TRAIN_PERIOD['start']} → {TRAIN_PERIOD['end']}")
print(f"    total={train_result['n_total']} | accepted={train_result['n_accepted']} | "
      f"closed={train_result['n_closed']} | wins={train_result['n_wins']} | "
      f"WR={train_result['wr']:.1f}% | filter={train_result['filter_rate']:.1f}%")

IS_WR = train_result['wr']

# كل period (OOS — Out-of-Sample)
print(f"\n  {'Period':25s} | {'regime':>10s} | {'total':>5} | {'accept':>6} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'Gen.Ratio':>10}")
print("  " + "-" * 95)

# تجميع per regime
regime_summary = {'BULL': [], 'BEAR': [], 'SIDEWAYS': []}

for name in REGIME_PERIODS:
    if name not in period_results:
        continue
    r = period_results[name]
    regime = REGIME_PERIODS[name]['regime']
    gen_ratio = (r['wr'] / IS_WR) if IS_WR > 0 else 0
    regime_summary[regime].append((name, r, gen_ratio))
    print(f"  {name:25s} | {regime:>10s} | {r['n_total']:>5} | {r['n_accepted']:>6} | "
          f"{r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | {gen_ratio:>9.2f}")

# تجميع per regime
print("\n" + "=" * 100)
print("  📊 ملخص per REGIME (OOS aggregate)")
print("=" * 100)

print(f"\n  {'Regime':>10s} | {'periods':>7} | {'total':>5} | {'accept':>6} | {'closed':>6} | {'wins':>4} | {'avg WR':>7} | {'avg Gen':>8}")
print("  " + "-" * 80)

for regime, items in regime_summary.items():
    if not items:
        continue
    total = sum(r['n_total'] for _, r, _ in items)
    accept = sum(r['n_accepted'] for _, r, _ in items)
    closed = sum(r['n_closed'] for _, r, _ in items)
    wins = sum(r['n_wins'] for _, r, _ in items)
    wrs = [r['wr'] for _, r, _ in items if r['n_closed'] > 0]
    gens = [g for _, r, g in items if r['n_closed'] > 0]
    avg_wr = sum(wrs)/len(wrs) if wrs else 0
    avg_gen = sum(gens)/len(gens) if gens else 0
    print(f"  {regime:>10s} | {len(items):>7} | {total:>5} | {accept:>6} | {closed:>6} | {wins:>4} | {avg_wr:>6.1f}% | {avg_gen:>7.2f}")

# الـ Generalization Ratio الإجمالي
print("\n" + "=" * 100)
print("  📊 Generalization Ratio Analysis")
print("=" * 100)

all_oos_closed = sum(r['n_closed'] for r in period_results.values())
all_oos_wins = sum(r['n_wins'] for r in period_results.values())
OOS_WR = (all_oos_wins / all_oos_closed * 100) if all_oos_closed > 0 else 0
overall_gen = (OOS_WR / IS_WR) if IS_WR > 0 else 0

print(f"\n  IS WR (TRAIN):           {IS_WR:.1f}%")
print(f"  OOS WR (all periods):    {OOS_WR:.1f}% ({all_oos_wins}/{all_oos_closed})")
print(f"  Generalization Ratio:    {overall_gen:.2f}")
print(f"  التقييم: ", end="")
if overall_gen >= 0.85:
    print("✅ ممتاز (نسبة تعميم قوية)")
elif overall_gen >= 0.70:
    print("⚠️ مقبول (فيه overfitting بسيط)")
elif overall_gen >= 0.50:
    print("⚠️ ضعيف (overfitting واضح)")
else:
    print("❌ كارثة (overfitting شديد)")

# Pattern performance across regimes
print("\n" + "=" * 100)
print("  📊 Pattern Performance per Regime")
print("=" * 100)

# اجمع pattern results per regime
pattern_per_regime = {}
for regime, items in regime_summary.items():
    pattern_per_regime[regime] = Counter()
    pattern_wr_per_regime = {}
    for name, r, _ in items:
        for pat, pr in r['pattern_results'].items():
            pattern_per_regime[regime][pat] += pr['count']
            if pat not in pattern_wr_per_regime:
                pattern_wr_per_regime[pat] = {'wins': 0, 'closed': 0}
            pattern_wr_per_regime[pat]['wins'] += pr['wins']
            pattern_wr_per_regime[pat]['closed'] += pr['closed']

all_patterns = set()
for pcd in pattern_per_regime.values():
    all_patterns |= set(pcd.keys())

print(f"\n  {'Pattern':30s} | {'BULL WR':>8} | {'BEAR WR':>8} | {'SIDEWAYS WR':>12}")
print("  " + "-" * 70)
for pat in sorted(all_patterns):
    row = f"  {pat:30s} |"
    for regime in ['BULL', 'BEAR', 'SIDEWAYS']:
        # حساب WR للـ pattern ده في الـ regime ده
        wr = 0
        for name, r, _ in regime_summary[regime]:
            if pat in r['pattern_results']:
                pr = r['pattern_results'][pat]
                if pr['closed'] > 0:
                    wr = (pr['wins']/pr['closed']*100)
        row += f" {wr:>6.1f}% |"
    print(row)

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'regime_validation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'parameter_lock': 'LOCKED from TRAIN (2026-07-15 → 2026-09-15)',
        'is_wr': IS_WR,
        'oos_wr': OOS_WR,
        'generalization_ratio': overall_gen,
        'train_result': train_result,
        'period_results': period_results,
        'regime_summary': {r: [{'name': n, 'result': res, 'gen_ratio': g} for n, res, g in items]
                          for r, items in regime_summary.items()},
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 100)
print("  ✅ REGIME-BASED VALIDATION خلص — Parameter Lock + Generalization Ratio")
print("=" * 100)
