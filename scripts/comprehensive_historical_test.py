#!/usr/bin/env python3
"""
Comprehensive Historical Test (HISTORICAL-TEST-018)
====================================================
اختبار تاريخي شامل على الأسهم النشطة — يوسّع backtest_unified_pipeline
ليغطّي 50-100 سهم EGX نشط، مع تحليل تفصيلي:

  • per-ticker win_rate
  • per-layer contribution (أي layer يساهم أكثر في النجاح؟)
  • per-sector win_rate (أي قطاع أفضل؟)
  • per-regime win_rate (bull/bear/range)
  • best/worst tickers
  • signal distribution (BUY/HOLD/SELL)
  • توصيات لرفع الكفاءة (thresholds/sectors/regimes)

Workflow:
  1. اختيار الأسهم النشطة من stocks.db (change_percent != 0, volume > 10000,
     history >= 60 يوم).
  2. لكل سهم، حمّل history من price_history.db (~370 يوم).
  3. لكل يوم d في آخر 90 يوم، اقتطع history لحد d + شغّل نفس منطق الـ 8 layers.
  4. سجّل: ticker, date, signal, entry, target, stop_loss, confluence_score,
     macd_score, candlestick_score, fibonacci_score, regime, sector, outcome.
  5. قارن بالنتيجة الفعلية (forward window = 30 يوم) — hit/miss/timeout.
  6. احسب التحليلات التفصيلية.
  7. idempotent — يحفظ النتائج في db/backtest_results/comprehensive_historical_test.json.

Usage:
    python3 scripts/comprehensive_historical_test.py
    python3 scripts/comprehensive_historical_test.py --dry-run
    python3 scripts/comprehensive_historical_test.py --tickers COMI,PHDC --days 60
    python3 scripts/comprehensive_historical_test.py --limit 20
"""
import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
import re
from pathlib import Path

def _parse_vol_safe(v):
    if not v:
        return 0.0
    try:
        s = str(v).replace(',', '').strip()
        if 'M' in s:
            return float(re.sub(r'[^\d.]', '', s)) * 1_000_000
        if 'K' in s:
            return float(re.sub(r'[^\d.]', '', s)) * 1_000
        if 'B' in s:
            return float(re.sub(r'[^\d.]', '', s)) * 1_000_000_000
        n = float(re.sub(r'[^\d.]', '', s))
        return n if n > 0 else 0.0
    except Exception:
        return 0.0

# Reuse the 8-layer scoring engine from backtest_unified_pipeline
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

# Import the full scoring engine from backtest_unified_pipeline
from backtest_unified_pipeline import (
    analyze_as_of,
    evaluate_signal_outcome,
    FORWARD_WINDOW_DAYS,
    DB_PATH,
)

PRICE_DB_PATH = os.environ.get(
    'PRICE_HISTORY_DB', str(PROJECT_ROOT / 'db' / 'price_history.db')
)
OUTPUT_PATH = PROJECT_ROOT / 'db' / 'backtest_results' / 'comprehensive_historical_test.json'

DEFAULT_DAYS = 90
DEFAULT_LIMIT = 50
TARGET_WIN_RATE = 65.0  # target after the 8-layer tuning

# Selection thresholds for active stocks
MIN_VOLUME = 10000
MIN_HISTORY_DAYS = 60


# ============================================================================
# Stock selection
# ============================================================================

def select_active_stocks(limit=None, market='EGX'):
    """
    اختر الأسهم النشطة من stocks.db:
      - change_percent != 0 (السهم تغيّر في السعر)
      - volume > MIN_VOLUME
      - price_history >= MIN_HISTORY_DAYS

    Returns: list of dicts: [{ticker, sector, volume, change_pct, history_days}, ...]
    """
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn1 = db_manager.connection(DB_PATH, writable=False).__enter__()
    conn1.row_factory = sqlite3.Row
    cur1 = conn1.cursor()
    cur1.execute(
        '''
        SELECT ticker, sector, volume, change_percent, current_price
        FROM stocks
        WHERE market = ?
          AND change_percent IS NOT NULL
          AND change_percent != 0
          AND volume IS NOT NULL
          AND volume > ?
        ORDER BY volume DESC
        ''',
        (market, MIN_VOLUME),
    )
    active_rows = cur1.fetchall()
    conn1.close()

    if not active_rows:
        return []

    # Filter by price_history availability
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn2 = db_manager.connection(PRICE_DB_PATH, writable=False).__enter__()
    cur2 = conn2.cursor()
    tickers_to_check = [r['ticker'] for r in active_rows]
    placeholders = ','.join(['?'] * len(tickers_to_check))
    cur2.execute(
        f'SELECT ticker, COUNT(*) AS cnt FROM price_history '
        f'WHERE ticker IN ({placeholders}) GROUP BY ticker HAVING cnt >= ?',
        (*tickers_to_check, MIN_HISTORY_DAYS),
    )
    history_map = {row[0]: row[1] for row in cur2.fetchall()}
    conn2.close()

    candidates = []
    for row in active_rows:
        if row['ticker'] in history_map:
            candidates.append({
                'ticker': row['ticker'],
                'sector': row['sector'] or 'Unknown',
                'volume': row['volume'],
                'change_pct': row['change_percent'],
                'current_price': row['current_price'],
                'history_days': history_map[row['ticker']],
            })

    if limit and limit > 0:
        candidates = candidates[:limit]
    return candidates


def load_history_direct(ticker):
    """
    حمّل history مباشرة من price_history.db (بسرعة، بدون load_merged_history
    لأنه بيعتمد على stocks.db اللي ممكن يكون فيه بيانات ملوّثة).

    Returns: list of dicts: {date, open, high, low, close, volume}
    """
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_DB_PATH, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        '''
        SELECT date, open_price AS open, high_price AS high,
               low_price AS low, close_price AS close, volume
        FROM price_history
        WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
        ORDER BY date ASC
        ''',
        (ticker,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


# ============================================================================
# Backtest per-ticker (with per-layer tracking)
# ============================================================================

def backtest_ticker_comprehensive(ticker, sector, days):
    """
    Backtest واحد على سهم — بيرجّع signals + per-layer contribution.

    Returns: dict with:
      ticker, sector, candles_available, signals, hits, misses, timeouts,
      skipped, win_rate, layer_contribution (per-layer hit rate among BUY),
      regime_breakdown, signals_detail.
    """
    full_history = load_history_direct(ticker)
    if len(full_history) < MIN_HISTORY_DAYS:
        return {
            'ticker': ticker,
            'sector': sector,
            'candles_available': len(full_history),
            'signals_generated': 0,
            'hits': 0, 'misses': 0, 'timeouts': 0, 'skipped': 0,
            'win_rate': 0.0,
            'skipped_reason': 'insufficient_history',
            'signals_detail': [],
            'layer_contribution': {},
            'regime_breakdown': {},
        }

    # Start backtest from index 60 (after indicator warmup) and run for `days`
    backtest_start_idx = max(60, len(full_history) - days)
    backtest_end_idx = len(full_history)

    signals = []
    hits = misses = timeouts = skipped = 0

    # Per-layer tracking: {layer_name: {hit: int, miss: int}}
    layer_stats = {
        'macro': {'hit': 0, 'miss': 0},
        'sma50': {'hit': 0, 'miss': 0},
        'rsi': {'hit': 0, 'miss': 0},
        'volume': {'hit': 0, 'miss': 0},
        'bollinger': {'hit': 0, 'miss': 0},
        'macd': {'hit': 0, 'miss': 0},
        'candlestick': {'hit': 0, 'miss': 0},
        'fibonacci': {'hit': 0, 'miss': 0},
    }
    # Per-regime tracking
    regime_stats = defaultdict(lambda: {'hit': 0, 'miss': 0, 'total': 0})

    for i in range(backtest_start_idx, backtest_end_idx):
        history_slice = full_history[: i + 1]
        # Pass sector to analyze_as_of so HISTORICAL-TEST-018 sector_boost/penalty applies
        record = analyze_as_of(history_slice, sector=sector)
        if record is None:
            continue

        # Capture per-layer sub-scores for this record
        # We re-derive them by calling the per-layer scoring helper.
        layer_scores = _compute_per_layer_scores(history_slice)
        record['macd_score'] = layer_scores['macd']
        record['candlestick_score'] = layer_scores['candlestick']
        record['fibonacci_score'] = layer_scores['fibonacci']
        record['macro_score'] = layer_scores['macro']
        record['sma50_score'] = layer_scores['sma50']
        record['rsi_score'] = layer_scores['rsi']
        record['volume_score'] = layer_scores['volume']
        record['bollinger_score'] = layer_scores['bollinger']
        record['sector'] = sector

        # Evaluate outcome
        future = full_history[i + 1:]
        outcome = evaluate_signal_outcome(record, future)
        record['outcome'] = outcome

        if outcome == 'hit':
            hits += 1
        elif outcome == 'miss':
            misses += 1
        elif outcome == 'timeout':
            timeouts += 1
            misses += 1
        elif outcome == 'skip':
            skipped += 1

        # Per-layer contribution (only for BUY signals — non-skip outcomes)
        if outcome in ('hit', 'miss'):
            for layer_name in layer_stats:
                layer_stats[layer_name][outcome] += 1

        # Per-regime
        regime_key = record.get('regime', 'unknown')
        regime_stats[regime_key]['total'] += 1
        if outcome == 'hit':
            regime_stats[regime_key]['hit'] += 1
        elif outcome == 'miss':
            regime_stats[regime_key]['miss'] += 1

        signals.append(record)

    total_buy = hits + misses
    win_rate = round((hits / total_buy) * 100, 2) if total_buy > 0 else 0.0

    # Compute per-layer "hit_rate_when_layer_strong"
    # A layer is "strong" if its sub-score >= 60% of its max
    # HISTORICAL-TEST-018: updated LAYER_MAX to match new weights (post-tuning)
    LAYER_MAX = {
        'macro': 25, 'sma50': 18, 'rsi': 20, 'volume': 20,
        'bollinger': 15, 'macd': 18, 'candlestick': 10, 'fibonacci': 12,
    }
    layer_contribution = {}
    for layer_name, max_pts in LAYER_MAX.items():
        strong_hits = 0
        strong_total = 0
        for sig in signals:
            if sig.get('outcome') == 'skip':
                continue
            layer_val = sig.get(f'{layer_name}_score')
            if layer_val is None:
                continue
            if layer_val >= max_pts * 0.6:  # strong layer
                strong_total += 1
                if sig['outcome'] == 'hit':
                    strong_hits += 1
        rate = round((strong_hits / strong_total) * 100, 2) if strong_total > 0 else 0.0
        layer_contribution[layer_name] = {
            'strong_total': strong_total,
            'strong_hits': strong_hits,
            'strong_hit_rate': rate,
            'max_pts': max_pts,
        }

    # Per-regime win_rate
    regime_breakdown = {}
    for regime, stats in regime_stats.items():
        if stats['total'] > 0:
            wr = round((stats['hit'] / stats['total']) * 100, 2) if stats['total'] > 0 else 0.0
            regime_breakdown[regime] = {
                'total': stats['total'],
                'hits': stats['hit'],
                'misses': stats['miss'],
                'win_rate': wr,
            }

    return {
        'ticker': ticker,
        'sector': sector,
        'candles_available': len(full_history),
        'signals_generated': len(signals),
        'hits': hits,
        'misses': misses,
        'timeouts': timeouts,
        'skipped': skipped,
        'win_rate': win_rate,
        'signals_detail': signals,
        'layer_contribution': layer_contribution,
        'regime_breakdown': regime_breakdown,
    }


def _compute_per_layer_scores(history_slice):
    """
    Re-compute per-layer sub-scores for the latest candle of history_slice.
    Used to populate macd_score / candlestick_score / fibonacci_score in the
    record (the existing analyze_as_of returns the sum, not the breakdown).
    """
    # Import the helper functions
    from backtest_unified_pipeline import (
        _calc_macd_bt, _detect_candlestick_bt, _calc_fib_bt,
        _rolling_sma, _rolling_rsi, _rolling_atr, _rolling_bollinger,
        _detect_regime_simple, _calc_support_resistance,
    )

    if len(history_slice) < 15:
        return {
            'macro': 0, 'sma50': 0, 'rsi': 0, 'volume': 0,
            'bollinger': 0, 'macd': 0, 'candlestick': 0, 'fibonacci': 0,
        }

    opens = [float(h.get('open', h.get('open_price', 0)) or 0) for h in history_slice]
    highs = [float(h.get('high', h.get('high_price', 0)) or 0) for h in history_slice]
    lows = [float(h.get('low', h.get('low_price', 0)) or 0) for h in history_slice]
    closes = [float(h.get('close', h.get('close_price', 0)) or 0) for h in history_slice]
    volumes = [_parse_vol_safe(h.get('volume', 0)) for h in history_slice]

    ohlcv_slice = [{'open': o, 'high': h, 'low': l, 'close': c}
                   for o, h, l, c in zip(opens, highs, lows, closes)]
    cp = closes[-1]

    # ===== Layer 1: Macro Trend (25 pts) =====
    regime_key, _ = _detect_regime_simple(closes)
    macro_score = 0
    if regime_key == 'bull_trend':
        macro_score = 25
    elif regime_key == 'ranging':
        macro_score = 10
    elif regime_key == 'bear_trend':
        macro_score = 0
    else:
        macro_score = 12

    # ===== Layer 2: Price vs SMA50 (18 pts — HISTORICAL-TEST-018) =====
    sma50_arr = _rolling_sma(closes, 50)
    last_sma50 = sma50_arr[-1] if sma50_arr and sma50_arr[-1] is not None else cp
    sma50_score = 18 if cp > last_sma50 else 3

    # ===== Layer 3: RSI (20 pts) =====
    rsi_arr = _rolling_rsi(closes, 14)
    last_rsi = rsi_arr[-1] if rsi_arr else 50.0
    if 40 <= last_rsi <= 65:
        rsi_score = 20
    elif 30 <= last_rsi < 40:
        rsi_score = 15
    elif 65 < last_rsi <= 75:
        rsi_score = 10
    elif last_rsi < 30:
        rsi_score = 12
    else:
        rsi_score = 3

    # ===== Layer 4: Volume (20 pts) =====
    avg_vol = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 0
    recent_vol = sum(volumes[-5:]) / min(5, len(volumes)) if volumes else 0
    vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0
    if vol_ratio >= 1.3:
        volume_score = 20
    elif vol_ratio >= 1.0:
        volume_score = 14
    else:
        volume_score = 6

    # ===== Layer 5: Bollinger (15 pts — HISTORICAL-TEST-018) =====
    bb_upper_arr, bb_mid_arr, bb_lower_arr = _rolling_bollinger(closes, 20, 2.0)
    bb_l = bb_lower_arr[-1] if bb_lower_arr else None
    bb_u = bb_upper_arr[-1] if bb_upper_arr else None
    bollinger_score = 8  # neutral
    if bb_l is not None and bb_u is not None:
        bb_range = bb_u - bb_l
        if bb_range > 0:
            bb_pos = (cp - bb_l) / bb_range
            if 0.2 <= bb_pos <= 0.5:
                bollinger_score = 15
            elif 0.5 < bb_pos <= 0.7:
                bollinger_score = 8
            elif bb_pos > 0.7:
                bollinger_score = 4
            else:
                bollinger_score = 10

    # ===== Layer 6: MACD (18 pts — HISTORICAL-TEST-018) =====
    macd_line_arr, macd_signal_arr, macd_hist_arr = _calc_macd_bt(closes, 12, 26, 9)
    last_macd_hist = macd_hist_arr[-1] if macd_hist_arr else None
    last_macd_line = macd_line_arr[-1] if macd_line_arr else None
    last_macd_sig = macd_signal_arr[-1] if macd_signal_arr else None
    macd_score = 6  # neutral fallback
    if last_macd_hist is not None and last_macd_line is not None and last_macd_sig is not None:
        if last_macd_hist > 0 and last_macd_line > last_macd_sig:
            macd_score = 18
        elif last_macd_hist > 0:
            macd_score = 10
        elif last_macd_hist < 0 and last_macd_line < last_macd_sig:
            macd_score = 0
        else:
            macd_score = 5

    # ===== Layer 7: Candlestick (10 pts) =====
    candlestick = _detect_candlestick_bt(ohlcv_slice)
    candlestick_score = 3  # neutral fallback
    if candlestick:
        for p in candlestick:
            if p.get('signal') == 'bullish':
                candlestick_score = 10
                break
            elif p.get('signal') == 'neutral':
                candlestick_score = 3
                break
            elif p.get('signal') == 'bearish':
                candlestick_score = 0
                break

    # ===== Layer 8: Fibonacci (12 pts — HISTORICAL-TEST-018) =====
    fib_levels = _calc_fib_bt(closes, highs, lows, lookback=30)
    fib_618 = fib_levels.get('61.8%')
    fibonacci_score = 5  # neutral
    if fib_618 and cp > 0:
        dist_pct = abs(cp - fib_618) / cp * 100
        if dist_pct < 2.0:
            fibonacci_score = 12
        elif dist_pct < 5.0:
            fibonacci_score = 7
        else:
            fibonacci_score = 3

    return {
        'macro': macro_score,
        'sma50': sma50_score,
        'rsi': rsi_score,
        'volume': volume_score,
        'bollinger': bollinger_score,
        'macd': macd_score,
        'candlestick': candlestick_score,
        'fibonacci': fibonacci_score,
    }


# ============================================================================
# Analysis aggregation
# ============================================================================

def aggregate_results(per_ticker_results):
    """Aggregate per-ticker results into per-sector / per-regime / per-layer."""
    # Per-sector
    sector_stats = defaultdict(lambda: {'hits': 0, 'misses': 0, 'signals': 0, 'tickers': 0})
    # Per-regime (aggregated across all tickers)
    regime_stats = defaultdict(lambda: {'hits': 0, 'misses': 0, 'total': 0})
    # Per-layer (sum across tickers)
    layer_stats = defaultdict(lambda: {'strong_hits': 0, 'strong_total': 0, 'max_pts': 0})

    for r in per_ticker_results:
        if r.get('skipped_reason') == 'insufficient_history':
            continue
        sector = r.get('sector', 'Unknown')
        sector_stats[sector]['tickers'] += 1
        sector_stats[sector]['hits'] += r['hits']
        sector_stats[sector]['misses'] += r['misses']
        sector_stats[sector]['signals'] += r['signals_generated']

        for regime, stats in r.get('regime_breakdown', {}).items():
            regime_stats[regime]['hits'] += stats['hits']
            regime_stats[regime]['misses'] += stats['misses']
            regime_stats[regime]['total'] += stats['total']

        for layer, lc in r.get('layer_contribution', {}).items():
            layer_stats[layer]['strong_hits'] += lc['strong_hits']
            layer_stats[layer]['strong_total'] += lc['strong_total']
            layer_stats[layer]['max_pts'] = lc['max_pts']

    # Finalize sector win rates
    per_sector = {}
    for sector, stats in sector_stats.items():
        total_buy = stats['hits'] + stats['misses']
        wr = round((stats['hits'] / total_buy) * 100, 2) if total_buy > 0 else 0.0
        per_sector[sector] = {
            'tickers': stats['tickers'],
            'signals': stats['signals'],
            'hits': stats['hits'],
            'misses': stats['misses'],
            'win_rate': wr,
        }

    # Finalize regime win rates
    per_regime = {}
    for regime, stats in regime_stats.items():
        total_buy = stats['hits'] + stats['misses']
        wr = round((stats['hits'] / total_buy) * 100, 2) if total_buy > 0 else 0.0
        per_regime[regime] = {
            'total': stats['total'],
            'hits': stats['hits'],
            'misses': stats['misses'],
            'win_rate': wr,
        }

    # Finalize per-layer
    per_layer = {}
    for layer, stats in layer_stats.items():
        wr = round((stats['strong_hits'] / stats['strong_total']) * 100, 2) \
            if stats['strong_total'] > 0 else 0.0
        per_layer[layer] = {
            'strong_total': stats['strong_total'],
            'strong_hits': stats['strong_hits'],
            'strong_hit_rate': wr,
            'max_pts': stats['max_pts'],
        }

    return per_sector, per_regime, per_layer


def build_recommendations(per_layer, per_sector, per_regime, overall_win_rate):
    """Build tuning recommendations based on the analysis."""
    recs = []

    # Per-layer recommendations
    for layer, stats in sorted(per_layer.items(), key=lambda x: x[1]['strong_hit_rate']):
        if stats['strong_total'] < 50:
            continue  # not enough data
        rate = stats['strong_hit_rate']
        if rate < overall_win_rate - 5.0:
            recs.append({
                'type': 'layer_underperforming',
                'layer': layer,
                'strong_hit_rate': rate,
                'overall_win_rate': overall_win_rate,
                'recommendation': f'خفّض وزن {layer} أو ارفع threshold الـ "strong" من 0.6 إلى 0.7 '
                                  f'(rate {rate}% < overall {overall_win_rate}%).',
            })
        elif rate > overall_win_rate + 5.0:
            recs.append({
                'type': 'layer_overperforming',
                'layer': layer,
                'strong_hit_rate': rate,
                'overall_win_rate': overall_win_rate,
                'recommendation': f'ارفع وزن {layer} (max_pts {stats["max_pts"]} → {stats["max_pts"] + 5}). '
                                  f'الـ layer ده بيحقق {rate}% فوق الـ overall {overall_win_rate}%.',
            })

    # Per-sector recommendations
    if per_sector:
        sorted_sectors = sorted(per_sector.items(),
                                key=lambda x: x[1]['win_rate'] if x[1]['win_rate'] > 0 else -1,
                                reverse=True)
        for sector, stats in sorted_sectors[:3]:
            if stats['win_rate'] > overall_win_rate + 3.0 and stats['hits'] + stats['misses'] >= 20:
                recs.append({
                    'type': 'sector_boost',
                    'sector': sector,
                    'win_rate': stats['win_rate'],
                    'overall_win_rate': overall_win_rate,
                    'recommendation': f'أضف sector_boost = +5 لقطاع "{sector}" '
                                      f'(win_rate {stats["win_rate"]}% > overall {overall_win_rate}%).',
                })
        for sector, stats in sorted_sectors[-3:]:
            if stats['win_rate'] > 0 and stats['win_rate'] < overall_win_rate - 5.0 \
                    and stats['hits'] + stats['misses'] >= 20:
                recs.append({
                    'type': 'sector_penalty',
                    'sector': sector,
                    'win_rate': stats['win_rate'],
                    'overall_win_rate': overall_win_rate,
                    'recommendation': f'خفّض وزن قطاع "{sector}" أو ارفع BUY threshold له '
                                      f'(win_rate {stats["win_rate"]}% < overall {overall_win_rate}%).',
                })

    # Per-regime recommendations
    for regime, stats in per_regime.items():
        if stats['total'] < 50:
            continue
        if stats['win_rate'] > overall_win_rate + 5.0:
            recs.append({
                'type': 'regime_boost',
                'regime': regime,
                'win_rate': stats['win_rate'],
                'overall_win_rate': overall_win_rate,
                'recommendation': f'ارفع وزن الـ {regime} regime — بيحقق {stats["win_rate"]}% '
                                  f'(overall {overall_win_rate}%).',
            })
        elif stats['win_rate'] < overall_win_rate - 5.0:
            recs.append({
                'type': 'regime_penalty',
                'regime': regime,
                'win_rate': stats['win_rate'],
                'overall_win_rate': overall_win_rate,
                'recommendation': f'خفّض وزن الـ {regime} regime — بيحقق {stats["win_rate"]}% فقط.',
            })

    return recs


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Comprehensive Historical Test (HISTORICAL-TEST-018)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--dry-run', action='store_true',
                        help='فحص الأسهم المرشحة بدون backtest')
    parser.add_argument('--tickers', default=None,
                        help='Comma-separated tickers (override auto-selection)')
    parser.add_argument('--limit', type=int, default=DEFAULT_LIMIT,
                        help=f'Max stocks to backtest (default: {DEFAULT_LIMIT})')
    parser.add_argument('--days', type=int, default=DEFAULT_DAYS,
                        help=f'Backtest window in trading days (default: {DEFAULT_DAYS})')
    parser.add_argument('--market', default='EGX',
                        help='Market filter (default: EGX)')
    parser.add_argument('--output', default=str(OUTPUT_PATH),
                        help=f'Output JSON path (default: {OUTPUT_PATH})')
    args = parser.parse_args()

    print(f"\n{'='*72}")
    print(f"  COMPREHENSIVE HISTORICAL TEST (HISTORICAL-TEST-018)")
    print(f"{'='*72}")

    # Stock selection
    if args.tickers:
        tickers_list = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
        # Build candidate list with sector lookup
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DB_PATH, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        candidates = []
        for t in tickers_list:
            cur.execute('SELECT ticker, sector FROM stocks WHERE ticker = ?', (t,))
            row = cur.fetchone()
            sector = row['sector'] if row else 'Unknown'
            candidates.append({
                'ticker': t,
                'sector': sector or 'Unknown',
                'volume': 0,
                'change_pct': 0,
                'current_price': 0,
                'history_days': 0,
            })
        conn.close()
    else:
        candidates = select_active_stocks(limit=args.limit, market=args.market)

    print(f"  Market: {args.market}")
    print(f"  Candidates: {len(candidates)}")
    print(f"  Days: {args.days}")
    print(f"  Forward window: {FORWARD_WINDOW_DAYS} days")
    print(f"  Target win_rate: >= {TARGET_WIN_RATE}%")
    print(f"  DB: {DB_PATH}")
    print(f"  Price DB: {PRICE_DB_PATH}")
    print(f"  Output: {args.output}")

    if not candidates:
        print("\n❌ No candidates found — exiting.")
        return 1

    # Dry-run mode: just print candidates
    if args.dry_run:
        print(f"\n📋 Candidates ({len(candidates)}):")
        print(f"{'#':>3}  {'ticker':8s}  {'sector':30s}  {'volume':>14s}  {'chg%':>7s}  {'hist':>5s}")
        print('-' * 80)
        for i, c in enumerate(candidates, 1):
            print(f"{i:>3}  {c['ticker']:8s}  {c['sector'][:30]:30s}  "
                  f"{c['volume']:>14}  {c['change_pct']:>7.2f}  {c['history_days']:>5}")
        print(f"\n✅ Dry-run complete — {len(candidates)} candidates. Run without --dry-run to backtest.")
        return 0

    print(f"\n{'='*72}")
    print(f"  RUNNING BACKTEST ON {len(candidates)} STOCKS ...")
    print(f"{'='*72}\n")

    per_ticker_results = []
    total_hits = total_misses = total_skipped = 0
    signal_distribution = {'BUY': 0, 'HOLD': 0, 'SELL': 0}

    for i, c in enumerate(candidates, 1):
        ticker = c['ticker']
        sector = c['sector']
        print(f"[{i:>3}/{len(candidates)}] 📊 {ticker:8s} ({sector[:25]:25s}) ...", end=' ', flush=True)
        result = backtest_ticker_comprehensive(ticker, sector, args.days)
        per_ticker_results.append(result)
        total_hits += result['hits']
        total_misses += result['misses']
        total_skipped += result['skipped']
        # Count signal distribution from signals_detail
        for sig in result.get('signals_detail', []):
            s = sig.get('signal', 'HOLD')
            if s in signal_distribution:
                signal_distribution[s] += 1
        print(f"signals={result['signals_generated']:>3} hits={result['hits']:>3} "
              f"misses={result['misses']:>3} wr={result['win_rate']:>6.2f}%")

    overall_total = total_hits + total_misses
    overall_win_rate = round((total_hits / overall_total) * 100, 2) if overall_total > 0 else 0.0
    target_met = overall_win_rate >= TARGET_WIN_RATE

    # Aggregate
    per_sector, per_regime, per_layer = aggregate_results(per_ticker_results)
    recommendations = build_recommendations(per_layer, per_sector, per_regime, overall_win_rate)

    # Best/worst tickers
    valid_results = [r for r in per_ticker_results if r['signals_generated'] > 0]
    sorted_by_wr = sorted(valid_results, key=lambda x: x['win_rate'], reverse=True)
    best_tickers = [
        {'ticker': r['ticker'], 'sector': r['sector'], 'win_rate': r['win_rate'],
         'hits': r['hits'], 'misses': r['misses']}
        for r in sorted_by_wr[:10]
    ]
    worst_tickers = [
        {'ticker': r['ticker'], 'sector': r['sector'], 'win_rate': r['win_rate'],
         'hits': r['hits'], 'misses': r['misses']}
        for r in sorted_by_wr[-10:] if r['win_rate'] > 0
    ]

    summary = {
        'task_id': 'HISTORICAL-TEST-018',
        'generated_at': datetime.now().isoformat(),
        'config': {
            'market': args.market,
            'candidates_count': len(candidates),
            'days': args.days,
            'forward_window_days': FORWARD_WINDOW_DAYS,
            'target_win_rate': TARGET_WIN_RATE,
            'selection_criteria': {
                'change_percent_ne': 0,
                'volume_gt': MIN_VOLUME,
                'history_days_gte': MIN_HISTORY_DAYS,
            },
            'layers': [
                'macro', 'sma50', 'rsi', 'volume', 'bollinger',
                'macd', 'candlestick', 'fibonacci',
            ],
        },
        'overall': {
            'tickers_tested': len(candidates),
            'tickers_with_signals': len(valid_results),
            'total_buy_signals': overall_total,
            'total_hits': total_hits,
            'total_misses': total_misses,
            'total_skipped_non_buy': total_skipped,
            'win_rate': overall_win_rate,
            'target_met': target_met,
            'target_delta': round(overall_win_rate - TARGET_WIN_RATE, 2),
            'signal_distribution': signal_distribution,
        },
        'per_layer': per_layer,
        'per_sector': per_sector,
        'per_regime': per_regime,
        'best_tickers': best_tickers,
        'worst_tickers': worst_tickers,
        'recommendations': recommendations,
        'per_ticker': [
            {k: v for k, v in r.items()
             if k not in ('signals_detail', 'layer_contribution', 'regime_breakdown')}
            for r in per_ticker_results
        ],
        'signals_detail': [
            {
                'ticker': r['ticker'],
                'sector': r['sector'],
                'signals': [
                    {k: v for k, v in sig.items() if k in (
                        'date', 'signal', 'entry', 'target', 'stop_loss',
                        'confluence_score', 'macd_score', 'candlestick_score',
                        'fibonacci_score', 'regime', 'rr', 'outcome',
                    )}
                    for sig in r.get('signals_detail', [])
                ],
            }
            for r in per_ticker_results if r.get('signals_detail')
        ],
    }

    # Write idempotently (overwrite)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2, default=str)

    # Print summary
    print(f"\n{'='*72}")
    print(f"  OVERALL RESULTS")
    print(f"{'='*72}")
    print(f"  Tickers tested: {len(candidates)} ({len(valid_results)} with signals)")
    print(f"  Total BUY signals: {overall_total}")
    print(f"  Hits: {total_hits}  |  Misses: {total_misses}  |  Skipped (non-BUY): {total_skipped}")
    print(f"  Win rate: {overall_win_rate}%")
    print(f"  Target: >= {TARGET_WIN_RATE}%  →  {'✅ MET' if target_met else '❌ NOT MET'}")
    print(f"  Delta: {summary['overall']['target_delta']:+.2f} pts")
    print(f"\n  Signal distribution:")
    for sig, cnt in signal_distribution.items():
        pct = (cnt / sum(signal_distribution.values()) * 100) if sum(signal_distribution.values()) > 0 else 0
        print(f"    {sig:5s}: {cnt:>5} ({pct:>5.1f}%)")

    print(f"\n  Per-layer contribution (strong-hit rate when layer is strong):")
    print(f"    {'layer':12s} {'max_pts':>8s} {'strong_total':>13s} {'strong_hits':>12s} {'hit_rate':>9s}")
    for layer, stats in sorted(per_layer.items(), key=lambda x: x[1]['strong_hit_rate'], reverse=True):
        print(f"    {layer:12s} {stats['max_pts']:>8} {stats['strong_total']:>13} "
              f"{stats['strong_hits']:>12} {stats['strong_hit_rate']:>8.2f}%")

    print(f"\n  Per-sector win_rate (top 10):")
    print(f"    {'sector':35s} {'tickers':>8s} {'signals':>8s} {'hits':>6s} {'misses':>7s} {'win_rate':>9s}")
    sorted_sectors = sorted(per_sector.items(), key=lambda x: x[1]['win_rate'], reverse=True)
    for sector, stats in sorted_sectors[:10]:
        print(f"    {sector[:35]:35s} {stats['tickers']:>8} {stats['signals']:>8} "
              f"{stats['hits']:>6} {stats['misses']:>7} {stats['win_rate']:>8.2f}%")

    print(f"\n  Per-regime win_rate:")
    print(f"    {'regime':15s} {'total':>6s} {'hits':>6s} {'misses':>7s} {'win_rate':>9s}")
    for regime, stats in sorted(per_regime.items(), key=lambda x: x[1]['win_rate'], reverse=True):
        print(f"    {regime:15s} {stats['total']:>6} {stats['hits']:>6} "
              f"{stats['misses']:>7} {stats['win_rate']:>8.2f}%")

    print(f"\n  Top 10 best tickers:")
    for r in best_tickers:
        print(f"    {r['ticker']:8s} ({r['sector'][:25]:25s}) — wr={r['win_rate']:>6.2f}% "
              f"({r['hits']}H/{r['misses']}M)")

    if worst_tickers:
        print(f"\n  Top 10 worst tickers:")
        for r in worst_tickers:
            print(f"    {r['ticker']:8s} ({r['sector'][:25]:25s}) — wr={r['win_rate']:>6.2f}% "
                  f"({r['hits']}H/{r['misses']}M)")

    if recommendations:
        print(f"\n  🔧 Tuning recommendations ({len(recommendations)}):")
        for i, rec in enumerate(recommendations, 1):
            print(f"    [{i}] [{rec['type']}] {rec['recommendation']}")

    print(f"\n  Report saved: {out_path}")
    print(f"{'='*72}\n")

    return 0 if target_met else 1


if __name__ == '__main__':
    sys.exit(main())
