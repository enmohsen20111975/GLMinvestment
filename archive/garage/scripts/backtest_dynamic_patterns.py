#!/usr/bin/env python3
"""
backtest_dynamic_patterns.py — باك تست dynamic scoring بـ 10 patterns.

الـ framework:
  1. لكل توقع: detect الـ 4 dimensions (regime + stock_type + liquidity + cycle)
  2. اختار الـ pattern المناسب (priority-based)
  3. احسب الـ score بـ weights الديناميكية
  4. قارن vs static baseline

الـ 10 patterns (مبنية على 28 مصدر):
  1. LIQUIDITY_DRAIN_SURVIVOR (priority 1, EXIT)
  2. BEAR_DEFENDER (priority 2)
  3. SPRING_HUNTER (priority 3)
  4. DISTRIBUTION_EXIT (priority 4, EXIT)
  5. BOTTOM_FISHER (priority 5)
  6. BREAKOUT_RIDER (priority 6)
  7. TREND_RIDER (priority 7)
  8. VALUE_ACCUMULATOR (priority 8)
  9. SAFE_HAVEN_LARGE_CAP (priority 9)
  10. MEAN_REVERSION_RANGE (priority 10, fallback)
"""
import sys
import os
import json
import sqlite3
import statistics
from datetime import datetime
from pathlib import Path
from collections import Counter

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 90)
print("  🧪 BRAVO DYNAMIC PATTERNS BACKTEST — 10 patterns vs static")
print("=" * 90)

# ═══════════════════════════════════════════════════════════════════════
# 1. الـ 10 PATTERNS (مبنية على research — 28 مصدر)
# ═══════════════════════════════════════════════════════════════════════
PATTERNS = {
    "LIQUIDITY_DRAIN_SURVIVOR": {
        "priority": 1, "conviction": 0.0,  # EXIT
        "conditions": {"regime": ["BULL","RANGE","BEAR"], "stock_type": ["small"],
                       "liquidity": ["OUTFLOW","STRONG_OUTFLOW"],
                       "cycle": ["STOPPING_ACTION","SPRING","MARKUP_START","MARKUP_MID","DISTRIBUTION_START","DISTRIBUTION_MID"]},
        "weights": {"v38": 0.55, "core": 0.10, "smc": 0.35, "vp": 0.00},
    },
    "BEAR_DEFENDER": {
        "priority": 2, "conviction": 0.10,
        "conditions": {"regime": ["BEAR"], "stock_type": ["large"],
                       "liquidity": ["OUTFLOW","STRONG_OUTFLOW"],
                       "cycle": ["DISTRIBUTION_MID","STOPPING_ACTION"]},
        "weights": {"v38": 0.10, "core": 0.20, "smc": 0.40, "vp": 0.30},
    },
    "SPRING_HUNTER": {
        "priority": 3, "conviction": 0.40,
        "conditions": {"regime": ["BEAR","RANGE","BULL"], "stock_type": ["mid","small"],
                       "liquidity": ["NEUTRAL","MODERATE_INFLOW"],
                       "cycle": ["SPRING"]},
        "weights": {"v38": 0.15, "core": 0.10, "smc": 0.40, "vp": 0.35},
    },
    "DISTRIBUTION_EXIT": {
        "priority": 4, "conviction": 0.0,  # EXIT
        "conditions": {"regime": ["BULL","RANGE"], "stock_type": ["large","mid"],
                       "liquidity": ["OUTFLOW"],
                       "cycle": ["DISTRIBUTION_START"]},
        "weights": {"v38": 0.10, "core": 0.20, "smc": 0.35, "vp": 0.35},
    },
    "BOTTOM_FISHER": {
        "priority": 5, "conviction": 0.15,
        "conditions": {"regime": ["BEAR","RANGE"], "stock_type": ["mid","small"],
                       "liquidity": ["STRONG_OUTFLOW"],
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
                       "cycle": ["STOPPING_ACTION","SPRING"]},
        "weights": {"v38": 0.10, "core": 0.40, "smc": 0.20, "vp": 0.30},
    },
    "SAFE_HAVEN_LARGE_CAP": {
        "priority": 9, "conviction": 0.30,
        "conditions": {"regime": ["RANGE","BEAR"], "stock_type": ["large"],
                       "liquidity": ["MODERATE_INFLOW","NEUTRAL"],
                       "cycle": ["STOPPING_ACTION","SPRING"]},
        "weights": {"v38": 0.10, "core": 0.45, "smc": 0.15, "vp": 0.30},
    },
    "MEAN_REVERSION_RANGE": {
        "priority": 10, "conviction": 0.20,  # fallback
        "conditions": {"regime": ["RANGE"], "stock_type": ["large","mid","small"],
                       "liquidity": ["NEUTRAL"],
                       "cycle": ["STOPPING_ACTION","DISTRIBUTION_MID","MARKUP_MID"]},
        "weights": {"v38": 0.05, "core": 0.20, "smc": 0.25, "vp": 0.50},
    },
}

# ═══════════════════════════════════════════════════════════════════════
# 2. تحميل التوقعات
# ═══════════════════════════════════════════════════════════════════════
print("\n[1/5] تحميل التوقعات...")
pred_db = DB_DIR / 'predictions.db'
conn = sqlite3.connect(str(pred_db))
conn.row_factory = sqlite3.Row

START_DATE = '2026-09-15'
END_DATE = '2026-10-15'

rows = conn.execute("""
    SELECT id, ticker, prediction_date, signal, master_score, technical_score,
           risk_reward, entry_price, target_price, stop_loss, status, actual_return
    FROM predictions
    WHERE signal LIKE '%BUY%' AND status NOT LIKE 'INVALID%'
      AND prediction_date >= ? AND prediction_date <= ?
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
    ORDER BY prediction_date
""", (START_DATE, END_DATE)).fetchall()
conn.close()
print(f"  ✅ {len(rows)} توقع")

# ═══════════════════════════════════════════════════════════════════════
# 3. تحميل بيانات الأسعار
# ═══════════════════════════════════════════════════════════════════════
print("\n[2/5] تحميل بيانات الأسعار...")
ph_db = DB_DIR / 'price_history.db'
ph_conn = sqlite3.connect(str(ph_db))
ph_conn.row_factory = sqlite3.Row

ticker_data = {}
for r in rows:
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
# 4. حساب 5 inputs + 4 dimensions لكل توقع
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] حساب 4 dimensions + 5 inputs...")

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer
from utils.shared_liquidity import compute_money_flow

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions = []
_fail_counts = Counter()

for idx, r in enumerate(rows):
    if idx % 50 == 0:
        print(f"  ... {idx}/{len(rows)}", flush=True)

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

    # === V38 score ===
    v38 = float(r['technical_score']) if r['technical_score'] is not None else 50.0

    # === CoreScoring ===
    core = 50.0
    try:
        result = _cse.analyze(ticker=ticker, price_data={
            'closes': closes, 'opens': opens, 'highs': highs, 'lows': lows, 'volumes': volumes
        }, market='EGX', persona='trader')
        if result and result.score is not None:
            core = float(result.score)
    except Exception:
        _fail_counts['core'] += 1

    # === SMC ===
    smc = 50.0
    try:
        candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                   for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
        smc_r = calculate_smc_score(candles, closes[-1])
        if smc_r and 'score' in smc_r:
            smc = float(smc_r['score'])
    except Exception:
        _fail_counts['smc'] += 1

    # === VP ===
    vp = 50.0
    try:
        vp_r = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_r and vp_r.score is not None:
            vp = float(vp_r.score)
    except Exception:
        _fail_counts['vp'] += 1

    # === DIMENSION 1: Regime (BULL/RANGE/BEAR) ===
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
        _fail_counts['regime'] += 1

    # === DIMENSION 2: Stock Type (large/mid/small) ===
    stock_type = 'mid'
    try:
        avg_vol_30 = sum(volumes[-30:]) / 30 if len(volumes) >= 30 else 0
        avg_price = sum(closes[-30:]) / 30 if len(closes) >= 30 else 0
        adv_30 = avg_vol_30 * avg_price  # $ turnover
        if adv_30 >= 10_000_000:  # >10M EGP/day = large cap
            stock_type = 'large'
        elif adv_30 >= 1_000_000:  # 1-10M EGP/day = mid cap
            stock_type = 'mid'
        else:  # <1M EGP/day = small cap
            stock_type = 'small'
    except Exception:
        _fail_counts['stock_type'] += 1

    # === DIMENSION 3: Liquidity (5 states) ===
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
        _fail_counts['liquidity'] += 1

    # === DIMENSION 4: Cycle Phase (6 phases) ===
    cycle = 'MARKUP_MID'  # default
    try:
        if len(closes) >= 30:
            # تصنيف مبسط بـ السعر + volume trend
            roc10 = (closes[-1] - closes[-10]) / closes[-10] * 100 if len(closes) >= 10 else 0
            roc20 = (closes[-1] - closes[-20]) / closes[-20] * 100 if len(closes) >= 20 else 0
            vol_ratio = (sum(volumes[-5:])/5) / (sum(volumes[-20:])/20) if len(volumes) >= 20 else 1

            if roc20 < -10 and roc10 < -5:
                cycle = 'STOPPING_ACTION'  # selling climax
            elif roc20 < -5 and roc10 > 0:
                cycle = 'SPRING'  # reversal attempt
            elif roc20 > 5 and roc10 > 3 and vol_ratio > 1.3:
                cycle = 'MARKUP_START'  # breakout
            elif roc20 > 5 and roc10 > 0:
                cycle = 'MARKUP_MID'  # trending up
            elif roc20 > 0 and roc10 < -2:
                cycle = 'DISTRIBUTION_START'  # topping
            else:
                cycle = 'DISTRIBUTION_MID'
    except Exception:
        _fail_counts['cycle'] += 1

    predictions.append({
        'id': r['id'], 'ticker': ticker, 'pred_date': pred_date,
        'signal': r['signal'], 'status': r['status'],
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
        'regime': regime, 'stock_type': stock_type,
        'liquidity': liquidity, 'cycle': cycle,
    })

print(f"  ✅ {len(predictions)} توقع بـ 4 dimensions")
print(f"  fails: {dict(_fail_counts)}")

# ═══════════════════════════════════════════════════════════════════════
# 5. اختيار pattern + حساب score
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] اختيار pattern + حساب dynamic score...")

def select_pattern(regime, stock_type, liquidity, cycle):
    """اختر الـ pattern المناسب بـ priority."""
    candidates = []
    for name, pat in PATTERNS.items():
        cond = pat['conditions']
        if regime in cond['regime'] and stock_type in cond['stock_type'] \
           and liquidity in cond['liquidity'] and cycle in cond['cycle']:
            candidates.append((name, pat['priority'], pat['conviction'], pat['weights']))
    if not candidates:
        return 'MEAN_REVERSION_RANGE', 0.20, PATTERNS['MEAN_REVERSION_RANGE']['weights']
    candidates.sort(key=lambda x: x[1])  # priority ascending
    name, _, conviction, weights = candidates[0]
    return name, conviction, weights

# تجربة 3 scenarios
SCENARIOS = {
    'S0_static_baseline': {'type': 'static', 'weights': {'v38':0.75,'core':0.00,'smc':0.15,'vp':0.10}, 'threshold': 65},
    'S1_static_hybrid':   {'type': 'static', 'weights': {'v38':0.30,'core':0.35,'smc':0.20,'vp':0.15}, 'threshold': 55},
    'S2_dynamic_patterns':{'type': 'dynamic', 'threshold': 55, 'exit_patterns': ['LIQUIDITY_DRAIN_SURVIVOR', 'DISTRIBUTION_EXIT']},
}

results = {}
pattern_usage = Counter()

for scen_name, scen in SCENARIOS.items():
    threshold = scen['threshold']
    predictions_eval = []

    for p in predictions:
        if scen['type'] == 'dynamic':
            pattern_name, conviction, weights = select_pattern(
                p['regime'], p['stock_type'], p['liquidity'], p['cycle']
            )
            pattern_usage[pattern_name] += 1

            # EXIT patterns → skip
            if pattern_name in scen['exit_patterns']:
                continue

            # حساب dynamic score
            score = (
                p['v38']  * weights['v38']  +
                p['core'] * weights['core'] +
                p['smc']  * weights['smc']  +
                p['vp']   * weights['vp']
            )
            score = max(0, min(100, round(score, 2)))
            predictions_eval.append({
                'status': p['status'], 'score': score,
                'pattern': pattern_name, 'conviction': conviction,
            })
        else:
            # static
            w = scen['weights']
            score = (
                p['v38']  * w['v38']  +
                p['core'] * w['core'] +
                p['smc']  * w['smc']  +
                p['vp']   * w['vp']
            )
            score = max(0, min(100, round(score, 2)))
            predictions_eval.append({
                'status': p['status'], 'score': score,
                'pattern': 'static', 'conviction': 0,
            })

    # threshold filter
    above_thr = [p for p in predictions_eval if p['score'] >= threshold]
    closed = [p for p in above_thr if p['status'] in ('TARGET_HIT','STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']

    n_total = len(predictions)
    n_above = len(above_thr)
    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins/n_closed*100) if n_closed > 0 else 0

    # pattern distribution
    pattern_dist = Counter(p['pattern'] for p in above_thr).most_common()

    results[scen_name] = {
        'n_total': n_total, 'n_above': n_above, 'n_closed': n_closed,
        'n_wins': n_wins, 'wr': wr,
        'pattern_dist': pattern_dist,
        'filter_rate': (1 - n_above/n_total)*100 if n_total > 0 else 0,
    }

# ═══════════════════════════════════════════════════════════════════════
# 6. عرض النتائج
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] عرض النتائج...")
print("\n" + "="*90)
print("  📊 النتائج: static baseline vs dynamic patterns")
print("="*90)

print(f"\n{'Scenario':25s} | {'total':>5} | {'≥thr':>4} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'filter':>7}")
print("-"*80)
for name, r in results.items():
    print(f"{name:25s} | {r['n_total']:>5} | {r['n_above']:>4} | {r['n_closed']:>6} | "
          f"{r['n_wins']:>4} | {r['wr']:>5.1f}% | {r['filter_rate']:>6.1f}%")

# Pattern distribution في S2
print("\n" + "="*90)
print("  📊 Pattern distribution في S2 (dynamic)")
print("="*90)
print(f"\n  Total predictions: {len(predictions)}")
print(f"  Pattern usage (all predictions):")
for pat, cnt in pattern_usage.most_common():
    pct = cnt/len(predictions)*100
    bar = '█' * int(pct/2)
    print(f"    {pat:30s} | {cnt:>4} ({pct:>5.1f}%) {bar}")

# Pattern performance (WR per pattern)
print("\n" + "="*90)
print("  📊 WR per pattern (في S2)")
print("="*90)
s2_above = []
for p in predictions:
    pattern_name, conviction, weights = select_pattern(
        p['regime'], p['stock_type'], p['liquidity'], p['cycle']
    )
    if pattern_name in ['LIQUIDITY_DRAIN_SURVIVOR', 'DISTRIBUTION_EXIT']:
        continue
    score = p['v38']*weights['v38'] + p['core']*weights['core'] + p['smc']*weights['smc'] + p['vp']*weights['vp']
    score = max(0, min(100, round(score, 2)))
    if score >= 55:
        s2_above.append({'status': p['status'], 'pattern': pattern_name})

pattern_wr = {}
for p in s2_above:
    pat = p['pattern']
    if pat not in pattern_wr:
        pattern_wr[pat] = {'count':0,'wins':0,'closed':0}
    pattern_wr[pat]['count'] += 1
    if p['status'] == 'TARGET_HIT':
        pattern_wr[pat]['wins'] += 1
    if p['status'] in ('TARGET_HIT','STOPPED'):
        pattern_wr[pat]['closed'] += 1

print(f"\n{'Pattern':30s} | {'count':>5} | {'closed':>6} | {'wins':>4} | {'WR':>6}")
print("-"*70)
for pat, d in sorted(pattern_wr.items(), key=lambda x: -x[1]['count']):
    wr = (d['wins']/d['closed']*100) if d['closed'] > 0 else 0
    print(f"{pat:30s} | {d['count']:>5} | {d['closed']:>6} | {d['wins']:>4} | {wr:>5.1f}%")

# Dimension distribution
print("\n" + "="*90)
print("  📊 Dimension distribution (في كل التوقعات)")
print("="*90)
for dim in ['regime', 'stock_type', 'liquidity', 'cycle']:
    dist = Counter(p[dim] for p in predictions).most_common()
    print(f"\n  {dim}:")
    for val, cnt in dist:
        pct = cnt/len(predictions)*100
        print(f"    {val:20s} | {cnt:>4} ({pct:>5.1f}%)")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'dynamic_patterns_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'period': f'{START_DATE} → {END_DATE}',
        'n_predictions': len(predictions),
        'scenarios': results,
        'pattern_usage': dict(pattern_usage),
        'pattern_wr': pattern_wr,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "="*90)
print("  ✅ الباك تست خلص")
print("="*90)
