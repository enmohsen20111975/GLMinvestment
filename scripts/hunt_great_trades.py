#!/usr/bin/env python3
import sqlite3
from pathlib import Path

DB_DIR = Path('db')
print("\n🦅 HUNTING GREAT TRADES — Top 15 Opportunities (Post-Restore)\n")
print(f"{'Ticker':8s} | {'Signal':12s} | {'Entry':>8s} | {'Target':>8s} | {'Stop':>8s} | {'R/R':>5s} | {'Score':>5s} | {'Turnover':>12s}")
print("-" * 90)

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection(DB_DIR / 'predictions.db', writable=False).__enter__()
conn.row_factory = sqlite3.Row

# check columns to use risk_reward column
cols = [r[1] for r in conn.execute("PRAGMA table_info(stored_analyses)").fetchall()]
rr_col = 'risk_reward' if 'risk_reward' in cols else 'risk_reward_ratio'

rows = conn.execute(f"""
    SELECT ticker, recommendation, entry_price, target_price, stop_loss, 
           {rr_col} as risk_reward, maestro_score, turnover_egp
    FROM stored_analyses 
    WHERE entry_price > 0 
      AND target_price > entry_price 
      AND stop_loss < entry_price
      AND {rr_col} >= 1.2
      AND maestro_score >= 50
    ORDER BY {rr_col} DESC, maestro_score DESC
    LIMIT 15
""").fetchall()

if not rows:
    print("❌ لا توجد فرص بعد في stored_analyses. التحليل في الخلفية لسه شغال.")
else:
    for r in rows:
        turnover = r['turnover_egp'] or 0
        rr = r['risk_reward'] or 0
        score = r['maestro_score'] or 0
        print(f"{r['ticker']:8s} | {r['recommendation']:12s} | {r['entry_price']:8.2f} | {r['target_price']:8.2f} | {r['stop_loss']:8.2f} | {rr:5.2f} | {score:5.1f} | {turnover:>12.0f}")

print("\n" + "=" * 50)
stats = conn.execute(f"""
    SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN recommendation IN ('buy', 'strong_buy', 'BUY', 'STRONG_BUY') THEN 1 ELSE 0 END) as buys,
        AVG({rr_col}) as avg_rr
    FROM stored_analyses 
    WHERE entry_price > 0
""").fetchone()

print(f"📊 إجمالي التحليلات النظيفة: {stats['total']}")
print(f"📊 إجمالي إشارات الشراء: {stats['buys']}")
print(f"📊 متوسط الـ R/R للسوق: {stats['avg_rr']:.2f}" if stats['avg_rr'] else "N/A")
conn.close()
