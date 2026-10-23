#!/usr/bin/env python3
"""
check_architecture.py — حارس القواعد المعمارية (Phase 7 — Enforcement)
AST-based scanner that prevents direct sqlite3.connect() usage (Rule 54).
CATEGORY B (direct) = VIOLATION. CATEGORY A (except-block fallback) = WARNING.
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path
from typing import List, Set, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent

WHITELIST: Set[str] = {
    'vps-service/core/db_manager.py',
    'vps-service/core/database.py',
    'vps-service/lightweight_server.py',
    'vps-service/core/migrator.py',
    'vps-service/jobs/wal_checkpoint.py',
    'scripts/check_db_schema.py',  # schema checker (needs raw sqlite3 for PRAGMA)
}

SKIP_DIRS: Set[str] = {
    'archive', 'garage', '__pycache__', 'node_modules',
    '.git', '.next', 'venv', 'env', '.venv', 'backups',
    '.zscripts', 'data_engine', 'news-agent',
}

SCAN_EXTENSIONS: Set[str] = {'.py'}


class SqliteConnectVisitor(ast.NodeVisitor):
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.violations: List[Tuple[int, str]] = []
        self.warnings: List[Tuple[int, str]] = []
        self._is_whitelisted = self._compute_whitelist()
        self._except_depth = 0

    def _compute_whitelist(self) -> bool:
        rel = os.path.relpath(self.filepath, PROJECT_ROOT).replace('\\', '/')
        if rel in WHITELIST:
            return True
        base = os.path.basename(self.filepath)
        return base in ('db_manager.py', 'database.py')

    def visit_ExceptHandler(self, node):
        self._except_depth += 1
        self.generic_visit(node)
        self._except_depth -= 1

    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute):
            if isinstance(node.func.value, ast.Name):
                if node.func.value.id in ('sqlite3', '_sqlite3') and node.func.attr == 'connect':
                    if not self._is_whitelisted:
                        msg = f"{node.func.value.id}.connect() direct call — use db_manager instead"
                        if self._except_depth > 0:
                            self.warnings.append((node.lineno, msg + " [CATEGORY A — fallback, allowed]"))
                        else:
                            self.violations.append((node.lineno, msg + " [CATEGORY B — direct, must migrate]"))
        self.generic_visit(node)

    def visit_Assign(self, node):
        for target in node.targets:
            if (isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == 'sqlite3'
                    and target.attr == 'connect'):
                if not self._is_whitelisted:
                    self.warnings.append(
                        (node.lineno, "sqlite3.connect = ... (monkey-patch WAL enforcement) — allowed [CATEGORY A]")
                    )
        self.generic_visit(node)


def scan_file(filepath: str):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            source = f.read()
    except (IOError, OSError):
        return ([], [])
    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError:
        return ([], [])
    visitor = SqliteConnectVisitor(filepath)
    visitor.visit(tree)
    return (visitor.violations, visitor.warnings)


def should_skip(path: Path) -> bool:
    for skip in SKIP_DIRS:
        if skip in str(path):
            return True
    return False


def scan_directory(root: Path):
    all_violations = []
    all_warnings = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            ext = os.path.splitext(fname)[1]
            if ext not in SCAN_EXTENSIONS:
                continue
            fpath = os.path.join(dirpath, fname)
            if should_skip(Path(fpath)):
                continue
            v, w = scan_file(fpath)
            for lineno, msg in v:
                all_violations.append((fpath, lineno, msg))
            for lineno, msg in w:
                all_warnings.append((fpath, lineno, msg))
    return (all_violations, all_warnings)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Architecture guard — prevents direct sqlite3.connect() (Rule 54)')
    parser.add_argument('--strict', action='store_true', help='Exit(1) if any violation found')
    parser.add_argument('--file', type=str, default=None, help='Scan a single file')
    parser.add_argument('--quiet', action='store_true', help='Suppress CATEGORY A warnings')
    args = parser.parse_args()

    print("=" * 70)
    print("  Architecture Guard — Rule 54 Enforcement (Phase 7)")
    print("=" * 70)
    print()

    if args.file:
        if not os.path.exists(args.file):
            print(f"ERROR File not found: {args.file}")
            return 2
        v, w = scan_file(args.file)
        if not v and not w:
            print(f"OK {args.file}: CLEAN")
            return 0
        if v:
            print(f"FAIL {args.file}: {len(v)} violation(s):")
            for lineno, msg in v:
                print(f"   line {lineno}: {msg}")
        if w and not args.quiet:
            print(f"WARN {args.file}: {len(w)} warning(s) [CATEGORY A — allowed]:")
            for lineno, msg in w:
                print(f"   line {lineno}: {msg}")
        return 1 if (v and args.strict) else 0

    scan_paths = [PROJECT_ROOT / 'vps-service', PROJECT_ROOT / 'scripts']
    total_files = 0
    all_v = []
    all_w = []
    for sr in scan_paths:
        if not sr.exists():
            continue
        print(f"Scanning: {sr}")
        v, w = scan_directory(sr)
        all_v.extend(v)
        all_w.extend(w)

    for sr in scan_paths:
        if not sr.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(sr):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fname in filenames:
                if os.path.splitext(fname)[1] in SCAN_EXTENSIONS:
                    total_files += 1

    print()
    print(f"  Files scanned:    {total_files}")
    print(f"  Violations (B):   {len(all_v)}")
    print(f"  Warnings (A):     {len(all_w)}")
    print()

    if all_v:
        print("FAIL CATEGORY B violations found (Rule 54 breached):")
        by_file = {}
        for fpath, lineno, msg in all_v:
            by_file.setdefault(fpath, []).append((lineno, msg))
        for fpath, vlist in sorted(by_file.items()):
            rel = os.path.relpath(fpath, PROJECT_ROOT)
            print(f"\n  {rel}:")
            for lineno, msg in vlist:
                print(f"     line {lineno}: {msg}")
        print()
        print("  FIX: from core.db_manager import db_manager; conn = db_manager.connection(path, writable=False).__enter__()")
        if args.strict:
            print("\n  CI FAIL: architecture violations detected")
            return 1
        return 0
    else:
        print("OK Architecture is CLEAN — 0 CATEGORY B violations.")
        print(f"   {len(all_w)} CATEGORY A fallbacks preserved (safety nets).")
        return 0


if __name__ == '__main__':
    sys.exit(main())
