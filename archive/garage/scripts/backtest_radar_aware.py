#!/usr/bin/env python3
"""
backtest_radar_aware.py — باك تست مدمج لـ مرحلة 2 + 3:
  - مرحلة 2: زيادة وزن SMC + VP
  - مرحلة 3: ربط الرادار عكسيًا (مدخل قرار مش HARD GATE بس)

الـ framework:
  1. يحسب 5 inputs لكل سهم: v38 + core + smc + vp + radar_flow
  2. يـجرب 6 scenarios (baseline + 5 combos)
  3. كل scenario بـ threshold مختلف + radar boost مختلف
  4. يقارن النتائج

الـ usage:
  python3 scripts/backtest_radar_aware.py
"""
import sys
import os
import json
import sqlite3
import statistics
from datetime import datetime
from pathlib import Path

VPS = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS))

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

print("=" * 80)
print("  🧪 BRAVO RADAR-AWARE HYBRID BACKTEST — مراحل 2 + 3 مدموجة")
print("=" * 80)

# ═══════════════════════════════════════════════════════════════════════
# 1. الـ scenarios (6 combinations)
# ═══════════════════════════════════════════════════════════════════════
SCENARIOS = {
    'S0_baseline': {
        'weights':  {'v38': 0.75, 'core': 0.00, 'smc': 0.15, 'vp': 0.10},
        'threshold': 65,
        'radar_mode': 'hard_gate_only',  # HARD GATE بس (الحالي)
        'radar_boost': {'strong_inflow': 0, 'moderate_inflow': 0, 'outflow': 0, 'strong_outflow': 0},
    },
    'S1_hybrid_low_thr': {
        'weights':  {'v38': 0.40, 'core': 0.35, 'smc': 0.15, 'vp': 0.10},
        'threshold': 50,
        'radar_mode': 'hard_gate_only',
        'radar_boost': {'strong_inflow': 0, 'moderate_inflow': 0, 'outflow': 0, 'strong_outflow': 0},
    },
    'S2_hybrid_high_smc_vp': {  # مرحلة 2: SMC + VP أعلى
        'weights':  {'v38': 0.25, 'core': 0.35, 'smc': 0.25, 'vp': 0.15},
        'threshold': 55,
        'radar_mode': 'hard_gate_only',
        'radar_boost': {'strong_inflow': 0, 'moderate_inflow': 0, 'outflow': 0, 'strong_outflow': 0},
    },
    'S3_radar_aware': {  # مرحلة 3: radar boost input
        'weights':  {'v38': 0.30, 'core': 0.35, 'smc': 0.20, 'vp': 0.15},
        'threshold': 55,
        'radar_mode': 'boost_input',
        'radar_boost': {'strong_inflow': +8, 'moderate_inflow': +4, 'outflow': -5, 'strong_outflow': -10},
    },
    'S4_radar_dominant': {  # radar أقوى
        'weights':  {'v38': 0.25, 'core': 0.30, 'smc': 0.20, 'vp': 0.15},
        'threshold': 55,
        'radar_mode': 'boost_input',
        'radar_boost': {'strong_inflow': +12, 'moderate_inflow': +6, 'outflow': -8, 'strong_outflow': -15},
    },
    'S5_radar_pre_filter': {  # radar يـ reject الـ outflow قبل أي حساب
        'weights':  {'v38': 0.30, 'core': 0.35, 'smc': 0.20, 'vp': 0.15},
        'threshold': 55,
        'radar_mode': 'pre_filter',
        'radar_boost': {'strong_inflow': +8, 'moderate_inflow': +4, 'outflow': -1000, 'strong_outflow': -1000},
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
           risk_reward, entry_price, target_price, stop_loss, status,
           actual_return, holding_days
    FROM predictions
    WHERE signal LIKE '%BUY%'
      AND status NOT LIKE 'INVALID%'
      AND prediction_date >= ? AND prediction_date <= ?
      AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
      AND target_price > entry_price AND stop_loss < entry_price
    ORDER BY prediction_date
""", (START_DATE, END_DATE)).fetchall()
conn.close()

print(f"  ✅ {len(rows)} توقع في الفترة")

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
print(f"  ✅ {len(ticker_data)} ticker لهم بيانات كافية")

# ═══════════════════════════════════════════════════════════════════════
# 4. حساب 5 inputs لكل توقع
# ═══════════════════════════════════════════════════════════════════════
print("\n[3/5] حساب 5 inputs (v38 + core + smc + vp + radar_flow)...")

from analyzers.core_scoring_engine import CoreScoringEngine
from analyzers.smc_engine import calculate_smc_score
from analyzers.volume_profile import VolumeProfileAnalyzer
from utils.shared_liquidity import compute_money_flow, check_kill_switch

_cse = CoreScoringEngine()
_vp = VolumeProfileAnalyzer()

predictions = []
_fail_counts = {'core': 0, 'smc': 0, 'vp': 0, 'radar': 0}

for idx, r in enumerate(rows):
    if idx % 50 == 0:
        print(f"  ... {idx}/{len(rows)}", flush=True)

    ticker = r['ticker']
    pred_date = r['prediction_date'][:10]
    if ticker not in ticker_data or pred_date not in ticker_data[ticker]:
        continue

    data = ticker_data[ticker][pred_date]
    # فلتر None
    filtered = [(o, h, l, c, v) for o, h, l, c, v in
                zip(data['opens'], data['highs'], data['lows'], data['closes'], data['volumes'])
                if c is not None and h is not None and l is not None and o is not None and c > 0]
    if len(filtered) < 30:
        continue

    opens = [f[0] for f in filtered]
    highs = [f[1] for f in filtered]
    lows = [f[2] for f in filtered]
    closes = [f[3] for f in filtered]
    volumes = [f[4] for f in filtered]

    # V38 = technical_score من الـ DB
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
        _fail_counts['core'] += 1

    # SMC
    smc = 50.0
    try:
        candles = [{'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
                   for o, h, l, c, v in zip(opens, highs, lows, closes, volumes)]
        smc_r = calculate_smc_score(candles, closes[-1])
        if smc_r and 'score' in smc_r:
            smc = float(smc_r['score'])
    except Exception:
        _fail_counts['smc'] += 1

    # VP
    vp = 50.0
    try:
        vp_r = _vp.analyze(closes[-30:], volumes[-30:])
        if vp_r and vp_r.score is not None:
            vp = float(vp_r.score)
    except Exception:
        _fail_counts['vp'] += 1

    # Radar money flow
    radar_state = 'neutral'
    radar_kill = False
    try:
        if len(closes) >= 18:
            _kill, _reason = check_kill_switch(closes, volumes, highs, lows)
            if _kill:
                radar_kill = True
            mf = compute_money_flow(closes, volumes, highs, lows)
            radar_state = mf.get('money_flow_state', 'neutral')
    except Exception:
        _fail_counts['radar'] += 1

    # تصنيف الـ radar state لـ 4 buckets
    radar_bucket = 'neutral'
    if '🔥 دخول قوي' in radar_state:
        radar_bucket = 'strong_inflow'
    elif '🟢 سيولة داخلة' in radar_state:
        radar_bucket = 'moderate_inflow'
    elif '🔥 خروج قوي' in radar_state:
        radar_bucket = 'strong_outflow'
    elif '🔴 سيولة خارجة' in radar_state:
        radar_bucket = 'outflow'

    predictions.append({
        'id': r['id'],
        'ticker': ticker,
        'pred_date': pred_date,
        'signal': r['signal'],
        'status': r['status'],
        'v38': v38, 'core': core, 'smc': smc, 'vp': vp,
        'radar_bucket': radar_bucket,
        'radar_kill': radar_kill,
    })

print(f"  ✅ {len(predictions)} توقع بـ 5 inputs")
print(f"  fails: {_fail_counts}")

# ═══════════════════════════════════════════════════════════════════════
# 5. تشغيل كل scenario
# ═══════════════════════════════════════════════════════════════════════
print("\n[4/5] تشغيل كل scenario...")

def score_band(s):
    if s is None: return 'NULL'
    if s < 50: return '<50'
    if s < 60: return '50-60'
    if s < 65: return '60-65'
    if s < 70: return '65-70'
    if s < 80: return '70-80'
    if s < 90: return '80-90'
    return '>=90'

results = {}
for scen_name, scen in SCENARIOS.items():
    w = scen['weights']
    thr = scen['threshold']
    boosts = scen['radar_boost']

    predictions_eval = []
    for p in predictions:
        # Pre-filter: لو radar_mode = pre_filter و radar_kill → skip
        if scen['radar_mode'] == 'pre_filter' and p['radar_kill']:
            continue
        # Pre-filter: لو radar outflow + pre_filter → skip
        if scen['radar_mode'] == 'pre_filter' and p['radar_bucket'] in ('outflow', 'strong_outflow'):
            continue

        # حساب hybrid score
        hybrid = (
            p['v38']  * w['v38']  +
            p['core'] * w['core'] +
            p['smc']  * w['smc']  +
            p['vp']   * w['vp']
        )

        # Radar boost input (مرحلة 3)
        if scen['radar_mode'] in ('boost_input', 'pre_filter'):
            hybrid += boosts.get(p['radar_bucket'], 0)

        hybrid = max(0, min(100, round(hybrid, 2)))

        predictions_eval.append({
            'status': p['status'],
            'score': hybrid,
            'radar_bucket': p['radar_bucket'],
            'radar_kill': p['radar_kill'],
        })

    # Hard gate (كله scenarios فيهم hard gate — ده defense-in-depth)
    accepted = [p for p in predictions_eval if not p['radar_kill']]
    rejected = [p for p in predictions_eval if p['radar_kill']]

    # threshold filter
    above_thr = [p for p in accepted if p['score'] >= thr]

    closed = [p for p in above_thr if p['status'] in ('TARGET_HIT', 'STOPPED')]
    wins = [p for p in closed if p['status'] == 'TARGET_HIT']

    n_total = len(predictions_eval)
    n_accepted = len(accepted)
    n_above_thr = len(above_thr)
    n_closed = len(closed)
    n_wins = len(wins)
    wr = (n_wins / n_closed * 100) if n_closed > 0 else 0

    # bands distribution
    bands = {}
    for p in above_thr:
        b = score_band(p['score'])
        if b not in bands:
            bands[b] = {'count': 0, 'wins': 0, 'closed': 0}
        bands[b]['count'] += 1
        if p['status'] == 'TARGET_HIT':
            bands[b]['wins'] += 1
        if p['status'] in ('TARGET_HIT', 'STOPPED'):
            bands[b]['closed'] += 1

    # radar distribution
    radar_dist = {}
    for p in above_thr:
        rb = p['radar_bucket']
        if rb not in radar_dist:
            radar_dist[rb] = {'count': 0, 'wins': 0, 'closed': 0}
        radar_dist[rb]['count'] += 1
        if p['status'] == 'TARGET_HIT':
            radar_dist[rb]['wins'] += 1
        if p['status'] in ('TARGET_HIT', 'STOPPED'):
            radar_dist[rb]['closed'] += 1

    # WR per radar bucket
    wr_radar = {}
    for rb, d in radar_dist.items():
        wr_radar[rb] = (d['wins'] / d['closed'] * 100) if d['closed'] > 0 else 0

    results[scen_name] = {
        'scenario': scen,
        'n_total': n_total,
        'n_rejected_kill': len(rejected),
        'n_above_thr': n_above_thr,
        'n_closed': n_closed,
        'n_wins': n_wins,
        'wr': wr,
        'bands': bands,
        'radar_dist': radar_dist,
        'wr_radar': wr_radar,
    }

# ═══════════════════════════════════════════════════════════════════════
# 6. عرض النتائج
# ═══════════════════════════════════════════════════════════════════════
print("\n[5/5] عرض النتائج...")
print("\n" + "=" * 100)
print("  📊 النتائج: مقارنة scenarios (مرحلة 2 + 3 مدموجة)")
print("=" * 100)

print(f"\n{'Scenario':25s} | {'thr':>4} | {'total':>5} | {'kill':>4} | {'≥thr':>4} | {'closed':>6} | {'wins':>4} | {'WR':>6} | {'≥90':>3} | {'WR≥90':>6}")
print("-" * 110)
for name, r in results.items():
    s = r['scenario']
    n_ge90 = r['bands'].get('>=90', {}).get('count', 0)
    n_ge90_closed = r['bands'].get('>=90', {}).get('closed', 0)
    n_ge90_wins = r['bands'].get('>=90', {}).get('wins', 0)
    wr_ge90 = (n_ge90_wins / n_ge90_closed * 100) if n_ge90_closed > 0 else 0
    print(f"{name:25s} | {s['threshold']:>4} | {r['n_total']:>5} | {r['n_rejected_kill']:>4} | "
          f"{r['n_above_thr']:>4} | {r['n_closed']:>6} | {r['n_wins']:>4} | {r['wr']:>5.1f}% | "
          f"{n_ge90:>3} | {wr_ge90:>5.1f}%")

# WR per radar bucket
print("\n" + "=" * 100)
print("  📊 WR لكل radar bucket (للـ scenarios اللي فيها radar input)")
print("=" * 100)
print(f"\n{'Scenario':25s} | {'strong_in':>10} | {'mod_in':>10} | {'neutral':>10} | {'outflow':>10} | {'strong_out':>10}")
print("-" * 100)
for name, r in results.items():
    wr = r['wr_radar']
    si = wr.get('strong_inflow', 0)
    mi = wr.get('moderate_inflow', 0)
    ne = wr.get('neutral', 0)
    of = wr.get('outflow', 0)
    so = wr.get('strong_outflow', 0)
    print(f"{name:25s} | {si:>9.1f}% | {mi:>9.1f}% | {ne:>9.1f}% | {of:>9.1f}% | {so:>9.1f}%")

# Radar distribution
print("\n" + "=" * 100)
print("  📊 توزيع radar buckets في الـ accepted (≥threshold)")
print("=" * 100)
print(f"\n{'Scenario':25s} | {'strong_in':>10} | {'mod_in':>10} | {'neutral':>10} | {'outflow':>10} | {'strong_out':>10}")
print("-" * 100)
for name, r in results.items():
    d = r['radar_dist']
    si = d.get('strong_inflow', {}).get('count', 0)
    mi = d.get('moderate_inflow', {}).get('count', 0)
    ne = d.get('neutral', {}).get('count', 0)
    of = d.get('outflow', {}).get('count', 0)
    so = d.get('strong_outflow', {}).get('count', 0)
    print(f"{name:25s} | {si:>10} | {mi:>10} | {ne:>10} | {of:>10} | {so:>10}")

# حفظ JSON
output_path = PROJECT / 'vps-service' / 'backtest_results' / f'radar_aware_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
output_path.parent.mkdir(exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated_at': datetime.now().isoformat(),
        'period': f'{START_DATE} → {END_DATE}',
        'n_predictions': len(predictions),
        'scenarios': results,
    }, f, indent=2, ensure_ascii=False, default=str)

print(f"\n  💾 النتائج محفوظة: {output_path}")
print("\n" + "=" * 100)
print("  ✅ الباك تست خلص")
print("=" * 100)
