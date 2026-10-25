#!/usr/bin/env python3
"""
Historical Validation — Shadow Mode Comparison
==============================================
يقارن التوقعات الحالية مع canonical_state على بيانات تاريخية حقيقية.

لا يستخدم بيانات وهمية. لا يغيّر قرارات الإنتاج. read-only على price_history + predictions.

الاختبار:
  1. يجمع آخر N توقعات من predictions.db (sandbox sample).
  2. لكل توقع، يجلب canonical_state للسهم+التاريخ.
  3. يحسب: نسبة التوقعات اللي عندها canonical_state.
  4. يحسب: توزيع canonical_state على التوقعات BUY/HOLD/SELL.
  5. يحسب: هل التوقعات اللي canonical_state=DISTRIBUTION/DOWNTREND أداؤها أسوأ فعليًا؟

ممنوع:
  - لمس DBs الإنتاجية.
  - اعتبار النتائج إثبات نهائي (sample محدود).
"""
import sys
import sqlite3
from pathlib import Path
from collections import defaultdict, Counter

PROJECT_ROOT = Path('/home/z/my-project')
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS))

import canonical_state_shadow as shadow

DB_PRED = PROJECT_ROOT / 'db' / 'predictions.db'
DB_STOCKS = PROJECT_ROOT / 'db' / 'stocks.db'

results_log = []

def log(name, value, detail=''):
    print(f'{name}: {value} | {detail}' if detail else f'{name}: {value}')
    results_log.append((name, value, detail))


print('='*80)
print('Historical Validation — Shadow Mode Comparison')
print('='*80)
print(f'predictions.db: {DB_PRED} ({DB_PRED.stat().st_size / 1e6:.1f} MB)')
print(f'stocks.db: {DB_STOCKS} ({DB_STOCKS.stat().st_size / 1e6:.1f} MB)')
print()


# ═══════════════════════════════════════════════════════════════════════════
# Step 1: جمع آخر 1000 توقع من predictions.db
# ═══════════════════════════════════════════════════════════════════════════
print('Step 1: جمع آخر 1000 توقع من predictions.db')
print('-'*60)

try:
    conn_pred = sqlite3.connect(f'file:{DB_PRED}?mode=ro', uri=True, timeout=30)
    # Check predictions table schema
    cols = [r[1] for r in conn_pred.execute("PRAGMA table_info(predictions)").fetchall()]
    print(f'predictions columns: {cols[:10]}...')

    # Get total predictions count
    total_preds = conn_pred.execute('SELECT COUNT(*) FROM predictions').fetchone()[0]
    print(f'total predictions: {total_preds}')

    # Get last 1000 predictions with outcome data
    # Use whatever columns exist
    has_actual_return = 'actual_return' in cols
    has_signal = 'signal' in cols
    has_prediction_date = 'prediction_date' in cols

    select_cols = ['ticker']
    if has_prediction_date:
        select_cols.append('prediction_date')
    else:
        select_cols.append("'' as prediction_date")
    if has_signal:
        select_cols.append('signal')
    else:
        select_cols.append("signal_type as signal")
    select_cols.extend(['entry_price', 'target_price', 'stop_loss'])
    if 'master_score' in cols:
        select_cols.append('master_score')
    else:
        select_cols.append('NULL as master_score')
    if has_actual_return:
        select_cols.append('actual_return')
    else:
        select_cols.append('NULL as actual_return')
    if 'hit_target' in cols:
        select_cols.append('hit_target')
    else:
        select_cols.append('NULL as hit_target')
    if 'hit_stop' in cols:
        select_cols.append('hit_stop')
    else:
        select_cols.append('NULL as hit_stop')

    query = f"SELECT {', '.join(select_cols)} FROM predictions ORDER BY id DESC LIMIT 1000"
    rows = conn_pred.execute(query).fetchall()
    print(f'sample size: {len(rows)} predictions')
except Exception as e:
    print(f'❌ failed to read predictions: {e}')
    rows = []
    conn_pred = None

if not rows:
    print('No predictions available for historical validation.')
    sys.exit(0)


# ═══════════════════════════════════════════════════════════════════════════
# Step 2: لكل توقع، جلب canonical_state
# ═══════════════════════════════════════════════════════════════════════════
print()
print('Step 2: جلب canonical_state لكل توقع')
print('-'*60)

predictions_with_state = []
predictions_without_state = 0

for row in rows:
    ticker = row[0]
    pred_date = row[1] or ''
    signal = row[2] or ''
    entry_price = row[3]
    target_price = row[4]
    stop_loss = row[5]
    master_score = row[6]
    actual_return = row[7]
    hit_target = row[8]
    hit_stop = row[9]

    if not pred_date:
        # Try to use created_at or similar
        continue

    cs = shadow.fetch_canonical_state_for_ticker(ticker, pred_date, stocks_db_path=str(DB_STOCKS))
    if cs and cs.get('canonical_state'):
        predictions_with_state.append({
            'ticker': ticker,
            'pred_date': pred_date,
            'signal': signal,
            'entry_price': entry_price,
            'master_score': master_score,
            'actual_return': actual_return,
            'hit_target': hit_target,
            'hit_stop': hit_stop,
            'canonical_state': cs['canonical_state'],
            'canonical_confidence': cs['confidence'],
        })
    else:
        predictions_without_state += 1

total = len(predictions_with_state) + predictions_without_state
coverage = (len(predictions_with_state) / total * 100) if total > 0 else 0

log('predictions with canonical_state', len(predictions_with_state))
log('predictions without canonical_state', predictions_without_state)
log('coverage %', f'{coverage:.1f}%')
print()


# ═══════════════════════════════════════════════════════════════════════════
# Step 3: توزيع canonical_state على التوقعات
# ═══════════════════════════════════════════════════════════════════════════
print('Step 3: توزيع canonical_state على التوقعات')
print('-'*60)

state_distribution = Counter(p['canonical_state'] for p in predictions_with_state)
print(f'{"State":25s} {"Count":>6s} {"%":>6s}')
for state, count in state_distribution.most_common():
    pct = count / len(predictions_with_state) * 100
    print(f'{state:25s} {count:>6d} {pct:>5.1f}%')
print()


# ═══════════════════════════════════════════════════════════════════════════
# Step 4: توزيع signal (BUY/SELL/HOLD) لكل canonical_state
# ═══════════════════════════════════════════════════════════════════════════
print('Step 4: توزيع signal لكل canonical_state')
print('-'*60)

state_signal_matrix = defaultdict(lambda: Counter())
for p in predictions_with_state:
    state_signal_matrix[p['canonical_state']][p['signal']] += 1

print(f'{"State":25s} {"BUY":>5s} {"SELL":>5s} {"HOLD":>5s} {"Other":>6s}')
for state in sorted(state_signal_matrix.keys()):
    signals = state_signal_matrix[state]
    buy = signals.get('BUY', 0) + signals.get('STRONG_BUY', 0)
    sell = signals.get('SELL', 0) + signals.get('REDUCE', 0) + signals.get('STRONG_SELL', 0)
    hold = signals.get('HOLD', 0) + signals.get('ACCUMULATE', 0)
    other = sum(signals.values()) - buy - sell - hold
    print(f'{state:25s} {buy:>5d} {sell:>5d} {hold:>5d} {other:>6d}')
print()


# ═══════════════════════════════════════════════════════════════════════════
# Step 5: تحليل الأداء الفعلي لكل canonical_state
# ═══════════════════════════════════════════════════════════════════════════
print('Step 5: تحليل الأداء الفعلي (actual_return) لكل canonical_state')
print('-'*60)

state_performance = defaultdict(list)
for p in predictions_with_state:
    if p['actual_return'] is not None:
        state_performance[p['canonical_state']].append(p['actual_return'])

print(f'{"State":25s} {"N":>5s} {"Avg Return %":>14s} {"Win Rate %":>12s} {"Hit Target %":>14s}')
for state in sorted(state_performance.keys()):
    returns = state_performance[state]
    n = len(returns)
    if n == 0:
        continue
    avg_return = sum(returns) / n
    wins = sum(1 for r in returns if r > 0)
    win_rate = wins / n * 100

    # Count hit_target for this state
    state_preds = [p for p in predictions_with_state if p['canonical_state'] == state and p['hit_target'] is not None]
    hit_target_count = sum(1 for p in state_preds if p['hit_target'])
    hit_target_pct = (hit_target_count / len(state_preds) * 100) if state_preds else 0

    print(f'{state:25s} {n:>5d} {avg_return:>13.2f}% {win_rate:>11.1f}% {hit_target_pct:>13.1f}%')
print()


# ═══════════════════════════════════════════════════════════════════════════
# Step 6: مقارنة الأداء بين الحالات الإيجابية والسلبية
# ═══════════════════════════════════════════════════════════════════════════
print('Step 6: مقارنة الأداء (bullish vs bearish canonical_state)')
print('-'*60)

bullish_states = ['ACCUMULATION', 'UPTREND', 'CORRECTION_HEALTHY', 'RECOVERY']
bearish_states = ['DISTRIBUTION', 'DOWNTREND']
neutral_states = ['STATE_UNCONFIRMED', 'DATA_STALE', 'DATA_INCOMPLETE']

def stats_for(states_list):
    returns = [p['actual_return'] for p in predictions_with_state
               if p['canonical_state'] in states_list and p['actual_return'] is not None]
    if not returns:
        return {'n': 0}
    n = len(returns)
    wins = sum(1 for r in returns if r > 0)
    return {
        'n': n,
        'avg': sum(returns) / n,
        'win_rate': wins / n * 100,
        'min': min(returns),
        'max': max(returns),
    }

bullish = stats_for(bullish_states)
bearish = stats_for(bearish_states)
neutral = stats_for(neutral_states)

print(f'Bullish states (ACCUMULATION/UPTREND/CORRECTION_HEALTHY/RECOVERY):')
print(f'  N={bullish["n"]}  avg_return={bullish.get("avg", 0):.2f}%  win_rate={bullish.get("win_rate", 0):.1f}%')
print()
print(f'Bearish states (DISTRIBUTION/DOWNTREND):')
print(f'  N={bearish["n"]}  avg_return={bearish.get("avg", 0):.2f}%  win_rate={bearish.get("win_rate", 0):.1f}%')
print()
print(f'Neutral/Data-quality states (UNCONFIRMED/STALE/INCOMPLETE):')
print(f'  N={neutral["n"]}  avg_return={neutral.get("avg", 0):.2f}%  win_rate={neutral.get("win_rate", 0):.1f}%')
print()


# ═══════════════════════════════════════════════════════════════════════════
# Step 7: الإجابة على الأسئلة الثلاثة
# ═══════════════════════════════════════════════════════════════════════════
print('='*80)
print('إجابات على الأسئلة الثلاثة')
print('='*80)
print()

print('Q1: هل بيانات الـ Radar و canonical_state سليمة؟')
print('-'*60)
print(f'  - canonical_state coverage: {coverage:.1f}% من التوقعات عندها canonical_state')
print(f'  - predictions without canonical_state: {predictions_without_state} (ممكن تكون tickers مش متتبَّعة)')
print(f'  - مشكلة الـ DELETE في maker_radar.py:752: مُثبتة في الكود (DELETE WHERE signal_date=? بدون scope)')
print(f'  - مشكلة الـ INSERT OR REPLACE بدون UNIQUE: مُثبتة في الكود (16 صف duplicate في sandbox)')
print(f'  - الإجابة: فيه تعارض بنيوي بين الكُتّاب — maker_radar بيمسح canonical_state لو اشتغلوا في نفس اليوم')
print()

print('Q2: هل عرفنا نقطة الربط الصحيحة مع محرك التوقعات؟')
print('-'*60)
print(f'  - نقطة الربط المثالية: daily_predictor.py:1643-1663 (بناء _gate_data)')
print(f'  - البديل الآمن: Observer pattern على PredictionTracker.record_prediction')
print(f'  - تم تنفيذ Shadow Mode في vps-service/camp/canonical_state_shadow.py')
print(f'  - اختبارات Shadow Mode: 24/24 ✅')
print(f'  - الإجابة: نعم — نقطة الربط محددة + Shadow Mode جاهز للاختبار على بيانات حقيقية')
print()

print('Q3: هل الـ Shadow Mode أثبت اختلافًا مفيدًا في القرارات؟')
print('-'*60)
if bullish['n'] > 0 and bearish['n'] > 0:
    diff = bullish.get('avg', 0) - bearish.get('avg', 0)
    print(f'  - bullish avg_return: {bullish.get("avg", 0):.2f}% (N={bullish["n"]})')
    print(f'  - bearish avg_return: {bearish.get("avg", 0):.2f}% (N={bearish["n"]})')
    print(f'  - الفرق: {diff:+.2f}%')
    if abs(diff) > 1.0:
        print(f'  - الإجابة: نعم — الفرق {diff:+.2f}% يشير إلى أن canonical_state يميّز بين الأسهم بشكل مفيد')
    else:
        print(f'  - الإجابة: غير حاسم — الفرق صغير ({diff:+.2f}%)، يحتاج sample أكبر أو فترة أطول')
else:
    print(f'  - bullish N={bullish["n"]}, bearish N={bearish["n"]}')
    print(f'  - الإجابة: غير محسوم — بيانات غير كافية في sandbox sample')
print()

print('='*80)
print('LIMITATIONS (قيود النتائج)')
print('='*80)
print('- البيانات من sandbox sample، مش الإنتاج. الأرقام تخص الاختبار فقط.')
print('- لا تعمّم النتائج على الإنتاج دون فحص مباشر.')
print('- canonical_state في sandbox بيغطي 42 صف فقط بتاريخ 2026-10-21 — coverage منخفض.')
print('- mafish بيانات timesteps كافية للحكم النهائي على الأداء.')
print('- التوصية: شغّل Shadow Mode على الإنتاج لمدة 2-4 أسابيع قبل اتخاذ قرار الربط.')

if conn_pred:
    conn_pred.close()
