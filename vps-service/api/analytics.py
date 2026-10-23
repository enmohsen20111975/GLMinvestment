"""
Analytics Tracking API
======================
نظام تتبع المستخدمين والزيارات

الجداول:
- page_views: زيارات الصفحات
- feature_usage: استخدام الميزات
- daily_analytics_summary: ملخص يومي
- user_sessions: جلسات المستخدمين
- error_logs: تتبع الأخطاء
"""

import os
from core.auth_middleware import require_admin
import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from flask import Blueprint, request, jsonify
from pathlib import Path

# Create blueprint
analytics_bp = Blueprint('analytics', __name__)

# Database path - use relative path for portability
def get_db_path():
    """Get database path - works on any machine."""
    env_path = os.environ.get('DATABASE_PATH', '')
    if env_path:
        return env_path
    # Relative path from this file (vps-service/api/analytics.py -> ../../db/analytics.db)
    base_dir = Path(__file__).parent.parent.parent.resolve()  # Project root
    db_dir = base_dir / 'db'
    db_dir.mkdir(parents=True, exist_ok=True)
    return str(db_dir / 'stocks.db')  # Consolidated July 2026

DB_PATH = get_db_path()


def get_db_connection():
    """Get database connection with WAL mode for concurrent access safety."""
    import sqlite3
    # Ensure directory exists
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=True).__enter__()
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_analytics_tables():
    """Initialize analytics tables - with auto-recovery for malformed schema."""
    import sqlite3
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Auto-recover from malformed schema before attempting table creation
    try:
        cursor.execute("PRAGMA quick_check")
        result = cursor.fetchone()
        if result and result[0] != "ok":
            # Try REINDEX to fix corrupted indexes
            try:
                cursor.execute("REINDEX")
                conn.commit()
            except sqlite3.DatabaseError:
                pass
    except Exception:
        pass
    
    # Page views table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            session_id TEXT,
            page_path TEXT NOT NULL,
            page_title TEXT,
            referrer TEXT,
            ip_hash TEXT,
            user_agent TEXT,
            device_type TEXT,
            browser TEXT,
            os TEXT,
            country TEXT,
            city TEXT,
            load_time_ms INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    
    # Feature usage table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS feature_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            session_id TEXT,
            feature_name TEXT NOT NULL,
            action TEXT,
            metadata TEXT,
            ticker TEXT,
            duration_ms INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    
    # Daily analytics summary
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS daily_analytics_summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT UNIQUE,
            total_page_views INTEGER DEFAULT 0,
            unique_visitors INTEGER DEFAULT 0,
            new_users INTEGER DEFAULT 0,
            returning_users INTEGER DEFAULT 0,
            total_sessions INTEGER DEFAULT 0,
            avg_session_duration INTEGER DEFAULT 0,
            bounce_rate REAL DEFAULT 0,
            mobile_users INTEGER DEFAULT 0,
            desktop_users INTEGER DEFAULT 0,
            tablet_users INTEGER DEFAULT 0,
            top_pages TEXT,
            top_features TEXT,
            top_stocks_viewed TEXT,
            top_referrers TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    
    # User sessions
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE,
            user_id TEXT,
            ip_hash TEXT,
            user_agent TEXT,
            device_type TEXT,
            browser TEXT,
            os TEXT,
            country TEXT,
            city TEXT,
            referrer TEXT,
            landing_page TEXT,
            exit_page TEXT,
            page_views INTEGER DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            is_bounce INTEGER DEFAULT 0,
            started_at TEXT DEFAULT (datetime('now')),
            ended_at TEXT
        )
    ''')
    
    # Error logs
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS error_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            error_type TEXT NOT NULL,
            error_message TEXT,
            stack_trace TEXT,
            page_path TEXT,
            user_id TEXT,
            session_id TEXT,
            user_agent TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    
    # Create indexes
    try:
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_pv_path ON page_views(page_path)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_pv_created ON page_views(created_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_fu_name ON feature_usage(feature_name)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_fu_created ON feature_usage(created_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_das_date ON daily_analytics_summary(date)')
    except:
        pass
    
    conn.commit()
    conn.close()


def hash_ip(ip: str) -> str:
    """Hash IP address for privacy."""
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def parse_user_agent(user_agent: str) -> Dict:
    """Parse user agent string."""
    if not user_agent:
        return {'device_type': 'unknown', 'browser': 'unknown', 'os': 'unknown'}
    
    ua_lower = user_agent.lower()
    
    # Device type
    if 'mobile' in ua_lower or 'android' in ua_lower or 'iphone' in ua_lower:
        device_type = 'mobile'
    elif 'tablet' in ua_lower or 'ipad' in ua_lower:
        device_type = 'tablet'
    else:
        device_type = 'desktop'
    
    # Browser
    if 'firefox' in ua_lower:
        browser = 'firefox'
    elif 'chrome' in ua_lower:
        browser = 'chrome'
    elif 'safari' in ua_lower:
        browser = 'safari'
    elif 'edge' in ua_lower:
        browser = 'edge'
    else:
        browser = 'other'
    
    # OS
    if 'windows' in ua_lower:
        os_name = 'windows'
    elif 'mac' in ua_lower:
        os_name = 'macos'
    elif 'linux' in ua_lower:
        os_name = 'linux'
    elif 'android' in ua_lower:
        os_name = 'android'
    elif 'ios' in ua_lower or 'iphone' in ua_lower or 'ipad' in ua_lower:
        os_name = 'ios'
    else:
        os_name = 'other'
    
    return {'device_type': device_type, 'browser': browser, 'os': os_name}


# Initialize tables on import - wrapped to survive DB corruption
try:
    init_analytics_tables()
except Exception as _init_err:
    import logging as _log
    _log.getLogger(__name__).warning(
        'Analytics tables init failed (DB may be corrupt, will retry on first request): '
        + str(_init_err)
    )


# ==================== API Routes ====================

@require_admin
@analytics_bp.route('/track', methods=['POST'])
def track_event():
    """
    Track an analytics event.
    
    Body:
    {
        "event_type": "page_view" | "feature_use" | "error" | "custom",
        "event_name": string,
        "event_data": object,
        "user_id": string (optional),
        "session_id": string (optional)
    }
    """
    try:
        data = request.get_json() or {}
        
        event_type = data.get('event_type', 'custom')
        event_name = data.get('event_name', '')
        event_data = data.get('event_data', {})
        user_id = data.get('user_id')
        session_id = data.get('session_id')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if event_type == 'page_view':
            # Track page view
            ua_info = parse_user_agent(request.headers.get('User-Agent', ''))
            ip_hash = hash_ip(request.remote_addr)
            
            cursor.execute('''
                INSERT INTO page_views 
                (user_id, session_id, page_path, page_title, referrer, ip_hash, 
                 user_agent, device_type, browser, os, load_time_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_id,
                session_id,
                event_data.get('page_path', '/'),
                event_data.get('page_title'),
                event_data.get('referrer'),
                ip_hash,
                request.headers.get('User-Agent', '')[:500],
                ua_info['device_type'],
                ua_info['browser'],
                ua_info['os'],
                event_data.get('load_time_ms')
            ))
            
        elif event_type == 'feature_use':
            # Track feature usage
            cursor.execute('''
                INSERT INTO feature_usage 
                (user_id, session_id, feature_name, action, metadata, ticker, duration_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_id,
                session_id,
                event_name,
                event_data.get('action'),
                json.dumps(event_data) if event_data else None,
                event_data.get('ticker'),
                event_data.get('duration_ms')
            ))
            
        elif event_type == 'error':
            # Track error
            cursor.execute('''
                INSERT INTO error_logs 
                (error_type, error_message, stack_trace, page_path, user_id, session_id, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                event_name,
                event_data.get('message'),
                event_data.get('stack_trace'),
                event_data.get('page_path'),
                user_id,
                session_id,
                request.headers.get('User-Agent', '')[:500]
            ))
            
        else:
            # Custom event - store in feature_usage
            cursor.execute('''
                INSERT INTO feature_usage 
                (user_id, session_id, feature_name, action, metadata)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                user_id,
                session_id,
                event_type,
                event_name,
                json.dumps(event_data) if event_data else None
            ))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Event tracked'})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@require_admin
@analytics_bp.route('/session/start', methods=['POST'])
def start_session():
    """Start a new user session."""
    try:
        data = request.get_json() or {}
        
        session_id = data.get('session_id')
        user_id = data.get('user_id')
        
        if not session_id:
            return jsonify({'success': False, 'error': 'session_id required'}), 400
        
        ua_info = parse_user_agent(request.headers.get('User-Agent', ''))
        ip_hash = hash_ip(request.remote_addr)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO user_sessions 
            (session_id, user_id, ip_hash, user_agent, device_type, browser, os, 
             referrer, landing_page, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ''', (
            session_id,
            user_id,
            ip_hash,
            request.headers.get('User-Agent', '')[:500],
            ua_info['device_type'],
            ua_info['browser'],
            ua_info['os'],
            data.get('referrer'),
            data.get('landing_page')
        ))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'session_id': session_id})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@require_admin
@analytics_bp.route('/session/end', methods=['POST'])
def end_session():
    """End a user session."""
    try:
        data = request.get_json() or {}
        
        session_id = data.get('session_id')
        exit_page = data.get('exit_page')
        page_views = data.get('page_views', 0)
        duration_seconds = data.get('duration_seconds', 0)
        
        if not session_id:
            return jsonify({'success': False, 'error': 'session_id required'}), 400
        
        is_bounce = 1 if page_views <= 1 else 0
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE user_sessions 
            SET exit_page = ?, page_views = ?, duration_seconds = ?, 
                is_bounce = ?, ended_at = datetime('now')
            WHERE session_id = ?
        ''', (exit_page, page_views, duration_seconds, is_bounce, session_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Admin Analytics API ====================

@analytics_bp.route('/admin/overview', methods=['GET'])
def get_overview():
    """Get analytics overview for admin dashboard."""
    try:
        days = request.args.get('days', 7, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Total page views
        cursor.execute('''
            SELECT COUNT(*) as count FROM page_views 
            WHERE date(created_at) >= date('now', ?)
        ''', (f'-{days} days',))
        total_page_views = cursor.fetchone()['count']
        
        # Unique visitors
        cursor.execute('''
            SELECT COUNT(DISTINCT COALESCE(user_id, ip_hash)) as count 
            FROM page_views 
            WHERE date(created_at) >= date('now', ?)
        ''', (f'-{days} days',))
        unique_visitors = cursor.fetchone()['count']
        
        # Top pages
        cursor.execute('''
            SELECT page_path, COUNT(*) as views 
            FROM page_views 
            WHERE date(created_at) >= date('now', ?)
            GROUP BY page_path 
            ORDER BY views DESC 
            LIMIT 10
        ''', (f'-{days} days',))
        top_pages = [{'page': r['page_path'], 'views': r['views']} for r in cursor.fetchall()]
        
        # Top features
        cursor.execute('''
            SELECT feature_name, COUNT(*) as uses 
            FROM feature_usage 
            WHERE date(created_at) >= date('now', ?)
            GROUP BY feature_name 
            ORDER BY uses DESC 
            LIMIT 10
        ''', (f'-{days} days',))
        top_features = [{'feature': r['feature_name'], 'uses': r['uses']} for r in cursor.fetchall()]
        
        # Device breakdown
        cursor.execute('''
            SELECT device_type, COUNT(*) as count 
            FROM page_views 
            WHERE date(created_at) >= date('now', ?)
            GROUP BY device_type
        ''', (f'-{days} days',))
        devices = {r['device_type']: r['count'] for r in cursor.fetchall()}
        
        # Top stocks viewed
        cursor.execute('''
            SELECT ticker, COUNT(*) as views 
            FROM feature_usage 
            WHERE ticker IS NOT NULL AND date(created_at) >= date('now', ?)
            GROUP BY ticker 
            ORDER BY views DESC 
            LIMIT 10
        ''', (f'-{days} days',))
        top_stocks = [{'ticker': r['ticker'], 'views': r['views']} for r in cursor.fetchall()]
        
        # Daily trend
        cursor.execute('''
            SELECT date(created_at) as date, COUNT(*) as views 
            FROM page_views 
            WHERE date(created_at) >= date('now', ?)
            GROUP BY date(created_at) 
            ORDER BY date
        ''', (f'-{days} days',))
        daily_trend = [{'date': r['date'], 'views': r['views']} for r in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'total_page_views': total_page_views,
                'unique_visitors': unique_visitors,
                'top_pages': top_pages,
                'top_features': top_features,
                'top_stocks_viewed': top_stocks,
                'devices': devices,
                'daily_trend': daily_trend,
                'period_days': days
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/admin/page-views', methods=['GET'])
def get_page_views():
    """Get detailed page views."""
    try:
        days = request.args.get('days', 7, type=int)
        page = request.args.get('page', '')
        limit = request.args.get('limit', 100, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if page:
            cursor.execute('''
                SELECT * FROM page_views 
                WHERE page_path LIKE ? AND date(created_at) >= date('now', ?)
                ORDER BY created_at DESC 
                LIMIT ?
            ''', (f'%{page}%', f'-{days} days', limit))
        else:
            cursor.execute('''
                SELECT * FROM page_views 
                WHERE date(created_at) >= date('now', ?)
                ORDER BY created_at DESC 
                LIMIT ?
            ''', (f'-{days} days', limit))
        
        rows = cursor.fetchall()
        page_views = [dict(r) for r in rows]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'count': len(page_views),
            'data': page_views
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@analytics_bp.route('/admin/feature-usage', methods=['GET'])
def get_feature_usage():
    """Get detailed feature usage."""
    try:
        days = request.args.get('days', 7, type=int)
        feature = request.args.get('feature', '')
        limit = request.args.get('limit', 100, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if feature:
            cursor.execute('''
                SELECT * FROM feature_usage 
                WHERE feature_name = ? AND date(created_at) >= date('now', ?)
                ORDER BY created_at DESC 
                LIMIT ?
            ''', (feature, f'-{days} days', limit))
        else:
            cursor.execute('''
                SELECT * FROM feature_usage 
                WHERE date(created_at) >= date('now', ?)
                ORDER BY created_at DESC 
                LIMIT ?
            ''', (f'-{days} days', limit))
        
        rows = cursor.fetchall()
        usage = [dict(r) for r in rows]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'count': len(usage),
            'data': usage
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@require_admin
@analytics_bp.route('/admin/generate-daily-summary', methods=['POST'])
def generate_daily_summary():
    """Generate daily analytics summary."""
    try:
        data = request.get_json() or {}
        target_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Calculate metrics
        cursor.execute('''
            SELECT 
                COUNT(*) as total_page_views,
                COUNT(DISTINCT COALESCE(user_id, ip_hash)) as unique_visitors,
                SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) as new_users
            FROM page_views 
            WHERE date(created_at) = ?
        ''', (target_date,))
        pv_stats = cursor.fetchone()
        
        # Device breakdown
        cursor.execute('''
            SELECT device_type, COUNT(*) as count 
            FROM page_views 
            WHERE date(created_at) = ?
            GROUP BY device_type
        ''', (target_date,))
        devices = {r['device_type']: r['count'] for r in cursor.fetchall()}
        
        # Top pages
        cursor.execute('''
            SELECT page_path, COUNT(*) as views 
            FROM page_views 
            WHERE date(created_at) = ?
            GROUP BY page_path 
            ORDER BY views DESC 
            LIMIT 10
        ''', (target_date,))
        top_pages = json.dumps([{'page': r['page_path'], 'views': r['views']} for r in cursor.fetchall()])
        
        # Top features
        cursor.execute('''
            SELECT feature_name, COUNT(*) as uses 
            FROM feature_usage 
            WHERE date(created_at) = ?
            GROUP BY feature_name 
            ORDER BY uses DESC 
            LIMIT 10
        ''', (target_date,))
        top_features = json.dumps([{'feature': r['feature_name'], 'uses': r['uses']} for r in cursor.fetchall()])
        
        # Insert or update summary
        cursor.execute('''
            INSERT OR REPLACE INTO daily_analytics_summary 
            (date, total_page_views, unique_visitors, new_users, 
             mobile_users, desktop_users, tablet_users, top_pages, top_features)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            target_date,
            pv_stats['total_page_views'] or 0,
            pv_stats['unique_visitors'] or 0,
            pv_stats['new_users'] or 0,
            devices.get('mobile', 0),
            devices.get('desktop', 0),
            devices.get('tablet', 0),
            top_pages,
            top_features
        ))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': f'Daily summary generated for {target_date}'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
