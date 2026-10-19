#!/usr/bin/env python3
"""
stock_stage_analyzer.py — تحليل مرحلة السهم (Stage Analysis)

المطلوب (محسن): من البيانات التاريخية + الـ live data، نـمسح السهم عشان نعرف موقفه:
  - هل هو في تصحيح؟
  - ولا خلص (انتهى الترند)؟
  - ولا لسه هيبدا؟
  - ولا في بداية الطلوع؟

التحليل بـ يستخدم:
  1. Trend Direction (MA20 vs MA50 vs MA200)
  2. Stage في Wyckoff cycle (4 مراحل)
  3. Momentum (RSI, MACD)
  4. Distance from peak / trough (Drawdown / Run-up)
  5. Volume analysis (تجميع vs تصريف)
  6. Support/Resistance (recent highs/lows)

الـ 8 stages الناتجة:
  - ACCUMULATION       → قاع + تجميع (السهم بني قاعدته)
  - EARLY_MARKUP       → بداية الطلوع (اخترق القاعدة)
  - MARKUP             → طلوع قوي (في ترند صاعد)
  - LATE_MARKUP        → آخر الطلوع (قرب القمة)
  - DISTRIBUTION       → قمة + توزيع (بيـوزّع)
  - EARLY_MARKDOWN     → بداية نزول (كسر القمة)
  - MARKDOWN           → نزول قوي (في ترند هابط)
  - CORRECTION         → تصحيح مؤقت في ترند صاعد

Author: BRAVO-QUANT — 2026-10-19
"""
import sys
import os
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from collections import defaultdict

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

# ═══════════════════════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════════════════════

def sma(values, period):
    """Simple Moving Average"""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def ema(values, period):
    """Exponential Moving Average"""
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    ema_val = sma(values[:period], period)
    for v in values[period:]:
        ema_val = v * k + ema_val * (1 - k)
    return ema_val


def rsi(closes, period=14):
    """Relative Strength Index"""
    if len(closes) < period + 1:
        return None
    gains = []
    losses = []
    for i in range(-period, 0):
        change = closes[i] - closes[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(closes, fast=12, slow=26, signal=9):
    """MACD line + signal line + histogram"""
    if len(closes) < slow + signal:
        return None, None, None
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = ema_fast - ema_slow
    # حساب signal line من آخر 9 قيم MACD
    macd_history = []
    for i in range(slow, len(closes) + 1):
        slice_c = closes[:i]
        if len(slice_c) >= slow:
            ef = ema(slice_c, fast)
            es = ema(slice_c, slow)
            if ef and es:
                macd_history.append(ef - es)
    if len(macd_history) >= signal:
        signal_line = sum(macd_history[-signal:]) / signal
    else:
        signal_line = macd_line
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def atr(highs, lows, closes, period=14):
    """Average True Range"""
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(-period, 0):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        trs.append(tr)
    return sum(trs) / period


def calc_stage(closes, highs, lows, volumes):
    """
    تحديد مرحلة السهم بناءً على:
    - Trend (MA20/50/200)
    - Distance from peak/trough
    - RSI + MACD
    - Volume pattern
    
    Returns:
        {
            'stage': str,          # المرحلة (8 stages)
            'stage_ar': str,       # الاسم بالعربي
            'confidence': float,   # 0-100
            'reasons': list,       # أسباب التصنيف
            'trend': str,          # UP/DOWN/SIDEWAYS
            'ma20': float,
            'ma50': float,
            'ma200': float,
            'rsi': float,
            'distance_from_peak': float,  # % (سلبي = تحت القمة)
            'distance_from_trough': float,  # % (موجب = فوق القاع)
            'vol_trend': str,      # increasing/decreasing/stable
        }
    """
    n = len(closes)
    if n < 60:
        return {
            'stage': 'INSUFFICIENT_DATA', 'stage_ar': 'بيانات غير كافية',
            'confidence': 0, 'reasons': [f'بيانات قليلة ({n} يوم)'],
            'trend': 'UNKNOWN', 'ma20': None, 'ma50': None, 'ma200': None,
            'rsi': None, 'distance_from_peak': 0, 'distance_from_trough': 0,
            'vol_trend': 'unknown',
        }
    
    current = closes[-1]
    ma20 = sma(closes, 20)
    ma50 = sma(closes, 50)
    ma200 = sma(closes, 200) if n >= 200 else None
    rsi_val = rsi(closes, 14)
    macd_line, signal_line, hist = macd(closes)
    atr_val = atr(highs, lows, closes, 14)
    
    # Distance from peak (آخر 60 يوم)
    recent_high = max(highs[-60:])
    recent_low = min(lows[-60:])
    dist_from_peak = ((current - recent_high) / recent_high * 100) if recent_high > 0 else 0
    dist_from_trough = ((current - recent_low) / recent_low * 100) if recent_low > 0 else 0
    
    # Volume trend (آخر 20 يوم vs الـ 20 يوم قبلهم)
    if len(volumes) >= 40:
        vol_recent = sum(volumes[-20:]) / 20
        vol_prev = sum(volumes[-40:-20]) / 20
        if vol_prev > 0:
            vol_ratio = vol_recent / vol_prev
            if vol_ratio > 1.2:
                vol_trend = 'increasing'
            elif vol_ratio < 0.8:
                vol_trend = 'decreasing'
            else:
                vol_trend = 'stable'
        else:
            vol_trend = 'stable'
    else:
        vol_trend = 'unknown'
    
    # Trend direction
    trend = 'SIDEWAYS'
    if ma200:
        if current > ma20 > ma50 > ma200:
            trend = 'UP'
        elif current < ma20 < ma50 < ma200:
            trend = 'DOWN'
        elif ma20 > ma50:
            trend = 'UP_WEAK'
        elif ma20 < ma50:
            trend = 'DOWN_WEAK'
    else:
        if ma20 > ma50:
            trend = 'UP_WEAK'
        elif ma20 < ma50:
            trend = 'DOWN_WEAK'
    
    # === تحديد المرحلة ===
    reasons = []
    confidence = 50
    
    # 1. ACCUMULATION: قاع + تجميع
    #    - السعر قريب من القاع (dist_from_trough < 15%)
    #    - MA20 ≈ MA50 (sideways)
    #    - RSI 40-60
    #    - Volume متزايد (تجميع)
    if (dist_from_trough < 15 and abs(ma20 - ma50) / ma50 * 100 < 3
            and rsi_val and 35 <= rsi_val <= 65 and vol_trend == 'increasing'):
        stage = 'ACCUMULATION'
        stage_ar = 'تجميع (قاع)'
        confidence = 75
        reasons = [
            f'السعر قريب من القاع ({dist_from_trough:+.1f}%)',
            f'MA20 ≈ MA50 (sideways) — فرق {abs(ma20-ma50)/ma50*100:.1f}%',
            f'RSI محايد ({rsi_val:.0f})',
            'Volume متزايد → تجميع مؤسسي',
        ]
    
    # 2. EARLY_MARKUP: بداية الطلوع
    #    - السعر اخترق MA50 للأعلى
    #    - MA20 بدأ يطلع فوق MA50
    #    - RSI > 50
    #    - MACD histogram موجب
    elif (current > ma50 and ma20 > ma50 and rsi_val and rsi_val > 50
              and hist and hist > 0 and dist_from_trough < 30):
        stage = 'EARLY_MARKUP'
        stage_ar = 'بداية الطلوع'
        confidence = 80
        reasons = [
            f'السعر فوق MA50 ({current:.2f} > {ma50:.2f})',
            f'MA20 فوق MA50 (تقاطع ذهبي)',
            f'RSI > 50 ({rsi_val:.0f})',
            f'MACD histogram موجب ({hist:.3f})',
            f'بعد القاع بـ {dist_from_trough:.1f}%',
        ]
    
    # 3. MARKUP: طلوع قوي
    #    - MA20 > MA50 > MA200 (ترند صاعد كامل)
    #    - السعر فوق MA20
    #    - RSI 55-75
    #    - Distance from trough > 20%
    elif (ma200 and current > ma20 > ma50 > ma200
              and rsi_val and 55 <= rsi_val <= 80 and dist_from_trough > 20
              and dist_from_peak > -10):
        stage = 'MARKUP'
        stage_ar = 'طلوع قوي'
        confidence = 85
        reasons = [
            f'ترند صاعد كامل: سعر > MA20 > MA50 > MA200',
            f'RSI قوي ({rsi_val:.0f})',
            f'بعد القاع بـ {dist_from_trough:.1f}%',
            f'تحت القمة بـ {abs(dist_from_peak):.1f}%',
        ]
    
    # 4. LATE_MARKUP: آخر الطلوع
    #    - السعر فوق MA20 بس قريب من القمة
    #    - RSI > 70 (overbought)
    #    - Distance from peak < 5%
    elif (dist_from_peak > -5 and rsi_val and rsi_val > 70):
        stage = 'LATE_MARKUP'
        stage_ar = 'آخر الطلوع'
        confidence = 70
        reasons = [
            f'السعر قريب من القمة ({dist_from_peak:+.1f}%)',
            f'RSI مرتفع جداً ({rsi_val:.0f}) → overbought',
            'احتمال توزيع قريب',
        ]
    
    # 5. DISTRIBUTION: قمة + توزيع
    #    - السعر عند القمة
    #    - MA20 ≈ MA50 (sideways بعد طلوع)
    #    - RSI 40-60 (ضعف)
    #    - Volume متزايد بس السعر مش بـ يطلع
    elif (abs(dist_from_peak) < 5 and abs(ma20 - ma50) / ma50 * 100 < 3
              and rsi_val and 35 <= rsi_val <= 60 and vol_trend == 'increasing'
              and dist_from_trough > 20):
        stage = 'DISTRIBUTION'
        stage_ar = 'توزيع (قمة)'
        confidence = 70
        reasons = [
            f'السعر عند القمة ({dist_from_peak:+.1f}%)',
            f'MA20 ≈ MA50 (sideways بعد طلوع)',
            f'RSI ضعيف ({rsi_val:.0f})',
            'Volume متزايد بس السعر ثابت → توزيع',
        ]
    
    # 6. EARLY_MARKDOWN: بداية نزول
    #    - السعر نزل تحت MA50
    #    - MA20 نزل تحت MA50
    #    - RSI < 50
    #    - MACD histogram سالب
    elif (current < ma50 and ma20 < ma50 and rsi_val and rsi_val < 50
              and hist and hist < 0 and dist_from_peak > -15):
        stage = 'EARLY_MARKDOWN'
        stage_ar = 'بداية نزول'
        confidence = 75
        reasons = [
            f'السعر تحت MA50 ({current:.2f} < {ma50:.2f})',
            f'MA20 تحت MA50 (تقاطع موتي)',
            f'RSI < 50 ({rsi_val:.0f})',
            f'MACD histogram سالب ({hist:.3f})',
            f'تحت القمة بـ {abs(dist_from_peak):.1f}%',
        ]
    
    # 7. MARKDOWN: نزول قوي
    #    - MA20 < MA50 < MA200 (ترند هابط كامل)
    #    - السعر تحت MA20
    #    - RSI < 35
    #    - Distance from peak > 20%
    elif (ma200 and current < ma20 < ma50 < ma200
              and rsi_val and rsi_val < 40 and dist_from_peak < -20):
        stage = 'MARKDOWN'
        stage_ar = 'نزول قوي'
        confidence = 85
        reasons = [
            f'ترند هابط كامل: سعر < MA20 < MA50 < MA200',
            f'RSI ضعيف جداً ({rsi_val:.0f})',
            f'تحت القمة بـ {abs(dist_from_peak):.1f}%',
            'السهم في نزول مستمر',
        ]
    
    # 8. CORRECTION: تصحيح مؤقت في ترند صاعد
    #    - الـ MA200 تحت (الترند الصاعد لسة شغال)
    #    - السعر نزل تحت MA20 أو MA50 (تصحيح)
    #    - RSI 30-50 (ضعف مؤقت)
    #    - Distance from peak -5% لـ -15%
    elif (ma200 and current > ma200 and ma50 > ma200
              and dist_from_peak > -20 and dist_from_peak < -5
              and rsi_val and 30 <= rsi_val <= 55):
        stage = 'CORRECTION'
        stage_ar = 'تصحيح (في ترند صاعد)'
        confidence = 70
        reasons = [
            f'الترند الصاعد لسة شغال (MA50 > MA200)',
            f'السعر نزل تحت القمة بـ {abs(dist_from_peak):.1f}%',
            f'RSI ضعيف مؤقت ({rsi_val:.0f})',
            'تصحيح طبيعي في ترند صاعد',
        ]
    
    # Fallback: لو مفيش stage واضح
    else:
        if trend in ('UP', 'UP_WEAK'):
            stage = 'EARLY_MARKUP'
            stage_ar = 'بداية طلوع (ضعيف)'
            confidence = 50
            reasons = [f'ترند صاعد ضعيف (MA20 > MA50)', f'RSI = {rsi_val:.0f}' if rsi_val else 'RSI N/A']
        elif trend in ('DOWN', 'DOWN_WEAK'):
            stage = 'EARLY_MARKDOWN'
            stage_ar = 'بداية نزول (ضعيف)'
            confidence = 50
            reasons = [f'ترند هابط ضعيف (MA20 < MA50)', f'RSI = {rsi_val:.0f}' if rsi_val else 'RSI N/A']
        else:
            stage = 'SIDEWAYS'
            stage_ar = 'عرضي'
            confidence = 40
            reasons = ['السهم يتحرك عرضياً', f'RSI = {rsi_val:.0f}' if rsi_val else 'RSI N/A']
    
    return {
        'stage': stage,
        'stage_ar': stage_ar,
        'confidence': confidence,
        'reasons': reasons,
        'trend': trend,
        'ma20': ma20,
        'ma50': ma50,
        'ma200': ma200,
        'rsi': rsi_val,
        'macd_hist': hist,
        'atr': atr_val,
        'distance_from_peak': dist_from_peak,
        'distance_from_trough': dist_from_trough,
        'vol_trend': vol_trend,
        'current_price': current,
    }


# ═══════════════════════════════════════════════════════════════════════
# Main scan function
# ═══════════════════════════════════════════════════════════════════════

def scan_all_stocks(market='EGX', min_days=200, top_n=50):
    """امسح كل الأسهم وحدد مرحلة كل واحد"""
    
    ph_db = DB_DIR / 'price_history.db'
    if not ph_db.exists():
        print(f'❌ price_history.db not found: {ph_db}')
        return []
    
    conn = sqlite3.connect(str(ph_db))
    conn.row_factory = sqlite3.Row
    
    # Get all tickers with enough data
    tickers = conn.execute("""
        SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
        FROM price_history
        GROUP BY ticker
        HAVING cnt >= ?
        ORDER BY ticker
    """, (min_days,)).fetchall()
    
    print(f'📊 Found {len(tickers)} tickers with >= {min_days} days')
    
    results = []
    for i, t in enumerate(tickers):
        if i % 100 == 0:
            print(f'  Scanning {i+1}/{len(tickers)}...', flush=True)
        
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            ORDER BY date
        """, (t['ticker'],)).fetchall()
        
        if len(rows) < min_days:
            continue
        
        closes = [r['close_price'] for r in rows if r['close_price'] and r['close_price'] > 0]
        highs = [r['high_price'] for r in rows if r['high_price'] and r['high_price'] > 0]
        lows = [r['low_price'] for r in rows if r['low_price'] and r['low_price'] > 0]
        volumes = [r['volume'] or 0 for r in rows]
        
        if len(closes) < min_days:
            continue
        
        analysis = calc_stage(closes, highs, lows, volumes)
        analysis['ticker'] = t['ticker']
        analysis['last_date'] = t['last_date']
        analysis['days_count'] = len(closes)
        results.append(analysis)
    
    conn.close()
    
    # ترتيب بـ confidence
    results.sort(key=lambda x: (-x['confidence'], x['ticker']))
    return results


def print_summary(results, top_n=20):
    """اطبع ملخص النتائج"""
    print(f"\n{'='*100}")
    print(f"  🎯 STOCK STAGE ANALYSIS — {len(results)} stocks scanned")
    print(f"{'='*100}")
    
    # تجميع حسب المرحلة
    by_stage = defaultdict(list)
    for r in results:
        by_stage[r['stage']].append(r)
    
    # طباعة الإحصائيات
    print(f"\n📊 Distribution by Stage:")
    print(f"  {'Stage':25s} | {'Stage (AR)':25s} | {'Count':>6} | {'%':>5}")
    print(f"  {'-'*70}")
    for stage in ['ACCUMULATION', 'EARLY_MARKUP', 'MARKUP', 'LATE_MARKUP',
                   'DISTRIBUTION', 'EARLY_MARKDOWN', 'MARKDOWN', 'CORRECTION', 'SIDEWAYS']:
        if stage in by_stage:
            count = len(by_stage[stage])
            pct = count / len(results) * 100
            stage_ar = by_stage[stage][0]['stage_ar']
            print(f"  {stage:25s} | {stage_ar:25s} | {count:>6} | {pct:>4.1f}%")
    
    # طباعة top N لكل مرحلة مهمة
    important_stages = [
        ('ACCUMULATION', '🔥 فرص التجميع (قاع + تجميع مؤسسي)'),
        ('EARLY_MARKUP', '🚀 بداية الطلوع (فرص شراء مبكرة)'),
        ('CORRECTION', '⚠️ تصحيح في ترند صاعد (فرص شراء على التصحيح)'),
        ('DISTRIBUTION', '🔴 توزيع (قمة + توزيع — تجنب/بيع)'),
        ('MARKDOWN', '❌ نزول قوي (تجنب)'),
    ]
    
    for stage, title in important_stages:
        if stage not in by_stage:
            continue
        print(f"\n  {title}:")
        print(f"  {'Ticker':10s} | {'Price':>10s} | {'Conf%':>5s} | {'RSI':>5s} | {'Dist Peak':>10s} | {'Dist Trough':>12s} | {'Trend':>10s}")
        print(f"  {'-'*90}")
        for r in by_stage[stage][:top_n]:
            print(f"  {r['ticker']:10s} | {r['current_price']:>10.2f} | {r['confidence']:>4.0f}% | {r['rsi'] or 0:>4.0f} | {r['distance_from_peak']:>+9.1f}% | {r['distance_from_trough']:>+11.1f}% | {r['trend']:>10s}")
            for reason in r['reasons'][:2]:
                print(f"  {'':10s}   └─ {reason}")
    
    print(f"\n{'='*100}")


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Stock Stage Analyzer')
    parser.add_argument('--market', default='EGX', help='Market (EGX, TADAWUL, etc.)')
    parser.add_argument('--min-days', type=int, default=200, help='Minimum days of data')
    parser.add_argument('--top-n', type=int, default=20, help='Top N stocks per stage to print')
    parser.add_argument('--ticker', help='Analyze single ticker (debug)')
    parser.add_argument('--json', action='store_true', help='Output JSON')
    args = parser.parse_args()
    
    if args.ticker:
        # Single ticker analysis
        ph_db = DB_DIR / 'price_history.db'
        conn = sqlite3.connect(str(ph_db))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker = ? ORDER BY date
        """, (args.ticker,)).fetchall()
        conn.close()
        
        if not rows:
            print(f'❌ No data for {args.ticker}')
            sys.exit(1)
        
        closes = [r['close_price'] for r in rows if r['close_price'] and r['close_price'] > 0]
        highs = [r['high_price'] for r in rows if r['high_price'] and r['high_price'] > 0]
        lows = [r['low_price'] for r in rows if r['low_price'] and r['low_price'] > 0]
        volumes = [r['volume'] or 0 for r in rows]
        
        analysis = calc_stage(closes, highs, lows, volumes)
        analysis['ticker'] = args.ticker
        analysis['last_date'] = rows[-1]['date']
        analysis['days_count'] = len(closes)
        
        print(f"\n{'='*80}")
        print(f"  📊 {args.ticker} — Stage Analysis")
        print(f"{'='*80}")
        print(f"\n  المرحلة: {analysis['stage']} ({analysis['stage_ar']})")
        print(f"  Confidence: {analysis['confidence']}%")
        print(f"  السعر الحالي: {analysis['current_price']:.2f}")
        print(f"  آخر date: {analysis['last_date']}")
        print(f"  Trend: {analysis['trend']}")
        print(f"\n  المؤشرات:")
        print(f"    MA20: {analysis['ma20']:.2f}" if analysis['ma20'] else "    MA20: N/A")
        print(f"    MA50: {analysis['ma50']:.2f}" if analysis['ma50'] else "    MA50: N/A")
        print(f"    MA200: {analysis['ma200']:.2f}" if analysis['ma200'] else "    MA200: N/A")
        print(f"    RSI(14): {analysis['rsi']:.1f}" if analysis['rsi'] else "    RSI: N/A")
        print(f"    MACD hist: {analysis['macd_hist']:.4f}" if analysis['macd_hist'] else "    MACD: N/A")
        print(f"    ATR(14): {analysis['atr']:.2f}" if analysis['atr'] else "    ATR: N/A")
        print(f"    Distance from peak: {analysis['distance_from_peak']:+.1f}%")
        print(f"    Distance from trough: {analysis['distance_from_trough']:+.1f}%")
        print(f"    Volume trend: {analysis['vol_trend']}")
        print(f"\n  الأسباب:")
        for reason in analysis['reasons']:
            print(f"    ✓ {reason}")
        print(f"\n{'='*80}")
    else:
        # Full scan
        results = scan_all_stocks(market=args.market, min_days=args.min_days, top_n=args.top_n)
        
        if args.json:
            output_path = PROJECT / 'vps-service' / 'backtest_results' / f'stock_stage_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
            output_path.parent.mkdir(exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump({
                    'generated_at': datetime.now().isoformat(),
                    'market': args.market,
                    'total_scanned': len(results),
                    'results': results,
                }, f, indent=2, ensure_ascii=False, default=str)
            print(f"\n💾 JSON saved: {output_path}")
        
        print_summary(results, top_n=args.top_n)
