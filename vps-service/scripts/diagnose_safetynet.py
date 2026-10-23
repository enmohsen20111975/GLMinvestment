#!/usr/bin/env python3
"""
Diagnose price_history safetynet failure
=========================================
سكريبت تشخيصي ليه الـ safetynet بـ fails على الإنتاج رغم إن yfinance متثبّت.

الـ safetynet بـ يعتمد على Yahoo Finance (yfinance) لسحب شموع EGX. لو price_history
متجمّد رغم إن yfinance متثبّت → المشكلة في طبقة من دول:
  1. yfinance بترجع empty لأسهم EGX (Yahoo غيّر coverage أو الـ suffix غلط)
  2. الـ scheduler مش بـ يستدعي الـ safetynet أصلاً (_should_run logic)
  3. الـ safetynet بـ يـ raise exception silent
  4. schema mismatch (الـ safetynet بـ يكتب بس الـ backtest مش بـ يقرا)

السكريبت ده بـ check الطبقات دي كلها ويطبع تشخيص واضح.

Usage:
  python3 vps-service/scripts/diagnose_safetynet.py
  python3 vps-service/scripts/diagnose_safetynet.py --ticker COMI
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

_VPS_ROOT = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# نفس suffix map اللي في الـ safetynet
MARKET_SUFFIXES = {
    'EGX': '.CA',
    'TADAWUL': '.SR',
    'KSE': '.KW',
    'QSE': '.QA',
    'US': '',
}


def section(title: str) -> None:
    print(f"\n{'='*70}\n  {title}\n{'='*70}")


def check_yfinance_installed() -> bool:
    """Layer 1: هل yfinance متثبّت؟"""
    try:
        import yfinance
        print(f"  [OK] yfinance installed: v{yfinance.__version__}")
        return True
    except ImportError as e:
        print(f"  [FAIL] yfinance NOT installed: {e}")
        print(f"         FIX: pip install yfinance")
        return False


def check_yahoo_egx_returns(ticker: str, market: str = 'EGX') -> bool:
    """Layer 2: هل Yahoo بترجع بيانات لسهم EGX فعلاً؟"""
    try:
        import yfinance as yf
        suffix = MARKET_SUFFIXES.get(market, '')
        yf_ticker = f"{ticker}{suffix}"
        print(f"  Testing yfinance.Ticker('{yf_ticker}').history(...)")

        stock = yf.Ticker(yf_ticker)
        end_date = (datetime.now().date() + timedelta(days=1)).strftime('%Y-%m-%d')
        start_date = (datetime.now().date() - timedelta(days=30)).strftime('%Y-%m-%d')
        df = stock.history(start=start_date, end=end_date, auto_adjust=False, raise_errors=False)

        if df is None or df.empty:
            print(f"  [FAIL] Yahoo returned EMPTY for {yf_ticker}")
            print(f"         → المشكلة: Yahoo مش بـ cover سهم {ticker} أو الـ suffix '.CA' غلط")
            print(f"         → جرب suffixes تانية: '.CA' / '.AX' / بدون suffix")
            # جرّب بدون suffix
            try:
                df2 = yf.Ticker(ticker).history(start=start_date, end=end_date, auto_adjust=False, raise_errors=False)
                if df2 is not None and not df2.empty:
                    print(f"  [HINT] بدون suffix اشتغل! فيه {len(df2)} bars")
                    print(f"         → المشكلة في suffix map: EGX لازم suffix تاني")
            except Exception:
                pass
            return False

        print(f"  [OK] Yahoo returned {len(df)} bars for {yf_ticker}")
        print(f"       columns: {list(df.columns)}")
        print(f"       آخر 3 شموع:")
        for date_idx, row in df.tail(3).iterrows():
            print(f"         {date_idx.strftime('%Y-%m-%d')}: close={row.get('Close', 'N/A')}")
        return True
    except Exception as e:
        print(f"  [FAIL] yfinance exception: {type(e).__name__}: {e}")
        return False


def check_price_history_db_state() -> dict:
    """Layer 3: حالة price_history.db دلوقتي."""
    info = {'exists': False, 'total_rows': 0, 'max_date': None, 'distinct_tickers': 0,
            'egx_tickers_with_data': 0}
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"  [FAIL] price_history.db not found: {PRICE_HISTORY_DB}")
        return info
    info['exists'] = True
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        conn.execute('PRAGMA busy_timeout = 5000')
        # total rows
        row = conn.execute('SELECT COUNT(*), MAX(date), COUNT(DISTINCT ticker) FROM price_history').fetchone()
        info['total_rows'] = row[0] or 0
        info['max_date'] = row[1]
        info['distinct_tickers'] = row[2] or 0
        print(f"  [OK] price_history.db: {info['total_rows']} rows, {info['distinct_tickers']} tickers")
        print(f"       MAX(date) = {info['max_date']}")
        # عرّف أيام التداول المتأخرة
        if info['max_date']:
            max_d = datetime.strptime(str(info['max_date'])[:10], '%Y-%m-%d').date()
            days_behind = (datetime.now().date() - max_d).days
            print(f"       days behind today: {days_behind}")
            if days_behind > 3:
                print(f"  [CRITICAL] price_history STALE by {days_behind} days")
        # source distribution
        try:
            rows = conn.execute('SELECT source, COUNT(*) FROM price_history GROUP BY source ORDER BY 2 DESC').fetchall()
            print(f"       sources: {dict(rows)}")
            # هل فيه source='yahoo_safetynet'؟
            yahoo_rows = conn.execute("SELECT COUNT(*) FROM price_history WHERE source='yahoo_safetynet'").fetchone()[0]
            info['yahoo_safetynet_rows'] = yahoo_rows
            if yahoo_rows == 0:
                print(f"  [WARNING] مفيش أي صف بـ source='yahoo_safetynet' → الـ safetynet عمره ما كتب حاجة")
            else:
                print(f"  [OK] yahoo_safetynet wrote {yahoo_rows} rows historically")
        except sqlite3.OperationalError:
            print(f"  [WARNING] 'source' column missing → schema قديم")
        conn.close()
    except Exception as e:
        print(f"  [FAIL] price_history.db read error: {e}")
    return info


def check_safetynet_runs_manually(ticker: str) -> dict:
    """Layer 4: شغّل الـ safetynet manually على سهم واحد (dry_run + real write test).

    بـ يـ test طبقتين:
    1. dry_run=True: بـ parse ويـ count من غير ما يكتب (يتـ verify إن Yahoo data صالحة).
    2. dry_run=False على temp DB copy: بـ write فعلياً ويتـ verify الـ INSERT يـ succeed.
    ده بـ separate بين "Yahoo بترجع data" و "الـ safetynet قادر يكتب في DB".
    """
    print(f"  --- 4a. dry_run=True (parse + count, no write) ---")
    try:
        from jobs.price_history_safetynet import fill_price_history_gap
        result_dry = fill_price_history_gap(
            tickers=[ticker],
            market='EGX',
            dry_run=True,
        )
        print(f"    yfinance_available: {result_dry.get('yfinance_available')}")
        print(f"    error: {result_dry.get('error', 'none')}")
        print(f"    tickers_processed: {result_dry.get('tickers_processed')}")
        print(f"    tickers_updated: {result_dry.get('tickers_updated')}")
        print(f"    tickers_failed: {result_dry.get('tickers_failed')}")
        print(f"    sample_failures: {result_dry.get('sample_failures', [])[:2]}")
        print(f"    sample_updated: {result_dry.get('sample_updated', [])[:2]}")
    except Exception as e:
        print(f"    [FAIL] dry_run raised: {type(e).__name__}: {e}")
        result_dry = {'error': str(e)}

    print(f"\n  --- 4b. dry_run=False on temp DB (real write test) ---")
    # انسخ price_history.db structure إلى temp DB (بدون data) علشان نـ test الـ INSERT
    import shutil as _shutil
    import tempfile as _tf
    tmp_dir = _tf.mkdtemp()
    tmp_ph = os.path.join(tmp_dir, 'price_history.db')
    try:
        # انسخ الـ schema من الـ production DB
        if os.path.exists(PRICE_HISTORY_DB):
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            src = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            dst = db_manager.connection(tmp_ph, writable=True).__enter__()
            src.backup(dst)
            src.close()
            # امسح كل الـ rows لـ COMI بس علشان نـ test من غير data سابقة
            dst.execute("DELETE FROM price_history WHERE ticker = ?", (ticker,))
            dst.commit()
            dst.close()
            print(f"    temp DB created from production schema (COMI rows cleared)")
        else:
            print(f"    [SKIP] production price_history.db not found — using empty temp")
    except Exception as e:
        print(f"    [WARNING] could not copy schema: {e} — safetynet will create fresh")

    result_real = None
    try:
        from jobs.price_history_safetynet import fill_price_history_gap
        result_real = fill_price_history_gap(
            ph_db=tmp_ph,
            tickers=[ticker],
            market='EGX',
            dry_run=False,
        )
        print(f"    yfinance_available: {result_real.get('yfinance_available')}")
        print(f"    error: {result_real.get('error', 'none')}")
        print(f"    tickers_processed: {result_real.get('tickers_processed')}")
        print(f"    tickers_updated: {result_real.get('tickers_updated')}")
        print(f"    tickers_failed: {result_real.get('tickers_failed')}")
        print(f"    rows_inserted: {result_real.get('rows_inserted')}")
        print(f"    sample_failures: {result_real.get('sample_failures', [])[:2]}")
        print(f"    sample_updated: {result_real.get('sample_updated', [])[:2]}")

        # اتشيك الـ temp DB فعلاً فيه rows جديدة بـ source='yahoo_safetynet'
        if os.path.exists(tmp_ph):
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(tmp_ph, writable=False).__enter__()
            rows = conn.execute(
                "SELECT date, close_price, source FROM price_history "
                "WHERE ticker = ? AND source = 'yahoo_safetynet' ORDER BY date DESC LIMIT 5",
                (ticker,)
            ).fetchall()
            if rows:
                print(f"    [OK] {len(rows)} yahoo_safetynet rows written to temp DB:")
                for r in rows:
                    print(f"       {r[0]}: close={r[1]}")
            else:
                print(f"    [FAIL] 0 yahoo_safetynet rows in temp DB → الـ INSERT بـ fail")
            conn.close()
    except Exception as e:
        print(f"    [FAIL] real write raised: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        result_real = {'error': str(e)}
    finally:
        try:
            _shutil.rmtree(tmp_dir)
        except Exception:
            pass

    return {'dry_run': result_dry, 'real_write': result_real}


def check_scheduler_state() -> None:
    """Layer 5: هل الـ scheduler بـ يستدعي الـ safetynet؟ (check last_run state)"""
    print(f"  الـ scheduler state بـ يتـ store في memory (مش persistent).")
    print(f"  لازم تشيك pm2 logs python-backend لـ '[SafetyNet]' أو 'price_history safetynet':")
    print(f"    pm2 logs python-backend --lines 200 | grep -i safetynet")
    print(f"  أو شيك الـ safetynet reports:")
    safetynet_reports = _PROJECT_ROOT / 'db' / 'backups'
    if safetynet_reports.exists():
        reports = sorted(safetynet_reports.glob('price_history_safetynet_*.json'), reverse=True)[:3]
        if reports:
            print(f"  آخر {len(reports)} safetynet reports:")
            for r in reports:
                try:
                    data = json.loads(r.read_text())
                    print(f"    {r.name}: updated={data.get('tickers_updated')} "
                          f"failed={data.get('tickers_failed')} rows={data.get('rows_inserted')} "
                          f"error={data.get('error', 'none')[:60] if data.get('error') else 'none'}")
                except Exception:
                    print(f"    {r.name}: (parse error)")
        else:
            print(f"  [WARNING] مفيش safetynet reports → الـ safetynet عمره ما اشتغل لحد النهاية")
    else:
        print(f"  [WARNING] backups dir not found: {safetynet_reports}")


def main():
    parser = argparse.ArgumentParser(description='Diagnose price_history safetynet failure')
    parser.add_argument('--ticker', default='COMI',
                        help='تيكر EGX للاختبار (default: COMI = Commercial Intl Bank)')
    parser.add_argument('--market', default='EGX')
    args = parser.parse_args()

    print(f"\n{'#'*70}")
    print(f"#  DIAGNOSE SAFENET — {datetime.now().isoformat()}")
    print(f"#  ticker={args.ticker}  market={args.market}")
    print(f"{'#'*70}")

    section("Layer 1: yfinance installed?")
    yf_ok = check_yfinance_installed()

    section("Layer 2: Yahoo returns EGX data?")
    if yf_ok:
        yahoo_ok = check_yahoo_egx_returns(args.ticker, args.market)
    else:
        print("  [SKIP] yfinance not installed → can't test Yahoo")
        yahoo_ok = False

    section("Layer 3: price_history.db state")
    ph_info = check_price_history_db_state()

    section("Layer 4: Run safetynet manually (dry-run + real write)")
    sn_result = check_safetynet_runs_manually(args.ticker)

    section("Layer 5: Scheduler / reports")
    check_scheduler_state()

    # ── Diagnosis ──
    section("DIAGNOSIS")
    dry = sn_result.get('dry_run', {}) if isinstance(sn_result, dict) else {}
    real = sn_result.get('real_write', {}) if isinstance(sn_result, dict) else {}
    dry_updated = dry.get('tickers_updated', 0) if isinstance(dry, dict) else 0
    real_updated = real.get('tickers_updated', 0) if isinstance(real, dict) else 0
    real_rows = real.get('rows_inserted', 0) if isinstance(real, dict) else 0

    if not yf_ok:
        print("  ROOT CAUSE: yfinance مش متثبّت.")
        print("  FIX: pip install yfinance && pm2 restart python-backend")
    elif not yahoo_ok:
        print(f"  ROOT CAUSE: Yahoo Finance مش بـ يرجّع بيانات لـ {args.ticker}.CA")
        print("  → المرجّح: Yahoo غيّر coverage لـ EGX أو الـ suffix '.CA' مبقاش صحيح.")
        print("  FIX options:")
        print("    A) جرّب suffix تاني (عدّل MARKET_SUFFIXES['EGX'] في price_history_safetynet.py)")
        print("    B) بدّل المصدر من Yahoo لـ EODHD (لو API key متاح) أو مصدر تاني")
        print("    C) شغّل manual backfill من scripts/backfill_price_history_gap.py بـ source تاني")
    elif dry_updated == 0:
        # الـ dry_run فشل → Yahoo رجّع data بس الـ parsing بـ fail
        print(f"  ROOT CAUSE: safetynet parsing بـ fail (dry_run: tickers_updated=0).")
        print("  → Yahoo بترجع data بس الـ safetynet مش قادر يـ parseها.")
        print("  → شوف sample_failures في Layer 4a فوق.")
    elif real_updated == 0 or real_rows == 0:
        # الـ dry_run نجح بس الـ real write فشل → مشكلة في الـ INSERT/schema
        print(f"  ROOT CAUSE: safetynet بـ parse بس الـ INSERT بـ fail.")
        print(f"  → dry_run: tickers_updated={dry_updated} (parsing OK)")
        print(f"  → real_write: tickers_updated={real_updated}, rows={real_rows} (INSERT FAIL)")
        print("  → المرجّح: schema mismatch (PK conflict / NOT NULL / column missing).")
        print("  → شيك الـ exception في Layer 4b فوق.")
    elif ph_info.get('yahoo_safetynet_rows', 0) == 0 and ph_info.get('max_date'):
        # الـ manual test نجح بس الـ production عمره ما كتب → المشكلة في الـ scheduler
        print("  ROOT CAUSE: safetynet بـ يشتغل manual بس الـ scheduler مش بـ يستدعيه.")
        print(f"  → dry_run test: OK (tickers_updated={dry_updated})")
        print(f"  → real_write test: OK (rows={real_rows})")
        print(f"  → بس production price_history فيه 0 rows بـ source='yahoo_safetynet'.")
        print("  → المشكلة في الـ scheduler: إما _should_run بـ skip، أو exception silent،")
        print("    أو الـ safetynet بـ يتـ call بس post-market والـ post-market مش بـ يحصل.")
        print("  → شيك: pm2 logs python-backend --lines 500 | grep -iE 'safetynet|price_history'")
    else:
        print("  [OK] مفيش سبب واضح للمشكلة — كل الطبقات بـ تـ pass.")
        print("  → المشكلة ممكن تكون في الـ scheduler _should_run logic أو timing.")

    print(f"\n{'#'*70}\n")


if __name__ == '__main__':
    main()
