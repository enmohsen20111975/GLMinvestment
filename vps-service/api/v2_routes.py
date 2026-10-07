"""
V2 and Persona Routes Blueprint
================================
Endpoints للـ V2 API و Persona Engine

V2 Analysis Endpoints:
- GET /api/v2/analysis/<ticker> - تحليل سهم محسن (Kimi's version)
- GET /api/v2/scanner - ماسح السوق المحسن
- GET /api/v2/cached-scanner - ماسح من الكاش
- GET /api/v2/cached-analysis/<ticker> - تحليل من الكاش
- GET /api/v2/morning-recommendations - توقعات صباحية
- GET /api/v2/persona-analysis/<persona_type> - تحليل حسب الشخصية

Persona Endpoints:
- GET /api/personas - كل الشخصيات
- GET /api/personas/<persona_type> - شخصية معينة
- POST /api/personas/classify - تصنيف المستخدم

Scanner by Persona:
- GET /api/v2/scanner/all-personas - مقارنة كل الشخصيات
- GET /api/v2/scanner/<persona_type> - نتائج شخصية معينة

Admin Endpoints:
- POST /api/v2/admin/run-daily-persona-analysis - تشغيل التحليل اليومي
- GET /api/v2/persona/<persona_type>/cached - نتائج محفوظة
- GET /api/v2/persona/status - حالة التحليل
"""

import time
from datetime import datetime
from flask import Blueprint, request, jsonify

from core.database import DatabaseManager

# Market code mapping - normalize frontend codes to database codes
# Frontend uses: EGX, KSA/TADAWUL, KSE, QSE
# Database uses: EGX, TADAWUL, KSE, QSE (matching the actual DB values)
MARKET_MAP = {
    # Frontend codes -> Database codes (direct match)
    'EGX': 'EGX',
    'TADAWUL': 'TADAWUL',
    'KSA': 'TADAWUL',      # KSA maps to TADAWUL
    'KSE': 'KSE',
    'QSE': 'QSE',
    'DFM': 'DFM',
    'ADX': 'ADX',
    'BSE': 'BSE',
    # Arabic names -> Database codes (backward compatibility)
    'مصر': 'EGX',
    'السعودية': 'TADAWUL',
    'الكويت': 'KSE',
    'قطر': 'QSE',
    'الإمارات': 'DFM',
    'البحرين': 'BSE',
    # Egypt market variations
    'EGYPT': 'EGX',
    'KUWAIT': 'KSE',
    'QATAR': 'QSE',
    'UAE': 'DFM',
}

# Reverse mapping for display (database code -> frontend code)
MARKET_MAP_REVERSE = {
    'EGX': 'EGX',
    'TADAWUL': 'TADAWUL',
    'KSE': 'KSE',
    'QSE': 'QSE',
    'DFM': 'DFM',
    'ADX': 'ADX',
    'BSE': 'BSE',
    # Arabic names support
    'مصر': 'EGX',
    'السعودية': 'TADAWUL',
    'الكويت': 'KSE',
    'قطر': 'QSE',
}

# Import MasterAnalyzer
try:
    from analyzers.master_analyzer import MasterAnalyzer
    MASTER_ANALYZER_AVAILABLE = True
except ImportError as e:
    print(f"Warning: MasterAnalyzer not available: {e}")
    MASTER_ANALYZER_AVAILABLE = False

# Get database path
try:
    from config import DATABASE_PATH
except ImportError:
    import os
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.resolve()  # Project root
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))

v2_bp = Blueprint('v2_routes', __name__)

# Initialize
db = DatabaseManager()

# Initialize MasterAnalyzer
if MASTER_ANALYZER_AVAILABLE:
    try:
        master_analyzer = MasterAnalyzer(DATABASE_PATH)
        print("✓ MasterAnalyzer initialized in v2_routes")
    except Exception as e:
        print(f"Warning: Could not initialize MasterAnalyzer in v2_routes: {e}")
        master_analyzer = None
else:
    master_analyzer = None


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

# Known Kuwaiti / Gulf tickers that leak into EGX caches when market field is NULL.
# Extend this set if new leak tickers are discovered.
_KUWAIT_GULF_TICKERS = {
    'RASIYAT', 'OOREDOO', 'AAYANRE', 'NBK', 'ZAIN', 'KPC', 'KIOC', 'KFH',
    'MABANEE', 'AGTHIA', 'BOUBYAN', 'KUWAIT', 'KWSA', 'QPWR', 'ORDS',
    'NCC', 'HEICO', 'CWG', 'BURJ', 'AYAN', 'INVESTORS', 'GFH',
}


def _is_non_egx_ticker(ticker: str) -> bool:
    """Defense-in-depth: detect non-Egyptian tickers that leak into EGX caches.

    Returns True if the ticker looks Saudi (pure numeric, TADAWUL style) or
    matches a known Kuwaiti/Gulf symbol. EGX tickers are always alphabetic
    (e.g. COMI, ETEL, SWDY, PHAR) so any all-digit ticker is definitely not EGX.
    """
    if not ticker:
        return False
    t = str(ticker).strip().upper()
    # Saudi TADAWUL tickers are pure 4-digit numbers (1120, 2120, 3002, 4280)
    if t.isdigit():
        return True
    # Known Kuwaiti / Gulf symbols
    if t in _KUWAIT_GULF_TICKERS:
        return True
    return False


def _strict_market_filter(analysis: dict, db_market: str, db_manager=None) -> bool:
    """Return True if `analysis` should be KEPT for the requested `db_market`.

    This is a defense-in-depth Python-side filter. Even if the cached_analysis
    table has a wrong/NULL market value, this rejects:
      - Saudi (numeric) tickers when EGX is requested
      - Known Kuwaiti/Gulf tickers when EGX is requested
      - Any analysis whose resolved market != requested market
    When db_market is empty (no filter requested), always keeps (returns True).
    """
    if not db_market:
        return True
    t_ticker = str(analysis.get('ticker', '')).strip()
    is_saudi = t_ticker.isdigit()
    is_kuwait = _is_non_egx_ticker(t_ticker) and not is_saudi  # Kuwait set match

    # Resolve the analysis market, inferring from ticker if missing/unknown
    t_market = analysis.get('market')
    if not t_market or str(t_market).upper() == 'UNKNOWN':
        if is_saudi:
            t_market = 'TADAWUL'
        elif is_kuwait:
            t_market = 'KSE'
        else:
            # Cross-validate against the official stocks table if available
            if db_manager is not None:
                try:
                    stock = db_manager.get_stock(t_ticker)
                    if stock:
                        t_market = stock.get('market', 'EGX')
                    else:
                        t_market = 'EGX'  # unknown ticker → assume EGX (permissive)
                except Exception:
                    t_market = 'EGX'
            else:
                t_market = 'EGX'

    target = db_market.upper()
    # Hard reject: Saudi/Kuwaiti never belong in EGX
    if target == 'EGX' and (is_saudi or is_kuwait):
        return False
    if str(t_market).upper() != target:
        return False
    return True


def format_recommendation_message(rank, ticker, name_ar, current_price, entry_low, entry_high,
                                   target1, target2, target3, stop, signal_ar):
    """تنسيق رسالة التوقعة مثل الجروبات الاحترافية"""
    
    message = f"""
{rank}- *{ticker} - {name_ar} آخر سعر {current_price}*
شراء من {entry_low} إلى {entry_high}
*هدف البيع {target1} ثم {target2}*
*هدف استثماري في {target3}*
استوب كسر {stop} إغلاق
"""
    return message.strip()


# ============================================================================
# V2 ANALYSIS ENDPOINT (Kimi's Improved Version)
# ============================================================================

@v2_bp.route('/api/v2/analysis/<ticker>', methods=['GET'])
def v2_analyze_stock(ticker):
    """
    V2 Analysis endpoint using Kimi's improved MasterAnalyzer.
    
    Key improvements:
    1. Liquidity First - Skip low-volume stocks
    2. Weighted Technical Scoring
    3. Sector-Relative Fundamental Analysis
    4. Session Dynamics (not "best hours")
    5. Adaptive Stop Loss
    6. Strict Thresholds: STRONG_BUY >= 80, BUY >= 65
    """
    try:
        ticker = ticker.upper()
        
        # Check if stock exists first
        stock = db.get_stock(ticker)
        if not stock:
            return jsonify({
                "success": False,
                "error": f"Stock '{ticker}' not found in database",
                "ticker": ticker,
                "suggestion": "تحقق من رمز السهم. البيانات قد تكون غير متاحة لهذا السوق."
            }), 404
        
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available",
                "fallback": "Use /api/analysis/<ticker> for legacy analysis"
            }), 503
        
        try:
            # Use the master analyzer
            result = master_analyzer.analyze(ticker)
            
            return jsonify({
                "success": True,
                "version": "2.0.0-kimi-improved",
                "data": result.to_dict()
            })
        except Exception as analysis_error:
            # If analysis fails, return basic stock info
            return jsonify({
                "success": True,
                "version": "2.0.0-limited",
                "warning": "تحليل محدود - البيانات غير كافية",
                "data": {
                    "ticker": ticker,
                    "name": stock.get('name'),
                    "name_ar": stock.get('name_ar'),
                    "current_price": stock.get('current_price'),
                    "signal": "HOLD",
                    "confidence": 0,
                    "warning": "البيانات التاريخية غير متاحة لهذا السهم"
                }
            })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# PERSONA ENGINE ENDPOINTS
# ============================================================================

@v2_bp.route('/api/personas', methods=['GET'])
def get_personas():
    """الحصول على كل الشخصيات المستثمرة."""
    try:
        from engine.persona_engine import persona_engine
        
        return jsonify({
            "success": True,
            "personas": persona_engine.get_all_personas_dict(),
            "count": len(persona_engine.get_all_personas())
        })
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/personas/<persona_type>', methods=['GET'])
def get_persona(persona_type):
    """الحصول على شخصية معينة."""
    try:
        from engine.persona_engine import persona_engine
        
        persona = persona_engine.get_persona(persona_type)
        if not persona:
            return jsonify({
                "success": False,
                "error": f"Persona '{persona_type}' not found"
            }), 404
        
        return jsonify({
            "success": True,
            "persona": persona.to_dict()
        })
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/personas/classify', methods=['POST'])
def classify_persona():
    """تصنيف المستخدم بناءً على إجابات الاستبيان."""
    try:
        from engine.persona_engine import persona_engine, PersonaType
        
        data = request.get_json() or {}
        answers = data.get('answers', {})
        
        persona_type = persona_engine.classify_user(answers)
        persona = persona_engine.get_persona(persona_type.value)
        
        return jsonify({
            "success": True,
            "classified_as": persona_type.value,
            "persona": persona.to_dict() if persona else None
        })
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# SCANNER BY PERSONA ENDPOINTS
# ============================================================================

@v2_bp.route('/api/v2/scanner/all-personas', methods=['GET'])
def scanner_all_personas():
    """
    Scanner لكل الشخصيات - مقارنة النتائج
    
    Returns:
        {
            "conservative": { "count": 0, "results": [] },
            "cautious": { "count": 2, "results": [...] },
            ...
            "gambler": { "count": 12, "results": [...] }
        }
    """
    try:
        from engine.persona_engine import persona_engine, PersonaType
        
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503
        
        limit = request.args.get('limit', 20, type=int)
        limit = min(limit, 50)  # Max 50 per persona (reasonable)
        use_cache = request.args.get('cache', 'true').lower() == 'true'
        
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Get all analysis results (cached or fresh)
        all_analysis = []
        if use_cache:
            all_analysis = db.get_all_cached_analysis(today)
        
        if not all_analysis:
            # Run fresh analysis
            results = master_analyzer.scan_market(limit=200)
            all_analysis = [r.to_dict() for r in results]
        
        # Define persona types
        persona_types = [
            'conservative', 'cautious', 'balanced', 
            'active_trader', 'adventurer', 'gambler', 'hedger'
        ]
        
        # Results per persona
        persona_results = {}
        
        for ptype in persona_types:
            persona = persona_engine.get_persona(ptype)
            if not persona:
                continue
            
            filtered_results = []
            
            for analysis in all_analysis:
                if not analysis.get('is_tradeable', True):
                    continue
                
                # FIXED: Recalculate master_score using persona-specific weights
                tech = analysis.get('technical_score', 50)
                fund = analysis.get('fundamental_score', 50)
                timing = analysis.get('timing_score', 50)
                pattern = analysis.get('pattern_score', 50)
                regime = analysis.get('market_regime_score', 50)
                sentiment = 50  # Default if not available
                
                persona_master_score = persona.recalculate_score(
                    technical_score=tech,
                    fundamental_score=fund,
                    timing_score=timing,
                    ai_pattern_score=pattern,
                    sentiment_score=sentiment,
                    market_regime_score=regime
                )
                
                adjusted_score = persona.get_adjusted_threshold(persona_master_score)
                signal = persona.get_signal(persona_master_score)
                
                # Only include actionable signals (not HOLD, not EXCLUDED)
                if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                    result_copy = analysis.copy()
                    result_copy['persona_adjusted'] = {
                        'original_score': analysis.get('master_score', 50),
                        'persona_weighted_score': round(persona_master_score, 2),
                        'adjusted_score': round(adjusted_score, 2),
                        'original_signal': analysis.get('signal'),
                        'adjusted_signal': signal
                    }
                    
                    # FIXED: Calculate persona-specific target/stop with FULL technical data
                    risk_profile = analysis.get('risk_profile', {})
                    entry_price = risk_profile.get('entry_price', 0) if risk_profile else 0
                    if not entry_price:
                        entry_price = analysis.get('current_price', 0)
                    
                    if entry_price and entry_price > 0:
                        # DYNAMIC: Pass actual stock volatility
                        stock_volatility = analysis.get('volatility_20d', 3.0)
                        if not stock_volatility or stock_volatility <= 0:
                            stock_volatility = risk_profile.get('stop_pct', 3.0) if risk_profile else 3.0
                        persona_targets = persona.calculate_persona_targets(
                            entry_price=entry_price,
                            score=persona_master_score,
                            support=risk_profile.get('support_level') if risk_profile else None,
                            resistance=risk_profile.get('resistance_level') if risk_profile else None,
                            volatility=stock_volatility,
                            atr=risk_profile.get('atr') if risk_profile else None,
                            atr_pct=risk_profile.get('atr_pct') if risk_profile else None,
                            high_30d=risk_profile.get('high_30d') if risk_profile else None,
                            low_30d=risk_profile.get('low_30d') if risk_profile else None,
                            bb_lower=risk_profile.get('bb_lower') if risk_profile else None,
                            bb_upper=risk_profile.get('bb_upper') if risk_profile else None,
                            zone=risk_profile.get('zone') if risk_profile else None,
                            candlestick_pattern=risk_profile.get('candlestick_pattern') if risk_profile else None,
                            candlestick_direction=risk_profile.get('candlestick_direction') if risk_profile else None,
                            ticker=ticker,
                            rsi=risk_profile.get('rsi') if risk_profile else None,
                            volume=risk_profile.get('volume') if risk_profile else None,
                            volume_sma_20=risk_profile.get('volume_sma_20') if risk_profile else None,
                            macd_histogram=risk_profile.get('macd_histogram') if risk_profile else None,
                            prev_macd_histogram=risk_profile.get('prev_macd_histogram') if risk_profile else None,
                            swing_low=risk_profile.get('swing_low') if risk_profile else None,
                            swing_high=risk_profile.get('swing_high') if risk_profile else None,
                        )
                        result_copy['persona_risk'] = persona_targets
                    
                    # Check R:R - prefer persona-calculated R:R
                    rr = 0
                    if result_copy.get('persona_risk', {}).get('risk_reward', 0):
                        rr = result_copy['persona_risk']['risk_reward']
                    else:
                        rr = risk_profile.get('risk_reward_ratio', 0) if risk_profile else 0
                    
                    # Add R:R validation
                    result_copy['rr_valid'] = rr >= 1.5
                    result_copy['risk_reward_ratio'] = rr
                    
                    filtered_results.append(result_copy)
            
            # FIXED: Sort by persona-specific sort key
            if persona.sort_primary == 'fundamental_score':
                filtered_results.sort(
                    key=lambda x: (
                        x.get('fundamental_score', 0),
                        x.get('persona_adjusted', {}).get('adjusted_score', 0)
                    ), reverse=True
                )
            elif persona.sort_primary == 'technical_score':
                filtered_results.sort(
                    key=lambda x: (
                        x.get('technical_score', 0),
                        x.get('persona_adjusted', {}).get('adjusted_score', 0)
                    ), reverse=True
                )
            else:
                filtered_results.sort(
                    key=lambda x: x.get('persona_adjusted', {}).get('adjusted_score', 0), 
                    reverse=True
                )
            
            persona_results[ptype] = {
                'persona_name': persona.name_ar,
                'emoji': persona.emoji,
                'buy_threshold': persona.thresholds.buy,
                'accumulate_threshold': persona.thresholds.accumulate,
                'scoring_weights': persona.scoring_weights.__dict__,
                'target_config': persona.target_config.__dict__,
                'sort_primary': persona.sort_primary,
                'count': len(filtered_results),
                'results': filtered_results[:limit]
            }
        
        # Summary
        summary = {
            ptype: data['count'] 
            for ptype, data in persona_results.items()
        }
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "total_analyzed": len(all_analysis),
            "summary": summary,
            "personas": persona_results
        })
        
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/v2/scanner/<persona_type>', methods=['GET'])
def scanner_by_persona(persona_type):
    """
    Scanner لشخصية معينة فقط مع دعم فلترة السوق

    🔥 FIXED: Returns ALL tradeable stocks, not just BUY signals
    - R:R validity is shown but doesn't filter
    - User decides what to do with the data
    - Market filtering supported

    Args:
        persona_type: conservative, cautious, balanced, active_trader, adventurer, gambler, hedger

    Query params:
    - market: Filter by market (EGX, TADAWUL, KSE, QSE, DFM, ADX)
    - limit: max results (default: 50)
    - cache: use cached data (default: true)
    """
    try:
        from engine.persona_engine import persona_engine

        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503

        persona = persona_engine.get_persona(persona_type)
        if not persona:
            return jsonify({
                "success": False,
                "error": f"Persona '{persona_type}' not found. Available: conservative, cautious, balanced, active_trader, adventurer, gambler, hedger"
            }), 404

        limit = request.args.get('limit', 50, type=int)
        limit = min(limit, 200)  # Max 200 instead of 50
        use_cache = request.args.get('cache', 'true').lower() == 'true'
        market = request.args.get('market', '').upper()

        today = datetime.now().strftime('%Y-%m-%d')

        # Helper function to get stock's market (normalized to frontend code)
        def get_stock_market(ticker_or_analysis):
            """Get market from ticker or analysis dict, normalized to frontend code"""
            if isinstance(ticker_or_analysis, dict):
                db_market = ticker_or_analysis.get('market', 'مصر')
            else:
                stock = db.get_stock(ticker_or_analysis)
                db_market = stock.get('market', 'مصر') if stock else 'مصر'
            
            # Convert database market name to frontend code
            return MARKET_MAP_REVERSE.get(db_market, db_market)

        # Convert frontend market code to database market name for filtering
        db_market = MARKET_MAP.get(market, market) if market else None

        # Get all analysis results
        all_analysis = []
        if use_cache:
            all_analysis = db.get_all_cached_analysis(today, market=db_market)

        if not all_analysis:
            results = master_analyzer.scan_market(limit=200)
            all_analysis = [r.to_dict() for r in results]

        # Fallback market filtering: when cache returns no rows because old
        # cached entries lack market data, fall back to non-market-filtered cache
        # and filter in Python using live stock market lookup.
        if market and db_market and not all_analysis:
            fallback_analysis = db.get_all_cached_analysis(today, market=None)
            if fallback_analysis:
                filtered_fallback = []
                for a in fallback_analysis:
                    a_market = a.get('market')
                    if not a_market and a.get('ticker'):
                        stock = db.get_stock(a['ticker'])
                        a_market = stock.get('market') if stock else None
                    if a_market == db_market:
                        filtered_fallback.append(a)
                all_analysis = filtered_fallback

        # Process ALL results - no signal filtering!
        filtered_results = []

        for analysis in all_analysis:
            if not analysis.get('is_tradeable', True):
                continue

            # STRICT market filter (defense-in-depth): reject Saudi numeric
            # tickers and known Kuwaiti/Gulf tickers that leak into EGX caches
            # when the cached_analysis.market field is NULL or wrong.
            if not _strict_market_filter(analysis, db_market, db_manager=db):
                continue

            # FIXED: Recalculate master_score using persona-specific weights
            tech = analysis.get('technical_score', 50)
            fund = analysis.get('fundamental_score', 50)
            timing = analysis.get('timing_score', 50)
            pattern = analysis.get('pattern_score', 50)
            regime = analysis.get('market_regime_score', 50)
            sentiment = 50  # Default if not available
            
            persona_master_score = persona.recalculate_score(
                technical_score=tech,
                fundamental_score=fund,
                timing_score=timing,
                ai_pattern_score=pattern,
                sentiment_score=sentiment,
                market_regime_score=regime
            )
            
            adjusted_score = persona.get_adjusted_threshold(persona_master_score)
            signal = persona.get_signal(persona_master_score)

            # Include ALL tradeable stocks
            result_copy = analysis.copy()
            result_copy['persona_adjusted'] = {
                'original_score': analysis.get('master_score', 50),
                'persona_weighted_score': round(persona_master_score, 2),
                'adjusted_score': round(adjusted_score, 2),
                'original_signal': analysis.get('signal'),
                'adjusted_signal': signal
            }

            # Add market info
            result_copy['market'] = get_stock_market(analysis)

            # FIXED: Calculate persona-specific target/stop with FULL technical data
            risk_profile = analysis.get('risk_profile', {})
            entry_price = risk_profile.get('entry_price', 0) if risk_profile else 0
            if not entry_price:
                entry_price = analysis.get('current_price', 0)
            
            if entry_price and entry_price > 0:
                # DYNAMIC: Pass actual stock volatility
                stock_volatility = analysis.get('volatility_20d', 3.0)
                if not stock_volatility or stock_volatility <= 0:
                    stock_volatility = risk_profile.get('stop_pct', 3.0) if risk_profile else 3.0
                persona_targets = persona.calculate_persona_targets(
                    entry_price=entry_price,
                    score=persona_master_score,
                    support=risk_profile.get('support_level') if risk_profile else None,
                    resistance=risk_profile.get('resistance_level') if risk_profile else None,
                    volatility=stock_volatility,
                    atr=risk_profile.get('atr') if risk_profile else None,
                    atr_pct=risk_profile.get('atr_pct') if risk_profile else None,
                    high_30d=risk_profile.get('high_30d') if risk_profile else None,
                    low_30d=risk_profile.get('low_30d') if risk_profile else None,
                    bb_lower=risk_profile.get('bb_lower') if risk_profile else None,
                    bb_upper=risk_profile.get('bb_upper') if risk_profile else None,
                    zone=risk_profile.get('zone') if risk_profile else None,
                    candlestick_pattern=risk_profile.get('candlestick_pattern') if risk_profile else None,
                    candlestick_direction=risk_profile.get('candlestick_direction') if risk_profile else None,
                    ticker=ticker,
                    rsi=risk_profile.get('rsi') if risk_profile else None,
                    volume=risk_profile.get('volume') if risk_profile else None,
                    volume_sma_20=risk_profile.get('volume_sma_20') if risk_profile else None,
                    macd_histogram=risk_profile.get('macd_histogram') if risk_profile else None,
                    prev_macd_histogram=risk_profile.get('prev_macd_histogram') if risk_profile else None,
                    swing_low=risk_profile.get('swing_low') if risk_profile else None,
                    swing_high=risk_profile.get('swing_high') if risk_profile else None,
                )
                result_copy['persona_risk'] = persona_targets

            # R:R info - prefer persona-calculated R:R
            rr = 0
            if result_copy.get('persona_risk', {}).get('risk_reward', 0):
                rr = result_copy['persona_risk']['risk_reward']
            else:
                rr = risk_profile.get('risk_reward_ratio', 0) if risk_profile else 0
            result_copy['rr_valid'] = rr >= 1.5
            result_copy['risk_reward_ratio'] = rr

            filtered_results.append(result_copy)

        # FIXED: Sort by persona-specific sort key
        if persona.sort_primary == 'fundamental_score':
            filtered_results.sort(
                key=lambda x: (
                    x.get('fundamental_score', 0),
                    x.get('persona_adjusted', {}).get('adjusted_score', 0)
                ), reverse=True
            )
        elif persona.sort_primary == 'technical_score':
            filtered_results.sort(
                key=lambda x: (
                    x.get('technical_score', 0),
                    x.get('persona_adjusted', {}).get('adjusted_score', 0)
                ), reverse=True
            )
        else:
            filtered_results.sort(
                key=lambda x: x.get('persona_adjusted', {}).get('adjusted_score', 0),
                reverse=True
            )

        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "market_filter": market if market else None,
            "persona": {
                "type": persona_type,
                "name": persona.name_ar,
                "emoji": persona.emoji,
                "buy_threshold": persona.thresholds.buy,
                "accumulate_threshold": persona.thresholds.accumulate,
                "scoring_weights": persona.scoring_weights.__dict__,
                "target_config": persona.target_config.__dict__,
                "sort_primary": persona.sort_primary
            },
            "total_analyzed": len(all_analysis),
            "matching_count": len(filtered_results),
            "results": filtered_results[:limit]
        })

    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# DAILY PERSONA ANALYSIS ENDPOINTS
# ============================================================================

@v2_bp.route('/api/v2/admin/run-daily-persona-analysis', methods=['POST'])
def run_daily_persona_analysis():
    """
    تشغيل التحليل اليومي لكل الشخصيات (7 شخصيات)
    
    This should be run ONCE per day (e.g., at 8 AM Cairo time)
    Results are cached for each persona
    
    Returns:
        {
            "conservative": { "count": 0, "results": [...] },
            "cautious": { "count": 2, "results": [...] },
            ...
        }
    """
    try:
        from engine.persona_engine import persona_engine
        
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503
        
        start_time = time.time()
        today = datetime.now().strftime('%Y-%m-%d')
        
        print(f"\n{'='*60}")
        print(f"🔄 Starting Daily Persona Analysis for {today}")
        print(f"{'='*60}")
        
        # Run fresh analysis for ALL stocks
        print("📊 Running market scan for all tradeable stocks...")
        all_results = master_analyzer.scan_market(limit=200)
        all_analysis = [r.to_dict() for r in all_results]
        
        print(f"✅ Analyzed {len(all_analysis)} stocks")
        
        # Define persona types
        persona_types = [
            'conservative', 'cautious', 'balanced', 
            'active_trader', 'adventurer', 'gambler', 'hedger'
        ]
        
        # Results per persona
        persona_results = {}
        
        for ptype in persona_types:
            persona = persona_engine.get_persona(ptype)
            if not persona:
                continue
            
            filtered_results = []
            
            for analysis in all_analysis:
                if not analysis.get('is_tradeable', True):
                    continue
                
                master_score = analysis.get('master_score', 50)
                adjusted_score = persona.get_adjusted_threshold(master_score)
                signal = persona.get_signal(master_score)
                
                # Only include actionable signals
                if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                    result_copy = analysis.copy()
                    result_copy['persona_adjusted'] = {
                        'original_score': master_score,
                        'adjusted_score': adjusted_score,
                        'original_signal': analysis.get('signal'),
                        'adjusted_signal': signal
                    }
                    
                    # Check R:R
                    risk_profile = analysis.get('risk_profile', {})
                    rr = risk_profile.get('risk_reward_ratio', 0) if risk_profile else 0
                    result_copy['rr_valid'] = rr >= 1.5
                    result_copy['risk_reward_ratio'] = rr
                    
                    filtered_results.append(result_copy)
            
            # Sort by adjusted score
            filtered_results.sort(
                key=lambda x: x.get('persona_adjusted', {}).get('adjusted_score', 0), 
                reverse=True
            )
            
            # Store in database cache
            cache_key = f"persona_{ptype}_{today}"
            db.save_cached_analysis(f"PERSONA_{ptype.upper()}", {
                'persona_type': ptype,
                'persona_name': persona.name_ar,
                'buy_threshold': persona.thresholds.buy,
                'accumulate_threshold': persona.thresholds.accumulate,
                'count': len(filtered_results),
                'results': filtered_results[:50],  # Top 50 per persona
                'analyzed_at': datetime.now().isoformat()
            }, today)
            
            persona_results[ptype] = {
                'persona_name': persona.name_ar,
                'emoji': persona.emoji,
                'buy_threshold': persona.thresholds.buy,
                'count': len(filtered_results)
            }
            
            print(f"  {persona.emoji} {persona.name_ar}: {len(filtered_results)} opportunities")
        
        elapsed = time.time() - start_time
        
        print(f"\n✅ Daily Persona Analysis Complete in {elapsed:.1f}s")
        print(f"{'='*60}\n")
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "date": today,
            "elapsed_seconds": round(elapsed, 1),
            "total_analyzed": len(all_analysis),
            "personas": persona_results
        })
        
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        print(f"Error in daily persona analysis: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/v2/persona/<persona_type>/cached', methods=['GET'])
def get_cached_persona_results(persona_type):
    """
    الحصول على نتائج الشخصية المحفوظة (من التحليل اليومي)
    
    This is FAST because results are already cached
    """
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Get cached results
        cached = db.get_cached_analysis(f"PERSONA_{persona_type.upper()}", today)
        
        if not cached:
            return jsonify({
                "success": False,
                "error": f"No cached results for {persona_type}. Run /api/v2/admin/run-daily-persona-analysis first."
            }), 404
        
        return jsonify({
            "success": True,
            "from_cache": True,
            "data": cached
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/v2/persona/status', methods=['GET'])
def get_persona_analysis_status():
    """
    حالة التحليل اليومي للشخصيات
    """
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        
        persona_types = ['conservative', 'cautious', 'balanced', 'active_trader', 'adventurer', 'gambler', 'hedger']
        
        status = {}
        for ptype in persona_types:
            cached = db.get_cached_analysis(f"PERSONA_{ptype.upper()}", today)
            status[ptype] = {
                "cached": cached is not None,
                "count": cached.get('count', 0) if cached else 0
            }
        
        all_cached = all(s["cached"] for s in status.values())
        
        return jsonify({
            "success": True,
            "date": today,
            "all_personas_cached": all_cached,
            "status": status
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# MORNING RECOMMENDATIONS ENDPOINT
# ============================================================================

@v2_bp.route('/api/v2/morning-recommendations', methods=['GET'])
def morning_recommendations():
    """
    توقعات صباحية للمستخدم العادي
    
    🔥 FIXED: Now uses same logic as scanner
    - Returns top stocks sorted by master_score
    - No strict R:R filtering
    - Node.js just displays, Python decides
    
    Returns top 5 stocks with:
    - سعر الدخول (Entry)
    - أهداف متدرجة (Target 1, 2, 3)
    - وقف الخسارة (Stop Loss)
    - تنسيق احترافي مثل الجروبات المدفوعة
    """
    try:
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503
        
        # Get today's date
        today = datetime.now()
        today_str = today.strftime("%Y-%m-%d")
        day_names = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]
        day_name = day_names[today.weekday()]
        date_ar = f"{day_name} الموافق {today.day}-{today.month}-{today.year}"
        
        # Use cached analysis first
        all_analysis = db.get_all_cached_analysis(today_str)
        
        if not all_analysis:
            # Fall back to scan_market (now without strict filters!)
            results = master_analyzer.scan_market(limit=200)
            all_analysis = [r.to_dict() for r in results]
        
        # FIX (Aug 2026): Strict EGX market filter — DEFENSE-IN-DEPTH.
        # Without this, Saudi numeric tickers (2120, 3002) and known Kuwaiti/
        # Gulf symbols (RASIYAT, OOREDOO, AAYANRE, NBK, ZAIN, ...) leak into
        # the EGX morning recommendations screen when cached_analysis.market
        # is NULL or polluted. This is the user's #1 complaint.
        # Hard-reject any ticker that is_saudi (pure digits) or is_kuwait
        # (matches _KUWAIT_GULF_TICKERS set) when no explicit market is requested.
        all_analysis = [
            a for a in all_analysis
            if _strict_market_filter(a, 'EGX', db_manager=db)
        ]
        
        # Sort by master_score and take top 5
        all_analysis.sort(key=lambda x: x.get('master_score', 0), reverse=True)
        top_picks = all_analysis[:5]
        
        # Format recommendations
        recommendations = []
        for i, stock in enumerate(top_picks, 1):
            ticker = stock.get('ticker', '')
            stock_info = db.get_stock(ticker) if ticker else None
            name_ar = stock_info.get('name_ar', stock_info.get('name', '')) if stock_info else ''

            # Get current price from stocks.db for fresh entry/target/stop
            current_price = 0.0
            if stock_info:
                current_price = float(stock_info.get('current_price', 0) or 0)

            # Recalculate entry/target/stop from current price instead of using stale stored values
            signal = stock.get('signal', 'HOLD')
            is_buy = signal in ('STRONG_BUY', 'BUY', 'ACCUMULATE', 't1_buy', 'swing_buy')
            if is_buy and current_price > 0:
                entry = round(current_price * 0.995, 3)
                if signal == 't1_buy':
                    sl_pct, tp_pct = 8.0, 4.0
                elif signal == 'swing_buy':
                    sl_pct, tp_pct = 8.0, 10.0
                else:
                    sl_pct, tp_pct = 8.0, 10.0
                stop = round(entry * (1 - sl_pct / 100), 3)
                target1 = round(entry * (1 + tp_pct / 100), 3)
            else:
                entry = round(current_price, 3) if current_price > 0 else 0
                stop = round(entry * 0.92, 3) if entry > 0 else 0
                target1 = round(entry * 1.10, 3) if entry > 0 else 0

            risk_amount = entry - stop
            target2 = round(entry + (risk_amount * 2.0), 3) if risk_amount > 0 else round(target1 * 1.15, 3)
            target3 = round(entry + (risk_amount * 3.5), 3) if risk_amount > 0 else round(target1 * 1.30, 3)

            # Entry range
            entry_low = round(entry * 0.99, 3)
            entry_high = round(entry * 1.01, 3)

            # Rule 54: استخدم canonical compute_risk_reward
            _rr_v2 = round((target1 - entry) / (entry - stop), 2) if (entry > 0 and stop > 0 and entry > stop) else 1.5
            try:
                from utils.risk_reward import compute_risk_reward
                _rr_v2 = compute_risk_reward(entry, target1, stop, fallback=_rr_v2)
            except Exception:
                pass  # keep inline _rr_v2 computed above

            # Signal strength description
            if signal == 'STRONG_BUY':
                signal_strength = "فرصة قوية جداً"
                signal_emoji = "🔥"
            elif signal == 'BUY':
                signal_strength = "فرصة جيدة"
                signal_emoji = "✅"
            else:
                signal_strength = "تجميع تدريجي"
                signal_emoji = "📈"

            recommendation = {
                "rank": i,
                "ticker": ticker,
                "name_ar": name_ar,
                "current_price": round(current_price, 3) if current_price > 0 else round(entry, 3),
                "signal": signal,
                "signal_ar": stock.get('signal_ar', 'احتفاظ'),
                "signal_strength": signal_strength,
                "signal_emoji": signal_emoji,
                "master_score": round(stock.get('master_score', 50), 1),
                "confidence": round(stock.get('confidence', 50), 1),
                "liquidity_level": stock.get('liquidity_level', 'MEDIUM'),

                # Entry
                "entry": {
                    "primary": round(entry, 3),
                    "range_low": entry_low,
                    "range_high": entry_high,
                    "description": f"شراء من {entry_low} إلى {entry_high}"
                },

                # Targets
                "targets": {
                    "target_1": {
                        "price": round(target1, 3),
                        "pct": round((target1 - entry) / entry * 100, 1) if entry > 0 else 0,
                        "description": "هدف البيع الأول"
                    },
                    "target_2": {
                        "price": round(target2, 3),
                        "pct": round((target2 - entry) / entry * 100, 1) if entry > 0 else 0,
                        "description": "هدف البيع الثاني"
                    },
                    "target_3": {
                        "price": round(target3, 3),
                        "pct": round((target3 - entry) / entry * 100, 1) if entry > 0 else 0,
                        "description": "هدف استثماري"
                    }
                },

                # Stop Loss
                "stop_loss": {
                    "price": round(stop, 3),
                    "pct": round(sl_pct if is_buy else 8.0, 1),
                    "description": f"استوب كسر {round(stop, 3)} إغلاق"
                },

                # Risk/Reward
                "risk_reward_ratio": _rr_v2,

                # Technical summary
                "technical_summary": stock.get('technical_summary', ''),

                # Time horizon
                "time_stop_days": 30,
                
                # Full formatted message
                "formatted_message": format_recommendation_message(
                    rank=i,
                    ticker=ticker,
                    name_ar=name_ar,
                    current_price=round(current_price, 3) if current_price > 0 else round(entry, 3),
                    entry_low=entry_low,
                    entry_high=entry_high,
                    target1=round(target1, 3),
                    target2=round(target2, 3),
                    target3=round(target3, 3),
                    stop=round(stop, 3),
                    signal_ar=stock.get('signal_ar', 'احتفاظ')
                )
            }
            
            recommendations.append(recommendation)
        
        # Build response
        response = {
            "success": True,
            "version": "2.0.0",
            "timestamp": datetime.now().isoformat(),
            "date_ar": date_ar,
            "title": f"صباح الخيرات - توقعات صباحية لجلسة {date_ar} بإذن الله",
            "summary": {
                "total_analyzed": len(all_analysis),
                "opportunities_found": len([s for s in all_analysis if s.get('signal') in ['STRONG_BUY', 'BUY', 'ACCUMULATE']]),
                "recommendations_count": len(recommendations)
            },
            "recommendations": recommendations,
            "disclaimer": "هذا تحليل بيانات تعليمي فقط. ليس توقعة استثمارية. استشر مستشار مالي مرخص."
        }
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# CACHED ANALYSIS ENDPOINTS
# ============================================================================

@v2_bp.route('/api/v2/cached-scanner', methods=['GET'])
def cached_scanner():
    """
    Scanner يستخدم البيانات المحفوظة في الكاش
    إذا لم يوجد كاش لليوم، يقوم بتحليل جديد
    """
    try:
        limit = request.args.get('limit', 100, type=int)
        force_refresh = request.args.get('force', 'false').lower() == 'true'
        
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Check if we have cached data for today
        cache_status = db.get_cache_status()
        
        if not force_refresh and cache_status.get('has_cache'):
            # Use cached data
            cached_results = db.get_all_cached_analysis(today)
            
            if cached_results:
                # Sort by master_score
                cached_results.sort(key=lambda x: x.get('master_score', 0), reverse=True)
                
                return jsonify({
                    "success": True,
                    "version": "2.0.0-cached",
                    "timestamp": datetime.now().isoformat(),
                    "analysis_date": today,
                    "from_cache": True,
                    "stocks_analyzed": len(cached_results),
                    "results": cached_results[:limit]
                })
        
        # No cache or force refresh - run fresh analysis
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503
        
        # Run fresh scan (remove the limit=50 cap)
        all_tickers = master_analyzer._get_all_tickers()
        results = []
        
        # Filter by liquidity first
        tradeable, _ = master_analyzer.liquidity_filter.filter_stocks(all_tickers)
        
        for ticker in tradeable:
            try:
                analysis = master_analyzer.analyze(ticker)
                analysis_dict = analysis.to_dict()
                
                # Save to cache
                db.save_cached_analysis(ticker, analysis_dict, today)
                
                if analysis.is_tradeable:
                    results.append(analysis_dict)
            except:
                continue
        
        # Sort by master_score
        results.sort(key=lambda x: x.get('master_score', 0), reverse=True)
        
        return jsonify({
            "success": True,
            "version": "2.0.0-fresh",
            "timestamp": datetime.now().isoformat(),
            "analysis_date": today,
            "from_cache": False,
            "stocks_analyzed": len(results),
            "results": results[:limit]
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/v2/cached-analysis/<ticker>', methods=['GET'])
def cached_analysis(ticker):
    """
    تحليل سهم من الكاش أو تحليل جديد إذا غير موجود
    """
    try:
        ticker = ticker.upper()
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Check if stock exists first
        stock = db.get_stock(ticker)
        if not stock:
            return jsonify({
                "success": False,
                "error": f"Stock '{ticker}' not found in database",
                "ticker": ticker,
                "suggestion": "تحقق من رمز السهم. البيانات قد تكون غير متاحة لهذا السوق."
            }), 404
        
        # Check cache first
        cached = db.get_cached_analysis(ticker, today)
        
        if cached:
            return jsonify({
                "success": True,
                "version": "2.0.0-cached",
                "from_cache": True,
                "analysis_date": today,
                "data": cached
            })
        
        # No cache - run fresh analysis
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503
        
        try:
            analysis = master_analyzer.analyze(ticker)
            analysis_dict = analysis.to_dict()
            
            # Save to cache
            db.save_cached_analysis(ticker, analysis_dict, today)
            
            return jsonify({
                "success": True,
                "version": "2.0.0-fresh",
                "from_cache": False,
                "analysis_date": today,
                "data": analysis_dict
            })
        except Exception as analysis_error:
            # If analysis fails, return a basic response
            return jsonify({
                "success": True,
                "version": "2.0.0-limited",
                "from_cache": False,
                "warning": "تحليل محدود - البيانات غير كافية",
                "data": {
                    "ticker": ticker,
                    "name": stock.get('name'),
                    "name_ar": stock.get('name_ar'),
                    "current_price": stock.get('current_price'),
                    "signal": "HOLD",
                    "confidence": 0,
                    "warning": "البيانات التاريخية غير متاحة لهذا السهم"
                }
            })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/v2/scanner', methods=['GET'])
def v2_scanner():
    """
    V2 Scanner - Complete market analysis with market filtering

    Query params:
    - market: Filter by market (EGX, TADAWUL, KSE, QSE, DFM, ADX)
    - limit: max results (default: 500)
    - cache: use cached data (default: true)
    - filter_opportunities: only show BUY signals (default: false)
    - min_rr: minimum R:R ratio (default: 0, set to 1.5 for strict)
    """
    try:
        if not master_analyzer:
            return jsonify({
                "success": False,
                "error": "MasterAnalyzer not available"
            }), 503

        limit = request.args.get('limit', 500, type=int)
        use_cache = request.args.get('cache', 'true').lower() == 'true'
        filter_opportunities = request.args.get('filter_opportunities', 'false').lower() == 'true'
        min_rr = request.args.get('min_rr', 0, type=float)
        market = request.args.get('market', '').upper()

        today = datetime.now().strftime('%Y-%m-%d')

        # Helper function to get stock's market (normalized to frontend code)
        def get_stock_market(ticker_or_analysis):
            """Get market from ticker or analysis dict, normalized to frontend code"""
            if isinstance(ticker_or_analysis, dict):
                db_market = ticker_or_analysis.get('market', 'مصر')
            else:
                stock = db.get_stock(ticker_or_analysis)
                db_market = stock.get('market', 'مصر') if stock else 'مصر'
            
            # Convert database market name to frontend code
            return MARKET_MAP_REVERSE.get(db_market, db_market)

        # Convert frontend market code to database market name for filtering
        db_market = MARKET_MAP.get(market, market) if market else None

        # Check cache if enabled
        if use_cache:
            cached_results = db.get_all_cached_analysis(today, market=db_market)
            if not cached_results and db_market:
                cached_results = db.get_all_cached_analysis(today, market=None)
                if cached_results:
                    # STRICT defense-in-depth filter: reject Saudi numeric
                    # tickers + known Kuwaiti/Gulf tickers that leak when the
                    # cached_analysis.market field is NULL or wrong.
                    cached_results = [
                        r for r in cached_results
                        if _strict_market_filter(r, db_market, db_manager=db)
                    ]
            elif cached_results and db_market:
                # FIX (Aug 2026): Even when the DB returns rows for the requested
                # market, re-apply the strict filter to catch any ticker whose
                # market column was polluted with 'EGX' but is actually Saudi/Gulf.
                cached_results = [
                    r for r in cached_results
                    if _strict_market_filter(r, db_market, db_manager=db)
                ]

                # Apply filters if requested
                if filter_opportunities:
                    cached_results = [r for r in cached_results
                                    if r.get('signal') in ['STRONG_BUY', 'BUY', 'ACCUMULATE']]

                if min_rr > 0:
                    cached_results = [r for r in cached_results
                                    if r.get('risk_profile', {}).get('risk_reward_ratio', 0) >= min_rr]

                cached_results.sort(key=lambda x: x.get('master_score', 0), reverse=True)

                return jsonify({
                    "success": True,
                    "version": "2.0.0-cached",
                    "timestamp": datetime.now().isoformat(),
                    "from_cache": True,
                    "market_filter": market if market else None,
                    "stocks_analyzed": len(cached_results),
                    "summary": {
                        "total_stocks": len(cached_results),
                        "buy_signals": len([r for r in cached_results if r.get('signal') in ['STRONG_BUY', 'BUY']]),
                        "sell_signals": len([r for r in cached_results if r.get('signal') in ['SELL', 'STRONG_SELL']]),
                        "hold_signals": len([r for r in cached_results if r.get('signal') == 'HOLD'])
                    },
                    "results": cached_results[:limit]
                })

        # No cache - run fresh analysis for tradeable stocks
        # Get all tickers
        all_tickers = master_analyzer._get_all_tickers()

        # Apply market filter if specified
        if db_market:
            # Get stocks for this market (use database market name)
            market_stocks = db.get_all_stocks(market=db_market)
            market_tickers = set(s.get('ticker') for s in market_stocks)
            tickers = [t for t in all_tickers if t in market_tickers]
        else:
            tickers = all_tickers

        tradeable, excluded = master_analyzer.liquidity_filter.filter_stocks(tickers)

        print(f"[V2 Scanner] Analyzing {len(tradeable)} tradeable stocks for market: {market or 'ALL'}...")

        results = []
        for ticker in tradeable:
            try:
                analysis = master_analyzer.analyze(ticker)
                analysis_dict = analysis.to_dict()

                # Add market to analysis
                analysis_dict['market'] = get_stock_market(ticker)

                # Save to cache
                db.save_cached_analysis(ticker, analysis_dict, today)

                # Include ALL results (not just opportunities)
                if analysis.is_tradeable:
                    # Apply optional filters
                    if filter_opportunities and analysis.signal not in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                        continue

                    if min_rr > 0 and analysis.risk_profile:
                        rr = analysis.risk_profile.get('risk_reward_ratio', 0)
                        if rr < min_rr:
                            continue

                    results.append(analysis_dict)
            except Exception as e:
                print(f"[V2 Scanner] Error analyzing {ticker}: {e}")
                continue

        # Sort by master_score
        results.sort(key=lambda x: x.get('master_score', 0), reverse=True)

        print(f"[V2 Scanner] Completed: {len(results)} stocks analyzed for market: {market or 'ALL'}")

        return jsonify({
            "success": True,
            "version": "2.0.0-kimi-improved",
            "timestamp": datetime.now().isoformat(),
            "from_cache": False,
            "market_filter": market if market else None,
            "stocks_analyzed": len(results),
            "summary": {
                "total_stocks": len(results),
                "buy_signals": len([r for r in results if r.get('signal') in ['STRONG_BUY', 'BUY']]),
                "sell_signals": len([r for r in results if r.get('signal') in ['SELL', 'STRONG_SELL']]),
                "hold_signals": len([r for r in results if r.get('signal') == 'HOLD'])
            },
            "results": results[:limit]
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# PERSONA-BASED ANALYSIS
# ============================================================================

@v2_bp.route('/api/v2/persona-analysis/<persona_type>', methods=['GET'])
def persona_based_analysis(persona_type):
    """
    تحليل مبني على نوع الشخصية المستثمر
    
    الشخصيات المتاحة:
    - conservative: المحافظ
    - cautious: المتوسط الحذر
    - balanced: المتوازن
    - active_trader: المضارب المنتظم
    - adventurer: المغامر
    - gambler: المقامر المحسن
    - hedger: المتحوط المؤسسي
    """
    try:
        from engine.persona_engine import persona_engine
        
        market = request.args.get('market', 'EGX')
        db_market = MARKET_MAP.get(market.upper(), 'EGX') if market else 'EGX'

        # Get persona
        persona = persona_engine.get_persona(persona_type)
        if not persona:
            return jsonify({
                "success": False,
                "error": f"Persona '{persona_type}' not found. Available: conservative, cautious, balanced, active_trader, adventurer, gambler, hedger"
            }), 404
        
        # Get cached analysis
        today = datetime.now().strftime('%Y-%m-%d')
        all_analysis_raw = db.get_all_cached_analysis(today)
        
        if not all_analysis_raw:
            # No cache - run analysis first
            if not master_analyzer:
                return jsonify({
                    "success": False,
                    "error": "No cached analysis and MasterAnalyzer not available"
                }), 503
            
            tickers = master_analyzer._get_all_tickers()
            tradeable, _ = master_analyzer.liquidity_filter.filter_stocks(tickers)
            
            for ticker in tradeable:
                try:
                    analysis = master_analyzer.analyze(ticker)
                    analysis_dict = analysis.to_dict()
                    db.save_cached_analysis(ticker, analysis_dict, today)
                    all_analysis_raw.append(analysis_dict)
                except:
                    continue

        # Strict market filter (EGX vs KSE vs TADAWUL) — uses the centralized
        # _strict_market_filter helper so all endpoints share the same logic.
        all_analysis = [
            a for a in all_analysis_raw
            if _strict_market_filter(a, db_market, db_manager=db)
        ]
        
        # Apply persona adjustments
        persona_results = []
        for analysis in all_analysis:
            if not analysis.get('is_tradeable', True):
                continue
            
            # Get adjusted signal based on persona
            original_score = analysis.get('master_score', 50)
            adjusted_score = persona.get_adjusted_threshold(original_score)
            adjusted_signal = persona.get_signal(original_score)
            
            # Only include if persona's adjusted signal matches
            analysis_copy = analysis.copy()
            analysis_copy['persona_adjusted'] = {
                'original_score': original_score,
                'adjusted_score': adjusted_score,
                'original_signal': analysis.get('signal'),
                'adjusted_signal': adjusted_signal
            }
            
            # Filter based on persona preferences
            # Conservative: Only STRONG_BUY and BUY
            if persona.persona_type.value == 'conservative':
                if adjusted_signal in ['STRONG_BUY', 'BUY']:
                    persona_results.append(analysis_copy)
            # Gambler: Include ACCUMULATE and above
            elif persona.persona_type.value == 'gambler':
                if adjusted_signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                    persona_results.append(analysis_copy)
            # Default: STRONG_BUY, BUY, ACCUMULATE
            else:
                if adjusted_signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                    persona_results.append(analysis_copy)
        
        # Sort by adjusted score
        persona_results.sort(
            key=lambda x: x.get('persona_adjusted', {}).get('adjusted_score', 0), 
            reverse=True
        )
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "persona": persona.to_dict(),
            "total_matching": len(persona_results),
            "results": persona_results[:20]  # Top 20 for this persona
        })
        
    except ImportError:
        return jsonify({
            "success": False,
            "error": "Persona engine not available"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_bp.route('/api/v2/predictions', methods=['GET'])
def v2_list_predictions():
    try:
        limit = int(request.args.get('limit', 50))
        signal = request.args.get('signal') or request.args.get('type')
        market = request.args.get('market')
        
        where_clauses = []
        params = []
        
        if signal and signal.upper() != 'ALL':
            where_clauses.append("signal_type = ?")
            params.append(signal.upper())
        if market:
            # Map frontend market code to DB code
            db_market = MARKET_MAP.get(market.upper(), market.upper())
            where_clauses.append("market = ?")
            params.append(db_market)
            
        where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        
        from api.ai_predictions_routes import query_db, PREDICTIONS_DB, get_current_price, execute_db
        
        query = f"""
            SELECT * FROM aiPrediction 
            {where}
            ORDER BY prediction_date DESC, maestro_score DESC
            LIMIT ?
        """
        predictions = query_db(PREDICTIONS_DB, query, tuple(params + [limit]))
        
        # FIX (Aug 2026): Strict market filter on the Python side too.
        # aiPrediction.market may be polluted (NULL or wrong) which leaks
        # Saudi/Kuwaiti predictions into EGX-only requests.
        if market:
            db_market_check = MARKET_MAP.get(market.upper(), market.upper())
            predictions = [
                p for p in predictions
                if _strict_market_filter(dict(p), db_market_check, db_manager=db)
            ]
        
        updated_preds = []
        for pred in predictions:
            pred_dict = dict(pred)
            pred_dict['ticker'] = pred_dict.get('stock_symbol')
            pred_dict['signal'] = pred_dict.get('signal_type')
            
            if pred_dict.get('status') == 'PENDING':
                symbol = pred_dict.get('stock_symbol')
                curr_price = get_current_price(symbol)
                if curr_price is not None:
                    pred_dict['current_price'] = curr_price
                    entry_price = float(pred_dict['entry_price'])
                    target_price = float(pred_dict['target_price']) if pred_dict.get('target_price') else None
                    stop_loss = float(pred_dict['stop_loss']) if pred_dict.get('stop_loss') else None
                    signal_type = pred_dict['signal_type']
                    
                    new_status = 'PENDING'
                    profit_loss_percent = 0.0
                    hit_target = 0
                    hit_stop_loss = 0
                    
                    if signal_type == 'BUY':
                        profit_loss_percent = ((curr_price - entry_price) / entry_price) * 100
                        if target_price and curr_price >= target_price:
                            new_status = 'TARGET_HIT'
                            hit_target = 1
                        elif stop_loss and curr_price <= stop_loss:
                            new_status = 'STOPPED'
                            hit_stop_loss = 1
                    elif signal_type == 'SELL':
                        profit_loss_percent = ((entry_price - curr_price) / entry_price) * 100
                        if target_price and curr_price <= target_price:
                            new_status = 'TARGET_HIT'
                            hit_target = 1
                        elif stop_loss and curr_price >= stop_loss:
                            new_status = 'STOPPED'
                            hit_stop_loss = 1
                            
                    pred_dict['profit_loss_percent'] = round(profit_loss_percent, 2)
                    
                    if new_status != 'PENDING':
                        pred_dict['status'] = new_status
                        pred_dict['hit_target'] = hit_target
                        pred_dict['hit_stop_loss'] = hit_stop_loss
                        pred_dict['final_price'] = curr_price
                        try:
                            execute_db(PREDICTIONS_DB, """
                                UPDATE aiPrediction SET
                                    status = ?,
                                    hit_target = ?,
                                    hit_stop_loss = ?,
                                    final_price = ?,
                                    profit_loss_percent = ?,
                                    updated_at = datetime('now')
                                WHERE id = ?
                            """, (new_status, hit_target, hit_stop_loss, curr_price, round(profit_loss_percent, 2), pred_dict['id']))
                        except Exception as e_db:
                            print(f"[v2 Predictions] Error updating prediction status: {e_db}")
            else:
                pred_dict['current_price'] = pred_dict.get('final_price')
                
            updated_preds.append(pred_dict)
            
        avg_score = 0
        if updated_preds:
            avg_score = sum(p.get('maestro_score', 50) or 50 for p in updated_preds) / len(updated_preds)
            
        return jsonify({
            'success': True,
            'predictions': updated_preds,
            'stats': {
                'avg_score': round(avg_score, 2),
                'total': len(updated_preds)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@v2_bp.route('/api/v2/predictions', methods=['POST'])
def v2_generate_predictions():
    try:
        from api.ai_predictions_routes import generate_predictions_internal
        data = request.get_json() or {}
        market = data.get('market', 'EGX')
        min_score = float(data.get('min_score', 60))
        success, result = generate_predictions_internal(market=market, min_score=min_score, use_cached=True)
        if success:
            return jsonify({'success': True, 'predictions': result})
        else:
            return jsonify({'success': False, 'error': result}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# MAIN RECOMMENDATIONS ENDPOINT — يُستدعى من صفحة التوصيات في الـ frontend
# ============================================================================

@v2_bp.route('/api/v2/recommend', methods=['GET'])
def v2_recommend():
    """
    الـ endpoint الرئيسي لصفحة التوصيات.
    يقرأ من stored_analyses ويُرجع بيانات حية محدثة مع كل طلب.
    
    Query params:
      - persona: gambler | investor | analyst (اختياري)
      - market:  EGX | SAX | all              (اختياري، default=EGX)
      - limit:   عدد الأسهم                  (اختياري، default=50)
    """
    import sqlite3
    from pathlib import Path
    from datetime import datetime

    try:
        persona   = request.args.get('persona', 'gambler').lower()
        market    = request.args.get('market', 'EGX').upper()
        limit     = request.args.get('limit', 50, type=int)

        _root = Path(__file__).resolve().parent.parent.parent
        _pdb  = str(_root / 'db' / 'predictions.db')
        _sdb  = str(_root / 'db' / 'stocks.db')

        # FIX (Aug 2026): Use safe_connect to enforce timeout=30 + busy_timeout=30000
        # so concurrent writers don't cause 'database is locked' on /api/v2/recommend.
        try:
            from core.database import safe_connect
        except ImportError:
            def safe_connect(p, readonly=False, timeout=30.0):
                import sqlite3 as _s
                return _s.connect(p, timeout=timeout)

        conn = safe_connect(_pdb, readonly=False)
        conn.row_factory = sqlite3.Row

        # بناء الـ query بناءً على الـ persona
        # Schema-Fix (يوليو 2026): stored_analyses ما فيهاش technical_score/fundamental_score
        # كأعمدة مستقلة — لازم نجيبها من analysis_json. فالـ SELECT والـ ORDER BY
        # يستخدموا maestro_score فقط (العمود الفعلي) ونرتب في Python بعدين.
        if persona == 'investor':
            score_col   = 'maestro_score'
            order_col   = 'maestro_score DESC'
            rec_filter  = "recommendation IN ('buy','strong_buy','hold')"
        elif persona == 'analyst':
            score_col   = 'maestro_score'
            order_col   = 'maestro_score DESC'
            rec_filter  = "recommendation IN ('buy','strong_buy','sell','strong_sell')"
        else:  # gambler (default)
            score_col   = 'maestro_score'
            order_col   = 'maestro_score DESC, updated_at DESC'
            rec_filter  = "1=1"

        # فلترة السوق — لا نسمح بـ market IS NULL (يسرّب أسهم سعودية/كويتية)
        if market == 'ALL':
            market_filter = "1=1"
        else:
            market_filter = f"market = '{market}'"

        # Schema-Fix: SELECT أعمدة موجودة فعلاً في stored_analyses
        # (technical_score / fundamental_score / ai_* مش موجودة كأعمدة)
        query = f"""
            SELECT
                sa.ticker,
                sa.recommendation,
                sa.recommendation_ar,
                sa.maestro_score,
                sa.target_price,
                sa.stop_loss,
                sa.entry_price,
                sa.confidence,
                sa.risk_reward,
                sa.volume_ratio,
                sa.liquidity_rating,
                sa.regime,
                sa.updated_at,
                sa.analysis_json,
                sa.market
            FROM stored_analyses sa
            WHERE {rec_filter}
              AND {market_filter}
              AND maestro_score IS NOT NULL
            ORDER BY {order_col}
            LIMIT {limit}
        """
        rows = conn.execute(query).fetchall()

        # Defense-in-depth: Apply strict market filter on the Python side too.
        # This catches Saudi numeric tickers (2120, 3002) and known Kuwaiti/
        # Gulf tickers (RASIYAT, OOREDOO, ...) even if their market column was
        # polluted with 'EGX'. Mirrors the fix in /api/v2/scanner and
        # /api/v2/persona-analysis.
        if market != 'ALL':
            filtered_rows = []
            for r in rows:
                d_row = dict(r)
                if _strict_market_filter(d_row, market, db_manager=None):
                    filtered_rows.append(r)
            rows = filtered_rows

        # جلب بيانات الأسهم الإضافية من stocks.db
        stocks_info = {}
        conn2 = None
        try:
            conn2 = safe_connect(_sdb, readonly=True)
            conn2.row_factory = sqlite3.Row
            srows = conn2.execute("""
                SELECT ticker, name, name_ar, sector, current_price, previous_close,
                       rsi, pe_ratio, roe, market_cap, logo_url,
                       change_1d, volume
                FROM stocks
            """).fetchall()
            for sr in srows:
                stocks_info[sr['ticker']] = dict(sr)
        except Exception:
            pass
        finally:
            if conn2:
                try:
                    conn2.close()
                except Exception:
                    pass

        try:
            conn.close()
        except Exception:
            pass

        stocks = []
        for r in rows:
            d = dict(r)
            ticker = d.get('ticker') or ''
            si = stocks_info.get(ticker, {})

            # استخراج بيانات إضافية من analysis_json
            # Schema-Fix (يوليو 2026): technical_score / fundamental_score / ai_*
            # مش موجودة كأعمدة في stored_analyses — نجيبها من analysis_json.
            extra = {
                'rsi': None, 'macd': None, 'current_price': None,
                'volume_ratio': None, 'technical_score': None,
                'fundamental_score': None,
                'ai_decision': None, 'ai_confidence': None,
                'ai_reason': None, 'ai_narrative': None, 'ai_updated_at': None,
            }
            if d.get('analysis_json'):
                try:
                    import json
                    aj = json.loads(d['analysis_json'])
                    # الـ analysis_json ممكن يكون فيه gambler/investor/analyst subs
                    # أو ممكن يكون flat (current_price في الـ root).
                    gambler = aj.get('gambler', {}) or {}
                    investor = aj.get('investor', {}) or {}
                    analyst = aj.get('analyst', {}) or {}

                    extra = {
                        'rsi':               gambler.get('rsi') or aj.get('rsi'),
                        'macd':              gambler.get('macd') or aj.get('macd'),
                        'current_price':     gambler.get('current_price') or aj.get('current_price'),
                        'volume_ratio':      gambler.get('volume_ratio') or aj.get('volume_ratio') or d.get('volume_ratio'),
                        'technical_score':   analyst.get('technical_score') or aj.get('technical_score') or aj.get('score'),
                        'fundamental_score': investor.get('fundamental_score') or aj.get('fundamental_score'),
                        'ai_decision':       aj.get('ai_decision'),
                        'ai_confidence':     aj.get('ai_confidence'),
                        'ai_reason':         aj.get('ai_reason'),
                        'ai_narrative':      aj.get('ai_narrative'),
                        'ai_updated_at':     aj.get('ai_updated_at'),
                    }
                except Exception:
                    pass

            # Live price priority: stocks.db.current_price is the freshest (updated every ~2 min by scraper)
            live_db_price = float(si.get('current_price') or 0)
            if live_db_price > 0:
                current_price = live_db_price
            else:
                current_price = (
                    extra.get('current_price')
                    or d.get('entry_price')
                    or 0
                )
            current_price = float(current_price or 0)

            rec_raw = (d.get('recommendation') or 'hold').lower()

            # تحويل recommendation لـ composite_score-style
            rec_map = {
                'strong_buy': 85, 'buy': 70, 'watch': 60,
                'hold': 50, 'reduce': 40, 'sell': 30, 'strong_sell': 15
            }

            # ─── Schema-Fix (يوليو 2026) ───────────────────────────────────
            # الـ frontend (SimpleRecommendationsView + غيره) بيقرأ snake_case
            # ورموز signal بأزواج (STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL).
            # لو رجّعنا "STRONG BUY" (بمسافة) الفلتر ما بيلقطش.
            # فا بنطابِق: signal = STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL.
            # =============================================================
            sig_map = {
                'strong_buy': 'STRONG_BUY',
                'buy': 'BUY',
                'accumulate': 'ACCUMULATE',
                'watch': 'HOLD',
                'hold': 'HOLD',
                'reduce': 'SELL',
                'sell': 'SELL',
                'strong_sell': 'STRONG_SELL',
            }
            signal_norm = sig_map.get(rec_raw, 'HOLD')
            signal_ar_norm = d.get('recommendation_ar') or _rec_ar(rec_raw)

            entry_price_v = float(d.get('entry_price') or current_price or 0)
            target_price_v = float(d.get('target_price') or 0)
            stop_loss_v = float(d.get('stop_loss') or 0)

            # ضمان منطقية الأهداف (نفس منطق /api/unified/predictions)
            if entry_price_v > 0:
                if target_price_v <= entry_price_v:
                    target_price_v = round(entry_price_v * 1.10, 2)
                if stop_loss_v == 0 or stop_loss_v >= entry_price_v:
                    stop_loss_v = round(entry_price_v * 0.92, 2)

            # فحص حي ومباشر للأهداف ووقف الخسارة إذا كان السعر الحي متحركاً
            if current_price > 0 and entry_price_v > 0:
                if signal_norm in ('BUY', 'STRONG_BUY', 'ACCUMULATE'):
                    if current_price >= target_price_v and target_price_v > entry_price_v:
                        signal_norm = 'TARGET_REACHED'
                        signal_ar_norm = '🎯 تم تحقيق الهدف'
                    elif current_price <= stop_loss_v and stop_loss_v < entry_price_v:
                        signal_norm = 'STOP_LOSS_BROKEN'
                        signal_ar_norm = '🚨 ضرب وقف الخسارة'

            # أهداف إضافية (للـ copy/share في SimpleRecommendationsView)
            target_price_2_v = round(entry_price_v * 1.10, 2) if entry_price_v > 0 else 0
            investment_target_v = round(entry_price_v * 1.15, 2) if entry_price_v > 0 else 0
            support_level_v = stop_loss_v

            # R/R ratio (موجب)
            risk_amt = entry_price_v - stop_loss_v
            reward_amt = target_price_v - entry_price_v
            if risk_amt > 0 and reward_amt > 0:
                risk_reward_ratio_v = round(reward_amt / risk_amt, 2)
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    risk_reward_ratio_v = compute_risk_reward(entry_price_v, target_price_v, stop_loss_v, fallback=risk_reward_ratio_v)
                except Exception:
                    pass  # keep inline risk_reward_ratio_v computed above
            else:
                risk_reward_ratio_v = 2.0

            # change_percent من stocks.db (لو موجود)
            change_percent_v = float(si.get('change_percent') or si.get('change_1d') or 0)

            # technical_score + rsi من analysis_json (لو موجودين)
            technical_score_v = float(extra.get('technical_score') or d.get('maestro_score') or 50)
            rsi_v = extra.get('rsi') or si.get('rsi') or 50
            fundamental_score_v = float(extra.get('fundamental_score') or 50)

            master_score_v = float(d.get('maestro_score') or 50)

            stocks.append({
                # ── snake_case (المطلوب من SimpleRecommendationsView) ──
                'ticker':              ticker,
                'name':                si.get('name', ticker),
                'name_ar':             si.get('name_ar') or si.get('name') or ticker,
                'sector':              si.get('sector', ''),
                'logo_url':            si.get('logo_url', ''),
                'market':              d.get('market') or market,

                # Scores (snake_case)
                'master_score':        master_score_v,
                'composite_score':     master_score_v,
                'maestro_score':       master_score_v,
                'technical_score':     technical_score_v,
                'fundamental_score':   fundamental_score_v,
                'confidence':          float(d.get('confidence') or extra.get('ai_confidence') or 50),

                # Recommendation (snake_case + signal منفصل)
                'recommendation':      rec_raw,
                'recommendationAr':    signal_ar_norm,
                'recommendation_ar':   signal_ar_norm,
                'signal':              signal_norm,
                'signal_ar':           signal_ar_norm,

                # Price (snake_case) — KEY FIX
                'current_price':       current_price,
                'entry_price':         entry_price_v,
                'target_price':        target_price_v,
                'stop_loss':           stop_loss_v,
                'support_level':       support_level_v,
                'target_price_2':      target_price_2_v,
                'investment_target':   investment_target_v,
                'risk_reward_ratio':   risk_reward_ratio_v,
                'risk_reward':         risk_reward_ratio_v,  # alias
                'change_percent':      change_percent_v,

                # ── CamelCase (محفوظ للتوافق مع v2.ts) ──
                'currentPrice':        current_price,
                'entryPrice':          entry_price_v,
                'targetPrice':         target_price_v,
                'stopLoss':            stop_loss_v,

                # Indicators
                'rsi':                 rsi_v,
                'change_1d':           change_percent_v,
                'volume':              si.get('volume') or 0,
                'volume_ratio':        extra.get('volume_ratio') or d.get('volume_ratio') or 1.0,
                'macd':                extra.get('macd'),
                'liquidity_rating':    d.get('liquidity_rating'),
                'regime':              d.get('regime'),

                # AI Analysis (من analysis_json)
                'ai_decision':         extra.get('ai_decision'),
                'ai_confidence':       extra.get('ai_confidence'),
                'ai_reason':           extra.get('ai_reason'),
                'ai_narrative':        extra.get('ai_narrative'),
                'ai_updated_at':       extra.get('ai_updated_at'),

                # Timestamps
                'updated_at':          d.get('updated_at'),
                'prediction_date':     d.get('updated_at'),
            })

        # Strict Python-level Market Exclusion
        filtered_stocks = []
        for s in stocks:
            t = str(s.get('ticker', '')).strip()
            is_num = t.isdigit() or (len(t) == 4 and t.isdigit())
            is_kw = any(k in t.upper() for k in ['RASIYAT', 'OOREDOO', 'AAYANRE', 'KSE', 'NBK', 'ZAIN'])
            m_code = s.get('market')
            
            if market == 'EGX':
                if is_num or is_kw or (m_code and m_code.upper() not in ['EGX', 'EGYPT', 'مصر']):
                    continue
            elif market in ['KSE', 'KUWAIT']:
                if not (is_kw or (m_code and m_code.upper() in ['KSE', 'KUWAIT'])):
                    continue
            elif market in ['TADAWUL', 'KSA', 'SAUDI']:
                if not (is_num or (m_code and m_code.upper() in ['TADAWUL', 'KSA'])):
                    continue

            filtered_stocks.append(s)

        # ترتيب حسب الـ score
        filtered_stocks.sort(key=lambda x: x.get('master_score', 0), reverse=True)

        return jsonify({
            'success':           True,
            'market':            market,
            'persona':           persona,
            'stocks':            filtered_stocks,
            'recommendations':   filtered_stocks,  # alias للتوافق
            'total':             len(filtered_stocks),
            'generatedAt':       datetime.now().isoformat(),
            'analysisVersion':   '3.0.0-live',
            'source':            'stored_analyses',
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error':   str(e),
            'stocks':  [],
            'market':  market if 'market' in dir() else 'EGX',
        }), 500


def _rec_ar(rec: str) -> str:
    """تحويل التوصية الإنجليزية للعربية"""
    mapping = {
        'strong_buy':  'شراء قوي',
        'buy':         'شراء',
        'watch':       'مراقبة',
        'hold':        'احتفاظ',
        'reduce':      'تخفيف',
        'sell':        'بيع',
        'strong_sell': 'بيع قوي',
    }
    return mapping.get(rec.lower(), rec)

