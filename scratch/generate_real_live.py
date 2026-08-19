#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
========================================================================
  🔴 REAL LIVE PRODUCTION ENGINE RUNNER (0 SYNTHETIC / 100% PRODUCTION BRAIN)
  Runs actual BackgroundAnalyzer._analyze_market('EGX') on db/stocks.db
========================================================================
"""
import sys
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

from analyzers.background_analyzer import get_background_analyzer
from api.ai_predictions_routes import generate_predictions_internal

def main():
    print("🚀 Triggering REAL BackgroundAnalyzer._analyze_market('EGX')...")
    analyzer = get_background_analyzer()
    
    # 1. Clear synthetic old predictions
    conn = sqlite3.connect(PROJECT_ROOT / 'db' / 'predictions.db')
    conn.execute("DELETE FROM predictions")
    conn.execute("DELETE FROM stored_analyses")
    conn.commit()
    conn.close()
    
    # 2. Run real live analysis pass for EGX
    analyzed, buy_count = analyzer._analyze_market('EGX')
    print(f"✅ Real Market Scan Complete: analyzed={analyzed}, buy_signals={buy_count}")
    
    # 3. Generate predictions from real scan
    success, preds = generate_predictions_internal(market='EGX', min_score=50, clear_old=False)
    print(f"✅ AI Predictions Generator: success={success}, msg={preds}")
    
    # 4. Verify predictions in DB
    conn = sqlite3.connect(PROJECT_ROOT / 'db' / 'predictions.db')
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cnt = cur.execute("SELECT count(*) FROM predictions").fetchone()[0]
    print(f"\n📊 Total REAL Live Predictions generated in predictions.db: {cnt}")
    
    rows = cur.execute("SELECT ticker, persona, signal, entry_price, target_price, stop_loss, master_score FROM predictions LIMIT 15").fetchall()
    print("\n📋 Sample REAL Live Predictions (Pending Live Market Trades):")
    for r in rows:
        print(f"   {r['ticker']:6s} | persona={r['persona']:12s} | signal={r['signal']:4s} | entry={r['entry_price']:.2f} | target={r['target_price']:.2f} | stop={r['stop_loss']:.2f} | score={r['master_score']:.1f}")
    
    conn.close()

if __name__ == '__main__':
    main()
