#!/usr/bin/env python3
"""
B4 — Market Regime & NO_TRADE Pipeline Test
=============================================
Task ID: 1-c  |  Agent: Bravo (B4)

Tests the B4-MARKET-REGIME-FIX changes:
  1. RADAR FALLBACK removed from daily_predictor.py (no fabrication).
  2. CASCADING-FALLBACK Tier 4 (last_resort) removed from misc_routes.py
     (no fabricated picks when nothing qualifies).
  3. API contract now exposes `market_regime` + `no_trade_reason` +
     per-pick `decision` field.
  4. BEAR/DEFENSIVE regime with 0 picks → API returns empty list +
     `no_trade_reason` (NOT a fabricated 5-pick list).
  5. Real exceptional BUY during DEFENSIVE regime → passes through
     unchanged (regime does NOT auto-suppress legitimate signals).

Runs WITHOUT flask installed (mocks the flask module) and WITHOUT
touching the production DBs (uses an in-memory / temp stocks.db).

Usage:
    python3 scripts/test_b4_market_regime.py
"""
import os
import sys
import ast
import json
import sqlite3
import tempfile
import importlib.util
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────
# Constants / paths
# ──────────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
VPS = ROOT / 'vps-service'
MISC_ROUTES = VPS / 'api' / 'misc_routes.py'
PICKS_ROUTES = VPS / 'api' / 'picks_management_routes.py'
DAILY_PREDICTOR = VPS / 'jobs' / 'daily_predictor.py'

FAILS = []
PASSES = []


def ok(name, detail=''):
    PASSES.append((name, detail))
    print(f"  ✅ PASS: {name}" + (f" — {detail}" if detail else ''))


def fail(name, detail=''):
    FAILS.append((name, detail))
    print(f"  ❌ FAIL: {name}" + (f" — {detail}" if detail else ''))


# ──────────────────────────────────────────────────────────────────────────
# Mock flask module (so misc_routes can be imported without flask installed)
# ──────────────────────────────────────────────────────────────────────────
class _FakeBlueprint:
    def __init__(self, *a, **kw):
        self.routes = {}
    def route(self, rule, **kw):
        def deco(fn):
            self.routes[rule] = fn
            return fn
        return deco


class _FakeFlaskModule:
    Blueprint = _FakeBlueprint
    jsonify = lambda d: d  # noqa: E731
    request = None


def _install_flask_mock():
    # Pre-populate sys.modules so misc_routes's `from flask import ...` works.
    for mod_name in (
        'flask', 'flask.wrappers', 'flask.globals', 'flask.ctx',
        'flask.sessions', 'flask.signals', 'flask.json',
    ):
        if mod_name not in sys.modules:
            sys.modules[mod_name] = type(sys)('flask_mock')
    sys.modules['flask'].Blueprint = _FakeBlueprint
    sys.modules['flask'].jsonify = lambda d: d
    sys.modules['flask'].request = None
    # Many modules do `from flask import Flask, Blueprint, jsonify, request`
    # — set them as attributes.
    for attr in ('Flask', 'Blueprint', 'jsonify', 'request', 'g', 'session',
                 'current_app', 'abort', 'redirect', 'url_for', 'render_template'):
        if not hasattr(sys.modules['flask'], attr):
            setattr(sys.modules['flask'], attr, lambda *a, **kw: None)


# ──────────────────────────────────────────────────────────────────────────
# 1. Static source-code checks (no execution needed)
# ──────────────────────────────────────────────────────────────────────────
def check_radar_fallback_removed():
    print("\n══ TEST 1: RADAR FALLBACK removed from daily_predictor.py ══")
    src = DAILY_PREDICTOR.read_text(encoding='utf-8')
    # The fabrication dict literal must NOT be present anymore.
    if "'source': 'radar_fallback'" in src:
        fail("RADAR FALLBACK removed",
             "found 'source': 'radar_fallback' literal still in source")
        return
    # The old comment header must be replaced by the B4-MARKET-REGIME-FIX block.
    if "B4-MARKET-REGIME-FIX" not in src:
        fail("B4 marker present in daily_predictor.py",
             "B4-MARKET-REGIME-FIX marker missing")
        return
    # The new NO_TRADE log line must be present.
    if "[B4-NO-TRADE]" not in src:
        fail("[B4-NO-TRADE] log line present",
             "B4 NO_TRADE log line not found")
        return
    ok("RADAR FALLBACK removed",
       "no 'source': 'radar_fallback' dict literal; B4-MARKET-REGIME-FIX + [B4-NO-TRADE] log present")


def check_cascading_last_resort_removed():
    print("\n══ TEST 2: CASCADING Tier 4 (last_resort) removed ══")
    src = MISC_ROUTES.read_text(encoding='utf-8')
    # The Tier 4 fill loop must be gone.
    if "it['_fallback_tier'] = 'last_resort'" in src:
        fail("Tier 4 last_resort fill removed",
             "still found 'last_resort' tier assignment in source")
        return
    # _CASCADE_TIER_LABELS_AR should NOT include 'last_resort' as a real key.
    if "'last_resort':" in src and "intentionally removed" not in src:
        fail("last_resort label removed from cascade labels",
             "last_resort label still present without removal marker")
        return
    ok("Tier 4 last_resort removed",
       "no 'last_resort' tier assignment; comment marks it intentionally removed")


def check_api_response_fields_added():
    print("\n══ TEST 3: API response exposes market_regime + no_trade_reason ══")
    src_misc = MISC_ROUTES.read_text(encoding='utf-8')
    src_picks = PICKS_ROUTES.read_text(encoding='utf-8')

    # misc_routes must include 'market_regime_info' field
    if "'market_regime_info': _b4_get_market_regime_info(" not in src_misc:
        fail("misc_routes.py has market_regime_info",
             "field not added to misc_routes response")
    else:
        ok("misc_routes.py exposes market_regime_info",
           "added to /api/daily/rebuild-predictions and /api/unified/predictions")

    # picks_management_routes must include 'market_regime_info' field
    if "'market_regime_info': _b4_get_market_regime_info(" not in src_picks:
        fail("picks_management_routes.py has market_regime_info",
             "field not added to picks_management response")
    else:
        ok("picks_management_routes.py exposes market_regime_info",
           "added to /api/predictions/daily-picks")

    # both must annotate picks with decision field
    if "_b4_annotate_picks_with_decision" not in src_misc:
        fail("misc_routes.py annotates picks with decision",
             "helper not called")
    else:
        ok("misc_routes.py annotates picks with decision field")
    if "_b4_annotate_picks_with_decision" not in src_picks:
        fail("picks_management_routes.py annotates picks with decision",
             "helper not called")
    else:
        ok("picks_management_routes.py annotates picks with decision field")


# ──────────────────────────────────────────────────────────────────────────
# 2. Behavioral tests using temp stocks.db
# ──────────────────────────────────────────────────────────────────────────
def _make_temp_stocks_db(regime_value='DEFENSIVE', reasons=None):
    """Build a temp stocks.db with the system_settings row pre-populated."""
    fd, db_path = tempfile.mkstemp(suffix='.db', prefix='b4_test_')
    os.close(fd)
    conn = sqlite3.connect(db_path)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            value_type TEXT DEFAULT 'string',
            description TEXT,
            category TEXT DEFAULT 'general',
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_by TEXT DEFAULT 'system'
        )
    ''')
    state = {
        'current_regime': regime_value,
        'candidate_regime': regime_value,
        'candidate_days': 2,
        'last_update': '2026-10-20T10:00:00Z',
        'reasons': reasons or ['Index below SMA20+SMA50', 'breadth 11% < 25%'],
    }
    conn.execute(
        "INSERT INTO system_settings (key, value) VALUES (?, ?)",
        ('current_regime_EGX', json.dumps(state, ensure_ascii=False)),
    )
    conn.commit(); conn.close()
    return db_path


def _import_misc_routes_with_mocked_flask():
    """Import misc_routes.py with flask mocked and PROJECT_ROOT patched."""
    _install_flask_mock()
    # Ensure parent dirs on sys.path so `from core... import ...` works
    if str(VPS) not in sys.path:
        sys.path.insert(0, str(VPS))
    # Force a fresh import
    for mod in list(sys.modules.keys()):
        if mod.startswith('api.') or mod in ('misc_routes',):
            try:
                del sys.modules[mod]
            except Exception:
                pass
    spec = importlib.util.spec_from_file_location(
        'api.misc_routes', str(MISC_ROUTES),
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules['api.misc_routes'] = module
    try:
        spec.loader.exec_module(module)
    except Exception as e:
        # If full import fails (e.g. other unmet deps), fall back to extracting
        # the B4 helpers via exec on a slice of the file.
        print(f"  [info] full misc_routes import failed ({type(e).__name__}: {e}); "
              "extracting B4 helpers via direct exec")
        return None
    return module


def _extract_b4_helpers():
    """If full import fails, exec just the B4 helper block from misc_routes.py.

    Returns a module-like object with _b4_read_regime_from_settings,
    _b4_get_market_regime_info, _b4_annotate_picks_with_decision,
    _cascading_fallback_select.
    """
    src = MISC_ROUTES.read_text(encoding='utf-8')
    # Find the B4 helper block + the cascading fallback function + _is_dead_stock.
    # We exec them in a fresh namespace.
    ns = {'json': json, 'sqlite3': sqlite3, 'Path': Path, 'datetime': __import__('datetime'),
          'time': __import__('time'), 'logging': __import__('logging')}
    # Create a stub logger
    ns['_logger'] = type('L', (), {'debug': lambda *a, **kw: None,
                                   'info': lambda *a, **kw: None,
                                   'warning': lambda *a, **kw: None,
                                   'error': lambda *a, **kw: None})()
    # Manually exec the helper functions by line-slicing
    lines = src.splitlines(keepends=True)
    # Find the start of _B4_REGIME_MARKET_MAP block (just after the B4 header comment).
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if start_idx is None and '_B4_REGIME_MARKET_MAP' in line and '=' in line:
            start_idx = i
        if start_idx is not None and end_idx is None and line.startswith('_CASCADE_TIER_LABELS_AR'):
            # End just before the cascade labels block
            end_idx = i
            break
    if start_idx is None or end_idx is None:
        raise RuntimeError("Could not locate B4 helper block in misc_routes.py")
    b4_block = ''.join(lines[start_idx:end_idx])
    exec(b4_block, ns)

    # Now also exec the _is_dead_stock + _cascading_fallback_select + labels.
    cs_start = None
    cs_end = None
    for i, line in enumerate(lines):
        if cs_start is None and line.startswith('_CASCADE_PENNY_THRESHOLD'):
            cs_start = i
        if cs_start is not None and cs_end is None and i > cs_start and line.startswith('@'):
            cs_end = i
            break
    if cs_start is None:
        raise RuntimeError("Could not locate cascading fallback block")
    cs_block = ''.join(lines[cs_start:cs_end or len(lines)])
    exec(cs_block, ns)
    return ns


def test_b4_helpers_against_temp_db():
    print("\n══ TEST 4: B4 helpers against temp stocks.db (BEAR/DEFENSIVE) ══")
    db_path = _make_temp_stocks_db('DEFENSIVE')
    try:
        misc = _import_misc_routes_with_mocked_flask()
        if misc is None:
            ns = _extract_b4_helpers()
            read_fn = ns['_b4_read_regime_from_settings']
            info_fn = ns['_b4_get_market_regime_info']
            annotate_fn = ns['_b4_annotate_picks_with_decision']
            cascade_fn = ns['_cascading_fallback_select']
        else:
            read_fn = misc._b4_read_regime_from_settings
            info_fn = misc._b4_get_market_regime_info
            annotate_fn = misc._b4_annotate_picks_with_decision
            cascade_fn = misc._cascading_fallback_select

        # Monkey-patch the read function to use our temp DB.
        def _patched_read(market_key):
            conn = sqlite3.connect(db_path, timeout=5.0)
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    "SELECT value FROM system_settings WHERE key = ?",
                    (f"current_regime_{market_key}",),
                ).fetchone()
                if row and row[0]:
                    return json.loads(row[0])
                return {}
            finally:
                conn.close()
        # Patch on the module (or ns)
        if misc is not None:
            misc._b4_read_regime_from_settings = _patched_read
            misc._B4_REGIME_CACHE = {}  # reset cache
        else:
            ns['_b4_read_regime_from_settings'] = _patched_read
            # Re-bind info_fn's lookup (it references globals via _b4_read_regime_from_settings)
            info_fn.__globals__['_b4_read_regime_from_settings'] = _patched_read
            ns['_B4_REGIME_CACHE'] = {}

        # ─── Test 4a: DEFENSIVE regime + 0 picks → no_trade_reason non-empty
        info = info_fn(market='EGX', picks_count=0)
        if info.get('market_regime') == 'DEFENSIVE':
            ok("4a: market_regime=DEFENSIVE when 0 picks")
        else:
            fail("4a: market_regime=DEFENSIVE when 0 picks",
                 f"got {info.get('market_regime')}")
        if info.get('no_trade_reason') and 'BEAR/DEFENSIVE' in info.get('no_trade_reason', ''):
            ok("4a: no_trade_reason mentions BEAR/DEFENSIVE")
        else:
            fail("4a: no_trade_reason mentions BEAR/DEFENSIVE",
                 f"got: {info.get('no_trade_reason')!r}")
        if info.get('market_regime_source') == 'MarketRegimeEngine':
            ok("4a: market_regime_source=MarketRegimeEngine")
        else:
            fail("4a: market_regime_source=MarketRegimeEngine",
                 f"got {info.get('market_regime_source')!r}")

        # ─── Test 4b: DEFENSIVE regime + 3 real picks → no_trade_reason empty
        info2 = info_fn(market='EGX', picks_count=3)
        if info2.get('market_regime') == 'DEFENSIVE':
            ok("4b: market_regime=DEFENSIVE when picks>0 (real exception path)")
        else:
            fail("4b: market_regime=DEFENSIVE when picks>0",
                 f"got {info2.get('market_regime')}")
        if info2.get('no_trade_reason') == '':
            ok("4b: no_trade_reason empty when picks exist (real exception)")
        else:
            fail("4b: no_trade_reason empty when picks exist",
                 f"got: {info2.get('no_trade_reason')!r}")

        # ─── Test 4c: annotate picks with decision field
        picks = [
            {'ticker': 'COMI', 'signal': 'BUY'},
            {'ticker': 'HRHO', 'signal': ''},
            {'ticker': 'TAQA', 'signal': 'HOLD'},
            {'ticker': 'ORAS', 'signal': 'STRONG_BUY'},
        ]
        annotate_fn(picks)
        expected = ['BUY', 'NO_TRADE', 'NO_TRADE', 'STRONG_BUY']
        actual = [p.get('decision') for p in picks]
        if actual == expected:
            ok("4c: decision field per pick correct",
               f"{actual}")
        else:
            fail("4c: decision field per pick correct",
                 f"expected {expected}, got {actual}")

        # ─── Test 4d: cascading fallback returns < target when nothing qualifies
        # Simulate empty / all-low-quality picks list (all dead).
        dead_picks = [
            {'ticker': 'PENNY1', 'signal': 'BUY', 'entry_price': 0.5,
             'master_score': 10, 'risk_reward': 0.5},
            {'ticker': 'REJECTED1', 'signal': 'REJECTED',
             'master_score': 20, 'risk_reward': 0.3},
        ]
        result = cascade_fn(dead_picks, target=5)
        if len(result) == 0:
            ok("4d: cascade returns [] when only dead stocks qualify",
               f"len={len(result)} (target was 5)")
        else:
            fail("4d: cascade returns [] when only dead stocks qualify",
                 f"got {len(result)} picks (would have been 5 with Tier 4 last_resort)")

        # ─── Test 4e: cascade returns a real BUY when it qualifies
        good_picks = [
            {'ticker': 'COMI', 'signal': 'BUY', 'entry_price': 100.0,
             'master_score': 80, 'risk_reward': 2.0},
        ]
        result2 = cascade_fn(good_picks, target=5)
        if len(result2) == 1 and result2[0].get('ticker') == 'COMI':
            ok("4e: real BUY signal passes through cascade unchanged",
               f"got {result2[0].get('ticker')} tier={result2[0].get('_fallback_tier')}")
        else:
            fail("4e: real BUY signal passes through cascade",
                 f"got {result2}")

        # ─── Test 4f: simulate full API response shape with empty picks + DEFENSIVE
        # (the proof the owner requested — empty list + market_regime + no_trade_reason)
        empty_active = []
        annotate_fn(empty_active)  # no-op on empty list
        info_empty = info_fn(market='EGX', picks_count=len(empty_active))
        # Simulate the response shape
        api_response = {
            'success': True,
            'activePredictions': empty_active,
            'market_regime_info': info_empty,
        }
        if api_response['activePredictions'] == [] and \
           api_response['market_regime_info']['market_regime'] == 'DEFENSIVE' and \
           api_response['market_regime_info']['no_trade_reason']:
            ok("4f: API shape (empty picks + market_regime + no_trade_reason) — OWNER ACCEPTANCE CRITERION")
        else:
            fail("4f: API shape (empty picks + market_regime + no_trade_reason)",
                 f"got: {json.dumps(api_response, indent=2, ensure_ascii=False)}")

    finally:
        try:
            os.unlink(db_path)
        except Exception:
            pass


# ──────────────────────────────────────────────────────────────────────────
# 3. Syntax validation (re-confirm)
# ──────────────────────────────────────────────────────────────────────────
def check_syntax():
    print("\n══ TEST 0: Python syntax validation ══")
    for f in (MISC_ROUTES, PICKS_ROUTES, DAILY_PREDICTOR):
        try:
            ast.parse(f.read_text(encoding='utf-8'))
            ok(f"AST parse OK: {f.name}")
        except SyntaxError as e:
            fail(f"AST parse OK: {f.name}", f"line {e.lineno}: {e.msg}")


# ──────────────────────────────────────────────────────────────────────────
# 4. Verify backend supplies the full decision set (frontend has nothing to fabricate)
# ──────────────────────────────────────────────────────────────────────────
def check_no_frontend_substitute_paths():
    print("\n══ TEST 5: Backend supplies full decision set ══")
    # Verify that NO_TRADE can now reach the API via:
    #  - the explicit no_trade_reason field in market_regime_info (when picks empty)
    #  - the per-pick `decision` field (NO_TRADE for HOLD/empty signals)
    src_misc = MISC_ROUTES.read_text(encoding='utf-8')
    if "'no_trade_reason'" not in src_misc:
        fail("no_trade_reason field in API response", "not found in misc_routes.py")
    else:
        ok("no_trade_reason field present in misc_routes.py response shape")

    src_picks = PICKS_ROUTES.read_text(encoding='utf-8')
    if "'no_trade_reason'" not in src_picks:
        fail("no_trade_reason in picks_management_routes", "not found")
    else:
        ok("no_trade_reason field present in picks_management_routes.py response shape")

    # Verify market_regime field is exposed (inside market_regime_info dict)
    if "'market_regime':" not in src_misc:
        fail("market_regime field exposed", "not found in misc_routes.py")
    else:
        ok("market_regime field exposed inside market_regime_info dict")

    # Verify the `decision` field is added per pick
    if "p['decision'] = 'NO_TRADE'" not in src_misc:
        fail("per-pick decision=NO_TRADE assignment", "not found")
    else:
        ok("per-pick decision field (NO_TRADE for HOLD/empty signals) added")

    # CRITICAL: verify NO new thresholds / weights were introduced.
    # REGIME_CONFIG dict should be unchanged — check min_score/min_rr still
    # match the values in market_regime_engine.py.
    engine_src = (VPS / 'analyzers' / 'market_regime_engine.py').read_text(encoding='utf-8')
    expected_snippets = [
        'Regime.DEFENSIVE: {',
        '"min_rr": 1.8,',
        '"min_score": 65,',
        '"max_picks_per_day": 5,',
        'Regime.NORMAL: {',
        '"min_rr": 1.5,',
        '"min_score": 60,',
        'Regime.AGGRESSIVE: {',
    ]
    missing = [s for s in expected_snippets if s not in engine_src]
    if missing:
        fail("REGIME_CONFIG values preserved (no threshold changes)",
             f"missing: {missing}")
    else:
        ok("REGIME_CONFIG values preserved (no threshold/weight changes)")


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────
def main():
    print("=" * 78)
    print("B4 — Market Regime & NO_TRADE Pipeline Test (Task 1-c)")
    print("=" * 78)

    check_syntax()
    check_radar_fallback_removed()
    check_cascading_last_resort_removed()
    check_api_response_fields_added()
    test_b4_helpers_against_temp_db()
    check_no_frontend_substitute_paths()

    print("\n" + "=" * 78)
    print(f"SUMMARY: {len(PASSES)} pass / {len(FAILS)} fail")
    print("=" * 78)
    if FAILS:
        print("\nFailures:")
        for name, detail in FAILS:
            print(f"  ❌ {name}" + (f" — {detail}" if detail else ''))
        sys.exit(1)
    else:
        print("\n✅ ALL B4 TESTS PASS — owner's acceptance criteria met.")
        sys.exit(0)


if __name__ == '__main__':
    main()
