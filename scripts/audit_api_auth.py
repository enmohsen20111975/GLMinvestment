#!/usr/bin/env python3
"""
audit_api_auth.py — فحص أمان الـ API routes (Phase 9.2 — Security Audit)
=========================================================================

الـ script ده بيفحص كل `@bp.route` + `@app.route` في api/ وبيصنفهم:
  - Public: مسموح للكل (بدون auth)
  - User: بيحتاج session (getSessionUserId)
  - Admin: بيحتاج admin privileges
  - SENSITIVE: بيعدل بيانات محفظة/مستخدمين + محتاج auth

بيطلع تقرير: Route | Method | Auth Decorator | Category | Risk Level

Usage:
    python3 scripts/audit_api_auth.py
    python3 scripts/audit_api_auth.py --strict   # exit(1) لو فيه SENSITIVE بدون auth

Author: برافو (Phase 9.2 — API Security Audit)
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path
from typing import List, Dict, Tuple, Set
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_DIR = PROJECT_ROOT / 'vps-service' / 'api'

# Keywords that indicate auth decorators
AUTH_KEYWORDS = {
    'getSessionUserId', 'require_auth', 'require_admin', '@login_required',
    'get_session_user', 'authenticate', 'authorize', 'check_access',
    'require_subscription', 'check_subscription',
}

# Keywords that indicate sensitive operations (modify data)
SENSITIVE_KEYWORDS = {
    'POST': ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'],
    'PUT': ['UPDATE', 'INSERT'],
    'DELETE': ['DELETE'],
}

# Keywords that indicate portfolio/user data modification
PORTFOLIO_KEYWORDS = ['portfolio', 'holdings', 'positions', 'orders', 'watchlist',
                     'alerts', 'user', 'subscription', 'payment', 'account']

# Public routes (no auth needed)
PUBLIC_ROUTES = {
    '/api/market/overview', '/api/market/sectors', '/api/market/regime',
    '/api/market/indices', '/api/market/top-movers', '/api/screener/presets',
    '/api/public/', '/api/health', '/api/version',
}


class RouteVisitor(ast.NodeVisitor):
    """AST visitor to find @bp.route decorators + check for auth."""

    def __init__(self):
        self.routes: List[Dict] = []
        self._current_func_auth = False

    def visit_FunctionDef(self, node):
        # Check if function has route decorator
        route_path = None
        methods = []
        for decorator in node.decorator_list:
            # @bp.route('/path', methods=['GET'])
            if isinstance(decorator, ast.Call):
                if isinstance(decorator.func, ast.Attribute):
                    if decorator.func.attr == 'route':
                        if decorator.args:
                            route_path = ast.literal_eval(decorator.args[0])
                        for kw in decorator.keywords:
                            if kw.arg == 'methods':
                                try:
                                    methods = [ast.literal_eval(m) for m in kw.value.elts]
                                except:
                                    methods = ['GET']

        if route_path:
            # Check function body for auth keywords
            func_source = ast.dump(node)
            has_auth = any(kw in func_source for kw in AUTH_KEYWORDS)

            # Classify route
            category = self._classify(route_path, methods, has_auth)

            self.routes.append({
                'path': route_path,
                'methods': methods or ['GET'],
                'has_auth': has_auth,
                'category': category['category'],
                'risk': category['risk'],
                'line': node.lineno,
            })

        self.generic_visit(node)

    def _classify(self, path: str, methods: List[str], has_auth: bool) -> Dict:
        """Classify route by risk level."""
        path_lower = path.lower()

        # Check if public
        is_public = any(pub in path_lower for pub in PUBLIC_ROUTES)

        # Check if sensitive (portfolio/user/payment)
        is_sensitive = any(kw in path_lower for kw in PORTFOLIO_KEYWORDS)

        # Check if has write methods
        has_write = any(m in ('POST', 'PUT', 'DELETE', 'PATCH') for m in methods)

        if is_public and not has_write:
            return {'category': 'Public', 'risk': 'LOW'}
        elif is_sensitive or has_write:
            if has_auth:
                return {'category': 'User/Admin', 'risk': 'MEDIUM'}
            else:
                return {'category': 'SENSITIVE_NO_AUTH', 'risk': 'HIGH'}
        elif has_auth:
            return {'category': 'User', 'risk': 'LOW'}
        else:
            return {'category': 'Public', 'risk': 'LOW'}


def scan_api_file(filepath: str) -> List[Dict]:
    """Scan one API file for routes."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            source = f.read()
    except (IOError, OSError):
        return []

    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError:
        return []

    visitor = RouteVisitor()
    visitor.visit(tree)

    # Add filename to each route
    for route in visitor.routes:
        route['file'] = os.path.relpath(filepath, PROJECT_ROOT)

    return visitor.routes


def main():
    import argparse
    parser = argparse.ArgumentParser(description='API Auth Audit — Phase 9.2')
    parser.add_argument('--strict', action='store_true',
                        help='Exit(1) if SENSITIVE_NO_AUTH routes found')
    args = parser.parse_args()

    print("=" * 80)
    print("  API Auth Audit — Phase 9.2 (Security)")
    print("=" * 80)
    print()

    if not API_DIR.exists():
        print(f"ERROR: API dir not found: {API_DIR}")
        return 2

    all_routes = []
    for fname in sorted(os.listdir(API_DIR)):
        if not fname.endswith('.py'):
            continue
        fpath = os.path.join(API_DIR, fname)
        routes = scan_api_file(fpath)
        all_routes.extend(routes)

    # Group by category
    by_category = defaultdict(list)
    for r in all_routes:
        by_category[r['category']].append(r)

    print(f"Total routes found: {len(all_routes)}")
    print()

    # Print summary
    print("Route Summary:")
    print("-" * 80)
    for cat in ['Public', 'User', 'User/Admin', 'SENSITIVE_NO_AUTH']:
        routes = by_category.get(cat, [])
        print(f"  {cat:20s}: {len(routes):3d} routes")
    print()

    # Print HIGH risk routes (SENSITIVE_NO_AUTH)
    high_risk = by_category.get('SENSITIVE_NO_AUTH', [])
    if high_risk:
        print("=" * 80)
        print(f"  ⚠️  HIGH RISK: {len(high_risk)} sensitive routes without auth!")
        print("=" * 80)
        for r in high_risk:
            print(f"  {r['file']}:{r['line']}")
            print(f"    {','.join(r['methods']):8s} {r['path']}")
            print(f"    → Add: getSessionUserId() + 401/403 check")
            print()
        if args.strict:
            print("⛔ CI FAIL: sensitive routes without auth detected")
            return 1
    else:
        print("✅ No HIGH risk routes found — all sensitive routes have auth.")

    # Print MEDIUM risk (User/Admin)
    medium_risk = by_category.get('User/Admin', [])
    if medium_risk:
        print()
        print(f"  ℹ️  MEDIUM risk (User/Admin with auth): {len(medium_risk)} routes")

    return 0


if __name__ == '__main__':
    sys.exit(main())
