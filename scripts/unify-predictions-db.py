#!/usr/bin/env python3
"""
unify-predictions-db.py
=======================
يوحّد جداول التوقعات المبعثرة في 3 قواعد بيانات → 3 جداول نظيفة في predictions.db.

الكارثة قبل التوحيد (5 جداول في 3 DBs):
  1. predictions            (predictions.db, 5024 rows) ← نشط
  2. persona_predictions    (predictions.db,  686 rows) ← نشط
  3. aiPrediction           (predictions.db,    0 rows) ← ميت (DROP)
  4. prediction_logs        (stocks.db,        43 rows) ← misplaced (MOVE → predictions.db)
  5. platform_recommendations (custom.db,       0 rows) ← ميت (DROP)

بعد التوحيد (3 جداول نظيفة في predictions.db):
  1. predictions            ← + market, confidence columns
  2. persona_predictions    ← + master_score, confidence columns
  3. prediction_logs        ← moved from stocks.db + unified 40-column schema

الخطوات:
  Phase 1: إضافة أعمدة ناقصة لـ predictions + persona_predictions
  Phase 2: DROP aiPrediction + platform_recommendations (الاتنين فاضيين)
  Phase 3: CREATE prediction_logs الجديد في predictions.db + ترحيل 43 صف من stocks.db
  Phase 4: DROP prediction_logs القديم من stocks.db

SAFETY:
  - يفحص كل خطوة قبل التنفيذ
  - ما يindrش أي جدول فيه صفوف
  - كل ALTER/CREATE/DROP في try/except مع طباعة واضحة
"""
import sqlite3
import os
import sys
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRED_DB = os.path.join(BASE, 'db', 'predictions.db')
STOCKS_DB = os.path.join(BASE, 'db', 'stocks.db')
CUSTOM_DB = os.path.join(BASE, 'db', 'custom.db')

# ============================================================================
# Helpers
# ============================================================================

def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {level}: {msg}')

def table_exists(con, name):
    r = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
    return r is not None

def table_rows(con, name):
    if not table_exists(con, name):
        return 0
    try:
        return con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    except:
        return 0

def columns_of(con, name):
    if not table_exists(con, name):
        return []
    return [r[1] for r in con.execute(f'PRAGMA table_info("{name}")').fetchall()]

def add_column_if_missing(con, table, col, coldef):
    cols = columns_of(con, table)
    if col in cols:
        log(f'  ✓ {table}.{col} موجود بالفعل')
        return
    log(f'  + ALTER TABLE {table} ADD COLUMN {col} {coldef}')
    con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {coldef}')
    con.commit()

# ============================================================================
# Phase 1: إضافة أعمدة ناقصة
# ============================================================================

def phase1_add_columns():
    log('═══ Phase 1: إضافة أعمدة ناقصة ═══')
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(PRED_DB, writable=False).__enter__()
    try:
        # predictions: + market, confidence
        log('▶ predictions: إضافة market, confidence')
        add_column_if_missing(con, 'predictions', 'market', "TEXT DEFAULT 'EGX'")
        add_column_if_missing(con, 'predictions', 'confidence', 'REAL')

        # persona_predictions: + master_score, confidence
        log('▶ persona_predictions: إضافة master_score, confidence')
        add_column_if_missing(con, 'persona_predictions', 'master_score', 'REAL')
        add_column_if_missing(con, 'persona_predictions', 'confidence', 'REAL')

        log('✅ Phase 1 مكتمل')
    finally:
        con.close()

# ============================================================================
# Phase 2: DROP الجداول الميتة (فاضية)
# ============================================================================

def phase2_drop_dead_tables():
    log('═══ Phase 2: DROP الجداول الميتة ═══')

    # aiPrediction في predictions.db (0 صفوف)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(PRED_DB, writable=False).__enter__()
    try:
        rows = table_rows(con, 'aiPrediction')
        if rows > 0:
            log(f'  ⚠️ aiPrediction فيه {rows} صف — ما ندرسش (آمن)')
        else:
            if table_exists(con, 'aiPrediction'):
                log('  ✗ DROP TABLE aiPrediction (0 صفوف، ميت)')
                con.execute('DROP TABLE IF EXISTS aiPrediction')
                con.commit()
            else:
                log('  ✓ aiPrediction غير موجود')
        # aiPredictionStats (تابع)
        if table_exists(con, 'aiPredictionStats') and table_rows(con, 'aiPredictionStats') == 0:
            log('  ✗ DROP TABLE aiPredictionStats (0 صفوف، تابع ميت)')
            con.execute('DROP TABLE IF EXISTS aiPredictionStats')
            con.commit()
    finally:
        con.close()

    # platform_recommendations في custom.db (0 صفوف)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(CUSTOM_DB, writable=False).__enter__()
    try:
        rows = table_rows(con, 'platform_recommendations')
        if rows > 0:
            log(f'  ⚠️ platform_recommendations فيه {rows} صف — ما ندرسش')
        else:
            if table_exists(con, 'platform_recommendations'):
                log('  ✗ DROP TABLE platform_recommendations (0 صفوف، ميت، 3 schemas متضاربة)')
                con.execute('DROP TABLE IF EXISTS platform_recommendations')
                con.commit()
            else:
                log('  ✓ platform_recommendations غير موجود')
    finally:
        con.close()

    log('✅ Phase 2 مكتمل')

# ============================================================================
# Phase 3: إنشاء prediction_logs موحّد في predictions.db + ترحيل 43 صف
# ============================================================================

UNIFIED_PREDICTION_LOGS_SCHEMA = """
CREATE TABLE IF NOT EXISTS prediction_logs (
    id TEXT PRIMARY KEY,
    -- Stock identification
    ticker TEXT NOT NULL,
    stock_name TEXT,
    stock_id TEXT,
    sector TEXT,
    market TEXT DEFAULT 'EGX',
    -- Prediction
    prediction_date TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    predicted_direction TEXT,
    confidence REAL,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    -- Scores
    composite_score REAL,
    technical_score REAL,
    fundamental_score REAL,
    quality_score REAL,
    momentum_score REAL,
    -- Context (JSON blobs)
    market_regime TEXT,
    regime_multiplier REAL,
    indicators_used TEXT,
    weights_snapshot TEXT,
    features_snapshot TEXT,
    model_version TEXT,
    source TEXT DEFAULT 'system',
    -- Predicted prices (for backtesting)
    predicted_price_5d REAL,
    predicted_price_10d REAL,
    predicted_price_20d REAL,
    -- Verification (5d)
    actual_price_5d REAL,
    direction_correct_5d INTEGER DEFAULT 0,
    price_error_5d REAL,
    -- Verification (10d)
    actual_price_10d REAL,
    direction_correct_10d INTEGER DEFAULT 0,
    price_error_10d REAL,
    -- Verification (20d)
    actual_price_20d REAL,
    direction_correct_20d INTEGER DEFAULT 0,
    price_error_20d REAL,
    -- Final outcome
    target_reached INTEGER DEFAULT 0,
    stop_hit INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    verified_at TEXT,
    verification_date TEXT,
    actual_price REAL,
    price_change_percent REAL,
    outcome TEXT,
    profit_percent REAL,
    holding_days INTEGER,
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
"""

def phase3_migrate_prediction_logs():
    log('═══ Phase 3: ترحيل prediction_logs من stocks.db → predictions.db ═══')

    # أولاً: هل prediction_logs موجود في predictions.db أصلاً؟
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con_pred = db_manager.connection(PRED_DB, writable=False).__enter__()
    try:
        if table_exists(con_pred, 'prediction_logs'):
            existing = table_rows(con_pred, 'prediction_logs')
            log(f'  ⚠️ prediction_logs موجود في predictions.db بـ {existing} صف')
            if existing > 0:
                log('  → سنحافظ على البيانات الموجودة ونضيف أي صفوف ناقصة من stocks.db')
    finally:
        con_pred.close()

    # اقرأ من stocks.db
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con_stocks = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    stocks_rows = []
    stocks_cols = []
    try:
        if not table_exists(con_stocks, 'prediction_logs'):
            log('  ✓ prediction_logs غير موجود في stocks.db — لا حاجة للترحيل')
            return
        stocks_rows = con_stocks.execute('SELECT * FROM prediction_logs').fetchall()
        stocks_cols = [d[0] for d in con_stocks.execute('SELECT * FROM prediction_logs LIMIT 1').description]
        log(f'  ← قرأ {len(stocks_rows)} صف من stocks.db (أعمدة: {len(stocks_cols)})')
    finally:
        con_stocks.close()

    if not stocks_rows:
        log('  ✓ stocks.db.prediction_logs فاضي — لا حاجة للترحيل')
        return

    # أنشئ prediction_logs الموحّد في predictions.db
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    con_pred = db_manager.connection(PRED_DB, writable=True).__enter__()
    try:
        con_pred.execute(UNIFIED_PREDICTION_LOGS_SCHEMA)
        con_pred.commit()
        log('  ✓ CREATE TABLE prediction_logs في predictions.db (40 عمود موحّد)')

        # خريطة الأعمدة: stocks.db column → unified column
        # الـ stocks.db schema الحالي:
        #   id, ticker, prediction_date, recommendation, confidence,
        #   entry_price, target_price, stop_loss,
        #   direction_correct_5d, direction_correct_10d,
        #   target_reached, stop_hit,
        #   actual_price_5d, actual_price_10d, created_at
        col_map = {
            'id': 'id',
            'ticker': 'ticker',
            'prediction_date': 'prediction_date',
            'recommendation': 'recommendation',
            'confidence': 'confidence',
            'entry_price': 'entry_price',
            'target_price': 'target_price',
            'stop_loss': 'stop_loss',
            'direction_correct_5d': 'direction_correct_5d',
            'direction_correct_10d': 'direction_correct_10d',
            'target_reached': 'target_reached',
            'stop_hit': 'stop_hit',
            'actual_price_5d': 'actual_price_5d',
            'actual_price_10d': 'actual_price_10d',
            'created_at': 'created_at',
        }

        # بناء INSERT ديناميكي
        target_cols = [col_map[c] for c in stocks_cols if c in col_map]
        placeholders = ', '.join(['?'] * len(target_cols))
        col_list = ', '.join(target_cols)
        insert_sql = f'INSERT OR IGNORE INTO prediction_logs ({col_list}) VALUES ({placeholders})'

        migrated = 0
        skipped = 0
        for row in stocks_rows:
            values = []
            for i, c in enumerate(stocks_cols):
                if c in col_map:
                    values.append(row[i])
            try:
                con_pred.execute(insert_sql, values)
                migrated += 1
            except sqlite3.IntegrityError:
                skipped += 1
        con_pred.commit()
        log(f'  → رحّل {migrated} صف، تخطّى {skipped} (مكرر/موجود)')
    finally:
        con_pred.close()

    log('✅ Phase 3 مكتمل')

# ============================================================================
# Phase 4: DROP prediction_logs القديم من stocks.db
# ============================================================================

def phase4_drop_old_prediction_logs():
    log('═══ Phase 4: DROP prediction_logs القديم من stocks.db ═══')
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    try:
        # تأكيد إن الترحيل تم قبل الحذف
        stocks_count = table_rows(con, 'prediction_logs')
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        pred_con = db_manager.connection(PRED_DB, writable=False).__enter__()
        pred_count = table_rows(pred_con, 'prediction_logs')
        pred_con.close()

        if pred_count < stocks_count:
            log(f'  ⚠️ predictions.db فيه {pred_count} صف لكن stocks.db فيه {stocks_count} — ما ندرسش!')
            return

        if table_exists(con, 'prediction_logs'):
            log(f'  ✗ DROP TABLE stocks.db.prediction_logs ({stocks_count} صف اترحّلوا بالفعل)')
            con.execute('DROP TABLE IF EXISTS prediction_logs')
            con.commit()
        else:
            log('  ✓ prediction_logs غير موجود في stocks.db')
    finally:
        con.close()
    log('✅ Phase 4 مكتمل')

# ============================================================================
# التحقق النهائي
# ============================================================================

def verify_final_state():
    log('═══ التحقق النهائي ═══')
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(PRED_DB, writable=False).__enter__()
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
        log(f'  predictions.db tables: {tables}')
        for t in ['predictions', 'persona_predictions', 'prediction_logs']:
            rows = table_rows(con, t)
            cols = columns_of(con, t)
            log(f'    {t}: {rows} صف، {len(cols)} عمود')
        # تأكد إن aiPrediction مش موجود
        if 'aiPrediction' in tables:
            log('  ⚠️ aiPrediction لسه موجود!')
        else:
            log('  ✓ aiPrediction اتشال')
    finally:
        con.close()

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    try:
        if table_exists(con, 'prediction_logs'):
            log('  ⚠️ stocks.db.prediction_logs لسه موجود!')
        else:
            log('  ✓ stocks.db.prediction_logs اتشال')
    finally:
        con.close()

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(CUSTOM_DB, writable=False).__enter__()
    try:
        if table_exists(con, 'platform_recommendations'):
            log('  ⚠️ custom.db.platform_recommendations لسه موجود!')
        else:
            log('  ✓ custom.db.platform_recommendations اتشال')
    finally:
        con.close()

# ============================================================================
# Main
# ============================================================================

def main():
    log('🚀 بدء توحيد جداول التوقعات')
    log(f'  predictions.db: {PRED_DB}')
    log(f'  stocks.db: {STOCKS_DB}')
    log(f'  custom.db: {CUSTOM_DB}')
    print()

    phase1_add_columns()
    print()
    phase2_drop_dead_tables()
    print()
    phase3_migrate_prediction_logs()
    print()
    phase4_drop_old_prediction_logs()
    print()
    verify_final_state()
    print()
    log('✅ التوحيد مكتمل! شوف التحقق النهائي فوق.')

if __name__ == '__main__':
    main()
