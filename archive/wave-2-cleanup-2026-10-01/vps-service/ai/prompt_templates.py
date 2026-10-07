#!/usr/bin/env python3
"""
prompt_templates.py — قوالب البرومبت العربية الموحّدة للـ AI المحلي (glm-fast)
=============================================================================
GLM-FAST-UNIFY: المصدر المركزي لكل نصوص البرومبت المُمرّرة لـ Ollama.

يحتوي على:
  1. SYSTEM_PROMPT          — ثابت، يُمرّر في كل استدعاء (anti-hallucination).
  2. build_single_rec_prompt()  — توصية سهم واحد (decision + confidence + narrative).
  3. build_daily_summary_prompt() — ملخص يومي / جرس الصباح (عدة أسهم).
  4. build_sanity_check_prompt()  — فحص تعارض الإشارات.

القاعدة الذهبية (per Protocol):
  الأرقام (سعر/هدف/وقف/Score/R:R) من المحركات الرقمية فقط.
  الـ AI يقرر/يشرح/يرجّح بالاعتماد على هذه الأرقام — لا يختلق ولا يعدّل.

Usage:
    from ai.prompt_templates import SYSTEM_PROMPT, build_single_rec_prompt
    agent = GlmFinanceAgent(system_prompt=SYSTEM_PROMPT)
    prompt = build_single_rec_prompt(ticker="COMI", recommendation="شراء", ...)
    raw = agent.call_fast(prompt)
"""
import json
from typing import Optional, List, Dict, Any


# ============================================================================
# 1) SYSTEM PROMPT — ثابت لكل استدعاء (حماية مزدوجة مع Modelfile.qwen)
# ============================================================================
SYSTEM_PROMPT = (
    "أنت محلل أسواق مالية محلي لمنصة استثمار تركز على البورصة المصرية والأسواق العربية.\n\n"
    "قواعد صارمة:\n"
    "1) لا تغيّر أي رقم يُمرّر إليك (سعر الدخول، الهدف، وقف الخسارة، النسبة، الـ Score، R:R).\n"
    "2) لا تختلق أسعارًا أو نسبًا أو بيانات غير موجودة في المدخلات.\n"
    "3) إذا نقصت بيانات مهمة، قل صراحة: «التحليل غير مكتمل» ولا تكمل بأرقام من عندك.\n"
    "4) اعتمد فقط على المؤشرات والسياق الممرَّر في الرسالة.\n"
    "5) الأرقام والحسابات صادرة من محركات رقمية؛ دورك: تفسير، ترجيح، وصياغة قرار واضح.\n"
    "6) اكتب بالعربية الفصحى البسيطة والواضحة، باختصار ومن دون حشو.\n"
    "7) لا تقدم ضمان ربح. اذكر أن الاستثمار ينطوي على مخاطر."
)


# ============================================================================
# 2) USER PROMPT — توصية سهم واحد (Decision + Narrative)
# ============================================================================
def build_single_rec_prompt(
    ticker: str,
    name: str = "",
    market: str = "EGX",
    persona: str = "",
    recommendation: str = "",
    score: Optional[float] = None,
    entry: Optional[float] = None,
    target: Optional[float] = None,
    stop: Optional[float] = None,
    rr: Optional[float] = None,
    horizon: str = "",
    regime: str = "",
    momentum_liquidity: str = "",
    fundamentals_brief: str = "",
    dna_brief: str = "",
    key_reasons: str = "",
) -> str:
    """يبني برومبت توصية سهم واحد وفق القالب المعتمد.

    الـ AI يرجع JSON:
      decision, confidence, agree_with_engine, summary, reasons[],
      risk, note, disclaimer
    """
    return f"""حلّل التوصية التالية دون تغيير أي رقم.

[بيانات السهم]
- الرمز: {ticker}
- الاسم: {name or '—'}
- السوق: {market}
- الشخصية: {persona or 'متوازن'}

[أرقام نهائية — لا تعدّلها]
- التوصية الرقمية: {recommendation or '—'}
- درجة التقييم: {score if score is not None else '—'}
- سعر الدخول: {entry if entry is not None else '—'}
- الهدف: {target if target is not None else '—'}
- وقف الخسارة: {stop if stop is not None else '—'}
- العائد/المخاطرة R:R: {rr if rr is not None else '—'}
- أفق الاستثمار: {horizon or '—'}

[سياق مختصر]
- نظام السوق: {regime or '—'}
- الزخم/السيولة: {momentum_liquidity or '—'}
- أساسيات (إن وجدت): {fundamentals_brief or '—'}
- DNA/سلوك السهم (إن وجد): {dna_brief or '—'}
- أهم الأسباب الرقمية: {key_reasons or '—'}

المطلوب — أرجع JSON فقط بهذا الشكل:
{{
  "decision": "شراء قوي | شراء | انتظار | تقليل | بيع",
  "confidence": 0-100,
  "agree_with_engine": true,
  "summary": "جملة واحدة واضحة للتوصية",
  "reasons": ["سبب 1", "سبب 2", "سبب 3"],
  "risk": "مخاطرة واحدة محددة",
  "note": "ملاحظة قصيرة أو تحذير إن وجد تعارض",
  "disclaimer": "الاستثمار ينطوي على مخاطر وقد تتعرض لخسارة رأس المال"
}}

ملاحظات:
- confidence تعكس قوة اتساق البيانات المعطاة، لا تخمّن خارجها.
- إذا كانت التوصية الرقمية ضعيفة أو البيانات ناقصة: خفّض confidence ووضح ذلك في note.
- لا تضف أي حقول أرقام جديدة غير المطلوبة."""


# ============================================================================
# 3) USER PROMPT — ملخص يومي / جرس الصباح (عدة أسهم)
# ============================================================================
def build_daily_summary_prompt(
    market: str,
    persona: str,
    date: str,
    opportunities: List[Dict[str, Any]],
) -> str:
    """يبني برومبت الملخص اليومي لعدة فرص.

    Args:
        opportunities: قائمة dicts، كل عنصر يحتوي:
            ticker, recommendation, score, entry, target, stop, horizon

    الـ AI يرجع JSON:
      market_mood, top_picks[], avoid_or_weak, closing
    """
    opps_json = json.dumps(opportunities, ensure_ascii=False, indent=2)

    return f"""أنت تلخّص فرص اليوم بدون تغيير أي رقم.

السوق: {market}
الشخصية: {persona}
التاريخ: {date}

قائمة الفرص (مرتبة كما هي):
{opps_json}

كل عنصر يحتوي: ticker, recommendation, score, entry, target, stop, horizon

المطلوب — أرجع JSON فقط:
{{
  "market_mood": "جملة قصيرة عن مزاج السوق من القائمة فقط",
  "top_picks": [
    {{
      "ticker": "...",
      "one_liner": "سطر واحد لماذا هذه الفرصة بارزة",
      "caution": "تحذير قصير إن لزم"
    }}
  ],
  "avoid_or_weak": "جملة اختيارية عن أضعف الإشارات إن ظهرت في القائمة",
  "closing": "جملة ختامية محايدة بدون وعود"
}}

قواعد:
- لا تختلق أسهمًا غير موجودة في القائمة.
- لا تغيّر ترتيب الأهمية إلا إذا ذكرت أنك توضّح فقط دون إعادة ترتيب الأرقام.
- لا تذكر أسعارًا غير الواردة في المدخلات."""


# ============================================================================
# 4) USER PROMPT — Sanity Check (تعارض الإشارات)
# ============================================================================
def build_sanity_check_prompt(
    ticker: str,
    recommendation: str,
    score: Optional[float],
    tech_signal: str = "",
    volume_signal: str = "",
    fundamental_signal: str = "",
    dna_signal: str = "",
    regime: str = "",
) -> str:
    """يبني برومبت فحص التعارض بين الإشارات.

    الـ AI يرجع JSON:
      has_conflict, severity, suggestion, confidence_adjustment, explanation
    """
    return f"""افحص التعارض التالي دون تغيير الأرقام.

الرمز: {ticker}
التوصية الرقمية: {recommendation}
الدرجة: {score if score is not None else '—'}

إشارات قد تتعارض:
- تقني: {tech_signal or '—'}
- سيولة/زخم: {volume_signal or '—'}
- أساسيات: {fundamental_signal or '—'}
- DNA/سلوك: {dna_signal or '—'}
- نظام السوق: {regime or '—'}

أرجع JSON فقط:
{{
  "has_conflict": true,
  "severity": "وصف التعارض بجملة أو جملتين",
  "suggestion": "انتظار | تقليل الحجم | الالتزام بالتوصية الرقمية بحذر",
  "confidence_adjustment": -20,
  "explanation": "شرح مختصر للمستثمر"
}}

لا تقترح أسعار دخول/هدف/وقف جديدة.
confidence_adjustment يجب أن يكون بين -20 و 0."""


# ============================================================================
# JSON SCHEMA المرجعي (للتوثيق والتحقق)
# ============================================================================
SINGLE_REC_SCHEMA = {
    "decision": "str — شراء قوي | شراء | انتظار | تقليل | بيع",
    "confidence": "int 0-100",
    "agree_with_engine": "bool",
    "summary": "str — جملة واحدة",
    "reasons": "list[str] — 3 أسباب",
    "risk": "str — مخاطرة محددة",
    "note": "str — ملاحظة/تحذير",
    "disclaimer": "str — إخلاء مسؤولية",
}

DAILY_SUMMARY_SCHEMA = {
    "market_mood": "str",
    "top_picks": "list[{ticker, one_liner, caution}]",
    "avoid_or_weak": "str",
    "closing": "str",
}

SANITY_CHECK_SCHEMA = {
    "has_conflict": "bool",
    "severity": "str",
    "suggestion": "str",
    "confidence_adjustment": "int (-20 to 0)",
    "explanation": "str",
}


__all__ = [
    "SYSTEM_PROMPT",
    "build_single_rec_prompt",
    "build_daily_summary_prompt",
    "build_sanity_check_prompt",
    "SINGLE_REC_SCHEMA",
    "DAILY_SUMMARY_SCHEMA",
    "SANITY_CHECK_SCHEMA",
]
