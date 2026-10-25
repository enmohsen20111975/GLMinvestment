#!/usr/bin/env python3
"""
Multi-Target Exit Manager (T1 / T2 / T3) + Dynamic Stop Management
==================================================================
الـ module ده بـ ينفّذ طلب المالك الصريح:

  > "أحط أكتر من سيناريو للتعامل وأحط هدف أول وتانى وتالت كمان وبناء على
  >  حركة السهم ممكن ابعد وقف الخسارة شوية عالشان يستحمل تزبزب السهم وكمان
  >  أرفع المستهدف لو السهم فية حركة جيدة"

الـ manager ده بـ يشتغل **ALONGSIDE** سياسات الخروج الموجودة (مش بـ يستبدلها).
بيـ trigger بس لو ``prediction['exit_policy'] == 'multi_target'``. لو رجع
``None`` (مفيش trigger)، الـ daily_closer بـ fall through للـ policies التالية
(dynamic_exit, explosive, partial) — zero blast radius.

┌──────────────────────────────────────────────────────────────────────┐
│  سياسة الخروج متعددة الأهداف                                        │
├──────────────────────────────────────────────────────────────────────┤
│  عند إنشاء التوقع:                                                   │
│    T1 = entry + 1.5R   (initial target — بـ sell 50% + move stop BE) │
│    T2 = entry + 2.5R   (secondary — بـ sell 25% + trail)             │
│    T3 = entry + 4.0R   (stretch — بـ sell remaining 25%)             │
│  R = |entry - stop| (المخاطرة المخططة)                               │
│                                                                      │
│  القرارات اليومية (forward-walk على price_history):                  │
│    1. T1 hit + momentum weak  → sell 50%, stop → breakeven           │
│    2. T1 hit + momentum strong → HOLD (don't sell), aim T2/T3        │
│       (hold-through bias من win_lesson_store لو TREND_RIDE متكرر)    │
│    3. T2 hit → sell 25%, trail stop under T1 by N×ATR               │
│    4. T3 hit → sell remaining 25%                                    │
│    5. Trailing stop hit → exit remaining position                    │
│    6. Volatility expand: ATR spikes >50% → widen stop +0.5 ATR      │
│       (بس لو الصفقة رابحة — tolerate zigzag)                        │
│    7. Trend break: close < SMA20 after being above → exit           │
│    8. Momentum dead: 3-day momentum < 0 after T1 → exit             │
│    9. Max holding 90 days → expire                                   │
└──────────────────────────────────────────────────────────────────────┘

الـ persona trail multipliers:
  gambler      = 1.5 ATR (tight — fast exits)
  balanced     = 2.0 ATR (medium)
  conservative = 2.5 ATR (loose — tolerate zigzag)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr
from analyzers.indicators.ma import sma as _canonical_sma

# P1.5: migrated 6 constants to engine_settings. الـ constants المحلية بقت
# بـ read من engine_settings عبر get_setting() (لا fallback default — بـ يـ use
# DEFAULT_SETTINGS[key] داخليًا).
from analyzers.engine_settings import get_setting

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Persona trail multipliers (كم ATR تحت أعلى close)
# P1.5: PERSONA_TRAIL_ATR بقى settings-driven shim (3 flat keys in engine_settings).
# ──────────────────────────────────────────────────────────────────────────
def _build_persona_trail_atr() -> dict:
    """Build PERSONA_TRAIL_ATR dict from engine_settings flat keys.
    P1.5: migrated from hardcoded dict to settings-driven dict."""
    return {
        'gambler':      get_setting('persona_trail_atr_gambler'),
        'balanced':     get_setting('persona_trail_atr_balanced'),
        'conservative': get_setting('persona_trail_atr_conservative'),
    }


class _DeprecatedPersonaTrailAtr(dict):
    """P1.5: deprecated shim — بـ read من engine_settings ديناميكيًا."""

    def __getitem__(self, key):
        return _build_persona_trail_atr()[key]

    def get(self, key, default=None):
        return _build_persona_trail_atr().get(key, default)

    def __contains__(self, key):
        return key in _build_persona_trail_atr()

    def __iter__(self):
        return iter(_build_persona_trail_atr())

    def keys(self):
        return _build_persona_trail_atr().keys()

    def values(self):
        return _build_persona_trail_atr().values()

    def items(self):
        return _build_persona_trail_atr().items()


PERSONA_TRAIL_ATR = _DeprecatedPersonaTrailAtr()


# ──────────────────────────────────────────────────────────────────────────
# Target levels (في R multiples من risk distance)
# ──────────────────────────────────────────────────────────────────────────
T1_R_MULTIPLE = 1.5      # initial target
T2_R_MULTIPLE = 2.5      # secondary
T3_R_MULTIPLE = 4.0      # stretch

# Partial sale sizes (fractions of full position)
T1_SELL_FRACTION = 0.50   # sell 50% at T1
T2_SELL_FRACTION = 0.25   # sell 25% at T2
T3_SELL_FRACTION = 0.25   # sell remaining 25% at T3

# Volatility-expand trigger — P1.5: بـ read من engine_settings (لا fallback).
VOLATILITY_EXPAND_ATR_THRESHOLD = get_setting('volatility_expand_atr_threshold')   # recent ATR > 1.5× entry ATR
VOLATILITY_EXPAND_STOP_WIDEN_ATR = get_setting('volatility_expand_stop_widen_atr')  # widen stop by +0.5 ATR
VOLATILITY_EXPAND_MIN_PROFIT_PCT = get_setting('volatility_expand_min_profit_pct')  # only widen if trade in profit ≥ 2%

# Backtest forward-window horizon (NOT the production max_holding_days).
# P1.1/P1.5 (REFACTORING_REPORT §8.4): توضيح إن القيمة دي مفهوم مختلف عن
# engine_settings.max_holding_days=30 (دول الإنتاج) و عن persona overrides
# في unified_config.py (scalper=1, trader=10, conservative=30, investor=90).
# P1.5: القيمة بـ read من engine_settings.backtest_forward_window_days.
MAX_HOLDING_DAYS = int(get_setting('backtest_forward_window_days'))

# Momentum thresholds for T1 hold-through decision
MOMENTUM_STRONG_5D_PCT = 3.0   # 5-day close change ≥ 3% = strong momentum
SMA20_PERIOD = 20

# ──────────────────────────────────────────────────────────────────────────
# 🔥 RL-FIX-2: Hard max-loss protection + split detection fix
# P1.5: constants بـ read من engine_settings (لا fallback).
# ──────────────────────────────────────────────────────────────────────────
# المشكلة: كان فيه صفقات بـ exit عند end_of_data بـ -90% لـ -99% لأن:
#   (a) الـ split detection (line ~325) كان بـ zero out الـ `low` لما السعر
#       ينزل تحت 20% من entry → الـ trailing stop check (`low > 0`) كان بـ fail
#       → الـ stop ما بـ يـ triggerش → الصفقة بـ تفضل مفتوحة لـ end_of_data.
#   (b) مفيش hard cap علشان أقصى خسارة — لو الـ initial stop بعيد جداً (مثلاً
#       -80%)، السهم ينزل -90% والـ stop ما بـ يـ triggerش.
#
# الحل:
#   1. HARD_MAX_LOSS_PCT: أقصى خسارة مطلقة (15%) — بـ trigger على أي bar لو
#      low ≤ entry × (1 - 0.15). ده بـ cap الـ worst case بـ ~-15%.
#   2. STOP_LOSS_SANITY_CAP_PCT: لو الـ stop_loss بعيد أكثر من 30% من entry
#      → cap عند 30% (علشان T1/T2/T3 ما بـ becomesش unreachable).
#   3. SPLIT_DETECT_RATIO: detect الـ splits بـ comparing لـ prev_close (مش
#      entry_price). لو low < prev_close × 0.3 → split suspected → skip bar.
HARD_MAX_LOSS_PCT = get_setting('hard_max_loss_pct')          # absolute max loss: exit at -15%
STOP_LOSS_SANITY_CAP_PCT = get_setting('stop_loss_sanity_cap_pct')   # cap unreasonable wide stops at 30%
SPLIT_DETECT_RATIO = get_setting('split_detect_ratio')          # if low < prev_close × 0.3 → likely split


# ──────────────────────────────────────────────────────────────────────────
# النتيجة (result dataclass)
# ──────────────────────────────────────────────────────────────────────────
@dataclass
class MultiTargetExitResult:
    """نتيجة محاكاة/تنفيذ سياسة multi-target exit."""
    exited: bool = False
    exit_type: str = ''           # t1_partial | t2_partial | t3_full | trailing_stop | trend_break | momentum_dead | expired | volatility_widen_stop | hard_stop_loss
    exit_price: float = 0.0
    exit_date: str = ''
    days_to_exit: int = 0
    realized_return_pct: float = 0.0   # weighted avg return across partials
    # partial exits (للتوثيق + الـ backtest)
    t1_hit: bool = False
    t2_hit: bool = False
    t3_hit: bool = False
    t1_partial_return_pct: Optional[float] = None   # realized on T1 sale
    t2_partial_return_pct: Optional[float] = None
    t3_partial_return_pct: Optional[float] = None
    highest_price_reached: float = 0.0
    stop_adjusted: bool = False
    stop_widen_reason: str = ''
    log: List[str] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────
# حساب مستويات T1/T2/T3
# ──────────────────────────────────────────────────────────────────────────
def compute_target_levels(
    signal: str,
    entry_price: float,
    stop_loss: float,
    target_price: float,
    target_raise_r: float = 0.0,
) -> Dict[str, float]:
    """احسب T1/T2/T3 prices من entry + stop.

    Args:
        signal: BUY/STRONG_BUY/.../SELL
        entry_price: سعر الدخول
        stop_loss: وقف الخسارة
        target_price: الـ target الأصلي (للـ reference)
        target_raise_r: R multiples إضافية من win_lessons (مثلاً +0.5R)
                       — بـ يـ raise كل من T1/T2/T3

    Returns:
        {'t1': float, 't2': float, 't3': float, 'r_distance': float}
    """
    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
    is_sell = sig in ('SELL', 'STRONG_SELL', 'REDUCE')

    if not is_buy and not is_sell:
        return {'t1': target_price, 't2': target_price, 't3': target_price, 'r_distance': 0.0}

    risk_dist = abs(entry_price - stop_loss)
    if risk_dist <= 0:
        return {'t1': target_price, 't2': target_price, 't3': target_price, 'r_distance': 0.0}

    t1_r = T1_R_MULTIPLE + target_raise_r
    t2_r = T2_R_MULTIPLE + target_raise_r
    t3_r = T3_R_MULTIPLE + target_raise_r

    if is_buy:
        t1 = entry_price + t1_r * risk_dist
        t2 = entry_price + t2_r * risk_dist
        t3 = entry_price + t3_r * risk_dist
    else:  # SELL
        t1 = entry_price - t1_r * risk_dist
        t2 = entry_price - t2_r * risk_dist
        t3 = entry_price - t3_r * risk_dist

    return {
        't1': round(t1, 4),
        't2': round(t2, 4),
        't3': round(t3, 4),
        'r_distance': round(risk_dist, 4),
    }


# ──────────────────────────────────────────────────────────────────────────
# قرار T1 hold-through (لو momentum قوي → ما تبيعش عند T1)
# ──────────────────────────────────────────────────────────────────────────
def decide_t1_holdthrough(
    price_history: List[Dict],
    entry_idx: int,
    current_idx: int,
    holdthrough_bias: float = 0.0,
) -> Tuple[bool, str]:
    """قرر هل نـ hold خلال T1 (ما نبيعش 50%) أم نـ sell.

    لو الـ momentum قوي (5d change ≥ 3%) → hold عشان نلحق T2/T3.
    لو الـ holdthrough_bias = 1.0 (من win_lessons TREND_RIDE) → always hold.

    Returns:
        (hold: bool, reason: str)
    """
    # لو الـ persona عندها TREND_RIDE متكرر → hold دايماً عند T1
    if holdthrough_bias >= 1.0:
        return True, 't1_holdthrough_bias=1.0 (TREND_RIDE pattern)'

    # احسب 5-day momentum
    if current_idx - entry_idx < 5:
        # أقل من 5 أيام — مفيش data كافي. default: sell at T1 (آمن).
        return False, 'insufficient_history (<5d) → sell at T1'
    try:
        closes = [float(price_history[i].get('close', 0) or 0)
                  for i in range(current_idx - 5, current_idx + 1)]
        if len(closes) >= 6 and closes[0] > 0 and closes[-1] > 0:
            momentum_5d = (closes[-1] / closes[0] - 1) * 100
            if momentum_5d >= MOMENTUM_STRONG_5D_PCT:
                return True, f'strong_momentum_5d={momentum_5d:.1f}% (≥{MOMENTUM_STRONG_5D_PCT}%)'
            return False, f'weak_momentum_5d={momentum_5d:.1f}% → sell at T1'
    except (IndexError, ValueError, ZeroDivisionError):
        pass
    return False, 'default → sell at T1'


# ──────────────────────────────────────────────────────────────────────────
# حساب ATR (للـ trailing + volatility-expand)
# ──────────────────────────────────────────────────────────────────────────
def _compute_atr(price_history: List[Dict], end_idx: int, period: int = 14) -> float:
    """احسب ATR(14) لـ price_history حتى end_idx (Wilder's smoothing).

    BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
    Keeps backward-compat fallback (0.0) on insufficient data.
    """
    if end_idx < period or len(price_history) <= end_idx:
        return 0.0
    try:
        slice_hist = price_history[:end_idx + 1]
        highs = [float(r.get('high', 0) or 0) for r in slice_hist]
        lows = [float(r.get('low', 0) or 0) for r in slice_hist]
        closes = [float(r.get('close', 0) or 0) for r in slice_hist]
        valid = [(h, l, c) for h, l, c in zip(highs, lows, closes) if h > 0 and l > 0 and c > 0]
        if len(valid) < period + 1:
            return 0.0
        v_highs, v_lows, v_closes = (list(t) for t in zip(*valid))
        atr = _canonical_calc_atr(v_highs, v_lows, v_closes, period=period)
        return atr if atr is not None else 0.0
    except (IndexError, ValueError):
        return 0.0


def _compute_sma(closes: List[float], period: int) -> float:
    """احسب SMA(period) لآخر N عناصر.

    BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma.
    Keeps backward-compat fallback (0.0) on insufficient data.
    """
    if len(closes) < period:
        return 0.0
    sma_val = _canonical_sma(closes, period)
    return sma_val if sma_val is not None else 0.0


# ──────────────────────────────────────────────────────────────────────────
# المحاكاة الكاملة (forward-walk) — للـ backtest + للـ live exit decision
# ──────────────────────────────────────────────────────────────────────────
def simulate_multi_target_exit(
    signal: str,
    entry_price: float,
    stop_loss: float,
    target_price: float,
    entry_idx: int,
    price_history: List[Dict],
    persona: str = 'balanced',
    atr_at_entry: float = 0.0,
    holdthrough_bias: float = 0.0,
    target_raise_r: float = 0.0,
) -> MultiTargetExitResult:
    """محاكاة سياسة multi-target exit على price_history.

    بـ تتـ used في:
      1. الـ backtest (scripts/multi_target_backtest.py) — يحاكي كل صفقة تاريخية
      2. الـ live daily_closer — يقرر هل يقفل التوقع دلوقتي ولا لأ

    Args:
        signal: BUY/SELL/...
        entry_price, stop_loss, target_price: أسعار التوقع
        entry_idx: index في price_history يوم الدخول
        price_history: قائمة daily bars [{'date','open','high','low','close','volume'}, ...]
        persona: gambler/balanced/conservative
        atr_at_entry: ATR عند الدخول (للـ volatility-expand)
        holdthrough_bias: 0.0-1.0 (من win_lessons TREND_RIDE)
        target_raise_r: R multiples إضافية (من win_lessons EARLY_BREAKOUT)

    Returns:
        MultiTargetExitResult
    """
    result = MultiTargetExitResult()
    sig = (signal or '').upper().strip()
    is_buy = sig in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY')
    is_sell = sig in ('SELL', 'STRONG_SELL', 'REDUCE')

    if not (is_buy or is_sell) or entry_price <= 0 or stop_loss <= 0:
        result.log.append('skip: invalid signal or prices')
        return result

    # 🔥 Direction sanity: لو الـ stop inverted (BUY مع stop ≥ entry، أو SELL مع
    # stop ≤ entry) → الـ risk_dist هتبقى huge → T3 = 4×huge = أرقام خيالية
    # (شفنا +9825% في backtest بسبب كده). skip الـ sim بدل ما نـ produce noise.
    if is_buy and stop_loss >= entry_price:
        result.log.append(f'skip: inverted stop (BUY stop={stop_loss} ≥ entry={entry_price})')
        return result
    if is_sell and stop_loss <= entry_price:
        result.log.append(f'skip: inverted stop (SELL stop={stop_loss} ≤ entry={entry_price})')
        return result

    levels = compute_target_levels(signal, entry_price, stop_loss, target_price, target_raise_r)
    t1, t2, t3, risk_dist = levels['t1'], levels['t2'], levels['t3'], levels['r_distance']
    if risk_dist <= 0:
        result.log.append('skip: risk_dist=0')
        return result

    trail_atr_mult = PERSONA_TRAIL_ATR.get(persona, 2.0)

    # 🔥 RL-FIX-2: Stop-loss sanity cap.
    # لو الـ stop_loss بعيد أكثر من STOP_LOSS_SANITY_CAP_PCT من entry → الـ T1/T2/T3
    # بـ becomes unreachable (T1 = entry + 1.5×risk_dist، لو risk_dist كبير → T1 بعيد
    # جداً) والـ trade بـ holds لـ end_of_data بـ خسارة كارثية. cap عند 30%.
    stop_loss_pct = abs(entry_price - stop_loss) / entry_price * 100
    if stop_loss_pct > STOP_LOSS_SANITY_CAP_PCT:
        capped_stop_dist = entry_price * (STOP_LOSS_SANITY_CAP_PCT / 100.0)
        if is_buy:
            stop_loss = round(entry_price - capped_stop_dist, 4)
        else:
            stop_loss = round(entry_price + capped_stop_dist, 4)
        result.log.append(
            f'stop_capped: original stop_loss_pct={stop_loss_pct:.1f}% > {STOP_LOSS_SANITY_CAP_PCT}% '
            f'→ capped to {stop_loss} ({STOP_LOSS_SANITY_CAP_PCT}% from entry)'
        )
        # re-compute levels with capped stop
        levels = compute_target_levels(signal, entry_price, stop_loss, target_price, target_raise_r)
        t1, t2, t3, risk_dist = levels['t1'], levels['t2'], levels['t3'], levels['r_distance']
        if risk_dist <= 0:
            result.log.append('skip: risk_dist=0 after cap')
            return result

    current_stop = stop_loss

    # 🔥 RL-FIX-2: Hard max-loss price.
    # أقصى خسارة مطلقة — بـ trigger قبل أي check تاني. ده بـ protect ضد الـ catastrophic
    # drops اللي كانت بـ produce -90%+ losses عند end_of_data.
    if is_buy:
        hard_stop_price = entry_price * (1.0 - HARD_MAX_LOSS_PCT / 100.0)
    else:
        hard_stop_price = entry_price * (1.0 + HARD_MAX_LOSS_PCT / 100.0)

    highest = entry_price
    lowest = entry_price
    position_remaining = 1.0   # fraction of position still open
    realized_returns = []       # list of (fraction, return_pct) for weighted avg

    result.log.append(
        f'start: signal={sig} entry={entry_price} stop={stop_loss} '
        f'T1={t1} T2={t2} T3={t3} risk={risk_dist:.3f} trail={trail_atr_mult}ATR '
        f'hold_bias={holdthrough_bias} raise_R={target_raise_r}'
    )

    max_idx = min(entry_idx + MAX_HOLDING_DAYS, len(price_history) - 1)

    prev_close = entry_price   # for split detection (compare to previous bar)

    for j in range(entry_idx + 1, max_idx + 1):
        day = price_history[j]
        day_date = str(day.get('date', ''))
        high = float(day.get('high', 0) or 0)
        low = float(day.get('low', 0) or 0)
        close = float(day.get('close', 0) or 0)
        if high <= 0 and low <= 0 and close <= 0:
            continue

        # 🔥 RL-FIX-2: Split detection — compare to PREVIOUS close (not entry_price).
        # قبل كده كان بـ zero out `low` لو < entry × 0.2. ده كان بـ disable الـ trailing
        # stop check (`low > 0` بـ fail) للـ crashed stocks → -90% losses.
        # دلوقتي: لو low أو high بـ indicates split (نسبة لـ prev_close) → skip bar.
        # ده بـ preserve الـ stop loss checks على الـ bars العادية.
        if prev_close > 0:
            if 0 < low < prev_close * SPLIT_DETECT_RATIO:
                # likely stock split (price dropped >70% in one bar) — skip, don't zero
                result.log.append(f'day{j-entry_idx}: split suspected (low={low} < prev_close×{SPLIT_DETECT_RATIO}={prev_close*SPLIT_DETECT_RATIO:.3f}) → skip bar')
                if close > 0:
                    prev_close = close
                continue
            if high > prev_close * (1.0 / SPLIT_DETECT_RATIO):
                # likely reverse split (price jumped >3x in one bar) — skip
                result.log.append(f'day{j-entry_idx}: reverse split suspected (high={high} > prev_close×{1.0/SPLIT_DETECT_RATIO:.1f}={prev_close/SPLIT_DETECT_RATIO:.3f}) → skip bar')
                if close > 0:
                    prev_close = close
                continue

        if high > 0:
            highest = max(highest, high)
        if low > 0:
            lowest = min(lowest, low) if lowest > 0 else low

        days_held = j - entry_idx

        # 🔥 RL-FIX-2: Hard max-loss stop (BEFORE trailing stop).
        # ده بـ cap الـ worst-case loss بـ ~-15%. بـ trigger على أي bar لو السعر
        # نزل تحت hard_stop_price. ده بـ prevent الـ -90%+ catastrophic losses.
        if is_buy and low > 0 and low <= hard_stop_price:
            frac = position_remaining
            ret_pct = ((hard_stop_price - entry_price) / entry_price) * 100
            realized_returns.append((frac, ret_pct))
            result.exited = True
            result.exit_type = 'hard_stop_loss'
            result.exit_price = hard_stop_price
            result.exit_date = day_date
            result.days_to_exit = days_held
            result.highest_price_reached = highest
            result.log.append(f'day{days_held}: HARD_STOP hit low={low} hard_stop={hard_stop_price} ret={ret_pct:.2f}% frac={frac:.2f}')
            break
        if is_sell and high > 0 and high >= hard_stop_price:
            frac = position_remaining
            ret_pct = ((entry_price - hard_stop_price) / entry_price) * 100
            realized_returns.append((frac, ret_pct))
            result.exited = True
            result.exit_type = 'hard_stop_loss'
            result.exit_price = hard_stop_price
            result.exit_date = day_date
            result.days_to_exit = days_held
            result.highest_price_reached = highest
            result.log.append(f'day{days_held}: HARD_STOP hit high={high} hard_stop={hard_stop_price} ret={ret_pct:.2f}% frac={frac:.2f}')
            break

        # update prev_close for next iteration's split detection
        if close > 0:
            prev_close = close

        # ── 1. Trailing stop check (hit?) ──
        # وقف trailing بـ يـ trigger لو low ≤ current_stop.
        #
        # 🔥 Bug fix: كان فيه guard قديم `current_stop < entry_price` (و `> entry_price`
        #    للـ SELL) كان بـ يعطّل الـ trailing stop بالكامل بعد T1. لما T1 يتـ hit،
        #    current_stop بيتـ move لـ entry_price (breakeven)، فالـ guard بقى False
        #    دايماً → الـ 50% الباقية بتـ lose وقف الخسارة → عومق لـ -62% (avg loss).
        #    شلنا الـ guard علشان الـ stop يـ fire عند أي مستوى (initial / breakeven /
        #    trailed). ده بـ يـ protect الـ remaining position بعد T1.
        if is_buy and low > 0 and low <= current_stop:
            # بيع الـ remaining position عند trailing stop
            frac = position_remaining
            ret_pct = ((current_stop - entry_price) / entry_price) * 100
            realized_returns.append((frac, ret_pct))
            result.exited = True
            result.exit_type = 'trailing_stop'
            result.exit_price = current_stop
            result.exit_date = day_date
            result.days_to_exit = days_held
            result.highest_price_reached = highest
            result.log.append(f'day{days_held}: trailing_stop hit low={low} stop={current_stop} ret={ret_pct:.2f}% frac={frac:.2f}')
            break
        if is_sell and high > 0 and high >= current_stop:
            frac = position_remaining
            ret_pct = ((entry_price - current_stop) / entry_price) * 100
            realized_returns.append((frac, ret_pct))
            result.exited = True
            result.exit_type = 'trailing_stop'
            result.exit_price = current_stop
            result.exit_date = day_date
            result.days_to_exit = days_held
            result.highest_price_reached = highest
            result.log.append(f'day{days_held}: trailing_stop hit high={high} stop={current_stop} ret={ret_pct:.2f}% frac={frac:.2f}')
            break

        # ── 2. T1 hit ──
        if not result.t1_hit:
            t1_triggered = (is_buy and high > 0 and high >= t1) or (is_sell and low > 0 and low <= t1)
            if t1_triggered:
                result.t1_hit = True
                # قرار hold-through
                hold, reason = decide_t1_holdthrough(price_history, entry_idx, j, holdthrough_bias)
                if hold:
                    result.log.append(f'day{days_held}: T1={t1} hit → HOLD ({reason})')
                else:
                    # sell 50% at T1, move stop to breakeven
                    frac = T1_SELL_FRACTION
                    ret_pct = ((t1 - entry_price) / entry_price) * 100 if is_buy else ((entry_price - t1) / entry_price) * 100
                    realized_returns.append((frac, ret_pct))
                    position_remaining -= frac
                    result.t1_partial_return_pct = ret_pct
                    # move stop to breakeven
                    old_stop = current_stop
                    current_stop = entry_price
                    result.stop_adjusted = True
                    result.log.append(
                        f'day{days_held}: T1={t1} hit → SELL {frac:.0%} @ ret={ret_pct:.2f}% '
                        f'stop {old_stop:.3f}→BE({current_stop:.3f}) ({reason})'
                    )

        # ── 3. T2 hit ──
        if result.t1_hit and not result.t2_hit:
            t2_triggered = (is_buy and high > 0 and high >= t2) or (is_sell and low > 0 and low <= t2)
            if t2_triggered:
                result.t2_hit = True
                frac = T2_SELL_FRACTION
                ret_pct = ((t2 - entry_price) / entry_price) * 100 if is_buy else ((entry_price - t2) / entry_price) * 100
                realized_returns.append((frac, ret_pct))
                position_remaining -= frac
                result.t2_partial_return_pct = ret_pct
                # trail stop under T1 by N×ATR
                atr_now = _compute_atr(price_history, j) or atr_at_entry
                if atr_now > 0:
                    if is_buy:
                        current_stop = max(current_stop, t1 - trail_atr_mult * atr_now)
                    else:
                        current_stop = min(current_stop, t1 + trail_atr_mult * atr_now) if current_stop > entry_price else current_stop
                result.stop_adjusted = True
                result.log.append(
                    f'day{days_held}: T2={t2} hit → SELL {frac:.0%} @ ret={ret_pct:.2f}% '
                    f'trail stop→{current_stop:.3f} (under T1 by {trail_atr_mult}ATR)'
                )

        # ── 4. T3 hit ──
        if result.t2_hit and not result.t3_hit:
            t3_triggered = (is_buy and high > 0 and high >= t3) or (is_sell and low > 0 and low <= t3)
            if t3_triggered:
                result.t3_hit = True
                frac = position_remaining  # sell all remaining
                ret_pct = ((t3 - entry_price) / entry_price) * 100 if is_buy else ((entry_price - t3) / entry_price) * 100
                realized_returns.append((frac, ret_pct))
                position_remaining = 0.0
                result.t3_partial_return_pct = ret_pct
                result.exited = True
                result.exit_type = 't3_full'
                result.exit_price = t3
                result.exit_date = day_date
                result.days_to_exit = days_held
                result.highest_price_reached = highest
                result.log.append(f'day{days_held}: T3={t3} hit → SELL remaining {frac:.0%} @ ret={ret_pct:.2f}% → DONE')
                break

        # ── 5. Volatility-expand: لو ATR spike → widen stop +0.5 ATR ──
        # (بس لو الصفقة رابحة — tolerate zigzag)
        if result.t1_hit and atr_at_entry > 0:
            atr_now = _compute_atr(price_history, j)
            if atr_now > VOLATILITY_EXPAND_ATR_THRESHOLD * atr_at_entry:
                profit_pct = ((close - entry_price) / entry_price) * 100 if is_buy else ((entry_price - close) / entry_price) * 100
                if profit_pct >= VOLATILITY_EXPAND_MIN_PROFIT_PCT:
                    old_stop = current_stop
                    if is_buy:
                        current_stop = max(current_stop, current_stop - VOLATILITY_EXPAND_STOP_WIDEN_ATR * atr_now)
                    else:
                        if current_stop > entry_price:
                            current_stop = min(current_stop, current_stop + VOLATILITY_EXPAND_STOP_WIDEN_ATR * atr_now)
                    if current_stop != old_stop:
                        result.stop_adjusted = True
                        result.stop_widen_reason = f'volatility_expand (ATR {atr_now:.3f} > {VOLATILITY_EXPAND_ATR_THRESHOLD}× entry ATR)'
                        result.log.append(
                            f'day{days_held}: VOLATILITY_EXPAND → widen stop {old_stop:.3f}→{current_stop:.3f} '
                            f'(ATR={atr_now:.3f}, profit={profit_pct:.1f}%)'
                        )

        # ── 6. Trend break: close < SMA20 بعد ما كانت فوقها ──
        if result.t1_hit and j >= SMA20_PERIOD:
            try:
                closes_recent = [float(price_history[i].get('close', 0) or 0) for i in range(j - SMA20_PERIOD + 1, j + 1)]
                closes_recent = [c for c in closes_recent if c > 0]
                if len(closes_recent) >= SMA20_PERIOD:
                    sma20 = _compute_sma(closes_recent, SMA20_PERIOD)
                    if sma20 > 0:
                        trend_broken = (is_buy and close < sma20 and closes_recent[-2] >= sma20) or \
                                       (is_sell and close > sma20 and closes_recent[-2] <= sma20)
                        if trend_broken and position_remaining > 0:
                            frac = position_remaining
                            ret_pct = ((close - entry_price) / entry_price) * 100 if is_buy else ((entry_price - close) / entry_price) * 100
                            realized_returns.append((frac, ret_pct))
                            result.exited = True
                            result.exit_type = 'trend_break'
                            result.exit_price = close
                            result.exit_date = day_date
                            result.days_to_exit = days_held
                            result.highest_price_reached = highest
                            result.log.append(f'day{days_held}: TREND_BREAK close={close} < SMA20={sma20:.3f} → exit {frac:.0%} @ ret={ret_pct:.2f}%')
                            break
            except (IndexError, ValueError):
                pass

        # ── 7. Max holding ──
        if days_held >= MAX_HOLDING_DAYS and position_remaining > 0:
            frac = position_remaining
            ret_pct = ((close - entry_price) / entry_price) * 100 if is_buy else ((entry_price - close) / entry_price) * 100
            realized_returns.append((frac, ret_pct))
            result.exited = True
            result.exit_type = 'expired'
            result.exit_price = close
            result.exit_date = day_date
            result.days_to_exit = days_held
            result.highest_price_reached = highest
            result.log.append(f'day{days_held}: MAX_HOLDING expired → exit {frac:.0%} @ ret={ret_pct:.2f}%')
            break

    # ── 8. لو فضل position open (مفيش trigger) → exit عند آخر bar ──
    if not result.exited and position_remaining > 0:
        last_day = price_history[max_idx]
        close = float(last_day.get('close', 0) or 0)
        if close > 0:
            frac = position_remaining
            ret_pct = ((close - entry_price) / entry_price) * 100 if is_buy else ((entry_price - close) / entry_price) * 100
            realized_returns.append((frac, ret_pct))
            result.exited = True
            result.exit_type = 'end_of_data'
            result.exit_price = close
            result.exit_date = str(last_day.get('date', ''))
            result.days_to_exit = max_idx - entry_idx
            result.highest_price_reached = highest
            result.log.append(f'end_of_data → exit {frac:.0%} @ ret={ret_pct:.2f}%')

    # ── weighted avg realized return ──
    if realized_returns:
        total_frac = sum(f for f, _ in realized_returns)
        if total_frac > 0:
            result.realized_return_pct = round(
                sum(f * r for f, r in realized_returns) / total_frac, 2
            )

    return result


# ──────────────────────────────────────────────────────────────────────────
# Helper: ربط الـ manager بـ prediction (للـ live daily_closer)
# ──────────────────────────────────────────────────────────────────────────
def attach_to_prediction(
    prediction: Dict,
    price_history: List[Dict],
    entry_idx: int,
    holdthrough_bias: float = 0.0,
    target_raise_r: float = 0.0,
) -> Optional[MultiTargetExitResult]:
    """واجهة للـ daily_closer: خد prediction dict + price_history → قرر الإغلاق.

    بـ تتـ called من ``daily_closer.close_prediction`` لو ``exit_policy == 'multi_target'``.
    لو رجعت result.exited=True → الـ closer بـ mark as closed بالـ result values.
    لو رجعت False → fall through للـ policies التالية.

    Args:
        prediction: dict من predictions table (لازم فيه entry_price, stop_loss,
                    target_price, signal, persona, atr_at_entry)
        price_history: list of daily bars (date, open, high, low, close, volume)
        entry_idx: index of entry day in price_history
        holdthrough_bias: من win_lesson_store.compute_t1_holdthrough_bias
        target_raise_r: من win_lesson_store.compute_bounded_target_raise

    Returns:
        MultiTargetExitResult or None
    """
    signal = prediction.get('signal', '') or ''
    entry_price = float(prediction.get('entry_price', 0) or 0)
    stop_loss = float(prediction.get('stop_loss', 0) or 0)
    target_price = float(prediction.get('target_price', 0) or 0)
    persona = (prediction.get('persona', 'balanced') or 'balanced').lower()
    atr_at_entry = float(prediction.get('atr_at_entry', 0) or 0)

    if entry_price <= 0 or stop_loss <= 0 or entry_idx < 0:
        return None
    if entry_idx >= len(price_history) - 1:
        return None  # مفيش bars بعد entry

    return simulate_multi_target_exit(
        signal=signal,
        entry_price=entry_price,
        stop_loss=stop_loss,
        target_price=target_price,
        entry_idx=entry_idx,
        price_history=price_history,
        persona=persona,
        atr_at_entry=atr_at_entry,
        holdthrough_bias=holdthrough_bias,
        target_raise_r=target_raise_r,
    )
