"""
integration/expert_gate_patch.py — تعديل expert_quality_gate.py
==============================================================
الهدف: إضافة فلتر Stage 2 + VCP كـ hard veto في الـ Expert Gate.

الطريقة: قبل ما الـ gate يوافق على أي إشارة BUY، لازم يتأكد إن:
  1) السهم في Stage 2 (مش Stage 1/3/4)
  2) لو فيه VCP → يرفع الثقة
  3) لو Stage 4 → رفض فوري (حتى لو باقي المؤشرات إيجابية)

طريقة الاستخدام:
    انسخ الدوال دي لـ expert_quality_gate.py، أو importها واستخدمها
    في الـ evaluate() بتاعتك.

ملاحظة: المسارات كلها نسبية — استخدم BASE_DIR من إعدادات مشروعك.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import pandas as pd

# ── استيراد المحركات الجديدة ──
# عدّل المسار حسب مكان وضعك للحزمة في مشروعك
# الخيار الموصى به: ضع حزمة expert_engines/ في vps-service/analyzers/
ENGINES_PATH = Path(__file__).parent.parent  # = مجلد الحزمة
if str(ENGINES_PATH) not in sys.path:
    sys.path.insert(0, str(ENGINES_PATH))

from engines.stage2_filter import analyze as analyze_stage2, classify_stage
from engines.vcp_detector import analyze as analyze_vcp
from core.base import SignalType, EngineResult


# ──────────────────────────────────────────────────────────────────────────
# Hard veto filter — يُستدعى في بداية evaluate()
# ──────────────────────────────────────────────────────────────────────────

def stage2_veto_check(
    df: pd.DataFrame,
    symbol: str,
    proposed_signal: str,  # "BUY" | "SELL" | "HOLD"
) -> Optional[dict]:
    """
    فلتر المرحلة الثانية — حق النقض على أي إشارة شراء.

    يُستدعى في بداية ExpertGate.evaluate() قبل أي تحليل آخر.

    Returns:
        None لو الإشارة سليمة (تمر)
        dict بـ {reject: True, reason, stage} لو لازم تُرفض
    """
    # لو الإشارة مش BUY، مفيش حاجة نعملها
    if proposed_signal != "BUY":
        return None

    # شغّل فلتر Stage 2
    result = analyze_stage2(df, symbol)
    stage = result.signal.metadata.get("stage", 0)

    # Stage 4: هبوط → رفض قاطع
    if stage == 4:
        return {
            "reject": True,
            "reason": f"REJECTED (Stage 4 هبوط): {result.signal.reason}",
            "stage": stage,
            "engine": "stage2_veto",
        }

    # Stage 3: قمة → رفض تحفظي
    if stage == 3:
        return {
            "reject": True,
            "reason": f"REJECTED (Stage 3 قمة/توزيع): {result.signal.reason}",
            "stage": stage,
            "engine": "stage2_veto",
        }

    # Stage 1: تجميع → رفض (مش وقت الشراء)
    if stage == 1:
        return {
            "reject": True,
            "reason": f"REJECTED (Stage 1 تجميع — انتظر Stage 2): {result.signal.reason}",
            "stage": stage,
            "engine": "stage2_veto",
        }

    # Stage 2: سليم — مرّر الإشارة
    return None


# ──────────────────────────────────────────────────────────────────────────
# VCP confidence booster — يُستدعى لو الإشارة عدت الـ veto
# ──────────────────────────────────────────────────────────────────────────

def vcp_confidence_boost(df: pd.DataFrame, symbol: str, base_confidence: float) -> dict:
    """
    لو فيه VCP، ارفع ثقة الإشارة. ده مش veto، ده bonus.

    Returns:
        {boosted: bool, new_confidence, vcp_score, reason}
    """
    result = analyze_vcp(df, symbol)
    metadata = result.signal.metadata

    if not metadata.get("found", False):
        return {
            "boosted": False,
            "new_confidence": base_confidence,
            "vcp_score": metadata.get("score", 0),
            "reason": "لا يوجد VCP — الثقة كما هي",
        }

    vcp_score = metadata.get("score", 0)
    # كل ما الـ VCP score أعلى، كل ما الـ boost أكبر
    # boost = +0.15 لو score=100، +0.075 لو score=50
    boost = (vcp_score / 100.0) * 0.15
    new_confidence = min(0.98, base_confidence + boost)

    return {
        "boosted": True,
        "new_confidence": round(new_confidence, 4),
        "vcp_score": vcp_score,
        "reason": f"VCP detected (score={vcp_score}) — confidence boosted +{boost:.3f}",
    }


# ──────────────────────────────────────────────────────────────────────────
# مثال: دمج في evaluate() الحالية
# ──────────────────────────────────────────────────────────────────────────

def patched_evaluate_example(df: pd.DataFrame, symbol: str, proposed_buy: dict) -> dict:
    """
    مثال على شكل evaluate() بعد التعديل.

    BEFORE (الكود القديم):
        def evaluate(df, symbol, proposed_buy):
            if proposed_buy['signal'] == 'BUY':
                # ... فحوصاتك القديمة ...
                return {'approved': True, ...}
            return {'approved': False, 'reason': 'not a buy'}

    AFTER (بعد التعديل):
    """
    # ── Step 1: Stage 2 hard veto ──
    veto = stage2_veto_check(df, symbol, proposed_buy.get("signal", ""))
    if veto is not None:
        return {
            "approved": False,
            "rejected": True,
            "reason": veto["reason"],
            "stage": veto["stage"],
            "rejecting_engine": "stage2_veto",
        }

    # ── Step 2: فحوصاتك القديمة (defensive filter, etc.) ──
    # ... الكود القديم هنا ...

    # ── Step 3: VCP confidence boost ──
    base_confidence = proposed_buy.get("confidence", 0.5)
    vcp_result = vcp_confidence_boost(df, symbol, base_confidence)

    # ── Step 4: الموافقة ──
    return {
        "approved": True,
        "rejected": False,
        "confidence": vcp_result["new_confidence"],
        "vcp_score": vcp_result["vcp_score"],
        "vcp_boosted": vcp_result["boosted"],
        "reason": f"Approved. {vcp_result['reason']}",
    }
