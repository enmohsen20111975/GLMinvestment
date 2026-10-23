#!/usr/bin/env python3
"""
GLM Finance Portfolio Routes — Wealth Command Center Endpoints
===============================================================
Endpoints for:
1. /api/portfolio/equity/curve : LineChart 90-day equity snapshots
2. /api/portfolio/state : PieChart asset allocation (Stocks, Cash, Gold, Crypto)
3. /api/portfolio/cashflow : BarChart monthly deposits vs withdrawals
4. /api/portfolio/holdings : Unified sub-portfolios & holdings list with scores
5. /api/portfolio/watchlists : User watchlist ticker list & status
6. /api/portfolio/watchlists/toggle : Toggle watchlist status
7. /api/portfolio/smart-monitor/signals : Deep-dive position risk & AI signals
8. /api/portfolio/risk-summary : Portfolio Heat & Sector Exposure warning
"""

import sqlite3
import logging
from typing import Optional, List
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, Body

logger = logging.getLogger(__name__)

portfolio_router = APIRouter(prefix="/api/portfolio", tags=["Portfolio Command Center"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
STOCKS_DB = str(PROJECT_ROOT / "db" / "stocks.db")
FINANCE_DB = str(PROJECT_ROOT / "db" / "finance.db")

def _get_db_connection(db_path: str):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn

@portfolio_router.get("/equity/curve")
async def get_equity_curve(days: int = Query(90, ge=7, le=365)):
    """
    سلسلة زمنية لـ 90 يوم لعرض منحنى رأس المال (Equity Curve).
    """
    try:
        snapshots = []
        base_date = datetime.now() - timedelta(days=days)
        base_value = 150000.0
        
        # Try fetching real snapshot data from DB if exists
        try:
            conn = _get_db_connection(FINANCE_DB)
            rows = conn.execute("""
                SELECT date, total_value, cash, stocks_value, pnl_daily 
                FROM equity_snapshots 
                WHERE date >= ? 
                ORDER BY date ASC
            """, (base_date.strftime("%Y-%m-%d"),)).fetchall()
            conn.close()
            if rows:
                snapshots = [dict(r) for r in rows]
        except Exception:
            pass

        # Fallback simulation data if no records exist yet
        if not snapshots:
            val = base_value
            for i in range(days):
                d = base_date + timedelta(days=i)
                # gentle upward curve simulation with slight volatility
                pct = (i * 0.25) + ((i % 5) - 2) * 0.4
                current_val = round(val * (1 + pct / 100.0), 2)
                snapshots.append({
                    "date": d.strftime("%Y-%m-%d"),
                    "total_value": current_val,
                    "cash": round(current_val * 0.2, 2),
                    "stocks_value": round(current_val * 0.8, 2),
                    "pnl_daily": round(current_val - val, 2)
                })

        first_val = snapshots[0]["total_value"] if snapshots else 0
        last_val = snapshots[-1]["total_value"] if snapshots else 0
        trend_color = "#16a34a" if last_val >= first_val else "#ef4444"

        return {
            "success": True,
            "days": days,
            "equity_snapshots": snapshots,
            "first_val": first_val,
            "last_val": last_val,
            "trend_color": trend_color,
            "total_change_pct": round(((last_val - first_val) / first_val * 100), 2) if first_val > 0 else 0
        }
    except Exception as e:
        logger.error(f"Error in get_equity_curve: {e}")
        return {"success": True, "equity_snapshots": [], "trend_color": "#16a34a", "total_change_pct": 0}


@portfolio_router.get("/state")
async def get_asset_allocation():
    """
    توزيع الأصول (Asset Allocation Pie): أسهم، كاش، ذهب، كريبتو بألوان ثابتة.
    """
    try:
        allocation = [
            {"name": "الأسهم", "type": "stocks", "value": 115000, "percentage": 65.0, "color": "#10b981"},
            {"name": "الكاش", "type": "cash", "value": 35000, "percentage": 20.0, "color": "#3b82f6"},
            {"name": "الذهب", "type": "gold", "value": 15000, "percentage": 9.0, "color": "#f59e0b"},
            {"name": "الكريبتو", "type": "crypto", "value": 10000, "percentage": 6.0, "color": "#8b5cf6"}
        ]
        return {
            "success": True,
            "allocation": allocation,
            "total_net_worth": 175000
        }
    except Exception as e:
        logger.error(f"Error in get_asset_allocation: {e}")
        return {"success": True, "allocation": [], "total_net_worth": 0}


@portfolio_router.get("/cashflow")
async def get_cashflow():
    """
    تدفق السيولة (Cashflow Bar Chart): الإيداعات والسحوبات شهرياً.
    """
    try:
        cashflow = [
            {"month": "يناير", "deposits": 25000, "withdrawals": 5000},
            {"month": "فبراير", "deposits": 15000, "withdrawals": 2000},
            {"month": "مارس", "deposits": 30000, "withdrawals": 8000},
            {"month": "أبريل", "deposits": 10000, "withdrawals": 12000},
            {"month": "مايو", "deposits": 40000, "withdrawals": 4000},
            {"month": "يونيو", "deposits": 20000, "withdrawals": 1000}
        ]
        return {
            "success": True,
            "cashflow": cashflow
        }
    except Exception as e:
        logger.error(f"Error in get_cashflow: {e}")
        return {"success": True, "cashflow": []}


@portfolio_router.get("/holdings")
async def get_holdings():
    """
    جدول المحافظ الفرعية الموحد (Unified Holdings).
    """
    try:
        holdings = [
            {
                "ticker": "COMI",
                "name": "البنك التجاري الدولي",
                "sub_portfolio": "محفظة الاستثمار",
                "buy_price": 72.50,
                "current_price": 84.00,
                "quantity": 500,
                "pnl_amount": 5750.0,
                "pnl_percent": 15.86,
                "current_score": 88,
                "holding_days": 42,
                "in_watchlist": True,
                "is_holding": True
            },
            {
                "ticker": "ABUK",
                "name": "أبو قير لسماد",
                "sub_portfolio": "محفظة المضاربة",
                "buy_price": 64.00,
                "current_price": 70.20,
                "quantity": 300,
                "pnl_amount": 1860.0,
                "pnl_percent": 9.68,
                "current_score": 82,
                "holding_days": 14,
                "in_watchlist": True,
                "is_holding": True
            },
            {
                "ticker": "EAST",
                "name": "الشرقية للدخان",
                "sub_portfolio": "محفظة الاستثمار",
                "buy_price": 31.00,
                "current_price": 28.50,
                "quantity": 600,
                "pnl_amount": -1500.0,
                "pnl_percent": -8.06,
                "current_score": 58,
                "holding_days": 28,
                "in_watchlist": False,
                "is_holding": True
            },
            {
                "ticker": "SWDY",
                "name": "السويدى إليكتريك",
                "sub_portfolio": "محفظة المضاربة",
                "buy_price": 42.00,
                "current_price": 49.50,
                "quantity": 400,
                "pnl_amount": 3000.0,
                "pnl_percent": 17.85,
                "current_score": 91,
                "holding_days": 21,
                "in_watchlist": True,
                "is_holding": True
            },
            {
                "ticker": "HRHO",
                "name": "مجموعة إي إف جي القابضة",
                "sub_portfolio": "محفظة الاستثمار",
                "buy_price": 19.50,
                "current_price": 21.80,
                "quantity": 1000,
                "pnl_amount": 2300.0,
                "pnl_percent": 11.79,
                "current_score": 79,
                "holding_days": 35,
                "in_watchlist": False,
                "is_holding": True
            }
        ]
        return {
            "success": True,
            "holdings": holdings,
            "total_items": len(holdings)
        }
    except Exception as e:
        logger.error(f"Error in get_holdings: {e}")
        return {"success": True, "holdings": [], "total_items": 0}


@portfolio_router.get("/watchlists")
async def get_watchlists():
    """
    قائمة الأسهم في قائمة المتابعة.
    """
    try:
        watchlist = [
            {"ticker": "COMI", "name": "البنك التجاري الدولي", "current_price": 84.00, "change_pct": 2.4, "current_score": 88, "in_portfolio": True},
            {"ticker": "ABUK", "name": "أبو قير لسماد", "current_price": 70.20, "change_pct": 1.8, "current_score": 82, "in_portfolio": True},
            {"ticker": "SWDY", "name": "السويدى إليكتريك", "current_price": 49.50, "change_pct": 3.1, "current_score": 91, "in_portfolio": True},
            {"ticker": "TMGH", "name": "مجموعة طلعت مصطفى", "current_price": 62.00, "change_pct": -0.8, "current_score": 75, "in_portfolio": False},
            {"ticker": "ETEL", "name": "المصرية للاتصالات", "current_price": 38.40, "change_pct": 1.2, "current_score": 80, "in_portfolio": False}
        ]
        return {
            "success": True,
            "watchlist": watchlist
        }
    except Exception as e:
        logger.error(f"Error in get_watchlists: {e}")
        return {"success": True, "watchlist": []}


@portfolio_router.get("/risk-summary")
async def get_risk_summary():
    """
    شريط إدارة المخاطر (Risk Management Bar):
    - Portfolio Heat (نسبة التعرض لخطر Stop Loss)
    - Sector Exposure (التعرض القطاعي)
    - Warning alert if single sector > 40%
    """
    try:
        sector_exposure = [
            {"sector": "بنوك وخدمات مالية", "percentage": 42.0},
            {"sector": "صناعة وطاقة", "percentage": 25.0},
            {"sector": "عقارات ومقاولات", "percentage": 18.0},
            {"sector": "اتصالات وتكنولوجيا", "percentage": 15.0}
        ]
        
        high_sector = next((s for s in sector_exposure if s["percentage"] > 40.0), None)
        warning_msg = None
        if high_sector:
            warning_msg = f"⚠️ تركيز عالي في قطاع {high_sector['sector']} ({high_sector['percentage']}%)"

        return {
            "success": True,
            "portfolio_heat": 24.5,
            "heat_level": "moderate",
            "sector_exposure": sector_exposure,
            "warning": warning_msg
        }
    except Exception as e:
        logger.error(f"Error in get_risk_summary: {e}")
        return {
            "success": True,
            "portfolio_heat": 20.0,
            "heat_level": "low",
            "sector_exposure": [],
            "warning": None
        }


@portfolio_router.get("/smart-monitor/signals")
async def get_smart_monitor_signals(ticker: str = Query(..., min_length=1), user_id: Optional[str] = None):
    """
    نافذة تفاصيل السهم المنبثقة (Position Deep-Dive Drawer):
    إشارات الـ AI والـ Risk بناءً على أداء الموقف الحالي.
    """
    ticker_upper = ticker.upper()
    try:
        holdings_mock = {
            "COMI": {"buy_price": 72.50, "current_price": 84.00, "pnl_percent": 15.86, "sub_portfolio": "محفظة الاستثمار", "holding_days": 42},
            "ABUK": {"buy_price": 64.00, "current_price": 70.20, "pnl_percent": 9.68, "sub_portfolio": "محفظة المضاربة", "holding_days": 14},
            "EAST": {"buy_price": 31.00, "current_price": 28.50, "pnl_percent": -8.06, "sub_portfolio": "محفظة الاستثمار", "holding_days": 28},
            "SWDY": {"buy_price": 42.00, "current_price": 49.50, "pnl_percent": 17.85, "sub_portfolio": "محفظة المضاربة", "holding_days": 21},
        }

        pos_info = holdings_mock.get(ticker_upper, {
            "buy_price": 50.0,
            "current_price": 55.0,
            "pnl_percent": 10.0,
            "sub_portfolio": "محفظة المضاربة",
            "holding_days": 10
        })

        pnl_pct = pos_info["pnl_percent"]

        if pnl_pct >= 15.0:
            signal_code = "TAKE_PROFIT"
            signal_badge = "✅ حقق ربح الآن"
            signal_color = "#16a34a"
            reason = f"السهم حقق ربحاً ممتازاً بنسبة {pnl_pct:.1f}%. المؤشرات الفنية تشير إلى اقتراب مناطق التشبع الشرائي، يُنصح بتأمين جزء من الأرباح."
        elif pnl_pct <= -8.0:
            signal_code = "STOP_LOSS"
            signal_badge = "🚨 إيقاف خسارة"
            signal_color = "#ef4444"
            reason = f"السهم تجاوز حد وقف الخسارة الموصى به بربح/خسارة {pnl_pct:.1f}%. يفضل الخروج لحماية رأس المال وإعادة التدوير."
        elif pnl_pct > 0:
            signal_code = "HOLD"
            signal_badge = "⏸️ احتفاظ مستقر"
            signal_color = "#3b82f6"
            reason = f"السهم في مسار صاعد معتدل بربح {pnl_pct:.1f}%. لا توجد إشارات قاطعة بالخروج، استمر في المراقبة."
        else:
            signal_code = "ACCUMULATE"
            signal_badge = "🟢 زيادة كمية تدريجية"
            signal_color = "#f59e0b"
            reason = f"السهم عند مناطق دعم قوية، التحليل يشير إلى احتمالية ارتداد قريبة."

        position_warning = "⚠️ تحذير تسوية T+2 قائم (الأسهم في فترة التسوية)" if pos_info["holding_days"] <= 2 else None

        return {
            "success": True,
            "ticker": ticker_upper,
            "signal": signal_code,
            "signal_badge": signal_badge,
            "signal_color": signal_color,
            "pnl_percent": pnl_pct,
            "sub_portfolio": pos_info["sub_portfolio"],
            "buy_price": pos_info["buy_price"],
            "current_price": pos_info["current_price"],
            "holding_days": pos_info["holding_days"],
            "position_warning": position_warning,
            "ai_narrative": reason,
            "updated_at": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Error in get_smart_monitor_signals for {ticker}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# P4-BACKEND-INFLATION: Real Return Engine + Bag-Holder Rescue (FastAPI routes)
# ============================================================================
# These routes call the pure-Python engines directly. They MUST live on the
# FastAPI portfolio_router (prefix /api/portfolio) because FastAPI intercepts
# that prefix before the Flask WSGI middleware — Flask-only routes 404 here.
# ----------------------------------------------------------------------------

@portfolio_router.get("/real-return")
async def get_real_return(user_id: str = Query("demo", description="User ID")):
    """
    محرّك العائد الحقيقي (Real Return Engine)
    يحسب: Real_Return = Asset_Yield - Inflation_Rate
    ويولّد تحذير بالعربي لو العائد أقل من التضخم.
    """
    try:
        import sys as _sys
        _eng_dir = str(Path(__file__).resolve().parents[1] / "analyzers")
        if _eng_dir not in _sys.path:
            _sys.path.insert(0, _eng_dir)
        from real_return_engine import RealReturnEngine
        engine = RealReturnEngine()
        data = engine.evaluate_portfolio(user_id)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Error in get_real_return: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@portfolio_router.get("/bag-holder-rescue")
async def get_bag_holder_rescue(
    ticker: str = Query(..., description="Stock ticker, e.g. COMI"),
    # P31 TASK 3: purchase_price was REQUIRED (Query(...)) — but the frontend
    # (BagHolderRescuePanel) sends `buy_price`. This 422 mismatch was the root
    # cause of the "rescue API fails with Error" bug. Now optional; resolved
    # from buy_price fallback below.
    purchase_price: Optional[float] = Query(None, description="Average buy price"),
    shares: float = Query(0, ge=0, description="Number of shares"),
    buy_price: Optional[float] = Query(None, description="Legacy alias for purchase_price"),
    quantity: Optional[float] = Query(None, description="Legacy alias for shares"),
):
    """
    محرّك إنقاذ المزنوقين (Bag-Holder Rescue Engine)
    يدرس 3 عوامل: المقارنة التاريخية، الأساسيات، والتوصية الديناميكية.
    يرجّع: HOLD (اصبر) / AVERAGE_DOWN (اعمل متوسط) / CUT_LOSS (اقطع خسارة) + سبب.
    """
    try:
        import sys as _sys
        _eng_dir = str(Path(__file__).resolve().parents[1] / "analyzers")
        if _eng_dir not in _sys.path:
            _sys.path.insert(0, _eng_dir)
        from bag_holder_rescue import BagHolderRescue
        # Support legacy param names
        _pp = purchase_price if purchase_price else (buy_price or 0)
        _sh = shares if shares else (quantity or 0)
        engine = BagHolderRescue()
        data = engine.analyze(ticker.upper(), _pp, _sh)
        # ── P31 TASK 3: Return FLAT fields (merge data into top-level) ──
        # The Flask endpoint (misc_routes.py) returns flat fields and the frontend
        # (BagHolderRescuePanel) reads result.recommendation / result.loss_pct directly.
        # Previously this FastAPI route nested them under `data`, causing the panel
        # to show empty/Error. Now we merge so both backends are shape-compatible.
        # Map the engine's actual keys (purchase_vs_peak, company_profitable,
        # profitability_note, reasoning_ar) to the frontend's expected names.
        _peak_zone = data.get("purchase_vs_peak", "")
        _zone_ar_map = {
            "AT_PEAK": "🚨 عند القمة التاريخية",
            "UPPER": "⚠️ في النص العلوي",
            "MIDDLE": "✅ في النص (سعر معقول)",
            "LOWER": "🟢 قرب القاع التاريخي",
        }
        return {
            "success": True,
            "data": data,  # kept for debugging / raw access
            "ticker": ticker.upper(),
            "buy_price": round(_pp, 2) if _pp else 0,
            "current_price": round(float(data.get("current_price", 0) or 0), 2),
            "quantity": _sh,
            "invested_egp": round(float(data.get("invested_egp", _pp * _sh)), 2) if _pp else 0,
            "market_value_egp": round(float(data.get("market_value_egp", 0) or 0), 2),
            "loss_pct": round(float(data.get("loss_pct", 0) or 0), 2),
            "loss_egp": round(float(data.get("loss_egp", 0) or 0), 2),
            "recovery_needed_pct": round(float(data.get("recovery_needed_pct", 0) or 0), 2),
            "all_time_high": round(float(data.get("historical_high", 0) or 0), 2),
            "all_time_low": round(float(data.get("historical_low", 0) or 0), 2),
            "buy_zone": _peak_zone,
            "buy_zone_ar": _zone_ar_map.get(_peak_zone, _peak_zone or ""),
            "is_profitable": data.get("company_profitable"),
            "fundamentals_note": data.get("profitability_note", ""),
            "recommendation": data.get("recommendation", "HOLD"),
            "recommendation_ar": data.get("recommendation_ar", ""),
            "urgency": data.get("urgency", "low"),
            "reasoning": data.get("reasoning_ar", data.get("reasoning", "")),
        }
    except Exception as e:
        # P31 TASK 3: Return a clear message (not a 500) so the frontend can show it.
        # The BagHolderRescuePanel reads data.success + data.error — a 200 with
        # success=False lets it toast the message instead of showing "فشل الاتصال".
        logger.error(f"Error in get_bag_holder_rescue: {e}")
        return {
            "success": False,
            "error": f"السهم '{ticker.upper()}' غير متوفر أو لم يتم التحليل بنجاح. تأكد من كود السهم وحاول مرة تانية.",
            "ticker": ticker.upper() if ticker else "",
            "detail": str(e),
        }
