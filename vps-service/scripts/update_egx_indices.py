#!/usr/bin/env python3
"""
EGX Indices Daily Updater — تحديث يومي لمؤشرات EGX30 و EGX100
================================================================
يُشغّل يومياً بعد إغلاق السوق (15:00 القاهرة) عبر MarketScheduler.
يحاول سحب أحدث بيانات EGX30/EGX100 من المصادر المتاحة.

إذا فشل السحب (لا مصدر متاح)، يحاول استخدام بيانات CSV المرفوعة
كـ fallback.

Usage:
    python3 -m scripts.update_egx_indices
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PRICE_HISTORY_DB = os.environ.get('PRICE_HISTORY_DB', str(_PROJECT_ROOT / 'db' / 'price_history.db'))
STOCKS_DB = os.environ.get('STOCKS_DB', str(_PROJECT_ROOT / 'db' / 'stocks.db'))


class EGXIndicesUpdater:
    """تحديث يومي لمؤشرات EGX30 و EGX100."""

    INDICES = ['EGX30', 'EGX100']

    def __init__(self):
        self.price_history_db = PRICE_HISTORY_DB
        self.stocks_db = STOCKS_DB

    def update_all(self) -> Dict[str, Dict]:
        """تحديث كل المؤشرات."""
        results = {}
        for ticker in self.INDICES:
            try:
                result = self._update_index(ticker)
                results[ticker] = result
                logger.info(f"[EGXUpdater] {ticker}: {result}")
            except Exception as e:
                logger.error(f"[EGXUpdater] {ticker} failed: {e}")
                results[ticker] = {'success': False, 'error': str(e)}
        return results

    def _update_index(self, ticker: str) -> Dict:
        """تحديث مؤشر واحد."""
        # محاولة سحب من مصادر خارجية (إن توفّرت)
        new_data = self._fetch_from_sources(ticker)

        if not new_data:
            # لا مصدر متاح — نستخدم آخر بيانات CSV موجودة
            logger.warning(f"[EGXUpdater] {ticker}: no external source, using existing CSV data")
            return {
                'success': True,
                'source': 'existing_csv',
                'message': f'لا مصدر خارجي متاح — البيانات الحالية محفوظة من CSV'
            }

        # تخزين البيانات الجديدة
        inserted = self._store_data(ticker, new_data)

        return {
            'success': True,
            'source': 'external_api',
            'inserted': inserted,
            'last_date': new_data[-1].get('date') if new_data else None,
        }

    def _fetch_from_sources(self, ticker: str) -> List[Dict]:
        """
        محاولة سحب البيانات من مصادر خارجية.
        حالياً لا يوجد مصدر مباشر مجاني لـ EGX indices.
        يمكن إضافة:
        - investing.com scraper
        - egksco API
        - TradingView TA
        """
        # محاولة 1: investing.com scraper (إن كان متاحاً)
        try:
            data = self._fetch_from_investing(ticker)
            if data:
                return data
        except Exception as e:
            logger.debug(f"[EGXUpdater] investing.com failed for {ticker}: {e}")

        # محاولة 2: Yahoo Finance (إن كان متاحاً)
        try:
            data = self._fetch_from_yahoo(ticker)
            if data:
                return data
        except Exception as e:
            logger.debug(f"[EGXUpdater] Yahoo failed for {ticker}: {e}")

        return []

    def _fetch_from_investing(self, ticker: str) -> List[Dict]:
        """سحب من investing.com (يتطلب مكتبة investing.com scraper)."""
        try:
            import investpy
            # investpy يحتاج اسم مختلف
            name = 'EGX 30' if ticker == 'EGX30' else 'EGX 70'
            df = investpy.get_index_recent_data(
                index=name,
                country='egypt',
                from_date=(datetime.now() - timedelta(days=30)).strftime('%d/%m/%Y'),
                to_date=datetime.now().strftime('%d/%m/%Y'),
            )
            data = []
            for _, row in df.iterrows():
                data.append({
                    'date': str(row['Date']),
                    'open': float(row['Open']),
                    'high': float(row['High']),
                    'low': float(row['Low']),
                    'close': float(row['Close']),
                    'volume': 0,
                })
            return data
        except ImportError:
            return []
        except Exception as e:
            logger.debug(f"[EGXUpdater] investpy error: {e}")
            return []

    def _fetch_from_yahoo(self, ticker: str) -> List[Dict]:
        """سحب من Yahoo Finance (يتطلب yfinance)."""
        try:
            import yfinance as yf
            # Yahoo يستخدم رموز مختلفة
            yahoo_ticker = '^EGX30' if ticker == 'EGX30' else '^EGX100'
            ticker_obj = yf.Ticker(yahoo_ticker)
            df = ticker_obj.history(period='1mo')
            data = []
            for date, row in df.iterrows():
                data.append({
                    'date': date.strftime('%Y-%m-%d'),
                    'open': float(row['Open']),
                    'high': float(row['High']),
                    'low': float(row['Low']),
                    'close': float(row['Close']),
                    'volume': int(row['Volume']),
                })
            return data
        except ImportError:
            return []
        except Exception as e:
            logger.debug(f"[EGXUpdater] yfinance error: {e}")
            return []

    def _store_data(self, ticker: str, data: List[Dict]) -> int:
        """تخزين البيانات في price_history.db."""
        if not data:
            return 0

        conn = sqlite3.connect(self.price_history_db)
        inserted = 0
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    date TEXT NOT NULL,
                    open_price REAL,
                    high_price REAL,
                    low_price REAL,
                    close_price REAL,
                    volume INTEGER DEFAULT 0,
                    source TEXT DEFAULT 'auto_update',
                    created_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(ticker, date)
                )
            """)

            for row in data:
                try:
                    conn.execute("""
                        INSERT OR REPLACE INTO price_history
                        (ticker, date, open_price, high_price, low_price, close_price, volume, source)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'auto_update')
                    """, (
                        ticker,
                        row.get('date'),
                        row.get('open', 0),
                        row.get('high', 0),
                        row.get('low', 0),
                        row.get('close', 0),
                        row.get('volume', 0),
                    ))
                    inserted += 1
                except Exception as e:
                    logger.debug(f"[EGXUpdater] insert error: {e}")

            conn.commit()

            # تحديث egx_indices table
            self._update_indices_table(ticker, len(data))
        finally:
            conn.close()

        return inserted

    def _update_indices_table(self, ticker: str, total_records: int):
        """تحديث جدول egx_indices في stocks.db."""
        try:
            conn = sqlite3.connect(self.stocks_db)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS egx_indices (
                    ticker TEXT PRIMARY KEY,
                    name TEXT,
                    last_updated TEXT,
                    total_records INTEGER DEFAULT 0
                )
            """)
            conn.execute("""
                INSERT OR REPLACE INTO egx_indices (ticker, name, last_updated, total_records)
                VALUES (?, ?, datetime('now'), ?)
            """, (
                ticker,
                'مؤشر EGX 30' if ticker == 'EGX30' else 'مؤشر EGX 100',
                total_records,
            ))
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"[EGXUpdater] indices table update error: {e}")

    def get_status(self) -> Dict:
        """حالة المؤشرات."""
        status = {}
        conn = sqlite3.connect(self.price_history_db)
        for ticker in self.INDICES:
            try:
                count = conn.execute(
                    "SELECT COUNT(*) FROM price_history WHERE ticker = ?", (ticker,)
                ).fetchone()[0]
                last = conn.execute(
                    "SELECT date FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                    (ticker,)
                ).fetchone()
                status[ticker] = {
                    'records': count,
                    'last_date': last[0] if last else None,
                }
            except Exception as e:
                status[ticker] = {'error': str(e)}
        conn.close()
        return status


def main():
    """نقطة الدخول للسكريبت."""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    print(f"\n{'='*60}")
    print(f"📊 EGX Indices Daily Updater")
    print(f"{'='*60}\n")

    updater = EGXIndicesUpdater()

    # Show current status
    print("📋 الوضع الحالي:")
    status = updater.get_status()
    for ticker, info in status.items():
        print(f"  {ticker}: {info.get('records', 0)} records, last: {info.get('last_date', 'N/A')}")

    # Update
    print(f"\n🔄 جارٍ التحديث...")
    results = updater.update_all()

    print(f"\n{'='*60}")
    print(f"📊 النتائج:")
    for ticker, result in results.items():
        print(f"  {ticker}: {result}")

    print(f"\n{'='*60}")
    print("✅ اكتمل التحديث")


if __name__ == '__main__':
    main()
