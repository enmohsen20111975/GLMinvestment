"""
Quant Overdrive — خوارزميات التفوق الكمي (QUANT-OVERDRIVE-028)
================================================================
المحلل البشري بيبص لحجم التداول ويقول "السهم فيه حركة". الآلة هنا
بتحسب حاجات البشر مستحيل يقدروا يحسبوها في دماغهم لـ 270 سهم:

1. SMFI (Smart Money Flow Index):
   SMFI = (Volume on Green Candles - Volume on Red Candles) / Total Volume
   لو SMFI > 60% → الحيتان بتجمع → +25 نقطة فوراً.
   البشر بيشوفوا الحجم بس، الآلة بتفصل "حجم الشراء" عن "حجم البيع".

2. Monte Carlo Probability:
   محاكاة إحصائية (Bootstrap) لـ 500 مسار سعر خلال 5 أيام، بناءً على
   العوائد التاريخية. بترجع احتمالية وصول السهم للهدف.
   البشر بيقولوا "هيطلع"، الآلة بتقول "78.4% احتمال يوصل الهدف خلال 5 أيام".

3. Blood Filter (حق النفو):
   أي سهم الـ Turnover بتاعه < 3 مليون جنيه/يوم = سهم ميت.
   الآلة تطرده فوراً (REJECTED_LIQUIDITY). تلعب فقط في مياه الحيتان.

المرجع: Documentation/HOW_WE_ANALYZE_AND_PREDICT.md (Quant Overdrive §)
Author: دليل الاستثمار (Hedge Fund Mindset)
"""

from __future__ import annotations

import math
import random
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════
# 1. SMFI — Smart Money Flow Index
# ════════════════════════════════════════════════════════════════════════════
# المنطق: الحيتان بتجمّع على الشموع الخضراء (close >= open) وتوزّع على
# الحمراء. لو حجم الشموع الخضراء أكبر بكتير من الحمراء → تجميع خفي.
# البشر بيشوفوا "الحجم زاد"، الآلة بتفصل: زاد بسبب شراء ولا بيع؟
#
# الصيغة: SMFI = (Σ Green Vol - Σ Red Vol) / Σ Total Vol
# النطاق: -1.0 (بيع كامل) إلى +1.0 (شراء كامل)
# العتبة: SMFI > 0.60 → تجميع حيتان قوي → +25 نقطة

SMFI_STRONG_THRESHOLD = 0.60   # > 60% → +25 pts (حيتان بتجمع)
SMFI_MODERATE_THRESHOLD = 0.35  # 35-60% → +10 pts (تجميع متوسط)
SMFI_STRONG_BONUS = 25.0
SMFI_MODERATE_BONUS = 10.0
SMFI_SELL_PENALTY = -15.0      # SMFI < -0.40 → توزيع/بيع حيتان

SMFI_WINDOW = 20  # آخر 20 شمعة


@dataclass
class SMFIResult:
    """نتيجة حساب الـ Smart Money Flow Index."""
    smfi: float = 0.0           # -1.0 إلى +1.0
    smfi_pct: float = 0.0       # -100% إلى +100% (للعرض)
    green_volume: float = 0.0
    red_volume: float = 0.0
    total_volume: float = 0.0
    bonus: float = 0.0          # البونص/الخصم على الـ master_score
    label: str = ''             # وصف قصير
    label_ar: str = ''          # وصف عربي
    note: str = ''              # ملاحظة للـ log


def calculate_smfi(
    opens: List[float],
    closes: List[float],
    volumes: List[float],
    window: int = SMFI_WINDOW,
) -> Optional[SMFIResult]:
    """حساب الـ Smart Money Flow Index.

    Args:
        opens:  أسعار الافتتاح (آخر N شمعة)
        closes: أسعار الإغلاق
        volumes: أحجام التداول
        window: عدد الشموع المرجعية (default 20)

    Returns:
        SMFIResult أو None لو البيانات غير كافية.
    """
    try:
        if not opens or not closes or not volumes:
            return None
        n = min(len(opens), len(closes), len(volumes), window)
        if n < 5:
            return None  # بيانات غير كافية

        # خذ آخر N شمعة
        o = opens[-n:]
        c = closes[-n:]
        v = volumes[-n:]

        green_vol = 0.0
        red_vol = 0.0
        for i in range(n):
            _o = float(o[i] or 0)
            _c = float(c[i] or 0)
            _v = float(v[i] or 0)
            if _v <= 0:
                continue
            if _c >= _o:
                green_vol += _v  # شمعة خضراء (شراء)
            else:
                red_vol += _v    # شمعة حمراء (بيع)

        total_vol = green_vol + red_vol
        if total_vol <= 0:
            return None

        smfi = (green_vol - red_vol) / total_vol  # -1.0 إلى +1.0
        smfi_pct = smfi * 100.0

        # حساب البونص/الخصم
        bonus = 0.0
        label = 'NEUTRAL'
        label_ar = 'تدفق محايد'
        if smfi >= SMFI_STRONG_THRESHOLD:
            bonus = SMFI_STRONG_BONUS
            label = 'SMART_MONEY_ACCUMULATION'
            label_ar = f'🟢 تجميع حيتان قوي (SMFI={smfi_pct:.0f}%)'
        elif smfi >= SMFI_MODERATE_THRESHOLD:
            bonus = SMFI_MODERATE_BONUS
            label = 'MODERATE_ACCUMULATION'
            label_ar = f'🟡 تجميع متوسط (SMFI={smfi_pct:.0f}%)'
        elif smfi <= -0.40:
            bonus = SMFI_SELL_PENALTY
            label = 'SMART_MONEY_DISTRIBUTION'
            label_ar = f'🔴 توزيع حيتان (SMFI={smfi_pct:.0f}%) — بيع'

        note = (f"SMFI={smfi_pct:+.1f}% (green={green_vol:,.0f} / "
                f"red={red_vol:,.0f}) → {label} ({'+' if bonus >= 0 else ''}{bonus:.0f}pts)")

        return SMFIResult(
            smfi=smfi,
            smfi_pct=smfi_pct,
            green_volume=green_vol,
            red_volume=red_vol,
            total_volume=total_vol,
            bonus=bonus,
            label=label,
            label_ar=label_ar,
            note=note,
        )
    except Exception as e:
        logger.debug(f"[QuantOverdrive] SMFI calculation error: {e}")
        return None


# ════════════════════════════════════════════════════════════════════════════
# 2. Monte Carlo Probability — احتمالية الوصول للهدف
# ════════════════════════════════════════════════════════════════════════════
# المحلل البشري بيقول "السهم هيطلع". الآلة بتقول "78.4% احتمال يوصل
# الهدف خلال 5 أيام بناءً على آخر 200 مرة حصل فيها نفس سلوك السعر".
#
# المنهجية (Bootstrap Monte Carlo):
#   1. احسب العوائد اليومية التاريخية (log returns) من آخر 100-200 شمعة
#   2. لكل مسار محاكاة: اعيّن عشوائياً 5 عوائد من التاريخ (bootstrap)
#   3. طبّقها على السعر الحالي → مسار سعر متوقع خلال 5 أيام
#   4. لو المسار وصل للهدف (أو تجاوزه) → "نجح"
#   5. الاحتمالية = (عدد المسارات الناجحة / إجمالي المسارات) × 100
#
# الميزة: البشر مستحيل يحسبوا 500 مسار في دماغهم. الآلة تعملها في 0.1 ثانية.

MONTE_CARLO_SIMULATIONS = 500   # عدد المسارات (توازن السرعة/الدقة)
MONTE_CARLO_HORIZON = 5         # أفق التنبؤ (5 أيام تداول)
MONTE_CARLO_MIN_HISTORY = 30    # أقل عدد شموع تاريخية للمحاكاة


@dataclass
class MonteCarloResult:
    """نتيجة محاكاة Monte Carlo."""
    probability: float = 0.0       # 0-100% احتمال وصول الهدف
    simulations_run: int = 0
    horizon_days: int = MONTE_CARLO_HORIZON
    target_price: float = 0.0
    current_price: float = 0.0
    expected_return_pct: float = 0.0  # متوسط العائد المتوقع خلال الأفق
    median_path_end: float = 0.0      # median السعر في نهاية الأفق
    confidence_label: str = ''        # HIGH / MEDIUM / LOW
    label_ar: str = ''
    note: str = ''


def calculate_monte_carlo_probability(
    prices: List[float],
    current_price: float,
    target_price: float,
    horizon: int = MONTE_CARLO_HORIZON,
    simulations: int = MONTE_CARLO_SIMULATIONS,
) -> Optional[MonteCarloResult]:
    """محاكاة Monte Carlo لاحتمالية وصول السعر للهدف.

    Args:
        prices: تاريخ الأسعار (closes)
        current_price: السعر الحالي (entry)
        target_price: سعر الهدف
        horizon: عدد أيام التنبؤ (default 5)
        simulations: عدد مسارات المحاكاة (default 500)

    Returns:
        MonteCarloResult أو None لو البيانات غير كافية.
    """
    try:
        if not prices or current_price <= 0 or target_price <= 0:
            return None
        if len(prices) < MONTE_CARLO_MIN_HISTORY:
            return None  # محتاجين على الأقل 30 شمعة لعينة معقولة

        # 1. احسب العوائد اللوغاريتمية التاريخية
        # log_return[i] = ln(price[i] / price[i-1])
        # نستخدم آخر 100-200 شمعة كعينة bootstrap
        sample_size = min(len(prices) - 1, 200)
        recent = prices[-(sample_size + 1):]
        log_returns: List[float] = []
        for i in range(1, len(recent)):
            prev = float(recent[i - 1])
            curr = float(recent[i])
            if prev > 0 and curr > 0:
                lr = math.log(curr / prev)
                # فلتر القيم الشاذة (limit حد الحركة اليومية ~±20%)
                if -0.30 < lr < 0.30:
                    log_returns.append(lr)

        if len(log_returns) < 20:
            return None  # عينة صغيرة جداً

        # 2. محاكاة Bootstrap Monte Carlo
        # للسهم الصاعد (target > current): المسار ينجح لو وصل target خلال horizon
        # للسهم الهابط (target < current): المسار ينجح لو وصل target خلال horizon
        is_long = target_price > current_price
        hits = 0
        end_prices: List[float] = []
        rng = random.Random(hash(tuple(log_returns[-10:])) & 0xFFFFFFFF)

        for _ in range(simulations):
            sim_price = current_price
            reached = False
            for _day in range(horizon):
                # اعيّن عائد عشوائي من العينة التاريخية
                lr = rng.choice(log_returns)
                sim_price *= math.exp(lr)
                # تحقق لو وصل الهدف خلال الطريق
                if is_long and sim_price >= target_price:
                    reached = True
                    break
                elif not is_long and sim_price <= target_price:
                    reached = True
                    break
            if reached:
                hits += 1
            end_prices.append(sim_price)

        probability = (hits / simulations) * 100.0

        # إحصائيات إضافية
        end_prices.sort()
        median_end = end_prices[len(end_prices) // 2]
        avg_end = sum(end_prices) / len(end_prices)
        expected_return_pct = ((avg_end - current_price) / current_price) * 100.0

        # تصنيف الثقة
        if probability >= 70:
            conf_label = 'HIGH'
            label_ar = f'🎯 احتمالية عالية ({probability:.0f}%) لوصول الهدف خلال {horizon} أيام'
        elif probability >= 50:
            conf_label = 'MEDIUM'
            label_ar = f'🟡 احتمالية متوسطة ({probability:.0f}%) لوصول الهدف خلال {horizon} أيام'
        elif probability >= 30:
            conf_label = 'LOW'
            label_ar = f'🟠 احتمالية منخفضة ({probability:.0f}%) — الهدف بعيد/صعب'
        else:
            conf_label = 'VERY_LOW'
            label_ar = f'🔴 احتمالية ضعيفة جداً ({probability:.0f}%) — الهدف غير واقعي'

        note = (f"Monte Carlo: {probability:.1f}% hit target {target_price:.2f} "
                f"within {horizon}d (sim={simulations}, sample={len(log_returns)}d, "
                f"median_end={median_end:.2f}, exp_ret={expected_return_pct:+.1f}%)")

        return MonteCarloResult(
            probability=round(probability, 1),
            simulations_run=simulations,
            horizon_days=horizon,
            target_price=target_price,
            current_price=current_price,
            expected_return_pct=round(expected_return_pct, 2),
            median_path_end=round(median_end, 2),
            confidence_label=conf_label,
            label_ar=label_ar,
            note=note,
        )
    except Exception as e:
        logger.debug(f"[QuantOverdrive] Monte Carlo error: {e}")
        return None


# ════════════════════════════════════════════════════════════════════════════
# 3. Blood Filter — حق النفو (Liquidity Veto)
# ════════════════════════════════════════════════════════════════════════════
# أي سهم الـ Turnover بتاعه < 3 مليون جنيه/يوم = سهم ميت.
# الآلة تطرده فوراً (REJECTED_LIQUIDITY). مهما كان P/E حلو أو ROE عالي،
# مفيش دم = مفيش صفقة. الحيتان بتلعب في مياه عميقة، مش في المستنقعات.

BLOOD_FILTER_MIN_TURNOVER = 3_000_000.0  # 3M EGP/day


def _parse_turnover(val) -> float:
    """Robust numeric parser for turnover / market-cap / volume values.

    (أغسطس 2026 — PRODUCTION-PREDICTION-KILLER FIX)

    The scraper stores values like ``"377.55\\u202fM"`` (377.55 million with a
    Unicode narrow no-break space) or ``"86.45 K"`` as **strings** in the DB.
    A bare ``float("377.55\\u202fM")`` raises ``ValueError: could not convert
    string to float: '377.55\\u202fM'`` — which previously made the blood filter
    catch the exception and return ``True`` (rejected), wrongly classifying
    HIGH-liquidity stocks (377M turnover!) as "dead". That is the root cause of
    missing/wrong predictions on production.

    This helper strips narrow spaces / Arabic-Indic digits / commas and expands
    K/M/B suffixes so the filter sees the real number.
    """
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    try:
        import re
        # Normalise: narrow no-break space (U+202F), regular NBSP (U+00A0),
        # Arabic thousands separator (،), ASCII comma, minus variants, then trim.
        s = str(val).replace('\u202f', '').replace('\xa0', '').replace(' ', '')
        s = s.replace('،', '').replace(',', '').replace('−', '-').strip().upper()
        if not s:
            return 0.0
        m = re.match(r'^([+-]?\d+\.?\d*)\s*([KMB]?)$', s)
        if m:
            num = float(m.group(1))
            suffix = m.group(2)
            if suffix == 'K':
                num *= 1_000
            elif suffix == 'M':
                num *= 1_000_000
            elif suffix == 'B':
                num *= 1_000_000_000
            return num
        # Last resort — let float() try, returning 0.0 on any failure.
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def is_blood_filter_rejected(avg_daily_turnover: float) -> bool:
    """يتحقق لو السهم مرفوض بفلتر الدماء (turnover < 3M EGP).

    Args:
        avg_daily_turnover: معدل الدوران اليومي بالجنيه (رقم أو نص مثل "377.55 M")

    Returns:
        True لو السهم ميت (مرفوض)، False لو فيه دم.
    """
    try:
        return _parse_turnover(avg_daily_turnover) < BLOOD_FILTER_MIN_TURNOVER
    except (TypeError, ValueError):
        return True  # لو البيانات غلط، اعتبره مرفوض (آمن)


def blood_filter_label(avg_daily_turnover: float) -> str:
    """يرجع وصف عربي لحالة فلتر الدماء."""
    try:
        t = _parse_turnover(avg_daily_turnover)
        if t < BLOOD_FILTER_MIN_TURNOVER:
            return (f'🩸 فلتر الدماء: الدوران {t:,.0f} جنيه < 3M — سهم ميت '
                    f'(لا توجد سيولة للخروج)')
        return f'✅ فلتر الدماء: الدوران {t:,.0f} جنيه — سيولة كافية'
    except (TypeError, ValueError):
        return '🩸 فلتر الدماء: بيانات السيولة غير متوفرة — مرفوض'
