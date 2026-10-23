#!/usr/bin/env python3
"""
Win-Side Lesson Store (RL positive reinforcement)
===================================================
النظير الإيجابي لـ ``utils/lesson_store.py``.

``lesson_store`` بـ يصنّف ويسجّل الدروس من **الخسائر** (STOP_TOO_TIGHT،
LATE_MOMENTUM، STOPPED_OUT) عشان المايسترو يتجنبها. لكن المنصة ما كانتش
بتتعلم من **الصفقات الجيدة** — يعني لو سهم طلع +40% في 3 أيام بعد دخول
المضارب، النظام ما كانش بـ يسجّل "ده نمط كويس، كرره". الـ owner طلب صراحةً:
"فعل التعلم الذاتى من الأخطاء وتعزيز التعلم من الصفقات الجيدة".

الـ module ده بـ يضيف:

1. **Win-pattern classification** (``classify_win_pattern``):
   - EARLY_BREAKOUT:  target hit في ≤ 3 أيام تداول + return ≥ +8%
                      (دخول قبل رالي قوي — الكسب الأعلى)
   - TREND_RIDE:      target hit في 4-15 يوم + highest ≥ 2× target_distance
                      (سهم بـ يـ trend — يستاهل hold-and-raise)
   - VOLUME_CONFIRMED: target hit + volume_ratio عند الإغلاق ≥ 1.5×
                      (رالي بـ volume — إشارة قوية)
   - GRIND_WIN:       target hit بعد 16+ يوم (سهم بطيء — نتعلم الصبر)

2. **Bounded target-raise** (``compute_bounded_target_raise``):
   لو الشخصية عندها ≥ 2 EARLY_BREAKOUT في آخر 30 يوم → ارفع الـ target
   لكل صفقة جديدة بمقدار +0.25R لكل تكرار، بسقف +1.0R. ده النظير الإيجابي
   لـ ``compute_bounded_stop_expansion`` (اللي بـ يـ widen الوقف من STOP_TOO_TIGHT).

3. **T1 hold-through bias** (``compute_t1_holdthrough_bias``):
   لو الشخصية عندها ≥ 3 TREND_RIDE → الـ multi-target exit manager يـ hold
   خلال T1 (ما يبيعش 50%) عشان يلحق T2/T3. النظير الإيجابي لـ "تجنّب
   LATE_MOMENTUM".

الـ lessons بتتسجل في نفس جدول ``learned_lessons`` (مفيش schema migration)
بـ outcome='win' + recommendation=new_code. الـ Maestro بـ readها عبر
``get_persona_lesson_summary`` الموجودة (بعد تعديل بسيط يـ count الـ codes الجديدة).
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# المسارات (نفس اللي lesson_store.py بـ يستخدمه)
# ──────────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')

# ──────────────────────────────────────────────────────────────────────────
# أكواد الدروس الإيجابية (win-side lesson codes)
# ──────────────────────────────────────────────────────────────────────────
WIN_EARLY_BREAKOUT = 'WIN_EARLY_BREAKOUT'      # target hit ≤ 3d, return ≥ +8%
WIN_TREND_RIDE = 'WIN_TREND_RIDE'              # target hit 4-15d, highest ≥ 2× risk
WIN_VOLUME_CONFIRMED = 'WIN_VOLUME_CONFIRMED'  # target hit + volume ≥ 1.5× avg
WIN_GRIND_WIN = 'WIN_GRIND_WIN'                # target hit ≥ 16d (slow grind)

ALL_WIN_CODES = (WIN_EARLY_BREAKOUT, WIN_TREND_RIDE, WIN_VOLUME_CONFIRMED, WIN_GRIND_WIN)

# ──────────────────────────────────────────────────────────────────────────
# حدود التأثير المسقوف (bounded impact — النظير الإيجابي)
# ──────────────────────────────────────────────────────────────────────────
# EARLY_BREAKOUT متكرر → ارفع الـ target (+0.25R لكل تكرار، سقف +1.0R)
EARLY_BREAKOUT_TARGET_RAISE_PER_OCCURRENCE = 0.25  # +0.25R each
EARLY_BREAKOUT_TARGET_RAISE_CEIL = 1.00            # max +1.0R

# TREND_RIDE متكرر → الـ multi-target exit يـ hold خلال T1 (ما يبيعش 50%)
TREND_RIDE_HOLDTHROUGH_THRESHOLD = 3               # need ≥ 3 occurrences
TREND_RIDE_HOLDTHROUGH_BIAS = 1.0                  # 1.0 = full hold-through

# VOLUME_CONFIRMED متكرر → ارفع عتبة الـ volume (أكثر صرامة في القبول)
VOLUME_CONFIRMED_VOL_BOOST_PER_OCCURRENCE = 0.10   # +0.10× volume threshold
VOLUME_CONFIRMED_VOL_BOOST_CEIL = 0.50             # max +0.50×


# ──────────────────────────────────────────────────────────────────────────
# التصنيف (classification)
# ──────────────────────────────────────────────────────────────────────────
def classify_win_pattern(
    exit_type: str,
    holding_days: int,
    actual_return: float,
    entry_price: float,
    target_price: float,
    stop_loss: float,
    highest_price_reached: float = 0.0,
    volume_ratio_at_close: float = 0.0,
    atr_at_entry: float = 0.0,
) -> Optional[str]:
    """صنّف صفقة رابحة إلى win-pattern code.

    بـ تتـ called بس للصفقات اللي outcome='win' (return > 0 و exit=target_hit
    أو expired-win). للصفقات الخاسرة رجّع None (دي شغل lesson_store الأصلي).

    Args:
        exit_type: 'target_hit' / 'expired' / 'trailing_stop' / ...
        holding_days: عدد أيام التداول من entry لـ exit
        actual_return: العائد الفعلي %
        entry_price, target_price, stop_loss: أسعار التوقع
        highest_price_reached: أعلى سعر وصلله السهم أثناء الصفقة
        volume_ratio_at_close: volume عند الإغلاق / volume avg (1.5 = 150%)
        atr_at_entry: ATR عند الدخول (لـ حساب risk بدقة)

    Returns:
        win-code (str) أو None لو مش صفقة رابحة واضحة.
    """
    try:
        ret = float(actual_return or 0)
        hd = int(holding_days or 0)
        entry = float(entry_price or 0)
        target = float(target_price or 0)
        stop = float(stop_loss or 0)
        highest = float(highest_price_reached or 0)
        vol_ratio = float(volume_ratio_at_close or 0)
    except (TypeError, ValueError):
        return None

    # لازم تكون صفقة رابحة فعلية
    if ret < 2.0 or entry <= 0:
        return None

    exit_norm = (exit_type or '').strip().lower()
    # الـ trailing_stop / target_hit كلاهما "تنفيذ مخطط" — نـ classify.
    # الـ expired-win كمان نـ classify (GRIND_WIN غالباً).
    is_closed_win = exit_norm in ('target_hit', 'target', 'trailing_stop',
                                  'partial_trailing', 'trend_break',
                                  'momentum_dead', 'target_100pct') or \
                    (exit_norm in ('expired', 'expire') and ret >= 2.0)
    if not is_closed_win:
        return None

    # احسب risk distance (entry - stop) كـ baseline لـ R
    risk_dist = abs(entry - stop) if stop > 0 else 0
    if risk_dist <= 0:
        # لو مفيش stop واضح، استخدم ATR كـ proxy
        risk_dist = atr_at_entry if atr_at_entry > 0 else (entry * 0.05)

    # ── EARLY_BREAKOUT: سريع + عالي ──
    # target hit في ≤ 3 أيام + return ≥ 8% = دخول قبل رالي قوي
    if hd <= 3 and ret >= 8.0:
        return WIN_EARLY_BREAKOUT

    # ── TREND_RIDE: سهم بـ trend بقوة ─ـ
    # target hit في 4-15 يوم + highest ≥ 2× risk_dist (السهم طلع ضعف المخاطرة)
    if 4 <= hd <= 15 and highest > 0:
        if (highest - entry) >= 2.0 * risk_dist:
            return WIN_TREND_RIDE

    # ── VOLUME_CONFIRMED: رالي بـ volume ──
    # target hit + volume_ratio ≥ 1.5× (إذا كان الـ volume data متاح)
    if vol_ratio >= 1.5 and ret >= 5.0:
        return WIN_VOLUME_CONFIRMED

    # ── GRIND_WIN: صبر ──
    # target hit بعد 16+ يوم (سهم بطيء بس وصل)
    if hd >= 16:
        return WIN_GRIND_WIN

    # لو ما تطابقش مع نمط محدد بس ربحان → None (خلّي lesson_store الأصلي
    # يـ recordه كـ TARGET_HIT_OK)
    return None


# ──────────────────────────────────────────────────────────────────────────
# التسجيل (recording — يكتب في نفس جدول learned_lessons)
# ──────────────────────────────────────────────────────────────────────────
def record_win_lesson_from_close(
    ticker: str,
    persona: str = 'balanced',
    exit_type: str = '',
    actual_return: float = 0.0,
    holding_days: int = 0,
    entry_price: float = 0.0,
    stop_loss: float = 0.0,
    target_price: float = 0.0,
    highest_price_reached: float = 0.0,
    volume_ratio_at_close: float = 0.0,
    atr_at_entry: float = 0.0,
) -> Optional[str]:
    """سجّل درس إيجابي من صفقة رابحة (positive reinforcement).

    بـ تتـ call من ``daily_closer._mark_closed`` بعد ``record_lesson_from_close``
    الأصلي. لو الصفقة مش رابحة بوضوح → بـ return None (ما بـ يسجلش حاجة).

    Returns:
        win-code (str) لو سجّل، None لو ما سجّلش.
    """
    ticker = (ticker or '').upper().strip()
    persona = (persona or 'balanced').strip().lower()
    if persona == 'investor':
        persona = 'conservative'
    if persona not in ('gambler', 'balanced', 'conservative'):
        persona = 'balanced'

    win_code = classify_win_pattern(
        exit_type=exit_type,
        holding_days=holding_days,
        actual_return=actual_return,
        entry_price=entry_price,
        target_price=target_price,
        stop_loss=stop_loss,
        highest_price_reached=highest_price_reached,
        volume_ratio_at_close=volume_ratio_at_close,
        atr_at_entry=atr_at_entry,
    )
    if win_code is None:
        return None

    # اكتب صفّين (persona-level + ticker-level) — نفس pattern بتاع lesson_store
    now = datetime.now().isoformat()
    persona_condition = (
        f"persona={persona}|code={win_code}|ticker={ticker}"
        f"|exit={exit_type or 'unknown'}|days={holding_days or 0}"
    )
    ticker_condition = (
        f"ticker={ticker}|code={win_code}|persona={persona}"
        f"|exit={exit_type or 'unknown'}|days={holding_days or 0}"
    )

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
        cur = conn.cursor()
        for lesson_type, condition in (
            ('prediction_outcome', persona_condition),
            ('ticker_outcome', ticker_condition),
        ):
            cur.execute('''
                INSERT INTO learned_lessons
                    (lesson_type, condition, outcome, failure_rate, occurrences,
                     avg_return, recommendation, created_at, updated_at)
                VALUES (?, ?, 'win', 0.0, 1, ?, ?, ?, ?)
            ''', (
                lesson_type, condition,
                round(float(actual_return or 0), 2),
                win_code, now, now,
            ))
        conn.commit()
        conn.close()
        logger.info(
            f"[win_lesson_store] recorded WIN lesson: ticker={ticker} "
            f"persona={persona} code={win_code} return={actual_return:.2f}%"
        )
        return win_code
    except Exception as e:
        logger.warning(f"[win_lesson_store] record failed for {ticker}: {e}")
        return None


# ──────────────────────────────────────────────────────────────────────────
# التأثير المسقوف (bounded impact — النظير الإيجابي)
# ──────────────────────────────────────────────────────────────────────────
def compute_bounded_target_raise(
    persona: str,
    lesson_summary: Optional[Dict] = None,
) -> float:
    """احسب معامل رفع الـ target (additive R) من دروس EARLY_BREAKOUT.

    قاعدة: لو EARLY_BREAKOUT اتكرر ≥ 2 مرة في آخر 30 يوم للشخصية →
    ارفع الـ target لكل صفقة جديدة بمقدار +0.25R لكل تكرار، بسقف +1.0R.

    ده النظير الإيجابي لـ ``compute_bounded_stop_expansion``. الفرق:
    - stop_expansion بـ يـ widen الوقف (يقلل المخاطرة الفعلية) — defensive
    - target_raise بـ يـ extend الهدف (يزيد العائد المحتمل) — offensive

    Returns:
        float ≥ 0.0 — يُضاف لـ target كـ R multiples. (0.0 = لا تغيير)
        مثال: 0.5 → target = entry + (1.5 + 0.5) × risk = entry + 2.0 × risk
    """
    if not lesson_summary:
        # استورد من lesson_store الأصلي عشان نـ reuse الـ summary logic
        try:
            import sys
            _vps = str(Path(__file__).resolve().parent.parent)
            if _vps not in sys.path:
                sys.path.insert(0, _vps)
            from utils.lesson_store import get_persona_lesson_summary
            lesson_summary = get_persona_lesson_summary(persona, days=30)
        except Exception as e:
            logger.warning(f"[win_lesson_store] get_persona_lesson_summary failed: {e}")
            return 0.0

    count = lesson_summary.get('early_breakout_count', 0) or 0
    if count < 2:
        return 0.0
    raise_r = min(
        EARLY_BREAKOUT_TARGET_RAISE_PER_OCCURRENCE * count,
        EARLY_BREAKOUT_TARGET_RAISE_CEIL,
    )
    return round(raise_r, 3)


def compute_t1_holdthrough_bias(
    persona: str,
    lesson_summary: Optional[Dict] = None,
) -> float:
    """احسب ميل الـ multi-target exit لـ hold خلال T1 (ما يبيعش 50%).

    قاعدة: لو TREND_RIDE اتكرر ≥ 3 مرة للشخصية → الـ exit manager يـ hold
    كل الـ position خلال T1 ويستهدف T2/T3. ده لإن الـ persona دي بتـ catch
    الـ trends القوية، فـ selling at T1 بـ يـ cap الأرباح.

    Returns:
        float ∈ [0.0, 1.0]:
        - 0.0 = sell 50% at T1 (default — لا hold-through)
        - 1.0 = hold 100% through T1 (full hold-through)
    """
    if not lesson_summary:
        try:
            import sys
            _vps = str(Path(__file__).resolve().parent.parent)
            if _vps not in sys.path:
                sys.path.insert(0, _vps)
            from utils.lesson_store import get_persona_lesson_summary
            lesson_summary = get_persona_lesson_summary(persona, days=30)
        except Exception as e:
            logger.warning(f"[win_lesson_store] get_persona_lesson_summary failed: {e}")
            return 0.0

    count = lesson_summary.get('trend_ride_count', 0) or 0
    if count < TREND_RIDE_HOLDTHROUGH_THRESHOLD:
        return 0.0
    return TREND_RIDE_HOLDTHROUGH_BIAS


def compute_bounded_volume_threshold_boost(
    persona: str,
    lesson_summary: Optional[Dict] = None,
) -> float:
    """احسب رفع عتبة الـ volume من دروس VOLUME_CONFIRMED.

    لو الشخصية عندها ≥ 2 VOLUME_CONFIRMED → ارفع عتبة قبول التوصية بـ
    +0.10× لكل تكرار (سقف +0.50×). ده معناه إن المنصة بتـ require volume
    أعلى للـ entry (أكثر صرامة) لأن الـ persona دي بتـ succeed مع volume.

    Returns:
        float ≥ 0.0 — يُضاف لـ volume threshold. (0.0 = لا تغيير)
    """
    if not lesson_summary:
        try:
            import sys
            _vps = str(Path(__file__).resolve().parent.parent)
            if _vps not in sys.path:
                sys.path.insert(0, _vps)
            from utils.lesson_store import get_persona_lesson_summary
            lesson_summary = get_persona_lesson_summary(persona, days=30)
        except Exception as e:
            logger.warning(f"[win_lesson_store] get_persona_lesson_summary failed: {e}")
            return 0.0

    count = lesson_summary.get('volume_confirmed_count', 0) or 0
    if count < 2:
        return 0.0
    boost = min(
        VOLUME_CONFIRMED_VOL_BOOST_PER_OCCURRENCE * count,
        VOLUME_CONFIRMED_VOL_BOOST_CEIL,
    )
    return round(boost, 3)


# ──────────────────────────────────────────────────────────────────────────
# Helper: count win-codes من الـ DB مباشرة (fallback لو lesson_store الأصلي
# ما عدّش الـ codes الجديدة في summary)
# ──────────────────────────────────────────────────────────────────────────
def get_win_code_counts(persona: str = 'balanced', days: int = 30) -> Dict[str, int]:
    """عدّ كل win-codes لـ persona في آخر N يوم.

    Returns:
        {'WIN_EARLY_BREAKOUT': 3, 'WIN_TREND_RIDE': 1, ...}
    """
    persona = (persona or 'balanced').strip().lower()
    if persona == 'investor':
        persona = 'conservative'
    if persona not in ('gambler', 'balanced', 'conservative'):
        persona = 'balanced'

    counts = {code: 0 for code in ALL_WIN_CODES}
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
        cur = conn.cursor()
        cur.execute('''
            SELECT recommendation AS code, COUNT(*) AS cnt
            FROM learned_lessons
            WHERE lesson_type = 'prediction_outcome'
              AND condition LIKE ?
              AND outcome = 'win'
              AND created_at >= date('now', ?)
            GROUP BY recommendation
        ''', (f'persona={persona}|%', f'-{int(days)} days'))
        for row in cur.fetchall():
            code = row[0] or ''
            if code in ALL_WIN_CODES:
                counts[code] = int(row[1])
        conn.close()
    except Exception as e:
        logger.warning(f"[win_lesson_store] get_win_code_counts failed: {e}")
    return counts
