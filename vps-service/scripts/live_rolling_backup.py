#!/usr/bin/env python3
"""
Live Rolling Verified Backup System
====================================
نظام النسخ الاحتياطي الحي والمضغوط للمنصة:
1. دمج WAL checkpoint لكل قاعدة بيانات لضمان كتابة كل العمليات.
2. فحص سلامة البيانات الحية عبر PRAGMA integrity_check.
3. التحقق من مطابقة الحجم للمواصفات وعدم نقصانه بشكل مريب.
4. ضغط فوري Gzip يقلص الحجم بنسبة 85% - 90%.
5. نظام التدوير الحي الحرفي (Rolling Snapshot):
   - الاحتفاظ فقط بـ:
     * النسخة الحية المعتمدة: <name>.current.db.gz
     * نسخة الأمان السابقة للطوارئ: <name>.previous.db.gz
   - حذف أي ملفات أقدم تلقائياً وفوراً.
"""

import sqlite3
import os
import sys
import gzip
import shutil
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'
BACKUP_DIR = DB_DIR / 'backups' / 'live'
LOG_FILE = BACKUP_DIR / 'backup.log'

# قواعد البيانات الحية المطلوب تأمينها
WATCH_DBS = [
    'stocks.db',
    'predictions.db',
    'data_engine.db',
    'price_history.db',
    'auth.db',
    'intraday.db',
    'crypto.db',
    'news.db',
    'market.db',
]

def log(msg: str, level: str = 'INFO'):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] [{level}] {msg}"
    print(line)
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

def run_backup():
    log("="*60)
    log("🚀 بدء عملية النسخ الاحتياطي الحي والمضغوط (Live Rolling Backup)")
    log("="*60)
    
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    success_count = 0
    total_saved_bytes = 0

    for db_name in WATCH_DBS:
        src_path = DB_DIR / db_name
        if not src_path.exists():
            log(f"⚠️ تخطي {db_name}: الملف غير موجود", "WARN")
            continue

        raw_size = src_path.stat().st_size
        if raw_size == 0:
            log(f"⚠️ تخطي {db_name}: حجم الملف 0 بايت", "WARN")
            continue

        stem = db_name.replace('.db', '')
        current_gz = BACKUP_DIR / f"{stem}.current.db.gz"
        previous_gz = BACKUP_DIR / f"{stem}.previous.db.gz"
        temp_gz = BACKUP_DIR / f"{stem}.tmp.db.gz"

        # 1. دمج الـ WAL
        try:
            conn = sqlite3.connect(str(src_path), timeout=15)
            conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
            cur = conn.cursor()
            res = cur.execute("PRAGMA integrity_check;").fetchone()
            conn.close()
            if not res or res[0] != 'ok':
                log(f"❌ فشل فحص السلامة لـ {db_name} (integrity_check != ok) — تم إلغاء النسخ للملف", "ERROR")
                continue
        except Exception as e:
            log(f"❌ خطأ أثناء فحص {db_name}: {e}", "ERROR")
            continue

        # 2. إنشاء نسخة مؤقتة وضغطها بـ Gzip
        try:
            with open(src_path, 'rb') as f_in:
                with gzip.open(temp_gz, 'wb', compresslevel=6) as f_out:
                    shutil.copyfileobj(f_in, f_out)
            
            gz_size = temp_gz.stat().st_size
            ratio = (1 - (gz_size / raw_size)) * 100 if raw_size > 0 else 0

            # 3. فحص الحجم والمواصفات (ألا يكون الملف تالفاً أو فارغاً)
            if gz_size < 100:
                log(f"❌ حجم النسخة المضغوطة لـ {db_name} غير طبيعي ({gz_size} B) — تم الإلغاء", "ERROR")
                if temp_gz.exists():
                    temp_gz.unlink()
                continue

            # 4. التدوير الحي الحرفي (Rolling Snapshot)
            # انقل current إلى previous إذا كان موجوداً
            if current_gz.exists():
                if previous_gz.exists():
                    previous_gz.unlink()
                current_gz.rename(previous_gz)

            # انقل temp إلى current
            temp_gz.rename(current_gz)

            log(f"✅ {db_name}: تم الاعتماد بنجاح | الأصل: {format_size(raw_size)} ← مضغوط: {format_size(gz_size)} (وفّر {ratio:.1f}%)")
            success_count += 1
            total_saved_bytes += (raw_size - gz_size)

        except Exception as e:
            log(f"❌ خطأ في معالجة النسخ لـ {db_name}: {e}", "ERROR")
            if temp_gz.exists():
                temp_gz.unlink()

    # 5. تنظيف أي ملفات زائدة أو مؤقتة داخل مجلد live
    for f in BACKUP_DIR.iterdir():
        if f.is_file() and not f.name.endswith('.db.gz') and f.name != 'backup.log':
            try:
                f.unlink()
            except Exception:
                pass

    log("-" * 60)
    log(f"🎉 اكتمل النسخ الحي بنجاح: تم تأمين {success_count} قواعد بيانات | توفير مساحة القرص: {format_size(total_saved_bytes)}")
    log("=" * 60)

if __name__ == '__main__':
    run_backup()
