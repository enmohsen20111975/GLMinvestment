"""
News Routes Blueprint
=====================
News API routes for market news management

Routes:
- GET /api/news - Get market news
- POST /api/news - Add news (Admin only)
- POST /api/news/agent - Add news from local News Agent (telegram/rss/web) — no admin auth, uses API key
- DELETE /api/news/<int:news_id> - Delete news (Admin only)
- GET /api/news/ticker/<ticker> - Get news by ticker
- POST /api/news/bulk - Add multiple news (Admin only)
"""

import sqlite3
from core.auth_middleware import require_admin
import json
import os
from datetime import datetime
from flask import Blueprint, jsonify, request

# Create blueprint with url_prefix
news_bp = Blueprint('news', __name__, url_prefix='/api/news')

# Database path - will be set by main.py or use default
DATABASE_PATH = None

# News Agent DB (separate from stocks.db — stores full News Agent payload)
NEWS_AGENT_DB = os.environ.get('NEWS_AGENT_DB', str(
    Path(__file__).resolve().parents[2] / 'db' / 'news.db'
)) if (Path := __import__('pathlib').Path) else 'db/news.db'


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
    """Initialize news table if not exists — Rule 44: news.db is canonical (not stocks.db).

    Phase 3 migration: use db_manager.connection() for WAL + busy_timeout.
    """
    # Rule 44 + Rule 54: استخدم news.db (canonical) عبر db_manager
    try:
        from core.db_manager import db_manager
        with db_manager.connection('news', writable=True) as conn:
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
        return
    except Exception:
        # fallback: raw sqlite3.connect (backward compat)
        pass
    # Phase 7.1: migrated (writable for CREATE)
    from core.db_manager import db_manager
    conn = db_manager.connection(get_db_path(), writable=True).__enter__()
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


def init_news_agent_db():
    """Initialize news_agent table in news.db for News Agent payload.

    The News Agent (local service) sends:
      title, content, summary_ar, summary_en, source, source_type,
      url, tickers (list), importance (0-100), sentiment, impact_type,
      market, image_paths (list), ocr_text, raw_analysis, published_at.

    This table stores the FULL payload + analysis fields for V40.2 news impact.

    Phase 3 migration: use db_manager.connection('news') for WAL + busy_timeout.
    """
    # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
    try:
        from core.db_manager import db_manager
        with db_manager.connection('news', writable=True) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS news_agent_articles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT,
                    summary_ar TEXT,
                    summary_en TEXT,
                    source TEXT,
                    source_type TEXT,
                    url TEXT,
                    tickers_json TEXT,
                    importance INTEGER DEFAULT 50,
                    sentiment TEXT DEFAULT 'neutral',
                    impact_type TEXT,
                    market TEXT DEFAULT 'EGX',
                    image_paths_json TEXT,
                    ocr_text TEXT,
                    raw_analysis_json TEXT,
                    published_at TEXT,
                    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed INTEGER DEFAULT 0
                )
            ''')
            # Index for fast ticker lookup
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_news_agent_published
                ON news_agent_articles(published_at)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_news_agent_sentiment
                ON news_agent_articles(sentiment, importance)
            ''')
            conn.commit()
        return
    except Exception:
        pass
    # fallback: raw sqlite3.connect (backward compat)
    # Phase 7.1: migrated to db_manager
    from core.db_manager import db_manager
    conn = db_manager.connection(NEWS_AGENT_DB, writable=True).__enter__()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS news_agent_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            summary_ar TEXT,
            summary_en TEXT,
            source TEXT,
            source_type TEXT,
            url TEXT,
            tickers_json TEXT,
            importance INTEGER DEFAULT 50,
            sentiment TEXT DEFAULT 'neutral',
            impact_type TEXT,
            market TEXT DEFAULT 'EGX',
            image_paths_json TEXT,
            ocr_text TEXT,
            raw_analysis_json TEXT,
            published_at TEXT,
            received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed INTEGER DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_news_agent_published
        ON news_agent_articles(published_at)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_news_agent_sentiment
        ON news_agent_articles(sentiment, importance)
    ''')
    conn.commit()
    conn.close()


def check_news_agent_auth():
    """Check auth for News Agent requests.

    Uses NEWS_AGENT_API_KEY env var. If unset, allows all requests (for dev).
    In production, set NEWS_AGENT_API_KEY to a shared secret.
    """
    expected_key = os.environ.get('NEWS_AGENT_API_KEY', '')
    if not expected_key:
        # Dev mode: no auth required
        return True
    provided = request.headers.get('X-News-Agent-Key', '')
    return provided == expected_key


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

        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            # Check if news table exists
            if not db_manager.table_exists('news', 'news'):
                init_news_db()
            # Build query
            sql = "SELECT * FROM news WHERE 1=1"
            params = []
            if ticker:
                sql += " AND (ticker = ? OR ticker LIKE ?)"
                params.extend([ticker, f'%{ticker}%'])
            if category:
                sql += " AND category = ?"
                params.append(category)
            sql += " ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?"
            params.append(limit)
            rows = db_manager.query('news', sql, params)
        except Exception:
            # fallback: raw sqlite3.connect (backward compat)
            conn = sqlite3.connect(get_db_path())
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news'")
            if not cursor.fetchone():
                init_news_db()
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
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()

        news_list = []
        for row in rows:
            news_list.append({
                "id": row['id'],
                "title": row['title'],
                "title_ar": row.get('title_ar') if isinstance(row, dict) else row['title_ar'],
                "summary": row.get('summary') if isinstance(row, dict) else row['summary'],
                "summary_ar": row.get('summary_ar') if isinstance(row, dict) else row['summary_ar'],
                "source": row.get('source') if isinstance(row, dict) else row['source'],
                "url": row.get('url') if isinstance(row, dict) else row['url'],
                "category": row.get('category') if isinstance(row, dict) else row['category'],
                "ticker": row.get('ticker') if isinstance(row, dict) else row['ticker'],
                "sentiment": row.get('sentiment') if isinstance(row, dict) else row['sentiment'],
                "importance": row.get('importance') if isinstance(row, dict) else row['importance'],
                "published_at": row.get('published_at') if isinstance(row, dict) else row['published_at'],
                "created_at": row.get('created_at') if isinstance(row, dict) else row['created_at']
            })

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
        
        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            # Create table if not exists
            init_news_db()
            news_id = db_manager.execute('news', '''
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
            # execute() بيرجّع rowcount، لازم نجيب lastrowid عبر connection منفصل
            with db_manager.connection('news', writable=True) as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT last_insert_rowid()')
                news_id = cursor.fetchone()[0]
        except Exception:
            # fallback: raw sqlite3.connect (backward compat)
            conn = sqlite3.connect(get_db_path())
            cursor = conn.cursor()
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


@require_admin
@news_bp.route('/<int:news_id>', methods=['DELETE'])
def delete_news(news_id):
    """
    حذف خبر (Admin only)
    """
    try:
        if not check_admin_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401

        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            affected = db_manager.execute('news', "DELETE FROM news WHERE id = ?", (news_id,))
            deleted = affected > 0
        except Exception:
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
        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            if not db_manager.table_exists('news', 'news'):
                return jsonify({
                    "success": True,
                    "ticker": ticker.upper(),
                    "count": 0,
                    "news": []
                })
            rows = db_manager.query('news', '''
                SELECT * FROM news
                WHERE ticker = ? OR ticker LIKE ?
                ORDER BY COALESCE(published_at, created_at) DESC
                LIMIT 20
            ''', (ticker.upper(), f'%{ticker.upper()}%'))
        except Exception:
            conn = sqlite3.connect(get_db_path())
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
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
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()

        news_list = [{
            "id": row['id'],
            "title": row['title'],
            "title_ar": row.get('title_ar') if isinstance(row, dict) else row['title_ar'],
            "summary": row.get('summary') if isinstance(row, dict) else row['summary'],
            "summary_ar": row.get('summary_ar') if isinstance(row, dict) else row['summary_ar'],
            "source": row.get('source') if isinstance(row, dict) else row['source'],
            "url": row.get('url') if isinstance(row, dict) else row['url'],
            "sentiment": row.get('sentiment') if isinstance(row, dict) else row['sentiment'],
            "importance": row.get('importance') if isinstance(row, dict) else row['importance'],
            "published_at": row.get('published_at') if isinstance(row, dict) else row['published_at']
        } for row in rows]

        return jsonify({
            "success": True,
            "ticker": ticker.upper(),
            "count": len(news_list),
            "news": news_list
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@require_admin
@news_bp.route('/bulk', methods=['POST'])
def add_news_bulk():
    """
    إضافة أخبار متعددة (Admin only)
    """
    try:
        if not check_admin_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        
        data = request.get_json() or {}
        incoming_news = data.get('news', [])

        if not incoming_news:
            return jsonify({"success": False, "error": "news array is required"}), 400

        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            init_news_db()
            params_list = []
            for item in incoming_news:
                if item.get('title'):
                    params_list.append((
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
            if params_list:
                db_manager.execute_many('news', '''
                    INSERT INTO news (title, title_ar, summary, summary_ar, source, url, category, ticker, sentiment, importance, published_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', params_list)
            added = len(params_list)
        except Exception:
            conn = sqlite3.connect(get_db_path())
            cursor = conn.cursor()
            init_news_db()
            added = 0
            for item in incoming_news:
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
        
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        conn = db_manager.connection(get_db_path(), writable=False).__enter__()
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


# ============================================================================
# NEWS AGENT ENDPOINT — لـ News Agent المحلي (telegram/rss/web)
# ============================================================================
# توجيه المالك (2026-09-02): "اعمل مشروع محلى عشان اغذى الموقع بلأخبار الحية"
# الـ News Agent المحلي بـ يجمع الأخبار من Telegram + RSS + Web،
# يحللها محلياً بـ Ollama، وبعدين يبعتها للموقع عبر POST /api/news/agent.
#
# الـ payload المتوقع:
#   title: str (required)
#   content: str
#   summary_ar: str
#   summary_en: str
#   source: str
#   source_type: "telegram" | "rss" | "web"
#   url: str
#   tickers: list[str]  e.g. ["COMI", "TMGH"]
#   importance: int 0-100
#   sentiment: "bullish" | "bearish" | "neutral"
#   impact_type: "earnings" | "macro" | "market"
#   market: "EGX" | "NASDAQ" | "global"
#   image_paths: list[str]
#   ocr_text: str
#   raw_analysis: dict (JSON-serializable)
#   published_at: ISO date string
# ============================================================================


@require_admin
@news_bp.route('/agent', methods=['POST'])
def receive_from_news_agent():
    """استقبال خبر من News Agent المحلي وتخزينه في news.db.

    Auth: X-News-Agent-Key header (optional in dev, required in prod if NEWS_AGENT_API_KEY set).
    """
    try:
        if not check_news_agent_auth():
            return jsonify({"success": False, "error": "Unauthorized: invalid X-News-Agent-Key"}), 401

        data = request.get_json() or {}

        # Validate required fields
        if not data.get('title'):
            return jsonify({"success": False, "error": "title is required"}), 400

        # Normalize fields
        title = str(data.get('title', ''))[:500]
        content = str(data.get('content', ''))[:50000]
        summary_ar = str(data.get('summary_ar', ''))[:2000]
        summary_en = str(data.get('summary_en', ''))[:2000]
        source = str(data.get('source', 'unknown'))[:200]
        source_type = str(data.get('source_type', 'web'))[:50]
        url = str(data.get('url', ''))[:2000]
        tickers = data.get('tickers', [])
        if isinstance(tickers, str):
            tickers = [t.strip().upper() for t in tickers.split(',') if t.strip()]
        tickers_json = json.dumps([t.upper() for t in tickers[:20]])  # max 20 tickers
        importance = max(0, min(100, int(data.get('importance', 50))))  # clamp 0-100
        sentiment = str(data.get('sentiment', 'neutral')).lower()
        if sentiment not in ('bullish', 'bearish', 'neutral'):
            sentiment = 'neutral'
        impact_type = str(data.get('impact_type', 'market'))[:50]
        market = str(data.get('market', 'EGX'))[:20]
        image_paths = data.get('image_paths', [])
        if isinstance(image_paths, str):
            image_paths = [image_paths]
        image_paths_json = json.dumps(image_paths[:10])  # max 10 images
        ocr_text = str(data.get('ocr_text', ''))[:10000]
        raw_analysis = data.get('raw_analysis', {})
        raw_analysis_json = json.dumps(raw_analysis) if isinstance(raw_analysis, dict) else str(raw_analysis)[:5000]
        published_at = str(data.get('published_at', datetime.now().isoformat()))[:50]

        # Initialize table (idempotent)
        init_news_agent_db()

        # Insert — Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            db_manager.execute('news', '''
                INSERT INTO news_agent_articles (
                    title, content, summary_ar, summary_en, source, source_type,
                    url, tickers_json, importance, sentiment, impact_type, market,
                    image_paths_json, ocr_text, raw_analysis_json, published_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                title, content, summary_ar, summary_en, source, source_type,
                url, tickers_json, importance, sentiment, impact_type, market,
                image_paths_json, ocr_text, raw_analysis_json, published_at
            ))
            # get last_insert_rowid
            with db_manager.connection('news', writable=True) as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT last_insert_rowid()')
                news_id = cursor.fetchone()[0]
        except Exception:
            conn = sqlite3.connect(NEWS_AGENT_DB)
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO news_agent_articles (
                    title, content, summary_ar, summary_en, source, source_type,
                    url, tickers_json, importance, sentiment, impact_type, market,
                    image_paths_json, ocr_text, raw_analysis_json, published_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                title, content, summary_ar, summary_en, source, source_type,
                url, tickers_json, importance, sentiment, impact_type, market,
                image_paths_json, ocr_text, raw_analysis_json, published_at
            ))
            conn.commit()
            news_id = cursor.lastrowid
            conn.close()

        # Optional: trigger news impact analysis (if V40_2_NEWS_IMPACT=1)
        # This is done lazily by V40.2 when it next scans, not here.
        return jsonify({
            "success": True,
            "message": "تم استلام الخبر وتخزينه",
            "news_id": news_id,
            "received_at": datetime.now().isoformat(),
            "tickers": json.loads(tickers_json),
            "importance": importance,
            "sentiment": sentiment,
        }), 201

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('/agent/list', methods=['GET'])
def list_news_agent_articles():
    """عرض الأخبار المخزنة من News Agent (للأدمن/التحقق)."""
    try:
        if not check_admin_auth():
            return jsonify({"success": False, "error": "Unauthorized"}), 401

        limit = min(int(request.args.get('limit', 50)), 200)
        offset = int(request.args.get('offset', 0))
        sentiment_filter = request.args.get('sentiment', '')
        ticker_filter = request.args.get('ticker', '').upper()

        init_news_agent_db()
        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            query_str = 'SELECT * FROM news_agent_articles'
            params = []
            conditions = []
            if sentiment_filter:
                conditions.append('sentiment = ?')
                params.append(sentiment_filter)
            if ticker_filter:
                conditions.append('tickers_json LIKE ?')
                params.append(f'%"{ticker_filter}"%')
            if conditions:
                query_str += ' WHERE ' + ' AND '.join(conditions)
            query_str += ' ORDER BY published_at DESC LIMIT ? OFFSET ?'
            params.extend([limit, offset])
            rows = db_manager.query('news', query_str, params)
            total_row = db_manager.query_one('news', 'SELECT COUNT(*) as cnt FROM news_agent_articles')
            total = total_row['cnt'] if total_row else 0
        except Exception:
            conn = sqlite3.connect(NEWS_AGENT_DB)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            query = 'SELECT * FROM news_agent_articles'
            params = []
            conditions = []
            if sentiment_filter:
                conditions.append('sentiment = ?')
                params.append(sentiment_filter)
            if ticker_filter:
                conditions.append('tickers_json LIKE ?')
                params.append(f'%"{ticker_filter}"%')
            if conditions:
                query += ' WHERE ' + ' AND '.join(conditions)
            query += ' ORDER BY published_at DESC LIMIT ? OFFSET ?'
            params.extend([limit, offset])
            rows = [dict(r) for r in cursor.execute(query, params).fetchall()]
            total = cursor.execute('SELECT COUNT(*) FROM news_agent_articles').fetchone()[0]
            conn.close()

        articles = []
        for row in rows:
            articles.append({
                'id': row['id'],
                'title': row['title'],
                'summary_ar': row.get('summary_ar') if isinstance(row, dict) else row['summary_ar'],
                'summary_en': row.get('summary_en') if isinstance(row, dict) else row['summary_en'],
                'source': row.get('source') if isinstance(row, dict) else row['source'],
                'source_type': row.get('source_type') if isinstance(row, dict) else row['source_type'],
                'url': row.get('url') if isinstance(row, dict) else row['url'],
                'tickers': json.loads(row.get('tickers_json', '[]') if isinstance(row, dict) else row['tickers_json']) if (row.get('tickers_json') if isinstance(row, dict) else row['tickers_json']) else [],
                'importance': row.get('importance') if isinstance(row, dict) else row['importance'],
                'sentiment': row.get('sentiment') if isinstance(row, dict) else row['sentiment'],
                'impact_type': row.get('impact_type') if isinstance(row, dict) else row['impact_type'],
                'market': row.get('market') if isinstance(row, dict) else row['market'],
                'image_paths': json.loads(row.get('image_paths_json', '[]') if isinstance(row, dict) else row['image_paths_json']) if (row.get('image_paths_json') if isinstance(row, dict) else row['image_paths_json']) else [],
                'published_at': row.get('published_at') if isinstance(row, dict) else row['published_at'],
                'received_at': row.get('received_at') if isinstance(row, dict) else row['received_at'],
                'processed': row.get('processed') if isinstance(row, dict) else row['processed'],
            })

        return jsonify({
            "success": True,
            "count": len(articles),
            "total": total,
            "articles": articles,
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@news_bp.route('/agent/stats', methods=['GET'])
def news_agent_stats():
    """إحصائيات الأخبار المخزنة من News Agent."""
    try:
        init_news_agent_db()
        # Rule 44 + Rule 54: استخدم db_manager مع news.db canonical
        try:
            from core.db_manager import db_manager
            total_row = db_manager.query_one('news', 'SELECT COUNT(*) as cnt FROM news_agent_articles')
            total = total_row['cnt'] if total_row else 0
            by_sentiment_rows = db_manager.query('news', 'SELECT sentiment, COUNT(*) as cnt FROM news_agent_articles GROUP BY sentiment')
            by_sentiment = {r['sentiment']: r['cnt'] for r in by_sentiment_rows}
            by_source_type_rows = db_manager.query('news', 'SELECT source_type, COUNT(*) as cnt FROM news_agent_articles GROUP BY source_type')
            by_source_type = {r['source_type']: r['cnt'] for r in by_source_type_rows}
            by_market_rows = db_manager.query('news', 'SELECT market, COUNT(*) as cnt FROM news_agent_articles GROUP BY market')
            by_market = {r['market']: r['cnt'] for r in by_market_rows}
            avg_row = db_manager.query_one('news', 'SELECT AVG(importance) as avg FROM news_agent_articles')
            avg_importance = avg_row['avg'] if avg_row and avg_row.get('avg') else 0
            unproc_row = db_manager.query_one('news', 'SELECT COUNT(*) as cnt FROM news_agent_articles WHERE processed = 0')
            unprocessed = unproc_row['cnt'] if unproc_row else 0
            from datetime import datetime, timedelta
            since = (datetime.now() - timedelta(hours=24)).isoformat()
            last24_row = db_manager.query_one('news', 'SELECT COUNT(*) as cnt FROM news_agent_articles WHERE received_at > ?', (since,))
            last_24h = last24_row['cnt'] if last24_row else 0
        except Exception:
            conn = sqlite3.connect(NEWS_AGENT_DB)
            cursor = conn.cursor()
            total = cursor.execute('SELECT COUNT(*) FROM news_agent_articles').fetchone()[0]
            by_sentiment = dict(cursor.execute('SELECT sentiment, COUNT(*) FROM news_agent_articles GROUP BY sentiment').fetchall())
            by_source_type = dict(cursor.execute('SELECT source_type, COUNT(*) FROM news_agent_articles GROUP BY source_type').fetchall())
            by_market = dict(cursor.execute('SELECT market, COUNT(*) FROM news_agent_articles GROUP BY market').fetchall())
            avg_importance = cursor.execute('SELECT AVG(importance) FROM news_agent_articles').fetchone()[0] or 0
            unprocessed = cursor.execute('SELECT COUNT(*) FROM news_agent_articles WHERE processed = 0').fetchone()[0]
            from datetime import datetime, timedelta
            since = (datetime.now() - timedelta(hours=24)).isoformat()
            last_24h = cursor.execute('SELECT COUNT(*) FROM news_agent_articles WHERE received_at > ?', (since,)).fetchone()[0]
            conn.close()

        return jsonify({
            "success": True,
            "total_articles": total,
            "unprocessed": unprocessed,
            "last_24h": last_24h,
            "by_sentiment": by_sentiment,
            "by_source_type": by_source_type,
            "by_market": by_market,
            "avg_importance": round(avg_importance, 1),
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
