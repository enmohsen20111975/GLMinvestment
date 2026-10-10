#!/usr/bin/env python3
"""
US Stocks Fetcher - Yahoo Finance
===================================
يجلب بيانات الأسهم الأمريكية من Yahoo Finance
يدعم التحديث التدريجي والجلب الكامل

الاستخدام:
  python us_stocks_fetcher.py           # جلب كامل
  python us_stocks_fetcher.py --update  # تحديث تدريجي
  python us_stocks_fetcher.py --limit 10  # جلب 10 أسهم فقط
"""

import os
import sys
import sqlite3
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# Add local packages to path (use site-packages from current Python env)
_site_packages = os.path.join(sys.prefix, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')
if os.path.isdir(_site_packages):
    sys.path.insert(0, _site_packages)

_user_site = os.path.join(os.path.expanduser('~/.local/lib'), f'python{sys.version_info.major}.{sys.version_info.minor}', 'site-packages')
if os.path.isdir(_user_site):
    sys.path.insert(0, _user_site)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')

# Market code used in the database (Arabic name, matching existing convention)
US_MARKET_CODE = 'الأسهم الأمريكية'

# ============================================================================
# US STOCKS LIST - Top 100+ by market cap + major ETFs
# ============================================================================

US_STOCKS: Dict[str, str] = {
    # === Technology ===
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corporation',
    'GOOGL': 'Alphabet Inc.',
    'GOOG': 'Alphabet Inc. (Class C)',
    'AMZN': 'Amazon.com Inc.',
    'META': 'Meta Platforms Inc.',
    'NVDA': 'NVIDIA Corporation',
    'TSLA': 'Tesla Inc.',
    'AMD': 'Advanced Micro Devices',
    'INTC': 'Intel Corporation',
    'CRM': 'Salesforce Inc.',
    'ORCL': 'Oracle Corporation',
    'ADBE': 'Adobe Inc.',
    'PYPL': 'PayPal Holdings',
    'UBER': 'Uber Technologies',
    'SQ': 'Block Inc.',
    'NFLX': 'Netflix Inc.',
    'DIS': 'The Walt Disney Company',
    'CMCSA': 'Comcast Corporation',
    'T': 'AT&T Inc.',
    'VZ': 'Verizon Communications',
    'AVGO': 'Broadcom Inc.',
    'TXN': 'Texas Instruments',
    'QCOM': 'Qualcomm Inc.',
    'IBM': 'IBM Corporation',
    'NOW': 'ServiceNow Inc.',
    'INTU': 'Intuit Inc.',
    'SNPS': 'Synopsys Inc.',
    'CDNS': 'Cadence Design Systems',
    'PANW': 'Palo Alto Networks',
    'CRWD': 'CrowdStrike Holdings',
    'MSTR': 'MicroStrategy Inc.',
    'PLTR': 'Palantir Technologies',
    'SHOP': 'Shopify Inc.',
    'SPOT': 'Spotify Technology',

    # === Healthcare ===
    'JNJ': 'Johnson & Johnson',
    'UNH': 'UnitedHealth Group',
    'PFE': 'Pfizer Inc.',
    'ABBV': 'AbbVie Inc.',
    'MRK': 'Merck & Co.',
    'TMO': 'Thermo Fisher Scientific',
    'LLY': 'Eli Lilly and Company',
    'ABT': 'Abbott Laboratories',
    'MRNA': 'Moderna Inc.',
    'AMGN': 'Amgen Inc.',
    'GILD': 'Gilead Sciences',
    'BIIB': 'Biogen Inc.',
    'REGN': 'Regeneron Pharmaceuticals',
    'VRTX': 'Vertex Pharmaceuticals',
    'ISRG': 'Intuitive Surgical',

    # === Finance ===
    'JPM': 'JPMorgan Chase',
    'BAC': 'Bank of America',
    'WFC': 'Wells Fargo',
    'GS': 'Goldman Sachs',
    'MS': 'Morgan Stanley',
    'V': 'Visa Inc.',
    'MA': 'Mastercard Inc.',
    'BLK': 'BlackRock Inc.',
    'SCHW': 'Charles Schwab',
    'C': 'Citigroup Inc.',
    'AXP': 'American Express',
    'USB': 'U.S. Bancorp',
    'PNC': 'PNC Financial Services',
    'COF': 'Capital One Financial',
    'SPGI': 'S&P Global Inc.',
    'MCO': "Moody's Corporation",
    'BK': 'Bank of New York Mellon',
    'STT': 'State Street Corporation',

    # === Consumer ===
    'WMT': 'Walmart Inc.',
    'HD': 'The Home Depot',
    'PG': 'Procter & Gamble',
    'KO': 'The Coca-Cola Company',
    'PEP': 'PepsiCo Inc.',
    'COST': 'Costco Wholesale',
    'NKE': 'Nike Inc.',
    'MCD': "McDonald's Corporation",
    'SBUX': 'Starbucks Corporation',
    'TGT': 'Target Corporation',
    'LOW': "Lowe's Companies",
    'AMZN': 'Amazon.com Inc.',  # duplicate with tech but ok
    'TJX': 'TJX Companies',
    'LULU': 'Lululemon Athletica',
    'YUM': 'Yum! Brands',

    # === Energy ===
    'XOM': 'Exxon Mobil',
    'CVX': 'Chevron Corporation',
    'COP': 'ConocoPhillips',
    'SLB': 'Schlumberger',
    'EOG': 'EOG Resources',
    'OXY': 'Occidental Petroleum',
    'MPC': 'Marathon Petroleum',
    'VLO': 'Valero Energy',

    # === Industrial ===
    'BA': 'The Boeing Company',
    'CAT': 'Caterpillar Inc.',
    'GE': 'General Electric',
    'HON': 'Honeywell International',
    'UPS': 'United Parcel Service',
    'RTX': 'RTX Corporation',
    'LMT': 'Lockheed Martin',
    'DE': 'Deere & Company',
    'MMM': '3M Company',
    'EMR': 'Emerson Electric',
    'ETN': 'Eaton Corporation',
    'UNP': 'Union Pacific Corporation',

    # === Real Estate / REITs ===
    'AMT': 'American Tower Corporation',
    'PLD': 'Prologis Inc.',
    'CCI': 'Crown Castle International',
    'EQIX': 'Equinix Inc.',
    'SPG': 'Simon Property Group',
    'O': 'Realty Income Corporation',

    # === Materials ===
    'LIN': 'Linde PLC',
    'APD': 'Air Products and Chemicals',
    'SHW': 'Sherwin-Williams',
    'ECL': 'Ecolab Inc.',
    'FCX': 'Freeport-McMoRan',
    'NEM': 'Newmont Corporation',

    # === Utilities ===
    'NEE': 'NextEra Energy',
    'DUK': 'Duke Energy',
    'SO': 'Southern Company',
    'D': 'Dominion Energy',

    # === ETFs (Major) ===
    'SPY': 'SPDR S&P 500 ETF',
    'QQQ': 'Invesco QQQ Trust',
    'IWM': 'iShares Russell 2000',
    'DIA': 'SPDR Dow Jones ETF',
    'VTI': 'Vanguard Total Stock Market',
    'VOO': 'Vanguard S&P 500',
    'VEA': 'Vanguard FTSE Developed Markets',
    'VWO': 'Vanguard FTSE Emerging Markets',
    'BND': 'Vanguard Total Bond Market',
    'AGG': 'iShares Core US Aggregate Bond',
    'GLD': 'SPDR Gold Shares',
    'SLV': 'iShares Silver Trust',
    'XLK': 'Technology Select Sector SPDR',
    'XLF': 'Financial Select Sector SPDR',
    'XLE': 'Energy Select Sector SPDR',
    'XLV': 'Health Care Select Sector SPDR',
    'XLY': 'Consumer Discretionary Select Sector SPDR',
    'XLP': 'Consumer Staples Select Sector SPDR',
    'XLI': 'Industrial Select Sector SPDR',
    'XLU': 'Utilities Select Sector SPDR',
    'XLB': 'Materials Select Sector SPDR',
    'XLRE': 'Real Estate Select Sector SPDR',
    'XLC': 'Communication Services Select Sector SPDR',
}


class USStocksFetcher:
    """Fetches US stock data from Yahoo Finance and stores in data_engine.db"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or DATA_ENGINE_DB
        self.stats = {
            'fetched': 0,
            'updated': 0,
            'errors': 0,
            'skipped': 0,
            'total_rows': 0,
        }
        self._yf_available = False
        self._check_yfinance()

    def _check_yfinance(self):
        """Check if yfinance is available"""
        try:
            import yfinance
            self._yf_available = True
            logger.info(f"✓ yfinance available (v{yfinance.__version__})")
        except ImportError:
            logger.error("✗ yfinance not available. Install with: pip install yfinance")
            self._yf_available = False

    def _get_conn(self) -> sqlite3.Connection:
        """Get a connection to the data_engine database"""
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

    def _ensure_table(self):
        """Ensure historical_data table exists with the correct schema"""
        conn = self._get_conn()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS historical_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT,
                    name TEXT,
                    market TEXT,
                    date TEXT,
                    open REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    volume INTEGER,
                    last_fetch TEXT
                )
            """)
            # Create index for faster lookups
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_historical_data_symbol_market
                ON historical_data(symbol, market)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_historical_data_date
                ON historical_data(date)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_historical_data_symbol_market_date
                ON historical_data(symbol, market, date)
            """)
            conn.commit()
            logger.info("✓ historical_data table ready")
        except Exception as e:
            logger.error(f"✗ Error ensuring table: {e}")
        finally:
            conn.close()

    def _get_last_date(self, symbol: str) -> Optional[str]:
        """Get the last date we have data for this symbol"""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT MAX(date) as max_date FROM historical_data WHERE symbol = ? AND market = ?",
                (symbol, US_MARKET_CODE)
            ).fetchone()
            if row and row['max_date']:
                return row['max_date']
            return None
        except Exception as e:
            logger.debug(f"Error getting last date for {symbol}: {e}")
            return None
        finally:
            conn.close()

    def _get_row_count(self, symbol: str) -> int:
        """Get the number of rows for a symbol"""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM historical_data WHERE symbol = ? AND market = ?",
                (symbol, US_MARKET_CODE)
            ).fetchone()
            return row['cnt'] if row else 0
        except Exception:
            return 0
        finally:
            conn.close()

    def fetch_stock(self, symbol: str, name: str, update_only: bool = False) -> bool:
        """
        Fetch OHLCV data for a single US stock from Yahoo Finance.

        Args:
            symbol: Stock ticker (e.g., 'AAPL')
            name: Company name (e.g., 'Apple Inc.')
            update_only: If True, only fetch data since last update

        Returns:
            True if successful, False otherwise
        """
        if not self._yf_available:
            logger.error("yfinance not available, cannot fetch")
            return False

        import yfinance as yf

        try:
            # Determine the date range
            start_date = None
            last_date = self._get_last_date(symbol)

            if update_only and last_date:
                # Incremental update: fetch from last_date onwards
                # Add 1 day to avoid duplicates
                last_dt = datetime.strptime(last_date, '%Y-%m-%d')
                start_date = (last_dt + timedelta(days=1)).strftime('%Y-%m-%d')

                # Check if we already have today's data
                today = datetime.now().strftime('%Y-%m-%d')
                if start_date > today:
                    logger.info(f"  ⊘ {symbol}: already up to date ({last_date})")
                    self.stats['skipped'] += 1
                    return True
            else:
                # Full fetch: get 1 year of history by default
                start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')

            # Fetch data from Yahoo Finance
            ticker = yf.Ticker(symbol)
            hist = ticker.history(start=start_date, auto_adjust=True)

            if hist is None or hist.empty:
                logger.warning(f"  ⚠ {symbol}: no data returned from Yahoo Finance")
                self.stats['skipped'] += 1
                return False

            # Convert DataFrame to list of tuples for insertion
            rows_to_insert = []
            now_str = datetime.now().isoformat()

            for idx, row in hist.iterrows():
                date_str = idx.strftime('%Y-%m-%d') if hasattr(idx, 'strftime') else str(idx.date())

                # Skip Dividends and Stock Splits columns, only use OHLCV
                open_price = float(row['Open']) if not (row['Open'] != row['Open']) else None  # NaN check
                high_price = float(row['High']) if not (row['High'] != row['High']) else None
                low_price = float(row['Low']) if not (row['Low'] != row['Low']) else None
                close_price = float(row['Close']) if not (row['Close'] != row['Close']) else None
                volume = int(row['Volume']) if not (row['Volume'] != row['Volume']) else 0

                # Skip rows with no close price
                if close_price is None:
                    continue

                # Use close as fallback for missing OHLC values
                if open_price is None:
                    open_price = close_price
                if high_price is None:
                    high_price = close_price
                if low_price is None:
                    low_price = close_price

                rows_to_insert.append((
                    symbol,
                    name,
                    US_MARKET_CODE,
                    date_str,
                    round(open_price, 4),
                    round(high_price, 4),
                    round(low_price, 4),
                    round(close_price, 4),
                    volume,
                    now_str,
                ))

            if not rows_to_insert:
                logger.warning(f"  ⚠ {symbol}: no valid rows after processing")
                self.stats['skipped'] += 1
                return False

            # Insert into database
            conn = self._get_conn()
            try:
                if not update_only:
                    # Full fetch: delete existing data for this symbol first
                    conn.execute(
                        "DELETE FROM historical_data WHERE symbol = ? AND market = ?",
                        (symbol, US_MARKET_CODE)
                    )

                # Insert new data (use INSERT OR REPLACE to handle incremental updates
                # where some dates may already exist due to the UNIQUE(symbol, date) constraint)
                conn.executemany("""
                    INSERT OR REPLACE INTO historical_data (symbol, name, market, date, open, high, low, close, volume, last_fetch)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, rows_to_insert)
                conn.commit()

                rows_count = len(rows_to_insert)
                self.stats['total_rows'] += rows_count

                if update_only and last_date:
                    self.stats['updated'] += 1
                    logger.info(f"  ✓ {symbol}: +{rows_count} rows (updated from {last_date})")
                else:
                    self.stats['fetched'] += 1
                    logger.info(f"  ✓ {symbol}: {rows_count} rows fetched")

                return True

            except Exception as e:
                logger.error(f"  ✗ {symbol}: DB error: {e}")
                try:
                    conn.rollback()
                except Exception:
                    pass
                self.stats['errors'] += 1
                return False
            finally:
                conn.close()

        except Exception as e:
            error_msg = str(e)[:100]
            logger.error(f"  ✗ {symbol}: fetch error: {error_msg}")
            self.stats['errors'] += 1
            return False

    def fetch_all(self, update_only: bool = False, limit: int = 0):
        """
        Fetch data for all US stocks.

        Args:
            update_only: If True, only fetch new data since last update
            limit: Max number of stocks to fetch (0 = all)
        """
        logger.info("=" * 60)
        logger.info(f"🇺🇸 US Stocks Fetcher - Yahoo Finance")
        logger.info(f"   Mode: {'Incremental Update' if update_only else 'Full Fetch'}")
        logger.info(f"   Total stocks in list: {len(US_STOCKS)}")
        logger.info(f"   Database: {self.db_path}")
        logger.info("=" * 60)

        # Ensure table exists
        self._ensure_table()

        # Check yfinance availability
        if not self._yf_available:
            logger.error("Cannot proceed without yfinance. Exiting.")
            return

        # Count existing data
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT COUNT(DISTINCT symbol) as cnt FROM historical_data WHERE market = ?",
                (US_MARKET_CODE,)
            ).fetchone()
            existing_count = row['cnt'] if row else 0
            logger.info(f"   Existing US stocks in DB: {existing_count}")
        except Exception:
            existing_count = 0
        finally:
            conn.close()

        # Process stocks
        stocks_to_fetch = list(US_STOCKS.items())
        if limit > 0:
            stocks_to_fetch = stocks_to_fetch[:limit]

        total = len(stocks_to_fetch)
        start_time = time.time()

        for i, (symbol, name) in enumerate(stocks_to_fetch, 1):
            logger.info(f"[{i}/{total}] Fetching {symbol} ({name})...")
            self.fetch_stock(symbol, name, update_only=update_only)

            # Rate limiting: 0.5s between requests to avoid Yahoo Finance rate limits
            if i < total:
                time.sleep(0.5)

        # Print summary
        elapsed = time.time() - start_time
        logger.info("=" * 60)
        logger.info(f"📊 US Stocks Fetch Summary:")
        logger.info(f"   ✅ Fetched (full): {self.stats['fetched']}")
        logger.info(f"   🔄 Updated (incremental): {self.stats['updated']}")
        logger.info(f"   ⊘ Skipped: {self.stats['skipped']}")
        logger.info(f"   ❌ Errors: {self.stats['errors']}")
        logger.info(f"   📁 Total rows: {self.stats['total_rows']}")
        logger.info(f"   ⏱️  Time elapsed: {elapsed:.1f}s")
        logger.info("=" * 60)

        return self.stats


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='US Stocks Fetcher - Yahoo Finance')
    parser.add_argument('--update', action='store_true',
                        help='Incremental update only (only fetch new data)')
    parser.add_argument('--limit', type=int, default=0,
                        help='Limit number of stocks to fetch (0 = all)')
    parser.add_argument('--db', type=str, default=None,
                        help='Override database path')
    args = parser.parse_args()

    fetcher = USStocksFetcher(db_path=args.db)
    result = fetcher.fetch_all(update_only=args.update, limit=args.limit)

    if result and result.get('errors', 0) > len(US_STOCKS) * 0.5:
        logger.warning("⚠️  High error rate detected. Yahoo Finance may be rate-limiting.")
        logger.warning("   Try again later or use --limit to fetch in smaller batches.")
        sys.exit(1)
