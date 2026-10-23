#!/usr/bin/env python3
"""PERSONA-FLAGS-FIX (v3.61.0) — End-to-end verification of the ACTUAL write path.

This script simulates EXACTLY what happens when trigger-analysis is called for
BONY/AREH, but WITHOUT touching the database. It calls the REAL production
function `_build_stored_analysis_row` and inspects the returned 28-value tuple
to verify tuple[18] (is_gambler_opportunity) == 1.

Usage (run from vps-service root on the VPS):
    python3 scripts/verify_persona_write_path.py BONY
    python3 scripts/verify_persona_write_path.py BONY AREH COMI

What it does:
  1. Loads the REAL stock dict from stocks.db (same SELECT as trigger_analysis_manual)
  2. Loads the REAL fund via _load_stocks_fundamentals_for_persona()
  3. Builds a mock MaestroResult with the production values (strong_buy, score=100,
     rr=1.73, conf=78) — OR real values from the last stored_analyses row
  4. Calls the REAL _build_stored_analysis_row(result, market, stock)
  5. Inspects tuple[18] (is_gambler), tuple[19] (is_investor), tuple[17] (turnover_egp)
  6. Prints PASS/FAIL + the [PERSONA_WRITE] / [PERSONA_SAFETY_NET] logs that the
     production path would emit

If tuple[18] == 1 here → the write path is correct and the DB will get g=1.
If tuple[18] == 0 here → the script shows EXACTLY which gate failed and why.
"""
from __future__ import annotations

import sys
import sqlite3
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Ensure project root is on sys.path
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

try:
    from data.analyses import (
        _build_stored_analysis_row,
        _load_stocks_fundamentals_for_persona,
        _STORED_ANALYSES_INSERT_SQL,
    )
except ImportError as _e:
    print(f"[FATAL] cannot import data.analyses: {_e}")
    print(f"        run from vps-service root:  python3 scripts/verify_persona_write_path.py BONY")
    sys.exit(2)

try:
    from core.opportunity_quality import (
        compute_persona_flags,
        is_live_stock_strict,
        _passes_quality_gate,
        _passes_gambler_confirmation,
        _newest_age_hours,
        _f,
        OPPORTUNITY_MIN_SCORE,
        OPPORTUNITY_MIN_RR,
        OPPORTUNITY_MIN_TURNOVER,
        OPPORTUNITY_MIN_CONFIDENCE,
        LIVE_STRICT_MAX_AGE_HOURS,
    )
except ImportError as _e:
    print(f"[FATAL] cannot import core.opportunity_quality: {_e}")
    sys.exit(2)


# ──────────────────────────────────────────────────────────────────────────────
# Mock MaestroResult — minimal dataclass matching the real one's fields
# ──────────────────────────────────────────────────────────────────────────────
@dataclass
class MockResult:
    """Minimal stand-in for MaestroResult with the fields _build_stored_analysis_row reads."""
    ticker: str
    timestamp: str = ''
    maestro_score: float = 100.0
    recommendation: str = 'strong_buy'
    recommendation_ar: str = 'شراء قوي'
    confidence: float = 78.0
    entry_price: float = 0.0
    stop_loss: Optional[float] = None
    target: Optional[float] = None
    risk_reward: float = 1.73
    phases: Dict[str, Any] = field(default_factory=dict)
    gambler: Optional[Dict[str, Any]] = None
    investor: Optional[Dict[str, Any]] = None
    persona_rr: Optional[Dict[str, Any]] = None
    persona_narrative: Optional[Dict[str, Any]] = None


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _load_real_stock(ticker: str, stocks_db: str) -> Optional[dict]:
    """Load the REAL stock dict using the SAME SELECT as trigger_analysis_manual."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(stocks_db, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("""
            SELECT ticker, name, name_ar, current_price, change_percent,
                   volume, sector, market, turnover_egp, is_active, is_suspended
            FROM stocks
            WHERE UPPER(ticker) = ?
              AND current_price IS NOT NULL AND current_price > 0
        """, (ticker.upper(),)).fetchone()
        return dict(row) if row else None
    except sqlite3.OperationalError:
        # fallback: fewer columns
        try:
            row = conn.execute("""
                SELECT ticker, name, current_price, volume, market
                FROM stocks WHERE UPPER(ticker) = ? AND current_price > 0
            """, (ticker.upper(),)).fetchone()
            return dict(row) if row else None
        except Exception:
            return None
    finally:
        conn.close()


def _try_load_real_result(ticker: str, predictions_db: str) -> Optional[MockResult]:
    """Try to load the LAST stored_analyses row for this ticker to use real values."""
    if not Path(predictions_db).exists():
        return None
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(predictions_db, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        row = conn.execute("""
            SELECT ticker, recommendation, maestro_score, confidence,
                   entry_price, target_price, stop_loss, risk_reward,
                   volume_ratio, turnover_egp, regime
            FROM stored_analyses
            WHERE UPPER(ticker) = ?
            ORDER BY updated_at DESC LIMIT 1
        """, (ticker.upper(),)).fetchone()
        conn.close()
        if not row:
            return None
        d = dict(row)
        vol_ratio = float(d.get('volume_ratio') or 1.0)
        return MockResult(
            ticker=d.get('ticker', ticker),
            maestro_score=float(d.get('maestro_score') or 100),
            recommendation=d.get('recommendation') or 'strong_buy',
            confidence=float(d.get('confidence') or 78),
            entry_price=float(d.get('entry_price') or 0),
            target=d.get('target_price'),
            stop_loss=d.get('stop_loss'),
            risk_reward=float(d.get('risk_reward') or 1.73),
            phases={
                'regime': {'phase': d.get('regime') or 'range', 'score': 50},
                'timeframe': {'aligned': True, 'aligned_count': 1},
                'volume': {'volume_ratio': vol_ratio, 'liquidity_rating': 'NORMAL', 'current_volume': 0},
            },
        )
    except Exception:
        return None


def _bar(ok: bool) -> str:
    return 'PASS ✅' if ok else 'FAIL ❌'


# ──────────────────────────────────────────────────────────────────────────────
# Main verification
# ──────────────────────────────────────────────────────────────────────────────
def verify_ticker(ticker: str, stocks_db: str, predictions_db: str) -> dict:
    ticker = (ticker or '').upper()
    print(f"\n{'='*78}")
    print(f"  VERIFYING WRITE PATH FOR: {ticker}")
    print(f"{'='*78}")

    # 1) Load real stock dict (same as trigger_analysis_manual)
    stock = _load_real_stock(ticker, stocks_db)
    if not stock:
        print(f"  ❌ ticker {ticker} NOT FOUND in stocks.db (or no current_price)")
        print(f"     → trigger_analysis_manual would skip it. Nothing to verify.")
        return {'ticker': ticker, 'status': 'NOT_IN_STOCKS_DB'}
    print(f"  ✓ stock dict loaded from stocks.db:")
    for k in ('ticker', 'current_price', 'volume', 'turnover_egp', 'sector', 'market', 'is_suspended'):
        print(f"      {k:<16} = {stock.get(k)}")

    # 2) Load real fund
    fund_map = _load_stocks_fundamentals_for_persona() or {}
    fund = fund_map.get(ticker, {})
    if not fund:
        print(f"  ⚠️  fund EMPTY for {ticker} — _load_stocks_fundamentals_for_persona() did not return it.")
        print(f"     This means the write path will see fund={{}} → cache-bust will trigger.")
    else:
        print(f"  ✓ fund loaded:")
        for k in ('volume', 'current_price', 'turnover_egp', 'value_traded',
                  'last_update', 'is_suspended', 'change_1d', 'volume_ratio'):
            print(f"      {k:<16} = {fund.get(k)}")

    # 3) Build mock result — prefer real values from stored_analyses, else defaults
    result = _try_load_real_result(ticker, predictions_db)
    if result:
        print(f"  ✓ using REAL values from last stored_analyses row:")
    else:
        result = MockResult(ticker=ticker)
        print(f"  ⚠️  no prior stored_analyses row — using defaults (strong_buy, 100, rr=1.73, conf=78):")
    print(f"      recommendation = {result.recommendation}")
    print(f"      maestro_score   = {result.maestro_score}")
    print(f"      risk_reward     = {result.risk_reward}")
    print(f"      confidence      = {result.confidence}")
    print(f"      entry_price     = {result.entry_price}")

    # 4) Call the REAL _build_stored_analysis_row (the ACTUAL production function)
    print(f"\n  ── calling _build_stored_analysis_row (REAL production function) ──")
    print(f"  (this will emit [PERSONA_WRITE] / [PERSONA_SAFETY_NET] / [PERSONA_CACHE_BUST] logs)")
    print()
    try:
        row = _build_stored_analysis_row(
            result,
            market=(stock.get('market') or 'EGX').upper(),
            stock=stock,
            turnover_egp=None,  # same as run_analysis_batch passes
        )
    except Exception as _e:
        import traceback
        print(f"\n  ❌ _build_stored_analysis_row THREW EXCEPTION: {_e}")
        traceback.print_exc()
        return {'ticker': ticker, 'status': 'EXCEPTION', 'error': str(_e)}
    print()

    if row is None:
        print(f"  ❌ _build_stored_analysis_row returned None (result had no ticker?)")
        return {'ticker': ticker, 'status': 'NONE'}

    # 5) Inspect the tuple — tuple[18]=is_gambler, tuple[19]=is_investor, tuple[17]=turnover_egp
    print(f"  ── tuple inspection (28 values) ──")
    print(f"    len(tuple)         = {len(row)}")
    print(f"    tuple[0]  ticker    = {row[0]}")
    print(f"    tuple[2]  score     = {row[2]}")
    print(f"    tuple[3]  rec       = {row[3]}")
    print(f"    tuple[9]  rr        = {row[9]}")
    print(f"    tuple[17] turnover  = {row[17]}")
    print(f"    tuple[18] is_gambler= {row[18]}  ← THIS MUST BE 1")
    print(f"    tuple[19] is_invest = {row[19]}")

    g = int(row[18]) if row[18] is not None else 0
    i = int(row[19]) if row[19] is not None else 0
    turn = row[17]

    print(f"\n  ── RESULT ──")
    print(f"    is_gambler_opportunity = {g}  {_bar(g == 1)}")
    print(f"    is_investor_opportunity = {i}")
    print(f"    turnover_egp            = {turn}  {_bar(turn is not None and float(turn) > 0)}")

    # 6) If g=0, explain WHY by re-running the gate logic directly
    if g == 0:
        print(f"\n  ── g=0 DIAGNOSIS: re-running gate logic with fresh fund ──")
        now_iso = time.strftime('%Y-%m-%d %H:%M:%S')
        rec = {
            'ticker': ticker,
            'recommendation': result.recommendation,
            'maestro_score': result.maestro_score,
            'risk_reward': result.risk_reward,
            'confidence': result.confidence,
            'updated_at': now_iso,
            'volume': float(fund.get('volume') or 0),
            'current_price': float(fund.get('current_price') or 0),
            'is_suspended': int(fund.get('is_suspended') or 0),
            'turnover_egp': float(fund.get('turnover_egp') or fund.get('value_traded') or 0) or None,
        }
        stored = {
            'volume_ratio': float(result.phases.get('volume', {}).get('volume_ratio', 1.0) or 1.0),
            'turnover_egp': rec.get('turnover_egp'),
            'updated_at': now_iso,
            'volume': rec.get('volume'),
            'current_price': rec.get('current_price'),
            'is_suspended': rec.get('is_suspended'),
        }

        live_strict = is_live_stock_strict(fund, stored)
        qg = _passes_quality_gate(rec, fund, stored)
        gc = _passes_gambler_confirmation(rec, fund, stored)

        print(f"    is_live_stock_strict    = {_bar(live_strict)}")
        if not live_strict:
            age = _newest_age_hours(fund.get('last_update'), stored.get('updated_at'))
            vol = _f(fund.get('volume'), 0) or _f(stored.get('volume'), 0)
            turn_q = (_f(stored.get('turnover_egp'), 0) or _f(fund.get('turnover_egp'), 0)
                      or _f(fund.get('value_traded'), 0))
            price = _f(fund.get('current_price'), 0) or _f(stored.get('current_price'), 0)
            reasons = []
            if age is None:
                reasons.append(f"no parseable timestamp (fund.last_update={fund.get('last_update')!r})")
            elif age > LIVE_STRICT_MAX_AGE_HOURS:
                reasons.append(f"age={age:.1f}h > {LIVE_STRICT_MAX_AGE_HOURS}h")
            if vol < 10000:
                reasons.append(f"volume={vol} < 10000")
            if turn_q < OPPORTUNITY_MIN_TURNOVER:
                reasons.append(f"turnover={turn_q} < {OPPORTUNITY_MIN_TURNOVER}")
            if price <= 0:
                reasons.append(f"current_price={price} <= 0")
            print(f"      fail reasons: {'; '.join(reasons) or '?'}")

        print(f"    _passes_quality_gate    = {_bar(qg)}")
        if not qg:
            reasons = []
            if _f(rec.get('maestro_score')) < OPPORTUNITY_MIN_SCORE:
                reasons.append(f"score={_f(rec.get('maestro_score'))} < {OPPORTUNITY_MIN_SCORE}")
            if _f(rec.get('risk_reward')) < OPPORTUNITY_MIN_RR:
                reasons.append(f"rr={_f(rec.get('risk_reward'))} < {OPPORTUNITY_MIN_RR}")
            if _f(rec.get('confidence')) < OPPORTUNITY_MIN_CONFIDENCE:
                reasons.append(f"conf={_f(rec.get('confidence'))} < {OPPORTUNITY_MIN_CONFIDENCE}")
            turn_q = (_f(stored.get('turnover_egp'), 0) or _f(fund.get('turnover_egp'), 0)
                      or _f(fund.get('value_traded'), 0))
            if turn_q < OPPORTUNITY_MIN_TURNOVER:
                reasons.append(f"turnover={turn_q} < {OPPORTUNITY_MIN_TURNOVER}")
            print(f"      fail reasons: {'; '.join(reasons) or '?'}")

        print(f"    _passes_gambler_confirm = {_bar(gc)}")

        # Direct compute_persona_flags call (same as diagnose)
        flags = compute_persona_flags(rec, fund, stored.get('volume_ratio', 1.0))
        print(f"\n    direct compute_persona_flags: is_gambler={flags.get('is_gambler')} "
              f"is_investor={flags.get('is_investor')}")
        if flags.get('is_gambler') == 1:
            print(f"    ⚠️  compute_persona_flags says g=1 BUT _build_stored_analysis_row returned g=0!")
            print(f"    → This means the production write path has a bug that the safety-net")
            print(f"      didn't catch. Check the [PERSONA_WRITE] / [PERSONA_SAFETY_NET] logs above.")
        else:
            print(f"    → compute_persona_flags ALSO says g=0. The issue is in the gate logic,")
            print(f"      not in the write path. Fix the fail reasons above.")

    return {
        'ticker': ticker,
        'status': 'OK' if g == 1 else 'G_IS_ZERO',
        'is_gambler': g,
        'is_investor': i,
        'turnover_egp': turn,
        'score': result.maestro_score,
        'recommendation': result.recommendation,
    }


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if not args:
        print("[usage] python3 scripts/verify_persona_write_path.py BONY [AREH COMI ...]")
        print("        Simulates the EXACT production write path and verifies tuple[18]=1.")
        return 1

    # Resolve DB paths
    _project_root = _ROOT.parent
    stocks_db = str(_project_root / 'db' / 'stocks.db')
    predictions_db = str(_project_root / 'db' / 'predictions.db')
    # vps-service-local override
    if not Path(stocks_db).exists():
        stocks_db = str(_ROOT / 'db' / 'stocks.db')
    if not Path(predictions_db).exists():
        predictions_db = str(_ROOT / 'db' / 'predictions.db')

    print(f"  stocks_db      = {stocks_db}  (exists={Path(stocks_db).exists()})")
    print(f"  predictions_db = {predictions_db}  (exists={Path(predictions_db).exists()})")

    results = []
    for tk in args:
        results.append(verify_ticker(tk, stocks_db, predictions_db))

    print(f"\n{'='*78}")
    print("  SUMMARY")
    print(f"{'='*78}")
    print(f"  {'ticker':<10} {'status':<14} {'g':<4} {'i':<4} {'turnover':<14} {'rec':<14} {'score'}")
    print(f"  {'─'*10} {'─'*14} {'─'*4} {'─'*4} {'─'*14} {'─'*14} {'─'*6}")
    for r in results:
        print(f"  {r.get('ticker','?'):<10} {r.get('status','?'):<14} "
              f"{r.get('is_gambler','?')!s:<4} {r.get('is_investor','?')!s:<4} "
              f"{r.get('turnover_egp','?')!s:<14} {r.get('recommendation','?')!s:<14} "
              f"{r.get('score','?')}")
    print()
    ok = all(r.get('is_gambler') == 1 for r in results)
    if ok:
        print("  ✅ ALL tickers have is_gambler=1 in the write-path tuple.")
        print("     → trigger-analysis WILL write g=1 to stored_analyses.")
        print("     → If DB still shows g=0, you need: git pull && pm2 restart python-backend")
    else:
        print("  ❌ At least one ticker has g=0 in the write-path tuple.")
        print("     → See the per-ticker diagnosis above for the fail reason.")
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
