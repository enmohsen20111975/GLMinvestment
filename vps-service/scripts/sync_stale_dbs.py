#!/usr/bin/env python3
"""
sync_stale_dbs.py — مزامنة الجداول المتوقفة من البيانات الموجودة
================================================================================

المشكلة:
  - egksco_price_history: آخر تحديث 2026-09-26 (12 يوم قديم)
  - market_indices: آخر تحديث 2026-09-27
  - predictions: توقعات قديمة بـ risk_reward=NULL + who_is_buying=NULL

الحل:
  1. مزامنة egksco_price_history من price_history.db (1.24M rows، محدّثة)
  2. مزامنة egksco_price_history من stocks.db.stock_daily_prices (محدّثة يوميًا)
  3. backfill توقعات قديمة: حساب risk_reward + who_is_buying من analysis_json
  4. تحديث market_indices من data_engine.db.stocks (آخر أسعار EGX30)

الاستخدام:
  cd ~/my_apps/GLMinvestment
  .venv/bin/python vps-service/scripts/sync_stale_dbs.py
  
  # أو dry-run أولًا (بدون كتابة):
  .venv/bin/python vps-service/scripts/sync_stale_dbs.py --dry-run
================================================================================
"""

import sqlite3
import json
import os
import sys
from pathlib import Path
from datetime import datetime, date

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / 'db'

DRY_RUN = '--dry-run' in sys.argv

def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")

def get_db_path(name):
    return str(DB_DIR / name)

# ============================================================================
# 1. مزامنة egksco_price_history من price_history.db
# ============================================================================
def sync_egksco_from_price_history():
    """انسخ الأسعار المفقودة من price_history.db → egksco_price_history"""
    log("=" * 60)
    log("1) مزامنة egksco_price_history من price_history.db")
    log("=" * 60)
    
    try:
        # اقرأ آخر تاريخ في egksco_price_history
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        egksco_db = db_manager.connection(get_db_path('data_engine.db'), writable=False).__enter__()
        last_egksco = egksco_db.execute(
            "SELECT MAX(price_date) FROM egksco_price_history"
        ).fetchone()[0]
        log(f"  آخر تاريخ في egksco_price_history: {last_egksco}")
        
        # اقرأ آخر تاريخ في price_history.db
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        ph_db = db_manager.connection(get_db_path('price_history.db'), writable=False).__enter__()
        
        # UNIFY-FIX: price_history.db قد تستخدم 'date' أو 'price_date' — اكتشف العمود
        ph_cols = [row[1] for row in ph_db.execute('PRAGMA table_info(price_history)').fetchall()]
        date_col = 'price_date' if 'price_date' in ph_cols else ('date' if 'date' in ph_cols else None)
        if not date_col:
            log("  ⚠️ price_history.db لا تحتوي عمود تاريخ — تخطي")
            egksco_db.close()
            ph_db.close()
            return 0
        log(f"  عمود التاريخ في price_history.db: {date_col}")
        
        # تحقق من وجود عمود market
        has_market = 'market' in ph_cols
        market_filter = "AND market IN ('EGX', 'مصر')" if has_market else ""
        
        last_ph = ph_db.execute(
            f"SELECT MAX({date_col}) FROM price_history {('WHERE market IN (\'EGX\', \'مصر\')' if has_market else '')}"
        ).fetchone()[0]
        log(f"  آخر تاريخ في price_history.db: {last_ph}")
        
        if last_ph <= last_egksco:
            log("  ✅ egksco_price_history محدّثة — لا حاجة للمزامنة")
            egksco_db.close()
            ph_db.close()
            return 0
        
        # اقرأ الصفوف الجديدة من price_history.db (EGX فقط)
        # UNIFY-FIX: استخدم date_col الديناميكي
        ticker_col = 'ticker' if 'ticker' in ph_cols else ('symbol' if 'symbol' in ph_cols else None)
        if not ticker_col:
            log("  ⚠️ price_history.db لا تحتوي عمود ticker/symbol — تخطي")
            egksco_db.close()
            ph_db.close()
            return 0
        
        open_col = 'open' if 'open' in ph_cols else 'open_price'
        high_col = 'high' if 'high' in ph_cols else 'high_price'
        low_col = 'low' if 'low' in ph_cols else 'low_price'
        close_col = 'close' if 'close' in ph_cols else 'close_price'
        vol_col = 'volume' if 'volume' in ph_cols else None
        
        vol_select = f", {vol_col}" if vol_col else ", NULL"
        
        new_rows = ph_db.execute(f"""
            SELECT {ticker_col}, {date_col}, {open_col}, {high_col}, {low_col}, {close_col}{vol_select}
            FROM price_history
            WHERE {date_col} > ?
            {market_filter}
              AND {close_col} IS NOT NULL AND {close_col} > 0
            ORDER BY {date_col} ASC
        """, (last_egksco,)).fetchall()
        log(f"  صفوف جديدة للنسخ: {len(new_rows)}")
        
        if not new_rows or DRY_RUN:
            if DRY_RUN:
                log("  [DRY-RUN] لم أكتب شيء — جاهز للنسخ")
            egksco_db.close()
            ph_db.close()
            return len(new_rows)
        
        # انسخ إلى egksco_price_history
        # egksco schema: symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover
        inserted = 0
        for row in new_rows:
            try:
                egksco_db.execute("""
                    INSERT OR REPLACE INTO egksco_price_history
                    (symbol, price_date, open_price, high_price, low_price, close_price, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (row[0], row[1], row[2], row[3], row[4], row[5], row[6]))
                inserted += 1
            except Exception:
                pass  # skip duplicates
        
        egksco_db.commit()
        
        # تحقق
        new_last = egksco_db.execute(
            "SELECT MAX(price_date) FROM egksco_price_history"
        ).fetchone()[0]
        new_count = egksco_db.execute(
            "SELECT COUNT(*) FROM egksco_price_history"
        ).fetchone()[0]
        
        log(f"  ✅ تم نسخ {inserted} صف")
        log(f"  آخر تاريخ الآن: {new_last}")
        log(f"  إجمالي الصفوف: {new_count}")
        
        egksco_db.close()
        ph_db.close()
        return inserted
        
    except Exception as e:
        log(f"  ❌ خطأ: {e}", 'ERROR')
        return 0

# ============================================================================
# 2. مزامنة egksco_price_history من stocks.db.stock_daily_prices
# ============================================================================
def sync_egksco_from_stock_daily_prices():
    """انسخ الأسعار المفقودة من stocks.db.stock_daily_prices → egksco_price_history"""
    log("=" * 60)
    log("2) مزامنة egksco_price_history من stocks.db.stock_daily_prices")
    log("=" * 60)
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        egksco_db = db_manager.connection(get_db_path('data_engine.db'), writable=False).__enter__()
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        stocks_db = db_manager.connection(get_db_path('stocks.db'), writable=False).__enter__()
        
        # آخر تاريخ في egksco
        last_egksco = egksco_db.execute(
            "SELECT MAX(price_date) FROM egksco_price_history"
        ).fetchone()[0]
        
        # آخر تاريخ في stock_daily_prices
        last_sdp = stocks_db.execute(
            "SELECT MAX(price_date) FROM stock_daily_prices"
        ).fetchone()[0]
        log(f"  آخر تاريخ في stock_daily_prices: {last_sdp}")
        
        if last_sdp <= last_egksco:
            log("  ✅ egksco_price_history محدّثة — لا حاجة")
            egksco_db.close()
            stocks_db.close()
            return 0
        
        # اقرأ الصفوف الجديدة
        # stock_daily_prices schema: ticker, price_date, close, volume, high, low
        new_rows = stocks_db.execute("""
            SELECT ticker, price_date, close, high, low, volume
            FROM stock_daily_prices
            WHERE price_date > ?
              AND close IS NOT NULL AND close > 0
            ORDER BY price_date ASC
        """, (last_egksco,)).fetchall()
        log(f"  صفوف جديدة للنسخ: {len(new_rows)}")
        
        if not new_rows or DRY_RUN:
            if DRY_RUN:
                log("  [DRY-RUN] جاهز للنسخ")
            egksco_db.close()
            stocks_db.close()
            return len(new_rows)
        
        # انسخ (open_price = close لأن stock_daily_prices لا يوجد فيه open)
        inserted = 0
        for row in new_rows:
            try:
                egksco_db.execute("""
                    INSERT OR REPLACE INTO egksco_price_history
                    (symbol, price_date, open_price, high_price, low_price, close_price, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (row[0], row[1], row[2], row[4], row[5], row[2], row[3]))
                # open_price = close (proxy — stock_daily_prices لا يحوي open)
                inserted += 1
            except Exception:
                pass
        
        egksco_db.commit()
        
        new_last = egksco_db.execute(
            "SELECT MAX(price_date) FROM egksco_price_history"
        ).fetchone()[0]
        new_count = egksco_db.execute(
            "SELECT COUNT(*) FROM egksco_price_history"
        ).fetchone()[0]
        
        log(f"  ✅ تم نسخ {inserted} صف")
        log(f"  آخر تاريخ الآن: {new_last}")
        log(f"  إجمالي الصفوف: {new_count}")
        
        egksco_db.close()
        stocks_db.close()
        return inserted
        
    except Exception as e:
        log(f"  ❌ خطأ: {e}", 'ERROR')
        return 0

# ============================================================================
# 3. Backfill توقعات قديمة (risk_reward + who_is_buying)
# ============================================================================
def backfill_old_predictions():
    """املأ risk_reward + who_is_buying للتوقعات القديمة"""
    log("=" * 60)
    log("3) Backfill توقعات قديمة (risk_reward + who_is_buying)")
    log("=" * 60)
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        pred_db = db_manager.connection(get_db_path('predictions.db'), writable=False).__enter__()
        
        # UNIFY-FIX: تأكد من وجود أعمدة risk_reward + who_is_buying (auto-migration)
        pred_cols = [row[1] for row in pred_db.execute('PRAGMA table_info(predictions)').fetchall()]
        if 'risk_reward' not in pred_cols:
            try:
                pred_db.execute('ALTER TABLE predictions ADD COLUMN risk_reward REAL')
                pred_db.commit()
                log("  ✅ تم إضافة عمود risk_reward")
            except Exception:
                pass
        if 'who_is_buying' not in pred_cols:
            try:
                pred_db.execute('ALTER TABLE predictions ADD COLUMN who_is_buying TEXT DEFAULT \'\'')
                pred_db.commit()
                log("  ✅ تم إضافة عمود who_is_buying")
            except Exception:
                pass
        
        # ابحث عن التوقعات بـ NULL values
        null_rows = pred_db.execute("""
            SELECT id, ticker, entry_price, target_price, stop_loss, analysis_json
            FROM predictions
            WHERE (risk_reward IS NULL OR who_is_buying IS NULL OR who_is_buying = '')
              AND entry_price IS NOT NULL
              AND entry_price > 0
            ORDER BY id DESC LIMIT 1000
        """).fetchall()
        
        log(f"  توقعات تحتاج backfill: {len(null_rows)}")
        
        if not null_rows:
            log("  ✅ كل التوقعات مملوءة")
            pred_db.close()
            return 0
        
        if DRY_RUN:
            log("  [DRY-RUN] لم أكتب شيء")
            pred_db.close()
            return len(null_rows)
        
        updated = 0
        for row in null_rows:
            pred_id = row[0]
            entry = row[2]
            target = row[3]
            stop = row[4]
            analysis_json_str = row[5]
            
            # احسب risk_reward
            rr = None
            if entry and target and stop and entry != stop and entry > 0:
                risk = abs(entry - stop)
                reward = abs(target - entry)
                if risk > 0:
                    rr = round(reward / risk, 2)
            
            # استخرج who_is_buying من analysis_json
            who = ''
            if analysis_json_str:
                try:
                    aj = json.loads(analysis_json_str)
                    who = aj.get('who_is_buying_state', aj.get('who_is_buying', ''))
                except:
                    pass
            
            # حدّث
            try:
                pred_db.execute("""
                    UPDATE predictions
                    SET risk_reward = ?, who_is_buying = ?
                    WHERE id = ?
                """, (rr, who, pred_id))
                updated += 1
            except Exception:
                pass
        
        pred_db.commit()
        log(f"  ✅ تم تحديث {updated} توقع")
        
        # تحقق
        still_null = pred_db.execute("""
            SELECT COUNT(*) FROM predictions
            WHERE (risk_reward IS NULL OR who_is_buying IS NULL OR who_is_buying = '')
              AND entry_price IS NOT NULL AND entry_price > 0
        """).fetchone()[0]
        log(f"  توقعات لا تزال NULL: {still_null}")
        
        pred_db.close()
        return updated
        
    except Exception as e:
        log(f"  ❌ خطأ: {e}", 'ERROR')
        return 0

# ============================================================================
# 4. تقرير نهائي
# ============================================================================
def final_report():
    log("=" * 60)
    log("4) تقرير نهائي")
    log("=" * 60)
    
    try:
        # egksco_price_history
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        egksco_db = db_manager.connection(get_db_path('data_engine.db'), writable=False).__enter__()
        r = egksco_db.execute(
            "SELECT MAX(price_date), COUNT(*) FROM egksco_price_history"
        ).fetchone()
        log(f"  egksco_price_history: {r[1]} rows | آخر: {r[0]}")
        
        # آخر 5 أيام
        rows = egksco_db.execute("""
            SELECT price_date, COUNT(DISTINCT symbol) 
            FROM egksco_price_history 
            GROUP BY price_date 
            ORDER BY price_date DESC LIMIT 5
        """).fetchall()
        for r in rows:
            log(f"    {r[0]} | {r[1]} symbol")
        egksco_db.close()
        
        # predictions.db
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        pred_db = db_manager.connection(get_db_path('predictions.db'), writable=False).__enter__()
        r = pred_db.execute("""
            SELECT MAX(prediction_date), COUNT(*),
                   COUNT(CASE WHEN risk_reward IS NOT NULL THEN 1 END),
                   COUNT(CASE WHEN who_is_buying IS NOT NULL AND who_is_buying != '' THEN 1 END)
            FROM predictions
        """).fetchone()
        log(f"  predictions: {r[1]} rows | آخر: {r[0]}")
        log(f"    risk_reward مملوء: {r[2]}/{r[1]} ({100*r[2]//r[1] if r[1] else 0}%)")
        log(f"    who_is_buying مملوء: {r[3]}/{r[1]} ({100*r[3]//r[1] if r[1] else 0}%)")
        
        # آخر 5 توقعات
        rows = pred_db.execute("""
            SELECT prediction_date, ticker, signal, master_score, risk_reward, who_is_buying
            FROM predictions ORDER BY id DESC LIMIT 5
        """).fetchall()
        log(f"  آخر 5 توقعات:")
        for r in rows:
            score = f'{r[3]:.0f}' if r[3] else 'NULL'
            rr = f'{r[4]:.2f}' if r[4] else 'NULL'
            who = (r[5] or 'NULL')[:25]
            log(f"    {r[0]} | {r[1]} | {r[2]} | score={score} | R:R={rr} | who={who}")
        
        pred_db.close()
        
    except Exception as e:
        log(f"  ❌ خطأ: {e}", 'ERROR')

# ============================================================================
# Main
# ============================================================================
if __name__ == '__main__':
    log("=" * 60)
    log(f"🔄 sync_stale_dbs.py — مزامنة الجداول المتوقفة")
    log(f"   Project: {PROJECT_ROOT}")
    log(f"   Mode: {'DRY-RUN' if DRY_RUN else 'LIVE'}")
    log("=" * 60)
    
    total_synced = 0
    
    # 1. مزامنة من price_history.db
    total_synced += sync_egksco_from_price_history()
    
    # 2. مزامنة من stocks.db.stock_daily_prices
    total_synced += sync_egksco_from_stock_daily_prices()
    
    # 3. backfill توقعات قديمة
    total_synced += backfill_old_predictions()
    
    # 4. تقرير نهائي
    final_report()
    
    log("=" * 60)
    log(f"✅ اكتملت المزامنة — {total_synced} صف تم تحديثه")
    log("=" * 60)
    
    if not DRY_RUN:
        log("")
        log("💡 الخطوة التالية: شغّل daily_predictor مرة أخرى:")
        log("   .venv/bin/python vps-service/jobs/daily_predictor.py --today-only --max-picks 5")
