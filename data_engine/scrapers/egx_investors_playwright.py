#!/usr/bin/env python3
"""
egx_investors_playwright.py — EGX investor-flow scraper using Playwright.

The EGX foreign-trading page (egx.com.eg/en/Market/ForeignInvestorsTrading)
is protected by F5 Bot Defense. A simple requests.get() returns a 6KB
JavaScript challenge page — NOT the actual investor-flow data.

This scraper uses Playwright (headless Chromium) to:
  1. Launch a REAL browser engine
  2. Navigate to the EGX page
  3. Let the F5 challenge JS execute + resolve (sets cookies, fingerprints)
  4. Wait for the real page content to render (the data table)
  5. Extract the rendered HTML
  6. Pass it to the existing _parse_egx_html() parser (reused from
     egx_investors_scraper.py)
  7. Upsert the parsed row to investors_data with source='egx_official_playwright'

Usage:
    python3 data_engine/scrapers/egx_investors_playwright.py
    python3 data_engine/scrapers/egx_investors_playwright.py --days 1
    python3 data_engine/scrapers/egx_investors_playwright.py --headed   # show browser

Requirements:
    pip install playwright
    playwright install chromium

Crontab (on a machine that reaches EGX):
    0 16 * * 0-4 cd /root/GLMinvestment && .venv/bin/python3 \\
        data_engine/scrapers/egx_investors_playwright.py >> /tmp/egx_pw.log 2>&1
"""
import argparse
import logging
import os
import sys
from datetime import datetime
from typing import Optional

# Make the sibling egx_investors_scraper importable so we can reuse its
# parser, upsert_row, ensure_schema, InvestorFlowRow, DEFAULT_STOCKS_DB.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import egx_investors_scraper as base  # noqa: E402

log = logging.getLogger("egx_investors_pw")

EGX_URL_EN = base.EGX_FOREIGN_TRADING_URL_EN
EGX_URL_AR = base.EGX_FOREIGN_TRADING_URL_AR

# Realistic desktop User-Agent (F5 checks this).
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def render_egx_page(url: str, headed: bool = False, timeout_ms: int = 45000) -> Optional[str]:
    """Launch Chromium, navigate to EGX, wait for F5 challenge + data, return rendered HTML.

    Strategy (fixes the two failures we saw):
    1. Use launch_persistent_context — persists cookies/fingerprint across
       runs. F5 Bot Defense trusts returning visitors more than first-time.
    2. Wait for the DATA KEYWORDS (foreign/أجانب/مصريين/egyptians) to appear
       in document.body.innerText — NOT networkidle (which fires wrong).
       The F5 challenge page lacks these; the real page has them.
    3. Handle page.content() crash during navigation with retry.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("playwright not installed. Run: pip install playwright && playwright install chromium")
        return None

    import tempfile
    # Persistent profile — F5 cookies survive across runs (returning visitor).
    user_data_dir = os.path.join(tempfile.gettempdir(), "egx_playwright_profile")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir,
            headless=not headed,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
            user_agent=UA,
            viewport={"width": 1366, "height": 768},
            locale="en-US",
            timezone_id="Africa/Cairo",
            ignore_https_errors=True,
        )
        # Mask the webdriver flag + fake plugins (F5 checks these).
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US','en','ar']});
            window.chrome = { runtime: {} };
        """)
        page = context.pages[0] if context.pages else context.new_page()

        log.info("Playwright: navigating to %s", url)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            log.error("page.goto failed: %s", e)
            context.close()
            return None

        # Wait for the REAL data to appear. The F5 challenge page is 6KB of
        # obfuscated JS with NO investor-flow keywords. The real page (after
        # F5 resolves + redirects) HAS "foreign"/"أجانب"/"مصريين"/"egyptians".
        # We poll document.body.innerText for these keywords.
        log.info("Waiting for F5 challenge to resolve + data keywords to appear...")
        keyword_js = """() => {
            const t = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
            return t.includes('foreign') || t.includes('أجانب') || t.includes('مصريين') || t.includes('egyptians') || t.includes('arab');
        }"""
        try:
            page.wait_for_function(keyword_js, timeout=timeout_ms)
            log.info("✓ Data keywords detected — F5 challenge resolved, real page loaded")
        except Exception:
            log.warning("Data keywords NOT detected within %ds — F5 may have blocked us", timeout_ms // 1000)

        # Small extra wait for any AJAX data tables to finish rendering.
        page.wait_for_timeout(2500)

        # Get content — handle the "page is navigating" crash with retry.
        html = None
        for attempt in range(3):
            try:
                html = page.content()
                break
            except Exception as e:
                log.warning("page.content() attempt %d failed (navigating?): %s", attempt + 1, str(e)[:80])
                page.wait_for_timeout(2000)
        if not html:
            log.error("page.content() failed after 3 retries")
            context.close()
            return None

        log.info("Rendered HTML: %d chars", len(html))
        lower = html.lower()
        has_data = (
            "foreign trading" in lower
            or "أجانب" in lower
            or "مصريين" in lower
            or "egyptians" in lower
            or "arab" in lower
        )
        if not has_data:
            log.warning("Rendered page still lacks investor-flow keywords — F5 blocked us.")
            log.info("body[0:400]: %s", html[:400].replace("\n", " "))
            context.close()
            return None

        log.info("✓ EGX page rendered with real content")
        context.close()
        return html


def scrape_one(url: str, session_date: Optional[str], headed: bool) -> Optional[base.InvestorFlowRow]:
    """Render EGX page + parse + build InvestorFlowRow."""
    html = render_egx_page(url, headed=headed)
    if not html:
        return None
    parsed = base._parse_egx_html(html)
    if not parsed:
        log.warning("Parser returned None even after Playwright render — DOM structure may have changed.")
        return None
    date_str = session_date or datetime.utcnow().strftime("%Y-%m-%d")
    total_buys = parsed["individuals_buys_value"] + parsed["arab_buys_value"] + parsed["foreign_buys_value"]
    total_sells = parsed["individuals_sells_value"] + parsed["arab_sells_value"] + parsed["foreign_sells_value"]
    row = base.InvestorFlowRow(
        date=date_str,
        session_type="day",
        individuals_buys_value=parsed["individuals_buys_value"],
        individuals_sells_value=parsed["individuals_sells_value"],
        individuals_net_value=parsed["individuals_net_value"],
        arab_buys_value=parsed["arab_buys_value"],
        arab_sells_value=parsed["arab_sells_value"],
        arab_net_value=parsed["arab_net_value"],
        foreign_buys_value=parsed["foreign_buys_value"],
        foreign_sells_value=parsed["foreign_sells_value"],
        foreign_net_value=parsed["foreign_net_value"],
        total_buys_value=total_buys,
        total_sells_value=total_sells,
        number_of_trades=0,
        source="egx_official_playwright",
    )
    log.info("Parsed OK: date=%s egy_net=%.0f arab_net=%.0f foreign_net=%.0f",
             row.date, row.individuals_net_value, row.arab_net_value, row.foreign_net_value)
    return row


def run(db_path: str = base.DEFAULT_STOCKS_DB, session_date: Optional[str] = None, headed: bool = False) -> int:
    """Run one scrape attempt + persist. Returns rows produced (0 or 1)."""
    conn = base._connect(db_path)
    base.ensure_schema(conn)

    # Try EN first, then AR fallback.
    row = scrape_one(EGX_URL_EN, session_date, headed)
    if row is None:
        log.info("EN failed, trying AR...")
        row = scrape_one(EGX_URL_AR, session_date, headed)
    if row is None:
        log.warning("EGX Playwright scrape failed — no data. (no fabrication)")
        conn.close()
        return 0

    base.upsert_row(conn, row)
    log.info("Upserted investors_data date=%s source=%s", row.date, row.source)
    conn.close()
    return 1


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    p = argparse.ArgumentParser(description="EGX investor-flow Playwright scraper")
    p.add_argument("--db", default=base.DEFAULT_STOCKS_DB, help="Path to stocks.db")
    p.add_argument("--date", default=None, help="Specific date (YYYY-MM-DD). Default: today.")
    p.add_argument("--headed", action="store_true", help="Show browser window (debug)")
    args = p.parse_args()

    produced = run(db_path=args.db, session_date=args.date, headed=args.headed)
    print(f"Pipeline done. Rows produced: {produced}")


if __name__ == "__main__":
    main()
