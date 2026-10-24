"""
تنظيف الأخبار المخزّنة من HTML الخام
====================================
بعض الـ RSS feeds بيبعتوا الـ summary كـ block HTML كامل
(<div><img/><p>…</p></div>)، ونسخ الوكيل القديمة كانت بتخزّنه زي ما هو،
فبيظهر الـ HTML كـ نص عادي على الموقع.

السكربت ده بياخد نسخة احتياطية الأول، بعدين ينظّف الأعمدة النصية
في market_news (قاعدة السيرفر) و news (قاعدة الوكيل).

الاستخدام:
    python scripts/clean_news_html.py              # تنظيف + نسخة احتياطية
    python scripts/clean_news_html.py --dry-run    # عرض بس من غير تعديل
    python scripts/clean_news_html.py --db db/news.db
"""

import os
import re
import sys
import json
import sqlite3
import shutil
import argparse
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from analyzer.news_analyzer import strip_html

NEWS_AGENT_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = NEWS_AGENT_DIR.parent

HTML_MARKERS = ('<div', '<p>', '<img', '<a href', '<span', '<br', '<script', '<strong', '<em')

TARGETS = [
    (PROJECT_ROOT / 'db' / 'news.db', 'market_news', ['title', 'content', 'summary_ar', 'summary_en', 'ocr_text']),
    (NEWS_AGENT_DIR / 'data' / 'news.db', 'news', ['title', 'body', 'summary_ar', 'summary_en', 'ocr_text']),
]


def backup(db_path: Path) -> Path | None:
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    dest = db_path.with_suffix(db_path.suffix + f'.bak-{stamp}')
    shutil.copy2(db_path, dest)
    return dest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--db', action='append', default=[])
    args = ap.parse_args()

    targets = TARGETS
    if args.db:
        targets = [(Path(p).resolve(), None, None) for p in args.db]

    total_fixed = 0
    for entry in targets:
        db_path, table, cols = entry
        if not db_path.exists():
            print(f'تخطي — مش موجود: {db_path}')
            continue
        if table is None:
            conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
            names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            conn.close()
            if 'market_news' in names:
                targets.append((db_path, 'market_news', ['title', 'content', 'summary_ar', 'summary_en', 'ocr_text']))
            if 'news' in names:
                targets.append((db_path, 'news', ['title', 'body', 'summary_ar', 'summary_en', 'ocr_text']))
            continue

        print(f'\n=== {db_path.name} :: {table} ===')
        con = sqlite3.connect(str(db_path), timeout=30)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA busy_timeout = 30000')
        present = {r['name'] for r in con.execute(f'PRAGMA table_info({table})')}
        cols = [c for c in cols if c in present]
        if not cols:
            print('  لا توجد أعمدة نصية مناسبة')
            con.close()
            continue

        where = ' OR '.join(f"{c} LIKE '%<%'" for c in cols)
        ids = [r['id'] for r in con.execute(f'SELECT id FROM {table} WHERE {where}')]
        print(f'  صفوف فيها HTML: {len(ids)}')

        if ids and not args.dry_run:
            con.close()
            bak = backup(db_path)
            print(f'  نسخة احتياطية: {bak.name}')
            con = sqlite3.connect(str(db_path), timeout=30)
            con.row_factory = sqlite3.Row
            con.execute('PRAGMA busy_timeout = 30000')

        fixed = 0
        samples = []
        for row_id in ids:
            row = con.execute(f'SELECT * FROM {table} WHERE id = ?', (row_id,)).fetchone()
            updates = {}
            for col in cols:
                val = row[col]
                if isinstance(val, str) and '<' in val:
                    clean = strip_html(val)
                    if clean != val:
                        updates[col] = clean
            if not updates:
                continue
            sets = ', '.join(f'{c} = ?' for c in updates)
            if args.dry_run:
                fixed += 1
            else:
                con.execute(f'UPDATE {table} SET {sets} WHERE id = ?', (*updates.values(), row_id))
                fixed += 1
            if len(samples) < 2:
                samples.append((row['title'] if 'title' in present else row_id,
                                (updates.get('content') or updates.get('body') or '')[:220]))

        con.commit()
        if not args.dry_run:
            try:
                con.execute('VACUUM')
            except sqlite3.OperationalError as e:
                print(f'  (تخطي VACUUM: {e})')
        con.close()
        total_fixed += fixed
        print(f'  اتنضف: {fixed}' + ('  (dry-run — مفيش تعديل)' if args.dry_run else ''))
        for title, clean in samples:
            print(f'    • {str(title)[:70]}')
            print(f'      → {clean}')

    print(f'\nالإجمالي: {total_fixed} صف اتنضف')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
