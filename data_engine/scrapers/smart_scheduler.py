#!/usr/bin/env python3
"""
Smart Auto Refresh Scheduler
=============================
يسحب البيانات فقط وقت ما البورصات شغالة
مع مراعاة أوقات العمل والأجازات الرسمية
"""

import json
import sys
import os
import time
import asyncio
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

# Add config to path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config.market_hours import (
    get_egypt_time, 
    is_market_open, 
    get_market_status,
    get_all_markets_status,
    get_next_market_event,
    MARKET_HOURS_LOCAL
)

# Paths - all unified in /db folder
DATA_DIR = Path(__file__).parent.parent.parent / 'db'
STATUS_FILE = DATA_DIR / 'auto_refresh_status.json'

# Scripts to run
SCRIPTS = {
    'metals_forex': {
        'script': 'metals_forex_fetcher.py',
        'name': 'الذهب والعملات',
        'last_run': None,
        'status': 'idle',
        'markets': None  # يعمل دايماً
    },
    'crypto': {
        'script': 'crypto_fetcher.py',
        'name': 'العملات الرقمية',
        'last_run': None,
        'status': 'idle',
        'markets': None  # يعمل دايماً
    },
    'stocks': {
        'script': 'tradingview_scraper.py',
        'name': 'سحب الأسهم EGX/السعودية/الكويت/قطر',
        'last_run': None,
        'status': 'idle',
        'markets': ['مصر', 'السعودية', 'الكويت', 'قطر']
    },
    'us_stocks': {
        'script': 'us_stock_scraper.py',
        'name': 'سحب الأسهم الأمريكية (NYSE/NASDAQ)',
        'last_run': None,
        'status': 'idle',
        'markets': ['US'],
        # US market hours: 14:30-21:00 UTC (NYSE/NASDAQ open)
        # Outside US hours: hourly EOD refresh
        'market_hours_utc': (14, 30, 21, 0),
    }
}

# Update intervals
METALS_FOREX_INTERVAL = 10 * 60  # 10 minutes (gold prices change frequently)
CRYPTO_INTERVAL = 5 * 60  # 5 minutes (crypto changes fast)
STOCKS_INTERVAL = 2 * 60  # 2 minutes during market hours
US_STOCKS_INTERVAL_INTRA = 5 * 60  # 5 minutes during US market hours (14:30-21:00 UTC)
US_STOCKS_INTERVAL_EOD = 60 * 60  # 1 hour outside US market hours (for EOD updates)

def update_status(status_update):
    """Update status file"""
    try:
        with open(STATUS_FILE, 'r') as f:
            status = json.load(f)
    except:
        status = {
            'running': False,
            'next_run': None,
            'tasks': SCRIPTS,
            'logs': [],
            'market_status': {}
        }
    
    status.update(status_update)
    
    if len(status.get('logs', [])) > 100:
        status['logs'] = status['logs'][-100:]
    
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def log_message(message):
    """Print and log message"""
    timestamp = get_egypt_time().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}")
    
    try:
        with open(STATUS_FILE, 'r') as f:
            status = json.load(f)
    except:
        status = {'logs': []}
    
    status['logs'].append(f"[{timestamp}] {message}")
    if len(status['logs']) > 100:
        status['logs'] = status['logs'][-100:]
    
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def run_script(script_name, script_path):
    """Run a Python script"""
    try:
        log_message(f"🚀 Starting {script_name}...")
        
        result = subprocess.run(
            ['python3', script_path],
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout
        )
        
        if result.returncode == 0:
            log_message(f"✅ {script_name} completed successfully")
            return 'success'
        else:
            log_message(f"⚠️ {script_name} finished with warnings")
            return 'warning'
            
    except subprocess.TimeoutExpired:
        log_message(f"⏰ {script_name} timed out")
        return 'timeout'
    except Exception as e:
        log_message(f"❌ {script_name} error: {str(e)[:50]}")
        return 'error'

def check_markets_open() -> dict:
    """Check which markets are currently open"""
    open_markets = []
    closed_markets = []
    
    for market in MARKET_HOURS_LOCAL.keys():
        is_open, message = is_market_open(market)
        if is_open:
            open_markets.append(market)
        else:
            closed_markets.append(market)
    
    return {
        'open': open_markets,
        'closed': closed_markets,
        'any_open': len(open_markets) > 0
    }

def is_us_market_open() -> bool:
    """
    Check if US market is currently open.
    NYSE/NASDAQ hours: 14:30-21:00 UTC, Mon-Fri.
    """
    now_utc = datetime.utcnow()
    # Monday=0 ... Friday=4; Saturday=5; Sunday=6
    if now_utc.weekday() >= 5:  # weekend
        return False
    us_cfg = SCRIPTS.get('us_stocks', {})
    hours = us_cfg.get('market_hours_utc', (14, 30, 21, 0))
    start_h, start_m, end_h, end_m = hours
    now_minutes = now_utc.hour * 60 + now_utc.minute
    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m
    return start_minutes <= now_minutes <= end_minutes


def run_smart_refresh():
    """Run refresh tasks based on market status"""
    scripts_dir = Path(__file__).parent
    market_status = check_markets_open()

    # Update market status in file
    markets_info = {}
    for market in MARKET_HOURS_LOCAL.keys():
        status = get_market_status(market)
        next_event = get_next_market_event(market)
        markets_info[market] = {
            'name': status['name'],
            'is_open': status['is_open'],
            'status': status['status'],
            'next_event': next_event['message']
        }
    # Add US market info (not in MARKET_HOURS_LOCAL — tracked separately)
    us_open = is_us_market_open()
    markets_info['US'] = {
        'name': 'الأسهم الأمريكية (NYSE/NASDAQ)',
        'is_open': us_open,
        'status': '🟢 مفتوح' if us_open else '🔴 مغلق',
        'next_event': '14:30 UTC open' if not us_open else '21:00 UTC close',
    }

    update_status({'market_status': markets_info})

    # Run metals_forex and crypto (always)
    for task_id in ['metals_forex', 'crypto']:
        task_info = SCRIPTS[task_id]
        script_path = scripts_dir / task_info['script']

        if script_path.exists():
            status = run_script(task_info['name'], str(script_path))
            SCRIPTS[task_id]['status'] = status
            SCRIPTS[task_id]['last_run'] = datetime.now().isoformat()
        else:
            log_message(f"⚠️ Script not found: {task_info['script']}")

    # Run EGX/TADAWUL/KSE/QSE stocks only if any of those markets is open
    if market_status['any_open']:
        log_message(f"📈 الأسواق المفتوحة: {', '.join(market_status['open'])}")

        stocks_task_info = SCRIPTS['stocks']
        stocks_script_path = scripts_dir / stocks_task_info['script']

        if stocks_script_path.exists():
            status = run_script(stocks_task_info['name'], str(stocks_script_path))
            SCRIPTS['stocks']['status'] = status
            SCRIPTS['stocks']['last_run'] = datetime.now().isoformat()
        else:
            log_message(f"⚠️ Script not found: {stocks_task_info['script']}")
    else:
        log_message(f"📉 كل الأسواق المحلية مغلقة - تخطي سحب أسهم EGX")
        SCRIPTS['stocks']['status'] = 'skipped'

    # Run US stocks — always (yfinance serves both intraday + EOD data;
    # the scraper is idempotent via INSERT OR REPLACE on (ticker, date))
    us_task_info = SCRIPTS['us_stocks']
    us_script_path = scripts_dir / us_task_info['script']
    if us_script_path.exists():
        us_label = '🟢 US مفتوح (intraday)' if us_open else '🔴 US مغلق (EOD refresh)'
        log_message(f"🇺🇸 {us_label} - تشغيل US scraper")
        status = run_script(us_task_info['name'], str(us_script_path))
        SCRIPTS['us_stocks']['status'] = status
        SCRIPTS['us_stocks']['last_run'] = datetime.now().isoformat()
    else:
        log_message(f"⚠️ Script not found: {us_task_info['script']}")

    update_status({
        'tasks': SCRIPTS,
        'last_run': datetime.now().isoformat()
    })

def calculate_next_run() -> int:
    """Calculate seconds until next run.

    Decides the wait interval based on the most aggressive schedule:
      - During EGX/TADAWUL/KSE/QSE market hours: STOCKS_INTERVAL (2 min)
      - During US market hours (14:30-21:00 UTC, Mon-Fri): US_STOCKS_INTERVAL_INTRA (5 min)
      - Otherwise (all markets closed): 5 minutes
    """
    market_status = check_markets_open()
    us_open = is_us_market_open()

    if market_status['any_open']:
        # EGX/TADAWUL/KSE/QSE open — most aggressive
        return STOCKS_INTERVAL
    if us_open:
        # US market open — pull every 5 minutes for intraday data
        return US_STOCKS_INTERVAL_INTRA
    # All markets closed — light EOD refresh every hour
    return US_STOCKS_INTERVAL_EOD

def main():
    """Main scheduler loop"""
    os.makedirs(DATA_DIR, exist_ok=True)
    
    log_message("=" * 50)
    log_message("🔄 Smart Auto Refresh Scheduler Started")
    log_message("📊 أوقات العمل: الأحد - الخميس")
    log_message("=" * 50)
    
    # Print market schedule
    print("\n📊 جدول عمل الأسواق:")
    for market in MARKET_HOURS_LOCAL.keys():
        status = get_market_status(market)
        next_event = get_next_market_event(market)
        state = "🟢" if status['is_open'] else "🔴"
        print(f"  {state} {status['name']}: {next_event['message']}")
    print()
    
    update_status({
        'running': True,
        'started_at': datetime.now().isoformat()
    })
    
    # Run immediately on start
    log_message("▶️ Running initial fetch...")
    run_smart_refresh()
    
    # Then run based on schedule
    while True:
        wait_seconds = calculate_next_run()
        next_run = get_egypt_time() + timedelta(seconds=wait_seconds)
        
        update_status({
            'next_run': next_run.strftime('%H:%M:%S'),
            'tasks': SCRIPTS
        })
        
        market_status = check_markets_open()
        if market_status['any_open']:
            log_message(f"⏳ Next run in {wait_seconds//60} min (markets open)")
        else:
            log_message(f"⏳ Next check in {wait_seconds//60} min (markets closed)")
        
        time.sleep(wait_seconds)
        
        log_message("▶️ Running scheduled refresh...")
        run_smart_refresh()

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log_message("🛑 Scheduler stopped by user")
        update_status({'running': False})
    except Exception as e:
        log_message(f"❌ Scheduler error: {str(e)}")
        update_status({'running': False})
        sys.exit(1)
