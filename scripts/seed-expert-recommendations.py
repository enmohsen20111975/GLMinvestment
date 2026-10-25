#!/usr/bin/env python3
"""
Seed Expert Recommendations and Prediction Logs
================================================
This script adds sample data for testing and demonstration.
"""

import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.expanduser('~/GLMinvestment/db/auth.db')
STOCKS_DB_PATH = os.path.expanduser('~/GLMinvestment/db/stocks.db')

def log(msg):
    print(f"[SEED] {msg}")

def seed_expert_recommendations():
    """Add expert recommendations to auth.db"""
    log("Seeding expert recommendations...")
    
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=True).__enter__()
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ExpertRecommendation (
            id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            stock_name_ar TEXT,
            expert_name TEXT NOT NULL,
            action TEXT NOT NULL,
            recommendation_type TEXT DEFAULT 'detailed',
            entry_price REAL NOT NULL,
            entry_price_from REAL,
            entry_price_to REAL,
            target_price REAL,
            target_price_2 REAL,
            investment_target REAL,
            stop_loss REAL,
            session_date TEXT,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            notes TEXT,
            recommendation_date TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    
    # Clear existing data
    cursor.execute("DELETE FROM ExpertRecommendation")
    
    recommendations = [
        # التوصيات الأولى (2/6/2026)
        ('exp001', 'BTFH', 'بلتون القابضة', 'خبير السوق', 'BUY', 3.18, 3.18, 3.20, 3.35, 3.52, None, 3.15, None, 'PENDING', None, None, 0, 0, 'T+1 لجلسة 3/6', '2026-06-02'),
        ('exp002', 'EGTS', 'زهراء المعادي', 'خبير السوق', 'BUY', 6.04, 6.00, 6.04, 6.33, 6.50, None, 5.95, None, 'SUCCESS', 6.22, 2.98, 1, 0, 'T+1 حقق هدف 6.22', '2026-06-02'),
        ('exp003', 'DSCW', 'دايس للملابس', 'خبير السوق', 'BUY', 1.81, None, None, 1.97, 2.10, None, 1.75, None, 'PENDING', None, None, 0, 0, 'T+1 لجلسة 3/6', '2026-06-02'),
        ('exp004', 'EGCH', 'كيما', 'محلل مالي', 'BUY', 14.65, 14.60, 14.95, 15.60, 15.90, 16.50, 14.25, None, 'SUCCESS', 15.15, 3.41, 1, 0, 'هدف استثماري 16.50', '2026-06-03'),
        ('exp005', 'EHDR', 'المصريين للإسكان', 'محلل مالي', 'BUY', 2.37, 2.35, 2.43, 2.56, 2.60, 2.75, 2.27, None, 'SUCCESS', 2.60, 9.70, 1, 0, 'هدف استثماري 2.75', '2026-06-03'),
        ('exp006', 'ACAMD', 'العربية لإدارة الأصول', 'خبير السوق', 'BUY', 2.28, 2.25, 2.30, 2.40, 2.55, None, 2.21, None, 'PENDING', None, None, 0, 0, 'ورقة من بداية الأسبوع', '2026-06-03'),
        ('exp007', 'FWRY', 'فوري', 'محلل مالي', 'BUY', 20.00, 19.80, 20.00, None, None, None, None, None, 'PENDING', None, None, 0, 0, 'تصطاد في التريحات', '2026-06-03'),
        
        # توصيات 19/5/2026
        ('exp008', 'EHDR', 'المصريين للإسكان', 'خبير السوق', 'BUY', 2.27, None, None, None, None, None, None, None, 'PENDING', None, None, 0, 0, 'دعم / ارتداد - اغلاق قرب دعم مهم جداً', '2026-05-19'),
        ('exp009', 'FWRY', 'فوري', 'خبير السوق', 'BUY', 19.35, None, None, None, None, None, None, None, 'PENDING', None, None, 0, 0, 'دعم / ارتداد - اغلاق قرب دعم مهم', '2026-05-19'),
        ('exp010', 'EGTS', 'زهراء المعادي', 'خبير السوق', 'BUY', 6.09, None, None, None, None, None, None, None, 'PENDING', None, None, 0, 0, 'دعم / ارتداد - قافل عند الدعم', '2026-05-19'),
        
        # توصيات 20/5/2026
        ('exp011', 'SWDY', 'السويدي إلكتريك', 'محلل مالي', 'BUY', 88.30, 88.00, 88.90, 91.00, 91.40, 94.50, 86.50, None, 'PENDING', None, None, 0, 0, 'هدف استثماري 94.50', '2026-05-20'),
        ('exp012', 'ETEL', 'المصرية للاتصالات', 'محلل مالي', 'BUY', 95.00, 94.50, 95.75, 99.00, 101.80, 107.75, 91.00, None, 'PENDING', None, None, 0, 0, 'هدف استثماري 107.75', '2026-05-20'),
        
        # توصيات 25/5/2026
        ('exp013', 'RACC', 'راية خدمات', 'خبير السوق', 'BUY', 10.00, 9.92, 10.10, 10.30, 10.55, 11.00, 9.70, None, 'PENDING', None, None, 0, 0, 'هدف استثماري 11.00', '2026-05-25'),
        ('exp014', 'DSCW', 'دايس للملابس', 'خبير السوق', 'BUY', 1.73, None, 1.80, 1.94, 1.97, 2.02, 1.68, None, 'PENDING', None, None, 0, 0, 'هدف استثماري 2.02', '2026-05-25'),
        
        # توصيات 1/6/2026
        ('exp015', 'EFIH', 'إي فاينانس', 'محلل مالي', 'BUY', 22.20, 22.00, 22.50, 23.65, 24.50, None, 21.30, None, 'PENDING', None, None, 0, 0, None, '2026-06-01'),
        ('exp016', 'ORHD', 'أوراسكوم للتنمية', 'محلل مالي', 'BUY', 36.50, 35.10, 37.85, 39.00, 39.50, 42.00, 34.70, None, 'PENDING', None, None, 0, 0, 'هدف استثماري 42.00', '2026-06-01'),
        ('exp017', 'MTIE', 'إم إم جروب', 'محلل مالي', 'BUY', 9.00, 8.90, 9.20, 9.55, 9.85, 10.25, None, None, 'PENDING', None, None, 0, 0, 'هدف استثماري 10.25', '2026-06-01'),
    ]
    
    for rec in recommendations:
        cursor.execute("""
            INSERT INTO ExpertRecommendation 
            (id, stock_symbol, stock_name_ar, expert_name, action, entry_price, 
             entry_price_from, entry_price_to, target_price, target_price_2, 
             investment_target, stop_loss, session_date, status, final_price, 
             profit_loss_percent, hit_target, hit_stop_loss, notes, recommendation_date,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        """, rec)
    
    conn.commit()
    count = cursor.execute("SELECT COUNT(*) FROM ExpertRecommendation").fetchone()[0]
    conn.close()
    
    log(f"Added {count} expert recommendations")
    return count

def seed_prediction_logs():
    """Add prediction logs to stocks.db"""
    log("Seeding prediction logs...")
    
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB_PATH, writable=True).__enter__()
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prediction_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            prediction_date TEXT NOT NULL,
            recommendation TEXT DEFAULT 'HOLD',
            predicted_direction TEXT DEFAULT 'neutral',
            confidence REAL DEFAULT 50,
            entry_price REAL DEFAULT 0,
            target_price REAL DEFAULT 0,
            stop_loss REAL DEFAULT 0,
            direction_correct_5d INTEGER,
            direction_correct_10d INTEGER,
            target_reached INTEGER DEFAULT 0,
            stop_hit INTEGER DEFAULT 0,
            actual_price_5d REAL,
            actual_price_10d REAL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            verified_at TEXT
        )
    """)
    
    # Get data from cached_analysis
    try:
        cursor.execute("""
            SELECT ticker, current_price, signal, master_score
            FROM cached_analysis
            WHERE current_price > 0 AND signal IS NOT NULL
            LIMIT 50
        """)
        stocks = cursor.fetchall()
        
        if not stocks:
            log("No stocks found in cached_analysis, creating sample data...")
            stocks = [
                ('COMI', 45.00, 'BUY', 75),
                ('ETAL', 28.50, 'ACCUMULATE', 70),
                ('EGCH', 14.65, 'BUY', 72),
                ('EHDR', 2.37, 'ACCUMULATE', 68),
                ('BTFH', 3.18, 'BUY', 65),
                ('SWDY', 88.30, 'ACCUMULATE', 70),
                ('ETEL', 95.00, 'BUY', 72),
                ('FWRY', 20.00, 'HOLD', 55),
                ('ACAMD', 2.28, 'ACCUMULATE', 67),
                ('MTIE', 9.00, 'BUY', 69),
            ]
        
        # Clear existing predictions
        cursor.execute("DELETE FROM prediction_logs")
        
        import random
        inserted = 0
        for stock in stocks:
            ticker = stock[0]
            price = stock[1] or 10.0
            signal = stock[2] or 'HOLD'
            confidence = min(stock[3] or 50, 95)
            
            recommendation = 'ACCUMULATE' if signal in ['BUY', 'ACCUMULATE'] else 'HOLD'
            direction = 'up' if signal in ['BUY', 'ACCUMULATE'] else ('down' if signal == 'REDUCE' else 'neutral')
            
            # Random outcomes
            correct_5d = 1 if random.random() > 0.35 else 0
            correct_10d = 1 if random.random() > 0.30 else 0
            target_reached = 1 if random.random() > 0.6 else 0
            
            cursor.execute("""
                INSERT INTO prediction_logs 
                (ticker, prediction_date, recommendation, predicted_direction, confidence,
                 entry_price, target_price, stop_loss, direction_correct_5d, direction_correct_10d,
                 target_reached, created_at)
                VALUES (?, date('now', '-7 days'), ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (ticker, recommendation, direction, confidence, price, price * 1.10, price * 0.95, correct_5d, correct_10d, target_reached))
            inserted += 1
        
        conn.commit()
        log(f"Added {inserted} prediction logs")
        
    except Exception as e:
        log(f"Error seeding prediction logs: {e}")
    
    count = cursor.execute("SELECT COUNT(*) FROM prediction_logs").fetchone()[0]
    conn.close()
    return count

def main():
    log("=" * 50)
    log("Starting Database Seed")
    log(f"Time: {datetime.now()}")
    log("=" * 50)
    
    expert_count = seed_expert_recommendations()
    prediction_count = seed_prediction_logs()
    
    log("=" * 50)
    log("Seed Complete!")
    log(f"Expert Recommendations: {expert_count}")
    log(f"Prediction Logs: {prediction_count}")
    log("=" * 50)

if __name__ == '__main__':
    main()
