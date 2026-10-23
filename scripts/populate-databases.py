#!/usr/bin/env python3
"""
Populate Databases Script
ينقل البيانات من القواعد الكبيرة للقواعد الصغيرة
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
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn

def main():
    log("=== بدء نقل البيانات ===\n")
    
    # ===========================================================================
    # 1. نقل prediction_logs من stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نقل prediction_logs من stocks.db لـ predictions.db...")
    
    stocks_db = get_connection(f'{DB_DIR}/stocks.db')
    predictions_db = get_connection(f'{DB_DIR}/predictions.db')
    
    # إنشاء الجدول في predictions.db
    predictions_db.execute('''
        CREATE TABLE IF NOT EXISTS prediction_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            stock_id INTEGER,
            sector TEXT,
            prediction_date TEXT NOT NULL,
            predicted_direction TEXT NOT NULL DEFAULT 'neutral',
            predicted_price_5d REAL,
            predicted_price_10d REAL,
            predicted_price_20d REAL,
            target_price REAL,
            stop_loss REAL,
            entry_price REAL,
            composite_score REAL,
            quality_score REAL,
            momentum_score REAL,
            fair_value REAL,
            upside_potential REAL,
            recommendation TEXT,
            confidence REAL,
            market_regime TEXT,
            regime_multiplier REAL,
            weights_snapshot TEXT,
            features_snapshot TEXT,
            validated INTEGER DEFAULT 0,
            validated_at TEXT,
            actual_price_5d REAL,
            actual_price_10d REAL,
            actual_price_20d REAL,
            direction_correct_5d INTEGER,
            direction_correct_10d INTEGER,
            direction_correct_20d INTEGER,
            price_error_5d REAL,
            price_error_10d REAL,
            price_error_20d REAL,
            target_reached INTEGER,
            stop_hit INTEGER,
            model_version TEXT,
            source TEXT,
            created_at TEXT,
            indicators TEXT,
            notes TEXT
        )
    ''')
    
    # قراءة البيانات من stocks.db
    cursor = stocks_db.execute('SELECT * FROM prediction_logs')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف في stocks.db")
    
    # نقل البيانات
    migrated = 0
    for row in rows:
        try:
            columns = row.keys()
            placeholders = ', '.join(['?' for _ in columns])
            col_names = ', '.join(columns)
            predictions_db.execute(
                f'INSERT OR REPLACE INTO prediction_logs ({col_names}) VALUES ({placeholders})',
                tuple(row[col] for col in columns)
            )
            migrated += 1
        except Exception as e:
            log(f"   خطأ: {e}")
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 2. نقل cached_analysis من stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نقل cached_analysis من stocks.db لـ predictions.db...")
    
    # إنشاء الجدول
    predictions_db.execute('''
        CREATE TABLE IF NOT EXISTS cached_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL UNIQUE,
            sector TEXT,
            current_price REAL,
            price_change_1d REAL,
            price_change_7d REAL,
            price_change_30d REAL,
            volume_avg_7d REAL,
            volume_avg_30d REAL,
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
            recommendation TEXT,
            composite_score REAL,
            quality_score REAL,
            momentum_score REAL,
            fair_value REAL,
            upside_potential REAL,
            target_price REAL,
            stop_loss REAL,
            market_regime TEXT,
            regime_multiplier REAL,
            weights_used TEXT,
            analysis_data TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    ''')
    
    cursor = stocks_db.execute('SELECT * FROM cached_analysis')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف في stocks.db")
    
    migrated = 0
    for row in rows:
        try:
            columns = row.keys()
            placeholders = ', '.join(['?' for _ in columns])
            col_names = ', '.join(columns)
            predictions_db.execute(
                f'INSERT OR REPLACE INTO cached_analysis ({col_names}) VALUES ({placeholders})',
                tuple(row[col] for col in columns)
            )
            migrated += 1
        except Exception as e:
            log(f"   خطأ: {e}")
    
    predictions_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 3. نقل signal_logs و outcome_logs من stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نقل signal_logs و outcome_logs...")
    
    # signal_logs
    predictions_db.execute('''
        CREATE TABLE IF NOT EXISTS signal_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal_type TEXT,
            signal_direction TEXT,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            confidence REAL,
            indicators TEXT,
            created_at TEXT,
            closed_at TEXT,
            outcome TEXT,
            actual_return REAL
        )
    ''')
    
    cursor = stocks_db.execute('SELECT * FROM signal_logs')
    rows = cursor.fetchall()
    migrated = 0
    for row in rows:
        try:
            columns = row.keys()
            placeholders = ', '.join(['?' for _ in columns])
            col_names = ', '.join(columns)
            predictions_db.execute(
                f'INSERT OR REPLACE INTO signal_logs ({col_names}) VALUES ({placeholders})',
                tuple(row[col] for col in columns)
            )
            migrated += 1
        except Exception as e:
            pass
    
    predictions_db.commit()
    log(f"   ✅ signal_logs: {migrated} صف")
    
    # outcome_logs
    predictions_db.execute('''
        CREATE TABLE IF NOT EXISTS outcome_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal_id INTEGER,
            prediction_date TEXT,
            actual_price REAL,
            predicted_direction TEXT,
            actual_direction TEXT,
            direction_correct INTEGER,
            price_error REAL,
            days_held INTEGER,
            return_pct REAL,
            created_at TEXT
        )
    ''')
    
    cursor = stocks_db.execute('SELECT * FROM outcome_logs')
    rows = cursor.fetchall()
    migrated = 0
    for row in rows:
        try:
            columns = row.keys()
            placeholders = ', '.join(['?' for _ in columns])
            col_names = ', '.join(columns)
            predictions_db.execute(
                f'INSERT OR REPLACE INTO outcome_logs ({col_names}) VALUES ({placeholders})',
                tuple(row[col] for col in columns)
            )
            migrated += 1
        except Exception as e:
            pass
    
    predictions_db.commit()
    log(f"   ✅ outcome_logs: {migrated} صف\n")
    
    # ===========================================================================
    # 4. نسخ learned_lessons من learned.db لـ stocks.db
    # ===========================================================================
    log("📦 نسخ learned_lessons من learned.db لـ stocks.db...")
    
    learned_db = get_connection(f'{DB_DIR}/learned.db')
    
    # إنشاء الجدول في stocks.db
    stocks_db.execute('''
        CREATE TABLE IF NOT EXISTS learned_lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
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
    
    cursor = learned_db.execute('SELECT * FROM learned_lessons')
    rows = cursor.fetchall()
    log(f"   وجدت {len(rows)} صف في learned.db")
    
    migrated = 0
    for row in rows:
        try:
            columns = row.keys()
            placeholders = ', '.join(['?' for _ in columns])
            col_names = ', '.join(columns)
            stocks_db.execute(
                f'INSERT OR REPLACE INTO learned_lessons ({col_names}) VALUES ({placeholders})',
                tuple(row[col] for col in columns)
            )
            migrated += 1
        except Exception as e:
            pass
    
    stocks_db.commit()
    log(f"   ✅ تم نقل {migrated} صف\n")
    
    # ===========================================================================
    # 5. نسخ technical_indicators من upload/stocks.db لـ predictions.db
    # ===========================================================================
    log("📦 نسخ technical_indicators من upload/stocks.db...")
    
    custom_db = get_connection(f'{UPLOAD_DIR}/stocks.db')
    
    # إنشاء الجدول
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
            calculated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    try:
        cursor = custom_db.execute('SELECT * FROM technical_indicators')
        rows = cursor.fetchall()
        log(f"   وجدت {len(rows)} صف في stocks.db")
        
        migrated = 0
        for row in rows:
            try:
                columns = row.keys()
                placeholders = ', '.join(['?' for _ in columns])
                col_names = ', '.join(columns)
                predictions_db.execute(
                    f'INSERT OR REPLACE INTO technical_indicators ({col_names}) VALUES ({placeholders})',
                    tuple(row[col] for col in columns)
                )
                migrated += 1
            except Exception as e:
                pass
        
        predictions_db.commit()
        log(f"   ✅ تم نقل {migrated} صف\n")
    except Exception as e:
        log(f"   ⚠️ لا يوجد جدول technical_indicators في stocks.db\n")
    
    # ===========================================================================
    # 6. تحديث جدول stocks في stocks.db من price_history
    # ===========================================================================
    log("📦 تحديث بيانات الأسهم من price_history.db...")
    
    price_db = get_connection(f'{DB_DIR}/price_history.db')
    
    # الحصول على أحدث الأسعار لكل سهم
    cursor = price_db.execute('''
        SELECT ticker, 
               MAX(date) as latest_date,
               (SELECT close_price FROM price_history ph2 WHERE ph2.ticker = ph.ticker AND ph2.date = MAX(ph.date)) as latest_close
        FROM price_history ph
        GROUP BY ticker
    ''')
    
    price_updates = {row['ticker']: {'date': row['latest_date'], 'price': row['latest_close']} for row in cursor.fetchall()}
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
    # 7. نسخ portfolio_assets من upload/stocks.db لـ stocks.db
    # ===========================================================================
    log("📦 نسخ portfolio_assets من upload/stocks.db...")
    
    try:
        cursor = custom_db.execute('SELECT * FROM portfolio_assets')
        rows = cursor.fetchall()
        log(f"   وجدت {len(rows)} صف في stocks.db")
        
        # إنشاء الجدول
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
        
        migrated = 0
        for row in rows:
            try:
                columns = row.keys()
                placeholders = ', '.join(['?' for _ in columns])
                col_names = ', '.join(columns)
                stocks_db.execute(
                    f'INSERT OR REPLACE INTO portfolio_assets ({col_names}) VALUES ({placeholders})',
                    tuple(row[col] for col in columns)
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
                log(f"  {table[0]}: {count} صف")
            conn.close()

if __name__ == '__main__':
    main()
