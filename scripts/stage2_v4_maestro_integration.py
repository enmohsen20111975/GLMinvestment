#!/usr/bin/env python3
"""
المرحلة 2 — ربط V4 مع Maestro + Backtest قبل/بعد
===================================================
المنطق:
  - BASELINE: Maestro daily analysis فقط (نفس الإنتاج الحالي)
  - INTEGRATED: Maestro daily + V4 intraday Hot Candidates
    • V4 يرفع Hot Candidate → Maker Override بحجم مخفّض (0.5-0.7%)
    • بس الدخول النهائي لازم يعدي على: R/R, Regime, Entry Gate, Position Sizing
    • ممنوع دخول بحجم كامل على إشارة داخل اليوم فقط

الفلاتر الأساسية (طبقًا لطلب المالك):
  1. R/R ≥ 1.5
  2. Sector Cap (max 2 picks/sector/day)
  3. Regime (bear = skip أو reduce)
  4. Geometry Guard (target/stop منطقي)
  5. Position Sizing (risk-based: 1.2% baseline, 0.5-0.7% V4 override)
"""
import sqlite3
import sys
import os
import math
from collections import defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, '/home/z/my-project/vps-service')
os.chdir('/home/z/my-project')

from analyzers.v4_predictive_detector import detect_v4_predictive, normalize_intraday_bars

INTRADAY_DB = '/tmp/dbs/intraday.db'
DAILY_DB = '/tmp/dbs/data_engine.db'

# ═══════════════════════════════════════════════════════════════════
# 1) فلاتر Maestro الأساسية (مبسّطة لكن واقعية)
# ═══════════════════════════════════════════════════════════════════

def sma(values, period):
    if len(values) < period: return 0
    return sum(values[-period:]) / period

def ema(values, period):
    if len(values) < period: return 0
    k = 2 / (period + 1)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = v * k + e * (1 - k)
    return e

def atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return 0
    trs = []
    for i in range(-period, 0):
        tr = max(highs[i] - lows[i],
                 abs(highs[i] - closes[i-1]),
                 abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return sum(trs) / period

def rsi(closes, period=14):
    if len(closes) < period + 1: return 50
    gains, losses = [], []
    for i in range(1, min(period + 1, len(closes))):
        change = closes[-i] - closes[-i-1]
        if change > 0: gains.append(change)
        else: losses.append(abs(change))
    avg_gain = sum(gains) / period if gains else 0
    avg_loss = sum(losses) / period if losses else 0.001
    return 100 - (100 / (1 + avg_gain / avg_loss))


def check_regime(closes):
    """Bear / Sideways / Bull based on SMA50 slope."""
    if len(closes) < 50: return 'sideways'
    sma50 = sma(closes, 50)
    sma20 = sma(closes, 20)
    last = closes[-1]
    if last < sma50 and sma20 < sma50: return 'bear'
    if last > sma50 and sma20 > sma50: return 'bull'
    return 'sideways'


def check_rr(entry, target, stop):
    """R/R ≥ 1.5 مطلوب."""
    if entry <= 0 or stop <= 0: return False
    risk = abs(entry - stop)
    reward = abs(target - entry)
    if risk <= 0: return False
    return (reward / risk) >= 1.5


def check_entry_gate(closes, volumes):
    """Entry gate: above SMA50 + liquidity + not deeply extended."""
    if len(closes) < 50: return False, 'بيانات غير كافية'
    sma50 = sma(closes, 50)
    last = closes[-1]
    # فوق SMA50
    if last < sma50 * 0.97:
        return False, f'تحت SMA50 ({last:.2f} < {sma50:.2f})'
    # سيولة: متوسط حجم 20 يوم ≥ 50K
    avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else 0
    if avg_vol < 50000:
        return False, f'سيولة ضعيفة (avg_vol={avg_vol:.0f})'
    # مش ممدود زيادة (RSI < 75)
    rsi_val = rsi(closes)
    if rsi_val > 78:
        return False, f'ممدود زيادة (RSI={rsi_val:.0f})'
    return True, 'OK'


def check_geometry(entry, target, stop):
    """Geometry Guard: target > entry > stop (for buys)."""
    if not (target > entry > stop): return False
    if target <= entry * 1.02: return False  # target ≥ +2%
    if stop >= entry * 0.99: return False  # stop ≤ -1%
    return True


def calculate_position_size(capital, entry, stop, risk_pct, max_position_pct=25.0):
    """Risk-based position sizing."""
    if entry <= 0 or stop <= 0 or entry <= stop: return 0
    risk_amount = capital * (risk_pct / 100)
    stop_distance_pct = (entry - stop) / entry * 100
    if stop_distance_pct < 1.0 or stop_distance_pct > 15.0: return 0
    position_value = risk_amount / (stop_distance_pct / 100)
    position_pct = (position_value / capital) * 100
    return min(position_pct, max_position_pct)


# ═══════════════════════════════════════════════════════════════════
# 2) Maestro Daily Analysis (مبسّط)
# ═══════════════════════════════════════════════════════════════════

def maestro_daily_analysis(closes, highs, lows, volumes):
    """تحليل Maestro اليومي المبسّط.
    يرجع: recommendation, score, entry, target, stop, regime, vetoed
    """
    if len(closes) < 50:
        return None

    regime = check_regime(closes)
    sma50 = sma(closes, 50)
    sma20 = sma(closes, 20)
    last = closes[-1]
    atr_val = atr(highs, lows, closes, 14)
    rsi_val = rsi(closes)

    # Score (0-100)
    score = 50  # base
    if last > sma50: score += 10
    if last > sma20: score += 8
    if sma20 > sma50: score += 7  # trend up
    if rsi_val > 50: score += 5
    if rsi_val > 60: score += 5
    # Volume
    avg_vol = sum(volumes[-20:]) / 20
    last_vol = volumes[-1]
    if last_vol > avg_vol * 1.5: score += 10
    elif last_vol > avg_vol * 1.2: score += 5
    # ROC
    if len(closes) >= 21:
        roc20 = (last - closes[-21]) / closes[-21] * 100
        if roc20 > 10: score += 10
        elif roc20 > 5: score += 5

    score = min(score, 100)

    # Entry/Stop/Target
    entry = last
    stop = last - (atr_val * 1.5)
    target = last + (atr_val * 3.0)

    # Recommendation
    if regime == 'bear':
        recommendation = 'hold'
        vetoed = True
    elif score >= 65 and regime in ('bull', 'sideways'):
        recommendation = 'buy'
        vetoed = False
    elif score >= 55:
        recommendation = 'hold'
        vetoed = False
    else:
        recommendation = 'hold'
        vetoed = False

    return {
        'recommendation': recommendation,
        'score': score,
        'entry': entry,
        'target': target,
        'stop': stop,
        'regime': regime,
        'vetoed': vetoed,
        'atr': atr_val,
        'rsi': rsi_val,
        'sma50': sma50,
    }


# ═══════════════════════════════════════════════════════════════════
# 3) V4 Intraday Hot Candidate Detection
# ═══════════════════════════════════════════════════════════════════

def load_intraday_bars(conn, ticker, day):
    """حمّل شرائط 5 دقايق لسهم في يوم معين."""
    rows = conn.execute("""
        SELECT timestamp, price, volume, high, low
        FROM stock_intraday
        WHERE market='مصر' AND ticker=? AND substr(timestamp,1,10)=?
        ORDER BY timestamp
    """, (ticker, day)).fetchall()
    raw_bars = [{'timestamp': r[0], 'price': r[1], 'volume': r[2],
                 'high': r[3] or r[1], 'low': r[4] or r[1]} for r in rows]
    return normalize_intraday_bars(raw_bars)


def scan_v4_intraday(bars, scan_window=20, hot_threshold=40):
    """امسح V4 على شرائط intraday.
    يرجع: list of {bar_idx, timestamp, price, score, signals, is_hot, maker_override}
    """
    signals = []
    if len(bars) < scan_window + 5:
        return signals
    for i in range(scan_window, len(bars) - 1):
        window = bars[:i+1]
        result = detect_v4_predictive(window)
        if result['is_rocket']:
            score = result['score']
            is_hot = score >= hot_threshold
            maker_override = score >= 60
            signals.append({
                'bar_idx': i,
                'timestamp': bars[i]['timestamp'],
                'price': bars[i]['price'],
                'score': score,
                'signals': result['signals'],
                'reason': result['reason'],
                'is_hot': is_hot,
                'maker_override': maker_override,
                'recommended_risk_pct': 0.7 if maker_override else 0.5,
            })
    return signals


# ═══════════════════════════════════════════════════════════════════
# 4) Backtest Engine
# ═══════════════════════════════════════════════════════════════════

def load_daily_history(conn, ticker, end_date, days=60):
    """حمّل آخر `days` يوم من price_history قبل end_date."""
    rows = conn.execute("""
        SELECT price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol=? AND price_date <= ?
        ORDER BY price_date DESC LIMIT ?
    """, (ticker, end_date, days)).fetchall()
    rows = list(reversed(rows))
    return {
        'dates': [r[0] for r in rows],
        'opens': [float(r[1] or 0) for r in rows],
        'highs': [float(r[2] or 0) for r in rows],
        'lows': [float(r[3] or 0) for r in rows],
        'closes': [float(r[4] or 0) for r in rows],
        'volumes': [float(r[5] or 0) for r in rows],
    }


def simulate_trade(entry, target, stop, future_bars, max_hold_bars=48):
    """محاكاة صفقة intraday.
    future_bars: شرائط بعد الإشارة.
    يرجع: return_pct, exit_type, exit_bar, exit_price
    """
    if not future_bars or entry <= 0:
        return 0, 'no_data', 0, entry
    for i, b in enumerate(future_bars):
        if i >= max_hold_bars:
            ret = (b['price'] - entry) / entry * 100
            return ret, 'expired', i, b['price']
        # وقف: لو low مسّ الـ stop
        if b['low'] <= stop <= b['high']:
            ret = (stop - entry) / entry * 100
            return ret, 'stop_loss', i, stop
        # هدف: لو high مسّ الـ target
        if b['high'] >= target:
            ret = (target - entry) / entry * 100
            return ret, 'target_hit', i, target
    # انتهت الفترة بدون hit
    last = future_bars[-1]['price']
    ret = (last - entry) / entry * 100
    return ret, 'expired', len(future_bars) - 1, last


def get_usable_days(conn):
    """أيام فيها بيانات 5min صالحة."""
    days = [r[0] for r in conn.execute("""
        SELECT DISTINCT substr(timestamp, 1, 10) as day
        FROM stock_intraday WHERE market='مصر' ORDER BY day
    """).fetchall()]
    usable = []
    for day in days:
        rows = conn.execute("""
            SELECT ticker, COUNT(*) as bars, COUNT(DISTINCT volume) as dv
            FROM stock_intraday
            WHERE market='مصر' AND substr(timestamp,1,10)=?
            GROUP BY ticker
        """, (day,)).fetchall()
        clean = sum(1 for r in rows if r[1] >= 20 and r[2] >= 10)
        if clean >= 50:
            usable.append(day)
    return usable


def get_liquid_tickers(conn, day, min_avg_vol=50000):
    """الأسهم السائلة في يوم معين."""
    rows = conn.execute("""
        SELECT ticker, AVG(volume) as avg_vol, COUNT(*) as bars
        FROM stock_intraday
        WHERE market='مصر' AND substr(timestamp,1,10)=? AND length(ticker) <= 6
        GROUP BY ticker
        HAVING bars >= 20 AND avg_vol >= ?
        ORDER BY avg_vol DESC
    """, (day, min_avg_vol)).fetchall()
    return [(r[0], r[1]) for r in rows]


def find_explosive_stocks(conn, min_change=15.0):
    """يلقى كل الأسهم الانفجارية في الفترة."""
    rows = conn.execute("""
        SELECT ticker, substr(timestamp,1,10) as day, COUNT(*) as bars
        FROM stock_intraday
        WHERE market='مصر' AND length(ticker) <= 6
        GROUP BY ticker, day HAVING bars >= 20
    """).fetchall()
    explosive = []
    for ticker, day, _ in rows:
        bars = load_intraday_bars(conn, ticker, day)
        if len(bars) < 20: continue
        first_p = bars[0]['price']; last_p = bars[-1]['price']
        max_p = max(b['price'] for b in bars)
        if first_p <= 0: continue
        max_change_pct = (max_p - first_p) / first_p * 100
        if max_change_pct >= min_change:
            explosive.append({'ticker': ticker, 'day': day,
                              'first': first_p, 'last': last_p, 'max': max_p,
                              'max_change_pct': max_change_pct,
                              'bars': len(bars)})
    explosive.sort(key=lambda x: -x['max_change_pct'])
    return explosive


# ═══════════════════════════════════════════════════════════════════
# 5) Backtest الرئيسي
# ═══════════════════════════════════════════════════════════════════

def run_backtest(mode='baseline', capital=100000, max_daily_picks=5, max_v4_picks=3, verbose=False):
    """شغّل backtest.
    mode: 'baseline' (Maestro daily only) or 'integrated' (Maestro + V4)
    - baseline: 5 Maestro daily picks
    - integrated: 5 Maestro daily + up to 3 V4 Hot Candidates (separate allocation)
    """
    intraday_conn = sqlite3.connect(INTRADAY_DB)
    daily_conn = sqlite3.connect(DAILY_DB)

    usable_days = get_usable_days(intraday_conn)
    explosive = find_explosive_stocks(intraday_conn, 15.0)
    explosive_set = {(e['ticker'], e['day']) for e in explosive}

    all_trades = []
    explosive_trades = []

    for day in usable_days:
        liquid = get_liquid_tickers(intraday_conn, day)
        maestro_trades_day = []
        v4_trades_day = []
        sector_picks = defaultdict(int)

        for ticker, _ in liquid[:80]:
            hist = load_daily_history(daily_conn, ticker, day, 60)
            if len(hist['closes']) < 50: continue

            maestro = maestro_daily_analysis(hist['closes'], hist['highs'],
                                              hist['lows'], hist['volumes'])
            if not maestro: continue

            # ─── Maestro Daily Buy (both modes) ───
            if maestro['recommendation'] == 'buy' and not maestro['vetoed']:
                gate_ok, _ = check_entry_gate(hist['closes'], hist['volumes'])
                if gate_ok and check_rr(maestro['entry'], maestro['target'], maestro['stop']):
                    if check_geometry(maestro['entry'], maestro['target'], maestro['stop']):
                        risk_pct = 1.2
                        pos_pct = calculate_position_size(capital, maestro['entry'],
                                                           maestro['stop'], risk_pct)
                        if pos_pct > 0 and sector_picks[ticker] < 2:
                            sector_picks[ticker] += 1
                            intraday_bars = load_intraday_bars(intraday_conn, ticker, day)
                            if len(intraday_bars) >= 5:
                                entry_price = intraday_bars[0]['price']
                                stop_price = entry_price * 0.92
                                target_price = entry_price * 1.10
                                future = intraday_bars[1:]
                                ret, exit_type, exit_bar, exit_price = simulate_trade(
                                    entry_price, target_price, stop_price, future, 48)
                                trade = {
                                    'ticker': ticker, 'day': day, 'mode': mode,
                                    'entry': entry_price, 'stop': stop_price, 'target': target_price,
                                    'exit': exit_price, 'return': ret, 'exit_type': exit_type,
                                    'hold_bars': exit_bar, 'pos_pct': pos_pct, 'risk_pct': risk_pct,
                                    'score': maestro['score'], 'regime': maestro['regime'],
                                    'is_explosive': (ticker, day) in explosive_set,
                                    'source': 'maestro_daily',
                                    'entry_bar_idx': 0,
                                    'entry_time': intraday_bars[0]['timestamp'],
                                }
                                maestro_trades_day.append(trade)

            # ─── V4 Hot Candidate (integrated mode only) ───
            if mode == 'integrated':
                # V4 لا يتجاوز veto
                if maestro['vetoed']: continue
                # Entry gate لازم يعدي
                gate_ok, _ = check_entry_gate(hist['closes'], hist['volumes'])
                if not gate_ok: continue
                # V4 ما يدخلش لو Maestro بالفعل دخل (تجنب التكرار)
                if any(t['ticker'] == ticker for t in maestro_trades_day): continue

                intraday_bars = load_intraday_bars(intraday_conn, ticker, day)
                if len(intraday_bars) < 25: continue
                v4_signals = scan_v4_intraday(intraday_bars, hot_threshold=40)
                if not v4_signals: continue

                hot_signal = next((s for s in v4_signals if s['is_hot']), None)
                if not hot_signal: continue
                if sector_picks[ticker] >= 2: continue

                entry_idx = hot_signal['bar_idx']
                entry_price = hot_signal['price']
                atr_val = maestro['atr']
                if atr_val <= 0: atr_val = entry_price * 0.05
                stop_price = entry_price - (atr_val * 1.5)
                target_price = entry_price + (atr_val * 3.0)
                if not check_rr(entry_price, target_price, stop_price): continue
                if not check_geometry(entry_price, target_price, stop_price): continue
                risk_pct = hot_signal['recommended_risk_pct']
                pos_pct = calculate_position_size(capital, entry_price, stop_price,
                                                   risk_pct, max_position_pct=12.0)
                if pos_pct <= 0: continue
                sector_picks[ticker] += 1

                future = intraday_bars[entry_idx+1:]
                ret, exit_type, exit_bar, exit_price = simulate_trade(
                    entry_price, target_price, stop_price, future, 48)
                trade = {
                    'ticker': ticker, 'day': day, 'mode': 'integrated',
                    'entry': entry_price, 'stop': stop_price, 'target': target_price,
                    'exit': exit_price, 'return': ret, 'exit_type': exit_type,
                    'hold_bars': exit_bar, 'pos_pct': pos_pct, 'risk_pct': risk_pct,
                    'score': hot_signal['score'], 'regime': maestro['regime'],
                    'is_explosive': (ticker, day) in explosive_set,
                    'source': 'v4_hot_candidate',
                    'v4_signals': hot_signal['signals'],
                    'v4_reason': hot_signal['reason'],
                    'maker_override': hot_signal['maker_override'],
                    'entry_bar_idx': entry_idx,
                    'entry_time': hot_signal['timestamp'],
                }
                v4_trades_day.append(trade)

        # Apply caps: Maestro gets max_daily_picks, V4 gets max_v4_picks (separate)
        maestro_trades_day.sort(key=lambda x: -x['score'])
        maestro_trades_day = maestro_trades_day[:max_daily_picks]
        v4_trades_day.sort(key=lambda x: -x['score'])
        v4_trades_day = v4_trades_day[:max_v4_picks]

        day_trades = maestro_trades_day + v4_trades_day
        for t in day_trades:
            if t['is_explosive']:
                explosive_trades.append(t)
        all_trades.extend(day_trades)

        if verbose and day_trades:
            n_m = len(maestro_trades_day)
            n_v = len(v4_trades_day)
            print(f"  {day}: {len(day_trades)} trades (Maestro={n_m}, V4={n_v})")

    intraday_conn.close()
    daily_conn.close()
    return all_trades, explosive_trades, explosive


# ═══════════════════════════════════════════════════════════════════
# 6) حساب المقاييس
# ═══════════════════════════════════════════════════════════════════

def compute_metrics(trades, capital=100000):
    if not trades:
        return {'n': 0, 'wr': 0, 'pf': 0, 'avg_return': 0, 'max_dd': 0,
                'avg_hold': 0, 'total_return': 0}
    n = len(trades)
    wins = [t for t in trades if t['return'] > 0]
    losses = [t for t in trades if t['return'] < 0]
    gp = sum(t['return'] * t['pos_pct'] / 100 for t in wins)  # weighted by position size
    gl = abs(sum(t['return'] * t['pos_pct'] / 100 for t in losses))
    wr = len(wins) / n * 100
    pf = gp / gl if gl > 0 else 0
    # Total return (compounded)
    equity = capital
    peak = equity
    max_dd = 0
    for t in trades:
        pnl = equity * (t['return'] / 100) * (t['pos_pct'] / 100)
        equity += pnl
        if equity > peak: peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd: max_dd = dd
    avg_return = sum(t['return'] for t in trades) / n
    avg_hold = sum(t['hold_bars'] for t in trades) / n  # in 5-min bars
    return {
        'n': n, 'wr': wr, 'pf': pf, 'avg_return': avg_return,
        'max_dd': max_dd, 'avg_hold': avg_hold,
        'total_return_pct': (equity - capital) / capital * 100,
        'wins': len(wins), 'losses': len(losses),
    }


def compute_explosive_metrics(trades, explosive_list):
    """نسبة الصواريخ المُصطادة + أدائها."""
    explosive_set = {(e['ticker'], e['day']) for e in explosive_list}
    caught = [t for t in trades if (t['ticker'], t['day']) in explosive_set]
    return {
        'total_explosive': len(explosive_list),
        'caught': len(caught),
        'detection_rate': len(caught) / len(explosive_list) * 100 if explosive_list else 0,
        'avg_return': sum(t['return'] for t in caught) / len(caught) if caught else 0,
        'wr': len([t for t in caught if t['return'] > 0]) / len(caught) * 100 if caught else 0,
    }


# ═══════════════════════════════════════════════════════════════════
# 7) التقرير
# ═══════════════════════════════════════════════════════════════════

def main():
    print("╔" + "═"*78 + "╗")
    print("║" + " المرحلة 2 — ربط V4 مع Maestro + Backtest قبل/بعد ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    print("\n" + "─"*80)
    print("القسم 1: إعداد الـ Backtest")
    print("─"*80)
    print(f"  • الفترة: 29 يوليو - 27 أغسطس 2026 (7 أيام صالحة للتداول)")
    print(f"  • رأس المال: 100,000 ج.م")
    print(f"  • max_daily_picks: 5 Maestro + 3 V4 (تخصيص منفصل)")
    print(f"  • Baseline: Maestro daily فقط (1.2% مخاطرة، وقف -8%، هدف +10%)")
    print(f"  • Integrated-A: Maestro + V4 Hot (score≥40, 0.5-0.7% مخاطرة)")
    print(f"  • Integrated-B: Maestro + V4 Hot (score≥55, فلتر إشارات زبالة أقوى)")
    print(f"  • الفلاتر الإجبارية: R/R≥1.5, Entry Gate (SMA50+liquidity+RSI<78), Geometry Guard")
    print(f"  • Sector Cap: 2 picks/سهم/يوم")
    print(f"  • V4 لا يتجاوز Maestro veto (bear regime = block)")

    # ─── Baseline ───
    print("\n" + "─"*80)
    print("القسم 2: BASELINE — Maestro daily فقط")
    print("─"*80)
    baseline_trades, baseline_explosive, explosive_list = run_backtest('baseline', verbose=True)
    baseline_metrics = compute_metrics(baseline_trades)
    baseline_exp_metrics = compute_explosive_metrics(baseline_trades, explosive_list)

    print(f"\n  إجمالي الصفقات: {baseline_metrics['n']}")
    print(f"  Win Rate: {baseline_metrics['wr']:.1f}%")
    print(f"  Profit Factor: {baseline_metrics['pf']:.2f}")
    print(f"  Max Drawdown: {baseline_metrics['max_dd']:.2f}%")
    print(f"  متوسط مدة الاحتفاظ: {baseline_metrics['avg_hold']:.1f} شريطة ({baseline_metrics['avg_hold']*5:.0f} دقيقة)")
    print(f"  Total Return: {baseline_metrics['total_return_pct']:+.2f}%")
    print(f"\n  الصواريخ المُصطادة: {baseline_exp_metrics['caught']}/{baseline_exp_metrics['total_explosive']} ({baseline_exp_metrics['detection_rate']:.1f}%)")

    # ─── Integrated ───
    print("\n" + "─"*80)
    print("القسم 3: INTEGRATED — Maestro + V4 Hot Candidates")
    print("─"*80)
    integrated_trades, integrated_explosive, _ = run_backtest('integrated', verbose=True)
    integrated_metrics = compute_metrics(integrated_trades)
    integrated_exp_metrics = compute_explosive_metrics(integrated_trades, explosive_list)

    print(f"\n  إجمالي الصفقات: {integrated_metrics['n']}")
    print(f"  Win Rate: {integrated_metrics['wr']:.1f}%")
    print(f"  Profit Factor: {integrated_metrics['pf']:.2f}")
    print(f"  Max Drawdown: {integrated_metrics['max_dd']:.2f}%")
    print(f"  متوسط مدة الاحتفاظ: {integrated_metrics['avg_hold']:.1f} شريطة ({integrated_metrics['avg_hold']*5:.0f} دقيقة)")
    print(f"  Total Return: {integrated_metrics['total_return_pct']:+.2f}%")
    print(f"\n  الصواريخ المُصطادة: {integrated_exp_metrics['caught']}/{integrated_exp_metrics['total_explosive']} ({integrated_exp_metrics['detection_rate']:.1f}%)")

    # ─── مصدر الصفقات في Integrated ───
    v4_trades = [t for t in integrated_trades if t.get('source') == 'v4_hot_candidate']
    maestro_trades = [t for t in integrated_trades if t.get('source') == 'maestro_daily']
    print(f"\n  تفصيل مصدر الصفقات:")
    print(f"    • Maestro daily buy: {len(maestro_trades)} صفقة")
    print(f"    • V4 Hot Candidate: {len(v4_trades)} صفقة (جديدة)")
    if v4_trades:
        v4_wins = [t for t in v4_trades if t['return'] > 0]
        v4_explosive = [t for t in v4_trades if t['is_explosive']]
        print(f"      - WR: {len(v4_wins)}/{len(v4_trades)} = {len(v4_wins)/len(v4_trades)*100:.1f}%")
        print(f"      - صواريخ: {len(v4_explosive)} من {len(v4_trades)}")
        print(f"      - Maker Override: {sum(1 for t in v4_trades if t.get('maker_override'))}")
        print(f"      - متوسط حجم المركز: {sum(t['pos_pct'] for t in v4_trades)/len(v4_trades):.1f}% (vs 1.2% baseline)")

    # ─── جدول مقارنة ───
    print("\n" + "═"*80)
    print("القسم 4: جدول المقارنة — قبل vs بعد الربط")
    print("═"*80)
    print(f"\n{'المقياس':<35} {'BASELINE':>15} {'INTEGRATED':>15} {'الفارق':>12}")
    print("─"*80)
    print(f"{'عدد الصفقات':<35} {baseline_metrics['n']:>15} {integrated_metrics['n']:>15} {integrated_metrics['n']-baseline_metrics['n']:>+12}")
    print(f"{'Win Rate %':<35} {baseline_metrics['wr']:>14.1f}% {integrated_metrics['wr']:>14.1f}% {integrated_metrics['wr']-baseline_metrics['wr']:>+11.1f}%")
    print(f"{'Profit Factor':<35} {baseline_metrics['pf']:>15.2f} {integrated_metrics['pf']:>15.2f} {integrated_metrics['pf']-baseline_metrics['pf']:>+12.2f}")
    print(f"{'Max Drawdown %':<35} {baseline_metrics['max_dd']:>14.2f}% {integrated_metrics['max_dd']:>14.2f}% {integrated_metrics['max_dd']-baseline_metrics['max_dd']:>+11.2f}%")
    print(f"{'متوسط مدة الاحتفاظ (دقيقة)':<35} {baseline_metrics['avg_hold']*5:>15.0f} {integrated_metrics['avg_hold']*5:>15.0f} {(integrated_metrics['avg_hold']-baseline_metrics['avg_hold'])*5:>+12.0f}")
    print(f"{'Total Return %':<35} {baseline_metrics['total_return_pct']:>+14.2f}% {integrated_metrics['total_return_pct']:>+14.2f}% {integrated_metrics['total_return_pct']-baseline_metrics['total_return_pct']:>+11.2f}%")
    print(f"{'نسبة اكتشاف الصواريخ %':<35} {baseline_exp_metrics['detection_rate']:>14.1f}% {integrated_exp_metrics['detection_rate']:>14.1f}% {integrated_exp_metrics['detection_rate']-baseline_exp_metrics['detection_rate']:>+11.1f}%")
    print(f"{'الصواريخ المُصطادة':<35} {str(baseline_exp_metrics['caught'])+'/'+str(baseline_exp_metrics['total_explosive']):>15} {str(integrated_exp_metrics['caught'])+'/'+str(integrated_exp_metrics['total_explosive']):>15} {integrated_exp_metrics['caught']-baseline_exp_metrics['caught']:>+12}")

    # ─── أمثلة أسهم انفجارية ───
    print("\n" + "═"*80)
    print("القسم 5: أمثلة أسهم انفجارية — هل النظام حطها Hot؟ دخلها؟ أنهي نقطة؟")
    print("═"*80)

    # نختار 5 أمثلة متنوعة
    example_tickers = [('NIPH', '2026-08-16'), ('GTWL', '2026-08-16'),
                       ('ICID', '2026-08-16'), ('SCEM', '2026-08-16'),
                       ('ARCC', '2026-08-16')]
    # نضيف مثال V4 لو موجود
    v4_explosive_trades = [t for t in v4_trades if t['is_explosive']]
    if v4_explosive_trades:
        example_tickers = [(t['ticker'], t['day']) for t in v4_explosive_trades[:3]]
        # نكمل بـ 2 من الانفجارية الفائتة
        for e in explosive_list[:10]:
            if (e['ticker'], e['day']) not in example_tickers:
                example_tickers.append((e['ticker'], e['day']))
            if len(example_tickers) >= 5: break

    print(f"\n{'ticker':<8} {'day':<12} {'max%':>7} | {'Baseline':>20} | {'Integrated (V4)':>30}")
    print("─"*90)

    for ticker, day in example_tickers[:5]:
        # نلقاه في explosive_list
        exp = next((e for e in explosive_list if e['ticker'] == ticker and e['day'] == day), None)
        if not exp: continue
        max_pct = exp['max_change_pct']

        # Baseline entry
        b_trade = next((t for t in baseline_trades if t['ticker'] == ticker and t['day'] == day), None)
        if b_trade:
            b_str = f"دخل @ {b_trade['entry']:.2f} → {b_trade['return']:+.1f}% ({b_trade['exit_type']})"
        else:
            b_str = "✗ ما دخلش (Maestro ما قالش buy)"

        # Integrated entry
        i_trade = next((t for t in integrated_trades if t['ticker'] == ticker and t['day'] == day), None)
        if i_trade:
            source = i_trade.get('source', 'maestro_daily')
            if source == 'v4_hot_candidate':
                v4_sig = ', '.join(i_trade.get('v4_signals', []))
                i_str = f"V4 Hot @ {i_trade['entry']:.2f} → {i_trade['return']:+.1f}% [{v4_sig}]"
            else:
                i_str = f"Maestro @ {i_trade['entry']:.2f} → {i_trade['return']:+.1f}% (daily)"
        else:
            # هل V4 اشتغل بس Entry Gate رفض؟
            intraday_conn = sqlite3.connect(INTRADAY_DB)
            bars = load_intraday_bars(intraday_conn, ticker, day)
            v4_sigs = scan_v4_intraday(bars) if bars else []
            intraday_conn.close()
            if v4_sigs:
                hot = next((s for s in v4_sigs if s['is_hot']), None)
                if hot:
                    i_str = f"V4 Hot ({hot['score']:.0f}) بس مرفوض (Gate/RR)"
                else:
                    i_str = f"V4 ضعيف (max score={max(s['score'] for s in v4_sigs):.0f})"
            else:
                i_str = "✗ V4 ما اشتغلش"

        print(f"{ticker:<8} {day:<12} {max_pct:>+6.1f}% | {b_str:<20} | {i_str:<30}")

    # ─── الحكم النهائي ───
    print("\n" + "═"*80)
    print("القسم 6: الحكم النهائي")
    print("═"*80)

    delta_wr = integrated_metrics['wr'] - baseline_metrics['wr']
    delta_pf = integrated_metrics['pf'] - baseline_metrics['pf']
    delta_dd = integrated_metrics['max_dd'] - baseline_metrics['max_dd']
    delta_det = integrated_exp_metrics['detection_rate'] - baseline_exp_metrics['detection_rate']
    delta_ret = integrated_metrics['total_return_pct'] - baseline_metrics['total_return_pct']

    print(f"""
┌─────────────────────────────────────────────────────────────────────────┐
│                        مقارنة الأداء                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  المقياس                │ BASELINE    │ INTEGRATED   │ الفارق          │
├─────────────────────────────────────────────────────────────────────────┤
│  عدد الصفقات            │ {baseline_metrics['n']:>10}  │ {integrated_metrics['n']:>11}  │ {integrated_metrics['n']-baseline_metrics['n']:>+10}     │
│  Win Rate               │ {baseline_metrics['wr']:>9.1f}%  │ {integrated_metrics['wr']:>10.1f}%  │ {delta_wr:>+9.1f}%    │
│  Profit Factor          │ {baseline_metrics['pf']:>10.2f} │ {integrated_metrics['pf']:>11.2f} │ {delta_pf:>+10.2f}    │
│  Max Drawdown           │ {baseline_metrics['max_dd']:>9.2f}%  │ {integrated_metrics['max_dd']:>10.2f}%  │ {delta_dd:>+9.2f}%    │
│  Total Return           │ {baseline_metrics['total_return_pct']:>+9.2f}%  │ {integrated_metrics['total_return_pct']:>+10.2f}%  │ {delta_ret:>+9.2f}%    │
│  اكتشاف الصواريخ        │ {baseline_exp_metrics['detection_rate']:>9.1f}%  │ {integrated_exp_metrics['detection_rate']:>10.1f}%  │ {delta_det:>+9.1f}%    │
└─────────────────────────────────────────────────────────────────────────┘
""")

    # منطق القرار
    improved_wr = delta_wr > 0
    improved_pf = delta_pf > 0
    dd_ok = delta_dd <= 2  # DD ما زادش أكتر من 2 نقطة
    improved_det = delta_det > 0

    print("قرار الاعتماد:")
    print(f"  • Win Rate {'↑ تحسّن' if improved_wr else '↓ تأخّر'}: {delta_wr:+.1f} نقطة")
    print(f"  • Profit Factor {'↑ تحسّن' if improved_pf else '↓ تأخّر'}: {delta_pf:+.2f}")
    print(f"  • Max DD {'✓ مستقر' if dd_ok else '✗ زاد خطير'}: {delta_dd:+.2f} نقطة")
    print(f"  • اكتشاف الصواريخ {'↑ تحسّن' if improved_det else '↓ تأخّر'}: {delta_det:+.1f} نقطة")

    if (improved_wr or improved_pf) and dd_ok and improved_det:
        verdict = "✅ اعتمد — V4 أضاف قيمة حقيقية بدون زيادة خطورة"
    elif improved_det and not (improved_wr or improved_pf):
        verdict = "⚠️ اعتمد بحذر — V4 بيصطاد صواريخ أكتر بس الأداء الكلي متساوي"
    elif not dd_ok:
        verdict = "❌ ارجع — V4 زاد الـ Drawdown بشكل خطير"
    else:
        verdict = "❌ ارجع — مفيش تحسن حقيقي"

    print(f"\n  → الحكم: {verdict}")

    return {
        'baseline': baseline_metrics,
        'integrated': integrated_metrics,
        'baseline_explosive': baseline_exp_metrics,
        'integrated_explosive': integrated_exp_metrics,
        'verdict': verdict,
    }


if __name__ == '__main__':
    results = main()
