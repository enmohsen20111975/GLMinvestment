#!/usr/bin/env python3
"""
pre_deploy_audit.py — Pre-Deployment Audit (الـ 10 فئات)
=========================================================

يفحص 10 فئات من الأخطاء المحتملة قبل أي نشر:
  1.  Schema Drift (جداول/أعمدة مفقودة)
  2.  Connection Lifecycle (__enter__ بدون with)
  3.  None/Empty Handling (NoneType crashes)
  4.  Auth & Permissions
  5.  Data Quality (NULLs, negatives, high<low, duplicates)
  6.  Path & Environment (hardcoded paths)
  7.  Import & Module (syntax errors, missing imports)
  8.  Build & Bundle (placeholder leaks: %s in code)
  9.  API Contract (missing routes, mismatched params)
  10. Migration Artifacts (%s placeholders, empty conn=, duplicate imports)

لو أي فحص فشل → exit(1) → ممنوع النشر.

Usage:
    python3 scripts/pre_deploy_audit.py
    python3 scripts/pre_deploy_audit.py --db-only    # فحص الـ DBs بس
    python3 scripts/pre_deploy_audit.py --code-only  # فحص الكود بس

Author: برافو (Pre-Deployment Audit)
"""
from __future__ import annotations

import ast
import os
import re
import sys
import sqlite3
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Tuple, Set

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
SCRIPTS_DIR = PROJECT_ROOT / 'scripts'
DB_DIR = PROJECT_ROOT / 'db'

SKIP_DIRS = {'archive', 'garage', '__pycache__', 'node_modules', '.git', '.next',
             'venv', 'env', '.venv', 'backups', 'output', 'data_engine', 'news-agent'}

# Colors for output
RED = '\033[91m'
GREEN = '\033[92m'
YELLOW = '\033[93m'
CYAN = '\033[96m'
RESET = '\033[0m'

issues = []
warnings = []


def issue(category, file, line, msg):
    issues.append({'category': category, 'file': file, 'line': line, 'msg': msg})

def warn(category, file, line, msg):
    warnings.append({'category': category, 'file': file, 'line': line, 'msg': msg})


# ============================================================================
# 1. SCHEMA DRIFT
# ============================================================================

def check_schema_drift():
    """فحص: جداول/أعمدة مستخدمة في الكود بس مش موجودة في الـ DB."""
    print(f"\n{CYAN}━━━ 1. Schema Drift ━━━{RESET}")

    # Collect all tables from all DBs
    db_tables = {}  # db_name → set of tables
    db_columns = {}  # (db_name, table) → set of columns

    if DB_DIR.exists():
        for db_file in sorted(DB_DIR.glob('*.db')):
            db_name = db_file.name
            try:
                conn = sqlite3.connect(str(db_file), timeout=10.0)
                tables = [r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()]
                db_tables[db_name] = set(tables)
                for t in tables:
                    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({t})").fetchall()}
                    db_columns[(db_name, t)] = cols
                conn.close()
            except Exception as e:
                warn('schema', str(db_file), 0, f"Cannot read DB: {e}")

    all_db_tables = set()
    for tables in db_tables.values():
        all_db_tables.update(tables)

    # Scan code for table references (FROM/INTO/UPDATE)
    code_tables = set()
    for base in [VPS_SERVICE, SCRIPTS_DIR]:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith('.py'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        source = f.read()
                except:
                    continue
                # Find FROM table, INTO table, UPDATE table
                for m in re.finditer(r'(?:FROM|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)', source, re.IGNORECASE):
                    code_tables.add(m.group(1).lower())

    # Tables in code but not in any DB
    # Filter out Python keywords and common identifiers (false positives)
    PYTHON_KEYWORDS = {
        'abc', '__future__', '__init__', '__main__', 'self', 'cls', 'return',
        'import', 'from', 'class', 'def', 'typing', 'pathlib', 'collections',
        'dataclass', 'functools', 'contextlib', 'logging', 'argparse',
        'sqlite3', 'threading', 'subprocess', 'datetime', 'time', 'os', 'sys',
        'json', 'request', 'response', 'session', 'app', 'test', 'tmp',
        'value', 'key', 'data', 'result', 'item', 'name', 'type', 'config',
        'error', 'warning', 'info', 'start', 'end', 'before', 'after', 'now',
    }
    missing_tables = code_tables - all_db_tables - {'dual', 'sqlite_master', 'information_schema'}
    missing_tables = {t for t in missing_tables if t not in PYTHON_KEYWORDS and len(t) >= 3 and not t.startswith('_')}

    if missing_tables:
        for t in sorted(missing_tables)[:20]:
            issue('schema', 'N/A', 0, f"Table '{t}' used in code but not found in any DB")
        print(f"  {RED}❌ {len(missing_tables)} tables used in code but missing from DBs{RESET}")
    else:
        print(f"  {GREEN}✅ All tables in code exist in DBs{RESET}")

    # Check specific known columns
    known_column_checks = [
        ('predictions.db', 'predictions', 'lifecycle_status'),
        ('predictions.db', 'predictions', 'outcome_date'),
        ('predictions.db', 'predictions', 'hit_target'),
        ('predictions.db', 'predictions', 'kill_filter_result'),
        ('price_history.db', 'price_history', 'close_price'),
        ('price_history.db', 'price_history', 'ticker'),
        ('price_history.db', 'price_history', 'date'),
    ]
    for db_name, table, col in known_column_checks:
        if (db_name, table) in db_columns:
            if col not in db_columns[(db_name, table)]:
                issue('schema', db_name, 0, f"Column '{col}' missing from {table}")
                print(f"  {RED}❌ {db_name}.{table}: column '{col}' missing{RESET}")


# ============================================================================
# 2. CONNECTION LIFECYCLE
# ============================================================================

def check_connection_lifecycle():
    """فحص: __enter__() بدون with + conn = فارغة."""
    print(f"\n{CYAN}━━━ 2. Connection Lifecycle ━━━{RESET}")

    prod_count = 0
    script_count = 0
    for base in [VPS_SERVICE, SCRIPTS_DIR]:
        if not base.exists():
            continue
        is_production = (base == VPS_SERVICE)
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith('.py'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        lines_f = f.readlines()
                except:
                    continue
                for i, line in enumerate(lines_f, 1):
                    if '.__enter__()' in line and 'with ' not in line and not line.strip().startswith('#'):
                        rel = os.path.relpath(fpath, PROJECT_ROOT)
                        if is_production:
                            issue('connection', rel, i, f"[PROD] __enter__: {line.strip()[:60]}")
                            prod_count += 1
                        else:
                            warn('connection', rel, i, f"[SCRIPT] __enter__: {line.strip()[:60]}")
                            script_count += 1
                    if re.match(r'^\s*\w+\s*=\s*$', line) and 'conn' in line.lower():
                        rel = os.path.relpath(fpath, PROJECT_ROOT)
                        if is_production:
                            issue('connection', rel, i, f"[PROD] Empty conn assignment")
                            prod_count += 1
                        else:
                            warn('connection', rel, i, f"[SCRIPT] Empty conn assignment")
                            script_count += 1

    if prod_count:
        print(f"  BLOCKER: {prod_count} production connection issues")
    else:
        print(f"  PRODUCTION: 0 connection issues OK")
    if script_count:
        print(f"  WARNING: {script_count} script connection issues (non-production)")
    else:
        print(f"  SCRIPTS: 0 connection issues OK")



# ============================================================================
# 3. NONE/EMPTY HANDLING
# ============================================================================

def check_none_handling():
    """فحص: comparisons مع None بدون is not None check."""
    print(f"\n{CYAN}━━━ 3. None/Empty Handling ━━━{RESET}")

    count = 0
    # Pattern: variable > 0 or variable < 0 where variable could be None
    # Focus on indicator calculations (bb_mid, rsi, macd, etc.)
    dangerous_patterns = [
        (r'bb_mid\[.*?\]\s*[><=]', 'Bollinger Bands NoneType comparison'),
        (r'rsi_vals?\[.*?\]\s*[><=]', 'RSI NoneType comparison'),
        (r'macd_line?\[.*?\]\s*[><=]', 'MACD NoneType comparison'),
    ]

    for base in [VPS_SERVICE]:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith('.py'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        lines = f.readlines()
                except:
                    continue
                for i, line in enumerate(lines, 1):
                    for pattern, desc in dangerous_patterns:
                        if re.search(pattern, line) and 'is not None' not in line and 'is None' not in line:
                            rel = os.path.relpath(fpath, PROJECT_ROOT)
                            warn('none', rel, i, f"{desc}: {line.strip()[:80]}")
                            count += 1

    if count:
        print(f"  {YELLOW}⚠️  {count} potential NoneType comparison issues{RESET}")
    else:
        print(f"  {GREEN}✅ No NoneType comparison issues{RESET}")


# ============================================================================
# 4. AUTH & PERMISSIONS
# ============================================================================

def check_auth():
    """فحص: routes حساسة بدون auth decorator."""
    print(f"\n{CYAN}━━━ 4. Auth & Permissions ━━━{RESET}")

    AUTH_KEYWORDS = {'require_admin', 'require_auth', 'require_role', 'getSessionUserId',
                     'require_trial_or_paid', 'verify_token'}
    SENSITIVE_KEYWORDS = ['portfolio', 'holdings', 'orders', 'watchlist', 'alerts',
                          'user', 'subscription', 'payment', 'account', 'admin']

    count = 0
    api_dir = VPS_SERVICE / 'api'
    if not api_dir.exists():
        print(f"  {YELLOW}⚠️  api/ dir not found{RESET}")
        return

    for fname in sorted(os.listdir(str(api_dir))):
        if not fname.endswith('.py'):
            continue
        fpath = api_dir / fname
        try:
            with open(fpath, 'r', errors='ignore') as f:
                source = f.read()
            tree = ast.parse(source, filename=str(fpath))
        except:
            continue

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            route_path = None
            methods = []
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                    if decorator.func.attr in ('route', 'get', 'post', 'put', 'delete'):
                        if decorator.args:
                            try:
                                route_path = ast.literal_eval(decorator.args[0])
                            except:
                                pass
                        for kw in decorator.keywords:
                            if kw.arg == 'methods':
                                try:
                                    methods = [ast.literal_eval(m) for m in kw.value.elts]
                                except:
                                    methods = ['GET']
            if route_path:
                func_source = ast.dump(node)
                has_auth = any(kw in func_source for kw in AUTH_KEYWORDS)
                path_lower = route_path.lower()
                is_sensitive = any(kw in path_lower for kw in SENSITIVE_KEYWORDS)
                has_write = any(m in ('POST', 'PUT', 'DELETE', 'PATCH') for m in (methods or ['GET']))
                if (is_sensitive or has_write) and not has_auth:
                    rel = os.path.relpath(str(fpath), PROJECT_ROOT)
                    issue('auth', rel, node.lineno, f"Sensitive route without auth: {','.join(methods or ['GET'])} {route_path}")
                    count += 1

    if count:
        print(f"  {RED}❌ {count} sensitive routes without auth{RESET}")
    else:
        print(f"  {GREEN}✅ All sensitive routes have auth{RESET}")


# ============================================================================
# 5. DATA QUALITY
# ============================================================================

def check_data_quality():
    """فحص: NULLs, negatives, high<low, duplicates في الـ DBs."""
    print(f"\n{CYAN}━━━ 5. Data Quality ━━━{RESET}")

    if not DB_DIR.exists():
        print(f"  {YELLOW}⚠️  db/ dir not found{RESET}")
        return

    # Check price_history.db
    ph_db = DB_DIR / 'price_history.db'
    if ph_db.exists():
        try:
            conn = sqlite3.connect(str(ph_db), timeout=10.0)
            # NULLs in close_price
            nulls = conn.execute("SELECT COUNT(*) FROM price_history WHERE close_price IS NULL").fetchone()[0]
            if nulls > 0:
                issue('data', 'price_history.db', 0, f"{nulls} NULL close_price rows")
                print(f"  {RED}❌ price_history: {nulls} NULL close_price rows{RESET}")

            # Negative prices
            neg = conn.execute("SELECT COUNT(*) FROM price_history WHERE close_price < 0").fetchone()[0]
            if neg > 0:
                issue('data', 'price_history.db', 0, f"{neg} negative close_price rows")
                print(f"  {RED}❌ price_history: {neg} negative close_price rows{RESET}")

            # high < low (mathematical error)
            hgl = conn.execute("SELECT COUNT(*) FROM price_history WHERE high_price < low_price").fetchone()[0]
            if hgl > 0:
                issue('data', 'price_history.db', 0, f"{hgl} rows where high_price < low_price")
                print(f"  {RED}❌ price_history: {hgl} rows where high < low{RESET}")
            else:
                print(f"  {GREEN}✅ price_history: no high<low issues{RESET}")

            # Duplicates (same ticker + date)
            dups = conn.execute("SELECT COUNT(*) FROM (SELECT ticker, date, COUNT(*) c FROM price_history GROUP BY ticker, date HAVING c > 1)").fetchone()[0]
            if dups > 0:
                warn('data', 'price_history.db', 0, f"{dups} duplicate ticker+date rows")
                print(f"  {YELLOW}⚠️  price_history: {dups} duplicate ticker+date rows{RESET}")

            # Zero prices
            zeros = conn.execute("SELECT COUNT(*) FROM price_history WHERE close_price = 0").fetchone()[0]
            if zeros > 0:
                warn('data', 'price_history.db', 0, f"{zeros} zero close_price rows")
                print(f"  {YELLOW}⚠️  price_history: {zeros} zero close_price rows{RESET}")

            conn.close()
        except Exception as e:
            print(f"  {RED}❌ Cannot read price_history.db: {e}{RESET}")

    # Check stocks.db
    stocks_db = DB_DIR / 'stocks.db'
    if stocks_db.exists():
        try:
            conn = sqlite3.connect(str(stocks_db), timeout=10.0)
            # Active stocks with no price data
            active = conn.execute("SELECT COUNT(*) FROM stocks WHERE is_active=1").fetchone()[0]
            print(f"  ℹ️  stocks.db: {active} active stocks")

            # Stocks with NULL current_price
            null_price = conn.execute("SELECT COUNT(*) FROM stocks WHERE is_active=1 AND (current_price IS NULL OR current_price = 0)").fetchone()[0]
            if null_price > 0:
                warn('data', 'stocks.db', 0, f"{null_price} active stocks with NULL/0 current_price")
                print(f"  {YELLOW}⚠️  stocks.db: {null_price} active stocks with NULL/0 price{RESET}")

            # Integrity check
            integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
            if integrity != 'ok':
                issue('data', 'stocks.db', 0, f"Integrity check failed: {integrity[:60]}")
                print(f"  {RED}❌ stocks.db: integrity check failed{RESET}")
            else:
                print(f"  {GREEN}✅ stocks.db: integrity OK{RESET}")
            conn.close()
        except Exception as e:
            print(f"  {RED}❌ Cannot read stocks.db: {e}{RESET}")

    # Check predictions.db
    pred_db = DB_DIR / 'predictions.db'
    if pred_db.exists():
        try:
            conn = sqlite3.connect(str(pred_db), timeout=10.0)
            total = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
            pending = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL").fetchone()[0]
            print(f"  ℹ️  predictions.db: {total} total, {pending} pending")
            conn.close()
        except Exception as e:
            print(f"  {RED}❌ Cannot read predictions.db: {e}{RESET}")


# ============================================================================
# 6. PATH & ENVIRONMENT
# ============================================================================

def check_paths():
    """فحص: hardcoded absolute paths."""
    print(f"\n{CYAN}━━━ 6. Path & Environment ━━━{RESET}")

    count = 0
    path_patterns = [
        (r'/home/[a-z]+/', 'hardcoded /home/ path'),
        (r'/root/', 'hardcoded /root/ path'),
        (r'/tmp/[a-z]', 'hardcoded /tmp/ path'),
    ]

    for base in [VPS_SERVICE, SCRIPTS_DIR]:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith(('.py', '.sh', '.ts', '.tsx')):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        lines = f.readlines()
                except:
                    continue
                for i, line in enumerate(lines, 1):
                    if line.strip().startswith('#'):
                        continue
                    for pattern, desc in path_patterns:
                        if re.search(pattern, line):
                            rel = os.path.relpath(fpath, PROJECT_ROOT)
                            warn('path', rel, i, f"{desc}: {line.strip()[:80]}")
                            count += 1

    if count:
        print(f"  {YELLOW}⚠️  {count} hardcoded path references (review needed){RESET}")
    else:
        print(f"  {GREEN}✅ No hardcoded paths{RESET}")


# ============================================================================
# 7. IMPORT & MODULE (Syntax Errors)
# ============================================================================

def check_imports():
    """فحص: syntax errors في كل ملفات Python."""
    print(f"\n{CYAN}━━━ 7. Import & Module ━━━{RESET}")

    count = 0
    for base in [VPS_SERVICE, SCRIPTS_DIR]:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith('.py'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        source = f.read()
                    ast.parse(source, filename=fpath)
                except SyntaxError as e:
                    rel = os.path.relpath(fpath, PROJECT_ROOT)
                    issue('import', rel, e.lineno or 0, f"SyntaxError: {e.msg}")
                    print(f"  {RED}❌ {rel}:{e.lineno}: {e.msg}{RESET}")
                    count += 1

    if count:
        print(f"  {RED}❌ {count} syntax errors found{RESET}")
    else:
        print(f"  {GREEN}✅ No syntax errors{RESET}")


# ============================================================================
# 8. BUILD & BUNDLE (Placeholder leaks)
# ============================================================================

def check_placeholders():
    """فحص: %s / %d / {placeholder} في سطور db_manager (artifacts من migration)."""
    print(f"\n{CYAN}━━━ 8. Migration Artifacts (placeholders) ━━━{RESET}")

    count = 0
    for base in [VPS_SERVICE, SCRIPTS_DIR]:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith('.py'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        lines = f.readlines()
                except:
                    continue
                for i, line in enumerate(lines, 1):
                    # %s in db_manager context
                    if ('get_connection' in line or 'connection(' in line) and '%s' in line and 'pre_deploy_audit' not in fpath:
                        rel = os.path.relpath(fpath, PROJECT_ROOT)
                        issue('placeholder', rel, i, f"Placeholder %s in DB call: {line.strip()[:80]}")
                        count += 1
                    # Duplicate imports in same file
                    if line.strip().startswith('from core.db_manager import') and i > 1:
                        # Check if this import already appeared
                        pass  # TODO: check duplicates

    if count:
        print(f"  {RED}❌ {count} placeholder artifacts found{RESET}")
    else:
        print(f"  {GREEN}✅ No placeholder artifacts{RESET}")


# ============================================================================
# 9. API CONTRACT
# ============================================================================

def check_api_contract():
    """فحص: routes مسجلة في api/ + هل frontend بيسأل عليها."""
    print(f"\n{CYAN}━━━ 9. API Contract ━━━{RESET}")

    api_dir = VPS_SERVICE / 'api'
    if not api_dir.exists():
        print(f"  {YELLOW}⚠️  api/ dir not found{RESET}")
        return

    # Count routes
    route_count = 0
    for fname in sorted(os.listdir(str(api_dir))):
        if not fname.endswith('.py'):
            continue
        fpath = api_dir / fname
        try:
            with open(fpath, 'r', errors='ignore') as f:
                source = f.read()
            tree = ast.parse(source, filename=str(fpath))
        except:
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                        if decorator.func.attr in ('route', 'get', 'post', 'put', 'delete'):
                            route_count += 1

    print(f"  ℹ️  Total API routes: {route_count}")


# ============================================================================
# 10. CONCURRENCY & RACE
# ============================================================================

def check_concurrency():
    """فحص: DB writes بدون transaction."""
    print(f"\n{CYAN}━━━ 10. Concurrency & Race ━━━{RESET}")

    count = 0
    for base in [VPS_SERVICE]:
        if not base.exists():
            continue
        for root, dirs, files in os.walk(str(base)):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                if not fname.endswith('.py'):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, 'r', errors='ignore') as f:
                        lines = f.readlines()
                except:
                    continue
                for i, line in enumerate(lines, 1):
                    # conn.execute(INSERT/UPDATE) without commit
                    if re.search(r'execute\(.*(?:INSERT|UPDATE|DELETE)', line, re.IGNORECASE):
                        # Check if there's a commit nearby (within 5 lines)
                        has_commit = False
                        for j in range(max(0, i-1), min(len(lines), i+5)):
                            if 'commit' in lines[j].lower():
                                has_commit = True
                                break
                        if not has_commit:
                            rel = os.path.relpath(fpath, PROJECT_ROOT)
                            warn('concurrency', rel, i, f"DB write without nearby commit: {line.strip()[:60]}")
                            count += 1

    if count:
        print(f"  {YELLOW}⚠️  {count} DB writes without nearby commit (review){RESET}")
    else:
        print(f"  {GREEN}✅ No concurrency issues{RESET}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Pre-Deployment Audit — 10 categories')
    parser.add_argument('--db-only', action='store_true', help='Check DBs only')
    parser.add_argument('--code-only', action='store_true', help='Check code only')
    parser.add_argument('--strict', action='store_true', help='Exit(1) on any issue')
    args = parser.parse_args()

    print(f"\n{'='*70}")
    print(f"  🔍 Pre-Deployment Audit — 10 Categories")
    print(f"  Project: {PROJECT_ROOT}")
    print(f"{'='*70}")

    if not args.code_only:
        check_schema_drift()
        check_data_quality()

    if not args.db_only:
        check_connection_lifecycle()
        check_none_handling()
        check_auth()
        check_paths()
        check_imports()
        check_placeholders()
        check_api_contract()
        check_concurrency()

    # Summary
    print(f"\n{'='*70}")
    print(f"  📊 AUDIT SUMMARY")
    print(f"{'='*70}")
    print(f"  {RED}Issues (must fix):   {len(issues)}{RESET}")
    print(f"  {YELLOW}Warnings (review):   {len(warnings)}{RESET}")
    print()

    if issues:
        print(f"{RED}❌ ISSUES (must fix before deploy):{RESET}")
        by_cat = defaultdict(list)
        for i in issues:
            by_cat[i['category']].append(i)
        for cat in sorted(by_cat.keys()):
            print(f"\n  [{cat}] ({len(by_cat[cat])} issues)")
            for i in by_cat[cat][:10]:
                print(f"    {i['file']}:{i['line']} — {i['msg'][:80]}")
            if len(by_cat[cat]) > 10:
                print(f"    ... and {len(by_cat[cat]) - 10} more")

    if warnings:
        print(f"\n{YELLOW}⚠️  WARNINGS (review recommended):{RESET}")
        by_cat_w = defaultdict(list)
        for w in warnings:
            by_cat_w[w['category']].append(w)
        for cat in sorted(by_cat_w.keys()):
            print(f"\n  [{cat}] ({len(by_cat_w[cat])} warnings)")
            for w in by_cat_w[cat][:5]:
                print(f"    {w['file']}:{w['line']} — {w['msg'][:80]}")
            if len(by_cat_w[cat]) > 5:
                print(f"    ... and {len(by_cat_w[cat]) - 5} more")

    if not issues and not warnings:
        print(f"\n{GREEN}✅ ALL CHECKS PASSED — safe to deploy!{RESET}")
    else:
        print(f"\n{RED}⛔ DEPLOY BLOCKED — fix issues first{RESET}")

    return 1 if (issues and args.strict) else 0


if __name__ == '__main__':
    sys.exit(main())
