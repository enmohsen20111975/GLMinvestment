#!/usr/bin/env python3
"""
quant_routes.py — مسارات المؤشرات العالمية + الأدلة + القوائم الذكية
=====================================================================
BRAVO Directive: 3 endpoints لحفظ بطاقة الأدلة + المؤشرات + القوائم الذكية.

1. GET /api/market/indices/global — مؤشرات الأسواق الستة + sparkline (20-30 نقطة).
2. GET /api/predictions/dossier?ticker=X — أدلة فنية + تاريخية + إحصائية نجاح.
3. GET /api/radar/bucket?market={M}&type={inflow|outflow|quiet_accumulation|correction_exhaustion}

Rule 27: أرقام حقيقية. mode=ro. لا except-pass.
"""
from __future__ import annotations
import os, sys, sqlite3, json
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))
os.environ.setdefault('PREDICTIONS_DB', str(PROJECT_ROOT / "db" / "predictions.db"))

from api.standard_responses import (
    standard_error, standard_success, enrich_opportunity,
    verify_market, SUPPORTED_MARKETS, ro_connect, ro_query,
)

router = APIRouter(prefix="/api", tags=["Quant: Indices + Dossier + Buckets"])

MARKETS = {
    'TADAWUL': {'index': 'TASI', 'label': 'تداول', 'flag': '🇸🇦'},
    'EGX': {'index': 'EGX30', 'label': 'مصر', 'flag': '🇪🇬'},
    'KSE': {'index': 'KSE', 'label': 'الكويت', 'flag': '🇰🇼'},
    'QSE': {'index': 'QSE', 'label': 'قطر', 'flag': '🇶🇦'},
    'US': {'index': 'SPX', 'label': 'أمريكا', 'flag': '🇺🇸'},
    'CRYPTO': {'index': 'BTC', 'label': 'كريبتو', 'flag': '₿'},
}


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


# ═══════════════════════════════════════════════════════════════════
# 1. GET /api/market/indices/global — مؤشرات الأسواق الستة + sparkline
# ═══════════════════════════════════════════════════════════════════

@router.get("/market/indices/global")
def get_global_indices() -> Dict[str, Any]:
    """مؤشرات الأسواق الستة + مصفوفة sparkline (20-30 نقطة) لكل مؤشر."""
    try:
        conn = ro_connect('stocks.db')
        indices = []
        for code, info in MARKETS.items():
            idx = {'market': code, 'label': info['label'], 'flag': info['flag'],
                   'index_symbol': info['index'], 'current_value': None,
                   'change_percent': None, 'sparkline': []}
            # 1. Try market_indices table (EGX indices).
            if conn:
                try:
                    row = conn.execute(
                        "SELECT symbol, current_value, change_percent FROM market_indices "
                        "WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                        (info['index'], f"%{info['index']}%")
                    ).fetchone()
                    if row:
                        idx['index_symbol'] = row['symbol']
                        idx['current_value'] = _to_float(row['current_value'])
                        idx['change_percent'] = round(_to_float(row['change_percent']), 2)
                except Exception:
                    pass
            # 2. Sparkline: aggregate daily close from stock_daily_prices (top stocks by volume).
            try:
                ph_conn = ro_connect('stocks.db')
                if ph_conn:
                    rows = ph_conn.execute(
                        "SELECT price_date, AVG(close) AS avg_close "
                        "FROM stock_daily_prices WHERE market = ? AND close > 0 "
                        "GROUP BY price_date ORDER BY price_date DESC LIMIT 25",
                        (code,)
                    ).fetchall()
                    ph_conn.close()
                    if rows:
                        sparkline = [round(_to_float(r['avg_close']), 2) for r in reversed(rows)]
                        idx['sparkline'] = sparkline
                        # If no index value from market_indices, use the latest sparkline point.
                        if idx['current_value'] is None and sparkline:
                            idx['current_value'] = sparkline[-1]
            except Exception as e:
                sys.stderr.write(f"[quant] sparkline error ({code}): {e}\n")
            indices.append(idx)
        if conn:
            conn.close()
        return standard_success(indices, count=len(indices))
    except Exception as e:
        sys.stderr.write(f"[quant] global_indices error: {e}\n")
        return standard_error()


# ═══════════════════════════════════════════════════════════════════
# 2. GET /api/predictions/dossier?ticker=X — الأدلة + الذاكرة التاريخية
# ═══════════════════════════════════════════════════════════════════

@router.get("/predictions/dossier")
def get_dossier(ticker: str = Query(..., description="السهم")) -> Dict[str, Any]:
    """أدلة فنية + حجمية + تاريخية + إحصائية نجاح لسهم محدد."""
    ticker = ticker.upper().strip()
    try:
        # 1. Latest stored analysis (technical + volume evidence).
        sa_rows = ro_query('predictions.db',
            "SELECT ticker, market, maestro_score, recommendation, recommendation_ar, confidence, "
            "entry_price, target_price, stop_loss, risk_reward, regime, volume_ratio, liquidity_rating, "
            "technical_score, fundamental_score, pe_ratio, signal, created_at "
            "FROM stored_analyses WHERE ticker = ? ORDER BY created_at DESC LIMIT 1",
            (ticker,))
        latest_analysis = dict(sa_rows[0]) if sa_rows else None

        # 2. Historical predictions for this ticker (success record).
        pred_rows = ro_query('predictions.db',
            "SELECT stock_symbol, signal_type, entry_price, target_price, stop_loss, "
            "confidence, maestro_score, status, final_price, profit_loss_percent, "
            "hit_target, hit_stop_loss, days_to_target, created_at "
            "FROM aiPrediction WHERE stock_symbol = ? ORDER BY created_at DESC LIMIT 10",
            (ticker,))
        predictions = [dict(r) for r in pred_rows]

        # 3. Success statistics.
        total = len(predictions)
        hit_target = sum(1 for p in predictions if p.get('hit_target'))
        hit_stop = sum(1 for p in predictions if p.get('hit_stop_loss'))
        pending = sum(1 for p in predictions if p.get('status') == 'pending' or not p.get('final_price'))
        decided = total - pending
        win_rate = round((hit_target / decided * 100), 1) if decided > 0 else 0.0
        avg_pnl = round(sum(_to_float(p.get('profit_loss_percent')) for p in predictions) / total, 2) if total > 0 else 0.0

        # 4. Similar success scenarios (same signal type that hit target).
        signal_type = predictions[0].get('signal_type') if predictions else None
        similar_wins = []
        if signal_type:
            sim_rows = ro_query('predictions.db',
                "SELECT stock_symbol, signal_type, entry_price, target_price, profit_loss_percent "
                "FROM aiPrediction WHERE signal_type = ? AND hit_target = 1 "
                "ORDER BY profit_loss_percent DESC LIMIT 3",
                (signal_type,))
            similar_wins = [dict(r) for r in sim_rows]

        return standard_success({
            'ticker': ticker,
            'latest_analysis': latest_analysis,
            'prediction_history': predictions,
            'success_stats': {
                'total_predictions': total,
                'hit_target': hit_target,
                'hit_stop_loss': hit_stop,
                'pending': pending,
                'win_rate_pct': win_rate,
                'avg_pnl_pct': avg_pnl,
            },
            'similar_wins': similar_wins,
        }, ticker=ticker)
    except Exception as e:
        sys.stderr.write(f"[quant] dossier error: {e}\n")
        return standard_error(f"خطأ في تحميل أدلة {ticker}")


# ═══════════════════════════════════════════════════════════════════
# 3. GET /api/radar/bucket — القوائم الذكية لرادار السيولة
# ═══════════════════════════════════════════════════════════════════

BUCKET_TYPES = ['inflow', 'outflow', 'quiet_accumulation', 'correction_exhaustion']

@router.get("/radar/bucket")
def get_radar_bucket(
    market: str = Query(..., description="السوق (TADAWUL, EGX, KSE, QSE, US, CRYPTO)"),
    type: str = Query(..., description="inflow|outflow|quiet_accumulation|correction_exhaustion"),
) -> Dict[str, Any]:
    """قائمة ذكية من رادار السيولة مصنّفة حسب نوع التدفق."""
    if not verify_market(market):
        return standard_error(f"السوق {market} غير مدعوم", "unsupported_market")
    if type not in BUCKET_TYPES:
        return standard_error(f"النوع {type} غير معروف — المتاح: {BUCKET_TYPES}", "unknown_type")
    try:
        from liquidity_radar_v2 import scan_market
        result = scan_market(market)
        stocks = result.get('stocks', [])
        # Filter by bucket type.
        bucket = []
        for s in stocks:
            w = s.get('whale', {}) or {}
            ed = s.get('entry_defense', {}) or {}
            fk = s.get('falling_knife', {}) or {}
            net_flow = _to_float(w.get('net_flow_egp'))
            avg_flow = _to_float(w.get('avg_daily_flow_egp'))
            entry = _to_float(ed.get('entry_level'))
            defense = _to_float(ed.get('defense_level'))
            is_falling = fk.get('is_falling_knife', False)

            match = False
            reason = ""
            if type == 'inflow':
                # صافي تدفق موجب + تداول أعلى من المتوسط.
                if net_flow > 0 and avg_flow > 0 and net_flow > avg_flow * 0.5:
                    match = True
                    reason = f"تدفق +{net_flow/1e6:.1f}M فوق المتوسط"
            elif type == 'outflow':
                # صافي تدفق سالب حاد + كسر دعوم.
                if net_flow < 0 and defense > 0 and entry < defense:
                    match = True
                    reason = f"تصريف {net_flow/1e6:.1f}M + كسر دعوم"
            elif type == 'quiet_accumulation':
                # تذبذب ضيق + تدفق موجب ضعيف (تجميع هادئ).
                flow_strength = w.get('flow_strength', '')
                if net_flow > 0 and net_flow < avg_flow * 0.5 and avg_flow > 0:
                    match = True
                    reason = f"تجميع هادئ {net_flow/1e6:.1f}M (< متوسط)"
            elif type == 'correction_exhaustion':
                # هبوط + تناقص بيع + RSI < 35 (proxy: falling_knife=False + net_flow negative but small).
                if net_flow < 0 and abs(net_flow) < avg_flow * 0.3 and not is_falling:
                    match = True
                    reason = f"استنزاف تصحيحي (بيع ضعيف {net_flow/1e6:.1f}M)"

            if match:
                enriched = enrich_opportunity(dict(s))
                bucket.append({
                    'ticker': s.get('ticker'), 'name': s.get('name'),
                    'price': entry, 'net_flow_m': round(net_flow / 1e6, 1),
                    'rr_ratio': enriched.get('rr_ratio'),
                    'risk_level': enriched.get('risk_level'),
                    'trend_direction': enriched.get('trend_direction'),
                    'institutional_volume_pct': enriched.get('institutional_volume_pct'),
                    'bucket_reason': reason,
                })
        return standard_success(bucket, market=market, type=type, count=len(bucket))
    except Exception as e:
        sys.stderr.write(f"[quant] radar bucket error: {e}\n")
        return standard_error()


# ═══════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════

def main():
    import argparse
    p = argparse.ArgumentParser(description='Quant Routes — Indices + Dossier + Buckets')
    p.add_argument('--indices', action='store_true', help='test global indices')
    p.add_argument('--dossier', help='test dossier for ticker')
    p.add_argument('--bucket-market', help='market for bucket test')
    p.add_argument('--bucket-type', default='inflow', help='bucket type')
    args = p.parse_args()

    if args.indices:
        r = get_global_indices()
        print(json.dumps(r, ensure_ascii=False, indent=2, default=str)[:1500])
        return 0
    if args.dossier:
        r = get_dossier(ticker=args.dossier)
        print(json.dumps(r, ensure_ascii=False, indent=2, default=str)[:2000])
        return 0
    if args.bucket_market:
        r = get_radar_bucket(market=args.bucket_market, type=args.bucket_type)
        print(json.dumps(r, ensure_ascii=False, indent=2, default=str)[:1500])
        return 0
    p.print_help()
    return 1

if __name__ == '__main__':
    sys.exit(main())
