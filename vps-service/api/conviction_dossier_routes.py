#!/usr/bin/env python3
"""
conviction_dossier_routes.py — ملف الأدلة الصارم + سباركلاين المؤشرات
=====================================================================
1. GET /api/recommendations/dossier/{ticker} — ملف أدلة إثباتي:
   - Historical win-rate per ticker (aiPrediction outcomes).
   - Whale liquidity (last 5 sessions net flow).
   - Risk calculator: entry/target/stop + R/R ≥ 1.5 MANDATORY (reject < 1.5).
   - Falling Knife Guard (Rule 78): block bullish signal if breaking yearly low.

2. GET /api/markets/indices/sparklines — 6 indices (EGX30/TASI/BKP/QSE/SPX/BTC):
   latest price + change% + 7-10 sparkline points.

Rule 27: real data only. mode=ro. standard_responses (200 JSON, no leak).
"""
from __future__ import annotations
import os, sys, sqlite3, json
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Query

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))
os.environ.setdefault('PREDICTIONS_DB', str(PROJECT_ROOT / "db" / "predictions.db"))

from api.standard_responses import standard_error, standard_success, ro_connect, ro_query, verify_market, SUPPORTED_MARKETS

router = APIRouter(tags=["Conviction Dossier + Sparklines"])

INDICES = [
    {'code': 'EGX', 'symbol': 'EGX30', 'label': 'EGX 30', 'flag': '🇪🇬'},
    {'code': 'TADAWUL', 'symbol': 'TASI', 'label': 'TASI', 'flag': '🇸🇦'},
    {'code': 'KSE', 'symbol': 'BKP', 'label': 'BKP', 'flag': '🇰🇼'},
    {'code': 'QSE', 'symbol': 'QSE', 'label': 'QSE', 'flag': '🇶🇦'},
    {'code': 'US', 'symbol': 'SPX', 'label': 'S&P 500', 'flag': '🇺🇸'},
    {'code': 'CRYPTO', 'symbol': 'BTC', 'label': 'Bitcoin', 'flag': '🪙'},
]


def _f(v, d=0.0):
    if v is None: return d
    try: return float(str(v).replace('−','-').strip())
    except: return d


# ═══════════════════════════════════════════════════════════════════
# 1. GET /api/recommendations/dossier/{ticker}
# ═══════════════════════════════════════════════════════════════════

@router.get("/api/recommendations/dossier/{ticker}")
def get_conviction_dossier(ticker: str) -> Dict[str, Any]:
    """ملف أدلة صارم: تاريخ + سيولة + مخاطرة + حارس السكاكين."""
    ticker = (ticker or '').strip().upper()
    if not ticker:
        return standard_error('التيكر مطلوب')
    try:
        # 1. Stock metadata.
        stock_rows = ro_query('stocks.db',
            "SELECT ticker, name, name_ar, market, current_price, change_percent, "
            "support, resistance, is_egx30 FROM stocks WHERE ticker = ? LIMIT 1", (ticker,))
        stock = dict(stock_rows[0]) if stock_rows else None
        if not stock:
            return standard_error(f'{ticker} غير موجود', 'not_found')
        market = stock.get('market', 'EGX')

        # 2. Historical win-rate per ticker.
        preds = ro_query('predictions.db',
            "SELECT signal_type, entry_price, target_price, stop_loss, confidence, "
            "status, final_price, profit_loss_percent, hit_target, hit_stop_loss, created_at "
            "FROM aiPrediction WHERE stock_symbol = ? ORDER BY created_at DESC LIMIT 20", (ticker,))
        total = len(preds)
        hits = sum(1 for p in preds if p.get('hit_target'))
        stops = sum(1 for p in preds if p.get('hit_stop_loss'))
        pending = sum(1 for p in preds if not p.get('final_price') and p.get('status') != 'closed')
        decided = total - pending
        win_rate = round((hits / decided * 100), 1) if decided > 0 else 0.0

        # 3. Whale liquidity (last 5 sessions).
        conn = ro_connect('stocks.db')
        whale_5d = 0.0
        whale_sessions = []
        yearly_low = 0.0
        if conn:
            try:
                rows = conn.execute(
                    "SELECT price_date, open, close, high, low, volume FROM stock_daily_prices "
                    "WHERE ticker = ? AND market = ? AND close > 0 AND volume > 0 "
                    "ORDER BY price_date DESC LIMIT 5", (ticker, market)
                ).fetchall()
                buy, sell = 0.0, 0.0
                for r in rows:
                    o, c, v = _f(r['open']), _f(r['close']), _f(r['volume'])
                    val = v * c
                    if c > o: buy += val
                    elif c < o: sell += val
                    else: buy += val*0.5; sell += val*0.5
                    whale_sessions.append({
                        'date': r['price_date'], 'close': round(c,2),
                        'volume': round(v,0), 'direction': 'buy' if c>o else ('sell' if c<o else 'neutral')
                    })
                whale_5d = round(buy - sell, 0)
            except Exception as e:
                sys.stderr.write(f"[dossier] whale_5d error: {e}\n")
            # 4. Yearly low (for Falling Knife Guard).
            try:
                yl = conn.execute(
                    "SELECT MIN(low) FROM stock_daily_prices WHERE ticker = ? AND market = ? AND low > 0", (ticker, market)
                ).fetchone()
                yearly_low = _f(yl[0]) if yl else 0.0
            except Exception:
                pass
            conn.close()

        current_price = _f(stock.get('current_price'))
        # 5. Falling Knife Guard (Rule 78).
        breaking_yearly_low = yearly_low > 0 and current_price <= yearly_low * 1.02
        bearish_distribution = whale_5d < 0
        falling_knife_blocked = breaking_yearly_low or bearish_distribution

        # 6. Risk calculator (from latest prediction).
        latest_pred = dict(preds[0]) if preds else {}
        entry = _f(latest_pred.get('entry_price')) or current_price
        target = _f(latest_pred.get('target_price')) or _f(stock.get('resistance'))
        stop = _f(latest_pred.get('stop_loss')) or _f(stock.get('support'))
        rr = round((target - entry) / (entry - stop), 2) if entry > 0 and target > entry and stop < entry else 0.0

        # 7. Verdict — R/R ≥ 1.5 mandatory + Falling Knife Guard.
        if falling_knife_blocked:
            verdict = '⛔ مرفوض — حارس السكاكين الساقطة (Rule 78)'
            reason = f"السهم {'يكسر قاعه السنوي' if breaking_yearly_low else 'تحت تصريف هابط'} — ممنوع إشارة صعود"
        elif rr < 1.5:
            verdict = '⛔ مرفوض — R/R < 1.5'
            reason = f"نسبة العائد للمخاطرة {rr:.2f} أقل من الحد الأدنى 1.5 — القاعدة تمنع الصفقة"
        else:
            verdict = f'✅ مقبول — R/R = {rr:.2f}'
            reason = f"دخول {entry:.2f} | هدف {target:.2f} | وقف {stop:.2f} | R/R {rr:.2f}"

        return standard_success({
            'ticker': ticker,
            'name': stock.get('name_ar') or stock.get('name') or ticker,
            'market': market,
            'current_price': current_price,
            'historical_win_rate': {
                'total_predictions': total,
                'hit_target': hits, 'hit_stop_loss': stops,
                'pending': pending, 'decided': decided,
                'win_rate_pct': win_rate,
            },
            'whale_liquidity_5d': {
                'net_flow': whale_5d,
                'direction': 'inflow' if whale_5d > 0 else 'outflow' if whale_5d < 0 else 'neutral',
                'sessions': whale_sessions,
            },
            'risk_calculator': {
                'entry_price': entry, 'target_price': target, 'stop_loss': stop,
                'risk_reward': rr,
                'rr_pass': rr >= 1.5,
            },
            'falling_knife_guard': {
                'blocked': falling_knife_blocked,
                'breaking_yearly_low': breaking_yearly_low,
                'yearly_low': yearly_low,
                'bearish_distribution': bearish_distribution,
                'rule': 'Rule 78 — حظر إشارات الصعود للأسهم المنهارة',
            },
            'verdict': verdict,
            'reason': reason,
            'latest_prediction': {
                'signal': latest_pred.get('signal_type'),
                'confidence': latest_pred.get('confidence'),
                'created_at': latest_pred.get('created_at'),
            },
        }, ticker=ticker)
    except Exception as e:
        sys.stderr.write(f"[dossier] {ticker} error: {e}\n")
        return standard_error(f'خطأ في تحميل ملف أدلة {ticker}')


# ═══════════════════════════════════════════════════════════════════
# 2. GET /api/markets/indices/sparklines
# ═══════════════════════════════════════════════════════════════════

@router.get("/api/markets/indices/sparklines")
def get_sparklines() -> Dict[str, Any]:
    """6 مؤشرات عالمية: latest + change% + 7-10 sparkline points لكل مؤشر."""
    try:
        conn = ro_connect('stocks.db')
        results = []
        for idx in INDICES:
            entry = {
                'market': idx['code'], 'symbol': idx['symbol'],
                'label': idx['label'], 'flag': idx['flag'],
                'latest_price': None, 'change_percent': None,
                'sparkline': [],
            }
            # 1. Try market_indices table.
            if conn:
                try:
                    row = conn.execute(
                        "SELECT symbol, current_value, change_percent FROM market_indices "
                        "WHERE symbol LIKE ? LIMIT 1", (f"%{idx['symbol']}%",)
                    ).fetchone()
                    if row:
                        entry['latest_price'] = _f(row['current_value'])
                        entry['change_percent'] = round(_f(row['change_percent']), 2)
                except Exception:
                    pass
            # 2. Sparkline: 7-10 daily aggregate from stock_daily_prices.
            try:
                sc = ro_connect('stocks.db')
                if sc:
                    rows = sc.execute(
                        "SELECT price_date, AVG(close) AS avg_close "
                        "FROM stock_daily_prices WHERE market = ? AND close > 0 "
                        "GROUP BY price_date ORDER BY price_date DESC LIMIT 10", (idx['code'],)
                    ).fetchall()
                    sc.close()
                    if rows:
                        spark = [round(_f(r['avg_close']), 2) for r in reversed(rows)]
                        entry['sparkline'] = spark
                        if entry['latest_price'] is None and spark:
                            entry['latest_price'] = spark[-1]
            except Exception as e:
                sys.stderr.write(f"[sparkline] {idx['code']} error: {e}\n")
            results.append(entry)
        if conn:
            conn.close()
        return standard_success(results, count=len(results))
    except Exception as e:
        sys.stderr.write(f"[sparklines] error: {e}\n")
        return standard_error()


# ═══════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════

def main():
    import argparse
    p = argparse.ArgumentParser(description='Conviction Dossier + Sparklines')
    p.add_argument('--dossier', help='ticker for conviction dossier')
    p.add_argument('--sparklines', action='store_true')
    args = p.parse_args()
    if args.dossier:
        r = get_conviction_dossier(args.dossier)
        print(json.dumps(r, ensure_ascii=False, indent=2, default=str)[:3000])
        return 0
    if args.sparklines:
        r = get_sparklines()
        for i in r.get('data', []):
            pts = len(i.get('sparkline', []))
            print(f"  {i['flag']} {i['symbol']:6} latest={i.get('latest_price')} chg={i.get('change_percent')}% pts={pts}")
        return 0
    p.print_help()
    return 1

if __name__ == '__main__':
    sys.exit(main())
