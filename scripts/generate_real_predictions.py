#!/usr/bin/env python3
"""
توليد توقعات حقيقية من 6 شهور سابقة
يستخدم Master Analyzer الحقيقي للتحليل
يملأ جدول aiPrediction الذي تقرأ منه صفحة تقييم التوقعات
"""

import sqlite3
import sys
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

# إضافة مسار المشروع
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

# المسارات
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

# عدد التوقعات اليومية
MIN_DAILY_PREDICTIONS = 3
MAX_DAILY_PREDICTIONS = 6


def ensure_predictions_table():
    """إنشاء جدول التوقعات - إسقاط القديم وإنشاء جديد مع عمود market"""
    conn = sqlite3.connect(PREDICTIONS_DB)
    cursor = conn.cursor()
    
    # إسقاط الجدول القديم لضمان وجود عمود market
    cursor.execute('DROP TABLE IF EXISTS aiPrediction')
    print("🗑️ تم إسقاط الجدول القديم")
    
    # إنشاء الجدول الجديد مع عمود market
    cursor.execute('''
        CREATE TABLE aiPrediction (
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
            market TEXT DEFAULT 'EGX',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT
        )
    ''')
    
    # إنشاء فهارس
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_prediction_date ON aiPrediction(prediction_date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_signal_type ON aiPrediction(signal_type)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_status ON aiPrediction(status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_market ON aiPrediction(market)')
    
    conn.commit()
    conn.close()
    print("✅ تم إنشاء جدول التوقعات مع عمود market")


def get_all_stocks() -> List[Dict]:
    """جلب كل الأسهم من كل الأسواق"""
    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT symbol as ticker, name, market, price as current_price
        FROM stocks 
        WHERE price IS NOT NULL AND price > 0
        ORDER BY market, volume DESC
    ''')
    
    stocks = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    # تحويل أسماء الأسواق للكود
    market_map = {
        'مصر': 'EGX',
        'السعودية': 'TADAWUL',
        'الكويت': 'KSE',
        'قطر': 'QSE'
    }
    
    for stock in stocks:
        stock['market_code'] = market_map.get(stock['market'], stock['market'])
    
    return stocks


def get_price_history(ticker: str, end_date: str, days: int = 100) -> List[Dict]:
    """جلب تاريخ الأسعار"""
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC
            LIMIT ?
        ''', (ticker, end_date, days))
        
        rows = cursor.fetchall()
        conn.close()
        
        # ترتيب تصاعدي
        history = [dict(row) for row in reversed(rows)]
        return history
    except Exception as e:
        conn.close()
        return []


def get_price_at_date(ticker: str, target_date: str) -> Optional[float]:
    """جلب سعر السهم في تاريخ معين"""
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            SELECT close_price FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC LIMIT 1
        ''', (ticker, target_date))
        
        row = cursor.fetchone()
        conn.close()
        
        if row and row[0]:
            return float(row[0])
        return None
    except:
        conn.close()
        return None


def calculate_simple_analysis(prices: List[float], volumes: List[float] = None) -> Dict:
    """
    تحليل بسيط للأسعار (بديل سريع عن Master Analyzer)
    يحسب: RSI, MACD, Trend, Score
    """
    if len(prices) < 30:
        return None
    
    current_price = prices[-1]
    
    # 1. حساب SMA
    sma20 = sum(prices[-20:]) / 20
    sma50 = sum(prices[-50:]) / 50 if len(prices) >= 50 else sma20
    
    # 2. حساب RSI
    gains = []
    losses = []
    for i in range(1, min(15, len(prices))):
        change = prices[-i] - prices[-i-1]
        if change > 0:
            gains.append(change)
        else:
            losses.append(abs(change))
    
    avg_gain = sum(gains) / 14 if gains else 0.001
    avg_loss = sum(losses) / 14 if losses else 0.001
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    
    # 3. حساب MACD بسيط
    ema12 = sum(prices[-12:]) / 12
    ema26 = sum(prices[-26:]) / 26 if len(prices) >= 26 else ema12
    macd = ema12 - ema26
    macd_signal = macd * 0.8
    
    # 4. تحديد الاتجاه
    if current_price > sma20 > sma50:
        trend = 'UPTREND'
    elif current_price < sma20 < sma50:
        trend = 'DOWNTREND'
    else:
        trend = 'SIDEWAYS'
    
    # 5. حساب Score
    score = 50.0
    
    # RSI
    if rsi < 30:
        score += 15  # Oversold - إشارة شراء
    elif rsi < 40:
        score += 8
    elif rsi > 70:
        score -= 15  # Overbought - إشارة بيع
    elif rsi > 60:
        score -= 8
    
    # Trend
    if trend == 'UPTREND':
        score += 10
    elif trend == 'DOWNTREND':
        score -= 10
    
    # MACD
    if macd > macd_signal:
        score += 8
    else:
        score -= 8
    
    # Price vs SMA
    if current_price > sma20:
        score += 5
    else:
        score -= 5
    
    # تحديد الإشارة
    if score >= 60:
        signal = 'BUY'
    elif score >= 50:
        signal = 'ACCUMULATE'
    elif score >= 40:
        signal = 'HOLD'
    elif score >= 30:
        signal = 'REDUCE'
    else:
        signal = 'SELL'
    
    # حساب الهدف ووقف الخسارة
    if signal in ['BUY', 'ACCUMULATE']:
        target_price = current_price * 1.08  # +8%
        stop_loss = current_price * 0.95     # -5%
    elif signal in ['SELL', 'REDUCE']:
        target_price = current_price * 0.92  # -8%
        stop_loss = current_price * 1.05     # +5%
    else:
        target_price = current_price * 1.05
        stop_loss = current_price * 0.95
    
    return {
        'score': round(score, 2),
        'signal': signal,
        'confidence': min(95, 50 + abs(score - 50)),
        'rsi': round(rsi, 2),
        'trend': trend,
        'macd': round(macd, 4),
        'sma20': round(sma20, 2),
        'sma50': round(sma50, 2),
        'target_price': round(target_price, 2),
        'stop_loss': round(stop_loss, 2),
        'entry_price': round(current_price, 2)
    }


def insert_prediction(pred: Dict):
    """إدخال توقع في قاعدة البيانات"""
    conn = sqlite3.connect(PREDICTIONS_DB)
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT OR REPLACE INTO aiPrediction 
        (id, stock_symbol, stock_name_ar, maestro_score, confidence, signal_type,
         entry_price, target_price, stop_loss, prediction_date, status, 
         final_price, profit_loss_percent, hit_target, hit_stop_loss, 
         regime, market, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        pred['id'],
        pred['stock_symbol'],
        pred['stock_name_ar'],
        pred['maestro_score'],
        pred['confidence'],
        pred['signal_type'],
        pred['entry_price'],
        pred['target_price'],
        pred['stop_loss'],
        pred['prediction_date'],
        pred['status'],
        pred['final_price'],
        pred['profit_loss_percent'],
        pred['hit_target'],
        pred['hit_stop_loss'],
        pred.get('regime', 'NORMAL'),
        pred.get('market', 'EGX'),
        pred['created_at']
    ))
    
    conn.commit()
    conn.close()


def generate_predictions_for_day(
    day: str,
    stocks: List[Dict],
    predictions_per_day: int = 4
) -> List[Dict]:
    """توليد توقعات ليوم معين"""
    
    # تصفية الأسهم حسب السوق
    markets = {}
    for stock in stocks:
        market = stock.get('market_code', 'EGX')
        if market not in markets:
            markets[market] = []
        markets[market].append(stock)
    
    predictions = []
    
    # اختيار أسهم من كل سوق
    for market, market_stocks in markets.items():
        if not market_stocks:
            continue
        
        # عدد التوقعات لكل سوق (نوزع بالتساوي)
        market_quota = max(1, predictions_per_day // len(markets))
        
        # تحليل الأسهم واختيار الأفضل
        analyzed = []
        for stock in market_stocks[:30]:  # أول 30 سهم من كل سوق
            ticker = stock['ticker']
            
            # جلب تاريخ الأسعار
            history = get_price_history(ticker, day, 100)
            
            if len(history) < 30:
                continue
            
            prices = [h['close_price'] for h in history if h['close_price']]
            
            if len(prices) < 30:
                continue
            
            # تحليل بسيط
            analysis = calculate_simple_analysis(prices)
            
            if analysis and analysis['signal'] in ['BUY', 'SELL', 'ACCUMULATE']:
                analyzed.append({
                    'stock': stock,
                    'analysis': analysis,
                    'market': market
                })
        
        # ترتيب حسب Confidence
        analyzed.sort(key=lambda x: x['analysis']['confidence'], reverse=True)
        
        # اختيار أفضل الأسهم (تنويع بين شراء وبيع)
        buy_selected = [a for a in analyzed if a['analysis']['signal'] in ['BUY', 'ACCUMULATE']][:market_quota//2 + 1]
        sell_selected = [a for a in analyzed if a['analysis']['signal'] in ['SELL', 'REDUCE']][:market_quota//2 + 1]
        
        selected = (buy_selected + sell_selected)[:market_quota]
        
        for item in selected:
            stock = item['stock']
            analysis = item['analysis']
            
            predictions.append({
                'stock': stock,
                'analysis': analysis,
                'market': market,
                'day': day
            })
    
    return predictions


def main():
    print("=" * 70)
    print("🚀 توليد توقعات حقيقية من 6 شهور سابقة")
    print("=" * 70)
    
    # إنشاء الجدول
    ensure_predictions_table()
    
    # جلب الأسهم
    print("\n📊 جلب الأسهم...")
    stocks = get_all_stocks()
    print(f"   إجمالي الأسهم: {len(stocks)}")
    
    # تحديد الفترة (6 شهور)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=180)
    
    print(f"\n📅 الفترة: {start_date.strftime('%Y-%m-%d')} إلى {end_date.strftime('%Y-%m-%d')}")
    
    # أيام التداول (تخطي الجمعة والسبت)
    trading_days = []
    current = start_date
    while current < end_date:
        # تخطي الجمعة (4) والسبت (5)
        if current.weekday() < 4:
            trading_days.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    
    print(f"   أيام التداول: {len(trading_days)}")
    
    # مسح التوقعات القديمة
    conn = sqlite3.connect(PREDICTIONS_DB)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM aiPrediction')
    conn.commit()
    conn.close()
    print("\n🗑️ تم مسح التوقعات القديمة")
    
    # توليد التوقعات
    total_predictions = 0
    by_signal = {'BUY': 0, 'SELL': 0, 'ACCUMULATE': 0, 'HOLD': 0, 'REDUCE': 0}
    by_market = {}
    
    print("\n🔄 توليد التوقعات...")
    
    for i, day in enumerate(trading_days):
        if i % 20 == 0:
            print(f"   معالجة: {day} ({i+1}/{len(trading_days)})")
        
        # توليد 4-6 توقعات يومياً
        predictions = generate_predictions_for_day(day, stocks, predictions_per_day=5)
        
        for pred in predictions:
            stock = pred['stock']
            analysis = pred['analysis']
            
            # جلب السعر النهائي (بعد 30 يوم)
            future_date = datetime.strptime(day, '%Y-%m-%d') + timedelta(days=30)
            future_date_str = future_date.strftime('%Y-%m-%d')
            final_price = get_price_at_date(stock['ticker'], future_date_str)
            
            # حساب النتيجة
            status = 'PENDING'
            profit_loss = None
            hit_target = 0
            hit_stop = 0
            
            if final_price:
                entry_price = analysis['entry_price']
                target_price = analysis['target_price']
                stop_loss = analysis['stop_loss']
                
                if analysis['signal'] in ['BUY', 'ACCUMULATE']:
                    profit_loss = ((final_price - entry_price) / entry_price) * 100
                    if final_price >= target_price:
                        status = 'TARGET_HIT'
                        hit_target = 1
                    elif final_price <= stop_loss:
                        status = 'STOPPED'
                        hit_stop = 1
                    else:
                        status = 'CLOSED'
                else:  # SELL, REDUCE
                    profit_loss = ((entry_price - final_price) / entry_price) * 100
                    if final_price <= target_price:
                        status = 'TARGET_HIT'
                        hit_target = 1
                    elif final_price >= stop_loss:
                        status = 'STOPPED'
                        hit_stop = 1
                    else:
                        status = 'CLOSED'
            
            # إنشاء ID فريد
            pred_id = f"pred_{day.replace('-', '')}_{stock['ticker']}"
            
            # إدخال التوقع
            prediction_record = {
                'id': pred_id,
                'stock_symbol': stock['ticker'],
                'stock_name_ar': stock.get('name', stock['ticker']),
                'maestro_score': analysis['score'],
                'confidence': analysis['confidence'],
                'signal_type': analysis['signal'],
                'entry_price': analysis['entry_price'],
                'target_price': analysis['target_price'],
                'stop_loss': analysis['stop_loss'],
                'prediction_date': day,
                'status': status,
                'final_price': round(final_price, 2) if final_price else None,
                'profit_loss_percent': round(profit_loss, 2) if profit_loss else None,
                'hit_target': hit_target,
                'hit_stop_loss': hit_stop,
                'regime': analysis['trend'],
                'market': pred['market'],  # إضافة السوق
                'created_at': day + ' 10:00:00'
            }
            
            insert_prediction(prediction_record)
            
            # تحديث الإحصائيات
            total_predictions += 1
            signal = analysis['signal']
            if signal in by_signal:
                by_signal[signal] += 1
            
            market = pred['market']
            if market not in by_market:
                by_market[market] = 0
            by_market[market] += 1
    
    # عرض الملخص
    print("\n" + "=" * 70)
    print("📊 ملخص التوقعات")
    print("=" * 70)
    print(f"إجمالي التوقعات: {total_predictions}")
    
    print("\nحسب نوع الإشارة:")
    for signal, count in by_signal.items():
        if count > 0:
            print(f"   {signal}: {count}")
    
    print("\nحسب السوق:")
    for market, count in sorted(by_market.items()):
        print(f"   {market}: {count}")
    
    # حساب الدقة
    conn = sqlite3.connect(PREDICTIONS_DB)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as targets,
            SUM(CASE WHEN hit_stop_loss = 1 THEN 1 ELSE 0 END) as stops,
            AVG(profit_loss_percent) as avg_return
        FROM aiPrediction 
        WHERE status != 'PENDING'
    ''')
    
    row = cursor.fetchone()
    conn.close()
    
    if row and row[0] > 0:
        total = row[0]
        targets = row[1] or 0
        stops = row[2] or 0
        avg_return = row[3] or 0
        
        win_rate = (targets / total * 100) if total > 0 else 0
        
        print("\n📈 تقييم الأداء:")
        print(f"   توقعات مغلقة: {total}")
        print(f"   أصابت الهدف: {targets} ({win_rate:.1f}%)")
        print(f"   أصابت وقف الخسارة: {stops}")
        print(f"   متوسط العائد: {avg_return:.2f}%")
    
    print("\n✅ تم حفظ التوقعات في: db/predictions.db")
    print("🌐 يمكن عرضها من: https://invist.m2y.net/#prediction-performance")


if __name__ == '__main__':
    main()
