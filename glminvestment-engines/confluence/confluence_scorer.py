"""
confluence/confluence_scorer.py — محرك التلاقي v3
====================================================
المصدر: Curtis Faith "Way of the Turtle" + منهجية المؤلفين عموماً

الفلسفة:
    "لا توجد أداة واحدة تكفي." أي مؤشر لحاله بيطلع إشارات كاذبة.
    القوة الحقيقية في التلاقي (Confluence): لما 3-5 استراتيجيات
    مختلفة بتشير لنفس الاتجاه، احتمالية النجاح بترتفع dramatically.

    محرك ده بياخد نتائج كل المحركات وبيخلطها بأوزان موزونة:
      - Stage 2 (Minervini):   وزن 30% — الفلتر الأهم (ممنوع شراء هابط)
      - VCP (Minervini):       وزن 25% — أعلى جودة صفقة
      - ATR Risk (Wilder):     وزن 20% — إدارة المخاطر
      - Donchian (Covel):      وزن 15% — تأكيد الاتجاه
      - Persona/seasonality:   وزن 10% — سياق (يُحقن من بره)

قواعد القرار النهائي:
    STRONG_BUY   = score ≥ 80 + على الأقل 3 محركات BUY/STRONG_BUY
    BUY          = score ≥ 60 + على الأقل 2 محركات BUY
    NEUTRAL      = score 40-60
    AVOID        = score 20-40 أو أي Stage 4
    STRONG_AVOID = score < 20 أو Stage 4 مؤكد

Veto Power (حق النقض):
    Stage 4 (هبوط) = STRONG_AVOID فوراً مهما كانت المحركات التانية.
    مفيش أي صفقة شراء في اتجاه هابط — دي قاعدة Minervini الصارمة.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from core.base import (
    EngineResult, RiskPlan, Signal, SignalType, Timeframe,
)
from engines.stage2_filter import analyze as analyze_stage2
from engines.vcp_detector import analyze as analyze_vcp
from engines.atr_risk_engine import analyze as analyze_atr_risk
from engines.donchian_breakout import analyze as analyze_donchian


# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ConfluenceConfig:
    """أوزان المحركات في القرار النهائي (المجموع = 1.0)."""
    # الأوزان
    weight_stage2: float = 0.30       # الفلتر الأهم
    weight_vcp: float = 0.25          # جودة الصفقة
    weight_atr_risk: float = 0.20     # إدارة المخاطر
    weight_donchian: float = 0.15     # تأكيد الاتجاه
    weight_external: float = 0.10     # persona/seasonality (يُحقن)
    # عتبات القرار
    strong_buy_score: float = 80.0
    strong_buy_min_engines: int = 3   # 3+ محركات BUY/STRONG_BUY
    buy_score: float = 60.0
    buy_min_engines: int = 2
    neutral_score: float = 40.0
    avoid_score: float = 20.0
    # معاملات تحويل الإشارة لـ score
    signal_score_map: dict = field(default_factory=lambda: {
        SignalType.STRONG_BUY: 100.0,
        SignalType.BUY: 70.0,
        SignalType.NEUTRAL: 50.0,
        SignalType.AVOID: 20.0,
        SignalType.STRONG_AVOID: 0.0,
    })


# ──────────────────────────────────────────────────────────────────────────
# Engine weights (computed from config)
# ──────────────────────────────────────────────────────────────────────────

def _engine_weights(cfg: ConfluenceConfig) -> dict[str, float]:
    """خريطة اسم المحرك → وزنه."""
    return {
        "stage2": cfg.weight_stage2,
        "vcp": cfg.weight_vcp,
        "atr_risk": cfg.weight_atr_risk,
        "donchian": cfg.weight_donchian,
        "external": cfg.weight_external,
    }


# ──────────────────────────────────────────────────────────────────────────
# Main confluence function
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class ConfluenceResult:
    """نتيجة محرك التلاقي."""
    symbol: str
    final_signal: SignalType
    final_score: float                  # 0-100
    final_confidence: float             # 0-1
    risk_plan: Optional[RiskPlan]       # لو فيه صفقة محتملة
    engine_results: dict[str, EngineResult]  # نتائج كل محرك
    aligned_buy_engines: int            # عدد المحركات اللي قالت BUY/STRONG_BUY
    veto_reason: Optional[str] = None   # لو فيه veto
    reason: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "final_signal": self.final_signal.value,
            "final_score": round(self.final_score, 2),
            "final_confidence": round(self.final_confidence, 4),
            "aligned_buy_engines": self.aligned_buy_engines,
            "veto_reason": self.veto_reason,
            "reason": self.reason,
            "has_risk_plan": self.risk_plan is not None,
            "engines": {k: v.to_dict() for k, v in self.engine_results.items()},
            "metadata": self.metadata,
        }


def analyze(
    df,
    symbol: str,
    persona: str = "investor",
    account_size: float = 100_000.0,
    entry_price: Optional[float] = None,
    external_signal: Optional[EngineResult] = None,
    config: Optional[ConfluenceConfig] = None,
) -> ConfluenceResult:
    """
    شغّل كل المحركات ودمّج نتائجها.

    Args:
        df: OHLCV DataFrame
        symbol: رمز السهم
        persona: "scalper" | "investor"
        account_size: رأس المال (لحساب الـ risk plan)
        entry_price: سعر الدخول المقترح (افتراضي = آخر إغلاق)
        external_signal: إشارة خارجية (persona/seasonality) — اختياري
        config: إعدادات الأوزان

    Returns:
        ConfluenceResult فيه القرار النهائي + خطة المخاطر + تفاصيل كل محرك
    """
    cfg = config or ConfluenceConfig()

    # سعر الدخول = آخر إغلاق لو مش محدد
    if entry_price is None:
        entry_price = float(df["close"].iloc[-1])

    # ── شغّل كل المحركات ──
    results: dict[str, EngineResult] = {}
    results["stage2"] = analyze_stage2(df, symbol)
    results["vcp"] = analyze_vcp(df, symbol)
    results["atr_risk"] = analyze_atr_risk(df, symbol, entry_price, persona, account_size)
    results["donchian"] = analyze_donchian(df, symbol)
    if external_signal is not None:
        results["external"] = external_signal

    # ── Veto: Stage 4 = رفض فوري ──
    stage2_result = results["stage2"]
    stage2_stage = stage2_result.signal.metadata.get("stage", 0)

    if stage2_stage == 4:
        return ConfluenceResult(
            symbol=symbol,
            final_signal=SignalType.STRONG_AVOID,
            final_score=0.0,
            final_confidence=0.95,
            risk_plan=None,
            engine_results=results,
            aligned_buy_engines=0,
            veto_reason="VETO: Stage 4 (هبوط) — ممنوع الشراء نهائياً",
            reason="السهم في مرحلة هبوط. أي إشارة شراء تُرفض فوراً (قاعدة Minervini).",
            metadata={"veto": True, "stage": 4},
        )

    # ── احسب الـ score الموزون ──
    weights = _engine_weights(cfg)
    total_weight_used = 0.0
    weighted_score = 0.0
    aligned_buy = 0  # عدد المحركات BUY/STRONG_BUY

    for engine_name, result in results.items():
        weight = weights.get(engine_name, 0.0)
        if weight <= 0:
            continue
        signal_type = result.signal.signal_type
        engine_score = cfg.signal_score_map.get(signal_type, 50.0)
        weighted_score += engine_score * weight
        total_weight_used += weight

        if signal_type in (SignalType.STRONG_BUY, SignalType.BUY):
            aligned_buy += 1

    # normalize (لو external مش موجود، نقسم على total_weight_used)
    final_score = weighted_score / total_weight_used if total_weight_used > 0 else 50.0

    # ── القرار النهائي ──
    if final_score >= cfg.strong_buy_score and aligned_buy >= cfg.strong_buy_min_engines:
        final_signal = SignalType.STRONG_BUY
        final_confidence = min(0.95, final_score / 100.0)
        reason = (
            f"تلاقي قوي: score={final_score:.1f}/100، {aligned_buy} محركات متفقة. "
            f"صفقة عالية الجودة — تنفيذ موصى به."
        )
    elif final_score >= cfg.buy_score and aligned_buy >= cfg.buy_min_engines:
        final_signal = SignalType.BUY
        final_confidence = min(0.80, final_score / 100.0)
        reason = (
            f"تلاقي جيد: score={final_score:.1f}/100، {aligned_buy} محركات متفقة. "
            f"صفقة مقبولة — تنفيذ بحجم مناسب."
        )
    elif final_score >= cfg.neutral_score:
        final_signal = SignalType.NEUTRAL
        final_confidence = 0.45
        reason = (
            f"إشارات مختلطة: score={final_score:.1f}/100، {aligned_buy} محركات متفقة. "
            f"انتظر تلاقي أوضح."
        )
    elif final_score >= cfg.avoid_score:
        final_signal = SignalType.AVOID
        final_confidence = 0.60
        reason = (
            f"إشارات سلبية: score={final_score:.1f}/100. تجنّب."
        )
    else:
        final_signal = SignalType.STRONG_AVOID
        final_confidence = 0.75
        reason = (
            f"رفض قاطع: score={final_score:.1f}/100. مخاطرة عالية."
        )

    # ── خطة المخاطر (لو فيه BUY) ──
    risk_plan = None
    if final_signal in (SignalType.STRONG_BUY, SignalType.BUY):
        risk_plan = results["atr_risk"].risk_plan

    # ── metadata ──
    metadata = {
        "final_score": round(final_score, 2),
        "aligned_buy_engines": aligned_buy,
        "total_engines_run": len(results),
        "weights": weights,
        "persona": persona,
        "entry_price": entry_price,
        "engine_scores": {
            name: round(cfg.signal_score_map.get(r.signal.signal_type, 50.0), 1)
            for name, r in results.items()
        },
    }

    return ConfluenceResult(
        symbol=symbol,
        final_signal=final_signal,
        final_score=final_score,
        final_confidence=final_confidence,
        risk_plan=risk_plan,
        engine_results=results,
        aligned_buy_engines=aligned_buy,
        reason=reason,
        metadata=metadata,
    )
