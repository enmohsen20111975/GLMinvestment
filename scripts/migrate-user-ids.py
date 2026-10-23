#!/usr/bin/env python3
"""
مهمة: ترحيل (Migrate) معرفات المستخدمين القديمة إلى الـ CUIDs الجديدة
=====================================================================

المشكلة:
- قديماً: portfolio_assets و user_stock_watchlists كانوا بيتخزنوا بـ Google Numeric ID
  (مثلاً: 105051756603508628603)
- حالياً: NextAuth بيستخدم Prisma CUID
  (مثلاً: 48457b7f-40f2-4a7e-8955-d4d2cd1d79bd)

الحل:
1. اقرأ كل الـ user_ids المختلفة في portfolio_assets و user_stock_watchlists
2. ميّز الـ numeric IDs (legacy) عن الـ CUIDs
3. حاول تطابق كل numeric ID مع مستخدم في User table (عن طريق email)
   - لو لقى match → حدّث
   - لو ملقاش → اطبع تحذير

الاستخدام:
  python3 scripts/migrate-user-ids.py [--dry-run]
  python3 scripts/migrate-user-ids.py --user EMAIL --old-id NUMERIC_ID [--new-id CUID]

أمثلة:
  # فحص وترحيل تلقائي
  python3 scripts/migrate-user-ids.py --dry-run
  python3 scripts/migrate-user-ids.py

  # ترحيل يدوي لمستخدم معيّن
  python3 scripts/migrate-user-ids.py --user enmohsen20111975@gmail.com --old-id 105051756603508628603 --new-id 48457b7f-40f2-4a7e-8955-d4d2cd1d79bd
"""

import sqlite3
import os
import sys
import re
from pathlib import Path
from datetime import datetime

# ============================================================================
# CONFIGURATION
# ============================================================================
PROJECT_ROOT = Path(__file__).parent.parent
AUTH_DB = str(PROJECT_ROOT / 'db' / 'auth.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

DRY_RUN = '--dry-run' in sys.argv
MANUAL_MODE = '--user' in sys.argv and '--old-id' in sys.argv


def log(msg, level='INFO'):
    """Print with timestamp"""
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] [{level}] {msg}")


def is_numeric_id(user_id):
    """تحقق إن كان الـ user_id رقمي (legacy Google ID)"""
    if not user_id:
        return False
    return bool(re.match(r'^\d{10,}$', str(user_id)))


def get_all_user_ids_in_stocks_db(stocks_db_path):
    """
    جلب كل الـ user_ids المختلفة من portfolio_assets و user_stock_watchlists.
    """
    if not os.path.exists(stocks_db_path):
        log(f"stocks.db not found at {stocks_db_path}", 'ERROR')
        return {'portfolio_assets': [], 'user_stock_watchlists': []}

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(stocks_db_path, writable=False).__enter__()
    c = conn.cursor()

    result = {'portfolio_assets': [], 'user_stock_watchlists': []}

    for table in ['portfolio_assets', 'user_stock_watchlists']:
        try:
            c.execute(f'SELECT DISTINCT user_id FROM {table} WHERE user_id IS NOT NULL')
            result[table] = [r[0] for r in c.fetchall()]
        except Exception as e:
            log(f"  {table}: {e}", 'WARN')

    conn.close()
    return result


def get_all_users_from_auth_db(auth_db_path):
    """
    جلب كل المستخدمين من User table في auth.db.
    Returns: list of {id, email, name}
    """
    if not os.path.exists(auth_db_path):
        log(f"auth.db not found at {auth_db_path}", 'ERROR')
        return []

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(auth_db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    users = []
    try:
        c.execute('SELECT id, email, name FROM User')
        for row in c.fetchall():
            users.append({
                'id': row['id'],
                'email': row['email'],
                'name': row['name'],
            })
    except Exception as e:
        log(f"Error reading User table: {e}", 'ERROR')
    finally:
        conn.close()

    return users


def get_account_mappings(auth_db_path):
    """
    جلب الـ mappings من Account table (providerAccountId → userId).
    """
    if not os.path.exists(auth_db_path):
        return {}

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(auth_db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    mapping = {}
    try:
        c.execute('''
            SELECT userId, provider, providerAccountId
            FROM Account
            WHERE provider = 'google' AND providerAccountId IS NOT NULL
        ''')
        for row in c.fetchall():
            user_id = row['userId']
            provider_id = row['providerAccountId']
            if user_id and provider_id and user_id != provider_id:
                mapping[provider_id] = user_id
    except Exception as e:
        log(f"Error reading Account table: {e}", 'WARN')
    finally:
        conn.close()

    return mapping


def migrate_table(stocks_db_path, table_name, old_id, new_id, dry_run=False):
    """تحديث user_id في جدول معيّن من old_id إلى new_id."""
    if not os.path.exists(stocks_db_path):
        return 0

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(stocks_db_path, writable=False).__enter__()
    c = conn.cursor()

    updated = 0
    try:
        c.execute(f'SELECT COUNT(*) FROM {table_name} WHERE user_id = ?', (old_id,))
        count_before = c.fetchone()[0]

        if count_before == 0:
            log(f"  {table_name}: no rows with user_id={old_id}")
            return 0

        log(f"  {table_name}: found {count_before} rows with old user_id={old_id}")

        if dry_run:
            log(f"  {table_name}: [DRY RUN] would update {count_before} rows → new_id={new_id}")
            return count_before

        c.execute(f'UPDATE {table_name} SET user_id = ? WHERE user_id = ?', (new_id, old_id))
        updated = c.rowcount
        conn.commit()
        log(f"  {table_name}: ✅ updated {updated} rows → new_id={new_id}")

    except Exception as e:
        log(f"  {table_name}: error - {e}", 'ERROR')
    finally:
        conn.close()

    return updated


def run_automatic_migration():
    """الترحيل التلقائي - يفحص كل الجداول ويطابق الـ IDs."""
    print("=" * 70)
    print("  User ID Migration Script - دليل الاستثمار")
    print("  Migrates Google Numeric IDs → Prisma CUIDs")
    print("=" * 70)
    print(f"  Mode: {'DRY RUN (no changes)' if DRY_RUN else 'LIVE (will update DB)'}")
    print(f"  auth.db: {AUTH_DB}")
    print(f"  stocks.db: {STOCKS_DB}")
    print("=" * 70)
    print()

    # 1. جلب كل المستخدمين من auth.db
    log("Step 1: Loading users from auth.db...")
    users = get_all_users_from_auth_db(AUTH_DB)
    log(f"  Found {len(users)} users in User table")
    for u in users:
        log(f"    - {u['email']}: id={u['id']}")

    # 2. جلب الـ Account mappings
    print()
    log("Step 2: Loading Account mappings (providerAccountId → userId)...")
    account_mapping = get_account_mappings(AUTH_DB)
    log(f"  Found {len(account_mapping)} Account mappings")

    # 3. جلب كل الـ user_ids من stocks.db
    print()
    log("Step 3: Scanning stocks.db for legacy user IDs...")
    db_ids = get_all_user_ids_in_stocks_db(STOCKS_DB)

    all_legacy_ids = set()
    for table, ids in db_ids.items():
        log(f"  {table}: {len(ids)} distinct user_ids")
        for uid in ids:
            if is_numeric_id(uid):
                all_legacy_ids.add(uid)
                log(f"    ✗ LEGACY numeric ID: {uid}")
            else:
                log(f"    ✓ CUID/UUID: {uid}")

    if not all_legacy_ids:
        print()
        log("✅ No legacy numeric IDs found. Nothing to migrate.")
        log("   (All portfolio/watchlist data already uses CUIDs)")
        return

    print()
    log(f"Step 4: Found {len(all_legacy_ids)} legacy numeric IDs to migrate")
    print()

    # 4. بناء mapping: numeric_id → CUID
    # الأول: من Account table
    final_mapping = {}
    for numeric_id in all_legacy_ids:
        if numeric_id in account_mapping:
            final_mapping[numeric_id] = account_mapping[numeric_id]
            log(f"  Mapped (via Account): {numeric_id} → {account_mapping[numeric_id]}")

    # لو فيه numeric IDs مش موجودة في Account، نطلب من المستخدم تحديدها يدوياً
    unmapped = all_legacy_ids - set(final_mapping.keys())
    if unmapped:
        print()
        log(f"⚠️  {len(unmapped)} numeric IDs not found in Account table:", 'WARN')
        for uid in unmapped:
            log(f"    {uid}")

        log("", '')
        log("These IDs need manual mapping. Use:", 'WARN')
        log("  python3 scripts/migrate-user-ids.py --user EMAIL --old-id NUMERIC_ID --new-id CUID")
        log("", '')
        log("Example:", 'WARN')
        log("  python3 scripts/migrate-user-ids.py \\")
        log("    --user enmohsen20111975@gmail.com \\")
        log("    --old-id 105051756603508628603 \\")
        log(f"    --new-id {users[0]['id'] if users else 'CUID_HERE'}")
        print()

    # 5. تنفيذ الترحيل
    if not final_mapping:
        log("No automatic mappings available. Please use manual mode.")
        return

    print()
    log("Step 5: Executing migration...")
    print()

    total_updated = 0
    for old_id, new_id in final_mapping.items():
        log(f"Migrating: {old_id} → {new_id}")
        n1 = migrate_table(STOCKS_DB, 'portfolio_assets', old_id, new_id, DRY_RUN)
        n2 = migrate_table(STOCKS_DB, 'user_stock_watchlists', old_id, new_id, DRY_RUN)
        total_updated += n1 + n2
        print()

    print("=" * 70)
    if DRY_RUN:
        log(f"[DRY RUN] Would have updated {total_updated} total rows")
        log("Run without --dry-run to apply changes:")
        log("  python3 scripts/migrate-user-ids.py")
    else:
        log(f"✅ Migration complete! Updated {total_updated} total rows")
    print("=" * 70)


def run_manual_migration():
    """الترحيل اليدوي لمستخدم معيّن."""
    # استخراج الـ arguments
    args = sys.argv[1:]
    email = None
    old_id = None
    new_id = None

    i = 0
    while i < len(args):
        if args[i] == '--user' and i + 1 < len(args):
            email = args[i + 1]
            i += 2
        elif args[i] == '--old-id' and i + 1 < len(args):
            old_id = args[i + 1]
            i += 2
        elif args[i] == '--new-id' and i + 1 < len(args):
            new_id = args[i + 1]
            i += 2
        else:
            i += 1

    if not email or not old_id:
        log("Missing --user or --old-id", 'ERROR')
        sys.exit(1)

    # لو مفيش --new-id، دور عليه في User table
    if not new_id:
        users = get_all_users_from_auth_db(AUTH_DB)
        for u in users:
            if u['email'].lower() == email.lower():
                new_id = u['id']
                break

        if not new_id:
            log(f"User with email {email} not found in auth.db", 'ERROR')
            sys.exit(1)

    print("=" * 70)
    print("  Manual User ID Migration")
    print("=" * 70)
    print(f"  Email: {email}")
    print(f"  Old ID (numeric): {old_id}")
    print(f"  New ID (CUID): {new_id}")
    print(f"  Mode: {'DRY RUN' if DRY_RUN else 'LIVE'}")
    print("=" * 70)
    print()

    total_updated = 0
    log(f"Migrating: {old_id} → {new_id}")
    n1 = migrate_table(STOCKS_DB, 'portfolio_assets', old_id, new_id, DRY_RUN)
    n2 = migrate_table(STOCKS_DB, 'user_stock_watchlists', old_id, new_id, DRY_RUN)
    total_updated += n1 + n2

    print()
    print("=" * 70)
    if DRY_RUN:
        log(f"[DRY RUN] Would have updated {total_updated} rows")
    else:
        log(f"✅ Migration complete! Updated {total_updated} rows")
    print("=" * 70)


def main():
    if MANUAL_MODE:
        run_manual_migration()
    else:
        run_automatic_migration()


if __name__ == '__main__':
    main()
