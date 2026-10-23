#!/usr/bin/env python3
"""
Intraday Data Reader — قارئ البيانات اللحظية
=================================================
يقرأ بيانات 5 دقايق من intraday.db عشان:
  1. كشف breakouts خلال الجلسة (مش بس يومي)
  2. كشف volume spikes اللحظية
  3. كشف maker flow (سيولة بتدخل/تخرج)

intraday.db فيه 266K صف، 971 سهم، بيانات كل 5 دقايق.

Author: Z.ai Code
Date: 2026-09-01
"""

import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INTRADAY_DB = PROJECT_ROOT / 'db' / 'intraday.db'


def get_intraday_data(ticker: str, hours: int = 2) -> Dict[str, List]:
    """
    جيب بيانات intraday لسهم (آخر N ساعة من أحدث بيانات متاحة).
    
    Returns:
        {
            'timestamps': List[str],
            'prices': List[float],
            'volumes': List[float],
            'highs': List[float],
            'lows': List[float],
        }
    """
    if not INTRADAY_DB.exists():
        return {'timestamps': [], 'prices': [], 'volumes': [], 'highs': [], 'lows': []}
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(INTRADAY_DB), writable=False).__enter__()
        # Get latest timestamp for this ticker, then look back N hours from there
        latest_row = conn.execute('''
            SELECT MAX(timestamp) FROM stock_intraday WHERE ticker = ?
        ''', (ticker,)).fetchone()
        
        if not latest_row or not latest_row[0]:
            conn.close()
            return {'timestamps': [], 'prices': [], 'volumes': [], 'highs': [], 'lows': []}
        
        latest_ts = latest_row[0]
        # Parse and subtract hours
        try:
            latest_dt = datetime.fromisoformat(latest_ts.replace('Z', ''))
            cutoff_dt = latest_dt - timedelta(hours=hours)
            cutoff = cutoff_dt.strftime('%Y-%m-%dT%H:%M')
        except Exception:
            cutoff = (datetime.now() - timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M')
        
        rows = conn.execute('''
            SELECT timestamp, price, volume, high, low
            FROM stock_intraday
            WHERE ticker = ? AND timestamp >= ? AND price IS NOT NULL AND price > 0
            ORDER BY timestamp ASC
        ''', (ticker, cutoff)).fetchall()
        conn.close()
        
        if not rows:
            return {'timestamps': [], 'prices': [], 'volumes': [], 'highs': [], 'lows': []}
        
        return {
            'timestamps': [r[0] for r in rows],
            'prices': [float(r[1] or 0) for r in rows],
            'volumes': [float(r[2] or 0) for r in rows],
            'highs': [float(r[3] or 0) for r in rows],
            'lows': [float(r[4] or 0) for r in rows],
        }
    except Exception:
        return {'timestamps': [], 'prices': [], 'volumes': [], 'highs': [], 'lows': []}


def detect_intraday_breakout(ticker: str, lookback_bars: int = 24) -> Dict[str, Any]:
    """
    كشف intraday breakout — السعر كسر قمة آخر N شمعة بحجم.
    
    Returns:
        {
            'is_breakout': bool,
            'breakout_strength_pct': float,
            'volume_ratio': float,
            'current_price': float,
            'resistance_broken': float,
        }
    """
    data = get_intraday_data(ticker, hours=4)
    prices = data['prices']
    volumes = data['volumes']
    highs = data['highs']
    
    if len(prices) < lookback_bars + 1:
        return {'is_breakout': False, 'breakout_strength_pct': 0, 
                'volume_ratio': 0, 'current_price': 0, 'resistance_broken': 0}
    
    # Resistance = highest high in lookback (excluding last bar)
    resistance = max(highs[-lookback_bars-1:-1]) if len(highs) > lookback_bars else 0
    current_price = prices[-1]
    current_vol = volumes[-1]
    
    # Volume ratio vs average
    avg_vol = sum(volumes[-lookback_bars:-1]) / lookback_bars if lookback_bars > 0 else 1
    vol_ratio = current_vol / avg_vol if avg_vol > 0 else 0
    
    if resistance <= 0:
        return {'is_breakout': False, 'breakout_strength_pct': 0,
                'volume_ratio': round(vol_ratio, 2), 'current_price': current_price, 
                'resistance_broken': 0}
    
    is_breakout = current_price > resistance and vol_ratio > 1.5
    strength = ((current_price - resistance) / resistance * 100) if resistance > 0 else 0
    
    return {
        'is_breakout': is_breakout,
        'breakout_strength_pct': round(strength, 2),
        'volume_ratio': round(vol_ratio, 2),
        'current_price': current_price,
        'resistance_broken': resistance,
    }


def detect_maker_flow(ticker: str, lookback_bars: int = 12) -> Dict[str, Any]:
    """
    كشف تدفق السيولة المؤسسية (Maker Flow).
    
    بـ يحلل آخر N شمعة 5 دقايق:
      - لو السعر بـ يطلع + حجم بـ يزيد → "buying" (مؤسسات بتدخل)
      - لو السعر بـ ينزل + حجم بـ يزيد → "selling" (مؤسسات بتخرج)
      - لو السعر بـ يطلع + حجم بـ ينقص → "weak" (مضاربة)
    
    Returns:
        {
            'flow': 'buying'|'selling'|'weak'|'neutral',
            'price_trend_pct': float,
            'volume_trend_pct': float,
            'confidence': int (0-100),
        }
    """
    data = get_intraday_data(ticker, hours=2)
    prices = data['prices']
    volumes = data['volumes']
    
    if len(prices) < lookback_bars:
        return {'flow': 'neutral', 'price_trend_pct': 0, 'volume_trend_pct': 0, 'confidence': 0}
    
    # Last N bars
    recent_prices = prices[-lookback_bars:]
    recent_volumes = volumes[-lookback_bars:]
    
    # Price trend (first half vs second half)
    mid = lookback_bars // 2
    first_price_avg = sum(recent_prices[:mid]) / mid if mid > 0 else recent_prices[0]
    second_price_avg = sum(recent_prices[mid:]) / (lookback_bars - mid) if (lookback_bars - mid) > 0 else recent_prices[-1]
    
    first_vol_avg = sum(recent_volumes[:mid]) / mid if mid > 0 else recent_volumes[0]
    second_vol_avg = sum(recent_volumes[mid:]) / (lookback_bars - mid) if (lookback_bars - mid) > 0 else recent_volumes[-1]
    
    if first_price_avg <= 0 or first_vol_avg <= 0:
        return {'flow': 'neutral', 'price_trend_pct': 0, 'volume_trend_pct': 0, 'confidence': 0}
    
    price_trend = ((second_price_avg - first_price_avg) / first_price_avg) * 100
    volume_trend = ((second_vol_avg - first_vol_avg) / first_vol_avg) * 100
    
    # Determine flow
    price_up = price_trend > 0.2
    price_down = price_trend < -0.2
    vol_up = volume_trend > 20  # 20% increase
    
    if price_up and vol_up:
        flow = 'buying'
        confidence = min(100, 50 + int(abs(price_trend) * 10) + int(abs(volume_trend) / 2))
    elif price_down and vol_up:
        flow = 'selling'
        confidence = min(100, 50 + int(abs(price_trend) * 10) + int(abs(volume_trend) / 2))
    elif price_up and not vol_up:
        flow = 'weak'  # price up but no volume = weak
        confidence = 20
    else:
        flow = 'neutral'
        confidence = 10
    
    return {
        'flow': flow,
        'price_trend_pct': round(price_trend, 3),
        'volume_trend_pct': round(volume_trend, 2),
        'confidence': confidence,
    }


def get_sector_performance(sector: str, days: int = 5) -> Dict[str, Any]:
    """
    حساب أداء قطاع معين من stocks.db.
    
    Returns:
        {
            'sector': str,
            'avg_change': float,
            'advancers': int,
            'decliners': int,
            'heat': 'hot'|'warm'|'cold',
        }
    """
    stocks_db = PROJECT_ROOT / 'db' / 'stocks.db'
    if not stocks_db.exists():
        return {'sector': sector, 'avg_change': 0, 'advancers': 0, 'decliners': 0, 'heat': 'cold'}
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(stocks_db), writable=False).__enter__()
        rows = conn.execute('''
            SELECT ticker, change_percent, current_price, volume
            FROM stocks
            WHERE sector LIKE ? AND is_active = 1 AND change_percent IS NOT NULL
        ''', (f'%{sector}%',)).fetchall()
        conn.close()
        
        if not rows:
            return {'sector': sector, 'avg_change': 0, 'advancers': 0, 'decliners': 0, 'heat': 'cold'}
        
        changes = [float(r[1] or 0) for r in rows]
        avg_change = sum(changes) / len(changes)
        advancers = sum(1 for c in changes if c > 0)
        decliners = sum(1 for c in changes if c < 0)
        
        if avg_change > 1.5:
            heat = 'hot'
        elif avg_change > 0.3:
            heat = 'warm'
        else:
            heat = 'cold'
        
        return {
            'sector': sector,
            'avg_change': round(avg_change, 2),
            'advancers': advancers,
            'decliners': decliners,
            'total': len(rows),
            'heat': heat,
        }
    except Exception:
        return {'sector': sector, 'avg_change': 0, 'advancers': 0, 'decliners': 0, 'heat': 'cold'}


# Self-test
if __name__ == '__main__':
    print("🧪 Intraday Data Reader — Self Test")
    print("=" * 60)
    
    # Test 1: Get intraday data
    print("\n=== Test 1: COMI intraday data ===")
    data = get_intraday_data('COMI', hours=2)
    print(f"  Bars: {len(data['prices'])}")
    if data['prices']:
        print(f"  Last price: {data['prices'][-1]}")
        print(f"  Last timestamp: {data['timestamps'][-1]}")
    
    # Test 2: Detect breakout
    print("\n=== Test 2: COMI intraday breakout ===")
    brk = detect_intraday_breakout('COMI')
    print(f"  Is breakout: {brk['is_breakout']}")
    print(f"  Volume ratio: {brk['volume_ratio']}")
    print(f"  Current price: {brk['current_price']}")
    
    # Test 3: Maker flow
    print("\n=== Test 3: COMI maker flow ===")
    flow = detect_maker_flow('COMI')
    print(f"  Flow: {flow['flow']}")
    print(f"  Price trend: {flow['price_trend_pct']}%")
    print(f"  Volume trend: {flow['volume_trend_pct']}%")
    print(f"  Confidence: {flow['confidence']}")
    
    # Test 4: Sector performance
    print("\n=== Test 4: Finance sector performance ===")
    perf = get_sector_performance('Finance')
    print(f"  Avg change: {perf['avg_change']}%")
    print(f"  Advancers: {perf['advancers']} | Decliners: {perf['decliners']}")
    print(f"  Heat: {perf['heat']}")
    
    print("\n✅ Intraday Data Reader ready")
