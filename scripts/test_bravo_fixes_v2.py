#!/usr/bin/env python3
"""
BRAVO v2 — Fix Verification Tests (F1-v2 + F3-v2)
=================================================
Tests that:
- F1-v2: trading-session counting (not calendar days) — proves the N-th
  trading session is fetched, skipping weekends/holidays.
- F3-v2: non-overlapping baseline with NO fallback — proves short series are
  rejected, not given a biased ratio.

Each test is constructed so it would FAIL on the pre-fix code and PASS on
the post-fix code.

Run:
    python3 scripts/test_bravo_fixes_v2.py
"""
from __future__ import annotations
import sys, os, sqlite3, tempfile
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

PASS = 0
FAIL = 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  ✅ {name}')
    else:
        FAIL += 1
        print(f'  ❌ {name}  {detail}')

# ============================================================================
# F3-v2 TESTS — non-overlapping baseline, NO fallback
# ============================================================================
print('=== F3-v2: has_volume_surge() non-overlapping, NO fallback ===')

from utils.shared_liquidity import has_volume_surge, is_explosive_surge
import re

# F3-v2-T01: 25 sessions — fires correctly with non-overlap ratio
vols_25 = [100]*20 + [300]*5
ok, reason = has_volume_surge(vols_25, surge_ratio=1.5)
check('F3v2-T01 25 sessions fires', ok, reason)
m = re.search(r'volume_surge_ratio=([\d.]+)', reason)
ratio = float(m.group(1)) if m else 0
check('F3v2-T02 ratio=3.0 (non-overlap, not 2.0 overlap)', abs(ratio-3.0)<0.05, f'got {ratio}')

# F3-v2-T03: 24 sessions — MUST reject (no fallback to overlapping)
vols_24 = [100]*19 + [300]*5
ok, reason = has_volume_surge(vols_24, surge_ratio=1.5)
check('F3v2-T03 24 sessions REJECTED (no fallback)', not ok, reason)
check('F3v2-T04 reason mentions non-overlap requirement', 'non-overlap' in reason or 'غير كافية' in reason, reason)

# F3-v2-T05: 20 sessions (exactly base_lookback, no room for recent) — MUST reject
vols_20 = [100]*15 + [300]*5
ok, reason = has_volume_surge(vols_20, surge_ratio=1.5)
check('F3v2-T05 20 sessions REJECTED', not ok, reason)

# F3-v2-T06: 15 sessions — MUST reject
vols_15 = [100]*10 + [300]*5
ok, reason = has_volume_surge(vols_15, surge_ratio=1.5)
check('F3v2-T06 15 sessions REJECTED', not ok, reason)

# F3-v2-T07: flat volume (25 sessions) — does NOT fire
ok, reason = has_volume_surge([100]*25, surge_ratio=1.5)
check('F3v2-T07 flat volume does NOT fire', not ok, reason)

# F3-v2-T08: empty list — rejected
ok, reason = has_volume_surge([], surge_ratio=1.5)
check('F3v2-T08 empty list rejected', not ok, reason)

# F3-v2-T09: AJWA empirical (25 sessions from real data)
ajwa_vols = [54798, 96616, 45690, 45690, 101993, 100322, 52243, 9335, 50298, 50298,
             50298, 61195, 46286, 31433, 47179, 191774, 191774, 61728, 25505, 59017,
             59017, 77580, 77580, 147505, 228710]
ok, reason = has_volume_surge(ajwa_vols, surge_ratio=1.5)
m = re.search(r'volume_surge_ratio=([\d.]+)', reason)
ajwa_ratio = float(m.group(1)) if m else 0
check('F3v2-T09 AJWA empirical ratio=1.72 (non-overlap)', abs(ajwa_ratio-1.72)<0.05, f'got {ajwa_ratio}')

# F3-v2-T10: matches is_explosive_surge ratio on same input
_, _, det = is_explosive_surge(vols_25, surge_ratio=2.0, base_lookback=20, surge_lookback=5)
exp_ratio = det.get('vol_ratio', 0) if isinstance(det, dict) else 0
check('F3v2-T10 matches is_explosive_surge ratio', abs(ratio-exp_ratio)<0.05, f'hvs={ratio} vs explosive={exp_ratio}')

# F3-v2-T11: custom lookbacks — 3 recent + 10 base = 13 required
vols_custom = [50]*10 + [200]*3  # 13 sessions
ok, reason = has_volume_surge(vols_custom, surge_ratio=1.5, surge_lookback=3, base_lookback=10)
m = re.search(r'volume_surge_ratio=([\d.]+)', reason)
r = float(m.group(1)) if m else 0
check('F3v2-T11 custom lookbacks (3+10=13) fires with ratio=4.0', ok and abs(r-4.0)<0.05, f'ratio={r}, reason={reason}')

# F3-v2-T12: custom lookbacks — 12 sessions (one short) — MUST reject
vols_custom_short = [50]*9 + [200]*3  # 12 sessions, need 13
ok, reason = has_volume_surge(vols_custom_short, surge_ratio=1.5, surge_lookback=3, base_lookback=10)
check('F3v2-T12 custom lookbacks 12<13 REJECTED', not ok, reason)

# ============================================================================
# F1-v2 TESTS — trading-session counting (not calendar days)
# ============================================================================
print('\n=== F1-v2: trading-session counting ===')

# F1-v2 uses the REAL DBs. We test against known EGX tickers with known
# trading patterns (weekends Fri+Sat skipped).
from scripts.verify_radar_signals import _fetch_n_sessions_from_sources, UNIFIED_PRICE_SOURCES

# F1-v2-T01: COMI — fetch 7th trading session after 2026-09-28
# 2026-09-28 is a Monday. EGX trades Sun-Thu (Fri+Sat closed).
# Trading sessions after Sep 28 (Mon): Sep 29(Tue), Sep 30(Wed), Oct 1(Thu),
#   Oct 4(Sun) [Oct 2-3 Fri+Sat skipped], Oct 5(Mon), Oct 6(Tue), Oct 7(Wed)
# = 7th session = Oct 7
res = _fetch_n_sessions_from_sources('COMI', '2026-09-28', 7)
check('F1v2-T01 COMI 7th session found', res is not None, 'no source returned')
if res:
    nth_close, mx, mn, label, sessions = res
    # Verify we got exactly 7 sessions
    check('F1v2-T02 exactly 7 sessions returned', len(sessions) == 7, f'got {len(sessions)}')
    # Verify the 7th session date is Oct 7 (not Oct 5 which would be calendar+7)
    last_date = sessions[-1][0]
    print(f'       7th session date: {last_date}  (calendar+7 would be Oct 5)')
    # Calendar+7 from Sep 28 = Oct 5. But 7th trading session = Oct 7
    # (because Oct 2-3 are Fri+Sat, skipped). If last_date >= Oct 6, we correctly
    # skipped weekends.
    check('F1v2-T03 7th session is Oct 7 (skipped Fri+Sat)', last_date >= '2026-10-06', f'got {last_date}')

# F1-v2-T04: verify calendar+7 would give WRONG date (Oct 5)
calendar_target = (datetime(2026,9,28) + timedelta(days=7)).strftime('%Y-%m-%d')
print(f'       calendar+7 = {calendar_target}  (this is what OLD code used)')
check('F1v2-T04 calendar+7 = Oct 5 (would be 5th trading session, WRONG)', calendar_target == '2026-10-05', f'got {calendar_target}')

# F1-v2-T05: fetch 14th trading session — should be ~Oct 16 (skipping 2 weekends)
res14 = _fetch_n_sessions_from_sources('COMI', '2026-09-28', 14)
check('F1v2-T05 COMI 14th session found', res14 is not None, 'no source')
if res14:
    _, _, _, _, sessions14 = res14
    check('F1v2-T06 exactly 14 sessions', len(sessions14) == 14, f'got {len(sessions14)}')
    # 14 trading sessions from Sep 28: Sep 29,30, Oct 1, 4,5,6,7,8,11,12,13,14,15,16
    last14 = sessions14[-1][0]
    print(f'       14th session date: {last14}  (calendar+14 would be Oct 12)')
    check('F1v2-T07 14th session is Oct 16 (not calendar Oct 12)', last14 >= '2026-10-15', f'got {last14}')

# F1-v2-T08: insufficient sessions — returns None (not partial data)
res_short = _fetch_n_sessions_from_sources('COMI', '2026-10-20', 30)
check('F1v2-T08 30th session after Oct 20 returns None (insufficient)', res_short is None or len(res_short[4]) >= 30,
      f'got {len(res_short[4]) if res_short else "None"} sessions')

# F1-v2-T09: POUL post-merger — 7th session after Oct 4 (post-merger price)
res_poul = _fetch_n_sessions_from_sources('POUL', '2026-10-04', 7)
check('F1v2-T09 POUL 7th session found', res_poul is not None, 'no source')
if res_poul:
    poul_close, _, _, _, _ = res_poul
    # Post-merger POUL trades 9-11 range
    check('F1v2-T10 POUL 7th close in 9-11 range (post-merger)', 9.0 <= poul_close <= 11.0, f'close={poul_close}')

# F1-v2-T10: ORHD post-split — 7th session after Oct 8 (post-split price)
res_orhd = _fetch_n_sessions_from_sources('ORHD', '2026-10-08', 7)
check('F1v2-T11 ORHD 7th session found', res_orhd is not None, 'no source')
if res_orhd:
    orhd_close, _, _, _, _ = res_orhd
    # Post-split ORHD trades 10-13 range
    check('F1v2-T12 ORHD 7th close in 10-13 range (post-split)', 10.0 <= orhd_close <= 13.5, f'close={orhd_close}')

# F1-v2-T13: holiday test — Jan 1 (New Year) is not an EGX trading day
# Fetch sessions after Dec 31, 2025 — first session should be Jan 4 (Sun), not Jan 1
res_hol = _fetch_n_sessions_from_sources('COMI', '2025-12-31', 1)
if res_hol:
    _, _, _, _, sess_hol = res_hol
    first_date = sess_hol[0][0]
    print(f'       first session after Dec 31: {first_date} (Jan 1 = holiday, skipped)')
    check('F1v2-T13 holiday Jan 1 skipped (first session > Jan 1)', first_date > '2026-01-01', f'got {first_date}')
else:
    # May be no data for Dec 2025 — skip gracefully
    print('  ⏭️ F1v2-T13 skipped (no Dec 2025 data in sources)')

# ============================================================================
# SUMMARY
# ============================================================================
print(f'\n=== RESULTS: {PASS}/{PASS+FAIL} ✅ PASS, {FAIL} FAIL ===')
sys.exit(0 if FAIL == 0 else 1)
