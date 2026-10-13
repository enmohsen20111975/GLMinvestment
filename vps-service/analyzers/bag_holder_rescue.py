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
from typing import Any, Dict, List, Optional, Tuple

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
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=3.0)
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
    """Analyze a stuck position and recommend HOLD/AVERAGE_DOWN/CUT_LOSS.

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
        if dist_from_high_pct <= 5.0 and purchase_price <= historical_high:
            return "AT_PEAK"
        # Within 15% of high → NEAR_PEAK
        if dist_from_high_pct <= 15.0 and purchase_price <= historical_high:
            return "NEAR_PEAK"
        # Purchase above the recorded historical high → our range data
        # doesn't cover the entry (incomplete history) — NOT "near peak".
        if purchase_price > historical_high:
            return "ABOVE_HISTORY"
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
                f"أنت {loss_phrase} في {ticker} — اشتريت عند {purchase_price:.2f} "
                f"والسهم حالياً {current_price:.2f}. "
                f"{peak_str} و{profitable_str}. "
                f"الخسارة لسه صغيرة والشركة وضعها ممتاز — اصبر على المركز. "
                f"حط وقف خسارة تحت سعر الشراء بنسبة 5-8% عشان تحمي ربحك لو السهم اتعرض لخبر سلبي مفاجئ."
            )
        return (
            f"أنت {loss_phrase} في {ticker} — اشتريت عند {purchase_price:.2f} "
            f"والسهم حالياً {current_price:.2f}. "
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
    # Task RESCUE-CLINIC-V3 (Owner Directive 2026-10-13)
    # ===================================================================
    # عيادة إنقاذ الصفقات المتعثرة — أداة تحليل صارمة ومحايدة:
    #   1. اتساق رقمي إلزامي + إيقاف التوصية عند تعارض البيانات
    #      (السعر المعتمد = الأحدث طابعًا زمنيًا، وأي تعارض بين
    #      مصدرين حديثين > 5% = تعارض بيانات = ممنوع إصدار توصية).
    #   2. العنوان يعكس قوة الأدلة فقط — «انهيار هيكلي» محظورة إلا
    #      عند كسر القاع الرئيسي + استمرار الهبوط + ضعف السيولة الشرائية.
    #   3. خطة تعافي بخيارات مرتبة (خروج كامل / تخفيض جزئي / انتظار)
    #      — كل خيار فيه السبب وشرط الإلغاء ومستوى تراجع القرار.
    # ===================================================================

    LIVE_PRICE_CONFLICT_PCT = 5.0   # تعارض السعر بين مصدرين حديثين
    PRICE_STALE_DAYS = 3            # أقدم من 3 أيام = بيانات متوقفة
    PRICE_FRESH_WINDOW_DAYS = 2     # نافذة "الحداثة" لمقارنة المصادر

    @staticmethod
    def _parse_dt(value: Any) -> Optional[datetime]:
        """ابنِ datetime من string بصيغ مختلفة (ISO / space / date-only)."""
        if value is None:
            return None
        s = str(value).strip()
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            pass
        for fmt, cut in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d", 10)):
            try:
                return datetime.strptime(s[:cut], fmt)
            except ValueError:
                continue
        return None

    def _fetch_price_candidates(self, ticker: str) -> List[Dict[str, Any]]:
        """اجمع كل مرشحات السعر الحالي من كل المصادر مع طابعها الزمني."""
        candidates: List[Dict[str, Any]] = []

        def add(price: Any, stamp: Any, source: str) -> None:
            p = _safe_float(price)
            if p <= 0:
                return
            candidates.append({
                "price": p,
                "timestamp": str(stamp).strip() if stamp else None,
                "dt": self._parse_dt(stamp),
                "source": source,
            })

        # 1) stocks.db — current_price + last_update (المصدر المعتمد في الواجهة)
        sd = _open_ro(self.stocks_db)
        if sd is not None:
            try:
                if _table_exists(sd, "stocks"):
                    row = sd.execute(
                        "SELECT current_price, last_update FROM stocks WHERE ticker = ?",
                        (ticker,),
                    ).fetchone()
                    if row:
                        add(row[0], row[1], "stocks.db (current_price)")
                if _table_exists(sd, "stock_daily_prices"):
                    row = sd.execute(
                        """SELECT COALESCE(close, close_price) AS close, price_date
                           FROM stock_daily_prices
                           WHERE ticker = ? AND COALESCE(close, close_price) > 0
                           ORDER BY price_date DESC LIMIT 1""",
                        (ticker,),
                    ).fetchone()
                    if row:
                        add(row[0], row[1], "stocks.db (stock_daily_prices)")
            except sqlite3.Error:
                pass
            finally:
                sd.close()

        # 2) data_engine.db — price + last_update (سعر لحظي من الـ scraper)
        de = _open_ro(self.data_engine_db)
        if de is not None:
            try:
                if _table_exists(de, "stocks"):
                    row = de.execute(
                        "SELECT price, last_update FROM stocks WHERE symbol = ?",
                        (ticker,),
                    ).fetchone()
                    if row:
                        add(row[0], row[1], "data_engine.db (live scraper)")
            except sqlite3.Error:
                pass
            finally:
                de.close()

        # 3) price_history.db — آخر close مسجل (قديم في الغالب)
        ph = _open_ro(self.price_history_db)
        if ph is not None:
            try:
                if _table_exists(ph, "price_history"):
                    row = ph.execute(
                        """SELECT close_price, date FROM price_history
                           WHERE ticker = ? AND close_price > 0
                           ORDER BY date DESC LIMIT 1""",
                        (ticker,),
                    ).fetchone()
                    if row:
                        add(row[0], row[1], "price_history.db (daily)")
            except sqlite3.Error:
                pass
            finally:
                ph.close()

        # الأحدث طابعًا أولاً (بدون تاريخ قابل للقراءة = آخر الأولوية)
        candidates.sort(
            key=lambda c: (c["dt"] is not None, c["dt"] or datetime.min),
            reverse=True,
        )
        return candidates

    def _resolve_live_price(self, ticker: str) -> Dict[str, Any]:
        """اختر السعر الحالي الأحدث واكشف التعارض بين المصادر.

        القاعدة (التوجيه 2026-10-13):
          - السعر المعتمد = الأحدث طابعًا زمنيًا.
          - لو مصدران حديثان (ضمن نافذة يومين) اختلفا بأكثر من
            LIVE_PRICE_CONFLICT_PCT → تعارض بيانات → ممنوع إصدار توصية.
          - لو أحدث سعر أقدم من PRICE_STALE_DAYS → بيانات متوقفة → تعارض.
        """
        candidates = self._fetch_price_candidates(ticker)
        now = datetime.now()

        if not candidates:
            return {
                "current_price": 0.0,
                "price_source": "none",
                "price_timestamp": None,
                "price_candidates": [],
                "conflict": ["لا يوجد أي سعر حالي مسجل لهذا السهم في قواعد البيانات."],
            }

        freshest = candidates[0]
        freshest_dt = freshest["dt"]

        if freshest_dt is None:
            return {
                "current_price": freshest["price"],
                "price_source": freshest["source"],
                "price_timestamp": freshest["timestamp"],
                "price_candidates": [
                    {"price": c["price"], "source": c["source"], "timestamp": c["timestamp"]}
                    for c in candidates
                ],
                "conflict": [
                    f"سعر {freshest['source']} ({freshest['price']:.2f} ج.م) "
                    f"بدون طابع زمني صالح — لا يمكن التحقق من حداثته."
                ],
            }

        # مصادر حديثة للمقارنة (ضمن نافذة يومين من الأحدث)
        fresh = [
            c for c in candidates
            if c["dt"] is not None
            and (freshest_dt - c["dt"]).days <= self.PRICE_FRESH_WINDOW_DAYS
        ]

        conflicts: List[str] = []
        flagged_prices: set = set()
        for c in fresh:
            if c is freshest:
                continue
            diff_pct = abs(c["price"] - freshest["price"]) / freshest["price"] * 100.0
            if diff_pct > self.LIVE_PRICE_CONFLICT_PCT:
                key = round(c["price"], 2)
                if key in flagged_prices:
                    continue
                flagged_prices.add(key)
                conflicts.append(
                    f"تعارض في السعر الحالي بين مصدرين حديثين: "
                    f"{freshest['price']:.2f} ج.م ({freshest['source']}"
                    f"{f'، {freshest['timestamp']}' if freshest['timestamp'] else ''}) مقابل "
                    f"{c['price']:.2f} ج.م ({c['source']}"
                    f"{f'، {c['timestamp']}' if c['timestamp'] else ''}) — "
                    f"الفرق {diff_pct:.1f}%."
                )

        # سلامة السعر: أحدث من 3 أيام؟
        age_days = (now - freshest_dt).days
        if age_days > self.PRICE_STALE_DAYS:
            stamp = freshest["timestamp"] or "غير معروف"
            conflicts.append(
                f"آخر سعر متاح قديم (منذ {age_days} يوم، آخر تحديث: {stamp}) "
                f"— بيانات السعر متوقفة ولا تصلح لقرار الآن."
            )

        return {
            "current_price": freshest["price"],
            "price_source": freshest["source"],
            "price_timestamp": freshest["timestamp"],
            "price_candidates": [
                {"price": c["price"], "source": c["source"], "timestamp": c["timestamp"]}
                for c in candidates
            ],
            "conflict": conflicts,
        }

    def _fetch_historical_range(self, ticker: str) -> Tuple[float, float, bool]:
        """النطاق التاريخي (قمة/قاع) من مصادر حقيقية فقط.

        Returns: (high, low, estimated)
          estimated=True لو مفيش بيانات حقيقية (ممنوع الاستخدام للتصنيف).
        """
        highs: List[float] = []
        lows: List[float] = []

        sd = _open_ro(self.stocks_db)
        if sd is not None:
            try:
                if _table_exists(sd, "stocks"):
                    row = sd.execute(
                        "SELECT high_52w, low_52w, high_price, low_price FROM stocks WHERE ticker = ?",
                        (ticker,),
                    ).fetchone()
                    if row:
                        h52 = _safe_float(row[0])
                        l52 = _safe_float(row[1])
                        hp = _safe_float(row[2])
                        lp = _safe_float(row[3])
                        if h52 > 0:
                            highs.append(h52)
                        if hp > 0:
                            highs.append(hp)
                        if l52 > 0:
                            lows.append(l52)
                        if lp > 0:
                            lows.append(lp)
            except sqlite3.Error:
                pass
            finally:
                sd.close()

        ph = _open_ro(self.price_history_db)
        if ph is not None:
            try:
                if _table_exists(ph, "price_history"):
                    row = ph.execute(
                        """SELECT MAX(high_price) AS h, MIN(low_price) AS l
                           FROM price_history WHERE ticker = ?""",
                        (ticker,),
                    ).fetchone()
                    if row:
                        h = _safe_float(row[0])
                        l = _safe_float(row[1])
                        if h > 0:
                            highs.append(h)
                        if l > 0:
                            lows.append(l)
            except sqlite3.Error:
                pass
            finally:
                ph.close()

        if not highs or not lows:
            return 0.0, 0.0, True
        return max(highs), min(lows), False

    def _fetch_sma(
        self, ticker: str, candles: List[Dict[str, Any]]
    ) -> Tuple[float, float]:
        """SMA 50/200 — من stocks.db أولاً، ثم حساب من الشموع الحقيقية."""
        ma50 = 0.0
        ma200 = 0.0
        sd = _open_ro(self.stocks_db)
        if sd is not None:
            try:
                if _table_exists(sd, "stocks"):
                    row = sd.execute(
                        "SELECT ma_50, ma_200 FROM stocks WHERE ticker = ?",
                        (ticker,),
                    ).fetchone()
                    if row:
                        ma50 = _safe_float(row[0])
                        ma200 = _safe_float(row[1])
            except sqlite3.Error:
                pass
            finally:
                sd.close()

        closes = [c["close"] for c in candles if c["close"] > 0]
        if ma50 <= 0 and len(closes) >= 50:
            ma50 = sum(closes[-50:]) / 50.0
        if ma200 <= 0 and len(closes) >= 200:
            ma200 = sum(closes[-200:]) / 200.0
        return ma50, ma200

    def _fetch_market_stats(self, ticker: str) -> Tuple[Optional[float], float, float]:
        """P/E + dividend yield + RSI من stocks.db."""
        pe: Optional[float] = None
        div = 0.0
        rsi = 0.0
        sd = _open_ro(self.stocks_db)
        if sd is not None:
            try:
                if _table_exists(sd, "stocks"):
                    row = sd.execute(
                        "SELECT pe_ratio, dividend_yield, rsi FROM stocks WHERE ticker = ?",
                        (ticker,),
                    ).fetchone()
                    if row:
                        pe = row[0] if row[0] is not None else None
                        div = _safe_float(row[1])
                        rsi = _safe_float(row[2])
            except sqlite3.Error:
                pass
            finally:
                sd.close()
        return pe, div, rsi

    @staticmethod
    def _clinic_conflict_payload(
        ticker: str,
        buy_price: float,
        quantity: float,
        current_price: float,
        price_info: Dict[str, Any],
        reasons: List[str],
    ) -> Dict[str, Any]:
        """Payload التوقف عند تعارض البيانات — ممنوع إصدار توصية."""
        computable = buy_price > 0 and current_price > 0
        loss_pct = (current_price - buy_price) / buy_price * 100.0 if computable else 0.0
        loss_egp = (current_price - buy_price) * quantity if computable else 0.0
        return {
            "ticker": ticker,
            "decision": None,
            "decision_ar": None,
            "verdict_badge": "conflict",
            "current_price": round(current_price, 2) if current_price > 0 else None,
            "buy_price": round(buy_price, 2) if buy_price > 0 else None,
            "loss_amount": round(loss_egp, 2),
            "loss_pct": round(loss_pct, 2),
            "data_conflict": True,
            "conflict_reasons": reasons,
            "price_candidates": price_info.get("price_candidates", []),
            "diagnosis": None,
            "autopsy": None,
            "asset_health": None,
            "action_plan": None,
            "lessons_learned": [],
            "message": "تعارض في البيانات — لا يمكن إصدار توصية موثوقة حالياً.",
            "analyzed_at": datetime.now().isoformat(timespec="seconds"),
        }

    def analyze_clinic(
        self,
        ticker: str,
        buy_price: float,
        quantity: float,
        buy_date: str = "",
    ) -> Dict[str, Any]:
        """تحليل صارم لصفقة متعثرة + خطة تعافي بخيارات مرتبة.

        Rule 27 (NO-FAKE-DATA): كل الأرقام من DBs حقيقية.
        Rule 20 (PYTHON = BRAIN): كل المنطق هنا.

        التوجيه (2026-10-13): أداة تحليل محايدة — العنوان يعكس قوة
        الأدلة فقط، واتساق رقمي إلزامي، وإيقاف التوصية عند تعارض.

        Args:
            ticker:    رمز السهم (مثل 'EGREF').
            buy_price: سعر الشراء الأصلي للعميل.
            quantity:  الكمية المملوكة.
            buy_date:  تاريخ الشراء (اختياري — محفوظ للتوافق).

        Returns:
            Payload كامل بصيغة عيادة الإنقاذ، أو payload تعارض
            (decision=None + data_conflict=True) عند تعارض البيانات.
        """
        ticker = (ticker or "").upper().strip()
        buy_price = _safe_float(buy_price)
        quantity = _safe_float(quantity)

        # ── 0. جلب البيانات الخام ──────────────────────────────────
        price_info = self._resolve_live_price(ticker)
        current_price = _safe_float(price_info.get("current_price"))
        price_conflicts: List[str] = list(price_info.get("conflict") or [])

        is_profitable, profitability_note = self._fetch_company_profitability(ticker)
        pe_ratio, dividend_yield, rsi = self._fetch_market_stats(ticker)
        support, resistance = self._fetch_support_resistance(ticker)
        hist_high, hist_low, range_estimated = self._fetch_historical_range(ticker)
        candles = self._fetch_price_candles(ticker, 210)
        ma50, ma200 = self._fetch_sma(ticker, candles)

        # ── 1. بوابة تعارض البيانات (ممنوع إصدار توصية) ────────────
        input_errors: List[str] = []
        if buy_price <= 0:
            input_errors.append("سعر الشراء المدخل غير صالح (لازم يكون أكبر من صفر).")
        if quantity <= 0:
            input_errors.append("الكمية المدخلة غير صالحة (لازم تكون أكبر من صفر).")
        if current_price <= 0:
            input_errors.append("لا يوجد سعر حالي موثوق لهذا السهم.")

        conflict_reasons = price_conflicts + input_errors
        if conflict_reasons:
            return self._clinic_conflict_payload(
                ticker, buy_price, quantity, current_price,
                price_info, conflict_reasons,
            )

        # ── 2. الحسابات الأساسية (معادلة الخسارة الموحدة) ─────────
        # نسبة الخسارة = (سعر الشراء – السعر الحالي) / سعر الشراء
        # (تُرجع سالبة عند الخسارة — القيمة المطلقة هي نسبة الخسارة)
        loss_pct = (current_price - buy_price) / buy_price * 100.0
        loss_egp = (current_price - buy_price) * quantity
        invested_egp = buy_price * quantity
        market_value_egp = current_price * quantity
        recovery_needed_pct = (
            (buy_price - current_price) / current_price * 100.0
            if 0 < current_price < buy_price else 0.0
        )

        # ── 3. تقييم الاتجاه والسيولة ──────────────────────────────
        price_vs_ma50_pct = (
            (current_price - ma50) / ma50 * 100.0 if ma50 > 0 else None
        )
        price_vs_ma200_pct = (
            (current_price - ma200) / ma200 * 100.0 if ma200 > 0 else None
        )
        below_sma50 = price_vs_ma50_pct is not None and price_vs_ma50_pct < -2.0
        below_sma200 = price_vs_ma200_pct is not None and price_vs_ma200_pct < -2.0
        ma50_below_ma200 = ma50 > 0 and ma200 > 0 and ma50 < ma200

        closes = [c["close"] for c in candles if c["close"] > 0]
        roc_10d: Optional[float] = None
        if len(closes) >= 10:
            roc_10d = (closes[-1] - closes[-10]) / closes[-10] * 100.0

        # Falling knife (من institutional_levels.py)
        is_falling_knife = False
        falling_knife_reason = ""
        resistance_zones: List[float] = []
        try:
            from analyzers.institutional_levels import detect_falling_knife
            fk_candles = candles[-60:] if len(candles) >= 60 else candles
            if fk_candles:
                fk = detect_falling_knife(
                    fk_candles,
                    ma50 if ma50 > 0 else None,
                    ma200 if ma200 > 0 else None,
                )
                is_falling_knife = bool(fk.get("is_falling_knife", False))
                falling_knife_reason = fk.get("reason", "")
                resistance_zones = [float(z) for z in (fk.get("resistance_zones") or [])]
        except Exception:
            pass

        continued_decline = is_falling_knife or (roc_10d is not None and roc_10d < -8.0)

        # السيولة البيعية
        if is_falling_knife or (roc_10d is not None and roc_10d < -8.0):
            selling_pressure = "بيعية مستمرة"
        elif below_sma50:
            selling_pressure = "بيعية محدودة"
        elif candles:
            selling_pressure = "متوازنة"
        else:
            selling_pressure = "غير معروفة"

        # كسر القاع الرئيسي / الدعم المهم
        broke_major_low = (
            (hist_low > 0 and current_price <= hist_low)
            or (support > 0 and current_price <= support * 0.97)
        )

        is_healthy_correction = -25.0 <= loss_pct <= -10.0
        deep_loss = loss_pct <= -20.0
        ignored_stop_loss = loss_pct < -7.0

        # الانهيار الهيكلي — فقط بالأدلة الثلاثة مجتمعة (التوجيه):
        # كسر واضح للقاع الرئيسي السابق + استمرار الهبوط + ضعف السيولة الشرائية
        is_structural_breakdown = (
            broke_major_low
            and continued_decline
            and selling_pressure == "بيعية مستمرة"
        )

        # حالة الاتجاه (أساس لغة العنوان — تعكس قوة الأدلة فقط)
        if is_structural_breakdown:
            trend_status = "اتجاه هابط واضح — كسر دعم رئيسي"
        elif is_falling_knife or (below_sma50 and ma50_below_ma200):
            trend_status = "اتجاه هابط واضح"
        elif below_sma50 or (roc_10d is not None and roc_10d < -5.0):
            trend_status = "تصحيح حاد بعد قمة"
        elif deep_loss:
            trend_status = "هبوط عميق مع ارتداد محدود"
        elif loss_pct < -8.0 and not below_sma200:
            trend_status = "تصحيح داخل اتجاه صاعد"
        else:
            trend_status = "تذبذب عرضي"

        # ── 4. تصنيف الشراء مقابل النطاق + جودة الأصل ─────────────
        purchase_vs_peak = (
            "UNKNOWN" if range_estimated
            else self._classify_purchase_vs_peak(buy_price, hist_high, hist_low)
        )
        bought_near_peak = purchase_vs_peak in ("AT_PEAK", "NEAR_PEAK")

        has_real_dividends = dividend_yield >= 2.0
        is_quality_asset = (
            is_profitable is True
            or (pe_ratio is not None and 0 < pe_ratio < 15)
            or has_real_dividends
        )
        weak_asset = (
            is_profitable is False
            and not has_real_dividends
            and not (pe_ratio is not None and 0 < pe_ratio < 15)
        )

        at_institutional_support = False
        support_distance_pct: Optional[float] = None
        if support > 0 and current_price > 0:
            support_distance_pct = abs(current_price - support) / support * 100.0
            at_institutional_support = support_distance_pct <= 5.0

        # ── 5. القرار ──────────────────────────────────────────────
        if is_structural_breakdown:
            # أدلة قوية جدًا → لغة حاسمة (مسموح بالتوجيه)
            decision = "CUT_LOSS"
            decision_ar = "الاتجاه هابط بوضوح — يُفضَّل الخروج"
        elif (
            deep_loss
            or (is_falling_knife and loss_pct < -7.0)
            or (weak_asset and loss_pct < -10.0)
            or (bought_near_peak and loss_pct < -15.0 and weak_asset)
        ):
            decision = "CUT_LOSS"
            decision_ar = "الوضع الحالي ضعيف — يُفضَّل التخفيض أو الخروج"
        elif (
            is_quality_asset
            and is_healthy_correction
            and at_institutional_support
            and not is_falling_knife
        ):
            decision = "AVERAGE_DOWN"
            decision_ar = "الوضع ضعيف لكن قابل للإدارة — يُفضَّل تخفيض جزئي (40-60%)"
        elif loss_pct > -10.0:
            decision = "HOLD"
            decision_ar = (
                "الخسارة صغيرة — مراقبة صارمة بوقف عند 7%"
                if (is_falling_knife or selling_pressure == "بيعية مستمرة")
                else "الوضع تحت السيطرة — انتظار ومراقبة"
            )
        elif is_quality_asset and at_institutional_support:
            decision = "HOLD"
            decision_ar = "الوضع ضعيف — انتظار عند الدعم مع مراقبة صارمة"
        else:
            decision = "CUT_LOSS"
            decision_ar = "الوضع الحالي ضعيف — يُفضَّل التخفيض أو الخروج"

        verdict_badge = (
            "danger" if decision == "CUT_LOSS"
            else "warning" if decision == "AVERAGE_DOWN"
            else "success"
        )

        # ── 6. مستويات الخروج (من الشارت الفعلي فقط — ممنوع الاختلاق) ──
        exit_level = 0.0
        if resistance > current_price:
            exit_level = resistance
        for zone in sorted(resistance_zones):
            if zone > current_price and (exit_level <= 0 or zone < exit_level):
                exit_level = zone
        if exit_level <= 0 and ma50 > current_price:
            exit_level = ma50
        # لو مفيش مقاومة حقيقية فوق السعر → ممنوع اختلاق مستوى

        # مستوى تصعيد القرار (تحت الدعم)
        escalation_level = support * 0.97 if support > 0 else current_price * 0.93

        major_low = hist_low if hist_low > 0 else support

        # ── 7. خطة التعافي — خيارات مرتبة حسب قوة الأدلة ──────────
        # الخيار 1 – خروج كامل (أولوية عالية)
        opt1_applicable = (
            is_structural_breakdown
            or deep_loss
            or (is_falling_knife and loss_pct < -7.0)
            or (weak_asset and loss_pct < -10.0)
        )
        opt1_reasons: List[str] = []
        if is_structural_breakdown:
            opt1_reasons.append(
                f"الاتجاه الرئيسي انكسر فعلًا: السعر كسر القاع الرئيسي السابق "
                f"({major_low:.2f} ج.م) ويستمر في الهبوط تحت المتوسط 50 ({ma50:.2f} ج.م)."
                if ma50 > 0 else
                f"الاتجاه الرئيسي انكسر فعلًا: السعر كسر القاع الرئيسي السابق "
                f"({major_low:.2f} ج.م) ويستمر في الهبوط."
            )
        elif is_falling_knife:
            opt1_reasons.append(
                f"الاتجاه هابط مؤكد — السعر تحت المتوسط 50 بنسبة {abs(price_vs_ma50_pct):.1f}%"
                + ("، والمتوسط 50 تحت المتوسط 200." if ma50_below_ma200 else ".")
            )
        if deep_loss:
            opt1_reasons.append(f"الخسارة وصلت {abs(loss_pct):.1f}%.")
        if weak_asset:
            opt1_reasons.append("الشركة غير ربحية ولا توزع توزيعات حقيقية.")
        if not at_institutional_support:
            opt1_reasons.append("مفيش دعم قريب قوي يمكن الاستناد إليه للانتظار.")
        if not opt1_reasons:
            opt1_reasons.append("الأدلة تشير لضعف واضح في السهم.")
        if not opt1_applicable:
            opt1_reasons = [
                f"الأدلة الحالية (خسارة {abs(loss_pct):.1f}% فقط، "
                f"سيولة {selling_pressure}) لا تبرر الخروج الكامل "
                f"— الخيار غير ساري دلوقتي."
            ]

        option1 = {
            "key": "EXIT_FULL",
            "priority": 1,
            "title": "الخيار 1 – خروج كامل (أولوية عالية)",
            "applicable": opt1_applicable,
            "active": False,
            "reason": " ".join(opt1_reasons),
            "invalidation": (
                f"يُلغى لو استرجع السعر فوق {exit_level:.2f} ج.م بإغلاق أعلى منه "
                f"وحجم تداول حقيقي — عندها الهبوط مش مؤكد والخروج الكامل يبقى مبكرًا."
                if exit_level > 0 else
                "يُلغى لو استرجع السعر فوق أدنى قمة حديثة بإغلاق أعلى منه وحجم تداول حقيقي."
            ),
            "level": (
                f"يتراجع القرار للتخفيض الجزئي (بدل الخروج الكامل) لو ثبت الإغلاق فوق {exit_level:.2f} ج.م."
                if exit_level > 0 else
                "يتراجع القرار للتخفيض الجزئي لو ثبت الإغلاق فوق أدنى قمة حديثة."
            ),
            "level_price": round(exit_level, 2) if exit_level > 0 else None,
        }

        # الخيار 2 – تخفيض جزئي (40-60%)
        opt2_reasons: List[str] = [f"الوضع ضعيف — الخسارة الحالية {abs(loss_pct):.1f}%."]
        if is_quality_asset:
            opt2_reasons.append("لكن الأصل عليه أساسيات أفضل نسبيًا (ربحية/توزيعات/مكرر ربحية منخفض).")
        if at_institutional_support and support > 0:
            opt2_reasons.append(
                f"والسعر قريب من دعم مؤسسي عند {support:.2f} ج.م — احتمال ارتداد محدود موجود."
            )
        elif not opt1_applicable:
            opt2_reasons.append("والحالة ما زالت قابلة للإدارة بالمراقبة.")
        opt2_reasons.append(
            "تخفيض 40-60% من المركز يقلل المخاطر مع إبقاء جزء صغير "
            "للارتداد المحتمل — بديل متوازن بدل الخروج الكامل."
        )

        option2 = {
            "key": "PARTIAL_REDUCE",
            "priority": 2,
            "title": "الخيار 2 – تخفيض جزئي (40-60%)",
            "applicable": True,
            "active": False,
            "reason": " ".join(opt2_reasons),
            "invalidation": (
                f"يُلغى لو كسر الدعم {support:.2f} ج.م بإغلاق أدنى منه — "
                f"عندها التخفيض الجزئي مش كافي."
                if support > 0 else
                "يُلغى لو استمر الهبوط دون أي دعم واضح — عندها التخفيض الجزئي مش كافي."
            ),
            "level": f"يتراجع القرار للخروج الكامل لو نزل السعر تحت {escalation_level:.2f} ج.م.",
            "level_price": round(escalation_level, 2),
        }

        # الخيار 3 – انتظار ومراقبة
        opt3_applicable = (
            (loss_pct > -15.0)
            and (selling_pressure != "بيعية مستمرة" or loss_pct > -7.0)
        )
        if opt3_applicable:
            opt3_reasons: List[str] = []
            if at_institutional_support and support > 0:
                opt3_reasons.append(
                    f"في دعم واضح قريب عند {support:.2f} ج.م (المسافة {support_distance_pct:.1f}%)."
                )
            else:
                opt3_reasons.append("مفيش دليل بيعي قاطع دلوقتي.")
            opt3_reasons.append(
                f"السيولة {selling_pressure} والخسارة ({abs(loss_pct):.1f}%) لسه تحت السيطرة "
                f"— الانتظار هنا مبرر بالدليل، مش بالأمل."
            )
        else:
            opt3_reasons = [
                f"الخسارة ({abs(loss_pct):.1f}%) تجاوزت نطاق الانتظار الآمن (15%)"
                + (" أو السيولة بيعية مستمرة" if selling_pressure == "بيعية مستمرة" else "")
                + " — الانتظار غير مبرر دلوقتي."
            ]

        option3 = {
            "key": "WAIT_MONITOR",
            "priority": 3,
            "title": "الخيار 3 – انتظار ومراقبة",
            "applicable": opt3_applicable,
            "active": False,
            "reason": " ".join(opt3_reasons),
            "invalidation": (
                f"يُلغى لو زادت السيولة البيعية (هبوط متواصل بحجم مرتفع) "
                f"أو نزل السعر تحت {escalation_level:.2f} ج.م."
            ),
            "level": (
                f"يتراجع القرار للتخفيض الجزئي لو تجاوزت الخسارة 15%، "
                f"وللخروج الكامل لو نزل السعر تحت {escalation_level:.2f} ج.م."
            ),
            "level_price": round(escalation_level, 2),
        }

        # الخيار النشط = الأعلى أولوية المطابق للقرار
        options = [option1, option2, option3]
        preferred = {"CUT_LOSS": 1, "AVERAGE_DOWN": 2, "HOLD": 3}.get(decision, 2)
        active_opt = next(
            (o for o in options if o["priority"] == preferred and o["applicable"]),
            None,
        )
        if active_opt is None:
            active_opt = next((o for o in options if o["applicable"]), options[1])
        for o in options:
            o["active"] = o is active_opt

        # ── 8. الجملة الرئيسية (السبب قبل الحكم) ──────────────────
        cause_parts: List[str] = []
        cause_parts.append(
            f"{ticker} يتداول عند {current_price:.2f} ج.م (سعر الشراء {buy_price:.2f} ج.م)، "
            f"والخسارة الحالية {abs(loss_pct):.2f}% بقيمة {abs(loss_egp):,.0f} ج.م."
        )
        if price_vs_ma50_pct is not None:
            cause_parts.append(
                f"السعر {'تحت' if below_sma50 else 'فوق'} المتوسط 50 ({ma50:.2f} ج.م) "
                f"بنسبة {abs(price_vs_ma50_pct):.1f}%."
            )
        cause_parts.append(f"السيولة {selling_pressure}.")
        if support > 0:
            if at_institutional_support:
                cause_parts.append(f"أقرب دعم عند {support:.2f} ج.م (قريب).")
            else:
                cause_parts.append(
                    f"أقرب دعم عند {support:.2f} ج.م (بعيد {support_distance_pct:.1f}%)."
                )

        if decision == "CUT_LOSS":
            if active_opt["key"] == "EXIT_FULL":
                action = (
                    " ".join(cause_parts)
                    + f" يُوصى بإغلاق المركز بالكامل حسب درجة الضعف "
                    f"({quantity:,.0f} سهم ≈ {market_value_egp:,.0f} ج.م)، "
                    f"وتوجيه السيولة المستردة نقداً أو لأصل أفضل — "
                    f"لا توجد حالياً إشارة صاعدة موثوقة في {ticker}."
                )
            else:
                action = (
                    " ".join(cause_parts)
                    + f" يُوصى بتخفيض أو إغلاق المركز حسب درجة الضعف: "
                    f"خفّض 40-60% الآن ({int(quantity * 0.5):,} سهم ≈ "
                    f"{current_price * quantity * 0.5:,.0f} ج.م)، "
                    f"والباقي بوقف صارم عند {escalation_level:.2f} ج.م."
                )
        elif decision == "AVERAGE_DOWN":
            action = (
                " ".join(cause_parts)
                + f" يُفضَّل تخفيض المركز بنسبة 50% على الأقل "
                f"({int(quantity * 0.5):,} سهم)، مع إبقاء الجزء الأصغر فقط "
                f"بوقف عند {escalation_level:.2f} ج.م — "
                f"لو ظهر ارتداد بحجم تداول حقيقي فوق {exit_level:.2f} ج.م يُعاد تقييم التبريد الإضافي."
                if exit_level > 0 else
                " ".join(cause_parts)
                + f" يُفضَّل تخفيض المركز بنسبة 50% على الأقل "
                f"({int(quantity * 0.5):,} سهم)، مع إبقاء الجزء الأصغر فقط "
                f"بوقف عند {escalation_level:.2f} ج.م."
            )
        else:  # HOLD
            action = (
                " ".join(cause_parts)
                + f" يُفضَّل انتظار ومراقبة المركز، مع خروج فوري لو نزل السعر "
                f"تحت {escalation_level:.2f} ج.م أو تجاوزت الخسارة 15%."
            )

        # ── 9. التبريد الإضافي المشروط (بديل مشروط، مش التوصية الرئيسية) ──
        average_down_allowed = decision == "AVERAGE_DOWN"
        average_down_reason = ""
        if decision == "AVERAGE_DOWN":
            target_avg = (buy_price + current_price) / 2.0
            shares_needed = 0
            if current_price > 0 and target_avg > current_price and buy_price > target_avg:
                shares_needed = max(
                    0,
                    int(((buy_price - target_avg) / (target_avg - current_price)) * quantity),
                )
            additional_cost = shares_needed * current_price
            new_total_shares = quantity + shares_needed
            new_avg = (
                ((buy_price * quantity) + (current_price * shares_needed)) / new_total_shares
                if new_total_shares > 0 else buy_price
            )
            invalidation_level = support * 0.97 if support > 0 else current_price * 0.95
            average_down_reason = (
                f"تبريد إضافي مشروط (مش التوصية الرئيسية): لو ظهر تأكيد ارتداد بحجم حقيقي، "
                f"يمكن إضافة {shares_needed:,} سهم عند {current_price:.2f} ج.م "
                f"(تكلفة إضافية {additional_cost:,.0f} ج.م) لتخفيض المتوسط من {buy_price:.2f} "
                f"إلى {new_avg:.2f} ج.م — بوقف صارم عند {invalidation_level:.2f} ج.م. "
                f"ممنوع التبريد بدون تأكيد ارتداد: الإضافة في اتجاه هابط مضاعفة للخسارة."
            )
        elif decision == "CUT_LOSS":
            average_down_reason = (
                "ممنوع التبريد الآن — الإضافة في اتجاه هابط مضاعفة للخسارة. "
                "التبريد يُعاد تقييمه فقط بعد توقف النزيف وظهور قاع تجميعي مؤكد."
            )
        else:
            average_down_reason = "لا حاجة للتبريد — الخسارة محتوية والسهم مستقر."

        # ── 10. تحليل الصفقة (أسباب التعثر) ───────────────────────
        autopsy_summary_parts: List[str] = []
        if purchase_vs_peak == "ABOVE_HISTORY":
            autopsy_summary_parts.append(
                f"سعر الشراء ({buy_price:.2f} ج.م) أعلى من القمة التاريخية "
                f"المسجلة ({hist_high:.2f} ج.م) — بيانات النطاق غير مكتملة"
            )
        elif bought_near_peak:
            autopsy_summary_parts.append(
                f"الدخول كان قرب القمة التاريخية ({hist_high:.2f} ج.م) — "
                f"البعد عنها فقط {((hist_high - buy_price) / hist_high * 100):.1f}%"
            )
        if is_falling_knife:
            autopsy_summary_parts.append("السهم في اتجاه هابط مؤكد (تحت المتوسط 50 مع اتجاه هابط)")
        if ignored_stop_loss:
            autopsy_summary_parts.append(
                f"تم تجاهل وقف الخسارة عند {buy_price * 0.95:.2f} ج.م (الخسارة تجاوزت 7%)"
            )
        if is_profitable is False:
            autopsy_summary_parts.append("الشركة غير ربحية")
        if range_estimated:
            autopsy_summary_parts.append(
                "مفيش بيانات نطاق تاريخي كافية — تصنيف القمة/القاع غير متاح"
            )

        autopsy_summary = (
            "، و".join(autopsy_summary_parts) + "."
            if autopsy_summary_parts
            else "الصفقة في نطاق طبيعي — لا توجد أخطاء جسيمة واضحة."
        )

        autopsy = {
            "bought_near_peak": bought_near_peak,
            "is_falling_knife": is_falling_knife,
            "ignored_stop_loss": ignored_stop_loss,
            "trend_status": trend_status,
            "summary": autopsy_summary,
        }

        # ── 11. حيوية الأصل والسيولة ──────────────────────────────
        if is_falling_knife or selling_pressure == "بيعية مستمرة":
            institutional_flow = "🔴 سيولة خارجة وضغط بيعي مستمر"
        elif at_institutional_support and not is_falling_knife:
            institutional_flow = "🟢 سيولة مستقرة — السعر عند دعم مؤسسي"
        else:
            institutional_flow = "🟡 سيولة متوازنة"

        asset_health = {
            "is_profitable": is_profitable,
            "pe_ratio": pe_ratio,
            "institutional_flow": institutional_flow,
            "support_level": round(support, 2) if support > 0 else None,
            "resistance_exit_level": round(exit_level, 2) if exit_level > 0 else None,
            "dividend_yield": round(dividend_yield, 2),
            "profitability_note": profitability_note,
        }

        # ── 12. التشخيص (إجابات الأسئلة الستة بوضوح) ──────────────
        diagnosis_qa = [
            {
                "question": "هل الاتجاه الرئيسي انكسر فعلًا أم مجرد تصحيح؟",
                "answer": (
                    f"انكسر فعلًا — السعر ({current_price:.2f} ج.م) كسر القاع الرئيسي "
                    f"السابق ({major_low:.2f} ج.م) ويستمر في الهبوط."
                    if is_structural_breakdown
                    else (
                        f"الاتجاه هابط مؤكد — السعر تحت المتوسط 50 بنسبة {abs(price_vs_ma50_pct):.1f}%"
                        + ("، والمتوسط 50 تحت المتوسط 200" if ma50_below_ma200 else "")
                        + " — لكن لم يُكسر القاع الرئيسي بعد، فهي مرحلة تصحيح حاد متدهور وليست انهيارًا مؤكدًا."
                        if is_falling_knife
                        else "مجرد تصحيح — السعر ما زال فوق المتوسطات المهمة أو قريب منها، ومفيش كسر لدعم رئيسي."
                    )
                ),
            },
            {
                "question": "هل السعر تحت المتوسطات المهمة (SMA 50 / 200) بشكل مستمر؟",
                "answer": (
                    (
                        f"نعم — السعر تحت المتوسط 50 ({ma50:.2f} ج.م) بنسبة {abs(price_vs_ma50_pct):.1f}%"
                        + (
                            f"، وتحت المتوسط 200 ({ma200:.2f} ج.م) بنسبة {abs(price_vs_ma200_pct):.1f}%."
                            if below_sma200 and price_vs_ma200_pct is not None
                            else "."
                        )
                    )
                    if below_sma50
                    else (
                        f"لا — السعر فوق المتوسط 50 ({ma50:.2f} ج.م)."
                        if price_vs_ma50_pct is not None
                        else "غير معروف — مفيش بيانات متوسطات كافية لهذا السهم."
                    )
                ),
            },
            {
                "question": "هل في سيولة بيعية مستمرة أم حجم ضعيف؟",
                "answer": (
                    f"السيولة {selling_pressure}."
                    + (
                        f" الهبوط لآخر 10 جلسات {abs(roc_10d):.1f}%."
                        if roc_10d is not None and roc_10d < -8
                        else ""
                    )
                    + (f" RSI عند {rsi:.1f} (منطقة تشبع بيعي)." if rsi and 0 < rsi < 30 else "")
                    + (f" RSI عند {rsi:.1f}." if rsi and rsi >= 30 else "")
                ),
            },
            {
                "question": "هل دخلت قرب قمة تاريخية أو تجاهلت وقف خسارة؟",
                "answer": "; ".join(filter(None, [
                    (
                        f"نعم — الدخول عند {buy_price:.2f} ج.م أعلى من القمة التاريخية "
                        f"المسجلة ({hist_high:.2f} ج.م) — بيانات النطاق غير مكتملة."
                        if purchase_vs_peak == "ABOVE_HISTORY"
                        else (
                            f"نعم — الدخول عند {buy_price:.2f} ج.م كان قرب القمة التاريخية "
                            f"({hist_high:.2f} ج.م، البعد {((hist_high - buy_price) / hist_high * 100):.1f}%)."
                            if bought_near_peak else ""
                        )
                    ),
                    (
                        f"نعم — الخسارة تجاوزت 7% دون تنفيذ وقف عند {buy_price * 0.95:.2f} ج.م."
                        if ignored_stop_loss
                        else "لا يوجد تجاهل لوقف خسارة — الخسارة لسه تحت 7%."
                    ),
                ])),
            },
            {
                "question": "ما نسبة الخسارة الحالية بدقة؟",
                "answer": (
                    f"الخسارة {abs(loss_pct):.2f}% — قيمتها {abs(loss_egp):,.2f} ج.م "
                    f"({quantity:,.0f} سهم × فرق السعر {abs(buy_price - current_price):.2f} ج.م). "
                    + (
                        f"وللتعادل يحتاج السهم الارتداد {recovery_needed_pct:.1f}%."
                        if recovery_needed_pct > 0
                        else "السهم حالياً رابح أو عند نقطة التعادل."
                    )
                ),
            },
            {
                "question": "هل في مستويات دعم قريبة تستحق الانتظار؟",
                "answer": (
                    (
                        f"نعم — الدعم عند {support:.2f} ج.م (المسافة {support_distance_pct:.1f}%)"
                        + (
                            " — قريب بما يكفي للاستناد إليه."
                            if at_institutional_support
                            else " — بعيد، مش قريب بما يكفي للاستناد إليه الآن."
                        )
                    )
                    if support > 0
                    else "لا توجد بيانات دعم موثوقة — مفيش أساس للانتظار عند مستوى محدد."
                ),
            },
        ]

        diagnosis = {
            "trend_status": trend_status,
            "trend_broken": is_structural_breakdown,
            "below_sma50": below_sma50,
            "below_sma200": below_sma200,
            "selling_pressure": selling_pressure,
            "loss_pct": round(loss_pct, 2),
            "nearby_support": round(support, 2) if support > 0 else None,
            "support_distance_pct": round(support_distance_pct, 1) if support_distance_pct is not None else None,
            "summary": " ".join(cause_parts),
            "questions": diagnosis_qa,
        }

        # ── 13. الدروس المستفادة (مرتبطة بالحالة فقط — ممنوع العامة) ──
        lessons_learned: List[str] = []
        if purchase_vs_peak == "ABOVE_HISTORY":
            lessons_learned.append(
                f"الدخول عند {buy_price:.2f} ج.م فوق القمة التاريخية المسجلة "
                f"({hist_high:.2f} ج.م) — لازم تتأكد من اكتمال بيانات السهم "
                f"وموثوقية النطاق التاريخي قبل الدخول."
            )
        elif bought_near_peak:
            lessons_learned.append(
                f"دخول قرب قمة محلية/تاريخية ({hist_high:.2f} ج.م) دون تأكيد ارتداد — "
                f"الشراء بعد صعود متواصل يضاعف مخاطر الدخول."
            )
        if ignored_stop_loss:
            lessons_learned.append(
                f"عدم وجود وقف خسارة مسبق أو تجاهله عند {buy_price * 0.95:.2f} ج.م — "
                f"الوقف (-5% إلى -7%) الحامي الوحيد لرأس المال."
            )
        if is_falling_knife or continued_decline:
            lessons_learned.append(
                "متوسط التكلفة أو إضافة كمية في اتجاه هابط مضاعفة للخسارة — "
                "التبريد فقط بعد تأكيد قاع بتوقف النزيف."
            )
        if deep_loss and not at_institutional_support:
            lessons_learned.append(
                "الاعتماد على أمل العودة دون دليل سعري — كل قرار لازم يكون "
                "مرتبط بمستوى محدد وشرط إلغاء واضح."
            )
        if is_profitable is False:
            lessons_learned.append(
                "الشركة غير ربحية — تجنب الأسهم غير الربحية إلا بتأكيد تحول جوهري في الأرباح."
            )
        if not lessons_learned:
            lessons_learned.append(
                "انضباط إدارة المخاطر: وقف مسبق + حجم مناسب قبل أي دخول."
            )

        # ── 14. حارس الاتساق الرقمي النهائي ────────────────────────
        check_pct = (current_price - buy_price) / buy_price * 100.0
        check_egp = (current_price - buy_price) * quantity
        if abs(check_pct - loss_pct) > 0.5 or abs(check_egp - loss_egp) > 1.0:
            return self._clinic_conflict_payload(
                ticker, buy_price, quantity, current_price, price_info,
                ["تعارض داخلي في الحسابات — الأرقام غير متسقة مع بعضها، لازم تُراجع قبل أي توصية."],
            )

        # ── 15. الـ Payload النهائي ─────────────────────────────────
        return {
            "ticker": ticker,
            "decision": decision,
            "decision_ar": decision_ar,
            "verdict_badge": verdict_badge,
            "current_price": round(current_price, 2),
            "buy_price": round(buy_price, 2),
            "loss_amount": round(loss_egp, 2),
            "loss_pct": round(loss_pct, 2),
            "invested_egp": round(invested_egp, 2),
            "market_value_egp": round(market_value_egp, 2),
            "recovery_needed_pct": round(recovery_needed_pct, 2),
            "price_source": price_info.get("price_source"),
            "price_timestamp": price_info.get("price_timestamp"),
            "historical_high": round(hist_high, 2) if hist_high > 0 else None,
            "historical_low": round(hist_low, 2) if hist_low > 0 else None,
            "range_estimated": range_estimated,
            "data_conflict": False,
            "conflict_reasons": [],
            "diagnosis": diagnosis,
            "autopsy": autopsy,
            "asset_health": asset_health,
            "action_plan": {
                "recommended_action": action,
                "primary_option_key": active_opt["key"],
                "options": options,
                "average_down_allowed": average_down_allowed,
                "average_down_reason": average_down_reason,
            },
            "lessons_learned": lessons_learned,
            "analyzed_at": datetime.now().isoformat(timespec="seconds"),
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
                "recoverable_cash_egp": float,  # من مراكز CUT_LOSS
                "priority_queue": [...],  # الأشد ضعفاً أولاً
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

            # مراكز متوقفة (تعارض بيانات) — تُستبعد من الحسابات
            if analysis.get("data_conflict"):
                continue

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

        # ترتيب الأولويات: الأشد ضعفاً أولاً
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
                "action": (a.get("action_plan") or {}).get("recommended_action", "")[:120],
            })

        if not analyses:
            return {
                "total_holdings": 0,
                "total_capital_locked_egp": 0.0,
                "total_market_value_egp": 0.0,
                "total_loss_egp": 0.0,
                "total_loss_pct": 0.0,
                "recoverable_cash_egp": 0.0,
                "priority_queue": [],
                "summary": "كل المراكز متوقفة — تعارض في البيانات، لا توصية ممكنة حالياً.",
            }

        total_loss_pct = (total_loss / total_capital * 100) if total_capital > 0 else 0.0

        cut_loss_count = sum(1 for a in analyses if a.get("decision") == "CUT_LOSS")
        avg_down_count = sum(1 for a in analyses if a.get("decision") == "AVERAGE_DOWN")
        hold_count = sum(1 for a in analyses if a.get("decision") == "HOLD")

        summary = (
            f"المحفظة تحوي {len(analyses)} مركز: "
            f"{cut_loss_count} للخروج/التخفيض، "
            f"{avg_down_count} للتخفيض الجزئي، "
            f"{hold_count} للانتظار. "
            f"إجمالي الخسارة {total_loss:,.0f} ج.م ({total_loss_pct:.1f}%). "
            f"السيولة القابلة للاسترداد من المراكز الضعيفة: {recoverable_cash:,.0f} ج.م."
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
