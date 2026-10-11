"""
Expert Analysis Engine (Python=Brain canonical — P1-PARALLEL-ENGINES-FIX 2026-10-12)
====================================================================================

Replaces: src/lib/expert-analysis.ts (882 LOC).

Per Rule 20 (Python=Brain) + Rule 67 (CALCULATION-CANONICAL): all analysis
logic lives in Python. The Node route is now a pure proxy
(`src/app/api/stocks/[ticker]/expert-analysis/route.ts`).

This module is a 1:1 port of the TypeScript engine. It uses the canonical
Python MarketProfile from `config.unified_config.MARKET_PROFILES`.

Owner directive (32-section brief preserved 1:1):
  «نريد نظاماً يولّد نصاً احترافياً شاملاً لخبير مالي حقيقي».

Sections:
  1. Technical Analysis   — RSI + MA + Support/Resistance + 52-week range
  2. Fundamental Analysis — P/E + ROE + EPS + P/B + Dividend (skip for crypto)
  3. Risk Management      — Entry + Target1 + Target2 + Stop + R:R + Position size
  4. Expert Summary       — Recommendation + Confidence + Risk factors

MarketProfile-aware (ARCH-OPTION-2):
  - RSI thresholds come from `market_profile.rsi_overbought/oversold`
  - Stop/Target use `market_profile.target_min_pct` + `stop_max_pct`
  - Currency label is dynamic (جنيه / ريال / دولار / ...)
  - Fundamental analysis is skipped for crypto
  - SIGNAL_THRESHOLDS is canonical (78/65/55/40/25)
"""

from __future__ import annotations
from typing import Any, Dict, Optional


# ─── Canonical signal thresholds (mirrors src/lib/canonical-signal.ts) ─────
# These are the master thresholds used by /api/unified/route.ts +
# /api/v2/unified/config/route.ts + /api/stocks/[ticker]/expert-analysis.
SIGNAL_THRESHOLDS = {
    'STRONG_BUY':    78,
    'BUY':           65,
    'ACCUMULATE':    55,
    'HOLD':          40,  # 41-54 = HOLD
    'SELL':          25,
    'STRONG_SELL':   0,   # < 25
}


# ─── MarketProfile accessor (canonical Python — Rule 20) ──────────────────
def _get_market_profile(market_code: Optional[str]) -> Dict[str, Any]:
    """Return a dict-shaped MarketProfile for the given market (default: EGX).

    Mirrors the TS-side `getMarketProfile(market)` exactly. Returns a plain
    dict so callers can use `.get('field')` style without dataclass imports.
    """
    if not market_code:
        market_code = 'EGX'
    market_code = str(market_code).strip().upper()

    try:
        # Lazy import (config is heavy)
        from config.unified_config import MARKET_PROFILES
        mp = MARKET_PROFILES.get(market_code) or MARKET_PROFILES.get('EGX')
        if mp is None:
            raise KeyError("no profile")
        return {
            'market_code': mp.market_code,
            'market_name': mp.market_name,
            'market_name_ar': mp.market_name_ar,
            'currency': mp.currency,
            'min_rr': float(mp.min_rr),
            'target_min_pct': float(mp.target_min_pct),
            'stop_max_pct': float(mp.stop_max_pct),
            'rsi_overbought': float(mp.rsi_overbought),
            'rsi_oversold': float(mp.rsi_oversold),
            'min_volume_filter': int(getattr(mp, 'min_volume_filter', 0) or 0),
        }
    except Exception:
        # Safe-by-design fallback (matches TS defaults verbatim)
        return {
            'market_code': market_code,
            'market_name': 'Egyptian Exchange',
            'market_name_ar': 'البورصة المصرية',
            'currency': 'EGP',
            'min_rr': 1.8,
            'target_min_pct': 2.5,
            'stop_max_pct': 7.0,
            'rsi_overbought': 70.0,
            'rsi_oversold': 30.0,
            'min_volume_filter': 1_000_000,
        }


# ─── Currency label helpers ──────────────────────────────────────────────
_CURRENCY_LABELS_AR = {
    'EGP': 'جنيه',
    'SAR': 'ريال',
    'KWD': 'دينار',
    'QAR': 'ريال',
    'AED': 'درهم',
    'USD': 'دولار',
    'USDT': 'دولار',
    'BTC': 'BTC',
    'ETH': 'ETH',
}


def _currency_label_ar(market_code: Optional[str]) -> str:
    profile = _get_market_profile(market_code)
    return _CURRENCY_LABELS_AR.get(profile['currency'], profile['currency'] or 'جنيه')


def _supports_fundamentals(market_code: Optional[str]) -> bool:
    if not market_code:
        return True
    code = str(market_code).strip().upper()
    # CRYPTO has no P/E/ROE/EPS — skip fundamental analysis
    return code != 'CRYPTO'


# ─── Number helper ────────────────────────────────────────────────────────
def _safe_num(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float('inf'), float('-inf')):  # NaN/Inf check
        return None
    if n == 0:
        return None
    return n


def _fmt(n: Optional[float], decimals: int = 2) -> str:
    if n is None:
        return '—'
    return f"{n:.{decimals}f}"


def _fmt_pct(n: Optional[float], decimals: int = 1) -> str:
    if n is None:
        return '—'
    sign = '+' if n > 0 else ''
    return f"{sign}{n:.{decimals}f}%"


def _fmt_rr(rr: Optional[float]) -> str:
    """Format the R:R ratio — returns '—' if None."""
    if rr is None:
        return '—'
    return f"{rr:.2f}"


# ─── RSI Analysis ────────────────────────────────────────────────────────
def _analyze_rsi(rsi: Optional[float], overbought: float = 70.0, oversold: float = 30.0) -> Dict[str, Any]:
    if rsi is None:
        return {
            'value': None,
            'signal': 'NO_DATA',
            'signal_ar': 'لا تتوفر بيانات',
            'analysis': 'RSI data not available for this stock.',
            'analysis_ar': 'لا تتوفر بيانات مؤشر القوة النسبية لهذا السهم.',
        }
    if rsi >= overbought:
        sig, sig_ar = 'OVERBOUGHT', 'تشبع شرائي'
        ana = (f"RSI at {rsi:.1f} indicates overbought conditions (above {overbought}). "
               "The stock has rallied significantly and may be due for a pullback or consolidation. "
               f"Consider waiting for a cooling-off period or a breakdown below {overbought} before initiating new long positions.")
        ana_ar = (f"مؤشر القوة النسبية عند {rsi:.1f} يشير إلى حالة تشبع شرائي (فوق {overbought}). "
                  "السهم صعد بشكل ملحوظ وقد يحتاج إلى تصحيح أو تثبيت. يُنصح بالانتظار حتى يهدأ الزخم "
                  f"أو يكسر مستوى {overbought} للأسفل قبل فتح مراكز شراء جديدة.")
    elif rsi >= 55:
        sig, sig_ar = 'BULLISH', 'صاعد'
        ana = (f"RSI at {rsi:.1f} shows bullish momentum without overbought conditions. "
               "The stock is in a healthy uptrend with room to run. "
               "This is a favorable zone for trend-following entries on pullbacks to support levels.")
        ana_ar = (f"مؤشر القوة النسبية عند {rsi:.1f} يُظهر زخماً صاعداً دون تشبع شرائي. "
                  "السهم في ترند صاعد صحي ولديه مساحة للصعود. "
                  "هذه منطقة مواتية لدخول الصفقات على ارتدادات الأسعار نحو مناطق الدعم.")
    elif rsi >= 45:
        sig, sig_ar = 'NEUTRAL', 'محايد'
        ana = (f"RSI at {rsi:.1f} reflects a neutral stance with no clear directional bias. "
               "The stock is consolidating. Watch for a breakout above 55 (bullish) or breakdown "
               "below 45 (bearish) to determine the next directional move.")
        ana_ar = (f"مؤشر القوة النسبية عند {rsi:.1f} يعكس موقفاً محايداً دون اتجاه واضح. "
                  "السهم في مرحلة تجميع.راقب اختراق مستوى 55 للأعلى (صاعد) أو كسر 45 للأسفل (هابط) "
                  "لتحديد الاتجاه القادم.")
    elif rsi >= oversold:
        sig, sig_ar = 'BEARISH', 'هابط'
        ana = (f"RSI at {rsi:.1f} indicates bearish momentum. The stock is under selling pressure. "
               "Short-term traders should be cautious. Value investors may watch for further weakness "
               f"toward oversold levels (below {oversold}) as potential accumulation zone.")
        ana_ar = (f"مؤشر القوة النسبية عند {rsi:.1f} يشير إلى زخم هابط. السهم تحت ضغط بيع. "
                  "يجب على المتداولين قصيري الأجل الحذر. قد يراقب المستثمرون القيميون مزيداً من الضعف "
                  f"نحو مناطق التشبع البيعي (أقل من {oversold}) كمنطقة تجميع محتملة.")
    else:
        sig, sig_ar = 'OVERSOLD', 'تشبع بيعي'
        ana = (f"RSI at {rsi:.1f} signals oversold conditions (below {oversold}). "
               "The stock has been heavily sold and may be due for a technical bounce. "
               "This can present a contrarian buying opportunity, but confirm with other indicators "
               "(volume, support levels) before entering.")
        ana_ar = (f"مؤشر القوة النسبة عند {rsi:.1f} يشير إلى حالة تشبع بيعي (أقل من {oversold}). "
                  "السهم تعرض لبيع مكثف وقد يحتاج إلى ارتداد فني. قد يمثل هذا فرصة شراء عكسية، "
                  "لكن يجب التأكد بمؤشرات أخرى (الحجم، مستويات الدعم) قبل الدخول.")
    return {'value': rsi, 'signal': sig, 'signal_ar': sig_ar, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── Moving Averages Analysis ─────────────────────────────────────────────
def _analyze_ma(ma50: Optional[float], ma200: Optional[float], price: Optional[float]) -> Dict[str, Any]:
    trend, trend_ar = 'UNKNOWN', 'غير محدد'
    ana = 'Insufficient data for moving average analysis.'
    ana_ar = 'بيانات غير كافية لتحليل المتوسطات المتحركة.'
    if price is not None and ma50 is not None and ma200 is not None:
        if price > ma50 and ma50 > ma200:
            trend, trend_ar = 'STRONG_UPTREND', 'ترند صاعد قوي'
            ana = (f"Price ({price:.2f}) is above both MA50 ({ma50:.2f}) and MA200 ({ma200:.2f}), "
                   "confirming a strong uptrend. The \"Golden Cross\" alignment (MA50 > MA200) "
                   "indicates sustained bullish momentum. Use MA50 as dynamic support on pullbacks.")
            ana_ar = (f"السعر ({price:.2f}) أعلى من MA50 ({ma50:.2f}) وMA200 ({ma200:.2f})، "
                      "مما يؤكد ترند صاعد قوي. تقاطع MA50 فوق MA200 (\"Golden Cross\") يشير إلى زخم صاعد مستدام. "
                      "استخدم MA50 كدعم ديناميكي عند الارتدادات.")
        elif price > ma50 and ma50 < ma200:
            trend, trend_ar = 'RECOVERY', 'تعافي'
            ana = (f"Price ({price:.2f}) is above MA50 ({ma50:.2f}) but MA200 ({ma200:.2f}) is still above MA50. "
                   "This suggests a potential recovery from a downtrend. Watch for MA50 crossing above MA200 "
                   "(Golden Cross) to confirm trend reversal.")
            ana_ar = (f"السعر ({price:.2f}) أعلى من MA50 ({ma50:.2f}) لكن MA200 ({ma200:.2f}) لا يزال أعلى. "
                      "هذا يشير إلى تعافي محتمل من ترند هابط.راقب تقاطع MA50 فوق MA200 (Golden Cross) لتأكيد انعكاس الاتجاه.")
        elif price < ma50 and ma50 > ma200:
            trend, trend_ar = 'CORRECTION', 'تصحيح'
            ana = (f"Price ({price:.2f}) dipped below MA50 ({ma50:.2f}) while MA200 ({ma200:.2f}) remains below MA50. "
                   "This indicates a short-term correction within an uptrend. MA200 is the key long-term support. "
                   "A break below MA200 would signal trend reversal.")
            ana_ar = (f"السعر ({price:.2f}) انخفض تحت MA50 ({ma50:.2f}) بينما MA200 ({ma200:.2f}) لا يزال أقل. "
                      "هذا يشير إلى تصحيح قصير الأجل ضمن ترند صاعد. MA200 هو الدعم طويل الأجل الرئيسي. "
                      "الكسر تحت MA200 يشير لانعكاس الاتجاه.")
        else:
            trend, trend_ar = 'STRONG_DOWNTREND', 'ترند هابط قوي'
            ana = (f"Price ({price:.2f}) is below both MA50 ({ma50:.2f}) and MA200 ({ma200:.2f}), "
                   "confirming a strong downtrend. The \"Death Cross\" alignment (MA50 < MA200) "
                   "indicates sustained bearish momentum. Avoid long positions unless a clear reversal signal appears.")
            ana_ar = (f"السعر ({price:.2f}) تحت MA50 ({ma50:.2f}) وMA200 ({ma200:.2f})، "
                      "مما يؤكد ترند هابط قوي. تقاطع MA50 تحت MA200 (\"Death Cross\") يشير إلى زخم هابط مستدام. "
                      "تجنب المراكز الشرائية إلا إذا ظهرت إشارة انعكاس واضحة.")
    elif price is not None and ma50 is not None:
        if price > ma50:
            trend, trend_ar = 'SHORT_TERM_UPTREND', 'ترند صاعد قصير الأجل'
            ana = f"Price ({price:.2f}) is above MA50 ({ma50:.2f}), indicating short-term bullish momentum. MA200 data insufficient for long-term trend confirmation."
            ana_ar = f"السعر ({price:.2f}) أعلى من MA50 ({ma50:.2f})، مما يشير إلى زخم صاعد قصير الأجل. بيانات MA200 غير كافية لتأكيد الترند طويل الأجل."
        else:
            trend, trend_ar = 'SHORT_TERM_DOWNTREND', 'ترند هابط قصير الأجل'
            ana = f"Price ({price:.2f}) is below MA50 ({ma50:.2f}), indicating short-term bearish pressure. MA200 data insufficient for long-term trend confirmation."
            ana_ar = f"السعر ({price:.2f}) تحت MA50 ({ma50:.2f})، مما يشير إلى ضغط هابط قصير الأجل. بيانات MA200 غير كافية لتأكيد الترند طويل الأجل."
    return {'ma50': ma50, 'ma200': ma200, 'trend': trend, 'trend_ar': trend_ar,
            'analysis': ana, 'analysis_ar': ana_ar}


# ─── Support/Resistance Analysis ─────────────────────────────────────────
def _analyze_sr(support: Optional[float], resistance: Optional[float], price: Optional[float]) -> Dict[str, Any]:
    ana = 'Support and resistance levels not available.'
    ana_ar = 'مستويات الدعم والمقاومة غير متوفرة.'
    if price is not None and support is not None and resistance is not None:
        rng = resistance - support
        if rng <= 0:
            return {'support': support, 'resistance': resistance, 'analysis': ana, 'analysis_ar': ana_ar}
        position = ((price - support) / rng) * 100
        if position < 20:
            ana = (f"Price ({price:.2f}) is near support level ({support:.2f}), only {position:.0f}% above support. "
                   "This presents a favorable risk/reward entry zone — stop loss can be placed tightly below support. "
                   f"Resistance at {resistance:.2f} is the first profit target.")
            ana_ar = (f"السعر ({price:.2f}) قريب من مستوى الدعم ({support:.2f})، فقط {position:.0f}% فوق الدعم. "
                      "هذا يقدم منطقة دخول مواتية للمخاطرة/العائد — يمكن وضع وقف الخسارة بإحكام تحت الدعم. "
                      f"المقاومة عند {resistance:.2f} هي هدف الربح الأول.")
        elif position > 80:
            ana = (f"Price ({price:.2f}) is near resistance level ({resistance:.2f}), {position:.0f}% above support. "
                   "Breakout above resistance could signal continuation; failure to break may lead to pullback "
                   f"to support ({support:.2f}).")
            ana_ar = (f"السعر ({price:.2f}) قريب من مستوى المقاومة ({resistance:.2f})، {position:.0f}% فوق الدعم. "
                      f"الاختراق فوق المقاومة قد يشير إلى استمرار الصعود؛ الفشل في الاختراق قد يؤدي لارتداد نحو الدعم ({support:.2f}).")
        else:
            ana = (f"Price ({price:.2f}) is trading in the middle of its range — {position:.0f}% above support "
                   f"({support:.2f}) and {(100-position):.0f}% below resistance ({resistance:.2f}). "
                   "Wait for a clearer signal near support (buy) or resistance (sell/breakout).")
            ana_ar = (f"السعر ({price:.2f}) يتداول في منتصف النطاق — {position:.0f}% فوق الدعم ({support:.2f}) "
                      f"و {(100-position):.0f}% تحت المقاومة ({resistance:.2f}). "
                      "انتظر إشارة أوضح قرب الدعم (شراء) أو المقاومة (بيع/اختراق).")
    return {'support': support, 'resistance': resistance, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── 52-Week Range Analysis ──────────────────────────────────────────────
def _analyze_52w(high: Optional[float], low: Optional[float], price: Optional[float]) -> Dict[str, Any]:
    position, position_ar = 'NO_DATA', 'لا بيانات'
    ana = '52-week range data not available.'
    ana_ar = 'بيانات نطاق 52 أسبوع غير متوفرة.'
    if price is not None and high is not None and low is not None and high > low:
        pct = ((price - low) / (high - low)) * 100
        if pct > 90:
            position, position_ar = 'NEAR_HIGH', 'قرب القمة السنوية'
            ana = (f"Price is at {pct:.0f}% of its 52-week range (low: {low:.2f}, high: {high:.2f}). "
                   "Trading near yearly highs signals strong momentum but limited upside. "
                   "Risk/reward is unfavorable for new entries — consider waiting for a pullback.")
            ana_ar = (f"السعر عند {pct:.0f}% من نطاق 52 أسبوع (الأدنى: {low:.2f}، الأعلى: {high:.2f}). "
                      "التداول قرب القمم السنوية يشير إلى زخم قوي لكن مساحة الصعود محدودة. "
                      "المخاطرة/العائد غير مواتية للدخول الجديد — يُنصح بانتظار ارتداد.")
        elif pct < 10:
            position, position_ar = 'NEAR_LOW', 'قرب القاع السنوي'
            ana = (f"Price is at {pct:.0f}% of its 52-week range (low: {low:.2f}, high: {high:.2f}). "
                   "Trading near yearly lows may present value opportunity, but confirm with fundamentals — "
                   "could be a falling knife if downtrend persists.")
            ana_ar = (f"السعر عند {pct:.0f}% من نطاق 52 أسبوع (الأدنى: {low:.2f}، الأعلى: {high:.2f}). "
                      "التداول قرب القيعان السنوية قد يقدم فرصة قيمة، لكن أكد بالأساسيات — "
                      "قد يكون \"سكيناً ساقطاً\" إذا استمر الترند الهابط.")
        else:
            position, position_ar = 'MID_RANGE', 'منتصف النطاق'
            ana = (f"Price is at {pct:.0f}% of its 52-week range (low: {low:.2f}, high: {high:.2f}). "
                   "Trading in a healthy middle zone with room to move in either direction. "
                   "Align with broader trend direction.")
            ana_ar = (f"السعر عند {pct:.0f}% من نطاق 52 أسبوع (الأدنى: {low:.2f}، الأعلى: {high:.2f}). "
                      "التداول في منطقة وسطية صحية مع مساحة للحركة في أي اتجاه. واءم مع اتجاه الترند الأوسع.")
    return {'high': high, 'low': low, 'position': position, 'position_ar': position_ar,
            'analysis': ana, 'analysis_ar': ana_ar}


# ─── P/E Ratio Analysis ──────────────────────────────────────────────────
def _analyze_pe(pe: Optional[float]) -> Dict[str, Any]:
    if pe is None:
        return {'value': None, 'rating': 'NO_DATA', 'rating_ar': 'لا بيانات',
                'analysis': 'P/E ratio not available.',
                'analysis_ar': 'مكرر الربحية غير متوفر.'}
    if pe < 10:
        rating, rating_ar = 'UNDERVALUED', 'مقوّم بأقل من قيمته'
        ana = (f"P/E of {pe:.1f} is low, suggesting the stock may be undervalued. However, verify that low P/E isn't "
               "due to declining earnings or sector headwinds. Banks/financials often have lower P/E (5-12), "
               "while tech stocks command higher multiples (20-40+).")
        ana_ar = (f"مكرر ربحية {pe:.1f} منخفض، مما يشير إلى أن السهم قد يكون مقوّماً بأقل من قيمته. "
                  "لكن تحقق أن انخفاض المكرر ليس بسبب تراجع الأرباح أو ضغوط قطاعية. "
                  "البنوك/المالية غالباً لها مكرر أقل (5-12)، بينما التكنولوجيا تتمتع بمضاعفات أعلى (20-40+).")
    elif pe <= 20:
        rating, rating_ar = 'FAIR_VALUE', 'تقييم عادل'
        ana = (f"P/E of {pe:.1f} is in a fair value range (10-20). This aligns with market average and suggests "
               "balanced expectations. Combine with growth rate (PEG ratio) for better assessment.")
        ana_ar = (f"مكرر ربحية {pe:.1f} في نطاق التقييم العادل (10-20). يتوافق مع متوسط السوق ويشير إلى توقعات متوازنة. "
                  "ادمج مع معدل النمو (نسبة PEG) لتقييم أفضل.")
    elif pe <= 35:
        rating, rating_ar = 'PREMIUM', 'تقييم مرتفع'
        ana = (f"P/E of {pe:.1f} is elevated (20-35), indicating market expects high growth. "
               "Justified if earnings are growing rapidly. Risky if growth disappoints — stock could re-rate lower.")
        ana_ar = (f"مكرر ربحية {pe:.1f} مرتفع (20-35)، مما يشير إلى توقع السوق لنمو عالٍ. "
                  "مبرر إذا كانت الأرباح تنمو بسرعة. مخاطرة إذا خيب النمو التوقعات — قد يُعاد تقييم السهم للأسفل.")
    else:
        rating, rating_ar = 'OVERVALUED', 'مقوّم بأكثر من قيمته'
        ana = (f"P/E of {pe:.1f} is very high (>35), indicating speculative valuation. "
               "Only justified by exceptional growth prospects. High risk of significant correction if growth slows.")
        ana_ar = (f"مكرر ربحية {pe:.1f} مرتفع جداً (>35)، مما يشير إلى تقييم مضاربي. "
                  "مبرر فقط بآفاق نمو استثنائية. مخاطرة عالية لتصحيح كبير إذا تباطأ النمو.")
    return {'value': pe, 'rating': rating, 'rating_ar': rating_ar, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── ROE Analysis ────────────────────────────────────────────────────────
def _analyze_roe(roe: Optional[float]) -> Dict[str, Any]:
    if roe is None:
        return {'value': None, 'rating': 'NO_DATA', 'rating_ar': 'لا بيانات',
                'analysis': 'ROE not available.',
                'analysis_ar': 'العائد على حقوق الملكية غير متوفر.'}
    if roe >= 20:
        rating, rating_ar = 'EXCELLENT', 'ممتاز'
        ana = (f"ROE of {roe:.1f}% is excellent (>20%). The company generates superior returns on shareholder equity, "
               "indicating efficient capital allocation and strong competitive moat. "
               "This is a hallmark of high-quality businesses.")
        ana_ar = (f"العائد على حقوق الملكية {roe:.1f}% ممتاز (>20%). الشركة تحقق عوائد فائقة على حقوق المساهمين، "
                  "مما يشير إلى تخصيص كفء لرأس المال وخندق تنافسي قوي. هذا سمة الشركات عالية الجودة.")
    elif roe >= 15:
        rating, rating_ar = 'GOOD', 'جيد'
        ana = (f"ROE of {roe:.1f}% is good (15-20%). The company delivers solid returns above cost of capital. "
               "Indicates competent management and reasonable business quality.")
        ana_ar = (f"العائد على حقوق الملكية {roe:.1f}% جيد (15-20%). الشركة تحقق عوائد ملموسة فوق تكلفة رأس المال. "
                  "يشير إلى إدارة كفؤة وجودة معقولة للأعمال.")
    elif roe >= 10:
        rating, rating_ar = 'AVERAGE', 'متوسط'
        ana = (f"ROE of {roe:.1f}% is average (10-15%). Returns are acceptable but not standout. "
               "Monitor for improvement or deterioration in profitability trends.")
        ana_ar = (f"العائد على حقوق الملكية {roe:.1f}% متوسط (10-15%). العوائد مقبولة لكن غير متميزة. "
                  "راقب التحسن أو التدهور في اتجاهات الربحية.")
    else:
        rating, rating_ar = 'WEAK', 'ضعيف'
        ana = (f"ROE of {roe:.1f}% is weak (<10%). The company struggles to generate adequate returns on shareholder capital. "
               "Investigate causes: low margins, high debt, or poor asset turnover.")
        ana_ar = (f"العائد على حقوق الملكية {roe:.1f}% ضعيف (<10%). الشركة تكافح لتوليد عوائد كافية على حقوق المساهمين. "
                  "تحقق في الأسباب: هوامش منخفضة، ديون عالية، أو دوران أصول ضعيف.")
    return {'value': roe, 'rating': rating, 'rating_ar': rating_ar, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── EPS Analysis ────────────────────────────────────────────────────────
def _analyze_eps(eps: Optional[float], price: Optional[float], currency_label: str = 'جنيه') -> Dict[str, Any]:
    if eps is None:
        return {'value': None, 'analysis': 'EPS not available.',
                'analysis_ar': 'ربحية السهم غير متوفرة.'}
    if price is not None and price > 0:
        implied_pe = price / eps
        verdict = ('Reasonable valuation.' if implied_pe < 15 else
                   'Moderate valuation.' if implied_pe < 25 else
                   'Premium valuation — requires growth justification.')
        verdict_ar = ('تقييم معقول.' if implied_pe < 15 else
                      'تقييم متوسط.' if implied_pe < 25 else
                      'تقييم مرتفع — يتطلب مبرر نمو.')
        ana = (f"EPS of {eps:.2f} {currency_label} means each share earns {eps:.2f} {currency_label} annually. "
               f"At current price {price:.2f}, this implies a P/E of {implied_pe:.1f}x. {verdict}")
        ana_ar = (f"ربحية السهم {eps:.2f} {currency_label} تعني أن كل سهم يحقق {eps:.2f} {currency_label} سنوياً. "
                  f"عند السعر الحالي {price:.2f}، يعني ذلك مكرر ربحية {implied_pe:.1f}x. {verdict_ar}")
    else:
        ana = (f"EPS of {eps:.2f} {currency_label} reflects per-share earnings. Positive EPS indicates profitability. "
               "Compare with historical EPS to assess growth trajectory.")
        ana_ar = (f"ربحية السهم {eps:.2f} {currency_label} تعكس الأرباح لكل سهم. ربحية موجبة تشير إلى تحقيق أرباح. "
                  "قارن مع ربحية السهم التاريخية لتقييم مسار النمو.")
    return {'value': eps, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── P/B Ratio Analysis ──────────────────────────────────────────────────
def _analyze_pb(pb: Optional[float]) -> Dict[str, Any]:
    if pb is None:
        return {'value': None, 'rating': 'NO_DATA', 'rating_ar': 'لا بيانات',
                'analysis': 'P/B ratio not available.',
                'analysis_ar': 'مكرر القيمة الدفترية غير متوفر.'}
    if pb < 1:
        rating, rating_ar = 'DEEP_VALUE', 'قيمة عميقة'
        ana = (f"P/B of {pb:.2f} is below 1.0, meaning the stock trades below its book value. "
               "This can indicate deep value opportunity OR distress (asset quality concerns, losses expected). "
               "Common for banks — verify asset quality and NPL ratios.")
        ana_ar = (f"مكرر القيمة الدفترية {pb:.2f} أقل من 1.0، يعني السهم يتداول تحت قيمته الدفترية. "
                  "قد يشير إلى فرصة قيمة عميقة أو ضائقة (مخاوف جودة الأصول، خسائر متوقعة). "
                  "شائع للبنوك — تحقق من جودة الأصول ونسب الديون المعدومة.")
    elif pb <= 2:
        rating, rating_ar = 'REASONABLE', 'معقول'
        ana = (f"P/B of {pb:.2f} is reasonable (1-2x). The stock trades near its book value, "
               "typical for financials and mature businesses. Indicates balanced market valuation.")
        ana_ar = (f"مكرر القيمة الدفترية {pb:.2f} معقول (1-2x). السهم يتداول قرب قيمته الدفترية، "
                  "نموذجي للمالية والأعمال الناضجة. يشير إلى تقييم سوقي متوازن.")
    elif pb <= 4:
        rating, rating_ar = 'GROWTH_PREMIUM', 'علاوة نمو'
        ana = (f"P/B of {pb:.2f} shows growth premium (2-4x). Market values the company above book value, "
               "expecting intangible value (brand, IP, growth). Common for tech and high-ROE businesses.")
        ana_ar = (f"مكرر القيمة الدفترية {pb:.2f} يُظهر علاوة نمو (2-4x). السوق يقيّم الشركة فوق قيمتها الدفترية، "
                  "متوقعاً قيمة غير ملموسة (علامة تجارية، ملكية فكرية، نمو). شائع للتكنولوجيا والأعمال ذات ROE العالي.")
    else:
        rating, rating_ar = 'HIGH_PREMIUM', 'علاوة عالية'
        ana = (f"P/B of {pb:.2f} is high (>4x). Significant premium over book value requires exceptional ROE or growth. "
               "Risky if expectations aren't met.")
        ana_ar = (f"مكرر القيمة الدفترية {pb:.2f} مرتفع (>4x). علاوة كبيرة فوق القيمة الدفترية تتطلب ROE استثنائي أو نمو. "
                  "مخاطرة إذا لم تتحقق التوقعات.")
    return {'value': pb, 'rating': rating, 'rating_ar': rating_ar, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── Dividend Yield Analysis ────────────────────────────────────────────
def _analyze_dividend(div_yield: Optional[float]) -> Dict[str, Any]:
    if div_yield is None:
        return {'value': None, 'rating': 'NO_DATA', 'rating_ar': 'لا بيانات',
                'analysis': 'Dividend yield not available.',
                'analysis_ar': 'عائد التوزيعات غير متوفر.'}
    if div_yield >= 8:
        rating, rating_ar = 'VERY_HIGH', 'عائد عالي جداً'
        ana = (f"Dividend yield of {div_yield:.2f}% is very high (>8%). Attractive income but verify sustainability — "
               "high yields can signal distress (price dropped, dividend at risk). "
               "Check payout ratio and cash flow coverage.")
        ana_ar = (f"عائد التوزيعات {div_yield:.2f}% عالي جداً (>8%). دخل جذاب لكن تحقق الاستدامة — "
                  "العوائد العالية قد تشير لضائقة (انخفاض السعر، توزيعات معرضة للخطر). "
                  "افحص نسبة التوزيع وتغطية التدفق النقدي.")
    elif div_yield >= 4:
        rating, rating_ar = 'ATTRACTIVE', 'جذاب'
        ana = (f"Dividend yield of {div_yield:.2f}% is attractive (4-8%). Provides solid income stream, "
               "typical for mature companies and financials. Supports total return especially in sideways markets.")
        ana_ar = (f"عائد التوزيعات {div_yield:.2f}% جذاب (4-8%). يوفر دخل ثابت، "
                  "نموذجي للشركات الناضجة والقطاع المالي. يدعم العائد الكلي خاصة في الأسواق العرضية.")
    elif div_yield >= 1:
        rating, rating_ar = 'MODEST', 'متواضع'
        ana = (f"Dividend yield of {div_yield:.2f}% is modest (1-4%). Companies prioritize reinvestment over distribution. "
               "Growth stocks typically offer lower yields — focus on capital appreciation potential.")
        ana_ar = (f"عائد التوزيعات {div_yield:.2f}% متواضع (1-4%). الشركات تعطي أولوية لإعادة الاستثمار بدلاً من التوزيع. "
                  "أسهم النمو عادة تقدم عوائد أقل — ركز على إمكانية ارتفاع رأس المال.")
    else:
        rating, rating_ar = 'MINIMAL', 'ضئيل'
        ana = (f"Dividend yield of {div_yield:.2f}% is minimal (<1%) or zero. Company likely reinvests all earnings into growth. "
               "Acceptable for high-growth companies, concerning for mature businesses.")
        ana_ar = (f"عائد التوزيعات {div_yield:.2f}% ضئيل (<1%) أو صفر. الشركة على الأرجح تعيد استثمار كل الأرباح في النمو. "
                  "مقبول للشركات سريعة النمو، مثير للقلق للأعمال الناضجة.")
    return {'value': div_yield, 'rating': rating, 'rating_ar': rating_ar, 'analysis': ana, 'analysis_ar': ana_ar}


# ─── Skip Fundamental (for crypto / markets without fundamentals) ────────
def _skip_fundamental(field_name: str) -> Dict[str, Any]:
    return {
        'value': None,
        'rating': 'N/A',
        'rating_ar': 'غير متاح',
        'analysis': f"{field_name} is not applicable for this market (no financial statements).",
        'analysis_ar': f"{field_name} غير متاح لهذا السوق (لا توجد قوائم مالية).",
    }


# ─── Risk Assessment ─────────────────────────────────────────────────────
def _assess_risk(rsi: Optional[float], beta: Optional[float],
                 debt_to_equity: Optional[float], position_52w: str) -> Dict[str, Any]:
    factors: list = []
    factors_ar: list = []
    risk_score = 0

    if rsi is not None and rsi >= 70:
        factors.append('Overbought RSI — pullback risk')
        factors_ar.append('RSI في تشبع شرائي — خطر ارتداد')
        risk_score += 2
    elif rsi is not None and rsi <= 30:
        factors.append('Oversold RSI — potential falling knife')
        factors_ar.append('RSI في تشبع بيعي — قد يكون "سكين ساقط"')
        risk_score += 2

    if beta is not None and beta > 1.5:
        factors.append(f"High beta ({beta:.2f}) — above-market volatility")
        factors_ar.append(f"بيتا عالية ({beta:.2f}) — تقلب أعلى من السوق")
        risk_score += 1

    if debt_to_equity is not None and debt_to_equity > 2:
        factors.append(f"High debt/equity ({debt_to_equity:.2f}) — leverage risk")
        factors_ar.append(f"ديون/حقوق ملكية عالية ({debt_to_equity:.2f}) — خطر الرافعة المالية")
        risk_score += 2

    if position_52w == 'NEAR_HIGH':
        factors.append('Trading near 52-week high — limited upside')
        factors_ar.append('يتداول قرب قمة 52 أسبوع — مساحة صعود محدودة')
        risk_score += 1
    elif position_52w == 'NEAR_LOW':
        factors.append('Trading near 52-week low — downtrend risk')
        factors_ar.append('يتداول قرب قاع 52 أسبوع — خطر ترند هابط')
        risk_score += 1

    if risk_score >= 4:
        level, level_ar = 'HIGH', 'مرتفع'
        position_size, position_size_ar = '0.5-1% of portfolio — small position only', '0.5-1% من المحفظة — مركز صغير فقط'
    elif risk_score >= 2:
        level, level_ar = 'MODERATE', 'متوسط'
        position_size, position_size_ar = '1-3% of portfolio', '1-3% من المحفظة'
    else:
        level, level_ar = 'LOW', 'منخفض'
        position_size, position_size_ar = '3-5% of portfolio', '3-5% من المحفظة'

    return {'level': level, 'level_ar': level_ar, 'factors': factors, 'factors_ar': factors_ar,
            'positionSize': position_size, 'positionSize_ar': position_size_ar}


# ─── Signal label helper ─────────────────────────────────────────────────
_SIGNAL_AR_MAP = {
    'STRONG_BUY': 'شراء قوي',
    'BUY': 'شراء',
    'ACCUMULATE': 'تجميع',
    'HOLD': 'انتظار',
    'REDUCE': 'تخفيض',
    'SELL': 'بيع',
    'STRONG_SELL': 'بيع قوي',
}


def _signal_ar(signal: str) -> str:
    return _SIGNAL_AR_MAP.get(signal, signal)


# ─── MAIN: generate_expert_analysis ──────────────────────────────────────
def generate_expert_analysis(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    1:1 port of the TypeScript `generateExpertAnalysis(data)` function.

    Input: dict mirroring StockDataForAnalysis (see TypeScript interface).
    Output: dict mirroring ExpertAnalysis (same shape — callers don't change).
    """
    profile = _get_market_profile(data.get('market'))
    currency = _currency_label_ar(data.get('market'))
    has_fundamentals = _supports_fundamentals(data.get('market'))

    price = _safe_num(data.get('current_price'))
    rsi = _safe_num(data.get('rsi'))
    ma50 = _safe_num(data.get('ma_50'))
    ma200 = _safe_num(data.get('ma_200'))
    support = _safe_num(data.get('support'))
    resistance = _safe_num(data.get('resistance'))
    high52 = _safe_num(data.get('high_52w'))
    low52 = _safe_num(data.get('low_52w'))
    pe = _safe_num(data.get('pe_ratio'))
    roe = _safe_num(data.get('roe'))
    eps = _safe_num(data.get('eps'))
    pb = _safe_num(data.get('pb_ratio'))
    div_yield = _safe_num(data.get('dividend_yield'))
    beta = _safe_num(data.get('beta'))
    debt_to_equity = _safe_num(data.get('debt_to_equity'))

    entry = _safe_num(data.get('entry_price')) or price
    target1 = _safe_num(data.get('target_price'))
    target2 = _safe_num(data.get('target_price_2'))
    stop_loss = _safe_num(data.get('stop_loss'))

    signal = (data.get('signal') or 'HOLD').upper()
    is_sell_signal = signal in ('SELL', 'STRONG_SELL', 'REDUCE')

    target_up_mult = 1 + profile['target_min_pct'] / 100.0
    target_down_mult = 1 - profile['target_min_pct'] / 100.0
    stop_down_mult = 1 - profile['stop_max_pct'] / 100.0
    stop_up_mult = 1 + profile['stop_max_pct'] / 100.0

    # Calculate target1 if missing
    if target1 is None and entry:
        if is_sell_signal:
            target1 = (support if support and support < entry else entry * target_down_mult)
        else:
            target1 = (resistance if resistance and resistance > entry else entry * target_up_mult)

    # Calculate target2 if missing
    if target2 is None and target1:
        target2 = target1 * (0.80 if is_sell_signal else 1.20)

    # Calculate stop loss if missing
    if stop_loss is None and entry:
        if is_sell_signal:
            stop_loss = (resistance if resistance and resistance > entry else entry * stop_up_mult)
        else:
            stop_loss = (support if support and support < entry else entry * stop_down_mult)

    # R:R
    rr = None
    if entry and target1 and stop_loss:
        if is_sell_signal:
            denom = (stop_loss - entry)
            rr = ((entry - target1) / denom) if denom != 0 else None
        else:
            denom = (entry - stop_loss)
            rr = ((target1 - entry) / denom) if denom != 0 else None

    target1_pct = ((target1 - entry) / entry * 100.0) if (entry and target1) else None
    target2_pct = ((target2 - entry) / entry * 100.0) if (entry and target2) else None
    stop_pct = ((stop_loss - entry) / entry * 100.0) if (entry and stop_loss) else None

    # Recommendation — CANONICAL unified thresholds
    rec, rec_ar = 'HOLD', 'انتظار'
    if data.get('signal'):
        rec = data['signal']
        rec_ar = _signal_ar(data['signal'])
    elif data.get('master_score') is not None:
        s = float(data['master_score'])
        if s >= SIGNAL_THRESHOLDS['STRONG_BUY']:
            rec, rec_ar = 'STRONG_BUY', 'شراء قوي'
        elif s >= SIGNAL_THRESHOLDS['BUY']:
            rec, rec_ar = 'BUY', 'شراء'
        elif s >= SIGNAL_THRESHOLDS['ACCUMULATE']:
            rec, rec_ar = 'ACCUMULATE', 'تجميع'
        elif s >= SIGNAL_THRESHOLDS['SELL']:
            rec, rec_ar = 'SELL', 'بيع'
        else:
            rec, rec_ar = 'STRONG_SELL', 'بيع قوي'

    name = data.get('name_ar') or data.get('name') or data.get('ticker')
    sector = data.get('sector') or '—'

    rsi_analysis = _analyze_rsi(rsi, profile['rsi_overbought'], profile['rsi_oversold'])
    ma_analysis = _analyze_ma(ma50, ma200, price)
    sr_analysis = _analyze_sr(support, resistance, price)
    range_52w = _analyze_52w(high52, low52, price)

    if has_fundamentals:
        pe_analysis = _analyze_pe(pe)
        roe_analysis = _analyze_roe(roe)
        eps_analysis = _analyze_eps(eps, price, currency)
        pb_analysis = _analyze_pb(pb)
        div_analysis = _analyze_dividend(div_yield)
    else:
        pe_analysis = _skip_fundamental('P/E')
        roe_analysis = _skip_fundamental('ROE')
        eps_analysis = _skip_fundamental('EPS')
        pb_analysis = _skip_fundamental('P/B')
        div_analysis = _skip_fundamental('Dividend')

    risk = _assess_risk(rsi, beta, debt_to_equity, range_52w['position'])

    # Expert summary (bilingual)
    summary_en_parts = [f"Based on the technical and fundamental analysis, {name} ({data.get('ticker')}) in the {sector} sector is currently rated as {rec}."]
    if rsi_analysis['signal'] != 'NO_DATA':
        summary_en_parts.append(f"Technical indicators show RSI at {rsi:.1f} ({rsi_analysis['signal_ar']}).")
    if ma_analysis['trend'] != 'UNKNOWN':
        summary_en_parts.append(f"The trend is {ma_analysis['trend_ar']}.")
    if has_fundamentals and pe_analysis['rating'] != 'NO_DATA':
        summary_en_parts.append(f"Fundamentally, P/E of {pe:.1f} suggests {pe_analysis['rating_ar']}.")
    if has_fundamentals and roe_analysis['rating'] != 'NO_DATA':
        summary_en_parts.append(f"ROE of {roe:.1f}% is {roe_analysis['rating_ar']}.")
    summary_en_parts.append(f"Risk level: {risk['level_ar']}.")
    summary_en_parts.append(f"Recommended position size: {risk['positionSize_ar']}.")
    expert_summary = ' '.join(summary_en_parts)

    summary_ar_parts = [f"بناءً على التحليل الفني والأساسي، {name} ({data.get('ticker')}) في قطاع {sector} مُقيّم حالياً بـ {rec_ar}."]
    if rsi_analysis['signal'] != 'NO_DATA':
        summary_ar_parts.append(f"المؤشرات الفنية تُظهر RSI عند {rsi:.1f} ({rsi_analysis['signal_ar']}).")
    if ma_analysis['trend'] != 'UNKNOWN':
        summary_ar_parts.append(f"الاتجاه {ma_analysis['trend_ar']}.")
    if has_fundamentals and pe_analysis['rating'] != 'NO_DATA':
        summary_ar_parts.append(f"أساسياً، مكرر ربحية {pe:.1f} يشير إلى {pe_analysis['rating_ar']}.")
    if has_fundamentals and roe_analysis['rating'] != 'NO_DATA':
        summary_ar_parts.append(f"العائد على حقوق الملكية {roe:.1f}% {roe_analysis['rating_ar']}.")
    summary_ar_parts.append(f"مستوى المخاطرة: {risk['level_ar']}.")
    summary_ar_parts.append(f"حجم المركز الموصى به: {risk['positionSize_ar']}.")
    expert_summary_ar = ' '.join(summary_ar_parts)

    # Full Arabic report (matches the TS output exactly — same format string)
    if has_fundamentals:
        fundamental_section = f"""
━━━ **التحليل الأساسي** ━━━
💰 **مكرر الربحية (P/E)**: {_fmt(pe, 1)}x — {pe_analysis['rating_ar']}
   {pe_analysis['analysis_ar']}

🏦 **العائد على حقوق الملكية (ROE)**: {_fmt(roe, 1)}% — {roe_analysis['rating_ar']}
   {roe_analysis['analysis_ar']}

💵 **ربحية السهم (EPS)**: {_fmt(eps)} {currency}
   {eps_analysis['analysis_ar']}

📊 **مكرر القيمة الدفترية (P/B)**: {_fmt(pb, 2)}x — {pb_analysis['rating_ar']}
   {pb_analysis['analysis_ar']}

💸 **عائد التوزيعات**: {_fmt(div_yield, 2)}% — {div_analysis['rating_ar']}
   {div_analysis['analysis_ar']}
"""
    else:
        fundamental_section = """
━━━ **التحليل الأساسي** ━━━
🚫 **غير متاح لهذا السوق** — التحليل الأساسي يتطلب بيانات مالية (P/E, ROE, EPS) غير متوفرة للعملات الرقمية.
"""

    entry_rationale_ar = ('قرب مستوى الدعم' if entry == support else
                          'قرب المتوسط المتحرك 50' if entry == ma50 else
                          'نقطة دخول فنية')
    target1_rationale_ar = ('عند مستوى المقاومة' if calc_target1_is_resistance(target1, resistance)
                            else f"هدف فني محسوب بناءً على R:R (حد أدنى {profile['target_min_pct']}%)")
    stop_rationale_ar = ('تحت مستوى الدعم' if calc_stop_is_support(stop_loss, support)
                         else f"وقف فني (حد أقصى {profile['stop_max_pct']}% تحت الدخول)")

    full_report_ar = f"""
📊 **تحليل خبير: {name} ({data.get('ticker')})**
═══════════════════════════════════════

🎯 **التوصية**: {rec_ar}
📍 **السعر الحالي**: {_fmt(price)} {currency}
🏦 **القطاع**: {sector}
🌍 **السوق**: {profile['market_name_ar']}

━━━ **نقاط الدخول والخروج** ━━━
🟢 **نقطة الدخول**: {_fmt(entry)} {currency}
   المبرر: {entry_rationale_ar}
🎯 **الهدف الأول**: {_fmt(target1)} {currency} ({_fmt_pct(target1_pct)})
   المبرر: {target1_rationale_ar}
🚀 **الهدف الثاني**: {_fmt(target2)} {currency} ({_fmt_pct(target2_pct)})
   المبرر: هدف موسع بعد اختراق المقاومة
🔴 **وقف الخسارة**: {_fmt(stop_loss)} {currency} ({_fmt_pct(stop_pct)})
   المبرر: {stop_rationale_ar}
⚖️ **نسبة المخاطرة/العائد**: {_fmt_rr(rr)} (المستهدف ≥ {profile['min_rr']})

━━━ **التحليل الفني** ━━━
📈 **RSI**: {_fmt(rsi, 1)} — {rsi_analysis['signal_ar']}
   {rsi_analysis['analysis_ar']}

📊 **المتوسطات المتحركة**:
   MA50: {_fmt(ma50)} | MA200: {_fmt(ma200)}
   الاتجاه: {ma_analysis['trend_ar']}
   {ma_analysis['analysis_ar']}

🎯 **الدعم والمقاومة**:
   الدعم: {_fmt(support)} | المقاومة: {_fmt(resistance)}
   {sr_analysis['analysis_ar']}

📐 **نطاق 52 أسبوع**:
   الأدنى: {_fmt(low52)} | الأعلى: {_fmt(high52)}
   الموقع: {range_52w['position_ar']}
   {range_52w['analysis_ar']}
{fundamental_section}
━━━ **تقييم المخاطر** ━━━
⚠️ **مستوى المخاطرة**: {risk['level_ar']}
📏 **حجم المركز الموصى به**: {risk['positionSize_ar']}
{"📋 **عوامل المخاطر**:" + chr(10) + chr(10).join(f"   • {f}" for f in risk['factors_ar']) if risk['factors_ar'] else "   لا توجد عوامل مخاطر بارزة"}

━━━ **الخلاصة** ━━━
{expert_summary_ar}

⚠️ **إخلاء مسؤولية**: هذا التحليل لأغراض تعليمية وإعلامية فقط ولا يُعتبر توصية استثمارية ملزمة. الاستثمار في الأسهم ينطوي على مخاطر، يُرجى استشارة مستشار مالي مرخص قبل اتخاذ قرارات الاستثمار.
""".strip()

    confidence = data.get('confidence')
    if confidence is None:
        confidence = data.get('master_score')

    return {
        'ticker': data.get('ticker'),
        'name': name,
        'sector': sector,
        'recommendation': rec,
        'recommendation_ar': rec_ar,
        'confidence': confidence,
        'entry': {
            'price': entry,
            'rationale': ('Near support level' if entry == support else
                           'Near MA50' if entry == ma50 else 'Technical entry'),
            'rationale_ar': entry_rationale_ar,
        },
        'target1': {
            'price': target1,
            'pct': target1_pct,
            'rationale': ('At resistance level' if calc_target1_is_resistance(target1, resistance)
                          else 'Technical target based on R:R'),
            'rationale_ar': target1_rationale_ar,
        },
        'target2': {
            'price': target2,
            'pct': target2_pct,
            'rationale': 'Extended target after breakout',
            'rationale_ar': 'هدف موسع بعد الاختراق',
        },
        'stopLoss': {
            'price': stop_loss,
            'pct': stop_pct,
            'rationale': ('Below support level' if calc_stop_is_support(stop_loss, support)
                          else f"Technical stop ({profile['stop_max_pct']}% below entry)"),
            'rationale_ar': stop_rationale_ar,
        },
        'riskReward': rr,
        'technical': {
            'rsi': rsi_analysis,
            'movingAverages': ma_analysis,
            'supportResistance': sr_analysis,
            'range52w': range_52w,
            'summary': f"{rsi_analysis['signal']}, {ma_analysis['trend']}, {range_52w['position']}",
            'summary_ar': f"{rsi_analysis['signal_ar']}، {ma_analysis['trend_ar']}، {range_52w['position_ar']}",
        },
        'fundamental': {
            'peRatio': pe_analysis,
            'roe': roe_analysis,
            'eps': eps_analysis,
            'pbRatio': pb_analysis,
            'dividend': div_analysis,
            'summary': (f"{pe_analysis['rating']}, ROE {roe_analysis['rating']}, Div {div_analysis['rating']}"
                        if has_fundamentals else 'N/A — لا توجد أساسيات لهذا السوق'),
            'summary_ar': (f"{pe_analysis['rating_ar']}، ROE {roe_analysis['rating_ar']}، توزيعات {div_analysis['rating_ar']}"
                           if has_fundamentals else 'غير متاح — لا توجد أساسيات لهذا السوق'),
        },
        'risk': risk,
        'expertSummary': expert_summary,
        'expertSummary_ar': expert_summary_ar,
        'fullReport': full_report_ar,  # backward-compatible key name
        'fullReport_ar': full_report_ar,
    }


# ─── Helper predicates (kept top-level so f-strings stay readable) ──────
def calc_target1_is_resistance(target1: Optional[float], resistance: Optional[float]) -> bool:
    return target1 is not None and resistance is not None and target1 == resistance


def calc_stop_is_support(stop_loss: Optional[float], support: Optional[float]) -> bool:
    return stop_loss is not None and support is not None and stop_loss == support
