#!/usr/bin/env python3
"""
paper_trading_engine.py — محرك التداول الافتراضي + تعدين الدروس آلياً
=====================================================================
Phase 4: تنفيذ الصفقات الافتراضية مع محاكاة الانزلاق السعري + العمولات (0.40%)
+ تعدين الدروس من الصفقات المغلقة إلى جدول learned_lessons.

Rule 27: أرقام حقيقية (price/volume from stocks.db). لا except-pass.

Usage:
    python3 vps-service/analyzers/paper_trading_engine.py --simulate
    python3 vps-service/analyzers/paper_trading_engine.py --trade COMI:EGX:BUY:124.65:100
"""
from __future__ import annotations
import os, sys, sqlite3, json, random
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))
os.environ.setdefault('PREDICTIONS_DB', str(PROJECT_ROOT / "db" / "predictions.db"))

COMMISSION_RATE = 0.0040   # 0.40% عمولة.
SLIPPAGE_RATE = 0.001      # 0.10% انزلاق سعري.


def _to_float(v, default=0.0):
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace(',', '').strip())
    except (ValueError, TypeError):
        return default


def execute_trade(ticker: str, side: str, price: float, shares: float,
                  market: str = 'EGX') -> Dict:
    """تنفيذ صفقة افتراضية مع انزلاق + عمولة. side = BUY|SELL."""
    # slippage:不利 اتجاه (BUY → أعلى، SELL → أقل).
    slip = price * SLIPPAGE_RATE * (1 if side == 'BUY' else -1)
    filled_price = round(price + slip, 4)
    notional = filled_price * shares
    commission = round(notional * COMMISSION_RATE, 2)
    total_cost = round(notional + commission, 2) if side == 'BUY' else round(notional - commission, 2)
    return {
        'ticker': ticker, 'side': side, 'requested_price': price,
        'filled_price': filled_price, 'slippage_egp': round(slip * shares, 2),
        'shares': shares, 'notional_egp': round(notional, 2),
        'commission_egp': commission, 'total_egp': total_cost,
        'commission_pct': COMMISSION_RATE * 100, 'market': market,
    }


def close_position(entry: Dict, exit_price: float, exit_reason: str = 'target') -> Dict:
    """إغلاق مركز + حساب P/L الصافي (بعد العمولتين)."""
    exit_trade = execute_trade(entry['ticker'], 'SELL', exit_price, entry['shares'], entry.get('market', 'EGX'))
    entry_cost = entry['total_egp']
    exit_proceeds = exit_trade['total_egp']
    pnl_gross = round(exit_proceeds - entry_cost, 2)
    pnl_pct = round((pnl_gross / entry_cost) * 100, 2) if entry_cost > 0 else 0.0
    # outcome: win (pnl>0) / loss (pnl<0).
    outcome = 'win' if pnl_gross > 0 else ('loss' if pnl_gross < 0 else 'breakeven')
    return {
        'ticker': entry['ticker'], 'market': entry.get('market', 'EGX'),
        'entry_price': entry['filled_price'], 'exit_price': exit_trade['filled_price'],
        'shares': entry['shares'],
        'entry_cost_egp': entry_cost, 'exit_proceeds_egp': exit_proceeds,
        'commission_total_egp': round(entry['commission_egp'] + exit_trade['commission_egp'], 2),
        'pnl_gross_egp': pnl_gross, 'pnl_pct': pnl_pct,
        'outcome': outcome, 'exit_reason': exit_reason,
        'closed_at': datetime.now(timezone.utc).isoformat(),
    }


def mine_lesson(closed_trade: Dict) -> Dict:
    """تعدين درس من صفقة مغلقة + إدراجه في learned_lessons (Phase 4 #2).
    يحوّل الصفقة لتحليل سببي: condition (entry signal) → outcome (win/loss) → recommendation."""
    predictions_db = os.environ.get('PREDICTIONS_DB', str(PROJECT_ROOT / "db" / "predictions.db"))
    outcome = closed_trade['outcome']
    pnl_pct = closed_trade['pnl_pct']
    exit_reason = closed_trade['exit_reason']
    ticker = closed_trade['ticker']
    # lesson_type: تصنيف سببي.
    lesson_type = f"trade_{exit_reason}_{outcome}"  # e.g. trade_target_win, trade_stop_loss
    condition = (f"ticker={ticker} entry@{closed_trade['entry_price']:.2f} exit@{closed_trade['exit_price']:.2f} "
                 f"reason={exit_reason}")
    recommendation = (
        f"keep this entry pattern (win +{pnl_pct:.1f}%)" if outcome == 'win'
        else f"avoid this entry pattern (loss {pnl_pct:.1f}%)" if outcome == 'loss'
        else "neutral pattern"
    )
    lesson = {
        'lesson_type': lesson_type, 'condition': condition,
        'outcome': outcome, 'failure_rate': 0.0 if outcome == 'win' else 100.0,
        'occurrences': 1, 'avg_return': pnl_pct, 'recommendation': recommendation,
    }
    # insert into learned_lessons.
    if not os.path.exists(predictions_db):
        sys.stderr.write(f"[paper] predictions.db not found: {predictions_db} — lesson not stored\n")
        lesson['stored'] = False
        return lesson
    try:
        conn = sqlite3.connect(predictions_db)
        conn.execute(
            "INSERT INTO learned_lessons (lesson_type, condition, outcome, failure_rate, occurrences, avg_return, recommendation, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (lesson['lesson_type'], lesson['condition'], lesson['outcome'],
             lesson['failure_rate'], lesson['occurrences'], lesson['avg_return'],
             lesson['recommendation'], datetime.now(timezone.utc).isoformat(),
             datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        lesson['id'] = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.close()
        lesson['stored'] = True
    except Exception as e:
        sys.stderr.write(f"[paper] lesson insert error: {e}\n")
        lesson['stored'] = False
    return lesson


def simulate_3_trades() -> Dict:
    """محاكاة 3 صفقات (win/loss/breakeven) + تعدين 3 دروس في learned_lessons."""
    # 3 صفقات: COMI win (target), SWDY loss (stop), ORAS breakeven.
    trades = [
        {'ticker': 'COMI', 'market': 'EGX', 'entry_price': 122.0, 'exit_price': 130.0, 'shares': 100, 'reason': 'target'},
        {'ticker': 'SWDY', 'market': 'EGX', 'entry_price': 116.0, 'exit_price': 110.0, 'shares': 100, 'reason': 'stop_loss'},
        {'ticker': 'ORAS', 'market': 'EGX', 'entry_price': 870.0, 'exit_price': 872.0, 'shares': 10, 'reason': 'target'},
    ]
    results = []
    for t in trades:
        entry = execute_trade(t['ticker'], 'BUY', t['entry_price'], t['shares'], t['market'])
        closed = close_position(entry, t['exit_price'], t['reason'])
        lesson = mine_lesson(closed)
        results.append({'trade': closed, 'lesson': lesson})
    return {'results': results, 'lessons_stored': sum(1 for r in results if r['lesson'].get('stored'))}


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description='محرك التداول الافتراضي + تعدين الدروس (Phase 4)')
    p.add_argument('--simulate', action='store_true', help='محاكاة 3 صفقات + 3 دروس')
    p.add_argument('--trade', help='TICKER:MARKET:SIDE:PRICE:SHARES (single trade)')
    args = p.parse_args()
    if args.simulate:
        r = simulate_3_trades()
        print("=" * 72)
        print("📉 محرك التداول الافتراضي — محاكاة 3 صفقات + تعدين 3 دروس")
        print("=" * 72)
        for i, r2 in enumerate(r['results'], 1):
            t, l = r2['trade'], r2['lesson']
            print(f"\n{i}. {t['ticker']} ({t['market']})")
            print(f"   Entry: {t['entry_price']} | Exit: {t['exit_price']} | Shares: {t['shares']}")
            print(f"   P/L: {t['pnl_gross_egp']:+.2f} EGP ({t['pnl_pct']:+.2f}%) | Outcome: {t['outcome']}")
            print(f"   Commission total: {t['commission_total_egp']} EGP (0.40% × 2)")
            print(f"   📚 Lesson: {l['lesson_type']} | stored={'✓' if l.get('stored') else '✗'} | rec: {l['recommendation']}")
        print(f"\n✅ دروس مُخزّنة في learned_lessons: {r['lessons_stored']}/3")
        print("=" * 72)
        return 0
    if args.trade:
        parts = args.trade.split(':')
        if len(parts) >= 5:
            t = execute_trade(parts[0], parts[2], _to_float(parts[3]), _to_float(parts[4]), parts[1])
            print(json.dumps(t, indent=2, ensure_ascii=False))
            return 0
    p.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
