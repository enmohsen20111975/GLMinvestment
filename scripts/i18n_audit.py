#!/usr/bin/env python3
"""
i18n_audit.py — Bilingual Coverage Audit (PKG1 — Full Bilingual 100%)
=======================================================================
Scans the TS/TSX codebase for HARDCODED UI strings that bypass the `t()`
i18n hook, so progress on Package 1 ("صفر نصوص ثابتة") is trackable.

What it flags:
  1. Arabic script (U+0600–U+06FF) inside JSX text / string literals /
     aria-label / title / placeholder attributes — anywhere `t(` is NOT
     used in the same file (or where the string isn't already passed via t()).
  2. Missing-translation-key console warnings (runtime — not covered here,
     see the t() fallback dev warnings instead).
  3. Key-parity check between messages/ar.json and messages/en.json.

Output:
  - Per-file count of hardcoded Arabic lines.
  - Top 20 worst offenders.
  - Recharts files lacking RTL direction support.
  - Key parity status.

Usage:
  python3 scripts/i18n_audit.py            # human report
  python3 scripts/i18n_audit.py --json     # machine-readable

Exit code 0 always (measurement tool; will become a gate later).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
MESSAGES = ROOT / 'messages'

ARABIC_RE = re.compile(r'[\u0600-\u06FF]')
# attributes that often hold user-visible hardcoded text
ATTR_RE = re.compile(
    r'(?:aria-label|title|placeholder|alt|label)\s*=\s*"([^"]*[\u0600-\u06FF][^"]*)"'
)
# JSX text between > and < containing Arabic
JSX_TEXT_RE = re.compile(r'>\s*([^<>{]*[\u0600-\u06FF][^<{}]*)\s*<')
# string literal containing Arabic
STR_LIT_RE = re.compile(r'["\'`]([^"\'`]*[\u0600-\u06FF][^"\'`]*)["\'`]')


def scan_file(path: Path) -> dict:
    try:
        text = path.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return {'arabic_lines': 0, 'attrs': 0, 'jsx_text': 0, 'str_lit': 0}
    uses_t = bool(re.search(r'\bt\(|useTranslations', text))
    lines = text.splitlines()
    arabic_lines = sum(1 for ln in lines if ARABIC_RE.search(ln))
    attrs = len(ATTR_RE.findall(text))
    jsx = len(JSX_TEXT_RE.findall(text))
    strl = len(STR_LIT_RE.findall(text))
    return {
        'arabic_lines': arabic_lines,
        'attrs': attrs,
        'jsx_text': jsx,
        'str_lit': strl,
        'uses_t': uses_t,
        'hardcoded_estimate': attrs + jsx + strl,
    }


def gather() -> list[Path]:
    out = []
    for ext in ('*.ts', '*.tsx'):
        for f in SRC.rglob(ext):
            if 'node_modules' in f.parts:
                continue
            out.append(f)
    return out


def key_parity() -> dict:
    import importlib.util
    ar_p = MESSAGES / 'ar.json'
    en_p = MESSAGES / 'en.json'
    if not ar_p.exists() or not en_p.exists():
        return {'ok': False, 'reason': 'missing messages files'}

    def flat(d, p=''):
        o = {}
        for k, v in d.items():
            kk = f'{p}.{k}' if p else k
            if isinstance(v, dict):
                o.update(flat(v, kk))
            else:
                o[kk] = v
        return o

    ar = flat(json.loads(ar_p.read_text(encoding='utf-8')))
    en = flat(json.loads(en_p.read_text(encoding='utf-8')))
    miss_en = set(ar) - set(en)
    miss_ar = set(en) - set(ar)
    empty_ar = [k for k, v in ar.items() if not str(v).strip()]
    empty_en = [k for k, v in en.items() if not str(v).strip()]
    return {
        'ok': True,
        'ar_keys': len(ar),
        'en_keys': len(en),
        'missing_in_en': len(miss_en),
        'missing_in_ar': len(miss_ar),
        'empty_ar': len(empty_ar),
        'empty_en': len(empty_en),
    }


def main():
    ap = argparse.ArgumentParser(description='i18n bilingual coverage audit')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    files = gather()
    per_file = {}
    for f in files:
        r = scan_file(f)
        if r['arabic_lines'] > 0 or r['hardcoded_estimate'] > 0:
            per_file[str(f.relative_to(ROOT))] = r

    total_arabic_lines = sum(r['arabic_lines'] for r in per_file.values())
    total_hardcoded = sum(r['hardcoded_estimate'] for r in per_file.values())
    files_with_t = sum(1 for r in per_file.values() if r['uses_t'])
    files_without_t = len(per_file) - files_with_t

    # Recharts files
    recharts_files = []
    for f in files:
        try:
            txt = f.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        if 'recharts' in txt.lower() or 'from "recharts"' in txt:
            has_rtl = bool(re.search(r'direction\s*=\s*["\']rtl', txt)) or bool(
                re.search(r'reversed', txt)
            )
            recharts_files.append({
                'file': str(f.relative_to(ROOT)),
                'rtl_aware': has_rtl,
            })

    report = {
        'ts_files_scanned': len(files),
        'files_with_hardcoded_arabic': len(per_file),
        'total_arabic_lines': total_arabic_lines,
        'estimated_hardcoded_occurrences': total_hardcoded,
        'files_using_t_hook': files_with_t,
        'files_not_using_t_hook': files_without_t,
        'recharts_components': {
            'total': len(recharts_files),
            'rtl_aware': sum(1 for r in recharts_files if r['rtl_aware']),
            'rtl_missing': sum(1 for r in recharts_files if not r['rtl_aware']),
        },
        'key_parity': key_parity(),
        'top_offenders': sorted(
            [(k, v['hardcoded_estimate']) for k, v in per_file.items()],
            key=lambda x: -x[1],
        )[:20],
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    print('=' * 60)
    print('  BILINGUAL COVERAGE AUDIT (PKG1)')
    print('=' * 60)
    print(f'TS/TSX files scanned: {report["ts_files_scanned"]}')
    print(f'Files w/ hardcoded Arabic: {report["files_with_hardcoded_arabic"]}')
    print(f'Total Arabic-bearing lines: {report["total_arabic_lines"]}')
    print(f'Estimated hardcoded occurrences: {report["estimated_hardcoded_occurrences"]}')
    print(f'Files using t() hook: {report["files_using_t_hook"]}')
    print(f'Files NOT using t() hook: {report["files_not_using_t_hook"]}')
    print()
    rc = report['recharts_components']
    print(f'Recharts components: {rc["total"]} total')
    print(f'  RTL-aware:  {rc["rtl_aware"]}')
    print(f'  RTL missing: {rc["rtl_missing"]}')
    print()
    kp = report['key_parity']
    if kp.get('ok'):
        print(f'Key parity: ar={kp["ar_keys"]} en={kp["en_keys"]} '
              f'missing_en={kp["missing_in_en"]} missing_ar={kp["missing_in_ar"]} '
              f'empty_ar={kp["empty_ar"]} empty_en={kp["empty_en"]}')
    print()
    print('Top 20 offenders (estimated hardcoded occurrences):')
    for fname, n in report['top_offenders']:
        print(f'  {n:5d}  {fname}')
    print('=' * 60)


if __name__ == '__main__':
    main()
