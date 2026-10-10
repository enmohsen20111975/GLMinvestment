#!/usr/bin/env python3
"""
سحب روابط أيقونات الأسهم
"""

import asyncio
import sqlite3
import re
from pathlib import Path
from playwright.async_api import async_playwright

# Database path - unified in /db folder
DB_FILE = str(Path(__file__).parent.parent.parent / 'db' / 'data_engine.db')
MARKETS = {
    'السعودية': 'https://ar.tradingview.com/markets/stocks-ksa/market-movers-all-stocks/',
    'مصر': 'https://ar.tradingview.com/markets/stocks-egypt/market-movers-all-stocks/',
    'الكويت': 'https://ar.tradingview.com/markets/stocks-kuwait/market-movers-all-stocks/',
    'قطر': 'https://ar.tradingview.com/markets/stocks-qatar/market-movers-all-stocks/'
}

async def click_load_more(page):
    for _ in range(10):
        try:
            btn = await page.query_selector('button:has-text("تحميل المزيد")')
            if btn and await btn.is_visible():
                await btn.click()
                await asyncio.sleep(1)
        except:
            break

async def scrape_logos(page, market):
    print(f"🔄 Loading {market}...")

    logos = await page.evaluate('''
        () => {
            const results = {};
            const rows = document.querySelectorAll('table tbody tr');

            rows.forEach(row => {
                // Get symbol from first cell
                const symbolCell = row.querySelector('td');
                if (!symbolCell) return;

                const symbolText = symbolCell.textContent?.trim() || '';
                const symbolMatch = symbolText.match(/^(\\d+[A-Z]*)/);
                const symbol = symbolMatch ? symbolMatch[1] : symbolText.split(/[أ-ي]/)[0];

                // Get logo from img in first cell or nearby
                const img = row.querySelector('img');
                if (img && img.src && img.src.includes('s3-symbol-logo')) {
                    results[symbol] = img.src;
                }
            });

            return results;
        }
    ''')

    return logos

async def main():
    print("=" * 50)
    print("🔥 Fetching stock logos...")
    print("=" * 50)

    all_logos = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})

        for market, url in MARKETS.items():
            await page.goto(url, timeout=60000)
            await asyncio.sleep(3)
            await click_load_more(page)

            logos = await scrape_logos(page, market)
            all_logos.update(logos)
            print(f"  {market}: {len(logos)} logos")

        await browser.close()

    # Save to database
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    updated = 0
    for symbol, logo_url in all_logos.items():
        cursor.execute('UPDATE stocks SET logo_url = ? WHERE symbol = ?', (logo_url, symbol))
        if cursor.rowcount > 0:
            updated += 1

    conn.commit()
    conn.close()

    print(f"\n✅ Updated {updated} logos in database")

    # Show samples
    print("\n📊 عينة:")
    for i, (s, u) in enumerate(list(all_logos.items())[:5]):
        print(f"  {s}: {u}")

if __name__ == '__main__':
    asyncio.run(main())
