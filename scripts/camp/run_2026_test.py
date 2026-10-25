#!/usr/bin/env python3
"""
2026 Data Test — V38 vs Bull+Vol vs Bull+RSI+Vol on 3 quarters.
Q1: Jan-Mar 2026, Q2: Apr-Jun 2026 (Q3 Jul-Oct has 0 data).
"""
import sys, json, time, math, sqlite3, copy
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

MAX_TICKERS = 100
POSITION_SIZE = 0.20
HOLDING_DAYS = 30

QUARTERS = [
    ('Q1 2026', '2026-01-01', '2026-03-31'),
    ('Q2 2026', '2026-04-01', '2026-06-10'),  # data ends Jun 10
]

def get_regime(d):
    m = d[:7]
    if m in ('2025-05','2025-09','2025-10'): return 'BULL'
    if m in ('2025-02','2025-03','2026-02','2026-03','2026-04','2026-05','2026-06'): return 'BEAR'
    return 'SIDEWAYS'

def load_data(start='2025-10-01', end='2026-06-10'):
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date >= ? AND date <= ? AND ticker NOT LIKE '%.%'
        ORDER BY ticker LIMIT ?
    """, (start, end, MAX_TICKERS)).fetchall()]
    
    data = {}; date_lookup = {}
    for t in tickers:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker=? AND date>=? AND date<=?
            AND close_price>0 ORDER BY date
        """, (t, start, end)).fetchall()
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
            c['regime'] = get_regime(c['date'])
        data[t] = candles
        date_lookup[t] = {c['date']: c for c in candles}
    conn.close()
    return data, date_lookup

def precompute_v38(data, date_lookup):
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals(); engine._load_benchmark()
    pre_cache_price_history(list(data.keys()), engine)
    
    signals = []
    for t in data:
        d, o, h, l, c, v = engine.get_price_data(t)
        if len(c) < 50: continue
        for i in range(50, len(c)):
            try:
                r = engine.analyze_single_day(t, d, o, h, l, c, v, i)
                sig = r.get('signal', 'WAIT')
                if sig not in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'): continue
                entry = r.get('entry_price', c[i])
                tgt = r.get('target_price') or entry * 1.10
                stp = r.get('stop_loss') or entry * 0.93
                day = date_lookup.get(t, {}).get(d[i])
                signals.append({'date': d[i], 'ticker': t, 'entry': entry,
                               'target': tgt, 'stop': stp, 'day': day})
            except:
                pass
    return signals

def calc_metrics(sigs):
    if not sigs:
        return {'signals': 0, 'wr': 0, 'pf': 0, 'max_dd': 0, 'avg_ret': 0, 'sharpe': 0}
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    w = l = e = 0; gp = gl = 0; eq = 100000; pk = eq; mdd = 0; rets = []
    for s in sigs:
        f = conn.execute("SELECT high_price,low_price,close_price FROM price_history WHERE ticker=? AND date>? ORDER BY date LIMIT ?",
                         (s['ticker'], s['date'], HOLDING_DAYS)).fetchall()
        ep = None; oc = 'EXPIRED'
        for h, lo, c in f:
            if lo is not None and s['stop'] is not None and lo <= s['stop']: ep = s['stop']; oc = 'STOPPED'; break
            if h is not None and s['target'] is not None and h >= s['target']: ep = s['target']; oc = 'TARGET_HIT'; break
        if ep is None and f: ep = f[-1][2] or s['entry']
        if ep is None: continue
        ret = (ep / s['entry'] - 1) * 100; rets.append(ret)
        if oc == 'TARGET_HIT': w += 1; gp += ret
        elif oc == 'STOPPED': l += 1; gl += abs(ret)
        else:
            e += 1
            if ret > 0: gp += ret
            else: gl += abs(ret)
        eq += eq * POSITION_SIZE * (ret / 100); pk = max(pk, eq)
        dd = (pk - eq) / pk * 100 if pk > 0 else 0; mdd = max(mdd, dd)
    conn.close()
    n = len(sigs); wr = w / n * 100 if n > 0 else 0; pf = gp / gl if gl > 0 else 0
    ar = sum(rets) / n if rets else 0
    std = math.sqrt(sum((r - ar) ** 2 for r in rets) / (n - 1)) if n > 1 else 0
    sh = (ar / std * math.sqrt(n)) if std > 0 else 0
    return {'signals': n, 'wr': round(wr, 1), 'pf': round(pf, 2),
            'max_dd': round(mdd, 1), 'avg_ret': round(ar, 2), 'sharpe': round(sh, 2)}

# Filters
def f_bull(s): return s['day'] is None or s['day'].get('regime') == 'BULL'
def f_rsi(s):
    d = s['day']; return d is None or d.get('rsi') is None or 40 <= d['rsi'] <= 70
def f_vol(s):
    d = s['day']
    return d is None or d.get('vol_ma20') is None or d['vol_ma20'] == 0 or d['volume'] >= d['vol_ma20'] * 1.2
def f_bull_vol(s): return f_bull(s) and f_vol(s)
def f_bull_rsi_vol(s): return f_bull(s) and f_rsi(s) and f_vol(s)

STRATEGIES = [
    ('Baseline', None),
    ('Bull+Vol', f_bull_vol),
    ('Bull+RSI+Vol', f_bull_rsi_vol),
]

def main():
    print(f"\n{'='*70}")
    print(f"  2026 Data Test — V38 vs Bull+Vol vs Bull+RSI+Vol")
    print(f"  Q1: Jan-Mar 2026 | Q2: Apr-Jun 2026")
    print(f"{'='*70}\n")
    
    # Load data (need Oct 2025 onwards for SMA50 lookback)
    print("  Loading data (Oct 2025 → Jun 2026)...")
    data, date_lookup = load_data('2025-10-01', '2026-06-10')
    print(f"  {len(data)} tickers loaded")
    
    print("\n  Pre-computing V38 signals...")
    t0 = time.time()
    all_sigs = precompute_v38(data, date_lookup)
    print(f"  {len(all_sigs)} total signals in {time.time()-t0:.0f}s")
    
    # Run per quarter
    results = []
    
    for q_name, q_start, q_end in QUARTERS:
        print(f"\n  {'='*60}")
        print(f"  {q_name} ({q_start} → {q_end})")
        print(f"  {'='*60}")
        
        q_sigs = [s for s in all_sigs if q_start <= s['date'] <= q_end]
        
        print(f"  {'Strategy':<16} {'Sig':>5} {'WR':>6} {'PF':>6} {'MaxDD':>7} {'Sharpe':>7} {'Verdict':>8}")
        print(f"  {'─'*60}")
        
        for strat_name, filter_fn in STRATEGIES:
            if filter_fn:
                sigs = [s for s in q_sigs if filter_fn(s)]
            else:
                sigs = q_sigs
            
            m = calc_metrics(sigs)
            
            # Verdict
            if m['signals'] < 10:
                v = 'FEW SIG'
            elif m['pf'] >= 1.3 and m['max_dd'] < 20:
                v = 'PASS'
            elif m['pf'] >= 1.0:
                v = 'WEAK'
            else:
                v = 'FAIL'
            
            print(f"  {strat_name:<16} {m['signals']:>5} {m['wr']:>5.1f}% {m['pf']:>6.2f} -{m['max_dd']:>5.1f}% {m['sharpe']:>7.2f} {v:>8}")
            
            results.append({
                'quarter': q_name, 'strategy': strat_name,
                'signals': m['signals'], 'wr': m['wr'], 'pf': m['pf'],
                'max_dd': m['max_dd'], 'sharpe': m['sharpe'], 'verdict': v,
            })
    
    # Total 2026
    print(f"\n  {'='*60}")
    print(f"  TOTAL 2026 (Jan → Jun)")
    print(f"  {'='*60}")
    
    all_2026_sigs = [s for s in all_sigs if '2026-01-01' <= s['date'] <= '2026-06-10']
    
    print(f"  {'Strategy':<16} {'Sig':>5} {'WR':>6} {'PF':>6} {'MaxDD':>7} {'Sharpe':>7} {'Verdict':>8}")
    print(f"  {'─'*60}")
    
    for strat_name, filter_fn in STRATEGIES:
        if filter_fn:
            sigs = [s for s in all_2026_sigs if filter_fn(s)]
        else:
            sigs = all_2026_sigs
        
        m = calc_metrics(sigs)
        
        if m['signals'] < 30:
            v = 'FEW SIG'
        elif m['pf'] >= 1.5 and m['max_dd'] < 20:
            v = 'DEPLOY'
        elif m['pf'] >= 1.3:
            v = 'PASS'
        elif m['pf'] >= 1.0:
            v = 'WEAK'
        else:
            v = 'FAIL'
        
        print(f"  {strat_name:<16} {m['signals']:>5} {m['wr']:>5.1f}% {m['pf']:>6.2f} -{m['max_dd']:>5.1f}% {m['sharpe']:>7.2f} {v:>8}")
        
        results.append({
            'quarter': 'TOTAL 2026', 'strategy': strat_name,
            'signals': m['signals'], 'wr': m['wr'], 'pf': m['pf'],
            'max_dd': m['max_dd'], 'sharpe': m['sharpe'], 'verdict': v,
        })
    
    # Final decision
    print(f"\n{'='*70}")
    bv_results = [r for r in results if r['strategy'] == 'Bull+Vol' and r['quarter'] != 'TOTAL 2026']
    bv_pass = sum(1 for r in bv_results if r['pf'] >= 1.3)
    bv_total = len(bv_results)
    
    total_bv = [r for r in results if r['strategy'] == 'Bull+Vol' and r['quarter'] == 'TOTAL 2026']
    if total_bv:
        total_pf = total_bv[0]['pf']
        total_dd = total_bv[0]['max_dd']
        total_sig = total_bv[0]['signals']
    else:
        total_pf = total_dd = total_sig = 0
    
    if bv_pass >= 2 and total_pf >= 1.5 and total_dd < 20 and total_sig >= 30:
        print(f"  ✅ DEPLOY READY — Bull+Vol passed {bv_pass}/{bv_total} quarters")
        print(f"     Total: PF={total_pf}, DD=-{total_dd}%, Signals={total_sig}")
    elif bv_pass >= 1 and total_pf >= 1.3:
        print(f"  🟡 MAYBE — Bull+Vol passed {bv_pass}/{bv_total} quarters")
        print(f"     Total: PF={total_pf}, DD=-{total_dd}%, Signals={total_sig}")
    else:
        print(f"  ❌ REJECT — Bull+Vol passed {bv_pass}/{bv_total} quarters")
        print(f"     Total: PF={total_pf}, DD=-{total_dd}%, Signals={total_sig}")
    print(f"{'='*70}\n")
    
    # Save
    rd = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
    rd.mkdir(parents=True, exist_ok=True)
    with open(rd / '2026_test.json', 'w') as f:
        json.dump({'timestamp': datetime.now().isoformat(), 'results': results}, f, indent=2, default=str)
    
    rp = PROJECT_ROOT / 'scripts' / 'camp' / 'reports'
    rp.mkdir(parents=True, exist_ok=True)
    with open(rp / '2026-TEST-FINAL.md', 'w') as f:
        f.write(f"# 2026 Data Test — Final Results\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"| Period | Strategy | Signals | WR | PF | Max DD | Sharpe | Verdict |\n")
        f.write(f"|--------|----------|---------|-----|-----|--------|--------|---------|\n")
        for r in results:
            f.write(f"| {r['quarter']} | {r['strategy']} | {r['signals']} | {r['wr']}% | {r['pf']} | -{r['max_dd']}% | {r['sharpe']} | {r['verdict']} |\n")

if __name__ == '__main__':
    main()
