#!/usr/bin/env python3
"""
Maestro Backfill V2 — Fast Phase 3 Backtest
=============================================
Uses persona engines (analyze_gambler/analyze_investor/analyze_screener) with Phase 3 filters
applied directly. Much faster than full MaestroOrchestrator but still tests all Phase 3 guards.

Phase 3 Filters Active:
  ✅ Sector Heat Veto (hot/dead/neutral sectors)
  ✅ Sector Role (leader/mid/laggard)
  ✅ Wash Trading Guard (volume spike + flat price → reject)
  ✅ Bear Market Guard (bear regime → disable gambler/balanced BUY)
  ✅ SMC Precision (max_ob_age=30 in smc_engine)

Plus:
  ✅ 3 Personas (gambler, balanced, conservative)
  ✅ ALL EGX stocks (dynamic per stock/sector)
  ✅ DailyCloser after backfill (close predictions)
  ✅ LearningEngine after backfill (learn from outcomes)

Usage:
    cd vps-service
    python3 scripts/maestro_backfill_v2.py --days 365 --markets EGX
    python3 scripts/maestro_backfill_v2.py --days 365 --markets EGX --clear
    python3 scripts/maestro_backfill_v2.py --days 365 --markets EGX --per-day 50
"""

import os
import sys
import sqlite3
import json
import time
import uuid
import gc
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from collections import Counter, defaultdict
from dataclasses import dataclass, field

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))

STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    prefix = {'INFO': 'ℹ️', 'VETO': '🚫', 'WASH': '🧹', 'BEAR': '🐻', 'SCORE': '📊',
              'STORE': '💾', 'ERROR': '❌', 'OK': '✅', 'PHASE': '🔒', 'REGIME': '🌍'}.get(level, '•')
    print(f"[{ts}] {prefix} {msg}", flush=True)


def parse_volume(val) -> int:
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip()
    if not s:
        return 0
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
    try:
        return int(float(s) * multiplier)
    except (ValueError, TypeError):
        return 0


# ============================================================================
# STOCK STATE BUILDER
# ============================================================================

def compute_stock_state_as_of(ticker, as_of_date, all_prices, base_stock):
    prices_up_to = [p for p in all_prices if p['date'] <= as_of_date]
    if not prices_up_to:
        return None
    today = prices_up_to[-1]
    if today['date'] != as_of_date:
        return None

    yesterday = prices_up_to[-2] if len(prices_up_to) >= 2 else today
    current_price = float(today.get('close_price') or 0)
    if current_price <= 0:
        return None

    prev_close = float(yesterday.get('close_price') or current_price)
    change_percent = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0
    volume = parse_volume(today.get('volume'))

    closes = [float(p['close_price']) for p in prices_up_to
              if p.get('close_price') and p['close_price'] > 0]

    # RSI
    rsi = 50.0
    if len(closes) > 14:
        gains, losses = [], []
        for i in range(1, len(closes)):
            change = closes[i] - closes[i - 1]
            gains.append(change if change > 0 else 0)
            losses.append(abs(change) if change < 0 else 0)
        if len(gains) >= 14:
            avg_gain = sum(gains[:14]) / 14
            avg_loss = sum(losses[:14]) / 14
            for g in gains[14:]:
                avg_gain = (avg_gain * 13 + g) / 14
            for l in losses[14:]:
                avg_loss = (avg_loss * 13 + l) / 14
            if avg_loss > 0:
                rs = avg_gain / avg_loss
                rsi = round(100 - (100 / (1 + rs)), 2)

    # Moving averages
    ma_20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else None
    ma_50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    ma_200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None

    # ATR
    atr = 0.0
    if len(prices_up_to) > 14:
        trs = []
        for i in range(1, min(len(prices_up_to), 15)):
            h = float(prices_up_to[-i].get('high_price') or 0)
            l = float(prices_up_to[-i].get('low_price') or 0)
            pc = float(prices_up_to[-i - 1].get('close_price') or 0)
            if h > 0 and l > 0:
                trs.append(max(h - l, abs(h - pc), abs(l - pc)))
        if trs:
            atr = round(sum(trs) / len(trs), 4)

    # Volume profile
    recent_vols = [parse_volume(p.get('volume')) for p in prices_up_to[-20:]]
    older_vols = [parse_volume(p.get('volume')) for p in prices_up_to[-40:-20]] if len(prices_up_to) >= 40 else recent_vols
    avg_vol = sum(recent_vols) / len(recent_vols) if recent_vols else 0
    avg_old_vol = sum(older_vols) / len(older_vols) if older_vols else 0
    vol_ratio = avg_vol / avg_old_vol if avg_old_vol > 0 else 1.0

    # Support / Resistance
    last_30 = prices_up_to[-30:] if len(prices_up_to) >= 30 else prices_up_to
    _lows = [float(p['low_price']) for p in last_30 if p.get('low_price') and p['low_price'] > 0]
    _highs = [float(p['high_price']) for p in last_30 if p.get('high_price') and p['high_price'] > 0]
    support = min(_lows) if _lows else 0
    resistance = max(_highs) if _highs else 0

    # Change periods
    change_1w = ((current_price - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 and closes[-6] > 0 else 0
    change_1m = ((current_price - closes[-22]) / closes[-22] * 100) if len(closes) >= 22 and closes[-22] > 0 else 0

    # Trend
    trend = 'SIDEWAYS'
    if ma_20 and ma_50:
        if current_price > ma_20 > ma_50:
            trend = 'BULLISH'
        elif current_price < ma_20 < ma_50:
            trend = 'BEARISH'

    # Candle pattern (simple)
    candle_pattern = None
    if len(prices_up_to) >= 2:
        o, c = float(today.get('open_price') or 0), current_price
        h = float(today.get('high_price') or 0)
        l = float(today.get('low_price') or 0)
        if o > 0 and h > 0 and l > 0:
            body = abs(c - o)
            total = h - l
            if total > 0 and body / total < 0.1:
                candle_pattern = 'DOJI'

    # Build state
    state = dict(base_stock)
    state.update({
        'ticker': ticker,
        'current_price': current_price,
        'change_percent': round(change_percent, 4),
        'volume': volume,
        'rsi': rsi,
        'ma_20': ma_20 or 0,
        'ma_50': ma_50 or 0,
        'ma_200': ma_200 or 0,
        'atr': atr,
        'support_level': support,
        'resistance_level': resistance,
        'avg_volume': int(avg_vol),
        'volume_ratio': round(vol_ratio, 2),
        'volume_trend': 'increasing' if vol_ratio > 1.3 else ('decreasing' if vol_ratio < 0.7 else 'neutral'),
        'volume_spike': recent_vols[-1] > avg_vol * 2.5 if avg_vol > 0 and recent_vols else False,
        'change_1w': round(change_1w, 2),
        'change_1m': round(change_1m, 2),
        'change_1d': round(change_percent, 2),
        'trend': trend,
        'candle_pattern': candle_pattern,
        'macd': None,
        'macd_signal': None,
        'macd_histogram': None,
        'bollinger_upper': None,
        'bollinger_middle': None,
        'bollinger_lower': None,
        'bollinger_width': None,
        'position_in_range': round(((current_price - support) / (resistance - support) * 100), 2) if resistance != support else 50,
        'pe_ratio': float(base_stock.get('pe_ratio') or 0),
        'pb_ratio': float(base_stock.get('pb_ratio') or 0),
        'roe': float(base_stock.get('roe') or 0),
        'debt_to_equity': float(base_stock.get('debt_to_equity') or 0),
        'profit_margin': float(base_stock.get('profit_margin') or 0),
        'dividend_yield': float(base_stock.get('dividend_yield') or 0),
        'beta': float(base_stock.get('beta') or 1.0),
    })
    return state


# ============================================================================
# PHASE 3: SECTOR HEAT MAP + ROLES
# ============================================================================

def compute_sector_heat_map(fundamentals_batch):
    sector_data = defaultdict(lambda: {'changes': [], 'volumes': []})
    for ticker, fund in fundamentals_batch.items():
        sector = fund.get('sector', 'Unknown') or 'Unknown'
        change_1d = fund.get('change_1d', 0) or 0
        volume = fund.get('volume', 0) or 0
        sector_data[sector]['changes'].append(change_1d)
        sector_data[sector]['volumes'].append(volume)

    heat_map = {}
    for sector, data in sector_data.items():
        n = len(data['changes'])
        if n == 0:
            continue
        avg_chg = sum(data['changes']) / n
        rising = sum(1 for c in data['changes'] if c > 0)
        falling = sum(1 for c in data['changes'] if c < 0)
        rising_ratio = rising / n if n > 0 else 0.5

        if rising_ratio >= 0.65 and avg_chg > 0.5:
            status = 'hot'
        elif rising_ratio <= 0.35 and avg_chg < -0.5:
            status = 'dead'
        else:
            status = 'neutral'

        heat_map[sector] = {
            'status': status, 'n': n, 'avg_chg': round(avg_chg, 2),
            'rising_ratio': round(rising_ratio, 2), 'rising': rising, 'falling': falling,
        }
    return heat_map


def classify_sector_roles(fundamentals_batch):
    sector_stocks = defaultdict(list)
    for ticker, fund in fundamentals_batch.items():
        sector = fund.get('sector', 'Unknown') or 'Unknown'
        change_1d = fund.get('change_1d', 0) or 0
        sector_stocks[sector].append((ticker, change_1d))

    roles = {}
    for sector, stocks in sector_stocks.items():
        if len(stocks) < 3:
            for ticker, _ in stocks:
                roles[ticker] = 'mid'
            continue
        stocks.sort(key=lambda x: x[1], reverse=True)
        top_n = max(1, len(stocks) // 3)
        bottom_n = max(1, len(stocks) // 3)
        for i, (ticker, _) in enumerate(stocks):
            if i < top_n:
                roles[ticker] = 'leader'
            elif i >= len(stocks) - bottom_n:
                roles[ticker] = 'laggard'
            else:
                roles[ticker] = 'mid'
    return roles


# ============================================================================
# PHASE 3: MARKET REGIME DETECTION
# ============================================================================

def detect_regime_at_date(ph_conn, target_date, tickers, lookback=30):
    try:
        cur = ph_conn.cursor()
        end_date = target_date
        start_date = (datetime.strptime(target_date, '%Y-%m-%d') - timedelta(days=lookback * 2)).strftime('%Y-%m-%d')

        changes = []
        for ticker in tickers[:30]:
            rows = cur.execute(
                'SELECT close_price, date FROM price_history WHERE ticker=? AND date BETWEEN ? AND ? ORDER BY date',
                (ticker, start_date, end_date)
            ).fetchall()
            if len(rows) >= 2:
                latest = float(rows[-1][0] or 0)
                oldest = float(rows[0][0] or 0)
                if oldest > 0:
                    changes.append((latest - oldest) / oldest * 100)

        if not changes:
            return {'regime': 'sideways', 'market_score': 50, 'reason': 'no_data'}

        avg_change = sum(changes) / len(changes)
        pos_count = sum(1 for c in changes if c > 0)
        pos_ratio = pos_count / len(changes)
        market_score = 50 + avg_change * 2 + (pos_ratio - 0.5) * 30
        market_score = max(0, min(100, market_score))

        if market_score >= 65:
            regime = 'bull'
        elif market_score <= 35:
            regime = 'bear'
        else:
            regime = 'sideways'

        import math
        volatility = math.sqrt(sum((c - avg_change) ** 2 for c in changes) / len(changes)) if changes else 0

        # P4-REGIME-FIX: ممنوع نـ override الـ bear/bull بـ volatile.
        # في السوق الهابط، الـ volatility بطبيعتها عالية → لو النظام رجع bear
        # يبقى bear فعلاً ومش نغيّره لـ volatile.
        # الـ volatile بس لما النظام sideways ومفيش اتجاه واضح بس فيه تذبذب.
        if volatility > 6 and regime not in ('bear', 'bull'):
            regime = 'volatile'

        return {
            'regime': regime, 'market_score': round(market_score, 1),
            'avg_change': round(avg_change, 2), 'breadth': f'{pos_count}/{len(changes)}',
            'volatility': round(volatility, 2),
        }
    except Exception as e:
        return {'regime': 'sideways', 'market_score': 50, 'reason': f'error: {e}'}


# ============================================================================
# PHASE 3: WASH TRADING DETECTION
# ============================================================================

def detect_wash_trading(state):
    volume_ratio = state.get('volume_ratio', 1.0) or 1.0
    change_1d = abs(state.get('change_percent', 0) or 0)
    if volume_ratio >= 2.0 and change_1d < 1.0:
        return {'is_wash_trading': True, 'reason': f'vol_ratio={volume_ratio:.1f}x but change={change_1d:.2f}%', 'penalty': 15.0}
    return {'is_wash_trading': False, 'reason': '', 'penalty': 0.0}


# ============================================================================
# PREDICTION STORAGE
# ============================================================================

def store_prediction(conn, ticker, signal, entry, target, stop, pred_date,
                     persona_type, score, confidence, market='EGX',
                     state=None, regime=None, sector_status=None, sector_role=None,
                     wash_trading=False, veto_reasons=None, risk_reward=None,
                     explosive_label=''):
    cur = conn.cursor()
    _db_persona = 'conservative' if persona_type == 'investor' else (persona_type or 'balanced')

    existing = cur.execute(
        'SELECT id FROM predictions WHERE ticker=? AND prediction_date LIKE ? AND persona=?',
        (ticker, f"{pred_date}%", _db_persona)
    ).fetchone()
    if existing:
        return False

    notes_parts = [f"persona={persona_type}", f"score={score}", f"conf={confidence:.1f}",
                   f"regime={regime or 'unknown'}", f"sector_status={sector_status or 'neutral'}",
                   f"sector_role={sector_role or 'mid'}"]
    if wash_trading:
        notes_parts.append("WASH_TRADING=1")
    if veto_reasons:
        notes_parts.append(f"veto={','.join(veto_reasons)}")
    if state:
        if state.get('rsi') is not None:
            notes_parts.append(f"RSI={state['rsi']:.1f}")
        if state.get('trend'):
            notes_parts.append(f"trend={state['trend']}")
    notes = "; ".join(notes_parts)

    analysis_details = {
        'score': score, 'confidence': confidence, 'regime': regime,
        'sector_status': sector_status, 'sector_role': sector_role,
        'is_wash_trading': wash_trading, 'veto_reasons': veto_reasons or [],
        'risk_reward': risk_reward,
    }
    if state:
        analysis_details.update({
            'rsi': state.get('rsi'), 'trend': state.get('trend'),
            'volume_ratio': state.get('volume_ratio'), 'volume_trend': state.get('volume_trend'),
            'change_1d': state.get('change_1d'), 'change_1m': state.get('change_1m'),
        })
    analysis_json = json.dumps(analysis_details)

    _target2_mult = {'gambler': 1.08, 'balanced': 1.20, 'conservative': 1.50}.get(_db_persona, 1.20)
    _target_price_2 = float(entry or 0) * _target2_mult if entry else None

    _rr = risk_reward if risk_reward else (
        round((float(target or 0) - float(entry or 0)) / (float(entry or 0) - float(stop or 0)), 2)
        if entry and target and stop and (entry - stop) != 0 else 0
    )

    try:
        cur.execute('''
            INSERT INTO predictions
            (ticker, persona, signal, signal_type, prediction_date, entry_price, target_price, target_price_2,
             stop_loss, master_score, technical_score, fundamental_score,
             ai_pattern_score, sentiment_score, maestro_score, confidence, risk_reward,
             hit_target, hit_stop, is_correct, holding_days, notes, market,
             created_at, analysis_json, is_trend_following,
             trailing_stop_atr_mult, initial_stop_atr_mult, atr_at_entry,
             explosive_label, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, 0, ?, ?, ?, ?, 0, 2.5, 2.0, ?, ?, 'active')
        ''', (
            ticker, _db_persona, signal, signal, f"{pred_date} 12:00:00",
            entry, target, _target_price_2, stop,
            score, score, 50, 50, 50,
            score, confidence, _rr,
            notes, market,
            f"{pred_date} 12:00:00",
            analysis_json,
            state.get('atr') if state else None,
            explosive_label,
        ))
        conn.commit()
        return True
    except Exception as e:
        try:
            conn.rollback()
        except:
            pass
        return False


# ============================================================================
# MAIN
# ============================================================================

@dataclass
class BackfillStats:
    total_stored: int = 0
    total_buy: int = 0
    total_sell: int = 0
    total_hold: int = 0
    total_skipped: int = 0
    total_veto_sector_dead: int = 0
    total_veto_bear_market: int = 0
    total_veto_wash_trading: int = 0
    total_wash_detected: int = 0
    total_bear_days: int = 0
    total_bull_days: int = 0
    total_sideways_days: int = 0
    persona_counts: Dict = None

    def __post_init__(self):
        if self.persona_counts is None:
            self.persona_counts = defaultdict(lambda: {'stored': 0, 'buy': 0, 'sell': 0, 'hold': 0, 'vetoed': 0})


def run_backfill(days_back=365, markets=None, per_day=0, clear_existing=False,
                 skip_closer=False, skip_learning=False,
                 min_price=1.0, min_volume=50000, min_score=0):
    if markets is None:
        markets = ['EGX']

    stats = BackfillStats()
    start_time = time.time()

    log("=" * 70, 'PHASE')
    log("MAESTRO BACKFILL V2 — Phase 3 Filters + Persona Engines", 'PHASE')
    log("=" * 70, 'PHASE')
    log(f"Days back: {days_back} | Markets: {markets} | Per day: {per_day or 'ALL'}")
    log(f"Min price: {min_price} | Min volume: {min_volume} | Min score: {min_score}")
    log("")

    # ─── LOAD DATA ───
    log("Loading base stock data...")
    stocks_conn = sqlite3.connect(STOCKS_DB)
    stocks_conn.row_factory = sqlite3.Row
    placeholders = ','.join('?' * len(markets))
    cur = stocks_conn.cursor()
    cur.execute(f'''SELECT ticker, name_ar, market, sector, pe_ratio, pb_ratio, roe, roa,
               debt_to_equity, book_value_per_share, dividend_yield, beta,
               profit_margin, eps FROM stocks WHERE is_active=1 AND market IN ({placeholders})''', markets)
    base_stocks = {r['ticker']: dict(r) for r in cur.fetchall()}
    stocks_conn.close()
    log(f"   {len(base_stocks)} stocks loaded")

    log("Loading price history...")
    ph_conn = sqlite3.connect(PRICE_HISTORY_DB)
    ph_conn.row_factory = sqlite3.Row
    cur = ph_conn.cursor()

    r = cur.execute('SELECT MIN(date), MAX(date), COUNT(DISTINCT date) FROM price_history').fetchone()
    max_date = datetime.strptime(r[1], '%Y-%m-%d')
    start_date = max_date - timedelta(days=days_back)
    start_str = start_date.strftime('%Y-%m-%d')
    end_str = (max_date - timedelta(days=1)).strftime('%Y-%m-%d')

    trading_dates = [row[0] for row in cur.execute(
        'SELECT DISTINCT date FROM price_history WHERE date BETWEEN ? AND ? ORDER BY date ASC',
        (start_str, end_str)).fetchall()]
    trading_dates = [d for d in trading_dates if datetime.strptime(d, '%Y-%m-%d').weekday() not in (4, 5)]

    log(f"   {len(trading_dates)} trading dates: {trading_dates[0]} → {trading_dates[-1]}")

    log("Loading all price data into memory...")
    all_prices = {}
    for row in cur.execute('SELECT ticker, date, open_price, high_price, low_price, close_price, volume FROM price_history ORDER BY ticker, date ASC').fetchall():
        d = dict(row)
        if d['ticker'] not in all_prices:
            all_prices[d['ticker']] = []
        all_prices[d['ticker']].append(d)

    eligible_tickers = set(base_stocks.keys()) & set(all_prices.keys())
    log(f"   {len(eligible_tickers)} eligible tickers")

    # Proxy tickers for regime detection
    proxy_tickers = list(eligible_tickers)[:50]

    # ─── CLEAR ───
    pred_conn = sqlite3.connect(PREDICTIONS_DB)
    if clear_existing:
        log("Clearing existing predictions...")
        pred_conn.execute('DELETE FROM predictions')
        pred_conn.commit()
        log("   Cleared", 'OK')

    # ─── IMPORT PERSONA ENGINES ───
    log("Importing persona engines...")
    try:
        from analyzers.persona_gambler import analyze_gambler
        from analyzers.persona_investor import analyze_investor
        log("   Persona engines loaded ✅", 'OK')
    except Exception as e:
        log(f"   Failed to import persona engines: {e}", 'ERROR')
        return

    # ─── MAIN LOOP ───
    log("")
    log("=" * 70, 'PHASE')
    log("STARTING BACKFILL — Phase 3 Filters ACTIVE", 'PHASE')
    log("=" * 70, 'PHASE')

    for date_idx, date_str in enumerate(trading_dates):
        day_start = time.time()
        day_buy = day_sell = day_hold = day_stored = day_skipped = day_vetoed = day_wash = 0

        # ── FUNDAMENTALS BATCH ──
        fundamentals_batch = {}
        for ticker in eligible_tickers:
            prices = all_prices[ticker]
            prices_up_to = [p for p in prices if p['date'] <= date_str]
            if not prices_up_to or prices_up_to[-1]['date'] != date_str:
                continue
            today = prices_up_to[-1]
            yesterday = prices_up_to[-2] if len(prices_up_to) >= 2 else today
            price = float(today.get('close_price') or 0)
            prev = float(yesterday.get('close_price') or price)
            change = ((price - prev) / prev * 100) if prev > 0 else 0
            volume = parse_volume(today.get('volume'))
            if price < min_price or volume < min_volume:
                continue
            fundamentals_batch[ticker] = {
                'sector': base_stocks[ticker].get('sector', 'Unknown') or 'Unknown',
                'change_1d': change, 'volume': volume, 'current_price': price,
            }

        # ── SECTOR HEAT MAP (Phase 3) ──
        heat_map = compute_sector_heat_map(fundamentals_batch)
        sector_roles = classify_sector_roles(fundamentals_batch)

        # ── MARKET REGIME (Phase 3 — Bear Guard) ──
        regime_info = detect_regime_at_date(ph_conn, date_str, proxy_tickers)
        regime = regime_info.get('regime', 'sideways')
        market_score = regime_info.get('market_score', 50)

        if regime == 'bear':
            stats.total_bear_days += 1
        elif regime == 'bull':
            stats.total_bull_days += 1
        else:
            stats.total_sideways_days += 1

        # ── SORT BY VOLUME ──
        candidates = sorted(fundamentals_batch.items(), key=lambda x: x[1].get('volume', 0), reverse=True)
        if per_day > 0:
            candidates = candidates[:per_day]

        # ── PROCESS EACH STOCK ──
        for ticker, fund in candidates:
            prices = all_prices[ticker]
            base = base_stocks[ticker]
            sector = base.get('sector', 'Unknown') or 'Unknown'

            state = compute_stock_state_as_of(ticker, date_str, prices, base)
            if not state:
                continue

            sector_status = heat_map.get(sector, {}).get('status', 'neutral')
            sector_role = sector_roles.get(ticker, 'mid')

            wash_result = detect_wash_trading(state)
            is_wash = wash_result['is_wash_trading']
            if is_wash:
                day_wash += 1
                stats.total_wash_detected += 1

            # ── RUN EACH PERSONA ──
            context = {
                'time_context': {'change_1w': state.get('change_1w', 0), 'change_1m': state.get('change_1m', 0)},
                'sector_context': {'sector_status': sector_status, 'sector_role': sector_role},
                'market_context': {'regime': regime.upper(), 'market_score': market_score},
                'behavioral_context': {},
            }

            for persona in ['gambler', 'balanced', 'conservative']:
                veto_reasons = []

                # Phase 3 veto checks
                if sector_status == 'dead' and sector_role != 'leader':
                    veto_reasons.append('sector_dead')
                if regime in ('bear', 'bear_trend', 'crash') and persona in ('gambler', 'balanced'):
                    veto_reasons.append('bear_market')
                if is_wash:
                    veto_reasons.append('wash_trading')

                # Run persona engine
                signal = 'HOLD'
                score = 0
                confidence = 0
                entry = state['current_price']
                target = None
                stop = None
                rr = 0
                explosive_label = ''

                try:
                    if persona == 'gambler':
                        result = analyze_gambler(ticker, state, context)
                    elif persona == 'conservative' or persona == 'investor':
                        result = analyze_investor(ticker, state, context)
                    else:  # balanced
                        # Run both, pick higher score
                        g = analyze_gambler(ticker, state, context)
                        i = analyze_investor(ticker, state, context)
                        result = g if (g.score or 0) >= (i.score or 0) else i

                    if result.signal in ('BUY', 'SELL') and result.entry:
                        signal = result.signal
                        score = result.score or 0
                        confidence = score  # Use score as confidence
                        entry = result.entry
                        target = result.target
                        stop = result.stop

                        # Compute R:R
                        if entry and target and stop and (entry - stop) != 0:
                            rr = round((target - entry) / (entry - stop), 2)
                            # Rule 54: استخدم canonical compute_risk_reward
                            try:
                                from utils.risk_reward import compute_risk_reward
                                rr = compute_risk_reward(entry, target, stop, fallback=rr)
                            except Exception:
                                pass  # keep inline rr computed above

                        # Explosive label
                        if score >= 70 and not veto_reasons:
                            explosive_label = 'explosive_uncap'
                        elif score >= 55 and not veto_reasons:
                            explosive_label = 'momentum_uncap'
                except Exception as e:
                    pass  # Silently skip on error

                # Apply Phase 3 vetoes
                if veto_reasons and signal == 'BUY':
                    signal = 'HOLD'
                    day_vetoed += 1
                    stats.persona_counts[persona]['vetoed'] += 1

                    if 'sector_dead' in veto_reasons:
                        stats.total_veto_sector_dead += 1
                        explosive_label = 'VETOED_SECTOR_DEAD'
                    if 'bear_market' in veto_reasons:
                        stats.total_veto_bear_market += 1
                        explosive_label = 'VETOED_BEAR_MARKET'
                    if 'wash_trading' in veto_reasons:
                        stats.total_veto_wash_trading += 1
                        explosive_label = 'VETOED_WASH_TRADING'

                # Min score filter
                if signal == 'BUY' and score < min_score:
                    signal = 'HOLD'
                    day_hold += 1
                    stats.persona_counts[persona]['hold'] += 1

                # Store
                if signal in ('BUY', 'SELL') and entry and target and stop:
                    stored = store_prediction(
                        pred_conn, ticker, signal, entry, target, stop,
                        date_str, persona, score, confidence,
                        market=base.get('market', 'EGX'), state=state, regime=regime,
                        sector_status=sector_status, sector_role=sector_role,
                        wash_trading=is_wash, veto_reasons=veto_reasons if signal == 'HOLD' else None,
                        risk_reward=rr, explosive_label=explosive_label,
                    )
                    if stored:
                        day_stored += 1
                        stats.persona_counts[persona]['stored'] += 1
                        if signal == 'BUY':
                            day_buy += 1
                            stats.persona_counts[persona]['buy'] += 1
                        else:
                            day_sell += 1
                            stats.persona_counts[persona]['sell'] += 1
                    else:
                        day_skipped += 1
                else:
                    day_hold += 1
                    stats.persona_counts[persona]['hold'] += 1

        stats.total_stored += day_stored
        stats.total_buy += day_buy
        stats.total_sell += day_sell
        stats.total_hold += day_hold
        stats.total_skipped += day_skipped

        day_elapsed = time.time() - day_start
        if day_stored > 0 or day_vetoed > 0:
            veto_str = f" vetoed={day_vetoed}" if day_vetoed > 0 else ""
            wash_str = f" wash={day_wash}" if day_wash > 0 else ""
            log(f"  {date_str} [{regime}] stored={day_stored} (BUY={day_buy} SELL={day_sell}){veto_str}{wash_str} ({day_elapsed:.1f}s)")

        # Progress
        if (date_idx + 1) % 20 == 0:
            elapsed = time.time() - start_time
            pct = (date_idx + 1) / len(trading_dates) * 100
            eta = elapsed / (date_idx + 1) * (len(trading_dates) - date_idx - 1)
            log(f"  ── {pct:.0f}% ({date_idx+1}/{len(trading_dates)}) | Stored: {stats.total_stored} | {elapsed/60:.1f}m elapsed | ETA: {eta/60:.1f}m")

        # Memory cleanup every 50 days
        if (date_idx + 1) % 50 == 0:
            gc.collect()

    ph_conn.close()
    pred_conn.close()

    # ─── DAILY CLOSER ───
    if not skip_closer:
        log("")
        log("=" * 70, 'PHASE')
        log("RUNNING DAILY CLOSER", 'PHASE')
        try:
            from jobs.daily_closer import DailyCloser
            closer = DailyCloser()
            closer_result = closer.run()
            if closer_result:
                log(f"   Closed: {closer_result.get('closed', 0)} | Target hits: {closer_result.get('target_hits', 0)} | Stop hits: {closer_result.get('stop_hits', 0)} | Expired: {closer_result.get('expired', 0)}", 'OK')
        except Exception as e:
            log(f"   DailyCloser error: {e}", 'ERROR')

    # ─── LEARNING ENGINE ───
    if not skip_learning:
        log("")
        log("=" * 70, 'PHASE')
        log("RUNNING LEARNING ENGINE", 'PHASE')
        try:
            from jobs.learning_engine import LearningEngine
            learner = LearningEngine()
            learning_result = learner.run(period_days=30)
            log(f"   Learning complete", 'OK')
        except Exception as e:
            log(f"   LearningEngine error: {e}", 'ERROR')

    # ─── FINAL RESULTS ───
    total_elapsed = time.time() - start_time
    log("")
    log("=" * 70, 'OK')
    log("BACKFILL COMPLETE", 'OK')
    log("=" * 70, 'OK')
    log(f"  Time: {total_elapsed/60:.1f}m | Dates: {len(trading_dates)} | Stored: {stats.total_stored}")
    log(f"  BUY: {stats.total_buy} | SELL: {stats.total_sell} | HOLD: {stats.total_hold} | Skipped: {stats.total_skipped}")
    log("")
    log("  MARKET REGIME:")
    log(f"    Bull: {stats.total_bull_days} | Sideways: {stats.total_sideways_days} | Bear: {stats.total_bear_days}")
    log("")
    log("  PHASE 3 VETO STATS:")
    log(f"    Sector Dead: {stats.total_veto_sector_dead} | Bear Market: {stats.total_veto_bear_market} | Wash Trading: {stats.total_veto_wash_trading}")
    log(f"    Wash Trading detected: {stats.total_wash_detected}")
    log("")
    log("  PERSONA BREAKDOWN:")
    for persona in ['gambler', 'balanced', 'conservative']:
        pc = stats.persona_counts.get(persona, {'stored': 0, 'buy': 0, 'sell': 0, 'hold': 0, 'vetoed': 0})
        log(f"    {persona}: stored={pc['stored']} buy={pc['buy']} sell={pc['sell']} hold={pc['hold']} vetoed={pc['vetoed']}")

    # ─── WIN RATE ───
    log("")
    log("  WIN RATE FROM CLOSED PREDICTIONS:")
    try:
        pred_conn = sqlite3.connect(PREDICTIONS_DB)
        cur = pred_conn.cursor()
        for persona in ['gambler', 'balanced', 'conservative']:
            r = cur.execute('''SELECT COUNT(*) as total,
               SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins,
               ROUND(AVG(actual_return), 2) as avg_return,
               ROUND(AVG(CASE WHEN actual_return > 0 THEN actual_return END), 2) as avg_win,
               ROUND(AVG(CASE WHEN actual_return <= 0 THEN actual_return END), 2) as avg_loss
               FROM predictions WHERE persona=? AND outcome_date IS NOT NULL AND actual_return IS NOT NULL''', (persona,)).fetchone()
            if r and r[0] > 0:
                wr = r[1] / r[0] * 100
                pf = abs(r[2] / r[4]) if r[2] and r[4] and r[4] != 0 else 0
                log(f"    {persona}: trades={r[0]} WR={wr:.1f}% avg_return={r[2]}% avg_win={r[3]}% avg_loss={r[4]}% PF≈{pf:.2f}")
            else:
                log(f"    {persona}: no closed predictions yet")

        # Overall + vetoed
        r = cur.execute('''SELECT COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), ROUND(AVG(actual_return),2)
               FROM predictions WHERE outcome_date IS NOT NULL AND actual_return IS NOT NULL''').fetchone()
        if r and r[0] > 0:
            wr = r[1] / r[0] * 100
            log(f"    OVERALL: trades={r[0]} WR={wr:.1f}% avg_return={r[2]}%")
        r = cur.execute('SELECT COUNT(*) FROM predictions WHERE explosive_label LIKE \"VETOED%\"').fetchone()
        if r:
            log(f"    VETOED predictions: {r[0]}")

        # Explosive/Momentum breakdown
        for label in ['explosive_uncap', 'momentum_uncap']:
            r = cur.execute('''SELECT COUNT(*), SUM(CASE WHEN actual_return>0 THEN 1 ELSE 0 END), ROUND(AVG(actual_return),2)
                   FROM predictions WHERE explosive_label=? AND outcome_date IS NOT NULL AND actual_return IS NOT NULL''', (label,)).fetchone()
            if r and r[0] > 0:
                wr = r[1] / r[0] * 100
                log(f"    {label}: trades={r[0]} WR={wr:.1f}% avg_return={r[2]}%")
        pred_conn.close()
    except Exception as e:
        log(f"  Win rate error: {e}", 'ERROR')

    log("")
    log("ALL DONE! 🎉", 'OK')
    return stats


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Maestro Backfill V2 — Fast Phase 3 Backtest')
    parser.add_argument('--days', type=int, default=365)
    parser.add_argument('--markets', nargs='+', default=['EGX'])
    parser.add_argument('--per-day', type=int, default=0, help='Max per day (0=all)')
    parser.add_argument('--clear', action='store_true')
    parser.add_argument('--skip-closer', action='store_true')
    parser.add_argument('--skip-learning', action='store_true')
    parser.add_argument('--min-price', type=float, default=1.0)
    parser.add_argument('--min-volume', type=int, default=50000)
    parser.add_argument('--min-score', type=float, default=0, help='Minimum score to store (default: 0)')
    args = parser.parse_args()

    run_backfill(days_back=args.days, markets=args.markets, per_day=args.per_day,
                 clear_existing=args.clear, skip_closer=args.skip_closer,
                 skip_learning=args.skip_learning, min_price=args.min_price,
                 min_volume=args.min_volume, min_score=args.min_score)
