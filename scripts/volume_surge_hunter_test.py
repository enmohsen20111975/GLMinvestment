#!/usr/bin/env python3
"""Volume Surge Hunter — اختبار متكامل على كامل الفترة.
يحاكي الـ generator مع إضافة surge_rocket detection.
لو النتائج تحسنت، الـ logic يدخل النظام."""
import sqlite3, sys, os, math
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

# Resolve project root dynamically (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))
os.chdir(str(_PROJECT_ROOT))

DB_PRICES = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
DB_PREDS = str(_PROJECT_ROOT / 'db' / 'predictions.db')

# ─── Helper functions ───
def sma(values, period):
    if len(values) < period: return 0
    return sum(values[-period:]) / period

def ema(values, period):
    if len(values) < period: return 0
    k = 2 / (period + 1)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = v * k + e * (1 - k)
    return e

def roc(values, period):
    if len(values) < period + 1: return 0
    if values[-period-1] == 0: return 0
    return (values[-1] - values[-period-1]) / values[-period-1] * 100

def atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return 0
    trs = []
    for i in range(-period, 0):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return sum(trs) / period

def detect_volume_surge_rocket(closes, highs, lows, opens, volumes):
    """Volume Surge Hunter — مستوحى من Pine Script V56."""
    if len(closes) < 25 or len(volumes) < 25:
        return {'is_surge_rocket': False, 'score': 0, 'reason': 'بيانات غير كافية'}
    
    ema20 = ema(closes, 20)
    sma50 = sma(closes, 50)
    atr_val = atr(highs, lows, closes, 14)
    roc20 = roc(closes, 20)
    roc5 = roc(closes, 5)
    
    # Volume surge (V56: vol > ma + 1.5*std)
    if len(volumes) < 21:
        return {'is_surge_rocket': False, 'score': 0, 'reason': 'حجم غير كافي'}
    vol_ma = sum(volumes[-21:-1]) / 20
    vol_std = (sum((v - vol_ma)**2 for v in volumes[-21:-1]) / 20) ** 0.5
    dyn_surge = vol_ma + (vol_std * 1.5)
    vs = volumes[-1] > dyn_surge
    vs_ratio = volumes[-1] / (vol_ma or 1)
    
    # Buy/sell volume
    denom = highs[-1] - lows[-1] if highs[-1] - lows[-1] != 0 else 0.001
    buy_vol = volumes[-1] * ((closes[-1] - lows[-1]) / denom)
    sell_vol = volumes[-1] - buy_vol
    delta_vol = buy_vol - sell_vol
    imbalance_bull = buy_vol > sell_vol * 3 and closes[-1] > opens[-1]
    maker_bull = (vs and delta_vol > 0) or imbalance_bull
    
    above_sma50 = closes[-1] > sma50 if sma50 > 0 else False
    extension_atr = (closes[-1] - ema20) / atr_val if atr_val > 0 else 0
    deeply_extended = extension_atr > 2.2
    
    score = 0
    reasons = []
    if vs:
        score += 25; reasons.append(f'Vol surge {vs_ratio:.1f}x')
    elif vs_ratio >= 1.3:
        score += 12; reasons.append(f'Vol semi-surge {vs_ratio:.1f}x')
    if roc20 > 15:
        score += 20; reasons.append(f'ROC20=+{roc20:.1f}%')
    elif roc20 > 10:
        score += 12; reasons.append(f'ROC20=+{roc20:.1f}%')
    elif roc20 > 5:
        score += 5; reasons.append(f'ROC20=+{roc20:.1f}%')
    if above_sma50:
        score += 15; reasons.append('فوق SMA50')
    if maker_bull:
        score += 20; reasons.append('ميكرز بيشتري')
    elif delta_vol > 0:
        score += 8; reasons.append('delta +')
    if not deeply_extended:
        score += 10; reasons.append(f'ext={extension_atr:+.2f}')
    if roc5 > 3:
        score += 10; reasons.append(f'ROC5=+{roc5:.1f}%')
    
    is_rocket = score >= 60 and vs and roc20 > 5
    
    return {
        'is_surge_rocket': is_rocket, 'score': min(score, 100),
        'reason': ' | '.join(reasons),
        'entry': closes[-1], 'atr': atr_val,
        'target': closes[-1] + (atr_val * 3.0),  # 3R target
        'stop': closes[-1] - (atr_val * 1.5),  # 1.5R stop → R:R = 2.0
    }

def simulate_trade_simple(entry, target, stop, future_closes, future_dates, max_hold=30):
    """محاكاة بسيطة للصفقة."""
    for i, price in enumerate(future_closes):
        if i >= max_hold:
            ret = (price - entry) / entry * 100
            return ret, 'expired', future_dates[i-1] if i > 0 else future_dates[0]
        if price >= target:
            ret = (target - entry) / entry * 100
            return ret, 'target_hit', future_dates[i]
        if price <= stop:
            ret = (stop - entry) / entry * 100
            return ret, 'stop_loss', future_dates[i]
    ret = (future_closes[-1] - entry) / entry * 100
    return ret, 'expired', future_dates[-1]

def get_scan_dates(start, end, interval):
    dates = []
    current = datetime.strptime(start, '%Y-%m-%d')
    end_dt = datetime.strptime(end, '%Y-%m-%d')
    while current <= end_dt:
        dates.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=interval)
    return dates

# ─── Main backtest ───
def main():
    # Get all tickers
    c = sqlite3.connect(DB_PRICES)
    all_tickers = [r[0] for r in c.execute('SELECT DISTINCT symbol FROM egksco_price_history ORDER BY symbol').fetchall()]
    
    # Load toxic blocklist
    blocklist = set()
    bl_path = str(_PROJECT_ROOT / 'vps-service' / 'config' / 'toxic_ticker_blocklist.json')
    if os.path.exists(bl_path):
        import json
        with open(bl_path) as f:
            blocklist = set(json.load(f).get('toxic_tickers', []))
    print(f'🚫 Blocklist: {len(blocklist)} tickers excluded')
    
    # Load price data for all tickers
    print(f'📊 Loading prices for {len(all_tickers)} tickers...')
    ticker_data = {}
    for t in all_tickers:
        if t in blocklist:
            continue
        rows = c.execute('''
            SELECT price_date, open_price, high_price, low_price, close_price, volume
            FROM egksco_price_history WHERE symbol=? ORDER BY price_date ASC
        ''', (t,)).fetchall()
        if len(rows) < 60:
            continue
        ticker_data[t] = {
            'dates': [r[0] for r in rows],
            'opens': [float(r[1] or 0) for r in rows],
            'highs': [float(r[2] or 0) for r in rows],
            'lows': [float(r[3] or 0) for r in rows],
            'closes': [float(r[4] or 0) for r in rows],
            'volumes': [float(r[5] or 0) for r in rows],
        }
    c.close()
    print(f'✅ Loaded {len(ticker_data)} tickers')
    
    scan_dates = get_scan_dates('2025-12-01', '2026-08-27', 3)
    print(f'📅 Scan dates: {len(scan_dates)}')
    
    # Run Volume Surge Hunter on every (ticker, scan_date)
    predictions = []
    surge_hits = 0
    for scan_date in scan_dates:
        daily_picks = []
        for ticker, data in ticker_data.items():
            # Find idx for scan_date
            idx = None
            for i, d in enumerate(data['dates']):
                if d == scan_date:
                    idx = i
                    break
            if idx is None or idx < 25:
                continue
            # Need 5 future days for simulation
            if idx + 5 >= len(data['closes']):
                continue
            
            sl_closes = data['closes'][:idx+1]
            sl_highs = data['highs'][:idx+1]
            sl_lows = data['lows'][:idx+1]
            sl_opens = data['opens'][:idx+1]
            sl_vols = data['volumes'][:idx+1]
            
            result = detect_volume_surge_rocket(sl_closes, sl_highs, sl_lows, sl_opens, sl_vols)
            if result['is_surge_rocket']:
                surge_hits += 1
                # Simulate trade
                future_closes = data['closes'][idx+1:idx+31]
                future_dates = data['dates'][idx+1:idx+31]
                if len(future_closes) < 5:
                    continue
                ret, exit_type, exit_date = simulate_trade_simple(
                    result['entry'], result['target'], result['stop'],
                    future_closes, future_dates
                )
                daily_picks.append({
                    'ticker': ticker, 'scan_date': scan_date,
                    'entry': result['entry'], 'target': result['target'],
                    'stop': result['stop'], 'return': ret, 'exit_type': exit_type,
                    'exit_date': exit_date, 'score': result['score'],
                    'reason': result['reason']
                })
        
        # Sort by score, take top 5
        daily_picks.sort(key=lambda x: -x['score'])
        for p in daily_picks[:5]:
            predictions.append(p)
    
    # Compute stats
    total = len(predictions)
    if total == 0:
        print('❌ صفر توقعات!')
        return
    
    wins = sum(1 for p in predictions if p['return'] > 0)
    losses = sum(1 for p in predictions if p['return'] < 0)
    gp = sum(p['return'] for p in predictions if p['return'] > 0)
    gl = abs(sum(p['return'] for p in predictions if p['return'] < 0))
    net = sum(p['return'] for p in predictions)
    wr = wins/total*100
    pf = gp/gl if gl > 0 else 0
    
    print('\n' + '=' * 70)
    print('  VOLUME SURGE HUNTER — BACKTEST RESULTS')
    print('=' * 70)
    print(f'  Total surge hits: {surge_hits}')
    print(f'  Final predictions (top 5/day): {total}')
    print(f'  Wins: {wins} | Losses: {losses}')
    print(f'  Win Rate: {wr:.1f}%')
    print(f'  Profit Factor: {pf:.2f}')
    print(f'  Net Return: {net:+.2f}%')
    print(f'  Avg Win: +{gp/wins:.2f}%' if wins else '')
    print(f'  Avg Loss: -{gl/losses:.2f}%' if losses else '')
    print(f'  Expectancy: {net/total:+.2f}%/trade')
    
    # Check if explosive stocks caught
    explosive = ['BIOC','NIPH','AMES','GPIM','CRST','AFMC','GTWL']
    caught = [p for p in predictions if p['ticker'] in explosive]
    print(f'\n=== الأسهم الانفجارية المُصطادة ===')
    print(f'  Caught: {len(caught)} predictions')
    for p in caught:
        print(f'    {p["ticker"]} @ {p["scan_date"]}: ret={p["return"]:+.1f}% ({p["exit_type"]})')
    
    print('=' * 70)
    print(f'\n  BASELINE (V40.2 + blocklist): 41T, WR=56.1%, PF=2.94, Net=+227%')
    print(f'  SURGE HUNTER:                 {total}T, WR={wr:.1f}%, PF={pf:.2f}, Net={net:+.1f}%')
    
    # Save predictions to DB (optional)
    if '--save' in sys.argv:
        c2 = sqlite3.connect(DB_PREDS)
        # Don't delete existing - add as new persona
        for p in predictions:
            c2.execute('''
                INSERT INTO predictions (ticker, signal, prediction_date, entry_price, target_price,
                    stop_loss, actual_return, status, outcome_date, exit_type, persona, morning_bell,
                    master_score, evidence_count, risk_reward, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, 'surge_hunter', 0, ?, 5, 2.0, ?)
            ''', (p['ticker'], 'SURGE_BUY', p['scan_date'], p['entry'], p['target'], p['stop'],
                  p['return'], p['exit_date'], p['exit_type'], p['score'], datetime.now().isoformat()))
        c2.commit()
        c2.close()
        print(f'\n💾 Saved {len(predictions)} surge_hunter predictions to DB (persona=surge_hunter)')

if __name__ == '__main__':
    # DEV-07 (2026-10-12 — FULL INPUT GUARD): non-canonical writer disabled.
    # Rule 35: V40.2 (vps-service/jobs/daily_predictor.py) is the ONLY writer
    # to predictions.db. This script INSERTs surge_hunter predictions directly
    # — bypassing safe_insert_prediction() / record_prediction() guards —
    # so it must remain disabled until redirected to the canonical path.
    # To re-enable: replace the raw INSERT in main() with safe_insert_prediction()
    # calls. Do NOT delete (Rule 16 VERIFY-BEFORE-DELETE).
    print(
        '[DEV-07] GUARD: volume_surge_hunter_test.py disabled (Rule 35 — V40.2 is '
        'the only writer to predictions.db). To re-enable, redirect the INSERT '
        'to vps-service/core/safe_insert_prediction.py.',
        flush=True,
    )
    sys.exit(0)
    main()
