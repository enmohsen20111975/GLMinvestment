#!/usr/bin/env python3
import json
import sqlite3
import subprocess
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def check_pm2():
    print("=== 1. Active Backend & Service Processes ===")
    try:
        res = subprocess.check_output(['ps', '-eo', 'pid,%cpu,%mem,cmd', '--sort=-%mem']).decode()
        lines = res.strip().split('\n')
        for l in lines[1:]:
            if any(k in l for k in ('python-backend', 'data-engine', 'nextjs', 'next-server', 'server.py', 'telegram', 'ws-service', 'watchdog')):
                parts = l.split(None, 3)
                if len(parts) >= 4:
                    pid, cpu, mem, cmd = parts
                    cmd_short = cmd[:80]
                    print(f"  • PID {pid:7} | CPU: {cpu:4}% | MEM: {mem:4}% | {cmd_short}")
    except Exception as e:
        print(f"  Error reading processes: {e}")

def check_market_session():
    print("\n=== 2. EGX Market Session Check ===")
    now = datetime.now()
    # EGX hours: Sunday-Thursday 10:00 - 14:30
    is_weekday = now.weekday() in (6, 0, 1, 2, 3) # 6=Sunday in python datetime
    h_m = now.hour * 60 + now.minute
    is_time = (10 * 60) <= h_m <= (14 * 60 + 30)
    in_session = is_weekday and is_time
    print(f"  Current Time (Server): {now.strftime('%Y-%m-%d %H:%M:%S')} (Weekday: {now.strftime('%A')})")
    print(f"  EGX Session Active  : {'🟢 YES (IN SESSION)' if in_session else '🔴 NO (OUTSIDE SESSION)'}")

def check_db_freshness():
    print("\n=== 3. Database & Price Freshness ===")
    # stocks.db
    stocks_db = ROOT / 'db' / 'stocks.db'
    if stocks_db.exists():
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(stocks_db), writable=False).__enter__()
            c = conn.cursor()
            c.execute("SELECT MAX(price_date) FROM stock_daily_prices")
            max_daily = c.fetchone()[0]
            c.execute("SELECT count(*) FROM stock_daily_prices WHERE price_date=?", (max_daily,))
            cnt_daily = c.fetchone()[0]
            
            c.execute("SELECT MAX(updated_at), count(*) FROM stocks WHERE market='EGX'")
            max_stock_upd, total_egx = c.fetchone()
            
            print(f"  stocks.db (stock_daily_prices): Latest price_date = {max_daily} ({cnt_daily} rows)")
            print(f"  stocks.db (stocks table)      : Total EGX stocks = {total_egx}, Latest updated_at = {max_stock_upd}")
            conn.close()
        except Exception as e:
            print(f"  stocks.db error: {e}")

    # data_engine.db
    de_db = ROOT / 'db' / 'data_engine.db'
    if de_db.exists():
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(de_db), writable=False).__enter__()
            c = conn.cursor()
            c.execute("SELECT MAX(price_date) FROM egksco_price_history")
            max_egksco = c.fetchone()[0]
            print(f"  data_engine.db (egksco)       : Latest price_date = {max_egksco}")
            conn.close()
        except Exception as e:
            print(f"  data_engine.db error: {e}")

def check_active_predictions():
    print("\n=== 4. Live Predictions for Today ===")
    pred_db = ROOT / 'db' / 'predictions.db'
    if pred_db.exists():
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(pred_db), writable=False).__enter__()
            c = conn.cursor()
            c.execute("""
                SELECT id, ticker, prediction_date, entry_price, target_price, stop_loss, status, master_score
                FROM predictions
                WHERE outcome_date IS NULL AND UPPER(TRIM(COALESCE(status,''))) != 'CLOSED' AND exit_type IS NULL
                ORDER BY prediction_date DESC, master_score DESC
                LIMIT 10
            """)
            rows = c.fetchall()
            print(f"  Top Active/Pending Predictions ({len(rows)} shown):")
            for r in rows:
                print(f"    • {r[1]:6} | Date: {r[2]} | Entry: {r[3]:7.2f} | Target: {r[4]:7.2f} | Stop: {r[5]:7.2f} | Score: {r[7]} | Status: {r[6]}")
            conn.close()
        except Exception as e:
            print(f"  predictions.db error: {e}")

def check_endpoints():
    print("\n=== 5. Key API Endpoints Health ===")
    endpoints = [
        ("Next.js Home", "http://localhost:3000/"),
        ("Python Backend Health", "http://127.0.0.1:8010/health"),
        ("Live Tracking (EGX)", "http://localhost:3000/api/predictions/honest-tracking/live-tracking?market=EGX&days=30&limit=5"),
        ("Stored Analyses (EGX)", "http://localhost:3000/api/stored-analysis/results?market=EGX&limit=5&persona=balanced"),
        ("Unified Predictions", "http://localhost:3000/api/unified/predictions?market=EGX&limit=5"),
        ("WebSocket Service", "http://localhost:3005/health"),
    ]
    for name, url in endpoints:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Monitor/1.0'})
            with urllib.request.urlopen(req, timeout=5) as res:
                status = res.status
                body = res.read().decode('utf-8', errors='ignore')
                print(f"  ✓ {name:25}: HTTP {status} (Bytes: {len(body)})")
        except Exception as e:
            print(f"  ✗ {name:25}: Error: {e}")

def check_recommended_stocks():
    print("\n=== 6. Live Session Status for Active Recommended Stocks ===")
    stocks_db = ROOT / 'db' / 'stocks.db'
    pred_db = ROOT / 'db' / 'predictions.db'
    if stocks_db.exists() and pred_db.exists():
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            s_conn = db_manager.connection(str(stocks_db), writable=False).__enter__()
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            p_conn = db_manager.connection(str(pred_db), writable=False).__enter__()
            tickers = ['CCAP', 'CANA', 'BINV', 'ATQA', 'DTPP']
            q = f"SELECT ticker, name_ar, current_price, previous_close, high_price, low_price, change_percent, volume, updated_at FROM stocks WHERE ticker IN ({','.join('?' for _ in tickers)})"
            s_rows = {r[0]: r for r in s_conn.execute(q, tickers).fetchall()}
            
            p_q = "SELECT ticker, entry_price, target_price, stop_loss FROM predictions WHERE status='active' AND ticker IN (?,?,?,?,?) ORDER BY id DESC"
            p_rows = {}
            for pr in p_conn.execute(p_q, tickers).fetchall():
                if pr[0] not in p_rows:
                    p_rows[pr[0]] = pr
            
            for t in tickers:
                sr = s_rows.get(t)
                pr = p_rows.get(t)
                if sr:
                    curr = sr[2]
                    chg = sr[6] or 0.0
                    vol = sr[7] or 0
                    name = sr[1] or t
                    upd = sr[8]
                    if pr:
                        entry, target, stop = pr[1], pr[2], pr[3]
                        pnl = ((curr - entry) / entry) * 100 if entry else 0.0
                        hit_t = curr >= target
                        hit_s = curr <= stop
                        status_str = "🎯 TARGET HIT!" if hit_t else ("🛑 STOPPED OUT" if hit_s else "🟢 IN TRADE")
                        print(f"  • {t:5} ({name[:20]}): Curr={curr:7.2f} (Entry={entry:.2f}, Target={target:.2f}, Stop={stop:.2f}) | Live PnL={pnl:+.2f}% (Chg={chg:+.2f}%) | Vol={vol:,} | {status_str} | Upd={upd}")
                    else:
                        print(f"  • {t:5} ({name[:20]}): Curr={curr:7.2f} | Chg={chg:+.2f}% | Vol={vol:,} | Upd={upd}")
            s_conn.close()
            p_conn.close()
        except Exception as e:
            print(f"  Error checking recommended stocks: {e}")

if __name__ == '__main__':
    check_pm2()
    check_market_session()
    check_db_freshness()
    check_active_predictions()
    check_endpoints()
    check_recommended_stocks()
