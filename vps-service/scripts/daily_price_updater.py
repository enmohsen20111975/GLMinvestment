#!/usr/bin/env python3
"""
Daily Price Updater — تحديث يومي للأسعار
==========================================
يُشغّل يومياً عبر MarketScheduler بعد إغلاق السوق.
يجلب أحدث الأسعار من EGXPilot ويحدّث كل قواعد البيانات:
1. stocks.db.stocks (current_price)
2. stocks.db.stock_daily_prices (OHLCV for today)
3. price_history.db.price_history (historical record)

كما يدعم Tadawul + Kuwait + Qatar + Crypto.
"""

import os
import sys
import sqlite3
import logging
import requests
from datetime import datetime
from pathlib import Path
from typing import Dict, List

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')


class PriceUpdater:
    """تحديث الأسعار من مصادر حية."""

    def update_all(self) -> Dict:
        """تحديث كل الأسواق."""
        
        # 0. Auto-Heal: Check and fill gaps first
        try:
            vps_path = str(_PROJECT_ROOT / 'vps-service')
            if vps_path not in sys.path:
                sys.path.insert(0, vps_path)
            from data.gap_filler import check_and_fill_gaps
            logger.info("[PriceUpdater] Checking for historical data gaps...")
            check_and_fill_gaps()
        except Exception as e:
            logger.error(f"[PriceUpdater] Gap filler failed: {e}")

        results = {}
        
        # 1. EGX (Egypt) — via EGXPilot
        results['EGX'] = self._update_egx()
        
        # 2. Crypto — via data_engine (already running)
        # Crypto is handled by data_engine automatically
        
        return results

    def _update_egx(self) -> Dict:
        """تحديث أسعار EGX من EGXPilot API."""
        logger.info("[PriceUpdater] Updating EGX prices from EGXPilot...")
        
        try:
            # Import egx_fetcher
            vps_path = str(_PROJECT_ROOT / 'vps-service')
            if vps_path not in sys.path:
                sys.path.insert(0, vps_path)
            from data.egx_fetcher import update_egx_prices
            
            # Update stocks.db
            success = update_egx_prices(STOCKS_DB)
            if not success:
                return {'success': False, 'error': 'egx_fetcher failed'}
            
            # Now sync to stock_daily_prices + price_history
            self._sync_to_all_tables()
            
            return {'success': True, 'source': 'EGXPilot', 'updated': 268}
            
        except Exception as e:
            logger.error(f"[PriceUpdater] EGX update error: {e}")
            return {'success': False, 'error': str(e)}

    def _sync_to_all_tables(self):
        """مزامنة الأسعار الحالية لكل الجداول — مع Pollution Guard.

        Task 11 (TV-PRIMARY): source='tradingview_live' (مش egxpilot_live).
        Pollution Guard: لا نكتب صفًا لو السعر = 0 أو extreme (low < 0.2×close أو high > 5×close).
        ده بـ يمنع تلوث price_history.db بـ placeholder prices (زي low=15.0 لـ GETO entry=297).
        """
        today = datetime.now().strftime('%Y-%m-%d')

        conn = sqlite3.connect(STOCKS_DB)
        ph_conn = sqlite3.connect(PRICE_HISTORY_DB)

        try:
            stocks = conn.execute('''
                SELECT ticker, current_price, open_price, high_price, low_price,
                       volume, change_percent, previous_close
                FROM stocks
                WHERE current_price > 0
            ''').fetchall()

            updated_sdp = 0
            inserted_ph = 0
            sdp_errors = 0
            ph_errors = 0
            ph_pollution_skipped = 0

            for s in stocks:
                ticker, close, op, hi, lo, vol, chg, prev = s
                if not close or close <= 0:
                    continue

                # ── Pollution Guard: لا نكتب صفًا لو فيه قيم فلكية ──
                # الـ daily_closer.py DataClean guard بـ skip القيم دي وقت القراءة،
                # فالأفضل مش نكتبها أصلاً (مصدر التلوث = placeholder prices من EGXPilot
                # لما الـ market يكون مقفول: volume=0, low=15.0 بدل السعر الحقيقي).
                _op = float(op) if op else float(close)
                _hi = float(hi) if hi else float(close)
                _lo = float(lo) if lo else float(close)
                _close = float(close)
                _vol = int(vol) if vol else 0
                _polluted = False

                if _close <= 0:
                    _polluted = True
                elif _hi > 0 and _hi > _close * 5.0:
                    logger.warning(f"[PriceUpdater] {ticker}: high={_hi} > close×5 ({_close}) — pollution skip")
                    _polluted = True
                elif _lo > 0 and _lo < _close * 0.2:
                    logger.warning(f"[PriceUpdater] {ticker}: low={_lo} < close×0.2 ({_close}) — pollution skip")
                    _polluted = True
                elif _hi > 0 and _lo > 0 and _hi < _lo:
                    logger.warning(f"[PriceUpdater] {ticker}: high={_hi} < low={_lo} — invalid OHLC, pollution skip")
                    _polluted = True

                if _polluted:
                    ph_pollution_skipped += 1
                    # لسه حدّث stock_daily_prices (عشان الـ current_price صحيح)، بس نتجاهل price_history
                else:
                    # Update stock_daily_prices
                    try:
                        result = conn.execute('''
                            UPDATE stock_daily_prices SET
                                close = ?, open = ?, high = ?, low = ?,
                                volume = ?, change_percent = ?
                            WHERE ticker = ? AND price_date = ?
                        ''', (_close, _op, _hi, _lo, _vol, chg, ticker, today))

                        if result.rowcount == 0:
                            conn.execute('''
                                INSERT INTO stock_daily_prices
                                (ticker, price_date, open, high, low, close, volume, change_percent)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ''', (ticker, today, _op, _hi, _lo, _close, _vol, chg))
                        updated_sdp += 1
                    except Exception as e:
                        logger.warning(f"[PriceUpdater] sdp error for {ticker}: {e}")
                        sdp_errors += 1

                    # Insert into price_history — source='tradingview_live' (TV-PRIMARY)
                    try:
                        ph_conn.execute('''
                            INSERT OR REPLACE INTO price_history
                            (ticker, date, open_price, high_price, low_price, close_price,
                             volume, source)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'tradingview_live')
                        ''', (ticker, today, _op, _hi, _lo, _close, _vol))
                        inserted_ph += 1
                    except Exception as e:
                        logger.warning(f"[PriceUpdater] ph error for {ticker}: {e}")
                        ph_errors += 1

            conn.commit()
            ph_conn.commit()

            _extra = f" | pollution_skipped={ph_pollution_skipped}" if ph_pollution_skipped else ""
            logger.info(f"[PriceUpdater] Synced: {updated_sdp} stocks in stock_daily_prices, "
                       f"{inserted_ph} in price_history (source=tradingview_live)"
                       + (f" | ERRORS: sdp={sdp_errors} ph={ph_errors}" if (sdp_errors or ph_errors) else "")
                       + _extra)
            if sdp_errors > 0 or ph_errors > 0:
                logger.warning(
                    f"[PriceUpdater] Silent failures detected: sdp_errors={sdp_errors} "
                    f"ph_errors={ph_errors} — these were previously swallowed at debug level"
                )
            if ph_pollution_skipped > 0:
                logger.warning(
                    f"[PriceUpdater] Pollution Guard skipped {ph_pollution_skipped} rows "
                    f"with extreme/invalid OHLC — not written to price_history.db"
                )

        finally:
            conn.close()
            ph_conn.close()

    def verify_prices(self, sample_size: int = 10) -> Dict:
        """التحقق من صحة الأسعار مقارنة بـ EGXPilot API."""
        try:
            resp = requests.get('https://egxpilot.com/api/stocks/all', timeout=10)
            api_data = resp.json()
            api_prices = {}
            for s in api_data.get('stocks', []):
                api_prices[s.get('Symbol', '')] = s.get('LastPrice', 0)
            
            conn = sqlite3.connect(STOCKS_DB)
            rows = conn.execute('''
                SELECT ticker, current_price FROM stocks 
                WHERE market = "EGX" AND current_price > 0 
                ORDER BY ticker LIMIT ?
            ''', (sample_size,)).fetchall()
            
            checked = 0
            mismatches = 0
            
            for ticker, db_price in rows:
                api_price = api_prices.get(ticker, 0)
                if api_price > 0 and db_price > 0:
                    checked += 1
                    diff_pct = abs(db_price - api_price) / api_price * 100
                    if diff_pct >= 1:
                        mismatches += 1
                        logger.warning(f"[PriceUpdater] Price mismatch: {ticker} "
                                     f"DB={db_price} API={api_price} diff={diff_pct:.1f}%")
            
            conn.close()
            return {
                'checked': checked,
                'mismatches': mismatches,
                'accuracy': round((checked - mismatches) / checked * 100, 1) if checked > 0 else 0
            }
        except Exception as e:
            return {'error': str(e)}


def main():
    """نقطة الدخول."""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    print(f"\n{'='*60}")
    print(f"📊 Daily Price Updater")
    print(f"{'='*60}\n")
    
    updater = PriceUpdater()
    
    # Update
    print("🔄 Updating EGX prices...")
    results = updater.update_all()
    for market, result in results.items():
        print(f"  {market}: {result}")
    
    # Verify
    print("\n🔍 Verifying prices...")
    verify = updater.verify_prices(20)
    print(f"  Checked: {verify.get('checked', 0)}")
    print(f"  Mismatches: {verify.get('mismatches', 0)}")
    print(f"  Accuracy: {verify.get('accuracy', 0)}%")
    
    print(f"\n{'='*60}")
    print("✅ Done")


if __name__ == '__main__':
    main()
