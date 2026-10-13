#!/usr/bin/env python3
"""broadcast_institutional_strong_buys.py — بث صفقات STRONG_BUY على التليجرام."""
import argparse, os, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
STRONG_BUY_MIN_CONFIDENCE = 78.0
STRONG_BUY_MIN_RR = 2.0
MARKET_FLAGS = {'EGX':'🇪🇬','TADAWUL':'🇸🇦','KSE':'🇰🇼','QSE':'🇶🇦','US':'🇺🇸','CRYPTO':'🌐','GOLD':'🥇'}
def log(msg, level="INFO"):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level=="OK" else ("⚠️" if level=="WARN" else ("❌" if level=="ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)
def fetch_strong_buys(conn):
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    rows = conn.execute("""SELECT p.ticker, p.entry_price, p.target_price, p.stop_loss,
        p.master_score as confidence, s.name, s.market, s.sector
        FROM predictions p LEFT JOIN stocks s ON p.ticker = s.ticker
        WHERE p.prediction_date LIKE ? AND p.entry_price > 0 AND p.target_price > 0 AND p.stop_loss > 0
        ORDER BY p.master_score DESC""", (f"{today}%",)).fetchall()
    strong_buys = []
    for row in rows:
        d = dict(row)
        entry = float(d['entry_price'] or 0); target = float(d['target_price'] or 0)
        stop = float(d['stop_loss'] or 0); confidence = float(d['confidence'] or 0)
        risk = entry - stop; reward = target - entry
        rr = (reward / risk) if risk > 0 else 0
        if confidence < STRONG_BUY_MIN_CONFIDENCE or rr < STRONG_BUY_MIN_RR: continue
        market = d.get('market') or 'EGX'
        horizon = '⚡ يومية/قصيرة' if rr >= 2.5 else '🎯 أسبوعية/متوسطة'
        strong_buys.append({'ticker':d['ticker'],'name':d.get('name') or d['ticker'],
            'market':market,'flag':MARKET_FLAGS.get(market,'🌍'),'sector':d.get('sector') or '',
            'entry':entry,'target':target,'stop':stop,'rr':round(rr,2),
            'confidence':round(confidence,1),'atr':round(reward/2.5,4) if reward>0 else 0,'horizon':horizon})
    return strong_buys
def build_message(sbs):
    if not sbs: return "📊 *لا توجد صفقات STRONG BUY اليوم.*\n_Rule 27._"
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    L = [f"🎖️ *STRONG BUY — {now_str}*", f"📊 فرص: *{len(sbs)}*", "", "━━━━━━━━━━━━━━━━━━━━", ""]
    for i,sb in enumerate(sbs,1):
        L += [f"*{i}.* {sb['flag']} *{sb['ticker']}* — {sb['name'][:35]}",
              f"   🎯 `{sb['entry']:.2f}` → 🚀 `{sb['target']:.2f}` (+{((sb['target']-sb['entry'])/sb['entry']*100):.1f}%)",
              f"   🛑 `{sb['stop']:.2f}` | ⚖️ R:R=*{sb['rr']:.2f}* | ثقة=*{sb['confidence']:.0f}%*", ""]
    L += ["━━━━━━━━━━━━━━━━━━━━", "🔒 Rule 27 — لا اختلاع."]
    return '\n'.join(L)
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--send", action="store_true")
    a = p.parse_args()
    log("🎖️ STRONG BUY Broadcast")
    conn = sqlite3.connect(str(STOCKS_DB)); conn.row_factory = sqlite3.Row
    sbs = fetch_strong_buys(conn); conn.close()
    log(f"صفقات: {len(sbs)}")
    for sb in sbs: log(f"  {sb['flag']} {sb['ticker']:8} RR={sb['rr']:.2f} conf={sb['confidence']:.0f}%")
    msg = build_message(sbs); print("\n" + msg + "\n")
    if a.send:
        import os
        bt = os.environ.get('TELEGRAM_BOT_TOKEN',''); ci = os.environ.get('TELEGRAM_CHAT_ID','')
        if os.environ.get('TELEGRAM_ENABLED','false').lower() in ('true','1') and bt and ci:
            import requests
            r = requests.post(f"https://api.telegram.org/bot{bt}/sendMessage", json={'chat_id':ci,'text':msg,'parse_mode':'Markdown'}, timeout=15)
            log(f"Telegram: HTTP {r.status_code}", "OK" if r.status_code==200 else "ERROR")
        else: log("Telegram disabled", "WARN")
    else: log("DRY-RUN", "WARN")
    return 0
if __name__=="__main__": sys.exit(main())
