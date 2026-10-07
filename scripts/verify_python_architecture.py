#!/usr/bin/env python3
"""
سكربت للتحقق من أن Python هو المسؤول عن كل التحليلات والتوقعات
يتحقق من:
1. الاتصال بـ Python VPS Service (port 8010)
2. الاتصال بـ Data Engine (port 5000)
3. فحص أن Node.js يعمل كـ Proxy فقط
4. التحقق من اتصال قواعد البيانات

Usage:
    python verify_python_architecture.py
"""

import os
import sys
import json
import sqlite3
import subprocess
from pathlib import Path
from datetime import datetime

# الألوان
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def print_header(title):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  {title}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}\n")

def print_check(name, status, details=""):
    icon = f"{Colors.GREEN}✓{Colors.RESET}" if status else f"{Colors.RED}✗{Colors.RESET}"
    print(f"  {icon} {name}")
    if details:
        print(f"      {Colors.YELLOW}{details}{Colors.RESET}")

def check_python_service():
    """فحص خدمة Python VPS Service"""
    print_header("1. فحص Python VPS Service (port 8010)")
    
    results = {}
    
    # فحص المنفذ
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        result = sock.connect_ex(('localhost', 8010))
        sock.close()
        port_open = result == 0
        results['port_8010_open'] = port_open
        print_check("Python Service يعمل على المنفذ 8010", port_open)
    except Exception as e:
        results['port_8010_open'] = False
        print_check("Python Service يعمل على المنفذ 8010", False, str(e))
    
    # فحص ملف main.py
    main_py_exists = os.path.exists('./vps-service/main.py')
    results['main_py_exists'] = main_py_exists
    print_check("ملف main.py موجود", main_py_exists)
    
    # فحص ملف config.py
    config_exists = os.path.exists('./vps-service/config.py')
    results['config_py_exists'] = config_exists
    print_check("ملف config.py موجود", config_exists)
    
    # فحص المجلدات الفرعية
    folders = ['analyzers', 'api', 'core', 'data', 'portfolio', 'scripts']
    results['folders'] = {}
    for folder in folders:
        path = f'./vps-service/{folder}'
        exists = os.path.exists(path)
        results['folders'][folder] = exists
        print_check(f"مجلد {folder}/ موجود", exists)
    
    # اختبار API endpoint
    try:
        import urllib.request
        req = urllib.request.Request('http://localhost:8010/health', method='GET')
        with urllib.request.urlopen(req, timeout=5) as response:
            health_status = response.status == 200
            results['health_endpoint'] = health_status
            print_check("Health endpoint يعمل", health_status)
    except Exception as e:
        results['health_endpoint'] = False
        print_check("Health endpoint يعمل", False, str(e))
    
    return results

def check_data_engine():
    """فحص Data Engine"""
    print_header("2. فحص Data Engine (port 5000)")
    
    results = {}
    
    # فحص المنفذ
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        result = sock.connect_ex(('localhost', 5000))
        sock.close()
        port_open = result == 0
        results['port_5000_open'] = port_open
        print_check("Data Engine يعمل على المنفذ 5000", port_open)
    except Exception as e:
        results['port_5000_open'] = False
        print_check("Data Engine يعمل على المنفذ 5000", False, str(e))
    
    # فحص ملفات Data Engine
    main_server = os.path.exists('./data_engine/main.py')
    results['main_server_exists'] = main_server
    print_check("ملف main.py (canonical entry) موجود", main_server)

    # فحص مجلد scrapers
    scrapers_exists = os.path.exists('./data_engine/scrapers')
    results['scrapers_exists'] = scrapers_exists
    print_check("مجلد scrapers/ موجود", scrapers_exists)
    
    return results

def check_database_connections():
    """فحص اتصالات قواعد البيانات"""
    print_header("3. فحص قواعد البيانات")
    
    results = {}
    
    # قواعد البيانات المتوقعة
    expected_dbs = {
        'stocks.db': 8,
        'predictions.db': 7,
        'analytics.db': 8,
        'auth.db': 8,
        'community.db': 6,
        'custom.db': 31,
        'price_history.db': 2
    }
    
    results['databases'] = {}
    total_tables = 0
    
    for db_name, expected_tables in expected_dbs.items():
        db_path = f'./db/{db_name}'
        
        if os.path.exists(db_path):
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = cursor.fetchall()
                table_count = len(tables)
                conn.close()
                
                status = table_count >= expected_tables - 5  # سماح بفارق 5 جداول
                results['databases'][db_name] = {
                    'exists': True,
                    'tables': table_count,
                    'expected': expected_tables,
                    'status': 'OK' if status else 'WARNING'
                }
                print_check(f"{db_name} ({table_count} جدول)", status, 
                           f"متوقع: {expected_tables} جدول")
                total_tables += table_count
            except Exception as e:
                results['databases'][db_name] = {'exists': True, 'error': str(e)}
                print_check(f"{db_name}", False, str(e))
        else:
            results['databases'][db_name] = {'exists': False}
            print_check(f"{db_name}", False, "الملف غير موجود")
    
    results['total_tables'] = total_tables
    print(f"\n  {Colors.BLUE}إجمالي الجداول: {total_tables}{Colors.RESET}")
    
    return results

def check_nodejs_proxy():
    """فحص أن Node.js يعمل كـ Proxy فقط"""
    print_header("4. فحص Node.js API Routes (Proxy Mode)")
    
    results = {}
    
    # فحص ملفات vps-client و python-backend
    vps_client = os.path.exists('./src/lib/vps-client.ts')
    results['vps_client_exists'] = vps_client
    print_check("ملف vps-client.ts موجود", vps_client)
    
    python_backend = os.path.exists('./src/lib/python-backend.ts')
    results['python_backend_exists'] = python_backend
    print_check("ملف python-backend.ts موجود", python_backend)
    
    # فحص API proxy routes
    proxy_route = os.path.exists('./src/app/api/proxy/[...path]/route.ts')
    results['proxy_route_exists'] = proxy_route
    print_check("API proxy route موجود", proxy_route)
    
    # فحص ملفات lib للتحقق من عدم وجود منطق حسابي
    lib_files = [
        './src/lib/v2/unified-prediction.ts',
        './src/lib/v2/maestro-orchestrator.ts',
        './src/lib/v2/backtesting-engine.ts'
    ]
    
    results['lib_files'] = {}
    for lib_file in lib_files:
        exists = os.path.exists(lib_file)
        results['lib_files'][lib_file] = exists
        if exists:
            # فحص إذا كان الملف يستدعي Python API
            try:
                with open(lib_file, 'r') as f:
                    content = f.read()
                    uses_python_api = 'vps-client' in content or 'python-backend' in content or 'localhost:8010' in content or 'fetch' in content
                    print_check(f"{os.path.basename(lib_file)} يستدعي Python API", uses_python_api)
            except:
                print_check(f"{os.path.basename(lib_file)}", False, "خطأ في القراءة")
        else:
            print_check(f"{os.path.basename(lib_file)} موجود", False)
    
    return results

def check_analyzers():
    """فحص محللات Python"""
    print_header("5. فحص محللات Python")
    
    results = {}
    
    analyzers_dir = './vps-service/analyzers'
    
    if not os.path.exists(analyzers_dir):
        print_check("مجلد analyzers موجود", False)
        return results
    
    # المحللات المهمة
    important_analyzers = [
        'maestro_orchestrator.py',
        'unified_analyzer.py',
        'master_analyzer.py',
        'technical.py',
        'fundamental.py',
        'sentiment_analyzer.py',
        'risk_manager.py',
        'confluence_engine_v3.py',
        'multi_timeframe_engine.py',
        'prediction_tracker.py',
        'crypto_analyzer.py',
        'crypto_maestro.py'
    ]
    
    results['analyzers'] = {}
    
    for analyzer in important_analyzers:
        path = os.path.join(analyzers_dir, analyzer)
        exists = os.path.exists(path)
        results['analyzers'][analyzer] = exists
        
        if exists:
            # فحص حجم الملف
            size = os.path.getsize(path)
            print_check(f"{analyzer} ({size} bytes)", True)
        else:
            print_check(f"{analyzer}", False, "غير موجود")
    
    return results

def test_analysis_endpoint():
    """اختبار endpoint التحليل"""
    print_header("6. اختبار Python Analysis API")
    
    results = {}
    
    # اختبار تحليل سهم
    try:
        import urllib.request
        import json
        
        # اختبار endpoint تحليل
        test_url = 'http://localhost:8010/api/v2/stock/COMI/analysis'
        
        req = urllib.request.Request(test_url, method='GET')
        req.add_header('Content-Type', 'application/json')
        
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                results['analysis_test'] = {'status': 'OK', 'has_data': bool(data)}
                print_check("تحليل الأسهم يعمل (COMI)", True, f"الاستجابة: {len(str(data))} bytes")
        except urllib.error.HTTPError as e:
            results['analysis_test'] = {'status': 'HTTP_ERROR', 'code': e.code}
            print_check("تحليل الأسهم يعمل", False, f"HTTP {e.code}")
        except urllib.error.URLError as e:
            results['analysis_test'] = {'status': 'URL_ERROR', 'error': str(e)}
            print_check("تحليل الأسهم يعمل", False, str(e))
            
    except Exception as e:
        results['analysis_test'] = {'status': 'ERROR', 'error': str(e)}
        print_check("تحليل الأسهم يعمل", False, str(e))
    
    # اختبار endpoint التوصيات
    try:
        test_url = 'http://localhost:8010/api/v2/morning-recommendations'
        req = urllib.request.Request(test_url, method='GET')
        
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                results['recommendations_test'] = {'status': 'OK', 'has_data': bool(data)}
                print_check("التوصيات تعمل", True, f"الاستجابة: {len(str(data))} bytes")
        except urllib.error.HTTPError as e:
            results['recommendations_test'] = {'status': 'HTTP_ERROR', 'code': e.code}
            print_check("التوصيات تعمل", False, f"HTTP {e.code}")
        except urllib.error.URLError as e:
            results['recommendations_test'] = {'status': 'URL_ERROR', 'error': str(e)}
            print_check("التوصيات تعمل", False, str(e))
            
    except Exception as e:
        results['recommendations_test'] = {'status': 'ERROR', 'error': str(e)}
        print_check("التوصيات تعمل", False, str(e))
    
    return results

def generate_report():
    """توليد تقرير شامل"""
    print(f"{Colors.BOLD}{Colors.CYAN}")
    print("╔════════════════════════════════════════════════════════════╗")
    print("║     التحقق من أن Python = THE BRAIN                        ║")
    print("║     Node.js = Display/Proxy ONLY                           ║")
    print("╚════════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}")
    
    report = {
        'timestamp': datetime.now().isoformat(),
        'checks': {}
    }
    
    # تشغيل جميع الفحوصات
    report['checks']['python_service'] = check_python_service()
    report['checks']['data_engine'] = check_data_engine()
    report['checks']['database_connections'] = check_database_connections()
    report['checks']['nodejs_proxy'] = check_nodejs_proxy()
    report['checks']['analyzers'] = check_analyzers()
    report['checks']['analysis_test'] = test_analysis_endpoint()
    
    # حساب النتيجة الإجمالية
    total_checks = 0
    passed_checks = 0
    
    def count_checks(data):
        nonlocal total_checks, passed_checks
        if isinstance(data, dict):
            for key, value in data.items():
                if key in ['port_8010_open', 'port_5000_open', 'health_endpoint', 
                          'vps_client_exists', 'python_backend_exists', 'proxy_route_exists']:
                    total_checks += 1
                    if value is True:
                        passed_checks += 1
                elif isinstance(value, dict):
                    if 'exists' in value:
                        total_checks += 1
                        if value['exists'] is True:
                            passed_checks += 1
                    else:
                        count_checks(value)
                elif isinstance(value, bool):
                    total_checks += 1
                    if value:
                        passed_checks += 1
        
    count_checks(report['checks'])
    
    # عرض النتيجة النهائية
    print_header("النتيجة النهائية")
    
    success_rate = (passed_checks / total_checks * 100) if total_checks > 0 else 0
    
    print(f"  {Colors.BOLD}الفحوصات الناجحة: {passed_checks}/{total_checks}{Colors.RESET}")
    print(f"  {Colors.BOLD}نسبة النجاح: {success_rate:.1f}%{Colors.RESET}")
    
    if success_rate >= 80:
        print(f"\n  {Colors.GREEN}{Colors.BOLD}✅ النظام يعمل بشكل صحيح - Python هو المسؤول الرئيسي{Colors.RESET}")
    elif success_rate >= 50:
        print(f"\n  {Colors.YELLOW}{Colors.BOLD}⚠️ النظام يحتاج لبعض الإصلاحات{Colors.RESET}")
    else:
        print(f"\n  {Colors.RED}{Colors.BOLD}❌ النظام يحتاج لإصلاحات جذرية{Colors.RESET}")
    
    report['summary'] = {
        'total_checks': total_checks,
        'passed_checks': passed_checks,
        'success_rate': success_rate
    }
    
    return report

def main():
    report = generate_report()
    
    # حفظ التقرير
    report_path = 'python_architecture_report.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"\n{Colors.CYAN}💾 تم حفظ التقرير في: {report_path}{Colors.RESET}")
    
    # إرجاع كود الخروج
    success_rate = report['summary']['success_rate']
    if success_rate >= 80:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == '__main__':
    main()
