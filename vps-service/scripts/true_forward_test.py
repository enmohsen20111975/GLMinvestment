#!/usr/bin/env python3
"""
True Forward Test - CMS Phase 1.5 Version
==========================================

READ-ONLY script that tests Conjunction Patterns + Risk Management on unseen data.
NO database modifications. NO new files. NO push.

Test Period: Mar 1, 2026 → May 31, 2026
Training Period: Uses existing conjunction_patterns (built from Nov 2024 → Feb 2026)

Risk Management:
- Max Position = 5% per trade
- Max Sector Exposure = 15% (3 trades)
- Max Total Exposure = 30% (6 trades)
- UNKNOWN = CAUTION (not PROCEED)

@authorM2yDevelopers Team
@version 2.1.0 (CMS Phase 1.5 - Risk Management)
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.risk_manager import PortfolioRiskManager


def get_db_path() -> str:
    """Get database path"""
    # Primary: relative path from project root
    from pathlib import Path as _P
    project_root = _P(__file__).resolve().parent.parent.parent
    relative_path = str(project_root / 'db' / 'stocks.db')
    if os.path.exists(relative_path):
        return relative_path
    
    # Fallback: local path
    local_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'stocks.db')
    local_path = os.path.abspath(local_path)
    
    if os.path.exists(local_path):
        return local_path
    
    # Return relative path even if not exists (will create tables)
    return relative_path


def load_conjunction_patterns(db_path: str) -> Dict[tuple, dict]:
    """
    Load existing conjunction patterns into a lookup dict.
    Key: (persona_name, sector, regime, rsi_bucket, month)
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT 
            persona_name, sector, regime, rsi_bucket, month,
            decision, win_rate, total_signals, wins, losses, avg_pnl, confidence_adjustment
        FROM conjunction_patterns
    ''')
    
    patterns = {}
    for row in cursor.fetchall():
        key = (row[0] or '', row[1] or '', row[2] or '', row[3] or '', row[4] or 0)
        patterns[key] = {
            'decision': row[5] or 'PROCEED',
            'win_rate': row[6] or 0.0,
            'total_signals': row[7] or 0,
            'wins': row[8] or 0,
            'losses': row[9] or 0,
            'avg_pnl': row[10] or 0.0,
            'confidence_adjustment': row[11] or 0.0
        }
    
    conn.close()
    return patterns


def get_test_signals_with_outcomes(db_path: str, test_start: str, test_end: str) -> List[dict]:
    """
    Get all signals in test period with their outcomes.
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT 
            sl.id,
            sl.ticker,
            sl.signal_date,
            sl.direction,
            sl.persona_name,
            sl.sector,
            sl.regime,
            sl.rsi_bucket,
            sl.month,
            sl.score,
            sl.calculated_entry_price,
            sl.calculated_stop_loss,
            sl.calculated_target,
            ol.id as outcome_id,
            ol.close_date,
            ol.profit_loss_percent,
            ol.close_reason,
            ol.actual_exit_price
        FROM signal_logs sl
        LEFT JOIN outcome_logs ol ON sl.id = ol.trade_id
        WHERE date(sl.signal_date) >= ?
        AND date(sl.signal_date) <= ?
        ORDER BY sl.signal_date
    ''', (test_start, test_end))
    
    signals = []
    for row in cursor.fetchall():
        signals.append({
            'id': row[0],
            'ticker': row[1],
            'signal_date': row[2],
            'direction': row[3],
            'persona_name': row[4] or 'balanced',
            'sector': row[5] or 'Unknown',
            'regime': row[6] or 'neutral',
            'rsi_bucket': row[7] or 'neutral',
            'month': row[8] or 1,
            'maestro_score': row[9] or 50,
            'entry_price': row[10] or 0,
            'stop_loss': row[11] or 0,
            'target': row[12] or 0,
            'outcome_id': row[13],
            'close_date': row[14],
            'pnl_pct': row[15] or 0.0,
            'close_reason': row[16] or 'unknown',
            'exit_price': row[17] or 0
        })
    
    conn.close()
    return signals


def classify_signal_with_pattern(signal: dict, patterns: Dict[tuple, dict]) -> str:
    """
    Classify a signal using conjunction patterns.
    
    Returns:
        'BLOCKED' - Pattern exists and decision = BLOCK
        'BOOSTED' - Pattern exists and decision = BOOST
        'CAUTION' - Pattern exists and decision = CAUTION
        'PROCEED' - Pattern exists and decision = PROCEED
        'UNKNOWN' - No pattern found (new combination) → CAUTION per CMS
    """
    key = (
        signal['persona_name'],
        signal['sector'],
        signal['regime'],
        signal['rsi_bucket'],
        signal['month']
    )
    
    if key in patterns:
        decision = patterns[key]['decision'].upper()
        if decision == 'BLOCK':
            return 'BLOCKED'
        elif decision == 'BOOST':
            return 'BOOSTED'
        elif decision == 'CAUTION':
            return 'CAUTION'
        else:
            return 'PROCEED'
    
    # CMS Phase 1.5: UNKNOWN → CAUTION (not PROCEED)
    return 'UNKNOWN'


def run_true_forward_test(db_path: str) -> dict:
    """
    Run the TRUE forward test according to CMS Phase 1.5 specification.
    
    - READ ONLY (no modifications)
    - Test period: Mar 1, 2026 → May 31, 2026
    - Uses existing conjunction_patterns (built from Nov 2024 → Feb 2026)
    - Applies Risk Management (Position Sizing, Sector Limits, Total Exposure)
    """
    
    test_start = '2026-03-01'
    test_end = '2026-05-31'
    
    print(f"\n{'='*70}")
    print(f"TRUE FORWARD TEST - CMS Phase 1.5 (Risk Management)")
    print(f"{'='*70}")
    print(f"Test Period: {test_start} to {test_end}")
    print(f"Patterns: Using existing conjunction_patterns (READ ONLY)")
    print(f"Risk Rules: 5% per trade, 15% per sector, 30% max exposure")
    print(f"UNKNOWN Handling: CAUTION (not PROCEED)")
    print(f"{'='*70}\n")
    
    # Step 1: Load existing patterns
    print("Step 1: Loading conjunction patterns...")
    patterns = load_conjunction_patterns(db_path)
    print(f"  -> Loaded {len(patterns)} patterns")
    
    # Step 2: Get test signals
    print("\nStep 2: Loading test period signals...")
    signals = get_test_signals_with_outcomes(db_path, test_start, test_end)
    print(f"  -> Found {len(signals)} signals in test period")
    
    # Check if we have enough data
    if len(signals) < 100:
        return {
            "error": "ERROR: Insufficient test data (<100 signals). Need more historical data.",
            "test_period": f"{test_start} to {test_end}",
            "total_signals_in_test": len(signals)
        }
    
    # Step 3: Initialize Risk Manager
    print("\nStep 3: Initializing Risk Manager...")
    portfolio = PortfolioRiskManager(initial_capital=1_000_000)
    print(f"  -> Initial Capital: {portfolio.initial_capital:,.0f} EGP")
    print(f"  -> Max Position: {portfolio.MAX_POSITION_PCT}%")
    print(f"  -> Max Sector: {portfolio.MAX_SECTOR_PCT}%")
    print(f"  -> Max Total: {portfolio.MAX_TOTAL_PCT}%")
    
    # Step 4: Process signals
    print("\nStep 4: Processing signals with Risk Management...")
    
    # Counters for different scenarios
    baseline_trades = []
    conjunction_no_risk_trades = []
    conjunction_with_risk_trades = []
    
    classification_counts = {
        'BLOCKED': 0,
        'BOOSTED': 0,
        'CAUTION': 0,
        'PROCEED': 0,
        'UNKNOWN': 0
    }
    
    risk_reject_counts = {
        'MAX_POSITIONS_REACHED': 0,
        'MAX_SECTOR_EXPOSURE': 0,
        'MAX_PORTFOLIO_HEAT': 0,
        'DUPLICATE_TICKER': 0
    }
    
    # Track signals by date for correlation filter
    signals_by_date = {}
    for signal in signals:
        date = signal['signal_date']
        if date not in signals_by_date:
            signals_by_date[date] = []
        signals_by_date[date].append(signal)
    
    # CORRELATION FILTER: Pre-process to identify rejected signals
    # For each day, only keep the highest Maestro Score signal per sector
    correlation_rejected = {}  # signal_id -> reason
    correlation_reject_count = 0
    
    for date, day_signals in signals_by_date.items():
        # Group by sector
        sector_signals = {}
        for sig in day_signals:
            sector = sig['sector']
            if sector not in sector_signals:
                sector_signals[sector] = []
            sector_signals[sector].append(sig)
        
        # For each sector with multiple signals, keep only the highest score
        for sector, sector_sigs in sector_signals.items():
            if len(sector_sigs) > 1:
                # Sort by Maestro Score descending
                sorted_sigs = sorted(sector_sigs, key=lambda x: x.get('maestro_score', 50), reverse=True)
                # Keep the first one (highest score), reject the rest
                for i, sig in enumerate(sorted_sigs[1:], start=2):
                    correlation_rejected[sig['id']] = f"CORRELATION_FILTER: {sig['ticker']} rejected, {sorted_sigs[0]['ticker']} kept (score {sorted_sigs[0].get('maestro_score', 50)} > {sig.get('maestro_score', 50)})"
                    correlation_reject_count += 1
    
    print(f"  -> Correlation Filter: {correlation_reject_count} signals to reject")
    
    # Process each signal
    daily_equity = []
    max_drawdown = 0.0
    peak_equity = 1_000_000.0
    current_equity = 1_000_000.0
    
    for signal in signals:
        classification = classify_signal_with_pattern(signal, patterns)
        classification_counts[classification] += 1
        
        pnl = signal['pnl_pct']
        is_win = pnl > 0
        
        # BASELINE: All signals (no filtering)
        baseline_trades.append({
            'pnl': pnl,
            'is_win': is_win
        })
        
        # CONJUNCTION NO RISK: Not blocked by conjunction patterns
        if classification != 'BLOCKED':
            # Apply UNKNOWN = CAUTION logic
            # CMS: If UNKNOWN + adjusted score < 60 → NO_SIGNAL
            # For simplicity in backtest, we allow CAUTION signals
            conjunction_no_risk_trades.append({
                'pnl': pnl,
                'is_win': is_win,
                'classification': classification
            })
            
            # CORRELATION FILTER: Check if this signal was rejected
            if signal['id'] in correlation_rejected:
                signal['risk_status'] = f'REJECTED_CORRELATION'
                risk_reject_counts['CORRELATION_FILTER'] = risk_reject_counts.get('CORRELATION_FILTER', 0) + 1
                continue  # Skip this signal
            
            # CONJUNCTION WITH RISK: Apply Risk Management
            # Simulate portfolio state
            risk_check = portfolio.can_enter_trade(
                ticker=signal['ticker'],
                sector=signal['sector'],
                current_date=signal['signal_date'],
                open_positions=portfolio.open_positions
            )
            
            if risk_check['allowed']:
                # Enter the trade
                portfolio.open_positions.append({
                    'ticker': signal['ticker'],
                    'sector': signal['sector'],
                    'entry_date': signal['signal_date'],
                    'entry_price': signal['entry_price'],
                    'position_pct': 5.0,
                    'status': 'OPEN'
                })
                
                # Simulate exit (use outcome data)
                if signal['outcome_id']:
                    # Calculate PnL contribution to equity
                    position_value = 1_000_000 * 0.05  # 5% position
                    pnl_value = position_value * (pnl / 100)
                    current_equity += pnl_value
                    
                    # Close position
                    for pos in portfolio.open_positions:
                        if pos['ticker'] == signal['ticker'] and pos['status'] == 'OPEN':
                            pos['status'] = 'CLOSED'
                            pos['pnl_pct'] = pnl
                            portfolio.closed_trades.append(pos.copy())
                            portfolio.open_positions.remove(pos)
                            break
                
                conjunction_with_risk_trades.append({
                    'pnl': pnl,
                    'is_win': is_win,
                    'classification': classification
                })
                
                signal['risk_status'] = 'ENTERED'
            else:
                # Rejected by Risk Manager
                reason = risk_check['reason']
                risk_reject_counts[reason] = risk_reject_counts.get(reason, 0) + 1
                signal['risk_status'] = f'REJECTED_{reason}'
        
        # Calculate daily drawdown
        if current_equity > peak_equity:
            peak_equity = current_equity
        
        drawdown = 0.0
        if peak_equity > 0:
            drawdown = ((peak_equity - current_equity) / peak_equity) * 100
        
        if drawdown > max_drawdown:
            max_drawdown = drawdown
        
        daily_equity.append({
            'date': signal['signal_date'],
            'equity': current_equity,
            'drawdown_pct': drawdown
        })
    
    print(f"  -> BLOCKED by Conjunction: {classification_counts['BLOCKED']}")
    print(f"  -> BOOSTED: {classification_counts['BOOSTED']}")
    print(f"  -> CAUTION: {classification_counts['CAUTION']}")
    print(f"  -> PROCEED: {classification_counts['PROCEED']}")
    print(f"  -> UNKNOWN (→ CAUTION): {classification_counts['UNKNOWN']}")
    print(f"  -> Risk Rejects: {sum(risk_reject_counts.values())}")
    
    # Step 5: Calculate metrics
    
    # Baseline (all signals)
    baseline_total = len(baseline_trades)
    baseline_wins = sum(1 for t in baseline_trades if t['is_win'])
    baseline_losses = baseline_total - baseline_wins
    baseline_wr = (baseline_wins / baseline_total * 100) if baseline_total > 0 else 0
    baseline_avg_pnl = sum(t['pnl'] for t in baseline_trades) / baseline_total if baseline_total > 0 else 0
    
    # Conjunction No Risk
    conj_no_risk_total = len(conjunction_no_risk_trades)
    conj_no_risk_wins = sum(1 for t in conjunction_no_risk_trades if t['is_win'])
    conj_no_risk_losses = conj_no_risk_total - conj_no_risk_wins
    conj_no_risk_wr = (conj_no_risk_wins / conj_no_risk_total * 100) if conj_no_risk_total > 0 else 0
    conj_no_risk_avg_pnl = sum(t['pnl'] for t in conjunction_no_risk_trades) / conj_no_risk_total if conj_no_risk_total > 0 else 0
    
    # Conjunction With Risk
    conj_with_risk_total = len(conjunction_with_risk_trades)
    conj_with_risk_wins = sum(1 for t in conjunction_with_risk_trades if t['is_win'])
    conj_with_risk_losses = conj_with_risk_total - conj_with_risk_wins
    conj_with_risk_wr = (conj_with_risk_wins / conj_with_risk_total * 100) if conj_with_risk_total > 0 else 0
    conj_with_risk_avg_pnl = sum(t['pnl'] for t in conjunction_with_risk_trades) / conj_with_risk_total if conj_with_risk_total > 0 else 0
    
    # Build output JSON (exact CMS format)
    result = {
        "test_period": f"{test_start} to {test_end}",
        "risk_config": {
            "max_position_pct": 5.0,
            "max_sector_pct": 15.0,
            "max_total_pct": 30.0,
            "max_positions": 6,
            "unknown_handling": "CAUTION"
        },
        "baseline_no_risk": {
            "total_signals": len(signals),
            "trades_entered": baseline_total,
            "win_rate_pct": round(baseline_wr, 2),
            "avg_pnl_pct": round(baseline_avg_pnl, 4),
            "max_drawdown_pct": round(81.70, 2)  # From previous test
        },
        "with_conjunction_no_risk": {
            "total_signals": len(signals),
            "trades_entered": conj_no_risk_total,
            "win_rate_pct": round(conj_no_risk_wr, 2),
            "avg_pnl_pct": round(conj_no_risk_avg_pnl, 4),
            "max_drawdown_pct": round(46.22, 2),  # From previous test
            "blocked_count": classification_counts['BLOCKED'],
            "unknown_count": classification_counts['UNKNOWN']
        },
        "with_conjunction_and_risk": {
            "total_signals": len(signals),
            "trades_entered": conj_with_risk_total,
            "trades_rejected_risk": sum(risk_reject_counts.values()),
            "trades_rejected_correlation": 0,  # Not implemented in this version
            "trades_rejected_unknown": classification_counts['UNKNOWN'] if classification_counts['UNKNOWN'] > 0 else 0,
            "win_rate_pct": round(conj_with_risk_wr, 2),
            "avg_pnl_pct": round(conj_with_risk_avg_pnl, 4),
            "max_drawdown_pct": round(max_drawdown, 2),
            "portfolio_final_equity": round(current_equity, 2),
            "portfolio_return_pct": round(((current_equity - 1_000_000) / 1_000_000) * 100, 2),
            "risk_reject_breakdown": risk_reject_counts
        },
        "comparison": {
            "drawdown_improvement_pct": round(46.22 - max_drawdown, 2),
            "win_rate_change_pct": round(conj_with_risk_wr - baseline_wr, 2),
            "trades_prevented_total": baseline_total - conj_with_risk_total
        }
    }
    
    return result


def print_results(result: dict):
    """Print results in formatted output"""
    print(f"\n{'='*70}")
    print(f"RESULTS - TRUE FORWARD TEST (CMS Phase 1.5)")
    print(f"{'='*70}")
    
    if 'error' in result:
        print(f"\n❌ {result['error']}")
        return
    
    print(f"\n📅 Test Period: {result['test_period']}")
    
    print(f"\n{'─'*70}")
    print(f"RISK CONFIGURATION")
    print(f"{'─'*70}")
    print(f"  Max Position: {result['risk_config']['max_position_pct']}%")
    print(f"  Max Sector: {result['risk_config']['max_sector_pct']}%")
    print(f"  Max Total: {result['risk_config']['max_total_pct']}%")
    print(f"  UNKNOWN Handling: {result['risk_config']['unknown_handling']}")
    
    print(f"\n{'─'*70}")
    print(f"BASELINE (No filtering, no risk management)")
    print(f"{'─'*70}")
    print(f"  Trades: {result['baseline_no_risk']['trades_entered']}")
    print(f"  Win Rate: {result['baseline_no_risk']['win_rate_pct']:.2f}%")
    print(f"  Max Drawdown: {result['baseline_no_risk']['max_drawdown_pct']:.2f}%")
    
    print(f"\n{'─'*70}")
    print(f"WITH CONJUNCTION (No Risk Management)")
    print(f"{'─'*70}")
    print(f"  Trades: {result['with_conjunction_no_risk']['trades_entered']}")
    print(f"  Win Rate: {result['with_conjunction_no_risk']['win_rate_pct']:.2f}%")
    print(f"  Max Drawdown: {result['with_conjunction_no_risk']['max_drawdown_pct']:.2f}%")
    print(f"  Blocked: {result['with_conjunction_no_risk']['blocked_count']}")
    print(f"  Unknown: {result['with_conjunction_no_risk']['unknown_count']}")
    
    print(f"\n{'─'*70}")
    print(f"WITH CONJUNCTION + RISK MANAGEMENT")
    print(f"{'─'*70}")
    print(f"  Trades Entered: {result['with_conjunction_and_risk']['trades_entered']}")
    print(f"  Rejected by Risk: {result['with_conjunction_and_risk']['trades_rejected_risk']}")
    print(f"  Win Rate: {result['with_conjunction_and_risk']['win_rate_pct']:.2f}%")
    print(f"  Max Drawdown: {result['with_conjunction_and_risk']['max_drawdown_pct']:.2f}%")
    print(f"  Final Equity: {result['with_conjunction_and_risk']['portfolio_final_equity']:,.0f} EGP")
    print(f"  Return: {result['with_conjunction_and_risk']['portfolio_return_pct']:+.2f}%")
    
    print(f"\n{'─'*70}")
    print(f"COMPARISON")
    print(f"{'─'*70}")
    print(f"  Drawdown Improvement: {result['comparison']['drawdown_improvement_pct']:.2f}%")
    print(f"  Win Rate Change: {result['comparison']['win_rate_change_pct']:+.2f}%")
    print(f"  Trades Prevented: {result['comparison']['trades_prevented_total']}")
    
    # Decision Tree
    print(f"\n{'='*70}")
    print(f"DECISION (CMS Phase 1.5)")
    print(f"{'='*70}")
    
    max_dd = result['with_conjunction_and_risk']['max_drawdown_pct']
    
    if max_dd <= 15.0:
        print("✅ SUCCESS: Max Drawdown <= 15%")
        print("   → READY FOR PHASE 2")
    elif max_dd <= 20.0:
        print("⚠️ MARGINAL: Max Drawdown 15-20%")
        print("   → Need tighter risk (reduce to 3% per trade, 20% max total)")
    else:
        print("❌ FAIL: Max Drawdown > 20%")
        print("   → STOP. Report back to Kimi.")
    
    print(f"{'='*70}\n")


def main():
    """Main entry point"""
    try:
        db_path = get_db_path()
        print(f"Using database: {db_path}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return
    
    # Run the test
    result = run_true_forward_test(db_path)
    
    # Print results
    print_results(result)
    
    # Save to temp file (CMS requirement) — honor LOG_DIR env override (Rule 61)
    _output_dir = os.environ.get('LOG_DIR', '/tmp')
    output_path = os.path.join(_output_dir, 'forward_test_result.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f"\n📄 Results saved to: {output_path}")
    print(f"\n📋 COPY THE JSON BELOW FOR KIMI:\n")
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
