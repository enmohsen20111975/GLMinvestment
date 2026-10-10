"""
Forward Test - May 2026 (FIXED)
================================

Tests Conjunction Patterns V3 on available May 2026 data.

@authorM2yDevelopers Team
"""

import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.maestro_orchestrator import MaestroOrchestrator
from analyzers.expert_memory import ExpertMemoryEngineV3, MemoryInsight
from pathlib import Path  # added by patch_db_paths.py

DB_PATH = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")


def get_all_active_stocks() -> List[Dict]:
    """Get all active stocks with sectors"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, ticker, name, sector, current_price, personality
        FROM stocks
        WHERE is_active = 1
        AND sector IS NOT NULL
        AND sector != 'Other'
        AND sector != ''
    ''')
    
    stocks = []
    for row in cursor.fetchall():
        stocks.append({
            'id': row[0],
            'ticker': row[1],
            'name': row[2],
            'sector': row[3],
            'current_price': row[4],
            'personality': row[5]
        })
    
    conn.close()
    return stocks


def get_available_dates() -> List[str]:
    """Get available test dates in May 2026"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT DISTINCT date 
        FROM stock_price_history 
        WHERE date LIKE '2026-05%'
        ORDER BY date
    ''')
    
    dates = [row[0] for row in cursor.fetchall()]
    conn.close()
    return dates


def get_price_history(stock_id: int, end_date: str, limit: int = 100) -> List[Dict]:
    """Get price history for a stock.

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    The caller passes a `stock_id` (DB internal id) which we map to the
    ticker via the stocks metadata table, then call `load_price_history_until`
    (the point-in-time variant — no look-ahead past `end_date`).
    """
    # 1) Resolve stock_id → ticker via stocks metadata (not a price table).
    ticker = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT ticker FROM stocks WHERE id = ?", (stock_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            ticker = row[0]
    except Exception as e:
        print(f"[forward_test] ⚠️ ticker lookup failed for stock_id={stock_id}: {e}")
        return []

    if not ticker:
        return []

    # 2) Delegate to the unified point-in-time reader.
    from data.prices import load_price_history_until
    return load_price_history_until(ticker, end_date, limit=limit)


def get_next_price(stock_id: int, after_date: str, days: int = 10) -> Tuple[float, str]:
    """Get price after X days"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    target = datetime.fromisoformat(after_date) + timedelta(days=days)
    target_str = target.strftime('%Y-%m-%d')
    
    cursor.execute('''
        SELECT close_price, date
        FROM stock_price_history
        WHERE stock_id = ? AND date >= ?
        ORDER BY date ASC
        LIMIT 1
    ''', (stock_id, target_str))
    
    result = cursor.fetchone()
    conn.close()
    
    return (result[0], result[1]) if result else (None, None)


def run_forward_test_single(
    test_date: str,
    stocks: List[Dict],
    use_conjunction: bool = True,
    persona: str = 'balanced'
) -> Dict:
    """Run test on a single date"""
    
    orchestrator = MaestroOrchestrator(DB_PATH)
    
    results = {
        'total_signals': 0,
        'allowed': 0,
        'blocked': 0,
        'boosted': 0,
        'caution': 0,
        'wins': 0,
        'losses': 0,
        'signals': [],
        'blocked_patterns': {}
    }
    
    for stock in stocks:
        stock_id = stock['id']
        ticker = stock['ticker']
        
        # Get price history
        price_history = get_price_history(stock_id, test_date, 100)
        
        if len(price_history) < 30:
            continue
        
        current_price = price_history[-1]['close'] if price_history else None
        
        if not current_price or current_price <= 0:
            continue
        
        try:
            result = orchestrator.analyze(
                ticker=ticker,
                stock={
                    'ticker': ticker,
                    'sector': stock['sector'],
                    'current_price': current_price,
                    'personality': stock.get('personality')
                },
                price_history=price_history,
                options={'persona_type': persona}
            )
            
            if result.recommendation not in ['buy', 'strong_buy']:
                continue
            
            results['total_signals'] += 1
            
            # Check expert memory
            if use_conjunction and result.expert_memory:
                em_rec = result.expert_memory.recommendation
                
                if em_rec == 'block':
                    results['blocked'] += 1
                    pattern = result.expert_memory.reason
                    if pattern not in results['blocked_patterns']:
                        results['blocked_patterns'][pattern] = 0
                    results['blocked_patterns'][pattern] += 1
                    continue
                elif em_rec == 'boost':
                    results['boosted'] += 1
                elif em_rec == 'caution':
                    results['caution'] += 1
            
            results['allowed'] += 1
            
            # Simulate signal
            entry = result.entry_price
            stop = result.stop_loss
            target = result.target
            
            # Get price after 10 days
            next_price, next_date = get_next_price(stock_id, test_date, 10)
            
            if next_price and next_price > 0:
                # Simple simulation: check stop/target
                pnl = ((next_price - entry) / entry) * 100
                
                if next_price <= stop:
                    pnl = ((stop - entry) / entry) * 100
                    outcome = 'loss'
                elif next_price >= target:
                    pnl = ((target - entry) / entry) * 100
                    outcome = 'win'
                else:
                    outcome = 'win' if pnl > 0 else 'loss'
                
                if outcome == 'win':
                    results['wins'] += 1
                else:
                    results['losses'] += 1
                
                results['signals'].append({
                    'ticker': ticker,
                    'sector': stock['sector'],
                    'entry': entry,
                    'stop': stop,
                    'target': target,
                    'exit_price': next_price,
                    'pnl': pnl,
                    'outcome': outcome,
                    'em_reason': result.expert_memory.reason if result.expert_memory else None
                })
        
        except Exception as e:
            pass
    
    return results


def run_full_test():
    """Run complete forward test"""
    
    print("\n" + "="*70)
    print("FORWARD TEST - MAY 2026")
    print("Testing Conjunction Patterns V3")
    print("="*70)
    
    # Get test data
    stocks = get_all_active_stocks()
    test_dates = get_available_dates()
    
    print(f"\nStocks: {len(stocks)}")
    print(f"Test dates: {test_dates}")
    
    if not test_dates:
        print("\n❌ No May 2026 data available!")
        return
    
    # Run WITH Conjunction Patterns
    print(f"\n{'='*70}")
    print("TEST 1: WITH Conjunction Patterns (BLOCK + BOOST active)")
    print(f"{'='*70}")
    
    total_with = {
        'total_signals': 0,
        'allowed': 0,
        'blocked': 0,
        'boosted': 0,
        'caution': 0,
        'wins': 0,
        'losses': 0,
        'signals': [],
        'blocked_patterns': {}
    }
    
    for test_date in test_dates:
        print(f"\n  Testing {test_date}...")
        day_result = run_forward_test_single(test_date, stocks, use_conjunction=True)
        
        total_with['total_signals'] += day_result['total_signals']
        total_with['allowed'] += day_result['allowed']
        total_with['blocked'] += day_result['blocked']
        total_with['boosted'] += day_result['boosted']
        total_with['caution'] += day_result['caution']
        total_with['wins'] += day_result['wins']
        total_with['losses'] += day_result['losses']
        total_with['signals'].extend(day_result['signals'])
        
        for pattern, count in day_result['blocked_patterns'].items():
            if pattern not in total_with['blocked_patterns']:
                total_with['blocked_patterns'][pattern] = 0
            total_with['blocked_patterns'][pattern] += count
    
    # Run WITHOUT Conjunction Patterns (baseline)
    print(f"\n{'='*70}")
    print("TEST 2: WITHOUT Conjunction Patterns (baseline)")
    print(f"{'='*70}")
    
    total_without = {
        'total_signals': 0,
        'allowed': 0,
        'blocked': 0,
        'boosted': 0,
        'caution': 0,
        'wins': 0,
        'losses': 0,
        'signals': []
    }
    
    for test_date in test_dates:
        print(f"\n  Testing {test_date}...")
        day_result = run_forward_test_single(test_date, stocks, use_conjunction=False)
        
        total_without['total_signals'] += day_result['total_signals']
        total_without['allowed'] += day_result['allowed']
        total_without['blocked'] += day_result['blocked']
        total_without['wins'] += day_result['wins']
        total_without['losses'] += day_result['losses']
        total_without['signals'].extend(day_result['signals'])
    
    # Calculate win rates
    wr_with = (total_with['wins'] / (total_with['wins'] + total_with['losses']) * 100) if (total_with['wins'] + total_with['losses']) > 0 else 0
    wr_without = (total_without['wins'] / (total_without['wins'] + total_without['losses']) * 100) if (total_without['wins'] + total_without['losses']) > 0 else 0
    
    # Print results
    print(f"\n{'='*70}")
    print("FINAL RESULTS")
    print(f"{'='*70}")
    
    print(f"\n| Metric | WITH Conjunction | WITHOUT Conjunction |")
    print(f"|--------|------------------|---------------------|")
    print(f"| Total BUY Signals | {total_with['total_signals']} | {total_without['total_signals']} |")
    print(f"| Allowed | {total_with['allowed']} | {total_without['allowed']} |")
    print(f"| BLOCKED | {total_with['blocked']} | {total_without['blocked']} |")
    print(f"| BOOSTED | {total_with['boosted']} | - |")
    print(f"| CAUTION | {total_with['caution']} | - |")
    print(f"| Wins | {total_with['wins']} | {total_without['wins']} |")
    print(f"| Losses | {total_with['losses']} | {total_without['losses']} |")
    print(f"| Win Rate | {wr_with:.1f}% | {wr_without:.1f}% |")
    
    improvement = wr_with - wr_without
    print(f"\n{'='*70}")
    if improvement > 0:
        print(f"✅ IMPROVEMENT: +{improvement:.1f}%")
    elif improvement < 0:
        print(f"❌ DECLINE: {improvement:.1f}%")
    else:
        print(f"⚠️ NO CHANGE: {improvement:.1f}%")
    print(f"{'='*70}")
    
    # Show blocked patterns
    if total_with['blocked_patterns']:
        print(f"\n--- Blocked Patterns (why signals were rejected) ---")
        for pattern, count in sorted(total_with['blocked_patterns'].items(), 
                                     key=lambda x: x[1], reverse=True)[:10]:
            print(f"  • {pattern}: {count} times")
    
    # Show sample signals
    print(f"\n--- Sample Allowed Signals (first 10) ---")
    for sig in total_with['signals'][:10]:
        status = "✅ WIN" if sig['outcome'] == 'win' else "❌ LOSS"
        print(f"  {status} {sig['ticker']}: Entry {sig['entry']:.2f}, Exit {sig['exit_price']:.2f}, PnL {sig['pnl']:.1f}%")
    
    return total_with, total_without


if __name__ == "__main__":
    run_full_test()
    print("\n✅ Forward Test Complete!")
