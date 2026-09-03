"""
egx_gate.py — EGX-Canonical-Only Gate (الحل الجذري لمشكلة الخلط بين الأسواق)
=================================================================================
EGX-MARKET-ISOLATION (2026-08-30): فلتر صارم يمنع أي سهم من غير EGX من الدخول
للنظام. كمان بـ يـ normalize الـ tickers الملوّثة (أسماء شركات / ISIN codes)
لـ tickers نظيفة موجودة في TradingView.

المشكلة اللي بـ يحلها:
  - stocks.db فيها 4 أسواق (EGX 452 + TADAWUL 390 + KSE 138 + QSE 67).
  - data_engine.db.egksco_price_history فيها 1047 ticker (359 EGX + 688 non-EGX).
  - tickers EGX ملوّثة: أسماء شركات كاملة (زي "ACAPA Capital HoldingD")
    + ISIN codes مدمجة (زي "EGS30AJ1C016-EGP").
  - النتيجة: 65% من التوقعات المولّدة ممكن تكون لأسهم غير مصرية + tickers غلط.

الحل:
  - is_valid_egx_ticker(ticker) → bool: يتحقق إن الـ ticker (بعد normalize) موجود
    في EGX_CANONICAL_TV (278 سهم مرجعيين من TradingView) أو EGX_ISIN_NAMES (11 ISIN).
  - filter_egx_tickers(tickers) → list: بيرجّع بس الـ tickers المصرية الصحيحة.
  - get_egx_canonical_ticker(ticker) → dict: بيرجّع {ticker, name_ar, sector, is_isin}
    أو None لو مش EGX.

الاستخدام:
  from utils.egx_gate import is_valid_egx_ticker, filter_egx_tickers, get_egx_canonical_ticker

  # في v40_2_daily_generator.py::get_tickers()
  tickers = filter_egx_tickers(raw_tickers)

  # في MaestroOrchestrator.analyze()
  if not is_valid_egx_ticker(ticker):
      return None  # skip non-EGX

مبادئ:
- Rule 4 (لا ملفات جديدة): ده module مساعد مش نظام جديد — بـ يدعم الموجود.
- Rule 17 (relative paths): كل المسارات نسبية.
- Rule 20 (Python = brain): كل logic هنا.
- Rule 27 (no fake data): مفيش hardcoded tickers — كلها من EGX_CANONICAL_TV.
"""
from __future__ import annotations
from typing import Dict, Any, Optional, List, Set
import re

# استيراد الـ canonical list من المصدر الموحّد
try:
    from data.egx_stocks_complete import (
        EGX_CANONICAL_TV,
        EGX_ISIN_NAMES,
        normalize_symbol,
    )
    _CANONICAL_AVAILABLE = True
except Exception:
    _CANONICAL_AVAILABLE = False
    EGX_CANONICAL_TV = {}
    EGX_ISIN_NAMES = {}


# ─── Pre-computed sets for O(1) lookup ──────────────────────────────────────
_CANONICAL_TICKERS: Set[str] = set(EGX_CANONICAL_TV.keys()) if _CANONICAL_AVAILABLE else set()
_CANONICAL_ISINS: Set[str] = set(EGX_ISIN_NAMES.keys()) if _CANONICAL_AVAILABLE else set()

# Pattern for clean EGX tickers: 2-6 uppercase English letters (no digits, no spaces)
# Examples: COMI, SWDY, HRHO, ETEL, ACFR, ACAP
_EGX_TICKER_PATTERN = re.compile(r'^[A-Z]{2,6}$')


def is_valid_egx_ticker(ticker: str) -> bool:
    """تحقق صارم: هل الـ ticker مصري صحيح موجود في TradingView؟

    المنطق:
    1. لو الـ ticker موجود مباشرة في EGX_CANONICAL_TV أو EGX_ISIN_NAMES → True.
    2. لو لا، جرّب normalize_symbol واتحقق إن الـ ticker الناتج موجود في EGX_CANONICAL_TV.
    3. لو أي خطوة فشلت → False (السهم مش مصري أو ticker ملوّث لا يمكن تطبيعه).

    Args:
        ticker: الـ ticker الخام (ممكن يكون ملوّث: اسم شركة / ISIN / suffix).

    Returns:
        True لو الـ ticker مصري صحيح موجود في TradingView.
    """
    if not ticker or not isinstance(ticker, str):
        return False

    t = ticker.strip().upper()
    if not t:
        return False

    # 1) Direct match في الـ canonical sets
    if t in _CANONICAL_TICKERS or t in _CANONICAL_ISINS:
        return True

    # 2) Normalize واتحقق
    if not _CANONICAL_AVAILABLE:
        return False

    try:
        result = normalize_symbol(ticker)
        norm_ticker = (result.get('ticker') or '').strip().upper()
        if norm_ticker and (norm_ticker in _CANONICAL_TICKERS or norm_ticker in _CANONICAL_ISINS):
            return True
    except Exception:
        pass

    return False


def get_egx_canonical_ticker(ticker: str) -> Optional[Dict[str, Any]]:
    """رجّع الـ ticker النظيف + معلوماته لو مصري، None لو مش مصري.

    Returns:
        {
            'ticker': str (نظيف، زي 'COMI'),
            'name_ar': str (الاسم العربي),
            'sector': str (القطاع),
            'is_isin': bool (هل كان ISIN code),
            'original': str (الـ ticker الخام),
        }
        أو None لو الـ ticker مش مصري صحيح.
    """
    if not ticker or not isinstance(ticker, str):
        return None

    t = ticker.strip().upper()
    if not t:
        return None

    # 1) Direct match
    if t in _CANONICAL_TICKERS:
        name_ar, sector = EGX_CANONICAL_TV[t]
        return {
            'ticker': t,
            'name_ar': name_ar,
            'sector': sector,
            'is_isin': False,
            'original': ticker,
        }

    if t in _CANONICAL_ISINS:
        name_ar, sector = EGX_ISIN_NAMES[t]
        return {
            'ticker': t,
            'name_ar': name_ar,
            'sector': sector,
            'is_isin': True,
            'original': ticker,
        }

    # 2) Normalize
    if not _CANONICAL_AVAILABLE:
        return None

    try:
        result = normalize_symbol(ticker)
        norm_ticker = (result.get('ticker') or '').strip().upper()
        if norm_ticker and norm_ticker in _CANONICAL_TICKERS:
            name_ar, sector = EGX_CANONICAL_TV[norm_ticker]
            return {
                'ticker': norm_ticker,
                'name_ar': result.get('name_ar') or name_ar,
                'sector': result.get('sector') or sector,
                'is_isin': False,
                'original': ticker,
            }
        if norm_ticker and norm_ticker in _CANONICAL_ISINS:
            name_ar, sector = EGX_ISIN_NAMES[norm_ticker]
            return {
                'ticker': norm_ticker,
                'name_ar': result.get('name_ar') or name_ar,
                'sector': result.get('sector') or sector,
                'is_isin': True,
                'original': ticker,
            }
    except Exception:
        pass

    return None


def filter_egx_tickers(tickers: List[str]) -> List[str]:
    """فلتر قائمة tickers وارجع بس المصرية الصحيحة.

    Args:
        tickers: قائمة tickers خام (ممكن فيها non-EGX + ملوّثة).

    Returns:
        قائمة tickers نظيفة مصرية (بعد normalize).
    """
    if not tickers:
        return []

    seen: Set[str] = set()
    result: List[str] = []
    rejected = 0

    for t in tickers:
        canonical = get_egx_canonical_ticker(t)
        if canonical is None:
            rejected += 1
            continue
        norm = canonical['ticker']
        if norm not in seen:
            seen.add(norm)
            result.append(norm)

    return result


def filter_egx_tickers_detailed(tickers: List[str]) -> Dict[str, Any]:
    """فلتر قائمة tickers وارجع تقرير مفصّل.

    Returns:
        {
            'accepted': List[str],         # tickers مصرية مقبولة (نظيفة)
            'rejected': List[Tuple[str, str]],  # (ticker, reason) للـ rejected
            'stats': {
                'total_input': int,
                'accepted_count': int,
                'rejected_count': int,
                'duplicates_removed': int,
            }
        }
    """
    if not tickers:
        return {
            'accepted': [],
            'rejected': [],
            'stats': {'total_input': 0, 'accepted_count': 0, 'rejected_count': 0, 'duplicates_removed': 0},
        }

    seen: Set[str] = set()
    accepted: List[str] = []
    rejected: List[tuple] = []
    duplicates = 0

    for t in tickers:
        if not t or not isinstance(t, str):
            rejected.append((str(t), 'empty_or_invalid'))
            continue

        canonical = get_egx_canonical_ticker(t)
        if canonical is None:
            rejected.append((t, 'not_egx_or_unnormalizable'))
            continue

        norm = canonical['ticker']
        if norm in seen:
            duplicates += 1
            continue

        seen.add(norm)
        accepted.append(norm)

    return {
        'accepted': accepted,
        'rejected': rejected,
        'stats': {
            'total_input': len(tickers),
            'accepted_count': len(accepted),
            'rejected_count': len(rejected),
            'duplicates_removed': duplicates,
        },
    }


# ─── Convenience: canonical ticker set for fast membership tests ─────────────
def get_egx_canonical_set() -> Set[str]:
    """ارجع set بكل الـ tickers المصرية الصحيحة (للـ fast lookup)."""
    return _CANONICAL_TICKERS | _CANONICAL_ISINS


def get_egx_canonical_count() -> int:
    """عدد الـ tickers المصرية الصحيحة المتاحة."""
    return len(_CANONICAL_TICKERS) + len(_CANONICAL_ISINS)
