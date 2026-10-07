#!/usr/bin/env python3
"""
🔥 Yahoo Finance Historical Data Fetcher - 5 Years
====================================================
سحب البيانات التاريخية من آخر 5 سنوات لكل الأصول الموجودة

المصادر:
- 🇪🇬 الأسهم المصرية (EGX)
- 🇸🇦 الأسهم السعودية (TADAWUL)
- 🇰🇼 الأسهم الكويتية (KSE)
- 🇶🇦 الأسهم القطرية (QE)
- 🥇 الذهب والمعادن
- 💱 العملات العربية
- ₿ العملات الرقمية

البيانات:
- Open, High, Low, Close (OHLC)
- Volume
- فترة: 5 سنوات يومي
"""

import json
import sys
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
import time

# Paths - all unified in /db folder
DATA_DIR = Path(__file__).parent.parent.parent / 'db'
STATUS_FILE = DATA_DIR / 'historical_status.json'
# Database path - unified in /db folder
DB_PATH = DATA_DIR / 'data_engine.db'
STOCKS_FILE = DATA_DIR / 'stocks_full_data.json'

# Status management
def update_status(status_update):
    """Update the status file"""
    status_file = STATUS_FILE
    try:
        with open(status_file, 'r') as f:
            status = json.load(f)
    except:
        status = {
            'running': False,
            'progress': {'current': 0, 'total': 0, 'symbol': ''},
            'logs': [],
            'results': [],
            'lastUpdate': None
        }
    
    status.update(status_update)
    
    if len(status.get('logs', [])) > 200:
        status['logs'] = status['logs'][-200:]
    
    with open(status_file, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def log_message(message):
    """Print and log a message"""
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}")
    update_status({
        'logs': [f"[{timestamp}] {message}"]
    })

def get_yahoo_symbol(symbol, market):
    """تحويل رمز السهم لتنسيق Yahoo Finance
    
    IMPORTANT: This function adds market suffixes (.CA, .SR, .KW, .QA) for
    Yahoo Finance API calls ONLY. The base symbol (without suffix) must always
    be stored in the database. See save_to_database() below.
    """
    
    # تنظيف الرمز
    symbol = symbol.strip().upper()
    
    # لو السوق فارغ، نحاول نجيبه من قاعدة البيانات
    if not market:
        try:
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            res = cur.execute("SELECT market FROM stocks WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
            if res:
                market = res[0]
            conn.close()
        except Exception:
            pass
    
    # السعودية - TADAWUL
    if market == 'السعودية' or 'سعودية' in market:
        # الأرقام فقط - نضيف .SR
        if symbol.isdigit():
            return f"{symbol}.SR"
        # لو فيه حروف
        return f"{symbol}.SR"
    
    # مصر - EGX
    elif market == 'مصر' or 'مصر' in market:
        return f"{symbol}.CA"
    
    # الكويت - KSE
    elif market == 'الكويت' or 'كويت' in market:
        return f"{symbol}.KW"
    
    # قطر - QE
    elif market == 'قطر' or 'قطر' in market:
        return f"{symbol}.QA"
    
    # الافتراضي
    return symbol

def fetch_historical_data_yahoo(symbol, years=5):
    """سحب البيانات التاريخية من Yahoo Finance"""
    try:
        import yfinance as yf
        
        # حساب الفترة
        end_date = datetime.now()
        start_date = end_date - timedelta(days=years*365)
        
        ticker = yf.Ticker(symbol)
        hist = ticker.history(start=start_date, end=end_date, interval='1d')
        
        if hist.empty:
            return None, 0
        
        # Reset index
        hist = hist.reset_index()
        
        # Convert to list of dicts
        data = []
        for _, row in hist.iterrows():
            date_val = row['Date']
            if hasattr(date_val, 'strftime'):
                date_str = date_val.strftime('%Y-%m-%d')
            else:
                date_str = str(date_val)[:10]
            
            data.append({
                'date': date_str,
                'open': float(row['Open']) if row['Open'] and not row['Open'] != row['Open'] else 0,
                'high': float(row['High']) if row['High'] and not row['High'] != row['High'] else 0,
                'low': float(row['Low']) if row['Low'] and not row['Low'] != row['Low'] else 0,
                'close': float(row['Close']) if row['Close'] and not row['Close'] != row['Close'] else 0,
                'volume': int(row['Volume']) if row['Volume'] and row['Volume'] == row['Volume'] else 0
            })
        
        return data, len(data)
        
    except ImportError:
        log_message("❌ yfinance غير مثبت! pip install yfinance")
        return None, 0
    except Exception as e:
        return None, 0

def save_to_database(symbol, name, market, data):
    """حفظ البيانات التاريخية في قاعدة البيانات
    
    IMPORTANT: Always store the base symbol (without .CA/.SR/.KW/.QA suffix).
    The caller (fetch_all_historical_5years) is responsible for passing
    the clean base symbol, not the Yahoo Finance symbol.
    """
    if not data:
        return 0
    
    # Safety: strip any Yahoo Finance suffixes (.CA/.SR/.KW/.QA) from symbol
    # before storing. This prevents Canadian-looking ticker names in the DB.
    for suffix in ('.CA', '.SR', '.KW', '.QA', '.AE', '.BH'):
        if symbol.upper().endswith(suffix):
            symbol = symbol[:-len(suffix)]
            break
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create table
    cursor.execute('''
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
            last_fetch TEXT,
            UNIQUE(symbol, date)
        )
    ''')
    
    # Create index
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_historical_symbol 
        ON historical_data(symbol)
    ''')
    
    # Insert data
    inserted = 0
    for row in data:
        try:
            cursor.execute('''
                INSERT OR REPLACE INTO historical_data 
                (symbol, name, market, date, open, high, low, close, volume, last_fetch)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                symbol, name, market, row['date'],
                row['open'], row['high'], row['low'], row['close'], row['volume'],
                datetime.now().isoformat()
            ))
            inserted += 1
        except Exception as e:
            pass
    
    conn.commit()
    conn.close()
    return inserted

def get_stocks_from_db():
    """قراءة الأسهم من قاعدة البيانات"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT DISTINCT symbol, name, market FROM stocks')
        stocks = cursor.fetchall()
        conn.close()
        
        return [{'symbol': s[0], 'name': s[1], 'market': s[2]} for s in stocks]
    except:
        return []

def get_stocks_from_json():
    """قراءة الأسهم من ملف JSON"""
    try:
        with open(STOCKS_FILE, 'r') as f:
            stocks = json.load(f)
        return stocks
    except:
        return []

def fetch_all_historical_5years():
    """سحب 5 سنوات من البيانات التاريخية لكل الأسهم"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
    
    # Initialize status
    update_status({
        'running': True,
        'progress': {'current': 0, 'total': 0, 'symbol': ''},
        'logs': [],
        'results': [],
        'lastUpdate': datetime.now().isoformat()
    })
    
    log_message("=" * 60)
    log_message("🔥 بدء سحب البيانات التاريخية - 5 سنوات")
    log_message("=" * 60)
    
    # Get stocks
    stocks = get_stocks_from_json()
    if not stocks:
        stocks = get_stocks_from_db()
    
    if not stocks:
        log_message("❌ لا توجد أسهم!")
        return []
    
    total = len(stocks)
    log_message(f"📊 عدد الأسهم: {total}")
    
    all_results = []
    success_count = 0
    total_days = 0
    
    for i, stock in enumerate(stocks):
        symbol = stock.get('symbol', '')
        name = stock.get('name', '')
        market = stock.get('market', '')
        
        # تحويل الرمز لـ Yahoo
        yahoo_symbol = get_yahoo_symbol(symbol, market)
        
        update_status({
            'progress': {
                'current': i + 1,
                'total': total,
                'symbol': f"{symbol} → {yahoo_symbol}"
            }
        })
        
        # سحب البيانات
        data, days = fetch_historical_data_yahoo(yahoo_symbol, years=5)
        
        if data and days > 0:
            # حفظ في قاعدة البيانات
            inserted = save_to_database(symbol, name, market, data)
            
            latest_close = data[-1]['close'] if data else 0
            earliest = data[0]['date'] if data else ''
            latest = data[-1]['date'] if data else ''
            
            result = {
                'symbol': symbol,
                'yahoo_symbol': yahoo_symbol,
                'name': name,
                'market': market,
                'days': days,
                'inserted': inserted,
                'earliest_date': earliest,
                'latest_date': latest,
                'latest_close': latest_close,
                'status': 'success'
            }
            
            all_results.append(result)
            success_count += 1
            total_days += days
            log_message(f"✅ {symbol} ({yahoo_symbol}): {days} يوم | {earliest} → {latest}")
        else:
            all_results.append({
                'symbol': symbol,
                'yahoo_symbol': yahoo_symbol,
                'name': name,
                'market': market,
                'days': 0,
                'status': 'no_data'
            })
            log_message(f"❌ {symbol} ({yahoo_symbol}): لا توجد بيانات")
        
        # تأخير بسيط لتجنب الحظر
        time.sleep(0.5)
        
        # تحديث كل 10 أسهم
        if (i + 1) % 10 == 0:
            log_message(f"📊 التقدم: {i+1}/{total} | نجاح: {success_count}")
    
    # Final status
    log_message("=" * 60)
    log_message(f"🎉 اكتمل! نجاح: {success_count}/{total} | إجمالي الأيام: {total_days:,}")
    log_message("=" * 60)
    
    update_status({
        'running': False,
        'results': all_results,
        'summary': {
            'total_stocks': total,
            'success': success_count,
            'failed': total - success_count,
            'total_days': total_days
        }
    })
    
    # Save results
    output_file = DATA_DIR / 'historical_latest.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    
    return all_results

if __name__ == '__main__':
    try:
        fetch_all_historical_5years()
    except KeyboardInterrupt:
        log_message("⏹️ تم الإيقاف بواسطة المستخدم")
        update_status({'running': False})
    except Exception as e:
        log_message(f"❌ خطأ: {str(e)}")
        update_status({'running': False})
        import traceback
        traceback.print_exc()
        sys.exit(1)
