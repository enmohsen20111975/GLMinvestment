"""
News Routes Blueprint
=====================
News API routes for market news management

Routes:
- GET /api/news - Get market news
- POST /api/news - Add news (Admin only)
- DELETE /api/news/<int:news_id> - Delete news (Admin only)
- GET /api/news/ticker/<ticker> - Get news by ticker
- POST /api/news/bulk - Add multiple news (Admin only)
"""

import sqlite3
from datetime import datetime
from flask import Blueprint, jsonify, request

# Create blueprint with url_prefix
news_bp = Blueprint('news', __name__, url_prefix='/api/news')

# Database path - will be set by main.py or use default
DATABASE_PATH = None

def get_db_path():
    """Get database path, importing from config if available"""
    global DATABASE_PATH
    if DATABASE_PATH is None:
        try:
            from config import DATABASE_PATH as DB_PATH
            DATABASE_PATH = DB_PATH
        except ImportError:
            from pathlib import Path
            _base_dir = Path(__file__).parent.parent.parent.resolve()
            import os
            DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))
    return DATABASE_PATH


def init_news_db():
    """Initialize news table if not exists"""
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            title_ar TEXT,
            summary TEXT,
            summary_ar TEXT,
            source TEXT,
            url TEXT,
            category TEXT DEFAULT 'market',
            ticker TEXT,
            sentiment TEXT DEFAULT 'neutral',
            importance INTEGER DEFAULT 5,
            published_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()


def check_admin_auth():
    """Check admin authorization.

    SEC-05 HOTFIX (Phase A): the literal 'REDACTED_ADMIN_TOKEN' comparison is
    removed. Auth now delegates to the shared `verify_token` helper which
    reads ADMIN_TOKEN from the environment (fail closed if unset).
    """
    from core.auth_middleware import verify_token  # late import to avoid cycles
    auth_header = request.headers.get('Authorization', '')
    token = auth_header.replace('Bearer ', '') if auth_header else ''
    # Also accept the X-Admin-Token header used by the rest of the admin API.
    if not token:
        token = request.headers.get('X-Admin-Token', '')
    return bool(token) and verify_token(token)


# ============================================================================
# NEWS ROUTES
# ============================================================================

@news_bp.route('', methods=['GET'])
def get_news():
    """
    الحصول على أخبار السوق
    
    Query params:
        - limit: عدد الأخبار (default: 20)
        - ticker: فلترة حسب السهم
        - category: فلترة حسب التصنيف (market, stock, economy, crypto)
    """
    try:
        limit = request.args.get('limit', 20, type=int)
        ticker = request.args.get('ticker', '').upper()
        category = request.args.get('category', '')
        
        conn = sqlite3.connect(get_db_path())
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if news table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news'")
        if not cursor.fetchone():
            init_news_db()
        
        # Build query
        query = "SELECT * FROM news WHERE 1=1"
        params = []
        
        if ticker:
            query += " AND (ticker = ? OR ticker LIKE ?)"
            params.extend([ticker, f'%{ticker}%'])
        
        if category:
            query += " AND category = ?"
            params.append(category)
        
        query += " ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        news_list = []
        for row in rows:
            news_list.append({
                "id": row['id'],
                "title": row['title'],
                "title_ar": row['title_ar'],
                "summary": row['summary'],
                "summary_ar": row['summary_ar'],
                "source": row['source'],
                "url": row['url'],
                "category": row['category'],
                "ticker": row['ticker'],
                "sentiment": row['sentiment'],
                "importance": row['importance'],
                "published_at": row['published_at'],
                "created_at": row['created_at']
            })
        
        conn.close()
        
        return jsonify({
            "success": True,
            "count": len(news_list),
            "news": news_list,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('', methods=['POST'])
def add_news():
    """
    إضافة خبر جديد (Admin only)
    
    Body:
        - title: عنوان الخبر
        - title_ar: العنوان بالعربي
        - summary: ملخص الخبر
        - summary_ar: الملخص بالعربي
        - source: المصدر
        - url: رابط الخبر
        - category: التصنيف (market, stock, economy, crypto)
        - ticker: السهم المرتبط
        - sentiment: المشاعر (positive, negative, neutral)
        - importance: الأهمية (1-10)
        - published_at: تاريخ النشر
    """
    try:
        if not check_admin_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        
        data = request.get_json() or {}
        
        if not data.get('title'):
            return jsonify({"success": False, "error": "title is required"}), 400
        
        conn = sqlite3.connect(get_db_path())
        cursor = conn.cursor()
        
        # Create table if not exists
        init_news_db()
        
        cursor.execute('''
            INSERT INTO news (title, title_ar, summary, summary_ar, source, url, category, ticker, sentiment, importance, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data.get('title'),
            data.get('title_ar'),
            data.get('summary'),
            data.get('summary_ar'),
            data.get('source', 'EGX'),
            data.get('url'),
            data.get('category', 'market'),
            data.get('ticker', '').upper(),
            data.get('sentiment', 'neutral'),
            data.get('importance', 5),
            data.get('published_at', datetime.now().isoformat())
        ))
        
        conn.commit()
        news_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            "success": True,
            "message": "تم إضافة الخبر بنجاح",
            "news_id": news_id
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('/<int:news_id>', methods=['DELETE'])
def delete_news(news_id):
    """
    حذف خبر (Admin only)
    """
    try:
        if not check_admin_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        
        conn = sqlite3.connect(get_db_path())
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM news WHERE id = ?", (news_id,))
        conn.commit()
        
        deleted = cursor.rowcount > 0
        conn.close()
        
        if deleted:
            return jsonify({"success": True, "message": "تم حذف الخبر"})
        else:
            return jsonify({"success": False, "error": "الخبر غير موجود"}), 404
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('/ticker/<ticker>', methods=['GET'])
def get_news_by_ticker(ticker):
    """
    الحصول على أخبار سهم معين
    """
    try:
        conn = sqlite3.connect(get_db_path())
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if news table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news'")
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                "success": True,
                "ticker": ticker.upper(),
                "count": 0,
                "news": []
            })
        
        cursor.execute('''
            SELECT * FROM news 
            WHERE ticker = ? OR ticker LIKE ?
            ORDER BY COALESCE(published_at, created_at) DESC
            LIMIT 20
        ''', (ticker.upper(), f'%{ticker.upper()}%'))
        
        rows = cursor.fetchall()
        conn.close()
        
        news_list = [{
            "id": row['id'],
            "title": row['title'],
            "title_ar": row['title_ar'],
            "summary": row['summary'],
            "summary_ar": row['summary_ar'],
            "source": row['source'],
            "url": row['url'],
            "sentiment": row['sentiment'],
            "importance": row['importance'],
            "published_at": row['published_at']
        } for row in rows]
        
        return jsonify({
            "success": True,
            "ticker": ticker.upper(),
            "count": len(news_list),
            "news": news_list
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('/bulk', methods=['POST'])
def add_news_bulk():
    """
    إضافة أخبار متعددة (Admin only)
    """
    try:
        if not check_admin_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        
        data = request.get_json() or {}
        news_items = data.get('news', [])
        
        if not news_items:
            return jsonify({"success": False, "error": "news array is required"}), 400
        
        conn = sqlite3.connect(get_db_path())
        cursor = conn.cursor()
        
        # Create table if not exists
        init_news_db()
        
        added = 0
        for item in news_items:
            if item.get('title'):
                cursor.execute('''
                    INSERT INTO news (title, title_ar, summary, summary_ar, source, url, category, ticker, sentiment, importance, published_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    item.get('title'),
                    item.get('title_ar'),
                    item.get('summary'),
                    item.get('summary_ar'),
                    item.get('source', 'EGX'),
                    item.get('url'),
                    item.get('category', 'market'),
                    item.get('ticker', '').upper(),
                    item.get('sentiment', 'neutral'),
                    item.get('importance', 5),
                    item.get('published_at', datetime.now().isoformat())
                ))
                added += 1
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "message": f"تم إضافة {added} خبر",
            "added": added
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('/egx', methods=['GET'])
def get_egx_news():
    """
    الحصول على أخبار البورصة المصرية (EGX)
    Get EGX market news
    
    Query params:
        - limit: عدد الأخبار (default: 10)
    """
    try:
        limit = request.args.get('limit', 10, type=int)
        
        conn = sqlite3.connect(get_db_path())
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if news table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news'")
        if not cursor.fetchone():
            init_news_db()
            conn.close()
            return jsonify({
                "success": True,
                "count": 0,
                "news": [],
                "message": "No news table found"
            })
        
        # Get EGX news (market category or EGX-related)
        cursor.execute('''
            SELECT * FROM news 
            WHERE category = 'market' OR category = 'economy' OR ticker IS NULL OR ticker = ''
            ORDER BY COALESCE(published_at, created_at) DESC 
            LIMIT ?
        ''', (limit,))
        
        rows = cursor.fetchall()
        conn.close()
        
        news_list = []
        for row in rows:
            news_list.append({
                "id": row['id'],
                "title": row['title'],
                "title_ar": row['title_ar'],
                "summary": row['summary'],
                "summary_ar": row['summary_ar'],
                "source": row['source'],
                "url": row['url'],
                "category": row['category'],
                "ticker": row['ticker'],
                "sentiment": row['sentiment'],
                "sentimentScore": 0.0,  # For compatibility
                "impactScore": row['importance'] * 10,  # Convert to 0-100 scale
                "importance": row['importance'],
                "publishedAt": row['published_at'],  # camelCase for frontend
                "published_at": row['published_at'],
                "created_at": row['created_at']
            })
        
        return jsonify({
            "success": True,
            "count": len(news_list),
            "news": news_list,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
