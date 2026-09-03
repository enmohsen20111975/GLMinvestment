#!/usr/bin/env python3
"""
hot_candidate_detector.py
==========================
اكتشاف نشاط الميكرز على بيانات 5 دقائق أثناء الجلسة.

المنطق:
1. يقرأ stock_intraday من intraday.db (بيانات 5 دقائق)
2. لكل سهم، يحسب:
   - Volume surge (حجم اليوم vs متوسط آخر 20 قراءة)
   - Delta (تغير السعر × الحجم = تدفق الأموال)
   - Absorption (حجم عالي + حركة سعر ضعيفة)
3. لو السهم فيه نشاط ميكرز → يضيفه لـ Hot Candidates
4. Hot Candidate = أولوية أعلى في الفحص (مش دخول تلقائي)

الاستخدام:
  python vps-service/jobs/hot_candidate_detector.py [--date 2026-08-27]
  python vps-service/jobs/hot_candidate_detector.py  # آخر يوم متاح

القواعد:
  - ممنوع دخول آلي بحجم كامل
  - Hot Candidate = علم فقط، الدخول لازم يعدي على كل الفلاتر
  - ممنوع إنشاء DB جديد
"""

import sqlite3
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INTRADAY_DB = str(PROJECT_ROOT / 'db' / 'intraday.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
NOTEBOOK_PATH = str(PROJECT_ROOT / 'data' / 'stock_notebook.json')


def detect_hot_candidates(target_date=None):
    """اكتشاف Hot Candidates من بيانات 5 دقائق.

    Args:
        target_date: تاريخ محدد (YYYY-MM-DD). لو None = آخر يوم متاح.

    Returns:
        list of dict: Hot Candidates مع التفاصيل
    """
    if not os.path.exists(INTRADAY_DB):
        print("[HOT-DETECT] ⚠️ intraday.db غير موجود")
        return []

    conn = sqlite3.connect(INTRADAY_DB)
    conn.row_factory = sqlite3.Row

    # لو مفيش date محدد → آخر يوم
    if not target_date:
        row = conn.execute("""
            SELECT MAX(DATE(timestamp)) as last_date FROM stock_intraday
            WHERE market IN ('مصر', 'EGX')
        """).fetchone()
        target_date = row['last_date'] if row else None

    if not target_date:
        print("[HOT-DETECT] ⚠️ مفيش بيانات في intraday.db")
        conn.close()
        return []

    print(f"[HOT-DETECT] الفحص على تاريخ: {target_date}")

    # جيب كل قراءات اليوم لكل الأسهم
    rows = conn.execute("""
        SELECT ticker, timestamp, price, change_percent, volume, open, high, low
        FROM stock_intraday
        WHERE (market = 'مصر' OR market = 'EGX')
        AND DATE(timestamp) = ?
        ORDER BY ticker, timestamp
    """, (target_date,)).fetchall()

    if not rows:
        print(f"[HOT-DETECT] ⚠️ مفيش بيانات ليوم {target_date}")
        conn.close()
        return []

    # تجميع البيانات لكل سهم
    stocks_data = defaultdict(list)
    for r in rows:
        stocks_data[r['ticker']].append(dict(r))

    print(f"[HOT-DETECT] عدد الأسهم: {len(stocks_data)}")

    # تحليل كل سهم
    hot_candidates = []

    for ticker, readings in stocks_data.items():
        if len(readings) < 5:
            continue  # مفيش بيانات كافية

        # استخراج البيانات
        prices = [r['price'] for r in readings if r['price'] and r['price'] > 0]
        volumes = [r['volume'] for r in readings if r['volume'] and r['volume'] > 0]
        changes = [r['change_percent'] for r in readings if r['change_percent'] is not None]

        if not prices or not volumes:
            continue

        # 1. Volume Surge: حجم آخر قراءة vs متوسط باقي القراءات
        latest_vol = volumes[-1] if volumes else 0
        avg_vol = sum(volumes[:-1]) / len(volumes[:-1]) if len(volumes) > 1 else 0
        vol_surge = latest_vol / avg_vol if avg_vol > 0 else 0

        # 2. Delta (تدفق الأموال): تغير السعر × الحجم
        latest_price = prices[-1]
        first_price = prices[0]
        price_change = ((latest_price - first_price) / first_price * 100) if first_price > 0 else 0
        delta = price_change * latest_vol / 1000  # normalized

        # 3. Absorption: حجم عالي + حركة سعر ضعيفة (≤2%)
        is_absorption = (vol_surge >= 2.0 and abs(price_change) <= 2.0 and latest_vol > avg_vol * 1.5)

        # 4. Volume Acceleration: الحجم بيزيد عبر الجلسة
        if len(volumes) >= 4:
            first_half_vol = sum(volumes[:len(volumes)//2]) / (len(volumes)//2)
            second_half_vol = sum(volumes[len(volumes)//2:]) / (len(volumes) - len(volumes)//2)
            vol_acceleration = second_half_vol / first_half_vol if first_half_vol > 0 else 1.0
        else:
            vol_acceleration = 1.0

        # 5. Price Momentum: السعر بيطير في آخر قراءات
        if len(prices) >= 3:
            recent_change = ((prices[-1] - prices[-3]) / prices[-3] * 100) if prices[-3] > 0 else 0
        else:
            recent_change = 0

        # ── تصنيف Hot Candidate ──────────────────────────────────
        # شروط Hot:
        #   - Volume surge ≥ 2.0x (الميكرز بيدخل سيولة)
        #   - AND (delta > 0 OR absorption) (السعر بيطير أو فيه امتصاص)
        #   - OR vol_acceleration ≥ 1.5 + recent_change > 1% (تسارع + زخم)

        is_hot = False
        hot_reason = []
        hot_score = 0

        # شرط 1: Volume surge + delta موجب
        if vol_surge >= 2.0 and delta > 0:
            is_hot = True
            hot_reason.append(f"vol_surge={vol_surge:.1f}x + delta=+{delta:.1f}")
            hot_score += 40

        # شرط 2: Absorption (حجم عالي + سعر ثابت = ميكرز بيجمع)
        if is_absorption:
            is_hot = True
            hot_reason.append(f"absorption (vol={vol_surge:.1f}x + change≤2%)")
            hot_score += 30

        # شرط 3: Volume acceleration + price momentum
        if vol_acceleration >= 1.5 and recent_change > 1.0:
            is_hot = True
            hot_reason.append(f"vol_accel={vol_acceleration:.1f}x + momentum={recent_change:+.1f}%")
            hot_score += 25

        # شرط 4: تغير قوي في السعر (≥ 5%)
        if price_change >= 5.0:
            is_hot = True
            hot_reason.append(f"price_change={price_change:+.1f}%")
            hot_score += 20

        if is_hot:
            hot_candidates.append({
                'ticker': ticker,
                'date': target_date,
                'price': latest_price,
                'change_pct': price_change,
                'recent_change': recent_change,
                'volume': latest_vol,
                'avg_volume': avg_vol,
                'vol_surge': round(vol_surge, 2),
                'vol_acceleration': round(vol_acceleration, 2),
                'delta': round(delta, 2),
                'absorption': is_absorption,
                'hot_score': hot_score,
                'hot_reason': ' | '.join(hot_reason),
                'readings_count': len(readings),
            })

    conn.close()

    # ترتيب حسب hot_score
    hot_candidates.sort(key=lambda x: -x['hot_score'])

    print(f"[HOT-DETECT] Hot Candidates: {len(hot_candidates)} من {len(stocks_data)} سهم")
    for hc in hot_candidates[:10]:
        print(f"  🔥 {hc['ticker']:<30} score={hc['hot_score']:>3} | {hc['hot_reason']}")

    return hot_candidates


def update_notebook(hot_candidates, target_date):
    """تحديث النوتبوك بـ Hot Candidates."""
    if not os.path.exists(NOTEBOOK_PATH):
        return

    with open(NOTEBOOK_PATH, 'r', encoding='utf-8') as f:
        notebook = json.load(f)

    for hc in hot_candidates:
        ticker = hc['ticker']
        # نظّف الـ ticker (شيل المسافات والأسماء الطويلة)
        clean_ticker = ticker.strip()[:10]

        if clean_ticker not in notebook.get('stocks', {}):
            notebook.setdefault('stocks', {})[clean_ticker] = {
                'name': ticker.strip(),
                'sector': '',
                'observations': [],
                'status': '',
                'trend': '',
                'maker_activity': '',
                'sector_heat': '',
            }

        notebook['stocks'][clean_ticker]['observations'].append({
            'date': target_date,
            'source': 'hot_candidate_detector',
            'note': f"🔥 Hot Candidate | score={hc['hot_score']} | surge={hc['vol_surge']}x | delta={hc['delta']} | {hc['hot_reason']}",
            'signal': 'hot_candidate',
            'confidence': hc['hot_score'],
        })
        notebook['stocks'][clean_ticker]['maker_activity'] = 'نشط جداً (Hot)'
        notebook['stocks'][clean_ticker]['trend'] = 'صاعد' if hc['change_pct'] > 0 else 'محايد'

    # أضف درس
    notebook.setdefault('lessons_learned', []).append({
        'date': target_date,
        'lesson': f"Hot Candidates: {len(hot_candidates)} سهم فيه نشاط ميكرز على 5 دقائق",
        'impact': 'high' if len(hot_candidates) > 5 else 'medium',
        'action': 'مراجعة Hot Candidates + ربط مع Discovery Fallback',
    })

    notebook.setdefault('_meta', {})['last_updated'] = target_date

    with open(NOTEBOOK_PATH, 'w', encoding='utf-8') as f:
        json.dump(notebook, f, ensure_ascii=False, indent=2)

    print(f"[HOT-DETECT] ✅ النوتبوك اتحدث بـ {len(hot_candidates)} Hot Candidate")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Hot Candidate Detector — اكتشاف الميكرز على 5 دقائق')
    parser.add_argument('--date', default=None, help='تاريخ محدد (YYYY-MM-DD)')
    args = parser.parse_args()

    print("=" * 70)
    print("  Hot Candidate Detector — اكتشاف الميكرز على 5 دقائق")
    print("=" * 70)

    hot = detect_hot_candidates(args.date)

    if hot:
        # اطبع تقرير
        print(f"\n{'='*70}")
        print(f"  تقرير Hot Candidates ({len(hot)} سهم)")
        print(f"{'='*70}")
        print(f"\n  {'السهم':<30} {'score':>5} {'surge':>6} {'delta':>8} {'change%':>8} {'absorp':>7} {'السبب':<40}")
        print("  " + "-" * 110)

        for hc in hot[:20]:
            abs_str = "✅" if hc['absorption'] else "—"
            print(f"  {hc['ticker'][:28]:<30} {hc['hot_score']:>5} {hc['vol_surge']:>6.1f}x {hc['delta']:>+8.1f} {hc['change_pct']:>+8.2f}% {abs_str:>7} {hc['hot_reason'][:40]:<40}")

        # إحصائيات
        with_surge = sum(1 for h in hot if h['vol_surge'] >= 2.0)
        with_absorption = sum(1 for h in hot if h['absorption'])
        with_momentum = sum(1 for h in hot if h['recent_change'] > 1.0)
        high_score = sum(1 for h in hot if h['hot_score'] >= 60)

        print(f"\n  إحصائيات:")
        print(f"    Volume surge ≥ 2x: {with_surge}")
        print(f"    Absorption: {with_absorption}")
        print(f"    Price momentum > 1%: {with_momentum}")
        print(f"    High score (≥60): {high_score}")

        # حدّث النوتبوك
        target_date = hot[0]['date'] if hot else args.date
        update_notebook(hot, target_date)

        # احفظ النتائج في JSON
        output_path = str(PROJECT_ROOT / 'data' / f'hot_candidates_{target_date}.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(hot, f, ensure_ascii=False, indent=2)
        print(f"\n  ✅ النتائج محفوظة في: {output_path}")

    print(f"\n{'='*70}")


if __name__ == '__main__':
    main()
