#!/usr/bin/env python3
"""
سكربت بسيط لتوليد توقعات تاريخية من 6 شهور فاتوا
ويحطها في قاعدة predictions.db اللي الصفحة بتقرأ منها
"""

import sqlite3
import os
from datetime import datetime, timedelta
from pathlib import Path
import random
import uuid

# المسارات - نسبية
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
DB_BACKUP_DIR = PROJECT_ROOT / 'db' / 'backup_20260607_120356'
PRICE_HISTORY_DB = str(DB_BACKUP_DIR / 'price_history.db')
STOCKS_DB = str(DB_BACKUP_DIR / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'prisma' / 'db' / 'predictions.db')

print(f"PRICE_HISTORY_DB: {PRICE_HISTORY_DB}")
print(f"STOCKS_DB: {STOCKS_DB}")
print(f"PREDICTIONS_DB: {PREDICTIONS_DB}")

def get_db(path):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn

def get_stocks():
    """جلب الأسهم من قاعدة البيانات"""
    conn = get_db(STOCKS_DB)
    rows = conn.execute('SELECT ticker, name, name_ar, current_price FROM stocks WHERE current_price > 0').fetchall()
    conn.close()
    return [{'ticker': r['ticker'], 'name': r['name'], 'name_ar': r['name_ar'], 'current_price': r['current_price']} for r in rows]

def get_price_at_date(ticker, target_date):
    """جلب سعر السهم في تاريخ معين"""
    conn = get_db(PRICE_HISTORY_DB)
    row = conn.execute('''
        SELECT close_price, date FROM price_history 
        WHERE ticker = ? AND date <= ? 
        ORDER BY date DESC LIMIT 1
    ''', (ticker, target_date)).fetchone()
    conn.close()
    if row:
        return {'close': row['close_price'], 'date': row['date']}
    return None

def get_price_history_for_month(ticker, end_date, days=60):
    """جلب تاريخ الأسعار لمدة شهر"""
    conn = get_db(PRICE_HISTORY_DB)
    rows = conn.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume 
        FROM price_history 
        WHERE ticker = ? AND date <= ? 
        ORDER BY date DESC LIMIT ?
    ''', (ticker, end_date, days)).fetchall()
    conn.close()
    return [{'date': r['date'], 'close': r['close_price'], 'open': r['open_price'],
             'high': r['high_price'], 'low': r['low_price']} for r in reversed(rows)]

def calculate_signal(history):
    """حساب إشارة التداول - منطق بسيط"""
    if len(history) < 20:
        return None
    
    closes = [h['close'] for h in history if h['close'] > 0]
    if len(closes) < 20:
        return None
    
    current = closes[-1]
    sma20 = sum(closes[-20:]) / 20
    sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else sma20
    
    score = 50
    if current > sma20: score += 10
    if current > sma50: score += 10
    if sma20 > sma50: score += 10
    
    # RSI بسيط
    gains = []
    losses = []
    for i in range(1, min(15, len(closes))):
        change = closes[-i] - closes[-i-1]
        if change > 0:
            gains.append(change)
        else:
            losses.append(abs(change))
    
    avg_gain = sum(gains) / 14 if gains else 0.001
    avg_loss = sum(losses) / 14 if losses else 0.001
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    
    if rsi < 30: score += 15  # oversold
    elif rsi > 70: score -= 15  # overbought
    
    signal = 'BUY' if score >= 65 else 'SELL' if score <= 35 else None
    if not signal:
        return None
    
    confidence = min(95, 50 + abs(score - 50))
    
    return {
        'signal': signal,
        'score': score,
        'confidence': confidence,
        'entry_price': current,
        'sma20': sma20,
        'sma50': sma50,
        'rsi': rsi
    }

def ensure_predictions_table():
    """التأكد من وجود جدول التوقعات"""
    conn = get_db(PREDICTIONS_DB)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS aiPrediction (
            id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            stock_name_ar TEXT,
            maestro_score REAL DEFAULT 50,
            confidence REAL DEFAULT 50,
            signal_type TEXT DEFAULT 'BUY',
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            regime TEXT,
            phase_scores TEXT,
            prediction_date TEXT,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            days_to_target INTEGER,
            signal_source_id TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT
        )
    ''')
    conn.commit()
    conn.close()

def insert_prediction(pred):
    """إدخال توقع في قاعدة البيانات"""
    conn = get_db(PREDICTIONS_DB)
    conn.execute('''
        INSERT OR REPLACE INTO aiPrediction 
        (id, stock_symbol, stock_name_ar, maestro_score, confidence, signal_type,
         entry_price, target_price, stop_loss, prediction_date, status, 
         final_price, profit_loss_percent, hit_target, hit_stop_loss, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        pred['id'], pred['stock_symbol'], pred['stock_name_ar'], 
        pred['maestro_score'], pred['confidence'], pred['signal_type'],
        pred['entry_price'], pred['target_price'], pred['stop_loss'],
        pred['prediction_date'], pred['status'], pred['final_price'],
        pred['profit_loss_percent'], pred['hit_target'], pred['hit_stop_loss'],
        pred['created_at']
    ))
    conn.commit()
    conn.close()

def main():
    print("=" * 60)
    print("توليد توقعات تاريخية من 6 شهور فاتوا")
    print("=" * 60)
    
    # التأكد من وجود الجدول
    ensure_predictions_table()
    
    # جلب الأسهم
    stocks = get_stocks()
    print(f"Found {len(stocks)} stocks")
    
    if not stocks:
        print("No stocks found!")
        return
    
    # تحديد الفترة (6 شهور من أول ديسمبر 2025 لأول يناير 2026)
    # 6 شهور: يناير 2025 - يونيو 2025
    months = [
        ('2025-01', '2025-01-15'),
        ('2025-02', '2025-02-15'),
        ('2025-03', '2025-03-15'),
        ('2025-04', '2025-04-15'),
        ('2025-05', '2025-05-15'),
        ('2025-06', '2025-06-15'),
    ]
    
    total_predictions = 0
    
    for month_name, prediction_date in months:
        print(f"\nProcessing {month_name}...")
        month_predictions = 0
        
        for stock in stocks[:50]:  # أول 50 سهم
            ticker = stock['ticker']
            name_ar = stock.get('name_ar', stock.get('name', ticker))
            
            # جلب تاريخ الأسعار
            history = get_price_history_for_month(ticker, prediction_date, 60)
            if len(history) < 20:
                continue
            
            # حساب الإشارة
            signal = calculate_signal(history)
            if not signal:
                continue
            
            entry = signal['entry_price']
            target_mult = 1.08 if signal['signal'] == 'BUY' else 0.92
            stop_mult = 0.95 if signal['signal'] == 'BUY' else 1.05
            
            target_price = entry * target_mult
            stop_loss = entry * stop_mult
            
            # جلب السعر النهائي (بعد 30 يوم)
            future_date = datetime.strptime(prediction_date, '%Y-%m-%d') + timedelta(days=30)
            future_date_str = future_date.strftime('%Y-%m-%d')
            future_price = get_price_at_date(ticker, future_date_str)
            
            final_price = None
            profit_loss = None
            status = 'PENDING'
            hit_target = 0
            hit_stop = 0
            
            if future_price:
                final_price = future_price['close']
                
                if signal['signal'] == 'BUY':
                    if final_price >= target_price:
                        status = 'TARGET_HIT'
                        hit_target = 1
                        profit_loss = ((final_price - entry) / entry) * 100
                    elif final_price <= stop_loss:
                        status = 'STOPPED'
                        hit_stop = 1
                        profit_loss = ((final_price - entry) / entry) * 100
                    else:
                        status = 'CLOSED'
                        profit_loss = ((final_price - entry) / entry) * 100
                else:  # SELL
                    if final_price <= target_price:
                        status = 'TARGET_HIT'
                        hit_target = 1
                        profit_loss = ((entry - final_price) / entry) * 100
                    elif final_price >= stop_loss:
                        status = 'STOPPED'
                        hit_stop = 1
                        profit_loss = ((entry - final_price) / entry) * 100
                    else:
                        status = 'CLOSED'
                        profit_loss = ((entry - final_price) / entry) * 100
            
            pred = {
                'id': f"hist_{ticker}_{month_name.replace('-', '')}",
                'stock_symbol': ticker,
                'stock_name_ar': name_ar,
                'maestro_score': signal['score'],
                'confidence': signal['confidence'],
                'signal_type': signal['signal'],
                'entry_price': round(entry, 2),
                'target_price': round(target_price, 2),
                'stop_loss': round(stop_loss, 2),
                'prediction_date': prediction_date,
                'status': status,
                'final_price': round(final_price, 2) if final_price else None,
                'profit_loss_percent': round(profit_loss, 2) if profit_loss else None,
                'hit_target': hit_target,
                'hit_stop_loss': hit_stop,
                'created_at': prediction_date + ' 10:00:00'
            }
            
            insert_prediction(pred)
            month_predictions += 1
            total_predictions += 1
        
        print(f"  Generated {month_predictions} predictions for {month_name}")
    
    print(f"\n{'=' * 60}")
    print(f"Total predictions generated: {total_predictions}")
    print(f"{'=' * 60}")
    
    # عرض ملخص
    conn = get_db(PREDICTIONS_DB)
    total = conn.execute('SELECT COUNT(*) FROM aiPrediction').fetchone()[0]
    by_status = conn.execute('''
        SELECT status, COUNT(*) as cnt FROM aiPrediction GROUP BY status
    ''').fetchall()
    conn.close()
    
    print(f"\nSummary:")
    print(f"  Total in DB: {total}")
    for row in by_status:
        print(f"  {row['status']}: {row['cnt']}")

if __name__ == '__main__':
    main()
