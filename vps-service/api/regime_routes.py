"""
Regime Detection API Routes
"""
from flask import Blueprint, jsonify, request
from analyzers.regime_detector import RegimeDetector
import os
from pathlib import Path

regime_bp = Blueprint('regime', __name__, url_prefix='/api/regime')

# Market index mapping
MARKET_INDEX = {
    'EGX': 'EGX30',
    'KSA': 'TASI',
    'TADAWUL': 'TASI',
    'KSE': 'KSE',
    'QSE': 'QE',
    'DFM': 'DFMGI',
    'CRYPTO': 'BTCUSDT',
}

def get_detector():
    base_dir = Path(__file__).parent.parent.parent
    # PRODUCTION FIX (Aug 2026): The regime detector queries the
    # `stock_price_history` view/table. In production this view lives in
    # stocks.db (created by core/database.py mapping to stock_daily_prices).
    # In the sandbox, stocks.db has NO price data — the price history lives
    # in price_history.db (table `price_history`, with a `stock_price_history`
    # view alias). Auto-detect which DB actually has the view so the regime
    # endpoint stops returning `no such table: stock_price_history` (500)
    # in environments where stocks.db is empty.
    env_db = os.environ.get('DATABASE_PATH')
    candidate_paths = []
    if env_db:
        candidate_paths.append(env_db)
    candidate_paths.append(str(base_dir / 'db' / 'stocks.db'))
    candidate_paths.append(str(base_dir / 'db' / 'price_history.db'))

    import sqlite3
    for p in candidate_paths:
        try:
            if not os.path.exists(p):
                continue
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            _c = db_manager.connection(p, writable=False).__enter__()
            _has = _c.execute(
                "SELECT 1 FROM sqlite_master WHERE name='stock_price_history' LIMIT 1"
            ).fetchone()
            _c.close()
            if _has:
                return RegimeDetector(p)
        except Exception:
            continue
    # Fallback: last candidate (preserves previous default behavior)
    return RegimeDetector(candidate_paths[-1])

def normalize_market(market: str) -> str:
    """Convert market code to index ticker."""
    return MARKET_INDEX.get(market.upper(), market.upper())

@regime_bp.route('/market', methods=['GET'])
def get_market_regime():
    """Get regime for a specific market (defaults to EGX)."""
    try:
        market = request.args.get('market', 'EGX')
        index_ticker = normalize_market(market)
        detector = get_detector()
        result = detector.detect_regime(index_ticker)
        # Add market info to result
        result['market'] = market
        result['index'] = index_ticker
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@regime_bp.route('/stock/<ticker>', methods=['GET'])
def get_stock_regime(ticker):
    try:
        return jsonify({'success': True, 'data': get_detector().detect_regime(ticker.upper())})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@regime_bp.route('/overview', methods=['GET'])
def get_overview():
    try:
        detector = get_detector()
        return jsonify({
            'success': True,
            'data': {
                'market_regime': detector.detect_regime('EGX30'),
                'trading_advice': {'action': 'HOLD', 'action_ar': 'احتفاظ'}
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
