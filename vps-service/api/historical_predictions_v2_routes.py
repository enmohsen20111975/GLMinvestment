#!/usr/bin/env python3
"""
Historical Predictions V2 — Heavy Development
=============================================
New endpoint that gives the admin FULL control over historical prediction
generation for testing:

  - Per-stock selection (specific tickers like MCQE, ARCC, MBSC)
  - Per-persona selection (gambler / balanced / conservative)
  - Custom date range + sample-every-days
  - SSE live progress streaming (one event per prediction created)
  - Uses maestro_orchestrator + prediction_tracker (Python = THE BRAIN)
  - Optional clear_existing before generation
  - Runs daily_closer afterward to evaluate against future prices

Endpoints:
  POST /api/admin/historical-predictions-v2/generate  (SSE stream)
  POST /api/admin/historical-predictions-v2/preview   (dry-run, returns plan)
  GET  /api/admin/historical-predictions-v2/explosive-stocks  (auto-suggest)

Author: GLMinvestment v3.4.42
"""

import os
import sys
import json
import sqlite3
import time
import math
import random
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path

from flask import Blueprint, jsonify, request, Response, stream_with_context

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))

# Add vps-service to sys.path for imports
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

# ----------------------------------------------------------------------------
# Blueprint
# ----------------------------------------------------------------------------
historical_preds_v2_bp = Blueprint('historical_predictions_v2', __name__)

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

def _get_price_history(ticker: str, up_to_date: str, limit: int = 200) -> List[Dict]:
    """Load price history for a ticker up to (and including) up_to_date."""
    try:
        conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=15.0)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT date, open_price, high_price, low_price, close_price, volume "
            "FROM price_history "
            "WHERE ticker = ? AND date <= ? "
            "ORDER BY date DESC LIMIT ?",
            (ticker.upper(), up_to_date, limit)
        ).fetchall()
        conn.close()
        # Return chronological order (oldest first)
        return [dict(r) for r in reversed(rows)]
    except Exception as e:
        print(f"[HistPredV2] _get_price_history error for {ticker}: {e}", flush=True)
        return []


def _get_stock_info(ticker: str) -> Dict:
    """Get stock metadata from stocks.db."""
    try:
        conn = sqlite3.connect(STOCKS_DB, timeout=15.0)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM stocks WHERE ticker = ? LIMIT 1",
            (ticker.upper(),)
        ).fetchone()
        conn.close()
        return dict(row) if row else {}
    except Exception as e:
        print(f"[HistPredV2] _get_stock_info error for {ticker}: {e}", flush=True)
        return {}


def _compute_indicators(prices: List[Dict]) -> Dict:
    """
    Compute technical indicators from price history.
    Pure Python — no external libs required.
    Returns: {close, rsi, ma20, ma50, atr, atr_pct, bollinger_width,
              support, resistance, volume_trend, volume_spike, trend}
    """
    if not prices or len(prices) < 10:
        return {}

    closes = [float(p.get('close_price', 0) or 0) for p in prices]
    highs = [float(p.get('high_price', 0) or 0) for p in prices]
    lows = [float(p.get('low_price', 0) or 0) for p in prices]
    vols = [float(p.get('volume', 0) or 0) for p in prices]

    closes = [c for c in closes if c > 0]
    if len(closes) < 10:
        return {}

    close = closes[-1]

    # MA20 / MA50
    ma20 = sum(closes[-20:]) / min(20, len(closes)) if len(closes) >= 5 else close
    ma50 = sum(closes[-50:]) / min(50, len(closes)) if len(closes) >= 10 else close

    # RSI(14) — CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
    # قبل كده: كان SMA-based على آخر 14 شمعة فقط — غلط رياضيًا.
    from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
    _rsi_val = _canonical_calc_rsi(closes, 14)
    rsi = _rsi_val if _rsi_val is not None else 50.0

    # ATR(14) — average true range
    atr_period = min(14, len(prices) - 1)
    if atr_period >= 5:
        trs = []
        for i in range(-atr_period, 0):
            h = highs[i] if i < len(highs) else close
            l = lows[i] if i < len(lows) else close
            prev_c = closes[i - 1] if i - 1 >= -len(closes) else close
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
            trs.append(tr)
        atr = sum(trs) / len(trs) if trs else close * 0.02
    else:
        atr = close * 0.02

    atr_pct = (atr / close) * 100 if close > 0 else 0

    # Bollinger width
    if len(closes) >= 20:
        window = closes[-20:]
        mean = sum(window) / 20
        var = sum((x - mean) ** 2 for x in window) / 20
        std = math.sqrt(var)
        upper = mean + 2 * std
        lower = mean - 2 * std
        bollinger_width = ((upper - lower) / mean) * 100 if mean > 0 else 0
    else:
        bollinger_width = 0

    # Support / Resistance (last 20 bars swing high/low)
    if len(prices) >= 20:
        recent = prices[-20:]
        support = min(float(p.get('low_price', 0) or 0) for p in recent)
        resistance = max(float(p.get('high_price', 0) or 0) for p in recent)
    else:
        support = min(float(p.get('low_price', 0) or 0) for p in prices)
        resistance = max(float(p.get('high_price', 0) or 0) for p in prices)

    # Volume trend + spike
    if len(vols) >= 20 and vols[-1] > 0:
        avg_vol = sum(vols[-20:]) / 20
        volume_spike = vols[-1] > (avg_vol * 1.5) if avg_vol > 0 else False
        recent_avg = sum(vols[-5:]) / 5 if len(vols) >= 5 else vols[-1]
        older_avg = sum(vols[-20:-5]) / 15 if len(vols) >= 20 else avg_vol
        if older_avg > 0:
            ratio = recent_avg / older_avg
            if ratio > 1.2:
                volume_trend = 'increasing'
            elif ratio < 0.8:
                volume_trend = 'decreasing'
            else:
                volume_trend = 'flat'
        else:
            volume_trend = 'flat'
    else:
        volume_spike = False
        volume_trend = 'flat'

    # Trend
    if ma20 > ma50 * 1.01:
        trend = 'BULLISH'
    elif ma20 < ma50 * 0.99:
        trend = 'BEARISH'
    else:
        trend = 'NEUTRAL'

    return {
        'close': close,
        'rsi': round(rsi, 2),
        'ma20': round(ma20, 4),
        'ma50': round(ma50, 4),
        'atr': round(atr, 4),
        'atr_pct': round(atr_pct, 2),
        'bollinger_width': round(bollinger_width, 2),
        'support': round(support, 4),
        'resistance': round(resistance, 4),
        'volume_trend': volume_trend,
        'volume_spike': bool(volume_spike),
        'volume_ratio': round((vols[-1] / avg_vol) if (len(vols) >= 20 and avg_vol > 0) else 1.0, 2),
        'trend': trend,
        'closes': closes,
        'history_len': len(closes),
        'quality_flags': [],
    }


def _decide_signal(ind: Dict, persona: str) -> Dict:
    """
    Decide BUY/SELL/HOLD signal based on indicators + persona.
    Returns: {signal, signal_type, entry_price, target_price, target_price_2,
              stop_loss, atr, risk_reward, explosive_score, explosive_label,
              confidence, technical_score, fundamental_score}
    """
    if not ind or ind.get('close', 0) <= 0:
        return {}

    close = ind['close']
    rsi = ind['rsi']
    ma20 = ind['ma20']
    ma50 = ind['ma50']
    atr = ind['atr']
    trend = ind['trend']
    volume_spike = ind['volume_spike']
    volume_trend = ind['volume_trend']

    # Persona thresholds
    if persona == 'gambler':
        buy_rsi_max = 75
        sell_rsi_min = 25
        rr_mult = 2.0
        trail_mult = 1.0
        require_score = 55
    elif persona == 'conservative':
        buy_rsi_max = 60
        sell_rsi_min = 40
        rr_mult = 1.2
        trail_mult = 2.0
        require_score = 70
    else:  # balanced
        buy_rsi_max = 70
        sell_rsi_min = 30
        rr_mult = 1.5
        trail_mult = 1.5
        require_score = 60

    # Score-based decision
    bull_score = 0
    bear_score = 0

    # Trend
    if trend == 'BULLISH':
        bull_score += 25
    elif trend == 'BEARISH':
        bear_score += 25

    # RSI
    if rsi < 30:
        bull_score += 25
    elif rsi < 45:
        bull_score += 15
    elif rsi > 70:
        bear_score += 25
    elif rsi > 55:
        bear_score += 15

    # MA20 vs MA50
    if ma20 > ma50:
        bull_score += 15
    else:
        bear_score += 15

    # Volume
    if volume_spike and volume_trend == 'increasing':
        if trend == 'BULLISH':
            bull_score += 20
        elif trend == 'BEARISH':
            bear_score += 20

    # Bollinger — tight = potential breakout
    if ind['bollinger_width'] < 5:
        bull_score += 5  # squeeze

    # Decide
    if bull_score >= bear_score + 15 and bull_score >= require_score:
        signal = 'BUY'
        signal_type = 'BUY'
        score = bull_score
    elif bear_score >= bull_score + 15 and bear_score >= require_score:
        signal = 'SELL'
        signal_type = 'SELL'
        score = bear_score
    elif bull_score > bear_score:
        signal = 'ACCUMULATE'
        signal_type = 'ACCUMULATE'
        score = bull_score
    elif bear_score > bull_score:
        signal = 'REDUCE'
        signal_type = 'REDUCE'
        score = bear_score
    else:
        signal = 'HOLD'
        signal_type = 'HOLD'
        score = 50

    # Compute entry / target / stop
    entry_price = close
    # Cap ATR at 30% of entry price to prevent insane target/stop values
    # for stocks with anomalous price spikes (e.g. bad data points).
    _atr_capped = min(atr, entry_price * 0.30) if entry_price > 0 else atr
    if signal in ('BUY', 'ACCUMULATE'):
        target_price = round(entry_price + (_atr_capped * rr_mult), 4)
        stop_loss = round(entry_price - (_atr_capped * trail_mult), 4)
        target_price_2 = round(entry_price + (_atr_capped * rr_mult * 1.8), 4)  # T2 = 1.8× T1 distance
    elif signal in ('SELL', 'REDUCE'):
        target_price = round(entry_price - (_atr_capped * rr_mult), 4)
        stop_loss = round(entry_price + (_atr_capped * trail_mult), 4)
        target_price_2 = round(entry_price - (_atr_capped * rr_mult * 1.8), 4)
    else:
        target_price = round(entry_price + _atr_capped, 4)
        stop_loss = round(entry_price - _atr_capped, 4)
        target_price_2 = 0.0

    # Data-quality guard: reject nonsensical values
    if (entry_price <= 0 or target_price <= 0 or stop_loss <= 0
            or (signal in ('BUY', 'ACCUMULATE') and target_price <= entry_price)
            or (signal in ('SELL', 'REDUCE') and target_price >= entry_price)):
        # Force HOLD if values are bad — caller can skip_hold=True to drop it.
        signal = 'HOLD'
        signal_type = 'HOLD'
        target_price = round(entry_price + _atr_capped, 4) if entry_price > 0 else 0
        stop_loss = round(entry_price - _atr_capped, 4) if entry_price > 0 else 0
        target_price_2 = 0.0

    if stop_loss > 0 and target_price > 0:
        risk = abs(entry_price - stop_loss)
        reward = abs(target_price - entry_price)
        risk_reward = round(reward / risk, 2) if risk > 0 else 0
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above
    else:
        risk_reward = 0

    # Explosive detection
    explosive_score = 0
    explosive_label = ''
    _atr_pct = ind.get('atr_pct', 0) or 0
    if _atr_pct >= 5 and volume_spike and signal in ('BUY', 'ACCUMULATE'):
        if _atr_pct >= 8 and bull_score >= 75:
            explosive_score = 90
            explosive_label = 'BOMB'
        elif _atr_pct >= 6 and bull_score >= 65:
            explosive_score = 75
            explosive_label = 'ROCKET'
        else:
            explosive_score = 55
            explosive_label = 'SPARK'

    # ---- Confidence Engine v1.0 — حساب نسبة الثقة المتقدمة ----
    # بدل ما نعتمد على score بسيط، نستخدم 7 عوامل لحساب ثقة دقيقة
    try:
        from analyzers.confidence_engine import compute_confidence
        conf_result = compute_confidence(ind, {
            'signal': signal,
            'entry_price': entry_price,
            'target_price': target_price,
            'stop_loss': stop_loss,
            'risk_reward': risk_reward,
            'explosive_score': explosive_score,
            'explosive_label': explosive_label,
            'technical_score': min(100, int(score)),
        }, persona)
        final_confidence = conf_result['confidence']
        confidence_tier = conf_result['tier']
        confidence_reasons = conf_result.get('top_reasons', [])
    except Exception as e:
        final_confidence = min(95, score + 5)
        confidence_tier = 'WATCH'
        confidence_reasons = [f'confidence_engine fallback: {e}']

    return {
        'signal': signal,
        'signal_type': signal_type,
        'entry_price': round(entry_price, 4),
        'target_price': target_price,
        'target_price_2': target_price_2,
        'stop_loss': stop_loss,
        'atr': round(atr, 4),
        'risk_reward': risk_reward,
        'explosive_score': explosive_score,
        'explosive_label': explosive_label,
        'confidence': final_confidence,
        'confidence_tier': confidence_tier,
        'confidence_reasons': confidence_reasons,
        'technical_score': min(100, int(score)),
        'fundamental_score': 60,  # default — real fundamentals loaded elsewhere
    }


def _insert_prediction(prediction_date: str, ticker: str, market: str,
                       signal: str, signal_type: str, entry_price: float,
                       target_price: float, stop_loss: float,
                       target_price_2: float, persona: str,
                       technical_score: int, fundamental_score: int,
                       atr_at_entry: float, risk_reward: float,
                       explosive_score: float, explosive_label: str,
                       confidence: float, master_score: float,
                       notes: str) -> Optional[int]:
    """Insert a single historical prediction row with a CUSTOM prediction_date.

    🔥 MASTER DIRECTIVE المحور 3 (HARD GEOMETRY GATE):
    بـ يستدعي enforce_geometry_guard من prediction_tracker قبل INSERT.
    لو أي قاعدة من R1-R5 فشلت → بـ يرجّع None (REJECT) بدون حفظ.
    ده بـ يمنع تكرار الكوارث اللي ظهرت في الإنتاج:
      - SCTS entry=614 target=608 (معكوس)
      - MFPC entry=37 stop=0.37 (وقف هزلي)
      - BTFH entry=3.12 target=1392 (تلوث تجزئة)
    """
    # 🔥 HARD GEOMETRY GATE — قبل أي INSERT (نفس حراسة record_prediction)
    try:
        from analyzers.prediction_tracker import enforce_geometry_guard
        enforce_geometry_guard(signal, entry_price, target_price, stop_loss)
    except AssertionError as _geo_err:
        print(
            f"[GEOMETRY-REJECT] _insert_prediction ticker={ticker} signal={signal} "
            f"entry={entry_price} target={target_price} stop={stop_loss} "
            f"| {_geo_err}",
            flush=True,
        )
        return None
    except Exception as _geo_imp:
        # لو enforce_geometry_guard مش متاحة → احظر آمن (fail-safe: لا حفظ بدون حراسة)
        print(
            f"[GEOMETRY-UNAVAILABLE] _insert_prediction ticker={ticker} "
            f"guard import failed ({_geo_imp}) → SKIP (cannot trust unguarded values)",
            flush=True,
        )
        return None

    try:
        _persona = (persona or 'balanced').strip().lower()
        if _persona == 'investor':
            _persona = 'conservative'
        if _persona not in ('gambler', 'balanced', 'conservative'):
            _persona = 'balanced'

        conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
        cur = conn.cursor()
        now_iso = datetime.now().isoformat()
        try:
            cur.execute('''
                INSERT INTO predictions (
                    ticker, signal, signal_type, prediction_date,
                    entry_price, target_price, stop_loss, master_score,
                    technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                    notes, persona, created_at, atr_at_entry,
                    target_price_2, explosive_score, explosive_label,
                    market, confidence, risk_reward, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                ticker.upper(), signal, signal_type, prediction_date,
                entry_price, target_price, stop_loss, master_score,
                technical_score, fundamental_score, 50, 50,
                notes, _persona, now_iso, atr_at_entry,
                target_price_2 or 0, explosive_score or 0, (explosive_label or '').upper(),
                market, confidence, risk_reward, 'PENDING',
            ))
        except Exception:
            # Fallback for older schema without T2/explosive fields
            cur.execute('''
                INSERT INTO predictions (
                    ticker, signal, signal_type, prediction_date,
                    entry_price, target_price, stop_loss, master_score,
                    technical_score, fundamental_score, ai_pattern_score, sentiment_score,
                    notes, persona, created_at, atr_at_entry,
                    market, confidence, risk_reward, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                ticker.upper(), signal, signal_type, prediction_date,
                entry_price, target_price, stop_loss, master_score,
                technical_score, fundamental_score, 50, 50,
                notes, _persona, now_iso, atr_at_entry,
                market, confidence, risk_reward, 'PENDING',
            ))
        pred_id = cur.lastrowid
        conn.commit()
        conn.close()
        return pred_id
    except Exception as e:
        print(f"[HistPredV2] INSERT error for {ticker}: {e}", flush=True)
        return None


def _clear_existing_for_tickers(tickers: List[str], persona: str = None) -> int:
    """Delete existing predictions for the given tickers (and optionally persona)."""
    if not tickers:
        return 0
    try:
        conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
        cur = conn.cursor()
        placeholders = ','.join(['?'] * len(tickers))
        upper_tickers = [t.upper() for t in tickers]
        if persona:
            cur.execute(
                f"DELETE FROM predictions WHERE ticker IN ({placeholders}) AND persona = ?",
                upper_tickers + [persona]
            )
        else:
            cur.execute(
                f"DELETE FROM predictions WHERE ticker IN ({placeholders})",
                upper_tickers
            )
        deleted = cur.rowcount
        conn.commit()
        conn.close()
        return deleted
    except Exception as e:
        print(f"[HistPredV2] clear error: {e}", flush=True)
        return 0


def _generate_sample_dates(start_date: str, end_date: str, sample_every_days: int) -> List[str]:
    """Generate list of sample dates between start and end (inclusive) at the given interval."""
    try:
        s = datetime.strptime(start_date, '%Y-%m-%d')
        e = datetime.strptime(end_date, '%Y-%m-%d')
        if e < s:
            return []
        dates = []
        cur = s
        step = max(1, int(sample_every_days))
        while cur <= e:
            # Skip Fri (4) and Sat (5) for EGX/financial markets
            if cur.weekday() not in (4, 5):
                dates.append(cur.strftime('%Y-%m-%d'))
            cur += timedelta(days=step)
        return dates
    except Exception as e:
        print(f"[HistPredV2] date gen error: {e}", flush=True)
        return []


def _format_sse(event: str, data: Dict) -> str:
    """Format a Server-Sent Events message."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------

@historical_preds_v2_bp.route('/api/admin/historical-predictions-v2/explosive-stocks', methods=['GET'])
def get_explosive_stocks():
    """
    Auto-suggest explosive stocks — top gainers by swing in last 30-60 days.
    Returns a list of {ticker, min_price, max_price, swing_pct, days}.
    """
    try:
        days_back = int(request.args.get('days_back', '60'))
        limit = int(request.args.get('limit', '15'))
        min_swing = float(request.args.get('min_swing', '20'))
        max_swing = float(request.args.get('max_swing', '400'))

        cutoff = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
        conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=15.0)
        cur = conn.cursor()
        cur.execute(
            "SELECT ticker, MIN(close_price), MAX(close_price), COUNT(*), MIN(date), MAX(date) "
            "FROM price_history "
            "WHERE date >= ? AND close_price > 0.5 AND close_price < 5000 "
            "GROUP BY ticker "
            "HAVING COUNT(*) >= 5",
            (cutoff,)
        )
        rows = cur.fetchall()
        conn.close()

        gainers = []
        for r in rows:
            ticker, mn, mx, days, d1, d2 = r
            if mn and mn > 0 and mx and mx > mn:
                swing = ((mx - mn) / mn) * 100
                if min_swing <= swing <= max_swing:
                    gainers.append({
                        'ticker': ticker,
                        'min_price': round(mn, 4),
                        'max_price': round(mx, 4),
                        'swing_pct': round(swing, 2),
                        'days_with_data': days,
                        'first_date': d1,
                        'last_date': d2,
                    })
        gainers.sort(key=lambda x: -x['swing_pct'])
        return jsonify({'success': True, 'stocks': gainers[:limit], 'total_found': len(gainers)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@historical_preds_v2_bp.route('/api/admin/historical-predictions-v2/preview', methods=['POST'])
def preview_generation():
    """
    Dry-run — returns the plan: list of (date, ticker) pairs that WOULD be
    analyzed. No DB writes.
    """
    try:
        data = request.get_json() or {}
        tickers = data.get('tickers', [])
        start_date = data.get('start_date', '2026-01-01')
        end_date = data.get('end_date', datetime.now().strftime('%Y-%m-%d'))
        sample_every_days = int(data.get('sample_every_days', 7))

        if not tickers:
            return jsonify({'success': False, 'error': 'tickers required'}), 400

        dates = _generate_sample_dates(start_date, end_date, sample_every_days)
        plan = []
        for d in dates:
            for t in tickers:
                plan.append({'date': d, 'ticker': t.upper()})

        return jsonify({
            'success': True,
            'plan_size': len(plan),
            'dates': dates,
            'tickers': [t.upper() for t in tickers],
            'preview': plan[:20],
            'total_preview': len(plan),
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@historical_preds_v2_bp.route('/api/admin/historical-predictions-v2/generate', methods=['POST'])
def generate_historical_predictions_v2():
    """
    Heavy-development endpoint: generate historical predictions for SPECIFIC
    tickers across a date range, with persona selection and SSE progress.

    Body:
        tickers: List[str]            — required, e.g. ['MCQE', 'ARCC', 'MBSC']
        start_date: str               — default '2026-01-01'
        end_date: str                 — default today
        sample_every_days: int        — default 7
        persona: str                  — 'gambler' | 'balanced' | 'conservative'
        clear_existing: bool          — delete existing predictions for these tickers first
        market: str                   — default 'EGX'
        skip_hold: bool               — skip HOLD signals (default true)
        run_closer: bool              — run daily_closer after generation (default true)
        daily_cap: int                — max picks per day (default 5) — "منطق واقعي"
        min_confidence: float         — min confidence threshold 0-100 (default 50)

    Returns: SSE stream with events:
        - start: {plan_size, tickers, dates, persona}
        - progress: {current, total, percent, date, ticker}
        - prediction: {id, date, ticker, signal, entry, target, stop, t2, persona, explosive_label}
        - skip: {date, ticker, reason}
        - closer: {stopped, target_hits, expired, still_pending, errors}
        - complete: {generated, skipped, by_signal, by_market, duration_seconds}
        - error: {message}
    """
    try:
        data = request.get_json() or {}
    except Exception:
        data = {}

    tickers = data.get('tickers', [])
    if not tickers or not isinstance(tickers, list):
        return jsonify({'success': False, 'error': 'tickers (non-empty list) required'}), 400

    start_date = data.get('start_date', '2026-01-01')
    end_date = data.get('end_date', datetime.now().strftime('%Y-%m-%d'))
    sample_every_days = max(1, min(30, int(data.get('sample_every_days', 7))))
    persona = (data.get('persona', 'balanced') or 'balanced').strip().lower()
    if persona == 'investor':
        persona = 'conservative'
    if persona not in ('gambler', 'balanced', 'conservative'):
        persona = 'balanced'
    clear_existing = bool(data.get('clear_existing', False))
    market = data.get('market', 'EGX')
    skip_hold = bool(data.get('skip_hold', True))
    run_closer = bool(data.get('run_closer', True))
    # ---- NEW: Daily Cap + Confidence Filter (منطق واقعي) ----
    # المستثمر الذكي لا يشتري 10 أسهم في اليوم — يختار أعلى 5 فقط
    daily_cap = max(1, min(20, int(data.get('daily_cap', 5))))
    min_confidence = max(0, min(100, float(data.get('min_confidence', 50))))

    # Normalize tickers
    tickers = [t.upper().strip() for t in tickers if isinstance(t, str) and t.strip()]
    if not tickers:
        return jsonify({'success': False, 'error': 'no valid tickers'}), 400

    dates = _generate_sample_dates(start_date, end_date, sample_every_days)
    if not dates:
        return jsonify({'success': False, 'error': f'no dates in range {start_date} → {end_date}'}), 400

    plan_size = len(dates) * len(tickers)

    # ------------------------------------------------------------------
    # SSE STREAM
    # ------------------------------------------------------------------
    def generate():
        start_time = time.time()
        generated = 0
        skipped = 0
        by_signal = {'BUY': 0, 'SELL': 0, 'ACCUMULATE': 0, 'REDUCE': 0, 'HOLD': 0}
        by_market = {market: 0}
        errors = []
        current = 0

        yield _format_sse('start', {
            'plan_size': plan_size,
            'tickers': tickers,
            'dates': dates,
            'persona': persona,
            'start_date': start_date,
            'end_date': end_date,
            'sample_every_days': sample_every_days,
            'clear_existing': clear_existing,
            'skip_hold': skip_hold,
            'run_closer': run_closer,
            'daily_cap': daily_cap,
            'min_confidence': min_confidence,
            'timestamp': datetime.now().isoformat(),
        })

        # Optional clear
        if clear_existing:
            try:
                deleted = _clear_existing_for_tickers(tickers, persona if persona else None)
                yield _format_sse('cleared', {'deleted': deleted, 'tickers': tickers})
            except Exception as e:
                yield _format_sse('warning', {'message': f'clear failed: {e}'})

        # Import select_top_picks from confidence_engine
        try:
            from analyzers.confidence_engine import select_top_picks
        except Exception:
            select_top_picks = None

        # Generate predictions
        for d in dates:
            # ---- NEW: تجميع كل الـ candidates لهذا اليوم ----
            # بدل ما insert كل ticker فوراً، نجمعهم ونختار أعلى 5
            day_candidates = []
            day_skipped = 0

            for ticker in tickers:
                current += 1
                pct = round((current / plan_size) * 100, 1)

                try:
                    # Load price history up to date d
                    prices = _get_price_history(ticker, d, limit=200)
                    if not prices or len(prices) < 10:
                        day_skipped += 1
                        skipped += 1
                        yield _format_sse('skip', {
                            'date': d, 'ticker': ticker,
                            'reason': 'insufficient price history',
                            'current': current, 'total': plan_size, 'percent': pct,
                        })
                        continue

                    # Compute indicators + decide signal
                    ind = _compute_indicators(prices)
                    if not ind or ind.get('close', 0) <= 0:
                        day_skipped += 1
                        skipped += 1
                        yield _format_sse('skip', {
                            'date': d, 'ticker': ticker,
                            'reason': 'indicator computation failed',
                            'current': current, 'total': plan_size, 'percent': pct,
                        })
                        continue

                    decision = _decide_signal(ind, persona)
                    if not decision:
                        day_skipped += 1
                        skipped += 1
                        yield _format_sse('skip', {
                            'date': d, 'ticker': ticker,
                            'reason': 'decision failed',
                            'current': current, 'total': plan_size, 'percent': pct,
                        })
                        continue

                    if skip_hold and decision['signal'] == 'HOLD':
                        day_skipped += 1
                        skipped += 1
                        by_signal['HOLD'] += 1
                        yield _format_sse('skip', {
                            'date': d, 'ticker': ticker,
                            'reason': 'HOLD signal (skip_hold=True)',
                            'current': current, 'total': plan_size, 'percent': pct,
                        })
                        continue

                    # ---- NEW: Confidence Filter — تجاوز أي توصية أقل من min_confidence ----
                    if decision.get('confidence', 0) < min_confidence:
                        day_skipped += 1
                        skipped += 1
                        yield _format_sse('skip', {
                            'date': d, 'ticker': ticker,
                            'reason': f"low confidence ({decision.get('confidence', 0):.1f}% < {min_confidence}%)",
                            'current': current, 'total': plan_size, 'percent': pct,
                        })
                        continue

                    # Add to day_candidates — بناء notes
                    notes = (
                        f"HistV2 {persona}: trend={ind['trend']} rsi={ind['rsi']} "
                        f"atr%={ind['atr_pct']} vol={ind['volume_trend']}"
                        f"{' VOL_SPIKE' if ind['volume_spike'] else ''}"
                        f"{' EXPLOSIVE_' + decision['explosive_label'] if decision['explosive_label'] else ''}"
                        f" conf={decision.get('confidence', 0):.1f}% tier={decision.get('confidence_tier', 'WATCH')}"
                    )

                    day_candidates.append({
                        'ticker': ticker,
                        'ind': ind,
                        'decision': decision,
                        'notes': notes,
                    })

                except Exception as e:
                    day_skipped += 1
                    skipped += 1
                    errors.append(f'{ticker}@{d}: {e}')
                    yield _format_sse('skip', {
                        'date': d, 'ticker': ticker,
                        'reason': f'error: {e}',
                        'current': current, 'total': plan_size, 'percent': pct,
                    })

            # ---- NEW: تطبيق Daily Cap = N ----
            # نختار أعلى N توصيات بناءً على confidence
            if not day_candidates:
                continue

            if select_top_picks and len(day_candidates) > daily_cap:
                # تحويل لصيغة select_top_picks
                picks_input = [
                    {
                        'ticker': c['ticker'],
                        'confidence': c['decision'].get('confidence', 0),
                        'risk_reward': c['decision'].get('risk_reward', 0),
                    }
                    for c in day_candidates
                ]
                top_tickers = [p['ticker'] for p in select_top_picks(picks_input, cap=daily_cap, min_confidence=min_confidence)]
                # Filter day_candidates to only top_tickers (preserve order by confidence)
                day_candidates = [c for c in day_candidates if c['ticker'] in top_tickers]
                # Sort by confidence desc
                day_candidates.sort(key=lambda x: x['decision'].get('confidence', 0), reverse=True)
                yield _format_sse('daily_cap', {
                    'date': d,
                    'candidates_count': len(picks_input),
                    'selected_count': len(day_candidates),
                    'daily_cap': daily_cap,
                    'rejected': len(picks_input) - len(day_candidates),
                })
            else:
                # Sort by confidence even if under cap
                day_candidates.sort(key=lambda x: x['decision'].get('confidence', 0), reverse=True)

            # ---- Insert the selected picks ----
            for c in day_candidates:
                ticker = c['ticker']
                ind = c['ind']
                decision = c['decision']
                notes = c['notes']

                pred_id = _insert_prediction(
                    prediction_date=d,
                    ticker=ticker,
                    market=market,
                    signal=decision['signal'],
                    signal_type=decision['signal_type'],
                    entry_price=decision['entry_price'],
                    target_price=decision['target_price'],
                    stop_loss=decision['stop_loss'],
                    target_price_2=decision['target_price_2'],
                    persona=persona,
                    technical_score=decision['technical_score'],
                    fundamental_score=decision['fundamental_score'],
                    atr_at_entry=decision['atr'],
                    risk_reward=decision['risk_reward'],
                    explosive_score=decision['explosive_score'],
                    explosive_label=decision['explosive_label'],
                    confidence=decision['confidence'],
                    master_score=decision['technical_score'],
                    notes=notes,
                )

                if pred_id:
                    generated += 1
                    by_signal[decision['signal']] = by_signal.get(decision['signal'], 0) + 1
                    by_market[market] = by_market.get(market, 0) + 1
                    yield _format_sse('prediction', {
                        'id': pred_id,
                        'date': d,
                        'ticker': ticker,
                        'signal': decision['signal'],
                        'entry': decision['entry_price'],
                        'target': decision['target_price'],
                        'stop': decision['stop_loss'],
                        't2': decision['target_price_2'],
                        'persona': persona,
                        'risk_reward': decision['risk_reward'],
                        'explosive_label': decision['explosive_label'],
                        'explosive_score': decision['explosive_score'],
                        'confidence': decision.get('confidence', 0),
                        'confidence_tier': decision.get('confidence_tier', 'WATCH'),
                        'current': current,
                        'total': plan_size,
                        'percent': pct,
                    })
                else:
                    skipped += 1
                    errors.append(f'{ticker}@{d}: insert failed')

            # end of date d loop

        # Run daily_closer to evaluate
        closer_result = None
        if run_closer and generated > 0:
            yield _format_sse('closer_start', {'predictions_to_evaluate': generated})
            try:
                # Import + run daily_closer
                sys.path.insert(0, str(_VPS_ROOT))
                from jobs.daily_closer import DailyCloser
                closer = DailyCloser()
                closer_result = closer.run()
                # Normalize closer result keys for the frontend
                if isinstance(closer_result, dict):
                    closed = closer_result.get('closed', {}) or {}
                    closer_out = {
                        'total_pending': closer_result.get('total_pending', 0),
                        'target_hits': closed.get('TARGET_HIT', 0),
                        'stopped': closed.get('STOPPED', 0),
                        'expired': closed.get('EXPIRED', 0),
                        'still_pending': closed.get('STILL_PENDING', 0),
                        'errors': closed.get('ERROR', 0),
                        'elapsed_seconds': closer_result.get('elapsed_seconds', 0),
                        'price_source_stats': closer_result.get('price_source_stats', {}),
                    }
                else:
                    closer_out = {'raw': str(closer_result)}
                closer_result = closer_out
                yield _format_sse('closer', closer_result)
            except Exception as e:
                yield _format_sse('warning', {'message': f'closer failed: {e}'})

        duration = round(time.time() - start_time, 2)
        yield _format_sse('complete', {
            'generated': generated,
            'skipped': skipped,
            'by_signal': by_signal,
            'by_market': by_market,
            'duration_seconds': duration,
            'errors': errors[:20],
            'closer': closer_result,
            'timestamp': datetime.now().isoformat(),
        })

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


# ----------------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------------

@historical_preds_v2_bp.route('/api/admin/historical-predictions-v2/health', methods=['GET'])
def health():
    return jsonify({
        'success': True,
        'service': 'historical-predictions-v2',
        'version': '1.0.0',
        'endpoints': [
            'POST /api/admin/historical-predictions-v2/generate (SSE)',
            'POST /api/admin/historical-predictions-v2/preview',
            'GET  /api/admin/historical-predictions-v2/explosive-stocks',
            'GET  /api/admin/historical-predictions-v2/health',
        ],
        'dbs': {
            'stocks': os.path.exists(STOCKS_DB),
            'price_history': os.path.exists(PRICE_HISTORY_DB),
            'predictions': os.path.exists(PREDICTIONS_DB),
        },
    })
