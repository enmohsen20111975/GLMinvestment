#!/usr/bin/env python3
"""
smart_recalc.py — Smart Selective Recalculation of support/resistance
=====================================================================
Task OWNER-DIRECTIVE: تحديث ذكي لـ support/resistance بدون ضغط على الموارد.

المبدأ: "لا تحسب كل حاجة — احسب بس اللي اتغير"

3 طبقات:
1. Validation Guard: لو support > price → NULL (فوري، 0% CPU)
2. Smart Detection: لو السعر اتغير > 2% → احسب لهذا السهم فقط
3. Rolling Update: 50 سهم/ساعة (بدل 1205 مرة واحدة)

Usage:
  python3 smart_recalc.py                    # Validation + Smart Detection
  python3 smart_recalc.py --rolling 50        # Rolling: 50 stocks this hour
  python3 smart_recalc.py --ticker COMI       # Single stock recalc
"""
import sqlite3, os, sys, time, argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / "db" / "stocks.db"
PRICE_CHANGE_THRESHOLD = 2.0  # % — if price changed > 2% since last S/R calc → recalc
ROLLING_BATCH = 50  # stocks per hour

def validation_guard():
    """Layer 1: تصفير قيم support/resistance غير منطقية (0% CPU)"""
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    
    # support > price → NULL
    cur.execute("UPDATE stocks SET support = NULL WHERE support > 0 AND current_price > 0 AND support > current_price")
    sup_fixed = cur.rowcount
    
    # resistance < price → NULL
    cur.execute("UPDATE stocks SET resistance = NULL WHERE resistance > 0 AND current_price > 0 AND resistance < current_price")
    res_fixed = cur.rowcount
    
    conn.commit()
    conn.close()
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Layer 1 (Validation Guard): {sup_fixed} support + {res_fixed} resistance → NULL")
    return sup_fixed + res_fixed

def smart_detection():
    """Layer 2: كشف الأسهم اللي سعرها اتغير > 2% منذ آخر حساب S/R"""
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    
    # Compare current_price vs last close (stored in previous_close or high_52w/low_52w)
    # If price moved > 2% and support/resistance exist → mark for recalc
    cur.execute("""
        SELECT ticker, current_price, support, resistance, previous_close, 
               change_percent, market
        FROM stocks 
        WHERE current_price > 0 
        AND (support IS NOT NULL OR resistance IS NOT NULL)
        AND ABS(COALESCE(change_percent, 0)) > ?
    """, (PRICE_CHANGE_THRESHOLD,))
    
    tickers_to_recalc = [row[0] for row in cur.fetchall()]
    conn.close()
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Layer 2 (Smart Detection): {len(tickers_to_recalc)} stocks moved > {PRICE_CHANGE_THRESHOLD}% → recalc needed")
    return tickers_to_recalc

def rolling_update(batch_size=ROLLING_BATCH):
    """Layer 3: تحديث تدريجي — batch_size سهم فقط هذا التشغيل"""
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    
    # Pick stocks that haven't been updated longest (oldest updated_at)
    cur.execute("""
        SELECT ticker FROM stocks 
        WHERE current_price > 0 
        ORDER BY COALESCE(updated_at, '2000-01-01') ASC 
        LIMIT ?
    """, (batch_size,))
    
    tickers = [row[0] for row in cur.fetchall()]
    conn.close()
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Layer 3 (Rolling Update): {len(tickers)} stocks this batch")
    return tickers

def recalc_single(ticker):
    """إعادة حساب سهم واحد"""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
        from analyzers.support_resistance_calculator import calculate_support_resistance
        sr = calculate_support_resistance(ticker)
        if sr and sr.get('is_fresh'):
            conn = sqlite3.connect(str(DB_PATH))
            cur = conn.cursor()
            cur.execute("""
                UPDATE stocks SET 
                    support = ?, resistance = ?, 
                    rsi = ?, updated_at = ?
                WHERE ticker = ?
            """, (
                sr.get('support'), sr.get('resistance'),
                sr.get('rsi'), datetime.now().isoformat(),
                ticker
            ))
            conn.commit()
            conn.close()
            return True
    except Exception as e:
        print(f"  ⚠️ {ticker}: {e}")
    return False

def main():
    parser = argparse.ArgumentParser(description='Smart Recalculation of support/resistance')
    parser.add_argument('--rolling', type=int, default=0, help='Rolling batch size (e.g., 50)')
    parser.add_argument('--ticker', type=str, help='Single ticker to recalc')
    parser.add_argument('--validation-only', action='store_true', help='Run validation guard only')
    args = parser.parse_args()
    
    t0 = time.time()
    
    # Layer 1: Always run validation guard
    fixed = validation_guard()
    
    if args.validation_only:
        print(f"Done in {time.time()-t0:.1f}s — validation only")
        return
    
    # Layer 2: Smart detection
    if args.ticker:
        # Single ticker
        print(f"Recalculating {args.ticker}...")
        ok = recalc_single(args.ticker)
        print(f"  {'✅' if ok else '❌'} {args.ticker}")
    elif args.rolling > 0:
        # Rolling update
        tickers = rolling_update(args.rolling)
        ok = 0
        for t in tickers:
            if recalc_single(t):
                ok += 1
            time.sleep(0.01)  # micro-sleep (CPU protection)
        print(f"  ✅ {ok}/{len(tickers)} recalculated")
    else:
        # Default: smart detection only (no recalc — just report)
        tickers = smart_detection()
        if tickers:
            print(f"  Run with --rolling {min(len(tickers), ROLLING_BATCH)} to recalc them")
    
    print(f"Done in {time.time()-t0:.1f}s")

if __name__ == '__main__':
    main()
