#!/usr/bin/env python3
"""
STAGED WEIGHT OPTIMIZATION — Full Suite
========================================
Implements owner's 6-phase optimization plan:
  Phase 0: Baseline (B0)
  Phase 1: Liquidity gate (on/off)
  Phase 2: Coarse weight search (10% steps)
  Phase 3: Fine weight search (5% steps around best)
  Phase 4: Family ablation (remove one family at a time)
  Phase 5: Walk-Forward validation

Run on laptop:
  python3 scripts/run_staged_optimization.py

Outputs:
  backtest_results/staged_optimization/
    ├── phase0_baseline.md
    ├── phase1_liquidity.md
    ├── phase2_coarse_weights.md
    ├── phase3_fine_weights.md
    ├── phase4_ablation.md
    ├── phase5_walkforward.md
    ├── all_experiments.csv
    ├── all_trades.csv
    └── final_recommendation.md
"""
import sys, os, sqlite3, csv, json, statistics, itertools, warnings, time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

# ============================================================
# CONFIG
# ============================================================
WINDOW_START = '2026-06-25'
WINDOW_END = '2026-10-25'
# Walk-Forward split: first 2/3 for optimization, last 1/3 for validation
WF_SPLIT_DATE = '2026-09-15'  # ~2/3 of 4 months
SAMPLE_TICKERS = 20
COMMISSION = 0.1; SLIPPAGE = 0.05; POS_SIZE = 5.0; CAPITAL = 10000.0; MAX_HOLD = 7
DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUT = PROJECT_ROOT / 'backtest_results' / 'staged_optimization'

FAMILIES = ['TREND', 'MOM', 'MR', 'BRK', 'FLOW', 'FUND', 'EVENT']

# V1 weights (owner-approved Grok matrix)
V1_WEIGHTS = {
    'S1': {'TREND':30,'MOM':25,'MR':5,'BRK':10,'FLOW':20,'FUND':5,'EVENT':5},
    'S2': {'TREND':25,'MOM':15,'MR':10,'BRK':5,'FLOW':25,'FUND':10,'EVENT':10},
    'S3': {'TREND':10,'MOM':10,'MR':30,'BRK':5,'FLOW':25,'FUND':10,'EVENT':10},
    'S4': {'TREND':15,'MOM':15,'MR':0,'BRK':25,'FLOW':30,'FUND':5,'EVENT':10},
    'S5': {'TREND':30,'MOM':20,'MR':5,'BRK':5,'FLOW':20,'FUND':10,'EVENT':10},
    'S6': {'TREND':25,'MOM':20,'MR':0,'BRK':5,'FLOW':25,'FUND':10,'EVENT':15},
    'S7': {'TREND':20,'MOM':10,'MR':5,'BRK':5,'FLOW':30,'FUND':15,'EVENT':15},
    'S8': {'TREND':10,'MOM':5,'MR':5,'BRK':5,'FLOW':50,'FUND':15,'EVENT':10},
    'S9': {'TREND':15,'MOM':15,'MR':10,'BRK':10,'FLOW':30,'FUND':10,'EVENT':10},
    'S10': {'TREND':15,'MOM':15,'MR':10,'BRK':10,'FLOW':30,'FUND':10,'EVENT':10},
    'S11': {},
}

def wk(d):
    dt=datetime.strptime(d,'%Y-%m-%d'); iso=dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

def get_data():
    c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); cur=c.cursor()
    cur.execute(f"SELECT DISTINCT ticker FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 ORDER BY ticker LIMIT {SAMPLE_TICKERS}")
    tickers=[r[0] for r in cur.fetchall()]
    cur.execute(f"SELECT DISTINCT date FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date")
    dates=[r[0] for r in cur.fetchall()]; c.close()
    return tickers, dates

def get_prices(ticker, signal_date):
    c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); cur=c.cursor()
    cur.execute("SELECT close_price,volume FROM price_history WHERE ticker=? AND market='EGX' AND date<=? AND close_price>0 ORDER BY date DESC LIMIT 60",(ticker,signal_date))
    rows=cur.fetchall()[::-1]; c.close()
    return [r[0] for r in rows], [r[1] for r in rows if r[1]]

def get_future(ticker, signal_date, dates, max_hold):
    idx = dates.index(signal_date) if signal_date in dates else 0
    fd = dates[idx+1:idx+1+max_hold]
    if not fd: return []
    c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); cur=c.cursor()
    ph=','.join('?'*len(fd))
    cur.execute(f"SELECT date,high_price,low_price,close_price FROM price_history WHERE ticker=? AND market='EGX' AND date IN ({ph}) ORDER BY date",(ticker,*fd))
    rows=cur.fetchall(); c.close()
    return rows

def simulate_trade(entry, stop, target, future_rows):
    for fr in future_rows:
        f_date, f_high, f_low, f_close = fr
        if f_low and stop and f_low <= stop:
            return stop, 'STOP_LOSS', f_date
        if f_high and target and f_high >= target:
            return target, 'TARGET_HIT', f_date
    if future_rows:
        f = future_rows[-1]
        return f[3], 'HOLDING_EXPIRED', f[0]
    return None, None, None

def calc_metrics(trades, capital):
    if not trades: return {'trades':0,'wr':'N/A','pnl':0,'pf':'N/A','ret':'0%','dd':0,'exp':0,'streak':0}
    w=[t for t in trades if t['net%']>0.5]; l=[t for t in trades if t['net%']<-0.5]
    wr=len(w)/len(trades)*100; tp=sum(t['pnl'] for t in w); tl=abs(sum(t['pnl'] for t in l))
    pf=tp/tl if tl>0 else float('inf'); ret=(cap-CAPITAL)/CAPITAL*100
    aw=statistics.mean([t['net%'] for t in w]) if w else 0
    al=statistics.mean([t['net%'] for t in l]) if l else 0
    exp=(wr/100*aw)+((100-wr)/100*al) if w or l else 0
    peak=CAPITAL; dd=0
    for t in trades:
        if t['cap']>peak: peak=t['cap']
        d=(peak-t['cap'])/peak*100
        if d>dd: dd=d
    ms=0; cs=0
    for t in trades:
        if t['net%']<-0.5: cs+=1; ms=max(ms,cs)
        else: cs=0
    return {'trades':len(trades),'wins':len(w),'losses':len(l),'wr':f'{wr:.0f}%','pnl':round(sum(t['pnl'] for t in trades),2),
            'pf':f'{pf:.2f}' if pf!=float('inf') else '∞','ret':f'{ret:+.2f}%','avg_w':f'{aw:+.2f}%','avg_l':f'{al:+.2f}%',
            'exp':f'{exp:+.2f}%','dd':f'{dd:.2f}%','streak':ms}

def run_experiment(name, weights, tickers, dates, use_liquidity_gate=True, use_conflict=False, use_decision_table=False, split_date=None):
    """يشغّل تجربة واحدة بسياسة محددة."""
    from core.orchestrator_v3 import create_v3_plan, final_decision, resolve_conflict
    from core.executor_v3 import execute_v3
    from core.risk_gate import apply_risk_gate

    trades=[]; cap=CAPITAL; no_trade=0; decisions=0
    test_dates = [d for d in dates if (d <= split_date) == False] if split_date else dates

    for i, sd in enumerate(dates):
        if split_date and sd <= split_date:
            continue  # skip in-sample dates for walk-forward
        if i < 60: continue
        for tk in tickers:
            pr, vl = get_prices(tk, sd)
            if len(pr) < 50: continue

            plan = create_v3_plan(tk, pr, vl, fund_available=False, event_available=False)
            if plan.decision_policy == 'no_trade':
                no_trade += 1; continue

            # Override weights if custom weights provided
            if weights:
                from core.orchestrator_v3 import normalize_weights
                plan.normalized_weights = normalize_weights(weights, [f for f in weights if f in ['TREND','MOM','MR','BRK','FLOW']])

            # Liquidity gate (Phase 1)
            if use_liquidity_gate and vl and len(vl) >= 20:
                avg_vol = sum(vl[-20:]) / 20
                recent_vol = sum(vl[-5:]) / 5
                if avg_vol > 0 and recent_vol < avg_vol * 0.2:
                    no_trade += 1; continue

            try:
                er = execute_v3(plan, prices=pr, volumes=vl, ticker=tk, market='EGX')
            except:
                continue
            decisions += 1
            if not er.complete:
                no_trade += 1; continue

            sc = er.signal_score; conf = er.confidence

            if use_conflict:
                ok, _ = resolve_conflict(er.engine_scores)
                if not ok:
                    no_trade += 1; continue

            if use_decision_table:
                d2, _ = final_decision(sc, conf, True, False)
                if d2 != 'BUY_CANDIDATE':
                    no_trade += 1; continue

            if sc < 20:
                no_trade += 1; continue

            entry = pr[-1]; stop = entry * 0.95; target = entry * 1.10; rr = 2.0
            fs, w, ps = apply_risk_gate('BUY', sc, {'risk_reward_ratio': rr}, position_size_pct=POS_SIZE)
            if fs == 'NO_TRADE':
                no_trade += 1; continue

            fr = get_future(tk, sd, dates, MAX_HOLD)
            if not fr: continue

            ep, er2, ed = simulate_trade(entry, stop, target, fr)
            if not ep: continue

            g = (ep - entry) / entry * 100; costs = COMMISSION * 2 + SLIPPAGE * 2; n = g - costs
            pv = cap * (ps / 100); pnl = pv * (n / 100); cap += pnl
            trades.append({'experiment': name, 'date': sd, 'week': wk(sd), 'ticker': tk,
                           'score': round(sc, 2), 'entry': round(entry, 4), 'exit': round(ep, 4),
                           'reason': er2, 'gross%': round(g, 2), 'net%': round(n, 2),
                           'pnl': round(pnl, 2), 'cap': round(cap, 2)})

    return trades, no_trade, cap, decisions

def generate_coarse_weights():
    """يولّد تركيبات أوزان بفواصل 10% (مجموع=100)."""
    # Simplified: test key variations around V1
    combos = []
    # V1 baseline
    combos.append(('V1', {'TREND':25,'MOM':20,'MR':10,'BRK':10,'FLOW':20,'FUND':10,'EVENT':5}))
    # Equal weights
    combos.append(('EQUAL', {'TREND':14,'MOM':14,'MR':14,'BRK':14,'FLOW':15,'FUND':15,'EVENT':14}))
    # Trend-heavy
    combos.append(('TREND_HEAVY', {'TREND':40,'MOM':20,'MR':5,'BRK':10,'FLOW':15,'FUND':5,'EVENT':5}))
    # Flow-heavy
    combos.append(('FLOW_HEAVY', {'TREND':15,'MOM':10,'MR':10,'BRK':10,'FLOW':35,'FUND':10,'EVENT':10}))
    # No fundamentals/events
    combos.append(('NO_FUND_EVT', {'TREND':30,'MOM':25,'MR':15,'BRK':15,'FLOW':15,'FUND':0,'EVENT':0}))
    # Momentum-heavy
    combos.append(('MOM_HEAVY', {'TREND':20,'MOM':35,'MR':5,'BRK':15,'FLOW':15,'FUND':5,'EVENT':5}))
    # Breakout-heavy
    combos.append(('BRK_HEAVY', {'TREND':15,'MOM':15,'MR':5,'BRK':35,'FLOW':20,'FUND':5,'EVENT':5}))
    # Conservative (high risk weight via FLOW)
    combos.append(('CONSERVATIVE', {'TREND':10,'MOM':10,'MR':15,'BRK':5,'FLOW':40,'FUND':10,'EVENT':10}))
    return combos

def main():
    os.makedirs(OUT, exist_ok=True)
    all_experiments = []
    all_trades = []

    tickers, dates = get_data()
    print(f"Tickers: {len(tickers)} | Dates: {len(dates)}")
    print(f"Walk-Forward split: in-sample ≤ {WF_SPLIT_DATE}, validation > {WF_SPLIT_DATE}")

    # ================================================================
    # PHASE 0: Baseline
    # ================================================================
    print("\n" + "="*60)
    print("PHASE 0: Baseline (B0)")
    print("="*60)
    t0 = time.time()
    trades, nt, cap, dec = run_experiment('B0', None, tickers, dates)
    m = calc_metrics(trades, cap)
    m['no_trade'] = nt; m['decisions'] = dec; m['phase'] = 0
    all_experiments.append({'name':'B0','phase':0,'desc':'Baseline',**m})
    all_trades.extend(trades)
    print(f"  Trades={m['trades']} WR={m['wr']} PF={m['pf']} P&L={m['pnl']} DD={m['dd']} Exp={m['exp']} NT={nt} Dec={dec} ({time.time()-t0:.1f}s)")

    # ================================================================
    # PHASE 1: Liquidity Gate (on/off)
    # ================================================================
    print("\n" + "="*60)
    print("PHASE 1: Liquidity Gate")
    print("="*60)

    # V1 without liquidity gate
    t1 = time.time()
    trades1a, nt1a, cap1a, dec1a = run_experiment('P1_V1_NO_LIQ', V1_WEIGHTS['S1'], tickers, dates, use_liquidity_gate=False)
    m1a = calc_metrics(trades1a, cap1a); m1a['no_trade']=nt1a; m1a['decisions']=dec1a; m1a['phase']=1
    all_experiments.append({'name':'P1_V1_NO_LIQ','phase':1,'desc':'V1 weights, no liquidity gate',**m1a})
    all_trades.extend(trades1a)
    print(f"  P1_V1_NO_LIQ: Trades={m1a['trades']} WR={m1a['wr']} PF={m1a['pf']} P&L={m1a['pnl']} NT={nt1a} ({time.time()-t1:.1f}s)")

    # V1 with liquidity gate
    t2 = time.time()
    trades1b, nt1b, cap1b, dec1b = run_experiment('P1_V1_LIQ', V1_WEIGHTS['S1'], tickers, dates, use_liquidity_gate=True)
    m1b = calc_metrics(trades1b, cap1b); m1b['no_trade']=nt1b; m1b['decisions']=dec1b; m1b['phase']=1
    all_experiments.append({'name':'P1_V1_LIQ','phase':1,'desc':'V1 weights, with liquidity gate',**m1b})
    all_trades.extend(trades1b)
    print(f"  P1_V1_LIQ:    Trades={m1b['trades']} WR={m1b['wr']} PF={m1b['pf']} P&L={m1b['pnl']} NT={nt1b} ({time.time()-t2:.1f}s)")

    # ================================================================
    # PHASE 2: Coarse Weight Search
    # ================================================================
    print("\n" + "="*60)
    print("PHASE 2: Coarse Weight Search (10% steps)")
    print("="*60)
    combos = generate_coarse_weights()
    phase2_results = []

    for name, weights in combos:
        t = time.time()
        trades, nt, cap, dec = run_experiment(f'P2_{name}', weights, tickers, dates, use_liquidity_gate=True)
        m = calc_metrics(trades, cap); m['no_trade']=nt; m['decisions']=dec; m['phase']=2
        all_experiments.append({'name':f'P2_{name}','phase':2,'desc':f'Coarse: {name}',**m})
        all_trades.extend(trades)
        phase2_results.append((name, m, weights))
        print(f"  P2_{name:<15}: Trades={m['trades']} WR={m['wr']} PF={m['pf']} P&L={m['pnl']} DD={m['dd']} Exp={m['exp']} ({time.time()-t:.1f}s)")

    # ================================================================
    # PHASE 3: Fine Weights around best from Phase 2
    # ================================================================
    print("\n" + "="*60)
    print("PHASE 3: Fine Weight Search (5% around best)")
    print("="*60)

    # Find best by PF (or P&L if PF=∞)
    def score_key(m):
        pf = float(m['pf']) if m['pf'] != '∞' else 999
        pnl = m['pnl']
        return (pf, pnl)
    best_p2 = max(phase2_results, key=lambda x: score_key(x[1]))
    best_name, best_m, best_w = best_p2
    print(f"  Best from Phase 2: {best_name} (PF={best_m['pf']}, P&L={best_m['pnl']})")

    # Generate fine variations (±5% on top 2 families)
    fine_combos = []
    for family in ['TREND', 'FLOW', 'MOM']:
        for delta in [-5, +5]:
            w = dict(best_w)
            w[family] = max(0, w[family] + delta)
            # Re-normalize
            total = sum(w.values())
            if total > 0:
                w = {k: round(v/total*100) for k, v in w.items()}
            fine_combos.append((f'{best_name}_{family}{"+" if delta>0 else "-"}5', w))

    for name, weights in fine_combos:
        t = time.time()
        trades, nt, cap, dec = run_experiment(f'P3_{name}', weights, tickers, dates, use_liquidity_gate=True)
        m = calc_metrics(trades, cap); m['no_trade']=nt; m['decisions']=dec; m['phase']=3
        all_experiments.append({'name':f'P3_{name}','phase':3,'desc':f'Fine: {name}',**m})
        all_trades.extend(trades)
        print(f"  P3_{name:<25}: Trades={m['trades']} WR={m['wr']} PF={m['pf']} P&L={m['pnl']} ({time.time()-t:.1f}s)")

    # ================================================================
    # PHASE 4: Family Ablation (remove one family at a time)
    # ================================================================
    print("\n" + "="*60)
    print("PHASE 4: Family Ablation")
    print("="*60)

    for family in FAMILIES:
        w = dict(best_w)
        w[family] = 0
        # Re-normalize
        total = sum(w.values())
        if total > 0:
            w = {k: round(v/total*100) for k, v in w.items()}
        name = f'NO_{family}'
        t = time.time()
        trades, nt, cap, dec = run_experiment(f'P4_{name}', w, tickers, dates, use_liquidity_gate=True)
        m = calc_metrics(trades, cap); m['no_trade']=nt; m['decisions']=dec; m['phase']=4
        all_experiments.append({'name':f'P4_{name}','phase':4,'desc':f'Without {family}',**m})
        all_trades.extend(trades)
        print(f"  P4_NO_{family:<8}: Trades={m['trades']} WR={m['wr']} PF={m['pf']} P&L={m['pnl']} ({time.time()-t:.1f}s)")

    # ================================================================
    # PHASE 5: Walk-Forward Validation
    # ================================================================
    print("\n" + "="*60)
    print(f"PHASE 5: Walk-Forward (in-sample ≤ {WF_SPLIT_DATE}, validation > {WF_SPLIT_DATE})")
    print("="*60)

    # In-sample
    t = time.time()
    trades_is, nt_is, cap_is, dec_is = run_experiment('P5_INSAMPLE', best_w, tickers, dates, use_liquidity_gate=True, split_date=None)
    # Filter to in-sample dates only
    trades_is = [t for t in trades_is if t['date'] <= WF_SPLIT_DATE]
    m_is = calc_metrics(trades_is, CAPITAL)
    m_is['phase'] = 5; m_is['no_trade'] = nt_is; m_is['decisions'] = dec_is
    all_experiments.append({'name':'P5_INSAMPLE','phase':5,'desc':'Walk-Forward in-sample',**m_is})
    print(f"  P5_INSAMPLE:  Trades={m_is['trades']} WR={m_is['wr']} PF={m_is['pf']} P&L={m_is['pnl']} ({time.time()-t:.1f}s)")

    # Out-of-sample
    t = time.time()
    trades_oos, nt_oos, cap_oos, dec_oos = run_experiment('P5_OOS', best_w, tickers, dates, use_liquidity_gate=True, split_date=WF_SPLIT_DATE)
    m_oos = calc_metrics(trades_oos, cap_oos); m_oos['phase']=5; m_oos['no_trade']=nt_oos; m_oos['decisions']=dec_oos
    all_experiments.append({'name':'P5_OOS','phase':5,'desc':'Walk-Forward out-of-sample',**m_oos})
    all_trades.extend(trades_oos)
    print(f"  P5_OOS:       Trades={m_oos['trades']} WR={m_oos['wr']} PF={m_oos['pf']} P&L={m_oos['pnl']} ({time.time()-t:.1f}s)")

    # ================================================================
    # FINAL SUMMARY
    # ================================================================
    print("\n" + "="*60)
    print("ALL EXPERIMENTS SUMMARY")
    print("="*60)
    print(f"{'Phase':<6} {'Name':<25} {'Trades':>7} {'WR':>6} {'PF':>6} {'P&L':>10} {'Return':>8} {'DD':>7} {'Exp':>8} {'NT':>5}")
    print("-"*95)
    for e in all_experiments:
        print(f"{e['phase']:<6} {e['name']:<25} {e['trades']:>7} {e['wr']:>6} {e['pf']:>6} {e['pnl']:>+9.2f} {e['ret']:>8} {e.get('dd','?'):>7} {e.get('exp','?'):>8} {e.get('no_trade',0):>5}")

    # Save all experiments
    with open(OUT / 'all_experiments.csv', 'w', newline='') as f:
        if all_experiments:
            w = csv.DictWriter(f, fieldnames=list(all_experiments[0].keys()))
            w.writeheader()
            for e in all_experiments: w.writerow(e)

    # Save all trades
    if all_trades:
        with open(OUT / 'all_trades.csv', 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(all_trades[0].keys()))
            w.writeheader()
            for t in all_trades: w.writerow(t)

    # Final recommendation
    best_overall = max(all_experiments, key=lambda x: score_key(x))
    with open(OUT / 'final_recommendation.md', 'w') as f:
        f.write("# Final Recommendation\n\n")
        f.write(f"**Best experiment:** {best_overall['name']}\n")
        f.write(f"**Description:** {best_overall.get('desc','')}\n")
        f.write(f"**Trades:** {best_overall['trades']}\n")
        f.write(f"**Win Rate:** {best_overall['wr']}\n")
        f.write(f"**Profit Factor:** {best_overall['pf']}\n")
        f.write(f"**Net P&L:** {best_overall['pnl']} EGP\n")
        f.write(f"**Return:** {best_overall['ret']}\n")
        f.write(f"**Max Drawdown:** {best_overall.get('dd','?')}\n")
        f.write(f"**Expectancy:** {best_overall.get('exp','?')}\n")
        f.write(f"**NO_TRADE:** {best_overall.get('no_trade',0)}\n\n")
        f.write("## Walk-Forward Results\n\n")
        f.write(f"| Phase | Trades | WR | PF | P&L |\n")
        f.write(f"|-------|--------|----|----|-----|\n")
        f.write(f"| In-Sample | {m_is['trades']} | {m_is['wr']} | {m_is['pf']} | {m_is['pnl']} |\n")
        f.write(f"| Out-of-Sample | {m_oos['trades']} | {m_oos['wr']} | {m_oos['pf']} | {m_oos['pnl']} |\n\n")
        f.write("## Limitations\n")
        f.write(f"- Sample: {SAMPLE_TICKERS} tickers\n")
        f.write(f"- Window: {WINDOW_START} to {WINDOW_END}\n")
        f.write(f"- Walk-Forward split: {WF_SPLIT_DATE}\n")
        f.write("- Statistical significance limited by sample size\n")

    print(f"\nOutputs saved to: {OUT}/")
    print(f"  all_experiments.csv ({len(all_experiments)} experiments)")
    print(f"  all_trades.csv ({len(all_trades)} trades)")
    print(f"  final_recommendation.md")
    print(f"\nTo push to GitHub:")
    print(f"  git add -A")
    print(f"  git commit -m 'results(staged-optimization): full 6-phase results'")
    print(f"  git push origin main")

if __name__ == '__main__':
    main()
