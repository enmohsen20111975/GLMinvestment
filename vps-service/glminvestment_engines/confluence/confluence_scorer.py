"""
confluence/confluence_scorer.py — محرك التلاقي v4 (Trend-Following + EGX30)
=============================================================================
المصدر: Curtis Faith "Way of the Turtle" + منهجية المؤلفين عموماً

الفلسفة:
    "لا توجد أداة واحدة تكفي." أي مؤشر لحاله بيطلع إشارات كاذبة.
    القوة الحقيقية في التلاقي (Confluence): لما 3-5 استراتيجيات
    مختلفة بتشير لنفس الاتجاه، احتمالية النجاح بترتفع dramatically.

    محرك ده بياخد نتائج كل المحركات وبيخلطها بأوزان موزونة:
      - Donchian (Covel):      وزن 30% — تأكيد الاتجاه (الإشارة الأساسية للتتبع)
      - ATR Risk (Wilder):     وزن 25% — إدارة المخاطر
      - Stage 2 (Minervini):   وزن 20% — فلتر المرحلة
      - VCP (Minervini):       وزن 10% — جودة الصفقة (أقل وزن في trend-following)
      - Persona/seasonality:   وزن 15% — سياق (يُحقن من بره)

EGX30 Hard Gate (بوابة صارمة):
    قبل أي تحليل:
      - EGX30 < SMA(200)     → STRONG_AVOID فوراً (ممنوع التداول في اتجاه هابط)
      - EGX30 > SMA(200) AND SMA(50) > SMA(200)  → Stage 2، إذن كامل
      - غير ذلك              → Stage 1/3، تقليل حجم الصفقة 50%

ADX Trend Strength Bonus:
    - ADX > 25 (اتجاه قوي)  → +5 نقاط إضافية
    - ADX < 15 (لا اتجاه)   → -10 نقاط (تجنب الأسهم الجانبية)

قواعد القرار النهائي (مُعدّلة للتتبع):
    STRONG_BUY   = score ≥ 75 + على الأقل 3 محركات BUY/STRONG_BUY
    BUY          = score ≥ 55 + على الأقل 2 محركات BUY
    NEUTRAL      = score 40-55
    AVOID        = score 20-40 أو أي Stage 4
    STRONG_AVOID = score < 20 أو Stage 4 مؤكد

Veto Power (حق النقض):
    EGX30 < SMA(200) أو Stage 4 (هبوط) = STRONG_AVOID فوراً.
    مفيش أي صفقة شراء في اتجاه هابط — دي قاعدة Trend-Following الصارمة.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from ..core.base import (
    EngineResult, RiskPlan, Signal, SignalType, Timeframe,
)
from ..engines.stage2_filter import analyze as analyze_stage2
from ..engines.vcp_detector import analyze as analyze_vcp
from ..engines.atr_risk_engine import analyze as analyze_atr_risk
from ..engines.donchian_breakout import analyze as analyze_donchian
from ..core.indicators import adx as calc_adx

try:
    from ...engines.market_regime import get_index_stage
except ImportError:
    try:
        from engines.market_regime import get_index_stage
    except ImportError:
        def get_index_stage(index_symbol="EGX30", target_date=None, lookback=300):
            return {"stage": 1, "reason": "Fallback", "close": 0.0, "sma200": 0.0, "sma50": 0.0}

try:
    from ...utils.db_paths import DBPaths
except ImportError:
    # P23-PORTABILITY: fallback نسبي من __file__ (مش hardcoded) عشان المحرك
    # يشتغل على اللابتوب / السيرفر الإنتاجي / الساندبوكس بدون تعديل.
    # confluence_scorer.py موجود في:
    #   <project_root>/vps-service/glminvestment_engines/confluence/confluence_scorer.py
    # فـ parents[3] = project_root (اللي فيه مجلد db/).
    from pathlib import Path as _P
    _PROJECT_ROOT = _P(__file__).resolve().parents[3]

    class DBPaths:
        PROJECT_ROOT = str(_PROJECT_ROOT)
        DATA_ENGINE_DB = str(_PROJECT_ROOT / "db" / "data_engine.db")
        STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")

import sqlite3


# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ConfluenceConfig:
    """أوزان المحركات في القرار النهائي (المجموع = 1.0) — محسّنة للتتبع."""
    # الأوزان (Donchian = الإشارة الأساسية للتتبع)
    weight_donchian: float = 0.30     # تأكيد الاتجاه — الإشارة الأساسية
    weight_atr_risk: float = 0.25     # إدارة المخاطر
    weight_stage2: float = 0.20       # فلتر المرحلة
    weight_vcp: float = 0.10          # جودة الصفقة (أقل وزن — mean-reversion)
    weight_external: float = 0.15     # persona/seasonality (يُحقن)
    # عتبات القرار (مُخفّضة لأن إشارات التتبع أندر)
    strong_buy_score: float = 75.0
    strong_buy_min_engines: int = 3   # 3+ محركات BUY/STRONG_BUY
    buy_score: float = 55.0
    buy_min_engines: int = 2
    neutral_score: float = 40.0
    avoid_score: float = 20.0
    # ADX trend strength consideration
    adx_strong_threshold: float = 25.0   # ADX فوق ده = اتجاه قوي
    adx_weak_threshold: float = 15.0     # ADX تحت ده = لا اتجاه
    adx_strong_bonus: float = 5.0        # +5 نقاط لو اتجاه قوي
    adx_weak_penalty: float = 10.0       # -10 نقاط لو لا اتجاه
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
        "donchian": cfg.weight_donchian,
        "atr_risk": cfg.weight_atr_risk,
        "stage2": cfg.weight_stage2,
        "vcp": cfg.weight_vcp,
        "external": cfg.weight_external,
    }


# ──────────────────────────────────────────────────────────────────────────
# EGX30 regime check
# ──────────────────────────────────────────────────────────────────────────

def _check_egx30_regime(symbol: str, df) -> dict:
    """
    فحص نظام EGX30 كبوابة صارمة قبل أي تحليل.

    Returns:
        dict with keys:
            - is_egx: bool
            - egx30_stage: int (1-4) or None
            - egx30_close: float or None
            - egx30_sma200: float or None
            - egx30_sma50: float or None
            - hard_avoid: bool (True = must STRONG_AVOID)
            - reduce_position: bool (True = cut size 50%)
            - reason: str
    """
    result = {
        "is_egx": False,
        "egx30_stage": None,
        "egx30_close": None,
        "egx30_sma200": None,
        "egx30_sma50": None,
        "hard_avoid": False,
        "reduce_position": False,
        "reason": "",
    }

    # Determine if the symbol is EGX-listed
    market = None
    try:
        conn = sqlite3.connect(DBPaths.DATA_ENGINE_DB, timeout=5.0)
        row = conn.execute("SELECT market FROM stocks WHERE symbol=?", (symbol,)).fetchone()
        if row:
            market = row[0]
        else:
            conn2 = sqlite3.connect(DBPaths.STOCKS_DB, timeout=5.0)
            row2 = conn2.execute("SELECT market FROM stocks WHERE ticker=?", (symbol,)).fetchone()
            if row2:
                market = row2[0]
            conn2.close()
        conn.close()
    except Exception:
        pass

    is_egx = (
        market in ('مصر', 'EGX', 'egx')
        or (market is None and not symbol.isdigit() and len(symbol) <= 5 and symbol.isupper())
    )
    result["is_egx"] = is_egx

    if not is_egx:
        result["reason"] = "Not an EGX stock — EGX30 gate not applied"
        return result

    # Fetch EGX30 regime info
    try:
        target_date = str(df.index[-1].date()) if hasattr(df.index[-1], 'date') else None
        egx30_info = get_index_stage("EGX30", target_date)
        if not egx30_info:
            result["reason"] = "Could not fetch EGX30 data — allowing with caution"
            return result

        egx30_close = egx30_info.get("close", 0.0) or 0.0
        egx30_sma200 = egx30_info.get("sma200", 0.0) or 0.0
        egx30_sma50 = egx30_info.get("sma50", 0.0) or 0.0
        egx30_stage = egx30_info.get("stage", 0)

        result["egx30_close"] = egx30_close
        result["egx30_sma200"] = egx30_sma200
        result["egx30_sma50"] = egx30_sma50

        # Hard gate: EGX30 < SMA(200) → no trades at all
        if egx30_sma200 > 0 and egx30_close < egx30_sma200:
            result["egx30_stage"] = 4
            result["hard_avoid"] = True
            result["reason"] = (
                f"EGX30={egx30_close:.0f} < SMA(200)={egx30_sma200:.0f} — "
                f"اتجاه هابط، ممنوع التداول (Trend-Following hard gate)"
            )
            return result

        # Stage 2: EGX30 > SMA(200) AND SMA(50) > SMA(200) → full permission
        if egx30_close > egx30_sma200 and egx30_sma50 > egx30_sma200:
            result["egx30_stage"] = 2
            result["reason"] = (
                f"EGX30={egx30_close:.0f} > SMA(200)={egx30_sma200:.0f}, "
                f"SMA(50)={egx30_sma50:.0f} > SMA(200) — Stage 2، إذن كامل"
            )
            return result

        # Stage 1/3: EGX30 above SMA(200) but SMA(50) < SMA(200), or other
        # → reduce position size by 50%
        result["egx30_stage"] = egx30_stage if egx30_stage in (1, 3) else 1
        result["reduce_position"] = True
        result["reason"] = (
            f"EGX30={egx30_close:.0f}, SMA(200)={egx30_sma200:.0f}, "
            f"SMA(50)={egx30_sma50:.0f} — Stage {result['egx30_stage']}، "
            f"تقليل حجم الصفقة 50%"
        )

    except Exception as e:
        result["reason"] = f"Error checking EGX30 regime: {e} — allowing with caution"

    return result


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
    egx30_stage: Optional[int] = None   # مرحلة EGX30 (1-4) أو None
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
            "egx30_stage": self.egx30_stage,
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
    شغّل كل المحركات ودمّج نتائجها — مع بوابة EGX30 وADX.

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

    # ── EGX30 Hard Gate — قبل أي تحليل ──
    egx30_gate = _check_egx30_regime(symbol, df)

    if egx30_gate["hard_avoid"]:
        return ConfluenceResult(
            symbol=symbol,
            final_signal=SignalType.STRONG_AVOID,
            final_score=0.0,
            final_confidence=0.95,
            risk_plan=None,
            engine_results={},
            aligned_buy_engines=0,
            egx30_stage=egx30_gate["egx30_stage"],
            veto_reason=f"VETO: {egx30_gate['reason']}",
            reason="المؤشر العام EGX30 تحت SMA(200). أي صفقة شراء تُرفض فوراً — نظام Trend-Following لا يتداول في اتجاه هابط.",
            metadata={
                "veto": True,
                "egx30_stage": egx30_gate["egx30_stage"],
                "egx30_close": egx30_gate["egx30_close"],
                "egx30_sma200": egx30_gate["egx30_sma200"],
            },
        )

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

    # ── EGX30 Stage 4 veto (legacy check — keeps existing Stage 4 logic) ──
    if egx30_gate["is_egx"] and egx30_gate["egx30_stage"] == 4:
        # Already handled by hard gate above, but as a safety net
        return ConfluenceResult(
            symbol=symbol,
            final_signal=SignalType.STRONG_AVOID,
            final_score=0.0,
            final_confidence=0.95,
            risk_plan=None,
            engine_results=results,
            aligned_buy_engines=0,
            egx30_stage=4,
            veto_reason="VETO: EGX30 Bear Market (Stage 4) — ممنوع الشراء نهائياً",
            reason="المؤشر العام EGX30 في مرحلة هبوط (Stage 4). أي إشارة شراء في البورصة المصرية تُرفض فوراً لحماية رأس المال.",
            metadata={"veto": True, "egx30_stage": 4},
        )

    if stage2_stage == 4:
        return ConfluenceResult(
            symbol=symbol,
            final_signal=SignalType.STRONG_AVOID,
            final_score=0.0,
            final_confidence=0.95,
            risk_plan=None,
            engine_results=results,
            aligned_buy_engines=0,
            egx30_stage=egx30_gate["egx30_stage"],
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

    # ── ADX Trend Strength Consideration ──
    adx_value = None
    adx_adjustment = 0.0
    try:
        if isinstance(df, pd.DataFrame) and len(df) >= 28:
            adx_df = calc_adx(df, period=14)
            if not adx_df.empty and 'adx' in adx_df.columns:
                last_adx = adx_df['adx'].iloc[-1]
                if pd.notna(last_adx):
                    adx_value = float(last_adx)
                    if adx_value > cfg.adx_strong_threshold:
                        adx_adjustment = cfg.adx_strong_bonus
                    elif adx_value < cfg.adx_weak_threshold:
                        adx_adjustment = -cfg.adx_weak_penalty
    except Exception as e:
        # ADX computation failed — don't adjust score, just log
        print(f"Warning: ADX computation failed for {symbol}: {e}")

    final_score = max(0.0, min(100.0, final_score + adx_adjustment))

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
    risk_plan = results["atr_risk"].risk_plan
    if final_signal in (SignalType.STRONG_BUY, SignalType.BUY) and risk_plan is not None:
        # If EGX30 is Stage 1/3, reduce position size by 50%
        if egx30_gate["reduce_position"]:
            risk_plan = RiskPlan(
                entry_price=risk_plan.entry_price,
                stop_loss=risk_plan.stop_loss,
                position_size_pct=risk_plan.position_size_pct * 0.5,
                shares=risk_plan.shares,
                risk_per_share=risk_plan.risk_per_share,
                risk_reward_ratio=risk_plan.risk_reward_ratio,
                take_profit_tiers=risk_plan.take_profit_tiers,
                trailing_stop_method=risk_plan.trailing_stop_method,
            )

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
        "adx_value": adx_value,
        "adx_adjustment": adx_adjustment,
        "egx30_stage": egx30_gate["egx30_stage"],
        "egx30_reduce_position": egx30_gate["reduce_position"],
    }

    return ConfluenceResult(
        symbol=symbol,
        final_signal=final_signal,
        final_score=final_score,
        final_confidence=final_confidence,
        risk_plan=risk_plan,
        engine_results=results,
        aligned_buy_engines=aligned_buy,
        egx30_stage=egx30_gate["egx30_stage"],
        reason=reason,
        metadata=metadata,
    )
