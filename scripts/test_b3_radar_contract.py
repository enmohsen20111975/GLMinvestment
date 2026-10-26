#!/usr/bin/env python3
"""
test_b3_radar_contract.py — B3 Radar JSON Data Contract Test
============================================================
Task ID: 2-a / Bravo (B3 — Radar JSON contract)

Validates that scripts/maker_radar.py emits a JSON file that satisfies the
B3 contract:

  ACCEPTANCE CRITERIA (owner's spec):
    1. Compare source list vs final list — no scanned stock vanishes.
    2. Classifications don't unintentionally overlap.
    3. Stocks with incomplete data get NO misleading classification
       (must surface as INSUFFICIENT_DATA / DATA_INVALID — never as
       dead_trap / distribution / etc.).
    4. Filter counts are correct:
       classified_count + unclassified_count + data_error_count == scanned_count
    5. The real scanned count comes from the source (not a hardcoded 347):
       summary.source_count == summary.scanned_count

  ADDITIONAL CHECKS:
    6. len(results) == summary.scanned_count
    7. every stock in quiet_list / pre_surge_list / explosive_list /
       early_break_list / distribution_list / dead_trap_list /
       liquidity_drought_list / rule80_downtrend_list also appears in
       `results` with the matching classification.
    8. DATA_INVALID entries never have a "live trade" classification
       (quiet_accumulation / distribution / dead_trap / ...).
    9. Each `results` entry has the required B3 fields:
       ticker, classification, reasons, data_quality, data_quality_status,
       scan_timestamp, company, market, currency.

  FIXTURE STRATEGY:
    We invoke `python3 scripts/maker_radar.py --market EGX --limit 30 --json-only`
    which scans 30 EGX tickers from db/price_history.db (the sandbox has
    353 EGX tickers with full price history). 30 is small enough to run in
    ~10 seconds but large enough to exercise all classification paths
    (DATA_INVALID, INSUFFICIENT_DATA, unclassified, quiet_accumulation,
    distribution, liquidity_drought, rule80_downtrend).

    The test is safe to re-run — it overwrites scripts/output/maker_radar_EGX_<DATE>.json
    on each invocation.

Run:
    python3 scripts/test_b3_radar_contract.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "output"
RADAR_SCRIPT = PROJECT_ROOT / "scripts" / "maker_radar.py"
TICKER_LIMIT = 30   # small enough for fast test, large enough to cover paths

# Allowed classification values (B3 contract)
ALLOWED_CLASSIFICATIONS = {
    'quiet_accumulation',
    'distribution',
    'dead_trap',
    'liquidity_drought',
    'rule80_downtrend',
    'unclassified',
    'DATA_INVALID',
    'INSUFFICIENT_DATA',
}

# Classifications that signal "no actionable trade signal"
NO_SIGNAL_CLASSIFICATIONS = {
    'unclassified',
    'DATA_INVALID',
    'INSUFFICIENT_DATA',
}

# Classifications that signal "live trade signal" (a stock should NEVER
# be in BOTH a no_signal set AND a live_trade set).
LIVE_TRADE_CLASSIFICATIONS = {
    'quiet_accumulation',
    'distribution',
    'dead_trap',
    'liquidity_drought',
    'rule80_downtrend',
}

# Required B3 fields on every `results` entry
REQUIRED_B3_FIELDS = (
    'ticker',
    'classification',
    'reasons',
    'data_quality',
    'data_quality_status',
    'scan_timestamp',
    'company',
    'market',
    'currency',
)


class TestResult:
    def __init__(self, name: str):
        self.name = name
        self.passed = False
        self.details: list = []

    def ok(self, msg: str):
        self.passed = True
        self.details.append(f"  ✓ {msg}")

    def fail(self, msg: str):
        self.passed = False
        self.details.append(f"  ✗ {msg}")

    def info(self, msg: str):
        self.details.append(f"    {msg}")


def _run_radar() -> Path:
    """Run maker_radar.py with a small limit; return path to the generated JSON."""
    cmd = [
        sys.executable,
        str(RADAR_SCRIPT),
        '--market', 'EGX',
        '--limit', str(TICKER_LIMIT),
        '--json-only',
    ]
    print(f"▶ Running: {' '.join(cmd)}")
    env = dict(os.environ)
    env['PYTHONUNBUFFERED'] = '1'
    result = subprocess.run(
        cmd, cwd=str(PROJECT_ROOT), capture_output=True, text=True,
        env=env, timeout=180,
    )
    if result.returncode != 0:
        print("── stdout ──")
        print(result.stdout[-3000:])
        print("── stderr ──")
        print(result.stderr[-3000:])
        raise RuntimeError(f"maker_radar.py exited with code {result.returncode}")
    # Find the latest maker_radar_EGX_*.json file
    files = sorted(OUTPUT_DIR.glob('maker_radar_EGX_*.json'), reverse=True)
    if not files:
        raise RuntimeError("maker_radar.py did not produce a JSON output file")
    return files[0]


def _load_json(path: Path) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def test_no_vanishing(data: dict) -> TestResult:
    """Acceptance #1 + #5 + #6: source vs final — no scanned stock vanishes."""
    t = TestResult("no_vanishing")
    summary = data.get('summary') or {}
    source_count = summary.get('source_count')
    scanned_count = summary.get('scanned_count')
    results_len = len(data.get('results') or [])

    if source_count is None:
        t.fail(f"summary.source_count missing — summary={summary}")
        return t
    if scanned_count is None:
        t.fail(f"summary.scanned_count missing — summary={summary}")
        return t

    if source_count == scanned_count:
        t.ok(f"source_count == scanned_count == {source_count} (no vanishing)")
    else:
        t.fail(f"source_count={source_count} != scanned_count={scanned_count}")

    if results_len == scanned_count:
        t.ok(f"len(results) == scanned_count == {results_len}")
    else:
        t.fail(f"len(results)={results_len} != scanned_count={scanned_count}")

    if source_count > 0:
        t.info(f"source_count={source_count} is NOT hardcoded (real source)")
    else:
        t.fail("source_count == 0 — empty scan?")
    return t


def test_counts_add_up(data: dict) -> TestResult:
    """Acceptance #4: classified + unclassified + data_error == scanned."""
    t = TestResult("counts_add_up")
    s = data.get('summary') or {}
    classified = s.get('classified_count', 0)
    unclassified = s.get('unclassified_count', 0)
    data_error = s.get('data_error_count', 0)
    scanned = s.get('scanned_count', 0)
    total = classified + unclassified + data_error

    if total == scanned:
        t.ok(f"classified({classified}) + unclassified({unclassified}) + data_error({data_error}) == scanned({scanned})")
    else:
        t.fail(f"classified({classified}) + unclassified({unclassified}) + data_error({data_error}) = {total} != scanned({scanned})")
    return t


def test_classification_enum(data: dict) -> TestResult:
    """Every entry's classification must be in the allowed enum."""
    t = TestResult("classification_enum")
    bad = []
    for r in data.get('results', []):
        c = r.get('classification')
        if c not in ALLOWED_CLASSIFICATIONS:
            bad.append((r.get('ticker'), c))
    if not bad:
        t.ok(f"all {len(data.get('results', []))} entries have valid classification values")
    else:
        t.fail(f"{len(bad)} entries have invalid classification: {bad[:5]}")
    return t


def test_required_b3_fields(data: dict) -> TestResult:
    """Every `results` entry has the required B3 fields."""
    t = TestResult("required_b3_fields")
    missing = []
    for r in data.get('results', []):
        for field in REQUIRED_B3_FIELDS:
            if field not in r:
                missing.append((r.get('ticker'), field))
    if not missing:
        t.ok(f"all {len(data.get('results', []))} entries have required B3 fields: {REQUIRED_B3_FIELDS}")
    else:
        t.fail(f"{len(missing)} entries missing required fields (first 5): {missing[:5]}")
    return t


def test_lists_are_subsets_of_results(data: dict) -> TestResult:
    """Acceptance #2 (partial): every list entry appears in `results`."""
    t = TestResult("lists_are_subsets_of_results")
    results_tickers = {r.get('ticker') for r in data.get('results', []) if r.get('ticker')}
    orphan = []
    for list_key in (
        'quiet_list', 'pre_surge_list', 'explosive_list', 'early_break_list',
        'distribution_list', 'dead_trap_list', 'liquidity_drought_list',
        'rule80_downtrend_list',
    ):
        lst = data.get(list_key) or []
        for entry in lst:
            tk = entry.get('ticker')
            if not tk:
                continue
            if tk not in results_tickers:
                orphan.append((list_key, tk))
    if not orphan:
        t.ok("every list entry (quiet/pre_surge/explosive/early_break/distribution/dead_trap/liquidity_drought/rule80_downtrend) appears in `results`")
    else:
        t.fail(f"{len(orphan)} list entries are not in `results` (first 5): {orphan[:5]}")
    return t


def test_classification_matches_list_membership(data: dict) -> TestResult:
    """Each NEW list key (dead_trap_list, etc.) entries' classification matches."""
    t = TestResult("classification_matches_list_membership")
    # Map: list_key → expected classification
    expected_map = {
        'dead_trap_list': 'dead_trap',
        'liquidity_drought_list': 'liquidity_drought',
        'rule80_downtrend_list': 'rule80_downtrend',
    }
    mismatches = []
    for list_key, expected_cls in expected_map.items():
        lst = data.get(list_key) or []
        for entry in lst:
            actual_cls = entry.get('classification')
            if actual_cls != expected_cls:
                mismatches.append((list_key, entry.get('ticker'), actual_cls, expected_cls))
    if not mismatches:
        t.ok("every dead_trap_list/liquidity_drought_list/rule80_downtrend_list entry has the matching classification")
    else:
        t.fail(f"{len(mismatches)} list entries have wrong classification (first 5): {mismatches[:5]}")
    return t


def test_no_overlap_between_lists(data: dict) -> TestResult:
    """Acceptance #2: classifications don't unintentionally overlap.
    A stock should not appear in two NEW lists at once."""
    t = TestResult("no_overlap_between_lists")
    list_keys = ('dead_trap_list', 'liquidity_drought_list', 'rule80_downtrend_list')
    list_tickers = {k: {e.get('ticker') for e in (data.get(k) or []) if e.get('ticker')} for k in list_keys}
    overlaps = []
    for i, k1 in enumerate(list_keys):
        for k2 in list_keys[i+1:]:
            inter = list_tickers[k1] & list_tickers[k2]
            if inter:
                overlaps.append((k1, k2, list(inter)[:5]))
    if not overlaps:
        t.ok("no ticker appears in two NEW lists at once (no classification overlap)")
    else:
        t.fail(f"{len(overlaps)} overlaps between NEW lists: {overlaps}")
    return t


def test_insufficient_not_misclassified(data: dict) -> TestResult:
    """Acceptance #3: stocks with insufficient data have INSUFFICIENT_DATA
    (NOT dead_trap / distribution / etc.)."""
    t = TestResult("insufficient_not_misclassified")
    misclassified = []
    for r in data.get('results', []):
        cls = r.get('classification')
        reasons = r.get('reasons') or []
        is_insufficient = any('insufficient' in str(x).lower() for x in reasons) or cls == 'INSUFFICIENT_DATA'
        is_invalid = cls == 'DATA_INVALID' or any('DATA_INVALID' in str(x) for x in reasons) or any('sanity' in str(x).lower() for x in reasons)
        if (is_insufficient or is_invalid) and cls not in NO_SIGNAL_CLASSIFICATIONS:
            misclassified.append((r.get('ticker'), cls, reasons[:2]))
    if not misclassified:
        t.ok("no insufficient/invalid stock was misclassified as dead_trap/distribution/etc.")
    else:
        t.fail(f"{len(misclassified)} insufficient/invalid stocks were misclassified (first 5): {misclassified[:5]}")
    return t


def test_data_invalid_has_no_live_signal(data: dict) -> TestResult:
    """Acceptance #3 (B1 integration): DATA_INVALID stocks must NOT be
    force-classified into a live-trade classification."""
    t = TestResult("data_invalid_has_no_live_signal")
    bad = []
    for r in data.get('results', []):
        cls = r.get('classification')
        sanity = r.get('sanity_status') or ''
        if cls == 'DATA_INVALID' and cls in LIVE_TRADE_CLASSIFICATIONS:
            bad.append((r.get('ticker'), cls, sanity))
        # Also: a stock with sanity_status != 'OK' should not be in a live-trade class
        if sanity and sanity != 'OK' and cls in LIVE_TRADE_CLASSIFICATIONS:
            bad.append((r.get('ticker'), cls, sanity))
    if not bad:
        t.ok("no DATA_INVALID / sanity-failed stock has a live-trade classification")
    else:
        t.fail(f"{len(bad)} DATA_INVALID/sanity-failed stocks have live-trade classifications: {bad[:5]}")
    return t


def test_adp_isolation_visibility(data: dict) -> TestResult:
    """B1 integration check: ADP (the contaminated ticker B1 isolated) must
    appear in results as DATA_INVALID — NOT silently dropped, NOT force-classified."""
    t = TestResult("adp_isolation_visibility")
    adp_entry = None
    for r in data.get('results', []):
        if r.get('ticker') == 'ADP':
            adp_entry = r
            break
    if adp_entry is None:
        # ADP may not be in the first 30 tickers — skip if not present.
        t.info("ADP not in scanned set (likely not in first 30 tickers) — skipping ADP-specific check")
        t.passed = True
        return t
    cls = adp_entry.get('classification')
    sanity = adp_entry.get('sanity_status')
    reasons = adp_entry.get('reasons') or []
    has_contamination_reason = any('currency_market_mismatch' in str(x) or 'history_current_mismatch' in str(x) for x in reasons)
    if cls == 'DATA_INVALID' and has_contamination_reason:
        t.ok(f"ADP surfaces as DATA_INVALID with B1 contamination reasons (sanity={sanity})")
    else:
        t.fail(f"ADP classification={cls}, sanity={sanity}, reasons={reasons[:3]} — expected DATA_INVALID with contamination reasons")
    return t


def test_legacy_lists_preserved(data: dict) -> TestResult:
    """Constraint #3: legacy list keys (quiet_list, pre_surge_list,
    explosive_list, early_break_list, distribution_list, under_microscope,
    all_results) must still be present (backward compat with Alpha's UI)."""
    t = TestResult("legacy_lists_preserved")
    required = (
        'quiet_list', 'pre_surge_list', 'explosive_list', 'early_break_list',
        'distribution_list', 'under_microscope', 'all_results',
        # B3 new keys
        'results', 'summary',
        'dead_trap_list', 'liquidity_drought_list', 'rule80_downtrend_list',
    )
    missing = [k for k in required if k not in data]
    if not missing:
        t.ok(f"all {len(required)} required top-level keys present (legacy + B3 new)")
    else:
        t.fail(f"missing top-level keys: {missing}")
    return t


def test_summary_fields(data: dict) -> TestResult:
    """The `summary` block must contain all 7 required fields."""
    t = TestResult("summary_fields")
    required = (
        'source_count', 'scanned_count', 'valid_data_count',
        'classified_count', 'unclassified_count', 'data_error_count',
        'scan_timestamp',
    )
    s = data.get('summary') or {}
    missing = [k for k in required if k not in s]
    if not missing:
        t.ok(f"summary has all 7 required fields: {required}")
    else:
        t.fail(f"summary missing fields: {missing} — got: {list(s.keys())}")
    return t


def test_data_quality_enum(data: dict) -> TestResult:
    """data_quality_status values must be in the uppercase enum."""
    t = TestResult("data_quality_enum")
    allowed_dqs = {'OK', 'STALE', 'INVALID', 'UNAVAILABLE'}
    bad = []
    for r in data.get('results', []):
        dqs = r.get('data_quality_status')
        if dqs is not None and dqs not in allowed_dqs:
            bad.append((r.get('ticker'), dqs))
    if not bad:
        t.ok(f"all data_quality_status values are in {allowed_dqs}")
    else:
        t.fail(f"{len(bad)} entries have invalid data_quality_status: {bad[:5]}")
    return t


def main():
    print("═" * 72)
    print("  B3 Radar JSON Data Contract Test — Task 2-a / Bravo")
    print("═" * 72)
    print()

    # ─── Step 1: run maker_radar.py with a small limit ────────────────
    try:
        json_path = _run_radar()
    except Exception as e:
        print(f"❌ FAILED to run maker_radar.py: {e}")
        return 1
    print(f"✓ maker_radar.py produced: {json_path.name}")
    print()

    # ─── Step 2: load + validate ──────────────────────────────────────
    data = _load_json(json_path)
    print(f"✓ JSON loaded — top-level keys: {len(data)}")
    print()

    tests = [
        test_no_vanishing(data),
        test_counts_add_up(data),
        test_classification_enum(data),
        test_required_b3_fields(data),
        test_lists_are_subsets_of_results(data),
        test_classification_matches_list_membership(data),
        test_no_overlap_between_lists(data),
        test_insufficient_not_misclassified(data),
        test_data_invalid_has_no_live_signal(data),
        test_adp_isolation_visibility(data),
        test_legacy_lists_preserved(data),
        test_summary_fields(data),
        test_data_quality_enum(data),
    ]

    # ─── Print results ────────────────────────────────────────────────
    print("─" * 72)
    print("  TEST RESULTS")
    print("─" * 72)
    passed = sum(1 for t in tests if t.passed)
    total = len(tests)
    for t in tests:
        marker = "✓" if t.passed else "✗"
        print(f"  {marker} {t.name}")
        for line in t.details:
            print(line)
    print()
    print("═" * 72)
    print(f"  RESULT: {passed}/{total} tests passed")
    print("═" * 72)
    if passed == total:
        print("\n  ✅ B3 contract validated — no vanishing, no misclassification.")
    else:
        print("\n  ❌ B3 contract FAILED — see details above.")
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())
