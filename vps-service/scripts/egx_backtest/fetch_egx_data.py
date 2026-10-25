#!/usr/bin/env python3
"""
fetch_egx_data.py — EGX Historical Data Fetcher
=================================================
يجلب بيانات أسعار EGX التاريخية من Yahoo Finance ويخزنها في price_history.db

الأسهم المستهدفة: 20-30 سهم نشط من البورصة المصرية
الفترة: 2021-01-01 → اليوم
التردد: يومي

Usage:
  python3 scripts/egx_backtest/fetch_egx_data.py
  python3 scripts/egx_backtest/fetch_egx_data.py --full     # إعادة تحميل كاملة
"""

from __future__ import annotations
import requests
import sqlite3
import time
import datetime
import json
import sys
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ============================================================================
# CONFIGURATION
# ============================================================================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')

# EGX stocks with Yahoo Finance ticker format (.CA = Cairo exchange)
EGX_STOCKS = {
    # البنوك والمالية
    'COMI': {'name': 'البنك التجاري الدولي', 'sector': 'القطاع المالي', 'yf': 'COMI.CA'},
    'HRHO': {'name': 'إيفج هرمس', 'sector': 'القطاع المالي', 'yf': 'HRHO.CA'},
    'BTFH': {'name': 'بلتون المالية', 'sector': 'القطاع المالي', 'yf': 'BTFH.CA'},
    'EKHO': {'name': 'الخليج الكندي', 'sector': 'القطاع المالي', 'yf': 'EKHO.CA'},
    'CCAP': {'name': 'سيرا', 'sector': 'القطاع المالي', 'yf': 'CCAP.CA'},
    
    # الاتصالات والتكنولوجيا
    'ETEL': {'name': 'المصرية للاتصالات', 'sector': 'الاتصالات', 'yf': 'ETEL.CA'},
    'FWRY': {'name': 'فوري', 'sector': 'التكنولوجيا', 'yf': 'FWRY.CA'},
    'ISPH': {'name': 'إيسف', 'sector': 'التكنولوجيا', 'yf': 'ISPH.CA'},
    
    # الصناعة والطاقة
    'SWDY': {'name': 'السويدي إلكتريك', 'sector': 'الصناعة', 'yf': 'SWDY.CA'},
    'ORAS': {'name': 'أوراسكوم للإنشاءات', 'sector': 'الصناعة', 'yf': 'ORAS.CA'},
    'OCDI': {'name': 'أوراسكوم للتنمية', 'sector': 'العقارات', 'yf': 'OCDI.CA'},
    'AMOC': {'name': 'alexandria minerals', 'sector': 'التعدين', 'yf': 'AMOC.CA'},
    'SKPC': {'name': 'سيدى كرير', 'sector': 'الطاقة', 'yf': 'SKPC.CA'},
    
    # العقارات والسياحة
    'EMFD': {'name': 'السويدي للكابلات', 'sector': 'الصناعة', 'yf': 'EMFD.CA'},
    'EGTS': {'name': 'السياحة المصرية', 'sector': 'السياحة', 'yf': 'EGTS.CA'},
    'RMDA': {'name': 'ريمكو', 'sector': 'السياحة', 'yf': 'RMDA.CA'},
    
    # إضافات هامة
    'ALCN': {'name': 'القاهرة للاستثمار', 'sector': 'القطاع المالي', 'yf': 'ALCN.CA'},
    'TMGH': {'name': 'الشروق للأ驹ار', 'sector': 'النسيج', 'yf': 'TMGH.CA'},
    'PHDC': {'name': 'بالما للتنمية', 'sector': 'العقارات', 'yf': 'PHDC.CA'},
    'NWEH': {'name': 'النيل للمحاصيل', 'sector': 'الغذاء', 'yf': 'NWEH.CA'},
}

# Periods
PERIOD_START = 1609459200   # 2021-01-01
PERIOD_END = None            # Today


class EGXDataFetcher:
    """Fetches EGX historical data from Yahoo Finance"""
    
    def __init__(self, db_path: str = PRICE_HISTORY_DB):
        self.db_path = db_path
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self._init_db()
    
    def _init_db(self):
        """Initialize the price_history database"""
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=True)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                source TEXT DEFAULT 'yahoo_finance',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, date, source)
            )
        ''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_ph_ticker_date ON price_history(ticker, date)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_ph_date ON price_history(date)')
        conn.commit()
        conn.close()
        print(f"✅ Database initialized: {self.db_path}")
    
    def fetch_stock(self, ticker: str, yf_ticker: str, 
                    start_ts: int = None, end_ts: int = None) -> int:
        """Fetch historical data for one stock from Yahoo Finance"""
        if start_ts is None:
            start_ts = PERIOD_START
        if end_ts is None:
            end_ts = int(time.time())
        
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{yf_ticker}'
        params = {
            'period1': str(start_ts),
            'period2': str(end_ts),
            'interval': '1d'
        }
        
        try:
            resp = self.session.get(url, params=params, timeout=15)
            if resp.status_code == 429:
                print(f"  ⚠️ Rate limited for {ticker}, waiting 30s...")
                time.sleep(30)
                resp = self.session.get(url, params=params, timeout=15)
            
            if resp.status_code != 200:
                print(f"  ❌ {ticker} ({yf_ticker}): HTTP {resp.status_code}")
                return 0
            
            data = resp.json()
            result = data.get('chart', {}).get('result', [{}])[0]
            timestamps = result.get('timestamp', [])
            quotes = result.get('indicators', {}).get('quote', [{}])[0]
            
            if not timestamps:
                print(f"  ❌ {ticker}: No data")
                return 0
            
            # Insert into database
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            c = conn.cursor()
            inserted = 0
            
            for i, ts in enumerate(timestamps):
                dt = datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
                
                close = quotes.get('close', [None])[i] if i < len(quotes.get('close', [])) else None
                if close is None:
                    continue
                
                open_p = quotes.get('open', [None])[i] if i < len(quotes.get('open', [])) else None
                high_p = quotes.get('high', [None])[i] if i < len(quotes.get('high', [])) else None
                low_p = quotes.get('low', [None])[i] if i < len(quotes.get('low', [])) else None
                vol = quotes.get('volume', [None])[i] if i < len(quotes.get('volume', [])) else 0
                
                try:
                    c.execute('''
                        INSERT OR REPLACE INTO price_history 
                        (ticker, date, open_price, high_price, low_price, close_price, volume, source)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'yahoo_finance')
                    ''', (ticker, dt, open_p, high_p, low_p, close_p, int(vol) if vol else 0))
                    inserted += 1
                except Exception as e:
                    pass
            
            conn.commit()
            conn.close()
            
            print(f"  ✅ {ticker}: {inserted} bars ({timestamps[0] and datetime.datetime.fromtimestamp(timestamps[0]).date()} → "
                  f"{timestamps[-1] and datetime.datetime.fromtimestamp(timestamps[-1]).date()})")
            return inserted
            
        except Exception as e:
            print(f"  ❌ {ticker}: {str(e)[:80]}")
            return 0
    
    def fetch_all(self, force: bool = False) -> Dict:
        """Fetch data for all EGX stocks"""
        print(f"\n📥 جلب بيانات EGX التاريخية من Yahoo Finance")
        print(f"   عدد الأسهم: {len(EGX_STOCKS)}")
        print(f"   الفترة: 2021-01-01 → اليوم")
        print()
        
        results = {'success': 0, 'failed': 0, 'total_bars': 0}
        
        for ticker, info in EGX_STOCKS.items():
            yf_ticker = info['yf']
            name = info['name']
            
            # Check if we already have recent data
            if not force:
                try:
                    # Phase 7.1: migrated to db_manager (writable=False)
                    from core.db_manager import db_manager
                    conn = db_manager.get_connection(self.db_path, writable=False)
                    c = conn.cursor()
                    c.execute('SELECT MAX(date) FROM price_history WHERE ticker=?', (ticker,))
                    latest = c.fetchone()[0]
                    conn.close()
                    if latest and latest >= datetime.date.today().strftime('%Y-%m-%d'):
                        print(f"  ⏩ {ticker} ({name}): بيانات حديثة ({latest})")
                        results['success'] += 1
                        continue
                except:
                    pass
            
            count = self.fetch_stock(ticker, yf_ticker)
            if count > 0:
                results['success'] += 1
                results['total_bars'] += count
            else:
                results['failed'] += 1
            
            # Rate limiting
            time.sleep(1)
        
        print(f"\n📊 النتيجة:")
        print(f"   نجاح: {results['success']} | فشل: {results['failed']} | إجمالي البيانات: {results['total_bars']:,} شريط")
        return results


def main():
    force = '--full' in sys.argv
    fetcher = EGXDataFetcher()
    fetcher.fetch_all(force=force)
    
    # Print summary
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(PRICE_HISTORY_DB, writable=False)
    c = conn.cursor()
    c.execute('SELECT COUNT(DISTINCT ticker) FROM price_history')
    tickers = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM price_history')
    total = c.fetchone()[0]
    c.execute('SELECT MIN(date), MAX(date) FROM price_history')
    dates = c.fetchone()
    c.execute('SELECT ticker, COUNT(*), MIN(date), MAX(date) FROM price_history GROUP BY ticker ORDER BY ticker')
    print(f"\n📋 ملخص قاعدة البيانات:")
    print(f"   أسهم: {tickers} | إجمالي: {total:,} | الفترة: {dates[0]} → {dates[1]}")
    for row in c.fetchall():
        print(f"   {row[0]}: {row[1]:,} شريط ({row[2]} → {row[3]})")
    conn.close()


if __name__ == '__main__':
    main()
