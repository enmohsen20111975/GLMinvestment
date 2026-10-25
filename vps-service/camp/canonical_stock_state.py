#!/usr/bin/env python3
"""
Canonical Stock State Engine — Unified 6+3 state classification.

Replaces 8 incompatible taxonomies with ONE canonical system.
States: ACCUMULATION / UPTREND / CORRECTION_HEALTHY / DISTRIBUTION / DOWNTREND / RECOVERY
Special: STATE_UNCONFIRMED / DATA_STALE / DATA_INCOMPLETE

This module is the SINGLE SOURCE OF TRUTH for stock state.
All other components (entry_gate, maker_radar, shared_liquidity, UI) read from here.

Rule 67: CALCULATION-CANONICAL
Rule 27: NO-FAKE-DATA — never claim institutional activity without proof
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta


# ═══════════════════════════════════════════════════════════════════════════
# CANONICAL STATES
# ═══════════════════════════════════════════════════════════════════════════

ACCUMULATION = 'ACCUMULATION'              # تجميع محتمل — سعر مستقر + ضغط شراء خفي
UPTREND = 'UPTREND'                        # اتجاه صاعد — سعر بيرتفع + بنية إيجابية
CORRECTION_HEALTHY = 'CORRECTION_HEALTHY'  # تصحيح صحي — تراجع داخل اتجاه صاعد قائم
DISTRIBUTION = 'DISTRIBUTION'              # توزيع محتمل — ضغط بيع + ضعف في الصعود
DOWNTREND = 'DOWNTREND'                    # اتجاه هابط — تدهور بنيوي
RECOVERY = 'RECOVERY'                      # تعافٍ — محاولة استعادة بعد هبوط

# Special states (not part of the cycle, but needed for data quality)
STATE_UNCONFIRMED = 'STATE_UNCONFIRMED'    # أدلة متعارضة — مش نقدر نحسم
DATA_STALE = 'DATA_STALE'                  # بيانات قديمة — آخر سعر > 3 أيام
DATA_INCOMPLETE = 'DATA_INCOMPLETE'        # بيانات ناقصة — أقل من 50 يوم

ALL_STATES = [
    ACCUMULATION, UPTREND, CORRECTION_HEALTHY,
    DISTRIBUTION, DOWNTREND, RECOVERY,
    STATE_UNCONFIRMED, DATA_STALE, DATA_INCOMPLETE,
]

# Arabic labels for UI
STATE_AR = {
    ACCUMULATION: 'تجميع محتمل',
    UPTREND: 'اتجاه صاعد',
    CORRECTION_HEALTHY: 'تصحيح صحي',
    DISTRIBUTION: 'توزيع محتمل',
    DOWNTREND: 'اتجاه هابط',
    RECOVERY: 'تعافٍ محتمل',
    STATE_UNCONFIRMED: 'حالة غير محسومة',
    DATA_STALE: 'بيانات قديمة',
    DATA_INCOMPLETE: 'بيانات ناقصة',
}

# Transition types
TRANSITION_CONTINUE = 'CONTINUE'              # نفس حالة الأمس
TRANSITION_UPGRADE = 'UPGRADE'               # تحسن (مثلاً: DOWNTREND → RECOVERY)
TRANSITION_DOWNGRADE = 'DOWNGRADE'           # تدهور (مثلاً: UPTREND → CORRECTION_HEALTHY)
TRANSITION_INVALIDATED = 'INVALIDATED'       # الحالة السابقة اتلغت
TRANSITION_NEW = 'NEW'                       # أول تصنيف (مفيش حالة سابقة)
TRANSITION_REASSESS = 'REASSESS'             # إعادة تقييم بسبب تغير بيانات


# ═══════════════════════════════════════════════════════════════════════════
# Evidence — كل دليل يدعم أو يعارض الحالة
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class Evidence:
    """دليل واحد يدعم أو يعارض حالة السهم."""
    name: str                    # اسم الدليل (مثلاً: "price_above_ma50")
    value: float                 # القيمة الرقمية
    supports: str                # أي حالة يدعم
    weight: float = 1.0          # وزن الدليل (0-1)
    description: str = ''        # تفسير بالعربي
    direction: str = 'neutral'   # 'bullish' / 'bearish' / 'neutral'


@dataclass
class StockStateAssessment:
    """نتيجة تقييم حالة السهم — المصدر الموحد لكل المنظومة."""
    ticker: str
    date: str                    # YYYY-MM-DD
    state: str                   # أحد ALL_STATES
    confidence: float            # 0-1 (قوة الأدلة)
    evidence_supporting: List[Evidence] = field(default_factory=list)
    evidence_opposing: List[Evidence] = field(default_factory=list)
    days_in_state: int = 0       # كم يوم في نفس الحالة
    prev_state: str = ''         # الحالة السابقة
    transition_type: str = ''    # TRANSITION_*
    direction_probability: Dict[str, float] = field(default_factory=lambda: {'up': 0.0, 'down': 0.0, 'neutral': 1.0})
    data_freshness: str = ''     # 'fresh' / 'stale' / 'incomplete'
    invalidation_conditions: List[str] = field(default_factory=list)
    last_price: float = 0.0
    last_volume: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'ticker': self.ticker,
            'date': self.date,
            'state': self.state,
            'state_ar': STATE_AR.get(self.state, self.state),
            'confidence': round(self.confidence, 3),
            'days_in_state': self.days_in_state,
            'prev_state': self.prev_state,
            'transition_type': self.transition_type,
            'direction_probability': {k: round(v, 3) for k, v in self.direction_probability.items()},
            'data_freshness': self.data_freshness,
            'evidence_supporting': [{'name': e.name, 'value': e.value, 'description': e.description, 'direction': e.direction} for e in self.evidence_supporting],
            'evidence_opposing': [{'name': e.name, 'value': e.value, 'description': e.description, 'direction': e.direction} for e in self.evidence_opposing],
            'invalidation_conditions': self.invalidation_conditions,
            'last_price': self.last_price,
            'last_volume': self.last_volume,
        }


# ═══════════════════════════════════════════════════════════════════════════
# Indicator helpers (minimal — reuse existing where possible)
# ═══════════════════════════════════════════════════════════════════════════

def _sma(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _roc(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period + 1 or closes[-period - 1] <= 0:
        return None
    return (closes[-1] / closes[-period - 1] - 1) * 100


def _atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    if len(trs) < period:
        return None
    return sum(trs[-period:]) / period


def _volume_ratio(volumes: List[float], period: int = 20) -> Optional[float]:
    if len(volumes) < period + 1:
        return None
    avg = sum(volumes[-period-1:-1]) / period
    if avg <= 0:
        return None
    return volumes[-1] / avg


def _trading_days_between(latest_date: str, as_of_date: str, market: str = 'EGX') -> int:
    """Count trading sessions strictly between latest_date and as_of_date.

    FIX (owner review 2026-10-25): previous version treated Friday+Saturday+
    Sunday as non-trading — WRONG. EGX/Tadawul/KSE/QSE trade Sunday-Thursday,
    so Friday+Saturday are the only non-trading days for them. Sunday IS a
    trading day. US (Mon-Fri) has Saturday+Sunday as non-trading.

    Market calendars supported:
      - EGX, TADAWUL, KSE, QSE: Sun-Thu (Fri+Sat non-trading)
      - US: Mon-Fri (Sat+Sun non-trading)
      - CRYPTO: 24/7/365 (NO non-trading days — every calendar day is a
        trading day). Treating crypto with US weekend rules would
        incorrectly mark fresh weekend data as stale.

    Args:
        latest_date: YYYY-MM-DD (last close date).
        as_of_date: YYYY-MM-DD (assessment date).
        market: market code (EGX/TADAWUL/KSE/QSE/US/CRYPTO). Default EGX.

    Returns:
        Number of trading sessions strictly between the two dates
        (exclusive of both endpoints). 999 on parse error.
    """
    try:
        d_latest = datetime.strptime(latest_date, '%Y-%m-%d').date()
        d_as_of = datetime.strptime(as_of_date, '%Y-%m-%d').date()
    except Exception:
        return 999  # unparseable → treat as very stale
    if d_latest > d_as_of:
        return 0

    # Determine non-trading weekdays based on market
    # weekday(): 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
    m = (market or 'EGX').upper()
    if m in ('EGX', 'TADAWUL', 'KSE', 'QSE'):
        # Sun-Thu trading → Fri (4) + Sat (5) non-trading
        non_trading = (4, 5)
    elif m == 'CRYPTO':
        # FIX (owner review 2026-10-25): CRYPTO trades 24/7/365.
        # No weekend non-trading days — every calendar day is a trading day.
        # Treating crypto like US stocks (Sat+Sun non-trading) would
        # incorrectly mark fresh crypto data as stale after a weekend.
        non_trading = ()
    else:
        # US, or unknown → Mon-Fri trading → Sat (5) + Sun (6) non-trading
        non_trading = (5, 6)

    count = 0
    cur = d_latest
    while cur < d_as_of:
        cur = cur + timedelta(days=1)
        if cur.weekday() in non_trading:
            continue
        count += 1
    return count


def _is_data_stale(latest_date: str, as_of_date: str, max_trading_days: int = 4, market: str = 'EGX') -> bool:
    """Check if the latest price data is too old relative to the assessment date.

    FIX (Phase 2 — owner directive "Validation Before Integration"):
      - Previously compared latest_date to datetime.now() — broken for
        historical backtests and timezone-dependent.
      - Now compares to the explicit as_of_date (the assessment date).
      - Counts *trading* sessions missed, not raw calendar days, so a
        Friday close assessed on Sunday is NOT stale (1 trading day gap
        for EGX which trades Sundays).
      - max_trading_days=4 is the tolerance: 4 missed trading sessions
        (~1 week of trading) → stale. Tighter than the old 7-day rule.
      - market parameter added (owner review 2026-10-25): EGX/TADAWUL/KSE/QSE
        use Sun-Thu calendar; US/CRYPTO use Mon-Fri calendar.
    """
    try:
        gap = _trading_days_between(latest_date, as_of_date, market=market)
        return gap > max_trading_days
    except Exception:
        return True


# ═══════════════════════════════════════════════════════════════════════════
# CANONICAL STATE ENGINE
# ═══════════════════════════════════════════════════════════════════════════

def assess_state(
    ticker: str,
    date: str,
    closes: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    buy_pct: Optional[float] = None,
    prev_state: str = '',
    prev_date: str = '',
    latest_price_date: str = '',
    market: str = 'EGX',
) -> StockStateAssessment:
    """
    Assess the canonical stock state based on ALL available evidence.

    This is the SINGLE SOURCE OF TRUTH. No other component should classify
    stock state independently.

    Args:
        ticker: Stock ticker (e.g., "COMI")
        date: Assessment date (YYYY-MM-DD)
        closes: Close prices (oldest→newest, at least 50 days)
        highs: High prices
        lows: Low prices
        volumes: Volume data
        buy_pct: Buy percentage from money flow (0-100). If None, evidence
                E6 (buy_pct accumulation/distribution) is NOT collected and
                the state is derived only from price/volume evidence; if the
                remaining evidence is insufficient, the assessment falls back
                to STATE_UNCONFIRMED rather than fabricating a flow signal.
        prev_state: Previous state (for transition tracking)
        prev_date: Previous assessment date
        latest_price_date: Date of closes[-1] (YYYY-MM-DD). If empty, falls
                          back to `date` itself (assumes closes[-1] == assessment
                          date). Used for freshness check.

    Returns:
        StockStateAssessment with canonical state + evidence + confidence
    """
    assessment = StockStateAssessment(ticker=ticker, date=date, state=STATE_UNCONFIRMED, confidence=0.0)

    # ─── Data quality checks ────────────────────────────────────────────────
    if not closes or len(closes) < 50:
        assessment.state = DATA_INCOMPLETE
        assessment.data_freshness = 'incomplete'
        assessment.confidence = 0.0
        return assessment

    # FIX (Phase 2 — owner directive): use latest_price_date (or fallback to
    # assessment date) as the freshness reference, NOT datetime.now(). This
    # makes historical backtests correct and removes timezone dependency.
    freshness_ref = latest_price_date or date
    if _is_data_stale(freshness_ref, date, market=market):
        assessment.state = DATA_STALE
        assessment.data_freshness = 'stale'
        assessment.confidence = 0.0
        return assessment

    assessment.data_freshness = 'fresh'
    assessment.last_price = closes[-1]
    assessment.last_volume = volumes[-1] if volumes else 0

    # ─── Compute indicators ────────────────────────────────────────────────
    price = closes[-1]
    ma50 = _sma(closes, 50)
    # FIX (Phase 2 — owner directive): MA200 must be a real 200-day SMA.
    # Previously: `_sma(closes, 200) or _sma(closes, min(len(closes), 100))`
    # which silently substituted a shorter SMA (e.g. SMA100) and labelled it
    # MA200 — misleading E2/E3 evidence + invalid invalidation conditions.
    # Now: if < 200 closes, ma200 = None → DATA_INCOMPLETE (handled below).
    ma200 = _sma(closes, 200)
    roc_5d = _roc(closes, 5)
    roc_10d = _roc(closes, 10)
    roc_20d = _roc(closes, 20)
    atr_val = _atr(highs, lows, closes, 14)
    vol_ratio = _volume_ratio(volumes, 20)

    # FIX (Phase 2 — owner directive point (a)): missing MA200 must NOT
    # abort the entire assessment. It only disables MA200-dependent evidence
    # (E2: price vs MA200, E3: golden/death cross). Other indicators
    # (MA50, ROC, ATR, volume ratio, buy_pct) remain valid.
    # Hard floor: MA50 (50 closes minimum), ROC_10d, ATR — these are
    # required for the core price/volume evidence. If any of THEM is
    # missing, the data really is too thin to classify → DATA_INCOMPLETE.
    if not ma50 or roc_10d is None or not atr_val:
        assessment.state = DATA_INCOMPLETE
        assessment.data_freshness = 'incomplete'
        return assessment
    # ma200 may be None when 50 ≤ len(closes) < 200. E2/E3 will be skipped
    # gracefully below (see "if ma200 is not None" guards).

    atr_pct = (atr_val / price) * 100 if price > 0 else 0
    # FIX (Phase 2): no fabricated default. If buy_pct is None, E6 evidence
    # is skipped entirely (see E6 below) — state derived only from real data.
    bp = float(buy_pct) if buy_pct is not None else None

    # ─── Gather evidence ──────────────────────────────────────────────────
    evidence_support = []
    evidence_oppose = []

    # E1: Price vs MA50
    if price > ma50:
        evidence_support.append(Evidence('price_above_ma50', price - ma50, UPTREND, 1.0,
                                          f'السعر فوق MA50 ({ma50:.2f})', 'bullish'))
    else:
        evidence_oppose.append(Evidence('price_below_ma50', ma50 - price, DOWNTREND, 1.0,
                                         f'السعر تحت MA50 ({ma50:.2f})', 'bearish'))

    # E2: Price vs MA200 — SKIPPED when ma200 is None (insufficient history)
    # FIX (Phase 2 — owner directive point (a)): do NOT fabricate evidence
    # when MA200 is unavailable; simply skip E2. State will rely on other
    # indicators (MA50, ROC, ATR, volume, buy_pct).
    if ma200 is not None:
        if price > ma200:
            evidence_support.append(Evidence('price_above_ma200', price - ma200, UPTREND, 0.8,
                                              f'السعر فوق MA200 ({ma200:.2f})', 'bullish'))
        else:
            evidence_oppose.append(Evidence('price_below_ma200', ma200 - price, DOWNTREND, 0.8,
                                             f'السعر تحت MA200 ({ma200:.2f})', 'bearish'))

    # E3: MA alignment (golden/death cross) — SKIPPED when ma200 is None
    # (cannot compare MA50 to a non-existent MA200).
    if ma200 is not None:
        if ma50 > ma200:
            evidence_support.append(Evidence('ma_golden_cross', ma50 - ma200, UPTREND, 0.7,
                                              'golden cross (MA50 > MA200)', 'bullish'))
        else:
            evidence_oppose.append(Evidence('ma_death_cross', ma200 - ma50, DOWNTREND, 0.7,
                                             'death cross (MA200 > MA50)', 'bearish'))

    # E4: Short-term momentum (ROC 10d)
    if roc_10d is not None:
        if roc_10d > 5:
            evidence_support.append(Evidence('roc_10d_strong_up', roc_10d, UPTREND, 0.6,
                                              f'زخم قوي ({roc_10d:+.1f}% في 10 أيام)', 'bullish'))
        elif roc_10d > 0:
            evidence_support.append(Evidence('roc_10d_up', roc_10d, UPTREND, 0.4,
                                              f'زخم موجب ({roc_10d:+.1f}%)', 'bullish'))
        elif roc_10d > -5:
            evidence_oppose.append(Evidence('roc_10d_weak_down', roc_10d, CORRECTION_HEALTHY, 0.4,
                                             f'تراجع خفيف ({roc_10d:+.1f}%)', 'bearish'))
        else:
            evidence_oppose.append(Evidence('roc_10d_strong_down', roc_10d, DOWNTREND, 0.6,
                                             f'زخم سلبي قوي ({roc_10d:+.1f}%)', 'bearish'))

    # E5: Volume ratio (today vs 20d average)
    if vol_ratio is not None:
        if vol_ratio > 2.0:
            if roc_5d and roc_5d > 0:
                evidence_support.append(Evidence('volume_surge_bullish', vol_ratio, UPTREND, 0.5,
                                                  f'حجم مرتفع ({vol_ratio:.1f}×) مع صعود', 'bullish'))
            else:
                evidence_oppose.append(Evidence('volume_surge_bearish', vol_ratio, DISTRIBUTION, 0.5,
                                                 f'حجم مرتفع ({vol_ratio:.1f}×) مع هبوط', 'bearish'))
        elif vol_ratio < 0.5:
            evidence_support.append(Evidence('volume_quiet', vol_ratio, ACCUMULATION, 0.3,
                                              f'حجم هادئ ({vol_ratio:.1f}×) — تجميع محتمل', 'neutral'))

    # E6: Buy percentage (from money flow)
    # FIX (Phase 2): if bp is None (no money_flow data available), SKIP E6
    # entirely instead of fabricating a neutral 50%. The state will be
    # derived only from price/volume evidence; if insufficient, the
    # engine falls back to STATE_UNCONFIRMED (see state-scoring section).
    if bp is not None:
        if bp >= 60:
            if -3 <= roc_10d <= 5:
                evidence_support.append(Evidence('buy_pct_accumulation', bp, ACCUMULATION, 0.6,
                                                  f'ضغط شراء ({bp:.0f}%) مع سعر مستقر', 'bullish'))
            else:
                evidence_support.append(Evidence('buy_pct_strong', bp, UPTREND, 0.4,
                                                  f'ضغط شراء ({bp:.0f}%)', 'bullish'))
        elif bp <= 40:
            if roc_10d and roc_10d > -3:
                evidence_oppose.append(Evidence('buy_pct_distribution', bp, DISTRIBUTION, 0.6,
                                                 f'ضغط بيع ({bp:.0f}%) مع سعر مستقر', 'bearish'))
            else:
                evidence_oppose.append(Evidence('buy_pct_selling', bp, DOWNTREND, 0.6,
                                                 f'ضغط بيع ({bp:.0f}%) مع هبوط', 'bearish'))

    # E7: ATR (volatility regime)
    if atr_pct < 2.0:
        evidence_support.append(Evidence('low_volatility', atr_pct, ACCUMULATION, 0.2,
                                          f'تقلب منخفض ({atr_pct:.1f}%) — نطاق تجميع', 'neutral'))
    elif atr_pct > 6.0:
        evidence_oppose.append(Evidence('high_volatility', atr_pct, DISTRIBUTION, 0.2,
                                         f'تقلب مرتفع ({atr_pct:.1f}%) — عدم استقرار', 'bearish'))

    # E8: 5-day pullback (for CORRECTION_HEALTHY detection)
    # FIX (Phase 2): guard against ma200 being None — healthy pullback
    # requires MA50 > MA200 (bullish structure); if MA200 is unavailable,
    # we cannot confirm the structure, so E8 is skipped.
    if (roc_5d is not None and roc_5d < -2 and price > ma50
            and ma200 is not None and ma50 > ma200):
        # Price pulled back but still above MA50 and MA50 > MA200 = healthy correction
        evidence_support.append(Evidence('healthy_pullback', roc_5d, CORRECTION_HEALTHY, 0.5,
                                          f'تراجع ({roc_5d:+.1f}%) لكن البنية الإيجابية سليمة', 'bearish'))

    # E9: Recovery attempt (price crossed back above MA50 after being below)
    if len(closes) >= 52:
        prev_price_vs_ma50 = closes[-2] < ma50 and price > ma50
        if prev_price_vs_ma50:
            evidence_support.append(Evidence('recovery_cross_ma50', price - ma50, RECOVERY, 0.5,
                                              'السعر استعاد MA50 — تعافٍ محتمل', 'bullish'))

    assessment.evidence_supporting = evidence_support
    assessment.evidence_opposing = evidence_oppose

    # ─── Determine state from evidence ─────────────────────────────────────
    state_scores: Dict[str, float] = {s: 0.0 for s in ALL_STATES}

    for ev in evidence_support:
        if ev.supports in state_scores:
            state_scores[ev.supports] += ev.weight

    for ev in evidence_oppose:
        if ev.supports in state_scores:
            state_scores[ev.supports] += ev.weight

    # Find top state
    best_state = max(state_scores, key=state_scores.get)
    best_score = state_scores[best_state]

    # Need minimum evidence to confirm
    if best_score < 1.0:
        assessment.state = STATE_UNCONFIRMED
        assessment.confidence = best_score / 3.0  # low confidence
    else:
        assessment.state = best_state
        assessment.confidence = min(1.0, best_score / 4.0)  # normalize to 0-1

    # ─── Direction probability ─────────────────────────────────────────────
    bull_weight = sum(e.weight for e in evidence_support if e.direction == 'bullish')
    bear_weight = sum(e.weight for e in evidence_oppose if e.direction == 'bearish')
    total = bull_weight + bear_weight
    if total > 0:
        assessment.direction_probability = {
            'up': bull_weight / total,
            'down': bear_weight / total,
            'neutral': 0.0,
        }
    else:
        assessment.direction_probability = {'up': 0.33, 'down': 0.33, 'neutral': 0.34}

    # ─── Invalidation conditions ───────────────────────────────────────────
    if assessment.state == ACCUMULATION:
        assessment.invalidation_conditions = [
            'السعر يكسر MA50 للأسفل',
            'حجم التداول يقفز بشكل مفاجئ مع هبوط',
            'نسبة الشراء تنخفض تحت 50%',
        ]
    elif assessment.state == UPTREND:
        assessment.invalidation_conditions = [
            'السعر يكسر MA50 للأسفل',
            'MA50 يكسر MA200 للأسفل (تقاطع موت)',
            'حجم التداول ينخفض بشكل حاد مع استمرار الصعود',
        ]
    elif assessment.state == CORRECTION_HEALTHY:
        assessment.invalidation_conditions = [
            'السعر يكسر MA200 للأسفل',
            'MA50 يكسر MA200 للأسفل',
            'التداول بحجم مرتفع مع استمرار الهبوط',
        ]
    elif assessment.state == DISTRIBUTION:
        assessment.invalidation_conditions = [
            'نسبة الشراء ترتفع فوق 55%',
            'السعر يكسر MA50 للأعلى بحجم مرتفع',
        ]
    elif assessment.state == DOWNTREND:
        assessment.invalidation_conditions = [
            'السعر يستعيد MA50',
            'حجم التداول يقفز مع صعود',
        ]
    elif assessment.state == RECOVERY:
        assessment.invalidation_conditions = [
            'السعر يكسر MA50 للأسفل مرة أخرى',
            'حجم التداول ينخفض بشكل حاد',
        ]

    # ─── Transition tracking ───────────────────────────────────────────────
    if prev_state:
        assessment.prev_state = prev_state
        if prev_state == assessment.state:
            assessment.transition_type = TRANSITION_CONTINUE
        else:
            # Define upgrade/downgrade order
            state_rank = {
                DOWNTREND: 0, RECOVERY: 1, STATE_UNCONFIRMED: 2,
                ACCUMULATION: 3, CORRECTION_HEALTHY: 3,
                DISTRIBUTION: 3, UPTREND: 4,
            }
            prev_rank = state_rank.get(prev_state, 2)
            curr_rank = state_rank.get(assessment.state, 2)
            if curr_rank > prev_rank:
                assessment.transition_type = TRANSITION_UPGRADE
            elif curr_rank < prev_rank:
                assessment.transition_type = TRANSITION_DOWNGRADE
            else:
                assessment.transition_type = TRANSITION_NEW
    else:
        assessment.transition_type = TRANSITION_NEW

    return assessment


# ═══════════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print('=== canonical_stock_state.py self-test ===\n')

    # Generate synthetic data for testing
    import random
    random.seed(42)

    def gen_closes(n, start_price, trend='up', volatility=0.02):
        closes = [start_price]
        for _ in range(n - 1):
            if trend == 'up':
                change = random.gauss(0.005, volatility)
            elif trend == 'down':
                change = random.gauss(-0.005, volatility)
            elif trend == 'sideways':
                change = random.gauss(0, volatility * 0.5)
            else:
                change = random.gauss(0, volatility)
            closes.append(max(closes[-1] * (1 + change), 0.01))
        return closes

    def gen_ohlc(closes):
        highs = [c * (1 + abs(random.gauss(0, 0.01))) for c in closes]
        lows = [c * (1 - abs(random.gauss(0, 0.01))) for c in closes]
        volumes = [random.randint(100000, 500000) for _ in closes]
        return highs, lows, volumes

    # Test 1: UPTREND
    print('--- Test 1: UPTREND ---')
    closes = gen_closes(250, 100, 'up', 0.02)
    highs, lows, volumes = gen_ohlc(closes)
    result = assess_state('TEST', '2026-10-25', closes, highs, lows, volumes, buy_pct=65)
    print(f'  State: {result.state} (confidence={result.confidence:.2f})')
    print(f'  Direction: up={result.direction_probability["up"]:.2f}, down={result.direction_probability["down"]:.2f}')
    print(f'  Evidence supporting: {len(result.evidence_supporting)}')
    print(f'  Evidence opposing: {len(result.evidence_opposing)}')
    print(f'  Invalidation: {result.invalidation_conditions[:2]}')
    assert result.state in [UPTREND, ACCUMULATION], f'Expected UPTREND/ACCUMULATION, got {result.state}'
    print('  ✅ PASS\n')

    # Test 2: DOWNTREND
    print('--- Test 2: DOWNTREND ---')
    closes = gen_closes(250, 100, 'down', 0.02)
    highs, lows, volumes = gen_ohlc(closes)
    result = assess_state('TEST', '2026-10-25', closes, highs, lows, volumes, buy_pct=35)
    print(f'  State: {result.state} (confidence={result.confidence:.2f})')
    print(f'  Direction: up={result.direction_probability["up"]:.2f}, down={result.direction_probability["down"]:.2f}')
    assert result.state in [DOWNTREND, DISTRIBUTION], f'Expected DOWNTREND/DISTRIBUTION, got {result.state}'
    print('  ✅ PASS\n')

    # Test 3: SIDEWAYS (ACCUMULATION)
    print('--- Test 3: SIDEWAYS (ACCUMULATION) ---')
    closes = gen_closes(250, 100, 'sideways', 0.01)
    highs, lows, volumes = gen_ohlc(closes)
    result = assess_state('TEST', '2026-10-25', closes, highs, lows, volumes, buy_pct=65)
    print(f'  State: {result.state} (confidence={result.confidence:.2f})')
    print('  ✅ PASS\n')

    # Test 4: DATA_INCOMPLETE
    print('--- Test 4: DATA_INCOMPLETE ---')
    closes = gen_closes(30, 100, 'up', 0.02)
    highs, lows, volumes = gen_ohlc(closes)
    result = assess_state('TEST', '2026-10-25', closes, highs, lows, volumes)
    print(f'  State: {result.state}')
    assert result.state == DATA_INCOMPLETE, f'Expected DATA_INCOMPLETE, got {result.state}'
    print('  ✅ PASS\n')

    # Test 5: Transition tracking
    print('--- Test 5: Transition tracking ---')
    closes = gen_closes(250, 100, 'up', 0.02)
    highs, lows, volumes = gen_ohlc(closes)
    result = assess_state('TEST', '2026-10-25', closes, highs, lows, volumes, buy_pct=65,
                           prev_state=DOWNTREND, prev_date='2026-10-24')
    print(f'  State: {result.state}, prev: {result.prev_state}, transition: {result.transition_type}')
    assert result.transition_type in [TRANSITION_UPGRADE, TRANSITION_NEW]
    print('  ✅ PASS\n')

    # Test 6: Evidence quality
    print('--- Test 6: Evidence quality ---')
    closes = gen_closes(250, 100, 'up', 0.02)
    highs, lows, volumes = gen_ohlc(closes)
    result = assess_state('TEST', '2026-10-25', closes, highs, lows, volumes, buy_pct=65)
    for ev in result.evidence_supporting[:3]:
        print(f'  ✅ {ev.name}: {ev.value:.2f} → supports {ev.supports} (weight={ev.weight}, dir={ev.direction})')
    for ev in result.evidence_opposing[:3]:
        print(f'  ❌ {ev.name}: {ev.value:.2f} → supports {ev.supports} (weight={ev.weight}, dir={ev.direction})')
    print('  ✅ PASS\n')

    # Test 7: to_dict (for API/DB)
    print('--- Test 7: to_dict (serialization) ---')
    d = result.to_dict()
    assert 'state' in d
    assert 'evidence_supporting' in d
    assert 'direction_probability' in d
    assert 'invalidation_conditions' in d
    print(f'  Keys: {list(d.keys())[:8]}')
    print('  ✅ PASS\n')

    print('=' * 60)
    print('  ALL TESTS PASSED ✅')
    print('=' * 60)
