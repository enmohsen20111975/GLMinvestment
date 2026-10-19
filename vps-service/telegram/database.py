#!/usr/bin/env python3
"""
Database Module for Telegram Service
=====================================
إدارة قواعد البيانات لتخزين التوقعات والأخبار
"""

import os
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional, Any
from contextlib import contextmanager

# Database paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_DIR = os.path.join(BASE_DIR, 'db')

TELEGRAM_DB = os.path.join(DB_DIR, 'stocks.db')  # Consolidated July 2026
DATA_ENGINE_DB = os.path.join(DB_DIR, 'data_engine.db')


class DatabaseManager:
    """مدير قاعدة البيانات"""

    def __init__(self, db_path: str = TELEGRAM_DB):
        self.db_path = db_path
        self._init_database()

    @contextmanager
    def get_connection(self):
        """الحصول على اتصال بقاعدة البيانات"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_database(self):
        """إنشاء الجداول إذا لم تكن موجودة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()

            # جدول القنوات المتابعة
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS tracked_channels (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT UNIQUE NOT NULL,
                    channel_name TEXT,
                    username TEXT,
                    market TEXT DEFAULT 'unknown',
                    content_type TEXT DEFAULT 'general',
                    is_active INTEGER DEFAULT 1,
                    last_scraped TEXT,
                    total_messages INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # جدول الرسائل المستخرجة
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telegram_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    text TEXT,
                    message_type TEXT DEFAULT 'general',
                    processed_text TEXT,
                    confidence REAL DEFAULT 0,
                    has_images INTEGER DEFAULT 0,
                    image_paths TEXT,
                    image_urls TEXT,
                    is_reply INTEGER DEFAULT 0,
                    reply_to_message_id INTEGER,
                    reply_to_text TEXT,
                    views INTEGER DEFAULT 0,
                    forwards INTEGER DEFAULT 0,
                    date TEXT,
                    scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(message_id, channel_id)
                )
            ''')

            # إضافة الأعمدة الجديدة لو الجدول موجود من قبل (migration)
            try:
                cursor.execute("PRAGMA table_info(telegram_messages)")
                existing_cols = {row[1] for row in cursor.fetchall()}
                new_cols = {
                    'image_urls': 'TEXT',
                    'is_reply': 'INTEGER DEFAULT 0',
                    'reply_to_message_id': 'INTEGER',
                    'reply_to_text': 'TEXT',
                }
                for col, col_type in new_cols.items():
                    if col not in existing_cols:
                        cursor.execute(f'ALTER TABLE telegram_messages ADD COLUMN {col} {col_type}')
            except Exception:
                pass

            # جدول التوقعات المستخرجة
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telegram_recommendations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    symbol TEXT NOT NULL,
                    market TEXT DEFAULT 'unknown',
                    action TEXT,
                    entry_price REAL,
                    target_price REAL,
                    stop_loss REAL,
                    timeframe TEXT,
                    confidence REAL DEFAULT 0,
                    reasoning TEXT,
                    original_text TEXT,
                    expert_name TEXT,
                    is_verified INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # جدول الأخبار المستخرجة
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telegram_news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    title TEXT,
                    content TEXT,
                    market TEXT DEFAULT 'general',
                    sentiment TEXT DEFAULT 'neutral',
                    importance INTEGER DEFAULT 1,
                    symbols_mentioned TEXT,
                    original_text TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # جدول الصور
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS telegram_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    channel_id TEXT NOT NULL,
                    image_path TEXT NOT NULL,
                    ocr_text TEXT,
                    processed INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # جدول حالة السحب
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS scraping_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL UNIQUE,
                    status TEXT DEFAULT 'idle',
                    last_run TEXT,
                    messages_scraped INTEGER DEFAULT 0,
                    recommendations_found INTEGER DEFAULT 0,
                    news_found INTEGER DEFAULT 0,
                    error_message TEXT
                )
            ''')

            conn.commit()
            print("✅ Database initialized successfully")

    # ==================== Channel Management ====================

    def add_channel(self, channel_data: Dict) -> bool:
        """إضافة قناة للمتابعة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute('''
                    INSERT OR REPLACE INTO tracked_channels
                    (channel_id, channel_name, username, market, content_type, is_active)
                    VALUES (?, ?, ?, ?, ?, 1)
                ''', (
                    channel_data.get('channel_id'),
                    channel_data.get('channel_name'),
                    channel_data.get('username'),
                    channel_data.get('market', 'unknown'),
                    channel_data.get('content_type', 'general')
                ))
                conn.commit()
                return True
            except Exception as e:
                print(f"Error adding channel: {e}")
                return False

    def get_tracked_channels(self, active_only: bool = True) -> List[Dict]:
        """الحصول على القنوات المتابعة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if active_only:
                cursor.execute('SELECT * FROM tracked_channels WHERE is_active = 1')
            else:
                cursor.execute('SELECT * FROM tracked_channels')
            return [dict(row) for row in cursor.fetchall()]

    def remove_channel(self, channel_id: str) -> bool:
        """إزالة قناة من المتابعة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('UPDATE tracked_channels SET is_active = 0 WHERE channel_id = ?', (channel_id,))
            conn.commit()
            return cursor.rowcount > 0

    # ==================== Messages ====================

    def save_message(self, message_data: Dict) -> int:
        """حفظ رسالة"""
        import json as _json
        with self.get_connection() as conn:
            cursor = conn.cursor()
            # تحويل image_paths و image_urls لـ JSON string
            image_paths = message_data.get('image_paths', [])
            image_urls = message_data.get('image_urls', [])
            if isinstance(image_paths, list):
                image_paths = _json.dumps(image_paths, ensure_ascii=False)
            if isinstance(image_urls, list):
                image_urls = _json.dumps(image_urls, ensure_ascii=False)

            cursor.execute('''
                INSERT OR REPLACE INTO telegram_messages
                (message_id, channel_id, channel_name, text, message_type, processed_text,
                 confidence, has_images, image_paths, image_urls,
                 is_reply, reply_to_message_id, reply_to_text,
                 views, forwards, date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                message_data.get('message_id'),
                message_data.get('channel_id'),
                message_data.get('channel_name'),
                message_data.get('text'),
                message_data.get('message_type', 'general'),
                message_data.get('processed_text'),
                message_data.get('confidence', 0),
                message_data.get('has_images', 0),
                image_paths,
                image_urls,
                1 if message_data.get('is_reply') else 0,
                message_data.get('reply_to_message_id'),
                message_data.get('reply_to_text'),
                message_data.get('views', 0),
                message_data.get('forwards', 0),
                message_data.get('date')
            ))
            conn.commit()
            return cursor.lastrowid

    # ==================== Recommendations ====================

    def save_recommendation(self, rec_data: Dict) -> int:
        """حفظ توقعة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO telegram_recommendations
                (message_id, channel_id, channel_name, symbol, market, action,
                 entry_price, target_price, stop_loss, timeframe, confidence,
                 reasoning, original_text, expert_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                rec_data.get('message_id'),
                rec_data.get('channel_id'),
                rec_data.get('channel_name'),
                rec_data.get('symbol'),
                rec_data.get('market', 'unknown'),
                rec_data.get('action'),
                rec_data.get('entry_price'),
                rec_data.get('target_price'),
                rec_data.get('stop_loss'),
                rec_data.get('timeframe'),
                rec_data.get('confidence', 0),
                rec_data.get('reasoning'),
                rec_data.get('original_text'),
                rec_data.get('expert_name')
            ))
            conn.commit()
            return cursor.lastrowid

    def get_recommendations(self, market: str = None, limit: int = 50) -> List[Dict]:
        """الحصول على التوقعات"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if market:
                cursor.execute('''
                    SELECT * FROM telegram_recommendations
                    WHERE market = ?
                    ORDER BY created_at DESC LIMIT ?
                ''', (market, limit))
            else:
                cursor.execute('''
                    SELECT * FROM telegram_recommendations
                    ORDER BY created_at DESC LIMIT ?
                ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]

    # ==================== News ====================

    def save_news(self, news_data: Dict) -> int:
        """حفظ خبر تليجرام في stocks.db.telegram_news (schema A).

        DATA-ENGINE-UNIFY-1 / Telegram Phase 1: fixed phantom INSERT.
        Previously tried to INSERT into non-existent columns (message_id,
        channel_id, content, importance, symbols_mentioned, original_text).
        Now uses the actual schema: title, summary, sentiment, symbols,
        raw_text, channel_name, market, date.
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO telegram_news
                (title, summary, sentiment, symbols, raw_text,
                 channel_name, market, date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                news_data.get('title', ''),
                news_data.get('summary', news_data.get('content', '')),
                news_data.get('sentiment', 'neutral'),
                news_data.get('symbols', news_data.get('symbols_mentioned', '')),
                news_data.get('raw_text', news_data.get('original_text', '')),
                news_data.get('channel_name', ''),
                news_data.get('market', 'EGX'),
                news_data.get('date', datetime.now().isoformat()),
            ))
            conn.commit()
            return cursor.lastrowid

    def get_news(self, market: str = None, limit: int = 50) -> List[Dict]:
        """الحصول على الأخبار"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if market:
                cursor.execute('''
                    SELECT * FROM telegram_news
                    WHERE market = ?
                    ORDER BY created_at DESC LIMIT ?
                ''', (market, limit))
            else:
                cursor.execute('''
                    SELECT * FROM telegram_news
                    ORDER BY created_at DESC LIMIT ?
                ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]

    # ==================== Scraping Status ====================

    def update_scraping_status(self, channel_id: str, status: str, stats: Dict = None):
        """تحديث حالة السحب"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO scraping_status (channel_id, status, last_run)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(channel_id) DO UPDATE SET
                    status = excluded.status,
                    last_run = CURRENT_TIMESTAMP,
                    messages_scraped = ?,
                    recommendations_found = ?,
                    news_found = ?,
                    error_message = ?
            ''', (
                channel_id, status,
                stats.get('messages', 0) if stats else 0,
                stats.get('recommendations', 0) if stats else 0,
                stats.get('news', 0) if stats else 0,
                stats.get('error', None) if stats else None
            ))
            conn.commit()

    def get_scraping_status(self) -> List[Dict]:
        """الحصول على حالة السحب"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM scraping_status ORDER BY last_run DESC')
            return [dict(row) for row in cursor.fetchall()]

    # ==================== Statistics ====================

    def get_stats(self) -> Dict:
        """الحصول على إحصائيات"""
        with self.get_connection() as conn:
            cursor = conn.cursor()

            stats = {}

            cursor.execute('SELECT COUNT(*) FROM tracked_channels WHERE is_active = 1')
            stats['active_channels'] = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM telegram_messages')
            stats['total_messages'] = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM telegram_recommendations')
            stats['total_recommendations'] = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM telegram_news')
            stats['total_news'] = cursor.fetchone()[0]

            # By market
            cursor.execute('''
                SELECT market, COUNT(*) as count
                FROM telegram_recommendations
                GROUP BY market
            ''')
            stats['by_market'] = {row[0]: row[1] for row in cursor.fetchall()}

            return stats


# Singleton instance
db_manager = DatabaseManager()
