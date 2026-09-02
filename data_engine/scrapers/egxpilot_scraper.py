#!/usr/bin/env python3
"""
EGXPilot Scraper — Lightweight HTTP fallback for EGX stocks
============================================================

الوظيفة:
  - يجيب أسعار أسهم EGX من EGXPilot API (https://egxpilot.com/api/stocks/all).
  - سريع جداً (1 HTTP request) — لا يحتاج Playwright/Headless browser.
  - بيرجّع list of dicts بنفس شكل TradingView scraper (symbol, name, price, ...).
  - بيستخدمه fallback_chain.py لما TradingView يقع.

الـ Documentation المرجعي:
  - HOW_WE_ANALYZE_AND_PREDICT.md §18 — Fallback Chain (TV → EGXPilot → Yahoo)
  - PROJECT_DISSECTION_REPORT.md — EGXPilot (أسعار لحظية - مجاني)

API: https://egxpilot.com/api/stocks/all
Response shape:
  {
    "updatedAt": "2026-07-27T08:08:22.989Z",
    "stocks": [
      {
        "StockName": "EGX 30",
        "Symbol": ".EGX30",
        "LastPrice": 52928.06,
        "DailyChange": "0.7",
        "Recommendation": "Hold",
        "Daily": "Strong Buy",
        "Weekly": "Strong Buy",
        "Monthly": "Strong Buy",
        "Sector": null,
        "ArabicName": null,
        "OpenPrice": ...,
        "High": ...,
        "Low": ...,
        "Volume": ...,
        "PrevClose": ...
      },
      ...
    ]
  }

Note: EGXPilot بيرجّع كمان الـ indices (.EGX30, .EGX70EWI, .EGX100, .EGX50Capped) —
الـ fallback chain بيفلترهم عشان يخلي بس الأسهم القابلة للتداول.

@author M2y Platform
@version 1.0.0 — يوليو 2026 (Fallback Chain - Phase 1)
"""
from __future__ import annotations

import os
import sys
import json
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import urllib.request
import urllib.error

# Make sure we can import shared helpers when invoked as a script or module
_THIS_DIR = Path(__file__).resolve().parent
_SCRAPERS_DIR = _THIS_DIR
_DATA_ENGINE_DIR = _THIS_DIR.parent
_PROJECT_ROOT = _DATA_ENGINE_DIR.parent

# Database path - unified in /db folder
DB_FILE = str(_PROJECT_ROOT / 'db' / 'data_engine.db')

EGXPILOT_API = os.environ.get('EGXPILOT_API', 'https://egxpilot.com/api/stocks/all')
REQUEST_TIMEOUT = float(os.environ.get('EGXPILOT_TIMEOUT', '30'))

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('[%(asctime)s] [%(levelname)s] [EGXPilot] %(message)s', datefmt='%H:%M:%S'))
    logger.addHandler(_h)


def log(msg: str, level: str = 'info') -> None:
    """Compat log function matching tradingview_scraper signature."""
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}")
    getattr(logger, level.lower(), logger.info)(msg)


# ============================================================================
# HTTP fetch (stdlib only — no requests dependency)
# ============================================================================

def _http_get_json(url: str, timeout: float = REQUEST_TIMEOUT) -> Optional[Dict]:
    """جلب JSON من URL باستخدام urllib (لا يحتاج requests)."""
    try:
        req = urllib.request.Request(
            url,
            method='GET',
            headers={
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) GLMinvestment/1.0',
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                log(f"HTTP {resp.status} from {url}", 'error')
                return None
            raw = resp.read().decode('utf-8', errors='replace')
            return json.loads(raw)
    except urllib.error.URLError as e:
        log(f"URLError fetching {url}: {e}", 'error')
        return None
    except urllib.error.HTTPError as e:
        log(f"HTTPError {e.code} from {url}: {e.reason}", 'error')
        return None
    except json.JSONDecodeError as e:
        log(f"JSON decode error from {url}: {e}", 'error')
        return None
    except Exception as e:
        log(f"Unexpected error fetching {url}: {e}", 'error')
        return None


# ============================================================================
# Parsing
# ============================================================================

def _is_index_symbol(symbol: str) -> bool:
    """فلتر الـ indices (مثل .EGX30) — مش أسهم قابلة للتداول."""
    if not symbol:
        return False
    return symbol.startswith('.') or symbol.upper().startswith('EGX')


def _parse_change(change_val) -> float:
    """تحويل قيمة التغيير (نص أو رقم) لـ float."""
    if change_val is None:
        return 0.0
    if isinstance(change_val, (int, float)):
        return float(change_val)
    s = str(change_val).strip().replace('%', '').replace('+', '')
    s = s.replace('−', '-').replace(',', '')
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _parse_price(price_val) -> float:
    """تحويل السعر لـ float (آمن)."""
    if price_val is None:
        return 0.0
    try:
        return float(price_val)
    except (TypeError, ValueError):
        return 0.0


def _parse_volume(vol_val) -> str:
    """تحويل volume لـ string (للتوافق مع TradingView schema)."""
    if vol_val is None:
        return ''
    return str(vol_val)


def parse_stocks(data: Dict, market_label: str = 'مصر') -> List[Dict]:
    """
    تحويل بيانات EGXPilot للصيغة الموحدة (نفس شكل tradingview_scraper).
    بيرجّع list of dicts: {symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data}
    """
    results: List[Dict] = []
    stocks = data.get('stocks') or []
    for stock in stocks:
        try:
            symbol = (stock.get('Symbol') or '').strip()
            if not symbol or _is_index_symbol(symbol) or symbol.isdigit():
                continue

            price = _parse_price(stock.get('LastPrice'))
            if price <= 0:
                continue  # Skip stocks with no price

            change = _parse_change(stock.get('DailyChange'))

            # Build tabs_data with technical info from EGXPilot
            tabs_data = {
                'recommendation': stock.get('Recommendation'),
                'daily_signal': stock.get('Daily'),
                'weekly_signal': stock.get('Weekly'),
                'monthly_signal': stock.get('Monthly'),
                'open_price': _parse_price(stock.get('OpenPrice')),
                'high': _parse_price(stock.get('High')),
                'low': _parse_price(stock.get('Low')),
                'prev_close': _parse_price(stock.get('PrevClose')),
            }

            results.append({
                'symbol': symbol,
                'name': stock.get('StockName') or stock.get('ArabicName') or symbol,
                'price': price,
                'change_percent': change,
                'volume': _parse_volume(stock.get('Volume')),
                'market_cap': '',  # EGXPilot لا يرجعه
                'sector': stock.get('Sector') or '',
                'tabs_data': tabs_data,
            })
        except Exception as e:
            log(f"⚠️ Parse error on stock {symbol}: {e}", 'warning')
            continue

    return results


# ============================================================================
# DB Save (same schema as tradingview_scraper)
# ============================================================================

def save_to_db(stocks: List[Dict], market: str = 'مصر') -> int:
    """
    حفظ الأسهم في data_engine.db (نفس schema بتاع tradingview_scraper).
    Returns: عدد الأسهم المحفوظة.
    """
    if not stocks:
        return 0

    conn = sqlite3.connect(DB_FILE, timeout=30.0)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    cursor = conn.cursor()

    # Ensure tables exist
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stocks (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            price REAL,
            change_percent REAL,
            volume TEXT,
            market_cap TEXT,
            sector TEXT,
            market TEXT,
            tabs_data TEXT,
            last_update TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    saved = 0
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for s in stocks:
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO stocks
                (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                s.get('symbol', ''), s.get('name', ''), float(s.get('price', 0) or 0),
                float(s.get('change_percent', 0) or 0), s.get('volume', ''), s.get('market_cap', ''),
                s.get('sector', ''), market,
                json.dumps(s.get('tabs_data', {}), ensure_ascii=False), now
            ))
            saved += 1
        except Exception as e:
            log(f"⚠️ DB save error for {s.get('symbol', '?')}: {e}", 'warning')

    conn.commit()
    conn.close()
    return saved


# ============================================================================
# Public API
# ============================================================================

def fetch_egxpilot_stocks() -> Tuple[List[Dict], str]:
    """
    جلب أسعار أسهم EGX من EGXPilot API.

    Returns:
        Tuple[List[Dict], str]: (stocks_list, status_message)
        - stocks_list: list of {symbol, name, price, change_percent, ...}
        - status_message: 'success' | error message
    """
    log("📡 محاولة الاتصال بـ EGXPilot API...")
    data = _http_get_json(EGXPILOT_API, timeout=REQUEST_TIMEOUT)
    if not data:
        return [], "EGXPilot: لا استجابة من الـ API"

    stocks = parse_stocks(data, market_label='مصر')
    if not stocks or len(stocks) < 50:
        return [], f"EGXPilot: بيانات غير كافية ({len(stocks)} سهم فقط)"

    log(f"✅ EGXPilot: تم استلام {len(stocks)} سهم مصري")
    return stocks, 'success'


def fetch_egxpilot_stocks_and_save() -> Dict:
    """
    جلب + حفظ في data_engine.db.

    Returns:
        Dict: {success, source, stocks_count, market, message}
    """
    stocks, status = fetch_egxpilot_stocks()
    if not stocks:
        return {
            'success': False,
            'source': 'egxpilot',
            'stocks_count': 0,
            'market': 'مصر',
            'message': status,
        }

    saved = save_to_db(stocks, market='مصر')
    return {
        'success': True,
        'source': 'egxpilot',
        'stocks_count': saved,
        'market': 'مصر',
        'message': f'تم حفظ {saved} سهم من EGXPilot',
    }


# ============================================================================
# CLI Entry
# ============================================================================

def main() -> int:
    """CLI entry — يرجع 0 على النجاح، 1 على الفشل."""
    log("=" * 50)
    log("📡 EGXPilot Scraper (Fallback for TradingView)")
    log(f"API: {EGXPILOT_API}")
    log("=" * 50)

    result = fetch_egxpilot_stocks_and_save()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
