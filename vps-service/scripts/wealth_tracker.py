#!/usr/bin/env python3
"""
Wealth Tracker — متتبع الثروة اليومي
=====================================
يسجّل لقطة يومية لثروة العميل:
- إجمالي الاستثمار + القيمة الحالية
- توزيع الأصول (أسهم، ذهب، بنك، كاش)
- المصاريف والأرباح
- صافي الثروة

يُشغّل يومياً via MarketScheduler.
"""

import sqlite3
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


class WealthTracker:
    """متتبع الثروة اليومي."""

    def __init__(self):
        self.db_path = STOCKS_DB

    def record_daily_snapshot(self, user_id: str = None) -> dict:
        """تسجيل لقطة يومية لثروة العميل."""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row

        today = datetime.now().strftime('%Y-%m-%d')

        # إذا لم يُحدد user_id، خذ كل المستخدمين
        if user_id:
            users = [user_id]
        else:
            users = [r[0] for r in conn.execute(
                "SELECT DISTINCT user_id FROM portfolio_assets WHERE user_id != ''"
            ).fetchall()]

        results = []
        for uid in users:
            try:
                # حساب القيم
                assets = conn.execute(
                    "SELECT type, total_invested, current_value FROM portfolio_assets WHERE user_id = ?",
                    (uid,)
                ).fetchall()

                total_invested = sum(a['total_invested'] or 0 for a in assets)
                total_current = sum(a['current_value'] or 0 for a in assets)
                total_pnl = total_current - total_invested
                total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0

                # توزيع الأصول
                stocks_val = sum(a['total_invested'] or 0 for a in assets if a['type'] == 'stock')
                gold_val = sum(a['total_invested'] or 0 for a in assets if a['type'] == 'gold')
                bank_val = sum(a['total_invested'] or 0 for a in assets if a['type'] == 'bank')
                cash_val = sum(a['total_invested'] or 0 for a in assets if a['type'] == 'cash')
                crypto_val = sum(a['total_invested'] or 0 for a in assets if a['type'] == 'crypto')
                other_val = sum(a['total_invested'] or 0 for a in assets if a['type'] not in ('stock','gold','bank','cash','crypto'))

                # المصاريف والأرباح (من financial_transactions)
                month_start = today[:8] + '01'
                transactions = conn.execute(
                    "SELECT type, COALESCE(SUM(amount), 0) as total FROM financial_transactions WHERE user_id = ? AND date >= ? GROUP BY type",
                    (uid, month_start)
                ).fetchall()
                monthly_income = sum(t['total'] for t in transactions if t['type'] == 'income')
                monthly_expenses = sum(t['total'] for t in transactions if t['type'] == 'expense')
                net_cashflow = monthly_income - monthly_expenses

                # الالتزامات
                obligations = conn.execute(
                    "SELECT COALESCE(SUM(remaining_amount), 0) as total FROM financial_obligations WHERE user_id = ? AND status = 'active'",
                    (uid,)
                ).fetchone()
                total_obligations = obligations['total'] if obligations else 0
                net_wealth = total_current - total_obligations

                # تسجيل اللقطة
                conn.execute("""
                    INSERT OR REPLACE INTO wealth_tracking 
                    (user_id, date, total_invested, total_current_value, total_pnl, total_pnl_pct,
                     stocks_value, gold_value, bank_value, cash_value, crypto_value, other_value,
                     monthly_income, monthly_expenses, net_cashflow, total_obligations, net_wealth)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    uid, today, total_invested, total_current, total_pnl, round(total_pnl_pct, 2),
                    stocks_val, gold_val, bank_val, cash_val, crypto_val, other_val,
                    monthly_income, monthly_expenses, net_cashflow, total_obligations, net_wealth
                ))

                results.append({
                    'user_id': uid,
                    'date': today,
                    'invested': total_invested,
                    'current': total_current,
                    'pnl': total_pnl,
                    'net_wealth': net_wealth,
                })

                logger.info(f"[WealthTracker] {uid}: invested={total_invested:,.0f}, current={total_current:,.0f}, pnl={total_pnl:,.0f}")

            except Exception as e:
                logger.error(f"[WealthTracker] Error for {uid}: {e}")

        conn.commit()
        conn.close()
        return {'recorded': len(results), 'results': results}

    def get_wealth_history(self, user_id: str, days: int = 90) -> list:
        """جلب تاريخ الثروة للرسوم البيانية."""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row

        rows = conn.execute("""
            SELECT * FROM wealth_tracking 
            WHERE user_id = ? 
            ORDER BY date DESC LIMIT ?
        """, (user_id, days)).fetchall()

        history = [dict(r) for r in rows]
        conn.close()
        return history

    def get_wealth_summary(self, user_id: str) -> dict:
        """ملخص الثروة مع التغيرات."""
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row

        # أحدث لقطة
        latest = conn.execute(
            "SELECT * FROM wealth_tracking WHERE user_id = ? ORDER BY date DESC LIMIT 1",
            (user_id,)
        ).fetchone()

        if not latest:
            conn.close()
            return {}

        # اللقطة السابقة (أمس أو قبل كده)
        prev = conn.execute(
            "SELECT * FROM wealth_tracking WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1",
            (user_id, latest['date'])
        ).fetchone()

        # أول لقطة (بداية التتبع)
        first = conn.execute(
            "SELECT * FROM wealth_tracking WHERE user_id = ? ORDER BY date ASC LIMIT 1",
            (user_id,)
        ).fetchone()

        # حساب التغيرات
        daily_change = 0
        daily_change_pct = 0
        if prev:
            daily_change = latest['net_wealth'] - prev['net_wealth']
            if prev['net_wealth'] > 0:
                daily_change_pct = daily_change / prev['net_wealth'] * 100

        total_change = 0
        total_change_pct = 0
        if first:
            total_change = latest['net_wealth'] - first['net_wealth']
            if first['net_wealth'] > 0:
                total_change_pct = total_change / first['net_wealth'] * 100

        # أفضل وأسوأ يوم
        best_day = conn.execute("""
            SELECT date, net_wealth, total_pnl FROM wealth_tracking 
            WHERE user_id = ? ORDER BY total_pnl DESC LIMIT 1
        """, (user_id,)).fetchone()

        worst_day = conn.execute("""
            SELECT date, net_wealth, total_pnl FROM wealth_tracking 
            WHERE user_id = ? ORDER BY total_pnl ASC LIMIT 1
        """, (user_id,)).fetchone()

        conn.close()

        return {
            'latest': dict(latest) if latest else {},
            'daily_change': round(daily_change, 2),
            'daily_change_pct': round(daily_change_pct, 2),
            'total_change': round(total_change, 2),
            'total_change_pct': round(total_change_pct, 2),
            'tracking_since': first['date'] if first else None,
            'best_day': dict(best_day) if best_day else None,
            'worst_day': dict(worst_day) if worst_day else None,
        }


if __name__ == '__main__':
    tracker = WealthTracker()
    
    print("=" * 60)
    print("📊 Wealth Tracker Test")
    print("=" * 60)
    
    # Record snapshot
    result = tracker.record_daily_snapshot()
    print(f"\n✅ Recorded: {result['recorded']} snapshots")
    for r in result['results']:
        print(f"  {r['user_id'][:8]}...: invested={r['invested']:,.0f}, current={r['current']:,.0f}, pnl={r['pnl']:,.0f}")
    
    # Get history
    if result['results']:
        uid = result['results'][0]['user_id']
        history = tracker.get_wealth_history(uid, 30)
        print(f"\n📈 History: {len(history)} records")
        
        summary = tracker.get_wealth_summary(uid)
        print(f"\n📋 Summary:")
        if summary.get('latest'):
            print(f"  Latest: {summary['latest'].get('date')}")
            print(f"  Net wealth: {summary['latest'].get('net_wealth', 0):,.0f}")
            print(f"  Daily change: {summary.get('daily_change', 0):,.0f} ({summary.get('daily_change_pct', 0)}%)")
