#!/usr/bin/env python3
"""
Trade Recorder + Learning Loop — مسجّل صفقات المستخدم وحلقة التعلّم
==================================================================
الـ LearningEngine الحالي بيحلل **التوقعات** (predictions) مش الصفقات الفعلية.
المستخدم بايع 8 فرص بكسب (ELKA, ELSH, EGTS, GGCC, NARE, TYCN) والمشروع مديهوش
أي تنبيه ليهم. المشكلة الجذرية: **مفيش نظام بيسجّل صفقات المستخدم الفعلية
ويتعلّم منها**.

الـ module بيخلّي المشروع يتعلّم من الصفقات الفعلية للمستخدم:

1. ``record_buy()`` / ``record_sell()`` — تسجيل صفقات المستخدم الفعلية.
2. عند الـ SELL بيتحسب الـ outcome تلقائياً:
   - ``pnl``, ``pnl_pct``, ``holding_days``, ``outcome`` (WIN/LOSS/BREAKEVEN)
   - ``prediction_before_buy`` من ``stored_analyses`` (لو موجود)
   - ``had_live_signal`` من ``live_ai_signals`` (لو فيه signal قبل الشراء)
3. ``learn_from_trades()`` — الـ learning loop:
   - يحلّل الـ patterns (breakout / volume_spike / reversal / accumulation)
   - يكتب lessons (دروس مستفادة)
   - يحدّث ``analyzed=1``

Tables (في predictions.db):
  - ``user_trades``     — سجل كل صفقات BUY/SELL اللي المستخدم سجّلها
  - ``trade_outcomes``  — نتيجة كل صفقة مغلقة + التحليل قبل الشراء + الـ pattern

نمط الكود متبوع من ``smart_portfolio_monitor.py`` + ``live_ai_monitor.py``
(Arabic docstrings + typing hints + logging + try/except على كل query).

Author: M2Y Team
Version: 1.0
"""

from __future__ import annotations

import json
import logging
import sqlite3
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Optional
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
try:
    from core.db_manager import db_manager as _dbm
    _TRADE_RECORDER_DBM_AVAILABLE = True
except Exception as _tr_err:
    _TRADE_RECORDER_DBM_AVAILABLE = False
    logger.warning(f"trade_recorder: db_manager not available ({_tr_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect.

    Helper يفتح connection عبر db_manager (WAL + busy_timeout=30000) لو متاح،
    وإلا بـ يقع لـ raw sqlite3.connect. الكود اللي بـ يستخدم conn.execute / cursor
    بـ يشتغل على المسارين بنفس الشكل.
    """
    ctx = None
    conn = None
    try:
        if _TRADE_RECORDER_DBM_AVAILABLE:
            ctx = _dbm.connection(db_path, writable=writable)
            conn = ctx.__enter__()
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass

# --- مسارات الـ DBs — نفس pattern بتاع live_ai_monitor.py ---
_AI_DIR = Path(__file__).resolve().parent
_VPS_DIR = _AI_DIR.parent
_PROJECT_ROOT = _VPS_DIR.parent
# خلي vps-service قابل للاستيراد عشان `from ai.xxx import ...` يشتغل
sys.path.insert(0, str(_VPS_DIR))

PREDICTIONS_DB = str(_PROJECT_ROOT / "db" / "predictions.db")
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")
PRICE_HISTORY_DB = str(_PROJECT_ROOT / "db" / "price_history.db")


# ============================================================================
# TradeRecorder
# ============================================================================

class TradeRecorder:
    """
    مسجّل صفقات المستخدم + حلقة التعلّم.

    Lazy schema init — لو ``predictions.db`` مش موجود، بيتإنشاء تلقائياً مع
    الـ tables (``user_trades`` + ``trade_outcomes``) عند أول استخدام في
    ``_ensure_schema``.

    Tables:
      - ``user_trades``     — سجل كل صفقات BUY/SELL اللي المستخدم سجّلها
      - ``trade_outcomes``  — نتيجة كل صفقة مغلقة + التحليل قبل الشراء +
                              الـ pattern + lessons
    """

    def __init__(self, db_path: str = PREDICTIONS_DB):
        """
        Args:
            db_path: مسار predictions.db (default = standard path).
        """
        self.db_path = db_path
        self._schema_ready = False

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def _ensure_schema(self) -> None:
        """Create ``user_trades`` + ``trade_outcomes`` tables + indexes (IF NOT EXISTS)."""
        if self._schema_ready:
            return
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS user_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    ticker TEXT NOT NULL,
                    trade_type TEXT NOT NULL,        -- 'BUY' / 'SELL'
                    price REAL NOT NULL,
                    quantity REAL NOT NULL,
                    trade_date TEXT NOT NULL,        -- ISO date
                    notes TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_trades_user ON user_trades(user_id);
                CREATE INDEX IF NOT EXISTS idx_trades_ticker ON user_trades(ticker);
                CREATE INDEX IF NOT EXISTS idx_trades_date ON user_trades(trade_date);

                CREATE TABLE IF NOT EXISTS trade_outcomes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    ticker TEXT NOT NULL,
                    buy_date TEXT,
                    buy_price REAL,
                    sell_date TEXT,
                    sell_price REAL,
                    quantity REAL,
                    pnl REAL,                        -- الربح/الخسارة بالجنيه
                    pnl_pct REAL,                    -- النسبة %
                    holding_days INTEGER,
                    outcome TEXT,                    -- 'WIN' / 'LOSS' / 'BREAKEVEN'

                    -- التحليل: إيه اللي المشروع قاله قبل الشراء؟
                    prediction_before_buy TEXT,      -- recommendation اللي كانت في stored_analyses
                    maestro_score_before REAL,
                    ai_decision_before TEXT,
                    had_live_signal INTEGER DEFAULT 0,  -- هل فيه live_ai_signal قبل الشراء؟

                    -- التعلّم: إيه الـ pattern الناجح/الفاشل؟
                    pattern_type TEXT,               -- 'breakout' / 'volume_spike' / 'reversal' / 'accumulation'
                    lessons TEXT,                    -- دروس مستفادة

                    analyzed INTEGER DEFAULT 0,      -- هل الـ learning engine حله؟
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_outcomes_user ON trade_outcomes(user_id);
                CREATE INDEX IF NOT EXISTS idx_outcomes_ticker ON trade_outcomes(ticker);
                CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON trade_outcomes(outcome);
                """
            )
            conn.commit()
            conn.close()
            self._schema_ready = True
            logger.debug(
                "user_trades + trade_outcomes schema جاهز في %s", self.db_path
            )
        except sqlite3.Error as e:
            # مش مميت — الكلاس يفضل شغّال، بس الـ storage هيفشل
            logger.error("فشل إنشاء schema user_trades/trade_outcomes: %s", e)

    # ------------------------------------------------------------------
    # record_buy
    # ------------------------------------------------------------------

    def record_buy(
        self,
        user_id: str,
        ticker: str,
        price: float,
        quantity: float,
        trade_date: Optional[str] = None,
        notes: str = "",
    ) -> dict:
        """
        تسجيل صفقة شراء.

        Args:
            user_id:  معرّف المستخدم.
            ticker:   كود السهم (زي "COMI") — بيتـ normalized uppercase.
            price:    سعر الشراء للسهم الواحد.
            quantity: عدد الأسهم.
            trade_date: تاريخ الصفقة (ISO ``YYYY-MM-DD``). لو ``None`` → اليوم.
            notes:    ملاحظات إضافية.

        Returns:
            dict: ``{success, trade_id, ticker, price, quantity, trade_date}``
            أو ``{success=False, error}`` لو فشل.
        """
        self._ensure_schema()
        if trade_date is None:
            trade_date = date.today().isoformat()
        ticker = (ticker or "").upper().strip()
        try:
            price = float(price)
            quantity = float(quantity)
        except (TypeError, ValueError) as e:
            logger.error("price/quantity مش رقم: %s", e)
            return {"success": False, "error": "invalid price/quantity"}

        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            cur = conn.execute(
                """INSERT INTO user_trades
                   (user_id, ticker, trade_type, price, quantity, trade_date, notes)
                   VALUES (?, ?, 'BUY', ?, ?, ?, ?)""",
                (user_id, ticker, price, quantity, trade_date, notes),
            )
            conn.commit()
            trade_id = cur.lastrowid
            conn.close()
            logger.info(
                "📥 BUY مسجّلة: user=%s ticker=%s price=%.4f qty=%.2f date=%s (id=%d)",
                user_id, ticker, price, quantity, trade_date, trade_id,
            )
            return {
                "success": True,
                "trade_id": trade_id,
                "ticker": ticker,
                "price": price,
                "quantity": quantity,
                "trade_date": trade_date,
            }
        except sqlite3.Error as e:
            logger.error("فشل تسجيل BUY لـ %s: %s", ticker, e)
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # record_sell
    # ------------------------------------------------------------------

    def record_sell(
        self,
        user_id: str,
        ticker: str,
        price: float,
        quantity: float,
        trade_date: Optional[str] = None,
        notes: str = "",
    ) -> dict:
        """
        تسجيل صفقة بيع + حساب الـ outcome تلقائياً.

        Flow:
          1. يسجّل البيع في ``user_trades``.
          2. يلاقي آخر BUY للسهم ده (FIFO) — أقدم BUY مش مرتبط بـ outcome.
          3. يحسب: ``pnl``, ``pnl_pct``, ``holding_days``, ``outcome``.
          4. يجيب: ``prediction_before_buy``, ``maestro_score_before``,
             ``ai_decision_before`` من ``stored_analyses``.
          5. يتحقق: هل فيه ``live_ai_signal`` قبل تاريخ الشراء؟
          6. يخزّن في ``trade_outcomes``.
          7. يرجّع ملخص بالصفقة.

        Args:
            user_id:  معرّف المستخدم.
            ticker:   كود السهم.
            price:    سعر البيع للسهم الواحد.
            quantity: عدد الأسهم.
            trade_date: تاريخ البيع. ``None`` → اليوم.
            notes:    ملاحظات إضافية.

        Returns:
            dict فيه ``sell_id`` + ``outcome_id`` + كل التفاصيل المحسوبة،
            أو ``{success=False, error}`` لو فشل.
        """
        self._ensure_schema()
        if trade_date is None:
            trade_date = date.today().isoformat()
        ticker = (ticker or "").upper().strip()
        try:
            price = float(price)
            quantity = float(quantity)
        except (TypeError, ValueError) as e:
            logger.error("price/quantity مش رقم: %s", e)
            return {"success": False, "error": "invalid price/quantity"}

        # --- 1) تسجيل البيع في user_trades ---
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cur = conn.execute(
                """INSERT INTO user_trades
                   (user_id, ticker, trade_type, price, quantity, trade_date, notes)
                   VALUES (?, ?, 'SELL', ?, ?, ?, ?)""",
                (user_id, ticker, price, quantity, trade_date, notes),
            )
            conn.commit()
            sell_id = cur.lastrowid
        except sqlite3.Error as e:
            logger.error("فشل تسجيل SELL لـ %s: %s", ticker, e)
            return {"success": False, "error": str(e)}

        # --- 2) إيجاد آخر BUY غير مغلق (FIFO) ---
        #    الـ spec بيقول "آخر BUY للسهم ده (FIFO)". هنطبق FIFO صحيح:
        #    نجيب كل BUYs لـ user+ticker مرتبين من الأقدم للأحدث، ونلفّ عليها
        #    لحد ما نلاقي واحد مش مرتبط بـ outcome بالفعل.
        buy_row = None
        try:
            buys = conn.execute(
                """SELECT id, trade_date, price, quantity
                   FROM user_trades
                   WHERE user_id=? AND ticker=? AND trade_type='BUY'
                     AND trade_date <= ?
                   ORDER BY trade_date ASC, id ASC""",
                (user_id, ticker, trade_date),
            ).fetchall()

            # كل buy_dates اللي اتقفلوا في trade_outcomes (matching by date)
            used_buy_dates: set = set()
            try:
                used_rows = conn.execute(
                    """SELECT buy_date FROM trade_outcomes
                       WHERE user_id=? AND ticker=?""",
                    (user_id, ticker),
                ).fetchall()
                used_buy_dates = {
                    r["buy_date"] for r in used_rows if r["buy_date"]
                }
            except sqlite3.Error:
                used_buy_dates = set()

            for b in buys:
                # FIFO: skip لو الـ buy_date ده اتقفل قبل كده
                if b["trade_date"] in used_buy_dates:
                    continue
                buy_row = b
                break
        except sqlite3.Error as e:
            logger.warning("فشل إيجاد BUY لـ %s: %s", ticker, e)

        if buy_row is None:
            logger.warning(
                "مفيش BUY مفتوح لـ %s (user=%s) — SELL اتسجّل من غير outcome",
                ticker, user_id,
            )
            conn.close()
            return {
                "success": True,
                "sell_id": sell_id,
                "outcome_id": None,
                "note": "no open BUY found — SELL recorded without outcome",
            }

        # --- 3) حساب pnl / pnl_pct / holding_days / outcome ---
        buy_price = float(buy_row["price"] or 0)
        buy_date_str = buy_row["trade_date"]
        # الكمية اللي هتُقفل (نستخدم كمية الـ BUY الأصلية عشان الـ outcome يمثّل
        # دورة كاملة من BUY → SELL)
        qty = float(buy_row["quantity"] or quantity)

        pnl = (price - buy_price) * qty
        pnl_pct = (
            ((price - buy_price) / buy_price * 100) if buy_price > 0 else 0.0
        )
        holding_days = self._calc_holding_days(buy_date_str, trade_date)

        # outcome: WIN / LOSS / BREAKEVEN (epsilon عشان نتجنّب أخطاء التقريب)
        EPS = 1e-6
        if pnl > EPS:
            outcome = "WIN"
        elif pnl < -EPS:
            outcome = "LOSS"
        else:
            outcome = "BREAKEVEN"

        # --- 4) prediction_before_buy + maestro_score_before + ai_decision_before ---
        prediction_info = self._get_prediction_before_buy(ticker, buy_date_str)
        prediction_before_buy = (
            prediction_info.get("recommendation") or "NO_PREDICTION"
        )
        maestro_score_before = prediction_info.get("maestro_score")
        ai_decision_before = prediction_info.get("ai_decision")

        # --- 5) had_live_signal قبل الشراء؟ ---
        had_live_signal = self._had_live_signal_before(ticker, buy_date_str)

        # --- 6) تخزين في trade_outcomes ---
        outcome_id = None
        try:
            cur = conn.execute(
                """INSERT INTO trade_outcomes
                   (user_id, ticker, buy_date, buy_price, sell_date, sell_price,
                    quantity, pnl, pnl_pct, holding_days, outcome,
                    prediction_before_buy, maestro_score_before, ai_decision_before,
                    had_live_signal, analyzed)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                (
                    user_id, ticker, buy_date_str, buy_price, trade_date, price,
                    qty, pnl, pnl_pct, holding_days, outcome,
                    prediction_before_buy, maestro_score_before,
                    ai_decision_before, 1 if had_live_signal else 0,
                ),
            )
            conn.commit()
            outcome_id = cur.lastrowid
        except sqlite3.Error as e:
            logger.error("فشل تخزين trade_outcomes لـ %s: %s", ticker, e)
        finally:
            conn.close()

        logger.info(
            "📤 SELL مسجّلة + outcome محسوب: ticker=%s buy=%.4f sell=%.4f qty=%.2f "
            "pnl=%+.2f (%+.2f%%) hold=%dd outcome=%s pred=%s live_sig=%s",
            ticker, buy_price, price, qty, pnl, pnl_pct, holding_days,
            outcome, prediction_before_buy, had_live_signal,
        )

        return {
            "success": True,
            "sell_id": sell_id,
            "outcome_id": outcome_id,
            "ticker": ticker,
            "buy_date": buy_date_str,
            "buy_price": buy_price,
            "sell_date": trade_date,
            "sell_price": price,
            "quantity": qty,
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "holding_days": holding_days,
            "outcome": outcome,
            "prediction_before_buy": prediction_before_buy,
            "maestro_score_before": maestro_score_before,
            "ai_decision_before": ai_decision_before,
            "had_live_signal": had_live_signal,
        }

    # ------------------------------------------------------------------
    # get_user_trades
    # ------------------------------------------------------------------

    def get_user_trades(self, user_id: str, limit: int = 50) -> List[dict]:
        """
        يجيب كل صفقات المستخدم (BUY + SELL) مرتبة من الأحدث للأقدم.

        Args:
            user_id: معرّف المستخدم.
            limit:   أقصى عدد صفقات (default 50).

        Returns:
            List of dicts (الأحدث أولاً) — كل dict فيه كل columns الـ user_trades.
        """
        self._ensure_schema()
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT * FROM user_trades
                   WHERE user_id=?
                   ORDER BY trade_date DESC, id DESC
                   LIMIT ?""",
                (user_id, limit),
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except sqlite3.Error as e:
            logger.error("فشل get_user_trades: %s", e)
            return []

    # ------------------------------------------------------------------
    # get_trade_outcomes
    # ------------------------------------------------------------------

    def get_trade_outcomes(
        self, user_id: Optional[str] = None, limit: int = 50
    ) -> List[dict]:
        """
        يجيب نتائج الصفقات (للتحليل).

        Args:
            user_id: لو ``None`` → كل المستخدمين.
            limit:   أقصى عدد نتائج (default 50).

        Returns:
            List of dicts (الأحدث أولاً) — كل dict فيه كل columns الـ trade_outcomes.
        """
        self._ensure_schema()
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            if user_id:
                rows = conn.execute(
                    """SELECT * FROM trade_outcomes
                       WHERE user_id=?
                       ORDER BY sell_date DESC, id DESC
                       LIMIT ?""",
                    (user_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT * FROM trade_outcomes
                       ORDER BY sell_date DESC, id DESC
                       LIMIT ?""",
                    (limit,),
                ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except sqlite3.Error as e:
            logger.error("فشل get_trade_outcomes: %s", e)
            return []

    # ------------------------------------------------------------------
    # get_performance_stats
    # ------------------------------------------------------------------

    def get_performance_stats(self, user_id: Optional[str] = None) -> dict:
        """
        إحصائيات الأداء:

        - ``total_trades``, ``wins``, ``losses``, ``breakevens``, ``win_rate``
        - ``avg_pnl_pct``, ``avg_holding_days``
        - ``best_trade``, ``worst_trade``
        - ``most_traded_ticker``, ``ticker_counts``

        Args:
            user_id: لو ``None`` → كل المستخدمين.

        Returns:
            dict فيه كل الإحصائيات. لو مفيش outcomes → dict فيه zeros.
        """
        self._ensure_schema()
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            if user_id:
                rows = conn.execute(
                    "SELECT * FROM trade_outcomes WHERE user_id=?",
                    (user_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM trade_outcomes").fetchall()
            conn.close()
        except sqlite3.Error as e:
            logger.error("فشل get_performance_stats: %s", e)
            return {}

        empty_stats = {
            "total_trades": 0,
            "wins": 0,
            "losses": 0,
            "breakevens": 0,
            "win_rate": 0.0,
            "avg_pnl_pct": 0.0,
            "avg_holding_days": 0,
            "best_trade": None,
            "worst_trade": None,
            "most_traded_ticker": None,
            "ticker_counts": {},
        }
        if not rows:
            return empty_stats

        total = len(rows)
        wins = [r for r in rows if r["outcome"] == "WIN"]
        losses = [r for r in rows if r["outcome"] == "LOSS"]
        breakevens = [r for r in rows if r["outcome"] == "BREAKEVEN"]

        win_rate = (len(wins) / total * 100) if total > 0 else 0.0

        avg_pnl_pct = (
            sum((r["pnl_pct"] or 0) for r in rows) / total
        ) if total > 0 else 0.0

        hold_vals = [
            r["holding_days"] for r in rows if r["holding_days"] is not None
        ]
        avg_holding_days = (
            sum(hold_vals) / len(hold_vals) if hold_vals else 0
        )

        best_trade_row = max(rows, key=lambda r: r["pnl_pct"] or -1e9)
        worst_trade_row = min(rows, key=lambda r: r["pnl_pct"] or 1e9)

        # most_traded_ticker
        ticker_counts: Dict[str, int] = {}
        for r in rows:
            t = r["ticker"] or ""
            ticker_counts[t] = ticker_counts.get(t, 0) + 1
        most_traded_ticker = (
            max(ticker_counts.items(), key=lambda x: x[1])[0]
            if ticker_counts
            else None
        )

        return {
            "total_trades": total,
            "wins": len(wins),
            "losses": len(losses),
            "breakevens": len(breakevens),
            "win_rate": round(win_rate, 2),
            "avg_pnl_pct": round(avg_pnl_pct, 2),
            "avg_holding_days": round(avg_holding_days, 1),
            "best_trade": {
                "ticker": best_trade_row["ticker"],
                "pnl_pct": best_trade_row["pnl_pct"],
                "outcome": best_trade_row["outcome"],
            },
            "worst_trade": {
                "ticker": worst_trade_row["ticker"],
                "pnl_pct": worst_trade_row["pnl_pct"],
                "outcome": worst_trade_row["outcome"],
            },
            "most_traded_ticker": most_traded_ticker,
            "ticker_counts": ticker_counts,
        }

    # ------------------------------------------------------------------
    # learn_from_trades
    # ------------------------------------------------------------------

    def learn_from_trades(self, user_id: Optional[str] = None) -> dict:
        """
        الـ learning loop:

        1. يجيب كل ``trade_outcomes`` غير محلّلة (``analyzed=0``).
        2. لكل صفقة:
           a. يحلّل: إيه الـ pattern؟
              (``breakout`` / ``volume_spike`` / ``reversal`` /
              ``accumulation`` / ``unknown``)
           b. يحدّد: الـ ``prediction_before_buy`` كان صح ولا غلط؟
           c. يكتب ``lessons`` (درس مستفاد).
           d. يحدّث ``analyzed=1`` + ``pattern_type`` + ``lessons``.
        3. يرجّع summary:
           ``{analyzed_count, win_rate, common_patterns, missed_opportunities}``

        الـ patterns detection:
          - ``breakout``      : لو ``buy_price`` كان قريب من resistance وكسره
                                (``buy_price > max(highs of last 20 days)``)
          - ``volume_spike``  : لو آخر volume قبل الشراء كان > 2x المتوسط
          - ``reversal``      : لو ``rsi_before_buy`` كان < 30 (oversold)
          - ``accumulation``  : لو volume قبل الشراء كان منتظم + price مستقر
                                (coefficient of variation < 5%)
          - ``unknown``       : لو مفيش data كافي

        Args:
            user_id: لو ``None`` → نحلّل لكل المستخدمين.

        Returns:
            dict فيه الـ summary الموضّح فوق.
        """
        self._ensure_schema()
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            if user_id:
                rows = conn.execute(
                    """SELECT * FROM trade_outcomes
                       WHERE analyzed=0 AND user_id=?""",
                    (user_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM trade_outcomes WHERE analyzed=0"
                ).fetchall()
        except sqlite3.Error as e:
            logger.error("فشل جلب trade_outcomes غير محلّلة: %s", e)
            return {
                "analyzed_count": 0,
                "win_rate": 0.0,
                "common_patterns": {},
                "missed_opportunities": [],
            }

        if not rows:
            logger.info("مفيش trade_outcomes جديدة للتحليل ✓")
            try:
                conn.close()
            except Exception:
                pass
            return {
                "analyzed_count": 0,
                "win_rate": 0.0,
                "common_patterns": {},
                "missed_opportunities": [],
            }

        analyzed_count = 0
        pattern_counts: Dict[str, int] = {}
        missed_opportunities: List[dict] = []
        win_count = 0

        for row in rows:
            row_dict = dict(row)
            ticker = row_dict.get("ticker") or ""
            buy_date = row_dict.get("buy_date")
            buy_price = row_dict.get("buy_price")
            outcome = row_dict.get("outcome") or "BREAKEVEN"

            # --- a) pattern detection ---
            indicators_before = self._gather_indicators_before(
                ticker, buy_date, buy_price
            )
            pattern_type = self._detect_pattern(
                ticker, buy_date, buy_price, indicators_before
            )

            # --- b) prediction accuracy ---
            prediction_acc = self._evaluate_prediction(
                row_dict.get("prediction_before_buy"), outcome
            )

            # --- c) lessons ---
            lessons = self._build_lessons(
                pattern_type=pattern_type,
                outcome=outcome,
                prediction_before=row_dict.get("prediction_before_buy"),
                prediction_accuracy=prediction_acc,
                had_live_signal=bool(row_dict.get("had_live_signal")),
                pnl_pct=row_dict.get("pnl_pct"),
                holding_days=row_dict.get("holding_days"),
                indicators=indicators_before,
            )

            # --- d) update analyzed=1 ---
            try:
                conn.execute(
                    """UPDATE trade_outcomes
                       SET analyzed=1, pattern_type=?, lessons=?
                       WHERE id=?""",
                    (pattern_type, lessons, row_dict["id"]),
                )
                conn.commit()
                analyzed_count += 1
                pattern_counts[pattern_type] = (
                    pattern_counts.get(pattern_type, 0) + 1
                )
                if outcome == "WIN":
                    win_count += 1

                # missed opportunity: WIN + prediction_before != buy/strong_buy
                # يعني المستخدم ربح من سهم المشروع ما قالش عليه شراء
                pred = (row_dict.get("prediction_before_buy") or "").lower()
                if (
                    outcome == "WIN"
                    and pred not in ("buy", "strong_buy")
                    and pred != "no_prediction"
                ):
                    missed_opportunities.append({
                        "ticker": ticker,
                        "buy_date": buy_date,
                        "pnl_pct": row_dict.get("pnl_pct"),
                        "prediction_before": row_dict.get("prediction_before_buy"),
                        "pattern": pattern_type,
                    })
            except sqlite3.Error as e:
                logger.error(
                    "فشل UPDATE trade_outcomes id=%s: %s",
                    row_dict.get("id"), e,
                )

        try:
            conn.close()
        except Exception:
            pass

        win_rate = (
            (win_count / analyzed_count * 100) if analyzed_count > 0 else 0.0
        )

        logger.info(
            "📚 learn_from_trades: حلّلنا %d صفقة | win_rate=%.1f%% | "
            "patterns=%s | missed=%d",
            analyzed_count, win_rate, pattern_counts,
            len(missed_opportunities),
        )

        return {
            "analyzed_count": analyzed_count,
            "win_rate": round(win_rate, 2),
            "common_patterns": pattern_counts,
            "missed_opportunities": missed_opportunities,
        }

    # ==================================================================
    # Helpers — تحليل قبل الشراء
    # ==================================================================

    def _get_prediction_before_buy(
        self, ticker: str, buy_date: Optional[str]
    ) -> dict:
        """
        يجيب ``prediction_before_buy`` + ``maestro_score_before`` +
        ``ai_decision_before`` من ``stored_analyses`` (في predictions.db) لو موجود.

        Args:
            ticker:   كود السهم.
            buy_date: تاريخ الشراء (للـ future filtering — حالياً ناخد آخر row).

        Returns:
            dict: ``{recommendation, maestro_score, ai_decision}``
            أو ``{recommendation: 'NO_PREDICTION'}`` لو مفيش.
        """
        # الـ stored_analyses table ممكن ما تكونش موجودة في الـ DB اللي شغّال
        # (predictions.db حالياً فيه بس live_ai_signals). لازم نـ handle ده.
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            tbl = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='stored_analyses'"
            ).fetchone()
            if not tbl:
                conn.close()
                return {"recommendation": "NO_PREDICTION"}

            row = conn.execute(
                """SELECT recommendation, maestro_score, ai_decision,
                          analysis_json, updated_at
                   FROM stored_analyses
                   WHERE ticker=?
                   ORDER BY updated_at DESC
                   LIMIT 1""",
                (ticker,),
            ).fetchone()
            conn.close()

            if not row:
                return {"recommendation": "NO_PREDICTION"}

            return {
                "recommendation": row["recommendation"] or "NO_PREDICTION",
                "maestro_score": row["maestro_score"],
                "ai_decision": row["ai_decision"],
                "analysis_json": row["analysis_json"],
                "updated_at": row["updated_at"],
            }
        except sqlite3.Error as e:
            logger.warning(
                "فشل _get_prediction_before_buy لـ %s: %s", ticker, e
            )
            return {"recommendation": "NO_PREDICTION"}

    def _had_live_signal_before(
        self, ticker: str, buy_date: Optional[str]
    ) -> bool:
        """
        هل فيه ``live_ai_signal`` قبل تاريخ الشراء؟

        Args:
            ticker:   كود السهم.
            buy_date: تاريخ الشراء (ISO ``YYYY-MM-DD`` أو ISO datetime).

        Returns:
            True لو فيه signal واحد على الأقل قبل buy_date، False غير كده.
        """
        if not buy_date:
            return False
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            tbl = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='live_ai_signals'"
            ).fetchone()
            if not tbl:
                conn.close()
                return False
            row = conn.execute(
                """SELECT COUNT(*) AS n FROM live_ai_signals
                   WHERE ticker=? AND detected_at < ?""",
                (ticker, buy_date),
            ).fetchone()
            conn.close()
            return bool(row and row["n"] > 0)
        except sqlite3.Error as e:
            logger.warning(
                "فشل _had_live_signal_before لـ %s: %s", ticker, e
            )
            return False

    def _gather_indicators_before(
        self,
        ticker: str,
        buy_date: Optional[str],
        buy_price: Optional[float],
    ) -> dict:
        """
        يجمع المؤشرات قبل الشراء من كل المصادر المتاحة:
          - ``stored_analyses`` (rsi عبر ``analysis_json``, ``volume_ratio``,
            ``maestro_score``, ``recommendation``)
          - ``price_history`` (آخر 20 يوم قبل الشراء: closes, volumes, highs)

        Returns:
            dict: ``{rsi, volume_ratio, maestro_score, recommendation,
                  recent_closes, recent_volumes, recent_highs}``.
            الـ lists مرتبة من الأقدم للأحدث (عشان الـ pattern detection يبقى
            منطقي).
        """
        indicators: Dict[str, Any] = {
            "rsi": None,
            "volume_ratio": None,
            "maestro_score": None,
            "recommendation": None,
            "recent_closes": [],
            "recent_volumes": [],
            "recent_highs": [],
        }

        # 1) stored_analyses
        try:
            # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
            _tr_ctx = None
            try:
                if _TRADE_RECORDER_DBM_AVAILABLE:
                    _tr_ctx = _dbm.connection(self.db_path, writable=True)
                    conn = _tr_ctx.__enter__()
                else:
                    raise RuntimeError("db_manager unavailable")
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            tbl = conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name='stored_analyses'"
            ).fetchone()
            if tbl:
                row = conn.execute(
                    """SELECT recommendation, maestro_score, volume_ratio,
                              analysis_json, updated_at
                       FROM stored_analyses
                       WHERE ticker=?
                       ORDER BY updated_at DESC
                       LIMIT 1""",
                    (ticker,),
                ).fetchone()
                if row:
                    indicators["recommendation"] = row["recommendation"]
                    indicators["maestro_score"] = row["maestro_score"]
                    indicators["volume_ratio"] = row["volume_ratio"]
                    # RSI غالباً جوّاز analysis_json
                    try:
                        aj = json.loads(row["analysis_json"] or "{}")
                        if isinstance(aj, dict):
                            rsi_val = aj.get("rsi") or aj.get("RSI")
                            if rsi_val is not None:
                                indicators["rsi"] = float(rsi_val)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass
            conn.close()
        except sqlite3.Error as e:
            logger.warning("فشل قراءة stored_analyses لـ %s: %s", ticker, e)

        # 2) price_history (آخر 20 يوم قبل buy_date)
        if buy_date:
            try:
                # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
                _ph_ctx = None
                try:
                    if _TRADE_RECORDER_DBM_AVAILABLE:
                        _ph_ctx = _dbm.connection(PRICE_HISTORY_DB)
                        conn = _ph_ctx.__enter__()
                    else:
                        raise RuntimeError("db_manager unavailable")
                except Exception:
                    conn = sqlite3.connect(PRICE_HISTORY_DB)
                    _ph_ctx = None
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """SELECT date, close_price, volume, high_price
                       FROM price_history
                       WHERE ticker=? AND date < ?
                       ORDER BY date DESC
                       LIMIT 20""",
                    (ticker, buy_date),
                ).fetchall()
                conn.close()
                # نرجّعهم مرتبين من الأقدم للأحدث
                rows = list(reversed(rows))
                indicators["recent_closes"] = [
                    float(r["close_price"])
                    for r in rows
                    if r["close_price"] is not None
                ]
                indicators["recent_volumes"] = [
                    int(r["volume"])
                    for r in rows
                    if r["volume"] is not None
                ]
                indicators["recent_highs"] = [
                    float(r["high_price"])
                    for r in rows
                    if r["high_price"] is not None
                ]
            except sqlite3.Error as e:
                logger.debug(
                    "price_history غير متاح لـ %s: %s", ticker, e
                )

        return indicators

    def _detect_pattern(
        self,
        ticker: str,
        buy_date: Optional[str],
        buy_price: Optional[float],
        indicators: dict,
    ) -> str:
        """
        كشف الـ pattern بناءً على المؤشرات قبل الشراء.

        Priority (per spec):
          1. ``breakout``      — ``buy_price`` كسر resistance (max high آخر 20 يوم)
          2. ``volume_spike``  — volume آخر يوم قبل الشراء > 2x المتوسط
          3. ``reversal``      — RSI < 30 (oversold)
          4. ``accumulation``  — volume منتظم + price مستقر (CV < 5%)
          5. ``unknown``       — مفيش data كافي

        Args:
            ticker:     كود السهم.
            buy_date:   تاريخ الشراء.
            buy_price:  سعر الشراء.
            indicators: dict من ``_gather_indicators_before``.

        Returns:
            str: ``'breakout'`` / ``'volume_spike'`` / ``'reversal'`` /
            ``'accumulation'`` / ``'unknown'``.
        """
        recent_closes = indicators.get("recent_closes", []) or []
        recent_volumes = indicators.get("recent_volumes", []) or []
        recent_highs = indicators.get("recent_highs", []) or []
        rsi = indicators.get("rsi")

        # 1) breakout: buy_price > max(highs of last 20 days)
        if buy_price and recent_highs:
            try:
                max_high = max(float(h) for h in recent_highs)
                if float(buy_price) > max_high:
                    return "breakout"
            except (TypeError, ValueError):
                pass

        # 2) volume_spike: آخر volume > 2x avg of previous
        if len(recent_volumes) >= 5:
            try:
                last_vol = float(recent_volumes[-1])
                prior = recent_volumes[:-1]
                avg_vol = sum(float(v) for v in prior) / len(prior)
                if avg_vol > 0 and last_vol > 2 * avg_vol:
                    return "volume_spike"
            except (TypeError, ValueError, ZeroDivisionError):
                pass

        # 3) reversal: RSI < 30 (oversold)
        if rsi is not None:
            try:
                if float(rsi) < 30:
                    return "reversal"
            except (TypeError, ValueError):
                pass

        # 4) accumulation: low CV (< 5%) + at least 10 days
        if len(recent_closes) >= 10:
            try:
                closes_f = [float(c) for c in recent_closes]
                avg_close = sum(closes_f) / len(closes_f)
                if avg_close > 0:
                    variance = sum(
                        (c - avg_close) ** 2 for c in closes_f
                    ) / len(closes_f)
                    cv = (variance ** 0.5) / avg_close
                    if cv < 0.05:
                        return "accumulation"
            except (TypeError, ValueError, ZeroDivisionError):
                pass

        return "unknown"

    def _evaluate_prediction(
        self, prediction_before: Optional[str], outcome: str
    ) -> str:
        """
        يقيّم هل الـ prediction قبل الشراء كان صح ولا غلط.

        - ``CORRECT``  : prediction كان ``buy``/``strong_buy`` و ``outcome=WIN``
                         أو ``sell``/``reduce`` و ``outcome=LOSS``
        - ``WRONG``    : prediction كان ``buy`` و ``outcome=LOSS``،
                         أو ``sell`` و ``outcome=WIN``
        - ``NEUTRAL``  : prediction كان ``hold`` / ``NO_PREDICTION`` /
                         ``outcome=BREAKEVEN``

        Args:
            prediction_before: قيمة الـ recommendation قبل الشراء.
            outcome: ``WIN`` / ``LOSS`` / ``BREAKEVEN``.

        Returns:
            ``'CORRECT'`` / ``'WRONG'`` / ``'NEUTRAL'``.
        """
        if not prediction_before:
            return "NEUTRAL"
        pred = prediction_before.lower().strip()

        if pred in ("buy", "strong_buy", "strong buy"):
            if outcome == "WIN":
                return "CORRECT"
            if outcome == "LOSS":
                return "WRONG"
            return "NEUTRAL"
        if pred in ("sell", "reduce", "strong_sell", "strong sell"):
            if outcome == "LOSS":
                return "CORRECT"
            if outcome == "WIN":
                return "WRONG"
            return "NEUTRAL"
        # hold / no_prediction / unknown
        return "NEUTRAL"

    def _build_lessons(
        self,
        pattern_type: str,
        outcome: str,
        prediction_before: Optional[str],
        prediction_accuracy: str,
        had_live_signal: bool,
        pnl_pct: Optional[float],
        holding_days: Optional[int],
        indicators: dict,
    ) -> str:
        """
        يبني درس مستفاد (lessons) كنص عربي بسيط.

        Examples:
          - ``"✅ breakout ناجح (pnl=+20.00%, hold=9d) | الدرس: كسر المقاومة + volume عالي = إشارة شراء قوية. | ✅ المشروع قال buy وكان صح — ثبّت الـ weights دي."``
          - ``"❌ reversal فاشل (pnl=-15.00%, hold=12d) | الدرس: RSI<30 مش دايماً ارتداد؛ في ترند هابط يكمّل النزول."``
          - ``"⚠️ المشروع ما قالش شراء (hold) و الصفقة ربحت — راجع indicators اللي فاتك."``

        Args:
            pattern_type:         ``breakout`` / ``volume_spike`` / ``reversal`` /
                                  ``accumulation`` / ``unknown``.
            outcome:              ``WIN`` / ``LOSS`` / ``BREAKEVEN``.
            prediction_before:    recommendation قبل الشراء.
            prediction_accuracy:  ``CORRECT`` / ``WRONG`` / ``NEUTRAL``.
            had_live_signal:      هل فيه ``live_ai_signal`` قبل الشراء؟
            pnl_pct:              نسبة الربح/الخسارة.
            holding_days:         مدة الاحتفاظ بالسهم.
            indicators:           dict من ``_gather_indicators_before``.

        Returns:
            str: الدروس مفصولة بـ ``" | "``.
        """
        parts: List[str] = []
        pnl_str = f"{pnl_pct:+.2f}%" if pnl_pct is not None else "N/A"
        hold_str = f"{holding_days}d" if holding_days is not None else "N/A"

        # 1) الـ pattern + outcome
        if outcome == "WIN":
            parts.append(
                f"✅ {pattern_type} ناجح (pnl={pnl_str}, hold={hold_str})"
            )
        elif outcome == "LOSS":
            parts.append(
                f"❌ {pattern_type} فاشل (pnl={pnl_str}, hold={hold_str})"
            )
        else:
            parts.append(
                f"➖ {pattern_type} محايد (pnl={pnl_str}, hold={hold_str})"
            )

        # 2) درس حسب الـ pattern
        if pattern_type == "breakout":
            if outcome == "WIN":
                parts.append(
                    "الدرس: كسر المقاومة + volume عالي = إشارة شراء قوية."
                )
            else:
                parts.append(
                    "الدرس: كسر مزيف (false breakout) — استنّ تأكيد بإغلاق "
                    "يومي فوق المقاومة."
                )
        elif pattern_type == "volume_spike":
            if outcome == "WIN":
                parts.append(
                    "الدرس: volume spike قبل الشراء مؤشر مبكر ذكي — كرّره."
                )
            else:
                parts.append(
                    "الدرس: volume spike مش كافي — تأكد إنه مش بيع قوي "
                    "(distribution)."
                )
        elif pattern_type == "reversal":
            if outcome == "WIN":
                parts.append(
                    "الدرس: RSI<30 + ارتداد ناجح — التشبع البيعي فرصة شراء "
                    "في ترند صاعد."
                )
            else:
                parts.append(
                    "الدرس: RSI<30 مش دايماً ارتداد؛ في ترند هابط يكمّل النزول."
                )
        elif pattern_type == "accumulation":
            if outcome == "WIN":
                parts.append(
                    "الدرس: تجميع هادي قبل الانفجار — الصبر على الـ "
                    "accumulation مربح."
                )
            else:
                parts.append(
                    "الدرس: الـ accumulation ممكن يطول؛ حدّد stop loss زمني."
                )
        else:  # unknown
            parts.append(
                "الدرس: مفيش data كافي قبل الشراء — حط indicators أوضح في "
                "الـ journal."
            )

        # 3) دقة الـ prediction
        if prediction_accuracy == "WRONG":
            parts.append(
                f"⚠️ المشروع قال {prediction_before} بس النتيجة عكسية — راجع "
                f"weights الـ indicators."
            )
        elif prediction_accuracy == "CORRECT":
            parts.append(
                f"✅ المشروع قال {prediction_before} وكان صح — ثبّت الـ weights دي."
            )

        # 4) live signal
        if had_live_signal and outcome == "WIN":
            parts.append(
                "📡 فيه live_ai_signal قبل الشراء — كرّر الاعتماد عليه."
            )
        elif not had_live_signal and outcome == "WIN":
            parts.append(
                "🚨 مفيش live_ai_signal قبل الشراء و الصفقة ربحت — الـ monitor "
                "فاتته فرصة!"
            )

        return " | ".join(parts)

    def _calc_holding_days(
        self, buy_date_str: Optional[str], sell_date_str: Optional[str]
    ) -> int:
        """
        يحسب عدد أيام الاحتفاظ بين buy و sell.

        Args:
            buy_date_str:  ISO ``YYYY-MM-DD`` أو ISO datetime.
            sell_date_str: ISO ``YYYY-MM-DD`` أو ISO datetime.

        Returns:
            عدد الأيام (``>= 0``). لو فشل parse → 0.
        """
        if not buy_date_str or not sell_date_str:
            return 0
        try:
            # ندعم YYYY-MM-DD و ISO datetime (نأخذ أول 10 chars = التاريخ)
            b = datetime.fromisoformat(str(buy_date_str)[:10])
            s = datetime.fromisoformat(str(sell_date_str)[:10])
            return max((s - b).days, 0)
        except (TypeError, ValueError) as e:
            logger.debug(
                "فشل parse dates (buy=%s sell=%s): %s",
                buy_date_str, sell_date_str, e,
            )
            return 0


# ============================================================================
# Self-test
# ============================================================================

def main() -> None:
    """
    self-test:
      1. يسجّل BUY لـ ELKA بـ price=10, quantity=100
      2. يسجّل SELL لـ ELKA بـ price=12, quantity=100
      3. يطبع الـ outcome
      4. يطبع الـ performance stats
      5. يشغّل learn_from_trades
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    print(f"\n{'=' * 70}")
    print("📚 Trade Recorder + Learning Loop — Self Test")
    print(f"{'=' * 70}")
    print(f"  PREDICTIONS_DB    : {PREDICTIONS_DB}")
    print(f"  STOCKS_DB         : {STOCKS_DB}")
    print(f"  PRICE_HISTORY_DB  : {PRICE_HISTORY_DB}")

    rec = TradeRecorder()

    # 1) BUY ELKA @ 10 × 100
    print("\n--- 1) BUY ELKA @ 10 × 100 ---")
    buy = rec.record_buy(
        user_id="self_test_user",
        ticker="ELKA",
        price=10.0,
        quantity=100,
        trade_date="2025-06-01",
        notes="self-test buy",
    )
    print(f"  → {buy}")

    # 2) SELL ELKA @ 12 × 100 (+20%)
    print("\n--- 2) SELL ELKA @ 12 × 100 ---")
    sell = rec.record_sell(
        user_id="self_test_user",
        ticker="ELKA",
        price=12.0,
        quantity=100,
        trade_date="2025-06-10",
        notes="self-test sell",
    )
    print(f"  → {sell}")

    # 3) outcomes (قبل learning)
    print("\n--- 3) Trade outcomes (قبل learning) ---")
    outcomes = rec.get_trade_outcomes(user_id="self_test_user", limit=10)
    for o in outcomes:
        print(
            f"  • id={o['id']} {o['ticker']} "
            f"buy={o['buy_price']} sell={o['sell_price']} "
            f"pnl={o['pnl']:+.2f} ({o['pnl_pct']:+.2f}%) "
            f"hold={o['holding_days']}d outcome={o['outcome']} "
            f"pred={o['prediction_before_buy']} "
            f"live_sig={o['had_live_signal']} analyzed={o['analyzed']}"
        )

    # 4) performance stats
    print("\n--- 4) Performance stats ---")
    stats = rec.get_performance_stats(user_id="self_test_user")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    # 5) learn_from_trades
    print("\n--- 5) Learning loop ---")
    summary = rec.learn_from_trades(user_id="self_test_user")
    print(f"  analyzed_count      : {summary.get('analyzed_count')}")
    print(f"  win_rate            : {summary.get('win_rate')}%")
    print(f"  common_patterns     : {summary.get('common_patterns')}")
    print(f"  missed_opportunities: {summary.get('missed_opportunities')}")

    # 6) outcomes بعد learning (نشوف pattern_type + lessons)
    print("\n--- 6) Outcomes بعد learning ---")
    outcomes2 = rec.get_trade_outcomes(user_id="self_test_user", limit=10)
    for o in outcomes2:
        print(
            f"  • {o['ticker']} pattern={o['pattern_type']} "
            f"analyzed={o['analyzed']}"
        )
        print(f"    lessons: {o['lessons']}")

    # 7) كل user_trades
    print("\n--- 7) كل user_trades ---")
    trades = rec.get_user_trades(user_id="self_test_user", limit=20)
    for t in trades:
        print(
            f"  • id={t['id']} {t['ticker']} {t['trade_type']} "
            f"price={t['price']} qty={t['quantity']} date={t['trade_date']}"
        )

    print(f"\n{'=' * 70}\n")


if __name__ == "__main__":
    main()
