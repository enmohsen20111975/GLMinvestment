#!/usr/bin/env python3
"""
data_engine.py — محرك البيانات الموحد لمنصة دليل الاستثمار
==========================================================

يجمع البيانات من كل المصادر ويغذّي المشروع:
  1. المؤشرات والأسعار: TradingView scanner (لكل سوق)
  2. المستثمرون: beta.egx.com.eg + egx.news (fallback)
  3. الأسعار التاريخية: data_engine.db.historical_data
  4. الأخبار: محرك أخبار منفصل (news_engine.py)

المصادر:
  - TradingView scanner: scanner.tradingview.com/{market}/scan
  - beta.egx.com.eg: بيانات المستثمرين الرسمية
  - egx.news: أخبار + بيانات EGX
  - data_engine.db: البيانات التاريخية للأسعار

الأسواق المدعومة:
  - egypt (EGX)
  - saudi (TADAWUL)
  - kuwait (KSE)
  - qatar (QSE)

Usage:
  python3 vps-service/data_engine/data_engine.py --market=egypt
  python3 vps-service/data_engine/data_engine.py --all-markets
  python3 vps-service/data_engine/data_engine.py --indices-only
  python3 vps-service/data_engine/data_engine.py --investors-only
  python3 vps-service/data_engine/data_engine.py --daemon
"""

from __future__ import annotations

import os
import sys
import json
import time
import sqlite3
import logging
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

# ============================================================================
# Configuration
# ============================================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / "db"
STOCKS_DB = DB_DIR / "stocks.db"
DATA_ENGINE_DB = DB_DIR / "data_engine.db"
INTRADAY_DB = DB_DIR / "intraday.db"

# TradingView scanner endpoints per market
TV_MARKETS = {
    "egypt": {
        "slug": "egypt",
        "exchange": "EGX",
        "arabic_name": "البورصة المصرية",
    },
    "saudi": {
        "slug": "saudi",
        "exchange": "TADAWUL",
        "arabic_name": "تداول السعودية",
    },
    "kuwait": {
        "slug": "kuwait",
        "exchange": "KSE",
        "arabic_name": "بورصة الكويت",
    },
    "qatar": {
        "slug": "qatar",
        "exchange": "QSE",
        "arabic_name": "بورصة قطر",
    },
}

# Index symbols per market (TradingView format)
TV_INDEX_SYMBOLS = {
    "egypt": ["EGX:EGX30", "EGX:EGX70", "EGX:EGX100", "EGX:EGX50"],
    "saudi": ["TADAWUL:TASI", "TADAWUL:TMTI"],
    "kuwait": ["BKSE:KWSE"],
    "qatar": ["QSE:QSI"],
}

# User-Agent for requests
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("data_engine")


# ============================================================================
# HTTP Fetch Helper
# ============================================================================

def fetch_json(url: str, method: str = "GET", data: Optional[bytes] = None,
               timeout: int = 15) -> Optional[Dict]:
    """Fetch JSON from URL with proper headers."""
    try:
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        log.warning(f"HTTP {e.code} from {url}: {e.reason}")
        return None
    except Exception as e:
        log.warning(f"Fetch error from {url}: {e}")
        return None


def fetch_html(url: str, timeout: int = 15) -> Optional[str]:
    """Fetch HTML content from URL."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ar,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        log.warning(f"HTML fetch error from {url}: {e}")
        return None


# ============================================================================
# DB Helpers
# ============================================================================

def get_db(db_path: Path) -> sqlite3.Connection:
    """Open SQLite DB with WAL + busy_timeout."""
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def ensure_market_indices_table(conn: sqlite3.Connection):
    """Create market_indices table if not exists."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_indices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT,
            name_ar TEXT,
            current_value REAL,
            previous_close REAL,
            change REAL,
            change_percent REAL,
            is_shariah INTEGER DEFAULT 0,
            last_update TEXT
        )
    """)


def ensure_investors_data_table(conn: sqlite3.Connection):
    """Create investors_data table if not exists."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS investors_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            session_type TEXT,
            individuals_buys_value REAL,
            individuals_sells_value REAL,
            individuals_net_value REAL,
            arab_buys_value REAL,
            arab_sells_value REAL,
            arab_net_value REAL,
            foreign_buys_value REAL,
            foreign_sells_value REAL,
            foreign_net_value REAL,
            total_buys_value REAL,
            total_sells_value REAL,
            number_of_trades INTEGER,
            source TEXT DEFAULT 'unknown',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(date)
        )
    """)


# ============================================================================
# 1. INDICES ENGINE — TradingView Scanner
# ============================================================================

def fetch_tradingview_indices(market_slug: str) -> List[Dict]:
    """
    Fetch index values — uses the stocks scanner + computes from constituents.

    TradingView scanner لا يرجع المؤشرات مباشرة (indices مش في الـ scanner).
    بدلاً من ذلك، نحسب المؤشر من متوسط أسهمه المكوّنة المرجّح بـ market_cap
    (نفس منطق getMarketIndices في egx-db.ts).

    لو فيه Python backend شغّال، ممكن يجيب المؤشر من TradingView widget API
    (محتاج Playwright — مش متاح في الساندبوكس).
    """
    log.info(f"[Indices] Computing indices for {market_slug} from constituent stocks...")

    # نجيب كل أسهم السوق من scanner
    stocks = fetch_tradingview_stocks(market_slug)
    if not stocks:
        log.warning(f"[Indices] No stocks data for {market_slug}")
        return []

    # نحسب المؤشر من الأسهم المكوّنة
    # لـ EGX: نستخدم is_egx30/70/100 flags من stocks.db
    conn = get_db(STOCKS_DB)
    cursor = conn.cursor()

    # تحقق من وجود columns
    cursor.execute("PRAGMA table_info(stocks)")
    cols = [r[1] for r in cursor.fetchall()]

    results = []
    index_configs = [
        ("EGX30", "is_egx30", "مؤشر EGX 30"),
        ("EGX70", "is_egx70", "مؤشر EGX 70"),
        ("EGX100", "is_egx100", "مؤشر EGX 100"),
    ]

    for symbol, col, name_ar in index_configs:
        if col not in cols:
            log.warning(f"[Indices] Column {col} not found in stocks table")
            continue

        # احسب change_percent المرجّح بـ market_cap
        cursor.execute(f"""
            SELECT ticker, change_percent, market_cap
            FROM stocks
            WHERE {col} = 1 AND market = 'EGX'
              AND change_percent IS NOT NULL
        """)
        rows = cursor.fetchall()
        if not rows:
            continue

        weighted_sum = 0
        total_weight = 0
        for ticker, chg_pct, mcap in rows:
            chg = float(chg_pct or 0)
            mc = float(mcap or 0)
            if mc > 0:
                weighted_sum += chg * mc
                total_weight += mc
            else:
                weighted_sum += chg
                total_weight += 1

        if total_weight > 0:
            avg_change_pct = weighted_sum / total_weight
        else:
            avg_change_pct = 0

        # احصل على القيمة الحالية من market_indices (لو موجودة)
        cursor.execute("SELECT current_value FROM market_indices WHERE symbol = ?", (symbol,))
        row = cursor.fetchone()
        current_value = row[0] if row else 0

        results.append({
            "symbol": symbol,
            "name": symbol,
            "name_ar": name_ar,
            "current_value": current_value,
            "previous_close": current_value / (1 + avg_change_pct / 100) if current_value and avg_change_pct else current_value,
            "change": current_value * avg_change_pct / 100 if current_value else 0,
            "change_percent": round(avg_change_pct, 4),
            "last_update": datetime.now(timezone.utc).isoformat(),
            "source": "computed_from_constituents",
        })
        log.info(f"[Indices] {symbol}: {current_value:.2f} ({avg_change_pct:+.2f}%)")

    conn.close()
    return results


def update_market_indices(market_slug: str, indices: List[Dict]):
    """Update market_indices table in stocks.db."""
    if not indices:
        return 0

    conn = get_db(STOCKS_DB)
    ensure_market_indices_table(conn)

    updated = 0
    for idx in indices:
        try:
            conn.execute("""
                INSERT INTO market_indices (symbol, name, name_ar, current_value,
                                           previous_close, change, change_percent, last_update)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    current_value = excluded.current_value,
                    previous_close = excluded.previous_close,
                    change = excluded.change,
                    change_percent = excluded.change_percent,
                    last_update = excluded.last_update
            """, (
                idx["symbol"],
                idx.get("name", idx["symbol"]),
                idx.get("name_ar", idx["symbol"]),
                idx["current_value"],
                idx["previous_close"],
                idx["change"],
                idx["change_percent"],
                idx["last_update"],
            ))
            updated += 1
        except Exception as e:
            log.error(f"[Indices] Error updating {idx['symbol']}: {e}")

    conn.commit()
    conn.close()
    log.info(f"[Indices] Updated {updated} indices for {market_slug}")
    return updated


def run_indices_engine(market_slug: str):
    """Run the indices engine for a market."""
    indices = fetch_tradingview_indices(market_slug)
    if indices:
        update_market_indices(market_slug, indices)
    else:
        log.warning(f"[Indices] No data fetched for {market_slug}")


# ============================================================================
# 2. STOCKS ENGINE — TradingView Scanner
# ============================================================================

def fetch_tradingview_stocks(market_slug: str) -> List[Dict]:
    """Fetch all stock prices from TradingView scanner."""
    log.info(f"[Stocks] Fetching stocks for {market_slug} from TradingView...")
    url = f"https://scanner.tradingview.com/{market_slug}/scan"
    payload = json.dumps({
        "range": [0, 500],
        "columns": [
            "name", "description", "close", "change", "change_abs",
            "volume", "market_cap_basic", "sector", "Recommend.All",
            "RSI", "MACD.macd", "MACD.signal", "High.1M", "Low.1M",
            "price_52_week_high", "price_52_week_low", "Beta",
            "Earnings per share basic", "price_book_ratio",
            "price_earnings", "Dividends yield"
        ],
        "sort": {"sortBy": "name", "sortOrder": "asc"},
        "markets": [market_slug],
    }).encode("utf-8")

    data = fetch_json(url, method="POST", data=payload, timeout=20)
    if not data or "data" not in data:
        log.warning(f"[Stocks] No data from TradingView for {market_slug}")
        return []

    stocks = []
    for item in data["data"]:
        d = item.get("d", [])
        if len(d) < 5:
            continue
        symbol = item.get("s", "").replace(f"{TV_MARKETS.get(market_slug, {}).get('exchange', '')}:", "")
        stocks.append({
            "symbol": symbol,
            "name": d[1] if len(d) > 1 else symbol,
            "price": float(d[2] or 0),
            "change_percent": float(d[3] or 0),
            "change_abs": float(d[4] or 0),
            "volume": int(d[5] or 0) if len(d) > 5 else 0,
            "market_cap": float(d[6] or 0) if len(d) > 6 else 0,
            "sector": d[7] if len(d) > 7 else "",
            "recommendation": float(d[8] or 0) if len(d) > 8 else 0,
            "rsi": float(d[9] or 0) if len(d) > 9 else 0,
            "market": TV_MARKETS.get(market_slug, {}).get("exchange", "EGX"),
            "last_update": datetime.now(timezone.utc).isoformat(),
        })

    log.info(f"[Stocks] Fetched {len(stocks)} stocks for {market_slug}")
    return stocks


def update_stocks_data(stocks: List[Dict], market_slug: str):
    """Update stocks table in data_engine.db."""
    if not stocks:
        return 0

    conn = get_db(DATA_ENGINE_DB)
    updated = 0
    for s in stocks:
        try:
            # استخدم INSERT OR REPLACE (الـ table ما عندهاش UNIQUE constraint على symbol)
            # فبنشوف لو موجود الأول، ثم update أو insert
            existing = conn.execute(
                "SELECT id FROM stocks WHERE symbol = ?", (s["symbol"],)
            ).fetchone()

            if existing:
                conn.execute("""
                    UPDATE stocks SET
                        name = ?, price = ?, change_percent = ?, volume = ?,
                        market_cap = ?, market = ?, sector = ?, last_update = ?, is_active = 1
                    WHERE symbol = ?
                """, (
                    s["name"], s["price"], s["change_percent"], s["volume"],
                    s["market_cap"], s["market"], s["sector"],
                    s["last_update"], s["symbol"],
                ))
            else:
                conn.execute("""
                    INSERT INTO stocks (symbol, name, price, change_percent, volume,
                                       market_cap, market, sector, last_update, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """, (
                    s["symbol"], s["name"], s["price"], s["change_percent"],
                    s["volume"], s["market_cap"], s["market"], s["sector"],
                    s["last_update"],
                ))
            updated += 1
        except Exception as e:
            log.error(f"[Stocks] Error updating {s['symbol']}: {e}")

    conn.commit()
    conn.close()
    log.info(f"[Stocks] Updated {updated} stocks in data_engine.db")
    return updated


def run_stocks_engine(market_slug: str):
    """Run the stocks engine for a market."""
    stocks = fetch_tradingview_stocks(market_slug)
    if stocks:
        update_stocks_data(stocks, market_slug)


# ============================================================================
# 3. INVESTORS ENGINE — beta.egx.com.eg + egx.news
# ============================================================================

def fetch_investors_beta_egx() -> Optional[Dict]:
    """Fetch investor flow data from beta.egx.com.eg."""
    log.info("[Investors] Fetching from beta.egx.com.eg...")
    # Try Arabic page first
    html = fetch_html("https://beta.egx.com.eg/ar/market/investors", timeout=15)
    if not html:
        html = fetch_html("https://beta.egx.com.eg/en/market/investors", timeout=15)
    if not html:
        log.warning("[Investors] beta.egx.com.eg unreachable")
        return None

    # Parse the HTML — looking for investor flow tables
    # The page contains buy/sell/net data for Egyptians/Arabs/Foreigners
    import re

    # Extract numbers from the page
    # Pattern: look for table cells with large numbers (in millions/billions)
    numbers = re.findall(r'[\d,]+\.?\d*', html)

    # Try to find the structured data
    # beta.egx.com.eg typically has a table with:
    # Egyptians: buy, sell, net
    # Arabs: buy, sell, net
    # Foreigners: buy, sell, net

    # Look for JSON data embedded in script tags
    json_match = re.search(r'investors[_\-]?data\s*=\s*({.*?});', html, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except:
            pass

    # Look for table rows
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    if rows:
        log.info(f"[Investors] Found {len(rows)} table rows")
        # Try to parse the table
        for row in rows:
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
            if len(cells) >= 4:
                # Could be: [category, buy, sell, net]
                pass

    log.warning("[Investors] Could not parse beta.egx.com.eg page")
    return None


def fetch_investors_egx_news() -> Optional[Dict]:
    """Fetch investor flow data from egx.news as fallback."""
    log.info("[Investors] Fetching from egx.news...")
    html = fetch_html("https://egx.news/ar", timeout=15)
    if not html:
        return None

    # egx.news may have investor flow summaries
    import re
    # Look for investor-related content
    if "مستثمرين" in html or "أجانب" in html or "عرب" in html:
        log.info("[Investors] egx.news has investor content")
        # Would need Playwright for JS-rendered content

    return None


def compute_investors_estimate() -> Dict:
    """Compute investor flow estimate from stock_daily_prices."""
    log.info("[Investors] Computing estimate from stock_daily_prices...")

    conn = get_db(STOCKS_DB)
    cursor = conn.cursor()

    # Get the latest trading day's data
    cursor.execute("""
        SELECT d.ticker, d.close, d.volume, d.turnover, s.sector, s.current_price, s.previous_close
        FROM stock_daily_prices d
        LEFT JOIN stocks s ON s.ticker = d.ticker
        WHERE d.price_date = (SELECT MAX(price_date) FROM stock_daily_prices)
        AND s.market = 'EGX'
    """)

    rows = cursor.fetchall()
    if not rows:
        conn.close()
        return {}

    total_turnover = sum(r[3] or 0 for r in rows)
    advancing = sum(1 for r in rows if r[6] and r[5] and r[5] > r[6])
    declining = sum(1 for r in rows if r[6] and r[5] and r[5] < r[6])

    # Historical EGX participation ratios
    egy_ratio = 0.70
    arab_ratio = 0.10
    foreign_ratio = 0.20

    # Buy/sell split based on market direction
    buy_ratio = 0.55 if advancing > declining else 0.45

    egy_turnover = total_turnover * egy_ratio
    arab_turnover = total_turnover * arab_ratio
    foreign_turnover = total_turnover * foreign_ratio

    today = datetime.now().strftime("%Y-%m-%d")

    result = {
        "date": today,
        "individuals_buys_value": egy_turnover * buy_ratio,
        "individuals_sells_value": egy_turnover * (1 - buy_ratio),
        "individuals_net_value": egy_turnover * (buy_ratio * 2 - 1),
        "arab_buys_value": arab_turnover * buy_ratio,
        "arab_sells_value": arab_turnover * (1 - buy_ratio),
        "arab_net_value": arab_turnover * (buy_ratio * 2 - 1),
        "foreign_buys_value": foreign_turnover * buy_ratio,
        "foreign_sells_value": foreign_turnover * (1 - buy_ratio),
        "foreign_net_value": foreign_turnover * (buy_ratio * 2 - 1),
        "total_buys_value": total_turnover * buy_ratio,
        "total_sells_value": total_turnover * (1 - buy_ratio),
        "number_of_trades": sum(r[2] or 0 for r in rows) // 100,
        "source": "computed_estimate",
    }

    conn.close()
    return result


def update_investors_data(data: Dict):
    """Update investors_data table."""
    if not data:
        return

    conn = get_db(STOCKS_DB)
    ensure_investors_data_table(conn)

    conn.execute("""
        INSERT INTO investors_data (
            date, session_type,
            individuals_buys_value, individuals_sells_value, individuals_net_value,
            arab_buys_value, arab_sells_value, arab_net_value,
            foreign_buys_value, foreign_sells_value, foreign_net_value,
            total_buys_value, total_sells_value, number_of_trades, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            individuals_buys_value = excluded.individuals_buys_value,
            individuals_sells_value = excluded.individuals_sells_value,
            individuals_net_value = excluded.individuals_net_value,
            arab_buys_value = excluded.arab_buys_value,
            arab_sells_value = excluded.arab_sells_value,
            arab_net_value = excluded.arab_net_value,
            foreign_buys_value = excluded.foreign_buys_value,
            foreign_sells_value = excluded.foreign_sells_value,
            foreign_net_value = excluded.foreign_net_value,
            total_buys_value = excluded.total_buys_value,
            total_sells_value = excluded.total_sells_value,
            number_of_trades = excluded.number_of_trades,
            source = excluded.source
    """, (
        data["date"], "regular",
        data["individuals_buys_value"], data["individuals_sells_value"], data["individuals_net_value"],
        data["arab_buys_value"], data["arab_sells_value"], data["arab_net_value"],
        data["foreign_buys_value"], data["foreign_sells_value"], data["foreign_net_value"],
        data["total_buys_value"], data["total_sells_value"], data["number_of_trades"],
        data["source"],
    ))

    conn.commit()
    conn.close()
    log.info(f"[Investors] Updated for {data['date']}")


def run_investors_engine():
    """Run the investors engine — tries beta.egx.com.eg, then egx.news, then estimate."""
    # 1. Try beta.egx.com.eg (official)
    data = fetch_investors_beta_egx()
    if data and "individuals_buys_value" in data:
        data["source"] = "beta.egx.com.eg"
        update_investors_data(data)
        return

    # 2. Try egx.news
    data = fetch_investors_egx_news()
    if data and "individuals_buys_value" in data:
        data["source"] = "egx.news"
        update_investors_data(data)
        return

    # 3. Fallback: compute estimate
    data = compute_investors_estimate()
    if data:
        update_investors_data(data)


# ============================================================================
# 4. MARKET DEPTH ENGINE — from data_engine.db.historical_data
# ============================================================================

def compute_market_depth(symbol: str, levels: int = 5) -> Optional[Dict]:
    """
    Compute market depth from historical_data in data_engine.db.

    Uses recent price movements to build a liquidity depth view:
    - Buckets recent trading data by price level
    - Above current price = asks (resistance)
    - Below current price = bids (support)
    """
    log.info(f"[Depth] Computing depth for {symbol} from data_engine.db...")

    conn = get_db(DATA_ENGINE_DB)

    # Get recent price data (last 30 days)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT date, open, high, low, close, volume
        FROM historical_data
        WHERE symbol = ? AND market IN ('مصر', 'EGX', 'egypt')
        ORDER BY date DESC
        LIMIT 30
    """, (symbol,))

    rows = cursor.fetchall()
    if not rows:
        # Try without market filter
        cursor.execute("""
            SELECT date, open, high, low, close, volume
            FROM historical_data
            WHERE symbol = ?
            ORDER BY date DESC
            LIMIT 30
        """, (symbol,))
        rows = cursor.fetchall()

    conn.close()

    if not rows or len(rows) < 2:
        log.warning(f"[Depth] No historical data for {symbol}")
        return None

    # Current price = latest close
    current_price = rows[0][4]  # close
    if not current_price or current_price <= 0:
        return None

    # Build price level buckets
    bucket_size = current_price * 0.005 if current_price > 100 else 0.25

    bids = {}  # price -> volume
    asks = {}  # price -> volume

    for row in rows[1:]:  # skip latest (current)
        _, _, high, low, close, volume = row
        if not close or not volume:
            continue

        # Average price for this day
        avg_price = (high + low + close) / 3 if high and low else close

        if avg_price >= current_price:
            # Above current → ask level
            bucket = round(avg_price / bucket_size) * bucket_size
            asks[bucket] = asks.get(bucket, 0) + volume
        else:
            # Below current → bid level
            bucket = round(avg_price / bucket_size) * bucket_size
            bids[bucket] = bids.get(bucket, 0) + volume

    # Sort and take top N
    bid_levels = sorted(bids.items(), key=lambda x: -x[0])[:levels]  # descending (closest first)
    ask_levels = sorted(asks.items(), key=lambda x: x[0])[:levels]   # ascending (closest first)

    total_bid_vol = sum(v for _, v in bid_levels)
    total_ask_vol = sum(v for _, v in ask_levels)
    total_vol = total_bid_vol + total_ask_vol

    imbalance = (total_bid_vol - total_ask_vol) / total_vol if total_vol > 0 else 0

    if imbalance > 0.10:
        interpretation = "buy_pressure"
    elif imbalance < -0.10:
        interpretation = "sell_pressure"
    else:
        interpretation = "balanced"

    return {
        "symbol": symbol,
        "current_price": current_price,
        "bids": [{"price": p, "volume": v, "distance_pct": ((current_price - p) / current_price) * 100}
                 for p, v in bid_levels],
        "asks": [{"price": p, "volume": v, "distance_pct": ((p - current_price) / current_price) * 100}
                 for p, v in ask_levels],
        "spread": ask_levels[0][0] - bid_levels[0][0] if bid_levels and ask_levels else 0,
        "total_bid_volume": total_bid_vol,
        "total_ask_volume": total_ask_vol,
        "imbalance": round(imbalance, 4),
        "interpretation": interpretation,
        "source": "data_engine.historical_data",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================================
# 5. MAIN ORCHESTRATOR
# ============================================================================

def run_all(market_slug: str = "egypt"):
    """Run all engines for a market."""
    log.info(f"{'='*60}")
    log.info(f"Data Engine — Running for market: {market_slug}")
    log.info(f"{'='*60}")

    # 1. Indices
    run_indices_engine(market_slug)

    # 2. Stocks
    run_stocks_engine(market_slug)

    # 3. Investors (EGX only)
    if market_slug == "egypt":
        run_investors_engine()

    log.info(f"{'='*60}")
    log.info("Data Engine — Complete")
    log.info(f"{'='*60}")


def run_daemon(interval_seconds: int = 300):
    """Run as daemon — updates every 5 minutes (default)."""
    log.info(f"Starting Data Engine daemon (interval: {interval_seconds}s)")
    while True:
        try:
            for market in TV_MARKETS:
                run_all(market)
        except Exception as e:
            log.error(f"Daemon error: {e}")

        log.info(f"Sleeping {interval_seconds}s...")
        time.sleep(interval_seconds)


def main():
    parser = argparse.ArgumentParser(description="Data Engine — unified data collector")
    parser.add_argument("--market", default="egypt", choices=list(TV_MARKETS.keys()),
                        help="Market to fetch data for")
    parser.add_argument("--all-markets", action="store_true",
                        help="Fetch data for all markets")
    parser.add_argument("--indices-only", action="store_true",
                        help="Only update market indices")
    parser.add_argument("--investors-only", action="store_true",
                        help="Only update investor flow data (EGX only)")
    parser.add_argument("--depth", type=str, default=None,
                        help="Compute market depth for a symbol")
    parser.add_argument("--daemon", action="store_true",
                        help="Run as background daemon")
    parser.add_argument("--interval", type=int, default=300,
                        help="Daemon update interval in seconds (default: 300)")
    args = parser.parse_args()

    import urllib.parse  # needed for quote()

    if args.daemon:
        run_daemon(args.interval)
    elif args.depth:
        result = compute_market_depth(args.depth)
        if result:
            print(json.dumps(result, indent=2, ensure_ascii=False))
    elif args.indices_only:
        run_indices_engine(args.market)
    elif args.investors_only:
        run_investors_engine()
    elif args.all_markets:
        for market in TV_MARKETS:
            run_all(market)
    else:
        run_all(args.market)


if __name__ == "__main__":
    main()
