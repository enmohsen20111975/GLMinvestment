import sqlite3
from datetime import datetime, timedelta
import logging
from pathlib import Path
import time
import os

# ── Task 11: LAZY yfinance import (graceful degradation) ──
# لو yfinance مش متاح (زي VPS)، الـ module ده كان بـ crash عند import.
# خلّينا الـ import lazy + flag، و check_and_fill_gaps() بـ return early بـ warning.
# الـ daily_price_updater بـ يكمل للـ TV-primary update بدون crash.
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    yf = None
    YFINANCE_AVAILABLE = False

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')

def get_last_recorded_date() -> datetime:
    """Returns the last date we have prices for in price_history.db."""
    if not os.path.exists(PRICE_HISTORY_DB):
        return None
    
    try:
        conn = sqlite3.connect(PRICE_HISTORY_DB)
        cur = conn.cursor()
        cur.execute("SELECT MAX(date) FROM price_history")
        row = cur.fetchone()
        conn.close()
        
        if row and row[0]:
            return datetime.strptime(row[0], '%Y-%m-%d')
    except Exception as e:
        logger.error(f"[GapFiller] Error reading last date: {e}")
    
    return None

def check_and_fill_gaps(force_days=None, force=False):
    """
    Checks for missing days in price_history and fills the gap using Yahoo Finance.
    If force_days is provided, fetches that many days regardless.
    If force=True, bypasses the delta<=1 skip (always run).

    Task 11: لو yfinance مش متاح، بـ log warning و بـ return بدون crash.
    الـ daily_price_updater بـ يكمل للـ TV-primary update.
    """
    if not YFINANCE_AVAILABLE:
        logger.warning(
            "[GapFiller] yfinance مش متاح — تخطّي gap fill. "
            "للتثبيت: pip install yfinance. "
            "(الـ daily_price_updater هيكمل للـ TV-primary update.)"
        )
        return

    if not os.path.exists(STOCKS_DB) or not os.path.exists(PRICE_HISTORY_DB):
        logger.error("[GapFiller] DB files not found!")
        return

    days_to_fetch = force_days
    
    if days_to_fetch is None:
        last_date = get_last_recorded_date()
        if not last_date:
            logger.info("[GapFiller] No historical data found. Defaulting to 30 days.")
            days_to_fetch = 30
        else:
            delta = (datetime.now() - last_date).days
            # 🔥 P0 FIX: كان delta <= 1 بـ يكسل حتة لو فات يوم واحد — ده بالظبط
            # لما السوق يقفل ويفتح تاني. غيرناه لـ delta < 1 (يعني skip بس لو
            # اليوم ده بالظبط آخر يوم مسجّل). وكمان بنحترم force=True.
            if delta < 1 and not force:
                logger.info(f"[GapFiller] Data is up to date (last record: {last_date.date()}). No gap to fill.")
                return
            if delta < 1 and force:
                # force mode: لو last_date هو النهاردة، اسحب آخر 5 أيام (overlapping refresh)
                days_to_fetch = 5
                logger.info(f"[GapFiller] Force mode: refreshing last {days_to_fetch} days.")
            else:
                logger.warning(f"[GapFiller] Found a gap of {delta} days! Auto-filling...")
                days_to_fetch = delta + 1 # Add 1 to ensure overlap

    # Cap to max 30 to avoid abuse/rate limits if the gap is huge
    if days_to_fetch > 30:
        days_to_fetch = 30
        logger.warning(f"[GapFiller] Gap is too large. Capped at {days_to_fetch} days.")

    logger.info(f"[GapFiller] Connecting to databases to fetch {days_to_fetch} days...")
    s_conn = sqlite3.connect(STOCKS_DB)
    ph_conn = sqlite3.connect(PRICE_HISTORY_DB)

    # Get all active stocks with their market
    cur = s_conn.execute("SELECT ticker, market FROM stocks")
    stocks = cur.fetchall()
    
    # Calculate dates
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_to_fetch)
    
    total_updated = 0
    total_ph = 0

    market_suffixes = {
        'EGX': '.CA',
        'TADAWUL': '.SR',
        'KSE': '.KW',
        'QSE': '.QA',
        'US': ''
    }

    # Process in batches to avoid overwhelming yfinance
    # RESCUE-OPS (2026-08-15): yfinance لا يدعم أسهم EGX بشكل موثوق.
    # كل tickers بـ suffix '.CA' بترجع "possibly delisted; no price data found".
    # بدلاً من إضاعة الوقت + تسجيل أخطاء كاذبة، بنـ skip EGX ونسيبها لـ
    # daily_price_updater.py (اللى بيستخدم EGXPilot API — المصدر الصحيح للـ EGX).
    skipped_egx = 0
    for i, (ticker, market) in enumerate(stocks):
        if market == 'EGX':
            skipped_egx += 1
            continue  # yfinance doesn't support EGX — use daily_price_updater.py instead
        suffix = market_suffixes.get(market, '')
        yf_ticker = f"{ticker}{suffix}"
        
        try:
            stock = yf.Ticker(yf_ticker)
            df = stock.history(start=start_date.strftime('%Y-%m-%d'), end=end_date.strftime('%Y-%m-%d'))
            
            if df.empty:
                continue

            for date, row in df.iterrows():
                date_str = date.strftime('%Y-%m-%d')
                open_p, high_p, low_p, close_p, vol = row['Open'], row['High'], row['Low'], row['Close'], row['Volume']
                
                if not close_p or str(close_p) == 'nan':
                    continue

                # 1. Update stock_daily_prices
                s_conn.execute('''
                    INSERT OR IGNORE INTO stock_daily_prices 
                    (ticker, price_date, open, high, low, close, volume, change_percent)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                ''', (ticker, date_str, open_p, high_p, low_p, close_p, vol))
                
                s_conn.execute('''
                    UPDATE stock_daily_prices
                    SET open = ?, high = ?, low = ?, close = ?, volume = ?
                    WHERE ticker = ? AND price_date = ?
                ''', (open_p, high_p, low_p, close_p, vol, ticker, date_str))
                total_updated += 1
                
                # 2. Update price_history via write_guarded (Rule 66 — Task 23-B)
                # source='yfinance_autofill' is NOT in any market's canonical hierarchy
                # → guard will SKIP; canonical writer per market takes precedence.
                write_guarded(
                    db_path=PRICE_HISTORY_DB,
                    ticker=ticker,
                    market=market,
                    date=date_str,
                    open_price=open_p,
                    high_price=high_p,
                    low_price=low_p,
                    close_price=close_p,
                    volume=vol,
                    source='yfinance_autofill',
                )
                total_ph += 1

            s_conn.commit()
            ph_conn.commit()
        except Exception as e:
            # 🔥 P0 FIX: كان logger.debug (صامت) → بقى logger.warning عشان نشوف الفشل
            logger.warning(f"[GapFiller] Failed to fetch {ticker}: {e}")
        
        # Sleep slightly to respect rate limits
        time.sleep(0.3)

    s_conn.close()
    ph_conn.close()
    if skipped_egx > 0:
        logger.info(f"[GapFiller] Skipped {skipped_egx} EGX tickers (yfinance unsupported — use daily_price_updater.py / EGXPilot instead).")
    logger.info(f"[GapFiller] Done! Filled gap. Updated {total_updated} daily prices, {total_ph} historical records.")

if __name__ == '__main__':
    check_and_fill_gaps()
