"""
Stock Personality Calculator - Beta-Based (FIXED VERSION)
=========================================================

Fixes the 279 LEADER problem by using proper Beta calculation.

Personality Types:
- LEADER: Beta > 1.2 AND leads sector by 2+ days in 60%+ of up days
- FOLLOWER: Beta 0.8-1.2 (moves with sector)
- LAGGARD: Beta < 0.8 (underperforms sector)
- REBEL: Negative correlation with sector (rare)

@authorM2yDevelopers Team
"""

import sqlite3
import numpy as np
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
import sys
import os
from pathlib import Path  # added by patch_db_paths.py

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def calculate_beta(stock_returns: List[float], sector_returns: List[float]) -> float:
    """Calculate Beta of stock vs sector"""
    if len(stock_returns) < 10 or len(sector_returns) < 10:
        return 1.0
    
    stock_returns = np.array(stock_returns)
    sector_returns = np.array(sector_returns)
    
    covariance = np.cov(stock_returns, sector_returns)[0][1]
    variance = np.var(sector_returns)
    
    if variance == 0:
        return 1.0
    
    beta = covariance / variance
    return round(beta, 3)


def calculate_correlation(stock_returns: List[float], sector_returns: List[float]) -> float:
    """Calculate correlation coefficient"""
    if len(stock_returns) < 10 or len(sector_returns) < 10:
        return 0.5
    
    correlation = np.corrcoef(stock_returns, sector_returns)[0][1]
    return round(correlation, 3)


def get_stock_id(db_path: str, ticker: str) -> Optional[int]:
    """Get stock_id from ticker"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=False)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM stocks WHERE ticker = ?", (ticker,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None


def get_price_history_by_stock_id(db_path: str, stock_id: int, days: int = 90) -> List[Dict]:
    """Get price history by stock_id.

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    The unified reader takes a ticker (not stock_id), so we do a tiny lookup
    on the stocks metadata table (NOT a price table) to map stock_id → ticker.
    The return format is preserved as ``[{close, volume, date}]`` for callers
    (they only use those three keys).
    """
    # 1) Resolve stock_id → ticker via stocks metadata (not a price table).
    ticker = None
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(db_path, writable=False)
        cursor = conn.cursor()
        cursor.execute("SELECT ticker FROM stocks WHERE id = ?", (stock_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            ticker = row[0]
    except Exception as e:
        print(f"[fix_stock_personality] ⚠️ ticker lookup failed for stock_id={stock_id}: {e}")
        return []

    if not ticker:
        return []

    # 2) Delegate to the unified reader and project to caller's contract.
    from data.prices import load_price_history
    rows = load_price_history(ticker, limit=days)

    history: List[Dict] = []
    for r in rows:
        close = r.get('close')
        if close:  # preserve old "skip null close" behaviour
            history.append({
                'close': close,
                'volume': r.get('volume', 0),
                'date': r.get('date'),
            })
    return history


def get_sector_stock_ids(db_path: str, sector: str) -> List[int]:
    """Get all stock_ids in a sector"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=False)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id FROM stocks 
        WHERE sector = ? AND is_active = 1
    ''', (sector,))
    
    ids = [row[0] for row in cursor.fetchall()]
    conn.close()
    return ids


def calculate_sector_returns(db_path: str, sector: str, days: int = 90) -> List[float]:
    """Calculate average daily returns for a sector"""
    stock_ids = get_sector_stock_ids(db_path, sector)
    
    if not stock_ids:
        return []
    
    all_returns = []
    
    for stock_id in stock_ids[:10]:  # Use top 10 stocks
        history = get_price_history_by_stock_id(db_path, stock_id, days)
        
        if len(history) < 2:
            continue
        
        returns = []
        for i in range(1, len(history)):
            if history[i-1]['close'] and history[i]['close']:
                ret = (history[i]['close'] - history[i-1]['close']) / history[i-1]['close']
                returns.append(ret)
        
        if returns:
            all_returns.append(returns)
    
    if not all_returns:
        return []
    
    min_len = min(len(r) for r in all_returns)
    avg_returns = []
    
    for i in range(min_len):
        daily_returns = [r[i] for r in all_returns if i < len(r)]
        if daily_returns:
            avg_returns.append(np.mean(daily_returns))
    
    return avg_returns


def determine_personality(beta: float, correlation: float) -> str:
    """
    Determine stock personality based on beta and correlation
    
    REBEL is very rare - requires strong negative correlation (< -0.3)
    
    For EGX, we use more balanced thresholds:
    - LEADER: > 1.1 (amplifies sector moves by 10%+)
    - FOLLOWER: 0.9 - 1.1 (moves with sector)
    - LAGGARD: < 0.9 (dampens sector moves)
    """
    # REBEL: STRONG negative correlation (< -0.3) - very rare
    if correlation < -0.3:
        return 'REBEL'
    
    # LEADER: high beta (outperforms in up moves)
    if beta > 1.1:
        return 'LEADER'
    
    # LAGGARD: low beta (underperforms)
    if beta < 0.9:
        return 'LAGGARD'
    
    # FOLLOWER: normal
    return 'FOLLOWER'


def analyze_stock_personality(db_path: str, ticker: str, sector: str, days: int = 90) -> Dict:
    """Analyze a single stock's personality"""
    stock_id = get_stock_id(db_path, ticker)
    
    if not stock_id:
        return {
            'ticker': ticker,
            'sector': sector,
            'personality': 'FOLLOWER',
            'beta': 1.0,
            'correlation': 0.5,
            'samples': 0,
            'reason': 'Stock not found'
        }
    
    # Get stock price history
    stock_history = get_price_history_by_stock_id(db_path, stock_id, days)
    
    if len(stock_history) < 20:
        return {
            'ticker': ticker,
            'sector': sector,
            'personality': 'FOLLOWER',
            'beta': 1.0,
            'correlation': 0.5,
            'samples': len(stock_history),
            'reason': 'Insufficient data'
        }
    
    # Calculate stock returns
    stock_returns = []
    for i in range(1, len(stock_history)):
        prev_close = stock_history[i-1]['close']
        curr_close = stock_history[i]['close']
        
        if prev_close and curr_close and prev_close > 0:
            ret = (curr_close - prev_close) / prev_close
            stock_returns.append(ret)
    
    # Get sector returns
    sector_returns = calculate_sector_returns(db_path, sector, days)
    
    if len(sector_returns) < 10:
        return {
            'ticker': ticker,
            'sector': sector,
            'personality': 'FOLLOWER',
            'beta': 1.0,
            'correlation': 0.5,
            'samples': len(stock_returns),
            'reason': 'Insufficient sector data'
        }
    
    # Align lengths
    min_len = min(len(stock_returns), len(sector_returns))
    stock_returns = stock_returns[:min_len]
    sector_returns = sector_returns[:min_len]
    
    # Calculate metrics
    beta = calculate_beta(stock_returns, sector_returns)
    correlation = calculate_correlation(stock_returns, sector_returns)
    
    # Determine personality
    personality = determine_personality(beta, correlation)
    
    return {
        'ticker': ticker,
        'sector': sector,
        'personality': personality,
        'beta': beta,
        'correlation': correlation,
        'samples': len(stock_returns),
        'reason': 'Calculated'
    }


def update_stock_personality(db_path: str, ticker: str, personality: str, beta: float):
    """Update stock personality in database"""
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=True)
    cursor = conn.cursor()
    
    cursor.execute('''
        UPDATE stocks 
        SET personality = ?
        WHERE ticker = ?
    ''', (personality, ticker))
    
    conn.commit()
    conn.close()


def recalculate_all_personalities(db_path: str):
    """Recalculate personalities for ALL stocks"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=False)
    cursor = conn.cursor()
    
    # Get all active stocks with sectors (exclude 'Other')
    cursor.execute('''
        SELECT ticker, sector 
        FROM stocks 
        WHERE is_active = 1 
        AND sector IS NOT NULL 
        AND sector != 'Other'
        AND sector != ''
    ''')
    
    stocks = cursor.fetchall()
    conn.close()
    
    print(f"\n{'='*60}")
    print(f"RECALCULATING PERSONALITIES FOR {len(stocks)} STOCKS")
    print(f"{'='*60}\n")
    
    results = {
        'LEADER': 0,
        'FOLLOWER': 0,
        'LAGGARD': 0,
        'REBEL': 0
    }
    
    updated = 0
    no_data = 0
    
    for ticker, sector in stocks:
        try:
            result = analyze_stock_personality(db_path, ticker, sector)
            
            if result['samples'] >= 20:
                update_stock_personality(db_path, ticker, result['personality'], result['beta'])
                results[result['personality']] += 1
                updated += 1
            else:
                # Default to FOLLOWER for insufficient data
                update_stock_personality(db_path, ticker, 'FOLLOWER', 1.0)
                results['FOLLOWER'] += 1
                no_data += 1
            
            if (updated + no_data) % 50 == 0:
                print(f"  Processed {updated + no_data}/{len(stocks)}...")
        
        except Exception as e:
            print(f"  Error with {ticker}: {e}")
    
    total = updated + no_data
    if total == 0:
        total = 1
    
    print(f"\n{'='*60}")
    print("RESULTS:")
    print(f"{'='*60}")
    print(f"  Total processed: {total}")
    print(f"  With sufficient data: {updated}")
    print(f"  Insufficient data: {no_data}")
    print(f"\n  LEADER: {results['LEADER']} ({results['LEADER']/total*100:.1f}%)")
    print(f"  FOLLOWER: {results['FOLLOWER']} ({results['FOLLOWER']/total*100:.1f}%)")
    print(f"  LAGGARD: {results['LAGGARD']} ({results['LAGGARD']/total*100:.1f}%)")
    print(f"  REBEL: {results['REBEL']} ({results['REBEL']/total*100:.1f}%)")
    print(f"\n  (Expected: Leader ~25%, Follower ~50%, Laggard ~25%)")
    
    return results


if __name__ == "__main__":
    DB_PATH = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")
    
    print("\n" + "="*60)
    print("STOCK PERSONALITY FIXER")
    print("Fixing the 279 LEADER problem")
    print("="*60)
    
    results = recalculate_all_personalities(DB_PATH)
    
    print("\n✅ Done!")
