#!/usr/bin/env python3
"""
🔥 Data Engine - Arabic Stocks Data Factory
============================================
Mini-service يعمل 24/7 لجمع البيانات المالية
"""

import os
import sys
import json
import asyncio
import threading
from pathlib import Path
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

# Apply SQLite WAL and timeout patches globally to prevent DB locks
import sqlite3
_original_connect = sqlite3.connect
def _patched_connect(*args, **kwargs):
    if len(args) > 1:
        args = list(args)
        args[1] = max(args[1], 30.0)
        args = tuple(args)
    else:
        if 'timeout' not in kwargs:
            kwargs['timeout'] = 30.0
        else:
            kwargs['timeout'] = max(kwargs['timeout'], 30.0)
            
    conn = _original_connect(*args, **kwargs)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
        conn.execute('PRAGMA foreign_keys=ON')  # P14-PHASE-B (DATA-02): enforce FK constraints
    except Exception:
        pass
    return conn
sqlite3.connect = _patched_connect


# Add scrapers to path
sys.path.insert(0, str(Path(__file__).parent / 'scrapers'))
sys.path.insert(0, str(Path(__file__).parent / 'config'))

# Import market hours configuration
try:
    from market_hours import is_market_open as check_market_open, get_market_status, get_all_markets_status, should_fetch_data, MARKET_HOURS_LOCAL
    HAS_MARKET_HOURS = True
except ImportError:
    HAS_MARKET_HOURS = False
    print("⚠️ Warning: market_hours module not found, using built-in config")

# Directories - all data unified in /db folder
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR.parent / 'db'  # All data files in /db folder
SCRAPERS_DIR = BASE_DIR / 'scrapers'

# Database paths - unified in /db folder
DATA_ENGINE_DB = str(DATA_DIR / 'data_engine.db')
STOCKS_DB = str(DATA_DIR / 'stocks.db')
NEWS_DB = str(DATA_DIR / 'news.db')

# Status file - in /db folder
STATUS_FILE = DATA_DIR / 'engine_status.json'

# Flask app
app = Flask(__name__)
CORS(app)

# Global state
engine_state = {
    'running': False,
    'scheduler_active': False,
    'stocks_running': True,
    'crypto_running': True,
    'metals_running': True,
    'forex_running': True,
    'news_running': True,
    'last_stocks_update': None,
    'last_crypto_update': None,
    'last_metals_update': None,
    'last_forex_update': None,
    'last_news_update': None,
    'last_sync': None,
    'stocks_count': 0,
    'news_count': 0,
    'logs': [],
    'errors': [],
    'active_jobs': []
}

_last_status_save = 0.0

def log_message(msg: str, level: str = 'info'):
    """Log a message - save_status مش بتتنفذ هنا تاني عشان مفيش I/O زيادة"""
    global _last_status_save
    timestamp = datetime.now().strftime('%H:%M:%S')
    log_entry = f"[{timestamp}] [{level.upper()}] {msg}"
    print(log_entry)
    engine_state['logs'].append(log_entry)
    if len(engine_state['logs']) > 100:
        engine_state['logs'] = engine_state['logs'][-100:]

def save_status():
    """Save engine status to file"""
    # Ensure data directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    status = {
        'running': engine_state['running'],
        'scheduler_active': engine_state['scheduler_active'],
        'stocks_running': engine_state.get('stocks_running', True),
        'crypto_running': engine_state.get('crypto_running', True),
        'metals_running': engine_state.get('metals_running', True),
        'forex_running': engine_state.get('forex_running', True),
        'news_running': engine_state.get('news_running', True),
        'last_stocks_update': engine_state['last_stocks_update'],
        'last_crypto_update': engine_state['last_crypto_update'],
        'last_metals_update': engine_state['last_metals_update'],
        'last_forex_update': engine_state.get('last_forex_update'),
        'last_news_update': engine_state.get('last_news_update'),
        'last_sync': engine_state['last_sync'],
        'stocks_count': engine_state['stocks_count'],
        'news_count': engine_state.get('news_count', 0),
        'logs': engine_state['logs'][-20:],
        'errors': engine_state['errors'][-10:],
        'active_jobs': engine_state.get('active_jobs', []),
        'timestamp': datetime.now().isoformat()
    }
    with open(STATUS_FILE, 'w', encoding='utf-8') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def _safe_connect(db_path: str) -> sqlite3.Connection:
    """اتصال آمن بـ SQLite مع WAL + timeout - يمنع database locked"""
    conn = sqlite3.connect(db_path, timeout=30.0)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
        conn.execute('PRAGMA synchronous=NORMAL')
    except Exception:
        pass
    return conn

def get_db_stats():
    """Get database statistics"""
    stats = {'data_engine': {}, 'stocks_db': {}}
    
    try:
        conn = _safe_connect(DATA_ENGINE_DB)
        cursor = conn.cursor()
        
        # Stocks count
        cursor.execute('SELECT COUNT(*) FROM stocks')
        stats['data_engine']['stocks'] = cursor.fetchone()[0]
        
        # Tab tables
        for table in ['tab_technical_analysis', 'tab_profitability', 'tab_valuation', 
                       'tab_dividends', 'tab_performance', 'tab_balance_sheet',
                       'tab_income_statement', 'tab_cash_flow']:
            try:
                cursor.execute(f'SELECT COUNT(*) FROM {table}')
                stats['data_engine'][table] = cursor.fetchone()[0]
            except:
                pass
        
        # Crypto
        try:
            cursor.execute('SELECT COUNT(*) FROM crypto_prices')
            stats['data_engine']['crypto'] = cursor.fetchone()[0]
        except:
            pass
        
        # Gold
        try:
            cursor.execute('SELECT COUNT(*) FROM gold_prices')
            stats['data_engine']['gold'] = cursor.fetchone()[0]
        except:
            pass
        
        conn.close()
    except Exception as e:
        stats['data_engine']['error'] = str(e)
    
    try:
        conn = _safe_connect(STOCKS_DB)
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM stocks')
        stats['stocks_db']['stocks'] = cursor.fetchone()[0]
        conn.close()
    except Exception as e:
        stats['stocks_db']['error'] = str(e)
    
    return stats

# ============================================================================
# SCHEDULER HELPER FUNCTIONS - Must be defined before endpoints
# ============================================================================

SYNC_SCRIPT = BASE_DIR / 'sync.py'
HISTORICAL_SCRIPT = SCRAPERS_DIR / 'historical_fetcher.py'

# Step 4.3: real-time webhook notifier (best-effort, non-blocking)
try:
    from realtime_sync import post_scrape_hook
except Exception:  # pragma: no cover - realtime_sync optional
    post_scrape_hook = None


def run_scraper_and_sync(scraper_name: str, script_path: Path, timeout: int = 600):
    """Run a scraper then sync data to all databases.

    FALLBACK-CHAIN (يوليو 2026): لو الـ scraper هو 'stocks'، نشغّل fallback_chain
    بدلاً من السكريبت المباشر. ده بيضمن إن لو TradingView وقع، الكود يروح لـ
    EGXPilot ثم Yahoo Finance بدون ما الـ sync يقف.
    """
    engine_state['active_jobs'].append(scraper_name)
    log_message(f'🚀 Running {scraper_name} scraper...')

    # ═══════════════════════════════════════════════════════════════════
    # FALLBACK-CHAIN (يوليو 2026): للـ stocks فقط، استخدم fallback_chain
    # ---------------------------------------------------------------------
    # بدل ما نشغّل tradingview_scraper.py مباشرة، نستدعي fallback_chain.py
    # اللي بيجرب TV → EGXPilot → Yahoo. لو كلهم فشلوا، يبعت إنذار تليجرام.
    # هذا يمنع "البيانات الميتة" اللي كانت سبب التوقعات الثابتة.
    # ═══════════════════════════════════════════════════════════════════
    if scraper_name == 'stocks':
        try:
            return _run_stocks_with_fallback_chain(timeout=timeout)
        except Exception as e:
            log_message(f'❌ stocks fallback chain error: {str(e)[:80]}', 'error')
            engine_state['errors'].append(f"[{datetime.now().isoformat()}] stocks: {str(e)[:100]}")
            return
        finally:
            if scraper_name in engine_state['active_jobs']:
                engine_state['active_jobs'].remove(scraper_name)
            save_status()

    # للـ scrapers التانية (crypto/metals/news) — السلوك القديم
    try:
        import subprocess

        # Run scraper
        result = subprocess.run(
            ['python3', str(script_path)],
            capture_output=True,
            text=True,
            cwd=str(SCRAPERS_DIR) if scraper_name != 'sync' else str(BASE_DIR),
            timeout=timeout
        )

        if result.returncode == 0:
            log_message(f'✅ {scraper_name} scraper completed')

            # Update timestamp
            key = f'last_{scraper_name}_update'
            if key in engine_state:
                engine_state[key] = datetime.now().isoformat()

            # AUTO SYNC after each scraper
            if scraper_name in ['stocks', 'crypto', 'metals']:
                log_message(f'🔄 Auto-syncing {scraper_name} data...')
                sync_result = run_full_sync()
                synced_count = sync_result.get("stocks_synced", 0)
                prices_count = sync_result.get("prices_saved", 0)
                if scraper_name == 'stocks' and synced_count == 0 and prices_count == 0:
                    log_message('🚨 FATAL WARNING: stocks_synced is 0! Data engine scraper returned empty data.', 'error')
                else:
                    log_message(f'✅ Sync: {synced_count} stocks, {prices_count} prices')
                # Step 4.3: notify Next.js to reload cache (best-effort)
                try:
                    if post_scrape_hook:
                        wh = post_scrape_hook(scraper_name, sync_result)
                        if wh.get("success"):
                            log_message(f'📢 Next.js notified: {scraper_name} synced')
                except Exception:
                    pass  # webhook failure must not break sync
        else:
            log_message(f'⚠️ {scraper_name} warning: {result.stderr[:100]}', 'warning')

    except Exception as e:
        log_message(f'❌ {scraper_name} error: {str(e)[:80]}', 'error')
        engine_state['errors'].append(f"[{datetime.now().isoformat()}] {scraper_name}: {str(e)[:100]}")
    finally:
        if scraper_name in engine_state['active_jobs']:
            engine_state['active_jobs'].remove(scraper_name)
        save_status()


def _run_stocks_with_fallback_chain(timeout: int = 600):
    """
    شغّل fallback_chain.py للـ stocks (TV → EGXPilot → Yahoo).
    - لو المصدر نجح → sync لـ stocks.db.
    - لو كل المصادر فشلت → STOP SYNC (للحفاظ على الأسعار القديمة) + إنذار تليجرام.
    """
    import subprocess
    fallback_script = SCRAPERS_DIR / 'fallback_chain.py'

    if not fallback_script.exists():
        log_message(f'❌ fallback_chain.py غير موجود في {SCRAPERS_DIR}', 'error')
        return

    log_message('🛡️ Starting Fallback Chain: TradingView → EGXPilot → Yahoo...')

    try:
        result = subprocess.run(
            ['python3', str(fallback_script)],
            capture_output=True,
            text=True,
            cwd=str(SCRAPERS_DIR),
            timeout=timeout
        )

        # تحليل الـ output
        output = result.stdout or ''
        success = False
        source_used = 'none'
        stocks_count = 0
        telegram_alert = False

        # الـ fallback_chain بيطبع JSON summary في آخر 100 سطر
        try:
            # نأخذ آخر JSON object من الـ output
            lines = output.strip().split('\n')
            json_start = -1
            for i in range(len(lines) - 1, -1, -1):
                if lines[i].strip() == '{':
                    json_start = i
                    break
            if json_start >= 0:
                json_text = '\n'.join(lines[json_start:])
                summary = json.loads(json_text)
                success = summary.get('success', False)
                source_used = summary.get('source', 'none')
                stocks_count = summary.get('stocks_count', 0)
                telegram_alert = summary.get('telegram_alert_sent', False)
        except Exception as parse_err:
            log_message(f'⚠️ فشل parse summary JSON: {parse_err}', 'warning')

        if success and stocks_count > 0:
            log_message(f'✅ Fallback Chain نجح! المصدر: {source_used} | الأسهم: {stocks_count}')
            engine_state['last_stocks_update'] = datetime.now().isoformat()

            # SYNC للـ stocks.db (الآن فيه بيانات طازجة)
            log_message('🔄 Auto-syncing stocks data...')
            sync_result = run_full_sync()
            synced_count = sync_result.get("stocks_synced", 0)
            prices_count = sync_result.get("prices_saved", 0)
            log_message(f'✅ Sync: {synced_count} stocks, {prices_count} prices')

            # Notify Next.js
            try:
                if post_scrape_hook:
                    wh = post_scrape_hook('stocks', sync_result)
                    if wh.get("success"):
                        log_message('📢 Next.js notified: stocks synced')
            except Exception:
                pass

        else:
            # كل المصادر فشلت — STOP SYNC + الإنذار التليجرام اتبعت بالفعل من fallback_chain
            log_message('🚨 FATAL: كل مصادر الأسعار فشلت! الـ Sync متوقف للحفاظ على الأسعار القديمة.', 'error')
            log_message(f'🚨 Telegram alert sent: {telegram_alert}', 'error' if telegram_alert else 'warning')
            engine_state['errors'].append(
                f"[{datetime.now().isoformat()}] stocks: ALL SOURCES FAILED (TV+EGXPilot+Yahoo). Sync stopped."
            )

    except subprocess.TimeoutExpired:
        log_message(f'❌ Fallback Chain timeout after {timeout}s', 'error')
        engine_state['errors'].append(
            f"[{datetime.now().isoformat()}] stocks: fallback chain timeout"
        )
    except Exception as e:
        log_message(f'❌ Fallback Chain error: {str(e)[:80]}', 'error')
        engine_state['errors'].append(
            f"[{datetime.now().isoformat()}] stocks: {str(e)[:100]}"
        )

def run_full_sync():
    """Run full sync using sync.py"""
    try:
        import subprocess
        result = subprocess.run(
            ['python3', str(SYNC_SCRIPT)],
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR),
            timeout=120
        )
        
        if result.returncode == 0:
            engine_state['last_sync'] = datetime.now().isoformat()
            # Parse output for stats
            output = result.stdout
            stocks_synced = 0
            prices_saved = 0
            for line in output.split('\n'):
                if 'Synced:' in line:
                    try:
                        stocks_synced = int(line.split('Synced:')[1].split()[0])
                    except:
                        pass
                if 'Daily candles upserted:' in line or 'Daily prices saved:' in line:
                    try:
                        if 'upserted:' in line:
                            prices_saved = int(line.split('upserted:')[1].split()[0])
                        else:
                            prices_saved = int(line.split('saved:')[1].split()[0])
                    except:
                        pass
            return {'stocks_synced': stocks_synced, 'prices_saved': prices_saved}
        return {}
    except Exception as e:
        log_message(f'❌ Sync error: {str(e)[:80]}', 'error')
        return {}

def run_historical_fetch(period: str = '1mo'):
    """Run historical data fetcher"""
    engine_state['active_jobs'].append('historical')
    log_message(f'📜 Fetching {period} historical data...')
    
    try:
        import subprocess
        result = subprocess.run(
            ['python3', str(HISTORICAL_SCRIPT), period],
            capture_output=True,
            text=True,
            cwd=str(SCRAPERS_DIR),
            timeout=3600  # 1 hour max
        )
        
        if result.returncode == 0:
            log_message('✅ Historical data fetch completed')
        else:
            log_message(f'⚠️ Historical fetch warning: {result.stderr[:100]}', 'warning')
            
    except Exception as e:
        log_message(f'❌ Historical fetch error: {str(e)[:80]}', 'error')
    finally:
        if 'historical' in engine_state['active_jobs']:
            engine_state['active_jobs'].remove('historical')
        save_status()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.route('/')
def index():
    """Root endpoint"""
    return jsonify({
        'name': '🔥 Data Engine - Arabic Stocks Data Factory',
        'version': '2.1.0',
        'status': 'running',
        'features': [
            '✅ سحب الأسهم فقط خلال أوقات العمل',
            '✅ دعم البورصات العربية (EGX, TADAWUL, KSE, QSE)',
            '✅ سحب الكريبتو والمعادن 24/7'
        ],
        'endpoints': {
            '/status': 'GET - حالة المحرك',
            '/stats': 'GET - إحصائيات قاعدة البيانات',
            '/market-status': 'GET - حالة الأسواق الحالية',
            '/logs': 'GET - آخر السجلات',
            '/trigger/stocks': 'POST - تشغيل سحب الأسهم',
            '/trigger/crypto': 'POST - تشغيل سحب الكريبتو',
            '/trigger/metals': 'POST - تشغيل سحب المعادن',
            '/trigger/sync': 'POST - مزامنة قواعد البيانات',
            '/health': 'GET - فحص الخادم'
        },
        'market_hours': {
            'EGX': '10:00 - 14:30 (القاهرة)',
            'TADAWUL': '10:00 - 15:00 (الرياض)',
            'KSE': '09:00 - 13:15 (الكويت)',
            'QSE': '09:30 - 13:15 (الدوحة)'
        },
        'work_days': 'الأحد - الخميس'
    })

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/status')
def status():
    """Get engine status"""
    return jsonify({
        'success': True,
        'engine': engine_state,
        'db_stats': get_db_stats()
    })

@app.route('/stats')
def stats():
    """Get database statistics"""
    return jsonify({
        'success': True,
        'stats': get_db_stats(),
        'timestamp': datetime.now().isoformat()
    })

@app.route('/logs')
def logs():
    """Get recent logs"""
    return jsonify({
        'success': True,
        'logs': engine_state['logs'][-50:],
        'errors': engine_state['errors'][-20:]
    })

@app.route('/market-status')
def market_status():
    """Get current market status for all markets"""
    if HAS_MARKET_HOURS:
        try:
            statuses = get_all_markets_status()
            any_open = any(s['is_open'] for s in statuses)
            
            return jsonify({
                'success': True,
                'any_market_open': any_open,
                'message': get_market_status_message(),
                'markets': statuses,
                'timestamp': datetime.now().isoformat()
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
    
    # Fallback logic
    from datetime import datetime
    import pytz
    
    MARKET_HOURS = {
        'EGX': {'name': 'البورصة المصرية', 'timezone': 'Africa/Cairo', 'open': (10, 0), 'close': (14, 30), 'days': [6, 0, 1, 2, 3]},
        'TADAWUL': {'name': 'تداول السعودية', 'timezone': 'Asia/Riyadh', 'open': (10, 0), 'close': (15, 0), 'days': [6, 0, 1, 2, 3]},
        'KSE': {'name': 'بورصة الكويت', 'timezone': 'Asia/Kuwait', 'open': (9, 0), 'close': (13, 15), 'days': [6, 0, 1, 2, 3]},
        'QSE': {'name': 'بورصة قطر', 'timezone': 'Asia/Qatar', 'open': (9, 30), 'close': (13, 15), 'days': [6, 0, 1, 2, 3]},
    }
    
    markets = []
    
    for market_code, config in MARKET_HOURS.items():
        try:
            tz = pytz.timezone(config['timezone'])
            now = datetime.now(tz)
            
            is_workday = now.weekday() in config['days']
            current_time = now.hour * 60 + now.minute
            open_time = config['open'][0] * 60 + config['open'][1]
            close_time = config['close'][0] * 60 + config['close'][1]
            
            is_open = is_workday and open_time <= current_time <= close_time
            
            if is_workday:
                if current_time < open_time:
                    minutes_to = open_time - current_time
                    status_text = f"يفتح خلال {minutes_to} دقيقة"
                elif current_time > close_time:
                    status_text = "مغلق - انتهت الجلسة"
                else:
                    minutes_to = close_time - current_time
                    status_text = f"مفتوح - يغلق خلال {minutes_to} دقيقة"
            else:
                status_text = "مغلق - يوم عطلة"
            
            markets.append({
                'code': market_code,
                'name': config['name'],
                'is_open': is_open,
                'status': '🟢 مفتوح' if is_open else '🔴 مغلق',
                'status_text': status_text,
                'local_time': now.strftime('%H:%M:%S'),
                'trading_hours': f"{config['open'][0]:02d}:{config['open'][1]:02d} - {config['close'][0]:02d}:{config['close'][1]:02d}"
            })
        except Exception as e:
            markets.append({
                'code': market_code,
                'name': config.get('name', market_code),
                'error': str(e)
            })
    
    any_open = any(m.get('is_open', False) for m in markets)
    
    return jsonify({
        'success': True,
        'any_market_open': any_open,
        'message': get_market_status_message(),
        'markets': markets,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/trigger/stocks', methods=['POST'])
def trigger_stocks():
    """Run stocks scraper with auto-sync"""
    try:
        thread = threading.Thread(
            target=run_scraper_and_sync,
            args=('stocks', SCRAPERS_DIR / 'tradingview_scraper.py', 600)
        )
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Stocks scraper started (with auto-sync)',
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        log_message(f'❌ Failed to start stocks scraper: {str(e)}', 'error')
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/trigger/crypto', methods=['POST'])
def trigger_crypto():
    """Run crypto fetcher with auto-sync"""
    try:
        thread = threading.Thread(
            target=run_scraper_and_sync,
            args=('crypto', SCRAPERS_DIR / 'crypto_fetcher.py', 300)
        )
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Crypto fetcher started (with auto-sync)'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/trigger/metals', methods=['POST'])
def trigger_metals():
    """Run metals/forex fetcher with auto-sync"""
    try:
        thread = threading.Thread(
            target=run_scraper_and_sync,
            args=('metals', SCRAPERS_DIR / 'metals_forex_fetcher.py', 300)
        )
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Metals/forex fetcher started (with auto-sync)'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/trigger/news', methods=['POST'])
def trigger_news():
    """Run news scraper"""
    try:
        thread = threading.Thread(
            target=run_scraper_and_sync,
            args=('news', SCRAPERS_DIR / 'news_scraper.py', 600)
        )
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'News scraper started'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/trigger/sync', methods=['POST'])
def trigger_sync():
    """Manual sync - sync all data to stocks.db and historical.db"""
    try:
        log_message('🔄 Manual sync triggered...')
        
        def do_sync():
            sync_result = run_full_sync()
            log_message(f'✅ Manual sync complete: {sync_result}')
        
        thread = threading.Thread(target=do_sync)
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Sync started',
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        log_message(f'❌ Sync error: {str(e)}', 'error')
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# CONTROL ENDPOINTS - تحكم كامل
# ============================================================================

@app.route('/control/start', methods=['POST'])
def control_start():
    """تشغيل المحرك والـ scheduler"""
    global scheduler_thread
    
    engine_state['running'] = True
    engine_state['scheduler_active'] = True
    save_status()
    log_message('🟢 Engine STARTED')
    
    # Start scheduler if not running
    if scheduler_thread is None or not scheduler_thread.is_alive():
        scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
        scheduler_thread.start()
        log_message('📅 Scheduler thread started')
    
    return jsonify({
        'success': True,
        'message': 'Engine started',
        'engine': engine_state
    })

@app.route('/control/stop', methods=['POST'])
def control_stop():
    """إيقاف المحرك"""
    engine_state['running'] = False
    engine_state['scheduler_active'] = False
    save_status()
    log_message('🔴 Engine STOPPED')
    return jsonify({
        'success': True,
        'message': 'Engine stopped',
        'engine': engine_state
    })

@app.route('/control/toggle/<scraper>', methods=['POST'])
def control_toggle(scraper):
    """تفعيل/إيقاف scraper معين"""
    key = f'{scraper}_running'
    if key in engine_state:
        engine_state[key] = not engine_state.get(key, True)
        save_status()
        status = 'enabled' if engine_state[key] else 'disabled'
        log_message(f'⚙️ {scraper.upper()} {status}')
        return jsonify({
            'success': True,
            'scraper': scraper,
            'running': engine_state[key]
        })
    return jsonify({'success': False, 'error': f'Unknown scraper: {scraper}'}), 400

@app.route('/control/clear-logs', methods=['POST'])
def control_clear_logs():
    """مسح السجلات"""
    engine_state['logs'] = []
    engine_state['errors'] = []
    save_status()
    return jsonify({'success': True, 'message': 'Logs cleared'})

@app.route('/trigger/all', methods=['POST'])
def trigger_all():
    """تشغيل كل السحابات"""
    log_message('🚀 Running ALL scrapers...')
    
    results = []
    
    # Run stocks
    if engine_state.get('stocks_running', True):
        try:
            trigger_stocks()
            results.append({'scraper': 'stocks', 'status': 'started'})
        except Exception as e:
            results.append({'scraper': 'stocks', 'status': 'error', 'error': str(e)})
    
    # Run crypto
    if engine_state.get('crypto_running', True):
        try:
            trigger_crypto()
            results.append({'scraper': 'crypto', 'status': 'started'})
        except Exception as e:
            results.append({'scraper': 'crypto', 'status': 'error', 'error': str(e)})
    
    # Run metals
    if engine_state.get('metals_running', True):
        try:
            trigger_metals()
            results.append({'scraper': 'metals', 'status': 'started'})
        except Exception as e:
            results.append({'scraper': 'metals', 'status': 'error', 'error': str(e)})
    
    return jsonify({
        'success': True,
        'message': 'All scrapers triggered',
        'results': results
    })

@app.route('/trigger/historical', methods=['POST'])
def trigger_historical():
    """تشغيل السحب التاريخي من Yahoo Finance"""
    try:
        # Get period from request or default to 5y
        period = request.json.get('period', '5y') if request.json else '5y'
        
        thread = threading.Thread(target=run_historical_fetch, args=(period,))
        thread.start()
        
        return jsonify({
            'success': True,
            'message': f'Historical data fetch started (period: {period})'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# SYNC FUNCTION
# ============================================================================

def sync_databases():
    """Sync data from data_engine.db to stocks.db"""
    result = {
        'synced': 0,
        'updated': 0,
        'errors': 0,
        'details': []
    }
    
    try:
        # Connect to both databases
        src_conn = _safe_connect(DATA_ENGINE_DB)
        src_conn.row_factory = sqlite3.Row
        src_cursor = src_conn.cursor()
        
        dst_conn = _safe_connect(STOCKS_DB)
        dst_cursor = dst_conn.cursor()
        
        # First, check what columns exist in stocks table
        dst_cursor.execute("PRAGMA table_info(stocks)")
        columns_info = dst_cursor.fetchall()
        existing_columns = {col[1] for col in columns_info}
        
        # Get all stocks from source (simple query without joins)
        src_cursor.execute('''
            SELECT symbol, name, price, change_percent, volume, 
                   market_cap, market, sector, logo_url
            FROM stocks
        ''')
        
        stocks = src_cursor.fetchall()
        
        for stock in stocks:
            try:
                # Check if stock exists
                dst_cursor.execute('SELECT id FROM stocks WHERE ticker = ?', (stock['symbol'],))
                existing = dst_cursor.fetchone()
                
                # Convert market name to code
                market_map = {
                    'مصر': 'EGX',
                    'السعودية': 'TADAWUL',
                    'الكويت': 'KSE',
                    'قطر': 'QSE'
                }
                market_code = market_map.get(stock['market'], stock['market'])
                
                # Parse volume safely
                volume = 0
                if stock['volume']:
                    try:
                        vol_str = str(stock['volume']).replace(',', '').replace(' ', '').replace('\u202f', '')
                        if 'K' in vol_str.upper():
                            volume = int(float(vol_str.upper().replace('K', '')) * 1000)
                        elif 'M' in vol_str.upper():
                            volume = int(float(vol_str.upper().replace('M', '')) * 1000000)
                        elif 'B' in vol_str.upper():
                            volume = int(float(vol_str.upper().replace('B', '')) * 1000000000)
                        else:
                            volume = int(float(vol_str))
                    except:
                        volume = 0
                
                if existing:
                    # Update existing stock - only update columns that exist
                    if 'current_price' in existing_columns:
                        dst_cursor.execute('''
                            UPDATE stocks SET
                                name = ?,
                                current_price = ?,
                                volume = ?,
                                market = ?,
                                sector = ?,
                                last_update = ?
                            WHERE ticker = ?
                        ''', (
                            stock['name'],
                            stock['price'],
                            volume,
                            market_code,
                            stock['sector'],
                            datetime.now().isoformat(),
                            stock['symbol']
                        ))
                    result['updated'] += 1
                else:
                    # Quarantine Guard: Never insert deformed scraper symbols (e.g. ending in D, len > 8, ISIN, or concatenated)
                    sym = stock['symbol']
                    # SCRAPER-VALIDATION-FIX (2026-10-22): use centralized validator
                    # بدل الـ quarantine المبسط، نستخدم validate_ticker() المركزي.
                    try:
                        from scrapers.ticker_validator import validate_ticker
                    except ImportError:
                        try:
                            from data_engine.scrapers.ticker_validator import validate_ticker
                        except ImportError:
                            validate_ticker = None

                    if validate_ticker:
                        is_valid, reason = validate_ticker(sym, stock.get('name', ''))
                        if not is_valid:
                            if len(result['details']) < 10:
                                result['details'].append(f"Quarantined invalid ticker: {sym} — {reason}")
                            continue
                    else:
                        # Fallback: legacy quarantine logic
                        if len(sym) > 8 or sym.endswith('D') or 'EGS' in sym or not sym.isalnum():
                            if len(result['details']) < 10:
                                result['details'].append(f"Quarantined suspect symbol: {sym}")
                            continue

                    # Insert new stock
                    dst_cursor.execute('''
                        INSERT INTO stocks (
                            ticker, name, current_price, volume, market, sector, last_update, is_active
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    ''', (
                        stock['symbol'],
                        stock['name'],
                        stock['price'],
                        volume,
                        market_code,
                        stock['sector'],
                        datetime.now().isoformat()
                    ))
                    result['synced'] += 1
                    
            except Exception as e:
                result['errors'] += 1
                if len(result['details']) < 10:  # Only keep first 10 errors
                    result['details'].append(f"Error syncing {stock['symbol']}: {str(e)}")
        
        dst_conn.commit()
        src_conn.close()
        dst_conn.close()
        
        log_message(f"✅ Sync complete: {result['synced']} new, {result['updated']} updated, {result['errors']} errors")
        
    except Exception as e:
        result['errors'] += 1
        result['details'].append(f"Sync error: {str(e)}")
        log_message(f"❌ Sync error: {str(e)}", 'error')
    
    return result

# ============================================================================
# MARKET HOURS CONFIGURATION
# ============================================================================

def is_market_open(market_code: str = None) -> bool:
    """
    Check if any market (or specific market) is currently open.
    Uses the market_hours module if available, otherwise uses built-in config.
    """
    if HAS_MARKET_HOURS:
        try:
            if market_code:
                # Map English codes to Arabic names
                code_map = {
                    'EGX': 'مصر',
                    'TADAWUL': 'السعودية',
                    'KSA': 'السعودية',
                    'KSE': 'الكويت',
                    'QSE': 'قطر',
                }
                market_name = code_map.get(market_code.upper(), market_code)
                is_open, _ = check_market_open(market_name)
                return is_open
            else:
                # Check if ANY market is open
                for market_name in MARKET_HOURS_LOCAL.keys():
                    is_open, _ = check_market_open(market_name)
                    if is_open:
                        return True
                return False
        except Exception as e:
            log_message(f'⚠️ Error checking market hours: {str(e)}', 'warning')
            return False
    else:
        # Fallback to built-in logic
        from datetime import datetime
        import pytz
        
        MARKET_HOURS = {
            'EGX': {'timezone': 'Africa/Cairo', 'open': (10, 0), 'close': (14, 30), 'days': [6, 0, 1, 2, 3]},
            'TADAWUL': {'timezone': 'Asia/Riyadh', 'open': (10, 0), 'close': (15, 0), 'days': [6, 0, 1, 2, 3]},
            'KSE': {'timezone': 'Asia/Kuwait', 'open': (9, 0), 'close': (13, 15), 'days': [6, 0, 1, 2, 3]},
            'QSE': {'timezone': 'Asia/Qatar', 'open': (9, 30), 'close': (13, 15), 'days': [6, 0, 1, 2, 3]},
        }
        
        markets_to_check = [market_code] if market_code else list(MARKET_HOURS.keys())
        
        for market in markets_to_check:
            if market not in MARKET_HOURS:
                continue
            config = MARKET_HOURS[market]
            try:
                tz = pytz.timezone(config['timezone'])
                now = datetime.now(tz)
                if now.weekday() not in config['days']:
                    continue
                current_time = now.hour * 60 + now.minute
                open_time = config['open'][0] * 60 + config['open'][1]
                close_time = config['close'][0] * 60 + config['close'][1]
                if open_time <= current_time <= close_time:
                    return True
            except:
                pass
        return False

def get_market_status_message() -> str:
    """Get a message about current market status"""
    if HAS_MARKET_HOURS:
        try:
            statuses = get_all_markets_status()
            open_markets = [s['name'] for s in statuses if s['is_open']]
            if open_markets:
                return f"🟢 أسواق مفتوحة: {', '.join(open_markets)}"
            return "🔴 جميع الأسواق مغلقة الآن"
        except:
            pass
    
    # Fallback
    if is_market_open():
        return "🟢 أحد الأسواق مفتوح"
    return "🔴 جميع الأسواق مغلقة الآن"

# ============================================================================
# SCHEDULER - Background Auto System
# ============================================================================

def run_scheduler():
    """Run the background scheduler with full auto-sync"""
    import time
    from datetime import datetime
    
    log_message('📅 Scheduler started - FULL AUTO MODE')
    engine_state['scheduler_active'] = True
    
    last_stocks = 0
    last_crypto = 0
    last_metals = 0
    last_news = 0
    last_historical = 0
    
    # Intervals in seconds
    STOCKS_INTERVAL = 5 * 60        # 5 minutes (market hours only)
    CRYPTO_INTERVAL = 2 * 60       # CRYPTO-PRO-051: 2 minutes (24/7, crypto moves fast)
    METALS_INTERVAL = 15 * 60      # 15 minutes
    NEWS_INTERVAL = 6 * 60 * 60    # 6 hours
    HISTORICAL_INTERVAL = 24 * 60 * 60  # 24 hours (1 day)
    
    while engine_state['running']:
        try:
            now = time.time()
            
            # 1. STOCKS (market hours only) + AUTO SYNC + INTRADAY SNAPSHOT
            if engine_state.get('stocks_running', True) and now - last_stocks >= STOCKS_INTERVAL:
                if is_market_open():
                    run_scraper_and_sync('stocks', SCRAPERS_DIR / 'tradingview_scraper.py', 600)
                    # Store STOCKS intraday snapshot (5-min, market hours only)
                    try:
                        sys.path.insert(0, str(BASE_DIR))
                        from intraday_storage import store_stocks_snapshot, cleanup_old_data
                        n = store_stocks_snapshot()
                        if n > 0:
                            log_message(f'📊 Intraday stocks: {n} snapshots stored')
                    except Exception as e:
                        log_message(f'Intraday stocks error: {str(e)[:80]}')
                else:
                    log_message(f'⏸️ Stocks: Markets closed - {get_market_status_message()}')
                last_stocks = now

            # 2. CRYPTO (24/7) + AUTO SYNC + INTRADAY SNAPSHOT
            if engine_state.get('crypto_running', True) and now - last_crypto >= CRYPTO_INTERVAL:
                run_scraper_and_sync('crypto', SCRAPERS_DIR / 'crypto_fetcher.py', 300)
                # Store CRYPTO intraday snapshot (24/7)
                try:
                    sys.path.insert(0, str(BASE_DIR))
                    from intraday_storage import store_crypto_snapshot
                    n = store_crypto_snapshot()
                    if n > 0:
                        log_message(f'🪙 Intraday crypto: {n} snapshots stored')
                except Exception as e:
                    log_message(f'Intraday crypto error: {str(e)[:80]}')
                last_crypto = now

            # 3. METALS/FOREX (24/7) + AUTO SYNC + INTRADAY SNAPSHOT
            if engine_state.get('metals_running', True) and now - last_metals >= METALS_INTERVAL:
                run_scraper_and_sync('metals', SCRAPERS_DIR / 'metals_forex_fetcher.py', 300)
                # Store COMMODITIES intraday snapshot (gold/silver/forex)
                try:
                    sys.path.insert(0, str(BASE_DIR))
                    from intraday_storage import store_commodities_snapshot, cleanup_old_data
                    n = store_commodities_snapshot()
                    if n > 0:
                        log_message(f'🥇 Intraday commodities: {n} snapshots stored')
                except Exception as e:
                    log_message(f'Intraday commodities error: {str(e)[:80]}')
                last_metals = now
            
            # 4. NEWS (every 6 hours)
            if engine_state.get('news_running', True) and now - last_news >= NEWS_INTERVAL:
                run_scraper_and_sync('news', SCRAPERS_DIR / 'news_scraper.py', 600)
                last_news = now
            
            # 5. DAILY MAINTENANCE (once per day) - intraday cleanup only.
            # Yahoo historical backfill (historical_fetcher.py) has been retired
            # from the automatic pipeline per the cleanup decision: historical
            # data is now accumulated from the daily TradingView closes written
            # to stock_daily_prices by sync.py. The manual /trigger/historical
            # endpoint remains available for one-off backfills if ever needed.
            if now - last_historical >= HISTORICAL_INTERVAL:
                log_message('📅 Scheduled: Daily intraday cleanup')
                try:
                    sys.path.insert(0, str(BASE_DIR))
                    from intraday_storage import cleanup_old_data
                    cleanup_old_data()
                    log_message('🧹 Intraday cleanup completed (7-day retention)')
                except Exception as e:
                    log_message(f'Intraday cleanup error: {str(e)[:80]}')
                last_historical = now
            
            # Sleep for 1 minute
            time.sleep(60)
            
        except Exception as e:
            log_message(f'❌ Scheduler error: {str(e)}', 'error')
            time.sleep(60)
    
    engine_state['scheduler_active'] = False
    log_message('📅 Scheduler stopped')

# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    # Ensure data directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    print("=" * 50)
    print("🔥 Data Engine - Arabic Stocks Data Factory")
    print("=" * 50)
    print(f"📂 Data directory: {DATA_DIR}")
    print(f"📊 Database: {DATA_ENGINE_DB}")
    print(f"🔄 Sync target: {STOCKS_DB}")
    print("=" * 50)
    
    # AUTO START - المحرك يبدأ تلقائياً
    auto_start = os.environ.get('DATA_ENGINE_AUTO_START', 'true').lower() == 'true'
    
    if auto_start:
        print("🚀 AUTO START enabled - Starting engine automatically...")
        engine_state['running'] = True
        engine_state['scheduler_active'] = True
        save_status()
        
        # Start scheduler immediately
        global scheduler_thread
        scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
        scheduler_thread.start()
        print("📅 Scheduler started automatically")
    else:
        print("⏸️ AUTO START disabled - Manual control mode")
        engine_state['running'] = False
        engine_state['scheduler_active'] = False
        save_status()
    
    # Run Flask app
    # Task 33 (Engine Control Room Radical Fix): read DATA_ENGINE_PORT env var
    # so the start_cmd in /api/admin/engines/control can override the default
    # 5000 → align with system-health's check on port 3010.
    # Rule 67 (ROOT-CAUSE-FIRST): previously the system-health route polled
    # port 3010 while this app hard-coded port 5000 → cards always showed red
    # even when the Flask app was healthy.
    _flask_port = int(os.environ.get('DATA_ENGINE_PORT', '5000'))
    app.run(host='0.0.0.0', port=_flask_port, debug=False, threaded=True)
