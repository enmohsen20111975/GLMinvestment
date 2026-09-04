#!/usr/bin/env python3
"""
Master Scheduler for all scrapers + services.
يشغل كل الـ scrapers على فترات منتظمة (in-process، بدون cron خارجي).

Rule 29 (UNIFIED-SYSTEM): كل الـ schedulers في مكان واحد.
Rule 24 (SAFE-BY-DESIGN): لو أي scraper فشل، الباقي يكمل.
"""
import os, sys, time, threading, schedule, logging
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT / 'news-agent' / 'collectors' / 'scrappers'))
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('scheduler')

# === Scraper functions ===

def run_daleelak():
    """كل 30 دقيقة — أسعار العملات + الذهب من Daleelak API."""
    try:
        from daleelak_api import fetch_and_save
        result = fetch_and_save()
        log.info(f'✓ Daleelak: {result}')
    except Exception as e:
        log.error(f'✗ Daleelak failed: {e}')

def run_tradingview_rest():
    """كل 5 دقايق — بيانات EGX stocks من TradingView REST."""
    try:
        from tradingview_rest import fetch_tradingview_stocks_and_save
        result = fetch_tradingview_stocks_and_save('egypt')
        log.info(f'✓ TradingView REST: {result.get("stocks_count", 0)} stocks')
    except Exception as e:
        log.error(f'✗ TradingView REST failed: {e}')

def run_crypto_fetcher():
    """كل 2 دقيقة — أسعار الكريبتو."""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / 'data_engine' / 'scrapers'))
        from crypto_fetcher import fetch_all_crypto
        result = fetch_all_crypto()
        log.info(f'✓ Crypto fetcher: {result}')
    except Exception as e:
        log.error(f'✗ Crypto fetcher failed: {e}')

def run_metals_fetcher():
    """كل 15 دقيقة — الذهب + الفضة + العملات (fallback for Daleelak)."""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / 'data_engine' / 'scrapers'))
        from metals_forex_fetcher import main as metals_main
        result = metals_main()
        log.info(f'✓ Metals fetcher: {result}')
    except Exception as e:
        log.error(f'✗ Metals fetcher failed: {e}')

def run_egksco_scraper():
    """كل 15 دقيقة (09:00-14:30 Cairo) — EGX live prices."""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / 'data_engine' / 'scrapers'))
        from egksco_scraper import main as egksco_main
        result = egksco_main()
        log.info(f'✓ EGKSCO scraper: {result}')
    except Exception as e:
        log.error(f'✗ EGKSCO scraper failed: {e}')

def run_health_check():
    """كل ساعة — فحص شامل للنظام."""
    try:
        import sqlite3
        dbs = ['stocks.db', 'data_engine.db', 'news.db', 'predictions.db']
        for db in dbs:
            path = PROJECT_ROOT / 'db' / db
            if not path.exists():
                log.warning(f'⚠ {db} missing!')
                continue
            c = sqlite3.connect(str(path), timeout=3)
            r = c.execute('PRAGMA integrity_check').fetchone()[0]
            c.close()
            if r != 'ok':
                log.error(f'✗ {db} integrity: {r}')
        log.info('✓ Health check OK')
    except Exception as e:
        log.error(f'✗ Health check failed: {e}')


# === Schedule ===

def setup_schedule():
    """تنظيم كل الـ jobs."""
    # Every 5 minutes
    schedule.every(5).minutes.do(run_tradingview_rest)
    # Every 2 minutes
    schedule.every(2).minutes.do(run_crypto_fetcher)
    # Every 15 minutes
    schedule.every(15).minutes.do(run_metals_fetcher)
    schedule.every(15).minutes.do(run_egksco_scraper)
    # Every 30 minutes
    schedule.every(30).minutes.do(run_daleelak)
    # Every hour
    schedule.every().hour.do(run_health_check)
    
    log.info('='*60)
    log.info('Master Scheduler started')
    log.info('='*60)
    log.info('Jobs:')
    log.info('  • TradingView REST: every 5 min')
    log.info('  • Crypto fetcher: every 2 min')
    log.info('  • Metals + EGKSCO: every 15 min')
    log.info('  • Daleelak (forex/gold): every 30 min')
    log.info('  • Health check: every hour')
    log.info('='*60)


def main():
    setup_schedule()
    # Initial run of all scrapers
    log.info('Running initial scrape...')
    run_tradingview_rest()
    run_crypto_fetcher()
    run_daleelak()
    run_health_check()
    
    # Then loop
    while True:
        schedule.run_pending()
        time.sleep(60)  # Check every minute


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log.info('Scheduler stopped by user')
    except Exception as e:
        log.error(f'Scheduler crashed: {e}')
        raise
