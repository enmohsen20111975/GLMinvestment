#!/usr/bin/env python3
"""
سكريبت فحص قواعد البيانات على السيرفر الإنتاجي
يتم تشغيله على السيرفر الإنتاجي لجمع معلومات كل قواعد البيانات

التشغيل:
python3 check_all_databases_production.py

الناتج: تقرير JSON شامل عن كل قواعد البيانات
"""

import os
import sqlite3
import json
from pathlib import Path
from datetime import datetime

def get_db_info(db_path):
    """الحصول على معلومات قاعدة بيانات واحدة"""
    info = {
        "path": str(db_path),
        "exists": False,
        "size_bytes": 0,
        "size_human": "",
        "tables": [],
        "table_counts": {},
        "error": None
    }

    if not os.path.exists(db_path):
        return info

    info["exists"] = True
    info["size_bytes"] = os.path.getsize(db_path)
    info["size_human"] = format_size(info["size_bytes"])

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # الحصول على قائمة الجداول
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row[0] for row in cursor.fetchall()]
        info["tables"] = tables

        # عدد السجلات في كل جدول
        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
                count = cursor.fetchone()[0]
                info["table_counts"][table] = count
            except:
                info["table_counts"][table] = "ERROR"

        conn.close()
    except Exception as e:
        info["error"] = str(e)

    return info

def format_size(size_bytes):
    """تحويل الحجم إلى صيغة مقروءة"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.2f} TB"

def find_all_databases(root_path):
    """البحث عن كل ملفات قواعد البيانات"""
    db_files = []
    for ext in ['*.db', '*.sqlite', '*.sqlite3']:
        db_files.extend(Path(root_path).rglob(ext))
    return list(set(db_files))

def check_db_configs(project_path):
    """فحص ملفات التكوين لقواعد البيانات"""
    configs = {}

    # Prisma schema
    prisma_path = os.path.join(project_path, "prisma", "schema.prisma")
    if os.path.exists(prisma_path):
        with open(prisma_path, 'r') as f:
            content = f.read()
            # استخراج مسار DB
            if "url" in content:
                lines = content.split('\n')
                for line in lines:
                    if 'url' in line and 'file:' in line:
                        configs["prisma_schema_url"] = line.strip()

    # .env file
    env_path = os.path.join(project_path, ".env")
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                if 'DATABASE' in line.upper():
                    configs["env_" + line.split('=')[0]] = line.strip()

    # Python config
    python_configs = [
        "vps-service/config.py",
        "data_engine/config.py",
        "vps-service/core/database.py"
    ]
    for py_config in python_configs:
        py_path = os.path.join(project_path, py_config)
        if os.path.exists(py_path):
            with open(py_path, 'r') as f:
                content = f.read()
                configs[f"python_{os.path.basename(py_config)}"] = "EXISTS"

    return configs

def main():
    print("=" * 60)
    print("فحص قواعد البيانات على السيرفر الإنتاجي")
    print("=" * 60)
    print(f"تاريخ الفحص: {datetime.now().isoformat()}")
    print()

    # المسار الحالي
    project_path = os.getcwd()
    print(f"مسار المشروع: {project_path}")
    print()

    # البحث عن كل قواعد البيانات
    print("البحث عن كل ملفات قواعد البيانات...")
    all_dbs = find_all_databases(project_path)
    print(f"تم العثور على {len(all_dbs)} ملف قاعدة بيانات")
    print()

    # فحص كل قاعدة بيانات
    databases_info = []
    for db_path in sorted(all_dbs):
        rel_path = os.path.relpath(db_path, project_path)
        print(f"فحص: {rel_path}")
        info = get_db_info(str(db_path))
        info["relative_path"] = rel_path
        databases_info.append(info)

        if info["exists"]:
            print(f"  الحجم: {info['size_human']}")
            print(f"  الجداول: {len(info['tables'])}")
        print()

    # فحص التكوينات
    print("=" * 60)
    print("فحص ملفات التكوين")
    print("=" * 60)
    configs = check_db_configs(project_path)
    for key, value in configs.items():
        print(f"{key}: {value}")
    print()

    # إنشاء التقرير
    report = {
        "scan_date": datetime.now().isoformat(),
        "project_path": project_path,
        "total_databases": len(databases_info),
        "databases": databases_info,
        "configs": configs,
        "summary": {
            "total_size_bytes": sum(db["size_bytes"] for db in databases_info),
            "total_tables": sum(len(db["tables"]) for db in databases_info),
            "db_locations": list(set(os.path.dirname(db["relative_path"]) for db in databases_info if db["exists"]))
        }
    }

    # حفظ التقرير
    report_path = "database_report.json"
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print("=" * 60)
    print("ملخص")
    print("=" * 60)
    print(f"إجمالي قواعد البيانات: {len(databases_info)}")
    print(f"إجمالي الحجم: {format_size(report['summary']['total_size_bytes'])}")
    print(f"إجمالي الجداول: {report['summary']['total_tables']}")
    print(f"أماكن قواعد البيانات: {report['summary']['db_locations']}")
    print()
    print(f"تم حفظ التقرير في: {report_path}")

    # طباعة جدول ملخص
    print()
    print("=" * 60)
    print("جدول قواعد البيانات")
    print("=" * 60)
    print(f"{'المسار':<40} {'الحجم':<15} {'الجداول':<10}")
    print("-" * 65)
    for db in sorted(databases_info, key=lambda x: x["size_bytes"], reverse=True):
        if db["exists"]:
            print(f"{db['relative_path']:<40} {db['size_human']:<15} {len(db['tables']):<10}")

    return report

if __name__ == "__main__":
    main()
