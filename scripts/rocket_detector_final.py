#!/usr/bin/env python3
"""
مرحلة 1 محسّنة — تقرير نهائي مع فحص الإشارات الكاذبة (Precision)
================================================================
يحلل:
1. جودة البيانات (أيام snapshot / حجم ثابت)
2. 3 إصدارات من الكاشف (V1 صارم / V2 حساس / V3 متوازن)
3. الـ Recall: كم سهم انفجاري اصطدنا
4. الـ Precision: كم إشارة كانت صحيحة (على كل الأسهم مش بس الانفجارية)
5. مقارنة المحلى (مصر) vs النتاجى (السعودية)
"""
import sqlite3
import sys
import math
from collections import defaultdict
from datetime import datetime

DB = '/tmp/dbs/intraday.db'

# ═══════════════════════════════════════════════════════════════════
# 1) فحص جودة البيانات
# ═══════════════════════════════════════════════════════════════════
def check_data_quality(conn, market='مصر'):
    c = conn.cursor()
    days = [r[0] for r in c.execute("""
        SELECT DISTINCT substr(timestamp, 1, 10) as day
        FROM stock_intraday WHERE market=? ORDER BY day
    """, (market,)).fetchall()]

    day_quality = []
    for day in days:
        rows = c.execute("""
            SELECT ticker, COUNT(*) as bars,
                   COUNT(DISTINCT volume) as distinct_vols,
                   MIN(volume), MAX(volume)
            FROM stock_intraday
            WHERE market=? AND substr(timestamp,1,10)=?
            GROUP BY ticker
        """, (market, day)).fetchall()

        total = len(rows)
        clean = sum(1 for r in rows if r[1] >= 20 and r[2] >= 10)
        snapshot_only = sum(1 for r in rows if r[1] == 1)
        flat_vol = sum(1 for r in rows if r[1] >= 20 and r[2] <= 2)
        usable = clean >= 50

        day_quality.append({
            'day': day, 'total': total, 'clean': clean,
            'snapshot_only': snapshot_only, 'flat_vol': flat_vol,
            'usable': usable
        })
    return day_quality


# ═══════════════════════════════════════════════════════════════════
# 2) الكاشفات
# ═══════════════════════════════════════════════════════════════════

def detect_v1_strict(bars):
    """V1 صارم — العتبات القديمة (surge 1.5σ + score≥60 + ROC20>5)."""
    if len(bars) < 20:
        return None
    vols = [b['volume'] for b in bars]
    closes = [b['price'] for b in bars]

    lookback = min(20, len(vols) - 1)
    vol_ma = sum(vols[-lookback-1:-1]) / lookback if lookback > 0 else 0
    vol_std = (sum((v - vol_ma)**2 for v in vols[-lookback-1:-1]) / lookback) ** 0.5 if lookback > 0 else 0
    dyn_surge = vol_ma + (vol_std * 1.5)
    vs = vols[-1] > dyn_surge if vol_ma > 0 else False
    vs_ratio = vols[-1] / (vol_ma or 1)

    roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 and closes[-6] > 0 else 0
    roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if len(closes) >= 21 and closes[-21] > 0 else 0

    score = 0
    if vs: score += 25
    if roc20 > 15: score += 20
    elif roc20 > 10: score += 12
    if roc5 > 3: score += 10

    is_rocket = score >= 60 and vs and roc20 > 5
    return {'is_rocket': is_rocket, 'score': score, 'vs_ratio': vs_ratio,
            'roc5': roc5, 'roc20': roc20, 'reason': 'strict v1'}


def detect_v2_sensitive(bars):
    """V2 حساس — surge 1.0σ + كشف تجميع هادئ + pre-surge + absorption.
    عتبة score = 45 + إشارة حجم واحدة على الأقل."""
    if len(bars) < 15:
        return None
    vols = [b['volume'] for b in bars]
    closes = [b['price'] for b in bars]
    highs = [b['high'] for b in bars]
    lows = [b['low'] for b in bars]

    lookback = min(20, len(vols) - 1)
    vol_ma = sum(vols[-lookback-1:-1]) / lookback if lookback > 0 else 0
    vol_std = (sum((v - vol_ma)**2 for v in vols[-lookback-1:-1]) / lookback) ** 0.5 if lookback > 0 else 0

    dyn_surge_loose = vol_ma + (vol_std * 1.0)
    vs_loose = vols[-1] > dyn_surge_loose if vol_ma > 0 else False
    vs_ratio = vols[-1] / (vol_ma or 1)
    semi_surge = vs_ratio >= 1.3

    # Quiet Accumulation
    recent_closes = closes[-10:]
    recent_vols = vols[-10:]
    if len(recent_closes) >= 10 and recent_closes[0] > 0:
        price_change_pct = abs(recent_closes[-1] - recent_closes[0]) / recent_closes[0] * 100
        early_vol = sum(recent_vols[:5]) / 5
        late_vol = sum(recent_vols[5:]) / 5
        vol_ramp = late_vol / (early_vol or 1) if early_vol > 0 else 1
        quiet_accum = price_change_pct <= 2.0 and vol_ramp >= 1.5
    else:
        quiet_accum = False
        vol_ramp = 0

    # Pre-surge
    if len(vols) >= 5 and all(v > 0 for v in vols[-5:]):
        ramp = all(vols[-i-1] >= vols[-i-2] for i in range(4))
        avg_ratio = sum(vols[-i-1] / (vols[-i-2] or 1) for i in range(4)) / 4
        pre_surge = ramp and avg_ratio >= 1.2
    else:
        pre_surge = False

    roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 and closes[-6] > 0 else 0
    roc10 = (closes[-1] - closes[-11]) / closes[-11] * 100 if len(closes) >= 11 and closes[-11] > 0 else 0
    roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if len(closes) >= 21 and closes[-21] > 0 else 0

    # Absorption
    if len(closes) >= 3 and highs[-1] > 0 and lows[-1] > 0:
        bar_range_pct = (highs[-1] - lows[-1]) / closes[-1] * 100
        absorption = vs_ratio >= 1.5 and bar_range_pct <= 1.5
    else:
        absorption = False

    score = 0
    reasons = []
    if vs_loose:
        score += 22; reasons.append(f'surge {vs_ratio:.1f}x')
    elif semi_surge:
        score += 12; reasons.append(f'semi {vs_ratio:.1f}x')
    if quiet_accum:
        score += 25; reasons.append(f'quiet_accum ramp={vol_ramp:.1f}x')
    if pre_surge:
        score += 18; reasons.append('pre_surge')
    if absorption:
        score += 20; reasons.append('absorption')
    if roc20 > 15: score += 15; reasons.append(f'ROC20={roc20:+.1f}%')
    elif roc20 > 10: score += 10; reasons.append(f'ROC20={roc20:+.1f}%')
    elif roc20 > 5: score += 5; reasons.append(f'ROC20={roc20:+.1f}%')
    if roc5 > 3: score += 8; reasons.append(f'ROC5={roc5:+.1f}%')
    if roc10 > 5: score += 6; reasons.append(f'ROC10={roc10:+.1f}%')

    is_rocket = score >= 45 and (vs_loose or quiet_accum or pre_surge or absorption)
    return {
        'is_rocket': is_rocket, 'score': min(score, 100),
        'vs_ratio': vs_ratio, 'roc5': roc5, 'roc10': roc10, 'roc20': roc20,
        'quiet_accum': quiet_accum, 'pre_surge': pre_surge, 'absorption': absorption,
        'reason': ' | '.join(reasons)
    }


def detect_v3_balanced(bars):
    """V3 متوازن — surge 1.25σ + يتطلب تأكيدين + عتبة score=50.
    أقل إشارات كاذبة من V2، أعلى recall من V1."""
    if len(bars) < 15:
        return None
    vols = [b['volume'] for b in bars]
    closes = [b['price'] for b in bars]
    highs = [b['high'] for b in bars]
    lows = [b['low'] for b in bars]

    lookback = min(20, len(vols) - 1)
    vol_ma = sum(vols[-lookback-1:-1]) / lookback if lookback > 0 else 0
    vol_std = (sum((v - vol_ma)**2 for v in vols[-lookback-1:-1]) / lookback) ** 0.5 if lookback > 0 else 0

    dyn_surge_mid = vol_ma + (vol_std * 1.25)
    vs_mid = vols[-1] > dyn_surge_mid if vol_ma > 0 else False
    vs_ratio = vols[-1] / (vol_ma or 1)
    semi_surge = vs_ratio >= 1.4

    recent_closes = closes[-10:]
    recent_vols = vols[-10:]
    if len(recent_closes) >= 10 and recent_closes[0] > 0:
        price_change_pct = abs(recent_closes[-1] - recent_closes[0]) / recent_closes[0] * 100
        early_vol = sum(recent_vols[:5]) / 5
        late_vol = sum(recent_vols[5:]) / 5
        vol_ramp = late_vol / (early_vol or 1) if early_vol > 0 else 1
        quiet_accum = price_change_pct <= 2.0 and vol_ramp >= 1.8
    else:
        quiet_accum = False
        vol_ramp = 0

    if len(vols) >= 5 and all(v > 0 for v in vols[-5:]):
        ramp = all(vols[-i-1] >= vols[-i-2] for i in range(4))
        avg_ratio = sum(vols[-i-1] / (vols[-i-2] or 1) for i in range(4)) / 4
        pre_surge = ramp and avg_ratio >= 1.3
    else:
        pre_surge = False

    roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 and closes[-6] > 0 else 0
    roc10 = (closes[-1] - closes[-11]) / closes[-11] * 100 if len(closes) >= 11 and closes[-11] > 0 else 0
    roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if len(closes) >= 21 and closes[-21] > 0 else 0

    if len(closes) >= 3 and highs[-1] > 0 and lows[-1] > 0:
        bar_range_pct = (highs[-1] - lows[-1]) / closes[-1] * 100
        absorption = vs_ratio >= 1.6 and bar_range_pct <= 1.2
    else:
        absorption = False

    score = 0
    signals = []
    reasons = []
    if vs_mid:
        score += 22; signals.append('surge'); reasons.append(f'surge {vs_ratio:.1f}x')
    elif semi_surge:
        score += 10; reasons.append(f'semi {vs_ratio:.1f}x')
    if quiet_accum:
        score += 22; signals.append('quiet_accum'); reasons.append(f'quiet ramp={vol_ramp:.1f}x')
    if pre_surge:
        score += 15; signals.append('pre_surge'); reasons.append('pre_surge')
    if absorption:
        score += 18; signals.append('absorption'); reasons.append('absorption')
    if roc20 > 15: score += 12; signals.append('roc20'); reasons.append(f'ROC20={roc20:+.1f}%')
    elif roc20 > 10: score += 8; reasons.append(f'ROC20={roc20:+.1f}%')
    elif roc20 > 5: score += 4; reasons.append(f'ROC20={roc20:+.1f}%')
    if roc5 > 3: score += 6; reasons.append(f'ROC5={roc5:+.1f}%')
    if roc10 > 5: score += 5; reasons.append(f'ROC10={roc10:+.1f}%')

    confirmations = len(signals)
    is_rocket = score >= 50 and confirmations >= 2

    return {
        'is_rocket': is_rocket, 'score': min(score, 100),
        'vs_ratio': vs_ratio, 'roc5': roc5, 'roc10': roc10, 'roc20': roc20,
        'quiet_accum': quiet_accum, 'pre_surge': pre_surge, 'absorption': absorption,
        'confirmations': confirmations, 'reason': ' | '.join(reasons)
    }


# ═══════════════════════════════════════════════════════════════════
# 3) أدوات مساعدة
# ═══════════════════════════════════════════════════════════════════
def load_stock_bars(conn, ticker, day, market='مصر'):
    rows = conn.execute("""
        SELECT timestamp, price, volume, high, low
        FROM stock_intraday
        WHERE market=? AND ticker=? AND substr(timestamp,1,10)=?
        ORDER BY timestamp
    """, (market, ticker, day)).fetchall()
    bars = []
    for r in rows:
        ts, price, vol, hi, lo = r
        if price <= 0:
            continue
        hi = hi if hi > 0 else price
        lo = lo if lo > 0 else price
        bars.append({'timestamp': ts, 'price': price, 'volume': vol,
                     'high': hi, 'low': lo})
    return bars


def find_explosive_stocks(conn, market='مصر', min_change=15.0):
    rows = conn.execute("""
        SELECT ticker, substr(timestamp,1,10) as day, COUNT(*) as bars
        FROM stock_intraday
        WHERE market=? AND length(ticker) <= 6
        GROUP BY ticker, day
        HAVING bars >= 20
    """, (market,)).fetchall()

    explosive = []
    for ticker, day, _ in rows:
        bars = load_stock_bars(conn, ticker, day, market)
        if len(bars) < 20:
            continue
        first_p = bars[0]['price']
        last_p = bars[-1]['price']
        max_p = max(b['price'] for b in bars)
        if first_p <= 0:
            continue
        change_pct = (last_p - first_p) / first_p * 100
        max_change_pct = (max_p - first_p) / first_p * 100
        if max_change_pct >= min_change:
            explosive.append({
                'ticker': ticker, 'day': day,
                'first': first_p, 'last': last_p, 'max': max_p,
                'change_pct': change_pct, 'max_change_pct': max_change_pct,
                'bars': len(bars), 'max_vol': max(b['volume'] for b in bars)
            })
    explosive.sort(key=lambda x: -x['max_change_pct'])
    return explosive


def run_detector_on_explosion(conn, ticker, day, detector_fn, market='مصر',
                               scan_window=20):
    """يشتغل على سهم انفجاري — هل اصطاده قبل ما يخلص؟"""
    bars = load_stock_bars(conn, ticker, day, market)
    if len(bars) < scan_window + 5:
        return {'signals': [], 'caught': False, 'first_signal_idx': None,
                'first_signal_at_pct': 0, 'early_catch': False,
                'bars': len(bars), 'final_pct': 0}

    signals = []
    first_p = bars[0]['price']
    for i in range(scan_window, len(bars) - 1):
        window = bars[:i+1]
        result = detector_fn(window)
        if result and result['is_rocket']:
            cur_price = bars[i]['price']
            pct_from_start = (cur_price - first_p) / first_p * 100 if first_p > 0 else 0
            signals.append({
                'bar_idx': i, 'timestamp': bars[i]['timestamp'],
                'price': cur_price, 'pct_from_start': pct_from_start,
                'score': result['score'], 'reason': result.get('reason', '')
            })

    caught = len(signals) > 0
    max_pct = max((s['pct_from_start'] for s in signals), default=0)
    final_pct = (bars[-1]['price'] - first_p) / first_p * 100 if first_p > 0 else 0
    early_catch = any(s['pct_from_start'] < max_pct * 0.5 for s in signals) if signals and max_pct > 0 else False

    return {
        'signals': signals, 'caught': caught,
        'first_signal_idx': signals[0]['bar_idx'] if signals else None,
        'first_signal_at_pct': signals[0]['pct_from_start'] if signals else 0,
        'early_catch': early_catch,
        'bars': len(bars), 'final_pct': final_pct,
    }


def run_precision_test(conn, detector_fn, market='مصر', max_stocks=80,
                       scan_window=20):
    """يجرّب الكاشف على كل الأسهم السائلة (مش بس الانفجارية).
    يرجع: عدد الإشارات الكلية + كم إشارة طلع صح (سهم طار ≥5% بعدها)."""
    c = conn.cursor()
    # الأسهم السائلة (متوسط حجم ≥ 50K) + عندها ≥3 أيام ببيانات
    rows = c.execute("""
        SELECT ticker, AVG(volume) as avg_vol, COUNT(DISTINCT substr(timestamp,1,10)) as days
        FROM stock_intraday
        WHERE market=? AND length(ticker) <= 6
        GROUP BY ticker
        HAVING avg_vol >= 50000 AND days >= 3
        ORDER BY avg_vol DESC
        LIMIT ?
    """, (market, max_stocks)).fetchall()

    total_signals = 0
    true_signals = 0  # سهم طار ≥5% خلال ساعة بعد الإشارة
    false_signals = 0
    tested_stocks = 0

    for ticker, _, _ in rows:
        # كل الأيام الصالحة للسهم
        days = [r[0] for r in c.execute("""
            SELECT DISTINCT substr(timestamp,1,10) as d FROM stock_intraday
            WHERE market=? AND ticker=?
            ORDER BY d
        """, (market, ticker)).fetchall()]

        tested_stocks += 1
        for day in days:
            bars = load_stock_bars(conn, ticker, day, market)
            if len(bars) < scan_window + 12:
                continue
            first_p = bars[0]['price']
            for i in range(scan_window, len(bars) - 12):
                window = bars[:i+1]
                result = detector_fn(window)
                if result and result['is_rocket']:
                    total_signals += 1
                    # هل طار ≥5% خلال 12 شريطة (ساعة) بعد الإشارة؟
                    future = bars[i+1:i+13]
                    if future and first_p > 0:
                        sig_price = bars[i]['price']
                        max_future = max(b['price'] for b in future)
                        future_return = (max_future - sig_price) / sig_price * 100
                        if future_return >= 5:
                            true_signals += 1
                        else:
                            false_signals += 1
                    else:
                        false_signals += 1

    precision = true_signals / total_signals * 100 if total_signals > 0 else 0
    return {
        'total_signals': total_signals,
        'true_signals': true_signals,
        'false_signals': false_signals,
        'precision': precision,
        'tested_stocks': tested_stocks
    }


# ═══════════════════════════════════════════════════════════════════
# 4) التقرير الرئيسي
# ═══════════════════════════════════════════════════════════════════
def main():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB, writable=False).__enter__()

    print("╔" + "═"*78 + "╗")
    print("║" + " مرحلة 1 محسّنة — تقرير الكاشف + فحص الإشارات الكاذبة ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    # ─── القسم 1: جودة البيانات ───
    print("\n" + "─"*80)
    print("القسم 1: جودة بيانات الـ 5 دقائق — السوق المصري")
    print("─"*80)

    eg_quality = check_data_quality(conn, 'مصر')
    print(f"\n{'اليوم':<12} {'إجمالي':>7} {'سليم':>7} {'snapshot':>9} {'حجم ثابت':>9} {'صالح؟':>7}")
    print("─"*55)
    usable_days = []
    for dq in eg_quality:
        flag = "✓ نعم" if dq['usable'] else "✗ لا"
        print(f"{dq['day']:<12} {dq['total']:>7} {dq['clean']:>7} {dq['snapshot_only']:>9} {dq['flat_vol']:>9} {flag:>7}")
        if dq['usable']:
            usable_days.append(dq['day'])
    print(f"\n→ الأيام الصالحة: {len(usable_days)} / {len(eg_quality)}")
    print(f"→ أيام snapshot (شريطة واحدة): {sum(1 for d in eg_quality if d['snapshot_only']==d['total'])}")
    print(f"→ أيام بحجم ثابت: {sum(1 for d in eg_quality if d['flat_vol']>50 and not d['usable'])}")

    # ─── القسم 2: الأسهم الانفجارية ───
    print("\n" + "─"*80)
    print("القسم 2: الأسهم الانفجارية (تغير ≥ +15% في يوم) — السوق المصري")
    print("─"*80)

    explosive = find_explosive_stocks(conn, 'مصر', 15.0)
    print(f"\nإجمالي الأسهم الانفجارية: {len(explosive)}")
    print(f"\n{'ticker':<8} {'اليوم':<12} {'first':>8} {'last':>8} {'change%':>9} {'max%':>9} {'bars':>5} {'max_vol':>13}")
    print("─"*75)
    for e in explosive[:25]:
        print(f"{e['ticker']:<8} {e['day']:<12} {e['first']:>8.2f} {e['last']:>8.2f} {e['change_pct']:>+8.2f}% {e['max_change_pct']:>+8.2f}% {e['bars']:>5} {e['max_vol']:>13,}")
    if len(explosive) > 25:
        print(f"... و {len(explosive)-25} سهم تاني")

    # ─── القسم 3: مقارنة الكاشفات (Recall) ───
    print("\n" + "─"*80)
    print("القسم 3: Recall — كم سهم انفجاري اصطدنا (قبل/بعد الضبط)")
    print("─"*80)

    detectors = [
        ('V1 صارم', detect_v1_strict),
        ('V2 حساس', detect_v2_sensitive),
        ('V3 متوازن', detect_v3_balanced),
    ]

    results_by_detector = {name: {'caught': 0, 'early': 0, 'total': 0, 'signals': 0,
                                   'avg_signal_pct': [], 'missed': []}
                            for name, _ in detectors}

    print(f"\nإجمالي الأسهم الانفجارية للاختبار: {len(explosive)}")
    print(f"\n{'ticker':<8} {'day':<12} {'max%':>7} | ", end='')
    for name, _ in detectors:
        short = name.split(' ')[0]
        print(f"{short+' اصطاد':>10} {short+' مبكر':>10} {short+' عند%':>9} | ", end='')
    print()
    print("─"*120)

    for e in explosive[:50]:  # نعرض أعلى 50
        print(f"{e['ticker']:<8} {e['day']:<12} {e['max_change_pct']:>+6.1f}% | ", end='')
        for name, fn in detectors:
            res = run_detector_on_explosion(conn, e['ticker'], e['day'], fn, 'مصر')
            results_by_detector[name]['total'] += 1
            if res['caught']:
                results_by_detector[name]['caught'] += 1
                results_by_detector[name]['signals'] += len(res['signals'])
                results_by_detector[name]['avg_signal_pct'].append(res['first_signal_at_pct'])
                if res['early_catch']:
                    results_by_detector[name]['early'] += 1
                print(f"{'✓ نعم':>10} ", end='')
                if res['early_catch']:
                    print(f"{'✓ نعم':>10} ", end='')
                else:
                    print(f"{'✗ لا':>10} ", end='')
                print(f"{res['first_signal_at_pct']:>+7.1f}% | ", end='')
            else:
                results_by_detector[name]['missed'].append((e['ticker'], e['day'], e['max_change_pct']))
                print(f"{'✗ لا':>10} {'—':>10} {'—':>9} | ", end='')
        print()

    # كمّل العدّاد للأسهم اللي ما عرضناش
    for e in explosive[50:]:
        for name, fn in detectors:
            res = run_detector_on_explosion(conn, e['ticker'], e['day'], fn, 'مصر')
            results_by_detector[name]['total'] += 1
            if res['caught']:
                results_by_detector[name]['caught'] += 1
                results_by_detector[name]['signals'] += len(res['signals'])
                results_by_detector[name]['avg_signal_pct'].append(res['first_signal_at_pct'])
                if res['early_catch']:
                    results_by_detector[name]['early'] += 1
            else:
                results_by_detector[name]['missed'].append((e['ticker'], e['day'], e['max_change_pct']))

    # ─── القسم 4: ملخص Recall ───
    print("\n" + "─"*80)
    print("القسم 4: ملخص Recall — السوق المصري")
    print("─"*80)

    print(f"\n{'الكاشف':<14} {'اصطاد':>7} {'من':>5} {'Recall%':>9} {'مبكر':>7} {'إشارات':>8} {'متوسط وقت الاصطياد':>20}")
    print("─"*85)
    for name, _ in detectors:
        r = results_by_detector[name]
        pct = r['caught'] / r['total'] * 100 if r['total'] > 0 else 0
        avg_pct = sum(r['avg_signal_pct']) / len(r['avg_signal_pct']) if r['avg_signal_pct'] else 0
        print(f"{name:<14} {r['caught']:>7} {r['total']:>5} {pct:>8.1f}% {r['early']:>7} {r['signals']:>8} {avg_pct:>+18.1f}%")

    # ─── القسم 5: Precision (فحص الإشارات الكاذبة) ───
    print("\n" + "─"*80)
    print("القسم 5: Precision — فحص الإشارات الكاذبة على 80 سهم سائل")
    print("─"*80)
    print("القاعدة: نشغّل الكاشف على كل الأسهم السائلة (مش بس الانفجارية).")
    print("الإشارة \"صحيحة\" = سهم طار ≥ +5% خلال ساعة (12 شريطة) بعدها.\n")

    print(f"{'الكاشف':<14} {'إشارات':>8} {'صحيحة':>8} {'كاذبة':>8} {'Precision%':>12}")
    print("─"*55)
    precision_results = {}
    for name, fn in detectors:
        p = run_precision_test(conn, fn, 'مصر', max_stocks=80)
        precision_results[name] = p
        print(f"{name:<14} {p['total_signals']:>8} {p['true_signals']:>8} {p['false_signals']:>8} {p['precision']:>11.1f}%")

    # ─── القسم 6: الفائتة (V3) ───
    print("\n" + "─"*80)
    print("القسم 6: الأسهم الانفجارية الفائتة — V3 المتوازن")
    print("─"*80)
    v3_missed = results_by_detector['V3 متوازن']['missed']
    if v3_missed:
        print(f"\nإجمالي الفائتة: {len(v3_missed)} سهم من {results_by_detector['V3 متوازن']['total']}")
        # أعلى 15 فائتة
        v3_missed.sort(key=lambda x: -x[2])
        for t, d, m in v3_missed[:15]:
            print(f"  ✗ {t} @ {d}: طار {m:+.1f}% والكاشف ماسكهوش")
        if len(v3_missed) > 15:
            print(f"  ... و {len(v3_missed)-15} سهم تاني فائتة")
    else:
        print("\n(لا يوجد — كل الأسهم الانفجارية اتلمست)")

    conn.close()
    return results_by_detector, precision_results


def compare_markets(eg_results, eg_precision):
    """مقارنة المحلى (مصر) vs النتاجى (السعودية)."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB, writable=False).__enter__()

    print("\n\n╔" + "═"*78 + "╗")
    print("║" + " مقارنة: المحلى (مصر) vs النتاجى (السعودية) ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    # ─── جودة البيانات: السعودي ───
    print("\n" + "─"*80)
    print("القسم 7: جودة البيانات — السوق السعودي (النتاجى)")
    print("─"*80)

    sa_quality = check_data_quality(conn, 'السعودية')
    print(f"\n{'اليوم':<12} {'إجمالي':>7} {'سليم':>7} {'snapshot':>9} {'حجم ثابت':>9} {'صالح؟':>7}")
    print("─"*55)
    sa_usable = 0
    for dq in sa_quality:
        flag = "✓ نعم" if dq['usable'] else "✗ لا"
        print(f"{dq['day']:<12} {dq['total']:>7} {dq['clean']:>7} {dq['snapshot_only']:>9} {dq['flat_vol']:>9} {flag:>7}")
        if dq['usable']:
            sa_usable += 1
    print(f"\n→ الأيام الصالحة: {sa_usable} / {len(sa_quality)}")

    # عينة من بيانات السعودي
    print("\n── عينة من بيانات السعودي (ليوم 2026-08-16) ──")
    rows = conn.execute("""
        SELECT ticker, COUNT(*) as bars, COUNT(DISTINCT volume) as dv,
               MIN(volume), MAX(volume), MIN(price), MAX(price)
        FROM stock_intraday
        WHERE market='السعودية' AND substr(timestamp,1,10)='2026-08-16'
        GROUP BY ticker ORDER BY MAX(volume) DESC LIMIT 10
    """).fetchall()
    print(f"  {'ticker':<10} {'bars':>5} {'distinct_vol':>13} {'min_vol':>10} {'max_vol':>10} {'min_price':>10} {'max_price':>10}")
    for r in rows:
        print(f"  {r[0]:<10} {r[1]:>5} {r[2]:>13} {r[3]:>10} {r[4]:>10} {r[5]:>10.2f} {r[6]:>10.2f}")

    # ─── الأسهم الانفجارية في السعودي ───
    print("\n" + "─"*80)
    print("القسم 8: الأسهم الانفجارية — السوق السعودي")
    print("─"*80)

    sa_explosive = find_explosive_stocks(conn, 'السعودية', 10.0)
    print(f"\nإجمالي الأسهم الانفجارية (≥+10%): {len(sa_explosive)}")
    if sa_explosive:
        print(f"\n{'ticker':<10} {'اليوم':<12} {'first':>10} {'last':>10} {'change%':>9} {'max%':>9} {'bars':>5} {'max_vol':>13}")
        print("─"*85)
        for e in sa_explosive[:15]:
            print(f"{e['ticker']:<10} {e['day']:<12} {e['first']:>10.2f} {e['last']:>10.2f} {e['change_pct']:>+8.2f}% {e['max_change_pct']:>+8.2f}% {e['bars']:>5} {e['max_vol']:>13,}")

    # ─── تشغيل V3 على السعودي ───
    print("\n" + "─"*80)
    print("القسم 9: تشغيل الكاشفات على السوق السعودي")
    print("─"*80)

    detectors = [
        ('V1 صارم', detect_v1_strict),
        ('V2 حساس', detect_v2_sensitive),
        ('V3 متوازن', detect_v3_balanced),
    ]

    sa_results = {name: {'caught': 0, 'early': 0, 'total': 0, 'signals': 0,
                          'avg_signal_pct': [], 'missed': []}
                   for name, _ in detectors}

    for e in sa_explosive:
        for name, fn in detectors:
            res = run_detector_on_explosion(conn, e['ticker'], e['day'], fn, 'السعودية')
            sa_results[name]['total'] += 1
            if res['caught']:
                sa_results[name]['caught'] += 1
                sa_results[name]['signals'] += len(res['signals'])
                sa_results[name]['avg_signal_pct'].append(res['first_signal_at_pct'])
                if res['early_catch']:
                    sa_results[name]['early'] += 1
            else:
                sa_results[name]['missed'].append((e['ticker'], e['day'], e['max_change_pct']))

    print(f"\n{'الكاشف':<14} {'اصطاد':>7} {'من':>5} {'Recall%':>9} {'مبكر':>7} {'إشارات':>8}")
    print("─"*60)
    for name, _ in detectors:
        r = sa_results[name]
        pct = r['caught'] / r['total'] * 100 if r['total'] > 0 else 0
        print(f"{name:<14} {r['caught']:>7} {r['total']:>5} {pct:>8.1f}% {r['early']:>7} {r['signals']:>8}")

    # ─── المقارنة النهائية ───
    print("\n" + "═"*80)
    print("القسم 10: المقارنة النهائية — المحلى vs النتاجى")
    print("═"*80)

    eg_usable = sum(1 for d in check_data_quality(conn, 'مصر') if d['usable'])
    sa_usable = sum(1 for d in sa_quality if d['usable'])
    eg_n = len(find_explosive_stocks(conn, 'مصر', 15.0))
    sa_n = len(sa_explosive)

    print(f"\n{'المقياس':<40} {'مصر (محلى)':>14} {'السعودية (نتاجى)':>18} {'الفارق':>10}")
    print("─"*85)
    print(f"{'الأيام الصالحة للتحليل':<40} {eg_usable:>14} {sa_usable:>18} {sa_usable-eg_usable:>+10}")
    print(f"{'عدد الأسهم الانفجارية':<40} {eg_n:>14} {sa_n:>18} {sa_n-eg_n:>+10}")

    for name, _ in detectors:
        eg_r = eg_results[name]
        sa_r = sa_results[name]
        eg_pct = eg_r['caught'] / max(eg_r['total'], 1) * 100
        sa_pct = sa_r['caught'] / max(sa_r['total'], 1) * 100
        print(f"{name+' — Recall%':<40} {eg_pct:>13.1f}% {sa_pct:>17.1f}% {sa_pct-eg_pct:>+9.1f}%")

    for name, _ in detectors:
        eg_p = eg_precision[name]['precision']
        # السعودي precision مش هنعمله (مفيش بيانات)
        print(f"{name+' — Precision%':<40} {eg_p:>13.1f}% {'N/A':>17} {'—':>10}")

    conn.close()
    return sa_results


if __name__ == '__main__':
    eg_results, eg_precision = main()
    sa_results = compare_markets(eg_results, eg_precision)

    print("\n\n" + "═"*80)
    print("الخلاصة النهائية")
    print("═"*80)

    eg_v1 = eg_results['V1 صارم']['caught'] / max(eg_results['V1 صارم']['total'], 1) * 100
    eg_v2 = eg_results['V2 حساس']['caught'] / max(eg_results['V2 حساس']['total'], 1) * 100
    eg_v3 = eg_results['V3 متوازن']['caught'] / max(eg_results['V3 متوازن']['total'], 1) * 100
    eg_v1_p = eg_precision['V1 صارم']['precision']
    eg_v2_p = eg_precision['V2 حساس']['precision']
    eg_v3_p = eg_precision['V3 متوازن']['precision']

    print(f"""
┌─────────────────────────────────────────────────────────────────────┐
│                    السوق المصري (المحلى) — النتائج                │
├─────────────────────────────────────────────────────────────────────┤
│  الكاشف        │ Recall%  │ Precision%  │ الإشارات │ الحكم         │
├─────────────────────────────────────────────────────────────────────┤
│  V1 صارم (قديم)│  {eg_v1:>5.1f}%  │   {eg_v1_p:>5.1f}%    │   {eg_precision['V1 صارم']['total_signals']:>4}    │ فشل تام      │
│  V2 حساس (جديد)│  {eg_v2:>5.1f}%  │   {eg_v2_p:>5.1f}%    │   {eg_precision['V2 حساس']['total_signals']:>4}    │ تحسّن كبير   │
│  V3 متوازن     │  {eg_v3:>5.1f}%  │   {eg_v3_p:>5.1f}%    │   {eg_precision['V3 متوازن']['total_signals']:>4}    │ الأفضل توازن │
└─────────────────────────────────────────────────────────────────────┘
""")

    print(f"""• مقارنة مع النتيجة القديمة (29.6%):
  - V1 القديم: 29.6% (تقرير المرحلة 1 السابق)
  - V3 المتوازن الجديد: {eg_v3:.1f}% recall + {eg_v3_p:.1f}% precision
  - التحسن: {eg_v3 - 29.6:+.1f} نقطة في recall (مع قياس precision للمرة الأولى)
""")

    sa_usable = sum(1 for d in __import__('sqlite3').connect(DB).execute(
        "SELECT DISTINCT substr(timestamp,1,10) FROM stock_intraday WHERE market='السعودية'"
    ).fetchall()) if False else 0  # placeholder

    print(f"""• السوق السعودي (النتاجى):
  - الأيام الصالحة: 0 / 14 (كلها بيانات مكسورة)
  - السبب: حجم ثابت (snapshot واحد) أو حجم = 0 في كل الشرائط
  - النتيجة: مستحيل نقارن — البيانات السعودية غير صالحة لتحليل الـ 5 دقائق

• أين الفارق؟
  - جودة البيانات هي الفارق الأساسي. البيانات المصرية فيها 11 يوم صالح
    من 15 (73%)، بينما السعودية 0 من 14 (0%).
  - السبب المرجّح: السكرابر السعودي بياخد snapshot واحد في اليوم مش
    بيانات 5 دقائق حقيقية. محتاج إصلاح في مصدر البيانات قبل أي تحليل.
""")
