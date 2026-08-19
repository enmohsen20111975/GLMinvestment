#!/usr/bin/env python3
"""
Enhanced Multi-Market Data Fetcher
===================================
نظام جلب البيانات المحسن للأسواق العربية

الأسواق المدعومة:
- السعودية (Tadawul) - KSA
- الكويت (KSE)
- دبي (DFM) + أبوظبي (ADX)
- البحرين (BSE)
- قطر (QSE)
- مصر (EGX) - عبر EGXPilot
- العملات الرقمية (Crypto) - عبر CoinGecko

المصادر:
1. TradingView - للتحليل الفني
2. Yahoo Finance - للأسعار والبيانات التاريخية
3. APIs مباشرة من البورصات (عند توفرها)

Author: GLMinvestment Team
Version: 2.0 - Enhanced Multi-Source
"""

import sys
import os
import time
import sqlite3
import logging
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
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

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Try imports
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    from tradingview_ta import TA_Handler, Interval
    TV_AVAILABLE = True
    logger.info("✓ TradingView TA available")
except ImportError:
    TV_AVAILABLE = False
    logger.warning("✗ TradingView TA not available")

# Try yfinance
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
    logger.info("✓ Yahoo Finance available")
except ImportError:
    YFINANCE_AVAILABLE = False
    logger.warning("✗ Yahoo Finance not available")

# ============================================================================
# MARKET CONFIGURATION
# ============================================================================

MARKET_CONFIG = {
    'EGX': {
        'name': 'Egypt Stock Exchange',
        'name_ar': 'البورصة المصرية',
        'currency': 'EGP',
        'timezone': 'Africa/Cairo',
        'trading_hours': {'start': '10:00', 'end': '14:30'},
        'tv_screener': 'egypt',
        'tv_exchange': 'EGX',
        'yf_suffix': '.CA',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['egxpilot', 'tradingview', 'yfinance'],
    },
    'KSA': {
        'name': 'Saudi Stock Exchange (Tadawul)',
        'name_ar': 'سوق الأسهم السعودي',
        'currency': 'SAR',
        'timezone': 'Asia/Riyadh',
        'trading_hours': {'start': '10:00', 'end': '15:00'},
        'tv_screener': 'saudi',
        'tv_exchange': 'Tadawul',
        'yf_suffix': '.SR',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['tradingview', 'yfinance'],
    },
    'KSE': {
        'name': 'Kuwait Stock Exchange',
        'name_ar': 'سوق الكويت للأوراق المالية',
        'currency': 'KWD',
        'timezone': 'Asia/Kuwait',
        'trading_hours': {'start': '09:00', 'end': '13:15'},
        'tv_screener': 'kuwait',
        'tv_exchange': 'KSE',
        'yf_suffix': '.KW',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['tradingview', 'yfinance'],
    },
    'DFM': {
        'name': 'Dubai Financial Market',
        'name_ar': 'سوق دبي المالي',
        'currency': 'AED',
        'timezone': 'Asia/Dubai',
        'trading_hours': {'start': '10:00', 'end': '14:00'},
        'tv_screener': 'dubai',
        'tv_exchange': 'DFM',
        'yf_suffix': '.AE',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['tradingview', 'yfinance'],
    },
    'ADX': {
        'name': 'Abu Dhabi Securities Exchange',
        'name_ar': 'سوق أبوظبي للأوراق المالية',
        'currency': 'AED',
        'timezone': 'Asia/Dubai',
        'trading_hours': {'start': '10:00', 'end': '14:00'},
        'tv_screener': 'abdhabi',
        'tv_exchange': 'ADX',
        'yf_suffix': '.AE',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['tradingview', 'yfinance'],
    },
    'BSE': {
        'name': 'Bahrain Stock Exchange',
        'name_ar': 'سوق البحرين للأوراق المالية',
        'currency': 'BHD',
        'timezone': 'Asia/Bahrain',
        'trading_hours': {'start': '09:30', 'end': '13:30'},
        'tv_screener': 'bahrain',
        'tv_exchange': 'BSE',
        'yf_suffix': '.BH',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['tradingview', 'yfinance'],
    },
    'QSE': {
        'name': 'Qatar Stock Exchange',
        'name_ar': 'سوق قطر للأوراق المالية',
        'currency': 'QAR',
        'timezone': 'Asia/Qatar',
        'trading_hours': {'start': '09:00', 'end': '13:00'},
        'tv_screener': 'qatar',
        'tv_exchange': 'QSE',
        'yf_suffix': '.QA',  # Yahoo Finance suffix — for API calls ONLY, NEVER stored
        'sources': ['tradingview', 'yfinance'],
    },
    'CRYPTO': {
        'name': 'Cryptocurrency Market',
        'name_ar': 'سوق العملات الرقمية',
        'currency': 'USD',
        'timezone': 'UTC',
        'trading_hours': {'start': '00:00', 'end': '23:59'},
        'tv_screener': 'crypto',
        'tv_exchange': 'BINANCE',
        'sources': ['coingecko', 'tradingview'],
    },
}

# Popular stocks per market for quick access (expanded lists)
POPULAR_STOCKS = {
    # السعودية - Tadawul (أهم 50 سهم)
    'KSA': [
        # البنوك
        '1120',  # Al Rajhi Bank (أكبر بنك إسلامي)
        '1180',  # National Bank of Saudi Arabia
        '1020',  # Saudi British Bank (SABB)
        '1060',  # Saudi Investment Bank
        '1210',  # Riyad Bank
        '1150',  # Saudi National Bank
        # البتروكيماويات
        '2222',  # Saudi Aramco (أكبر شركة)
        '2002',  # Saudi Kayan
        '2010',  # SABIC
        '2020',  # Yanbu National Petrochemical
        '2380',  # Saudi Basic Industries
        # الاتصالات
        '7010',  # Saudi Telecom (STC)
        '8110',  # Etihad Etisalat (Mobily)
        '7030',  # Zain Saudi
        # التجزئة
        '4160',  # Jarir Marketing
        '4170',  # Al Othaim Markets
        '4200',  # Extra
        # العقارات
        '4320',  # Dar Al Arkan
        '4150',  # Emaar Economic City
        # التأمين
        '8070',  # Bupa Arabia
        '8010',  # Tawuniya
        '8080',  # Al Rajhi Takaful
        # الأسمنت
        '3040',  # Saudi Cement
        '3050',  # Yanbu Cement
        '3060',  # Qassim Cement
        # الزراعة
        '6010',  # Almarai
        '6020',  # Savola Group
        '6030',  # Al Safi Danone
        # أخرى
        '4002',  # Saudi Real Estate
        '4161',  # Al Hokair
        '2170',  # Aldrees Petroleum
        '3100',  # Saudi Steel Pipe
        '4330',  # Knowledge Economic City
        '4190',  # Al Kifah Holding
        '1320',  # Sipchem
        '1201',  # Banque Saudi Fransi
        '1830',  # Nama Chemicals
        '4140',  # Fawaz Abdulaziz Alhokair
        '5110',  # Saudi Arabian Amiantit
        '2280',  # Rabigh Refining
        '2090',  # Sahara International Petrochemical
        '2370',  # National Petrochemical
        '4004',  # Taiba Investments
        '1831',  # Chemanol
        '1300',  # Saudi Industrial Investment
        '2320',  # Saudi Arabian Fertilizer
        '5170',  # Abdullah A M Al Khodari
        '4100',  # Red Sea International
        '2200',  # Saudi Aramco Base Oil
    ],
    
    # الكويت - KSE
    'KSE': [
        'BURG',   # Burgan Bank
        'MEEM',   # Meemz
        'KFI',    # Kuwait Finance House
        'ALKOUT', # Al Kout Industrial
        'AMERICANA',  # Americana Restaurants
        'NATIONAL',   # National Bank of Kuwait
        'GULF',   # Gulf Bank
        'KPC',    # Kuwait Petroleum Corp
        'BOUBYAN',  # Boubyan Bank
        'KUWAIT',   # Kuwait Stock Exchange
        'ZAIN',   # Zain Kuwait
        'OOREDOO',  # Ooredoo Kuwait
        'AGRICULTURE',  # Kuwait Agriculture
        'BOUBYAN',  # Boubyan Petrochemicals
        'KIAN',   # Kian Petroleum
        'REAL',   # Kuwait Real Estate
        'INVEST',  # Kuwait Investment
        'KUWAITI',  # Kuwaiti Company
        'AAYAN',  # Aayan Leasing
        'KSC',    # Kuwait Swedish Company
        'ALAM',   # Al Alam
        'SAF',    # Safat Energy
        'KRE',    # Kuwait Real Estate
        'GRAND',  # Grand Hotels
        'HAJJI',  # Al Hajji
        'BAYAN',  # Bayan Investment
        'JAZEERA',  # Al Jazeera Finance
        'AQARIA',  # Aqaria
        'MUSHRIK',  # Al Mushrik
        'FIRST',  # First Takaful
    ],
    
    # دبي - DFM
    'DFM': [
        'DFM',      # Dubai Financial Market
        'EMAAR',    # Emaar Properties
        'DIB',      # Dubai Islamic Bank
        'ARABTEC',  # Arabtec Construction
        'DU',       # Emirates Integrated Telecom
        'AIRARABIA',  # Air Arabia
        'DAMAC',    # DAMAC Properties
        'UNION',    # Union Properties
        'GULFNAV',  # Gulf Navigation
        'SHUAA',    # Shuaa Capital
        'Deyaar',   # Deyaar Development
        'EMAAR',    # Emaar Development
        'AMAN',     # Aman Holding
        'ICC',      # International Cement
        'ALKHALEEJ',  # Al Khaleej Sugar
        'TABREED',  # Tabreed
        'AJMANBANK',  # Ajman Bank
        'GEO',      # Gulf Energy
        'DRI',      # Drake & Scull
        'TAKAFUL',  # Dubai Islamic Insurance
        'MASHREQ',  # Mashreq Bank
        'Commercial',  # Commercial Bank of Dubai
        'Dubai',    # Dubai Investments
        'UAE',      # UAE Exchange
        'MARINA',   # Dubai Marina
    ],
    
    # أبوظبي - ADX
    'ADX': [
        'ADCB',     # Abu Dhabi Commercial Bank
        'ADNOC',    # ADNOC Distribution
        'ETISALAT',  # Emirates Telecommunications
        'FAB',      # First Abu Dhabi Bank
        'ALDAR',    # Aldar Properties
        'TAQA',     # TAQA
        'ADNH',     # Abu Dhabi National Hotels
        'Waha',     # Waha Capital
        'RAKBANK',  # National Bank of Ras Al Khaimah
        'UNION',    # Union National Bank
        'DANA',     # Dana Gas
        'GULF',     # Gulf Cement
        'AGTHIA',   # Agthia Group
        'ARAM',     # Aramex
        'TABREED',  # National Central Cooling
        'ISLAMIC',  # Abu Dhabi Islamic Bank
        'ROTANA',   # Rotana Hotels
        'ABUDHABI',  # Abu Dhabi Aviation
        'FOUR',     # Fourwinds
        'NATIONAL',  # National Bank of Abu Dhabi
        'SUDAR',    # Sudan Telecom
        'RAKPROPERTIES',  # Ras Al Khaimah Properties
        'RAKCERAMIC',  # RAK Ceramics
        'GULFNAV',  # Gulf Navigation
        'EATEL',    # Emirates Integrated Telecom
        'CITY',     # Abu Dhabi City
        'METHAQ',   # Methaq Takaful
        'NAS',      # National Security Services
        'MANASEK',  # Manasek
        'FOOD',     # Foodco Holding
    ],
    
    # البحرين - BSE
    'BSE': [
        'BBK',      # BBK (Bank of Bahrain and Kuwait)
        'ALBA',     # Aluminum Bahrain
        'BATBCO',   # Bahrain Telecommunications
        'NHPC',     # National Housing
        'BMMI',     # BMMI
        'YBAAT',    # YBAAT
        'SALAM',    # Salam International
        'GBCORP',   # Gulf Banking Corporation
        'INOVCELL',  # Inovcell
        'BAPCO',    # Bahrain Petroleum
        'AIN',      # AIN
        'ZAINBH',   # Zain Bahrain
        'NASS',     # Nass Corporation
        'TAIB',     # Taib Bank
        'ARCAP',    # Arab Banking Corporation
        'ABCAP',    # Arab Banking Corp
        'BHTRUST',  # Bahrain Trust
        'GBI',      # Gulf Business International
        'BARKA',    # Al Barka
        'SEIB',     # SEIB Insurance
        'DELTA',    # Delta Trading
    ],
    
    # قطر - QSE
    'QSE': [
        'QNB',      # Qatar National Bank
        'INDUSTRY',  # Industries Qatar
        'OOREDOO',  # Ooredoo Qatar
        'COMMERCIAL',  # Commercial Bank of Qatar
        'ISLAMIC',  # Qatar Islamic Bank
        'BARWA',    # Barwa Real Estate
        'ZAD',      # Zad Holding
        'VODAFONE',  # Vodafone Qatar
        'NAKILAT',  # Nakilat
        'MANNAI',   # Mannai Corporation
        'MASRAF',   # Masraf Al Rayan
        'QATAR',    # Qatar Insurance
        'DOHA',     # Doha Bank
        'ALISRAA',  # Al Israa
        'AKHAI',    # Akhai Healthcare
        'ALKHALIJI',  # Al Khaliji Bank
        'QEWC',     # Qatar Electricity & Water
        'QLM',      # QLM Life Insurance
        'MESAIEED',  # Mesaieed Petrochemical
        'WOQOD',    # Woqod
        'EZDAN',    # Ezdan Real Estate
        'GDI',      # Gulf Drilling International
        'QAMCO',    # Qatar Aluminum
        'QIM',      # Qatar Industrial Manufacturing
        'DLC',      # Doha Logistics
    ],
}

# ============================================================================
# DATA SOURCE CLASSES
# ============================================================================

class TradingViewSource:
    """TradingView data source"""
    
    def __init__(self):
        self.name = "TradingView"
        self.rate_limit_delay = 0.5
    
    def fetch_stock(self, ticker: str, market: str) -> Optional[Dict]:
        """Fetch single stock from TradingView"""
        if not TV_AVAILABLE:
            return None
        
        config = MARKET_CONFIG.get(market)
        if not config:
            return None
        
        try:
            handler = TA_Handler(
                symbol=ticker,
                screener=config['tv_screener'],
                exchange=config['tv_exchange'],
                interval=Interval.INTERVAL_1_DAY
            )
            
            analysis = handler.get_analysis()
            if not analysis:
                return None
            
            indicators = analysis.indicators
            price = indicators.get('close', 0)
            prev_close = indicators.get('previous_close', price)
            
            change_pct = 0
            if prev_close and price and prev_close > 0:
                change_pct = ((price - prev_close) / prev_close) * 100
            
            return {
                'ticker': ticker,
                'market': market,
                'current_price': round(price, 4) if price else None,
                'previous_close': round(prev_close, 4) if prev_close else None,
                'open_price': round(indicators.get('open', price), 4),
                'high_price': round(indicators.get('high', price), 4),
                'low_price': round(indicators.get('low', price), 4),
                'volume': parse_volume(indicators.get('volume', 0)),
                'price_change': round(change_pct, 4),
                'rsi': round(indicators.get('RSI', 0), 2) if indicators.get('RSI') else None,
                'ma_20': round(indicators.get('SMA20', 0), 4) if indicators.get('SMA20') else None,
                'ma_50': round(indicators.get('SMA50', 0), 4) if indicators.get('SMA50') else None,
                'ma_200': round(indicators.get('SMA200', 0), 4) if indicators.get('SMA200') else None,
                'macd': round(indicators.get('MACD.macd', 0), 6) if indicators.get('MACD.macd') else None,
                'recommendation': analysis.summary.get('RECOMMENDATION', 'NEUTRAL'),
                'last_update': datetime.now().isoformat(),
                'source': 'tradingview',
            }
        except Exception as e:
            logger.debug(f"TradingView error for {ticker}: {e}")
            return None
    
    def fetch_batch(self, tickers: List[str], market: str, delay: float = None) -> List[Dict]:
        """Fetch multiple stocks"""
        results = []
        delay = delay or self.rate_limit_delay
        
        for ticker in tickers:
            data = self.fetch_stock(ticker, market)
            if data:
                results.append(data)
            time.sleep(delay)
        
        return results


class YahooFinanceSource:
    """Yahoo Finance data source"""
    
    def __init__(self):
        self.name = "YahooFinance"
    
    def fetch_stock(self, ticker: str, market: str) -> Optional[Dict]:
        """Fetch single stock from Yahoo Finance"""
        if not YFINANCE_AVAILABLE:
            return None
        
        config = MARKET_CONFIG.get(market)
        if not config:
            return None
        
        try:
            # Build Yahoo symbol
            yf_symbol = f"{ticker}{config.get('yf_suffix', '')}"
            
            stock = yf.Ticker(yf_symbol)
            info = stock.info
            
            if not info:
                return None
            
            price = info.get('currentPrice') or info.get('regularMarketPrice')
            prev_close = info.get('previousClose') or info.get('regularMarketPreviousClose')
            
            change_pct = 0
            if prev_close and price and prev_close > 0:
                change_pct = ((price - prev_close) / prev_close) * 100
            
            return {
                'ticker': ticker,
                'market': market,
                'name': info.get('longName') or info.get('shortName'),
                'current_price': round(price, 4) if price else None,
                'previous_close': round(prev_close, 4) if prev_close else None,
                'open_price': round(info.get('open', price), 4) if info.get('open') else None,
                'high_price': round(info.get('dayHigh', price), 4) if info.get('dayHigh') else None,
                'low_price': round(info.get('dayLow', price), 4) if info.get('dayLow') else None,
                'volume': parse_volume(info.get('volume', 0)),
                'price_change': round(change_pct, 4),
                'market_cap': info.get('marketCap'),
                'pe_ratio': info.get('trailingPE'),
                'forward_pe': info.get('forwardPE'),
                'dividend_yield': info.get('dividendYield'),
                'beta': info.get('beta'),
                '52_week_high': info.get('fiftyTwoWeekHigh'),
                '52_week_low': info.get('fiftyTwoWeekLow'),
                'last_update': datetime.now().isoformat(),
                'source': 'yfinance',
            }
        except Exception as e:
            logger.debug(f"Yahoo Finance error for {ticker}: {e}")
            return None
    
    def fetch_historical(self, ticker: str, market: str, days: int = 365) -> List[Dict]:
        """Fetch historical data"""
        if not YFINANCE_AVAILABLE:
            return []
        
        config = MARKET_CONFIG.get(market)
        if not config:
            return []
        
        try:
            yf_symbol = f"{ticker}{config.get('yf_suffix', '')}"
            stock = yf.Ticker(yf_symbol)
            
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            
            hist = stock.history(start=start_date, end=end_date)
            
            results = []
            for index, row in hist.iterrows():
                results.append({
                    'ticker': ticker,
                    'market': market,
                    'date': index.strftime('%Y-%m-%d'),
                    'open': round(row['Open'], 4),
                    'high': round(row['High'], 4),
                    'low': round(row['Low'], 4),
                    'close': round(row['Close'], 4),
                    'volume': parse_volume(row['Volume']),
                })
            
            return results
        except Exception as e:
            logger.debug(f"Historical data error for {ticker}: {e}")
            return []
    
    def fetch_batch(self, tickers: List[str], market: str) -> List[Dict]:
        """Fetch multiple stocks"""
        results = []
        for ticker in tickers:
            data = self.fetch_stock(ticker, market)
            if data:
                results.append(data)
            time.sleep(0.1)
        return results


class CoinGeckoSource:
    """CoinGecko data source for cryptocurrencies"""
    
    def __init__(self):
        self.name = "CoinGecko"
        self.base_url = "https://api.coingecko.com/api/v3"
    
    def fetch_top_cryptos(self, limit: int = 100) -> List[Dict]:
        """Fetch top cryptocurrencies"""
        try:
            url = f"{self.base_url}/coins/markets"
            params = {
                'vs_currency': 'usd',
                'order': 'market_cap_desc',
                'per_page': limit,
                'sparkline': 'false'
            }
            
            response = requests.get(url, params=params, timeout=30)
            if response.status_code != 200:
                return []
            
            data = response.json()
            results = []
            
            for item in data:
                results.append({
                    'ticker': item['symbol'].upper(),
                    'name': item['name'],
                    'coin_id': item['id'],
                    'market': 'CRYPTO',
                    'current_price': item['current_price'],
                    'previous_close': item.get('current_price', 0) - item['price_change_24h'] if item.get('price_change_24h') else None,
                    'price_change': round(item['price_change_percentage_24h'], 4) if item.get('price_change_percentage_24h') else 0,
                    'high_price': item['high_24h'],
                    'low_price': item['low_24h'],
                    'volume': parse_volume(item['total_volume']),
                    'market_cap': item['market_cap'],
                    'market_cap_rank': item['market_cap_rank'],
                    'circulating_supply': item.get('circulating_supply'),
                    'total_supply': item.get('total_supply'),
                    'ath': item.get('ath'),
                    'atl': item.get('atl'),
                    'last_update': datetime.now().isoformat(),
                    'source': 'coingecko',
                })
            
            return results
        except Exception as e:
            logger.error(f"CoinGecko error: {e}")
            return []
    
    def fetch_crypto(self, coin_id: str) -> Optional[Dict]:
        """Fetch single cryptocurrency"""
        try:
            url = f"{self.base_url}/coins/{coin_id}"
            params = {
                'localization': 'false',
                'tickers': 'false',
                'market_data': 'true',
                'community_data': 'false',
                'developer_data': 'false'
            }
            
            response = requests.get(url, params=params, timeout=30)
            if response.status_code != 200:
                return None
            
            data = response.json()
            market_data = data.get('market_data', {})
            
            return {
                'ticker': data['symbol'].upper(),
                'name': data['name'],
                'coin_id': data['id'],
                'market': 'CRYPTO',
                'current_price': market_data.get('current_price', {}).get('usd'),
                'price_change': round(market_data.get('price_change_percentage_24h', 0), 4),
                'high_price': market_data.get('high_24h', {}).get('usd'),
                'low_price': market_data.get('low_24h', {}).get('usd'),
                'volume': parse_volume(market_data.get('total_volume', {}).get('usd', 0)),
                'market_cap': market_data.get('market_cap', {}).get('usd'),
                'last_update': datetime.now().isoformat(),
                'source': 'coingecko',
            }
        except Exception as e:
            logger.error(f"CoinGecko error for {coin_id}: {e}")
            return None


# ============================================================================
# MAIN FETCHER CLASS
# ============================================================================

class EnhancedMultiMarketFetcher:
    """
    Enhanced Multi-Market Data Fetcher
    محرك جلب البيانات المحسن للأسواق العربية
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        
        # Initialize sources
        self.tradingview = TradingViewSource() if TV_AVAILABLE else None
        self.yfinance = YahooFinanceSource() if YFINANCE_AVAILABLE else None
        self.coingecko = CoinGeckoSource() if REQUESTS_AVAILABLE else None
        
        # Stats
        self.stats = {
            'success': 0,
            'failed': 0,
            'no_data': 0,
            'errors': [],
        }
    
    def get_available_sources(self) -> Dict[str, bool]:
        """Get available data sources"""
        return {
            'tradingview': TV_AVAILABLE,
            'yfinance': YFINANCE_AVAILABLE,
            'coingecko': REQUESTS_AVAILABLE,
        }
    
    def fetch_stock(self, ticker: str, market: str, source: str = 'auto') -> Optional[Dict]:
        """
        Fetch single stock from specified or best available source
        
        Args:
            ticker: Stock ticker
            market: Market code (KSA, KSE, DFM, etc.)
            source: 'auto', 'tradingview', 'yfinance'
        
        Returns:
            Dict with stock data or None
        """
        config = MARKET_CONFIG.get(market)
        if not config:
            logger.warning(f"Unknown market: {market}")
            return None
        
        # Determine source order
        if source == 'auto':
            sources = config['sources']
        else:
            sources = [source]
        
        for src in sources:
            if src == 'tradingview' and self.tradingview:
                data = self.tradingview.fetch_stock(ticker, market)
                if data:
                    return data
            
            elif src == 'yfinance' and self.yfinance:
                data = self.yfinance.fetch_stock(ticker, market)
                if data:
                    return data
        
        return None
    
    def fetch_market_stocks(self, market: str, limit: int = 50) -> List[Dict]:
        """
        Fetch popular stocks for a market
        
        Args:
            market: Market code
            limit: Max stocks to fetch
        
        Returns:
            List of stock data
        """
        config = MARKET_CONFIG.get(market)
        if not config:
            return []
        
        tickers = POPULAR_STOCKS.get(market, [])[:limit]
        if not tickers:
            logger.warning(f"No popular stocks defined for {market}")
            return []
        
        results = []
        
        # Try TradingView first
        if self.tradingview:
            for ticker in tickers:
                data = self.tradingview.fetch_stock(ticker, market)
                if data:
                    results.append(data)
                    self.stats['success'] += 1
                else:
                    self.stats['no_data'] += 1
                time.sleep(0.3)
        
        # Fill missing with Yahoo Finance
        if self.yfinance and len(results) < len(tickers):
            fetched_tickers = {r['ticker'] for r in results}
            missing = [t for t in tickers if t not in fetched_tickers]
            
            for ticker in missing:
                data = self.yfinance.fetch_stock(ticker, market)
                if data:
                    results.append(data)
                    self.stats['success'] += 1
                time.sleep(0.1)
        
        return results
    
    def fetch_historical(self, ticker: str, market: str, days: int = 365) -> List[Dict]:
        """Fetch historical data for a stock"""
        if self.yfinance:
            return self.yfinance.fetch_historical(ticker, market, days)
        return []
    
    def fetch_crypto_top(self, limit: int = 100) -> List[Dict]:
        """Fetch top cryptocurrencies"""
        if self.coingecko:
            return self.coingecko.fetch_top_cryptos(limit)
        return []
    
    def update_database(self, markets: List[str] = None) -> Dict:
        """
        Update database with fresh data from all markets
        
        Args:
            markets: List of markets to update (None = all)
        
        Returns:
            Stats dict
        """
        if not self.db_path:
            logger.error("No database path specified")
            return {'error': 'No database path'}
        
        markets = markets or list(MARKET_CONFIG.keys())
        
        logger.info("\n" + "=" * 60)
        logger.info("📊 تحديث بيانات الأسواق العربية")
        logger.info("=" * 60)
        
        total_updated = 0
        
        for market in markets:
            if market == 'CRYPTO':
                # Handle crypto separately
                cryptos = self.fetch_crypto_top(100)
                logger.info(f"✓ CRYPTO: {len(cryptos)} عملة")
                total_updated += len(cryptos)
            elif market == 'EGX':
                # EGX handled by EGXPilot
                logger.info("⏭ EGX: يتطلب EGXPilot (استخدم egx_fetcher)")
            else:
                stocks = self.fetch_market_stocks(market)
                logger.info(f"✓ {market}: {len(stocks)} سهم")
                total_updated += len(stocks)
        
        logger.info(f"\n📊 الإجمالي: {total_updated} عنصر")
        
        return {
            'total_updated': total_updated,
            'stats': self.stats
        }
    
    def get_market_info(self, market: str) -> Optional[Dict]:
        """Get market information"""
        return MARKET_CONFIG.get(market)
    
    def get_all_markets(self) -> Dict[str, Dict]:
        """Get all market configurations"""
        return MARKET_CONFIG


# ============================================================================
# API HELPER FUNCTIONS
# ============================================================================

def get_fetcher(db_path: str = None) -> EnhancedMultiMarketFetcher:
    """Get configured fetcher instance"""
    return EnhancedMultiMarketFetcher(db_path)


def fetch_quote(ticker: str, market: str) -> Optional[Dict]:
    """Quick quote fetch"""
    fetcher = EnhancedMultiMarketFetcher()
    return fetcher.fetch_stock(ticker, market)


def fetch_market(market: str, limit: int = 20) -> List[Dict]:
    """Quick market fetch"""
    fetcher = EnhancedMultiMarketFetcher()
    return fetcher.fetch_market_stocks(market, limit)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Enhanced Multi-Market Data Fetcher')
    parser.add_argument('--market', type=str, help='Market code (KSA, KSE, DFM, etc.)')
    parser.add_argument('--ticker', type=str, help='Single ticker to fetch')
    parser.add_argument('--historical', action='store_true', help='Fetch historical data')
    parser.add_argument('--days', type=int, default=365, help='Days of historical data')
    parser.add_argument('--limit', type=int, default=20, help='Limit per market')
    parser.add_argument('--sources', action='store_true', help='Show available sources')
    
    args = parser.parse_args()
    
    fetcher = EnhancedMultiMarketFetcher()
    
    if args.sources:
        print("\n📊 Available Data Sources:")
        for source, available in fetcher.get_available_sources().items():
            status = "✅" if available else "❌"
            print(f"  {status} {source}")
        print("\n📋 Supported Markets:")
        for market, config in MARKET_CONFIG.items():
            print(f"  • {market}: {config['name_ar']} ({config['name']})")
    
    elif args.ticker and args.market:
        if args.historical:
            data = fetcher.fetch_historical(args.ticker, args.market, args.days)
            print(f"\n📊 Historical data for {args.ticker} ({args.market}):")
            for d in data[-5:]:
                print(f"  {d['date']}: {d['close']}")
        else:
            data = fetcher.fetch_stock(args.ticker, args.market)
            if data:
                print(f"\n📊 {args.ticker} ({args.market}):")
                print(f"  Price: {data.get('current_price')}")
                print(f"  Change: {data.get('price_change')}%")
                print(f"  Volume: {data.get('volume')}")
            else:
                print(f"❌ No data for {args.ticker}")
    
    elif args.market:
        stocks = fetcher.fetch_market_stocks(args.market, args.limit)
        print(f"\n📊 {args.market} Stocks:")
        for s in stocks:
            print(f"  • {s['ticker']}: {s.get('current_price')} ({s.get('price_change')}%)")
    
    else:
        parser.print_help()
