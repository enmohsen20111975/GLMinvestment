# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Crypto Live Simulation — محاكاة حية للكريبتو
================================================
الكريبتو سوق 24/7 لا يغلق — مثالي للاختبار الحي.
يقرأ أسعار الكريبتو من data_engine.db (crypto_prices table — 59041 rows)
ويطبق PredictionOptimizer عليها.

Endpoint: GET /api/crypto/live-simulation
"""

from __future__ import annotations

import os
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

crypto_sim_bp = Blueprint('crypto_simulation', __name__, url_prefix='/api/crypto')

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = os.environ.get('DATA_ENGINE_DB', str(_PROJECT_ROOT / 'db' / 'data_engine.db'))


def _get_crypto_prices(symbol: str, limit: int = 200) -> List[Dict]:
    """جلب أسعار الكريبتو من data_engine.db."""
    if not os.path.exists(DATA_ENGINE_DB):
        return []
    
    conn = sqlite3.connect(DATA_ENGINE_DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT timestamp, price_usd, total_volume, price_change_24h, price_change_7d
            FROM crypto_prices
            WHERE symbol = ?
            ORDER BY timestamp DESC
            LIMIT ?
        """, (symbol.upper(), limit)).fetchall()
        
        prices = []
        for r in rows:
            prices.append({
                'timestamp': r['timestamp'],
                'price': r['price_usd'],
                'volume': r['total_volume'] or 0,
                'change_24h': r['price_change_24h'],
                'change_7d': r['price_change_7d'],
            })
        
        # Reverse to chronological order
        prices.reverse()
        return prices
    except Exception as e:
        logger.error(f"[CryptoSim] Error getting prices: {e}")
        return []
    finally:
        conn.close()


def _get_top_cryptos(limit: int = 20) -> List[Dict]:
    """أهم العملات الرقمية المتاحة."""
    if not os.path.exists(DATA_ENGINE_DB):
        return []
    
    conn = sqlite3.connect(DATA_ENGINE_DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT symbol, name, price_usd, price_change_24h, market_cap, total_volume
            FROM crypto_prices
            WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
            ORDER BY market_cap DESC
            LIMIT ?
        """, (limit,)).fetchall()
        
        return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"[CryptoSim] Error getting top cryptos: {e}")
        return []
    finally:
        conn.close()


@crypto_sim_bp.route('/live-simulation', methods=['GET'])
def live_simulation():
    """
    محاكاة حية للكريبتو — يطبق PredictionOptimizer على أهم العملات.
    Query params:
    - symbol: عملة معينة (default: top 10)
    - limit: عدد النتائج (default: 10)
    """
    try:
        import sys
        sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))
        from analyzers.prediction_optimizer import PredictionOptimizer
        
        symbol = request.args.get('symbol', '').upper()
        limit = int(request.args.get('limit', 10))
        
        engine = PredictionOptimizer()
        
        if symbol:
            # Analyze single crypto
            prices_data = _get_crypto_prices(symbol, 200)
            if len(prices_data) < 50:
                return jsonify({
                    'success': False,
                    'error': f'لا توجد بيانات كافية لـ {symbol} (يحتاج 50+ نقطة، وجد {len(prices_data)})'
                }), 400
            
            prices = [p['price'] for p in prices_data if p['price'] and p['price'] > 0]
            volumes = [p['volume'] for p in prices_data]
            
            result = engine.analyze(prices, prices, prices, volumes, ticker=symbol)
            
            return jsonify({
                'success': True,
                'data': {
                    'symbol': symbol,
                    'current_price': prices[-1] if prices else 0,
                    'signal': result.signal,
                    'score': result.score,
                    'entry': result.entry,
                    'target': result.target,
                    'stop': result.stop,
                    'risk_reward': result.risk_reward,
                    'conviction_factors': result.conviction_factors,
                    'regime': result.regime,
                    'skip_reason': result.skip_reason,
                    'data_points': len(prices),
                },
            })
        else:
            # Analyze top N cryptos
            top = _get_top_cryptos(limit)
            if not top:
                return jsonify({
                    'success': False,
                    'error': 'لا توجد بيانات كريبتو متاحة'
                }), 404
            
            results = []
            for crypto in top:
                sym = crypto['symbol']
                prices_data = _get_crypto_prices(sym, 200)
                if len(prices_data) < 50:
                    continue
                
                prices = [p['price'] for p in prices_data if p['price'] and p['price'] > 0]
                volumes = [p['volume'] for p in prices_data]
                
                result = engine.analyze(prices, prices, prices, volumes, ticker=sym)
                
                results.append({
                    'symbol': sym,
                    'name': crypto['name'],
                    'current_price': crypto['price_usd'],
                    'change_24h': crypto['price_change_24h'],
                    'signal': result.signal,
                    'score': result.score,
                    'conviction': len(result.conviction_factors),
                    'conviction_factors': result.conviction_factors,
                    'regime': result.regime,
                    'entry': result.entry if result.signal != 'HOLD' else None,
                    'target': result.target if result.signal != 'HOLD' else None,
                    'stop': result.stop if result.signal != 'HOLD' else None,
                    'risk_reward': result.risk_reward if result.signal != 'HOLD' else None,
                })
            
            # Sort by signal strength (BUY first, then SELL, then HOLD)
            signal_order = {'BUY': 0, 'SELL': 1, 'HOLD': 2}
            results.sort(key=lambda x: (signal_order.get(x['signal'], 3), -x['score']))
            
            buy_count = sum(1 for r in results if r['signal'] == 'BUY')
            sell_count = sum(1 for r in results if r['signal'] == 'SELL')
            hold_count = sum(1 for r in results if r['signal'] == 'HOLD')
            
            return jsonify({
                'success': True,
                'data': {
                    'total_analyzed': len(results),
                    'buy_signals': buy_count,
                    'sell_signals': sell_count,
                    'hold_signals': hold_count,
                    'cryptos': results,
                    'timestamp': datetime.now().isoformat(),
                },
            })
    
    except Exception as e:
        logger.error(f"[CryptoSim] Error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@crypto_sim_bp.route('/available', methods=['GET'])
def available_cryptos():
    """قائمة العملات الرقمية المتاحة للمحاكاة."""
    try:
        top = _get_top_cryptos(50)
        return jsonify({
            'success': True,
            'data': {
                'total': len(top),
                'cryptos': [{'symbol': c['symbol'], 'name': c['name'], 'price': c['price_usd']} for c in top],
            },
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@crypto_sim_bp.route('/historical-backtest', methods=['GET'])
def historical_backtest():
    """
    Backtest تاريخي للكريبتو.
    Query params:
    - symbol: عملة معينة (default: BTC)
    - days: عدد الأيام (default: 60)
    """
    try:
        import sys
        sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))
        from analyzers.prediction_optimizer import PredictionOptimizer
        
        symbol = request.args.get('symbol', 'BTC').upper()
        days = int(request.args.get('days', 60))
        max_holding = 20
        
        prices_data = _get_crypto_prices(symbol, 500)
        if len(prices_data) < 100 + days + max_holding:
            return jsonify({
                'success': False,
                'error': f'لا توجد بيانات كافية لـ {symbol}'
            }), 400
        
        prices = [p['price'] for p in prices_data if p['price'] and p['price'] > 0]
        volumes = [p['volume'] for p in prices_data]
        
        engine = PredictionOptimizer()
        all_trades = []
        
        for sim_day in range(days):
            entry_idx = len(prices) - days - max_holding + sim_day
            if entry_idx < 100 or entry_idx + max_holding >= len(prices):
                continue
            
            hp = prices[:entry_idx + 1]
            hv = volumes[:entry_idx + 1]
            fp = prices[entry_idx + 1:]
            
            result = engine.analyze(hp, hp, hp, hv, ticker=symbol)
            if result.signal == 'HOLD':
                continue
            
            # Simulate
            for i, price in enumerate(fp[:max_holding]):
                if result.signal == 'BUY':
                    if price >= result.target:
                        all_trades.append({'return': (result.target - result.entry) / result.entry * 100, 'signal': 'BUY', 'outcome': 'TARGET_HIT'})
                        break
                    if price <= result.stop:
                        all_trades.append({'return': (result.stop - result.entry) / result.entry * 100, 'signal': 'BUY', 'outcome': 'STOPPED'})
                        break
                else:
                    if price <= result.target:
                        all_trades.append({'return': (result.entry - result.target) / result.entry * 100, 'signal': 'SELL', 'outcome': 'TARGET_HIT'})
                        break
                    if price >= result.stop:
                        all_trades.append({'return': (result.entry - result.stop) / result.entry * 100, 'signal': 'SELL', 'outcome': 'STOPPED'})
                        break
            else:
                last = fp[min(max_holding - 1, len(fp) - 1)]
                if result.signal == 'BUY':
                    all_trades.append({'return': (last - result.entry) / result.entry * 100, 'signal': 'BUY', 'outcome': 'EXPIRED'})
                else:
                    all_trades.append({'return': (result.entry - last) / result.entry * 100, 'signal': 'SELL', 'outcome': 'EXPIRED'})
        
        if not all_trades:
            return jsonify({
                'success': True,
                'data': {'symbol': symbol, 'trades': 0, 'message': 'لا توجد صفقات'}
            })
        
        total = len(all_trades)
        wins = sum(1 for t in all_trades if t['return'] > 0)
        wr = wins / total * 100
        returns = [t['return'] for t in all_trades]
        avg_ret = sum(returns) / total
        gp = sum(r for r in returns if r > 0)
        gl = abs(sum(r for r in returns if r < 0))
        pf = gp / gl if gl > 0 else 0
        
        return jsonify({
            'success': True,
            'data': {
                'symbol': symbol,
                'trades': total,
                'win_rate': round(wr, 1),
                'profit_factor': round(pf, 2),
                'avg_return': round(avg_ret, 2),
                'wins': wins,
                'losses': total - wins,
                'days_tested': days,
            },
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
