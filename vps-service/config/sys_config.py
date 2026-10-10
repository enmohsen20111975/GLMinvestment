#!/usr/bin/env python3
"""
Unified Configuration for All Python Services
==============================================
This module provides a SINGLE source of truth for all configuration
across Python backend services.
"""

import os
import sys
from pathlib import Path

# ============================================================================
# DATABASE CONFIGURATION
# ============================================================================

def get_database_path() -> str:
    """
    Get the database path — uses stocks.db for market data (DEFAULT).
    
    NOTE: unified_learning_routes.py uses predictions.db directly (not via config).
    DATABASE_PATH here is used by ~20 modules for market data (stocks, prices, etc.)
    — it MUST point to stocks.db (or market.db after migration).
    
    PHASE-3-DB-UNIFY (2026-08-29): REVERTED from predictions.db back to stocks.db.
    Changing DATABASE_PATH to predictions.db broke 20 modules that read market data.
    The learning engine now uses PREDICTIONS_DB directly (not DATABASE_PATH).
    """
    # Check environment variable first
    env_path = os.environ.get('DATABASE_PATH', '')
    if env_path:
        print(f"[CONFIG] Using DATABASE_PATH from env: {env_path}")
        return env_path

    # Use project root /db folder
    project_root = Path(__file__).parent.parent.parent.resolve()  # Project root (GLMinvestment)
    db_path = project_root / 'db' / 'stocks.db'

    # Ensure db directory exists
    db_dir = project_root / 'db'
    db_dir.mkdir(parents=True, exist_ok=True)

    print(f"[CONFIG] Using primary database: {db_path}")
    return str(db_path)


def get_price_history_db_path() -> str:
    project_root = Path(__file__).parent.parent.parent.resolve()
    return str(project_root / 'db' / 'price_history.db')


# Primary database path - stocks.db for stocks data
DATABASE_PATH = get_database_path()
# Price history database path
PRICE_HISTORY_DB_PATH = get_price_history_db_path()

# ============================================================================
# API CONFIGURATION
# ============================================================================

API_PORT = int(os.environ.get('PORT', 8010))
API_HOST = os.environ.get('API_HOST', '0.0.0.0')
DEBUG_MODE = os.environ.get('DEBUG', 'false').lower() == 'true'

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

# ============================================================================
# VPS-SPECIFIC PATHS
# ============================================================================

# Project root directory
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()

# Database directory
DB_DIR = PROJECT_ROOT / 'db'

# Logs directory
LOGS_DIR = PROJECT_ROOT / 'logs'

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

import sqlite3
from contextlib import contextmanager
from typing import Generator


@contextmanager
def get_db_connection(db_path: str = None) -> Generator[sqlite3.Connection, None, None]:
    path = db_path or DATABASE_PATH
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    conn = None
    try:
        uri = f'file:{path}?mode=ro'
        conn = sqlite3.connect(uri, uri=True, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA busy_timeout=30000')
        conn.execute('SELECT 1').fetchone()
    except Exception:
        try:
            if conn:
                conn.close()
        except:
            pass
        uri = f'file:{path}?immutable=1'
        conn = sqlite3.connect(uri, uri=True, timeout=30.0)
        conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        try:
            conn.close()
        except:
            pass


def verify_database() -> dict:
    result = {
        'path': DATABASE_PATH,
        'exists': os.path.exists(DATABASE_PATH),
        'connected': False,
        'stocks_count': 0,
        'history_count': 0,
        'tables': []
    }
    
    if not result['exists']:
        result['error'] = 'Database file not found'
        return result
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            result['tables'] = [row[0] for row in cursor.fetchall()]
            
            cursor.execute("SELECT COUNT(*) FROM stocks")
            result['stocks_count'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM stock_price_history")
            result['history_count'] = cursor.fetchone()[0]
            
            result['connected'] = True
            
    except Exception as e:
        result['error'] = str(e)
    
    return result


def print_config():
    print("\n" + "=" * 60)
    print("PYTHON BACKEND CONFIGURATION")
    print("=" * 60)
    print(f"Database Path:  {DATABASE_PATH}")
    print(f"Database Exists: {os.path.exists(DATABASE_PATH)}")
    print(f"API Port:       {API_PORT}")
    print(f"API Host:       {API_HOST}")
    print(f"Debug Mode:     {DEBUG_MODE}")
    print(f"Project Root:   {PROJECT_ROOT}")
    print("=" * 60 + "\n")


if __name__ == '__main__':
    print_config()
    print("Database Verification:")
    stats = verify_database()
    for key, value in stats.items():
        print(f"  {key}: {value}")
