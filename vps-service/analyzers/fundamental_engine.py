#!/usr/bin/env python3
"""
Fundamental Catalyst Engine — محرك التحليل الأساسي (The Gatekeeper)
=====================================================================
المحرك الأساسي الجديد اللي بيقرأ البيانات المالية من data_engine.db
ويبني قرار الاستثمار على الأساسيات قبل الفني.


الفرق عن EnhancedFundamentalAnalyzer:
- EnhancedFundamentalAnalyzer بياخد البيانات من stocks.db (أعمدة فاضية!)
- FundamentalEngine بياخد البيانات من data_engine.db (8 جداول كاملة)

الفرق عن FundamentalDataProvider:
- FundamentalDataProvider بيقرأ البيانات ويحسب درجات
- FundamentalEngine بيضيف فوقها منطق الـ Gatekeeper (رفض/قبول السهم)

الوظيفة:
1. get_fundamental_score(ticker) → درجة 0-100
2. is_fundamentally_healthy(ticker) → True لو الدرجة >= 40
3. get_fundamental_breakdown(ticker) → تفاصيل القرار

الاستخدام في master_analyzer.py:
    from analyzers.fundamental_engine import FundamentalEngine
    fund_engine = FundamentalEngine()
    if not fund_engine.is_fundamentally_healthy(ticker):
        return MasterAnalysis(signal='REJECTED_FUNDAMENTALS', ...)
    fund_score = fund_engine.get_fundamental_score(ticker)
    final_score = (tech_score * 0.60) + (fund_score * 0.40)

Author: The Fundamental Catalyst Shift (يوليو 2026)
"""

from __future__ import annotations

import logging
from typing import Dict, Optional, Tuple, List
from dataclasses import dataclass, field

# الاستيراد من المزوّد الموجود (بيقرأ من data_engine.db)
from analyzers.fundamental_data_provider import (
    FundamentalDataProvider,
    FundamentalData,
    DATA_ENGINE_DB,
)

logger = logging.getLogger(__name__)


# ============================================================================
# الثوابت — عتبات القرار الأساسي
# ============================================================================

# الحد الأدنى لاعتبار السهم "صحياً أساسياً"
# لو الدرجة أقل من كده → السهم ضعيف (خسران/غالي/مديونيته عالية) → ارفضه
FUNDAMENTAL_HEALTH_THRESHOLD = 40.0

# الدرجة اللي بترجع لما مفيش بيانات خالص (مش 0 عشان نفرّق بين "مفيش بيانات"
# و "بيانات سيئة جداً")
NO_DATA_SCORE = 0.0

# أوزان الدمج النهائي (Fundamental Catalyst Shift)
# الأساسيات بتاخد 40% من القرار، والشارت 60%
FUNDAMENTAL_BLEND_WEIGHT = 0.40
TECHNICAL_BLEND_WEIGHT = 0.60


# ============================================================================
# DataClass — تفاصيل القرار الأساسي
# ============================================================================

@dataclass
class FundamentalVerdict:
    """الحكم النهائي على السهم من ناحية الأساسيات."""
    ticker: str
    score: float                          # 0-100
    is_healthy: bool                      # True لو score >= 40
    has_data: bool                        # True لو فيه بيانات أساسية
    rejection_reason: str                 # سبب الرفض (لو موجود)
    breakdown: Dict[str, float]           # تفاصيل الدرجات الفرعية
    metrics: Dict[str, Optional[float]]   # القيم الخام (PE, ROE, ...)
    signal_ar: str                        # الإشارة بالعربي
    confidence: float                     # ثقة في الحكم (0-100)


# ============================================================================
# FundamentalEngine — البوابة الأساسية
# ============================================================================

class FundamentalEngine:
    """
    محرك التحليل الأساسي — البوابة (Gatekeeper) قبل أي تحليل فني.

    المسؤولية:
    1. يقرأ البيانات المالية من data_engine.db (عبر FundamentalDataProvider)
    2. يحسب درجة شاملة 0-100
    3. يقرر هل السهم يستاهل التحليل الفني ولا لأ
    4. يرجّع تفاصيل القرار للشفافية

    القاعدة الصارمة:
    - لو مفيش بيانات أساسية → is_healthy=True (سيب الفني يحكم)
      لكن background_analyzer هيرفضه قبل كده (blue-chip filter)
    - لو في بيانات والدرجة < 40 → is_healthy=False (ارفض فوراً)
    - لو في بيانات والدرجة >= 40 → is_healthy=True (كمّل للفني)
    """

    def __init__(self, db_path: str = None):
        """
        Args:
            db_path: مسار data_engine.db (لو None، بيستخدم الافتراضي)
        """
        self.provider = FundamentalDataProvider(db_path=db_path)
        self.db_path = self.provider.db_path

    # ----------------------------------------------------------------------
    # الواجهة الرئيسية
    # ----------------------------------------------------------------------

    def get_fundamental_score(self, ticker: str) -> float:
        """
        درجة الأساسيات الشاملة (0-100).

        - 0 → مفيش بيانات أساسية خالص
        - 1-39 → أساسيات ضعيفة (خطر)
        - 40-69 → أساسيات مقبولة
        - 70-100 → أساسيات ممتازة

        Returns:
            float: الدرجة من 0 لـ 100
        """
        try:
            fd = self.provider.get_fundamental_data(ticker)
            if not fd.has_data:
                return NO_DATA_SCORE
            return max(0.0, min(100.0, float(fd.overall_fundamental_score)))
        except Exception as e:
            logger.warning(f"[FundamentalEngine] score error for {ticker}: {e}")
            return NO_DATA_SCORE

    def is_fundamentally_healthy(self, ticker: str) -> bool:
        """
        بوابة القبول الأساسي (Gatekeeper).

        القاعدة:
        - لو مفيش بيانات → True (سيب الفني يحكم — الـ background_analyzer
          هيعمل الـ blue-chip filter بشكل منفصل)
        - لو في بيانات والدرجة >= 40 → True
        - لو في بيانات والدرجة < 40 → False (ارفض السهم)

        Returns:
            bool: True لو السهم مقبول أساسياً
        """
        try:
            fd = self.provider.get_fundamental_data(ticker)
            # مفيش بيانات → سيب الفني يحكم (مش بنرفض بسبب نقص البيانات)
            if not fd.has_data:
                return True
            score = float(fd.overall_fundamental_score)
            return score >= FUNDAMENTAL_HEALTH_THRESHOLD
        except Exception as e:
            logger.warning(f"[FundamentalEngine] health check error for {ticker}: {e}")
            # لو فيه خطأ، سيب الفني يحكم (آمن)
            return True

    def has_fundamental_data(self, ticker: str) -> bool:
        """
        هل السهم عنده بيانات أساسية في data_engine.db؟

        بتستخدم في background_analyzer كـ blue-chip filter:
        لو مفيش بيانات → تجاهل السهم (مش هينفع نحلله)
        """
        try:
            fd = self.provider.get_fundamental_data(ticker)
            return fd.has_data
        except Exception:
            return False

    def get_fundamental_breakdown(self, ticker: str) -> FundamentalVerdict:
        """
        التفاصيل الكاملة للقرار الأساسي.

        Returns:
            FundamentalVerdict: كل المعلومات عن القرار
        """
        try:
            fd = self.provider.get_fundamental_data(ticker)

            if not fd.has_data:
                return FundamentalVerdict(
                    ticker=ticker,
                    score=NO_DATA_SCORE,
                    is_healthy=True,  # سيب الفني يحكم
                    has_data=False,
                    rejection_reason='لا توجد بيانات أساسية',
                    breakdown={},
                    metrics={},
                    signal_ar='مرور — لا بيانات',
                    confidence=0.0,
                )

            score = max(0.0, min(100.0, float(fd.overall_fundamental_score)))
            is_healthy = score >= FUNDAMENTAL_HEALTH_THRESHOLD

            # تفاصيل الدرجات الفرعية
            breakdown = {
                'valuation': float(fd.valuation_score),
                'profitability': float(fd.profitability_score),
                'growth': float(fd.growth_score),
                'dividend': float(fd.dividend_score),
            }

            # القيم الخام
            metrics = {
                'pe_ratio': fd.pe_ratio,
                'pb_ratio': fd.pb_ratio,
                'roe': fd.roe,
                'roa': fd.roa,
                'net_margin': fd.net_margin,
                'operating_margin': fd.operating_margin,
                'fcf_margin': fd.fcf_margin,
                'revenue_growth': fd.revenue_growth,
                'debt_to_equity': fd.debt_to_equity,
                'current_ratio': fd.current_ratio,
                'div_yield': fd.div_yield,
                'payout_ratio': fd.payout_ratio,
                'perf_1y': fd.perf_1y,
            }

            # الإشارة والسبب
            if score >= 70:
                signal_ar = '🟢 أساسيات ممتازة'
                reason = ''
            elif score >= 40:
                signal_ar = '🟡 أساسيات مقبولة'
                reason = ''
            else:
                signal_ar = '🔴 أساسيات ضعيفة'
                # حدد السبب الأكثر تأثيراً
                reasons = []
                if fd.pe_ratio is not None and fd.pe_ratio > 40:
                    reasons.append('سعر غالي جداً')
                elif fd.pe_ratio is not None and fd.pe_ratio > 25:
                    reasons.append('سعر مرتفع')
                if fd.roe is not None and fd.roe < 5:
                    reasons.append('ربحية ضعيفة')
                if fd.net_margin is not None and fd.net_margin < 0:
                    reasons.append('شركة خاسرة')
                if fd.debt_to_equity is not None and fd.debt_to_equity > 2:
                    reasons.append('مديونية عالية')
                if not reasons:
                    reasons.append('مؤشرات ضعيفة عموماً')
                reason = ' — '.join(reasons)

            # الثقة: بناءً على كمية البيانات المتاحة
            available = sum(1 for v in metrics.values() if v is not None)
            confidence = min(100.0, (available / 13.0) * 100.0)

            return FundamentalVerdict(
                ticker=ticker,
                score=score,
                is_healthy=is_healthy,
                has_data=True,
                rejection_reason=reason,
                breakdown=breakdown,
                metrics=metrics,
                signal_ar=signal_ar,
                confidence=confidence,
            )

        except Exception as e:
            logger.error(f"[FundamentalEngine] breakdown error for {ticker}: {e}")
            return FundamentalVerdict(
                ticker=ticker,
                score=NO_DATA_SCORE,
                is_healthy=True,
                has_data=False,
                rejection_reason=f'خطأ: {e}',
                breakdown={},
                metrics={},
                signal_ar='مرور — خطأ',
                confidence=0.0,
            )

    # ----------------------------------------------------------------------
    # الدمج النهائي (Final Blend)
    # ----------------------------------------------------------------------

    def blend_with_technical(
        self,
        ticker: str,
        technical_score: float,
        fundamental_score: Optional[float] = None,
    ) -> Tuple[float, Dict[str, float]]:
        """
        دمج الدرجة الفنية مع الدرجة الأساسية.

        القاعدة (The Fundamental Catalyst Shift):
        - الأساسيات بتاخد 40% من القرار
        - الشارت بياخد 60% من القرار

        Args:
            ticker: رمز السهم
            technical_score: الدرجة الفنية (0-100)
            fundamental_score: الدرجة الأساسية (لو None، هتحسب)

        Returns:
            Tuple: (final_score, breakdown_dict)
        """
        if fundamental_score is None:
            fundamental_score = self.get_fundamental_score(ticker)

        # لو مفيش بيانات أساسية → الشارت يحكم لوحده (100% فني)
        if fundamental_score <= 0:
            final = float(technical_score)
            weights = {'technical': 1.0, 'fundamental': 0.0}
        else:
            final = (
                float(technical_score) * TECHNICAL_BLEND_WEIGHT +
                float(fundamental_score) * FUNDAMENTAL_BLEND_WEIGHT
            )
            weights = {
                'technical': TECHNICAL_BLEND_WEIGHT,
                'fundamental': FUNDAMENTAL_BLEND_WEIGHT,
            }

        return max(0.0, min(100.0, final)), weights


# ============================================================================
# Singleton — نسخة واحدة مشتركة (تجنّب فتح DB لكل تحليل)
# ============================================================================

_engine_instance: Optional[FundamentalEngine] = None


def get_fundamental_engine() -> FundamentalEngine:
    """يرجّع نسخة مشتركة من FundamentalEngine (Singleton)."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = FundamentalEngine()
    return _engine_instance


# ============================================================================
# اختبار ذاتي
# ============================================================================

if __name__ == '__main__':
    print("=" * 70)
    print("اختبار FundamentalEngine — The Gatekeeper")
    print("=" * 70)
    print(f"Health threshold: {FUNDAMENTAL_HEALTH_THRESHOLD}")
    print(f"Blend weights: Technical={TECHNICAL_BLEND_WEIGHT} | Fundamental={FUNDAMENTAL_BLEND_WEIGHT}")
    print()

    engine = FundamentalEngine()

    # اختبار على أسهم EGX
    test_tickers = ['COMI', 'ETEL', 'SWDY', 'HRHO', 'EKHO', 'TMGH', 'PHDC', 'ABUK', 'FWRY']

    print(f"{'Ticker':<8} {'Score':<8} {'Healthy':<10} {'Has Data':<10} {'Signal':<25}")
    print("-" * 70)

    for ticker in test_tickers:
        verdict = engine.get_fundamental_breakdown(ticker)
        print(f"{ticker:<8} {verdict.score:<8.1f} {str(verdict.is_healthy):<10} {str(verdict.has_data):<10} {verdict.signal_ar:<25}")

    print()
    print("=== Blend Test (technical=70) ===")
    for ticker in ['COMI', 'ETEL', 'SWDY']:
        final, weights = engine.blend_with_technical(ticker, technical_score=70.0)
        fund = engine.get_fundamental_score(ticker)
        print(f"{ticker}: tech=70.0 + fund={fund:.1f} → final={final:.2f} (weights={weights})")
