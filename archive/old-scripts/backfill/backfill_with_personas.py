#!/usr/bin/env python3
"""
Backfill Historical Predictions using CoreScoringEngine + Maestro Persona Engines
=================================================================================
يولّد توقعات تاريخية باستخدام CoreScoringEngine (تحليل فني+مالي+أساسي+معنوي+حجم+شموع)
+ persona_gambler + persona_investor — لكل الأسواق (EGX, TADAWUL, KSE, QSE).

يقرأ price_history.db و stocks.db وبيبني حالة السهم AS OF كل يوم تداول،
يشغّل المحركات الكاملة، ويخزّن التوقعات في predictions table مع حقل market.

Usage:
    cd vps-service
    python3 scripts/backfill_with_personas.py --days 180 --per-day 15 --markets EGX TADAWUL KSE QSE
"""

import os
import sys
import sqlite3
import uuid
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))

STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')

from analyzers.persona_gambler import analyze_gambler
from analyzers.persona_investor import analyze_investor
from config.unified_config import MARKET_PROFILES, PERSONA_PROFILES


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


# ============================================================================
# VOLUME PARSER (RL-FIX-12: defensive against formatted strings like '70.01 K')
# ============================================================================

def parse_volume(val) -> int:
    """Parse volume that may be a formatted string like '70.01 K' (with narrow
    no-break space \\u202f), '1.5M', '2.3B', or a raw int/float.
    Handles all whitespace variants (regular, nbsp \\xa0, narrow nbsp \\u202f,
    thin spaces) and digit-group commas. Returns 0 for None/empty/unparseable.
    Never raises — safe to call on any DB value.
    """
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip()
    if not s:
        return 0
    # Strip ALL whitespace variants + digit-group commas.
    s = ''.join(ch for ch in s if ch not in ' \xa0\u202f\u2009\u2007\u2008,')
    if not s:
        return 0
    s = s.upper()
    multiplier = 1
    if s.endswith('K'):
        multiplier, s = 1_000, s[:-1]
    elif s.endswith('M'):
        multiplier, s = 1_000_000, s[:-1]
    elif s.endswith('B'):
        multiplier, s = 1_000_000_000, s[:-1]
    elif s.endswith('T'):
        multiplier, s = 1_000_000_000_000, s[:-1]
    try:
        return int(float(s) * multiplier)
    except (ValueError, TypeError):
        return 0


# ============================================================================
# INDICATORS (from price history)
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


def compute_macd(closes: List[float]) -> Optional[Dict]:
    if len(closes) < 26:
        return None
    ema12 = compute_ema(closes, 12)
    ema26 = compute_ema(closes, 26)
    if ema12 is None or ema26 is None:
        return None
    macd_line = ema12 - ema26
    # signal line: 9-period EMA of MACD line (simplified)
    signal_line = macd_line
    return {'macd': round(macd_line, 4), 'signal': round(signal_line, 4),
            'histogram': round(macd_line - signal_line, 4)}


def compute_ema(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    k = 2 / (period + 1)
    ema = closes[0]
    for price in closes[1:]:
        ema = price * k + ema * (1 - k)
    return round(ema, 4)


def compute_atr(prices: List[Dict], period: int = 14) -> float:
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


def compute_bollinger(closes: List[float], period: int = 20, std_dev: float = 2.0) -> Optional[Dict]:
    if len(closes) < period:
        return None
    ma = sum(closes[-period:]) / period
    variance = sum((c - ma) ** 2 for c in closes[-period:]) / period
    std = variance ** 0.5
    return {
        'upper': round(ma + std_dev * std, 4),
        'middle': round(ma, 4),
        'lower': round(ma - std_dev * std, 4),
        'width_pct': round((2 * std_dev * std) / ma * 100, 2) if ma > 0 else 0
    }


def detect_candle_pattern(prices: List[Dict]) -> Optional[str]:
    """Detect simple candlestick patterns from the last 3 candles."""
    if len(prices) < 3:
        return None
    last = prices[-1]
    prev = prices[-2]
    prev2 = prices[-3]
    o, c = float(last.get('open_price') or 0), float(last.get('close_price') or 0)
    po, pc = float(prev.get('open_price') or 0), float(prev.get('close_price') or 0)
    p2o, p2c = float(prev2.get('open_price') or 0), float(prev2.get('close_price') or 0)
    if o <= 0 or c <= 0:
        return None
    body = abs(c - o)
    total = abs(float(last.get('high_price') or 0) - float(last.get('low_price') or 0))
    if total <= 0:
        return None

    # Doji
    if body / total < 0.1:
        return 'DOJI'
    # Hammer
    lower_shadow = min(o, c) - float(last.get('low_price') or 0)
    upper_shadow = float(last.get('high_price') or 0) - max(o, c)
    if lower_shadow > body * 2 and upper_shadow < body * 0.5:
        return 'HAMMER'
    # Engulfing
    if (c > o and pc < po and c > po and o < pc):
        return 'BULLISH_ENGULFING'
    if (c < o and pc > po and c < po and o > pc):
        return 'BEARISH_ENGULFING'
    # Morning Star
    if p2c < p2o and body < total * 0.3 and c > o and c > (pc + po) / 2:
        return 'MORNING_STAR'
    return None


def compute_volume_profile(prices: List[Dict]) -> Dict:
    """Compute volume analysis: avg volume, volume trend, volume spike."""
    # RL-FIX-11a: أضفنا 'volume_ratio': 1.0 للـ early-return — كان ناقص فـ كان
    # بـ يسبب KeyError عند السطر 284 للأسهم اللي عندها أقل من 20 شمعة سعرية.
    if len(prices) < 20:
        return {'avg_volume': 0, 'volume_trend': 'neutral', 'volume_spike': False, 'volume_ratio': 1.0}
    # RL-FIX-12: use parse_volume() — volume may be a formatted string like '70.01 K'.
    recent_vols = [parse_volume(p.get('volume')) for p in prices[-20:]]
    older_vols = [parse_volume(p.get('volume')) for p in prices[-40:-20]] if len(prices) >= 40 else recent_vols
    avg_vol = sum(recent_vols) / len(recent_vols) if recent_vols else 0
    avg_old_vol = sum(older_vols) / len(older_vols) if older_vols else 0
    if avg_old_vol > 0:
        vol_ratio = avg_vol / avg_old_vol
    else:
        vol_ratio = 1.0
    trend = 'increasing' if vol_ratio > 1.3 else 'decreasing' if vol_ratio < 0.7 else 'neutral'
    spike = recent_vols[-1] > avg_vol * 2.5 if avg_vol > 0 else False
    return {'avg_volume': int(avg_vol), 'volume_trend': trend, 'volume_spike': spike, 'volume_ratio': round(vol_ratio, 2)}


def compute_stock_state_as_of(
    ticker: str,
    as_of_date: str,
    all_prices: List[Dict],
    base_stock: Dict,
) -> Optional[Dict]:
    """بناء حالة السهم AS OF تاريخ معين (no look-ahead) بمؤشرات كاملة."""
    prices_up_to = [p for p in all_prices if p['date'] <= as_of_date]
    if not prices_up_to:
        return None

    today = prices_up_to[-1]
    if today['date'] != as_of_date:
        return None  # No data for this exact date

    yesterday = prices_up_to[-2] if len(prices_up_to) >= 2 else today

    current_price = float(today.get('close_price') or 0)
    if current_price <= 0:
        return None

    prev_close = float(yesterday.get('close_price') or current_price)
    change_percent = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0
    volume = parse_volume(today.get('volume'))  # RL-FIX-12: handles '70.01 K' etc.

    closes = [float(p['close_price']) for p in prices_up_to
              if p.get('close_price') and p['close_price'] > 0]

    rsi = compute_rsi(closes, 14)
    ma_20 = compute_ma(closes, 20)
    ma_50 = compute_ma(closes, 50)
    ma_200 = compute_ma(closes, 200)
    macd_data = compute_macd(closes)
    bollinger = compute_bollinger(closes, 20, 2.0)
    vol_profile = compute_volume_profile(prices_up_to)
    candle_pattern = detect_candle_pattern(prices_up_to)

    # high_52w, low_52w
    last_252 = prices_up_to[-252:] if len(prices_up_to) >= 252 else prices_up_to
    highs_252 = [float(p['high_price']) for p in last_252 if p.get('high_price') and p['high_price'] > 0]
    lows_252 = [float(p['low_price']) for p in last_252 if p.get('low_price') and p['low_price'] > 0]
    high_52w = max(highs_252) if highs_252 else 0
    low_52w = min(lows_252) if lows_252 else 0

    # support / resistance (آخر 30 يوم)
    last_30 = prices_up_to[-30:] if len(prices_up_to) >= 30 else prices_up_to
    support = min(float(p['low_price']) for p in last_30 if p.get('low_price') and p['low_price'] > 0) if last_30 else 0
    resistance = max(float(p['high_price']) for p in last_30 if p.get('high_price') and p['high_price'] > 0) if last_30 else 0

    # change_1w, change_1m, change_1y
    change_1w = ((current_price - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 and closes[-6] > 0 else 0
    change_1m = ((current_price - closes[-22]) / closes[-22] * 100) if len(closes) >= 22 and closes[-22] > 0 else 0
    change_1y = ((current_price - closes[-252]) / closes[-252] * 100) if len(closes) >= 252 and closes[-252] > 0 else 0

    # Trend detection
    trend = 'SIDEWAYS'
    if ma_20 and ma_50 and ma_200:
        if current_price > ma_20 > ma_50 > ma_200:
            trend = 'BULLISH'
        elif current_price < ma_20 < ma_50 < ma_200:
            trend = 'BEARISH'
    elif ma_20 and ma_50:
        if current_price > ma_20 > ma_50:
            trend = 'BULLISH'
        elif current_price < ma_20 < ma_50:
            trend = 'BEARISH'

    # Position in range (from support/resistance)
    sr_range = resistance - support
    position_in_range = ((current_price - support) / sr_range * 100) if sr_range > 0 else 50

    # Fundamental data from stocks.db
    pe_ratio = float(base_stock.get('pe_ratio') or 0)
    pb_ratio = float(base_stock.get('pb_ratio') or 0)
    roe = float(base_stock.get('roe') or 0)
    debt_to_equity = float(base_stock.get('debt_to_equity') or 0)
    profit_margin = float(base_stock.get('profit_margin') or 0)
    dividend_yield = float(base_stock.get('dividend_yield') or 0)
    beta = float(base_stock.get('beta') or 1.0)

    # Build stock state dict (compatible with persona engines + full analysis)
    state = dict(base_stock)  # copy base fields (sector, pe_ratio, etc.)
    state['ticker'] = ticker
    state['current_price'] = current_price
    state['change_percent'] = round(change_percent, 4)
    state['volume'] = volume
    state['rsi'] = rsi
    state['ma_20'] = ma_20 or 0
    state['ma_50'] = ma_50 or 0
    state['ma_200'] = ma_200 or 0
    state['support_level'] = support
    state['resistance_level'] = resistance
    state['high_52w'] = high_52w
    state['low_52w'] = low_52w
    state['avg_volume'] = vol_profile['avg_volume']
    state['change_1w'] = round(change_1w, 2)
    state['change_1m'] = round(change_1m, 2)
    state['change_1y'] = round(change_1y, 2)
    state['trend'] = trend
    state['position_in_range'] = round(position_in_range, 2)
    state['macd'] = macd_data['macd'] if macd_data else None
    state['macd_signal'] = macd_data['signal'] if macd_data else None
    state['macd_histogram'] = macd_data['histogram'] if macd_data else None
    state['bollinger_upper'] = bollinger['upper'] if bollinger else None
    state['bollinger_middle'] = bollinger['middle'] if bollinger else None
    state['bollinger_lower'] = bollinger['lower'] if bollinger else None
    state['bollinger_width'] = bollinger['width_pct'] if bollinger else None
    state['volume_trend'] = vol_profile.get('volume_trend', 'neutral')
    state['volume_spike'] = vol_profile.get('volume_spike', False)
    # RL-FIX-11a: defensive .get() — علشان لو compute_volume_profile رجع dict
    # ناقص (بدون volume_ratio) ما بـ يـ crashش الـ backfill كله.
    state['volume_ratio'] = vol_profile.get('volume_ratio', 1.0)
    state['candle_pattern'] = candle_pattern
    state['pe_ratio'] = pe_ratio
    state['pb_ratio'] = pb_ratio
    state['roe'] = roe
    state['debt_to_equity'] = debt_to_equity
    state['profit_margin'] = profit_margin
    state['dividend_yield'] = dividend_yield
    state['beta'] = beta

    return state


# ============================================================================
# STORAGE
# ============================================================================

def store_prediction(conn, ticker, signal, entry, target, stop, pred_date,
                     persona_type, master_score, confidence, market='EGX',
                     state=None, analysis_details=None):
    """خزّن توقع في predictions table مع تفاصيل التحليل الكامل."""
    cur = conn.cursor()
    # RL-FIX-9: أضفنا persona في الـ dedup check (كان بـ يتجاهلها فـ كان بـ يتخطى
    # توقعات gambler/investor لو existed balanced prediction لنفس ticker+date).
    # كمان بنعمل normalize لـ persona_type: 'investor' → 'conservative' (الـ DB
    # بـ يستخدم conservative لكن الـ frontend بـ يستخدم investor).
    _db_persona = 'conservative' if persona_type == 'investor' else (persona_type or 'balanced')
    existing = cur.execute(
        'SELECT id FROM predictions WHERE ticker = ? AND prediction_date LIKE ? AND persona = ?',
        (ticker, f"{pred_date}%", _db_persona)
    ).fetchone()
    if existing:
        return False

    pred_id = str(uuid.uuid4())

    # Build comprehensive notes with all analysis details
    notes_parts = [f"persona={persona_type}", f"score={master_score}", f"conf={confidence}"]
    if state:
        if state.get('rsi') is not None:
            notes_parts.append(f"RSI={state['rsi']:.1f}")
        if state.get('support_level'):
            notes_parts.append(f"support={state['support_level']:.2f}")
        if state.get('resistance_level'):
            notes_parts.append(f"resistance={state['resistance_level']:.2f}")
        if state.get('trend'):
            notes_parts.append(f"trend={state['trend']}")
        if state.get('candle_pattern'):
            notes_parts.append(f"candle={state['candle_pattern']}")
        if state.get('macd_histogram') is not None:
            notes_parts.append(f"macd_h={state['macd_histogram']:.4f}")
        if state.get('volume_trend'):
            notes_parts.append(f"vol={state['volume_trend']}")
        if state.get('change_1m') is not None:
            notes_parts.append(f"chg1m={state['change_1m']:.2f}%")
        if state.get('pe_ratio') and state['pe_ratio'] > 0:
            notes_parts.append(f"PE={state['pe_ratio']:.1f}")
        if state.get('roe') and state['roe'] > 0:
            notes_parts.append(f"ROE={state['roe']:.1f}%")
        if state.get('bollinger_width') is not None:
            notes_parts.append(f"BBw={state['bollinger_width']:.1f}%")
    notes = "; ".join(notes_parts)

    # Build analysis_details JSON
    if analysis_details is None and state:
        analysis_details = {
            'technical_score': master_score,
            'fundamental_score': (50 if not state.get('pe_ratio') or state.get('pe_ratio', 0) <= 0 else
                                  min(100, max(10, 60 + (10 if state.get('roe', 0) > 15 else 0) -
                                              (10 if state.get('pe_ratio', 99) > 30 else 0)))),
            'ai_pattern_score': (master_score if state.get('candle_pattern') else 50),
            'sentiment_score': (55 if state.get('volume_spike') else 50),
            'rsi': state.get('rsi'),
            'macd_histogram': state.get('macd_histogram'),
            'trend': state.get('trend'),
            'candle_pattern': state.get('candle_pattern'),
            'volume_trend': state.get('volume_trend'),
            'volume_spike': state.get('volume_spike'),
            'support_level': state.get('support_level'),
            'resistance_level': state.get('resistance_level'),
            'pe_ratio': state.get('pe_ratio'),
            'pb_ratio': state.get('pb_ratio'),
            'roe': state.get('roe'),
            'debt_to_equity': state.get('debt_to_equity'),
            'profit_margin': state.get('profit_margin'),
            'dividend_yield': state.get('dividend_yield'),
            'beta': state.get('beta'),
            'change_1w': state.get('change_1w'),
            'change_1m': state.get('change_1m'),
            'change_1y': state.get('change_1y'),
            'bollinger_width': state.get('bollinger_width'),
            'position_in_range': state.get('position_in_range'),
            'atr': state.get('atr'),
        }
    analysis_json = json.dumps(analysis_details) if analysis_details else None

    # RL-FIX-9: أضفنا persona + target_price_2 للأعمدة (كانت ناقصة).
    # target_price_2: gambler=1.08x, balanced=1.20x, conservative=1.50x (نفس نسبة generate_persona_predictions).
    _target2_mult = {'gambler': 1.08, 'balanced': 1.20, 'conservative': 1.50, 'investor': 1.50}.get(_db_persona, 1.20)
    _target_price_2 = float(entry or 0) * _target2_mult if entry else None

    cur.execute('''
        INSERT INTO predictions
        (ticker, persona, signal, signal_type, prediction_date, entry_price, target_price, target_price_2,
         stop_loss, master_score, technical_score, fundamental_score,
         ai_pattern_score, sentiment_score, hit_target, hit_stop, is_correct,
         holding_days, notes, market, created_at, is_trend_following,
         trailing_stop_atr_mult, initial_stop_atr_mult, atr_at_entry)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, 0, ?, ?, ?, 0, 2.5, 2.0, ?)
    ''', (
        ticker, _db_persona, signal, signal, f"{pred_date} 12:00:00",
        entry, target, _target_price_2, stop,
        master_score,
        analysis_details.get('technical_score', master_score) if analysis_details else master_score,
        analysis_details.get('fundamental_score', 50) if analysis_details else 50,
        analysis_details.get('ai_pattern_score', 50) if analysis_details else 50,
        analysis_details.get('sentiment_score', 50) if analysis_details else 50,
        notes,
        market,
        f"{pred_date} 12:00:00",
        analysis_details.get('atr') if analysis_details else None,
    ))
    conn.commit()
    return True


# ============================================================================
# MAIN
# ============================================================================

def run_backfill(days_back: int = 180, per_day: int = 15, markets=None):
    # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
    # to write predictions. This one-off backfill script is disabled to prevent
    # contamination of the canonical prediction store.
    # To re-enable for manual backfill: comment out this guard.
    # Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
    return
    if markets is None:
        markets = ['EGX', 'TADAWUL', 'KSE', 'QSE']

    log(f"🧠 Backfill with REAL Maestro Persona Engines")
    log(f"   Days back: {days_back}")
    log(f"   Per day: {per_day}")
    log(f"   Markets: {markets}")
    log("")

    # 1. Load base stock data from stocks.db (sector, pe_ratio, etc.)
    log(f"Loading base stock data from stocks.db...")
    stocks_conn = sqlite3.connect(STOCKS_DB)
    stocks_conn.row_factory = sqlite3.Row
    placeholders = ','.join('?' * len(markets))
    cur = stocks_conn.cursor()
    cur.execute(f'''
        SELECT ticker, name_ar, market, sector, pe_ratio, pb_ratio, roe, roa,
               debt_to_equity, book_value_per_share, dividend_yield, beta,
               profit_margin, eps
        FROM stocks
        WHERE is_active = 1 AND market IN ({placeholders})
    ''', markets)
    base_stocks = {r['ticker']: dict(r) for r in cur.fetchall()}
    log(f"   Loaded {len(base_stocks)} base stocks")
    stocks_conn.close()

    # 2. Load all price history from price_history.db
    log(f"Loading price history from price_history.db...")
    ph_conn = sqlite3.connect(PRICE_HISTORY_DB)
    ph_conn.row_factory = sqlite3.Row
    cur = ph_conn.cursor()

    r = cur.execute('SELECT MIN(date), MAX(date), COUNT(DISTINCT date) FROM price_history').fetchone()
    log(f"   Price history: {r[0]} to {r[1]}, {r[2]} distinct dates")

    max_date = datetime.strptime(r[1], '%Y-%m-%d')
    start_date = max_date - timedelta(days=days_back)
    start_str = start_date.strftime('%Y-%m-%d')
    end_str = (max_date - timedelta(days=1)).strftime('%Y-%m-%d')  # leave 1 day for verification

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

    # Load all price data into memory (grouped by ticker)
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
    ph_conn.close()
    log(f"   Loaded {len(all_prices)} tickers")
    log("")

    # 3. Open predictions DB
    pred_conn = sqlite3.connect(PREDICTIONS_DB)

    # 4. Generate predictions using REAL persona engines
    total_buy = 0
    total_sell = 0
    total_hold = 0
    total_stored = 0
    total_skipped = 0

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
        day_skipped = 0

        # Collect candidates for this date
        candidates = []
        for ticker, prices in all_prices.items():
            if ticker not in base_stocks:
                continue
            state = compute_stock_state_as_of(ticker, date_str, prices, base_stocks[ticker])
            if not state:
                continue
            candidates.append({
                'ticker': ticker,
                'prices': prices,
                'state': state,
                'volume': state.get('volume', 0),
            })

        # Sort by volume (most active first) and take top per_day
        candidates.sort(key=lambda x: x['volume'], reverse=True)
        candidates = candidates[:per_day]

        for c in candidates:
            ticker = c['ticker']
            state = c['state']
            market = state.get('market', 'EGX')

            # Update context with computed values
            ctx = dict(context)
            ctx['time_context'] = {
                'change_1w': state.get('change_1w', 0),
                'change_1m': state.get('change_1m', 0),
                'change_1y': state.get('change_1y', 0),
            }

            stored_this = False

            # 🎲 Gambler persona
            try:
                g = analyze_gambler(ticker, state, ctx)
                if g.signal in ('BUY', 'SELL') and g.entry:
                    stored = store_prediction(
                        pred_conn, ticker, g.signal, g.entry, g.target, g.stop,
                        date_str, 'gambler', g.score, g.score,
                        market=market, state=state
                    )
                    if stored:
                        day_stored += 1
                        stored_this = True
                        if g.signal == 'BUY':
                            day_buy += 1
                        else:
                            day_sell += 1
                    else:
                        day_skipped += 1
                else:
                    day_hold += 1
            except Exception as e:
                pass

            # 💼 Investor persona (only if gambler didn't already store for this ticker+date)
            if not stored_this:
                try:
                    inv = analyze_investor(ticker, state, ctx)
                    if inv.signal in ('BUY', 'SELL') and inv.entry:
                        stored = store_prediction(
                            pred_conn, ticker, inv.signal, inv.entry, inv.target, inv.stop,
                            date_str, 'investor', inv.score, inv.score,
                            market=market, state=state
                        )
                        if stored:
                            day_stored += 1
                            if inv.signal == 'BUY':
                                day_buy += 1
                            else:
                                day_sell += 1
                        else:
                            day_skipped += 1
                    else:
                        day_hold += 1
                except Exception as e:
                    pass

        total_buy += day_buy
        total_sell += day_sell
        total_hold += day_hold
        total_stored += day_stored
        total_skipped += day_skipped

        if day_stored > 0:
            log(f"   {date_str}: stored={day_stored} (BUY={day_buy}, SELL={day_sell}, HOLD={day_hold}, skip={day_skipped})")

    pred_conn.close()

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
    print('[FINALIZE-UNIFICATION] GUARD: backfill_with_personas.py disabled (Rule 35). V40.2 (daily_predictor.py) is the only writer. Backtest simulation context does NOT bypass Rule 35 — use a replica DB to re-enable.')
    sys.exit(0)
    import argparse
    parser = argparse.ArgumentParser(description='Backfill with REAL Maestro persona engines + full analysis')
    parser.add_argument('--days', type=int, default=180, help='Number of days to backfill (default: 180)')
    parser.add_argument('--per-day', type=int, default=15, help='Max predictions per day (default: 15)')
    parser.add_argument('--markets', nargs='+', default=['EGX', 'TADAWUL', 'KSE', 'QSE'], help='Markets (default: EGX TADAWUL KSE QSE)')
    args = parser.parse_args()
    run_backfill(days_back=args.days, per_day=args.per_day, markets=args.markets)
