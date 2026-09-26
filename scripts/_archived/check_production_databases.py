#!/usr/bin/env python3
"""
سكربت لفحص قواعد البيانات على السيرفر الإنتاجي
يجب تشغيل هذا السكربت على السيرفر الإنتاجي لجلب معلومات قواعد البيانات

Usage:
    python check_production_databases.py
    python check_production_databases.py --json > production_db_report.json
"""

import os
import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime

# ألوان للطباعة
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def find_database_files(root_paths=None):
    """البحث عن ملفات قواعد البيانات في المسارات المحددة"""
    if root_paths is None:
        root_paths = [
            '.',           # المسار الحالي
            '/var/www',    # مسار شائع للتطبيقات
            '/home',       # مسار المستخدمين
            '/opt',        # مسار التطبيقات الاختيارية
        ]
    
    db_files = []
    extensions = ['.db', '.sqlite', '.sqlite3']
    
    for root_path in root_paths:
        if not os.path.exists(root_path):
            continue
        
        for root, dirs, files in os.walk(root_path):
            # تخطي المجلدات المخفية والمجلدات الكبيرة
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'venv', '.git']]
            
            for file in files:
                if any(file.endswith(ext) for ext in extensions):
                    full_path = os.path.join(root, file)
                    try:
                        size = os.path.getsize(full_path)
                        db_files.append({
                            'path': full_path,
                            'name': file,
                            'size': size,
                            'size_human': format_size(size)
                        })
                    except Exception as e:
                        pass
    
    return db_files

def format_size(size):
    """تحويل حجم الملف لصيغة مقروءة"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} TB"

def get_table_info(db_path):
    """جلب معلومات الجداول من قاعدة البيانات"""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # جلب أسماء الجداول
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()
        
        table_info = []
        for (table_name,) in tables:
            # جلب عدد الصفوف
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                row_count = cursor.fetchone()[0]
            except:
                row_count = 'N/A'
            
            # جلب هيكل الجدول
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            
            column_details = []
            for col in columns:
                column_details.append({
                    'name': col[1],
                    'type': col[2],
                    'notnull': bool(col[3]),
                    'primary_key': bool(col[5])
                })
            
            table_info.append({
                'name': table_name,
                'row_count': row_count,
                'column_count': len(columns),
                'columns': column_details
            })
        
        conn.close()
        return table_info
    except Exception as e:
        return {'error': str(e)}

def check_python_backend():
    """فحص حالة الـ Python Backend"""
    result = {
        'vps_service': False,
        'data_engine': False,
        'port_8010': False,
        'port_5000': False
    }
    
    # فحص وجود مجلد vps-service
    if os.path.exists('./vps-service'):
        result['vps_service'] = True
        
        # فحص الملفات الرئيسية
        main_files = ['main.py', 'config.py']
        for f in main_files:
            if os.path.exists(f'./vps-service/{f}'):
                result[f'vps_{f}'] = True
    
    # فحص وجود مجلد data_engine
    if os.path.exists('./data_engine'):
        result['data_engine'] = True
    
    # فحص المنافذ
    import subprocess
    try:
        result['port_8010'] = bool(subprocess.run(['lsof', '-i', ':8010'], capture_output=True).stdout)
    except:
        pass
    
    try:
        result['port_5000'] = bool(subprocess.run(['lsof', '-i', ':5000'], capture_output=True).stdout)
    except:
        pass
    
    return result

def check_nodejs_api_routes():
    """فحص مسارات API في Node.js"""
    api_routes = []
    
    api_path = './src/app/api'
    if not os.path.exists(api_path):
        return {'error': 'API folder not found'}
    
    for root, dirs, files in os.walk(api_path):
        if 'route.ts' in files or 'route.js' in files:
            relative_path = os.path.relpath(root, api_path)
            api_routes.append(f'/api/{relative_path}')
    
    return {
        'count': len(api_routes),
        'routes': sorted(api_routes)
    }

def analyze_db_structure():
    """تحليل كامل لهيكل قواعد البيانات"""
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  تقرير قواعد البيانات على السيرفر الإنتاجي{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}\n")
    
    # البحث عن قواعد البيانات
    print(f"{Colors.YELLOW}[1] البحث عن ملفات قواعد البيانات...{Colors.RESET}")
    db_files = find_database_files()
    
    if not db_files:
        print(f"{Colors.RED}❌ لم يتم العثور على ملفات قواعد بيانات!{Colors.RESET}")
        return
    
    print(f"{Colors.GREEN}✓ تم العثور على {len(db_files)} ملف قاعدة بيانات{Colors.RESET}\n")
    
    # عرض الملفات
    print(f"{Colors.YELLOW}[2] ملفات قواعد البيانات:{Colors.RESET}")
    print("-" * 80)
    print(f"{'الملف':<40} {'الحجم':<15} {'المسار'}")
    print("-" * 80)
    
    for db in sorted(db_files, key=lambda x: x['size'], reverse=True):
        print(f"{db['name']:<40} {db['size_human']:<15} {db['path']}")
    
    print()
    
    # تفاصيل كل قاعدة بيانات
    print(f"{Colors.YELLOW}[3] تفاصيل الجداول لكل قاعدة بيانات:{Colors.RESET}")
    print("=" * 80)
    
    all_databases = []
    
    for db in sorted(db_files, key=lambda x: x['name']):
        print(f"\n{Colors.BOLD}{Colors.BLUE}📦 {db['name']} ({db['size_human']}){Colors.RESET}")
        print("-" * 60)
        
        table_info = get_table_info(db['path'])
        
        if isinstance(table_info, dict) and 'error' in table_info:
            print(f"{Colors.RED}❌ خطأ: {table_info['error']}{Colors.RESET}")
            continue
        
        db_data = {
            'name': db['name'],
            'path': db['path'],
            'size': db['size'],
            'tables': []
        }
        
        if table_info:
            print(f"{'الجدول':<30} {'الصفوف':<12} {'الأعمدة'}")
            print("-" * 60)
            
            for table in table_info:
                print(f"{table['name']:<30} {table['row_count']:<12} {table['column_count']}")
                
                db_data['tables'].append({
                    'name': table['name'],
                    'row_count': table['row_count'],
                    'column_count': table['column_count'],
                    'columns': table['columns']
                })
        
        all_databases.append(db_data)
    
    # فحص الـ Python Backend
    print(f"\n{Colors.YELLOW}[4] فحص Python Backend:{Colors.RESET}")
    print("-" * 60)
    python_status = check_python_backend()
    
    for key, value in python_status.items():
        status = f"{Colors.GREEN}✓{Colors.RESET}" if value else f"{Colors.RED}✗{Colors.RESET}"
        print(f"{key:<25} {status}")
    
    # فحص Node.js API Routes
    print(f"\n{Colors.YELLOW}[5] فحص Node.js API Routes:{Colors.RESET}")
    print("-" * 60)
    api_status = check_nodejs_api_routes()
    
    if 'error' in api_status:
        print(f"{Colors.RED}{api_status['error']}{Colors.RESET}")
    else:
        print(f"عدد المسارات: {api_status['count']}")
        print(f"\nالمسارات:")
        for route in api_status['routes'][:20]:  # عرض أول 20 مسار
            print(f"  {route}")
        if len(api_status['routes']) > 20:
            print(f"  ... و {len(api_status['routes']) - 20} مسار آخر")
    
    # ملخص
    print(f"\n{Colors.BOLD}{Colors.GREEN}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}  الملخص{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}{'='*60}{Colors.RESET}")
    
    total_tables = sum(len(db.get('tables', [])) for db in all_databases)
    total_size = sum(db['size'] for db in all_databases)
    
    print(f"  إجمالي ملفات قواعد البيانات: {len(db_files)}")
    print(f"  إجمالي الجداول: {total_tables}")
    print(f"  إجمالي الحجم: {format_size(total_size)}")
    print(f"  Python Backend نشط: {'نعم' if python_status.get('port_8010') else 'لا'}")
    print(f"  Data Engine نشط: {'نعم' if python_status.get('port_5000') else 'لا'}")
    
    return {
        'timestamp': datetime.now().isoformat(),
        'databases': all_databases,
        'python_backend': python_status,
        'api_routes': api_status,
        'summary': {
            'total_db_files': len(db_files),
            'total_tables': total_tables,
            'total_size': total_size
        }
    }

def main():
    json_output = '--json' in sys.argv
    
    if json_output:
        # إخراج JSON فقط
        result = analyze_db_structure()
        if result:
            # إزالة الألوان من الطباعة
            print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    else:
        # إخراج منسق
        result = analyze_db_structure()
        
        # حفظ التقرير
        if result:
            report_path = 'production_db_report.json'
            with open(report_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False, default=str)
            print(f"\n{Colors.CYAN}💾 تم حفظ التقرير في: {report_path}{Colors.RESET}")

if __name__ == '__main__':
    main()
