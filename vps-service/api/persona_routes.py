#!/usr/bin/env python3
"""
Persona Screening Routes — مسارات فحص الشخصيات
=================================================
Flask Blueprint for persona-based stock screening endpoints.

يقارن بين شخصيتين:
  - المستثمر (Investor): بحث أساسي — P/E, P/B, توزيعات، ربحية
  - الصياد/المغامر (Gambler): بحث فني — حركة سعر, سيولة, اختراق, RSI

Endpoints:
  - GET /api/persona/investor          — أسهم مناسبة للمستثمر
  - GET /api/persona/gambler           — أسهم مناسبة للصياد
  - GET /api/persona/compare           — مقارنة بين الشخصيتين (overlap analysis)
  - GET /api/persona/stock/<ticker>    — تحليل سهم واحد بالشخصيتين

Author: دليل الاستثمار / Investment Guide Team
Version: 1.0.0
"""

import os
import sys
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

from flask import Blueprint, jsonify, request

# ============================================================================
# PATH SETUP — إعداد المسار
# ============================================================================

_vps_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _vps_root not in sys.path:
    sys.path.insert(0, _vps_root)

logger = logging.getLogger(__name__)


# ============================================================================
# BLUEPRINT DEFINITION — تعريف الـ Blueprint
# ============================================================================

persona_bp = Blueprint('persona', __name__, url_prefix='/api/persona')


# ============================================================================
# SAFE IMPORTS — استيراد آمن (لا يكسر الـ API لو الموديول مش موجود)
# ============================================================================

try:
    from analyzers.persona_screener import screen_investor_stocks, screen_gambler_stocks
    PERSONA_SCREENER_AVAILABLE = True
    _SCREENER_ERROR = None
except ImportError as e:
    print(f"Warning: Persona Screener not available: {e}")
    logger.warning(f"Persona Screener not available: {e}")
    PERSONA_SCREENER_AVAILABLE = False
    _SCREENER_ERROR = str(e)
    screen_investor_stocks = None
    screen_gambler_stocks = None


# ============================================================================
# HELPER: Unavailable response — رد غير متاح
# ============================================================================

def _unavailable_response(persona: str, endpoint: str) -> tuple:
    """
    رد موحّد لما الـ Persona Screener مش متاح.
    Unified response when the Persona Screener module is unavailable.

    Args:
        persona: اسم الشخصية ('investor' أو 'gambler')
        endpoint: اسم الـ endpoint

    Returns:
        tuple: (json_response, status_code)
    """
    return jsonify({
        "success": False,
        "persona": persona,
        "count": 0,
        "stocks": [],
        "timestamp": datetime.now().isoformat(),
        "source": "unavailable",
        "warning": f"Persona Screener module is not available: {_SCREENER_ERROR}",
        "endpoint": endpoint,
    }), 502


# ============================================================================
# ROUTE 1: GET /api/persona/investor
# أسهم مناسبة للمستثمر — Investor persona stock screening
# ============================================================================

@persona_bp.route('/investor', methods=['GET'])
def get_investor_stocks():
    """
    GET /api/persona/investor

    بيرجّع أسهم مناسبة لشخصية المستثمر (طويل المدى).
    Returns stocks suitable for the investor persona (long-term).

    Query Params:
        limit  (int): عدد النتائج (default: 10)
        sector (str): فلتر القطاع (optional)

    Returns:
        JSON with investor-screened stocks.
    """
    try:
        limit = request.args.get('limit', 10, type=int)
        sector = request.args.get('sector', None, type=str)
        market = request.args.get('market', None, type=str)

        # حد أقصى للحماية — Cap limit for safety
        limit = min(max(limit, 1), 100)

        # لو الـ screener مش متاح — If screener is unavailable
        if not PERSONA_SCREENER_AVAILABLE:
            return _unavailable_response("investor", "/api/persona/investor")

        # تشغيل الفحص — Run the screening
        stocks = screen_investor_stocks(limit, market=market)

        # فلتر القطاع — Sector filter (optional)
        if sector and stocks:
            sector_lower = sector.lower().strip()
            stocks = [
                s for s in stocks
                if isinstance(s, dict) and (
                    str(s.get('sector', '')).lower() == sector_lower or
                    str(s.get('sector_ar', '')).lower() == sector_lower
                )
            ]

        return jsonify({
            "success": True,
            "persona": "investor",
            "count": len(stocks),
            "stocks": stocks,
            "timestamp": datetime.now().isoformat(),
            "source": "persona_screener",
        })

    except Exception as e:
        logger.error(f"Error in /api/persona/investor: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "persona": "investor",
            "count": 0,
            "stocks": [],
            "timestamp": datetime.now().isoformat(),
            "source": "error",
            "error": str(e),
        }), 500


# ============================================================================
# ROUTE 2: GET /api/persona/gambler
# أسهم مناسبة للصياد/المغامر — Gambler persona stock screening
# ============================================================================

@persona_bp.route('/gambler', methods=['GET'])
def get_gambler_stocks():
    """
    GET /api/persona/gambler

    بيرجّع أسهم مناسبة لشخصية الصياد/المغامر (قصر المدى).
    Returns stocks suitable for the gambler persona (short-term).

    Query Params:
        limit  (int): عدد النتائج (default: 15)
        sector (str): فلتر القطاع (optional)

    Returns:
        JSON with gambler-screened stocks.
    """
    try:
        limit = request.args.get('limit', 15, type=int)
        sector = request.args.get('sector', None, type=str)
        market = request.args.get('market', None, type=str)

        # حد أقصى للحماية — Cap limit for safety
        limit = min(max(limit, 1), 100)

        # لو الـ screener مش متاح — If screener is unavailable
        if not PERSONA_SCREENER_AVAILABLE:
            return _unavailable_response("gambler", "/api/persona/gambler")

        # تشغيل الفحص — Run the screening
        stocks = screen_gambler_stocks(limit, market=market)

        # فلتر القطاع — Sector filter (optional)
        if sector and stocks:
            sector_lower = sector.lower().strip()
            stocks = [
                s for s in stocks
                if isinstance(s, dict) and (
                    str(s.get('sector', '')).lower() == sector_lower or
                    str(s.get('sector_ar', '')).lower() == sector_lower
                )
            ]

        return jsonify({
            "success": True,
            "persona": "gambler",
            "count": len(stocks),
            "stocks": stocks,
            "timestamp": datetime.now().isoformat(),
            "source": "persona_screener",
        })

    except Exception as e:
        logger.error(f"Error in /api/persona/gambler: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "persona": "gambler",
            "count": 0,
            "stocks": [],
            "timestamp": datetime.now().isoformat(),
            "source": "error",
            "error": str(e),
        }), 500


# ============================================================================
# ROUTE 3: GET /api/persona/compare
# مقارنة بين الشخصيتين — Compare investor vs gambler lists
# ============================================================================

@persona_bp.route('/compare', methods=['GET'])
def compare_personas():
    """
    GET /api/persona/compare

    بيرجّع قايمتين المستثمر والصياد ويبيّن الأسهم المشتركة.
    Returns both investor and gambler lists, showing overlap.

    Shows which stocks appear in BOTH lists vs only one.

    Returns:
        JSON with investor_only, gambler_only, both, and counts.
    """
    try:
        market = request.args.get('market', None, type=str)

        # لو الـ screener مش متاح — If screener is unavailable
        if not PERSONA_SCREENER_AVAILABLE:
            return jsonify({
                "success": False,
                "investor_only": [],
                "gambler_only": [],
                "both": [],
                "investor_count": 0,
                "gambler_count": 0,
                "overlap_count": 0,
                "timestamp": datetime.now().isoformat(),
                "source": "unavailable",
                "warning": f"Persona Screener module is not available: {_SCREENER_ERROR}",
            }), 502

        # جلب القايمتين — Fetch both lists
        # استخدام limit معقول للمقارنة — Use reasonable limit for comparison
        investor_stocks = screen_investor_stocks(50, market=market)
        gambler_stocks = screen_gambler_stocks(50, market=market)

        # استخراج tickers — Extract tickers
        # بنستخدم ticker كمفتاح للمقارنة — Use ticker as comparison key
        investor_tickers = set()
        investor_map: Dict[str, dict] = {}
        for s in investor_stocks:
            if isinstance(s, dict):
                ticker = str(s.get('ticker', s.get('symbol', ''))).upper()
                if ticker:
                    investor_tickers.add(ticker)
                    investor_map[ticker] = s

        gambler_tickers = set()
        gambler_map: Dict[str, dict] = {}
        for s in gambler_stocks:
            if isinstance(s, dict):
                ticker = str(s.get('ticker', s.get('symbol', ''))).upper()
                if ticker:
                    gambler_tickers.add(ticker)
                    gambler_map[ticker] = s

        # حساب التداخل — Compute overlap
        both_tickers = investor_tickers & gambler_tickers
        investor_only_tickers = investor_tickers - gambler_tickers
        gambler_only_tickers = gambler_tickers - investor_tickers

        # بناء القوائم — Build lists
        both_list = [investor_map.get(t, gambler_map.get(t, {})) for t in sorted(both_tickers)]
        investor_only_list = [investor_map.get(t, {}) for t in sorted(investor_only_tickers)]
        gambler_only_list = [gambler_map.get(t, {}) for t in sorted(gambler_only_tickers)]

        return jsonify({
            "success": True,
            "investor_only": investor_only_list,
            "gambler_only": gambler_only_list,
            "both": both_list,
            "investor_count": len(investor_tickers),
            "gambler_count": len(gambler_tickers),
            "overlap_count": len(both_tickers),
            "timestamp": datetime.now().isoformat(),
            "source": "persona_screener",
        })

    except Exception as e:
        logger.error(f"Error in /api/persona/compare: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "investor_only": [],
            "gambler_only": [],
            "both": [],
            "investor_count": 0,
            "gambler_count": 0,
            "overlap_count": 0,
            "timestamp": datetime.now().isoformat(),
            "source": "error",
            "error": str(e),
        }), 500


# ============================================================================
# ROUTE 4: GET /api/persona/stock/<ticker>
# تحليل سهم واحد بالشخصيتين — Single stock dual-persona analysis
# ============================================================================

@persona_bp.route('/stock/<ticker>', methods=['GET'])
def analyze_stock_persona(ticker: str):
    """
    GET /api/persona/stock/<ticker>

    بيرجّع تحليل الشخصيتين (المستثمر + الصياد) لسهم واحد.
    Returns BOTH persona analyses for a single stock.

    Path Params:
        ticker (str): رمز السهم (مثلاً COMI)

    Returns:
        JSON with investor analysis, gambler analysis, and recommendation.
    """
    try:
        ticker = ticker.upper().strip()

        if not ticker:
            return jsonify({
                "success": False,
                "error": "Ticker is required",
                "timestamp": datetime.now().isoformat(),
            }), 400

        # لو الـ screener مش متاح — If screener is unavailable
        if not PERSONA_SCREENER_AVAILABLE:
            return jsonify({
                "success": False,
                "ticker": ticker,
                "investor": None,
                "gambler": None,
                "recommendation": "unavailable",
                "reason": "Persona Screener module is not available",
                "timestamp": datetime.now().isoformat(),
                "source": "unavailable",
                "warning": f"Persona Screener module is not available: {_SCREENER_ERROR}",
            }), 502

        # جلب قايمة كل شخصية وبندور على السهم — Fetch both lists and find the stock
        investor_stocks = screen_investor_stocks(100)
        gambler_stocks = screen_gambler_stocks(100)

        # البحث عن السهم في قايمة المستثمر — Search in investor list
        investor_result = None
        for s in investor_stocks:
            if isinstance(s, dict):
                s_ticker = str(s.get('ticker', s.get('symbol', ''))).upper()
                if s_ticker == ticker:
                    investor_result = s
                    break

        # البحث عن السهم في قايمة الصياد — Search in gambler list
        gambler_result = None
        for s in gambler_stocks:
            if isinstance(s, dict):
                s_ticker = str(s.get('ticker', s.get('symbol', ''))).upper()
                if s_ticker == ticker:
                    gambler_result = s
                    break

        # حساب التوصية — Compute recommendation
        recommendation, reason = _compute_persona_recommendation(
            ticker, investor_result, gambler_result
        )

        return jsonify({
            "success": True,
            "ticker": ticker,
            "investor": investor_result or {
                "score": 0,
                "verdict": "غير متاح",
                "reason": "السهم مش في قايمة المستثمر",
            },
            "gambler": gambler_result or {
                "score": 0,
                "verdict": "غير متاح",
                "reason": "السهم مش في قايمة الصياد",
            },
            "recommendation": recommendation,
            "reason": reason,
            "timestamp": datetime.now().isoformat(),
            "source": "persona_screener",
        })

    except Exception as e:
        logger.error(f"Error in /api/persona/stock/{ticker}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "ticker": ticker,
            "investor": None,
            "gambler": None,
            "recommendation": "error",
            "reason": str(e),
            "timestamp": datetime.now().isoformat(),
            "source": "error",
            "error": str(e),
        }), 500


# ============================================================================
# HELPER: Compute persona recommendation — حساب التوصية بناءً على الشخصيتين
# ============================================================================

def _compute_persona_recommendation(
    ticker: str,
    investor_result: Optional[dict],
    gambler_result: Optional[dict],
) -> tuple:
    """
    حساب التوصية بناءً على تحليل الشخصيتين.
    Compute the final recommendation based on both persona analyses.

    Logic / المنطق:
        - لو السهم في القايمتين → "both" (قوي لكليهما)
        - لو المستثمر بس → "investor" (مناسب للمستثمر أكتر)
        - لو الصياد بس → "gambler" (مناسب للصياد أكتر)
        - لو مش في أي قايمة → "none" (مش مناسب حالياً)

    Args:
        ticker: رمز السهم
        investor_result: نتيجة تحليل المستثمر (dict أو None)
        gambler_result: نتيجة تحليل الصياد (dict أو None)

    Returns:
        tuple: (recommendation, reason)
    """
    inv_score = 0
    gamb_score = 0

    if investor_result and isinstance(investor_result, dict):
        inv_score = float(investor_result.get('score', 0))

    if gambler_result and isinstance(gambler_result, dict):
        gamb_score = float(gambler_result.get('score', 0))

    # السهم في القايمتين — Stock in both lists
    if investor_result and gambler_result:
        if inv_score >= gamb_score:
            return (
                "investor",
                "السهم مناسب للمستثمر أكثر من الصياد"  # Stock suits investor more than gambler
            )
        else:
            return (
                "gambler",
                "السهم مناسب للصياد أكثر من المستثمر"  # Stock suits gambler more than investor
            )

    # المستثمر بس — Investor only
    if investor_result:
        return (
            "investor",
            "السهم مناسب للمستثمر أكثر من الصياد"  # Stock suits investor more than gambler
        )

    # الصياد بس — Gambler only
    if gambler_result:
        return (
            "gambler",
            "السهم مناسب للصياد أكثر من المستثمر"  # Stock suits gambler more than investor
        )

    # مش في أي قايمة — Not in any list
    return (
        "none",
        "السهم غير مناسب حالياً لأي من الشخصيتين"  # Stock not suitable for either persona right now
    )
