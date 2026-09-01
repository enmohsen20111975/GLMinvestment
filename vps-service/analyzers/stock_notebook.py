#!/usr/bin/env python3
"""
Stock Notebook System — نظام نوتبوك الأسهم
============================================
طبقة معرفة دائمة لكل سهم.

الرؤية (من توجيه المالك):
  كل سهم يكون ليه ملف دائم (نوتبوك) فيه ملخص سلوكي وملاحظات مستفادة من تاريخه.
  الملف ده بيتكتب مرة ويتحدث فقط لما يحصل شيء مهم جديد.
  لما النظام ييجي يحلل السهم، يقرأ النوتبوك الأول وياخد منه سياق ثابت.

ده مش بديل للمحركات. ده طبقة فوقية بتدي استقرار وذكاء سياقي.

البنية:
  notebooks/
  └── EGX/
      ├── COMI.json
      ├── HRHO.json
      └── ... (ملف لكل سهم)

الـ module بـ يوفّر:
  1. load_stock_notebook(symbol) — تحميل النوتبوك كامل
  2. get_machine_summary(symbol) — جيب machine_summary فقط (للـ V40.2)
  3. update_stock_notebook(symbol, updates) — تحديث جزئي آمن
  4. ensure_notebook_exists(symbol) — إنشاء ملف أساسي لو مش موجود
  5. add_lesson(symbol, lesson) — إضافة درس جديد

التكامل في V40.2:
  - في بداية مسار التحليل، يحمل النوتبوك
  - يستخدم machine_summary لتعديل القرار:
    - danger_level >= 4 → تقليل الحجم
    - typical_correction_pct → مراجعة مسافة الوقف
    - avoid_chase → دعم قرار الرفض

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import os
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
NOTEBOOKS_DIR = PROJECT_ROOT / 'notebooks'

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. Default Values (آمنة — لو الملف مش موجود)
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_MACHINE_SUMMARY = {
    'typical_correction_pct': 0,
    'max_expected_correction_pct': 0,
    'liquidity_profile': 'medium',
    'danger_level': 1,
    'preferred_entry_style': 'correction_or_grab',
    'avoid_chase': True,
    'distribution_sensitivity': 'medium',
}

DEFAULT_NOTEBOOK = {
    'symbol': '',
    'name_ar': '',
    'market': 'EGX',
    'sector': '',
    'last_updated': '',
    'version': 1,
    'identity': {
        'is_index_related': False,
        'related_index': None,
        'liquidity_profile': 'medium',
        'free_float_note': '',
        'ownership_concentration': 'medium',
        'is_story_stock': False,
        'is_zombie_prone': False,
        'notes': '',
    },
    'price_behavior': {
        'typical_correction_pct': 0,
        'typical_correction_range': [0, 0],
        'avg_up_move_after_correction_pct': 0,
        'moves_violently_with_volume': False,
        'respects_key_levels': True,
        'gap_behavior': 'fills_most_gaps',
        'ramadan_behavior': '',
        'notes': '',
    },
    'liquidity_and_sector': {
        'liquidity_sensitivity': 'medium',
        'leads_sector': False,
        'follows_sector': True,
        'follows_specific_stock': None,
        'sector_beta_note': '',
        'notes': '',
    },
    'events_behavior': {
        'dividend': {
            'typical_ex_date_drop_pct': 0,
            'drop_range': [0, 0],
            'behavior_before_ex': '',
            'notes': '',
        },
        'rights_issue_history': [],
        'capital_increase_history': [],
        'other_recurring_events': [],
    },
    'danger_flags': [],
    'learned_lessons': [],
    'machine_summary': DEFAULT_MACHINE_SUMMARY.copy(),
}


# ═══════════════════════════════════════════════════════════════════════
# 2. Core Functions
# ═══════════════════════════════════════════════════════════════════════

def _get_notebook_path(symbol: str, market: str = 'EGX') -> Path:
    """جيب مسار ملف النوتبوك."""
    return NOTEBOOKS_DIR / market / f'{symbol.upper()}.json'


def load_stock_notebook(symbol: str, market: str = 'EGX') -> Optional[Dict[str, Any]]:
    """
    تحميل نوتبوك سهم كامل.

    Args:
        symbol: رمز السهم (COMI)
        market: السوق (EGX default)

    Returns:
        dict كامل أو None لو الملف مش موجود
    """
    path = _get_notebook_path(symbol, market)
    if not path.exists():
        return None

    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load notebook {path}: {e}")
        return None


def get_machine_summary(symbol: str, market: str = 'EGX') -> Dict[str, Any]:
    """
    جيب machine_summary فقط (للـ V40.2 integration).

    Returns:
        machine_summary dict، أو DEFAULT_MACHINE_SUMMARY لو الملف مش موجود.
    """
    notebook = load_stock_notebook(symbol, market)
    if not notebook:
        return DEFAULT_MACHINE_SUMMARY.copy()

    summary = notebook.get('machine_summary', {})
    # Merge with defaults (ensure all keys exist)
    result = DEFAULT_MACHINE_SUMMARY.copy()
    result.update(summary)
    return result


def ensure_notebook_exists(symbol: str, market: str = 'EGX',
                             name_ar: str = '') -> Dict[str, Any]:
    """
    تأكد إن النوتبوك موجود — لو مش موجود، أنشئه بالقيم الافتراضية.

    Args:
        symbol: رمز السهم
        market: السوق
        name_ar: الاسم العربي (optional)

    Returns:
        الـ notebook (الموجود أو اللي اتعمل)
    """
    notebook = load_stock_notebook(symbol, market)
    if notebook is not None:
        return notebook

    # Create new notebook with defaults
    path = _get_notebook_path(symbol, market)
    path.parent.mkdir(parents=True, exist_ok=True)

    new_notebook = DEFAULT_NOTEBOOK.copy()
    new_notebook['symbol'] = symbol.upper()
    new_notebook['name_ar'] = name_ar or symbol.upper()
    new_notebook['market'] = market
    new_notebook['last_updated'] = datetime.now().strftime('%Y-%m-%d')

    # Deep copy nested dicts (JSON copy)
    new_notebook = json.loads(json.dumps(new_notebook))

    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(new_notebook, f, ensure_ascii=False, indent=2)
        logger.info(f"Created notebook: {path}")
    except Exception as e:
        logger.error(f"Failed to create notebook {path}: {e}")

    return new_notebook


def update_stock_notebook(symbol: str, updates: Dict[str, Any],
                            market: str = 'EGX') -> bool:
    """
    تحديث جزئي آمن للنوتبوك.

    Args:
        symbol: رمز السهم
        updates: dict بالحقول اللي عاوز تحدّثها
                 (مثلاً: {'machine_summary': {'danger_level': 3}, 'price_behavior': {...}})
        market: السوق

    Returns:
        True لو نجح التحديث
    """
    # Ensure notebook exists
    notebook = ensure_notebook_exists(symbol, market)

    # Apply updates (recursive merge for nested dicts)
    def _deep_merge(target: dict, source: dict):
        for key, value in source.items():
            if key in target and isinstance(target[key], dict) and isinstance(value, dict):
                _deep_merge(target[key], value)
            else:
                target[key] = value

    _deep_merge(notebook, updates)

    # Update last_updated
    notebook['last_updated'] = datetime.now().strftime('%Y-%m-%d')
    notebook['version'] = notebook.get('version', 1) + 1

    # Save
    path = _get_notebook_path(symbol, market)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(notebook, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to update notebook {path}: {e}")
        return False


def add_lesson(symbol: str, lesson: Dict[str, Any],
               market: str = 'EGX', max_lessons: int = 10) -> bool:
    """
    إضافة درس جديد للنوتبوك.

    Args:
        symbol: رمز السهم
        lesson: {date, type (success/failure), summary, lesson}
        market: السوق
        max_lessons: حد أقصى لعدد الدروس (الأحدث أولاً)

    Returns:
        True لو نجح
    """
    notebook = ensure_notebook_exists(symbol, market)

    # Add lesson at the beginning (newest first)
    if 'learned_lessons' not in notebook:
        notebook['learned_lessons'] = []

    # Ensure lesson has required fields
    lesson.setdefault('date', datetime.now().strftime('%Y-%m-%d'))
    lesson.setdefault('type', 'info')
    lesson.setdefault('summary', '')
    lesson.setdefault('lesson', '')

    notebook['learned_lessons'].insert(0, lesson)

    # Trim to max_lessons
    if len(notebook['learned_lessons']) > max_lessons:
        notebook['learned_lessons'] = notebook['learned_lessons'][:max_lessons]

    # Update last_updated
    notebook['last_updated'] = datetime.now().strftime('%Y-%m-%d')
    notebook['version'] = notebook.get('version', 1) + 1

    # Save
    path = _get_notebook_path(symbol, market)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(notebook, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to add lesson to {path}: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════
# 3. V40.2 Integration Helper
# ═══════════════════════════════════════════════════════════════════════

def get_notebook_context_for_v402(symbol: str, market: str = 'EGX') -> Dict[str, Any]:
    """
    جيب سياق النوتبوك للـ V40.2 (قرار + proofs).

    التأثير على القرار:
      - danger_level >= 4 → تقليل الحجم (score -= 5)
      - danger_level >= 5 → رفض (hard reject لو flag مفعّل)
      - avoid_chase=True + السهم في حالة مطاردة → دعم الرفض
      - typical_correction_pct أكبر من مسافة الوقف → تحذير

    Returns:
        {
            'has_notebook': bool,
            'machine_summary': dict,
            'score_adjustment': int (تأثير على V40.2 score),
            'proof_string': str,
            'should_reject': bool (danger_level 5),
            'danger_flags': list,
        }
    """
    summary = get_machine_summary(symbol, market)
    notebook = load_stock_notebook(symbol, market)

    if not notebook:
        return {
            'has_notebook': False,
            'machine_summary': summary,
            'score_adjustment': 0,
            'proof_string': '',
            'should_reject': False,
            'danger_flags': [],
            'typical_correction_pct': 0,
            'avoid_chase': True,
            'distribution_sensitivity': 'medium',
            'stop_adjustment': 0,
        }

    danger_level = summary.get('danger_level', 1)
    danger_flags = notebook.get('danger_flags', [])
    avoid_chase = summary.get('avoid_chase', True)
    typical_correction = summary.get('typical_correction_pct', 0)
    distribution_sensitivity = summary.get('distribution_sensitivity', 'medium')

    # Calculate score adjustment
    score_adjustment = 0
    proofs = []

    if danger_level >= 5:
        proofs.append(f'🚨 danger_level={danger_level} (رفض)')
    elif danger_level >= 4:
        score_adjustment -= 5
        proofs.append(f'⚠️ danger_level={danger_level} (تقليل -5)')

    if danger_flags:
        proofs.append(f'خطر: {", ".join(danger_flags[:3])}')

    if avoid_chase:
        proofs.append('avoid_chase=True')

    if typical_correction > 0:
        proofs.append(f'correction_typical={typical_correction}%')

    proof_string = f'📖 NOTEBOOK: {" | ".join(proofs)}' if proofs else ''

    return {
        'has_notebook': True,
        'machine_summary': summary,
        'score_adjustment': score_adjustment,
        'proof_string': proof_string,
        'should_reject': danger_level >= 5,
        'danger_flags': danger_flags,
        'typical_correction_pct': typical_correction,
        'avoid_chase': avoid_chase,
        'distribution_sensitivity': distribution_sensitivity,
        'stop_adjustment': 0,  # deprecated — use apply_notebook_context instead
    }


# ═══════════════════════════════════════════════════════════════════════
# 3b. apply_notebook_context() — الجسر الموحد بين النوتبوك والقرار
# ═══════════════════════════════════════════════════════════════════════

def apply_notebook_context(
    symbol: str,
    current_score: float,
    stop_distance_pct: float = 0,
    is_chasing: bool = False,
    market: str = 'EGX',
) -> Dict[str, Any]:
    """
    الجسر الوحيد بين النوتبوك ومسار القرار.

    يقرأ النوتبوك ويطبق تأثيرات حقيقية:
      - danger_level 5 → reject
      - danger_level 4 → score -= 5
      - typical_correction > stop_distance → stop_adjustment (توسيع الوقف)
      - avoid_chase + is_chasing → reject
      - distribution_sensitivity=high → distribution_threshold_adjustment

    Args:
        symbol: رمز السهم
        current_score: الـ score الحالي من V40.2 (0-100)
        stop_distance_pct: مسافة الوقف الحالية (%) — مثلاً 5.0 = 5%
        is_chasing: هل السهم في حالة مطاردة (من strict entry)
        market: السوق

    Returns:
        {
            'should_reject': bool,
            'reject_reason': str,
            'new_score': float (بعد التعديل),
            'score_adjustment': int,
            'stop_adjustment_pct': float (توسيع الوقف — مثلاً +2.0 = أوسع بـ 2%),
            'new_stop_distance_pct': float,
            'distribution_threshold_mult': float (1.0=عادي، 0.8=أصعب، 1.2=أسهل),
            'proofs': list of str,
            'has_notebook': bool,
        }
    """
    summary = get_machine_summary(symbol, market)

    if not load_stock_notebook(symbol, market):
        # No notebook → safe defaults, no changes
        return {
            'should_reject': False,
            'reject_reason': '',
            'new_score': current_score,
            'score_adjustment': 0,
            'stop_adjustment_pct': 0,
            'new_stop_distance_pct': stop_distance_pct,
            'distribution_threshold_mult': 1.0,
            'proofs': [],
            'has_notebook': False,
        }

    danger_level = summary.get('danger_level', 1)
    avoid_chase = summary.get('avoid_chase', True)
    typical_correction = summary.get('typical_correction_pct', 0)
    max_correction = summary.get('max_expected_correction_pct', 0)
    distribution_sensitivity = summary.get('distribution_sensitivity', 'medium')

    should_reject = False
    reject_reason = ''
    score_adjustment = 0
    stop_adjustment = 0.0
    distribution_mult = 1.0
    proofs = []

    # 1. danger_level 5 → hard reject
    if danger_level >= 5:
        should_reject = True
        reject_reason = f'danger_level={danger_level} (سهم خطير جداً)'
        proofs.append(f'🚨 NOTEBOOK REJECT: danger_level={danger_level}')

    # 2. danger_level 4 → score -= 5
    elif danger_level >= 4:
        score_adjustment -= 5
        proofs.append(f'⚠️ NOTEBOOK: danger_level={danger_level} → score -5')

    # 3. avoid_chase + is_chasing → reject
    if avoid_chase and is_chasing and not should_reject:
        should_reject = True
        reject_reason = 'avoid_chase=True + السهم في حالة مطاردة'
        proofs.append('🚨 NOTEBOOK REJECT: avoid_chase + chasing')

    # 4. typical_correction > stop_distance → توسيع الوقف
    if typical_correction > 0 and stop_distance_pct > 0:
        if typical_correction > stop_distance_pct * 1.5:
            # الوقف أضيق بكثير من التصحيح المعتاد → وسّعه
            stop_adjustment = typical_correction - stop_distance_pct
            # Cap at max_expected_correction
            if max_correction > 0 and stop_adjustment + stop_distance_pct > max_correction:
                stop_adjustment = max_correction - stop_distance_pct
            proofs.append(f'📖 NOTEBOOK: stop widen +{stop_adjustment:.1f}% (typical_correction={typical_correction}%)')
        elif typical_correction > stop_distance_pct:
            # الوقف أضيق شوية → تحذير بس
            proofs.append(f'📖 NOTEBOOK: stop ضيق قليلاً (typical_correction={typical_correction}% > stop={stop_distance_pct}%)')

    # 5. distribution_sensitivity → adjust distribution threshold
    if distribution_sensitivity == 'high':
        distribution_mult = 0.8  # أصعب — يكتشف التوزيع أبكر
        proofs.append('📖 NOTEBOOK: distribution_sensitivity=high → threshold ×0.8')
    elif distribution_sensitivity == 'low':
        distribution_mult = 1.2  # أسهل — يتسامح أكتر
        proofs.append('📖 NOTEBOOK: distribution_sensitivity=low → threshold ×1.2')

    new_score = max(0, min(100, current_score + score_adjustment))
    new_stop = stop_distance_pct + stop_adjustment

    return {
        'should_reject': should_reject,
        'reject_reason': reject_reason,
        'new_score': new_score,
        'score_adjustment': score_adjustment,
        'stop_adjustment_pct': round(stop_adjustment, 2),
        'new_stop_distance_pct': round(new_stop, 2),
        'distribution_threshold_mult': distribution_mult,
        'proofs': proofs,
        'has_notebook': True,
        'machine_summary': summary,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. Auto-build functions — بناء النوتبوك من البيانات الحقيقية
# ═══════════════════════════════════════════════════════════════════════

import sqlite3 as _sqlite3
import math as _math


def _load_price_history_for_symbol(symbol: str, days: int = 250) -> Dict[str, List[float]]:
    """
    تحميل بيانات أسعار لسهم من price_history.db.

    Returns:
        {dates, opens, highs, lows, closes, volumes} or empty if not found.
    """
    db_path = PROJECT_ROOT / 'db' / 'price_history.db'
    if not db_path.exists():
        db_path = PROJECT_ROOT / 'db' / 'vps_real' / 'price_history.db'

    if not db_path.exists():
        return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

    try:
        conn = _sqlite3.connect(str(db_path), timeout=10.0)
        rows = conn.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
            ORDER BY date ASC
            LIMIT ?
        ''', (symbol.upper(), days)).fetchall()
        conn.close()

        if not rows or len(rows) < 30:
            return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

        return {
            'dates': [r[0] for r in rows],
            'opens': [float(r[1] or 0) for r in rows],
            'highs': [float(r[2] or 0) for r in rows],
            'lows': [float(r[3] or 0) for r in rows],
            'closes': [float(r[4] or 0) for r in rows],
            'volumes': [float(r[5] or 0) for r in rows],
        }
    except Exception:
        return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}


def _get_stock_metadata(symbol: str) -> Dict[str, str]:
    """
    تحميل metadata للسهم (name_ar, sector) من stocks.db.
    """
    db_path = PROJECT_ROOT / 'db' / 'stocks.db'
    if not db_path.exists():
        db_path = PROJECT_ROOT / 'db' / 'vps_real' / 'stocks.db'

    if not db_path.exists():
        return {'name_ar': symbol, 'sector': ''}

    try:
        conn = _sqlite3.connect(str(db_path), timeout=5.0)
        row = conn.execute(
            'SELECT symbol, name_ar FROM egksco_stocks WHERE UPPER(symbol) = ?',
            (symbol.upper(),)
        ).fetchone()
        conn.close()

        if row:
            return {'name_ar': row[1] or symbol, 'sector': ''}
        return {'name_ar': symbol, 'sector': ''}
    except Exception:
        return {'name_ar': symbol, 'sector': ''}


def _calc_typical_correction(closes: List[float], highs: List[float], lows: List[float]) -> Tuple[float, List[float]]:
    """
    حساب متوسط عمق التصحيح من البيانات التاريخية.

    المنطق:
      - نبحث عن الـ swing highs (peaks) في آخر 200 يوم
      - لكل peak، نحسب أقصى نزول بعده قبل ما يرجع يصعد
      - نحسب المتوسط

    Returns:
        (typical_correction_pct, list_of_corrections)
    """
    if len(closes) < 60:
        return 0, []

    corrections = []
    lookback = min(len(closes), 200)
    recent_closes = closes[-lookback:]
    recent_highs = highs[-lookback:]
    recent_lows = lows[-lookback:]

    # Find swing highs (simple: local maxima with window=5)
    window = 5
    for i in range(window, len(recent_highs) - window):
        is_peak = all(recent_highs[i] >= recent_highs[i - j] for j in range(1, window + 1)) and \
                  all(recent_highs[i] >= recent_highs[i + j] for j in range(1, window + 1))
        if is_peak:
            peak_price = recent_highs[i]
            # Find the lowest low after this peak (within next 20 days)
            future_lows = recent_lows[i + 1: i + 21]
            if future_lows:
                min_low = min(future_lows)
                correction_pct = ((peak_price - min_low) / peak_price * 100) if peak_price > 0 else 0
                # Only count meaningful corrections (> 3%)
                if correction_pct >= 3.0:
                    corrections.append(correction_pct)

    if not corrections:
        return 0, []

    typical = sum(corrections) / len(corrections)
    return round(typical, 1), corrections


def _calc_liquidity_profile(volumes: List[float], closes: List[float]) -> str:
    """
    تقدير ملف السيولة من متوسط التداول اليومي.
    """
    if not volumes or not closes:
        return 'medium'

    # Average daily turnover (volume × price)
    recent_volumes = volumes[-30:] if len(volumes) >= 30 else volumes
    recent_closes = closes[-30:] if len(closes) >= 30 else closes

    turnovers = [v * c for v, c in zip(recent_volumes, recent_closes) if v > 0 and c > 0]
    if not turnovers:
        return 'low'

    avg_turnover = sum(turnovers) / len(turnovers)

    # EGX liquidity tiers (approximate)
    if avg_turnover > 50_000_000:  # > 50M EGP/day
        return 'high'
    elif avg_turnover > 10_000_000:  # > 10M EGP/day
        return 'medium'
    elif avg_turnover > 1_000_000:  # > 1M EGP/day
        return 'low'
    else:
        return 'very_low'


def _calc_danger_level(liquidity_profile: str, typical_correction: float,
                         ownership_concentration: str = 'medium') -> int:
    """
    تقدير مستوى الخطر الأولي (1-5).
    """
    level = 1

    # Low liquidity = more dangerous
    if liquidity_profile == 'very_low':
        level += 2
    elif liquidity_profile == 'low':
        level += 1

    # High ownership concentration = more dangerous
    if ownership_concentration == 'very_high':
        level += 2
    elif ownership_concentration == 'high':
        level += 1

    # Very deep corrections = more volatile
    if typical_correction > 20:
        level += 1

    return min(5, max(1, level))


def build_or_refresh_notebook(symbol: str, force: bool = False, market: str = 'EGX') -> Dict[str, Any]:
    """
    بناء أو تحديث نوتبوك سهم من البيانات الحقيقية.

    - ينشئ الملف إن لم يكن موجود
    - أو يحدّث الحقول القابلة للحساب إن وُجد
    - لا يمسح الدروس اليدوية (learned_lessons)
    - لا يمسح danger_flags اليدوية

    Args:
        symbol: رمز السهم
        force: إجبار التحديث حتى لو الملف موجود
        market: السوق

    Returns:
        الـ notebook بعد البناء/التحديث
    """
    existing = load_stock_notebook(symbol, market)

    # Skip if exists and not forced
    if existing and not force:
        return existing

    # Load metadata
    meta = _get_stock_metadata(symbol)

    # Load price history
    prices = _load_price_history_for_symbol(symbol, days=250)

    has_data = len(prices['closes']) >= 60

    # Calculate metrics from real data
    if has_data:
        typical_corr, corrections = _calc_typical_correction(
            prices['closes'], prices['highs'], prices['lows']
        )
        liquidity = _calc_liquidity_profile(prices['volumes'], prices['closes'])
        max_corr = max(corrections) if corrections else 0
        danger = _calc_danger_level(liquidity, typical_corr)
    else:
        typical_corr = 0
        corrections = []
        liquidity = 'medium'
        max_corr = 0
        danger = 1

    # Build/merge notebook
    if existing:
        # Update existing — preserve learned_lessons + danger_flags
        notebook = existing
        learned_lessons = notebook.get('learned_lessons', [])
        danger_flags = notebook.get('danger_flags', [])
    else:
        notebook = json.loads(json.dumps(DEFAULT_NOTEBOOK))
        notebook['symbol'] = symbol.upper()
        notebook['learned_lessons'] = []
        notebook['danger_flags'] = []

    # Update fields
    notebook['name_ar'] = meta['name_ar']
    notebook['sector'] = meta.get('sector', '')
    notebook['last_updated'] = datetime.now().strftime('%Y-%m-%d')
    notebook['version'] = notebook.get('version', 1) + 1

    # Update identity
    notebook['identity']['liquidity_profile'] = liquidity
    notebook['identity']['ownership_concentration'] = 'medium'  # default — needs manual override

    # Update price_behavior
    notebook['price_behavior']['typical_correction_pct'] = typical_corr
    if corrections:
        notebook['price_behavior']['typical_correction_range'] = [
            round(min(corrections), 1),
            round(max(corrections), 1)
        ]
    notebook['price_behavior']['moves_violently_with_volume'] = liquidity in ('low', 'very_low')

    # Update machine_summary
    notebook['machine_summary']['typical_correction_pct'] = typical_corr
    notebook['machine_summary']['max_expected_correction_pct'] = max_corr
    notebook['machine_summary']['liquidity_profile'] = liquidity
    notebook['machine_summary']['danger_level'] = danger
    notebook['machine_summary']['preferred_entry_style'] = 'correction_or_grab'
    notebook['machine_summary']['avoid_chase'] = True
    notebook['machine_summary']['distribution_sensitivity'] = 'medium'

    # Save
    path = _get_notebook_path(symbol, market)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(notebook, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save notebook {path}: {e}")

    return notebook


def build_notebooks_for_universe(symbols: Any = 'active', market: str = 'EGX',
                                   force: bool = False) -> Dict[str, Any]:
    """
    بناء نوتبوك لعدد كبير من الأسهم.

    Args:
        symbols: list of symbols OR 'active' (auto-detect from stocks.db)
        market: السوق
        force: إجبار التحديث

    Returns:
        {built, skipped, errors, total}
    """
    if symbols == 'active':
        # Get all tickers from stocks.db
        db_path = PROJECT_ROOT / 'db' / 'stocks.db'
        if not db_path.exists():
            db_path = PROJECT_ROOT / 'db' / 'vps_real' / 'stocks.db'

        try:
            conn = _sqlite3.connect(str(db_path), timeout=10.0)
            rows = conn.execute('SELECT symbol FROM egksco_stocks').fetchall()
            conn.close()
            symbols = [r[0] for r in rows if r[0] and not r[0].startswith('.')]
        except Exception:
            symbols = []
    elif isinstance(symbols, str):
        symbols = [symbols]

    built = 0
    skipped = 0
    errors = 0
    error_list = []

    for sym in symbols:
        try:
            nb = build_or_refresh_notebook(sym, force=force, market=market)
            if nb:
                built += 1
            else:
                skipped += 1
        except Exception as e:
            errors += 1
            error_list.append(f'{sym}: {str(e)[:50]}')

    return {
        'built': built,
        'skipped': skipped,
        'errors': errors,
        'total': len(symbols),
        'error_details': error_list[:10],
    }


def list_all_notebooks(market: str = 'EGX') -> List[Dict[str, Any]]:
    """
    قائمة كل النوتبوكس المتاحة + ملخص سريع لكل واحد.

    Returns:
        list of {symbol, last_updated, danger_level, liquidity_profile, has_lessons, complete}
    """
    market_dir = NOTEBOOKS_DIR / market
    if not market_dir.exists():
        return []

    result = []
    for path in sorted(market_dir.glob('*.json')):
        symbol = path.stem
        try:
            with open(path, 'r', encoding='utf-8') as f:
                nb = json.load(f)
            summary = nb.get('machine_summary', {})
            result.append({
                'symbol': symbol,
                'name_ar': nb.get('name_ar', symbol),
                'last_updated': nb.get('last_updated', ''),
                'danger_level': summary.get('danger_level', 1),
                'liquidity_profile': summary.get('liquidity_profile', 'medium'),
                'typical_correction_pct': summary.get('typical_correction_pct', 0),
                'has_lessons': len(nb.get('learned_lessons', [])) > 0,
                'lesson_count': len(nb.get('learned_lessons', [])),
                'version': nb.get('version', 1),
                'complete': summary.get('typical_correction_pct', 0) > 0,
            })
        except Exception:
            continue

    return result


def get_notebook_stats(market: str = 'EGX') -> Dict[str, Any]:
    """
    إحصائية سريعة عن كل النوتبوكس.
    """
    notebooks = list_all_notebooks(market)

    total = len(notebooks)
    high_danger = sum(1 for n in notebooks if n['danger_level'] >= 4)
    complete = sum(1 for n in notebooks if n['complete'])
    with_lessons = sum(1 for n in notebooks if n['has_lessons'])
    by_liquidity = {}
    for n in notebooks:
        lp = n['liquidity_profile']
        by_liquidity[lp] = by_liquidity.get(lp, 0) + 1

    return {
        'total': total,
        'complete': complete,
        'incomplete': total - complete,
        'high_danger': high_danger,
        'with_lessons': with_lessons,
        'by_liquidity': by_liquidity,
        'recently_updated': [n for n in notebooks if n['last_updated']][:5],
    }


# ═══════════════════════════════════════════════════════════════════════
# 6. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Stock Notebook System — Self Test")
    print("=" * 70)
    print(f"Notebooks dir: {NOTEBOOKS_DIR}")
    print()

    # Test 1: Load non-existent notebook → None
    print("=== Test 1: تحميل سهم مش موجود → None ===")
    r = load_stock_notebook('NONEXISTENT')
    print(f"  Result: {r}")
    assert r is None
    print("  ✅ PASS")

    # Test 2: get_machine_summary for non-existent → defaults
    print("\n=== Test 2: get_machine_summary لسهم مش موجود → defaults ===")
    r = get_machine_summary('NONEXISTENT')
    print(f"  danger_level: {r['danger_level']}")
    print(f"  avoid_chase: {r['avoid_chase']}")
    assert r['danger_level'] == 1
    assert r['avoid_chase'] == True
    print("  ✅ PASS (قيم آمنة)")

    # Test 3: ensure_notebook_exists → create new
    print("\n=== Test 3: ensure_notebook_exists → إنشاء جديد ===")
    nb = ensure_notebook_exists('TESTCO', name_ar='شركة تجريبية')
    print(f"  symbol: {nb['symbol']}")
    print(f"  name_ar: {nb['name_ar']}")
    print(f"  danger_level: {nb['machine_summary']['danger_level']}")
    assert nb['symbol'] == 'TESTCO'
    assert nb['name_ar'] == 'شركة تجريبية'
    print("  ✅ PASS")

    # Test 4: Update partial
    print("\n=== Test 4: تحديث جزئي ===")
    success = update_stock_notebook('TESTCO', {
        'machine_summary': {'danger_level': 3, 'typical_correction_pct': 14},
        'price_behavior': {'typical_correction_pct': 14},
    })
    print(f"  success: {success}")
    nb = load_stock_notebook('TESTCO')
    print(f"  danger_level: {nb['machine_summary']['danger_level']}")
    print(f"  typical_correction: {nb['machine_summary']['typical_correction_pct']}%")
    print(f"  price_behavior.correction: {nb['price_behavior']['typical_correction_pct']}%")
    assert nb['machine_summary']['danger_level'] == 3
    assert nb['machine_summary']['typical_correction_pct'] == 14
    print("  ✅ PASS")

    # Test 5: Add lesson
    print("\n=== Test 5: إضافة درس ===")
    success = add_lesson('TESTCO', {
        'date': '2026-04-12',
        'type': 'success',
        'summary': 'دخل بعد تصحيح 13%، طلع 19%',
        'lesson': 'يحترم التصحيح في نطاق 12-15%',
    })
    print(f"  success: {success}")
    nb = load_stock_notebook('TESTCO')
    print(f"  lessons count: {len(nb['learned_lessons'])}")
    print(f"  first lesson: {nb['learned_lessons'][0]['summary']}")
    assert len(nb['learned_lessons']) == 1
    assert nb['learned_lessons'][0]['type'] == 'success'
    print("  ✅ PASS")

    # Test 6: get_notebook_context_for_v402
    print("\n=== Test 6: get_notebook_context_for_v402 ===")
    ctx = get_notebook_context_for_v402('TESTCO')
    print(f"  has_notebook: {ctx['has_notebook']}")
    print(f"  score_adjustment: {ctx['score_adjustment']}")
    print(f"  should_reject: {ctx['should_reject']}")
    print(f"  proof: {ctx['proof_string']}")
    assert ctx['has_notebook']
    assert ctx['score_adjustment'] == 0  # danger_level=3 (not >= 4)
    assert not ctx['should_reject']
    print("  ✅ PASS")

    # Test 7: danger_level 4 → score -5
    print("\n=== Test 7: danger_level 4 → تقليل -5 ===")
    update_stock_notebook('TESTCO', {'machine_summary': {'danger_level': 4}})
    ctx = get_notebook_context_for_v402('TESTCO')
    print(f"  score_adjustment: {ctx['score_adjustment']}")
    print(f"  proof: {ctx['proof_string']}")
    assert ctx['score_adjustment'] == -5
    print("  ✅ PASS")

    # Test 8: danger_level 5 → reject
    print("\n=== Test 8: danger_level 5 → رفض ===")
    update_stock_notebook('TESTCO', {'machine_summary': {'danger_level': 5}})
    ctx = get_notebook_context_for_v402('TESTCO')
    print(f"  should_reject: {ctx['should_reject']}")
    print(f"  proof: {ctx['proof_string']}")
    assert ctx['should_reject']
    print("  ✅ PASS")

    # Cleanup test file
    test_path = _get_notebook_path('TESTCO')
    if test_path.exists():
        test_path.unlink()
        print("\n  (cleaned up TESTCO notebook)")

    # ── Tests for apply_notebook_context (المحور أ — التعميق) ──
    print("\n━━━ apply_notebook_context (تعميق النوتبوك) ━━━")

    # Test 9: No notebook → safe defaults
    print("\n=== Test 9: سهم بدون نوتبوك → safe defaults ===")
    r = apply_notebook_context('NOSUCHCO', current_score=70, stop_distance_pct=5.0)
    print(f"  should_reject: {r['should_reject']} | new_score: {r['new_score']} | stop_adj: {r['stop_adjustment_pct']}")
    assert not r['should_reject'] and r['new_score'] == 70
    print("  ✅ PASS")

    # Test 10: danger_level 5 → reject
    print("\n=== Test 10: danger_level 5 → رفض ===")
    ensure_notebook_exists('TESTNB2')
    update_stock_notebook('TESTNB2', {'machine_summary': {'danger_level': 5}})
    r = apply_notebook_context('TESTNB2', current_score=80, stop_distance_pct=5.0)
    print(f"  should_reject: {r['should_reject']} | reason: {r['reject_reason']}")
    assert r['should_reject']
    print("  ✅ PASS")

    # Test 11: danger_level 4 → score -5
    print("\n=== Test 11: danger_level 4 → score -5 ===")
    update_stock_notebook('TESTNB2', {'machine_summary': {'danger_level': 4}})
    r = apply_notebook_context('TESTNB2', current_score=80, stop_distance_pct=5.0)
    print(f"  new_score: {r['new_score']} (was 80) | adjustment: {r['score_adjustment']}")
    assert r['new_score'] == 75 and r['score_adjustment'] == -5
    print("  ✅ PASS")

    # Test 12: typical_correction > stop → widen stop
    print("\n=== Test 12: typical_correction=12% > stop=5% → widen stop ===")
    update_stock_notebook('TESTNB2', {
        'machine_summary': {'danger_level': 1, 'typical_correction_pct': 12, 'max_expected_correction_pct': 18}
    })
    r = apply_notebook_context('TESTNB2', current_score=70, stop_distance_pct=5.0)
    print(f"  stop_adjustment: +{r['stop_adjustment_pct']}% | new_stop: {r['new_stop_distance_pct']}%")
    print(f"  proofs: {r['proofs']}")
    assert r['stop_adjustment_pct'] > 0
    print("  ✅ PASS (وقف اتوسع)")

    # Test 13: avoid_chase + is_chasing → reject
    print("\n=== Test 13: avoid_chase + is_chasing → رفض ===")
    update_stock_notebook('TESTNB2', {
        'machine_summary': {'danger_level': 1, 'avoid_chase': True, 'typical_correction_pct': 0}
    })
    r = apply_notebook_context('TESTNB2', current_score=70, stop_distance_pct=5.0, is_chasing=True)
    print(f"  should_reject: {r['should_reject']} | reason: {r['reject_reason']}")
    assert r['should_reject']
    print("  ✅ PASS")

    # Test 14: distribution_sensitivity=high → mult 0.8
    print("\n=== Test 14: distribution_sensitivity=high → threshold ×0.8 ===")
    update_stock_notebook('TESTNB2', {
        'machine_summary': {'danger_level': 1, 'distribution_sensitivity': 'high', 'typical_correction_pct': 0}
    })
    r = apply_notebook_context('TESTNB2', current_score=70, stop_distance_pct=5.0)
    print(f"  distribution_mult: {r['distribution_threshold_mult']}")
    assert r['distribution_threshold_mult'] == 0.8
    print("  ✅ PASS")

    # Cleanup
    test_path = _get_notebook_path('TESTNB2')
    if test_path.exists():
        test_path.unlink()

    print("\n" + "=" * 70)
    print("✅ Stock Notebook System ready (14/14 tests pass)")
    print(f"\nIntegration in V40.2: reads notebook before analysis")
    print(f"  danger_level 4 → score -= 5")
    print(f"  danger_level 5 → reject")
    print(f"  avoid_chase + is_chasing → reject")
    print(f"  typical_correction > stop → widen stop")
    print(f"  distribution_sensitivity → threshold mult")
    print(f"  avoid_chase=True → supports reject")
