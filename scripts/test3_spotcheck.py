#!/usr/bin/env python3
"""TEST-3: Spot-check 5 predictions vs live data through data layer."""
import sqlite3
import sys
sys.path.insert(0, "/home/z/my-project")
from data_engine.data_layer import data

print("===== TEST-3: Spot-check 5 predictions vs live data =====\n")

pconn = sqlite3.connect("/home/z/my-project/db/predictions.db")
pconn.row_factory = sqlite3.Row
picks = pconn.execute("""
    SELECT ticker, signal, entry_price, target_price, stop_loss, master_score, confidence
    FROM predictions WHERE prediction_date LIKE '2026-10-29%'
    ORDER BY confidence DESC, master_score ASC LIMIT 5
""").fetchall()

for p in picks:
    t = p['ticker']
    print(f"--- {t} ({p['signal']}, conf={p['confidence']:.0f}%) ---")
    snap = data.get_snapshot(t)
    if snap:
        cp = snap.get('current_price')
        rsi = snap.get('rsi')
        sma20 = snap.get('sma20')
        sma50 = snap.get('sma50')
        atr = snap.get('atr')
        chg = snap.get('change_percent')
        vol = snap.get('volume')
        mc = snap.get('market_cap')
        rsi_s = f"{rsi:.2f}" if rsi else "N/A"
        print(f"  LIVE: price={cp} | rsi={rsi_s} | sma20={sma20} | sma50={sma50} | atr={atr}")
        print(f"  LIVE: change%={chg} | volume={vol} | market_cap={mc}")
    hist = data.get_history(t, days=10)
    print(f"  HISTORY (last 5 days):")
    for h in hist[-5:]:
        print(f"    {h['date']} C={h['close']} V={h['volume']}")
    entry = p['entry_price'] or 0
    target = p['target_price'] or 0
    stop = p['stop_loss'] or 0
    live = snap.get('current_price') if snap else 0
    print(f"  PRED: entry={entry:.2f} target={target:.2f} stop={stop:.2f} score={p['master_score']:.1f}")
    if live and entry:
        delta = abs(live - entry) / live * 100
        ok = "OK" if delta < 0.1 else "MISMATCH"
        print(f"  CHECK: live={live} vs entry={entry} -> {delta:.3f}% diff {ok}")
        sell_ok = (target < entry < stop)
        print(f"  LOGIC: SELL signal -> target({target}) < entry({entry}) < stop({stop}) -> {'valid' if sell_ok else 'INVALID'}")
    print()
pconn.close()
