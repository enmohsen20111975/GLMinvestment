#!/usr/bin/env python3
"""
Backtesting Engine — محرك الاختبار الرجعي الشامل
====================================================
يولّد توقعات تاريخية لفترة طويلة، يقيّمها ضد الأسعار الفعلية،
ويقيس نسب النجاح والمكاسب، ويطبع تقرير تفصيلي للتحسين.

الاستراتيجية:
1. يقرأ historical_data من egypt_stocks.db (بيانات موثوقة)
2. لكل يوم تداول في الفترة المحددة:
   - يبني حالة السهم AS OF that date (no look-ahead)
   - يحسب RSI, MA20, MA50, ATR
   - يولّد إشارة BUY/SELL/HOLD بناءً على الاستراتيجية
   - يحسب entry/target/stop
3. لكل توقع، يقيّم النتيجة ضد الأسعار اللاحقة:
   - TARGET_HIT: لو السعر وصل للهدف
   - STOPPED: لو السعر وصل للوقف
   - PROFIT_TAKEN: لو فيه إشارة بيع فني (RSI>70, MA reversal)
   - EXPIRED: لو خلصت 30 يوم
4. يطبع تقرير شامل: نسب النجاح، متوسط الربح/الخسارة، صافي المكسب

Usage:
    cd vps-service
    python3 scripts/backtesting_engine.py [--days 180] [--per-day 10]

    # لتغيير الاستراتيجية:
    python3 scripts/backtesting_engine.py --strategy conservative
    python3 scripts/backtesting_engine.py --strategy aggressive
    python3 scripts/backtesting_engine.py --strategy balanced
"""

import os
import sys
import sqlite3
import uuid
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
EGYPT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'egypt_stocks.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


# ============================================================================
# STRATEGIES — قابلة للتعديل للتحسين
# ============================================================================

@dataclass
class Strategy:
    """استراتيجية قابلة للضبط"""
    name: str
    # RSI thresholds
    rsi_oversold: float = 30.0      # BUY لو RSI < ده
    rsi_overbought: float = 70.0    # SELL لو RSI > ده
    # MA filters
    require_above_ma50: bool = True  # BUY لو السعر فوق MA50
    require_above_ma200: bool = False
    # Volume
    min_volume_ratio: float = 1.0   # الحجم > المتوسط × ده
    # Risk/Reward
    min_rr: float = 1.5             # أقل R/R مقبول
    target_pct: float = 0.10        # الهدف = +10%
    stop_pct: float = 0.05          # الوقف = -5%
    # ATR-based
    use_atr_stops: bool = True
    atr_stop_mult: float = 2.0      # الوقف = entry - ATR × ده
    atr_target_mult: float = 3.0    # الهدف = entry + ATR × ده
    # Exit signals
    exit_rsi_threshold: float = 75.0  # بيع لو RSI > ده
    exit_trailing_pct: float = 0.05   # بيع لو نزل 5% من القمة
    # Min score
    min_score: float = 50.0


STRATEGIES = {
    'balanced': Strategy(
        name='balanced',
        rsi_oversold=35,
        rsi_overbought=65,
        require_above_ma50=True,
        min_rr=1.5,
        target_pct=0.10,
        stop_pct=0.05,
        min_score=50,
    ),
    'conservative': Strategy(
        name='conservative',
        rsi_oversold=25,
        rsi_overbought=75,
        require_above_ma50=True,
        require_above_ma200=True,
        min_rr=2.0,
        target_pct=0.08,
        stop_pct=0.04,
        min_score=60,
    ),
    'aggressive': Strategy(
        name='aggressive',
        rsi_oversold=40,
        rsi_overbought=60,
        require_above_ma50=False,
        min_rr=1.0,
        target_pct=0.15,
        stop_pct=0.07,
        min_score=40,
    ),
}


# ============================================================================
# INDICATORS
# ============================================================================

def parse_price(v) -> float:
    """Parse price from string/float"""
    try:
        return float(str(v).replace(',', '').replace('%', ''))
    except (ValueError, TypeError):
        return 0.0


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
    if len(prices) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(prices)):
        h = parse_price(prices[i].get('high'))
        l = parse_price(prices[i].get('low'))
        pc = parse_price(prices[i - 1].get('close'))
        if h <= 0 or l <= 0:
            continue
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return 0.0
    return round(sum(trs[-period:]) / period, 4)


def compute_volume_ratio(prices: List[Dict], period: int = 20) -> float:
    """Current volume / average volume"""
    if len(prices) < period + 1:
        return 1.0
    vols = [parse_price(p.get('volume')) for p in prices[-period - 1:-1]]
    avg_vol = sum(vols) / len(vols) if vols else 1
    current_vol = parse_price(prices[-1].get('volume'))
    if avg_vol <= 0:
        return 1.0
    return round(current_vol / avg_vol, 2)


# ============================================================================
# SIGNAL GENERATION
# ============================================================================

@dataclass
class Signal:
    signal: str  # BUY / SELL / HOLD
    score: float
    rsi: float
    ma20: Optional[float]
    ma50: Optional[float]
    atr: float
    vol_ratio: float
    entry: float
    target: Optional[float]
    stop: Optional[float]
    rr: Optional[float]
    reasons: List[str] = field(default_factory=list)


def generate_signal(
    closes: List[float],
    prices: List[Dict],
    strategy: Strategy,
) -> Signal:
    """يولّد إشارة بناءً على الاستراتيجية"""
    if len(closes) < 25:
        return Signal('HOLD', 50, 50, None, None, 0, 1, 0, None, None, None, ['insufficient_data'])

    current = closes[-1]
    rsi = compute_rsi(closes, 14)
    ma20 = compute_ma(closes, 20)
    ma50 = compute_ma(closes, 50)
    atr = compute_atr(prices, 14)
    vol_ratio = compute_volume_ratio(prices, 20)

    # Price change (1d, 5d)
    change_1d = ((closes[-1] - closes[-2]) / closes[-2] * 100) if len(closes) >= 2 and closes[-2] > 0 else 0
    change_5d = ((closes[-1] - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 and closes[-6] > 0 else 0

    score = 50.0
    reasons = []

    # RSI signals
    if rsi < strategy.rsi_oversold:
        score += 20
        reasons.append(f'RSI oversold ({rsi:.1f})')
    elif rsi > strategy.rsi_overbought:
        score -= 20
        reasons.append(f'RSI overbought ({rsi:.1f})')

    # MA filters
    if ma50:
        if current > ma50:
            score += 10
            reasons.append('Above MA50')
        else:
            score -= 10
            reasons.append('Below MA50')

    if strategy.require_above_ma200:
        ma200 = compute_ma(closes, 200)
        if ma200 and current > ma200:
            score += 5
            reasons.append('Above MA200')
        else:
            score -= 15
            reasons.append('Below MA200 (filter)')

    # Volume
    if vol_ratio >= strategy.min_volume_ratio:
        score += 5
        reasons.append(f'Volume {vol_ratio:.1f}x')

    # Calculate entry/target/stop
    entry = current
    if strategy.use_atr_stops and atr > 0:
        target = round(entry + (atr * strategy.atr_target_mult), 4)
        stop = round(entry - (atr * strategy.atr_stop_mult), 4)
    else:
        target = round(entry * (1 + strategy.target_pct), 4)
        stop = round(entry * (1 - strategy.stop_pct), 4)

    risk = entry - stop
    reward = target - entry
    rr = round(reward / risk, 2) if risk > 0 else 0
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        rr = compute_risk_reward(entry, target, stop, fallback=rr)
    except Exception:
        pass  # keep inline rr computed above

    # R/R filter
    if rr < strategy.min_rr:
        score -= 15
        reasons.append(f'R/R {rr} < {strategy.min_rr}')

    # Final decision — balanced BUY/SELL
    # BUY when: score >= min_score AND RSI < 55 AND rr >= min_rr
    # SELL when: score <= (100 - min_score) AND RSI > 55 AND change_1d < -1
    signal = 'HOLD'
    if score >= strategy.min_score and rsi < 55 and rr >= strategy.min_rr:
        signal = 'BUY'
    elif score <= (100 - strategy.min_score) and rsi > 55 and change_1d < -1:
        signal = 'SELL'

    return Signal(
        signal=signal,
        score=round(score, 1),
        rsi=rsi,
        ma20=ma20,
        ma50=ma50,
        atr=atr,
        vol_ratio=vol_ratio,
        entry=entry,
        target=target if signal != 'HOLD' else None,
        stop=stop if signal != 'HOLD' else None,
        rr=rr if signal != 'HOLD' else None,
        reasons=reasons,
    )


# ============================================================================
# EVALUATION
# ============================================================================

@dataclass
class TradeResult:
    outcome: str  # TARGET_HIT / STOPPED / PROFIT_TAKEN / EXPIRED
    exit_price: float
    actual_return: float
    holding_days: int
    exit_reason: str


def evaluate_trade(
    future_prices: List[Dict],
    entry: float,
    target: float,
    stop: float,
    is_buy: bool,
    strategy: Strategy,
) -> TradeResult:
    """يقيّم توقع ضد الأسعار اللاحقة"""
    if not future_prices:
        return TradeResult('EXPIRED', entry, 0, 0, 'no_future_data')

    # SPLIT DETECTION
    for p in future_prices:
        h = parse_price(p.get('high'))
        l = parse_price(p.get('low'))
        if h > entry * 5 or l < entry / 5:
            return TradeResult('EXPIRED', entry, 0, 0, 'split_detected')

    peak = entry
    closes = []

    for i, p in enumerate(future_prices):
        h = parse_price(p.get('high'))
        l = parse_price(p.get('low'))
        c = parse_price(p.get('close'))
        if h <= 0 or l <= 0 or c <= 0:
            continue

        closes.append(c)
        if h > peak:
            peak = h

        holding = i + 1

        # 1. STOP check
        if l <= stop:
            ret = ((stop - entry) / entry) * 100
            return TradeResult('STOPPED', stop, round(ret, 2), holding, 'stop_hit')

        # 2. TARGET check
        if h >= target:
            ret = ((target - entry) / entry) * 100
            return TradeResult('TARGET_HIT', target, round(ret, 2), holding, 'target_hit')

        # 3. PROFIT-TAKING signals
        current_return = ((c - entry) / entry) * 100
        if current_return >= 3:  # only when in profit
            # RSI overbought
            if len(closes) >= 15:
                rsi = compute_rsi(closes, 14)
                if rsi >= strategy.exit_rsi_threshold:
                    ret = ((c - entry) / entry) * 100
                    return TradeResult('PROFIT_TAKEN', c, round(ret, 2), holding, f'rsi_overbought_{rsi}')

            # Trailing stop
            drop_from_peak = ((peak - c) / peak) * 100
            if drop_from_peak >= strategy.exit_trailing_pct * 100:
                ret = ((c - entry) / entry) * 100
                return TradeResult('PROFIT_TAKEN', c, round(ret, 2), holding, f'trailing_stop_{drop_from_peak:.1f}%')

    # 4. EXPIRED
    last_close = parse_price(future_prices[-1].get('close'))
    ret = ((last_close - entry) / entry) * 100
    return TradeResult('EXPIRED', last_close, round(ret, 2), len(future_prices), 'time_exit_30d')


# ============================================================================
# STORAGE
# ============================================================================

def store_prediction(conn, ticker, signal, entry, target, stop, pred_date,
                     score, rsi, ma20, ma50, atr, rr, reasons, strategy_name):
    """يخزّن توقع في predictions table"""
    cur = conn.cursor()
    # Check if exists
    existing = cur.execute(
        "SELECT id FROM predictions WHERE ticker = ? AND prediction_date LIKE ?",
        (ticker, f"{pred_date}%")
    ).fetchone()
    if existing:
        return False

    pred_id = str(uuid.uuid4())
    notes = f"strategy={strategy_name}; score={score}; rsi={rsi}; rr={rr}; reasons={','.join(reasons[:3])}"

    cur.execute('''
        -- DEV-07 verified-disabled (dead code — sys.exit(0) at L678, FINALIZE-UNIFICATION)
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
        notes,
        f"{pred_date} 12:00:00",
        atr,
    ))
    conn.commit()
    return True


def update_outcome(conn, pred_id, result: TradeResult):
    """يحدّث نتيجة التوقع"""
    conn.execute('''
        UPDATE predictions
        SET outcome_date = ?,
            exit_price = ?,
            actual_return = ?,
            hit_target = ?,
            hit_stop = ?,
            is_correct = ?,
            holding_days = ?
        WHERE id = ?
    ''', (
        datetime.now().isoformat(),
        result.exit_price,
        result.actual_return,
        1 if result.outcome == 'TARGET_HIT' else 0,
        1 if result.outcome == 'STOPPED' else 0,
        1 if result.actual_return > 0 else 0,
        result.holding_days,
        pred_id,
    ))
    conn.commit()


# ============================================================================
# MAIN BACKTESTING
# ============================================================================

def run_backtest(
    days_back: int = 180,
    per_day: int = 10,
    strategy_name: str = 'balanced',
    eval_window: int = 30,
):
    # Task DISABLE-SCRIPTS (Rule 35): non-canonical writer disabled.
    # V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY engine allowed
    # to write predictions. This one-off backfill script is disabled to prevent
    # contamination of the canonical prediction store.
    # To re-enable for manual backfill: comment out this guard.
    # Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print("[DISABLE-SCRIPTS] This script is disabled per Rule 35 (V40.2 only writer).", flush=True)
    return
    strategy = STRATEGIES.get(strategy_name, STRATEGIES['balanced'])

    log(f"🧠 Backtesting Engine — Strategy: {strategy.name}")
    log(f"   Days back: {days_back}")
    log(f"   Per day: {per_day}")
    log(f"   Eval window: {eval_window} days")
    log(f"   RSI: {strategy.rsi_oversold}/{strategy.rsi_overbought}")
    log(f"   R/R min: {strategy.min_rr}")
    log(f"   Target: +{strategy.target_pct*100}% / Stop: -{strategy.stop_pct*100}%")
    log("")

    # 1. Load all price history from egypt_stocks.db
    log("Loading price history from egypt_stocks.db...")
    egx_conn = sqlite3.connect(EGYPT_STOCKS_DB)
    egx_conn.row_factory = sqlite3.Row

    r = egx_conn.execute("SELECT MIN(date), MAX(date), COUNT(DISTINCT ticker) FROM historical_data").fetchone()
    log(f"   Data: {r[0]} to {r[1]}, {r[2]} tickers")

    # Load all prices grouped by ticker
    all_prices = {}
    for row in egx_conn.execute(
        "SELECT ticker, date, open, high, low, close, volume FROM historical_data ORDER BY ticker, date ASC"
    ).fetchall():
        d = dict(row)
        if d['ticker'] not in all_prices:
            all_prices[d['ticker']] = []
        all_prices[d['ticker']].append(d)
    egx_conn.close()
    log(f"   Loaded {len(all_prices)} tickers")

    # Get trading dates
    all_dates = set()
    for prices in all_prices.values():
        for p in prices:
            all_dates.add(p['date'])
    all_dates = sorted(all_dates, reverse=True)[:days_back]
    log(f"   Trading dates: {len(all_dates)}")

    # 2. Open predictions DB
    pred_conn = sqlite3.connect(PREDICTIONS_DB)

    # 3. Generate + evaluate predictions
    total_buy = 0
    total_sell = 0
    total_hold = 0
    total_stored = 0
    total_evaluated = 0

    outcomes = {
        'TARGET_HIT': 0,
        'PROFIT_TAKEN': 0,
        'STOPPED': 0,
        'EXPIRED': 0,
    }
    returns = []
    wins = 0
    losses = 0

    for date_str in all_dates:
        day_buy = 0
        day_sell = 0
        day_stored = 0
        day_returns = []

        # Collect candidates
        candidates = []
        for ticker, prices in all_prices.items():
            prices_up_to = [p for p in prices if p['date'] <= date_str]
            if len(prices_up_to) < 25:
                continue
            # Must have data for this exact date
            if prices_up_to[-1]['date'] != date_str:
                continue

            closes = [parse_price(p.get('close')) for p in prices_up_to if parse_price(p.get('close')) > 0]
            if len(closes) < 25:
                continue

            # Get future prices for evaluation
            future_prices = [p for p in prices if p['date'] > date_str][:eval_window]

            candidates.append({
                'ticker': ticker,
                'prices': prices_up_to,
                'closes': closes,
                'future_prices': future_prices,
                'volume': parse_price(prices_up_to[-1].get('volume')),
            })

        # Sort by volume, take top per_day
        candidates.sort(key=lambda x: x['volume'], reverse=True)
        candidates = candidates[:per_day]

        for c in candidates:
            sig = generate_signal(c['closes'], c['prices'], strategy)

            if sig.signal == 'HOLD':
                total_hold += 1
                continue

            # Store prediction
            stored = store_prediction(
                pred_conn, c['ticker'], sig.signal, sig.entry, sig.target, sig.stop,
                date_str, sig.score, sig.rsi, sig.ma20, sig.ma50, sig.atr, sig.rr,
                sig.reasons, strategy.name
            )

            if stored:
                total_stored += 1
                if sig.signal == 'BUY':
                    total_buy += 1
                    day_buy += 1
                else:
                    total_sell += 1
                    day_sell += 1

                # Evaluate immediately
                if c['future_prices']:
                    result = evaluate_trade(
                        c['future_prices'], sig.entry, sig.target, sig.stop,
                        sig.signal == 'BUY', strategy
                    )

                    # Get the prediction ID
                    pred_id = pred_conn.execute(
                        "SELECT id FROM predictions WHERE ticker = ? AND prediction_date LIKE ?",
                        (c['ticker'], f"{date_str}%")
                    ).fetchone()

                    if pred_id:
                        update_outcome(pred_conn, pred_id[0], result)
                        total_evaluated += 1
                        outcomes[result.outcome] += 1
                        day_returns.append(result.actual_return)
                        returns.append(result.actual_return)  # FIX: add to global returns
                        if result.actual_return > 0:
                            wins += 1
                        else:
                            losses += 1

                day_stored += 1

        if day_stored > 0:
            day_avg = sum(day_returns) / len(day_returns) if day_returns else 0
            log(f"   {date_str}: {day_stored} trades (BUY={day_buy}, SELL={day_sell}), avg_return={day_avg:.2f}%")

    pred_conn.close()

    # 4. Print report
    log("")
    log("=" * 60)
    log(f"📊 BACKTESTING REPORT — Strategy: {strategy.name}")
    log("=" * 60)
    log(f"   Total trades: {total_stored}")
    log(f"   BUY: {total_buy} | SELL: {total_sell} | HOLD: {total_hold}")
    log(f"   Evaluated: {total_evaluated}")
    log("")
    log(f"   Outcomes:")
    log(f"     🎯 TARGET_HIT:  {outcomes['TARGET_HIT']}")
    log(f"     💰 PROFIT_TAKEN: {outcomes['PROFIT_TAKEN']}")
    log(f"     🛑 STOPPED:      {outcomes['STOPPED']}")
    log(f"     ⚠️ EXPIRED:      {outcomes['EXPIRED']}")
    log("")

    closed = total_evaluated
    win_rate = (wins / closed * 100) if closed > 0 else 0
    log(f"   Win Rate: {win_rate:.1f}% ({wins} wins / {closed} closed)")
    log(f"   Wins: {wins} | Losses: {losses}")

    if returns:
        avg_return = sum(returns) / len(returns)
        avg_win = sum(r for r in returns if r > 0) / max(wins, 1)
        avg_loss = sum(r for r in returns if r < 0) / max(losses, 1)
        net_pl = sum(returns)
        log(f"   Avg Return: {avg_return:.2f}%")
        log(f"   Avg Win: +{avg_win:.2f}%")
        log(f"   Avg Loss: {avg_loss:.2f}%")
        log(f"   Net P/L: {net_pl:.2f}%")

        # Profit factor
        gross_profit = sum(r for r in returns if r > 0)
        gross_loss = abs(sum(r for r in returns if r < 0))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        log(f"   Profit Factor: {pf:.2f}")

    log("")
    log(f"   Strategy params:")
    log(f"     RSI: {strategy.rsi_oversold}/{strategy.rsi_overbought}")
    log(f"     R/R min: {strategy.min_rr}")
    log(f"     Target: +{strategy.target_pct*100}% / Stop: -{strategy.stop_pct*100}%")
    log(f"     Min score: {strategy.min_score}")
    log("=" * 60)

    return {
        'strategy': strategy.name,
        'total_trades': total_stored,
        'evaluated': total_evaluated,
        'win_rate': win_rate,
        'outcomes': outcomes,
        'returns': returns,
        'net_pl': sum(returns) if returns else 0,
    }


if __name__ == '__main__':
    # Task FINALIZE-UNIFICATION: non-canonical writer disabled (Rule 35).
    # V40.2 (daily_predictor.py) is the ONLY writer to predictions.db.
    # To re-enable: remove this guard. Do NOT delete (Rule 16).
    # NOTE: This is a backtest engine (Rule 27 simulation exception applies), but it INSERTs into
    # the LIVE predictions table, which violates Rule 35. Use a sandbox/replica DB to re-enable.
    import sys
    print('[FINALIZE-UNIFICATION] GUARD: backtesting_engine.py disabled (Rule 35). V40.2 (daily_predictor.py) is the only writer. Backtest simulation context does NOT bypass Rule 35 — use a replica DB to re-enable.')
    sys.exit(0)
    import argparse
    parser = argparse.ArgumentParser(description='Backtesting Engine')
    parser.add_argument('--days', type=int, default=180, help='Days to backtest (default: 180)')
    parser.add_argument('--per-day', type=int, default=10, help='Max trades per day (default: 10)')
    parser.add_argument('--strategy', choices=['balanced', 'conservative', 'aggressive'],
                        default='balanced', help='Strategy to use')
    parser.add_argument('--eval-window', type=int, default=30, help='Evaluation window in days (default: 30)')
    args = parser.parse_args()

    run_backtest(
        days_back=args.days,
        per_day=args.per_day,
        strategy_name=args.strategy,
        eval_window=args.eval_window,
    )
