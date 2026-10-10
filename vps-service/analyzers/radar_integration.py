#!/usr/bin/env python3
"""
radar_integration.py — جسر ربط رادار السيولة + Exit Radar بالـ DailyPredictor
=====================================================================
INTEGRATION-FIX (2026-10-01): كان فيه قطيعة بين رادار السيولة و Exit Radar
وبين محرك التوقعات DailyPredictor. كل واحد بيتشغل لوحده.

RADAR-HARD-GATE (2026-10-07 — owner directive):
"الرادار ده المفروض يكون من الحاجات المهمة جداً"
الرادار بقى HARD GATE على مستوى كل التوقعات (مش بس counter-trend).

FIX-JSON-KEYS (2026-10-07): اكتشفنا إن الـ JSON keys في maker_radar output
مختلفة عن اللي الـ code بيـ search عليها. الـ keys الصحيحة:
  - quiet_list (فيه items بـ path='B_quiet_accumulation_strong' / 'C_quiet_accumulation_weak')
  - pre_surge_list (items بـ path='A_pre_surge')
  - explosive_list (items بـ path='D_explosive_surge')
  - early_break_list (items بـ path='E_early_break')
  - under_microscope (كل الأسهم + path field)

الـ module بيـ:
1. يقرأ exit_radar_<date>.json → لو السهم عليه X1/X5 → يـ reject التوصية
2. يقرأ maker_radar_tracking.json → لو السهم متتبَّع → bonus +5
3. يقرأ maker_radar_<market>_<date>.json → لو في path A/B → HARD GATE PASS

الاستخدام في DailyPredictor:
    from analyzers.radar_integration import (
        check_exit_radar_conflict, is_radar_strong_accumulation,
        radar_data_available, get_radar_state
    )
    conflict = check_exit_radar_conflict(ticker)
    if conflict['blocked']:
        continue  # X1/X5 = توزيع/kill switch
    if radar_data_available('EGX'):
        if not is_radar_strong_accumulation(ticker, 'EGX'):
            continue  # HARD GATE — مفيش تجميع قوي
"""
from __future__ import annotations
import os
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Set

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_SCRIPTS_OUTPUT = _PROJECT_ROOT / 'scripts' / 'output'
_TRACKING_FILE = _PROJECT_ROOT / 'db' / 'maker_radar_tracking.json'


def _get_today_str() -> str:
    return datetime.now().strftime("%Y%m%d")


def _load_exit_radar() -> Dict[str, Any]:
    """تحميل آخر exit_radar JSON."""
    from datetime import timedelta
    for offset in range(0, 7):
        d = datetime.now()
        date_str = (d - timedelta(days=offset)).strftime("%Y%m%d")
        path = _SCRIPTS_OUTPUT / f"exit_radar_{date_str}.json"
        if path.exists():
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def _load_maker_radar(market: str = 'EGX') -> Dict[str, Any]:
    """تحميل آخر maker_radar JSON للسوق المحدد."""
    from datetime import timedelta
    market_upper = market.upper()
    # Try market-specific file first
    for offset in range(0, 7):
        d = datetime.now()
        date_str = (d - timedelta(days=offset)).strftime("%Y%m%d")
        path = _SCRIPTS_OUTPUT / f"maker_radar_{market_upper}_{date_str}.json"
        if path.exists():
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        # Try legacy file (no market in name)
        path_legacy = _SCRIPTS_OUTPUT / f"maker_radar_{date_str}.json"
        if path_legacy.exists():
            try:
                with open(path_legacy, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
    return {}


def _load_tracking() -> Dict[str, Any]:
    """تحميل ملف تتبع الرادار."""
    if _TRACKING_FILE.exists():
        try:
            with open(_TRACKING_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


# Cache the loaded data (valid for the duration of one pipeline run)
_exit_radar_cache: Optional[Dict[str, Any]] = None
_maker_radar_cache: Optional[Dict[str, Any]] = None
_tracking_cache: Optional[Dict[str, Any]] = None
# Cache: {TICKER_UPPER: path_str} — flat lookup built from under_microscope
_ticker_path_cache: Optional[Dict[str, str]] = None


def _build_ticker_path_map() -> Dict[str, str]:
    """
    FIX-JSON-KEYS (2026-10-07): بني lookup flat من الـ maker_radar JSON.

    الـ JSON ليه structure متداخل:
      - under_microscope: قائمة بكل الأسهم + path field لكل واحد
      - quiet_list / pre_surge_list / explosive_list / early_break_list:
        subsets مصنّفة (بس برضه فيهم path field)

    الـ function دي بـ تـ iterate على كل المصادر و بني dict:
      {TICKER_UPPER: path_string}

    ده بيـ fix الـ bug إن الـ code كان بـ search على top-level keys
    زي 'A_pre_surge' و 'B_quiet_accumulation_strong' و دي مش موجودة كـ top-level
    keys في الـ JSON الفعلي.
    """
    global _maker_radar_cache, _ticker_path_cache

    if _maker_radar_cache is None:
        _maker_radar_cache = _load_maker_radar('EGX')

    if _ticker_path_cache is not None:
        return _ticker_path_cache

    path_map: Dict[str, str] = {}

    # Source 1: under_microscope (الـ master list — فيه كل الأسهم)
    under_microscope = _maker_radar_cache.get('under_microscope', [])
    for stock in under_microscope:
        if isinstance(stock, dict):
            t = str(stock.get('ticker', '')).upper().strip()
            p = str(stock.get('path', '')).strip()
            if t and p:
                path_map[t] = p
        elif isinstance(stock, str):
            t = stock.upper().strip()
            if t:
                path_map.setdefault(t, 'unknown')

    # Source 2: quiet_list / pre_surge_list / explosive_list / early_break_list
    # (لو under_microscope مش موجودة — بعض الـ legacy versions)
    list_key_to_path = {
        'pre_surge_list': 'A_pre_surge',
        'explosive_list': 'D_explosive_surge',
        'early_break_list': 'E_early_break',
    }
    for list_key, default_path in list_key_to_path.items():
        stocks = _maker_radar_cache.get(list_key, [])
        for stock in stocks:
            if isinstance(stock, dict):
                t = str(stock.get('ticker', '')).upper().strip()
                p = str(stock.get('path', default_path)).strip() or default_path
                if t:
                    path_map[t] = p
            elif isinstance(stock, str):
                t = stock.upper().strip()
                if t:
                    path_map.setdefault(t, default_path)

    # quiet_list ممكن يحتوي على B_quiet_accumulation_strong و C_quiet_accumulation_weak
    quiet_list = _maker_radar_cache.get('quiet_list', [])
    for stock in quiet_list:
        if isinstance(stock, dict):
            t = str(stock.get('ticker', '')).upper().strip()
            p = str(stock.get('path', 'B_quiet_accumulation_strong')).strip()
            if t and p:
                path_map[t] = p
        elif isinstance(stock, str):
            t = stock.upper().strip()
            if t:
                path_map.setdefault(t, 'B_quiet_accumulation_strong')

    _ticker_path_cache = path_map
    return path_map


def check_exit_radar_conflict(ticker: str) -> Dict[str, Any]:
    """
    فحص هل السهم عليه إشارة خروج من Exit Radar.

    Returns:
        {
            'blocked': bool,       # True لو السهم ممنوع (X1/X5)
            'reason': str,         # سبب المنع
            'path': str,           # X1/X2/X3/X4/X5
        }
    """
    global _exit_radar_cache
    if _exit_radar_cache is None:
        _exit_radar_cache = _load_exit_radar()

    ticker_upper = ticker.upper().strip()
    exit_list = _exit_radar_cache.get('exit_list', [])

    for entry in exit_list:
        e_ticker = str(entry.get('ticker', '')).upper().strip()
        if e_ticker == ticker_upper:
            path = entry.get('path', '')
            # X1 (distribution strong) + X5 (kill switch) = HARD BLOCK
            if 'X1' in path or 'X5' in path:
                return {
                    'blocked': True,
                    'reason': f'Exit Radar: {path} — توزيع قوي / kill switch',
                    'path': path,
                }
            # X2/X3/X4 = warning (not blocked, but reduce score)
            return {
                'blocked': False,
                'reason': f'Exit Radar: {path} — إشارة تحذير',
                'path': path,
            }

    return {'blocked': False, 'reason': '', 'path': ''}


def get_radar_boost(ticker: str, market: str = 'EGX') -> int:
    """
    Legacy: حساب bonus score لو الرادار شايف تجميع على السهم.

    OWNER DIRECTIVE (2026-10-07): الرادار بقى HARD GATE — الـ boost ده
    دلوقتي للـ legacy compatibility بس. الـ gate الحقيقي في is_radar_strong_accumulation.

    Returns:
        int: bonus score (0, +3, or +5)
    """
    global _maker_radar_cache, _tracking_cache, _ticker_path_cache

    if _maker_radar_cache is None:
        _maker_radar_cache = _load_maker_radar(market)
        _ticker_path_cache = None  # reset cache
    if _tracking_cache is None:
        _tracking_cache = _load_tracking()

    ticker_upper = ticker.upper().strip()
    boost = 0

    # 1. Check if ticker is in radar tracking (actively tracked by maker radar)
    if ticker_upper in _tracking_cache or ticker in _tracking_cache:
        boost += 5  # Strong boost — radar is actively tracking this stock

    # 2. Check path via flat lookup map
    path_map = _build_ticker_path_map()
    path = path_map.get(ticker_upper, '')

    if path == 'B_quiet_accumulation_strong':
        boost = max(boost, 5)  # Strong accumulation
    elif path == 'A_pre_surge':
        boost = max(boost, 4)  # Pre-surge
    elif path == 'C_quiet_accumulation_weak':
        boost = max(boost, 3)  # Weak accumulation

    return boost


def get_exit_radar_warning(ticker: str) -> Optional[str]:
    """
    فحص إشارات Exit Radar الخفيفة (X2/X3/X4) — مش block بس تحذير.

    Returns:
        str: رسالة تحذير أو None
    """
    conflict = check_exit_radar_conflict(ticker)
    if not conflict['blocked'] and conflict['path']:
        return conflict['reason']
    return None


def is_radar_confirmed_accumulation(ticker: str, market: str = 'EGX') -> bool:
    """
    PRED-RADAR-GAP-AUDIT Step 2 (2026-10-05): تحقق هل السهم مؤكد تجميع من الرادار.

    بـ يقبل A_pre_surge + B_quiet_accumulation_strong + C_quiet_accumulation_weak.
    بيرفض D_explosive_surge + E_early_break.

    Returns:
        bool: True لو السهم في radar accumulation lists
    """
    global _maker_radar_cache, _ticker_path_cache

    if _maker_radar_cache is None:
        _maker_radar_cache = _load_maker_radar(market)
        _ticker_path_cache = None

    path_map = _build_ticker_path_map()
    path = path_map.get(ticker.upper().strip(), '')
    return path in {'A_pre_surge', 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak'}


def is_radar_strong_accumulation(ticker: str, market: str = 'EGX') -> bool:
    """
    RADAR-HARD-GATE (2026-10-07 — owner directive):
    "الرادار ده المفروض يكون من الحاجات المهمة جداً"

    STRICTER من is_radar_confirmed_accumulation — بـ تقبل بس:
      - A_pre_surge (قبل الانفجار السعري — أقوى إشارة)
      - B_quiet_accumulation_strong (تجميع قوي هادئ — 5+ إشارات)

    وترفض صراحةً:
      - C_quiet_accumulation_weak (4 إشارات بس — أضعف من أن يكون hard gate)
      - D_explosive_surge (انفجار سيولة — ممكن يكون false signal لوحده)
      - E_early_break (كسر مبكر — false signal موثَّق في audit)

    ده الـ HARD GATE الأساسي للـ prediction pipeline: لو السهم مش في A أو B
    → مفيش توقع أصلاً (مش بس score boost أو bypass).

    Returns:
        bool: True لو السهم في A_pre_surge أو B_quiet_accumulation_strong فقط
    """
    global _maker_radar_cache, _ticker_path_cache

    if _maker_radar_cache is None:
        _maker_radar_cache = _load_maker_radar(market)
        _ticker_path_cache = None

    path_map = _build_ticker_path_map()
    path = path_map.get(ticker.upper().strip(), '')
    return path in {'A_pre_surge', 'B_quiet_accumulation_strong'}


def get_radar_state(ticker: str, market: str = 'EGX') -> Optional[str]:
    """
    RADAR-HARD-GATE helper: بـ يرجع اسم الـ radar state للسهم.

    Returns:
        str: 'A_pre_surge' / 'B_quiet_accumulation_strong' / 'C_quiet_accumulation_weak'
             / 'D_explosive_surge' / 'E_early_break' / None لو مش في أي radar path
    """
    global _maker_radar_cache, _ticker_path_cache

    if _maker_radar_cache is None:
        _maker_radar_cache = _load_maker_radar(market)
        _ticker_path_cache = None

    path_map = _build_ticker_path_map()
    return path_map.get(ticker.upper().strip()) or None


def radar_data_available(market: str = 'EGX') -> bool:
    """
    RADAR-HARD-GATE helper: هل فيه ملف maker_radar صالح يحتوي على أسهم؟

    ده مهم لـ safe-by-design: لو الرادار مش متاح (ملف مش موجود أو فاضي)،
    ما نمنعش السهم — نكمّل بدون gate (Rule 27: NO-FAKE-DATA).

    Returns:
        bool: True لو فيه ملف maker_radar يحتوي على أسهم تحت الميكروسكوب
    """
    global _maker_radar_cache, _ticker_path_cache

    if _maker_radar_cache is None:
        _maker_radar_cache = _load_maker_radar(market)
        _ticker_path_cache = None

    if not _maker_radar_cache:
        return False

    # Method 1: فيه under_microscope list غير فاضي
    under_microscope = _maker_radar_cache.get('under_microscope', [])
    if under_microscope and len(under_microscope) > 0:
        return True

    # Method 2: فيه أي list من الـ paths
    for list_key in ['quiet_list', 'pre_surge_list', 'explosive_list',
                     'early_break_list']:
        if _maker_radar_cache.get(list_key):
            return True

    return False


def clear_cache():
    """مسح الـ cache (للاستخدام بين runs مختلفة)."""
    global _exit_radar_cache, _maker_radar_cache, _tracking_cache, _ticker_path_cache
    _exit_radar_cache = None
    _maker_radar_cache = None
    _tracking_cache = None
    _ticker_path_cache = None
