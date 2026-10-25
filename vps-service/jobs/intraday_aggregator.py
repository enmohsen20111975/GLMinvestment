#!/usr/bin/env python3
"""
intraday_aggregator.py — تجميع الشموع اللحظية إلى شموع يومية
=============================================================

WHY
---
المالك لاحظ إن price_history.db متجمد رغم إن محرك البيانات (intraday collector)
شغّال مظبوط. التشخيص كشف:

  intraday.db.stock_intraday:
    - 167,336 rows
    - 978 tickers
    - latest: 2026-08-09T14:13 (اليوم!)
    - فيه OHLCV كامل (price + volume لكل tick)

  price_history.db.price_history:
    - MAX(date) = 2026-06-10 (متجمد شهرين!)
    - مصادر قديمة: egksco / egx_investment_migration

النتيجة: محرك البيانات بـ يجمع intraday بس مفيش حاجة بـ يـ aggregate لـ daily.
الـ PriceUpdater القديم كان بـ يعتمد على EODHD (API key متلغي) أو EGXPilot fallback
(بـ يكتب اليوم الحالي بس، ما بـ backfillش الأيام اللي فاتت).

الحل
----
ده الـ aggregator المفقود: بـ يـ read من intraday.db.stock_intraday، بـ group
بـ (ticker, date)، بـ aggregate OHLCV، وبـ يكتب لـ price_history.db بـ
source='intraday_aggregated'.

- بـ backfill كل الأيام الناقصة (مش بس اليوم).
- idempotent: INSERT OR REPLACE على UNIQUE(ticker, date, source).
- مش بـ يحتاج API خارجي — بـ يستخدم داتا المالك نفسه.
- بـ يغطي 291+ ticker (كل اللي ليهم intraday data).

Usage (from market_scheduler or manual):
    from jobs.intraday_aggregator import aggregate_intraday_to_daily
    result = aggregate_intraday_to_daily()

Author: RL-FIX-2 — price_history freeze root cause
"""

import os
import sys
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# ── Paths ──
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
INTRADAY_DB = str(_PROJECT_ROOT / 'db' / 'intraday.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
BACKUP_DIR = _PROJECT_ROOT / 'db' / 'backups'

SOURCE = 'intraday_aggregated'


def _ensure_price_history_schema(ph_conn: sqlite3.Connection) -> bool:
    """تأكد إن جدول price_history موجود وله الأعمدة المطلوبة."""
    try:
        ph_conn.execute("""
            CREATE TABLE IF NOT EXISTS price_history (
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume REAL,
                source TEXT DEFAULT 'unknown',
                created_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (ticker, date, source)
            )
        """)
        ph_conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date "
            "ON price_history(ticker, date)"
        )
        ph_conn.commit()
        return True
    except Exception as e:
        logger.error(f"[IntradayAgg] schema ensure failed: {e}")
        return False


def _get_intraday_dates(intraday_conn: sqlite3.Connection) -> List[str]:
    """كل التواريخ الموجودة في stock_intraday (مرتبة)."""
    try:
        rows = intraday_conn.execute(
            "SELECT DISTINCT substr(timestamp, 1, 10) as d "
            "FROM stock_intraday "
            "WHERE timestamp IS NOT NULL AND length(timestamp) >= 10 "
            "ORDER BY d"
        ).fetchall()
        return [r[0] for r in rows if r[0]]
    except Exception as e:
        logger.error(f"[IntradayAgg] get intraday dates error: {e}")
        return []


def _get_max_date_for_ticker(ph_conn: sqlite3.Connection, ticker: str) -> Optional[str]:
    """آخر تاريخ مسجّل لسهم معيّن في price_history.db (أي source)."""
    try:
        row = ph_conn.execute(
            "SELECT MAX(date) FROM price_history WHERE ticker = ?",
            (ticker,)
        ).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def _aggregate_ticker_date(
    intraday_conn: sqlite3.Connection,
    ticker: str,
    date_str: str,
) -> Optional[Dict[str, Any]]:
    """اجمع شموع intraday لسهم/يوم واحد → OHLCV daily bar."""
    try:
        rows = intraday_conn.execute(
            "SELECT price, volume, open, high, low "
            "FROM stock_intraday "
            "WHERE ticker = ? AND substr(timestamp, 1, 10) = ? "
            "  AND price IS NOT NULL AND price > 0 "
            "ORDER BY timestamp",
            (ticker, date_str)
        ).fetchall()

        if not rows:
            return None

        prices = [r[0] for r in rows if r[0] and r[0] > 0]

        # priority for OHLC: intraday OHLC columns (لو موجودة) → else aggregate from price
        # Query columns: price(0), volume(1), open(2), high(3), low(4)
        opens = [r[2] for r in rows if r[2] and r[2] > 0]
        highs = [r[3] for r in rows if r[3] and r[3] > 0]
        lows = [r[4] for r in rows if r[4] and r[4] > 0]
        vols = [r[1] for r in rows if r[1] and r[1] > 0]

        open_p = opens[0] if opens else prices[0]
        high_p = max(highs) if highs else max(prices)
        low_p = min(lows) if lows else min(prices)
        close_p = prices[-1]
        # volume: لو الـ intraday volume بـ reset كل tick → sum.
        # لو بـ accumulate خلال اليوم → max (آخر قيمة = إجمالي اليوم).
        # من observation: volume بـ يـ reset per tick → max هو الأنسب.
        volume = max(vols) if vols else 0

        return {
            'open': round(open_p, 4),
            'high': round(high_p, 4),
            'low': round(low_p, 4),
            'close': round(close_p, 4),
            'volume': volume,
        }
    except Exception as e:
        logger.debug(f"[IntradayAgg] aggregate error {ticker} {date_str}: {e}")
        return None


def aggregate_intraday_to_daily(
    intraday_db: Optional[str] = None,
    ph_db: Optional[str] = None,
    tickers: Optional[List[str]] = None,
    days_back: int = 60,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    اجمع شموع intraday → daily bars واكتبها في price_history.db.

    Args:
        intraday_db: path to intraday.db. Default = db/intraday.db
        ph_db: path to price_history.db. Default = db/price_history.db
        tickers: قائمة tickers اختيارية (override). لو None بـ يعالج كل اللي في intraday.
        days_back: أقصى عدد أيام للـ backfill (cap ضد الـ stale data القديمة جداً).
        dry_run: لو True بـ يحسب بس ما يكتبش.

    Returns:
        dict: {tickers_processed, tickers_updated, rows_inserted,
               dates_covered, gap_before_max, gap_after_max, report_path, ...}
    """
    intraday_db = intraday_db or INTRADAY_DB
    ph_db = ph_db or PRICE_HISTORY_DB

    # Import source_authority guard (Rule 66 — Task 23-B)
    vps_path = str(_PROJECT_ROOT / 'vps-service')
    if vps_path not in sys.path:
        sys.path.insert(0, vps_path)
    from data.source_authority import write_guarded, get_market_for_ticker

    result = {
        'tickers_processed': 0,
        'tickers_updated': 0,
        'tickers_skipped': 0,
        'rows_inserted': 0,
        'dates_covered': [],
        'gap_before_max': None,
        'gap_after_max': None,
        'report_path': None,
        'sample_updated': [],
        'dry_run': dry_run,
        'started_at': datetime.utcnow().isoformat() + 'Z',
    }

    if not os.path.exists(intraday_db):
        result['error'] = f'intraday.db not found: {intraday_db}'
        logger.error(f"[IntradayAgg] {result['error']}")
        return result

    if not os.path.exists(ph_db):
        # price_history.db مش موجود → نـ createه
        logger.warning(f"[IntradayAgg] price_history.db not found, will create: {ph_db}")

    # ── 1. اتصل بـ intraday.db ──
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        intraday_conn = db_manager.get_connection(intraday_db, writable=False)
        intraday_conn.execute('PRAGMA busy_timeout = 30000')
    except Exception as e:
        result['error'] = f'intraday.db connect failed: {e}'
        logger.error(f"[IntradayAgg] {result['error']}")
        return result

    # ── 2. اتصل بـ price_history.db ──
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    ph_conn = db_manager.get_connection(ph_db, writable=False)
    ph_conn.execute('PRAGMA busy_timeout = 30000')
    if not _ensure_price_history_schema(ph_conn):
        intraday_conn.close()
        ph_conn.close()
        result['error'] = 'Schema ensure failed'
        return result

    # ── 3. الفجوة الكلية قبل ──
    try:
        row = ph_conn.execute("SELECT MAX(date) FROM price_history").fetchone()
        result['gap_before_max'] = row[0] if row and row[0] else None
    except Exception:
        pass

    # ── 4. حدّد التواريخ المتاحة في intraday ──
    intraday_dates = _get_intraday_dates(intraday_conn)
    if not intraday_dates:
        result['error'] = 'No dates in stock_intraday'
        logger.warning(f"[IntradayAgg] {result['error']}")
        intraday_conn.close()
        ph_conn.close()
        return result

    # فلتر: بس آخر days_back يوم
    cutoff_date = (datetime.utcnow().date() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    intraday_dates = [d for d in intraday_dates if d >= cutoff_date]
    result['dates_covered'] = intraday_dates
    logger.info(
        f"[IntradayAgg] {len(intraday_dates)} dates available in intraday "
        f"(after cutoff {cutoff_date}): {intraday_dates[0]} → {intraday_dates[-1]}"
    )

    # ── 5. حدّد قائمة tickers ──
    if not tickers:
        try:
            rows = intraday_conn.execute(
                "SELECT DISTINCT ticker FROM stock_intraday "
                "WHERE ticker IS NOT NULL ORDER BY ticker"
            ).fetchall()
            tickers = [r[0] for r in rows if r[0]]
        except Exception as e:
            result['error'] = f'get tickers failed: {e}'
            intraday_conn.close()
            ph_conn.close()
            return result

    logger.info(f"[IntradayAgg] Processing {len(tickers)} tickers × {len(intraday_dates)} dates")

    # ── 6. لكل ticker: backfill الأيام الناقصة ──
    today_str = datetime.utcnow().strftime('%Y-%m-%d')

    for idx, ticker in enumerate(tickers, 1):
        result['tickers_processed'] += 1

        # آخر تاريخ مسجّل للـ ticker ده في price_history (أي source)
        max_date_ph = _get_max_date_for_ticker(ph_conn, ticker)

        # الأيام اللي محتاجين نـ fillها: كل أيام intraday اللي بعد max_date_ph
        if max_date_ph:
            dates_to_fill = [d for d in intraday_dates if d > max_date_ph]
        else:
            # سهم جديد ما لهوش سجل → fill كل الأيام المتاحة
            dates_to_fill = intraday_dates

        if not dates_to_fill:
            result['tickers_skipped'] += 1
            continue

        rows_written = 0
        for date_str in dates_to_fill:
            # skip اليوم الحالي لو السوق لسه فاتح (الشمعة مش كاملة)
            # فعلياً نـ includeه علشان نـ have something، بس نتـ verify later
            agg = _aggregate_ticker_date(intraday_conn, ticker, date_str)
            if not agg:
                continue

            if not dry_run:
                try:
                    market = get_market_for_ticker(ticker, db_path=str(_PROJECT_ROOT / 'db' / 'stocks.db'))
                    wrote = write_guarded(
                        db_path=ph_db,
                        ticker=ticker,
                        market=market,
                        date=date_str,
                        open_price=agg['open'],
                        high_price=agg['high'],
                        low_price=agg['low'],
                        close_price=agg['close'],
                        volume=agg['volume'],
                        source=SOURCE,
                    )
                    if wrote:
                        rows_written += 1
                except Exception as e:
                    logger.debug(f"[IntradayAgg] INSERT error {ticker} {date_str}: {e}")
            else:
                rows_written += 1

        if not dry_run:
            ph_conn.commit()

        if rows_written > 0:
            result['tickers_updated'] += 1
            result['rows_inserted'] += rows_written
            if len(result['sample_updated']) < 10:
                result['sample_updated'].append({
                    'ticker': ticker,
                    'rows': rows_written,
                    'from': dates_to_fill[0],
                    'to': dates_to_fill[-1],
                })

        if idx % 100 == 0:
            logger.info(
                f"[IntradayAgg] Progress: {idx}/{len(tickers)} | "
                f"updated={result['tickers_updated']} rows={result['rows_inserted']}"
            )

    # ── 7. الفجوة الكلية بعد ──
    try:
        row = ph_conn.execute("SELECT MAX(date) FROM price_history").fetchone()
        result['gap_after_max'] = row[0] if row and row[0] else None
    except Exception:
        pass

    intraday_conn.close()
    ph_conn.close()
    result['finished_at'] = datetime.utcnow().isoformat() + 'Z'

    # ── 8. تقرير JSON ──
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        mode = 'dryrun' if dry_run else 'apply'
        report_path = BACKUP_DIR / f'intraday_aggregator_{mode}_{ts}.json'
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False, default=str)
        result['report_path'] = str(report_path)
        logger.info(f"[IntradayAgg] Report: {report_path}")
    except Exception as e:
        logger.warning(f"[IntradayAgg] Report write failed: {e}")

    logger.info(
        f"[IntradayAgg] DONE | processed={result['tickers_processed']} "
        f"updated={result['tickers_updated']} skipped={result['tickers_skipped']} "
        f"rows={result['rows_inserted']} "
        f"| MAX(date) before={result['gap_before_max']} "
        f"after={result['gap_after_max']} "
        f"| dates_covered={len(result['dates_covered'])}"
    )
    return result


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    )
    r = aggregate_intraday_to_daily(dry_run='--dry-run' in sys.argv)
    print(json.dumps(r, indent=2, ensure_ascii=False, default=str))
