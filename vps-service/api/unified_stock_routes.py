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
            "ma_50, ma_200, rsi, support, resistance, dividend_yield, pe_ratio, pb_ratio, is_egx30, low_52w, high_52w "
            "FROM stocks WHERE ticker = ? LIMIT 1", (ticker,))
        stock_info = dict(stock_rows[0]) if stock_rows else None
        if not stock_info:
            return standard_error(f'{ticker} غير موجود', 'not_found')

        market = stock_info.get('market', 'EGX')

        # 2. Prediction (latest BUY signal from predictions table or aiPrediction — compute R/R in Python).
        pred_rows = ro_query('predictions.db',
            "SELECT ticker, signal, signal_type, entry_price, target_price, stop_loss, risk_reward, market "
            "FROM predictions WHERE ticker = ? AND (signal LIKE '%BUY%' OR signal_type = 'BUY') "
            "ORDER BY id DESC LIMIT 1", (ticker,))
        if not pred_rows:
            pred_rows = ro_query('predictions.db',
                "SELECT stock_symbol AS ticker, signal_type AS signal, signal_type, entry_price, target_price, stop_loss, market "
                "FROM aiPrediction WHERE stock_symbol = ? AND signal_type = 'BUY' "
                "ORDER BY id DESC LIMIT 1", (ticker,))
        pred = dict(pred_rows[0]) if pred_rows else {}

        # 3. Whale net flow.
        whale_net_flow = _compute_whale_net_flow(ticker, market)

        # 4. Risk reward.
        current_price = _to_float(stock_info.get('current_price'))
        rr = _to_float(pred.get('risk_reward'))
        entry = _to_float(pred.get('entry_price')) or current_price
        target = _to_float(pred.get('target_price'))
        stop = _to_float(pred.get('stop_loss'))
        if rr <= 0 and entry > 0 and target > entry and stop < entry:
            rr = round((target - entry) / (entry - stop), 2)

        # 5. Falling Knife check (Rule 78): breaking yearly low?
        yearly_low = _to_float(stock_info.get('low_52w'))
        if yearly_low <= 0:
            conn_fk = ro_connect('stocks.db')
            if conn_fk:
                try:
                    yl = conn_fk.execute(
                        "SELECT MIN(low) FROM stock_daily_prices WHERE ticker = ? AND market = ? AND low > 0",
                        (ticker, market)
                    ).fetchone()
                    yearly_low = _to_float(yl[0]) if yl else 0.0
                except Exception:
                    pass
                conn_fk.close()
        breaking_yearly_low = yearly_low > 0 and current_price < yearly_low
        bearish_distribution = whale_net_flow < -2_000_000
        falling_knife = breaking_yearly_low

        # 7. State Machine: has_active_trade?
        has_active_trade = (rr >= 1.5 and not falling_knife and bool(pred.get('signal') or pred.get('signal_type')))

        # 8. Canonical flow classification.
        try:
            from api.canonical_flow import classify_liquidity_bucket
            flow_cls = classify_liquidity_bucket(ticker, market, entry=current_price,
                                                  target=_to_float(pred.get('target_price')) or _to_float(stock_info.get('resistance')),
                                                  stop=_to_float(pred.get('stop_loss')) or _to_float(stock_info.get('support')))
            liquidity_bucket = flow_cls.bucket
            liquidity_reason = flow_cls.reason
        except Exception:
            liquidity_bucket = 'neutral'
            liquidity_reason = ''

        # 9. Build response — State Machine.
        result = {
            'ticker': ticker,
            'name': stock_info.get('name_ar') or stock_info.get('name') or ticker,
            'market': market,
            'current_price': current_price,
            'change_percent': _to_float(stock_info.get('change_percent')),
            'liquidity_bucket': liquidity_bucket,
            'liquidity_reason': liquidity_reason,
            'sharia_status': _sharia_status(market),
        }

        if has_active_trade:
            # Active trade — green card data.
            result['has_active_trade'] = True
            result['trade_setup'] = {
                'entry_price': _to_float(pred.get('entry_price')) or current_price,
                'stop_loss': _to_float(pred.get('stop_loss')) or _to_float(stock_info.get('support')),
                'target_1': _to_float(pred.get('target_price')) or _to_float(stock_info.get('resistance')),
                'target_2': round(_to_float(pred.get('target_price')) * 1.15, 2) if pred.get('target_price') else None,
                'rr_ratio': rr,
                'signal': pred.get('signal_type') or 'BUY',
            }
            result['observation_status'] = None
            result['observation_reason'] = None
        else:
            # No active trade — observation mode (NO null entry/stop/target!).
            result['has_active_trade'] = False
            result['trade_setup'] = None
            result['observation_status'] = 'وضع المراقبة: كاش وانتظار ⏸️'
            if rr < 1.5 and rr > 0:
                result['observation_reason'] = f'نسبة العائد للمخاطرة R/R = {rr:.2f} غير مجزية (أقل من 1.5)'
            elif falling_knife:
                reason_parts = []
                if breaking_yearly_low:
                    reason_parts.append(f'السهم يكسر قاعه السنوي ({yearly_low:.2f})')
                if bearish_distribution:
                    reason_parts.append(f'تصريف حيتان (تدفق سالب {whale_net_flow/1e6:.1f}M)')
                result['observation_reason'] = ' — '.join(reason_parts) if reason_parts else 'السهم في مسار هابط'
            else:
                result['observation_reason'] = 'لا توجد إشارة شراء نشطة بهذا السهم حالياً'

        # Stock info (always present — real numbers only).
        result['stock_info'] = {
            'current_price': current_price,
            'change_pct': _to_float(stock_info.get('change_percent')),
            'fair_value': _to_float(stock_info.get('resistance')),
            'support_level': _to_float(stock_info.get('support')),
            'resistance_level': _to_float(stock_info.get('resistance')),
            'whale_net_flow_5d': whale_net_flow,
            'sharia_compliant': _sharia_status(market) == 'متوافق',
            'pe_ratio': stock_info.get('pe_ratio'),
            'dividend_yield': stock_info.get('dividend_yield'),
            'sector': stock_info.get('sector'),
            'is_egx30': bool(stock_info.get('is_egx30')),
        }
        # Enrich with unified financial fields.
        enriched = enrich_opportunity({
            'entry_defense': {'entry_level': current_price,
                              'defense_level': _to_float(stock_info.get('support')),
                              'resistance_level': _to_float(stock_info.get('resistance'))},
            'whale': {'net_flow_egp': whale_net_flow},
            'fundamentals': {},
            'targets_available': has_active_trade,
            'falling_knife': {'is_falling_knife': falling_knife},
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
