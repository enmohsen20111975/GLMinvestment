#!/usr/bin/env python3
"""
Institutional Decision Engine — V39 Full Dynamic Adaptive
=========================================================
محرك القرار المؤسسي (Inspired by LuxAlgo & BigBeluga V39 Pine Script)

بيوحّد كل المحركات الموجودة (SMC + VSA + Fusion + DNA + Candle Prob +
Fundamentals + Sector + Benchmark) في لوحة قرار واحدة بأسلوب TradingView V39:

  1. Maker State  (تجميع / تصريف / هدوء) — من SMC + VSA + Volume (ديناميكي بالانحراف المعياري)
  2. Flight State (طائر للأعلى / واقع للأسفل / عرضي / قابل للانفجار) — من BB + Break + Volume + Maker
  3. 6 Proofs     (ترند / ميكرز / بصمة / أساسي / قطاع / القوة النسبية) — نظام الإثباتات الستة
  4. Tech Score   (0-100) — مجموع الإثباتات + قاعدة ديناميكية
  5. Signal Final (شراء انفجار مؤسسي / شراء قوي / انتظر / بيع وتجنب)
  6. Portfolio Advice (امسك / زود / بيع / بيع جزئي) — حسب المركز المفتوح
  7. Backtest Tracking (win_rate, profit_factor, net_return) — تتبع الأداء الفعلي
  8. Self-Learning Threshold (dynamic_thresh) — تعلم ذاتي من الأداء السابق
  9. Model Quality — تقييم جودة النموذج (دقيق / محتاج ضبط)

V39 Changes from V34:
  - إثبات 6: القوة النسبية للمؤشر العام (outperforming benchmark)
  - حجم غير طبيعي ديناميكي: vol_surge = vol_ma + (vol_std × 1.5) بدل ratio ثابت
  - حالة القيمة العادلة ديناميكية: بناءً على الانحراف المعياري لـ premium بدل ±5% ثابت
  - وقف خسارة ديناميكي: ATR percentile → SL multiplier (1.0-2.5) بدل 1.5 ثابت
  - R:R ديناميكي: outperforming_market → 2.0 / else → 1.5
  - هدف البصمة كـ TP1: لو DNA projection bullish
  - تتبع باكتست: win_rate, profit_factor, total_trades, dynamic_thresh
  - تعلم ذاتي: ضبط الحد بناءً على نسبة النجاح (±10%)
  - مؤشر جودة النموذج: ✅ دقيق / ⚠️ محتاج ضبط

Usage:
    from analyzers.institutional_decision_engine import build_institutional_decision
    decision = build_institutional_decision(
        ticker='COMI',
        closes=[...], highs=[...], lows=[...], opens=[...], volumes=[...],
        rsi=55.0, atr=0.45, sma20=..., sma50=..., sma200=...,
        smc_data={'order_blocks': [...], 'fvgs': [...], 'sweeps': [...], 'score': 65},
        fusion_metrics={'fair_value': ..., 'fair_premium': ..., 'risk': {...}},
        quant_metrics={'vsa_absorption': True, 'ttm_squeeze': False, 'z_score': 1.2},
        candle_probabilities={'up_prob': 65, 'dn_prob': 35, 'bias': 'bullish'},
        stock_dna={'personality_type': 'momentum_stock', ...},
        fundamental_score=72,
        market_regime={'trend': 'bull', 'name': 'صعودي قوي'},
        bb_squeeze={'state': 'expanding'},
        levels={'support': ..., 'resistance': ..., 'accumulation_zone': True},
        sector_change=1.5,
        risk_params={'entry': ..., 'stop_loss': ..., 'target': ...},
        user_entry_price=12.5, user_entry_qty=100,
        # V39 new params:
        benchmark_change=-0.5,       # تغير المؤشر العام (EGX30, SPY, etc.)
        stock_roc=2.1,               # معدل تغير السهم (14 يوم)
        dna_target_price=None,       # هدف البصمة المستقبلية
        backtest_stats=None,         # {'win_rate': 65.2, 'profit_factor': 1.85, 'total_trades': 57}
    )
"""

import logging
import math
from typing import Any, Dict, List, Optional, Tuple
from analyzers.engine_settings import get_setting

# V40: Kill Filters من liquidity_filter
try:
    from analyzers.liquidity_filter import evaluate_kill_filters
    _KILL_FILTER_AVAILABLE = True
except ImportError:
    _KILL_FILTER_AVAILABLE = False

    def evaluate_kill_filters(*args, **kwargs):
        return {'passed': True, 'kill_reasons': [], 'kill_details': {}, 'kill_filter_active': False}

logger = logging.getLogger(__name__)


def _safe_float(val: Any, default: float = 0.0) -> float:
    """تحويل آمن لأي قيمة إلى float مع default."""
    try:
        if val is None:
            return default
        f = float(val)
        return f if f == f else default  # NaN check
    except (TypeError, ValueError):
        return default


def _compute_vol_stats(volumes: List[float], window: int = 20) -> Dict[str, float]:
    """
    حساب إحصائيات الحجم ديناميكياً (V39).

    Returns: {avg, std, dynamic_surge_threshold}
    الحجم غير طبيعي = المتوسط + (الانحراف المعياري × 1.5)
    """
    if not volumes or len(volumes) < 3:
        return {'avg': 0.0, 'std': 0.0, 'dynamic_surge_threshold': 0.0}

    recent = volumes[-window:] if len(volumes) >= window else volumes
    avg = sum(recent) / len(recent)

    # الانحراف المعياري
    variance = sum((v - avg) ** 2 for v in recent) / len(recent)
    std = math.sqrt(variance) if variance > 0 else 0.0

    # عامل السيولة الديناميكي (من engine_settings)
    surge_mult = get_setting('volume_surge_std_mult', default=1.5)
    dynamic_surge_threshold = avg + (std * surge_mult)

    return {
        'avg': avg,
        'std': std,
        'dynamic_surge_threshold': dynamic_surge_threshold,
    }


def _detect_maker_state(
    closes: List[float],
    opens: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    smc_data: Dict[str, Any],
    quant_metrics: Dict[str, Any],
    vol_ratio: float,
    atr_val: float,
) -> Dict[str, Any]:
    """
    كشف حالة الميكرز (تجميع / تصريف / هدوء) — V39 Dynamic.

    V39 التحسين:
      - الحجم غير طبيعي محسوب ديناميكياً (avg + std × 1.5)
      - هيكل الشمعة (upper_wick / lower_wick) بدل ATR ثابت
    """
    if not closes or len(closes) < 2:
        return {'state': 'calm', 'state_ar': 'هدوء', 'emoji': '⚪',
                'score_impact': 0, 'reason': 'بيانات غير كافية',
                'signals': []}

    last_close = closes[-1]
    last_open = opens[-1] if opens else last_close
    last_high = highs[-1] if highs else last_close
    last_low = lows[-1] if lows else last_close
    last_vol = volumes[-1] if volumes else 0.0

    # إحصائيات الحجم الديناميكية (V39)
    vol_stats = _compute_vol_stats(volumes)
    avg_vol = vol_stats['avg']
    vol_ma_ratio = (last_vol / avg_vol) if avg_vol > 0 else 1.0
    dynamic_surge = vol_stats['dynamic_surge_threshold']
    volume_surge = last_vol > dynamic_surge if dynamic_surge > 0 else vol_ma_ratio > get_setting('volume_absorption_ratio', default=1.5)

    # VSA absorption من quant_engine
    vsa_absorption = bool(quant_metrics.get('vsa_absorption', False))

    # SMC sweeps
    smc_sweeps = smc_data.get('sweeps', []) or []
    sweep_bullish = any(s.get('type') == 'bullish_sweep' for s in smc_sweeps)
    sweep_bearish = any(s.get('type') == 'bearish_sweep' for s in smc_sweeps)

    # هيكل الشمعة (V39 — بدل ATR ثابت)
    candle_range = max(last_high - last_low, 0.0001)
    upper_wick = last_high - max(last_close, last_open)
    lower_wick = min(last_close, last_open) - last_low

    # V40: تشديد شروط Absorption/Distribution باستخدام engine_settings
    # الفلسفة: تقليل false positives بـ اشتراط هيكل شمعة أوضح + إغلاق في النصف العلوي
    _absorption_wick_pct = get_setting('absorption_lower_wick_pct', default=0.75)  # V40: 0.70 → 0.75
    _distribution_wick_pct = get_setting('distribution_upper_wick_pct', default=0.65)  # V40: 0.60 → 0.65
    _require_upper_half = get_setting('absorption_require_upper_half_close', default=1.0) >= 1.0
    _absorption_min_vol_ratio = get_setting('absorption_min_volume_ratio', default=1.3)  # V40: حجم أدنى للامتصاص

    # V39.2 → V40: امتصاص EGX — 3 أنماط (مشددة):
    #   1. شمعة حمراء + ذيل سفلي ≥ 75% + حجم غير طبيعي + إغلاق في النصف العلوي (إلزامي)
    #   2. Volume > avg AND |price change| < 1% — نمط التجميع المصري (الحيتان بلمون في سكون)
    #   3. VSA absorption أو bullish sweep + volume surge
    price_change_pct = abs(((last_close - last_open) / last_open) * 100) if last_open > 0 else 0
    candle_midpoint = (last_high + last_low) / 2
    closed_upper_half = last_close >= candle_midpoint
    egx_quiet_absorption = volume_surge and price_change_pct < 1.0 and closed_upper_half

    # V40: امتصاص الهيكل — ذيل سفلي ≥ 75% + حجم كافي + (إغلاق علوي إلزامي لو مفعّل)
    structure_absorption = (
        last_close < last_open
        and lower_wick > (candle_range * _absorption_wick_pct)
        and volume_surge
        and (closed_upper_half if _require_upper_half else True)
    )
    # V40: التحقق من نسبة الحجم الأدنى للامتصاص
    volume_ratio_sufficient = vol_ma_ratio >= _absorption_min_vol_ratio

    is_absorption = (
        (vsa_absorption and volume_ratio_sufficient)
        or (structure_absorption and volume_ratio_sufficient)
        or (sweep_bullish and volume_surge)
        or (egx_quiet_absorption and volume_ratio_sufficient)
    )

    # V40: تصريف = شمعة خضراء + ذيل علوي ≥ 65% + حجم غير طبيعي (tightened من 60% لـ 65%)
    is_distribution = (
        last_close > last_open and upper_wick > (candle_range * _distribution_wick_pct) and volume_surge
    ) or sweep_bearish

    # V39: حجم متلاشي ديناميكي (vol < avg - 0.5 × std)
    no_supply_threshold = avg_vol - (vol_stats['std'] * 0.5) if vol_stats['std'] > 0 else avg_vol * get_setting('volume_no_supply_ratio', default=0.5)
    no_supply = last_vol < no_supply_threshold and last_close < last_open  # مفيش عرض = تجميع
    no_demand = last_vol < no_supply_threshold and last_close > last_open  # مفيش طلب = تصريف

    # تحديد الحالة النهائية
    signals = []
    if is_absorption or no_supply:
        signals.append('تجميع خفي')
        if egx_quiet_absorption:
            signals.append('تجميع مصري ساكن (حجم عالي + سعر مستقر)')
        if sweep_bullish:
            signals.append('سحب سيولة صاعد')
        state = 'absorption'
        state_ar = 'تجميع خفي'
        emoji = '🟢'
        score_impact = int(get_setting('proof_weight_makers', default=20))
        reason = f'V39.2: حجم ديناميكي ({volume_surge}) + هيكل شمعة + VSA={vsa_absorption} + EGX_quiet={egx_quiet_absorption}'
    elif is_distribution or no_demand:
        signals.append('تصريف')
        if sweep_bearish:
            signals.append('سحب سيولة هابط')
        state = 'distribution'
        state_ar = 'تصريف'
        emoji = '🔴'
        score_impact = -int(get_setting('proof_weight_makers', default=20))
        reason = f'V39: تصريف ديناميكي + bearish sweep={sweep_bearish}'
    else:
        state = 'calm'
        state_ar = 'هدوء'
        emoji = '⚪'
        score_impact = 0
        reason = f'لا تجميع ولا تصريف واضح (vol_ratio={vol_ma_ratio:.2f}, surge={volume_surge})'

    return {
        'state': state,
        'state_ar': state_ar,
        'emoji': emoji,
        'score_impact': score_impact,
        'reason': reason,
        'signals': signals,
        'vol_ratio': round(vol_ma_ratio, 2),
        'vsa_absorption': vsa_absorption,
        'sweep_bullish': sweep_bullish,
        'sweep_bearish': sweep_bearish,
        'no_supply': no_supply,
        'no_demand': no_demand,
        'volume_surge': volume_surge,
        'egx_quiet_absorption': egx_quiet_absorption,  # V39.2: نمط التجميع المصري (حجم عالي + سعر ساكن)
    }


def _detect_flight_state(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    smc_data: Dict[str, Any],
    bb_squeeze: Dict[str, Any],
    vol_ratio: float,
    maker_state: Dict[str, Any],
    levels: Dict[str, Any],
) -> Dict[str, Any]:
    """
    كشف حالة الطيران (طائر للأعلى / واقع للأسفل / عرضي) — V39.

    V39 التحسين:
      - حالة BB ديناميكية (squeeze / expanding / normal) مع حالة عرضية نايمة
    """
    if not closes or len(closes) < 5:
        return {'state': 'sideways', 'state_ar': 'عرضي 😴',
                'emoji': '⚪', 'reason': 'بيانات غير كافية'}

    last_close = closes[-1]
    prev_close = closes[-2] if len(closes) >= 2 else last_close

    # BB state
    bb_state = ''
    if isinstance(bb_squeeze, dict):
        bb_state = str(bb_squeeze.get('state', '')).lower()
    is_expanding = bb_state in ('expanding', 'expansion', 'wide')
    is_squeeze = bb_state in ('squeeze', 'extreme_squeeze', 'compressed')

    # Break detection
    resistance = _safe_float(levels.get('resistance'), 0.0)
    support = _safe_float(levels.get('support'), 0.0)

    # استخدام smc_data.score كـ proxy لقوة الكسر
    smc_score = _safe_float(smc_data.get('score'), 50.0)
    broke_resist = smc_score >= get_setting('smc_broke_resistance_score', default=60) or (resistance > 0 and last_close > resistance and prev_close <= resistance)
    broke_support = smc_score <= get_setting('smc_broke_support_score', default=40) or (support > 0 and last_close < support and prev_close >= support)

    # Volume surge
    volume_surge = vol_ratio > get_setting('volume_surge_institutional', default=1.3)

    # Maker direction
    maker_bullish = maker_state.get('state') == 'absorption'
    maker_bearish = maker_state.get('state') == 'distribution'

    # Flight state logic (V39 — 4 حالات)
    if broke_resist and is_expanding and (maker_bullish or volume_surge):
        state = 'flying_up'
        state_ar = 'طائر للأعلى 🚀'
        emoji = '🚀'
        reason = 'كسر مقاومة + BB متسع + تجميع ميكرز/حجم مرتفع'
        color = 'lime'
    elif broke_support and is_expanding and (maker_bearish or volume_surge):
        state = 'falling_down'
        state_ar = 'واقع للأسفل 📉'
        emoji = '📉'
        reason = 'كسر دعم + BB متسع + تصريف ميكرز/حجم مرتفع'
        color = 'red'
    elif is_squeeze:
        state = 'coiling'
        state_ar = 'عرضي نايم 😴 (قابل للانفجار)'
        emoji = '⚡'
        reason = 'BB squeeze — السهم بيتجمع قبل انفجار'
        color = 'amber'
    else:
        state = 'sideways'
        state_ar = 'عرضي 😴'
        emoji = '⚪'
        reason = 'لا كسر واضح ولا تمدد في BB'
        color = 'gray'

    return {
        'state': state,
        'state_ar': state_ar,
        'emoji': emoji,
        'color': color,
        'reason': reason,
        'broke_resist': broke_resist,
        'broke_support': broke_support,
        'is_expanding': is_expanding,
        'is_squeeze': is_squeeze,
        'volume_surge': volume_surge,
    }


def _build_6_proofs(
    closes: List[float],
    sma200: float,
    maker_state: Dict[str, Any],
    candle_probabilities: Optional[Dict[str, Any]],
    stock_dna: Optional[Dict[str, Any]],
    fundamental_score: float,
    sector_change: float,
    market_regime: Dict[str, Any],
    # V39 new params
    stock_roc: float = 0.0,
    benchmark_change: float = 0.0,
) -> List[Dict[str, Any]]:
    """
    بناء 6 إثباتات (Proofs) بأسلوب V39:
      1. الترند (close vs sma200)
      2. الميكرز (absorption/distribution)
      3. البصمة (candle probability + stock DNA)
      4. الأساسيات (fundamental_score)
      5. القطاع (sector_change + market_regime)
      6. القوة النسبية للمؤشر العام (stock_roc vs benchmark_roc) — V39 NEW
    """
    proofs = []

    # ── Proof 1: Trend ──
    last_close = closes[-1] if closes else 0
    trend_up = bool(sma200 and sma200 > 0 and last_close > sma200)
    proofs.append({
        'id': 1,
        'name': 'trend',
        'name_ar': 'إثبات 1 (الترند)',
        'passed': trend_up,
        'emoji': '✅' if trend_up else '❌',
        'text': '✅ الترند صاعد' if trend_up else '❌ الترند هابط',
        'detail': f'السعر {last_close:.2f} {"أعلى" if trend_up else "أقل من"} SMA200 ({sma200:.2f})',
        'score_impact': int(get_setting('proof_weight_trend', default=15)) if trend_up else -int(get_setting('proof_weight_trend', default=15)),
    })

    # ── Proof 2: Maker ──
    maker_bullish = maker_state.get('state') == 'absorption'
    maker_bearish = maker_state.get('state') == 'distribution'
    proofs.append({
        'id': 2,
        'name': 'maker',
        'name_ar': 'إثبات 2 (الميكرز)',
        'passed': maker_bullish,
        'emoji': '✅' if maker_bullish else ('❌' if maker_bearish else '⚪'),
        'text': '✅ ميكرز بيجمع' if maker_bullish
                else ('❌ ميكرز بيوزع' if maker_bearish else '⚪ ميكرز ساكن'),
        'detail': maker_state.get('reason', ''),
        'score_impact': int(get_setting('proof_weight_makers', default=20)) if maker_bullish else (-int(get_setting('proof_weight_makers', default=20)) if maker_bearish else 0),
    })

    # ── Proof 3: DNA / Candle Probability ──
    dna_bullish = False
    dna_detail = 'غير متاح'
    if candle_probabilities:
        cp_bias = str(candle_probabilities.get('bias', '')).lower()
        cp_up = _safe_float(candle_probabilities.get('up_prob'), 50)
        if cp_bias == 'bullish' or cp_up > get_setting('candle_prob_bullish_threshold', default=55):
            dna_bullish = True
            dna_detail = f'احتمال صعود الشمعة الجاية = {cp_up:.1f}%'
        elif cp_bias == 'bearish' or cp_up < get_setting('candle_prob_bearish_threshold', default=45):
            dna_detail = f'احتمال هبوط الشمعة الجاية = {100 - cp_up:.1f}%'
    if stock_dna:
        personality = str(stock_dna.get('personality_type', '')).lower()
        if any(k in personality for k in ['momentum', 'bull', 'growth', 'amplifier']):
            dna_bullish = True
            dna_detail += f' | بصمة السهم: {stock_dna.get("personality_type", "")}'

    proofs.append({
        'id': 3,
        'name': 'dna',
        'name_ar': 'إثبات 3 (البصمة)',
        'passed': dna_bullish,
        'emoji': '✅' if dna_bullish else '❌',
        'text': '✅ البصمة المستقبلية طالعة' if dna_bullish else '❌ البصمة المستقبلية نازلة',
        'detail': dna_detail,
        'score_impact': int(get_setting('proof_weight_dna', default=15)) if dna_bullish else -int(get_setting('proof_weight_dna', default=15)),
    })

    # ── Proof 4: Fundamentals ──
    fund_score = _safe_float(fundamental_score, 0)
    if fund_score > 0:
        fund_strong = fund_score >= get_setting('fund_score_strong', default=60)
        fund_text = '✅ الأساسيات قوية' if fund_strong else ('🟡 الأساسيات مقبولة' if fund_score >= 40 else '❌ الأساسيات ضعيفة')
        fund_impact = int(get_setting('proof_weight_fundamental', default=15)) if fund_strong else (-int(get_setting('proof_weight_fundamental', default=15)) if fund_score < get_setting('fund_score_weak', default=40) else 0)
        fund_detail = f'درجة الأساسيات = {fund_score:.1f}/100'
    else:
        fund_strong = False
        fund_text = '⏳ الأساسيات غير متاحة'
        fund_impact = 0
        fund_detail = 'لا توجد بيانات أساسية متاحة'
    proofs.append({
        'id': 4,
        'name': 'fundamentals',
        'name_ar': 'إثبات 4 (الأساسي)',
        'passed': fund_strong,
        'emoji': '✅' if fund_strong else ('❌' if fund_score > 0 and fund_score < 40 else '⏳'),
        'text': fund_text,
        'detail': fund_detail,
        'score_impact': fund_impact,
    })

    # ── Proof 5: Sector / Market Regime ──
    sector_bull = False
    sector_detail = ''
    sec_change = _safe_float(sector_change, 0)
    regime_trend = str(market_regime.get('trend', '')).lower() if isinstance(market_regime, dict) else ''

    # V39: القطاع ديناميكي — بناءً على الانحراف المعياري
    if sec_change != 0:
        # لو عندنا sector_std، نستخدمه — fallback لـ >0
        sector_bull = sec_change > 0
        sector_detail = f'تغير القطاع = {sec_change:+.2f}%'
    elif regime_trend:
        sector_bull = regime_trend in ('bull', 'bullish', 'strong_bull')
        sector_detail = f'حالة السوق = {market_regime.get("name", regime_trend)}'

    proofs.append({
        'id': 5,
        'name': 'sector',
        'name_ar': 'إثبات 5 (القطاع)',
        'passed': sector_bull,
        'emoji': '✅' if sector_bull else '❌',
        'text': '✅ القطاع أخضر ديناميكياً' if sector_bull else '❌ القطاع أحمر',
        'detail': sector_detail,
        'score_impact': int(get_setting('proof_weight_sector', default=10)) if sector_bull else -int(get_setting('proof_weight_sector', default=10)),
    })

    # ── Proof 6: Benchmark Relative Strength (V39 NEW) ──
    stock_roc_val = _safe_float(stock_roc, 0)
    bench_roc_val = _safe_float(benchmark_change, 0)
    relative_strength = stock_roc_val - bench_roc_val
    outperforming_market = relative_strength > 0

    proofs.append({
        'id': 6,
        'name': 'benchmark',
        'name_ar': 'إثبات 6 (السوق العام)',
        'passed': outperforming_market,
        'emoji': '✅' if outperforming_market else '❌',
        'text': '✅ أقوى من السوق العام' if outperforming_market else '❌ أضعف من السوق العام',
        'detail': f'ROC السهم={stock_roc_val:+.2f}% vs المؤشر={bench_roc_val:+.2f}% → RS={relative_strength:+.2f}%',
        'score_impact': int(get_setting('proof_weight_benchmark', default=15)) if outperforming_market else -int(get_setting('proof_weight_benchmark', default=15)),
    })

    return proofs


def _compute_tech_score(proofs: List[Dict[str, Any]]) -> int:
    """
    حساب Tech Score من 0-100 (قاعدة ديناميكية + مجموع الإثباتات).
    V39: القاعدة ديناميكية من engine_settings.
    V40: Tech Score بقت مؤشر مساعد فقط — القرار النهائي بناءً على عد الأدلة.
    """
    score = get_setting('tech_score_base', default=50)
    for p in proofs:
        score += p.get('score_impact', 0)
    return max(0, min(100, int(score)))


def _count_strong_evidences(proofs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    V40: عد الأدلة المتوافقة — أساس قرار الإشارة الجديد.
    
    الفلسفة: قرار الإشارة بناءً على عدد الأدلة المتوافقة، مش threshold على score.
    
    الأدلة الـ 6:
      1. trend      — هيكل السعر / الترند
      2. maker      — تجميع مؤسسي (الأولوية 1)
      3. dna        — البصمة المستقبلية
      4. fundamentals — الأساسيات (وزن منخفض)
      5. sector     — زخم القطاع
      6. benchmark  — القوة النسبية (الأولوية 2)
    
    Returns:
        dict فيه:
          - strong_count: int — عدد الأدلة القوية (passed=True)
          - weak_count: int — عدد الأدلة الضعيفة (passed=False ولها score_impact سالب)
          - neutral_count: int — الأدلة المحايدة (passed=False ولكن score_impact=0)
          - maker_passed: bool — هل الميكرز بيجمع؟ (الأولوية 1)
          - benchmark_passed: bool — هل القوة النسبية إيجابية؟ (الأولوية 2)
          - has_distribution: bool — هل فيه تصريف واضح؟ (من maker_state)
          - strong_evidence_names: List[str] — أسماء الأدلة القوية
          - weak_evidence_names: List[str] — أسماء الأدلة الضعيفة
    """
    proofs = proofs or []
    strong_count = 0
    weak_count = 0
    neutral_count = 0
    strong_names = []
    weak_names = []
    maker_passed = False
    benchmark_passed = False

    for p in proofs:
        name = p.get('name', '')
        passed = bool(p.get('passed', False))
        impact = int(p.get('score_impact', 0))

        if name == 'maker':
            maker_passed = passed
        if name == 'benchmark':
            benchmark_passed = passed

        if passed:
            strong_count += 1
            strong_names.append(name)
        elif impact < 0:
            weak_count += 1
            weak_names.append(name)
        else:
            neutral_count += 1

    return {
        'strong_count': strong_count,
        'weak_count': weak_count,
        'neutral_count': neutral_count,
        'maker_passed': maker_passed,
        'benchmark_passed': benchmark_passed,
        'has_distribution': False,  # يُحدّث من maker_state في _compute_signal_final
        'strong_evidence_names': strong_names,
        'weak_evidence_names': weak_names,
    }


def _check_market_breadth_veto(
    market_regime: Optional[Dict[str, Any]],
    benchmark_change: float = 0.0,
    breadth_pct: Optional[float] = None,
) -> Tuple[bool, str]:
    """
    AXIS-4: Market Breadth Hard Veto — لا توصيات شراء في سوق هابط.

    يحسب هل السوق هابط بدرجة تستوجب الفيتو:
      1. EGX30/المؤشر هابط: market_regime.trend == 'bear' AND confidence > 0.7
         OR benchmark_change < -1.0 (المؤشر نزل أكتر من 1%)
      2. Breadth ضعيف: breadth_pct < 40 (أقل من 40% من الأسهم صاعدة)

    Returns:
        (vetoed: bool, reason_ar: str) — لو vetoed=True، السوق هابط → وضع الكاش.
    """
    # AXIS-4: مفتاح تشغيل/إيقاف الفيتو من engine_settings
    if get_setting('market_breadth_veto_enabled', default=1.0) < 1.0:
        return (False, '')

    reasons: List[str] = []

    # (1) regime_bearish — market_regime.trend == 'bear' AND confidence > 0.7
    regime_bearish = False
    if market_regime and isinstance(market_regime, dict):
        regime_trend = str(market_regime.get('trend', '')).lower()
        regime_confidence = float(market_regime.get('confidence', 0.0))
        if regime_trend in ('bear', 'bear_trend') and regime_confidence > 0.7:
            regime_bearish = True
            reasons.append(
                f'ميكرو-ترند هابط (ثقة {regime_confidence:.0%})'
            )

    # (2) benchmark_down — EGX30 نزل أكتر من 1%
    benchmark_drop_threshold = float(
        get_setting('market_bearish_benchmark_drop', default=-1.0)
    )
    benchmark_down = float(benchmark_change) < benchmark_drop_threshold
    if benchmark_down:
        reasons.append(
            f'المؤشر نزل {benchmark_change:+.2f}% (< {benchmark_drop_threshold}%)'
        )

    # (3) breadth_weak — أقل من 40% من الأسهم صاعدة
    breadth_threshold = float(
        get_setting('market_breadth_threshold_pct', default=40.0)
    )
    breadth_weak = False
    if breadth_pct is not None:
        try:
            breadth_val = float(breadth_pct)
            if breadth_val < breadth_threshold:
                breadth_weak = True
                reasons.append(
                    f'breadth ضعيف ({breadth_val:.1f}% < {breadth_threshold:.0f}%)'
                )
        except (ValueError, TypeError):
            breadth_weak = False

    if regime_bearish or benchmark_down or breadth_weak:
        return (True, ' + '.join(reasons) if reasons else 'سوق هابط')

    return (False, '')


def _compute_signal_final(
    tech_score: int,
    maker_state: Dict[str, Any],
    flight_state: Dict[str, Any],
    dynamic_thresh: float = 75.0,
    market_regime: Optional[Dict[str, Any]] = None,
    # V39.3: additional context for smart regime filtering
    proofs: Optional[List[Dict[str, Any]]] = None,
    # V40: kill_filter_result للتحقق من فلاتر الاستبعاد
    kill_filter_result: Optional[Dict[str, Any]] = None,
    # AXIS-4: benchmark_change + breadth_pct لفيتو السوق الهابط
    benchmark_change: float = 0.0,
    breadth_pct: Optional[float] = None,
) -> Tuple[str, str, str]:
    """
    حساب الإشارة النهائية + المسار المختار + اللون — V40 Evidence-Based Decision.
    
    V40 الفلسفة الجديدة:
      قرار الإشارة بناءً على عدد الأدلة المتوافقة، مش threshold على score.
      - Strong Buy: 3+ أدلة قوية + RS إيجابية (إلزامي) + سيولة كافية
      - Buy: 2+ أدلة قوية + عدم وجود دليل ضعف واضح
      - Hold/Watch: باقي الحالات
      - Reduce: 2+ أدلة ضعف
      - Sell: تصريف واضح + ضعف نسبي
    
    الـ tech_score بقت مؤشر مساعد فقط (للعرض والمراقبة)، مش الحاكم.
    
    Returns: (signal, path_taken, color)
    """
    maker_bullish = maker_state.get('state') == 'absorption'
    maker_bearish = maker_state.get('state') == 'distribution'
    flight_up = flight_state.get('state') == 'flying_up'
    proofs = proofs or []

    # V40: عد الأدلة المتوافقة
    evidence = _count_strong_evidences(proofs)
    evidence['has_distribution'] = maker_bearish
    strong_count = evidence['strong_count']
    weak_count = evidence['weak_count']
    maker_passed = evidence['maker_passed']
    benchmark_passed = evidence['benchmark_passed']
    has_distribution = evidence['has_distribution']

    # V40: Kill Filter — لو السهم فشل في أي فلتر استبعاد → HOLD فوري
    if kill_filter_result and not kill_filter_result.get('passed', True):
        reasons = kill_filter_result.get('kill_reasons', [])
        reason_text = ' | '.join(reasons[:2]) if reasons else 'فشل في فلاتر الاستبعاد'
        return (
            '🚫 تجنب (Kill Filter)',
            f'فلاتر الاستبعاد: {reason_text}',
            'red',
        )

    # ── V40: Smart regime filter (خصم بدل حظر) — محفوظ من V39.3 ──────────
    regime_bearish = False
    bear_deduction = 0
    if market_regime and isinstance(market_regime, dict):
        regime_trend = str(market_regime.get('trend', '')).lower()
        regime_confidence = float(market_regime.get('confidence', 0.0))
        if regime_trend in ('bear', 'bear_trend') and regime_confidence > 0.7:
            regime_bearish = True
            base_deduction = int(get_setting('bear_regime_score_deduction', default=15))
            strong_stock_override = maker_passed and benchmark_passed
            if strong_stock_override:
                bear_deduction = max(base_deduction // 3, 5)
            else:
                bear_deduction = base_deduction
            if regime_confidence < 0.85:
                bear_deduction = int(bear_deduction * 0.7)

    adjusted_score = tech_score - bear_deduction

    # ── V40: قرارات البيع/التقليل أولاً (أولوية الحماية) ──────────────────
    # Sell: تصريف واضح + ضعف نسبي
    if has_distribution and not benchmark_passed:
        return (
            '🔴 بيع وتجنب',
            f'تصريف مؤسسي + ضعف نسبي — أدلة ضعف: {", ".join(evidence["weak_evidence_names"]) or "تصريف+RS"}',
            'red',
        )

    # Reduce: 2+ أدلة ضعف
    _sell_evidence_count = int(get_setting('sell_evidence_count', default=2))
    if weak_count >= _sell_evidence_count:
        return (
            '🟠 وقف وتقليل',
            f'{weak_count} أدلة ضعف ({", ".join(evidence["weak_evidence_names"])}) — قلل المراكز',
            'orange',
        )

    # Sell threshold القديم محفوظ كـ fallback
    if adjusted_score <= get_setting('institutional_sell_threshold', default=25):
        return (
            '🔴 بيع وتجنب',
            f'ضعف هيكلي (Tech Score {adjusted_score} ≤ {get_setting("institutional_sell_threshold", default=25)})',
            'red',
        )

    # ── AXIS-4: Market Breadth Hard Veto — لا شراء في سوق هابط (وضع الكاش) ──
    market_vetoed, veto_reason = _check_market_breadth_veto(market_regime, benchmark_change, breadth_pct)
    if market_vetoed:
        return (
            '🟡 انتظر (فيتو السوق)',
            f'سوق هابط — {veto_reason} → وضع الكاش (لا توصيات شراء)',
            'yellow',
        )

    # ── V40: قرارات الشراء بناءً على عد الأدلة المتوافقة ──────────────────
    _strong_buy_count = int(get_setting('strong_buy_evidence_count', default=3))
    _buy_count = int(get_setting('buy_evidence_count', default=2))
    _rs_required_strong = get_setting('rs_required_for_strong_buy', default=1.0) >= 1.0
    _rs_required_buy = get_setting('rs_required_for_buy', default=0.0) >= 1.0
    _weak_blocks_buy = get_setting('weak_evidence_blocks_buy', default=1.0) >= 1.0

    # V40: الانفجار المؤسسي — maker_bullish AND flight_up + 3+ أدلة (الأعلى أولوية)
    if maker_bullish and flight_up and strong_count >= _strong_buy_count:
        # في السوق الهابط: لو فيه RS إيجابي → اسمح؛ غير كده → انتظر
        if regime_bearish and _rs_required_strong and not benchmark_passed:
            return (
                '🟡 انتظر',
                f'انفجار مؤسسي لكن RS سلبي في سوق هابط → انتظر ({strong_count} أدلة قوية)',
                'yellow',
            )
        return (
            '🟢 شراء (انفجار مؤسسي)',
            f'تطابق كامل + {strong_count} أدلة قوية: ميكرز بيجمع + BB متسع + كسر مقاومة',
            'purple',
        )

    # V40: Strong Buy — 3+ أدلة قوية + RS إيجابية (إلزامي لو مفعّل)
    rs_ok_for_strong = (not _rs_required_strong) or benchmark_passed
    if strong_count >= _strong_buy_count and rs_ok_for_strong:
        # في السوق الهابط: خصم bear_deduction محفوظ للعرض
        regime_note = f' (خصم bear={bear_deduction})' if bear_deduction > 0 else ''
        return (
            '🟢 شراء مؤسسي قوي',
            f'{strong_count} أدلة متوافقة + RS إيجابي (Score {adjusted_score}{regime_note}) — {", ".join(evidence["strong_evidence_names"])}',
            'lime',
        )

    # V40: Buy — 2+ أدلة قوية + عدم وجود دليل ضعف واضح
    rs_ok_for_buy = (not _rs_required_buy) or benchmark_passed
    weak_blocks = _weak_blocks_buy and weak_count >= 1
    if strong_count >= _buy_count and not weak_blocks and rs_ok_for_buy:
        # V40: Accumulation Override — لو maker + benchmark → شراء بحد أقل
        if maker_passed and benchmark_passed and strong_count >= 3:
            return (
                '🟢 شراء (تجميع مؤسسي)',
                f'تجميع خفي + قوة نسبية + {strong_count} أدلة (Score {adjusted_score})',
                'green',
            )
        regime_note = f' (خصم bear={bear_deduction})' if bear_deduction > 0 else ''
        return (
            '🟢 شراء',
            f'{strong_count} أدلة متوافقة (Score {adjusted_score}{regime_note}) — {", ".join(evidence["strong_evidence_names"])}',
            'green',
        )

    # V40: Reduce fallback — Tech Score ≤ 40
    if adjusted_score <= get_setting('institutional_reduce_threshold', default=40):
        return (
            '🟠 وقف وتقليل',
            f'Tech Score {adjusted_score} ≤ {get_setting("institutional_reduce_threshold", default=40)} — قلل المراكز',
            'orange',
        )

    # V40: Hold/Watch — باقي الحالات
    return (
        '🟡 انتظر',
        f'أدلة كافية مش متوفرة ({strong_count} قوية / {weak_count} ضعيفة، Score {adjusted_score})',
        'yellow',
    )


def _compute_portfolio_advice(
    user_entry_price: float,
    user_entry_qty: float,
    current_price: float,
    stop_loss: float,
    maker_state: Dict[str, Any],
    trend_up: bool,
) -> Optional[Dict[str, Any]]:
    """
    نصيحة مدير المحفظة (V39 Portfolio Manager) حسب المركز المفتوح.

    Returns: dict فيه action, color, pnl_pct, pnl_value, exit_type
             أو None لو مفيش مركز مفتوح.
    """
    if not user_entry_price or user_entry_price <= 0 or not user_entry_qty:
        return None

    pnl_pct = ((current_price - user_entry_price) / user_entry_price) * 100 if user_entry_price > 0 else 0
    pnl_value = (current_price - user_entry_price) * user_entry_qty

    is_distribution = maker_state.get('state') == 'distribution'
    is_absorption = maker_state.get('state') == 'absorption'

    # تحديد نوع الخروج
    exit_type = 'hold'
    exit_pct = 0  # نسبة البيع من المركز

    if current_price <= stop_loss:
        action = '🔴 ارمي الورق! البوق اتنكسر.'
        color = 'red'
        exit_type = 'stop_loss'
        exit_pct = 100
    elif is_distribution:
        action = '🟠 الميكرز بيوزع! خد فلوسك (بيع جزئي 50%).'
        color = 'orange'
        exit_type = 'partial_sell'
        exit_pct = int(get_setting('partial_sell_pct', default=50))
    elif pnl_pct > get_setting('scale_in_pnl_threshold', default=15) and is_absorption:
        # V39.2: Scale-in only during institutional accumulation — protects against averaging down during distribution.
        is_accumulation = maker_state.get('state') == 'accumulation'
        if is_absorption or is_accumulation:
            action = '🟢 زود المركز! السهم لسه بيولع.'
            color = 'green'
            exit_type = 'scale_in'
            exit_pct = 0
        else:
            action = '🟡 امسك ساكت — Scale-in محتاج تجميع مؤسسي.'
            color = 'yellow'
            exit_type = 'hold'
            exit_pct = 0
    elif trend_up and pnl_pct > get_setting('trailing_stop_activation_gain', default=2.0):
        action = '🟢 امسك وانت مطمن (Trailing Stop مفعل).'
        color = 'green'
        exit_type = 'trail'
        exit_pct = 0
    elif pnl_pct < get_setting('danger_pnl_threshold', default=-5):
        action = '🟡 امسك ساكت بس راقب — قربت من الخطر.'
        color = 'yellow'
        exit_type = 'watch'
        exit_pct = 0
    else:
        action = '🟡 امسك ساكت.'
        color = 'yellow'
        exit_type = 'hold'
        exit_pct = 0

    return {
        'action': action,
        'color': color,
        'pnl_pct': round(pnl_pct, 2),
        'pnl_value': round(pnl_value, 2),
        'entry_price': round(user_entry_price, 4),
        'entry_qty': int(user_entry_qty),
        'current_price': round(current_price, 4),
        'exit_type': exit_type,
        'exit_pct': exit_pct,
        'stop_loss': round(stop_loss, 4),
    }


def _compute_dynamic_fair_state(
    fair_premium: float,
    recent_premiums: List[float] = None,
) -> Tuple[str, str]:
    """
    حساب حالة القيمة العادلة ديناميكياً (V39).

    بدل ±5% ثابت، نستخدم الانحراف المعياري لـ premium التاريخي:
      - غالي: premium > +1 std
      - رخيص: premium < -1 std
      - عادل: بينهم

    Returns: (fair_state, fair_detail)
    """
    if recent_premiums and len(recent_premiums) >= 10:
        avg = sum(recent_premiums) / len(recent_premiums)
        variance = sum((p - avg) ** 2 for p in recent_premiums) / len(recent_premiums)
        std = math.sqrt(variance) if variance > 0 else 0.0

        if std > 0:
            if fair_premium > std:
                return 'غالي', f'premium ({fair_premium:+.1f}%) > +1σ ({std:.1f}%)'
            elif fair_premium < -std:
                return 'رخيص', f'premium ({fair_premium:+.1f}%) < -1σ ({-std:.1f}%)'
            else:
                return 'عادل', f'premium ({fair_premium:+.1f}%) ضمن ±1σ ({std:.1f}%)'

    # Fallback: إعدادات ثابتة (لما مفيش بيانات كافية)
    if fair_premium > get_setting('vwap_premium_threshold', default=5):
        return 'غالي', f'premium ({fair_premium:+.1f}%) > {get_setting("vwap_premium_threshold", default=5)}%'
    elif fair_premium < get_setting('vwap_discount_threshold', default=-5):
        return 'رخيص', f'premium ({fair_premium:+.1f}%) < {get_setting("vwap_discount_threshold", default=-5)}%'
    else:
        return 'عادل', f'premium ({fair_premium:+.1f}%) ضمن النطاق'


def _compute_dynamic_sl_mult(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    atr_val: float,
) -> float:
    """
    حساب عامل وقف الخسارة الديناميكي (V39).

    بناءً على رتبة ATR المئوية (ATR percentile):
      - ATR percentile > 80% (تذبذب عالي) → multiplier 2.5
      - ATR percentile < 20% (تذبذب منخفض) → multiplier 1.0
      - بينهم → multiplier 1.5

    كلما زاد التذبذب، زادت مسافة وقف الخسارة.
    """
    if not closes or len(closes) < 20 or atr_val <= 0:
        return get_setting('atr_stop_mult_default', default=1.5)

    # حساب ATRs تاريخية بسيطة
    atrs = []
    for i in range(1, min(len(closes), 100)):
        idx = len(closes) - i
        if idx > 0:
            tr = max(
                highs[idx] - lows[idx],
                abs(highs[idx] - closes[idx - 1]),
                abs(lows[idx] - closes[idx - 1])
            )
            atrs.append(tr)

    if not atrs:
        return get_setting('atr_stop_mult_default', default=1.5)

    # حساب رتبة ATR المئوية
    sorted_atrs = sorted(atrs)
    rank = sum(1 for a in sorted_atrs if a <= atr_val)
    atr_percentile = (rank / len(sorted_atrs)) * 100

    # عامل SL ديناميكي
    high_mult = get_setting('atr_stop_mult_high_vol', default=2.5)
    low_mult = get_setting('atr_stop_mult_low_vol', default=1.0)
    mid_mult = get_setting('atr_stop_mult_default', default=1.5)

    if atr_percentile > 80:
        return high_mult
    elif atr_percentile < 20:
        return low_mult
    else:
        # Interpolation خطي
        return low_mult + (atr_percentile - 20) / 60 * (high_mult - low_mult)


def _compute_self_learning_thresh(
    base_thresh: float,
    backtest_stats: Optional[Dict[str, Any]] = None,
) -> Tuple[float, str]:
    """
    تعلم ذاتي: ضبط حد الشراء بناءً على الأداء السابق (V39.3 Enhanced).

    V39.3 تحسينات:
      - عتبات WR (65%/40%) تُقرأ من engine_settings
      - التعديل متناسب مع بُعد الـ win_rate عن 50%
      - حد أدنى للصفقات يُقرأ من engine_settings

    Returns: (dynamic_thresh, adjustment_reason)
    """
    if not backtest_stats:
        return base_thresh, 'لا يوجد تاريخ كافي للتعلم'

    total_trades = int(backtest_stats.get('total_trades', 0))
    win_rate = _safe_float(backtest_stats.get('win_rate'), 0)
    profit_factor = _safe_float(backtest_stats.get('profit_factor'), 0)

    min_trades = int(get_setting('self_learning_min_trades', default=10))
    if total_trades < min_trades:
        return base_thresh, f'تاريخ غير كافي ({total_trades} صفقات، مطلوب ≥{min_trades})'

    adjustment_pct = get_setting('self_learning_adjustment_pct', default=10)
    wr_lower = get_setting('adaptive_win_rate_lower', default=65)
    wr_raise = get_setting('adaptive_win_rate_raise', default=40)

    # V39.3: تعديل متناسب — كل ما الـ WR أبعد عن 50% → تعديل أكبر
    if win_rate >= wr_lower:
        # كل نقطة فوق wr_lower → تعديل إضافي 0.3%
        extra = (win_rate - wr_lower) * 0.3
        total_adj_pct = adjustment_pct + extra
        adjustment = base_thresh * (total_adj_pct / 100.0)
        dynamic_thresh = base_thresh - adjustment
        return dynamic_thresh, f'نموذج دقيق (WR={win_rate:.1f}%) → حد −{total_adj_pct:.1f}% = {dynamic_thresh:.1f}'
    elif win_rate < wr_raise:
        # كل نقطة تحت wr_raise → تعديل إضافي 0.3%
        extra = (wr_raise - win_rate) * 0.3
        total_adj_pct = adjustment_pct + extra
        adjustment = base_thresh * (total_adj_pct / 100.0)
        dynamic_thresh = base_thresh + adjustment
        return dynamic_thresh, f'نموذج ضعيف (WR={win_rate:.1f}%) → حد +{total_adj_pct:.1f}% = {dynamic_thresh:.1f}'
    else:
        return base_thresh, f'نموذج متوسط (WR={win_rate:.1f}%) → حد بدون تعديل'


def _compute_model_quality(
    backtest_stats: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    """
    تقييم جودة النموذج (V39).

    Returns: (model_quality, quality_color)
      - '✅ النموذج دقيق ومتأكد' (lime) — WR ≥ 60% AND PF > 1.2
      - '⚠️ محتاج ضبط' (orange) — غير ذلك
      - '⏳ لا يوجد تاريخ كافي' (gray) — مفيش صفقات
    """
    if not backtest_stats:
        return '⏳ لا يوجد تاريخ كافي', 'gray'

    total_trades = int(backtest_stats.get('total_trades', 0))
    win_rate = _safe_float(backtest_stats.get('win_rate'), 0)
    profit_factor = _safe_float(backtest_stats.get('profit_factor'), 0)

    if total_trades == 0:
        return '⏳ لا يوجد تاريخ كافي', 'gray'

    if win_rate >= 60 and profit_factor > 1.2:
        return '✅ النموذج دقيق ومتأكد', 'lime'
    else:
        return '⚠️ محتاج ضبط', 'orange'


def build_institutional_decision(
    ticker: str,
    closes: List[float],
    highs: List[float],
    lows: List[float],
    opens: List[float],
    volumes: List[float],
    rsi: float = 50.0,
    atr: float = 0.0,
    sma20: float = 0.0,
    sma50: float = 0.0,
    sma200: float = 0.0,
    smc_data: Optional[Dict[str, Any]] = None,
    fusion_metrics: Optional[Dict[str, Any]] = None,
    quant_metrics: Optional[Dict[str, Any]] = None,
    candle_probabilities: Optional[Dict[str, Any]] = None,
    stock_dna: Optional[Dict[str, Any]] = None,
    fundamental_score: float = 0.0,
    market_regime: Optional[Dict[str, Any]] = None,
    bb_squeeze: Optional[Dict[str, Any]] = None,
    levels: Optional[Dict[str, Any]] = None,
    sector_change: float = 0.0,
    risk_params: Optional[Dict[str, Any]] = None,
    user_entry_price: float = 0.0,
    user_entry_qty: float = 0.0,
    # V39 new params
    benchmark_change: float = 0.0,
    stock_roc: float = 0.0,
    dna_target_price: Optional[float] = None,
    backtest_stats: Optional[Dict[str, Any]] = None,
    # AXIS-4: Market Breadth Hard Veto — نسبة الأسهم الصاعدة
    breadth_pct: Optional[float] = None,
) -> Dict[str, Any]:
    """
    بناء لوحة القرار المؤسسي الكاملة (V39 Full Dynamic Adaptive).

    V39 New Parameters:
        benchmark_change: تغير المؤشر العام (EGX30, SPY, etc.) — لإثبات 6
        stock_roc: معدل تغير السهم (14 يوم) — لإثبات 6
        dna_target_price: هدف البصمة المستقبلية — يُستخدم كـ TP1 لو bullish
        backtest_stats: {'win_rate': 65.2, 'profit_factor': 1.85, 'total_trades': 57}
                        — للتعلم الذاتي وجودة النموذج

    Returns:
        dict فيه:
          - maker_state:    {state, state_ar, emoji, score_impact, reason, signals, ...}
          - flight_state:   {state, state_ar, emoji, color, reason, ...}
          - proofs:         list of 6 proof dicts (V39)
          - tech_score:     int 0-100
          - signal_final:   str (مع emoji)
          - path_taken:     str
          - signal_color:   str
          - portfolio_advice: dict أو None
          - fair_value:     float (VWAP)
          - fair_premium:   float %
          - fair_state:     str (غالي / عادل / رخيص)
          - risk_profile:   dict {entry, sl, tp1, tp2, rr_ratio}
          - prediction_ar:  str (نص التوقع بالعربي)
          - backtest:       dict {win_rate, profit_factor, total_trades, ...} (V39 NEW)
          - dynamic_thresh: float (V39 NEW)
          - model_quality:  str (V39 NEW)
    """
    smc_data = smc_data or {}
    fusion_metrics = fusion_metrics or {}
    quant_metrics = quant_metrics or {}
    market_regime = market_regime or {}
    bb_squeeze = bb_squeeze or {}
    levels = levels or {}
    risk_params = risk_params or {}
    backtest_stats = backtest_stats or {}

    try:
        # حساب vol_ratio (مطلوب في عدة أماكن)
        avg_vol = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 0.0
        last_vol = volumes[-1] if volumes else 0.0
        vol_ratio = (last_vol / avg_vol) if avg_vol > 0 else 1.0

        # 1. Maker State (V39 Dynamic)
        maker_state = _detect_maker_state(
            closes=closes, opens=opens, highs=highs, lows=lows,
            volumes=volumes, smc_data=smc_data, quant_metrics=quant_metrics,
            vol_ratio=vol_ratio, atr_val=atr,
        )

        # 2. Flight State
        flight_state = _detect_flight_state(
            closes=closes, highs=highs, lows=lows,
            smc_data=smc_data, bb_squeeze=bb_squeeze,
            vol_ratio=vol_ratio, maker_state=maker_state, levels=levels,
        )

        # 3. 6 Proofs (V39 — بدل 5)
        proofs = _build_6_proofs(
            closes=closes, sma200=sma200,
            maker_state=maker_state,
            candle_probabilities=candle_probabilities,
            stock_dna=stock_dna,
            fundamental_score=fundamental_score,
            sector_change=sector_change,
            market_regime=market_regime,
            stock_roc=stock_roc,
            benchmark_change=benchmark_change,
        )

        # 4. Tech Score
        tech_score = _compute_tech_score(proofs)

        # V40: عد الأدلة المتوافقة — أساس القرار الجديد
        evidence = _count_strong_evidences(proofs)
        evidence['has_distribution'] = maker_state.get('state') == 'distribution'

        # V40: Kill Filters — فلاتر استبعاد إجبارية قبل القرار
        current_price_for_kf = closes[-1] if closes else 0.0
        # متوسط السيولة التقريبي من آخر 20 شمعة
        avg_turnover_approx = 0.0
        if volumes and len(volumes) >= 20 and current_price_for_kf > 0:
            recent_vols = volumes[-20:]
            avg_vol_20 = sum(recent_vols) / len(recent_vols)
            avg_turnover_approx = avg_vol_20 * current_price_for_kf
        kill_filter_result = evaluate_kill_filters(
            ticker=ticker,
            closes=closes,
            volumes=volumes,
            current_price=current_price_for_kf,
            avg_turnover=avg_turnover_approx,
            benchmark_change=benchmark_change,
            stock_roc=stock_roc,
            data_bars_count=len(closes) if closes else 0,
        )

        # 5. Self-Learning Threshold (V39)
        base_buy_thresh = get_setting('base_buy_threshold', default=75)
        dynamic_thresh, thresh_reason = _compute_self_learning_thresh(
            base_thresh=base_buy_thresh,
            backtest_stats=backtest_stats,
        )

        # 6. Signal Final (V40 — Evidence-Based + Kill Filters + AXIS-4 Veto)
        signal_final, path_taken, signal_color = _compute_signal_final(
            tech_score=tech_score, maker_state=maker_state, flight_state=flight_state,
            dynamic_thresh=dynamic_thresh,
            market_regime=market_regime,
            proofs=proofs,  # V39.3: pass proofs for smart regime filtering
            kill_filter_result=kill_filter_result,  # V40: فلاتر الاستبعاد
            benchmark_change=benchmark_change,  # AXIS-4: فيتو السوق الهابط
            breadth_pct=breadth_pct,  # AXIS-4: فيتو السوق الهابط
        )

        # 7. Portfolio Advice
        current_price = closes[-1] if closes else 0.0
        trend_up = bool(sma200 and sma200 > 0 and current_price > sma200)

        # 8. Fair Value (VWAP) — من fusion_metrics
        fair_value = _safe_float(fusion_metrics.get('fair_value'), current_price)
        fair_premium = _safe_float(fusion_metrics.get('fair_premium'), 0.0)

        # V39: حالة القيمة العادلة ديناميكية
        recent_premiums = fusion_metrics.get('recent_premiums')
        fair_state, fair_detail = _compute_dynamic_fair_state(
            fair_premium=fair_premium,
            recent_premiums=recent_premiums if isinstance(recent_premiums, list) else None,
        )

        # 9. Risk Profile (V39 — Dynamic SL/TP)
        # V39: عامل SL ديناميكي بناءً على ATR percentile
        dynamic_sl_mult = _compute_dynamic_sl_mult(
            closes=closes, highs=highs, lows=lows, atr_val=atr,
        )

        entry = _safe_float(risk_params.get('entry'), current_price)
        sl_base = _safe_float(risk_params.get('stop_loss'), entry - (atr * dynamic_sl_mult))
        # تأكد إن SL < Entry (BUY)
        if sl_base >= entry:
            sl_base = entry - (atr * dynamic_sl_mult)
        risk = entry - sl_base

        # V39: R:R ديناميكي — لو السهم أقوى من المؤشر → R:R أعلى
        outperforming_market = stock_roc > benchmark_change
        dynamic_rr1 = get_setting('dynamic_rr_outperform', default=2.0) if outperforming_market else get_setting('dynamic_rr_normal', default=1.5)

        tp1_base = entry + (risk * dynamic_rr1)
        tp2_base = entry + (risk * (dynamic_rr1 * 2))

        # V39: لو البصمة المستقبلية طالعة، نستخدمها كـ TP1
        dna_bullish = any(p.get('name') == 'dna' and p.get('passed') for p in proofs)
        dna_tp = _safe_float(dna_target_price, 0)
        if dna_bullish and dna_tp > entry and dna_tp > 0:
            tp1_base = dna_tp

        risk_r = fusion_metrics.get('risk', {}) if isinstance(fusion_metrics.get('risk'), dict) else {}
        risk_profile = {
            'entry': round(entry, 4),
            'sl': round(sl_base, 4),
            'tp1': round(tp1_base, 4),
            'tp2': round(tp2_base, 4),
            'rr_ratio_tp1': round((tp1_base - entry) / risk, 2) if risk > 0 else 0,
            'rr_ratio_tp2': round((tp2_base - entry) / risk, 2) if risk > 0 else 0,
        }

        # Portfolio Advice (بعد ما حسبنا SL)
        portfolio_advice = _compute_portfolio_advice(
            user_entry_price=user_entry_price,
            user_entry_qty=user_entry_qty,
            current_price=current_price,
            stop_loss=sl_base,
            maker_state=maker_state,
            trend_up=trend_up,
        )

        # 10. Prediction (نص التوقع بالعربي — V39)
        if 'شراء' in signal_final:
            prediction_ar = f'السهم رايح يطلع لـ {risk_profile["tp1"]:.2f} (TP1).'
        elif 'بيع' in signal_final or 'وقف' in signal_final:
            prediction_ar = 'السهم هيعوق، ابعد عنه.'
        else:
            prediction_ar = 'السهم عرضي، استني كسر.'

        # 11. Adaptive Overbought (V39 logic)
        sma_atr_proxy = atr
        adaptive_ob = (get_setting('rsi_overbought_base', default=70) + get_setting('rsi_trend_adjustment', default=10)) if (atr > 0 and sma_atr_proxy > 0 and sma_atr_proxy / sma_atr_proxy > 1.2) else get_setting('rsi_overbought_base', default=70)
        if rsi > adaptive_ob:
            rsi_status = 'متشبع شراء 🔴'
        elif rsi < get_setting('rsi_oversold_base', default=30):
            rsi_status = 'متشبع بيع 🟢'
        else:
            rsi_status = 'طبيعي ⚪'

        # 12. Model Quality (V39)
        model_quality, quality_color = _compute_model_quality(backtest_stats)

        # 13. Backtest summary (V39)
        bt_win_rate = _safe_float(backtest_stats.get('win_rate'), 0)
        bt_profit_factor = _safe_float(backtest_stats.get('profit_factor'), 0)
        bt_total_trades = int(backtest_stats.get('total_trades', 0))
        bt_winning_trades = int(backtest_stats.get('winning_trades', 0))
        bt_net_return = _safe_float(backtest_stats.get('net_return'), 0)

        backtest_summary = {
            'win_rate': round(bt_win_rate, 1),
            'profit_factor': round(bt_profit_factor, 2),
            'total_trades': bt_total_trades,
            'winning_trades': bt_winning_trades,
            'net_return': round(bt_net_return, 2),
            'win_rate_text': f'{bt_win_rate:.1f}% ({bt_winning_trades} ربح من {bt_total_trades})' if bt_total_trades > 0 else 'لا يوجد صفقات سابقة',
            'pf_text': f'{bt_profit_factor:.2f}' if bt_profit_factor < 999 else '∞ (ربح خالص)',
        }

        return {
            'ticker': ticker,
            'current_price': round(current_price, 4),
            'maker_state': maker_state,
            'flight_state': flight_state,
            'proofs': proofs,
            'tech_score': tech_score,
            'signal_final': signal_final,
            'path_taken': path_taken,
            'signal_color': signal_color,
            'portfolio_advice': portfolio_advice,
            'fair_value': round(fair_value, 4),
            'fair_premium': round(fair_premium, 2),
            'fair_state': fair_state,
            'risk_profile': risk_profile,
            'prediction_ar': prediction_ar,
            'rsi_status': rsi_status,
            'adaptive_ob': adaptive_ob,
            'ready': True,
            # V39 new fields
            'backtest': backtest_summary,
            'dynamic_thresh': round(dynamic_thresh, 1),
            'dynamic_thresh_reason': thresh_reason,
            'model_quality': model_quality,
            'quality_color': quality_color,
            'dynamic_sl_mult': round(dynamic_sl_mult, 2),
            'dynamic_rr1': round(dynamic_rr1, 1),
            'outperforming_market': outperforming_market,
            'dna_target_price': round(dna_tp, 4) if dna_tp > 0 else None,
            'version': 'V40',  # V40: Evidence-Based Decision
            # V40 new fields
            'evidence': evidence,  # عد الأدلة المتوافقة
            'kill_filter_result': kill_filter_result,  # فلاتر الاستبعاد
        }

    except Exception as e:
        logger.error(f"[InstitutionalDecision] {ticker} error: {e}", exc_info=True)
        return {
            'ticker': ticker,
            'ready': False,
            'error': str(e),
            'maker_state': {'state': 'calm', 'state_ar': 'هدوء', 'emoji': '⚪', 'score_impact': 0},
            'flight_state': {'state': 'sideways', 'state_ar': 'عرضي 😴', 'emoji': '⚪'},
            'proofs': [],
            'tech_score': 50,
            'signal_final': '🟡 انتظر',
            'path_taken': 'خطأ في الحساب',
            'signal_color': 'yellow',
            'portfolio_advice': None,
            'backtest': {'win_rate': 0, 'profit_factor': 0, 'total_trades': 0, 'winning_trades': 0, 'net_return': 0, 'win_rate_text': 'لا يوجد صفقات', 'pf_text': '0.00'},
            'dynamic_thresh': get_setting('base_buy_threshold', default=75),
            'dynamic_thresh_reason': 'خطأ',
            'model_quality': '⏳ خطأ في الحساب',
            'quality_color': 'gray',
            'version': 'V40',
            # V40 new fields (fallback)
            'evidence': {
                'strong_count': 0, 'weak_count': 0, 'neutral_count': 6,
                'maker_passed': False, 'benchmark_passed': False, 'has_distribution': False,
                'strong_evidence_names': [], 'weak_evidence_names': [],
            },
            'kill_filter_result': {'passed': True, 'kill_reasons': [], 'kill_details': {}, 'kill_filter_active': False},
        }
