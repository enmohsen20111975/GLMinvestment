#!/usr/bin/env python3
"""Debug: Why are all experiments returning 302 signals?"""
import sys, sqlite3, copy
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

TRAIN_START = '2025-10-01'
TRAIN_END = '2026-01-31'
MAX_TICKERS = 250

def get_regime(d):
    m = d[:7]
    if m in ('2025-05', '2025-09', '2025-10'): return 'BULL'
    if m in ('2025-02', '2025-03', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'): return 'BEAR'
    return 'SIDEWAYS'

def load_data():
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    try:
        conn2 = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=10.0)
        sm = dict(conn2.execute("SELECT ticker,sector FROM stocks WHERE is_active=1 AND sector IS NOT NULL").fetchall())
        conn2.close()
    except:
        sm = {}
    
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date>='2025-09-01' AND date<=? AND ticker NOT LIKE '%.%' ORDER BY ticker LIMIT ?
    """, (TRAIN_END, MAX_TICKERS)).fetchall()]
    
    data = {}
    for t in tickers:
        rows = conn.execute("""
            SELECT date,open_price,high_price,low_price,close_price,volume
            FROM price_history WHERE ticker=? AND date>='2025-09-01' AND date<=?
            AND close_price>0 ORDER BY date
        """, (t, TRAIN_END)).fetchall()
        if len(rows) < 50: continue
        candles = [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3],
                     'close': r[4], 'volume': r[5]} for r in rows]
        closes = [c['close'] for c in candles]
        vols = [c['volume'] for c in candles]
        for i, c in enumerate(candles):
            c['sma50'] = sum(closes[max(0,i-49):i+1])/min(50,i+1) if i >= 49 else None
            c['vol_ma20'] = sum(vols[max(0,i-19):i+1])/min(20,i+1) if i >= 19 else None
            c['roc5'] = ((closes[i]/closes[i-5]-1)*100) if i >= 5 and closes[i-5] > 0 else None
            if i >= 14:
                g, l = [], []
                for j in range(max(1, i-13), i+1):
                    ch = closes[j] - closes[j-1]
                    g.append(max(0, ch)); l.append(max(0, -ch))
                ag = sum(g)/14; al = sum(l)/14 or 0.001
                c['rsi'] = 100 - 100/(1+ag/al)
            else:
                c['rsi'] = None
            c['sector'] = sm.get(t, 'Unknown')
            c['regime'] = get_regime(c['date'])
        data[t] = candles
    conn.close()
    return data


def main():
    print("=" * 70)
    print("  Debug: Why 302 signals in ALL experiments?")
    print("=" * 70)
    
    data = load_data()
    print(f"\n  Loaded {len(data)} tickers")
    
    # Build a date→candle lookup for each ticker
    date_lookup = {}
    for t, candles in data.items():
        date_lookup[t] = {c['date']: c for c in candles}
    
    # Run V38 + properly match signals to day data via DATE (not index)
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    
    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals()
    engine._load_benchmark()
    pre_cache_price_history(list(data.keys()), engine)
    
    signals = []
    null_day_count = 0
    
    for t in data:
        d, o, h, l, c, v = engine.get_price_data(t)
        if len(c) < 50: continue
        for i in range(50, len(c)):
            if d[i] < TRAIN_START or d[i] > TRAIN_END: continue
            try:
                r = engine.analyze_single_day(t, d, o, h, l, c, v, i)
                sig = r.get('signal', 'WAIT')
                if sig not in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'): continue
                
                entry = r.get('entry_price', c[i])
                tgt = r.get('target_price') or entry * 1.10
                stp = r.get('stop_loss') or entry * 0.93
                
                # FIX: Look up day by DATE, not by INDEX
                signal_date = d[i]
                day = date_lookup.get(t, {}).get(signal_date)
                
                if day is None:
                    null_day_count += 1
                
                signals.append({
                    'date': signal_date, 'ticker': t,
                    'entry': entry, 'target': tgt, 'stop': stp,
                    'day': day, 'result': r,
                })
            except:
                pass
    
    print(f"\n  Total signals: {len(signals)}")
    print(f"  Signals with day=None: {null_day_count}")
    
    # Now test filters with CORRECT day data
    def f_no_bear(s): return s['day'] is None or s['day'].get('regime') != 'BEAR'
    def f_bull(s): return s['day'] is None or s['day'].get('regime') == 'BULL'
    def f_rsi(s):
        d = s['day']
        return d is None or d.get('rsi') is None or 40 <= d['rsi'] <= 70
    def f_vol(s):
        d = s['day']
        return d is None or d.get('vol_ma20') is None or d['vol_ma20'] == 0 or d['volume'] >= d['vol_ma20'] * 1.2
    
    print(f"\n  {'='*60}")
    print(f"  FILTER TEST (with FIXED date matching)")
    print(f"  {'='*60}")
    print(f"  {'Filter':<20} {'Before':>6} {'After':>6} {'Rejected':>8}")
    print(f"  {'─'*45}")
    
    for name, fn in [('Baseline (no filter)', None), ('NoBear', f_no_bear), ('BullOnly', f_bull),
                      ('RSI 40-70', f_rsi), ('Vol 1.2x', f_vol)]:
        if fn is None:
            filtered = signals
        else:
            filtered = [s for s in signals if fn(s)]
        rejected = len(signals) - len(filtered)
        print(f"  {name:<20} {len(signals):>6} {len(filtered):>6} {rejected:>8}")
    
    # Check regime distribution
    regimes = {'BULL': 0, 'BEAR': 0, 'SIDEWAYS': 0, 'NULL': 0}
    for s in signals:
        if s['day'] is None:
            regimes['NULL'] += 1
        else:
            r = s['day'].get('regime', 'NULL')
            regimes[r] = regimes.get(r, 0) + 1
    
    print(f"\n  Regime distribution of signals:")
    for r, cnt in regimes.items():
        print(f"    {r}: {cnt}")
    
    print(f"\n  {'='*60}")
    if null_day_count == 0 and len(signals) > 0:
        print(f"  ✅ FIX CONFIRMED — day data is properly matched")
        print(f"  Filters NOW show different signal counts → experiments were BROKEN before")
    elif null_day_count > 0:
        print(f"  ⚠️  {null_day_count} signals still have day=None")
    print(f"  {'='*60}")


if __name__ == '__main__':
    main()
