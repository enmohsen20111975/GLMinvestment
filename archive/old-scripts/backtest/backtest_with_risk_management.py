#!/usr/bin/env python3
"""
backtest_with_risk_management.py — Backtest بـ Position Sizing + Circuit Breaker
================================================================================
EGX-STRATEGY (2026-08-30): backtest شامل بـ risk management الكامل.

يقرأ التوقعات من predictions.db (الـ 43 توقع بـ العتبات الجديدة) ويطبّق:
  1. Position Sizing: مخاطرة 1-1.5% لكل صفقة (حساب حجم المركز من مسافة الوقف).
  2. Circuit Breaker: 3 خسائر متتالية → وقف 3 أيام تداول.

الـ equity curve:
  - نبدأ بـ 100,000 EGP.
  - لكل صفقة: position_value = risk_amount / stop_distance_pct.
  - لو الصفقة رابحة: equity += position_value × return_pct.
  - لو خاسرة: equity -= position_value × |return_pct| (بس max = risk_amount).

النتائج:
  - Win Rate
  - Profit Factor
  - Max Drawdown
  - Total Return (%)
  - عدد الصفقات
  - equity curve
"""
from __future__ import annotations
import os, sys, json, sqlite3
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

from utils.position_sizing import calculate_risk_based_position
from utils.circuit_breaker import apply_circuit_breaker_to_trades


def load_predictions() -> list:
    """حمّل التوقعات الجديدة (id > 22604)."""
    db_path = str(PROJECT_ROOT / 'db' / 'predictions.db')
    if not os.path.exists(db_path):
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute('''
            SELECT id, ticker, signal, persona, entry_price, target_price, stop_loss,
                   prediction_date, outcome_date, status, exit_type, actual_return,
                   morning_bell, evidence_count
            FROM predictions
            WHERE id > 22604 AND actual_return IS NOT NULL AND ABS(actual_return) <= 50
            ORDER BY prediction_date ASC
        ''').fetchall()
    except sqlite3.OperationalError as e:
        print(f'SQL error: {e}')
        rows = []
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        # parse liquidity from kill_filter_result
        kfr = d.get('kill_filter_result', '') or ''
        d['liquidity_pos_mult'] = 1.0
        d['liquidity_type'] = 'neutral'
        if 'LIQUIDITY:' in kfr:
            try:
                liq_part = kfr.split('LIQUIDITY:')[1].split('|')[0].strip()
                # format: "smart_accumulation(80) pos_mult=1.0"
                ltype = liq_part.split('(')[0].strip()
                pos_mult_str = liq_part.split('pos_mult=')[1].strip() if 'pos_mult=' in liq_part else '1.0'
                d['liquidity_type'] = ltype
                d['liquidity_pos_mult'] = float(pos_mult_str)
            except:
                pass
        results.append(d)
    return results


def compute_metrics(returns: list, equity_curve: list = None) -> dict:
    """احسب WR / PF / MaxDD / AvgWin / AvgLoss."""
    if not returns:
        return {'total': 0, 'wr': 0, 'pf': 0, 'avg_win': 0, 'avg_loss': 0, 'max_dd': 0, 'total_ret': 0}

    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r <= 0]
    tw = sum(wins)
    tl = abs(sum(losses))
    wr = len(wins) / len(returns) * 100
    pf = tw / tl if tl > 0 else float('inf')
    avg_win = tw / len(wins) if wins else 0
    avg_loss = tl / len(losses) if losses else 0
    total_ret = sum(returns)

    # Max DD from equity curve
    max_dd = 0
    if equity_curve:
        peak = equity_curve[0]
        for val in equity_curve:
            if val > peak:
                peak = val
            dd_pct = (peak - val) / peak * 100 if peak > 0 else 0
            if dd_pct > max_dd:
                max_dd = dd_pct

    return {
        'total': len(returns),
        'wins': len(wins),
        'losses': len(losses),
        'wr': round(wr, 1),
        'pf': round(pf, 3) if pf != float('inf') else '∞',
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'max_dd': round(max_dd, 2),
        'total_ret': round(total_ret, 2),
    }


def run_backtest(initial_capital: float = 100000, risk_pct: float = 1.2,
                 cb_mode: str = 'block', cb_cooldown: int = 3) -> dict:
    """شغّل backtest بـ position sizing + circuit breaker."""
    preds = load_predictions()
    print(f'\n{"="*70}')
    print(f'  Backtest: Position Sizing + Circuit Breaker')
    print(f'  Initial Capital: {initial_capital:,.0f} EGP | Risk: {risk_pct}% per trade')
    print(f'  Circuit Breaker: {cb_mode} mode, {cb_cooldown} days cooldown')
    print(f'{"="*70}')
    print(f'📊 إجمالي التوقعات: {len(preds)}')

    if not preds:
        return {}

    # بناء trades list للـ circuit breaker
    trades = []
    for p in preds:
        ret = float(p['actual_return'])
        trades.append({
            'date': p['prediction_date'],
            'return': ret,
            'ticker': p['ticker'],
            'entry_price': p['entry_price'],
            'stop_price': p['stop_loss'],
            'prediction': p,
        })

    # طبّق circuit breaker
    cb_result = apply_circuit_breaker_to_trades(trades, mode=cb_mode, cooldown_days=cb_cooldown)
    executed_trades = cb_result['executed_trades']
    skipped_trades = cb_result['skipped_trades']
    cb_stats = cb_result['stats']

    print(f'📊 بعد Circuit Breaker: {len(executed_trades)} executed, {len(skipped_trades)} skipped')
    print(f'📊 CB stats: {cb_stats}')

    # محاكاة equity curve بـ position sizing
    equity = initial_capital
    equity_curve = [equity]
    trade_returns_pct = []  # نسبة الربح/الخسارة من equity
    trade_returns_abs = []  # الربح/الخسارة المطلق

    for trade in executed_trades:
        p = trade['prediction']
        entry = float(p['entry_price'])
        stop = float(p['stop_loss'])
        ret_pct = float(p['actual_return'])  # نسبة الربح/الخسارة الأصلية

        # حساب حجم المركز
        pos = calculate_risk_based_position(
            capital=equity,
            entry_price=entry,
            stop_price=stop,
            confidence=1.0,  # ثقة ثابتة للـ backtest
            risk_per_trade_pct=risk_pct,
        )

        if pos['action'] != 'enter':
            # skip لو position sizing رفض
            continue

        # ── EGX-STRATEGY-STAGE2: تعديل حجم المركز حسب نوع السيولة ──
        _liq_pos_mult = float(p.get('liquidity_pos_mult', 1.0))
        _liq_type = p.get('liquidity_type', 'neutral')
        # position_value النهائي = position_value × liquidity_pos_mult
        position_value = pos['position_value'] * _liq_pos_mult

        # الربح/الخسارة المطلق = position_value × return_pct / 100
        abs_return = position_value * ret_pct / 100

        # لو الصفقة خسارة، max loss = risk_amount (stop loss)
        if ret_pct < 0:
            risk_amount = pos['risk_amount']
            abs_return = max(abs_return, -risk_amount)  # ما يخسرش أكتر من risk_amount

        equity += abs_return
        equity_curve.append(equity)

        # نسبة من equity قبل الصفقة
        equity_before = equity - abs_return
        if equity_before > 0:
            trade_returns_pct.append((abs_return / equity_before) * 100)
        else:
            trade_returns_pct.append(0)
        trade_returns_abs.append(abs_return)

    # حساب metrics
    metrics = compute_metrics(trade_returns_pct, equity_curve)
    final_equity = equity
    total_return_pct = ((final_equity - initial_capital) / initial_capital) * 100

    print(f'\n📈 النتائج:')
    print(f'  Initial Capital: {initial_capital:,.0f} EGP')
    print(f'  Final Equity:    {final_equity:,.0f} EGP')
    print(f'  Total Return:    {total_return_pct:+.2f}%')
    print(f'  صفقات executed:  {metrics["total"]}')
    print(f'  Wins / Losses:   {metrics["wins"]} / {metrics["losses"]}')
    print(f'  Win Rate:        {metrics["wr"]}%')
    print(f'  Profit Factor:   {metrics["pf"]}')
    print(f'  Avg Win:         +{metrics["avg_win"]}%')
    print(f'  Avg Loss:        -{metrics["avg_loss"]}%')
    print(f'  Max Drawdown:    -{metrics["max_dd"]}%')
    print(f'  CB blocks:       {cb_stats["total_blocks"]}')
    print(f'  CB trades skipped: {cb_stats["trades_skipped"]}')

    return {
        'initial_capital': initial_capital,
        'final_equity': final_equity,
        'total_return_pct': round(total_return_pct, 2),
        'metrics': metrics,
        'cb_stats': cb_stats,
        'equity_curve': equity_curve,
    }


def main():
    # backtest 1: بدون circuit breaker (baseline)
    print('\n' + '═'*70)
    print('  Backtest 1: Position Sizing فقط (بدون Circuit Breaker)')
    print('═'*70)
    r1 = run_backtest(initial_capital=100000, risk_pct=1.2, cb_mode='reduce', cb_cooldown=0)

    # backtest 2: Position Sizing + Circuit Breaker (block mode)
    print('\n' + '═'*70)
    print('  Backtest 2: Position Sizing + Circuit Breaker (block mode, 3 days)')
    print('═'*70)
    r2 = run_backtest(initial_capital=100000, risk_pct=1.2, cb_mode='block', cb_cooldown=3)

    # backtest 3: Position Sizing + Circuit Breaker (reduce mode)
    print('\n' + '═'*70)
    print('  Backtest 3: Position Sizing + Circuit Breaker (reduce mode, 3 days)')
    print('═'*70)
    r3 = run_backtest(initial_capital=100000, risk_pct=1.2, cb_mode='reduce', cb_cooldown=3)

    # مقارنة
    print('\n' + '═'*70)
    print('  مقارنة النتائج')
    print('═'*70)
    print(f'  {"المقياس":<25} {"PS فقط":<18} {"PS+CB(block)":<18} {"PS+CB(reduce)":<18}')
    print(f'  {"─"*70}')
    if r1 and r2 and r3:
        print(f'  {"Total Return %":<25} {r1["total_return_pct"]:+.2f}%{"":<10} {r2["total_return_pct"]:+.2f}%{"":<10} {r3["total_return_pct"]:+.2f}%')
        print(f'  {"Win Rate %":<25} {r1["metrics"]["wr"]}%{"":<14} {r2["metrics"]["wr"]}%{"":<14} {r3["metrics"]["wr"]}%')
        print(f'  {"Profit Factor":<25} {r1["metrics"]["pf"]:<18} {r2["metrics"]["pf"]:<18} {r3["metrics"]["pf"]:<18}')
        print(f'  {"Max Drawdown %":<25} -{r1["metrics"]["max_dd"]}%{"":<13} -{r2["metrics"]["max_dd"]}%{"":<13} -{r3["metrics"]["max_dd"]}%')
        print(f'  {"Avg Win %":<25} +{r1["metrics"]["avg_win"]}%{"":<14} +{r2["metrics"]["avg_win"]}%{"":<14} +{r3["metrics"]["avg_win"]}%')
        print(f'  {"Avg Loss %":<25} -{r1["metrics"]["avg_loss"]}%{"":<14} -{r2["metrics"]["avg_loss"]}%{"":<14} -{r3["metrics"]["avg_loss"]}%')
        print(f'  {"Total Trades":<25} {r1["metrics"]["total"]:<18} {r2["metrics"]["total"]:<18} {r3["metrics"]["total"]:<18}')
        print(f'  {"CB blocks":<25} {r1["cb_stats"]["total_blocks"]:<18} {r2["cb_stats"]["total_blocks"]:<18} {r3["cb_stats"]["total_blocks"]:<18}')
        print(f'  {"CB trades skipped":<25} {r1["cb_stats"]["trades_skipped"]:<18} {r2["cb_stats"]["trades_skipped"]:<18} {r3["cb_stats"]["trades_skipped"]:<18}')

    # حفظ النتائج
    output_path = str(PROJECT_ROOT / 'db' / 'backtest_risk_management_results.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'baseline_ps_only': {k: v for k, v in r1.items() if k != 'equity_curve'},
            'ps_plus_cb_block': {k: v for k, v in r2.items() if k != 'equity_curve'},
            'ps_plus_cb_reduce': {k: v for k, v in r3.items() if k != 'equity_curve'},
        }, f, ensure_ascii=False, indent=2, default=str)
    print(f'\n💾 تم حفظ النتائج في {output_path}')


if __name__ == '__main__':
    main()
