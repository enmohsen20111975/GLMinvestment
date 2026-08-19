شغل الس#!/usr/bin/env python3
"""Test Historical Prediction Generator"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service', 'engines'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service'))

from historical_prediction_generator import HistoricalPredictionGenerator

gen = HistoricalPredictionGenerator()

def progress(info):
    print(f"  [{info['current']}/{info['total']}] {info['date']} - "
          f"{info['predictions']} predictions ({info['percent']}%)")

result = gen.generate_historical(
    start_date='2026-01-01',
    end_date='2026-06-15',
    markets=['السعودية'],
    progress_callback=progress
)

print("\n=== RESULT ===")
print(f"Success: {result['success']}")
if result.get('stats'):
    s = result['stats']
    print(f"Total predictions: {s.get('total_predictions', 0)}")
    print(f"Days processed: {s.get('days_processed', 0)}")
    print(f"Win rate: {s.get('win_rate', 'N/A')}")
    print(f"Buy signals: {s.get('buy_signals', 0)}")
    print(f"Sell signals: {s.get('sell_signals', 0)}")
    print(f"Duration: {s.get('duration_seconds', 0)}s")