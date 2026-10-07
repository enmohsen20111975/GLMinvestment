#!/usr/bin/env python3
"""Clear old predictions and regenerate for ALL markets"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service', 'engines'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service'))

import sqlite3
from datetime import datetime
from historical_prediction_generator import HistoricalPredictionGenerator, PREDICTIONS_DB

# 1. Clear old predictions
print("=== Clearing old predictions ===")
conn = sqlite3.connect(PREDICTIONS_DB)
try:
    count = conn.execute("SELECT COUNT(*) FROM platform_recommendations").fetchone()[0]
    conn.execute("DELETE FROM platform_recommendations")
    conn.commit()
    print(f"Cleared {count} old predictions")
except:
    print("Table doesn't exist yet, will create fresh")
conn.close()

# 2. Generate new predictions for ALL markets
print("\n=== Generating predictions for ALL markets ===")
gen = HistoricalPredictionGenerator()

def progress(info):
    print(f"  [{info['current']}/{info['total']}] {info['date']} - "
          f"{info['predictions']} predictions ({info['percent']}%)")

result = gen.generate_historical(
    start_date='2026-01-01',
    end_date='2026-06-15',
    markets=['السعودية', 'مصر', 'الكويت', 'قطر'],
    progress_callback=progress
)

# 3. Final stats
print("\n=== FINAL RESULT ===")
if result.get('stats'):
    s = result['stats']
    print(f"Total predictions: {s.get('total_predictions', 0)}")
    print(f"Days processed: {s.get('days_processed', 0)}")
    print(f"Buy signals: {s.get('buy_signals', 0)}")
    print(f"Sell signals: {s.get('sell_signals', 0)}")
    print(f"Duration: {s.get('duration_seconds', 0)}s")
    print(f"Win rate: {s.get('win_rate', 'N/A')}")
    print(f"By market: {s.get('by_market', {})}")