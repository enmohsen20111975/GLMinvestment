#!/usr/bin/env python3
"""
audit_map.py — Re-runnable codebase audit for SIMPLIFICATION_PLAN PHASE 0.

Produces:
  - Documentation/AUDIT_MAP.md    (human-readable report)
  - Documentation/audit_map.json  (machine-readable, for --diff and CI)

Usage:
  python3 scripts/audit_map.py                  # produce reports
  python3 scripts/audit_map.py --diff           # compare to last committed run
  python3 scripts/audit_map.py --fail-if-regressed   # CI mode

Covers:
  1. Backend file inventory (line counts)
  2. Frontend file inventory (line counts)
  3. God files (> 400 lines)
  4. Python API endpoints (Flask blueprints + FastAPI routers)
  5. Next.js API routes (route.ts files)
  6. DB tables and per-table access (which files read/write each table)
  7. Price-history reader functions (the 12+ duplicates)
  8. Inline SQL outside the data/ layer (the root cause of prod bugs)
  9. Deprecated patterns (on_event, starlette.middleware.wsgi, etc.)
  10. Dead imports (best-effort, AST-based)
  11. Blueprints registered in main.py
  12. Duplicate function names across files
  13. Summary metrics (totals per category)

Exit codes:
  0 — success
  1 — regressed (only with --fail-if-regressed)
  2 — script error
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Set, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent

PY_BACKEND_DIRS = [ROOT / "vps-service"]
PY_EXCLUDE_DIRS = {
    "__pycache__", ".venv", "venv", "node_modules", ".git",
    "logs", "output", "backtest_results",
}
PY_EXCLUDE_GLOBS = ("*/__pycache__/*", "*/.venv/*", "*/venv/*", "*/logs/*")

FRONTEND_DIRS = [ROOT / "src"]
FRONTEND_EXCLUDE_DIRS = {"node_modules", ".next", ".git"}

DB_DIR = ROOT / "db"
GOD_FILE_THRESHOLD = 400  # lines

DATA_LAYER_DIRS = [
    ROOT / "vps-service" / "data",
    ROOT / "vps-service" / "core" / "db",
]

# Patterns that indicate deprecated/problematic code
DEPRECATED_PATTERNS = [
    (r'@app\.on_event\s*\(', "FastAPI on_event (use lifespan handlers)"),
    (r'starlette\.middleware\.wsgi', "starlette.middleware.wsgi (use a2wsgi)"),
    (r'from starlette\.middleware\.wsgi', "starlette.middleware.wsgi import"),
    (r'\b@deprecated\b', "@deprecated marker"),
    (r'#\s*DEAD[:\s]', "marked DEAD comment"),
    (r'#\s*TODO.*remove', "TODO remove"),
    (r'warnings\.warn\s*\(\s*["\'].*Deprecation', "runtime DeprecationWarning"),
]

# SQL patterns for table-access detection
SQL_FROM_RE = re.compile(
    r'(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_\.]*)',
    re.IGNORECASE,
)
SQL_WRITE_RE = re.compile(
    r'(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+([a-z_][a-z0-9_\.]*)',
    re.IGNORECASE,
)

# Price-history reader function name patterns
PRICE_READER_RE = re.compile(
    r'def\s+(_?get_?price_?history|load_?merged_?history|load_?price_?history|'
    r'_?get_?history|fetch_?price_?history|get_?price_?history_?until)\w*\s*\(',
    re.IGNORECASE,
)

# Flask/FastAPI route decorators
ROUTE_DECORATOR_RE = re.compile(
    r'@\w+\.(route|get|post|put|delete|patch)\s*\(\s*["\'](.*?)["\']',
)

# Blueprint registration
REGISTER_BP_RE = re.compile(
    r'register_blueprint\s*\(\s*(\w+)\s*[,)]'
)
REGISTER_ROUTER_RE = re.compile(
    r'include_router\s*\(\s*(\w+)'
)


# ─────────────────────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class FileInventory:
    path: str
    lines: int
    category: str  # 'py-backend' | 'tsx' | 'ts' | 'py-script'


@dataclass
class Endpoint:
    method: str
    path: str
    file: str
    line: int
    framework: str  # 'flask' | 'fastapi'


@dataclass
class TableAccess:
    table: str
    db_file: str
    readers: List[str] = field(default_factory=list)
    writers: List[str] = field(default_factory=list)


@dataclass
class PriceReader:
    name: str
    file: str
    line: int


@dataclass
class InlineSQL:
    file: str
    line: int
    statement: str
    in_data_layer: bool


@dataclass
class DeprecatedHit:
    file: str
    line: int
    pattern: str
    description: str


@dataclass
class DuplicateFunc:
    name: str
    locations: List[Tuple[str, int]]


@dataclass
class AuditReport:
    generated_at: str
    root: str
    metrics: Dict[str, int]
    god_files_backend: List[FileInventory]
    god_files_frontend: List[FileInventory]
    endpoints_python: List[Endpoint]
    nextjs_api_routes: List[str]
    table_access: List[TableAccess]
    price_readers: List[PriceReader]
    inline_sql_outside_data: List[InlineSQL]
    deprecated_hits: List[DeprecatedHit]
    blueprints_registered: List[str]
    duplicate_functions: List[DuplicateFunc]
    dead_imports: List[Dict]  # {file, module, names}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def count_lines(path: Path) -> int:
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except (OSError, UnicodeDecodeError):
        return 0


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def is_excluded(path: Path, exclude_dirs: Set[str]) -> bool:
    return any(part in exclude_dirs for part in path.parts)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def is_in_data_layer(path: Path) -> bool:
    p_str = str(path)
    return any(str(d) in p_str for d in DATA_LAYER_DIRS)


# ─────────────────────────────────────────────────────────────────────────────
# Scanners
# ─────────────────────────────────────────────────────────────────────────────
def scan_file_inventory() -> Tuple[List[FileInventory], List[FileInventory]]:
    """Return (backend_files, frontend_files) sorted by lines desc."""
    backend: List[FileInventory] = []
    frontend: List[FileInventory] = []

    for d in PY_BACKEND_DIRS:
        for ext, cat in ((".py", "py-backend"),):
            for path in d.rglob(f"*{ext}"):
                if is_excluded(path, PY_EXCLUDE_DIRS):
                    continue
                lines = count_lines(path)
                backend.append(FileInventory(rel(path), lines, cat))

    for d in FRONTEND_DIRS:
        for path in d.rglob("*"):
            if is_excluded(path, FRONTEND_EXCLUDE_DIRS):
                continue
            if path.suffix == ".tsx":
                cat = "tsx"
            elif path.suffix == ".ts":
                cat = "ts"
            else:
                continue
            lines = count_lines(path)
            frontend.append(FileInventory(rel(path), lines, cat))

    backend.sort(key=lambda x: x.lines, reverse=True)
    frontend.sort(key=lambda x: x.lines, reverse=True)
    return backend, frontend


def scan_python_endpoints(backend_files: List[FileInventory]) -> List[Endpoint]:
    endpoints: List[Endpoint] = []
    for fi in backend_files:
        path = ROOT / fi.path
        text = read_text(path)
        for m in ROUTE_DECORATOR_RE.finditer(text):
            method_raw, route_path = m.group(1).lower(), m.group(2)
            line_no = text[: m.start()].count("\n") + 1
            fw = "fastapi" if method_raw in {"get", "post", "put", "delete", "patch"} else "flask"
            method = method_raw.upper() if method_raw in {"get", "post", "put", "delete", "patch"} else "ANY"
            endpoints.append(Endpoint(method, route_path, fi.path, line_no, fw))
    return endpoints


def scan_nextjs_routes() -> List[str]:
    api_dir = ROOT / "src" / "app" / "api"
    if not api_dir.exists():
        return []
    routes = sorted(str(p.relative_to(ROOT)) for p in api_dir.rglob("route.ts"))
    return routes


def scan_db_tables() -> Dict[str, List[str]]:
    """Return {db_file: [table_names]}. Uses Python's sqlite3 module (no CLI dep)."""
    import sqlite3 as _sqlite3
    result: Dict[str, List[str]] = {}
    if not DB_DIR.exists():
        return result
    for db_path in sorted(DB_DIR.glob("*.db")):
        tables: List[str] = []
        try:
            conn = _sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            cur = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
                "ORDER BY name"
            )
            tables = [row[0] for row in cur.fetchall()]
            conn.close()
        except _sqlite3.DatabaseError:
            # empty or locked DB
            pass
        result[rel(db_path)] = tables
    return result


def scan_table_access(backend_files: List[FileInventory], db_tables: Dict[str, List[str]]) -> List[TableAccess]:
    """For each known table, find files that read/write it."""
    # Build a set of all real table names
    all_tables: Set[str] = set()
    for tables in db_tables.values():
        all_tables.update(t for t in tables if not t.startswith("sqlite_"))
    # Also include common known tables that might be views
    all_tables.update({
        "stock_daily_prices", "price_history", "stock_price_history",
        "egksco_price_history", "intraday_prices", "stored_analyses",
        "predictions", "stocks", "stocks_fundamentals", "stock_adaptive_profiles",
    })

    access: Dict[str, TableAccess] = {}
    for fi in backend_files:
        path = ROOT / fi.path
        text = read_text(path)
        for m in SQL_FROM_RE.finditer(text):
            table = m.group(1).lower().split(".")[-1]
            if table in all_tables:
                line_no = text[: m.start()].count("\n") + 1
                is_write = bool(SQL_WRITE_RE.match(m.group(0)))
                key = table
                if key not in access:
                    access[key] = TableAccess(table=table, db_file="(multiple)")
                loc = f"{fi.path}:{line_no}"
                if is_write:
                    if loc not in access[key].writers:
                        access[key].writers.append(loc)
                else:
                    if loc not in access[key].readers:
                        access[key].readers.append(loc)

    return sorted(access.values(), key=lambda x: len(x.readers) + len(x.writers), reverse=True)


def scan_price_readers(backend_files: List[FileInventory]) -> List[PriceReader]:
    readers: List[PriceReader] = []
    for fi in backend_files:
        path = ROOT / fi.path
        text = read_text(path)
        for m in PRICE_READER_RE.finditer(text):
            name = m.group(1)
            line_no = text[: m.start()].count("\n") + 1
            readers.append(PriceReader(name, fi.path, line_no))
    return readers


def scan_inline_sql_outside_data(backend_files: List[FileInventory]) -> List[InlineSQL]:
    hits: List[InlineSQL] = []
    for fi in backend_files:
        path = ROOT / fi.path
        in_data = is_in_data_layer(path)
        if in_data:
            continue
        text = read_text(path)
        for m in re.finditer(r'(?:FROM|INSERT\s+INTO|UPDATE|REPLACE\s+INTO)\s+([a-z_][a-z0-9_]*)', text, re.IGNORECASE):
            table = m.group(1).lower()
            # only flag price/stock tables (the known duplication offenders)
            if table in {
                "stock_daily_prices", "price_history", "stock_price_history",
                "egksco_price_history", "intraday_prices",
            }:
                line_no = text[: m.start()].count("\n") + 1
                stmt = text.splitlines()[line_no - 1].strip()[:120]
                hits.append(InlineSQL(fi.path, line_no, stmt, in_data))
    return hits


def scan_deprecated(backend_files: List[FileInventory], frontend_files: List[FileInventory]) -> List[DeprecatedHit]:
    hits: List[DeprecatedHit] = []
    for fi in backend_files + frontend_files:
        path = ROOT / fi.path
        text = read_text(path)
        for pattern, desc in DEPRECATED_PATTERNS:
            for m in re.finditer(pattern, text):
                line_no = text[: m.start()].count("\n") + 1
                hits.append(DeprecatedHit(fi.path, line_no, pattern, desc))
    return hits


def scan_blueprints(backend_files: List[FileInventory]) -> List[str]:
    """Collect blueprint/router names from main.py (include_router) AND
    lightweight_server.py (BLUEPRINTS list + app.register_blueprint calls)
    AND any api/*.py file that calls app.register_blueprint."""
    bps = set()
    # 1) main.py: include_router(...)
    main_py = ROOT / "vps-service" / "main.py"
    for m in REGISTER_ROUTER_RE.finditer(read_text(main_py)):
        bps.add(m.group(1))
    # 2) lightweight_server.py: BLUEPRINTS list tuples + register_blueprint calls
    ls = ROOT / "vps-service" / "lightweight_server.py"
    ls_text = read_text(ls)
    for m in re.finditer(r"^\s*\([^)]*['\"]\w+['\"]\s*,\s*['\"](\w+_bp)['\"]", ls_text, re.MULTILINE):
        bps.add(m.group(1))
    for m in REGISTER_BP_RE.finditer(ls_text):
        bps.add(m.group(1))
    # 3) any api/*.py: app.register_blueprint(xxx_bp, ...)
    for fi in backend_files:
        if "/api/" not in fi.path:
            continue
        text = read_text(ROOT / fi.path)
        for m in REGISTER_BP_RE.finditer(text):
            bps.add(m.group(1))
    return sorted(bps)


def scan_duplicate_functions(backend_files: List[FileInventory]) -> List[DuplicateFunc]:
    """Find def names that appear in multiple files."""
    func_locations: Dict[str, List[Tuple[str, int]]] = defaultdict(list)
    for fi in backend_files:
        path = ROOT / fi.path
        text = read_text(path)
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # only top-level + class methods, skip __dunder__
                if node.name.startswith("__"):
                    continue
                func_locations[node.name].append((fi.path, node.lineno))

    dupes = [
        DuplicateFunc(name, locs)
        for name, locs in func_locations.items()
        if len({l[0] for l in locs}) >= 2  # appears in >= 2 different files
    ]
    dupes.sort(key=lambda x: len(x.locations), reverse=True)
    return dupes


def scan_dead_imports(backend_files: List[FileInventory]) -> List[Dict]:
    """Best-effort: find `import X` / `from X import Y` where Y/X is never used in the file body."""
    dead: List[Dict] = []
    for fi in backend_files:
        if fi.lines > 4000:
            continue  # skip god files (too many false positives)
        path = ROOT / fi.path
        text = read_text(path)
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError:
            continue

        imported_names: List[Tuple[str, str]] = []  # (module, local_name)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    local = alias.asname or alias.name.split(".")[0]
                    imported_names.append((alias.name, local))
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    local = alias.asname or alias.name
                    imported_names.append((f"{mod}.{alias.name}", local))

        # collect all Name attribute references
        used: Set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                used.add(node.id)
            elif isinstance(node, ast.Attribute):
                # walk to base
                base = node
                while isinstance(base, ast.Attribute):
                    base = base.value
                if isinstance(base, ast.Name):
                    used.add(base.id)

        for mod, local in imported_names:
            if local not in used:
                # double check with regex (string references, decorators, etc.)
                if not re.search(r'\b' + re.escape(local) + r'\b', text[node.lineno * 0:] if hasattr(node, 'lineno') else text):
                    pass
                dead.append({"file": fi.path, "module": mod, "name": local})

    return dead


# ─────────────────────────────────────────────────────────────────────────────
# Report rendering
# ─────────────────────────────────────────────────────────────────────────────
def render_markdown(report: AuditReport) -> str:
    md: List[str] = []
    w = md.append

    w("# خريطة تدقيق المشروع (AUDIT_MAP)")
    w("")
    w(f"> **مُولّد آلياً** بواسطة `scripts/audit_map.py` — re-runnable.")
    w(f"> **تاريخ التوليد**: {report.generated_at}")
    w(f"> **الجذر**: `{report.root}`")
    w(f"> **المرجع**: `Documentation/SIMPLIFICATION_PLAN.md` (PHASE 0)")
    w("")
    w("---")
    w("")

    # ── Summary metrics ──
    w("## 1. الملخص بالأرقام (Summary Metrics)")
    w("")
    w("| المقياس | القيمة |")
    w("|---------|--------|")
    for k, v in report.metrics.items():
        w(f"| {k} | {v} |")
    w("")

    # ── God files backend ──
    w("## 2. الله-ملفات الخلفية (Backend God Files > {} سطر)".format(GOD_FILE_THRESHOLD))
    w("")
    w("هذه أكبر مصدر للتعقيد. كل ملف هنا هدف للتقسيم في PHASE 3.")
    w("")
    w("| الملف | الأسطر |")
    w("|-------|--------|")
    for fi in report.god_files_backend[:30]:
        w(f"| `{fi.path}` | {fi.lines} |")
    if len(report.god_files_backend) > 30:
        w(f"| *…و {len(report.god_files_backend) - 30} ملف آخر* | |")
    w("")

    # ── God files frontend ──
    w("## 3. الله-مكونات الواجهة (Frontend God Files > {} سطر)".format(GOD_FILE_THRESHOLD))
    w("")
    w("| الملف | الأسطر | النوع |")
    w("|-------|--------|------|")
    for fi in report.god_files_frontend[:20]:
        w(f"| `{fi.path}` | {fi.lines} | {fi.category} |")
    w("")

    # ── Price readers ──
    w("## 4. دوال قراءة السعر المكرّرة (Price History Readers)")
    w("")
    w(f"**{len(report.price_readers)}** دالة لقراءة بيانات الأسعار موزّعة على ملفات مختلفة. ")
    w("هذا هو السبب الجذري لـ bug الإنتاج `analyzed:0` — كل قارئ بيقرأ من مصدر مختلف.")
    w("")
    w("| الدالة | الملف | السطر |")
    w("|--------|------|------|")
    for pr in report.price_readers:
        w(f"| `{pr.name}` | `{pr.file}` | {pr.line} |")
    w("")

    # ── Inline SQL outside data/ ──
    w("## 5. SQL مدمج خارج طبقة البيانات (Inline SQL Outside `data/`)")
    w("")
    w(f"**{len(report.inline_sql_outside_data)}** موضع يكتب SQL مباشرة على جداول الأسعار ")
    w("خارج طبقة `data/`. كلها يجب أن تستدعي `data.prices.load_price_history()` في PHASE 1.")
    w("")
    w("| الملف | السطر | الجملة |")
    w("|-------|------|--------|")
    for h in report.inline_sql_outside_data[:50]:
        stmt = h.statement.replace("|", "\\|")
        w(f"| `{h.file}` | {h.line} | `{stmt}` |")
    if len(report.inline_sql_outside_data) > 50:
        w(f"| *…و {len(report.inline_sql_outside_data) - 50} موضع آخر* | | |")
    w("")

    # ── Table access ──
    w("## 6. وصول الجداول (Table Access Heatmap)")
    w("")
    w("لكل جدول: عدد الملفات التي تقرأه / تكتبه. التكرار العالي = خطر التضارب.")
    w("")
    w("| الجدول | قرّاء (ملفات) | كُتّاب (ملفات) | الإجمالي |")
    w("|--------|---------------|----------------|----------|")
    for ta in report.table_access[:25]:
        n_readers = len({r.split(":")[0] for r in ta.readers})
        n_writers = len({r.split(":")[0] for r in ta.writers})
        total = n_readers + n_writers
        w(f"| `{ta.table}` | {n_readers} | {n_writers} | {total} |")
    w("")

    # ── DB tables ──
    w("## 7. جداول قواعد البيانات (DB Tables Inventory)")
    w("")
    w("انظر القسم 14 لقائمة الجداول الكاملة لكل DB.")
    w("")

    # ── Python endpoints ──
    w("## 8. نقاط النهاية Python (Python Endpoints)")
    w("")
    w(f"**{len(report.endpoints_python)}** endpoint مسجّل في الـ backend.")
    w("")
    w(f"- Flask: {sum(1 for e in report.endpoints_python if e.framework == 'flask')}")
    w(f"- FastAPI: {sum(1 for e in report.endpoints_python if e.framework == 'fastapi')}")
    w("")
    w("أكثر الـ files ازدحاماً:")
    w("")
    ep_by_file = Counter(e.file for e in report.endpoints_python)
    w("| الملف | عدد endpoints |")
    w("|-------|---------------|")
    for f, n in ep_by_file.most_common(15):
        w(f"| `{f}` | {n} |")
    w("")

    # ── Next.js routes ──
    w("## 9. نقاط API في Next.js (Next.js API Routes)")
    w("")
    w(f"**{len(report.nextjs_api_routes)}** ملف `route.ts` تحت `src/app/api/`. ")
    w("أغلبها proxy بسيط — هدف PHASE 6: تقليلها إلى 1 proxy عام.")
    w("")
    # group by top-level domain
    domains = Counter()
    for r in report.nextjs_api_routes:
        parts = r.split("/")
        if len(parts) >= 5:
            domains[parts[4]] += 1
        else:
            domains["(root)"] += 1
    w("التوزيع حسب الدومين الأول:")
    w("")
    w("| الدومين | عدد routes |")
    w("|---------|-----------|")
    for d, n in domains.most_common(20):
        w(f"| `{d}` | {n} |")
    w("")

    # ── Blueprints ──
    w("## 10. Blueprints/Routers المسجّلة (Registered Blueprints)")
    w("")
    w(f"**{len(report.blueprints_registered)}** blueprint/router مسجّل في `main.py`.")
    w("")
    if report.blueprints_registered:
        cols = 3
        rows = [report.blueprints_registered[i:i + cols] for i in range(0, len(report.blueprints_registered), cols)]
        for row in rows:
            w("| " + " | ".join(f"`{b}`" for b in row) + " |")
    w("")

    # ── Duplicate functions ──
    w("## 11. الدوال المكرّرة عبر الملفات (Duplicate Functions)")
    w("")
    w(f"**{len(report.duplicate_functions)}** اسم دالة يظهر في ملفين أو أكثر. ")
    w("أخطرها دوال قراءة السعر (انظر القسم 4).")
    w("")
    w("| الدالة | عدد المواضع | الملفات |")
    w("|--------|-------------|---------|")
    for d in report.duplicate_functions[:20]:
        files = sorted({loc[0] for loc in d.locations})
        files_str = ", ".join(f"`{f}`" for f in files[:5])
        if len(files) > 5:
            files_str += f", +{len(files) - 5}"
        w(f"| `{d.name}` | {len(d.locations)} | {files_str} |")
    w("")

    # ── Deprecated ──
    w("## 12. الأنماط المهملة (Deprecated Patterns)")
    w("")
    w(f"**{len(report.deprecated_hits)}** موضع. هذه مصدر DeprecationWarnings في logs.")
    w("")
    dep_by_desc = Counter(h.description for h in report.deprecated_hits)
    w("| النمط | العدد |")
    w("|-------|------|")
    for desc, n in dep_by_desc.most_common():
        w(f"| {desc} | {n} |")
    w("")
    if report.deprecated_hits:
        w("أول 20 موضع:")
        w("")
        w("| الملف | السطر | النمط |")
        w("|-------|------|------|")
        for h in report.deprecated_hits[:20]:
            w(f"| `{h.file}` | {h.line} | {h.description} |")
    w("")

    # ── Dead imports ──
    w("## 13. الـ imports المشتبه بموتها (Suspected Dead Imports)")
    w("")
    w(f"**{len(report.dead_imports)}** import لا يظهر استخدامه في نفس الملف (best-effort، ")
    w("قد تحتوي على false positives في الـ god files — تم استبعادها).")
    w("")
    w("> ملاحظة: هذه قائمة *للمراجعة*، ليست للحذف الآلي. المراجعة اليدوية مطلوبة.")
    w("")
    if report.dead_imports:
        w("| الملف | الـ module | الاسم |")
        w("|-------|-----------|------|")
        for di in report.dead_imports[:30]:
            w(f"| `{di['file']}` | `{di['module']}` | `{di['name']}` |")
        if len(report.dead_imports) > 30:
            w(f"| *…و {len(report.dead_imports) - 30} import آخر* | | |")
    w("")

    # ── DB files section (rendered properly) ──
    w("## 14. ملفات قواعد البيانات (DB Files)")
    w("")
    db_tables = scan_db_tables()
    w("| الملف | الجداول |")
    w("|-------|---------|")
    for db_path, tables in db_tables.items():
        tables_str = ", ".join(f"`{t}`" for t in tables[:8])
        if len(tables) > 8:
            tables_str += f", +{len(tables) - 8}"
        w(f"| `{db_path}` ({len(tables)} جدول) | {tables_str} |")
    w("")

    # ── Conclusion ──
    w("---")
    w("")
    w("## خلاصة PHASE 0")
    w("")
    w("أعلى 3 أولويات للإصلاح (حسب الأثر):")
    w("")
    w("1. **توحيد قراءة السعر** (القسم 4 + 5) — يمنع bug الإنتاج للأبد")
    w("2. **تقسيم الـ god files** (القسم 2 + 3) — يجعل الكود قابلاً للصيانة")
    w("3. **دمج قواعد البيانات** (القسم 6 + 14) — يزيل التكرار والتضارب")
    w("")
    w("*هذا التقرير يُعاد توليده بـ `python3 scripts/audit_map.py` بعد كل مرحلة لقياس التقدم.*")
    w("")

    return "\n".join(md)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def build_report() -> AuditReport:
    print("[audit] scanning file inventory...", file=sys.stderr)
    backend, frontend = scan_file_inventory()

    print("[audit] scanning python endpoints...", file=sys.stderr)
    endpoints = scan_python_endpoints(backend)

    print("[audit] scanning next.js routes...", file=sys.stderr)
    nextjs_routes = scan_nextjs_routes()

    print("[audit] scanning db tables...", file=sys.stderr)
    db_tables = scan_db_tables()

    print("[audit] scanning table access...", file=sys.stderr)
    table_access = scan_table_access(backend, db_tables)

    print("[audit] scanning price readers...", file=sys.stderr)
    price_readers = scan_price_readers(backend)

    print("[audit] scanning inline sql...", file=sys.stderr)
    inline_sql = scan_inline_sql_outside_data(backend)

    print("[audit] scanning deprecated patterns...", file=sys.stderr)
    deprecated = scan_deprecated(backend, frontend)

    print("[audit] scanning blueprints...", file=sys.stderr)
    blueprints = scan_blueprints(backend)

    print("[audit] scanning duplicate functions...", file=sys.stderr)
    duplicates = scan_duplicate_functions(backend)

    print("[audit] scanning dead imports (may take a moment)...", file=sys.stderr)
    dead_imports = scan_dead_imports(backend)

    god_backend = [f for f in backend if f.lines >= GOD_FILE_THRESHOLD]
    god_frontend = [f for f in frontend if f.lines >= GOD_FILE_THRESHOLD]

    metrics = {
        "backend_files": len(backend),
        "backend_lines": sum(f.lines for f in backend),
        "frontend_files": len(frontend),
        "frontend_lines": sum(f.lines for f in frontend),
        "god_files_backend (>={} lines)".format(GOD_FILE_THRESHOLD): len(god_backend),
        "god_files_frontend (>={} lines)".format(GOD_FILE_THRESHOLD): len(god_frontend),
        "python_endpoints": len(endpoints),
        "nextjs_api_routes": len(nextjs_routes),
        "price_reader_functions": len(price_readers),
        "inline_sql_outside_data": len(inline_sql),
        "deprecated_hits": len(deprecated),
        "blueprints_registered": len(blueprints),
        "duplicate_function_names": len(duplicates),
        "suspected_dead_imports": len(dead_imports),
        "db_files": len(db_tables),
        "db_tables_total": sum(len(t) for t in db_tables.values()),
    }

    return AuditReport(
        generated_at=datetime.now().isoformat(timespec="seconds"),
        root=str(ROOT),
        metrics=metrics,
        god_files_backend=god_backend,
        god_files_frontend=god_frontend,
        endpoints_python=endpoints,
        nextjs_api_routes=nextjs_routes,
        table_access=table_access,
        price_readers=price_readers,
        inline_sql_outside_data=inline_sql,
        deprecated_hits=deprecated,
        blueprints_registered=blueprints,
        duplicate_functions=duplicates,
        dead_imports=dead_imports,
    )


def report_to_dict(report: AuditReport) -> dict:
    d = asdict(report)
    return d


def main():
    parser = argparse.ArgumentParser(description="Re-runnable codebase audit")
    parser.add_argument("--diff", action="store_true", help="compare to previous run")
    parser.add_argument("--fail-if-regressed", action="store_true", help="CI mode")
    parser.add_argument("--json-only", action="store_true", help="only write JSON")
    args = parser.parse_args()

    report = build_report()

    out_dir = ROOT / "Documentation"
    out_dir.mkdir(exist_ok=True)
    json_path = out_dir / "audit_map.json"
    md_path = out_dir / "AUDIT_MAP.md"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report_to_dict(report), f, ensure_ascii=False, indent=2)
    print(f"[audit] wrote {rel(json_path)}", file=sys.stderr)

    if not args.json_only:
        md = render_markdown(report)
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"[audit] wrote {rel(md_path)}", file=sys.stderr)

    # Print summary to stdout
    print()
    print("=" * 60)
    print("  AUDIT SUMMARY")
    print("=" * 60)
    for k, v in report.metrics.items():
        print(f"  {k:<45} {v}")
    print("=" * 60)

    # Diff mode
    if args.diff or args.fail_if_regressed:
        prev_path = out_dir / "audit_map.prev.json"
        if prev_path.exists():
            with open(prev_path, encoding="utf-8") as f:
                prev = json.load(f)
            regressed = False
            print("\n  DIFF vs previous run:")
            for k, v in report.metrics.items():
                pv = prev.get("metrics", {}).get(k, 0)
                delta = v - pv
                marker = ""
                if k.startswith("god_files") or k in ("price_reader_functions", "inline_sql_outside_data", "deprecated_hits", "duplicate_function_names", "suspected_dead_imports", "nextjs_api_routes"):
                    if delta > 0:
                        marker = " ⚠️ REGRESSED"
                        regressed = True
                    elif delta < 0:
                        marker = " ✅ improved"
                if delta != 0:
                    print(f"  {k:<45} {pv} → {v} ({delta:+d}){marker}")
            if regressed and args.fail_if_regressed:
                print("\n  ❌ Regression detected — failing CI.", file=sys.stderr)
                sys.exit(1)
        else:
            print("\n  (no previous run found — skipping diff)", file=sys.stderr)
        # save current as prev
        with open(prev_path, "w", encoding="utf-8") as f:
            json.dump(report_to_dict(report), f, ensure_ascii=False, indent=2)

    sys.exit(0)


if __name__ == "__main__":
    main()
