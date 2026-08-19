import sys
import os
import time
from pathlib import Path

# Add vps-service to sys.path
VPS_DIR = Path(__file__).resolve().parent.parent / 'vps-service'
sys.path.insert(0, str(VPS_DIR))

from analyzers.background_analyzer import BackgroundAnalyzer

print("🚀 Starting manual full market scan via BackgroundAnalyzer...")
start_t = time.time()

analyzer = BackgroundAnalyzer(db_path=str(Path(__file__).resolve().parent.parent / 'db' / 'stocks.db'))
# Run full analysis
analyzer._run_full_analysis()

elapsed = time.time() - start_t
print(f"✅ Full market scan completed in {elapsed:.2f} seconds!")
