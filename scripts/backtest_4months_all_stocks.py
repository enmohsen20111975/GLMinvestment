#!/usr/bin/env python3
"""
Comprehensive 4-Month Backtest — ALL EGX Stocks
================================================
Owner directive: "لازم كل الأسهم وعلى الأقل 4 شهور"

This script runs the V40.2 prediction engine on ALL EGX stocks over the
last 4 months (May-Sep 2026), using real price history from price_history.db.

It generates predictions for each stock on each trading day, then evaluates:
  - Win Rate (WR)
  - Profit Factor (PF)
  - Average Return
  - Max Drawdown
  - Per-stock performance
  - Per-month performance
  - Signal distribution (BUY/SELL/HOLD)

Uses canonical indicators from analyzers/indicators/ (Rule 54).
Uses canonical R:R from utils/risk_reward.py.
Uses canonical WR/PF from utils/backtest_stats.py.
"""
import sys
import os
import sqlite3
import json
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

# Canonical imports (Rule 54)
from analyzers.indicators import calc_atr, calc_rsi, calc_srsi, sma, ema, macd
from utils.risk_reward import compute_risk_reward
from utils.backtest_stats import compute_win_rate, compute_profit_factor


def load_all_egx_tickers():
    """Load ALL EGX tickers from price_history.db."""
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    cur = conn.cursor()
    # Get tickers that have data in the last 4 months
    cur.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date >= '2026-05-01'
        ORDER BY ticker
    """)
    tickers = [r[0] for r in cur.fetchall()]
    conn.close()
    return tickers


def load_price_history(ticker, start_date='2026-01-01'):
    """Load price history for a ticker from start_date."""
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = ? AND date >= ?
        ORDER BY date ASC
    """, (ticker, start_date))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def generate_signal(closes, highs, lows, volumes):
    """
    Generate a trading signal using canonical indicators.

    PRED-ENGINE-AUDIT fixes (2026-10-05):
    - Signal logic: evidence-count based (not just score-based)
      * STRONG_BUY requires 4+ bullish conditions + positive trend + volume surge
      * BUY requires 3+ bullish conditions + positive trend
      * SELL requires 3+ bearish conditions + negative trend
      * STRONG_SELL requires 4+ bearish conditions + distribution volume
    - Entry price: BUY = prev_low + 0.5% buffer (buy on dip)
                  SELL = prev_high - 0.5% buffer (sell on rally)
    - Geometry: BUY-style (stop < entry < target) / SELL-style (target < entry < stop)
    - Liquidity gate: avg_turnover_20d ≥ 200K EGP (skip low-liquidity)
    """
    if len(closes) < 50:
        return None

    # Canonical indicators (Rule 54)
    atr = calc_atr(highs, lows, closes, 14)
    rsi = calc_rsi(closes, 14)
    s50 = sma(closes, 50)
    s200 = sma(closes, 200) if len(closes) >= 200 else None
    m = macd(closes)
    srsi = calc_srsi(closes)

    if atr is None or rsi is None or s50 is None or atr <= 0:
        return None

    price = closes[-1]
    prev_low = lows[-2] if len(lows) >= 2 else price
    prev_high = highs[-2] if len(highs) >= 2 else price
    prev_close = closes[-2] if len(closes) >= 2 else price

    # ── Liquidity gate (skip low-liquidity stocks) ──────────────────────
    if volumes and len(volumes) >= 20:
        avg_vol_20 = sum(volumes[-20:]) / 20
        avg_turnover_20 = avg_vol_20 * price  # rough turnover estimate
        if avg_turnover_20 < 200_000:  # 200K EGP minimum liquidity
            return None
    else:
        return None

    # ── Evidence-count based signal logic (not pure score) ──────────────
    bullish_evidence = 0
    bearish_evidence = 0
    score = 50  # neutral baseline

    # Trend: price vs SMA50
    if price > s50:
        score += 10
        bullish_evidence += 1
    else:
        score -= 10
        bearish_evidence += 1

    # SMA200 (if available)
    if s200 is not None:
        if price > s200:
            score += 10
            bullish_evidence += 1
        else:
            score -= 10
            bearish_evidence += 1

    # RSI: oversold = buy signal, overbought = sell signal
    if rsi < 30:
        score += 15  # oversold → bullish
        bullish_evidence += 1
    elif rsi > 70:
        score -= 15  # overbought → bearish
        bearish_evidence += 1
    elif 40 <= rsi <= 50:
        score += 5  # sweet spot
        bullish_evidence += 1
    elif rsi > 50 and rsi <= 60:
        # neutral-bullish range — slight bearish lean (momentum cooling)
        bearish_evidence += 1

    # MACD: bullish crossover
    if m and m['histogram'] > 0:
        score += 10
        bullish_evidence += 1
    elif m and m['histogram'] < 0:
        score -= 10
        bearish_evidence += 1

    # SRSI: %K above %D = bullish
    if srsi and srsi['k'] > srsi['d']:
        score += 5
        bullish_evidence += 1
    elif srsi and srsi['k'] < srsi['d']:
        score -= 5
        bearish_evidence += 1

    # Volume surge (bullish if rising, bearish if falling on high vol)
    vol_surge = False
    if volumes and len(volumes) >= 20:
        avg_vol_20 = sum(volumes[-20:]) / 20
        if avg_vol_20 > 0 and volumes[-1] > avg_vol_20 * 1.5:
            score += 10
            vol_surge = True
            # Volume surge alone is neutral — only counts as evidence
            # when combined with price direction
            if price > prev_close:
                bullish_evidence += 1
            elif price < prev_close:
                bearish_evidence += 1

    # ── Signal classification (evidence-count based + score) ────────────
    # STRONG_BUY: 4+ bullish + positive trend (price > SMA50) + volume surge
    # BUY:        3+ bullish + positive trend
    # HOLD:       1-2 bullish OR mixed signals (no clear edge)
    # SELL:        3+ bearish + negative trend (price < SMA50)
    # STRONG_SELL: 4+ bearish + negative trend + volume surge (distribution)
    above_trend = price > s50
    below_trend = price < s50

    if bullish_evidence >= 4 and above_trend and vol_surge and score >= 65:
        signal = 'STRONG_BUY'
    elif bullish_evidence >= 3 and above_trend and score >= 55:
        signal = 'BUY'
    elif bearish_evidence >= 4 and below_trend and vol_surge and score <= 35:
        signal = 'STRONG_SELL'
    elif bearish_evidence >= 3 and below_trend and score <= 45:
        signal = 'SELL'
    else:
        signal = 'HOLD'

    # ── Entry / Stop / Target (signal-direction aware) ──────────────────
    # BUY-style:  entry = prev_low + 0.5% buffer (buy on dip)
    #             stop  = entry - 1.5×ATR (below entry)
    #             target = entry + 2.5×ATR (above entry)
    # SELL-style: entry = prev_high - 0.5% buffer (sell on rally)
    #             stop  = entry + 1.5×ATR (above entry)
    #             target = entry - 2.5×ATR (below entry)
    is_sell = signal in ('SELL', 'STRONG_SELL')

    if is_sell:
        entry_candidate = prev_high * 0.995  # 0.5% below prev_high
        # Only use this if not too far from current close (< 3% above)
        if price > 0 and entry_candidate <= price * 1.03 and entry_candidate > 0:
            entry = entry_candidate
        else:
            entry = price  # fallback to current close
        stop = entry + (atr * 1.5)   # ABOVE entry (SELL-style)
        target = entry - (atr * 2.5)  # BELOW entry (SELL-style)

        # Clamp stop to [3%, 9%] above entry
        stop_pct = abs((stop - entry) / entry * 100) if entry > 0 else 0
        if stop_pct < 3:
            stop = entry * 1.03
        elif stop_pct > 9:
            stop = entry * 1.09
    else:
        entry_candidate = prev_low * 1.005  # 0.5% above prev_low
        # Only use this if not too far below current close (< 3% below)
        if price > 0 and entry_candidate >= price * 0.97 and entry_candidate > 0:
            entry = entry_candidate
        else:
            entry = price  # fallback to current close
        stop = entry - (atr * 1.5)   # BELOW entry (BUY-style)
        target = entry + (atr * 2.5)  # ABOVE entry (BUY-style)

        # Clamp stop to [3%, 9%] below entry
        stop_pct = abs((entry - stop) / entry * 100) if entry > 0 else 0
        if stop_pct < 3:
            stop = entry * 0.97
        elif stop_pct > 9:
            stop = entry * 0.91

    # Clamp target to ±30% (realistic max upside/downside per trade)
    target_pct = abs((target - entry) / entry * 100) if entry > 0 else 0
    if target_pct > 30:
        if is_sell:
            target = entry * 0.70  # max -30% downside
        else:
            target = entry * 1.30  # max +30% upside

    # R:R
    rr = compute_risk_reward(entry, target, stop, fallback=0.0)

    return {
        'ticker': None,  # set by caller
        'date': None,  # set by caller
        'signal': signal,
        'score': score,
        'entry': round(entry, 4),
        'stop': round(stop, 4),
        'target': round(target, 4),
        'rr': rr,
        'rsi': rsi,
        'atr': atr,
        'sma50': s50,
        'sma200': s200,
        'macd_hist': m['histogram'] if m else None,
        'srsi_k': srsi['k'] if srsi else None,
        'srsi_d': srsi['d'] if srsi else None,
        'bullish_evidence': bullish_evidence,
        'bearish_evidence': bearish_evidence,
    }


def evaluate_prediction(pred, future_closes):
    """
    Evaluate a prediction against future price data.

    PRED-ENGINE-AUDIT fix (2026-10-05): apply signal direction.
    - BUY/STRONG_BUY: target is ABOVE entry, stop is BELOW entry.
      Return = ((close - entry) / entry) × 100  (long-side)
    - SELL/STRONG_SELL: target is BELOW entry, stop is ABOVE entry.
      Return = ((entry - close) / entry) × 100  (short-side, INVERTED)
    - HOLD: skip (no trade — should not be evaluated)
    """
    if not future_closes or len(future_closes) == 0:
        return None

    entry = pred['entry']
    stop = pred['stop']
    target = pred['target']
    signal = pred['signal']

    # HOLD signals should not generate trades — skip them entirely
    if signal == 'HOLD':
        return None

    is_sell = signal in ('SELL', 'STRONG_SELL')

    # Simulate: check if target or stop hit first
    for i, close in enumerate(future_closes):
        if is_sell:
            # SELL-style: target BELOW entry, stop ABOVE entry
            if close <= target:
                # Target hit (price dropped to target) → WIN for short
                ret_pct = ((entry - close) / entry) * 100  # INVERTED return
                return {
                    'ticker': pred['ticker'],
                    'date': pred['date'],
                    'signal': signal,
                    'entry': entry,
                    'exit': close,
                    'exit_date': f'day+{i+1}',
                    'return': round(ret_pct, 2),
                    'is_win': 1,
                    'exit_reason': 'target_hit',
                    'holding_days': i + 1,
                }
            if close >= stop:
                # Stop hit (price rose to stop) → LOSS for short
                ret_pct = ((entry - close) / entry) * 100  # INVERTED return
                return {
                    'ticker': pred['ticker'],
                    'date': pred['date'],
                    'signal': signal,
                    'entry': entry,
                    'exit': close,
                    'exit_date': f'day+{i+1}',
                    'return': round(ret_pct, 2),
                    'is_win': 0,
                    'exit_reason': 'stop_hit',
                    'holding_days': i + 1,
                }
        else:
            # BUY-style: target ABOVE entry, stop BELOW entry
            if close >= target:
                # Target hit (price rose to target) → WIN for long
                ret_pct = ((close - entry) / entry) * 100
                return {
                    'ticker': pred['ticker'],
                    'date': pred['date'],
                    'signal': signal,
                    'entry': entry,
                    'exit': close,
                    'exit_date': f'day+{i+1}',
                    'return': round(ret_pct, 2),
                    'is_win': 1,
                    'exit_reason': 'target_hit',
                    'holding_days': i + 1,
                }
            if close <= stop:
                # Stop hit (price dropped to stop) → LOSS for long
                ret_pct = ((close - entry) / entry) * 100
                return {
                    'ticker': pred['ticker'],
                    'date': pred['date'],
                    'signal': signal,
                    'entry': entry,
                    'exit': close,
                    'exit_date': f'day+{i+1}',
                    'return': round(ret_pct, 2),
                    'is_win': 0,
                    'exit_reason': 'stop_hit',
                    'holding_days': i + 1,
                }

    # Neither hit — use last close
    last_close = future_closes[-1]
    if is_sell:
        ret_pct = ((entry - last_close) / entry) * 100  # INVERTED
    else:
        ret_pct = ((last_close - entry) / entry) * 100
    return {
        'ticker': pred['ticker'],
        'date': pred['date'],
        'signal': signal,
        'entry': entry,
        'exit': last_close,
        'exit_date': f'day+{len(future_closes)}',
        'return': round(ret_pct, 2),
        'is_win': 1 if ret_pct > 0 else 0,
        'exit_reason': 'max_holding',
        'holding_days': len(future_closes),
    }


def run_backtest():
    print('=' * 70)
    print('🧪 Comprehensive 4-Month Backtest — ALL EGX Stocks')
    print('Owner directive: "لازم كل الأسهم وعلى الأقل 4 شهور"')
    print('=' * 70)

    # Load tickers
    tickers = load_all_egx_tickers()
    print(f'\n📊 Loaded {len(tickers)} tickers with price data since May 2026')

    # Backtest parameters
    start_date = '2026-05-01'
    end_date = '2026-09-03'
    max_holding_days = 30  # max holding period
    lookback_days = 60  # indicator lookback

    all_predictions = []
    all_results = []
    per_ticker_stats = defaultdict(lambda: {'trades': 0, 'wins': 0, 'returns': []})
    per_month_stats = defaultdict(lambda: {'trades': 0, 'wins': 0, 'returns': []})
    signal_dist = Counter()

    # PRED-ENGINE-AUDIT fix #3: per-ticker circuit breaker
    # After 2 consecutive losing trades on the same ticker → SKIP next 5 trading days.
    # This prevents the GTHE-pattern (5 STRONG_BUY losses in a row).
    ticker_recent_returns = defaultdict(list)  # ticker → list of recent returns (chronological)
    CIRCUIT_BREAKER_LOSSES = 2  # trigger threshold
    CIRCUIT_BREAKER_COOLDOWN_DAYS = 5  # skip duration
    ticker_cooldown_until = {}  # ticker → date until which to skip (inclusive)

    total_tickers = len(tickers)
    processed = 0
    errors = 0

    for ticker in tickers:
        try:
            # Load price history from Jan 2026 (need lookback for indicators)
            history = load_price_history(ticker, '2026-01-01')
            if len(history) < lookback_days + 10:
                continue

            # Extract arrays
            dates = [r['date'] for r in history]
            closes = [float(r['close_price']) for r in history if r['close_price']]
            highs = [float(r['high_price']) for r in history if r['high_price']]
            lows = [float(r['low_price']) for r in history if r['low_price']]
            volumes = [float(r['volume']) if r['volume'] else 0 for r in history]

            if len(closes) < lookback_days + 10:
                continue

            # Generate predictions for each day in the 4-month window
            # Start from lookback_days to have enough data for indicators
            start_idx = max(lookback_days, 1)
            for day_idx in range(start_idx, len(closes) - 1):
                pred_date = dates[day_idx] if day_idx < len(dates) else None
                if pred_date is None or pred_date < start_date or pred_date > end_date:
                    continue

                # ── Circuit breaker check ────────────────────────────────
                # If ticker is in cooldown, skip signal generation for this day
                cooldown_until = ticker_cooldown_until.get(ticker)
                if cooldown_until and pred_date <= cooldown_until:
                    continue

                # Generate signal using data up to day_idx
                signal = generate_signal(
                    closes[:day_idx + 1],
                    highs[:day_idx + 1],
                    lows[:day_idx + 1],
                    volumes[:day_idx + 1]
                )

                if signal is None:
                    continue

                # HOLD signals don't generate trades — skip (already handled in evaluate_prediction)
                if signal['signal'] == 'HOLD':
                    continue

                signal['ticker'] = ticker
                signal['date'] = pred_date

                # Evaluate: look at next N days
                future_closes = closes[day_idx + 1: day_idx + 1 + max_holding_days]
                if len(future_closes) == 0:
                    continue

                result = evaluate_prediction(signal, future_closes)
                if result is None:
                    continue

                # Rule 7: HARD cap — skip toxic returns
                if abs(result['return']) > 50:
                    continue

                # ── Circuit breaker: track return + check for trigger ────
                ticker_recent_returns[ticker].append(result['return'])
                # Keep only last 3 returns
                if len(ticker_recent_returns[ticker]) > 3:
                    ticker_recent_returns[ticker] = ticker_recent_returns[ticker][-3:]

                # Check if last CIRCUIT_BREAKER_LOSSES trades were all losses
                recent = ticker_recent_returns[ticker][-CIRCUIT_BREAKER_LOSSES:]
                if (len(recent) == CIRCUIT_BREAKER_LOSSES
                        and all(r < 0 for r in recent)):
                    # Activate cooldown — find the date CIRCUIT_BREAKER_COOLDOWN_DAYS ahead
                    cooldown_date_idx = day_idx + CIRCUIT_BREAKER_COOLDOWN_DAYS
                    if cooldown_date_idx < len(dates):
                        ticker_cooldown_until[ticker] = dates[cooldown_date_idx]

                all_predictions.append(signal)
                all_results.append(result)
                signal_dist[signal['signal']] += 1

                # Per-ticker stats
                per_ticker_stats[ticker]['trades'] += 1
                if result['is_win']:
                    per_ticker_stats[ticker]['wins'] += 1
                per_ticker_stats[ticker]['returns'].append(result['return'])

                # Per-month stats
                month = pred_date[:7]
                per_month_stats[month]['trades'] += 1
                if result['is_win']:
                    per_month_stats[month]['wins'] += 1
                per_month_stats[month]['returns'].append(result['return'])

            processed += 1
            if processed % 100 == 0:
                print(f'  Processed {processed}/{total_tickers} tickers... ({len(all_results)} trades so far)', flush=True)

        except Exception as e:
            errors += 1
            continue

    print(f'\n✅ Processed: {processed}/{total_tickers} tickers ({errors} errors)')
    print(f'📊 Total predictions: {len(all_predictions)}')
    print(f'📊 Total evaluated trades: {len(all_results)}')

    if len(all_results) == 0:
        print('❌ No trades to evaluate!')
        return

    # ─── Compute canonical stats ───────────────────────────────────
    # FIX: backtest_stats expects 'actual_return' + 'is_correct', but our results use 'return' + 'is_win'
    # Map our fields to canonical format
    canonical_results = [{
        'ticker': r['ticker'],
        'actual_return': r['return'],
        'is_correct': r['is_win'],
        'master_score': 50,  # neutral
    } for r in all_results]

    wr = compute_win_rate(canonical_results)
    pf = compute_profit_factor(canonical_results)

    # Additional stats
    avg_return = sum(r['return'] for r in all_results) / len(all_results)
    wins = [r for r in all_results if r['is_win'] == 1]
    losses = [r for r in all_results if r['is_win'] == 0]
    avg_win = sum(r['return'] for r in wins) / len(wins) if wins else 0
    avg_loss = sum(r['return'] for r in losses) / len(losses) if losses else 0
    max_return = max(r['return'] for r in all_results)
    min_return = min(r['return'] for r in all_results)
    avg_holding = sum(r['holding_days'] for r in all_results) / len(all_results)

    # ─── Report ───────────────────────────────────────────────────
    print('\n' + '=' * 70)
    print('📊 BACKTEST RESULTS — 4 MONTHS (May-Sep 2026)')
    print('=' * 70)
    print(f'Tickers processed: {processed}')
    print(f'Total trades: {len(all_results)}')
    print(f'Predictions: BUY={signal_dist.get("BUY", 0)} STRONG_BUY={signal_dist.get("STRONG_BUY", 0)} '
          f'HOLD={signal_dist.get("HOLD", 0)} SELL={signal_dist.get("SELL", 0)} STRONG_SELL={signal_dist.get("STRONG_SELL", 0)}')
    print()
    print(f'📊 Win Rate: {wr}%')
    print(f'📊 Profit Factor: {pf}')
    print(f'📊 Avg Return: {avg_return:.2f}%')
    print(f'📊 Avg Win: +{avg_win:.2f}%')
    print(f'📊 Avg Loss: {avg_loss:.2f}%')
    print(f'📊 Max Return: +{max_return:.2f}%')
    print(f'📊 Min Return: {min_return:.2f}%')
    print(f'📊 Avg Holding: {avg_holding:.1f} days')
    print()

    # Per-month breakdown
    print('── Per-Month Performance ──')
    for month in sorted(per_month_stats.keys()):
        s = per_month_stats[month]
        m_wr = (s['wins'] / s['trades'] * 100) if s['trades'] > 0 else 0
        m_avg = sum(s['returns']) / len(s['returns']) if s['returns'] else 0
        print(f'  {month}: {s["trades"]} trades | WR={m_wr:.1f}% | Avg={m_avg:.2f}%')

    # Per-signal breakdown
    print('\n── Per-Signal Performance ──')
    for sig in ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL']:
        sig_trades = [r for r in all_results if r['signal'] == sig]
        if not sig_trades:
            continue
        sig_wins = sum(1 for r in sig_trades if r['is_win'])
        sig_wr = (sig_wins / len(sig_trades) * 100) if sig_trades else 0
        sig_avg = sum(r['return'] for r in sig_trades) / len(sig_trades)
        print(f'  {sig}: {len(sig_trades)} trades | WR={sig_wr:.1f}% | Avg={sig_avg:.2f}%')

    # Top 10 winners + losers
    print('\n── Top 10 Winners ──')
    sorted_results = sorted(all_results, key=lambda x: x['return'], reverse=True)
    for r in sorted_results[:10]:
        print(f'  {r["ticker"]} @ {r["date"]} → {r["return"]:+.2f}% ({r["signal"]}, {r["exit_reason"]}, {r["holding_days"]}d)')

    print('\n── Top 10 Losers ──')
    for r in sorted_results[-10:]:
        print(f'  {r["ticker"]} @ {r["date"]} → {r["return"]:+.2f}% ({r["signal"]}, {r["exit_reason"]}, {r["holding_days"]}d)')

    # Unique tickers traded
    unique_tickers = set(r['ticker'] for r in all_results)
    print(f'\n── Unique tickers traded: {len(unique_tickers)} ──')

    # R:R stats
    rrs = [p['rr'] for p in all_predictions if p['rr'] and p['rr'] > 0]
    if rrs:
        avg_rr = sum(rrs) / len(rrs)
        print(f'── Avg R:R: {avg_rr:.2f} ──')

    print('\n' + '=' * 70)
    if wr >= 50 and pf >= 1.5:
        print('✅ BACKTEST PASSED — System is viable for production')
    elif wr >= 45 and pf >= 1.0:
        print('⚠️ BACKTEST MARGINAL — Consider tuning before production')
    else:
        print('❌ BACKTEST FAILED — System needs significant tuning')
    print('=' * 70)

    # Save results
    output_file = PROJECT_ROOT / 'scripts' / 'output' / 'backtest_4months_all_stocks.json'
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump({
            'summary': {
                'tickers_processed': processed,
                'total_trades': len(all_results),
                'win_rate': wr,
                'profit_factor': pf,
                'avg_return': avg_return,
                'avg_win': avg_win,
                'avg_loss': avg_loss,
                'avg_holding_days': avg_holding,
                'signal_distribution': dict(signal_dist),
                'unique_tickers': len(unique_tickers),
            },
            'per_month': {k: {'trades': v['trades'], 'wins': v['wins'],
                             'avg_return': sum(v['returns'])/len(v['returns']) if v['returns'] else 0}
                          for k, v in per_month_stats.items()},
            'top_10_winners': [{'ticker': r['ticker'], 'date': r['date'], 'return': r['return'],
                               'signal': r['signal']} for r in sorted_results[:10]],
            'top_10_losers': [{'ticker': r['ticker'], 'date': r['date'], 'return': r['return'],
                              'signal': r['signal']} for r in sorted_results[-10:]],
        }, f, indent=2, ensure_ascii=False)
    print(f'\n📁 Results saved to: {output_file}')


if __name__ == '__main__':
    run_backtest()
