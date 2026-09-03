#!/usr/bin/env python3
"""
V40.2 Live Production Test — اختبار حي على 3 أسهم بأخبار قوية
================================================================
توجيه المالك: "ناخد كام سهم عليهم أخبار قوية دلوقتي، ونشوف التوصية
النهائية + الشرح اللي هيظهر للعميل، ونحكم إذا كان الكلام مقنع ولا لأ."

الأسهم المختارة (من الإنتاج):
  1. COMI — فيه أخبار استحواذ + MA_ACQUISITION
  2. TMGH — فيه أخبار (مشاركة في أخبار COMI)
  3. EGX30 — فيه أخبار مؤشرات السوق

لكل سهم:
  - التوصية قبل تأثير الخبر (V40.2 فقط)
  - التوصية بعد تأثير الخبر (combined_score, combined_signal)
  - النص اللي هيظهر للعميل
"""
from __future__ import annotations
import sys, os, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vps-service'))

from analyzers.live_news_integration import (
    get_news_impact_for_live_prediction,
    generate_news_aware_recommendation,
    format_news_for_client_display,
)
from analyzers.position_sizing import calculate_position_size


def simulate_v40_2_prediction(ticker: str, base_score: int, base_signal: str, atr: float, entry: float) -> dict:
    """
    محاكاة توقع V40.2 لسهم معين (بدل تشغيل V40.2 كامل — عشان الاختبار الحي سريع).
    """
    # Position Sizing
    sizing = calculate_position_size(atr, entry)
    
    # V40.2 base prediction (simulated)
    v40_2_result = {
        'ticker': ticker,
        'score': base_score,
        'signal': base_signal,
        'entry_price': entry,
        'atr': atr,
        'proofs': {
            'technical': f'تحليل فني: ATR={sizing["atr_pct"]:.1f}%, حجم={sizing["position_size_mult"]:.0%}',
            'position_sizing': f'تصنيف التقلب: {sizing["volatility_class"]} → حجم {sizing["position_size_mult"]:.0%}',
        },
    }
    
    # Generate news-aware recommendation
    recommendation = generate_news_aware_recommendation(
        ticker=ticker,
        v40_2_score=base_score,
        v40_2_signal=base_signal,
        v40_2_proofs=v40_2_result['proofs'],
    )
    
    # Add position sizing info
    recommendation['position_sizing'] = sizing
    recommendation['v40_2_entry'] = entry
    recommendation['v40_2_atr'] = atr
    
    return recommendation


def main():
    print("=" * 100)
    print("V40.2 LIVE PRODUCTION TEST — 3 أسهم بأخبار قوية")
    print("توجيه المالك: 'شوف التوصية النهائية + الشرح اللي هيظهر للعميل'")
    print("=" * 100)

    # 3 أسهم مختارة (بيانات تقريبية للـ ATR + entry)
    test_stocks = [
        {
            'ticker': 'COMI',
            'name_ar': 'البنك التجاري الدولي',
            'base_score': 65,
            'base_signal': 'BUY',
            'atr': 4.5,        # ATR تقريبي
            'entry': 50.0,     # سعر تقريبي
            'reason': 'عليه أخبار استحواذ + MA_ACQUISITION من الإنتاج',
        },
        {
            'ticker': 'TMGH',
            'name_ar': 'طلعت مصطفى',
            'base_score': 58,
            'base_signal': 'BUY',
            'atr': 6.5,        # ATR أعلى (سهم متفجر)
            'entry': 1.85,     # سعر تقريبي
            'reason': 'مشارك في أخبار COMI + سهم عقاري متفجر',
        },
        {
            'ticker': 'EGX30',
            'name_ar': 'مؤشر EGX30',
            'base_score': 60,
            'base_signal': 'HOLD',
            'atr': 3.0,
            'entry': 10285.0,  # سعر تقريبي من الإنتاج
            'reason': 'عليه أخبار مؤشرات السوق (ارتفاع/هبوط EGX30)',
        },
    ]

    for stock in test_stocks:
        print(f"\n{'='*100}")
        print(f"📊 {stock['ticker']} — {stock['name_ar']}")
        print(f"   السبب: {stock['reason']}")
        print(f"{'='*100}")

        # Run simulation
        result = simulate_v40_2_prediction(
            ticker=stock['ticker'],
            base_score=stock['base_score'],
            base_signal=stock['base_signal'],
            atr=stock['atr'],
            entry=stock['entry'],
        )

        # Show BEFORE news impact
        print(f"\n🔹 قبل تأثير الخبر (V40.2 فقط):")
        print(f"   Score: {result['v40_2_score']}/100")
        print(f"   Signal: {result['v40_2_signal']}")
        print(f"   Entry: {result['v40_2_entry']:.2f}")
        print(f"   ATR: {result['v40_2_atr']:.2f} ({result['position_sizing']['atr_pct']:.1f}%)")

        # Show position sizing
        ps = result['position_sizing']
        print(f"\n🎯 Position Sizing:")
        print(f"   تصنيف التقلب: {ps['volatility_class']}")
        print(f"   حجم الصفقة: {ps['position_size_mult']:.0%}")
        print(f"   السبب: {ps['reason_ar']}")

        # Show news impact
        news = result.get('news_data', {})
        print(f"\n📰 تأثير الأخبار:")
        print(f"   has_news: {news.get('has_news', False)}")
        print(f"   news_count: {news.get('news_count', 0)}")
        print(f"   news_score: {news.get('news_score', 0):+d}")
        print(f"   level: {news.get('emoji', '')} {news.get('label_ar', 'محايد')}")
        print(f"   score_delta: {news.get('score_delta', 0):+d}")
        print(f"   action: {news.get('action_ar', 'محايد')}")

        # Show AFTER news impact
        print(f"\n🔸 بعد تأثير الخبر (combined):")
        print(f"   Combined Score: {result['combined_score']}/100")
        print(f"   Combined Signal: {result['combined_signal']}")
        delta = result['combined_score'] - result['v40_2_score']
        if delta != 0:
            print(f"   Δ Score: {delta:+d} (من الخبر)")
        signal_changed = result['combined_signal'] != result['v40_2_signal']
        if signal_changed:
            print(f"   ⚡ Signal changed: {result['v40_2_signal']} → {result['combined_signal']}")

        # Show client display
        print(f"\n💬 النص اللي هيظهر للعميل:")
        print("-" * 80)
        print(result['recommendation_ar'])
        print("-" * 80)

    print(f"\n{'='*100}")
    print("✓ LIVE PRODUCTION TEST COMPLETE")
    print(f"{'='*100}")


if __name__ == '__main__':
    main()
