#!/usr/bin/env python3
"""
================================================================================
Crypto Prediction Reset Script - PRODUCTION VERSION v1
================================================================================
نفس نظام توقعات الأسهم المصرية لكن للعملات الرقمية

القواعد:
1. Stop Loss: 12-20% (أوسع من الأسهم)
2. Target: 20-40% (أعلى من الأسهم)
3. ثقة >= 60% فقط
4. التوزيع على 5 شهور

Usage: python crypto_predictions_reset.py
================================================================================
"""

import os
import sys
import sqlite3
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path
import time

# Colors for output
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'

def log(msg, color=Colors.GREEN):
    print(f"{color}[{datetime.now().strftime('%H:%M:%S')}] {msg}{Colors.RESET}")

# Database paths
SCRIPT_DIR = Path(__file__).parent
DB_DIR = SCRIPT_DIR.parent / 'db'
STOCKS_DB_PATH = DB_DIR / 'stocks.db'

# Configuration
MAX_PREDICTIONS = 100  # حد أقصى 100 توقع
PER_MONTH = 20  # 20 توقع لكل شهر

# 5 شهور: فبراير - مارس - أبريل - مايو - يونيو 2025
MONTHS = [
    ("2025-02-01", "2025-02-28"),
    ("2025-03-01", "2025-03-31"),
    ("2025-04-01", "2025-04-30"),
    ("2025-05-01", "2025-05-31"),
    ("2025-06-01", "2025-06-30"),
]

# Top cryptocurrencies
TOP_CRYPTOS = [
    {'id': 'bitcoin', 'symbol': 'BTC', 'name': 'Bitcoin'},
    {'id': 'ethereum', 'symbol': 'ETH', 'name': 'Ethereum'},
    {'id': 'binancecoin', 'symbol': 'BNB', 'name': 'BNB'},
    {'id': 'solana', 'symbol': 'SOL', 'name': 'Solana'},
    {'id': 'ripple', 'symbol': 'XRP', 'name': 'XRP'},
    {'id': 'cardano', 'symbol': 'ADA', 'name': 'Cardano'},
    {'id': 'dogecoin', 'symbol': 'DOGE', 'name': 'Dogecoin'},
    {'id': 'polkadot', 'symbol': 'DOT', 'name': 'Polkadot'},
    {'id': 'avalanche-2', 'symbol': 'AVAX', 'name': 'Avalanche'},
    {'id': 'chainlink', 'symbol': 'LINK', 'name': 'Chainlink'},
    {'id': 'polygon', 'symbol': 'MATIC', 'name': 'Polygon'},
    {'id': 'litecoin', 'symbol': 'LTC', 'name': 'Litecoin'},
    {'id': 'uniswap', 'symbol': 'UNI', 'name': 'Uniswap'},
    {'id': 'stellar', 'symbol': 'XLM', 'name': 'Stellar'},
    {'id': 'near', 'symbol': 'NEAR', 'name': 'NEAR Protocol'},
]

def get_db_connection():
    return sqlite3.connect(str(STOCKS_DB_PATH))

def create_crypto_prediction_table():
    """إنشاء جدول توقعات الكريبتو"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS crypto_prediction_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT,
            prediction_date TEXT NOT NULL,
            recommendation TEXT NOT NULL,
            predicted_direction TEXT NOT NULL,
            confidence REAL,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            direction_correct_5d INTEGER DEFAULT 0,
            direction_correct_10d INTEGER DEFAULT 0,
            target_reached INTEGER DEFAULT 0,
            stop_hit INTEGER DEFAULT 0,
            created_at TEXT,
            market_regime TEXT,
            fear_greed INTEGER
        )
    """)
    
    conn.commit()
    conn.close()
    log("  ✓ تم إنشاء جدول crypto_prediction_logs", Colors.GREEN)

def clean_crypto_predictions():
    """مسح توقعات الكريبتو القديمة"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT COUNT(*) FROM crypto_prediction_logs")
        count_before = cursor.fetchone()[0]
    except:
        count_before = 0
    
    cursor.execute("DELETE FROM crypto_prediction_logs")
    try:
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='crypto_prediction_logs'")
    except:
        pass
    
    conn.commit()
    conn.close()
    
    log(f"  ✓ تم مسح {count_before} سجل", Colors.GREEN)
    return count_before

def fetch_crypto_history(coin_id, days=365):
    """جلب بيانات العملة من CoinGecko"""
    try:
        url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc?vs_currency=usd&days={min(days, 365)}"
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode())
        
        # CoinGecko OHLC format: [timestamp, open, high, low, close]
        history = []
        for candle in data:
            history.append({
                'date': datetime.fromtimestamp(candle[0] / 1000).strftime('%Y-%m-%d'),
                'open': candle[1],
                'high': candle[2],
                'low': candle[3],
                'close': candle[4],
            })
        
        return history
        
    except Exception as e:
        log(f"  ⚠️ خطأ في جلب {coin_id}: {e}", Colors.YELLOW)
        return []

def calculate_rsi(closes, period=14):
    """حساب RSI"""
    if len(closes) < period + 1:
        return 50
    
    gains = 0
    losses = 0
    
    for i in range(len(closes) - period, len(closes)):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gains += change
        else:
            losses += abs(change)
    
    if losses == 0:
        return 100
    
    rs = gains / losses
    return 100 - (100 / (1 + rs))

def calculate_macd(closes):
    """حساب MACD — REAL implementation (no fake signal=macd*0.9 per owner directive).

    MACD line = EMA12 - EMA26
    Signal line = 9-period EMA of MACD line
    """
    if len(closes) < 35:  # need 26 for EMA26 + 9 for signal EMA
        return 0, 0

    # EMA 12
    k12 = 2 / (12 + 1)
    ema12_list = [closes[0]]
    for c in closes[1:]:
        ema12_list.append(c * k12 + ema12_list[-1] * (1 - k12))

    # EMA 26
    k26 = 2 / (26 + 1)
    ema26_list = [closes[0]]
    for c in closes[1:]:
        ema26_list.append(c * k26 + ema26_list[-1] * (1 - k26))

    # MACD line (needs EMA26 to start producing valid values from index 25)
    macd_line_list = []
    for i in range(len(closes)):
        macd_line_list.append(ema12_list[i] - ema26_list[i])

    # Signal line = 9-period EMA of MACD line (use the full MACD series)
    k9 = 2 / (9 + 1)
    signal_list = [macd_line_list[0]]
    for m in macd_line_list[1:]:
        signal_list.append(m * k9 + signal_list[-1] * (1 - k9))

    macd = macd_line_list[-1]
    signal = signal_list[-1]

    return macd, signal

def analyze_crypto(prices):
    """تحليل العملة الرقمية"""
    if not prices or len(prices) < 30:
        return None
    
    closes = [p['close'] for p in prices]
    current_price = closes[-1]
    
    # Technical indicators
    rsi = calculate_rsi(closes)
    macd, signal = calculate_macd(closes)
    
    # Moving averages
    ma20 = sum(closes[-20:]) / 20
    ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else ma20
    
    # Calculate score
    score = 50
    signals = []
    
    # RSI - Crypto is more volatile
    if rsi < 25:
        score += 20
        signals.append(f"RSI Deep Oversold ({rsi:.0f})")
    elif rsi < 35:
        score += 12
        signals.append(f"RSI Oversold ({rsi:.0f})")
    elif rsi > 75:
        score -= 20
        signals.append(f"RSI Deep Overbought ({rsi:.0f})")
    elif rsi > 65:
        score -= 12
        signals.append(f"RSI Overbought ({rsi:.0f})")
    
    # MACD
    if macd > signal and macd > 0:
        score += 15
        signals.append("MACD Bullish")
    elif macd < signal and macd < 0:
        score -= 15
        signals.append("MACD Bearish")
    
    # MA alignment
    if current_price > ma20 > ma50:
        score += 15
        signals.append("MA Bullish Stack")
    elif current_price < ma20 < ma50:
        score -= 15
        signals.append("MA Bearish Stack")
    
    # Momentum (7-day for crypto)
    if len(closes) >= 7:
        mom = ((closes[-1] / closes[-7]) - 1) * 100
        if mom > 15:
            score += 12
            signals.append(f"Strong Mom +{mom:.1f}%")
        elif mom > 8:
            score += 6
            signals.append(f"Mom +{mom:.1f}%")
        elif mom < -15:
            score -= 12
            signals.append(f"Strong Mom {mom:.1f}%")
        elif mom < -8:
            score -= 6
            signals.append(f"Mom {mom:.1f}%")
    
    # Clamp score
    score = max(0, min(100, score))
    
    return {
        'score': score,
        'signals': signals,
        'current_price': current_price,
        'rsi': rsi,
        'macd': macd,
        'ma20': ma20,
        'ma50': ma50,
    }

def generate_crypto_prediction(analysis):
    """توليد توقع العملة الرقمية"""
    score = analysis['score']
    current_price = analysis['current_price']
    
    # Crypto specific - wider stops and targets
    if score >= 75:
        recommendation = "ACCUMULATE"
        predicted_direction = "UP"
        confidence = 75 + (score - 75) * 0.6
        target_price = current_price * 1.35  # 35% target
        stop_loss = current_price * 0.85      # 15% stop
    elif score >= 60:
        recommendation = "ACCUMULATE"
        predicted_direction = "UP"
        confidence = 60 + (score - 60) * 1
        target_price = current_price * 1.25   # 25% target
        stop_loss = current_price * 0.88      # 12% stop
    elif score <= 25:
        recommendation = "REDUCE"
        predicted_direction = "DOWN"
        confidence = 75 + (25 - score) * 0.6
        target_price = current_price * 0.65   # 35% target down
        stop_loss = current_price * 1.15      # 15% stop
    elif score <= 40:
        recommendation = "REDUCE"
        predicted_direction = "DOWN"
        confidence = 60 + (40 - score) * 1
        target_price = current_price * 0.75   # 25% target down
        stop_loss = current_price * 1.12      # 12% stop
    else:
        return None, None, None, None, None
    
    return recommendation, predicted_direction, round(min(95, confidence), 1), target_price, stop_loss

def calculate_verification(entry_price, predicted_direction, target_price, stop_loss, prices_after):
    """حساب التحقق الفعلي"""
    if not prices_after or len(prices_after) < 3:
        return None
    
    result = {
        'direction_correct_5d': 0,
        'direction_correct_10d': 0,
        'target_reached': 0,
        'stop_hit': 0,
    }
    
    # 5-day check
    if len(prices_after) >= 5:
        price_5d = prices_after[4]['close']
        
        if predicted_direction == 'UP' and price_5d > entry_price:
            result['direction_correct_5d'] = 1
        elif predicted_direction == 'DOWN' and price_5d < entry_price:
            result['direction_correct_5d'] = 1
    
    # 10-day check
    if len(prices_after) >= 10:
        price_10d = prices_after[9]['close']
        
        if predicted_direction == 'UP' and price_10d > entry_price:
            result['direction_correct_10d'] = 1
        elif predicted_direction == 'DOWN' and price_10d < entry_price:
            result['direction_correct_10d'] = 1
    
    # Target/Stop check
    for price in prices_after[:15]:
        if target_price and price['high'] >= target_price:
            result['target_reached'] = 1
            break
        if stop_loss and price['low'] <= stop_loss:
            result['stop_hit'] = 1
            break
    
    return result

def run():
    print("\n" + "="*70)
    log("🚀 Crypto Prediction Reset Script v1 - 100 PREDICTIONS MAX", Colors.BLUE)
    log("📅 التوزيع: 5 أيام × 4 أسابيع × 5 شهور", Colors.CYAN)
    print("="*70 + "\n")
    
    # Create table
    log("📦 إنشاء جدول التوقعات...", Colors.YELLOW)
    create_crypto_prediction_table()
    print()
    
    # Clean old predictions
    log("🧹 مسح التوقعات القديمة...", Colors.YELLOW)
    clean_crypto_predictions()
    print()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Generate predictions
    log("🔮 إنشاء التوقعات (موزعة على 5 شهور)...", Colors.YELLOW)
    log("="*70, Colors.BLUE)
    
    predictions = []
    stats = {
        'total': 0,
        'correct_5d': 0,
        'correct_10d': 0,
        'target_hit': 0,
        'stop_hit': 0,
    }
    
    for month_start, month_end in MONTHS:
        if len(predictions) >= MAX_PREDICTIONS:
            break
        
        log(f"\n  📅 الشهر: {month_start[:7]}", Colors.CYAN)
        
        month_predictions = []
        
        for crypto in TOP_CRYPTOS:
            if len(month_predictions) >= PER_MONTH:
                break
            
            log(f"    📊 جلب بيانات {crypto['symbol']}...", Colors.CYAN)
            
            # Fetch history
            history = fetch_crypto_history(crypto['id'], 365)
            
            if len(history) < 60:
                log(f"    ⚠️ بيانات غير كافية لـ {crypto['symbol']}", Colors.YELLOW)
                continue
            
            # Find dates in this month
            month_dates = [h['date'] for h in history if month_start <= h['date'] <= month_end]
            
            if not month_dates:
                log(f"    ⚠️ لا توجد بيانات في {month_start[:7]} لـ {crypto['symbol']}", Colors.YELLOW)
                continue
            
            # Get the first available date in the month
            pred_date = month_dates[0]
            
            # Find index in history
            pred_idx = next((i for i, h in enumerate(history) if h['date'] == pred_date), None)
            
            if pred_idx is None or pred_idx < 50:
                continue
            
            # Get analysis data (before prediction date)
            analysis_data = history[:pred_idx + 1]
            
            # Analyze
            analysis = analyze_crypto(analysis_data)
            if not analysis:
                continue
            
            # Generate prediction
            result = generate_crypto_prediction(analysis)
            if result[0] is None:
                continue
            
            recommendation, predicted_direction, confidence, target_price, stop_loss = result
            
            # Get verification data
            verification_data = history[pred_idx + 1:pred_idx + 16]
            verification_data = [h for h in verification_data if h['date'] > pred_date]
            
            if len(verification_data) < 5:
                continue
            
            # Calculate verification
            verification = calculate_verification(
                analysis['current_price'], predicted_direction, target_price, stop_loss, verification_data
            )
            
            if not verification:
                continue
            
            prediction = {
                'coin_id': crypto['id'],
                'symbol': crypto['symbol'],
                'name': crypto['name'],
                'prediction_date': pred_date,
                'recommendation': recommendation,
                'predicted_direction': predicted_direction,
                'confidence': confidence,
                'entry_price': round(analysis['current_price'], 4),
                'target_price': round(target_price, 4),
                'stop_loss': round(stop_loss, 4),
                'direction_correct_5d': verification['direction_correct_5d'],
                'direction_correct_10d': verification['direction_correct_10d'],
                'target_reached': verification['target_reached'],
                'stop_hit': verification['stop_hit'],
            }
            
            month_predictions.append(prediction)
            stats['total'] += 1
            stats['correct_5d'] += verification['direction_correct_5d']
            stats['correct_10d'] += verification['direction_correct_10d']
            stats['target_hit'] += verification['target_reached']
            stats['stop_hit'] += verification['stop_hit']
            
            log(f"    ✓ {crypto['symbol']}: {recommendation} @ ${analysis['current_price']:,.2f}", Colors.GREEN)
            
            # Rate limiting for API
            time.sleep(0.5)
        
        predictions.extend(month_predictions)
        log(f"    ✓ {len(month_predictions)} توقع في {month_start[:7]}", Colors.GREEN)
    
    print()
    
    # Save predictions
    log("💾 حفظ التوقعات...", Colors.YELLOW)
    
    for pred in predictions:
        cursor.execute("""
            INSERT INTO crypto_prediction_logs 
            (coin_id, symbol, name, prediction_date, recommendation, predicted_direction, confidence,
             entry_price, target_price, stop_loss,
             direction_correct_5d, direction_correct_10d, target_reached, stop_hit, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            pred['coin_id'], pred['symbol'], pred['name'], pred['prediction_date'],
            pred['recommendation'], pred['predicted_direction'], pred['confidence'],
            pred['entry_price'], pred['target_price'], pred['stop_loss'],
            pred['direction_correct_5d'], pred['direction_correct_10d'],
            pred['target_reached'], pred['stop_hit'], pred['prediction_date']
        ))
    
    conn.commit()
    conn.close()
    
    log(f"  ✓ تم حفظ {len(predictions)} توقع", Colors.GREEN)
    print()
    
    # Summary
    print("="*70)
    log("📊 ملخص توقعات العملات الرقمية", Colors.BLUE)
    print("="*70)
    
    acc = sum(1 for p in predictions if p['recommendation'] == 'ACCUMULATE')
    reduce_sig = sum(1 for p in predictions if p['recommendation'] == 'REDUCE')
    
    print(f"\n  🟢 ACCUMULATE: {acc}")
    print(f"  🔴 REDUCE: {reduce_sig}")
    print(f"  📊 الإجمالي: {len(predictions)}")
    
    if stats['total'] > 0:
        accuracy_5d = (stats['correct_5d'] / stats['total']) * 100
        accuracy_10d = (stats['correct_10d'] / stats['total']) * 100
        
        print(f"\n  📈 دقة 5 أيام: {accuracy_5d:.1f}% ({stats['correct_5d']}/{stats['total']})")
        print(f"  📈 دقة 10 أيام: {accuracy_10d:.1f}%")
        print(f"  🎯 حقق الهدف: {stats['target_hit']}")
        print(f"  🛑 وقف خسارة: {stats['stop_hit']}")
        
        closed = stats['target_hit'] + stats['stop_hit']
        if closed > 0:
            success_rate = (stats['target_hit'] / closed) * 100
            print(f"  ✅ نسبة النجاح: {success_rate:.1f}%")
        
        # Breakdown by month
        print("\n  📊 توزيع التوقعات بالشهور:")
        for month_start, month_end in MONTHS:
            month_preds = [p for p in predictions if p['prediction_date'] >= month_start and p['prediction_date'] <= month_end]
            if month_preds:
                month_correct = sum(p['direction_correct_5d'] for p in month_preds)
                month_acc = (month_correct / len(month_preds)) * 100
                print(f"     {month_start[:7]}: {len(month_preds)} توقع، دقة {month_acc:.1f}%")
        
        # Breakdown by coin
        print("\n  📊 أداء العملات:")
        for crypto in TOP_CRYPTOS[:10]:
            coin_preds = [p for p in predictions if p['coin_id'] == crypto['id']]
            if coin_preds:
                coin_correct = sum(p['direction_correct_5d'] for p in coin_preds)
                coin_acc = (coin_correct / len(coin_preds)) * 100
                print(f"     {crypto['symbol']}: {len(coin_preds)} توقع، دقة {coin_acc:.1f}%")
    
    print("\n" + "="*70)
    log(f"✅ تم إنشاء {len(predictions)} توقع كريبتو موزعة على 5 شهور", Colors.GREEN)
    print("="*70 + "\n")

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        log(f"\n❌ خطأ: {e}", Colors.RED)
        import traceback
        traceback.print_exc()
