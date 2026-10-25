#!/usr/bin/env python3
"""
lesson_store.py — مخزن الدروس الموحّد (Closed-Loop Learning keystone)
=====================================================================
(B1 + B2 + B3 + B4 of the closed-loop spec)

الـ module ده هو **النقطة الوحيدة** لكتابة وقراءة دروس الإغلاق في النظام.
كل المسارات (daily_closer, maestro, stock_dna, master_analyzer) بتتعامل معه.

┌──────────────────────────────────────────────────────────────────────┐
│  CLOSED LOOP — كيف الدروس بتتحرّك في النظام                          │
│                                                                      │
│  [1] daily_closer.close_prediction()                                 │
│        ↓ يستدعي record_lesson_from_close()                           │
│  [2] lesson_store ← learned_lessons table (predictions.db)           │
│        ↓                                                             │
│  [3] maestro.analyze() → run_expert_memory_phase()                   │
│        ↓ بيقرأ get_persona_lesson_summary() + get_ticker_lessons()   │
│        ↓ log: [LEARNING] ticker=.. persona=.. lessons=..             │
│  [4] compute_persona_rr_overrides(lesson_summary=..)                 │
│        ↓ تطبّق تعديل محدود (bounded) على stop/target                 │
│  [5] التوصية الجاية بتختلف بسبب الدرس → القياس على /live-tracking    │
└──────────────────────────────────────────────────────────────────────┘

جدول `learned_lessons` (الـ schema الفعلي في predictions.db):
  (id, lesson_type, condition, outcome, failure_rate, occurrences,
   avg_return, recommendation, created_at, updated_at)

استراتيجية الكتابة (APPEND — مش UPSERT):
  كل إغلاق = صف جديد. ده بيخلّي نقدر نفلتر بـ created_at للـ "آخر N يوم"
  من غير ما نفقد granularity. الـ occurrences/failure_rate دايماً = 1 / 0|1
  لكل صف (الـ aggregation بيحصل وقت القراءة).

حقول الدرس:
  lesson_type  = 'prediction_outcome' (persona-level) | 'ticker_outcome' (ticker-level)
  condition    = 'persona=gambler|code=STOP_TOO_TIGHT|ticker=COMI|exit=stop_loss|days=1'
                 (key=value مفصولة بـ | — قابل للاستعلام بـ SQL LIKE)
  outcome      = 'win' | 'loss' | 'expired'
  failure_rate = 1.0 لو loss/expired-loss، 0.0 غير كده
  occurrences  = 1 (دائماً — append)
  avg_return   = actual_return للصف دي
  recommendation = lesson_code (STOP_TOO_TIGHT / LATE_MOMENTUM / TARGET_HIT_OK / ...)

أكواد الدروس (lesson_code):
  TARGET_HIT_OK     — نجاح عادي (exit=target_hit, return>0)
  STOP_TOO_TIGHT    — وقف ضيق جداً (exit=stop_loss, holding<=2, stop<<ATR)
  LATE_MOMENTUM     — دخول متأخر (exit=stop_loss, holding<=1, return<-3%)
  STOPPED_OUT       — وقف عادي (exit=stop_loss، مش tight ولا late)
  EXPIRED_NO_MOVE   — انتهى بدون حركة (exit=expired, |return|<2%)
  EXPIRED_LOSS      — انتهى بخسارة (exit=expired, return<-2%)
  EXPIRED_WIN       — انتهى بربح (exit=expired, return>2%)
  MISSED_BREAKOUT   — فرصة ضائعة (من B4 detection، مش من إغلاق)

Author: دليل الاستثمار
Version: 1.0.0 — Closed-Loop Phase B
"""
from __future__ import annotations

import os
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Tuple

logger = logging.getLogger(__name__)

# ============================================================================
# DB PATHS
# ============================================================================
_PROJECT_ROOT = Path(__file__).resolve().parents[2]  # vps-service/utils/.. → root
PREDICTIONS_DB = os.environ.get(
    'PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db')
)
STOCKS_DB = os.environ.get('DATABASE_PATH', str(_PROJECT_ROOT / 'db' / 'stocks.db'))


def _connect(db_path: str) -> Optional[sqlite3.Connection]:
    """افتح اتصال SQLite مع WAL + busy_timeout."""
    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(db_path, writable=True)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
        except Exception:
            pass
        return conn
    except Exception as e:
        logger.warning(f"[lesson_store] connect failed for {db_path}: {e}")
        return None


def _ensure_table() -> None:
    """تأكّد إن جدول learned_lessons موجود (idempotent)."""
    try:
        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_type TEXT,
                condition TEXT,
                outcome TEXT,
                failure_rate REAL,
                occurrences INTEGER,
                avg_return REAL,
                recommendation TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        ''')
        cur.execute(
            'CREATE INDEX IF NOT EXISTS idx_learned_lessons_type_created '
            'ON learned_lessons(lesson_type, created_at)'
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"[lesson_store] _ensure_table failed: {e}")


# ============================================================================
# B1 — تصنيف الإغلاق إلى lesson_code + كتابة الدرس
# ============================================================================
def _compute_lesson_code(
    exit_type: str,
    holding_days: int,
    actual_return: float,
    entry_price: float,
    stop_loss: float,
    target_price: float,
    atr_at_entry: float = 0.0,
) -> str:
    """صنّف نتيجة الإغلاق إلى lesson_code.

    القواعد (مستمدة من بيانات الإغلاق الفعلية، مش من الأرقام السحرية):
      - TARGET_HIT_OK:    exit=target_hit و return > 0
      - STOP_TOO_TIGHT:   exit=stop_loss و holding<=2 و stop كان أضيق من نصف ATR
      - LATE_MOMENTUM:    exit=stop_loss و holding<=1 و return < -3% (دخول متأخر)
      - STOPPED_OUT:      exit=stop_loss (الحالة العامة)
      - EXPIRED_NO_MOVE:  exit=expired و |return| < 2%
      - EXPIRED_LOSS:     exit=expired و return <= -2%
      - EXPIRED_WIN:      exit=expired و return >= 2%
    """
    exit_type = (exit_type or '').strip().lower()
    try:
        hd = int(holding_days or 0)
    except (TypeError, ValueError):
        hd = 0
    try:
        ret = float(actual_return or 0)
    except (TypeError, ValueError):
        ret = 0.0

    if exit_type in ('target_hit', 'target'):
        return 'TARGET_HIT_OK'

    if exit_type in ('stop_loss', 'stopped', 'stop'):
        # STOP_TOO_TIGHT: الوقف كان أضيق من نصف ATR → السهم ضرب الوقف بـ noise
        try:
            _entry = float(entry_price or 0)
            _stop = float(stop_loss or 0)
            _atr = float(atr_at_entry or 0)
            if _entry > 0 and _stop > 0 and _atr > 0:
                stop_dist_pct = abs(_entry - _stop) / _entry
                atr_pct = _atr / _entry
                if atr_pct > 0 and stop_dist_pct < (0.5 * atr_pct) and hd <= 2:
                    return 'STOP_TOO_TIGHT'
        except (TypeError, ValueError, ZeroDivisionError):
            pass
        # LATE_MOMENTUM: خسارة سريعة وحادة → غالباً دخول بعد رالي
        if hd <= 1 and ret < -3.0:
            return 'LATE_MOMENTUM'
        return 'STOPPED_OUT'

    if exit_type in ('expired', 'expire'):
        if abs(ret) < 2.0:
            return 'EXPIRED_NO_MOVE'
        if ret <= -2.0:
            return 'EXPIRED_LOSS'
        return 'EXPIRED_WIN'

    # fallback
    return 'TARGET_HIT_OK' if ret > 0 else 'STOPPED_OUT'


def _outcome_from_close(exit_type: str, actual_return: float) -> str:
    """حدّد outcome ('win'/'loss'/'expired') من نتيجة الإغلاق."""
    exit_type = (exit_type or '').strip().lower()
    try:
        ret = float(actual_return or 0)
    except (TypeError, ValueError):
        ret = 0.0
    if exit_type in ('expired', 'expire'):
        return 'expired'
    if ret >= 0:
        return 'win'
    return 'loss'


def _write_lesson_row(
    lesson_type: str,
    condition_str: str,
    outcome: str,
    actual_return: float,
    lesson_code: str,
) -> None:
    """اكتب صف درس واحد في learned_lessons (append — مش upsert)."""
    try:
        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return
        cur = conn.cursor()
        now = datetime.now().isoformat()
        failure_rate = 1.0 if outcome in ('loss',) else 0.0
        cur.execute('''
            INSERT INTO learned_lessons
                (lesson_type, condition, outcome, failure_rate, occurrences,
                 avg_return, recommendation, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            lesson_type, condition_str, outcome,
            round(failure_rate, 3), 1,
            round(float(actual_return or 0), 2), lesson_code,
            now, now,
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"[lesson_store] _write_lesson_row failed: {e}")


def record_lesson_from_close(
    ticker: str,
    persona: str = 'balanced',
    exit_type: str = '',
    actual_return: float = 0.0,
    holding_days: int = 0,
    entry_price: float = 0.0,
    stop_loss: float = 0.0,
    target_price: float = 0.0,
    atr_at_entry: float = 0.0,
    regime: str = '',
    score: float = 0.0,
) -> str:
    """B1 — سجّل درس من إغلاق توقع.

    بتتكتب **صفّين** لكل إغلاق:
      1. lesson_type='prediction_outcome'  — مفاتيح persona (للـ B3 bounded impact)
      2. lesson_type='ticker_outcome'      — مفاتيح ticker (للـ B2 stock_dna/master)

    Returns:
        lesson_code (str) — الكود اللي اتصنّف.
    """
    _ensure_table()
    ticker = (ticker or '').upper().strip()
    persona = (persona or 'balanced').strip().lower()
    if persona == 'investor':
        persona = 'conservative'
    if persona not in ('gambler', 'balanced', 'conservative'):
        persona = 'balanced'

    lesson_code = _compute_lesson_code(
        exit_type=exit_type,
        holding_days=holding_days,
        actual_return=actual_return,
        entry_price=entry_price,
        stop_loss=stop_loss,
        target_price=target_price,
        atr_at_entry=atr_at_entry,
    )
    outcome = _outcome_from_close(exit_type, actual_return)

    # condition = key=value مفصولة بـ | (قابل للاستعلام بـ SQL LIKE)
    # persona-level condition: بيبدأ بـ persona= عشان LIKE 'persona=gambler|%' يشتغل
    persona_condition = (
        f"persona={persona}|code={lesson_code}|ticker={ticker}"
        f"|exit={exit_type or 'unknown'}|days={holding_days or 0}"
    )
    ticker_condition = (
        f"ticker={ticker}|code={lesson_code}|persona={persona}"
        f"|exit={exit_type or 'unknown'}|days={holding_days or 0}"
    )

    _write_lesson_row(
        lesson_type='prediction_outcome',
        condition_str=persona_condition,
        outcome=outcome,
        actual_return=actual_return,
        lesson_code=lesson_code,
    )
    _write_lesson_row(
        lesson_type='ticker_outcome',
        condition_str=ticker_condition,
        outcome=outcome,
        actual_return=actual_return,
        lesson_code=lesson_code,
    )

    logger.info(
        f"[lesson_store] B1 recorded: ticker={ticker} persona={persona} "
        f"code={lesson_code} outcome={outcome} return={actual_return:.2f}%"
    )
    return lesson_code


# ============================================================================
# B2/B3 — قراءة ملخص الدروس (persona-level + ticker-level)
# ============================================================================
def get_persona_lesson_summary(persona: str = 'balanced', days: int = 30) -> Dict:
    """B3 — ملخص دروس شخصية معيّنة في آخر N يوم.

    Returns:
        {
          'persona': 'gambler',
          'window_days': 30,
          'total': 12,
          'wins': 8, 'losses': 3, 'expired': 1,
          'win_rate': 0.73,           # wins / (wins + losses) — المقفل فقط
          'avg_return': 4.2,
          'by_code': {
            'STOP_TOO_TIGHT': {'count': 2, 'avg_return': -3.1, 'outcomes': {'loss':2}},
            'TARGET_HIT_OK':  {'count': 7, 'avg_return': 8.5, 'outcomes': {'win':7}},
            ...
          },
          'stop_too_tight_count': 2,
          'late_momentum_count': 1,
          'target_hit_count': 7,
          'missed_breakout_count': 0,
        }
    """
    _ensure_table()
    persona = (persona or 'balanced').strip().lower()
    if persona == 'investor':
        persona = 'conservative'
    if persona not in ('gambler', 'balanced', 'conservative'):
        persona = 'balanced'

    summary: Dict = {
        'persona': persona,
        'window_days': days,
        'total': 0,
        'wins': 0,
        'losses': 0,
        'expired': 0,
        'win_rate': 0.0,
        'avg_return': 0.0,
        'by_code': {},
        'stop_too_tight_count': 0,
        'late_momentum_count': 0,
        'target_hit_count': 0,
        'missed_breakout_count': 0,
        # 🔥 VERIFY-RL: win-side counts (positive reinforcement)
        # بـ تتـ filled من الـ same learned_lessons table (outcome='win')
        # الـ win_lesson_store بـ يكتبها بـ recommendation=WIN_EARLY_BREAKOUT/etc.
        'early_breakout_count': 0,
        'trend_ride_count': 0,
        'volume_confirmed_count': 0,
        'grind_win_count': 0,
    }

    try:
        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return summary
        cur = conn.cursor()
        # prediction_outcome rows for this persona in the last N days
        cur.execute('''
            SELECT outcome, recommendation AS lesson_code, avg_return, condition
            FROM learned_lessons
            WHERE lesson_type = 'prediction_outcome'
              AND condition LIKE ?
              AND created_at >= date('now', ?)
            ORDER BY created_at DESC
        ''', (f'persona={persona}|%', f'-{int(days)} days'))
        rows = cur.fetchall()
        conn.close()

        if not rows:
            return summary

        returns = []
        for r in rows:
            outcome = r['outcome'] or 'unknown'
            code = r['lesson_code'] or 'UNKNOWN'
            ret = float(r['avg_return'] or 0)
            summary['total'] += 1
            if outcome == 'win':
                summary['wins'] += 1
            elif outcome == 'loss':
                summary['losses'] += 1
            elif outcome == 'expired':
                summary['expired'] += 1
            returns.append(ret)

            bucket = summary['by_code'].setdefault(
                code, {'count': 0, 'avg_return': 0.0, 'outcomes': {}}
            )
            bucket['count'] += 1
            bucket['outcomes'][outcome] = bucket['outcomes'].get(outcome, 0) + 1
            # running avg
            bucket['avg_return'] = round(
                (bucket['avg_return'] * (bucket['count'] - 1) + ret) / bucket['count'], 2
            )

            if code == 'STOP_TOO_TIGHT':
                summary['stop_too_tight_count'] += 1
            elif code == 'LATE_MOMENTUM':
                summary['late_momentum_count'] += 1
            elif code == 'TARGET_HIT_OK':
                summary['target_hit_count'] += 1
            elif code == 'MISSED_BREAKOUT':
                summary['missed_breakout_count'] += 1
            # 🔥 VERIFY-RL: win-side codes (positive reinforcement)
            elif code == 'WIN_EARLY_BREAKOUT':
                summary['early_breakout_count'] += 1
            elif code == 'WIN_TREND_RIDE':
                summary['trend_ride_count'] += 1
            elif code == 'WIN_VOLUME_CONFIRMED':
                summary['volume_confirmed_count'] += 1
            elif code == 'WIN_GRIND_WIN':
                summary['grind_win_count'] += 1

        settled = summary['wins'] + summary['losses']
        summary['win_rate'] = round(summary['wins'] / settled, 3) if settled > 0 else 0.0
        summary['avg_return'] = round(sum(returns) / len(returns), 2) if returns else 0.0
    except Exception as e:
        logger.warning(f"[lesson_store] get_persona_lesson_summary failed: {e}")

    return summary


def get_ticker_lesson_summary(ticker: str, days: int = 60) -> Dict:
    """B2 — ملخص دروس سهم معيّن في آخر N يوم (للـ stock_dna / master_analyzer).

    Returns نفس شكل get_persona_lesson_summary بس مع 'ticker' بدل 'persona'.
    """
    _ensure_table()
    ticker = (ticker or '').upper().strip()
    summary: Dict = {
        'ticker': ticker,
        'window_days': days,
        'total': 0,
        'wins': 0,
        'losses': 0,
        'expired': 0,
        'win_rate': 0.0,
        'avg_return': 0.0,
        'by_code': {},
        'recent_codes': [],
    }
    if not ticker:
        return summary

    try:
        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return summary
        cur = conn.cursor()
        # ticker_outcome rows — condition بيبدأ بـ ticker= أو يحتوي |ticker=
        cur.execute('''
            SELECT outcome, recommendation AS lesson_code, avg_return, condition, created_at
            FROM learned_lessons
            WHERE lesson_type = 'ticker_outcome'
              AND (condition LIKE ? OR condition LIKE ?)
              AND created_at >= date('now', ?)
            ORDER BY created_at DESC
        ''', (f'ticker={ticker}|%', f'%|ticker={ticker}|%', f'-{int(days)} days'))
        rows = cur.fetchall()
        conn.close()

        if not rows:
            return summary

        returns = []
        recent_codes = []
        for r in rows:
            outcome = r['outcome'] or 'unknown'
            code = r['lesson_code'] or 'UNKNOWN'
            ret = float(r['avg_return'] or 0)
            summary['total'] += 1
            if outcome == 'win':
                summary['wins'] += 1
            elif outcome == 'loss':
                summary['losses'] += 1
            elif outcome == 'expired':
                summary['expired'] += 1
            returns.append(ret)
            if len(recent_codes) < 5:
                recent_codes.append(code)
            bucket = summary['by_code'].setdefault(
                code, {'count': 0, 'avg_return': 0.0, 'outcomes': {}}
            )
            bucket['count'] += 1
            bucket['outcomes'][outcome] = bucket['outcomes'].get(outcome, 0) + 1
            bucket['avg_return'] = round(
                (bucket['avg_return'] * (bucket['count'] - 1) + ret) / bucket['count'], 2
            )

        settled = summary['wins'] + summary['losses']
        summary['win_rate'] = round(summary['wins'] / settled, 3) if settled > 0 else 0.0
        summary['avg_return'] = round(sum(returns) / len(returns), 2) if returns else 0.0
        summary['recent_codes'] = recent_codes
    except Exception as e:
        logger.warning(f"[lesson_store] get_ticker_lesson_summary failed: {e}")

    return summary


def get_ticker_lesson_notes(ticker: str, limit: int = 5) -> List[str]:
    """B2 — قائمة دروس نصية مختصرة لسهم (للـ stock_dna_analyzer._get_learned_lessons).

    بترجّع دروس عربية قصيرة عشان الـ DNA analyzer يضمّها في شخصية السهم.
    """
    summ = get_ticker_lesson_summary(ticker, days=90)
    if summ['total'] == 0:
        return []
    notes = []
    _AR = {
        'TARGET_HIT_OK': 'حقق هدفه بنجاح',
        'STOP_TOO_TIGHT': 'وقف ضيق — يُضرب بسرعة',
        'LATE_MOMENTUM': 'دخول متأخر — خسارة سريعة',
        'STOPPED_OUT': 'توقّف بخسارة',
        'EXPIRED_NO_MOVE': 'انتهى بدون حركة',
        'EXPIRED_LOSS': 'انتهى بخسارة',
        'EXPIRED_WIN': 'انتهى بربح',
        'MISSED_BREAKOUT': 'فرصة ضائعة — كسر لم يُلتقط',
    }
    for code, bucket in sorted(
        summ['by_code'].items(), key=lambda x: x[1]['count'], reverse=True
    )[:limit]:
        ar = _AR.get(code, code)
        notes.append(
            f"{ar} ({bucket['count']}×، متوسط {bucket['avg_return']:.1f}%)"
        )
    return notes


# ============================================================================
# B3 — الحدود الآمنة للتعديل (Ceilings — مش أرقام سحرية)
# ============================================================================
# لما persona عندها تكرار STOP_TOO_TIGHT → وسّع الوقف. التعديل محصور في سقف.
# الحدود دي مستمدة من ATR السهم (نفس قاعدة الـ DNA RR) — مش ثابتة.
STOP_TOO_TIGHT_EXPANSION_PER_OCCURRENCE = 0.10  # +10% من مسافة الوقف لكل تكرار
STOP_TOO_TIGHT_EXPANSION_CEIL = 0.40            # حد أقصى +40% (لا يتعدّاها أبداً)
LATE_MOMENTUM_GATE_TIGHTEN_PER_OCCURRENCE = 0.5 # +0.5 نقطة على عتبة الزخم
LATE_MOMENTUM_GATE_TIGHTEN_CEIL = 3.0           # حد أقصى +3 نقاط


def compute_bounded_stop_expansion(
    persona: str,
    lesson_summary: Optional[Dict] = None,
) -> float:
    """B3 — احسب معامل توسيع الوقف (multiplier على stop_pct) من دروس الشخصية.

    قاعدة: لو STOP_TOO_TIGHT اتكرر ≥ 2 مرة في آخر 30 يوم للشخصية →
    وسّع الوقف بمقدار 0.10 × count، بسقف 0.40.

    Returns:
        float ≥ 1.0 — اضرب فيها stop_pct. (1.0 = لا تغيير)
    """
    if not lesson_summary:
        lesson_summary = get_persona_lesson_summary(persona, days=30)
    count = lesson_summary.get('stop_too_tight_count', 0)
    if count < 2:
        return 1.0
    expansion = min(
        STOP_TOO_TIGHT_EXPANSION_PER_OCCURRENCE * count,
        STOP_TOO_TIGHT_EXPANSION_CEIL,
    )
    return round(1.0 + expansion, 3)


def compute_bounded_momentum_gate_delta(
    persona: str,
    lesson_summary: Optional[Dict] = None,
) -> float:
    """B3 — احسب تعديل عتبة الزخم (additive) من دروس LATE_MOMENTUM.

    قاعدة: لو LATE_MOMENTUM اتكرر ≥ 2 مرة → ارفع عتبة الزخم لتفادي الدخول المتأخر.
    التعديل additive (نقاط مئوية) ومحصور في سقف.

    Returns:
        float ≥ 0.0 — يُضاف لعتبة الزخم. (0.0 = لا تغيير)
    """
    if not lesson_summary:
        lesson_summary = get_persona_lesson_summary(persona, days=30)
    count = lesson_summary.get('late_momentum_count', 0)
    if count < 2:
        return 0.0
    delta = min(
        LATE_MOMENTUM_GATE_TIGHTEN_PER_OCCURRENCE * count,
        LATE_MOMENTUM_GATE_TIGHTEN_CEIL,
    )
    return round(delta, 2)


# ============================================================================
# B4 — الفرص الضائعة → دروس
# ============================================================================
def detect_and_record_missed_opportunities(
    days: int = 1,
    change_threshold: float = 8.0,
    market: str = 'EGX',
) -> int:
    """B4 — امسح الأسهم اللي تحرّكت بقوة بدون توصية شراء → سجّل MISSED_BREAKOUT.

    منطق:
      1. اقرأ egksco_stocks (stocks.db) للأسهم اللي change_percent >= threshold.
      2. لكل سهم، تأكّد إن مفيش BUY/STRONG_BUY prediction في آخر `days` يوم.
      3. لو مفيش → سجّل درس MISSED_BREAKOUT (persona=gambler — فرص الزخم مضاربية).

    Args:
        days: عدد الأيام للنظر للوراء (1 = النهارده).
        change_threshold: الحد الأدنى لتغير السعر % لاعتباره "فرصة ضائعة".
        market: السوق (EGX افتراضياً).

    Returns:
        عدد الدروس اللي اتسجّلت.
    """
    _ensure_table()
    recorded = 0
    try:
        # 1. اقرأ الأسهم اللي تحرّكت بقوة من egksco_stocks
        conn = _connect(STOCKS_DB)
        if not conn:
            return 0
        cur = conn.cursor()
        cur.execute('''
            SELECT symbol, last_price, change_pct, prev_close
            FROM egksco_stocks
            WHERE change_pct >= ?
            ORDER BY change_pct DESC
            LIMIT 50
        ''', (change_threshold,))
        movers = [dict(r) for r in cur.fetchall()]
        conn.close()

        if not movers:
            return 0

        # 2. اقرأ الـ tickers اللي ليها BUY predictions في آخر N يوم
        conn = _connect(PREDICTIONS_DB)
        if not conn:
            return 0
        cur = conn.cursor()
        cur.execute('''
            SELECT DISTINCT ticker FROM predictions
            WHERE signal IN ('BUY', 'STRONG_BUY', 'buy', 'strong_buy', 'ACCUMULATE')
              AND created_at >= date('now', ?)
        ''', (f'-{int(days)} days',))
        covered_tickers = {r[0].upper().strip() for r in cur.fetchall() if r[0]}
        conn.close()

        # 3. سجّل MISSED_BREAKOUT للي مش مغطّى
        for m in movers:
            ticker = (m.get('symbol') or '').upper().strip()
            if not ticker or ticker in covered_tickers:
                continue
            change_pct = float(m.get('change_pct') or 0)
            # condition للمضارب (big movers = gambler territory)
            condition = (
                f"persona=gambler|code=MISSED_BREAKOUT|ticker={ticker}"
                f"|change={change_pct:.1f}%|window={days}d"
            )
            _write_lesson_row(
                lesson_type='prediction_outcome',
                condition_str=condition,
                outcome='missed',
                actual_return=change_pct,
                lesson_code='MISSED_BREAKOUT',
            )
            recorded += 1
            logger.info(
                f"[lesson_store] B4 missed: ticker={ticker} change=+{change_pct:.1f}% "
                f"— no BUY in last {days}d"
            )
    except Exception as e:
        logger.warning(f"[lesson_store] detect_and_record_missed_opportunities failed: {e}")

    return recorded


# ============================================================================
# B5 — الفرص الضائعة التاريخية للسهم (Missed Upside Feedback Loop keystone)
# ============================================================================
# 🔥 P0-v7 TASK #1: المالك اشتكى إن السيستم بيـ cap الهدف عند +3% حتى لو السهم
#    تاريخياً بيعمل +50%/+100%. الحل: قبل ما الـ maestro يحدد الهدف، لازم
#    يقرأ التاريخ الفعلي للسهم — أعلى سعر وصلته في صفقات سابقة +
#    عدد المرات اللي السهم اتسجّل فيها MISSED_BREAKOUT (اتحرك بقوة من غير
#    توصية شراء). لو السهم "انفجاري تاريخياً" → فك الـ Caps وفعّل Uncap Targets.
# ============================================================================
EXPLOSIVE_MAX_UPSIDE_PCT = 15.0   # لو السهم وصل +15%+ في صفقات سابقة → انفجاري
EXPLOSIVE_MISSED_BREAKOUT_COUNT = 2  # لو اتسجّل MISSED_BREAKOUT ≥ 2 → انفجاري


def get_ticker_explosive_history(ticker: str, days: int = 90) -> Dict:
    """B5 (P0-v7) — السجل الانفجاري التاريخي للسهم (Missed Upside Loop).

    بـ يقرأ:
      1. جدول ``predictions`` للسهم في آخر ``days`` يوم — بـ يحسب أعلى سعر
         وصلته الصفقة (``highest_price_reached``) نسبةً لسعر الدخول.
      2. دروس ``MISSED_BREAKOUT`` للسهم في ``learned_lessons`` (عدد المرات
         اللي السهم اتحرك فيها بقوة من غير توصية شراء).

    Returns:
        dict بالشكل:
        {
          'ticker': 'ABUK',
          'is_explosive': True,                # max_upside≥15% OR missed≥2
          'max_upside_pct': 38.5,              # أعلى upside وصلته صفقة سابقة
          'avg_upside_pct': 18.2,              # متوسط الـ upside لكل الصفقات
          'explosive_count': 3,                # عدد الصفقات اللي وصلت +15%+
          'missed_breakout_count': 2,          # من learned_lessons
          'total_history': 7,                  # إجمالي الصفقات في النافذة
          'reason': 'max_upside +38.5% (3 explosive trades)',
        }

    الـ maestro بـ يستخدم ``is_explosive`` عشان:
      - يفعّل ``_mom_is_momentum = True`` → فك الـ Caps (Uncap Targets)
      - يـ boost الـ confidence لو السهم انفجاري تاريخياً
      - يـ boost الـ maestro_score لو فيه MISSED_BREAKOUT متكرر (تعويض)
    """
    _ensure_table()
    ticker = (ticker or '').upper().strip()
    result: Dict = {
        'ticker': ticker,
        'is_explosive': False,
        'max_upside_pct': 0.0,
        'avg_upside_pct': 0.0,
        'explosive_count': 0,
        'missed_breakout_count': 0,
        'total_history': 0,
        'reason': '',
    }
    if not ticker:
        return result

    # ── (1) اقرأ highest_price_reached من predictions ──
    upsides: List[float] = []
    try:
        conn = _connect(PREDICTIONS_DB)
        if conn:
            cur = conn.cursor()
            # PRAGMA table_info للتحقق من وجود الأعمدة (schema-aware — P0-v2 pattern)
            cur.execute("PRAGMA table_info(predictions)")
            cols = {r['name'] for r in cur.fetchall()} if cur.row_factory else {r[1] for r in cur.fetchall()}
            if 'highest_price_reached' in cols and 'entry_price' in cols:
                cur.execute('''
                    SELECT highest_price_reached, entry_price, signal
                    FROM predictions
                    WHERE ticker = ?
                      AND created_at >= date('now', ?)
                      AND highest_price_reached IS NOT NULL
                      AND highest_price_reached > 0
                      AND entry_price IS NOT NULL
                      AND entry_price > 0
                ''', (ticker, f'-{int(days)} days'))
                for r in cur.fetchall():
                    try:
                        _hp = float(r['highest_price_reached'] if cur.row_factory else r[0])
                        _ep = float(r['entry_price'] if cur.row_factory else r[1])
                        if _ep > 0 and _hp > _ep:
                            upsides.append(((_hp / _ep) - 1.0) * 100.0)
                    except (TypeError, ValueError, ZeroDivisionError):
                        continue
            conn.close()
    except Exception as e:
        logger.warning(f"[lesson_store] get_ticker_explosive_history predictions read failed: {e}")

    result['total_history'] = len(upsides)
    if upsides:
        result['max_upside_pct'] = round(max(upsides), 2)
        result['avg_upside_pct'] = round(sum(upsides) / len(upsides), 2)
        result['explosive_count'] = sum(1 for u in upsides if u >= EXPLOSIVE_MAX_UPSIDE_PCT)

    # ── (2) اقرأ MISSED_BREAKOUT count من learned_lessons ──
    try:
        summ = get_ticker_lesson_summary(ticker, days=days)
        if summ and summ.get('by_code'):
            mb_bucket = summ['by_code'].get('MISSED_BREAKOUT', {})
            result['missed_breakout_count'] = int(mb_bucket.get('count', 0) or 0)
    except Exception as e:
        logger.warning(f"[lesson_store] get_ticker_explosive_history lessons read failed: {e}")

    # ── (3) حدّد is_explosive ──
    _reasons = []
    if result['max_upside_pct'] >= EXPLOSIVE_MAX_UPSIDE_PCT:
        _reasons.append(f"max_upside +{result['max_upside_pct']:.1f}% "
                        f"({result['explosive_count']} explosive trades)")
    if result['missed_breakout_count'] >= EXPLOSIVE_MISSED_BREAKOUT_COUNT:
        _reasons.append(f"missed_breakout ×{result['missed_breakout_count']}")
    result['is_explosive'] = bool(_reasons)
    result['reason'] = ' · '.join(_reasons) if _reasons else 'no explosive history'

    return result


# ============================================================================
# Self-test
# ============================================================================
if __name__ == '__main__':
    import sys
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')

    print("\n=== lesson_store self-test ===\n")

    # 1. record a synthetic lesson
    code = record_lesson_from_close(
        ticker='TEST', persona='gambler', exit_type='stop_loss',
        actual_return=-4.2, holding_days=1, entry_price=100.0,
        stop_loss=98.5, target_price=106.0, atr_at_entry=2.5,
    )
    print(f"recorded lesson_code = {code}")

    # 2. persona summary
    for p in ('gambler', 'balanced', 'conservative'):
        s = get_persona_lesson_summary(p, days=30)
        print(f"\npersona={p}: total={s['total']} wins={s['wins']} losses={s['losses']} "
              f"win_rate={s['win_rate']} STT={s['stop_too_tight_count']} "
              f"LM={s['late_momentum_count']} TH={s['target_hit_count']} "
              f"MB={s['missed_breakout_count']}")

    # 3. ticker summary
    ts = get_ticker_lesson_summary('TEST', days=30)
    print(f"\nticker=TEST: total={ts['total']} recent={ts['recent_codes']}")
    print(f"  notes: {get_ticker_lesson_notes('TEST')}")

    # 4. bounded expansion
    exp = compute_bounded_stop_expansion('gambler')
    print(f"\nbounded stop expansion (gambler): {exp}×")

    # 5. missed opportunities
    mb = detect_and_record_missed_opportunities(days=1, change_threshold=5.0)
    print(f"\nmissed opportunities detected: {mb}")

    # 6. P0-v7: explosive history
    eh = get_ticker_explosive_history('TEST', days=90)
    print(f"\nexplosive history for TEST: {eh}")

    print("\n=== done ===")
