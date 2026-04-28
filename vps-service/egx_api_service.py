#!/usr/bin/env python3
"""
EGX Data API Service - Comprehensive Edition
============================================
A Flask-based API service for fetching stock market data with advanced features.

Features:
- Real-time stock prices from multiple exchanges
- Historical price data stored in VPS database
- Technical indicators (RSI, MACD, SMA, EMA, Bollinger Bands, etc.)
- Price alerts system
- Daily reports
- Multiple exchanges support (EGX, NASDAQ, NYSE, LSE, etc.)

Architecture:
- VPS stores all data locally in SQLite database
- Scheduled sync runs every 5 minutes to update prices
- API returns cached data for fast response
- Reduces load on Hostinger shared hosting
"""

import os
import json
import time
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from flask import Flask, jsonify, request, g
from flask_cors import CORS
import threading
import schedule

# Configuration
DATABASE_PATH = os.environ.get('DATABASE_PATH', '/opt/egx-api/data/egx_data.db')
PORT = int(os.environ.get('PORT', 8010))

# Try to import data sources
DATA_SOURCES = {}

try:
    from tradingview_ta import TA_Handler, get_multiple_analysis, Interval
    DATA_SOURCES['tradingview'] = True
    print("✓ TradingView TA available")
except ImportError:
    DATA_SOURCES['tradingview'] = False
    print("✗ TradingView TA not available")

try:
    import yfinance as yf
    DATA_SOURCES['yfinance'] = True
    print("✓ yfinance available")
except ImportError:
    DATA_SOURCES['yfinance'] = False
    print("✗ yfinance not available")

try:
    import pandas as pd
    DATA_SOURCES['pandas'] = True
    print("✓ pandas available")
except ImportError:
    DATA_SOURCES['pandas'] = False
    print("✗ pandas not available")

try:
    import numpy as np
    DATA_SOURCES['numpy'] = True
    print("✓ numpy available")
except ImportError:
    DATA_SOURCES['numpy'] = False
    print("✗ numpy not available")

app = Flask(__name__)
CORS(app)

# ============================================================================
# ALL EGX STOCKS - COMPLETE LIST (295 stocks)
# ============================================================================

EGX_ALL_STOCKS = [
    "AALR", "ABUK", "ACAMD", "ACAP", "ACGC", "ACRO", "ACTF", "ADCI", "ADIB", "ADPC",
    "ADRI", "AFDI", "AFMC", "AIDC", "AIFI", "AIH", "AIHC", "AJWA", "ALCN", "ALEX",
    "ALUM", "AMER", "AMES", "AMIA", "AMOC", "AMPI", "ANFI", "APPC", "APRI", "APSW",
    "ARAB", "ARCC", "AREH", "ARPI", "ARVA", "ASCM", "ASPI", "ATLC", "ATQA", "AXPH",
    "BIDI", "BIGP", "BINV", "BIOC", "BLDG", "BONY", "BTFH", "CAED", "CALT", "CANA",
    "CAPE", "CCAP", "CCRS", "CEFM", "CERA", "CFGH", "CICH", "CIEB", "CIRA", "CLHO",
    "CNFN", "COMI", "COPR", "COSG", "CPCI", "CPME", "CRST", "CSAG", "DAPH", "DCCC",
    "DCRC", "DEIN", "DGTZ", "DIFC", "DMNH", "DOMT", "DSCW", "DTPP", "EALR", "EASB",
    "EAST", "EBSC", "ECAP", "EDBM", "EDFM", "EEII", "EFIC", "EFID", "EFIH", "EGAL",
    "EGAS", "EGBE", "EGCH", "EGREF", "EGSA", "EGTS", "EHDR", "EITP", "EIUD", "EKHO",
    "ELEC", "ELKA", "ELNA", "ELSH", "ELWA", "EMFD", "ENGC", "EOSB", "EPCO", "EPPK",
    "ESAC", "ESGH", "ESRS", "ETEL", "ETRS", "EXPA", "FAIT", "FAITA", "FERC", "FIRE",
    "FNAR", "FTNS", "FWRY", "GBCO", "GDWA", "GETO", "GGCC", "GGRN", "GIHD", "GMCC",
    "GMCI", "GOCO", "GPIM", "GPPL", "GRCA", "GSSC", "GTEX", "GTHE", "GTWL", "HBCO",
    "HCFI", "HDBK", "HELI", "HRHO", "IBCT", "ICFC", "ICID", "ICMI", "IDRE", "IEEC",
    "IFAP", "INEG", "INFI", "IRAX", "IRON", "ISMA", "ISMQ", "ISPH", "JUFO", "KABO",
    "KAHA", "KASABF", "KRDI", "KWIN", "KZPC", "LCSW", "LUTS", "MAAL", "MASR", "MBEG",
    "MBSC", "MCQE", "MCRO", "MEGM", "MENA", "MEPA", "MFPC", "MFSC", "MHOT", "MICH",
    "MILS", "MIPH", "MISR", "MKIT", "MMAT", "MNHD", "MOED", "MOIL", "MOIN", "MOSC",
    "MPCI", "MPCO", "MPRC", "MTEZ", "MTIE", "NAHO", "NAPR", "NARE", "NBKE", "NCCW",
    "NCGC", "NDRL", "NEDA", "NHPS", "NINH", "NIPH", "NSGB", "OBRI", "OCDI", "OCIC",
    "OCPH", "ODIN", "OFH", "OIH", "OLFI", "ORAS", "ORHD", "ORTE", "ORWE", "PACH",
    "PACL", "PETR", "PHAR", "PHDC", "PHGC", "PHTV", "PHYG", "PIOH", "PORT", "POUL",
    "PRCL", "PRDC", "PRMH", "PTCC", "QNBE", "RACC", "RAKT", "RAYA", "REAC", "RKAZ",
    "RMDA", "RMTV", "ROTO", "RREI", "RTVC", "RUBX", "SAIB", "SAUD", "SCEM", "SCFM",
    "SCTS", "SDTI", "SEIG", "SEIGA", "SIMO", "SIPC", "SKPC", "SMFR", "SMPP", "SNFC",
    "SNFI", "SPHT", "SPIN", "SPMD", "SUCE", "SUGR", "SVCE", "SWDY", "TALM", "TANM",
    "TAQA", "TELE", "TEXT", "TMGH", "TORA", "TRST", "TRTO", "TWSA", "UASG", "UBEE",
    "UEFM", "UEGC", "UNIP", "UNIT", "UPMS", "UTOP", "VALU", "VERT", "VLMR", "VLMRA",
    "WATP", "WCDF", "WKOL", "ZEOT", "ZMID"
]

# Popular EGX stocks (most traded)
EGX_POPULAR = [
    "COMI", "HRHO", "SWDY", "ETEL", "EKHO", "TMGH", "PHDC", "GTHE", "ESRS", "ORHD",
    "CIEB", "AMER", "HELI", "OCDI", "JUFO", "ABUK", "SKPC", "MNHD", "ESGH", "ALCN"
]

EGX_INDICES = [
    {"symbol": "EGX30", "tv_symbol": "EGX30", "name": "EGX 30 Index"},
    {"symbol": "EGX50", "tv_symbol": "EGX50", "name": "EGX 50 Index"},
    {"symbol": "EGX70", "tv_symbol": "EGX70", "name": "EGX 70 Index"},
    {"symbol": "EGX100", "tv_symbol": "EGX100", "name": "EGX 100 Index"},
    {"symbol": "EGX30C", "tv_symbol": "EGX30CAPPED", "name": "EGX 30 Capped"},
]

# ============================================================================
# SUPPORTED EXCHANGES
# ============================================================================

EXCHANGES = {
    "EGX": {"name": "Egyptian Exchange", "country": "Egypt", "currency": "EGP",
            "tradingview_screener": "egypt", "tradingview_exchange": "EGX", "active": True},
    "NASDAQ": {"name": "NASDAQ", "country": "USA", "currency": "USD",
               "tradingview_screener": "america", "tradingview_exchange": "NASDAQ", "active": True},
    "NYSE": {"name": "New York Stock Exchange", "country": "USA", "currency": "USD",
             "tradingview_screener": "america", "tradingview_exchange": "NYSE", "active": True},
    "AMEX": {"name": "American Stock Exchange", "country": "USA", "currency": "USD",
             "tradingview_screener": "america", "tradingview_exchange": "AMEX", "active": True},
    "LSE": {"name": "London Stock Exchange", "country": "UK", "currency": "GBP",
            "tradingview_screener": "uk", "tradingview_exchange": "LSE", "active": True},
    "TSE": {"name": "Tokyo Stock Exchange", "country": "Japan", "currency": "JPY",
            "tradingview_screener": "japan", "tradingview_exchange": "TSE", "active": True},
    "HKG": {"name": "Hong Kong Stock Exchange", "country": "Hong Kong", "currency": "HKD",
            "tradingview_screener": "hongkong", "tradingview_exchange": "HKG", "active": True},
    "NSE": {"name": "National Stock Exchange of India", "country": "India", "currency": "INR",
            "tradingview_screener": "india", "tradingview_exchange": "NSE", "active": True},
    "TADAWUL": {"name": "Saudi Stock Exchange", "country": "Saudi Arabia", "currency": "SAR",
                "tradingview_screener": "saudiarabia", "tradingview_exchange": "TADAWUL", "active": True},
    "DFM": {"name": "Dubai Financial Market", "country": "UAE", "currency": "AED",
            "tradingview_screener": "dubai", "tradingview_exchange": "DFM", "active": True},
}

# ============================================================================
# DATABASE SETUP
# ============================================================================

def get_db():
    """Get database connection."""
    try:
        from flask import g
        db = getattr(g, '_database', None)
        if db is None:
            os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
            db = g._database = sqlite3.connect(DATABASE_PATH)
            db.row_factory = sqlite3.Row
        return db
    except RuntimeError:
        os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        return conn

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database with all tables."""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # Stocks table - stores ALL stock data
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL UNIQUE,
            exchange TEXT DEFAULT 'EGX',
            name TEXT,
            current_price REAL,
            previous_close REAL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            volume INTEGER,
            change_amount REAL,
            change_percent REAL,
            last_updated TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Historical prices table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            exchange TEXT DEFAULT 'EGX',
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, exchange, date)
        )
    ''')
    
    # Indices table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS indices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL UNIQUE,
            name TEXT,
            current_value REAL,
            change_amount REAL,
            change_percent REAL,
            last_updated TEXT
        )
    ''')
    
    # Price alerts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            exchange TEXT DEFAULT 'EGX',
            alert_type TEXT DEFAULT 'price',
            target_price REAL NOT NULL,
            condition TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            triggered_at TEXT,
            triggered_price REAL
        )
    ''')
    
    # Daily reports table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS daily_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_date TEXT NOT NULL,
            report_type TEXT NOT NULL,
            exchange TEXT DEFAULT 'EGX',
            content TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(report_date, report_type, exchange)
        )
    ''')
    
    # Technical indicators cache
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS indicators_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            exchange TEXT DEFAULT 'EGX',
            indicator_type TEXT NOT NULL,
            value REAL,
            signal TEXT,
            data TEXT,
            calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(symbol, exchange, indicator_type)
        )
    ''')
    
    # Create indexes
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_alerts_status ON price_alerts(status)')
    
    # Insert all EGX stocks
    for symbol in EGX_ALL_STOCKS:
        cursor.execute('''
            INSERT OR IGNORE INTO stocks (symbol, exchange) VALUES (?, 'EGX')
        ''', (symbol,))
    
    # Insert EGX indices
    for idx in EGX_INDICES:
        cursor.execute('''
            INSERT OR IGNORE INTO indices (symbol, name) VALUES (?, ?)
        ''', (idx['symbol'], idx['name']))
    
    conn.commit()
    conn.close()
    print(f"✓ Database initialized with {len(EGX_ALL_STOCKS)} EGX stocks")

# ============================================================================
# TECHNICAL INDICATORS
# ============================================================================

def calculate_sma(prices: List[float], period: int) -> Optional[float]:
    if len(prices) < period:
        return None
    return sum(prices[-period:]) / period

def calculate_ema(prices: List[float], period: int) -> Optional[float]:
    if len(prices) < period:
        return None
    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema
    return ema

def calculate_rsi(prices: List[float], period: int = 14) -> Optional[Dict]:
    if len(prices) < period + 1:
        return None
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        rsi = 100
    else:
        rsi = 100 - (100 / (1 + avg_gain / avg_loss))
    signal = "overbought" if rsi >= 70 else "oversold" if rsi <= 30 else "neutral"
    return {"value": round(rsi, 2), "signal": signal}

def calculate_macd(prices: List[float]) -> Optional[Dict]:
    if len(prices) < 26:
        return None
    ema_12 = calculate_ema(prices, 12)
    ema_26 = calculate_ema(prices, 26)
    if ema_12 is None or ema_26 is None:
        return None
    macd_line = ema_12 - ema_26
    signal_line = macd_line * 0.9
    histogram = macd_line - signal_line
    trend = "bullish" if macd_line > signal_line and histogram > 0 else "bearish" if macd_line < signal_line and histogram < 0 else "neutral"
    return {"macd": round(macd_line, 4), "signal": round(signal_line, 4), "histogram": round(histogram, 4), "trend": trend}

def calculate_bollinger_bands(prices: List[float], period: int = 20) -> Optional[Dict]:
    if len(prices) < period:
        return None
    recent = prices[-period:]
    sma = sum(recent) / period
    variance = sum((p - sma) ** 2 for p in recent) / period
    std_dev = variance ** 0.5
    return {
        "upper": round(sma + (2 * std_dev), 2),
        "middle": round(sma, 2),
        "lower": round(sma - (2 * std_dev), 2),
        "current": prices[-1]
    }

def calculate_all_indicators(prices: List[float]) -> Dict:
    indicators = {"sma": {}, "ema": {}, "rsi": None, "macd": None, "bollinger_bands": None}
    for period in [5, 10, 20, 50]:
        sma = calculate_sma(prices, period)
        ema = calculate_ema(prices, period)
        if sma: indicators["sma"][period] = round(sma, 2)
        if ema: indicators["ema"][period] = round(ema, 2)
    indicators["rsi"] = calculate_rsi(prices)
    indicators["macd"] = calculate_macd(prices)
    indicators["bollinger_bands"] = calculate_bollinger_bands(prices)
    return indicators

# ============================================================================
# DATA FETCHING FUNCTIONS
# ============================================================================

def fetch_from_tradingview(symbol: str, exchange: str = "EGX") -> Optional[Dict]:
    """Fetch single stock from TradingView."""
    if not DATA_SOURCES.get('tradingview'):
        return None
    
    ex_config = EXCHANGES.get(exchange, {})
    screener = ex_config.get('tradingview_screener', 'egypt')
    tv_exchange = ex_config.get('tradingview_exchange', exchange)
    
    try:
        handler = TA_Handler(symbol=symbol, exchange=tv_exchange, screener=screener, interval="1d")
        analysis = handler.get_analysis()
        if analysis:
            return {
                "symbol": symbol,
                "exchange": exchange,
                "price": analysis.indicators.get("close", 0),
                "open": analysis.indicators.get("open", 0),
                "high": analysis.indicators.get("high", 0),
                "low": analysis.indicators.get("low", 0),
                "volume": analysis.indicators.get("volume", 0),
                "change": analysis.indicators.get("change", 0),
                "change_percent": analysis.indicators.get("change_perc", 0),
                "timestamp": datetime.now().isoformat()
            }
    except Exception as e:
        print(f"Error fetching {symbol}: {e}")
    return None

def fetch_batch_tradingview(symbols: List[str], exchange: str = "EGX") -> Tuple[List[Dict], List[str]]:
    """Fetch multiple stocks from TradingView."""
    if not DATA_SOURCES.get('tradingview'):
        return [], ["TradingView not available"]
    
    results = []
    errors = []
    ex_config = EXCHANGES.get(exchange, {})
    screener = ex_config.get('tradingview_screener', 'egypt')
    tv_exchange = ex_config.get('tradingview_exchange', exchange)
    
    tv_symbols = [f"{tv_exchange}:{s}" for s in symbols]
    
    # Process in batches of 20
    for i in range(0, len(tv_symbols), 20):
        batch = tv_symbols[i:i+20]
        try:
            analysis = get_multiple_analysis(symbols=batch, screener=screener, interval="1d")
            for sym, data in analysis.items():
                if data:
                    clean = sym.split(":")[1] if ":" in sym else sym
                    results.append({
                        "symbol": clean,
                        "exchange": exchange,
                        "price": data.indicators.get("close", 0),
                        "open": data.indicators.get("open", 0),
                        "high": data.indicators.get("high", 0),
                        "low": data.indicators.get("low", 0),
                        "volume": data.indicators.get("volume", 0),
                        "change": data.indicators.get("change", 0),
                        "change_percent": data.indicators.get("change_perc", 0),
                        "timestamp": datetime.now().isoformat()
                    })
            time.sleep(0.5)
        except Exception as e:
            errors.append(str(e))
            time.sleep(1)
    
    return results, errors

def fetch_history_yfinance(symbol: str, period: str = "1y") -> Optional[Dict]:
    """Fetch historical data using yfinance."""
    if not DATA_SOURCES.get('yfinance'):
        return None
    
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period)
        if hist.empty:
            return None
        
        rows = []
        for date, row in hist.iterrows():
            rows.append({
                "date": date.strftime("%Y-%m-%d"),
                "open": round(row.get("Open", 0), 2),
                "high": round(row.get("High", 0), 2),
                "low": round(row.get("Low", 0), 2),
                "close": round(row.get("Close", 0), 2),
                "volume": int(row.get("Volume", 0))
            })
        
        return {
            "symbol": symbol,
            "period": period,
            "points": len(rows),
            "rows": rows,
            "summary": {
                "start_date": rows[0]["date"] if rows else None,
                "end_date": rows[-1]["date"] if rows else None,
                "change_percent": round((rows[-1]["close"] - rows[0]["close"]) / rows[0]["close"] * 100, 2) if len(rows) > 1 else 0
            }
        }
    except Exception as e:
        print(f"yfinance error for {symbol}: {e}")
        return None

# ============================================================================
# SYNC FUNCTIONS
# ============================================================================

def sync_all_stocks():
    """Sync ALL EGX stocks from TradingView to database."""
    print(f"[{datetime.now()}] Starting full sync of {len(EGX_ALL_STOCKS)} stocks...")
    conn = get_db()
    cursor = conn.cursor()
    
    updated = 0
    errors = []
    
    # Process in batches
    for i in range(0, len(EGX_ALL_STOCKS), 20):
        batch = EGX_ALL_STOCKS[i:i+20]
        results, batch_errors = fetch_batch_tradingview(batch, "EGX")
        
        for stock in results:
            cursor.execute('''
                UPDATE stocks SET
                    current_price = ?,
                    previous_close = ?,
                    open_price = ?,
                    high_price = ?,
                    low_price = ?,
                    volume = ?,
                    change_amount = ?,
                    change_percent = ?,
                    last_updated = ?
                WHERE symbol = ?
            ''', (stock['price'], stock.get('open', 0) - stock.get('change', 0),
                  stock.get('open'), stock.get('high'), stock.get('low'),
                  stock.get('volume'), stock.get('change'), stock.get('change_percent'),
                  stock['timestamp'], stock['symbol']))
            if cursor.rowcount > 0:
                updated += 1
        
        errors.extend(batch_errors)
        time.sleep(0.3)
    
    conn.commit()
    print(f"[{datetime.now()}] Synced {updated} stocks, {len(errors)} errors")
    return updated, errors

def sync_indices():
    """Sync EGX indices."""
    conn = get_db()
    cursor = conn.cursor()
    
    symbols = [idx['tv_symbol'] for idx in EGX_INDICES]
    results, _ = fetch_batch_tradingview(symbols, "EGX")
    
    for data in results:
        symbol = data['symbol']
        # Map TV symbol back to our symbol
        for idx in EGX_INDICES:
            if idx['tv_symbol'] == symbol:
                symbol = idx['symbol']
                break
        
        cursor.execute('''
            UPDATE indices SET
                current_value = ?,
                change_amount = ?,
                change_percent = ?,
                last_updated = ?
            WHERE symbol = ?
        ''', (data['price'], data.get('change'), data.get('change_percent'),
              data['timestamp'], symbol))
    
    conn.commit()
    print(f"[{datetime.now()}] Synced {len(results)} indices")

# ============================================================================
# API ROUTES
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM stocks")
    stock_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE current_price IS NOT NULL")
    priced_count = cursor.fetchone()[0]
    
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "data_sources": DATA_SOURCES,
        "database": {
            "total_stocks": stock_count,
            "stocks_with_prices": priced_count
        },
        "port": PORT
    })

@app.route('/api/stocks/all', methods=['GET'])
def get_all_stocks():
    """Get ALL stocks from database - returns complete list."""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT symbol, exchange, name, current_price, previous_close, 
               open_price, high_price, low_price, volume, 
               change_amount, change_percent, last_updated
        FROM stocks 
        WHERE current_price IS NOT NULL
        ORDER BY symbol
    ''')
    
    stocks = []
    for row in cursor.fetchall():
        stocks.append({
            "symbol": row['symbol'],
            "exchange": row['exchange'],
            "name": row['name'],
            "price": row['current_price'],
            "previous_close": row['previous_close'],
            "open": row['open_price'],
            "high": row['high_price'],
            "low": row['low_price'],
            "volume": row['volume'],
            "change": row['change_amount'],
            "change_percent": row['change_percent'],
            "last_updated": row['last_updated']
        })
    
    return jsonify({
        "success": True,
        "count": len(stocks),
        "total_in_database": len(EGX_ALL_STOCKS),
        "data": stocks,
        "timestamp": datetime.now().isoformat()
    })

@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    """Get stocks with optional filtering."""
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', 0, type=int)
    search = request.args.get('search', '').upper()
    
    conn = get_db()
    cursor = conn.cursor()
    
    query = '''
        SELECT symbol, exchange, name, current_price, previous_close,
               open_price, high_price, low_price, volume,
               change_amount, change_percent, last_updated
        FROM stocks WHERE current_price IS NOT NULL
    '''
    params = []
    
    if search:
        query += ' AND symbol LIKE ?'
        params.append(f'%{search}%')
    
    query += ' ORDER BY symbol'
    
    if limit:
        query += f' LIMIT {limit} OFFSET {offset}'
    
    cursor.execute(query, params)
    
    stocks = [{
        "symbol": row['symbol'],
        "exchange": row['exchange'],
        "price": row['current_price'],
        "open": row['open_price'],
        "high": row['high_price'],
        "low": row['low_price'],
        "volume": row['volume'],
        "change": row['change_amount'],
        "change_percent": row['change_percent'],
        "last_updated": row['last_updated']
    } for row in cursor.fetchall()]
    
    return jsonify({
        "success": True,
        "count": len(stocks),
        "data": stocks
    })

@app.route('/api/stock/<symbol>', methods=['GET'])
def get_stock(symbol):
    """Get single stock details."""
    symbol = symbol.upper()
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM stocks WHERE symbol = ?
    ''', (symbol,))
    
    row = cursor.fetchone()
    
    if row:
        return jsonify({
            "success": True,
            "data": dict(row)
        })
    
    # Try to fetch from TradingView
    data = fetch_from_tradingview(symbol, "EGX")
    if data:
        return jsonify({"success": True, "data": data})
    
    return jsonify({"success": False, "error": "Stock not found"}), 404

@app.route('/api/indices', methods=['GET'])
def get_indices():
    """Get all EGX indices."""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM indices ORDER BY symbol')
    
    indices = [dict(row) for row in cursor.fetchall()]
    
    return jsonify({
        "success": True,
        "count": len(indices),
        "data": indices
    })

@app.route('/api/history/<symbol>', methods=['GET'])
def get_history(symbol):
    """Get historical price data."""
    symbol = symbol.upper()
    period = request.args.get('period', '1y')
    
    # Check database first
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT date, open, high, low, close, volume 
        FROM price_history 
        WHERE symbol = ? 
        ORDER BY date DESC LIMIT 365
    ''', (symbol,))
    
    rows = cursor.fetchall()
    
    if rows:
        return jsonify({
            "success": True,
            "data": {
                "symbol": symbol,
                "points": len(rows),
                "rows": [dict(r) for r in rows],
                "source": "database"
            }
        })
    
    # Try yfinance for international stocks
    if DATA_SOURCES.get('yfinance'):
        data = fetch_history_yfinance(symbol, period)
        if data:
            return jsonify({"success": True, "data": data})
    
    return jsonify({"success": False, "error": "Historical data not available"}), 404

@app.route('/api/indicators/<symbol>', methods=['GET'])
def get_indicators(symbol):
    """Get technical indicators for a stock."""
    symbol = symbol.upper()
    
    # Get historical data first
    if DATA_SOURCES.get('yfinance'):
        hist = fetch_history_yfinance(symbol, '1y')
        
        if hist and hist.get('rows'):
            closes = [r['close'] for r in hist['rows']]
            indicators = calculate_all_indicators(closes)
            
            return jsonify({
                "success": True,
                "data": {
                    "symbol": symbol,
                    "current_price": closes[-1] if closes else None,
                    "indicators": indicators
                }
            })
    
    # Check database
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT data FROM indicators_cache 
        WHERE symbol = ? AND calculated_at > datetime('now', '-1 hour')
    ''', (symbol,))
    
    row = cursor.fetchone()
    if row:
        return jsonify({
            "success": True,
            "data": json.loads(row['data'])
        })
    
    return jsonify({"success": False, "error": "Indicators not available"}), 404

@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    """Get all price alerts."""
    status = request.args.get('status', 'active')
    
    conn = get_db()
    cursor = conn.cursor()
    
    if status == 'all':
        cursor.execute('SELECT * FROM price_alerts ORDER BY created_at DESC')
    else:
        cursor.execute('SELECT * FROM price_alerts WHERE status = ? ORDER BY created_at DESC', (status,))
    
    alerts = [dict(row) for row in cursor.fetchall()]
    
    return jsonify({
        "success": True,
        "count": len(alerts),
        "alerts": alerts
    })

@app.route('/api/alerts', methods=['POST'])
def create_alert():
    """Create a new price alert."""
    data = request.get_json()
    
    required = ['symbol', 'target_price', 'condition']
    for field in required:
        if field not in data:
            return jsonify({"success": False, "error": f"Missing {field}"}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO price_alerts (symbol, exchange, target_price, condition, status)
        VALUES (?, ?, ?, ?, 'active')
    ''', (data['symbol'].upper(), data.get('exchange', 'EGX'),
          float(data['target_price']), data['condition']))
    
    conn.commit()
    
    return jsonify({
        "success": True,
        "alert_id": cursor.lastrowid
    })

@app.route('/api/alerts/<int:alert_id>', methods=['DELETE'])
def delete_alert(alert_id):
    """Delete a price alert."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM price_alerts WHERE id = ?', (alert_id,))
    conn.commit()
    
    return jsonify({"success": True})

@app.route('/api/reports/daily', methods=['GET'])
def get_daily_report():
    """Get or generate daily market report."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Get market stats
    cursor.execute('''
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as gainers,
            SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as losers,
            AVG(change_percent) as avg_change
        FROM stocks WHERE current_price IS NOT NULL
    ''')
    
    stats = cursor.fetchone()
    
    # Top gainers
    cursor.execute('''
        SELECT symbol, current_price, change_percent, volume
        FROM stocks 
        WHERE current_price IS NOT NULL AND change_percent > 0
        ORDER BY change_percent DESC LIMIT 10
    ''')
    gainers = [dict(row) for row in cursor.fetchall()]
    
    # Top losers
    cursor.execute('''
        SELECT symbol, current_price, change_percent, volume
        FROM stocks 
        WHERE current_price IS NOT NULL AND change_percent < 0
        ORDER BY change_percent ASC LIMIT 10
    ''')
    losers = [dict(row) for row in cursor.fetchall()]
    
    # Most active
    cursor.execute('''
        SELECT symbol, current_price, change_percent, volume
        FROM stocks 
        WHERE current_price IS NOT NULL AND volume > 0
        ORDER BY volume DESC LIMIT 10
    ''')
    most_active = [dict(row) for row in cursor.fetchall()]
    
    report = {
        "report_date": datetime.now().strftime("%Y-%m-%d"),
        "generated_at": datetime.now().isoformat(),
        "market_summary": {
            "total_stocks": stats['total'],
            "gainers": stats['gainers'],
            "losers": stats['losers'],
            "unchanged": stats['total'] - (stats['gainers'] or 0) - (stats['losers'] or 0),
            "average_change": round(stats['avg_change'] or 0, 2)
        },
        "top_gainers": gainers,
        "top_losers": losers,
        "most_active": most_active,
        "market_sentiment": "bullish" if (stats['avg_change'] or 0) > 0.5 else "bearish" if (stats['avg_change'] or 0) < -0.5 else "neutral"
    }
    
    return jsonify({
        "success": True,
        "data": report
    })

@app.route('/api/exchanges', methods=['GET'])
def list_exchanges():
    """List all supported exchanges."""
    exchanges = [{"code": k, "name": v['name'], "country": v['country'], "currency": v['currency']}
                 for k, v in EXCHANGES.items() if v.get('active')]
    
    return jsonify({
        "success": True,
        "count": len(exchanges),
        "exchanges": exchanges
    })

@app.route('/api/search', methods=['GET'])
def search_stocks():
    """Search for stocks."""
    query = request.args.get('q', '').upper()
    
    if not query:
        return jsonify({"success": False, "error": "Missing query"}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT symbol, name, current_price, change_percent
        FROM stocks 
        WHERE symbol LIKE ? AND current_price IS NOT NULL
        ORDER BY symbol LIMIT 20
    ''', (f'%{query}%',))
    
    results = [dict(row) for row in cursor.fetchall()]
    
    return jsonify({
        "success": True,
        "query": query,
        "count": len(results),
        "results": results
    })

@app.route('/api/sync', methods=['POST'])
def manual_sync():
    """Manually trigger data sync."""
    updated, errors = sync_all_stocks()
    sync_indices()
    
    return jsonify({
        "success": True,
        "stocks_updated": updated,
        "errors": errors[:5] if errors else []
    })

# ============================================================================
# SCHEDULED TASKS
# ============================================================================

def run_scheduler():
    """Background scheduler for data sync."""
    schedule.every(5).minutes.do(sync_all_stocks)
    schedule.every(5).minutes.do(sync_indices)
    
    while True:
        schedule.run_pending()
        time.sleep(60)

# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    print(f"\n{'='*60}")
    print(f"EGX Data API Service")
    print(f"{'='*60}")
    print(f"Port: {PORT}")
    print(f"Database: {DATABASE_PATH}")
    print(f"Stocks configured: {len(EGX_ALL_STOCKS)}")
    print(f"Data sources: {DATA_SOURCES}")
    print(f"{'='*60}\n")
    
    # Initialize database
    init_db()
    
    # Start scheduler
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    print("✓ Background scheduler started (syncs every 5 minutes)")
    
    # Run initial sync
    print("Running initial sync...")
    sync_all_stocks()
    sync_indices()
    
    # Start Flask
    print(f"\nStarting API server on port {PORT}...")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
