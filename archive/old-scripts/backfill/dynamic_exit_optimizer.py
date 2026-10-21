#!/usr/bin/env python3
"""
Dynamic Exit Policy Optimizer (P0-v16)
======================================
يقارن سياسة الخروج الحالية (partial_1r_trailing) بالسياسة الديناميكية الجديدة
اللي بـ re-evaluate الـ momentum/trend كل يوم و تقرر: HOLD_EXTEND / HOLD_RECOVER / EXIT.

الهدف: قياس هل السياسة الديناميكية بـ تـ boost avg win من +6.2% لـ +100%؟

المنهجية:
  1. Scan price_history.db (real VPS data — 274k candles, 762 tickers) لـ entry signals
     (momentum breakout: 5d momentum >= 8% + volume >= 1.2× + close > SMA20)
  2. لكل entry: entry_price = close, stop = close × 0.90, target = close × 1.10, atr = ATR(14)
  3. Forward-simulate 90 days تحت 3 سياسات:
     - Policy A: Production (partial_1r_trailing — sell 50% at 1R, trail 2×ATR, max 35d)
     - Policy B: Dynamic Universal (momentum re-eval daily, hold/extend/exit, max 90d)
     - Policy C: Fixed target/stop (baseline — exit at target or stop)
  4. Report: WR, avg win, avg loss, PF, max gain, % trades > +50%, % trades > +100%, notification count

Usage:
  python3 scripts/dynamic_exit_optimizer.py [--min-momentum 8] [--top 500] [--max-days 90]
"""
import argparse
import sqlite3
import statistics
from pathlib import Path
from typing import List, Dict, Optional, Tuple

_DB = Path(__file__).resolve().parent.parent.parent / 'db' / 'vps_real' / 'price_history.db'


def load_all_prices(db_path: Path) -> Dict[str, List[dict]]:
    """Load all tickers' price history into memory."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT ticker, date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        ORDER BY ticker, date
    """)
    by_ticker: Dict[str, List[dict]] = {}
    for r in cur.fetchall():
        by_ticker.setdefault(r['ticker'], []).append({
            'date': r['date'],
            'open': float(r['open_price'] or 0),
            'high': float(r['high_price'] or 0),
            'low': float(r['low_price'] or 0),
            'close': float(r['close_price'] or 0),
            'volume': float(r['volume'] or 0),
        })
    conn.close()
    return by_ticker


def compute_atr(bars: List[dict], period: int = 14) -> float:
    """ATR(14) on the last `period` bars."""
    if len(bars) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(bars)):
        h = bars[i]['high']; l = bars[i]['low']; pc = bars[i-1]['close']
        if h <= 0 or l <= 0 or pc <= 0:
            continue
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return 0.0
    return sum(trs[-period:]) / period


def compute_sma(bars: List[dict], period: int) -> float:
    """SMA on close of the last `period` bars."""
    if len(bars) < period:
        return 0.0
    closes = [b['close'] for b in bars[-period:] if b['close'] > 0]
    if len(closes) < period:
        return 0.0
    return sum(closes) / period


def compute_rsi(bars: List[dict], period: int = 14) -> float:
    """RSI(14)."""
    if len(bars) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(bars)):
        prev = bars[i-1]['close']; cur = bars[i]['close']
        if prev <= 0 or cur <= 0:
            continue
        chg = cur - prev
        gains.append(max(0, chg)); losses.append(max(0, -chg))
    if len(gains) < period:
        return 50.0
    avg_g = sum(gains[-period:]) / period
    avg_l = sum(losses[-period:]) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))


def compute_momentum(bars: List[dict], lookback: int) -> float:
    """% momentum over `lookback` days."""
    if len(bars) < lookback + 1:
        return 0.0
    past = bars[-(lookback+1)]['close']; cur = bars[-1]['close']
    if past <= 0:
        return 0.0
    return (cur - past) / past * 100


def scan_entries(all_prices: Dict[str, List[dict]], min_momentum: float = 8.0,
                 min_vol_ratio: float = 1.2, top: int = 500) -> List[dict]:
    """Scan for breakout entry signals. Returns list of {ticker, entry_idx, entry_price, stop, target, atr}."""
    entries = []
    for ticker, bars in all_prices.items():
        if len(bars) < 60:
            continue
        for i in range(50, len(bars) - 90):  # need 90 forward days
            window = bars[:i+1]
            m5 = compute_momentum(window, 5)
            if m5 < min_momentum:
                continue
            sma20 = compute_sma(window, 20)
            if sma20 <= 0 or window[-1]['close'] <= sma20:
                continue  # not above SMA20
            # volume ratio
            vols = [b['volume'] for b in window[-20:] if b['volume'] > 0]
            if len(vols) < 10:
                continue
            avg_vol = sum(vols) / len(vols)
            if avg_vol <= 0 or window[-1]['volume'] < avg_vol * min_vol_ratio:
                continue
            # Also require 20d momentum positive (trend up)
            m20 = compute_momentum(window, 20)
            if m20 < 0:
                continue
            atr = compute_atr(window, 14)
            if atr <= 0:
                continue
            close = window[-1]['close']
            # ATR-based stop: max(2×ATR, 8% of close) — more realistic than fixed 10%
            stop_dist = max(2.0 * atr, 0.08 * close)
            stop_loss = close - stop_dist
            # Target: 3×ATR (trend-follow initial target — gets raised dynamically)
            target_price = close + 3.0 * atr
            entries.append({
                'ticker': ticker,
                'entry_idx': i,
                'entry_date': bars[i]['date'],
                'entry_price': close,
                'stop_loss': stop_loss,
                'target_price': target_price,
                'atr': atr,
                'momentum_5d': m5,
                'momentum_20d': m20,
                'sma20': sma20,
            })
            if len(entries) >= top:
                return entries
    return entries


# ──────────────────────────────────────────────────────────────────────────
# POLICY A: Production (partial_1r_trailing) — caps winners at +7%
# ──────────────────────────────────────────────────────────────────────────
def simulate_policy_A(entry: dict, bars: List[dict], max_days: int = 35) -> Optional[dict]:
    """Production exit: sell 50% at 1R, trail 2×ATR, max 35 days."""
    entry_price = entry['entry_price']
    stop_loss = entry['stop_loss']
    target_price = entry['target_price']
    atr = entry['atr']
    risk = entry_price - stop_loss  # 1R
    target_1r = entry_price + risk   # = entry × 1.10

    start_idx = entry['entry_idx']
    partial_done = False
    partial_ret = 0.0
    partial_frac = 0.50
    trailing_stop = stop_loss
    highest = entry_price
    lowest = entry_price

    for j in range(start_idx + 1, min(start_idx + 1 + max_days, len(bars))):
        day = bars[j]
        high = day['high']; low = day['low']; close = day['close']
        if high <= 0 or low <= 0 or close <= 0:
            continue
        # data sanity
        if high > entry_price * 5 or low < entry_price * 0.2:
            continue
        highest = max(highest, high)
        lowest = min(lowest, low)

        # hard stop
        if low <= stop_loss:
            ret = partial_ret * partial_frac + ((stop_loss - entry_price) / entry_price * 100) * (1 - partial_frac)
            return {'return_pct': ret, 'exit_type': 'stop_loss', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest}

        # partial at 1R
        if not partial_done and high >= target_1r:
            partial_ret = (target_1r - entry_price) / entry_price * 100
            partial_done = True
            trailing_stop = max(trailing_stop, highest - 2.0 * atr)

        # trailing after partial
        if partial_done:
            trailing_stop = max(trailing_stop, highest - 2.0 * atr)
            if low <= trailing_stop:
                final_ret = (trailing_stop - entry_price) / entry_price * 100
                ret = partial_ret * partial_frac + final_ret * (1 - partial_frac)
                return {'return_pct': ret, 'exit_type': 'trailing', 'days': j - start_idx,
                        'highest': highest, 'lowest': lowest}

        # expiry
        if j - start_idx >= max_days:
            final_ret = (close - entry_price) / entry_price * 100
            ret = partial_ret * partial_frac + final_ret * (1 - partial_frac) if partial_done else final_ret
            return {'return_pct': ret, 'exit_type': 'expired', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest}

    return {'return_pct': 0.0, 'exit_type': 'pending', 'days': max_days,
            'highest': highest, 'lowest': lowest}


# ──────────────────────────────────────────────────────────────────────────
# POLICY B: Universal Dynamic Exit (momentum re-eval daily) — THE NEW LOGIC
# ──────────────────────────────────────────────────────────────────────────
def simulate_policy_B(entry: dict, bars: List[dict], max_days: int = 90) -> Optional[dict]:
    """Universal dynamic exit: re-evaluate momentum/trend each day.

    Rules:
      1. HARD STOP: low <= stop_loss → STOPPED
      2. TARGET-HIT-WITH-MOMENTUM: high >= target AND momentum_strong AND trend_intact
         → HOLD + raise target (new = max(close×1.15, entry×1.5)) + notify "كمل"
      3. DIP-WITH-ANALYSIS-OK: gain<0 AND trend_intact AND momentum_recovering
         → HOLD + notify "ثبّت" (once)
      4. TREND-BREAK: NOT trend_intact AND gain >= 5% → EXIT (lock profit)
      5. MOMENTUM-DEAD: momentum_5d < -5 AND momentum_20d < -3 AND gain >= 0 → EXIT
      6. EXTREME-PROFIT: gain >= 100% → EXIT (doubled)
      7. TIME: days >= 90 → EXIT
    """
    entry_price = entry['entry_price']
    stop_loss_orig = entry['stop_loss']
    target_price = entry['target_price']

    start_idx = entry['entry_idx']
    highest = entry_price
    lowest = entry_price
    current_target = target_price
    # Dynamic stop — starts at original, moves to breakeven then trails
    current_stop = stop_loss_orig
    notified_extend = 0
    notified_hold = 0
    notified_breakeven = 0
    notifications = []
    days_below_sma20 = 0  # track consecutive closes below SMA20 for trend-break

    for j in range(start_idx + 1, min(start_idx + 1 + max_days, len(bars))):
        day = bars[j]
        high = day['high']; low = day['low']; close = day['close']
        if high <= 0 or low <= 0 or close <= 0:
            continue
        # data sanity
        if high > entry_price * 5 or low < entry_price * 0.2:
            continue
        highest = max(highest, high)
        lowest = min(lowest, low)

        # ── Rule 1: HARD/DYNAMIC STOP (non-negotiable) ──
        if low <= current_stop:
            ret = (current_stop - entry_price) / entry_price * 100
            exit_label = 'breakeven' if current_stop >= entry_price * 0.99 else (
                'trailing_lock' if current_stop > stop_loss_orig and current_stop < entry_price * 1.10
                else 'stop_loss')
            return {'return_pct': ret, 'exit_type': exit_label, 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest, 'notifications': notifications,
                    'final_target': current_target}

        # ── Re-evaluate indicators using bars up to and including today ──
        window = bars[:j+1]
        m5 = compute_momentum(window, 5)
        m20 = compute_momentum(window, 20)
        sma20 = compute_sma(window, 20)
        sma50 = compute_sma(window, 50) if len(window) >= 50 else sma20
        rsi = compute_rsi(window, 14)
        gain_pct = (close - entry_price) / entry_price * 100
        peak_gain_pct = (highest - entry_price) / entry_price * 100
        # Track consecutive days below SMA20 (trend-break needs 2 days, not 1)
        if sma20 > 0 and close < sma20:
            days_below_sma20 += 1
        else:
            days_below_sma20 = 0
        trend_intact = (sma20 > 0 and close > sma20) and (m5 >= -2.0)
        trend_broken = (days_below_sma20 >= 2)  # 2 consecutive closes below SMA20
        momentum_strong = (m5 > 3.0) or (m20 > 8.0)
        momentum_dead = (m5 < -5.0) and (m20 < -3.0)

        # ── Rule 1.5: BREAKEVEN STOP — after gain >= 10%, move stop to entry ──
        # بس بعد ربح متين (10%) عشان مـ نـ triggerش على ضوضاء صغيرة.
        if peak_gain_pct >= 10.0 and current_stop < entry_price and notified_breakeven == 0:
            current_stop = entry_price  # breakeven
            notified_breakeven = 1
            notifications.append({
                'type': 'BREAKEVEN_LOCK',
                'day': j - start_idx,
                'price': close,
                'gain_pct': gain_pct,
                'message': 'تم نقل الوقف لنقطة الدخول — رأس المال مضمون',
            })

        # ── Rule 1.6: TRAILING PROFIT LOCK — after gain >= 40%, trail at highest×0.70 ──
        # بس للفايزين الكبار (40%+) عشان مـ نـ capش الفايزين الصغيرين. trail عند 70% من القمة
        # بـ يـ leave room للسهم يكمل لـ +100%.
        if peak_gain_pct >= 40.0:
            trail_candidate = highest * 0.70
            if trail_candidate > current_stop:
                current_stop = trail_candidate

        # ── Rule 2: TARGET-HIT-WITH-MOMENTUM → HOLD + RAISE TARGET + NOTIFY ──
        if high >= current_target and momentum_strong and trend_intact:
            new_target = max(close * 1.15, entry_price * 1.50)
            if new_target > current_target:
                notified_extend += 1
                notifications.append({
                    'type': 'HOLD_EXTEND',
                    'day': j - start_idx,
                    'price': close,
                    'gain_pct': gain_pct,
                    'old_target': current_target,
                    'new_target': new_target,
                    'momentum_5d': m5,
                    'momentum_20d': m20,
                    'rsi': rsi,
                    'message': 'كمل — لسة فية زخم، المستهدف اترفع',
                })
                current_target = new_target
            # continue holding — DO NOT exit

        # ── Rule 3: DIP-WITH-ANALYSIS-OK → HOLD + NOTIFY (once per dip) ──
        if gain_pct < 0 and trend_intact and m5 > -2.0 and notified_hold == 0:
            notified_hold += 1
            notifications.append({
                'type': 'HOLD_RECOVER',
                'day': j - start_idx,
                'price': close,
                'gain_pct': gain_pct,
                'momentum_5d': m5,
                'momentum_20d': m20,
                'rsi': rsi,
                'message': 'ثبّت — التحليل بيقول لسة فرصة، نكمل',
            })
        if gain_pct >= 3.0:
            notified_hold = 0

        # ── Rule 4: TREND-BREAK after gain >= 5% → EXIT (2 days below SMA20) ──
        if trend_broken and gain_pct >= 5.0:
            ret = (close - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'trend_break', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest, 'notifications': notifications,
                    'final_target': current_target}

        # ── Rule 5: MOMENTUM-DEAD → EXIT (get out while even/up) ──
        if momentum_dead and gain_pct >= 0:
            ret = (close - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'momentum_dead', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest, 'notifications': notifications,
                    'final_target': current_target}

        # ── Rule 6: EXTREME-PROFIT → EXIT (doubled — take the win) ──
        if gain_pct >= 100.0:
            ret = (close - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'target_100pct', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest, 'notifications': notifications,
                    'final_target': current_target}

        # ── Rule 7: TIME expiry ──
        if j - start_idx >= max_days:
            ret = (close - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'expired', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest, 'notifications': notifications,
                    'final_target': current_target}

    return {'return_pct': 0.0, 'exit_type': 'pending', 'days': max_days,
            'highest': highest, 'lowest': lowest, 'notifications': notifications,
            'final_target': current_target}


# ──────────────────────────────────────────────────────────────────────────
# POLICY C: Fixed target/stop (baseline)
# ──────────────────────────────────────────────────────────────────────────
def simulate_policy_C(entry: dict, bars: List[dict], max_days: int = 35) -> Optional[dict]:
    """Baseline: exit at target or stop, max 35 days."""
    entry_price = entry['entry_price']
    stop_loss = entry['stop_loss']
    target_price = entry['target_price']
    start_idx = entry['entry_idx']
    highest = entry_price; lowest = entry_price

    for j in range(start_idx + 1, min(start_idx + 1 + max_days, len(bars))):
        day = bars[j]
        high = day['high']; low = day['low']; close = day['close']
        if high <= 0 or low <= 0 or close <= 0:
            continue
        if high > entry_price * 5 or low < entry_price * 0.2:
            continue
        highest = max(highest, high); lowest = min(lowest, low)
        if high >= target_price:
            return {'return_pct': (target_price - entry_price) / entry_price * 100,
                    'exit_type': 'target_hit', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest}
        if low <= stop_loss:
            return {'return_pct': (stop_loss - entry_price) / entry_price * 100,
                    'exit_type': 'stop_loss', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest}
        if j - start_idx >= max_days:
            return {'return_pct': (close - entry_price) / entry_price * 100,
                    'exit_type': 'expired', 'days': j - start_idx,
                    'highest': highest, 'lowest': lowest}
    return {'return_pct': 0.0, 'exit_type': 'pending', 'days': max_days,
            'highest': highest, 'lowest': lowest}


def summarize(name: str, results: List[dict]) -> dict:
    if not results:
        return {'name': name, 'n': 0}
    wins = [r for r in results if r['return_pct'] > 0]
    losses = [r for r in results if r['return_pct'] <= 0]
    avg_win = statistics.mean([r['return_pct'] for r in wins]) if wins else 0
    avg_loss = statistics.mean([r['return_pct'] for r in losses]) if losses else 0
    total_win = sum(r['return_pct'] for r in wins)
    total_loss = abs(sum(r['return_pct'] for r in losses))
    pf = total_win / total_loss if total_loss > 0 else float('inf')
    max_gain = max(r['return_pct'] for r in results)
    over_50 = len([r for r in results if r['return_pct'] >= 50])
    over_100 = len([r for r in results if r['return_pct'] >= 100])
    exit_types = {}
    for r in results:
        exit_types[r['exit_type']] = exit_types.get(r['exit_type'], 0) + 1
    return {
        'name': name,
        'n': len(results),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': len(wins) / len(results) * 100,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'pf': pf,
        'max_gain': max_gain,
        'over_50pct': over_50,
        'over_100pct': over_100,
        'exit_types': exit_types,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-momentum', type=float, default=8.0)
    ap.add_argument('--min-vol-ratio', type=float, default=1.2)
    ap.add_argument('--top', type=int, default=500)
    ap.add_argument('--max-days', type=int, default=90)
    args = ap.parse_args()

    print(f"\n{'='*78}")
    print("DYNAMIC EXIT POLICY OPTIMIZER (P0-v16)")
    print(f"  DB: {_DB}")
    print(f"  min_momentum={args.min_momentum}%  min_vol_ratio={args.min_vol_ratio}x  top={args.top}")
    print(f"{'='*78}\n")

    if not _DB.exists():
        print(f"[ERROR] DB not found: {_DB}")
        return

    print("[1/3] Loading price history...")
    all_prices = load_all_prices(_DB)
    print(f"      Loaded {len(all_prices)} tickers")

    print("[2/3] Scanning for breakout entries...")
    entries = scan_entries(all_prices, min_momentum=args.min_momentum,
                           min_vol_ratio=args.min_vol_ratio, top=args.top)
    print(f"      Found {len(entries)} entries\n")
    if not entries:
        print("[ERROR] No entries found. Try --min-momentum 6 or --min-vol-ratio 1.1")
        return

    print(f"[3/3] Simulating {len(entries)} entries × 3 policies...\n")
    results_A, results_B, results_C = [], [], []
    notif_counts = {'HOLD_EXTEND': 0, 'HOLD_RECOVER': 0, 'BREAKEVEN_LOCK': 0}
    for e in entries:
        bars = all_prices[e['ticker']]
        ra = simulate_policy_A(e, bars, max_days=35)
        rb = simulate_policy_B(e, bars, max_days=args.max_days)
        rc = simulate_policy_C(e, bars, max_days=35)
        if ra: results_A.append(ra)
        if rb:
            results_B.append(rb)
            for n in rb.get('notifications', []):
                if n['type'] in notif_counts:
                    notif_counts[n['type']] += 1
        if rc: results_C.append(rc)

    sA = summarize('A: Production (partial 1R, 35d)', results_A)
    sB = summarize('B: Dynamic Universal (90d)', results_B)
    sC = summarize('C: Fixed target/stop (35d)', results_C)

    print(f"{'Metric':<32} {'Policy A':>14} {'Policy B':>14} {'Policy C':>14}")
    print(f"{'-'*32} {'-'*14} {'-'*14} {'-'*14}")
    print(f"{'Trades':<32} {sA['n']:>14} {sB['n']:>14} {sC['n']:>14}")
    print(f"{'Wins':<32} {sA['wins']:>14} {sB['wins']:>14} {sC['wins']:>14}")
    print(f"{'Losses':<32} {sA['losses']:>14} {sB['losses']:>14} {sC['losses']:>14}")
    print(f"{'Win Rate %':<32} {sA['win_rate']:>13.1f}% {sB['win_rate']:>13.1f}% {sC['win_rate']:>13.1f}%")
    print(f"{'Avg Win %':<32} {sA['avg_win']:>+13.2f}% {sB['avg_win']:>+13.2f}% {sC['avg_win']:>+13.2f}%")
    print(f"{'Avg Loss %':<32} {sA['avg_loss']:>+13.2f}% {sB['avg_loss']:>+13.2f}% {sC['avg_loss']:>+13.2f}%")
    print(f"{'Profit Factor':<32} {sA['pf']:>14.2f} {sB['pf']:>14.2f} {sC['pf']:>14.2f}")
    print(f"{'Max Gain %':<32} {sA['max_gain']:>+13.2f}% {sB['max_gain']:>+13.2f}% {sC['max_gain']:>+13.2f}%")
    print(f"{'Trades >= +50%':<32} {sA['over_50pct']:>14} {sB['over_50pct']:>14} {sC['over_50pct']:>14}")
    print(f"{'Trades >= +100%':<32} {sA['over_100pct']:>14} {sB['over_100pct']:>14} {sC['over_100pct']:>14}")
    print()
    print(f"{'Exit types (Policy B):'}")
    for k, v in sorted(sB['exit_types'].items(), key=lambda x: -x[1]):
        print(f"  {k:<20} {v:>6}")
    print()
    print(f"{'Notifications (Policy B):'}")
    print(f"  HOLD_EXTEND    (كمل — لسة زخم، ارفع المستهدف): {notif_counts['HOLD_EXTEND']}")
    print(f"  HOLD_RECOVER   (ثبّت — التحليل كويس، نكمل):      {notif_counts['HOLD_RECOVER']}")
    print(f"  BREAKEVEN_LOCK (الوقف اتنقل لنقطة الدخول):       {notif_counts['BREAKEVEN_LOCK']}")
    print()

    # Top 5 trades by return under Policy B (to show the +100% capture)
    print(f"{'Top 5 trades under Policy B (Dynamic):'}")
    top5 = sorted(results_B, key=lambda r: r['return_pct'], reverse=True)[:5]
    for i, r in enumerate(top5, 1):
        notif_count = len(r.get('notifications', []))
        print(f"  {i}. return={r['return_pct']:+.1f}%  days={r['days']}  "
              f"type={r['exit_type']}  notifs={notif_count}  final_target={r.get('final_target',0):.2f}")
    print()
    print(f"{'='*78}")
    print("الخلاصة: Policy B (Dynamic) لو avg_win > Policy A → نـ port للإنتاج.")
    print(f"{'='*78}\n")


if __name__ == '__main__':
    main()
