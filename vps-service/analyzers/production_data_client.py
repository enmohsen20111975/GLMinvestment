#!/usr/bin/env python3
"""
Production Data Client — وصلة API للإنتاج
=============================================
يقرأ بيانات live من السيرفر الإنتاجي + مصادر البيانات الخارجية.

الاستراتيجية (Fallback Chain):
  1. Production API (لو متاح) — بيانات live طازجة
  2. EGX Pilot API — أسعار + fundamentals live
  3. Yahoo Finance — تاريخي + daily
  4. Local DBs (intraday.db → data_engine.db → stocks.db) — fallback أخير

الاستخدام:
  from analyzers.production_data_client import ProductionDataClient
  
  client = ProductionDataClient()
  
  # سعر live لسهم
  price = client.get_current_price('COMI')
  
  # OHLCV تاريخي (live أو local)
  ohlcv = client.get_ohlcv('COMI', days=60)
  
  # قائمة أسهم EGX نشطة
  stocks = client.get_active_stocks()

الـ client بـ يحاول Production API الأول، لو فشل بـ يروح EGX Pilot،
لو فشل بـ Yahoo، لو فشل بـ local DBs. ده بيضمن إن دايماً فيه بيانات.

Author: Z.ai Code
Date: 2026-09-01
"""

import os
import sys
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
import urllib.request
import urllib.error

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Config
# ═══════════════════════════════════════════════════════════════════════

# Production API (invist.m2y.net — production server)
# Default to production URL so sandbox always reads live data
PRODUCTION_API_URL = os.environ.get('EGX_PRODUCTION_API', 'https://invist.m2y.net')
PRODUCTION_API_KEY = os.environ.get('EGX_PRODUCTION_API_KEY', '')

# External data sources
EGXPILOT_API = 'https://egxpilot.com/api/stocks/all'
YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'
YAHOO_EGX_SUFFIX = '.CA'  # Cairo exchange

# Local DBs
INTRADAY_DB = PROJECT_ROOT / 'db' / 'intraday.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# Cache (simple in-memory, 60s TTL)
_cache: Dict[str, Tuple[float, Any]] = {}
CACHE_TTL = 60  # seconds


def _get_cached(key: str) -> Optional[Any]:
    """جيب من cache لو لسه valid."""
    if key in _cache:
        ts, val = _cache[key]
        if (datetime.now().timestamp() - ts) < CACHE_TTL:
            return val
    return None


def _set_cached(key: str, val: Any) -> None:
    """خزّن في cache."""
    _cache[key] = (datetime.now().timestamp(), val)


def _http_get(url: str, timeout: int = 15, headers: dict = None) -> Optional[dict]:
    """HTTP GET بـ timeout + error handling."""
    try:
        req = urllib.request.Request(url, headers=headers or {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data
    except Exception as e:
        logger.debug(f"HTTP GET failed {url}: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════
# Production Data Client
# ═══════════════════════════════════════════════════════════════════════

class ProductionDataClient:
    """
    وصلة API للإنتاج — بـ يقرأ بيانات live من مصادر متعددة.
    
    Fallback Chain:
      1. Production API (لو متاح)
      2. EGX Pilot API
      3. Yahoo Finance
      4. Local DBs
    """

    def __init__(self, use_production: bool = True, use_egxpilot: bool = True,
                 use_yahoo: bool = True, use_local: bool = True):
        self.use_production = use_production and bool(PRODUCTION_API_URL)
        self.use_egxpilot = use_egxpilot
        self.use_yahoo = use_yahoo
        self.use_local = use_local
        self._source_stats = {'production': 0, 'egxpilot': 0, 'yahoo': 0,
                              'intraday': 0, 'data_engine': 0, 'stocks_db': 0,
                              'failed': 0}

    @property
    def stats(self) -> Dict[str, int]:
        """إحصائيات مصادر البيانات."""
        return self._source_stats.copy()

    # ═══════════════════════════════════════════════════════════════════
    # 1. Current Price (live)
    # ═══════════════════════════════════════════════════════════════════

    def get_current_price(self, ticker: str) -> Optional[float]:
        """
        سعر live لسهم — بـ يجرب كل المصادر بالترتيب.
        """
        cache_key = f'price_{ticker}'
        cached = _get_cached(cache_key)
        if cached is not None:
            return cached

        # 1. Production API
        if self.use_production:
            price = self._get_price_production(ticker)
            if price and price > 0:
                _set_cached(cache_key, price)
                self._source_stats['production'] += 1
                return price

        # 2. EGX Pilot
        if self.use_egxpilot:
            price = self._get_price_egxpilot(ticker)
            if price and price > 0:
                _set_cached(cache_key, price)
                self._source_stats['egxpilot'] += 1
                return price

        # 3. Yahoo Finance
        if self.use_yahoo:
            price = self._get_price_yahoo(ticker)
            if price and price > 0:
                _set_cached(cache_key, price)
                self._source_stats['yahoo'] += 1
                return price

        # 4. Local intraday.db (latest intraday price)
        if self.use_local:
            price = self._get_price_intraday_db(ticker)
            if price and price > 0:
                _set_cached(cache_key, price)
                self._source_stats['intraday'] += 1
                return price

        # 5. Local stocks.db
        if self.use_local:
            price = self._get_price_stocks_db(ticker)
            if price and price > 0:
                _set_cached(cache_key, price)
                self._source_stats['stocks_db'] += 1
                return price

        self._source_stats['failed'] += 1
        return None

    def _get_price_production(self, ticker: str) -> Optional[float]:
        """سعر live من Production API (invist.m2y.net)."""
        if not PRODUCTION_API_URL:
            return None
        # Use the production screener API (bـ يرجع current_price لكل سهم)
        url = f"{PRODUCTION_API_URL}/api/screener/advanced?market=EGX&limit=500"
        headers = {'Authorization': f'Bearer {PRODUCTION_API_KEY}'} if PRODUCTION_API_KEY else {}
        data = _get_cached('prod_screener')
        if data is None:
            data = _http_get(url, timeout=20, headers=headers)
            if data:
                _set_cached('prod_screener', data)
        if not data or not data.get('success'):
            return None
        for s in data.get('stocks', []):
            if isinstance(s, dict) and s.get('ticker', '').upper() == ticker.upper():
                price = s.get('current_price')
                try:
                    return float(price) if price else None
                except (TypeError, ValueError):
                    return None
        return None

    def _get_price_egxpilot(self, ticker: str) -> Optional[float]:
        """سعر live من EGX Pilot API."""
        data = _get_cached('egxpilot_all')
        if data is None:
            data = _http_get(EGXPILOT_API, timeout=15)
            if data:
                _set_cached('egxpilot_all', data)
        if not data:
            return None
        # EGX Pilot structure: {"updatedAt": "...", "stocks": [{...}]}
        stocks = data.get('stocks', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        for s in stocks:
            if isinstance(s, dict):
                sym = s.get('Symbol') or s.get('symbol') or s.get('ticker') or ''
                if sym.upper() == ticker.upper():
                    # Try multiple field names (EGX Pilot uses LastPrice)
                    price = s.get('LastPrice') or s.get('lastPrice') or s.get('price') or s.get('current_price')
                    try:
                        return float(price) if price else None
                    except (TypeError, ValueError):
                        return None
        return None

    def _get_price_yahoo(self, ticker: str) -> Optional[float]:
        """سعر live من Yahoo Finance."""
        yahoo_ticker = f"{ticker}{YAHOO_EGX_SUFFIX}"
        url = f"{YAHOO_BASE}{yahoo_ticker}?interval=1d&range=1d"
        data = _http_get(url, timeout=10)
        if not data:
            return None
        try:
            result = data.get('chart', {}).get('result', [])
            if result:
                meta = result[0].get('meta', {})
                price = meta.get('regularMarketPrice')
                return float(price) if price else None
        except (KeyError, TypeError, ValueError):
            pass
        return None

    def _get_price_intraday_db(self, ticker: str) -> Optional[float]:
        """آخر سعر من intraday.db (5-min data)."""
        if not INTRADAY_DB.exists():
            return None
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(INTRADAY_DB), writable=False).__enter__()
            row = conn.execute('''
                SELECT close FROM stock_intraday
                WHERE ticker = ? AND close IS NOT NULL AND close > 0
                ORDER BY timestamp DESC LIMIT 1
            ''', (ticker,)).fetchone()
            conn.close()
            return float(row[0]) if row else None
        except Exception:
            return None

    def _get_price_stocks_db(self, ticker: str) -> Optional[float]:
        """سعر من stocks.db (snapshot)."""
        if not STOCKS_DB.exists():
            return None
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
            row = conn.execute(
                'SELECT current_price FROM stocks WHERE ticker = ? AND is_active = 1',
                (ticker,)
            ).fetchone()
            conn.close()
            return float(row[0]) if row and row[0] else None
        except Exception:
            return None

    # ═══════════════════════════════════════════════════════════════════
    # 2. OHLCV History
    # ═══════════════════════════════════════════════════════════════════

    def get_ohlcv(self, ticker: str, days: int = 60) -> Dict[str, List]:
        """
        OHLCV تاريخي — بـ يجرب Yahoo الأول (live)، بعدين local DBs.
        """
        cache_key = f'ohlcv_{ticker}_{days}'
        cached = _get_cached(cache_key)
        if cached:
            return cached

        # 1. Yahoo Finance (live historical)
        if self.use_yahoo:
            ohlcv = self._get_ohlcv_yahoo(ticker, days)
            if ohlcv['closes']:
                _set_cached(cache_key, ohlcv)
                self._source_stats['yahoo'] += 1
                return ohlcv

        # 2. Local data_engine.db
        if self.use_local:
            ohlcv = self._get_ohlcv_data_engine(ticker, days)
            if ohlcv['closes']:
                _set_cached(cache_key, ohlcv)
                self._source_stats['data_engine'] += 1
                return ohlcv

        self._source_stats['failed'] += 1
        return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

    def _get_ohlcv_yahoo(self, ticker: str, days: int) -> Dict[str, List]:
        """OHLCV من Yahoo Finance."""
        yahoo_ticker = f"{ticker}{YAHOO_EGX_SUFFIX}"
        # Calculate range
        period2 = int(datetime.now().timestamp())
        period1 = int((datetime.now() - timedelta(days=days + 30)).timestamp())
        url = (f"{YAHOO_BASE}{yahoo_ticker}?interval=1d"
               f"&period1={period1}&period2={period2}")

        data = _http_get(url, timeout=15)
        if not data:
            return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

        try:
            result = data.get('chart', {}).get('result', [])
            if not result:
                return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

            r = result[0]
            timestamps = r.get('timestamp', [])
            quotes = r.get('indicators', {}).get('quote', [{}])[0]

            dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
            for i, ts in enumerate(timestamps):
                d = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
                o = quotes.get('open', [None] * len(timestamps))[i]
                h = quotes.get('high', [None] * len(timestamps))[i]
                l = quotes.get('low', [None] * len(timestamps))[i]
                c = quotes.get('close', [None] * len(timestamps))[i]
                v = quotes.get('volume', [None] * len(timestamps))[i]

                if c is not None and c > 0:
                    dates.append(d)
                    opens.append(float(o or c))
                    highs.append(float(h or c))
                    lows.append(float(l or c))
                    closes.append(float(c))
                    volumes.append(float(v or 0))

            # Take last N days
            if len(dates) > days:
                dates = dates[-days:]
                opens = opens[-days:]
                highs = highs[-days:]
                lows = lows[-days:]
                closes = closes[-days:]
                volumes = volumes[-days:]

            return {'dates': dates, 'opens': opens, 'highs': highs,
                    'lows': lows, 'closes': closes, 'volumes': volumes}
        except Exception as e:
            logger.debug(f"Yahoo OHLCV parse failed: {e}")
            return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

    def _get_ohlcv_data_engine(self, ticker: str, days: int) -> Dict[str, List]:
        """OHLCV من data_engine.db (local fallback)."""
        if not DATA_ENGINE_DB.exists():
            return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(DATA_ENGINE_DB), writable=False).__enter__()
            rows = conn.execute('''
                SELECT price_date, open_price, high_price, low_price, close_price, volume
                FROM egksco_price_history
                WHERE symbol = ? AND volume IS NOT NULL
                ORDER BY price_date DESC LIMIT ?
            ''', (ticker, days)).fetchall()
            conn.close()

            if not rows:
                return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

            rows = list(reversed(rows))
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

    # ═══════════════════════════════════════════════════════════════════
    # 3. Active Stocks
    # ═══════════════════════════════════════════════════════════════════

    def get_active_stocks(self, market: str = 'EGX', limit: int = 100) -> List[Dict]:
        """
        قائمة الأسهم النشطة — بـ يجرب EGX Pilot الأول، بعدين local.
        """
        cache_key = f'stocks_{market}_{limit}'
        cached = _get_cached(cache_key)
        if cached:
            return cached

        # 1. EGX Pilot (live)
        if self.use_egxpilot:
            stocks = self._get_stocks_egxpilot(market, limit)
            if stocks:
                _set_cached(cache_key, stocks)
                self._source_stats['egxpilot'] += 1
                return stocks

        # 2. Local stocks.db
        if self.use_local:
            stocks = self._get_stocks_local(market, limit)
            if stocks:
                _set_cached(cache_key, stocks)
                self._source_stats['stocks_db'] += 1
                return stocks

        self._source_stats['failed'] += 1
        return []

    def _get_stocks_egxpilot(self, market: str, limit: int) -> List[Dict]:
        """قائمة أسهم من EGX Pilot API."""
        data = _http_get(EGXPILOT_API, timeout=15)
        if not data:
            return []
        stocks = data.get('stocks', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        result = []
        for s in stocks[:limit]:
            if isinstance(s, dict):
                result.append({
                    'ticker': s.get('Symbol') or s.get('symbol') or '',
                    'name': s.get('StockName') or s.get('name') or '',
                    'sector': s.get('Sector') or s.get('sector') or '',
                    'current_price': float(s.get('LastPrice') or s.get('price') or 0),
                    'change_percent': float(s.get('DailyChange') or s.get('change_percent') or 0),
                    'volume': float(s.get('Volume') or s.get('volume') or 0),
                    'market_cap': float(s.get('MarketCap') or s.get('market_cap') or 0),
                    'pe_ratio': float(s.get('PE') or s.get('pe_ratio') or 0),
                })
        return result

    def _get_stocks_local(self, market: str, limit: int) -> List[Dict]:
        """قائمة أسهم من stocks.db."""
        if not STOCKS_DB.exists():
            return []
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
            conn.row_factory = sqlite3.Row
            rows = conn.execute('''
                SELECT ticker, name_ar, sector, current_price, change_percent,
                       volume, market_cap, pe_ratio, roe, rsi, ma_50, ma_200,
                       high_52w, low_52w
                FROM stocks
                WHERE market = ? AND is_active = 1
                ORDER BY (volume * current_price) DESC LIMIT ?
            ''', (market, limit)).fetchall()
            conn.close()
            return [{k: r[k] for k in r.keys()} for r in rows]
        except Exception:
            return []

    # ═══════════════════════════════════════════════════════════════════
    # 4. Stock Metadata (fundamentals)
    # ═══════════════════════════════════════════════════════════════════

    def get_stock_meta(self, ticker: str) -> Dict:
        """metadata لسهم (sector, PE, ROE, etc)."""
        cache_key = f'meta_{ticker}'
        cached = _get_cached(cache_key)
        if cached:
            return cached

        # Try EGX Pilot first
        if self.use_egxpilot:
            data = _get_cached('egxpilot_all')
            if data is None:
                data = _http_get(EGXPILOT_API, timeout=15)
                if data:
                    _set_cached('egxpilot_all', data)
            if data:
                stocks = data.get('stocks', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                for s in stocks:
                    if isinstance(s, dict):
                        sym = s.get('Symbol') or s.get('symbol') or s.get('ticker') or ''
                        if sym.upper() == ticker.upper():
                            meta = {
                                'ticker': ticker,
                                'name': s.get('StockName') or s.get('name') or '',
                                'sector': s.get('Sector') or s.get('sector') or '',
                                'current_price': float(s.get('LastPrice') or s.get('price') or 0),
                                'pe_ratio': float(s.get('PE') or s.get('pe_ratio') or 0),
                                'market_cap': float(s.get('MarketCap') or s.get('market_cap') or 0),
                                'change_percent': float(s.get('DailyChange') or s.get('change_percent') or 0),
                                'volume': float(s.get('Volume') or s.get('volume') or 0),
                            }
                            _set_cached(cache_key, meta)
                            self._source_stats['egxpilot'] += 1
                            return meta

        # Fallback to local
        if self.use_local and STOCKS_DB.exists():
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
                conn.row_factory = sqlite3.Row
                row = conn.execute('''
                    SELECT ticker, name_ar, sector, current_price, change_percent,
                           volume, market_cap, pe_ratio, roe, rsi, ma_50, ma_200,
                           high_52w, low_52w, dividend_yield
                    FROM stocks WHERE ticker = ? AND is_active = 1
                ''', (ticker,)).fetchone()
                conn.close()
                if row:
                    meta = {k: row[k] for k in row.keys()}
                    _set_cached(cache_key, meta)
                    self._source_stats['stocks_db'] += 1
                    return meta
            except Exception:
                pass

        self._source_stats['failed'] += 1
        return {'ticker': ticker}


# ═══════════════════════════════════════════════════════════════════════
# Singleton instance
# ═══════════════════════════════════════════════════════════════════════

_default_client: Optional[ProductionDataClient] = None


def get_data_client() -> ProductionDataClient:
    """جيب الـ default client (singleton)."""
    global _default_client
    if _default_client is None:
        _default_client = ProductionDataClient()
    return _default_client


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Production Data Client — Self Test")
    print("=" * 60)
    print(f"Production API: {PRODUCTION_API_URL or 'NOT SET'}")
    print(f"EGX Pilot: {EGXPILOT_API}")
    print(f"Yahoo: {YAHOO_BASE}...{YAHOO_EGX_SUFFIX}")
    print()

    client = ProductionDataClient()

    # Test 1: Get current price for COMI
    print("=== Test 1: COMI current price ===")
    price = client.get_current_price('COMI')
    print(f"  Price: {price}")
    print(f"  Source stats: {client.stats}")

    # Test 2: Get OHLCV for COMI (Yahoo first)
    print("\n=== Test 2: COMI OHLCV (30 days) ===")
    ohlcv = client.get_ohlcv('COMI', 30)
    print(f"  Bars: {len(ohlcv['closes'])}")
    if ohlcv['closes']:
        print(f"  Last: {ohlcv['dates'][-1]} close={ohlcv['closes'][-1]:.2f}")
    print(f"  Source stats: {client.stats}")

    # Test 3: Get active stocks
    print("\n=== Test 3: Active EGX stocks (top 5) ===")
    stocks = client.get_active_stocks('EGX', 5)
    for s in stocks[:5]:
        print(f"  {s.get('ticker', '?')}: price={s.get('current_price', 0):.2f}, vol={s.get('volume', 0):.0f}")

    print(f"\n=== Final source stats ===")
    print(client.stats)
    print("\n✅ Production Data Client ready")
