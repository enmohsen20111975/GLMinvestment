#!/usr/bin/env python3
"""
daily_gainer_scan.py
====================
سكربت يومي بعد الإغلاق: يفحص أعلى 10 صاعدات ويحدد:
1. هل النظام اكتشفهم؟
2. ليه فات اللي فات؟
3. يكتب ملاحظة في النوتبوك لكل سهم.

التشغيل (cron بعد daily_closer):
  0 14 * * 0-4 cd /root/GLMinvestment && python vps-service/jobs/daily_gainer_scan.py >> logs/gainer_scan.log 2>&1
"""

import sqlite3
import json
import os
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
NOTEBOOK_PATH = str(PROJECT_ROOT / 'data' / 'stock_notebook.json')

TODAY = datetime.now().strftime('%Y-%m-%d')

def main():
    print("=" * 70)
    print(f"  Daily Gainer Scan — {TODAY}")
    print("=" * 70)

    # 1. جيب أعلى 10 صاعدات
    sconn = sqlite3.connect(STOCKS_DB)
    sconn.row_factory = sqlite3.Row
    gainers = sconn.execute("""
        SELECT ticker, name_ar, sector, current_price, change_percent, 
               volume, avg_volume, rsi, turnover_egp
        FROM stocks 
        WHERE is_active = 1 AND market = 'EGX' AND change_percent > 0
        ORDER BY change_percent DESC
        LIMIT 10
    """).fetchall()

    if not gainers:
        print("  مفيش صاعدات النهاردة (السوق هابط أو مغلق)")
        sconn.close()
        return

    # 2. جيب التوقعات النشطة
    pconn = sqlite3.connect(PREDICTIONS_DB)
    pconn.row_factory = sqlite3.Row
    active_preds = pconn.execute("""
        SELECT ticker, signal, prediction_date, entry_price, target_price, stop_loss
        FROM predictions 
        WHERE outcome_date IS NULL AND market = 'EGX'
    """).fetchall()
    predicted_tickers = set(p['ticker'] for p in active_preds)

    # 3. اقرأ النوتبوك
    notebook = {}
    if os.path.exists(NOTEBOOK_PATH):
        with open(NOTEBOOK_PATH, 'r', encoding='utf-8') as f:
            notebook = json.load(f)
    if 'stocks' not in notebook:
        notebook['stocks'] = {}
    if 'lessons_learned' not in notebook:
        notebook['lessons_learned'] = []

    # 4. حلل كل صاعد
    discovered = 0
    missed = 0
    new_lessons = []

    print(f"\n  {'السهم':<8} {'التغير%':>8} {'surge':>8} {'في التوقعات':>12} {'التشخيص':<40}")
    print("  " + "-" * 80)

    for g in gainers:
        ticker = g['ticker']
        change = g['change_percent'] or 0
        vol = g['volume'] or 0
        avg_vol = g['avg_volume'] or 1
        surge = vol / avg_vol if avg_vol > 0 else 0
        sector = g['sector'] or '—'
        rsi = g['rsi'] or 50
        in_pred = ticker in predicted_tickers

        # تشخيص
        if in_pred:
            diag = "✅ النظام اكتشفه"
            discovered += 1
        else:
            # ليه فات؟
            if change > 12 and surge < 2.5:
                diag = "❌ Don't Chase رفضه (طلع 12%+ بدون surge)"
            elif change > 12 and surge >= 2.5:
                diag = "⚠️ كان المفروض Maker Override يلتقطه — محتاج مراجعة"
            elif surge < 1.5:
                diag = "❌ مفيش volume surge — السهم طار بدون سيولة واضحة"
            elif rsi > 65:
                diag = "❌ Peak Entry Filter رفضه (RSI > 65)"
            else:
                diag = f"❌ فات النظام — محتاج تحليل (surge={surge:.1f}x, RSI={rsi:.0f})"
            missed += 1

        print(f"  {ticker:<8} {change:>+8.2f} {surge:>8.1f}x {'✅' if in_pred else '❌':>12} {diag:<40}")

        # 5. اكتب ملاحظة في النوتبوك
        if ticker not in notebook['stocks']:
            notebook['stocks'][ticker] = {
                'name': g['name_ar'] or '',
                'sector': sector,
                'observations': [],
                'status': '',
                'trend': '',
                'maker_activity': '',
                'sector_heat': '',
            }

        notebook['stocks'][ticker]['observations'].append({
            'date': TODAY,
            'source': 'daily_gainer_scan',
            'note': f"صاعد يومي ({change:+.2f}%) | surge={surge:.1f}x | RSI={rsi:.0f} | {diag}",
            'signal': 'مكتشف' if in_pred else 'فات',
            'confidence': 0,
        })

        # حدّث الحالة
        if in_pred:
            notebook['stocks'][ticker]['status'] = 'في التوقعات'
        else:
            notebook['stocks'][ticker]['status'] = 'فات النظام'

        notebook['stocks'][ticker]['trend'] = 'صاعد' if change > 5 else 'محايد'
        notebook['stocks'][ticker]['maker_activity'] = 'نشط' if surge >= 2.5 else 'ضعيف'
        notebook['stocks'][ticker]['sector_heat'] = sector

        # درس مستفاد لو فات
        if not in_pred and 'محتاج تحليل' in diag:
            new_lessons.append({
                'date': TODAY,
                'ticker': ticker,
                'change': change,
                'surge': surge,
                'rsi': rsi,
                'reason': diag,
            })

    # 6. أضف دروس للنوتبوك
    if missed > 0:
        notebook['lessons_learned'].append({
            'date': TODAY,
            'lesson': f"Daily Scan: {discovered}/{len(gainers)} صاعد اكتشفه النظام، {missed} فاتوا",
            'impact': 'high' if missed > 3 else 'medium',
            'action': 'مراجعة الأسهم الفاتت + تعديل العتبات لو لزم',
        })

    for lesson in new_lessons:
        notebook['lessons_learned'].append({
            'date': TODAY,
            'lesson': f"{lesson['ticker']} طار {lesson['change']:+.1f}% (surge={lesson['surge']:.1f}x, RSI={lesson['rsi']:.0f}) — {lesson['reason']}",
            'impact': 'medium',
            'action': 'تحليل يدوي للسهم + مراجعة الفلاتر',
        })

    # 7. احفظ النوتبوك
    notebook.setdefault('_meta', {})['last_updated'] = TODAY
    with open(NOTEBOOK_PATH, 'w', encoding='utf-8') as f:
        json.dump(notebook, f, ensure_ascii=False, indent=2)

    # 8. ملخص
    print(f"\n  {'='*70}")
    print(f"  ملخص:")
    print(f"  اكتشف: {discovered}/{len(gainers)}")
    print(f"  فات: {missed}/{len(gainers)}")
    print(f"  دروس جديدة: {len(new_lessons)}")
    print(f"  النوتبوك اتحدث بـ {len(gainers)} ملاحظة")
    print(f"  {'='*70}")

    sconn.close()
    pconn.close()

if __name__ == '__main__':
    main()
