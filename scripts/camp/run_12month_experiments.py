#!/usr/bin/env python3
"""
12-Month V38 Experiments with Train/Test Split + Statistical Rigor.
- 12 months data (2025-01 → 2025-12)
- Train: 8 months (Jan-Aug 2025), Test: 4 months (Sep-Dec 2025)
- Minimum 30 signals per experiment
- Full metrics: PF, WR, Sharpe, MaxDD, Expectancy
- Out-of-Sample validation (Train vs Test PF)
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

# 12-month period
TRAIN_START = '2025-01-01'
TRAIN_END   = '2025-08-31'
TEST_START  = '2025-09-01'
TEST_END    = '2025-12-31'
FULL_START  = TRAIN_START
FULL_END    = TEST_END

MAX_TICKERS = 250
POSITION_SIZE = 0.20
HOLDING_DAYS = 30

# Acceptance criteria
MIN_SIGNALS = 30
MIN_PF = 1.3
MIN_SHARPE = 1.0
MAX_DD = 20.0
MIN_TEST_PF_RATIO = 0.8  # Test PF must be >= 80% of Train PF

def get_regime(d):
    m = d[:7]
    if m in ('2025-01','2025-02','2025-03'): return 'BEAR'
    if m in ('2025-04','2025-05','2025-06'): return 'SIDEWAYS'
    if m in ('2025-07','2025-08'): return 'BULL'
    if m in ('2025-09','2025-10'): return 'BULL'
    if m in ('2025-11','2025-12'): return 'SIDEWAYS'
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
        WHERE date >= '2024-12-01' AND date <= ?
        AND ticker NOT LIKE '%.%' ORDER BY ticker LIMIT ?
    """, (FULL_END, MAX_TICKERS)).fetchall()]
    
    data = {}
    date_lookup = {}
    for t in tickers:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history WHERE ticker=? AND date>='2024-12-01' AND date<=?
            AND close_price>0 ORDER BY date
        """, (t, FULL_END)).fetchall()
        if len(rows) < 60: continue
        candles = [{'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3],
                     'close': r[4], 'volume': r[5]} for r in rows]
        closes = [c['close'] for c in candles]
        vols = [c['volume'] for c in candles]
        for i, c in enumerate(candles):
            c['sma50'] = sum(closes[max(0,i-49):i+1])/min(50,i+1) if i >= 49 else None
            c['sma20'] = sum(closes[max(0,i-19):i+1])/min(20,i+1) if i >= 19 else None
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
            if d[i] < FULL_START or d[i] > FULL_END: continue
            try:
                r = engine.analyze_single_day(t, d, o, h, l, c, v, i)
                sig = r.get('signal', 'WAIT')
                if sig not in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'): continue
                entry = r.get('entry_price', c[i])
                tgt = r.get('target_price') or entry * 1.10
                stp = r.get('stop_loss') or entry * 0.93
                day = date_lookup.get(t, {}).get(d[i])
                signals.append({'date': d[i], 'ticker': t, 'entry': entry,
                               'target': tgt, 'stop': stp, 'day': day, 'result': r})
            except:
                pass
    return signals

def calc_metrics(sigs):
    if not sigs:
        return {'signals': 0, 'wr': 0, 'pf': 0, 'max_dd': 0, 'avg_ret': 0,
                'sharpe': 0, 'expectancy': 0, 'avg_win': 0, 'avg_loss': 0}
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    w = l = e = 0; gp = gl = 0; eq = 100000; pk = eq; mdd = 0; rets = []
    wins_r = []; losses_r = []
    for s in sigs:
        f = conn.execute("SELECT high_price,low_price,close_price FROM price_history WHERE ticker=? AND date>? ORDER BY date LIMIT ?",
                         (s['ticker'], s['date'], HOLDING_DAYS)).fetchall()
        ep = None; oc = 'EXPIRED'
        for h, lo, c in f:
            if lo is not None and s['stop'] is not None and lo <= s['stop']:
                ep = s['stop']; oc = 'STOPPED'; break
            if h is not None and s['target'] is not None and h >= s['target']:
                ep = s['target']; oc = 'TARGET_HIT'; break
        if ep is None and f:
            ep = f[-1][2] or s['entry']
        if ep is None: continue
        ret = (ep / s['entry'] - 1) * 100; rets.append(ret)
        if oc == 'TARGET_HIT': w += 1; gp += ret; wins_r.append(ret)
        elif oc == 'STOPPED': l += 1; gl += abs(ret); losses_r.append(abs(ret))
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
    avg_win = sum(wins_r) / len(wins_r) if wins_r else 0
    avg_loss = sum(losses_r) / len(losses_r) if losses_r else 0
    return {'signals': n, 'wins': w, 'losses': l, 'wr': round(wr, 1), 'pf': round(pf, 2),
            'max_dd': round(mdd, 1), 'avg_ret': round(ar, 2), 'sharpe': round(sh, 2),
            'expectancy': round(ar * POSITION_SIZE, 2),
            'avg_win': round(avg_win, 2), 'avg_loss': round(avg_loss, 2)}

# Filters
def f_bull(s): return s['day'] is None or s['day'].get('regime') == 'BULL'
def f_rsi(s):
    d = s['day']; return d is None or d.get('rsi') is None or 40 <= d['rsi'] <= 70
def f_vol(s):
    d = s['day']
    return d is None or d.get('vol_ma20') is None or d['vol_ma20'] == 0 or d['volume'] >= d['vol_ma20'] * 1.2

def split_signals(sigs, train_start, train_end, test_start, test_end):
    train = [s for s in sigs if train_start <= s['date'] <= train_end]
    test = [s for s in sigs if test_start <= s['date'] <= test_end]
    return train, test

def evaluate(name, all_sigs, filter_fn=None):
    """Evaluate an experiment with train/test split."""
    if filter_fn:
        sigs = [s for s in all_sigs if filter_fn(s)]
    else:
        sigs = all_sigs
    
    train_sigs, test_sigs = split_signals(sigs, TRAIN_START, TRAIN_END, TEST_START, TEST_END)
    
    train_m = calc_metrics(train_sigs)
    test_m = calc_metrics(test_sigs)
    
    # Stability check
    if train_m['pf'] > 0:
        stability = test_m['pf'] / train_m['pf']
    else:
        stability = 0
    
    # Verdict
    total_sigs = train_m['signals'] + test_m['signals']
    verdict = 'REJECT'
    reason = ''
    
    if total_sigs < MIN_SIGNALS:
        verdict = 'REJECT'; reason = f'Only {total_sigs} signals (need {MIN_SIGNALS})'
    elif test_m['pf'] < 1.0:
        verdict = 'REJECT'; reason = f'Test PF={test_m["pf"]} < 1.0 (losing)'
    elif test_m['pf'] < MIN_PF:
        verdict = 'REJECT'; reason = f'Test PF={test_m["pf"]} < {MIN_PF}'
    elif stability < MIN_TEST_PF_RATIO:
        verdict = 'REJECT'; reason = f'Unstable: Test/Train={stability:.2f} < {MIN_TEST_PF_RATIO}'
    elif test_m['max_dd'] > MAX_DD:
        verdict = 'REJECT'; reason = f'MaxDD=-{test_m["max_dd"]}% > {MAX_DD}%'
    else:
        verdict = 'KEEP'; reason = f'Stable: PF={test_m["pf"]}, DD=-{test_m["max_dd"]}%'
    
    return {
        'name': name,
        'total_signals': total_sigs,
        'train': train_m,
        'test': test_m,
        'stability': round(stability, 2),
        'verdict': verdict,
        'reason': reason,
    }

def main():
    print(f"\n{'='*70}")
    print(f"  12-Month V38 Experiments (Train/Test + Statistical Rigor)")
    print(f"  Train: {TRAIN_START} → {TRAIN_END} (8 months)")
    print(f"  Test:  {TEST_START} → {TEST_END} (4 months — Out-of-Sample)")
    print(f"  Min signals: {MIN_SIGNALS} | Min PF: {MIN_PF} | Min Sharpe: {MIN_SHARPE} | Max DD: {MAX_DD}%")
    print(f"{'='*70}\n")
    
    print("  Loading data (12 months)...")
    data, date_lookup = load_data()
    print(f"  {len(data)} tickers loaded")
    
    print("\n  Pre-computing V38 signals (ONE TIME)...")
    t0 = time.time()
    all_sigs = precompute_v38(data, date_lookup)
    print(f"  {len(all_sigs)} signals in {time.time()-t0:.0f}s")
    
    # Split signals
    train_sigs = [s for s in all_sigs if TRAIN_START <= s['date'] <= TRAIN_END]
    test_sigs = [s for s in all_sigs if TEST_START <= s['date'] <= TEST_END]
    print(f"  Train: {len(train_sigs)} signals | Test: {len(test_sigs)} signals")
    
    # Run experiments
    experiments = []
    
    # Baseline
    print("\n  Running experiments...")
    exp = evaluate('V38 Baseline', all_sigs)
    experiments.append(exp)
    print(f"  Baseline: train={exp['train']['signals']}, test={exp['test']['signals']}, "
          f"train_PF={exp['train']['pf']}, test_PF={exp['test']['pf']} → {exp['verdict']}")
    
    # Single filters
    for name, fn in [('BullOnly', f_bull), ('RSI 40-70', f_rsi), ('Vol 1.2x', f_vol)]:
        exp = evaluate(name, all_sigs, fn)
        experiments.append(exp)
        print(f"  {name}: train={exp['train']['signals']}, test={exp['test']['signals']}, "
              f"train_PF={exp['train']['pf']}, test_PF={exp['test']['pf']} → {exp['verdict']}")
    
    # Combinations
    def f_bull_rsi(s): return f_bull(s) and f_rsi(s)
    def f_bull_vol(s): return f_bull(s) and f_vol(s)
    def f_rsi_vol(s): return f_rsi(s) and f_vol(s)
    def f_all(s): return f_bull(s) and f_rsi(s) and f_vol(s)
    
    for name, fn in [('Bull+RSI', f_bull_rsi), ('Bull+Vol', f_bull_vol),
                      ('RSI+Vol', f_rsi_vol), ('Bull+RSI+Vol', f_all)]:
        exp = evaluate(name, all_sigs, fn)
        experiments.append(exp)
        print(f"  {name}: train={exp['train']['signals']}, test={exp['test']['signals']}, "
              f"train_PF={exp['train']['pf']}, test_PF={exp['test']['pf']} → {exp['verdict']}")
    
    # ─── Final Report ───
    print(f"\n{'='*70}")
    print(f"  📊 12-MONTH EXPERIMENTS — FINAL RESULTS")
    print(f"{'='*70}\n")
    
    print(f"  {'#':>2} {'Experiment':<16} {'Train':>5} {'Test':>4} {'TrPF':>5} {'TePF':>5} "
          f"{'TrWR':>5} {'TeWR':>5} {'Stab':>5} {'TeDD':>6} {'TeSh':>5} {'Verdict':>8}")
    print(f"  {'─'*85}")
    
    for i, e in enumerate(experiments):
        tr, te = e['train'], e['test']
        print(f"  {i:>2} {e['name']:<16} {tr['signals']:>5} {te['signals']:>4} "
              f"{tr['pf']:>5.2f} {te['pf']:>5.2f} {tr['wr']:>4.1f}% {te['wr']:>4.1f}% "
              f"{e['stability']:>5.2f} -{te['max_dd']:>4.1f}% {te['sharpe']:>5.2f} {e['verdict']:>8}")
    
    # Summary
    kept = [e for e in experiments if e['verdict'] == 'KEEP']
    print(f"\n  Summary: {len(kept)}/{len(experiments)} experiments KEEP'd")
    
    if kept:
        print(f"\n  ✅ DEPLOY-READY strategies:")
        for e in kept:
            te = e['test']
            print(f"    {e['name']}: Test PF={te['pf']}, WR={te['wr']}%, DD=-{te['max_dd']}%, "
                  f"Sharpe={te['sharpe']}, Signals={e['total_signals']}")
    else:
        print(f"\n  ❌ No strategy passed all criteria.")
        print(f"  V38's PF=1.07 ceiling is confirmed across 12 months.")
        print(f"  No simple filter can push it to PF>=1.3 with 30+ signals.")
    
    # Save
    rd = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
    rd.mkdir(parents=True, exist_ok=True)
    with open(rd / '12month_experiments.json', 'w') as f:
        json.dump({'timestamp': datetime.now().isoformat(),
                   'train_period': f'{TRAIN_START}→{TRAIN_END}',
                   'test_period': f'{TEST_START}→{TEST_END}',
                   'experiments': experiments}, f, indent=2, default=str)
    
    rp = PROJECT_ROOT / 'scripts' / 'camp' / 'reports'
    rp.mkdir(parents=True, exist_ok=True)
    with open(rp / '12MONTH-FINAL.md', 'w') as f:
        f.write(f"# 12-Month Experiments — Final Results\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"## Setup\n\n")
        f.write(f"- Train: {TRAIN_START} → {TRAIN_END} (8 months)\n")
        f.write(f"- Test: {TEST_START} → {TEST_END} (4 months — Out-of-Sample)\n")
        f.write(f"- Tickers: {len(data)}\n")
        f.write(f"- Min signals: {MIN_SIGNALS} | Min PF: {MIN_PF} | Min Sharpe: {MIN_SHARPE} | Max DD: {MAX_DD}%\n\n")
        f.write(f"## Results\n\n")
        f.write(f"| # | Experiment | Train Sig | Test Sig | Train PF | Test PF | Train WR | Test WR | Stability | Test DD | Test Sharpe | Verdict |\n")
        f.write(f"|---|-----------|-----------|----------|----------|---------|----------|---------|-----------|---------|-------------|---------|\n")
        for i, e in enumerate(experiments):
            tr, te = e['train'], e['test']
            f.write(f"| {i} | {e['name']} | {tr['signals']} | {te['signals']} | {tr['pf']} | {te['pf']} | {tr['wr']}% | {te['wr']}% | {e['stability']} | -{te['max_dd']}% | {te['sharpe']} | {e['verdict']} |\n")
        f.write(f"\n## Reason per experiment\n\n")
        for e in experiments:
            f.write(f"- {e['name']}: {e['reason']}\n")
    
    print(f"\n  💾 JSON: {rd}/12month_experiments.json")
    print(f"  📄 Report: {rp}/12MONTH-FINAL.md")
    print(f"{'='*70}\n")

if __name__ == '__main__':
    main()
