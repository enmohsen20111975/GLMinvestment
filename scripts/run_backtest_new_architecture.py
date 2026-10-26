#!/usr/bin/env python3
"""
PHASE 5 — Backtest on NEW architecture (Orchestrator → Executor → Risk Gate → Decision Log)
=========================================================================================
Runs the FULL new path on 4 months of historical EGX data.
NO look-ahead bias. NO master_analyzer direct calls.

Path tested:
  Orchestrator.create_plan() → Executor.execute_plan() → Risk Gate → Decision Log

Run: python3 scripts/run_backtest_new_architecture.py
"""
from __future__ import annotations
import sys, os, sqlite3, json, csv, statistics, warnings
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

# Config
WINDOW_START = '2026-06-25'
WINDOW_END = '2026-10-25'
COMMISSION_PCT = 0.1
SLIPPAGE_PCT = 0.05
POSITION_SIZE_PCT = 5.0
INITIAL_CAPITAL = 10000.0
MAX_HOLDING = 7
SAMPLE_TICKERS = 20

DB_PH = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = PROJECT_ROOT / 'backtest_results'

def get_week_key(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

def run_backtest():
    print("="*70)
    print(f"BACKTEST ON NEW ARCHITECTURE — EGX")
    print(f"Path: Orchestrator → Executor → Risk Gate → Decision Log")
    print(f"Window: {WINDOW_START} to {WINDOW_END}")
    print("="*70)

    # Get tickers
    c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
    cur = c.cursor()
    cur.execute(f"SELECT DISTINCT ticker FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 ORDER BY ticker LIMIT {SAMPLE_TICKERS}")
    tickers = [r[0] for r in cur.fetchall()]
    cur.execute(f"SELECT DISTINCT date FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date")
    all_dates = [r[0] for r in cur.fetchall()]
    c.close()
    print(f"Tickers: {len(tickers)} | Dates: {len(all_dates)}")

    # Import new architecture
    from core.orchestrator import create_plan
    from core.executor import execute_plan
    from core.risk_gate import apply_risk_gate
    from core.decision_log import log_decision

    trades = []
    capital = INITIAL_CAPITAL
    capital_curve = [(WINDOW_START, capital)]
    decisions_logged = 0

    for i, signal_date in enumerate(all_dates):
        if i < 60:
            continue
        if i % 20 == 0:
            print(f"  Progress: {i}/{len(all_dates)} dates, {len(trades)} trades, {decisions_logged} decisions logged")

        for ticker in tickers:
            # Get prices UP TO signal_date (NO look-ahead)
            c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
            cur = c.cursor()
            cur.execute(f"SELECT date, close_price, volume FROM price_history WHERE ticker=? AND market='EGX' AND date<=? AND close_price>0 ORDER BY date DESC LIMIT 60", (ticker, signal_date))
            rows = cur.fetchall()[::-1]
            c.close()

            if len(rows) < 50:
                continue

            prices = [r[1] for r in rows]
            volumes = [r[2] for r in rows if r[2]]
            if len(prices) < 50:
                continue

            # Step 1: Orchestrator creates plan
            plan = create_plan(ticker, 'EGX', 'fresh', 'NORMAL')
            if plan.decision_policy == 'no_trade':
                continue

            # Step 2: Executor executes plan
            try:
                exec_result = execute_plan(plan, prices=prices, volumes=volumes, ticker=ticker, market='EGX')
            except Exception:
                continue

            if not exec_result.complete:
                continue

            # Extract signal from engine_results
            engine_signal = 'HOLD'
            engine_score = 0.0
            risk_profile = {}

            # Try master_analyzer result first
            if 'master_analyzer' in exec_result.engine_results:
                ma_result = exec_result.engine_results['master_analyzer']
                engine_signal = ma_result.get('signal', 'HOLD')
                engine_score = ma_result.get('master_score', 0)
                risk_profile = ma_result.get('risk_profile', {})
            elif 'technical' in exec_result.engine_results:
                engine_signal = exec_result.engine_results['technical'].get('signal', 'HOLD')
                engine_score = exec_result.engine_results['technical'].get('master_score', 0)

            # Only trade on BUY signals
            if engine_signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'):
                # Still log the decision (audit trail)
                log_decision(
                    ticker=ticker, plan_id=plan.plan_id, market_state=plan.market_state,
                    selected_engines=plan.selected_engines, skipped_engines=plan.skipped_engines,
                    engine_results=exec_result.engine_results,
                    final_signal=engine_signal, master_score=engine_score,
                    risk_profile=risk_profile, code_version='7840eff',
                    config_version=plan.config_version,
                    warnings=exec_result.warnings, errors=exec_result.errors,
                )
                decisions_logged += 1
                continue

            # Step 3: Risk Gate
            entry = prices[-1]
            if isinstance(risk_profile, dict) and risk_profile:
                stop = risk_profile.get('stop_loss', entry * 0.95)
                target = risk_profile.get('target_price', entry * 1.10)
                rr = risk_profile.get('risk_reward_ratio', 2.0)
            else:
                stop = entry * 0.95
                target = entry * 1.10
                rr = 2.0

            final_signal, risk_warnings, final_pos_size = apply_risk_gate(
                signal=engine_signal,
                master_score=engine_score,
                risk_profile={'risk_reward_ratio': rr},
                data_quality='fresh',
                position_size_pct=POSITION_SIZE_PCT,
            )

            if final_signal == 'NO_TRADE':
                continue

            # Step 4: Decision Log
            eid = log_decision(
                ticker=ticker, plan_id=plan.plan_id, market_state=plan.market_state,
                selected_engines=plan.selected_engines, skipped_engines=plan.skipped_engines,
                engine_results=exec_result.engine_results,
                final_signal=final_signal, master_score=engine_score,
                risk_profile={'entry_price': entry, 'stop_loss': stop, 'target_price': target, 'position_size': final_pos_size},
                code_version='7840eff', config_version=plan.config_version,
                warnings=risk_warnings, errors=[],
            )
            decisions_logged += 1

            # Simulate trade (outcome — uses FUTURE data, which is OK for exit simulation)
            future_idx = all_dates.index(signal_date) if signal_date in all_dates else i
            future_dates = all_dates[future_idx+1:future_idx+1+MAX_HOLDING]

            c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
            cur = c.cursor()
            if future_dates:
                placeholders = ','.join('?' * len(future_dates))
                cur.execute(f"SELECT date, high_price, low_price, close_price FROM price_history WHERE ticker=? AND market='EGX' AND date IN ({placeholders}) ORDER BY date", (ticker, *future_dates))
                future_rows = cur.fetchall()
            else:
                future_rows = []
            c.close()

            if not future_rows:
                continue

            exit_price = None
            exit_reason = ''
            exit_date = ''

            for fr in future_rows:
                f_date, f_high, f_low, f_close = fr
                if f_low and stop and f_low <= stop:
                    exit_price = stop
                    exit_reason = 'STOP_LOSS'
                    exit_date = f_date
                    break
                if f_high and target and f_high >= target:
                    exit_price = target
                    exit_reason = 'TARGET_HIT'
                    exit_date = f_date
                    break
                exit_price = f_close
                exit_reason = 'HOLDING_EXPIRED'
                exit_date = f_date

            if not exit_price:
                continue

            gross_return = (exit_price - entry) / entry * 100
            costs = COMMISSION_PCT * 2 + SLIPPAGE_PCT * 2
            net_return = gross_return - costs
            position_value = capital * (final_pos_size / 100)
            pnl = position_value * (net_return / 100)
            capital += pnl

            trades.append({
                'signal_date': signal_date,
                'week': get_week_key(signal_date),
                'market': 'EGX',
                'ticker': ticker,
                'plan_id': plan.plan_id,
                'execution_id': eid,
                'orchestrator_state': plan.market_state,
                'selected_engines': ','.join(plan.selected_engines),
                'engine_signal': engine_signal,
                'final_signal': final_signal,
                'master_score': round(engine_score, 2),
                'entry_price': round(entry, 4),
                'stop_loss': round(stop, 4),
                'target_price': round(target, 4),
                'position_size_pct': final_pos_size,
                'exit_date': exit_date,
                'exit_price': round(exit_price, 4),
                'exit_reason': exit_reason,
                'gross_return_pct': round(gross_return, 4),
                'net_return_pct': round(net_return, 4),
                'pnl_egp': round(pnl, 2),
                'capital_after': round(capital, 2),
                'commission_pct': COMMISSION_PCT,
                'slippage_pct': SLIPPAGE_PCT,
                'risk_warnings': '; '.join(risk_warnings),
            })
            capital_curve.append((exit_date, capital))

    # === Results ===
    print(f"\n{'='*70}")
    print(f"BACKTEST RESULTS — NEW ARCHITECTURE — EGX")
    print(f"{'='*70}")
    print(f"Total decisions logged: {decisions_logged}")
    print(f"Total trades: {len(trades)}")

    if not trades:
        print("No trades generated.")
        # Still produce empty reports
        _write_empty_reports()
        return

    wins = [t for t in trades if t['net_return_pct'] > 0.5]
    losses = [t for t in trades if t['net_return_pct'] < -0.5]
    neutrals = [t for t in trades if -0.5 <= t['net_return_pct'] <= 0.5]

    wr = len(wins)/len(trades)*100 if trades else 0
    total_pnl = sum(t['pnl_egp'] for t in trades)
    total_profit = sum(t['pnl_egp'] for t in wins)
    total_loss = abs(sum(t['pnl_egp'] for t in losses))
    pf = total_profit / total_loss if total_loss > 0 else float('inf')

    print(f"Wins: {len(wins)} | Losses: {len(losses)} | Neutral: {len(neutrals)}")
    print(f"Win Rate: {wr:.1f}%")
    print(f"Total P&L: {total_pnl:+.2f} EGP")
    print(f"Profit Factor: {pf:.2f}" if pf != float('inf') else "Profit Factor: ∞")
    print(f"Net Return: {(capital-INITIAL_CAPITAL)/INITIAL_CAPITAL*100:+.2f}%")

    avg_win = statistics.mean([t['net_return_pct'] for t in wins]) if wins else 0
    avg_loss = statistics.mean([t['net_return_pct'] for t in losses]) if losses else 0
    print(f"Avg Win: {avg_win:+.2f}% | Avg Loss: {avg_loss:+.2f}%")

    # Max drawdown
    peak = INITIAL_CAPITAL
    max_dd = 0
    for _, cap in capital_curve:
        if cap > peak: peak = cap
        dd = (peak - cap) / peak * 100
        if dd > max_dd: max_dd = dd
    print(f"Max Drawdown: {max_dd:.2f}%")

    # Weekly results
    weekly = {}
    for t in trades:
        wk = t['week']
        if wk not in weekly: weekly[wk] = {'trades':0,'wins':0,'losses':0,'pnl':0}
        weekly[wk]['trades'] += 1
        if t['net_return_pct'] > 0.5: weekly[wk]['wins'] += 1
        elif t['net_return_pct'] < -0.5: weekly[wk]['losses'] += 1
        weekly[wk]['pnl'] += t['pnl_egp']

    print(f"\n{'='*70}")
    print("WEEKLY RESULTS")
    print(f"{'='*70}")
    print(f"{'Week':<12} {'Trades':>7} {'Wins':>5} {'Losses':>7} {'WR%':>6} {'P&L':>10}")
    print("-"*50)
    for wk in sorted(weekly.keys()):
        d = weekly[wk]
        wr_w = d['wins']/d['trades']*100 if d['trades'] else 0
        print(f"{wk:<12} {d['trades']:>7} {d['wins']:>5} {d['losses']:>7} {wr_w:>5.1f}% {d['pnl']:>+9.2f}")

    # Write outputs
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR / 'weekly_results', exist_ok=True)

    # Trade ledger
    with open(OUTPUT_DIR / 'trade_ledger_new_arch.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(trades[0].keys()))
        w.writeheader()
        for t in trades: w.writerow(t)

    # Market summary
    with open(OUTPUT_DIR / 'market_summary_new_arch.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['week','market','trades','wins','losses','wr_pct','pnl_egp','capital_end','decisions_logged'])
        cap = INITIAL_CAPITAL
        for wk in sorted(weekly.keys()):
            d = weekly[wk]
            cap += d['pnl']
            wr_w = d['wins']/d['trades']*100 if d['trades'] else 0
            w.writerow([wk, 'EGX', d['trades'], d['wins'], d['losses'], f'{wr_w:.1f}', f'{d["pnl"]:.2f}', f'{cap:.2f}', decisions_logged])

    # Weekly reports
    for wk, d in weekly.items():
        with open(OUTPUT_DIR / 'weekly_results' / f'{wk}_EGX_new_arch.md', 'w') as f:
            wr_w = d['wins']/d['trades']*100 if d['trades'] else 0
            f.write(f"# Week {wk} — EGX (New Architecture)\n\n")
            f.write(f"- Path: Orchestrator → Executor → Risk Gate → Decision Log\n")
            f.write(f"- Trades: {d['trades']}\n- Wins: {d['wins']}\n- Losses: {d['losses']}\n")
            f.write(f"- Win Rate: {wr_w:.1f}%\n- P&L: {d['pnl']:+.2f} EGP\n")
            f.write(f"- Decisions logged: {decisions_logged}\n")

    print(f"\nOutputs: backtest_results/")
    print(f"  trade_ledger_new_arch.csv ({len(trades)} trades)")
    print(f"  market_summary_new_arch.csv ({len(weekly)} weeks)")
    print(f"  weekly_results/ ({len(weekly)} files)")
    print(f"\nDecisions logged in decision_log.db: {decisions_logged}")

def _write_empty_reports():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_DIR / 'trade_ledger_new_arch.csv', 'w') as f:
        f.write('no trades generated\n')
    with open(OUTPUT_DIR / 'market_summary_new_arch.csv', 'w') as f:
        f.write('no trades generated\n')

if __name__ == '__main__':
    run_backtest()
