#!/usr/bin/env python3
"""
Bag-Holder Rescue Engine
========================
For the client who bought a stock and is now underwater, this engine produces
a single, decisive recommendation in Egyptian Arabic:

    اصبر  (HOLD)
    اعمل متوسط (AVERAGE_DOWN)
    اقطع الخسارة (CUT_LOSS)

Decision matrix (priority order — first match wins):
  1. loss < 5% AND company profitable                       → HOLD
  2. purchase at/near historical peak AND loss > 15%         → CUT_LOSS
  3. purchase mid-range AND profitable AND loss < 25%        → AVERAGE_DOWN
  4. company NOT profitable AND loss > 10%                   → CUT_LOSS
  5. purchase near/at historical bottom                      → HOLD
  6. default                                                  → HOLD

Data sources:
  - stocks.db:        portfolio_assets, macro_indicators (we don't have a
                      `stocks` table here in the sandbox, but the engine
                      still tries to read it for current price/high/low).
  - data_engine.db:   `stocks` table — live price + tabs_data (RSI/MACD).
                      Used as the primary source for current_price in the
                      sandbox.
  - predictions.db:   `stored_analyses` + `predictions` — fallback for
                      current price + fundamental_score (proxy for
                      company profitability).
  - price_history.db: `price_history` table (ticker, date, high_price,
                      low_price, close_price) — 52-week/all-time high/low.
                      Falls back to stocks.db high_price/low_price if
                      missing.

Only Python stdlib is used (sqlite3, datetime, math, os).
"""

from __future__ import annotations

import math
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# analyzers/ -> vps-service/ -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / "db"

STOCKS_DB_PATH = DB_DIR / "stocks.db"
DATA_ENGINE_DB_PATH = DB_DIR / "data_engine.db"
PREDICTIONS_DB_PATH = DB_DIR / "predictions.db"
PRICE_HISTORY_DB_PATH = DB_DIR / "price_history.db"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _open_ro(path: Path) -> Optional[sqlite3.Connection]:
    """Open a DB read-only with a short timeout. Returns None if missing."""
    if not path.exists():
        return None
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(path, writable=False)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
        return None


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        return row is not None
    except sqlite3.Error:
        return False


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class BagHolderRescue:
    """Analyze a stuck position and recommend HOLD / AVERAGE_DOWN / CUT_LOSS.

    Usage:
        rescuer = BagHolderRescue()
        result = rescuer.analyze("COMI", purchase_price=150.0, shares=100)
    """

    def __init__(self, db_dir: Optional[str] = None) -> None:
        if db_dir:
            self.stocks_db = Path(db_dir) / "stocks.db"
            self.data_engine_db = Path(db_dir) / "data_engine.db"
            self.predictions_db = Path(db_dir) / "predictions.db"
            self.price_history_db = Path(db_dir) / "price_history.db"
        else:
            self.stocks_db = STOCKS_DB_PATH
            self.data_engine_db = DATA_ENGINE_DB_PATH
            self.predictions_db = PREDICTIONS_DB_PATH
            self.price_history_db = PRICE_HISTORY_DB_PATH

    # ------------------------------------------------------------------
    # Price + historical range
    # ------------------------------------------------------------------

    def _fetch_current_price_and_range(
        self, ticker: str
    ) -> Tuple[float, float, float, str]:
        """Return (current_price, historical_high, historical_low, source).

        Tries price_history.db first (true OHLC history), then data_engine.db
        (live price), then stocks.db (high/low columns if present), then
        predictions.db (entry_price as a last-resort current price).

        Falls back to estimates (price*1.2 / price*0.8) when no history
        exists at all.
        """
        current_price = 0.0
        historical_high = 0.0
        historical_low = 0.0
        source = "unknown"

        # 1. price_history.db — true OHLC history.
        ph = _open_ro(self.price_history_db)
        if ph is not None:
            try:
                if _table_exists(ph, "price_history"):
                    row = ph.execute(
                        """
                        SELECT
                            MAX(high_price) AS h,
                            MIN(low_price)  AS l,
                            (SELECT close_price FROM price_history
                             WHERE ticker = ? AND close_price IS NOT NULL
                             ORDER BY date DESC LIMIT 1) AS last_close,
                            COUNT(*) AS cnt
                        FROM price_history
                        WHERE ticker = ?
                        """,
                        (ticker.upper(), ticker.upper()),
                    ).fetchone()
                    if row and row["cnt"] and row["cnt"] > 0:
                        historical_high = _safe_float(row["h"])
                        historical_low = _safe_float(row["l"])
                        if row["last_close"]:
                            current_price = _safe_float(row["last_close"])
                        source = "price_history.db"
            except sqlite3.Error:
                pass
            finally:
                ph.close()

        # 2. data_engine.db — live price (sandbox primary source).
        if current_price <= 0:
            de = _open_ro(self.data_engine_db)
            if de is not None:
                try:
                    if _table_exists(de, "stocks"):
                        row = de.execute(
                            "SELECT price FROM stocks WHERE symbol = ? OR symbol LIKE ?",
                            (ticker.upper(), f"{ticker.upper()}%"),
                        ).fetchone()
                        if row and row["price"]:
                            current_price = _safe_float(row["price"])
                            if source == "unknown":
                                source = "data_engine.db"
                except sqlite3.Error:
                    pass
                finally:
                    de.close()

        # 3. stocks.db — try a `stocks` table if it exists on this VPS.
        if current_price <= 0 or historical_high <= 0:
            sd = _open_ro(self.stocks_db)
            if sd is not None:
                try:
                    if _table_exists(sd, "stocks"):
                        cols = [r[1].lower() for r in sd.execute(
                            "PRAGMA table_info(stocks)"
                        ).fetchall()]
                        cp_col = next(
                            (c for c in cols if c in ("current_price", "price", "close", "last_price")),
                            None,
                        )
                        hi_col = next(
                            (c for c in cols if c in ("high_price", "high", "year_high", "all_time_high")),
                            None,
                        )
                        lo_col = next(
                            (c for c in cols if c in ("low_price", "low", "year_low", "all_time_low")),
                            None,
                        )
                        if cp_col or hi_col or lo_col:
                            sel = ", ".join(filter(None, [cp_col, hi_col, lo_col]))
                            row = sd.execute(
                                f"SELECT {sel} FROM stocks WHERE ticker = ? OR ticker LIKE ? OR symbol = ?",
                                (ticker.upper(), f"{ticker.upper()}%", ticker.upper()),
                            ).fetchone()
                            if row:
                                if cp_col and current_price <= 0:
                                    current_price = _safe_float(row[cp_col])
                                if hi_col and historical_high <= 0:
                                    historical_high = _safe_float(row[hi_col])
                                if lo_col and historical_low <= 0:
                                    historical_low = _safe_float(row[lo_col])
                                if source == "unknown":
                                    source = "stocks.db"
                except sqlite3.Error:
                    pass
                finally:
                    sd.close()

        # 4. predictions.db — last-resort current price from stored analyses.
        if current_price <= 0:
            pd = _open_ro(self.predictions_db)
            if pd is not None:
                try:
                    if _table_exists(pd, "stored_analyses"):
                        row = pd.execute(
                            "SELECT entry_price FROM stored_analyses WHERE ticker = ? ORDER BY updated_at DESC LIMIT 1",
                            (ticker.upper(),),
                        ).fetchone()
                        if row and row["entry_price"]:
                            current_price = _safe_float(row["entry_price"])
                            if source == "unknown":
                                source = "predictions.db(stored_analyses)"
                except sqlite3.Error:
                    pass
                finally:
                    pd.close()

        # 5. Final fallback — if we still have nothing, use the purchase
        #    price as the current price (caller will see loss_pct = 0).
        #    If we have current_price but no high/low, estimate ±20%.
        if current_price <= 0:
            current_price = 0.0
        if historical_high <= 0:
            historical_high = current_price * 1.2 if current_price > 0 else 0.0
        if historical_low <= 0:
            # Don't go below zero; use 80% of current as a rough floor.
            historical_low = current_price * 0.8 if current_price > 0 else 0.0

        return current_price, historical_high, historical_low, source

    # ------------------------------------------------------------------
    # Company profitability
    # ------------------------------------------------------------------

    def _fetch_company_profitability(self, ticker: str) -> Tuple[Optional[bool], str]:
        """Return (is_profitable, note).

        is_profitable is True/False/None:
          - True  → company is profitable
          - False → company is loss-making
          - None  → unknown / no data

        We try (in order):
          a. stocks.db `stocks` table — look for net_income / earnings / eps / profit columns.
          b. data_engine.db `stock_fundamentals` table (production VPS) — pe_ratio / eps / net_profit.
          c. predictions.db `predictions.fundamental_score` (0-100, default 50).
             > 60 → profitable, < 40 → not profitable, otherwise unknown.
        """
        # (a) stocks.db `stocks` table — fundamentals inline.
        sd = _open_ro(self.stocks_db)
        if sd is not None:
            try:
                if _table_exists(sd, "stocks"):
                    cols = [r[1].lower() for r in sd.execute(
                        "PRAGMA table_info(stocks)"
                    ).fetchall()]
                    profit_col = next(
                        (c for c in cols if c in ("net_income", "earnings", "profit", "net_profit")),
                        None,
                    )
                    eps_col = next(
                        (c for c in cols if c in ("eps", "eps_value", "earnings_per_share")),
                        None,
                    )
                    if profit_col or eps_col:
                        sel = ", ".join(filter(None, [profit_col, eps_col]))
                        row = sd.execute(
                            f"SELECT {sel} FROM stocks WHERE ticker = ? OR ticker LIKE ?",
                            (ticker.upper(), f"{ticker.upper()}%"),
                        ).fetchone()
                        if row:
                            if profit_col and row[profit_col] is not None:
                                val = _safe_float(row[profit_col])
                                return (val > 0, f"net_income={val:.0f}")
                            if eps_col and row[eps_col] is not None:
                                val = _safe_float(row[eps_col])
                                return (val > 0, f"eps={val:.2f}")
            except sqlite3.Error:
                pass
            finally:
                sd.close()

        # (b) data_engine.db `stock_fundamentals` (production VPS).
        de = _open_ro(self.data_engine_db)
        if de is not None:
            try:
                if _table_exists(de, "stock_fundamentals"):
                    cols = [r[1].lower() for r in de.execute(
                        "PRAGMA table_info(stock_fundamentals)"
                    ).fetchall()]
                    profit_col = next(
                        (c for c in cols if c in ("net_profit", "net_income", "profit", "earnings")),
                        None,
                    )
                    eps_col = next(
                        (c for c in cols if c in ("eps",)),
                        None,
                    )
                    pe_col = next(
                        (c for c in cols if c in ("pe_ratio", "pe")),
                        None,
                    )
                    sel_cols = [c for c in (profit_col, eps_col, pe_col) if c]
                    if sel_cols:
                        sel = ", ".join(sel_cols)
                        row = de.execute(
                            f"SELECT {sel} FROM stock_fundamentals WHERE ticker = ? LIMIT 1",
                            (ticker.upper(),),
                        ).fetchone()
                        if row:
                            notes = []
                            if profit_col and row[profit_col] is not None:
                                val = _safe_float(row[profit_col])
                                notes.append(f"net_profit={val:.0f}")
                                if val != 0:
                                    return (val > 0, ", ".join(notes))
                            if eps_col and row[eps_col] is not None:
                                val = _safe_float(row[eps_col])
                                notes.append(f"eps={val:.2f}")
                                if val != 0:
                                    return (val > 0, ", ".join(notes))
                            if pe_col and row[pe_col] is not None:
                                val = _safe_float(row[pe_col])
                                notes.append(f"pe={val:.1f}")
                                # Positive PE → profitable.
                                if val > 0:
                                    return (True, ", ".join(notes))
                                if val < 0:
                                    return (False, ", ".join(notes))
                            if notes:
                                return (None, ", ".join(notes))
            except sqlite3.Error:
                pass
            finally:
                de.close()

        # (c) predictions.db — fundamental_score proxy.
        pd = _open_ro(self.predictions_db)
        if pd is not None:
            try:
                if _table_exists(pd, "predictions"):
                    row = pd.execute(
                        """
                        SELECT AVG(fundamental_score) AS avg_score, COUNT(*) AS cnt
                        FROM predictions
                        WHERE ticker = ? AND fundamental_score IS NOT NULL
                        """,
                        (ticker.upper(),),
                    ).fetchone()
                    if row and row["cnt"] and row["cnt"] > 0:
                        score = _safe_float(row["avg_score"])
                        if score >= 60:
                            return (True, f"fundamental_score(avg)={score:.0f}")
                        if score <= 40:
                            return (False, f"fundamental_score(avg)={score:.0f}")
                        return (None, f"fundamental_score(avg)={score:.0f} (neutral)")
            except sqlite3.Error:
                pass
            finally:
                pd.close()

        return (None, "no fundamental data available")

    # ------------------------------------------------------------------
    # Purchase vs peak classification
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_purchase_vs_peak(
        purchase_price: float, historical_high: float, historical_low: float
    ) -> str:
        """Classify where the purchase price sits in the historical range.

        Returns one of:
          AT_PEAK / NEAR_PEAK / MID_RANGE / NEAR_BOTTOM / AT_BOTTOM
        """
        if purchase_price <= 0 or historical_high <= 0:
            return "MID_RANGE"

        # Distance below the historical high (as % of high).
        dist_from_high_pct = (
            (historical_high - purchase_price) / historical_high * 100.0
        )

        # Distance above the historical low (as % of low).
        dist_from_low_pct = (
            (purchase_price - historical_low) / historical_low * 100.0
            if historical_low > 0 else 999.0
        )

        # Within 5% of high → AT_PEAK
        if dist_from_high_pct <= 5.0:
            return "AT_PEAK"
        # Within 15% of high → NEAR_PEAK
        if dist_from_high_pct <= 15.0:
            return "NEAR_PEAK"
        # Within 5% of low → AT_BOTTOM
        if dist_from_low_pct <= 5.0:
            return "AT_BOTTOM"
        # Within 15% of low → NEAR_BOTTOM
        if dist_from_low_pct <= 15.0:
            return "NEAR_BOTTOM"
        # Otherwise — middle of the range.
        return "MID_RANGE"

    # ------------------------------------------------------------------
    # Arabic reasoning
    # ------------------------------------------------------------------

    @staticmethod
    def _reasoning_ar(
        ticker: str,
        recommendation: str,
        loss_pct: float,
        purchase_price: float,
        current_price: float,
        historical_high: float,
        historical_low: float,
        purchase_vs_peak: str,
        is_profitable: Optional[bool],
    ) -> str:
        """Generate a 3-4 sentence human-style Arabic explanation."""
        profitable_str = (
            "الشركة ربحانية" if is_profitable is True
            else "الشركة خاسرة" if is_profitable is False
            else "مفيش بيانات ربحانية كافية"
        )
        peak_str = {
            "AT_PEAK": "أنت اشتريت قرب القمة التاريخية",
            "NEAR_PEAK": "أنت اشتريت في النص العلوي من النطاق التاريخي",
            "MID_RANGE": "أنت اشتريت في نص النطاق التاريخي",
            "NEAR_BOTTOM": "أنت اشتريت قرب القاع التاريخي",
            "AT_BOTTOM": "أنت اشتريت قرب القاع التاريخي",
        }.get(purchase_vs_peak, "أنت اشتريت في نص النطاق التاريخي")

        loss_phrase = (
            f"خسران {abs(loss_pct):.1f}%" if loss_pct < 0
            else f"رابح {loss_pct:.1f}%" if loss_pct > 0
            else "سعرك قريب من السعر الحالي"
        )

        if recommendation == "CUT_LOSS":
            return (
                f"أنت {loss_phrase} في {ticker} — اشتريت عند {purchase_price:.2f} "
                f"والسهم حالياً {current_price:.2f}. {peak_str} (القمة التاريخية {historical_high:.2f}، "
                f"القاع {historical_low:.2f})، و{profitable_str}. "
                f"القمة دي بتشتغل كمقاومة قوية يصعب كسرها بسرعة، وفضلك في السهم ممكن يكلّفك فرص بديلة. "
                f"اقطع الخسارة وحط الفلوس في سهم بفرصة أحسن و fundamentals أقوى."
            )
        if recommendation == "AVERAGE_DOWN":
            return (
                f"أنت {loss_phrase} في {ticker} — اشتريت عند {purchase_price:.2f} والسهم حالياً {current_price:.2f}. "
                f"{peak_str} و{profitable_str}. "
                f"الشركة لسه شغّالة كويس والسعر نزل تحت متوسط تكلفة معقولة — اعمل متوسط (Average Down) "
                f"عشان تقلل متوسط سعر الشراء وتقرب نقطة التعادل. "
                f"بس متزودش المركز أكتر من 25-30% من حجمك الأصلي، وراقب الأساسيات كل ربع سنة."
            )
        # HOLD (default)
        if loss_pct >= 0:
            return (
                f"أنت {loss_phrase} في {ticker} — اشتريت عند {purchase_price:.2f} والسهم حالياً {current_price:.2f}. "
                f"{peak_str} و{profitable_str}. "
                f"الخسارة لسه صغيرة والشركة وضعها ممتاز — اصبر على المركز. "
                f"حط وقف خسارة تحت سعر الشراء بنسبة 5-8% عشان تحمي ربحك لو السهم اتعرض لخبر سلبي مفاجئ."
            )
        return (
            f"أنت {loss_phrase} في {ticker} — اشتريت عند {purchase_price:.2f} والسهم حالياً {current_price:.2f}. "
            f"{peak_str} و{profitable_str}. "
            f"الخسارة لسه في النطاق المقبول والشركة لسه شغّالة. اصبر على المركز ومتبيعش في ذعر. "
            f"راقب الأساسيات كل شهر، ولو الخسارة زادت فوق 20% مع تدهور في fundamentals، فكر تقطع."
        )

    # ------------------------------------------------------------------
    # Main analyze()
    # ------------------------------------------------------------------

    def analyze(
        self,
        ticker: str,
        purchase_price: float,
        shares: float = 0,
    ) -> Dict[str, Any]:
        """Analyze a stuck position and recommend HOLD/AVG/CUT.

        Args:
            ticker:         Stock ticker (e.g. "COMI").
            purchase_price: The client's average buy price.
            shares:         Number of shares held (used only for EGP math).

        Returns:
            Full analysis dict (see module docstring for keys).
        """
        ticker = (ticker or "").upper().strip()
        purchase_price = _safe_float(purchase_price)
        shares = _safe_float(shares)

        # 1. Fetch current price + historical range.
        current_price, historical_high, historical_low, price_source = (
            self._fetch_current_price_and_range(ticker)
        )

        # 2. Loss percentage (negative = losing).
        if purchase_price > 0 and current_price > 0:
            loss_pct = (current_price - purchase_price) / purchase_price * 100.0
        else:
            loss_pct = 0.0

        # 3. Purchase-vs-peak classification.
        purchase_vs_peak = self._classify_purchase_vs_peak(
            purchase_price, historical_high, historical_low
        )

        # 4. Company profitability.
        is_profitable, profitability_note = self._fetch_company_profitability(ticker)

        # 5. Decision logic — first match wins.
        recommendation = "HOLD"
        recommendation_ar = "اصبر"

        # Rule 1: tiny loss AND profitable → HOLD
        if loss_pct > -5.0 and is_profitable is True:
            recommendation = "HOLD"
            recommendation_ar = "اصبر"
        # Rule 2: bought at/near peak AND deep loss → CUT_LOSS
        elif purchase_vs_peak in ("AT_PEAK", "NEAR_PEAK") and loss_pct < -15.0:
            recommendation = "CUT_LOSS"
            recommendation_ar = "اقطع الخسارة"
        # Rule 3: mid-range + profitable + not-too-deep loss → AVERAGE_DOWN
        elif (
            purchase_vs_peak == "MID_RANGE"
            and is_profitable is True
            and loss_pct > -25.0
        ):
            recommendation = "AVERAGE_DOWN"
            recommendation_ar = "اعمل متوسط"
        # Rule 4: not profitable + material loss → CUT_LOSS
        elif is_profitable is False and loss_pct < -10.0:
            recommendation = "CUT_LOSS"
            recommendation_ar = "اقطع الخسارة"
        # Rule 5: near/at bottom → HOLD (wait for recovery)
        elif purchase_vs_peak in ("NEAR_BOTTOM", "AT_BOTTOM"):
            recommendation = "HOLD"
            recommendation_ar = "اصبر"
        # Rule 6: default → HOLD
        else:
            recommendation = "HOLD"
            recommendation_ar = "اصبر"

        # 6. Reasoning text.
        reasoning_ar = self._reasoning_ar(
            ticker, recommendation, loss_pct,
            purchase_price, current_price,
            historical_high, historical_low,
            purchase_vs_peak, is_profitable,
        )

        # 7. EGP math.
        invested_egp = purchase_price * shares
        market_value_egp = current_price * shares
        loss_egp = (current_price - purchase_price) * shares
        # How much the price needs to recover to break even.
        if current_price > 0 and current_price < purchase_price:
            recovery_needed_pct = (
                (purchase_price - current_price) / current_price * 100.0
            )
        else:
            recovery_needed_pct = 0.0

        # 8. Urgency for UI badges.
        if recommendation == "CUT_LOSS":
            urgency = "high"
        elif recommendation == "AVERAGE_DOWN":
            urgency = "medium"
        else:
            urgency = "low"

        return {
            "ticker": ticker,
            "purchase_price": round(purchase_price, 4),
            "current_price": round(current_price, 4),
            "shares": shares,
            "invested_egp": round(invested_egp, 2),
            "market_value_egp": round(market_value_egp, 2),
            "loss_pct": round(loss_pct, 2),
            "loss_egp": round(loss_egp, 2),
            "historical_high": round(historical_high, 4),
            "historical_low": round(historical_low, 4),
            "purchase_vs_peak": purchase_vs_peak,
            "company_profitable": is_profitable,
            "profitability_note": profitability_note,
            "recommendation": recommendation,
            "recommendation_ar": recommendation_ar,
            "urgency": urgency,
            "reasoning_ar": reasoning_ar,
            "recovery_needed_pct": round(recovery_needed_pct, 2),
            "price_source": price_source,
            "analyzed_at": datetime.now().isoformat(timespec="seconds"),
        }

    # ===================================================================
    # Task BRAVO-STANDALONE-RESCUE-CLINIC-API (Owner Directive 2026-10-13)
    # ===================================================================
    # analyze_clinic(): يُرجع الـ payload المؤسسي الكامل لعيادة الإنقاذ.
    # يعيد: decision / autopsy / asset_health / action_plan / lessons_learned.
    # ===================================================================
    def analyze_clinic(
        self,
        ticker: str,
        buy_price: float,
        quantity: float,
        buy_date: str = "",
    ) -> Dict[str, Any]:
        """تحليل تشريحي صادم لصفقة متعثرة + خطة تعافي محسوبة بالمليمتر.

        Rule 27 (NO-FAKE-DATA): كل الأرقام من DBs حقيقية.
        Rule 20 (PYTHON = BRAIN): كل المنطق في Python.

        Args:
            ticker:    رمز السهم (مثل 'EGREF').
            buy_price: سعر الشراء الأصلي للعميل.
            quantity:  الكمية المملوكة.
            buy_date:  تاريخ الشراء (اختياري).

        Returns:
            Payload كامل بصيغة عيادة الإنقاذ (见 التكليف).
        """
        # 1. استدعِ analyze() الأساسي للحصول على الأرقام الأساسية.
        base = self.analyze(ticker, buy_price, quantity)

        current_price = _safe_float(base.get("current_price"))
        # Task RESCUE-CLINIC: fallback لو current_price = 0 (مشكلة شائعة في الساندبوكس)
        # اقرأ آخر close من stock_daily_prices + stocks.current_price
        if current_price <= 0:
            try:
                conn = _open_ro(STOCKS_DB_PATH)
                if conn:
                    # جرّب stocks.current_price أولاً
                    row = conn.execute(
                        "SELECT current_price FROM stocks WHERE ticker = ?",
                        (ticker.upper().strip(),),
                    ).fetchone()
                    if row and row[0]:
                        current_price = _safe_float(row[0])
                    # لو لسه 0 → اقرأ آخر close من stock_daily_prices
                    if current_price <= 0:
                        row2 = conn.execute(
                            """SELECT COALESCE(close, close_price) as close
                               FROM stock_daily_prices
                               WHERE ticker = ? AND COALESCE(close, close_price) IS NOT NULL
                                     AND COALESCE(close, close_price) > 0
                               ORDER BY price_date DESC LIMIT 1""",
                            (ticker.upper().strip(),),
                        ).fetchone()
                        if row2 and row2[0]:
                            current_price = _safe_float(row2[0])
                    conn.close()
            except Exception:
                pass

        # أعد حساب loss_pct + loss_egp بالسعر الصحيح
        if buy_price > 0 and current_price > 0:
            loss_pct = (current_price - buy_price) / buy_price * 100.0
        else:
            loss_pct = 0.0
        loss_egp = (current_price - buy_price) * quantity

        recommendation = base.get("recommendation", "HOLD")
        recommendation_ar = base.get("recommendation_ar", "اصبر")
        purchase_vs_peak = base.get("purchase_vs_peak", "MID_RANGE")
        is_profitable = base.get("company_profitable")
        historical_high = _safe_float(base.get("historical_high"))
        historical_low = _safe_float(base.get("historical_low"))
        support = _safe_float(base.get("support", 0)) or _safe_float(
            self._fetch_support_resistance(ticker)[0]
        )
        resistance = _safe_float(base.get("resistance", 0)) or _safe_float(
            self._fetch_support_resistance(ticker)[1]
        )

        # 2. Falling Knife detection (من institutional_levels.py).
        is_falling_knife = False
        falling_knife_reason = ""
        resistance_zones: list = []
        try:
            from analyzers.institutional_levels import detect_falling_knife
            # اقرأ آخر 60 شمعة من stocks.db
            candles = self._fetch_price_candles(ticker, 60)
            if candles:
                ma50 = _safe_float(base.get("ma_50", 0))
                ma200 = _safe_float(base.get("ma_200", 0))
                fk = detect_falling_knife(candles, ma50, ma200)
                is_falling_knife = fk.get("is_falling_knife", False)
                falling_knife_reason = fk.get("reason", "")
                resistance_zones = fk.get("resistance_zones", [])
        except Exception:
            pass

        # 3. PE ratio + dividend yield (من stocks table).
        pe_ratio = None
        dividend_yield = 0.0
        try:
            conn = _open_ro(STOCKS_DB_PATH)
            if conn:
                row = conn.execute(
                    "SELECT pe_ratio, dividend_yield FROM stocks WHERE ticker = ?",
                    (ticker.upper().strip(),),
                ).fetchone()
                if row:
                    pe_ratio = row[0] if row[0] else None
                    dividend_yield = _safe_float(row[1])
                conn.close()
        except Exception:
            pass

        # 4. Decision Matrix V2 (Correction vs. Structural Breakdown)
        # Task BRAVO-QUANT-RESCUE-SMART-FLOW-V2 (Owner Directive 2026-10-13)
        # ممنوع قطع الخسارة الهلع على الأصول القوية في تصحيح سوقي صحي.
        # القطع الجراحي الصارم فقط للأسهم المكسورة هيكليًا.
        decision = recommendation
        decision_ar = recommendation_ar
        verdict_badge = "low"

        # ── فحص جودة الأصل (Asset Quality) ──
        # أصل قوي = ربحي (eps>0 أو pe<15) أو توزيعات حقيقية (div>2%)
        has_real_dividends = dividend_yield >= 2.0
        is_quality_asset = (
            is_profitable is True
            or (pe_ratio is not None and 0 < pe_ratio < 15)
            or has_real_dividends
        )

        # ── فحص منطقة الطلب المؤسسية (Institutional Demand Zone) ──
        # السهم قريب من الدعم التاريخي (ضمن 5% فوق/تحت support)
        at_institutional_support = False
        if support > 0 and current_price > 0:
            distance_to_support_pct = abs(current_price - support) / support * 100
            at_institutional_support = distance_to_support_pct <= 5.0

        # ── فحص التصحيح الصحي (Healthy Correction) ──
        # تصحيح = خسارة بين -10% و -25% (ليس انهيار هيكلي)
        is_healthy_correction = (-25.0 <= loss_pct <= -10.0)

        # ── فحص الانهيار الهيكلي (Structural Breakdown) ──
        # انهيار = خسارة > 30% أو falling knife مؤكد
        is_structural_breakdown = is_falling_knife or loss_pct < -30.0

        # ═══════════════════════════════════════════════════════════════════
        # مصفوفة القرار V2 (Priority Order — first match wins)
        # ═══════════════════════════════════════════════════════════════════

        # 🛑 CUT_LOSS: القطع الجراحي الصارم للأصول المكسورة هيكليًا
        if is_structural_breakdown and not is_quality_asset:
            decision = "CUT_LOSS"
            decision_ar = "اقطع الخسارة فوراً — انهيار هيكلي"
        # 🛑 CUT_LOSS: شركة غير ربحية + خسارة > 10% + لا توزيعات حقيقية
        elif is_profitable is False and not has_real_dividends and loss_pct < -10.0:
            decision = "CUT_LOSS"
            decision_ar = "اقطع الخسارة فوراً — أصل مضاربي خاسر"
        # 🛑 CUT_LOSS: شراء قرب القمة + خسارة > 15% + لا أساسيات
        elif purchase_vs_peak in ("AT_PEAK", "NEAR_PEAK") and loss_pct < -15.0 and not is_quality_asset:
            decision = "CUT_LOSS"
            decision_ar = "اقطع الخسارة فوراً — دخول قمة متضخمة"
        # 🛑 CUT_LOSS: خسارة كارثية (> 35%) بغض النظر عن الجودة
        elif loss_pct < -35.0:
            decision = "CUT_LOSS"
            decision_ar = "اقطع الخسارة فوراً — خسارة كارثية"

        # 🔄 AVERAGE_DOWN: تبريد مؤسسي ذكي (No Panic on Quality Assets)
        # شروط: أصل قوي + تصحيح صحي + عند دعم مؤسسي + NOT falling knife
        elif (
            is_quality_asset
            and is_healthy_correction
            and at_institutional_support
            and not is_falling_knife
        ):
            decision = "AVERAGE_DOWN"
            decision_ar = "تبريد مؤسسي ذكي (Average Down)"

        # ⏳ HOLD: السهم مستقر (الخسارة طفيفة < 10%)
        elif loss_pct > -10.0:
            decision = "HOLD"
            decision_ar = "اصبر"

        # ⏳ HOLD: أصل قوي + خسارة متوسطة + دعم مؤسسي (انتظر التعافي)
        elif is_quality_asset and at_institutional_support and not is_structural_breakdown:
            decision = "HOLD"
            decision_ar = "اصبر — أصل قوي عند دعم"

        # 🛑 CUT_LOSS: default للأصول الضعيفة مع خسارة عميقة
        elif loss_pct < -20.0 and not is_quality_asset:
            decision = "CUT_LOSS"
            decision_ar = "اقطع الخسارة فوراً"

        # verdict_badge
        if decision == "CUT_LOSS":
            verdict_badge = "danger"
        elif decision == "AVERAGE_DOWN":
            verdict_badge = "warning"
        else:
            verdict_badge = "success"

        # 5. Autopsy (تشريح الخطأ).
        bought_near_peak = purchase_vs_peak in ("AT_PEAK", "NEAR_PEAK")
        ignored_stop_loss = loss_pct < -7.0  # لو الخسارة > 7% = تجاهل وقف الخسارة

        autopsy_summary_parts = []
        if bought_near_peak:
            autopsy_summary_parts.append(
                f"دخلت قرب قمة تاريخية متضخمة ({historical_high:.2f} ج.م)"
            )
        if is_falling_knife:
            autopsy_summary_parts.append("السهم حالياً في هبوط حر (Falling Knife)")
        if ignored_stop_loss:
            stop_level = buy_price * 0.95
            autopsy_summary_parts.append(
                f"تجاهلت وقف الخسارة عند كسر {stop_level:.2f} ج.م"
            )
        if is_profitable is False:
            autopsy_summary_parts.append("الشركة غير ربحية")

        if not autopsy_summary_parts:
            autopsy_summary = "الصفقة في نطاق طبيعي — لا توجد أخطاء جسيمة واضحة."
        else:
            autopsy_summary = "، و".join(autopsy_summary_parts) + "."

        autopsy = {
            "bought_near_peak": bought_near_peak,
            "is_falling_knife": is_falling_knife,
            "ignored_stop_loss": ignored_stop_loss,
            "summary": autopsy_summary,
        }

        # 6. Asset Health.
        # institutional_flow classification
        if is_falling_knife or (is_profitable is False):
            institutional_flow = "🔴 سيولة خارجة وضغط بيعي"
        elif decision == "AVERAGE_DOWN":
            institutional_flow = "🟢 سيولة داخلة (تجميع مؤسسي)"
        else:
            institutional_flow = "🟡 سيولة متوازنة"

        # resistance_exit_level = أعلى قمة مقاومة (للتصريف)
        resistance_exit_level = resistance
        if resistance_zones and resistance_zones[0] > resistance_exit_level:
            resistance_exit_level = resistance_zones[0]

        asset_health = {
            "is_profitable": is_profitable,
            "pe_ratio": pe_ratio,
            "institutional_flow": institutional_flow,
            "support_level": round(support, 2) if support > 0 else None,
            "resistance_exit_level": round(resistance_exit_level, 2) if resistance_exit_level > 0 else None,
            "dividend_yield": round(dividend_yield, 2),
        }

        # 7. Action Plan.
        average_down_allowed = False
        average_down_reason = ""

        if decision == "CUT_LOSS":
            recovered_egp = current_price * quantity
            recommended_action = (
                f"تسييل المركز فوراً لوقف النزيف، وتوجيه السيولة المستردة "
                f"({recovered_egp:,.0f} ج.م) لأصل صاعد ذو عوائد مؤكدة."
            )
            average_down_allowed = False
            if is_falling_knife:
                average_down_reason = "ممنوع التبريد في سكين ساقطة — التبريد هنا مضاعفة للخسارة."
            elif is_profitable is False:
                average_down_reason = "ممنوع التبريد في شركة غير ربحية — لا قاع حقيقي للاستناد إليه."
            else:
                average_down_reason = "الخسارة عميقة جداً + الشراء كان قرب القمة — التبريد مضاربة غير محسوبة."

        elif decision == "AVERAGE_DOWN":
            # ── تبريد مؤسسي ذكي بحساب بالمليمتر (Task V2) ──
            # الهدف: تخفيض المتوسط إلى منتصف المسافة نحو منطقة الارتداد المستهدفة
            # منطقة الارتداد = current_price (السعر الحالي عند الدعم المؤسسي)
            # target_avg = منتصف المسافة بين buy_price و current_price
            target_avg = (buy_price + current_price) / 2.0

            # الكمية الإضافية المطلوبة بالضبط لتخفيض المتوسط إلى target_avg
            # Formula: shares_needed = (buy_price - target_avg) / (target_avg - current_price) * quantity
            if current_price > 0 and target_avg > current_price and buy_price > target_avg:
                shares_needed = max(
                    0,
                    int(((buy_price - target_avg) / (target_avg - current_price)) * quantity),
                )
            else:
                shares_needed = 0

            # التكلفة الإضافية بالجنيه
            additional_cost_egp = shares_needed * current_price

            # المتوسط الجديد بعد التبريد
            new_total_shares = quantity + shares_needed
            new_total_cost = (buy_price * quantity) + (current_price * shares_needed)
            new_avg_price = new_total_cost / new_total_shares if new_total_shares > 0 else buy_price

            # ── Invalidation Level (وقف خسارة صارم أسفل الدعم المؤسسي) ──
            # الوقف = 3% تحت الدعم المؤسسي (لو كُسر الدعم = الهيكل انهار)
            invalidation_level = support * 0.97 if support > 0 else current_price * 0.95

            # الخسارة المحتملة لو ضُرب الوقف بعد التبريد
            max_loss_after_avgdown = (new_avg_price - invalidation_level) * new_total_shares

            recommended_action = (
                f"تبريد مؤسسي ذكي: اشترِ {shares_needed:,} سهم إضافي عند {current_price:.2f} ج.م "
                f"(تكلفة إضافية {additional_cost_egp:,.0f} ج.م) لتخفيض المتوسط من {buy_price:.2f} "
                f"إلى {new_avg_price:.2f} ج.م. وقف خسارة صارم عند {invalidation_level:.2f} ج.م "
                f"(أسفل الدعم المؤسسي مباشرة). أقصى خسارة محتملة لو ضُرب الوقف: {max_loss_after_avgdown:,.0f} ج.م."
            )
            average_down_allowed = True
            average_down_reason = (
                f"أصل قوي (ربحية/توزيعات) + تصحيح صحي ({loss_pct:.1f}%) + عند دعم مؤسسي ({support:.2f}). "
                f"التبريد هنا مضاعفة للفرصة وليس مضاعفة للخسارة."
            )

        else:  # HOLD
            if abs(loss_pct) > 15:
                recommended_action = (
                    f"الخسارة كبيرة ({loss_pct:.1f}%) لكن السهم عند دعم تاريخي ({support:.2f} ج.م) "
                    f"بتوزيعات أرباح ({dividend_yield:.1f}%). راقب كسر الدعم كإشارة خروج عاجلة — "
                    f"أي كسر للدعم يعني تحويل لـ CUT_LOSS فوراً."
                )
            else:
                recommended_action = (
                    f"اصبر — السهم عند دعم تاريخي ({support:.2f} ج.م) بتوزيعات أرباح "
                    f"({dividend_yield:.1f}%)، والخسارة طفيفة ({loss_pct:.1f}%). "
                    f"راقب كسر الدعم كإشارة خروج."
                )
            average_down_allowed = False
            average_down_reason = "لا حاجة للتبريد — الخسارة محتوية والسهم مستقر."

        action_plan = {
            "recommended_action": recommended_action,
            "average_down_allowed": average_down_allowed,
            "average_down_reason": average_down_reason,
        }

        # 8. Lessons Learned.
        lessons_learned: list = []
        if bought_near_peak:
            lessons_learned.append(
                "ممنوع الشراء بعد صعود متواصل دون انتظار تصحيح وقاع تجميعي."
            )
        if ignored_stop_loss:
            lessons_learned.append(
                "تفعيل وقف الخسارة الصارم عند -5% إلى -7% هو الحامي الوحيد لرأس المال."
            )
        if is_falling_knife:
            lessons_learned.append(
                "السكاكين الساقطة لا تُلتقط — انتظر تأكيد القاع وتوقف النزيف قبل أي دخول."
            )
        if is_profitable is False:
            lessons_learned.append(
                "تجنب الأسهم غير الربحية إلا بتأكيد تحول جوهري في الأرباح."
            )
        if not lessons_learned:
            lessons_learned.append(
                "الحفاظ على الانضباط في إدارة المخاطر هو مفتاح بقاء رأس المال."
            )

        # 9. الـ Payload النهائي.
        return {
            "ticker": ticker.upper(),
            "decision": decision,
            "decision_ar": decision_ar,
            "verdict_badge": verdict_badge,
            "current_price": round(current_price, 2),
            "buy_price": round(buy_price, 2),
            "loss_amount": round(loss_egp, 2),
            "loss_pct": round(loss_pct, 2),
            "autopsy": autopsy,
            "asset_health": asset_health,
            "action_plan": action_plan,
            "lessons_learned": lessons_learned,
        }

    # ===================================================================
    # Task BRAVO-QUANT-RESCUE-SMART-FLOW-V2: Batch Portfolio Rescue
    # ===================================================================
    def analyze_portfolio_clinic(self, holdings: list) -> Dict[str, Any]:
        """حلل قائمة أسهم كاملة معاً وأخرج تقرير المحفظة المجمعة.

        Args:
            holdings: قائمة dicts بصيغة [{ticker, buy_price, quantity, buy_date?}, ...]

        Returns:
            {
                "total_holdings": int,
                "total_capital_locked_egp": float,
                "total_market_value_egp": float,
                "total_loss_egp": float,
                "total_loss_pct": float,
                "recoverable_cash_egp": float,  # من أسهم CUT_LOSS
                "priority_queue": [...],  # الأشد خطورة أولاً
                "summary": str,
            }
        """
        if not holdings:
            return {
                "total_holdings": 0,
                "total_capital_locked_egp": 0.0,
                "total_market_value_egp": 0.0,
                "total_loss_egp": 0.0,
                "total_loss_pct": 0.0,
                "recoverable_cash_egp": 0.0,
                "priority_queue": [],
                "summary": "لا توجد مراكز في المحفظة.",
            }

        analyses = []
        total_capital = 0.0
        total_market_value = 0.0
        total_loss = 0.0
        recoverable_cash = 0.0

        for h in holdings:
            ticker = h.get("ticker", "")
            buy_price = _safe_float(h.get("buy_price", 0))
            quantity = _safe_float(h.get("quantity", 0))
            buy_date = h.get("buy_date", "")

            if not ticker or buy_price <= 0 or quantity <= 0:
                continue

            analysis = self.analyze_clinic(ticker, buy_price, quantity, buy_date)
            analyses.append(analysis)

            invested = buy_price * quantity
            market_value = _safe_float(analysis.get("current_price", 0)) * quantity
            loss = market_value - invested

            total_capital += invested
            total_market_value += market_value
            total_loss += loss

            # لو CUT_LOSS → الكاش المسترد = market_value
            if analysis.get("decision") == "CUT_LOSS":
                recoverable_cash += market_value

        # ترتيب الأولويات: الأشد خطورة أولاً
        # الترتيب: CUT_LOSS (danger) > AVERAGE_DOWN (warning) > HOLD (success)
        # داخل كل فئة: حسب الخسارة الأكبر أولاً
        priority_order = {"CUT_LOSS": 0, "AVERAGE_DOWN": 1, "HOLD": 2}
        analyses_sorted = sorted(
            analyses,
            key=lambda a: (priority_order.get(a.get("decision", "HOLD"), 3), a.get("loss_pct", 0)),
        )

        priority_queue = []
        for a in analyses_sorted:
            priority_queue.append({
                "ticker": a.get("ticker"),
                "decision": a.get("decision"),
                "decision_ar": a.get("decision_ar"),
                "verdict_badge": a.get("verdict_badge"),
                "loss_pct": a.get("loss_pct"),
                "loss_amount": a.get("loss_amount"),
                "current_price": a.get("current_price"),
                "buy_price": a.get("buy_price"),
                "action": a.get("action_plan", {}).get("recommended_action", "")[:120],
            })

        total_loss_pct = (total_loss / total_capital * 100) if total_capital > 0 else 0.0

        cut_loss_count = sum(1 for a in analyses if a.get("decision") == "CUT_LOSS")
        avg_down_count = sum(1 for a in analyses if a.get("decision") == "AVERAGE_DOWN")
        hold_count = sum(1 for a in analyses if a.get("decision") == "HOLD")

        summary = (
            f"المحفظة تحوي {len(analyses)} مركز: "
            f"{cut_loss_count} للتصفية الفورية، "
            f"{avg_down_count} للتبريد المؤسسي، "
            f"{hold_count} للصبر. "
            f"إجمالي الخسارة {total_loss:,.0f} ج.م ({total_loss_pct:.1f}%). "
            f"السيولة القابلة للاسترداد فوراً من الأسهم الميتة: {recoverable_cash:,.0f} ج.م."
        )

        return {
            "total_holdings": len(analyses),
            "total_capital_locked_egp": round(total_capital, 2),
            "total_market_value_egp": round(total_market_value, 2),
            "total_loss_egp": round(total_loss, 2),
            "total_loss_pct": round(total_loss_pct, 2),
            "recoverable_cash_egp": round(recoverable_cash, 2),
            "cut_loss_count": cut_loss_count,
            "average_down_count": avg_down_count,
            "hold_count": hold_count,
            "priority_queue": priority_queue,
            "summary": summary,
        }

    def _fetch_price_candles(self, ticker: str, limit: int = 60) -> list:
        """اقرأ آخر N شمعة من stocks.db.stock_daily_prices للـ ticker."""
        try:
            conn = _open_ro(STOCKS_DB_PATH)
            if not conn:
                return []
            rows = conn.execute(
                """SELECT price_date as date, COALESCE(open, open_price) as open,
                          COALESCE(high, high_price) as high,
                          COALESCE(low, low_price) as low,
                          COALESCE(close, close_price) as close, volume
                   FROM stock_daily_prices
                   WHERE ticker = ? AND COALESCE(close, close_price) IS NOT NULL
                         AND COALESCE(close, close_price) > 0
                   ORDER BY price_date DESC LIMIT ?""",
                (ticker.upper().strip(), limit),
            ).fetchall()
            conn.close()
            candles = []
            for r in reversed(rows):
                candles.append({
                    "date": r[0], "open": r[1] or 0, "high": r[2] or 0,
                    "low": r[3] or 0, "close": r[4] or 0, "volume": r[5] or 0,
                })
            return candles
        except Exception:
            return []

    def _fetch_support_resistance(self, ticker: str) -> Tuple[float, float]:
        """اقرأ support + resistance من stocks table."""
        try:
            conn = _open_ro(STOCKS_DB_PATH)
            if not conn:
                return 0.0, 0.0
            row = conn.execute(
                "SELECT support, resistance FROM stocks WHERE ticker = ?",
                (ticker.upper().strip(),),
            ).fetchone()
            conn.close()
            if row:
                return _safe_float(row[0]), _safe_float(row[1])
            return 0.0, 0.0
        except Exception:
            return 0.0, 0.0


# ---------------------------------------------------------------------------
# Standalone smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 3:
        print("Usage: python3 bag_holder_rescue.py <TICKER> <PURCHASE_PRICE> [SHARES]")
        sys.exit(0)

    tk = sys.argv[1]
    pp = float(sys.argv[2])
    sh = float(sys.argv[3]) if len(sys.argv) > 3 else 0

    result = BagHolderRescue().analyze(tk, pp, sh)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
