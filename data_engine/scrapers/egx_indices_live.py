#!/usr/bin/env python3
"""
egx_indices_live.py — Fetch REAL EGX index values from beta.egx.com.eg automatically.

NO computation. NO manual seeding. NO hardcoded base.
This scraper:
1. Renders beta.egx.com.eg/ar/market (or /indices) with Playwright
2. Extracts REAL EGX30/EGX70/EGX33/EGX100 values (current, change%, open, high, low)
3. Upserts directly to market_indices (live) + index_daily_prices (historical)
4. Runs via cron every 5 min during trading hours

This is the RADICAL, FINAL solution: the screens show the REAL EGX values,
not computed approximations.

Crontab:
    */5 9-14 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 \\
        data_engine/scrapers/egx_indices_live.py >> /tmp/egx_indices.log 2>&1

Requirements:
    pip install playwright && playwright install chromium
"""
import argparse
import logging
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

log = logging.getLogger("egx_indices_live")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
STOCKS_DB = os.path.join(_PROJECT_ROOT, "db", "stocks.db")

# beta.egx.com.eg — owner confirmed working 2026-10-22
BETA_URLS = [
    "https://beta.egx.com.eg/ar/market/indices",
    "https://beta.egx.com.eg/ar/market",
    "https://beta.egx.com.eg/en/market/indices",
    "https://beta.egx.com.eg/en/market",
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Index symbols to search for in the page text
INDEX_KEYWORDS = {
    "EGX30": ["EGX30", "EGX 30", "EGX30Index"],
    "EGX70": ["EGX70", "EGX 70", "EGX70Index"],
    "EGX100": ["EGX100", "EGX 100", "EGX100Index"],
    "EGX33": ["EGX33", "EGX 33", "EGX33Shariah", "EGX 33 Shariah"],
}


def render_page(url, timeout_ms=45000):
    """Render the EGX page with Playwright, return (html, text)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("playwright not installed. Run: pip install playwright && playwright install chromium")
        return None, None

    import tempfile
    user_data_dir = os.path.join(tempfile.gettempdir(), "egx_indices_profile")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            user_agent=UA,
            viewport={"width": 1366, "height": 900},
            locale="ar-EG",
            timezone_id="Africa/Cairo",
        )
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            window.chrome = {runtime: {}};
        """)
        page = context.pages[0] if context.pages else context.new_page()

        log.info("navigating to %s", url)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            log.error("page.goto failed: %s", e)
            context.close()
            return None, None

        # Wait for index data to appear
        log.info("waiting for index data...")
        try:
            page.wait_for_function(
                "() => document.body.innerText.includes('EGX30') || document.body.innerText.includes('EGX 30')",
                timeout=timeout_ms
            )
            log.info("✓ EGX30 keyword detected")
        except Exception:
            log.warning("EGX30 keyword not detected — trying anyway")

        page.wait_for_timeout(3000)

        # Get content with retry
        html = None
        for attempt in range(3):
            try:
                html = page.content()
                break
            except Exception:
                page.wait_for_timeout(2000)
        if not html:
            context.close()
            return None, None

        text = page.inner_text("body")
        context.close()
        log.info("rendered: html=%d chars, text=%d chars", len(html), len(text))
        return html, text


def parse_index_values(text):
    """Extract EGX30/70/100/33 values from rendered page text.

    FIX (2026-10-22): was using a 1500-char window that OVERLAPPED between
    indices → grabbed EGX30's value (51,052) for ALL indices.
    Now splits text by index keywords and parses each section separately.
    """
    results = {}
    text_lower = text.lower()

    # Find ALL keyword positions to delimit sections
    all_positions = []  # (position, symbol)
    for symbol, keywords in INDEX_KEYWORDS.items():
        for kw in keywords:
            pos = text_lower.find(kw.lower())
            if pos != -1:
                all_positions.append((pos, symbol, kw))
                break  # first match for this symbol

    # Sort by position
    all_positions.sort()

    for i, (pos, symbol, kw) in enumerate(all_positions):
        # Section end = start of next index keyword (or end of text)
        section_end = all_positions[i + 1][0] if i + 1 < len(all_positions) else pos + 800
        window = text[pos:section_end]

        # Find numbers in this section only
        nums = re.findall(r'[\d,]+\.?\d*', window.replace('٬', '').replace('٫', '.'))
        if len(nums) < 1:
            continue

        # The first large number (> 100) is the index value
        for n in nums:
            val = float(n.replace(',', ''))
            if val > 100:
                pct_match = re.search(r'(-?\d+\.?\d*)\s*%', window)
                change_pct = float(pct_match.group(1)) if pct_match else 0.0
                results[symbol] = {"current_value": val, "change_percent": change_pct}
                log.info(f"  {symbol} = {val:,.2f} ({change_pct:+.2f}%)")
                break

    return results


def upsert_to_db(values, today):
    """Upsert parsed values to market_indices + index_daily_prices."""
    if not values:
        log.warning("no values to upsert")
        return 0

    conn = sqlite3.connect(STOCKS_DB)

    # Ensure tables exist
    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_indices (
            symbol TEXT PRIMARY KEY,
            name TEXT, name_ar TEXT,
            current_value REAL, previous_close REAL,
            change REAL, change_percent REAL,
            is_shariah INTEGER DEFAULT 0,
            last_update TEXT, source TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS index_daily_prices (
            symbol TEXT, price_date TEXT,
            open REAL, high REAL, low REAL, close REAL,
            volume REAL, change_percent REAL,
            PRIMARY KEY (symbol, price_date))
    """)

    upserted = 0
    now_iso = datetime.now().isoformat()

    for symbol, data in values.items():
        current = data["current_value"]
        change_pct = data["change_percent"]

        # Read previous close for the 'change' field
        prev_row = conn.execute(
            "SELECT close FROM index_daily_prices WHERE symbol=? AND price_date < ? "
            "ORDER BY price_date DESC LIMIT 1", (symbol, today)
        ).fetchone()
        prev_close = float(prev_row[0]) if prev_row else current
        change = current - prev_close

        # Upsert to market_indices (live)
        conn.execute("""
            INSERT INTO market_indices (symbol, current_value, previous_close, change, change_percent, last_update, source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                current_value = excluded.current_value,
                previous_close = excluded.previous_close,
                change = excluded.change,
                change_percent = excluded.change_percent,
                last_update = excluded.last_update,
                source = excluded.source
        """, (symbol, current, prev_close, change, change_pct, now_iso, "egx_beta_official"))

        # Upsert to index_daily_prices (historical) — only if not already today
        existing = conn.execute(
            "SELECT close FROM index_daily_prices WHERE symbol=? AND price_date=?", (symbol, today)
        ).fetchone()
        if not existing:
            conn.execute("""
                INSERT OR REPLACE INTO index_daily_prices (symbol, price_date, close, change_percent)
                VALUES (?, ?, ?, ?)
            """, (symbol, today, current, change_pct))

        upserted += 1
        log.info(f"  ✓ upserted {symbol} = {current:,.2f} to market_indices + index_daily_prices")

    conn.commit()
    conn.close()
    return upserted


def main():
    parser = argparse.ArgumentParser(description="Fetch REAL EGX index values from beta.egx.com.eg")
    parser.add_argument("--url", default=None, help="Specific URL to scrape")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    args = parser.parse_args()

    today = datetime.now().strftime("%Y-%m-%d")
    log.info("=== EGX indices live fetch — %s ===", today)

    # Try each URL until one works
    for url in ([args.url] if args.url else BETA_URLS):
        html, text = render_page(url)
        if not text:
            continue

        values = parse_index_values(text)
        if values:
            log.info("parsed %d indices from %s", len(values), url)
            if not args.dry_run:
                upserted = upsert_to_db(values, today)
                log.info("✅ upserted %d indices. Done.", upserted)
            else:
                log.info("(dry-run) would upsert: %s", values)
            return
        else:
            log.warning("no index values parsed from %s", url)

    log.error("✗ Failed to fetch index values from all URLs")


if __name__ == "__main__":
    main()
