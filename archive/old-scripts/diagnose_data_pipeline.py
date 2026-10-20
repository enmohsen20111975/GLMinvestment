#!/usr/bin/env python3
"""
diagnose_data_pipeline.py — Full Pipeline Diagnostic (RL-FIX-3)
================================================================

الوظيفة:
  يفحص الـ data pipeline بالكامل من أول TradingView scrape لحد price_history.db،
  ويحدّد بالظبط فين الـ breakpoint.

الـ Pipeline المتوقع:
  Layer 1 (data-engine, port 5000 — كل 5 دقايق):
    TradingView REST → data_engine.db.stocks
                     → sync.py → stocks.db.stocks + stock_daily_prices
                     → intraday_storage → intraday.db.stock_intraday

  Layer 2 (python-backend, port 8010 — كل 30 دقيقة):
    intraday_aggregator → intraday.db.stock_intraday → price_history.db
    price_history_safetynet → Yahoo → price_history.db (gap fill)

الاستخدام:
    cd /home/z/my-project
    python3 vps-service/scripts/diagnose_data_pipeline.py

Author: RL-FIX-3 — Data Pipeline Full Diagnostic
"""
import os
import sys
import sqlite3
import subprocess
import urllib.request
import json
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# ANSI colors for readability
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
CYAN = '\033[96m'
BOLD = '\033[1m'
RESET = '\033[0m'


def banner(title):
    print(f"\n{BOLD}{CYAN}{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}{RESET}")


def ok(msg):
    print(f"  {GREEN}✅{RESET} {msg}")


def fail(msg):
    print(f"  {RED}❌{RESET} {msg}")


def warn(msg):
    print(f"  {YELLOW}⚠️{RESET} {msg}")


def info(msg):
    print(f"  {BLUE}ℹ️{RESET} {msg}" if False else f"  ℹ️  {msg}")


def safe_query(db_path, query, args=()):
    """Execute a query safely, return (rows, error)."""
    if not os.path.exists(db_path):
        return None, f'DB not found: {db_path}'
    try:
        conn = sqlite3.connect(str(db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(query, args)
        rows = cur.fetchall()
        conn.close()
        return rows, None
    except Exception as e:
        return None, str(e)


def check_http(url, timeout=3):
    """Check if an HTTP endpoint responds."""
    try:
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200, resp.status
    except Exception as e:
        return False, str(e)[:80]


def check_pm2_status():
    """Check PM2 process status."""
    banner('0. PM2 Process Status')
    try:
        result = subprocess.run(
            ['pm2', 'jlist'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            fail(f'pm2 jlist failed: {result.stderr[:100]}')
            return {}
        procs = json.loads(result.stdout)
        status = {}
        for p in procs:
            name = p.get('name', '?')
            state = p.get('pm2_env', {}).get('status', '?')
            restarts = p.get('pm2_env', {}).get('restart_time', 0)
            uptime = p.get('pm2_env', {}).get('pm_uptime', 0)
            status[name] = {'state': state, 'restarts': restarts, 'uptime': uptime}
            icon = '✅' if state == 'online' else '❌'
            uptime_str = ''
            if uptime:
                try:
                    uptime_str = f' (up {datetime.now().timestamp() - uptime:.0f}s)'
                except Exception:
                    pass
            print(f"  {icon} {name}: {state}{uptime_str} [restarts={restarts}]")
        return status
    except FileNotFoundError:
        fail('pm2 not found — are you on the production server?')
        return {}
    except Exception as e:
        fail(f'pm2 check error: {e}')
        return {}


def check_services():
    """Check HTTP health of data-engine and python-backend."""
    banner('1. Service Health Checks')

    # data-engine (port 5000)
    ok_5000, detail_5000 = check_http('http://localhost:5000/health')
    if ok_5000:
        ok(f'data-engine (port 5000): HEALTHY')
    else:
        fail(f'data-engine (port 5000): DOWN — {detail_5000}')
        warn('  → لو data-engine مش شغال، مفيش scraping هيحصل إطلاقاً!')
        warn('  → Fix: pm2 restart data-engine')

    # python-backend (port 8010)
    ok_8010, detail_8010 = check_http('http://localhost:8010/health')
    if ok_8010:
        ok(f'python-backend (port 8010): HEALTHY')
    else:
        fail(f'python-backend (port 8010): DOWN — {detail_8010}')
        warn('  → لو python-backend مش شغال، الـ intraday_aggregator مش هيشتغل!')


def check_data_engine_db():
    """Check data_engine.db — the first stop after TradingView scrape."""
    banner('2. data_engine.db (Layer 1: TradingView → here)')

    db = DB_DIR / 'data_engine.db'
    if not os.path.exists(db):
        fail(f'data_engine.db not found at {db}')
        return

    # Check if 'stocks' table exists (TV REST writes here)
    tables, err = safe_query(db, "SELECT name FROM sqlite_master WHERE type='table'")
    if err:
        fail(f'Cannot read tables: {err}')
        return

    table_names = [t['name'] for t in tables] if tables else []
    print(f"  Tables: {table_names}")

    if 'stocks' not in table_names:
        fail("'stocks' table NOT found in data_engine.db")
        warn('  → tradingview_rest.py save_to_db creates this table with CREATE TABLE IF NOT EXISTS')
        warn('  → لو مش موجود → data-engine ما shuffleش الـ fallback chain بنجاح ولا مرة')
        return

    # Row count + latest update
    rows, err = safe_query(db, "SELECT COUNT(*) as cnt, MAX(last_update) as last_up FROM stocks")
    if err or not rows:
        fail(f'Cannot query stocks: {err}')
        return

    cnt = rows[0]['cnt']
    last_up = rows[0]['last_up']
    print(f"  stocks table: {cnt} rows, last_update={last_up}")

    if cnt == 0:
        fail('stocks table is EMPTY — TradingView scraper never succeeded!')
        warn('  → شغّل manual test: cd data_engine/scrapers && python3 fallback_chain.py')
        return

    if last_up:
        try:
            last_dt = datetime.strptime(str(last_up)[:19], '%Y-%m-%d %H:%M:%S')
            age_min = (datetime.now() - last_dt).total_seconds() / 60
            if age_min > 15:
                fail(f'data_engine.db.stocks is STALE — last update {age_min:.0f} min ago')
                warn('  → data-engine scheduler مش بـ scrape بنجاح (fallback chain فاشل؟)')
            else:
                ok(f'data_engine.db.stocks is FRESH — last update {age_min:.0f} min ago')
        except Exception as e:
            warn(f'Cannot parse last_update "{last_up}": {e}')
    else:
        fail('last_update is NULL — no successful scrape recorded')


def check_stocks_db():
    """Check stocks.db — sync.py writes current prices + daily candles here."""
    banner('3. stocks.db (Layer 1: sync.py → here)')

    db = DB_DIR / 'stocks.db'
    if not os.path.exists(db):
        fail(f'stocks.db not found at {db}')
        return

    # stocks table
    rows, err = safe_query(db, "SELECT COUNT(*) as cnt, MAX(last_update) as last_up FROM stocks")
    if err:
        fail(f'Cannot query stocks: {err}')
    elif rows:
        cnt = rows[0]['cnt']
        last_up = rows[0]['last_up']
        print(f"  stocks table: {cnt} rows, last_update={last_up}")
        if cnt == 0:
            fail('stocks.db.stocks is EMPTY — sync.py not running or failing')
        elif last_up:
            try:
                last_dt = datetime.strptime(str(last_up)[:19], '%Y-%m-%dT%H:%M:%S')
                age_h = (datetime.now() - last_dt).total_seconds() / 3600
                if age_h > 2:
                    fail(f'stocks.db.stocks STALE — last update {age_h:.1f}h ago')
                else:
                    ok(f'stocks.db.stocks FRESH — last update {age_h:.1f}h ago')
            except Exception:
                warn(f'Cannot parse last_update: {last_up}')
        else:
            warn('last_update is NULL')

    # stock_daily_prices (Live Developing Candle)
    rows, err = safe_query(db, "SELECT COUNT(*) as cnt, MAX(price_date) as max_date FROM stock_daily_prices")
    if err:
        warn(f'stock_daily_prices query error: {err}')
    elif rows:
        cnt = rows[0]['cnt']
        max_date = rows[0]['max_date']
        print(f"  stock_daily_prices: {cnt} rows, MAX(price_date)={max_date}")
        if cnt == 0:
            warn('stock_daily_prices is EMPTY — sync.py candle UPSERT not running')
        elif max_date:
            today = datetime.now().strftime('%Y-%m-%d')
            if str(max_date)[:10] >= today:
                ok(f'stock_daily_prices has TODAY data ({max_date})')
            else:
                warn(f'stock_daily_prices MAX date = {max_date} (not today)')


def check_intraday_db():
    """Check intraday.db — intraday_storage writes 5-min snapshots here."""
    banner('4. intraday.db (Layer 1: intraday_storage → here)')

    db = DB_DIR / 'intraday.db'
    if not os.path.exists(db):
        fail(f'intraday.db not found at {db}')
        return

    tables, err = safe_query(db, "SELECT name FROM sqlite_master WHERE type='table'")
    if err:
        fail(f'Cannot read tables: {err}')
        return

    table_names = [t['name'] for t in tables] if tables else []
    print(f"  Tables: {table_names}")

    if 'stock_intraday' not in table_names:
        fail("'stock_intraday' table NOT found!")
        warn('  → intraday_storage.init_intraday_db() creates it with IF NOT EXISTS')
        warn('  → لو مش موجود → data-engine ما storeش ولا snapshot (store_stocks_snapshot فاشل)')
        return

    # Row count + latest timestamp + distinct tickers
    rows, err = safe_query(db, """
        SELECT COUNT(*) as cnt,
               COUNT(DISTINCT ticker) as tickers,
               MIN(timestamp) as min_ts,
               MAX(timestamp) as max_ts
        FROM stock_intraday
    """)
    if err or not rows:
        fail(f'Cannot query stock_intraday: {err}')
        return

    cnt = rows[0]['cnt']
    tickers = rows[0]['tickers']
    min_ts = rows[0]['min_ts']
    max_ts = rows[0]['max_ts']
    print(f"  stock_intraday: {cnt} rows, {tickers} distinct tickers")
    print(f"  timestamp range: {min_ts} → {max_ts}")

    if cnt == 0:
        fail('stock_intraday is EMPTY — intraday_storage.store_stocks_snapshot not running!')
        warn('  → ده معناه إن data-engine شغّال بس الـ snapshot بعد كل scrape فاشل')
        return

    if max_ts:
        try:
            # Try different timestamp formats
            ts_str = str(max_ts)
            for fmt in ['%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S']:
                try:
                    max_dt = datetime.strptime(ts_str[:26], fmt)
                    break
                except ValueError:
                    continue
            else:
                max_dt = None

            if max_dt:
                age_h = (datetime.now() - max_dt).total_seconds() / 3600
                if age_h > 4:
                    fail(f'intraday.db.stock_intraday STALE — last snapshot {age_h:.1f}h ago')
                    warn('  → data-engine مش بـ scrape خلال ساعات السوق')
                elif age_h > 1 and _is_market_hours():
                    warn(f'intraday.db.stock_intraday {age_h:.1f}h old (market is open now)')
                else:
                    ok(f'intraday.db.stock_intraday FRESH — last snapshot {age_h:.1f}h ago')
        except Exception as e:
            warn(f'Cannot parse max_ts "{max_ts}": {e}')


def check_price_history_db():
    """Check price_history.db — THE WORKING DATABASE for analysis."""
    banner('5. price_history.db (Layer 2: THE WORKING DB)')

    db = DB_DIR / 'price_history.db'
    if not os.path.exists(db):
        fail(f'price_history.db not found at {db}')
        return

    tables, err = safe_query(db, "SELECT name FROM sqlite_master WHERE type='table'")
    if err:
        fail(f'Cannot read tables: {err}')
        return

    table_names = [t['name'] for t in tables] if tables else []
    if not table_names:
        fail('price_history.db has NO tables — completely empty!')
        warn('  → intraday_aggregator / safetynet ما اشتغلوش ولا مرة على السيرفر ده')
        return

    print(f"  Tables: {table_names}")

    if 'price_history' not in table_names:
        fail("'price_history' table NOT found!")
        return

    # Total rows + MAX date
    rows, err = safe_query(db, "SELECT COUNT(*) as cnt, MAX(date) as max_date FROM price_history")
    if err or not rows:
        fail(f'Cannot query price_history: {err}')
        return

    cnt = rows[0]['cnt']
    max_date = rows[0]['max_date']
    print(f"  price_history: {cnt} rows, MAX(date)={max_date}")

    # Sources breakdown
    rows, err = safe_query(db, """
        SELECT source, COUNT(*) as cnt, MAX(date) as max_date
        FROM price_history GROUP BY source ORDER BY cnt DESC
    """)
    if rows:
        print(f"  Sources breakdown:")
        for r in rows:
            print(f"    {r['source']}: {r['cnt']} rows, MAX(date)={r['max_date']}")

    if max_date:
        try:
            max_dt = datetime.strptime(str(max_date)[:10], '%Y-%m-%d')
            today = datetime.now()
            age_days = (today - max_dt).days
            if age_days > 2:
                fail(f'price_history STALE by {age_days} days (MAX={max_date})')
                warn('  → intraday_aggregator مش بـ transfer لـ price_history!')
                warn('  → تأكد إن RL-FIX-2 منزل على السيرفر: git pull && pm2 restart python-backend')
            else:
                ok(f'price_history FRESH — MAX(date)={max_date} ({age_days}d ago)')
        except Exception as e:
            warn(f'Cannot parse max_date: {e}')
    else:
        fail('price_history has NO rows with dates!')


def check_rl_fix_2_deployed():
    """Check if RL-FIX-2 code (intraday_aggregator) is present in market_scheduler."""
    banner('6. RL-FIX-2 Deployment Check')

    scheduler = PROJECT_ROOT / 'vps-service' / 'jobs' / 'market_scheduler.py'
    aggregator = PROJECT_ROOT / 'vps-service' / 'jobs' / 'intraday_aggregator.py'

    if not scheduler.exists():
        fail(f'market_scheduler.py not found: {scheduler}')
        return

    if not aggregator.exists():
        fail(f'intraday_aggregator.py NOT FOUND — RL-FIX-2 not deployed!')
        warn('  → Fix: git pull on production server')
        return

    src = scheduler.read_text()

    checks = [
        ('run_intraday_aggregator method', 'def run_intraday_aggregator' in src),
        ('aggregator called in tick()', 'self.run_intraday_aggregator()' in src),
        ('safetynet force-run on stale', 'force_run' in src and 'stale_days' in src),
        ('safetynet 60min interval', "60" in src and 'price_history_safetynet' in src),
    ]

    all_ok = True
    for label, passed in checks:
        if passed:
            ok(f'{label}')
        else:
            fail(f'{label} — MISSING')
            all_ok = False

    if all_ok:
        ok('RL-FIX-2 code is present in source')
    else:
        fail('RL-FIX-2 NOT fully deployed — run: git pull && pm2 restart python-backend')


def check_pm2_logs():
    """Check recent pm2 logs for data-engine and python-backend."""
    banner('7. Recent PM2 Logs (last 30 lines each)')

    for proc in ['data-engine', 'python-backend']:
        print(f"\n  --- {proc} (last 30 lines) ---")
        try:
            result = subprocess.run(
                ['pm2', 'logs', proc, '--lines', '30', '--nostream'],
                capture_output=True, text=True, timeout=10
            )
            output = result.stdout.strip()
            if output:
                for line in output.split('\n')[-30:]:
                    print(f"    {line}")
            else:
                warn(f'No logs for {proc}')
        except Exception as e:
            warn(f'Cannot read {proc} logs: {e}')


def _is_market_hours():
    """Check if EGX is currently open (Cairo time, Sun-Thu 10:00-14:30)."""
    try:
        import pytz
        cairo = pytz.timezone('Africa/Cairo')
        now = datetime.now(cairo)
        if now.weekday() not in [6, 0, 1, 2, 3]:  # Sun=6, Mon=0, ... Thu=3
            return False
        minutes = now.hour * 60 + now.minute
        return 600 <= minutes <= 870  # 10:00 - 14:30
    except Exception:
        return False


def print_pipeline_diagram():
    """Print the expected pipeline for reference."""
    banner('EXPECTED DATA PIPELINE')
    print("""
  Layer 1: data-engine (port 5000, PM2: data-engine)
  ─────────────────────────────────────────────────────
  كل 5 دقايق (ساعات السوق):
    TradingView REST ──→ data_engine.db.stocks
                           │
                           ├─→ sync.py ──→ stocks.db.stocks (current price)
                           │            └→ stocks.db.stock_daily_prices (live candle)
                           │
                           └─→ intraday_storage ──→ intraday.db.stock_intraday (5-min tick)

  Layer 2: python-backend (port 8010, PM2: python-backend)
  ─────────────────────────────────────────────────────
  كل 30 دقيقة:
    intraday.db.stock_intraday ──→ intraday_aggregator ──→ price_history.db
                                                            (source='intraday_aggregated')

  كل 60 دقيقة:
    Yahoo Finance ──→ price_history_safetynet ──→ price_history.db
                                                   (source='yahoo_safetynet')

  ⚠️ الـ WORKING DATABASE = price_history.db
     لو متجمد → التوقعات والتحليل بتبقى على داتا قديمة!
""")


def main():
    print(f"\n{BOLD}🔍 Data Pipeline Full Diagnostic{RESET}")
    print(f"   Time: {datetime.now().isoformat()}")
    print(f"   Project: {PROJECT_ROOT}")

    print_pipeline_diagram()

    pm2_status = check_pm2_status()
    check_services()
    check_data_engine_db()
    check_stocks_db()
    check_intraday_db()
    check_price_history_db()
    check_rl_fix_2_deployed()

    # Only check logs if pm2 is available
    if pm2_status:
        check_pm2_logs()

    banner('DIAGNOSTIC COMPLETE')
    print("""
  المراجعة المطلوبة:
  1. لو data-engine (port 5000) DOWN → pm2 restart data-engine
  2. لو data_engine.db.stocks EMPTY/STALE → fallback_chain فاشل (شوف logs)
  3. لو intraday.db.stock_intraday EMPTY/STALE → store_stocks_snapshot فاشل
  4. لو price_history.db STALE بس intraday.db FRESH → intraday_aggregator مش شغال
     → git pull && pm2 restart python-backend
  5. لو price_history.db STALE و intraday.db STALE → data-engine مش بـ scrape
     → pm2 restart data-engine + تأكد إن fallback_chain.py بيشتغل
""")


if __name__ == '__main__':
    main()
