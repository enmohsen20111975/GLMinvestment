#!/usr/bin/env python3
"""
Technical Indicators Fetcher
============================
سحب المؤشرات الفنية (RSI, MACD, Recommendations) من TradingView
بديل عن TradingView TA Library اللي مش شغال

الطريقة: Scraping صفحة التحليل الفني لكل سهم
"""

import json
import sys
import os
import asyncio
from datetime import datetime
from playwright.async_api import async_playwright

# Paths - all unified in /db folder
from pathlib import Path
_BASE_DIR = Path(__file__).parent.parent.parent
DATA_DIR = _BASE_DIR / 'db'
STATUS_FILE = DATA_DIR / 'technical_status.json'

# Stock tickers by market
MARKET_TICKERS = {
    'مصر': {
        'exchange': 'EGX',
        'tickers': [
            ('COMI', 'Commercial International Bank'),
            ('ETEL', 'Telecom Egypt'),
            ('HRHO', 'Heliopolis Housing'),
            ('EAST', 'Eastern Company'),
            ('SWDY', 'Elsewedy Electric'),
            ('AMOC', 'Alexandria Mineral Oils'),
            ('ESRS', 'Ezz Steel'),
            ('FWRY', 'Fawry'),
        ]
    },
    'الكويت': {
        'exchange': 'KUWAIT',
        'tickers': [
            ('NBK', 'National Bank of Kuwait'),
            ('KFH', 'Kuwait Finance House'),
            ('ZAIN', 'Zain'),
            ('OORED', 'Ooredoo'),
            ('AGON', 'Agility'),
        ]
    },
    'قطر': {
        'exchange': 'QATAR',
        'tickers': [
            ('QNB', 'Qatar National Bank'),
            ('MAS', 'Masraf Al Rayan'),
            ('QIBK', 'Qatar Islamic Bank'),
            ('OORE', 'Ooredoo Qatar'),
            ('INDO', 'Industries Qatar'),
        ]
    }
}

def update_status(status_update):
    """Update the status file"""
    try:
        with open(STATUS_FILE, 'r') as f:
            status = json.load(f)
    except:
        status = {
            'running': True,
            'progress': {'market': '', 'current': 0, 'total': 0},
            'logs': [],
            'results': [],
            'startTime': datetime.now().isoformat()
        }
    
    status.update(status_update)
    
    if len(status.get('logs', [])) > 100:
        status['logs'] = status['logs'][-100:]
    
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def log_message(message):
    """Print and log a message"""
    print(f"[LOG] {message}")
    update_status({'logs': [f"[{datetime.now().strftime('%H:%M:%S')}] {message}"]})

async def fetch_technical_data(page, ticker, exchange):
    """Fetch technical data for a single ticker"""
    try:
        # Build TradingView URL
        if exchange == 'EGX':
            url = f"https://www.tradingview.com/symbols/EGX-{ticker}/"
        elif exchange == 'KUWAIT':
            url = f"https://www.tradingview.com/symbols/KUWAIT-{ticker}/"
        elif exchange == 'QATAR':
            url = f"https://www.tradingview.com/symbols/QATAR-{ticker}/"
        else:
            url = f"https://www.tradingview.com/symbols/{exchange}-{ticker}/"
        
        await page.goto(url, timeout=30000, wait_until='networkidle')
        await asyncio.sleep(2)
        
        # Extract technical indicators from page
        data = await page.evaluate('''
            () => {
                const result = {
                    price: 0,
                    rsi: null,
                    macd: null,
                    recommendation: 'NEUTRAL'
                };
                
                // Try to get price
                const priceEl = document.querySelector('[class*="last"], [class*="price"]');
                if (priceEl) {
                    const priceText = priceEl.textContent || '';
                    const priceMatch = priceText.match(/[\\d,]+\\.?\\d*/);
                    if (priceMatch) {
                        result.price = parseFloat(priceMatch[0].replace(/,/g, ''));
                    }
                }
                
                // Try to get technical indicators
                const indicators = document.querySelectorAll('[class*="indicator"], [class*="technical"]');
                indicators.forEach(ind => {
                    const text = ind.textContent || '';
                    if (text.includes('RSI')) {
                        const match = text.match(/RSI[^\\d]*(\\d+\\.?\\d*)/i);
                        if (match) result.rsi = parseFloat(match[1]);
                    }
                    if (text.includes('MACD')) {
                        const match = text.match(/MACD[^\\d]*-?\\d+\\.?\\d*/i);
                        if (match) result.macd = parseFloat(match[0].replace(/[^\\d.-]/g, ''));
                    }
                });
                
                // Try to get recommendation
                const recEl = document.querySelector('[class*="recommendation"], [class*="summary"]');
                if (recEl) {
                    const text = recEl.textContent || '';
                    if (text.includes('Buy') || text.includes('شراء')) result.recommendation = 'BUY';
                    else if (text.includes('Sell') || text.includes('بيع')) result.recommendation = 'SELL';
                }
                
                return result;
            }
        ''')
        
        return data
        
    except Exception as e:
        log_message(f"Error fetching {ticker}: {str(e)[:50]}")
        return {
            price: 0,
            rsi: None,
            macd: None,
            recommendation: 'ERROR',
            error: str(e)
        }

async def fetch_all_technical():
    """Fetch technical data for all tickers"""
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Initialize status
    update_status({
        'running': True,
        'progress': {'market': '', 'current': 0, 'total': 0},
        'logs': [],
        'results': [],
        'startTime': datetime.now().isoformat()
    })
    
    log_message("Starting Technical Indicators Fetch...")
    
    all_results = []
    total_tickers = sum(len(m['tickers']) for m in MARKET_TICKERS.values())
    current = 0
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = await context.new_page()
        
        for market_name, market_data in MARKET_TICKERS.items():
            log_message(f"Processing {market_name}...")
            
            for ticker, name in market_data['tickers']:
                current += 1
                update_status({
                    'progress': {
                        'market': market_name,
                        'current': current,
                        'total': total_tickers
                    }
                })
                
                data = await fetch_technical_data(page, ticker, market_data['exchange'])
                
                result = {
                    'ticker': f"{market_data['exchange']}:{ticker}",
                    'name': name,
                    'market': market_name,
                    'price': data.get('price', 0),
                    'rsi': data.get('rsi'),
                    'macd': data.get('macd'),
                    'recommendation': data.get('recommendation', 'NEUTRAL')
                }
                
                all_results.append(result)
                log_message(f"✓ {ticker}: {result['recommendation']}")
                
                await asyncio.sleep(1)  # Be nice to the server
        
        await browser.close()
    
    # Update final status
    update_status({
        'running': False,
        'results': all_results,
        'logs': [f"[{datetime.now().strftime('%H:%M:%S')}] Completed! Total: {len(all_results)} stocks"]
    })
    
    log_message(f"Technical Analysis Complete! Total: {len(all_results)} stocks")
    
    # Save to JSON
    output_file = os.path.join(DATA_DIR, 'technical_data.json')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    
    return all_results

if __name__ == '__main__':
    try:
        asyncio.run(fetch_all_technical())
    except Exception as e:
        update_status({
            'running': False,
            'logs': [f"[ERROR] {str(e)}"]
        })
        print(f"ERROR: {e}")
        sys.exit(1)
