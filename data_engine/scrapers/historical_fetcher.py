#!/usr/bin/env python3
"""
🔥 Historical Data Fetcher - Full System
========================================
سحب البيانات التاريخية من Yahoo Finance لكل الأصول

المميزات:
- سحب 5 سنوات من البيانات التاريخية
- دعم الأسهم والكريبتو والمعادن والعملات
- تخزين في قاعدة بيانات مخصصة
- سجلات تفصيلية كاملة
"""

import json
import sys
import os
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path

# Paths
DATA_DIR = Path(__file__).parent.parent.parent / 'db'
DB_PATH = DATA_DIR / 'data_engine.db'
HISTORICAL_DB = DATA_DIR / 'historical.db'
STATUS_FILE = DATA_DIR / 'historical_status.json'
ENGINE_STATUS_FILE = DATA_DIR / 'engine_status.json'

# Global logs
all_logs = []

def log(msg, level='INFO'):
    """Log message to console and status file"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    log_entry = f"[{timestamp}] [{level}] {msg}"
    print(log_entry)
    all_logs.append(log_entry)
    
    # Keep only last 200 logs
    if len(all_logs) > 200:
        all_logs[:] = all_logs[-200:]
    
    # Update engine status
    update_engine_logs(log_entry)

def update_engine_logs(log_entry):
    """Update engine status logs"""
    try:
        if ENGINE_STATUS_FILE.exists():
            with open(ENGINE_STATUS_FILE, 'r') as f:
                status = json.load(f)
        else:
            status = {'logs': [], 'errors': []}
        
        if 'logs' not in status:
            status['logs'] = []
        
        status['logs'].append(log_entry)
        status['logs'] = status['logs'][-100:]
        
        if level == 'ERROR':
            if 'errors' not in status:
                status['errors'] = []
            status['errors'].append(log_entry)
            status['errors'] = status['errors'][-20:]
        
        with open(ENGINE_STATUS_FILE, 'w') as f:
            json.dump(status, f, indent=2, ensure_ascii=False)
    except:
        pass

def update_status(status_update):
    """Update historical status file"""
    try:
        if STATUS_FILE.exists():
            with open(STATUS_FILE, 'r') as f:
                status = json.load(f)
        else:
            status = {'running': False, 'progress': {}, 'results': []}
        
        status.update(status_update)
        status['logs'] = all_logs[-50:]
        
        with open(STATUS_FILE, 'w') as f:
            json.dump(status, f, indent=2, ensure_ascii=False)
    except:
        pass

# Yahoo Finance suffixes per market — used ONLY for API calls, NEVER stored in DB.
# .CA = Cairo (EGX), .SR = Saudi, .KW = Kuwait, .QA = Qatar, .AE = UAE
# The base ticker (before the dot) is what gets stored in all databases.
YF_SUFFIXES = {'.CA', '.SR', '.KW', '.QA', '.AE', '.BH'}

def strip_yf_suffix(yahoo_symbol: str) -> str:
    """Strip Yahoo Finance market suffix to get the base EGX/Tadawul/KSE ticker.
    Examples: COMI.CA → COMI, 1120.SR → 1120, NBK.KW → NBK
    For non-stock symbols (crypto, futures, indices) return as-is.
    """
    upper = yahoo_symbol.upper().strip()
    for suffix in YF_SUFFIXES:
        if upper.endswith(suffix):
            return upper[:-len(suffix)]
    return upper

# جميع الأصول المدعومة
# Format: (yahoo_symbol, display_name)
# yahoo_symbol includes the YF suffix for API calls only.
# The base ticker (strip_yf_suffix) is stored in the database.
YAHOO_SYMBOLS = {
    '🇪🇬 EGX - الأسهم المصرية': {
        'symbols': [
            ('COMI.CA', 'Commercial International Bank'),
            ('HRHO.CA', 'Housing and Development Bank'),
            ('CIEB.CA', 'Cairo International Bank'),
            ('ETEL.CA', 'Telecom Egypt'),
            ('ORWE.CA', 'Orascom Investment'),
            ('HELI.CA', 'Heliopolis Housing'),
            ('SWDY.CA', 'El Sewedy Electric'),
            ('EAST.CA', 'Eastern Company'),
            ('AMOC.CA', 'Alexandria Mineral Oils'),
            ('EMFD.CA', 'EMFD'),
            ('PHDC.CA', 'PHDC'),
        ]
    },
    '🇸🇦 TADAWUL - الأسهم السعودية': {
        'symbols': [
            ('1120.SR', 'Al Rajhi Bank'),
            ('1060.SR', 'Saudi National Bank'),
            ('1180.SR', 'Alinma Bank'),
            ('2222.SR', 'Saudi Aramco'),
            ('2010.SR', 'SABIC'),
            ('7010.SR', 'Almarai'),
            ('4001.SR', 'Saudi Telecom'),
            ('4210.SR', 'Jarir Marketing'),
            ('4002.SR', 'Dr Sulaiman Al Habib'),
            ('8240.SR', 'Al Rajhi Takaful'),
        ]
    },
    '🇰🇼 KSE - الأسهم الكويتية': {
        'symbols': [
            ('NBK.KW', 'National Bank of Kuwait'),
            ('KFH.KW', 'Kuwait Finance House'),
            ('BOUBYAN.KW', 'Boubyan Bank'),
            ('ZAIN.KW', 'Zain Group'),
        ]
    },
    '🇶🇦 QSE - الأسهم القطرية': {
        'symbols': [
            ('QNBK.QA', 'Qatar National Bank'),
            ('QIBK.QA', 'Qatar Islamic Bank'),
            ('MPHC.QA', 'Mesaieed Petrochemical'),
        ]
    },
    '🥇 المعادن الثمينة': {
        'symbols': [
            ('GC=F', 'Gold Futures'),
            ('SI=F', 'Silver Futures'),
            ('CL=F', 'Crude Oil'),
            ('HG=F', 'Copper Futures'),
            ('PL=F', 'Platinum'),
        ]
    },
    '💱 العملات العربية': {
        'symbols': [
            ('EGPUSD=X', 'EGP/USD'),
            ('SARUSD=X', 'SAR/USD'),
            ('KWDUSD=X', 'KWD/USD'),
            ('QARUSD=X', 'QAR/USD'),
            ('AEDUSD=X', 'AED/USD'),
        ]
    },
    '₿ العملات الرقمية': {
        'symbols': [
            ('BTC-USD', 'Bitcoin'),
            ('ETH-USD', 'Ethereum'),
            ('BNB-USD', 'Binance Coin'),
            ('XRP-USD', 'Ripple'),
            ('SOL-USD', 'Solana'),
            ('ADA-USD', 'Cardano'),
            ('DOGE-USD', 'Dogecoin'),
            ('DOT-USD', 'Polkadot'),
            ('LINK-USD', 'Chainlink'),
            ('AVAX-USD', 'Avalanche'),
            ('MATIC-USD', 'Polygon'),
            ('UNI-USD', 'Uniswap'),
            ('ATOM-USD', 'Cosmos'),
        ]
    },
    '📈 المؤشرات العالمية': {
        'symbols': [
            ('^GSPC', 'S&P 500'),
            ('^DJI', 'Dow Jones'),
            ('^IXIC', 'NASDAQ'),
            ('^N225', 'Nikkei 225'),
            ('^FTSE', 'FTSE 100'),
        ]
    }
}

def init_database():
    """Create historical database tables"""
    conn = sqlite3.connect(HISTORICAL_DB)
    cursor = conn.cursor()
    
    # Main historical data table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS historical_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            category TEXT,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            fetch_date TEXT,
            UNIQUE(symbol, date)
        )
    ''')
    
    # Create indexes for faster queries
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbol ON historical_prices(symbol)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_date ON historical_prices(date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_category ON historical_prices(category)')
    
    # Daily prices table for current prices
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS daily_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            category TEXT,
            price_date TEXT NOT NULL,
            price REAL,
            change_percent REAL,
            volume INTEGER,
            fetch_time TEXT,
            UNIQUE(symbol, price_date)
        )
    ''')
    
    conn.commit()
    conn.close()
    log("✅ Database initialized successfully")

def fetch_historical_data(symbol, period='5y', interval='1d'):
    """Fetch historical data from Yahoo Finance"""
    try:
        import yfinance as yf
        
        log(f"📥 Fetching {symbol}...")
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval=interval)
        
        if hist.empty:
            log(f"⚠️ No data for {symbol}", 'WARNING')
            return None
        
        # Reset index to get date as column
        hist = hist.reset_index()
        
        # Convert to list of dicts
        data = []
        for _, row in hist.iterrows():
            date_val = row['Date']
            if hasattr(date_val, 'strftime'):
                date_str = date_val.strftime('%Y-%m-%d')
            else:
                date_str = str(date_val)[:10]
            
            close_price = float(row['Close']) if row['Close'] else 0
            volume = int(row['Volume']) if row['Volume'] else 0
            
            # Skip if no close price
            if close_price <= 0:
                continue
            
            data.append({
                'date': date_str,
                'open': float(row['Open']) if row['Open'] else close_price,
                'high': float(row['High']) if row['High'] else close_price,
                'low': float(row['Low']) if row['Low'] else close_price,
                'close': close_price,
                'volume': volume
            })
        
        log(f"   📊 Got {len(data)} records for {symbol}")
        return data
        
    except ImportError:
        log("❌ yfinance not installed. Run: pip install yfinance", 'ERROR')
        return None
    except Exception as e:
        log(f"❌ Error fetching {symbol}: {str(e)[:80]}", 'ERROR')
        return None

def save_to_historical_db(symbol, name, category, data):
    """Save data to historical database"""
    if not data:
        return 0, 0
    
    conn = sqlite3.connect(HISTORICAL_DB)
    cursor = conn.cursor()
    
    inserted = 0
    updated = 0
    fetch_time = datetime.now().isoformat()
    
    for row in data:
        try:
            # Check if exists
            cursor.execute(
                'SELECT id FROM historical_prices WHERE symbol = ? AND date = ?',
                (symbol, row['date'])
            )
            exists = cursor.fetchone()
            
            if exists:
                cursor.execute('''
                    UPDATE historical_prices SET
                        open = ?, high = ?, low = ?, close = ?, volume = ?, fetch_date = ?
                    WHERE symbol = ? AND date = ?
                ''', (
                    row['open'], row['high'], row['low'], row['close'], row['volume'], fetch_time,
                    symbol, row['date']
                ))
                updated += 1
            else:
                cursor.execute('''
                    INSERT INTO historical_prices 
                    (symbol, name, category, date, open, high, low, close, volume, fetch_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    symbol, name, category, row['date'],
                    row['open'], row['high'], row['low'], row['close'], row['volume'], fetch_time
                ))
                inserted += 1
        except Exception as e:
            log(f"   ⚠️ Error saving {row['date']}: {str(e)[:40]}", 'WARNING')
    
    conn.commit()
    conn.close()
    
    return inserted, updated

def fetch_all_historical(period='5y'):
    """Fetch all historical data"""
    log("=" * 60)
    log("🔥 HISTORICAL DATA FETCHER - STARTING")
    log(f"📅 Period: {period}")
    log(f"📂 Database: {HISTORICAL_DB}")
    log("=" * 60)
    
    # Initialize database
    init_database()
    
    # Calculate totals
    total_symbols = sum(len(c['symbols']) for c in YAHOO_SYMBOLS.values())
    log(f"📊 Total symbols to fetch: {total_symbols}")
    
    current = 0
    success_count = 0
    fail_count = 0
    total_records = 0
    
    update_status({
        'running': True,
        'progress': {'current': 0, 'total': total_symbols, 'symbol': ''},
        'start_time': datetime.now().isoformat()
    })
    
    all_results = []
    
    for category, category_data in YAHOO_SYMBOLS.items():
        log("")
        log(f"{'='*50}")
        log(f"📊 Processing: {category}")
        log(f"{'='*50}")
        
        category_count = 0
        category_records = 0
        
        for yahoo_symbol, name in category_data['symbols']:
            current += 1
            
            # Strip Yahoo Finance suffix for storage (COMI.CA → COMI, 1120.SR → 1120)
            base_symbol = strip_yf_suffix(yahoo_symbol)
            
            update_status({
                'progress': {
                    'current': current,
                    'total': total_symbols,
                    'symbol': f"{base_symbol} ({yahoo_symbol})" if base_symbol != yahoo_symbol else yahoo_symbol,
                    'category': category
                }
            })
            
            # Fetch data using the full Yahoo symbol (with suffix)
            data = fetch_historical_data(yahoo_symbol, period=period)
            
            if data and len(data) > 0:
                # Store with the BASE symbol (without .CA/.SR/.KW suffix)
                inserted, updated = save_to_historical_db(base_symbol, name, category, data)
                total_records += len(data)
                success_count += 1
                category_count += 1
                category_records += len(data)
                
                # Get price change
                if len(data) >= 2:
                    prev_close = data[-2]['close']
                    curr_close = data[-1]['close']
                    change_pct = ((curr_close - prev_close) / prev_close * 100) if prev_close > 0 else 0
                else:
                    change_pct = 0
                
                result = {
                    'symbol': base_symbol,
                    'yahoo_symbol': yahoo_symbol,
                    'name': name,
                    'category': category,
                    'days': len(data),
                    'inserted': inserted,
                    'updated': updated,
                    'latest_close': data[-1]['close'],
                    'latest_date': data[-1]['date'],
                    'change_percent': round(change_pct, 2),
                    'status': 'success'
                }
                
                log(f"   ✅ {base_symbol} ({yahoo_symbol}): {len(data)} days | Latest: ${data[-1]['close']:.4f} | Change: {change_pct:+.2f}%")
            else:
                fail_count += 1
                result = {
                    'symbol': base_symbol,
                    'yahoo_symbol': yahoo_symbol,
                    'name': name,
                    'category': category,
                    'days': 0,
                    'status': 'failed'
                }
                log(f"   ❌ {base_symbol} ({yahoo_symbol}): No data", 'ERROR')
            
            all_results.append(result)
            
            # Rate limiting
            time.sleep(0.5)
        
        log(f"   📊 {category}: {category_count} symbols, {category_records} records")
    
    # Final summary
    log("")
    log("=" * 60)
    log("🎉 HISTORICAL DATA FETCH COMPLETE")
    log("=" * 60)
    log(f"✅ Success: {success_count}/{total_symbols} symbols")
    log(f"❌ Failed: {fail_count} symbols")
    log(f"📊 Total records: {total_records:,}")
    
    # Get database stats
    try:
        conn = sqlite3.connect(HISTORICAL_DB)
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM historical_prices')
        db_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(DISTINCT symbol) FROM historical_prices')
        symbol_count = cursor.fetchone()[0]
        conn.close()
        log(f"💾 Database: {db_count:,} records | {symbol_count} symbols")
    except:
        pass
    
    log("=" * 60)
    
    update_status({
        'running': False,
        'results': all_results,
        'summary': {
            'success': success_count,
            'failed': fail_count,
            'total_records': total_records
        },
        'end_time': datetime.now().isoformat()
    })
    
    return all_results

def get_historical_summary():
    """Get summary of historical data"""
    try:
        if not HISTORICAL_DB.exists():
            return {'total_records': 0, 'symbols': 0, 'categories': []}
        
        conn = sqlite3.connect(HISTORICAL_DB)
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM historical_prices')
        total_records = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(DISTINCT symbol) FROM historical_prices')
        symbols = cursor.fetchone()[0]
        
        cursor.execute('''
            SELECT category, COUNT(DISTINCT symbol) as count, COUNT(*) as records
            FROM historical_prices 
            GROUP BY category
        ''')
        categories = [{'name': row[0], 'symbols': row[1], 'records': row[2]} for row in cursor.fetchall()]
        
        conn.close()
        
        return {
            'total_records': total_records,
            'symbols': symbols,
            'categories': categories
        }
    except Exception as e:
        return {'total_records': 0, 'symbols': 0, 'categories': [], 'error': str(e)}

if __name__ == '__main__':
    try:
        period = sys.argv[1] if len(sys.argv) > 1 else '5y'
        fetch_all_historical(period=period)
    except Exception as e:
        log(f"❌ CRITICAL ERROR: {str(e)}", 'ERROR')
        import traceback
        traceback.print_exc()
        sys.exit(1)
