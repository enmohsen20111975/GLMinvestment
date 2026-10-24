#!/usr/bin/env python3
"""
forensic_radar_analysis.py — تحليل جنائي للرادار
===================================================
يفحص كل سهم EGX ويسجل:
  - ليه طلع في الرادار (أي مسار اشتغل)
  - ليه مطلعش (أي إشارات فشلت)
  - حجم الميكرز vs الناس العادية (proxy: حجم آخر يوم vs متوسط 20 يوم)
  - معدل تردد الدخول/الخروج (volatility of volume)
  - التغير الشهري + حالة التصحيح
  - تجميع أو تصريف (buy pressure days vs sell days)

النتيجة: تقرير كامل لكل سهم + إحصائيات.
"""
import sqlite3, statistics, sys, json
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
from utils.shared_liquidity import detect_quiet_accumulation, detect_pre_surge, is_explosive_surge

def log(msg):
    print(msg, flush=True)

def parse_vol(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m; s = s[:-1]; break
    try: return float(s) * mult
    except: return 0.0

def main():
    db_path = PROJECT_ROOT / 'db' / 'data_engine.db'
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    # كل tickers EGX (مع mapping عربي/إنجليزي)
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT p.symbol FROM egksco_price_history p
        JOIN stocks s ON p.symbol = s.symbol
        WHERE s.market IN ('EGX', 'مصر')
    """).fetchall()]
    log(f"فحص {len(tickers)} سهم EGX...\n")

    results = []
    for ticker in tickers:
        rows = conn.execute("""
            SELECT symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover
            FROM egksco_price_history
            WHERE symbol = ? AND close_price IS NOT NULL AND close_price > 0
            ORDER BY price_date DESC LIMIT 40
        """, (ticker,)).fetchall()

        if len(rows) < 18:
            continue

        rows = list(reversed(rows))
        closes = [r['close_price'] for r in rows]
        volumes = [parse_vol(r['volume']) for r in rows]
        highs = [r['high_price'] for r in rows]
        lows = [r['low_price'] for r in rows]
        turnovers = [row['turnover'] if row['turnover'] else (c * v if c and v else 0) for row, c, v in zip(rows, closes, volumes)]

        current_price = closes[-1]
        if current_price < 1.0:
            continue

        avg_vol_20 = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
        avg_vol_10 = sum(volumes[-10:]) / 10
        vol_ratio = avg_vol_10 / avg_vol_20 if avg_vol_20 > 0 else 0
        last_vol = volumes[-1] if volumes else 0

        roc_10d = ((closes[-1] - closes[-11]) / closes[-11] * 100) if len(closes) >= 11 and closes[-11] > 0 else 0
        roc_30d = ((closes[-1] - closes[-21]) / closes[-21] * 100) if len(closes) >= 21 and closes[-21] > 0 else 0

        # شغل الفلاتر
        pre_surge, _, pre_surge_details = detect_pre_surge(closes, volumes, highs, lows)
        quiet, _, quiet_details = detect_quiet_accumulation(closes, volumes, highs, lows)
        explosive, _, _ = is_explosive_surge(volumes, closes)

        # حجم الميكرز: آخر يوم vs متوسط 20 يوم (لو أكبر من 2× → ميكرز نشط)
        maker_activity = 'عالي' if last_vol > avg_vol_20 * 2 else ('متوسط' if last_vol > avg_vol_20 * 1.2 else 'منخفض')

        # معدل تردد الدخول/الخروج: CV (coefficient of variation) للحجم
        if avg_vol_20 > 0:
            vol_std = statistics.stdev(volumes[-20:]) if len(volumes) >= 20 else statistics.stdev(volumes)
            vol_cv = vol_std / avg_vol_20
        else:
            vol_cv = 0
        churn_rate = 'عالي (دخول/خروج سريع)' if vol_cv > 1.0 else ('متوسط' if vol_cv > 0.5 else 'منخفض (استقرار)')

        # تجميع/تصريف: أيام الشراء vs أيام البيع في آخر 10 أيام
        buy_days = sum(1 for i in range(-10, 0) if i > -len(closes) and closes[i] > closes[i-1])
        sell_days = 10 - buy_days
        if buy_days >= 6:
            accumulation = 'تجميع قوي (شراء غالب)'
        elif sell_days >= 6:
            accumulation = 'تصريف قوي (بيع غالب)'
        elif buy_days >= sell_days:
            accumulation = 'تجميع خفيف'
        else:
            accumulation = 'تصريف خفيف'

        # حالة التصحيح: لو نزل أكتر من 5% من آخر قمة
        max_20 = max(closes[-20:]) if len(closes) >= 20 else max(closes)
        if max_20 > 0:
            drop_from_peak = (current_price - max_20) / max_20 * 100
        else:
            drop_from_peak = 0
        correction = 'في تصحيح' if drop_from_peak < -5 else ('قرب التصحيح' if drop_from_peak < -3 else 'صاعد')

        # المدى اليومي (range 10d)
        min_10 = min(closes[-10:])
        max_10 = max(closes[-10:])
        range_10d = ((max_10 - min_10) / min_10 * 100) if min_10 > 0 else 0

        # رتب المسار
        path = 'none'
        if pre_surge:
            path = 'pre_surge'
        elif quiet:
            path = 'quiet'
        elif explosive:
            path = 'explosive'

        # ليه مطلعش؟
        rejection_reasons = []
        if path == 'none':
            if not pre_surge and pre_surge_details:
                rejection_reasons.extend([f.split('(')[0] for f in pre_surge_details.get('signals_failed', [])])
            if not quiet and quiet_details:
                rejection_reasons.extend([f.split('(')[0] for f in quiet_details.get('signals_failed', [])])
            if not explosive:
                # explosive بـ يحتاج vol ≥ 2.5× + range ضيق + فوق SMA20
                if last_vol < avg_vol_20 * 2.5:
                    rejection_reasons.append('vol<2.5× (لا انفجار)')

        # المتوقع: بناءً على البيانات الحالية
        if roc_10d > 20:
            expected = 'مخترق — ممكن يصحح'
        elif roc_10d > 10:
            expected = 'صاعد بقوة — راقب التصحيح'
        elif vol_ratio > 1.5 and range_10d < 8:
            expected = 'تجميع — ممكن انفجار قريب'
        elif drop_from_peak < -10:
            expected = 'في تصحيح — انتظر الاستقرار'
        elif maker_activity == 'عالي' and buy_days >= 5:
            expected = 'ميكرز نشط — راقب الاختراق'
        else:
            expected = 'عادي — لا توجد إشارات قوية'

        results.append({
            'ticker': ticker,
            'price': round(current_price, 2),
            'roc_10d': round(roc_10d, 1),
            'roc_30d': round(roc_30d, 1),
            'vol_ratio': round(vol_ratio, 2),
            'range_10d': round(range_10d, 1),
            'maker_activity': maker_activity,
            'churn_rate': churn_rate,
            'accumulation': accumulation,
            'correction': correction,
            'drop_from_peak': round(drop_from_peak, 1),
            'path': path,
            'pre_surge_signals': pre_surge_details.get('signal_count', 0) if pre_surge_details else 0,
            'quiet_signals': quiet_details.get('signal_count', 0) if quiet_details else 0,
            'explosive': explosive,
            'rejection_reasons': rejection_reasons,
            'expected': expected,
            'buy_days': buy_days,
            'sell_days': sell_days,
        })

    conn.close()

    # إحصائيات
    log(f"\n═══ إحصائيات شاملة ({len(results)} سهم) ═══\n")

    # 1. كم سهم في كل مسار
    paths = {}
    for r in results:
        p = r['path']
        paths[p] = paths.get(p, 0) + 1
    log("📊 توزيع المسارات:")
    for p, n in sorted(paths.items(), key=lambda x: -x[1]):
        log(f"  {p:15s}: {n:3d} سهم")

    # 2. أكتر أسباب للرفض
    reject_reasons = {}
    for r in results:
        if r['path'] == 'none':
            for reason in r['rejection_reasons']:
                reject_reasons[reason] = reject_reasons.get(reason, 0) + 1
    log(f"\n📊 أكتر أسباب الرفض (من {sum(1 for r in results if r['path'] == 'none')} سهم مرفوض):")
    for reason, n in sorted(reject_reasons.items(), key=lambda x: -x[1])[:10]:
        log(f"  {reason:30s}: {n:3d} سهم")

    # 3. توزيع نشاط الميكرز
    maker_counts = {}
    for r in results:
        m = r['maker_activity']
        maker_counts[m] = maker_counts.get(m, 0) + 1
    log(f"\n📊 نشاط الميكرز:")
    for m, n in sorted(maker_counts.items(), key=lambda x: -x[1]):
        log(f"  {m:15s}: {n:3d} سهم")

    # 4. تجميع/تصريف
    accum_counts = {}
    for r in results:
        a = r['accumulation']
        accum_counts[a] = accum_counts.get(a, 0) + 1
    log(f"\n📊 تجميع/تصريف:")
    for a, n in sorted(accum_counts.items(), key=lambda x: -x[1]):
        log(f"  {a:30s}: {n:3d} سهم")

    # 5. الأسهم الأكثر صعوداً في 30 يوم (مطلعش في الرادار)
    log(f"\n📊 أعلى 10 أسهم صعوداً في 30 يوم (ROC30):")
    top_movers = sorted(results, key=lambda x: -x['roc_30d'])[:10]
    log(f"  {'السهم':8s} | {'السعر':>8s} | {'ROC30':>7s} | {'ROC10':>7s} | {'حجم نسبي':>9s} | {'المسار':>10s} | {'المتوقع'}")
    log("  " + "-" * 100)
    for r in top_movers:
        log(f"  {r['ticker']:8s} | {r['price']:>8.2f} | {r['roc_30d']:>+6.1f}% | {r['roc_10d']:>+6.1f}% | {r['vol_ratio']:>8.2f}× | {r['path']:>10s} | {r['expected']}")

    # 6. الأسهم اللي نزلت أكتر (ممكن فرصة للارتداد)
    log(f"\n📊 أكثر 10 أسهم نزولاً في 30 يوم (ممكن فرصة):")
    worst_movers = sorted(results, key=lambda x: x['roc_30d'])[:10]
    log(f"  {'السهم':8s} | {'السعر':>8s} | {'ROC30':>7s} | {'ROC10':>7s} | {'حجم نسبي':>9s} | {'المسار':>10s} | {'المتوقع'}")
    log("  " + "-" * 100)
    for r in worst_movers:
        log(f"  {r['ticker']:8s} | {r['price']:>8.2f} | {r['roc_30d']:>+6.1f}% | {r['roc_10d']:>+6.1f}% | {r['vol_ratio']:>8.2f}× | {r['path']:>10s} | {r['expected']}")

    # 7. أسهم فيها ميكرز نشط بس مطلعتش في الرادار
    log(f"\n📊 أسهم فيها ميكرز نشط + مش في الرادار (فرص ضائعة):")
    missed = [r for r in results if r['maker_activity'] == 'عالي' and r['path'] == 'none']
    log(f"  العدد: {len(missed)}")
    if missed:
        log(f"  {'السهم':8s} | {'السعر':>8s} | {'ROC10':>7s} | {'حجم نسبي':>9s} | {'سبب الرفض'}")
        log("  " + "-" * 80)
        for r in missed[:15]:
            reasons = ', '.join(r['rejection_reasons'][:3])
            log(f"  {r['ticker']:8s} | {r['price']:>8.2f} | {r['roc_10d']:>+6.1f}% | {r['vol_ratio']:>8.2f}× | {reasons}")

    # حفظ JSON
    out_path = PROJECT_ROOT / 'scripts' / 'output' / 'forensic_radar_analysis.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_analyzed': len(results),
            'results': results,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {out_path}")


if __name__ == '__main__':
    main()
