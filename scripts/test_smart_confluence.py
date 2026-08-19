#!/usr/bin/env python3
"""Test Smart Confluence Engine"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service', 'engines'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service'))

from smart_confluence_engine import get_engine

engine = get_engine()

print("=== Testing Smart Confluence Engine ===")

# 1. Check available stocks
stocks = engine.get_all_stocks()
print(f"Total stocks: {len(stocks)}")

# 2. Check available dates
dates = engine.get_available_dates('السعودية')
print(f"Available dates (Saudi): {len(dates)}")
if dates:
    print(f"  First: {dates[0]}")
    print(f"  Last: {dates[-1]}")

# 3. Test analyzing a stock
if stocks:
    stock = stocks[0]
    print(f"\nAnalyzing {stock['symbol']} ({stock['name']})...")
    result = engine.analyze(stock['symbol'])
    if result:
        print(f"  Signal: {result['signal']}")
        print(f"  Confidence: {result['confidence']}%")
        print(f"  Entry: {result['entry_price']}")
        print(f"  Target: {result['target_price']}")
        print(f"  Stop Loss: {result['stop_loss']}")
        print(f"  Technical Score: {result['technical_score']}")
        print(f"  Fundamental Score: {result['fundamental_score']}")
        print(f"  Volume/Seasonal Score: {result['volume_seasonal_score']}")
        print(f"  Confluence Score: {result['confluence_score']}")
        print(f"  RSI: {result['rsi']}")
    else:
        print("  ❌ No result (no data)")

print("\n=== Test Complete ===")