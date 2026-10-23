#!/usr/bin/env python3
"""
Real Return Engine
==================
Computes the *real* (inflation-adjusted) return of every asset in a user's
portfolio, then emits human-style Arabic warnings when the portfolio is
losing purchasing power to inflation.

The math is simple but the insight is powerful:

    real_return = nominal_yield - inflation_rate

For "Cash Equivalent" assets (certificates of deposit, fixed-income funds,
bank deposits) we read `annual_yield` / `certificate_return_rate` /
`interest_rate` directly — these are *promised* yields, no estimation needed.

For "Equity" assets (stocks, equity funds) we *estimate* the nominal yield
from the current value vs the total invested (annualised). If we don't have
enough data (e.g. `total_invested == 0`), we fall back to 0 and flag the
asset as losing to inflation.

Output is a single dict that the Flask layer can `jsonify` straight away.

Only Python stdlib is used (sqlite3, datetime, math).
"""

from __future__ import annotations

import math
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# analyzers/ -> vps-service/ -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB_PATH = PROJECT_ROOT / "db" / "stocks.db"

# Fallback inflation rate if `macro_indicators.inflation_rate` is missing.
# Egypt's recent (2023-2024) inflation has hovered around 28-33%.
DEFAULT_INFLATION_RATE = 30.0

# Asset class taxonomy used in `portfolio_assets.asset_class`.
# We accept a few synonyms for robustness (e.g. 'cash_equivalent' / 'cash').
CASH_EQUIVALENT_ALIASES = {
    "cash equivalent",
    "cash_equivalent",
    "cash",
    "fixed income",
    "fixed_income",
    "certificate",
    "deposit",
    "bond",
}

EQUITY_ALIASES = {
    "equity",
    "stock",
    "stocks",
    "equity fund",
    "equity_fund",
    "fund",
    "etf",
    "reit",
}


def _is_cash_equivalent(asset_class: Optional[str], asset_type: Optional[str]) -> bool:
    """True if the asset is a fixed-income / cash-like instrument."""
    s = (asset_class or asset_type or "").strip().lower()
    if not s:
        return False
    if s in CASH_EQUIVALENT_ALIASES:
        return True
    return any(alias in s for alias in CASH_EQUIVALENT_ALIASES)


def _is_equity(asset_class: Optional[str], asset_type: Optional[str]) -> bool:
    """True if the asset is an equity / stock holding."""
    s = (asset_class or asset_type or "").strip().lower()
    if not s:
        return False
    if s in EQUITY_ALIASES:
        return True
    return any(alias in s for alias in EQUITY_ALIASES)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class RealReturnEngine:
    """Compute real (inflation-adjusted) returns for a user's portfolio.

    Usage:
        engine = RealReturnEngine()
        result = engine.evaluate_portfolio(user_id="default")
    """

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = str(db_path) if db_path else str(STOCKS_DB_PATH)

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=True)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=10000;")
        return conn

    def _load_inflation_rate(self) -> Dict[str, Any]:
        """Load latest inflation rate from `macro_indicators`.

        Returns a dict with: value, source, missing (bool).
        Falls back to DEFAULT_INFLATION_RATE if no row is found.
        """
        try:
            conn = self._connect()
            row = conn.execute(
                """
                SELECT indicator_value, source, updated_at
                FROM macro_indicators
                WHERE indicator_name = 'inflation_rate'
                ORDER BY updated_at DESC
                LIMIT 1
                """
            ).fetchone()
            conn.close()

            if row and row["indicator_value"] is not None:
                return {
                    "value": float(row["indicator_value"]),
                    "source": row["source"] or "macro_indicators",
                    "missing": False,
                }
        except sqlite3.Error as e:
            print(f"[RealReturn] inflation read error: {e}")

        # Fallback — Egypt's recent inflation has been ~30%.
        return {
            "value": DEFAULT_INFLATION_RATE,
            "source": f"fallback (default {DEFAULT_INFLATION_RATE}%)",
            "missing": True,
        }

    def _load_user_assets(self, user_id: str) -> List[Dict[str, Any]]:
        """Load all `portfolio_assets` rows for a user."""
        try:
            conn = self._connect()
            # We don't know which extra columns exist on older schemas, so we
            # be defensive: select the canonical columns by name and let
            # sqlite3.Row expose them via .keys() at consumption time.
            rows = conn.execute(
                """
                SELECT
                    id, user_id, type, name,
                    total_invested, current_value,
                    notes, weight_grams, karat,
                    purchase_price_per_gram, bank_name,
                    interest_rate, certificate_duration_months,
                    certificate_return_rate, certificate_maturity_date,
                    fund_name, fund_type,
                    stock_id, stock_ticker, quantity, avg_buy_price,
                    added_at, updated_at,
                    asset_class, annual_yield
                FROM portfolio_assets
                WHERE user_id = ?
                ORDER BY id ASC
                """,
                (user_id,),
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except sqlite3.Error as e:
            print(f"[RealReturn] assets read error: {e}")
            return []

    # ------------------------------------------------------------------
    # Per-asset math
    # ------------------------------------------------------------------

    @staticmethod
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

    def _compute_cash_yield(self, asset: Dict[str, Any]) -> Optional[float]:
        """For Cash Equivalent assets: pick the first non-null promised yield.

        Priority order (per the spec):
            1. annual_yield
            2. certificate_return_rate
            3. interest_rate
        """
        for key in ("annual_yield", "certificate_return_rate", "interest_rate"):
            v = asset.get(key)
            if v is not None:
                f = self._safe_float(v, default=0.0)
                # Treat 0 as "not provided" for annual_yield (column default
                # is 0) — but accept it for the certificate/interest fields
                # since those are user-entered.
                if f != 0.0 or key != "annual_yield":
                    return f
        return None

    def _compute_equity_yield(self, asset: Dict[str, Any]) -> Optional[float]:
        """For Equity assets: estimate annualised return from current value
        vs total invested.

        We need at least one of (added_at, updated_at) to compute a holding
        period. If we can't, fall back to a simple total-return percentage
        (un-annualised) — and if even that's not possible, return None.
        """
        invested = self._safe_float(asset.get("total_invested"))
        current = self._safe_float(asset.get("current_value"))
        if invested <= 0:
            return None  # not enough data

        # Total return percentage.
        total_return_pct = ((current - invested) / invested) * 100.0

        # Try to annualise using the holding period.
        holding_years = self._estimate_holding_years(asset)
        if holding_years and holding_years > 0:
            # Compound annual growth rate (CAGR) — handles multi-year holds.
            if current > 0 and invested > 0:
                ratio = current / invested
                if ratio > 0:
                    cagr = (ratio ** (1.0 / holding_years) - 1.0) * 100.0
                    if math.isfinite(cagr):
                        return cagr
            # Linear annualisation fallback.
            return total_return_pct / holding_years

        # No holding period — return the raw total return percentage.
        return total_return_pct

    @staticmethod
    def _estimate_holding_years(asset: Dict[str, Any]) -> Optional[float]:
        """Estimate holding period in years from added_at / updated_at."""
        added = asset.get("added_at")
        if not added:
            return None
        try:
            # SQLite default is "YYYY-MM-DD HH:MM:SS" or ISO "YYYY-MM-DDTHH:MM:SS"
            s = str(added).replace("T", " ").replace("Z", "").strip()
            # Try a few common formats.
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(s, fmt)
                    break
                except ValueError:
                    continue
            else:
                return None
        except Exception:  # noqa: BLE001
            return None
        delta_days = (datetime.now() - dt).total_seconds() / 86400.0
        if delta_days < 1:
            return None
        return delta_days / 365.25

    # ------------------------------------------------------------------
    # Arabic warnings
    # ------------------------------------------------------------------

    @staticmethod
    def _warning_ar_for_asset(name: str, nominal: float, inflation: float,
                              asset_class_label: str) -> str:
        """Generate a human-style Arabic warning for a single losing asset."""
        real = nominal - inflation
        burn = abs(real)
        if burn >= 15:
            return (
                f"فلوسك في «{name}» بتذوب بمعدل {burn:.1f}% سنوياً بسبب التضخم. "
                f"العائد الاسمي {nominal:.1f}% والتضخم {inflation:.1f}%. "
                f"حوّل الجزء ده لأسهم قوية أو ذهب عشان تحافظ على قيمة فلوسك."
            )
        if burn >= 5:
            return (
                f"«{name}» ({asset_class_label}) عائده {nominal:.1f}% والتضخم {inflation:.1f}% "
                f"— يعني بتخسر {burn:.1f}% سنوياً من القيمة الحقيقية. "
                f"فكر تحوّل جزء منه لأصول بتنمو مع التضخم."
            )
        # Mild loss (< 5%)
        return (
            f"«{name}» عائده أقل من التضخم بـ {burn:.1f}% — خسارة بطيئة بس حقيقية. "
            f"راقب الوضع، ولو التضخم فضل عالي حوّل جزء منه."
        )

    @staticmethod
    def _portfolio_summary_ar(portfolio_nominal: float, portfolio_real: float,
                              inflation: float, warning_count: int,
                              asset_count: int) -> str:
        """Generate an overall Arabic summary for the whole portfolio."""
        if asset_count == 0:
            return (
                "مفيش أصول في محفظتك لسه — أضف شهادات إيداع أو أسهم أو ذهب "
                "عشان نشوف عائدها الحقيقي بعد خصم التضخم."
            )
        if warning_count == 0 and portfolio_real > 0:
            return (
                f"محفظتك بتحقق عائد حقيقي موجب {portfolio_real:.1f}% بعد خصم التضخم "
                f"({inflation:.1f}%) — كويس جداً. حافظ على التوازن وراقب الأصول اللي "
                f"عائدها أقل من التضخم."
            )
        if warning_count == 0 and portfolio_real >= -1:
            return (
                f"محفظتك عائدها الحقيقي تقريباً صفر ({portfolio_real:+.1f}%) — بتنافس "
                f"التضخم بالكاد. حاول تزوّد نسبة الأسهم والذهب على حساب الدخل الثابت."
            )
        if portfolio_real < -10:
            return (
                f"محفظتك بتخسر {abs(portfolio_real):.1f}% سنوياً من قيمتها الحقيقية بسبب "
                f"التضخم ({inflation:.1f}%). عندك {warning_count} أصل عائده أقل من التضخم. "
                f"حوّل جزء من الدخل الثابت لأسهم قوية أو ذهب أو عقارات عشان تحمي فلوسك."
            )
        # Mild portfolio-level loss
        return (
            f"محفظتك عائدها الحقيقي سالب ({portfolio_real:+.1f}%) بسبب التضخم "
            f"({inflation:.1f}%). عندك {warning_count} أصل بيخسر قيمة حقيقية. "
            f"راجع توزيع الأصول وفكر تقلل نسبة الدخل الثابت."
        )

    # ------------------------------------------------------------------
    # Main evaluation
    # ------------------------------------------------------------------

    def evaluate_portfolio(self, user_id: str) -> Dict[str, Any]:
        """Evaluate the real return of every asset in the user's portfolio.

        Args:
            user_id: The portfolio owner's id (defaults to "default" upstream
                if not provided).

        Returns:
            Dict with: inflation_rate, assets[], portfolio_nominal_return,
            portfolio_real_return, summary_ar, warning_count.
        """
        user_id = user_id or "default"

        inflation_info = self._load_inflation_rate()
        inflation_rate = float(inflation_info["value"])

        assets_raw = self._load_user_assets(user_id)

        assets_out: List[Dict[str, Any]] = []
        weighted_nominal_sum = 0.0
        weight_total = 0.0
        warning_count = 0

        for a in assets_raw:
            asset_class_raw = a.get("asset_class") or a.get("type") or "stock"
            is_cash = _is_cash_equivalent(a.get("asset_class"), a.get("type"))
            is_equity = _is_equity(a.get("asset_class"), a.get("type"))
            # Default to equity treatment if asset_class missing/unknown.
            if not is_cash and not is_equity:
                is_equity = True

            if is_cash:
                nominal_yield = self._compute_cash_yield(a)
                asset_class_label = "Cash Equivalent"
            else:
                nominal_yield = self._compute_equity_yield(a)
                asset_class_label = "Equity"

            # If we couldn't compute a yield at all, treat as 0 (losing to
            # inflation unless inflation is also 0).
            nominal_yield_val = float(nominal_yield) if nominal_yield is not None else 0.0
            real_return = nominal_yield_val - inflation_rate
            is_losing = real_return < 0

            if is_losing:
                warning_count += 1
                warning_ar = self._warning_ar_for_asset(
                    a.get("name") or "(بدون اسم)",
                    nominal_yield_val,
                    inflation_rate,
                    asset_class_label,
                )
            else:
                warning_ar = ""

            # Weighted average — weight by current_value (or total_invested
            # if current_value is zero/missing).
            invested = self._safe_float(a.get("total_invested"))
            current = self._safe_float(a.get("current_value"))
            weight = current if current > 0 else invested
            if weight > 0:
                weighted_nominal_sum += nominal_yield_val * weight
                weight_total += weight

            assets_out.append({
                "id": a.get("id"),
                "name": a.get("name"),
                "asset_class": asset_class_label,
                "asset_class_raw": asset_class_raw,
                "type": a.get("type"),
                "total_invested": round(invested, 2),
                "current_value": round(current, 2),
                "annual_yield": round(self._safe_float(a.get("annual_yield")), 2),
                "certificate_return_rate": round(
                    self._safe_float(a.get("certificate_return_rate")), 2
                ) if a.get("certificate_return_rate") is not None else None,
                "interest_rate": round(
                    self._safe_float(a.get("interest_rate")), 2
                ) if a.get("interest_rate") is not None else None,
                "nominal_yield": round(nominal_yield_val, 2),
                "real_return": round(real_return, 2),
                "is_losing_to_inflation": bool(is_losing),
                "warning_ar": warning_ar,
            })

        portfolio_nominal = (
            weighted_nominal_sum / weight_total if weight_total > 0 else 0.0
        )
        portfolio_real = portfolio_nominal - inflation_rate

        summary_ar = self._portfolio_summary_ar(
            portfolio_nominal, portfolio_real, inflation_rate,
            warning_count, len(assets_out),
        )

        return {
            "user_id": user_id,
            "inflation_rate": round(inflation_rate, 2),
            "inflation_source": inflation_info["source"],
            "inflation_missing": bool(inflation_info["missing"]),
            "inflation_fallback_used": bool(inflation_info["missing"]),
            "assets": assets_out,
            "portfolio_nominal_return": round(portfolio_nominal, 2),
            "portfolio_real_return": round(portfolio_real, 2),
            "summary_ar": summary_ar,
            "warning_count": int(warning_count),
            "asset_count": len(assets_out),
            "evaluated_at": datetime.now().isoformat(timespec="seconds"),
        }


# ---------------------------------------------------------------------------
# Standalone smoke test (does NOT run on import)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    uid = sys.argv[1] if len(sys.argv) > 1 else "default"
    import json
    result = RealReturnEngine().evaluate_portfolio(uid)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
