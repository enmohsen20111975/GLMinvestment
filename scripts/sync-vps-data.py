#!/usr/bin/env python3
"""
Sync VPS Data Script
ينقل البيانات من stocks.db الكبيرة للـ databases الصغيرة
"""

import sqlite3
import os
import sys
from datetime import datetime

# المسارات على الـ VPS
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DB_DIR = os.path.join(PROJECT_DIR, 'db')

# القاعدة الكبيرة الأصلية
EGX_DB_PATH = os.path.join(PROJECT_DIR, 'stocks1111.db')
if not os.path.exists(EGX_DB_PATH):
    EGX_DB_PATH = os.path.join(PROJECT_DIR, 'stocks.db')

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def get_db_size(path):
    if os.path.exists(path):
        return os.path.getsize(path) / (1024 * 1024)
    return 0

def main():
    log("=== مزامنة بيانات VPS ===\n")
    
    # فحص القاعدة الكبيرة
    if not os.path.exists(EGX_DB_PATH):
        log(f"❌ لم أجد قاعدة البيانات الكبيرة: {EGX_DB_PATH}")
        # البحث عن أي db كبيرة
        for f in os.listdir(PROJECT_DIR):
            if f.endswith('.db') and os.path.getsize(os.path.join(PROJECT_DIR, f)) > 50 * 1024 * 1024:
                log(f"وجدت: {f} ({get_db_size(os.path.join(PROJECT_DIR, f)):.1f} MB)")
        return
    
    log(f"✅ قاعدة البيانات الكبيرة: {EGX_DB_PATH} ({get_db_size(EGX_DB_PATH):.1f} MB)")
    
    # فتح القاعدة الكبيرة
    egx_db = sqlite3.connect(EGX_DB_PATH)
    egx_db.row_factory = sqlite3.Row
    
    # فتح/إنشاء القواعد الصغيرة
    stocks_db = sqlite3.connect(os.path.join(DB_DIR, 'stocks.db'))
    stocks_db.row_factory = sqlite3.Row
    
    predictions_db = sqlite3.connect(os.path.join(DB_DIR, 'predictions.db'))
    predictions_db.row_factory = sqlite3.Row
    
    # فحص الجداول في القاعدة الكبيرة
    cursor = egx_db.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    log(f"الجداول في القاعدة الكبيرة: {len(tables)}")
    
    # ===========================================================================
    # 1. نقل الأسهم (stocks)
    # ===========================================================================
    log("\n📦 نقل الأسهم...")
    
    # فحص لو فيه جدول stocks
    if 'stocks' in tables:
        cursor = egx_db.execute("SELECT * FROM stocks LIMIT 5")
        sample = cursor.fetchall()
        log(f"   وجدت {len(sample)} عينة من جدول stocks")
        
        # عد الأسهم
        cursor = egx_db.execute("SELECT COUNT(*) FROM stocks")
        total_stocks = cursor.fetchone()[0]
        log(f"   إجمالي الأسهم: {total_stocks}")
        
        # نقل البيانات
        cursor = egx_db.execute("SELECT * FROM stocks")
        stocks = cursor.fetchall()
        
        # إنشاء جدول stocks لو مش موجود
        stocks_db.execute('''
            CREATE TABLE IF NOT EXISTS stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE,
                name TEXT,
                name_ar TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                industry TEXT,
                current_price REAL,
                previous_close REAL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                change_percent REAL,
                volume INTEGER,
                market_cap REAL,
                pe_ratio REAL,
                pb_ratio REAL,
                eps REAL,
                roe REAL,
                roa REAL,
                is_active INTEGER DEFAULT 1,
                is_egx30 INTEGER DEFAULT 0,
                is_egx70 INTEGER DEFAULT 0,
                is_egx100 INTEGER DEFAULT 0,
                last_update TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        transferred = 0
        for stock in stocks:
            try:
                # محاولة إدخال البيانات
                stocks_db.execute('''
                    INSERT OR REPLACE INTO stocks 
                    (ticker, name, name_ar, market, sector, current_price, volume, last_update)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    stock['ticker'] if 'ticker' in stock.keys() else stock['symbol'],
                    stock['name'] if 'name' in stock.keys() else None,
                    stock['name_ar'] if 'name_ar' in stock.keys() else None,
                    stock.get('market', 'EGX'),
                    stock.get('sector'),
                    stock.get('current_price') or stock.get('last_price'),
                    stock.get('volume'),
                    stock.get('last_update') or stock.get('updated_at')
                ))
                transferred += 1
            except Exception as e:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {transferred} سهم")
    else:
        log("   ⚠️ جدول stocks غير موجود")
    
    # ===========================================================================
    # 2. نقل سجل الأسعار (price_history)
    # ===========================================================================
    log("\n📦 نقل سجل الأسعار...")
    
    # البحث عن جدول الأسعار
    price_table = None
    for t in ['stock_price_history', 'price_history', 'historical_prices']:
        if t in tables:
            price_table = t
            break
    
    if price_table:
        cursor = egx_db.execute(f"SELECT COUNT(*) FROM {price_table}")
        total_prices = cursor.fetchone()[0]
        log(f"   إجمالي سجلات الأسعار: {total_prices}")
        
        # إنشاء جدول price_history في stocks.db
        stocks_db.execute('''
            CREATE TABLE IF NOT EXISTS stock_price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                date TEXT,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # نقل آخر 10000 سجل بس للسرعة
        cursor = egx_db.execute(f'''
            SELECT * FROM {price_table} 
            ORDER BY date DESC 
            LIMIT 10000
        ''')
        prices = cursor.fetchall()
        
        transferred = 0
        for price in prices:
            try:
                ticker = price.get('ticker') or price.get('symbol') or price.get('stock_id')
                stocks_db.execute('''
                    INSERT OR IGNORE INTO stock_price_history 
                    (ticker, date, open_price, high_price, low_price, close_price, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    str(ticker),
                    price.get('date'),
                    price.get('open') or price.get('open_price'),
                    price.get('high') or price.get('high_price'),
                    price.get('low') or price.get('low_price'),
                    price.get('close') or price.get('close_price'),
                    price.get('volume')
                ))
                transferred += 1
            except:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {transferred} سجل سعر")
    else:
        log("   ⚠️ جدول الأسعار غير موجود")
    
    # ===========================================================================
    # 3. نقل التوقعات (prediction_logs)
    # ===========================================================================
    log("\n📦 نقل التوقعات...")
    
    if 'prediction_logs' in tables:
        cursor = egx_db.execute("SELECT COUNT(*) FROM prediction_logs")
        total_preds = cursor.fetchone()[0]
        log(f"   إجمالي التوقعات: {total_preds}")
        
        cursor = egx_db.execute("SELECT * FROM prediction_logs ORDER BY created_at DESC LIMIT 500")
        predictions = cursor.fetchall()
        
        # إنشاء جدول prediction_logs في predictions.db
        predictions_db.execute('''
            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                signal TEXT,
                confidence REAL,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                reasoning TEXT,
                verified INTEGER DEFAULT 0,
                final_price REAL,
                result TEXT,
                created_at TEXT
            )
        ''')
        
        transferred = 0
        for pred in predictions:
            try:
                predictions_db.execute('''
                    INSERT OR IGNORE INTO predictions 
                    (ticker, signal, confidence, entry_price, target_price, stop_loss, reasoning, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    pred.get('ticker') or pred.get('symbol'),
                    pred.get('recommendation') or pred.get('signal') or 'neutral',
                    pred.get('confidence'),
                    pred.get('entry_price'),
                    pred.get('target_price'),
                    pred.get('stop_loss'),
                    pred.get('notes') or pred.get('reasoning'),
                    pred.get('created_at')
                ))
                transferred += 1
            except:
                pass
        
        predictions_db.commit()
        log(f"   ✅ تم نقل {transferred} توقع")
    
    # ===========================================================================
    # 4. نقل cached_analysis
    # ===========================================================================
    log("\n📦 نقل التحليلات...")
    
    if 'cached_analysis' in tables:
        cursor = egx_db.execute("SELECT COUNT(*) FROM cached_analysis")
        total_analysis = cursor.fetchone()[0]
        log(f"   إجمالي التحليلات: {total_analysis}")
        
        cursor = egx_db.execute("SELECT * FROM cached_analysis LIMIT 500")
        analyses = cursor.fetchall()
        
        # إنشاء جدول
        stocks_db.execute('''
            CREATE TABLE IF NOT EXISTS cached_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE,
                sector TEXT,
                current_price REAL,
                recommendation TEXT,
                composite_score REAL,
                quality_score REAL,
                momentum_score REAL,
                target_price REAL,
                stop_loss REAL,
                created_at TEXT,
                updated_at TEXT
            )
        ''')
        
        transferred = 0
        for analysis in analyses:
            try:
                stocks_db.execute('''
                    INSERT OR REPLACE INTO cached_analysis 
                    (ticker, sector, current_price, recommendation, composite_score, 
                     quality_score, momentum_score, target_price, stop_loss, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    analysis.get('ticker'),
                    analysis.get('sector'),
                    analysis.get('current_price'),
                    analysis.get('recommendation'),
                    analysis.get('composite_score'),
                    analysis.get('quality_score'),
                    analysis.get('momentum_score'),
                    analysis.get('target_price'),
                    analysis.get('stop_loss'),
                    analysis.get('created_at') or analysis.get('analysis_date')
                ))
                transferred += 1
            except:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {transferred} تحليل")
    
    # ===========================================================================
    # 5. نقل learned_lessons
    # ===========================================================================
    log("\n📦 نقل الدروس المتعلمة...")
    
    if 'learned_lessons' in tables:
        cursor = egx_db.execute("SELECT COUNT(*) FROM learned_lessons")
        total_lessons = cursor.fetchone()[0]
        log(f"   إجمالي الدروس: {total_lessons}")
        
        cursor = egx_db.execute("SELECT * FROM learned_lessons LIMIT 500")
        lessons = cursor.fetchall()
        
        stocks_db.execute('''
            CREATE TABLE IF NOT EXISTS learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                sector TEXT,
                lesson_date TEXT,
                lesson_type TEXT,
                indicator TEXT,
                lesson_text TEXT,
                success_rate REAL,
                sample_size INTEGER,
                confidence REAL,
                created_at TEXT
            )
        ''')
        
        transferred = 0
        for lesson in lessons:
            try:
                stocks_db.execute('''
                    INSERT OR IGNORE INTO learned_lessons 
                    (ticker, sector, lesson_date, lesson_type, indicator, lesson_text, 
                     success_rate, sample_size, confidence, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    lesson.get('ticker'),
                    lesson.get('sector'),
                    lesson.get('lesson_date'),
                    lesson.get('lesson_type'),
                    lesson.get('indicator'),
                    lesson.get('lesson_text'),
                    lesson.get('success_rate'),
                    lesson.get('sample_size'),
                    lesson.get('confidence'),
                    lesson.get('created_at')
                ))
                transferred += 1
            except:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {transferred} درس")
    
    # ===========================================================================
    # النهاية
    # ===========================================================================
    egx_db.close()
    stocks_db.close()
    predictions_db.close()
    
    log("\n=== تمت المزامنة! ===")
    log("قم بإعادة تشغيل الخدمات: pm2 restart all")

if __name__ == '__main__':
    main()
