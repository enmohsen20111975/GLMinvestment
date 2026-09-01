#!/usr/bin/env python3
"""
Stock Notebook — دفتر ملاحظات المحلل
=====================================
الذاكرة الدائمة للنظام. بدل ما نحسب كل حاجة من جديد كل مرة، النوتبوك بـ يـ accumulate
ملاحظات الأسهم + القطاعات + الدروس المستفادة.

المفهوم (زي ورقة المحلل):
  - اكتب ملاحظة مرة واحدة (مش كل مرة)
  - لو مهمة → احتفظ بيها
  - لو خدشcratch → امسحها
  - كل فترة نظّف القديم
  - لما تحتاج معلومة → اقفلها من النوتبوك بدل ما تحسبها تاني

الاستخدام:
  from analyzers.stock_notebook import add_observation, get_stock_notes, add_sector_note
  
  add_observation('COMI', 'generated BUY signal entry=18.5 target=20 stop=17.5',
                  source='v40_2', signal='BUY')
  notes = get_stock_notes('COMI')  # كل ملاحظات COMI
  add_sector_note('Finance', 'القطاع صاعد', avg_change='+1.5%')

الـ notebook بـ يتكتب من:
  1. V40.2 daily_generator: عند توليد توقع
  2. daily_closer: عند إغلاق صفقة
  3. V68/V72/V73 filters: عند رفض/accept
  4. daily_gainer_scan: عند اكتشاف صاعد
  5. hot_candidate_detector: عند اكتشاف سهم ساخن

Author: Z.ai Code
Date: 2026-09-01
"""

import json
import os
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import threading

PROJECT_ROOT = Path(__file__).resolve().parents[2]
NOTEBOOK_PATH = PROJECT_ROOT / 'data' / 'stock_notebook.json'

# Thread lock for concurrent writes (daily_closer + V40.2 might run together)
_lock = threading.Lock()

MAX_OBSERVATIONS_PER_STOCK = 50  # نظّف بعد 50 ملاحظة (احتفظ بآخر 50)


def _load_notebook() -> Dict[str, Any]:
    """حمّل النوتبوك (لو مش موجود → أنشئ فارغ)."""
    if not NOTEBOOK_PATH.exists():
        return _empty_notebook()
    try:
        with open(NOTEBOOK_PATH, 'r', encoding='utf-8') as f:
            nb = json.load(f)
        # Validate structure
        if 'stocks' not in nb:
            nb['stocks'] = {}
        if 'sector_notes' not in nb:
            nb['sector_notes'] = {}
        if 'lessons_learned' not in nb:
            nb['lessons_learned'] = []
        if '_meta' not in nb:
            nb['_meta'] = _empty_notebook()['_meta']
        return nb
    except Exception:
        return _empty_notebook()


def _empty_notebook() -> Dict[str, Any]:
    """نوتبوك فارغ بالهيكل الصحيح."""
    return {
        '_meta': {
            'description': 'دفتر ملاحظات الأسهم — ذاكرة دائمة للمحللين',
            'version': '2.0',
            'last_updated': datetime.now().strftime('%Y-%m-%d'),
            'rules': [
                'الملف ده ثابت — بيتعدّل عليه مش بيتمسح',
                'كل سهم له entry خاص بكل الملاحظات التراكمية',
                'التحديث بيتم من V40.2 + daily_closer + الأدمن',
                'كل ملاحظة عليها تاريخ + مصدر (v40_2/closer/v68/v72/v73/analyst)',
                'نظّف القديم كل فترة (احتفظ بآخر 50 ملاحظة لكل سهم)',
            ],
        },
        'stocks': {},
        'sector_notes': {},
        'lessons_learned': [],
    }


def _save_notebook(nb: Dict[str, Any]) -> None:
    """احفظ النوتبوك (atomic write)."""
    nb['_meta']['last_updated'] = datetime.now().strftime('%Y-%m-%d')
    # Atomic write: write to temp then rename
    tmp_path = str(NOTEBOOK_PATH) + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(nb, f, indent=2, ensure_ascii=False)
    os.rename(tmp_path, NOTEBOOK_PATH)


def _ensure_stock_entry(nb: Dict, ticker: str, name: str = '',
                        sector: str = '') -> Dict:
    """تأكد إن السهم له entry في النوتبوك."""
    if ticker not in nb['stocks']:
        nb['stocks'][ticker] = {
            'name': name,
            'sector': sector,
            'observations': [],
            'status': '',
            'trend': '',
            'maker_activity': '',
            'sector_heat': sector,
            'last_entry_price': 0,
            'last_target': 0,
            'last_result': '',
        }
    if name and not nb['stocks'][ticker].get('name'):
        nb['stocks'][ticker]['name'] = name
    if sector and not nb['stocks'][ticker].get('sector'):
        nb['stocks'][ticker]['sector'] = sector
    return nb['stocks'][ticker]


def add_observation(
    ticker: str,
    note: str,
    source: str = 'system',
    signal: str = '',
    confidence: int = 0,
    name: str = '',
    sector: str = '',
    extra: Optional[Dict] = None
) -> bool:
    """
    أضف ملاحظة لسهم في النوتبوك.

    Args:
        ticker: رمز السهم (مثلاً COMI)
        note: نص الملاحظة
        source: مصدر الملاحظة (v40_2/closer/v68/v72/v73/analyst/gainer_scan)
        signal: الإشارة (BUY/SELL/REJECT/CLOSED/HIT_TARGET/STOPPED)
        confidence: مستوى الثقة (0-100)
        name: اسم الشركة (اختياري)
        sector: القطاع (اختياري)
        extra: بيانات إضافية (dict)

    Returns:
        True لو اتسجلت، False لو فشل
    """
    with _lock:
        try:
            nb = _load_notebook()
            stock = _ensure_stock_entry(nb, ticker, name, sector)

            obs = {
                'date': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'source': source,
                'note': note,
                'signal': signal,
                'confidence': confidence,
            }
            if extra:
                obs['extra'] = extra

            stock['observations'].append(obs)

            # نظّف: احتفظ بآخر MAX_OBSERVATIONS_PER_STOCK ملاحظة
            if len(stock['observations']) > MAX_OBSERVATIONS_PER_STOCK:
                stock['observations'] = stock['observations'][-MAX_OBSERVATIONS_PER_STOCK:]

            # حدّث الحالة لو فيه signal
            if signal == 'BUY' or signal == 'STRONG_BUY':
                stock['status'] = 'في توقع نشط'
            elif signal == 'CLOSED':
                stock['status'] = 'مقفل'
            elif signal == 'HIT_TARGET':
                stock['status'] = 'حقق الهدف'
                stock['last_result'] = 'فوز'
            elif signal == 'STOPPED':
                stock['status'] = 'ضرب الوقف'
                stock['last_result'] = 'خسارة'
            elif signal == 'REJECT':
                pass  # ملاحظة رفض بس بدون تغيير الحالة

            _save_notebook(nb)
            return True
        except Exception as e:
            print(f"[NOTEBOOK] خطأ في add_observation: {e}", flush=True)
            return False


def add_prediction_observation(
    ticker: str, signal: str, entry: float, target: float,
    stop: float, score: float, evidence: int, r_multiple: float,
    target_2: float = 0, source: str = 'v40_2', sector: str = '',
    filters_triggered: Optional[List[str]] = None
) -> bool:
    """
    اكتب ملاحظة توقع كامل (من V40.2).
    ده shortcut عشان كل توقع يتسجل بشكل موحد.
    """
    note = (f"توقع {signal}: entry={entry:.2f} target={target:.2f} "
            f"stop={stop:.2f} score={score:.0f} evidence={evidence}/6 R={r_multiple:.2f}")
    if target_2 > 0:
        note += f" target_2={target_2:.2f}"
    if filters_triggered:
        note += f" | filters: {', '.join(filters_triggered)}"

    return add_observation(
        ticker=ticker,
        note=note,
        source=source,
        signal=signal,
        confidence=int(score),
        sector=sector,
        extra={
            'entry_price': entry,
            'target_price': target,
            'stop_loss': stop,
            'r_multiple': r_multiple,
            'evidence_count': evidence,
            'filters': filters_triggered or [],
        }
    )


def add_exit_observation(
    ticker: str, exit_type: str, entry_price: float, exit_price: float,
    return_pct: float, holding_days: int, exit_reason: str = '',
    source: str = 'daily_closer'
) -> bool:
    """
    اكتب ملاحظة إغلاق صفقة (من daily_closer).
    """
    is_win = return_pct > 0
    signal = 'HIT_TARGET' if 'target' in exit_type.lower() else (
        'STOPPED' if 'stop' in exit_type.lower() else 'CLOSED'
    )

    note = (f"إغلاق {exit_type}: entry={entry_price:.2f} exit={exit_price:.2f} "
            f"return={return_pct:+.1f}% days={holding_days}")
    if exit_reason:
        note += f" | {exit_reason}"

    # حدّث last_entry_price و last_target
    with _lock:
        try:
            nb = _load_notebook()
            if ticker in nb['stocks']:
                nb['stocks'][ticker]['last_entry_price'] = entry_price
                nb['stocks'][ticker]['last_result'] = 'فوز' if is_win else 'خسارة'
            _save_notebook(nb)
        except Exception:
            pass

    return add_observation(
        ticker=ticker,
        note=note,
        source=source,
        signal=signal,
        confidence=100 if is_win else 0,
        extra={
            'exit_price': exit_price,
            'return_pct': return_pct,
            'holding_days': holding_days,
            'is_win': is_win,
            'exit_reason': exit_reason,
        }
    )


def add_filter_rejection(
    ticker: str, filter_name: str, reason: str, source: str = 'v68',
    sector: str = ''
) -> bool:
    """
    اكتب ملاحظة رفض فلتر (V68 dirty_dist / V72 hidden_dist / V73 desert / etc).
    """
    note = f"رفض {filter_name}: {reason}"
    return add_observation(
        ticker=ticker,
        note=note,
        source=source,
        signal='REJECT',
        confidence=0,
        sector=sector,
        extra={'filter': filter_name, 'reason': reason}
    )


def add_sector_note(
    sector: str, status: str, avg_change: str, notes: str,
    source: str = 'system'
) -> bool:
    """
    أضف/حدّث ملاحظة قطاع.
    """
    with _lock:
        try:
            nb = _load_notebook()
            nb['sector_notes'][sector] = {
                'status': status,
                'avg_change': avg_change,
                'notes': notes,
                'last_updated': datetime.now().strftime('%Y-%m-%d'),
                'source': source,
            }
            _save_notebook(nb)
            return True
        except Exception as e:
            print(f"[NOTEBOOK] خطأ في add_sector_note: {e}", flush=True)
            return False


def add_lesson(
    lesson: str, impact: str = 'medium', action: str = '',
    ticker: str = '', source: str = 'system'
) -> bool:
    """
    أضف درس مستفاد.
    """
    with _lock:
        try:
            nb = _load_notebook()
            nb['lessons_learned'].append({
                'date': datetime.now().strftime('%Y-%m-%d'),
                'ticker': ticker,
                'lesson': lesson,
                'impact': impact,
                'action': action,
                'source': source,
            })
            # نظّف: احتفظ بآخر 100 درس
            if len(nb['lessons_learned']) > 100:
                nb['lessons_learned'] = nb['lessons_learned'][-100:]
            _save_notebook(nb)
            return True
        except Exception as e:
            print(f"[NOTEBOOK] خطأ في add_lesson: {e}", flush=True)
            return False


def get_stock_notes(ticker: str) -> Optional[Dict]:
    """جيب كل ملاحظات سهم."""
    nb = _load_notebook()
    return nb['stocks'].get(ticker)


def get_sector_notes(sector: str) -> Optional[Dict]:
    """جيب ملاحظات قطاع."""
    nb = _load_notebook()
    return nb['sector_notes'].get(sector)


def get_all_stocks() -> Dict:
    """جيب كل الأسهم في النوتبوك."""
    nb = _load_notebook()
    return nb['stocks']


def get_lessons(limit: int = 20) -> List[Dict]:
    """جيب آخر N درس."""
    nb = _load_notebook()
    return nb['lessons_learned'][-limit:]


def cleanup_old_observations(days_to_keep: int = 90) -> int:
    """
    نظّف الملاحظات القديمة (أقدم من days_to_keep يوم).
    Returns: عدد الملاحظات اللي اتمسحت.
    """
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days_to_keep)).strftime('%Y-%m-%d')
    removed = 0
    with _lock:
        try:
            nb = _load_notebook()
            for ticker, stock in nb['stocks'].items():
                original = len(stock.get('observations', []))
                stock['observations'] = [
                    o for o in stock.get('observations', [])
                    if o.get('date', '')[:10] >= cutoff
                ]
                removed += original - len(stock['observations'])
            _save_notebook(nb)
            return removed
        except Exception as e:
            print(f"[NOTEBOOK] خطأ في cleanup: {e}", flush=True)
            return 0


def get_notebook_stats() -> Dict:
    """إحصائيات النوتبوك."""
    nb = _load_notebook()
    total_obs = sum(len(s.get('observations', [])) for s in nb['stocks'].values())
    return {
        'total_stocks': len(nb['stocks']),
        'total_observations': total_obs,
        'total_sectors': len(nb['sector_notes']),
        'total_lessons': len(nb['lessons_learned']),
        'last_updated': nb['_meta'].get('last_updated', '?'),
        'notebook_path': str(NOTEBOOK_PATH),
    }


if __name__ == '__main__':
    print("🧪 Stock Notebook — Self Test")
    print("=" * 50)
    print(f"Notebook path: {NOTEBOOK_PATH}")
    print(f"Stats: {get_notebook_stats()}")
    print()
    # Test add observation
    ok = add_observation('TEST', 'ملاحظة تجريبية للنوتبوك', source='self_test', signal='BUY')
    print(f"Add observation: {ok}")
    notes = get_stock_notes('TEST')
    if notes:
        print(f"TEST stock observations: {len(notes['observations'])}")
        print(f"Last: {notes['observations'][-1]['note']}")
    # Cleanup test
    removed = cleanup_old_observations(days_to_keep=0)
    print(f"Cleanup (0 days): removed {removed} old observations")
    print()
    print("✅ Stock Notebook ready for V40.2 + daily_closer integration")
