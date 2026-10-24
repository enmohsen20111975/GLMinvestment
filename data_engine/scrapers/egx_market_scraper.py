#!/usr/bin/env python3
"""Comprehensive Playwright scraper for beta.egx.com.eg market pages."""
import argparse, json, logging, os, sys
from datetime import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
_VPS = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
if _VPS not in sys.path:
    sys.path.insert(0, _VPS)

log = logging.getLogger("egx_market")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")

PAGES = {
    "market": "https://beta.egx.com.eg/ar/market/",
    "investors": "https://beta.egx.com.eg/ar/market/investors",
    "indices": "https://beta.egx.com.eg/ar/market/indices",
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

def render(url, click_tabs=False, timeout_ms=60000):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox","--disable-dev-shm-usage"])
        page = browser.new_page(user_agent=UA, viewport={"width":1366,"height":900}, locale="ar-EG")
        page.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        try:
            page.wait_for_function("() => document.body.innerText.length > 2000", timeout=timeout_ms)
        except Exception:
            pass
        page.wait_for_timeout(5000)
        tabs_data = {}
        if click_tabs:
            # try clicking all tab-like buttons
            tab_buttons = page.query_selector_all("button, [role='tab'], a.tab")
            for btn in tab_buttons:
                try:
                    label = btn.inner_text().strip()
                    if not label or len(label) > 40:
                        continue
                    btn.click()
                    page.wait_for_timeout(2500)
                    tabs_data[label] = page.inner_text("body")
                except Exception:
                    pass
        html = page.content()
        text = page.inner_text("body")
        browser.close()
        return html, text, tabs_data

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", choices=list(PAGES), default="market")
    ap.add_argument("--url", default=None)
    ap.add_argument("--tabs", action="store_true", help="Click tabs (investors page)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    url = args.url or PAGES[args.page]
    html, text, tabs = render(url, click_tabs=args.tabs)
    log.info("Rendered html=%d text=%d tabs=%d", len(html), len(text), len(tabs))
    data = {"url": url, "scraped_at": datetime.now().isoformat(), "html_len": len(html), "text": text, "tabs": tabs}
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Saved to {args.out}")
    else:
        print(text[:4000])

if __name__ == "__main__":
    main()
