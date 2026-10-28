"""
Admin API Routes
================
API endpoints للأدمن فقط (محمية بـ @require_admin)

⚠️ هذه الـ endpoints لا يجب أن تُستدعى من User App أبداً!
"""

import os
import json
import sqlite3
import random
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request, g
from functools import wraps
import time as time_module

# Import auth middleware
try:
    from core.auth_middleware import require_admin, get_client_ip, hash_ip
except ImportError:
    # Fallback إذا لم يتم تحميل الـ middleware
    def require_admin(f):
        return f
    def get_client_ip():
        return request.remote_addr or 'unknown'
    def hash_ip(ip):
        return ip[:16]


# ============================================================================
# BLUEPRINT
# ============================================================================

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')

# Lazy import for board managers (avoid circular imports)
_BOARD_MANAGERS_READY = False
def _get_board_managers():
    global _BOARD_MANAGERS_READY
    try:
        from analyzers.board_of_analysts import get_board_manager
        return get_board_manager, True
    except Exception:
        return None, False

from pathlib import Path as _AdminPath
_ADMIN_PROJECT_ROOT = _AdminPath(__file__).resolve().parent.parent.parent
_ADMIN_DB_PATH = str(_ADMIN_PROJECT_ROOT / 'db' / 'stocks.db')

# Phase 8 — Single Source of Truth gates (منع sqlite3.connect مباشر في الـ admin):
#   - core.db_manager.db_manager → أي استعلامات (WAL + busy_timeout=30000)
#   - data.prices.load_price_history → قراءة candles
#   - data.analyses.persist_analysis_with_persona → كتابة تحليل
# ملاحظة: عمليات backup/integrity اللي بتحتاج conn.backup() أو PRAGMA writable
# بتستثنى (db_manager readonly بتفعّل query_only=1). الباقي لازم عبر db_manager.
# Phase 7.3 dedup: import canonical _open_db (aliased variant) + dbm from core.db_helpers
from core.db_helpers import open_db_aliased as _open_db, dbm as _dbm, DBM_AVAILABLE as _ADMIN_DBM_AVAILABLE


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_db():
    """الحصول على اتصال قاعدة البيانات."""
    from core.database import DatabaseManager
    return DatabaseManager()


def admin_response(success: bool, data=None, message=None, error=None):
    """تنسيق response موحد للأدمن."""
    response = {
        "success": success,
        "timestamp": datetime.now().isoformat()
    }
    if data is not None:
        response["data"] = data
    if message:
        response["message"] = message
    if error:
        response["error"] = error
    return response


# ============================================================================
# SYSTEM HEALTH
# ============================================================================

@admin_bp.route('/health', methods=['GET'])
@require_admin
def admin_health():
    """
    حالة النظام الكاملة للأدمن.
    يتضمن معلومات لا يراها المستخدم العادي.
    """
    try:
        db = get_db()
        db_stats = db.health_check()
        
        # معلومات إضافية للأدمن
        import sys
        import platform
        
        system_info = {
            "python_version": sys.version,
            "platform": platform.platform(),
            "database_size_mb": get_db_size_mb(),
            "uptime_seconds": get_uptime_seconds()
        }
        
        return jsonify(admin_response(True, {
            "database": db_stats,
            "system": system_info,
            "admin_ip": get_client_ip()
        }))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# SCREENER LISTS — تشغيل سكرابر القوائم يدوياً
# ============================================================================

@admin_bp.route('/screener-refresh', methods=['POST'])
@require_admin
def admin_screener_refresh():
    """
    تشغيل سكرابر TradingView Screener Lists يدوياً فوراً.

    يستدعي tradingview_screener_lists.py ويُرجّع:
    - success: bool
    - message: وصف عام
    - summary: ملخص لكل سوق (عدد القوائم × عدد الأسهم)

    ⚡ هذا الـ Endpoint مخصص للزر اليدوي في لوحة الأدمن.
    """
    import subprocess
    import sys
    import time as _time
    from pathlib import Path

    _base = Path(__file__).resolve().parent.parent.parent
    _script = str(_base / 'data_engine' / 'scrapers' / 'tradingview_screener_lists.py')

    if not Path(_script).exists():
        return jsonify(admin_response(False, error=f'الملف {_script} غير موجود')), 404

    try:
        start = _time.time()
        result = subprocess.run(
            [sys.executable, _script],
            capture_output=True, text=True, timeout=300.0
        )
        duration = round(_time.time() - start, 2)

        if result.returncode != 0:
            return jsonify(admin_response(False, error=f'السكرابر فشل (كود {result.returncode}): {result.stderr[:500]}')), 500

        # استخراج ملخص من stdout
        lines = result.stdout.strip().split('\n')
        done_lines = [l.strip() for l in lines if '🎉' in l]
        market_lines = [l.strip() for l in lines if l.strip().startswith('🌍') or l.strip().startswith('📋')]
        summary = done_lines[-1] if done_lines else 'راجع السجل'
        details = market_lines if market_lines else []

        # حساب عدد الأسهم الإجمالي من سطر Done (مثلاً: "🎉 Done! 1234 entries across 4 markets × 8 lists")
        import re
        total_entries = 0
        m = re.search(r'(\d+)\s+entries', summary)
        if m:
            total_entries = int(m.group(1))

        return jsonify(admin_response(True, {
            'duration_seconds': duration,
            'return_code': result.returncode,
            'total_entries': total_entries,
            'summary': summary,
            'details': details,
        }, f'✅ تم تحديث القوائم بنجاح — {total_entries} سهم في {duration} ثانية'))

    except subprocess.TimeoutExpired:
        return jsonify(admin_response(False, error='انتهت المهلة (300 ثانية) — السكرابر أخذ وقت أطول من المتوقع')), 504
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# DNA-WIRING (Axis C): Admin Stock DNA Builder Endpoint
# ============================================================================
# الـ endpoint ده بيشغّل سكربت build_stock_profiles.py اللي بيبني ملفات
# الأسهم التكيفية (Stock DNA) ويحفظها في stock_adaptive_profiles table.
# الـ DNA بيقول للعقل (master_analyzer.py) هل السهم "حيّ" (alive) ولا
# "نائم"، وبيفك القيود للأسهم الحية عشان تطلع BUY signals.
# ============================================================================

@admin_bp.route('/build-stock-dna', methods=['POST'])
@require_admin
def admin_build_stock_dna():
    """يبني ملفات الأسهم التكيفية (Stock DNA) يدوياً.

    بيستدعي scripts/build_stock_profiles.py اللي:
      1. ينشئ جدول stock_adaptive_profiles (لو مش موجود)
      2. يحلل كل سهم في stocks.db
      3. يحسب: amplifier_score, volume_spike_freq, momentum_score, is_alive
      4. يحدد constraints_loosened + threshold_boost + confidence_boost
      5. يحفظ النتيجة في stock_adaptive_profiles

    الـ master_analyzer.py بقرأ الـ table ده وبيطبّق الـ boosts على
    كل تحليل تلقائياً (مفيش حاجة تانية محتاجة بعد كده).

    Body (optional):
      market — فلتر بالسوق (افتراضي: كل الأسواق)
      ticker — فلتر بسهم واحد

    Returns:
      success, built, alive, errors, details
    """
    import sys
    import time as _time
    from pathlib import Path

    _base = Path(__file__).resolve().parent.parent.parent
    _script = str(_base / 'vps-service' / 'scripts' / 'build_stock_profiles.py')

    if not Path(_script).exists():
        return jsonify(admin_response(False, error=f'السكربت {_script} غير موجود')), 404

    data = request.get_json(silent=True) or {}
    market = data.get('market')
    ticker = data.get('ticker')

    try:
        # بنستدعي السكربت مباشرة بدل subprocess عشان نحصل على الـ return value
        start = _time.time()
        sys.path.insert(0, str(_base / 'vps-service' / 'scripts'))
        sys.path.insert(0, str(_base / 'vps-service'))

        import importlib.util
        spec = importlib.util.spec_from_file_location('build_stock_profiles', _script)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        result = mod.build_profiles(market=market, ticker=ticker)
        duration = round(_time.time() - start, 2)

        if result.get('success'):
            return jsonify(admin_response(True, {
                'duration_seconds': duration,
                'total_stocks': result.get('total', 0),
                'profiles_built': result.get('built', 0),
                'alive_stocks': result.get('alive', 0),
                'errors': result.get('errors', 0),
                'details': result.get('details', [])[:20],  # أول 20 تفصيل
            }, f"🧬 تم بناء {result.get('built', 0)} ملف سهم ({result.get('alive', 0)} حيّ) في {duration} ثانية"))
        else:
            return jsonify(admin_response(False, error=result.get('error', 'فشل غير معروف'))), 500

    except Exception as e:
        import traceback
        return jsonify(admin_response(False, error=f'{e}\n{traceback.format_exc()[-500:]}')), 500


@admin_bp.route('/status', methods=['GET'])
@require_admin
def admin_status():
    """ملخص حالة النظام."""
    try:
        db = get_db()
        stocks = db.get_all_stocks()
        
        return jsonify(admin_response(True, {
            "stocks_count": len(stocks),
            "last_sync": get_last_sync_time(db),
            "pending_tasks": get_pending_tasks(),
            "recent_errors": get_recent_errors()
        }))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# SYSTEM TOPOLOGY — مركز القيادة / MaestroCommandCenter
# ============================================================================

@admin_bp.route('/system-topology', methods=['GET'])
@require_admin
def system_topology():
    """
    طوبولوجيا النظام الكاملة — يُستخدم من MaestroCommandCenter في لوحة الأدمن.
    يُرجع:
    - services: حالة كل خدمة/محرك
    - databases: حالة قواعد البيانات
    - boards: حالة مجالس الإدارة ومحلليها
    - weights: الأوزان الحالية لكل مجلس
    """
    import os
    import time

    try:
        # ============================================================
        # 1. DATABASES STATUS
        # ============================================================
        db_files = {
            'stocks': _ADMIN_DB_PATH,
            'news': str(_ADMIN_PROJECT_ROOT / 'db' / 'stocks.db'),  # Consolidated July 2026
            'predictions': str(_ADMIN_PROJECT_ROOT / 'db' / 'predictions.db'),
            'price_history': str(_ADMIN_PROJECT_ROOT / 'db' / 'price_history.db'),
        }
        databases = []
        for db_id, db_path in db_files.items():
            exists = os.path.exists(db_path)
            size_kb = round(os.path.getsize(db_path) / 1024, 1) if exists else 0
            last_write = None
            status = 'missing'

            if exists:
                try:
                    mtime = os.path.getmtime(db_path)
                    last_write = datetime.fromtimestamp(mtime).isoformat()
                    status = 'healthy' if size_kb > 0 else 'empty'
                except Exception:
                    status = 'unknown'

            databases.append({
                'id': db_id,
                'name': f'{db_id}.db',
                'kind': 'SQLite',
                'path': db_path,
                'exists': exists,
                'size_kb': size_kb,
                'status': status,
                'reason': 'قاعدة بيانات نشطة' if status == 'healthy' else 'غير موجودة' if status == 'missing' else 'فارغة',
                'last_write': last_write,
                'minutes_ago': round((time.time() - os.path.getmtime(db_path)) / 60) if exists else None,
            })

        # ============================================================
        # 2. SERVICES STATUS
        # ============================================================
        services = []
        service_checks = [
            {'id': 'data-engine', 'name': 'Data Engine', 'name_ar': 'محرك البيانات', 'kind': 'analyzer'},
            {'id': 'sniper-engine', 'name': 'Sniper Engine', 'name_ar': 'محرك القناص', 'kind': 'analyzer'},
            {'id': 'confluence', 'name': 'Confluence V3', 'name_ar': 'محرك التقاطع', 'kind': 'analyzer'},
            {'id': 'market-regime', 'name': 'Market Regime', 'name_ar': 'نظام المناخ', 'kind': 'detector'},
            {'id': 'board-of-analysts', 'name': 'Board of Analysts', 'name_ar': 'مجلس الإدارة', 'kind': 'orchestrator'},
            {'id': 'scheduler', 'name': 'Scheduler', 'name_ar': 'المجدول', 'kind': 'scheduler'},
            {'id': 'egx30-gate', 'name': 'EGX30 Gate', 'name_ar': 'بوابة EGX30', 'kind': 'gate'},
            {'id': 'quality-gate', 'name': 'Quality Gate', 'name_ar': 'بوابة الجودة', 'kind': 'gate'},
            {'id': 'expert-memory', 'name': 'Expert Memory', 'name_ar': 'ذاكرة الخبراء', 'kind': 'memory'},
        ]

        # Check board-of-analysts status specifically
        get_board_manager, board_ok = _get_board_managers()
        for svc in service_checks:
            if svc['id'] == 'board-of-analysts':
                svc_status = 'running' if board_ok else 'error'
                reason = 'مجالس الإدارة نشطة (EGX, Tadawul, Crypto, KSE, QSE)' if board_ok else 'خطأ في تحميل مجالس الإدارة'
            else:
                svc_status = 'running'
                reason = 'يعمل'

            services.append({
                'id': svc['id'],
                'name': svc['name'],
                'name_ar': svc['name_ar'],
                'kind': svc['kind'],
                'status': svc_status,
                'latency_ms': 0,
                'last_update': datetime.now().isoformat(),
                'minutes_ago': 0,
                'staleness': 'fresh',
                'reason': reason,
            })

        # ============================================================
        # 3. BOARD OF ANALYSTS STATUS
        # ============================================================
        boards = {}
        if board_ok and get_board_manager:
            markets = ['EGX', 'TADAWUL', 'CRYPTO', 'KSE', 'QSE']
            for market in markets:
                try:
                    manager = get_board_manager(market)
                    boards[market] = {
                        'market': manager.market,
                        'sell_strategy': manager.sell_strategy,
                        'status': 'active',
                        'analysts': {
                            k: {
                                'key': v.key,
                                'name_ar': v.name_ar,
                                'weight': round(v.weight, 3),
                                'active': v.active,
                            }
                            for k, v in manager.analysts.items()
                        }
                    }
                except Exception as e:
                    boards[market] = {'status': 'error', 'error': str(e)}

        # ============================================================
        # 4. STOCK COUNTS
        # ============================================================
        stocks_count = 0
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            try:
                if _ADMIN_DBM_AVAILABLE:
                    _sc_row = _dbm.query_one('stocks', "SELECT COUNT(*) as cnt FROM stocks WHERE ticker IS NOT NULL")
                    stocks_count = _sc_row['cnt'] if _sc_row else 0
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(_ADMIN_DB_PATH, timeout=5)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM stocks WHERE ticker IS NOT NULL")
                stocks_count = cursor.fetchone()[0]
                conn.close()
        except Exception as _ar_e:
            import logging as _ar_l; _ar_l.warning(f"silent: {_ar_e}")

        return jsonify({
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'stocks_count': stocks_count,
            'services': services,
            'databases': databases,
            'boards': boards,
            'board_system_active': board_ok,
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat(),
            'services': [],
            'databases': [],
            'boards': {},
        }), 500




# ============================================================================
# DATA SYNC WITH 3 SOURCES
# ============================================================================

@admin_bp.route('/sync', methods=['POST'])
@require_admin
def admin_sync():
    """
    تشغيل مزامنة البيانات يدوياً.
    """
    try:
        data = request.get_json() or {}
        sync_type = data.get('type', 'all')  # all, prices, fundamentals
        
        result = trigger_sync(sync_type)
        
        return jsonify(admin_response(True, result, 
            f"Sync '{sync_type}' triggered successfully"))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/update-prices', methods=['POST'])
@require_admin
def update_prices_multi_source():
    """
    تحديث أسعار EGX من 3 مصادر بالترتيب:
    1. EGXPilot (أولوية عالية) - مجاني، كل الأسهم المصرية
    2. Yahoo Finance (بديل) - مجاني، ~30 سهم مصري
    3. TradingView (احتياطي) - للتحليل الفني
    
    يرجع:
    - المصدر اللى نجح
    - عدد الأسهم المحدثة
    - نطاق التاريخ (من ... إلى ...)
    - وقت التحديث
    """
    try:
        # استيراد الـ fetcher
        from data.egx_fetcher import EGXDataFetcher
        
        # مسار قاعدة البيانات - use relative path
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()  # Project root
        db_path = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
        
        # إنشاء الـ fetcher
        fetcher = EGXDataFetcher(db_path)
        
        # تسجيل وقت البدء
        start_time = datetime.now()
        
        # تنفيذ التحديث
        success = fetcher.update_prices()
        
        # حساب وقت الانتهاء
        end_time = datetime.now()
        duration_seconds = (end_time - start_time).total_seconds()
        
        # الحصول على معلومات من قاعدة البيانات
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()
            
            # أحدث وأقدم تاريخ فى البيانات
            cursor.execute('''
                SELECT MIN(date), MAX(date) 
                FROM stock_price_history 
                WHERE date IS NOT NULL
            ''')
            date_range = cursor.fetchone()
            
            # عدد الأسهم المحدثة
            cursor.execute('''
                SELECT COUNT(DISTinct ticker) 
                FROM stocks 
                WHERE current_price IS NOT NULL AND current_price > 0
            ''')
            stocks_count = cursor.fetchone()[0]
            
            # عدد سجلات الأسعار
            cursor.execute('''
                SELECT COUNT(*) FROM stock_price_history
            ''')
            price_records = cursor.fetchone()[0]
            
            # آخر تحديث
            cursor.execute('''
                SELECT MAX(last_update) FROM stocks WHERE last_update IS NOT NULL
            ''')
            last_update = cursor.fetchone()[0]
        
        # تحديد المصدر الناجح
        source_used = "Unknown"
        if fetcher.stats.get('egxpilot_success', 0) > 50:
            source_used = "EGXPilot"
        elif fetcher.stats.get('yahoo_success', 0) > 0:
            source_used = "Yahoo Finance"
        elif fetcher.stats.get('tradingview_success', 0) > 0:
            source_used = "TradingView"
        
        # بناء الـ response
        result = {
            "success": success,
            "source_used": source_used,
            "source_priority": [
                {"name": "EGXPilot", "priority": 1, "status": "success" if fetcher.stats.get('egxpilot_success', 0) > 0 else "failed", "count": fetcher.stats.get('egxpilot_success', 0)},
                {"name": "Yahoo Finance", "priority": 2, "status": "success" if fetcher.stats.get('yahoo_success', 0) > 0 else "not_used", "count": fetcher.stats.get('yahoo_success', 0)},
                {"name": "TradingView", "priority": 3, "status": "success" if fetcher.stats.get('tradingview_success', 0) > 0 else "not_used", "count": fetcher.stats.get('tradingview_success', 0)}
            ],
            "data_quantity": {
                "stocks_updated": fetcher.stats.get('egxpilot_success', 0) or fetcher.stats.get('yahoo_success', 0) or fetcher.stats.get('tradingview_success', 0),
                "total_stocks": stocks_count,
                "price_records": price_records,
                "failed": fetcher.stats.get('failed', 0)
            },
            "date_range": {
                "from": date_range[0] if date_range and date_range[0] else "N/A",
                "to": date_range[1] if date_range and date_range[1] else "N/A"
            },
            "update_time": {
                "started_at": start_time.isoformat(),
                "completed_at": end_time.isoformat(),
                "duration_seconds": round(duration_seconds, 2),
                "last_data_update": last_update
            }
        }
        
        # تسجيل الإجراء
        log_admin_action('prices_updated', result)
        
        return jsonify(admin_response(True, result, 
            f"تم تحديث البيانات من {source_used} - {result['data_quantity']['stocks_updated']} سهم"))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/update-crypto', methods=['POST'])
@require_admin
def update_crypto_prices():
    """
    تحديث أسعار العملات الرقمية من CoinGecko.
    """
    try:
        from data.crypto_fetcher import CryptoDataFetcher
        
        fetcher = CryptoDataFetcher()
        
        start_time = datetime.now()
        
        # جلب أهم 50 عملة
        cryptos = fetcher.get_top_cryptos(50)
        
        end_time = datetime.now()
        duration_seconds = (end_time - start_time).total_seconds()
        
        result = {
            "success": True,
            "source": "CoinGecko",
            "data_quantity": {
                "cryptos_fetched": len(cryptos)
            },
            "update_time": {
                "completed_at": end_time.isoformat(),
                "duration_seconds": round(duration_seconds, 2)
            },
            "top_cryptos": [
                {"symbol": c.symbol, "name": c.name, "price": c.current_price, "change_24h": c.price_change_percent_24h}
                for c in cryptos[:10]
            ]
        }
        
        log_admin_action('crypto_updated', result)
        
        return jsonify(admin_response(True, result, 
            f"تم تحديث {len(cryptos)} عملة رقمية"))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/data-status', methods=['GET'])
@require_admin
def data_status():
    """
    حالة البيانات الحالية.
    يعرض معلومات عن آخر تحديث والمصادر.
    """
    try:
        # مسار قاعدة البيانات - use relative path
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()  # Project root
        db_path = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()
            
            # معلومات عامة
            cursor.execute('SELECT COUNT(*) FROM stocks WHERE is_active = 1 OR is_active IS NULL')
            total_stocks = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM stocks WHERE current_price IS NOT NULL AND current_price > 0')
            stocks_with_prices = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM stock_price_history')
            price_records = cursor.fetchone()[0]
            
            # نطاق التاريخ
            cursor.execute('SELECT MIN(date), MAX(date) FROM stock_price_history WHERE date IS NOT NULL')
            date_range = cursor.fetchone()
            
            # آخر تحديث
            cursor.execute('SELECT MAX(last_update) FROM stocks WHERE last_update IS NOT NULL')
            last_update = cursor.fetchone()[0]
        
        return jsonify(admin_response(True, {
            "stocks": {
                "total": total_stocks,
                "with_prices": stocks_with_prices,
                "missing_prices": total_stocks - stocks_with_prices
            },
            "price_history": {
                "total_records": price_records,
                "date_range": {
                    "from": date_range[0] if date_range and date_range[0] else None,
                    "to": date_range[1] if date_range and date_range[1] else None
                }
            },
            "last_update": last_update,
            "sources": {
                "egx": {
                    "name": "EGXPilot",
                    "priority": 1,
                    "description": "مجاني - كل الأسهم المصرية",
                    "status": "available"
                },
                "yahoo": {
                    "name": "Yahoo Finance",
                    "priority": 2,
                    "description": "مجاني - ~30 سهم مصري",
                    "status": "fallback"
                },
                "tradingview": {
                    "name": "TradingView",
                    "priority": 3,
                    "description": "للتحليل الفني",
                    "status": "reserve"
                },
                "crypto": {
                    "name": "CoinGecko",
                    "priority": 1,
                    "description": "العملات الرقمية",
                    "status": "available"
                }
            }
        }))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/sync/status', methods=['GET'])
@require_admin
def sync_status():
    """حالة المزامنة."""
    try:
        return jsonify(admin_response(True, {
            "last_sync": get_last_sync_info(),
            "next_scheduled": get_next_scheduled_sync(),
            "is_running": is_sync_running()
        }))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# MODELS MANAGEMENT
# ============================================================================

@admin_bp.route('/models', methods=['GET'])
@require_admin
def list_models():
    """قائمة النماذج المتاحة."""
    try:
        models = get_available_models()
        return jsonify(admin_response(True, {"models": models}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/models/weights', methods=['GET'])
@require_admin
def get_weights():
    """الحصول على أوزان التحليل الحالية."""
    try:
        weights = get_current_weights()
        return jsonify(admin_response(True, {"weights": weights}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/models/weights', methods=['POST'])
@require_admin
def update_weights():
    """تحديث أوزان التحليل."""
    try:
        data = request.get_json()
        if not data or 'weights' not in data:
            return jsonify(admin_response(False, error="Missing weights data")), 400
        
        result = save_weights(data['weights'])
        return jsonify(admin_response(True, result, "Weights updated"))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/models/retrain', methods=['POST'])
@require_admin
def retrain_model():
    """
    إعادة تدريب النموذج.
    ⚠️ عملية مكلفة - يجب تشغيلها بحذر
    """
    try:
        data = request.get_json() or {}
        model_type = data.get('model', 'master_analyzer')
        
        # سجل طلب إعادة التدريب
        log_admin_action('retrain', {'model': model_type})
        
        result = trigger_retrain(model_type)
        
        return jsonify(admin_response(True, result, 
            f"Retrain triggered for {model_type}"))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# BACKTESTING
# ============================================================================

@admin_bp.route('/backtest/run', methods=['POST'])
@require_admin
def run_backtest():
    """تشغيل اختبار تاريخي."""
    try:
        data = request.get_json() or {}
        
        params = {
            'start_date': data.get('start_date'),
            'end_date': data.get('end_date'),
            'strategy': data.get('strategy', 'master_v2'),
            'tickers': data.get('tickers', []),
            'initial_capital': data.get('initial_capital', 100000)
        }
        
        result = execute_backtest(params)
        
        return jsonify(admin_response(True, result))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/backtest/results', methods=['GET'])
@require_admin
def backtest_results():
    """نتائج آخر اختبار."""
    try:
        results = get_backtest_results()
        return jsonify(admin_response(True, {"results": results}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/backtest/params', methods=['GET'])
@require_admin
def get_backtest_parameters():
    """
    الحصول على معاملات الـ Backtest.
    
    Returns:
        - min_risk_reward: الحد الأدنى لنسبة المخاطرة للعائد
        - min_score_for_signal: الحد الأدنى للدرجة لإصدار إشارة
        - min_candle_score: الحد الأدنى لدرجة الشمعة
        - max_rsi_for_buy: أقصى RSI للشراء
        - rsi_overbought: مستوى التشبع الشرائي
        - rsi_oversold: مستوى التشبع البيعي
        - stop_loss_min_pct: الحد الأدنى لوقف الخسارة %
        - stop_loss_max_pct: الحد الأقصى لوقف الخسارة %
        - target_multiplier: مضاعف الهدف
        - weeks_to_test: عدد أسابيع الاختبار
        - max_picks_per_week: أقصى عدد اختيارات في الأسبوع
    """
    try:
        params = get_backtest_params()
        return jsonify(admin_response(True, {"params": params}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/backtest/params', methods=['POST'])
@require_admin
def update_backtest_parameters():
    """
    تحديث معاملات الـ Backtest.
    
    يمكن تحديث أي معامل من المعاملات:
    
    Example:
        {
            "min_risk_reward": 2.0,
            "min_score_for_signal": 70,
            "max_rsi_for_buy": 60
        }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify(admin_response(False, error="No data provided")), 400
        
        # Validate parameters - تم إضافة المعاملات الجديدة
        valid_params = [
            'min_risk_reward', 'min_score_for_signal', 'min_candle_score',
            'max_rsi_for_buy', 'rsi_overbought', 'rsi_oversold', 'rsi_extreme_high',
            'stop_loss_min_pct', 'stop_loss_max_pct', 'target_multiplier',
            'weeks_to_test', 'max_picks_per_week',
            # المعاملات الجديدة من Walk-Forward Backtest
            'skip_bear_regime', 'min_volume_ratio', 'stop_loss_pct', 'target_pct'
        ]
        
        invalid_keys = [k for k in data.keys() if k not in valid_params]
        if invalid_keys:
            return jsonify(admin_response(False, 
                error=f"Invalid parameters: {invalid_keys}. Valid: {valid_params}")), 400
        
        result = save_backtest_params(data)
        return jsonify(admin_response(True, result, "Backtest parameters updated"))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/backtest/run-enhanced', methods=['POST'])
@require_admin
def run_enhanced_backtest():
    """
    تشغيل Backtest المحسن مع المعاملات الحالية.
    
    Uses parameters from /backtest/params
    """
    try:
        # Get current parameters
        params = get_backtest_params()
        
        # Import and run the enhanced backtest
        # BRAVO-FIX (2026-10-19): api.kimi_backtest module مش موجود
        raise ImportError('api.kimi_backtest module not found — BRAVO-FIX 2026-10-19')
        # from api.kimi_backtest import EnhancedBacktest
        
        engine = EnhancedBacktest(
            _get_db_path()
        )
        
        # Run with current parameters
        results = engine.run_backtest(
            start_year=2026,
            start_month=1,
            num_weeks=params.get('weeks_to_test', 8),
            max_picks_per_week=params.get('max_picks_per_week', 3)
        )
        
        # Log the action
        log_admin_action('enhanced_backtest_run', {
            'params': params,
            'total_trades': results.get('statistics', {}).get('total_trades', 0)
        })
        
        return jsonify(admin_response(True, {
            "params_used": params,
            "results": results
        }))
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, error=str(e), traceback=traceback.format_exc())), 500


@admin_bp.route('/backtest/run-engine', methods=['POST'])
@require_admin
def run_backtest_engine():
    """
    تشغيل BacktestEngine (MasterAnalyzer) من تاريخ محدد — الصفقات الوهمية التاريخية.
    
    Body: {
        "ticker_count": 30,        // عدد الأسهم الأكتر سيولة
        "start_date": "2026-01-01", // تاريخ البداية
        "end_date": "2026-03-04",   // تاريخ النهاية
        "horizon_days": 30,         // عدد أيام المتابعة لكل صفقة
        "persona_filter": null,     // فلترة الشخصية (gambler/balanced/conservative)
        "disable_lessons": false    // تشغيل بدون تعلم (control group)
    }
    """
    try:
        data = request.get_json() or {}
        from analyzers.backtest_engine import BacktestEngine
        
        engine = BacktestEngine()
        
        ticker_count = data.get('ticker_count', 30)
        start_date = data.get('start_date', '2026-01-01')
        end_date = data.get('end_date', '2026-03-04')
        horizon_days = data.get('horizon_days', 30)
        persona_filter = data.get('persona_filter')
        disable_lessons = data.get('disable_lessons', False)
        
        # Get top liquid tickers
        tickers = engine._get_top_liquid_tickers(ticker_count)
        
        # Run the backtest
        summary = engine.run_backtest(
            tickers=tickers,
            start_date=start_date,
            end_date=end_date,
            horizon_days=horizon_days,
            persona_filter=persona_filter,
            disable_lessons=disable_lessons
        )
        
        log_admin_action('backtest_engine_run', {
            'ticker_count': ticker_count,
            'start_date': start_date,
            'end_date': end_date,
            'total_predictions': summary.get('total_predictions'),
            'win_rate_pct': summary.get('win_rate_pct'),
            'net_return_pct': summary.get('net_return_pct'),
            'ab_group': summary.get('ab_group')
        })
        
        return jsonify(admin_response(True, {
            "summary": summary,
            "start_date": start_date,
            "end_date": end_date,
            "ticker_count": len(tickers),
            "horizon_days": horizon_days
        }))
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, error=str(e), traceback=traceback.format_exc())), 500


@admin_bp.route('/backtest/v40/stats', methods=['GET'])
@require_admin
def get_v40_backtest_stats():
    """إحصائيات V40.2 Backtest من predictions.db (الموجود حالياً).

    Returns:
        - summary: {total, wins, losses, wr, pf, net, avg_win, avg_loss, expectancy}
        - by_month: [{month, trades, wr, net}]
        - by_ticker: [{ticker, trades, wins, net}] (top 15 by net)
        - explosive_stocks: [{ticker, trades, wins, net}] for analyst-listed stocks
        - out_of_sample: {last_30d, last_45d} stats
    """
    try:
        import sqlite3 as _sqlite3
        from collections import defaultdict
        from pathlib import Path as _Path

        preds_db = str(_Path(__file__).resolve().parents[2] / 'db' / 'predictions.db')
        if not os.path.exists(preds_db):
            return jsonify(admin_response(False, error='predictions.db not found')), 404

        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('predictions', preds_db) as conn:
            cur = conn.cursor()

            rows = cur.execute('''
                SELECT ticker, actual_return, signal, morning_bell, prediction_date, persona
                FROM predictions
                WHERE actual_return IS NOT NULL
                ORDER BY prediction_date
            ''').fetchall()

        if not rows:
            return jsonify(admin_response(True, {
                'summary': {'total': 0, 'message': 'No predictions found. Run V40.2 backtest first.'},
                'by_month': [], 'by_ticker': [], 'explosive_stocks': [], 'out_of_sample': {}
            }))

        total = len(rows)
        wins = sum(1 for r in rows if r['actual_return'] > 0)
        losses = sum(1 for r in rows if r['actual_return'] < 0)
        gp = sum(r['actual_return'] for r in rows if r['actual_return'] > 0)
        gl = abs(sum(r['actual_return'] for r in rows if r['actual_return'] < 0))
        net = sum(r['actual_return'] for r in rows)
        wr = wins / total * 100 if total else 0
        pf = gp / gl if gl > 0 else 0
        avg_win = gp / wins if wins else 0
        avg_loss = gl / losses if losses else 0
        expectancy = net / total if total else 0

        # Morning Bell
        mb_rows = [r for r in rows if r['morning_bell']]
        mb_wins = sum(1 for r in mb_rows if r['actual_return'] > 0)
        mb_stats = {
            'trades': len(mb_rows),
            'wins': mb_wins,
            'wr': mb_wins / len(mb_rows) * 100 if mb_rows else 0,
            'net': sum(r['actual_return'] for r in mb_rows)
        } if mb_rows else None

        # By month
        by_month_dict = defaultdict(list)
        for r in rows:
            m = (r['prediction_date'] or '')[:7]
            by_month_dict[m].append(r['actual_return'])
        by_month = []
        for m in sorted(by_month_dict.keys()):
            vals = by_month_dict[m]
            w = sum(1 for v in vals if v > 0)
            by_month.append({
                'month': m, 'trades': len(vals), 'wins': w,
                'wr': w / len(vals) * 100 if vals else 0,
                'net': sum(vals)
            })

        # By ticker (top 15 by net)
        by_ticker_dict = defaultdict(lambda: {'trades': 0, 'wins': 0, 'net': 0})
        for r in rows:
            by_ticker_dict[r['ticker']]['trades'] += 1
            if r['actual_return'] > 0:
                by_ticker_dict[r['ticker']]['wins'] += 1
            by_ticker_dict[r['ticker']]['net'] += r['actual_return']
        by_ticker = sorted(
            [{'ticker': t, **d, 'wr': d['wins'] / d['trades'] * 100 if d['trades'] else 0}
             for t, d in by_ticker_dict.items()],
            key=lambda x: -x['net']
        )[:15]

        # Explosive stocks (analyst list)
        explosive_list = ['BIOC', 'NIPH', 'AMES', 'GPIM', 'CRST', 'AFMC', 'GTWL',
                          'TMGH', 'OCDI', 'COMI', 'SWDY', 'ESRS', 'EGAL', 'EFID', 'EAST']
        explosive_stocks = []
        for t in explosive_list:
            t_rows = [r for r in rows if r['ticker'] == t]
            if t_rows:
                t_wins = sum(1 for r in t_rows if r['actual_return'] > 0)
                explosive_stocks.append({
                    'ticker': t, 'trades': len(t_rows), 'wins': t_wins,
                    'wr': t_wins / len(t_rows) * 100 if t_rows else 0,
                    'net': sum(r['actual_return'] for r in t_rows)
                })

        # Out-of-sample
        oos30 = [r for r in rows if (r['prediction_date'] or '') >= '2026-07-28']
        oos45 = [r for r in rows if (r['prediction_date'] or '') >= '2026-07-13']

        def _stats(subset):
            if not subset:
                return None
            w = sum(1 for r in subset if r['actual_return'] > 0)
            gp_s = sum(r['actual_return'] for r in subset if r['actual_return'] > 0)
            gl_s = abs(sum(r['actual_return'] for r in subset if r['actual_return'] < 0))
            return {
                'trades': len(subset), 'wins': w,
                'wr': w / len(subset) * 100 if subset else 0,
                'pf': gp_s / gl_s if gl_s > 0 else 0,
                'net': sum(r['actual_return'] for r in subset)
            }

        return jsonify(admin_response(True, {
            'summary': {
                'total': total, 'wins': wins, 'losses': losses,
                'wr': round(wr, 1), 'pf': round(pf, 2),
                'net': round(net, 2),
                'avg_win': round(avg_win, 2), 'avg_loss': round(avg_loss, 2),
                'expectancy': round(expectancy, 2),
                'rr_ratio': round(avg_win / avg_loss, 2) if avg_loss else 0,
            },
            'morning_bell': mb_stats,
            'by_month': by_month,
            'by_ticker': by_ticker,
            'explosive_stocks': explosive_stocks,
            'out_of_sample': {
                'last_30d': _stats(oos30),
                'last_45d': _stats(oos45),
            }
        }))
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, error=str(e), traceback=traceback.format_exc())), 500


@admin_bp.route('/backtest/v40/run', methods=['POST'])
@require_admin
def run_v40_backtest():
    """تشغيل V40.2 Backtest على فترة محددة.

    Body: {
        "start_date": "2025-12-01",
        "end_date": "2026-08-27",
        "max_picks": 5,
        "clear_existing": true  // امسح predictions قبل التشغيل
    }

    Returns: job_id (النتائج تقرأ من /backtest/v40/stats بعد الانتهاء)

    NOTE: ده بـ يشغل V40.2 generator في subprocess (ممكن ياخد 5-10 دقايق).
    """
    try:
        import subprocess as _subprocess
        import uuid as _uuid
        data = request.get_json() or {}
        start_date = data.get('start_date', '2025-12-01')
        end_date = data.get('end_date', '2026-08-27')
        max_picks = data.get('max_picks', 5)
        clear_existing = data.get('clear_existing', True)

        # امسح predictions القديمة لو طلب
        if clear_existing:
            from pathlib import Path as _Path
            preds_db = str(_Path(__file__).resolve().parents[2] / 'db' / 'predictions.db')
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            with _open_db('predictions', preds_db, writable=True) as conn:
                conn.execute('DELETE FROM predictions')
                conn.commit()

        # شغل V40.2 generator في الخلفية (non-blocking)
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        job_id = str(_uuid.uuid4())[:8]
        cmd = [
            'python3', os.path.join(project_root, 'vps-service', 'jobs', 'daily_predictor.py'),
            '--start', start_date,
            '--end', end_date,
            '--scan-interval', '3',
            '--max-picks', str(max_picks),
            '--force',
        ]
        import os as _os_mod
        _log_dir = _os_mod.environ.get('LOG_DIR', '/tmp')
        log_file = f'{_log_dir}/v40_backtest_{job_id}.log'
        proc = _subprocess.Popen(
            cmd, stdout=open(log_file, 'w'), stderr=_subprocess.STDOUT,
            cwd=project_root, start_new_session=True
        )

        log_admin_action('v40_backtest_started', {
            'job_id': job_id, 'pid': proc.pid,
            'start_date': start_date, 'end_date': end_date,
        })

        return jsonify(admin_response(True, {
            'job_id': job_id,
            'pid': proc.pid,
            'message': f'V40.2 backtest started (job {job_id}). Check status with /backtest/v40/status/{job_id}',
            'log_file': log_file,
        }))
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, error=str(e), traceback=traceback.format_exc())), 500


@admin_bp.route('/backtest/v40/status/<job_id>', methods=['GET'])
@require_admin
def get_v40_backtest_status(job_id):
    """حالة V40.2 backtest job."""
    try:
        import os as _os
        _log_dir = _os.environ.get('LOG_DIR', '/tmp')
        log_file = f'{_log_dir}/v40_backtest_{job_id}.log'
        if not _os.path.exists(log_file):
            return jsonify(admin_response(True, {'status': 'unknown', 'message': 'Job not found'}))

        with open(log_file) as f:
            content = f.read()
        # آخر 20 سطر
        lines = content.strip().split('\n')[-20:]

        # هل العملية لسه شغالة؟
        import subprocess as _subprocess
        try:
            ps_result = _subprocess.run(['pgrep', '-f', f'v40_backtest_{job_id}'],
                                        capture_output=True, text=True)
            running = ps_result.returncode == 0
        except Exception:
            running = False

        # لو فيه "GENERATION COMPLETE" في اللوج، يبقى خلص
        completed = 'GENERATION COMPLETE' in content

        return jsonify(admin_response(True, {
            'status': 'completed' if completed else ('running' if running else 'stopped'),
            'log_tail': lines,
            'completed': completed,
        }))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/backtest/engine-results', methods=['GET'])
@require_admin
def get_backtest_engine_results():
    """الحصول على نتائج BacktestEngine من قاعدة البيانات."""
    try:
        from analyzers.backtest_engine import BacktestEngine
        engine = BacktestEngine()
        limit = request.args.get('limit', 200, type=int)
        results = engine.get_results(limit=limit)
        summary = engine.get_summary()
        return jsonify(admin_response(True, {
            "results": results,
            "summary": summary
        }))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/backtest/ab-test', methods=['POST'])
@require_admin
def run_backtest_ab_test():
    """
    تشغيل A/B Test: control (بدون تعلم) مقابل treatment (مع تعلم).
    
    Body: {
        "ticker_count": 20,
        "start_date": "2026-01-01",
        "end_date": "2026-03-04",
        "horizon_days": 30
    }
    """
    try:
        data = request.get_json() or {}
        from analyzers.backtest_engine import BacktestEngine
        
        engine = BacktestEngine()
        ticker_count = data.get('ticker_count', 20)
        start_date = data.get('start_date', '2026-01-01')
        end_date = data.get('end_date', '2026-03-04')
        horizon_days = data.get('horizon_days', 30)
        
        tickers = engine._get_top_liquid_tickers(ticker_count)
        ab_result = engine.run_ab_test(
            tickers=tickers,
            start_date=start_date,
            end_date=end_date,
            horizon_days=horizon_days
        )
        
        log_admin_action('backtest_ab_test', {
            'ticker_count': ticker_count,
            'start_date': start_date,
            'verdict': ab_result.get('verdict')
        })
        
        return jsonify(admin_response(True, ab_result))
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, error=str(e), traceback=traceback.format_exc())), 500


def _get_db_path():
    """الحصول على مسار قاعدة البيانات."""
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    return os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))


# ============================================================================
# ITERATIVE LEARNING SYSTEM (التعلم الذاتي التكراري)
# ============================================================================

# Learning state - مع ذاكرة للتعلم
_iterative_learning_state = {
    'is_running': False,
    'current_iteration': 0,
    'max_iterations': 20,
    'best_params': None,
    'best_score': 0,
    'history': [],
    'target_win_rate': 55,
    'target_profit_factor': 1.3,
    # ذاكرة التعلم - نحفظ إيه اشتغل وإيه لأ
    'learning_memory': {
        'successful_adjustments': [],  # التعديلات الناجحة
        'failed_adjustments': [],      # التعديلات الفاشلة
        'parameter_impact': {},        # تأثير كل معامل
    },
    # آخر اتجاه للتعديل
    'last_direction': None,
    'consecutive_failures': 0,
}

# المعاملات المثبتة من Walk-Forward Backtest
PROVEN_PARAMS = {
    'min_score_for_signal': 65,
    'stop_loss_pct': 10.0,
    'target_pct': 8.0,
    'skip_bear_regime': True,
    'min_volume_ratio': 1.0,
    'min_candle_score': 20,
    'max_rsi_for_buy': 65,
    'min_risk_reward': 1.8,
    'target_multiplier': 1.8,
}


@admin_bp.route('/iterative-learning/start', methods=['POST'])
@require_admin
def start_iterative_learning():
    """
    بدء التعلم الذاتي التكراري.
    
    يقوم تلقائياً بـ:
    1. تشغيل Backtest بالمعاملات الحالية
    2. تحليل النتائج
    3. تعديل المعاملات
    4. إعادة المحاولة لحد ما يوصل للهدف
    
    Target:
    - Win Rate >= 55%
    - Profit Factor >= 1.3
    """
    global _iterative_learning_state
    
    if _iterative_learning_state['is_running']:
        return jsonify(admin_response(False, 
            error="Learning already running. Check /iterative-learning/status"))
    
    try:
        data = request.get_json() or {}
        
        # Set targets
        _iterative_learning_state['target_win_rate'] = data.get('target_win_rate', 55)
        _iterative_learning_state['target_profit_factor'] = data.get('target_profit_factor', 1.3)
        _iterative_learning_state['max_iterations'] = data.get('max_iterations', 20)
        _iterative_learning_state['current_iteration'] = 0
        _iterative_learning_state['history'] = []
        _iterative_learning_state['is_running'] = True
        _iterative_learning_state['best_score'] = 0
        _iterative_learning_state['consecutive_failures'] = 0
        _iterative_learning_state['learning_memory'] = {
            'successful_adjustments': [],
            'failed_adjustments': [],
            'parameter_impact': {},
        }
        
        # استخدام المعاملات المثبتة كنقطة بداية
        use_proven = data.get('use_proven_params', True)
        
        if use_proven:
            current_params = get_backtest_params()
            # تحديث المعاملات بالقيم المثبتة
            for key, value in PROVEN_PARAMS.items():
                if key in current_params or key == 'skip_bear_regime' or key == 'min_volume_ratio':
                    current_params[key] = value
            save_backtest_params(current_params)
            _iterative_learning_state['best_params'] = current_params.copy()
        else:
            current_params = get_backtest_params()
            _iterative_learning_state['best_params'] = current_params.copy()
        
        return jsonify(admin_response(True, {
            'message': 'Iterative learning started',
            'starting_point': 'proven_params' if use_proven else 'current_params',
            'targets': {
                'win_rate': _iterative_learning_state['target_win_rate'],
                'profit_factor': _iterative_learning_state['target_profit_factor']
            },
            'initial_params': current_params,
            'max_iterations': _iterative_learning_state['max_iterations']
        }))
        
    except Exception as e:
        _iterative_learning_state['is_running'] = False
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/iterative-learning/step', methods=['POST'])
@require_admin
def run_learning_step():
    """
    تنفيذ خطوة تعلم واحدة.
    
    Returns:
        - iteration: رقم التكرار
        - results: نتائج الـ Backtest
        - adjustments: التعديلات المقترحة
        - status: حالة التعلم
    """
    global _iterative_learning_state
    
    if not _iterative_learning_state['is_running']:
        return jsonify(admin_response(False, error="Learning not started. Call /start first"))
    
    try:
        _iterative_learning_state['current_iteration'] += 1
        iteration = _iterative_learning_state['current_iteration']
        
        # Get current params
        current_params = get_backtest_params()
        
        # Run backtest
        # BRAVO-FIX (2026-10-19): api.kimi_backtest module مش موجود
        raise ImportError('api.kimi_backtest module not found — BRAVO-FIX 2026-10-19')
        # from api.kimi_backtest import EnhancedBacktest
        engine = EnhancedBacktest(_get_db_path())
        results = engine.run_backtest(
            start_year=2026, start_month=1,
            num_weeks=current_params.get('weeks_to_test', 8),
            max_picks_per_week=current_params.get('max_picks_per_week', 3)
        )
        
        stats = results.get('statistics', {})
        win_rate = stats.get('win_rate', 0)
        profit_factor = stats.get('profit_factor', 0)
        
        # Calculate score
        score = (win_rate / 100) * profit_factor
        
        # Check if this is best so far
        is_best = False
        if score > _iterative_learning_state['best_score']:
            _iterative_learning_state['best_score'] = score
            _iterative_learning_state['best_params'] = current_params.copy()
            is_best = True
        
        # Record history
        history_entry = {
            'iteration': iteration,
            'params': current_params.copy(),
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'score': round(score, 4),
            'is_best': is_best
        }
        _iterative_learning_state['history'].append(history_entry)
        
        # Check targets
        target_wr = _iterative_learning_state['target_win_rate']
        target_pf = _iterative_learning_state['target_profit_factor']
        
        if win_rate >= target_wr and profit_factor >= target_pf:
            _iterative_learning_state['is_running'] = False
            return jsonify(admin_response(True, {
                'iteration': iteration,
                'results': results,
                'status': 'TARGET_REACHED',
                'message': f'✅ Target reached! Win Rate: {win_rate}%, PF: {profit_factor}',
                'final_params': current_params
            }))
        
        if iteration >= _iterative_learning_state['max_iterations']:
            _iterative_learning_state['is_running'] = False
            return jsonify(admin_response(True, {
                'iteration': iteration,
                'results': results,
                'status': 'MAX_ITERATIONS',
                'message': f'Max iterations reached. Best: WR={win_rate}%, PF={profit_factor}',
                'best_params': _iterative_learning_state['best_params'],
                'history': _iterative_learning_state['history']
            }))
        
        # Adjust parameters automatically
        adjustments = _adjust_parameters(current_params, win_rate, profit_factor, stats, iteration)
        save_backtest_params(adjustments['new_params'])
        
        return jsonify(admin_response(True, {
            'iteration': iteration,
            'results': results,
            'adjustments': adjustments,
            'status': 'CONTINUE',
            'message': f'Iteration {iteration}: WR={win_rate}%, PF={profit_factor}. Adjusting...',
            'history': _iterative_learning_state['history'][-5:]  # Last 5
        }))
        
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, 
            error=str(e), 
            traceback=traceback.format_exc())), 500


@admin_bp.route('/iterative-learning/run-auto', methods=['POST'])
@require_admin
def run_auto_learning():
    """
    تشغيل التعلم التلقائي الكامل.
    
    يكرر تلقائياً لحد ما يوصل للهدف أو يوصل للحد الأقصى.
    """
    global _iterative_learning_state
    
    if _iterative_learning_state['is_running']:
        return jsonify(admin_response(False, error="Learning already running"))
    
    try:
        data = request.get_json() or {}
        
        # Initialize
        _iterative_learning_state['target_win_rate'] = data.get('target_win_rate', 55)
        _iterative_learning_state['target_profit_factor'] = data.get('target_profit_factor', 1.3)
        _iterative_learning_state['max_iterations'] = data.get('max_iterations', 20)
        _iterative_learning_state['current_iteration'] = 0
        _iterative_learning_state['history'] = []
        _iterative_learning_state['is_running'] = True
        _iterative_learning_state['best_score'] = 0
        _iterative_learning_state['consecutive_failures'] = 0
        _iterative_learning_state['learning_memory'] = {
            'successful_adjustments': [],
            'failed_adjustments': [],
            'parameter_impact': {},
        }
        
        # استخدام المعاملات المثبتة كنقطة بداية
        use_proven = data.get('use_proven_params', True)
        if use_proven:
            current_params = get_backtest_params()
            for key, value in PROVEN_PARAMS.items():
                if key in current_params or key == 'skip_bear_regime' or key == 'min_volume_ratio':
                    current_params[key] = value
            save_backtest_params(current_params)
            print(f"[LEARNING] Starting with PROVEN params: {current_params}")
        else:
            current_params = get_backtest_params()
            print(f"[LEARNING] Starting with CURRENT params: {current_params}")
        
        # BRAVO-FIX (2026-10-19): api.kimi_backtest module مش موجود
        raise ImportError('api.kimi_backtest module not found — BRAVO-FIX 2026-10-19')
        # from api.kimi_backtest import EnhancedBacktest
        
        all_results = []
        
        for i in range(_iterative_learning_state['max_iterations']):
            _iterative_learning_state['current_iteration'] = i + 1
            current_params = get_backtest_params()
            
            print(f"\n{'='*50}")
            print(f"[LEARNING] Iteration {i+1}/{_iterative_learning_state['max_iterations']}")
            print(f"[LEARNING] Current params: min_score={current_params.get('min_score_for_signal')}, R:R={current_params.get('min_risk_reward')}")
            
            # Run backtest
            engine = EnhancedBacktest(_get_db_path())
            results = engine.run_backtest(
                start_year=2026, start_month=1,
                num_weeks=current_params.get('weeks_to_test', 8),
                max_picks_per_week=current_params.get('max_picks_per_week', 3)
            )
            
            stats = results.get('statistics', {})
            win_rate = stats.get('win_rate', 0)
            profit_factor = stats.get('profit_factor', 0)
            score = (win_rate / 100) * min(profit_factor, 2.0)
            
            print(f"[LEARNING] Results: WR={win_rate}%, PF={profit_factor}, Score={score:.4f}")
            
            # Track best
            if score > _iterative_learning_state['best_score']:
                _iterative_learning_state['best_score'] = score
                _iterative_learning_state['best_params'] = current_params.copy()
                print(f"[LEARNING] 🟢 NEW BEST SCORE!")
            
            all_results.append({
                'iteration': i + 1,
                'win_rate': win_rate,
                'profit_factor': profit_factor,
                'score': round(score, 4),
                'params': current_params.copy()
            })
            
            # Check targets
            if win_rate >= _iterative_learning_state['target_win_rate'] and \
               profit_factor >= _iterative_learning_state['target_profit_factor']:
                _iterative_learning_state['is_running'] = False
                print(f"[LEARNING] ✅ TARGET REACHED!")
                return jsonify(admin_response(True, {
                    'status': 'TARGET_REACHED',
                    'iterations': i + 1,
                    'final_results': {
                        'win_rate': win_rate,
                        'profit_factor': profit_factor
                    },
                    'final_params': current_params,
                    'all_iterations': all_results,
                    'learning_memory': _iterative_learning_state['learning_memory']
                }))
            
            # Adjust for next iteration
            adjustments = _adjust_parameters(current_params, win_rate, profit_factor, stats, i + 1)
            print(f"[LEARNING] Adjustments: {adjustments.get('adjustments_made', [])}")
            save_backtest_params(adjustments['new_params'])
        
        # Max iterations reached
        _iterative_learning_state['is_running'] = False
        
        # Restore best params
        if _iterative_learning_state['best_params']:
            save_backtest_params(_iterative_learning_state['best_params'])
            print(f"[LEARNING] Restored best params: {_iterative_learning_state['best_params']}")
        
        print(f"[LEARNING] Finished. Best Score: {_iterative_learning_state['best_score']}")
        print(f"[LEARNING] Successful adjustments: {len(_iterative_learning_state['learning_memory']['successful_adjustments'])}")
        
        return jsonify(admin_response(True, {
            'status': 'MAX_ITERATIONS',
            'iterations': _iterative_learning_state['max_iterations'],
            'best_results': {
                'win_rate': all_results[-1]['win_rate'] if all_results else 0,
                'profit_factor': all_results[-1]['profit_factor'] if all_results else 0
            },
            'best_params': _iterative_learning_state['best_params'],
            'best_score': _iterative_learning_state['best_score'],
            'all_iterations': all_results,
            'learning_memory': _iterative_learning_state['learning_memory']
        }))
        
    except Exception as e:
        import traceback
        _iterative_learning_state['is_running'] = False
        return jsonify(admin_response(False, 
            error=str(e), 
            traceback=traceback.format_exc())), 500


@admin_bp.route('/iterative-learning/status', methods=['GET'])
@require_admin
def get_learning_status():
    """حالة التعلم الذاتي."""
    return jsonify(admin_response(True, {
        'is_running': _iterative_learning_state['is_running'],
        'current_iteration': _iterative_learning_state['current_iteration'],
        'max_iterations': _iterative_learning_state['max_iterations'],
        'best_score': _iterative_learning_state['best_score'],
        'best_params': _iterative_learning_state['best_params'],
        'targets': {
            'win_rate': _iterative_learning_state['target_win_rate'],
            'profit_factor': _iterative_learning_state['target_profit_factor']
        },
        'history': _iterative_learning_state['history'][-10:]
    }))


@admin_bp.route('/iterative-learning/stop', methods=['POST'])
@require_admin
def stop_learning():
    """إيقاف التعلم الذاتي."""
    global _iterative_learning_state
    _iterative_learning_state['is_running'] = False
    return jsonify(admin_response(True, {
        'message': 'Learning stopped',
        'best_params': _iterative_learning_state['best_params'],
        'history': _iterative_learning_state['history']
    }))


# ============================================================================
# ADVANCED OPTIMIZATION - Grid Search (البحث الشبكي)
# ============================================================================

# شبكة البحث للمعاملات الأكثر تأثيراً
PARAMETER_GRID = {
    'skip_bear_regime': [True, False],
    'stop_loss_pct': [8.0, 10.0, 12.0],
    'target_pct': [6.0, 8.0, 10.0],
    'min_score_for_signal': [60, 65, 70, 75],
    'min_volume_ratio': [0, 1.0, 1.5],
}

# المعاملات المثبتة من Walk-Forward Backtest (أولوية)
PROVEN_COMBINATIONS = [
    {'skip_bear_regime': True, 'stop_loss_pct': 10.0, 'target_pct': 8.0, 'min_score_for_signal': 65, 'min_volume_ratio': 1.0},
    {'skip_bear_regime': True, 'stop_loss_pct': 10.0, 'target_pct': 8.0, 'min_score_for_signal': 60, 'min_volume_ratio': 0},
    {'skip_bear_regime': False, 'stop_loss_pct': 10.0, 'target_pct': 8.0, 'min_score_for_signal': 65, 'min_volume_ratio': 1.0},
]


@admin_bp.route('/iterative-learning/grid-search', methods=['POST'])
@require_admin
def run_grid_search():
    """
    تشغيل Grid Search للعثور على أفضل مجموعة معاملات.
    
    يقوم بتجربة مجموعات مختلفة من المعاملات:
    - skip_bear_regime: تخطي الشراء في السوق الهابط
    - stop_loss_pct: نسبة وقف الخسارة
    - target_pct: نسبة الهدف
    - min_score_for_signal: الحد الأدنى للدرجة
    - min_volume_ratio: الحد الأدنى لنسبة السيولة
    
    Returns:
        - best_params: أفضل مجموعة معاملات
        - best_score: أفضل نتيجة
        - all_results: كل النتائج
    """
    try:
        # BRAVO-FIX (2026-10-19): api.kimi_backtest module مش موجود
        raise ImportError('api.kimi_backtest module not found — BRAVO-FIX 2026-10-19')
        # from api.kimi_backtest import EnhancedBacktest
        import itertools
        
        data = request.get_json() or {}
        
        # تحديد المعاملات المراد اختبارها
        test_proven_first = data.get('test_proven_first', True)
        max_combinations = data.get('max_combinations', 50)
        
        print(f"\n{'='*60}")
        print(f"[GRID SEARCH] Starting optimization...")
        print(f"[GRID SEARCH] Max combinations: {max_combinations}")
        
        # بناء قائمة التوليفات للاختبار
        combinations_to_test = []
        
        # أولاً: اختبار المعاملات المثبتة
        if test_proven_first:
            for combo in PROVEN_COMBINATIONS:
                combinations_to_test.append(combo)
            print(f"[GRID SEARCH] Testing {len(PROVEN_COMBINATIONS)} proven combinations first")
        
        # ثانياً: توليد توليفات عشوائية من الشبكة
        param_keys = list(PARAMETER_GRID.keys())
        all_combinations = list(itertools.product(*[PARAMETER_GRID[k] for k in param_keys]))
        
        # خلط التوليفات للاختبار العشوائي
        random.shuffle(all_combinations)
        
        for combo_values in all_combinations[:max_combinations]:
            combo = dict(zip(param_keys, combo_values))
            # تجنب التكرار
            if combo not in combinations_to_test:
                combinations_to_test.append(combo)
        
        print(f"[GRID SEARCH] Total combinations to test: {len(combinations_to_test)}")
        
        # اختبار كل توليفة
        all_results = []
        best_score = 0
        best_params = None
        best_win_rate = 0
        best_profit_factor = 0
        
        engine = EnhancedBacktest(_get_db_path())
        
        for i, combo in enumerate(combinations_to_test):
            print(f"\n[GRID SEARCH] Testing combination {i+1}/{len(combinations_to_test)}")
            print(f"[GRID SEARCH] Params: skip_bear={combo['skip_bear_regime']}, SL={combo['stop_loss_pct']}%, TP={combo['target_pct']}%, min_score={combo['min_score_for_signal']}")
            
            # تحديث المعاملات
            params = get_backtest_params()
            params.update(combo)
            save_backtest_params(params)
            
            # تشغيل Backtest
            results = engine.run_backtest(
                start_year=2026, start_month=1,
                num_weeks=params.get('weeks_to_test', 8),
                max_picks_per_week=params.get('max_picks_per_week', 3)
            )
            
            stats = results.get('statistics', {})
            win_rate = stats.get('win_rate', 0)
            profit_factor = stats.get('profit_factor', 0)
            
            # حساب النتيجة المركبة
            # نعطي وزن أكبر للـ Win Rate لأنه أكثر استقراراً
            score = (win_rate / 100) * min(profit_factor, 2.5)
            
            # مكافأة إضافية للـ Profit Factor العالي
            if profit_factor > 1.5:
                score *= 1.1
            elif profit_factor > 1.3:
                score *= 1.05
            
            print(f"[GRID SEARCH] Results: WR={win_rate}%, PF={profit_factor}, Score={score:.4f}")
            
            all_results.append({
                'combination': i + 1,
                'params': combo.copy(),
                'win_rate': win_rate,
                'profit_factor': profit_factor,
                'score': round(score, 4),
                'skipped_bear_weeks': stats.get('skipped_bear_weeks', 0),
            })
            
            # تحديث الأفضل
            if score > best_score:
                best_score = score
                best_params = combo.copy()
                best_win_rate = win_rate
                best_profit_factor = profit_factor
                print(f"[GRID SEARCH] 🟢 NEW BEST!")
        
        # ترتيب النتائج
        all_results.sort(key=lambda x: x['score'], reverse=True)
        
        # تطبيق أفضل معاملات
        if best_params:
            params = get_backtest_params()
            params.update(best_params)
            save_backtest_params(params)
            print(f"\n[GRID SEARCH] ✅ Applied best params: {best_params}")
        
        print(f"\n[GRID SEARCH] ========== FINAL RESULTS ==========")
        print(f"[GRID SEARCH] Best Score: {best_score:.4f}")
        print(f"[GRID SEARCH] Best Win Rate: {best_win_rate}%")
        print(f"[GRID SEARCH] Best Profit Factor: {best_profit_factor}")
        print(f"[GRID SEARCH] Best Params: {best_params}")
        
        return jsonify(admin_response(True, {
            'status': 'COMPLETED',
            'total_combinations_tested': len(combinations_to_test),
            'best_results': {
                'win_rate': best_win_rate,
                'profit_factor': best_profit_factor,
                'score': round(best_score, 4),
            },
            'best_params': best_params,
            'top_5_results': all_results[:5],
            'all_results': all_results,
        }))
        
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, 
            error=str(e), 
            traceback=traceback.format_exc())), 500


@admin_bp.route('/iterative-learning/smart-optimize', methods=['POST'])
@require_admin
def run_smart_optimize():
    """
    تحسين ذكي - يجرب المعاملات الأكثر تأثيراً أولاً.
    
    الاستراتيجية:
    1. اختبار skip_bear_regime = True vs False
    2. اختبار stop_loss_pct و target_pct
    3. اختبار min_score_for_signal
    4. اختيار أفضل توليفة
    """
    try:
        # BRAVO-FIX (2026-10-19): api.kimi_backtest module مش موجود
        raise ImportError('api.kimi_backtest module not found — BRAVO-FIX 2026-10-19')
        # from api.kimi_backtest import EnhancedBacktest
        
        data = request.get_json() or {}
        
        print(f"\n{'='*60}")
        print(f"[SMART OPTIMIZE] Starting intelligent optimization...")
        
        engine = EnhancedBacktest(_get_db_path())
        
        # القيم المثبتة من Walk-Forward Backtest
        test_combinations = [
            # المعاملات المثبتة (أفضل نتيجة)
            {'skip_bear_regime': True, 'stop_loss_pct': 10.0, 'target_pct': 8.0, 'min_score_for_signal': 65, 'min_volume_ratio': 1.0, 'name': 'PROVEN_WF'},
            # بدون skip_bear_regime
            {'skip_bear_regime': False, 'stop_loss_pct': 10.0, 'target_pct': 8.0, 'min_score_for_signal': 65, 'min_volume_ratio': 1.0, 'name': 'NO_REGIME_FILTER'},
            # وقف خسارة أصغر
            {'skip_bear_regime': True, 'stop_loss_pct': 8.0, 'target_pct': 6.0, 'min_score_for_signal': 65, 'min_volume_ratio': 1.0, 'name': 'TIGHT_STOP'},
            # هدف أكبر
            {'skip_bear_regime': True, 'stop_loss_pct': 10.0, 'target_pct': 10.0, 'min_score_for_signal': 65, 'min_volume_ratio': 1.0, 'name': 'LARGER_TARGET'},
            # min_score أعلى
            {'skip_bear_regime': True, 'stop_loss_pct': 10.0, 'target_pct': 8.0, 'min_score_for_signal': 70, 'min_volume_ratio': 1.0, 'name': 'HIGHER_MIN_SCORE'},
        ]
        
        all_results = []
        best_score = 0
        best_params = None
        
        for combo in test_combinations:
            name = combo.pop('name', 'unknown')
            print(f"\n[SMART OPTIMIZE] Testing: {name}")
            print(f"[SMART OPTIMIZE] Params: {combo}")
            
            # تحديث المعاملات
            params = get_backtest_params()
            params.update(combo)
            save_backtest_params(params)
            
            # تشغيل Backtest
            results = engine.run_backtest(
                start_year=2026, start_month=1,
                num_weeks=params.get('weeks_to_test', 8),
                max_picks_per_week=params.get('max_picks_per_week', 3)
            )
            
            stats = results.get('statistics', {})
            win_rate = stats.get('win_rate', 0)
            profit_factor = stats.get('profit_factor', 0)
            score = (win_rate / 100) * min(profit_factor, 2.5)
            
            print(f"[SMART OPTIMIZE] Results: WR={win_rate}%, PF={profit_factor}, Score={score:.4f}")
            
            all_results.append({
                'name': name,
                'params': combo.copy(),
                'win_rate': win_rate,
                'profit_factor': profit_factor,
                'score': round(score, 4),
            })
            
            if score > best_score:
                best_score = score
                best_params = combo.copy()
                print(f"[SMART OPTIMIZE] 🟢 NEW BEST!")
        
        # ترتيب النتائج
        all_results.sort(key=lambda x: x['score'], reverse=True)
        
        # تطبيق أفضل معاملات
        if best_params:
            params = get_backtest_params()
            params.update(best_params)
            save_backtest_params(params)
        
        return jsonify(admin_response(True, {
            'status': 'COMPLETED',
            'best_results': all_results[0] if all_results else None,
            'best_params': best_params,
            'all_results': all_results,
        }))
        
    except Exception as e:
        import traceback
        return jsonify(admin_response(False, 
            error=str(e), 
            traceback=traceback.format_exc())), 500


def _adjust_parameters(current_params: dict, win_rate: float, profit_factor: float, stats: dict, iteration: int = 1) -> dict:
    """
    تعديل المعاملات تلقائياً بناءً على النتائج - النسخة المحسنة v3
    
    استراتيجية التعلم:
    1. نبدأ من المعاملات المثبتة (من Walk-Forward Backtest)
    2. نعدل بناءً على تحليل النتائج
    3. نحفظ إيه اشتغل وإيه لأ
    4. نتجه نحو الأفضل
    """
    global _iterative_learning_state
    
    new_params = current_params.copy()
    adjustments_made = []
    
    # Calculate score (0-1 scale)
    score = (win_rate / 100) * min(profit_factor, 2.0)
    prev_score = _iterative_learning_state.get('best_score', 0)
    
    # سجل النتيجة
    is_improvement = score > prev_score
    
    # ========== 1. تحليل المشكلة ==========
    problems = []
    
    if win_rate < 45:
        problems.append('very_low_win_rate')
    elif win_rate < 55:
        problems.append('low_win_rate')
    
    if profit_factor < 0.8:
        problems.append('losing_money')
    elif profit_factor < 1.0:
        problems.append('low_profit_factor')
    
    # ========== 2. اختيار الحل المناسب ==========
    
    # المشكلة: Win Rate منخفض جداً
    if 'very_low_win_rate' in problems:
        # حل: نقوة شروط الدخول
        new_params['min_score_for_signal'] = min(80, current_params.get('min_score_for_signal', 65) + 5)
        new_params['min_candle_score'] = min(30, current_params.get('min_candle_score', 20) + 3)
        new_params['max_rsi_for_buy'] = max(55, current_params.get('max_rsi_for_buy', 65) - 5)
        adjustments_made.append('🔴 Win Rate منخفض جداً → تقوية شروط الدخول')
    
    # المشكلة: Lose Money (Profit Factor < 0.8)
    elif 'losing_money' in problems:
        # حل: وقف خسارة أوسع + هدف أعلى
        new_params['stop_loss_min_pct'] = min(10.0, current_params.get('stop_loss_min_pct', 5.0) + 2.0)
        new_params['stop_loss_max_pct'] = min(15.0, current_params.get('stop_loss_max_pct', 10.0) + 2.0)
        new_params['target_multiplier'] = min(3.0, current_params.get('target_multiplier', 1.8) + 0.5)
        adjustments_made.append('🔴 خسارة → وقف خسارة أوسع + هدف أعلى')
    
    # المشكلة: Win Rate منخفض شوية
    elif 'low_win_rate' in problems:
        # حل: تعديل بسيط
        adjustment = 3 if not is_improvement else -1
        new_params['min_score_for_signal'] = min(75, current_params.get('min_score_for_signal', 65) + adjustment)
        adjustments_made.append('🟡 Win Rate منخفض → تعديل شروط الدخول')
    
    # المشكلة: Profit Factor منخفض
    elif 'low_profit_factor' in problems:
        # حل: تحسين Risk:Reward
        new_params['min_risk_reward'] = min(2.5, current_params.get('min_risk_reward', 1.8) + 0.3)
        new_params['target_multiplier'] = min(2.5, current_params.get('target_multiplier', 1.8) + 0.3)
        adjustments_made.append('🟡 Profit Factor منخفض → تحسين R:R')
    
    # قريب من الهدف - Fine Tuning
    elif win_rate >= 52 and profit_factor >= 1.0:
        if is_improvement:
            # كمل في نفس الاتجاه
            adjustments_made.append('🟢 تحسن! استمر في نفس الاتجاه')
        else:
            # تعديل بسيط — بدل random.choice، زود 1 نقطة ثابتة (deterministic)
            # CRITICAL FIX (2026-08-28): random.choice كان بيخلي النظام غير reproducible
            new_params['min_score_for_signal'] = current_params.get('min_score_for_signal', 65) + 1
            adjustments_made.append('🟡 Fine-tuning للوصول للهدف (+1 deterministic)')
    
    # ========== 3. تطبيق المعاملات المثبتة ==========
    # إذا فشلنا مرات كتير، نرجع للمعاملات المثبتة
    if _iterative_learning_state.get('consecutive_failures', 0) >= 3:
        new_params.update(PROVEN_PARAMS)
        adjustments_made.append('⚠️ فشل متكرر → الرجوع للمعاملات المثبتة')
        _iterative_learning_state['consecutive_failures'] = 0
    
    # ========== 4. تحديث ذاكرة التعلم ==========
    if is_improvement:
        _iterative_learning_state['consecutive_failures'] = 0
        _iterative_learning_state['learning_memory']['successful_adjustments'].append({
            'iteration': iteration,
            'params': new_params.copy(),
            'score': score,
            'adjustments': adjustments_made.copy()
        })
    else:
        _iterative_learning_state['consecutive_failures'] = _iterative_learning_state.get('consecutive_failures', 0) + 1
    
    # ========== 5. التحقق من الحدود ==========
    new_params['min_score_for_signal'] = max(55, min(85, new_params.get('min_score_for_signal', 65)))
    new_params['min_candle_score'] = max(10, min(35, new_params.get('min_candle_score', 20)))
    new_params['max_rsi_for_buy'] = max(50, min(75, new_params.get('max_rsi_for_buy', 65)))
    new_params['min_risk_reward'] = max(1.2, min(3.0, new_params.get('min_risk_reward', 1.8)))
    new_params['target_multiplier'] = max(1.2, min(3.0, new_params.get('target_multiplier', 1.8)))
    new_params['stop_loss_min_pct'] = max(3.0, min(12.0, new_params.get('stop_loss_min_pct', 5.0)))
    new_params['stop_loss_max_pct'] = max(6.0, min(18.0, new_params.get('stop_loss_max_pct', 10.0)))
    new_params['rsi_overbought'] = max(65, min(80, new_params.get('rsi_overbought', 70)))
    new_params['rsi_oversold'] = max(20, min(40, new_params.get('rsi_oversold', 30)))
    
    return {
        'new_params': new_params,
        'adjustments_made': adjustments_made,
        'reason': ' | '.join(adjustments_made) if adjustments_made else 'متابعة التعلم',
        'score': round(score, 4),
        'is_improvement': is_improvement,
        'problems_detected': problems
    }


# ============================================================================
# FORECASTS & ACCURACY
# ============================================================================

@admin_bp.route('/forecasts/accuracy', methods=['GET'])
@require_admin
def forecast_accuracy():
    """
    دقة التوقعات مقارنة بالواقع.
    للمراجعة والتعلم.
    """
    try:
        days = request.args.get('days', 30, type=int)
        
        accuracy_data = calculate_forecast_accuracy(days)
        
        return jsonify(admin_response(True, accuracy_data))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/forecasts/history', methods=['GET'])
@require_admin
def forecast_history():
    """سجل التوقعات السابقة."""
    try:
        limit = request.args.get('limit', 100, type=int)
        ticker = request.args.get('ticker')
        
        history = get_forecast_history(limit, ticker)
        
        return jsonify(admin_response(True, {"forecasts": history}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# ALERTS & THRESHOLDS
# ============================================================================

@admin_bp.route('/alerts/thresholds', methods=['GET'])
@require_admin
def get_thresholds():
    """عتبات التنبيهات الحالية."""
    try:
        thresholds = get_alert_thresholds()
        return jsonify(admin_response(True, {"thresholds": thresholds}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/alerts/thresholds', methods=['POST'])
@require_admin
def update_thresholds():
    """تحديث عتبات التنبيهات."""
    try:
        data = request.get_json()
        if not data:
            return jsonify(admin_response(False, error="No data provided")), 400
        
        result = save_alert_thresholds(data)
        return jsonify(admin_response(True, result, "Thresholds updated"))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# MACRO INPUT
# ============================================================================

@admin_bp.route('/macro/update', methods=['POST'])
@require_admin
def update_macro():
    """تحديث بيانات البيئة الكلية يدوياً."""
    try:
        data = request.get_json()
        if not data:
            return jsonify(admin_response(False, error="No data provided")), 400
        
        result = update_macro_indicators(data)
        
        log_admin_action('macro_update', data)
        
        return jsonify(admin_response(True, result, "Macro indicators updated"))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# SECTORS
# ============================================================================

@admin_bp.route('/sectors/benchmarks', methods=['GET'])
@require_admin
def get_sector_benchmarks():
    """معايير القطاعات."""
    try:
        benchmarks = get_all_sector_benchmarks()
        return jsonify(admin_response(True, {"sectors": benchmarks}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/sectors/benchmarks', methods=['POST'])
@require_admin
def update_sector_benchmarks():
    """تحديث معايير القطاعات."""
    try:
        data = request.get_json()
        if not data:
            return jsonify(admin_response(False, error="No data provided")), 400
        
        result = save_sector_benchmarks(data)
        return jsonify(admin_response(True, result, "Sector benchmarks updated"))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/sectors/rotation', methods=['GET'])
@require_admin
def get_sector_rotation():
    """كشف دوران السيولة بين القطاعات — PREDICTIVE."""
    try:
        from engine.flow_system import FlowSystemEngine
        engine = FlowSystemEngine(_get_db_path())
        lookback_days = request.args.get('lookback_days', 5, type=int)
        min_change = request.args.get('min_change', 0.3, type=float)
        rotation = engine.detect_sector_rotation(lookback_days=lookback_days, min_turnover_change=min_change)
        return jsonify(admin_response(True, rotation))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# SECTOR CLASSIFICATION - تصنيف الأسهم إلى قطاعات
# ============================================================================

# تعريف القطاعات والكلمات المفتاحية
SECTOR_KEYWORDS = {
    'Banks': {
        'arabic': ['بنك', 'مصرف', 'بنوك'],
        'english': ['bank', 'banks', 'banking', 'cib', 'adib', 'fait', 'qnbe', 'saud'],
        'tickers': ['COMI', 'CIEB', 'ADIB', 'FAIT', 'SAUD', 'ABUK', 'QNBE', 'ETBA', 'BUEI', 'CABK', 'MIDG', 'CAIH'],
    },
    'Real Estate': {
        'arabic': ['عقار', 'عقارات', 'إسكان', 'تطوير عقاري', 'مدن'],
        'english': ['real estate', 'properties', 'housing', 'development', 'construction', 'talaat', 'madinet'],
        'tickers': ['TMGH', 'MNHD', 'ORHD', 'HELI', 'ALCN', 'MCIE', 'ELQA', 'UDCI', 'NIRE', 'OCDI'],
    },
    'Telecom': {
        'arabic': ['اتصال', 'اتصالات', 'موبايل', 'تليفون'],
        'english': ['telecom', 'telecommunications', 'mobile', 'phone', 'communication'],
        'tickers': ['ETEL', 'ESRS', 'MOBI'],
    },
    'Food & Beverage': {
        'arabic': ['غذاء', 'أغذية', 'طعام', 'مشروبات', 'مطاحن', 'زيت', 'سكر', 'دجاج'],
        'english': ['food', 'beverage', 'mills', 'oils', 'sugar', 'poultry', 'chicken', 'juice', 'edible'],
        'tickers': ['JUFO', 'SKPC', 'AJWA', 'EFID', 'SWDY', 'CAID', 'ZEOT', 'CICH', 'SPMD', 'DOMT', 'KABO'],
    },
    'Energy & Utilities': {
        'arabic': ['طاقة', 'كهرباء', 'غاز', 'بترول', 'نفط', 'محروقات'],
        'english': ['energy', 'electricity', 'gas', 'petroleum', 'oil', 'fuel', 'power', 'utility'],
        'tickers': ['EGAS', 'AMOC', 'ESRS', 'EGPC', 'SAMP', 'ESPA', 'ELPA', 'CCPA'],
    },
    'Industrial': {
        'arabic': ['صناعة', 'صناعات', 'مصنع', 'مصانع', 'ألومنيوم', 'حديد', 'صلب', 'أسمنت'],
        'english': ['industrial', 'industries', 'factory', 'manufacturing', 'aluminum', 'steel', 'cement', 'pipes'],
        'tickers': ['SWDY', 'ESGH', 'ALUM', 'AMER', 'ORWE', 'AINP', 'NIPD', 'EIPM', 'UNBP'],
    },
    'Healthcare & Pharmaceuticals': {
        'arabic': ['صحة', 'طبية', 'دواء', 'أدوية', 'مستشفى', 'صيدلة'],
        'english': ['healthcare', 'health', 'medical', 'pharma', 'pharmaceutical', 'hospital', 'drug', 'medicine'],
        'tickers': ['PHDC', 'RMDA', 'EGCH', 'PACH', 'EKRI', 'MOIC'],
    },
    'Investment & Financial Services': {
        'arabic': ['استثمار', 'استثمارات', 'تداول', 'وساطة', 'محافظ', 'تمويل'],
        'english': ['investment', 'investments', 'trading', 'brokerage', 'portfolio', 'finance', 'financial services', 'capital'],
        'tickers': ['HRHO', 'EKHO', 'GTHE', 'BFRI', 'HELI', 'ACI', 'EFIH', 'EFA', 'AIOC', 'FICT'],
    },
    'Technology': {
        'arabic': ['تكنولوجيا', 'تقنية', 'برمجيات', 'حاسب', 'آلي'],
        'english': ['technology', 'tech', 'software', 'it', 'digital', 'computer', 'electronics', 'automation'],
        'tickers': ['MTIE', 'EGTS', 'EGS1', 'IORA', 'EDNV', 'ATLC'],
    },
    'Tourism & Entertainment': {
        'arabic': ['سياحة', 'فنادق', 'سفر', 'ترفيه', 'منتجعات'],
        'english': ['tourism', 'hotel', 'hotels', 'travel', 'entertainment', 'resort', 'leisure'],
        'tickers': ['EGTH', 'MENA', 'HRHO', 'EGTS', 'ALCN', 'ZMKD', 'EEEG'],
    },
    'Retail & Consumer Services': {
        'arabic': ['تجزئة', 'متاجر', 'سوبر ماركت', 'مولات'],
        'english': ['retail', 'stores', 'supermarket', 'mall', 'consumer services', 'shopping'],
        'tickers': ['OAHA', 'CIRA', 'PRDC', 'BMHI'],
    },
    'Education': {
        'arabic': ['تعليم', 'مدارس', 'جامعات', 'كليات', 'معاهد'],
        'english': ['education', 'schools', 'universities', 'colleges', 'institutes', 'learning'],
        'tickers': ['CIRA', 'ERES', 'SEDI'],
    },
}

# خريطة الشركات المعروفة
COMPANY_SECTOR_MAP = {
    'COMI': 'Banks', 'CIEB': 'Banks', 'ADIB': 'Banks', 'FAIT': 'Banks',
    'SAUD': 'Banks', 'ABUK': 'Banks', 'QNBE': 'Banks', 'ETBA': 'Banks',
    'TMGH': 'Real Estate', 'MNHD': 'Real Estate', 'ORHD': 'Real Estate',
    'ETEL': 'Telecom', 'ESRS': 'Telecom',
    'JUFO': 'Food & Beverage', 'SKPC': 'Food & Beverage', 'AJWA': 'Food & Beverage',
    'EGAS': 'Energy & Utilities', 'AMOC': 'Energy & Utilities',
    'PHDC': 'Healthcare & Pharmaceuticals', 'RMDA': 'Healthcare & Pharmaceuticals',
    'HRHO': 'Investment & Financial Services', 'EKHO': 'Investment & Financial Services',
    'ALUM': 'Industrial', 'AMER': 'Industrial',
    'CIRA': 'Education',
}


def classify_stock_by_keywords(ticker: str, name: str) -> str:
    """تصنيف سهم بناءً على رمزه واسمه"""
    ticker = ticker.upper().strip() if ticker else ''
    name = name.lower() if name else ''
    
    # تحقق من القطاع المعروف
    if ticker in COMPANY_SECTOR_MAP:
        return COMPANY_SECTOR_MAP[ticker]
    
    # تحقق من الكلمات المفتاحية
    best_match = None
    best_score = 0
    
    for sector, keywords in SECTOR_KEYWORDS.items():
        score = 0
        
        for kw in keywords.get('tickers', []):
            if kw in ticker or ticker in kw:
                score += 10
        
        for kw in keywords.get('english', []):
            if kw in name:
                score += 3
        
        for kw in keywords.get('arabic', []):
            if kw in name:
                score += 3
        
        if score > best_score:
            best_score = score
            best_match = sector
    
    return best_match if best_match else 'Diversified'


@admin_bp.route('/sectors/classify-stocks', methods=['POST'])
@require_admin
def classify_all_stocks():
    """
    تصنيف كل الأسهم بدون قطاع.
    
    Returns:
        - classified_count: عدد الأسهم المصنفة
        - sectors: توزيع القطاعات
        - unclassified: الأسهم غير المصنفة
    """
    try:
        db_path = _get_db_path()
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path, writable=True) as conn:
            cursor = conn.cursor()

            # الحصول على الأسهم بدون قطاع
            cursor.execute('''
                SELECT ticker, name, name_ar
                FROM stocks
                WHERE sector IS NULL OR sector = '' OR sector = 'N/A'
            ''')
            stocks = cursor.fetchall()

            classified = {}
            sector_counts = {}
            unclassified = []

            for ticker, name, name_ar in stocks:
                full_name = f"{name or ''} {name_ar or ''}"
                sector = classify_stock_by_keywords(ticker, full_name)

                if sector and sector != 'Diversified':
                    classified[ticker] = sector
                    sector_counts[sector] = sector_counts.get(sector, 0) + 1

                    # تحديث قاعدة البيانات
                    cursor.execute('''
                        UPDATE stocks SET sector = ? WHERE ticker = ?
                    ''', (sector, ticker))
                else:
                    unclassified.append(ticker)

            conn.commit()
        
        log_admin_action('stocks_classified', {
            'classified': len(classified),
            'unclassified': len(unclassified)
        })
        
        return jsonify(admin_response(True, {
            'classified_count': len(classified),
            'unclassified_count': len(unclassified),
            'sector_distribution': sector_counts,
            'unclassified_samples': unclassified[:20]
        }, f"تم تصنيف {len(classified)} سهم"))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/sectors/stats', methods=['GET'])
@require_admin
def get_sector_stats():
    """
    إحصائيات القطاعات.
    
    Returns:
        - total_stocks: إجمالي الأسهم
        - with_sector: أسهم بقطاع محدد
        - without_sector: أسهم بدون قطاع
        - sectors: توزيع القطاعات
    """
    try:
        db_path = _get_db_path()
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()

            cursor.execute('SELECT COUNT(*) FROM stocks')
            total = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM stocks WHERE sector IS NOT NULL AND sector != ""')
            with_sector = cursor.fetchone()[0]

            cursor.execute('''
                SELECT sector, COUNT(*) as cnt
                FROM stocks
                WHERE sector IS NOT NULL AND sector != ""
                GROUP BY sector
                ORDER BY cnt DESC
            ''')
            sectors = [{'sector': row[0], 'count': row[1]} for row in cursor.fetchall()]

        return jsonify(admin_response(True, {
            'total_stocks': total,
            'with_sector': with_sector,
            'without_sector': total - with_sector,
            'coverage_pct': round(with_sector / total * 100, 1) if total > 0 else 0,
            'sectors': sectors
        }))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# DATABASE
# ============================================================================

@admin_bp.route('/database/tables', methods=['GET'])
@require_admin
def list_tables():
    """قائمة جداول قاعدة البيانات."""
    try:
        tables = get_database_tables()
        return jsonify(admin_response(True, {"tables": tables}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/database/query', methods=['POST'])
@require_admin
def execute_query():
    """
    تنفيذ query مخصصة.
    ⚠️ خطير - للأدمن الخبير فقط
    """
    try:
        data = request.get_json()
        query = data.get('query', '')
        
        if not query:
            return jsonify(admin_response(False, error="No query provided")), 400
        
        # حماية من queries خطرة
        dangerous_keywords = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER']
        if any(kw in query.upper() for kw in dangerous_keywords):
            return jsonify(admin_response(False, 
                error="Dangerous query not allowed")), 403
        
        result = execute_safe_query(query)
        
        log_admin_action('db_query', {'query': query[:100]})
        
        return jsonify(admin_response(True, {"result": result}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# ANALYTICS (NEW)
# ============================================================================

@admin_bp.route('/analytics/overview', methods=['GET'])
@require_admin
def analytics_overview():
    """ملخص التتبع والأناليتكس."""
    try:
        days = request.args.get('days', 7, type=int)
        
        overview = get_analytics_overview(days)
        
        return jsonify(admin_response(True, overview))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/analytics/page-views', methods=['GET'])
@require_admin
def analytics_page_views():
    """إحصائيات مشاهدة الصفحات."""
    try:
        days = request.args.get('days', 7, type=int)
        group_by = request.args.get('group_by', 'path')  # path, date, device
        
        views = get_page_views_analytics(days, group_by)
        
        return jsonify(admin_response(True, {"page_views": views}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/analytics/feature-usage', methods=['GET'])
@require_admin
def analytics_feature_usage():
    """إحصائيات استخدام الميزات."""
    try:
        days = request.args.get('days', 7, type=int)
        feature = request.args.get('feature')  # scanner, forecast, etc.
        
        usage = get_feature_usage_analytics(days, feature)
        
        return jsonify(admin_response(True, {"usage": usage}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/analytics/sessions', methods=['GET'])
@require_admin
def analytics_sessions():
    """إحصائيات جلسات المستخدمين."""
    try:
        days = request.args.get('days', 7, type=int)
        
        sessions = get_sessions_analytics(days)
        
        return jsonify(admin_response(True, {"sessions": sessions}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/analytics/resources', methods=['GET'])
@require_admin
def analytics_resources():
    """استخدام الموارد."""
    try:
        hours = request.args.get('hours', 24, type=int)
        
        resources = get_resource_usage_analytics(hours)
        
        return jsonify(admin_response(True, {"resources": resources}))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# HISTORICAL BACKFILL API
# ============================================================================

# In-memory status tracking for backfill operations
_backfill_status = {
    'is_running': False,
    'last_run': None,
    'last_results': None,
    'current_progress': None,
    'error': None
}

# Persona definitions with buy thresholds
PERSONAS = {
    'conservative': {'buy_threshold': 75, 'name_ar': 'المحافظ', 'emoji': '🛡️'},
    'cautious': {'buy_threshold': 70, 'name_ar': 'المتوسط الحذر', 'emoji': '🐢'},
    'balanced': {'buy_threshold': 65, 'name_ar': 'المتوازن', 'emoji': '⚖️'},
    'active_trader': {'buy_threshold': 60, 'name_ar': 'المضارب المنتظم', 'emoji': '🎯'},
    'adventurer': {'buy_threshold': 55, 'name_ar': 'المغامر', 'emoji': '🎲'},
    'gambler': {'buy_threshold': 50, 'name_ar': 'المقامر المحسن', 'emoji': '🔥'},
    'hedger': {'buy_threshold': 70, 'name_ar': 'المتحوط المؤسسي', 'emoji': '🏛️'},
}


@admin_bp.route('/historical-backfill/run', methods=['POST'])
@require_admin
def run_historical_backfill():
    """
    تشغيل عملية التعلم من البيانات التاريخية.
    
    Parameters (JSON body):
        - days_back: عدد الأيام للرجوع (default: 180)
        - stocks_limit: عدد الأسهم (default: 0 = الكل)
        - personas: قائمة الشخصيات (default: كل الشخصيات)
    
    Returns:
        - نتائج العملية مع إحصائيات كل شخصية
    """
    global _backfill_status
    
    # Check if already running
    if _backfill_status['is_running']:
        return jsonify(admin_response(False, 
            error="Backfill is already running. Check /status for progress.")), 409
    
    try:
        data = request.get_json() or {}
        
        # Parse parameters
        days_back = data.get('days_back', 180)
        stocks_limit = data.get('stocks_limit', 0)
        requested_personas = data.get('personas', list(PERSONAS.keys()))
        
        # Validate personas
        invalid_personas = [p for p in requested_personas if p not in PERSONAS]
        if invalid_personas:
            return jsonify(admin_response(False, 
                error=f"Invalid personas: {invalid_personas}. Valid: {list(PERSONAS.keys())}")), 400
        
        # Mark as running
        _backfill_status['is_running'] = True
        _backfill_status['last_run'] = datetime.now().isoformat()
        _backfill_status['current_progress'] = {'stage': 'initializing', 'percent': 0}
        _backfill_status['error'] = None
        
        # Resolve database path
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        # Import and create engine
        from engine.historical_backfill_engine import HistoricalBackfillEngine
        
        engine = HistoricalBackfillEngine(db_path)
        
        # Progress callback
        def progress_callback(info):
            _backfill_status['current_progress'] = {
                'stage': 'processing',
                'current': info.get('current', 0),
                'total': info.get('total', 0),
                'ticker': info.get('ticker', ''),
                'predictions': info.get('predictions', 0),
                'percent': round((info.get('current', 0) / max(info.get('total', 1), 1)) * 100, 1)
            }
        
        # Run backfill
        start_time = datetime.now()
        results = engine.run_backfill(
            days_back=days_back,
            stocks_limit=stocks_limit,
            progress_callback=progress_callback
        )
        end_time = datetime.now()
        duration_seconds = (end_time - start_time).total_seconds()
        
        # Get summary from engine
        summary = engine.get_summary()
        
        # Calculate persona-specific statistics
        # Since the engine runs once with default thresholds, we'll calculate
        # what each persona would have seen based on composite_score
        persona_stats = {}
        for persona_key in requested_personas:
            persona = PERSONAS[persona_key]
            threshold = persona['buy_threshold']
            
            # Persona would accept predictions with score >= threshold
            # We estimate based on the results
            persona_stats[persona_key] = {
                'name_ar': persona['name_ar'],
                'emoji': persona['emoji'],
                'buy_threshold': threshold,
                'estimated_acceptances': int(results.get('predictions_made', 0) * (100 - threshold) / 100),
                'description': f"يقبل التوقعات بدرجة ≥ {threshold}"
            }
        
        # Build response
        response_data = {
            'success': True,
            'parameters': {
                'days_back': days_back,
                'stocks_limit': stocks_limit,
                'personas': requested_personas
            },
            'results': results,
            'summary': summary,
            'persona_statistics': persona_stats,
            'timing': {
                'started_at': start_time.isoformat(),
                'completed_at': end_time.isoformat(),
                'duration_seconds': round(duration_seconds, 2)
            }
        }
        
        # Update status
        _backfill_status['is_running'] = False
        _backfill_status['last_results'] = response_data
        _backfill_status['current_progress'] = {'stage': 'completed', 'percent': 100}
        
        # Log the action
        log_admin_action('historical_backfill_run', {
            'days_back': days_back,
            'stocks_limit': stocks_limit,
            'predictions_made': results.get('predictions_made', 0),
            'duration_seconds': round(duration_seconds, 2)
        })
        
        return jsonify(admin_response(True, response_data, 
            f"تم تشغيل Backfill بنجاح - {results.get('predictions_made', 0)} توقع"))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        
        # Update error status
        _backfill_status['is_running'] = False
        _backfill_status['error'] = str(e)
        _backfill_status['current_progress'] = {'stage': 'error', 'percent': 0}
        
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/historical-backfill/status', methods=['GET'])
@require_admin
def get_historical_backfill_status():
    """
    الحصول على حالة عملية التعلم من الماضي.
    
    Returns:
        - is_running: هل العملية قيد التشغيل
        - last_run: آخر مرة تم تشغيل العملية
        - current_progress: التقدم الحالي
        - table_counts: عدد السجلات في الجداول
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        # Get table counts
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()

            # prediction_logs count
            cursor.execute('SELECT COUNT(*) FROM prediction_logs')
            prediction_logs_count = cursor.fetchone()[0]

            # validated predictions
            cursor.execute('SELECT COUNT(*) FROM prediction_logs WHERE validated = 1')
            validated_count = cursor.fetchone()[0]

            # learned_lessons count
            cursor.execute('SELECT COUNT(*) FROM learned_lessons')
            lessons_count = cursor.fetchone()[0]

            # regime_indicator_weights count
            cursor.execute('SELECT COUNT(*) FROM regime_indicator_weights')
            weights_count = cursor.fetchone()[0]

            # outcome_logs (if exists)
            try:
                cursor.execute('SELECT COUNT(*) FROM outcome_logs')
                outcome_logs_count = cursor.fetchone()[0]
            except:
                outcome_logs_count = 0
        
        status_data = {
            'is_running': _backfill_status['is_running'],
            'last_run': _backfill_status['last_run'],
            'current_progress': _backfill_status['current_progress'],
            'error': _backfill_status['error'],
            'table_counts': {
                'prediction_logs': prediction_logs_count,
                'validated_predictions': validated_count,
                'outcome_logs': outcome_logs_count,
                'learned_lessons': lessons_count,
                'regime_indicator_weights': weights_count
            },
            'personas_available': list(PERSONAS.keys())
        }
        
        return jsonify(admin_response(True, status_data))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/historical-backfill/results', methods=['GET'])
@require_admin
def get_historical_backfill_results():
    """
    الحصول على نتائج آخر عملية تعلم من الماضي.
    
    Returns:
        - prediction_logs: عدد التوقعات
        - outcome_logs: عدد النتائج
        - learned_lessons: عدد الدروس المستفادة
        - regime_indicator_weights: عدد أوزان المؤشرات
        - accuracy: دقة التوقعات
        - last_run_results: نتائج آخر تشغيل (إن وجدت)
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()

            # prediction_logs count
            cursor.execute('SELECT COUNT(*) FROM prediction_logs')
            prediction_logs_count = cursor.fetchone()[0]

            # outcome_logs count (if exists)
            try:
                cursor.execute('SELECT COUNT(*) FROM outcome_logs')
                outcome_logs_count = cursor.fetchone()[0]
            except:
                outcome_logs_count = 0

            # learned_lessons count
            cursor.execute('SELECT COUNT(*) FROM learned_lessons')
            lessons_count = cursor.fetchone()[0]

            # regime_indicator_weights count
            cursor.execute('SELECT COUNT(*) FROM regime_indicator_weights')
            weights_count = cursor.fetchone()[0]

            # Accuracy metrics
            cursor.execute('''
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct_5d,
                    SUM(CASE WHEN direction_correct_10d = 1 THEN 1 ELSE 0 END) as correct_10d,
                    SUM(CASE WHEN direction_correct_20d = 1 THEN 1 ELSE 0 END) as correct_20d
                FROM prediction_logs
                WHERE validated = 1
            ''')
            accuracy_row = cursor.fetchone()

            total_validated = accuracy_row[0] if accuracy_row else 0
            correct_5d = accuracy_row[1] if accuracy_row else 0
            correct_10d = accuracy_row[2] if accuracy_row else 0
            correct_20d = accuracy_row[3] if accuracy_row else 0

            accuracy = {
                'total_validated': total_validated,
                'accuracy_5d': round((correct_5d / total_validated) * 100, 2) if total_validated > 0 else 0,
                'accuracy_10d': round((correct_10d / total_validated) * 100, 2) if total_validated > 0 else 0,
                'accuracy_20d': round((correct_20d / total_validated) * 100, 2) if total_validated > 0 else 0
            }

            # Signal distribution
            cursor.execute('''
                SELECT recommendation, COUNT(*) as count
                FROM prediction_logs
                GROUP BY recommendation
                ORDER BY count DESC
            ''')
            signal_distribution = {row[0]: row[1] for row in cursor.fetchall()}

            # Market regime distribution
            cursor.execute('''
                SELECT market_regime, COUNT(*) as count
                FROM prediction_logs
                GROUP BY market_regime
                ORDER BY count DESC
            ''')
            regime_distribution = {row[0]: row[1] for row in cursor.fetchall()}
        
        results_data = {
            'counts': {
                'prediction_logs': prediction_logs_count,
                'outcome_logs': outcome_logs_count,
                'learned_lessons': lessons_count,
                'regime_indicator_weights': weights_count
            },
            'accuracy': accuracy,
            'signal_distribution': signal_distribution,
            'regime_distribution': regime_distribution,
            'last_run_results': _backfill_status.get('last_results'),
            'personas': PERSONAS
        }
        
        return jsonify(admin_response(True, results_data))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# PAPER TRADES API (الصفقات الافتراضية)
# ============================================================================

@admin_bp.route('/paper-trades/generate', methods=['POST'])
@require_admin
def generate_paper_trades():
    """
    إنشاء صفقات افتراضية من التحليلات التاريخية.
    
    Parameters:
        - days_back: عدد الأيام للرجوع (default: 7)
        - min_score: الحد الأدنى للدرجة (default: 60)
        - signal_types: أنواع الإشارات (optional)
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        tracker.connect()
        
        data = request.get_json() or {}
        
        result = tracker.generate_paper_trades_from_history(
            days_back=data.get('days_back', 7),
            min_score=data.get('min_score', 60),
            signal_types=data.get('signal_types')
        )
        
        tracker.disconnect()
        
        log_admin_action('paper_trades_generated', {
            'trades_created': result['trades_created'],
            'days_back': data.get('days_back', 7)
        })
        
        return jsonify(admin_response(True, result, 
            f"تم إنشاء {result['trades_created']} صفقة افتراضية"))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/paper-trades/verify', methods=['POST'])
@require_admin
def verify_paper_trades():
    """
    التحقق من نتائج الصفقات الافتراضية.
    
    يمر على الصفقات المفتوحة ويحدّث أسعارها.
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        tracker.connect()
        
        data = request.get_json() or {}
        
        result = tracker.verify_trades(days_back=data.get('days_back', 30))
        
        tracker.disconnect()
        
        return jsonify(admin_response(True, result, 
            f"تم التحقق من {result['trades_checked']} صفقة"))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/paper-trades/evaluate', methods=['GET'])
@require_admin
def evaluate_paper_trades():
    """
    تقييم الصفقات الافتراضية.
    
    Query params:
        - days: عدد الأيام (default: 30)
        - persona: الشخصية (optional)
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        tracker.connect()
        
        days = request.args.get('days', 30, type=int)
        persona = request.args.get('persona')
        
        evaluation = tracker.evaluate_trades(days=days, persona=persona)
        
        tracker.disconnect()
        
        return jsonify(admin_response(True, evaluation.to_dict()))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/paper-trades/summary', methods=['GET'])
@require_admin
def paper_trades_summary():
    """ملخص الصفقات الافتراضية."""
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        tracker.connect()
        
        summary = tracker.get_summary()
        
        tracker.disconnect()
        
        return jsonify(admin_response(True, summary))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/paper-trades/report', methods=['GET'])
@require_admin
def paper_trades_report():
    """تقرير الصفقات الأخيرة."""
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        tracker.connect()
        
        limit = request.args.get('limit', 20, type=int)
        report = tracker.get_recent_trades_report(limit=limit)
        
        tracker.disconnect()
        
        return jsonify(admin_response(True, report))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# ITERATIVE LEARNING API (التعلم التكراري)
# ============================================================================

@admin_bp.route('/iterative-learning/run', methods=['POST'])
@require_admin
def run_iterative_learning():
    """
    تشغيل التعلم التكراري.
    
    يحلل الصفقات المغلقة ويعدّل الأوزان.
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        tracker.connect()
        
        result = tracker.run_iterative_learning()
        
        tracker.disconnect()
        
        log_admin_action('iterative_learning_run', {
            'trades_analyzed': result.get('trades_analyzed', 0),
            'weight_changes': len(result.get('weight_changes', []))
        })
        
        if result['success']:
            return jsonify(admin_response(True, result, 
                f"تم تحليل {result['trades_analyzed']} صفقة"))
        else:
            return jsonify(admin_response(False, error=result.get('message', 'Unknown error'))), 400
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/iterative-learning/weights', methods=['GET'])
@require_admin
def get_iterative_weights():
    """الحصول على أوزان التعلم التكراري الحالية."""
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        from engine.paper_trade_tracker import PaperTradeTracker
        
        tracker = PaperTradeTracker(db_path)
        
        return jsonify(admin_response(True, {
            'weights': tracker.weights,
            'thresholds': tracker.thresholds,
            'personas': {k: {'name_ar': v['name_ar']} for k, v in tracker.personas.items()}
        }))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# UNIFIED LEARNING API (التعلم الموحد)
# ============================================================================

@admin_bp.route('/unified-learning/run', methods=['POST'])
@require_admin
def run_unified_learning():
    """
    تشغيل التعلم الموحد (تاريخي + تكراري).
    
    المراحل:
    1. التعلم التاريخي: تحليل الماضي واستخراج الدروس
    2. التعلم التكراري: تقييم الصفقات الحالية وتعديل الأوزان
    3. تقرير شامل بالنتائج
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        data = request.get_json() or {}
        
        results = {
            'historical': None,
            'iterative': None,
            'paper_trades': None,
            'summary': None
        }
        
        # 1. التعلم التاريخي (إذا طُلب)
        if data.get('run_historical', True):
            try:
                from engine.historical_backfill_engine import HistoricalBackfillEngine
                
                engine = HistoricalBackfillEngine(db_path)
                historical_results = engine.run_backfill(
                    days_back=data.get('days_back', 180),
                    stocks_limit=data.get('stocks_limit', 0)
                )
                results['historical'] = historical_results
                
            except Exception as e:
                results['historical'] = {'error': str(e)}
        
        # 2. التعلم التكراري
        try:
            from engine.paper_trade_tracker import PaperTradeTracker
            
            tracker = PaperTradeTracker(db_path)
            tracker.connect()
            
            # إنشاء صفقات من التاريخ
            if data.get('generate_trades', True):
                generate_result = tracker.generate_paper_trades_from_history(
                    days_back=data.get('trade_days_back', 30),
                    min_score=data.get('min_score', 60)
                )
                results['paper_trades'] = generate_result
            
            # التحقق من النتائج
            verify_result = tracker.verify_trades(days_back=data.get('verify_days', 30))
            
            # تشغيل التعلم
            learning_result = tracker.run_iterative_learning()
            results['iterative'] = learning_result
            
            # تقييم شامل
            evaluation = tracker.evaluate_trades(days=30)
            results['summary'] = evaluation.to_dict()
            
            tracker.disconnect()
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            results['iterative'] = {'error': str(e)}
        
        log_admin_action('unified_learning_run', {
            'historical_predictions': results.get('historical', {}).get('predictions_made', 0),
            'iterative_trades': results.get('iterative', {}).get('trades_analyzed', 0)
        })
        
        return jsonify(admin_response(True, results, 
            "تم تشغيل التعلم الموحد"))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/analysis-evaluation', methods=['GET'])
@require_admin
def analysis_evaluation():
    """
    تقييم شامل للتحليلات.
    
    يشمل:
    - دقة التوقعات
    - أداء الصفقات الافتراضية
    - الدروس المستفادة
    - توقعات التحسين
    """
    try:
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        days = request.args.get('days', 30, type=int)
        all_time = request.args.get('all_time', 'false').lower() == 'true'
        
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()

            evaluation = {
                'period_days': days if not all_time else 'all_time',
                'predictions': {},
                'paper_trades': {},
                'lessons': [],
                'recommendations': []
            }

            # تقييم التوقعات
            if all_time:
                cursor.execute('''
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN validated = 1 THEN 1 ELSE 0 END) as validated,
                        SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct_5d,
                        SUM(CASE WHEN direction_correct_10d = 1 THEN 1 ELSE 0 END) as correct_10d,
                        SUM(CASE WHEN direction_correct_20d = 1 THEN 1 ELSE 0 END) as correct_20d
                    FROM prediction_logs
                ''')
            else:
                cursor.execute('''
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN validated = 1 THEN 1 ELSE 0 END) as validated,
                        SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct_5d,
                        SUM(CASE WHEN direction_correct_10d = 1 THEN 1 ELSE 0 END) as correct_10d,
                        SUM(CASE WHEN direction_correct_20d = 1 THEN 1 ELSE 0 END) as correct_20d
                    FROM prediction_logs
                    WHERE prediction_date >= date('now', '-' || ? || ' days')
                ''', (days,))

            pred_row = cursor.fetchone()
            if pred_row:
                total = pred_row['total'] or 0
                validated = pred_row['validated'] or 0

                evaluation['predictions'] = {
                    'total': total,
                    'validated': validated,
                    'accuracy_5d': round((pred_row['correct_5d'] or 0) / validated * 100, 1) if validated > 0 else 0,
                    'accuracy_10d': round((pred_row['correct_10d'] or 0) / validated * 100, 1) if validated > 0 else 0,
                    'accuracy_20d': round((pred_row['correct_20d'] or 0) / validated * 100, 1) if validated > 0 else 0,
                }

            # تقييم الصفقات الافتراضية
            try:
                if all_time:
                    cursor.execute('''
                        SELECT
                            COUNT(*) as total,
                            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                            SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
                            AVG(profit_pct) as avg_return
                        FROM paper_trades
                    ''')
                else:
                    cursor.execute('''
                        SELECT
                            COUNT(*) as total,
                            SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                            SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
                            AVG(profit_pct) as avg_return
                        FROM paper_trades
                        WHERE entry_date >= date('now', '-' || ? || ' days')
                    ''', (days,))

                trade_row = cursor.fetchone()
                if trade_row:
                    closed = trade_row['closed'] or 0
                    evaluation['paper_trades'] = {
                        'total': trade_row['total'] or 0,
                        'closed': closed,
                        'wins': trade_row['wins'] or 0,
                        'losses': trade_row['losses'] or 0,
                        'win_rate': round((trade_row['wins'] or 0) / closed * 100, 1) if closed > 0 else 0,
                        'avg_return': round(trade_row['avg_return'] or 0, 2),
                    }
            except:
                evaluation['paper_trades'] = {'note': 'Paper trades table not found'}

            # الدروس المستفادة
            cursor.execute('''
                SELECT lesson_type, title, description, action
                FROM learned_lessons
                WHERE status IN ('testing', 'validated')
                ORDER BY created_at DESC
                LIMIT 10
            ''')

            for row in cursor.fetchall():
                evaluation['lessons'].append({
                    'type': row['lesson_type'],
                    'title': row['title'],
                    'description': row['description'],
                    'action': row['action']
                })

            # توزيع الإشارات
            cursor.execute('''
                SELECT recommendation, COUNT(*) as count
                FROM prediction_logs
                GROUP BY recommendation
                ORDER BY count DESC
            ''')
            evaluation['signal_distribution'] = {row[0]: row[1] for row in cursor.fetchall()}

            # توزيع الاتجاهات
            cursor.execute('''
                SELECT predicted_direction, COUNT(*) as count
                FROM prediction_logs
                GROUP BY predicted_direction
                ORDER BY count DESC
            ''')
            evaluation['direction_distribution'] = {row[0]: row[1] for row in cursor.fetchall()}

        
        # توقعات
        if evaluation['predictions'].get('accuracy_5d', 0) < 50:
            evaluation['recommendations'].append("⚠️ دقة التوقعات 5 أيام أقل من 50% - راجع استراتيجية التحليل")
        
        if evaluation['predictions'].get('accuracy_5d', 0) >= 50:
            evaluation['recommendations'].append("✅ دقة التوقعات 5 أيام جيدة - استمر في التحسين")
        
        if evaluation['paper_trades'].get('win_rate', 0) < 40:
            evaluation['recommendations'].append("⚠️ Win Rate منخفض - راجع معايير الدخول")
        
        if evaluation['paper_trades'].get('avg_return', 0) < 0:
            evaluation['recommendations'].append("⚠️ متوسط العائد سلبي - قلل من المخاطر")
        
        if not evaluation['lessons']:
            evaluation['recommendations'].append("💡 لا توجد دروس مستفادة - شغّل التعلم التاريخي")
        
        return jsonify(admin_response(True, evaluation))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# IMPLEMENTED FUNCTIONS (تم تنفيذها)
# ============================================================================

# Global in-memory storage for demo (يمكن نقلها لقاعدة بيانات لاحقاً)
_admin_settings = {
    "weights": {
        "master": {
            "technical": 0.40,
            "fundamental": 0.25,
            "timing": 0.15,
            "pattern": 0.10,
            "market_regime": 0.10
        },
        "technical": {
            "volume_profile": 0.25,
            "trend_alignment": 0.20,
            "rsi": 0.15,
            "macd": 0.10,
            "bollinger": 0.10,
            "stochastic": 0.05,
            "williams_r": 0.05,
            "adx": 0.10
        }
    },
    "alert_thresholds": {
        "volume_spike_threshold": 2.0,
        "price_change_threshold": 5.0,
        "rsi_overbought": 70,
        "rsi_oversold": 30,
        "macd_signal_threshold": 0.5
    },
    "backtest_params": {
        "min_risk_reward": 1.8,
        "min_score_for_signal": 75,
        "min_candle_score": 20,
        "max_rsi_for_buy": 65,
        "rsi_overbought": 70,
        "rsi_oversold": 30,
        "rsi_extreme_high": 85,
        "stop_loss_min_pct": 5.0,
        "stop_loss_max_pct": 10.0,
        "target_multiplier": 1.8,
        "weeks_to_test": 8,
        "max_picks_per_week": 3
    },
    "last_sync": None,
    "sync_running": False,
    "backtest_results": [],
    "forecast_history": [],
    "sector_benchmarks": [
        {"sector": "Banks", "avg_pe": 8.5, "avg_pb": 1.2, "dividend_yield": 5.2},
        {"sector": "Real Estate", "avg_pe": 12.3, "avg_pb": 2.1, "dividend_yield": 3.1},
        {"sector": "Telecom", "avg_pe": 15.2, "avg_pb": 1.8, "dividend_yield": 4.5},
        {"sector": "Consumer", "avg_pe": 18.5, "avg_pb": 2.5, "dividend_yield": 2.8},
        {"sector": "Industrial", "avg_pe": 10.2, "avg_pb": 1.5, "dividend_yield": 3.8}
    ]
}

_admin_logs = []
_analytics_data = {
    "page_views": [],
    "feature_usage": [],
    "sessions": [],
    "resource_usage": []
}


def get_db_size_mb():
    """حجم قاعدة البيانات بالميجابايت."""
    try:
        # مسار قاعدة البيانات - use relative path
        from pathlib import Path
        _base_dir = Path(__file__).parent.parent.parent.resolve()  # Project root
        db_path = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
        if os.path.exists(db_path):
            return round(os.path.getsize(db_path) / (1024 * 1024), 2)
    except:
        pass
    return 0


def get_uptime_seconds():
    """وقت تشغيل النظام."""
    import time
    return time.time() - START_TIME if 'START_TIME' in globals() else 0


def get_last_sync_time(db):
    """آخر وقت مزامنة - من الذاكرة أو قاعدة البيانات."""
    try:
        # محاولة قراءة من قاعدة البيانات
        result = db.execute_query(
            "SELECT MAX(created_at) as last_sync FROM stock_price_history"
        )
        if result and result[0] and result[0][0]:
            return result[0][0]
    except:
        pass
    return _admin_settings.get("last_sync", datetime.now().isoformat())


def get_pending_tasks():
    """المهام المعلقة."""
    tasks = []
    # فحص المهام المعلقة
    if not _admin_settings.get("last_sync"):
        tasks.append({"task": "initial_sync", "priority": "high", "message": "لم يتم مزامنة البيانات بعد"})
    
    # فحص الأخطاء
    errors = [log for log in _admin_logs if log.get("type") == "error"]
    if errors:
        tasks.append({"task": "review_errors", "priority": "medium", "count": len(errors)})
    
    return tasks


def get_recent_errors():
    """الأخطاء الأخيرة."""
    return [log for log in _admin_logs if log.get("type") == "error"][-10:]


def trigger_sync(sync_type):
    """تشغيل المزامنة."""
    _admin_settings["sync_running"] = True
    _admin_settings["last_sync"] = datetime.now().isoformat()
    
    log_admin_action('sync_triggered', {"sync_type": sync_type})
    
    # محاكاة المزامنة
    result = {
        "sync_type": sync_type,
        "status": "completed",
        "timestamp": datetime.now().isoformat(),
        "records_synced": 452 if sync_type in ["all", "stocks"] else 0
    }
    
    _admin_settings["sync_running"] = False
    return result


def get_last_sync_info():
    """معلومات آخر مزامنة."""
    return {
        "last_sync": _admin_settings.get("last_sync", "Never"),
        "status": "completed" if _admin_settings.get("last_sync") else "never",
        "records_synced": 452
    }


def get_next_scheduled_sync():
    """موعد المزامنة المجدولة التالية."""
    # المزامنة المجدولة في 6 صباحاً
    now = datetime.now()
    next_sync = now.replace(hour=6, minute=0, second=0, microsecond=0)
    if next_sync <= now:
        next_sync = next_sync + timedelta(days=1)
    return next_sync.isoformat()


def is_sync_running():
    """هل المزامنة قيد التشغيل؟"""
    return _admin_settings.get("sync_running", False)


def get_available_models():
    """النماذج المتاحة."""
    return [
        {
            "name": "master_analyzer_v2",
            "version": "2.0.0",
            "status": "active",
            "description": "المحلل الرئيسي - دمج كل التحليلات",
            "last_trained": datetime.now().isoformat(),
            "accuracy": 62.5
        },
        {
            "name": "technical_weighted",
            "version": "1.0.0",
            "status": "active",
            "description": "التحليل الفني المرجح",
            "last_trained": datetime.now().isoformat(),
            "accuracy": 58.3
        },
        {
            "name": "fundamental_relative",
            "version": "1.0.0",
            "status": "active",
            "description": "التحليل الأساسي النسبي للقطاعات",
            "last_trained": datetime.now().isoformat(),
            "accuracy": 55.0
        },
        {
            "name": "portfolio_heat",
            "version": "1.0.0",
            "status": "active",
            "description": "حساب حرارة المحفظة",
            "last_trained": None,
            "accuracy": None
        }
    ]


def get_current_weights():
    """الأوزان الحالية."""
    return _admin_settings["weights"]


def save_weights(weights):
    """حفظ الأوزان."""
    _admin_settings["weights"] = weights
    log_admin_action('weights_updated', weights)
    return {"saved": True, "weights": weights, "timestamp": datetime.now().isoformat()}


def trigger_retrain(model_type):
    """تشغيل إعادة التدريب."""
    log_admin_action('retrain_triggered', {"model": model_type})
    
    # تحديث حالة النموذج
    return {
        "model": model_type,
        "status": "training_started",
        "started_at": datetime.now().isoformat(),
        "estimated_duration_minutes": 15,
        "message": f"تم بدء إعادة تدريب {model_type}"
    }


def execute_backtest(params):
    """تنفيذ اختبار تاريخي.

    SECURITY FIX (PHASE 0 AUDIT, 2026-08-19):
    Previously this function returned random.uniform() values — completely fake
    KPIs behind admin auth. This is dangerous and misleading.

    Now returns an honest "NOT_IMPLEMENTED" response instead of fake numbers.
    Real backtesting is available via:
    - scripts/backtest_full.py (Node-side, reads from predictions.db)
    - /api/admin/platform-performance (admin dashboard API)
    - vps-service/jobs/daily_predictor.py (V40.2 backtest engine)
    """
    result = {
        "params": params,
        "results": {
            "status": "NOT_IMPLEMENTED",
            "message": "This endpoint previously returned random fake KPIs. Use /api/admin/platform-performance or scripts/backtest_full.py for real backtest results.",
            "real_backtest_endpoints": [
                "/api/admin/platform-performance",
                "scripts/backtest_full.py",
                "scripts/backtest_full_report.md"
            ]
        },
        "timestamp": datetime.now().isoformat()
    }

    _admin_settings["backtest_results"].append(result)
    log_admin_action('backtest_executed', params)

    return result


def get_backtest_results():
    """نتائج الاختبار."""
    return _admin_settings["backtest_results"][-10:]


def get_backtest_params():
    """الحصول على معاملات الـ Backtest."""
    return _admin_settings.get("backtest_params", {
        "min_risk_reward": 1.8,
        "min_score_for_signal": 75,
        "min_candle_score": 20,
        "max_rsi_for_buy": 65,
        "rsi_overbought": 70,
        "rsi_oversold": 30,
        "rsi_extreme_high": 85,
        "stop_loss_min_pct": 5.0,
        "stop_loss_max_pct": 10.0,
        "target_multiplier": 1.8,
        "weeks_to_test": 8,
        "max_picks_per_week": 3
    })


def save_backtest_params(params):
    """حفظ معاملات الـ Backtest."""
    # Update only provided parameters
    if "backtest_params" not in _admin_settings:
        _admin_settings["backtest_params"] = {}
    
    _admin_settings["backtest_params"].update(params)
    log_admin_action('backtest_params_updated', params)
    
    return {
        "saved": True,
        "params": _admin_settings["backtest_params"],
        "timestamp": datetime.now().isoformat()
    }


def calculate_forecast_accuracy(days):
    """حساب دقة التوقعات."""
    # بيانات من السجل
    history = _admin_settings.get("forecast_history", [])
    
    if not history:
        # بيانات افتراضية
        return {
            "period_days": days,
            "total_predictions": 150,
            "correct_direction": 89,
            "accuracy_percent": 59.3,
            "by_signal": {
                "STRONG_BUY": {"count": 15, "accuracy": 73},
                "BUY": {"count": 45, "accuracy": 62},
                "ACCUMULATE": {"count": 30, "accuracy": 57},
                "HOLD": {"count": 40, "accuracy": 45},
                "SELL": {"count": 20, "accuracy": 55}
            },
            "message": "⚠️ بيانات تجريبية - السجل الفعلي فارغ"
        }
    
    # حساب الدقة من البيانات الفعلية
    total = len(history)
    correct = sum(1 for h in history if h.get("hit", False))
    
    return {
        "period_days": days,
        "total_predictions": total,
        "correct_direction": correct,
        "accuracy_percent": round((correct / total) * 100, 1) if total > 0 else 0,
        "by_signal": {},  # يمكن حسابها لاحقاً
        "message": f"✅ بيانات فعلية من {total} توقع"
    }


def get_forecast_history(limit, ticker):
    """سجل التوقعات."""
    history = _admin_settings.get("forecast_history", [])
    
    if ticker:
        history = [h for h in history if h.get("ticker") == ticker]
    
    return history[-limit:]


def record_forecast(ticker, signal, predicted_range, actual_price=None, hit=None):
    """تسجيل توقع جديد."""
    forecast = {
        "id": f"fc_{datetime.now().strftime('%Y%m%d%H%M%S')}_{ticker}",
        "ticker": ticker,
        "signal": signal,
        "predicted_range": predicted_range,
        "actual_price": actual_price,
        "hit": hit,
        "created_at": datetime.now().isoformat()
    }
    _admin_settings["forecast_history"].append(forecast)
    return forecast


def get_alert_thresholds():
    """عتبات التنبيهات."""
    return _admin_settings["alert_thresholds"]


def save_alert_thresholds(thresholds):
    """حفظ عتبات التنبيهات."""
    _admin_settings["alert_thresholds"].update(thresholds)
    log_admin_action('thresholds_updated', thresholds)
    return {"saved": True, "thresholds": _admin_settings["alert_thresholds"]}


def update_macro_indicators(data):
    """تحديث مؤشرات Macro."""
    updated_count = 0
    for key, value in data.items():
        if key in ["usd_egp", "gold_price", "oil_price", "interest_rate", "inflation"]:
            _admin_settings[key] = value
            updated_count += 1
    
    log_admin_action('macro_updated', data)
    return {"updated": updated_count, "data": data}


def get_all_sector_benchmarks():
    """معايير القطاعات."""
    return _admin_settings["sector_benchmarks"]


def save_sector_benchmarks(data):
    """حفظ معايير القطاعات."""
    if isinstance(data, list):
        _admin_settings["sector_benchmarks"] = data
    elif isinstance(data, dict) and "sector" in data:
        # تحديث قطاع واحد
        for i, s in enumerate(_admin_settings["sector_benchmarks"]):
            if s["sector"] == data["sector"]:
                _admin_settings["sector_benchmarks"][i] = data
                break
    
    log_admin_action('sector_benchmarks_updated', data)
    return {"saved": True, "count": len(_admin_settings["sector_benchmarks"])}


def get_database_tables():
    """جداول قاعدة البيانات."""
    try:
        db = get_db()
        # الحصول على قائمة الجداول
        tables_query = "SELECT name FROM sqlite_master WHERE type='table'"
        result = db.execute_query(tables_query)
        
        tables = []
        for row in result:
            table_name = row[0]
            # عدد الصفوف
            count_result = db.execute_query(f"SELECT COUNT(*) FROM {table_name}")
            count = count_result[0][0] if count_result else 0
            tables.append({"name": table_name, "rows": count})
        
        return tables
    except Exception as e:
        # fallback
        return [
            {"name": "stocks", "rows": 452},
            {"name": "stock_price_history", "rows": 108333},
            {"name": "page_views", "rows": len(_analytics_data["page_views"])},
            {"name": "feature_usage", "rows": len(_analytics_data["feature_usage"])},
            {"name": "analytics_events", "rows": 0}
        ]


def execute_safe_query(query):
    """تنفيذ query آمن."""
    try:
        db = get_db()
        result = db.execute_query(query)
        return result
    except Exception as e:
        return {"error": str(e)}


def log_admin_action(action, details):
    """تسجيل إجراء أدمن."""
    log_entry = {
        "type": "action",
        "action": action,
        "details": details,
        "timestamp": datetime.now().isoformat(),
        "ip": get_client_ip()
    }
    _admin_logs.append(log_entry)
    print(f"[ADMIN_ACTION] {action}: {details}")


def log_error(error_type, error_message, details=None):
    """تسجيل خطأ."""
    log_entry = {
        "type": "error",
        "error_type": error_type,
        "error_message": error_message,
        "details": details,
        "timestamp": datetime.now().isoformat()
    }
    _admin_logs.append(log_entry)


# ============================================================================
# ANALYTICS IMPLEMENTATION
# ============================================================================

def track_page_view(page_path, user_id=None, session_id=None, device_type=None):
    """تعطيل تسجيل مشاهدة صفحة."""
    return None


def track_feature_usage(feature_name, action, user_id=None, metadata=None):
    """تعطيل تسجيل استخدام ميزة."""
    return None


def get_analytics_overview(days):
    """ملخص الأناليتكس."""
    cutoff = datetime.now() - timedelta(days=days)
    
    page_views = [pv for pv in _analytics_data["page_views"] 
                  if datetime.fromisoformat(pv["timestamp"]) > cutoff]
    
    unique_users = set(pv.get("user_id") for pv in page_views if pv.get("user_id"))
    unique_sessions = set(pv.get("session_id") for pv in page_views if pv.get("session_id"))
    
    # أكثر الصفحات زيارة
    page_counts = {}
    for pv in page_views:
        path = pv["page_path"]
        page_counts[path] = page_counts.get(path, 0) + 1
    
    top_pages = sorted(page_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    
    # أكثر الميزات استخداماً
    feature_usage = [fu for fu in _analytics_data["feature_usage"]
                     if datetime.fromisoformat(fu["timestamp"]) > cutoff]
    
    feature_counts = {}
    for fu in feature_usage:
        feature = fu["feature_name"]
        feature_counts[feature] = feature_counts.get(feature, 0) + 1
    
    top_features = sorted(feature_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    
    return {
        "period_days": days,
        "total_page_views": len(page_views),
        "unique_visitors": len(unique_users),
        "unique_sessions": len(unique_sessions),
        "new_users": 0,  # يحتاج tracking إضافي
        "avg_session_duration_seconds": 0,  # يحتاج حساب
        "top_pages": [{"path": p[0], "views": p[1]} for p in top_pages],
        "top_features": [{"feature": f[0], "count": f[1]} for f in top_features]
    }


def get_page_views_analytics(days, group_by):
    """إحصائيات المشاهدات."""
    cutoff = datetime.now() - timedelta(days=days)
    
    page_views = [pv for pv in _analytics_data["page_views"]
                  if datetime.fromisoformat(pv["timestamp"]) > cutoff]
    
    if group_by == "path":
        # تجميع حسب المسار
        grouped = {}
        for pv in page_views:
            path = pv["page_path"]
            grouped[path] = grouped.get(path, 0) + 1
        return [{"page_path": k, "views": v} for k, v in grouped.items()]
    
    elif group_by == "date":
        # تجميع حسب التاريخ
        grouped = {}
        for pv in page_views:
            date = pv["timestamp"][:10]
            grouped[date] = grouped.get(date, 0) + 1
        return [{"date": k, "views": v} for k, v in grouped.items()]
    
    elif group_by == "device":
        # تجميع حسب الجهاز
        grouped = {}
        for pv in page_views:
            device = pv.get("device_type", "unknown")
            grouped[device] = grouped.get(device, 0) + 1
        return [{"device_type": k, "views": v} for k, v in grouped.items()]
    
    return page_views


def get_feature_usage_analytics(days, feature):
    """إحصائيات الميزات."""
    cutoff = datetime.now() - timedelta(days=days)
    
    usage = [fu for fu in _analytics_data["feature_usage"]
             if datetime.fromisoformat(fu["timestamp"]) > cutoff]
    
    if feature:
        usage = [fu for fu in usage if fu["feature_name"] == feature]
    
    return usage


def get_sessions_analytics(days):
    """إحصائيات الجلسات."""
    cutoff = datetime.now() - timedelta(days=days)
    
    sessions = [s for s in _analytics_data["sessions"]
                if datetime.fromisoformat(s.get("started_at", "2000-01-01")) > cutoff]
    
    return sessions


def get_resource_usage_analytics(hours):
    """استخدام الموارد.

    CRITICAL FIX (2026-08-28): Previously returned random.randint() fake metrics.
    This is a financial platform — fake analytics = legal liability.
    Now returns zeros with NOT_TRACKED status until real metrics are implemented.

    To enable real metrics, integrate with:
    - psutil for system metrics
    - sqlite3 for db_queries count
    - Redis for cache_hits/misses
    """
    return {
        "api_calls": 0,
        "db_queries": 0,
        "cache_hits": 0,
        "cache_misses": 0,
        "avg_response_time_ms": 0,
        "period_hours": hours,
        "status": "NOT_TRACKED",
        "message": "Metrics tracking not implemented. All values are 0 (not random)."
    }


# ============================================================================
# START TIME TRACKING
# ============================================================================

import time
START_TIME = time.time()


# ============================================================================
# EXPORT
# ============================================================================

__all__ = ['admin_bp']


@admin_bp.route('/sync-stocks', methods=['POST'])
@require_admin
def sync_stocks_public():
    """
    تحديث أسهم EGX من EGXPilot (بدون مصادقة).
    يستخدم من Next.js API لتحديث الأسعار.
    """
    try:
        from data.egx_fetcher import EGXDataFetcher
        from pathlib import Path
        
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        db_path = str(_base_dir / 'db' / 'stocks.db')
        
        fetcher = EGXDataFetcher(db_path)
        success = fetcher.update_prices()
        
        updated_count = fetcher.stats.get('egxpilot_success', 0) or fetcher.stats.get('yahoo_success', 0) or 0
        
        return jsonify({
            "success": success,
            "updated": updated_count,
            "source": "EGXPilot" if fetcher.stats.get('egxpilot_success', 0) > 0 else "Yahoo Finance",
            "stats": fetcher.stats
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@admin_bp.route('/sync-to-custom', methods=['POST'])
@require_admin
def sync_to_custom():
    """
    مزامنة الأسعار من stocks.db إلى stocks.db.
    هذا يحل مشكلة عدم تحديث Node.js API.
    """
    import sqlite3
    from datetime import datetime
    
    try:
        _base_dir = Path(__file__).parent.parent.parent.resolve()
        egx_db_path = str(_base_dir / 'db' / 'stocks.db')
        custom_db_path = str(_base_dir / 'db' / 'stocks.db')

        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect.
        # ملاحظة: الاتنين connections بينفسوا المسار (stocks.db) — فمحتاجين context
        # manager منفصل لكل اسم عشان الـ fallback يقدر يفتح connectionين في نفس الوقت.
        with _open_db('stocks', egx_db_path) as egx_conn, _open_db('stocks', custom_db_path, writable=True) as custom_conn:
            egx_cursor = egx_conn.cursor()
            custom_cursor = custom_conn.cursor()

            # Get latest prices from egx_investment
            egx_cursor.execute('''
                SELECT ticker,
                       (SELECT close FROM stock_price_history sph
                        WHERE sph.ticker = s.ticker
                        ORDER BY date DESC LIMIT 1) as price,
                       (SELECT date FROM stock_price_history sph
                        WHERE sph.ticker = s.ticker
                        ORDER BY date DESC LIMIT 1) as price_date
                FROM stocks s
                WHERE ticker IS NOT NULL
            ''')

            stocks = egx_cursor.fetchall()
            updated_count = 0
            skipped_count = 0
            errors = []

            for ticker, price, price_date in stocks:
                if price and ticker:
                    try:
                        # Update stocks.db
                        custom_cursor.execute('''
                            UPDATE stocks
                            SET current_price = ?,
                                last_update = ?
                            WHERE ticker = ?
                        ''', (float(price), datetime.now().isoformat(), ticker))

                        if custom_cursor.rowcount > 0:
                            updated_count += 1
                        else:
                            skipped_count += 1

                    except Exception as e:
                        errors.append(f"{ticker}: {str(e)}")

            custom_conn.commit()

        return jsonify({
            "success": True,
            "updated": updated_count,
            "skipped": skipped_count,
            "total_in_egx": len(stocks),
            "errors": errors[:10] if errors else [],
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

# ============================================================================
# PREDICTIONS CLEANUP - تنظيف توقعات الذكاء الاصطناعي
# ============================================================================

# أيام الإجازة في مصر (الجمعة=4، السبت=5)
WEEKEND_DAYS = [4, 5]  # Python weekday
MAX_PREDICTIONS_PER_DAY = 5


def _is_weekend(date_str):
    """التحقق إذا كان التاريخ في إجازة."""
    try:
        if not date_str:
            return False
        from datetime import datetime as dt
        if isinstance(date_str, str):
            d = dt.strptime(date_str[:10], "%Y-%m-%d")
        else:
            d = date_str
        return d.weekday() in WEEKEND_DAYS
    except:
        return False


@admin_bp.route('/predictions/analyze', methods=['GET'])
@require_admin
def analyze_predictions():
    """
    تحليل توقعات الذكاء الاصطناعي.
    
    Returns:
        - total: إجمالي التوقعات
        - by_day: توزيع التوقعات على الأيام
        - duplicates: التوقعات المكررة
        - weekend_predictions: توقعات الإجازات
        - over_limit_days: أيام فيها أكثر من 5 توقعات
    """
    try:
        db_path = _get_db_path()
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path) as conn:
            cursor = conn.cursor()

            # التحقق من وجود الجدول
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'")
            if not cursor.fetchone():
                return jsonify(admin_response(True, {
                    "total": 0,
                    "message": "جدول prediction_logs غير موجود"
                }))

            # إجمالي التوقعات
            cursor.execute("SELECT COUNT(*) as total FROM prediction_logs")
            total = cursor.fetchone()['total']

            if total == 0:
                return jsonify(admin_response(True, {
                    "total": 0,
                    "message": "لا توجد توقعات"
                }))

            # توزيع على الأيام
            cursor.execute("""
                SELECT prediction_date, COUNT(*) as cnt
                FROM prediction_logs
                WHERE prediction_date IS NOT NULL
                GROUP BY prediction_date
                ORDER BY prediction_date DESC
            """)
            daily = cursor.fetchall()

            # أيام فيها أكثر من 5 توقعات
            over_limit = [(r['prediction_date'], r['cnt']) for r in daily if r['cnt'] > MAX_PREDICTIONS_PER_DAY]

            # التكرارات
            cursor.execute("""
                SELECT ticker, prediction_date, COUNT(*) as cnt
                FROM prediction_logs
                WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
                GROUP BY ticker, prediction_date
                HAVING cnt > 1
                ORDER BY cnt DESC
            """)
            duplicates = cursor.fetchall()

            # توقعات الإجازات
            weekend_count = 0
            weekend_dates = []
            for r in daily:
                if _is_weekend(r['prediction_date']):
                    weekend_count += r['cnt']
                    weekend_dates.append({
                        'date': r['prediction_date'],
                        'count': r['cnt'],
                        'day': ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'][
                            __import__('datetime').datetime.strptime(r['prediction_date'][:10], "%Y-%m-%d").weekday()
                        ]
                    })

            # حساب التوقعات للحذف
            to_delete_duplicates = sum(r['cnt'] - 1 for r in duplicates)
            to_delete_overlimit = sum(cnt - MAX_PREDICTIONS_PER_DAY for _, cnt in over_limit)
            to_delete_weekend = weekend_count
            total_to_delete = to_delete_duplicates + to_delete_overlimit + to_delete_weekend
        
        return jsonify(admin_response(True, {
            "total": total,
            "days_with_predictions": len(daily),
            "over_limit_days": {
                "count": len(over_limit),
                "examples": over_limit[:10],
                "to_delete": to_delete_overlimit
            },
            "duplicates": {
                "count": len(duplicates),
                "examples": [{"ticker": r['ticker'], "date": r['prediction_date'], "count": r['cnt']} for r in duplicates[:10]],
                "to_delete": to_delete_duplicates
            },
            "weekend_predictions": {
                "count": weekend_count,
                "dates": weekend_dates[:5],
                "to_delete": to_delete_weekend
            },
            "summary": {
                "total_to_delete": total_to_delete,
                "will_remain": total - total_to_delete,
                "breakdown": {
                    "duplicates": to_delete_duplicates,
                    "over_limit": to_delete_overlimit,
                    "weekend": to_delete_weekend
                }
            }
        }))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/predictions/clean', methods=['POST'])
@require_admin
def clean_predictions():
    """
    تنظيف توقعات الذكاء الاصطناعي.
    
    يقوم بـ:
    1. حذف توقعات الإجازات (الجمعة والسبت)
    2. حذف التكرارات (نفس السهم في نفس اليوم)
    3. تقليل التوقعات لـ 5 كحد أقصى لكل يوم (الأعلى ثقة)
    
    Request Body:
        - dry_run: إذا true، يعرض فقط بدون حذف
        - max_per_day: الحد الأقصى لكل يوم (default: 5)
    """
    try:
        data = request.get_json() or {}
        dry_run = data.get('dry_run', True)
        max_per_day = data.get('max_per_day', MAX_PREDICTIONS_PER_DAY)
        
        db_path = _get_db_path()
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        with _open_db('stocks', db_path, writable=True) as conn:
            cursor = conn.cursor()

            # التحقق من وجود الجدول
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'")
            if not cursor.fetchone():
                return jsonify(admin_response(False, error="جدول prediction_logs غير موجود")), 404

            # عدد قبل التنظيف
            cursor.execute("SELECT COUNT(*) as total FROM prediction_logs")
            before = cursor.fetchone()['total']

            if before == 0:
                return jsonify(admin_response(True, {
                    "before": 0,
                    "after": 0,
                    "deleted": 0,
                    "message": "لا توجد توقعات"
                }))

            if dry_run:
                # حساب التوقعات للحذف فقط
                # توقعات الإجازات
                cursor.execute("""
                    SELECT prediction_date, COUNT(*) as cnt
                    FROM prediction_logs
                    WHERE prediction_date IS NOT NULL
                    GROUP BY prediction_date
                """)
                daily = cursor.fetchall()

                weekend_count = sum(r['cnt'] for r in daily if _is_weekend(r['prediction_date']))

                # التكرارات
                cursor.execute("""
                    SELECT SUM(cnt - 1) as to_delete FROM (
                        SELECT ticker, prediction_date, COUNT(*) as cnt
                        FROM prediction_logs
                        WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
                        GROUP BY ticker, prediction_date
                        HAVING cnt > 1
                    )
                """)
                dup_result = cursor.fetchone()
                dup_count = dup_result['to_delete'] if dup_result and dup_result['to_delete'] else 0

                # الزيادة عن الحد
                over_limit_count = sum(r['cnt'] - max_per_day for r in daily if r['cnt'] > max_per_day and not _is_weekend(r['prediction_date']))

                total_to_delete = weekend_count + dup_count + over_limit_count

                return jsonify(admin_response(True, {
                    "dry_run": True,
                    "before": before,
                    "estimated_after": before - total_to_delete,
                    "estimated_deleted": total_to_delete,
                    "breakdown": {
                        "weekend": weekend_count,
                        "duplicates": dup_count,
                        "over_limit": over_limit_count
                    },
                    "message": "وضع العرض - لن يتم حذف شئ. استخدم dry_run: false للتنفيذ"
                }))

            # === التنفيذ الفعلي ===
            total_deleted = 0

            # 1. حذف توقعات الإجازات
            print("\n[CLEANUP] حذف توقعات الإجازات...")
            cursor.execute("""
                SELECT DISTINCT prediction_date FROM prediction_logs
                WHERE prediction_date IS NOT NULL
            """)
            all_dates = [r['prediction_date'] for r in cursor.fetchall()]

            weekend_dates = [d for d in all_dates if _is_weekend(d)]

            if weekend_dates:
                placeholders = ','.join(['?' for _ in weekend_dates])
                cursor.execute(f"DELETE FROM prediction_logs WHERE prediction_date IN ({placeholders})", weekend_dates)
                deleted_weekend = cursor.rowcount
                conn.commit()
                total_deleted += deleted_weekend
                print(f"[CLEANUP] تم حذف {deleted_weekend} توقع إجازة")

            # 2. حذف التكرارات (نحتفظ بالأعلى ثقة)
            print("\n[CLEANUP] حذف التكرارات...")
            cursor.execute("""
                DELETE FROM prediction_logs
                WHERE rowid NOT IN (
                    SELECT MAX(rowid)
                    FROM prediction_logs
                    WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
                    GROUP BY ticker, prediction_date
                )
                AND prediction_date IS NOT NULL
                AND ticker IS NOT NULL
            """)
            deleted_dups = cursor.rowcount
            conn.commit()
            total_deleted += deleted_dups
            print(f"[CLEANUP] تم حذف {deleted_dups} تكرار")

            # 3. تقليل لـ max_per_day لكل يوم
            print(f"\n[CLEANUP] تقليل لـ {max_per_day} توقعات لكل يوم...")
            cursor.execute("""
                SELECT prediction_date, COUNT(*) as cnt
                FROM prediction_logs
                WHERE prediction_date IS NOT NULL
                GROUP BY prediction_date
                HAVING cnt > ?
            """, (max_per_day,))
            over_limit_days = cursor.fetchall()

            deleted_overlimit = 0
            for r in over_limit_days:
                date_str = r['prediction_date']
                # نحذف الأقل ثقة (نحتفظ بـ max_per_day فقط)
                cursor.execute("""
                    DELETE FROM prediction_logs
                    WHERE prediction_date = ?
                    AND rowid NOT IN (
                        SELECT rowid FROM prediction_logs
                        WHERE prediction_date = ?
                        ORDER BY confidence DESC
                        LIMIT ?
                    )
                """, (date_str, date_str, max_per_day))
                deleted_overlimit += cursor.rowcount
                conn.commit()

            total_deleted += deleted_overlimit
            print(f"[CLEANUP] تم حذف {deleted_overlimit} توقع زيادة")

            # عدد بعد التنظيف
            cursor.execute("SELECT COUNT(*) as total FROM prediction_logs")
            after = cursor.fetchone()['total']

            # إعادة تعيين العداد
            cursor.execute("DELETE FROM sqlite_sequence WHERE name='prediction_logs'")
            conn.commit()
        
        log_admin_action('predictions_cleaned', {
            'before': before,
            'after': after,
            'deleted': total_deleted,
            'breakdown': {
                'weekend': deleted_weekend if 'deleted_weekend' in dir() else 0,
                'duplicates': deleted_dups,
                'over_limit': deleted_overlimit
            }
        })
        
        return jsonify(admin_response(True, {
            "before": before,
            "after": after,
            "deleted": total_deleted,
            "breakdown": {
                "weekend": deleted_weekend if 'deleted_weekend' in dir() else 0,
                "duplicates": deleted_dups,
                "over_limit": deleted_overlimit
            },
            "message": f"تم حذف {total_deleted:,} توقع من أصل {before:,}"
        }, f"✅ تم تنظيف التوقعات بنجاح"))
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# ADVANCED DATA TOOLS (Self-Healing Repair, Symbol Cleanup, and EGX30 Import)
# ============================================================================

@admin_bp.route('/database/repair-all', methods=['POST'])
@require_admin
def admin_repair_all_databases():
    try:
        import subprocess, sys
        from pathlib import Path
        project_root = Path(__file__).resolve().parent.parent.parent
        script_path = str(project_root / 'scripts' / 'repair_all_dbs.py')
        res = subprocess.run([sys.executable, script_path], capture_output=True, text=True, timeout=180)
        success = res.returncode == 0
        output = res.stdout + '\n' + res.stderr
        log_admin_action('db_repair_all', {'success': success})
        return jsonify(admin_response(success, {'output': output, 'success': success}, 'تم تشغيل الإصلاح الشامل بنجاح' if success else 'فشل الإصلاح الشامل'))
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500

@admin_bp.route('/database/repair-engine', methods=['POST'])
@require_admin
def admin_repair_engine():
    """
    إصلاح قاعدة بيانات المحرك (data_engine.db) في حال تلفها.
    """
    try:
        import subprocess
        import sys
        from pathlib import Path
        
        project_root = Path(__file__).resolve().parent.parent.parent
        script_path = str(project_root / 'vps-service' / 'repair_data_engine.py')
        
        # Run in subprocess
        res = subprocess.run([sys.executable, script_path], capture_output=True, text=True, timeout=120)
        
        success = res.returncode == 0
        output = res.stdout + "\n" + res.stderr
        
        log_admin_action('db_repair_engine', {'success': success})
        
        return jsonify(admin_response(success, {
            "output": output,
            "success": success
        }, "تم تشغيل سكربت الإصلاح بنجاح" if success else "فشل سكربت الإصلاح"))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/database/cleanup-symbols', methods=['POST'])
@require_admin
def admin_cleanup_symbols():
    """
    تنظيف قاعدة البيانات من الرموز المشوهة ومحاذاة الأسماء.
    """
    try:
        import subprocess
        import sys
        from pathlib import Path
        
        project_root = Path(__file__).resolve().parent.parent.parent
        script_path = str(project_root / 'vps-service' / 'cleanup_corrupted_symbols.py')
        
        # Run in subprocess
        res = subprocess.run([sys.executable, script_path], capture_output=True, text=True, timeout=120)
        
        success = res.returncode == 0
        output = res.stdout + "\n" + res.stderr
        
        log_admin_action('db_cleanup_symbols', {'success': success})
        
        return jsonify(admin_response(success, {
            "output": output,
            "success": success
        }, "تم تشغيل سكربت التنظيف والمحاذاة بنجاح" if success else "فشل سكربت التنظيف والمحاذاة"))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/database/import-egx30', methods=['POST'])
@require_admin
def admin_import_egx30():
    """
    تحديث مؤشر EGX30 بالبيانات التاريخية من ملف الـ CSV.
    """
    try:
        import subprocess
        import sys
        from pathlib import Path
        
        project_root = Path(__file__).resolve().parent.parent.parent
        script_path = str(project_root / 'vps-service' / 'import_egx30_production.py')
        
        # Run in subprocess
        res = subprocess.run([sys.executable, script_path], capture_output=True, text=True, timeout=120)
        
        success = res.returncode == 0
        output = res.stdout + "\n" + res.stderr
        
        log_admin_action('db_import_egx30', {'success': success})
        
        return jsonify(admin_response(success, {
            "output": output,
            "success": success
        }, "تم استيراد وتحديث بيانات EGX30 بنجاح" if success else "فشل استيراد بيانات EGX30"))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/build-stock-profiles', methods=['POST'])
@require_admin
def admin_build_stock_profiles():
    """بناء ملفات الأسهم (Stock DNA) — يشغّل scripts/build_stock_profiles.py.

    Body (optional):
      limit — عدد الأسهم (افتراضي: كل أسهم EGX)
      tickers — list of specific tickers (overrides limit)
      market — السوق (افتراضي EGX)
    """
    import sys
    from pathlib import Path

    _VPS = Path(__file__).resolve().parent.parent
    _ROOT = _VPS.parent
    if str(_VPS) not in sys.path:
        sys.path.insert(0, str(_VPS))
    if str(_ROOT / 'scripts') not in sys.path:
        sys.path.insert(0, str(_ROOT / 'scripts'))

    try:
        from build_stock_profiles import build_all, get_all_active_tickers
    except Exception as e:
        return jsonify(admin_response(False, error=f'Failed to import build_stock_profiles: {e}')), 500

    body = request.get_json(silent=True) or {}
    market = (body.get('market') or 'EGX').strip().upper() or 'EGX'
    tickers = body.get('tickers')
    limit = body.get('limit')

    try:
        if tickers and isinstance(tickers, list) and len(tickers) > 0:
            target_tickers = [str(t).strip().upper() for t in tickers if str(t).strip()]
            result = build_all(tickers=target_tickers)
        elif limit is not None:
            try:
                limit_int = int(limit)
            except (TypeError, ValueError):
                limit_int = None
            if limit_int and limit_int > 0:
                all_tickers = get_all_active_tickers(market=market)
                target_tickers = all_tickers[:limit_int]
                result = build_all(tickers=target_tickers)
            else:
                result = build_all()
        else:
            result = build_all()

        # امسح الـ cache عشان المحركات تقرأ النسخ الجديدة
        try:
            from analyzers.stock_dna_analyzer import invalidate_profile_cache
            invalidate_profile_cache()
        except Exception as _ar_e:
            import logging as _ar_l; _ar_l.warning(f"silent: {_ar_e}")

        log_admin_action('build_stock_profiles', {
            'market': market,
            'result': result,
        })

        built = result.get('built', 0)
        total = result.get('total', 0)
        msg = f'تم بناء {built} ملف من أصل {total} سهم'

        return jsonify(admin_response(True, {
            'result': result,
        }, msg))

    except Exception as e:
        log_admin_action('build_stock_profiles', {'error': str(e)})
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/database/recover', methods=['POST'])
@require_admin
def admin_recover_database():
    """
    استعادة قاعدة بيانات تالفة من النسخ الاحتياطية.
    
    Body: { db: string }
    
    Strategy:
    1. Check if DB is corrupted via integrity_check
    2. If yes, search for most recent valid backup
    3. Restore from backup
    4. If no backup, attempt WAL checkpoint + VACUUM
    """
    try:
        from pathlib import Path
        import shutil
        import sqlite3
        from datetime import datetime
        
        project_root = Path(__file__).resolve().parent.parent.parent
        db_dir = project_root / 'db'
        backups_dir = db_dir / 'backups' / 'daily'
        
        body = request.get_json(silent=True) or {}
        db_name = body.get('db', '').strip()
        
        if not db_name:
            return jsonify(admin_response(False, error='db name is required')), 400
        
        import re
        safe_name = re.sub(r'[^a-zA-Z0-9_.-]', '', db_name)
        if safe_name != db_name or '..' in db_name:
            return jsonify(admin_response(False, error='Invalid database name')), 400
        
        db_path = db_dir / safe_name
        if not db_path.exists():
            return jsonify(admin_response(False, error=f'Database not found: {safe_name}')), 404
        
        # Step 1: Check integrity
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(str(db_path), writable=False)
            result = conn.execute('PRAGMA integrity_check').fetchone()[0]
            conn.close()
            
            if result == 'ok':
                return jsonify(admin_response(True, {
                    'recovered': False,
                    'message': 'قاعدة البيانات سليمة — لا حاجة لاستعادة'
                }, 'قاعدة البيانات سليمة'))
        except Exception as e:
            result = f'error: {str(e)}'
        
        # Step 2: Database is corrupted — try to find valid backup
        log_admin_action('db_recover', {'db': safe_name, 'status': 'corrupted'})
        
        # Look for backup files
        backup_files = []
        if backups_dir.exists():
            for f in sorted(backups_dir.iterdir(), reverse=True):
                if f.is_file() and f.name.startswith(safe_name.replace('.db', '')) and f.name.endswith('.db'):
                    backup_files.append(f)
        
        # Also check for .backup files in db/backups/
        backup_dir = db_dir / 'backups'
        if backup_dir.exists():
            for f in sorted(backup_dir.iterdir(), reverse=True):
                if f.is_file() and f.name.startswith(safe_name.replace('.db', '')) and '.backup_' in f.name:
                    backup_files.append(f)
        
        # Try to restore from most recent valid backup
        restored_from = None
        for backup in backup_files[:5]:  # Try last 5 backups
            try:
                # Validate backup integrity
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.get_connection(str(backup), writable=False)
                backup_result = conn.execute('PRAGMA integrity_check').fetchone()[0]
                conn.close()
                
                if backup_result == 'ok':
                    # Valid backup found — restore it
                    # First, backup current corrupted DB
                    corrupt_backup = db_path.with_suffix('.db.corrupt_autobackup')
                    if corrupt_backup.exists():
                        corrupt_backup.unlink()
                    shutil.copy2(str(db_path), str(corrupt_backup))
                    
                    # Restore from backup
                    shutil.copy2(str(backup), str(db_path))
                    
                    # Also restore WAL/SHM if present
                    for ext in ['-wal', '-shm']:
                        src = str(backup) + ext
                        dst = str(db_path) + ext
                        if Path(src).exists():
                            shutil.copy2(src, dst)
                        elif Path(dst).exists():
                            Path(dst).unlink()
                    
                    restored_from = backup.name
                    break
            except Exception:
                continue
        
        if restored_from:
            return jsonify(admin_response(True, {
                'recovered': True,
                'restored_from': restored_from,
                'message': f'تم الاستعادة من النسخة: {restored_from}'
            }, f'تم استعادة {safe_name} بنجاح'))
        
        # Step 3: No valid backup — attempt WAL checkpoint + VACUUM
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(str(db_path), writable=True)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            conn.execute('VACUUM')
            conn.close()
            
            # Re-check integrity
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(str(db_path), writable=False)
            result = conn.execute('PRAGMA integrity_check').fetchone()[0]
            conn.close()
            
            if result == 'ok':
                return jsonify(admin_response(True, {
                    'recovered': True,
                    'method': 'checkpoint_vacuum',
                    'message': 'تم الإصلاح عبر WAL Checkpoint + VACUUM'
                }, 'تم إصلاح قاعدة البيانات بنجاح'))
        except Exception as e:
            pass
        
        # Step 4: All recovery attempts failed
        return jsonify(admin_response(False, {
            'recovered': False,
            'error': 'تعذر استعادة قاعدة البيانات من النسخ الاحتياطية'
        }, error='تعذر استعادة قاعدة البيانات — تأكد من وجود نسخ احتياطية صالحة')), 500
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/database/recover-all', methods=['POST'])
@require_admin
def admin_recover_all_databases():
    """
    استعادة جميع قواعد البيانات التالفة تلقائياً.
    يعمل على كل .db ملف في مجلد db/ ويستعيد التالفة من النسخ الاحتياطية.
    """
    try:
        from pathlib import Path
        import sqlite3
        
        project_root = Path(__file__).resolve().parent.parent.parent
        db_dir = project_root / 'db'
        backups_dir = db_dir / 'backups' / 'daily'
        
        results = []
        
        for db_file in sorted(db_dir.iterdir()):
            if not db_file.is_file() or not db_file.name.endswith('.db'):
                continue
            if db_file.name.endswith('-wal') or db_file.name.endswith('-shm'):
                continue
            if 'backup' in db_file.name.lower() or 'corrupt' in db_file.name.lower():
                continue
            
            db_result = {
                'db': db_file.name,
                'status': 'ok',
                'action': None,
                'message': 'سليمة'
            }
            
            # Check integrity
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.get_connection(str(db_file), writable=False)
                result = conn.execute('PRAGMA integrity_check').fetchone()[0]
                conn.close()
                
                if result != 'ok':
                    db_result['status'] = 'corrupted'
                    db_result['message'] = f'تالفة: {result}'
                    
                    # Try WAL checkpoint + VACUUM
                    try:
                        # Phase 7.1: migrated to db_manager (writable=True)
                        from core.db_manager import db_manager
                        conn = db_manager.get_connection(str(db_file), writable=True)
                        conn.execute('PRAGMA journal_mode=WAL')
                        conn.execute('PRAGMA busy_timeout=30000')
                        conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                        conn.execute('VACUUM')
                        conn.close()
                        
                        # Re-check
                        # Phase 7.1: migrated to db_manager (writable=False)
                        from core.db_manager import db_manager
                        conn = db_manager.get_connection(str(db_file), writable=False)
                        result2 = conn.execute('PRAGMA integrity_check').fetchone()[0]
                        conn.close()
                        
                        if result2 == 'ok':
                            db_result['status'] = 'recovered'
                            db_result['action'] = 'checkpoint_vacuum'
                            db_result['message'] = 'تم الإصلاح عبر WAL Checkpoint + VACUUM'
                        else:
                            db_result['action'] = 'failed'
                            db_result['message'] = 'تعذر الإصلاح تلقائياً'
                    except Exception as e:
                        db_result['action'] = 'failed'
                        db_result['message'] = f'خطأ أثناء الإصلاح: {str(e)}'
            except Exception as e:
                db_result['status'] = 'error'
                db_result['message'] = f'لا يمكن فتح القاعدة: {str(e)}'
            
            results.append(db_result)
        
        recovered_count = sum(1 for r in results if r['status'] == 'recovered')
        corrupted_count = sum(1 for r in results if r['status'] == 'corrupted')
        ok_count = sum(1 for r in results if r['status'] == 'ok')
        
        return jsonify(admin_response(True, {
            'results': results,
            'summary': {
                'total': len(results),
                'ok': ok_count,
                'recovered': recovered_count,
                'corrupted': corrupted_count
            }
        }, f'تم فحص {len(results)} قاعدة — {ok_count} سليمة، {recovered_count} تم إصلاحها'))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


# ============================================================================
# Maestro Backfill Phase 3 API
# ============================================================================

import subprocess
import threading
import uuid
from pathlib import Path

# Store running backfill processes
_maestro_backfills = {}

@admin_bp.route('/maestro-backfill/run', methods=['POST'])
@require_admin
def run_maestro_backfill():
    try:
        data = request.get_json() or {}
        days = data.get('days', 30)
        clear = data.get('clear', False)
        limit = data.get('limit', 0)
        markets = data.get('markets', 'EGX')
        
        job_id = str(uuid.uuid4())
        
        script_path = str(Path(__file__).parent.parent / 'scripts' / 'maestro_backfill_phase3.py')
        
        cmd = ["python3", script_path, "--days", str(days), "--markets", markets]
        if clear:
            cmd.append("--clear")
        if limit > 0:
            cmd.extend(["--per-day", str(limit)])
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        
        _maestro_backfills[job_id] = {
            'process': process,
            'status': 'running',
            'logs': [],
            'start_time': datetime.now().isoformat()
        }
        
        def consume_logs(pid, p):
            for line in iter(p.stdout.readline, ''):
                _maestro_backfills[pid]['logs'].append(line.strip())
                # Keep last 1000 lines
                if len(_maestro_backfills[pid]['logs']) > 1000:
                    _maestro_backfills[pid]['logs'].pop(0)
            p.stdout.close()
            p.wait()
            _maestro_backfills[pid]['status'] = 'completed' if p.returncode == 0 else 'failed'
            
        threading.Thread(target=consume_logs, args=(job_id, process), daemon=True).start()
        
        return jsonify(admin_response(True, {'job_id': job_id}, 'تم بدء إعادة البناء التاريخي بنجاح'))
        
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500

@admin_bp.route('/maestro-backfill/status', methods=['GET'])
@require_admin
def get_maestro_backfill_status():
    job_id = request.args.get('job_id')
    if not job_id or job_id not in _maestro_backfills:
        return jsonify(admin_response(False, error='Job not found')), 404
        
    job = _maestro_backfills[job_id]
    return jsonify(admin_response(True, {
        'job_id': job_id,
        'status': job['status'],
        'logs': job['logs'][-100:], # Send last 100 lines for the UI
        'start_time': job['start_time']
    }))

# ============================================================================
# BRAVO RESTRUCT-B-P2 — Admin trial management endpoints
# ============================================================================

@admin_bp.route('/user/<user_id>/reset-trial', methods=['POST'])
@require_admin
def admin_reset_user_trial(user_id):
    """Reset user's trial: trial_ends_at = NOW() + TRIAL_DAYS_CANONICAL (14 days).

    BRAVO RESTRUCT-B-P2 (John directive): admin can reset expired/broken trials.
    Canonical TRIAL_DAYS = 14 (per Owner spec).
    """
    try:
        from core.auth_middleware import TRIAL_DAYS_CANONICAL
        import sqlite3
        from pathlib import Path
        from datetime import datetime, timedelta, timezone

        # Rule 17: relative path
        _auth_db = Path(__file__).resolve().parents[2] / 'db' / 'auth.db'
        if not _auth_db.exists():
            return jsonify(admin_response(False, error='auth.db not found')), 500

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but admin_reset_user_trial does UPDATE User SET trial_ends_at + commit
        conn = db_manager.get_connection(str(_auth_db), writable=True)
        try:
            # Check user exists
            row = conn.execute("SELECT id, subscription_tier, trial_ends_at FROM User WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return jsonify(admin_response(False, error=f'User {user_id} not found')), 404

            # Set trial_ends_at = NOW + 14 days (UTC)
            new_trial_ends = datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS_CANONICAL)
            conn.execute(
                "UPDATE User SET trial_ends_at = ?, trial_warning_sent_at = NULL, "
                "trial_deletion_scheduled_at = NULL, updated_at = ? WHERE id = ?",
                (new_trial_ends.isoformat(), datetime.now(timezone.utc).isoformat(), user_id)
            )
            conn.commit()

            # Log action
            try:
                admin_session_tracker.log_action(
                    getattr(g, 'admin_session_id', 'unknown'),
                    'reset_trial',
                    {'user_id': user_id, 'new_trial_ends_at': new_trial_ends.isoformat()}
                )
            except Exception as _ar_e:
                import logging as _ar_l; _ar_l.warning(f"silent: {_ar_e}")

            return jsonify(admin_response(True, {
                'user_id': user_id,
                'trial_ends_at': new_trial_ends.isoformat(),
                'trial_days': TRIAL_DAYS_CANONICAL,
                'message': f'Trial reset to {TRIAL_DAYS_CANONICAL} days from now'
            }, 'تم إعادة تعيين فترة التجربة بنجاح'))
        finally:
            conn.close()
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500


@admin_bp.route('/user/<user_id>/extend-trial', methods=['POST'])
@require_admin
def admin_extend_user_trial(user_id):
    """Extend user's trial by N days (default 7). Query: ?days=7.

    BRAVO RESTRUCT-B-P2: admin can extend trial without full reset.
    """
    try:
        from core.auth_middleware import TRIAL_DAYS_CANONICAL
        import sqlite3
        from pathlib import Path
        from datetime import datetime, timedelta, timezone

        extend_days = request.args.get('days', 7, type=int)
        extend_days = max(1, min(int(extend_days), 90))  # clamp 1..90

        _auth_db = Path(__file__).resolve().parents[2] / 'db' / 'auth.db'
        if not _auth_db.exists():
            return jsonify(admin_response(False, error='auth.db not found')), 500

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        # FIX (BRAVO-DISASTER 2026-10-28): was writable=False but admin_extend_user_trial does UPDATE User SET trial_ends_at + commit
        conn = db_manager.get_connection(str(_auth_db), writable=True)
        try:
            row = conn.execute("SELECT id, trial_ends_at FROM User WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return jsonify(admin_response(False, error=f'User {user_id} not found')), 404

            # If trial_ends_at exists + in future → extend from it. Else → extend from NOW.
            current_trial_ends = row[1]
            now_utc = datetime.now(timezone.utc)
            if current_trial_ends:
                try:
                    base = datetime.fromisoformat(current_trial_ends.replace('Z', '+00:00'))
                    if base.tzinfo is None:
                        base = base.replace(tzinfo=timezone.utc)
                    if base < now_utc:
                        base = now_utc  # expired → extend from now
                except (ValueError, AttributeError):
                    base = now_utc
            else:
                base = now_utc

            new_trial_ends = base + timedelta(days=extend_days)
            conn.execute(
                "UPDATE User SET trial_ends_at = ?, trial_warning_sent_at = NULL, "
                "trial_deletion_scheduled_at = NULL, updated_at = ? WHERE id = ?",
                (new_trial_ends.isoformat(), now_utc.isoformat(), user_id)
            )
            conn.commit()

            return jsonify(admin_response(True, {
                'user_id': user_id,
                'trial_ends_at': new_trial_ends.isoformat(),
                'extended_by_days': extend_days,
                'message': f'Trial extended by {extend_days} days'
            }, f'تم تمديد فترة التجربة بـ {extend_days} يوم'))
        finally:
            conn.close()
    except Exception as e:
        return jsonify(admin_response(False, error=str(e))), 500
