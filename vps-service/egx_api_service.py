#!/usr/bin/env python3
"""
EGX Data API Service
====================
A Flask-based API service to fetch EGX stock market data.
Designed to run on VPS and be called by Next.js app on Hostinger.

Endpoints:
- GET /health - Health check
- GET /api/stocks - Fetch all EGX stocks
- GET /api/indices - Fetch EGX indices (EGX30, EGX50, etc.)
- GET /api/gold - Fetch gold prices
- POST /api/sync - Full sync all data
- GET /api/stock/<symbol> - Fetch single stock data
"""

import os
import json
import time
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

# Try to import data sources
DATA_SOURCES = {}

try:
    from tradingview_ta import TA_Handler, get_multiple_analysis
    DATA_SOURCES['tradingview'] = True
    print("✓ TradingView TA available")
except ImportError:
    DATA_SOURCES['tradingview'] = False
    print("✗ TradingView TA not available")

try:
    import egxpy
    DATA_SOURCES['egxpy'] = True
    print("✓ egxpy available")
except ImportError:
    DATA_SOURCES['egxpy'] = False
    print("✗ egxpy not available")

app = Flask(__name__)
CORS(app)

# EGX Stock Symbols - All active stocks
EGX_STOCKS = [
    "COMI", "HRHO", "SWDY", "ETAL", "EGIS", "PHDC", "CCAP", "EFIH",
    "AMRI", "MNHD", "TALAAT", "FWRI", "BEMI", "KABI", "ORHD", "EZDK",
    "ALCN", "SODIC", "CAII", "ODIH", "HELI", "PRCL", "OCDI", "ALCL",
    "CIRA", "SKPC", "EAST", "ATLC", "RAYA", "AMOC", "ESRS", "ABUK",
    "APRI", "MTIE", "NTRA", "EGTS", "DCRC", "ESPA", "ISPT", "GENI",
    "NISP", "ICFI", "RABK", "NENP", "ICPM", "RMDA", "ACGC", "EDFO",
    "KROM", "ADHI", "MCQE", "AMER", "UNIT", "OILS", "SAMO", "MEDH",
    "CICH", "SPMD", "HDBK", "BEHI", "AHTB", "ZMFS", "OKIA", "GPCI",
    "FTNS", "BNII", "CIEB", "IRAX", "CNOL", "BTFH", "MPCI", "AIND",
    "DIIN", "GOE", "ANFI", "ALSL", "GCFO", "FORC", "ATWA", "ELPA",
    "ATFA", "MDIN", "CBFT", "MISR", "BNEX", "EIBK", "BINT", "FAIT",
    "MASA", "BFRI", "ELHA", "GDNT", "CATA", "SMPA", "NTRA", "MNHT",
    "KHLT", "SAUD", "HANY", "GTX", "BPAW", "MOIN", "CICH", "APIC"
]

# EGX Index Symbols
EGX_INDICES = [
    {"symbol": "EGX30", "tv_symbol": "EGX30", "exchange": "EGX"},
    {"symbol": "EGX50", "tv_symbol": "EGX50", "exchange": "EGX"},
    {"symbol": "EGX70", "tv_symbol": "EGX70", "exchange": "EGX"},
    {"symbol": "EGX100", "tv_symbol": "EGX100", "exchange": "EGX"},
    {"symbol": "EGX30C", "tv_symbol": "EGX30CAPPED", "exchange": "EGX"},
]

# Gold Symbols
GOLD_SYMBOLS = [
    {"symbol": "XAUUSD", "tv_symbol": "XAUUSD", "exchange": "TVC"},
    {"symbol": "XAGEUR", "tv_symbol": "XAGEUR", "exchange": "TVC"},
    {"symbol": "XAUEUR", "tv_symbol": "XAUEUR", "exchange": "TVC"},
]


def fetch_from_tradingview(symbols, exchange="EGX", batch_size=20):
    """Fetch data from TradingView for multiple symbols."""
    if not DATA_SOURCES.get('tradingview'):
        return None, "TradingView TA not available"
    
    results = []
    errors = []
    
    # Build TradingView symbols
    tv_symbols = [f"{exchange}:{symbol}" for symbol in symbols]
    
    try:
        # Use batch analysis for efficiency
        for i in range(0, len(tv_symbols), batch_size):
            batch = tv_symbols[i:i+batch_size]
            
            try:
                analysis = get_multiple_analysis(
                    symbols=batch,
                    interval="1d"
                )
                
                for symbol, data in analysis.items():
                    if data:
                        clean_symbol = symbol.split(":")[1] if ":" in symbol else symbol
                        results.append({
                            "symbol": clean_symbol,
                            "price": data.indicators.get("close", 0),
                            "change": data.indicators.get("change", 0),
                            "change_percent": data.indicators.get("change_perc", 0),
                            "volume": data.indicators.get("volume", 0),
                            "high": data.indicators.get("high", 0),
                            "low": data.indicators.get("low", 0),
                            "open": data.indicators.get("open", 0),
                            "timestamp": datetime.now().isoformat(),
                            "source": "tradingview"
                        })
                
                # Rate limiting
                time.sleep(1)
                
            except Exception as e:
                errors.append(f"Batch {i//batch_size}: {str(e)}")
                time.sleep(2)
        
        return results, errors
        
    except Exception as e:
        return None, str(e)


def fetch_single_stock_tv(symbol, exchange="EGX"):
    """Fetch single stock data from TradingView."""
    if not DATA_SOURCES.get('tradingview'):
        return None, "TradingView TA not available"
    
    try:
        handler = TA_Handler(
            symbol=symbol,
            exchange=exchange,
            screener="egypt",
            interval="1d"
        )
        analysis = handler.get_analysis()
        
        if analysis:
            return {
                "symbol": symbol,
                "price": analysis.indicators.get("close", 0),
                "change": analysis.indicators.get("change", 0),
                "change_percent": analysis.indicators.get("change_perc", 0),
                "volume": analysis.indicators.get("volume", 0),
                "high": analysis.indicators.get("high", 0),
                "low": analysis.indicators.get("low", 0),
                "open": analysis.indicators.get("open", 0),
                "timestamp": datetime.now().isoformat(),
                "source": "tradingview"
            }, None
        return None, "No data returned"
        
    except Exception as e:
        return None, str(e)


def fetch_from_egxpy(symbols):
    """Fetch data using egxpy library."""
    if not DATA_SOURCES.get('egxpy'):
        return None, "egxpy not available"
    
    try:
        results = []
        errors = []
        
        for symbol in symbols:
            try:
                # Call egxpy to get stock data
                data = egxpy.get_stock_data(symbol)
                if data:
                    results.append({
                        "symbol": symbol,
                        "price": data.get("price", 0),
                        "change": data.get("change", 0),
                        "change_percent": data.get("change_percent", 0),
                        "volume": data.get("volume", 0),
                        "high": data.get("high", 0),
                        "low": data.get("low", 0),
                        "open": data.get("open", 0),
                        "timestamp": datetime.now().isoformat(),
                        "source": "egxpy"
                    })
            except Exception as e:
                errors.append(f"{symbol}: {str(e)}")
        
        return results, errors
        
    except Exception as e:
        return None, str(e)


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "data_sources": DATA_SOURCES,
        "stocks_count": len(EGX_STOCKS),
        "indices_count": len(EGX_INDICES)
    })


@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    """Fetch all EGX stocks."""
    use_egxpy = request.args.get('egxpy', 'false').lower() == 'true'
    
    # Determine which data source to use
    if use_egxpy and DATA_SOURCES.get('egxpy'):
        data, errors = fetch_from_egxpy(EGX_STOCKS)
    elif DATA_SOURCES.get('tradingview'):
        data, errors = fetch_from_tradingview(EGX_STOCKS, "EGX")
    else:
        return jsonify({
            "success": False,
            "error": "No data source available"
        }), 500
    
    if data is None:
        return jsonify({
            "success": False,
            "error": errors
        }), 500
    
    return jsonify({
        "success": True,
        "count": len(data),
        "data": data,
        "errors": errors if errors else None,
        "timestamp": datetime.now().isoformat()
    })


@app.route('/api/stock/<symbol>', methods=['GET'])
def get_stock(symbol):
    """Fetch single stock data."""
    symbol = symbol.upper()
    exchange = request.args.get('exchange', 'EGX')
    
    if DATA_SOURCES.get('tradingview'):
        data, error = fetch_single_stock_tv(symbol, exchange)
    else:
        return jsonify({
            "success": False,
            "error": "No data source available"
        }), 500
    
    if data is None:
        return jsonify({
            "success": False,
            "error": error
        }), 404
    
    return jsonify({
        "success": True,
        "data": data
    })


@app.route('/api/indices', methods=['GET'])
def get_indices():
    """Fetch EGX indices."""
    symbols = [idx["tv_symbol"] for idx in EGX_INDICES]
    
    if DATA_SOURCES.get('tradingview'):
        data, errors = fetch_from_tradingview(symbols, "EGX")
    else:
        return jsonify({
            "success": False,
            "error": "No data source available"
        }), 500
    
    if data is None:
        return jsonify({
            "success": False,
            "error": errors
        }), 500
    
    # Map back to original symbols
    for i, item in enumerate(data):
        for idx in EGX_INDICES:
            if idx["tv_symbol"] == item["symbol"]:
                item["original_symbol"] = idx["symbol"]
    
    return jsonify({
        "success": True,
        "count": len(data),
        "data": data,
        "errors": errors if errors else None,
        "timestamp": datetime.now().isoformat()
    })


@app.route('/api/gold', methods=['GET'])
def get_gold():
    """Fetch gold prices."""
    results = []
    errors = []
    
    if not DATA_SOURCES.get('tradingview'):
        return jsonify({
            "success": False,
            "error": "No data source available"
        }), 500
    
    for gold in GOLD_SYMBOLS:
        data, error = fetch_single_stock_tv(gold["tv_symbol"], gold["exchange"])
        if data:
            data["original_symbol"] = gold["symbol"]
            results.append(data)
        else:
            errors.append(f"{gold['symbol']}: {error}")
        time.sleep(0.5)  # Rate limiting
    
    return jsonify({
        "success": True,
        "count": len(results),
        "data": results,
        "errors": errors if errors else None,
        "timestamp": datetime.now().isoformat()
    })


@app.route('/api/sync', methods=['POST'])
def sync_all():
    """
    Full sync all data - stocks, indices, and gold.
    Returns data in format ready for Next.js app.
    """
    all_data = {
        "stocks": [],
        "indices": [],
        "gold": [],
        "errors": [],
        "timestamp": datetime.now().isoformat()
    }
    
    # Sync stocks
    if DATA_SOURCES.get('tradingview'):
        stocks, stock_errors = fetch_from_tradingview(EGX_STOCKS[:50], "EGX")  # Limit for rate
        if stocks:
            all_data["stocks"] = stocks
        if stock_errors:
            all_data["errors"].extend([f"Stock: {e}" for e in stock_errors])
    
    time.sleep(2)  # Rate limiting
    
    # Sync indices
    symbols = [idx["tv_symbol"] for idx in EGX_INDICES]
    indices, idx_errors = fetch_from_tradingview(symbols, "EGX")
    if indices:
        all_data["indices"] = indices
    if idx_errors:
        all_data["errors"].extend([f"Index: {e}" for e in idx_errors])
    
    time.sleep(1)
    
    # Sync gold
    for gold in GOLD_SYMBOLS[:2]:  # Limit to main gold prices
        data, error = fetch_single_stock_tv(gold["tv_symbol"], gold["exchange"])
        if data:
            data["original_symbol"] = gold["symbol"]
            all_data["gold"].append(data)
        if error:
            all_data["errors"].append(f"Gold {gold['symbol']}: {error}")
        time.sleep(0.5)
    
    return jsonify({
        "success": True,
        "data": all_data,
        "summary": {
            "stocks_count": len(all_data["stocks"]),
            "indices_count": len(all_data["indices"]),
            "gold_count": len(all_data["gold"]),
            "errors_count": len(all_data["errors"])
        }
    })


@app.route('/api/search', methods=['GET'])
def search_stocks():
    """Search for stocks by symbol or name."""
    query = request.args.get('q', '').upper()
    
    if not query:
        return jsonify({
            "success": False,
            "error": "Missing search query"
        }), 400
    
    # Simple search in our symbol list
    matches = [s for s in EGX_STOCKS if query in s]
    
    return jsonify({
        "success": True,
        "query": query,
        "matches": matches,
        "count": len(matches)
    })


# Error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({
        "success": False,
        "error": "Endpoint not found"
    }), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({
        "success": False,
        "error": "Internal server error"
    }), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n{'='*60}")
    print(f"EGX Data API Service")
    print(f"{'='*60}")
    print(f"Available Data Sources: {DATA_SOURCES}")
    print(f"Stocks configured: {len(EGX_STOCKS)}")
    print(f"Indices configured: {len(EGX_INDICES)}")
    print(f"Gold symbols configured: {len(GOLD_SYMBOLS)}")
    print(f"Starting server on port {port}...")
    print(f"{'='*60}\n")
    
    app.run(host='0.0.0.0', port=port, debug=False)
