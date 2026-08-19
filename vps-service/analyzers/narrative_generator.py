"""
narrative_generator.py — مولد السرد البشري (Humanized Narrative Generator)
=============================================================================
HUMANIZE-034: بيولّد أسباب توصية واقعية بالعربية العامية المصرية المبسطة،
بدل الجمل الآلية الثابتة. بيربط السبب بـ:
  - RSI + Bollinger (تشبع بيعي/شرائي)
  - MACD crossover + Volume
  - Pine Script Flags (Golden Pullback / Dead Cat / Divergence)
  - Support/Resistance الحقيقية
  - النظام (regime): صاعد/هابط/عرضي

الهدف: العميل يقرأ السبب ويبص على الشارت يلاقي الكلام صح → ثقة 100%.
"""
from typing import Dict, Any, Optional


def build_humanized_reason(
    ticker: str,
    indicators: Dict[str, Any],
    pine_flags: Dict[str, bool],
    sr_levels: Dict[str, Optional[float]],
    score: float,
    regime: str = 'unknown',
) -> str:
    """
    يولّد جملة سبب واقعية بالعربية بناءً على البيانات الفعلية.

    Args:
        ticker: رمز السهم (مثال: COMI)
        indicators: dict فيه rsi, macd_hist, volume_ratio, bb_lower, bb_upper, sma50, sma200
        pine_flags: dict فيه is_golden_pullback, is_dead_cat, is_bullish_divergence
        sr_levels: dict فيه support, resistance, far_support, far_resistance
        score: الـ confluence score (0-138)
        regime: bull_trend / bear_trend / ranging / volatile / unknown

    Returns:
        نص عربي يشرح سبب الإشارة (2-3 أسطر).
    """
    rsi = float(indicators.get('rsi', 50) or 50)
    macd_hist = float(indicators.get('macd_hist', 0) or 0)
    volume_ratio = float(indicators.get('volume_ratio', 1.0) or 1.0)
    bb_lower = indicators.get('bb_lower')
    bb_upper = indicators.get('bb_upper')
    support = sr_levels.get('support')
    resistance = sr_levels.get('resistance')

    # fmt_cents: لو السعر < 100 → يعرضه بمنزلتين، غير كده بمنزلة واحدة
    def _fmt_price(p):
        if p is None:
            return None
        p = float(p)
        return f"{p:.2f}" if p < 100 else f"{p:.1f}"

    reasons = []

    # ── 1. Pine Script Flags (أولوية عالية) ──
    if pine_flags.get('is_golden_pullback'):
        supp_txt = f" عند دعم قوي ({_fmt_price(support)} جنيه)" if support else ""
        reasons.append(
            f"🟢 السهم في ترند صاعد ونزل يصحح{supp_txt}، دي فرصة شراء بخصم"
        )
    elif pine_flags.get('is_dead_cat'):
        reasons.append(
            "⚠️ فخ ارتداد! السهم في ترند هابط وطلع شوية — ده غالباً استدراج، ابعد"
        )
    elif pine_flags.get('is_bullish_divergence'):
        reasons.append(
            f"📊 تباعد إيجابي: السعر نزل بس الـ RSI طلع ({rsi:.0f}) — البائعين خلصوا"
        )

    # ── 2. RSI + Bollinger (تشبع) ──
    if rsi < 35 and bb_lower is not None:
        reasons.append(
            f"السهم وصل لتشبع بيعي قوي (RSI {rsi:.0f}) وارتد من بولينجر سفلي"
        )
    elif rsi > 75 and bb_upper is not None:
        reasons.append(
            f"السهم في تشبع شرائي (RSI {rsi:.0f}) عند بولينجر علوي — احذر التصحيح"
        )
    elif rsi < 40:
        reasons.append(f"الـ RSI منخفض ({rsi:.0f}) — السهم قرب منطقة شراء")
    elif rsi > 65:
        reasons.append(f"الـ RSI مرتفع ({rsi:.0f}) — السهم قرب مقاومة نفسية")

    # ── 3. MACD + Volume (زخم) ──
    if macd_hist > 0 and volume_ratio > 1.3:
        reasons.append(
            f"الزخم انقلب لإيجابي (MACD) مع دخول سيولة قوية (حجم {volume_ratio:.1f}x المتوسط)"
        )
    elif macd_hist < 0 and volume_ratio > 1.3:
        reasons.append(
            f"ضغط بيعي (MACD سالب) مع حجم مرتفع ({volume_ratio:.1f}x) — احذر"
        )
    elif macd_hist > 0:
        reasons.append("الـ MACD إيجابي — الزخم يتعافى")
    elif macd_hist < 0:
        reasons.append("الـ MACD سالب — الزخم ضعيف")

    # ── 4. Support/Resistance (مستويات حقيقية) ──
    if support and resistance:
        reasons.append(
            f"يتداول بين دعم {_fmt_price(support)} ومقاومة {_fmt_price(resistance)}"
        )

    # ── 5. Regime (الاتجاه العام) ──
    if regime == 'bull_trend' and score >= 65:
        reasons.append("السوق في ترند صاعد عام")
    elif regime == 'bear_trend':
        reasons.append("السوق في ترند هابط عام — الحذر واجب")
    elif regime == 'ranging':
        reasons.append("السوق عرضي — انتظر كسر واضح")

    # لو مفيش أي سبب محدد
    if not reasons:
        if score >= 65:
            reasons.append("مؤشرات فنية إيجابية متجمعة")
        elif score <= 35:
            # BRIEF-042-FIX: تنويع نصوص الانتظار — اذكر السبب الفعلي
            if rsi > 70:
                reasons.append(f"RSI مرتفع ({rsi:.0f}) — السهم في تشبع شرائي، انتظر تصحيح")
            elif rsi < 30:
                reasons.append(f"RSI منخفض ({rsi:.0f}) — السهم في تشبع بيعي بس الزخم ضعيف")
            elif macd_hist < 0:
                reasons.append("MACD هبوطي — الزخم سالب، انتظر انعكاس")
            elif volume_ratio < 0.8:
                reasons.append(f"السيولة ضعيفة ({volume_ratio:.1f}x) — مفيش اهتمام من المؤسسات")
            elif support and resistance:
                reasons.append(f"السهم بين دعم {support:.2f} ومقاومة {resistance:.2f} — انتظر كسر واضح")
            else:
                reasons.append("مؤشرات فنية سلبية متجمعة — انتظر تحسن")
        else:
            if rsi > 60:
                reasons.append(f"RSI {rsi:.0f} — السهم قريب من المقاومة، انتظر تراجع")
            elif macd_hist < 0:
                reasons.append("الـ MACD لسه سالب — الزخم مش مؤكد")
            elif volume_ratio < 1.0:
                reasons.append(f"السيولة عادية ({volume_ratio:.1f}x) — محتاج سيولة أقوى للتأكيد")
            else:
                reasons.append("السهم في منطقة محايدة — انتظر تأكيد كسر المقاومة")

    # رجّع أول 2-3 أسباب (عشان النص مايطولش)
    return " — ".join(reasons[:3])


def build_humanized_signal_message(
    ticker: str,
    name: str,
    signal: str,
    signal_ar: str,
    reason: str,
    entry: float,
    stop_loss: float,
    target: float,
    rr_ratio: float,
) -> str:
    """
    HUMANIZE-034: يبني رسالة التوصية الكاملة بالـ template الجديد.

    Template:
      🟢 [Ticker] - [Name]
      📝 السبب: [Humanized Reason]
      💰 الدخول: [Entry] (حول الدعم)
      🛑 الوقف: [Stop] (تحت الدعم)
      🎯 الهدف: [Target] (عند المقاومة)
      ⚖️ R/R: [RR]
    """
    # اختيار الإيموجي حسب الإشارة
    if signal == 'BUY':
        emoji = '🟢'
    elif signal == 'SELL':
        emoji = '🔴'
    else:
        emoji = '🟡'

    # وصف موقع الدخول/الوقف/الهدف
    entry_note = 'حول الدعم' if entry else ''
    stop_note = 'تحت الدعم' if stop_loss else ''
    target_note = 'عند المقاومة' if target else ''

    lines = [
        f"{emoji} {ticker} - {name}",
        f"📝 السبب: {reason}",
        f"💰 الدخول: {entry:.2f} {entry_note}".strip(),
        f"🛑 الوقف: {stop_loss:.2f} {stop_note}".strip(),
        f"🎯 الهدف: {target:.2f} {target_note}".strip(),
        f"⚖️ R/R: {rr_ratio:.2f}",
    ]
    return "\n".join(lines)


def is_rr_acceptable(rr_ratio: float, score: float) -> bool:
    """
    HUMANIZE-034: يحدد هل الـ R/R مقبول للتوصية.
    - لو score >= 50: R/R لازم ≥ 1.5
    - لو score < 50: R/R لازم ≥ 1.2
    - لو R/R < 1.0: غير مقبول (refuse → HOLD)
    """
    if rr_ratio < 1.0:
        return False
    if score >= 50:
        return rr_ratio >= 1.5
    return rr_ratio >= 1.2


def build_ai_narrative(
    ticker: str,
    score: float,
    signal: str,
    rsi: float,
    macd_hist: float,
    trend: str,
    nearest_support: float,
    telegram_news_summary: str = '',
    early_trend_flag: bool = False,
) -> str:
    """
    BRIEF-042: يبني نص عربي بشري يشرح سبب التوصية باستخدام الـ AI (Ollama).

    1. يجمع الـ Context (score, signal, rsi, macd, trend, support, telegram, early_trend).
    2. يجلب آخر 2 دروس مستفادة من stock_stories (RAG).
    3. يبني Prompt ويرسله لـ Ollama glm-fast.
    4. fallback: يستخدم build_humanized_reason لو الـ AI فشل.
    """
    # 1. تجميع الـ Context
    context = {
        'ticker': ticker,
        'score': round(score, 1),
        'signal': signal,
        'rsi': round(rsi, 1) if rsi else 'N/A',
        'macd_hist': round(macd_hist, 4) if macd_hist else 0,
        'trend': trend or 'unknown',
        'nearest_support': nearest_support or 'N/A',
        'telegram_news': telegram_news_summary[:200] if telegram_news_summary else 'لا يوجد',
        'early_trend': '🚀 فرصة ترند مبكر' if early_trend_flag else 'لا',
    }

    # 2. RAG: جلب دروس مستفادة من stock_stories
    stories_text = ''
    try:
        from ai.decision_engine import DecisionEngine
        _de = DecisionEngine()
        _stories = _de.find_similar_stories(ticker, rsi or 50, signal, limit=2)
        if _stories:
            stories_text = ' | '.join([
                f"({s.get('text', '')[:100]} — النتيجة: {s.get('outcome', 'N/A')}%)"
                for s in _stories
            ])
        else:
            stories_text = 'لا توجد دروس سابقة'
    except Exception:
        stories_text = 'لا توجد دروس سابقة'

    # 3. بناء الـ Prompt للـ Ollama
    # BRIEF-042-FIX: تنويع نصوص الـ AI — لو انتظار، اطلب سبب محدد
    _signal_lower = signal.lower() if signal else ''
    _is_wait = 'hold' in _signal_lower or 'انتظر' in _signal_lower or 'wait' in _signal_lower

    if _is_wait:
        wait_instruction = (
            "مهم: التوصية انتظار. اكتب سبب الانتظار بشكل محدد وواقعي. "
            "لا تكرر جملة 'مؤشرات إيجابية بس محدودة'. "
            "اذكر السبب الفعلي: الزخم سالب؟ السيولة ضعيفة؟ السعر قريب من المقاومة؟ "
            "RSI مرتفع؟ MACD هبوطي؟ اذكر السبب الحقيقي."
        )
    else:
        wait_instruction = ""

    prompt = (
        f"أنت محلل مالي محترف في البورصة المصرية. "
        f"بناءً على المعطيات التالية:\n"
        f"السهم: {context['ticker']}\n"
        f"الإشارة: {context['signal']}\n"
        f"النتيجة: {context['score']}/100\n"
        f"RSI: {context['rsi']}\n"
        f"MACD: {context['macd_hist']}\n"
        f"الاتجاه: {context['trend']}\n"
        f"أقرب دعم: {context['nearest_support']}\n"
        f"أخبار التليجرام: {context['telegram_news']}\n"
        f"ترند مبكر: {context['early_trend']}\n\n"
        f"الدروس المستفادة من التاريخ: {stories_text}\n\n"
        f"{wait_instruction}\n"
        f"⛔ قاعدة صارمة: لا تغيّر أي رقم من المعطيات أعلاه. استخدم الأرقام كما هي. "
        f"لا تختلق أسعاراً أو نسباً أو تواريخ. لو البيانات ناقصة قل إن التحليل غير مكتمل.\n\n"
        f"اكتب شرحاً من 3 نقاط فقط بالعربية يوضح سبب التوصية. "
        f"كن مباشراً وواقعياً. كل سهم ليه سبب مختلف."
    )

    # 4. استدعاء Ollama (مع fallback آمن)
    # QWEN-UNIFY: استخدام agent.fast_model (من env) بدل hardcoded "glm-fast".
    try:
        from ai.glm_finance_agent import GlmFinanceAgent
        agent = GlmFinanceAgent()
        raw = agent.call_fast(prompt, max_tokens=300, temperature=0.3)
        if raw and len(raw.strip()) > 20:
            return raw.strip()
    except Exception:
        pass

    # fallback: استخدم build_humanized_reason
    return build_humanized_reason(
        ticker=ticker,
        indicators={'rsi': rsi, 'macd_hist': macd_hist, 'volume_ratio': 1.0},
        pine_flags={'is_golden_pullback': early_trend_flag, 'is_dead_cat': False, 'is_bullish_divergence': False},
        sr_levels={'support': nearest_support, 'resistance': None},
        score=score,
        regime=trend,
    )


__all__ = [
    'build_humanized_reason',
    'build_humanized_signal_message',
    'is_rr_acceptable',
    'build_ai_narrative',
]
