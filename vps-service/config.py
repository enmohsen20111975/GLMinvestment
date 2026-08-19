#!/usr/bin/env python3
"""
Unified Configuration for All Python Services
==============================================

This module provides a SINGLE source of truth for all configuration
across Python backend services. All services should import from this file.

Usage:
    from config import DATABASE_PATH, API_PORT, get_db_connection

Environment Variables:
    DATABASE_PATH - Override default database path
    API_PORT - Override default API port (default: 8010)
    LOG_LEVEL - Set logging level (default: INFO)

Last Updated: 2025-05-15
"""

import os
import sys
from pathlib import Path

# ============================================================================
# DATABASE CONFIGURATION
# ============================================================================

def get_database_path() -> str:
    """
    Get the database path - uses stocks.db for stocks data
    
    Priority:
    1. DATABASE_PATH environment variable (if set)
    2. stocks.db in /db folder (project root)
    
    Note: All databases are in /db folder:
    - stocks.db: Stocks data (1,298 stocks across 7 markets)
    - price_history.db: Historical price data (273,750 records)
    - learned.db: ML learning data
    - auth.db: User authentication
    
    Returns:
        str: Path to the primary database
    """
    # Check environment variable first
    env_path = os.environ.get('DATABASE_PATH', '')
    if env_path:
        print(f"[CONFIG] Using DATABASE_PATH from env: {env_path}")
        return env_path
    
    # Use project root /db folder (NOT vps-service/db)
    project_root = Path(__file__).parent.parent.resolve()  # Project root (GLMinvestment)
    db_path = project_root / 'db' / 'stocks.db'
    
    # Ensure db directory exists
    db_dir = project_root / 'db'
    db_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"[CONFIG] Using primary database: {db_path}")
    return str(db_path)


def get_price_history_db_path() -> str:
    """
    Get the price history database path.
    
    Returns:
        str: Path to price_history.db
    """
    project_root = Path(__file__).parent.parent.resolve()
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
PROJECT_ROOT = Path(__file__).parent.parent.resolve()

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
def get_db_connection(db_path: str = None, writable: bool = False) -> Generator[sqlite3.Connection, None, None]:
    """
    Get a database connection with context manager.
    
    Args:
        db_path: Optional override for database path
        writable: If True, opens read-write connection with WAL mode and busy_timeout.
                  If False, uses readonly URI first, falls back to immutable=1 to bypass WAL corruption.
    
    Usage:
        with get_db_connection() as conn:  # Read-only
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM stocks")
        
        with get_db_connection(writable=True) as conn:  # Read-write with WAL
            cursor = conn.cursor()
            cursor.execute("INSERT INTO ...")
            conn.commit()
    
    Yields:
        sqlite3.Connection: Database connection
    """
    path = db_path or DATABASE_PATH

    # Ensure directory exists
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    conn = None
    if writable:
        try:
            conn = sqlite3.connect(path, timeout=30.0)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('PRAGMA synchronous=NORMAL')
            conn.execute('PRAGMA wal_autocheckpoint=1000')  # Checkpoint every 1000 pages (~4MB)
            conn.row_factory = sqlite3.Row
            conn.execute('SELECT 1').fetchone()
        except Exception:
            if conn:
                try:
                    conn.close()
                except:
                    pass
            raise
    else:
        # Try readonly URI first (respects WAL, safe for concurrent reads)
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
            # Fallback: immutable mode (bypasses WAL entirely — safe for reads)
            try:
                uri = f'file:{path}?immutable=1'
                conn = sqlite3.connect(uri, uri=True, timeout=30.0)
                conn.row_factory = sqlite3.Row
                conn.execute('SELECT 1').fetchone()
            except Exception as e_imm:
                raise
    try:
        yield conn
    finally:
        try:
            if conn:
                conn.close()
        except:
            pass


def verify_database() -> dict:
    """
    Verify database connection and return stats.
    
    Returns:
        dict: Database statistics and health info
    """
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
            
            # Get tables
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            result['tables'] = [row[0] for row in cursor.fetchall()]
            
            # Get stocks count
            cursor.execute("SELECT COUNT(*) FROM stocks")
            result['stocks_count'] = cursor.fetchone()[0]
            
            # Get history count
            cursor.execute("SELECT COUNT(*) FROM stock_price_history")
            result['history_count'] = cursor.fetchone()[0]
            
            result['connected'] = True
            
    except Exception as e:
        result['error'] = str(e)
    
    return result


def enforce_wal_mode_on_all_dbs() -> None:
    """Ensure WAL mode is enabled on all .db files in db/ directory."""
    import sqlite3
    
    if not DB_DIR.exists():
        return
    
    for db_file in DB_DIR.iterdir():
        if not db_file.is_file() or not db_file.name.endswith('.db'):
            continue
        if db_file.name.endswith('-wal') or db_file.name.endswith('-shm'):
            continue
        if any(x in db_file.name.lower() for x in ['backup', 'corrupt', 'recover', 'original', 'temp', 'tmp', 'test']):
            continue
        
        try:
            conn = sqlite3.connect(str(db_file), timeout=10)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('PRAGMA synchronous=NORMAL')
            conn.close()
        except Exception as e:
            print(f"[CONFIG] Could not set WAL mode on {db_file.name}: {e}")


def print_config():
    """Print current configuration."""
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


# Print configuration when run directly
if __name__ == '__main__':
    print_config()
    print("Database Verification:")
    stats = verify_database()
    for key, value in stats.items():
        print(f"  {key}: {value}")
