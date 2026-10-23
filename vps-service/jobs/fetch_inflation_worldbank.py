#!/usr/bin/env python3
"""
World Bank Inflation Fetcher
============================
Fetches Egyptian inflation rate (CPI annual %) from the World Bank API
(FREE, NO API KEY required) and stores it in `db/stocks.db` `macro_indicators`.

Indicator: FP.CPI.TOTL.ZG — Inflation, consumer prices (annual %)
Country:   EG (Egypt, Arab Rep.)
Range:     2020:2024 (last 5 years)

The World Bank returns data as JSON:
    [
      [metadata],
      [
        { "country": {...}, "indicator": {...}, "value": 5.7, "date": "2023", ... },
        ...
      ]
    ]

We extract the most recent non-null `value` (latest year with data) and UPSERT
it into `macro_indicators` (key-value table keyed by `indicator_name`).

Run standalone:
    python3 vps-service/jobs/fetch_inflation_worldbank.py

Only Python stdlib is used (urllib.request, json, sqlite3, datetime).
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# World Bank API — Egyptian CPI inflation (annual %).
WORLD_BANK_URL = (
    "https://api.worldbank.org/v2/country/EG/indicator/FP.CPI.TOTL.ZG"
    "?format=json&date=2020:2024&per_page=10"
)

USER_AGENT = "GLMinvestment/1.0 (Egypt inflation fetcher; +https://worldbank.org)"

# Project root (two levels up: jobs/ -> vps-service/ -> project root).
PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB_PATH = PROJECT_ROOT / "db" / "stocks.db"

# Indicator row keys in `macro_indicators`.
INDICATOR_NAME = "inflation_rate"
INDICATOR_UNIT = "%"
INDICATOR_SOURCE = "World Bank API (FP.CPI.TOTL.ZG)"

# HTTP timeout (seconds) — keep it short so the script never hangs the
# scheduler thread if the World Bank is slow / unreachable.
HTTP_TIMEOUT = 15


def _log(level: str, msg: str) -> None:
    """Tiny structured logger (stdout only, no logging module noise)."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{level}] [Inflation] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Step 1 — Fetch from World Bank
# ---------------------------------------------------------------------------

def fetch_inflation_from_worldbank() -> tuple[float | None, str | None]:
    """Hit the World Bank API and return (value, year) of the latest non-null
    inflation record for Egypt.

    Returns:
        (value, year) tuple, or (None, None) if anything went wrong.
    """
    try:
        req = Request(WORLD_BANK_URL, headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        })
        with urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        _log("WARN", f"World Bank HTTP error: {e.code} {e.reason}")
        return None, None
    except URLError as e:
        _log("WARN", f"World Bank network error: {e.reason}")
        return None, None
    except Exception as e:  # noqa: BLE001
        _log("WARN", f"World Bank fetch failed: {e}")
        return None, None

    # Parse JSON. The API returns a 2-element list:
    #   [ [metadata], [ {value, date, ...}, ... ] ]
    try:
        data = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as e:
        _log("WARN", f"World Bank JSON parse error: {e}")
        return None, None

    if not isinstance(data, list) or len(data) < 2:
        _log("WARN", f"World Bank unexpected response shape: {type(data).__name__}")
        return None, None

    records = data[1]
    if not isinstance(records, list) or not records:
        _log("WARN", "World Bank returned empty records list")
        return None, None

    # Records are sorted by date DESC by the API (newest first).
    # Walk through and pick the first one with a non-null `value`.
    for rec in records:
        if not isinstance(rec, dict):
            continue
        value = rec.get("value")
        date = rec.get("date")
        if value is None:
            continue
        try:
            value_f = float(value)
        except (TypeError, ValueError):
            continue
        if date is None:
            continue
        return value_f, str(date)

    _log("WARN", "World Bank returned records but all values were null")
    return None, None


# ---------------------------------------------------------------------------
# Step 2 — UPSERT into macro_indicators
# ---------------------------------------------------------------------------

def store_inflation_in_db(value: float, year: str) -> bool:
    """UPSERT the inflation value into `macro_indicators` table.

    The table has a UNIQUE constraint on `indicator_name`, so we use
    INSERT OR REPLACE to make re-runs idempotent (updates the same row).
    """
    if not STOCKS_DB_PATH.exists():
        _log("WARN", f"stocks.db not found at {STOCKS_DB_PATH}")
        return False

    now_iso = datetime.now().isoformat(timespec="seconds")

    conn = None
    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(STOCKS_DB_PATH), writable=True).__enter__()
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=10000;")

        # Make sure the table exists (idempotent — won't overwrite existing).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS macro_indicators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                indicator_name TEXT NOT NULL UNIQUE,
                indicator_value REAL NOT NULL DEFAULT 0,
                unit TEXT DEFAULT '%',
                source TEXT,
                recorded_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)

        conn.execute(
            """
            INSERT OR REPLACE INTO macro_indicators
                (indicator_name, indicator_value, unit, source, recorded_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?)
            """,
            (INDICATOR_NAME, float(value), INDICATOR_UNIT, INDICATOR_SOURCE,
             now_iso, now_iso),
        )
        # P4-SYNC: اكتب نفس القيمة تحت مفتاح 'egypt_inflation' كمان
        # عشان الـ Next.js route (/api/finance/real-return) اللي بيقرأ بالمفتاح ده
        # يلاقي البيانات طازجة من World Bank (مش قيمة test قديمة).
        conn.execute(
            """
            INSERT OR REPLACE INTO macro_indicators
                (indicator_name, indicator_value, unit, source, recorded_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?)
            """,
            ("egypt_inflation", float(value), INDICATOR_UNIT, INDICATOR_SOURCE,
             now_iso, now_iso),
        )
        conn.commit()
        return True
    except sqlite3.Error as e:
        _log("WARN", f"SQLite error while storing inflation: {e}")
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------

def main() -> int:
    """Run the fetch → store pipeline. Returns process exit code."""
    _log("INFO", "Fetching Egypt inflation from World Bank API...")

    value, year = fetch_inflation_from_worldbank()

    if value is None or year is None:
        # All error paths already logged inside the fetcher. Do not crash —
        # the scheduler that runs us should keep going on the next cycle.
        _log("WARN", "No inflation value fetched — leaving DB unchanged.")
        return 0  # exit 0 so cron/systemd timers don't flag this as failure

    _log("INFO", f"Latest Egypt inflation: {value:.2f}% (year {year})")

    ok = store_inflation_in_db(value, year)
    if not ok:
        _log("WARN", "Failed to store inflation in DB — see warnings above.")
        return 0

    # Human-readable success line — matches the format the orchestrator parses.
    print(
        f"[Inflation] Stored Egypt inflation rate: {value:.2f}% "
        f"(source: World Bank, year: {year})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
