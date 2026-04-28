"""
db_schema.py - SQLite database schema auto-creation for EGXPy Bridge.
Creates all required tables if they don't exist.
Designed for VPS-standalone deployment.
"""

from __future__ import annotations

import sqlite3
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Each table as a separate SQL statement (avoids executescript parsing issues)
_TABLES = [
    # -- Core tables --
    """CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT,
    name_ar TEXT,
    sector TEXT,
    industry TEXT,
    current_price REAL,
    previous_close REAL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    volume REAL,
    market_cap REAL,
    pe_ratio REAL,
    pb_ratio REAL,
    ps_ratio REAL,
    ev_to_ebitda REAL,
    dividend_yield REAL,
    eps REAL,
    roe REAL,
    roa REAL,
    debt_to_equity REAL,
    current_ratio REAL,
    book_value_per_share REAL,
    shares_outstanding REAL,
    support_level REAL,
    resistance_level REAL,
    ma_50 REAL,
    ma_200 REAL,
    rsi REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_update TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
    """CREATE TABLE IF NOT EXISTS stock_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL,
    adjusted_close REAL,
    UNIQUE(stock_id, date),
    FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE
)""",
    """CREATE TABLE IF NOT EXISTS dividends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    ex_dividend_date TEXT,
    dividend_amount REAL,
    dividend_yield REAL,
    payment_date TEXT,
    declaration_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE
)""",
    """CREATE TABLE IF NOT EXISTS stock_deep_insight_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    insights_payload TEXT,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
    # -- Market data tables --
    """CREATE TABLE IF NOT EXISTS gold_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    gold_24k REAL,
    gold_22k REAL,
    gold_21k REAL,
    gold_18k REAL,
    gold_ounce REAL,
    silver_ounce REAL,
    silver_gram REAL,
    currency TEXT DEFAULT 'EGP',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
    """CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    currency TEXT NOT NULL,
    buy_rate REAL,
    sell_rate REAL,
    mid_rate REAL,
    UNIQUE(date, currency),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
    """CREATE TABLE IF NOT EXISTS market_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT,
    name_ar TEXT,
    current_value REAL,
    previous_close REAL,
    change REAL,
    change_percent REAL,
    last_update TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
    # -- Prediction engine tables --
    """CREATE TABLE IF NOT EXISTS predictions (
    prediction_id TEXT PRIMARY KEY,
    stock_symbol TEXT NOT NULL,
    predicted_price REAL NOT NULL,
    confidence REAL,
    prediction_date TEXT NOT NULL,
    target_date TEXT NOT NULL,
    features_snapshot TEXT NOT NULL,
    model_version TEXT NOT NULL,
    sector TEXT,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TEXT NOT NULL,
    validation_date TEXT NOT NULL,
    actual_price REAL,
    error_percent REAL,
    direction_correct INTEGER,
    validated_at TEXT,
    validation_horizon TEXT
)""",
    """CREATE TABLE IF NOT EXISTS prediction_validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id TEXT NOT NULL,
    actual_price REAL,
    error_percent REAL,
    direction_correct INTEGER,
    validated_at TEXT,
    remark TEXT,
    FOREIGN KEY(prediction_id) REFERENCES predictions(prediction_id)
)""",
    """CREATE TABLE IF NOT EXISTS model_versions (
    version TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    deployed_at TEXT NOT NULL,
    status TEXT NOT NULL,
    description TEXT
)""",
    """CREATE TABLE IF NOT EXISTS model_performance_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_version TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    details TEXT,
    FOREIGN KEY(model_version) REFERENCES model_versions(version)
)""",
    # -- Recommendations table --
    """CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    action TEXT,
    confidence REAL,
    target_price REAL,
    stop_loss REAL,
    entry_price REAL,
    composite_score REAL,
    fair_value REAL,
    upside_percent REAL,
    source TEXT DEFAULT 'v2-engine',
    raw_payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
]

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)",
    "CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)",
    "CREATE INDEX IF NOT EXISTS idx_stocks_active ON stocks(is_active)",
    "CREATE INDEX IF NOT EXISTS idx_price_history_stock ON stock_price_history(stock_id)",
    "CREATE INDEX IF NOT EXISTS idx_price_history_date ON stock_price_history(date)",
    "CREATE INDEX IF NOT EXISTS idx_deep_insight_ticker ON stock_deep_insight_snapshots(ticker)",
    "CREATE INDEX IF NOT EXISTS idx_recommendations_ticker ON recommendations(ticker)",
]


def init_database(db_path: str | Path) -> bool:
    """Create all tables in the SQLite database. Returns True if successful."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        conn = sqlite3.connect(str(db_path))

        # Execute each table separately (avoids executescript issues)
        for sql in _TABLES:
            conn.execute(sql)

        # Create indexes
        for sql in _INDEXES:
            conn.execute(sql)

        # Enable WAL mode
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")

        # Insert baseline model version
        conn.execute(
            "INSERT OR IGNORE INTO model_versions VALUES ('v1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'deployed', 'Baseline initial model')"
        )
        conn.commit()
        conn.close()

        logger.info(f"Database initialized successfully at {db_path}")
        return True

    except Exception as exc:
        logger.error(f"Failed to initialize database at {db_path}: {exc}")
        return False


def ensure_database(db_path: str | Path) -> Path:
    """Ensure the database exists and return its path."""
    db_path = Path(db_path)

    if not db_path.exists():
        logger.info(f"Database not found at {db_path}, creating...")
        success = init_database(db_path)
        if not success:
            raise RuntimeError(f"Failed to create database at {db_path}")
    else:
        # Run schema update (idempotent)
        try:
            conn = sqlite3.connect(str(db_path))
            for sql in _TABLES:
                conn.execute(sql)
            for sql in _INDEXES:
                conn.execute(sql)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.commit()
            conn.close()
        except Exception as exc:
            logger.warning(f"Schema migration warning: {exc}")

    return db_path


def get_default_db_path() -> Path:
    """Get the default database path for VPS deployment."""
    import os
    env_path = os.getenv("EGXPY_LOCAL_DB_PATH", "").strip()
    if env_path:
        return Path(env_path).expanduser()
    return Path(__file__).resolve().parent / "data" / "egx_data.db"


def upsert_stock(conn: sqlite3.Connection, stock_data: dict[str, Any]) -> int:
    """Insert or update a stock record. Returns the stock ID."""
    ticker = stock_data.get("ticker", "").upper().strip()
    if not ticker:
        raise ValueError("Stock data must include a 'ticker' field")

    row = conn.execute(
        "SELECT id FROM stocks WHERE UPPER(ticker) = ?", (ticker,)
    ).fetchone()

    if row:
        stock_id = row[0]
        update_fields = []
        update_values = []
        for key, value in stock_data.items():
            if key.lower() in ("id", "ticker"):
                continue
            col = key.lower()
            update_fields.append(f"{col} = ?")
            update_values.append(value)
        update_values.append(stock_id)

        if update_fields:
            conn.execute(
                f"UPDATE stocks SET {', '.join(update_fields)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                update_values,
            )
    else:
        columns = ["ticker"]
        placeholders = ["?"]
        values = [ticker]

        for key, value in stock_data.items():
            if key.lower() in ("id", "ticker"):
                continue
            columns.append(key.lower())
            placeholders.append("?")
            values.append(value)

        conn.execute(
            f"INSERT OR IGNORE INTO stocks ({', '.join(columns)}) VALUES ({', '.join(placeholders)})",
            values,
        )
        stock_id = conn.execute("SELECT id FROM stocks WHERE UPPER(ticker) = ?", (ticker,)).fetchone()[0]

    return stock_id


def upsert_price_history(conn: sqlite3.Connection, stock_id: int, date_str: str, data: dict[str, Any]) -> None:
    """Insert or ignore a price history record."""
    conn.execute(
        """INSERT OR IGNORE INTO stock_price_history (stock_id, date, open, high, low, close, volume, adjusted_close)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            stock_id,
            date_str,
            data.get("open"),
            data.get("high"),
            data.get("low"),
            data.get("close"),
            data.get("volume"),
            data.get("adjusted_close"),
        ),
    )


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv

    env_file = Path(__file__).resolve().parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)

    db_path = get_default_db_path()
    print(f"Initializing database at: {db_path}")
    success = init_database(db_path)
    if success:
        print("Done! Database is ready.")
    else:
        print("ERROR: Failed to initialize database.")
        exit(1)
