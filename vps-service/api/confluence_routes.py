#!/usr/bin/env python3
"""
Confluence Analysis Routes
==========================
تفعيل محرك التوحيد الكامل - استخدام الـ 5 أنظمة

This activates:
1. Technical Analysis (40% weight)
2. Fundamental Analysis (25% weight)
3. Seasonality (15% weight)
4. Dividend Timing (10% weight)
5. Volume Analysis (10% weight)

NOT just RSI anymore!
"""

import os
import sys
import json
import sqlite3
from datetime import datetime
from typing import Dict, List, Optional, Any
from flask import Blueprint, jsonify, request

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Create Blueprint
confluence_bp = Blueprint('confluence', __name__, url_prefix='/api/confluence')

# Database paths
from pathlib import Path
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

# ============================================================================
# IMPORT CONFLUENCE ENGINE V3
# ============================================================================

CONFLUENCE_V3_AVAILABLE = False
try:
    from analyzers.confluence_engine_v3 import ConfluenceEngineV3, ConfluenceResultV3
    from analyzers.technical import TechnicalAnalyzer
    CONFLUENCE_V3_AVAILABLE = True
    print("[Confluence Routes] ✅ ConfluenceEngineV3 loaded successfully")
except ImportError as e:
    print(f"[Confluence Routes] ❌ Failed to import ConfluenceEngineV3: {e}")

# ── Board of Analysts Integration ─────────────────────────────────
try:
    from analyzers.board_of_analysts import get_board_manager as _conf_get_board_manager
    _CONF_BOARD_AVAILABLE = True
except Exception:
    _conf_get_board_manager = None
    _CONF_BOARD_AVAILABLE = False
# ─────────────────────────────────────────────────────────


def get_stock_prices(ticker: str, days: int = 100) -> tuple:
    """Get historical prices for a stock."""
    try:
        conn = sqlite3.connect(STOCKS_DB)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT close, high, low, volume, date
            FROM stock_price_history
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT ?
        ''', (ticker, days))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return [], [], [], [], []
        
        # Reverse to get oldest first
        rows = rows[::-1]
        
        closes = [float(r[0]) for r in rows if r[0]]
        highs = [float(r[1]) for r in rows if r[1]]
        lows = [float(r[2]) for r in rows if r[2]]
        volumes = [float(r[3]) if r[3] else 0 for r in rows]
        dates = [r[4] for r in rows]
        
        return closes, highs, lows, volumes, dates
        
    except Exception as e:
        print(f"[Confluence] Error getting prices for {ticker}: {e}")
        return [], [], [], [], []


def get_stock_fundamentals(ticker: str) -> Dict:
    """Get fundamental data for a stock."""
    try:
        conn = sqlite3.connect(STOCKS_DB)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT pe_ratio, pb_ratio, ps_ratio, roe, roa, eps,
                   dividend_yield, profit_margin, debt_to_equity,
                   current_ratio, market_cap, book_value_per_share
            FROM stocks
            WHERE ticker = ?
        ''', (ticker,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return {}
        
        return {
            'pe_ratio': row[0],
            'pb_ratio': row[1],
            'ps_ratio': row[2],
            'roe': row[3],
            'roa': row[4],
            'eps': row[5],
            'dividend_yield': row[6],
            'profit_margin': row[7],
            'debt_to_equity': row[8],
            'current_ratio': row[9],
            'market_cap': row[10],
            'book_value': row[11]
        }
        
    except Exception as e:
        print(f"[Confluence] Error getting fundamentals for {ticker}: {e}")
        return {}


def analyze_with_full_confluence(ticker: str) -> Dict:
    """
    Analyze a stock using the FULL confluence engine.
    
    This uses ALL 5 systems:
    - Technical (40%)
    - Fundamental (25%)
    - Seasonality (15%)
    - Dividend (10%)
    - Volume (10%)
    """
    if not CONFLUENCE_V3_AVAILABLE:
        return {
            'success': False,
            'error': 'ConfluenceEngineV3 not available',
            'ticker': ticker
        }
    
    try:
        # Get price data
        closes, highs, lows, volumes, dates = get_stock_prices(ticker, 100)
        
        if len(closes) < 20:
            return {
                'success': False,
                'error': f'Insufficient price data ({len(closes)} days)',
                'ticker': ticker
            }
        
        # Initialize engines
        tech_analyzer = TechnicalAnalyzer()
        confluence_engine = ConfluenceEngineV3(STOCKS_DB)
        
        # 1. Technical Analysis
        tech_result = tech_analyzer.analyze(closes, volumes)
        
        # Get signals from technical
        ma_cross_signal = 'HOLD'
        if tech_result.sma_20 and tech_result.sma_50:
            current_price = closes[-1]
            if current_price > tech_result.sma_20 > tech_result.sma_50:
                ma_cross_signal = 'BUY'
            elif current_price < tech_result.sma_20 < tech_result.sma_50:
                ma_cross_signal = 'SELL'
        
        macd_signal = 'HOLD'
        if tech_result.macd_trend == 'BULLISH':
            macd_signal = 'BUY'
        elif tech_result.macd_trend == 'BEARISH':
            macd_signal = 'SELL'
        
        rsi_signal = 'HOLD'
        if tech_result.rsi:
            if tech_result.rsi <= 30:
                rsi_signal = 'BUY'
            elif tech_result.rsi >= 70:
                rsi_signal = 'SELL'
        
        bollinger_signal = 'HOLD'
        if tech_result.bb_position:
            if tech_result.bb_position == 'LOWER':
                bollinger_signal = 'BUY'
            elif tech_result.bb_position == 'UPPER':
                bollinger_signal = 'SELL'
        
        stochastic_signal = 'HOLD'
        if tech_result.stochastic_k:
            if tech_result.stochastic_k <= 20:
                stochastic_signal = 'BUY'
            elif tech_result.stochastic_k >= 80:
                stochastic_signal = 'SELL'
        
        # 2. Run Confluence Engine
        confluence_result = confluence_engine.analyze(
            ticker=ticker,
            ma_cross_signal=ma_cross_signal,
            macd_signal=macd_signal,
            rsi_signal=rsi_signal,
            bollinger_signal=bollinger_signal,
            stochastic_signal=stochastic_signal,
            volume_signal='HOLD',  # TODO: Add volume analysis
            seasonality_signal='HOLD',  # TODO: Add seasonality
            dividend_signal='HOLD'  # TODO: Add dividend timing
        )
        
        # 3. Build comprehensive result
        result = {
            'success': True,
            'ticker': ticker,
            'timestamp': datetime.now().isoformat(),
            
            # Technical indicators
            'technical': {
                'rsi': tech_result.rsi,
                'rsi_signal': tech_result.rsi_signal,
                'macd': tech_result.macd,
                'macd_trend': tech_result.macd_trend,
                'sma_20': tech_result.sma_20,
                'sma_50': tech_result.sma_50,
                'sma_200': tech_result.sma_200,
                'bb_upper': tech_result.bb_upper,
                'bb_lower': tech_result.bb_lower,
                'bb_position': tech_result.bb_position,
                'stochastic_k': tech_result.stochastic_k,
                'adx': tech_result.adx,
                'trend_direction': tech_result.trend_direction,
                'trend_strength': tech_result.trend_strength,
                'support': tech_result.support_level,
                'resistance': tech_result.resistance_level,
                'overall_signal': tech_result.overall_signal,
                'signal_score': tech_result.signal_score
            },
            
            # Price data
            'price': {
                'current': closes[-1] if closes else None,
                'high_52w': max(highs) if highs else None,
                'low_52w': min(lows) if lows else None,
                'avg_volume': sum(volumes[-20:]) / 20 if len(volumes) >= 20 else None
            }
        }
        
        # Add confluence result if available
        if confluence_result:
            result['confluence'] = {
                'signal': confluence_result.signal,
                'signal_ar': confluence_result.signal_ar,
                'confidence': confluence_result.confidence,
                'master_score': confluence_result.master_score,
                'technical_score': confluence_result.technical_score,
                'fundamental_score': confluence_result.fundamental_score,
                'indicators_agreeing': confluence_result.indicators_agreeing,
                'indicators_breakdown': confluence_result.indicators_breakdown,
                'risk_level': confluence_result.risk_level,
                'suggested_position_pct': confluence_result.suggested_position_pct
            }
            
            # Add entry/exit levels
            entry_price = closes[-1]
            if confluence_result.signal in ['BUY', 'STRONG_BUY']:
                result['entry'] = {
                    'price': entry_price,
                    'stop_loss': entry_price * 0.95,  # 5% stop loss
                    'target_1': entry_price * 1.05,   # 5% target
                    'target_2': entry_price * 1.10,   # 10% target
                }
            elif confluence_result.signal in ['SELL', 'STRONG_SELL']:
                result['entry'] = {
                    'price': entry_price,
                    'stop_loss': entry_price * 1.05,
                    'target_1': entry_price * 0.95,
                    'target_2': entry_price * 0.90,
                }
        
        # Add fundamentals
        fundamentals = get_stock_fundamentals(ticker)
        if fundamentals:
            result['fundamentals'] = fundamentals
        
        return result
        
    except Exception as e:
        import traceback
        return {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
            'ticker': ticker
        }


# ============================================================================
# API ENDPOINTS
# ============================================================================

@confluence_bp.route('/status', methods=['GET'])
def confluence_status():
    """Get status of confluence engine."""
    boards_info = {}
    if _CONF_BOARD_AVAILABLE and _conf_get_board_manager:
        for mkt in ['EGX', 'TADAWUL', 'CRYPTO', 'KSE', 'QSE']:
            try:
                mgr = _conf_get_board_manager(mkt)
                boards_info[mkt] = {
                    'analysts': list(mgr.analysts.keys()),
                    'sell_strategy': mgr.sell_strategy
                }
            except Exception:
                boards_info[mkt] = {'error': True}

    return jsonify({
        'success': True,
        'confluence_v3_available': CONFLUENCE_V3_AVAILABLE,
        'board_system_available': _CONF_BOARD_AVAILABLE,
        'boards': boards_info,
        'message': 'Confluence Engine V3 + Board of Analysts ready' if (CONFLUENCE_V3_AVAILABLE and _CONF_BOARD_AVAILABLE)
                   else 'Confluence Engine V3 is ready' if CONFLUENCE_V3_AVAILABLE
                   else 'Confluence Engine V3 not available'
    })


@confluence_bp.route('/analyze/<ticker>', methods=['GET'])
def analyze_ticker(ticker: str):
    """
    Full confluence analysis for a single ticker.

    Uses ALL 5 systems:
    - Technical (40%)
    - Fundamental (25%)
    - Seasonality (15%)
    - Dividend (10%)
    - Volume (10%)

    PLUS: Board of Analysts consensus report
    """
    t = ticker.upper()
    market = request.args.get('market', '').upper()
    if not market:
        market = 'TADAWUL' if t.isdigit() else 'EGX'

    result = analyze_with_full_confluence(t)

    # ── Inject Board of Analysts opinion ────────────────────────────────
    if _CONF_BOARD_AVAILABLE and _conf_get_board_manager:
        try:
            _board_mgr = _conf_get_board_manager(market)
            _board_rpt = _board_mgr.generate_final_report(t)
            result['board_consensus'] = {
                'available': True,
                'signal': _board_rpt.get('signal', 'HOLD'),
                'signal_ar': _board_rpt.get('signal_ar', ''),
                'confidence': _board_rpt.get('confidence', 50),
                'master_score': _board_rpt.get('master_score', 50),
                'market': market,
                'opinions': _board_rpt.get('opinions', {}),
                'sell_strategy_desc': _board_rpt.get('sell_strategy_desc', ''),
                'reason_ar': _board_rpt.get('reason_ar', ''),
                'entry_price': _board_rpt.get('entry_price'),
                'target_price': _board_rpt.get('target_price'),
                'stop_loss': _board_rpt.get('stop_loss'),
            }
        except Exception as _be:
            result['board_consensus'] = {'available': False, 'error': str(_be)}
    else:
        result['board_consensus'] = {'available': False}
    # ────────────────────────────────────────────────────────────────

    return jsonify(result)


@confluence_bp.route('/analyze-batch', methods=['POST'])
def analyze_batch():
    """
    Analyze multiple tickers at once.
    
    Body:
    {
        "tickers": ["COMI", "ETAL", "SWDY"],
        "min_score": 60
    }
    """
    try:
        data = request.get_json() or {}
        tickers = data.get('tickers', [])
        min_score = data.get('min_score', 60)
        
        if not tickers:
            return jsonify({
                'success': False,
                'error': 'No tickers provided'
            }), 400
        
        results = []
        for ticker in tickers[:50]:  # Limit to 50
            result = analyze_with_full_confluence(ticker.upper())
            if result.get('success'):
                confluence = result.get('confluence', {})
                if confluence.get('master_score', 0) >= min_score:
                    results.append(result)
        
        return jsonify({
            'success': True,
            'count': len(results),
            'results': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@confluence_bp.route('/clean-signals', methods=['GET'])
def get_clean_signals():
    """
    Get signals for clean stocks (excluding anomalies).
    
    This analyzes stocks that don't have price anomalies.
    """
    try:
        conn = sqlite3.connect(STOCKS_DB)
        cursor = conn.cursor()
        
        # Get clean stocks with valid RSI
        cursor.execute('''
            SELECT ticker, rsi, close
            FROM stocks
            WHERE rsi IS NOT NULL
            AND rsi > 0
            AND rsi < 100
            AND ticker NOT IN (SELECT ticker FROM stock_anomalies)
            ORDER BY rsi ASC
            LIMIT 50
        ''')
        
        stocks = cursor.fetchall()
        conn.close()
        
        results = []
        for ticker, rsi, price in stocks:
            result = analyze_with_full_confluence(ticker)
            if result.get('success') and result.get('confluence'):
                results.append({
                    'ticker': ticker,
                    'rsi': rsi,
                    'price': price,
                    'confluence': result['confluence']
                })
        
        return jsonify({
            'success': True,
            'count': len(results),
            'signals': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@confluence_bp.route('/generate-predictions', methods=['POST'])
def generate_predictions():
    """
    RULE35-DISABLED (2026-10-12 — HIDDEN-WRITERS-AUDIT):

    This route was a ROGUE PATH that bypassed PREDICTION-WRITE-GUARD + Rule 35.
    It directly INSERTed into `aiPrediction` table using confluence V3 analysis
    with fabricated `source='CONFLUENCE_V3'` — NO evidence_count, NO kill_filter_result,
    NO R:R ≥ 1.5 gate, NO ATR clamp.

    Rule 35 (ENGINE-UNIFY): V40.2 is the ONLY sanctioned prediction writer.
    Rule 27 (NO-FAKE-DATA): confluence predictions bypass evidence pipeline.
    Rule 67 (CALCULATION-CANONICAL): confluence_engine_v3 is NOT canonical
      for prediction writing — only V40.2 (daily_predictor.py) is.

    Returns 410 Gone with redirect to V40.2 canonical generator.
    """
    return jsonify({
        'success': False,
        'deprecated': True,
        'error': 'endpoint_deprecated',
        'error_ar': 'تم إيقاف هذا الـ endpoint نهائياً. توليد التوقعات انتقل بالكامل لـ V40.2.',
        'deprecated_at': '2026-10-12',
        'rule': 'Rule 35 (ENGINE-UNIFY) + Rule 27 (NO-FAKE-DATA) + Rule 67 (CALCULATION-CANONICAL)',
        'canonical_writer': 'vps-service/jobs/daily_predictor.py (V40.2)',
        'canonical_command': 'python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5',
        'reason': 'This route bypassed PREDICTION-WRITE-GUARD and INSERTed fabricated predictions with source=CONFLUENCE_V3 (no evidence_count, no kill_filter_result).',
    }), 410

    # ─── ORIGINAL CODE BELOW — preserved for reference (Rule 16 VERIFY-BEFORE-DELETE) ───
    # The original implementation that INSERTed into aiPrediction is preserved
    # below but UNREACHABLE due to the return statement above.
    try:
        data = request.get_json() or {}
        min_score = data.get('min_score', 65)
        limit = data.get('limit', 50)
        
        # Get clean stocks
        conn = sqlite3.connect(STOCKS_DB)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT ticker
            FROM stocks
            WHERE rsi IS NOT NULL
            AND rsi > 0
            AND rsi < 100
            AND ticker NOT IN (SELECT ticker FROM stock_anomalies)
            LIMIT ?
        ''', (limit,))
        
        tickers = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        predictions = []
        prediction_date = datetime.now().strftime('%Y-%m-%d')
        
        for ticker in tickers:
            result = analyze_with_full_confluence(ticker)
            
            if not result.get('success'):
                continue
            
            confluence = result.get('confluence', {})
            if not confluence:
                continue
            
            master_score = confluence.get('master_score', 0)
            signal = confluence.get('signal', 'HOLD')
            
            if master_score < min_score or signal == 'HOLD':
                continue
            
            # Generate prediction
            import uuid
            pred_id = str(uuid.uuid4())
            
            technical = result.get('technical', {})
            entry = result.get('entry', {})
            price = result.get('price', {})
            
            prediction = {
                'id': pred_id,
                'ticker': ticker,
                'signal': signal,
                'confidence': confluence.get('confidence', 50),
                'master_score': master_score,
                'entry_price': price.get('current'),
                'target_price': entry.get('target_1'),
                'stop_loss': entry.get('stop_loss'),
                'technical_score': confluence.get('technical_score'),
                'fundamental_score': confluence.get('fundamental_score'),
                'indicators_agreeing': confluence.get('indicators_agreeing'),
                'risk_level': confluence.get('risk_level'),
                'prediction_date': prediction_date,
                'analysis_type': 'CONFLUENCE_V3_FULL'
            }
            
            # Save to database
            try:
                conn = sqlite3.connect(PREDICTIONS_DB)
                cursor = conn.cursor()
                
                cursor.execute('''
                    INSERT INTO aiPrediction 
                    (id, stock_symbol, maestro_score, confidence, signal_type,
                     entry_price, target_price, stop_loss, regime, phase_scores,
                     prediction_date, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    pred_id,
                    ticker,
                    master_score,
                    prediction['confidence'],
                    signal,
                    prediction['entry_price'],
                    prediction['target_price'],
                    prediction['stop_loss'],
                    'CONFLUENCE_V3',
                    json.dumps({
                        'technical_score': prediction['technical_score'],
                        'fundamental_score': prediction['fundamental_score'],
                        'indicators_agreeing': prediction['indicators_agreeing']
                    }),
                    prediction_date,
                    'PENDING',
                    datetime.now().isoformat()
                ))
                
                conn.commit()
                conn.close()
                
                predictions.append(prediction)
                
            except Exception as e:
                print(f"[Confluence] Error saving prediction for {ticker}: {e}")
        
        return jsonify({
            'success': True,
            'count': len(predictions),
            'predictions': predictions,
            'message': f'Generated {len(predictions)} predictions with confluence analysis'
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500
