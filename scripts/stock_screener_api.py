#!/usr/bin/env python3
"""
stock_screener_api.py — API للـ Stock Screener

يبني على hybrid_stage_analyzer_v2.py + يـدي endpoint سهل للمنصة.

Endpoints:
  GET /api/stock-screener/analyze?ticker=COMI
    → تحليل سهم واحد بـ الـ 4 طبقات

  GET /api/stock-screener/scan?market=EGX&limit=100
    → مسح كل الأسهم + ترتيب بـ score

  GET /api/stock-screener/recommendations?market=EGX&rec=BUY
    → فلترة بـ التوصية (STRONG_BUY/BUY/HOLD/REDUCE/SELL)

  GET /api/stock-screener/market-context
    → حالة السوق العام (EGX30 regime)
"""
import sys
import os
import json
import sqlite3
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

warnings_ok = True
try:
    import warnings
    warnings.filterwarnings('ignore')
except Exception:
    warnings_ok = False

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'
sys.path.insert(0, str(PROJECT / 'scripts'))
sys.path.insert(0, str(PROJECT / 'vps-service'))

from hybrid_stage_analyzer_v2 import (
    analyze_stock_hybrid_v2, layer_market_context, layer1_hmm_market_regime_v2
)
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


# ═══════════════════════════════════════════════════════════════════════
# Helper: تحميل بيانات ticker
# ═══════════════════════════════════════════════════════════════════════

def load_ticker_data(ticker: str, lookback_days: int = 600) -> Optional[Dict]:
    """تحميل بيانات ticker من price_history.db"""
    ph_db = DB_DIR / 'price_history.db'
    if not ph_db.exists():
        return None

    try:
        conn = sqlite3.connect(str(ph_db))
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            AND close_price IS NOT NULL AND close_price > 0
            AND high_price IS NOT NULL AND low_price IS NOT NULL
            ORDER BY date DESC
            LIMIT ?
        """, (ticker, lookback_days)).fetchall()
        conn.close()

        if not rows or len(rows) < 60:
            return None

        # عكس الترتيب (من الأقدم للأحدث)
        rows = list(reversed(rows))
        return {
            'dates': [r['date'] for r in rows],
            'opens': [r['open_price'] for r in rows],
            'highs': [r['high_price'] for r in rows],
            'lows': [r['low_price'] for r in rows],
            'closes': [r['close_price'] for r in rows],
            'volumes': [r['volume'] or 0 for r in rows],
        }
    except Exception as e:
        return None


def load_all_tickers(market: str = 'EGX', min_days: int = 200, limit: int = 100) -> List[Dict]:
    """تحميل قائمة tickers بـ data كافية"""
    ph_db = DB_DIR / 'price_history.db'
    if not ph_db.exists():
        return []

    try:
        conn = sqlite3.connect(str(ph_db))
        conn.row_factory = sqlite3.Row
        tickers = conn.execute("""
            SELECT ticker, COUNT(*) as cnt, MAX(date) as last_date
            FROM price_history
            GROUP BY ticker
            HAVING cnt >= ?
            ORDER BY ticker
            LIMIT ?
        """, (min_days, limit * 3)).fetchall()  # ×3 عشان بعد فلتر الـ EGX
        conn.close()

        # فلتر بـ الـ market (EGX = غير خليجي + غير crypto)
        result = []
        for t in tickers:
            ticker = t['ticker']
            # فلتر بسيط: لو ticker كله أرقام أو حروف لاتينية → EGX
            # لو فيه ARAB/SAUD/etc → خليجي (نتجاهل)
            if any(x in ticker for x in ['SAUD', 'ARAB', 'QATAR', 'DUBAI', 'ABU']):
                continue
            # فلتر crypto (BTC, ETH, إلخ)
            if ticker in ['BTC', 'ETH', 'BNB', 'ADA', 'XRP', 'SOL', 'DOT', 'DOGE',
                          'MATIC', 'AVAX', 'LINK', 'UNI', 'LTC', 'ATOM', 'XLM']:
                continue
            # فلتر ETFs أمريكية (SPY, VOO, إلخ)
            if ticker in ['SPY', 'VOO', 'QQQ', 'XLF', 'XLE', 'XLK', 'XLI', 'XLV',
                          'XLY', 'XLP', 'XLB', 'XLU', 'XLRE', 'XLC']:
                continue
            result.append({'ticker': ticker, 'last_date': t['last_date'], 'cnt': t['cnt']})
            if len(result) >= limit:
                break
        return result
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════
# Cache بسيط
# ═══════════════════════════════════════════════════════════════════════

_cache = {}
CACHE_TTL = 300  # 5 دقايق


def get_cached(key: str) -> Optional[Any]:
    if key in _cache:
        ts, val = _cache[key]
        if (datetime.now() - ts).seconds < CACHE_TTL:
            return val
    return None


def set_cached(key: str, val: Any):
    _cache[key] = (datetime.now(), val)


# ═══════════════════════════════════════════════════════════════════════
# API Endpoints
# ═══════════════════════════════════════════════════════════════════════

@app.route('/api/stock-screener/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({
        'status': 'ok',
        'service': 'stock-screener-api',
        'version': 'v2',
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/api/stock-screener/market-context', methods=['GET'])
def market_context():
    """حالة السوق العام (EGX30 regime)"""
    cache_key = 'market_context'
    cached = get_cached(cache_key)
    if cached:
        return jsonify(cached)

    try:
        mc = layer_market_context()
        result = {
            'regime': mc['regime'],
            'confidence': mc['confidence'],
            'veto_buy': mc['veto_buy'],
            'method': mc['method'],
            'timestamp': datetime.now().isoformat(),
        }
        set_cached(cache_key, result)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/stock-screener/analyze', methods=['GET'])
def analyze_ticker():
    """
    تحليل سهم واحد بـ الـ 4 طبقات.

    Query params:
      ticker: اسم السهم (مثلاً COMI)
    """
    ticker = request.args.get('ticker', '').upper().strip()
    if not ticker:
        return jsonify({'error': 'ticker parameter required'}), 400

    cache_key = f'analyze_{ticker}'
    cached = get_cached(cache_key)
    if cached:
        return jsonify(cached)

    try:
        data = load_ticker_data(ticker)
        if not data:
            return jsonify({'error': f'no data for ticker {ticker}'}), 404

        # Market context
        mc = layer_market_context()

        # Run hybrid analysis
        analysis = analyze_stock_hybrid_v2(
            data['closes'], data['highs'], data['lows'], data['volumes'],
            ticker=ticker, market_context=mc
        )

        # Build response
        response = {
            'ticker': ticker,
            'current_price': analysis.get('current_price'),
            'last_date': data['dates'][-1] if data['dates'] else None,
            'rsi': analysis.get('rsi'),
            'recommendation': analysis.get('recommendation'),
            'hybrid_score': analysis.get('hybrid_score'),
            'veto_applied': analysis.get('veto_applied', False),
            'market_context': analysis.get('market_context', {}),
            'layers': {
                'l1_hmm_stock': {
                    'regime': analysis.get('layer1_hmm_stock', {}).get('regime'),
                    'confidence': analysis.get('layer1_hmm_stock', {}).get('confidence'),
                    'method': analysis.get('layer1_hmm_stock', {}).get('method'),
                },
                'l2_wyckoff': {
                    'phase': analysis.get('layer2_wyckoff', {}).get('phase'),
                    'phase_ar': analysis.get('layer2_wyckoff', {}).get('phase_ar'),
                    'has_accumulation': analysis.get('layer2_wyckoff', {}).get('has_accumulation'),
                    'has_spring': analysis.get('layer2_wyckoff', {}).get('has_spring'),
                    'has_sos': analysis.get('layer2_wyckoff', {}).get('has_sos'),
                },
                'l3_weinstein': {
                    'stage': analysis.get('layer3_weinstein', {}).get('stage'),
                    'stage_ar': analysis.get('layer3_weinstein', {}).get('stage_ar'),
                    'ma_slope': analysis.get('layer3_weinstein', {}).get('ma_slope'),
                    'distance_from_ma': analysis.get('layer3_weinstein', {}).get('distance_from_ma'),
                },
                'l4_volume': {
                    'poc': analysis.get('layer4_volume', {}).get('poc'),
                    'vah': analysis.get('layer4_volume', {}).get('vah'),
                    'val': analysis.get('layer4_volume', {}).get('val'),
                    'position': analysis.get('layer4_volume', {}).get('position'),
                    'breakout_confirmed': analysis.get('layer4_volume', {}).get('breakout_confirmed'),
                },
            },
            'dynamic_weights': analysis.get('dynamic_weights', {}),
            'reasons': analysis.get('reasons', []),
            'timestamp': datetime.now().isoformat(),
        }

        set_cached(cache_key, response)
        return jsonify(response)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/stock-screener/scan', methods=['GET'])
def scan_market():
    """
    مسح كل الأسهم + ترتيب بـ score.

    Query params:
      market: EGX (default)
      limit: 100 (default — max 500)
      min_score: -100 (default)
    """
    market = request.args.get('market', 'EGX')
    limit = min(int(request.args.get('limit', 100)), 500)
    min_score = float(request.args.get('min_score', -100))

    cache_key = f'scan_{market}_{limit}_{min_score}'
    cached = get_cached(cache_key)
    if cached:
        return jsonify(cached)

    try:
        tickers = load_all_tickers(market=market, min_days=200, limit=limit)
        if not tickers:
            return jsonify({'error': 'no tickers found'}), 404

        # Market context (مرة واحدة)
        mc = layer_market_context()

        results = []
        for i, t in enumerate(tickers):
            if i % 20 == 0:
                print(f'  Scanning {i+1}/{len(tickers)}...', flush=True)

            data = load_ticker_data(t['ticker'])
            if not data or len(data['closes']) < 200:
                continue

            try:
                analysis = analyze_stock_hybrid_v2(
                    data['closes'], data['highs'], data['lows'], data['volumes'],
                    ticker=t['ticker'], market_context=mc
                )
                if analysis.get('hybrid_score', -100) >= min_score:
                    results.append({
                        'ticker': t['ticker'],
                        'current_price': analysis.get('current_price'),
                        'recommendation': analysis.get('recommendation'),
                        'hybrid_score': analysis.get('hybrid_score'),
                        'rsi': analysis.get('rsi'),
                        'weinstein_stage': analysis.get('layer3_weinstein', {}).get('stage_ar'),
                        'wyckoff_phase': analysis.get('layer2_wyckoff', {}).get('phase_ar'),
                        'last_date': t['last_date'],
                    })
            except Exception:
                continue

        # ترتيب بـ score
        results.sort(key=lambda x: -x.get('hybrid_score', 0))

        response = {
            'market': market,
            'market_context': {
                'regime': mc['regime'],
                'confidence': mc['confidence'],
                'veto_buy': mc['veto_buy'],
            },
            'total_scanned': len(tickers),
            'total_results': len(results),
            'results': results,
            'timestamp': datetime.now().isoformat(),
        }

        set_cached(cache_key, response)
        return jsonify(response)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/stock-screener/recommendations', methods=['GET'])
def get_recommendations():
    """
    فلترة بـ التوصية.

    Query params:
      rec: STRONG_BUY / BUY / HOLD / REDUCE / SELL
      market: EGX (default)
      limit: 50 (default)
    """
    rec = request.args.get('rec', 'BUY').upper()
    market = request.args.get('market', 'EGX')
    limit = min(int(request.args.get('limit', 50)), 200)

    if rec not in ['STRONG_BUY', 'BUY', 'HOLD', 'REDUCE', 'SELL']:
        return jsonify({'error': 'invalid rec parameter'}), 400

    cache_key = f'recs_{rec}_{market}_{limit}'
    cached = get_cached(cache_key)
    if cached:
        return jsonify(cached)

    try:
        tickers = load_all_tickers(market=market, min_days=200, limit=300)
        mc = layer_market_context()

        results = []
        for t in tickers:
            data = load_ticker_data(t['ticker'])
            if not data or len(data['closes']) < 200:
                continue

            try:
                analysis = analyze_stock_hybrid_v2(
                    data['closes'], data['highs'], data['lows'], data['volumes'],
                    ticker=t['ticker'], market_context=mc
                )
                if analysis.get('recommendation') == rec:
                    results.append({
                        'ticker': t['ticker'],
                        'current_price': analysis.get('current_price'),
                        'hybrid_score': analysis.get('hybrid_score'),
                        'rsi': analysis.get('rsi'),
                        'weinstein_stage': analysis.get('layer3_weinstein', {}).get('stage_ar'),
                        'wyckoff_phase': analysis.get('layer2_wyckoff', {}).get('phase_ar'),
                    })
                    if len(results) >= limit:
                        break
            except Exception:
                continue

        results.sort(key=lambda x: -x.get('hybrid_score', 0))

        response = {
            'recommendation': rec,
            'market': market,
            'count': len(results),
            'results': results,
            'timestamp': datetime.now().isoformat(),
        }

        set_cached(cache_key, response)
        return jsonify(response)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print(f"\n{'='*80}")
    print(f"  🚀 Stock Screener API — v2 (Hybrid Stage Analyzer)")
    print(f"{'='*80}")
    print(f"\n  Endpoints:")
    print(f"    GET /api/stock-screener/health")
    print(f"    GET /api/stock-screener/market-context")
    print(f"    GET /api/stock-screener/analyze?ticker=COMI")
    print(f"    GET /api/stock-screener/scan?market=EGX&limit=100")
    print(f"    GET /api/stock-screener/recommendations?rec=BUY&limit=50")
    print(f"\n  Starting on port 8012...")
    print(f"{'='*80}\n")

    app.run(host='0.0.0.0', port=8012, debug=False, threaded=True)
