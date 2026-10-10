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
