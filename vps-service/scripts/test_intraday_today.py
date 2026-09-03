import sys
import os

PROJECT_ROOT = '/home/meme/my_apps/GLMinvestment'
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'vps-service'))

from analyzers.intraday_reader import get_intraday_data, detect_intraday_breakout, detect_maker_flow

symbols = ['KORA', 'LUTS', 'GDWA', 'IEEC', 'AIH', 'ARAB', 'CCAP']
print(f"=== INTRADAY REALTIME ANALYSIS (TODAY: 2026-09-01) ===")
for sym in symbols:
    d = get_intraday_data(sym, hours=6)
    brk = detect_intraday_breakout(sym, lookback_bars=12)
    flow = detect_maker_flow(sym, lookback_bars=12)
    prices = d.get('prices', [])
    volumes = d.get('volumes', [])
    if not prices:
        print(f"{sym}: No intraday ticks")
        continue
    p0, p1 = prices[0], prices[-1]
    chg = ((p1 - p0) / p0 * 100) if p0 > 0 else 0
    vol_total = volumes[-1] if volumes else 0
    print(f"\n📈 {sym}:")
    print(f"   السعر: من {p0:.3f} إلى {p1:.3f} ({chg:+.2f}%) | قمة اليوم: {max(prices):.3f} | قاع اليوم: {min(prices):.3f}")
    print(f"   السيولة التراكمية: {vol_total:,.0f} سهم | عدد الشموع: {len(prices)}")
    print(f"   اختراق لحظي: {'🚀 نعم' if brk['is_breakout'] else 'لا'} | نسبة حجم الاختراق: {brk['volume_ratio']}x")
    print(f"   تدفق الميكرز (Smart Money): {flow['flow']} | درجة الثقة: {flow['confidence']}% | اتجاه الحجم: {flow['volume_trend_pct']:+.1f}%")
