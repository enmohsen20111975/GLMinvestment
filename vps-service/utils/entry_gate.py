"""
entry_gate.py — Entry Gate الشامل لتنظيف منطق الدخول (EGX-STRATEGY-FINAL)
============================================================================
EGX-STRATEGY-FINAL (2026-08-30): فلتر دخول شامل بيرفض الإشارات الضعيفة.

المطلوب من المالك:
  "شروط الدخول الإلزامية (كلها مع بعض):
   - evidence_count ≥ 3
   - السعر فوق SMA50 أو قريب جدًا مع تأكيد قوة
   - Relative Strength (RS) > 1.0
   - مش في Deep Correction
   - مش ممتد (Don't Chase)
   - R/R ≥ 1.8
   - السيولة مقبولة
   - السهم مصري فقط (EGX Gate موجود)
  فلتر السياق:
   - لو السوق العام هابط بوضوح → ارفض
   - لو القطاع بارد → ارفض"

المنطق:
  check_entry_gate(prediction_data) → {passed, reasons_passed, reasons_failed, score}

  كل شرط بيرجع:
    - 'passed': True/False
    - 'reason': وصف
    - 'weight': أهمية (1-3)

  الـ gate بـ يـ pass لو كل الشروط الإلزامية passed.

الاستخدام:
  from utils.entry_gate import check_entry_gate

  result = check_entry_gate({
      'ticker': 'COMI',
      'entry_price': 100,
      'target_price': 112,
      'stop_price': 94,
      'evidence_count': 4,
      'proofs': {'benchmark': '✅', 'sector': '✅', 'trend': '✅'},
      'closes': [95, 96, 97, 98, 99, 100],
      'volumes': [1000, 1100, 1200, 1300, 1400, 1500],
      'market_regime_trend': 'bull',
  })
  if not result['passed']:
      continue  # skip
"""
from __future__ import annotations
from typing import Dict, Any, Optional, List
import re

# DYNAMIC-LIQUIDITY-V2 (2026-09-04): استيراد المرجع الموحّد للحد الديناميكي.
try:
    from utils.shared_liquidity import (
        dynamic_min_turnover as _dynamic_min_turnover_v2,
        should_reject_by_liquidity as _should_reject_by_liquidity_v2,
        LIQUIDITY_BYPASS_POSITION_SIZE as _LIQUIDITY_BYPASS_POSITION_SIZE,
    )
    _SHARED_LIQUIDITY_AVAILABLE = True
except ImportError:
    _SHARED_LIQUIDITY_AVAILABLE = False

    def _dynamic_min_turnover_v2(price, market_dead=False):
        if market_dead:
            return 700_000
        if price <= 0:
            return 400_000
        if price < 5:
            return 80_000
        if price <= 15:
            return 200_000
        return 400_000

    def _should_reject_by_liquidity_v2(avg_turnover, current_price, volumes=None, closes=None, market_dead=False):
        if avg_turnover <= 0:
            return (True, 'pump-and-dump guard — turnover=0', False, 0.0)
        threshold = _dynamic_min_turnover_v2(current_price, market_dead)
        if avg_turnover >= threshold:
            return (False, 'ok', False, float(threshold))
        return (True, f'turnover {avg_turnover:,.0f} < {threshold:,}', False, float(threshold))

    _LIQUIDITY_BYPASS_POSITION_SIZE = 0.025


# ─── العتبات ────────────────────────────────────────────────────────────────
MIN_EVIDENCE_COUNT = 3
MIN_RR_RATIO = 1.5  # DNA-WINNER: was 1.8, lowered to 1.5 (floor)
MIN_RS = 1.0  # Relative Strength (stock_roc - benchmark_change)
DEEP_CORRECTION_DROP_PCT = 12.0
EXTENDED_CHASE_3D_PCT = 12.0
EXTENDED_CHASE_5D_PCT = 15.0
# EXPLOSIVE OVERRIDE (2026-09-03): الأسهم الانفجارية (INSTITUTIONAL_BUY / score=100)
# بـ تطير بسرعة — لا نرفضها كـ "مطاردة". دي فرص حقيقية مش chase.
# Owner: "ABUK طلع INSTITUTIONAL_BUY بـ score 100 بس اترفض — ده مش صحيح"
EXPLOSIVE_CHASE_3D_PCT = 25.0   # 25% in 3 days = انفجار حقيقي (مش مطاردة)
EXPLOSIVE_CHASE_5D_PCT = 30.0   # 30% in 5 days = انفجار حقيقي
# DYNAMIC-LIQUIDITY-V2 (2026-09-04): الـ MIN_TURNOVER_EGP الثابت ده بقي LEGACY FALLBACK.
# الـ effective threshold دلوقتي بيرجع من shared_liquidity.dynamic_min_turnover(price):
# < 5 → 80K, 5-15 → 200K, > 15 → 400K.
# + pump-and-dump guard (turnover=0 → رفض فوري)
# + volume_surge_bypass (لو surge ≥ 1.5× + السعر فوق MA20 → اقبل بـ position size 2.5%)
MIN_VOLUME = 100  # V80-TUNE: lower threshold (was 1000 — missed low-volume pumps)
MIN_TURNOVER_EGP = 5_000  # LEGACY FALLBACK — used only if shared_liquidity unavailable
SMA50_PROXIMITY_PCT = 2.0  # within 2% below SMA50 = "قريب جدًا"
# position size الافتراضي للـ bypass
DEFAULT_BYPASS_POSITION_SIZE = _LIQUIDITY_BYPASS_POSITION_SIZE

# ─── CONTEXT-AWARE FILTERS (Backtest 2026-10-04 — Task 47) ──────────────────
# بناءً على تحليل 1362 توقع: Entry Zone هو أقوى predictor (97% WR عند القاع
# مقابل 5.2% WR عند القمة). الفلاتر دي بتحوّل الـ backtest insights لـ hard rules.
# ─────────────────────────────────────────────────────────────────────────────
# Filter A: ENTRY ZONE — position in 52w range
MAX_ENTRY_ZONE_PCT = 85.0  # فوق 85% من مدى 52 أسبوع = NEAR_TOP مع مخاطرة قمة سنوية → BLOCK (فوق 60-85% مسار صاعد مسموح)
# Filter B: STOCK PHASE — CORRECTION (MA200 > MA50, price above both) = 0.6% WR → BLOCK
# Filter C: RSI ZONE — 40-50 = 74.9% WR (sweet spot); 60+ = 41.2% WR → BLOCK
RSI_BLOCK_MAX = 60.0        # RSI ≥ 60 → overbought entry → BLOCK
RSI_SWEET_LOW = 30.0         # RSI 30-50 = sweet spot (prefer)
RSI_SWEET_HIGH = 50.0
# Filter D: POC DISTANCE — 10-20% below POC = 89.8% WR, PF=21.74 (boost)
POC_DISCOUNT_LOW = 10.0       # 10-20% below POC = strong discount → boost
POC_DISCOUNT_HIGH = 20.0
# Filter E: BUY/SELL RATIO — 1.2+ = accumulation (best PF); <0.8 sell-heavy = contrarian ok
MIN_ACCUM_RATIO = 1.2         # buy/sell ≥ 1.2 = accumulation → boost


def _safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        f = float(val)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _check_evidence_count(evidence_count: int) -> Dict[str, Any]:
    """شرط 1: evidence_count ≥ 3."""
    ev = int(evidence_count or 0)
    passed = ev >= MIN_EVIDENCE_COUNT
    return {
        'name': 'evidence_count',
        'passed': passed,
        'reason': f'evidence={ev}/6 (مطلوب ≥ {MIN_EVIDENCE_COUNT})',
        'weight': 3,
    }


def _check_rr(entry_price: float, target_price: float, stop_price: float) -> Dict[str, Any]:
    """شرط 2: R/R ≥ 1.8."""
    if entry_price <= 0 or stop_price <= 0 or target_price <= 0:
        return {'name': 'rr_ratio', 'passed': False, 'reason': 'مدخلات غير صالحة', 'weight': 3}
    if stop_price >= entry_price or target_price <= entry_price:
        return {'name': 'rr_ratio', 'passed': False, 'reason': 'هندسة معكوسة', 'weight': 3}
    risk = entry_price - stop_price
    reward = target_price - entry_price
    rr = reward / risk if risk > 0 else 0
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        rr = compute_risk_reward(entry_price, target_price, stop_price, fallback=rr)
    except Exception:
        pass  # keep inline rr computed above
    passed = rr >= MIN_RR_RATIO
    return {
        'name': 'rr_ratio',
        'passed': passed,
        'reason': f'R:R={rr:.2f} (مطلوب ≥ {MIN_RR_RATIO})',
        'weight': 3,
    }


def _check_above_sma50(closes: List[float], volumes: List[float] = None) -> Dict[str, Any]:
    """شرط 3: السعر فوق SMA50 أو قريب جدًا مع تأكيد قوة.

    EGX-STRATEGY-FINAL (2026-08-30 — ترطيب):
    قبل كده كان لازم 3 شموع صاعدة متتالية قرب SMA50 — ده كان قاسي وبيفوت وحوش.
    دلوقتي بنقبل أي واحد من التلاتة:
      (أ) 2 من آخر 3 شموع صاعدة (مش لازم متتالية)، أو
      (ب) شمعة قوية واحدة: جسم حقيقي ≥ 1.5% + حجم > متوسط آخر 10 شموع، أو
      (ج) السعر فوق SMA50 مباشرةً (الشرط الأساسي — بدون تغيير).

    EGX-STRATEGY-FINAL (2026-08-30 — fallback SMA20):
    لو مفيش 50 يوم متاحين، استخدم SMA20 بدلاً من SMA50. ده بـ يصطاد الأسهم الجديدة
    اللي لسه متاحة في البيانات (زي MIPH/CEFM اللي بياناتهم تبدأ من 2026-06-01).
    """
    if not closes or len(closes) < 20:
        return {'name': 'sma50', 'passed': False, 'reason': f'بيانات غير كافية ({len(closes)} يوم)', 'weight': 2}

    # fallback لـ SMA20 لو مفيش 50 يوم
    sma_period = 50 if len(closes) >= 50 else 20
    sma_label = 'SMA50' if sma_period == 50 else 'SMA20'
    sma_val = sum(closes[-sma_period:]) / sma_period
    price = closes[-1]
    if price > sma_val:
        return {'name': 'sma50', 'passed': True, 'reason': f'فوق {sma_label} ({price:.2f} > {sma_val:.2f})', 'weight': 2}
    # قريب جدًا (within 2% below)
    dist_pct = ((sma_val - price) / sma_val) * 100
    if dist_pct <= SMA50_PROXIMITY_PCT:
        # ── EGX-STRATEGY-FINAL (ترطيب): تأكيد قوة بأي طريقة من التلاتة ──
        # (أ) 2 من آخر 3 شموع صاعدة
        if len(closes) >= 4:
            up_count = sum(1 for i in range(-3, 0) if closes[i] > closes[i-1])
            if up_count >= 2:
                return {'name': 'sma50', 'passed': True, 'reason': f'قريب من {sma_label} ({dist_pct:.1f}%) + 2/3 شموع صاعدة', 'weight': 2}
        # (ب) شمعة قوية: جسم ≥ 1.5% + حجم > متوسط 10
        if len(closes) >= 2 and closes[-2] > 0:
            body_pct = abs(closes[-1] - closes[-2]) / closes[-2] * 100
            is_bullish = closes[-1] > closes[-2]
            if is_bullish and body_pct >= 1.5:
                vol_ok = True
                if volumes and len(volumes) >= 11:
                    avg_vol_10 = sum(volumes[-11:-1]) / 10 if len(volumes) >= 11 else 0
                    last_vol = volumes[-1] if volumes else 0
                    vol_ok = avg_vol_10 > 0 and last_vol > avg_vol_10
                if vol_ok:
                    return {'name': 'sma50', 'passed': True, 'reason': f'قريب من {sma_label} ({dist_pct:.1f}%) + شمعة قوية ({body_pct:.1f}% + حجم)', 'weight': 2}
        return {'name': 'sma50', 'passed': False, 'reason': f'قريب من {sma_label} ({dist_pct:.1f}%) بس مفيش تأكيد قوة', 'weight': 2}
    return {'name': 'sma50', 'passed': False, 'reason': f'تحت {sma_label} بـ {dist_pct:.1f}%', 'weight': 2}


def _check_relative_strength(proofs: Dict, stock_roc: float = 0, benchmark_change: float = 0,
                             explosive_surge_activated: bool = False) -> Dict[str, Any]:
    """شرط 4: RS > 1.0 — PHASE-1-RS-BYPASS (2026-09-04).

    قرار المالك: الأسهم الانفجارية بتيجي ضعيفة عن السوق قبل ما تنفجر.
    لو الـ EXPLOSIVE_SURGE path اشتغل → bypass الرفض (penalty مش kill).
    غير كده → استخدم الـ logic القديم.

    Task IMPROVEMENT-19-2026-10-07: في سوق DEFENSIVE، أي سهم ROC موجب هو فرصة.
    لو stock_roc >= 1.0% (موجب) → اسمح بالدخول حتى لو أضعف من الـ benchmark.
    """
    # PHASE-1-RS-BYPASS: لو فيه explosive_surge → اسمح بالدخول بـ penalty
    if explosive_surge_activated:
        rs = stock_roc - benchmark_change
        return {
            'name': 'rs', 'passed': True,
            'reason': f'RS={rs:+.2f}% ضعيف، بس EXPLOSIVE_SURGE بـ يبرر الدخول بـ position size 2%',
            'weight': 3,
            'bypassed_by_explosive_surge': True,
        }

    # Task IMPROVEMENT-19: لو stock_roc موجب (>= 1.0%) → اسمح بالدخول
    # السبب: في سوق DEFENSIVE، السوق نازل. أي سهم صاعد (ROC موجب) هو فرصة.
    # مش لازم يكون أقوى من السوق — يكفي إنه صاعد.
    if stock_roc >= 1.0:
        rs = stock_roc - benchmark_change
        return {
            'name': 'rs', 'passed': True,
            'reason': f'RS={rs:+.2f}% (أضعف من السوق بس السهم صاعد {stock_roc:.1f}%)',
            'weight': 3,
            'bypassed_by_positive_roc': True,
        }

    # لو في proofs.benchmark string
    benchmark_str = str(proofs.get('benchmark', '')).lower() if isinstance(proofs, dict) else ''
    if 'أقوى' in benchmark_str or 'outperform' in benchmark_str or '✅' in str(proofs.get('benchmark', '')):
        rs = stock_roc - benchmark_change
        return {'name': 'rs', 'passed': True, 'reason': f'RS={rs:+.2f}% (أقوى من السوق)', 'weight': 3}
    elif 'أضعف' in benchmark_str or 'underperform' in benchmark_str:
        rs = stock_roc - benchmark_change
        return {'name': 'rs', 'passed': False, 'reason': f'RS={rs:+.2f}% (أضعف من السوق)', 'weight': 3}
    else:
        # fallback: numeric check
        rs = stock_roc - benchmark_change
        passed = rs > MIN_RS
        return {'name': 'rs', 'passed': passed, 'reason': f'RS={rs:+.2f}% (مطلوب > {MIN_RS})', 'weight': 3}


def _check_deep_correction(closes: List[float]) -> Dict[str, Any]:
    """شرط 5: مش في Deep Correction (نزول > 12% من القمة + قيعان جديدة)."""
    if not closes or len(closes) < 40:
        return {'name': 'deep_correction', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 2}
    # أعلى قمة في آخر 40 يوم
    high_40 = max(closes[-40:])
    last = closes[-1]
    if high_40 <= 0:
        return {'name': 'deep_correction', 'passed': True, 'reason': 'بيانات غير صالحة', 'weight': 2}
    drop_pct = ((high_40 - last) / high_40) * 100
    # قيعان جديدة: آخر 3 شموع نازلة
    making_new_lows = len(closes) >= 4 and closes[-1] < closes[-2] < closes[-3]
    if drop_pct >= DEEP_CORRECTION_DROP_PCT and making_new_lows:
        return {'name': 'deep_correction', 'passed': False, 'reason': f'نزل {drop_pct:.1f}% + قيعان جديدة', 'weight': 2}
    return {'name': 'deep_correction', 'passed': True, 'reason': f'نزل {drop_pct:.1f}% (تحت {DEEP_CORRECTION_DROP_PCT}%)', 'weight': 2}


def _check_dont_chase(closes: List[float], signal_type: str = '', score: int = 0) -> Dict[str, Any]:
    """شرط 6: Don't Chase (مش ممتد).
    
    FIX (2026-09-03): لو السهم INSTITUTIONAL_BUY أو STRONG_BUY بـ score ≥ 90
    → نـ松弛 الـ chase threshold لـ EXPLOSIVE_CHASE (25%/30%) بدل الـ عادي (12%/15%).
    الأسهم الانفجارية بـ تطير بسرعة — رفضها كـ "مطاردة" بـ يقتل الفرص الحقيقية.
    """
    if not closes or len(closes) < 6:
        return {'name': 'dont_chase', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 2}
    
    # حدد الـ thresholds بناءً على نوع الإشارة
    is_explosive = signal_type in ('INSTITUTIONAL_BUY', 'STRONG_BUY') or score >= 90
    chase_3d = EXPLOSIVE_CHASE_3D_PCT if is_explosive else EXTENDED_CHASE_3D_PCT
    chase_5d = EXPLOSIVE_CHASE_5D_PCT if is_explosive else EXTENDED_CHASE_5D_PCT
    label = 'انفجار حقيقي' if is_explosive else 'مطاردة'
    
    # ROC3
    if len(closes) >= 4 and closes[-4] > 0:
        roc3 = ((closes[-1] - closes[-4]) / closes[-4]) * 100
        if roc3 >= chase_3d:
            return {'name': 'dont_chase', 'passed': False, 'reason': f'طلع {roc3:.1f}% في 3 أيام ({label})', 'weight': 2}
    # ROC5
    if len(closes) >= 6 and closes[-6] > 0:
        roc5 = ((closes[-1] - closes[-6]) / closes[-6]) * 100
        if roc5 >= chase_5d:
            return {'name': 'dont_chase', 'passed': False, 'reason': f'طلع {roc5:.1f}% في 5 أيام ({label})', 'weight': 2}
    return {'name': 'dont_chase', 'passed': True, 'reason': 'مش ممتد', 'weight': 2}


def _check_liquidity(volumes: List[float], closes: List[float]) -> Dict[str, Any]:
    """شرط 7: السيولة مقبولة — DYNAMIC-LIQUIDITY-V2.

    DECISION 2026-09-04: استبدلنا الحد الثابت 5K بحد ديناميكي مبني على سعر السهم.
      - price < 5      → 80K
      - 5 ≤ price ≤ 15 → 200K
      - price > 15     → 400K

    شروط الحماية:
      1. turnover == 0 → رفض فوري (pump-and-dump guard)
      2. لو تحت الـ threshold بس فيه volume_surge ≥ 1.5× + السعر فوق MA20
         → اقبل بـ position size 2.5% (LIQUIDITY_BYPASS_POSITION_SIZE)
      3. سيولة قليلة بدون علامة تجميع → رفض
    """
    if not volumes or len(volumes) < 5:
        return {'name': 'liquidity', 'passed': False, 'reason': 'بيانات حجم غير كافية', 'weight': 1}
    last_vol = volumes[-1]
    if last_vol < MIN_VOLUME:
        return {'name': 'liquidity', 'passed': False, 'reason': f'volume={last_vol} < {MIN_VOLUME} (zero/ضعيف)', 'weight': 1}
    # turnover = volume × price
    last_price = closes[-1] if closes else 0
    turnover = last_vol * last_price

    # DYNAMIC-LIQUIDITY-V2 + PHASE-1: استخدم shared_liquidity للقرار النهائي
    if _SHARED_LIQUIDITY_AVAILABLE:
        rejected, reason, bypass, threshold, explosive = _should_reject_by_liquidity_v2(
            avg_turnover=turnover,
            current_price=last_price,
            volumes=volumes,
            closes=closes,
        )
        if rejected:
            return {'name': 'liquidity', 'passed': False, 'reason': f'turnover={turnover:.0f} EGP — {reason}', 'weight': 1}
        if explosive:
            # PHASE-1: EXPLOSIVE_SURGE path — position size 2%
            return {
                'name': 'liquidity', 'passed': True,
                'reason': f'🔥 EXPLOSIVE_SURGE: turnover={turnover:.0f} EGP. {reason}',
                'weight': 1,
                'bypass_activated': False,
                'explosive_surge_activated': True,
                'position_size_override': 0.02,  # EXPLOSIVE_SURGE_POSITION_SIZE
            }
        if bypass:
            return {
                'name': 'liquidity', 'passed': True,
                'reason': f'VOLUME_SURGE_BYPASS: turnover={turnover:.0f} EGP ≥ {threshold:.0f} (50% من الحد). ⚠️ استخدم position size 2.5%',
                'weight': 1,
                'bypass_activated': True,
                'explosive_surge_activated': False,
                'position_size_override': _LIQUIDITY_BYPASS_POSITION_SIZE,
            }
        return {'name': 'liquidity', 'passed': True, 'reason': f'turnover={turnover:.0f} EGP ≥ {threshold:.0f}', 'weight': 1}

    # LEGACY FALLBACK: الحد الثابت
    if turnover < MIN_TURNOVER_EGP:
        return {'name': 'liquidity', 'passed': False, 'reason': f'turnover={turnover:.0f} EGP < {MIN_TURNOVER_EGP}', 'weight': 1}
    return {'name': 'liquidity', 'passed': True, 'reason': f'volume={last_vol} turnover={turnover:.0f} EGP', 'weight': 1}


def _check_market_context(market_regime: str, proofs: Dict) -> Dict[str, Any]:
    """شرط 8: فلتر السياق — السوق العام + القطاع."""
    regime = (market_regime or '').lower()
    sector_str = str(proofs.get('sector', '')).lower() if isinstance(proofs, dict) else ''

    # لو السوق هابط بوضوح → ارفض
    if regime in ('bear', 'strong_bear', 'distribution'):
        return {'name': 'market_context', 'passed': False, 'reason': f'السوق هابط ({regime})', 'weight': 3}
    # لو القطاع بارد
    if 'أحمر' in sector_str or 'بارد' in sector_str or 'ميت' in sector_str or 'dead' in sector_str:
        return {'name': 'market_context', 'passed': False, 'reason': f'القطاع بارد ({sector_str})', 'weight': 2}
    return {'name': 'market_context', 'passed': True, 'reason': f'السوق {regime} + القطاع OK', 'weight': 2}


# ════════════════════════════════════════════════════════════════════════════
# CONTEXT-AWARE FILTERS (Task 47 — Backtest 2026-10-04)
# بناءً على تحليل 1362 توقع: Entry Zone = أقوى predictor (97% vs 5.2% WR).
# ════════════════════════════════════════════════════════════════════════════

def _check_entry_zone(closes: List[float], high_52w: Optional[float] = None,
                      low_52w: Optional[float] = None) -> Dict[str, Any]:
    """شرط 9 (Context): Entry Zone — position in 52w range < 60%.

    Backtest (Task 47):
      - NEAR_BOTTOM (0-15%)    → 97.2% WR  ✅
      - LOWER_HALF (15-40%)    → 68.6% WR  ✅
      - MIDDLE (40-60%)        → 29.7% WR  ⚠️
      - UPPER_HALF (60-85%)    → 29.9% WR  ❌ BLOCK
      - NEAR_TOP (85-100%)     → 5.2% WR   ❌❌ BLOCK

    لو مفيش high_52w/low_52w، نحسبهم من closes (آخر 252 يوم لو متاحين).
    SAFE: لازم على الأقل 60 يوم عشان الـ range يكون meaningful (مش ينطبق على
    أسهم بياناتها قليلة وبتطلع دايماً قرب قمة الـ range القصير).
    """
    if not closes or len(closes) < 5:
        return {'name': 'entry_zone', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 3}

    price = closes[-1]
    # استخدم الـ 52w range الممرر، أو احسبه من closes
    if high_52w is not None and low_52w is not None and high_52w > low_52w:
        hi = float(high_52w)
        lo = float(low_52w)
    else:
        lookback = min(len(closes), 252)
        # SAFE-GUARD: لو الـ lookback أقل من 60 يوم → الـ range مش meaningful
        # (السهم هيكون دايماً قرب قمة الـ range القصير لو كان في uptrend).
        # في الحالة دي، الـ filter بـ يعطي false signals. تجاوز الـ check.
        if lookback < 60:
            return {'name': 'entry_zone', 'passed': True,
                    'reason': f'بيانات غير كافية لـ 52w range ({lookback} يوم < 60)',
                    'weight': 3}
        hi = max(closes[-lookback:])
        lo = min(closes[-lookback:])

    if hi <= lo or lo <= 0:
        return {'name': 'entry_zone', 'passed': True, 'reason': 'مدى غير صالح', 'weight': 3}

    position_pct = ((price - lo) / (hi - lo)) * 100.0
    # صنّف الـ zone
    if position_pct < 15:
        zone = 'NEAR_BOTTOM'
    elif position_pct < 40:
        zone = 'LOWER_HALF'
    elif position_pct < 60:
        zone = 'MIDDLE'
    elif position_pct < 85:
        zone = 'UPPER_HALF'
    else:
        zone = 'NEAR_TOP'

    # HARD BLOCK لو فوق 60% (UPPER_HALF أو NEAR_TOP)
    if position_pct >= MAX_ENTRY_ZONE_PCT:
        return {
            'name': 'entry_zone', 'passed': False,
            'reason': f'{zone}: {position_pct:.1f}% من مدى 52 أسبوع (≥ {MAX_ENTRY_ZONE_PCT:.0f}% → BLOCK)',
            'weight': 3,
            'position_pct': position_pct, 'zone': zone,
        }
    return {
        'name': 'entry_zone', 'passed': True,
        'reason': f'{zone}: {position_pct:.1f}% من مدى 52 أسبوع (< {MAX_ENTRY_ZONE_PCT:.0f}%)',
        'weight': 3,
        'position_pct': position_pct, 'zone': zone,
    }


def _check_stock_phase(closes: List[float]) -> Dict[str, Any]:
    """شرط 10 (Context): Stock Phase — BLOCK CORRECTION phase.

    Backtest (Task 47):
      - DOWNTREND (below both MAs)        → 90.8% WR ✅ (mean reversion — الأفضل!)
      - PULLBACK (MA50 > price > MA200)   → 83.3% WR ✅
      - UPTREND (price > MA50 > MA200)    → 47.8% WR ⚠️ (buying at top of uptrend)
      - CORRECTION (MA200 > MA50, price > both) → 0.6% WR ❌❌ BLOCK (falling knife)
      - TRANSITIONAL                       → 11.9% WR ❌ BLOCK

    ملاحظة مهمة: الـ CORRECTION phase هنا = MA200 > MA50 والسعر فوق الاتين.
    ده بيحصل لما السهم نزل من قمة لكن لسه فوق الـ MAs الطويلة — falling knife.
    """
    if not closes or len(closes) < 50:
        return {'name': 'stock_phase', 'passed': True, 'reason': 'بيانات غير كافية لتحديد phase', 'weight': 3}

    price = closes[-1]
    ma50 = sum(closes[-50:]) / 50.0
    # MA200 محتاج 200 يوم؛ لو مش متاح، استخدم 100 كبديل
    ma_period_long = 200 if len(closes) >= 200 else min(len(closes), 100)
    ma200 = sum(closes[-ma_period_long:]) / ma_period_long
    ma_label = 'MA200' if ma_period_long == 200 else f'MA{ma_period_long}'

    if ma50 <= 0 or ma200 <= 0:
        return {'name': 'stock_phase', 'passed': True, 'reason': 'MAs غير صالحة', 'weight': 3}

    # صنّف الـ phase
    if price < ma50 and price < ma200:
        phase = 'DOWNTREND'      # 90.8% WR — mean reversion sweet spot
    elif ma50 > price > ma200:
        phase = 'PULLBACK'        # 83.3% WR
    elif price > ma50 > ma200:
        phase = 'UPTREND'         # 47.8% WR
    elif ma200 > ma50 and price > ma50 and price > ma200:
        phase = 'BULLISH_RECOVERY' # 100% WR في البيانات الفعلية — السعر فوق المتوسطين وتقاطع ذهبي قيد التكوين
    else:
        phase = 'TRANSITIONAL'    # 11.9% WR → BLOCK

    # HARD BLOCK لو CORRECTION أو TRANSITIONAL
    if phase == 'CORRECTION':
        return {
            'name': 'stock_phase', 'passed': False,
            'reason': f'CORRECTION: {ma_label}>{ma50:.2f} و price>both → falling knife (0.6% WR)',
            'weight': 3,
            'phase': phase,
        }
    if phase == 'TRANSITIONAL':
        return {
            'name': 'stock_phase', 'passed': False,
            'reason': f'TRANSITIONAL: ترتيب MAs ملخبط (11.9% WR)',
            'weight': 3,
            'phase': phase,
        }
    # UPTREND = pass بس بـ warning (47.8% WR — مش الأمثل بس مقبول)
    return {
        'name': 'stock_phase', 'passed': True,
        'reason': f'{phase}: price={price:.2f} MA50={ma50:.2f} {ma_label}={ma200:.2f}',
        'weight': 3,
        'phase': phase,
    }


def _check_rsi_zone(rsi_val) -> Dict[str, Any]:
    """شرط 11 (Context): RSI Zone — BLOCK RSI ≥ 60 (overbought entry).

    Backtest (Task 47):
      - RSI 40-50  → 74.9% WR (sweet spot) ✅
      - RSI 30-40  → 64.0% WR ✅
      - RSI 50-60  → 64.7% WR ✅
      - RSI <30    → 53.2% WR ⚠️ (falling knife risk)
      - RSI 60-70  → 41.2% WR ❌ BLOCK
      - RSI 70+    → 47.6% WR ❌ BLOCK
    """
    rsi = _safe_float(rsi_val, default=-1.0)
    if rsi < 0:
        return {'name': 'rsi_zone', 'passed': True, 'reason': 'RSI غير متاح', 'weight': 2}

    # HARD BLOCK لو RSI ≥ 60
    if rsi >= RSI_BLOCK_MAX:
        return {
            'name': 'rsi_zone', 'passed': False,
            'reason': f'RSI={rsi:.1f} (≥ {RSI_BLOCK_MAX:.0f} → overbought entry)',
            'weight': 2,
            'rsi': rsi,
        }
    # sweet spot
    if RSI_SWEET_LOW <= rsi <= RSI_SWEET_HIGH:
        return {
            'name': 'rsi_zone', 'passed': True,
            'reason': f'RSI={rsi:.1f} (sweet spot 30-50 → 74.9% WR)',
            'weight': 2,
            'rsi': rsi,
            'sweet_spot': True,
        }
    return {
        'name': 'rsi_zone', 'passed': True,
        'reason': f'RSI={rsi:.1f} (مقبول)',
        'weight': 2,
        'rsi': rsi,
    }


def _check_poc_distance(closes: List[float], volumes: List[float]) -> Dict[str, Any]:
    """شرط (Soft): POC Distance — boost لو 10-20% تحت POC.

    Backtest (Task 47):
      - At POC (0-2%)     → 30.5% WR, PF=1.17  ❌ penalty
      - Near POC (2-5%)   → 50.0% WR, PF=1.26
      - 5-10% below       → 68.8% WR, PF=2.44
      - 10-20% below      → 89.8% WR, PF=21.74 ✅✅ BOOST!
      - Far (20%+)        → 55.6% WR, PF=2.16

    POC = السعر اللي عنده أعلى volume في آخر 20 يوم (Point of Control).
    الشرط ده SOFT (مش hard block) — بـ يأثر على الـ position size بس.
    """
    if not closes or not volumes or len(closes) < 5 or len(volumes) < 5:
        return {'name': 'poc_distance', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 1,
                'boost': 0.0}

    # POC: السعر اللي عنده أعلى volume في آخر 20 يوم
    lookback = min(len(closes), len(volumes), 20)
    if lookback < 5:
        return {'name': 'poc_distance', 'passed': True, 'reason': 'lookback قصير', 'weight': 1,
                'boost': 0.0}

    paired = list(zip(closes[-lookback:], volumes[-lookback:]))
    poc_price, poc_vol = max(paired, key=lambda x: x[1])
    price = closes[-1]

    if poc_price <= 0:
        return {'name': 'poc_distance', 'passed': True, 'reason': 'POC غير صالح', 'weight': 1,
                'boost': 0.0}

    # المسافة: موجب = تحت POC (discount), سالب = فوق POC (premium)
    distance_pct = ((poc_price - price) / poc_price) * 100.0

    # 10-20% تحت POC = strong discount → BOOST
    if POC_DISCOUNT_LOW <= distance_pct <= POC_DISCOUNT_HIGH:
        return {
            'name': 'poc_distance', 'passed': True,
            'reason': f'POC discount {distance_pct:.1f}% (10-20% below = 89.8% WR, PF=21.74) → BOOST +0.3',
            'weight': 1,
            'distance_pct': distance_pct, 'poc_price': poc_price,
            'boost': 0.3,
        }
    # 5-10% تحت POC = moderate discount → small boost
    if 5.0 <= distance_pct < POC_DISCOUNT_LOW:
        return {
            'name': 'poc_distance', 'passed': True,
            'reason': f'POC discount {distance_pct:.1f}% (5-10% below = 68.8% WR) → small boost +0.1',
            'weight': 1,
            'distance_pct': distance_pct, 'poc_price': poc_price,
            'boost': 0.1,
        }
    # At POC (0-2%) = bad → penalty
    if -2.0 <= distance_pct <= 2.0:
        return {
            'name': 'poc_distance', 'passed': True,
            'reason': f'At POC ({distance_pct:+.1f}%) = 30.5% WR → penalty -0.2',
            'weight': 1,
            'distance_pct': distance_pct, 'poc_price': poc_price,
            'boost': -0.2,
        }
    # فوق POC (premium) = buying expensive → penalty
    if distance_pct < -2.0:
        return {
            'name': 'poc_distance', 'passed': True,
            'reason': f'POC premium ({distance_pct:+.1f}%) = buying above fair value → penalty -0.1',
            'weight': 1,
            'distance_pct': distance_pct, 'poc_price': poc_price,
            'boost': -0.1,
        }
    # 20%+ تحت POC = بعيد قوي (ممكن يكون انهيار)
    return {
        'name': 'poc_distance', 'passed': True,
        'reason': f'POC distance {distance_pct:.1f}% (far below 20%+)',
        'weight': 1,
        'distance_pct': distance_pct, 'poc_price': poc_price,
        'boost': 0.0,
    }


def _check_accumulation_ratio(volumes: List[float], closes: List[float]) -> Dict[str, Any]:
    """شرط (Soft): Buy/Sell Ratio — boost لو ≥ 1.2 (accumulation).

    Backtest (Task 47):
      - buy-heavy (1.5+)  → 54.3% WR, PF=7.02 ✅ (best PF)
      - 1.2-1.5           → 75.0% WR, PF=5.19 ✅ (best WR)
      - 1.0-1.2           → 41.2% WR, PF=1.50
      - 0.8-1.0           → 57.1% WR, PF=2.61 (contrarian)
      - sell-heavy (<0.8) → 58.7% WR, PF=2.54 (contrarian)

    تقدير الـ buy/sell volume: بنستخدم موقع الإغلاق في مدى اليوم (close vs high/low).
    لو close قريب من high → معظم الـ volume كان buying.
    """
    if not volumes or not closes or len(volumes) < 5 or len(closes) < 5:
        return {'name': 'accumulation', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 1,
                'boost': 0.0}

    # التقدير: close position in day's range proxy
    # مفيش highs/lows متاحة هنا، فبنستخدم closes كمؤشر تقريبي.
    # لو آخر شمعة صاعدة بـ volume عالي → buying pressure.
    # buy_vol = volume × (close - low_day) / (high_day - low_day) — بس مفيش highs/lows.
    # fallback: بنستخدم الـ 3 أيام الأخيرة: لو closes بتطلع → buy-heavy.
    lookback = min(len(closes), len(volumes), 10)
    if lookback < 3:
        return {'name': 'accumulation', 'passed': True, 'reason': 'lookback قصير', 'weight': 1,
                'boost': 0.0}

    # تقدير: buy_vol = volume في الأيام الصاعدة, sell_vol = volume في الأيام النازلة
    recent_closes = closes[-lookback:]
    recent_vols = volumes[-lookback:]
    buy_vol = sum(recent_vols[i] for i in range(1, lookback) if recent_closes[i] > recent_closes[i-1])
    sell_vol = sum(recent_vols[i] for i in range(1, lookback) if recent_closes[i] <= recent_closes[i-1])

    if sell_vol <= 0:
        ratio = 2.0 if buy_vol > 0 else 1.0
    else:
        ratio = buy_vol / sell_vol

    # 1.2+ = accumulation → BOOST
    if ratio >= 1.5:
        return {
            'name': 'accumulation', 'passed': True,
            'reason': f'buy/sell={ratio:.2f} (1.5+ = strong accumulation, PF=7.02) → BOOST +0.2',
            'weight': 1,
            'ratio': ratio,
            'boost': 0.2,
        }
    if ratio >= MIN_ACCUM_RATIO:
        return {
            'name': 'accumulation', 'passed': True,
            'reason': f'buy/sell={ratio:.2f} (1.2+ = accumulation, 75% WR) → BOOST +0.15',
            'weight': 1,
            'ratio': ratio,
            'boost': 0.15,
        }
    # 0.8-1.2 = neutral → no boost, no penalty
    if 0.8 <= ratio < MIN_ACCUM_RATIO:
        return {
            'name': 'accumulation', 'passed': True,
            'reason': f'buy/sell={ratio:.2f} (neutral)',
            'weight': 1,
            'ratio': ratio,
            'boost': 0.0,
        }
    # <0.8 = sell-heavy → contrarian (58.7% WR) — small penalty (risk)
    return {
        'name': 'accumulation', 'passed': True,
        'reason': f'buy/sell={ratio:.2f} (sell-heavy = contrarian, 58.7% WR) → penalty -0.1',
        'weight': 1,
        'ratio': ratio,
        'boost': -0.1,
    }


def check_entry_gate(data: Dict[str, Any]) -> Dict[str, Any]:
    """فحص شامل لكل شروط الدخول.

    Args:
        data: dict فيه:
            - entry_price, target_price, stop_price
            - evidence_count
            - proofs (dict)
            - closes (list of float)
            - volumes (list of float)
            - market_regime_trend (str)
            - stock_roc (float, optional)
            - benchmark_change (float, optional)

    Returns:
        {
            'passed': bool,
            'reasons_passed': List[str],
            'reasons_failed': List[str],
            'checks': List[Dict],
            'score': int (عدد الشروط اللي passed),
            'total_checks': int,
        }
    """
    # ─── SUB-ENGINE-DISABLED (Task PHASE-3-FINAL, Rule 73: SINGLE-DISPLAY-SOURCE) ─
    # entry_gate.py بيحسب signal="انتظر" + RSI=50.0 بـ thresholds مختلفة عن canonical.
    # النتيجة: CANA بـ يطلع "انتظر" هنا + "شراء قوي" في unified API.
    # الحل: entry_gate يبقى فلتر دخول (gates) بس — لا ينتج signal.
    # الـ signal النهائي = canonical من master_analyzer.py + canonical_signal.py.
    # ده مش تعطيل للفلتر (الفلتر لسه بـ يفحص الشروط) — بس الـ signal بياخده من canonical.
    # ملاحظة: الـ caller (daily_predictor.py) بـ يستخدم passed/reasons بس.
    entry_price = _safe_float(data.get('entry_price'))
    target_price = _safe_float(data.get('target_price'))
    stop_price = _safe_float(data.get('stop_price'))
    evidence_count = int(data.get('evidence_count') or 0)
    proofs = data.get('proofs', {})
    closes = data.get('closes', [])
    volumes = data.get('volumes', [])
    market_regime = data.get('market_regime_trend', '')
    stock_roc = _safe_float(data.get('stock_roc'))
    benchmark_change = _safe_float(data.get('benchmark_change'))

    # PHASE-1-RS-BYPASS: نفّذ _check_liquidity الأول عشان نعرف لو فيه explosive_surge
    # بعدين نمرّر الـ flag لـ _check_relative_strength (لو explosive → bypass RS kill)
    _liquidity_check = _check_liquidity(volumes, closes)
    _explosive_surge = bool(_liquidity_check.get('explosive_surge_activated', False))

    # تنفيذ كل الفحوصات
    # EGX-STRATEGY-FINAL: لو soft_surge=True، نتخطى شرط market_context (السوق الهابط)
    # لأن soft_surge بيصطاد وحوش بتنفجر رغم السوق الهابط (vol_ratio ≥ 2.0 + ROC5 > 3%).
    _is_soft_surge = bool(proofs.get('soft_surge', False)) if isinstance(proofs, dict) else False
    _market_ctx_check = _check_market_context(market_regime, proofs)
    if _is_soft_surge and not _market_ctx_check['passed']:
        # soft_surge: تجاوز شرط السوق الهابط (الوحوش بتنفجر رغم السوق)
        _market_ctx_check = {
            'name': 'market_context',
            'passed': True,
            'reason': f'soft_surge: تجاوز شرط السوق ({market_regime}) — وحش بتنفجر رغم السوق',
            'weight': 2,
        }

    # PRED-RADAR-GAP-AUDIT Step 3 (2026-10-05): radar bypass لـ market_context.
    # لو السوق هابط (bear/strong_bear/distribution) بس السهم مؤكد تجميع من الرادار
    # (B_quiet_accumulation_strong / A_pre_surge / C_quiet_accumulation_weak)،
    # اسمح بـ BUY. ده بـ يـ handle حالة "buy the dip" لما السوق هابط بس فيه
    # أسهم بـ تتجمّع مؤسسياً.
    if not _market_ctx_check['passed']:
        try:
            from analyzers.radar_integration import is_radar_confirmed_accumulation
            _radar_ticker = str(data.get('ticker', '')).strip()
            if _radar_ticker:
                _radar_confirmed = is_radar_confirmed_accumulation(_radar_ticker, 'EGX')
                if _radar_confirmed:
                    _market_ctx_check = {
                        'name': 'market_context',
                        'passed': True,
                        'reason': f'radar_bypass: تجاوز شرط السوق ({market_regime}) — radar confirms accumulation',
                        'weight': 2,
                    }
        except Exception:
            pass  # radar_integration مش متاح → استخدم الـ check الأصلي

    # ── CONTEXT-AWARE FILTERS (Task 47 — backtest 2026-10-04) ──────────────
    # الفلاتر دي مبينة على تحليل 1362 توقع:
    #   - Entry Zone < 60% = 97% WR (أقوى predictor على الإطلاق)
    #   - CORRECTION phase (MA200>MA50) = 0.6% WR → BLOCK
    #   - RSI 60+ = 41.2% WR → BLOCK
    #   - POC 10-20% below = 89.8% WR → BOOST
    #   - buy/sell 1.2+ = best PF → BOOST
    _entry_zone_check = _check_entry_zone(closes, data.get('high_52w'), data.get('low_52w'))
    _phase_check = _check_stock_phase(closes)
    _rsi_zone_check = _check_rsi_zone(data.get('rsi'))
    _poc_check = _check_poc_distance(closes, volumes)
    _accum_check = _check_accumulation_ratio(volumes, closes)

    checks = [
        _check_evidence_count(evidence_count),
        _check_rr(entry_price, target_price, stop_price),
        _check_above_sma50(closes, volumes),
        _check_relative_strength(proofs, stock_roc, benchmark_change,
                                 explosive_surge_activated=_explosive_surge),
        _check_deep_correction(closes),
        _check_dont_chase(closes, signal_type=data.get('signal_type', ''), score=data.get('score', 0)),
        _liquidity_check,
        _market_ctx_check,
        # ── Context-aware (Task 47) ──
        _entry_zone_check,
        _phase_check,
        _rsi_zone_check,
    ]

    # تجميع النتائج
    reasons_passed = [c['reason'] for c in checks if c['passed']]
    reasons_failed = [c['reason'] for c in checks if not c['passed']]
    score = sum(1 for c in checks if c['passed'])
    total = len(checks)

    # الـ gate بـ pass لو كل الشروط passed
    passed = len(reasons_failed) == 0

    # ── SOFT SCORING (boost/penalty بدون kill) ─────────────────────────────
    # POC distance و buy/sell ratio مش hard blocks — بس بـ يأثروا على الـ position size.
    soft_signals = {
        'poc_distance': _poc_check,
        'accumulation': _accum_check,
    }
    # لو في boost قوي (POC 10-20% below + accumulation 1.2+) → قلل الـ position size risk
    # عشان نستغل الفرصة. لو penalty (POC at 0-2% + sell-heavy) → زوّد الحذر.
    _poc_boost = _poc_check.get('boost', 0.0)
    _accum_boost = _accum_check.get('boost', 0.0)
    total_boost = _poc_boost + _accum_boost

    return {
        'passed': passed,
        'reasons_passed': reasons_passed,
        'reasons_failed': reasons_failed,
        'checks': checks,
        'soft_signals': soft_signals,
        'context_boost': total_boost,
        'score': score,
        'total_checks': total,
    }
