#!/usr/bin/env python3
"""
update_admin_portfolio.py — تحديث محفظة الأدمن ببيانات الأسهم والأصول الحقيقية
=================================================================================
يتبع منطق المحفظة الموجود في stocks.db:
- type: 'stock' (للأسهم), 'gold' (للذهب), 'bank' (للصناديق + الادخار)
- asset_class: 'stock', 'fund', 'gold', 'savings'
- portfolio_id: 'default' (المحفظة الأم)
- market: 'EGX', currency: 'EGP'

حسابات الأدمن المستهدفة:
- 48457b7f-40f2-4a7e-8955-d4d2cd1d79bd (enmohsen20111975@gmail.com - حساب المالك الأساسي)
- cmo8o12ix0000jqfcl9mbsi1s (Admin)
- mohseny-admin-cuid (mohseny)
- default (المحفظة الافتراضية)

Usage:
  python3 scripts/update_admin_portfolio.py           # dry-run (عرض بس)
  python3 scripts/update_admin_portfolio.py --apply    # تنفيذ فعلي
"""
import sqlite3
import argparse
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# حسابات الأدمن المستهدفة للتحديث
TARGET_ADMIN_IDS = [
    '48457b7f-40f2-4a7e-8955-d4d2cd1d79bd', # enmohsen20111975@gmail.com
    'cmo8o12ix0000jqfcl9mbsi1s',             # admin
    'mohseny-admin-cuid',                    # mohseny
    'default',                               # fallback
]

PORTFOLIO_ID = 'default'

# الأسهم من محفظة Thndr
# (ticker, current_value, return_egp, return_pct)
PORTFOLIO_STOCKS = [
    ('KORR', 3508, 3508, 0.00),       # KORA_r1
    ('UPAP', 1685, -19.15, -1.14),     # UPMS
    ('ALCN', 2871, -100, -3.38),
    ('UNIP', 1954, -99.63, -4.85),
    ('OSKT', 4660, -195, -4.02),       # BIOC
    ('RKAZ', 6764, -567, -7.73),
    ('EGX30ETF', 26623, -1866, -6.55),
    ('TAQA', 1837, -146, -7.38),
    ('CCAP', 6009, -554, -8.44),
    ('CRST', 1815, -193, -9.61),
    ('UEGC', 21952, -3092, -12.35),
    ('ENGC', 11755, -1844, -13.56),
    ('FNAR', 7947, -1334, -14.37),
    ('GTWL', 11953, -2013, -14.41),
    ('MAAL', 5159, -836, -13.94),
    ('SIPC', 19471, -3363, -14.73),
    ('CCRS', 16444, -3444, -17.32),
    ('GGCC', 20345, -4524, -18.19),
    ('HBCO', 13914, -3586, -20.49),
    ('NIPH', 108679, -30888, -22.13),
    ('AMER', 15029, -5441, -26.58),
    ('LUTS', 29539, -13543, -31.44),
    ('KORR', 10758, -5261, -32.84),    # KORA (تاني)
    ('EGRE', 32088, -16726, -34.26),   # EGREF
]

# الصناديق (type='bank', asset_class='fund')
PORTFOLIO_FUNDS = [
    # (name, current_value, return_egp, return_pct, annual_yield)
    ('NCS', 258979, -41009, -13.67, 0.0),
]

# الذهب (type='gold')
PORTFOLIO_GOLD = [
    # (name, current_value, return_egp, return_pct)
    ('Thndr Gold', 11322, -618, -5.18),
]

# الادخار (type='bank', asset_class='savings')
PORTFOLIO_SAVINGS = [
    # (name, current_value, return_egp, return_pct, interest_rate)
    ('daily', 29547, 54.29, 0.18, 17.35),
]


def update_portfolio(apply=False, user_ids=None):
    """تحديث محفظة الأدمن."""
    if not STOCKS_DB.exists():
        print(f"❌ stocks.db غير موجود: {STOCKS_DB}")
        return

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
    c = conn.cursor()

    target_users = user_ids or TARGET_ADMIN_IDS

    # 1. عرض الأصول الحالية
    print(f"📊 فحص حسابات الأدمن المستهدفة ({len(target_users)} حساب):")
    for uid in target_users:
        c.execute("SELECT COUNT(*), type FROM portfolio_assets WHERE user_id = ? GROUP BY type", (uid,))
        counts = c.fetchall()
        summary = ", ".join([f"{t}: {cnt}" for cnt, t in counts]) if counts else "فارغة (0 أصول)"
        print(f"  - [{uid}]: {summary}")

    if not apply:
        print("\n--- DRY RUN (استخدم --apply للتنفيذ الفعلي) ---")
        print(f"\n📊 الأسهم الجديدة المجهزة ({len(PORTFOLIO_STOCKS)} سهم):")
        for ticker, value, ret, pct in PORTFOLIO_STOCKS:
            print(f"  {ticker}: {value:,.0f} ج.م | عائد: {ret:,.2f} ({pct:.2f}%)")
        print(f"\n💰 الصناديق ({len(PORTFOLIO_FUNDS)}):")
        for name, value, ret, pct, yld in PORTFOLIO_FUNDS:
            print(f"  {name}: {value:,.0f} ج.م | عائد: {ret:,.2f} ({pct:.2f}%) | yield: {yld}%")
        print(f"\n🥇 الذهب ({len(PORTFOLIO_GOLD)}):")
        for name, value, ret, pct in PORTFOLIO_GOLD:
            print(f"  {name}: {value:,.0f} ج.م | عائد: {ret:,.2f} ({pct:.2f}%)")
        print(f"\n🏦 الادخار ({len(PORTFOLIO_SAVINGS)}):")
        for name, value, ret, pct, rate in PORTFOLIO_SAVINGS:
            print(f"  {name}: {value:,.0f} ج.م | عائد: {ret:,.2f} ({pct:.2f}%) | rate: {rate}%")
        conn.close()
        return

    now = datetime.now().isoformat()

    for uid in target_users:
        # 2. حذف الأصول القديمة
        c.execute("DELETE FROM portfolio_assets WHERE user_id = ?", (uid,))
        deleted = c.rowcount
        print(f"\n🗑️  [{uid}] تم حذف {deleted} أصل قديم")

        # 3. إضافة الأسهم الجديدة (type='stock')
        inserted_stocks = 0
        for ticker, current_value, return_egp, return_pct in PORTFOLIO_STOCKS:
            total_invested = current_value - return_egp
            if return_pct != 0:
                avg_buy_price = current_value / (1 + return_pct / 100)
            else:
                avg_buy_price = current_value
            quantity = current_value / avg_buy_price if avg_buy_price > 0 else 1

            c.execute("""
                INSERT INTO portfolio_assets (
                    user_id, type, name, stock_ticker, quantity, avg_buy_price,
                    current_value, total_invested, market, currency,
                    portfolio_id, asset_class, annual_yield,
                    added_at, updated_at
                ) VALUES (?, 'stock', ?, ?, ?, ?, ?, ?, 'EGX', 'EGP', ?, 'stock', 0.0, ?, ?)
            """, (uid, ticker, ticker, round(quantity, 4), round(avg_buy_price, 4),
                  current_value, round(total_invested, 2), PORTFOLIO_ID, now, now))
            inserted_stocks += 1

        # 4. إضافة الصناديق (type='bank', asset_class='fund')
        for name, value, ret, pct, yld in PORTFOLIO_FUNDS:
            c.execute("""
                INSERT INTO portfolio_assets (
                    user_id, type, name, bank_name, fund_name, current_value, total_invested,
                    market, currency, portfolio_id, asset_class, annual_yield,
                    added_at, updated_at
                ) VALUES (?, 'bank', ?, ?, ?, ?, ?, 'EGX', 'EGP', ?, 'fund', ?, ?, ?)
            """, (uid, name, name, name, value, value - ret, PORTFOLIO_ID, yld, now, now))

        # 5. إضافة الذهب (type='gold')
        for name, value, ret, pct in PORTFOLIO_GOLD:
            c.execute("""
                INSERT INTO portfolio_assets (
                    user_id, type, name, current_value, total_invested,
                    market, currency, portfolio_id, asset_class, annual_yield,
                    added_at, updated_at
                ) VALUES (?, 'gold', ?, ?, ?, 'EGX', 'EGP', ?, 'gold', 0.0, ?, ?)
            """, (uid, name, value, value - ret, PORTFOLIO_ID, now, now))

        # 6. إضافة الادخار (type='bank', asset_class='savings')
        for name, value, ret, pct, rate in PORTFOLIO_SAVINGS:
            c.execute("""
                INSERT INTO portfolio_assets (
                    user_id, type, name, bank_name, current_value, total_invested,
                    interest_rate, market, currency, portfolio_id, asset_class, annual_yield,
                    added_at, updated_at
                ) VALUES (?, 'bank', ?, ?, ?, ?, ?, 'EGX', 'EGP', ?, 'savings', ?, ?, ?)
            """, (uid, name, name, value, value - ret, rate, PORTFOLIO_ID, rate, now, now))

        print(f"✅ [{uid}] تم إضافة {inserted_stocks} سهم + {len(PORTFOLIO_FUNDS)} صندوق + {len(PORTFOLIO_GOLD)} ذهب + {len(PORTFOLIO_SAVINGS)} ادخار")

    conn.commit()
    conn.close()
    print(f"\n🎉 تم تحديث محفظة الأدمن بنجاح لكافة حسابات الأدمن!")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='تحديث محفظة الأدمن')
    parser.add_argument('--apply', action='store_true', help='تنفيذ فعلي (بدونها = dry-run)')
    parser.add_argument('--user-id', type=str, default=None, help='تحديد user_id معين بدلاً من كل حسابات الأدمن')
    args = parser.parse_args()

    user_ids = [args.user_id] if args.user_id else None
    update_portfolio(apply=args.apply, user_ids=user_ids)
