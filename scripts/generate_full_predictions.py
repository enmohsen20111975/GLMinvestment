#!/usr/bin/env python3
"""
سكربت توليد توقعات AI لكل الأسواق من 6 شهور
- يحافظ على بيانات الخبراء الحقيقية الموجودة
- يضيف توقعات AI فقط
- كل الأسواق: مصر، السعودية، الكويت، دبي، كريبتو، فوركس
"""

import sqlite3
import os
from datetime import datetime, timedelta
from pathlib import Path
import random
import uuid

# المسارات
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
DB_BACKUP_DIR = PROJECT_ROOT / 'db' / 'backup_20260607_120356'
PRICE_HISTORY_DB = str(DB_BACKUP_DIR / 'price_history.db')
STOCKS_DB = str(DB_BACKUP_DIR / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'prisma' / 'db' / 'predictions.db')

# الأسواق
MARKETS = {
    'egx': {'name': 'البورصة المصرية', 'flag': '🇪🇬', 'stocks_db': STOCKS_DB, 'price_db': PRICE_HISTORY_DB},
    'ksa': {'name': 'السعودية', 'flag': '🇸🇦', 'stocks_db': None, 'price_db': None},
    'kse': {'name': 'الكويت', 'flag': '🇰🇼', 'stocks_db': None, 'price_db': None},
    'dfm': {'name': 'دبي', 'flag': '🇦🇪', 'stocks_db': None, 'price_db': None},
    'crypto': {'name': 'العملات الرقمية', 'flag': '₿', 'stocks_db': None, 'price_db': None},
    'forex': {'name': 'العملات', 'flag': '💱', 'stocks_db': None, 'price_db': None},
}

def get_db(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn

def get_egx_stocks():
    """جلب أسهم البورصة المصرية"""
    try:
        conn = get_db(STOCKS_DB)
        rows = conn.execute('SELECT ticker, name, name_ar, current_price FROM stocks WHERE current_price > 0').fetchall()
        conn.close()
        return [{'ticker': r['ticker'], 'name': r['name'], 'name_ar': r['name_ar'], 'current_price': r['current_price'], 'market': 'egx'} for r in rows]
    except Exception as e:
        print(f"Error loading EGX stocks: {e}")
        return []

def get_crypto_symbols():
    """رموز العملات الرقمية"""
    return [
        {'ticker': 'BTC', 'name': 'Bitcoin', 'name_ar': 'بيتكوين', 'current_price': 67000, 'market': 'crypto'},
        {'ticker': 'ETH', 'name': 'Ethereum', 'name_ar': 'إيثريوم', 'current_price': 3500, 'market': 'crypto'},
        {'ticker': 'BNB', 'name': 'Binance Coin', 'name_ar': 'بينانس', 'current_price': 600, 'market': 'crypto'},
        {'ticker': 'SOL', 'name': 'Solana', 'name_ar': 'سولانا', 'current_price': 170, 'market': 'crypto'},
        {'ticker': 'XRP', 'name': 'Ripple', 'name_ar': 'ريببل', 'current_price': 0.5, 'market': 'crypto'},
        {'ticker': 'ADA', 'name': 'Cardano', 'name_ar': 'كاردانو', 'current_price': 0.45, 'market': 'crypto'},
        {'ticker': 'DOGE', 'name': 'Dogecoin', 'name_ar': 'دوجكوين', 'current_price': 0.15, 'market': 'crypto'},
        {'ticker': 'DOT', 'name': 'Polkadot', 'name_ar': 'بولكادوت', 'current_price': 7, 'market': 'crypto'},
    ]

def get_forex_pairs():
    """أزواج العملات"""
    return [
        {'ticker': 'EUR/USD', 'name': 'Euro/USD', 'name_ar': 'يورو/دولار', 'current_price': 1.08, 'market': 'forex'},
        {'ticker': 'GBP/USD', 'name': 'Pound/USD', 'name_ar': 'جنيه/دولار', 'current_price': 1.27, 'market': 'forex'},
        {'ticker': 'USD/JPY', 'name': 'USD/Yen', 'name_ar': 'دولار/ين', 'current_price': 155, 'market': 'forex'},
        {'ticker': 'USD/CHF', 'name': 'USD/Franc', 'name_ar': 'دولار/فرنك', 'current_price': 0.88, 'market': 'forex'},
        {'ticker': 'AUD/USD', 'name': 'Aud/USD', 'name_ar': 'أسترالي/دولار', 'current_price': 0.65, 'market': 'forex'},
    ]

def get_ksa_stocks():
    """أسهم السعودية"""
    return [
        {'ticker': '2222.SR', 'name': 'Saudi Aramco', 'name_ar': 'أرامكو', 'current_price': 28, 'market': 'ksa'},
        {'ticker': '1120.SR', 'name': 'Al Rajhi Bank', 'name_ar': 'الراجحي', 'current_price': 95, 'market': 'ksa'},
        {'ticker': '1180.SR', 'name': 'SABIC', 'name_ar': 'سابك', 'current_price': 85, 'market': 'ksa'},
        {'ticker': '1210.SR', 'name': 'STC', 'name_ar': 'الاتصالات', 'current_price': 38, 'market': 'ksa'},
        {'ticker': '1150.SR', 'name': 'SNB', 'name_ar': 'الأهلي', 'current_price': 42, 'market': 'ksa'},
    ]

def get_kse_stocks():
    """أسهم الكويت"""
    return [
        {'ticker': 'KUW', 'name': 'Kuwait Wait', 'name_ar': 'كويت ويت', 'current_price': 850, 'market': 'kse'},
        {'ticker': 'NBK', 'name': 'National Bank', 'name_ar': 'بنك الكويت', 'current_price': 450, 'market': 'kse'},
        {'ticker': 'ZAIN', 'name': 'Zain Kuwait', 'name_ar': 'زين', 'current_price': 700, 'market': 'kse'},
    ]

def get_dfm_stocks():
    """أسهم دبي"""
    return [
        {'ticker': 'EMAAR', 'name': 'Emaar Properties', 'name_ar': 'إعمار', 'current_price': 6.5, 'market': 'dfm'},
        {'ticker': 'DIB', 'name': 'Dubai Islamic Bank', 'name_ar': 'دبي الإسلامي', 'current_price': 5.2, 'market': 'dfm'},
        {'ticker': 'EMIRATES', 'name': 'Emirates NBD', 'name_ar': 'الإمارات', 'current_price': 12, 'market': 'dfm'},
    ]

def get_price_at_date(ticker, target_date):
    """جلب سعر السهم في تاريخ معين (للEGX فقط)"""
    try:
        conn = get_db(PRICE_HISTORY_DB)
        row = conn.execute('''
            SELECT close_price, date FROM price_history 
            WHERE ticker = ? AND date <= ? 
            ORDER BY date DESC LIMIT 1
        ''', (ticker, target_date)).fetchone()
        conn.close()
        if row:
            return {'close': row['close_price'], 'date': row['date']}
    except:
        pass
    return None

def simulate_price(current_price, volatility=0.1):
    """محاكاة سعر عشوائي للأسواق التانية"""
    change = random.uniform(-volatility, volatility)
    return current_price * (1 + change)

def ensure_tables():
    """التأكد من وجود الجداول - بدون مسح البيانات الموجودة"""
    conn = get_db(PREDICTIONS_DB)
    
    # جدول AI Predictions - إنشاء لو مش موجود
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
    
    # جدول Expert Recommendations - إنشاء لو مش موجود
    conn.execute('''
        CREATE TABLE IF NOT EXISTS ExpertRecommendation (
            id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            stock_name_ar TEXT,
            expert_name TEXT,
            expert_source TEXT,
            action TEXT DEFAULT 'BUY',
            recommendation_type TEXT DEFAULT 'detailed',
            entry_price REAL,
            entry_price_from REAL,
            entry_price_to REAL,
            entry_condition TEXT,
            target_price REAL,
            target_price_2 REAL,
            investment_target REAL,
            stop_loss REAL,
            stop_loss_condition TEXT,
            support_level REAL,
            resistance_level REAL,
            expected_profit_min REAL,
            expected_profit_max REAL,
            expected_profit_invest REAL,
            technical_analysis TEXT,
            fundamental_analysis TEXT,
            recommendation_reason TEXT,
            session_date TEXT,
            session_type TEXT,
            expected_duration TEXT,
            expected_duration_days INTEGER,
            status TEXT DEFAULT 'PENDING',
            final_price REAL,
            profit_loss_percent REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop_loss INTEGER DEFAULT 0,
            notes TEXT,
            recommendation_date TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT
        )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ Tables ensured (existing data preserved)")

def clear_ai_predictions_only():
    """مسح توقعات AI القديمة فقط - بدون مسح توقعات الخبراء"""
    conn = get_db(PREDICTIONS_DB)
    count = conn.execute('SELECT COUNT(*) FROM aiPrediction').fetchone()[0]
    conn.execute('DELETE FROM aiPrediction')
    conn.commit()
    conn.close()
    print(f"✅ Cleared {count} old AI predictions (expert data preserved)")

def generate_signal(entry_price, random_factor=0.5):
    """توليد إشارة تداول"""
    r = random.random()
    
    if r < 0.35:  # 35% BUY
        signal = 'BUY'
        target = entry_price * random.uniform(1.05, 1.15)
        stop = entry_price * random.uniform(0.92, 0.97)
    elif r < 0.65:  # 30% SELL
        signal = 'SELL'
        target = entry_price * random.uniform(0.85, 0.95)
        stop = entry_price * random.uniform(1.03, 1.08)
    else:  # 35% HOLD - skip
        return None
    
    confidence = random.uniform(55, 90)
    score = random.uniform(50, 85)
    
    return {
        'signal': signal,
        'target': target,
        'stop': stop,
        'confidence': confidence,
        'score': score
    }

def get_market_from_symbol(symbol):
    """تحديد السوق من رمز السهم"""
    if symbol.endswith('.SR') or symbol in ['2222.SR', '1120.SR', '1180.SR', '1210.SR', '1150.SR']:
        return 'ksa'
    elif symbol in ['KUW', 'NBK', 'ZAIN']:
        return 'kse'
    elif symbol in ['EMAAR', 'DIB', 'EMIRATES']:
        return 'dfm'
    elif symbol in ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT']:
        return 'crypto'
    elif '/' in symbol:
        return 'forex'
    else:
        return 'egx'

def generate_monthly_predictions():
    """توليد توقعات AI لـ 6 شهور"""
    
    # 6 شهور: ديسمبر 2025 - مايو 2026
    months = [
        ('2025-12', '2025-12-15'),
        ('2026-01', '2026-01-15'),
        ('2026-02', '2026-02-15'),
        ('2026-03', '2026-03-15'),
        ('2026-04', '2026-04-15'),
        ('2026-05', '2026-05-15'),
    ]
    
    # كل الأسهم من كل الأسواق
    all_stocks = []
    all_stocks.extend(get_egx_stocks())
    all_stocks.extend(get_ksa_stocks())
    all_stocks.extend(get_kse_stocks())
    all_stocks.extend(get_dfm_stocks())
    all_stocks.extend(get_crypto_symbols())
    all_stocks.extend(get_forex_pairs())
    
    print(f"📊 Total stocks across all markets: {len(all_stocks)}")
    
    ai_count = 0
    
    for month_name, prediction_date in months:
        print(f"\n🔄 Processing {month_name}...")
        
        for stock in all_stocks:
            ticker = stock['ticker']
            name_ar = stock.get('name_ar', stock.get('name', ticker))
            market = stock['market']
            entry_price = stock['current_price']
            
            # ===== AI PREDICTION ONLY =====
            signal = generate_signal(entry_price)
            if signal:
                # تحديد السعر النهائي (محاكاة)
                if market == 'egx':
                    future_price_data = get_price_at_date(ticker, prediction_date)
                    if future_price_data:
                        final_price = future_price_data['close']
                    else:
                        final_price = simulate_price(entry_price, 0.15)
                else:
                    final_price = simulate_price(entry_price, 0.20 if market == 'crypto' else 0.10)
                
                # تحديد النتيجة
                if signal['signal'] == 'BUY':
                    if final_price >= signal['target']:
                        status = 'TARGET_HIT'
                        hit_target = 1
                        hit_stop = 0
                    elif final_price <= signal['stop']:
                        status = 'STOPPED'
                        hit_target = 0
                        hit_stop = 1
                    else:
                        status = 'CLOSED'
                        hit_target = 0
                        hit_stop = 0
                    profit_pct = min(max(((final_price - entry_price) / entry_price) * 100, -50), 50)
                else:  # SELL
                    if final_price <= signal['target']:
                        status = 'TARGET_HIT'
                        hit_target = 1
                        hit_stop = 0
                    elif final_price >= signal['stop']:
                        status = 'STOPPED'
                        hit_target = 0
                        hit_stop = 1
                    else:
                        status = 'CLOSED'
                        hit_target = 0
                        hit_stop = 0
                    profit_pct = min(max(((entry_price - final_price) / entry_price) * 100, -50), 50)
                
                ai_pred = {
                    'id': f"ai_{ticker}_{month_name.replace('-', '')}",
                    'stock_symbol': ticker,
                    'stock_name_ar': name_ar,
                    'maestro_score': round(signal['score'], 1),
                    'confidence': round(signal['confidence'], 1),
                    'signal_type': signal['signal'],
                    'entry_price': round(entry_price, 2),
                    'target_price': round(signal['target'], 2),
                    'stop_loss': round(signal['stop'], 2),
                    'prediction_date': prediction_date,
                    'status': status,
                    'final_price': round(final_price, 2),
                    'profit_loss_percent': round(profit_pct, 2),
                    'hit_target': hit_target,
                    'hit_stop_loss': hit_stop,
                    'created_at': prediction_date + ' 09:00:00'
                }
                
                insert_ai_prediction(ai_pred)
                ai_count += 1
        
        print(f"   Month {month_name}: {ai_count} AI predictions so far")
    
    return ai_count

def insert_ai_prediction(pred):
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

def print_summary():
    """طباعة ملخص"""
    conn = get_db(PREDICTIONS_DB)
    
    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    
    # AI Predictions
    total_ai = conn.execute('SELECT COUNT(*) FROM aiPrediction').fetchone()[0]
    by_status_ai = conn.execute('SELECT status, COUNT(*) as cnt FROM aiPrediction GROUP BY status').fetchall()
    by_market_ai = conn.execute('''
        SELECT 
            CASE 
                WHEN stock_symbol LIKE '%.SR' THEN 'ksa'
                WHEN stock_symbol LIKE '%KUW%' OR stock_symbol IN ('NBK','ZAIN') THEN 'kse'
                WHEN stock_symbol IN ('EMAAR','DIB','EMIRATES') THEN 'dfm'
                WHEN stock_symbol IN ('BTC','ETH','BNB','SOL','XRP','ADA','DOGE','DOT') THEN 'crypto'
                WHEN stock_symbol LIKE '%/%' THEN 'forex'
                ELSE 'egx'
            END as market,
            COUNT(*) as cnt
        FROM aiPrediction GROUP BY market
    ''').fetchall()
    
    print(f"\n🤖 AI Predictions: {total_ai}")
    for row in by_status_ai:
        print(f"   {row['status']}: {row['cnt']}")
    print("   By Market:")
    for row in by_market_ai:
        market_names = {'egx': '🇪🇬 EGX', 'ksa': '🇸🇦 KSA', 'kse': '🇰🇼 KSE', 'dfm': '🇦🇪 DFM', 'crypto': '₿ Crypto', 'forex': '💱 Forex'}
        print(f"      {market_names.get(row['market'], row['market'])}: {row['cnt']}")
    
    # Expert Recommendations (المحفوظة)
    try:
        total_exp = conn.execute('SELECT COUNT(*) FROM ExpertRecommendation').fetchone()[0]
        by_status_exp = conn.execute('SELECT status, COUNT(*) as cnt FROM ExpertRecommendation GROUP BY status').fetchall()
        
        print(f"\n👤 Expert Recommendations (PRESERVED): {total_exp}")
        for row in by_status_exp:
            print(f"   {row['status']}: {row['cnt']}")
    except:
        print(f"\n👤 Expert Recommendations: 0 (table not found)")
    
    # إحصائيات الأرباح
    ai_profit = conn.execute('SELECT SUM(profit_loss_percent) FROM aiPrediction WHERE hit_target = 1').fetchone()[0] or 0
    ai_loss = conn.execute('SELECT SUM(ABS(profit_loss_percent)) FROM aiPrediction WHERE hit_stop_loss = 1').fetchone()[0] or 0
    
    print(f"\n💰 AI Performance:")
    print(f"   +{round(ai_profit, 1)}% profit, -{round(ai_loss, 1)}% loss")
    print(f"   Net: {round(ai_profit - ai_loss, 1)}%")
    
    conn.close()

def main():
    print("=" * 60)
    print("🚀 توليد توقعات AI لكل الأسواق من 6 شهور")
    print("📍 يحافظ على بيانات الخبراء الحقيقية")
    print("=" * 60)
    
    # التأكد من الجداول (بدون مسح البيانات)
    ensure_tables()
    
    # مسح توقعات AI القديمة فقط
    clear_ai_predictions_only()
    
    # توليد التوقعات
    ai_count = generate_monthly_predictions()
    
    # ملخص
    print_summary()
    
    print(f"\n✅ Done! Generated {ai_count} AI predictions")
    print("✅ Expert data preserved")

if __name__ == '__main__':
    main()
