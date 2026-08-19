#!/usr/bin/env python3
"""
تشغيل الـ Backtest على فترة فبراير-مارس 2026
"""

import sqlite3
import math
from datetime import datetime, timedelta
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).parent.parent
STOCKS_DB = str(BASE_DIR / 'db' / 'stocks.db')
PRICE_DB = str(BASE_DIR / 'db' / 'price_history.db')

def calculate_rsi(prices, period=14):
    if len(prices) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        gains.append(change if change > 0 else 0)
        losses.append(abs(change) if change < 0 else 0)
    if len(gains) < period:
        return 50.0
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)

def calculate_sma(prices, period):
    if len(prices) < period:
        return prices[-1] if prices else 0
    return sum(prices[-period:]) / period

def calculate_macd(prices):
    if len(prices) < 26:
        return 0, 0, "neutral"
    ema12 = calculate_ema(prices, 12)
    ema26 = calculate_ema(prices, 26)
    macd = ema12 - ema26
    signal = macd * 0.8
    trend = "bullish" if macd > signal else "bearish" if macd < signal else "neutral"
    return round(macd, 4), round(signal, 4), trend

def calculate_ema(prices, period):
    if len(prices) < period:
        return prices[-1] if prices else 0
    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema
    return ema

def calculate_score(indicators, current_price):
    score = 50.0
    
    # RSI
    rsi = indicators.get('rsi', 50)
    if rsi <= 30:
        score += 12
    elif rsi <= 40:
        score += 6
    elif rsi >= 70:
        score -= 12
    elif rsi >= 60:
        score -= 6
    
    # MACD
    if indicators.get('macd_trend') == "bullish":
        score += 8
    elif indicators.get('macd_trend') == "bearish":
        score -= 8
    
    # Trend
    if indicators.get('trend') == "UPTREND":
        score += 10
    elif indicators.get('trend') == "DOWNTREND":
        score -= 10
    
    return max(0, min(100, score))

def get_signal(score):
    if score >= 80: return "STRONG_BUY"
    if score >= 65: return "BUY"
    if score >= 50: return "ACCUMULATE"
    if score >= 35: return "HOLD"
    if score >= 25: return "REDUCE"
    if score >= 15: return "SELL"
    return "STRONG_SELL"

def run_backtest():
    print("=" * 60)
    print("🚀 تشغيل الـ Backtest على فترة فبراير-مارس 2026")
    print("=" * 60)
    
    # Connect to databases
    stocks_conn = sqlite3.connect(STOCKS_DB)
    stocks_conn.row_factory = sqlite3.Row
    price_conn = sqlite3.connect(PRICE_DB)
    price_conn.row_factory = sqlite3.Row
    
    # Get stocks
    cursor = stocks_conn.cursor()
    cursor.execute("SELECT id, ticker, name_ar FROM stocks WHERE is_active = 1 OR is_active IS NULL")
    stocks = cursor.fetchall()
    print(f"📊 عدد الأسهم: {len(stocks)}")
    
    # Date range
    start_date = "2026-02-01"
    end_date = "2026-03-31"
    print(f"📅 الفترة: {start_date} إلى {end_date}")
    
    # Results
    results = {
        'total_predictions': 0,
        'correct_5d': 0,
        'correct_10d': 0,
        'by_signal': {},
        'by_stock': [],
    }
    
    predictions_to_save = []
    
    for stock in stocks:
        ticker = stock['ticker']
        stock_id = stock['id']
        
        # Get price history for this stock
        pcursor = price_conn.cursor()
        pcursor.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            AND date BETWEEN '2025-12-01' AND '2026-04-15'
            ORDER BY date ASC
        ''', (ticker,))
        
        history = [dict(row) for row in pcursor.fetchall()]
        
        if len(history) < 70:
            continue
        
        # Process each day in Feb-Mar
        for i in range(50, len(history) - 25):
            current_date = history[i]['date']
            
            # Only process Feb-Mar 2026
            if not (start_date <= current_date <= end_date):
                continue
            
            # Skip weekends (Friday=4, Saturday=5 in Python)
            date_obj = datetime.strptime(current_date, '%Y-%m-%d')
            if date_obj.weekday() >= 4:  # Friday or Saturday
                continue
            
            # Get prices up to this point
            prices = [h['close_price'] for h in history[:i+1]]
            if len(prices) < 50:
                continue
            
            current_price = prices[-1]
            if current_price <= 0:
                continue
            
            # Calculate indicators
            rsi = calculate_rsi(prices)
            sma20 = calculate_sma(prices, 20)
            sma50 = calculate_sma(prices, 50) if len(prices) >= 50 else sma20
            macd, signal, macd_trend = calculate_macd(prices)
            
            if current_price > sma20 > sma50:
                trend = "UPTREND"
            elif current_price < sma20 < sma50:
                trend = "DOWNTREND"
            else:
                trend = "SIDEWAYS"
            
            indicators = {
                'rsi': rsi,
                'sma20': sma20,
                'sma50': sma50,
                'macd_trend': macd_trend,
                'trend': trend,
            }
            
            # Calculate score and signal
            score = calculate_score(indicators, current_price)
            signal_type = get_signal(score)
            
            # Determine direction
            if signal_type in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                direction = "up"
            elif signal_type in ['SELL', 'STRONG_SELL', 'REDUCE']:
                direction = "down"
            else:
                direction = "neutral"
            
            # Skip neutral predictions
            if direction == "neutral":
                continue
            
            # Get future prices
            future = history[i+1:i+21]
            
            if len(future) >= 5:
                price_5d = future[4]['close_price']
                price_10d = future[9]['close_price'] if len(future) >= 10 else None
                price_20d = future[19]['close_price'] if len(future) >= 20 else None
                
                # Check correctness
                correct_5d = 0
                correct_10d = 0
                
                if direction == "up":
                    correct_5d = 1 if price_5d > current_price else 0
                    if price_10d:
                        correct_10d = 1 if price_10d > current_price else 0
                else:  # down
                    correct_5d = 1 if price_5d < current_price else 0
                    if price_10d:
                        correct_10d = 1 if price_10d < current_price else 0
                
                # Track results
                results['total_predictions'] += 1
                results['correct_5d'] += correct_5d
                results['correct_10d'] += correct_10d
                
                # By signal type
                if signal_type not in results['by_signal']:
                    results['by_signal'][signal_type] = {'total': 0, 'correct': 0}
                results['by_signal'][signal_type]['total'] += 1
                results['by_signal'][signal_type]['correct'] += correct_5d
                
                # Prepare prediction to save
                predictions_to_save.append({
                    'ticker': ticker,
                    'prediction_date': current_date,
                    'recommendation': signal_type,
                    'predicted_direction': direction,
                    'confidence': score,
                    'entry_price': current_price,
                    'direction_correct_5d': correct_5d,
                    'direction_correct_10d': correct_10d,
                    'actual_price_5d': price_5d,
                    'actual_price_10d': price_10d,
                })
    
    # Clear old predictions and save new ones
    cursor.execute("DELETE FROM prediction_logs")
    
    for pred in predictions_to_save:
        cursor.execute('''
            INSERT INTO prediction_logs (
                ticker, prediction_date, recommendation, predicted_direction,
                confidence, entry_price, direction_correct_5d, direction_correct_10d,
                actual_price_5d, actual_price_10d, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ''', (
            pred['ticker'], pred['prediction_date'], pred['recommendation'],
            pred['predicted_direction'], pred['confidence'], pred['entry_price'],
            pred['direction_correct_5d'], pred['direction_correct_10d'],
            pred['actual_price_5d'], pred['actual_price_10d']
        ))
    
    stocks_conn.commit()
    
    # Print results
    print()
    print("=" * 60)
    print("📊 نتائج الـ Backtest")
    print("=" * 60)
    print(f"إجمالي التوقعات: {results['total_predictions']}")
    print(f"صحيح 5 أيام: {results['correct_5d']}")
    print(f"صحيح 10 أيام: {results['correct_10d']}")
    
    if results['total_predictions'] > 0:
        accuracy_5d = (results['correct_5d'] / results['total_predictions']) * 100
        accuracy_10d = (results['correct_10d'] / results['total_predictions']) * 100
        print(f"\n✅ دقة 5 أيام: {accuracy_5d:.1f}%")
        print(f"✅ دقة 10 أيام: {accuracy_10d:.1f}%")
        
        print("\n📊 الدقة حسب نوع الإشارة:")
        for signal, data in sorted(results['by_signal'].items()):
            acc = (data['correct'] / data['total'] * 100) if data['total'] > 0 else 0
            print(f"   {signal}: {acc:.1f}% ({data['correct']}/{data['total']})")
    
    stocks_conn.close()
    price_conn.close()
    
    return results

if __name__ == "__main__":
    run_backtest()
