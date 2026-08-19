# DEPRECATED: This route is not registered in lightweight_server.py
"""
Analysis Modules API
====================

API endpoints for the comprehensive analysis modules.
This integrates all analysis types: technical, fundamental, sentiment, institutional, and quantitative.

Author: GLMinvestment Team
Version: 1.0.0
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Create blueprint
analysis_bp = Blueprint('analysis_modules', __name__, url_prefix='/api/analysis')

# ============================================================================
# TRY TO IMPORT ANALYSIS MODULES
# ============================================================================

ANALYSIS_MODULES_AVAILABLE = False
CONFLUENCE_ENGINE_AVAILABLE = False
POSITION_SIZING_AVAILABLE = False

try:
    from analyzers.technical import TechnicalAnalyzer
    from analyzers.candlestick import CandlestickAnalyzer as CandlestickPatterns
    from analyzers.patterns import PatternRecognitionEngine as ChartPatterns
    from analyzers.fibonacci import FibonacciAnalyzer as FibonacciTools
    TECHNICAL_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Technical analysis modules not available: {e}")
    TECHNICAL_AVAILABLE = False

try:
    from analyzers.confluence_engine import ConfluenceEngine
    CONFLUENCE_ENGINE_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Confluence Engine not available: {e}")
    CONFLUENCE_ENGINE_AVAILABLE = False

try:
    from analyzers.risk_manager import RiskManager
    POSITION_SIZING_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Quantitative modules not available: {e}")
    POSITION_SIZING_AVAILABLE = False

# Sentiment and Institutional modules not available in current codebase
SENTIMENT_AVAILABLE = False
INSTITUTIONAL_AVAILABLE = False

try:
    from analyzers.fundamental import FundamentalAnalyzer
    FUNDAMENTAL_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Fundamental analysis not available: {e}")
    FUNDAMENTAL_AVAILABLE = False


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def prepare_dataframe(price_history):
    """Convert price history list to pandas DataFrame for analysis."""
    import pandas as pd
    
    if not price_history:
        return None
    
    df = pd.DataFrame(price_history)
    
    # Ensure required columns
    required_cols = ['open', 'high', 'low', 'close', 'volume']
    for col in required_cols:
        if col not in df.columns:
            if col == 'open':
                df['open'] = df.get('open_price', df.get('close', 0))
            elif col == 'high':
                df['high'] = df.get('high_price', df.get('close', 0))
            elif col == 'low':
                df['low'] = df.get('low_price', df.get('close', 0))
            elif col == 'volume':
                df['volume'] = df.get('volume', 0)
    
    return df


# ============================================================================
# MODULES STATUS
# ============================================================================

@analysis_bp.route('/status', methods=['GET'])
def modules_status():
    """Get status of all analysis modules."""
    return jsonify({
        "success": True,
        "modules": {
            "technical": TECHNICAL_AVAILABLE,
            "confluence_engine": CONFLUENCE_ENGINE_AVAILABLE,
            "position_sizing": POSITION_SIZING_AVAILABLE,
            "sentiment": SENTIMENT_AVAILABLE,
            "institutional": INSTITUTIONAL_AVAILABLE,
            "fundamental": FUNDAMENTAL_AVAILABLE,
        },
        "timestamp": datetime.now().isoformat()
    })


# ============================================================================
# TECHNICAL ANALYSIS ENDPOINTS
# ============================================================================

@analysis_bp.route('/technical/comprehensive', methods=['POST'])
def technical_comprehensive():
    """
    Comprehensive technical analysis using all tools.
    
    Body: {
        "price_history": [...],  # List of OHLCV dicts
        "ticker": "COMI",
        "timeframe": "daily"  # daily, 4h, 1h
    }
    """
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Technical analysis modules not available"
            }), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        ticker = data.get('ticker', 'UNKNOWN')
        timeframe = data.get('timeframe', 'daily')
        
        if len(price_history) < 50:
            return jsonify({
                "success": False,
                "error": f"Insufficient data. Need at least 50 candles, got {len(price_history)}"
            }), 400
        
        df = prepare_dataframe(price_history)
        if df is None:
            return jsonify({"success": False, "error": "Failed to prepare data"}), 400
        
        # Run comprehensive technical analysis
        analyzer = TechnicalAnalyzer(df, timeframe)
        result = analyzer.analyze()
        
        return jsonify({
            "success": True,
            "ticker": ticker,
            "timeframe": timeframe,
            "signal": result.signal.value,
            "confidence": result.confidence,
            "success_probability": result.success_probability,
            "current_price": result.current_price,
            "entry_price": result.entry_price,
            "stop_loss": result.stop_loss,
            "target_price": result.target_price,
            "risk_reward": result.risk_reward,
            "bullish_signals": result.bullish_signals,
            "bearish_signals": result.bearish_signals,
            "summary": result.summary,
            "timestamp": result.timestamp
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/technical/candlesticks', methods=['POST'])
def detect_candlesticks():
    """Detect candlestick patterns."""
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({"success": False, "error": "Technical modules not available"}), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        
        if len(price_history) < 10:
            return jsonify({"success": False, "error": "Need at least 10 candles"}), 400
        
        df = prepare_dataframe(price_history)
        patterns = CandlestickPatterns(df)
        detected = patterns.detect_all()
        
        return jsonify({
            "success": True,
            "total_patterns": len(detected),
            "patterns": [
                {
                    "name": p.name,
                    "name_ar": p.name_ar,
                    "type": p.pattern_type.value,
                    "success_rate": p.success_rate,
                    "confidence": p.confidence,
                    "index": p.index,
                    "description": p.description,
                    "recommendation": p.recommendation
                }
                for p in detected
            ],
            "signals": patterns.get_signals()
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/technical/indicators', methods=['POST'])
def calculate_indicators():
    """Calculate all technical indicators."""
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({"success": False, "error": "Technical modules not available"}), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        
        if len(price_history) < 50:
            return jsonify({"success": False, "error": "Need at least 50 candles"}), 400
        
        df = prepare_dataframe(price_history)
        indicators = TechnicalIndicators(df)
        signals = indicators.get_all_signals()
        
        return jsonify({
            "success": True,
            "signals": signals
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/technical/patterns', methods=['POST'])
def detect_chart_patterns():
    """Detect chart patterns (Head & Shoulders, Double Tops, etc.)."""
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({"success": False, "error": "Technical modules not available"}), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        
        if len(price_history) < 50:
            return jsonify({"success": False, "error": "Need at least 50 candles"}), 400
        
        df = prepare_dataframe(price_history)
        patterns = ChartPatterns(df)
        detected = patterns.detect_all_patterns()
        
        return jsonify({
            "success": True,
            "total_patterns": len(detected),
            "patterns": [
                {
                    "name": p.name,
                    "name_ar": p.name_ar,
                    "category": p.category.value,
                    "direction": p.direction,
                    "success_rate": p.success_rate,
                    "breakout_level": p.breakout_level,
                    "target_price": p.target_price,
                    "stop_loss": p.stop_loss,
                    "risk_reward": p.risk_reward,
                    "confidence": p.confidence,
                    "description": p.description
                }
                for p in detected
            ],
            "summary": patterns.get_pattern_summary()
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/technical/harmonic', methods=['POST'])
def detect_harmonic():
    """Detect harmonic patterns (Gartley, Bat, Butterfly, etc.)."""
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({"success": False, "error": "Technical modules not available"}), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        
        if len(price_history) < 100:
            return jsonify({"success": False, "error": "Need at least 100 candles for harmonic patterns"}), 400
        
        df = prepare_dataframe(price_history)
        harmonic = HarmonicPatterns(df)
        detected = harmonic.detect_all_patterns()
        
        return jsonify({
            "success": True,
            "total_patterns": len(detected),
            "patterns": [
                {
                    "name": p.pattern_name,
                    "direction": p.direction,
                    "entry_price": p.entry_price,
                    "stop_loss": p.stop_loss,
                    "target": p.target,
                    "risk_reward": p.risk_reward,
                    "success_rate": p.success_rate,
                    "confidence": p.confidence
                }
                for p in detected
            ]
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/technical/support-resistance', methods=['POST'])
def detect_support_resistance():
    """Detect support and resistance levels."""
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({"success": False, "error": "Technical modules not available"}), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        current_price = data.get('current_price', 0)
        
        if len(price_history) < 50:
            return jsonify({"success": False, "error": "Need at least 50 candles"}), 400
        
        df = prepare_dataframe(price_history)
        sr = SupportResistance(df)
        levels = sr.detect_all_levels()
        nearest = sr.get_nearest_levels(current_price) if current_price else {}
        
        return jsonify({
            "success": True,
            "total_levels": len(levels),
            "levels": [
                {
                    "price": l.price,
                    "type": l.type.value,
                    "strength": l.strength,
                    "touches": l.touches,
                    "volume": l.volume
                }
                for l in levels[:20]  # Top 20 levels
            ],
            "nearest_support": nearest.get('nearest_support'),
            "nearest_resistance": nearest.get('nearest_resistance')
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# CONFLUENCE ENGINE ENDPOINT
# ============================================================================

@analysis_bp.route('/confluence', methods=['POST'])
def confluence_analysis():
    """
    Run confluence analysis combining all analysis types.
    
    Body: {
        "price_history": [...],
        "ticker": "COMI",
        "timeframe": "daily",
        "include_sentiment": true,
        "include_fundamental": true
    }
    """
    try:
        if not CONFLUENCE_ENGINE_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Confluence Engine not available"
            }), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        ticker = data.get('ticker', 'UNKNOWN')
        timeframe = data.get('timeframe', 'daily')
        
        if len(price_history) < 50:
            return jsonify({
                "success": False,
                "error": f"Insufficient data. Need at least 50 candles, got {len(price_history)}"
            }), 400
        
        df = prepare_dataframe(price_history)
        if df is None:
            return jsonify({"success": False, "error": "Failed to prepare data"}), 400
        
        # Run confluence engine
        engine = ConfluenceEngine(df, timeframe)
        result = engine.get_comprehensive_analysis()
        
        signal = result.confluence_signal
        
        return jsonify({
            "success": True,
            "ticker": ticker,
            "timeframe": timeframe,
            "direction": signal.direction.value,
            "strength": signal.strength.value,
            "confidence": signal.confidence,
            "success_probability": signal.success_probability,
            "entry_price": signal.entry_price,
            "stop_loss": signal.stop_loss,
            "target_price": signal.target_price,
            "risk_reward": signal.risk_reward,
            "confirming_signals": signal.confirming_signals,
            "conflicting_signals": signal.conflicting_signals,
            "warnings": signal.warnings,
            "recommendation": signal.recommendation,
            "overall_score": result.overall_score,
            "report": engine.get_report(),
            "timestamp": result.timestamp
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# POSITION SIZING ENDPOINTS
# ============================================================================

@analysis_bp.route('/position-size', methods=['POST'])
def calculate_position():
    """
    Calculate optimal position size using Kelly Criterion.
    
    Body: {
        "capital": 100000,
        "current_price": 25.50,
        "stop_loss_price": 24.00,
        "win_rate": 0.60,
        "win_loss_ratio": 2.0,
        "method": "half_kelly"
    }
    """
    try:
        if not POSITION_SIZING_AVAILABLE:
            return jsonify({
                "success": False,
                "error": "Position sizing modules not available"
            }), 503
        
        data = request.get_json() or {}
        
        capital = float(data.get('capital', 100000))
        current_price = float(data.get('current_price', 0))
        stop_loss_price = float(data.get('stop_loss_price', 0))
        win_rate = float(data.get('win_rate', 0.55))
        win_loss_ratio = float(data.get('win_loss_ratio', 2.0))
        method = data.get('method', 'half_kelly')
        
        if current_price <= 0 or stop_loss_price <= 0:
            return jsonify({
                "success": False,
                "error": "current_price and stop_loss_price are required"
            }), 400
        
        # Use quick calculation
        result = calculate_position_size(
            capital=capital,
            current_price=current_price,
            stop_loss_price=stop_loss_price,
            win_rate=win_rate,
            win_loss_ratio=win_loss_ratio
        )
        
        return jsonify({
            "success": True,
            "position_size_pct": result.position_size_pct,
            "position_value": result.position_value,
            "shares": result.shares,
            "risk_amount": result.risk_amount,
            "risk_pct": result.risk_pct,
            "expected_value": result.expected_value,
            "method": result.method.value,
            "description": result.description
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/kelly', methods=['POST'])
def calculate_kelly():
    """
    Calculate Kelly Criterion fractions.
    
    Body: {
        "win_rate": 0.60,
        "win_loss_ratio": 2.0,
        "capital": 100000,
        "current_price": 25.50
    }
    """
    try:
        if not POSITION_SIZING_AVAILABLE:
            return jsonify({"success": False, "error": "Position sizing not available"}), 503
        
        data = request.get_json() or {}
        
        win_rate = float(data.get('win_rate', 0.55))
        win_loss_ratio = float(data.get('win_loss_ratio', 2.0))
        capital = float(data.get('capital', 100000))
        current_price = float(data.get('current_price', 100))
        
        kelly = KellyCriterion(
            win_rate=win_rate,
            win_loss_ratio=win_loss_ratio,
            capital=capital,
            current_price=current_price
        )
        
        return jsonify({
            "success": True,
            "full_kelly": kelly.calculate(),
            "half_kelly": kelly.half_kelly(),
            "quarter_kelly": kelly.quarter_kelly(),
            "win_rate": win_rate,
            "win_loss_ratio": win_loss_ratio,
            "recommendation": "half_kelly (الأكثر شيوعاً)"
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# RISK MANAGEMENT ENDPOINTS
# ============================================================================

@analysis_bp.route('/risk/var', methods=['POST'])
def calculate_value_at_risk():
    """
    Calculate Value at Risk (VaR) for a portfolio.
    
    Body: {
        "returns": [0.01, -0.02, 0.03, ...],
        "confidence_levels": [0.95, 0.99]
    }
    """
    try:
        if not POSITION_SIZING_AVAILABLE:
            return jsonify({"success": False, "error": "Risk modules not available"}), 503
        
        data = request.get_json() or {}
        returns = data.get('returns', [])
        
        if len(returns) < 20:
            return jsonify({
                "success": False,
                "error": "Need at least 20 return values"
            }), 400
        
        import pandas as pd
        returns_series = pd.Series(returns)
        
        calculator = VaRCalculator(returns_series)
        var_metrics = calculator.get_all_var()
        
        return jsonify({
            "success": True,
            "var_95": var_metrics.get('var_95', 0),
            "var_99": var_metrics.get('var_99', 0),
            "cvar_95": var_metrics.get('cvar_95', 0),
            "interpretation": {
                "var_95": f"95% confidence that loss won't exceed {var_metrics.get('var_95', 0)*100:.2f}%",
                "var_99": f"99% confidence that loss won't exceed {var_metrics.get('var_99', 0)*100:.2f}%"
            }
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@analysis_bp.route('/risk/metrics', methods=['POST'])
def calculate_risk_metrics():
    """
    Calculate comprehensive risk metrics.
    
    Body: {
        "returns": [0.01, -0.02, 0.03, ...],
        "risk_free_rate": 0.02
    }
    """
    try:
        if not POSITION_SIZING_AVAILABLE:
            return jsonify({"success": False, "error": "Risk modules not available"}), 503
        
        data = request.get_json() or {}
        returns = data.get('returns', [])
        risk_free_rate = float(data.get('risk_free_rate', 0.02))
        
        if len(returns) < 20:
            return jsonify({"success": False, "error": "Need at least 20 return values"}), 400
        
        import pandas as pd
        returns_series = pd.Series(returns)
        
        manager = RiskManager(returns_series, risk_free_rate)
        metrics = manager.calculate_all_metrics()
        
        return jsonify({
            "success": True,
            "metrics": {
                "var_95": metrics.var_95,
                "var_99": metrics.var_99,
                "cvar_95": metrics.cvar_95,
                "max_drawdown": metrics.max_drawdown,
                "max_drawdown_duration": metrics.max_drawdown_duration,
                "sharpe_ratio": metrics.sharpe_ratio,
                "sortino_ratio": metrics.sortino_ratio,
                "volatility": metrics.volatility,
                "annualized_return": metrics.annualized_return,
                "risk_rating": metrics.risk_rating
            },
            "report": manager.generate_report()
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# SENTIMENT ANALYSIS ENDPOINTS
# ============================================================================

@analysis_bp.route('/sentiment/analyze', methods=['POST'])
def analyze_sentiment():
    """
    Analyze market sentiment.
    
    Body: {
        "pcr_value": 0.85,
        "trin_value": 1.05,
        "adv_issues": 200,
        "dec_issues": 150,
        "adv_volume": 50000000,
        "dec_volume": 30000000
    }
    """
    try:
        if not SENTIMENT_AVAILABLE:
            return jsonify({"success": False, "error": "Sentiment modules not available"}), 503
        
        data = request.get_json() or {}
        
        analyzer = SentimentAnalyzer()
        
        # Add PCR data
        if 'pcr_value' in data:
            analyzer.add_pcr_data(
                put_vol=data.get('put_volume', 1000000),
                call_vol=data.get('call_volume', 1000000)
            )
        
        # Add TRIN data
        if all(k in data for k in ['adv_issues', 'dec_issues', 'adv_volume', 'dec_volume']):
            analyzer.add_trin_data(
                adv_issues=data['adv_issues'],
                dec_issues=data['dec_issues'],
                adv_volume=data['adv_volume'],
                dec_volume=data['dec_volume']
            )
        
        result = analyzer.get_comprehensive_analysis()
        
        return jsonify({
            "success": True,
            "result": result
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# FUNDAMENTAL ANALYSIS ENDPOINTS
# ============================================================================

@analysis_bp.route('/fundamental/piotroski', methods=['POST'])
def calculate_piotroski():
    """
    Calculate Piotroski F-Score.
    
    Body: {
        "net_income": 1000000,
        "operating_cash_flow": 1200000,
        "total_assets": 10000000,
        "total_assets_prev": 9500000,
        ...
    }
    """
    try:
        if not FUNDAMENTAL_AVAILABLE:
            return jsonify({"success": False, "error": "Fundamental modules not available"}), 503
        
        data = request.get_json() or {}
        
        analyzer = PiotroskiAnalyzer()
        result = analyzer.calculate_fscore(
            net_income=data.get('net_income', 0),
            operating_cash_flow=data.get('operating_cash_flow', 0),
            total_assets=data.get('total_assets', 0),
            total_assets_prev=data.get('total_assets_prev', 0),
            current_assets=data.get('current_assets', 0),
            current_assets_prev=data.get('current_assets_prev', 0),
            current_liabilities=data.get('current_liabilities', 0),
            current_liabilities_prev=data.get('current_liabilities_prev', 0),
            long_term_debt=data.get('long_term_debt', 0),
            long_term_debt_prev=data.get('long_term_debt_prev', 0),
            shares_outstanding=data.get('shares_outstanding', 0),
            shares_outstanding_prev=data.get('shares_outstanding_prev', 0),
            gross_profit=data.get('gross_profit', 0),
            revenue=data.get('revenue', 0),
            gross_profit_prev=data.get('gross_profit_prev', 0),
            revenue_prev=data.get('revenue_prev', 0),
            total_assets_prev_year=data.get('total_assets_prev_year', 0),
            revenue_prev_year=data.get('revenue_prev_year', 0),
        )
        
        return jsonify({
            "success": True,
            "f_score": result['f_score'],
            "interpretation": result['interpretation'],
            "criteria_met": result['criteria_met'],
            "criteria_failed": result['criteria_failed'],
            "recommendation": result['recommendation']
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# QUICK SIGNAL ENDPOINT
# ============================================================================

@analysis_bp.route('/quick-signal', methods=['POST'])
def quick_signal():
    """
    Quick signal generation for a stock.
    
    Body: {
        "price_history": [...],
        "ticker": "COMI"
    }
    """
    try:
        if not TECHNICAL_AVAILABLE:
            return jsonify({"success": False, "error": "Technical modules not available"}), 503
        
        data = request.get_json() or {}
        price_history = data.get('price_history', [])
        ticker = data.get('ticker', 'UNKNOWN')
        
        if len(price_history) < 50:
            return jsonify({
                "success": False,
                "error": f"Need at least 50 candles, got {len(price_history)}"
            }), 400
        
        df = prepare_dataframe(price_history)
        analyzer = TechnicalAnalyzer(df)
        
        return jsonify({
            "success": True,
            "ticker": ticker,
            "signal": analyzer.get_quick_signal()
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# STOCK ANALYSIS API (from main.py)
# ============================================================================

# Try to import database and analyzers
try:
    from config import DATABASE_PATH
except ImportError:
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))

try:
    from core.database import DatabaseManager
    _db = DatabaseManager()
except ImportError as e:
    print(f"Warning: DatabaseManager not available: {e}")
    _db = None

try:
    from analyzers.technical import TechnicalAnalyzer as _TechAnalyzer
    _tech_analyzer = _TechAnalyzer()
except ImportError as e:
    print(f"Warning: TechnicalAnalyzer not available: {e}")
    _tech_analyzer = None

try:
    from analyzers.master_analyzer import MasterAnalyzer
    _master_analyzer = MasterAnalyzer(DATABASE_PATH)
except ImportError as e:
    print(f"Warning: MasterAnalyzer not available: {e}")
    _master_analyzer = None


@analysis_bp.route('/stockanalysis/', methods=['GET'])
@analysis_bp.route('/stockanalysis/<ticker>', methods=['GET'])
def ai_stock_analysis(ticker=None):
    """
    تحليل AI للأسهم
    AI-powered stock analysis using the MasterAnalyzer
    """
    try:
        if not _db:
            return jsonify({"success": False, "error": "Database not available"}), 503

        if ticker:
            ticker = ticker.upper()
            stock = _db.get_stock(ticker)
            if not stock:
                return jsonify({"success": False, "error": "Stock not found"}), 404
            
            history = _db.get_price_history(ticker, 365)
            if len(history) < 50:
                return jsonify({
                    "success": True,
                    "ticker": ticker,
                    "analysis": None,
                    "message": "Insufficient data for AI analysis (need 50+ data points)"
                })
            
            # Use MasterAnalyzer if available
            if _master_analyzer:
                analysis = _master_analyzer.analyze_stock(ticker)
                return jsonify({
                    "success": True,
                    "ticker": ticker,
                    "name": stock.get('name'),
                    "current_price": stock.get('current_price'),
                    "analysis": analysis,
                    "source": "master_analyzer_v2",
                    "timestamp": datetime.now().isoformat()
                })
            
            # Fallback to basic analysis
            if not _tech_analyzer:
                return jsonify({"success": False, "error": "Analyzers not available"}), 503
                
            closes = [h['close'] for h in history]
            tech = _tech_analyzer.analyze(closes)
            prediction = _tech_analyzer.generate_prediction(closes, ticker)
            
            return jsonify({
                "success": True,
                "ticker": ticker,
                "name": stock.get('name'),
                "current_price": stock.get('current_price'),
                "analysis": {
                    "signal": prediction.get('signal'),
                    "confidence": prediction.get('confidence'),
                    "rsi": tech.rsi,
                    "trend": tech.trend_direction,
                    "support": tech.support_level,
                    "resistance": tech.resistance_level
                },
                "source": "basic_analyzer",
                "timestamp": datetime.now().isoformat()
            })
        
        # If no ticker, return market-wide analysis
        stocks = _db.get_all_stocks()[:20]
        results = []
        
        for stock in stocks:
            t = stock.get('ticker')
            if not t:
                continue
            
            history = _db.get_price_history(t, 100)
            if len(history) >= 50 and _tech_analyzer:
                closes = [h['close'] for h in history]
                pred = _tech_analyzer.generate_prediction(closes, t)
                results.append({
                    "ticker": t,
                    "name": stock.get('name'),
                    "current_price": stock.get('current_price'),
                    "signal": pred.get('signal'),
                    "confidence": pred.get('confidence'),
                    "score": pred.get('score')
                })
        
        results.sort(key=lambda x: x.get('score', 0), reverse=True)
        
        return jsonify({
            "success": True,
            "count": len(results),
            "data": results,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# GOLDEN STOCKS API (from main.py)
# ============================================================================

@analysis_bp.route('/golden-stocks-v2/', methods=['GET'])
@analysis_bp.route('/golden-stocks-v2', methods=['GET'])
def get_golden_stocks():
    """
    الأسهم الذهبية - أفضل الفرص الاستثمارية
    Golden stocks - Top investment opportunities based on multiple criteria:
    - Technical: RSI oversold, MACD bullish crossover
    - Fundamental: Low P/E, High ROE
    - Momentum: Price above MA50
    - Risk: Low volatility
    """
    try:
        if not _db:
            return jsonify({"success": False, "error": "Database not available"}), 503
        if not _tech_analyzer:
            return jsonify({"success": False, "error": "Technical analyzer not available"}), 503

        limit = request.args.get('limit', 10, type=int)
        stocks = _db.get_all_stocks()
        golden_stocks = []
        
        for stock in stocks:
            ticker = stock.get('ticker')
            if not ticker:
                continue
            
            history = _db.get_price_history(ticker, 100)
            if len(history) < 50:
                continue
            
            closes = [h['close'] for h in history]
            current_price = closes[-1] if closes else 0
            
            # Calculate golden score (0-100)
            golden_score = 0
            
            # Technical Analysis (40 points max)
            tech = _tech_analyzer.analyze(closes)
            
            # RSI condition (oversold = good entry)
            if tech.rsi and tech.rsi <= 30:
                golden_score += 15
            elif tech.rsi and 30 < tech.rsi <= 40:
                golden_score += 10
            elif tech.rsi and 40 < tech.rsi <= 50:
                golden_score += 5
            
            # MACD condition
            if tech.macd_trend == "BULLISH":
                golden_score += 10
            elif tech.macd_trend == "NEUTRAL":
                golden_score += 5
            
            # Trend condition
            if tech.trend_direction == "UPTREND":
                golden_score += 10
            elif tech.trend_direction == "SIDEWAYS":
                golden_score += 5
            
            # Price vs MA condition
            if tech.sma_50 and current_price > tech.sma_50:
                golden_score += 5
            
            # Fundamental Analysis (30 points max)
            pe_ratio = stock.get('pe_ratio')
            roe = stock.get('roe')
            
            if pe_ratio and pe_ratio < 10:
                golden_score += 10
            elif pe_ratio and pe_ratio < 15:
                golden_score += 5
            
            if roe and roe > 20:
                golden_score += 15
            elif roe and roe > 15:
                golden_score += 10
            elif roe and roe > 10:
                golden_score += 5
            
            # Risk Analysis (30 points max)
            if len(closes) >= 20:
                # Calculate volatility
                returns = [(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes[-21:]))]
                if returns:
                    mean_return = sum(returns) / len(returns)
                    variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
                    volatility = (variance ** 0.5) * 100
                    
                    if volatility < 2:
                        golden_score += 20
                    elif volatility < 3:
                        golden_score += 15
                    elif volatility < 4:
                        golden_score += 10
                    elif volatility < 5:
                        golden_score += 5
            
            # Support/Resistance ratio
            if tech.support_level and tech.resistance_level and current_price:
                # Good if price is near support
                distance_to_support = (current_price - tech.support_level) / tech.support_level * 100
                if distance_to_support < 3:
                    golden_score += 10
                elif distance_to_support < 5:
                    golden_score += 5
            
            # Only include stocks with golden score >= 50
            if golden_score >= 50:
                golden_stocks.append({
                    "ticker": ticker,
                    "name": stock.get('name'),
                    "name_ar": stock.get('name_ar'),
                    "current_price": round(current_price, 2),
                    "sector": stock.get('sector'),
                    "golden_score": golden_score,
                    "rsi": round(tech.rsi, 2) if tech.rsi else None,
                    "trend": tech.trend_direction,
                    "support": round(tech.support_level, 2) if tech.support_level else None,
                    "resistance": round(tech.resistance_level, 2) if tech.resistance_level else None,
                    "pe_ratio": pe_ratio,
                    "roe": roe,
                    "recommendation": "strong_buy" if golden_score >= 75 else "buy"
                })
        
        # Sort by golden score
        golden_stocks.sort(key=lambda x: x['golden_score'], reverse=True)
        
        return jsonify({
            "success": True,
            "count": len(golden_stocks[:limit]),
            "data": golden_stocks[:limit],
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
