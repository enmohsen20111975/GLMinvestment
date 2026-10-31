"""
simple_data_adapter.py — يقرأ من data_engine.db مباشرة (بدون data_layer.py)
"""
import sqlite3, re
from pathlib import Path
from dataclasses import dataclass
from typing import List, Optional

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = _PROJECT_ROOT / 'db' / 'data_engine.db'

def _parse_vol(v):
    if v is None: return 0.0
    s = str(v).replace('\u202f', '').strip()
    try: return float(s)
    except:
        m = re.match(r'^([\d.]+)([KMB])?$', s)
        if m: return float(m.group(1)) * {'K': 1e3, 'M': 1e6, 'B': 1e9}.get(m.group(2), 1)
        return 0.0

@dataclass
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float

class SimpleDataAdapter:
    def __init__(self):
        self.db_path = str(DB_PATH)
    
    def get_symbols(self, market='EGX'):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        if market == 'EGX':
            cur.execute("SELECT DISTINCT symbol FROM egksco_price_history WHERE close_price > 0 ORDER BY symbol")
        elif market == 'US':
            cur.execute("SELECT DISTINCT symbol FROM historical_data WHERE market='US' AND close > 0 ORDER BY symbol")
        else:
            cur.execute("SELECT DISTINCT symbol FROM egksco_price_history WHERE close_price > 0 ORDER BY symbol")
            egx = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT symbol FROM historical_data WHERE market='US' AND close > 0 ORDER BY symbol")
            us = [r[0] for r in cur.fetchall()]
            conn.close()
            return egx + us
        symbols = [r[0] for r in cur.fetchall()]
        conn.close()
        return symbols
    
    def get_bars(self, symbol, market='EGX'):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        if market == 'EGX':
            # EGX في historical_data (market='EGX')
            cur.execute("""
                SELECT date, open, high, low, close, volume
                FROM historical_data
                WHERE symbol = ? AND market = 'EGX' AND close > 0
                ORDER BY date ASC
            """, (symbol,))
            rows = cur.fetchall()
            bars = [Bar(
                date=r['date'],
                open=float(r['open'] or 0),
                high=float(r['high'] or 0),
                low=float(r['low'] or 0),
                close=float(r['close'] or 0),
                volume=float(r['volume'] or 0),
            ) for r in rows]
        elif market == 'US':
            # US stocks في egksco_price_history (market='US')
            cur.execute("""
                SELECT price_date, open_price, high_price, low_price, close_price, volume
                FROM egksco_price_history
                WHERE symbol = ? AND market = 'US' AND close_price > 0
                ORDER BY price_date ASC
            """, (symbol,))
            rows = cur.fetchall()
            bars = [Bar(
                date=r['price_date'],
                open=float(r['open_price'] or 0),
                high=float(r['high_price'] or 0),
                low=float(r['low_price'] or 0),
                close=float(r['close_price'] or 0),
                volume=_parse_vol(r['volume']),
            ) for r in rows]
        elif market == 'TADAWUL':
            cur.execute("""
                SELECT date, open, high, low, close, volume
                FROM historical_data
                WHERE symbol = ? AND market = 'TADAWUL' AND close > 0
                ORDER BY date ASC
            """, (symbol,))
            rows = cur.fetchall()
            bars = [Bar(
                date=r['date'],
                open=float(r['open'] or 0),
                high=float(r['high'] or 0),
                low=float(r['low'] or 0),
                close=float(r['close'] or 0),
                volume=float(r['volume'] or 0),
            ) for r in rows]
        else:
            bars = []
        conn.close()
        return bars
