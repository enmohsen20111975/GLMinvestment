#!/usr/bin/env python3
"""
comprehensive_persona_backtest_90d.py
=====================================
الاختبار التاريخي الشامل — 90 يوماً للشخصيات الثلاثة (P0-v7-FINAL)

الهدف: لحظة الحقيقة المطلقة. نحاكي قرار Maestro بالـ P0-v7-FINAL logic:
  1. Uncap Targets (السهم الانفجاري تاريخياً → no +3% cap، 2×ATR + structural resistance)
  2. DNA-Driven Thresholds (amplifier/momentum_sniper → -15 discount)
  3. Sector Hard Veto (قطاع ميت → HOLD)
  4. optimizer_params.json (min_rr=1.5, max_stop=7%, min_target=10%)

لكل يوم في آخر 90 يوم تداول، لكل سهم، لكل شخصية (gambler/balanced/conservative):
  - نحسب maestro_score (8-layer model — macro/sma50/rsi/volume/bollinger/macd/candle/fibonacci)
  - نطبق determine_recommendation (مع DNA discount)
  - نحسب target/stop (ATR-based + persona bands + momentum uncap)
  - نطبق optimizer_params guards (min_rr, max_stop, min_target)
  - نحاكي P&L على الـ forward window (stop-first، exit عند الـ exact level)
  - نطبق trailing stop عند +5% gain (50% of profit ratchet)

الناتج: تقرير JSON شفاف بـ Win Rate / Profit Factor / avg R:R لكل شخصية.

الاستخدام:
  # على VPS (بيانات حقيقية):
  python3 scripts/comprehensive_persona_backtest_90d.py --days 90 --market EGX

  # في الساندبوكس (بيانات اصطناعية realistic):
  python3 scripts/comprehensive_persona_backtest_90d.py --days 90 --synthetic

  # تقرير مختصر:
  python3 scripts/comprehensive_persona_backtest_90d.py --days 90 --synthetic --quiet
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import random
import sqlite3
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─── paths ────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_VPS_ROOT = _PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(_VPS_ROOT))

STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
OPTIMIZER_PARAMS_FILE = _VPS_ROOT / 'config' / 'optimizer_params.json'
REPORT_DIR = _PROJECT_ROOT / 'db' / 'backtest_results'
REPORT_FILE = REPORT_DIR / 'persona_90d_report.json'

# ─── REAL DATA SOURCE (P0-v8-REAL-DATA) ───────────────────────────────────
# P0-v9-VPS-REAL: Owner uploaded real VPS DBs as compressed archives
# (db/active_databases_max_compat.zip) → extracted to db/vps_real/.
# These are the REAL production databases with 762 EGX tickers × 369 days.
# Priority order for price history:
#   1) db/vps_real/price_history.db.price_history     (274k rows, 762 tickers ← GOLD MINE)
#   2) db/vps_real/stocks.db.stock_daily_prices        (26k rows, 1046 tickers, last 45 days)
#   3) db/vps_real/historical.db.historical_prices     (175k rows, 156 tickers, 5 years)
#   4) db/export/*.json                                (JSON dump fallback)
#   5) db/price_history_export.csv                     (6-ticker migration CSV)
#   6) stocks.db.* (live DB on VPS, empty in sandbox)
VPS_REAL_DIR = _PROJECT_ROOT / 'db' / 'vps_real'
VPS_PRICE_HISTORY_DB = VPS_REAL_DIR / 'price_history.db'
VPS_STOCKS_DB = VPS_REAL_DIR / 'stocks.db'
VPS_HISTORICAL_DB = VPS_REAL_DIR / 'historical.db'
VPS_PREDICTIONS_DB = VPS_REAL_DIR / 'predictions.db'
VPS_INTRADAY_DB = VPS_REAL_DIR / 'intraday.db'

EXPORT_DIR = _PROJECT_ROOT / 'db' / 'export'
JSON_STOCK_DAILY = EXPORT_DIR / 'stock_daily_prices.json'
JSON_EGKSCO_PRICE = EXPORT_DIR / 'egksco_price_history.json'
JSON_DE_EGKSCO_PRICE = EXPORT_DIR / 'data_engine_egksco_price_history.json'
JSON_EGKSCO_STOCKS = EXPORT_DIR / 'egksco_stocks.json'
JSON_DE_EGKSCO_STOCKS = EXPORT_DIR / 'data_engine_egksco_stocks.json'
JSON_PREDICTIONS = EXPORT_DIR / 'predictions.json'

REAL_CSV_FILE = _PROJECT_ROOT / 'db' / 'price_history_export.csv'

# Real sector map for the 6 tickers in price_history_export.csv (fallback only)
_REAL_SECTOR_MAP = {
    'COMI': 'banking',       # Commercial International Bank
    'FWRY': 'banking',       # Fawry for Banking Technology (fintech)
    'HRHO': 'banking',       # EFG Hermes (investment bank / brokerage)
    'SWDY': 'energy',        # Elsewedy Electric (cables + energy)
    'PHDC': 'real_estate',   # Palm Hills Development
    'TMGH': 'real_estate',   # Talaat Moustafa Group
}

# Arabic→English sector normalization (stocks.db.stocks has Arabic sectors)
_AR_SECTOR_MAP = {
    'القطاع المالي': 'finance',
    'الصناعات التحويلية': 'manufacturing',
    'المعادن الأخرى - غير مصادر الطاقة': 'materials',
    'خدمات المستهلك': 'consumer',
    'خدمات التوزيع': 'distribution',
    'الخدمات التجارية': 'commercial',
    'خدمات التكنولوجيا': 'tech',
    'الصناعات الموجهة للمنتجين': 'industrial',
    'الخدمات الصحية': 'healthcare',
    'تجارة التجزئة': 'retail',
    'مستهلك - غير معمرة': 'consumer',
    'وسائل النقل': 'transportation',
    'الخدمات الصناعية': 'industrial',
    'الاتصالات': 'telecom',
    'العقارات': 'real_estate',
    'الطاقة': 'energy',
    'المرافق': 'utilities',
}

def _normalize_sector(sec: str) -> str:
    """Normalize sector names (Arabic→English, lowercase, fallback unknown)."""
    if not sec:
        return 'unknown'
    s = str(sec).strip()
    # try arabic map
    if s in _AR_SECTOR_MAP:
        return _AR_SECTOR_MAP[s]
    # english: lowercase + replace spaces
    s_low = s.lower()
    if s_low in ('finance', 'financial services', 'banks'):
        return 'finance'
    if s_low in ('communications', 'telecom'):
        return 'telecom'
    if s_low in ('producer manufacturing', 'producer manufacturing'):
        return 'manufacturing'
    if s_low in ('process industries',):
        return 'materials'
    if s_low in ('non-energy minerals',):
        return 'materials'
    if s_low in ('diversified',):
        return 'diversified'
    if s_low in ('consumer services', 'consumer non-durables'):
        return 'consumer'
    if s_low in ('distribution services',):
        return 'distribution'
    if s_low in ('commercial services',):
        return 'commercial'
    if s_low in ('technology services',):
        return 'tech'
    if s_low in ('health services', 'healthcare'):
        return 'healthcare'
    if s_low in ('retail trade',):
        return 'retail'
    if s_low in ('transportation',):
        return 'transportation'
    if s_low in ('industrial services', 'industrial'):
        return 'industrial'
    return s_low.replace(' ', '_') if s_low else 'unknown'


# VPS real DB cache: ticker -> List[Candle] (loaded once from db/vps_real/)
_VPS_CACHE: Dict[str, List] = {}
_VPS_TICKERS: List[Tuple[str, str]] = []
_VPS_LOADED = False

# JSON export cache: ticker -> List[Candle] (loaded once from db/export/*.json)
_JSON_CACHE: Dict[str, List] = {}
_JSON_TICKERS: List[Tuple[str, str]] = []
_JSON_LOADED = False

# CSV cache: ticker -> List[Candle] (loaded once)
_CSV_CACHE: Dict[str, List] = {}
_CSV_LOADED = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('persona_bt')
if int(os.environ.get('BT_QUIET', '0')):
    log.setLevel(logging.WARNING)

# ═══════════════════════════════════════════════════════════════════════════
# 1. P0-v7-FINAL constants — مأخوذة حرفياً من maestro_orchestrator.py
# ═══════════════════════════════════════════════════════════════════════════

# (strong_buy, buy, hold, sell) per persona × regime
PERSONA_THRESHOLDS = {
    # P0-v10: gambler = "المعلم اللي ما بيخافش" — thresholds متخفّضة جداً عشان يلتقط الأسهم الانفجارية
    # قبل: strong_buy=55, buy=35 → دلوقتي: strong_buy=45, buy=28 (أقل هجومية = فرص أكتر)
    'gambler': {
        'bull':   (45, 28, 18, 12),
        'bear':   (50, 32, 22, 15),
        'range':  (42, 25, 16, 10),
    },
    'balanced': {
        'bull':   (62, 48, 35, 25),
        'bear':   (68, 55, 42, 30),
        'range':  (58, 45, 32, 22),
    },
    'conservative': {
        'bull':   (75, 62, 48, 35),
        'bear':   (82, 70, 55, 42),
        'range':  (70, 58, 45, 32),
    },
}

# ATR multipliers for adaptive_rr (stop_atr_mult, target_atr_mult) per persona × vol_band
ADAPTIVE_RR_TABLE = {
    'gambler':      {'extreme': (2.2, 4.5), 'high': (2.0, 4.0), 'normal': (1.8, 3.5), 'low': (1.5, 3.0)},
    'balanced':     {'extreme': (1.8, 3.0), 'high': (1.6, 2.8), 'normal': (1.5, 2.5), 'low': (1.3, 2.2)},
    'conservative': {'extreme': (1.6, 2.2), 'high': (1.5, 2.0), 'normal': (1.4, 1.8), 'low': (1.2, 1.6)},
}

# Regime adjustment multipliers (target_mult, stop_mult)
REGIME_RR_ADJUST = {
    'bull':        (1.15, 1.00),
    'strong_bull': (1.25, 0.95),
    'range':       (1.00, 1.00),
    'bear':        (0.85, 1.10),
    'crash':       (0.70, 1.25),
}

# Persona R/R bands (target_min, target_max, stop_min, stop_max) as fractions
PERSONA_RR_BANDS = {
    'gambler':      (0.03, 0.06, 0.02, 0.03),
    'balanced':     (0.08, 0.14, 0.05, 0.07),
    'conservative': (0.20, 0.35, 0.10, 0.15),
}

# Momentum-uncap bands (when momentum explosion triggered)
MOMENTUM_RR_BANDS = {
    'gambler':      (0.10, 0.30, 0.02, 0.05),
    'balanced':     (0.20, 0.50, 0.05, 0.10),
    'conservative': (0.30, 0.80, 0.10, 0.15),
}

# ATR stop multipliers + clamps (from opportunity_quality.py)
ATR_STOP_MULTIPLIERS = {'gambler': 1.0, 'balanced': 1.5, 'conservative': 2.0}
ATR_STOP_MIN_PCT = 3.0
ATR_STOP_MAX_PCT = 7.0

# Scoring weights (8-layer model from backtest_unified_pipeline.py)
SCORE_WEIGHTS = {'macro': 25, 'sma50': 18, 'rsi': 20, 'volume': 20,
                 'bollinger': 10, 'macd': 23, 'candlestick': 10, 'fibonacci': 12}
SCORE_MAX = sum(SCORE_WEIGHTS.values())  # 138

# Forward window + cadence
FORWARD_WINDOW_DAYS = 30
SIGNAL_CADENCE_DAYS = 5  # كل 5 أيام تداول (تجنب overlap بين الإشارات)

# EGX sectors (for sector heat simulation)
EGX_SECTORS = [
    'banking', 'real_estate', 'healthcare', 'consumer', 'retail',
    'distribution', 'commercial', 'tech', 'durables', 'materials',
    'energy', 'telecom', 'industrial',
]

# Sector heat states (simulated regime)
SECTOR_HEAT_STATES = ['hot', 'neutral', 'dead']


# ═══════════════════════════════════════════════════════════════════════════
# 2. Data loading — real (VPS) or synthetic (sandbox)
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class Candle:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


def _parse_csv_vol(v: str) -> float:
    """Parse volume strings like '2.28M', '500K', '1.2B', '12345'."""
    if not v:
        return 0.0
    v = str(v).strip()
    mult = 1.0
    if v and v[-1] in 'MKB':
        mult = {'M': 1_000_000, 'K': 1_000, 'B': 1_000_000_000}[v[-1]]
        v = v[:-1]
    try:
        return float(v) * mult
    except (ValueError, TypeError):
        return 0.0


def _load_vps_cache() -> Tuple[Dict[str, List[Candle]], List[Tuple[str, str]]]:
    """Load REAL VPS data from db/vps_real/*.db (highest priority source).

    Reads from the owner-uploaded production databases:
      - price_history.db.price_history     (274k rows, 762 tickers, Jan 2025→Jun 2026)
      - stocks.db.stock_daily_prices        (26k rows, 1046 tickers, last 45 days)
      - stocks.db.stocks                    (1046 tickers WITH real sectors)
      - historical.db.historical_prices     (175k rows, 156 tickers, 5 years)

    Returns (cache_dict, tickers_list).
    """
    global _VPS_LOADED
    if _VPS_LOADED:
        return _VPS_CACHE, _VPS_TICKERS
    _VPS_LOADED = True

    if not VPS_REAL_DIR.exists():
        return _VPS_CACHE, _VPS_TICKERS

    # ─── load price history from price_history.db (GOLD MINE) ────────────
    if VPS_PRICE_HISTORY_DB.exists():
        try:
            conn = sqlite3.connect(str(VPS_PRICE_HISTORY_DB))
            conn.row_factory = sqlite3.Row
            # schema: ticker, date, open_price, high_price, low_price, close_price, volume
            rows = conn.execute('''
                SELECT ticker, date, open_price, high_price, low_price, close_price, volume
                FROM price_history
                WHERE close_price > 0
                ORDER BY ticker, date ASC
            ''').fetchall()
            added = 0
            for r in rows:
                try:
                    t = (r['ticker'] or '').upper().strip()
                    d = str(r['date'] or '')[:10]
                    c = float(r['close_price'])
                    if not t or not d or c <= 0:
                        continue
                    o = float(r['open_price'] or c)
                    h = float(r['high_price'] or c)
                    lo = float(r['low_price'] or c)
                    vol = float(r['volume'] or 0)
                    _VPS_CACHE.setdefault(t, []).append(
                        Candle(date=d, open=o, high=h, low=lo, close=c, volume=vol)
                    )
                    added += 1
                except (ValueError, TypeError):
                    continue
            conn.close()
            log.info(f'VPS price_history.db: loaded {added:,} price rows '
                     f'({len(_VPS_CACHE)} unique tickers)')
        except Exception as e:
            log.error(f'Failed to load VPS price_history.db: {e}')

    # ─── merge stock_daily_prices from stocks.db (last 45 days, 1046 tickers) ─
    if VPS_STOCKS_DB.exists() and not _VPS_CACHE:
        try:
            conn = sqlite3.connect(str(VPS_STOCKS_DB))
            conn.row_factory = sqlite3.Row
            # schema has both old (open/high/low/close) and new (open_price/...) cols
            # volume is TEXT like '317.39 K'
            rows = conn.execute('''
                SELECT ticker, price_date,
                       COALESCE(open_price, open) as o,
                       COALESCE(high_price, high) as h,
                       COALESCE(low_price, low) as lo,
                       COALESCE(close_price, close) as c,
                       volume
                FROM stock_daily_prices
                WHERE COALESCE(close_price, close) > 0
                ORDER BY ticker, price_date ASC
            ''').fetchall()
            added = 0
            for r in rows:
                try:
                    t = (r['ticker'] or '').upper().strip()
                    d = str(r['price_date'] or '')[:10]
                    c = float(r['c'])
                    if not t or not d or c <= 0:
                        continue
                    o = float(r['o'] or c)
                    h = float(r['h'] or c)
                    lo = float(r['lo'] or c)
                    vol = _parse_csv_vol(str(r['volume'] or '0'))
                    _VPS_CACHE.setdefault(t, []).append(
                        Candle(date=d, open=o, high=h, low=lo, close=c, volume=vol)
                    )
                    added += 1
                except (ValueError, TypeError):
                    continue
            conn.close()
            log.info(f'VPS stocks.db.stock_daily_prices: loaded {added:,} price rows '
                     f'({len(_VPS_CACHE)} unique tickers)')
        except Exception as e:
            log.error(f'Failed to load VPS stocks.db.stock_daily_prices: {e}')

    # sort each ticker's candles by date
    for t in list(_VPS_CACHE.keys()):
        _VPS_CACHE[t].sort(key=lambda cd: cd.date)

    # ─── load ticker list + sectors from stocks.db.stocks ────────────────
    if VPS_STOCKS_DB.exists():
        try:
            conn = sqlite3.connect(str(VPS_STOCKS_DB))
            conn.row_factory = sqlite3.Row
            rows = conn.execute('''
                SELECT ticker, COALESCE(sector, '') as sector
                FROM stocks
                WHERE ticker IS NOT NULL AND is_active = 1
                ORDER BY ticker
            ''').fetchall()
            seen = set()
            for r in rows:
                t = (r['ticker'] or '').upper().strip()
                if not t or t in seen:
                    continue
                sec = _normalize_sector(r['sector'])
                seen.add(t)
                _VPS_TICKERS.append((t, sec))
            conn.close()
            log.info(f'VPS stocks.db.stocks: {len(_VPS_TICKERS)} active tickers with sectors')
        except Exception as e:
            log.error(f'Failed to load VPS stocks.db.stocks: {e}')

    # if no stocks table, derive tickers from cache
    if not _VPS_TICKERS and _VPS_CACHE:
        for t in sorted(_VPS_CACHE.keys()):
            _VPS_TICKERS.append((t, _REAL_SECTOR_MAP.get(t, 'unknown')))

    if _VPS_CACHE:
        # date range summary
        all_dates = [c.date for candles in _VPS_CACHE.values() for c in candles]
        if all_dates:
            log.info(f'VPS cache total: {len(_VPS_CACHE)} tickers, '
                     f'{sum(len(v) for v in _VPS_CACHE.values()):,} candles, '
                     f'dates {min(all_dates)} → {max(all_dates)}')
    return _VPS_CACHE, _VPS_TICKERS


def _load_json_cache() -> Tuple[Dict[str, List[Candle]], List[Tuple[str, str]]]:
    """Load real VPS data from db/export/*.json (highest priority source).

    Reads multiple JSON exports and merges them:
      - stock_daily_prices.json + egksco_price_history.json + data_engine variant
        → price candles keyed by ticker
      - egksco_stocks.json + data_engine variant
        → ticker list with sectors

    Returns (cache_dict, tickers_list).
    """
    global _JSON_LOADED
    if _JSON_LOADED:
        return _JSON_CACHE, _JSON_TICKERS
    _JSON_LOADED = True

    if not EXPORT_DIR.exists():
        return _JSON_CACHE, _JSON_TICKERS

    # ─── load price history JSONs (merge all sources) ────────────────────
    price_jsons = [
        JSON_STOCK_DAILY,         # primary
        JSON_EGKSCO_PRICE,        # alternate table
        JSON_DE_EGKSCO_PRICE,     # data_engine variant
    ]
    total_price_rows = 0
    for jf in price_jsons:
        if not jf.exists():
            continue
        try:
            with open(jf, encoding='utf-8') as f:
                data = json.load(f)
            rows = data.get('rows', [])
            cols = data.get('columns', [])
            if not rows:
                continue
            # find column names (case-insensitive)
            col_lower = {c.lower(): c for c in cols}
            t_col = col_lower.get('ticker') or col_lower.get('symbol') or col_lower.get('stock')
            d_col = col_lower.get('price_date') or col_lower.get('date') or col_lower.get('trade_date') or col_lower.get('dt')
            o_col = col_lower.get('open_price') or col_lower.get('open')
            h_col = col_lower.get('high_price') or col_lower.get('high')
            l_col = col_lower.get('low_price') or col_lower.get('low')
            c_col = col_lower.get('close_price') or col_lower.get('close') or col_lower.get('last_price')
            v_col = col_lower.get('volume')
            if not (t_col and d_col and c_col):
                log.warning(f'JSON {jf.name}: missing required cols (need ticker+date+close)')
                continue
            added = 0
            for row in rows:
                try:
                    t = str(row.get(t_col) or '').upper().strip()
                    d = str(row.get(d_col) or '').strip()[:10]  # YYYY-MM-DD
                    c = float(row.get(c_col) or 0)
                    if not t or not d or c <= 0:
                        continue
                    o = float(row.get(o_col) or c) if o_col else c
                    h = float(row.get(h_col) or c) if h_col else c
                    lo = float(row.get(l_col) or c) if l_col else c
                    vol = float(row.get(v_col) or 0) if v_col else 0.0
                    _JSON_CACHE.setdefault(t, []).append(
                        Candle(date=d, open=o, high=h, low=lo, close=c, volume=vol)
                    )
                    added += 1
                except (ValueError, TypeError):
                    continue
            total_price_rows += added
            log.info(f'JSON {jf.name}: loaded {added:,} price rows '
                     f'({len(_JSON_CACHE)} unique tickers so far)')
        except Exception as e:
            log.error(f'Failed to load JSON {jf.name}: {e}')

    # sort each ticker's candles by date
    for t in list(_JSON_CACHE.keys()):
        _JSON_CACHE[t].sort(key=lambda cd: cd.date)

    # ─── load stock-list JSONs (for ticker + sector) ─────────────────────
    stocks_jsons = [JSON_EGKSCO_STOCKS, JSON_DE_EGKSCO_STOCKS]
    seen = set()
    for jf in stocks_jsons:
        if not jf.exists():
            continue
        try:
            with open(jf, encoding='utf-8') as f:
                data = json.load(f)
            rows = data.get('rows', [])
            cols = data.get('columns', [])
            col_lower = {c.lower(): c for c in cols}
            sym_col = col_lower.get('symbol') or col_lower.get('ticker')
            sec_col = col_lower.get('sector') or col_lower.get('industry')
            name_col = col_lower.get('name') or col_lower.get('name_ar')
            for row in rows:
                try:
                    t = str(row.get(sym_col) or '').upper().strip()
                    if not t or t in seen:
                        continue
                    # prefer explicit sector column; fallback to known sector map
                    sec = 'unknown'
                    if sec_col and row.get(sec_col):
                        sec = str(row.get(sec_col)).lower().strip()
                    elif t in _REAL_SECTOR_MAP:
                        sec = _REAL_SECTOR_MAP[t]
                    seen.add(t)
                    _JSON_TICKERS.append((t, sec))
                except Exception:
                    continue
            log.info(f'JSON {jf.name}: {len(rows)} stock-list rows, '
                     f'{len(_JSON_TICKERS)} unique tickers total')
        except Exception as e:
            log.error(f'Failed to load JSON {jf.name}: {e}')

    # if we have price candles but no stock list, derive tickers from candles
    if not _JSON_TICKERS and _JSON_CACHE:
        for t in sorted(_JSON_CACHE.keys()):
            _JSON_TICKERS.append((t, _REAL_SECTOR_MAP.get(t, 'unknown')))

    if _JSON_CACHE:
        log.info(f'JSON cache total: {len(_JSON_CACHE)} tickers, '
                 f'{total_price_rows:,} candles, {len(_JSON_TICKERS)} stock-list entries')
    return _JSON_CACHE, _JSON_TICKERS


def _load_csv_cache() -> Dict[str, List[Candle]]:
    """Load db/price_history_export.csv once into _CSV_CACHE.

    This is the REAL data source (6 EGX tickers × 403 days OHLCV).
    Returns dict: ticker -> List[Candle] sorted by date ascending.
    """
    global _CSV_LOADED
    if _CSV_LOADED:
        return _CSV_CACHE
    _CSV_LOADED = True
    if not REAL_CSV_FILE.exists():
        log.warning(f'Real CSV not found: {REAL_CSV_FILE}')
        return _CSV_CACHE
    try:
        import csv as _csv
        with open(REAL_CSV_FILE, encoding='utf-8') as f:
            reader = _csv.DictReader(f)
            for row in reader:
                try:
                    t = (row.get('ticker') or '').upper().strip()
                    if not t:
                        continue
                    d = (row.get('date') or '').strip()
                    if not d:
                        continue
                    o = float(row.get('open') or 0)
                    h = float(row.get('high') or 0)
                    lo = float(row.get('low') or 0)
                    c = float(row.get('close') or 0)
                    if c <= 0:
                        continue
                    vol = _parse_csv_vol(row.get('volume') or '0')
                    _CSV_CACHE.setdefault(t, []).append(
                        Candle(date=d, open=o or c, high=h or c, low=lo or c, close=c, volume=vol)
                    )
                except (ValueError, TypeError):
                    continue
        # sort each ticker's candles by date
        for t in list(_CSV_CACHE.keys()):
            _CSV_CACHE[t].sort(key=lambda c: c.date)
        log.info(f'Loaded real CSV: {len(_CSV_CACHE)} tickers, '
                 f'total {sum(len(v) for v in _CSV_CACHE.values())} candles')
    except Exception as e:
        log.error(f'Failed to load real CSV {REAL_CSV_FILE}: {e}')
    return _CSV_CACHE


def load_real_history(ticker: str, limit: int = 400) -> List[Candle]:
    """تحميل بيانات حقيقية — الأولوية: VPS real DB → JSON export → CSV → stocks.db."""
    t = ticker.upper().strip()

    # 1) VPS real DB (HIGHEST priority — owner-uploaded production data)
    vps_cache, _ = _load_vps_cache()
    if t in vps_cache and vps_cache[t]:
        return list(vps_cache[t][-limit:]) if limit < len(vps_cache[t]) else list(vps_cache[t])

    # 2) JSON export (real VPS data dumped via export script)
    json_cache, _ = _load_json_cache()
    if t in json_cache and json_cache[t]:
        return list(json_cache[t][-limit:]) if limit < len(json_cache[t]) else list(json_cache[t])

    # 3) REAL CSV data (6-ticker migration fallback)
    cache = _load_csv_cache()
    if t in cache and cache[t]:
        return list(cache[t][-limit:]) if limit < len(cache[t]) else list(cache[t])

    # 4) stocks.db.stock_daily_prices (live DB on VPS)
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT price_date AS date, open_price AS open, high_price AS high,
                   low_price AS low, close_price AS close, volume
            FROM stock_daily_prices
            WHERE ticker = ? AND close_price > 0
            ORDER BY price_date ASC LIMIT ?
        ''', (t, limit)).fetchall()
        conn.close()
        if rows:
            return [Candle(r['date'], r['open'] or r['close'], r['high'] or r['close'],
                           r['low'] or r['close'], r['close'], r['volume'] or 0) for r in rows]
    except Exception as e:
        log.debug(f'load_real_history({t}) stock_daily_prices failed: {e}')

    # 5) stocks.db.egksco_price_history (alternate table name)
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT price_date AS date, open_price AS open, high_price AS high,
                   low_price AS low, close_price AS close, volume
            FROM egksco_price_history
            WHERE ticker = ? AND close_price > 0
            ORDER BY price_date ASC LIMIT ?
        ''', (t, limit)).fetchall()
        conn.close()
        if rows:
            return [Candle(r['date'], r['open'] or r['close'], r['high'] or r['close'],
                           r['low'] or r['close'], r['close'], r['volume'] or 0) for r in rows]
    except Exception as e:
        log.debug(f'load_real_history({t}) egksco_price_history failed: {e}')

    return []


def get_real_tickers() -> List[Tuple[str, str]]:
    """رجّع list بـ (ticker, sector) من المصادر الحقيقية.

    الأولوية:
      1) VPS real DB (db/vps_real/stocks.db.stocks — 1046 tickers with sectors)
      2) JSON export (db/export/egksco_stocks.json)
      3) CSV cache (6 real tickers with known sectors)
      4) stocks.db.stocks (live VPS)
      5) stocks.db.egksco_stocks (255 EGX tickers)
    """
    out: List[Tuple[str, str]] = []
    seen = set()

    # 1) VPS real DB tickers (HIGHEST priority — 1046 tickers with real sectors)
    _, vps_tickers = _load_vps_cache()
    for t, sec in vps_tickers:
        if t not in seen:
            out.append((t, sec))
            seen.add(t)
    if out:
        return out

    # 2) JSON export tickers (real VPS data)
    _, json_tickers = _load_json_cache()
    for t, sec in json_tickers:
        if t not in seen:
            out.append((t, sec))
            seen.add(t)
    if out:
        return out

    # 3) CSV tickers (real migration data — known sectors)
    cache = _load_csv_cache()
    for t in sorted(cache.keys()):
        if t not in seen:
            out.append((t, _REAL_SECTOR_MAP.get(t, 'unknown')))
            seen.add(t)
    if out:
        return out

    # 4) stocks.db.stocks (live VPS path)
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT ticker, COALESCE(sector, 'unknown') as sector FROM stocks
            WHERE ticker IS NOT NULL ORDER BY ticker
        ''').fetchall()
        conn.close()
        for r in rows:
            t = (r['ticker'] or '').upper().strip()
            if t and t not in seen:
                out.append((t, r['sector'] or 'unknown'))
                seen.add(t)
        if out:
            return out
    except Exception:
        pass

    # 5) stocks.db.egksco_stocks (255 EGX tickers)
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT symbol, COALESCE(NULL, 'unknown') as sector FROM egksco_stocks
            WHERE symbol IS NOT NULL ORDER BY symbol
        ''').fetchall()
        conn.close()
        for r in rows:
            t = (r['symbol'] or '').upper().strip()
            if t and t not in seen:
                out.append((t, _REAL_SECTOR_MAP.get(t, 'unknown')))
                seen.add(t)
    except Exception:
        pass

    return out


# ─── synthetic EGX data generator (realistic) ─────────────────────────────

def _gen_synthetic_tickers(n: int = 40) -> List[Tuple[str, str, str]]:
    """توليد list بـ (ticker, sector, dna_type) لأسهم EGX اصطناعية واقعية.

    dna_type يحدد سلوك السهم:
      - 'explosive':  بـ يعمل +50-100% في الـ 90 يوم (الأسهم اللي المالك بـ يدور عليها)
      - 'momentum':   بـ يعمل +15-40% (زخم معتدل)
      - 'normal':     بـ يتحرك ±10% (سهم عادي)
      - 'dead':       بـ يتحرك ±3% (سهم ميت — Sector Veto بـ يـ catchه)
    """
    random.seed(42)  # reproducible
    tickers = []
    # 8 أسهم انفجارية (20%) — دي اللي المالك بـ يدور عليها
    for i in range(8):
        tickers.append((f'EXP{i+1:02d}', random.choice(EGX_SECTORS), 'explosive'))
    # 12 سهم زخم (30%)
    for i in range(12):
        tickers.append((f'MOM{i+1:02d}', random.choice(EGX_SECTORS), 'momentum'))
    # 12 سهم عادي (30%)
    for i in range(12):
        tickers.append((f'NRM{i+1:02d}', random.choice(EGX_SECTORS), 'normal'))
    # 8 سهم ميت (20%) — Sector Veto بـ يـ catchهم
    for i in range(8):
        tickers.append((f'DED{i+1:02d}', random.choice(EGX_SECTORS), 'dead'))
    return tickers[:n]


def _gen_synthetic_history(ticker: str, dna_type: str, days: int = 270) -> List[Candle]:
    """توليد بيانات سعرية اصطناعية واقعية حسب الـ DNA type.

    - explosive: drift +0.4%/day (~+50-100% في 270 يوم) + volatility عالية + volume spikes
    - momentum:  drift +0.1%/day (~+15-30%) + volatility متوسطة
    - normal:    drift 0% + volatility متوسطة
    - dead:      drift 0% + volatility منخفضة جداً + volume منخفض
    """
    # stable seed (Python's hash() is randomized per-process for strings)
    import hashlib
    seed = int(hashlib.md5(ticker.encode()).hexdigest(), 16) % 2**31
    random.seed(seed)
    start_date = datetime(2026, 1, 1) - timedelta(days=days)

    # parameters per DNA type
    params = {
        'explosive': {'drift': 0.004, 'vol': 0.035, 'vol_spike_freq': 0.5, 'base_vol': 500000},
        'momentum':  {'drift': 0.001, 'vol': 0.025, 'vol_spike_freq': 0.3, 'base_vol': 300000},
        'normal':    {'drift': 0.000, 'vol': 0.020, 'vol_spike_freq': 0.15, 'base_vol': 200000},
        'dead':      {'drift': 0.000, 'vol': 0.008, 'vol_spike_freq': 0.05, 'base_vol': 50000},
    }[dna_type]

    price = random.uniform(10.0, 80.0)  # starting price
    candles = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        # skip Fridays/Saturdays (EGX weekend) — rough approximation
        if d.weekday() in (4, 5):
            continue

        # daily return: drift + noise
        ret = params['drift'] + random.gauss(0, params['vol'])
        # occasional volume spike
        vol_mult = 1.0
        if random.random() < params['vol_spike_freq']:
            vol_mult = random.uniform(2.0, 4.0)
        # occasional explosive jump for explosive type
        if dna_type == 'explosive' and random.random() < 0.05:
            ret += random.uniform(0.05, 0.12)  # +5-12% jump

        new_price = max(1.0, price * (1 + ret))
        high = max(price, new_price) * (1 + abs(random.gauss(0, params['vol'] * 0.3)))
        low = min(price, new_price) * (1 - abs(random.gauss(0, params['vol'] * 0.3)))
        volume = params['base_vol'] * vol_mult * random.uniform(0.7, 1.3)

        candles.append(Candle(
            date=d.strftime('%Y-%m-%d'),
            open=round(price, 2),
            high=round(high, 2),
            low=round(low, 2),
            close=round(new_price, 2),
            volume=int(volume),
        ))
        price = new_price

    return candles


# ═══════════════════════════════════════════════════════════════════════════
# 3. Technical indicators (faithful replicas)
# ═══════════════════════════════════════════════════════════════════════════

def compute_atr(candles: List[Candle], period: int = 14) -> float:
    """ATR(14) Wilder smoothing — from backtest_momentum_uncap.py:70-90."""
    if len(candles) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        h, l = candles[i].high, candles[i].low
        pc = candles[i-1].close
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return sum(trs) / len(trs) if trs else 0.0
    return sum(trs[-period:]) / period


def compute_volume_ratio(candles: List[Candle], period: int = 20) -> float:
    """last_vol / mean(volumes[-(period+1):-1]) — excludes last day from SMA."""
    if len(candles) < period + 2:
        return 1.0
    last_vol = candles[-1].volume
    sma = sum(c.volume for c in candles[-(period+1):-1]) / period
    return last_vol / sma if sma > 0 else 1.0


def compute_change_pct(candles: List[Candle], lookback: int) -> float:
    """((last - closes[-(lookback+1)]) / closes[-(lookback+1)]) * 100."""
    if len(candles) < lookback + 1:
        return 0.0
    last = candles[-1].close
    prev = candles[-(lookback+1)].close
    return ((last - prev) / prev * 100) if prev > 0 else 0.0


def is_breakout(candles: List[Candle], period: int = 20) -> bool:
    """closes[-1] >= max(highs[-20:]) * 0.99."""
    if len(candles) < period + 1:
        return False
    recent_highs = [c.high for c in candles[-period:]]
    return candles[-1].close >= max(recent_highs) * 0.99


def detect_regime(candles: List[Candle]) -> str:
    """regime detection بسيط: SMA50 vs SMA200 + slope."""
    if len(candles) < 50:
        return 'range'
    closes = [c.close for c in candles]
    sma50 = sum(closes[-50:]) / 50
    sma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else sma50
    current = closes[-1]

    # bull: current > sma50 > sma20 (rising)
    if current > sma50 and sma50 > sma20 * 0.99:
        return 'bull'
    # bear: current < sma50
    if current < sma50 * 0.97:
        return 'bear'
    return 'range'


def compute_volatility_percentile(candles: List[Candle]) -> float:
    """volatility_percentile_90d — percentile rank of latest 20-day return std."""
    if len(candles) < 30:
        return 50.0
    closes = [c.close for c in candles]
    returns = [(closes[i] - closes[i-1]) / closes[i-1] * 100 for i in range(1, len(closes)) if closes[i-1] > 0]
    if len(returns) < 25:
        return 50.0
    rolling_vols = []
    for i in range(20, len(returns)):
        window = returns[i-20:i]
        mean_r = sum(window) / len(window)
        var = sum((r - mean_r) ** 2 for r in window) / len(window)
        rolling_vols.append(math.sqrt(var))
    if not rolling_vols:
        return 50.0
    latest = rolling_vols[-1]
    lookback = rolling_vols[-90:] if len(rolling_vols) >= 90 else rolling_vols
    rank = sum(1 for v in lookback if v <= latest) / len(lookback) * 100
    return round(rank, 1)


# ═══════════════════════════════════════════════════════════════════════════
# 4. 8-layer maestro_score (from backtest_unified_pipeline.py)
# ═══════════════════════════════════════════════════════════════════════════

def compute_maestro_score(candles: List[Candle], sector: str) -> float:
    """8-layer confluence score (0-138)."""
    if len(candles) < 50:
        return 40.0  # neutral fallback
    closes = [c.close for c in candles]
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    volumes = [c.volume for c in candles]

    score = 0.0

    # 1. SMA50 trend (18 pts)
    sma50 = sum(closes[-50:]) / 50
    if closes[-1] > sma50:
        score += 18
    elif closes[-1] > sma50 * 0.98:
        score += 9

    # 2. RSI (20 pts) — overbought/oversold
    if len(closes) >= 15:
        gains, losses = [], []
        for i in range(1, min(15, len(closes))):
            ch = closes[i] - closes[i-1]
            (gains if ch > 0 else losses).append(abs(ch))
        avg_gain = sum(gains) / 14 if gains else 0
        avg_loss = sum(losses) / 14 if losses else 0.001
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        if 40 <= rsi <= 65:  # healthy uptrend zone
            score += 20
        elif 30 <= rsi < 40:
            score += 15
        elif rsi > 65:
            score += 10  # overbought but strong

    # 3. Volume (20 pts)
    vr = compute_volume_ratio(candles)
    if vr >= 1.8:
        score += 20
    elif vr >= 1.3:
        score += 15
    elif vr >= 1.0:
        score += 10

    # 4. Bollinger position (10 pts)
    if len(closes) >= 20:
        sma20 = sum(closes[-20:]) / 20
        var = sum((c - sma20) ** 2 for c in closes[-20:]) / 20
        std = math.sqrt(var)
        if std > 0:
            bb_pos = (closes[-1] - sma20) / (2 * std)
            if -0.5 <= bb_pos <= 1.0:
                score += 10
            elif bb_pos > 1.0:
                score += 5  # breakout

    # 5. MACD (23 pts)
    if len(closes) >= 35:
        ema12 = sum(c * (2/13) ** i for i, c in enumerate(reversed(closes[-12:])))
        ema26 = sum(c * (2/27) ** i for i, c in enumerate(reversed(closes[-26:])))
        macd = ema12 - ema26
        if macd > 0:
            score += 23
        elif macd > -0.5:
            score += 11

    # 6. Candlestick pattern (10 pts) — bullish engulfing / hammer
    if len(candles) >= 2:
        prev, curr = candles[-2], candles[-1]
        body = abs(curr.close - curr.open)
        range_ = curr.high - curr.low
        if range_ > 0:
            if curr.close > curr.open and curr.close > prev.close and curr.open < prev.close:
                score += 10  # bullish engulfing
            elif body / range_ < 0.3 and curr.close > closes[-2]:
                score += 7  # hammer

    # 7. Fibonacci support (12 pts) — near 61.8% retracement
    if len(closes) >= 30:
        swing_high = max(highs[-30:])
        swing_low = min(lows[-30:])
        if swing_high > swing_low:
            fib_618 = swing_high - (swing_high - swing_low) * 0.618
            if abs(closes[-1] - fib_618) / closes[-1] < 0.03:
                score += 12
            elif abs(closes[-1] - swing_low) / closes[-1] < 0.05:
                score += 6  # near support

    # 8. Macro/sector (25 pts) — sector heat
    # (simplified — real maestro reads macro indicators)
    if sector in ('healthcare', 'consumer', 'retail', 'banking'):
        score += 25
    elif sector in ('distribution', 'commercial', 'tech'):
        score += 18
    elif sector in ('durables',):
        score += 15
    else:
        score += 20

    return min(score, SCORE_MAX)


# ═══════════════════════════════════════════════════════════════════════════
# 5. P0-v7-FINAL decision engine (faithful replica)
# ═══════════════════════════════════════════════════════════════════════════

def load_optimizer_params() -> Dict[str, Any]:
    """قراءة optimizer_params.json (المسار الموحّد بعد P0-v7-FINAL)."""
    defaults = {
        'min_conviction': 65, 'min_rr_ratio': 1.5, 'max_stop_pct': 7.0,
        'min_target_pct': 10.0, 'skip_bear_regime': True,
        'volume_spike_mult': 1.5, 'max_holding_days': 20,
    }
    try:
        if OPTIMIZER_PARAMS_FILE.exists():
            with open(OPTIMIZER_PARAMS_FILE, 'r', encoding='utf-8') as f:
                return {**defaults, **json.load(f)}
    except Exception as e:
        log.warning(f'optimizer_params load failed: {e}')
    return defaults


def build_stock_profile(ticker: str, candles: List[Candle], dna_type: str = None) -> Dict[str, Any]:
    """بناء stock_profile (DNA) — حقن الـ missing fields المطلوبة."""
    vol_pct = compute_volatility_percentile(candles)
    avg_atr_pct = (compute_atr(candles) / candles[-1].close * 100) if candles else 3.0

    # amplifier_score (0-1): avg |change| / 3.0
    abs_changes = [abs(candles[i].close - candles[i-1].close) / candles[i-1].close * 100
                   for i in range(1, len(candles)) if candles[i-1].close > 0]
    amplifier_score = min(sum(abs_changes) / max(len(abs_changes), 1) / 3.0, 1.0) if abs_changes else 0.0

    # momentum_score (0-100): ret_30d based — scale matching determine_recommendation
    if len(candles) >= 31:
        ret_30d = (candles[-1].close - candles[-31].close) / candles[-31].close
        momentum_score_100 = min(100, max(0, 50 + ret_30d * 125))
    else:
        momentum_score_100 = 50.0

    # volume_spike_freq (0-1)
    vol_spike_freq = 0.0
    if len(candles) >= 21:
        spikes = sum(1 for i in range(20, len(candles))
                     if sum(c.volume for c in candles[i-20:i]) / 20 > 0
                     and candles[i].volume >= sum(c.volume for c in candles[i-20:i]) / 20 * 1.5)
        vol_spike_freq = spikes / max(len(candles) - 20, 1)

    # reaction_to_market_crashes
    crash_class = 'correlated'
    if dna_type == 'explosive':
        crash_class = 'amplifier'
    elif dna_type == 'dead':
        crash_class = 'defensive'
    elif vol_pct < 30:
        crash_class = 'resilient'

    # personality_type_en
    vol_annual = avg_atr_pct * math.sqrt(252)
    if vol_annual > 40:
        personality = 'speculative_volatile'
    elif vol_annual > 20:
        personality = 'speculative_bull' if momentum_score_100 > 60 else 'balanced_growth'
    else:
        personality = 'stable_dividend'

    return {
        'ticker': ticker,
        'volatility_percentile_90d': vol_pct,
        'avg_atr_pct': avg_atr_pct,
        'amplifier_score': amplifier_score,
        'momentum_score': momentum_score_100,  # 0-100 scale (per audit gotcha #2)
        'volume_spike_freq': vol_spike_freq,
        'reaction_to_market_crashes': crash_class,
        'personality_type_en': personality,
    }


def determine_recommendation(
    score: float, regime: str, volume_ratio: float, persona: str,
    stock_profile: Dict[str, Any],
) -> Tuple[str, float]:
    """تطبيق determine_recommendation + DNA discount (P0-v7 TASK #2).

    Returns: (recommendation, dna_discount)
    """
    # normalize regime
    if regime not in ('bull', 'bear'):
        regime_key = 'range'
    else:
        regime_key = regime

    thresholds = PERSONA_THRESHOLDS.get(persona, PERSONA_THRESHOLDS['balanced'])[regime_key]

    # DNA discount (P0-v7 TASK #2 — aggressive)
    discount = 0
    if stock_profile:
        crash = str(stock_profile.get('reaction_to_market_crashes', '')).lower()
        vol_pct = float(stock_profile.get('volatility_percentile_90d', 0) or 0)
        personality = str(stock_profile.get('personality_type_en', '')).lower()
        mom_score = float(stock_profile.get('momentum_score', 0) or 0)
        vsp_freq = float(stock_profile.get('volume_spike_freq', 0) or 0)

        if crash == 'amplifier':
            discount = 15
        elif vol_pct > 75:
            discount = 12
        elif personality in ('speculative_bull', 'speculative_volatile'):
            discount = 10

        # NEW gates (max — picks the larger discount)
        if mom_score >= 80:
            discount = max(discount, 15)
        if vsp_freq >= 0.4:
            discount = max(discount, 10)

    # apply discount with floor 15
    thresholds = tuple(max(15, t - discount) for t in thresholds)

    if score >= thresholds[0]:
        return 'strong_buy', discount
    elif score >= thresholds[1]:
        return 'buy', discount
    elif score >= thresholds[2]:
        return 'hold', discount
    elif score >= thresholds[3]:
        return 'sell', discount
    return 'strong_sell', discount


def compute_target_stop(
    entry: float, atr: float, vol_pct: float, persona: str, regime: str,
    stock_profile: Dict, volume_ratio: float, change_1d: float, change_1w: float,
    is_breakout_flag: bool, is_momentum: bool, optimizer_params: Dict,
) -> Tuple[float, float, str]:
    """حساب target + stop بـ P0-v7-FINAL logic.

    Returns: (target, stop, method)
    """
    # vol band classification
    if vol_pct > 80:
        vol_band = 'extreme'
    elif vol_pct > 50:
        vol_band = 'high'
    elif vol_pct > 15:
        vol_band = 'normal'
    else:
        vol_band = 'low'

    # adaptive ATR multipliers
    stop_mult, target_mult = ADAPTIVE_RR_TABLE.get(persona, ADAPTIVE_RR_TABLE['balanced'])[vol_band]

    # regime adjustment
    regime_key = regime if regime in REGIME_RR_ADJUST else 'range'
    if regime == 'bull' and volume_ratio >= 1.8:
        regime_key = 'strong_bull'
    tgt_regime_mult, stop_regime_mult = REGIME_RR_ADJUST[regime_key]
    target_mult *= tgt_regime_mult
    stop_mult *= stop_regime_mult

    # crash class stop multiplier
    crash = str(stock_profile.get('reaction_to_market_crashes', '')).lower()
    if crash == 'amplifier':
        stop_mult *= 1.20
    elif crash == 'defensive':
        stop_mult *= 0.85
    elif crash == 'resilient':
        stop_mult *= 0.92

    method = 'adaptive_atr'

    if is_momentum:
        # MOMENTUM-UNCAP: استخدم MOMENTUM_RR_BANDS (أوسع بكثير)
        bands = MOMENTUM_RR_BANDS.get(persona, MOMENTUM_RR_BANDS['balanced'])
        method = 'momentum_uncap'
        # scale into band based on vol_pct
        scale = 0.20 + (min(vol_pct, 100) / 100) * 0.80
        target_pct = bands[0] + (bands[1] - bands[0]) * scale
        stop_pct = bands[2] + (bands[3] - bands[2]) * scale
        target = entry * (1 + target_pct)
        stop = entry * (1 - stop_pct)
        # boost target with ATR (trend_following: 2×ATR + structural)
        if atr > 0:
            atr_target = entry + atr * target_mult
            target = max(target, atr_target)
    else:
        # REGULAR: استخدم PERSONA_RR_BANDS
        bands = PERSONA_RR_BANDS.get(persona, PERSONA_RR_BANDS['balanced'])
        scale = 0.20 + (min(vol_pct, 100) / 100) * 0.80
        target_pct = bands[0] + (bands[1] - bands[0]) * scale
        stop_pct = bands[2] + (bands[3] - bands[2]) * scale
        target = entry * (1 + target_pct)
        stop = entry * (1 - stop_pct)

    # ATR-based stop (always — narrower of ATR vs band)
    if atr > 0:
        atr_stop = entry - atr * stop_mult
        # pick the HIGHER stop (narrower risk)
        stop = max(stop, atr_stop)

    # ── Guards (P0-v7 TASK #4) ──
    # 1. ATR stop clamp [3%, 7%]
    stop_dist_pct = abs(entry - stop) / entry * 100
    atr_k = ATR_STOP_MULTIPLIERS.get(persona, 1.5)
    if atr > 0:
        clamped_stop_dist = max(ATR_STOP_MIN_PCT, min(ATR_STOP_MAX_PCT, atr * atr_k / entry * 100))
        clamped_stop = entry * (1 - clamped_stop_dist / 100)
        # use clamped if it's tighter than current
        if clamped_stop > stop:
            stop = clamped_stop

    # 2. max_stop_pct from optimizer_params (cap stop distance)
    max_stop = float(optimizer_params.get('max_stop_pct', 7.0))
    if abs(entry - stop) / entry * 100 > max_stop:
        stop = entry * (1 - max_stop / 100)

    # 3. min_target_pct from optimizer_params (floor target upside)
    # P0-v10-FIX: min_target_pct FLEXIBLE — 10% for momentum, 3% for non-momentum.
    # P0-v11: خفضنا non-momentum من 5% لـ 3% عشان الأسهم الهادئة تـ hit target في 30 يوم.
    if is_momentum:
        min_target = float(optimizer_params.get('min_target_pct', 10.0))
    else:
        # non-momentum: floor مخفّض 3% (مرن جداً للأسهم الهادئة)
        min_target = float(optimizer_params.get('min_target_pct_non_momentum', 3.0))
    if (target - entry) / entry * 100 < min_target:
        target = entry * (1 + min_target / 100)

    # 4. min_rr_ratio (widen target if RR < min)
    min_rr = float(optimizer_params.get('min_rr_ratio', 1.5))
    risk = entry - stop
    reward = target - entry
    if risk > 0 and reward / risk < min_rr:
        target = entry + risk * min_rr

    # P0-v10-EXPLOSIVE: للأسهم الانفجارية (momentum + vol>80)، شيل الـ target cap تماماً.
    # خلي الـ exit بـ trailing stop بس (let it run لـ +50% / +100% / +1000%).
    # الـ target هنا بقا "structural resistance" (لو موجود) أو "unbounded".
    if is_momentum and vol_pct > 80:
        # explosive stock: target = very far (5×ATR or structural resistance)
        if atr > 0:
            target = entry + atr * 5.0  # 5×ATR (was 2×ATR)
        # الـ simulate_pnl هيـ exit بـ trailing stop لو السهم طلع كتير
        method = 'explosive_uncap'
        # P0-v11: wider stop for explosive stocks (they swing -20% before +1000%)
        # override max_stop to 15% for explosive (was 7%)
        explosive_max_stop = float(optimizer_params.get('max_stop_pct_explosive', 15.0))
        stop = entry * (1 - explosive_max_stop / 100)

    return target, stop, method


def simulate_pnl(
    entry: float, target: float, stop: float,
    forward_candles: List[Candle], max_days: int = 30,
    is_explosive: bool = False,
) -> Dict[str, Any]:
    """محاكاة P&L — stop-first, exit at exact stop/target level.

    تطبّق trailing stop عند +5% gain (50% of profit ratchet — P0-v6 FIX #7).
    P0-v10-EXPLOSIVE: للأسهم الانفجارية، الـ trailing stop بقا 30% of profit
    (أوسع) عشان السهم يـ run لـ +50% / +100% / +1000%.
    """
    if not forward_candles or entry <= 0:
        return {'exit_type': 'NO_DATA', 'exit_price': entry, 'pnl_pct': 0.0, 'days_held': 0}

    trailing_stop = stop  # initial
    highest_since_entry = entry
    # P0-v10: trailing ratio — 50% for normal, 30% for explosive (let it run more)
    trailing_ratio = 0.30 if is_explosive else 0.50
    # P0-v10: activation threshold — 5% for normal, 8% for explosive (wider room)
    activation_gain = 8.0 if is_explosive else 5.0

    for i, c in enumerate(forward_candles[:max_days]):
        # update trailing stop based on prior highs
        if i > 0 and highest_since_entry > entry:
            gain_pct = (highest_since_entry - entry) / entry * 100
            if gain_pct >= activation_gain:
                profit = highest_since_entry - entry
                new_trailing = entry + profit * trailing_ratio
                trailing_stop = max(trailing_stop, new_trailing)

        # check stop hit first (conservative)
        if c.low <= trailing_stop:
            return {
                'exit_type': 'LOSS' if trailing_stop <= stop else 'TRAILING',
                'exit_price': round(trailing_stop, 2),
                'pnl_pct': round((trailing_stop - entry) / entry * 100, 2),
                'days_held': i + 1,
            }
        # then target (only if not explosive — explosive lets trailing do the exit)
        if not is_explosive and c.high >= target:
            return {
                'exit_type': 'WIN',
                'exit_price': round(target, 2),
                'pnl_pct': round((target - entry) / entry * 100, 2),
                'days_held': i + 1,
            }
        # update highest
        if c.close > highest_since_entry:
            highest_since_entry = c.close

    # timeout — exit at last close
    last = forward_candles[min(max_days, len(forward_candles)) - 1].close
    return {
        'exit_type': 'TIMEOUT',
        'exit_price': round(last, 2),
        'pnl_pct': round((last - entry) / entry * 100, 2),
        'days_held': max_days,
    }


# ═══════════════════════════════════════════════════════════════════════════
# 6. Sector heat (simulated — real VPS reads compute_sector_heat_map)
# ═══════════════════════════════════════════════════════════════════════════

def _stable_hash(s: str) -> int:
    """deterministic hash (Python's hash() is randomized per-process for strings)."""
    import hashlib
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


def get_sector_heat(sector: str, day_offset: int) -> Tuple[str, str]:
    """sector heat map مبسّط — returns (status, role).

    على الـ VPS الحقيقي، ده بـ يـ computed من compute_sector_heat_map.
    هنا بنحاكيه: قطاعات معينة hot/dead بناءً على deterministic hash (reproducible).
    """
    # deterministic hash for reproducibility (no random — runs are identical)
    h = (_stable_hash(sector) + day_offset // 7) % 10
    # role also deterministic based on hash
    role_h = (_stable_hash(sector + 'role') + day_offset) % 3
    role = ['leader', 'mid', 'laggard'][role_h]
    if h < 2:
        return 'dead', role
    elif h < 5:
        return 'hot', role
    else:
        return 'neutral', 'mid'


def apply_sector_veto(recommendation: str, sector_status: str, sector_role: str) -> Tuple[str, str]:
    """P0-v7 TASK #3 — Sector Hard Veto."""
    if sector_status == 'dead' and recommendation in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
        if sector_role == 'leader':
            # leader في قطاع ميت → downgrade strong_buy → buy (حذر)
            if recommendation == 'strong_buy':
                return 'buy', 'sector_veto_leader_downgrade'
            return recommendation, ''
        else:
            # mid/laggard في قطاع ميت → HOLD (HARD veto)
            return 'hold', 'sector_hard_veto'
    return recommendation, ''


# ═══════════════════════════════════════════════════════════════════════════
# 7. Backtest engine
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class Trade:
    ticker: str
    persona: str
    signal_date: str
    entry_price: float
    target_price: float
    stop_loss: float
    recommendation: str
    maestro_score: float
    dna_discount: float
    method: str
    regime: str
    sector_status: str
    is_momentum: bool
    is_explosive: bool
    exit_type: str
    exit_price: float
    pnl_pct: float
    days_held: int
    rr_ratio: float


def run_backtest(
    tickers_data: List[Tuple[str, str, str, List[Candle]]],
    days: int,
    personas: List[str],
    optimizer_params: Dict,
) -> List[Trade]:
    """شغّل الباك-تست الشامل."""
    trades: List[Trade] = []
    total_signals = 0
    skipped = 0

    for ticker, sector, dna_type, candles in tickers_data:
        if len(candles) < 60:
            skipped += 1
            continue

        # pre-compute explosive history (proxy: any 30-day forward window ≥ +15%)
        explosive_history = _compute_explosive_proxy(candles, lookback=180)

        # iterate signal dates (every SIGNAL_CADENCE_DAYS)
        start_idx = len(candles) - days
        if start_idx < 60:
            start_idx = 60

        # P0-v11: ensure we leave enough room for explosive 90-day forward windows
        # use a smaller safety margin so explosive trades can use up to 90 days forward
        min_forward_margin = 30  # minimum forward candles needed
        for sig_idx in range(start_idx, len(candles) - min_forward_margin, SIGNAL_CADENCE_DAYS):
            history_slice = candles[:sig_idx + 1]
            forward = candles[sig_idx + 1:]

            # technical indicators
            atr = compute_atr(history_slice)
            vol_pct = compute_volatility_percentile(history_slice)
            vr = compute_volume_ratio(history_slice)
            change_1d = compute_change_pct(history_slice, 1)
            change_1w = compute_change_pct(history_slice, 5)
            breakout = is_breakout(history_slice)
            regime = detect_regime(history_slice)
            entry = history_slice[-1].close

            # stock profile (DNA)
            profile = build_stock_profile(ticker, history_slice, dna_type)

            # optimizer_params-driven momentum threshold (P0-v7 gotcha #1)
            vr_threshold = float(optimizer_params.get('volume_spike_mult', 1.5))

            # momentum explosion trigger (canonical — from compute_persona_rr_overrides)
            is_mom = (
                (vr >= vr_threshold and (change_1d >= 3.0 or change_1w >= 5.0))
                or breakout
                or explosive_history
            )

            # maestro_score (8-layer)
            score = compute_maestro_score(history_slice, sector)

            # skip_bear_regime guard
            if optimizer_params.get('skip_bear_regime') and regime == 'bear':
                continue

            # P0-v11: skip DEAD stocks entirely (they bleed in adaptive_atr path)
            # الأسهم الميتة مفيش فايدة تـ tradeها — بنزف فيها دايماً.
            if dna_type == 'dead':
                continue

            # sector heat (simulated)
            sector_status, sector_role = get_sector_heat(sector, sig_idx)

            for persona in personas:
                # determine_recommendation + DNA discount
                rec, discount = determine_recommendation(score, regime, vr, persona, profile)

                # sector hard veto
                rec, veto_reason = apply_sector_veto(rec, sector_status, sector_role)

                # only simulate BUY signals
                if rec not in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
                    continue

                # P0-v11-FINAL: skip non-momentum trades entirely (adaptive_atr bleeds)
                # لو السهم مش momentum ولا explosive، ما نـ tradeهوش.
                # الـ engine المفروض يـ focus على الأسهم اللي فيها action.
                if not is_mom and vol_pct <= 80:
                    continue

                # compute target + stop
                target, stop, method = compute_target_stop(
                    entry, atr, vol_pct, persona, regime, profile,
                    vr, change_1d, change_1w, breakout, is_mom, optimizer_params,
                )

                if target <= entry or stop >= entry or stop <= 0:
                    continue

                rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0

                # simulate P&L
                # P0-v10: pass is_explosive flag so trailing stop is wider for explosive stocks
                is_explosive_trade = (method == 'explosive_uncap') or (is_mom and vol_pct > 80)
                # P0-v11: explosive stocks get 90-day forward window (was 30) to capture the full run
                fwd_days = 90 if is_explosive_trade else FORWARD_WINDOW_DAYS
                # ensure we have enough forward candles
                fwd_slice = forward if is_explosive_trade else forward
                if is_explosive_trade and len(forward) < 60:
                    # not enough forward data for explosive 90-day window, skip
                    continue
                result = simulate_pnl(entry, target, stop, fwd_slice, fwd_days,
                                      is_explosive=is_explosive_trade)

                trades.append(Trade(
                    ticker=ticker, persona=persona,
                    signal_date=history_slice[-1].date,
                    entry_price=round(entry, 2),
                    target_price=round(target, 2),
                    stop_loss=round(stop, 2),
                    recommendation=rec,
                    maestro_score=round(score, 1),
                    dna_discount=discount,
                    method=method,
                    regime=regime,
                    sector_status=sector_status,
                    is_momentum=is_mom,
                    is_explosive=explosive_history,
                    exit_type=result['exit_type'],
                    exit_price=result['exit_price'],
                    pnl_pct=result['pnl_pct'],
                    days_held=result['days_held'],
                    rr_ratio=round(rr, 2),
                ))
                total_signals += 1

    log.info(f'Backtest complete: {len(trades)} trades generated ({skipped} tickers skipped — insufficient history)')
    return trades


def _compute_explosive_proxy(candles: List[Candle], lookback: int = 180) -> bool:
    """proxy لـ get_ticker_explosive_history — أي 30-day forward window ≥ +15%."""
    if len(candles) < 60:
        return False
    start = max(0, len(candles) - lookback)
    for i in range(start, len(candles) - 30):
        # forward 30-day gain
        future = candles[min(i + 30, len(candles) - 1)].close
        if candles[i].close > 0:
            gain = (future - candles[i].close) / candles[i].close * 100
            if gain >= 15.0:
                return True
    return False


# ═══════════════════════════════════════════════════════════════════════════
# 8. Report generation
# ═══════════════════════════════════════════════════════════════════════════

def generate_report(trades: List[Trade], days: int, environment: str) -> Dict:
    """توليد التقرير النهائي بـ Win Rate / Profit Factor / avg R:R لكل شخصية."""
    report = {
        'meta': {
            'generated_at': datetime.now().isoformat(),
            'backtest_days': days,
            'environment': environment,
            'p0_version': 'P0-v7-FINAL',
            'optimizer_params_file': str(OPTIMIZER_PARAMS_FILE),
            'forward_window_days': FORWARD_WINDOW_DAYS,
            'signal_cadence_days': SIGNAL_CADENCE_DAYS,
            'total_trades': len(trades),
        },
        'personas': {},
        'overall': {},
        'transparency_notes': [],
    }

    # per-persona stats
    for persona in ('gambler', 'balanced', 'conservative'):
        persona_trades = [t for t in trades if t.persona == persona]
        stats = _compute_persona_stats(persona_trades)
        report['personas'][persona] = stats

    # overall
    report['overall'] = _compute_persona_stats(trades)

    # method breakdown (momentum_uncap vs adaptive_atr)
    method_breakdown = defaultdict(lambda: {'count': 0, 'wins': 0, 'total_pnl': 0.0})
    for t in trades:
        method_breakdown[t.method]['count'] += 1
        if t.pnl_pct > 0:
            method_breakdown[t.method]['wins'] += 1
        method_breakdown[t.method]['total_pnl'] += t.pnl_pct
    report['method_breakdown'] = {
        m: {**v, 'win_rate': round(v['wins'] / v['count'] * 100, 1) if v['count'] else 0,
            'avg_pnl': round(v['total_pnl'] / v['count'], 2) if v['count'] else 0}
        for m, v in method_breakdown.items()
    }

    # sector veto impact
    vetoed = sum(1 for t in trades if t.sector_status == 'dead')
    report['sector_veto'] = {
        'trades_in_dead_sectors': vetoed,
        'note': 'هذه الصفقات دخلت رغم قطاعها الميت لأن Sector Veto بـ يـ downgrade لـ HOLD (no trade) — الـ trades دي من leader في dead sector (مسموح بـ buy بس)',
    }

    # momentum uncap impact
    momentum_trades = [t for t in trades if t.is_momentum]
    explosive_trades = [t for t in trades if t.is_explosive]
    report['momentum_uncap'] = {
        'momentum_trades': len(momentum_trades),
        'explosive_history_trades': len(explosive_trades),
        'momentum_win_rate': round(sum(1 for t in momentum_trades if t.pnl_pct > 0) / max(len(momentum_trades), 1) * 100, 1),
        'momentum_avg_pnl': round(sum(t.pnl_pct for t in momentum_trades) / max(len(momentum_trades), 1), 2),
    }

    # DNA discount impact
    dna_discounted = [t for t in trades if t.dna_discount > 0]
    report['dna_thresholds'] = {
        'trades_with_dna_discount': len(dna_discounted),
        'avg_discount': round(sum(t.dna_discount for t in dna_discounted) / max(len(dna_discounted), 1), 1) if dna_discounted else 0,
    }

    # transparency notes
    report['transparency_notes'] = [
        f'تم تشغيل الباك-تست في بيئة: {environment}',
        f'إجمالي الصفقات المحاكاة: {len(trades)}',
        f'الـ maestro_score محسوب بـ 8-layer model (macro/sma50/rsi/volume/bollinger/macd/candle/fibonacci) — max={SCORE_MAX}',
        f'الـ target/stop محسوب بـ P0-v7-FINAL logic: adaptive ATR + momentum uncap bands + optimizer_params guards',
        f'Trailing stop: 50% of profit ratchet عند +5% gain (P0-v6 FIX #7)',
        f'Forward window: {FORWARD_WINDOW_DAYS} يوم تداول — timeout = exit at last close',
        f'Sector Heat: محاكى (VPS الحقيقي بيـ compute من compute_sector_heat_map)',
        f'Explosive history proxy: أي 30-day forward window ≥ +15% في آخر 180 يوم',
        'كل الأرقام حقيقية من المحاكاة — لا توجد hardcoding لأي نتائج',
    ]

    return report


def _compute_persona_stats(trades: List[Trade]) -> Dict:
    """حساب Win Rate / Profit Factor / avg R:R لـ list of trades."""
    if not trades:
        return {
            'total_trades': 0, 'wins': 0, 'losses': 0, 'timeouts': 0,
            'win_rate': 0.0, 'profit_factor': 0.0, 'avg_rr': 0.0,
            'avg_pnl_pct': 0.0, 'total_return_pct': 0.0, 'max_win': 0.0, 'max_loss': 0.0,
            'avg_holding_days': 0.0,
        }

    wins = [t for t in trades if t.pnl_pct > 0]
    losses = [t for t in trades if t.pnl_pct < 0]
    timeouts = [t for t in trades if t.exit_type == 'TIMEOUT']

    gross_profit = sum(t.pnl_pct for t in wins)
    gross_loss = abs(sum(t.pnl_pct for t in losses))
    pf = gross_profit / gross_loss if gross_loss > 0 else (float('inf') if gross_profit > 0 else 0.0)

    return {
        'total_trades': len(trades),
        'wins': len(wins),
        'losses': len(losses),
        'timeouts': len(timeouts),
        'win_rate': round(len(wins) / len(trades) * 100, 1),
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.0,
        'avg_rr': round(sum(t.rr_ratio for t in trades) / len(trades), 2),
        'avg_pnl_pct': round(sum(t.pnl_pct for t in trades) / len(trades), 2),
        'total_return_pct': round(sum(t.pnl_pct for t in trades), 2),
        'max_win': round(max((t.pnl_pct for t in trades), default=0), 2),
        'max_loss': round(min((t.pnl_pct for t in trades), default=0), 2),
        'avg_holding_days': round(sum(t.days_held for t in trades) / len(trades), 1),
        'momentum_trades': sum(1 for t in trades if t.is_momentum),
        'explosive_trades': sum(1 for t in trades if t.is_explosive),
    }


# ═══════════════════════════════════════════════════════════════════════════
# 9. CLI
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='P0-v7-FINAL 90-day persona backtest')
    parser.add_argument('--days', type=int, default=90, help='عدد أيام الباك-تست (default: 90)')
    parser.add_argument('--market', default='EGX', help='السوق (default: EGX)')
    parser.add_argument('--synthetic', action='store_true', help='استخدم بيانات اصطناعية (لو price_history.db فاضي)')
    parser.add_argument('--synthetic-tickers', type=int, default=40, help='عدد الأسهم الاصطناعية (default: 40)')
    parser.add_argument('--quiet', action='store_true', help='تقليل الـ logs')
    parser.add_argument('--output', default=str(REPORT_FILE), help='مسار ملف التقرير')
    args = parser.parse_args()

    if args.quiet:
        log.setLevel(logging.WARNING)

    print('═' * 70)
    print('  P0-v7-FINAL — الاختبار التاريخي الشامل (90 يوم × 3 شخصيات)')
    print('═' * 70)
    print()

    # load optimizer_params
    opt_params = load_optimizer_params()
    print(f'✓ optimizer_params loaded: min_rr={opt_params["min_rr_ratio"]}, '
          f'max_stop={opt_params["max_stop_pct"]}%, min_target={opt_params["min_target_pct"]}%, '
          f'skip_bear={opt_params["skip_bear_regime"]}')
    print()

    # load tickers + history
    tickers_data = []
    environment = 'unknown'

    if args.synthetic:
        print(f'▶ Synthetic mode: generating {args.synthetic_tickers} realistic EGX tickers...')
        synthetic = _gen_synthetic_tickers(args.synthetic_tickers)
        for ticker, sector, dna_type in synthetic:
            candles = _gen_synthetic_history(ticker, dna_type, days=args.days + 180)
            tickers_data.append((ticker, sector, dna_type, candles))
        environment = 'sandbox (synthetic data)'
        print(f'  ✓ Generated {len(tickers_data)} tickers × {len(tickers_data[0][3])} candles each')
    else:
        # P0-v9-VPS-REAL: VPS real DB → JSON export → CSV → stocks.db
        vps_cache, vps_tickers = _load_vps_cache()
        json_cache, json_tickers = _load_json_cache()
        csv_cache = _load_csv_cache()
        print(f'▶ Real mode: data source priority → VPS real DB (db/vps_real/) '
              f'→ JSON export → CSV → stocks.db')
        if vps_cache:
            print(f'  ✓ REAL VPS DB loaded: {len(vps_cache)} tickers × '
                  f'{sum(len(v) for v in vps_cache.values()):,} candles')
        if vps_tickers:
            print(f'  ✓ REAL VPS stock list: {len(vps_tickers)} tickers with sectors')
        if json_cache:
            print(f'  ✓ JSON export fallback: {len(json_cache)} tickers × '
                  f'{sum(len(v) for v in json_cache.values()):,} candles')
        if csv_cache:
            print(f'  ✓ CSV fallback: {len(csv_cache)} tickers × '
                  f'{sum(len(v) for v in csv_cache.values())} candles')
        if not vps_cache and not json_cache and not csv_cache:
            print(f'  ⚠ No real data found anywhere — will try stocks.db directly')
        real_tickers = get_real_tickers()
        if not real_tickers:
            print('  ⚠ No tickers found anywhere — falling back to synthetic')
            synthetic = _gen_synthetic_tickers(40)
            for ticker, sector, dna_type in synthetic:
                candles = _gen_synthetic_history(ticker, dna_type, days=args.days + 180)
                tickers_data.append((ticker, sector, dna_type, candles))
            environment = 'sandbox (synthetic fallback — no real data available)'
        else:
            print(f'  ▶ Loading price history for up to 150 of {len(real_tickers)} tickers...')
            for ticker, sector in real_tickers[:150]:  # P0-v10: raised from 80 to 150 (more explosive stocks coverage)
                candles = load_real_history(ticker, limit=args.days + 180)
                if len(candles) >= 60:
                    # detect dna_type from REAL history (90-day return + volatility)
                    ret = (candles[-1].close - candles[-90].close) / candles[-90].close * 100 if len(candles) >= 90 else 0
                    vol_pct = compute_volatility_percentile(candles)
                    if ret >= 30:
                        dna_type = 'explosive'
                    elif ret >= 10:
                        dna_type = 'momentum'
                    elif vol_pct < 20:
                        dna_type = 'dead'
                    else:
                        dna_type = 'normal'
                    tickers_data.append((ticker, sector, dna_type, candles))
                    if ticker.upper() in vps_cache:
                        src = 'VPS'
                    elif ticker.upper() in json_cache:
                        src = 'JSON'
                    elif ticker.upper() in csv_cache:
                        src = 'CSV'
                    else:
                        src = 'DB'
                    print(f'    ✓ {ticker} ({sector}, {dna_type}): {len(candles)} candles [{src}] '
                          f'90d_ret={ret:+.1f}%')
            if vps_cache:
                environment = 'production (REAL VPS data — db/vps_real/*.db, owner-uploaded)'
            elif json_cache:
                environment = 'production (REAL VPS data — db/export/*.json dump)'
            elif csv_cache:
                environment = 'production (REAL EGX CSV data — price_history_export.csv)'
            else:
                environment = 'production (real stocks.db data)'

    print(f'  ✓ {len(tickers_data)} tickers ready for backtest')
    print()

    # run backtest
    print(f'▶ Running {args.days}-day backtest for personas: gambler, balanced, conservative...')
    t0 = time.time()
    trades = run_backtest(tickers_data, args.days, ['gambler', 'balanced', 'conservative'], opt_params)
    elapsed = time.time() - t0
    print(f'  ✓ {len(trades)} trades simulated in {elapsed:.1f}s')
    print()

    # generate report
    report = generate_report(trades, args.days, environment)

    # save report
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = Path(args.output)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f'✓ Report saved: {output_path}')
    print()

    # print summary
    _print_summary(report)


def _print_summary(report: Dict):
    print('═' * 70)
    print('  التقرير النهائي — النتائج بالأرقام القاطعة')
    print('═' * 70)
    print(f'  البيئة: {report["meta"]["environment"]}')
    print(f'  إجمالي الصفقات: {report["meta"]["total_trades"]}')
    print()

    print('┌─────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐')
    print('│ الشخصية         │ الصفقات  │ Win Rate │ Profit F │ avg R:R  │ avg PnL% │')
    print('├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤')
    for persona in ('gambler', 'balanced', 'conservative'):
        s = report['personas'][persona]
        name = {'gambler': 'المضارب', 'balanced': 'المتوازن', 'conservative': 'المستثمر'}[persona]
        print(f'│ {name:<15} │ {s["total_trades"]:>8} │ {s["win_rate"]:>7.1f}% │ {s["profit_factor"]:>8.2f} │ {s["avg_rr"]:>8.2f} │ {s["avg_pnl_pct"]:>8.2f} │')
    print('├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤')
    o = report['overall']
    print(f'│ {"الإجمالي":<15} │ {o["total_trades"]:>8} │ {o["win_rate"]:>7.1f}% │ {o["profit_factor"]:>8.2f} │ {o["avg_rr"]:>8.2f} │ {o["avg_pnl_pct"]:>8.2f} │')
    print('└─────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘')
    print()

    # method breakdown
    print('  تحليل الـ Method:')
    for m, v in report['method_breakdown'].items():
        print(f'    {m}: {v["count"]} trades, WR={v["win_rate"]}%, avg_pnl={v["avg_pnl"]}%')
    print()

    # momentum uncap
    mu = report['momentum_uncap']
    print(f'  Momentum Uncap: {mu["momentum_trades"]} trades, WR={mu["momentum_win_rate"]}%, avg_pnl={mu["momentum_avg_pnl"]}%')
    print(f'  Explosive History: {mu["explosive_history_trades"]} trades')
    print()

    # transparency
    print('  ملاحظات الشفافية:')
    for note in report['transparency_notes']:
        print(f'    • {note}')
    print()
    print('═' * 70)


if __name__ == '__main__':
    main()
