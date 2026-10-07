#!/usr/bin/env python3
"""
Populate Databases Script v2
ينقل البيانات بشكل صحيح مع مراعاة الـ schemas المختلفة
"""

import sqlite3
import os
from pathlib import Path
from datetime import datetime

DB_DIR = str(Path(__file__).resolve().parent.parent / 'db')
UPLOAD_DIR = str(Path(__file__).resolve().parent.parent / 'upload')

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def get_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def main():
    log("=== بدء نقل البيانات v2 ===\n")
    
    # ===========================================================================
    # 1. نقل prediction_logs من stocks.db لـ predictions.db (بشكل صحيح)
    # ===========================================================================
    log("📦 نقل prediction_logs من stocks.db لـ predictions.db...")
    
    stocks_db = get_connection(f'{DB_DIR}/stocks.db')
    predictions_db = get_connection(f'{DB_DIR}/predictions.db')
    
    # قراءة البيانات من stocks.db
    cursor = stocks_db.execute('SELECT * FROM prediction_logs')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف في stocks.db")
    
    # إضافة البيانات لـ predictions.db predictions table
    migrated = 0
    for row in rows:
        try:
            # تحويل البيانات للـ predictions table
            predictions_db.execute('''
                INSERT OR REPLACE INTO predictions 
                (id, ticker, signal, confidence, entry_price, target_price, stop_loss, 
                 reasoning, indicators, verified, final_price, created_at)
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
                None,  # indicators
                1 if row['target_reached'] else 0,
                row['actual_price_5d'] or row['actual_price_10d'],
                row['created_at']
            ))
            migrated += 1
        except Exception as e:
            log(f"   خطأ في {row['ticker']}: {e}")
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 2. نقل cached_analysis من stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نقل cached_analysis من stocks.db لـ predictions.db...")
    
    # قراءة schema من stocks.db
    cursor = stocks_db.execute('PRAGMA table_info(cached_analysis)')
    source_columns = [row[1] for row in cursor.fetchall()]
    log(f"   الأعمدة في stocks.db: {source_columns[:10]}...")
    
    cursor = stocks_db.execute('SELECT * FROM cached_analysis')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف")
    
    # إنشاء جدول cached_analysis في predictions.db بنفس الـ schema
    predictions_db.execute('DROP TABLE IF EXISTS cached_analysis')
    
    # إنشاء الجدول بنفس الأعمدة
    columns_def = ', '.join([f'"{col}" TEXT' for col in source_columns])
    predictions_db.execute(f'''
        CREATE TABLE cached_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            {columns_def.replace('"id" TEXT', '"id" INTEGER')}
        )
    ''')
    
    migrated = 0
    for row in rows:
        try:
            placeholders = ', '.join(['?' for _ in source_columns])
            predictions_db.execute(
                f'INSERT INTO cached_analysis ({", ".join(source_columns)}) VALUES ({placeholders})',
                tuple(row[col] for col in source_columns)
            )
            migrated += 1
        except Exception as e:
            log(f"   خطأ: {e}")
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 3. نسخ learned_lessons من learned.db لـ stocks.db
    # ===========================================================================
    log("📦 نسخ learned_lessons من learned.db لـ stocks.db...")
    
    learned_db = get_connection(f'{DB_DIR}/learned.db')
    
    cursor = learned_db.execute('SELECT * FROM learned_lessons')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف في learned.db")
    
    # إنشاء الجدول بنفس الـ schema
    cursor = learned_db.execute('PRAGMA table_info(learned_lessons)')
    source_columns = [row[1] for row in cursor.fetchall()]
    
    # إسقاط الجدول القديم وإنشاء جديد
    stocks_db.execute('DROP TABLE IF EXISTS learned_lessons')
    
    columns_def = ', '.join([f'"{col}" TEXT' for col in source_columns])
    stocks_db.execute(f'''
        CREATE TABLE learned_lessons (
            {columns_def.replace('"id" TEXT', '"id" INTEGER PRIMARY KEY AUTOINCREMENT')}
        )
    ''')
    
    migrated = 0
    for row in rows:
        try:
            placeholders = ', '.join(['?' for _ in source_columns])
            stocks_db.execute(
                f'INSERT INTO learned_lessons ({", ".join(source_columns)}) VALUES ({placeholders})',
                tuple(row[col] for col in source_columns)
            )
            migrated += 1
        except Exception as e:
            pass
    
    stocks_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 4. نسخ technical_indicators من upload/stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نسخ technical_indicators من upload/stocks.db...")
    
    custom_db = get_connection(f'{UPLOAD_DIR}/stocks.db')
    
    # قراءة schema
    cursor = custom_db.execute('PRAGMA table_info(technical_indicators)')
    source_columns = [row[1] for row in cursor.fetchall()]
    
    cursor = custom_db.execute('SELECT * FROM technical_indicators')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف في stocks.db")
    
    # إنشاء الجدول
    predictions_db.execute('DROP TABLE IF EXISTS technical_indicators')
    
    columns_def = ', '.join([f'"{col}" REAL' if 'price' in col.lower() or 'rsi' in col.lower() or 'macd' in col.lower() or 'sma' in col.lower() or 'ema' in col.lower() or 'bollinger' in col.lower() else f'"{col}" TEXT' for col in source_columns])
    predictions_db.execute(f'''
        CREATE TABLE technical_indicators (
            {columns_def.replace('"id" REAL', '"id" INTEGER PRIMARY KEY AUTOINCREMENT')}
        )
    ''')
    
    migrated = 0
    for row in rows:
        try:
            placeholders = ', '.join(['?' for _ in source_columns])
            predictions_db.execute(
                f'INSERT INTO technical_indicators ({", ".join(source_columns)}) VALUES ({placeholders})',
                tuple(row[col] for col in source_columns)
            )
            migrated += 1
        except Exception as e:
            pass
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 5. تحديث بيانات الأسهم من price_history
    # ===========================================================================
    log("📦 تحديث بيانات الأسهم من price_history.db...")
    
    price_db = get_connection(f'{DB_DIR}/price_history.db')
    
    # الحصول على أحدث الأسعار لكل سهم
    cursor = price_db.execute('''
        SELECT ticker, date, close_price 
        FROM price_history 
        WHERE (ticker, date) IN (
            SELECT ticker, MAX(date) 
            FROM price_history 
            GROUP BY ticker
        )
    ''')
    
    price_updates = {row['ticker']: {'date': row['date'], 'price': row['close_price']} for row in cursor.fetchall()}
    log(f"   وجدت أسعار لـ {len(price_updates)} سهم")
    
    updated = 0
    for ticker, data in price_updates.items():
        try:
            stocks_db.execute('''
                UPDATE stocks SET 
                    current_price = ?,
                    last_updated = ?
                WHERE ticker = ?
            ''', (data['price'], data['date'], ticker))
            updated += 1
        except:
            pass
    
    stocks_db.commit()
    log(f"   ✅ تم تحديث {updated} سهم\n")
    
    # ===========================================================================
    # 6. نسخ portfolio_assets من upload/stocks.db لـ stocks.db
    # ===========================================================================
    log("📦 نسخ portfolio_assets من upload/stocks.db...")
    
    try:
        cursor = custom_db.execute('SELECT * FROM portfolio_assets')
        rows = cursor.fetchall()
        log(f"   وجدت {len(rows)} صف في stocks.db")
        
        # إنشاء الجدول
        cursor = custom_db.execute('PRAGMA table_info(portfolio_assets)')
        source_columns = [row[1] for row in cursor.fetchall()]
        
        stocks_db.execute('DROP TABLE IF EXISTS portfolio_assets')
        
        columns_def = ', '.join([f'"{col}" TEXT' for col in source_columns])
        stocks_db.execute(f'''
            CREATE TABLE portfolio_assets (
                {columns_def.replace('"id" TEXT', '"id" INTEGER PRIMARY KEY AUTOINCREMENT')}
            )
        ''')
        
        migrated = 0
        for row in rows:
            try:
                placeholders = ', '.join(['?' for _ in source_columns])
                stocks_db.execute(
                    f'INSERT INTO portfolio_assets ({", ".join(source_columns)}) VALUES ({placeholders})',
                    tuple(row[col] for col in source_columns)
                )
                migrated += 1
            except Exception as e:
                pass
        
        stocks_db.commit()
        log(f"   ✅ تم نقل {migrated} صف\n")
    except Exception as e:
        log(f"   ⚠️ خطأ: {e}\n")
    
    # ===========================================================================
    # النهاية - إغلاق الاتصالات
    # ===========================================================================
    stocks_db.close()
    predictions_db.close()
    learned_db.close()
    price_db.close()
    custom_db.close()
    
    log("\n=== تم الانتهاء بنجاح! ===")
    
    # عرض الملخص
    log("\n📊 ملخص قواعد البيانات:")
    for db_name in ['stocks.db', 'predictions.db', 'learned.db']:
        db_path = f'{DB_DIR}/{db_name}'
        if os.path.exists(db_path):
            conn = get_connection(db_path)
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = cursor.fetchall()
            log(f"\n{db_name}:")
            for table in tables:
                cursor = conn.execute(f"SELECT COUNT(*) FROM {table[0]}")
                count = cursor.fetchone()[0]
                if count > 0:
                    log(f"  {table[0]}: {count} صف")
            conn.close()

if __name__ == '__main__':
    main()
