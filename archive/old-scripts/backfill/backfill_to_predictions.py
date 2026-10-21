#!/usr/bin/env python3
"""
Backfill Historical Predictions to `predictions` table
=======================================================
يولّد توقعات تاريخية لكل أيام التداول المتاحة في price_history.db
ويخزّنها في predictions table (اللي بيقرأها #prediction-credibility).

المشكلة الأصلية:
- backfill_historical_predictions.py بيخزّن في persona_predictions (مكان غلط)
- credibility route بيقرأ من predictions table فقط
- كل التوقعات كانت ليوم واحد (2026-07-14)

الحل:
- نقرأ price_history.db (274k صف، 369 يوم، 762 سهم)
- لكل يوم تداول، نحسب RSI, MA20, MA50 لكل سهم AS OF that date
- نولّد توصية BUY/SELL/HOLD + entry/target/stop
- نخزّن في predictions table (مش persona_predictions)

Usage:
    cd vps-service
    python3 scripts/backfill_to_predictions.py [--days 365] [--per-day 20]
"""

import os
import sys
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def parse_volume(vol_str):
    if not vol_str: return 0
    if isinstance(vol_str, (int, float)): return int(vol_str)
    s = str(vol_str).replace('\u202f', '').replace(',', '').strip().upper()
    try:
        if s.endswith('M'): return int(float(s[:-1]) * 1000000)
        if s.endswith('K'): return int(float(s[:-1]) * 1000)
        if s.endswith('B'): return int(float(s[:-1]) * 1000000000)
        return int(float(s))
    except (ValueError, TypeError):
        return 0


# ============================================================================
# INDICATORS
# ============================================================================

def compute_rsi(closes: List[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(change if change > 0 else 0)
        losses.append(abs(change) if change < 0 else 0)
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def compute_ma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return round(sum(closes[-period:]) / period, 4)


def compute_atr(prices: List[Dict], period: int = 14) -> float:
    """Average True Range for stop/target sizing."""
    if len(prices) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(prices)):
        h = float(prices[i].get('high_price') or 0)
        l = float(prices[i].get('low_price') or 0)
        pc = float(prices[i - 1].get('close_price') or 0)
        if h <= 0 or l <= 0:
            continue
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return 0.0
    return round(sum(trs[-period:]) / period, 4)


# ============================================================================
# SIGNAL GENERATION
# ============================================================================

def generate_signal(closes: List[float], prices: List[Dict]) -> Dict:
    """
    استراتيجية بسيطة لكنها فعّالة:
    - BUY: RSI < 35 (oversold) + price > MA20 (not in freefall)
    - SELL: RSI > 70 (overbought) + price < MA20 (not in rally)
    - HOLD: otherwise
    """
    if len(closes) < 25:
        return {'signal': 'HOLD', 'score': 50, 'reason': 'insufficient_history'}

    rsi = compute_rsi(closes, 14)
    ma20 = compute_ma(closes, 20)
    ma50 = compute_ma(closes, 50)
    atr = compute_atr(prices, 14)
    current = closes[-1]

    score = 50
    reasons = []

    # Trend direction
    if ma50 and current > ma50:
        score += 10
        reasons.append('above_ma50')
    elif ma50 and current < ma50:
        score -= 10
        reasons.append('below_ma50')

    # RSI signals
    if rsi < 30:
        score += 20
        reasons.append('rsi_oversold')
    elif rsi > 70:
        score -= 20
        reasons.append('rsi_overbought')
    elif rsi < 40:
        score += 5
        reasons.append('rsi_low')

    # MA crossover
    if ma20 and ma50:
        if ma20 > ma50:
            score += 10
            reasons.append('ma20_above_ma50')
        else:
            score -= 10
            reasons.append('ma20_below_ma50')

    # Decide signal
    signal = 'HOLD'
    if score >= 65 and rsi < 50:
        signal = 'BUY'
    elif score <= 35 and rsi > 50:
        signal = 'SELL'

    # ATR-based stop/target (if ATR available)
    if atr > 0 and signal in ('BUY', 'SELL'):
        stop_mult = 2.0
        target_mult = 3.0
    else:
        atr = 0
        stop_mult = 0
        target_mult = 0

    return {
        'signal': signal,
        'score': max(0, min(100, score)),
        'rsi': rsi,
        'ma20': ma20,
        'ma50': ma50,
        'atr': atr,
        'stop_mult': stop_mult,
        'target_mult': target_mult,
        'reasons': reasons,
    }


# ============================================================================
# STORAGE
# ============================================================================

def store_prediction(conn, ticker, signal, entry, target, stop, pred_date,
                     score, rsi, ma20, ma50, atr, market='EGX'):
    """خزّن توقع في predictions table."""
    cur = conn.cursor()
    # Check if already exists for this ticker+date
    existing = cur.execute(
        'SELECT id FROM predictions WHERE ticker = ? AND prediction_date LIKE ?',
        (ticker, f"{pred_date}%")
    ).fetchone()
    if existing:
        return False

    pred_id = str(uuid.uuid4())
    cur.execute('''
        INSERT INTO predictions
        (ticker, signal, signal_type, prediction_date, entry_price, target_price,
         stop_loss, master_score, technical_score, fundamental_score,
         ai_pattern_score, sentiment_score, hit_target, hit_stop, is_correct,
         holding_days, notes, created_at, is_trend_following,
         trailing_stop_atr_mult, initial_stop_atr_mult, atr_at_entry)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, 0, ?, ?, 0, 2.5, 2.0, ?)
    ''', (
        ticker, signal, signal, f"{pred_date} 12:00:00",
        entry, target, stop,
        score, score, 50, 50, 50,
        f"RSI={rsi}; MA20={ma20}; MA50={ma50}; ATR={atr}",
        f"{pred_date} 12:00:00",
        atr,
    ))
    conn.commit()
    return True


# ============================================================================
# MAIN
# ============================================================================

def run_backfill(days_back: int = 365, per_day: int = 20, markets=None):
    # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
    # to write predictions. This one-off backfill script is disabled to prevent
    # contamination of the canonical prediction store.
    # To re-enable for manual backfill: comment out this guard.
    # Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
    return
    if markets is None:
        markets = ['EGX']

    log(f"🧠 Backfill to predictions table")
    log(f"   Days back: {days_back}")
    log(f"   Per day: {per_day}")
    log(f"   Markets: {markets}")
    log("")

    # 1. Load all price history from price_history.db
    log(f"Loading price history from {PRICE_HISTORY_DB}...")
    ph_conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=30.0)
    ph_conn.row_factory = sqlite3.Row

    # Get distinct trading dates
    cur = ph_conn.cursor()
    r = cur.execute('SELECT MIN(date), MAX(date), COUNT(DISTINCT date) FROM price_history').fetchone()
    log(f"   Price history: {r[0]} to {r[1]}, {r[2]} distinct dates")

    max_date = datetime.strptime(r[1], '%Y-%m-%d')
    start_date = max_date - timedelta(days=days_back)
    start_str = start_date.strftime('%Y-%m-%d')

    # Get trading dates in range (leave last day for verification)
    end_str = (max_date - timedelta(days=1)).strftime('%Y-%m-%d')
    trading_dates = [row[0] for row in cur.execute(
        'SELECT DISTINCT date FROM price_history WHERE date BETWEEN ? AND ? ORDER BY date ASC',
        (start_str, end_str)
    ).fetchall()]
    log(f"   Trading dates to backfill: {len(trading_dates)}")
    log(f"   Range: {trading_dates[0] if trading_dates else 'N/A'} → {trading_dates[-1] if trading_dates else 'N/A'}")
    log("")

    if not trading_dates:
        log("❌ No trading dates found")
        return

    # 2. Load all price data into memory (grouped by ticker)
    log("Loading all price data into memory...")
    all_prices = {}
    for row in cur.execute(
        'SELECT ticker, date, open_price, high_price, low_price, close_price, volume '
        'FROM price_history ORDER BY ticker, date ASC'
    ).fetchall():
        d = dict(row)
        if d['ticker'] not in all_prices:
            all_prices[d['ticker']] = []
        all_prices[d['ticker']].append(d)
    log(f"   Loaded {len(all_prices)} tickers")
    log("")

    # 3. Open predictions DB
    pred_conn = sqlite3.connect(PREDICTIONS_DB, timeout=60.0)

    # 4. Generate predictions for each trading date
    total_buy = 0
    total_sell = 0
    total_hold = 0
    total_stored = 0
    total_skipped = 0

    for date_str in trading_dates:
        day_buy = 0
        day_sell = 0
        day_hold = 0
        day_stored = 0
        day_skipped = 0

        # Collect candidates for this date
        candidates = []
        for ticker, prices in all_prices.items():
            # Filter prices up to date_str (no look-ahead)
            prices_up_to = [p for p in prices if p['date'] <= date_str]
            if len(prices_up_to) < 25:
                continue

            today = prices_up_to[-1]
            if today['date'] != date_str:
                continue  # No data for this exact date

            current = float(today.get('close_price') or 0)
            if current <= 0:
                continue

            closes = [float(p['close_price']) for p in prices_up_to
                      if p.get('close_price') and p['close_price'] > 0]
            if len(closes) < 25:
                continue

            candidates.append({
                'ticker': ticker,
                'prices': prices_up_to,
                'closes': closes,
                'current': current,
                'volume': parse_volume(today.get('volume')),
            })

        # Sort by volume (most active first) and take top per_day
        candidates.sort(key=lambda x: x['volume'], reverse=True)
        candidates = candidates[:per_day]

        for c in candidates:
            sig = generate_signal(c['closes'], c['prices'])
            score = sig['score']
            rsi = sig['rsi']
            ma20 = sig['ma20'] or 0
            ma50 = sig['ma50'] or 0
            atr = sig['atr']

            if sig['signal'] == 'HOLD':
                day_hold += 1
                continue

            entry = c['current']
            if sig['signal'] == 'BUY':
                target = round(entry + (atr * sig['target_mult']), 4) if atr > 0 else round(entry * 1.10, 4)
                stop = round(entry - (atr * sig['stop_mult']), 4) if atr > 0 else round(entry * 0.95, 4)
            else:  # SELL
                target = round(entry - (atr * sig['target_mult']), 4) if atr > 0 else round(entry * 0.90, 4)
                stop = round(entry + (atr * sig['stop_mult']), 4) if atr > 0 else round(entry * 1.05, 4)

            stored = store_prediction(
                pred_conn, c['ticker'], sig['signal'], entry, target, stop,
                date_str, score, rsi, ma20, ma50, atr, market='EGX'
            )
            if stored:
                day_stored += 1
                if sig['signal'] == 'BUY':
                    day_buy += 1
                else:
                    day_sell += 1
            else:
                day_skipped += 1

        total_buy += day_buy
        total_sell += day_sell
        total_hold += day_hold
        total_stored += day_stored
        total_skipped += day_skipped

        if day_stored > 0:
            log(f"   {date_str}: stored={day_stored} (BUY={day_buy}, SELL={day_sell}, HOLD={day_hold}, skip={day_skipped})")

    pred_conn.close()
    ph_conn.close()

    log("")
    log(f"✅ Backfill complete!")
    log(f"   Total stored: {total_stored}")
    log(f"   BUY: {total_buy}")
    log(f"   SELL: {total_sell}")
    log(f"   HOLD (not stored): {total_hold}")
    log(f"   Skipped (already exists): {total_skipped}")
    log("")
    log(f"   Now run /api/predictions/honest-tracking/verify-pending to evaluate outcomes")


if __name__ == '__main__':
    # Task FINALIZE-UNIFICATION: non-canonical writer disabled (Rule 35).
    # V40.2 (daily_predictor.py) is the ONLY writer to predictions.db.
    # To re-enable: remove this guard. Do NOT delete (Rule 16).
    # NOTE: This is a backtest engine (Rule 27 simulation exception applies), but it INSERTs into
    # the LIVE predictions table, which violates Rule 35. Use a sandbox/replica DB to re-enable.
    import sys
    print('[FINALIZE-UNIFICATION] GUARD: backfill_to_predictions.py disabled (Rule 35). V40.2 (daily_predictor.py) is the only writer. Backtest simulation context does NOT bypass Rule 35 — use a replica DB to re-enable.')
    sys.exit(0)
    import argparse
    parser = argparse.ArgumentParser(description='Backfill historical predictions to predictions table')
    parser.add_argument('--days', type=int, default=365, help='Number of days to backfill (default: 365)')
    parser.add_argument('--per-day', type=int, default=20, help='Max predictions per day (default: 20)')
    parser.add_argument('--markets', nargs='+', default=['EGX'], help='Markets (default: EGX)')
    args = parser.parse_args()
    run_backfill(days_back=args.days, per_day=args.per_day, markets=args.markets)
