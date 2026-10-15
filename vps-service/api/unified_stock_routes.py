#!/usr/bin/env python3
"""
unified_stock_routes.py — المسار الموحد لتغذية StockInfographicCard
=====================================================================
BRAVO Directive: GET /api/stocks/{ticker}/unified يرجع كل الحقول المطلوبة:
  entry_price, target_price, stop_loss, risk_reward, whale_net_flow, sharia_status
  + current_price, name, sector, signal, confidence, rr_ratio, risk_level, trend_direction.

FastAPI router — يُركّب في main.py: app.include_router(unified_router).
mode=ro. standard_responses. Rule 27.
"""
from __future__ import annotations
import os, sys, sqlite3, json
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import APIRouter, Query
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))
os.environ.setdefault('PREDICTIONS_DB', str(PROJECT_ROOT / "db" / "predictions.db"))

from api.standard_responses import standard_error, standard_success, enrich_opportunity, ro_connect, ro_query

router = APIRouter(prefix="/api/stocks", tags=["Unified Stock Data"])


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


def _compute_whale_net_flow(ticker: str, market: str) -> float:
    """صافي التدفق من stock_daily_prices (نفس منطق الرادار)."""
    conn = ro_connect('stocks.db')
    if not conn: return 0.0
    try:
        rows = conn.execute(
            "SELECT open, close, volume FROM stock_daily_prices "
            "WHERE ticker = ? AND market = ? AND close > 0 AND volume > 0 "
            "ORDER BY price_date DESC LIMIT 20", (ticker, market)
        ).fetchall()
        conn.close()
        if not rows: return 0.0
        buy, sell = 0.0, 0.0
        for r in rows:
            o, c, v = _to_float(r['open']), _to_float(r['close']), _to_float(r['volume'])
            if v <= 0: continue
            val = v * c
            if c > o: buy += val
            elif c < o: sell += val
            else: buy += val * 0.5; sell += val * 0.5
        return round(buy - sell, 0)
    except Exception as e:
        sys.stderr.write(f"[unified] whale_flow error: {e}\n")
        conn.close()
        return 0.0


def _sharia_status(market: str) -> str:
    if market.upper() == 'TADAWUL': return 'متوافق'
    return 'تحتاج مراجعة'


@router.get("/{ticker}/unified")
def get_unified_stock(ticker: str) -> Dict[str, Any]:
    """المسار الموحد — يغذي StockInfographicCard بكل الحقول."""
    ticker = (ticker or '').strip().upper()
    if not ticker:
        return standard_error('التيكر مطلوب')
    try:
        # 1. Stock metadata.
        stock_rows = ro_query('stocks.db',
            "SELECT ticker, name, name_ar, market, sector, current_price, change_percent, "
            "ma_50, ma_200, rsi, support, resistance, dividend_yield, pe_ratio, pb_ratio, is_egx30 "
            "FROM stocks WHERE ticker = ? LIMIT 1", (ticker,))
        stock_info = dict(stock_rows[0]) if stock_rows else None
        if not stock_info:
            return standard_error(f'{ticker} غير موجود', 'not_found')

        market = stock_info.get('market', 'EGX')

        # 2. Prediction (latest from aiPrediction).
        pred_rows = ro_query('predictions.db',
            "SELECT stock_symbol, stock_name_ar, signal_type, confidence, maestro_score, "
            "entry_price, target_price, stop_loss, risk_reward, market "
            "FROM aiPrediction WHERE stock_symbol = ? ORDER BY id DESC LIMIT 1", (ticker,))
        pred = dict(pred_rows[0]) if pred_rows else {}

        # 3. Whale net flow.
        whale_net_flow = _compute_whale_net_flow(ticker, market)

        # 4. Risk reward.
        rr = _to_float(pred.get('risk_reward'))
        if rr == 0:
            entry = _to_float(pred.get('entry_price')) or _to_float(stock_info.get('current_price'))
            target = _to_float(pred.get('target_price'))
            stop = _to_float(pred.get('stop_loss'))
            if entry > 0 and target > entry and stop < entry:
                rr = round((target - entry) / (entry - stop), 2)

        # 5. Build unified response.
        result = {
            'entry_price': pred.get('entry_price') or stock_info.get('current_price'),
            'target_price': pred.get('target_price') or stock_info.get('resistance'),
            'stop_loss': pred.get('stop_loss') or stock_info.get('support'),
            'risk_reward': rr if rr > 0 else None,
            'whale_net_flow': whale_net_flow,
            'sharia_status': _sharia_status(market),
            'ticker': ticker,
            'name': stock_info.get('name_ar') or stock_info.get('name') or ticker,
            'market': market, 'sector': stock_info.get('sector'),
            'current_price': _to_float(stock_info.get('current_price')),
            'change_percent': _to_float(stock_info.get('change_percent')),
            'signal': pred.get('signal_type'),
            'confidence': pred.get('confidence'),
            'maestro_score': pred.get('maestro_score'),
            'dividend_yield': stock_info.get('dividend_yield'),
            'pe_ratio': stock_info.get('pe_ratio'),
            'pb_ratio': stock_info.get('pb_ratio'),
            'is_egx30': bool(stock_info.get('is_egx30')),
        }

        # Enrich with unified fields.
        enriched = enrich_opportunity({
            'entry_defense': {'entry_level': result['current_price'],
                              'defense_level': result.get('stop_loss'),
                              'resistance_level': result.get('target_price')},
            'whale': {'net_flow_egp': whale_net_flow},
            'fundamentals': {},
            'targets_available': rr is not None and rr > 0,
            'falling_knife': {'is_falling_knife': False},
        })
        result['rr_ratio'] = enriched.get('rr_ratio')
        result['risk_level'] = enriched.get('risk_level')
        result['trend_direction'] = enriched.get('trend_direction')
        result['institutional_volume_pct'] = enriched.get('institutional_volume_pct')

        return standard_success(result, ticker=ticker)
    except Exception as e:
        sys.stderr.write(f"[unified] {ticker} error: {e}\n")
        return standard_error(f'خطأ في تحميل بيانات {ticker}')


# Standalone test.
if __name__ == '__main__':
    print("=" * 72)
    print("🧪 unified_stock_routes — standalone test")
    print("=" * 72)
    for ticker in ['COMI', 'SWDY', 'AMOC']:
        r = get_unified_stock(ticker)
        d = r.get('data', {})
        if d:
            print(f"\n{ticker}: success={r.get('success')}")
            print(f"  entry={d.get('entry_price')} target={d.get('target_price')} stop={d.get('stop_loss')}")
            print(f"  R/R={d.get('risk_reward')} whale_flow={d.get('whale_net_flow')} sharia={d.get('sharia_status')}")
            print(f"  rr_ratio={d.get('rr_ratio')} risk={d.get('risk_level')} trend={d.get('trend_direction')} inst_vol={d.get('institutional_volume_pct')}%")
        else:
            print(f"\n{ticker}: {r.get('message_ar', 'error')}")
    print("\n" + "=" * 72)
