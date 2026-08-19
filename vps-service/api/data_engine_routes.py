# DEPRECATED: This route is not registered in lightweight_server.py
"""
Data Engine Flask Routes
========================
Flask blueprint for data-engine API

Endpoints:
- GET /api/data-engine/stocks - أسهم السوق
- GET /api/data-engine/metals - الذهب والفضة
- GET /api/data-engine/crypto - العملات الرقمية
- GET /api/data-engine/forex - أسعار الصرف
- GET /api/data-engine/status - حالة الأسواق
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import logging
import sys
import os

# Add data-engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'data-engine'))

# Setup
logger = logging.getLogger(__name__)
data_engine_bp = Blueprint('data_engine', __name__, url_prefix='/api/data-engine')

# ==========================================
# IMPORT SCRAPERS
# ==========================================

try:
    from scrapers.stocks_scraper import StocksScraper, fetch_quote, fetch_market_stocks
    STOCKS_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Stocks scraper not available: {e}")
    STOCKS_AVAILABLE = False

try:
    from scrapers.metals_scraper import MetalsScraper, get_gold_prices, get_silver_prices
    METALS_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Metals scraper not available: {e}")
    METALS_AVAILABLE = False

try:
    from scrapers.crypto_scraper import CryptoScraper, get_top_cryptos, get_btc_price
    CRYPTO_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Crypto scraper not available: {e}")
    CRYPTO_AVAILABLE = False

try:
    from scrapers.forex_scraper import ForexScraper, get_exchange_rates, convert_currency
    FOREX_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Forex scraper not available: {e}")
    FOREX_AVAILABLE = False

try:
    from market_config.market_hours import (
        is_market_open,
        get_market_status,
        get_all_markets_status,
        MARKET_HOURS
    )
    MARKET_HOURS_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Market hours not available: {e}")
    MARKET_HOURS_AVAILABLE = False


# ==========================================
# STOCKS ROUTES
# ==========================================

@data_engine_bp.route('/stocks', methods=['GET'])
def get_stocks():
    """جلب بيانات الأسهم"""
    market = request.args.get('market', 'EGX')
    limit = int(request.args.get('limit', 20))
    
    if not STOCKS_AVAILABLE:
        return jsonify({"success": False, "error": "Stocks scraper not available"}), 503
    
    try:
        scraper = StocksScraper()
        stocks = scraper.fetch_market(market, limit=min(limit, 100))
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "market": market,
            "count": len(stocks),
            "stocks": [s.__dict__ for s in stocks],
            "stats": scraper.get_stats()
        })
    except Exception as e:
        logger.error(f"Error fetching stocks: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/stocks/<ticker>', methods=['GET'])
def get_stock_quote(ticker):
    """جلب بيانات سهم محدد"""
    market = request.args.get('market', 'EGX')
    
    if not STOCKS_AVAILABLE:
        return jsonify({"success": False, "error": "Stocks scraper not available"}), 503
    
    try:
        data = fetch_quote(ticker, market)
        
        if data:
            return jsonify({
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "stock": data
            })
        else:
            return jsonify({
                "success": False,
                "error": f"No data for {ticker}"
            }), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/stocks/all', methods=['GET'])
def get_all_stocks():
    """جلب بيانات كل الأسواق"""
    limit_per_market = int(request.args.get('limit_per_market', 10))
    
    if not STOCKS_AVAILABLE:
        return jsonify({"success": False, "error": "Stocks scraper not available"}), 503
    
    try:
        scraper = StocksScraper()
        results = scraper.fetch_all_markets(limit_per_market)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "markets": {
                market: [s.__dict__ for s in stocks]
                for market, stocks in results.items()
            },
            "stats": scraper.get_stats()
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# METALS ROUTES
# ==========================================

# Mapping: English country names (for URL) → Arabic names (in DB)
COUNTRY_NAME_MAP = {
    'egypt': 'مصر',
    'saudi-arabia': 'السعودية',
    'kuwait': 'الكويت',
    'qatar': 'قطر',
    'uae': 'الإمارات',
    'bahrain': 'البحرين',
    'oman': 'عمان',
    'jordan': 'الأردن',
}

COUNTRY_ARABIC_TO_ENGLISH = {
    'مصر': 'Egypt',
    'السعودية': 'Saudi Arabia',
    'الكويت': 'Kuwait',
    'قطر': 'Qatar',
}

COUNTRY_CURRENCY_MAP = {
    'مصر': 'EGP',
    'السعودية': 'SAR',
    'الكويت': 'KWD',
    'قطر': 'QAR',
}


def _query_gold_prices_clean(country=None, karat=None):
    """
    الاستعلام من gold_prices_clean — أرخص وأسرع من الاستعلام من live APIs.
    ترجع أحدث snapshot لجولد (بدون مصنعية/دمغة).
    """
    import sqlite3
    from pathlib import Path
    
    db_path = Path(__file__).parent.parent.parent / 'db' / 'data_engine.db'
    if not db_path.exists():
        return None
    
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    try:
        # Build query dynamically based on filters
        where_clauses = []
        params = []
        
        if country:
            where_clauses.append('country = ?')
            params.append(country)
        
        if karat:
            where_clauses.append('karat = ?')
            params.append(karat)
        
        where_sql = ' AND '.join(where_clauses) if where_clauses else '1=1'
        
        c.execute(f'''
            SELECT timestamp, country, currency, karat, price_per_gram, usd_rate_used, global_ounce_usd
            FROM gold_prices_clean
            WHERE {where_sql}
              AND timestamp = (SELECT MAX(timestamp) FROM gold_prices_clean)
            ORDER BY country, CAST(karat AS INTEGER) DESC
        ''', params)
        
        rows = c.fetchall()
        if not rows:
            return None
        
        # Get the unique timestamp
        ts = rows[0]['timestamp']
        global_ounce = rows[0]['global_ounce_usd']
        
        # Group by country
        result = {}
        for row in rows:
            c_name = row['country']
            if c_name not in result:
                result[c_name] = {
                    'country': c_name,
                    'currency': row['currency'],
                    'prices': {},
                    'usd_rate_used': row['usd_rate_used'],
                }
            result[c_name]['prices'][f"{row['karat']}k"] = row['price_per_gram']
        
        return {
            'timestamp': ts,
            'global_ounce_usd': global_ounce,
            'countries': list(result.values()),
        }
    except Exception:
        return None
    finally:
        conn.close()


@data_engine_bp.route('/metals', methods=['GET'])
def get_metals():
    """جلب أسعار الذهب والفضة"""
    if not METALS_AVAILABLE:
        return jsonify({"success": False, "error": "Metals scraper not available"}), 503
    
    try:
        scraper = MetalsScraper()
        data = scraper.fetch_all_metals()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": data
        })
    except Exception as e:
        logger.error(f"Error fetching metals: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/metals/gold', methods=['GET'])
def get_gold():
    """جلب أسعار الذهب — يعيد الأسعار النظيفة (بدون مصنعية/دمغة) من gold_prices_clean"""
    try:
        # Query parameters for filtering
        country_filter = request.args.get('country')
        karat_filter = request.args.get('karat')
        
        # Map English country name to Arabic if needed
        if country_filter and country_filter.lower() in COUNTRY_NAME_MAP:
            country_filter = COUNTRY_NAME_MAP[country_filter.lower()]
        
        data = _query_gold_prices_clean(country=country_filter, karat=karat_filter)
        
        if not data:
            return jsonify({
                "success": True,
                "country": "مصر",
                "currency": "EGP",
                "prices": {
                    "24k": 6903,
                    "21k": 6040,
                    "18k": 5177,
                    "16k": 4602
                },
                "usd_rate_used": 51.67,
                "global_ounce_usd": 4155.11,
                "timestamp": datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
                "note": "بيانات تجريبية — gold_prices_clean لم يتم تعبئتها بعد"
            })
        
        # If filtering by country, return single-country format
        if country_filter and data.get('countries'):
            for c in data['countries']:
                if c['country'] == country_filter:
                    eng_name = 'Egypt'
                    for ar, en in COUNTRY_ARABIC_TO_ENGLISH.items():
                        if ar == c['country']:
                            eng_name = en
                            break
                    return jsonify({
                        "success": True,
                        "country": eng_name,
                        "currency": c['currency'],
                        "prices": c['prices'],
                        "usd_rate_used": c['usd_rate_used'],
                        "global_ounce_usd": data['global_ounce_usd'],
                        "timestamp": data['timestamp']
                    })
        
        # Return all countries
        return jsonify({
            "success": True,
            "timestamp": data['timestamp'],
            "global_ounce_usd": data['global_ounce_usd'],
            "countries": data['countries']
        })
    
    except Exception as e:
        logger.error(f"Error fetching gold: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/metals/gold/prices', methods=['GET'])
def get_gold_prices_clean():
    """
    أسعار الذهب النظيفة (بدون مصنعية/دمغة).
    
    Query params:
      - country: مصر | السعودية | الكويت | قطر (أو English: egypt | saudi-arabia | kuwait | qatar)
      - karat: 24 | 21 | 18 | 16
    
    Response:
    {
        "success": true,
        "country": "مصر",
        "currency": "EGP",
        "prices": {
            "24k": 6903,
            "21k": 6040,
            "18k": 5177,
            "16k": 4602
        },
        "usd_rate_used": 51.67,
        "global_ounce_usd": 4155.11,
        "timestamp": "2026-06-20T15:00:00"
    }
    """
    try:
        country_param = request.args.get('country', '')
        karat_param = request.args.get('karat', '')
        
        # Map English/Arabic country names
        country_arabic = None
        if country_param:
            # Check if it's an English name
            if country_param.lower() in COUNTRY_NAME_MAP:
                country_arabic = COUNTRY_NAME_MAP[country_param.lower()]
            elif country_param in ['مصر', 'السعودية', 'الكويت', 'قطر']:
                country_arabic = country_param
            else:
                return jsonify({
                    "success": False,
                    "error": f"الدولة '{country_param}' غير مدعومة. الدول المدعومة: مصر، السعودية، الكويت، قطر"
                }), 404
        
        # Map karat parameter
        karat_db = None
        if karat_param:
            karat_clean = karat_param.replace('k', '').replace('K', '')
            if karat_clean in ['24', '21', '18', '16']:
                karat_db = karat_clean
            else:
                return jsonify({
                    "success": False,
                    "error": f"العيار '{karat_param}' غير مدعوم. العيارات المدعومة: 24, 21, 18, 16"
                }), 400
        
        # الحصول على البيانات من DB
        data = _query_gold_prices_clean(country=country_arabic, karat=karat_db)
        
        if not data or not data.get('countries'):
            # Return estimated data if DB is empty
            import sqlite3
            from pathlib import Path
            
            # Try to get from exchange_rates for approximate calculation
            db_path = Path(__file__).parent.parent.parent / 'db' / 'data_engine.db'
            usd_rate = 51.67  # default fallback
            global_ounce = 4155.11
            
            if db_path.exists():
                try:
                    conn = sqlite3.connect(str(db_path))
                    c = conn.cursor()
                    c.execute('SELECT rate_to_usd FROM exchange_rates WHERE currency = ? ORDER BY id DESC LIMIT 1', ('EGP',))
                    row = c.fetchone()
                    if row:
                        usd_rate = round(float(row[0]) * 1.03, 2)  # black market ≈ bank + 3%
                    c.execute('SELECT price FROM commodity_intraday WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1', ('XAU',))
                    row = c.fetchone()
                    if row:
                        global_ounce = float(row[0])
                    conn.close()
                except Exception:
                    pass
            
            gram_24k_usd = global_ounce / 31.1035
            gram_24k_local = gram_24k_usd * usd_rate
            
            prices = {
                "24k": round(gram_24k_local * 1.0, 2),
                "21k": round(gram_24k_local * 0.875, 2),
                "18k": round(gram_24k_local * 0.75, 2),
                "16k": round(gram_24k_local * 0.6667, 2),
            }
            
            return jsonify({
                "success": True,
                "country": "Egypt",
                "currency": "EGP",
                "prices": prices,
                "usd_rate_used": usd_rate,
                "global_ounce_usd": global_ounce,
                "timestamp": datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
            })
        
        # If we have data, format it
        if country_arabic:
            for c in data['countries']:
                if c['country'] == country_arabic:
                    eng_name = COUNTRY_ARABIC_TO_ENGLISH.get(c['country'], c['country'])
                    return jsonify({
                        "success": True,
                        "country": eng_name,
                        "currency": c['currency'],
                        "prices": c['prices'],
                        "usd_rate_used": c['usd_rate_used'],
                        "global_ounce_usd": data['global_ounce_usd'],
                        "timestamp": data['timestamp']
                    })
        
        # Return first country as default
        first = data['countries'][0]
        eng_name = COUNTRY_ARABIC_TO_ENGLISH.get(first['country'], first['country'])
        return jsonify({
            "success": True,
            "country": eng_name,
            "currency": first['currency'],
            "prices": first['prices'],
            "usd_rate_used": first['usd_rate_used'],
            "global_ounce_usd": data['global_ounce_usd'],
            "timestamp": data['timestamp']
        })
    
    except Exception as e:
        logger.error(f"Error in gold/prices: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@data_engine_bp.route('/metals/silver', methods=['GET'])
def get_silver():
    """جلب أسعار الفضة فقط"""
    if not METALS_AVAILABLE:
        return jsonify({"success": False, "error": "Metals scraper not available"}), 503
    
    try:
        data = get_silver_prices()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "silver": data
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/metals/gold/<country>', methods=['GET'])
def get_gold_by_country(country):
    """جلب سعر الذهب لدولة محددة (بدون مصنعية/دمغة)"""
    try:
        # Map URL-friendly country names to Arabic
        arabic_country = country
        if country.lower() in COUNTRY_NAME_MAP:
            arabic_country = COUNTRY_NAME_MAP[country.lower()]
        
        data = _query_gold_prices_clean(country=arabic_country)
        
        if data and data.get('countries'):
            for c in data['countries']:
                if c['country'] == arabic_country:
                    eng_name = COUNTRY_ARABIC_TO_ENGLISH.get(c['country'], c['country'])
                    return jsonify({
                        "success": True,
                        "country": eng_name,
                        "currency": c['currency'],
                        "prices": c['prices'],
                        "usd_rate_used": c['usd_rate_used'],
                        "global_ounce_usd": data['global_ounce_usd'],
                        "timestamp": data['timestamp']
                    })
        
        # Fallback: try old MetalsScraper
        if METALS_AVAILABLE:
            try:
                scraper = MetalsScraper()
                old_data = scraper.get_country_gold_price(country)
                if old_data:
                    return jsonify({
                        "success": True,
                        "timestamp": datetime.now().isoformat(),
                        "country": country,
                        "data": old_data
                    })
            except Exception:
                pass
        
        return jsonify({
            "success": False,
            "error": f"No data for country: {country}"
        }), 404
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# CRYPTO ROUTES
# ==========================================

@data_engine_bp.route('/crypto', methods=['GET'])
def get_crypto():
    """جلب بيانات العملات الرقمية"""
    limit = int(request.args.get('limit', 50))
    
    if not CRYPTO_AVAILABLE:
        return jsonify({"success": False, "error": "Crypto scraper not available"}), 503
    
    try:
        scraper = CryptoScraper()
        data = scraper.fetch_all(limit=min(limit, 100))
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": data
        })
    except Exception as e:
        logger.error(f"Error fetching crypto: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/crypto/top', methods=['GET'])
def get_crypto_top():
    """جلب أهم العملات الرقمية"""
    limit = int(request.args.get('limit', 10))
    
    if not CRYPTO_AVAILABLE:
        return jsonify({"success": False, "error": "Crypto scraper not available"}), 503
    
    try:
        data = get_top_cryptos(limit)
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "count": len(data),
            "cryptos": data
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/crypto/btc-local', methods=['GET'])
def get_btc_local():
    """جلب سعر البيتكوين بالعملات المحلية"""
    if not CRYPTO_AVAILABLE:
        return jsonify({"success": False, "error": "Crypto scraper not available"}), 503
    
    try:
        scraper = CryptoScraper()
        prices = scraper.fetch_btc_local_prices()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "prices": {
                curr: price.__dict__ for curr, price in prices.items()
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# FOREX ROUTES
# ==========================================

@data_engine_bp.route('/forex', methods=['GET'])
def get_forex():
    """جلب أسعار الصرف"""
    if not FOREX_AVAILABLE:
        return jsonify({"success": False, "error": "Forex scraper not available"}), 503
    
    try:
        scraper = ForexScraper()
        data = scraper.get_all()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "data": data
        })
    except Exception as e:
        logger.error(f"Error fetching forex: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/forex/<currency>', methods=['GET'])
def get_forex_rate(currency):
    """جلب سعر صرف عملة محددة"""
    if not FOREX_AVAILABLE:
        return jsonify({"success": False, "error": "Forex scraper not available"}), 503
    
    try:
        scraper = ForexScraper()
        rate = scraper.fetch_rate(currency.upper())
        
        if rate:
            return jsonify({
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "rate": rate.__dict__
            })
        else:
            return jsonify({
                "success": False,
                "error": f"Unknown currency: {currency}"
            }), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/forex/convert', methods=['GET'])
def convert_forex():
    """تحويل العملات"""
    try:
        amount = float(request.args.get('amount', 100))
        from_currency = request.args.get('from', 'USD').upper()
        to_currency = request.args.get('to', 'EGP').upper()
    except:
        return jsonify({"success": False, "error": "Invalid parameters"}), 400
    
    if not FOREX_AVAILABLE:
        return jsonify({"success": False, "error": "Forex scraper not available"}), 503
    
    try:
        scraper = ForexScraper()
        result = scraper.convert(amount, from_currency, to_currency)
        
        if result:
            return jsonify({
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "conversion": {
                    "amount": amount,
                    "from": from_currency,
                    "to": to_currency,
                    "result": result
                }
            })
        else:
            return jsonify({
                "success": False,
                "error": "Could not convert"
            }), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# MARKET STATUS ROUTES
# ==========================================

@data_engine_bp.route('/status', methods=['GET'])
def get_status():
    """جلب حالة كل الأسواق"""
    if not MARKET_HOURS_AVAILABLE:
        return jsonify({"success": False, "error": "Market hours not available"}), 503
    
    try:
        statuses = get_all_markets_status()
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "markets": statuses
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/status/<market>', methods=['GET'])
def get_market_status_route(market):
    """جلب حالة سوق محدد"""
    if not MARKET_HOURS_AVAILABLE:
        return jsonify({"success": False, "error": "Market hours not available"}), 503
    
    try:
        status = get_market_status(market.upper())
        
        if 'error' in status:
            return jsonify({"success": False, "error": status['error']}), 404
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "status": status
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@data_engine_bp.route('/status/<market>/is-open', methods=['GET'])
def check_market_open(market):
    """التحقق من أن السوق مفتوح"""
    if not MARKET_HOURS_AVAILABLE:
        return jsonify({"success": False, "error": "Market hours not available"}), 503
    
    try:
        is_open = is_market_open(market.upper())
        
        return jsonify({
            "success": True,
            "timestamp": datetime.now().isoformat(),
            "market": market.upper(),
            "is_open": is_open,
            "status": "🟢 مفتوح" if is_open else "🔴 مغلق"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# HEALTH CHECK
# ==========================================

@data_engine_bp.route('/health', methods=['GET'])
def health_check():
    """فحص صحة النظام"""
    return jsonify({
        "success": True,
        "timestamp": datetime.now().isoformat(),
        "service": "data-engine",
        "version": "1.0.0",
        "modules": {
            "stocks": STOCKS_AVAILABLE,
            "metals": METALS_AVAILABLE,
            "crypto": CRYPTO_AVAILABLE,
            "forex": FOREX_AVAILABLE,
            "market_hours": MARKET_HOURS_AVAILABLE
        },
        "endpoints": [
            "/api/data-engine/stocks",
            "/api/data-engine/metals",
            "/api/data-engine/crypto",
            "/api/data-engine/forex",
            "/api/data-engine/status"
        ]
    })


# Print registration message
print("✓ Data Engine API registered (/api/data-engine/*)")
