#!/usr/bin/env python3
"""
canonical_flow.py — المحرك الموحد للسيولة (Canonical Liquidity Classifier)
=============================================================================
BRAVO Mission 1: دالة مركزية تحكم المنصة كلها — 5 حالات حصرية مانعة للتداخل.

  1. whale_inflow:        صافي 5ج > +2M AND price > MA20 AND RSI < 68
  2. whale_outflow:       صافي 5ج < -2M AND (price < MA20 OR broke 5-day low)
  3. bottom_absorption:  تدفق +500K..+5M AND ضمن 8% من 52w low AND ATR منخفض
  4. correction_exhaustion: هبوط >=8% في 15ج AND شمعة اليوم خضراء عاكسة AND R/R>=1.8
  5. neutral:             أي سهم لا يحقق ما سبق

قاعدة حديدية: مستحيل لسهم أن يتواجد في قائمتين في نفس اللحظة.

Rule 27: أرقام حقيقية. mode=ro. لا except-pass.
"""
from __future__ import annotations
import sys, os, sqlite3
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass

_VPS = str(Path(__file__).resolve().parents[1])
if _VPS not in sys.path:
    sys.path.insert(0, _VPS)

try:
    from analyzers.indicators.atr import calc_atr as _canonical_atr
except Exception:
    _canonical_atr = None


def _f(v, d=0.0):
    if v is None: return d
    try: return float(str(v).replace('−','-').strip())
    except: return d


def _ema(data, period=20):
    if len(data) < period: return sum(data)/len(data) if data else 0.0
    k = 2/(period+1)
    e = sum(data[:period])/period
    for p in data[period:]: e = (p-e)*k+e
    return e


def _compute_atr(highs, lows, closes, period=14):
    if _canonical_atr:
        r = _canonical_atr(highs, lows, closes, period)
        if r is not None: return r
    if len(closes) < 2: return 0.0
    trs = []
    for i in range(1, len(closes)):
        tr = max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1]))
        trs.append(tr)
    if not trs: return 0.0
    if len(trs) < period: return sum(trs)/len(trs)
    atr = sum(trs[:period])/period
    for i in range(period, len(trs)): atr = (atr*(period-1)+trs[i])/period
    return atr


# Thresholds (tunable but defaults are canonical).
INFLOW_MIN = 2_000_000       # +2M EGP
OUTFLOW_MAX = -2_000_000     # -2M EGP
ABSORB_MIN = 500_000         # +500K
ABSORB_MAX = 5_000_000       # +5M
PROXIMITY_52W = 0.08         # within 8% of 52w low
CORRECTION_DROP = 8.0        # >=8% drop in 15 sessions
CORRECTION_RR = 1.8          # R/R >= 1.8


@dataclass
class LiquidityClassification:
    bucket: str          # whale_inflow | whale_outflow | bottom_absorption | correction_exhaustion | neutral
    reason: str          # Arabic plain-language reason
    evidence: Dict[str, Any]  # all computed numbers


def classify_liquidity_bucket(
    ticker: str,
    market: str,
    conn: Optional[sqlite3.Connection] = None,
    entry: float = 0.0,
    target: float = 0.0,
    stop: float = 0.0,
) -> LiquidityClassification:
    """الدالة المركزية الموحدة — تصنيف السيولة لحظياً (مانع للتداخل)."""
    own_conn = False
    if conn is None:
        stocks_db = os.environ.get('STOCKS_DB', str(Path(__file__).resolve().parents[2] / "db" / "stocks.db"))
        if os.path.exists(stocks_db):
            conn = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            own_conn = True
    if conn is None:
        return LiquidityClassification('neutral', 'لا قاعدة بيانات', {})

    try:
        # 1. Last 5 sessions (for net flow + 5-day low).
        rows5 = conn.execute(
            "SELECT price_date, open, close, high, low, volume FROM stock_daily_prices "
            "WHERE ticker = ? AND market = ? AND close > 0 AND volume > 0 "
            "ORDER BY price_date DESC LIMIT 5", (ticker, market)
        ).fetchall()
        if len(rows5) < 3:
            return LiquidityClassification('neutral', f'بيانات غير كافية ({len(rows5)} جلسات)', {})

        # Net flow (5 sessions).
        buy, sell = 0.0, 0.0
        for r in rows5:
            o, c, v = _f(r['open']), _f(r['close']), _f(r['volume'])
            val = v * c
            if c > o: buy += val
            elif c < o: sell += val
            else: buy += val*0.5; sell += val*0.5
        net_flow_5d = round(buy - sell, 0)

        # 5-day low + today's candle.
        lows_5d = [_f(r['low']) for r in rows5 if _f(r['low']) > 0]
        low_5d = min(lows_5d) if lows_5d else 0.0
        today_open, today_close = _f(rows5[-1]['open']), _f(rows5[-1]['close'])
        prev_close = _f(rows5[-2]['close']) if len(rows5) >= 2 else today_open
        today_green = today_close > today_open
        today_engulfing = today_green and today_close > prev_close and today_open < prev_close

        # Current price.
        current_price = today_close

        # 2. MA20 (from last 20 closes).
        rows20 = conn.execute(
            "SELECT close FROM stock_daily_prices WHERE ticker = ? AND market = ? AND close > 0 "
            "ORDER BY price_date DESC LIMIT 20", (ticker, market)
        ).fetchall()
        closes20 = [_f(r['close']) for r in rows20]
        ma20 = _ema(closes20, 20) if len(closes20) >= 5 else sum(closes20)/len(closes20) if closes20 else 0.0

        # 3. RSI (from stocks table).
        rsi_row = conn.execute(
            "SELECT rsi FROM stocks WHERE ticker = ? AND market = ? LIMIT 1", (ticker, market)
        ).fetchone()
        rsi = _f(rsi_row[0]) if rsi_row else 50.0

        # 4. 52-week low.
        yl_row = conn.execute(
            "SELECT MIN(low) FROM stock_daily_prices WHERE ticker = ? AND market = ? AND low > 0", (ticker, market)
        ).fetchone()
        low_52w = _f(yl_row[0]) if yl_row else 0.0

        # 5. ATR.
        rows_full = conn.execute(
            "SELECT high, low, close FROM stock_daily_prices WHERE ticker = ? AND market = ? AND close > 0 "
            "ORDER BY price_date DESC LIMIT 30", (ticker, market)
        ).fetchall()
        highs = [_f(r['high']) for r in rows_full]
        lows_full = [_f(r['low']) for r in rows_full]
        closes_full = [_f(r['close']) for r in rows_full]
        atr = _compute_atr(highs, lows_full, closes_full, 14)
        atr_sma = sum([
            max(highs[i]-lows_full[i], abs(highs[i]-closes_full[i-1]), abs(lows_full[i]-closes_full[i-1]))
            for i in range(1, min(len(closes_full), 20))
        ]) / min(len(closes_full)-1, 19) if len(closes_full) > 1 else 0.0
        atr_low = atr < atr_sma * 0.8 if atr_sma > 0 else False

        # 6. 15-session drop.
        rows15 = conn.execute(
            "SELECT close FROM stock_daily_prices WHERE ticker = ? AND market = ? AND close > 0 "
            "ORDER BY price_date DESC LIMIT 16", (ticker, market)
        ).fetchall()
        drop_15d = 0.0
        if len(rows15) >= 2:
            c_old = _f(rows15[-1]['close'])
            c_now = _f(rows15[0]['close'])
            if c_old > 0: drop_15d = ((c_now - c_old) / c_old) * 100

        # 7. R/R.
        rr = 0.0
        if entry > 0 and target > entry and stop < entry:
            rr = round((target - entry) / (entry - stop), 2)

        # ── Classify (mutually exclusive — first match wins) ──
        evidence = {
            'net_flow_5d': net_flow_5d, 'current_price': current_price, 'ma20': round(ma20, 2),
            'rsi': round(rsi, 2), 'low_52w': low_52w, 'atr': round(atr, 4),
            'drop_15d_pct': round(drop_15d, 2), 'rr': rr,
            'today_green': today_green, 'today_engulfing': today_engulfing,
            'low_5d': low_5d, 'price_above_ma20': current_price > ma20,
            'broke_5d_low': current_price < low_5d if low_5d > 0 else False,
            'within_8pct_52w': (abs(current_price - low_52w) / low_52w * 100) <= 8.0 if low_52w > 0 else False,
            'atr_low': atr_low,
        }

        # 1. whale_inflow
        if net_flow_5d > INFLOW_MIN and current_price > ma20 and rsi < 68:
            return LiquidityClassification(
                'whale_inflow',
                f'تدفق حيتان صريح: صافي {net_flow_5d/1e6:+.1f}M ج.م + فوق MA20 + RSI {rsi:.0f}',
                evidence
            )

        # 2. whale_outflow
        if net_flow_5d < OUTFLOW_MAX and (current_price < ma20 or (low_5d > 0 and current_price < low_5d)):
            return LiquidityClassification(
                'whale_outflow',
                f'تصريف وهروب: صافي {net_flow_5d/1e6:+.1f}M ج.م + تحت MA20 أو كسر قاع 5ج',
                evidence
            )

        # 3. bottom_absorption
        if (ABSORB_MIN <= net_flow_5d <= ABSORB_MAX and low_52w > 0
                and abs(current_price - low_52w) / low_52w * 100 <= 8.0 and atr_low):
            return LiquidityClassification(
                'bottom_absorption',
                f'تجميع قيعان هادئ: تدفق {net_flow_5d/1e6:+.1f}M + ضمن 8% من قاع 52أسبوع + ATR منخفض',
                evidence
            )

        # 4. correction_exhaustion
        if (drop_15d <= -CORRECTION_DROP and today_engulfing and rr >= CORRECTION_RR):
            return LiquidityClassification(
                'correction_exhaustion',
                f'نهاية تصحيح: هبوط {drop_15d:.1f}% + شمعة خضراء عاكسة + R/R {rr:.2f}',
                evidence
            )

        # 5. neutral
        return LiquidityClassification(
            'neutral',
            f'مسار عادي: صافي {net_flow_5d/1e6:+.1f}M ج.م + RSI {rsi:.0f} + ما يحقق شروط تصنيف خاص',
            evidence
        )

    except Exception as e:
        sys.stderr.write(f"[canonical_flow] {ticker} error: {e}\n")
        return LiquidityClassification('neutral', f'خطأ في التصنيف: {e}', {})
    finally:
        if own_conn:
            conn.close()


# ═══════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import json
    print("=" * 72)
    print("🧪 canonical_flow — self-test")
    print("=" * 72)
    for ticker in ['COMI', 'SWDY', 'ACFR', 'AMOC']:
        r = classify_liquidity_bucket(ticker, 'EGX', entry=130, target=150, stop=120)
        print(f"\n{ticker}: bucket={r.bucket}")
        print(f"  reason: {r.reason}")
        ev = r.evidence
        if ev:
            print(f"  net_flow_5d={ev.get('net_flow_5d')} ma20={ev.get('ma20')} rsi={ev.get('rsi')}")
            print(f"  low_52w={ev.get('low_52w')} rr={ev.get('rr')} drop_15d={ev.get('drop_15d_pct')}%")
    print("\n" + "=" * 72)
    print("✅ Mutually exclusive — each stock gets exactly ONE bucket.")
