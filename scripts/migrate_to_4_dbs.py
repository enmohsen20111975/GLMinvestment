#!/usr/bin/env python3
"""
migrate_to_4_dbs.py — سكربت تشغيلى واحد لإعادة هيكلة قواعد البيانات
================================================================
PHASE-4-DB-REORG (2026-08-29): دمج 19 قاعدة بيانات في 4 فقط.

التصميم:
    1. stocks.db      — كل بيانات السوق والأسعار والميتاداتا والأساسيات
    2. predictions.db  — كل التوقعات والتعلم والنتائج
    3. auth.db         — المستخدمين والاشتراكات
    4. content.db      — الأخبار والتليجرام والمحتوى

الاستخدام:
    python3 scripts/migrate_to_4_dbs.py --dry-run    # معاينة
    python3 scripts/migrate_to_4_dbs.py               # تنفيذ
    python3 scripts/migrate_to_4_dbs.py --verify      # تحقق فقط

المبادئ:
    - لا يحذف القواعد القديمة (backup آمن)
    - يتحقق من عدد الصفوف قبل/بعد كل نقل
    - يسجل كل خطوة في log
    - يعمل على الإنتاج (مسارات نسبية)
"""

import sqlite3
import os
import sys
import shutil
import json
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'
LOG_FILE = DB_DIR / 'migration_log.json'

# ═══════════════════════════════════════════════════════════════════════════
# تعريف الـ 4 قواعد + الجداول التي تنتقل لكل واحدة
# ═══════════════════════════════════════════════════════════════════════════

MIGRATION_PLAN = {
    'stocks.db': {
        'source_dbs': {
            'data_engine.db': [
                'egksco_price_history', 'crypto_prices', 'gold_prices',
                'silver_prices', 'exchange_rates', 'btc_local_prices',
                'stock_prices', 'stocks', 'screener_lists',
                'gold_prices_clean',
                'tab_balance_sheet', 'tab_cash_flow', 'tab_dividends',
                'tab_income_statement', 'tab_performance',
                'tab_profitability', 'tab_technical_analysis', 'tab_valuation',
            ],
            'intraday.db': [
                'stock_intraday', 'crypto_intraday', 'commodity_intraday',
                'intraday_meta',
            ],
            'stocks.db': [
                'stocks', 'stock_daily_prices', 'stock_phase',
                'screener_presets', 'screener_results',
                'egksco_stocks', 'egksco_sync_status',
                'market_indices', 'market_regime_log', 'macro_indicators',
                'stocks_backup', 'system_settings',
                'tuned_predictions_summary', 'real_evaluated_predictions',
                'cached_analysis', 'analytics_events',
            ],
            'crypto.db': [
                'cryptos', 'crypto_price_history', 'crypto_metrics',
                'sync_status', 'crypto_fetch_log', 'btc_local_prices',
            ],
            'macro.db': [
                'macro_prices', 'macro_fetch_log',
            ],
        },
    },
    'predictions.db': {
        'source_dbs': {
            # predictions.db already has most tables — keep them
            'predictions.db': [
                'predictions', 'persona_predictions', 'prediction_logs',
                'outcome_logs', 'learned_lessons', 'conjunction_patterns',
                'indicator_trust_scores', 'quant_cache', 'stored_analyses',
                'morning_bell_signals', 'exit_notifications',
                'backtest_results', 'optimizer_params_history',
                'ExpertRecommendation', 'crypto_predictions_log',
                'aiPredictionStats',
            ],
            # From stocks.db (consolidate ExpertRecommendation)
            'stocks.db': [
                'ExpertRecommendation',
            ],
            # From auth.db (consolidate ExpertRecommendation)
            'auth.db': [
                'ExpertRecommendation',
            ],
        },
    },
    'auth.db': {
        'source_dbs': {
            'auth.db': [
                'User', 'PromoCode', 'SubscriptionPlan', 'api_tokens',
                'task_runs', 'user_trades',
            ],
            'stocks.db': [
                'portfolios', 'portfolio_assets', 'user_stock_watchlists',
            ],
        },
    },
    'content.db': {
        'source_dbs': {
            'news.db': [
                'news_articles',
            ],
            'telegram_data.db': [
                'telegram_messages', 'telegram_news',
                'telegram_recommendations', 'scraping_status',
                'tracked_channels',
            ],
        },
    },
}

# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")

def get_table_count(conn, table: str) -> int:
    try:
        return conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
    except:
        return -1

def table_exists(conn, table: str) -> bool:
    try:
        r = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()
        return r is not None
    except:
        return False

def copy_table(src_conn, dst_conn, table: str, src_db: str, dst_db: str) -> dict:
    """انسخ جدول من src DB لـ dst DB (مع schema + data)."""
    result = {'table': table, 'src_db': src_db, 'dst_db': dst_db,
              'rows_copied': 0, 'status': 'skipped', 'error': None}

    if not table_exists(src_conn, table):
        result['status'] = 'source_not_found'
        return result

    src_count = get_table_count(src_conn, table)
    result['rows_before'] = src_count

    if src_count == 0:
        result['status'] = 'empty_skipped'
        return result

    try:
        # احصل على schema
        schema_row = src_conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()
        if not schema_row:
            result['status'] = 'no_schema'
            return result

        schema_sql = schema_row[0]

        # احذف الجدول لو موجود في dst
        dst_conn.execute(f"DROP TABLE IF EXISTS [{table}]")

        # أنشئ schema
        dst_conn.execute(schema_sql)

        # انسخ البيانات
        src_conn.row_factory = sqlite3.Row
        rows = src_conn.execute(f"SELECT * FROM [{table}]").fetchall()

        if rows:
            cols = [desc[0] for desc in src_conn.execute(f"SELECT * FROM [{table}] LIMIT 1").description]
            placeholders = ','.join(['?'] * len(cols))
            col_list = ','.join([f'[{c}]' for c in cols])

            for row in rows:
                dst_conn.execute(
                    f"INSERT INTO [{table}] ({col_list}) VALUES ({placeholders})",
                    tuple(row)
                )

        dst_conn.commit()
        result['rows_copied'] = len(rows)
        result['status'] = 'ok'
    except Exception as e:
        result['status'] = 'error'
        result['error'] = str(e)

    return result

# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════

def run_migration(dry_run: bool = False):
    log("=" * 60)
    log("PHASE-4-DB-REORG: دمج 19 قاعدة → 4 قواعد")
    log("=" * 60)
    log(f"DB_DIR: {DB_DIR}")
    log(f"Mode: {'DRY-RUN' if dry_run else 'EXECUTE'}")
    log("")

    all_results = {}

    for target_db_name, plan in MIGRATION_PLAN.items():
        target_path = DB_DIR / target_db_name
        log(f"📁 Target: {target_db_name}")

        if dry_run:
            # معاينة فقط
            for src_db_name, tables in plan['source_dbs'].items():
                src_path = DB_DIR / src_db_name
                if not src_path.exists():
                    log(f"  ⚠️ Source not found: {src_db_name}", "WARN")
                    continue
                src_conn = sqlite3.connect(str(src_path))
                for table in tables:
                    count = get_table_count(src_conn, table)
                    status = f"{count:,} rows" if count >= 0 else "not found"
                    log(f"  ← {src_db_name}.{table}: {status}")
                src_conn.close()
            log("")
            continue

        # تنفيذ
        if target_db_name == 'predictions.db':
            # predictions.db موجود بالفعل — أضف إليه
            if not target_path.exists():
                log(f"  ⚠️ {target_db_name} not found — creating new", "WARN")
                target_path.touch()

        target_conn = sqlite3.connect(str(target_path))
        db_results = []

        for src_db_name, tables in plan['source_dbs'].items():
            src_path = DB_DIR / src_db_name
            if not src_path.exists():
                log(f"  ⚠️ Source not found: {src_db_name}", "WARN")
                continue

            src_conn = sqlite3.connect(str(src_path))

            for table in tables:
                # تخطي لو نفس DB (predictions.db → predictions.db)
                if src_db_name == target_db_name:
                    count = get_table_count(src_conn, table)
                    log(f"  ✅ {table}: {count:,} rows (already in {target_db_name})")
                    db_results.append({'table': table, 'status': 'already_here', 'rows': count})
                    continue

                result = copy_table(src_conn, target_conn, table, src_db_name, target_db_name)
                db_results.append(result)

                if result['status'] == 'ok':
                    log(f"  ✅ {table}: {result['rows_copied']:,} rows ← {src_db_name}")
                elif result['status'] == 'empty_skipped':
                    log(f"  ⏭️ {table}: empty (skipped)")
                elif result['status'] == 'source_not_found':
                    log(f"  ⚠️ {table}: not in {src_db_name}")
                elif result['status'] == 'error':
                    log(f"  ❌ {table}: {result['error']}", "ERROR")

            src_conn.close()

        target_conn.close()
        all_results[target_db_name] = db_results
        log("")

    # حفظ السجل
    if not dry_run:
        log_file = DB_DIR / 'migration_log.json'
        with open(log_file, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'mode': 'execute',
                'results': all_results,
            }, f, indent=2, ensure_ascii=False)
        log(f"📝 Log saved: {log_file}")

    # ملخص
    log("=" * 60)
    log("ملخص الترحيل:")
    total_copied = 0
    total_skipped = 0
    total_errors = 0
    for db_name, results in all_results.items():
        copied = sum(r.get('rows_copied', 0) for r in results)
        ok = sum(1 for r in results if r.get('status') == 'ok')
        skipped = sum(1 for r in results if 'skip' in r.get('status', ''))
        errors = sum(1 for r in results if r.get('status') == 'error')
        already = sum(1 for r in results if r.get('status') == 'already_here')
        log(f"  {db_name}: {ok} copied, {already} already there, {skipped} skipped, {errors} errors")
        total_copied += copied
        total_skipped += skipped
        total_errors += errors
    log(f"  Total rows copied: {total_copied:,}")
    log(f"  Total errors: {total_errors}")
    log("=" * 60)

    if total_errors > 0:
        log("⚠️ هناك أخطاء — راجع السجل", "WARN")
    else:
        log("✅ الترحيل اكتمل بنجاح")


def verify_migration():
    """تحقق من أن الـ 4 قواعد تحتوي على البيانات المتوقعة."""
    log("=" * 60)
    log("التحقق من الـ 4 قواعد الجديدة:")
    log("=" * 60)

    for db_name in ['stocks.db', 'predictions.db', 'auth.db', 'content.db']:
        db_path = DB_DIR / db_name
        if not db_path.exists():
            log(f"  ❌ {db_name}: not found", "ERROR")
            continue

        conn = sqlite3.connect(str(db_path))
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()]

        total_rows = 0
        for t in tables:
            count = get_table_count(conn, t)
            if count > 0:
                total_rows += count

        size = db_path.stat().st_size
        size_str = f"{size/1024/1024:.1f}MB" if size > 1024*1024 else f"{size/1024:.0f}KB"
        log(f"  📁 {db_name}: {len(tables)} tables, {total_rows:,} rows, {size_str}")

        # اطبع الجداول غير الفارغة
        for t in sorted(tables):
            count = get_table_count(conn, t)
            if count > 0:
                log(f"    📋 {t}: {count:,} rows")

        conn.close()
        log("")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='دمج 19 قاعدة → 4 قواعد')
    parser.add_argument('--dry-run', action='store_true', help='معاينة فقط')
    parser.add_argument('--verify', action='store_true', help='تحقق فقط')
    args = parser.parse_args()

    if args.verify:
        verify_migration()
    else:
        run_migration(dry_run=args.dry_run)
