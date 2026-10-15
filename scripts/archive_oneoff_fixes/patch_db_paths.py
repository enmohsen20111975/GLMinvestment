#!/usr/bin/env python3
"""
patch_db_paths.py — استبدال مسارات DB النسبية بمطلقة آمنة
============================================================
يصلح السبب الجذري لمجلد db/db/ المتداخل: مسارات 'db/xxx.db' النسبية.

لكل ملف:
  1) يستبدل 'db/stocks.db' / "db/stocks.db" / './db/stocks.db'
     بـ str(Path(__file__).resolve().parents[2] / 'db' / 'stocks.db')
  2) يضمن وجود `from pathlib import Path`
آمن: يطبع كل تغيير، ويتحقق قبل الكتابة. Idempotent.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

# الملفات الـ 11 (نسبية لجذر المشروع)
FILES = [
    "vps-service/scripts/update_sectors_official.py",
    "vps-service/scripts/normalize_sectors.py",
    "vps-service/scripts/forward_test_may2026.py",
    "vps-service/scripts/fix_stock_personality.py",
    "vps-service/scripts/fix_sectors.py",
    "vps-service/scripts/build_stock_personality.py",
    "vps-service/scripts/build_sector_patterns.py",
    "vps-service/scripts/backfill_signal_memory.py",
    "vps-service/analyzers/unified_analyzer.py",
    "vps-service/engine/paper_trade_tracker.py",
    "vps-service/data/multi_market_fetcher.py",
]

# التعبير البديل (parents[2] = project root لكل الملفات دي)
EXPR = 'str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")'

# أنماط السلسلة النصية للاستبدال (بالترتيب: الأطول أولًا عشان ./db ما يتاكلش قبل db)
PATTERNS = [
    (re.compile(r"'./db/stocks\.db'"), EXPR),
    (re.compile(r'"./db/stocks\.db"'), EXPR),
    (re.compile(r"'db/stocks\.db'"), EXPR),
    (re.compile(r'"db/stocks\.db"'), EXPR),
]

PATHLIB_IMPORT_RE = re.compile(r'^from\s+pathlib\s+import\s+Path\b', re.MULTILINE)


def patch_file(path: Path) -> tuple[int, list[str]]:
    """يرجع (عدد الاستبدالات، سطور التغيير)."""
    if not path.exists():
        return -1, [f"  ❌ غير موجود: {path}"]
    original = path.read_text(encoding="utf-8")
    content = original
    changes: list[str] = []
    n = 0
    for pat, repl in PATTERNS:
        new_content, count = pat.subn(repl, content)
        if count:
            n += count
            changes.append(f"  🔧 {count}× استبدال نمط {pat.pattern}")
        content = new_content

    if n == 0:
        # تأكد إن الملف ما فيهوش المسار النسبي أصلاً (ممكن متصلح قبل كده)
        if "db/stocks.db" in original or "'./db/stocks.db'" in original:
            return 0, [f"  ⚠️ فيه 'db/stocks.db' لكن ما اتعملش استبدال (نمط غير متوقع)"]
        return 0, [f"  ℹ️ لا توجد مسارات نسبية — سليم"]

    # تأكد من وجود from pathlib import Path
    if not PATHLIB_IMPORT_RE.search(content):
        # أضفه بعد أول سطر import أو في الأعلى
        lines = content.split("\n")
        insert_at = 0
        for i, line in enumerate(lines[:30]):
            if line.startswith("import ") or line.startswith("from "):
                insert_at = i + 1
        # لو لسه مفيش، حطه بعد docstring/SHEBANG
        lines.insert(insert_at, "from pathlib import Path  # added by patch_db_paths.py")
        content = "\n".join(lines)
        changes.append(f"  ➕ أُضيف `from pathlib import Path`")

    if content != original:
        path.write_text(content, encoding="utf-8")
        changes.append(f"  ✅ حُفظ ({n} استبدال)")
    return n, changes


def main() -> int:
    project_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    print(f"جذر المشروع: {project_root}\n")
    total = 0
    for rel in FILES:
        f = project_root / rel
        print(f"📄 {rel}")
        n, changes = patch_file(f)
        for c in changes:
            print(c)
        if n > 0:
            total += n
        print()
    print(f"═══ الإجمالي: {total} استبدال في {len(FILES)} ملف ═══")
    return 0


if __name__ == "__main__":
    sys.exit(main())
