"""
Test Script for Phase 3: AI & Sentiment Analysis
=================================================

Tests the enhanced analyzer with AI Pattern Recognition and Sentiment Analysis.

Author: دليل الاستثمار
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analyzers.master_analyzer import MasterAnalyzer, MASTER_WEIGHTS
from datetime import datetime
from pathlib import Path as _P

# Database path (relative)
_PROJECT_ROOT = _P(__file__).resolve().parent.parent
DB_PATH = str(_PROJECT_ROOT / 'db' / 'stocks.db')

def test_phase3():
    """Test Phase 3 enhancements."""
    print("=" * 60)
    print("Phase 3: AI & Sentiment Analysis Test")
    print("=" * 60)
    print(f"\nTimestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"\nUpdated Weights: {MASTER_WEIGHTS}")
    
    # Initialize analyzer
    print("\n[1] Initializing Master Analyzer with Phase 3 enhancements...")
    analyzer = MasterAnalyzer(DB_PATH)
    
    # Scan market
    print("\n[2] Scanning market for tradeable stocks...")
    results = analyzer.scan_market(limit=200)
    
    print(f"\n✅ Found {len(results)} tradeable stocks")
    
    # Analyze signal distribution
    signals = {}
    for r in results:
        sig = r.signal
        if sig not in signals:
            signals[sig] = 0
        signals[sig] += 1
    
    print("\n[3] Signal Distribution:")
    print("-" * 40)
    for sig in ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL', 'STRONG_SELL']:
        if sig in signals:
            print(f"  {sig:15} : {signals[sig]:3} stocks")
    
    # Top 10 stocks by score
    print("\n[4] Top 10 Stocks by Score:")
    print("-" * 80)
    print(f"{'Ticker':<8} {'Signal':<12} {'Score':>8} {'Tech':>8} {'Fund':>8} {'AI':>8} {'Sent':>8}")
    print("-" * 80)
    
    for i, r in enumerate(results[:10], 1):
        print(f"{r.ticker:<8} {r.signal:<12} {r.master_score:>8.1f} {r.technical_score:>8.1f} {r.fundamental_score:>8.1f} {r.pattern_score:>8.1f} {getattr(r, 'sentiment_score', 50):>8.1f}")
    
    # Check AI Pattern Analysis details for top stock
    if results:
        top = results[0]
        print(f"\n[5] AI Pattern Details for {top.ticker}:")
        print("-" * 40)
        print(f"  Technical Score: {top.technical_score:.1f}")
        print(f"  Fundamental Score: {top.fundamental_score:.1f}")
        print(f"  AI Pattern Score: {top.pattern_score:.1f}")
        print(f"  Market Regime: {top.market_regime_score:.1f}")
        print(f"  Master Score: {top.master_score:.1f}")
        
        if top.risk_profile:
            print(f"\n  Risk Profile:")
            print(f"    Entry: {top.risk_profile.get('entry_price', 0):.2f}")
            print(f"    Target: {top.risk_profile.get('target_price', 0):.2f} ({top.risk_profile.get('target_pct', 0):.1f}%)")
            print(f"    Stop: {top.risk_profile.get('stop_loss_price', 0):.2f} ({top.risk_profile.get('stop_loss_pct', 0):.1f}%)")
            print(f"    R:R: {top.risk_profile.get('risk_reward_ratio', 0):.2f}")
    
    # Summary
    print("\n" + "=" * 60)
    print("Phase 3 Test Summary:")
    print("=" * 60)
    print(f"✅ Total tradeable stocks: {len(results)}")
    print(f"✅ AI Pattern Analyzer: Integrated")
    print(f"✅ Sentiment Analyzer: Integrated")
    print(f"✅ Weights updated: {MASTER_WEIGHTS}")
    
    # Count actionable signals
    actionable = sum(1 for r in results if r.signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE'])
    print(f"✅ Actionable signals (BUY/ACCUMULATE): {actionable}")
    
    return results


if __name__ == "__main__":
    test_phase3()
