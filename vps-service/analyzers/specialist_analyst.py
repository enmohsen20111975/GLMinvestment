#!/usr/bin/env python3
"""
specialist_analyst.py — المحلل المالي المؤسسي الذكي (AI Specialist Investment Memo)
=================================================================================
Phase 2 #3 / Nuclear Directive: توليد مذكرة استثمارية مؤسسية مكثفة بأسلوب
بنوك الاستثمار (Hermes / JP Morgan Style):
  1. كاش الشركة وقوتها المالية (free_cf, cash, debt).
  2. تمركز الحوت وتدفق السيولة (whale flow + who_is_buying).
  3. القرار الصريح: سعر دخول، وقف محمي، هدف واقعي + R/R.

API: GET /api/stocks/[ticker]/specialist-memo (via FastAPI mount).
Rule 27: أرقام حقيقية. لا وهم.

Usage:
    python3 vps-service/analyzers/specialist_analyst.py --ticker COMI --market EGX
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path
from typing import Optional, Dict, Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


def generate_memo(ticker: str, market: str = 'EGX') -> Dict[str, Any]:
    """توليد مذكرة استثمارية مؤسسية من بيانات الرادار + الفلاتر المؤسسية."""
    from liquidity_radar_v2 import scan_market
    result = scan_market(market)
    stocks = result.get('stocks', [])
    stock = next((s for s in stocks if str(s.get('ticker','')).upper() == ticker.upper()), None)
    if not stock:
        return {'ticker': ticker, 'error': f'{ticker} not found in {market}'}
    ed = stock.get('entry_defense', {}) or {}
    f = stock.get('fundamentals', {}) or {}
    w = stock.get('whale', {}) or {}
    fk = stock.get('falling_knife', {}) or {}
    entry = _to_float(ed.get('entry_level'))
    defense = _to_float(ed.get('defense_level'))
    resistance = _to_float(ed.get('resistance_level'))
    free_cf = f.get('free_cash_flow')
    cash = f.get('cash_on_hand')
    debt = f.get('debt')
    cash_ratio = f.get('cash_ratio')
    net_flow = _to_float(w.get('net_flow_egp'))
    flow_strength = w.get('flow_strength', '')
    targets_available = stock.get('targets_available', True)

    # 1. Company financial strength
    cash_rich = free_cf is not None and free_cf > 0
    cash_bleeding = free_cf is not None and free_cf < 0
    financial_strength = (
        'قوي (كاش-ريتش)' if cash_rich else
        'ضعيف (تنزف كاش)' if cash_bleeding else 'محايد'
    )

    # 2. Whale positioning
    whale_action = (
        'تجميع مؤسسي (الحيتان بتشتري)' if net_flow > 0 else
        'تصريف (الحيتان بتبيع)' if net_flow < 0 else 'محايد'
    )

    # 3. Decision (explicit entry/stop/target + R/R)
    if not targets_available:
        decision = '⛔ لا يوصى بالدخول — السهم منهار (Falling Knife) أو السوق هابط'
        entry_rec = None; stop_rec = None; target_rec = None; rr = None
    elif net_flow < 0:
        decision = '⛔ انتظر — تصريف حيتان نشط. لا تطارد'
        entry_rec = entry; stop_rec = defense; target_rec = resistance
        rr = round((resistance - entry) / (entry - defense), 2) if entry > defense and resistance > entry else None
    else:
        entry_rec = entry; stop_rec = defense; target_rec = resistance
        rr = round((resistance - entry) / (entry - defense), 2) if entry > defense and resistance > entry else None
        decision = (
            f'✅ دخول مقترح @ {entry:.2f} | وقف {defense:.2f} | هدف {resistance:.2f} | R/R={rr}'
            if rr and rr >= 1.5 else
            f'⚠️ انتظر تحسن R/R (الحالي {rr}) — أقل من 1.5'
            if rr else '⚠️ بيانات الدخول/الوقف/الهدف غير مكتملة'
        )

    return {
        'ticker': ticker, 'market': market, 'name': stock.get('name', ticker),
        'memo': {
            '1_company_financials': {
                'free_cash_flow_egp': free_cf, 'cash_on_hand_egp': cash,
                'debt_egp': debt, 'cash_ratio': cash_ratio,
                'financial_strength': financial_strength,
            },
            '2_whale_positioning': {
                'net_flow_egp': round(net_flow, 0), 'flow_strength': flow_strength,
                'whale_action': whale_action, 'tv_whale_spotted': stock.get('tv_whale_spotted'),
            },
            '3_decision': {
                'verdict': decision,
                'entry': entry_rec, 'stop_loss': stop_rec, 'target': target_rec,
                'risk_reward': rr, 'targets_available': targets_available,
                'falling_knife': fk.get('reason', ''),
            },
        },
        'current_price': entry, 'defense': defense, 'resistance': resistance,
    }


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description='محلل مؤسسي — Investment Memo (Nuclear Directive)')
    p.add_argument('--ticker', required=True)
    p.add_argument('--market', default='EGX')
    args = p.parse_args()
    memo = generate_memo(args.ticker, args.market)
    if 'error' in memo:
        print(f"❌ {memo['error']}"); return 1
    m = memo['memo']
    print("=" * 72)
    print(f"📋 مذكرة استثمارية مؤسسية — {memo['name']} ({memo['ticker']}) [{memo['market']}]")
    print("   (Hermes / JP Morgan Style — Bravo 2 Quant)")
    print("=" * 72)
    cf = m['1_company_financials']
    wp = m['2_whale_positioning']
    dc = m['3_decision']
    print(f"\n1️⃣ القوة المالية للشركة: {cf['financial_strength']}")
    fcf_str = f"{cf['free_cash_flow_egp']/1e9:+.2f}B" if cf['free_cash_flow_egp'] else "غير متاح"
    cash_str = f"{cf['cash_on_hand_egp']/1e9:.2f}B" if cf['cash_on_hand_egp'] else "غير متاح"
    print(f"   free_cf: {fcf_str} EGP | cash: {cash_str} EGP | cash_ratio: {cf['cash_ratio']}")
    print(f"\n2️⃣ تمركز الحوت: {wp['whale_action']}")
    print(f"   net_flow: {wp['net_flow_egp']/1e6:+.1f}M EGP | {wp['flow_strength']} | TV whale: {'✓' if wp['tv_whale_spotted'] else '✗'}")
    print(f"\n3️⃣ القرار الصريح:")
    print(f"   {dc['verdict']}")
    if dc['entry']:
        print(f"   Entry: {dc['entry']} | Stop: {dc['stop_loss']} | Target: {dc['target']} | R/R: {dc['risk_reward']}")
    print("=" * 72)
    return 0


if __name__ == '__main__':
    sys.exit(main())
