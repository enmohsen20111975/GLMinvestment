#!/usr/bin/env python3
"""specialist_analyst.py — محرك المحلل المالي المؤسسي الذكي
=================================================================================
Task BRAVO2-SPECIALIST (2026-10-15): AI Specialist Investment Memo.

يولّد مذكرة استثمارية مؤسسية مكثفة بأسلوب بنوك الاستثمار (Hermes/JP Morgan Style).

Usage:
    from specialist_analyst import generate_memo
    memo = generate_memo("COMI", market="EGX")
"""
from __future__ import annotations
import sqlite3, json
from pathlib import Path
from typing import Dict, Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
DATA_ENGINE_DB = PROJECT_ROOT / "db" / "data_engine.db"


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace("%","").replace("B","").replace("M","").replace("T","").replace("SAR","").replace("EGP","").strip())
    except: return default


def generate_memo(ticker: str, market: str = "EGX") -> Dict[str, Any]:
    """توليد مذكرة استثمارية مؤسسية للسهم."""
    conn = sqlite3.connect(str(STOCKS_DB))
    c = conn.cursor()

    # Stock info
    c.execute("SELECT ticker, name, name_ar, current_price, change_percent, volume, market_cap, pe_ratio, pb_ratio, dividend_yield, debt_to_equity, sector, market FROM stocks WHERE ticker = ?", (ticker,))
    row = c.fetchone()
    if not row:
        return {"success": False, "error": f"Stock {ticker} not found"}

    cols = [d[0] for d in c.description]
    stock = dict(zip(cols, row))
    conn.close()

    # Cash flow from data_engine.db
    cf_data = {}
    bs_data = {}
    try:
        conn2 = sqlite3.connect(str(DATA_ENGINE_DB))
        c2 = conn2.cursor()
        c2.execute("SELECT fiscal_period, operating_cf, free_cf FROM tab_cash_flow WHERE symbol = ? ORDER BY fiscal_period DESC LIMIT 1", (ticker,))
        cf_row = c2.fetchone()
        if cf_row:
            cf_data = {"fiscal_period": cf_row[0], "operating_cf": cf_row[1], "free_cf": cf_row[2]}
        c2.execute("SELECT cash, debt, total_equity FROM tab_balance_sheet WHERE symbol = ? ORDER BY fiscal_period DESC LIMIT 1", (ticker,))
        bs_row = c2.fetchone()
        if bs_row:
            bs_data = {"cash": bs_row[0], "debt": bs_row[1], "equity": bs_row[2]}
        conn2.close()
    except: pass

    # Build memo
    pe = _to_float(stock.get("pe_ratio"))
    pb = _to_float(stock.get("pb_ratio"))
    dy = _to_float(stock.get("dividend_yield"))
    de = _to_float(stock.get("debt_to_equity"))
    price = _to_float(stock.get("current_price"))
    chg = _to_float(stock.get("change_percent"))

    # Decision logic
    if pe > 0 and pe < 15 and dy > 3:
        signal = "BUY"
        recommendation = "سهم مقيم بأقل من متوسط السوق، عائد توزيعات مجذب، كاش قوي"
    elif pe > 0 and pe < 25:
        signal = "ACCUMULATE"
        recommendation = "تقييم متوازن، كاش يدعم الاستمرارية"
    elif pe > 25:
        signal = "WAIT"
        recommendation = "تقييم مرتفع نسبياً، انتظر تصحيح أو تحسن في الأرباح"
    else:
        signal = "HOLD"
        recommendation = "بيانات تقييم غير كافية، استمر بالمراقبة"

    # Build sections
    memo = {
        "success": True,
        "ticker": ticker,
        "name": stock.get("name_ar") or stock.get("name") or ticker,
        "market": stock.get("market", market),
        "price": price,
        "change_pct": chg,
        "signal": signal,
        "recommendation": recommendation,
        "sections": {
            "1_cash_position": {
                "title": "كاش الشركة وقوتها المالي",
                "content": f"السعر الحالي: {price:.2f} | P/E: {pe:.1f} | P/B: {pb:.2f} | عائد التوزيع: {dy:.2f}%"
                    + (f" | الكاش: {cf_data.get('free_cf', '—')}" if cf_data else "")
                    + (f" | الديون/الحقوق: {de:.2f}" if de > 0 else ""),
            },
            "2_whale_flow": {
                "title": "تمركز الحوت وتدفق السيولة",
                "content": f"حجم التداول: {stock.get('volume', '—')} | القيمة السوقية: {stock.get('market_cap', '—')}",
            },
            "3_decision": {
                "title": "القرار الصريح",
                "content": f"الإشارة: {signal} | التوصية: {recommendation}",
            },
        },
        "fundamentals": {
            "pe_ratio": pe,
            "pb_ratio": pb,
            "dividend_yield": dy,
            "debt_to_equity": de,
            "free_cash_flow": cf_data.get("free_cf"),
            "operating_cash_flow": cf_data.get("operating_cf"),
            "cash_on_hand": bs_data.get("cash"),
            "total_debt": bs_data.get("debt"),
            "total_equity": bs_data.get("equity"),
        },
    }
    return memo


if __name__ == "__main__":
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else "COMI"
    market = sys.argv[2] if len(sys.argv) > 2 else "EGX"
    memo = generate_memo(ticker, market)
    print(json.dumps(memo, ensure_ascii=False, indent=2))
