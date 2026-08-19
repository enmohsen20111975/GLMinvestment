# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Multi-Market API Routes
=======================
مسارات API للأسواق العربية المتعددة

Endpoints:
- GET /api/multi-market/markets - قائمة الأسواق
- GET /api/multi-market/quote/<ticker>?market=KSA - سعر سهم واحد
- GET /api/multi-market/market/<market> - أسهم سوق كامل
- GET /api/multi-market/historical/<ticker>?market=KSA - بيانات تاريخية
- GET /api/multi-market/crypto - أفضل العملات الرقمية
- POST /api/multi-market/sync - تحديث قاعدة البيانات
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Create blueprint
multi_market_bp = Blueprint('multi_market', __name__, url_prefix='/api/multi-market')

# Import fetcher
try:
    from data.enhanced_multi_market import EnhancedMultiMarketFetcher, MARKET_CONFIG
    FETCHER_AVAILABLE = True
except ImportError:
    FETCHER_AVAILABLE = False
    logger.warning("Multi-market fetcher not available")


@multi_market_bp.route('/markets', methods=['GET'])
def get_markets():
    """
    الحصول على قائمة الأسواق المدعومة
    
    Returns:
        List of supported markets with configuration
    """
    markets = []
    for code, config in MARKET_CONFIG.items():
        markets.append({
            'code': code,
            'name': config['name'],
            'name_ar': config['name_ar'],
            'currency': config['currency'],
            'timezone': config['timezone'],
            'trading_hours': config['trading_hours'],
        })
    
    return jsonify({
        'success': True,
        'markets': markets,
        'total': len(markets),
        'timestamp': datetime.now().isoformat()
    })


@multi_market_bp.route('/sources', methods=['GET'])
def get_sources():
    """
    الحصول على مصادر البيانات المتاحة
    
    Returns:
        Dict with available sources status
    """
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    fetcher = EnhancedMultiMarketFetcher()
    sources = fetcher.get_available_sources()
    
    return jsonify({
        'success': True,
        'sources': sources,
        'timestamp': datetime.now().isoformat()
    })


@multi_market_bp.route('/quote/<ticker>', methods=['GET'])
def get_quote(ticker):
    """
    الحصول على سعر سهم واحد
    
    Query params:
        market: Market code (required)
        source: Data source (optional: auto, tradingview, yfinance)
    
    Returns:
        Stock quote data
    """
    market = request.args.get('market')
    source = request.args.get('source', 'auto')
    
    if not market:
        return jsonify({
            'success': False,
            'error': 'market parameter required (KSA, KSE, DFM, ADX, BSE, QSE)'
        }), 400
    
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    try:
        fetcher = EnhancedMultiMarketFetcher()
        data = fetcher.fetch_stock(ticker, market, source)
        
        if data:
            return jsonify({
                'success': True,
                'quote': data,
                'timestamp': datetime.now().isoformat()
            })
        else:
            return jsonify({
                'success': False,
                'error': f'No data available for {ticker} in {market}'
            }), 404
    
    except Exception as e:
        logger.error(f"Error fetching quote for {ticker}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@multi_market_bp.route('/market/<market>', methods=['GET'])
def get_market_stocks(market):
    """
    الحصول على أسهم سوق كامل
    
    Query params:
        limit: Max stocks to return (default: 20)
    
    Returns:
        List of stocks for the market
    """
    limit = request.args.get('limit', 20, type=int)
    
    if market not in MARKET_CONFIG:
        return jsonify({
            'success': False,
            'error': f'Unknown market: {market}',
            'available_markets': list(MARKET_CONFIG.keys())
        }), 400
    
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    try:
        fetcher = EnhancedMultiMarketFetcher()
        
        if market == 'CRYPTO':
            stocks = fetcher.fetch_crypto_top(limit)
        else:
            stocks = fetcher.fetch_market_stocks(market, limit)
        
        return jsonify({
            'success': True,
            'market': market,
            'market_info': MARKET_CONFIG.get(market),
            'stocks': stocks,
            'total': len(stocks),
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error fetching market {market}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@multi_market_bp.route('/historical/<ticker>', methods=['GET'])
def get_historical(ticker):
    """
    الحصول على البيانات التاريخية
    
    Query params:
        market: Market code (required)
        days: Number of days (default: 365)
    
    Returns:
        Historical OHLCV data
    """
    market = request.args.get('market')
    days = request.args.get('days', 365, type=int)
    
    if not market:
        return jsonify({
            'success': False,
            'error': 'market parameter required'
        }), 400
    
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    try:
        fetcher = EnhancedMultiMarketFetcher()
        data = fetcher.fetch_historical(ticker, market, days)
        
        if data:
            return jsonify({
                'success': True,
                'ticker': ticker,
                'market': market,
                'data': data,
                'total_records': len(data),
                'timestamp': datetime.now().isoformat()
            })
        else:
            return jsonify({
                'success': False,
                'error': f'No historical data for {ticker} in {market}'
            }), 404
    
    except Exception as e:
        logger.error(f"Error fetching historical for {ticker}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@multi_market_bp.route('/crypto', methods=['GET'])
def get_crypto():
    """
    الحصول على أفضل العملات الرقمية
    
    Query params:
        limit: Max cryptos to return (default: 50)
    
    Returns:
        Top cryptocurrencies by market cap
    """
    limit = request.args.get('limit', 50, type=int)
    
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    try:
        fetcher = EnhancedMultiMarketFetcher()
        cryptos = fetcher.fetch_crypto_top(limit)
        
        return jsonify({
            'success': True,
            'cryptos': cryptos,
            'total': len(cryptos),
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error fetching crypto: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@multi_market_bp.route('/sync', methods=['POST'])
def sync_markets():
    """
    تحديث قاعدة البيانات من جميع الأسواق
    
    Body (optional):
        markets: List of markets to sync (default: all)
    
    Returns:
        Sync statistics
    """
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    try:
        # Handle both JSON body and empty body
        try:
            data = request.get_json(silent=True) or {}
        except:
            data = {}
        markets = data.get('markets')
        
        # Get database path
        try:
            from config import DATABASE_PATH
            db_path = DATABASE_PATH
        except ImportError:
            from pathlib import Path as _P
            db_path = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')
        
        fetcher = EnhancedMultiMarketFetcher(db_path)
        result = fetcher.update_database(markets)
        
        return jsonify({
            'success': True,
            'result': result,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error syncing markets: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@multi_market_bp.route('/sync/<market>', methods=['POST'])
def sync_single_market(market):
    """
    تحديث سوق واحد
    
    Returns:
        Sync statistics for single market
    """
    if market not in MARKET_CONFIG:
        return jsonify({
            'success': False,
            'error': f'Unknown market: {market}'
        }), 400
    
    if not FETCHER_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Fetcher not available'
        }), 503
    
    try:
        # Get database path
        try:
            from config import DATABASE_PATH
            db_path = DATABASE_PATH
        except ImportError:
            from pathlib import Path as _P
            db_path = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')
        
        fetcher = EnhancedMultiMarketFetcher(db_path)
        result = fetcher.update_database([market])
        
        return jsonify({
            'success': True,
            'market': market,
            'result': result,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error syncing market {market}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Register with main app
def register_multi_market_routes(app):
    """Register blueprint with Flask app"""
    app.register_blueprint(multi_market_bp)
    logger.info("✓ Multi-Market API registered (/api/multi-market/*)")
