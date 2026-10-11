#!/usr/bin/env python3
"""
Rebuild Historical Predictions — إعادة بناء كل التوقعات التاريخية
=================================================================
بعد كل التحسينات (confidence fix, thresholds, fundamental bonus, DB sync)،
لازم نعيد بناء التوقعات عشان الأرقام تعكس الواقع الجديد.

السكربت بيعمل:
1. يمسح التوقعات القديمة من predictions table
2. يشغل trigger-analysis على كل أسهم EGX
3. يولّد توقعات جديدة في aiPrediction table
4. يطبع ملخص بالنتائج

Usage:
    cd vps-service
    python3 scripts/rebuild_predictions.py
"""

import sys
import os
import sqlite3
import time
from pathlib import Path
from datetime import datetime

# Add vps-service to path
VPS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(VPS_DIR))

PROJECT_ROOT = VPS_DIR.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def main():
    log("=" * 60)
    log("🔄 Rebuild Historical Predictions")
    log("=" * 60)

    # 1. Count current predictions
    log("\n--- 1. Current predictions count ---")
    try:
        conn = sqlite3.connect(PREDICTIONS_DB)
        conn.row_factory = sqlite3.Row

        tables_to_check = [
            'predictions',
            'stored_analyses',
            'aiPrediction',
            'cached_analysis',
        ]

        for table in tables_to_check:
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                log(f"  {table}: {count} rows")
            except Exception:
                log(f"  {table}: not found")

        conn.close()
    except Exception as e:
        log(f"  Error: {e}")
        return

    # 2. Clear old predictions (اختياري — اسأل المستخدم)
    log("\n--- 2. Clear old predictions ---")
    response = input("هل تريد مسح التوقعات القديمة؟ (y/N): ").strip().lower()
    if response != 'y':
        log("  تم التخطّي — سنبقي التوقعات القديمة")
    else:
        try:
            conn = sqlite3.connect(PREDICTIONS_DB)
            # DEV-06 (2026-10-12 — DUAL-TRACK): Hard DELETE disabled per Rule 21/35.
            # Replace with UPDATE status='ARCHIVED' + archive reason in notes.
            conn.execute(
                "UPDATE predictions SET status='ARCHIVED', "
                "notes=COALESCE(notes,'') || ' | DEV-06-ARCHIVED' WHERE 1=1"
            )
            deleted = conn.total_changes
            conn.commit()
            log(f"  ✓ تأرشفة {deleted} صف من predictions (ARCHIVED بدلاً من المسح)")

            # FIX (Aug 2026): لا نمسح aiPrediction ولا stored_analyses.
            # السبب: لما السوق يقفل يوم الخميس والـ script يمسح الجداول،
            # الشاشة بتفضي يومي السبت والأحد. التوقعات الجديدة بتعمل
            # UPSERT (INSERT OR REPLACE) عن طريق UNIQUE(ticker, market)
            # فبتستبدل القديم تلقائياً. التوقعات القديمة بتفضل ظاهرة
            # لحد ما تتولد توقعات جديدة تحل محلها.
            # (aiPrediction و stored_analyses بتفضل محتفظة ببياناتها)

            conn.close()
            log("  ✅ تم مسح سجل predictions التاريخي (مع الاحتفاظ بـ stored_analyses و aiPrediction)")
        except Exception as e:
            log(f"  ❌ Error: {e}")

    # 3. Get EGX stocks list
    log("\n--- 3. Get EGX stocks ---")
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row

        # جيب الأسهم المصرية بس (مش أرقام = سعودي)
        stocks = conn.execute("""
            SELECT ticker, name, name_ar, current_price, volume, sector, market
            FROM stocks
            WHERE current_price IS NOT NULL AND current_price > 0
            AND (market = 'EGX' OR market = 'مصر' OR market IS NULL OR market = '')
            AND ticker NOT GLOB '[0-9]*'
            ORDER BY volume DESC
            LIMIT 50
        """).fetchall()
        conn.close()

        log(f"  Found {len(stocks)} EGX stocks")
        if not stocks:
            log("  ⚠️ مفيش أسهم مصرية في stocks.db!")
            return
    except Exception as e:
        log(f"  Error: {e}")
        return

    # 4. Run Maestro analysis for each stock
    log("\n--- 4. Run Maestro analysis ---")
    try:
        from analyzers.maestro_orchestrator import MaestroOrchestrator
        orchestrator = MaestroOrchestrator(STOCKS_DB)
        log(f"  ✓ MaestroOrchestrator loaded")
    except Exception as e:
        log(f"  ❌ MaestroOrchestrator not available: {e}")
        return

    analyzed = 0
    buy_count = 0
    sell_count = 0
    hold_count = 0
    errors = 0

    # افتح connection لـ predictions.db
    pred_conn = sqlite3.connect(PREDICTIONS_DB)
    pred_conn.row_factory = sqlite3.Row

    # تأكد إن stored_analyses موجودة
    try:
        pred_conn.executescript('''
            CREATE TABLE IF NOT EXISTS stored_analyses (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                maestro_score REAL DEFAULT 0,
                recommendation TEXT DEFAULT 'hold',
                recommendation_ar TEXT,
                confidence REAL DEFAULT 0,
                entry_price REAL DEFAULT 0,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL DEFAULT 0,
                regime TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, market)
            );
        ''')
        pred_conn.commit()
    except Exception:
        pass

    for i, stock in enumerate(stocks, 1):
        ticker = stock['ticker']
        log(f"  [{i}/{len(stocks)}] {ticker}...")

        # ── AGILE-PHASE2-035 (B): Price-Change Skip ──────────────────────
        # لو السعر ما تحرّكش أكتر من 0.5% منذ آخر تحليل مخزّن (ومنتش خلال
        # ساعات الجلسة)، اتخطّى إعادة التحليل — استخدم التخزين الحالي.
        # ده بيخفّض الـ CPU load بنسبة ~80% لأن أغلب الأسهم بتتحرّك < 0.5%/دقيقة.
        try:
            _skip_sleep = float(os.environ.get('SCAN_SLEEP_SECONDS', '0.2') or '0.2')
        except Exception:
            _skip_sleep = 0.2

        try:
            _skip_conn = sqlite3.connect(f"file:{PREDICTIONS_DB}?mode=ro", uri=True, timeout=2.0)
            _skip_conn.row_factory = sqlite3.Row
            _skip_row = _skip_conn.execute(
                "SELECT entry_price, updated_at FROM stored_analyses WHERE ticker = ?",
                (ticker,)
            ).fetchone()
            _skip_conn.close()

            if _skip_row is not None:
                _entry_price = float(_skip_row['entry_price'] or 0)
                _updated_at_str = str(_skip_row['updated_at'] or '')
                _current_price_live = float(stock['current_price'] or 0)

                # هل السعر تحرّك أقل من 0.5%؟
                _price_moved_pct = 1.0  # default: skip-safe (assume moved)
                if _entry_price > 0 and _current_price_live > 0:
                    _price_moved_pct = abs(_current_price_live - _entry_price) / _entry_price

                # هل آخر تحليل من اليوم؟ (مش stale)
                _is_fresh = False
                try:
                    if _updated_at_str:
                        _updated_date = _updated_at_str.split(' ')[0].split('T')[0]
                        _today_date = datetime.now().strftime('%Y-%m-%d')
                        _is_fresh = (_updated_date == _today_date)
                except Exception:
                    _is_fresh = False

                # تطبيق الـ skip بس لو:
                #   - السعر تحرّك < 0.5%
                #   - والتحليل fresh (من اليوم)
                #   - ومنت خلال ساعات التداول (EgyptScheduler.is_trading_hours())
                _in_trading_hours = False
                try:
                    from core.egypt_scheduler import get_scheduler
                    _sched = get_scheduler()
                    _in_trading_hours = _sched.is_trading_hours()
                except Exception:
                    _in_trading_hours = False

                if (_price_moved_pct < 0.005 and _is_fresh and _in_trading_hours):
                    log(f"    [SKIP] {ticker}: price moved <0.5% since last analysis — using cached")
                    # تنفّس بين الأسهم
                    if _skip_sleep > 0:
                        time.sleep(_skip_sleep)
                    continue
        except Exception as _skip_err:
            # الـ skip اختياري — لو فشل، كمّل عادي
            pass

        try:
            # جلب price history
            history = []
            try:
                h_conn = sqlite3.connect(PRICE_HISTORY_DB)
                h_conn.row_factory = sqlite3.Row
                try:
                    h_rows = h_conn.execute("""
                        SELECT date, open_price as open, high_price as high,
                               low_price as low, close_price as close, volume
                        FROM price_history
                        WHERE ticker = ? AND close_price > 0
                        ORDER BY date DESC LIMIT 100
                    """, (ticker,)).fetchall()
                    history = list(reversed([dict(r) for r in h_rows]))
                except Exception:
                    h_rows = h_conn.execute("""
                        SELECT price_date as date, open, high, low, close, volume
                        FROM stock_daily_prices
                        WHERE ticker = ? AND close > 0
                        ORDER BY price_date DESC LIMIT 100
                    """, (ticker,)).fetchall()
                    history = list(reversed([dict(r) for r in h_rows]))
                h_conn.close()
            except Exception:
                pass

            if len(history) < 10:
                log(f"    ⚠️ Skip — only {len(history)} history rows")
                # تنفّس بين الأسهم
                if _skip_sleep > 0:
                    time.sleep(_skip_sleep)
                continue

            # تشغيل Maestro
            result = orchestrator.analyze(ticker, dict(stock), history, {})
            if result:
                analyzed += 1
                rec = (getattr(result, 'recommendation', 'hold') or 'hold').lower()
                score = getattr(result, 'maestro_score', 50) or 50
                confidence = getattr(result, 'confidence', 50) or 50

                if 'buy' in rec:
                    buy_count += 1
                elif 'sell' in rec:
                    sell_count += 1
                else:
                    hold_count += 1

                # تخزين في stored_analyses
                try:
                    pred_conn.execute("""
                        INSERT OR REPLACE INTO stored_analyses
                            (ticker, market, maestro_score, recommendation,
                             recommendation_ar, confidence, entry_price,
                             target_price, stop_loss, risk_reward, updated_at)
                        VALUES (?, 'EGX', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    """, (
                        ticker,
                        score,
                        rec,
                        getattr(result, 'recommendation_ar', ''),
                        confidence,
                        getattr(result, 'entry_price', stock.get('current_price', 0)),
                        getattr(result, 'target', None),
                        getattr(result, 'stop_loss', None),
                        getattr(result, 'risk_reward', 0) or 0,
                    ))
                    pred_conn.commit()
                except Exception as e:
                    log(f"    ⚠️ DB error: {e}")

                log(f"    ✅ {rec} (score={score:.1f}, conf={confidence:.1f}%)")
            else:
                log(f"    ⚠️ No result")
                errors += 1

        except Exception as e:
            log(f"    ❌ Error: {e}")
            errors += 1

        # ── AGILE-PHASE2-035 (C): CPU breath — تنفّس بين الأسهم ─────────
        # مهما كان السهم ناجح أو فاشل، نام SCAN_SLEEP_SECONDS (default 0.2)
        # عشان الـ CPU يلحق يتنفّس قبل السهم التالي.
        try:
            if _skip_sleep > 0:
                time.sleep(_skip_sleep)
        except Exception:
            pass

    # 5. Generate aiPrediction entries
    log("\n--- 5. Generate aiPrediction entries ---")
    try:
        from api.ai_predictions_routes import generate_predictions_internal
        gen_success, gen_preds = generate_predictions_internal(
            market='EGX', min_score=50, use_cached=True
        )
        if gen_success:
            log(f"  ✅ Generated {len(gen_preds)} aiPrediction entries")
        else:
            log(f"  ⚠️ Generation failed: {gen_preds}")
    except Exception as e:
        log(f"  ⚠️ Error: {e}")

    pred_conn.close()

    # 6. Summary
    log("\n" + "=" * 60)
    log("📊 Rebuild Summary")
    log("=" * 60)
    log(f"  Total stocks: {len(stocks)}")
    log(f"  Analyzed: {analyzed}")
    log(f"  BUY signals: {buy_count}")
    log(f"  SELL signals: {sell_count}")
    log(f"  HOLD signals: {hold_count}")
    log(f"  Errors: {errors}")
    log(f"  Success rate: {analyzed/(analyzed+errors)*100:.1f}%" if (analyzed+errors) > 0 else "  N/A")
    log("=" * 60)


if __name__ == '__main__':
    main()
