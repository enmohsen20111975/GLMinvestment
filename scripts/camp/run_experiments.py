#!/usr/bin/env python3
"""Open Camp: V38 Additive Testing — 10 experiments, no stops."""
import sys, json, time, math, sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

TRAIN_START='2025-10-01'; TRAIN_END='2026-01-31'; MAX_TICKERS=250
POSITION_SIZE=0.20; TARGET_PCT=10.0; STOP_PCT=7.0; HOLDING_DAYS=30

def get_regime(d):
    m=d[:7]
    if m in ('2025-05','2025-09','2025-10'): return 'BULL'
    if m in ('2025-02','2025-03','2026-02','2026-03','2026-04','2026-05','2026-06'): return 'BEAR'
    return 'SIDEWAYS'

def load_data():
    conn=sqlite3.connect(str(DB_DIR/'price_history.db'),timeout=30.0)
    tickers=[r[0] for r in conn.execute("SELECT DISTINCT ticker FROM price_history WHERE date>='2025-09-01' AND date<=? AND ticker NOT LIKE '%.%' ORDER BY ticker LIMIT ?",(TRAIN_END,MAX_TICKERS)).fetchall()]
    try:
        conn2=sqlite3.connect(str(DB_DIR/'stocks.db'),timeout=10.0)
        sector_map=dict(conn2.execute("SELECT ticker,sector FROM stocks WHERE is_active=1 AND sector IS NOT NULL").fetchall())
        conn2.close()
    except: sector_map={}
    data={}
    for t in tickers:
        rows=conn.execute("SELECT date,open_price,high_price,low_price,close_price,volume FROM price_history WHERE ticker=? AND date>='2025-09-01' AND date<=? AND close_price>0 ORDER BY date",(t,TRAIN_END)).fetchall()
        if len(rows)<50: continue
        candles=[{'date':r[0],'open':r[1],'high':r[2],'low':r[3],'close':r[4],'volume':r[5]} for r in rows]
        closes=[c['close'] for c in candles]; vols=[c['volume'] for c in candles]
        for i,c in enumerate(candles):
            c['sma50']=sum(closes[max(0,i-49):i+1])/min(50,i+1) if i>=49 else None
            c['sma20']=sum(closes[max(0,i-19):i+1])/min(20,i+1) if i>=19 else None
            c['vol_ma20']=sum(vols[max(0,i-19):i+1])/min(20,i+1) if i>=19 else None
            c['roc5']=((closes[i]/closes[i-5]-1)*100) if i>=5 and closes[i-5]>0 else None
            if i>=14:
                g,l=[],[]
                for j in range(max(1,i-13),i+1):
                    ch=closes[j]-closes[j-1]; g.append(max(0,ch)); l.append(max(0,-ch))
                ag=sum(g)/14; al=sum(l)/14 or 0.001; c['rsi']=100-100/(1+ag/al)
            else: c['rsi']=None
            c['sector']=sector_map.get(t,'Unknown'); c['regime']=get_regime(c['date'])
        data[t]=candles
    conn.close()
    return data

def run_v38(data, filter_fn=None):
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    engine=V38BacktestEngine(buy_threshold=60,use_v393=True,market_code='EGX')
    engine._load_fundamentals(); engine._load_benchmark()
    pre_cache_price_history(list(data.keys()),engine)
    signals=[]
    for t in data:
        d,o,h,l,c,v=engine.get_price_data(t)
        if len(c)<50: continue
        for i in range(50,len(c)):
            if d[i]<TRAIN_START or d[i]>TRAIN_END: continue
            try:
                r=engine.analyze_single_day(t,d,o,h,l,c,v,i)
                sig=r.get('signal','WAIT')
                if sig not in ('BUY','STRONG_BUY','INSTITUTIONAL_BUY'): continue
                entry=r.get('entry_price',c[i]); tgt=r.get('target_price') or entry*1.10; stp=r.get('stop_loss') or entry*0.93
                day=data[t][i] if i<len(data[t]) else None
                if filter_fn and not filter_fn(day,r,t): continue
                signals.append({'date':d[i],'ticker':t,'entry':entry,'target':tgt,'stop':stp})
            except: pass
    return signals

def metrics(sigs):
    if not sigs: return {'signals':0,'wr':0,'pf':0,'max_dd':0,'avg_ret':0,'sharpe':0,'expectancy':0}
    conn=sqlite3.connect(str(DB_DIR/'price_history.db'),timeout=30.0)
    w=l=e=0; gp=gl=0; eq=100000; pk=eq; mdd=0; rets=[]
    for s in sigs:
        f=conn.execute("SELECT high_price,low_price,close_price FROM price_history WHERE ticker=? AND date>? ORDER BY date LIMIT ?",(s['ticker'],s['date'],HOLDING_DAYS)).fetchall()
        ep=None; oc='EXPIRED'
        for h,l,c in f:
            if l is not None and s['stop'] is not None and l<=s['stop']: ep=s['stop']; oc='STOPPED'; break
            if h is not None and s['target'] is not None and h>=s['target']: ep=s['target']; oc='TARGET_HIT'; break
        if ep is None and f: ep=f[-1][2] or s['entry']
        if ep is None: continue
        ret=(ep/s['entry']-1)*100; rets.append(ret)
        if oc=='TARGET_HIT': w+=1; gp+=ret
        elif oc=='STOPPED': l+=1; gl+=abs(ret)
        else: e+=1; gp+=ret if ret>0 else 0; gl+=abs(ret) if ret<0 else 0
        eq+=eq*POSITION_SIZE*(ret/100); pk=max(pk,eq); dd=(pk-eq)/pk*100 if pk>0 else 0; mdd=max(mdd,dd)
    conn.close()
    n=len(sigs); wr=w/n*100 if n>0 else 0; pf=gp/gl if gl>0 else 0; ar=sum(rets)/n if rets else 0
    std=math.sqrt(sum((r-ar)**2 for r in rets)/(n-1)) if n>1 else 0
    sh=(ar/std*math.sqrt(n)) if std>0 else 0
    return {'signals':n,'wins':w,'losses':l,'expired':e,'wr':round(wr,1),'pf':round(pf,2),'max_dd':round(mdd,1),'avg_ret':round(ar,2),'sharpe':round(sh,2),'expectancy':round(ar*POSITION_SIZE,2)}

def f_no_bear(d,r,t): return d is None or d.get('regime')!='BEAR'
def f_bull(d,r,t): return d is None or d.get('regime')=='BULL'
def f_rsi(d,r,t): return d is None or d.get('rsi') is None or 40<=d['rsi']<=70
def f_vol(d,r,t): return d is None or d.get('vol_ma20') is None or d['vol_ma20']==0 or d['volume']>=d['vol_ma20']*1.2
def f_stop5(d,r,t):
    if r and r.get('entry_price'): r['stop_loss']=r['entry_price']*0.95
    return True
def f_tgt75(d,r,t):
    if r and r.get('entry_price'): r['target_price']=r['entry_price']*1.075
    return True

def main():
    print(f"\n{'='*70}\n  Open Camp: V38 Additive Testing (10 Experiments)\n{'='*70}\n")
    print("  Loading data..."); data=load_data(); print(f"  {len(data)} tickers loaded")
    
    print("\n  Baseline V38..."); t0=time.time()
    base_sigs=run_v38(data); base=metrics(base_sigs)
    print(f"  Baseline: {len(base_sigs)} sigs in {time.time()-t0:.0f}s → PF={base['pf']}")
    
    exps=[{'name':'V38 Baseline','m':base,'d':0,'v':'baseline'}]
    
    for name,fn in [
        ('V38+NoBear',f_no_bear),('V38+BullOnly',f_bull),('V38+RSI40-70',f_rsi),
        ('V38+Vol1.2x',f_vol),('V38+Stop5%',f_stop5),('V38+Target7.5%',f_tgt75),
    ]:
        print(f"  {name}..."); t0=time.time()
        sigs=run_v38(data,fn); m=metrics(sigs); d=round(m['pf']-base['pf'],2)
        v='KEEP' if d>=0.05 else 'REJECT'
        exps.append({'name':name,'m':m,'d':d,'v':v})
        print(f"    PF={m['pf']} (Δ={d:+.2f}) → {v} [{time.time()-t0:.0f}s]")
    
    # Combo: NoBear + RSI
    print("  V38+NoBear+RSI..."); t0=time.time()
    def f_combo1(d,r,t): return f_no_bear(d,r,t) and f_rsi(d,r,t)
    sigs=run_v38(data,f_combo1); m=metrics(sigs); d=round(m['pf']-base['pf'],2)
    v='KEEP' if d>=0.05 else 'REJECT'
    exps.append({'name':'V38+NoBear+RSI','m':m,'d':d,'v':v})
    print(f"    PF={m['pf']} (Δ={d:+.2f}) → {v} [{time.time()-t0:.0f}s]")
    
    # Combo: NoBear + Stop5%
    print("  V38+NoBear+Stop5%..."); t0=time.time()
    def f_combo2(d,r,t): return f_no_bear(d,r,t) and f_stop5(d,r,t)
    sigs=run_v38(data,f_combo2); m=metrics(sigs); d=round(m['pf']-base['pf'],2)
    v='KEEP' if d>=0.05 else 'REJECT'
    exps.append({'name':'V38+NoBear+Stop5%','m':m,'d':d,'v':v})
    print(f"    PF={m['pf']} (Δ={d:+.2f}) → {v} [{time.time()-t0:.0f}s]")
    
    # Best combo
    kept=[e for e in exps if e['v']=='KEEP']
    if kept:
        print(f"\n  V38+AllBest ({len(kept)} filters)..."); t0=time.time()
        def f_best(d,r,t):
            for e in kept:
                if 'NoBear' in e['name'] and not f_no_bear(d,r,t): return False
                if 'RSI' in e['name'] and not f_rsi(d,r,t): return False
                if 'Vol' in e['name'] and not f_vol(d,r,t): return False
                if 'Stop5' in e['name']: f_stop5(d,r,t)
                if 'Target' in e['name']: f_tgt75(d,r,t)
            return True
        sigs=run_v38(data,f_best); m=metrics(sigs); d=round(m['pf']-base['pf'],2)
        v='BEST' if d>=0.05 else 'REJECT'
        exps.append({'name':'V38+AllBest','m':m,'d':d,'v':v})
        print(f"    PF={m['pf']} (Δ={d:+.2f}) → {v} [{time.time()-t0:.0f}s]")
    else:
        exps.append({'name':'V38+AllBest','m':base,'d':0,'v':'NO KEEP'})
    
    # Final report
    print(f"\n{'='*70}\n  📊 OPEN CAMP — FINAL RESULTS\n{'='*70}\n")
    print(f"  {'#':>2} {'Experiment':<22} {'Sig':>5} {'WR':>6} {'PF':>6} {'MaxDD':>7} {'AvgR':>7} {'ΔPF':>6} {'Verdict':>8}")
    print(f"  {'─'*80}")
    for i,e in enumerate(exps):
        m=e['m']
        print(f"  {i:>2} {e['name']:<22} {m['signals']:>5} {m['wr']:>5.1f}% {m['pf']:>6.2f} -{m['max_dd']:>5.1f}% {m['avg_ret']:>+6.2f}% {e['d']:>+5.2f} {e['v']:>8}")
    
    # Save
    rd=PROJECT_ROOT/'scripts'/'camp'/'results'; rd.mkdir(parents=True,exist_ok=True)
    with open(rd/'open_camp_final.json','w') as f: json.dump({'ts':datetime.now().isoformat(),'exps':exps},f,indent=2,default=str)
    rp=PROJECT_ROOT/'scripts'/'camp'/'reports'; rp.mkdir(parents=True,exist_ok=True)
    with open(rp/'OPEN-CAMP-FINAL.md','w') as f:
        f.write(f"# Open Camp Final Results\n\nGenerated: {datetime.now().isoformat()}\n\n")
        f.write(f"| # | Experiment | Signals | WR | PF | Max DD | Avg Ret | Δ PF | Verdict |\n|---|---|---|---|---|---|---|---|---|\n")
        for i,e in enumerate(exps):
            m=e['m']; f.write(f"| {i} | {e['name']} | {m['signals']} | {m['wr']}% | {m['pf']} | -{m['max_dd']}% | {m['avg_ret']}% | {e['d']:+.2f} | {e['v']} |\n")
    print(f"\n  💾 Saved to camp/results/ + camp/reports/")

if __name__=='__main__': main()
