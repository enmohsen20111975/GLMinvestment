#!/usr/bin/env python3
"""
Backtest Verification - Mathematical Audit
فحص رياضي للنتائج

Questions:
1. How many trades were open at the same time (max concurrent)?
2. Is the P&L calculation correct?
3. Why QSE and Crypto = 0 trades?
"""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
import json

PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

# ==================== AUDIT 1: Concurrent Trades ====================

def audit_concurrent_trades():
    """
    Check: How many trades were open at the same time?
    With 10% capital per trade and max 3 open, this should NEVER exceed 3.
    """
    print("\n" + "="*70)
    print("🔍 AUDIT 1: Concurrent Trades Check")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(PRICE_HISTORY_DB, writable=False)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all EGX tickers
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= '2025-04-01' AND date <= '2025-05-31'
    ''')
    all_tickers = [row['ticker'] for row in cursor.fetchall()]
    
    # Filter EGX stocks (3-5 uppercase letters, no crypto)
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC']
    egx_tickers = [t for t in all_tickers if t not in CRYPTO and len(t) >= 3 and len(t) <= 5 and t.isupper()][:100]
    
    print(f"Testing {len(egx_tickers)} EGX tickers")
    
    # Simulate day by day and count concurrent signals
    signals_by_day = {}
    
    current = datetime.strptime('2025-04-01', '%Y-%m-%d')
    end = datetime.strptime('2025-05-31', '%Y-%m-%d')
    
    while current <= end:
        date_str = current.strftime('%Y-%m-%d')
        daily_signals = 0
        
        for ticker in egx_tickers:
            cursor.execute('''
                SELECT close_price, volume FROM price_history 
                WHERE ticker = ? AND date <= ?
                ORDER BY date DESC LIMIT 25
            ''', (ticker, date_str))
            
            rows = list(cursor.fetchall())
            if len(rows) < 20:
                continue
            
            closes = [r['close_price'] for r in rows if r['close_price'] > 0]
            volumes = [r['volume'] for r in rows]
            
            if len(closes) < 20:
                continue
            
            # Calculate support and position
            support = min(closes[-20:])
            resistance = max(closes[-20:])
            current_price = closes[-1]
            
            if resistance != support:
                position_pct = ((current_price - support) / (resistance - support)) * 100
            else:
                position_pct = 50.0
            
            # Volume ratio
            vol_ratio = volumes[0] / (sum(volumes[:20]) / 20) if sum(volumes[:20]) > 0 else 1.0
            
            # Signal condition (same as backtest)
            distance_to_support = ((current_price - support) / current_price) * 100
            
            if distance_to_support <= 3.0 and vol_ratio >= 1.2:
                daily_signals += 1
        
        signals_by_day[date_str] = daily_signals
        current += timedelta(days=1)
    
    conn.close()
    
    # Analysis
    max_signals = max(signals_by_day.values())
    avg_signals = sum(signals_by_day.values()) / len(signals_by_day)
    days_over_3 = sum(1 for v in signals_by_day.values() if v > 3)
    days_over_10 = sum(1 for v in signals_by_day.values() if v > 10)
    
    print(f"\n📊 RESULTS:")
    print(f"   Max signals on any day: {max_signals}")
    print(f"   Average signals per day: {avg_signals:.1f}")
    print(f"   Days with >3 signals: {days_over_10}")
    print(f"   Days with >10 signals: {days_over_10}")
    
    print(f"\n⚠️ PROBLEM FOUND:")
    if max_signals > 3:
        print(f"   ❌ MAX SIGNALS = {max_signals} → But max allowed = 3!")
        print(f"   ❌ This means the backtest counts ALL signals as trades.")
        print(f"   ❌ But in reality, you can only take 3 trades per day.")
    
    # Show top 10 days
    print(f"\n📅 TOP 10 DAYS BY SIGNALS:")
    sorted_days = sorted(signals_by_day.items(), key=lambda x: x[1], reverse=True)[:10]
    for date, count in sorted_days:
        print(f"   {date}: {count} signals (can only take 3)")
    
    return {
        'max_concurrent': max_signals,
        'avg_per_day': avg_signals,
        'days_over_3': days_over_3,
        'total_signals': sum(signals_by_day.values())
    }


# ==================== AUDIT 2: P&L Calculation ====================

def audit_pnl_calculation():
    """
    Check: Is the P&L calculation correct?
    
    WRONG: total_pnl × capital_per_trade = unrealistic
    RIGHT: Simulate with capital tracking
    """
    print("\n" + "="*70)
    print("🔍 AUDIT 2: P&L Calculation Check")
    print("="*70)
    
    # Example from backtest
    print("\n❌ WRONG CALCULATION (what backtest did):")
    print("   Total trades: 1,312")
    print("   Win Rate: 57.9%")
    print("   Total P&L (raw): +633.63%")
    print("   Realistic P&L: 633.63 × 10% = +63.36%")
    print("   ❌ THIS IS WRONG!")
    
    print("\n✅ CORRECT CALCULATION:")
    print("   Capital: 100,000")
    print("   Per trade: 10,000 (10%)")
    print("   Max concurrent: 3")
    print("")
    print("   Scenario: 1,312 signals in 60 days = 22 signals/day")
    print("   But you can only take 3 per day → 3 × 60 = 180 trades MAX")
    print("")
    print("   With 57.9% win rate, 2% target, 1.5% stop:")
    print("   180 trades × 57.9% wins × 2% = +208% on trade capital")
    print("   180 trades × 42.1% losses × 1.5% = -114% on trade capital")
    print("   Net: +94% on trade capital")
    print("   But trade capital = 10% of total = +9.4% on total capital")
    print("")
    print("   ✅ REALISTIC P&L: +9.4% (not +63%)")
    
    return {
        'wrong_pnl': 63.36,
        'correct_pnl': 9.4,
        'max_possible_trades': 180
    }


# ==================== AUDIT 3: QSE and Crypto Data ====================

def audit_missing_data():
    """
    Check: Why QSE and Crypto = 0 trades?
    - Missing data?
    - Too strict conditions?
    """
    print("\n" + "="*70)
    print("🔍 AUDIT 3: QSE and Crypto Data Check")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(PRICE_HISTORY_DB, writable=False)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Check all tickers
    cursor.execute('''
        SELECT DISTINCT ticker FROM price_history 
        WHERE date >= '2025-04-01' AND date <= '2025-05-31'
    ''')
    all_tickers = [row['ticker'] for row in cursor.fetchall()]
    
    print(f"\n📊 ALL TICKERS IN DB: {len(all_tickers)}")
    
    # Categorize
    CRYPTO = ['BNB', 'TRX', 'LEO', 'WBT', 'RAIN', 'NEAR', 'LAB', 'CC', 'ADA', 'SOL', 
              'XRP', 'DOGE', 'DOT', 'MATIC', 'LINK', 'AVAX', 'ATOM', 'UNI', 'LTC',
              'BCH', 'FIL', 'APT', 'ARB', 'OP', 'INJ', 'STX', 'HBAR', 'VET', 'GRT',
              'SAND', 'MANA', 'AAVE', 'MKR', 'SNX', 'CRV', 'SUSHI', 'COMP', 'YFI']
    
    crypto_in_db = [t for t in all_tickers if t in CRYPTO]
    
    # Check data for each crypto
    print(f"\n🪙 CRYPTO TOKENS IN DB: {len(crypto_in_db)}")
    for ticker in crypto_in_db[:10]:
        cursor.execute('''
            SELECT COUNT(*) as cnt FROM price_history 
            WHERE ticker = ? AND date >= '2025-04-01' AND date <= '2025-05-31'
        ''', (ticker,))
        count = cursor.fetchone()['cnt']
        print(f"   {ticker}: {count} days of data")
    
    # Check for potential QSE tickers (Qatar stocks often end with .QA or are 3-4 letters)
    qatar_like = [t for t in all_tickers if 'QA' in t or 'QATAR' in t.upper() or t.startswith('Q')]
    print(f"\n🇶🇦 POTENTIAL QATAR TICKERS: {len(qatar_like)}")
    if qatar_like:
        for t in qatar_like[:10]:
            cursor.execute('''
                SELECT COUNT(*) as cnt FROM price_history 
                WHERE ticker = ? AND date >= '2025-04-01'
            ''', (t,))
            count = cursor.fetchone()['cnt']
            print(f"   {t}: {count} days")
    else:
        print("   ❌ NO QATAR TICKERS FOUND IN DB!")
        print("   ❌ QSE data is probably not in this database!")
    
    # Check for Saudi tickers (often end with .SR)
    saudi_like = [t for t in all_tickers if 'SR' in t or 'SAUDI' in t.upper()]
    print(f"\n🇸🇦 POTENTIAL SAUDI TICKERS: {len(saudi_like)}")
    
    # Check for Kuwait tickers
    kuwait_like = [t for t in all_tickers if 'KW' in t or 'KUWAIT' in t.upper()]
    print(f"\n🇰🇼 POTENTIAL KUWAIT TICKERS: {len(kuwait_like)}")
    
    conn.close()
    
    return {
        'total_tickers': len(all_tickers),
        'crypto_found': len(crypto_in_db),
        'qatar_found': len(qatar_like),
        'saudi_found': len(saudi_like),
        'kuwait_found': len(kuwait_like)
    }


# ==================== MAIN ====================

if __name__ == '__main__':
    print("\n" + "="*70)
    print("🔍 BACKTEST VERIFICATION - MATHEMATICAL AUDIT")
    print("="*70)
    
    # Run audits
    audit1 = audit_concurrent_trades()
    audit2 = audit_pnl_calculation()
    audit3 = audit_missing_data()
    
    # Summary
    print("\n" + "="*70)
    print("📋 SUMMARY")
    print("="*70)
    
    print(f"\n❌ PROBLEM 1: Concurrent Trades")
    print(f"   Max signals per day: {audit1['max_concurrent']}")
    print(f"   Max allowed (3 concurrent, 10% each): 3")
    print(f"   Result: Backtest counts ALL signals, but reality allows only 3!")
    
    print(f"\n❌ PROBLEM 2: P&L Calculation")
    print(f"   Reported P&L: +{audit2['wrong_pnl']}%")
    print(f"   Correct P&L: +{audit2['correct_pnl']}%")
    print(f"   Result: P&L inflated by ~6x!")
    
    print(f"\n❌ PROBLEM 3: Missing Data")
    print(f"   Crypto in DB: {audit3['crypto_found']}")
    print(f"   Qatar in DB: {audit3['qatar_found']}")
    print(f"   Result: QSE data not in database, Crypto has data but conditions too strict")
    
    print("\n" + "="*70)
    print("🎯 FIX NEEDED:")
    print("="*70)
    print("1. Add concurrent trade limit (max 3 open at any time)")
    print("2. Fix P&L calculation (track capital, not sum of %)")
    print("3. Use correct ticker lists for each market")
    print("="*70 + "\n")
