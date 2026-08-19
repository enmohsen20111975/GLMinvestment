"""
Trade Journal
=============
سجل الصفقات

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md - الفصل الخامس

النظام يجب أن يُجبر المستخدم على تعبئة "Journal" قبل إغلاق أي صفقة خاسرة > 5%

كل صفقة مغلقة يجب تسجيلها:
- بيانات الدخول والخروج
- سبب الدخول والخروج
- الأخطاء والدروس المستفادة
- الحالة النفسية
- التقييم
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Literal
from datetime import datetime
from enum import Enum
import json
import os
import sqlite3
import logging

logger = logging.getLogger(__name__)


class TradeGrade(str, Enum):
    """تقييم الصفقة"""
    A = "A"     # ممتاز - اتبعت الخطة، ربح جيد
    B = "B"     # جيد - اتبعت الخطة، ربح متوسط
    C = "C"     # مقبول - أخطاء بسيطة أو توقيت سيء
    D = "D"     # ضعيف - أخطاء واضحة
    F = "F"     # فاشل - لم أتبع الخطة إطلاقاً


class EmotionalState(str, Enum):
    """الحالة النفسية"""
    CONFIDENT = "confident"           # واثق
    ANXIOUS = "anxious"               # قلق
    FEARFUL = "fearful"               # خائف
    GREEDY = "greedy"                 # طماع
    REVENGEFUL = "revengeful"         # منتقم
    BORED = "bored"                   # ملان
    FOCUSED = "focused"               # مركز
    IMPATIENT = "impatient"           # مستعجل


@dataclass
class TradeEntry:
    """بيانات دخول الصفقة"""
    ticker: str
    direction: str  # long, short
    entry_price: float
    shares: int
    entry_date: datetime
    planned_stop: float
    planned_target: float
    planned_risk_reward: float
    entry_reason: str
    entry_reason_ar: str
    strategy_used: str
    persona_at_entry: str
    market_condition: str
    
    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "direction": self.direction,
            "entry_price": self.entry_price,
            "shares": self.shares,
            "entry_date": self.entry_date.isoformat(),
            "planned_stop": self.planned_stop,
            "planned_target": self.planned_target,
            "planned_risk_reward": self.planned_risk_reward,
            "entry_reason": self.entry_reason,
            "entry_reason_ar": self.entry_reason_ar,
            "strategy_used": self.strategy_used,
            "persona_at_entry": self.persona_at_entry,
            "market_condition": self.market_condition
        }


@dataclass
class TradeExit:
    """بيانات خروج الصفقة"""
    exit_price: float
    exit_date: datetime
    exit_reason: str
    exit_reason_ar: str
    actual_stop_hit: bool
    actual_target_hit: bool
    actual_risk_reward: float
    profit_loss: float
    profit_loss_pct: float
    days_held: int
    
    def to_dict(self) -> dict:
        return {
            "exit_price": self.exit_price,
            "exit_date": self.exit_date.isoformat(),
            "exit_reason": self.exit_reason,
            "exit_reason_ar": self.exit_reason_ar,
            "actual_stop_hit": self.actual_stop_hit,
            "actual_target_hit": self.actual_target_hit,
            "actual_risk_reward": round(self.actual_risk_reward, 2),
            "profit_loss": round(self.profit_loss, 2),
            "profit_loss_pct": round(self.profit_loss_pct, 2),
            "days_held": self.days_held
        }


@dataclass
class TradeReflection:
    """التأمل والتعلم من الصفقة"""
    mistake: Optional[str] = None
    mistake_ar: Optional[str] = None
    lesson: Optional[str] = None
    lesson_ar: Optional[str] = None
    emotional_state: Optional[EmotionalState] = None
    followed_plan: bool = True
    grade: Optional[TradeGrade] = None
    notes: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            "mistake": self.mistake,
            "mistake_ar": self.mistake_ar,
            "lesson": self.lesson,
            "lesson_ar": self.lesson_ar,
            "emotional_state": self.emotional_state.value if self.emotional_state else None,
            "followed_plan": self.followed_plan,
            "grade": self.grade.value if self.grade else None,
            "notes": self.notes
        }


@dataclass
class TradeEntry:
    """إدخال كامل في سجل الصفقات"""
    trade_id: str
    entry: TradeEntry
    exit: Optional[TradeExit] = None
    reflection: Optional[TradeReflection] = None
    is_closed: bool = False
    journal_required: bool = False  # هل يحتاج تعبئة journal إجباري؟
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> dict:
        return {
            "trade_id": self.trade_id,
            "entry": self.entry.to_dict(),
            "exit": self.exit.to_dict() if self.exit else None,
            "reflection": self.reflection.to_dict() if self.reflection else None,
            "is_closed": self.is_closed,
            "journal_required": self.journal_required,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }


class TradeJournal:
    """
    سجل الصفقات — مخزّن في SQLite (predictions.db) بدلاً من JSON.
    
    جداول:
      - ``trade_journal_entries`` — كل صفقة (مفتوحة/مغلقة) مع الدخول/الخروج/التأمل
      - ``trade_journal_reflections`` — التأملات (جدول منفصل عشان ممكن صفقة واحدة
        تاخد أكتر من تأمل مع الوقت)
    """

    # --- Schema SQL ---
    _SCHEMA_SQL = """
        CREATE TABLE IF NOT EXISTS trade_journal_entries (
            trade_id TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'long',
            entry_price REAL NOT NULL,
            shares INTEGER NOT NULL,
            entry_date TEXT NOT NULL,
            planned_stop REAL NOT NULL,
            planned_target REAL NOT NULL,
            planned_risk_reward REAL NOT NULL DEFAULT 0,
            entry_reason TEXT DEFAULT '',
            entry_reason_ar TEXT DEFAULT '',
            strategy_used TEXT DEFAULT 'planned_scale_in',
            persona_at_entry TEXT DEFAULT 'balanced',
            market_condition TEXT DEFAULT 'neutral',
            exit_price REAL,
            exit_date TEXT,
            exit_reason TEXT,
            exit_reason_ar TEXT,
            actual_stop_hit INTEGER DEFAULT 0,
            actual_target_hit INTEGER DEFAULT 0,
            actual_risk_reward REAL DEFAULT 0,
            profit_loss REAL DEFAULT 0,
            profit_loss_pct REAL DEFAULT 0,
            days_held INTEGER DEFAULT 0,
            is_closed INTEGER DEFAULT 0,
            journal_required INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_journal_ticker
            ON trade_journal_entries(ticker);
        CREATE INDEX IF NOT EXISTS idx_journal_dates
            ON trade_journal_entries(created_at);
        CREATE INDEX IF NOT EXISTS idx_journal_closed
            ON trade_journal_entries(is_closed);
    """

    _SCHEMA_REFLECTIONS_SQL = """
        CREATE TABLE IF NOT EXISTS trade_journal_reflections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id TEXT NOT NULL,
            mistake TEXT,
            mistake_ar TEXT,
            lesson TEXT,
            lesson_ar TEXT,
            emotional_state TEXT,
            followed_plan INTEGER DEFAULT 1,
            grade TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (trade_id) REFERENCES trade_journal_entries(trade_id)
        );
        CREATE INDEX IF NOT EXISTS idx_reflections_trade
            ON trade_journal_reflections(trade_id);
    """

    _schema_ready = False

    def __init__(self, storage_path: str = None):
        from pathlib import Path
        if storage_path is None:
            _base_dir = Path(__file__).parent.parent.parent.resolve()
            storage_path = str(_base_dir / 'db' / 'predictions.db')
        self.storage_path = storage_path
        self._ensure_schema()

    def _ensure_schema(self):
        if self._schema_ready:
            return
        try:
            conn = sqlite3.connect(self.storage_path)
            conn.executescript(self._SCHEMA_SQL)
            conn.executescript(self._SCHEMA_REFLECTIONS_SQL)
            conn.commit()
            conn.close()
            self._schema_ready = True
        except sqlite3.Error as e:
            logger.error("فشل إنشاء schema trade_journal: %s", e)

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.storage_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _row_to_dict(self, row) -> dict:
        if not row:
            return None
        r = dict(row)
        return {
            "trade_id": r["trade_id"],
            "entry": {
                "ticker": r["ticker"], "direction": r["direction"],
                "entry_price": r["entry_price"], "shares": r["shares"],
                "entry_date": r["entry_date"], "planned_stop": r["planned_stop"],
                "planned_target": r["planned_target"],
                "planned_risk_reward": r["planned_risk_reward"],
                "entry_reason": r["entry_reason"], "entry_reason_ar": r["entry_reason_ar"],
                "strategy_used": r["strategy_used"], "persona_at_entry": r["persona_at_entry"],
                "market_condition": r["market_condition"],
            },
            "exit": {
                "exit_price": r["exit_price"], "exit_date": r["exit_date"],
                "exit_reason": r["exit_reason"], "exit_reason_ar": r["exit_reason_ar"],
                "actual_stop_hit": bool(r["actual_stop_hit"]),
                "actual_target_hit": bool(r["actual_target_hit"]),
                "actual_risk_reward": r["actual_risk_reward"],
                "profit_loss": r["profit_loss"], "profit_loss_pct": r["profit_loss_pct"],
                "days_held": r["days_held"],
            } if r["exit_price"] is not None else None,
            "reflection": None,
            "is_closed": bool(r["is_closed"]),
            "journal_required": bool(r["journal_required"]),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }

    def open_trade(
        self, ticker: str, direction: str, entry_price: float,
        shares: int, planned_stop: float, planned_target: float,
        entry_reason: str, entry_reason_ar: str,
        strategy: str = "planned_scale_in", persona: str = "balanced",
        market_condition: str = "neutral",
    ) -> dict:
        trade_id = f"{ticker}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        risk = entry_price - planned_stop
        reward = planned_target - entry_price
        risk_reward = reward / risk if risk > 0 else 0
        now = datetime.now().isoformat()

        try:
            conn = self._get_conn()
            conn.execute(
                """INSERT INTO trade_journal_entries
                   (trade_id, ticker, direction, entry_price, shares, entry_date,
                    planned_stop, planned_target, planned_risk_reward,
                    entry_reason, entry_reason_ar, strategy_used,
                    persona_at_entry, market_condition, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (trade_id, ticker, direction, entry_price, shares, now,
                 planned_stop, planned_target, round(risk_reward, 2),
                 entry_reason, entry_reason_ar, strategy,
                 persona, market_condition, now, now),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM trade_journal_entries WHERE trade_id=?", (trade_id,)
            ).fetchone()
            conn.close()
            logger.info("📥 Trade Journal: فتح صفقة %s (%s @ %.2f × %d)",
                        trade_id, ticker, entry_price, shares)
            return self._row_to_dict(row)
        except sqlite3.Error as e:
            logger.error("فشل فتح صفقة في journal: %s", e)
            raise

    def close_trade(
        self, trade_id: str, exit_price: float,
        exit_reason: str, exit_reason_ar: str,
    ) -> dict:
        try:
            conn = self._get_conn()
            row = conn.execute(
                "SELECT * FROM trade_journal_entries WHERE trade_id=? AND is_closed=0",
                (trade_id,),
            ).fetchone()
            if not row:
                conn.close()
                return {"success": False, "error": "Trade not found or already closed"}

            r = dict(row)
            entry_price = float(r["entry_price"])
            shares = int(r["shares"])

            if r["direction"] == "long":
                profit = (exit_price - entry_price) * shares
            else:
                profit = (entry_price - exit_price) * shares

            profit_pct = (profit / (entry_price * shares)) * 100 if entry_price and shares else 0
            entry_date = datetime.fromisoformat(r["entry_date"])
            days_held = (datetime.now() - entry_date).days
            journal_required = profit_pct < -5

            actual_stop_hit = exit_price <= float(r["planned_stop"])
            actual_target_hit = exit_price >= float(r["planned_target"])
            actual_rr = (
                profit / ((entry_price - float(r["planned_stop"])) * shares)
                if profit < 0 and (entry_price - float(r["planned_stop"])) > 0
                else 0
            )
            now = datetime.now().isoformat()

            conn.execute(
                """UPDATE trade_journal_entries
                   SET exit_price=?, exit_date=?, exit_reason=?, exit_reason_ar=?,
                       actual_stop_hit=?, actual_target_hit=?, actual_risk_reward=?,
                       profit_loss=?, profit_loss_pct=?, days_held=?,
                       is_closed=1, journal_required=?, updated_at=?
                   WHERE trade_id=?""",
                (exit_price, now, exit_reason, exit_reason_ar,
                 int(actual_stop_hit), int(actual_target_hit), round(actual_rr, 2),
                 round(profit, 2), round(profit_pct, 2), days_held,
                 int(journal_required), now, trade_id),
            )
            conn.commit()
            conn.close()

            logger.info("📤 Trade Journal: إغلاق صفقة %s pnl=%+.2f%%", trade_id, profit_pct)
            return {
                "success": True, "trade_id": trade_id,
                "profit": round(profit, 2), "profit_pct": round(profit_pct, 2),
                "journal_required": journal_required,
                "message": "تم إغلاق الصفقة. " + (
                    "⚠️ يرجى تعبئة Journal للتعلم من هذه الخسارة" if journal_required else ""
                ),
            }
        except sqlite3.Error as e:
            logger.error("فشل إغلاق صفقة في journal: %s", e)
            return {"success": False, "error": str(e)}

    def add_reflection(
        self, trade_id: str, mistake: Optional[str] = None,
        mistake_ar: Optional[str] = None, lesson: Optional[str] = None,
        lesson_ar: Optional[str] = None, emotional_state: Optional[EmotionalState] = None,
        followed_plan: bool = True, grade: Optional[TradeGrade] = None,
        notes: Optional[str] = None,
    ) -> dict:
        try:
            conn = self._get_conn()
            exists = conn.execute(
                "SELECT 1 FROM trade_journal_entries WHERE trade_id=?", (trade_id,)
            ).fetchone()
            if not exists:
                conn.close()
                return {"success": False, "error": "Trade not found"}

            conn.execute(
                """INSERT INTO trade_journal_reflections
                   (trade_id, mistake, mistake_ar, lesson, lesson_ar,
                    emotional_state, followed_plan, grade, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (trade_id, mistake, mistake_ar, lesson, lesson_ar,
                 emotional_state.value if emotional_state else None,
                 int(followed_plan),
                 grade.value if grade else None, notes),
            )
            conn.execute(
                "UPDATE trade_journal_entries SET journal_required=0, updated_at=? WHERE trade_id=?",
                (datetime.now().isoformat(), trade_id),
            )
            conn.commit()
            conn.close()
            logger.info("📝 Trade Journal: تأمل لـ %s", trade_id)
            return {"success": True, "message": "تم حفظ التأمل."}
        except sqlite3.Error as e:
            logger.error("فشل add_reflection: %s", e)
            return {"success": False, "error": str(e)}

    def get_statistics(self, days: int = 30) -> dict:
        try:
            conn = self._get_conn()
            cutoff = (datetime.now() - __import__('datetime').timedelta(days=days)).isoformat()
            rows = conn.execute(
                """SELECT * FROM trade_journal_entries
                   WHERE is_closed=1 AND exit_date >= ?
                   ORDER BY exit_date DESC""",
                (cutoff,),
            ).fetchall()
            conn.close()

            if not rows:
                return {"period_days": days, "total_trades": 0,
                        "message": "لا توجد صفقات مغلقة في هذه الفترة"}

            trades = [dict(r) for r in rows]
            wins = [t for t in trades if (t["profit_loss"] or 0) > 0]
            losses = [t for t in trades if (t["profit_loss"] or 0) <= 0]
            total = len(trades)

            total_profit = sum(t["profit_loss"] or 0 for t in trades)
            avg_win = sum(t["profit_loss"] or 0 for t in wins) / len(wins) if wins else 0
            avg_loss = sum(t["profit_loss"] or 0 for t in losses) / len(losses) if losses else 0
            win_rate = len(wins) / total * 100 if total else 0
            avg_rr = sum(t["actual_risk_reward"] or 0 for t in trades) / total if total else 0

            best = max(trades, key=lambda t: t["profit_loss_pct"] or -1e9)
            worst = min(trades, key=lambda t: t["profit_loss_pct"] or 1e9)

            # Emotional stats from reflections
            emo_stats = {}
            try:
                conn2 = self._get_conn()
                for t in trades:
                    ref_row = conn2.execute(
                        """SELECT emotional_state, followed_plan, grade
                           FROM trade_journal_reflections
                           WHERE trade_id=? ORDER BY id DESC LIMIT 1""",
                        (t["trade_id"],),
                    ).fetchone()
                    if ref_row:
                        state = ref_row["emotional_state"]
                        if state:
                            if state not in emo_stats:
                                emo_stats[state] = {"trades": 0, "profit": 0.0}
                            emo_stats[state]["trades"] += 1
                            emo_stats[state]["profit"] += (t["profit_loss"] or 0)
                conn2.close()
            except sqlite3.Error:
                pass

            return {
                "period_days": days, "total_trades": total,
                "win_rate": round(win_rate, 1), "total_profit": round(total_profit, 2),
                "avg_win": round(avg_win, 2), "avg_loss": round(avg_loss, 2),
                "avg_risk_reward": round(avg_rr, 2),
                "best_trade": {"ticker": best["ticker"], "profit_pct": round(best["profit_loss_pct"] or 0, 2)},
                "worst_trade": {"ticker": worst["ticker"], "profit_pct": round(worst["profit_loss_pct"] or 0, 2)},
                "emotional_performance": {
                    k: {"trades": v["trades"], "avg_profit": round(v["profit"] / v["trades"], 2)}
                    for k, v in emo_stats.items() if v["trades"] > 0
                },
            }
        except sqlite3.Error as e:
            logger.error("فشل get_statistics: %s", e)
            return {"period_days": days, "total_trades": 0, "error": str(e)}

    def get_open_trades(self) -> List[dict]:
        try:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM trade_journal_entries WHERE is_closed=0 ORDER BY created_at DESC"
            ).fetchall()
            conn.close()
            return [self._row_to_dict(r) for r in rows]
        except sqlite3.Error as e:
            logger.error("فشل get_open_trades: %s", e)
            return []

    def get_recent_trades(self, limit: int = 20) -> List[dict]:
        try:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM trade_journal_entries ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            conn.close()
            return [self._row_to_dict(r) for r in rows]
        except sqlite3.Error as e:
            logger.error("فشل get_recent_trades: %s", e)
            return []

    def get_all_trades(self) -> List[dict]:
        try:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM trade_journal_entries ORDER BY updated_at DESC"
            ).fetchall()
            conn.close()
            return [self._row_to_dict(r) for r in rows]
        except sqlite3.Error as e:
            logger.error("فشل get_all_trades: %s", e)
            return []


__all__ = [
    'TradeJournal', 'TradeEntry', 'TradeExit', 'TradeReflection',
    'TradeGrade', 'EmotionalState'
]
