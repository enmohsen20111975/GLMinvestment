#!/usr/bin/env python3
"""
Backfill Historical Predictions
================================
🧠 الخبير v3: توليد توقعات تاريخية لآخر 30 يوم

المشكلة:
- كل التوقعات الحالية بتاريخ 2026-06-23 (اليوم)
- price_history بيوصل لـ 2026-06-10 فقط
- يبقى مفيش future data للتحقق → كل التوقعات PENDING للأبد

الحل:
- نولّد توقعات لكل يوم من 2026-05-01 لـ 2026-06-09
- لكل يوم، نحسب حالة السهم AS OF that date (سعر، RSI، MA، volume)
- نشغّل persona engines (gambler + investor)
- نخزّن التوقع بتاريخ ذلك اليوم
- الـ credibility route هيتحقق من كل توقع مقابل الأسعار اللي بعده → صفقات مغلقة

النتيجة:
- الصفقات اللي اتعملت في 2026-05-01 هتتحقق مقابل 30 يوم أسعار بعدها → TARGET_HIT / STOPPED / EXPIRED
- الصفقات الحديثة (2026-06-09) هتتحقق مقابل 1 يوم → لسة PENDING
- ده بيدي الـ credibility screen بيانات حقيقية لتقييم النظام
"""

import os
import sys
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional

# Setup paths
_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))

STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')

from analyzers.persona_gambler import analyze_gambler
from analyzers.persona_investor import analyze_investor

# ============================================================================
# RULE35-DISABLE (2026-10-12 — HIDDEN-WRITERS-AUDIT):
# ============================================================================
# This script was a ROGUE PATH that bypassed PREDICTION-WRITE-GUARD + Rule 35.
# It directly INSERTed into `persona_predictions` table using persona engines
# (gambler/investor) instead of V40.2 (daily_predictor.py).
#
# Rule 35 (ENGINE-UNIFY): V40.2 is the ONLY sanctioned prediction writer.
# Rule 27 (NO-FAKE-DATA): persona engines don't go through kill_filters +
#   6 evidences + R:R ≥ 1.5 + ATR clamp — they fabricate predictions.
# Rule 67 (CALCULATION-CANONICAL): persona_gambler + persona_investor are
#   NOT canonical — V40.2 is the canonical evidence-based engine.
#
# Was invoked on every deploy via deploy_vps.sh (now removed).
# ============================================================================

import sys as _sys
print("[RULE35-DISABLED] backfill_historical_predictions.py — ROGUE PATH blocked.", file=_sys.stderr)
print("  Reason: bypasses PREDICTION-WRITE-GUARD + uses persona engines (not V40.2).", file=_sys.stderr)
print("  Canonical: python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5", file=_sys.stderr)
print("  Rule 35 (ENGINE-UNIFY) + Rule 27 (NO-FAKE-DATA) + Rule 67 (CALCULATION-CANONICAL)", file=_sys.stderr)
_sys.exit(0)  # safe exit — do NOT run any code below

# ─── ORIGINAL CODE BELOW — preserved for reference (Rule 16 VERIFY-BEFORE-DELETE) ───
# The original 340-line implementation that INSERTed into persona_predictions
# is preserved below but UNREACHABLE due to the sys.exit(0) above.
# To re-enable: remove this guard block (NOT RECOMMENDED — violates Rule 35).

# ============================================================================
# PRICE HISTORY HELPERS
# ============================================================================

def load_all_price_history(ticker: str, conn: sqlite3.Connection) -> List[Dict]:
    """حمّل كل price history للسهم (مرتبة تصاعدياً)."""
    try:
        cur = conn.cursor()
        cur.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM stock_price_history
            WHERE ticker = ?
            ORDER BY date ASC
        ''', (ticker,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception:
        return []


def compute_rsi(closes: List[float], period: int = 14) -> float:
    """حساب RSI من قائمة أسعار الإغلاق."""
    if len(closes) < period + 1:
        return 0.0
    gains = []
    losses = []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
    if len(gains) < period:
        return 0.0
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return round(rsi, 2)


def compute_ma(closes: List[float], period: int) -> float:
    """حساب Moving Average."""
    if len(closes) < period:
        return 0.0
    return round(sum(closes[-period:]) / period, 4)


def compute_stock_state_as_of(
    ticker: str,
    as_of_date: str,
    all_prices: List[Dict],
    base_stock: Dict,
) -> Dict:
    """
    بناء حالة السهم AS OF تاريخ معين.
    نستخدم فقط بيانات price_history لغاية that date (no look-ahead).
    """
    # فلتر الأسعار لغاية as_of_date
    prices_up_to = [p for p in all_prices if p['date'] <= as_of_date]
    if not prices_up_to:
        return None

    today = prices_up_to[-1]
    yesterday = prices_up_to[-2] if len(prices_up_to) >= 2 else today

    current_price = float(today.get('close_price') or 0)
    if current_price <= 0:
        return None

    prev_close = float(yesterday.get('close_price') or current_price)
    change_percent = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0
    volume = int(today.get('volume') or 0)

    closes = [float(p['close_price']) for p in prices_up_to if p.get('close_price') and p['close_price'] > 0]

    rsi = compute_rsi(closes, 14)
    ma_50 = compute_ma(closes, 50)
    ma_200 = compute_ma(closes, 200)

    # high_52w, low_52w
    last_252 = closes[-252:] if len(closes) >= 252 else closes
    highs_252 = [float(p['high_price']) for p in prices_up_to[-252:] if p.get('high_price') and p['high_price'] > 0]
    lows_252 = [float(p['low_price']) for p in prices_up_to[-252:] if p.get('low_price') and p['low_price'] > 0]
    high_52w = max(highs_252) if highs_252 else 0
    low_52w = min(lows_252) if lows_252 else 0

    # support / resistance (آخر 30 يوم)
    last_30 = prices_up_to[-30:] if len(prices_up_to) >= 30 else prices_up_to
    support = min(float(p['low_price']) for p in last_30 if p.get('low_price') and p['low_price'] > 0) if last_30 else 0
    resistance = max(float(p['high_price']) for p in last_30 if p.get('high_price') and p['high_price'] > 0) if last_30 else 0

    # change_1w, change_1m
    if len(closes) >= 6:
        change_1w = ((current_price - closes[-6]) / closes[-6] * 100) if closes[-6] > 0 else 0
    else:
        change_1w = 0
    if len(closes) >= 22:
        change_1m = ((current_price - closes[-22]) / closes[-22] * 100) if closes[-22] > 0 else 0
    else:
        change_1m = 0

    # Build stock state dict (compatible with persona engines)
    state = dict(base_stock)  # copy base fields (sector, pe_ratio, etc.)
    state['ticker'] = ticker
    state['current_price'] = current_price
    state['change_percent'] = round(change_percent, 4)
    state['volume'] = volume
    state['rsi'] = rsi
    state['ma_50'] = ma_50
    state['ma_200'] = ma_200
    state['support_level'] = support
    state['resistance_level'] = resistance
    # Override avg_volume with computed (persona will compute from price_history anyway)
    state['avg_volume'] = 0  # persona will compute from price_history

    return state


# ============================================================================
# PREDICTION STORAGE
# ============================================================================

def store_prediction(
    conn: sqlite3.Connection,
    ticker: str,
    signal: str,
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    prediction_date: str,
    persona_type: str,
    market: str,
    master_score: float,
    confidence: float,
):
    """خزّن توقع في persona_predictions table."""
    cur = conn.cursor()
    pred_id = f"bf_{persona_type}_{ticker}_{prediction_date.replace('-', '')}_{uuid.uuid4().hex[:8]}"
    cur.execute('''
        INSERT INTO persona_predictions
        (id, ticker, market, persona_type, signal_type, entry_price, target_price,
         stop_loss, prediction_date, status, created_at, master_score, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    ''', (
        pred_id, ticker, market, persona_type, signal, entry_price, target_price,
        stop_loss, prediction_date, prediction_date + ' 12:00:00', master_score, confidence
    ))
    conn.commit()


# ============================================================================
# MAIN BACKFILL
# ============================================================================

def run_backfill(days_back: int = 30, markets: List[str] = None):
    """
    توليد توقعات تاريخية لآخر N يوم.
    """
    if markets is None:
        markets = ['EGX']  # نبدأ بـ EGX (فيها price history كاملة)

    print(f'🧠 الخبير v3: Backfill Historical Predictions')
    print(f'   Days back: {days_back}')
    print(f'   Markets: {markets}')
    print()

    # تحميل التواريخ المتاحة من price_history
    stocks_conn = sqlite3.connect(STOCKS_DB)
    stocks_conn.row_factory = sqlite3.Row

    # أحدث تاريخ في price_history
    cur = stocks_conn.cursor()
    cur.execute('SELECT MAX(date) as max_date FROM stock_price_history')
    max_date_row = cur.fetchone()
    max_date = max_date_row['max_date'] if max_date_row else None
    if not max_date:
        print('❌ مفيش price history على الإطلاق')
        return
    print(f'   Latest price date: {max_date}')

    # التواريخ اللي هنتولد لها توقعات (من max_date - days_back لـ max_date - 1)
    # نترك يوم واحد على الأقل بعد التوقع للتحقق
    end_date = datetime.strptime(max_date, '%Y-%m-%d') - timedelta(days=1)
    start_date = end_date - timedelta(days=days_back)

    # نجمع التواريخ المتاحة (أيام تداول فعلية)
    cur.execute('''
        SELECT DISTINCT date FROM stock_price_history
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC
    ''', (start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')))
    trading_dates = [r['date'] for r in cur.fetchall()]
    print(f'   Trading dates to backfill: {len(trading_dates)}')
    print(f'   Range: {trading_dates[0] if trading_dates else "N/A"} → {trading_dates[-1] if trading_dates else "N/A"}')
    print()

    if not trading_dates:
        print('❌ مفيش تواريخ تداول في النطاق المحدد')
        return

    # تحميل الأسهم النشطة
    placeholders = ','.join('?' * len(markets))
    cur.execute(f'''
        SELECT ticker, name_ar, market, sector, pe_ratio, pb_ratio, roe, roa,
               debt_to_equity, book_value_per_share
        FROM stocks
        WHERE is_active = 1 AND market IN ({placeholders})
    ''', markets)
    stocks = [dict(r) for r in cur.fetchall()]
    print(f'   Active stocks: {len(stocks)}')

    # preload price history لكل سهم
    print(f'   Loading price history for {len(stocks)} stocks...')
    price_history_map = {}
    for s in stocks:
        price_history_map[s['ticker']] = load_all_price_history(s['ticker'], stocks_conn)
    stocks_conn.close()
    print()

    # فتح predictions DB
    pred_conn = sqlite3.connect(PREDICTIONS_DB)

    # امسح التوقعات القديمة المعلّقة (PENDING) للأسواق المحددة
    # عشان ما يبقاش فيه تكرار
    cur = pred_conn.cursor()
    cur.execute('''
        DELETE FROM persona_predictions
        WHERE status = 'PENDING' AND market IN ({})
    '''.format(placeholders), markets)
    deleted = cur.rowcount
    pred_conn.commit()
    print(f'   Deleted old PENDING predictions: {deleted}')
    print()

    # توليد التوقعات
    total_buy = 0
    total_sell = 0
    total_hold = 0
    total_stored = 0

    context = {
        'time_context': {},
        'sector_context': {},
        'market_context': {'regime': 'SIDEWAYS'},
        'behavioral_context': {},
    }

    for date_str in trading_dates:
        day_buy = 0
        day_sell = 0
        day_hold = 0
        day_stored = 0

        for s in stocks:
            ticker = s['ticker']
            prices = price_history_map.get(ticker, [])
            if not prices:
                continue

            # بناء حالة السهم AS OF date_str
            state = compute_stock_state_as_of(ticker, date_str, prices, s)
            if not state:
                continue

            # تحديث context بالقيم المحسوبة
            ctx = dict(context)
            ctx['time_context'] = {
                'change_1w': state.get('change_percent', 0),  # fallback
                'change_1m': 0,
            }

            # 🎰 Gambler
            try:
                g = analyze_gambler(ticker, state, ctx)
                if g.signal in ('BUY', 'SELL') and g.entry:
                    store_prediction(
                        pred_conn, ticker, g.signal, g.entry, g.target, g.stop,
                        date_str, 'gambler', s.get('market', 'EGX'),
                        g.score, g.score,
                    )
                    day_stored += 1
                    if g.signal == 'BUY':
                        day_buy += 1
                    else:
                        day_sell += 1
                else:
                    day_hold += 1
            except Exception as e:
                pass

            # 💼 Investor
            try:
                inv = analyze_investor(ticker, state, ctx)
                if inv.signal in ('BUY', 'SELL') and inv.entry:
                    store_prediction(
                        pred_conn, ticker, inv.signal, inv.entry, inv.target, inv.stop,
                        date_str, 'investor', s.get('market', 'EGX'),
                        inv.score, inv.score,
                    )
                    day_stored += 1
                    if inv.signal == 'BUY':
                        day_buy += 1
                    else:
                        day_sell += 1
                else:
                    day_hold += 1
            except Exception as e:
                pass

        total_buy += day_buy
        total_sell += day_sell
        total_hold += day_hold
        total_stored += day_stored
        print(f'   {date_str}: stored={day_stored} (BUY={day_buy}, SELL={day_sell}, HOLD={day_hold})')

    pred_conn.close()

    print()
    print(f'✅ Backfill complete!')
    print(f'   Total stored: {total_stored}')
    print(f'   BUY: {total_buy}')
    print(f'   SELL: {total_sell}')
    print(f'   HOLD (not stored): {total_hold}')
    print()
    print(f'   التوقعات دي هتتحقق تلقائياً من الـ credibility route')
    print(f'   مقابل الأسعار اللي بعدها → هتطلع TARGET_HIT / STOPPED / EXPIRED')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Backfill historical predictions')
    parser.add_argument('--days', type=int, default=30, help='Number of days to backfill')
    parser.add_argument('--markets', nargs='+', default=['EGX'], help='Markets to backfill')
    args = parser.parse_args()
    run_backfill(days_back=args.days, markets=args.markets)
