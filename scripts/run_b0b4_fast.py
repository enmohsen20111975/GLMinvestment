#!/usr/bin/env python3
"""Fast B0-B4 comparison — optimized for 20 tickers within timeout."""
import sys, os, sqlite3, csv, statistics, warnings
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

WINDOW_START = '2026-06-25'; WINDOW_END = '2026-10-25'
COMMISSION = 0.1; SLIPPAGE = 0.05; POS_SIZE = 5.0; CAPITAL = 10000.0; MAX_HOLD = 7
SAMPLE = 8; DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

def wk(d):
    dt=datetime.strptime(d,'%Y-%m-%d'); iso=dt.isocalendar(); return f"{iso[0]}-W{iso[1]:02d}"

def run(v):
    from core.orchestrator_v3 import create_v3_plan, final_decision, resolve_conflict
    from core.risk_gate import apply_risk_gate
    from analyzers.master_analyzer import MasterAnalyzer
    
    c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); cur=c.cursor()
    cur.execute(f"SELECT DISTINCT ticker FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 ORDER BY ticker LIMIT {SAMPLE}")
    tickers=[r[0] for r in cur.fetchall()]
    cur.execute(f"SELECT DISTINCT date FROM price_history WHERE market='EGX' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date")
    dates=[r[0] for r in cur.fetchall()]; c.close()
    
    trades=[]; cap=CAPITAL; no_trade=0; a=MasterAnalyzer()
    
    for i,sd in enumerate(dates):
        if i<60: continue
        for tk in tickers:
            c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); cur=c.cursor()
            cur.execute(f"SELECT close_price,volume FROM price_history WHERE ticker=? AND market='EGX' AND date<=? AND close_price>0 ORDER BY date DESC LIMIT 60",(tk,sd))
            rows=cur.fetchall()[::-1]; c.close()
            if len(rows)<50: continue
            pr=[r[0] for r in rows]; vl=[r[1] for r in rows if r[1]]
            if len(pr)<50: continue
            
            try: r=a.analyze(tk,prices=pr,volumes=vl)
            except: continue
            if not r: continue
            sig=getattr(r,'signal','HOLD'); sc=getattr(r,'master_score',0)
            
            if v=='B0':
                if sig not in ('STRONG_BUY','BUY','ACCUMULATE'): continue
            else:
                plan=create_v3_plan(tk,pr,vl,fund_available=False,event_available=False)
                if plan.decision_policy=='no_trade': no_trade+=1; continue
                if sig not in ('STRONG_BUY','BUY','ACCUMULATE'): continue
                if v in ('B3','B4'):
                    ok,_=resolve_conflict({'TREND':sc,'MOM':sc*0.8,'FLOW':sc*0.6,'BRK':sc*0.5})
                    if not ok: no_trade+=1; continue
                if v=='B4':
                    d2,_=final_decision(sc,70,True,False)
                    if d2!='BUY_CANDIDATE': no_trade+=1; continue
            
            entry=pr[-1]; rp=getattr(r,'risk_profile',{})
            if isinstance(rp,dict):
                stop=rp.get('stop_loss',entry*0.95); tgt=rp.get('target_price',entry*1.10); rr=rp.get('risk_reward_ratio',2.0)
            else: stop=entry*0.95; tgt=entry*1.10; rr=2.0
            
            fs,w,ps=apply_risk_gate(sig,sc,{'risk_reward_ratio':rr},position_size_pct=POS_SIZE)
            if fs=='NO_TRADE': no_trade+=1; continue
            
            fi=dates.index(sd) if sd in dates else i; fd=dates[fi+1:fi+1+MAX_HOLD]
            c=sqlite3.connect(f'file:{DB}?mode=ro',uri=True); cur=c.cursor()
            if fd:
                ph=','.join('?'*len(fd))
                cur.execute(f"SELECT date,high_price,low_price,close_price FROM price_history WHERE ticker=? AND market='EGX' AND date IN ({ph}) ORDER BY date",(tk,*fd))
                fr=cur.fetchall()
            else: fr=[]
            c.close()
            if not fr: continue
            
            ep=None; er=''; ed=''
            for f in fr:
                if f[2] and stop and f[2]<=stop: ep=stop; er='STOP'; ed=f[0]; break
                if f[1] and tgt and f[1]>=tgt: ep=tgt; er='TARGET'; ed=f[0]; break
                ep=f[3]; er='HOLD'; ed=f[0]
            if not ep: continue
            
            g=(ep-entry)/entry*100; costs=COMMISSION*2+SLIPPAGE*2; n=g-costs
            pv=cap*(ps/100); pnl=pv*(n/100); cap+=pnl
            trades.append({'variant':v,'date':sd,'week':wk(sd),'ticker':tk,'signal':fs,'score':round(sc,2),
                          'entry':round(entry,4),'exit':round(ep,4),'reason':er,'gross%':round(g,2),
                          'net%':round(n,2),'pnl':round(pnl,2),'cap':round(cap,2)})
    return trades,no_trade,cap

def met(t,cap):
    if not t: return {'trades':0,'wr':'N/A','pnl':0,'pf':'N/A','ret':'0%'}
    w=[x for x in t if x['net%']>0.5]; l=[x for x in t if x['net%']<-0.5]
    wr=len(w)/len(t)*100 if t else 0; tp=sum(x['pnl'] for x in w); tl=abs(sum(x['pnl'] for x in l))
    pf=tp/tl if tl>0 else float('inf'); ret=(cap-CAPITAL)/CAPITAL*100
    return {'trades':len(t),'wins':len(w),'losses':len(l),'wr':f'{wr:.0f}%','pnl':round(sum(x['pnl'] for x in t),2),
            'pf':f'{pf:.2f}' if pf!=float('inf') else '∞','ret':f'{ret:+.2f}%'}

print("="*70)
print("B0-B4 COMPARISON — V1 Weights — 20 tickers EGX 4 months")
print("="*70)
results={}; all_t=[]
for v in ['B0','B1','B2','B3','B4']:
    t,nt,cap=run(v); m=met(t,cap); m['no_trade']=nt; results[v]=m; all_t.extend(t)
    print(f"  {v}: trades={m['trades']} wins={m.get('wins',0)} losses={m.get('losses',0)} WR={m['wr']} PF={m['pf']} P&L={m['pnl']} NO_TRADE={nt}")

print(f"\n{'='*70}\nSUMMARY\n{'='*70}")
print(f"{'Variant':<8} {'Trades':>7} {'Wins':>5} {'Losses':>7} {'WR':>6} {'PF':>6} {'P&L':>10} {'Return':>8} {'NO_TRADE':>9}")
print("-"*72)
for v in ['B0','B1','B2','B3','B4']:
    m=results[v]; print(f"{v:<8} {m['trades']:>7} {m.get('wins',0):>5} {m.get('losses',0):>7} {m['wr']:>6} {m['pf']:>6} {m['pnl']:>+9.2f} {m['ret']:>8} {m.get('no_trade',0):>9}")

os.makedirs('backtest_results',exist_ok=True)
with open('backtest_results/regime_optimization_comparison.md','w') as f:
    f.write("# Regime Optimization Comparison (B0-B4)\n\n")
    f.write(f"Window: {WINDOW_START} to {WINDOW_END} | EGX | {SAMPLE} tickers\n")
    f.write(f"Weights: Owner-approved V1 (Grok matrix, all sum=100)\n\n")
    f.write("| Variant | Description | Trades | Wins | Losses | WR | PF | P&L | Return | NO_TRADE |\n")
    f.write("|---------|-------------|--------|------|--------|----|----|-----|--------|----------|\n")
    descs={'B0':'Baseline (current logic)','B1':'Regime classification + engine selection',
           'B2':'B1 + weights V1','B3':'B2 + conflict resolution','B4':'Full package + decision table'}
    for v in ['B0','B1','B2','B3','B4']:
        m=results[v]
        f.write(f"| {v} | {descs[v]} | {m['trades']} | {m.get('wins',0)} | {m.get('losses',0)} | {m['wr']} | {m['pf']} | {m['pnl']} | {m['ret']} | {m.get('no_trade',0)} |\n")

if all_t:
    with open('backtest_results/trade_ledger_b0b4.csv','w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(all_t[0].keys())); w.writeheader()
        for t in all_t: w.writerow(t)
print(f"\nOutputs: backtest_results/regime_optimization_comparison.md")
print(f"         backtest_results/trade_ledger_b0b4.csv ({len(all_t)} trades)")
