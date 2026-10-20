"""
expert_memory_v402.py — V40.2 canonical lesson-veto (replaces maestro shim).
=========================================================================
BRAVO MAESTRO-CANCER-1 STEP 3 (re-implement before removal).

Replaces `maestro_orchestrator.run_expert_memory_phase` with a V40.2-native
version that reads from the SAME lesson store (learned_lessons table) and
applies the SAME logic — but lives inside V40.2 (no maestro import).

Rule 11 (SSOT): lesson_store is the canonical lesson source.
Rule 17 (relative paths): works on laptop + VPS + sandbox.
Rule 20 (Python = Brain): all logic in Python.

Key fix: the old daily_predictor checked `_em.recommendation == 'block'` but
run_expert_memory_phase NEVER returned 'block' (only proceed/caution/boost) →
the veto was DEAD CODE. This version returns the correct values AND the caller
now checks 'caution' (not 'block') to actually apply the lesson.

Usage:
    from utils.expert_memory_v402 import run_expert_memory_phase_v402, ExpertMemoryResultV402
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class ExpertMemoryResultV402:
    """V40.2 lesson-veto result (mirrors ExpertMemoryResult from maestro)."""
    found_similar: bool
    total_similar: int
    win_rate: float
    avg_pnl: float
    confidence_adjustment: float
    recommendation: str  # 'proceed' | 'caution' | 'boost'
    reason: str
    pattern_type: str = 'none'
    stop_widen_atr: float = 0.0
    applied_lesson: str = ''
    target_raise_r: float = 0.0
    t1_holdthrough_bias: float = 0.0


def run_expert_memory_phase_v402(
    db_path: str,
    ticker: str,
    sector: str,
    regime: str,
    rsi: float,
    month: int,
    personality: Optional[str] = None,
    persona_name: str = 'balanced',
) -> ExpertMemoryResultV402:
    """V40.2 closed-loop lesson-veto — reads learned_lessons, applies bounded decision.

    This is a faithful re-implementation of maestro_orchestrator.run_expert_memory_phase.
    Reads from the SAME lesson_store (utils.lesson_store) so historical lessons still apply.

    Logic (bounded — no unbounded overrides):
      1. Read persona lesson summary (last 30 days) + ticker lesson summary (last 90 days).
      2. If no lessons → 'proceed' (honest — system still gathering data).
      3. win_rate < 0.35 AND total >= 3 → 'caution' (reduce confidence)
      4. win_rate >= 0.65 AND total >= 3 → 'boost' (increase confidence)
      5. ticker STOP_TOO_TIGHT >= 2 → 'caution' + widen stop
      6. ticker LATE_MOMENTUM >= 2 → 'caution'
      7. ticker MISSED_BREAKOUT >= 2 → 'boost' (compensation)
      8. Else → 'proceed'

    Returns: ExpertMemoryResultV402 with recommendation in {'proceed','caution','boost'}.
    """
    try:
        from utils.lesson_store import get_persona_lesson_summary, get_ticker_lesson_summary
    except ImportError:
        return ExpertMemoryResultV402(
            found_similar=False, total_similar=0, win_rate=0.5, avg_pnl=0,
            confidence_adjustment=0, recommendation='proceed',
            reason='lesson_store unavailable', pattern_type='none',
        )

    try:
        persona_summ = get_persona_lesson_summary(persona_name, days=30)
        ticker_summ = get_ticker_lesson_summary(ticker, days=90)

        p_total = persona_summ.get('total', 0)
        t_total = ticker_summ.get('total', 0)
        total_similar = p_total + t_total

        # No lessons → proceed honestly
        if total_similar == 0:
            return ExpertMemoryResultV402(
                found_similar=False, total_similar=0, win_rate=0.5, avg_pnl=0,
                confidence_adjustment=0, recommendation='proceed',
                reason='no lessons yet — system still gathering data',
                pattern_type='none',
            )

        win_rate = persona_summ.get('win_rate', 0.0)
        avg_pnl = persona_summ.get('avg_return', 0.0)

        recommendation = 'proceed'
        confidence_adjustment = 0.0
        reason_parts = []
        pattern_type = 'persona_history'

        # Rule 1: weak persona performance
        if p_total >= 3 and win_rate < 0.35:
            recommendation = 'caution'
            confidence_adjustment = -min(10, (0.35 - win_rate) * 30)
            reason_parts.append(
                f"persona {persona_name}: {p_total} trades, win_rate {win_rate:.0%} (< 35%)"
            )
        # Rule 2: strong persona performance
        elif p_total >= 3 and win_rate >= 0.65:
            recommendation = 'boost'
            confidence_adjustment = min(8, (win_rate - 0.65) * 25)
            reason_parts.append(
                f"persona {persona_name}: {p_total} trades, win_rate {win_rate:.0%} (>= 65%)"
            )

        # Rule 3: ticker STOP_TOO_TIGHT repeated
        stt = ticker_summ.get('by_code', {}).get('STOP_TOO_TIGHT', {}).get('count', 0)
        if stt >= 2:
            if recommendation == 'proceed':
                recommendation = 'caution'
            confidence_adjustment = min(0, confidence_adjustment) - min(5, stt * 2)
            reason_parts.append(f"ticker {ticker}: stop_too_tight {stt}x")
            pattern_type = 'stop_too_tight'

        # Rule 4: ticker LATE_MOMENTUM repeated
        lm = ticker_summ.get('by_code', {}).get('LATE_MOMENTUM', {}).get('count', 0)
        if lm >= 2:
            if recommendation == 'proceed':
                recommendation = 'caution'
            confidence_adjustment = min(0, confidence_adjustment) - min(5, lm * 2)
            reason_parts.append(f"ticker {ticker}: late_momentum {lm}x")
            pattern_type = 'late_momentum'

        # Rule 5: MISSED_BREAKOUT compensation (boost)
        mb = ticker_summ.get('by_code', {}).get('MISSED_BREAKOUT', {}).get('count', 0)
        if mb >= 2:
            if recommendation == 'proceed':
                recommendation = 'boost'
            _mb_boost = min(10, mb * 3)
            confidence_adjustment = max(0, confidence_adjustment) + _mb_boost
            reason_parts.append(f"ticker {ticker}: missed_breakout {mb}x -> +{_mb_boost}")
            if pattern_type in ('none', 'persona_history'):
                pattern_type = 'missed_breakout_compensation'

        # D2: bounded stop widening (STOP_TOO_TIGHT)
        stop_widen_atr = 0.0
        applied_lesson = ''
        if stt >= 2:
            stop_widen_atr = round(min(0.5, stt * 0.15), 2)
            applied_lesson = f"widen_stop +{stop_widen_atr:.2f}ATR (STOP_TOO_TIGHT {stt}x on {ticker})"
        else:
            _p_stt = int(persona_summ.get('stop_too_tight_count', 0) or 0)
            if _p_stt >= 3:
                stop_widen_atr = round(min(0.4, _p_stt * 0.08), 2)
                applied_lesson = f"widen_stop +{stop_widen_atr:.2f}ATR (persona {persona_name} STOP_TOO_TIGHT {_p_stt}x)"

        # VERIFY-RL: positive reinforcement (win-side)
        target_raise_r = 0.0
        t1_holdthrough_bias = 0.0
        try:
            _eb_count = int(persona_summ.get('early_breakout_count', 0) or 0)
            _tr_count = int(persona_summ.get('trend_ride_count', 0) or 0)
            if _eb_count >= 2:
                target_raise_r = round(min(1.0, 0.25 * _eb_count), 3)
                _win_msg = f"raise_target +{target_raise_r:.2f}R (EARLY_BREAKOUT {_eb_count}x on persona {persona_name})"
                applied_lesson = (applied_lesson + ' | ' if applied_lesson else '') + _win_msg
            if _tr_count >= 3:
                t1_holdthrough_bias = 1.0
        except Exception as _rl_err:
            logger.debug(f"[LEARNING-V402] win-side adjustment failed: {_rl_err}")

        reason = ' | '.join(reason_parts) if reason_parts else f"{total_similar} lessons available"

        # No-apply reason (for transparency)
        no_apply_reason = ''
        if total_similar > 0 and confidence_adjustment == 0.0 and not applied_lesson:
            if p_total < 3:
                no_apply_reason = f"insufficient_persona_samples (p_total={p_total} < 3)"
            elif 0.35 <= win_rate < 0.65:
                no_apply_reason = f"neutral_zone (win_rate={win_rate:.0%} in [35%, 65%))"
            else:
                no_apply_reason = "no_matching_pattern"

        _learn_msg = (
            f"[LEARNING-V402] ticker={ticker} persona={persona_name} "
            f"lessons={total_similar} (persona={p_total} ticker={t_total}) "
            f"win_rate={win_rate:.0%} recommendation={recommendation} "
            f"conf_adj={confidence_adjustment:+.1f}"
        )
        if applied_lesson:
            _learn_msg += f" applied={applied_lesson}"
        elif no_apply_reason:
            _learn_msg += f" no_apply={no_apply_reason}"
        logger.info(_learn_msg)
        print(_learn_msg, flush=True)

        return ExpertMemoryResultV402(
            found_similar=True,
            total_similar=total_similar,
            win_rate=win_rate,
            avg_pnl=avg_pnl,
            confidence_adjustment=round(confidence_adjustment, 1),
            recommendation=recommendation,
            reason=reason,
            pattern_type=pattern_type,
            stop_widen_atr=stop_widen_atr,
            applied_lesson=applied_lesson,
            target_raise_r=target_raise_r,
            t1_holdthrough_bias=t1_holdthrough_bias,
        )
    except Exception as e:
        logger.warning(f"[LEARNING-V402] run_expert_memory_phase_v402 failed: {e}")
        return ExpertMemoryResultV402(
            found_similar=False, total_similar=0, win_rate=0.5, avg_pnl=0,
            confidence_adjustment=0, recommendation='proceed',
            reason=f'lesson read error: {e}', pattern_type='none',
        )


__all__ = ['ExpertMemoryResultV402', 'run_expert_memory_phase_v402']
