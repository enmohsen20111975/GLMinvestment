#!/usr/bin/env python3
"""
purification_calculator.py — حاسبة تطهير الأرباح (Tazkiyah)
============================================================================
المعيار الأساسي: **S&P Shariah**
    التطهير = نسبة التطهير × (التوزيعات النقدية + ربح رأس المال)
    لو المستخدم اختار "توزيعات فقط"، الربح الرأسمالي بره الوعاء
    (ده أسلوب Musaffa / كاشف / أسطول).

المصادر التكميلية (اختيارية، لو موجودة):
    musaffa / kashif / osoul → نسب تطهير جاهزة على التوزيعات فقط.
    AAOIFI مستبعدة: القيمة المنشورة في المصدر (aaoifi_haram_earning_per_share)
    غير متسقة رياضياً مع نسبة S&P (4.7e-08 ج.م/سهم) ⇒ aaoifi_usable = 0.

مصادر البيانات (بعد الربط):
    sharia_purification_rates  (data_engine.db) → نسبة التطهير لكل منهجية
    stocks.dps_ttm / dividend_yield, stocks.current_price  (stocks.db)
    tab_dividends.dps_ttm  (data_engine.db) ← بعد إصلاح رموز tab_*
    portfolio_assets  (stocks.db) → الكمية وسعر الشراء

الاستخدام:
    from purification_calculator import PurificationCalculator
    calc = PurificationCalculator()
    calc.purify_symbol("ABUK", quantity=500, buy_price=72.0, sell_price=90.0)
    calc.purify_portfolio(user_id="...")
"""
from __future__ import annotations

import re
import sqlite3
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

try:
    from utils.db_paths import DBPaths
    DATA_ENGINE_DB = DBPaths.DATA_ENGINE_DB
    STOCKS_DB = DBPaths.STOCKS_DB
except Exception:  # pragma: no cover
    DATA_ENGINE_DB = str(PROJECT_ROOT / "db" / "data_engine.db")
    STOCKS_DB = str(PROJECT_ROOT / "db" / "stocks.db")

PRIMARY_METHOD = "S&P"
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def to_float(value) -> float | None:
    """'6.00 EGP' → 6.0 · '2.70%' → 2.7 · None → None"""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = _NUM_RE.search(str(value))
    return float(m.group(0)) if m else None


@dataclass
class RateOption:
    method_key: str
    method_name_ar: str
    rate_pct: float
    basis: str
    source_updated: str | None = None
    is_primary: bool = False


@dataclass
class PositionResult:
    symbol: str
    name_ar: str | None = None
    quantity: float = 0.0
    buy_price: float | None = None
    sell_price: float | None = None
    dps: float | None = None
    dps_source: str | None = None
    capital_gain: float = 0.0
    dividends: float = 0.0
    purification_base: float = 0.0
    method: str = PRIMARY_METHOD
    rate_pct: float | None = None
    purification_amount: float | None = None
    include_capital_gain: bool = True
    compliant_sources: int | None = None
    is_halal_consensus: bool | None = None
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    alternative_rates: list[dict] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


class PurificationCalculator:
    def __init__(self, data_engine_db: str | None = None,
                 stocks_db: str | None = None):
        self.de_db = data_engine_db or DATA_ENGINE_DB
        self.stocks_db = stocks_db or STOCKS_DB
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        self._de = db_manager.get_connection(%s, writable=False)
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        self._st = db_manager.get_connection(%s, writable=False)
        self._de.row_factory = sqlite3.Row
        self._st.row_factory = sqlite3.Row

    def close(self):
        self._de.close()
        self._st.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ── sharia side ───────────────────────────────────────────────────────
    def get_rates(self, symbol: str) -> list[RateOption]:
        """كل نسب التطهير المتاحة للسهم، الأساسية أول."""
        symbol = symbol.strip().upper()
        rows = self._de.execute(
            "SELECT method_key, method_name_ar, rate_pct, basis, source_updated, is_primary "
            "FROM sharia_purification_rates WHERE symbol = ? ORDER BY is_primary DESC, rate_pct",
            (symbol,)).fetchall()
        return [RateOption(
            method_key=r["method_key"], method_name_ar=r["method_name_ar"] or r["method_key"],
            rate_pct=float(r["rate_pct"]), basis=r["basis"] or "dividends_only",
            source_updated=r["source_updated"], is_primary=bool(r["is_primary"]),
        ) for r in rows if r["rate_pct"] is not None]

    def get_compliance(self, symbol: str) -> dict | None:
        symbol = symbol.strip().upper()
        r = self._de.execute(
            "SELECT symbol, name_ar, compliant_sources_count, active_sources_count, "
            "is_halal_consensus, sp_haram_earning_pct, source_updated_max, synced_at, "
            "raw_symbol, alias_method, alias_confidence, needs_review "
            "FROM sharia_metrics WHERE symbol = ?", (symbol,)).fetchone()
        if not r:
            return None
        return {
            "symbol": r["symbol"],
            "name_ar": r["name_ar"],
            "compliant_sources_count": r["compliant_sources_count"],
            "active_sources_count": r["active_sources_count"],
            "is_halal_consensus": bool(r["is_halal_consensus"]),
            "sp_haram_earning_pct": r["sp_haram_earning_pct"],
            "source_updated_max": r["source_updated_max"],
            "synced_at": r["synced_at"],
            "raw_symbol": r["raw_symbol"],
            "alias_method": r["alias_method"],
            "alias_confidence": r["alias_confidence"],
            "needs_review": bool(r["needs_review"]),
        }

    def get_source_breakdown(self, symbol: str) -> list[dict]:
        symbol = symbol.strip().upper()
        rows = self._de.execute(
            "SELECT s.source_key, m.name_ar AS source_name_ar, s.status, s.percentage, "
            "s.note, s.source_updated FROM sharia_source_status s "
            "LEFT JOIN sharia_sources m ON m.source_key = s.source_key "
            "WHERE s.symbol = ? ORDER BY s.status, s.source_key", (symbol,)).fetchall()
        return [dict(r) for r in rows]

    # ── market / dividend side ────────────────────────────────────────────
    def get_price(self, symbol: str) -> dict | None:
        symbol = symbol.strip().upper()
        r = self._st.execute(
            "SELECT ticker, name, current_price, previous_close, dividend_yield, dps_ttm "
            "FROM stocks WHERE UPPER(ticker) = ?", (symbol,)).fetchone()
        return dict(r) if r else None

    def get_dividend_per_share(self, symbol: str) -> tuple[float | None, str | None]:
        """DPS من tab_dividends (بعد إصلاح الرموز) → fallback لـ stocks.dps_ttm
        → fallback اشتقاق من dividend_yield × السعر."""
        symbol = symbol.strip().upper()
        r = self._de.execute(
            "SELECT dps_ttm, dps_fy, div_yield FROM tab_dividends "
            "WHERE UPPER(symbol) = ? AND market = 'مصر'", (symbol,)).fetchone()
        if r:
            dps = to_float(r["dps_ttm"]) or to_float(r["dps_fy"])
            if dps:
                return dps, "tab_dividends.dps_ttm"
        q = self._st.execute(
            "SELECT dps_ttm, dividend_yield, current_price FROM stocks "
            "WHERE UPPER(ticker) = ?", (symbol,)).fetchone()
        if q:
            dps = to_float(q["dps_ttm"])
            if dps:
                return dps, "stocks.dps_ttm"
            dy = to_float(q["dividend_yield"])
            px = to_float(q["current_price"])
            if dy and px and dy > 0:
                return round(px * dy / 100.0, 4), "derived:dividend_yield×price"
        return None, None

    # ── the calculation ───────────────────────────────────────────────────
    def purify_symbol(self, symbol: str, quantity: float, buy_price: float | None = None,
                      sell_price: float | None = None, dps: float | None = None,
                      method: str = PRIMARY_METHOD,
                      include_capital_gain: bool | None = None) -> PositionResult:
        symbol = symbol.strip().upper()
        rates = self.get_rates(symbol)
        comp = self.get_compliance(symbol)
        mkt = self.get_price(symbol)
        warnings: list[str] = []
        notes: list[str] = []

        if not rates:
            return PositionResult(
                symbol=symbol, name_ar=(comp or {}).get("name_ar") or (mkt or {}).get("name"),
                quantity=quantity, buy_price=buy_price, sell_price=sell_price,
                warnings=["مفيش نسبة تطهير مسجلة للسهم %s — راجع تحديث scraper" % symbol],
                alternative_rates=[])

        chosen = next((r for r in rates if r.method_key == method), None)
        if chosen is None:
            chosen = rates[0]
            warnings.append("نسبة S&P غير منشورة لهذا السهم — تم استخدام '%s' (%s) كبديل. "
                            "S&P هو معيارنا الأساسي وبتغطيه 182 من 253 سهم."
                            % (chosen.method_name_ar, chosen.rate_pct))
            method = chosen.method_key

        # السهم غير متوافق في كل المصادر → المشكلة ليست التطهير بل الاستمرار
        # في possessing سهم حرام أصلاً. لازم التنبيه يكون واضح.
        if comp and not comp.get("compliant_sources_count"):
            warnings.append(
                "⚠️ السهم غير متوافق في كل مصادر الفحص — التطهير مش هيالمشكلة، "
                "المشكلة في امتلاك السهم نفسه. راجع get_source_breakdown(%s)."
                % symbol)

        # الرمز اتربّط بالمصدر بطريقة غير مباشرة (اسم مختلف / الرمز جوه الاسم)
        if comp and comp.get("needs_review"):
            warnings.append(
                "🔍 ربط الرمز محتاج مراجعة: '%s' اتربّط بـ '%s' عن طريق %s "
                "(ثقة %s) — شوف sharia_symbol_map."
                % (comp.get("raw_symbol"), symbol, comp.get("alias_method"),
                   comp.get("alias_confidence")))

        # S&P بيشمل الربح الرأسمائي · باقي المنهجيات على التوزيعات بس
        if include_capital_gain is None:
            include_capital_gain = (chosen.basis == "dividends_plus_capital_gain")
        if include_capital_gain and chosen.basis == "dividends_only":
            notes.append("المنهجية '%s' بتغطي التوزيعات فقط — الربح الرأسمالي بره الوعاء"
                         % chosen.method_name_ar)

        if dps is None:
            dps, dps_src = self.get_dividend_per_share(symbol)
        else:
            dps_src = "caller"
        if dps is None:
            dps, dps_src = 0.0, "missing"
            warnings.append("مفيش dividend-per-share للسهم — التطهير محسوب على الربح الرأسمالي بس")

        if sell_price is None:
            sell_price = to_price(mkt, "current_price")
            if sell_price:
                notes.append("سعر البيع اتجيب من السعر الحالي في stocks")

        capital_gain = 0.0
        if buy_price is not None and sell_price is not None:
            capital_gain = (float(sell_price) - float(buy_price)) * float(quantity)
        elif include_capital_gain:
            warnings.append("سعر الشراء/البيع ناقص — تعذّر حساب الربح الرأسمالي")

        # معيار S&amp;P يلزم التطهير على **الأرباح المستلمة** فعلاً.
        # خسارة غير محققة (سعر البيع أقل من الشراء) ما بتلغيش التزام التطهير
        # على التوزيعات، فماينفعش تخصم من الوعاء. والutar التطهير ما بينفعش
        # يبقى سالب — لأن مفيش "تطهير سالب".
        capital_gain_credit = 0.0
        if capital_gain > 0:
            capital_gain_credit = capital_gain
        elif capital_gain < 0:
            notes.append("خسارة غير محققة %.2f ج.م — ما اتخصمتش من وعاء التطهير "
                         "(S&P ملزم على الأرباح المستلمة فقط)" % abs(capital_gain))

        dividends = float(dps) * float(quantity)
        base = dividends + (capital_gain_credit if include_capital_gain else 0.0)
        amount = round(max(base, 0.0) * chosen.rate_pct / 100.0, 2)

        alts = [{"method_key": r.method_key, "method_name_ar": r.method_name_ar,
                 "rate_pct": r.rate_pct, "basis": r.basis,
                 "amount_if_dividends_only":
                     round(dividends * r.rate_pct / 100.0, 2),
                 "source_updated": r.source_updated}
                for r in rates if r.method_key != chosen.method_key]

        return PositionResult(
            symbol=symbol,
            name_ar=(comp or {}).get("name_ar") or (mkt or {}).get("name"),
            quantity=float(quantity), buy_price=buy_price, sell_price=sell_price,
            dps=dps, dps_source=dps_src,
            capital_gain=round(capital_gain, 2), dividends=round(dividends, 2),
            purification_base=round(base, 2), method=chosen.method_key,
            rate_pct=chosen.rate_pct, purification_amount=amount,
            include_capital_gain=include_capital_gain,
            compliant_sources=(comp or {}).get("compliant_sources_count"),
            is_halal_consensus=(comp or {}).get("is_halal_consensus"),
            warnings=warnings, notes=notes, alternative_rates=alts,
        )

    # ── portfolio level ───────────────────────────────────────────────────
    def purify_portfolio(self, user_id: str | None = None,
                         portfolio_id: str | None = None,
                         method: str = PRIMARY_METHOD,
                         include_capital_gain: bool | None = None) -> dict:
        """يحسب التطهير لكل مراكز محفظة المستخدم."""
        where, params = [], []
        if user_id:
            where.append("user_id = ?")
            params.append(user_id)
        if portfolio_id:
            where.append("portfolio_id = ?")
            params.append(portfolio_id)
        clause = ("WHERE " + " AND ".join(where)) if where else ""

        rows = self._st.execute(
            "SELECT id, name, stock_ticker, quantity, avg_buy_price, total_invested, "
            "asset_class, is_active FROM portfolio_assets %s" % clause, params).fetchall()

        results, skipped = [], []
        for r in rows:
            ticker = clean_ticker(r["stock_ticker"])
            if not ticker or ticker != ticker.upper():
                skipped.append({"id": r["id"], "name": r["name"],
                                "stock_ticker": r["stock_ticker"],
                                "reason": "stock_ticker تالف أو فاضي"})
                continue
            qty = to_float(r["quantity"]) or 0.0
            if qty <= 0:
                skipped.append({"id": r["id"], "name": r["name"],
                                "stock_ticker": ticker, "reason": "كمية غير صالحة"})
                continue
            if not self.get_rates(ticker):
                skipped.append({"id": r["id"], "name": r["name"],
                                "stock_ticker": ticker,
                                "reason": "مفيش بيانات شرعية"})
                continue
            mkt = self.get_price(ticker)
            res = self.purify_symbol(
                ticker, quantity=qty,
                buy_price=to_float(r["avg_buy_price"]),
                sell_price=to_price(mkt, "current_price"),
                method=method, include_capital_gain=include_capital_gain)
            results.append(res)

        total = round(sum(r.purification_amount or 0.0 for r in results), 2)
        total_base = round(sum(r.purification_base for r in results), 2)
        non_halal = [r.to_dict() for r in results if r.is_halal_consensus is False]
        return {
            "method": method,
            "include_capital_gain": include_capital_gain,
            "positions": [r.to_dict() for r in results],
            "skipped": skipped,
            "risk_summary": {
                "positions_without_consensus": len(non_halal),
                "symbols_without_consensus": [r["symbol"] for r in non_halal],
                "highest_purification": [
                    {"symbol": r.symbol, "amount": r.purification_amount}
                    for r in sorted(results,
                                    key=lambda x: -(x.purification_amount or 0))[:5]],
            },
            "totals": {
                "positions_with_sharia_data": len(results),
                "skipped": len(skipped),
                "purification_base": total_base,
                "purification_amount": total,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }


def to_price(market_row, key):
    if not market_row:
        return None
    try:
        return to_float(market_row[key])
    except (KeyError, IndexError):
        return None


_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")


def clean_ticker(raw) -> str | None:
    """.portfolio_assets فيه صفوف ticker تالف:
    'FWRYFawry For Banking...' / 'INTEGRATED' / '4160' / 'VLMRA'.
    بترجع ticker نضيف أو None."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = s.upper()
    if _TICKER_RE.match(s):
        return s
    return None


if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Purification calculator (S&P primary)")
    ap.add_argument("--symbol", help="calculate for one symbol")
    ap.add_argument("--qty", type=float, default=100)
    ap.add_argument("--buy", type=float)
    ap.add_argument("--sell", type=float)
    ap.add_argument("--method", default=PRIMARY_METHOD)
    ap.add_argument("--user", help="purify a whole portfolio by user_id")
    ap.add_argument("--no-capital-gain", action="store_true")
    args = ap.parse_args()

    icg = False if args.no_capital_gain else None
    with PurificationCalculator() as c:
        if args.symbol:
            out = c.purify_symbol(args.symbol, args.qty, args.buy, args.sell,
                                  method=args.method, include_capital_gain=icg).to_dict()
        elif args.user:
            out = c.purify_portfolio(user_id=args.user, method=args.method,
                                     include_capital_gain=icg)
        else:
            ap.print_help()
            sys.exit(1)
    print(json.dumps(out, ensure_ascii=False, indent=2))