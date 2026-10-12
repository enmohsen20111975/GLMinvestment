#!/usr/bin/env python3
"""
ts_health.py — Engineering Health Metric (PKG2 — Strict Engineering)
====================================================================
Measures the TYPE-SAFETY health of the TypeScript codebase so progress
on Package 2 ("Strict Software Engineering Standards") is trackable.

Metrics reported:
  1. `any` usage count (target: 0)  — split by `: any`, `as any`, `any[]`, `<any>`
  2. Files using `any`
  3. Bare `toFixed(` / `Math.round(` on money (floating-point risk)
  4. Inconsistent API response patterns (5 patterns found in scoping)
  5. Route files NOT using the unified `apiOk/apiErr` helpers

Usage:
  python3 scripts/ts_health.py            # full report
  python3 scripts/ts_health.py --json     # machine-readable

Exit code 0 always (this is a measurement tool, not a gate — yet).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'

PATTERNS_ANY = {
    ': any (colon-any)': re.compile(r':\s*any\b'),
    'as any (cast)': re.compile(r'\bas\s+any\b'),
    'any[] (array)': re.compile(r'\bany\[\]'),
    '<any> (generic)': re.compile(r'<any>'),
    ': any[ (indexed)': re.compile(r':\s*any\['),
}

PATTERN_TOFIXED = re.compile(r'\.toFixed\(')
PATTERN_MATHROUND = re.compile(r'Math\.round\(')

# API response patterns (from PKG2 scoping)
PATTERN_OK_BARE = re.compile(r"NextResponse\.json\(\{\s*ok:\s*(?:true|false)")
PATTERN_ERROR_NO_SUCCESS = re.compile(r"NextResponse\.json\(\{\s*error:")
PATTERN_RAW_PAYLOAD = re.compile(r"NextResponse\.json\(\{\s*(?:news|items|rows|data):\s")


def count_pattern(files: list[Path], pattern: re.Pattern) -> tuple[int, list[tuple[str, int]]]:
    total = 0
    top: Counter[str] = Counter()
    for f in files:
        try:
            text = f.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        n = len(pattern.findall(text))
        if n:
            total += n
            top[str(f.relative_to(ROOT))] += n
    return total, top.most_common(10)


def gather_ts_files() -> list[Path]:
    files = []
    for ext in ('*.ts', '*.tsx'):
        for f in SRC.rglob(ext):
            if 'node_modules' in f.parts:
                continue
            files.append(f)
    return files


def gather_routes() -> list[Path]:
    api = SRC / 'app' / 'api'
    if not api.exists():
        return []
    return list(api.rglob('route.ts'))


def measure_any(files: list[Path]) -> dict:
    results = {}
    all_files_counter: Counter[str] = Counter()
    total_count = 0
    for label, pat in PATTERNS_ANY.items():
        count, top = count_pattern(files, pat)
        results[label] = {'count': count, 'top_files': top}
        total_count += count
        for fname, n in top:
            all_files_counter[fname] += n
    results['_total_any'] = total_count
    results['_files_using_any'] = len(all_files_counter)
    results['_top_files_overall'] = all_files_counter.most_common(15)
    return results


def measure_floating_point(files: list[Path]) -> dict:
    lib_files = [f for f in files if 'src/lib' in str(f)]
    tofix, tofix_top = count_pattern(lib_files, PATTERN_TOFIXED)
    mround, mround_top = count_pattern(lib_files, PATTERN_MATHROUND)
    return {
        'toFixed_in_lib': tofix,
        'Math.round_in_lib': mround,
        'total_fp_risk': tofix + mround,
        'toFixed_top': tofix_top,
        'Math.round_top': mround_top,
    }


def measure_api_consistency(routes: list[Path]) -> dict:
    ok_bare, _ = count_pattern(routes, PATTERN_OK_BARE)
    err_no_succ, _ = count_pattern(routes, PATTERN_ERROR_NO_SUCCESS)
    # unified helper adoption
    unified = 0
    for r in routes:
        try:
            text = r.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        if 'apiOk' in text or 'apiErr' in text or 'api-response' in text:
            unified += 1
    return {
        'total_routes': len(routes),
        'inconsistent_ok_bare': ok_bare,
        'inconsistent_error_without_success': err_no_succ,
        'unified_helper_adopted': unified,
        'unified_helper_pending': len(routes) - unified,
    }


def run_tsc() -> dict:
    try:
        proc = subprocess.run(
            ['npx', 'tsc', '--noEmit'],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=180,
        )
        out = proc.stdout + proc.stderr
        lines = [l for l in out.splitlines() if l.strip()]
        codes = Counter()
        for line in lines:
            m = re.search(r'error TS(\d+):', line)
            if m:
                codes[f'TS{m.group(1)}'] += 1
        return {
            'total_errors': len([l for l in lines if 'error TS' in l]),
            'top_error_codes': codes.most_common(10),
            'ran': True,
        }
    except subprocess.TimeoutExpired:
        return {'ran': False, 'error': 'tsc timed out after 180s'}
    except Exception as e:
        return {'ran': False, 'error': str(e)}


def main():
    ap = argparse.ArgumentParser(description='Engineering health metric')
    ap.add_argument('--json', action='store_true', help='JSON output')
    ap.add_argument('--no-tsc', action='store_true', help='skip slow tsc check')
    args = ap.parse_args()

    files = gather_ts_files()
    routes = gather_routes()

    report = {
        'ts_files_total': len(files),
        'any_usage': measure_any(files),
        'floating_point_risk': measure_floating_point(files),
        'api_consistency': measure_api_consistency(routes),
    }
    if not args.no_tsc:
        report['tsc'] = run_tsc()

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    print('=' * 60)
    print('  ENGINEERING HEALTH REPORT (PKG2)')
    print('=' * 60)
    print(f'TS/TSX files scanned: {report["ts_files_total"]}')
    print()
    a = report['any_usage']
    print(f'`any` usage — total: {a["_total_any"]} across {a["_files_using_any"]} files')
    for label in PATTERNS_ANY:
        print(f'  {label:25s}: {a[label]["count"]}')
    print('  Top files:')
    for fname, n in a['_top_files_overall'][:10]:
        print(f'    {n:4d}  {fname}')
    print()
    fp = report['floating_point_risk']
    print(f'Floating-point risk in src/lib: {fp["total_fp_risk"]}')
    print(f'  toFixed: {fp["toFixed_in_lib"]}   Math.round: {fp["Math.round_in_lib"]}')
    print()
    ac = report['api_consistency']
    print(f'API routes: {ac["total_routes"]}')
    print(f'  unified helper adopted: {ac["unified_helper_adopted"]}')
    print(f'  pending migration:      {ac["unified_helper_pending"]}')
    print(f'  inconsistent `ok:` pattern: {ac["inconsistent_ok_bare"]}')
    print(f'  error without success:     {ac["inconsistent_error_without_success"]}')
    if 'tsc' in report and report['tsc'].get('ran'):
        t = report['tsc']
        print()
        print(f'tsc --noEmit errors: {t["total_errors"]}')
        for code, n in t.get('top_error_codes', []):
            print(f'  {code}: {n}')
    print('=' * 60)


if __name__ == '__main__':
    main()
