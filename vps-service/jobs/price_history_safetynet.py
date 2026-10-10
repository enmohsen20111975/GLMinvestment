#!/usr/bin/env python3
"""
price_history_safetynet.py — شبكة الأمان اليومية لـ price_history.db
====================================================================

WHY
---
الكاتب الأوتوماتيكي الأساسي لـ price_history.db كان سلسلة EODHD → PriceUpdater
→ gap_filler، وكل حلقة فيها عيب صامت:
  - EODHD_API_KEY = '' (اشتراك متلغي) → 403 كل مرة
  - PriceUpdater بـ يبلع الأخطاء في logger.debug()
  - gap_filler مقيّد بـ delta<=1 + 30 يوم + جوّى سلسلة EODHD
  - _should_run('egx_indices', 1440) بـ يحسب المهمة "تمت" حتى لو فشلت

النتيجة: price_history.db متجمّد من 2026-07-30 رغم إن data-engine online.

الحل
----
ده الـ SAFETY-NET المستقل: بـ يشتغل يومياً (market_scheduler بيستدعيه post-market)
وبـ يشتغل manual (scripts/backfill_price_history_gap.py بيستدعي نفس الـ function).
- مصدر واحد: Yahoo Finance (yfinance) — مش EODHD ولا egksco.
- منطق: لكل سهم، لاقي MAX(date) في price_history.db، واسحب من Yahoo من
  MAX(date)+1 ليومنا، واكتب بـ source='yahoo_safetynet'.
- idempotent: INSERT OR REPLACE على UNIQUE(ticker, date, source).
- مش مقيّد بساعات السوق ولا بـ EODHD ولا بـ _should_run على الفشل.

Usage (from market_scheduler or manual):
    from jobs.price_history_safetynet import fill_price_history_gap
    result = fill_price_history_gap(market='EGX', dry_run=False)

Author: P0 fix — price_history freeze
"""

import os
import sys
import json
import sqlite3
import logging
import time as _time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# ── Paths ──
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
BACKUP_DIR = _PROJECT_ROOT / 'db' / 'backups'

# ── Yahoo Finance ticker suffixes per market ──
MARKET_SUFFIXES = {
    'EGX': '.CA',
    'TADAWUL': '.SR',
    'KSE': '.KW',
    'QSE': '.QA',
    'US': '',
    'NASDAQ': '',
    'NYSE': '',
}

SOURCE = 'yahoo_safetynet'


def _get_tickers_from_predictions(pred_db: str, market: str = 'EGX') -> List[str]:
    """اقرأ كل التيكرز اللي ليها توصيات في predictions.db."""
    tickers = set()
    if not os.path.exists(pred_db):
        return []
    try:
        conn = sqlite3.connect(pred_db, timeout=30)
        conn.execute('PRAGMA busy_timeout = 30000')
        # جرب أعمدة مختلفة (ticker / stock_ticker / symbol)
        for col in ('ticker', 'stock_ticker', 'symbol'):
            try:
                rows = conn.execute(
                    f'SELECT DISTINCT {col} FROM predictions WHERE {col} IS NOT NULL'
                ).fetchall()
                if rows:
                    for r in rows:
                        t = (r[0] or '').strip().upper()
                        if t:
                            tickers.add(t)
                    break
            except sqlite3.OperationalError:
                continue
        conn.close()
    except Exception as e:
        logger.warning(f"[SafetyNet] predictions.db read error: {e}")
    return sorted(tickers)


def _get_tickers_from_stocks(stocks_db: str, market: str = 'EGX') -> List[str]:
    """اقرأ كل أسهم EGX النشطة من stocks.db."""
    tickers = set()
    if not os.path.exists(stocks_db):
        return []
    try:
        conn = sqlite3.connect(stocks_db, timeout=30)
        conn.execute('PRAGMA busy_timeout = 30000')
        # جرب بأعمدة is_active لو موجودة
        try:
            rows = conn.execute(
                "SELECT DISTINCT ticker FROM stocks WHERE market = ? AND is_active = 1",
                (market,)
            ).fetchall()
        except sqlite3.OperationalError:
            rows = conn.execute(
                "SELECT DISTINCT ticker FROM stocks WHERE market = ?",
                (market,)
            ).fetchall()
        for r in rows:
            t = (r[0] or '').strip().upper()
            if t:
                tickers.add(t)
        conn.close()
    except Exception as e:
        logger.warning(f"[SafetyNet] stocks.db read error: {e}")
    return sorted(tickers)


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
        logger.error(f"[SafetyNet] schema ensure failed: {e}")
        return False


def _fetch_yahoo(ticker: str, market: str, start_date: str, end_date: str):
    """اسحب شموع Yahoo لسهم واحد. يرجع DataFrame أو None."""
    try:
        import yfinance as yf
        suffix = MARKET_SUFFIXES.get(market, '')
        yf_ticker = f"{ticker}{suffix}"
        stock = yf.Ticker(yf_ticker)
        df = stock.history(
            start=start_date,
            end=end_date,
            auto_adjust=False,   # Raw prices — مش Adjusted
            raise_errors=False,
        )
        return df if (df is not None and not df.empty) else None
    except Exception as e:
        logger.debug(f"[SafetyNet] yfinance {ticker}: {e}")
        return None


def fill_price_history_gap(
    pred_db: Optional[str] = None,
    ph_db: Optional[str] = None,
    stocks_db: Optional[str] = None,
    market: str = 'EGX',
    tickers: Optional[List[str]] = None,
    max_days: int = 45,
    sleep_sec: float = 0.3,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    املي فجوات price_history.db من Yahoo Finance.

    Args:
        pred_db: path to predictions.db (لقراءة التيكرز). Default = db/predictions.db
        ph_db: path to price_history.db. Default = db/price_history.db
        stocks_db: path to stocks.db (لقراءة التيكرز). Default = db/stocks.db
        market: 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US'
        tickers: قائمة whichكرز اختيارية (override). لو None بـ يتحدد تلقائياً.
        max_days: أقصى فجوة يتم ملؤها لكل سهم (cap against Yahoo rate limits).
        sleep_sec: تأخير بين كل سهم (احترام rate limits).
        dry_run: لو True بـ يحسب الفجوات ويسحب Yahoo بس ما يكتبش في DB.

    Returns:
        dict: {tickers_processed, tickers_updated, tickers_skipped, tickers_failed,
               rows_inserted, gap_days_before_max, gap_days_after_max,
               report_path, sample_failures, dry_run}
    """
    pred_db = pred_db or PREDICTIONS_DB
    ph_db = ph_db or PRICE_HISTORY_DB
    stocks_db = stocks_db or STOCKS_DB

    result = {
        'tickers_processed': 0,
        'tickers_updated': 0,
        'tickers_skipped': 0,
        'tickers_failed': 0,
        'rows_inserted': 0,
        'gap_days_before_max': None,
        'gap_days_after_max': None,
        'report_path': None,
        'sample_failures': [],
        'sample_updated': [],
        'dry_run': dry_run,
        'market': market,
        'started_at': datetime.utcnow().isoformat() + 'Z',
    }

    # 🔥 Explicit yfinance check (fail loud بدل silent).
    # قبل كده، _fetch_yahoo بـ catch ImportError و بترجع None بصمت → كل tickers
    # بـ fail من غير ما حد يعرف السبب. ده خلى price_history يتجمّد 9 أيام.
    # دلوقتي بنـ check في البداية ونبعت CRITICAL واضح لو yfinance ناقص.
    try:
        import yfinance  # noqa: F401
        result['yfinance_available'] = True
    except ImportError:
        result['yfinance_available'] = False
        result['error'] = (
            "yfinance is NOT installed — safetynet cannot fetch from Yahoo Finance. "
            "Run: pip install yfinance  (or: pip install yfinance --upgrade). "
            "Until installed, price_history.db will stay STALE."
        )
        logger.critical(f"[SafetyNet] {result['error']}")
        return result

    if not os.path.exists(ph_db):
        logger.error(f"[SafetyNet] price_history.db not found: {ph_db}")
        result['error'] = f'price_history.db not found: {ph_db}'
        return result

    # ── 1. حدّد قائمة التيكرز ──
    if not tickers:
        pred_tickers = _get_tickers_from_predictions(pred_db, market)
        stocks_tickers = _get_tickers_from_stocks(stocks_db, market)
        tickers = sorted(set(pred_tickers) | set(stocks_tickers))
        logger.info(
            f"[SafetyNet] Tickers: {len(pred_tickers)} from predictions + "
            f"{len(stocks_tickers)} from stocks = {len(tickers)} unique"
        )
    else:
        tickers = sorted(set(t.upper().strip() for t in tickers if t and t.strip()))
        logger.info(f"[SafetyNet] Using provided ticker list: {len(tickers)} tickers")

    if not tickers:
        logger.warning("[SafetyNet] No tickers to process.")
        result['error'] = 'No tickers found'
        return result

    # ── 2. اتصل بـ price_history.db ──
    ph_conn = sqlite3.connect(ph_db, timeout=30)
    ph_conn.execute('PRAGMA busy_timeout = 30000')
    if not _ensure_price_history_schema(ph_conn):
        ph_conn.close()
        result['error'] = 'Schema ensure failed'
        return result

    # Import source_authority guard (Rule 66 — Task 23-B)
    _vps_path = str(_PROJECT_ROOT / 'vps-service')
    if _vps_path not in sys.path:
        sys.path.insert(0, _vps_path)
    from data.source_authority import write_guarded

    # ── 3. الفجوة الكلية قبل ──
    try:
        row = ph_conn.execute("SELECT MAX(date) FROM price_history").fetchone()
        result['gap_days_before_max'] = row[0] if row and row[0] else None
    except Exception:
        result['gap_days_before_max'] = None

    today = datetime.utcnow().date()
    end_date_str = (today + timedelta(days=1)).strftime('%Y-%m-%d')  # yfinance end is exclusive

    # ── 4. لكل سهم: لاقي الفجوة واملأها ──
    for idx, ticker in enumerate(tickers, 1):
        result['tickers_processed'] += 1
        max_date = _get_max_date_for_ticker(ph_conn, ticker)

        if max_date:
            try:
                last = datetime.strptime(max_date[:10], '%Y-%m-%d').date()
                gap_days = (today - last).days
            except Exception:
                gap_days = 0

            if gap_days <= 0:
                result['tickers_skipped'] += 1
                continue

            # ابدأ من آخر يوم + 1 (عشان ما نعيدش كتابة اليوم الموجود)
            start_date = (last + timedelta(days=1)).strftime('%Y-%m-%d')
            # cap الفجوة
            if gap_days > max_days:
                start_date = (today - timedelta(days=max_days)).strftime('%Y-%m-%d')
                logger.info(
                    f"[SafetyNet] {ticker}: gap={gap_days}d capped to {max_days}d "
                    f"(start={start_date})"
                )
        else:
            # سهم جديد ما لهوش سجل → اسحب آخر max_days يوم
            start_date = (today - timedelta(days=max_days)).strftime('%Y-%m-%d')
            logger.info(f"[SafetyNet] {ticker}: no prior record, fetching {max_days}d")

        # اسحب Yahoo
        df = _fetch_yahoo(ticker, market, start_date, end_date_str)
        if df is None or df.empty:
            result['tickers_failed'] += 1
            if len(result['sample_failures']) < 10:
                result['sample_failures'].append({
                    'ticker': ticker, 'reason': 'yfinance returned empty',
                    'start': start_date, 'end': end_date_str,
                })
            continue

        rows_written = 0
        # 🔥 Bug fix: قبل كده الـ dry_run كان بـ skip الـ parsing loop بالكامل →
        # rows_written بيفضل 0 → false "all rows NaN/empty after parse" failure.
        # دلوقتي بنـ parse ونـ count في الحالتين (dry_run و not)، بس بنـ skip
        # الـ INSERT لو dry_run. ده بـ يـ let الـ diagnostic يـ tell الحقيقة.
        for date_idx, row in df.iterrows():
            try:
                date_str = date_idx.strftime('%Y-%m-%d')
                open_p = float(row.get('Open', 0)) if row.get('Open') is not None else None
                high_p = float(row.get('High', 0)) if row.get('High') is not None else None
                low_p = float(row.get('Low', 0)) if row.get('Low') is not None else None
                close_p = float(row.get('Close', 0)) if row.get('Close') is not None else None
                vol = float(row.get('Volume', 0)) if row.get('Volume') is not None else 0

                # تخطّي الصفوف اللي close فارغ أو NaN
                if close_p is None or str(close_p) == 'nan' or close_p <= 0:
                    continue

                if not dry_run:
                    # write_guarded (Rule 66 — Task 23-B). SOURCE='yahoo_safetynet'
                    # is in BANNED_SOURCES per source_authority (data quality issues)
                    # → guard will SKIP all writes; canonical writer per market
                    # takes precedence.
                    wrote = write_guarded(
                        db_path=ph_db,
                        ticker=ticker,
                        market=market,
                        date=date_str,
                        open_price=open_p,
                        high_price=high_p,
                        low_price=low_p,
                        close_price=close_p,
                        volume=vol,
                        source=SOURCE,
                    )
                    if wrote:
                        rows_written += 1
                else:
                    rows_written += 1
            except Exception as e:
                logger.debug(f"[SafetyNet] {ticker} {date_idx}: {e}")
        if not dry_run:
            ph_conn.commit()

        if rows_written > 0:
            result['tickers_updated'] += 1
            result['rows_inserted'] += rows_written
            if len(result['sample_updated']) < 10:
                result['sample_updated'].append({
                    'ticker': ticker, 'rows': rows_written,
                    'from': start_date, 'to': end_date_str,
                })
        else:
            # Yahoo رجّع بيانات بس كلها NaN/فارغة
            result['tickers_failed'] += 1
            if len(result['sample_failures']) < 10:
                result['sample_failures'].append({
                    'ticker': ticker, 'reason': 'all rows NaN/empty after parse',
                })

        if idx % 50 == 0:
            logger.info(
                f"[SafetyNet] Progress: {idx}/{len(tickers)} | "
                f"updated={result['tickers_updated']} failed={result['tickers_failed']} "
                f"rows={result['rows_inserted']}"
            )
        _time.sleep(sleep_sec)

    # ── 5. الفجوة الكلية بعد ──
    try:
        row = ph_conn.execute("SELECT MAX(date) FROM price_history").fetchone()
        result['gap_days_after_max'] = row[0] if row and row[0] else None
    except Exception:
        pass

    ph_conn.close()
    result['finished_at'] = datetime.utcnow().isoformat() + 'Z'

    # ── 6. تقرير JSON ──
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        mode = 'dryrun' if dry_run else 'apply'
        report_path = BACKUP_DIR / f'price_history_safetynet_{mode}_{ts}.json'
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False, default=str)
        result['report_path'] = str(report_path)
        logger.info(f"[SafetyNet] Report: {report_path}")
    except Exception as e:
        logger.warning(f"[SafetyNet] Report write failed: {e}")

    logger.info(
        f"[SafetyNet] DONE | processed={result['tickers_processed']} "
        f"updated={result['tickers_updated']} skipped={result['tickers_skipped']} "
        f"failed={result['tickers_failed']} rows={result['rows_inserted']} "
        f"| MAX(date) before={result['gap_days_before_max']} "
        f"after={result['gap_days_after_max']}"
    )
    return result


if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    )
    r = fill_price_history_gap(dry_run='--dry-run' in sys.argv)
    print(json.dumps(r, indent=2, ensure_ascii=False, default=str))
