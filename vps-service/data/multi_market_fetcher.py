#!/usr/bin/env python3
"""
Multi-Market Data Fetcher using TradingView
============================================
جلب بيانات الأسواق العربية من TradingView

الأسواق المدعومة:
- السعودية (Tadawul) - Saudi Arabia
- الكويت (KSE) - Kuwait  
- دبي (DFM) - UAE
- البحرين (BSE) - Bahrain
- قطر (QSE) - Qatar

ملاحظة: البيانات تعتمد على توفر السهم في TradingView
"""

import sys
import os

# Add local packages to path (relative)
_user_site = os.path.expanduser('~/.local/lib/python3.13/site-packages')
if os.path.isdir(_user_site):
    sys.path.insert(0, _user_site)

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
import sqlite3
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from pathlib import Path  # added by patch_db_paths.py

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

# Try to import TradingView TA
try:
    from tradingview_ta import TA_Handler, Interval
    TV_AVAILABLE = True
    logger.info("✓ TradingView TA available")
except ImportError as e:
    TV_AVAILABLE = False
    logger.error(f"✗ TradingView TA not available: {e}")

# ============================================================================
# TRADINGVIEW MARKET MAPPINGS
# ============================================================================

# TradingView screener and exchange mappings
TV_MARKET_CONFIG = {
    'KSA': {'screener': 'saudi', 'exchange': 'Tadawul'},
    'KSE': {'screener': 'kuwait', 'exchange': 'KSE'},
    'DFM': {'screener': 'dubai', 'exchange': 'DFM'},
    'BSE': {'screener': 'bahrain', 'exchange': 'BSE'},
    'QSE': {'screener': 'qatar', 'exchange': 'QSE'},
    'EGX': {'screener': 'egypt', 'exchange': 'EGX'},
}

# ============================================================================
# DATA FETCHER CLASS
# ============================================================================

class MultiMarketFetcher:
    """Fetches stock data from TradingView for Arab markets"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.stats = {
            'success': 0,
            'failed': 0,
            'no_data': 0,
            'errors': [],
        }
    
    def fetch_stock_data(self, ticker: str, market: str) -> Optional[Dict]:
        """
        Fetch current stock data from TradingView
        
        Args:
            ticker: Stock ticker
            market: Market code (KSA, KSE, DFM, BSE, QSE)
        
        Returns:
            Dict with stock data or None
        """
        if not TV_AVAILABLE:
            logger.error("TradingView TA not available")
            return None
        
        config = TV_MARKET_CONFIG.get(market)
        if not config:
            logger.warning(f"Unknown market: {market}")
            return None
        
        try:
            handler = TA_Handler(
                symbol=ticker,
                screener=config['screener'],
                exchange=config['exchange'],
                interval=Interval.INTERVAL_1_DAY
            )
            
            analysis = handler.get_analysis()
            
            if not analysis:
                return None
            
            indicators = analysis.indicators
            
            # Extract price data
            current_price = indicators.get('close', 0)
            prev_close = indicators.get('previous_close', current_price)
            open_price = indicators.get('open', current_price)
            high = indicators.get('high', current_price)
            low = indicators.get('low', current_price)
            volume = indicators.get('volume', 0)
            
            # Technical indicators
            rsi = indicators.get('RSI')
            sma_20 = indicators.get('SMA20')
            sma_50 = indicators.get('SMA50')
            sma_200 = indicators.get('SMA200')
            ema_20 = indicators.get('EMA20')
            macd = indicators.get('MACD.macd')
            macd_signal = indicators.get('MACD.signal')
            
            # Calculate change
            change_pct = 0
            if prev_close and current_price and prev_close > 0:
                change_pct = ((current_price - prev_close) / prev_close) * 100
            
            return {
                'ticker': ticker,
                'market': market,
                'current_price': round(current_price, 4) if current_price else None,
                'previous_close': round(prev_close, 4) if prev_close else None,
                'open_price': round(open_price, 4) if open_price else None,
                'high_price': round(high, 4) if high else None,
                'low_price': round(low, 4) if low else None,
                'volume': parse_volume(volume) if volume else None,
                'change_percent': round(change_pct, 4) if change_pct else 0,
                'rsi': round(rsi, 2) if rsi else None,
                'ma_50': round(sma_50, 4) if sma_50 else None,
                'ma_200': round(sma_200, 4) if sma_200 else None,
                'sma_20': round(sma_20, 4) if sma_20 else None,
                'ema_20': round(ema_20, 4) if ema_20 else None,
                'macd': round(macd, 6) if macd else None,
                'macd_signal': round(macd_signal, 6) if macd_signal else None,
                'recommendation': analysis.summary.get('RECOMMENDATION', 'NEUTRAL'),
                'last_update': datetime.now().isoformat(),
                'source': 'tradingview',
            }
            
        except Exception as e:
            logger.debug(f"Error fetching {ticker} from {market}: {e}")
            self.stats['errors'].append(f"{ticker}: {str(e)[:50]}")
            return None
    
    def update_stocks_from_db(self, markets: List[str] = None, limit: int = 0) -> Dict:
        """
        Update stock prices from TradingView
        
        Args:
            markets: List of markets to update (None = all non-EGX)
            limit: Max stocks per market (0 = all)
        
        Returns:
            Stats dict
        """
        if not TV_AVAILABLE:
            return {'error': 'TradingView TA not available'}
        
        # Use copy of database to avoid conflicts with running server
        import shutil
        temp_db = '/tmp/custom_temp.db'
        shutil.copy(self.db_path, temp_db)
        
        conn = sqlite3.connect(temp_db, timeout=30)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get stocks to update
        if markets:
            placeholders = ','.join(['?' for _ in markets])
            cursor.execute(f'''
                SELECT id, ticker, name, market 
                FROM stocks 
                WHERE market IN ({placeholders}) AND is_active = 1
                ORDER BY market, ticker
            ''', markets)
        else:
            cursor.execute('''
                SELECT id, ticker, name, market 
                FROM stocks 
                WHERE market NOT IN ('EGX', 'CRYPTO') AND is_active = 1
                ORDER BY market, ticker
            ''')
        
        stocks = cursor.fetchall()
        logger.info(f"Found {len(stocks)} stocks to update")
        
        market_counts = {}
        for stock in stocks:
            market = stock['market']
            if market not in market_counts:
                market_counts[market] = 0
            
            if limit > 0 and market_counts[market] >= limit:
                continue
            
            market_counts[market] += 1
            
            # Fetch data
            data = self.fetch_stock_data(stock['ticker'], market)
            
            if data and data.get('current_price'):
                # Update database
                cursor.execute('''
                    UPDATE stocks SET
                        current_price = ?,
                        previous_close = ?,
                        open_price = ?,
                        high_price = ?,
                        low_price = ?,
                        volume = ?,
                        change_percent = ?,
                        rsi = ?,
                        ma_50 = ?,
                        ma_200 = ?,
                        last_update = ?
                    WHERE id = ?
                ''', (
                    data['current_price'],
                    data['previous_close'],
                    data['open_price'],
                    data['high_price'],
                    data['low_price'],
                    data['volume'],
                    data['change_percent'],
                    data['rsi'],
                    data['ma_50'],
                    data['ma_200'],
                    data['last_update'],
                    stock['id']
                ))
                
                self.stats['success'] += 1
                logger.info(f"✓ Updated {stock['ticker']} ({market}): {data['current_price']}")
            else:
                self.stats['no_data'] += 1
                logger.debug(f"✗ No data for {stock['ticker']} ({market})")
            
            # Rate limiting - TradingView has rate limits
            time.sleep(0.5)
        
        conn.commit()
        conn.close()
        
        # Copy updated database back to original location
        import shutil
        shutil.copy(temp_db, self.db_path)
        logger.info("Database updated and saved")
        
        logger.info(f"\n📊 Update complete:")
        logger.info(f"  ✅ Success: {self.stats['success']}")
        logger.info(f"  ⚠️ No data: {self.stats['no_data']}")
        logger.info(f"  ❌ Failed: {self.stats['failed']}")
        
        if self.stats['errors']:
            logger.info(f"\nErrors (first 5):")
            for err in self.stats['errors'][:5]:
                logger.info(f"  - {err}")
        
        return self.stats


# ============================================================================
# MAIN
# ============================================================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Multi-Market Data Fetcher (TradingView)')
    parser.add_argument('--db', type=str, default=str(Path(__file__).resolve().parents[2] / "db" / "stocks.db"), help='Database path')
    parser.add_argument('--update', action='store_true', help='Update current prices')
    parser.add_argument('--market', type=str, help='Single market to process')
    parser.add_argument('--limit', type=int, default=20, help='Limit per market (0 = all)')
    
    args = parser.parse_args()
    
    if not TV_AVAILABLE:
        logger.error("TradingView TA not available")
        sys.exit(1)
    
    fetcher = MultiMarketFetcher(args.db)
    
    markets = [args.market] if args.market else None
    
    if args.update:
        fetcher.update_stocks_from_db(markets, args.limit)
    else:
        # Default: update prices
        fetcher.update_stocks_from_db(markets, args.limit)


if __name__ == '__main__':
    main()
