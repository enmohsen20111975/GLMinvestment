#!/usr/bin/env python3
"""
================================================================================
Crypto Prediction Script - Using Local Cache Data
================================================================================
إنشاء توقعات للعملات الرقمية من البيانات المحلية

Usage: python crypto_live_predictions.py
================================================================================
"""

import os
import sys
import sqlite3
import json
from datetime import datetime, timedelta
from pathlib import Path

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

# Paths
SCRIPT_DIR = Path(__file__).parent
DB_DIR = SCRIPT_DIR.parent / 'db'
STOCKS_DB_PATH = DB_DIR / 'stocks.db'
CRYPTO_CACHE_PATH = SCRIPT_DIR / 'data' / 'crypto_cache.json'

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

def load_crypto_cache():
    """تحميل بيانات الكريبتو المحفوظة"""
    if not CRYPTO_CACHE_PATH.exists():
        return None
    
    with open(CRYPTO_CACHE_PATH, 'r') as f:
        cache = json.load(f)
    
    # Extract the market data
    for key, value in cache.items():
        if 'markets' in key or 'coins/markets' in key:
            return value.get('data', [])
    
    return None

def analyze_crypto_from_market_data(coin_data):
    """تحليل العملة من بيانات السوق"""
    current_price = coin_data.get('current_price', 0)
    price_change_24h = coin_data.get('price_change_percentage_24h', 0)
    high_24h = coin_data.get('high_24h', current_price)
    low_24h = coin_data.get('low_24h', current_price)
    ath = coin_data.get('ath', current_price)
    atl = coin_data.get('atl', current_price)
    
    if current_price <= 0:
        return None
    
    # Calculate score based on market data
    score = 50
    signals = []
    
    # Price vs 24h range
    if high_24h > low_24h:
        range_position = (current_price - low_24h) / (high_24h - low_24h)
        if range_position < 0.2:
            score += 15
            signals.append(f"Near 24h Low ({range_position*100:.0f}%)")
        elif range_position > 0.8:
            score -= 15
            signals.append(f"Near 24h High ({range_position*100:.0f}%)")
    
    # Price change 24h
    if price_change_24h < -10:
        score += 20
        signals.append(f"Oversold ({price_change_24h:.1f}%)")
    elif price_change_24h < -5:
        score += 10
        signals.append(f"Dip ({price_change_24h:.1f}%)")
    elif price_change_24h > 10:
        score -= 15
        signals.append(f"Overbought (+{price_change_24h:.1f}%)")
    elif price_change_24h > 5:
        score -= 8
        signals.append(f"Rally (+{price_change_24h:.1f}%)")
    
    # ATH distance
    if ath > current_price:
        ath_distance = ((ath - current_price) / ath) * 100
        if ath_distance > 50:
            score += 10
            signals.append(f"Far from ATH (-{ath_distance:.0f}%)")
        elif ath_distance < 20:
            score -= 10
            signals.append(f"Near ATH (-{ath_distance:.0f}%)")
    
    # ATL distance
    if atl > 0 and current_price > atl:
        atl_distance = ((current_price - atl) / atl) * 100
        if atl_distance < 50:
            score += 8
            signals.append(f"Near ATL (+{atl_distance:.0f}%)")
    
    score = max(0, min(100, score))
    
    return {
        'score': score,
        'signals': signals,
        'current_price': current_price,
        'high_24h': high_24h,
        'low_24h': low_24h,
        'price_change_24h': price_change_24h,
    }

def generate_prediction(analysis):
    """توليد التوقع"""
    score = analysis['score']
    current_price = analysis['current_price']
    
    # Crypto specific - wider stops and targets
    if score >= 70:
        recommendation = "ACCUMULATE"
        predicted_direction = "UP"
        confidence = 70 + (score - 70) * 0.8
        target_price = current_price * 1.30  # 30% target
        stop_loss = current_price * 0.85      # 15% stop
    elif score >= 55:
        recommendation = "ACCUMULATE"
        predicted_direction = "UP"
        confidence = 55 + (score - 55) * 1
        target_price = current_price * 1.20   # 20% target
        stop_loss = current_price * 0.88      # 12% stop
    elif score <= 30:
        recommendation = "REDUCE"
        predicted_direction = "DOWN"
        confidence = 70 + (30 - score) * 0.8
        target_price = current_price * 0.70   # 30% target down
        stop_loss = current_price * 1.15      # 15% stop
    elif score <= 45:
        recommendation = "REDUCE"
        predicted_direction = "DOWN"
        confidence = 55 + (45 - score) * 1
        target_price = current_price * 0.80   # 20% target down
        stop_loss = current_price * 1.12      # 12% stop
    else:
        return None
    
    return recommendation, predicted_direction, round(min(90, confidence), 1), target_price, stop_loss

def run():
    print("\n" + "="*70)
    log("🚀 Crypto Prediction Script - Live Analysis", Colors.BLUE)
    print("="*70 + "\n")
    
    # Create table
    log("📦 إنشاء جدول التوقعات...", Colors.YELLOW)
    create_crypto_prediction_table()
    
    # Load cache
    log("📊 تحميل بيانات الكريبتو...", Colors.YELLOW)
    coins = load_crypto_cache()
    
    if not coins:
        log("❌ لا توجد بيانات كريبتو محفوظة", Colors.RED)
        return
    
    log(f"  ✓ تم تحميل {len(coins)} عملة", Colors.GREEN)
    print()
    
    # Clean old predictions
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
    log(f"🧹 تم مسح {count_before} توقع قديم", Colors.YELLOW)
    print()
    
    # Generate predictions
    log("🔮 إنشاء التوقعات...", Colors.YELLOW)
    log("="*70, Colors.BLUE)
    
    predictions = []
    today = datetime.now().strftime('%Y-%m-%d')
    
    # Filter non-stablecoins and analyze
    stablecoins = ['usdt', 'usdc', 'dai', 'usds', 'usde', 'usd1', 'pyusd', 'usdg', 'usdy', 'usyc', 'rlusd', 'buidl', 'figr_heloc']
    
    for coin in coins:
        coin_id = coin.get('id', '')
        symbol = coin.get('symbol', '').upper()
        name = coin.get('name', '')
        
        # Skip stablecoins
        if coin_id.lower() in stablecoins or symbol.lower() in stablecoins:
            continue
        
        # Analyze
        analysis = analyze_crypto_from_market_data(coin)
        if not analysis:
            continue
        
        # Generate prediction
        result = generate_prediction(analysis)
        if result is None:
            continue
        
        recommendation, predicted_direction, confidence, target_price, stop_loss = result
        
        prediction = {
            'coin_id': coin_id,
            'symbol': symbol,
            'name': name,
            'prediction_date': today,
            'recommendation': recommendation,
            'predicted_direction': predicted_direction,
            'confidence': confidence,
            'entry_price': round(analysis['current_price'], 4),
            'target_price': round(target_price, 4),
            'stop_loss': round(stop_loss, 4),
            'signals': ', '.join(analysis['signals'][:3]) if analysis['signals'] else '',
        }
        
        predictions.append(prediction)
        
        # Log
        color = Colors.GREEN if recommendation == 'ACCUMULATE' else Colors.RED
        log(f"  {symbol}: {recommendation} @ ${analysis['current_price']:,.2f} (ثقة: {confidence}%)", color)
    
    print()
    
    # Save predictions
    log("💾 حفظ التوقعات...", Colors.YELLOW)
    
    for pred in predictions:
        cursor.execute("""
            INSERT INTO crypto_prediction_logs 
            (coin_id, symbol, name, prediction_date, recommendation, predicted_direction, confidence,
             entry_price, target_price, stop_loss, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            pred['coin_id'], pred['symbol'], pred['name'], pred['prediction_date'],
            pred['recommendation'], pred['predicted_direction'], pred['confidence'],
            pred['entry_price'], pred['target_price'], pred['stop_loss'], pred['prediction_date']
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
    
    # Top picks
    accumulate_preds = [p for p in predictions if p['recommendation'] == 'ACCUMULATE']
    if accumulate_preds:
        print(f"\n  🌟 أفضل فرص الشراء:")
        sorted_acc = sorted(accumulate_preds, key=lambda x: x['confidence'], reverse=True)[:5]
        for p in sorted_acc:
            print(f"     {p['symbol']}: ${p['entry_price']:,.2f} → ${p['target_price']:,.2f} (ثقة: {p['confidence']}%)")
    
    print("\n" + "="*70)
    log(f"✅ تم إنشاء {len(predictions)} توقع كريبتو", Colors.GREEN)
    print("="*70 + "\n")

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        log(f"\n❌ خطأ: {e}", Colors.RED)
        import traceback
        traceback.print_exc()
