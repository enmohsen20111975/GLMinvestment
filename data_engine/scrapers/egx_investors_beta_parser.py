#!/usr/bin/env python3
"""
egx_investors_beta_parser.py — Parse investor flow data from beta.egx.com.eg.

Owner (2026-10-22): "egx_market_scraper.py --page investors --tabs يلتقطها
بالكامل. need rewrite parser for beta tables."

This parser:
1. Renders beta.egx.com.eg/ar/market/investors with Playwright
2. Finds ALL tables on the page
3. Extracts Buy/Sell/Net for Egyptians/Arab/Foreigners × Individuals/Institutions
4. Stores the FULL breakdown (18 columns) not just aggregate (9 columns)
5. Upserts to investors_data with source='egx_beta_parsed'

Usage:
    python3 data_engine/scrapers/egx_investors_beta_parser.py
    python3 data_engine/scrapers/egx_investors_beta_parser.py --headed  # debug

Crontab (after market close):
    0 16 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 \\
        data_engine/scrapers/egx_investors_beta_parser.py >> /tmp/egx_investors_beta.log 2>&1
"""
import argparse
import logging
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

log = logging.getLogger("egx_investors_beta")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
STOCKS_DB = os.path.join(_PROJECT_ROOT, "db", "stocks.db")

BETA_URLS = [
    "https://beta.egx.com.eg/ar/market/investors",
    "https://beta.egx.com.eg/en/market/investors",
]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def parse_number(s):
    """Parse a number string: '1,234,567.89' → 1234567.89, '1.23B' → 1230000000, etc."""
    if not s:
        return 0
    s = str(s).strip().replace(',', '').replace('٬', '').replace('٫', '.')
    # Remove non-numeric except . and -
    s = re.sub(r'[^\d.\-]', '', s)
    try:
        return float(s)
    except:
        return 0


def render_and_extract(urls, timeout_ms=90000):
    """Render beta page with Playwright, extract investor flow tables."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("playwright not installed")
        return None

    import tempfile
    profile = os.path.join(tempfile.gettempdir(), "egx_investors_beta_profile")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            profile,
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            user_agent=UA,
            viewport={"width": 1366, "height": 900},
            locale="ar-EG",
            timezone_id="Africa/Cairo",
        )
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            window.chrome = {runtime: {}};
        """)
        page = context.pages[0] if context.pages else context.new_page()

        for url in (urls if isinstance(urls, list) else [urls]):
            log.info("navigating to %s", url)
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                break
            except Exception as e:
                log.error("goto failed for %s: %s", url, e)
                continue
        else:
            log.error("all URLs failed")
            context.close()
            return None

        # Wait for investor keywords to appear
        log.info("waiting for investor data...")
        try:
            page.wait_for_function(
                "() => document.body.innerText.includes('مصريين') || document.body.innerText.includes('أجانب')",
                timeout=timeout_ms
            )
            log.info("✓ investor keywords detected")
        except:
            log.warning("keywords not detected — trying anyway")

        page.wait_for_timeout(5000)

        # === TABLE-BASED EXTRACTION ===
        # The beta page shows tables with rows for each nationality
        # and columns for Buy/Sell/Net. We extract all tables and
        # find the one with investor flow data.
        tables = page.query_selector_all("table")
        log.info("found %d tables on page", len(tables))

        result = {
            'individuals_egy_buys': 0, 'individuals_egy_sells': 0,
            'individuals_arab_buys': 0, 'individuals_arab_sells': 0,
            'individuals_foreign_buys': 0, 'individuals_foreign_sells': 0,
            'institutions_egy_buys': 0, 'institutions_egy_sells': 0,
            'institutions_arab_buys': 0, 'institutions_arab_sells': 0,
            'institutions_foreign_buys': 0, 'institutions_foreign_sells': 0,
            'number_of_trades': 0,
        }

        # Also try extracting from the page text (more robust than table parsing)
        body_text = page.inner_text("body")
        log.info("body text: %d chars", len(body_text))

        # === TEXT-BASED PARSING (fallback if table parsing fails) ===
        # The beta page shows numbers in a structured text format.
        # We look for patterns like:
        #   "مصريين" followed by buy/sell/net numbers
        #   "أجانب" followed by buy/sell/net numbers
        #
        # Strategy: split text by nationality keywords, parse each section.

        lines = body_text.split('\n')
        current_nationality = None  # 'egy', 'arab', 'foreign'
        current_type = None  # 'individuals', 'institutions'

        for i, line in enumerate(lines):
            line_lower = line.strip().lower()

            # Detect nationality
            if 'مصريين' in line or 'مصري' in line:
                current_nationality = 'egy'
            elif 'عرب' in line:
                current_nationality = 'arab'
            elif 'أجانب' in line or 'اجانب' in line:
                current_nationality = 'foreign'

            # Detect individuals/institutions
            if 'أفراد' in line or 'افراد' in line or 'individuals' in line_lower:
                current_type = 'individuals'
            elif 'مؤسسات' in line or 'institutions' in line_lower:
                current_type = 'institutions'

            # Find numbers on this line
            nums = re.findall(r'[\d,]+\.?\d*', line.replace('٬', '').replace('٫', '.'))
            if len(nums) >= 2 and current_nationality and current_type:
                # This line might have buy/sell/net
                parsed_nums = [parse_number(n) for n in nums if parse_number(n) > 0]

                if len(parsed_nums) >= 2:
                    buy = parsed_nums[0]
                    sell = parsed_nums[1] if len(parsed_nums) >= 2 else 0
                    net = parsed_nums[2] if len(parsed_nums) >= 3 else buy - sell

                    # Only accept if the values are reasonable (millions+)
                    if buy > 100000 or sell > 100000:
                        key_prefix = f"{current_type}_{current_nationality}"
                        result[f"{key_prefix}_buys"] = buy
                        result[f"{key_prefix}_sells"] = sell
                        log.info(f"  {current_type}/{current_nationality}: buy={buy:,.0f} sell={sell:,.0f} net={net:,.0f}")

            # Detect number of trades
            if 'صفقات' in line or 'trades' in line_lower:
                nums = re.findall(r'[\d,]+', line.replace('٬', '').replace('٫', '.'))
                for n in nums:
                    val = parse_number(n)
                    if val > 1000:  # trades are typically in thousands
                        result['number_of_trades'] = int(val)
                        break

        # Also try table-based extraction (more structured)
        for table_idx, table in enumerate(tables):
            try:
                rows = table.query_selector_all("tr")
                for row in rows:
                    cells = row.query_selector_all("td, th")
                    cell_texts = [c.inner_text().strip() for c in cells]

                    # Check if this row has nationality + numbers
                    row_text = ' '.join(cell_texts)
                    if not row_text:
                        continue

                    nums = [parse_number(t) for t in cell_texts]
                    nums = [n for n in nums if n > 100000]  # Only large values

                    if len(nums) >= 2:
                        # Determine nationality from row text
                        nat = None
                        typ = 'individuals'  # default
                        if 'مصريين' in row_text or 'مصري' in row_text:
                            nat = 'egy'
                        elif 'عرب' in row_text:
                            nat = 'arab'
                        elif 'أجانب' in row_text or 'اجانب' in row_text:
                            nat = 'foreign'

                        if 'مؤسسات' in row_text:
                            typ = 'institutions'

                        if nat:
                            key = f"{typ}_{nat}"
                            if nums[0] > 100000:
                                result[f"{key}_buys"] = nums[0]
                            if len(nums) >= 2 and nums[1] > 100000:
                                result[f"{key}_sells"] = nums[1]
                            log.info(f"  table {table_idx} row: {typ}/{nat} buy={nums[0]:,.0f} sell={nums[1]:,.0f}")
            except:
                pass

        context.close()

        # Calculate aggregates from the full breakdown
        result['individuals_buys'] = (result['individuals_egy_buys'] + result['individuals_arab_buys']
                                     + result['individuals_foreign_buys'])
        result['individuals_sells'] = (result['individuals_egy_sells'] + result['individuals_arab_sells']
                                       + result['individuals_foreign_sells'])
        result['arab_buys'] = result['individuals_arab_buys'] + result['institutions_arab_buys']
        result['arab_sells'] = result['individuals_arab_sells'] + result['institutions_arab_sells']
        result['foreign_buys'] = result['individuals_foreign_buys'] + result['institutions_foreign_buys']
        result['foreign_sells'] = result['individuals_foreign_sells'] + result['institutions_foreign_sells']
        result['total_buys'] = result['individuals_buys'] + result['arab_buys'] + result['foreign_buys']
        result['total_sells'] = result['individuals_sells'] + result['arab_sells'] + result['foreign_sells']

        for key in ['individuals_egy', 'individuals_arab', 'individuals_foreign',
                     'arab', 'foreign', 'institutions_egy', 'institutions_arab', 'institutions_foreign']:
            result[f"{key}_net"] = result[f"{key}_buys"] - result[f"{key}_sells"]
        result['individuals_net'] = result['individuals_buys'] - result['individuals_sells']

        # Sanity check: are the values reasonable?
        max_val = max(result['individuals_buys'], result['individuals_sells'],
                      result['foreign_buys'], result['foreign_sells'])
        if max_val < 100000:
            log.warning("values too small (max=%,.0f) — parser may have failed", max_val)
            return None

        log.info(f"✓ parsed: egy_buys={result['individuals_egy_buys']:,.0f} egy_sells={result['individuals_egy_sells']:,.0f} foreign_buys={result['foreign_buys']:,.0f} foreign_sells={result['foreign_sells']:,.0f} trades={result['number_of_trades']}")

        return result


def upsert_to_db(data, date_str=None):
    """Upsert parsed investor flow data to investors_data."""
    if not data:
        log.warning("no data to upsert")
        return False

    date = date_str or datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(STOCKS_DB)

    # Ensure table exists with full columns
    conn.execute("""
        CREATE TABLE IF NOT EXISTS investors_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            session_type TEXT,
            individuals_buys_value REAL, individuals_sells_value REAL, individuals_net_value REAL,
            arab_buys_value REAL, arab_sells_value REAL, arab_net_value REAL,
            foreign_buys_value REAL, foreign_sells_value REAL, foreign_net_value REAL,
            total_buys_value REAL, total_sells_value REAL, number_of_trades INTEGER,
            source TEXT DEFAULT 'computed_estimate',
            created_at TEXT DEFAULT (datetime('now')),
            individuals_egy_buys_value REAL, individuals_egy_sells_value REAL, individuals_egy_net_value REAL,
            individuals_arab_buys_value REAL, individuals_arab_sells_value REAL, individuals_arab_net_value REAL,
            individuals_foreign_buys_value REAL, individuals_foreign_sells_value REAL, individuals_foreign_net_value REAL,
            institutions_egy_buys_value REAL, institutions_egy_sells_value REAL, institutions_egy_net_value REAL,
            institutions_arab_buys_value REAL, institutions_arab_sells_value REAL, institutions_arab_net_value REAL,
            institutions_foreign_buys_value REAL, institutions_foreign_sells_value REAL, institutions_foreign_net_value REAL,
            UNIQUE(date)
        )
    """)

    # Add missing columns if table already exists (ALTER TABLE for each)
    migration_cols = [
        'individuals_egy_buys_value', 'individuals_egy_sells_value', 'individuals_egy_net_value',
        'individuals_arab_buys_value', 'individuals_arab_sells_value', 'individuals_arab_net_value',
        'individuals_foreign_buys_value', 'individuals_foreign_sells_value', 'individuals_foreign_net_value',
        'institutions_egy_buys_value', 'institutions_egy_sells_value', 'institutions_egy_net_value',
        'institutions_arab_buys_value', 'institutions_arab_sells_value', 'institutions_arab_net_value',
        'institutions_foreign_buys_value', 'institutions_foreign_sells_value', 'institutions_foreign_net_value',
    ]
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(investors_data)").fetchall()}
    for col in migration_cols:
        if col not in existing_cols:
            try:
                conn.execute(f"ALTER TABLE investors_data ADD COLUMN {col} REAL")
            except:
                pass

    # Delete old garbage row for this date
    conn.execute("DELETE FROM investors_data WHERE date = ?", (date,))

    conn.execute("""
        INSERT INTO investors_data (
            date, session_type,
            individuals_buys_value, individuals_sells_value, individuals_net_value,
            arab_buys_value, arab_sells_value, arab_net_value,
            foreign_buys_value, foreign_sells_value, foreign_net_value,
            total_buys_value, total_sells_value, number_of_trades,
            source, created_at,
            individuals_egy_buys_value, individuals_egy_sells_value, individuals_egy_net_value,
            individuals_arab_buys_value, individuals_arab_sells_value, individuals_arab_net_value,
            individuals_foreign_buys_value, individuals_foreign_sells_value, individuals_foreign_net_value,
            institutions_egy_buys_value, institutions_egy_sells_value, institutions_egy_net_value,
            institutions_arab_buys_value, institutions_arab_sells_value, institutions_arab_net_value,
            institutions_foreign_buys_value, institutions_foreign_sells_value, institutions_foreign_net_value
        ) VALUES (
            ?, 'day',
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            'egx_beta_parsed', datetime('now'),
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?
        )
    """, (
        date,
        data['individuals_buys'], data['individuals_sells'], data['individuals_net'],
        data['arab_buys'], data['arab_sells'], data['arab_net'],
        data['foreign_buys'], data['foreign_sells'], data['foreign_net'],
        data['total_buys'], data['total_sells'], data['number_of_trades'],
        data['individuals_egy_buys'], data['individuals_egy_sells'], data['individuals_egy_net'],
        data['individuals_arab_buys'], data['individuals_arab_sells'], data['individuals_arab_net'],
        data['individuals_foreign_buys'], data['individuals_foreign_sells'], data['individuals_foreign_net'],
        data['institutions_egy_buys'], data['institutions_egy_sells'], data['institutions_egy_net'],
        data['institutions_arab_buys'], data['institutions_arab_sells'], data['institutions_arab_net'],
        data['institutions_foreign_buys'], data['institutions_foreign_sells'], data['institutions_foreign_net'],
    ))

    conn.commit()
    conn.close()
    log.info("✓ upserted investors_data date=%s source=egx_beta_parsed", date)
    return True


def main():
    parser = argparse.ArgumentParser(description="EGX investor flow parser (beta.egx.com.eg)")
    parser.add_argument("--date", default=None, help="Date (YYYY-MM-DD)")
    parser.add_argument("--headed", action="store_true", help="Show browser (debug)")
    args = parser.parse_args()

    data = render_and_extract(BETA_URLS)
    if data:
        upsert_to_db(data, args.date)
        print(f"✅ Done. egx_beta_parsed for {args.date or datetime.now().strftime('%Y-%m-%d')}")
    else:
        print("❌ Failed to parse investor data. Check log.")
        sys.exit(1)


if __name__ == "__main__":
    main()
