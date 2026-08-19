<<<<<<< Updated upstream
#!/usr/bin/env python3
"""
Sync Real Data Script
يساعد على ربط البيانات الحقيقية من قاعدة البيانات الكبيرة للواجهة
"""

import sqlite3
import os
from pathlib import Path
from datetime import datetime

DB_DIR = str(Path(__file__).resolve().parent.parent / 'db')
UPLOAD_DIR = str(Path(__file__).resolve().parent.parent / 'upload')

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    log("=== مزامنة البيانات الحقيقية ===\n")
    
    stocks_db = sqlite3.connect(f'{DB_DIR}/stocks.db')
    stocks_db.row_factory = sqlite3.Row
    
    predictions_db = sqlite3.connect(f'{DB_DIR}/predictions.db')
    predictions_db.row_factory = sqlite3.Row
    
    price_db = sqlite3.connect(f'{DB_DIR}/price_history.db')
    price_db.row_factory = sqlite3.Row
    
    learned_db = sqlite3.connect(f'{DB_DIR}/learned.db')
    learned_db.row_factory = sqlite3.Row
    
    custom_db = sqlite3.connect(f'{UPLOAD_DIR}/stocks.db')
    custom_db.row_factory = sqlite3.Row
    
    # ===========================================================================
    # 1. نقل prediction_logs من stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نقل prediction_logs...")
    
    # حذف البيانات القديمة
    predictions_db.execute('DELETE FROM predictions')
    
    # قراءة البيانات
    cursor = stocks_db.execute('''
        SELECT id, ticker, prediction_date, predicted_direction, confidence,
               entry_price, target_price, stop_loss, recommendation, notes,
               direction_correct_5d, direction_correct_10d, target_reached,
               actual_price_5d, actual_price_10d, created_at
        FROM prediction_logs
    ''')
    rows = cursor.fetchall()
    
    migrated = 0
    for row in rows:
        try:
            # تحويل direction_correct لـ result
            result = None
            if row['direction_correct_5d'] is not None:
                result = 'profit' if row['direction_correct_5d'] == 1 else 'loss'
            
            predictions_db.execute('''
                INSERT INTO predictions 
                (id, ticker, signal, confidence, entry_price, target_price, stop_loss,
                 reasoning, verified, final_price, result, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                row['id'],
                row['ticker'],
                row['predicted_direction'] or row['recommendation'] or 'neutral',
                row['confidence'],
                row['entry_price'],
                row['target_price'],
                row['stop_loss'],
                row['notes'],
                1 if row['target_reached'] else 0,
                row['actual_price_5d'] or row['actual_price_10d'],
                result,
                row['created_at']
            ))
            migrated += 1
        except Exception as e:
            pass
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} توقع\n")
    
    # ===========================================================================
    # 2. نسخ learned_lessons من learned.db لـ stocks.db
    # ===========================================================================
    log("📦 نسخ learned_lessons...")
    
    cursor = learned_db.execute('SELECT * FROM learned_lessons')
    rows = cursor.fetchall()
    
    # إنشاء الجدول لو مش موجود
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
            market_regime TEXT,
            notes TEXT,
            created_at TEXT
        )
    ''')
    
    # حذف البيانات القديمة
    stocks_db.execute('DELETE FROM learned_lessons')
    
    migrated = 0
    for row in rows:
        try:
            stocks_db.execute('''
                INSERT INTO learned_lessons 
                (ticker, sector, lesson_date, lesson_type, indicator, lesson_text,
                 success_rate, sample_size, confidence, market_regime, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                row['ticker'], row['sector'], row['lesson_date'], row['lesson_type'],
                row['indicator'], row['lesson_text'], row['success_rate'], row['sample_size'],
                row['confidence'], row['market_regime'], row['notes'], row['created_at']
            ))
            migrated += 1
        except:
            pass
    
    stocks_db.commit()
    log(f"   ✅ تم نقل {migrated} درس\n")
    
    # ===========================================================================
    # 3. تحديث أسعار EGX stocks من price_history
    # ===========================================================================
    log("📦 تحديث أسعار EGX stocks...")
    
    # الحصول على EGX tickers
    cursor = stocks_db.execute("SELECT ticker FROM stocks WHERE market = 'EGX'")
    egx_tickers = set(row['ticker'] for row in cursor.fetchall())
    
    # تحديث الأسعار من price_history
    updated = 0
    for ticker in egx_tickers:
        cursor = price_db.execute('''
            SELECT date, close_price, open_price, high_price, low_price, volume
            FROM price_history 
            WHERE ticker = ? 
            ORDER BY date DESC LIMIT 1
        ''', (ticker,))
        row = cursor.fetchone()
        
        if row:
            try:
                stocks_db.execute('''
                    UPDATE stocks SET 
                        current_price = ?,
                        open_price = ?,
                        high_price = ?,
                        low_price = ?,
                        volume = ?,
                        last_updated = ?
                    WHERE ticker = ? AND market = 'EGX'
                ''', (row['close_price'], row['open_price'], row['high_price'],
                      row['low_price'], row['volume'], row['date'], ticker))
                updated += 1
            except:
                pass
    
    stocks_db.commit()
    log(f"   ✅ تم تحديث {updated} سهم EGX\n")
    
    # ===========================================================================
    # 4. نسخ portfolio من stocks.db
    # ===========================================================================
    log("📦 نسخ portfolio...")
    
    try:
        cursor = custom_db.execute('SELECT * FROM portfolio_assets')
        rows = cursor.fetchall()
        
        stocks_db.execute('''
            CREATE TABLE IF NOT EXISTS portfolio_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                shares REAL,
                buy_price REAL,
                buy_date TEXT,
                portfolio_id TEXT,
                notes TEXT,
                created_at TEXT
            )
        ''')
        
        stocks_db.execute('DELETE FROM portfolio_assets')
        
        migrated = 0
        for row in rows:
            try:
                stocks_db.execute('''
                    INSERT INTO portfolio_assets 
                    (ticker, shares, buy_price, buy_date, portfolio_id, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    row['ticker'], row['shares'], row['buy_price'],
                    row['buy_date'], row.get('portfolio_id'), row.get('notes'), row.get('created_at')
                ))
                migrated += 1
            except:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {migrated} أصل\n")
    except Exception as e:
        log(f"   ⚠️ خطأ: {e}\n")
    
    # ===========================================================================
    # 5. نسخ technical_indicators
    # ===========================================================================
    log("📦 نسخ technical_indicators...")
    
    try:
        cursor = custom_db.execute('SELECT * FROM technical_indicators')
        rows = cursor.fetchall()
        
        predictions_db.execute('''
            CREATE TABLE IF NOT EXISTS technical_indicators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL UNIQUE,
                rsi REAL,
                rsi_signal TEXT,
                macd REAL,
                macd_signal REAL,
                macd_histogram REAL,
                macd_trend TEXT,
                sma_20 REAL,
                sma_50 REAL,
                ema_20 REAL,
                bollinger_upper REAL,
                bollinger_middle REAL,
                bollinger_lower REAL,
                overall_signal TEXT,
                signal_strength REAL,
                calculated_at TEXT
            )
        ''')
        
        predictions_db.execute('DELETE FROM technical_indicators')
        
        migrated = 0
        for row in rows:
            try:
                predictions_db.execute('''
                    INSERT INTO technical_indicators 
                    (ticker, rsi, rsi_signal, macd, macd_signal, macd_histogram,
                     macd_trend, sma_20, sma_50, ema_20, bollinger_upper,
                     bollinger_middle, bollinger_lower, overall_signal, signal_strength, calculated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    row['ticker'], row['rsi'], row['rsi_signal'], row['macd'],
                    row['macd_signal'], row['macd_histogram'], row['macd_trend'],
                    row['sma_20'], row['sma_50'], row['ema_20'], row['bollinger_upper'],
                    row['bollinger_middle'], row['bollinger_lower'], row['overall_signal'],
                    row['signal_strength'], row['calculated_at']
                ))
                migrated += 1
            except:
                pass
        
        predictions_db.commit()
        log(f"   ✅ تم نقل {migrated} مؤشر\n")
    except Exception as e:
        log(f"   ⚠️ خطأ: {e}\n")
    
    # ===========================================================================
    # 6. إحصائيات نهائية
    # ===========================================================================
    log("\n=== الإحصائيات النهائية ===\n")
    
    # stocks.db
    cursor = stocks_db.execute("SELECT COUNT(*) FROM stocks WHERE market = 'EGX'")
    egx_count = cursor.fetchone()[0]
    cursor = stocks_db.execute("SELECT COUNT(*) FROM stocks WHERE market = 'CRYPTO'")
    crypto_count = cursor.fetchone()[0]
    log(f"stocks.db: {egx_count} EGX + {crypto_count} CRYPTO")
    
    # predictions.db
    cursor = predictions_db.execute("SELECT COUNT(*) FROM predictions")
    pred_count = cursor.fetchone()[0]
    log(f"predictions.db: {pred_count} توقع")
    
    # price_history.db
    cursor = price_db.execute("SELECT COUNT(*) FROM price_history")
    price_count = cursor.fetchone()[0]
    log(f"price_history.db: {price_count} سجل سعر")
    
    # learned.db
    cursor = learned_db.execute("SELECT COUNT(*) FROM learned_lessons")
    lessons_count = cursor.fetchone()[0]
    log(f"learned.db: {lessons_count} درس")
    
    # إغلاق الاتصالات
    stocks_db.close()
    predictions_db.close()
    price_db.close()
    learned_db.close()
    custom_db.close()
    
    log("\n✅ تمت المزامنة بنجاح!")

if __name__ == '__main__':
    main()
=======
#!/usr/bin/env python3
"""
Sync Real Data Script
يساعد على ربط البيانات الحقيقية من قاعدة البيانات الكبيرة للواجهة
"""

import sqlite3
import os
from datetime import datetime

DB_DIR = str(Path(__file__).resolve().parent.parent / 'db')
UPLOAD_DIR = str(Path(__file__).resolve().parent.parent / 'upload')

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    log("=== مزامنة البيانات الحقيقية ===\n")
    
    stocks_db = sqlite3.connect(f'{DB_DIR}/stocks.db')
    stocks_db.row_factory = sqlite3.Row
    
    predictions_db = sqlite3.connect(f'{DB_DIR}/predictions.db')
    predictions_db.row_factory = sqlite3.Row
    
    price_db = sqlite3.connect(f'{DB_DIR}/price_history.db')
    price_db.row_factory = sqlite3.Row
    
    learned_db = sqlite3.connect(f'{DB_DIR}/learned.db')
    learned_db.row_factory = sqlite3.Row
    
    custom_db = sqlite3.connect(f'{UPLOAD_DIR}/custom.db')
    custom_db.row_factory = sqlite3.Row
    
    # ===========================================================================
    # 1. نقل prediction_logs من stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نقل prediction_logs...")
    
    # حذف البيانات القديمة
    predictions_db.execute('DELETE FROM predictions')
    
    # قراءة البيانات
    cursor = stocks_db.execute('''
        SELECT id, ticker, prediction_date, predicted_direction, confidence,
               entry_price, target_price, stop_loss, recommendation, notes,
               direction_correct_5d, direction_correct_10d, target_reached,
               actual_price_5d, actual_price_10d, created_at
        FROM prediction_logs
    ''')
    rows = cursor.fetchall()
    
    migrated = 0
    for row in rows:
        try:
            # تحويل direction_correct لـ result
            result = None
            if row['direction_correct_5d'] is not None:
                result = 'profit' if row['direction_correct_5d'] == 1 else 'loss'
            
            predictions_db.execute('''
                INSERT INTO predictions 
                (id, ticker, signal, confidence, entry_price, target_price, stop_loss,
                 reasoning, verified, final_price, result, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                row['id'],
                row['ticker'],
                row['predicted_direction'] or row['recommendation'] or 'neutral',
                row['confidence'],
                row['entry_price'],
                row['target_price'],
                row['stop_loss'],
                row['notes'],
                1 if row['target_reached'] else 0,
                row['actual_price_5d'] or row['actual_price_10d'],
                result,
                row['created_at']
            ))
            migrated += 1
        except Exception as e:
            pass
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} توقع\n")
    
    # ===========================================================================
    # 2. نسخ learned_lessons من learned.db لـ stocks.db
    # ===========================================================================
    log("📦 نسخ learned_lessons...")
    
    cursor = learned_db.execute('SELECT * FROM learned_lessons')
    rows = cursor.fetchall()
    
    # إنشاء الجدول لو مش موجود
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
            market_regime TEXT,
            notes TEXT,
            created_at TEXT
        )
    ''')
    
    # حذف البيانات القديمة
    stocks_db.execute('DELETE FROM learned_lessons')
    
    migrated = 0
    for row in rows:
        try:
            stocks_db.execute('''
                INSERT INTO learned_lessons 
                (ticker, sector, lesson_date, lesson_type, indicator, lesson_text,
                 success_rate, sample_size, confidence, market_regime, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                row['ticker'], row['sector'], row['lesson_date'], row['lesson_type'],
                row['indicator'], row['lesson_text'], row['success_rate'], row['sample_size'],
                row['confidence'], row['market_regime'], row['notes'], row['created_at']
            ))
            migrated += 1
        except:
            pass
    
    stocks_db.commit()
    log(f"   ✅ تم نقل {migrated} درس\n")
    
    # ===========================================================================
    # 3. تحديث أسعار EGX stocks من price_history
    # ===========================================================================
    log("📦 تحديث أسعار EGX stocks...")
    
    # الحصول على EGX tickers
    cursor = stocks_db.execute("SELECT ticker FROM stocks WHERE market = 'EGX'")
    egx_tickers = set(row['ticker'] for row in cursor.fetchall())
    
    # تحديث الأسعار من price_history
    updated = 0
    for ticker in egx_tickers:
        cursor = price_db.execute('''
            SELECT date, close_price, open_price, high_price, low_price, volume
            FROM price_history 
            WHERE ticker = ? 
            ORDER BY date DESC LIMIT 1
        ''', (ticker,))
        row = cursor.fetchone()
        
        if row:
            try:
                stocks_db.execute('''
                    UPDATE stocks SET 
                        current_price = ?,
                        open_price = ?,
                        high_price = ?,
                        low_price = ?,
                        volume = ?,
                        last_updated = ?
                    WHERE ticker = ? AND market = 'EGX'
                ''', (row['close_price'], row['open_price'], row['high_price'],
                      row['low_price'], row['volume'], row['date'], ticker))
                updated += 1
            except:
                pass
    
    stocks_db.commit()
    log(f"   ✅ تم تحديث {updated} سهم EGX\n")
    
    # ===========================================================================
    # 4. نسخ portfolio من custom.db
    # ===========================================================================
    log("📦 نسخ portfolio...")
    
    try:
        cursor = custom_db.execute('SELECT * FROM portfolio_assets')
        rows = cursor.fetchall()
        
        stocks_db.execute('''
            CREATE TABLE IF NOT EXISTS portfolio_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                shares REAL,
                buy_price REAL,
                buy_date TEXT,
                portfolio_id TEXT,
                notes TEXT,
                created_at TEXT
            )
        ''')
        
        stocks_db.execute('DELETE FROM portfolio_assets')
        
        migrated = 0
        for row in rows:
            try:
                stocks_db.execute('''
                    INSERT INTO portfolio_assets 
                    (ticker, shares, buy_price, buy_date, portfolio_id, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    row['ticker'], row['shares'], row['buy_price'],
                    row['buy_date'], row.get('portfolio_id'), row.get('notes'), row.get('created_at')
                ))
                migrated += 1
            except:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {migrated} أصل\n")
    except Exception as e:
        log(f"   ⚠️ خطأ: {e}\n")
    
    # ===========================================================================
    # 5. نسخ technical_indicators
    # ===========================================================================
    log("📦 نسخ technical_indicators...")
    
    try:
        cursor = custom_db.execute('SELECT * FROM technical_indicators')
        rows = cursor.fetchall()
        
        predictions_db.execute('''
            CREATE TABLE IF NOT EXISTS technical_indicators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL UNIQUE,
                rsi REAL,
                rsi_signal TEXT,
                macd REAL,
                macd_signal REAL,
                macd_histogram REAL,
                macd_trend TEXT,
                sma_20 REAL,
                sma_50 REAL,
                ema_20 REAL,
                bollinger_upper REAL,
                bollinger_middle REAL,
                bollinger_lower REAL,
                overall_signal TEXT,
                signal_strength REAL,
                calculated_at TEXT
            )
        ''')
        
        predictions_db.execute('DELETE FROM technical_indicators')
        
        migrated = 0
        for row in rows:
            try:
                predictions_db.execute('''
                    INSERT INTO technical_indicators 
                    (ticker, rsi, rsi_signal, macd, macd_signal, macd_histogram,
                     macd_trend, sma_20, sma_50, ema_20, bollinger_upper,
                     bollinger_middle, bollinger_lower, overall_signal, signal_strength, calculated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    row['ticker'], row['rsi'], row['rsi_signal'], row['macd'],
                    row['macd_signal'], row['macd_histogram'], row['macd_trend'],
                    row['sma_20'], row['sma_50'], row['ema_20'], row['bollinger_upper'],
                    row['bollinger_middle'], row['bollinger_lower'], row['overall_signal'],
                    row['signal_strength'], row['calculated_at']
                ))
                migrated += 1
            except:
                pass
        
        predictions_db.commit()
        log(f"   ✅ تم نقل {migrated} مؤشر\n")
    except Exception as e:
        log(f"   ⚠️ خطأ: {e}\n")
    
    # ===========================================================================
    # 6. إحصائيات نهائية
    # ===========================================================================
    log("\n=== الإحصائيات النهائية ===\n")
    
    # stocks.db
    cursor = stocks_db.execute("SELECT COUNT(*) FROM stocks WHERE market = 'EGX'")
    egx_count = cursor.fetchone()[0]
    cursor = stocks_db.execute("SELECT COUNT(*) FROM stocks WHERE market = 'CRYPTO'")
    crypto_count = cursor.fetchone()[0]
    log(f"stocks.db: {egx_count} EGX + {crypto_count} CRYPTO")
    
    # predictions.db
    cursor = predictions_db.execute("SELECT COUNT(*) FROM predictions")
    pred_count = cursor.fetchone()[0]
    log(f"predictions.db: {pred_count} توقع")
    
    # price_history.db
    cursor = price_db.execute("SELECT COUNT(*) FROM price_history")
    price_count = cursor.fetchone()[0]
    log(f"price_history.db: {price_count} سجل سعر")
    
    # learned.db
    cursor = learned_db.execute("SELECT COUNT(*) FROM learned_lessons")
    lessons_count = cursor.fetchone()[0]
    log(f"learned.db: {lessons_count} درس")
    
    # إغلاق الاتصالات
    stocks_db.close()
    predictions_db.close()
    price_db.close()
    learned_db.close()
    custom_db.close()
    
    log("\n✅ تمت المزامنة بنجاح!")

if __name__ == '__main__':
    main()
>>>>>>> Stashed changes
