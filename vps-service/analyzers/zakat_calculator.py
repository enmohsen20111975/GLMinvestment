#!/usr/bin/env python3
"""
zakat_calculator.py — الزكاة الشرعية + مؤشر التحوط (Hedging Ratio)
==================================================================
Phase 3 #2 + #3:
  - Hedging Ratio: نسبة الذهب إلى الأسهم + اقتراحات إعادة التوازن في المسار الهابط.
  - Zakat: نصاب الذهب اللحظي (85g × سعر الجرام) + نسبة الأصول المتداولة (2.5%).

Rule 27: أرقام حقيقية (سعر الذهب من stocks.db/gold_prices). لا except-pass.

Usage:
    python3 vps-service/analyzers/zakat_calculator.py \\
        --portfolio "COMI:EGX:130:100,SWDY:EGX:116:200" --gold-grams 50
"""
from __future__ import annotations
import os, sys, sqlite3, json
from pathlib import Path
from typing import Optional, Dict, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))

NISAB_GRAMS = 85.0       # نصاب الذهب = 85 جرام (إجماع جمهور الفقهاء).
ZAKAT_RATE = 0.025       # 2.5% (ربع العشر).
GOLD_KARAT_PREFERENCE = ['24', 'عيار 24', '21', 'عيار 21', '18', 'عيار 18']


def _to_float(v, default=0.0):
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace(',', '').strip())
    except (ValueError, TypeError):
        return default


def get_gold_price_per_gram() -> Tuple[float, str]:
    """سعر الجرام (EGP) من stocks.db/gold_prices — يفضّل عيار 24 (نصاب)."""
    stocks_db = os.environ.get('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
    if not os.path.exists(stocks_db):
        return 0.0, "stocks.db غير متاح"
    try:
        c = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
        # ابحث عن عيار 24 أولاً (النصاب القياسي)، ثم 21، ثم 18.
        for karat in GOLD_KARAT_PREFERENCE:
            row = c.execute(
                "SELECT price_per_gram, currency, karat FROM gold_prices WHERE karat = ? ORDER BY id DESC LIMIT 1",
                (karat,)
            ).fetchone()
            if row and _to_float(row[0]) > 0:
                c.close()
                return _to_float(row[0]), f"{row[2]} ({row[1]})"
        # fallback: أي صف متاح
        row = c.execute("SELECT price_per_gram, currency, karat FROM gold_prices ORDER BY id DESC LIMIT 1").fetchone()
        c.close()
        if row:
            return _to_float(row[0]), f"{row[2]} ({row[1]})"
    except Exception as e:
        sys.stderr.write(f"[zakat] gold price query error: {e}\n")
    return 0.0, "غير متاح"


def _portfolio_market_value(portfolio: List[Dict]) -> Tuple[float, List[Dict]]:
    """قيمة سوقية للمحفظة من رادار السيولة (current_price من scan_market)."""
    from liquidity_radar_v2 import scan_market
    # group by market
    by_market: Dict[str, List[Dict]] = {}
    for h in portfolio:
        by_market.setdefault(h['market'], []).append(h)
    total = 0.0
    enriched = []
    for market, holdings in by_market.items():
        try:
            result = scan_market(market)
            stocks = {str(s.get('ticker', '')).upper(): s for s in result.get('stocks', [])}
        except Exception as e:
            sys.stderr.write(f"[zakat] scan_market({market}) error: {e}\n")
            stocks = {}
        for h in holdings:
            s = stocks.get(h['ticker'].upper())
            current = _to_float(s.get('entry_defense', {}).get('entry_level')) if s else _to_float(h.get('entry_price'))
            value = current * h['shares']
            total += value
            enriched.append({**h, 'current_price': round(current, 4), 'market_value': round(value, 2)})
    return total, enriched


def compute_hedging_ratio(stocks_value: float, gold_value: float) -> Dict:
    """مؤشر التحوط: نسبة الذهب إلى الأسهم + اقتراح إعادة التوازن."""
    total = stocks_value + gold_value
    gold_pct = (gold_value / total * 100.0) if total > 0 else 0.0
    stocks_pct = (stocks_value / total * 100.0) if total > 0 else 0.0
    # اقتراح: في المسار الهابط، يُفضّل 20-40% ذهب (ملاذ آمن).
    suggestion = "متوازن"
    if gold_pct < 20.0:
        suggestion = "🔴 نسبة الذهب منخفضة (<20%) — في المسار الهابط يُوصى بزيادة الذهب لـ 20-40% (ملاذ آمن)"
    elif gold_pct > 50.0:
        suggestion = "🟡 نسبة الذهب عالية (>50%) — فرصة لإعادة التوازن نحو الأسهم الكاش-ريتش"
    else:
        suggestion = "🟢 نسبة تحوط مناسبة (20-50% ذهب)"
    return {
        'gold_value_egp': round(gold_value, 2), 'stocks_value_egp': round(stocks_value, 2),
        'gold_pct': round(gold_pct, 2), 'stocks_pct': round(stocks_pct, 2),
        'hedging_ratio_gold_to_stocks': round(gold_value / stocks_value, 4) if stocks_value > 0 else None,
        'suggestion': suggestion,
    }


def compute_zakat(portfolio: List[Dict], gold_grams: float) -> Dict:
    """حساب الزكاة الشرعية (نصاب الذهب + الأصول المتداولة)."""
    gold_price, gold_src = get_gold_price_per_gram()
    gold_value = gold_grams * gold_price
    stocks_value, enriched = _portfolio_market_value(portfolio)
    # نصاب الذهب = 85g × سعر الجرام.
    nisab_value = NISAB_GRAMS * gold_price
    # زكاة الذهب (2.5%) — لو الذهب >= النصاب (85g) OR القيمة >= نصاب.
    gold_above_nisab = gold_grams >= NISAB_GRAMS or gold_value >= nisab_value
    gold_zakat = (gold_value * ZAKAT_RATE) if gold_above_nisab else 0.0
    # زكاة الأسهم المتداولة (2.5% من القيمة السوقية — عامل تجاري).
    stocks_zakat = (stocks_value * ZAKAT_RATE) if stocks_value >= nisab_value else 0.0
    total_zakat = gold_zakat + stocks_zakat
    return {
        'gold': {
            'grams': gold_grams, 'price_per_gram_egp': round(gold_price, 2), 'source': gold_src,
            'value_egp': round(gold_value, 2), 'nisab_grams': NISAB_GRAMS,
            'nisab_value_egp': round(nisab_value, 2), 'above_nisab': gold_above_nisab,
            'zakat_egp': round(gold_zakat, 2),
        },
        'stocks': {
            'market_value_egp': round(stocks_value, 2), 'above_nisab': stocks_value >= nisab_value,
            'zakat_egp': round(stocks_zakat, 2), 'holdings': enriched,
        },
        'hedging': compute_hedging_ratio(stocks_value, gold_value),
        'total_zakat_egp': round(total_zakat, 2),
        'zakat_rate_pct': ZAKAT_RATE * 100,
    }


def parse_portfolio(s: str) -> List[Dict]:
    """parse 'TICKER:MARKET:ENTRY:SHARES,...' → list of holdings."""
    out = []
    for item in s.split(','):
        parts = item.strip().split(':')
        if len(parts) >= 4:
            out.append({
                'ticker': parts[0].strip(), 'market': parts[1].strip(),
                'entry_price': _to_float(parts[2]), 'shares': _to_float(parts[3]),
            })
    return out


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description='حساب الزكاة + مؤشر التحوط (Phase 3)')
    p.add_argument('--portfolio', required=True, help='TICKER:MARKET:ENTRY:SHARES,...')
    p.add_argument('--gold-grams', type=float, default=0.0, help='جرامات الذهب الممتلكة')
    args = p.parse_args()
    portfolio = parse_portfolio(args.portfolio)
    if not portfolio and args.gold_grams == 0:
        print("❌ لا محفظة ولا ذهب"); return 1
    r = compute_zakat(portfolio, args.gold_grams)
    print("=" * 72)
    print("💰 تقرير الزكاة الشرعية + مؤشر التحوط")
    print("=" * 72)
    g, s, h = r['gold'], r['stocks'], r['hedging']
    print(f"\n🥇 الذهب:")
    print(f"  جرامات: {g['grams']}g | سعر الجرام: {g['price_per_gram_egp']} EGP ({g['source']})")
    print(f"  القيمة: {g['value_egp']} EGP | النصاب: {g['nisab_grams']}g = {g['nisab_value_egp']} EGP")
    print(f"  فوق النصاب: {'✓' if g['above_nisab'] else '✗'} | زكاة الذهب: {g['zakat_egp']} EGP")
    print(f"\n📈 الأسهم المتداولة:")
    print(f"  القيمة السوقية: {s['market_value_egp']} EGP | فوق النصاب: {'✓' if s['above_nisab'] else '✗'} | زكاة الأسهم: {s['zakat_egp']} EGP")
    print(f"\n⚖️ مؤشر التحوط:")
    print(f"  ذهب {h['gold_pct']}% | أسهم {h['stocks_pct']}% | نسبة ذهب/أسهم: {h['hedging_ratio_gold_to_stocks']}")
    print(f"  {h['suggestion']}")
    print(f"\n💳 إجمالي الزكاة المستحقة: {r['total_zakat_egp']} EGP ({r['zakat_rate_pct']}%)")
    print("=" * 72)
    return 0


if __name__ == '__main__':
    sys.exit(main())
