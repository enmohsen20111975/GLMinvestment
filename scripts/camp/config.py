"""Camp configuration — single source of truth."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / 'db'
VPS = PROJECT_ROOT / 'vps-service'

import sys
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

# Test period
TRAIN_START = '2025-10-01'
TRAIN_END = '2025-12-15'
TEST_START = '2025-12-16'
TEST_END = '2026-01-31'

# Universe
MAX_TICKERS = 250

# Risk
POSITION_SIZE = 0.20  # 20% per trade
TARGET_PCT = 10.0
STOP_PCT = 7.0
HOLDING_DAYS = 30
