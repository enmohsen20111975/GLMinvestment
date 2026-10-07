#!/usr/bin/env python3
"""
scripts/migrate_production_auth_db.py
====================================================================
Production Database Migration & Sanitization Script for auth.db
====================================================================
This script performs a safe, idempotent database migration on db/auth.db:
1. Creates an automatic timestamped backup (db/auth.db.bak_<timestamp>).
2. Sanitizes all DateTime fields in `market_pricing` to strict ISO-8601
   (e.g., '2026-10-02T18:52:57.000Z') to prevent Prisma P2023 crashes.
3. Normalizes market codes to lowercase ('egx', 'tadawul', 'kse', 'qse', etc.).
4. Ensures all missing tiers exist in `SubscriptionPlan` to satisfy Foreign Key
   constraints with `UserSubscription.plan_id`.
5. Ensures standard market pricing entries exist for all tiers and billing cycles.
6. Runs SQLite PRAGMA integrity_check.
"""

import os
import sys
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

def get_iso_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def format_iso(dt_str):
    if not dt_str:
        return get_iso_now()
    dt_str = str(dt_str).strip()
    if 'T' in dt_str and dt_str.endswith('Z'):
        return dt_str
    # Replace space with T
    dt_str = dt_str.replace(' ', 'T')
    if '.' in dt_str:
        base, ms = dt_str.split('.', 1)
        ms = ms.replace('Z', '')[:3].ljust(3, '0')
        return f"{base}.{ms}Z"
    else:
        dt_str = dt_str.replace('Z', '')
        return f"{dt_str}.000Z"

def find_auth_db():
    candidates = [
        Path.cwd() / "db" / "auth.db",
        Path(__file__).resolve().parent.parent / "db" / "auth.db",
        Path("/root/GLMinvestment/db/auth.db"),
        Path("/opt/GLMinvestment/db/auth.db"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None

def main():
    print("=" * 65)
    print("🚀 GLM Investment - Production auth.db Migration & Fix")
    print("=" * 65)

    db_path = find_auth_db()
    if not db_path:
        print("❌ ERROR: Could not find db/auth.db!")
        print("Please run this script from the repository root directory.")
        sys.exit(1)

    print(f"📍 Target Database: {db_path}")

    # 1. Backup database
    backup_path = db_path.with_name(f"auth.db.bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    try:
        shutil.copy2(db_path, backup_path)
        print(f"📦 [Backup] Created database backup at: {backup_path}")
    except Exception as e:
        print(f"❌ Backup failed: {e}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    try:
        # Check integrity first
        cur.execute("PRAGMA integrity_check;")
        res = cur.fetchone()
        if res and res[0] != "ok":
            print(f"⚠️ Warning: PRAGMA integrity_check returned: {res[0]}")
        else:
            print("🛡️ [Integrity] Database integrity verified: OK")

        # 2. Check if market_pricing exists
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_pricing';")
        if not cur.fetchone():
            print("⚠️ Table market_pricing does not exist, creating it...")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS market_pricing (
                    id TEXT PRIMARY KEY,
                    tier TEXT NOT NULL,
                    market TEXT NOT NULL,
                    price_egp REAL,
                    price_local REAL NOT NULL,
                    currency TEXT NOT NULL,
                    billing_cycle TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS market_pricing_tier_market_billing_cycle_key ON market_pricing(tier, market, billing_cycle);")
            cur.execute("CREATE INDEX IF NOT EXISTS market_pricing_tier_market_idx ON market_pricing(tier, market);")
            conn.commit()

        # 3. Sanitize market_pricing dates and markets
        print("\n🔧 [Step 1] Sanitizing market_pricing dates and markets...")
        cur.execute("SELECT id, market, created_at, updated_at FROM market_pricing;")
        rows = cur.fetchall()
        updated_count = 0
        for row_id, market, c_at, u_at in rows:
            new_market = market.lower() if market else 'egx'
            new_c_at = format_iso(c_at)
            new_u_at = format_iso(u_at)
            if new_market != market or new_c_at != c_at or new_u_at != u_at:
                cur.execute(
                    "UPDATE market_pricing SET market = ?, created_at = ?, updated_at = ? WHERE id = ?;",
                    (new_market, new_c_at, new_u_at, row_id)
                )
                updated_count += 1

        conn.commit()
        print(f"   ✅ Processed {len(rows)} rows, updated {updated_count} rows with normalized dates/markets.")

        # 4. Ensure SubscriptionPlan tiers exist
        print("\n🔧 [Step 2] Ensuring all tiers exist in SubscriptionPlan...")
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='SubscriptionPlan';")
        if cur.fetchone():
            standard_plans = [
                ('free', 'مجاني', 'Free', 0, 0, 0, '["basic_chart", "delayed_news"]', 5, 3, 5, 0, 0, 0, 1, 1),
                ('normal', 'عادي', 'Normal', 99, 990, 0, '["live_chart", "market_pulse"]', 10, 5, 10, 1, 0, 0, 1, 2),
                ('premium', 'بريميوم', 'Premium', 299, 2990, 14, '["all_radars", "full_predictions", "unlimited_chat"]', 100, 50, 50, 1, 1, 1, 1, 3),
                ('pro', 'برو', 'Pro', 599, 5990, 0, '["everything_premium", "backtesting", "api_access"]', 500, 200, 200, 1, 1, 1, 1, 4),
                ('developer', 'مطور', 'Developer', 0, 0, 0, '["full_api_access", "webhooks", "dev_tools"]', 1000, 500, 500, 1, 1, 1, 1, 5),
                ('admin', 'مدير النظام', 'Admin', 0, 0, 0, '["all_system_privileges"]', 99999, 99999, 99999, 1, 1, 1, 1, 6),
                ('enterprise', 'مؤسسي', 'Enterprise', 1999, 19990, 0, '["custom_integrations", "dedicated_account"]', 9999, 9999, 9999, 1, 1, 1, 1, 7),
                ('b2b_starter', 'B2B Starter', 'B2B Starter', 99, 990, 0, '["b2b_portal", "5_seats"]', 500, 100, 100, 1, 1, 1, 1, 8),
                ('b2b_pro', 'B2B Pro', 'B2B Pro', 299, 2990, 0, '["b2b_portal", "20_seats", "api"]', 2000, 500, 500, 1, 1, 1, 1, 9),
                ('b2b_enterprise', 'B2B Enterprise', 'B2B Enterprise', 999, 9990, 0, '["b2b_portal", "unlimited_seats", "white_label"]', 99999, 99999, 99999, 1, 1, 1, 1, 10),
            ]

            now_iso = get_iso_now()
            cur.execute("SELECT id FROM SubscriptionPlan;")
            existing_plan_ids = {r[0] for r in cur.fetchall()}

            inserted_plans = 0
            for plan in standard_plans:
                p_id = plan[0]
                if p_id not in existing_plan_ids:
                    cur.execute("""
                        INSERT INTO SubscriptionPlan (
                            id, name_ar, name, price, price_yearly, trial_days, features,
                            max_watchlist, max_portfolio, max_alerts, ai_analysis,
                            deep_analysis, priority_support, is_active, sort_order,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """, (
                        plan[0], plan[1], plan[2], plan[3], plan[4], plan[5], plan[6],
                        plan[7], plan[8], plan[9], plan[10], plan[11], plan[12],
                        plan[13], plan[14], now_iso, now_iso
                    ))
                    inserted_plans += 1
            conn.commit()
            print(f"   ✅ SubscriptionPlan checked. Added {inserted_plans} missing plans.")

        # 5. Ensure core MarketPricing records exist
        print("\n🔧 [Step 3] Ensuring core MarketPricing records exist...")
        core_pricing = [
            # EGX
            ('premium', 'egx', 'EGP', 'monthly', 299.0, 299.0),
            ('premium', 'egx', 'EGP', 'yearly', 2990.0, 2990.0),
            ('pro', 'egx', 'EGP', 'monthly', 599.0, 599.0),
            ('pro', 'egx', 'EGP', 'yearly', 5990.0, 5990.0),
            # Tadawul
            ('premium', 'tadawul', 'SAR', 'monthly', 99.0, None),
            ('premium', 'tadawul', 'SAR', 'yearly', 990.0, None),
            ('pro', 'tadawul', 'SAR', 'monthly', 199.0, None),
            ('pro', 'tadawul', 'SAR', 'yearly', 1990.0, None),
            # KSE (Kuwait)
            ('premium', 'kse', 'KWD', 'monthly', 8.0, None),
            ('premium', 'kse', 'KWD', 'yearly', 80.0, None),
            ('pro', 'kse', 'KWD', 'monthly', 16.0, None),
            # QSE (Qatar)
            ('premium', 'qse', 'QAR', 'monthly', 99.0, None),
            ('premium', 'qse', 'QAR', 'yearly', 990.0, None),
            ('pro', 'qse', 'QAR', 'monthly', 199.0, None),
            # US
            ('premium', 'us', 'USD', 'monthly', 29.0, None),
            ('premium', 'us', 'USD', 'yearly', 290.0, None),
            # Crypto
            ('premium', 'crypto', 'USD', 'monthly', 29.0, None),
            ('premium', 'crypto', 'USD', 'yearly', 290.0, None),
            # Gold
            ('premium', 'gold', 'USD', 'monthly', 29.0, None),
            ('premium', 'gold', 'USD', 'yearly', 290.0, None),
            # B2B (Global/All)
            ('b2b_starter', 'all', 'USD', 'monthly', 99.0, None),
            ('b2b_pro', 'all', 'USD', 'monthly', 299.0, None),
            ('b2b_enterprise', 'all', 'USD', 'monthly', 999.0, None),
        ]

        now_iso = get_iso_now()
        cur.execute("SELECT tier, market, billing_cycle FROM market_pricing;")
        existing_keys = {(r[0], r[1], r[2]) for r in cur.fetchall()}

        inserted_pricing = 0
        for tier, market, currency, cycle, price_local, price_egp in core_pricing:
            if (tier, market, cycle) not in existing_keys:
                import uuid
                p_id = f"cuid_{uuid.uuid4().hex[:16]}"
                cur.execute("""
                    INSERT INTO market_pricing (
                        id, tier, market, currency, billing_cycle,
                        price_local, price_egp, is_active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?);
                """, (p_id, tier, market, currency, cycle, price_local, price_egp, now_iso, now_iso))
                inserted_pricing += 1

        conn.commit()
        print(f"   ✅ MarketPricing verified. Added {inserted_pricing} missing pricing entries.")

        # 6. Final verification
        print("\n🔍 [Verification] Checking table stats:")
        cur.execute("SELECT COUNT(*) FROM market_pricing;")
        mp_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM SubscriptionPlan;")
        sp_count = cur.fetchone()[0]
        print(f"   - market_pricing total active rows: {mp_count}")
        print(f"   - SubscriptionPlan total rows: {sp_count}")

        # Check date format compliance
        cur.execute("SELECT COUNT(*) FROM market_pricing WHERE created_at NOT LIKE '%T%Z' OR updated_at NOT LIKE '%T%Z';")
        bad_dates = cur.fetchone()[0]
        if bad_dates > 0:
            print(f"   ❌ FAILED: {bad_dates} rows still have invalid date format!")
            sys.exit(1)
        else:
            print("   ✅ All dates in market_pricing are 100% ISO-8601 compliant.")

        print("\n🎉 Migration completed successfully without errors!")

    except Exception as err:
        conn.rollback()
        print(f"\n❌ Migration failed with error: {err}")
        print(f"Restoring from backup {backup_path}...")
        shutil.copy2(backup_path, db_path)
        print("Restored backup successfully.")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == '__main__':
    main()
