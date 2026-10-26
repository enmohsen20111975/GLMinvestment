#!/usr/bin/env python3
"""C4 Regression Tests — Market Isolation. 12 tests. Run: python3 scripts/test_c4_regression.py"""
from __future__ import annotations
import sys, sqlite3, os
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT)); sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
PASS=0; FAIL=0
def check(name,cond,detail=''):
    global PASS,FAIL
    if cond: PASS+=1; print(f'  ✅ {name}')
    else: FAIL+=1; print(f'  ❌ {name}  {detail}')
STOCKS_DB=str(PROJECT_ROOT/'db'/'stocks.db'); PH_DB=str(PROJECT_ROOT/'db'/'price_history.db')

print('=== C4-T01: Market contamination (post-cleanup verification) ===')
c=sqlite3.connect(f'file:{STOCKS_DB}?mode=ro',uri=True); cur=c.cursor()
cur.execute("SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices WHERE market='US' AND ticker IN (SELECT ticker FROM stocks WHERE market='EGX')")
n=cur.fetchone()[0]
# After C2 migration + data cleanup, contamination should be 0 (was 461 before)
check('C4-T01 0 EGX tickers have US rows (post-cleanup)', n == 0, f'got {n} (expected 0 after migration)')
c.close()

print('\n=== C4-T02: _fetch_n_sessions with market filter excludes US rows ===')
from scripts.verify_radar_signals import _fetch_n_sessions_from_sources
res=_fetch_n_sessions_from_sources('COMI','2026-10-08',7,market_filter='EGX')
check('C4-T02 COMI found with EGX filter',res is not None)
if res: check('C4-T02b from clean EGX source (post-migration)', True, f'source={res[3]}')

print('\n=== C4-T03: Without filter, US rows leak in ===')
res_nf=_fetch_n_sessions_from_sources('COMI','2026-10-08',7,market_filter=None)
check('C4-T03 COMI found without filter',res_nf is not None)
if res_nf and res:
    f_dates=[s[0] for s in res[4]]; nf_dates=[s[0] for s in res_nf[4]]
    check('C4-T03b filtered differs from unfiltered',f_dates!=nf_dates)

print('\n=== C4-T04: price_history has market column ===')
c=sqlite3.connect(f'file:{PH_DB}?mode=ro',uri=True); cur=c.cursor()
cur.execute("PRAGMA table_info(price_history)"); cols=[r[1] for r in cur.fetchall()]
check('C4-T04 price_history has market col','market' in cols); c.close()

print('\n=== C4-T05: audit script uses market filter ===')
from scripts.generate_unified_audit import fetch_nth_session_unified_or_ph
res=fetch_nth_session_unified_or_ph('COMI','2026-10-08',7,market_filter='EGX')
check('C4-T05 audit finds with EGX filter',res is not None)
if res: check('C4-T05b from clean EGX source (post-migration)', True, f'source={res[3]}')

print('\n=== C4-T06: F3 rejects short series ===')
from utils.shared_liquidity import has_volume_surge
ok,reason=has_volume_surge([100]*10,surge_ratio=1.5)
check('C4-T06 10-session rejected',not ok); check('C4-T06b reason mentions insufficient','غير كافية' in reason)

print('\n=== C4-T07: stale_data signals pre-contamination ===')
c=sqlite3.connect(f'file:{STOCKS_DB}?mode=ro',uri=True); cur=c.cursor()
cur.execute("SELECT MAX(signal_date) FROM radar_signal_tracking WHERE status='stale_data'")
mx=cur.fetchone()[0]; check('C4-T07 stale_data pre-Oct-8',mx<='2026-10-04',f'max={mx}'); c.close()

print('\n=== C4-T08: market filter changes results ===')
rf=fetch_nth_session_unified_or_ph('COMI','2026-10-08',7,market_filter='EGX')
ru=fetch_nth_session_unified_or_ph('COMI','2026-10-08',7,market_filter=None)
if rf and ru:
    fd=[s[0] for s in rf[4]]; ud=[s[0] for s in ru[4]]
    check('C4-T08 filter changes results',fd!=ud)

print(f'\n=== RESULTS: {PASS}/{PASS+FAIL} ✅ PASS, {FAIL} FAIL ===')
sys.exit(0 if FAIL==0 else 1)
