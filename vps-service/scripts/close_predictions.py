#!/usr/bin/env python3
"""
Prediction Closing Engine
==========================
محرك إغلاق التوقعات — يقارن السعر الحالي لكل توقع مفتوح بـ target/stop
ويحدّث الـ status + P&L تلقائياً.

يشتغل على جدولين:
  1. persona_predictions (status='PENDING')  ← persona-based picks
  2. predictions         (outcome_date IS NULL) ← master analyzer picks

مصادر الأسعار (بترتيب الأفضلية):
  1. price_history.db → price_history (الأرشيف الكامل، 274K صف)
  2. stocks.db → stock_daily_prices (البيانات اليومية الحديثة)
  3. data_engine.db → historical_data (للأسواق العربية)

Usage:
  python3 close_predictions.py                    # close all open predictions
  python3 close_predictions.py --dry-run          # report only, no DB writes
  python3 close_predictions.py --table persona    # only persona_predictions
  python3 close_predictions.py --table master     # only predictions
  python3 close_predictions.py --expire-days 30   # expire after 30 days (default)
  python3 close_predictions.py --ticker COMI      # single ticker (debug)

Exit codes: 0=success, 1=error.
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (relative to project root, with env override)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent  # scripts/ -> vps-service/ -> project root
DB_DIR = Path(os.environ.get('DB_DIR', str(PROJECT_ROOT / 'db')))

PREDICTIONS_DB = str(DB_DIR / 'predictions.db')
PRICE_HISTORY_DB = str(DB_DIR / 'price_history.db')
STOCKS_DB = str(DB_DIR / 'stocks.db')
DATA_ENGINE_DB = str(DB_DIR / 'data_engine.db')


def log(msg: str):
    print(f"[ClosePredictions {datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Price history loader (mirrors the fixed credibility route logic)
# ---------------------------------------------------------------------------
_price_cache = {}  # ticker -> list of (date_str, open, high, low, close)


def load_price_history(ticker: str) -> list:
    """Load price history for a ticker from all sources, merged & sorted.

    Returns list of dicts: {date, open, high, low, close} (volume also present)

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    The unified reader merges yahoo_clean → egksco → migration → stocks.db
    and caches per (ticker, limit) for 5 minutes.
    """
    # Lazy import to avoid circular deps and keep startup fast.
    from data.prices import load_price_history as _unified_load

    # Fetch with a high limit (the old reader returned full history); the
    # unified function clamps to 2000 internally.
    rows = _unified_load(ticker, limit=2000)

    # Preserve the historical caller contract: dicts with {date, open, high,
    # low, close} (volume is also present but not required by callers).
    # Unified returns oldest-first, matching the old sort order.
    result = [
        {
            'date': r.get('date'),
            'open': r.get('open', 0),
            'high': r.get('high', 0),
            'low': r.get('low', 0),
            'close': r.get('close', 0),
            'volume': r.get('volume', 0),
        }
        for r in rows
        if r.get('close') is not None
    ]
    _price_cache[ticker] = result
    return result


# ---------------------------------------------------------------------------
# Close logic
# ---------------------------------------------------------------------------
def _parse_pred_date(date_str: str) -> str:
    """Normalize prediction date to YYYY-MM-DD."""
    if not date_str:
        return ''
    return date_str.strip()[:10]  # take first 10 chars (YYYY-MM-DD)


def evaluate_prediction(entry: float, target: float, stop: float,
                        signal_type: str, pred_date: str,
                        prices: list, expire_days: int) -> dict:
    """Determine the outcome of a prediction.

    Returns dict with: status, exit_price, exit_date, pnl_pct, hit_target,
                       hit_stop, holding_days, max_price, min_price
    """
    if not prices or entry <= 0:
        return {'status': 'PENDING', 'exit_price': None, 'exit_date': None,
                'pnl_pct': None, 'hit_target': 0, 'hit_stop': 0,
                'holding_days': 0, 'max_price': None, 'min_price': None}

    pred_d = _parse_pred_date(pred_date)
    # Filter prices AFTER the prediction date
    future = [p for p in prices if p['date'] >= pred_d]
    if not future:
        # No future data yet — still pending
        return {'status': 'PENDING', 'exit_price': None, 'exit_date': None,
                'pnl_pct': None, 'hit_target': 0, 'hit_stop': 0,
                'holding_days': 0, 'max_price': None, 'min_price': None}

    # Track extremes
    max_price = max((p['high'] or p['close'] or 0) for p in future)
    min_price = min((p['low'] or p['close'] or entry) for p in future)
    last = future[-1]
    last_close = last['close'] or last['open'] or entry
    last_date = last['date']

    # Determine direction
    is_buy = signal_type.upper() in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'LONG')
    is_sell = signal_type.upper() in ('SELL', 'STRONG_SELL', 'REDUCE', 'SHORT')

    # Default: if no target/stop, we can't determine hit — only expire
    has_target = target is not None and target > 0
    has_stop = stop is not None and stop > 0

    hit_target = False
    hit_stop = False
    exit_price = None
    exit_date = None
    status = 'PENDING'

    if has_target or has_stop:
        # Walk forward to find first hit
        for p in future:
            hi = p['high'] if p['high'] is not None else p['close']
            lo = p['low'] if p['low'] is not None else p['close']
            if hi is None or lo is None:
                continue

            if is_buy:
                # For BUY: stop is below, target is above
                # Conservative: assume stop hit first if both hit same day
                if has_stop and lo <= stop:
                    hit_stop = True
                    exit_price = stop
                    exit_date = p['date']
                    break
                if has_target and hi >= target:
                    hit_target = True
                    exit_price = target
                    exit_date = p['date']
                    break
            elif is_sell:
                # For SELL: stop is above, target is below
                if has_stop and hi >= stop:
                    hit_stop = True
                    exit_price = stop
                    exit_date = p['date']
                    break
                if has_target and lo <= target:
                    hit_target = True
                    exit_price = target
                    exit_date = p['date']
                    break
            else:
                # HOLD or unknown signal — can't hit target/stop meaningfully
                break

        if hit_target:
            status = 'TARGET_HIT'
        elif hit_stop:
            status = 'STOPPED'  # normalized to match existing persona_predictions values

    # If not hit, check for expiry
    if status == 'PENDING':
        try:
            pred_dt = datetime.strptime(pred_d, '%Y-%m-%d')
        except Exception:
            pred_dt = datetime.now() - timedelta(days=expire_days + 1)
        age_days = (datetime.now() - pred_dt).days
        if age_days >= expire_days:
            status = 'EXPIRED'
            exit_price = last_close
            exit_date = last_date
        else:
            # Still pending — not enough time has passed
            return {'status': 'PENDING', 'exit_price': None, 'exit_date': None,
                    'pnl_pct': None, 'hit_target': 0, 'hit_stop': 0,
                    'holding_days': age_days, 'max_price': max_price,
                    'min_price': min_price}

    # Calculate P&L
    if exit_price is not None and entry > 0:
        if is_sell:
            pnl_pct = round(((entry - exit_price) / entry) * 100, 2)
        else:
            pnl_pct = round(((exit_price - entry) / entry) * 100, 2)
    else:
        pnl_pct = None

    # Holding days
    try:
        pred_dt = datetime.strptime(pred_d, '%Y-%m-%d')
        exit_dt = datetime.strptime(exit_date, '%Y-%m-%d') if exit_date else datetime.now()
        holding = (exit_dt - pred_dt).days
    except Exception:
        holding = 0

    return {
        'status': status,
        'exit_price': round(exit_price, 4) if exit_price is not None else None,
        'exit_date': exit_date,
        'pnl_pct': pnl_pct,
        'hit_target': 1 if hit_target else 0,
        'hit_stop': 1 if hit_stop else 0,
        'holding_days': max(holding, 0),
        'max_price': round(max_price, 4) if max_price else None,
        'min_price': round(min_price, 4) if min_price else None,
    }


# ---------------------------------------------------------------------------
# Process persona_predictions table
# ---------------------------------------------------------------------------
def close_persona_predictions(expire_days: int, dry_run: bool,
                              ticker_filter: str = None) -> dict:
    log("=== Processing persona_predictions (status='PENDING') ===")
    if not os.path.exists(PREDICTIONS_DB):
        log(f"  ERROR: {PREDICTIONS_DB} not found")
        return {'error': 'predictions.db not found'}

    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    if ticker_filter:
        rows = cur.execute(
            "SELECT * FROM persona_predictions WHERE status='PENDING' AND ticker=? "
            "ORDER BY prediction_date DESC",
            (ticker_filter.upper(),)
        ).fetchall()
    else:
        rows = cur.execute(
            "SELECT * FROM persona_predictions WHERE status='PENDING' "
            "ORDER BY prediction_date DESC"
        ).fetchall()

    log(f"  Found {len(rows)} PENDING persona predictions")
    stats = {'total': len(rows), 'closed': 0, 'target_hit': 0,
             'stopped_out': 0, 'expired': 0, 'still_pending': 0,
             'no_price_data': 0, 'errors': 0}

    for i, row in enumerate(rows):
        pred = dict(row)
        ticker = pred.get('ticker', '')
        entry = pred.get('entry_price') or 0
        target = pred.get('target_price')
        stop = pred.get('stop_loss')
        signal = pred.get('signal_type') or 'HOLD'
        pred_date = pred.get('prediction_date') or ''

        if entry <= 0:
            stats['errors'] += 1
            continue

        prices = load_price_history(ticker)
        if not prices:
            stats['no_price_data'] += 1
            continue

        result = evaluate_prediction(
            entry=entry, target=target, stop=stop,
            signal_type=signal, pred_date=pred_date,
            prices=prices, expire_days=expire_days
        )

        status = result['status']
        if status == 'PENDING':
            stats['still_pending'] += 1
            continue

        stats['closed'] += 1
        if status == 'TARGET_HIT':
            stats['target_hit'] += 1
        elif status == 'STOPPED_OUT':
            stats['stopped_out'] += 1
        elif status == 'EXPIRED':
            stats['expired'] += 1

        if not dry_run:
            try:
                cur.execute(
                    "UPDATE persona_predictions SET status=?, final_price=?, "
                    "profit_loss_percent=?, hit_target=?, hit_stop_loss=? WHERE id=?",
                    (status, result['exit_price'], result['pnl_pct'],
                     result['hit_target'], result['hit_stop'], pred['id'])
                )
            except Exception as e:
                log(f"  UPDATE error for {pred['id']}: {e}")
                stats['errors'] += 1

        if i < 5 or status in ('TARGET_HIT', 'STOPPED_OUT'):
            log(f"  {ticker} ({signal}) entry={entry} target={target} stop={stop} "
                f"→ {status} exit={result['exit_price']} pnl={result['pnl_pct']}%")

    if not dry_run:
        conn.commit()
    conn.close()
    log(f"  persona_predictions done: {json.dumps(stats, ensure_ascii=False)}")
    return stats


# ---------------------------------------------------------------------------
# Process predictions table (master analyzer picks)
# ---------------------------------------------------------------------------
def close_master_predictions(expire_days: int, dry_run: bool,
                             ticker_filter: str = None) -> dict:
    log("=== Processing predictions (outcome_date IS NULL) ===")
    if not os.path.exists(PREDICTIONS_DB):
        return {'error': 'predictions.db not found'}

    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    if ticker_filter:
        rows = cur.execute(
            "SELECT * FROM predictions WHERE outcome_date IS NULL AND ticker=? "
            "ORDER BY prediction_date DESC",
            (ticker_filter.upper(),)
        ).fetchall()
    else:
        rows = cur.execute(
            "SELECT * FROM predictions WHERE outcome_date IS NULL "
            "ORDER BY prediction_date DESC"
        ).fetchall()

    log(f"  Found {len(rows)} OPEN master predictions")
    stats = {'total': len(rows), 'closed': 0, 'target_hit': 0,
             'stopped_out': 0, 'expired': 0, 'still_pending': 0,
             'no_price_data': 0, 'errors': 0}

    for i, row in enumerate(rows):
        pred = dict(row)
        ticker = pred.get('ticker', '')
        entry = pred.get('entry_price') or 0
        target = pred.get('target_price')
        stop = pred.get('stop_loss')
        signal = pred.get('signal_type') or pred.get('signal') or 'HOLD'
        pred_date = pred.get('prediction_date') or ''

        if entry <= 0:
            stats['errors'] += 1
            continue

        prices = load_price_history(ticker)
        if not prices:
            stats['no_price_data'] += 1
            continue

        result = evaluate_prediction(
            entry=entry, target=target, stop=stop,
            signal_type=signal, pred_date=pred_date,
            prices=prices, expire_days=expire_days
        )

        status = result['status']
        if status == 'PENDING':
            stats['still_pending'] += 1
            continue

        stats['closed'] += 1
        if status == 'TARGET_HIT':
            stats['target_hit'] += 1
        elif status == 'STOPPED_OUT':
            stats['stopped_out'] += 1
        elif status == 'EXPIRED':
            stats['expired'] += 1

        if not dry_run:
            try:
                now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                is_correct = None
                if status in ('TARGET_HIT',):
                    is_correct = 1
                elif status in ('STOPPED_OUT',):
                    is_correct = 0
                elif status == 'EXPIRED':
                    is_correct = 1 if (result['pnl_pct'] or 0) > 0 else 0

                cur.execute(
                    "UPDATE predictions SET outcome_date=?, exit_price=?, "
                    "actual_return=?, hit_target=?, hit_stop=?, is_correct=?, "
                    "holding_days=? WHERE id=?",
                    (now, result['exit_price'], result['pnl_pct'],
                     result['hit_target'], result['hit_stop'], is_correct,
                     result['holding_days'], pred['id'])
                )
            except Exception as e:
                log(f"  UPDATE error for pred {pred['id']}: {e}")
                stats['errors'] += 1

        if i < 5 or status in ('TARGET_HIT', 'STOPPED_OUT'):
            log(f"  {ticker} ({signal}) entry={entry} target={target} stop={stop} "
                f"→ {status} exit={result['exit_price']} pnl={result['pnl_pct']}%")

    if not dry_run:
        conn.commit()
    conn.close()
    log(f"  predictions done: {json.dumps(stats, ensure_ascii=False)}")
    return stats


# ---------------------------------------------------------------------------
# Process aiPrediction table (AI-generated predictions shown on credibility page)
# ---------------------------------------------------------------------------

DEAD_PREDICTION_DAYS = 30     # Only expire if price is dead for 30+ days
DEAD_PRICE_THRESHOLD = 0.02   # ±2% from entry = "dead"
TRAILING_STOP_TRIGGER = 0.75  # Activate trailing stop at 75% of target distance
TRAILING_STOP_OFFSET = 0.50   # Trail at 50% of achieved profit

# Markets with NO real price data — these predictions should be REJECTED by sanity gate
HIDDEN_MARKETS = ['الكويت', 'قطر', 'السعودية', 'السعوديه', 'KSE', 'QSE', 'TADAWUL', 'Kuwait', 'Qatar', 'Saudi Arabia', 'Saudi']


def is_price_dead(future_prices: list, entry_price: float, is_buy: bool) -> tuple:
    """Check if price has been flat (±2%) for 30+ days.
    Returns (dead: bool, reason: str)
    """
    if len(future_prices) < 20:
        return False, 'insufficient_data'

    recent = future_prices[-30:]
    max_high = max((p.get('high') or p.get('close') or 0) for p in recent)
    min_low = min((p.get('low') or p.get('close') or entry_price) for p in recent
                  if (p.get('low') or p.get('close') or 0) > 0)

    if entry_price > 0:
        upper = entry_price * (1 + DEAD_PRICE_THRESHOLD)
        lower = entry_price * (1 - DEAD_PRICE_THRESHOLD)
        if max_high <= upper and min_low >= lower:
            return True, f'price_dead_30d (range: {min_low:.2f}-{max_high:.2f}, entry: {entry_price:.2f})'

    return False, 'price_active'


def calculate_trailing_stop(entry_price: float, target_price: float,
                            stop_loss: float, current_price: float,
                            is_buy: bool) -> float | None:
    """Calculate trailing stop price. Returns None if trailing not triggered."""
    if not target_price or target_price <= 0 or not stop_loss or stop_loss <= 0:
        return None
    if entry_price <= 0:
        return None

    if is_buy:
        target_dist = target_price - entry_price
        achieved = current_price - entry_price
        progress = achieved / target_dist if target_dist > 0 else 0
        if progress >= TRAILING_STOP_TRIGGER:
            trail = entry_price + (achieved * TRAILING_STOP_OFFSET)
            return max(trail, stop_loss)
    else:
        target_dist = entry_price - target_price
        achieved = entry_price - current_price
        progress = achieved / target_dist if target_dist > 0 else 0
        if progress >= TRAILING_STOP_TRIGGER:
            trail = entry_price - (achieved * TRAILING_STOP_OFFSET)
            return min(trail, stop_loss)

    return None


def close_ai_predictions(expire_days: int, dry_run: bool,
                         ticker_filter: str = None) -> dict:
    """Process aiPrediction table — PRICE-BASED closing (not time-based!)."""
    log("=== Processing aiPrediction (status='PENDING') — PRICE-BASED ===")
    if not os.path.exists(PREDICTIONS_DB):
        log(f"  ERROR: {PREDICTIONS_DB} not found")
        return {'error': 'predictions.db not found'}

    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Filter out hidden markets
    market_exclude = " AND market NOT IN ({})".format(
        ','.join(["'{}'".format(m) for m in HIDDEN_MARKETS])
    )

    if ticker_filter:
        rows = cur.execute(
            f"SELECT * FROM aiPrediction WHERE status='PENDING' AND stock_symbol=? {market_exclude} "
            "ORDER BY prediction_date ASC",
            (ticker_filter.upper(),)
        ).fetchall()
    else:
        rows = cur.execute(
            f"SELECT * FROM aiPrediction WHERE status='PENDING' {market_exclude} "
            "ORDER BY prediction_date ASC"
        ).fetchall()

    log(f"  Found {len(rows)} PENDING aiPrediction (excluded hidden markets)")
    stats = {'total': len(rows), 'closed': 0, 'target_hit': 0,
             'stopped': 0, 'expired': 0, 'still_pending': 0,
             'trailing_stop': 0, 'no_price_data': 0, 'errors': 0}

    for i, row in enumerate(rows):
        pred = dict(row)
        ticker = pred.get('stock_symbol', '')
        # Strip .SR suffix for TADAWUL
        base_ticker = ticker.split('.')[0] if '.' in ticker else ticker
        entry = pred.get('entry_price') or 0
        target = pred.get('target_price')
        stop = pred.get('stop_loss')
        signal = pred.get('signal_type') or 'HOLD'
        pred_date = pred.get('prediction_date') or ''

        if entry <= 0:
            stats['errors'] += 1
            continue

        # Skip if stop_loss is 0 (invalid prediction)
        if not stop or stop <= 0:
            stats['errors'] += 1
            continue

        # Skip if target is insane (>50% gain for EGX, >100% for any)
        if target and entry > 0:
            target_pct = ((target - entry) / entry) * 100
            if target_pct > 100:
                # Mark as REJECTED — insane target
                if not dry_run:
                    try:
                        cur.execute(
                            "UPDATE aiPrediction SET status='REJECTED', "
                            "notes=?, "
                            "updated_at=datetime('now') WHERE id=?",
                            (f'Insane target ({target_pct:.0f}%) — rejected by close engine', pred['id'])
                        )
                    except Exception as e:
                        log(f"  REJECT error for {pred['id']}: {e}")
                stats['errors'] += 1
                continue

        prices = load_price_history(base_ticker)
        if not prices:
            stats['no_price_data'] += 1
            continue

        # Get future prices (after prediction date)
        pred_d = pred_date.strip()[:10]  # YYYY-MM-DD
        future = [p for p in prices if p['date'] >= pred_d]

        if not future:
            stats['no_price_data'] += 1
            continue

        # Determine direction
        is_buy = signal.upper() in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'LONG')
        is_sell = signal.upper() in ('SELL', 'STRONG_SELL', 'REDUCE', 'SHORT')

        current_price = future[-1].get('close') or future[-1].get('open') or entry

        # Track max profit/loss
        max_profit_pct = 0
        max_loss_pct = 0
        for p in future:
            hi = p.get('high') or p.get('close') or entry
            lo = p.get('low') or p.get('close') or entry
            if is_buy:
                profit_pct = ((hi - entry) / entry) * 100 if entry > 0 else 0
                loss_pct = ((lo - entry) / entry) * 100 if entry > 0 else 0
            elif is_sell:
                profit_pct = ((entry - lo) / entry) * 100 if entry > 0 else 0
                loss_pct = ((entry - hi) / entry) * 100 if entry > 0 else 0
            else:
                continue
            if profit_pct > max_profit_pct:
                max_profit_pct = profit_pct
            if loss_pct < max_loss_pct:
                max_loss_pct = loss_pct

        status = 'PENDING'
        exit_price = None
        exit_date = None
        close_reason = ''

        # STEP 1: Walk forward to check target/stop hit
        for p in future:
            hi = p.get('high') or p.get('close') or 0
            lo = p.get('low') or p.get('close') or 0
            if hi <= 0 or lo <= 0:
                continue

            if is_buy:
                if target and hi >= target:
                    status = 'TARGET_HIT'
                    exit_price = target
                    exit_date = p['date']
                    close_reason = 'price_hit_target'
                    break
                if lo <= stop:
                    status = 'STOPPED'
                    exit_price = stop
                    exit_date = p['date']
                    close_reason = 'price_hit_stop'
                    break
            elif is_sell:
                if target and lo <= target:
                    status = 'TARGET_HIT'
                    exit_price = target
                    exit_date = p['date']
                    close_reason = 'price_hit_target'
                    break
                if hi >= stop:
                    status = 'STOPPED'
                    exit_price = stop
                    exit_date = p['date']
                    close_reason = 'price_hit_stop'
                    break

        # STEP 2: Trailing stop check
        if status == 'PENDING' and is_buy:
            trail_price = calculate_trailing_stop(entry, target, stop, current_price, True)
            if trail_price and current_price <= trail_price:
                status = 'STOPPED'
                exit_price = current_price
                exit_date = future[-1]['date']
                close_reason = f'trailing_stop (trail={trail_price:.2f}, price={current_price:.2f})'
                stats['trailing_stop'] += 1
        elif status == 'PENDING' and is_sell:
            trail_price = calculate_trailing_stop(entry, target, stop, current_price, False)
            if trail_price and current_price >= trail_price:
                status = 'STOPPED'
                exit_price = current_price
                exit_date = future[-1]['date']
                close_reason = f'trailing_stop (trail={trail_price:.2f}, price={current_price:.2f})'
                stats['trailing_stop'] += 1

        # STEP 3: Dead price check — ONLY if truly flat for 30+ days
        if status == 'PENDING':
            try:
                pred_dt = datetime.strptime(pred_d, '%Y-%m-%d')
                age_days = (datetime.now() - pred_dt).days
            except Exception:
                age_days = 0

            if age_days >= DEAD_PREDICTION_DAYS:
                dead, reason = is_price_dead(future, entry, is_buy)
                if dead:
                    status = 'EXPIRED'
                    exit_price = current_price
                    exit_date = future[-1]['date']
                    close_reason = reason

        # If still pending, keep tracking
        if status == 'PENDING':
            stats['still_pending'] += 1
            continue

        # Calculate P&L
        pnl_pct = None
        if exit_price and entry > 0:
            if is_sell:
                pnl_pct = round(((entry - exit_price) / entry) * 100, 2)
            else:
                pnl_pct = round(((exit_price - entry) / entry) * 100, 2)

        # Calculate days to outcome
        try:
            pred_dt = datetime.strptime(pred_d, '%Y-%m-%d')
            exit_dt = datetime.strptime(exit_date, '%Y-%m-%d') if exit_date else datetime.now()
            days_to_target = (exit_dt - pred_dt).days
        except Exception:
            days_to_target = None

        stats['closed'] += 1
        if status == 'TARGET_HIT':
            stats['target_hit'] += 1
        elif status == 'STOPPED':
            stats['stopped'] += 1
        elif status == 'EXPIRED':
            stats['expired'] += 1

        if not dry_run:
            try:
                cur.execute(
                    """UPDATE aiPrediction SET
                       status=?, final_price=?, profit_loss_percent=?, actual_return=?,
                       hit_target=?, hit_stop_loss=?, days_to_target=?,
                       target_hit_date=?, stop_hit_date=?, evaluation_date=?,
                       max_profit_percent=?, max_loss_percent=?, updated_at=datetime('now')
                       WHERE id=?""",
                    (status, exit_price, pnl_pct, pnl_pct,
                     1 if status == 'TARGET_HIT' else 0,
                     1 if status == 'STOPPED' else 0,
                     days_to_target,
                     exit_date if status == 'TARGET_HIT' else None,
                     exit_date if status == 'STOPPED' else None,
                     exit_date,
                     round(max_profit_pct, 2), round(max_loss_pct, 2),
                     pred['id'])
                )
            except Exception as e:
                log(f"  UPDATE error for {pred['id']}: {e}")
                stats['errors'] += 1

        if i < 5 or status in ('TARGET_HIT', 'STOPPED'):
            log(f"  {ticker} ({signal}) entry={entry} target={target} stop={stop} "
                f"→ {status} exit={exit_price} pnl={pnl_pct}% reason={close_reason}")

    # Also reject predictions with hidden markets (KSE/QSE)
    if not dry_run:
        for market_name in HIDDEN_MARKETS:
            try:
                cur.execute(
                    "UPDATE aiPrediction SET status='REJECTED', "
                    "notes='Hidden market — no real price data', "
                    "updated_at=datetime('now') "
                    "WHERE status='PENDING' AND market=?",
                    (market_name,)
                )
            except Exception as e:
                log(f"  REJECT hidden market error: {e}")

    if not dry_run:
        conn.commit()
    conn.close()
    log(f"  aiPrediction done: {json.dumps(stats, ensure_ascii=False)}")
    return stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description='Close open predictions')
    parser.add_argument('--dry-run', action='store_true',
                        help='Report only, no DB writes')
    parser.add_argument('--table', choices=['persona', 'master', 'ai', 'all'],
                        default='all', help='Which table to process')
    parser.add_argument('--expire-days', type=int, default=30,
                        help='Days after which a prediction expires (default: 30)')
    parser.add_argument('--ticker', type=str, default=None,
                        help='Process only this ticker (debug)')
    args = parser.parse_args()

    log(f"Starting — dry_run={args.dry_run} table={args.table} "
        f"expire_days={args.expire_days} ticker={args.ticker or 'ALL'}")
    log(f"DB_DIR={DB_DIR}")

    start = datetime.now()
    results = {}

    if args.table in ('persona', 'all'):
        results['persona'] = close_persona_predictions(
            expire_days=args.expire_days, dry_run=args.dry_run,
            ticker_filter=args.ticker)

    if args.table in ('master', 'all'):
        results['master'] = close_master_predictions(
            expire_days=args.expire_days, dry_run=args.dry_run,
            ticker_filter=args.ticker)

    if args.table in ('ai', 'all'):
        results['ai'] = close_ai_predictions(
            expire_days=args.expire_days, dry_run=args.dry_run,
            ticker_filter=args.ticker)

    elapsed = (datetime.now() - start).total_seconds()
    log(f"Done in {elapsed:.1f}s")
    print(json.dumps({'success': True, 'elapsed_seconds': elapsed,
                       'results': results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
