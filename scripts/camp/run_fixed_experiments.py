#!/usr/bin/env python3
"""Fixed Open Camp: V38 experiments with CORRECT date matching."""
import sys, json, time, math, sqlite3, copy
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

TRAIN_START='2025-10-01'; TRAIN_END='2026-01-31'; MAX_TICKERS=250
POSITION_SIZE=0.20; HOLDING_DAYS=30

def get_regime(d):
    m=d[:7]
    if m in('2025-05','2025-09','2025-10'):return'BULL'
    if m in('2025-02','2025-03','2026-02','2026-03','2026-04','2026-05','2026-06'):return'BEAR'
    return'SIDEWAYS'

def load_data():
    conn=sqlite3.connect(str(DB_DIR/'price_history.db'),timeout=30.0)
    try:
        conn2=sqlite3.connect(str(DB_DIR/'stocks.db'),timeout=10.0)
        sm=dict(conn2.execute("SELECT ticker,sector FROM stocks WHERE is_active=1 AND sector IS NOT NULL").fetchall())
        conn2.close()
    except:sm={}
    tickers=[r[0]for r in conn.execute("SELECT DISTINCT ticker FROM price_history WHERE date>='2025-09-01'AND date<=?AND ticker NOT LIKE '%.%'ORDER BY ticker LIMIT?",(TRAIN_END,MAX_TICKERS)).fetchall()]
    data={}; date_lookup={}
    for t in tickers:
        rows=conn.execute("SELECT date,open_price,high_price,low_price,close_price,volume FROM price_history WHERE ticker=?AND date>='2025-09-01'AND date<=?AND close_price>0 ORDER BY date",(t,TRAIN_END)).fetchall()
        if len(rows)<50:continue
        candles=[]
        for r in rows:
            c={'date':r[0],'open':r[1],'high':r[2],'low':r[3],'close':r[4],'volume':r[5]}
            candles.append(c)
        closes=[c['close']for c in candles]; vols=[c['volume']for c in candles]
        for i,c in enumerate(candles):
            c['sma50']=sum(closes[max(0,i-49):i+1])/min(50,i+1)if i>=49 else None
            c['vol_ma20']=sum(vols[max(0,i-19):i+1])/min(20,i+1)if i>=19 else None
            c['roc5']=((closes[i]/closes[i-5]-1)*100)if i>=5 and closes[i-5]>0 else None
            if i>=14:
                g,l=[],[]
                for j in range(max(1,i-13),i+1):
                    ch=closes[j]-closes[j-1];g.append(max(0,ch));l.append(max(0,-ch))
                ag=sum(g)/14;al=sum(l)/14 or.001;c['rsi']=100-100/(1+ag/al)
            else:c['rsi']=None
            c['sector']=sm.get(t,'Unknown');c['regime']=get_regime(c['date'])
        data[t]=candles
        date_lookup[t]={c['date']:c for c in candles}
    conn.close()
    return data, date_lookup

def precompute_v38(data, date_lookup):
    """Run V38 once, match signals to day data via DATE (not index)."""
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    engine=V38BacktestEngine(buy_threshold=60,use_v393=True,market_code='EGX')
    engine._load_fundamentals();engine._load_benchmark()
    pre_cache_price_history(list(data.keys()),engine)
    signals=[]
    for t in data:
        d,o,h,l,c,v=engine.get_price_data(t)
        if len(c)<50:continue
        for i in range(50,len(c)):
            if d[i]<TRAIN_START or d[i]>TRAIN_END:continue
            try:
                r=engine.analyze_single_day(t,d,o,h,l,c,v,i)
                sig=r.get('signal','WAIT')
                if sig not in('BUY','STRONG_BUY','INSTITUTIONAL_BUY'):continue
                entry=r.get('entry_price',c[i])
                tgt=r.get('target_price')or entry*1.10
                stp=r.get('stop_loss')or entry*.93
                # FIX: Use date lookup instead of index
                day=date_lookup.get(t,{}).get(d[i])
                signals.append({'date':d[i],'ticker':t,'entry':entry,'target':tgt,'stop':stp,'day':day,'result':r})
            except:pass
    return signals

def calc_metrics(sigs):
    if not sigs:return{'signals':0,'wr':0,'pf':0,'max_dd':0,'avg_ret':0,'sharpe':0,'expectancy':0,'avg_win':0,'avg_loss':0}
    conn=sqlite3.connect(str(DB_DIR/'price_history.db'),timeout=30.0)
    w=l=e=0;gp=gl=0;eq=100000;pk=eq;mdd=0;rets=[];wins_ret=[];losses_ret=[]
    for s in sigs:
        f=conn.execute("SELECT high_price,low_price,close_price FROM price_history WHERE ticker=?AND date>?ORDER BY date LIMIT?",(s['ticker'],s['date'],HOLDING_DAYS)).fetchall()
        ep=None;oc='EXPIRED'
        for h,lo,c in f:
            if lo is not None and s['stop']is not None and lo<=s['stop']:ep=s['stop'];oc='STOPPED';break
            if h is not None and s['target']is not None and h>=s['target']:ep=s['target'];oc='TARGET_HIT';break
        if ep is None and f:ep=f[-1][2]or s['entry']
        if ep is None:continue
        ret=(ep/s['entry']-1)*100;rets.append(ret)
        if oc=='TARGET_HIT':w+=1;gp+=ret;wins_ret.append(ret)
        elif oc=='STOPPED':l+=1;gl+=abs(ret);losses_ret.append(ret)
        else:e+=1
        if ret>0:gp+=ret if oc!='TARGET_HIT' else 0
        else:gl+=abs(ret) if oc!='STOPPED' else 0
        eq+=eq*POSITION_SIZE*(ret/100);pk=max(pk,eq);dd=(pk-eq)/pk*100 if pk>0 else 0;mdd=max(mdd,dd)
    conn.close()
    n=len(sigs);wr=w/n*100 if n>0 else 0;pf=gp/gl if gl>0 else 0;ar=sum(rets)/n if rets else 0
    std=math.sqrt(sum((r-ar)**2 for r in rets)/(n-1))if n>1 else 0
    sh=(ar/std*math.sqrt(n))if std>0 else 0
    avg_win=sum(wins_ret)/len(wins_ret)if wins_ret else 0
    avg_loss=abs(sum(losses_ret)/len(losses_ret))if losses_ret else 0
    return{'signals':n,'wins':w,'losses':l,'wr':round(wr,1),'pf':round(pf,2),
           'max_dd':round(mdd,1),'avg_ret':round(ar,2),'sharpe':round(sh,2),
           'expectancy':round(ar*POSITION_SIZE,2),
           'avg_win':round(avg_win,2),'avg_loss':round(avg_loss,2)}

# Filters — now work correctly because day is properly matched
def f_bull(s):return s['day']is None or s['day'].get('regime')=='BULL'
def f_rsi(s):d=s['day'];return d is None or d.get('rsi')is None or 40<=d['rsi']<=70
def f_vol(s):d=s['day'];return d is None or d.get('vol_ma20')is None or d['vol_ma20']==0 or d['volume']>=d['vol_ma20']*1.2
def f_stop5(s):s2=copy.deepcopy(s);s2['stop']=s2['entry']*0.95;return s2
def f_tgt75(s):s2=copy.deepcopy(s);s2['target']=s2['entry']*1.075;return s2

def apply_filter(sigs,fn):
    if fn in(f_stop5,f_tgt75):
        return[fn(s)for s in sigs]  # transform, not filter
    return[s for s in sigs if fn(s)]

def main():
    print(f"\n{'='*70}\n  Fixed Open Camp: V38 Experiments (CORRECT date matching)\n{'='*70}\n")
    print("  Loading data...");data,date_lookup=load_data();print(f"  {len(data)} tickers")
    
    print("\n  Pre-computing V38 signals (ONE TIME)...")
    t0=time.time()
    all_sigs=precompute_v38(data,date_lookup)
    print(f"  {len(all_sigs)} signals in {time.time()-t0:.0f}s")
    
    # Baseline
    base=calc_metrics(all_sigs)
    print(f"  Baseline: PF={base['pf']}, WR={base['wr']}%, DD=-{base['max_dd']}%")
    
    exps=[{'name':'V38 Baseline','m':base,'d':0,'v':'baseline'}]
    
    # Single filters
    for name,fn in[('BullOnly',f_bull),('RSI 40-70',f_rsi),('Vol 1.2x',f_vol)]:
        filtered=apply_filter(all_sigs,fn)
        m=calc_metrics(filtered);d=round(m['pf']-base['pf'],2)
        v='KEEP'if d>=0.05 and m['max_dd']<=base['max_dd']+5 else'REJECT'
        exps.append({'name':name,'m':m,'d':d,'v':v})
        print(f"  {name}: sig={m['signals']}, PF={m['pf']}(Δ{d:+.2f}), WR={m['wr']}% → {v}")
    
    # Stop/Target modifications
    for name,fn in[('Stop 5%',f_stop5),('Target 7.5%',f_tgt75)]:
        filtered=apply_filter(all_sigs,fn)
        m=calc_metrics(filtered);d=round(m['pf']-base['pf'],2)
        v='KEEP'if d>=0.05 and m['max_dd']<=base['max_dd']+5 else'REJECT'
        exps.append({'name':name,'m':m,'d':d,'v':v})
        print(f"  {name}: sig={m['signals']}, PF={m['pf']}(Δ{d:+.2f}), WR={m['wr']}% → {v}")
    
    # Combinations
    def f_bull_rsi(s):return f_bull(s)and f_rsi(s)
    def f_bull_vol(s):return f_bull(s)and f_vol(s)
    def f_rsi_vol(s):return f_rsi(s)and f_vol(s)
    def f_bull_rsi_vol(s):return f_bull(s)and f_rsi(s)and f_vol(s)
    
    for name,fn in[('Bull+RSI',f_bull_rsi),('Bull+Vol',f_bull_vol),
                    ('RSI+Vol',f_rsi_vol),('Bull+RSI+Vol',f_bull_rsi_vol)]:
        filtered=[s for s in all_sigs if fn(s)]
        m=calc_metrics(filtered);d=round(m['pf']-base['pf'],2)
        v='KEEP'if d>=0.05 and m['max_dd']<=base['max_dd']+5 else'REJECT'
        exps.append({'name':name,'m':m,'d':d,'v':v})
        print(f"  {name}: sig={m['signals']}, PF={m['pf']}(Δ{d:+.2f}), WR={m['wr']}% → {v}")
    
    # Best combo
    kept=[e for e in exps if e['v']=='KEEP']
    if kept:
        def f_best(s):
            for e in kept:
                if'Bull'in e['name']and not f_bull(s):return False
                if'RSI'in e['name']and not f_rsi(s):return False
                if'Vol'in e['name']and not f_vol(s):return False
            return True
        filtered=[s for s in all_sigs if f_best(s)]
        m=calc_metrics(filtered);d=round(m['pf']-base['pf'],2)
        v='BEST'if d>=0.05 else'REJECT'
        exps.append({'name':'All Best','m':m,'d':d,'v':v})
        print(f"  All Best: sig={m['signals']}, PF={m['pf']}(Δ{d:+.2f}) → {v}")
    else:
        exps.append({'name':'All Best','m':base,'d':0,'v':'NO KEEP'})
    
    # Final report
    print(f"\n{'='*70}\n  📊 FIXED OPEN CAMP — FINAL RESULTS\n{'='*70}\n")
    print(f"  {'#':>2}{'Experiment':<18}{'Sig':>5}{'WR':>6}{'PF':>6}{'AvgW':>6}{'AvgL':>6}{'Exp':>6}{'MaxDD':>7}{'Sharpe':>7}{'ΔPF':>6}{'Verdict':>8}")
    print(f"  {'─'*85}")
    for i,e in enumerate(exps):
        m=e['m']
        print(f"  {i:>2}{e['name']:<18}{m['signals']:>5}{m['wr']:>5.1f}%{m['pf']:>6.2f}{m.get('avg_win',0):>+5.1f}%-{m.get('avg_loss',0):>4.1f}%{m.get('expectancy',0):>+5.2f}-{m['max_dd']:>5.1f}%{m['sharpe']:>7.2f}{e['d']:>+5.2f}{e['v']:>8}")
    
    # Save
    rd=PROJECT_ROOT/'scripts'/'camp'/'results';rd.mkdir(parents=True,exist_ok=True)
    with open(rd/'fixed_open_camp.json','w')as f:json.dump({'ts':datetime.now().isoformat(),'exps':exps},f,indent=2,default=str)
    rp=PROJECT_ROOT/'scripts'/'camp'/'reports';rp.mkdir(parents=True,exist_ok=True)
    with open(rp/'FIXED-OPEN-CAMP-FINAL.md','w')as f:
        f.write(f"# Fixed Open Camp — Final Results\n\nGenerated: {datetime.now().isoformat()}\n\n")
        f.write(f"| # | Experiment | Signals | WR | PF | Avg Win | Avg Loss | Expectancy | Max DD | Sharpe | Δ PF | Verdict |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n")
        for i,e in enumerate(exps):
            m=e['m']
            f.write(f"| {i} | {e['name']} | {m['signals']} | {m['wr']}% | {m['pf']} | +{m.get('avg_win',0)}% | -{m.get('avg_loss',0)}% | {m.get('expectancy',0)}% | -{m['max_dd']}% | {m['sharpe']} | {e['d']:+.2f} | {e['v']} |\n")
    print(f"\n  💾 Saved to camp/results/ + camp/reports/")
    print(f"{'='*70}\n")

if __name__=='__main__':main()
