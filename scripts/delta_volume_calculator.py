#!/usr/bin/env python3
"""
Delta Volume Calculator — حجم الشراء vs حجم البيع
===================================================
يحسب delta_volume من بيانات OHLCV (الشموع) ويخزنها:

1. BACKFILL: يحسب بأثر رجعي لكل البيانات التاريخية في egksco_price_history
   - buy_volume = total_volume × (close - low) / (high - low)
   - sell_volume = total_volume - buy_volume
   - delta_volume = buy_volume - sell_volume
   - delta_pct = (delta_volume / total_volume) × 100

2. LIVE: يحسب للبيانات اللحظية (intraday.db.stock_intraday) كل 5 دقائق

الـ destination: data_engine.db.egksco_price_history (أعمدة جديدة)
                intraday.db.stock_intraday (أعمدة جديدة)
                + جدول جديد: delta_volume_history (ملخص يومي)

Rule 29 (UNIFIED-SYSTEM): كل البيانات في db/ الموحد.
"""
import os, sys, sqlite3, json
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT / 'news-agent' / 'config'))
from paths import DATA_ENGINE_DB, INTRADAY_DB

# ============================================================
# SCHEMA SETUP
# ============================================================

def ensure_daily_delta_columns():
    """إضافة أعمدة delta_volume لـ egksco_price_history."""
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    
    cols = [r[1] for r in conn.execute('PRAGMA table_info(egksco_price_history)').fetchall()]
    
    if 'buy_volume' not in cols:
        conn.execute('ALTER TABLE egksco_price_history ADD COLUMN buy_volume INTEGER')
        print('  + Added buy_volume column')
    if 'sell_volume' not in cols:
        conn.execute('ALTER TABLE egksco_price_history ADD COLUMN sell_volume INTEGER')
        print('  + Added sell_volume column')
    if 'delta_volume' not in cols:
        conn.execute('ALTER TABLE egksco_price_history ADD COLUMN delta_volume INTEGER')
        print('  + Added delta_volume column')
    if 'delta_pct' not in cols:
        conn.execute('ALTER TABLE egksco_price_history ADD COLUMN delta_pct REAL')
        print('  + Added delta_pct column')
    if 'pressure' not in cols:
        conn.execute('ALTER TABLE egksco_price_history ADD COLUMN pressure TEXT')
        print('  + Added pressure column')
    
    conn.commit()
    conn.close()

def ensure_intraday_delta_columns():
    """إضافة أعمدة delta_volume لـ stock_intraday."""
    conn = sqlite3.connect(INTRADAY_DB, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    
    cols = [r[1] for r in conn.execute('PRAGMA table_info(stock_intraday)').fetchall()]
    
    if 'buy_volume' not in cols:
        conn.execute('ALTER TABLE stock_intraday ADD COLUMN buy_volume INTEGER')
        print('  + Added buy_volume to stock_intraday')
    if 'sell_volume' not in cols:
        conn.execute('ALTER TABLE stock_intraday ADD COLUMN sell_volume INTEGER')
        print('  + Added sell_volume to stock_intraday')
    if 'delta_volume' not in cols:
        conn.execute('ALTER TABLE stock_intraday ADD COLUMN delta_volume INTEGER')
        print('  + Added delta_volume to stock_intraday')
    if 'delta_pct' not in cols:
        conn.execute('ALTER TABLE stock_intraday ADD COLUMN delta_pct REAL')
        print('  + Added delta_pct to stock_intraday')
    if 'pressure' not in cols:
        conn.execute('ALTER TABLE stock_intraday ADD COLUMN pressure TEXT')
        print('  + Added pressure to stock_intraday')
    
    conn.commit()
    conn.close()

# ============================================================
# DELTA VOLUME CALCULATION
# ============================================================

def calc_delta_volume(open_p, high, low, close, volume):
    """
    حساب delta_volume من شمعة OHLCV.
    
    المنطق:
    - لو close قريبة من high → أغلب التداول شراء (buy_volume عالي)
    - لو close قريبة من low → أغلب التداول بيع (sell_volume عالي)
    - buy_ratio = (close - low) / (high - low)
    - buy_volume = volume × buy_ratio
    - sell_volume = volume - buy_volume
    - delta = buy - sell
    
    Returns: (buy_vol, sell_vol, delta_vol, delta_pct, pressure)
    """
    if not volume or volume <= 0:
        return (0, 0, 0, 0.0, 'NEUTRAL')
    
    if not high or not low or high == low:
        # لا يوجد نطاق سعري → 50/50
        buy_vol = volume // 2
        sell_vol = volume - buy_vol
        return (buy_vol, sell_vol, 0, 0.0, 'NEUTRAL')
    
    # buy_ratio: 0 = كله بيع (close=low), 1 = كله شراء (close=high)
    buy_ratio = (close - low) / (high - low) if high > low else 0.5
    buy_ratio = max(0.0, min(1.0, buy_ratio))
    
    buy_vol = int(volume * buy_ratio)
    sell_vol = volume - buy_vol
    delta_vol = buy_vol - sell_vol
    delta_pct = (delta_vol / volume) * 100 if volume > 0 else 0.0
    
    # Classification
    if delta_pct > 30:
        pressure = 'STRONG_BUY'
    elif delta_pct > 10:
        pressure = 'BUY'
    elif delta_pct > -10:
        pressure = 'NEUTRAL'
    elif delta_pct > -30:
        pressure = 'SELL'
    else:
        pressure = 'STRONG_SELL'
    
    return (buy_vol, sell_vol, delta_vol, round(delta_pct, 2), pressure)

# ============================================================
# BACKFILL: Daily data (egksco_price_history)
# ============================================================

def backfill_daily_delta():
    """حساب delta_volume بأثر رجعي لكل البيانات التاريخية."""
    print('\n[BACKFILL] Daily delta_volume for egksco_price_history...')
    
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=30)
    conn.execute('PRAGMA busy_timeout = 30000')
    
    # Get rows where delta_volume IS NULL (not yet calculated)
    rows = conn.execute('''
        SELECT id, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE volume > 0 AND delta_volume IS NULL
        ORDER BY id
        LIMIT 50000
    ''').fetchall()
    
    total = len(rows)
    print(f'  Rows to process: {total}')
    
    if total == 0:
        print('  All rows already have delta_volume!')
        conn.close()
        return 0
    
    updated = 0
    batch = []
    for row in rows:
        row_id, o, h, l, c, v = row
        if not c or not v:
            continue
        buy, sell, delta, pct, pressure = calc_delta_volume(o, h, l, c, v)
        batch.append((buy, sell, delta, pct, pressure, row_id))
        updated += 1
        
        if len(batch) >= 5000:
            conn.executemany('''
                UPDATE egksco_price_history
                SET buy_volume=?, sell_volume=?, delta_volume=?, delta_pct=?, pressure=?
                WHERE id=?
            ''', batch)
            conn.commit()
            print(f'  Progress: {updated}/{total} ({updated*100//total}%)')
            batch = []
    
    if batch:
        conn.executemany('''
            UPDATE egksco_price_history
            SET buy_volume=?, sell_volume=?, delta_volume=?, delta_pct=?, pressure=?
            WHERE id=?
        ''', batch)
        conn.commit()
    
    print(f'  ✓ Updated {updated} rows')
    conn.close()
    return updated

# ============================================================
# LIVE: Intraday data (stock_intraday)
# ============================================================

def update_intraday_delta():
    """تحديث delta_volume للبيانات اللحظية (آخر 5 دقائق)."""
    print('\n[LIVE] Updating intraday delta_volume...')
    
    conn = sqlite3.connect(INTRADAY_DB, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    
    # Get recent rows without delta_volume
    rows = conn.execute('''
        SELECT id, open, high, low, price, volume
        FROM stock_intraday
        WHERE volume > 0 AND delta_volume IS NULL
        ORDER BY id DESC
        LIMIT 10000
    ''').fetchall()
    
    total = len(rows)
    print(f'  Rows to process: {total}')
    
    if total == 0:
        conn.close()
        return 0
    
    updated = 0
    batch = []
    for row in rows:
        row_id, o, h, l, price, v = row
        if not price or not v:
            continue
        # Use price as close (intraday = current price)
        buy, sell, delta, pct, pressure = calc_delta_volume(o or price, h or price, l or price, price, v)
        batch.append((buy, sell, delta, pct, pressure, row_id))
        updated += 1
        
        if len(batch) >= 2000:
            conn.executemany('''
                UPDATE stock_intraday
                SET buy_volume=?, sell_volume=?, delta_volume=?, delta_pct=?, pressure=?
                WHERE id=?
            ''', batch)
            conn.commit()
            batch = []
    
    if batch:
        conn.executemany('''
            UPDATE stock_intraday
            SET buy_volume=?, sell_volume=?, delta_volume=?, delta_pct=?, pressure=?
            WHERE id=?
        ''', batch)
        conn.commit()
    
    print(f'  ✓ Updated {updated} rows')
    conn.close()
    return updated

# ============================================================
# SUMMARY: Get latest delta for a ticker
# ============================================================

def get_latest_delta(ticker):
    """جلب آخر delta_volume لسهم معين."""
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=5)
    row = conn.execute('''
        SELECT symbol, price_date, volume, buy_volume, sell_volume,
               delta_volume, delta_pct, pressure
        FROM egksco_price_history
        WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
        ORDER BY price_date DESC LIMIT 1
    ''', (ticker,)).fetchone()
    conn.close()
    
    if not row:
        return None
    
    return {
        'ticker': row[0],
        'date': row[1],
        'total_volume': row[2],
        'buy_volume': row[3],
        'sell_volume': row[4],
        'delta_volume': row[5],
        'delta_pct': row[6],
        'pressure': row[7],
    }

def get_delta_history(ticker, days=30):
    """جلب تاريخ delta_volume لسهم معين."""
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=5)
    rows = conn.execute('''
        SELECT price_date, volume, buy_volume, sell_volume,
               delta_volume, delta_pct, pressure, close_price
        FROM egksco_price_history
        WHERE symbol = ? AND volume > 0 AND delta_volume IS NOT NULL
        ORDER BY price_date DESC LIMIT ?
    ''', (ticker, days)).fetchall()
    conn.close()
    
    return [{
        'date': r[0], 'volume': r[1], 'buy_volume': r[2], 'sell_volume': r[3],
        'delta_volume': r[4], 'delta_pct': r[5], 'pressure': r[6], 'close': r[7],
    } for r in rows]

# ============================================================
# MAIN
# ============================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Delta Volume Calculator')
    parser.add_argument('--backfill', action='store_true', help='Backfill all historical data')
    parser.add_argument('--live', action='store_true', help='Update intraday data')
    parser.add_argument('--ticker', type=str, help='Show delta for specific ticker')
    parser.add_argument('--history', type=str, help='Show delta history for ticker')
    parser.add_argument('--days', type=int, default=30, help='Days of history')
    args = parser.parse_args()
    
    # Always ensure columns exist
    print('=== Setting up columns ===')
    ensure_daily_delta_columns()
    ensure_intraday_delta_columns()
    
    if args.backfill:
        backfill_daily_delta()
    
    if args.live:
        update_intraday_delta()
    
    if args.ticker:
        delta = get_latest_delta(args.ticker)
        if delta:
            print(f'\n=== {args.ticker} Latest Delta ===')
            print(f'  Date: {delta["date"]}')
            print(f'  Total Volume: {delta["total_volume"]:,}')
            print(f'  Buy Volume: {delta["buy_volume"]:,}')
            print(f'  Sell Volume: {delta["sell_volume"]:,}')
            print(f'  Delta: {delta["delta_volume"]:,} ({delta["delta_pct"]:+.1f}%)')
            print(f'  Pressure: {delta["pressure"]}')
        else:
            print(f'  No delta data for {args.ticker}')
    
    if args.history:
        history = get_delta_history(args.history, args.days)
        if history:
            print(f'\n=== {args.history} Delta History ({len(history)} days) ===')
            print(f'{"Date":<12} {"Volume":>10} {"Buy":>10} {"Sell":>10} {"Delta":>10} {"Delta%":>8} {"Pressure":<12} {"Close":>8}')
            print('-' * 90)
            for h in history:
                print(f'{h["date"]:<12} {h["volume"]:>10,} {h["buy_volume"]:>10,} {h["sell_volume"]:>10,} {h["delta_volume"]:>+10,} {h["delta_pct"]:>+8.1f} {h["pressure"]:<12} {h["close"]:>8.2f}')
        else:
            print(f'  No history for {args.history}')
    
    if not args.backfill and not args.live and not args.ticker and not args.history:
        print('\nUsage:')
        print('  python3 delta_volume_calculator.py --backfill          # Backfill all historical data')
        print('  python3 delta_volume_calculator.py --live             # Update intraday data')
        print('  python3 delta_volume_calculator.py --ticker COMI      # Show latest delta for COMI')
        print('  python3 delta_volume_calculator.py --history COMI     # Show 30-day delta history')
        print('  python3 delta_volume_calculator.py --history COMI --days 7  # 7-day history')

if __name__ == '__main__':
    main()
