"""
Expert Memory Engine V4 - ذاكرة المحلل الشخصية
=============================================

الفرق عن V3:
- V3: يتعلم من "sector + rsi_bucket + month" (نظري)
- V4: يتعلم من "دعم/ارتداد + T+1 + مستويات الدعم" (من بياناتك)

Features:
- pattern_type: نمط التداول (دعم/ارتداد، T+1، شراء واحتفاظ)
- support/resistance levels: مستويات الدعم والمقاومة
- personal win rate: نسبة نجاحك الشخصية
- similar cases: حالات مشابهة من تاريخك

@authorM2yDevelopers Team
@version 4.0.0 - Personal Trading Memory
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
import sqlite3
import json
import math


@dataclass
class PatternRecord:
    """سجل نمط تداول"""
    id: Optional[int] = None
    ticker: str = ""
    ticker_name: str = ""
    pattern_type: str = ""  # دعم/ارتداد، T+1، شراء واحتفاظ، اختراق
    entry_price: float = 0.0
    target_1: Optional[float] = None
    target_2: Optional[float] = None
    stop_loss: Optional[float] = None
    support_level: Optional[float] = None
    resistance_level: Optional[float] = None
    timeframe: str = "غير محدد"  # T+1، أسبوع، شهر
    market_regime: str = "unknown"  # bull, bear, range
    outcome: str = "open"  # win, loss, neutral, open
    pnl_pct: Optional[float] = None
    trade_date: Optional[str] = None
    close_date: Optional[str] = None
    notes: str = ""
    analyst_id: str = "default"
    sector: str = ""
    created_at: Optional[str] = None


@dataclass
class AnalystInsight:
    """نتيجة البحث في ذاكرة المحلل"""
    ticker: str = ""
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    open_positions: int = 0
    win_rate: float = 0.0
    avg_pnl: float = 0.0
    best_pattern: str = ""
    best_pattern_win_rate: float = 0.0
    worst_pattern: str = ""
    worst_pattern_win_rate: float = 0.0
    favorite_support: Optional[float] = None
    avg_holding_days: float = 0.0
    similar_cases: List[Dict] = field(default_factory=list)
    suggestion: str = ""
    confidence: float = 0.0
    pattern_breakdown: Dict = field(default_factory=dict)


@dataclass
class PatternStats:
    """إحصائيات نمط معين"""
    pattern_type: str = ""
    ticker: str = ""
    count: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    avg_pnl: float = 0.0
    avg_holding_days: float = 0.0
    best_support: Optional[float] = None
    worst_support: Optional[float] = None
    last_updated: Optional[str] = None


class ExpertMemoryV4:
    """
    محرك الذاكرة الخبيرة V4
    يتعلم من صفقاتك الحقيقية ويقترح بناءً على تاريخك
    """

    # الأنماط المدعومة
    PATTERN_TYPES = [
        "دعم / ارتداد",
        "شراء واحتفاظ",
        "T+1 / مضاربة",
        "مضاربة لحظية",
        "اختراق",
        "تريدة T+1",
        "BUY",
        "SELL",
        "AVG_BUY",
        "ACCUMULATE",
        "HOLD"
    ]

    # تحويل الأنماط للتوحيد
    PATTERN_MAPPING = {
        "دعم / ارتداد": "دعم/ارتداد",
        "دعم/ارتداد": "دعم/ارتداد",
        "شراء واحتفاظ": "شراء واحتفاظ",
        "T+1 / مضاربة": "T+1",
        "تريدة T+1": "T+1",
        "مضاربة لحظية": "مضاربة",
        "BUY": "شراء",
        "SELL": "بيع",
        "AVG_BUY": "توسيط",
        "ACCUMULATE": "تجميع",
        "HOLD": "احتفاظ"
    }

    # Timeframes
    TIMEFRAMES = {
        "T+1": 1,
        "أسبوع": 7,
        "شهر": 30,
        "استثمار": 90
    }

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_tables()

    def get_connection(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _ensure_tables(self):
        """إنشاء الجداول المطلوبة"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # جدول الأنماط الرئيسي
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS v4_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                ticker_name TEXT,
                pattern_type TEXT NOT NULL,
                pattern_normalized TEXT,
                entry_price REAL,
                target_1 REAL,
                target_2 REAL,
                stop_loss REAL,
                support_level REAL,
                resistance_level REAL,
                timeframe TEXT DEFAULT 'غير محدد',
                market_regime TEXT DEFAULT 'unknown',
                outcome TEXT DEFAULT 'open',
                pnl_pct REAL,
                trade_date TEXT,
                close_date TEXT,
                notes TEXT,
                analyst_id TEXT DEFAULT 'default',
                sector TEXT,
                source_table TEXT DEFAULT 'manual',
                source_id TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT
            )
        ''')

        # جدول الإحصائيات المجمعة
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS v4_pattern_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern_type TEXT NOT NULL,
                pattern_normalized TEXT NOT NULL,
                ticker TEXT DEFAULT 'ALL',
                sector TEXT DEFAULT 'ALL',
                count INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                open_count INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                avg_pnl REAL DEFAULT 0,
                avg_holding_days REAL DEFAULT 0,
                best_support REAL,
                worst_support REAL,
                total_pnl REAL DEFAULT 0,
                last_updated TEXT,
                UNIQUE(pattern_normalized, ticker, sector)
            )
        ''')

        # إنشاء الفهارس
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_v4_ticker ON v4_patterns(ticker)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_v4_pattern ON v4_patterns(pattern_normalized)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_v4_outcome ON v4_patterns(outcome)')

        conn.commit()
        conn.close()

    def normalize_pattern(self, pattern: str) -> str:
        """توحيد اسم النمط"""
        return self.PATTERN_MAPPING.get(pattern, pattern)

    def calculate_pnl(self, entry: float, exit_price: float, is_buy: bool = True) -> float:
        """حساب نسبة الربح/الخسارة"""
        if entry <= 0:
            return 0.0
        if is_buy:
            return ((exit_price - entry) / entry) * 100
        else:
            return ((entry - exit_price) / entry) * 100

    def determine_outcome(self, pnl: float, hit_target: bool, hit_stop: bool) -> str:
        """تحديد نتيجة الصفقة"""
        if hit_target:
            return "win"
        if hit_stop:
            return "loss"
        if pnl is not None:
            if pnl > 0.5:
                return "win"
            elif pnl < -0.5:
                return "loss"
            else:
                return "neutral"
        return "open"

    # ==================== RECORD OPERATIONS ====================

    def record_trade(self, record: PatternRecord) -> int:
        """
        تسجيل صفقة جديدة
        Returns: ID of the inserted record
        """
        normalized = self.normalize_pattern(record.pattern_type)

        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO v4_patterns (
                ticker, ticker_name, pattern_type, pattern_normalized,
                entry_price, target_1, target_2, stop_loss,
                support_level, resistance_level, timeframe, market_regime,
                outcome, pnl_pct, trade_date, close_date, notes,
                analyst_id, sector, source_table, source_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            record.ticker, record.ticker_name, record.pattern_type, normalized,
            record.entry_price, record.target_1, record.target_2, record.stop_loss,
            record.support_level, record.resistance_level, record.timeframe, record.market_regime,
            record.outcome, record.pnl_pct, record.trade_date, record.close_date, record.notes,
            record.analyst_id, record.sector, "manual", None, datetime.now().isoformat()
        ))

        record_id = cursor.lastrowid

        # تحديث الإحصائيات
        self._update_stats(record.ticker, normalized, record.sector or "ALL")

        conn.commit()
        conn.close()

        return record_id

    def record_trade_from_expert_recommendation(self, rec: Dict) -> int:
        """
        تسجيل صفقة من جدول expertRecommendation
        """
        # تحديد النتيجة
        status = rec.get('status', 'PENDING')
        hit_target = rec.get('hit_target', 0)
        hit_stop = rec.get('hit_stop_loss', 0)
        pnl = rec.get('profit_loss_percent')

        outcome_map = {
            'SUCCESS': 'win',
            'TARGET_HIT': 'win',
            'CLOSED': 'neutral' if pnl is None else ('win' if pnl > 0 else 'loss'),
            'ACTIVE': 'open',
            'PENDING': 'open'
        }

        outcome = outcome_map.get(status, 'open')

        # إذاhit_target = 1، فهو فوز
        if hit_target == 1:
            outcome = 'win'
        elif hit_stop == 1:
            outcome = 'loss'

        record = PatternRecord(
            ticker=rec.get('stock_symbol', ''),
            ticker_name=rec.get('stock_name_ar', ''),
            pattern_type=rec.get('action', ''),
            entry_price=rec.get('entry_price') or 0,
            target_1=rec.get('target_price'),
            target_2=rec.get('target_price_2'),
            stop_loss=rec.get('stop_loss'),
            support_level=rec.get('support_level'),
            resistance_level=rec.get('resistance_level'),
            outcome=outcome,
            pnl_pct=pnl,
            trade_date=rec.get('recommendation_date'),
            close_date=rec.get('closed_at'),
            notes=rec.get('notes') or '',
            sector=rec.get('sector', ''),
            created_at=rec.get('created_at')
        )

        record.pattern_normalized = self.normalize_pattern(record.pattern_type)

        # حفظ مباشرة في قاعدة البيانات
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO v4_patterns (
                ticker, ticker_name, pattern_type, pattern_normalized,
                entry_price, target_1, target_2, stop_loss,
                support_level, resistance_level, outcome, pnl_pct,
                trade_date, close_date, notes, sector, source_table, source_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            record.ticker, record.ticker_name, record.pattern_type, record.pattern_normalized,
            record.entry_price, record.target_1, record.target_2, record.stop_loss,
            record.support_level, record.resistance_level, record.outcome, record.pnl_pct,
            record.trade_date, record.close_date, record.notes, record.sector,
            'expertRecommendation', rec.get('id'), record.created_at
        ))

        record_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return record_id

    def update_trade_outcome(self, trade_id: int, outcome: str, pnl_pct: float,
                             close_date: str = None, notes: str = None) -> bool:
        """
        تحديث نتيجة صفقة
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE v4_patterns
            SET outcome = ?, pnl_pct = ?, close_date = ?,
                notes = COALESCE(?, notes), updated_at = ?
            WHERE id = ?
        ''', (outcome, pnl_pct, close_date or datetime.now().isoformat(),
              notes, datetime.now().isoformat(), trade_id))

        success = cursor.rowcount > 0

        if success:
            # تحديث الإحصائيات
            cursor.execute('SELECT ticker, pattern_normalized, sector FROM v4_patterns WHERE id = ?', (trade_id,))
            row = cursor.fetchone()
            if row:
                self._update_stats(row[0], row[1], row[2] or "ALL")

        conn.commit()
        conn.close()

        return success

    def _update_stats(self, ticker: str, pattern_normalized: str, sector: str):
        """تحديث إحصائيات النمط"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # حساب الإحصائيات
        cursor.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN outcome = 'open' THEN 1 ELSE 0 END) as open_count,
                AVG(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct ELSE NULL END) as avg_pnl,
                SUM(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct ELSE 0 END) as total_pnl
            FROM v4_patterns
            WHERE ticker = ? AND pattern_normalized = ?
        ''', (ticker, pattern_normalized))

        stats = cursor.fetchone()
        if stats and stats[0] > 0:
            total, wins, losses, open_count, avg_pnl, total_pnl = stats
            win_rate = (wins / (wins + losses)) if (wins + losses) > 0 else 0

            # Upsert
            cursor.execute('''
                INSERT INTO v4_pattern_stats (
                    pattern_type, pattern_normalized, ticker, sector,
                    count, wins, losses, open_count, win_rate, avg_pnl, total_pnl, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(pattern_normalized, ticker, sector) DO UPDATE SET
                    count = excluded.count,
                    wins = excluded.wins,
                    losses = excluded.losses,
                    open_count = excluded.open_count,
                    win_rate = excluded.win_rate,
                    avg_pnl = excluded.avg_pnl,
                    total_pnl = excluded.total_pnl,
                    last_updated = excluded.last_updated
            ''', (pattern_normalized, pattern_normalized, ticker, sector,
                  total, wins or 0, losses or 0, open_count or 0, win_rate,
                  avg_pnl or 0, total_pnl or 0, datetime.now().isoformat()))

        conn.commit()
        conn.close()

    # ==================== QUERY OPERATIONS ====================

    def get_analyst_insight(self, ticker: str, current_price: float = None,
                            support: float = None, resistance: float = None) -> AnalystInsight:
        """
        الحصول على رؤية المحلل لسهم معين
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        # 1. إحصائيات عامة للسهم
        cursor.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN outcome = 'open' THEN 1 ELSE 0 END) as open_positions,
                AVG(CASE WHEN pnl_pct IS NOT NULL THEN pnl_pct ELSE NULL END) as avg_pnl
            FROM v4_patterns
            WHERE ticker = ?
        ''', (ticker,))

        general = cursor.fetchone()

        # 2. أفضل وأسوأ نمط
        cursor.execute('''
            SELECT pattern_normalized, COUNT(*) as cnt,
                   SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins,
                   SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) as losses
            FROM v4_patterns
            WHERE ticker = ? AND outcome IN ('win', 'loss')
            GROUP BY pattern_normalized
            HAVING cnt >= 2
            ORDER BY (CAST(wins AS REAL) / cnt) DESC
        ''', (ticker,))

        pattern_stats = cursor.fetchall()

        best_pattern = ""
        best_win_rate = 0.0
        worst_pattern = ""
        worst_win_rate = 100.0

        for p in pattern_stats:
            wr = p[2] / p[3] if p[3] > 0 else 0
            if wr > best_win_rate:
                best_win_rate = wr
                best_pattern = p[0]
            if wr < worst_win_rate:
                worst_win_rate = wr
                worst_pattern = p[0]

        # 3. تقسيم الأنماط
        cursor.execute('''
            SELECT pattern_normalized, COUNT(*) as cnt, outcome
            FROM v4_patterns
            WHERE ticker = ?
            GROUP BY pattern_normalized, outcome
        ''', (ticker,))

        pattern_breakdown = {}
        for p in cursor.fetchall():
            pn = p[0]
            if pn not in pattern_breakdown:
                pattern_breakdown[pn] = {"total": 0, "wins": 0, "losses": 0, "open": 0}
            pattern_breakdown[pn]["total"] += p[1]
            if p[2] == "win":
                pattern_breakdown[pn]["wins"] = p[1]
            elif p[2] == "loss":
                pattern_breakdown[pn]["losses"] = p[1]
            elif p[2] == "open":
                pattern_breakdown[pn]["open"] = p[1]

        # 4. مستوى الدعم المفضل
        cursor.execute('''
            SELECT support_level, COUNT(*) as cnt
            FROM v4_patterns
            WHERE ticker = ? AND support_level IS NOT NULL AND support_level > 0
            GROUP BY support_level
            ORDER BY cnt DESC
            LIMIT 1
        ''', (ticker,))

        fav_support_row = cursor.fetchone()
        favorite_support = fav_support_row[0] if fav_support_row else None

        # 5. حالات مشابهة
        similar_cases = []

        # البحث بنفس السهم + نفس النمط
        cursor.execute('''
            SELECT ticker, ticker_name, pattern_normalized, entry_price,
                   outcome, pnl_pct, trade_date, notes, support_level
            FROM v4_patterns
            WHERE ticker = ? AND outcome IN ('win', 'loss')
            ORDER BY trade_date DESC
            LIMIT 5
        ''', (ticker,))

        for row in cursor.fetchall():
            similar_cases.append({
                "ticker": row[0],
                "ticker_name": row[1],
                "pattern": row[2],
                "entry": row[3],
                "result": row[4],
                "pnl": row[5],
                "date": row[6],
                "notes": row[7],
                "support": row[8]
            })

        # 6. حساب Win Rate
        total_closed = (general[1] or 0) + (general[2] or 0)
        win_rate = (general[1] / total_closed * 100) if total_closed > 0 else 0

        # 7. توليد الاقتراح
        suggestion = self._generate_suggestion(
            ticker, current_price, support, resistance,
            best_pattern, best_win_rate, favorite_support, similar_cases
        )

        # 8. حساب الثقة
        confidence = self._calculate_confidence(general[0], win_rate, len(similar_cases))

        conn.close()

        return AnalystInsight(
            ticker=ticker,
            total_trades=general[0] or 0,
            wins=general[1] or 0,
            losses=general[2] or 0,
            open_positions=general[3] or 0,
            win_rate=round(win_rate, 1),
            avg_pnl=round(general[4] or 0, 2),
            best_pattern=best_pattern,
            best_pattern_win_rate=round(best_win_rate * 100, 1),
            worst_pattern=worst_pattern,
            worst_pattern_win_rate=round(worst_win_rate * 100, 1),
            favorite_support=favorite_support,
            similar_cases=similar_cases,
            suggestion=suggestion,
            confidence=confidence,
            pattern_breakdown=pattern_breakdown
        )

    def _generate_suggestion(self, ticker: str, current_price: float,
                             support: float, resistance: float,
                             best_pattern: str, best_win_rate: float,
                             favorite_support: float, similar_cases: List) -> str:
        """توليد اقتراح ذكي"""

        parts = []

        # تاريخك مع السهم
        if similar_cases:
            wins = sum(1 for c in similar_cases if c['result'] == 'win')
            total = len(similar_cases)
            parts.append(f"أنت دخلت {ticker} {total} مرات: {wins} ربح")

        # أفضل نمط
        if best_pattern and best_win_rate > 0:
            parts.append(f"أحسن نمط ليك: {best_pattern} ({best_win_rate:.0f}% نجاح)")

        # السعر الحالي والدعم
        if current_price and favorite_support:
            diff = ((current_price - favorite_support) / favorite_support) * 100
            if abs(diff) < 2:
                parts.append(f"⚠️ السهم قرب دعمك المفضل ({favorite_support})")
            elif current_price < favorite_support:
                parts.append(f"📉 السهم تحت دعمك ({favorite_support})!")

        # اقتراح بناءً على الوضع
        if current_price and support:
            if current_price <= support * 1.02:  # ضمن 2% من الدعم
                parts.append("💡 فرصة: السهم عند دعم. نمط 'دعم/ارتداد' مناسب.")

        return " | ".join(parts) if parts else "لا توجد بيانات كافية"

    def _calculate_confidence(self, total_trades: int, win_rate: float,
                              similar_cases: int) -> float:
        """حساب مستوى الثقة"""
        if total_trades < 3:
            return 20.0
        if total_trades < 5:
            return 40.0
        if total_trades < 10:
            return 60.0

        # أعلى ثقة لو Win Rate جيد
        if win_rate > 60:
            return 80.0
        if win_rate > 50:
            return 70.0

        return 50.0

    def get_similar_patterns(self, ticker: str, pattern_type: str,
                             entry_price: float = None,
                             support_level: float = None) -> List[Dict]:
        """
        البحث عن أنماط مشابهة
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        normalized = self.normalize_pattern(pattern_type)

        # المستوى الأول: نفس السهم + نفس النمط
        cursor.execute('''
            SELECT ticker, ticker_name, pattern_normalized, entry_price,
                   outcome, pnl_pct, trade_date, notes, support_level, resistance_level
            FROM v4_patterns
            WHERE ticker = ? AND pattern_normalized = ?
            ORDER BY trade_date DESC
            LIMIT 10
        ''', (ticker, normalized))

        results = []
        for row in cursor.fetchall():
            results.append({
                "ticker": row[0],
                "ticker_name": row[1],
                "pattern": row[2],
                "entry": row[3],
                "result": row[4],
                "pnl": row[5],
                "date": row[6],
                "notes": row[7],
                "support": row[8],
                "resistance": row[9],
                "match_level": "exact"
            })

        # المستوى الثاني: أي سهم + نفس النمط + نفس مستوى الدعم
        if support_level and len(results) < 5:
            cursor.execute('''
                SELECT ticker, ticker_name, pattern_normalized, entry_price,
                       outcome, pnl_pct, trade_date, notes, support_level
                FROM v4_patterns
                WHERE pattern_normalized = ?
                  AND support_level BETWEEN ? AND ?
                  AND ticker != ?
                  AND outcome IN ('win', 'loss')
                ORDER BY trade_date DESC
                LIMIT 5
            ''', (normalized, support_level * 0.95, support_level * 1.05, ticker))

            for row in cursor.fetchall():
                results.append({
                    "ticker": row[0],
                    "ticker_name": row[1],
                    "pattern": row[2],
                    "entry": row[3],
                    "result": row[4],
                    "pnl": row[5],
                    "date": row[6],
                    "notes": row[7],
                    "support": row[8],
                    "match_level": "similar_support"
                })

        conn.close()
        return results

    def get_all_stats(self) -> Dict:
        """إحصائيات عامة"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # إحصائيات الأنماط
        cursor.execute('''
            SELECT pattern_normalized, SUM(count) as total, SUM(wins) as wins, SUM(losses) as losses,
                   AVG(win_rate) as avg_wr, AVG(avg_pnl) as avg_pnl
            FROM v4_pattern_stats
            GROUP BY pattern_normalized
            ORDER BY avg_wr DESC
        ''')

        patterns = []
        for row in cursor.fetchall():
            patterns.append({
                "pattern": row[0],
                "total": row[1],
                "wins": row[2],
                "losses": row[3],
                "win_rate": round(row[4] or 0, 1),
                "avg_pnl": round(row[5] or 0, 2)
            })

        # أفضل 5 أسهم
        cursor.execute('''
            SELECT ticker, SUM(count) as total, SUM(wins) as wins, SUM(losses) as losses
            FROM v4_pattern_stats
            WHERE ticker != 'ALL'
            GROUP BY ticker
            HAVING total >= 2
            ORDER BY (CAST(SUM(wins) AS REAL) / SUM(count)) DESC
            LIMIT 5
        ''')

        top_tickers = []
        for row in cursor.fetchall():
            wr = (row[2] / row[1] * 100) if row[1] > 0 else 0
            top_tickers.append({
                "ticker": row[0],
                "total": row[1],
                "wins": row[2],
                "losses": row[3],
                "win_rate": round(wr, 1)
            })

        # أسوأ 5 أسهم
        cursor.execute('''
            SELECT ticker, SUM(count) as total, SUM(wins) as wins, SUM(losses) as losses
            FROM v4_pattern_stats
            WHERE ticker != 'ALL' AND losses > 0
            GROUP BY ticker
            HAVING total >= 2
            ORDER BY (CAST(SUM(wins) AS REAL) / SUM(count)) ASC
            LIMIT 5
        ''')

        worst_tickers = []
        for row in cursor.fetchall():
            wr = (row[2] / row[1] * 100) if row[1] > 0 else 0
            worst_tickers.append({
                "ticker": row[0],
                "total": row[1],
                "wins": row[2],
                "losses": row[3],
                "win_rate": round(wr, 1)
            })

        conn.close()

        return {
            "patterns": patterns,
            "top_tickers": top_tickers,
            "worst_tickers": worst_tickers,
            "total_patterns": len(patterns),
            "generated_at": datetime.now().isoformat()
        }

    def get_alerts(self, current_prices: Dict[str, float]) -> List[Dict]:
        """
        توليد تنبيهات بناءً على الأسعار الحالية
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        alerts = []

        # البحث عن مستويات دعم قريبة
        for ticker, current_price in current_prices.items():
            cursor.execute('''
                SELECT DISTINCT support_level, ticker_name, pattern_normalized,
                       COUNT(*) as cnt, SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins
                FROM v4_patterns
                WHERE ticker = ? AND support_level IS NOT NULL AND support_level > 0
                GROUP BY support_level
                HAVING cnt >= 2
            ''', (ticker,))

            for row in cursor.fetchall():
                support = row[0]
                wins = row[4]
                total = row[3]

                # السعر ضمن 3% من الدعم
                if current_price <= support * 1.03 and current_price >= support * 0.97:
                    wr = (wins / total * 100) if total > 0 else 0
                    alerts.append({
                        "type": "support_near",
                        "ticker": ticker,
                        "ticker_name": row[1],
                        "current_price": current_price,
                        "support_level": support,
                        "distance_pct": round(((current_price - support) / support) * 100, 2),
                        "your_win_rate": round(wr, 1),
                        "your_trades": total,
                        "pattern": row[2],
                        "message": f"🔔 {ticker} عند {current_price:.2f} (دعمك: {support:.2f}). كسبت {wins}/{total} هنا."
                    })

        conn.close()
        return alerts

    def auto_close_open_trades(self, price_data_map: Dict[str, Dict[str, float]]) -> int:
        """
        إغلاق الصفقات المفتوحة تلقائياً بناءً على الأسعار الحالية
        
        Args:
            price_data_map: {ticker: {"close": float, "high": float, "low": float}}
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # جلب الصفقات المفتوحة
        cursor.execute('''
            SELECT id, ticker, entry_price, target_1, target_2, stop_loss, trade_date
            FROM v4_patterns
            WHERE outcome = 'open'
        ''')
        open_trades = cursor.fetchall()
        
        closed_count = 0
        now = datetime.now()
        
        for trade in open_trades:
            trade_id, ticker, entry_price, target_1, target_2, stop_loss, trade_date_str = trade
            
            if ticker not in price_data_map:
                continue
                
            price_info = price_data_map[ticker]
            curr_close = price_info.get("close", 0)
            curr_high = price_info.get("high", curr_close)
            curr_low = price_info.get("low", curr_close)
            
            if curr_close <= 0:
                continue
                
            outcome = None
            pnl_pct = 0.0
            
            # 1. تحقق من وقف الخسارة أولاً
            if stop_loss and curr_low <= stop_loss:
                outcome = 'loss'
                pnl_pct = ((stop_loss - entry_price) / entry_price * 100) if entry_price > 0 else 0
            # 2. تحقق من الهدف الأول أو الثاني
            elif target_2 and curr_high >= target_2:
                outcome = 'win'
                pnl_pct = ((target_2 - entry_price) / entry_price * 100) if entry_price > 0 else 0
            elif target_1 and curr_high >= target_1:
                outcome = 'win'
                pnl_pct = ((target_1 - entry_price) / entry_price * 100) if entry_price > 0 else 0
            
            # 3. تحقق من مرور 90 يوماً كـ Expire
            if not outcome and trade_date_str:
                try:
                    trade_date = datetime.fromisoformat(trade_date_str.split('T')[0])
                    if (now - trade_date).days >= 90:
                        outcome = 'neutral'
                        pnl_pct = ((curr_close - entry_price) / entry_price * 100) if entry_price > 0 else 0
                except Exception:
                    pass
            
            if outcome:
                # إغلاق الصفقة
                cursor.execute('''
                    UPDATE v4_patterns
                    SET outcome = ?, pnl_pct = ?, close_date = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (outcome, round(pnl_pct, 2), now.isoformat(), trade_id))
                closed_count += 1
                
        conn.commit()
        conn.close()
        
        # إعادة حساب الإحصائيات بعد الإغلاق
        if closed_count > 0:
            self.rebuild_stats()
            print(f"[ExpertMemoryV4] Closed {closed_count} open trades automatically.")
        return closed_count

    def get_unbiased_stats(self) -> Dict:
        """
        إحصائيات بدون Selection Bias:
        - تفترض أن الصفقات المفتوحة لأكثر من 60 يوماً هي صفقات خاسرة أو محايدة (Penalty).
        - حساب confidence interval لنسبة النجاح (Win Rate).
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # جلب جميع الصفقات المغلّقة
        cursor.execute('''
            SELECT outcome, pnl_pct, trade_date
            FROM v4_patterns
        ''')
        trades = cursor.fetchall()
        conn.close()
        
        wins = 0
        losses = 0
        neutrals = 0
        open_count = 0
        old_open_penalty_losses = 0
        
        total_pnl = 0.0
        now = datetime.now()
        
        for trade in trades:
            outcome, pnl_pct, trade_date_str = trade
            pnl_pct = pnl_pct or 0.0
            
            if outcome == 'win':
                wins += 1
                total_pnl += pnl_pct
            elif outcome == 'loss':
                losses += 1
                total_pnl += pnl_pct
            elif outcome == 'neutral':
                neutrals += 1
                total_pnl += pnl_pct
            elif outcome == 'open':
                open_count += 1
                # عقوبة الصفقات المفتوحة القديمة (> 60 يوماً)
                if trade_date_str:
                    try:
                        trade_date = datetime.fromisoformat(trade_date_str.split('T')[0])
                        if (now - trade_date).days > 60:
                            old_open_penalty_losses += 1
                    except Exception:
                        pass
        
        # إحصائيات معتادة
        total_closed = wins + losses + neutrals
        traditional_win_rate = (wins / (wins + losses) * 100) if (wins + losses) > 0 else 0
        
        # إحصائيات غير متحيزة (نعتبر الصفقات المفتوحة القديمة كخسائر)
        unbiased_losses = losses + old_open_penalty_losses
        unbiased_win_rate = (wins / (wins + unbiased_losses) * 100) if (wins + unbiased_losses) > 0 else 0
        
        # حساب نطاق الثقة (Confidence Interval)
        n = wins + unbiased_losses
        ci_lower = 0.0
        ci_upper = 0.0
        if n > 0:
            p = wins / n
            z = 1.96 # 95% confidence
            denominator = 1 + z**2/n
            center_adj_val = p + z**2/(2*n)
            spread_val = z * math.sqrt((p*(1-p) + z**2/(4*n))/n)
            ci_lower = round(((center_adj_val - spread_val) / denominator) * 100, 1)
            ci_upper = round(((center_adj_val + spread_val) / denominator) * 100, 1)
            
        return {
            "total_trades": len(trades),
            "closed_trades": total_closed,
            "open_trades": open_count,
            "old_open_penalty_trades": old_open_penalty_losses,
            "traditional": {
                "wins": wins,
                "losses": losses,
                "win_rate": round(traditional_win_rate, 1),
            },
            "unbiased": {
                "wins": wins,
                "losses": unbiased_losses,
                "win_rate": round(unbiased_win_rate, 1),
                "confidence_interval_95": f"{ci_lower}% - {ci_upper}%",
                "sample_size_sufficient": n >= 30,
            },
            "avg_pnl": round(total_pnl / total_closed, 2) if total_closed > 0 else 0.0
        }


# ==================== CONVENIENCE FUNCTIONS ====================

def get_expert_memory_v4(db_path: str) -> ExpertMemoryV4:
    """Get ExpertMemoryV4 instance"""
    return ExpertMemoryV4(db_path)


def import_from_expert_recommendation(db_path: str, source_db: str) -> int:
    """
    استيراد البيانات من expertRecommendation
    """
    import sqlite3

    # قراءة من قاعدة البيانات المصدر
    source_conn = sqlite3.connect(source_db)
    source_cursor = source_conn.cursor()

    source_cursor.execute('SELECT * FROM expertRecommendation')
    columns = [desc[0] for desc in source_cursor.description]
    rows = source_cursor.fetchall()

    source_conn.close()

    # تسجيل في V4
    memory = ExpertMemoryV4(db_path)
    count = 0

    for row in rows:
        rec = dict(zip(columns, row))
        try:
            memory.record_trade_from_expert_recommendation(rec)
            count += 1
        except Exception as e:
            print(f"Error importing {rec.get('id')}: {e}")

    return count
