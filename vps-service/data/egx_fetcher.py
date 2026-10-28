#!/usr/bin/env python3
"""
EGX Data Fetcher - Unified Dual-Source System
==============================================
تحديث أسعار الأسهم المصرية (EGX) مع نظام مصدرين متبادلين

المصادر:
1. EGXPilot API (أساسي) - مجاني، كل الأسهم المصرية + AI + News
2. TradingView (احتياطي) - للتحليل الفني عند فشل EGXPilot

نظام التبديل:
- EGXPilot هو الأساسي
- TradingView يعمل تلقائياً عند فشل EGXPilot
- لا يوجد Yahoo Finance (تم حذفه)

Author: GLMinvestment Team
Version: 4.0 - Unified Dual-Source Architecture
"""

import os
import time
import sqlite3
import requests
import sys
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import logging
import warnings
warnings.filterwarnings('ignore')

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import parse_volume helper
try:
    from utils.helpers import parse_volume
except ImportError:
    # Fallback definition
    def parse_volume(value) -> int:
        if value is None:
            return 0
        if isinstance(value, (int, float)):
            return int(value)
        value_str = str(value).strip().upper().replace('\u202f', '').replace(' ', '')
        multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
        for suffix, multiplier in multipliers.items():
            if value_str.endswith(suffix):
                try:
                    return int(float(value_str[:-1]) * multiplier)
                except ValueError:
                    return 0
        try:
            return int(float(value_str))
        except (ValueError, TypeError):
            return 0

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import safe HTTP client with retry logic
try:
    from core.http_client import safe_get, HTTPServerError
    HTTP_CLIENT_AVAILABLE = True
    logger.info("✓ HTTP client with retry logic available")
except ImportError:
    HTTP_CLIENT_AVAILABLE = False
    # Fallback to regular requests
    safe_get = requests.get

# Try to import TradingView
try:
    from tradingview_ta import TA_Handler, Interval
    TV_AVAILABLE = True
    logger.info("✓ TradingView TA available")
except ImportError:
    TV_AVAILABLE = False
    logger.warning("✗ TradingView TA not available")

# BRAVO-SCANNER-MIGRATION (2026-10-27): import the unified TradingView Scanner
# REST API (POST to scanner.tradingview.com/egypt/scan). This fetches ALL EGX
# stocks in ONE request (~3s) instead of the old per-ticker tradingview_ta
# loop (50 ticker max × 0.3s sleep = 15s, mostly failing → only 28 stocks).
try:
    # data_engine/scrapers/ is a sibling of vps-service/ — add to path
    _data_engine_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data_engine'))
    if _data_engine_root not in sys.path:
        sys.path.insert(0, _data_engine_root)
    from scrapers.tradingview_rest import fetch_tradingview_stocks as _scanner_fetch
    SCANNER_API_AVAILABLE = True
except Exception as _e:
    SCANNER_API_AVAILABLE = False
    _scanner_fetch = None

# ============================================================================
# CONFIGURATION
# ============================================================================

EGXPILOT_API = 'https://egxpilot.com/api/stocks/all'
REQUEST_TIMEOUT = 30

EGXPILOT_NEWS_API = 'https://egxpilot.com/api/news/'
EGXPILOT_NEWS_SEARCH_API = 'https://egxpilot.com/api/news/search'
EGXPILOT_AI_ANALYSIS_API = 'https://egxpilot.com/api/stockanalysis/'
EGXPILOT_V2_ST_API = 'https://egxpilot.com/api/v2/st/'
EGXPILOT_GOLDEN_STOCKS_API = 'https://egxpilot.com/api/golden-stocks-v2/'
EGXPILOT_STATS_API = 'https://egxpilot.com/api/stats/dashboard'

# EPS values for major EGX stocks (manual - update quarterly)
EPS_VALUES = {
    "COMI": 5.77, "HRHO": 1.55, "CIEB": 1.93, "ETEL": 3.42, "FWRY": 0.48,
    "TMGH": 3.98, "PHDC": 1.08, "MASR": 3.27, "HELI": 0.34, "ORHD": 1.21,
    "ESRS": 6.28, "SWDY": 2.93, "ABUK": 7.07, "SKPC": 0.64, "JUFO": 0.97,
    "VLMR": 0.03, "OCDI": 1.49, "AMER": 0.17, "ALCN": 1.21, "GTHE": 0.12,
    "SAIB": 0.85, "ADIB": 0.92, "BTFH": 0.28, "AMOC": 1.85, "MCQE": 0.42,
}

# Sector mapping
SECTOR_MAP = {
    "COMI": "Financial Services", "HRHO": "Financial Services",
    "CIEB": "Financial Services", "SAIB": "Financial Services",
    "ADIB": "Financial Services", "BTFH": "Financial Services",
    "ETEL": "Telecommunications", "FWRY": "Technology",
    "TMGH": "Real Estate", "PHDC": "Real Estate", "MASR": "Real Estate",
    "HELI": "Real Estate", "ORHD": "Real Estate", "AMER": "Real Estate",
    "ESRS": "Basic Materials", "SWDY": "Industrials", "ABUK": "Basic Materials",
    "SKPC": "Energy", "JUFO": "Consumer Defensive", "VLMR": "Consumer Defensive",
    "OCDI": "Industrials", "ALCN": "Industrials", "AMOC": "Energy",
}


# ============================================================================
# DATA SOURCE CLASSES
# ============================================================================

class EGXPilotSource:
    """EGXPilot API - Primary source for EGX stocks"""
    
    def __init__(self):
        self.name = "EGXPilot"
        self.url = EGXPILOT_API
        self.priority = 1
        self.is_primary = True
    
    def fetch_all_stocks(self) -> Tuple[Optional[List[Dict]], str]:
        """
        جلب كل أسعار الأسهم المصرية
        
        Returns:
            Tuple[List[Dict], str]: (data, status_message)
        """
        try:
            logger.info(f"📡 محاولة الاتصال بـ {self.name}...")
            response = safe_get(self.url, timeout=REQUEST_TIMEOUT)
            
            if response.status_code == 200:
                data = response.json()
                stocks = data.get('stocks', [])
                if stocks and len(stocks) > 50:
                    logger.info(f"✅ {self.name}: تم استلام {len(stocks)} سهم")
                    return self._parse_stocks(stocks), "success"
                else:
                    return None, f"بيانات غير كافية ({len(stocks)} سهم فقط)"
            else:
                return None, f"خطأ HTTP {response.status_code}"
                
        except requests.exceptions.Timeout:
            return None, "انتهت مهلة الاتصال"
        except requests.exceptions.ConnectionError:
            return None, "خطأ في الاتصال"
        except Exception as e:
            return None, f"خطأ غير متوقع: {str(e)}"
    
    def _parse_stocks(self, stocks: List) -> List[Dict]:
        """تحويل بيانات الأسهم للصيغة الموحدة"""
        results = []
        for stock in stocks:
            try:
                symbol = stock.get('Symbol')
                price = stock.get('LastPrice')
                
                if not symbol or price is None:
                    continue
                
                change = stock.get('DailyChange', 0)
                if isinstance(change, str):
                    change = float(change.replace('%', '').replace('+', '')) if change else 0
                
                results.append({
                    'ticker': symbol,
                    'name': stock.get('StockName', ''),
                    'current_price': float(price) if price else None,
                    'previous_close': float(stock.get('PrevClose', price)) if stock.get('PrevClose') else None,
                    'open_price': float(stock.get('OpenPrice', price)) if stock.get('OpenPrice') else None,
                    'high_price': float(stock.get('High', price)) if stock.get('High') else None,
                    'low_price': float(stock.get('Low', price)) if stock.get('Low') else None,
                    'volume': parse_volume(stock.get('Volume', 0)),
                    'price_change': round(change, 4) if change else 0,
                    'pe_ratio': self._calculate_pe(symbol, float(price)) if price else None,
                    'eps': EPS_VALUES.get(symbol),
                    'sector': SECTOR_MAP.get(symbol),
                    'last_update': datetime.now().isoformat(),
                    'source': self.name
                })
            except Exception:
                continue
        
        return results
    
    def _calculate_pe(self, symbol: str, price: float) -> Optional[float]:
        """حساب مكرر الربحية"""
        eps = EPS_VALUES.get(symbol)
        if eps and eps > 0 and price > 0:
            return round(price / eps, 2)
        return None


class TradingViewSource:
    """TradingView - Backup source with technical analysis"""
    
    def __init__(self):
        self.name = "TradingView"
        self.priority = 2
        self.is_primary = False
    
    def fetch_batch(self, tickers: List[str], delay: float = 0.3) -> Tuple[Optional[List[Dict]], str]:
        """
        Fetch multiple stocks with technical indicators
        
        Returns:
            Tuple[List[Dict], str]: (data, status_message)
        """
        if not TV_AVAILABLE:
            return None, "TradingView TA غير متاح"
        
        if not tickers:
            return None, "لا توجد أسهم للجلب"
        
        logger.info(f"📡 محاولة الاتصال بـ {self.name}...")
        results = []
        errors = []
        
        for ticker in tickers[:50]:  # Limit to 50 stocks
            try:
                data = self._fetch_single(ticker)
                if data:
                    results.append(data)
                else:
                    errors.append(ticker)
                time.sleep(delay)
            except Exception:
                errors.append(ticker)
        
        if results:
            msg = f"تم استلام {len(results)} سهم"
            if errors:
                msg += f"، فشل {len(errors)} سهم"
            logger.info(f"✅ {self.name}: {msg}")
            return results, msg
        
        return None, "لم يتم استلام بيانات"
    
    def _fetch_single(self, ticker: str) -> Optional[Dict]:
        """Fetch a single stock with technical data"""
        try:
            handler = TA_Handler(
                symbol=ticker,
                screener="egypt",
                exchange="EGX",
                interval=Interval.INTERVAL_1_DAY
            )
            analysis = handler.get_analysis()
            
            if analysis:
                indicators = analysis.indicators
                price = indicators.get('close', 0)
                prev_close = indicators.get('previous_close', price)
                
                change = price - prev_close if prev_close else 0
                change_pct = (change / prev_close * 100) if prev_close else 0
                
                return {
                    'ticker': ticker,
                    'current_price': round(price, 4) if price else None,
                    'previous_close': round(prev_close, 4) if prev_close else None,
                    'open_price': round(indicators.get('open', price), 4),
                    'high_price': round(indicators.get('high', price), 4),
                    'low_price': round(indicators.get('low', price), 4),
                    'volume': parse_volume(indicators.get('volume', 0)),
                    'price_change': round(change_pct, 4),
                    'pe_ratio': self._calculate_pe(ticker, price),
                    'eps': EPS_VALUES.get(ticker),
                    'sector': SECTOR_MAP.get(ticker),
                    'rsi': indicators.get('RSI'),
                    'sma_20': indicators.get('SMA20'),
                    'sma_50': indicators.get('SMA50'),
                    'last_update': datetime.now().isoformat(),
                    'source': self.name
                }
        except Exception:
            pass
        
        return None
    
    def _calculate_pe(self, symbol: str, price: float) -> Optional[float]:
        """حساب مكرر الربحية"""
        eps = EPS_VALUES.get(symbol)
        if eps and eps > 0 and price > 0:
            return round(price / eps, 2)
        return None

    # BRAVO-SCANNER-MIGRATION (2026-10-27): unified batch fetch via Scanner API.
    # Replaces the per-ticker tradingview_ta loop (50 max × 0.3s = 15s, ~28
    # stocks succeeded) with a single POST that returns ALL ~280 EGX stocks
    # in ~3 seconds. Returns quote dicts in the SAME shape _update_database
    # expects (ticker, current_price, volume, change_percent, rsi, etc.).
    # Fields the scanner doesn't provide (open/high/low/previous_close/pe/
    # eps/sma_50) are set to None — the UPDATE statement uses COALESCE to
    # preserve existing DB values for those columns.
    def fetch_all_via_scanner(self, market: str = 'egypt') -> Tuple[Optional[List[Dict]], str]:
        """Fetch ALL stocks via the unified TradingView Scanner REST API."""
        if not SCANNER_API_AVAILABLE or _scanner_fetch is None:
            return None, "Scanner API غير متاح (tradingview_rest.py غير مستورد)"

        logger.info(f"📡 TradingView Scanner REST → جلب كل أسهم {market} في طلب واحد...")
        try:
            stocks, status = _scanner_fetch(market)
        except Exception as e:
            return None, f"Scanner API استثناء: {e}"

        if not stocks:
            return None, f"Scanner API فشل: {status}"

        quotes: List[Dict] = []
        now_iso = datetime.now().isoformat()
        for s in stocks:
            symbol = (s.get('symbol') or '').strip()
            if not symbol:
                continue
            price = s.get('price') or 0
            if not price or price <= 0:
                continue
            tabs = s.get('tabs_data') or {}
            change_pct = s.get('change_percent') or 0
            vol_str = s.get('volume') or ''
            volume = parse_volume(vol_str) if vol_str else 0
            sector = s.get('sector') or SECTOR_MAP.get(symbol)
            name = s.get('name') or symbol
            eps_val = EPS_VALUES.get(symbol)
            pe_val = self._calculate_pe(symbol, price)
            rsi_val = tabs.get('rsi') if tabs else None

            quotes.append({
                'ticker': symbol,
                'current_price': round(price, 4),
                'previous_close': None,      # scanner doesn't provide; COALESCE preserves DB
                'open_price': None,           # scanner doesn't provide; COALESCE preserves DB
                'high_price': None,           # scanner doesn't provide; COALESCE preserves DB
                'low_price': None,            # scanner doesn't provide; COALESCE preserves DB
                'volume': volume,
                'price_change': round(change_pct, 4),
                'pe_ratio': pe_val,
                'eps': eps_val,
                'sector': sector,
                'rsi': round(rsi_val, 2) if rsi_val else None,
                'sma_50': None,               # scanner doesn't provide; COALESCE preserves DB
                'last_update': now_iso,
                'source': 'TradingView Scanner',
                'name': name,
            })

        msg = f"تم استلام {len(quotes)} سهم من Scanner API"
        logger.info(f"✅ {self.name} (Scanner): {msg}")
        return quotes, msg


# ============================================================================
# EGXPILOT EXTENDED FEATURES
# ============================================================================

class EGXPilotNewsSource:
    """EGXPilot News API - Market news and sentiment"""
    
    def __init__(self):
        self.name = "EGXPilot News"
        self.base_url = EGXPILOT_NEWS_API
        self.search_url = EGXPILOT_NEWS_SEARCH_API
    
    def fetch_latest_news(self, limit: int = 20) -> Optional[List[Dict]]:
        """جلب أحدث الأخبار السوقية"""
        try:
            response = safe_get(self.base_url, timeout=REQUEST_TIMEOUT)
            
            if response.status_code == 200:
                data = response.json()
                news = data.get('data', [])[:limit]
                return self._parse_news(news)
            return None
                
        except Exception as e:
            logger.error(f"خطأ في جلب الأخبار: {e}")
            return None
    
    def search_news(self, query: str, limit: int = 10) -> Optional[List[Dict]]:
        """البحث في الأخبار"""
        try:
            response = safe_get(
                self.search_url,
                params={'q': query, 'limit': limit},
                timeout=REQUEST_TIMEOUT,
                headers=self.headers
            )
            
            if response.status_code == 200:
                data = response.json()
                news = data.get('news', [])
                return self._parse_news(news)
            return None
                
        except Exception:
            return None
    
    def _parse_news(self, news: List) -> List[Dict]:
        """تحويل بيانات الأخبار"""
        results = []
        for item in news:
            try:
                results.append({
                    'id': item.get('id'),
                    'title': item.get('title', ''),
                    'summary': item.get('summary', ''),
                    'content': item.get('content', ''),
                    'source': item.get('source', 'EGXpilot'),
                    'url': item.get('url', ''),
                    'timestamp': item.get('timestamp', datetime.now().isoformat()),
                    'sentiment': item.get('sentiment', 'neutral'),
                    'sentiment_score': item.get('sentiment_score', 0),
                    'tickers': item.get('tickers', [])
                })
            except Exception:
                continue
        return results


class EGXPilotAISource:
    """EGXPilot AI Analysis Engine"""
    
    def __init__(self):
        self.name = "EGXPilot AI"
        self.analysis_url = EGXPILOT_AI_ANALYSIS_API
        self.v2_url = EGXPILOT_V2_ST_API
    
    def analyze_stock(self, ticker: str) -> Optional[Dict]:
        """تحليل AI لسهم واحد"""
        try:
            response = safe_get(
                f"{self.analysis_url}{ticker}",
                timeout=REQUEST_TIMEOUT,
                headers=self.headers
            )
            
            if response.status_code == 200:
                data = response.json()
                return self._parse_analysis(data)
            return None
                
        except Exception:
            return None
    
    def get_stock_snapshot(self, ticker: str) -> Optional[Dict]:
        """لقطة سريعة من AI للسهم"""
        try:
            response = safe_get(
                f"{self.v2_url}{ticker}",
                timeout=REQUEST_TIMEOUT,
                headers=self.headers
            )
            
            if response.status_code == 200:
                data = response.json()
                return self._parse_v2_snapshot(data)
            return None
                
        except Exception:
            return None
    
    def analyze_batch(self, tickers: List[str]) -> List[Dict]:
        """تحليل مجموعة من الأسهم"""
        results = []
        for ticker in tickers:
            try:
                data = self.analyze_stock(ticker)
                if data:
                    results.append(data)
                time.sleep(0.1)
            except Exception:
                continue
        return results
    
    def _parse_analysis(self, data: Dict) -> Dict:
        """تحويل بيانات التحليل"""
        short_term = data.get('shortTerm', {})
        trading_scenario = data.get('tradingScenario', {})
        risk = data.get('risk', {})
        indicators = data.get('indicators', {})
        
        return {
            'symbol': data.get('symbol', ''),
            'ai_summary': short_term.get('arabicLabel', data.get('bias', {}).get('label', '')),
            'signals': {
                'rsi': indicators.get('rsi'),
                'macd': indicators.get('macd', {}).get('histogram'),
                'smart_money': data.get('regime', {}).get('label', ''),
                'adx': indicators.get('adx', {}).get('adx')
            },
            'rsi': indicators.get('rsi'),
            'macd': indicators.get('macd', {}).get('histogram'),
            'recommendation': short_term.get('signal', ''),
            'confidence': short_term.get('confidence', 0),
            'smart_money': data.get('regime', {}).get('label', ''),
            'entry': trading_scenario.get('entryZone', [0, 0]),
            'stop_loss': risk.get('stopLoss'),
            'targets': risk.get('targets', {}),
            'timestamp': data.get('_timestamp', datetime.now().isoformat())
        }
    
    def _parse_v2_snapshot(self, data: Dict) -> Dict:
        """تحويل لقطة v2"""
        return {
            'symbol': data.get('symbol', ''),
            'price': data.get('price'),
            'change': data.get('change'),
            'change_pct': data.get('change_pct'),
            'ai_summary': data.get('ai_summary', ''),
            'signals': data.get('signals', {}),
            'timestamp': data.get('timestamp', datetime.now().isoformat())
        }


class EGXPilotGoldenStocksSource:
    """EGXPilot Golden Stocks - Pre-breakout opportunities"""
    
    def __init__(self):
        self.name = "EGXPilot Golden Stocks"
        self.url = EGXPILOT_GOLDEN_STOCKS_API
    
    def fetch_opportunities(self, limit: int = 10) -> Optional[List[Dict]]:
        """جلب الفرص التداولية الذهبية"""
        try:
            response = safe_get(self.url, timeout=REQUEST_TIMEOUT)
            
            if response.status_code == 200:
                data = response.json()
                opportunities = data.get('opportunities', [])[:limit]
                return self._parse_opportunities(opportunities)
            return None
                
        except Exception:
            return None
    
    def _parse_opportunities(self, opportunities: List) -> List[Dict]:
        """تحويل الفرص للصيغة الموحدة"""
        results = []
        for opp in opportunities:
            try:
                results.append({
                    'symbol': opp.get('symbol', ''),
                    'type': opp.get('type', 'breakout'),
                    'entry': opp.get('entry_price'),
                    'stop_loss': opp.get('stop_loss'),
                    'take_profit': opp.get('take_profit'),
                    'risk_reward': opp.get('risk_reward'),
                    'confidence': opp.get('confidence', 0),
                    'reason': opp.get('reason', ''),
                    'timeframe': opp.get('timeframe', '1D')
                })
            except Exception:
                continue
        return results


class EGXPilotSystemStats:
    """EGXPilot System Statistics"""
    
    def __init__(self):
        self.name = "EGXPilot Stats"
        self.url = EGXPILOT_STATS_API
        self.health_url = 'https://egxpilot.com/api/stats/health'
    
    def get_dashboard(self) -> Optional[Dict]:
        """الحصول على إحصائيات لوحة التحكم"""
        try:
            response = safe_get(self.url, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                return response.json()
            return None
        except Exception:
            return None
    
    def get_health(self) -> Optional[Dict]:
        """فحص صحة النظام"""
        try:
            response = safe_get(self.health_url, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                return response.json()
            return None
        except Exception:
            return None


# ============================================================================
# MAIN DATA FETCHER - UNIFIED DUAL-SOURCE SYSTEM
# ============================================================================

class EGXDataFetcher:
    """
    EGX Data Fetcher - Unified Dual-Source System (TV-PRIMARY)
    ============================================================
    Sources:
    1. TradingView (PRIMARY) — أسعار + مؤشرات فنية غنية (RSI/SMA20/SMA50)
    2. EGXPilot (REFERENCE + FALLBACK) — مرجع لأسماء/رموز الأسهم + احتياطي للسعر

    Strategy (per-ticker fallback — أكثر مرونة من whole-source fallback):
      - نجلب EGXPilot دائمًا أولًا كـ reference (ticker→name/sector/eps)
      - نجلب TradingView لكل ticker — لو نجح، نستخدم سعره + مؤشراته
      - لو TradingView فشل لـ ticker معين → نستخدم سعر EGXPilot لهذا الـ ticker
      - النتيجة: بيانات TradingView الغنية + أسماء EGXPilot الموثوقة

    NO Yahoo Finance - Removed as per user request.

    Usage:
        fetcher = EGXDataFetcher(db_path)
        success = fetcher.update_prices()
    """

    def __init__(self, db_path: str):
        self.db_path = db_path

        # Initialize sources - TradingView primary, EGXPilot reference+fallback
        self.egxpilot = EGXPilotSource()
        self.tradingview = TradingViewSource()

        # EGXPilot Extended Features
        self.egxpilot_news = EGXPilotNewsSource()
        self.egxpilot_ai = EGXPilotAISource()
        self.egxpilot_golden = EGXPilotGoldenStocksSource()
        self.egxpilot_stats = EGXPilotSystemStats()

        # Statistics
        self.stats = {
            'primary_source': 'TradingView',
            'reference_source': 'EGXPilot',
            'tradingview_success': 0,
            'egxpilot_fallback_used': 0,
            'failed': 0,
            'last_source_used': None,
            'last_update': None
        }

    def update_prices(self) -> bool:
        """
        تحديث الأسعار — TradingView أساسي، EGXPilot مرجع للأسماء واحتياطي.

        Per-ticker fallback strategy:
          1. اجلب EGXPilot دائمًا (reference للأسماء/الرموز)
          2. لكل ticker: جرّب TradingView أولًا، لو فشل → استخدم EGXPilot
          3. ادمج: سعر TradingView + اسم EGXPilot

        BRAVO-NEVER-HALT (2026-10-27): محرك البيانات ممنوع يقف تحت أي ظرف.
        الـ method دي بتـ catch كل exception + بتـ fallback لـ emergency tickers
        لو كل المصادر فشلت. بترجع False بس ما بترمي exception أبداً.
        """
        # BRAVO-NEVER-HALT: top-level guard — the engine MUST NOT crash.
        try:
            return self._update_prices_inner()
        except Exception as e:
            logger.error(f"🚨 [NEVER-HALT] update_prices crashed (caught): {e}")
            import traceback
            logger.error(traceback.format_exc())
            self._print_stats(0, f'CRASH: {e}')
            return False

    def _update_prices_inner(self) -> bool:
        """Inner implementation — wrapped by update_prices() never-halt guard."""
        logger.info("\n" + "=" * 60)
        logger.info("🔧 تحديث أسعار الأسهم المصرية (EGX) — TV-PRIMARY")
        logger.info("=" * 60)
        logger.info(f"📅 التاريخ: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"🎯 المصدر الأساسي: {self.stats['primary_source']}")
        logger.info(f"📋 المرجع + الاحتياطي: {self.stats['reference_source']}")
        logger.info("-" * 60)

        # Step 1: ALWAYS fetch EGXPilot as reference (ticker→name/sector mapping)
        logger.info("\n📡 جلب EGXPilot كمرجع للأسماء والرموز...")
        egx_ref, ref_msg = self.egxpilot.fetch_all_stocks()
        ref_map: Dict[str, Dict] = {}
        if egx_ref and len(egx_ref) > 0:
            for s in egx_ref:
                tk = s.get('ticker')
                if tk:
                    ref_map[tk] = s
            logger.info(f"✅ EGXPilot reference: {len(ref_map)} سهم (للأسماء/الرموز)")
        else:
            logger.warning(f"⚠️ EGXPilot reference فشل: {ref_msg} — هنعتمد على tickers من DB")

        # Step 2: Build ticker list (prefer EGXPilot ref, fallback to DB)
        if ref_map:
            tickers = list(ref_map.keys())
        else:
            tickers = self._get_tickers_from_db()

        if not tickers:
            # BRAVO-NEVER-HALT (2026-10-27): محرك البيانات ممنوع يقف. لو EGXPilot
            # AND DB فشلوا الاتنين، نـ fallback لـ emergency ticker list (أهم 25 سهم
            # EGX — موجودة في EPS_VALUES). ده بيضمن إن المحرك دايماً عنده tickers
            # يحاول يجيبها من TradingView Scanner.
            logger.error("⚠️ [NEVER-HALT] لا توجد tickers من EGXPilot ولا DB — استخدام emergency list")
            tickers = list(EPS_VALUES.keys())
            if not tickers:
                logger.error("🚨 [NEVER-HALT] emergency list فارغة — لا يمكن المتابعة")
                self._print_stats(0, None)
                return False
            logger.warning(f"🔄 [NEVER-HALT] emergency tickers: {len(tickers)} سهم (مهمة فقط)")

        # Step 3: TradingView PRIMARY — prefer unified Scanner API (1 request,
        # ~3s, ~280 stocks); fall back to per-ticker tradingview_ta only if the
        # scanner fails. BRAVO-SCANNER-MIGRATION (2026-10-27): the old per-ticker
        # loop (1131 tickers × 0.3s sleep = 5+ min, ~28 stocks succeeded) is now
        # the FALLBACK, not the primary path.
        quotes = []
        tv_success = 0
        egx_fallback = 0
        source_used = None

        # ── 3a: Try unified Scanner API FIRST ──
        if SCANNER_API_AVAILABLE:
            scanner_quotes, sc_msg = self.tradingview.fetch_all_via_scanner('egypt')
            if scanner_quotes and len(scanner_quotes) > 0:
                # Enrich with EGXPilot name/sector where available
                for q in scanner_quotes:
                    ref = ref_map.get(q.get('ticker'), {})
                    if ref:
                        if ref.get('name') and not q.get('name'):
                            q['name'] = ref['name']
                        if not q.get('sector') and ref.get('sector'):
                            q['sector'] = ref['sector']
                        if not q.get('eps') and ref.get('eps'):
                            q['eps'] = ref['eps']
                quotes = scanner_quotes
                tv_success = len(scanner_quotes)
                source_used = 'TradingView Scanner'
                self.stats['tradingview_success'] = tv_success
                self.stats['egxpilot_fallback_used'] = 0
                logger.info(f"✅ Scanner API: {tv_success} سهم في طلب واحد (بدلاً من per-ticker loop)")
            else:
                logger.warning(f"⚠️ Scanner API فشل ({sc_msg}) — fallback لـ per-ticker")

        # ── 3b: Fallback — per-ticker tradingview_ta (slow, limited coverage) ──
        if not quotes and TV_AVAILABLE:
            logger.info(f"\n📡 TradingView per-ticker (fallback): جلب لـ {len(tickers)} سهم...")
            import time as _time
            for idx, ticker in enumerate(tickers):
                try:
                    tv_data = self.tradingview._fetch_single(ticker)
                    if tv_data and tv_data.get('current_price') and tv_data['current_price'] > 0:
                        # Enrich with EGXPilot name/sector (authoritative reference)
                        ref = ref_map.get(ticker, {})
                        if ref:
                            if ref.get('name'):
                                tv_data['name'] = ref['name']
                            if not tv_data.get('sector') and ref.get('sector'):
                                tv_data['sector'] = ref['sector']
                            if not tv_data.get('eps') and ref.get('eps'):
                                tv_data['eps'] = ref['eps']
                        quotes.append(tv_data)
                        tv_success += 1
                    else:
                        # TradingView returned nothing → EGXPilot fallback for this ticker
                        ref = ref_map.get(ticker)
                        if ref and ref.get('current_price') and ref['current_price'] > 0:
                            quotes.append(ref)
                            egx_fallback += 1
                        # else: skip (no data from either source)
                    # Rate-limit: 0.3s between requests (avoids TV throttling)
                    if idx % 10 != 9:
                        _time.sleep(0.3)
                    else:
                        _time.sleep(0.5)  # slightly longer pause every 10 tickers
                except Exception as e:
                    logger.debug(f"TV error {ticker}: {e}")
                    ref = ref_map.get(ticker)
                    if ref and ref.get('current_price') and ref['current_price'] > 0:
                        quotes.append(ref)
                        egx_fallback += 1

            logger.info(f"✅ TradingView per-ticker: {tv_success} سهم | EGXPilot fallback: {egx_fallback} سهم")
            source_used = 'TradingView'
            self.stats['tradingview_success'] = tv_success
            self.stats['egxpilot_fallback_used'] = egx_fallback

        # ── 3c: Last resort — EGXPilot entirely (if both scanner + TV failed) ──
        if not quotes:
            logger.warning("⚠️ TradingView (Scanner + per-ticker) فشل — استخدام EGXPilot بالكامل (fallback)")
            quotes = list(ref_map.values()) if ref_map else []
            source_used = 'EGXPilot'
            self.stats['egxpilot_fallback_used'] = len(quotes)

        # Update database
        if quotes:
            updated = self._update_database(quotes)
            self.stats['last_source_used'] = source_used
            self.stats['last_update'] = datetime.now().isoformat()
            self._print_stats(updated, source_used)
            return updated > 0

        # BRAVO-NEVER-HALT (2026-10-27): كل المصادر فشلت (scanner + per-ticker
        # + EGXPilot). المحرك ما بـ crash، بس بـ log heartbeat واضح عشان
        # الـ monitoring يعرف إنه شغال بس ما قدرش يجيب بيانات (external outage).
        logger.error("🚨 [NEVER-HALT] كل المصادر فشلت — 0 سهم متجلب. المحرك شغال بس مفيش بيانات خارجية.")
        logger.error(f"   scanner_available={SCANNER_API_AVAILABLE}, tv_available={TV_AVAILABLE}, egx_ref={len(ref_map)}")
        self._print_stats(0, 'ALL_SOURCES_FAILED')
        return False
    
    def _get_tickers_from_db(self) -> List[str]:
        """Get tickers from database"""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            cursor.execute("SELECT ticker FROM stocks WHERE is_active = 1 OR is_active IS NULL")
            tickers = [row[0] for row in cursor.fetchall()]
            conn.close()
            return tickers
        except Exception as e:
            logger.error(f"خطأ في قراءة التickers: {e}")
            return []
    
    def _update_database(self, quotes: List[Dict]) -> int:
        """Update database with fetched quotes"""
        if not quotes:
            return 0
        
        try:
            # BRAVO-DB-WRITE-FIX (2026-10-27): this method does UPDATE stocks SET ...
            # → MUST open with writable=True. Previously writable=False (readonly)
            # which caused "attempt to write a readonly database" and 0 stocks persisted.
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=True)
            cursor = conn.cursor()
            updated = 0
            
            for quote in quotes:
                # BRAVO-SCANNER-MIGRATION (2026-10-27): use COALESCE for fields
                # the Scanner API doesn't provide (previous_close, open, high,
                # low, pe_ratio, eps, ma_50). When the quote value is NULL, the
                # UPDATE preserves the existing DB value instead of wiping it.
                # current_price / volume / change_percent / sector / rsi / last_update
                # are always overwritten (the scanner provides fresh values for these).
                cursor.execute('''
                    UPDATE stocks SET
                        current_price = ?,
                        previous_close = COALESCE(?, previous_close),
                        open_price = COALESCE(?, open_price),
                        high_price = COALESCE(?, high_price),
                        low_price = COALESCE(?, low_price),
                        volume = ?,
                        change_percent = ?,
                        pe_ratio = COALESCE(?, pe_ratio),
                        eps = COALESCE(?, eps),
                        sector = COALESCE(?, sector),
                        rsi = COALESCE(?, rsi),
                        ma_50 = COALESCE(?, ma_50),
                        last_update = ?,
                        updated_at = datetime('now')
                    WHERE ticker = ?
                ''', (
                    quote.get('current_price'),
                    quote.get('previous_close'),
                    quote.get('open_price'),
                    quote.get('high_price'),
                    quote.get('low_price'),
                    quote.get('volume'),
                    quote.get('price_change'),
                    quote.get('pe_ratio'),
                    quote.get('eps'),
                    quote.get('sector'),
                    quote.get('rsi'),
                    quote.get('sma_50'),
                    quote.get('last_update'),
                    quote.get('ticker')
                ))
                
                if cursor.rowcount > 0:
                    updated += 1
            
            conn.commit()
            conn.close()
            
            logger.info(f"\n✅ تم تحديث {updated} سهم في قاعدة البيانات")
            return updated
            
        except Exception as e:
            logger.error(f"خطأ في تحديث قاعدة البيانات: {e}")
            return 0
    
    def _print_stats(self, updated: int, source_used: Optional[str]):
        """Print update statistics (TV-PRIMARY)"""
        logger.info("\n" + "=" * 60)
        logger.info("📊 إحصائيات التحديث")
        logger.info("=" * 60)
        logger.info(f"  🎯 المصدر المستخدم: {source_used or 'فشل'}")
        logger.info(f"  ✅ TradingView (أساسي): {self.stats['tradingview_success']} سهم")
        logger.info(f"  🔄 EGXPilot fallback: {self.stats['egxpilot_fallback_used']} سهم")
        logger.info(f"  📝 تم تحديث: {updated} سهم")
        logger.info("=" * 60)

    def fetch_single(self, ticker: str) -> Optional[Dict]:
        """Fetch single stock (TV-primary, EGXPilot fallback + name reference).

        For API use — returns rich TradingView data (RSI/SMA) when available,
        enriched with EGXPilot's authoritative name/sector.
        """
        # Build EGXPilot reference map (for name enrichment)
        ref_map: Dict[str, Dict] = {}
        egx_stocks, _ = self.egxpilot.fetch_all_stocks()
        if egx_stocks:
            ref_map = {s.get('ticker'): s for s in egx_stocks if s.get('ticker')}

        # Try TradingView first (PRIMARY)
        if TV_AVAILABLE:
            tv_data = self.tradingview._fetch_single(ticker)
            if tv_data and tv_data.get('current_price') and tv_data['current_price'] > 0:
                # Enrich with EGXPilot name/sector
                ref = ref_map.get(ticker, {})
                if ref:
                    if ref.get('name'):
                        tv_data['name'] = ref['name']
                    if not tv_data.get('sector') and ref.get('sector'):
                        tv_data['sector'] = ref['sector']
                return tv_data

        # Fallback: EGXPilot price for this ticker
        ref = ref_map.get(ticker)
        if ref and ref.get('current_price') and ref['current_price'] > 0:
            return ref

        return None

    def fetch_batch(self, tickers: List[str], delay: float = 0.3) -> Tuple[List[Dict], List[str]]:
        """Fetch batch (TV-primary, EGXPilot fallback per-ticker).

        Compatibility method — uses the same per-ticker fallback strategy
        as update_prices(). Returns (quotes, failed_tickers).
        """
        # Build EGXPilot reference map
        ref_map: Dict[str, Dict] = {}
        egx_stocks, _ = self.egxpilot.fetch_all_stocks()
        if egx_stocks:
            ref_map = {s.get('ticker'): s for s in egx_stocks if s.get('ticker')}

        quotes = []
        failed = []

        if TV_AVAILABLE:
            import time as _time
            for ticker in tickers:
                tv_data = self.tradingview._fetch_single(ticker)
                if tv_data and tv_data.get('current_price') and tv_data['current_price'] > 0:
                    ref = ref_map.get(ticker, {})
                    if ref:
                        if ref.get('name'):
                            tv_data['name'] = ref['name']
                        if not tv_data.get('sector') and ref.get('sector'):
                            tv_data['sector'] = ref['sector']
                    quotes.append(tv_data)
                else:
                    ref = ref_map.get(ticker)
                    if ref and ref.get('current_price') and ref['current_price'] > 0:
                        quotes.append(ref)
                    else:
                        failed.append(ticker)
                _time.sleep(delay)
        else:
            # TV not available — use EGXPilot entirely
            for tk in tickers:
                ref = ref_map.get(tk)
                if ref and ref.get('current_price') and ref['current_price'] > 0:
                    quotes.append(ref)
                else:
                    failed.append(tk)

        return quotes, failed
    
    # =========================================================================
    # EGXPilot Extended Features
    # =========================================================================
    
    def get_ai_analysis(self, ticker: str) -> Optional[Dict]:
        """Get AI analysis for a stock from EGXPilot"""
        return self.egxpilot_ai.analyze_stock(ticker)
    
    def get_ai_batch_analysis(self, tickers: List[str]) -> List[Dict]:
        """Get AI analysis for multiple stocks"""
        return self.egxpilot_ai.analyze_batch(tickers)
    
    def get_latest_news(self, limit: int = 20) -> Optional[List[Dict]]:
        """Get latest market news from EGXPilot"""
        return self.egxpilot_news.fetch_latest_news(limit)
    
    def search_news(self, query: str, limit: int = 10) -> Optional[List[Dict]]:
        """Search news by keyword"""
        return self.egxpilot_news.search_news(query, limit)
    
    def get_golden_opportunities(self, limit: int = 10) -> Optional[List[Dict]]:
        """Get pre-breakout trading opportunities"""
        return self.egxpilot_golden.fetch_opportunities(limit)
    
    def get_system_health(self) -> Optional[Dict]:
        """Check EGXPilot system health"""
        return self.egxpilot_stats.get_health()
    
    def get_source_status(self) -> Dict:
        """Get current source status"""
        return {
            'primary_source': self.stats['primary_source'],  # TradingView
            'reference_source': self.stats.get('reference_source', 'EGXPilot'),
            'last_source_used': self.stats['last_source_used'],
            'last_update': self.stats['last_update'],
            'tradingview_success': self.stats.get('tradingview_success', 0),
            'egxpilot_fallback_used': self.stats.get('egxpilot_fallback_used', 0),
            'egxpilot_available': True,  # Always fetched as reference
            'tradingview_available': TV_AVAILABLE
        }


# ============================================================================
# CONVENIENCE FUNCTION
# ============================================================================

def update_egx_prices(db_path: str) -> bool:
    """Convenience function to update EGX prices"""
    fetcher = EGXDataFetcher(db_path)
    return fetcher.update_prices()


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='EGX Data Fetcher - Unified Dual-Source')
    parser.add_argument('--db', type=str, help='Database path')
    parser.add_argument('--test', action='store_true', help='Test mode')

    args = parser.parse_args()

    # BRAVO-NEVER-HALT (2026-10-27): the entry point MUST NOT crash under any
    # circumstance. Even if everything fails, exit 0 so cron never sees failure.
    try:
        # Get database path
        try:
            from config import DATABASE_PATH
            db_path = args.db or DATABASE_PATH
        except ImportError:
            from pathlib import Path
            _base_dir = Path(__file__).parent.parent.parent.resolve()
            db_path = args.db or str(_base_dir / 'db' / 'stocks.db')

        logger.info(f"Database: {db_path}")

        fetcher = EGXDataFetcher(db_path)
        success = fetcher.update_prices()

        logger.info("\n✅ تم الانتهاء!" if success else "\n⚠️ التحديث لم يكتمل (المحرك شغال — never halts)")
    except Exception as e:
        logger.error(f"🚨 [NEVER-HALT] __main__ crashed (caught): {e}")
        import traceback
        logger.error(traceback.format_exc())
    # ALWAYS exit 0 — the data engine never halts
    sys.exit(0)
