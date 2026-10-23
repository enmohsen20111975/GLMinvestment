"""
Risk Management API
===================

API endpoints for risk management and position sizing.
Enhanced with Egyptian Model, Psychology Rules, and more.

Author:M2yDevelopers Team
Version: 2.0.0
"""

from flask import Blueprint, jsonify, request
from core.auth_middleware import require_admin
from datetime import datetime
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Create blueprint
risk_bp = Blueprint('risk_management', __name__, url_prefix='/api/risk')

# Import advanced risk management
try:
    from risk_management_advanced import (
        calculate_position_size,
        calculate_stop_loss,
        calculate_targets,
        calculate_trailing_stop,
        calculate_position_plan,
        evaluate_buy_safety,
        enforce_stop_loss,
        explain_trailing_stop,
        get_trading_time_advice,
        analyze_portfolio,
        validate_trade_with_2_percent_rule,
        calculate_egyptian_confidence,
        score_news_for_sector,
        analyze_multiple_news,
        check_psychology_rules,
        validate_leverage,
        detect_stock_type,
        calculate_dynamic_stop_loss,
        calculate_dynamic_targets,
        calculate_dynamic_trailing_stop,
        calculate_dynamic_rr,
        DECISION_TABLE,
        # P0.6: STOP_LOSS_EGX / STOP_LOSS_CRYPTO مُوقّفة (deprecated shims)
        # — استخدم get_stop_loss_pct(stock_type, market) بدلًا منها.
        get_stop_loss_pct,
        _get_stop_loss_reason,
    )
    ADVANCED_RISK_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Advanced risk_management not available: {e}")
    ADVANCED_RISK_AVAILABLE = False

# Import basic RiskManager (fallback)
try:
    from analyzers.risk import RiskManager
    RISK_MANAGER_AVAILABLE = True
except ImportError as e:
    print(f"Warning: RiskManager not available: {e}")
    RISK_MANAGER_AVAILABLE = False


# ============================================================================
# POSITION SIZING
# ============================================================================

@require_admin
@risk_bp.route('/position-size', methods=['POST'])
def api_position_size():
    """Calculate position size based on confidence score."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        capital = float(data.get('capital', 10000))
        confidence_score = float(data.get('confidence_score', 0))
        max_risk_percent = float(data.get('max_risk_percent', 2.0))
        
        result = calculate_position_size(capital, confidence_score, max_risk_percent)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# STOP LOSS
# ============================================================================

@require_admin
@risk_bp.route('/stop-loss', methods=['POST'])
def api_stop_loss():
    """Calculate stop loss price."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        entry_price = float(data.get('entry_price', 0))
        symbol = data.get('symbol', '')
        sector = data.get('sector')
        market = data.get('market', 'egx')
        custom_percent = float(data.get('custom_percent')) if data.get('custom_percent') else None
        
        if entry_price <= 0:
            return jsonify({"success": False, "error": "entry_price is required"}), 400
        
        # Auto-detect stock type
        stock_type = detect_stock_type(symbol, sector) if symbol else 'speculative'
        
        result = calculate_stop_loss(
            entry_price=entry_price,
            stock_type=stock_type,
            symbol=symbol,
            market=market,
            custom_percent=custom_percent
        )
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TARGETS
# ============================================================================

@require_admin
@risk_bp.route('/targets', methods=['POST'])
def api_targets():
    """Calculate profit targets."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        entry_price = float(data.get('entry_price', 0))
        stop_price = float(data.get('stop_price', 0))
        ratios = data.get('ratios', [1.5, 3, 5])
        
        if entry_price <= 0 or stop_price <= 0:
            return jsonify({"success": False, "error": "entry_price and stop_price are required"}), 400
        
        result = calculate_targets(entry_price, stop_price, ratios)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# FULL TRADE PLAN
# ============================================================================

@require_admin
@risk_bp.route('/trade-plan', methods=['POST'])
def api_trade_plan():
    """Generate complete trade plan."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        entry_price = float(data.get('entry_price', 0))
        symbol = data.get('symbol', '')
        sector = data.get('sector')
        capital = float(data.get('capital', 10000))
        confidence_score = float(data.get('confidence_score', 5))
        market = data.get('market', 'egx')
        
        if entry_price <= 0:
            return jsonify({"success": False, "error": "entry_price is required"}), 400
        
        # Get stock type
        stock_type = detect_stock_type(symbol, sector) if symbol else 'speculative'
        
        # Calculate position size
        position = calculate_position_size(capital, confidence_score)
        
        # Calculate stop loss
        stop_loss = calculate_stop_loss(entry_price, stock_type, symbol, market)
        
        # Calculate targets
        targets = calculate_targets(entry_price, stop_loss['stop_price'])
        
        # Validate with 2% rule
        shares = int(position['position_size'] / entry_price) if entry_price > 0 else 0
        validation = validate_trade_with_2_percent_rule(
            capital, entry_price, stop_loss['stop_price'], shares
        )
        
        return jsonify({
            "success": True,
            "symbol": symbol,
            "stock_type": stock_type,
            "position": position,
            "stop_loss": stop_loss,
            "targets": targets,
            "validation": validation,
            "trade_plan": {
                "entry": entry_price,
                "stop": stop_loss['stop_price'],
                "target_1": targets['targets'][0]['price'] if targets['targets'] else None,
                "target_2": targets['targets'][1]['price'] if len(targets['targets']) > 1 else None,
                "target_3": targets['targets'][2]['price'] if len(targets['targets']) > 2 else None,
                "shares": shares,
                "total_value": round(shares * entry_price, 2)
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TRAILING STOP
# ============================================================================

@require_admin
@risk_bp.route('/trailing-stop', methods=['POST'])
def api_trailing_stop():
    """Calculate trailing stop."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        entry_price = float(data.get('entry_price', 0))
        current_price = float(data.get('current_price', 0))
        stop_price = float(data.get('stop_price', 0))
        target_reached = int(data.get('target_reached', 0))
        
        if entry_price <= 0 or stop_price <= 0:
            return jsonify({"success": False, "error": "entry_price and stop_price are required"}), 400
        
        result = calculate_trailing_stop(entry_price, current_price, stop_price, target_reached)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# 2% RULE VALIDATION
# ============================================================================

@require_admin
@risk_bp.route('/validate', methods=['POST'])
def api_validate_2_percent():
    """Validate trade against 2% rule."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        capital = float(data.get('capital', 10000))
        entry_price = float(data.get('entry_price', 0))
        stop_price = float(data.get('stop_price', 0))
        shares = int(data.get('shares', 0))
        
        if entry_price <= 0 or stop_price <= 0 or shares <= 0:
            return jsonify({"success": False, "error": "entry_price, stop_price, and shares are required"}), 400
        
        result = validate_trade_with_2_percent_rule(capital, entry_price, stop_price, shares)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TRADING TIME ADVISOR
# ============================================================================

@risk_bp.route('/trading-time', methods=['GET'])
def api_trading_time():
    """Get trading time advice."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        market = request.args.get('market', 'egx')
        result = get_trading_time_advice(market)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# PORTFOLIO ANALYSIS
# ============================================================================

@require_admin
@risk_bp.route('/portfolio', methods=['POST'])
def api_portfolio():
    """Analyze portfolio."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        holdings = data.get('holdings', [])
        total_capital = float(data.get('total_capital', 0))
        cash = float(data.get('cash', 0))
        
        result = analyze_portfolio(holdings, total_capital, cash)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# EGYPTIAN MODEL
# ============================================================================

@require_admin
@risk_bp.route('/egyptian-model', methods=['POST'])
def api_egyptian_model():
    """Calculate Egyptian confidence score."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        news_alignment = float(data.get('news_alignment', 50))
        volume_normal = float(data.get('volume_normal', 50))
        sector_impact = float(data.get('sector_impact', 50))
        technical_simple = float(data.get('technical_simple', 50))
        
        result = calculate_egyptian_confidence(
            news_alignment, volume_normal, sector_impact, technical_simple
        )
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# PSYCHOLOGY CHECK
# ============================================================================

@require_admin
@risk_bp.route('/psychology', methods=['POST'])
def api_psychology():
    """Check psychology rules before trading."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        result = check_psychology_rules(
            stock_trending=data.get('stock_trending', False),
            daily_change_percent=float(data.get('daily_change_percent', 0)),
            from_friend_tip=data.get('from_friend_tip', False),
            all_in=data.get('all_in', False),
            needed_soon=data.get('needed_soon', False),
            emotional_state=data.get('emotional_state', 'calm')
        )
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# LEVERAGE VALIDATION (Crypto)
# ============================================================================

@require_admin
@risk_bp.route('/leverage', methods=['POST'])
def api_leverage():
    """Validate leverage for crypto trading."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Advanced risk management not available"
            }), 503

        data = request.get_json() or {}
        
        leverage = float(data.get('leverage', 1))
        position_size = float(data.get('position_size', 0))
        stop_percent = float(data.get('stop_percent', -10))
        capital = float(data.get('capital', 10000))
        
        result = validate_leverage(leverage, position_size, stop_percent, capital)
        
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DECISION TABLE
# ============================================================================

@risk_bp.route('/decision-table', methods=['GET'])
def api_decision_table():
    """Get quick decision reference table."""
    try:
        return jsonify({
            "success": True,
            "decision_table": DECISION_TABLE
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# STOCK TYPES REFERENCE
# ============================================================================

@risk_bp.route('/stock-types', methods=['GET'])
def api_stock_types():
    """Get stock types and their stop loss percentages."""
    try:
        # P0.6: اعرض كل أنواع الأسهم + نسب الستوب من engine_settings (المصدر الوحيد).
        # الـ stock types ثابتة per-market لكن النسب بـ تقرأ dynamically من
        # engine_settings عبر get_stop_loss_pct().
        egx_types = ['large_bank', 'medium_bank', 'large_real_estate',
                     'small_real_estate', 'large_industrial', 'small_industrial',
                     'speculative', 'suspended']
        crypto_types = ['bitcoin', 'ethereum', 'large_altcoin',
                        'small_altcoin', 'meme_coin']

        egx_payload = {}
        for st in egx_types:
            egx_payload[st] = {
                'percent': get_stop_loss_pct(st, 'EGX'),
                'reason': _get_stop_loss_reason(st, 'EGX'),
            }

        crypto_payload = {}
        for st in crypto_types:
            crypto_payload[st] = {
                'percent': get_stop_loss_pct(st, 'CRYPTO'),
                'reason': _get_stop_loss_reason(st, 'CRYPTO'),
            }

        return jsonify({
            "success": True,
            "egx_types": egx_payload,
            "crypto_types": crypto_payload
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TRADE PLAN CALCULATOR (Position Size Calculator)
# ============================================================================

@require_admin
@risk_bp.route('/position-plan', methods=['POST'])
def api_position_plan():
    """حاسبة الصفقة الكاملة: عدد الأسهم، قيمة الصفقة، أقصى خسارة، R:R، القرار."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        capital = float(data.get('capital', 100000))
        entry_price = float(data.get('entry_price', 0))
        stop_loss = float(data.get('stop_loss', 0))
        target_price = float(data.get('target_price')) if data.get('target_price') else None
        risk_percent = float(data.get('risk_percent', 2.0))
        confidence_score = float(data.get('confidence_score', 5))
        max_risk_percent = float(data.get('max_risk_percent', 2.0))

        if entry_price <= 0 or stop_loss <= 0:
            return jsonify({"success": False, "error": "entry_price and stop_loss are required"}), 400

        result = calculate_position_plan(
            capital=capital,
            entry_price=entry_price,
            stop_loss=stop_loss,
            target_price=target_price,
            risk_percent=risk_percent,
            confidence_score=confidence_score,
            max_risk_percent=max_risk_percent,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# ANTI-FALLING-KNIFE (Buy Safety)
# ============================================================================

@require_admin
@risk_bp.route('/buy-safety', methods=['POST'])
def api_buy_safety():
    """تقييم أمان الشراء - قواعد 'لا تشتري نازل' الصريحة."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        closes = data.get('closes')
        highs = data.get('highs')
        lows = data.get('lows')
        volumes = data.get('volumes')
        rsi = float(data['rsi']) if data.get('rsi') is not None else None
        required_higher_lows = int(data.get('required_higher_lows', 2))

        result = evaluate_buy_safety(
            closes=closes, highs=highs, lows=lows, volumes=volumes,
            rsi=rsi, required_higher_lows=required_higher_lows,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# FORCED EXIT ENFORCEMENT
# ============================================================================

@require_admin
@risk_bp.route('/enforce-stop', methods=['POST'])
def api_enforce_stop():
    """إنفاذ وقف الخسارة - منع تغيير الوقف لتحت + إشارات إجبارية."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        entry_price = float(data.get('entry_price', 0))
        current_price = float(data.get('current_price', 0))
        stop_price = float(data.get('stop_price', 0))
        original_stop_price = float(data['original_stop_price']) if data.get('original_stop_price') is not None else None
        forced_exit_pct = float(data.get('forced_exit_pct', -8.0))

        if entry_price <= 0 or current_price <= 0 or stop_price <= 0:
            return jsonify({"success": False, "error": "entry_price, current_price and stop_price are required"}), 400

        result = enforce_stop_loss(
            entry_price=entry_price, current_price=current_price,
            stop_price=stop_price, original_stop_price=original_stop_price,
            forced_exit_pct=forced_exit_pct,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# TRAILING STOP EXPLAINER
# ============================================================================

@require_admin
@risk_bp.route('/trailing-explain', methods=['POST'])
def api_trailing_explain():
    """توضيح حركة الـ Trailing Stop للمستخدم."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        entry_price = float(data.get('entry_price', 0))
        current_price = float(data.get('current_price', 0))
        current_stop = float(data.get('current_stop', 0))

        if entry_price <= 0 or current_price <= 0 or current_stop <= 0:
            return jsonify({"success": False, "error": "entry_price, current_price and current_stop are required"}), 400

        result = explain_trailing_stop(entry_price, current_price, current_stop)

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DYNAMIC STOP LOSS (ATR-Based)
# ============================================================================

@require_admin
@risk_bp.route('/dynamic-stop', methods=['POST'])
def api_dynamic_stop():
    """حساب وقف خسارة ديناميكي بناءً على ATR بدل نسبة ثابتة."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        entry_price = float(data.get('entry_price', 0))
        symbol = data.get('symbol', '')
        market = data.get('market', 'egx')
        multiplier = float(data.get('multiplier', 2.0))
        max_stop_pct = float(data.get('max_stop_pct', 15.0))  # P1.2: API default لـ calculate_dynamic_stop_loss endpoint — مفهوم مختلف عن engine_settings.position_max_stop_pct=10.0 (POSITION-LAYER hard cap).
        min_stop_pct = float(data.get('min_stop_pct', 2.0))

        if entry_price <= 0:
            return jsonify({"success": False, "error": "entry_price is required"}), 400

        # محاولة جلب ATR من البيانات التاريخية
        atr = None
        try:
            from analyzers.master_analyzer import load_merged_history
            rows = load_merged_history(symbol, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'price_history.db'), limit=30)
            if rows and len(rows) >= 14:
                highs = [float(r.get('high', 0) or 0) for r in rows]
                lows = [float(r.get('low', 0) or 0) for r in rows]
                closes = [float(r.get('close', 0) or 0) for r in rows]
                atr_values = []
                for i in range(1, 15):
                    if i < len(closes):
                        tr = max(
                            highs[-i] - lows[-i],
                            abs(highs[-i] - closes[-i - 1]),
                            abs(lows[-i] - closes[-i - 1]),
                        )
                        atr_values.append(tr)
                if atr_values:
                    atr = sum(atr_values) / len(atr_values)
        except Exception:
            pass

        result = calculate_dynamic_stop_loss(
            entry_price=entry_price,
            atr=atr,
            atr_period=14,
            multiplier=multiplier,
            symbol=symbol,
            market=market,
            max_stop_pct=max_stop_pct,
            min_stop_pct=min_stop_pct,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DYNAMIC TARGETS (ATR-Based)
# ============================================================================

@require_admin
@risk_bp.route('/dynamic-targets', methods=['POST'])
def api_dynamic_targets():
    """حساب أهداف ربح ديناميكية بناءً على ATR والتقلب."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        entry_price = float(data.get('entry_price', 0))
        stop_price = float(data.get('stop_price', 0))
        symbol = data.get('symbol', '')
        regime = data.get('regime', 'ranging')

        if entry_price <= 0 or stop_price <= 0:
            return jsonify({"success": False, "error": "entry_price and stop_price are required"}), 400

        # محاولة جلب ATR من البيانات التاريخية
        atr = None
        try:
            from analyzers.master_analyzer import load_merged_history
            rows = load_merged_history(symbol, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'price_history.db'), limit=30)
            if rows and len(rows) >= 14:
                highs = [float(r.get('high', 0) or 0) for r in rows]
                lows = [float(r.get('low', 0) or 0) for r in rows]
                closes = [float(r.get('close', 0) or 0) for r in rows]
                atr_values = []
                for i in range(1, 15):
                    if i < len(closes):
                        tr = max(
                            highs[-i] - lows[-i],
                            abs(highs[-i] - closes[-i - 1]),
                            abs(lows[-i] - closes[-i - 1]),
                        )
                        atr_values.append(tr)
                if atr_values:
                    atr = sum(atr_values) / len(atr_values)
        except Exception:
            pass

        result = calculate_dynamic_targets(
            entry_price=entry_price,
            stop_price=stop_price,
            atr=atr,
            atr_period=14,
            regime=regime,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DYNAMIC TRAILING STOP (Price-Following)
# ============================================================================

@require_admin
@risk_bp.route('/dynamic-trailing', methods=['POST'])
def api_dynamic_trailing():
    """حساب وقف خسارة متحرك ديناميكي يتبع حركة السعر."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        entry_price = float(data.get('entry_price', 0))
        current_price = float(data.get('current_price', 0))
        symbol = data.get('symbol', '')
        method = data.get('method', 'atr')
        trailing_pct = float(data.get('trailing_pct')) if data.get('trailing_pct') else None

        if entry_price <= 0 or current_price <= 0:
            return jsonify({"success": False, "error": "entry_price and current_price are required"}), 400

        # محاولة جلب ATR من البيانات التاريخية
        atr = None
        try:
            from analyzers.master_analyzer import load_merged_history
            rows = load_merged_history(symbol, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'price_history.db'), limit=30)
            if rows and len(rows) >= 14:
                highs = [float(r.get('high', 0) or 0) for r in rows]
                lows = [float(r.get('low', 0) or 0) for r in rows]
                closes = [float(r.get('close', 0) or 0) for r in rows]
                atr_values = []
                for i in range(1, 15):
                    if i < len(closes):
                        tr = max(
                            highs[-i] - lows[-i],
                            abs(highs[-i] - closes[-i - 1]),
                            abs(lows[-i] - closes[-i - 1]),
                        )
                        atr_values.append(tr)
                if atr_values:
                    atr = sum(atr_values) / len(atr_values)
        except Exception:
            pass

        result = calculate_dynamic_trailing_stop(
            entry_price=entry_price,
            current_price=current_price,
            atr=atr,
            atr_period=14,
            trailing_pct=trailing_pct,
            method=method,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DYNAMIC R:R CALCULATOR
# ============================================================================

@require_admin
@risk_bp.route('/dynamic-rr', methods=['POST'])
def api_dynamic_rr():
    """حساب R:R ديناميكي بناءً على الأسعار الحالية."""
    try:
        if not ADVANCED_RISK_AVAILABLE:
            return jsonify({"success": False, "error": "Advanced risk management not available"}), 503

        data = request.get_json() or {}

        entry_price = float(data.get('entry_price', 0))
        current_price = float(data.get('current_price', 0))
        stop_price = float(data.get('stop_price', 0))
        target_price = float(data.get('target_price', 0))

        if entry_price <= 0 or current_price <= 0 or stop_price <= 0 or target_price <= 0:
            return jsonify({"success": False, "error": "entry_price, current_price, stop_price, and target_price are required"}), 400

        result = calculate_dynamic_rr(
            entry_price=entry_price,
            current_price=current_price,
            stop_price=stop_price,
            target_price=target_price,
        )

        return jsonify({"success": True, **result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# LEGACY ENDPOINTS (Backward Compatibility)
# ============================================================================

@require_admin
@risk_bp.route('/evaluate', methods=['POST'])
def evaluate_risk():
    """Legacy: Evaluate trade risk."""
    try:
        if not RISK_MANAGER_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "RiskManager not available"
            }), 503

        data = request.get_json() or {}
        
        entry_price = float(data.get('entry_price', 0))
        target_price = float(data.get('target_price')) if data.get('target_price') else None
        stop_loss = float(data.get('stop_loss')) if data.get('stop_loss') else None
        signal = data.get('signal', 'BUY')
        capital = float(data.get('capital', 10000))
        risk_percent = float(data.get('risk_percent', 2.0))
        support = float(data.get('support_level')) if data.get('support_level') else None
        resistance = float(data.get('resistance_level')) if data.get('resistance_level') else None
        
        if entry_price <= 0:
            return jsonify({"success": False, "error": "entry_price is required"}), 400
        
        manager = RiskManager(capital=capital, risk_percent=risk_percent)
        assessment = manager.evaluate_trade(
            entry_price=entry_price,
            target_price=target_price,
            stop_loss=stop_loss,
            signal=signal,
            support_level=support,
            resistance_level=resistance
        )
        
        return jsonify({
            "success": True,
            "assessment": assessment.to_dict()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
