#!/usr/bin/env python3
"""
V40.2 Historical Prediction Generator (Expanded + Strict)
=========================================================
Generates V40.2-based predictions for historical dates, stored in predictions.db.
Processes ONE ticker at a time to avoid OOM.

V40.2 changes vs V40.1:
  - Expanded range: 2026-01-01 → 2026-06-10 (was 2026-05-15 → 2026-07-15)
  - Strict kill-filter mode (no market-open relaxation)
  - Real EGX30ETF benchmark (loaded lazily by the engine)
  - Tightened entry conditions (real benchmark + mapping fix + absorption 1.5)
  - partial_exit_at_rr = 1.5 (let winners run further)

Flow:
  for each ticker:
    load price data (1 ticker in memory)
    for each scan_date:
      run V40.2 analysis (build_institutional_decision)
      if STRONG_BUY/INSTITUTIONAL_BUY: run simulate_trade → collect outcome
    free price data
  group signals by scan_date → sort → top 5 → morning bell = top 1 → store
"""
import sys
import os
import json
import gc
import sqlite3
from collections import defaultdict, Counter

sys.path.insert(0, '/home/z/my-project/vps-service')
os.chdir('/home/z/my-project')
os.environ['BYPASS_PRED_CAP'] = '1'

from engines.v38_backtest_engine import V38BacktestEngine, Trade, simulate_trade, calc_atr
from analyzers.liquidity_filter import set_strict_kill_filters
from analyzers.prediction_tracker import PredictionTracker

PREDICTIONS_DB = '/home/z/my-project/db/predictions.db'
PRICE_HISTORY_DB = '/home/z/my-project/db/price_history.db'

START_DATE = '2026-01-01'
END_DATE = '2026-06-10'
SCAN_INTERVAL = 3
MAX_PICKS_PER_DAY = 5
MIN_TICKER_DAYS = 200


def count_evidence(proofs):
    return sum(1 for v in proofs.values() if '✅' in str(v))


def compute_r_multiple(entry, target, stop):
    if entry > 0 and stop < entry:
        return (target - entry) / (entry - stop)
    return 0.0


def get_scan_dates(start_date, end_date, scan_interval):
    conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=30.0)
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT date FROM price_history WHERE date >= ? AND date <= ? ORDER BY date ASC",
                (start_date, end_date))
    dates = [row[0] for row in cur.fetchall()]
    conn.close()
    return dates[::scan_interval]


def get_tickers(min_days=MIN_TICKER_DAYS):
    conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=30.0)
    cur = conn.cursor()
    cur.execute("SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(*) >= ? ORDER BY ticker",
                (min_days,))
    tickers = [row[0] for row in cur.fetchall()]
    conn.close()
    return tickers


def delete_old_v40_predictions():
    """Delete previous V40 historical predictions to avoid duplicates."""
    conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
    cur = conn.cursor()
    cur.execute("DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%'")
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    print(f"🧹 Deleted {deleted} old V40 historical predictions", flush=True)


def run_generator():
    print("=" * 80)
    print("  V40.2 Historical Prediction Generator (Expanded + Strict)")
    print(f"  Period: {START_DATE} → {END_DATE} | Scan every {SCAN_INTERVAL} days")
    print(f"  Max picks/day: {MAX_PICKS_PER_DAY} | Morning bell: top 1")
    print(f"  Strict kill-filters: ON | Real EGX30ETF benchmark: ON")
    print("=" * 80, flush=True)

    # V40.2: enable strict kill-filter mode for the whole run
    set_strict_kill_filters(True)

    delete_old_v40_predictions()

    scan_dates = get_scan_dates(START_DATE, END_DATE, SCAN_INTERVAL)
    tickers = get_tickers()
    print(f"📊 Scan dates: {len(scan_dates)} | Tickers: {len(tickers)}", flush=True)
    print(f"📅 Scan dates: {scan_dates}", flush=True)

    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)
    engine._load_fundamentals()
    engine._load_benchmark()  # V40.2: load EGX30ETF benchmark explicitly

    signals_by_date = defaultdict(list)
    total_tickers = len(tickers)
    processed = 0

    for ticker in tickers:
        processed += 1
        if processed % 50 == 0:
            print(f"  ⏳ Processing {processed}/{total_tickers} tickers...", flush=True)

        dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < MIN_TICKER_DAYS:
            continue
        atrs = calc_atr(highs, lows, closes, 14)
        date_to_idx = {d: i for i, d in enumerate(dates)}

        for scan_date in scan_dates:
            day_idx = date_to_idx.get(scan_date)
            if day_idx is None or day_idx < 60:
                continue

            try:
                result = engine.analyze_single_day_v393(
                    ticker, dates, opens, highs, lows, closes, volumes, day_idx, 0.0,
                )
            except Exception:
                continue

            signal = result.get('signal', 'WAIT')
            if signal not in ('STRONG_BUY', 'INSTITUTIONAL_BUY'):
                continue

            entry = result['entry']
            target = result['target']
            stop = result['stop_loss']
            if stop >= entry or entry <= 0:
                continue

            future_closes = closes[day_idx + 1:]
            future_dates = dates[day_idx + 1:]
            future_atrs = atrs[day_idx + 1:]
            if len(future_closes) < 5:
                continue

            trade = Trade(
                ticker=ticker, entry_date=scan_date, entry_price=entry,
                target_price=target, stop_loss=stop, score=result['score'],
                signal=signal, proofs=result['proofs'],
            )
            trade = simulate_trade(trade, future_closes, future_dates, 30, future_atrs)

            evidence = count_evidence(result['proofs'])
            r_mult = compute_r_multiple(entry, target, stop)

            signals_by_date[scan_date].append({
                'ticker': ticker,
                'signal': signal,
                'entry': entry,
                'target': target,
                'target_2': result.get('target_2', 0),
                'stop': stop,
                'tech_score': result['score'],
                'evidence': evidence,
                'r_multiple': r_mult,
                'atr': result.get('atr', 0),
                'exit_price': trade.exit_price,
                'exit_date': trade.exit_date,
                'exit_reason': trade.exit_reason,
                'return_pct': trade.return_pct,
                'is_win': trade.is_win,
                'pnl_pct': trade.pnl_pct,
                'r_multiple_actual': trade.r_multiple,
            })

        del dates, opens, highs, lows, closes, volumes, atrs, date_to_idx
        if processed % 100 == 0:
            gc.collect()

    print(f"\n✅ Processed {total_tickers} tickers. Signals found on {len(signals_by_date)} dates.", flush=True)

    # Store: sort each date's signals, take top 5, morning bell = top 1
    tracker = PredictionTracker(PREDICTIONS_DB)
    total_generated = 0
    total_morning_bells = 0
    daily_summary = []
    all_stored = []

    for scan_date in sorted(signals_by_date.keys()):
        day_signals = signals_by_date[scan_date]
        # Sort: evidence DESC → R-multiple DESC → tech_score DESC
        day_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
        picks = day_signals[:MAX_PICKS_PER_DAY]

        for rank, sig in enumerate(picks):
            sig['morning_bell'] = 1 if rank == 0 else 0

        for sig in picks:
            hit_target = 1 if sig['exit_reason'] == 'hit_target' else 0
            hit_stop = 1 if sig['exit_reason'] == 'hit_stop' else 0
            is_correct = 1 if sig['is_win'] else 0
            try:
                pred_id = tracker.record_prediction(
                    ticker=sig['ticker'], signal=sig['signal'],
                    entry_price=sig['entry'], target_price=sig['target'],
                    stop_loss=sig['stop'], master_score=sig['tech_score'],
                    technical_score=sig['tech_score'], persona='balanced',
                    atr_at_entry=sig['atr'], target_price_2=sig['target_2'],
                    prediction_date=scan_date, evidence_count=sig['evidence'],
                    morning_bell=sig['morning_bell'],
                    kill_filter_result=f"V40 evidence={sig['evidence']}/6 R={sig['r_multiple']:.2f}",
                )
                if pred_id:
                    tracker.set_verified_outcome(
                        prediction_id=pred_id, outcome_date=sig['exit_date'],
                        exit_price=sig['exit_price'], actual_return=sig['return_pct'],
                        hit_target=hit_target, hit_stop=hit_stop,
                        is_correct=is_correct, holding_days=sig['holding_days'] if 'holding_days' in sig else 0,
                        exit_reason=sig['exit_reason'],
                    )
                    total_generated += 1
                    if sig['morning_bell']:
                        total_morning_bells += 1
                    all_stored.append(sig)
            except Exception as e:
                print(f"  ⚠️ Store error {sig['ticker']}: {e}", flush=True)

        mb = picks[0] if picks else None
        wins = sum(1 for p in picks if p['is_win'])
        daily_summary.append({
            'date': scan_date, 'picks': len(picks), 'wins': wins,
            'morning_bell': mb['ticker'] if mb else '',
            'mb_win': mb['is_win'] if mb else False,
            'avg_evidence': round(sum(p['evidence'] for p in picks) / len(picks), 1) if picks else 0,
        })
        print(f"  📅 {scan_date}: {len(picks)} picks ({wins}W/{len(picks) - wins}L) | "
              f"MB={mb['ticker'] if mb else '-'}({'✅' if mb and mb['is_win'] else '❌'}) | "
              f"avg_ev={daily_summary[-1]['avg_evidence']}", flush=True)

    # Compute PF from stored trades (using pnl_pct = equity impact with 1.5% risk)
    wins_pnl = [s['pnl_pct'] for s in all_stored if s['pnl_pct'] > 0]
    losses_pnl = [abs(s['pnl_pct']) for s in all_stored if s['pnl_pct'] <= 0]
    gross_profit = sum(wins_pnl)
    gross_loss = sum(losses_pnl)
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    total_wins = len(wins_pnl)
    total_picks = len(all_stored)
    overall_wr = total_wins / total_picks * 100 if total_picks else 0
    mb_wins = sum(1 for d in daily_summary if d['mb_win'])
    mb_wr = mb_wins / total_morning_bells * 100 if total_morning_bells else 0

    # Signal distribution
    sig_dist = Counter(s['signal'] for s in all_stored)
    ev_dist = Counter(s['evidence'] for s in all_stored)

    print("\n" + "=" * 80)
    print("  GENERATION COMPLETE")
    print("=" * 80)
    print(f"  Total predictions: {total_generated}")
    print(f"  Morning bells: {total_morning_bells} ({mb_wins} wins = {mb_wr:.1f}% WR)")
    print(f"  Overall win rate: {total_wins}/{total_picks} = {overall_wr:.1f}%")
    print(f"  Profit Factor (equity-impact): {pf:.3f}")
    print(f"  Gross profit: {gross_profit:.2f} | Gross loss: {gross_loss:.2f}")
    print(f"  Signal dist: {dict(sig_dist)}")
    print(f"  Evidence dist: {dict(sorted(ev_dist.items()))}")
    print(f"  Scan dates with picks: {len(daily_summary)}")

    summary = {
        'version': 'V40.2 (tightened entry + real benchmark + partial 1.5R)',
        'period': f'{START_DATE} → {END_DATE}',
        'scan_interval': SCAN_INTERVAL,
        'total_generated': total_generated,
        'total_morning_bells': total_morning_bells,
        'morning_bell_win_rate': round(mb_wr, 1),
        'overall_win_rate': round(overall_wr, 1),
        'profit_factor': round(pf, 3),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'signal_distribution': dict(sig_dist),
        'evidence_distribution': {str(k): v for k, v in sorted(ev_dist.items())},
        'scan_dates_with_picks': len(daily_summary),
        'daily': daily_summary,
    }
    summary_path = '/home/z/my-project/vps-service/backtest_results/v40_2_historical_generation_summary.json'
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Summary saved: {summary_path}")
    print(f"📊 Predictions in: {PREDICTIONS_DB}")


if __name__ == '__main__':
    run_generator()
