#!/usr/bin/env python3
"""
Telegram Signal Importer — مستورد التوصيات من جروبات Telegram
================================================================
بيجيب توصيات من جروبات Telegram اللي المستخدم مشترك فيها،
ويحللها ويخزنها كـ training data للنظام.

المصادر:
1. جروبات التوصيات (مجموعة كليرة جداً زي ما المستخدم قال)
2. تحليل كل توصية: نجحت/فشلت بعد N أيام
3. تخزين في telegram_recommendations table
4. ربط مع trade_outcomes للتعلم

Usage:
    from ai.telegram_signal_importer import TelegramSignalImporter
    importer = TelegramSignalImporter()
    importer.import_signals_from_group(group_username, limit=100)
    importer.evaluate_pending_signals()
"""

from __future__ import annotations

import sqlite3
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(_PROJECT_ROOT / "db" / "predictions.db")
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")

# patterns لاستخراج التوصيات من نصوص Telegram
TICKER_PATTERN = re.compile(r'\b([A-Z]{3,5})\b')
PRICE_PATTERN = re.compile(r'(?:دخول|شراء|buy|entry)[\s:]*([\d.]+)', re.IGNORECASE)
TARGET_PATTERN = re.compile(r'(?:هدف|target|take profit)[\s:]*([\d.]+)', re.IGNORECASE)
STOP_PATTERN = re.compile(r'(?:وقف|stop|stop loss)[\s:]*([\d.]+)', re.IGNORECASE)
SIGNAL_PATTERN = re.compile(r'(شراء|بيع|BUY|SELL|HOLD|STRONG_BUY|STRONG_SELL)', re.IGNORECASE)


@dataclass
class TelegramSignal:
    """توصية من جروب Telegram."""
    ticker: str
    signal_type: str          # BUY / SELL / HOLD
    entry_price: Optional[float]
    target_price: Optional[float]
    stop_loss: Optional[float]
    message_text: str
    message_date: str
    group_username: str
    source: str               # group name
    raw_data: Dict


class TelegramSignalImporter:
    """يجيب توصيات من جروبات Telegram ويحللها."""

    def __init__(self):
        self.predictions_db = PREDICTIONS_DB
        self.stocks_db = STOCKS_DB
        self._ensure_schema()

    def _ensure_schema(self):
        """يتأكد إن الـ tables موجودة.

        ملاحظة (يوليو 2026): بدل ما نعمل table جديد، بنستخدم
        telegram_recommendations الموجودة (من telegram/database.py)
        + نضيف columns للـ evaluation لو مش موجودة.

        BRIEF-042: أضفنا جدولين جديدين:
        - telegram_news: أخبار الشركات (أرباح، كوبون، استحواذ)
        - telegram_signals: توصيات/لقلق (فريش، ادخل، هدف، وقف)
        """
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db)

            # الـ table الرئيسي موجود (telegram_recommendations)
            # بس نضيف columns للـ evaluation لو مش موجودة
            try:
                existing_cols = {row[1] for row in conn.execute(
                    "PRAGMA table_info(telegram_recommendations)"
                ).fetchall()}

                migrations = [
                    ('evaluated', 'INTEGER DEFAULT 0'),
                    ('outcome', 'TEXT'),
                    ('exit_price', 'REAL'),
                    ('actual_return', 'REAL'),
                    ('evaluation_date', 'TEXT'),
                    ('holding_days', 'INTEGER'),
                    ('pattern_type', 'TEXT'),
                    ('keywords', 'TEXT'),
                ]

                for col, col_type in migrations:
                    if col not in existing_cols:
                        try:
                            conn.execute(
                                f"ALTER TABLE telegram_recommendations ADD COLUMN {col} {col_type}"
                            )
                        except Exception:
                            pass
                conn.commit()
            except Exception:
                # الـ table مش موجودة — الـ telegram/database.py هيعملها
                pass

            # BRIEF-042: جدولين جديدين للـ AI pipeline
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS telegram_news (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker TEXT,
                        message_text TEXT NOT NULL,
                        sentiment TEXT DEFAULT 'neutral',
                        confidence INTEGER DEFAULT 50,
                        source_group TEXT,
                        message_date TEXT,
                        created_at TEXT DEFAULT (datetime('now'))
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_tg_news_ticker_date
                    ON telegram_news(ticker, message_date)
                """)
            except Exception:
                pass

            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS telegram_signals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker TEXT,
                        message_text TEXT NOT NULL,
                        sentiment TEXT DEFAULT 'neutral',
                        confidence INTEGER DEFAULT 50,
                        source_group TEXT,
                        message_date TEXT,
                        created_at TEXT DEFAULT (datetime('now'))
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_tg_sig_ticker_date
                    ON telegram_signals(ticker, message_date)
                """)
            except Exception:
                pass

            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Schema error: {e}")

    # BRIEF-042: ─── AI Pipeline (Keyword Filter + Ollama) ─────────────

    NEWS_KEYWORDS = [
        'أرباح', 'كوبون', 'استحواذ', 'مجلس إدارة', 'بنك مركزي',
        'توزيعات', 'قوائم مالية', 'تقرير', 'إفصاح', 'اجتماع',
        'ربحية', 'خسارة', 'ديون', 'زيادة رأس مال',
    ]

    PICK_KEYWORDS = [
        'فريش', 'ادخل', 'سهم الشوط', 'تصريف', 'تجميع', 'هدف', 'وقف',
        'شراء', 'بيع', 'دخول', 'خروج', 'وقف خسارة', 'جني أرباح',
        'هدف أول', 'هدف ثاني', 'بقى', 'يا جماعة',
    ]

    def classify_message(self, text: str) -> str:
        """BRIEF-042: فلترة أولية (keyword-based) قبل الـ AI.

        Returns: 'news' | 'pick' | 'unknown'
        """
        text_lower = text.lower()
        news_hits = sum(1 for kw in self.NEWS_KEYWORDS if kw in text_lower)
        pick_hits = sum(1 for kw in self.PICK_KEYWORDS if kw in text_lower)
        if news_hits > pick_hits:
            return 'news'
        if pick_hits > 0:
            return 'pick'
        return 'unknown'

    def process_message_with_ai(self, text: str, group_username: str = '',
                                 message_date: str = '') -> Dict:
        """BRIEF-042: بايبلاين كامل — فلترة + AI (Ollama) + تخزين.

        1. فلترة أولية (keyword-based)
        2. استدعاء Ollama glm-fast لاستخراج {ticker, type, sentiment, confidence}
        3. تخزين في telegram_news أو telegram_signals
        """
        from datetime import datetime
        result = {
            'success': False,
            'type': 'unknown',
            'ticker': None,
            'sentiment': 'neutral',
            'confidence': 50,
            'stored': False,
        }

        if not text or len(text.strip()) < 10:
            return result

        # 1. فلترة أولية
        msg_type = self.classify_message(text)
        if msg_type == 'unknown':
            return result
        result['type'] = msg_type

        # 2. استدعاء Ollama (مع fallback آمن)
        try:
            from ai.glm_finance_agent import GlmFinanceAgent
            agent = GlmFinanceAgent()
            prompt = (
                f"أنت محلل مالي. اقرأ النص التالي واستخرج البيانات في JSON صارم: "
                f'{{"ticker": "رمز_السهم", "type": "news|pick", '
                f'"sentiment": "positive|negative|neutral", "confidence": 0-100}}. '
                f"النص: {text[:500]}"
            )
            raw = agent.call_fast(prompt, max_tokens=200, temperature=0.2)  # QWEN-UNIFY
            if raw:
                import json as _json
                # استخراج JSON من الرد
                try:
                    start = raw.find('{')
                    end = raw.rfind('}') + 1
                    if start >= 0 and end > start:
                        parsed = _json.loads(raw[start:end])
                        result['ticker'] = parsed.get('ticker', '').upper() or None
                        result['type'] = parsed.get('type', msg_type) or msg_type
                        result['sentiment'] = parsed.get('sentiment', 'neutral')
                        result['confidence'] = int(parsed.get('confidence', 50))
                        result['success'] = True
                except (_json.JSONDecodeError, ValueError):
                    # fallback: استخدم الـ keyword classification
                    result['success'] = True
            else:
                result['success'] = True  # الـ AI مش متاح، نكمل بـ keyword
        except Exception as _ai_e:
            logger.debug(f"Ollama AI failed (using keyword fallback): {_ai_e}")
            result['success'] = True  # fallback

        # 3. تخزين في DB
        if result['success']:
            try:
                try:
                    from core.db_manager import db_manager
                    conn = db_manager.connection('predictions', writable=True).__enter__()
                except Exception:
                    conn = sqlite3.connect(self.predictions_db)
                table = 'telegram_news' if result['type'] == 'news' else 'telegram_signals'
                conn.execute(
                    f"""INSERT INTO {table} (ticker, message_text, sentiment, confidence, source_group, message_date)
                        VALUES (?, ?, ?, ?, ?, ?)""",
                    (result['ticker'], text[:2000], result['sentiment'],
                     result['confidence'], group_username,
                     message_date or datetime.now().isoformat()),
                )
                conn.commit()
                conn.close()
                result['stored'] = True
            except Exception as _db_e:
                logger.debug(f"Telegram message store failed: {_db_e}")

        return result

    def get_recent_signals_for_ticker(self, ticker: str, hours: int = 24) -> Dict:
        """BRIEF-042: يجلب آخر signals + news للسهم من آخر X ساعة.

        Returns: {news: [...], picks: [...], sentiment_score: float}
        """
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        result = {'news': [], 'picks': [], 'sentiment_score': 0.0}
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db)
            conn.row_factory = sqlite3.Row

            news_rows = conn.execute(
                """SELECT * FROM telegram_news
                   WHERE ticker = ? AND created_at >= ?
                   ORDER BY created_at DESC LIMIT 10""",
                (ticker.upper(), cutoff),
            ).fetchall()
            result['news'] = [dict(r) for r in news_rows]

            pick_rows = conn.execute(
                """SELECT * FROM telegram_signals
                   WHERE ticker = ? AND created_at >= ?
                   ORDER BY created_at DESC LIMIT 10""",
                (ticker.upper(), cutoff),
            ).fetchall()
            result['picks'] = [dict(r) for r in pick_rows]

            # حساب sentiment_score: positive=+1, negative=-1, neutral=0
            score = 0.0
            for n in result['news']:
                if n.get('sentiment') == 'positive':
                    score += 1
                elif n.get('sentiment') == 'negative':
                    score -= 1
            for p in result['picks']:
                if p.get('sentiment') == 'positive':
                    score += 0.5
                elif p.get('sentiment') == 'negative':
                    score -= 0.5
            result['sentiment_score'] = score

            conn.close()
        except Exception as _e:
            logger.debug(f"get_recent_signals failed: {_e}")

        return result

    # ─── Parse Telegram Message ─────────────────────────────────────────

    def parse_signal_message(self, text: str, group_username: str = '', message_date: str = '') -> Optional[TelegramSignal]:
        """يحلل نص توصية من Telegram ويستخرج البيانات.

        أمثلة للنصوص اللي بيقراها:
        - "توصية شراء COMI دخول 25.50 هدف 28 وقف 24"
        - "BUY EFID entry 10.5 target 12 stop 9.5"
        - "DCRC بيع فوق 30"
        """
        if not text or len(text) < 5:
            return None

        # استخراج الـ ticker (أول كلمة uppercase 3-5 حروف)
        tickers = TICKER_PATTERN.findall(text)
        if not tickers:
            return None

        # فلترة الـ tickers المعروفة (في stocks.db)
        ticker = self._validate_ticker(tickers[0])
        if not ticker:
            return None

        # استخراج signal type
        signal_match = SIGNAL_PATTERN.search(text)
        signal_type = 'BUY'  # default
        if signal_match:
            s = signal_match.group(1).upper()
            if 'SELL' in s or 'بيع' in s:
                signal_type = 'SELL'
            elif 'BUY' in s or 'شراء' in s:
                signal_type = 'BUY'

        # استخراج الأسعار
        entry_price = None
        target_price = None
        stop_loss = None

        entry_match = PRICE_PATTERN.search(text)
        if entry_match:
            try:
                entry_price = float(entry_match.group(1))
            except ValueError:
                pass

        target_match = TARGET_PATTERN.search(text)
        if target_match:
            try:
                target_price = float(target_match.group(1))
            except ValueError:
                pass

        stop_match = STOP_PATTERN.search(text)
        if stop_match:
            try:
                stop_loss = float(stop_match.group(1))
            except ValueError:
                pass

        # pattern detection من النص
        pattern_type = self._detect_pattern(text)

        # confidence score من جودة النص
        confidence = self._calculate_confidence(text, entry_price, target_price, stop_loss)

        return TelegramSignal(
            ticker=ticker,
            signal_type=signal_type,
            entry_price=entry_price,
            target_price=target_price,
            stop_loss=stop_loss,
            message_text=text,
            message_date=message_date or datetime.now().isoformat(),
            group_username=group_username,
            source=group_username or 'telegram_group',
            raw_data={
                'pattern': pattern_type,
                'confidence': confidence,
                'keywords': self._extract_keywords(text),
            }
        )

    def _validate_ticker(self, ticker: str) -> Optional[str]:
        """يتأكد إن الـ ticker موجود في stocks.db."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.stocks_db)
            cursor = conn.cursor()
            cursor.execute("SELECT ticker FROM stocks WHERE ticker = ?", (ticker.upper(),))
            row = cursor.fetchone()
            conn.close()
            return ticker.upper() if row else None
        except Exception:
            return ticker.upper()  # لو الـ DB مش موجود، قبل الـ ticker

    def _detect_pattern(self, text: str) -> str:
        """يكتشف نوع النمط من النص."""
        text_lower = text.lower()
        if any(w in text_lower for w in ['breakout', 'اختراق', 'كسر']):
            return 'breakout'
        if any(w in text_lower for w in ['reversal', 'ارتداد']):
            return 'reversal'
        if any(w in text_lower for w in ['momentum', 'زخم']):
            return 'momentum'
        if any(w in text_lower for w in ['support', 'دعم']):
            return 'support_bounce'
        if any(w in text_lower for w in ['accumulation', 'تجميع']):
            return 'accumulation'
        return 'unknown'

    def _calculate_confidence(self, text: str, entry: float, target: float, stop: float) -> int:
        """يحسب ثقة التوصية من جودة البيانات."""
        score = 50
        if entry and entry > 0:
            score += 10
        if target and target > 0:
            score += 10
        if stop and stop > 0:
            score += 10
        if entry and target and stop and entry > 0:
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                rr = compute_risk_reward(entry, target, stop, fallback=0.0)
            except Exception:
                rr = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
            if rr >= 2.0:
                score += 15
            elif rr >= 1.5:
                score += 10
            elif rr >= 1.0:
                score += 5
        if len(text) > 50:
            score += 5  # نص مفصّل
        return min(100, max(0, score))

    def _extract_keywords(self, text: str) -> str:
        """يستخرج كلمات مفتاحية من النص."""
        keywords = []
        text_lower = text.lower()
        for kw in ['breakout', 'اختراق', 'reversal', 'ارتداد', 'momentum', 'زخم',
                   'support', 'دعم', 'resistance', 'مقاومة', 'volume', 'حجم',
                   'rsi', 'macd', 'buy', 'شراء', 'sell', 'بيع']:
            if kw in text_lower:
                keywords.append(kw)
        return ','.join(keywords)

    # ─── Store Signal ────────────────────────────────────────────────────

    def store_signal(self, signal: TelegramSignal) -> int:
        """يخزن توصية في telegram_recommendations table (الموجودة)."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db)
            cur = conn.cursor()
            # بنستخدم telegram_recommendations الموجودة + الـ columns الجديدة
            cur.execute("""
                INSERT INTO telegram_recommendations
                    (symbol, market, action, entry_price, target_price, stop_loss,
                     original_text, channel_name, channel_id,
                     confidence, pattern_type, keywords, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (
                signal.ticker,
                'egypt',
                signal.signal_type,
                signal.entry_price,
                signal.target_price,
                signal.stop_loss,
                signal.message_text,
                signal.group_username,
                signal.group_username,
                signal.raw_data.get('confidence', 50),
                signal.raw_data.get('pattern', 'unknown'),
                signal.raw_data.get('keywords', ''),
            ))
            conn.commit()
            signal_id = cur.lastrowid
            conn.close()
            return signal_id
        except Exception as e:
            logger.error(f"Store signal error: {e}")
            return 0

    # ─── Import from Telegram Group ─────────────────────────────────────

    def import_signals_from_group(self, group_username: str, limit: int = 100) -> Dict:
        """يجيب توصيات من جروب Telegram.

        محتاج TelegramClient متصل. لو مش متصل، بيرجّع error.
        """
        try:
            import sys
            import os
            _vps = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if _vps not in sys.path:
                sys.path.insert(0, _vps)

            from telegram.telegram_client import TelegramClientManager

            manager = TelegramClientManager()
            connect_result = manager.connect()
            if connect_result.get('error'):
                return {
                    'success': False,
                    'error': f"Telegram مش متصل: {connect_result['error']}",
                    'imported': 0,
                }

            # جيب آخر N رسائل من الجروب
            messages = manager.get_messages(group_username, limit=limit)
            if not messages:
                return {
                    'success': False,
                    'error': 'مفيش رسائل في الجروب',
                    'imported': 0,
                }

            imported = 0
            skipped = 0
            for msg in messages:
                text = msg.get('text', '')
                date = msg.get('date', '')

                signal = self.parse_signal_message(text, group_username, date)
                if signal:
                    self.store_signal(signal)
                    imported += 1
                else:
                    skipped += 1

            return {
                'success': True,
                'group': group_username,
                'total_messages': len(messages),
                'imported': imported,
                'skipped': skipped,
            }
        except Exception as e:
            logger.error(f"Import signals error: {e}")
            return {
                'success': False,
                'error': str(e),
                'imported': 0,
            }

    # ─── Evaluate Pending Signals ───────────────────────────────────────

    def evaluate_pending_signals(self, days_back: int = 7) -> Dict:
        """يقيّم التوصيات اللي مرّ عليها N أيام.

        لكل توصية:
        1. يجيب سعر السهم في تاريخ التوصية (entry_price)
        2. يجيب السعر بعد N أيام
        3. يحسب: hit_target / hit_stop / expired
        4. يحدّث outcome + actual_return
        """
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db)
            conn.row_factory = sqlite3.Row

            # التوصيات اللي لسه متقيّمة
            pending = conn.execute("""
                SELECT * FROM telegram_recommendations
                WHERE evaluated = 0
                AND created_at < datetime('now', ?)
                ORDER BY created_at DESC
                LIMIT 100
            """, (f'-{days_back} days',)).fetchall()

            if not pending:
                conn.close()
                return {'success': True, 'evaluated': 0, 'message': 'مفيش توصيات منتظرة'}

            evaluated = 0
            wins = 0
            losses = 0

            for sig in pending:
                sig = dict(sig)
                ticker = sig.get('symbol', '')
                entry = sig.get('entry_price')
                target = sig.get('target_price')
                stop = sig.get('stop_loss')
                msg_date = sig.get('message_date', '')

                if not entry or entry <= 0:
                    continue

                # جيب السعر بعد N أيمن تاريخ التوصية
                exit_price = self._get_price_after_days(ticker, msg_date, days_back)

                if not exit_price or exit_price <= 0:
                    # مفيش price data — skip
                    continue

                # حساب النتيجة
                if target and stop:
                    if exit_price >= target:
                        outcome = 'WIN'
                        wins += 1
                    elif exit_price <= stop:
                        outcome = 'LOSS'
                        losses += 1
                    else:
                        outcome = 'BREAKEVEN'
                else:
                    # لو مفيش target/stop، احسب بناءً على direction
                    if sig.get('signal_type') == 'BUY':
                        outcome = 'WIN' if exit_price > entry else 'LOSS'
                    else:
                        outcome = 'WIN' if exit_price < entry else 'LOSS'
                    if outcome == 'WIN':
                        wins += 1
                    else:
                        losses += 1

                actual_return = ((exit_price - entry) / entry) * 100 if sig.get('signal_type') == 'BUY' else ((entry - exit_price) / entry) * 100

                # تحديث الـ record
                conn.execute("""
                    UPDATE telegram_recommendations
                    SET evaluated = 1,
                        outcome = ?,
                        exit_price = ?,
                        actual_return = ?,
                        evaluation_date = datetime('now'),
                        holding_days = ?
                    WHERE id = ?
                """, (
                    outcome,
                    exit_price,
                    round(actual_return, 2),
                    days_back,
                    sig.get('id'),
                ))
                evaluated += 1

            conn.commit()
            conn.close()

            win_rate = round(wins / evaluated * 100, 1) if evaluated > 0 else 0

            return {
                'success': True,
                'evaluated': evaluated,
                'wins': wins,
                'losses': losses,
                'win_rate': win_rate,
            }
        except Exception as e:
            logger.error(f"Evaluate signals error: {e}")
            return {'success': False, 'error': str(e), 'evaluated': 0}

    def _get_price_after_days(self, ticker: str, date_str: str, days: int) -> Optional[float]:
        """يجيب سعر السهم بعد N أيام من تاريخ معيّن."""
        try:
            from pathlib import Path
            _root = Path(__file__).resolve().parent.parent.parent
            _price_db = str(_root / 'db' / 'price_history.db')

            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('price_history', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(_price_db)
            conn.row_factory = sqlite3.Row

            # حوّل التاريخ لـ YYYY-MM-DD
            target_date = date_str[:10] if date_str else ''

            try:
                rows = conn.execute("""
                    SELECT close_price FROM price_history
                    WHERE ticker = ? AND date >= ?
                    ORDER BY date ASC LIMIT ?
                """, (ticker.upper(), target_date, days + 5)).fetchall()
                if rows and len(rows) > days:
                    return float(rows[days]['close_price'])
            except Exception:
                try:
                    rows = conn.execute("""
                        SELECT close as close_price FROM stock_daily_prices
                        WHERE ticker = ? AND price_date >= ?
                        ORDER BY price_date ASC LIMIT ?
                    """, (ticker.upper(), target_date, days + 5)).fetchall()
                    if rows and len(rows) > days:
                        return float(rows[days]['close_price'])
                except Exception:
                    pass

            conn.close()
            return None
        except Exception:
            return None

    # ─── Stats ──────────────────────────────────────────────────────────

    def get_stats(self) -> Dict:
        """إحصائيات التوصيات المستوردة."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db)
            conn.row_factory = sqlite3.Row

            total = conn.execute("SELECT COUNT(*) FROM telegram_recommendations").fetchone()[0]
            evaluated = conn.execute("SELECT COUNT(*) FROM telegram_recommendations WHERE evaluated=1").fetchone()[0]
            pending = conn.execute("SELECT COUNT(*) FROM telegram_recommendations WHERE evaluated=0").fetchone()[0]

            by_outcome = conn.execute("""
                SELECT outcome, COUNT(*) as cnt, AVG(actual_return) as avg_ret
                FROM telegram_recommendations WHERE evaluated=1
                GROUP BY outcome
            """).fetchall()

            by_pattern = conn.execute("""
                SELECT pattern_type, COUNT(*) as cnt,
                       SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins
                FROM telegram_recommendations WHERE evaluated=1
                GROUP BY pattern_type ORDER BY cnt DESC
            """).fetchall()

            by_group = conn.execute("""
                SELECT group_username, COUNT(*) as cnt,
                       SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins
                FROM telegram_recommendations WHERE evaluated=1
                GROUP BY channel_name ORDER BY cnt DESC
            """).fetchall()

            conn.close()

            return {
                'total_signals': total,
                'evaluated': evaluated,
                'pending': pending,
                'by_outcome': [dict(r) for r in by_outcome],
                'by_pattern': [dict(r) for r in by_pattern],
                'by_group': [dict(r) for r in by_group],
            }
        except Exception as e:
            logger.error(f"Stats error: {e}")
            return {'error': str(e)}


# ─── CLI ────────────────────────────────────────────────────────────────

def main():
    """للتشغيل اليدوي."""
    import sys
    import json
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    importer = TelegramSignalImporter()

    if len(sys.argv) > 1 and sys.argv[1] == "stats":
        stats = importer.get_stats()
        print(json.dumps(stats, indent=2, ensure_ascii=False, default=str))
        return

    if len(sys.argv) > 1 and sys.argv[1] == "evaluate":
        result = importer.evaluate_pending_signals(days_back=7)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    if len(sys.argv) > 1 and sys.argv[1] == "import" and len(sys.argv) > 2:
        group = sys.argv[2]
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 100
        result = importer.import_signals_from_group(group, limit)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    print("Usage:")
    print("  python3 ai/telegram_signal_importer.py import <group_username> [limit]")
    print("  python3 ai/telegram_signal_importer.py evaluate")
    print("  python3 ai/telegram_signal_importer.py stats")


if __name__ == "__main__":
    main()
