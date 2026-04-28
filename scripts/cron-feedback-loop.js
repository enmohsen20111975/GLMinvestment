const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');

function getConfigValue(db, name, fallback = 0) {
  try { const r = db.exec("SELECT current_value FROM calculation_weights WHERE parameter_name = '" + name + "'"); if (r.length > 0 && r[0].values.length > 0) return Number(r[0].values[0][0]); } catch {}
  return fallback;
}

async function main() {
  const t0 = Date.now();
  console.log('[FL] EGX Feedback Loop — ' + new Date().toISOString());
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  console.log('[FL] DB loaded (' + (buf.length / 1024 / 1024).toFixed(1) + ' MB)');

  // STEP 1: Validate
  console.log('[FL] Step 1: Validating...');
  const db1 = new SQL.Database(buf);
  db1.run("PRAGMA journal_mode = WAL");
  const cutoff5d = new Date(); cutoff5d.setDate(cutoff5d.getDate() - 5);
  const cd = cutoff5d.toISOString().split('T')[0];
  const unvR = db1.exec("SELECT id,stock_id,ticker,prediction_date,predicted_direction,predicted_price_5d,predicted_price_10d,predicted_price_20d,entry_price,target_price,stop_loss FROM prediction_logs WHERE validated=0 AND prediction_date<='" + cd + "' ORDER BY prediction_date ASC");
  console.log('[FL]   Found', unvR.length > 0 ? unvR[0].values.length : 0, 'unvalidated');
  let vc = 0;
  if (unvR.length > 0) {
    const cols = unvR[0].columns;
    for (const vals of unvR[0].values) {
      const p = {}; for (let i = 0; i < cols.length; i++) p[cols[i]] = vals[i];
      let sid = p.stock_id;
      if (!sid) { const sr = db1.exec("SELECT id FROM stocks WHERE ticker='" + (p.ticker||'') + "'"); if (!sr.length || !sr[0].values.length) continue; sid = sr[0].values[0][0]; }
      const pp = new Date(p.prediction_date);
      const d5 = new Date(pp); d5.setDate(d5.getDate()+5); const d10 = new Date(pp); d10.setDate(d10.getDate()+10); const d20 = new Date(pp); d20.setDate(d20.getDate()+20);
      const hR = db1.exec("SELECT date,close_price FROM stock_price_history WHERE stock_id=" + sid + " AND date>='" + p.prediction_date + "' AND date<='" + d20.toISOString().split('T')[0] + "' ORDER BY date ASC");
      if (!hR.length || !hR[0].values.length) continue;
      const hist = hR[0].values;
      const ent = hist.find(h => new Date(h[0]) >= pp);
      const ep = ent ? ent[1] : (p.entry_price || hist[0][1]);
      const d5s=d5.toISOString().split('T')[0], d10s=d10.toISOString().split('T')[0], d20s=d20.toISOString().split('T')[0];
      let a5=null,a10=null,a20=null;
      for (const r of hist) { const rd=String(r[0]).split('T')[0]; if(!a5&&rd>=d5s) a5=r[1]; if(!a10&&rd>=d10s) a10=r[1]; if(!a20&&rd>=d20s) a20=r[1]; }
      if(!a5&&!a10&&!a20) continue;
      const dir=p.predicted_direction||'neutral';
      const dc5=a5?((dir==='up'&&a5>ep)||(dir==='down'&&a5<ep)||dir==='neutral'?1:0):null;
      const dc10=a10?((dir==='up'&&a10>ep)||(dir==='down'&&a10<ep)||dir==='neutral'?1:0):null;
      const dc20=a20?((dir==='up'&&a20>ep)||(dir==='down'&&a20<ep)||dir==='neutral'?1:0):null;
      const pe5=(a5&&p.predicted_price_5d>0)?Math.round(((a5-p.predicted_price_5d)/p.predicted_price_5d)*10000)/100:null;
      const pe10=(a10&&p.predicted_price_10d>0)?Math.round(((a10-p.predicted_price_10d)/p.predicted_price_10d)*10000)/100:null;
      const pe20=(a20&&p.predicted_price_20d>0)?Math.round(((a20-p.predicted_price_20d)/p.predicted_price_20d)*10000)/100:null;
      const tp=Number(p.target_price)||0,sl=Number(p.stop_loss)||0;
      const ap=[a5,a10,a20].filter(x=>x!==null);
      const tr=tp>0&&ap.length>0?(ap.some(x=>x>=tp)?1:0):null;
      const sh=sl>0&&ap.length>0?(ap.some(x=>x<=sl)?1:0):null;
      try { db1.run("UPDATE prediction_logs SET validated=1,validated_at=datetime('now'),actual_price_5d=?,actual_price_10d=?,actual_price_20d=?,direction_correct_5d=?,direction_correct_10d=?,direction_correct_20d=?,price_error_5d=?,price_error_10d=?,price_error_20d=?,target_reached=?,stop_hit=? WHERE id=?",[a5,a10,a20,dc5,dc10,dc20,pe5,pe10,pe20,tr,sh,p.id]); vc++; } catch{}
    }
  }
  db1.close();
  console.log('[FL]   Validated:', vc);

  // STEP 2: Accuracy
  console.log('[FL] Step 2: Accuracy...');
  const db2 = new SQL.Database(fs.readFileSync(dbPath));
  const s5r=db2.exec("SELECT COUNT(*),SUM(CASE WHEN direction_correct_5d=1 THEN 1 ELSE 0 END),ROUND(AVG(CASE WHEN direction_correct_5d=1 THEN composite_score ELSE NULL END),2) FROM prediction_logs WHERE validated=1 AND direction_correct_5d IS NOT NULL");
  const s10r=db2.exec("SELECT COUNT(*),SUM(CASE WHEN direction_correct_10d=1 THEN 1 ELSE 0 END),ROUND(AVG(CASE WHEN direction_correct_10d=1 THEN composite_score ELSE NULL END),2) FROM prediction_logs WHERE validated=1 AND direction_correct_10d IS NOT NULL");
  const s20r=db2.exec("SELECT COUNT(*),SUM(CASE WHEN direction_correct_20d=1 THEN 1 ELSE 0 END),ROUND(AVG(CASE WHEN direction_correct_20d=1 THEN composite_score ELSE NULL END),2) FROM prediction_logs WHERE validated=1 AND direction_correct_20d IS NOT NULL");
  const s5=s5r.length?{t:s5r[0].values[0][0],c:s5r[0].values[0][1],sc:s5r[0].values[0][2]}:{t:0,c:0,sc:0};
  const s10=s10r.length?{t:s10r[0].values[0][0],c:s10r[0].values[0][1],sc:s10r[0].values[0][2]}:{t:0,c:0,sc:0};
  const s20=s20r.length?{t:s20r[0].values[0][0],c:s20r[0].values[0][1],sc:s20r[0].values[0][2]}:{t:0,c:0,sc:0};
  const a5=s5.t>0?Math.round(s5.c/s5.t*10000)/100:0, a10=s10.t>0?Math.round(s10.c/s10.t*10000)/100:0, a20=s20.t>0?Math.round(s20.c/s20.t*10000)/100:0;
  const tA=s5.t+s10.t+s20.t,tC=s5.c+s10.c+s20.c,oA=tA>0?Math.round(tC/tA*10000)/100:0;
  db2.close();
  console.log('[FL]   5d:'+a5+'%('+s5.t+') 10d:'+a10+'%('+s10.t+') 20d:'+a20+'%('+s20.t+') Overall:'+oA+'%');

  // STEP 3: Weight adjustments
  console.log('[FL] Step 3: Adjustments...');
  const db3 = new SQL.Database(fs.readFileSync(dbPath));
  const fEn=getConfigValue(db3,'feedback_enabled',1)===1, dirTgt=getConfigValue(db3,'feedback_direction_accuracy_target',55), boost=getConfigValue(db3,'feedback_boost_factor',0.05), decay=getConfigValue(db3,'feedback_decay_factor',0.03), maxAdj=getConfigValue(db3,'feedback_max_weight_adjustment',15);
  console.log('[FL]   enabled='+fEn+' target='+dirTgt+'% boost='+boost+' decay='+decay+' maxAdj='+maxAdj+'%');
  const adjs=[];
  if(fEn&&s5.t>=30){
    const sc=Number(s5.sc)||0;
    if(sc>50){const pw=getConfigValue(db3,'weight_profitability',-1);if(pw>=0){const nv=Math.min(Math.round(pw*(1+boost)*1000)/1000,Math.round(pw*(1+maxAdj/100)*1000)/1000);if(nv!==pw)adjs.push({p:'weight_profitability',o:pw,n:nv,r:'Quality score discriminates (avg:'+sc+')'});}}
    else if(sc>0&&sc<=50){const gw=getConfigValue(db3,'weight_growth',-1);if(gw>=0){const nv=Math.min(Math.round(gw*(1+boost)*1000)/1000,Math.round(gw*(1+maxAdj/100)*1000)/1000);if(nv!==gw)adjs.push({p:'weight_growth',o:gw,n:nv,r:'Score not discriminating (avg:'+sc+'), boost growth'});}const pw=getConfigValue(db3,'weight_profitability',-1);if(pw>=0){const nv=Math.max(Math.round(pw*(1-decay)*1000)/1000,Math.round(pw*(1-maxAdj/100)*1000)/1000);if(nv!==pw)adjs.push({p:'weight_profitability',o:pw,n:nv,r:'Score not discriminating, reduce profitability'});}}
    if(a5<dirTgt-10){const sb=getConfigValue(db3,'strong_buy_threshold',-1);if(sb>=0)adjs.push({p:'strong_buy_threshold',o:sb,n:Math.round((sb+2)*100)/100,r:'5d acc '+a5+'% < target'});}
    else if(a5>dirTgt+15){const bt=getConfigValue(db3,'buy_threshold',-1);if(bt>=0){const nv=Math.max(Math.round((bt-1)*100)/100,30);if(nv!==bt)adjs.push({p:'buy_threshold',o:bt,n:nv,r:'5d acc '+a5+'% > target, lower threshold'});}}
  }
  for(const a of adjs){try{db3.run("UPDATE calculation_weights SET current_value="+a.n+",updated_at=datetime('now'),updated_by='feedback-loop-v2' WHERE parameter_name='"+a.p+"'");}catch{}try{db3.run("INSERT INTO weight_adjustment_logs (parameter_name,old_value,new_value,reason,applied_at) VALUES ('"+a.p+"',"+a.o+","+a.n+",'"+a.r.replace(/'/g,"''")+"',datetime('now'))");}catch{}}
  db3.close();
  console.log('[FL]   Adjustments: '+(adjs.length===0?'none':adjs.length+' applied'));

  // STEP 4: Save summary
  console.log('[FL] Step 4: Summary...');
  const db4 = new SQL.Database(fs.readFileSync(dbPath));
  try{db4.run("INSERT INTO feedback_accuracy_summary (evaluated_at,model_version,time_horizon,total_predictions,direction_correct,direction_accuracy,avg_price_error,avg_composite_score_correct,created_at) VALUES (datetime('now'),'2.0.0','5d',"+s5.t+","+s5.c+","+a5+",0,"+(s5.sc||0)+",datetime('now'))");db4.run("INSERT INTO feedback_accuracy_summary (evaluated_at,model_version,time_horizon,total_predictions,direction_correct,direction_accuracy,avg_price_error,avg_composite_score_correct,created_at) VALUES (datetime('now'),'2.0.0','10d',"+s10.t+","+s10.c+","+a10+",0,"+(s10.sc||0)+",datetime('now'))");db4.run("INSERT INTO feedback_accuracy_summary (evaluated_at,model_version,time_horizon,total_predictions,direction_correct,direction_accuracy,avg_price_error,avg_composite_score_correct,created_at) VALUES (datetime('now'),'2.0.0','20d',"+s20.t+","+s20.c+","+a20+",0,"+(s20.sc||0)+",datetime('now'))");console.log('[FL]   Saved');}catch(e){console.log('[FL]   Warning:',String(e).slice(0,60));}
  db4.close();

  console.log('\n[FL] ========================================');
  console.log('[FL]   COMPLETE | Accuracy: '+oA+'% | Validated: '+vc+' | Adj: '+adjs.length+' | '+(Date.now()-t0)+'ms');
  for(const a of adjs) console.log('[FL]     '+a.p+': '+a.o+' -> '+a.n+' ('+a.r+')');
  console.log('[FL] ========================================');
}
main().catch(e=>{console.error('[FL] Fatal:',e);process.exit(1);});
