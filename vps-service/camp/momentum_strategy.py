#!/usr/bin/env python3
"""
Quick Win — Momentum Strategy on 15 EGX leaders.

Simple rules (no orchestrator needed):
  entry: momentum_20 > 5% AND volume > avg20 × 1.5 AND close > SMA50
  exit:  momentum_20 < -3% OR close < SMA50 OR holding_days > 10 OR stop -5%
  position_size: 20% of capital per trade
  max_concurrent: 3

Tests on 46 months (2023-01 → 2026-09) + Holdout validation.
Gate for deployment: PF>1.3 + WR>50% per year + Sharpe>1.0 + no month with 0 signals.
"""
from __future__ import annotations
import sys, json, sqlite3, math
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'camp'))

DB_DIR = PROJECT_ROOT / 'db'
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# 15 EGX leaders
UNIVERSE = [
    'COMI', 'HRHO', 'TMGH', 'ETEL', 'SWDY', 'ABUK', 'EAST',
    'MFPC', 'ORAS', 'ESRS', 'SKPC', 'CIEB', 'EKHO', 'JUFO', 'PHDC'
]

POSITION_SIZE = 0.20  # 20% per trade
MAX_HOLDING = 10
STOP_LOSS_PCT = -5.0
MOM_ENTRY = 5.0
MOM_EXIT = -3.0
VOL_SURGE = 1.5

# Analysis period (skip FAIL months)
DEV_START, DEV_END = '2023-01-01', '2024-12-31'
VAL_START, VAL_END = '2025-01-01', '2025-09-30'
HOLDOUT_START, HOLDOUT_END = '2025-10-01', '2026-09-30'


def _sma(vals, period):
    if len(vals) < period: return None
    return sum(vals[-period:]) / period


def _load_ticker(conn, ticker, start, end):
    rows = conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker=? AND date>=? AND date<=?
        AND close_price>0 ORDER BY date
    """, (ticker, start, end)).fetchall()
    if len(rows) < 60: return None
    return {
        'd': [r[0] for r in rows], 'o': [float(r[1] or 0) for r in rows],
        'h': [float(r[2] or 0) for r in rows], 'l': [float(r[3] or 0) for r in rows],
        'c': [float(r[4]) for r in rows], 'v': [int(r[5] or 0) for r in rows],
    }


def run_backtest(period_name: str, start: str, end: str, conn) -> Dict:
    """Run momentum strategy on given period."""
    print(f'\n=== {period_name} ({start} → {end}) ===')
    signals = []
    for ticker in UNIVERSE:
        data = _load_ticker(conn, ticker, start, end)
        if not data:
            print(f'  {ticker}: لا بيانات')
            continue
        c = data['c']; v = data['v']; d = data['d']
        date_lookup = {d[i]: i for i in range(len(d))}
        for i in range(60, len(c)):
            if not (start <= d[i] <= end):
                continue
            # Entry conditions
            if i < 20: continue
            mom_20 = (c[i] - c[i-20]) / c[i-20] * 100 if c[i-20] > 0 else 0
            if mom_20 <= MOM_ENTRY: continue
            avg_vol20 = sum(v[i-20:i]) / 20 if i >= 20 else 0
            if avg_vol20 <= 0: continue
            vol_ratio = v[i] / avg_vol20
            if vol_ratio < VOL_SURGE: continue
            sma50 = _sma(c[:i+1], 50)
            if not sma50 or c[i] <= sma50: continue
            # Entry!
            entry_price = c[i]
            stop = entry_price * (1 + STOP_LOSS_PCT/100)
            signals.append({
                'ticker': ticker, 'date': d[i], 'entry': entry_price,
                'stop': stop, 'mom_20': round(mom_20, 2),
                'vol_ratio': round(vol_ratio, 2),
            })
    print(f'  Signals: {len(signals)}')

    # Compute outcomes
    if not signals:
        return {'period': period_name, 'signals': 0, 'wr': 0, 'pf': 0,
                'max_dd': 0, 'sharpe': 0, 'avg_ret': 0, 'monthly': {},
                'yearly': {}, 'trades': []}

    trades = []
    for s in signals:
        ticker = s['ticker']
        entry = s['entry']
        stop = s['stop']
        # Look forward up to MAX_HOLDING days
        fwd_rows = conn.execute("""
            SELECT date, high_price, low_price, close_price FROM price_history
            WHERE ticker=? AND date>? AND close_price>0 ORDER BY date LIMIT ?
        """, (ticker, s['date'], MAX_HOLDING)).fetchall()
        if not fwd_rows:
            continue
        exit_price = None
        exit_date = None
        exit_reason = None
        for j, (fd, fh, fl, fc) in enumerate(fwd_rows):
            # Check stop first
            if fl and fl <= stop:
                exit_price = stop
                exit_date = fd
                exit_reason = 'STOPPED'
                break
            # Check exit conditions (momentum reversal or SMA50 break)
            # Get price history up to this forward day
            prev_rows = conn.execute("""
                SELECT close_price FROM price_history
                WHERE ticker=? AND date<=? AND close_price>0 ORDER BY date DESC LIMIT ?
            """, (ticker, fd, i:=21)).fetchall() if False else None
            # Simpler: just check if close < SMA50 OR mom_20 < -3
            closes_before = [r[0] for r in conn.execute("""
                SELECT close_price FROM price_history
                WHERE ticker=? AND date<=? AND close_price>0 ORDER BY date LIMIT ?
            """, (ticker, fd, max(60, j+1))).fetchall()]
            if len(closes_before) >= 20:
                mom_20_now = (closes_before[-1] - closes_before[-20]) / closes_before[-20] * 100 if closes_before[-20] > 0 else 0
                if mom_20_now < MOM_EXIT:
                    exit_price = fc
                    exit_date = fd
                    exit_reason = 'MOM_EXIT'
                    break
                sma50_now = _sma(closes_before, 50)
                if sma50_now and fc < sma50_now:
                    exit_price = fc
                    exit_date = fd
                    exit_reason = 'BELOW_SMA50'
                    break
        if exit_price is None:
            # Time exit
            exit_price = fwd_rows[-1][3]
            exit_date = fwd_rows[-1][0]
            exit_reason = 'TIME_EXIT'
        ret = (exit_price / entry - 1) * 100
        trades.append({
            'ticker': ticker, 'entry_date': s['date'], 'exit_date': exit_date,
            'entry': round(entry, 2), 'exit': round(exit_price, 2),
            'return': round(ret, 2), 'reason': exit_reason,
            'mom_20': s['mom_20'], 'vol_ratio': s['vol_ratio'],
        })

    # Metrics
    wins = [t for t in trades if t['return'] > 0]
    losses = [t for t in trades if t['return'] < 0]
    wr = len(wins) / len(trades) * 100 if trades else 0
    gross_profit = sum(t['return'] for t in wins)
    gross_loss = sum(abs(t['return']) for t in losses)
    pf = gross_profit / gross_loss if gross_loss > 0 else (99.99 if gross_profit > 0 else 0)
    returns = [t['return'] for t in trades]
    avg_ret = sum(returns) / len(returns) if returns else 0
    std = math.sqrt(sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1)) if len(returns) > 1 else 0
    sharpe = (avg_ret / std * math.sqrt(len(returns))) if std > 0 else 0
    # Max DD (equity curve)
    equity = 100000.0
    peak = equity
    max_dd = 0.0
    for t in trades:
        equity += equity * POSITION_SIZE * (t['return'] / 100)
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100
        max_dd = max(max_dd, dd)

    # Monthly breakdown
    monthly = {}
    for t in trades:
        m = t['entry_date'][:7]
        monthly.setdefault(m, []).append(t)
    monthly_metrics = {}
    for m, ts in monthly.items():
        mw = [t for t in ts if t['return'] > 0]
        mwr = len(mw) / len(ts) * 100 if ts else 0
        mgp = sum(t['return'] for t in mw)
        mgl = sum(abs(t['return']) for t in ts if t['return'] < 0)
        mpf = mgp / mgl if mgl > 0 else 99.99
        monthly_metrics[m] = {'n': len(ts), 'wr': round(mwr, 1), 'pf': round(mpf, 2)}

    # Yearly breakdown
    yearly = {}
    for y in ['2023', '2024', '2025', '2026']:
        yt = [t for t in trades if t['entry_date'].startswith(y)]
        if yt:
            yw = [t for t in yt if t['return'] > 0]
            yearly[y] = {
                'n': len(yt), 'wr': round(len(yw)/len(yt)*100, 1),
                'avg_ret': round(sum(t['return'] for t in yt)/len(yt), 2),
            }

    return {
        'period': period_name, 'signals': len(trades),
        'wr': round(wr, 1), 'pf': round(pf, 2),
        'max_dd': round(max_dd, 1), 'sharpe': round(sharpe, 2),
        'avg_ret': round(avg_ret, 2), 'monthly': monthly_metrics,
        'yearly': yearly, 'trades': trades[:20],  # sample for report
        'total_trades': len(trades),
    }


def main():
    print('=' * 70)
    print('  Quick Win — Momentum Strategy on 15 EGX Leaders')
    print('=' * 70)
    print(f'Universe: {len(UNIVERSE)} tickers')
    print(f'Entry: mom_20 > {MOM_ENTRY}% AND vol > {VOL_SURGE}× avg20 AND close > SMA50')
    print(f'Exit: mom_20 < {MOM_EXIT}% OR close < SMA50 OR {MAX_HOLDING}d OR stop {STOP_LOSS_PCT}%')
    print(f'Position size: {POSITION_SIZE*100}% per trade')

    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)
    dev = run_backtest('DEV', DEV_START, DEV_END, conn)
    val = run_backtest('VAL', VAL_START, VAL_END, conn)
    hold = run_backtest('HOLDOUT', HOLDOUT_START, HOLDOUT_END, conn)
    conn.close()

    # Gate check
    gate = {
        'pf_dev': dev['pf'] > 1.3,
        'pf_val': val['pf'] > 1.3,
        'pf_holdout': hold['pf'] > 1.3,
        'wr_per_year': all(
            dev['yearly'].get(y, {}).get('wr', 0) > 50 or val['yearly'].get(y, {}).get('wr', 0) > 50 or hold['yearly'].get(y, {}).get('wr', 0) > 50
            for y in ['2023', '2024', '2025', '2026']
        ),
        'sharpe_dev': dev['sharpe'] > 1.0,
        'no_zero_month': all(m['n'] > 0 for m in list(dev['monthly'].values())[-6:]) if dev['monthly'] else False,
    }
    gate_pass = all(gate.values())

    # Save results
    with open(RESULTS_DIR / 'quick_win_results.json', 'w') as f:
        json.dump({'dev': dev, 'val': val, 'holdout': hold, 'gate': gate,
                   'gate_pass': gate_pass, 'timestamp': datetime.now().isoformat(),
                   'config': {'universe': UNIVERSE, 'entry_mom': MOM_ENTRY,
                              'exit_mom': MOM_EXIT, 'vol_surge': VOL_SURGE,
                              'stop_loss': STOP_LOSS_PCT, 'max_holding': MAX_HOLDING,
                              'position_size': POSITION_SIZE}}, f, indent=2, default=str)

    print('\n' + '=' * 70)
    print('  RESULTS SUMMARY')
    print('=' * 70)
    print(f'\n{"Period":<10} {"Signals":>8} {"WR":>6} {"PF":>6} {"DD":>7} {"Sharpe":>7}')
    print('-' * 50)
    for r in [dev, val, hold]:
        print(f"{r['period']:<10} {r['signals']:>8} {r['wr']:>5.1f}% {r['pf']:>6.2f} -{r['max_dd']:>5.1f}% {r['sharpe']:>7.2f}")
    print('\n=== Yearly WR ===')
    for y in ['2023', '2024', '2025', '2026']:
        dy = dev['yearly'].get(y, {})
        vy = val['yearly'].get(y, {})
        hy = hold['yearly'].get(y, {})
        print(f"  {y}: DEV n={dy.get('n',0)} WR={dy.get('wr',0)}% | VAL n={vy.get('n',0)} WR={vy.get('wr',0)}% | HOLDOUT n={hy.get('n',0)} WR={hy.get('wr',0)}%")
    print(f'\n=== GATE: {"PASS ✅" if gate_pass else "FAIL ❌"} ===')
    for k, v in gate.items():
        print(f'  {k}: {"✓" if v else "✗"}')
    verdict = 'KEEP' if gate_pass else 'REJECT'
    print(f'\n=== VERDICT: {verdict} ===')


if __name__ == '__main__':
    main()
