#!/usr/bin/env python3
"""
vps-service/scripts/audit_blueprints.py
========================================
B1.1 — Audit script: finds all defined blueprints + checks registration.

Output: CSV to stdout + JSON report in db/backups/

Usage:
    python3 vps-service/scripts/audit_blueprints.py
"""
import ast
import os
import sys
import json
import re
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
API_DIR = VPS_SERVICE / 'api'
SERVER_FILE = VPS_SERVICE / 'lightweight_server.py'


def find_blueprints_in_file(filepath):
    """Parse a Python file and find all Blueprint() definitions."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read())
    except Exception:
        return []

    blueprints = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and isinstance(node.value, ast.Call):
                    func = node.value.func
                    # Match Blueprint(...)
                    if isinstance(func, ast.Name) and func.id == 'Blueprint':
                        var_name = target.id
                        # Extract blueprint name (first arg)
                        bp_name = '?'
                        if node.value.args:
                            arg = node.value.args[0]
                            if isinstance(arg, ast.Constant):
                                bp_name = arg.value
                        # Extract url_prefix (keyword)
                        url_prefix = '?'
                        for kw in node.value.keywords:
                            if kw.arg == 'url_prefix' and isinstance(kw.value, ast.Constant):
                                url_prefix = kw.value.value
                        blueprints.append({
                            'variable_name': var_name,
                            'blueprint_name': bp_name,
                            'url_prefix': url_prefix,
                            'file': str(filepath.relative_to(PROJECT_ROOT)),
                        })
    return blueprints


def find_registered_blueprints():
    """Parse lightweight_server.py for registered blueprint names."""
    registered = []
    try:
        content = SERVER_FILE.read_text(encoding='utf-8')
        # Match patterns like: ('api.module_name', 'blueprint_name')
        pattern = r"\('api\.[^']+',\s*'([^']+)'\)"
        for match in re.finditer(pattern, content):
            registered.append(match.group(1))
    except Exception:
        pass
    return registered


def main():
    print("=" * 80)
    print("B1.1 — Blueprint Audit")
    print("=" * 80)
    print()

    # 1. Find all defined blueprints
    all_blueprints = []
    for py_file in sorted(API_DIR.glob('*.py')):
        if '__pycache__' in str(py_file):
            continue
        bps = find_blueprints_in_file(py_file)
        all_blueprints.extend(bps)

    print(f"Total blueprints defined: {len(all_blueprints)}")
    print()

    # 2. Find registered blueprints
    registered = find_registered_blueprints()
    print(f"Total blueprints registered in server: {len(registered)}")
    print()

    # 3. Find unregistered
    defined_vars = {bp['variable_name'] for bp in all_blueprints}
    registered_set = set(registered)
    unregistered = defined_vars - registered_set
    registered_not_defined = registered_set - defined_vars

    # 4. Find duplicates (same blueprint_name)
    name_counts = {}
    for bp in all_blueprints:
        name = bp['blueprint_name']
        name_counts.setdefault(name, []).append(bp)
    duplicates = {k: v for k, v in name_counts.items() if len(v) > 1}

    # 5. Print report
    print("--- CSV Output ---")
    print("file,variable_name,blueprint_name,url_prefix,registered")
    for bp in sorted(all_blueprints, key=lambda x: x['file']):
        is_registered = 'YES' if bp['variable_name'] in registered_set else 'NO'
        print(f"{bp['file']},{bp['variable_name']},{bp['blueprint_name']},{bp['url_prefix']},{is_registered}")

    print()
    print("--- Summary ---")
    print(f"  Defined: {len(all_blueprints)}")
    print(f"  Registered: {len(registered)}")
    print(f"  Unregistered: {len(unregistered)}")
    if unregistered:
        print(f"  ⚠️ Unregistered blueprints:")
        for bp in all_blueprints:
            if bp['variable_name'] in unregistered:
                print(f"    ❌ {bp['variable_name']} ({bp['blueprint_name']}) in {bp['file']}")
    print(f"  Registered but not defined (stale): {len(registered_not_defined)}")
    if registered_not_defined:
        for name in registered_not_defined:
            print(f"    ⚠️ {name} (in server but no Blueprint() definition found)")
    print(f"  Duplicate blueprint names: {len(duplicates)}")
    if duplicates:
        for name, bps in duplicates.items():
            print(f"    🔴 '{name}' defined in {len(bps)} files:")
            for bp in bps:
                print(f"      → {bp['file']}")

    # 6. Save JSON report
    report = {
        'timestamp': datetime.now().isoformat(),
        'total_defined': len(all_blueprints),
        'total_registered': len(registered),
        'unregistered': list(unregistered),
        'registered_not_defined': list(registered_not_defined),
        'duplicates': {k: [bp['file'] for bp in v] for k, v in duplicates.items()},
        'blueprints': all_blueprints,
    }
    report_path = PROJECT_ROOT / 'db' / 'backups' / f'blueprint_audit_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n📁 Report saved: {report_path}")

    # Exit code: 0 if all good, 1 if issues found
    if unregistered or duplicates:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
