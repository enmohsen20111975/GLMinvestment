#!/usr/bin/env python3
"""
Unified Stock Analysis Engine — المحرك الواحد
=================================================
القاعدة: محرك واحد → نتائج واحدة في أي مكان.

ده الـ SINGLE SOURCE OF TRUTH لتحليل أي سهم:
  - بـ يقرأ OHLCV من data_engine.db (التاريخ الكامل)
  - بـ يحسب stock_state (من stock_state.py)
  - بـ يطبق V68 filters (dirty_dist, no_chase, oracle_probability)
  - بـ يطبق V72 filters (hidden_dist, wash_trade)
  - بـ يطبق V73 filters (desert_phase, auction_trap)
  - بـ يقرأ predictions.db (فيه توقع نشط؟)
  - بـ يرجع نتيجة واحدة متكاملة

كل الـ UIs/APIs بتـ query ده الـ endpoint → نفس النتيجة.

Usage:
  GET /api/unified-analysis?ticker=COMI
  GET /api/unified-analysis?market=EGX&limit=50  (batch)

Author: Z.ai Code
Date: 2026-09-01
"""

import sqlite3
import json
import os
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'


def _get_ohlcv(ticker: str, days: int = 60) -> Dict[str, List]:
    """جيب OHLCV — بـ يستخدم Production Data Client (Yahoo live → data_engine fallback)."""
    try:
        from analyzers.production_data_client import get_data_client
        client = get_data_client()
        ohlcv = client.get_ohlcv(ticker, days)
        if ohlcv['closes']:
            return ohlcv
    except Exception:
        pass

    # Fallback to local data_engine.db
    if not DATA_ENGINE_DB.exists():
        return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(DATA_ENGINE_DB), writable=False)
        rows = conn.execute('''
            SELECT price_date, open_price, high_price, low_price, close_price, volume
            FROM egksco_price_history
            WHERE symbol = ? AND volume IS NOT NULL
            ORDER BY price_date DESC LIMIT ?
        ''', (ticker, days)).fetchall()
        conn.close()
        if not rows:
            return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}
        rows = list(reversed(rows))
        return {
            'dates': [r[0] for r in rows],
            'opens': [float(r[1] or 0) for r in rows],
            'highs': [float(r[2] or 0) for r in rows],
            'lows': [float(r[3] or 0) for r in rows],
            'closes': [float(r[4] or 0) for r in rows],
            'volumes': [float(r[5] or 0) for r in rows],
        }
    except Exception:
        return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}


def _get_stock_meta(ticker: str) -> Dict:
    """جيب metadata من stocks.db (sector, market_cap, pe, etc)."""
    if not STOCKS_DB.exists():
        return {}
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(STOCKS_DB), writable=False)
        conn.row_factory = sqlite3.Row
        row = conn.execute('''
            SELECT ticker, name_ar, sector, current_price, change_percent, volume,
                   market_cap, pe_ratio, roe, rsi, ma_50, ma_200, high_52w, low_52w,
                   turnover_egp, dividend_yield, avg_volume
            FROM stocks WHERE ticker = ? AND is_active = 1
        ''', (ticker,)).fetchone()
        conn.close()
        if not row:
            return {}
        return {k: row[k] for k in row.keys()}
    except Exception:
        return {}


def _get_active_prediction(ticker: str) -> Optional[Dict]:
    """جيب التوقع النشط من predictions.db مع المستويات الموحدة الهندسية."""
    if not PREDICTIONS_DB.exists():
        return None
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(PREDICTIONS_DB), writable=False)
        conn.row_factory = sqlite3.Row
        cols = [c[1] for c in conn.execute("PRAGMA table_info(predictions)").fetchall()]
        extra_cols = ""
        for c in ['entry_price_min', 'entry_price_max', 'support_level', 'support_level_2', 'resistance_level', 'resistance_level_2', 'risk_reward']:
            if c in cols:
                extra_cols += f", {c}"
        row = conn.execute(f'''
            SELECT id, signal, entry_price, target_price, stop_loss, target_price_2,
                   master_score, evidence_count, prediction_date, status,
                   kill_filter_result{extra_cols}
            FROM predictions
            WHERE ticker = ? AND status IN ('active', 'pending', 'PENDING', 'ACTIVE')
            ORDER BY prediction_date DESC LIMIT 1
        ''', (ticker,)).fetchone()
        conn.close()
        if not row:
            return None
        res = {k: row[k] for k in row.keys()}
        # ضمان وجود المستويات الهيكلية
        if not res.get('entry_price_min') or res.get('entry_price_min') == 0:
            try:
                from analyzers.trader_levels_engine import get_unified_trader_levels
                ul = get_unified_trader_levels(ticker, current_price=res.get('entry_price'))
                if ul:
                    res['entry_price_min'] = ul['entry_min']
                    res['entry_price_max'] = ul['entry_max']
                    res['entry_range_str'] = ul['entry_range_str']
                    res['support_level'] = ul['support_1']
                    res['support_level_2'] = ul['support_2']
                    res['resistance_level'] = ul['resistance_1']
                    res['resistance_level_2'] = ul['resistance_2']
                    res['risk_reward'] = ul['risk_reward']
                    res['advice'] = ul['advice']
            except Exception:
                pass
        return res
    except Exception:
        return None


def _compute_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
    """ATR(14).

    BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
    Keeps backward-compat fallback (0) on insufficient data.
    """
    if len(closes) < 2 or len(highs) < 2:
        return 0
    atr = _canonical_calc_atr(highs, lows, closes, period=period)
    return atr if atr is not None else 0


def analyze_stock_unified(ticker: str) -> Dict[str, Any]:
    """
    المحرك الواحد — حلل سهم واحد بشكل متكامل.
    بـ يرجع كل التحليلات في dict واحد:
      - stock_state (momentum, trend, state)
      - V68 flags (dirty_dist, no_chase, probability)
      - V72 flags (hidden_dist, wash_trade)
      - V73 flags (desert_phase, auction_trap)
      - active_prediction (لو فيه)
      - stock_meta (sector, pe, roe, etc)
    """
    result = {
        'ticker': ticker,
        'analyzed_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'stock_meta': {},
        'ohlcv': {},
        'stock_state': {},
        'v68': {},
        'v72': {},
        'v73': {},
        'active_prediction': None,
        'verdict': 'NEUTRAL',
        'verdict_reason': '',
    }

    # 1. Stock metadata (from stocks.db)
    meta = _get_stock_meta(ticker)
    result['stock_meta'] = meta
    if not meta:
        result['verdict'] = 'NO_DATA'
        result['verdict_reason'] = 'السهم مش موجود في stocks.db'
        return result

    # 2. OHLCV history (live from Yahoo → data_engine fallback)
    ohlcv = _get_ohlcv(ticker, 60)
    result['ohlcv'] = {
        'bars': len(ohlcv['closes']),
        'last_date': ohlcv['dates'][-1] if ohlcv['dates'] else None,
        'last_close': ohlcv['closes'][-1] if ohlcv['closes'] else 0,
    }

    # 2b. Live current price (from production data client)
    try:
        from analyzers.production_data_client import get_data_client
        client = get_data_client()
        live_price = client.get_current_price(ticker)
        result['live_price'] = live_price
        result['data_source'] = 'live' if live_price else 'local'
        if live_price and meta.get('current_price'):
            result['price_vs_stored'] = ((live_price - meta['current_price']) / meta['current_price'] * 100)
        else:
            result['price_vs_stored'] = 0
    except Exception:
        result['live_price'] = None
        result['data_source'] = 'local'

    closes = ohlcv['closes']
    highs = ohlcv['highs']
    lows = ohlcv['lows']
    volumes = ohlcv['volumes']
    opens = ohlcv['opens']

    # 3. Stock state (from stock_state.py — the screener's logic)
    try:
        from utils.stock_state import compute_stock_state
        stock_dict = {
            'ticker': ticker,
            'current_price': meta.get('current_price', 0),
            'change_percent': meta.get('change_percent', 0),
            'ma_50': meta.get('ma_50', 0),
            'ma_200': meta.get('ma_200', 0),
            'rsi': meta.get('rsi', 0),
            'high_52w': meta.get('high_52w', 0),
            'low_52w': meta.get('low_52w', 0),
            'volume': meta.get('volume', 0),
            'avg_volume': meta.get('avg_volume', 0),
        }
        state = compute_stock_state(stock_dict)
        result['stock_state'] = {
            'state': state.get('state', 'NEUTRAL'),
            'state_ar': state.get('state_ar', ''),
            'state_reason': state.get('state_reason', ''),
            'momentum_score': state.get('momentum_score', 0),
        }
    except Exception as e:
        result['stock_state'] = {'error': str(e)}

    # 4. V68/V72/V73 analysis (only if we have enough OHLCV data)
    if len(closes) >= 25:
        atr = _compute_atr(highs, lows, closes, 14)
        if atr <= 0 and closes:
            atr = closes[-1] * 0.05

        # V68 Oracle
        try:
            from analyzers.v68_oracle import analyze_oracle
            v68 = analyze_oracle(closes, highs, lows, volumes, opens, atr=atr, entry=closes[-1])
            result['v68'] = {
                'probability': v68['probability'],
                'future_direction': v68['future_direction'],
                'future_momentum': v68['future_momentum'],
                'dirty_distribution': v68['dirty_distribution'],
                'no_chase_2d': v68['no_chase_2d'],
                'liquidity_grab': v68['liquidity_grab'],
                'quiet_accumulation': v68['quiet_accumulation'],
                'low_magnet': v68['low_magnet'],
                'high_magnet': v68['high_magnet'],
                'trend_state': v68['trend_state'],
                'delta_vol': v68['delta_vol'],
            }
        except Exception as e:
            result['v68'] = {'error': str(e)}

        # V72 Multi-Path
        try:
            from analyzers.multi_path_detector import (
                detect_wash_trade, detect_hidden_distribution,
                detect_choch_bear
            )
            from analyzers.v68_oracle import compute_delta
            delta = compute_delta(highs, lows, closes, volumes)
            wash = detect_wash_trade(highs, lows, closes, volumes, atr)
            hidden = detect_hidden_distribution(highs, lows, volumes, len(highs))
            choch = detect_choch_bear(closes, result['v68'].get('low_magnet'))
            result['v72'] = {
                'wash_trade': wash,
                'hidden_dist': {
                    'is_hidden': hidden.get('is_hidden_dist', False),
                    'block_active': hidden.get('block_active', False),
                    'block_remaining': hidden.get('block_remaining', 0),
                },
                'choch_bear': choch,
                'delta_vol': delta.get('delta_vol', 0),
            }
        except Exception as e:
            result['v72'] = {'error': str(e)}

        # V73 Sniper
        try:
            from analyzers.sniper_detector import detect_desert_phase, detect_auction_trap
            desert = detect_desert_phase(closes, volumes, 20)
            auction = detect_auction_trap(opens, closes, 10.0)
            result['v73'] = {
                'desert_phase': desert,
                'auction_trap': auction,
            }
        except Exception as e:
            result['v73'] = {'error': str(e)}

    # 5. Active prediction (from predictions.db)
    result['active_prediction'] = _get_active_prediction(ticker)

    # 6. Verdict — the unified decision
    verdict, reason = _compute_verdict(result)
    result['verdict'] = verdict
    result['verdict_reason'] = reason

    return result


def _compute_verdict(result: Dict) -> tuple:
    """
    حكم موحد بناءً على كل التحليلات.
    ده اللي الـ UI بـ يعرضه كـ "قرار المحرك".
    """
    v68 = result.get('v68', {})
    v72 = result.get('v72', {})
    v73 = result.get('v73', {})
    state = result.get('stock_state', {})
    pred = result.get('active_prediction')

    # Hard rejects first (V68 dirty_dist — proven +22.5%)
    if v68.get('dirty_distribution'):
        return ('REJECT', 'توزيع قاتل: ظهر علوي + حجم + delta سالب (V68)')

    # V72 hidden_dist block (proven +36.5%)
    if v72.get('hidden_dist', {}).get('block_active'):
        return ('REJECT', f'توزيع خفي: higher high + lower volume (V72, block {v72["hidden_dist"]["block_remaining"]}bars)')

    # V73 desert phase (proven +23.1%)
    if v73.get('desert_phase'):
        return ('WAIT', 'الموت السريري: squeeze + volume ميت (V73) — استنى الانفجار')

    # V68 no_chase (2-day >15%)
    if v68.get('no_chase_2d'):
        return ('REJECT', 'حظر مطاردة: قفز >15% في يومين (V68)')

    # V72 wash trade
    if v72.get('wash_trade'):
        return ('REJECT', 'تدوير وهمي: حجم ضخم بدون حركة سعر (V72)')

    # V72 choch_bear
    if v72.get('choch_bear'):
        return ('REJECT', 'كسر هيكل هابط (V72)')

    # If there's an active prediction → BUY/HOLD
    if pred:
        signal = pred.get('signal', '').upper()
        if signal in ('BUY', 'STRONG_BUY'):
            return ('HOLD_BUY', f'فيه توقع نشط: {signal} entry={pred.get("entry_price",0):.2f} target={pred.get("target_price",0):.2f}')

    # Stock state from screener
    momentum = state.get('momentum_score', 0)
    state_key = state.get('state', 'NEUTRAL')
    if state_key == 'NEAR_BREAKOUT' and momentum >= 70:
        return ('WATCH', f'قرب اختراق + momentum={momentum:.0f} — مراقبة')
    if state_key == 'CORRECTION_END':
        return ('WATCH', f'نهاية تصحيح + momentum={momentum:.0f} — مراقبة')
    if state_key == 'DECLINING':
        return ('AVOID', f'هابط + momentum={momentum:.0f}')

    # V68 probability (informational)
    prob = v68.get('probability', 0)
    if prob >= 70:
        return ('WATCH', f'احتمالية عالية {prob}/100 + momentum={momentum:.0f}')

    return ('NEUTRAL', f'momentum={momentum:.0f}, state={state_key}, prob={prob}/100')


def analyze_batch(tickers: List[str]) -> List[Dict]:
    """حلل مجموعة أسهم."""
    return [analyze_stock_unified(t) for t in tickers]


def analyze_market(market: str = 'EGX', limit: int = 50) -> List[Dict]:
    """حلل أعلى N سهم بالسيولة (volume × price)."""
    if not STOCKS_DB.exists():
        return []
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(STOCKS_DB), writable=False)
        # turnover_egp may be NULL — compute from volume × price
        tickers = [r[0] for r in conn.execute('''
            SELECT ticker FROM stocks
            WHERE market = ? AND is_active = 1
              AND volume IS NOT NULL AND volume > 0
              AND current_price IS NOT NULL AND current_price > 0
            ORDER BY (volume * current_price) DESC LIMIT ?
        ''', (market, limit)).fetchall()]
        conn.close()
        return analyze_batch(tickers)
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════════════
# Flask route (optional — لو شغالين بـ Flask)
# ═══════════════════════════════════════════════════════════════════════

def register_unified_routes(app):
    """سجّل الـ routes في Flask app."""
    try:
        from flask import Blueprint, request, jsonify
    except ImportError:
        return  # Flask not available

    unified_bp = Blueprint('unified_analysis', __name__)

    @unified_bp.route('/api/unified-analysis', methods=['GET'])
    def unified_analysis():
        ticker = request.args.get('ticker', '').upper().strip()
        market = request.args.get('market', 'EGX').strip()
        limit = min(int(request.args.get('limit', '50')), 200)

        if ticker:
            result = analyze_stock_unified(ticker)
            return jsonify({'success': True, 'analysis': result})
        else:
            results = analyze_market(market, limit)
            return jsonify({'success': True, 'count': len(results), 'analyses': results})

    app.register_blueprint(unified_bp)


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Unified Stock Analysis Engine — Self Test")
    print("=" * 60)

    # Test single stock
    result = analyze_stock_unified('COMI')
    print(f"\n=== COMI ===")
    print(f"Verdict: {result['verdict']} — {result['verdict_reason']}")
    print(f"Stock state: {result['stock_state'].get('state', '?')} (momentum={result['stock_state'].get('momentum_score', 0):.0f})")
    print(f"V68: prob={result['v68'].get('probability', 0)}/100, dirty_dist={result['v68'].get('dirty_distribution', False)}")
    print(f"V72: hidden_dist={result['v72'].get('hidden_dist', {}).get('block_active', False)}")
    print(f"V73: desert={result['v73'].get('desert_phase', False)}")
    print(f"Active prediction: {'YES' if result['active_prediction'] else 'NO'}")
    print(f"OHLCV bars: {result['ohlcv'].get('bars', 0)}")

    # Test batch (top 5 by turnover)
    print(f"\n=== Top 5 by turnover ===")
    batch = analyze_market('EGX', 5)
    for r in batch:
        print(f"  {r['ticker']}: {r['verdict']:<12} | {r['verdict_reason'][:50]}")

    print("\n✅ Unified engine ready — same result everywhere")
