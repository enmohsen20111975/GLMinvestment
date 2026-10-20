#!/usr/bin/env python3
"""
EGKSCO Scraper - Stocks and Reports
====================================
يجلب بيانات الأسهم والتوقعات من egksco-online.com

Features:
- بيانات الأسهم (تحديث كل 15 دقيقة)
- تحميل تقارير التوقعات PDF
- حفظ في قاعدة البيانات مباشرة
- دمج مع النظام الأساسي
- ربط الأسماء العربية بالرموز الإنجليزية

Author:M2yDevelopers Team
Version: 3.0.0 - Fixed Symbol Matching
"""

import os
import re
import csv
import json
import sqlite3
import subprocess
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

EGKSCO_SECTORS_URL = "https://egksco-online.com/etrade/Sectors.aspx"
EGKSCO_REPORTS_URL = "https://egksco-online.com/etrade/Reports/RecomReports.aspx"
EGKSCO_PDF_BASE = "https://egksco-online.com/etrade/Reports/openFile.aspx"
EGKSCO_STOCK_URL = "https://egksco-online.com/etrade/Stock.aspx?Code={symbol}.CA"

DATA_DIR = Path(__file__).parent.parent / 'data' / 'egksco'

try:
    from config import DATABASE_PATH, PRICE_HISTORY_DB_PATH
except ImportError:
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
    PRICE_HISTORY_DB_PATH = str(_base_dir / 'db' / 'price_history.db')


# ============================================================================
# SYMBOL MAPPING - Arabic to English
# ============================================================================

# Known mappings from database (Arabic name -> English symbol)
SYMBOL_MAPPINGS = {
    # Common stocks
    'النيل للودائع والصناديق الاستثمارية': 'ODHN',
    'مدينة نصر للإسكان والتعمير': 'MNHD',
    'مصر لل الألمونيوم': 'EGAL',
    'مصر للألمنيوم': 'EGAL',
    'القاهرة للإسكان والتعمير': 'ETRS',
    'القاهرة للخدمات المالية': 'CIRA',
    'مجموعة طلعت مصطفى': 'TMGH',
    'الإسكندرية للتجارة والتعدين': 'ATCM',
    'الإسكندرية للخدمات البترولية': 'APOT',
    'المتحدة للإسكان والتعمير': 'UNHI',
    'الوطنية للأسمنت': 'NCEM',
    'السويس للأسمنت': 'SUCE',
    'طنطا للأسمنت': 'TNCE',
    'بنك مصر': 'BMIE',
    'بنك القاهرة': 'CAIE',
    'البنك الأهلي المصري': 'NBEF',
    'البنك التجاري الدولي': 'COMI',
    'بنك كريدي أجريكول': 'CIEB',
    'بنك عوده': 'ODEI',
    'بنك قناة السويس': 'SUEZ',
    'البنك العقاري المصري العربي': 'ABKI',
    'المتحدة للاسكان والتعمير': 'UNHI',
    'المصرف العربي الدولي': 'AIBK',
    'مجموعة الخليج المالية': 'GFCO',
    'أوراسكوم للتنمية': 'ORAS',
    'أوراسكوم للإنشاءات': 'ORCI',
    'أوراسكوم للصناعات': 'ORIN',
    'الشرقية للدخان': 'EAST',
    'العربية لحليج الأقطان': 'AIMC',
    'مصر للاسمنت': 'MCEM',
    'مجموعة شركات محمد عبد الرحمن البحري': 'MARZ',
    'إيستك للنقل': 'ESTR',
    'موبكو': 'MOIC',
    'سيدي كرير للبتروكيماويات': 'SKPC',
    'إيفرست للتجارة': 'EVER',
    'الشمس للإسكان والتعمير': 'SHMA',
    'الصعيد العامة للمقاولات': 'SIOC',
    'الأهلي للتطوير والاستثمار': 'ADI',
    'مبارك للقماش': 'MBQC',
    'مصنع حديد عز': 'ESRS',
    'حديد عز': 'ESRS',
    'شمال أفريقيا للتجارة': 'NATC',
    'بيك للتجارة': 'PIEC',
    'توك توك للتجارة': 'TTIE',
    'مدينة السادات للتعمير': 'SDMC',
    'الإسكندرية新一代': 'AVMA',
    'مصر للمقاصة': 'MCLR',
    'المالية والصناعية المصرية': 'EFIH',
    'سوديك': 'SODIC',
    'هيرميس': 'HRMI',
    'البنك المصري لتنمية الصادرات': 'EDBE',
    'القاهرة بني سويف للأسمنت': 'CCBN',
    'جنوب الوادي للأسمنت': 'SVCE',
    'العريش للأسمنت': 'ARCE',
    'سيناء للأسمنت': 'SINW',
    'النصر للأعمال المدنية': 'ACSC',
    'المقاولون العرب': 'ARCO',
    'حسن علام': 'HALM',
    'المصرية للدواجن': 'AICM',
    'ميركوري': 'MERY',
    'جراند': 'GRTO',
    'المتحدة للصناعات': 'UNIND',
    'فاركو للبترول': 'FRCA',
    'الإسكندرية للزيوت': 'AOI',
    'مصر للطيران': 'EGFC',
    'القابضة المالية المصرية': 'EFIH',
    'إعمار للمقاولات': 'MARZ',
    'الوطنية للأسمنت': 'NCEM',
    'السويدي': 'SWDY',
    'المصري للاتصالات': 'ETEL',
    'أورنج': 'ORWE',
    'فودافون': 'VODE',
    'الغاز الطبيعي': 'GASC',
    'بتروجيت': 'PTGE',
    'ENPPI': 'ENPI',
    'القناة لتوكيلات الملاحة': 'CTSH',
    'الإسكندرية للملاحة': 'AMSC',
    'العامة للملاحة': 'NSRS',
    'المتحدة للخدمات': 'USRI',
    'الراعية للدواجن': 'SAPI',
    'مصر للألبان': 'AMOC',
    'القاهرة للدواجن': 'AICO',
    'المعادي': 'AMAI',
    'الأهرام': 'AHRM',
    'الأمل للتجارة': 'AMAL',
    'الجزيرة للتجارة': 'JZRT',
    'النصر للملابس': 'NRTC',
    'السويس للبترول': 'SUPE',
    'الإسكندرية للبترول': 'APOT',
    'الغربية للأسمنت': 'GCEM',
    'دمنهور للأسمنت': 'DACE',
    'أسمنت أسيوط': 'ASCE',
    'أسمنت بني سويف': 'BNSE',
    'أسمنت طنطا': 'TNCE',
    'أسمنت سيناء': 'SINW',
    'أسمنت السويس': 'SUCE',
    'أسمنت الكوفة': 'KUFC',
}

# ============================================================================
# DATABASE HELPER
# ============================================================================

class EGKSCODatabase:
    """يدير حفظ واسترجاع بيانات EGKSCO في قاعدة البيانات"""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DATABASE_PATH
        
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        # Enable WAL mode for better concurrency
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')  # 30 seconds
            conn.execute('PRAGMA synchronous=NORMAL')
        except Exception as e:
            logger.debug(f"Could not set WAL mode: {e}")
        return conn
    
    def init_tables(self):
        """إنشاء الجداول المطلوبة"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # جدول بيانات EGKSCO
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS egksco_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT UNIQUE NOT NULL,
                name TEXT,
                name_ar TEXT,
                last_price REAL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                prev_close REAL,
                change_pct REAL,
                volume INTEGER,
                value REAL,
                trades_count INTEGER,
                last_update TEXT,
                source TEXT DEFAULT 'egksco',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # جدول تاريخ الأسعار
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS egksco_price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                value REAL,
                source TEXT DEFAULT 'egksco',
                UNIQUE(symbol, date)
            )
        ''')
        
        # جدول حالة المزامنة
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS egksco_sync_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                status TEXT NOT NULL,
                stocks_count INTEGER DEFAULT 0,
                new_stocks INTEGER DEFAULT 0,
                updated_stocks INTEGER DEFAULT 0,
                errors INTEGER DEFAULT 0,
                duration_seconds REAL,
                message TEXT,
                sync_time TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
        logger.info("✓ EGKSCO tables initialized")
    
    def get_stock_symbols_from_db(self) -> Dict[str, str]:
        """جلب الرموز والأسماء العربية من قاعدة البيانات الرئيسية"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        symbols_map = {}
        try:
            # Try stocks table
            cursor.execute("SELECT symbol, name, name_ar FROM stocks WHERE symbol IS NOT NULL")
            for row in cursor.fetchall():
                if row['symbol']:
                    symbol = row['symbol'].upper()
                    if row['name_ar']:
                        symbols_map[row['name_ar']] = symbol
                    if row['name']:
                        symbols_map[row['name']] = symbol
        except Exception as e:
            logger.debug(f"Could not fetch from stocks table: {e}")
        
        conn.close()
        return symbols_map
    
    def upsert_stock(self, stock: Dict) -> bool:
        """إضافة أو تحديث سهم"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO egksco_stocks 
                (symbol, name, name_ar, last_price, open_price, high_price, low_price,
                 prev_close, change_pct, volume, value, trades_count, last_update, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(symbol) DO UPDATE SET
                    name = excluded.name,
                    name_ar = excluded.name_ar,
                    last_price = excluded.last_price,
                    open_price = excluded.open_price,
                    high_price = excluded.high_price,
                    low_price = excluded.low_price,
                    prev_close = excluded.prev_close,
                    change_pct = excluded.change_pct,
                    volume = excluded.volume,
                    value = excluded.value,
                    trades_count = excluded.trades_count,
                    last_update = excluded.last_update,
                    updated_at = CURRENT_TIMESTAMP
            ''', (
                stock.get('symbol'),
                stock.get('name'),
                stock.get('name_ar'),
                stock.get('last'),
                stock.get('open'),
                stock.get('high'),
                stock.get('low'),
                stock.get('prev_close'),
                stock.get('change_pct'),
                stock.get('volume'),
                stock.get('value'),
                stock.get('trades_count'),
                datetime.now().isoformat()
            ))
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"Error upserting stock {stock.get('symbol')}: {e}")
            return False
        finally:
            conn.close()
    
    def bulk_upsert_stocks(self, stocks: List[Dict]) -> Tuple[int, int]:
        success_count = 0
        error_count = 0
        
        for stock in stocks:
            if self.upsert_stock(stock):
                success_count += 1
            else:
                error_count += 1
        
        return success_count, error_count
    
    def get_all_stocks(self) -> List[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM egksco_stocks
            ORDER BY symbol
        ''')
        
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def get_stock(self, symbol: str) -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM egksco_stocks WHERE symbol = ?
        ''', (symbol,))
        
        row = cursor.fetchone()
        conn.close()
        
        return dict(row) if row else None
    
    def log_sync(self, sync_type: str, status: str, **kwargs):
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO egksco_sync_status
            (sync_type, status, stocks_count, new_stocks, updated_stocks, errors, duration_seconds, message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            sync_type,
            status,
            kwargs.get('stocks_count', 0),
            kwargs.get('new_stocks', 0),
            kwargs.get('updated_stocks', 0),
            kwargs.get('errors', 0),
            kwargs.get('duration_seconds', 0),
            kwargs.get('message', '')
        ))
        
        conn.commit()
        conn.close()
    
    def get_last_sync(self, sync_type: str = 'stocks') -> Optional[Dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM egksco_sync_status
            WHERE sync_type = ?
            ORDER BY sync_time DESC
            LIMIT 1
        ''', (sync_type,))
        
        row = cursor.fetchone()
        conn.close()
        
        return dict(row) if row else None


# ============================================================================
# SCRAPER CLASS
# ============================================================================

class EGKSCOScraper:
    """
    يجلب بيانات الأسهم والتوقعات من EGKSCO
    مع حفظ مباشر في قاعدة البيانات
    """
    
    def __init__(self, data_dir: Optional[Path] = None, db_path: Optional[str] = None):
        self.data_dir = data_dir or DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db = EGKSCODatabase(db_path)
        self.db.init_tables()
        # BRAVO-SCRAPER-WIRING: track tickers whose price changed during sync
        self._changed_tickers = set()
        
    def get_changed_tickers(self) -> List[str]:
        """BRAVO-SCRAPER-WIRING: رجّع قائمة tickers اللي اتغير سعرها في آخر sync_to_db.
        تُستخدم لـ trigger daily_predictor --incremental --tickers <changed>.
        """
        return sorted(self._changed_tickers)

    def reset_changed_tickers(self):
        """تصفير قائمة الـ changed tickers (بعد ما الـ predictor يستهلكها)."""
        self._changed_tickers.clear()

    def fetch_page(self, url: str, output_file: str) -> bool:
        """تحميل صفحة باستخدام curl"""
        output_path = self.data_dir / output_file
        
        try:
            result = subprocess.run(
                ['curl', '-s', '-L', url, '-o', str(output_path)],
                capture_output=True,
                timeout=30
            )
            return result.returncode == 0
        except Exception as e:
            logger.error(f"Failed to fetch {url}: {e}")
            return False
    
    def parse_stocks_html(self, html_file: str = 'sectors.html') -> List[Dict]:
        """استخراج الأسهم والأسعار من HTML المحمل"""
        html_path = self.data_dir / html_file
        
        if not html_path.exists():
            logger.error(f"HTML file not found: {html_path}")
            return []
        
        with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        stocks = []
        seen = set()
        
        # Alternative approach: Find each stock symbol and extract prices after it
        # This works better because the HTML has nested tables that break row-by-row parsing
        stock_pattern = r'Code=([A-Z]+)\.CA\s*&amp;STName=([^"&]+)'
        
        for match in re.finditer(stock_pattern, content):
            symbol = match.group(1)
            name_ar = match.group(2).replace('\xa0', ' ').split('&')[0].strip()
            
            if symbol in seen:
                continue
            seen.add(symbol)
            
            # Find all aikalam spans within the next 5000 characters (within the same row)
            # Volume and value spans are further away due to HTML structure
            pos = match.end()
            search_area = content[pos:pos+5000]
            span_pattern = r'<span[^>]*class="aikalam"[^>]*>([^<]*)</span>'
            spans = re.findall(span_pattern, search_area)[:7]  # Get first 7 spans
            
            stock_data = {
                'symbol': symbol,
                'name': name_ar,
                'name_ar': name_ar,
                'source': 'egksco',
                'fetched_at': datetime.now().isoformat()
            }
            
            # Parse price values
            if len(spans) >= 5:
                try:
                    # Clean and parse values
                    def parse_float(val):
                        try:
                            return float(val.replace(',', '').replace(' ', ''))
                        except:
                            return None
                    
                    # Mapping based on actual HTML analysis:
                    # spans[0] = اخر سعر (Last Price)
                    # spans[1] = سعر الفتح (Open)
                    # spans[2] = أعلى سعر (High)
                    # spans[3] = أقل سعر (Low)
                    # spans[4] = إقفال سابق (Previous Close)
                    # spans[5] = الكمية (Volume)
                    # spans[6] = القيمة (Value)
                    
                    last_price = parse_float(spans[0]) if len(spans) > 0 else None
                    open_price = parse_float(spans[1]) if len(spans) > 1 else None
                    high_price = parse_float(spans[2]) if len(spans) > 2 else None
                    low_price = parse_float(spans[3]) if len(spans) > 3 else None
                    prev_close = parse_float(spans[4]) if len(spans) > 4 else None
                    
                    volume = None
                    value = None
                    if len(spans) > 5:
                        try:
                            volume = int(float(spans[5].replace(',', '')))
                        except:
                            pass
                    if len(spans) > 6:
                        try:
                            value = float(spans[6].replace(',', ''))
                        except:
                            pass
                    
                    stock_data['last'] = last_price
                    stock_data['open'] = open_price
                    stock_data['high'] = high_price
                    stock_data['low'] = low_price
                    stock_data['prev_close'] = prev_close
                    stock_data['volume'] = volume
                    stock_data['value'] = value
                    
                except Exception as e:
                    logger.debug(f"Error parsing prices for {symbol}: {e}")
            
            stocks.append(stock_data)
        
        # Count stocks with actual prices
        with_prices = [s for s in stocks if s.get('last') is not None and s.get('last') > 0]
        logger.info(f"Parsed {len(stocks)} stocks, {len(with_prices)} with prices from HTML")
        return stocks
    
    def match_arabic_name_to_symbol(self, name_ar: str, db_symbols: Dict[str, str]) -> Optional[str]:
        """مطابقة الاسم العربي مع الرمز الإنجليزي"""
        # Direct match
        if name_ar in db_symbols:
            return db_symbols[name_ar]
        
        # Partial match
        for ar_name, symbol in db_symbols.items():
            if ar_name in name_ar or name_ar in ar_name:
                return symbol
        
        # Known mappings
        for known_name, known_symbol in SYMBOL_MAPPINGS.items():
            if known_name in name_ar or name_ar in known_name:
                return known_symbol
        
        return None
    
    def fetch_stock_prices(self, symbols: List[str] = None) -> Dict[str, Dict]:
        """جلب أسعار الأسهم الفردية"""
        if symbols is None:
            symbols = [s['symbol'] for s in self.db.get_all_stocks()[:50]]
        
        prices = {}
        
        for symbol in symbols:
            try:
                url = EGKSCO_STOCK_URL.format(symbol=symbol)
                if self.fetch_page(url, f'stock_{symbol}.html'):
                    price_data = self.parse_stock_price(f'stock_{symbol}.html')
                    if price_data:
                        prices[symbol] = price_data
            except Exception as e:
                logger.debug(f"Error fetching price for {symbol}: {e}")
        
        return prices
    
    def parse_stock_price(self, html_file: str) -> Optional[Dict]:
        """استخراج بيانات السعر من صفحة السهم"""
        html_path = self.data_dir / html_file
        
        if not html_path.exists():
            return None
        
        try:
            with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            price_data = {}
            
            # Extract prices from HTML
            patterns = {
                'last': r'السعر\s*الحالي[^\d]*(\d+\.?\d*)',
                'open': r'الافتتاح[^\d]*(\d+\.?\d*)',
                'high': r'الأعلى[^\d]*(\d+\.?\d*)',
                'low': r'الأدنى[^\d]*(\d+\.?\d*)',
                'prev_close': r'السابق[^\d]*(\d+\.?\d*)',
                'volume': r'الكمية[^\d]*(\d+[\d,]*)',
            }
            
            for key, pattern in patterns.items():
                match = re.search(pattern, content)
                if match:
                    val = match.group(1).replace(',', '')
                    try:
                        price_data[key] = float(val) if '.' in val else int(val)
                    except ValueError:
                        pass
            
            return price_data if price_data else None
            
        except Exception as e:
            logger.debug(f"Error parsing price: {e}")
            return None
    
    def fetch_stocks(self) -> Tuple[bool, List[Dict]]:
        """جلب قائمة الأسهم"""
        logger.info("Fetching stocks from EGKSCO...")
        
        if not self.fetch_page(EGKSCO_SECTORS_URL, 'sectors.html'):
            return False, []
        
        stocks = self.parse_stocks_html()
        return len(stocks) > 0, stocks
    
    def fetch_recommendation_pdf(self) -> Tuple[bool, Optional[str]]:
        """جلب تقرير التوقعات PDF"""
        logger.info("Fetching recommendation PDF from EGKSCO...")
        
        if not self.fetch_page(EGKSCO_REPORTS_URL, 'reports.html'):
            return False, None
        
        reports_path = self.data_dir / 'reports.html'
        with open(reports_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        match = re.search(r'openFile\.aspx\?type=2&amp;file=(\d+)', content)
        if not match:
            logger.warning("No PDF link found in reports page")
            return False, None
        
        file_id = match.group(1)
        pdf_url = f"{EGKSCO_PDF_BASE}?type=2&file={file_id}"
        pdf_path = self.data_dir / f"recommendation_{file_id}.pdf"
        
        try:
            result = subprocess.run(
                ['curl', '-s', '-L', pdf_url, '-o', str(pdf_path)],
                capture_output=True,
                timeout=30
            )
            
            if result.returncode == 0 and pdf_path.exists():
                logger.info(f"PDF saved: {pdf_path}")
                return True, str(pdf_path)
        except Exception as e:
            logger.error(f"Failed to download PDF: {e}")
        
        return False, None
    
    def sync_to_db(self, stocks: List[Dict] = None) -> Dict:
        """مزامنة البيانات مع قاعدة البيانات"""
        import time
        start_time = time.time()
        
        if stocks is None:
            success, stocks = self.fetch_stocks()
            if not success:
                return {
                    'success': False,
                    'error': 'Failed to fetch stocks',
                    'stocks_count': 0
                }
        
        # BRAVO-SCRAPER-WIRING: snapshot old prices before upsert (for change detection)
        try:
            _pre_conn = sqlite3.connect(self.db.db_path)
            _pre_cur = _pre_conn.cursor()
            _old_prices = {}
            for row in _pre_cur.execute("SELECT symbol, last_price FROM egksco_stocks WHERE last_price IS NOT NULL").fetchall():
                _old_prices[row[0]] = row[1]
            _pre_conn.close()
        except Exception:
            _old_prices = {}
        
        success_count, error_count = self.db.bulk_upsert_stocks(stocks)
        
        # BRAVO-SCRAPER-WIRING: detect which tickers had price changes
        try:
            _post_conn = sqlite3.connect(self.db.db_path)
            _post_cur = _post_conn.cursor()
            for row in _post_cur.execute("SELECT symbol, last_price FROM egksco_stocks WHERE last_price IS NOT NULL").fetchall():
                symbol, new_price = row[0], row[1]
                old_price = _old_prices.get(symbol)
                # changed if: new ticker (old_price None) OR price actually different
                if old_price is None or (new_price is not None and abs(new_price - old_price) > 1e-6):
                    self._changed_tickers.add(symbol)
            _post_conn.close()
        except Exception:
            pass
        
        # Also update the main stocks table for Next.js frontend
        main_stocks_updated = 0
        try:
            conn = sqlite3.connect(self.db.db_path)
            cursor = conn.cursor()
            
            for stock in stocks:
                symbol = stock.get('symbol')
                if not symbol:
                    continue
                    
                # Check if stock exists in main table
                cursor.execute('SELECT ticker FROM stocks WHERE ticker = ?', (symbol,))
                exists = cursor.fetchone()
                
                if exists:
                    # Update existing stock
                    cursor.execute('''
                        UPDATE stocks SET
                            current_price = ?,
                            previous_close = ?,
                            open_price = ?,
                            high_price = ?,
                            low_price = ?,
                            volume = ?,
                            last_update = ?
                        WHERE ticker = ?
                    ''', (
                        stock.get('last'),
                        stock.get('prev_close'),
                        stock.get('open'),
                        stock.get('high'),
                        stock.get('low'),
                        stock.get('volume'),
                        datetime.now().isoformat(),
                        symbol
                    ))
                else:
                    # Insert new stock
                    cursor.execute('''
                        INSERT OR IGNORE INTO stocks 
                        (ticker, name, name_ar, current_price, previous_close, 
                         open_price, high_price, low_price, volume, last_update)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        symbol,
                        stock.get('name') or stock.get('name_ar'),
                        stock.get('name_ar'),
                        stock.get('last'),
                        stock.get('prev_close'),
                        stock.get('open'),
                        stock.get('high'),
                        stock.get('low'),
                        stock.get('volume'),
                        datetime.now().isoformat()
                    ))
                main_stocks_updated += 1
            
            conn.commit()
            conn.close()
            logger.info(f"Updated {main_stocks_updated} stocks in main stocks table")
            
            # === ADD TO PRICE HISTORY ===
            # Add today's prices to price_history.db for charts
            # DNA-WINNER: also calculate delta_volume at write-time
            history_added = 0
            try:
                conn_hist = sqlite3.connect(PRICE_HISTORY_DB_PATH)
                cursor_hist = conn_hist.cursor()
                today = datetime.now().strftime('%Y-%m-%d')
                
                # Ensure delta columns exist in price_history
                try:
                    cursor_hist.execute('ALTER TABLE price_history ADD COLUMN buy_volume INTEGER')
                    cursor_hist.execute('ALTER TABLE price_history ADD COLUMN sell_volume INTEGER')
                    cursor_hist.execute('ALTER TABLE price_history ADD COLUMN delta_volume INTEGER')
                    cursor_hist.execute('ALTER TABLE price_history ADD COLUMN delta_pct REAL')
                    cursor_hist.execute('ALTER TABLE price_history ADD COLUMN pressure TEXT')
                except Exception:
                    pass  # Already exist
                
                for stock in stocks:
                    symbol = stock.get('symbol')
                    if not symbol or not stock.get('last'):
                        continue
                    
                    _close = float(stock.get('last') or 0)
                    _high = float(stock.get('high') or 0) or _close
                    _low = float(stock.get('low') or 0) or _close
                    _vol = int(stock.get('volume') or 0)
                    
                    # Delta Volume Calculation
                    _buy_v = 0; _sell_v = 0; _delta_v = 0; _delta_p = 0.0; _press = 'NEUTRAL'
                    if _vol > 0 and _high > _low:
                        _ratio = max(0.0, min(1.0, (_close - _low) / (_high - _low)))
                        _buy_v = int(_vol * _ratio)
                        _sell_v = _vol - _buy_v
                        _delta_v = _buy_v - _sell_v
                        _delta_p = round((_delta_v / _vol) * 100, 2)
                        if _delta_p > 30: _press = 'STRONG_BUY'
                        elif _delta_p > 10: _press = 'BUY'
                        elif _delta_p < -30: _press = 'STRONG_SELL'
                        elif _delta_p < -10: _press = 'SELL'
                    
                    # Insert or replace today's price history with delta_volume
                    cursor_hist.execute('''
                        INSERT OR REPLACE INTO price_history 
                        (ticker, date, open_price, high_price, low_price, close_price, volume, source,
                         buy_volume, sell_volume, delta_volume, delta_pct, pressure)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'egksco', ?, ?, ?, ?, ?)
                    ''', (
                        symbol,
                        today,
                        stock.get('open'),
                        stock.get('high'),
                        stock.get('low'),
                        stock.get('last'),
                        stock.get('volume'),
                        _buy_v,
                        _sell_v,
                        _delta_v,
                        _delta_p,
                        _press,
                    ))
                    history_added += 1
                
                conn_hist.commit()
                conn_hist.close()
                logger.info(f"Added {history_added} records to price_history for {today} (with delta_volume)")
            except Exception as e:
                logger.error(f"Error adding to price history: {e}")

            # === PROPAGATE TO data_engine.db.egksco_price_history (NEW schema) ===
            # FIX (2026-10-05 — PRED-ENGINE-AUDIT): V40.2 reads from
            # data_engine.db.egksco_price_history (price_date + turnover + delta_volume
            # schema), NOT from price_history.db. Without this propagation, V40.2
            # finds 0 rows → "اليوم مش موجود في data_engine.db" → uses stale data.
            # This block mirrors the price_history.db write into the new schema.
            data_engine_added = 0
            try:
                # Use os.path (not Path) — there's a `from pathlib import Path`
                # at line 872 inside this function which makes Python treat
                # `Path` as a local variable throughout, causing
                # "cannot access local variable 'Path'" at this earlier line.
                data_engine_db_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    'db', 'data_engine.db'
                )
                conn_de = sqlite3.connect(data_engine_db_path, timeout=30.0)
                cursor_de = conn_de.cursor()

                # Ensure delta columns exist in data_engine.db.egksco_price_history
                # (migrator.py creates the base table but without delta columns)
                try:
                    cursor_de.execute('ALTER TABLE egksco_price_history ADD COLUMN buy_volume INTEGER')
                    cursor_de.execute('ALTER TABLE egksco_price_history ADD COLUMN sell_volume INTEGER')
                    cursor_de.execute('ALTER TABLE egksco_price_history ADD COLUMN delta_volume INTEGER')
                    cursor_de.execute('ALTER TABLE egksco_price_history ADD COLUMN delta_pct REAL')
                    cursor_de.execute('ALTER TABLE egksco_price_history ADD COLUMN pressure TEXT')
                except Exception:
                    pass  # Already exist

                for stock in stocks:
                    symbol = stock.get('symbol')
                    if not symbol or not stock.get('last'):
                        continue

                    _close = float(stock.get('last') or 0)
                    _high = float(stock.get('high') or 0) or _close
                    _low = float(stock.get('low') or 0) or _close
                    _vol = int(stock.get('volume') or 0)
                    _turnover = float(stock.get('value') or 0)

                    # Delta Volume Calculation (mirrors price_history.db write)
                    _buy_v = 0; _sell_v = 0; _delta_v = 0; _delta_p = 0.0; _press = 'NEUTRAL'
                    if _vol > 0 and _high > _low:
                        _ratio = max(0.0, min(1.0, (_close - _low) / (_high - _low)))
                        _buy_v = int(_vol * _ratio)
                        _sell_v = _vol - _buy_v
                        _delta_v = _buy_v - _sell_v
                        _delta_p = round((_delta_v / _vol) * 100, 2)
                        if _delta_p > 30: _press = 'STRONG_BUY'
                        elif _delta_p > 10: _press = 'BUY'
                        elif _delta_p < -30: _press = 'STRONG_SELL'
                        elif _delta_p < -10: _press = 'SELL'

                    cursor_de.execute('''
                        INSERT OR REPLACE INTO egksco_price_history
                        (symbol, price_date, open_price, high_price, low_price, close_price,
                         volume, turnover, source,
                         buy_volume, sell_volume, delta_volume, delta_pct, pressure)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'egksco', ?, ?, ?, ?, ?)
                    ''', (
                        symbol,
                        today,
                        stock.get('open'),
                        stock.get('high'),
                        stock.get('low'),
                        stock.get('last'),
                        _vol,
                        _turnover,
                        _buy_v,
                        _sell_v,
                        _delta_v,
                        _delta_p,
                        _press,
                    ))
                    data_engine_added += 1

                conn_de.commit()
                conn_de.close()
                logger.info(f"Propagated {data_engine_added} records to data_engine.db.egksco_price_history for {today}")
            except Exception as e:
                logger.error(f"Error propagating to data_engine.db.egksco_price_history: {e}")
        except Exception as e:
            logger.error(f"Error updating main stocks table: {e}")
        
        # === DATA-ENGINE-UNIFY-1 Stage 1: removed direct stocks.db propagation ===
        # sync.py is the only transporter from data_engine.db to stocks.db. Any direct
        # write to stocks.db from a scraper is a violation of the canonical flow.
        # Previously this block UPDATEd stocks.db.stocks (current_price/open/high/...)
        # directly from the EGKSCO scrape — bypassing sync.py and racing with it.
        # The `frontend_db_updated` counter is kept at 0 for backward-compatible
        # result-shape (callers reading this field will simply see 0).
        frontend_db_updated = 0
        
        duration = time.time() - start_time
        
        result = {
            'success': True,
            'stocks_count': len(stocks),
            'saved': success_count,
            'errors': error_count,
            'main_stocks_updated': main_stocks_updated,
            'frontend_db_updated': frontend_db_updated,
            'data_engine_propagated': data_engine_added,
            'duration_seconds': round(duration, 2),
            'timestamp': datetime.now().isoformat()
        }
        
        self.db.log_sync(
            sync_type='stocks',
            status='success' if error_count == 0 else 'partial',
            stocks_count=len(stocks),
            new_stocks=success_count,
            errors=error_count,
            duration_seconds=duration
        )
        
        logger.info(f"Synced {success_count} stocks in {duration:.1f}s")
        return result
    
    def run_full_sync(self) -> Dict:
        """تشغيل مزامنة كاملة"""
        result = {
            'timestamp': datetime.now().isoformat(),
            'stocks': {'success': False, 'count': 0},
            'pdf': {'success': False, 'path': None}
        }
        
        success, stocks = self.fetch_stocks()
        if success:
            sync_result = self.sync_to_db(stocks)
            result['stocks'] = {
                'success': sync_result['success'],
                'count': sync_result['stocks_count'],
                'saved': sync_result.get('saved', 0),
                'duration': sync_result.get('duration_seconds', 0)
            }
        
        success, pdf_path = self.fetch_recommendation_pdf()
        if success:
            result['pdf'] = {
                'success': True,
                'path': pdf_path
            }
        
        return result
    
    def get_status(self) -> Dict:
        """حالة المزامنة"""
        last_sync = self.db.get_last_sync('stocks')
        stocks_count = len(self.db.get_all_stocks())
        
        return {
            'data_dir': str(self.data_dir),
            'stocks_in_db': stocks_count,
            'last_sync': last_sync,
            'timestamp': datetime.now().isoformat()
        }


# ============================================================================
# SCHEDULER TASK
# ============================================================================

def egksco_sync_task(db: Any = None) -> Dict:
    """مهمة مجدولة لمزامنة EGKSCO"""
    logger.info("[EGKSCO] Starting scheduled sync...")
    
    try:
        scraper = EGKSCOScraper()
        result = scraper.run_full_sync()
        
        logger.info(
            "[EGKSCO] Sync completed: %d stocks, PDF: %s",
            result['stocks']['count'],
            '✓' if result['pdf']['success'] else '✗'
        )
        
        return {
            'success': True,
            'task': 'egksco_sync',
            'timestamp': datetime.now().isoformat(),
            **result
        }
    except Exception as e:
        logger.error(f"[EGKSCO] Sync failed: {e}")
        return {
            'success': False,
            'task': 'egksco_sync',
            'timestamp': datetime.now().isoformat(),
            'error': str(e)
        }


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

def main():
    """CLI entry point"""
    print("=" * 60)
    print("EGKSCO Scraper v3.0 - Fixed Symbol Matching")
    print("=" * 60)
    
    scraper = EGKSCOScraper()
    
    status = scraper.get_status()
    print(f"\n📊 Current Status:")
    print(f"  Stocks in DB: {status['stocks_in_db']}")
    
    print("\n🔄 Running full sync...")
    result = scraper.run_full_sync()
    
    print("\n📊 Results:")
    print(f"  Stocks: {result['stocks']['count']} fetched, {result['stocks'].get('saved', 0)} saved")
    print(f"  PDF: {'✅' if result['pdf']['success'] else '❌'}")
    print(f"\n📁 Data saved to: {scraper.data_dir}")


if __name__ == '__main__':
    main()
