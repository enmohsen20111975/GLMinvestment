#!/usr/bin/env python3
"""
wealth_manager.py — محرك الثروة الموحد (Wealth Manager)
========================================================
Phase 3 Nuclear: مراقبة المحفظة + مؤشر التحوط (Hedging Ratio) + الزكاة الشرعية
في وحدة واحدة. يدمج alerts_engine + zakat_calculator.

Rule 27: أرقام حقيقية. لا وهم.

Usage:
    python3 vps-service/analyzers/wealth_manager.py --portfolio "COMI:EGX:130:100,SWDY:EGX:116:200" --gold-grams 50
"""
from __future__ import annotations
import os, sys
from pathlib import Path
from typing import Dict, Any, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


def parse_portfolio(s: str) -> List[Dict]:
    out = []
    for item in s.split(','):
        parts = item.strip().split(':')
        if len(parts) >= 4:
            out.append({'ticker': parts[0].strip(), 'market': parts[1].strip(),
                         'entry_price': _to_float(parts[2]), 'shares': _to_float(parts[3])})
    return out


def analyze_wealth(portfolio: List[Dict], gold_grams: float = 0) -> Dict[str, Any]:
    """تحليل ثروة موحد: محفظة + تحوط + زكاة."""
    # 1. Portfolio alerts (from alerts_engine)
    try:
        from analyzers.alerts_engine import monitor_portfolio
        alert_result = monitor_portfolio(portfolio)
    except Exception as e:
        sys.stderr.write(f"[wealth] alerts error: {e}\n")
        alert_result = {'alerts': [], 'summary': {}, 'holdings_checked': 0}

    # 2. Zakat + hedging (from zakat_calculator)
    try:
        from analyzers.zakat_calculator import compute_zakat
        zakat_result = compute_zakat(portfolio, gold_grams)
    except Exception as e:
        sys.stderr.write(f"[wealth] zakat error: {e}\n")
        zakat_result = {'total_zakat_egp': 0, 'hedging': {}, 'gold': {}, 'stocks': {}}

    # 3. Wealth summary
    gold_value = zakat_result.get('gold', {}).get('value_egp', 0)
    stocks_value = zakat_result.get('stocks', {}).get('market_value_egp', 0)
    total_wealth = gold_value + stocks_value

    return {
        'total_wealth_egp': round(total_wealth, 2),
        'portfolio_alerts': {
            'summary': alert_result.get('summary', {}),
            'holdings_checked': alert_result.get('holdings_checked', 0),
            'alerts': alert_result.get('alerts', [])[:5],
        },
        'hedging': zakat_result.get('hedging', {}),
        'zakat': {
            'total_zakat_egp': zakat_result.get('total_zakat_egp', 0),
            'gold': zakat_result.get('gold', {}),
            'stocks': {'market_value_egp': stocks_value},
        },
        'gold_value_egp': round(gold_value, 2),
        'stocks_value_egp': round(stocks_value, 2),
    }


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description='محرك الثروة الموحد — Wealth Manager (Phase 3 Nuclear)')
    p.add_argument('--portfolio', required=True, help='TICKER:MARKET:ENTRY:SHARES,...')
    p.add_argument('--gold-grams', type=float, default=0)
    args = p.parse_args()
    portfolio = parse_portfolio(args.portfolio)
    r = analyze_wealth(portfolio, args.gold_grams)
    print("=" * 72)
    print("💰 محرك الثروة الموحد — Wealth Manager")
    print("=" * 72)
    print(f"\n💎 إجمالي الثروة: {r['total_wealth_egp']:,.2f} EGP")
    print(f"   ذهب: {r['gold_value_egp']:,.2f} EGP | أسهم: {r['stocks_value_egp']:,.2f} EGP")
    h = r['hedging']
    if h:
        print(f"\n⚖️ مؤشر التحوط: ذهب {h.get('gold_pct',0)}% | أسهم {h.get('stocks_pct',0)}%")
        print(f"   {h.get('suggestion','')}")
    z = r['zakat']
    print(f"\n🕌 الزكاة المستحقة: {z.get('total_zakat_egp',0):,.2f} EGP (2.5%)")
    a = r['portfolio_alerts']
    print(f"\n🚨 تنبيهات المحفظة: {a['summary']} (فحص {a['holdings_checked']} سهم)")
    for al in a['alerts']:
        icon = {'critical':'🛑','warning':'⚠️','positive':'✅','info':'ℹ️'}.get(al.get('severity'),'•')
        print(f"   {icon} [{al.get('alert_type')}] {al.get('ticker')}: {al.get('message','')[:80]}")
    print("=" * 72)
    return 0


if __name__ == '__main__':
    sys.exit(main())
