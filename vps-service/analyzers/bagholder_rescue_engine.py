#!/usr/bin/env python3
"""
bagholder_rescue_engine.py — مستشار الإنقاذ المالي (Rescue Advisor)
====================================================================
Phase 2 (Quad Core): يفحص السهم الخاسر + يقرر قرار الإنقاذ:
  - 🛑 CUT_LOSS:  كسر الدعوم + الشركة تنزف كاش (free_cf سالب).
  - 🔄 AVERAGE_DOWN: قاع تجميع مؤسسي (SMC Order Block) + كاش-ريتش (free_cf موجب).
  - ⏳ HOLD: دعم تاريخي + عائد توزيعات يغطي النزول.

يقرأ من رادار السيولة (whale flow + fundamentals + entry_defense) + جدول stocks (dividend_yield).
Rule 27: أرقام حقيقية فقط. لا except-pass (يُسجّل الأخطاء صراحة).

Usage:
    python3 vps-service/analyzers/bagholder_rescue_engine.py --ticker COMI --market EGX --entry 130 --shares 100
"""
from __future__ import annotations
import os, sys, sqlite3
from pathlib import Path
from typing import Optional, Dict, Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))


def _to_float(v, default=0.0):
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace(',', '').strip())
    except (ValueError, TypeError):
        return default


def _get_dividend_yield(ticker: str, market: str) -> float:
    """عائد التوزيعات من stocks.db (Rule 27: بيانات حقيقية)."""
    stocks_db = os.environ.get('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
    if not os.path.exists(stocks_db):
        return 0.0
    try:
        c = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
        row = c.execute(
            "SELECT dividend_yield FROM stocks WHERE ticker = ? AND market = ? LIMIT 1",
            (ticker, market)
        ).fetchone()
        c.close()
        if row and row[0]:
            return _to_float(row[0])
    except Exception as e:
        # لا بلع أخطاء — يُسجّل صراحة (Rule: no except-pass).
        sys.stderr.write(f"[rescue] dividend_yield query error: {e}\n")
    return 0.0


def rescue(ticker: str, market: str, entry_price: float, shares: float = 100) -> Dict[str, Any]:
    """فحص السهم الخاسر + قرار الإنقاذ + Autopsy."""
    from liquidity_radar_v2 import scan_market
    result = scan_market(market)
    stocks = result.get('stocks', [])
    stock = next((s for s in stocks if str(s.get('ticker', '')).upper() == ticker.upper()), None)
    if not stock:
        return {
            'ticker': ticker, 'market': market, 'decision': 'NO_DATA',
            'reason': f'{ticker} غير موجود في مسح {market} — لا بيانات للإنقاذ',
        }

    entry_defense = stock.get('entry_defense', {}) or {}
    fundamentals = stock.get('fundamentals', {}) or {}
    whale = stock.get('whale', {}) or {}

    current = _to_float(entry_defense.get('entry_level'))
    defense = _to_float(entry_defense.get('defense_level'))
    free_cf = fundamentals.get('free_cash_flow')
    cash = fundamentals.get('cash_on_hand')
    net_flow = _to_float(whale.get('net_flow_egp'))
    flow_strength = whale.get('flow_strength', '')
    targets_available = stock.get('targets_available', True)

    # ── flags ──
    pnl_pct = ((current - entry_price) / entry_price * 100.0) if entry_price > 0 and current > 0 else 0.0
    pnl_egp = (current - entry_price) * shares if current > 0 else 0.0
    whale_distributing = net_flow < 0
    whale_accumulating = net_flow > 0
    broke_support = (defense > 0 and current < defense)
    cash_bleeding = (free_cf is not None and free_cf < 0)
    cash_rich = (free_cf is not None and free_cf > 0)
    # SMC Order Block proxy: price near defense (within 2%) + whale accumulating.
    smc_ob = (defense > 0 and current > 0 and abs(current - defense) / defense < 0.02 and whale_accumulating)
    dividend_yield = _get_dividend_yield(ticker, market)
    # dividend_yield stored as a percentage number (e.g. 6.37 = 6.37%).
    dividend_covers_drop = (dividend_yield >= 4.0 and current <= entry_price * 0.96)  # ≥4% yield + down >4%

    # ── decision rules (الترتيب حرج: CUT_LOSS أولوية) ──
    if broke_support and cash_bleeding:
        decision = '🛑 CUT_LOSS'
        reason = (f'كسر الدعوم ({current:.2f} < {defense:.2f}) + الشركة تنزف كاش '
                  f'(free_cf={free_cf/1e9:+.2f}B) — اقطع فوراً.')
    elif smc_ob and cash_rich:
        decision = '🔄 AVERAGE_DOWN'
        reason = (f'قاع تجميع مؤسسي (SMC OB قرب {defense:.2f}) + كاش-ريتش '
                  f'(free_cf={free_cf/1e9:+.2f}B) — برّد بحساب دقيق.')
    elif dividend_covers_drop and not broke_support:
        decision = '⏳ HOLD'
        reason = (f'دعم تاريخي + عائد توزيعات {dividend_yield:.2f}% يغطي النزول '
                  f'({pnl_pct:+.1f}%) — اصبر واستلم أرباحك.')
    else:
        decision = '⏳ HOLD'
        reason = (f'لا شرط قطع قاطع (دعوم سليمة) ولا تجميع مؤسسي واضح — '
                  f'HOLD مراقب. تدفق: {flow_strength}.')

    return {
        'ticker': ticker, 'market': market,
        'entry_price': entry_price, 'current_price': round(current, 4),
        'shares': shares, 'pnl_pct': round(pnl_pct, 2), 'pnl_egp': round(pnl_egp, 2),
        'decision': decision, 'reason': reason,
        'fundamentals': {
            'free_cf': free_cf, 'cash': cash,
            'cash_rich': cash_rich, 'cash_bleeding': cash_bleeding,
        },
        'whale': {
            'net_flow_egp': round(net_flow, 0), 'distributing': whale_distributing,
            'accumulating': whale_accumulating, 'flow_strength': flow_strength,
        },
        'levels': {'defense': round(defense, 4) if defense else None, 'current': round(current, 4)},
        'flags': {
            'broke_support': broke_support, 'smc_ob': smc_ob,
            'whale_distributing': whale_distributing, 'dividend_yield': round(dividend_yield, 4),
            'dividend_covers_drop': dividend_covers_drop, 'targets_available': targets_available,
        },
    }


def diagnose(ticker: str, entry_price: float, shares: float = 1000, market: str = 'EGX') -> Dict[str, Any]:
    """Phase 2 Nuclear: تشخيص سريع + Autopsy + سيناريو تعويض رأس المال الزمني/المالي.
    Convenience wrapper: diagnose('COMI', 130.0, 1000) → full rescue report."""
    r = rescue(ticker, market, entry_price, shares)
    if r.get('decision') == 'NO_DATA':
        return r
    # Capital recovery scenario: كم يحتاج السهم ليرتفع لتعويض الخسارة؟
    current = _to_float(r.get('current_price'))
    loss_egp = abs(_to_float(r.get('pnl_egp'))) if r.get('pnl_egp', 0) < 0 else 0
    if loss_egp > 0 and current > 0:
        recovery_pct = (loss_egp / (current * shares)) * 100 if shares > 0 else 0
        r['capital_recovery'] = {
            'loss_egp': round(loss_egp, 2),
            'recovery_needed_pct': round(recovery_pct, 2),
            'break_even_price': round(entry_price, 4),
            'current_price': round(current, 4),
            'note': f'السهم يحتاج ارتفاع {recovery_pct:.1f}% من الحالي ({current:.2f}) للوصول لنقطة الدخول ({entry_price:.2f})',
        }
    return r


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description='مستشار الإنقاذ المالي — Rescue Advisor (Phase 2)')
    p.add_argument('--ticker', required=True, help='السهم (e.g. COMI)')
    p.add_argument('--market', default='EGX', help='السوق (EGX, TADAWUL, ...)')
    p.add_argument('--entry', type=float, required=True, help='سعر الدخول')
    p.add_argument('--shares', type=float, default=100, help='عدد الأسهم')
    args = p.parse_args()

    r = rescue(args.ticker, args.market, args.entry, args.shares)
    print("=" * 72)
    print(f"🔬 Autopsy Report — {r.get('ticker')} ({r.get('market')})")
    print("=" * 72)
    if r.get('decision') == 'NO_DATA':
        print(f"❌ {r['reason']}")
        return 1
    print(f"Entry: {r['entry_price']:.2f} | Current: {r['current_price']:.2f} | "
          f"P/L: {r['pnl_pct']:+.2f}% ({r['pnl_egp']:+.2f} EGP)")
    print(f"\n➡️  Decision: {r['decision']}")
    print(f"   Reason: {r['reason']}")
    print(f"\n📊 Flags:")
    for k, v in r['flags'].items():
        print(f"   {k}: {v}")
    print(f"\n💰 Fundamentals: free_cf={r['fundamentals']['free_cf']} | "
          f"cash={r['fundamentals']['cash']} | cash_rich={r['fundamentals']['cash_rich']}")
    print(f"🐋 Whale: {r['whale']['flow_strength']} | net_flow={r['whale']['net_flow_egp']} | "
          f"distributing={r['whale']['distributing']}")
    print(f"📐 Levels: defense={r['levels']['defense']} | current={r['levels']['current']}")
    print("=" * 72)
    return 0


if __name__ == '__main__':
    sys.exit(main())
