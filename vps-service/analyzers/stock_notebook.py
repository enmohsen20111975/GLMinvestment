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
        }

    danger_level = summary.get('danger_level', 1)
    danger_flags = notebook.get('danger_flags', [])
    avoid_chase = summary.get('avoid_chase', True)
    typical_correction = summary.get('typical_correction_pct', 0)

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
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. Self-test
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

    print("\n" + "=" * 70)
    print("✅ Stock Notebook System ready (8/8 tests pass)")
    print(f"\nIntegration in V40.2: reads notebook before analysis")
    print(f"  danger_level 4 → score -= 5")
    print(f"  danger_level 5 → reject")
    print(f"  avoid_chase=True → supports reject")
