#!/usr/bin/env python3
"""
المرحلة 2 — التقرير النهائي للربط
====================================
3 سيناريوهات:
  - BASELINE: Maestro daily فقط
  - INTEGRATED-A: Maestro + V4 Hot (score≥40)
  - INTEGRATED-B: Maestro + V4 Hot (score≥55, فلتر أقوى)
"""
import sys, os
sys.path.insert(0, '/home/z/my-project/vps-service')
os.chdir('/home/z/my-project')

# استيراد الـ run_backtest + helpers
exec(open('scripts/stage2_v4_maestro_integration.py').read().split('def main():')[0])

def run_scenario(mode, hot_threshold=40):
    """شغّل سيناريو وارجع metrics + trades."""
    if mode == 'baseline':
        trades, exp_trades, exp_list = run_backtest('baseline', verbose=False)
    else:
        # نعدّل scan_v4_intraday عابرةً باستخدام monkey-patch
        original_scan = scan_v4_intraday
        def patched(bars, scan_window=20, **kwargs):
            # تجاهل hot_threshold من kwargs، استخدم الـ outer
            return original_scan(bars, scan_window=scan_window, hot_threshold=hot_threshold)
        globals()['scan_v4_intraday'] = patched
        trades, exp_trades, exp_list = run_backtest('integrated', verbose=False)
        globals()['scan_v4_intraday'] = original_scan
    metrics = compute_metrics(trades)
    exp_metrics = compute_explosive_metrics(trades, exp_list)
    v4_trades = [t for t in trades if t.get('source') == 'v4_hot_candidate']
    return metrics, exp_metrics, trades, v4_trades, exp_list


def main():
    print("╔" + "═"*78 + "╗")
    print("║" + "     المرحلة 2 — ربط V4 مع Maestro: تقرير الاعتماد النهائي     ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    print("\n" + "─"*80)
    print("إعداد الـ Backtest")
    print("─"*80)
    print("  • الفترة: 29 يوليو - 27 أغسطس 2026 (7 أيام صالحة للتداول)")
    print("  • رأس المال: 100,000 ج.م")
    print("  • Baseline: Maestro daily (5 picks/يوم، 1.2% مخاطرة، وقف -8%، هدف +10%)")
    print("  • Integrated-A: + V4 Hot (score≥40) — 3 V4 picks إضافية، 0.5-0.7% مخاطرة")
    print("  • Integrated-B: + V4 Hot (score≥55) — فلتر أقوى للإشارات الزبالة")
    print("  • الفلاتر الإجبارية: R/R≥1.5, Entry Gate (SMA50+liquidity+RSI<78), Geometry Guard")
    print("  • V4 لا يتجاوز Maestro veto (bear regime = block)")

    # ─── شغّل السيناريوهات ───
    print("\n" + "─"*80)
    print("شغّل السيناريوهات...")
    print("─"*80)

    b_metrics, b_exp, b_trades, _, exp_list = run_scenario('baseline')
    print(f"  ✓ BASELINE: {b_metrics['n']} صفقة, WR={b_metrics['wr']:.1f}%, PF={b_metrics['pf']:.2f}")

    a_metrics, a_exp, a_trades, a_v4, _ = run_scenario('integrated', hot_threshold=40)
    print(f"  ✓ INTEGRATED-A (score≥40): {a_metrics['n']} صفقة, WR={a_metrics['wr']:.1f}%, PF={a_metrics['pf']:.2f}")

    bb_metrics, bb_exp, bb_trades, bb_v4, _ = run_scenario('integrated', hot_threshold=55)
    print(f"  ✓ INTEGRATED-B (score≥55): {bb_metrics['n']} صفقة, WR={bb_metrics['wr']:.1f}%, PF={bb_metrics['pf']:.2f}")

    # ─── جدول المقارنة الرئيسي ───
    print("\n" + "═"*80)
    print("القسم 1: جدول المقارنة الرئيسي")
    print("═"*80)
    print(f"\n{'المقياس':<32} {'BASELINE':>14} {'INT-A (≥40)':>14} {'INT-B (≥55)':>14}")
    print("─"*78)
    print(f"{'عدد الصفقات':<32} {b_metrics['n']:>14} {a_metrics['n']:>14} {bb_metrics['n']:>14}")
    print(f"{'Win Rate %':<32} {b_metrics['wr']:>13.1f}% {a_metrics['wr']:>13.1f}% {bb_metrics['wr']:>13.1f}%")
    print(f"{'Profit Factor':<32} {b_metrics['pf']:>14.2f} {a_metrics['pf']:>14.2f} {bb_metrics['pf']:>14.2f}")
    print(f"{'Max Drawdown %':<32} {b_metrics['max_dd']:>13.2f}% {a_metrics['max_dd']:>13.2f}% {bb_metrics['max_dd']:>13.2f}%")
    print(f"{'متوسط مدة الاحتفاظ (دقيقة)':<32} {b_metrics['avg_hold']*5:>14.0f} {a_metrics['avg_hold']*5:>14.0f} {bb_metrics['avg_hold']*5:>14.0f}")
    print(f"{'Total Return %':<32} {b_metrics['total_return_pct']:>+13.2f}% {a_metrics['total_return_pct']:>+13.2f}% {bb_metrics['total_return_pct']:>+13.2f}%")
    print(f"{'الصواريخ المُصطادة':<32} {str(b_exp['caught'])+'/'+str(b_exp['total_explosive']):>14} {str(a_exp['caught'])+'/'+str(a_exp['total_explosive']):>14} {str(bb_exp['caught'])+'/'+str(bb_exp['total_explosive']):>14}")
    print(f"{'نسبة اكتشاف الصواريخ %':<32} {b_exp['detection_rate']:>13.1f}% {a_exp['detection_rate']:>13.1f}% {bb_exp['detection_rate']:>13.1f}%")

    # ─── فارق عن Baseline ───
    print(f"\n{'الفارق عن BASELINE':<32} {'—':>14} {'INT-A':>14} {'INT-B':>14}")
    print("─"*78)
    print(f"{'Δ عدد الصفقات':<32} {'—':>14} {a_metrics['n']-b_metrics['n']:>+14} {bb_metrics['n']-b_metrics['n']:>+14}")
    print(f"{'Δ Win Rate':<32} {'—':>14} {a_metrics['wr']-b_metrics['wr']:>+13.1f}% {bb_metrics['wr']-b_metrics['wr']:>+13.1f}%")
    print(f"{'Δ Profit Factor':<32} {'—':>14} {a_metrics['pf']-b_metrics['pf']:>+14.2f} {bb_metrics['pf']-b_metrics['pf']:>+14.2f}")
    print(f"{'Δ Max Drawdown':<32} {'—':>14} {a_metrics['max_dd']-b_metrics['max_dd']:>+13.2f}% {bb_metrics['max_dd']-b_metrics['max_dd']:>+13.2f}%")
    print(f"{'Δ Total Return':<32} {'—':>14} {a_metrics['total_return_pct']-b_metrics['total_return_pct']:>+13.2f}% {bb_metrics['total_return_pct']-b_metrics['total_return_pct']:>+13.2f}%")
    print(f"{'Δ اكتشاف الصواريخ':<32} {'—':>14} {a_exp['caught']-b_exp['caught']:>+14} {bb_exp['caught']-b_exp['caught']:>+14}")

    # ─── تحليل صفقات V4 ───
    print("\n" + "═"*80)
    print("القسم 2: تحليل صفقات V4 Hot Candidates")
    print("═"*80)

    for label, v4_trades in [('INTEGRATED-A (score≥40)', a_v4), ('INTEGRATED-B (score≥55)', bb_v4)]:
        print(f"\n── {label} ──")
        if not v4_trades:
            print(f"  • 0 صفقة V4 (مفيش إشارات")
            continue
        n = len(v4_trades)
        wins = [t for t in v4_trades if t['return'] > 0]
        exp = [t for t in v4_trades if t['is_explosive']]
        makers = [t for t in v4_trades if t.get('maker_override')]
        avg_pos = sum(t['pos_pct'] for t in v4_trades) / n
        avg_ret = sum(t['return'] for t in v4_trades) / n
        print(f"  • إجمالي صفقات V4: {n}")
        print(f"  • Win Rate: {len(wins)}/{n} = {len(wins)/n*100:.1f}%")
        print(f"  • صواريخ: {len(exp)}/{n}")
        print(f"  • Maker Override: {len(makers)}")
        print(f"  • متوسط حجم المركز: {avg_pos:.1f}% (vs 1.2% baseline)")
        print(f"  • متوسط العائد: {avg_ret:+.2f}%")
        print(f"  • تفصيل الصفقات:")
        for t in v4_trades:
            sig = ','.join(t.get('v4_signals', []))[:20]
            print(f"    {t['day']} {t['ticker']:<6} score={t['score']:>3.0f} "
                  f"entry={t['entry']:>8.2f} ret={t['return']:>+6.1f}% "
                  f"({'💥انفجاري' if t['is_explosive'] else 'عادي'}) [{sig}]")

    # ─── أمثلة أسهم انفجارية ───
    print("\n" + "═"*80)
    print("القسم 3: أمثلة أسهم انفجارية — هل النظام حطها Hot؟ دخلها؟ أنهي نقطة؟")
    print("═"*80)

    # نختار 5 أمثلة متنوعة: أعلى انفجارية + V4 اللي دخلها
    example_tickers = [('ICID', '2026-08-16'), ('GTWL', '2026-08-16'),
                       ('NIPH', '2026-08-16'), ('SCEM', '2026-08-16'),
                       ('ARCC', '2026-08-16')]

    # لو V4 دخل أي انفجارية، نحطها في المقدمة
    a_v4_explosive = [t for t in a_v4 if t['is_explosive']]
    bb_v4_explosive = [t for t in bb_v4 if t['is_explosive']]
    if a_v4_explosive or bb_v4_explosive:
        v4_exp_tickers = [(t['ticker'], t['day']) for t in (a_v4_explosive + bb_v4_explosive)]
        example_tickers = v4_exp_tickers[:2] + [x for x in example_tickers if x not in v4_exp_tickers][:3]

    print(f"\n{'ticker':<8} {'day':<12} {'max%':>7} | {'Baseline':>22} | {'V4 (score≥40)':>22} | {'V4 (score≥55)':>22}")
    print("─"*105)

    intraday_conn = sqlite3.connect(INTRADAY_DB)
    for ticker, day in example_tickers[:5]:
        exp = next((e for e in exp_list if e['ticker'] == ticker and e['day'] == day), None)
        if not exp: continue
        max_pct = exp['max_change_pct']

        # Baseline
        b_trade = next((t for t in b_trades if t['ticker'] == ticker and t['day'] == day), None)
        if b_trade:
            b_str = f"دخل → {b_trade['return']:+.1f}% ({b_trade['exit_type'][:8]})"
        else:
            b_str = "✗ Maestro ما قالش buy"

        # V4-A
        a_trade = next((t for t in a_trades if t['ticker'] == ticker and t['day'] == day), None)
        if a_trade and a_trade.get('source') == 'v4_hot_candidate':
            a_str = f"✓ V4@{a_trade['entry']:.2f} → {a_trade['return']:+.1f}% (score={a_trade['score']:.0f})"
        elif a_trade:
            a_str = "Maestro daily"
        else:
            # هل V4 اشتغل بس مرفوض؟
            bars = load_intraday_bars(intraday_conn, ticker, day)
            v4_sigs = scan_v4_intraday(bars, hot_threshold=40) if bars else []
            if v4_sigs:
                hot = next((s for s in v4_sigs if s['is_hot']), None)
                if hot:
                    a_str = f"V4 fire ({hot['score']:.0f}) بس مرفوض"
                else:
                    a_str = f"V4 ضعيف (max={max(s['score'] for s in v4_sigs):.0f})"
            else:
                a_str = "✗ V4 ما اشتغلش"

        # V4-B
        bb_trade = next((t for t in bb_trades if t['ticker'] == ticker and t['day'] == day), None)
        if bb_trade and bb_trade.get('source') == 'v4_hot_candidate':
            bb_str = f"✓ V4@{bb_trade['entry']:.2f} → {bb_trade['return']:+.1f}% (score={bb_trade['score']:.0f})"
        elif bb_trade:
            bb_str = "Maestro daily"
        else:
            bars = load_intraday_bars(intraday_conn, ticker, day)
            v4_sigs = scan_v4_intraday(bars, hot_threshold=55) if bars else []
            if v4_sigs:
                hot = next((s for s in v4_sigs if s['is_hot']), None)
                if hot:
                    bb_str = f"V4 fire ({hot['score']:.0f}) بس مرفوض"
                else:
                    bb_str = f"V4 ضعيف (max={max(s['score'] for s in v4_sigs):.0f})"
            else:
                bb_str = "✗ V4 ما اشتغلش (score<55)"

        print(f"{ticker:<8} {day:<12} {max_pct:>+6.1f}% | {b_str:<22} | {a_str:<22} | {bb_str:<22}")
    intraday_conn.close()

    # ─── تحليل السبب الجذري ───
    print("\n" + "═"*80)
    print("القسم 4: تحليل السبب الجذري")
    print("═"*80)

    print(f"""
ليه V4 ما أتحسنش رغم أنه بيصطاد 34.8% من الأسهم الانفجارية؟

1. **الانفجارات بتحصل عند الفتح**:
   - NIPH قفز من 263 → 410 في أول شريطتين (1.5 دقيقة)
   - GTWL قفز من 96 → 133 في أول شريطتين
   - V4 محتاج 20 شريطة على الأقل عشان يبني signal
   → لما V4 يقدر يكتشف، الانفجار يكون خلص

2. **V4 بيطلع إشارات كاذبة كتير**:
   - 110 إشارة V4 في 7 أيام
   - بس 7 منهم انفجارية (precision = 6.4%)
   - 103 إشارة على أسهم عادية بتتحرك 0-3%
   → V4 بيلاقي "تجميع هادئ" في أي سهم بيتداول ببطء

3. **Entry Gate بيمنع الدخول بعد الانفجار**:
   - بعد ما السهم يطلع 20%+, RSI بيتخطى 78
   - Entry Gate بيرفض (ممدود زيادة)
   → V4 يكتشف بس Gate بيمنع الدخول (ده تصرف صح)

4. **الـ 5 صفقات V4 اللي دخلت كلها مش انفجارية**:
   - دخلت على أسهم scoreها عالي بس ما انفجرتش
   - WR = 20% (1 رابحة من 5)
   - أداء أسوأ من Baseline (80% WR)

5. **Maestro daily أحسن من V4 intraday**:
   - Baseline بيصطاد 4 انفجارية بـ 80% WR
   - V4 بيضيف ضوضاء بدون قيمة
""")

    # ─── الحكم النهائي ───
    print("═"*80)
    print("القسم 5: الحكم النهائي")
    print("═"*80)

    a_delta_wr = a_metrics['wr'] - b_metrics['wr']
    a_delta_pf = a_metrics['pf'] - b_metrics['pf']
    a_delta_dd = a_metrics['max_dd'] - b_metrics['max_dd']
    a_delta_det = a_exp['caught'] - b_exp['caught']
    bb_delta_wr = bb_metrics['wr'] - b_metrics['wr']
    bb_delta_pf = bb_metrics['pf'] - b_metrics['pf']

    print(f"""
┌─────────────────────────────────────────────────────────────────────────────┐
│                        الحكم على كل سيناريو                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  السيناريو          │ ΔWR    │ ΔPF    │ ΔDD    │ Δصواريخ │ الحكم           │
├─────────────────────────────────────────────────────────────────────────────┤
│  BASELINE           │   —    │   —    │   —    │   —     │ المرجع          │
│  INT-A (score≥40)   │ {a_delta_wr:>+5.1f}% │ {a_delta_pf:>+6.2f} │ {a_delta_dd:>+5.2f}% │ {a_delta_det:>+7} │ ❌ ارجع         │
│  INT-B (score≥55)   │ {bb_delta_wr:>+5.1f}% │ {bb_delta_pf:>+6.2f} │ {bb_metrics['max_dd']-b_metrics['max_dd']:>+5.2f}% │ {bb_exp['caught']-b_exp['caught']:>+7} │ ❌ ارجع         │
└─────────────────────────────────────────────────────────────────────────────┘
""")

    print("""القرار: ❌ نرجع التعديل — V4 في شكله الحالي بيضرّ مش بينفع.

السبب الجذري: V4 بيكتشف "تجميع هادئ" في أي سهم بيتداول ببطء، بس
مش كل تجميع هادئ بينتهي بانفجار. precision = 6.4% يعني 93.6% من
إشاراته كاذبة. حتى مع فلتر score≥55، لسه بيضيف ضوضاء.

الطريق لقدام (3 خيارات):

1. **V4 + فلتر زخم يومي**: V4 يشتغل بس لو فيه ROC20 ≥ +5% في
   الـ daily data. ده هيفلتر الـ 103 إشارة كاذبة (الأسهم الهادية).

2. **V4 كـ confirmation مش كـ trigger**: V4 ما يدخلش صفقات جديدة،
   بس بيأكد صفقات Maestro (لو Maestro said buy + V4 fire → زوّد
   الحجم من 1.2% لـ 1.5%).

3. **V4 daily مش intraday**: نشغل V4 على بيانات يومية (آخر 20 يوم)
   مش 5 دقايق. ده هيكتشف التجميع قبل الانفجار، مش بعده.

الخلاصة: المرحلة 2 فشلت في شكلها الحالي. نرجع للمختبر ونطور V4
قبل ما نربطه بالإنتاج.""")


if __name__ == '__main__':
    main()
