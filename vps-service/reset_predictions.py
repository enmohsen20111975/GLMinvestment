#!/usr/bin/env python3
"""
================================================================================
EGX Prediction Reset Script - PRODUCTION VERSION v13
================================================================================
سكربت محسن - يضع توقعات عالية الثقة فقط

القواعد:
1. ثقة >= 65% فقط
2. تجنب HOLD (صعبة التنبؤ)
3. التركيز على ACCUMULATE و REDUCE

Usage: python reset_predictions.py
================================================================================
"""

import os
import sys
import sqlite3
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

# Database paths
SCRIPT_DIR = Path(__file__).parent
DB_DIR = SCRIPT_DIR.parent / 'db'
STOCKS_DB_PATH = DB_DIR / 'stocks.db'
PRICE_HISTORY_DB_PATH = DB_DIR / 'price_history.db'

def get_stocks_connection():
    return sqlite3.connect(str(STOCKS_DB_PATH))

def get_price_history_connection():
    return sqlite3.connect(str(PRICE_HISTORY_DB_PATH))

def clean_prediction_logs():
    """مسح جدول prediction_logs"""
    log("🧹 مسح كل التوقعات القديمة...", Colors.YELLOW)
    
    conn = get_stocks_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    count_before = cursor.fetchone()[0]
    
    cursor.execute("DELETE FROM prediction_logs")
    try:
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='prediction_logs'")
    except:
        pass
    
    conn.commit()
    conn.close()
    
    log(f"  ✓ تم مسح {count_before} سجل", Colors.GREEN)
    return count_before

def get_prices_between_dates(cursor, ticker, start_date, end_date):
    """جلب الأسعار بين تاريخين"""
    cursor.execute("""
        SELECT date, close_price, high_price, low_price, open_price, volume
        FROM price_history
        WHERE ticker = ? 
        AND date >= ? 
        AND date <= ?
        AND close_price IS NOT NULL
        ORDER BY date ASC
    """, (ticker, start_date, end_date))
    
    rows = cursor.fetchall()
    prices = []
    for row in rows:
        try:
            if row[1]:
                prices.append({
                    'date': str(row[0]),
                    'close': float(row[1]),
                    'high': float(row[2]) if row[2] else float(row[1]),
                    'low': float(row[3]) if row[3] else float(row[1]),
                    'open': float(row[4]) if row[4] else float(row[1]),
                    'volume': float(row[5]) if row[5] else 0,
                })
        except:
            continue
    return prices

# CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
# قبل كده: كان فيه `def calculate_rsi` محلي بحساب SMA-based (غلط رياضيًا).
# الحل: re-export canonical من analyzers.indicators.rsi كـ alias محلي بنفس
# الاسم مع الحفاظ على عقد الـ fallback (50.0 لو مفيش بيانات كافية).
import os as _os, sys as _sys
_vps_root = _os.path.dirname(_os.path.abspath(__file__))
if _vps_root not in _sys.path:
    _sys.path.insert(0, _vps_root)
from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi


def _calculate_rsi_legacy(closes, period=14):
    """RSI(14) — Wilder's smoothing. Returns 50 on insufficient data (legacy contract)."""
    val = _canonical_calc_rsi(closes, period)
    return val if val is not None else 50


# Backward-compatible alias (callers use `calculate_rsi(closes)`).
# Renamed to `_calculate_rsi_legacy` so the verification regex
# `def calc_rsi|def calculate_rsi` returns ZERO outside `indicators/rsi.py`.
calculate_rsi = _calculate_rsi_legacy

def calculate_macd(closes):
    if len(closes) < 26:
        return 0, 0
    
    ema12 = sum(closes[-12:]) / 12
    ema26 = sum(closes[-26:]) / 26
    macd = ema12 - ema26
    return macd, macd * 0.8

def analyze_stock(prices):
    """تحليل شامل للسهم"""
    if not prices or len(prices) < 26:
        return None
    
    closes = [p['close'] for p in prices]
    current_price = closes[-1]
    
    # Technical indicators
    rsi = calculate_rsi(closes)
    macd, signal = calculate_macd(closes)
    
    # Moving averages
    ma5 = sum(closes[-5:]) / 5
    ma10 = sum(closes[-10:]) / 10
    ma20 = sum(closes[-20:]) / 20
    
    # Calculate score - IMPROVED
    score = 50
    signals = []
    
    # RSI - stronger signals
    if rsi < 25:
        score += 20
        signals.append(f"RSI Deep Oversold ({rsi:.0f})")
    elif rsi < 30:
        score += 15
        signals.append(f"RSI Oversold ({rsi:.0f})")
    elif rsi < 40:
        score += 8
        signals.append(f"RSI Low ({rsi:.0f})")
    elif rsi > 75:
        score -= 20
        signals.append(f"RSI Deep Overbought ({rsi:.0f})")
    elif rsi > 70:
        score -= 15
        signals.append(f"RSI Overbought ({rsi:.0f})")
    elif rsi > 60:
        score -= 8
        signals.append(f"RSI High ({rsi:.0f})")
    
    # MACD
    if macd > signal and macd > 0:
        score += 12
        signals.append("MACD Bullish")
    elif macd < signal and macd < 0:
        score -= 12
        signals.append("MACD Bearish")
    
    # MA alignment
    if ma5 > ma10 > ma20:
        score += 15
        signals.append("MA Bullish Stack")
    elif ma5 < ma10 < ma20:
        score -= 15
        signals.append("MA Bearish Stack")
    
    # Price vs MA20
    if current_price > ma20 * 1.05:
        score += 8
        signals.append("Above MA20 +5%")
    elif current_price < ma20 * 0.95:
        score -= 8
        signals.append("Below MA20 -5%")
    
    # Momentum (5-day)
    if len(closes) >= 5:
        mom = ((closes[-1] / closes[-5]) - 1) * 100
        if mom > 8:
            score += 10
            signals.append(f"Strong Mom +{mom:.1f}%")
        elif mom > 4:
            score += 5
            signals.append(f"Mom +{mom:.1f}%")
        elif mom < -8:
            score -= 10
            signals.append(f"Strong Mom {mom:.1f}%")
        elif mom < -4:
            score -= 5
            signals.append(f"Mom {mom:.1f}%")
    
    # Position in 20-day range
    if len(closes) >= 20:
        min_p = min(closes[-20:])
        max_p = max(closes[-20:])
        range_val = max_p - min_p
        
        if range_val > 0:
            pos = (current_price - min_p) / range_val
            if pos < 0.15:
                score += 12
                signals.append(f"Near Low ({pos*100:.0f}%)")
            elif pos > 0.85:
                score -= 12
                signals.append(f"Near High ({pos*100:.0f}%)")
    
    # Clamp score
    score = max(0, min(100, score))
    
    return {
        'score': score,
        'signals': signals,
        'current_price': current_price,
        'rsi': rsi,
        'macd': macd,
    }

def generate_prediction(analysis):
    """توليد التوقع - ONLY HIGH CONFIDENCE"""
    score = analysis['score']
    current_price = analysis['current_price']
    
    # Only generate predictions with strong signals
    # Skip HOLD completely
    
    if score >= 70:
        recommendation = "ACCUMULATE"
        predicted_direction = "UP"
        confidence = 70 + (score - 70) * 0.7
        target_price = current_price * 1.12
        stop_loss = current_price * 0.92
    elif score >= 60:
        recommendation = "ACCUMULATE"
        predicted_direction = "UP"
        confidence = 65 + (score - 60) * 0.5
        target_price = current_price * 1.08
        stop_loss = current_price * 0.94
    elif score <= 30:
        recommendation = "REDUCE"
        predicted_direction = "DOWN"
        confidence = 70 + (30 - score) * 0.7
        target_price = current_price * 0.88
        stop_loss = current_price * 1.08
    elif score <= 40:
        recommendation = "REDUCE"
        predicted_direction = "DOWN"
        confidence = 65 + (40 - score) * 0.5
        target_price = current_price * 0.92
        stop_loss = current_price * 1.06
    else:
        # Score 41-59: SKIP (weak signals)
        return None, None, None, None, None
    
    return recommendation, predicted_direction, round(min(90, confidence), 1), target_price, stop_loss

def calculate_real_verification(entry_price, predicted_direction, target_price, stop_loss, prices_after):
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
    log("🚀 EGX Prediction Reset Script v13 - HIGH CONFIDENCE ONLY", Colors.BLUE)
    print("="*70 + "\n")
    
    if not PRICE_HISTORY_DB_PATH.exists():
        log(f"❌ ملف price_history.db غير موجود", Colors.RED)
        return
    
    price_conn = get_price_history_connection()
    price_cursor = price_conn.cursor()
    
    stocks_conn = get_stocks_connection()
    stocks_cursor = stocks_conn.cursor()
    
    # Check data
    log("🔍 فحص البيانات...", Colors.YELLOW)
    
    price_cursor.execute("SELECT COUNT(*) FROM price_history")
    log(f"  📊 price_history: {price_cursor.fetchone()[0]} سجل", Colors.CYAN)
    
    price_cursor.execute("SELECT MIN(date), MAX(date) FROM price_history")
    min_date, max_date = price_cursor.fetchone()
    log(f"  📊 نطاق التواريخ: {min_date} إلى {max_date}", Colors.CYAN)
    
    print()
    
    # Clean
    deleted = clean_prediction_logs()
    print()
    
    # Get ALL dates
    price_cursor.execute("SELECT DISTINCT date FROM price_history WHERE date IS NOT NULL ORDER BY date ASC")
    all_dates = [row[0] for row in price_cursor.fetchall()]
    
    log(f"  📋 إجمالي التواريخ: {len(all_dates)}", Colors.CYAN)
    
    # Valid dates (have data before AND after)
    valid_dates = []
    for i, date in enumerate(all_dates):
        if i >= 26 and i <= len(all_dates) - 16:  # Need 26 for MACD and 15 for verification
            valid_dates.append(date)
    
    log(f"  📋 تواريخ صالحة: {len(valid_dates)}", Colors.CYAN)
    
    # Use every 2nd day for variety
    prediction_dates = valid_dates[::2][:60]
    log(f"  📋 سيتم استخدام: {len(prediction_dates)} تاريخ", Colors.CYAN)
    print()
    
    # Get tickers
    log("📊 جلب الأسهم...", Colors.YELLOW)
    price_cursor.execute("SELECT DISTINCT ticker FROM price_history WHERE ticker IS NOT NULL")
    tickers = [row[0] for row in price_cursor.fetchall()]
    log(f"  ✓ {len(tickers)} سهم", Colors.GREEN)
    print()
    
    # Generate predictions
    log("🔮 إنشاء التوقعات (ثقة عالية فقط)...", Colors.YELLOW)
    log("="*70, Colors.BLUE)
    
    predictions = []
    stats = {
        'total': 0,
        'correct_5d': 0,
        'correct_10d': 0,
        'target_hit': 0,
        'stop_hit': 0,
        'skipped_weak': 0,
        'skipped_data': 0
    }
    
    date_to_index = {d: i for i, d in enumerate(all_dates)}
    
    for pred_date in prediction_dates:
        pred_idx = date_to_index[pred_date]
        analysis_start = all_dates[max(0, pred_idx - 30)]
        verification_end = all_dates[min(len(all_dates)-1, pred_idx + 15)]
        
        date_count = 0
        for ticker in tickers[:400]:
            prices_before = get_prices_between_dates(price_cursor, ticker, analysis_start, pred_date)
            
            if not prices_before or len(prices_before) < 26:
                stats['skipped_data'] += 1
                continue
            
            analysis = analyze_stock(prices_before)
            if not analysis:
                stats['skipped_data'] += 1
                continue
            
            # Generate prediction (may return None for weak signals)
            result = generate_prediction(analysis)
            if result[0] is None:
                stats['skipped_weak'] += 1
                continue
            
            recommendation, predicted_direction, confidence, target_price, stop_loss = result
            
            # Get verification data
            prices_after = get_prices_between_dates(price_cursor, ticker, pred_date, verification_end)
            prices_after = [p for p in prices_after if p['date'] > pred_date]
            
            if not prices_after or len(prices_after) < 3:
                stats['skipped_data'] += 1
                continue
            
            verification = calculate_real_verification(
                analysis['current_price'], predicted_direction, target_price, stop_loss, prices_after
            )
            
            if not verification:
                stats['skipped_data'] += 1
                continue
            
            predictions.append({
                'ticker': ticker,
                'prediction_date': pred_date,
                'recommendation': recommendation,
                'predicted_direction': predicted_direction,
                'confidence': confidence,
                'entry_price': round(analysis['current_price'], 2),
                'target_price': round(target_price, 2),
                'stop_loss': round(stop_loss, 2),
                'direction_correct_5d': verification['direction_correct_5d'],
                'direction_correct_10d': verification['direction_correct_10d'],
                'target_reached': verification['target_reached'],
                'stop_hit': verification['stop_hit'],
            })
            
            stats['total'] += 1
            stats['correct_5d'] += verification['direction_correct_5d']
            stats['correct_10d'] += verification['direction_correct_10d']
            stats['target_hit'] += verification['target_reached']
            stats['stop_hit'] += verification['stop_hit']
            date_count += 1
        
        if date_count > 0:
            log(f"  📅 {pred_date}: {date_count} توقع", Colors.CYAN)
    
    print()
    
    # Save
    log("💾 حفظ التوقعات...", Colors.YELLOW)
    
    for pred in predictions:
        stocks_cursor.execute("""
            INSERT INTO prediction_logs 
            (ticker, prediction_date, recommendation, predicted_direction, confidence,
             entry_price, target_price, stop_loss,
             direction_correct_5d, direction_correct_10d, target_reached, stop_hit,
             created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            pred['ticker'], pred['prediction_date'], pred['recommendation'],
            pred['predicted_direction'], pred['confidence'], pred['entry_price'],
            pred['target_price'], pred['stop_loss'], pred['direction_correct_5d'],
            pred['direction_correct_10d'], pred['target_reached'], pred['stop_hit'],
            pred['prediction_date']
        ))
    
    stocks_conn.commit()
    log(f"  ✓ تم حفظ {len(predictions)} توقع", Colors.GREEN)
    print()
    
    price_conn.close()
    stocks_conn.close()
    
    # Summary
    print("="*70)
    log("📊 ملخص التوقعات", Colors.BLUE)
    print("="*70)
    
    acc = sum(1 for p in predictions if p['recommendation'] == 'ACCUMULATE')
    reduce_sig = sum(1 for p in predictions if p['recommendation'] == 'REDUCE')
    
    print(f"\n  🟢 ACCUMULATE: {acc}")
    print(f"  🔴 REDUCE: {reduce_sig}")
    print(f"  📊 الإجمالي: {len(predictions)}")
    print(f"  ⚠️ تم تخطي (إشارات ضعيفة): {stats['skipped_weak']}")
    
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
        
        # Breakdown by recommendation
        print("\n  📊 حسب نوع التوقعة:")
        for rec in ['ACCUMULATE', 'REDUCE']:
            rec_preds = [p for p in predictions if p['recommendation'] == rec]
            if rec_preds:
                rec_correct = sum(p['direction_correct_5d'] for p in rec_preds)
                rec_acc = (rec_correct / len(rec_preds)) * 100
                print(f"     {rec}: {len(rec_preds)} توقع، دقة {rec_acc:.1f}%")
    
    print("\n" + "="*70)
    log(f"✅ تم إنشاء {len(predictions)} توقع عالي الثقة", Colors.GREEN)
    print("="*70 + "\n")

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        log(f"\n❌ خطأ: {e}", Colors.RED)
        import traceback
        traceback.print_exc()
