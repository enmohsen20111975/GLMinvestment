"""
Professional Analysis Routes Blueprint
======================================
Endpoint للتحليل المهني (المستخدم من Frontend)

Endpoints:
- GET /api/professional-analysis/<ticker> - تحليل مهني كامل
"""

from datetime import datetime
from flask import Blueprint, jsonify, request

from core.database import DatabaseManager
from analyzers.technical import TechnicalAnalyzer
from analyzers.fundamental import FundamentalAnalyzer
from analyzers.engine_settings import get_setting  # P0.5: tech_score_base single source of truth

# ── Board of Analysts integration ──────────────────────────────────────────
try:
    from analyzers.board_of_analysts import get_board_manager as _get_board_manager
    _BOARD_AVAILABLE = True
except Exception:
    _BOARD_AVAILABLE = False
    _get_board_manager = None
# ───────────────────────────────────────────────────────────────────────────

prof_analysis_bp = Blueprint('professional_analysis', __name__)


# Initialize
db = DatabaseManager()
tech_analyzer = TechnicalAnalyzer()
fund_analyzer = FundamentalAnalyzer()


@prof_analysis_bp.route('/api/professional-analysis/<ticker>', methods=['GET'])
def professional_analysis(ticker):
    """
    Professional analysis endpoint for frontend.
    This matches the Next.js API response format.
    """
    try:
        ticker = ticker.upper()
        
        # Special case for EGX market-wide analysis
        if ticker == 'EGX':
            stocks = db.get_all_stocks()
            if not stocks:
                return jsonify({
                    "success": True,
                    "ticker": "EGX",
                    "stock": {"ticker": "EGX", "name": "Egyptian Exchange"},
                    "analysis": None,
                    "data_available": False
                })
            
            # Calculate market sentiment
            changes = [s.get('change', 0) for s in stocks if s.get('change')]
            avg_change = sum(changes) / len(changes) if changes else 0
            
            gainers = len([s for s in stocks if s.get('change', 0) > 0])
            losers = len([s for s in stocks if s.get('change', 0) < 0])
            
            market_rsi = 50 - (avg_change * 2)
            market_breadth = (gainers - losers) / len(stocks) if stocks else 0
            
            if market_breadth > 0.15:
                sentiment = 'STRONG_BULLISH'
            elif market_breadth > 0.05:
                sentiment = 'BULLISH'
            elif market_breadth < -0.15:
                sentiment = 'STRONG_BEARISH'
            elif market_breadth < -0.05:
                sentiment = 'BEARISH'
            else:
                sentiment = 'NEUTRAL'
            
            return jsonify({
                "success": True,
                "ticker": "EGX",
                "stock": {"ticker": "EGX", "name": "Egyptian Exchange", "name_ar": "البورصة المصرية"},
                "analysis": {
                    "market_sentiment": {"trend": sentiment, "strength": 50 + abs(market_breadth) * 100},
                    "technical_indicators": {"market_rsi": round(market_rsi, 2)},
                    "market_breadth": {"gainers": gainers, "losers": losers, "unchanged": len(stocks) - gainers - losers}
                },
                "recommendation": {
                    "action": "BUY" if market_rsi < 40 else "SELL" if market_rsi > 60 else "HOLD",
                    "confidence": min(abs(market_rsi - 50) + 50, 90)
                },
                "data_available": True,
                "data_points": len(stocks),
                "generated_at": datetime.now().isoformat(),
                "source": "python_backend"
            })
        
        # Get stock data
        stock = db.get_stock(ticker)
        if not stock:
            return jsonify({
                "success": True,
                "ticker": ticker,
                "stock": {"ticker": ticker, "name": ticker, "name_ar": ticker},
                "analysis": None,
                "data_available": False,
                "data_points": 0,
                "message": f"لم يتم العثور على بيانات السهم: {ticker}"
            }), 200
        
        # Get price history (250 days for full analysis)
        history = db.get_price_history(ticker, 250)
        
        if len(history) < 5:
            return jsonify({
                "success": True,
                "ticker": ticker,
                "stock": stock,
                "analysis": None,
                "data_available": False,
                "data_points": len(history),
                "message": "لا توجد بيانات سعر كافية للتحليل"
            })
        
        # Extract price data
        closes = [h['close'] for h in history]
        highs = [h.get('high', h['close']) for h in history]
        lows = [h.get('low', h['close']) for h in history]
        volumes = [h.get('volume', 0) for h in history]
        from numbers import Number
        volumes = [float(v) if isinstance(v, Number) or (isinstance(v, str) and v.replace('.', '', 1).replace('-', '', 1).isdigit()) else 0.0 for v in volumes]
        
        current_price = closes[-1] if closes else 0.0
        
        # Safety check: ensure current_price is valid
        if current_price is None or current_price <= 0:
            return jsonify({
                "success": True,
                "ticker": ticker,
                "stock": stock,
                "analysis": None,
                "data_available": False,
                "data_points": len(history),
                "message": "السعر الحالي غير متوفر أو غير صالح"
            })
        
        # 1. Technical Analysis
        # Filter out None values from closes
        closes = [c for c in closes if c is not None and c > 0]
        if len(closes) < 5:
            return jsonify({
                "success": True,
                "ticker": ticker,
                "stock": stock,
                "analysis": None,
                "data_available": False,
                "data_points": len(closes),
                "message": "لا توجد بيانات سعر كافية للتحليل"
            })
        
        tech_indicators = tech_analyzer.analyze(closes, volumes if any(volumes) else None)
        
        # 2. Calculate scores (0-100 each)
        # Technical Score
        tech_score = get_setting('tech_score_base', default=50)
        if tech_indicators.rsi:
            if tech_indicators.rsi <= 30:
                tech_score += 20
            elif tech_indicators.rsi <= 40:
                tech_score += 10
            elif tech_indicators.rsi >= 70:
                tech_score -= 20
            elif tech_indicators.rsi >= 60:
                tech_score -= 10
        
        if tech_indicators.macd_trend == "BULLISH":
            tech_score += 12
        elif tech_indicators.macd_trend == "BEARISH":
            tech_score -= 12
        
        tech_score = max(0, min(100, tech_score))
        
        # Value Score (based on fundamentals)
        fund_metrics = fund_analyzer.analyze(stock)
        value_score, _, _ = fund_analyzer.get_fundamental_score(fund_metrics)
        value_score = 50 + (value_score or 0) * 5  # Convert to 0-100 scale, handle None
        value_score = max(0, min(100, value_score))
        
        # Quality Score
        quality_score = 50
        roe = stock.get('roe') or stock.get('ROE') or 0
        if roe is None:
            roe = 0
        if roe >= 25:
            quality_score += 20
        elif roe >= 18:
            quality_score += 14
        elif roe >= 12:
            quality_score += 8
        elif roe < 0:
            quality_score -= 15
        quality_score = max(0, min(100, quality_score))
        
        # Momentum Score
        momentum_score = 50
        if len(closes) >= 20 and closes[-21] and closes[-21] > 0:
            roc_20 = ((closes[-1] - closes[-21]) / closes[-21]) * 100
            momentum_score += min(max(roc_20 * 2, -25), 25)
        momentum_score = max(0, min(100, momentum_score))
        
        # Risk Score (higher = riskier)
        risk_score = 30
        bb_width = getattr(tech_indicators, 'bb_width', None) or 0
        if bb_width and bb_width > 4:
            risk_score += 15
        max_drawdown = 0
        if len(closes) >= 20:
            peak = closes[0] if closes[0] and closes[0] > 0 else 0.001
            for c in closes:
                if c is None or c <= 0:
                    continue
                if c > peak:
                    peak = c
                drawdown = (peak - c) / peak * 100 if peak > 0 else 0
                max_drawdown = max(max_drawdown, drawdown)
            if max_drawdown >= 40:
                risk_score += 25
            elif max_drawdown >= 25:
                risk_score += 18
            elif max_drawdown >= 15:
                risk_score += 10
        risk_score = max(0, min(100, risk_score))
        
        # Composite Score
        composite_score = (
            tech_score * 0.30 +
            value_score * 0.25 +
            quality_score * 0.25 +
            momentum_score * 0.10 +
            (100 - risk_score) * 0.10
        )
        composite_score = round(composite_score, 2)
        
        # 3. Generate Recommendation (UNIFIED THRESHOLDS)
        # Using same thresholds as MasterAnalyzer for consistency
        if composite_score >= 65:
            action = "strong_buy"
            action_ar = "شراء قوي"
            confidence = 0.85
        elif composite_score >= 55:
            action = "buy"
            action_ar = "شراء"
            confidence = 0.70
        elif composite_score >= 48:
            action = "accumulate"
            action_ar = "تجميع"
            confidence = 0.58
        elif composite_score >= 35:
            action = "hold"
            action_ar = "احتفاظ"
            confidence = 0.50
        elif composite_score >= 28:
            action = "sell"
            action_ar = "بيع"
            confidence = 0.60
        else:
            action = "strong_sell"
            action_ar = "بيع قوي"
            confidence = 0.80
        
        # Entry/Target/Stop Loss - IMPROVED CALCULATION
        entry_price = round(current_price * 0.995, 4) if composite_score >= 48 else round(current_price, 4)
        
        # Get resistance and support with proper NULL handling
        resistance = getattr(tech_indicators, 'resistance_level', None)
        if not resistance or resistance <= 0:
            valid_highs = [h for h in highs[-20:] if h is not None and h > 0] if len(highs) >= 20 else []
            resistance = max(valid_highs) if valid_highs else current_price * 1.15
        
        support = getattr(tech_indicators, 'support_level', None)
        if not support or support <= 0:
            valid_lows = [l for l in lows[-20:] if l is not None and l > 0] if len(lows) >= 20 else []
            support = min(valid_lows) if valid_lows else current_price * 0.90
        
        # Calculate target based on score (higher score = higher target)
        if composite_score >= 65:
            target_pct = 0.15    # +15%
            stop_pct = 0.08      # -8%
        elif composite_score >= 55:
            target_pct = 0.12    # +12%
            stop_pct = 0.09      # -9%
        elif composite_score >= 48:
            target_pct = 0.10    # +10%
            stop_pct = 0.10      # -10%
        else:
            target_pct = 0.08    # +8%
            stop_pct = 0.12      # -12%
        
        target_price = round(min(entry_price * (1 + target_pct), resistance * 0.98), 4)
        stop_loss = round(max(entry_price * (1 - stop_pct), support * 0.95), 4)
        
        # Ensure valid target and stop
        if target_price <= entry_price:
            target_price = round(entry_price * 1.10, 4)
        if stop_loss >= entry_price:
            stop_loss = round(entry_price * 0.90, 4)
        
        # Calculate risk-reward ratio safely
        if entry_price and stop_loss and (entry_price - stop_loss) > 0:
            risk_reward = round((target_price - entry_price) / (entry_price - stop_loss), 2)
        else:
            risk_reward = 0
        
        # 4. Pattern Detection
        patterns_detected = []
        if len(closes) >= 25:
            # Double Bottom
            recent = closes[-20:]
            min1 = min(recent[:10])
            min2 = min(recent[10:])
            max_between = max(recent[5:15])
            if abs(min1 - min2) / ((min1 + min2) / 2) < 0.03 and max_between > min1 * 1.03:
                patterns_detected.append({"name": "Double Bottom", "name_ar": "قاع مزدوج", "type": "bullish"})
            
            # Double Top
            max1 = max(recent[:10])
            max2 = max(recent[10:])
            min_between = min(recent[5:15])
            if abs(max1 - max2) / ((max1 + max2) / 2) < 0.03 and min_between < max1 * 0.97:
                patterns_detected.append({"name": "Double Top", "name_ar": "قمة مزدوجة", "type": "bearish"})
        
        # 5. Risk Metrics
        volatility = 0
        if len(closes) >= 20:
            # Calculate returns with NULL checks
            returns = []
            for i in range(1, min(21, len(closes))):
                if closes[i-1] and closes[i-1] > 0:
                    returns.append((closes[i] - closes[i-1]) / closes[i-1])
            if returns:
                mean_return = sum(returns) / len(returns)
                variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
                volatility = (variance ** 0.5) * (252 ** 0.5) * 100  # Annualized
        
        # Build response
        response = {
            "success": True,
            "ticker": ticker,
            "stock": {
                "ticker": ticker,
                "name": stock.get('name'),
                "name_ar": stock.get('name_ar'),
                "sector": stock.get('sector'),
                "current_price": current_price,
                "previous_close": stock.get('previous_close'),
                "price_change": stock.get('price_change'),
                "volume": stock.get('volume'),
                "market_cap": stock.get('market_cap')
            },
            "analysis": {
                "scores": {
                    "composite": composite_score,
                    "technical": round(tech_score, 2),
                    "value": round(value_score, 2),
                    "quality": round(quality_score, 2),
                    "momentum": round(momentum_score, 2),
                    "risk": round(risk_score, 2)
                },
                "recommendation": {
                    "action": action,
                    "action_ar": action_ar,
                    "confidence": round(confidence, 2),
                    "entry_price": entry_price,
                    "target_price": target_price,
                    "stop_loss": stop_loss,
                    "risk_reward_ratio": risk_reward,
                    "time_horizon": "medium_term",
                    "time_horizon_ar": "متوسط الأجل"
                },
                "indicators": {
                    "rsi": {"value": tech_indicators.rsi, "signal": tech_indicators.rsi_signal},
                    "macd": {"trend": tech_indicators.macd_trend, "histogram": tech_indicators.macd_histogram},
                    "bollinger": {
                        "upper": tech_indicators.bb_upper,
                        "middle": tech_indicators.bb_middle,
                        "lower": tech_indicators.bb_lower,
                        "position": tech_indicators.bb_position
                    },
                    "sma_20": tech_indicators.sma_20,
                    "sma_50": tech_indicators.sma_50
                },
                "patterns": {
                    "detected": patterns_detected
                },
                "price_levels": {
                    "support_1": support,
                    "resistance_1": resistance,
                    "pivot": round((support + resistance + current_price) / 3, 4)
                },
                "trend": {
                    "direction": tech_indicators.trend_direction or "SIDEWAYS",
                    "direction_ar": "صاعد" if tech_indicators.trend_direction == "UPTREND" else "هابط" if tech_indicators.trend_direction == "DOWNTREND" else "عرضي"
                },
                "risk_metrics": {
                    "max_drawdown_percent": round(max_drawdown, 2),
                    "volatility_annualized": round(volatility, 2)
                }
            },
            "data_available": True,
            "data_points": len(history),
            "generated_at": datetime.now().isoformat(),
            "source": "python_backend"
        }

        # ── Board of Analysts Integration ─────────────────────────────────
        # تحديد السوق من الـ query param أو الـ stock data
        market_param = request.args.get('market', '').upper()
        # Guess market from ticker format if not provided
        if not market_param:
            if ticker.isdigit():
                market_param = 'TADAWUL'
            elif len(ticker) <= 5 and ticker.isalpha():
                market_param = 'EGX'
            else:
                market_param = 'EGX'

        if _BOARD_AVAILABLE and _get_board_manager:
            try:
                board_manager = _get_board_manager(market_param)
                board_report = board_manager.generate_final_report(ticker)

                # Use board signal to enhance composite score (optional enrichment)
                board_signal = board_report.get('signal', 'HOLD')
                board_confidence = board_report.get('confidence', 50)
                board_master_score = board_report.get('master_score', 50)

                response['board_report'] = {
                    'signal': board_signal,
                    'signal_ar': board_report.get('signal_ar', ''),
                    'confidence': board_confidence,
                    'master_score': board_master_score,
                    'market': board_report.get('market', market_param),
                    'opinions': board_report.get('opinions', {}),
                    'sell_strategy': board_report.get('sell_strategy', ''),
                    'sell_strategy_desc': board_report.get('sell_strategy_desc', ''),
                    'entry_price': board_report.get('entry_price'),
                    'target_price': board_report.get('target_price'),
                    'stop_loss': board_report.get('stop_loss'),
                    'reason_ar': board_report.get('reason_ar', ''),
                    'board_available': True,
                }

                # Enrich the composite recommendation with board signal
                signal_score_map = {
                    'STRONG_BUY': 90, 'BUY': 75, 'ACCUMULATE': 62,
                    'HOLD': 50, 'REDUCE': 38, 'SELL': 25, 'STRONG_SELL': 10, 'AVOID': 0
                }
                board_numeric = signal_score_map.get(board_signal, 50)
                # Blend: 70% original composite + 30% board score → more objective
                blended_score = round(composite_score * 0.70 + board_numeric * 0.30, 2)
                response['analysis']['scores']['composite_blended'] = blended_score
                response['analysis']['scores']['board_score'] = board_numeric

            except Exception as be:
                response['board_report'] = {
                    'board_available': False,
                    'error': str(be)
                }
        else:
            response['board_report'] = {'board_available': False}
        # ─────────────────────────────────────────────────────────────────

        return jsonify(response)
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

