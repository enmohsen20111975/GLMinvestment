#!/bin/bash
set -e
cd ~/GLMinvestment
echo "🔧 Fixing data_engine.db schema..."
sqlite3 db/data_engine.db <<'SQL'
BEGIN TRANSACTION;
CREATE TABLE stocks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT,
    price REAL,
    change_percent REAL,
    volume TEXT,
    market_cap TEXT,
    sector TEXT,
    market TEXT,
    tabs_data TEXT,
    last_update TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO stocks_new SELECT * FROM stocks;
DROP TABLE stocks;
ALTER TABLE stocks_new RENAME TO stocks;
COMMIT;
SQL
echo "✅ Schema fixed!"
