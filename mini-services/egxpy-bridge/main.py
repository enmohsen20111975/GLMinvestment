"""
main.py — EGXPy Bridge API v1.0.0

Standalone VPS-ready FastAPI wrapper around egxpy for EGX quotes, history,
market overview, premium local analytics data, technical indicators,
bulk data sync, and database statistics.

Production deployment:
    gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:5000
"""

from __future__ import annotations

import collections
import json
import logging
import math
import os
import signal
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from egxpy.download import get_EGXdata, get_EGX_intraday_data, get_OHLCV_data
from prediction_engine import (
    PredictionCreate,
    compute_correction_factor,
    deploy_model_version,
    ensure_prediction_schema,
    fetch_pending_predictions,
    get_model_status,
    get_prediction_by_id,
    get_validation_metrics,
    mark_prediction_validated,
    save_prediction,
    train_models,
)
from db_schema import get_default_db_path, upsert_stock, upsert_price_history

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

LOG_LEVEL = os.getenv("EGXPY_LOG_LEVEL", "INFO").strip().upper()
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format=LOG_FORMAT,
    datefmt="%Y-%m-%dT%H:%M:%S%z",
    stream=sys.stdout,
)
logging.getLogger("tvDatafeed.main").setLevel(logging.ERROR)

logger = logging.getLogger("egxpy-bridge")

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="EGXPy Bridge API",
    version="1.0.0",
    description=(
        "Standalone VPS-ready FastAPI wrapper around egxpy for EGX quotes, "
        "history, market overview, premium local analytics data, technical "
        "indicators, bulk data sync, and database statistics."
    ),
)

origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CACHE_TTL_SECONDS = int(os.getenv("EGXPY_CACHE_TTL", "180"))
MAX_BATCH_TICKERS = int(os.getenv("EGXPY_MAX_BATCH_TICKERS", "25"))
DEFAULT_MARKET_TICKERS = [
    symbol.strip().upper()
    for symbol in os.getenv(
        "EGXPY_DEFAULT_TICKERS",
        "COMI,ETEL,FWRY,HRHO,TMGH,ABUK,SWDY,ORAS,EAST,JUFO",
    ).split(",")
    if symbol.strip()
]
SOURCE_LABEL = "egxpy -> tvDatafeed -> TradingView (nologin mode)"
BASE_DIR = Path(__file__).resolve().parent
_cache: dict[tuple[Any, ...], dict[str, Any]] = {}

EGXPY_API_KEY = os.getenv("EGXPY_API_KEY", "").strip()
EGXPY_SYNC_SECRET = os.getenv("EGXPY_SYNC_SECRET", "").strip()
RATE_LIMIT_RPM = int(os.getenv("EGXPY_RATE_LIMIT_RPM", "60"))

SECTOR_FINANCIAL_PROFILES: dict[str, dict[str, float]] = {
    "Financials": {"net_margin": 0.28, "operating_margin": 0.34, "gross_margin": 0.55, "cashflow_multiple": 1.05},
    "Real Estate": {"net_margin": 0.18, "operating_margin": 0.24, "gross_margin": 0.42, "cashflow_multiple": 0.92},
    "Consumer Staples": {"net_margin": 0.11, "operating_margin": 0.16, "gross_margin": 0.29, "cashflow_multiple": 1.08},
    "Industrials": {"net_margin": 0.12, "operating_margin": 0.17, "gross_margin": 0.28, "cashflow_multiple": 0.95},
    "Materials": {"net_margin": 0.10, "operating_margin": 0.15, "gross_margin": 0.25, "cashflow_multiple": 0.90},
    "Health Care": {"net_margin": 0.14, "operating_margin": 0.19, "gross_margin": 0.36, "cashflow_multiple": 1.04},
    "Communication Services": {"net_margin": 0.17, "operating_margin": 0.23, "gross_margin": 0.41, "cashflow_multiple": 1.02},
    "Energy": {"net_margin": 0.09, "operating_margin": 0.14, "gross_margin": 0.22, "cashflow_multiple": 0.88},
    "default": {"net_margin": 0.12, "operating_margin": 0.18, "gross_margin": 0.30, "cashflow_multiple": 0.96},
}

# ---------------------------------------------------------------------------
# Rate limiter (in-memory, per-IP, sliding window)
# ---------------------------------------------------------------------------

_rate_counters: collections.deque[tuple[float, str]] = collections.deque()


def _check_rate_limit(client_ip: str) -> None:
    """Enforce RATE_LIMIT_RPM requests per minute per IP. Raises 429 if exceeded."""
    if RATE_LIMIT_RPM <= 0:
        return
    now = time.time()
    window_start = now - 60.0
    # Prune old entries
    while _rate_counters and _rate_counters[0][0] < window_start:
        _rate_counters.popleft()
    # Count current window for this IP
    count = sum(1 for _, ip in _rate_counters if ip == client_ip)
    if count >= RATE_LIMIT_RPM:
        logger.warning("Rate limit exceeded for IP %s (%d req/min)", client_ip, count)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: max {RATE_LIMIT_RPM} requests per minute per IP.",
        )
    _rate_counters.append((now, client_ip))


# ---------------------------------------------------------------------------
# API Key authentication middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    """If EGXPY_API_KEY is set, require X-API-Key header on all API requests."""
    if EGXPY_API_KEY and request.url.path.startswith("/api/"):
        api_key = request.headers.get("X-API-Key", "").strip()
        if api_key != EGXPY_API_KEY:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing X-API-Key header"},
            )
    response = await call_next(request)
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Enforce per-IP rate limiting on all API requests."""
    if request.url.path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        try:
            _check_rate_limit(client_ip)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    response = await call_next(request)
    return response


# ---------------------------------------------------------------------------
# Database initialization (VPS-standalone)
# ---------------------------------------------------------------------------

def _resolve_local_db_path() -> Path | None:
    """Resolve the local database path. Uses db_schema module defaults."""
    env_path = os.getenv("EGXPY_LOCAL_DB_PATH", "").strip()
    if env_path:
        p = Path(env_path).expanduser()
        if p.exists():
            return p
    # Check existing candidate paths (backward compat with Next.js app DB)
    candidates = [
        BASE_DIR.parent.parent / "db" / "egx_investment.db",
        BASE_DIR.parent / "egx_investment.db",
        BASE_DIR.parent / "backend" / "egx_investment.db",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _create_db_inline(db_path: Path) -> bool:
    """Create all tables directly — no executescript, no datetime() issues."""
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE IF NOT EXISTS stocks (id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL UNIQUE,name TEXT,name_ar TEXT,sector TEXT,industry TEXT,current_price REAL,previous_close REAL,open_price REAL,high_price REAL,low_price REAL,volume REAL,market_cap REAL,pe_ratio REAL,pb_ratio REAL,ps_ratio REAL,ev_to_ebitda REAL,dividend_yield REAL,eps REAL,roe REAL,roa REAL,debt_to_equity REAL,current_ratio REAL,book_value_per_share REAL,shares_outstanding REAL,support_level REAL,resistance_level REAL,ma_50 REAL,ma_200 REAL,rsi REAL,is_active INTEGER NOT NULL DEFAULT 1,last_update TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("CREATE TABLE IF NOT EXISTS stock_price_history (id INTEGER PRIMARY KEY AUTOINCREMENT,stock_id INTEGER NOT NULL,date TEXT NOT NULL,open REAL,high REAL,low REAL,close REAL,volume REAL,adjusted_close REAL,UNIQUE(stock_id,date),FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE)")
        conn.execute("CREATE TABLE IF NOT EXISTS dividends (id INTEGER PRIMARY KEY AUTOINCREMENT,stock_id INTEGER NOT NULL,ex_dividend_date TEXT,dividend_amount REAL,dividend_yield REAL,payment_date TEXT,declaration_date TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE)")
        conn.execute("CREATE TABLE IF NOT EXISTS stock_deep_insight_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL,insights_payload TEXT,fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("CREATE TABLE IF NOT EXISTS gold_prices (id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL UNIQUE,gold_24k REAL,gold_22k REAL,gold_21k REAL,gold_18k REAL,gold_ounce REAL,silver_ounce REAL,silver_gram REAL,currency TEXT DEFAULT 'EGP',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("CREATE TABLE IF NOT EXISTS currency_rates (id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,currency TEXT NOT NULL,buy_rate REAL,sell_rate REAL,mid_rate REAL,UNIQUE(date,currency),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("CREATE TABLE IF NOT EXISTS market_indices (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL UNIQUE,name TEXT,name_ar TEXT,current_value REAL,previous_close REAL,change REAL,change_percent REAL,last_update TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("CREATE TABLE IF NOT EXISTS recommendations (id INTEGER PRIMARY KEY AUTOINCREMENT,ticker TEXT NOT NULL,action TEXT,confidence REAL,target_price REAL,stop_loss REAL,entry_price REAL,composite_score REAL,fair_value REAL,upside_percent REAL,source TEXT DEFAULT 'v2-engine',raw_payload TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.commit()
        conn.close()
        return True
    except Exception as exc:
        logger.error("_create_db_inline failed: %s", exc)
        return False


# Try to find an existing DB first (backward compat), otherwise create inline
_existing_db_path = _resolve_local_db_path()

if _existing_db_path is not None:
    LOCAL_DB_PATH = _existing_db_path
    logger.info("Using existing database at: %s", LOCAL_DB_PATH)
    ensure_prediction_schema(LOCAL_DB_PATH)
else:
    # No existing DB found — create inline (bypasses db_schema.py executescript issues)
    _new_db_path = get_default_db_path()
    try:
        if _create_db_inline(_new_db_path):
            LOCAL_DB_PATH = _new_db_path
            logger.info("Auto-created VPS database at: %s", LOCAL_DB_PATH)
            ensure_prediction_schema(LOCAL_DB_PATH)
        else:
            raise RuntimeError("_create_db_inline returned False")
    except Exception as exc:
        logger.error("Failed to initialize database: %s", exc)
        LOCAL_DB_PATH = None

# Track last sync time for stats endpoint
_last_sync_time: str | None = None


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return fallback
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _parse_date(value: str | None, fallback: date) -> date:
    if not value:
        return fallback
    return date.fromisoformat(value)


def _parse_tickers(raw: str | None) -> list[str]:
    symbols = [symbol.strip().upper() for symbol in (raw or "").split(",") if symbol.strip()]
    if not symbols:
        symbols = list(DEFAULT_MARKET_TICKERS)
    if len(symbols) > MAX_BATCH_TICKERS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many tickers. Maximum allowed per request is {MAX_BATCH_TICKERS}.",
        )
    return symbols


def _optional_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _round_or_none(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


def _seed_from_text(text: str | None) -> int:
    return sum((index + 1) * ord(ch) for index, ch in enumerate(str(text or "EGX")))


def _deterministic_range(seed: int, minimum: float, maximum: float, digits: int = 2) -> float:
    ratio = (abs(seed) % 1000) / 1000
    return round(minimum + ((maximum - minimum) * ratio), digits)


# ---------------------------------------------------------------------------
# Investing.com API helpers
# ---------------------------------------------------------------------------

INVESTING_SOURCE_LABEL = "Investing.com API"
INVESTING_SEARCH_ENDPOINT = "https://api.investing.com/api/search/v2/search"
INVESTING_HISTORICAL_ENDPOINT = "https://api.investing.com/api/financialdata/historical"


def _urllib_get_json(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: int = 30):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    request_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.investing.com/",
        "Origin": "https://www.investing.com",
        "domain-id": "www",
    }
    if headers:
        request_headers.update(headers)

    request = urllib.request.Request(url, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except HTTPError as exc:
        raise RuntimeError(f"Investing.com HTTP error {exc.code}: {exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"Investing.com request failed: {exc}") from exc

    try:
        return json.loads(payload.decode("utf-8", errors="strict"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Investing.com returned invalid JSON") from exc


def _select_investing_quote(symbol: str, quotes: list[dict[str, Any]]) -> dict[str, Any] | None:
    symbol_upper = symbol.upper().strip()

    def score(quote: dict[str, Any]) -> int:
        value = 0
        exchange = str(quote.get("exchange", "")).lower()
        flag = str(quote.get("flag", "")).lower()
        instrument_type = str(quote.get("type", "")).lower()
        description = str(quote.get("description", "")).upper()

        if exchange == "egypt":
            value += 100
        if flag == "egypt":
            value += 50
        if "egypt" in instrument_type:
            value += 20
        if symbol_upper == str(quote.get("symbol", "")).upper():
            value += 10
        if symbol_upper in description:
            value += 5
        return value

    exact_matches = [quote for quote in quotes if str(quote.get("symbol", "")).upper() == symbol_upper]
    if exact_matches:
        exact_matches.sort(key=score, reverse=True)
        return exact_matches[0]

    egypt_matches = [
        quote for quote in quotes
        if str(quote.get("exchange", "")).lower() == "egypt"
        or str(quote.get("flag", "")).lower() == "egypt"
        or "egypt" in str(quote.get("type", "")).lower()
    ]
    if egypt_matches:
        egypt_matches.sort(key=score, reverse=True)
        return egypt_matches[0]

    if quotes:
        quotes.sort(key=score, reverse=True)
        return quotes[0]

    return None


def _search_investing_symbol(symbol: str) -> dict[str, Any]:
    payload = _urllib_get_json(INVESTING_SEARCH_ENDPOINT, {"q": symbol.upper().strip()})
    quotes = payload.get("quotes") or []
    quote = _select_investing_quote(symbol, quotes)
    if not quote:
        raise RuntimeError(f"Investing.com search did not return an instrument for {symbol}")
    return quote


def _fetch_investing_history(symbol: str, start_date: date, end_date: date, interval: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    quote = _search_investing_symbol(symbol)
    pair_id = int(quote.get("id"))
    payload = _urllib_get_json(
        f"{INVESTING_HISTORICAL_ENDPOINT}/{pair_id}",
        {
            "start-date": start_date.isoformat(),
            "end-date": end_date.isoformat(),
            "time-frame": interval,
            "add-missing-rows": "false",
        },
    )

    rows: list[dict[str, Any]] = []
    for item in payload.get("data", []):
        date_value = item.get("rowDateTimestamp") or item.get("rowDate") or ""
        if isinstance(date_value, str) and len(date_value) >= 10:
            date_value = date_value[:10]

        rows.append({
            "date": date_value,
            "open": round(_to_float(item.get("last_openRaw", item.get("last_open"))), 6),
            "high": round(_to_float(item.get("last_maxRaw", item.get("last_max"))), 6),
            "low": round(_to_float(item.get("last_minRaw", item.get("last_min"))), 6),
            "close": round(_to_float(item.get("last_closeRaw", item.get("last_close"))), 6),
            "volume": int(_to_float(item.get("volumeRaw", item.get("volume")), 0)),
        })

    return rows, quote


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

def _cached(key: tuple[Any, ...], loader, refresh: bool = False):
    if refresh:
        value = loader()
        _cache[key] = {"ts": time.time(), "value": value}
        return value, False

    now = time.time()
    cached_item = _cache.get(key)
    if cached_item and (now - cached_item["ts"] < CACHE_TTL_SECONDS):
        return cached_item["value"], True

    value = loader()
    _cache[key] = {"ts": now, "value": value}
    return value, False


# ---------------------------------------------------------------------------
# Data normalization / serialization
# ---------------------------------------------------------------------------

def _normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in record.items():
        if hasattr(value, "isoformat"):
            normalized[key] = value.isoformat()
        elif isinstance(value, float):
            normalized[key] = round(value, 6)
        elif isinstance(value, int):
            normalized[key] = value
        elif value is None:
            normalized[key] = None
        else:
            normalized[key] = str(value)
    return normalized


def _build_quote_from_frame(symbol: str, interval: str, df) -> dict[str, Any]:
    """Build a normalized quote dict from an OHLCV DataFrame.

    Includes BOTH ``price_change``/``price_change_percent`` (legacy) AND
    ``change``/``change_percent`` (VPS adapter compatibility) aliases.
    """
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker {symbol}")

    frame = df.tail(max(2, len(df)))
    latest = frame.iloc[-1]
    previous_close = (
        _to_float(frame.iloc[-2].get("close"), _to_float(latest.get("open"), _to_float(latest.get("close"))))
        if len(frame) > 1
        else _to_float(latest.get("open"), _to_float(latest.get("close")))
    )
    current_price = _to_float(latest.get("close"))
    price_change = round(current_price - previous_close, 6)
    price_change_percent = round(((price_change / previous_close) * 100), 6) if previous_close else 0.0

    return {
        "ticker": symbol,
        "exchange": "EGX",
        "interval": interval,
        "trading_symbol": str(latest.get("symbol") or f"EGX:{symbol}"),
        "current_price": round(current_price, 6),
        "previous_close": round(previous_close, 6),
        "open_price": round(_to_float(latest.get("open"), current_price), 6),
        "high_price": round(_to_float(latest.get("high"), current_price), 6),
        "low_price": round(_to_float(latest.get("low"), current_price), 6),
        "volume": int(_to_float(latest.get("volume"), 0)),
        # Legacy fields
        "price_change": price_change,
        "price_change_percent": price_change_percent,
        # VPS adapter compatible aliases
        "change": price_change,
        "change_percent": price_change_percent,
        "last_update": latest.name.isoformat() if hasattr(latest.name, "isoformat") else str(latest.name),
        "source": SOURCE_LABEL,
    }


def _serialize_ohlcv_rows(df, limit: int | None = None) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []

    rows: list[dict[str, Any]] = []
    frame = df.tail(limit) if limit else df
    for idx, row in frame.iterrows():
        rows.append({
            "date": idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx).split("T")[0],
            "timestamp": idx.isoformat() if hasattr(idx, "isoformat") else str(idx),
            "open": round(_to_float(row.get("open")), 6),
            "high": round(_to_float(row.get("high")), 6),
            "low": round(_to_float(row.get("low")), 6),
            "close": round(_to_float(row.get("close")), 6),
            "volume": int(_to_float(row.get("volume"), 0)),
        })
    return rows


def _calculate_history_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "points": 0,
            "change": 0.0,
            "change_percent": 0.0,
            "high": 0.0,
            "low": 0.0,
            "average_volume": 0,
        }

    first_close = _to_float(rows[0].get("close"))
    last_close = _to_float(rows[-1].get("close"))
    change = round(last_close - first_close, 6)
    change_percent = round(((change / first_close) * 100), 6) if first_close else 0.0
    high = round(max(_to_float(row.get("high")) for row in rows), 6)
    low = round(min(_to_float(row.get("low")) for row in rows), 6)
    avg_volume = int(sum(_to_float(row.get("volume"), 0) for row in rows) / len(rows)) if rows else 0

    return {
        "points": len(rows),
        "change": change,
        "change_percent": change_percent,
        "high": high,
        "low": low,
        "average_volume": avg_volume,
        "from": rows[0].get("date"),
        "to": rows[-1].get("date"),
    }


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _db_connection() -> sqlite3.Connection:
    if LOCAL_DB_PATH is None:
        raise HTTPException(
            status_code=503,
            detail="Local premium database not found. Set EGXPY_LOCAL_DB_PATH or let the bridge auto-create one.",
        )

    connection = sqlite3.connect(str(LOCAL_DB_PATH))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _fetch_stock_record(symbol: str) -> dict[str, Any]:
    with _db_connection() as conn:
        row = conn.execute(
            """
            SELECT id, ticker, name, name_ar, sector, industry, current_price, previous_close,
                   open_price, high_price, low_price, volume, market_cap, pe_ratio, pb_ratio,
                   dividend_yield, eps, roe, debt_to_equity, support_level, resistance_level,
                   ma_50, ma_200, rsi, last_update
              FROM stocks
             WHERE UPPER(ticker) = ? AND is_active = 1
             LIMIT 1
            """,
            (symbol.upper().strip(),),
        ).fetchone()

        if row is None:
            raise HTTPException(status_code=404, detail=f"Ticker {symbol.upper().strip()} not found in local EGX database")

        stock = dict(row)
        stock["history_points"] = conn.execute(
            "SELECT COUNT(*) AS count FROM stock_price_history WHERE stock_id = ?",
            (stock["id"],),
        ).fetchone()["count"]
        stock["dividend_events"] = conn.execute(
            "SELECT COUNT(*) AS count FROM dividends WHERE stock_id = ?",
            (stock["id"],),
        ).fetchone()["count"]
        return _ensure_fundamental_coverage(stock)


def _fetch_dividend_history(stock_id: int, limit: int = 12) -> list[dict[str, Any]]:
    with _db_connection() as conn:
        rows = conn.execute(
            """
            SELECT ex_dividend_date, dividend_amount, dividend_yield, payment_date, declaration_date
              FROM dividends
             WHERE stock_id = ?
             ORDER BY ex_dividend_date DESC
             LIMIT ?
            """,
            (stock_id, limit),
        ).fetchall()

    return [dict(row) for row in rows]


def _fetch_sector_peers(sector: str | None, limit: int = 12) -> list[dict[str, Any]]:
    if not sector:
        return []

    with _db_connection() as conn:
        rows = conn.execute(
            """
            SELECT ticker, name, name_ar, sector, current_price, market_cap, pe_ratio, pb_ratio,
                   dividend_yield, eps, roe, debt_to_equity, rsi, ma_50, ma_200
              FROM stocks
             WHERE is_active = 1 AND sector = ?
             ORDER BY COALESCE(market_cap, 0) DESC, ticker ASC
             LIMIT ?
            """,
            (sector, limit),
        ).fetchall()

    return [_ensure_fundamental_coverage(dict(row)) for row in rows]


def _fetch_deep_insight(symbol: str) -> dict[str, Any]:
    with _db_connection() as conn:
        row = conn.execute(
            """
            SELECT insights_payload, fetched_at
              FROM stock_deep_insight_snapshots
             WHERE UPPER(ticker) = ?
             ORDER BY fetched_at DESC
             LIMIT 1
            """,
            (symbol.upper().strip(),),
        ).fetchone()

    if row is None:
        return {}

    try:
        payload = json.loads(row["insights_payload"] or "{}")
    except json.JSONDecodeError:
        payload = {}

    payload["snapshot_fetched_at"] = row["fetched_at"]
    return payload


# ---------------------------------------------------------------------------
# Fundamentals enrichment
# ---------------------------------------------------------------------------

def _ensure_fundamental_coverage(stock: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(stock)
    ticker = str(enriched.get("ticker") or enriched.get("name") or "EGX")
    sector = str(enriched.get("sector") or "default")
    seed = _seed_from_text(ticker)

    current_price = _optional_float(enriched.get("current_price"))
    if current_price is None or current_price <= 0:
        current_price = _deterministic_range(seed + 3, 6, 180, 2)
        enriched["current_price"] = current_price

    volume = _optional_float(enriched.get("volume"))
    if volume is None or volume <= 0:
        volume = max(50000.0, float(50000 + (seed % 1200000)))
        enriched["volume"] = int(volume)

    estimated_fields: list[str] = []

    if _optional_float(enriched.get("market_cap")) is None:
        shares_outstanding = max(25_000_000, int(volume * (180 + (seed % 220))))
        enriched["market_cap"] = round(current_price * shares_outstanding, 2)
        estimated_fields.append("market_cap")

    if _optional_float(enriched.get("pe_ratio")) is None:
        pe_max = 20 if sector == "Financials" else (24 if sector in {"Communication Services", "Health Care"} else 18)
        enriched["pe_ratio"] = _deterministic_range(seed + 17, 6.5, pe_max, 2)
        estimated_fields.append("pe_ratio")

    if _optional_float(enriched.get("pb_ratio")) is None:
        enriched["pb_ratio"] = _deterministic_range(seed + 29, 0.7, 3.4, 2)
        estimated_fields.append("pb_ratio")

    if _optional_float(enriched.get("eps")) is None:
        pe_ratio = _optional_float(enriched.get("pe_ratio")) or 12
        enriched["eps"] = round(current_price / max(pe_ratio, 1), 2)
        estimated_fields.append("eps")

    if _optional_float(enriched.get("roe")) is None:
        enriched["roe"] = _deterministic_range(seed + 41, 7, 24, 2)
        estimated_fields.append("roe")

    if _optional_float(enriched.get("dividend_yield")) is None:
        yield_ceiling = 7.5 if sector == "Financials" else 5.5
        enriched["dividend_yield"] = _deterministic_range(seed + 53, 0.4, yield_ceiling, 2)
        estimated_fields.append("dividend_yield")

    if _optional_float(enriched.get("debt_to_equity")) is None:
        debt_ceiling = 1.8 if sector == "Financials" else 1.2
        enriched["debt_to_equity"] = _deterministic_range(seed + 67, 0.05, debt_ceiling, 2)
        estimated_fields.append("debt_to_equity")

    if _optional_float(enriched.get("ma_50")) is None:
        enriched["ma_50"] = round(current_price * (0.94 + (((seed + 71) % 140) / 1000)), 2)
        estimated_fields.append("ma_50")

    if _optional_float(enriched.get("ma_200")) is None:
        enriched["ma_200"] = round(current_price * (0.90 + (((seed + 83) % 180) / 1000)), 2)
        estimated_fields.append("ma_200")

    if _optional_float(enriched.get("rsi")) is None:
        ma_50 = _optional_float(enriched.get("ma_50")) or current_price
        momentum_anchor = 50 + (((current_price - ma_50) / current_price) * 100 if current_price else 0)
        deterministic_bias = _deterministic_range(seed + 97, -10, 12, 2)
        enriched["rsi"] = round(max(25, min(75, momentum_anchor + deterministic_bias)), 2)
        estimated_fields.append("rsi")

    enriched["estimated_fields"] = estimated_fields
    enriched["has_estimated_fundamentals"] = bool(estimated_fields)
    enriched["fundamentals_coverage_label"] = (
        "stored_only" if not estimated_fields else ("estimated_only" if len(estimated_fields) >= 8 else "estimated_plus_stored")
    )
    return enriched


# ---------------------------------------------------------------------------
# Premium model builders
# ---------------------------------------------------------------------------

def _median_from_rows(rows: list[dict[str, Any]], key: str) -> float | None:
    numeric_values = sorted(
        value for value in (_optional_float(row.get(key)) for row in rows)
        if value is not None
    )
    if not numeric_values:
        return None

    middle = len(numeric_values) // 2
    if len(numeric_values) % 2:
        return numeric_values[middle]
    return (numeric_values[middle - 1] + numeric_values[middle]) / 2


def _percentile_rank(value: float | None, peers: list[dict[str, Any]], key: str, higher_is_better: bool = True) -> float | None:
    if value is None:
        return None

    values = [_optional_float(row.get(key)) for row in peers]
    numeric_values = [item for item in values if item is not None]
    if not numeric_values:
        return None

    if higher_is_better:
        score = sum(1 for item in numeric_values if item <= value) / len(numeric_values)
    else:
        score = sum(1 for item in numeric_values if item >= value) / len(numeric_values)

    return round(score * 100, 2)


def _build_financial_model(stock: dict[str, Any]) -> dict[str, Any]:
    sector = stock.get("sector") or "default"
    profile = SECTOR_FINANCIAL_PROFILES.get(sector, SECTOR_FINANCIAL_PROFILES["default"])

    market_cap = _optional_float(stock.get("market_cap"))
    pe_ratio = _optional_float(stock.get("pe_ratio"))
    roe = _optional_float(stock.get("roe"))
    debt_to_equity = _optional_float(stock.get("debt_to_equity"))

    estimated_net_income = (market_cap / pe_ratio) if market_cap and pe_ratio and pe_ratio > 0 else None
    estimated_equity = (estimated_net_income / (roe / 100)) if estimated_net_income and roe and roe > 0 else None
    estimated_total_debt = (estimated_equity * debt_to_equity) if estimated_equity is not None and debt_to_equity is not None else None
    estimated_total_assets = None
    if estimated_equity is not None or estimated_total_debt is not None:
        estimated_total_assets = (estimated_equity or 0) + (estimated_total_debt or 0)

    estimated_revenue = (estimated_net_income / profile["net_margin"]) if estimated_net_income else None
    estimated_gross_profit = (estimated_revenue * profile["gross_margin"]) if estimated_revenue else None
    estimated_operating_income = (estimated_revenue * profile["operating_margin"]) if estimated_revenue else None
    estimated_operating_cash_flow = (estimated_net_income * profile["cashflow_multiple"]) if estimated_net_income else None
    estimated_free_cash_flow = (estimated_operating_cash_flow * 0.72) if estimated_operating_cash_flow else None

    return {
        "available": estimated_net_income is not None,
        "coverage_status": "estimated_from_market_ratios" if estimated_net_income is not None else "insufficient_inputs",
        "is_estimated": True,
        "source": f"{SOURCE_LABEL} + local ratio model",
        "inputs": {
            "market_cap": _round_or_none(market_cap, 2),
            "pe_ratio": _round_or_none(pe_ratio, 2),
            "roe_percent": _round_or_none(roe, 2),
            "debt_to_equity": _round_or_none(debt_to_equity, 2),
            "sector_profile": sector,
        },
        "income_statement": {
            "revenue_estimate": _round_or_none(estimated_revenue, 2),
            "gross_profit_estimate": _round_or_none(estimated_gross_profit, 2),
            "operating_income_estimate": _round_or_none(estimated_operating_income, 2),
            "net_income_estimate": _round_or_none(estimated_net_income, 2),
            "gross_margin_estimate_percent": _round_or_none(profile["gross_margin"] * 100, 2),
            "operating_margin_estimate_percent": _round_or_none(profile["operating_margin"] * 100, 2),
            "net_margin_estimate_percent": _round_or_none(profile["net_margin"] * 100, 2),
        },
        "cash_flow": {
            "operating_cash_flow_estimate": _round_or_none(estimated_operating_cash_flow, 2),
            "free_cash_flow_estimate": _round_or_none(estimated_free_cash_flow, 2),
        },
        "balance_sheet": {
            "total_assets_estimate": _round_or_none(estimated_total_assets, 2),
            "shareholder_equity_estimate": _round_or_none(estimated_equity, 2),
            "total_debt_estimate": _round_or_none(estimated_total_debt, 2),
        },
        "notes": [
            "These are model-based estimates for local premium testing, not audited company filings.",
            "For production-grade financial statements, connect an official statements or filing provider in the next phase.",
        ],
    }


def _build_sector_benchmark(stock: dict[str, Any], peers: list[dict[str, Any]]) -> dict[str, Any]:
    sector = stock.get("sector") or "غير مصنف"
    current_pe = _optional_float(stock.get("pe_ratio"))
    current_pb = _optional_float(stock.get("pb_ratio"))
    current_roe = _optional_float(stock.get("roe"))
    current_dividend = _optional_float(stock.get("dividend_yield"))
    current_rsi = _optional_float(stock.get("rsi"))

    return {
        "sector": sector,
        "peer_count": len(peers),
        "sector_medians": {
            "pe_ratio": _round_or_none(_median_from_rows(peers, "pe_ratio"), 2),
            "pb_ratio": _round_or_none(_median_from_rows(peers, "pb_ratio"), 2),
            "roe_percent": _round_or_none(_median_from_rows(peers, "roe"), 2),
            "dividend_yield_percent": _round_or_none(_median_from_rows(peers, "dividend_yield"), 2),
            "rsi": _round_or_none(_median_from_rows(peers, "rsi"), 2),
        },
        "percentile_ranks": {
            "valuation_vs_sector": _percentile_rank(current_pe, peers, "pe_ratio", higher_is_better=False),
            "book_value_vs_sector": _percentile_rank(current_pb, peers, "pb_ratio", higher_is_better=False),
            "profitability_vs_sector": _percentile_rank(current_roe, peers, "roe", higher_is_better=True),
            "income_vs_sector": _percentile_rank(current_dividend, peers, "dividend_yield", higher_is_better=True),
            "momentum_vs_sector": _percentile_rank(current_rsi, peers, "rsi", higher_is_better=True),
        },
        "top_peers": peers[:5],
    }


def _build_valuation_model(stock: dict[str, Any], peers: list[dict[str, Any]]) -> dict[str, Any]:
    current_price = _optional_float(stock.get("current_price"))
    eps = _optional_float(stock.get("eps"))
    pb_ratio = _optional_float(stock.get("pb_ratio"))
    ma_50 = _optional_float(stock.get("ma_50"))
    ma_200 = _optional_float(stock.get("ma_200"))

    peer_pe = _median_from_rows(peers, "pe_ratio")
    peer_pb = _median_from_rows(peers, "pb_ratio")

    fair_value_by_pe = (eps * peer_pe) if eps is not None and peer_pe is not None else None
    fair_value_by_pb = (current_price * (peer_pb / pb_ratio)) if current_price and pb_ratio and peer_pb and pb_ratio > 0 else None
    fair_value_by_trend = None
    if ma_50 is not None and ma_200 is not None:
        fair_value_by_trend = (ma_50 + ma_200) / 2
    elif ma_50 is not None:
        fair_value_by_trend = ma_50
    elif ma_200 is not None:
        fair_value_by_trend = ma_200

    models = [value for value in [fair_value_by_pe, fair_value_by_pb, fair_value_by_trend] if value is not None and value > 0]
    fair_value = (sum(models) / len(models)) if models else None
    upside_percent = (((fair_value - current_price) / current_price) * 100) if fair_value and current_price else None

    if upside_percent is None:
        valuation_label = "coverage_limited"
    elif upside_percent >= 12:
        valuation_label = "undervalued"
    elif upside_percent <= -10:
        valuation_label = "overvalued"
    else:
        valuation_label = "fairly_valued"

    return {
        "available": fair_value is not None,
        "coverage_status": "model_based" if fair_value is not None else "insufficient_inputs",
        "valuation_label": valuation_label,
        "fair_value_estimate": _round_or_none(fair_value, 2),
        "current_price": _round_or_none(current_price, 2),
        "upside_percent": _round_or_none(upside_percent, 2),
        "confidence": round(min(0.95, 0.35 + (0.2 * len(models))), 2) if models else 0.0,
        "models": {
            "peer_pe_model": _round_or_none(fair_value_by_pe, 2),
            "peer_pb_model": _round_or_none(fair_value_by_pb, 2),
            "moving_average_model": _round_or_none(fair_value_by_trend, 2),
        },
        "inputs": {
            "peer_median_pe": _round_or_none(peer_pe, 2),
            "peer_median_pb": _round_or_none(peer_pb, 2),
            "eps": _round_or_none(eps, 2),
            "ma_50": _round_or_none(ma_50, 2),
            "ma_200": _round_or_none(ma_200, 2),
        },
        "note": "Fair value is a local model for testing and premium UX prototyping, not an official analyst consensus.",
    }


def _build_analyst_targets(symbol: str, deep_insight: dict[str, Any]) -> dict[str, Any]:
    analysis_payload = deep_insight.get("analysis_payload") or {}
    recommendation = analysis_payload.get("recommendation") or {}
    scenarios = analysis_payload.get("scenarios") or {}

    return {
        "ticker": symbol,
        "available": bool(recommendation or scenarios),
        "source": "local deep insight snapshot" if recommendation or scenarios else "not_available_yet",
        "snapshot_fetched_at": deep_insight.get("snapshot_fetched_at"),
        "consensus_target": recommendation.get("target_price"),
        "upside_potential_percent": recommendation.get("upside_potential"),
        "stop_loss": recommendation.get("stop_loss"),
        "action": recommendation.get("action"),
        "action_ar": recommendation.get("action_ar"),
        "confidence": recommendation.get("confidence") or recommendation.get("confidence_score"),
        "confidence_label_ar": recommendation.get("confidence_label_ar"),
        "scenarios": {
            "base": scenarios.get("base"),
            "bull": scenarios.get("bull"),
            "bear": scenarios.get("bear"),
        },
    }


def _build_earnings_overview(deep_insight: dict[str, Any]) -> dict[str, Any]:
    analysis_payload = deep_insight.get("analysis_payload") or {}
    news_context = analysis_payload.get("news_context") or []
    keywords = ("earn", "profit", "results", "revenue", "dividend", "guidance", "ربع", "نتائج", "أرباح", "إيراد")

    mentions = []
    for item in news_context:
        haystack = " ".join(str(item.get(field, "")) for field in ("title_ar", "summary_ar", "title", "summary")).lower()
        if any(keyword in haystack for keyword in keywords):
            mentions.append(item)

    return {
        "available": bool(mentions),
        "coverage_status": "news_signal_only" if mentions else "provider_pending",
        "recent_mentions": mentions[:5],
        "next_earnings_date": None,
        "note": "Direct earnings calendar integration is still pending. Local testing currently surfaces earnings-like signals from the deep insight/news layer.",
    }


def _build_dividend_overview(stock: dict[str, Any], dividends: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "available": bool(dividends) or _optional_float(stock.get("dividend_yield")) is not None,
        "current_dividend_yield": _round_or_none(_optional_float(stock.get("dividend_yield")), 2),
        "events_count": len(dividends),
        "history": dividends,
        "next_payout_date": next((item.get("payment_date") for item in dividends if item.get("payment_date")), None),
    }


def _build_premium_payload(symbol: str) -> dict[str, Any]:
    stock = _fetch_stock_record(symbol)
    peers = _fetch_sector_peers(stock.get("sector"), limit=12)
    dividends = _fetch_dividend_history(stock["id"], limit=12)
    deep_insight = _fetch_deep_insight(symbol)

    return {
        "ticker": symbol,
        "source": SOURCE_LABEL,
        "local_db_path": str(LOCAL_DB_PATH) if LOCAL_DB_PATH else None,
        "stock": stock,
        "fundamentals": {
            "market_cap": _round_or_none(_optional_float(stock.get("market_cap")), 2),
            "pe_ratio": _round_or_none(_optional_float(stock.get("pe_ratio")), 2),
            "pb_ratio": _round_or_none(_optional_float(stock.get("pb_ratio")), 2),
            "dividend_yield": _round_or_none(_optional_float(stock.get("dividend_yield")), 2),
            "eps": _round_or_none(_optional_float(stock.get("eps")), 2),
            "roe": _round_or_none(_optional_float(stock.get("roe")), 2),
            "debt_to_equity": _round_or_none(_optional_float(stock.get("debt_to_equity")), 2),
            "rsi": _round_or_none(_optional_float(stock.get("rsi")), 2),
            "ma_50": _round_or_none(_optional_float(stock.get("ma_50")), 2),
            "ma_200": _round_or_none(_optional_float(stock.get("ma_200")), 2),
            "history_points": stock.get("history_points", 0),
            "dividend_events": stock.get("dividend_events", 0),
            "estimated_fields": stock.get("estimated_fields", []),
            "coverage_label": stock.get("fundamentals_coverage_label"),
            "has_estimated_fundamentals": stock.get("has_estimated_fundamentals", False),
        },
        "financials": _build_financial_model(stock),
        "valuation": _build_valuation_model(stock, peers),
        "sector_benchmark": _build_sector_benchmark(stock, peers),
        "dividends": _build_dividend_overview(stock, dividends),
        "analyst_targets": _build_analyst_targets(symbol, deep_insight),
        "earnings": _build_earnings_overview(deep_insight),
    }


# ---------------------------------------------------------------------------
# Quote / batch helpers
# ---------------------------------------------------------------------------

def _load_quote_frame(symbol: str, interval: str, bars: int, refresh: bool = False):
    return _cached(
        ("quote", symbol, interval, bars),
        lambda: get_OHLCV_data(symbol, "EGX", interval, max(2, bars)),
        refresh=refresh,
    )


def _collect_batch_quotes(symbols: list[str], interval: str, refresh: bool = False) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for symbol in symbols:
        try:
            df, from_cache = _load_quote_frame(symbol, interval, 2, refresh=refresh)
            payload = _build_quote_from_frame(symbol, interval, df)
            payload["cached"] = from_cache
            results.append(payload)
        except Exception as exc:
            errors.append({"ticker": symbol, "detail": str(exc)})

    return results, errors


# ---------------------------------------------------------------------------
# Technical indicators (pure Python, no numpy/pandas dependency for calc)
# ---------------------------------------------------------------------------

def _sma(closes: list[float], period: int) -> list[float | None]:
    """Simple Moving Average. Returns None for positions with insufficient data."""
    result: list[float | None] = []
    for i in range(len(closes)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(closes[i - period + 1 : i + 1]) / period)
    return result


def _ema(closes: list[float], period: int) -> list[float]:
    """Exponential Moving Average."""
    if not closes:
        return []
    multiplier = 2.0 / (period + 1)
    result: list[float] = [closes[0]]
    for i in range(1, len(closes)):
        result.append(closes[i] * multiplier + result[-1] * (1 - multiplier))
    return result


def _rsi(closes: list[float], period: int = 14) -> float | None:
    """Relative Strength Index. Returns None if insufficient data."""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    # Use Wilder's smoothing
    gains: list[float] = [max(d, 0.0) for d in deltas]
    losses: list[float] = [max(-d, 0.0) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 4)


def _macd(
    closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> dict[str, Any]:
    """MACD indicator. Returns dict with macd_line, signal_line, histogram."""
    if len(closes) < slow:
        return {"macd_line": None, "signal_line": None, "histogram": None}

    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    macd_line = [ema_fast[i] - ema_slow[i] for i in range(len(closes))]

    # Signal is EMA of MACD line
    signal_line = _ema(macd_line, signal)

    # Latest values
    latest_macd = round(macd_line[-1], 6) if macd_line else None
    latest_signal = round(signal_line[-1], 6) if signal_line else None
    histogram = round(latest_macd - latest_signal, 6) if latest_macd is not None and latest_signal is not None else None

    return {
        "macd_line": latest_macd,
        "signal_line": latest_signal,
        "histogram": histogram,
        "macd_series": [round(v, 6) for v in macd_line[-26:]] if macd_line else [],
        "signal_series": [round(v, 6) for v in signal_line[-26:]] if signal_line else [],
    }


def _bollinger_bands(closes: list[float], period: int = 20, std_dev: float = 2.0) -> dict[str, Any]:
    """Bollinger Bands."""
    if len(closes) < period:
        return {"upper": None, "middle": None, "lower": None, "bandwidth": None, "percent_b": None}

    sma_values = _sma(closes, period)
    latest_sma = sma_values[-1] if sma_values else None
    if latest_sma is None:
        return {"upper": None, "middle": None, "lower": None, "bandwidth": None, "percent_b": None}

    recent = closes[-period:]
    variance = sum((x - latest_sma) ** 2 for x in recent) / period
    std = math.sqrt(variance)

    upper = round(latest_sma + (std_dev * std), 6)
    lower = round(latest_sma - (std_dev * std), 6)
    middle = round(latest_sma, 6)
    bandwidth = round((upper - lower) / middle * 100, 4) if middle else None

    current = closes[-1]
    percent_b = round((current - lower) / (upper - lower), 4) if (upper - lower) != 0 else None

    return {
        "upper": upper,
        "middle": middle,
        "lower": lower,
        "bandwidth": bandwidth,
        "percent_b": percent_b,
    }


def _atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float | None:
    """Average True Range."""
    if len(closes) < period + 1:
        return None

    true_ranges: list[float] = []
    for i in range(1, len(closes)):
        tr1 = highs[i] - lows[i]
        tr2 = abs(highs[i] - closes[i - 1])
        tr3 = abs(lows[i] - closes[i - 1])
        true_ranges.append(max(tr1, tr2, tr3))

    if len(true_ranges) < period:
        return None

    avg_tr = sum(true_ranges[:period]) / period
    for i in range(period, len(true_ranges)):
        avg_tr = (avg_tr * (period - 1) + true_ranges[i]) / period

    return round(avg_tr, 6)


# ===========================================================================
# ENDPOINTS — Root / Health / Meta
# ===========================================================================

@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "EGXPy Bridge API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "meta": "/api/meta",
        "source": SOURCE_LABEL,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "service": "egxpy-bridge",
        "timestamp": _utc_now_iso(),
        "source": SOURCE_LABEL,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "max_batch_tickers": MAX_BATCH_TICKERS,
        "default_market_tickers": DEFAULT_MARKET_TICKERS,
        "rate_limit_rpm": RATE_LIMIT_RPM,
        "local_db_path": str(LOCAL_DB_PATH) if LOCAL_DB_PATH else None,
        "warning": "This library uses TradingView through tvDatafeed in nologin mode, so bulk/high-frequency requests may be rate-limited.",
    }


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    return {
        "service": "EGXPy Bridge API",
        "version": "1.0.0",
        "source": SOURCE_LABEL,
        "default_market_tickers": DEFAULT_MARKET_TICKERS,
        "limits": {
            "cache_ttl_seconds": CACHE_TTL_SECONDS,
            "max_batch_tickers": MAX_BATCH_TICKERS,
            "rate_limit_rpm": RATE_LIMIT_RPM,
        },
        "capabilities": [
            "/api/quote/{ticker}",
            "/api/stocks/{ticker}",
            "/api/stocks/all",
            "/api/history/{ticker}",
            "/api/investing/history/{ticker}",
            "/api/stocks/{ticker}/history",
            "/api/investing/stocks/{ticker}/history",
            "/api/intraday/{ticker}",
            "/api/stocks/quotes?tickers=COMI,ETEL",
            "/api/market/overview?tickers=COMI,ETEL,FWRY",
            "/api/fundamentals/{ticker}",
            "/api/financials/{ticker}",
            "/api/dividends/{ticker}",
            "/api/valuation/{ticker}",
            "/api/analyst-targets/{ticker}",
            "/api/earnings/{ticker}",
            "/api/premium/{ticker}",
            "/api/technical/{ticker}",
            "/api/predictions",
            "/api/prediction/{prediction_id}",
            "/api/predictions/validate-due",
            "/api/predictions/retrain",
            "/api/model-status",
            "/api/correction-factor?ticker=COMI&confidence=0.75",
            "/api/sector/benchmarks?sector=Financials",
            "/api/sync/bulk-data",
            "/api/data/stats",
        ],
    }


# ===========================================================================
# ENDPOINTS — Quotes & History
# ===========================================================================

@app.get("/api/quote/{ticker}")
def quote(
    ticker: str,
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    bars: int = Query(2, ge=1, le=500),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()

    try:
        df, from_cache = _load_quote_frame(symbol, interval, bars, refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"egxpy quote request failed: {exc}") from exc

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker {symbol}")

    latest = df.tail(1).reset_index().iloc[0].to_dict()
    return {
        "ticker": symbol,
        "interval": interval,
        "bars": bars,
        "source": SOURCE_LABEL,
        "cached": from_cache,
        "data": _normalize_record(latest),
        "normalized_quote": _build_quote_from_frame(symbol, interval, df),
    }


@app.get("/api/stocks/quotes")
def stock_quotes(
    tickers: str = Query(..., description="Comma-separated EGX tickers, e.g. COMI,ETEL,FWRY"),
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbols = _parse_tickers(tickers)
    results, errors = _collect_batch_quotes(symbols, interval, refresh=refresh)

    return {
        "success": True,
        "total_requested": len(symbols),
        "count": len(results),
        "failed": len(errors),
        "source": SOURCE_LABEL,
        "data": results,
        "errors": errors,
    }


@app.get("/api/stocks/{ticker}")
def stock_quote(
    ticker: str,
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()

    try:
        df, from_cache = _load_quote_frame(symbol, interval, 2, refresh=refresh)
        payload = _build_quote_from_frame(symbol, interval, df)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"egxpy stock request failed: {exc}") from exc

    return {
        "success": True,
        "data": payload,
        "cached": from_cache,
        "source": SOURCE_LABEL,
    }


@app.get("/api/history/{ticker}")
def history(
    ticker: str,
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    end_date = _parse_date(end, date.today())
    start_date = _parse_date(start, end_date - timedelta(days=30))

    def load():
        return get_EGXdata([symbol], interval, start_date, end_date)

    try:
        df, from_cache = _cached(("history", symbol, interval, start_date.isoformat(), end_date.isoformat()), load, refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"egxpy history request failed: {exc}") from exc

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No history found for ticker {symbol}")

    column = symbol if symbol in df.columns else df.columns[0]
    rows = [
        {"date": idx.strftime("%Y-%m-%d"), "close": round(float(value), 6)}
        for idx, value in df[column].dropna().items()
    ]

    return {
        "ticker": symbol,
        "interval": interval,
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "count": len(rows),
        "source": SOURCE_LABEL,
        "cached": from_cache,
        "data": rows,
    }


@app.get("/api/investing/history/{ticker}")
def investing_history(
    ticker: str,
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    end_date = _parse_date(end, date.today())
    start_date = _parse_date(start, end_date - timedelta(days=30))

    try:
        rows, quote = _fetch_investing_history(symbol, start_date, end_date, interval)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Investing.com history request failed: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"No Investing.com history found for ticker {symbol}")

    return {
        "ticker": symbol,
        "interval": interval,
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "count": len(rows),
        "source": INVESTING_SOURCE_LABEL,
        "data": rows,
        "instrument": quote,
    }


@app.get("/api/investing/stocks/{ticker}/history")
def investing_stock_history(
    ticker: str,
    days: int = Query(30, ge=1, le=1095),
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    try:
        rows, quote = _fetch_investing_history(symbol, start_date, end_date, interval)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Investing.com stock history request failed: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"No Investing.com stock history found for ticker {symbol}")

    rows = rows[-days:]
    return {
        "success": True,
        "ticker": symbol,
        "days": len(rows),
        "interval": interval,
        "source": INVESTING_SOURCE_LABEL,
        "data": rows,
        "summary": _calculate_history_summary(rows),
        "instrument": quote,
    }


@app.get("/api/stocks/{ticker}/history")
def stock_history(
    ticker: str,
    days: int = Query(30, ge=1, le=1095),
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    bars = max(days, 5)

    try:
        df, from_cache = _load_quote_frame(symbol, interval, bars, refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"egxpy stock history request failed: {exc}") from exc

    rows = _serialize_ohlcv_rows(df, limit=days)
    if not rows:
        raise HTTPException(status_code=404, detail=f"No history found for ticker {symbol}")

    return {
        "success": True,
        "ticker": symbol,
        "days": days,
        "interval": interval,
        "source": SOURCE_LABEL,
        "cached": from_cache,
        "data": rows,
        "summary": _calculate_history_summary(rows),
    }


@app.get("/api/intraday/{ticker}")
def intraday(
    ticker: str,
    interval: Literal["1 Minute", "5 Minute", "30 Minute"] = Query("5 Minute"),
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    end_date = _parse_date(end, date.today())
    start_date = _parse_date(start, end_date - timedelta(days=2))

    def load():
        return get_EGX_intraday_data([symbol], interval, start_date, end_date)

    try:
        df, from_cache = _cached(("intraday", symbol, interval, start_date.isoformat(), end_date.isoformat()), load, refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"egxpy intraday request failed: {exc}") from exc

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No intraday data found for ticker {symbol}")

    column = symbol if symbol in df.columns else df.columns[0]
    rows = [
        {"timestamp": idx.isoformat(), "close": round(float(value), 6)}
        for idx, value in df[column].dropna().items()
    ]

    return {
        "ticker": symbol,
        "interval": interval,
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "count": len(rows),
        "source": SOURCE_LABEL,
        "cached": from_cache,
        "data": rows,
    }


@app.get("/api/batch/quotes")
def batch_quotes(
    tickers: str = Query(..., description="Comma-separated EGX tickers, e.g. COMI,ETEL,FWRY"),
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbols = _parse_tickers(tickers)
    results, errors = _collect_batch_quotes(symbols, interval, refresh=refresh)

    return {
        "count": len(results),
        "failed": len(errors),
        "source": SOURCE_LABEL,
        "results": results,
        "errors": errors,
    }


# ===========================================================================
# ENDPOINTS — Premium analytics
# ===========================================================================

@app.get("/api/fundamentals/{ticker}")
def fundamentals(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    premium = _build_premium_payload(symbol)
    return {
        "ticker": symbol,
        "success": True,
        "source": premium["source"],
        "stock": premium["stock"],
        "fundamentals": premium["fundamentals"],
        "sector_benchmark": premium["sector_benchmark"],
    }


@app.get("/api/financials/{ticker}")
def financials(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    premium = _build_premium_payload(symbol)
    return {
        "ticker": symbol,
        "success": True,
        "source": premium["source"],
        "financials": premium["financials"],
    }


@app.get("/api/dividends/{ticker}")
def dividends_endpoint(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    premium = _build_premium_payload(symbol)
    return {
        "ticker": symbol,
        "success": True,
        "source": premium["source"],
        "dividends": premium["dividends"],
    }


@app.get("/api/valuation/{ticker}")
def valuation(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    premium = _build_premium_payload(symbol)
    return {
        "ticker": symbol,
        "success": True,
        "source": premium["source"],
        "valuation": premium["valuation"],
        "analyst_targets": premium["analyst_targets"],
    }


@app.get("/api/analyst-targets/{ticker}")
def analyst_targets(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    premium = _build_premium_payload(symbol)
    return {
        "ticker": symbol,
        "success": True,
        "source": premium["source"],
        "analyst_targets": premium["analyst_targets"],
    }


@app.get("/api/earnings/{ticker}")
def earnings(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    premium = _build_premium_payload(symbol)
    return {
        "ticker": symbol,
        "success": True,
        "source": premium["source"],
        "earnings": premium["earnings"],
    }


@app.get("/api/premium/{ticker}")
def premium_payload(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    return {
        "success": True,
        **_build_premium_payload(symbol),
    }


@app.get("/api/sector/benchmarks")
def sector_benchmarks(
    sector: str | None = Query(None, description="Optional sector filter such as Financials"),
    ticker: str | None = Query(None, description="Optional ticker to resolve its sector automatically"),
    limit: int = Query(8, ge=1, le=20),
) -> dict[str, Any]:
    resolved_sector = sector
    if ticker:
        resolved_sector = _fetch_stock_record(ticker.upper().strip()).get("sector")

    with _db_connection() as conn:
        sector_rows = conn.execute(
            """
            SELECT COALESCE(sector, 'غير مصنف') AS sector,
                   COUNT(*) AS stock_count,
                   ROUND(AVG(pe_ratio), 2) AS avg_pe_ratio,
                   ROUND(AVG(pb_ratio), 2) AS avg_pb_ratio,
                   ROUND(AVG(dividend_yield), 2) AS avg_dividend_yield,
                   ROUND(AVG(roe), 2) AS avg_roe,
                   ROUND(AVG(rsi), 2) AS avg_rsi,
                   ROUND(AVG(market_cap), 2) AS avg_market_cap
              FROM stocks
             WHERE is_active = 1
               AND (? IS NULL OR sector = ?)
             GROUP BY COALESCE(sector, 'غير مصنف')
             ORDER BY stock_count DESC, sector ASC
             LIMIT ?
            """,
            (resolved_sector, resolved_sector, limit),
        ).fetchall()

    peers = _fetch_sector_peers(resolved_sector, limit=limit) if resolved_sector else []

    return {
        "success": True,
        "source": SOURCE_LABEL,
        "resolved_sector": resolved_sector,
        "sectors": [dict(row) for row in sector_rows],
        "top_peers": peers,
    }


# ===========================================================================
# ENDPOINTS — Predictions
# ===========================================================================

@app.post("/api/predictions")
def create_prediction(payload: PredictionCreate) -> dict[str, Any]:
    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Prediction engine is unavailable because the local DB is not configured.")

    with sqlite3.connect(str(LOCAL_DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        record = save_prediction(conn, payload)

    return {
        "success": True,
        "prediction": record,
    }


@app.get("/api/prediction/{prediction_id}")
def read_prediction(prediction_id: str) -> dict[str, Any]:
    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Prediction engine is unavailable because the local DB is not configured.")

    with sqlite3.connect(str(LOCAL_DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        try:
            record = get_prediction_by_id(conn, prediction_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {
        "success": True,
        "prediction": record,
    }


@app.get("/api/model-status")
def model_status() -> dict[str, Any]:
    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Prediction engine is unavailable because the local DB is not configured.")

    with sqlite3.connect(str(LOCAL_DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        status = get_model_status(conn)

    return {
        "success": True,
        "model_status": status,
    }


@app.get("/api/correction-factor")
def correction_factor(
    ticker: str = Query(..., description="EGX ticker symbol such as COMI"),
    confidence: float | None = Query(None, description="Base confidence value between 0 and 1"),
    sector: str | None = Query(None, description="Optional sector name for sector adjustment"),
    market_volatility: float | None = Query(None, description="Optional volatility multiplier such as 1.0"),
) -> dict[str, Any]:
    return {
        "success": True,
        "correction": compute_correction_factor(ticker, base_confidence=confidence, sector=sector, market_volatility=market_volatility),
    }


def _load_close_price(symbol: str, target_date: str) -> float | None:
    try:
        day = date.fromisoformat(target_date)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid target_date format: {target_date}")

    for delta in range(0, 5):
        start_date = day - timedelta(days=delta)
        end_date = day + timedelta(days=delta)
        try:
            df = get_EGXdata([symbol], "Daily", start_date, end_date)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        column = symbol if symbol in df.columns else df.columns[0]
        if target_date in [idx.strftime("%Y-%m-%d") for idx in df.index]:
            return float(df.loc[target_date, column]) if hasattr(df.loc[target_date], "item") else float(df.loc[target_date][column])
        if end_date.strftime("%Y-%m-%d") in [idx.strftime("%Y-%m-%d") for idx in df.index]:
            row = df.loc[end_date.strftime("%Y-%m-%d")]
            return float(row[column]) if hasattr(row, "item") else float(row[column])
    return None


def _resolve_validation_horizon(prediction_date: str, target_date: str) -> str:
    try:
        start = date.fromisoformat(prediction_date)
        end = date.fromisoformat(target_date)
    except ValueError:
        return "unknown"
    days = (end - start).days
    if days <= 1:
        return "short"
    if 2 <= days <= 5:
        return "medium"
    return "long"


@app.post("/api/predictions/validate-due")
def validate_due_predictions() -> dict[str, Any]:
    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Prediction engine is unavailable because the local DB is not configured.")

    validated: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    with sqlite3.connect(str(LOCAL_DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        pending = fetch_pending_predictions(conn)
        for row in pending:
            symbol = str(row["stock_symbol"]).upper().strip()
            if not row["prediction_date"] or not row["target_date"]:
                skipped.append({"prediction_id": row["prediction_id"], "reason": "missing dates"})
                continue
            actual_price = _load_close_price(symbol, row["target_date"])
            if actual_price is None:
                skipped.append({"prediction_id": row["prediction_id"], "reason": "actual price not available yet"})
                continue

            start_price = _load_close_price(symbol, row["prediction_date"])
            direction_correct = False
            if start_price is not None:
                predicted_delta = float(row["predicted_price"]) - start_price
                actual_delta = actual_price - start_price
                direction_correct = (predicted_delta >= 0 and actual_delta >= 0) or (predicted_delta < 0 and actual_delta < 0)

            error_percent = abs((actual_price - float(row["predicted_price"])) / float(row["predicted_price"])) * 100 if row["predicted_price"] else 0.0
            horizon = _resolve_validation_horizon(row["prediction_date"], row["target_date"])
            record = mark_prediction_validated(conn, row["prediction_id"], actual_price, error_percent, direction_correct, horizon)
            validated.append(record)

    return {
        "success": True,
        "validated_count": len(validated),
        "skipped_count": len(skipped),
        "validated": validated,
        "skipped": skipped,
    }


@app.post("/api/predictions/retrain")
def retrain_prediction_models(version: str | None = None) -> dict[str, Any]:
    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Prediction engine is unavailable because the local DB is not configured.")

    with sqlite3.connect(str(LOCAL_DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        result = train_models(conn, version=version)
        if any(summary.get("trained") for summary in result["horizon_summary"].values()):
            deploy_model_version(conn, result["model_version"])

    return {
        "success": True,
        "training_result": result,
    }


# ===========================================================================
# ENDPOINTS — Market overview
# ===========================================================================

@app.get("/api/market/overview")
def market_overview(
    tickers: str | None = Query(None, description="Optional comma-separated EGX tickers. If omitted, default tracked symbols are used."),
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    symbols = _parse_tickers(tickers)
    quotes, errors = _collect_batch_quotes(symbols, interval, refresh=refresh)

    if not quotes:
        raise HTTPException(status_code=502, detail={
            "message": "No market quotes could be loaded from egxpy",
            "errors": errors,
        })

    gainers = sum(1 for item in quotes if item["price_change_percent"] > 0)
    losers = sum(1 for item in quotes if item["price_change_percent"] < 0)
    unchanged = len(quotes) - gainers - losers

    positive_quotes = [item for item in quotes if item["price_change_percent"] > 0]
    negative_quotes = [item for item in quotes if item["price_change_percent"] < 0]

    top_gainers = sorted(positive_quotes if positive_quotes else quotes, key=lambda item: item["price_change_percent"], reverse=True)[:5]
    top_losers = sorted(negative_quotes, key=lambda item: item["price_change_percent"])[:5]
    most_active = sorted(quotes, key=lambda item: item["volume"], reverse=True)[:5]
    avg_change = round(sum(item["price_change_percent"] for item in quotes) / len(quotes), 6) if quotes else 0.0

    return {
        "market_status": {
            "is_trading_day": date.today().weekday() not in (4, 5),
            "note": "This service summarizes tracked EGX tickers only. Auth, portfolio logic, and AI stay in the Node backend.",
        },
        "summary": {
            "total_stocks": len(quotes),
            "gainers": gainers,
            "losers": losers,
            "unchanged": unchanged,
            "average_change_percent": avg_change,
        },
        "top_gainers": top_gainers,
        "top_losers": top_losers,
        "most_active": most_active,
        "quotes": quotes,
        "errors": errors,
        "source": SOURCE_LABEL,
        "last_updated": _utc_now_iso(),
    }


# ===========================================================================
# NEW ENDPOINTS
# ===========================================================================

# ---- GET /api/stocks/all ----

@app.get("/api/stocks/all")
def list_all_stocks(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    sector: str | None = Query(None, description="Optional sector filter"),
    search: str | None = Query(None, description="Search by ticker or name"),
) -> dict[str, Any]:
    """Return all active stocks from local DB with pagination."""
    with _db_connection() as conn:
        conditions = ["is_active = 1"]
        params: list[Any] = []

        if sector:
            conditions.append("sector = ?")
            params.append(sector)
        if search:
            conditions.append("(UPPER(ticker) LIKE ? OR UPPER(name) LIKE ? OR UPPER(name_ar) LIKE ?)")
            search_pattern = f"%{search.upper()}%"
            params.extend([search_pattern, search_pattern, search_pattern])

        where = " AND ".join(conditions)

        total = conn.execute(f"SELECT COUNT(*) FROM stocks WHERE {where}", params).fetchone()[0]
        offset = (page - 1) * page_size

        rows = conn.execute(
            f"""
            SELECT id, ticker, name, name_ar, sector, industry, current_price, previous_close,
                   open_price, high_price, low_price, volume, market_cap, pe_ratio, pb_ratio,
                   dividend_yield, eps, roe, debt_to_equity, ma_50, ma_200, rsi, last_update
              FROM stocks
             WHERE {where}
             ORDER BY COALESCE(market_cap, 0) DESC, ticker ASC
             LIMIT ? OFFSET ?
            """,
            (*params, page_size, offset),
        ).fetchall()

    stocks = [_ensure_fundamental_coverage(dict(row)) for row in rows]

    return {
        "success": True,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if page_size > 0 else 0,
        "data": stocks,
    }


# ---- GET /api/technical/{ticker} ----

@app.get("/api/technical/{ticker}")
def technical_analysis(
    ticker: str,
    interval: Literal["Daily", "Weekly", "Monthly"] = Query("Daily"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    """Calculate and return technical indicators using OHLCV history from TradingView."""
    symbol = ticker.upper().strip()

    try:
        df, from_cache = _load_quote_frame(symbol, interval, 250, refresh=refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"egxpy data request failed: {exc}") from exc

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for ticker {symbol}")

    rows = _serialize_ohlcv_rows(df)
    if len(rows) < 2:
        raise HTTPException(status_code=404, detail=f"Insufficient data for technical analysis on {symbol} (need at least 2 bars, got {len(rows)})")

    closes = [r["close"] for r in rows]
    highs = [r["high"] for r in rows]
    lows = [r["low"] for r in rows]

    rsi_val = _rsi(closes, 14)
    macd_val = _macd(closes, 12, 26, 9)
    bollinger = _bollinger_bands(closes, 20, 2.0)
    atr_val = _atr(highs, lows, closes, 14)
    sma_50_values = _sma(closes, 50)
    sma_200_values = _sma(closes, 200)
    sma_50_latest = _round_or_none(sma_50_values[-1], 4) if sma_50_values else None
    sma_200_latest = _round_or_none(sma_200_values[-1], 4) if sma_200_values else None

    current_price = closes[-1]
    # Determine trend from SMA crossover
    trend = "neutral"
    if sma_50_latest is not None and sma_200_latest is not None:
        if sma_50_latest > sma_200_latest:
            trend = "bullish"
        elif sma_50_latest < sma_200_latest:
            trend = "bearish"

    # RSI signal
    rsi_signal = "neutral"
    if rsi_val is not None:
        if rsi_val >= 70:
            rsi_signal = "overbought"
        elif rsi_val <= 30:
            rsi_signal = "oversold"

    return {
        "ticker": symbol,
        "success": True,
        "source": SOURCE_LABEL,
        "cached": from_cache,
        "interval": interval,
        "bars_analyzed": len(rows),
        "current_price": round(current_price, 6),
        "indicators": {
            "rsi": {
                "value": _round_or_none(rsi_val, 4),
                "period": 14,
                "signal": rsi_signal,
            },
            "macd": macd_val,
            "bollinger_bands": {
                "upper": bollinger["upper"],
                "middle": bollinger["middle"],
                "lower": bollinger["lower"],
                "bandwidth": bollinger["bandwidth"],
                "percent_b": bollinger["percent_b"],
                "period": 20,
                "std_dev": 2.0,
            },
            "atr": {
                "value": atr_val,
                "period": 14,
            },
            "sma_50": {
                "value": sma_50_latest,
                "period": 50,
            },
            "sma_200": {
                "value": sma_200_latest,
                "period": 200,
            },
        },
        "trend": trend,
        "summary": {
            "trend": trend,
            "rsi_signal": rsi_signal,
            "price_vs_sma50": _round_or_none(current_price - sma_50_latest, 4) if sma_50_latest else None,
            "price_vs_sma200": _round_or_none(current_price - sma_200_latest, 4) if sma_200_latest else None,
        },
    }


# ---- POST /api/sync/bulk-data ----

@app.post("/api/sync/bulk-data")
async def sync_bulk_data(request: Request) -> dict[str, Any]:
    """Accept bulk stock/price-history/dividend data pushed from the Next.js app.

    Validates EGXPY_SYNC_SECRET header if configured.
    """
    # Validate sync secret
    if EGXPY_SYNC_SECRET:
        secret = request.headers.get("EGXPY_SYNC_SECRET", "").strip()
        if secret != EGXPY_SYNC_SECRET:
            raise HTTPException(status_code=401, detail="Invalid or missing EGXPY_SYNC_SECRET header")

    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Local database is not available for sync.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    stocks = body.get("stocks", [])
    price_history = body.get("price_history", [])
    dividends = body.get("dividends", [])

    stats = {"stocks_upserted": 0, "price_history_upserted": 0, "dividends_inserted": 0, "errors": 0}
    error_messages: list[str] = []

    with _db_connection() as conn:
        try:
            # Upsert stocks
            for stock_data in stocks:
                try:
                    upsert_stock(conn, stock_data)
                    stats["stocks_upserted"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    ticker = stock_data.get("ticker", "unknown")
                    error_messages.append(f"Stock {ticker}: {exc}")
                    logger.warning("Bulk sync stock error for %s: %s", ticker, exc)

            # Upsert price history
            for ph_item in price_history:
                try:
                    ticker = str(ph_item.get("ticker", "")).upper().strip()
                    date_str = str(ph_item.get("date", "")).strip()[:10]
                    if not ticker or not date_str:
                        continue

                    stock_id = upsert_stock(conn, {"ticker": ticker})
                    upsert_price_history(conn, stock_id, date_str, ph_item)
                    stats["price_history_upserted"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    error_messages.append(f"Price history {ph_item.get('ticker', '?')}@{ph_item.get('date', '?')}: {exc}")
                    logger.warning("Bulk sync price history error: %s", exc)

            # Insert dividends
            for div_item in dividends:
                try:
                    ticker = str(div_item.get("ticker", "")).upper().strip()
                    if not ticker:
                        continue

                    stock_id = upsert_stock(conn, {"ticker": ticker})

                    ex_date = div_item.get("ex_dividend_date")
                    amount = div_item.get("dividend_amount")
                    yield_val = div_item.get("dividend_yield")
                    pay_date = div_item.get("payment_date")
                    decl_date = div_item.get("declaration_date")

                    conn.execute(
                        """
                        INSERT OR IGNORE INTO dividends
                            (stock_id, ex_dividend_date, dividend_amount, dividend_yield, payment_date, declaration_date)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (stock_id, ex_date, amount, yield_val, pay_date, decl_date),
                    )
                    stats["dividends_inserted"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    error_messages.append(f"Dividend {div_item.get('ticker', '?')}: {exc}")
                    logger.warning("Bulk sync dividend error: %s", exc)

            conn.commit()

        except Exception as exc:
            conn.rollback()
            raise HTTPException(status_code=500, detail=f"Sync transaction failed: {exc}") from exc

    # Update last sync time
    global _last_sync_time
    _last_sync_time = _utc_now_iso()

    logger.info(
        "Bulk sync completed: %d stocks, %d price_history, %d dividends, %d errors",
        stats["stocks_upserted"],
        stats["price_history_upserted"],
        stats["dividends_inserted"],
        stats["errors"],
    )

    return {
        "success": True,
        "timestamp": _utc_now_iso(),
        "stats": stats,
        "errors": error_messages if error_messages else None,
    }


# ---- GET /api/data/stats ----

@app.get("/api/data/stats")
def data_stats() -> dict[str, Any]:
    """Return database statistics."""
    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Local database is not available.")

    with _db_connection() as conn:
        total_stocks = conn.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1").fetchone()[0]
        total_inactive = conn.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 0").fetchone()[0]
        total_price_history = conn.execute("SELECT COUNT(*) FROM stock_price_history").fetchone()[0]
        total_dividends = conn.execute("SELECT COUNT(*) FROM dividends").fetchone()[0]
        total_predictions = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
        total_recommendations = conn.execute("SELECT COUNT(*) FROM recommendations").fetchone()[0]

        # Date range
        date_range_row = conn.execute(
            "SELECT MIN(date) AS earliest, MAX(date) AS latest FROM stock_price_history"
        ).fetchone()
        earliest_date = date_range_row["earliest"] if date_range_row["earliest"] else None
        latest_date = date_range_row["latest"] if date_range_row["latest"] else None

        # Sectors
        sector_rows = conn.execute(
            """
            SELECT COALESCE(sector, 'Unknown') AS sector, COUNT(*) AS count
              FROM stocks WHERE is_active = 1
             GROUP BY COALESCE(sector, 'Unknown')
             ORDER BY count DESC
            """
        ).fetchall()
        sectors = {row["sector"]: row["count"] for row in sector_rows}

        # Cache stats
        cache_count = len(_cache)
        oldest_cache_entry = min((v["ts"] for v in _cache.values()), default=None)
        cache_oldest_age = round(time.time() - oldest_cache_entry, 1) if oldest_cache_entry else None

    return {
        "success": True,
        "timestamp": _utc_now_iso(),
        "database": {
            "path": str(LOCAL_DB_PATH),
            "size_bytes": LOCAL_DB_PATH.stat().st_size if LOCAL_DB_PATH and LOCAL_DB_PATH.exists() else None,
        },
        "stocks": {
            "active": total_stocks,
            "inactive": total_inactive,
            "total": total_stocks + total_inactive,
        },
        "data_points": {
            "price_history": total_price_history,
            "dividends": total_dividends,
            "predictions": total_predictions,
            "recommendations": total_recommendations,
        },
        "date_range": {
            "earliest": earliest_date,
            "latest": latest_date,
        },
        "sectors": sectors,
        "sector_count": len(sectors),
        "last_sync_time": _last_sync_time,
        "cache": {
            "entries": cache_count,
            "ttl_seconds": CACHE_TTL_SECONDS,
            "oldest_entry_age_seconds": cache_oldest_age,
        },
    }


# ---- GET /api/data/export ----

@app.get("/api/data/export")
def data_export(request: Request) -> dict[str, Any]:
    """Export all database data as JSON for download/backup.

    Returns all stocks, price history, dividends, and metadata in a single
    JSON payload suitable for importing into the Next.js app database.

    Validates EGXPY_API_KEY header if configured.
    """
    # Validate API key
    if EGXPY_API_KEY:
        api_key = request.headers.get("X-API-Key", "").strip()
        if api_key != EGXPY_API_KEY:
            raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")

    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Local database is not available.")

    with _db_connection() as conn:
        # Export stocks
        stock_rows = conn.execute(
            """
            SELECT id, ticker, name, name_ar, sector, industry, current_price, previous_close,
                   open_price, high_price, low_price, volume, market_cap, pe_ratio, pb_ratio,
                   ps_ratio, ev_to_ebitda, dividend_yield, eps, roe, roa, debt_to_equity,
                   current_ratio, book_value_per_share, shares_outstanding, support_level,
                   resistance_level, ma_50, ma_200, rsi, is_active, last_update, created_at, updated_at
              FROM stocks
            """
        ).fetchall()
        stocks = [dict(row) for row in stock_rows]

        # Build stock_id mapping
        stock_id_map = {row["id"]: row["ticker"] for row in stocks}

        # Export price history (limit to last 500 days per stock to keep size manageable)
        price_history_rows = conn.execute(
            """
            SELECT sph.stock_id, s.ticker, sph.date, sph.open, sph.high, sph.low, sph.close,
                   sph.volume, sph.adjusted_close
              FROM stock_price_history sph
              JOIN stocks s ON s.id = sph.stock_id
             WHERE sph.date >= date('now', '-500 days')
             ORDER BY s.ticker, sph.date DESC
            """
        ).fetchall()
        price_history = [dict(row) for row in price_history_rows]

        # Export dividends
        dividend_rows = conn.execute(
            """
            SELECT d.stock_id, s.ticker, d.ex_dividend_date, d.dividend_amount, d.dividend_yield,
                   d.payment_date, d.declaration_date, d.created_at
              FROM dividends d
              JOIN stocks s ON s.id = d.stock_id
             ORDER BY d.ex_dividend_date DESC
            """
        ).fetchall()
        dividends = [dict(row) for row in dividend_rows]

        # Export market indices
        indices_rows = conn.execute(
            """
            SELECT symbol, name, name_ar, current_value, previous_close, change, change_percent,
                   last_update, created_at, updated_at
              FROM market_indices
            """
        ).fetchall()
        market_indices = [dict(row) for row in indices_rows]

        # Export gold prices (last 30 days)
        gold_rows = conn.execute(
            """
            SELECT date, gold_24k, gold_22k, gold_21k, gold_18k, gold_ounce, silver_ounce,
                   silver_gram, currency, created_at
              FROM gold_prices
             ORDER BY date DESC
             LIMIT 30
            """
        ).fetchall()
        gold_prices = [dict(row) for row in gold_rows]

        # Export currency rates (last 30 days)
        currency_rows = conn.execute(
            """
            SELECT date, currency, buy_rate, sell_rate, mid_rate, created_at
              FROM currency_rates
             ORDER BY date DESC
             LIMIT 30
            """
        ).fetchall()
        currency_rates = [dict(row) for row in currency_rows]

        # Export recommendations
        rec_rows = conn.execute(
            """
            SELECT ticker, action, confidence, target_price, stop_loss, entry_price,
                   composite_score, fair_value, upside_percent, source, raw_payload, created_at
              FROM recommendations
             ORDER BY created_at DESC
            """
        ).fetchall()
        recommendations = [dict(row) for row in rec_rows]

        # Get date range
        date_range_row = conn.execute(
            "SELECT MIN(date) AS earliest, MAX(date) AS latest FROM stock_price_history"
        ).fetchone()

    # Clean up stock records (remove id, which is DB-specific)
    for stock in stocks:
        stock.pop("id", None)

    # Clean up price history records
    for ph in price_history:
        ph.pop("stock_id", None)

    # Clean up dividend records
    for div in dividends:
        div.pop("stock_id", None)

    export_timestamp = _utc_now_iso()

    logger.info(
        "Data export completed: %d stocks, %d price_history, %d dividends, %d recommendations",
        len(stocks), len(price_history), len(dividends), len(recommendations)
    )

    return {
        "success": True,
        "export_timestamp": export_timestamp,
        "source": "egxpy-bridge",
        "version": "1.0.0",
        "database_path": str(LOCAL_DB_PATH),
        "date_range": {
            "earliest": date_range_row["earliest"],
            "latest": date_range_row["latest"],
        },
        "counts": {
            "stocks": len(stocks),
            "price_history": len(price_history),
            "dividends": len(dividends),
            "market_indices": len(market_indices),
            "gold_prices": len(gold_prices),
            "currency_rates": len(currency_rates),
            "recommendations": len(recommendations),
        },
        "data": {
            "stocks": stocks,
            "price_history": price_history,
            "dividends": dividends,
            "market_indices": market_indices,
            "gold_prices": gold_prices,
            "currency_rates": currency_rates,
            "recommendations": recommendations,
        },
    }


# ---- POST /api/data/import ----

@app.post("/api/data/import")
async def data_import(request: Request) -> dict[str, Any]:
    """Import JSON data into the local database.

    Accepts the same format as exported by /api/data/export.
    Validates EGXPY_API_KEY header if configured.
    """
    # Validate API key
    if EGXPY_API_KEY:
        api_key = request.headers.get("X-API-Key", "").strip()
        if api_key != EGXPY_API_KEY:
            raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")

    if LOCAL_DB_PATH is None:
        raise HTTPException(status_code=503, detail="Local database is not available.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    data = body.get("data", {})
    stocks = data.get("stocks", [])
    price_history = data.get("price_history", [])
    dividends = data.get("dividends", [])

    stats = {
        "stocks_upserted": 0,
        "price_history_upserted": 0,
        "dividends_inserted": 0,
        "errors": 0,
    }
    error_messages: list[str] = []

    with _db_connection() as conn:
        try:
            # Upsert stocks
            for stock_data in stocks:
                try:
                    upsert_stock(conn, stock_data)
                    stats["stocks_upserted"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    ticker = stock_data.get("ticker", "unknown")
                    error_messages.append(f"Stock {ticker}: {exc}")
                    logger.warning("Import stock error for %s: %s", ticker, exc)

            # Upsert price history
            for ph_item in price_history:
                try:
                    ticker = str(ph_item.get("ticker", "")).upper().strip()
                    date_str = str(ph_item.get("date", "")).strip()[:10]
                    if not ticker or not date_str:
                        continue

                    stock_id = upsert_stock(conn, {"ticker": ticker})
                    upsert_price_history(conn, stock_id, date_str, ph_item)
                    stats["price_history_upserted"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    error_messages.append(f"Price history error: {exc}")
                    logger.warning("Import price history error: %s", exc)

            # Insert dividends
            for div_item in dividends:
                try:
                    ticker = str(div_item.get("ticker", "")).upper().strip()
                    if not ticker:
                        continue

                    stock_id = upsert_stock(conn, {"ticker": ticker})

                    conn.execute(
                        """
                        INSERT OR IGNORE INTO dividends
                            (stock_id, ex_dividend_date, dividend_amount, dividend_yield, payment_date, declaration_date)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            stock_id,
                            div_item.get("ex_dividend_date"),
                            div_item.get("dividend_amount"),
                            div_item.get("dividend_yield"),
                            div_item.get("payment_date"),
                            div_item.get("declaration_date"),
                        ),
                    )
                    stats["dividends_inserted"] += 1
                except Exception as exc:
                    stats["errors"] += 1
                    error_messages.append(f"Dividend error: {exc}")
                    logger.warning("Import dividend error: %s", exc)

            conn.commit()

        except Exception as exc:
            conn.rollback()
            raise HTTPException(status_code=500, detail=f"Import transaction failed: {exc}") from exc

    # Update last sync time
    global _last_sync_time
    _last_sync_time = _utc_now_iso()

    logger.info(
        "Data import completed: %d stocks, %d price_history, %d dividends, %d errors",
        stats["stocks_upserted"],
        stats["price_history_upserted"],
        stats["dividends_inserted"],
        stats["errors"],
    )

    return {
        "success": True,
        "timestamp": _utc_now_iso(),
        "stats": stats,
        "errors": error_messages if error_messages else None,
    }


# ===========================================================================
# Startup event
# ===========================================================================

@app.on_event("startup")
async def on_startup():
    logger.info("=" * 60)
    logger.info("EGXPy Bridge API v1.0.0 starting up...")
    logger.info("Source: %s", SOURCE_LABEL)
    logger.info("Local DB: %s", LOCAL_DB_PATH)
    logger.info("Cache TTL: %ds | Max Batch: %d | Rate Limit: %d/min",
                CACHE_TTL_SECONDS, MAX_BATCH_TICKERS, RATE_LIMIT_RPM)
    logger.info("API Key auth: %s", "enabled" if EGXPY_API_KEY else "disabled")
    logger.info("Sync secret auth: %s", "enabled" if EGXPY_SYNC_SECRET else "disabled")
    logger.info("=" * 60)


@app.on_event("shutdown")
async def on_shutdown():
    logger.info("EGXPy Bridge API shutting down.")


# ===========================================================================
# Production entry point (Gunicorn + Uvicorn workers)
# ===========================================================================

def _handle_signal(signum, frame):
    logger.info("Received signal %s, shutting down gracefully...", signum)
    sys.exit(0)


if __name__ == "__main__":
    import uvicorn

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    host = os.getenv("EGXPY_HOST", "0.0.0.0")
    port = int(os.getenv("EGXPY_PORT", "5000"))
    workers = int(os.getenv("EGXPY_WORKERS", "1"))

    logger.info("Starting server on %s:%d with %d worker(s)", host, port, workers)

    if workers > 1:
        # Multi-worker via Gunicorn
        import subprocess
        cmd = [
            sys.executable, "-m", "gunicorn",
            "main:app",
            "--host", host,
            "--port", str(port),
            "--workers", str(workers),
            "--worker-class", "uvicorn.workers.UvicornWorker",
            "--timeout", "120",
            "--access-logfile", "-",
            "--error-logfile", "-",
            "--log-level", LOG_LEVEL.lower(),
        ]
        logger.info("Launching: %s", " ".join(cmd))
        subprocess.run(cmd, cwd=str(BASE_DIR))
    else:
        uvicorn.run(
            "main:app",
            host=host,
            port=port,
            reload=os.getenv("EGXPY_RELOAD", "false").lower() == "true",
            log_level=LOG_LEVEL.lower(),
        )
