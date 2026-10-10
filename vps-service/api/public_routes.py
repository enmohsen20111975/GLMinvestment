"""
Public Routes Blueprint
=======================
Endpoints للجمهور (محمية)

Endpoints:
- GET /api/stocks - قائمة الأسهم
- GET /api/stocks/<ticker> - تفاصيل سهم
- GET /api/history/<ticker> - تاريخ الأسعار
- GET /api/analysis/<ticker> - تحليل فني
- GET /api/indicators/<ticker> - مؤشرات فنية
- GET /api/predict/<ticker> - توقعات
- GET /api/patterns/<ticker> - أنماط
- GET /api/fibonacci/<ticker> - فيبوناتشي
- GET /api/timing - توقيت السوق
- GET /api/market/overview - نظرة عامة
- GET /api/sync - مزامنة
- GET /api/data/export - تصدير
"""

from datetime import datetime
from flask import Blueprint, jsonify, request

from core.database import DatabaseManager
from analyzers.technical import TechnicalAnalyzer
from analyzers.fundamental import FundamentalAnalyzer
from analyzers.timing import TimingAnalyzer
from analyzers.patterns import PatternRecognitionEngine
from analyzers.fibonacci import FibonacciAnalyzer
from analyzers.risk import RiskManager

public_bp = Blueprint('public', __name__)

# Helper function to safely calculate change amount
def _safe_change_amount(change_pct, last_price):
    """Safely calculate change amount, handling None values."""
    try:
        pct = change_pct or 0
        price = last_price or 0
        if price > 0:
            return (pct * price) / 100
        return 0
    except (TypeError, ZeroDivisionError):
        return 0

# Initialize analyzers
db = DatabaseManager()
tech_analyzer = TechnicalAnalyzer()
fund_analyzer = FundamentalAnalyzer()
timing_analyzer = TimingAnalyzer()
pattern_engine = PatternRecognitionEngine()
fib_analyzer = FibonacciAnalyzer()
risk_manager = RiskManager()

# ============================================================================
# STOCK ENDPOINTS
# ============================================================================

@public_bp.route('/api/stocks', methods=['GET'])
def get_stocks():
    """Get all stocks from stocks.db — مع fair_value/upside/turnover_egp."""
    try:
        from utils.helpers import parse_volume as _parse_vol
        limit = request.args.get('limit', type=int)
        search = request.args.get('search', '')
        market = request.args.get('market', '')  # Market filter (EGX, KSA, KSE, DFM, BSE, QSE, CRYPTO)

        # Get stocks from main database (stocks.db)
        if search:
            stocks = db.search_stocks(search, limit or 50)
        else:
            stocks = db.get_all_stocks()

        # Filter by market if specified
        if market:
            market = market.upper()
            stocks = [s for s in stocks if s.get('market', 'EGX').upper() == market]

        if limit:
            stocks = stocks[:limit]

        def _to_float(v):
            if v is None:
                return None
            if isinstance(v, (int, float)):
                return float(v)
            s = str(v).strip().replace('\u202f', '').replace(' ', '')
            if not s:
                return None
            try:
                return float(s)
            except (ValueError, TypeError):
                return None

        def _calc_fv(pe, eps, bvps, current_price=None, pb_ratio=None, ma_200=None):
            """Estimate fair value with pb_ratio / ma_200 fallbacks for EGX data gaps."""
            pe_v = _to_float(pe)
            eps_v = _to_float(eps)
            bv_v = _to_float(bvps)
            cp = _to_float(current_price)
            pb = _to_float(pb_ratio)
            ma2 = _to_float(ma_200)
            pe_est = (pe_v * eps_v) if (pe_v and pe_v > 0 and eps_v and eps_v > 0) else None
            bv_est = (bv_v * 1.5) if (bv_v and bv_v > 0) else None
            pb_est = None
            if bv_est is None and pb and pb > 0 and cp and cp > 0:
                pb_est = (cp / pb) * 1.5
            ma_est = ma2 if (ma2 and ma2 > 0) else None
            cands = [v for v in (pe_est, bv_est, pb_est, ma_est) if v is not None and v > 0]
            return round(max(cands), 4) if cands else None

        # Calculate price_change + new fields for each stock
        for s in stocks:
            if s.get('previous_close') and s.get('current_price') and s['previous_close'] > 0:
                s['price_change'] = ((s['current_price'] - s['previous_close']) / s['previous_close']) * 100
            else:
                s['price_change'] = 0

            cur_price = _to_float(s.get('current_price')) or 0.0
            volume_today = _parse_vol(s.get('volume'))
            s['volume_int'] = volume_today
            s['turnover_egp'] = round(cur_price * volume_today, 2) if (cur_price and volume_today) else 0.0

            fair_value = _calc_fv(
                s.get('pe_ratio'), s.get('eps'), s.get('book_value_per_share'),
                current_price=cur_price,
                pb_ratio=s.get('pb_ratio'),
                ma_200=s.get('ma_200'),
            )
            s['fair_value'] = fair_value
            s['upside_percent'] = (
                round(((fair_value - cur_price) / cur_price) * 100, 2)
                if (fair_value and cur_price and cur_price > 0) else None
            )

        return jsonify({
            "success": True,
            "count": len(stocks),
            "total": len(stocks),
            "stocks": stocks,
            "data": stocks,
            "source": "stocks_db",
            "market_filter": market if market else None,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/stocks/<ticker>', methods=['GET'])
def get_stock(ticker):
    """Get single stock."""
    try:
        stock = db.get_stock(ticker.upper())
        if not stock:
            return jsonify({"success": False, "error": "Stock not found"}), 404
        return jsonify({"success": True, "data": stock})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/history/<ticker>', methods=['GET'])
def get_history(ticker):
    """
    Get historical price data.

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    Replaces the previous load_merged_history + db.get_price_history fallback
    chain with a single cached call. load_price_history internally applies the
    same source priority (yahoo_clean -> egksco -> migration -> stock_daily_prices)
    and a 5-minute per-(ticker, limit) cache.
    """
    try:
        days = request.args.get('days', 365, type=int)
        ticker_up = ticker.upper().strip()

        from data.prices import load_price_history
        history = load_price_history(ticker_up, limit=days)
        source_label = 'data.prices.load_price_history'

        if not history:
            return jsonify({"success": False, "error": "No historical data found"}), 404

        return jsonify({
            "success": True,
            "data": {
                "ticker": ticker_up,
                "points": len(history),
                "history": history,
                "source": source_label
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/prices/<ticker>', methods=['GET'])
def get_prices(ticker):
    """Canonical price-history endpoint for the Next.js chart API (Rule 12).

    P0-3 (2026-10-03): the Node chart route `src/app/api/chart/[ticker]/route.ts`
    calls `GET /api/prices/<ticker>?limit=N` to fetch daily candles. This route
    is the Python-side counterpart — it delegates to `data.prices.load_price_history`
    which is the SOLE canonical source per Rule 12 (load_merged_history/load_price_history
    is the single source of truth) and Rule 20 (Python=Brain — Node is just a proxy).

    The Node route falls back to direct SQLite only when this endpoint is
    unreachable (sandbox cold-start / network blip), marked DEFENSIVE-FALLBACK.

    Args (query string):
        limit: max number of candles to return (most recent). Default 365, max 2000.

    Returns:
        200 — {"success": true, "data": {"ticker", "points", "history", "source"}}
        404 — no data found for the ticker (per Rule 24: empty + honest, never placeholder)
        500 — unexpected error
    """
    try:
        limit = request.args.get('limit', 365, type=int)
        ticker_up = ticker.upper().strip().split('.')[0]  # strip .CA / .SR suffixes

        from data.prices import load_price_history
        history = load_price_history(ticker_up, limit=limit)

        if not history:
            # Per Rule 24 (no placeholder data): empty + honest 404.
            return jsonify({
                "success": False,
                "error": "No price history found for ticker",
                "ticker": ticker_up,
            }), 404

        return jsonify({
            "success": True,
            "data": {
                "ticker": ticker_up,
                "points": len(history),
                "history": history,
                "source": "data.prices.load_price_history",
            },
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@public_bp.route('/api/stocks/<ticker>/local-history', methods=['GET'])
def get_local_history(ticker):
    """Get local price history for backtesting - used by Next.js backtesting engine.

    This endpoint is specifically designed for the intelligent learning system.
    Returns price history in the format expected by fetchHistoryFromVPS.
    """
    try:
        days = request.args.get('days', 365, type=int)
        history = db.get_price_history(ticker.upper(), days)

        if not history:
            return jsonify({"success": False, "error": "No historical data found"}), 404

        # Format for Next.js backtesting engine
        # Returns same format as expected by fetchHistoryFromVPS in backtesting-engine.ts
        return jsonify({
            "success": True,
            "ticker": ticker.upper(),
            "points": len(history),
            "history": history,
            "source": "python_backend"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ============================================================================
# TECHNICAL ANALYSIS ENDPOINTS
# ============================================================================

@public_bp.route('/api/analysis/<ticker>', methods=['GET'])
def analyze_stock(ticker):
    """Complete technical analysis for a stock."""
    try:
        ticker = ticker.upper()
        stock = db.get_stock(ticker)
        if not stock:
            return jsonify({"success": False, "error": "Stock not found"}), 404
        
        history = db.get_price_history(ticker, 365)
        
        if len(history) < 50:
            return jsonify({
                "success": True,
                "data": {
                    "ticker": ticker,
                    "current_price": stock.get('current_price'),
                    "signal": "INSUFFICIENT_DATA",
                    "data_points": len(history),
                    "warning": "Need at least 50 data points for analysis"
                }
            })
        
        closes = [h['close'] for h in history]
        volumes = [h.get('volume') for h in history if h.get('volume')]
        
        # Technical Analysis
        tech_indicators = tech_analyzer.analyze(closes, volumes if volumes else None)
        prediction = tech_analyzer.generate_prediction(closes, ticker)
        
        # Fundamental Analysis
        fund_metrics = fund_analyzer.analyze(stock)
        fund_score, fund_buy, fund_sell = fund_analyzer.get_fundamental_score(fund_metrics)
        
        # Timing Analysis
        timing = timing_analyzer.analyze("STOCK")
        
        # Overall score - NORMALIZED TO 0-100 SCALE
        overall_score = (tech_indicators.signal_score + fund_score + timing.timing_score) * 10 + 50
        overall_score = max(0, min(100, overall_score))
        
        # UNIFIED THRESHOLDS (same as MasterAnalyzer)
        if overall_score >= 65:
            overall_signal = "STRONG_BUY"
        elif overall_score >= 55:
            overall_signal = "BUY"
        elif overall_score >= 48:
            overall_signal = "ACCUMULATE"
        elif overall_score >= 35:
            overall_signal = "HOLD"
        elif overall_score >= 28:
            overall_signal = "REDUCE"
        else:
            overall_signal = "SELL"
        
        confidence = min(50 + abs(overall_score) * 5, 95)
        
        return jsonify({
            "success": True,
            "data": {
                "ticker": ticker,
                "name": stock.get('name'),
                "current_price": stock.get('current_price'),
                "previous_close": stock.get('previous_close'),
                "signal": overall_signal,
                "confidence": confidence,
                "overall_score": overall_score,
                "technical": {
                    "signal": tech_indicators.overall_signal,
                    "score": tech_indicators.signal_score,
                    "trend": tech_indicators.trend_direction,
                    "rsi": tech_indicators.rsi,
                    "rsi_signal": tech_indicators.rsi_signal,
                    "macd_trend": tech_indicators.macd_trend,
                    "sma_20": tech_indicators.sma_20,
                    "sma_50": tech_indicators.sma_50,
                    "support": tech_indicators.support_level,
                    "resistance": tech_indicators.resistance_level
                },
                "prediction": prediction,
                "fundamental": {
                    "score": fund_score,
                    "pe_ratio": fund_metrics.pe_ratio,
                    "roe": fund_metrics.roe,
                    "eps": fund_metrics.eps,
                    "dividend_yield": fund_metrics.dividend_yield,
                    "buy_reasons": fund_buy,
                    "sell_reasons": fund_sell
                },
                "timing": {
                    "session": timing.current_session,
                    "score": timing.timing_score,
                    "recommendation": timing.timing_recommendation
                },
                "timestamp": datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/indicators/<ticker>', methods=['GET'])
def get_indicators(ticker):
    """Get technical indicators for a stock."""
    try:
        history = db.get_price_history(ticker.upper(), 365)
        
        if len(history) < 20:
            return jsonify({
                "success": False,
                "error": f"Insufficient data. Found {len(history)} points, need at least 20."
            }), 400
        
        closes = [h['close'] for h in history]
        volumes = [h.get('volume') for h in history if h.get('volume')]
        
        indicators = tech_analyzer.analyze(closes, volumes if volumes else None)
        
        return jsonify({
            "success": True,
            "data": {
                "ticker": ticker.upper(),
                "current_price": closes[-1] if closes else None,
                "indicators": indicators.to_dict(),
                "source": "python_backend"
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/predict/<ticker>', methods=['GET'])
def predict_ticker(ticker):
    """Generate trading prediction for a stock."""
    try:
        history = db.get_price_history(ticker.upper(), 365)
        
        if len(history) < 50:
            return jsonify({
                "success": False,
                "error": f"Insufficient data. Found {len(history)} points, need at least 50."
            }), 400
        
        closes = [h['close'] for h in history]
        prediction = tech_analyzer.generate_prediction(closes, ticker.upper())
        
        return jsonify({
            "success": True,
            "data": prediction
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ============================================================================
# ADVANCED ANALYSIS ENDPOINTS
# ============================================================================

@public_bp.route('/api/patterns/<ticker>', methods=['GET'])
def detect_patterns(ticker):
    """Detect price patterns for a stock."""
    try:
        history = db.get_price_history(ticker.upper(), 100)
        
        if len(history) < 50:
            return jsonify({
                "success": True,
                "patterns": [],
                "message": "Insufficient data for pattern detection"
            })
        
        highs = [h['high'] for h in history if h.get('high')]
        lows = [h['low'] for h in history if h.get('low')]
        closes = [h['close'] for h in history if h.get('close')]
        volumes = [h['volume'] for h in history if h.get('volume')]
        
        patterns = pattern_engine.analyze(highs, lows, closes, volumes if volumes else None)
        
        return jsonify({
            "success": True,
            "ticker": ticker.upper(),
            "patterns_count": len(patterns),
            "patterns": [p.to_dict() for p in patterns],
            "pattern_score": pattern_engine.get_pattern_score()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/fibonacci/<ticker>', methods=['GET'])
def fibonacci_levels(ticker):
    """Calculate Fibonacci levels for a stock."""
    try:
        history = db.get_price_history(ticker.upper(), 60)
        
        if len(history) < 20:
            return jsonify({
                "success": False,
                "error": "Insufficient data for Fibonacci analysis"
            }), 400
        
        highs = [h['high'] for h in history if h.get('high')]
        lows = [h['low'] for h in history if h.get('low')]
        
        swing_high = max(highs) if highs else 0
        swing_low = min(lows) if lows else 0
        current_price = history[-1]['close'] if history else 0
        
        retracements = fib_analyzer.calculate_retracement(swing_high, swing_low, current_price)
        golden_check = fib_analyzer.check_price_at_golden_level(current_price, swing_high, swing_low)
        
        return jsonify({
            "success": True,
            "data": {
                "ticker": ticker.upper(),
                "swing_high": swing_high,
                "swing_low": swing_low,
                "current_price": current_price,
                "retracement_levels": [{
                    "level": r.level_name,
                    "price": r.price,
                    "significance": r.significance,
                    "description": r.description
                } for r in retracements],
                "golden_ratio_check": golden_check
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@public_bp.route('/api/timing', methods=['GET'])
def get_timing():
    """Get market timing analysis."""
    try:
        asset_type = request.args.get('type', 'STOCK')
        timing = timing_analyzer.analyze(asset_type.upper())
        return jsonify({
            "success": True,
            "data": timing.to_dict()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ============================================================================
# MARKET OVERVIEW
# ============================================================================

@public_bp.route('/api/market/overview', methods=['GET'])
def market_overview():
    """Get market overview.
    
    Query params:
        market: Market filter (EGX, KSA, KSE, DFM, BSE, QSE, CRYPTO)
    """
    try:
        market = request.args.get('market', '')  # Get market filter
        overview = db.get_market_overview(market if market else None)
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": overview,
            "market_filter": market if market else None
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ============================================================================
# DATA SYNC
# ============================================================================

@public_bp.route('/api/sync', methods=['GET', 'POST'])
def sync_data():
    """Sync data status or receive data."""
    try:
        if request.method == 'GET':
            stocks = db.get_all_stocks()
            return jsonify({
                "success": True,
                "stocks_count": len(stocks),
                "stocks_with_prices": len([s for s in stocks if s.get('current_price')]),
                "timestamp": datetime.now().isoformat()
            })
        
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400
        
        updated = 0
        if 'stocks' in data:
            for stock in data['stocks']:
                ticker = stock.get('ticker') or stock.get('symbol')
                if ticker:
                    result = db.update_stock_price(ticker.upper(), stock)
                    if result > 0:
                        updated += 1
        
        return jsonify({
            "success": True,
            "updated": updated,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ============================================================================
# DATA EXPORT
# ============================================================================

@public_bp.route('/api/data/export', methods=['GET'])
def export_data():
    """Export all data for backup."""
    try:
        stocks = db.get_all_stocks()
        overview = db.get_market_overview()
        
        return jsonify({
            "success": True,
            "export_timestamp": datetime.now().isoformat(),
            "source": "python_backend_unified",
            "counts": {"stocks": len(stocks)},
            "data": {
                "stocks": stocks,
                "market_overview": overview
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# P19-REAL-TIME-SYNC-PRACTICAL-ANALYSIS: Live Indicator Engine Endpoint
# ============================================================================
# الـ ws-service (port 3005) بينادي هذا الـ endpoint كل 5 ثواني وقت الجلسة
# عشان يجيب الـ Live Score + RSI/MACD اللحظي. قبل P19 كان الـ endpoint ده
# ناقص → الـ ws-service كان بـ 404 وticker:live ما كانش بيوصل للـ Frontend.
# -----------------------------------------------------------------------------

@public_bp.route('/api/live/analysis/<ticker>', methods=['GET'])
def get_live_analysis(ticker):
    """
    P19: تحليل لحظي خفيف (30-80ms) — LiveIndicatorEngine.

    المحرك بيقرا آخر سعر من stocks.db (اللي الـ data_engine/sync.py كاتبه
    من 30 ثانية) ويحسب RSI + MACD اللحظي بناءً عليه عبر Incremental Update
    من بيانات الأمس (cached_analysis). الإشارة بتبقى مبنية على الدم اللي
    بيجري في السوق دلوقتي، مش داتا أمبارح.

    Returns:
        success, ticker, mode='LIVE', score, signal, signal_ar,
        live_rsi, live_macd_hist, volume_ratio, today_candle,
        breakdown (8 layers + SMC), pine_script flags, reason, timestamp
    """
    try:
        ticker = ticker.upper().strip()
        if not ticker:
            return jsonify({"success": False, "error": "ticker is required"}), 400

        from analyzers.live_indicator_engine import get_live_engine

        engine = get_live_engine()
        result = engine.calculate_live_score(ticker)

        if not isinstance(result, dict):
            return jsonify({
                "success": False,
                "error": "live engine returned non-dict",
                "ticker": ticker,
                "mode": "LIVE",
                "timestamp": datetime.now().isoformat(),
            }), 200  # P19-HOTFIX: 200 بدل 500 عشان الـ ws-service ما يعتبرش ده crash

        # الـ engine بيرجّع 'success': False لو مفيش بيانات كافية
        if not result.get('success', True):
            return jsonify({
                "success": False,
                "ticker": ticker,
                "mode": "LIVE",
                "error": result.get('error', 'no data'),
                "timestamp": datetime.now().isoformat(),
            }), 404

        # P19: ضيف db_last_updated عشان الـ caller (ws-service) يقدر يقارن
        # هل الـ data طازجة ولا stale.
        try:
            result['db_last_updated'] = engine.get_db_last_updated(ticker)
        except Exception:
            result['db_last_updated'] = ''

        return jsonify(result)

    except ImportError as ie:
        # P19-HOTFIX: 503 لو الـ engine مش متاح (import فشل) — الـ ws-service
        # بيتعامل مع 503 بـ graceful fallback (مش بيعتبره crash).
        return jsonify({
            "success": False,
            "error": f"LiveIndicatorEngine not available: {ie}",
            "ticker": ticker,
            "mode": "LIVE",
            "timestamp": datetime.now().isoformat(),
        }), 503
    except Exception as e:
        # P19-HOTFIX: لو أي حاجة فشلت → رجّع 200 بـ success=false بدل 500.
        # ده يخلي الـ ws-service يتعامل معاها بأمان بدل ما يـ crash.
        return jsonify({
            "success": False,
            "error": str(e)[:200],
            "ticker": ticker,
            "mode": "LIVE",
            "timestamp": datetime.now().isoformat(),
        }), 200


@public_bp.route('/api/live/scan', methods=['GET'])
def scan_live_opportunities():
    """
    P19: فحص سريع لأعلى الفرص اللحظية (top N stocks).
    بيستخدم LiveIndicatorEngine.scan_live_opportunities().
    """
    try:
        limit = request.args.get('limit', 10, type=int)
        limit = max(1, min(50, limit))  # clamp 1..50

        from analyzers.live_indicator_engine import get_live_engine

        engine = get_live_engine()
        result = engine.scan_live_opportunities(limit=limit)
        return jsonify(result)

    except ImportError as ie:
        return jsonify({
            "success": False,
            "error": f"LiveIndicatorEngine not available: {ie}",
            "timestamp": datetime.now().isoformat(),
        }), 503
    except Exception as e:
        # P19-HOTFIX: 200 بـ success=false بدل 500 عشان الـ caller ما يـ crashش
        return jsonify({
            "success": False,
            "error": str(e)[:200],
            "timestamp": datetime.now().isoformat(),
        }), 200
