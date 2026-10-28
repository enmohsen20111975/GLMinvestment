"""
indicators_reader.py — Read technical indicators from stock_indicators table
============================================================================
Owner directive (2026-10-28): "بنحسب المؤشرات غلط خالص"

الحل: بدل ما الـ engines تحسب المؤشرات محلي (RSI Wilder, MACD, SMA, ATR)
— بـ تقرأها من جدول stock_indicators (اللي بيتعبّا من TradingView scanner).

المؤشرات المتاحة (من TV):
  rsi, macd, macd_signal, sma20, sma50, sma200, atr,
  recommend_all, recommend_ma, recommend_other,
  volatility_daily, volatility_weekly,
  avg_volume_30d, avg_volume_10d, avg_volume_90d,
  relative_volume_10d, high_52w, low_52w, beta_1y

الـ reader بيـ:
  1. يقرأ آخر صف من stock_indicators للسهم
  2. لو مفيش → بيرجّع None (engine بـ fallback للحساب المحلي)
  3. لو فيه → بيرجّع dict بالمؤشرات

Usage:
  from data_engine.scrapers.indicators_reader import get_tv_indicators
  ind = get_tv_indicators('COMI')
  if ind:
      rsi = ind['rsi']  # من TradingView
  else:
      rsi = calc_rsi(closes)  # fallback محلي
"""
import sqlite3
import logging
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent.parent / "db" / "stocks.db"


def get_tv_indicators(ticker: str, date: Optional[str] = None, db_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """اقرأ مؤشرات سهم من stock_indicators (مصدرها TradingView).

    Args:
        ticker: رمز السهم (مثل 'COMI')
        date: تاريخ محدد (YYYY-MM-DD)، أو None لآخر تاريخ متاح
        db_path: مسار DB بديل

    Returns:
        dict بالمؤشرات أو None لو مفيش بيانات:
        {
            'rsi': 45.2, 'macd': -0.3, 'macd_signal': 0.1,
            'sma20': 25.5, 'sma50': 24.0, 'sma200': 22.0, 'atr': 0.8,
            'recommend_all': -0.15, 'volatility_daily': 0.02, ...
            'date': '2026-10-28', 'fetch_time': '2026-10-28 14:05:00',
            'source': 'tradingview'
        }
    """
    path = db_path or str(DB_PATH)
    try:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        if date:
            cur.execute(
                "SELECT * FROM stock_indicators WHERE ticker = ? AND date = ?",
                (ticker, date)
            )
        else:
            # Latest available
            cur.execute(
                "SELECT * FROM stock_indicators WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                (ticker,)
            )
        row = cur.fetchone()
        conn.close()

        if row is None:
            return None

        return dict(row)
    except Exception as e:
        logger.warning(f"[indicators_reader] get_tv_indicators({ticker}) failed: {e}")
        return None


def get_tv_indicators_batch(tickers: list, date: Optional[str] = None, db_path: Optional[str] = None) -> Dict[str, Dict]:
    """اقرأ مؤشرات عدة أسهم دفعة واحدة (أسرع من استدعاء فردي).

    Returns:
        {ticker: {rsi, macd, ...}, ...} — الأسهم اللي مفيش لها بيانات مش هتكون في الـ dict.
    """
    if not tickers:
        return {}
    path = db_path or str(DB_PATH)
    try:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        placeholders = ",".join("?" * len(tickers))
        if date:
            cur.execute(
                f"SELECT * FROM stock_indicators WHERE ticker IN ({placeholders}) AND date = ?",
                tickers + [date]
            )
        else:
            # Latest per ticker (using window function)
            cur.execute(
                f"""SELECT si.* FROM stock_indicators si
                    INNER JOIN (
                        SELECT ticker, MAX(date) as max_date
                        FROM stock_indicators
                        WHERE ticker IN ({placeholders})
                        GROUP BY ticker
                    ) latest ON si.ticker = latest.ticker AND si.date = latest.max_date
                """,
                tickers
            )
        result = {}
        for row in cur.fetchall():
            result[row["ticker"]] = dict(row)
        conn.close()
        return result
    except Exception as e:
        logger.warning(f"[indicators_reader] get_tv_indicators_batch failed: {e}")
        return {}


def has_tv_indicators(ticker: str, db_path: Optional[str] = None) -> bool:
    """تحقق هل فيه مؤشرات TV متاحة لسهم معين."""
    return get_tv_indicators(ticker, db_path=db_path) is not None


def get_indicator_stats(db_path: Optional[str] = None) -> Dict[str, int]:
    """إحصائيات جدول stock_indicators (للـ monitoring)."""
    path = db_path or str(DB_PATH)
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM stock_indicators")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT ticker) FROM stock_indicators")
        tickers = cur.fetchone()[0]
        cur.execute("SELECT MAX(date) FROM stock_indicators")
        latest = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM stock_indicators WHERE rsi IS NOT NULL")
        with_rsi = cur.fetchone()[0]
        conn.close()
        return {
            "total_rows": total,
            "distinct_tickers": tickers,
            "latest_date": latest,
            "rows_with_rsi": with_rsi,
        }
    except Exception as e:
        logger.warning(f"[indicators_reader] get_indicator_stats failed: {e}")
        return {"total_rows": 0, "distinct_tickers": 0, "latest_date": None, "rows_with_rsi": 0}
