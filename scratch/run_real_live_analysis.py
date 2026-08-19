#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
========================================================================
  🔴 REAL LIVE ORCHESTRATOR ANALYSIS RUNNER (0 SYNTHETIC / 100% LIVE)
  Runs the actual production Background Analyzer engine on active EGX stocks
========================================================================
"""
import sys
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

from analyzers.background_analyzer import get_background_analyzer

def run_real_analysis():
    print("🚀 Triggering REAL Live Background Analyzer Engine on active stocks...")
    analyzer = get_background_analyzer()
    
    # Run analyzer once synchronously
    res = analyzer.run_single_pass()
    print("✅ Live Pass Result:", res)
    
    conn = sqlite3.connect(PROJECT_ROOT / 'db' / 'predictions.db')
    cur = conn.cursor()
    cnt = cur.execute("SELECT count(*) FROM predictions").fetchone()[0]
    print(f"📊 Total REAL Live Predictions generated in DB: {cnt}")
    conn.close()

if __name__ == '__main__':
    run_real_analysis()
