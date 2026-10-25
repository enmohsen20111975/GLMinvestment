#!/usr/bin/env python3
"""
مرحلة 1 محسّنة — كاشف الصواريخ على بيانات الـ 5 دقائق
=============================================
يحلل 3 مشاكل:
1. جودة البيانات (أيام بحجم ثابت / شريطة واحدة)
2. إعادة ضبط عتبات surge/absorption (حساسية للتجميع الهادئ)
3. مقارنة قبل/بعد على نفس الأسهم الانفجارية

الناتج في الترمينال للنسخ المباشر.
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
    """يفحص جودة بيانات كل يوم ويرجع قائمة الأيام الصالحة فقط."""
    c = conn.cursor()
    days = [r[0] for r in c.execute("""
        SELECT DISTINCT substr(timestamp, 1, 10) as day
        FROM stock_intraday WHERE market=?
        ORDER BY day
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
        # سهم "سليم": ≥20 شريطة + ≥10 قيم حجم مختلفة (حجم متغير فعلاً)
        clean = sum(1 for r in rows if r[1] >= 20 and r[2] >= 10)
        # سهم "مكسور": شريطة واحدة فقط (snapshot مش 5min)
        snapshot_only = sum(1 for r in rows if r[1] == 1)
        # سهم "بحجم ثابت": ≥20 شريطة بس ≤2 قيمة حجم
        flat_vol = sum(1 for r in rows if r[1] >= 20 and r[2] <= 2)

        usable = clean >= 50  # اليوم صالح لو فيه ≥50 سهم ببيانات سليمة
        day_quality.append({
            'day': day, 'total': total, 'clean': clean,
            'snapshot_only': snapshot_only, 'flat_vol': flat_vol,
            'usable': usable
        })
    return day_quality


# ═══════════════════════════════════════════════════════════════════
# 2) الكاشف — 3 إصدارات
# ═══════════════════════════════════════════════════════════════════

def detect_v1_strict(bars):
    """الإصدار 1 — العتبات الصارمة (اللي ادا 29.6%)."""
    if len(bars) < 20:
        return None
    vols = [b['volume'] for b in bars]
    closes = [b['price'] for b in bars]

    vol_ma = sum(vols[-21:-1]) / 20 if len(vols) >= 21 else sum(vols[:-1]) / max(len(vols)-1, 1)
    vol_std = (sum((v - vol_ma)**2 for v in vols[-21:-1]) / 20) ** 0.5 if len(vols) >= 21 else 0
    dyn_surge = vol_ma + (vol_std * 1.5)
    vs = vols[-1] > dyn_surge
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
    """الإصدار 2 — حساسية أعلى للتجميع الهادئ.
    - يخفض عتبة surge من 1.5σ لـ 1.0σ
    - يضيف كشف absorption (سعر ثابت + حجم متزايد)
    - يضيف كشف pre-surge (ارتفاع حجم تدريجي قبل الحركة)
    - يخفض عتبة score من 60 لـ 45
    """
    if len(bars) < 15:
        return None
    vols = [b['volume'] for b in bars]
    closes = [b['price'] for b in bars]
    highs = [b['high'] for b in bars]
    lows = [b['low'] for b in bars]

    # متوسط الحجم (آخر 20 شريطة)
    lookback = min(20, len(vols) - 1)
    vol_ma = sum(vols[-lookback-1:-1]) / lookback
    vol_std = (sum((v - vol_ma)**2 for v in vols[-lookback-1:-1]) / lookback) ** 0.5

    # ─── عتبات مخفّضة ───
    # surge: 1.0σ بدل 1.5σ (أكثر حساسية)
    dyn_surge_loose = vol_ma + (vol_std * 1.0)
    vs_loose = vols[-1] > dyn_surge_loose
    vs_ratio = vols[-1] / (vol_ma or 1)

    # semi-surge: 1.3x المتوسط (حجم نشط بدون ما يكون surge)
    semi_surge = vs_ratio >= 1.3

    # ─── كشف التجميع الهادئ (Quiet Accumulation) ───
    # السعر شبه ثابت (≤2% change في آخر 10 شرائط) بس الحجم بيزيد تدريجياً
    recent_closes = closes[-10:]
    recent_vols = vols[-10:]
    if len(recent_closes) >= 10 and recent_closes[0] > 0:
        price_change_pct = abs(recent_closes[-1] - recent_closes[0]) / recent_closes[0] * 100
        # حجم أول 5 شرائط vs آخر 5
        early_vol = sum(recent_vols[:5]) / 5
        late_vol = sum(recent_vols[5:]) / 5
        vol_ramp = late_vol / (early_vol or 1) if early_vol > 0 else 1
        # تجميع هادئ = سعر ثابت + حجم بيزيد ≥1.5x
        quiet_accum = price_change_pct <= 2.0 and vol_ramp >= 1.5
    else:
        quiet_accum = False
        vol_ramp = 0
        price_change_pct = 0

    # ─── كشف pre-surge (الحجم بيتصاعد قبل الانفجار) ───
    # آخر 5 شرائط: كل شريطة أكبر من اللي قبلها
    if len(vols) >= 5 and all(v > 0 for v in vols[-5:]):
        ramp = all(vols[-i-1] >= vols[-i-2] for i in range(4))
        # متوسط تصاعد ≥1.2x
        avg_ratio = sum(vols[-i-1] / (vols[-i-2] or 1) for i in range(4)) / 4
        pre_surge = ramp and avg_ratio >= 1.2
    else:
        pre_surge = False

    # ─── ROC ───
    roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 and closes[-6] > 0 else 0
    roc10 = (closes[-1] - closes[-11]) / closes[-11] * 100 if len(closes) >= 11 and closes[-11] > 0 else 0
    roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if len(closes) >= 21 and closes[-21] > 0 else 0

    # ─── امتصاص (Absorption) ───
    # شريطة بحجم كبير بس السعر مش بيتحرك كتير (بيع متشتت على مشتري قوي)
    if len(closes) >= 3 and highs[-1] > 0 and lows[-1] > 0:
        bar_range_pct = (highs[-1] - lows[-1]) / closes[-1] * 100
        absorption = vs_ratio >= 1.5 and bar_range_pct <= 1.5  # حجم كبير + رينج صغير
    else:
        absorption = False

    # ─── احتساب النقاط ───
    score = 0
    reasons = []

    # Volume signals
    if vs_loose:
        score += 22; reasons.append(f'surge {vs_ratio:.1f}x')
    elif semi_surge:
        score += 12; reasons.append(f'semi {vs_ratio:.1f}x')

    if quiet_accum:
        score += 25; reasons.append(f'quiet_accum ramp={vol_ramp:.1f}x')
    if pre_surge:
        score += 18; reasons.append('pre_surge ramp')
    if absorption:
        score += 20; reasons.append(f'absorption range={bar_range_pct:.1f}%')

    # ROC signals
    if roc20 > 15: score += 15; reasons.append(f'ROC20={roc20:+.1f}%')
    elif roc20 > 10: score += 10; reasons.append(f'ROC20={roc20:+.1f}%')
    elif roc20 > 5: score += 5; reasons.append(f'ROC20={roc20:+.1f}%')

    if roc5 > 3: score += 8; reasons.append(f'ROC5={roc5:+.1f}%')
    if roc10 > 5: score += 6; reasons.append(f'ROC10={roc10:+.1f}%')

    # ─── قرار الإشارة ───
    # عتبة مخفّضة 45 بدل 60 + شرط أسهل
    is_rocket = score >= 45 and (vs_loose or quiet_accum or pre_surge or absorption)

    return {
        'is_rocket': is_rocket, 'score': min(score, 100),
        'vs_ratio': vs_ratio, 'roc5': roc5, 'roc10': roc10, 'roc20': roc20,
        'quiet_accum': quiet_accum, 'pre_surge': pre_surge, 'absorption': absorption,
        'reason': ' | '.join(reasons)
    }


def detect_v3_balanced(bars):
    """الإصدار 3 — وسط: حساسية معقولة بدون إشارات زبالة.
    - surge: 1.25σ (بين 1.0 و 1.5)
    - يطلب تأكيدين على الأقل (surge + ROC أو quiet_accum + pre_surge)
    - عتبة score = 50
    """
    if len(bars) < 15:
        return None
    vols = [b['volume'] for b in bars]
    closes = [b['price'] for b in bars]
    highs = [b['high'] for b in bars]
    lows = [b['low'] for b in bars]

    lookback = min(20, len(vols) - 1)
    vol_ma = sum(vols[-lookback-1:-1]) / lookback
    vol_std = (sum((v - vol_ma)**2 for v in vols[-lookback-1:-1]) / lookback) ** 0.5

    dyn_surge_mid = vol_ma + (vol_std * 1.25)
    vs_mid = vols[-1] > dyn_surge_mid
    vs_ratio = vols[-1] / (vol_ma or 1)
    semi_surge = vs_ratio >= 1.4

    # Quiet accumulation
    recent_closes = closes[-10:]
    recent_vols = vols[-10:]
    if len(recent_closes) >= 10 and recent_closes[0] > 0:
        price_change_pct = abs(recent_closes[-1] - recent_closes[0]) / recent_closes[0] * 100
        early_vol = sum(recent_vols[:5]) / 5
        late_vol = sum(recent_vols[5:]) / 5
        vol_ramp = late_vol / (early_vol or 1) if early_vol > 0 else 1
        quiet_accum = price_change_pct <= 2.0 and vol_ramp >= 1.8  # أعلى شوية
    else:
        quiet_accum = False
        vol_ramp = 0

    # Pre-surge
    if len(vols) >= 5 and all(v > 0 for v in vols[-5:]):
        ramp = all(vols[-i-1] >= vols[-i-2] for i in range(4))
        avg_ratio = sum(vols[-i-1] / (vols[-i-2] or 1) for i in range(4)) / 4
        pre_surge = ramp and avg_ratio >= 1.3
    else:
        pre_surge = False

    roc5 = (closes[-1] - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 and closes[-6] > 0 else 0
    roc10 = (closes[-1] - closes[-11]) / closes[-11] * 100 if len(closes) >= 11 and closes[-11] > 0 else 0
    roc20 = (closes[-1] - closes[-21]) / closes[-21] * 100 if len(closes) >= 21 and closes[-21] > 0 else 0

    # Absorption
    if len(closes) >= 3 and highs[-1] > 0 and lows[-1] > 0:
        bar_range_pct = (highs[-1] - lows[-1]) / closes[-1] * 100
        absorption = vs_ratio >= 1.6 and bar_range_pct <= 1.2
    else:
        absorption = False

    score = 0
    signals = []  # عدّاد التأكيدات
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

    # ─── قرار: score ≥ 50 + تأكيدين على الأقل ───
    confirmations = len(signals)
    is_rocket = score >= 50 and confirmations >= 2

    return {
        'is_rocket': is_rocket, 'score': min(score, 100),
        'vs_ratio': vs_ratio, 'roc5': roc5, 'roc10': roc10, 'roc20': roc20,
        'quiet_accum': quiet_accum, 'pre_surge': pre_surge, 'absorption': absorption,
        'confirmations': confirmations, 'reason': ' | '.join(reasons)
    }


# ═══════════════════════════════════════════════════════════════════
# 3) تحميل بيانات السهم
# ═══════════════════════════════════════════════════════════════════
def load_stock_bars(conn, ticker, day, market='مصر'):
    """يرجع شرائط السهم في يوم معين، مرتبة زمنياً.
    بيفلتر الـ tickers اللي ليها اسم طويل (مكررة بـ vol=0)."""
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


def get_liquid_tickers(conn, market='مصر', min_avg_vol=100000):
    """يرجع tickers اللي ليها سيولة (متوسط حجم يومي ≥ min_avg_vol).
    بيفلتر الـ tickers اللي ليها اسم طويل."""
    rows = conn.execute("""
        SELECT ticker, AVG(volume) as avg_vol, COUNT(DISTINCT substr(timestamp,1,10)) as days
        FROM stock_intraday
        WHERE market=? AND length(ticker) <= 6
        GROUP BY ticker
        HAVING avg_vol >= ? AND days >= 3
        ORDER BY avg_vol DESC
    """, (market, min_avg_vol)).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def find_explosive_stocks(conn, market='مصر', min_change=15.0):
    """يلقى الأسهم اللي طارت ≥ min_change% في يوم واحد."""
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


# ═══════════════════════════════════════════════════════════════════
# 4) تشغيل الكاشف على سهم انفجاري
# ═══════════════════════════════════════════════════════════════════
def run_detector_on_explosion(conn, ticker, day, detector_fn, market='مصر',
                               scan_window=20):
    """يشغل الكاشف على كل شريطة من شارع الانفجار.
    يرجع: قائمة بكل الإشارات + هل اصطاد الانفجار قبل ما يخلص."""
    bars = load_stock_bars(conn, ticker, day, market)
    if len(bars) < scan_window + 5:
        return {'signals': [], 'caught': False, 'first_signal_idx': None,
                'first_signal_at_pct': 0, 'bars': len(bars)}

    signals = []
    # امسح من شريطة scan_window لحد قبل النهاية بشريطتين
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
    # هل اصطاده قبل ما يوصل 50% من الحركة؟
    max_pct = max((s['pct_from_start'] for s in signals), default=0)
    final_pct = (bars[-1]['price'] - first_p) / first_p * 100 if first_p > 0 else 0
    early_catch = any(s['pct_from_start'] < max_pct * 0.5 for s in signals) if signals and max_pct > 0 else False

    return {
        'signals': signals, 'caught': caught,
        'first_signal_idx': signals[0]['bar_idx'] if signals else None,
        'first_signal_at_pct': signals[0]['pct_from_start'] if signals else 0,
        'early_catch': early_catch,
        'bars': len(bars), 'final_pct': final_pct,
        'max_pct': max((b['price'] for b in bars), default=0)
    }


# ═══════════════════════════════════════════════════════════════════
# 5) التقرير الرئيسي
# ═══════════════════════════════════════════════════════════════════
def main():
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB, writable=False).__enter__()

    print("╔" + "═"*78 + "╗")
    print("║" + " كاشف الصواريخ على بيانات الـ 5 دقائق — مرحلة 1 محسّنة ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    # ─── القسم 1: فحص جودة البيانات ───
    print("\n" + "─"*80)
    print("القسم 1: فحص جودة بيانات الـ 5 دقائق — السوق المصري")
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
    print(f"\n→ الأيام الصالحة للتحليل: {len(usable_days)} / {len(eg_quality)}")
    print(f"→ الأيام المرفوضة: snapshot فقط ({sum(1 for d in eg_quality if d['snapshot_only']==d['total'])})، حجم ثابت ({sum(1 for d in eg_quality if d['flat_vol']>50 and not d['usable'])})")

    # ─── القسم 2: الأسهم الانفجارية الحقيقية ───
    print("\n" + "─"*80)
    print("القسم 2: الأسهم الانفجارية (تغير ≥ +15% في يوم واحد) — السوق المصري")
    print("─"*80)

    explosive = find_explosive_stocks(conn, 'مصر', min_change=15.0)
    print(f"\nإجمالي الأسهم الانفجارية: {len(explosive)}")
    print(f"\n{'ticker':<8} {'اليوم':<12} {'first':>8} {'last':>8} {'change%':>9} {'max%':>9} {'bars':>5} {'max_vol':>13}")
    print("─"*75)
    for e in explosive[:30]:
        print(f"{e['ticker']:<8} {e['day']:<12} {e['first']:>8.2f} {e['last']:>8.2f} {e['change_pct']:>+8.2f}% {e['max_change_pct']:>+8.2f}% {e['bars']:>5} {e['max_vol']:>13,}")

    # ─── القسم 3: مقارنة الكاشفات (قبل/بعد) ───
    print("\n" + "─"*80)
    print("القسم 3: مقارنة الكاشفات على الأسهم الانفجارية — قبل / بعد الضبط")
    print("─"*80)

    detectors = [
        ('V1 صارم (قديم)', detect_v1_strict),
        ('V2 حساس (جديد)', detect_v2_sensitive),
        ('V3 متوازن (جديد)', detect_v3_balanced),
    ]

    # نختبر على كل الأسهم الانفجارية
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

    for e in explosive:
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

    # ─── القسم 4: ملخص النتائج ───
    print("\n" + "─"*80)
    print("القسم 4: ملخص النتائج — السوق المصري")
    print("─"*80)

    print(f"\n{'الكاشف':<22} {'اصطاد':>7} {'من':>5} {'نسبة':>8} {'مبكر':>7} {'إشارات':>8} {'متوسط وقت الاصطياد':>20}")
    print("─"*85)
    for name, _ in detectors:
        r = results_by_detector[name]
        pct = r['caught'] / r['total'] * 100 if r['total'] > 0 else 0
        early_pct = r['early'] / r['total'] * 100 if r['total'] > 0 else 0
        avg_pct = sum(r['avg_signal_pct']) / len(r['avg_signal_pct']) if r['avg_signal_pct'] else 0
        print(f"{name:<22} {r['caught']:>7} {r['total']:>5} {pct:>7.1f}% {r['early']:>7} {r['signals']:>8} {avg_pct:>+18.1f}%")

    # تفاصيل الفائتة
    print(f"\n── الأسهم الانفجارية الفائتة (V3 المتوازن) ──")
    v3_missed = results_by_detector['V3 متوازن (جديد)']['missed']
    if v3_missed:
        for t, d, m in v3_missed:
            print(f"  ✗ {t} @ {d}: طار {m:+.1f}% بس الكاشف ماسكهوش")
    else:
        print("  (لا يوجد — كل الأسهم الانفجارية اتلمست)")

    conn.close()
    return results_by_detector


def compare_markets(eg_results):
    """مقارنة السوق المصري (المحلى) مع السعودي (النتاجى)."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB, writable=False).__enter__()

    print("\n\n╔" + "═"*78 + "╗")
    print("║" + " مقارنة: السوق المصري (المحلى) vs السعودي (النتاجى) ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    # ─── جودة البيانات: السعودي ───
    print("\n" + "─"*80)
    print("القسم 5: جودة البيانات — السوق السعودي (النتاجى)")
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

    # ─── الأسهم الانفجارية في السعودي ───
    print("\n" + "─"*80)
    print("القسم 6: الأسهم الانفجارية — السوق السعودي")
    print("─"*80)

    sa_explosive = find_explosive_stocks(conn, 'السعودية', min_change=10.0)
    print(f"\nإجمالي الأسهم الانفجارية: {len(sa_explosive)}")
    if sa_explosive:
        print(f"\n{'ticker':<10} {'اليوم':<12} {'first':>10} {'last':>10} {'change%':>9} {'max%':>9} {'bars':>5} {'max_vol':>15}")
        print("─"*85)
        for e in sa_explosive[:20]:
            print(f"{e['ticker']:<10} {e['day']:<12} {e['first']:>10.2f} {e['last']:>10.2f} {e['change_pct']:>+8.2f}% {e['max_change_pct']:>+8.2f}% {e['bars']:>5} {e['max_vol']:>15,}")

    # ─── تشغيل V3 على السعودي ───
    print("\n" + "─"*80)
    print("القسم 7: تشغيل V3 (المتوازن) على السوق السعودي")
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

    print(f"\n{'الكاشف':<22} {'اصطاد':>7} {'من':>5} {'نسبة':>8} {'مبكر':>7} {'إشارات':>8} {'متوسط وقت الاصطياد':>20}")
    print("─"*85)
    for name, _ in detectors:
        r = sa_results[name]
        pct = r['caught'] / r['total'] * 100 if r['total'] > 0 else 0
        avg_pct = sum(r['avg_signal_pct']) / len(r['avg_signal_pct']) if r['avg_signal_pct'] else 0
        print(f"{name:<22} {r['caught']:>7} {r['total']:>5} {pct:>7.1f}% {r['early']:>7} {r['signals']:>8} {avg_pct:>+18.1f}%")

    # ─── مقارنة نهائية ───
    print("\n" + "═"*80)
    print("القسم 8: المقارنة النهائية — المحلى (مصر) vs النتاجى (السعودية)")
    print("═"*80)

    print(f"\n{'المقياس':<35} {'مصر (محلى)':>15} {'السعودية (نتاجى)':>18} {'الفارق':>10}")
    print("─"*80)

    # عدد الأيام الصالحة
    eg_usable = sum(1 for d in check_data_quality(conn, 'مصر') if d['usable'])
    sa_usable = sum(1 for d in sa_quality if d['usable'])
    print(f"{'الأيام الصالحة للتحليل':<35} {eg_usable:>15} {sa_usable:>18} {sa_usable-eg_usable:>+10}")

    # عدد الأسهم الانفجارية
    eg_n = len(find_explosive_stocks(conn, 'مصر', 15.0))
    sa_n = len(sa_explosive)
    print(f"{'عدد الأسهم الانفجارية (≥15%)':<35} {eg_n:>15} {sa_n:>18} {sa_n-eg_n:>+10}")

    # نسبة الاصطياد V1
    eg_v1 = eg_results['V1 صارم (قديم)']['caught'] / max(eg_results['V1 صارم (قديم)']['total'], 1) * 100
    sa_v1 = sa_results['V1 صارم']['caught'] / max(sa_results['V1 صارم']['total'], 1) * 100
    print(f"{'V1 صارم — نسبة الاصطياد%':<35} {eg_v1:>14.1f}% {sa_v1:>17.1f}% {sa_v1-eg_v1:>+9.1f}%")

    # نسبة الاصطياد V2
    eg_v2 = eg_results['V2 حساس (جديد)']['caught'] / max(eg_results['V2 حساس (جديد)']['total'], 1) * 100
    sa_v2 = sa_results['V2 حساس']['caught'] / max(sa_results['V2 حساس']['total'], 1) * 100
    print(f"{'V2 حساس — نسبة الاصطياد%':<35} {eg_v2:>14.1f}% {sa_v2:>17.1f}% {sa_v2-eg_v2:>+9.1f}%")

    # نسبة الاصطياد V3
    eg_v3 = eg_results['V3 متوازن (جديد)']['caught'] / max(eg_results['V3 متوازن (جديد)']['total'], 1) * 100
    sa_v3 = sa_results['V3 متوازن']['caught'] / max(sa_results['V3 متوازن']['total'], 1) * 100
    print(f"{'V3 متوازن — نسبة الاصطياد%':<35} {eg_v3:>14.1f}% {sa_v3:>17.1f}% {sa_v3-eg_v3:>+9.1f}%")

    # متوسط وقت الاصطياد
    eg_avg = sum(eg_results['V3 متوازن (جديد)']['avg_signal_pct']) / max(len(eg_results['V3 متوازن (جديد)']['avg_signal_pct']), 1)
    sa_avg = sum(sa_results['V3 متوازن']['avg_signal_pct']) / max(len(sa_results['V3 متوازن']['avg_signal_pct']), 1)
    print(f"{'V3 — متوسط وقت الاصطياد (من القمة)':<35} {eg_avg:>+14.1f}% {sa_avg:>+17.1f}% {sa_avg-eg_avg:>+9.1f}%")

    conn.close()
    return sa_results


if __name__ == '__main__':
    eg_results = main()
    sa_results = compare_markets(eg_results)

    print("\n\n" + "═"*80)
    print("الخلاصة النهائية")
    print("═"*80)
    eg_v1 = eg_results['V1 صارم (قديم)']['caught'] / max(eg_results['V1 صارم (قديم)']['total'], 1) * 100
    eg_v3 = eg_results['V3 متوازن (جديد)']['caught'] / max(eg_results['V3 متوازن (جديد)']['total'], 1) * 100
    delta = eg_v3 - eg_v1
    print(f"\n• السوق المصري (المحلى):")
    print(f"  - V1 صارم: {eg_v1:.1f}% (النتيجة القديمة ≈ 29.6%)")
    print(f"  - V3 متوازن (بعد الضبط): {eg_v3:.1f}%")
    print(f"  - التحسن: {delta:+.1f} نقطة مئوية")
    print(f"\n• السوق السعودي (النتاجى):")
    sa_v1 = sa_results['V1 صارم']['caught'] / max(sa_results['V1 صارم']['total'], 1) * 100
    sa_v3 = sa_results['V3 متوازن']['caught'] / max(sa_results['V3 متوازن']['total'], 1) * 100
    print(f"  - V1 صارم: {sa_v1:.1f}%")
    print(f"  - V3 متوازن: {sa_v3:.1f}%")
    print(f"  - التحسن: {sa_v3-sa_v1:+.1f} نقطة مئوية")
    print(f"\n• الفارق بين السوقين (V3):")
    print(f"  - مصر: {eg_v3:.1f}% | السعودية: {sa_v3:.1f}% | الفارق: {sa_v3-eg_v3:+.1f}%")
