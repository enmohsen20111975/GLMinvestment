#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
╔══════════════════════════════════════════════════════════════════╗
║  🔍 PRODUCTION DIAGNOSTIC — Real State Check                     ║
║  Answers: persona flags, win rate, missed opportunities          ║
║                                                                  ║
║  Usage:                                                          ║
║    python3 scripts/diagnose_production_state.py                  ║
╚══════════════════════════════════════════════════════════════════╝
"""
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

def connect(db_name):
    path = DB_DIR / db_name
    if not path.exists():
        return None
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA busy_timeout=30000')
        return conn
    except Exception as e:
        print(f'  ❌ Cannot open {db_name}: {e}')
        return None

def hr(n=72):
    print('═' * n)

def section(title):
    print()
    hr()
    print(f'  {title}')
    hr()

def q(conn, sql, params=(), label=""):
    try:
        return conn.execute(sql, params).fetchall()
    except Exception as e:
        if label:
            print(f'  ⚠️ [{label}]: {e}')
        return []

# ============================================================
# 1. DATABASE HEALTH
# ============================================================
def check_databases():
    section('1. DATABASE HEALTH')
    for db_name in ['stocks.db', 'predictions.db', 'price_history.db', 'data_engine.db']:
        conn = connect(db_name)
        if conn is None:
            print(f'  ❌ {db_name}: NOT FOUND')
            continue
        try:
            integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
            tables = conn.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            size_mb = (DB_DIR / db_name).stat().st_size / (1024*1024)
            print(f'  ✅ {db_name}: {size_mb:.1f}MB | {tables} tables | integrity: {integrity}')
        except Exception as e:
            print(f'  ❌ {db_name}: {e}')
        finally:
            conn.close()

# ============================================================
# 2. PERSONA FLAGS STATUS
# ============================================================
def check_persona_flags():
    section('2. PERSONA FLAGS STATUS (BONY/AREH + Overall)')
    conn = connect('predictions.db')
    if conn is None:
        return
    
    cols = [r[1] for r in conn.execute("PRAGMA table_info(stored_analyses)").fetchall()]
    persona_cols = [c for c in cols if 'gambler' in c.lower() or 'investor' in c.lower() or 'balanced' in c.lower()]
    
    if not persona_cols:
        print('  ❌ persona columns NOT in stored_analyses — migration not run!')
        conn.close()
        return
    
    print(f'  persona columns found: {persona_cols}')
    
    total = q(conn, "SELECT count(*) FROM stored_analyses", label="total")[0][0]
    g_count = q(conn, "SELECT count(*) FROM stored_analyses WHERE is_gambler_opportunity = 1", label="g_count")[0][0]
    i_count = q(conn, "SELECT count(*) FROM stored_analyses WHERE is_investor_opportunity = 1", label="i_count")[0][0]
    b_count = q(conn, "SELECT count(*) FROM stored_analyses WHERE is_balanced_opportunity = 1", label="b_count")[0][0] if 'is_balanced_opportunity' in persona_cols else 0
    
    print(f'\n  📊 stored_analyses overview:')
    print(f'     total rows:        {total}')
    print(f'     gambler=1:         {g_count}')
    print(f'     investor=1:        {i_count}')
    print(f'     balanced=1:        {b_count}')
    
    print(f'\n  🎯 KEY STOCKS check:')
    for ticker in ['BONY', 'AREH', 'COMI', 'ETEL', 'SWDY', 'HRHO', 'ABUK', 'FWRY']:
        rows = q(conn, """
            SELECT ticker, recommendation, maestro_score, risk_reward_ratio, confidence,
                   turnover_egp, is_gambler_opportunity, is_investor_opportunity,
                   is_balanced_opportunity, volume_ratio, updated_at
            FROM stored_analyses 
            WHERE ticker = ? 
            ORDER BY updated_at DESC LIMIT 1
        """, (ticker,), f"{ticker}")
        
        if rows:
            r = rows[0]
            g = '✅' if r['is_gambler_opportunity'] else '❌'
            i = '✅' if r['is_investor_opportunity'] else '❌'
            b = '✅' if (r['is_balanced_opportunity'] if 'is_balanced_opportunity' in r.keys() else 0) else '❌'
            turn = r['turnover_egp'] or 0
            vr = r['volume_ratio'] or 0
            print(f'     {ticker:6s} | rec={r["recommendation"]:12s} | score={r["maestro_score"]:5.1f} | '
                  f'RR={r["risk_reward_ratio"] or 0:.2f} | turn={turn:>12.0f} | '
                  f'g={g} i={i} b={b} | vr={vr:.2f}')
        else:
            print(f'     {ticker:6s} | NOT FOUND in stored_analyses')
    
    conn.close()

# ============================================================
# 3. CLOSED PREDICTIONS — WIN RATE
# ============================================================
def check_win_rate():
    section('3. CLOSED PREDICTIONS — WIN RATE ANALYSIS')
    conn = connect('predictions.db')
    if conn is None:
        return
    
    cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
    has_persona = 'persona' in cols
    
    total = q(conn, "SELECT count(*) FROM predictions", label="total_pred")[0][0]
    closed = q(conn, "SELECT count(*) FROM predictions WHERE outcome_date IS NOT NULL", label="closed")[0][0]
    pending = q(conn, "SELECT count(*) FROM predictions WHERE outcome_date IS NULL", label="pending")[0][0]
    
    print(f'  📊 predictions table:')
    print(f'     total:     {total}')
    print(f'     closed:    {closed}')
    print(f'     pending:   {pending}')
    print(f'     has persona column: {has_persona}')
    
    if closed == 0:
        print(f'\n  ⚠️ NO closed predictions yet — daily_closer may not be running')
        print(f'     Check: pm2 logs python-backend --lines 100 | grep -i closer')
        conn.close()
        return
    
    wins = q(conn, "SELECT count(*) FROM predictions WHERE hit_target = 1", label="wins")[0][0]
    losses = q(conn, "SELECT count(*) FROM predictions WHERE hit_stop = 1", label="losses")[0][0]
    expired = q(conn, "SELECT count(*) FROM predictions WHERE outcome_date IS NOT NULL AND hit_target = 0 AND hit_stop = 0", label="expired")[0][0]
    
    settled = wins + losses
    win_rate = (wins / settled * 100) if settled > 0 else 0
    
    print(f'\n  📊 closed predictions breakdown:')
    print(f'     wins (target hit):    {wins}')
    print(f'     losses (stop hit):    {losses}')
    print(f'     expired (no hit):     {expired}')
    print(f'     win rate (settled):   {win_rate:.1f}%')
    
    avg_return = q(conn, "SELECT avg(actual_return) FROM predictions WHERE outcome_date IS NOT NULL AND actual_return IS NOT NULL", label="avg_return")
    avg_win = q(conn, "SELECT avg(actual_return) FROM predictions WHERE hit_target = 1 AND actual_return IS NOT NULL", label="avg_win")
    avg_loss = q(conn, "SELECT avg(actual_return) FROM predictions WHERE hit_stop = 1 AND actual_return IS NOT NULL", label="avg_loss")
    
    if avg_return and avg_return[0][0] is not None: print(f'     avg return (all):     {avg_return[0][0]:.2f}%')
    if avg_win and avg_win[0][0] is not None: print(f'     avg return (wins):    {avg_win[0][0]:.2f}%')
    if avg_loss and avg_loss[0][0] is not None: print(f'     avg return (losses):  {avg_loss[0][0]:.2f}%')
    
    if has_persona:
        print(f'\n  📊 by persona:')
        for persona in ['gambler', 'balanced', 'conservative']:
            p_rows = q(conn, """
                SELECT 
                    count(*) as total,
                    sum(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as wins,
                    sum(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) as losses,
                    avg(actual_return) as avg_ret
                FROM predictions 
                WHERE persona = ? AND outcome_date IS NOT NULL
            """, (persona,), f"persona_{persona}")
            if p_rows and p_rows[0]['total'] > 0:
                r = p_rows[0]
                wr = (r['wins'] / (r['wins'] + r['losses']) * 100) if (r['wins'] + r['losses']) > 0 else 0
                print(f'     {persona:15s}: total={r["total"]:3d} | wins={r["wins"]:3d} | losses={r["losses"]:3d} | WR={wr:.1f}% | avg={r["avg_ret"] or 0:.2f}%')
    
    print(f'\n  🏆 TOP 10 WINNERS:')
    winners = q(conn, """
        SELECT ticker, signal, entry_price, target_price, stop_loss, 
               actual_return, holding_days, persona, prediction_date
        FROM predictions 
        WHERE hit_target = 1 AND actual_return IS NOT NULL
        ORDER BY actual_return DESC LIMIT 10
    """, label="winners")
    for r in winners:
        print(f'     {r["ticker"]:8s} | signal={r["signal"]:12s} | entry={r["entry_price"]:.2f} | '
              f'return={r["actual_return"]:+.2f}% | days={r["holding_days"]} | {r["persona"] or "N/A"}')
    
    print(f'\n  💀 TOP 10 LOSERS:')
    losers = q(conn, """
        SELECT ticker, signal, entry_price, target_price, stop_loss,
               actual_return, holding_days, persona, prediction_date
        FROM predictions 
        WHERE hit_stop = 1 AND actual_return IS NOT NULL
        ORDER BY actual_return ASC LIMIT 10
    """, label="losers")
    for r in losers:
        print(f'     {r["ticker"]:8s} | signal={r["signal"]:12s} | entry={r["entry_price"]:.2f} | '
              f'return={r["actual_return"]:+.2f}% | days={r["holding_days"]} | {r["persona"] or "N/A"}')
    
    conn.close()

# ============================================================
# 4. MISSED OPPORTUNITIES
# ============================================================
def check_missed_opportunities():
    section('4. MISSED OPPORTUNITIES (stocks that ran but we missed)')
    conn_pred = connect('predictions.db')
    conn_stocks = connect('stocks.db')
    conn_ph = connect('price_history.db')
    
    if conn_pred is None or conn_stocks is None:
        print('  ❌ Cannot check — predictions.db or stocks.db not available')
        return
    
    # Try egksco_stocks first (v3.67.0 — most reliable), fallback to stocks
    stocks = q(conn_stocks, """
        SELECT symbol as ticker, last_price as current_price, 
               change_percent, volume, name as name_ar
        FROM egksco_stocks 
        WHERE last_price > 0 AND change_percent IS NOT NULL
        ORDER BY abs(change_percent) DESC
        LIMIT 50
    """, label="egksco_top")
    
    if not stocks:
        stocks = q(conn_stocks, """
            SELECT ticker, current_price, change_percent, volume, name_ar
            FROM stocks 
            WHERE market = 'EGX' AND current_price > 0 AND is_active = 1
            ORDER BY abs(change_percent) DESC
            LIMIT 50
        """, label="stocks_top")
    
    if not stocks:
        print('  ❌ No stock data available')
        return
    
    print(f'\n  📊 TOP 30 EGX MOVERS (by |change%|):')
    print(f'     {"Ticker":8s} | {"Change%":>8s} | {"Price":>10s} | {"Had Pred?":>10s} | {"Signal":>12s} | {"Outcome":>10s}')
    print(f'     {"─"*8}─┼─{"─"*8}─┼─{"─"*10}─┼─{"─"*10}─┼─{"─"*12}─┼─{"─"*10}')
    
    missed = []
    correct = []
    false_pos = []
    
    for s in stocks[:30]:
        ticker = s['ticker']
        change = s['change_percent'] or 0
        price = s['current_price'] or 0
        
        preds = q(conn_pred, """
            SELECT signal, entry_price, target_price, stop_loss, 
                   actual_return, hit_target, hit_stop, persona, prediction_date
            FROM predictions 
            WHERE ticker = ? 
            ORDER BY prediction_date DESC LIMIT 3
        """, (ticker,), f"pred_{ticker}")
        
        if preds:
            p = preds[0]
            signal = p['signal'] or 'N/A'
            if p['hit_target']:
                outcome = '✅ WIN'
            elif p['hit_stop']:
                outcome = '❌ LOSS'
            else:
                outcome = '⏳ PENDING'
            
            is_buy = (p['signal'] or '').lower() in ('buy', 'strong_buy', 'accumulate', 't1_buy', 'swing_buy')
            is_sell = (p['signal'] or '').lower() in ('sell', 'strong_sell', 'reduce')
            
            if is_buy and change > 5:
                correct.append((ticker, change, signal, outcome))
            elif is_sell and change > 5:
                missed.append((ticker, change, signal, outcome, 'HAD SELL — STOCK WENT UP'))
            elif is_buy and change < -5:
                false_pos.append((ticker, change, signal, outcome))
        else:
            signal = '—'
            outcome = 'NO PRED'
            if abs(change) > 10:
                missed.append((ticker, change, signal, outcome, 'NO PREDICTION AT ALL'))
        
        print(f'     {ticker:8s} | {change:+8.2f} | {price:10.2f} | {"YES" if preds else "NO":>10s} | {signal:>12s} | {outcome:>10s}')
    
    print(f'\n  📊 SUMMARY:')
    print(f'     ✅ Correct (BUY → went up >5%):     {len(correct)}')
    print(f'     🔴 Missed (SELL/NO PRED → went up):  {len(missed)}')
    print(f'     ❌ False positive (BUY → went down): {len(false_pos)}')
    
    if missed:
        print(f'\n  🔴 MISSED OPPORTUNITIES:')
        for m in missed[:10]:
            ticker, change, signal, outcome, reason = m
            print(f'       {ticker:8s} | {change:+.2f}% | had: {signal} | {reason}')
    
    if conn_ph:
        print(f'\n  📊 HISTORICAL MISSED (last 30 days from price_history.db):')
        thirty_days_ago = (datetime.now() - timedelta(days=35)).strftime('%Y-%m-%d')
        
        movers = q(conn_ph, """
            SELECT ticker, 
                   min(close) as min_close,
                   max(close) as max_close,
                   (max(close) - min(close)) / min(close) * 100 as range_pct
            FROM price_history
            WHERE date >= ? AND source IN ('yahoo_clean', 'egksco')
              AND close > 0
            GROUP BY ticker
            HAVING range_pct > 20
            ORDER BY range_pct DESC
            LIMIT 20
        """, (thirty_days_ago,), "historical_movers")
        
        if movers:
            print(f'     {"Ticker":8s} | {"Min":>10s} | {"Max":>10s} | {"Range%":>8s} | {"Had BUY?":>10s}')
            print(f'     {"─"*8}─┼─{"─"*10}─┼─{"─"*10}─┼─{"─"*8}─┼─{"─"*10}')
            for m in movers:
                ticker = m['ticker']
                buy_pred = q(conn_pred, """
                    SELECT count(*) FROM predictions 
                    WHERE ticker = ? AND signal IN ('buy', 'strong_buy', 'accumulate')
                """, (ticker,), f"buy_check_{ticker}")
                had_buy = buy_pred[0][0] if buy_pred else 0
                status = '✅ YES' if had_buy > 0 else '🔴 MISSED'
                print(f'     {ticker:8s} | {m["min_close"]:10.2f} | {m["max_close"]:10.2f} | {m["range_pct"]:8.1f} | {status:>10s}')
        else:
            print(f'     ⚠️ No price_history data found for last 30 days')
    
    if conn_pred: conn_pred.close()
    if conn_stocks: conn_stocks.close()
    if conn_ph: conn_ph.close()

# ============================================================
# 5. LIVE TRACKING STATUS
# ============================================================
def check_live_tracking():
    section('5. LIVE TRACKING & SCHEDULER STATUS')
    conn = connect('predictions.db')
    if conn is None:
        return
    
    recent = q(conn, """
        SELECT count(*) as count, 
               max(updated_at) as last_update,
               min(updated_at) as first_update
        FROM stored_analyses 
        WHERE updated_at >= datetime('now', '-1 day')
    """, label="recent_analyses")
    if recent and recent[0]['count'] > 0:
        print(f'  📊 stored_analyses updated in last 24h: {recent[0]["count"]}')
        print(f'     last update:  {recent[0]["last_update"]}')
        print(f'     first update: {recent[0]["first_update"]}')
    else:
        print(f'  ⚠️ No stored_analyses updated in last 24 hours')
        print(f'     → background_analyzer may not be running')
    
    # Check learned_lessons (v3.68.0 Phase B)
    ll_count = q(conn, "SELECT count(*) FROM learned_lessons", label="lessons")
    if ll_count:
        print(f'\n  📊 learned_lessons (Phase B): {ll_count[0][0]} total')
        recent_ll = q(conn, """
            SELECT count(*) FROM learned_lessons 
            WHERE created_at >= datetime('now', '-7 days')
        """, label="recent_lessons")
        if recent_ll:
            print(f'     last 7 days: {recent_ll[0][0]}')
    
    conn.close()

# ============================================================
# 6. WHAT TO FIX NEXT
# ============================================================
def recommendations():
    section('6. RECOMMENDATION — WHAT TO FIX NEXT')
    print('''
  Based on the data above:

  1. If persona flags = 0 for BONY/AREH:
     → cd /root/GLMinvestment/vps-service
     → python3 scripts/verify_persona_write_path.py BONY AREH
     → pm2 restart python-backend
     → curl -X POST http://localhost:8010/api/admin/trigger-analysis \\
         -H "Content-Type: application/json" \\
         -d '{"tickers":["BONY","AREH"],"persona":"gambler","market":"EGX","limit":2}'
     → cd /root/GLMinvestment && python3 scripts/diagnose_production_state.py

  2. If closed predictions = 0:
     → daily_closer not running — check: pm2 logs python-backend | grep -i closer
     → The closing loop needs price_history data to verify outcomes

  3. If missed opportunities > 5:
     → BUY threshold (68) may be too strict for momentum stocks
     → Or liquidity filter (500k/3M) is dropping active stocks
     → Consider: momentum_uncap activation (vr≥2 AND chg_1w≥8%)

  4. If win_rate < 60%:
     → Tighten R/R requirement (min 2.0 instead of 1.5)
     → Or add regime filter (skip BUY in bear market)
''')

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    print('\n' + '═' * 72)
    print('  🔍 PRODUCTION DIAGNOSTIC — Real State Check')
    print(f'  Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'  DB Dir: {DB_DIR}')
    print('═' * 72)
    
    check_databases()
    check_persona_flags()
    check_win_rate()
    check_missed_opportunities()
    check_live_tracking()
    recommendations()
    
    print('\n' + '═' * 72)
    print('  ✅ DIAGNOSTIC COMPLETE')
    print('  Copy the full output above and send it back')
    print('═' * 72 + '\n')
