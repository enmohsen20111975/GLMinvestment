"""
test_architecture.py — Architecture Unit Test (Phase 7 — Enforcement)
"""
from __future__ import annotations

import ast
import os
from pathlib import Path
from typing import List, Tuple

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
SCRIPTS_DIR = PROJECT_ROOT / 'scripts'

WHITELIST = {
    'vps-service/core/db_manager.py',
    'vps-service/core/database.py',
    'vps-service/lightweight_server.py',
    'vps-service/core/migrator.py',
    'vps-service/jobs/wal_checkpoint.py',
    'scripts/check_db_schema.py',
}

SKIP_DIRS = {'archive', 'garage', '__pycache__', 'node_modules', '.git', '.next', 'venv', 'env', '.venv', 'backups', 'output', 'data_engine', 'news-agent', '.zscripts'}


class SqliteConnectDetector(ast.NodeVisitor):
    def __init__(self, filepath):
        self.filepath = filepath
        self.violations = []
        self._is_whitelisted = self._is_in_whitelist(filepath)
        self._except_depth = 0

    def _is_in_whitelist(self, fp):
        rel = os.path.relpath(fp, PROJECT_ROOT).replace('\\', '/')
        if rel in WHITELIST:
            return True
        base = os.path.basename(fp)
        return base in ('db_manager.py', 'database.py')

    def visit_ExceptHandler(self, node):
        self._except_depth += 1
        self.generic_visit(node)
        self._except_depth -= 1

    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute):
            if isinstance(node.func.value, ast.Name):
                if node.func.value.id in ('sqlite3', '_sqlite3') and node.func.attr == 'connect':
                    if not self._is_whitelisted and self._except_depth == 0:
                        self.violations.append((node.lineno, "direct sqlite3.connect()"))
        self.generic_visit(node)


def collect_python_files(root):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            if fname.endswith('.py'):
                files.append(os.path.join(dirpath, fname))
    return files


def find_violations(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            source = f.read()
    except (IOError, OSError):
        return []
    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError:
        return []
    visitor = SqliteConnectDetector(filepath)
    visitor.visit(tree)
    return visitor.violations


class TestArchitectureRule54:
    def test_no_direct_sqlite_connect_in_vps_service(self):
        if not VPS_SERVICE.exists():
            pytest.skip("vps-service/ not found")
        files = collect_python_files(VPS_SERVICE)
        all_violations = []
        for fpath in files:
            for lineno, msg in find_violations(fpath):
                all_violations.append((fpath, lineno, msg))
        if all_violations:
            lines = ["\nCATEGORY B violations:\n"]
            for fpath, lineno, msg in all_violations:
                rel = os.path.relpath(fpath, PROJECT_ROOT)
                lines.append(f"  {rel}:{lineno}: {msg}")
            pytest.fail('\n'.join(lines))

    def test_no_direct_sqlite_connect_in_scripts(self):
        if not SCRIPTS_DIR.exists():
            pytest.skip("scripts/ not found")
        files = collect_python_files(SCRIPTS_DIR)
        all_violations = []
        for fpath in files:
            for lineno, msg in find_violations(fpath):
                all_violations.append((fpath, lineno, msg))
        if all_violations:
            lines = ["\nCATEGORY B violations in scripts/:\n"]
            for fpath, lineno, msg in all_violations:
                rel = os.path.relpath(fpath, PROJECT_ROOT)
                lines.append(f"  {rel}:{lineno}: {msg}")
            pytest.fail('\n'.join(lines))

    def test_db_manager_exists(self):
        db_manager_path = VPS_SERVICE / 'core' / 'db_manager.py'
        assert db_manager_path.exists(), f"db_manager.py not found at {db_manager_path}"

    def test_db_manager_has_query_method(self):
        db_manager_path = VPS_SERVICE / 'core' / 'db_manager.py'
        if not db_manager_path.exists():
            pytest.skip("db_manager.py not found")
        source = db_manager_path.read_text()
        assert 'def query(' in source, "db_manager.query() method not found"
        assert 'def execute(' in source, "db_manager.execute() method not found"
        assert 'def connection(' in source, "db_manager.connection() context manager not found"

    def test_db_manager_singleton(self):
        db_manager_path = VPS_SERVICE / 'core' / 'db_manager.py'
        if not db_manager_path.exists():
            pytest.skip("db_manager.py not found")
        source = db_manager_path.read_text()
        assert '_instance' in source or '__new__' in source, "db_manager should be a singleton"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
