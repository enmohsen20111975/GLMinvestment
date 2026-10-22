#!/usr/bin/env python3
"""
EGKSCO Scraper — PRICES ONLY (lightweight, no PDFs)
====================================================

الوظيفة:
  - يجيب أسعار أسهم EGX من EGKSCO (https://egksco-online.com/etrade/Sectors.aspx).
  - **نسخة خفيفة**: بيانات الأسعار فقط — مفيش تحميل PDF ولا تقارير ولا Playwright
    (عشان نتجنب CPU burn اللي كان بيسببه الـ vps-service/data/egksco_scraper.py).
  - HTTP واحد بس (Sectors.aspx فيه كل الأسهم) + regex parse.
  - بيرجّع list of dicts بنفس شكل باقي الـ scrapers في الـ fallback chain:
    {symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data}
  - بيحفظ في /home/z/my-project/db/data_engine.db (نفس schema).

المصدر الأصلي: vps-service/data/egksco_scraper.py (928 سطر — فيه PDF + reports).
هنا خدنا بس منطق الـ prices (parse_stocks_html + fetch_stocks).

الاستخدام من fallback_chain.py:
    from egksco_scraper import fetch_egksco_stocks, save_to_db
    stocks, status = fetch_egksco_stocks()
    if stocks:
        save_to_db(stocks, market='مصر')

@author M2y Platform
@version 1.0.0 — يوليو 2026 (Phase 1 Data Sources Cleanup)
"""
from __future__ import annotations

import os
import re
import sys
import json
import time
import sqlite3
import logging
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any

# ============================================================================
# Paths
# ============================================================================
_THIS_DIR = Path(__file__).resolve().parent                  # data_engine/scrapers/
_DATA_ENGINE_DIR = _THIS_DIR.parent                          # data_engine/
_PROJECT_ROOT = _DATA_ENGINE_DIR.parent                      # my-project/
DB_FILE = str(_PROJECT_ROOT / 'db' / 'data_engine.db')

# ============================================================================
# Config
# ============================================================================
EGKSCO_SECTORS_URL = os.environ.get(
    'EGKSCO_SECTORS_URL',
    'https://egksco-online.com/etrade/Sectors.aspx',
)
EGKSCO_STOCK_URL_TEMPLATE = os.environ.get(
    'EGKSCO_STOCK_URL',
    'https://egksco-online.com/etrade/Stock.aspx?Code={symbol}.CA',
)
REQUEST_TIMEOUT = float(os.environ.get('EGKSCO_TIMEOUT', '25'))
INTER_REQUEST_SLEEP = 0.05  # لطافة لو لوّحنا على صفحات متعددة

# ============================================================================
# Logging
# ============================================================================
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [EGKSCO] %(message)s',
        datefmt='%H:%M:%S',
    ))
    logger.addHandler(_h)


def log(msg: str, level: str = 'info') -> None:
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}")
    getattr(logger, level.lower(), logger.info)(msg)


# ============================================================================
# HTTP fetch (stdlib urllib — no requests dependency)
# ============================================================================

def _http_get_text(url: str, timeout: float = REQUEST_TIMEOUT) -> Optional[str]:
    """GET a URL and return text, or None on error."""
    try:
        req = urllib.request.Request(
            url,
            method='GET',
            headers={
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'User-Agent': (
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
                ),
                'Accept-Language': 'ar,en;q=0.9',
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                log(f"HTTP {resp.status} from {url}", 'error')
                return None
            # EGKSCO serves windows-1256 sometimes; be tolerant
            raw = resp.read()
            for enc in ('utf-8', 'windows-1256', 'latin-1'):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    continue
            return raw.decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        log(f"HTTPError {e.code} from {url}: {e.reason}", 'error')
        return None
    except urllib.error.URLError as e:
        log(f"URLError fetching {url}: {e}", 'error')
        return None
    except Exception as e:
        log(f"Unexpected error fetching {url}: {e}", 'error')
        return None


# ============================================================================
# Parsing (adapted from vps-service/data/egksco_scraper.py — parse_stocks_html)
# ============================================================================

# regex: يمسك Code=XXXX.CA&STName=الاسم_العربي
_STOCK_ROW_RE = re.compile(r'Code=([A-Z]+)\.CA\s*&amp;STName=([^"&]+)')
# regex: يمسك spans من نوع aikalam (فيها الأرقام)
_AIKALAM_SPAN_RE = re.compile(r'<span[^>]*class="aikalam"[^>]*>([^<]*)</span>')


def _parse_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        s = str(val).replace(',', '').replace(' ', '').replace('\xa0', '').strip()
        if not s:
            return None
        return float(s)
    except (TypeError, ValueError):
        return None


def _parse_int(val: Any) -> Optional[int]:
    f = _parse_float(val)
    if f is None:
        return None
    try:
        return int(f)
    except (TypeError, ValueError):
        return None


def parse_stocks_html(html: str) -> List[Dict]:
    """
    استخراج الأسهم والأسعار من HTML بتاع Sectors.aspx.

    Mapping (مأخود من vps-service/data/egksco_scraper.py):
      spans[0] = آخر سعر (Last Price)
      spans[1] = سعر الفتح (Open)
      spans[2] = أعلى سعر (High)
      spans[3] = أقل سعر (Low)
      spans[4] = إقفال سابق (Previous Close)
      spans[5] = الكمية (Volume)
      spans[6] = القيمة (Value)

    Returns: list of dicts بنفس شكل الـ chain (symbol, name, price, change_percent,
             volume, market_cap, sector, market='EGX', tabs_data).
    """
    stocks: List[Dict] = []
    seen = set()

    for match in _STOCK_ROW_RE.finditer(html):
        try:
            symbol = match.group(1)
            name_ar = match.group(2).replace('\xa0', ' ').split('&')[0].strip()

            if symbol in seen:
                continue
            seen.add(symbol)

            # ابحث عن spans aikalam في الـ 5000 حرف اللي بعد الـ match (نفس الصف)
            pos = match.end()
            search_area = html[pos:pos + 5000]
            spans = _AIKALAM_SPAN_RE.findall(search_area)[:7]

            stock_data: Dict[str, Any] = {
                'symbol': symbol,
                'name': name_ar,
                'name_ar': name_ar,
            }

            if len(spans) >= 5:
                stock_data['last'] = _parse_float(spans[0]) if len(spans) > 0 else None
                stock_data['open'] = _parse_float(spans[1]) if len(spans) > 1 else None
                stock_data['high'] = _parse_float(spans[2]) if len(spans) > 2 else None
                stock_data['low'] = _parse_float(spans[3]) if len(spans) > 3 else None
                stock_data['prev_close'] = _parse_float(spans[4]) if len(spans) > 4 else None
                stock_data['volume'] = _parse_int(spans[5]) if len(spans) > 5 else None
                stock_data['value'] = _parse_float(spans[6]) if len(spans) > 6 else None
            else:
                # صف فيه symbol بس من غير أرقام كاملة — skip
                continue

            last = stock_data.get('last')
            if last is None or last <= 0:
                # ما عندناش سعر — نتجاهل (الـ chain بيتطلب سعر صالح)
                continue

            # حساب التغيور % من prev_close لو موجود
            prev_close = stock_data.get('prev_close')
            change_pct = 0.0
            if prev_close and prev_close > 0:
                change_pct = ((last - prev_close) / prev_close) * 100.0

            tabs_data = {
                'open': stock_data.get('open'),
                'high': stock_data.get('high'),
                'low': stock_data.get('low'),
                'prev_close': stock_data.get('prev_close'),
                'value': stock_data.get('value'),
                'source': 'egksco',
            }

            volume_val = stock_data.get('volume')
            stocks.append({
                'symbol': symbol,
                'name': name_ar,
                'price': float(last),
                'change_percent': float(change_pct),
                'volume': str(volume_val) if volume_val is not None else '',
                'market_cap': '',  # EGKSCO ما بيرجّعهاش في Sectors.aspx
                'sector': '',       # ما عندناش sector في الـ row الأساسي
                'market': 'EGX',
                'tabs_data': tabs_data,
            })
        except Exception as e:
            log(f"⚠️ Parse error on row: {e}", 'warning')
            continue

    return stocks


# ============================================================================
# DB Save (same schema as egxpilot_scraper / tradingview_scraper)
# ============================================================================

def save_to_db(stocks: List[Dict], market: str = 'مصر') -> int:
    """
    حفظ الأسهم في data_engine.db (نفس schema بتاع الـ chain).
    Compatible مع how fallback_chain.py calls it:
        from egksco_scraper import save_to_db as _save
        saved = _save(stocks, market='مصر')

    Returns: عدد الأسهم المحفوظة.
    """
    if not stocks:
        return 0

    try:
        Path(DB_FILE).parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    conn = sqlite3.connect(DB_FILE, timeout=30.0)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    cursor = conn.cursor()

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
    skipped_invalid = 0
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # SCRAPER-VALIDATION-FIX (2026-10-22): validate tickers before INSERT
    # منع دخول الأسهم المشوهة (UBEEU, ISIN codes, إلخ) من المصدر.
    try:
        from scrapers.ticker_validator import validate_ticker
    except ImportError:
        try:
            from data_engine.scrapers.ticker_validator import validate_ticker
        except ImportError:
            validate_ticker = None  # fallback: no validation

    for s in stocks:
        try:
            symbol = s.get('symbol', '')
            name = s.get('name', '')
            # SCRAPER-VALIDATION-FIX: skip invalid tickers
            if validate_ticker:
                is_valid, reason = validate_ticker(symbol, name)
                if not is_valid:
                    log(f"⚠️ SKIP invalid ticker: {symbol} / {name} — {reason}", 'warning')
                    skipped_invalid += 1
                    continue

            cursor.execute('''
                INSERT OR REPLACE INTO stocks
                (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                symbol, name,
                float(s.get('price', 0) or 0),
                float(s.get('change_percent', 0) or 0),
                s.get('volume', ''), s.get('market_cap', ''),
                s.get('sector', ''), market,
                json.dumps(s.get('tabs_data', {}), ensure_ascii=False), now,
            ))
            saved += 1
        except Exception as e:
            log(f"⚠️ DB save error for {s.get('symbol', '?')}: {e}", 'warning')

    if skipped_invalid > 0:
        log(f"🧹 Skipped {skipped_invalid} invalid ticker(s) during egksco scrape", 'info')
    conn.commit()
    conn.close()
    return saved


# ============================================================================
# Public API
# ============================================================================

def fetch_egksco_stocks() -> Tuple[List[Dict], str]:
    """
    جلب أسعار أسهم EGX من EGKSCO (Sectors.aspx) — prices only.

    Returns:
        Tuple[List[Dict], str]: (stocks_list, status_message)
        - stocks_list: list of {symbol, name, price, change_percent, volume,
                        market_cap, sector, market='EGX', tabs_data}
        - status_message: 'success' أو رسالة خطأ.
        على الفشل بيرجّع ([], error_msg) — ما بيرمي exception أبداً.
    """
    log(f"📡 EGKSCO → GET {EGKSCO_SECTORS_URL}")
    html = _http_get_text(EGKSCO_SECTORS_URL, timeout=REQUEST_TIMEOUT)
    if not html:
        return [], "EGKSCO: لا استجابة من Sectors.aspx"

    stocks = parse_stocks_html(html)
    if not stocks:
        return [], f"EGKSCO: 0 سهم صالح من الصفحة (len(html)={len(html)})"

    log(f"✅ EGKSCO: تم استلام {len(stocks)} سهم مصري")
    return stocks, 'success'


def fetch_egksco_stocks_and_save() -> Dict:
    """
    جلب + حفظ في data_engine.db في خطوة واحدة.

    Returns:
        Dict: {success, source, stocks_count, market, message}
    """
    stocks, status = fetch_egksco_stocks()
    if not stocks:
        return {
            'success': False,
            'source': 'egksco',
            'stocks_count': 0,
            'market': 'مصر',
            'message': status,
        }

    saved = save_to_db(stocks, market='مصر')
    return {
        'success': True,
        'source': 'egksco',
        'stocks_count': saved,
        'market': 'مصر',
        'message': f'تم حفظ {saved} سهم من EGKSCO',
    }


# ============================================================================
# Optional per-stock fallback (NOT used by default — CPU-light)
# ============================================================================
#
# لو Sectors.aspx ما رجّعش أسعار كاملة لسهم معين، ممكن نعمل fallback لصفحة
# السهم الفردية. لكن هذا بيزيد HTTP requests (CPU + network)، فبنستخدمه بس
# لو الـ chain محتاجاه. الـ fallback_chain.py ما بيستدعيهوش افتراضياً.

def fetch_single_stock_price(symbol: str) -> Optional[Dict]:
    """جلب سعر سهم واحد من EGKSCO (صفحة Stock.aspx)."""
    url = EGKSCO_STOCK_URL_TEMPLATE.format(symbol=symbol)
    html = _http_get_text(url, timeout=REQUEST_TIMEOUT)
    if not html:
        return None

    patterns = {
        'last': r'السعر\s*الحالي[^\d]*(\d+\.?\d*)',
        'open': r'الافتتاح[^\d]*(\d+\.?\d*)',
        'high': r'الأعلى[^\d]*(\d+\.?\d*)',
        'low': r'الأدنى[^\d]*(\d+\.?\d*)',
        'prev_close': r'السابق[^\d]*(\d+\.?\d*)',
        'volume': r'الكمية[^\d]*(\d+[\d,]*)',
    }
    out: Dict[str, Any] = {'symbol': symbol}
    for key, pat in patterns.items():
        m = re.search(pat, html)
        if m:
            out[key] = _parse_float(m.group(1).replace(',', ''))
    return out if 'last' in out and out['last'] else None


def fetch_stock_prices(symbols: List[str]) -> Dict[str, Dict]:
    """
    جلب أسعار مجموعة أسهم فردية (لو Sectors.aspx وقع).
    مفيوش sleep كبير — 0.05s بين كل طلب عشان نكون لطيفين مع السيرفر.
    """
    prices: Dict[str, Dict] = {}
    for i, sym in enumerate(symbols):
        try:
            p = fetch_single_stock_price(sym)
            if p:
                prices[sym] = p
        except Exception as e:
            log(f"⚠️ Error fetching {sym}: {e}", 'warning')
        if i > 0:
            time.sleep(INTER_REQUEST_SLEEP)
    return prices


# ============================================================================
# CLI Entry
# ============================================================================

def main() -> int:
    log("=" * 50)
    log("📡 EGKSCO Scraper (Prices Only — no PDFs)")
    log(f"URL: {EGKSCO_SECTORS_URL}")
    log("=" * 50)

    result = fetch_egksco_stocks_and_save()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
