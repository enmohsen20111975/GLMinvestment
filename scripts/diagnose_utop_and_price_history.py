#!/usr/bin/env python3
"""
diagnose_utop_and_price_history.py — تشخيص UTOP + price_history بعد الجلسة
=========================================================================

WHY
---
المالك محتاج يجاوب على السؤال ده:
  1) UTOP في DB: entry_price, target, stop, prediction_date — إيه القيم؟
  2) UTOP في stocks.db دلوقتي: current_price = ؟
  3) UTOP آخر شمعة في price_history.db = متى؟
  4) price_history.db global MAX(date) = ؟ (عشان نعرف الـ daily OHLC اتحدّث ولا لأ)

🔥 SCHEMA-AWARE (P0-fix v2):
   الإنتاج بـ يستخدم signal / signal_type (مش recommendation). السكريبت دلوقتي
   بـ يفحص الأعمدة الفعلية بـ PRAGMA table_info وبـ يبني الـ SELECT ديناميكيًا،
   وبـ يستخدم COALESCE(signal, signal_type) في بايثون. كمان كل الـ printf بـ
   تتعامل بأمان مع None / str (مش بـ تنكسر format error).

Usage:
    python3 scripts/diagnose_utop_and_price_history.py
    python3 scripts/diagnose_utop_and_price_history.py --ticker RMDA

Author: P0-UI diagnostic (schema-aware v2)
"""

import os
import sys
import sqlite3
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')


def _get_columns(conn, table):
    """اترجع set بأسماء الأعمدة الموجودة فعلياً في الجدول (schema-aware)."""
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    except sqlite3.OperationalError:
        return set()


def _f(val, ndigits=2):
    """formatted float بأمان — بـ يرجّع 'N/A' للـ None / non-numeric."""
    if val is None:
        return 'N/A'
    try:
        return f'{float(val):.{ndigits}f}'
    except (TypeError, ValueError):
        return str(val)


def _fi(val):
    """formatted int بأمان."""
    if val is None:
        return 'N/A'
    try:
        return f'{int(float(val)):,}'
    except (TypeError, ValueError):
        return str(val)


def _resolve_signal(row_dict):
    """COALESCE(signal, signal_type, recommendation) — schema-aware."""
    for col in ('signal', 'signal_type', 'recommendation'):
        v = row_dict.get(col)
        if v is not None and str(v).strip():
            return str(v)
    return '(none)'


def main():
    parser = argparse.ArgumentParser(description='Diagnose ticker + price_history state')
    parser.add_argument('--ticker', default='UTOP', help='Ticker to diagnose (default: UTOP)')
    parser.add_argument('--pred-db', default=PREDICTIONS_DB)
    parser.add_argument('--stocks-db', default=STOCKS_DB)
    parser.add_argument('--ph-db', default=PRICE_HISTORY_DB)
    args = parser.parse_args()

    ticker = args.ticker.upper()
    print(f"\n{'='*70}")
    print(f"🔍 Diagnostic: {ticker} + price_history state (schema-aware v2)")
    print(f"{'='*70}\n")

    # ── 1. price_history.db global state ──
    print(f"─── 1) price_history.db GLOBAL state ───")
    if not os.path.exists(args.ph_db):
        print(f"❌ price_history.db NOT FOUND: {args.ph_db}")
    else:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(args.ph_db, writable=False).__enter__()
        try:
            row = conn.execute(
                "SELECT MAX(date), COUNT(*) FROM price_history"
            ).fetchone()
            print(f"  MAX(date) global : {row[0]}")
            print(f"  COUNT(*)         : {_fi(row[1])}")
            print(f"\n  ── by source ──")
            for srow in conn.execute(
                "SELECT source, COUNT(*), MAX(date) FROM price_history GROUP BY source ORDER BY COUNT(*) DESC"
            ).fetchall():
                print(f"    {(srow[0] or '(NULL)'):<25} count={_fi(srow[1]):<12} max_date={srow[2]}")
        except Exception as e:
            print(f"❌ Query error: {e}")
        conn.close()

    # ── 2. price_history.db for ticker ──
    print(f"\n─── 2) price_history.db for {ticker} ───")
    if os.path.exists(args.ph_db):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(args.ph_db, writable=False).__enter__()
        try:
            row = conn.execute(
                "SELECT MAX(date), COUNT(*), MIN(date) FROM price_history WHERE ticker = ?",
                (ticker,)
            ).fetchone()
            if row and row[1] > 0:
                print(f"  MAX(date) {ticker}: {row[0]}")
                print(f"  MIN(date) {ticker}: {row[2]}")
                print(f"  COUNT(*)  {ticker}: {_fi(row[1])}")
                print(f"\n  ── last 5 candles ──")
                for crow in conn.execute(
                    "SELECT date, open_price, high_price, low_price, close_price, volume, source "
                    "FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 5",
                    (ticker,)
                ).fetchall():
                    print(f"    {crow[0]} O={_f(crow[1])} H={_f(crow[2])} L={_f(crow[3])} "
                          f"C={_f(crow[4])} V={_fi(crow[5])} src={crow[6]}")
            else:
                print(f"  ⚠️ NO rows for {ticker} in price_history")
        except Exception as e:
            print(f"❌ Query error: {e}")
        conn.close()

    # ── 3. stocks.db for ticker (schema-aware) ──
    print(f"\n─── 3) stocks.db for {ticker} (LIVE) ───")
    if not os.path.exists(args.stocks_db):
        print(f"❌ stocks.db NOT FOUND: {args.stocks_db}")
    else:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(args.stocks_db, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        try:
            scols = _get_columns(conn, 'stocks')
            # ابني SELECT ديناميكيًا من الأعمدة المتاحة
            wanted = ['ticker', 'current_price', 'previous_close', 'open_price',
                      'high_price', 'low_price', 'high_52w', 'low_52w',
                      'change_percent', 'volume', 'value_traded', 'turnover_egp',
                      'market', 'updated_at', 'last_updated', 'is_suspended']
            select_cols = [c for c in wanted if c in scols]
            select_sql = f"SELECT {', '.join(select_cols)} FROM stocks WHERE ticker = ?"
            row = conn.execute(select_sql, (ticker,)).fetchone()
            if row:
                rd = dict(row)
                print(f"  current_price : {rd.get('current_price')}")
                print(f"  previous_close: {rd.get('previous_close')}")
                print(f"  open_price    : {rd.get('open_price', '(col absent)')}")
                print(f"  high_price    : {rd.get('high_price', '(col absent)')}  (intraday)")
                print(f"  low_price     : {rd.get('low_price', '(col absent)')}   (intraday)")
                print(f"  high_52w      : {rd.get('high_52w')}")
                print(f"  low_52w       : {rd.get('low_52w')}")
                print(f"  change_percent: {rd.get('change_percent')}")
                print(f"  volume        : {rd.get('volume')}")
                print(f"  turnover_egp  : {rd.get('turnover_egp')}")
                print(f"  market        : {rd.get('market')}")
                print(f"  updated_at    : {rd.get('updated_at')}")
                print(f"  last_updated  : {rd.get('last_updated')}")
            else:
                print(f"  ⚠️ {ticker} NOT FOUND in stocks.db")
        except Exception as e:
            print(f"❌ Query error: {e}")
        conn.close()

    # ── 4. predictions.db for ticker (schema-aware) ──
    print(f"\n─── 4) predictions.db for {ticker} ───")
    if not os.path.exists(args.pred_db):
        print(f"❌ predictions.db NOT FOUND: {args.pred_db}")
    else:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(args.pred_db, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        try:
            pcols = _get_columns(conn, 'predictions')
            # ابني SELECT ديناميكيًا من الأعمدة المتاحة
            wanted = ['id', 'prediction_date', 'created_at', 'signal', 'signal_type',
                      'recommendation', 'persona', 'entry_price', 'target_price',
                      'stop_loss', 'master_score', 'maestro_score', 'score', 'confidence',
                      'outcome_date', 'actual_return', 'is_correct', 'data_quality',
                      'holding_days', 'exit_type']
            select_cols = [c for c in wanted if c in pcols]
            select_sql = (
                f"SELECT {', '.join(select_cols)} FROM predictions "
                f"WHERE ticker = ? ORDER BY created_at DESC LIMIT 5"
            )
            rows = conn.execute(select_sql, (ticker,)).fetchall()
            if rows:
                for i, r in enumerate(rows, 1):
                    rd = dict(r)
                    print(f"\n  ── prediction #{i} (id={rd.get('id')}) ──")
                    print(f"    prediction_date : {rd.get('prediction_date')}")
                    print(f"    created_at       : {rd.get('created_at')}")
                    print(f"    signal           : {rd.get('signal', '(absent)')}")
                    print(f"    signal_type      : {rd.get('signal_type', '(absent)')}")
                    print(f"    recommendation   : {rd.get('recommendation', '(absent)')}")
                    print(f"    resolved signal  : {_resolve_signal(rd)}")
                    print(f"    persona          : {rd.get('persona')}")
                    print(f"    entry_price      : {rd.get('entry_price')}")
                    print(f"    target_price     : {rd.get('target_price')}")
                    print(f"    stop_loss        : {rd.get('stop_loss')}")
                    print(f"    master_score     : {rd.get('master_score', rd.get('maestro_score'))}")
                    print(f"    confidence       : {rd.get('confidence')}")
                    print(f"    outcome_date     : {rd.get('outcome_date')}")
                    print(f"    actual_return    : {rd.get('actual_return')}")
                    print(f"    is_correct       : {rd.get('is_correct')}")
                    print(f"    data_quality     : {rd.get('data_quality', '(absent)')}")
                    print(f"    holding_days     : {rd.get('holding_days')}")
                    print(f"    exit_type        : {rd.get('exit_type', '(absent)')}")
            else:
                print(f"  ⚠️ NO predictions for {ticker}")
        except Exception as e:
            print(f"❌ Query error: {e}")
        conn.close()

    # ── 5. MISMATCH analysis (schema-aware) ──
    print(f"\n─── 5) STALE/MISMATCH analysis for {ticker} ───")
    if os.path.exists(args.pred_db) and os.path.exists(args.stocks_db):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        pconn = db_manager.connection(args.pred_db, writable=False).__enter__()
        pconn.row_factory = sqlite3.Row
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        sconn = db_manager.connection(args.stocks_db, writable=False).__enter__()
        sconn.row_factory = sqlite3.Row
        try:
            pcols = _get_columns(pconn, 'predictions')
            # ابني SELECT ديناميكي للحقول المطلوبة للتحليل
            wanted = ['entry_price', 'target_price', 'stop_loss', 'signal', 'signal_type', 'recommendation']
            select_cols = [c for c in wanted if c in pcols]
            select_sql = (
                f"SELECT {', '.join(select_cols)} FROM predictions "
                f"WHERE ticker = ? ORDER BY created_at DESC LIMIT 1"
            )
            pred = pconn.execute(select_sql, (ticker,)).fetchone()
            stock = sconn.execute(
                "SELECT current_price FROM stocks WHERE ticker = ?",
                (ticker,)
            ).fetchone()
            if pred and stock:
                pd = dict(pred)
                entry = pd.get('entry_price')
                target = pd.get('target_price')
                stop = pd.get('stop_loss')
                current = stock['current_price']
                sig = _resolve_signal(pd)
                if entry is not None and current is not None:
                    try:
                        entry_f = float(entry)
                        target_f = float(target) if target is not None else 0.0
                        stop_f = float(stop) if stop is not None else 0.0
                        current_f = float(current)
                        stale_pct = abs(current_f - entry_f) / entry_f * 100 if entry_f > 0 else 0.0
                        is_buy = sig.upper() in ('BUY', 'ACCUMULATE', 'STRONG_BUY', 'T1_BUY', 'SWING_BUY')
                        mismatch = (is_buy and target_f > 0 and current_f >= target_f)
                        print(f"  stored entry  : {_f(entry_f)}")
                        print(f"  stored target : {_f(target_f)}")
                        print(f"  stored stop   : {_f(stop_f)}")
                        print(f"  live current  : {_f(current_f)}")
                        print(f"  stale_pct     : {_f(stale_pct, 1)}%  {'⚠️ STALE (>20%)' if stale_pct > 20 else '✅ OK'}")
                        print(f"  resolved sig  : {sig}  (is_buy={is_buy})")
                        print(f"  price_target_mismatch : {mismatch}  {'⚠️ الهدف محقّق — لا تعرض BUY' if mismatch else '✅ OK'}")
                    except (TypeError, ValueError) as e:
                        print(f"  ❌ numeric conversion error: {e}")
                        print(f"  raw: entry={entry!r} target={target!r} stop={stop!r} current={current!r}")
                else:
                    print(f"  ⚠️ missing entry_price or current_price — entry={entry!r} current={current!r}")
            else:
                print(f"  ⚠️ no prediction or stock row found — pred={bool(pred)} stock={bool(stock)}")
        except Exception as e:
            print(f"❌ Analysis error: {e}")
        pconn.close()
        sconn.close()

    print(f"\n{'='*70}\n")


if __name__ == '__main__':
    main()
