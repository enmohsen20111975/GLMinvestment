#!/usr/bin/env python3
"""
Explosive Uncap — Backtest مبسط على بيانات حية
=================================================
بدلاً من تشغيل v40_2 كامل (الذي يرفض معظم الإشارات في البيانات القديمة)،
هذا الـ script بـ يـ focus على explosive_uncap module بس:

1. حمّل 50 سهم EGX OHLCV من Yahoo Finance (Feb-Aug 2026 = 6 شهور)
2. لكل سهم × كل يوم: شغّل detect_explosive_uncap
3. لو is_explosive=True: سجّل trade
   - entry = close
   - stop = entry × (1 - 8.5%)
   - target = entry + 5×ATR
   - target_2 = entry + 8×ATR
4. Simulate outcome: في الـ 20 يوم التالية، هل وصل target أو stop؟
5. احسب WR, PF, Return, R/R

المقارنة:
  - BASELINE: stop=3% (default strict), target=2×ATR
  - EXPLOSIVE: stop=8.5%, target=5×ATR (uncap)

Usage:
  python3 scripts/explosive_uncap_backtest.py              # 50 tickers from Yahoo
  python3 scripts/explosive_uncap_backtest.py --quick       # 20 tickers
  python3 scripts/explosive_uncap_backtest.py --max-tickers 100
"""
import sys
import os
import json
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Tuple
import urllib.request
import urllib.error

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

from analyzers.explosive_uncap_engine import detect_explosive_uncap
from analyzers.production_data_client import ProductionDataClient

RESULTS_DIR = PROJECT_ROOT / 'data' / 'explosive_uncap_results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Backtest config
START_DATE = '2026-02-01'
END_DATE = '2026-08-31'  # Yahoo has data up to today
HOLDING_DAYS = 20  # max holding period for simulation
YAHOO_EGX_SUFFIX = '.CA'

# EGX tickers to test (top liquid + known explosive)
TEST_TICKERS = [
    'COMI', 'HRHO', 'MFPC', 'ABUK', 'CAED', 'GIHD', 'GTWL', 'MICH', 'NIPH',
    'SWDY', 'EFIH', 'EAST', 'AALR', 'ACAP', 'AFMI', 'ALCN', 'ARAB', 'BCDC',
    'BIDI', 'COMI', 'EFIC', 'EGTS', 'EKRI', 'ELKA', 'ESRS', 'ETEL', 'FAIT',
    'FIHC', 'FORTA', 'FWRY', 'GBCG', 'GFIG', 'GLBL', 'GOCO', 'GTEX', 'HDUP',
    'HEBA', 'HFGC', 'HREC', 'ICGH', 'IEEC', 'ISMA', 'ITMI', 'KCBC', 'KORD',
    'LUXE', 'MADE', 'MDPA', 'MEPA', 'MFPC', 'MOIG', 'NATG', 'NEXA', 'NIPH',
    'NDFC', 'ORWE', 'OCDI', 'OCDP', 'OCS', 'OETH', 'PHDC', 'PRCL', 'PRDC',
    'PRMG', 'QOTA', 'RABE', 'RDI', 'RMW', 'SKPC', 'SWDY', 'TALA', 'TMGH',
    'UEBA', 'UEFA', 'UPFD', 'UTID', 'UQCA', 'WATP', 'ZMID',
]


def fetch_yahoo_ohlcv(ticker: str, days: int = 210) -> Dict:
    """Fetch OHLCV from Yahoo Finance for an EGX ticker."""
    yahoo_ticker = f"{ticker}{YAHOO_EGX_SUFFIX}"
    period2 = int(datetime.now().timestamp())
    period1 = int((datetime.now() - timedelta(days=days + 30)).timestamp())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_ticker}"
           f"?interval=1d&period1={period1}&period2={period2}")

    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        result = data.get('chart', {}).get('result', [])
        if not result:
            return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': []}

        r = result[0]
        timestamps = r.get('timestamp', [])
        quotes = r.get('indicators', {}).get('quote', [{}])[0]

        dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
        for i, ts in enumerate(timestamps):
            d = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            o = quotes.get('open', [None] * len(timestamps))[i]
            h = quotes.get('high', [None] * len(timestamps))[i]
            l = quotes.get('low', [None] * len(timestamps))[i]
            c = quotes.get('close', [None] * len(timestamps))[i]
            v = quotes.get('volume', [None] * len(timestamps))[i]
            if c is not None and c > 0:
                dates.append(d)
                opens.append(float(o or c))
                highs.append(float(h or c))
                lows.append(float(l or c))
                closes.append(float(c))
                volumes.append(float(v or 0))

        return {'dates': dates, 'opens': opens, 'highs': highs,
                'lows': lows, 'closes': closes, 'volumes': volumes}
    except Exception as e:
        return {'dates': [], 'opens': [], 'highs': [], 'lows': [], 'closes': [], 'volumes': [],
                'error': str(e)}


def simulate_trade(entry: float, stop: float, target: float,
                   future_highs: List[float], future_lows: List[float],
                   future_closes: List[float], max_days: int = HOLDING_DAYS) -> Dict:
    """Simulate trade outcome — did it hit target or stop first?"""
    if not future_highs or not future_lows:
        return {'outcome': 'no_data', 'return_pct': 0, 'days_held': 0}

    n = min(len(future_highs), len(future_lows), len(future_closes), max_days)

    for i in range(n):
        # Check stop first (conservative — if both hit on same day, stop wins)
        if future_lows[i] <= stop:
            return {'outcome': 'stop', 'return_pct': ((stop - entry) / entry) * 100,
                    'days_held': i + 1, 'exit_price': stop}
        # Check target
        if future_highs[i] >= target:
            return {'outcome': 'target', 'return_pct': ((target - entry) / entry) * 100,
                    'days_held': i + 1, 'exit_price': target}

    # No hit — exit at last close (timeout)
    last_close = future_closes[n - 1] if n > 0 else entry
    return {'outcome': 'timeout', 'return_pct': ((last_close - entry) / entry) * 100,
            'days_held': n, 'exit_price': last_close}


def run_backtest_mode(label: str, use_explosive: bool, tickers: List[str]) -> Dict:
    """Run backtest in one mode (baseline or explosive)."""
    print(f"\n{'='*70}")
    print(f"🧪 MODE: {label} (explosive_uncap={'ON' if use_explosive else 'OFF'})")
    print(f"   Tickers: {len(tickers)} | Period: {START_DATE} → {END_DATE}")
    print(f"{'='*70}", flush=True)

    trades = []
    tickers_ok = 0
    start_time = time.time()

    for idx, ticker in enumerate(tickers):
        if (idx + 1) % 10 == 0:
            print(f"  ⏳ {idx+1}/{len(tickers)} tickers... ({len(trades)} trades so far)", flush=True)

        data = fetch_yahoo_ohlcv(ticker, days=210)
        if not data['closes'] or len(data['closes']) < 50:
            continue
        tickers_ok += 1

        dates = data['dates']
        opens, highs, lows, closes, volumes = (data['opens'], data['highs'],
                                                data['lows'], data['closes'], data['volumes'])

        # Scan dates in the backtest window
        for i in range(50, len(closes) - HOLDING_DAYS - 1):
            if dates[i] < START_DATE or dates[i] > END_DATE:
                continue

            # Slice up to day i
            sl_closes = closes[:i + 1]
            sl_highs = highs[:i + 1]
            sl_lows = lows[:i + 1]
            sl_vols = volumes[:i + 1]

            # Detect explosive
            exp = detect_explosive_uncap(sl_closes, sl_highs, sl_lows, sl_vols, entry_price=closes[i])

            if use_explosive:
                # EXPLOSIVE mode: only trade if is_explosive=True
                if not exp['is_explosive']:
                    continue
                entry = closes[i]
                stop = exp['stop_loss']          # 8.5% below entry
                target = exp['target_price']      # entry + 5×ATR
            else:
                # BASELINE mode: trade if is_momentum=True (same trigger, but default stop/target)
                if not exp['is_momentum']:
                    continue
                # Baseline: strict stop (3%) + target (2×ATR) — like V40.2 default
                entry = closes[i]
                atr = exp['atr'] if exp['atr'] > 0 else entry * 0.05
                stop = round(entry * (1 - 0.03), 4)           # 3% stop
                target = round(entry + atr * 2.0, 4)          # 2×ATR target

            # Simulate trade
            future_highs = highs[i + 1: i + 1 + HOLDING_DAYS]
            future_lows = lows[i + 1: i + 1 + HOLDING_DAYS]
            future_closes = closes[i + 1: i + 1 + HOLDING_DAYS]

            outcome = simulate_trade(entry, stop, target, future_highs, future_lows, future_closes)

            trades.append({
                'ticker': ticker,
                'date': dates[i],
                'entry': round(entry, 2),
                'stop': round(stop, 2),
                'target': round(target, 2),
                'outcome': outcome['outcome'],
                'return_pct': round(outcome['return_pct'], 2),
                'days_held': outcome['days_held'],
                'exit_price': round(outcome.get('exit_price', 0), 2),
                'is_explosive': exp['is_explosive'],
                'momentum_5d': exp['momentum_5d'],
                'vol_pct': exp['vol_pct'],
                'rr_ratio': exp['rr_ratio'],
            })

    elapsed = time.time() - start_time

    # Compute metrics
    if not trades:
        return {'label': label, 'trades': 0, 'elapsed': round(elapsed, 1),
                'tickers_ok': tickers_ok}

    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] <= 0]
    win_rate = (len(wins) / len(trades) * 100) if trades else 0
    gross_profit = sum(t['return_pct'] for t in wins)
    gross_loss = abs(sum(t['return_pct'] for t in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (
        999.0 if gross_profit > 0 else 0)
    total_return = sum(t['return_pct'] for t in trades)
    avg_return = total_return / len(trades) if trades else 0

    # Best/worst trades
    best = max(trades, key=lambda x: x['return_pct']) if trades else None
    worst = min(trades, key=lambda x: x['return_pct']) if trades else None

    # Captured tickers (winners)
    captured = list(set(t['ticker'] for t in wins))[:15]

    return {
        'label': label,
        'trades': len(trades),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(win_rate, 1),
        'profit_factor': round(profit_factor, 2) if profit_factor < 999 else 999.0,
        'total_return': round(total_return, 2),
        'avg_return': round(avg_return, 2),
        'tickers_ok': tickers_ok,
        'elapsed': round(elapsed, 1),
        'best_trade': {'ticker': best['ticker'], 'return': best['return_pct']} if best else None,
        'worst_trade': {'ticker': worst['ticker'], 'return': worst['return_pct']} if worst else None,
        'captured_tickers': captured,
        'trades_detail': trades[:30],  # first 30 for audit
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Explosive Uncap Backtest (Yahoo live data)')
    parser.add_argument('--quick', action='store_true', help='Quick mode (20 tickers)')
    parser.add_argument('--max-tickers', type=int, default=50, help='Max tickers (default 50)')
    args = parser.parse_args()

    max_tickers = 20 if args.quick else args.max_tickers
    tickers = TEST_TICKERS[:max_tickers]
    # Deduplicate while preserving order
    seen = set()
    tickers = [t for t in tickers if not (t in seen or seen.add(t))]

    print(f"🚀 Explosive Uncap Backtest — {len(tickers)} tickers × Yahoo live data")
    print(f"   Period: {START_DATE} → {END_DATE} | Holding: {HOLDING_DAYS} days max")

    # Run both modes
    baseline = run_backtest_mode('baseline_strict', use_explosive=False, tickers=tickers)
    explosive = run_backtest_mode('explosive_uncap', use_explosive=True, tickers=tickers)

    # Comparison
    print(f"\n{'='*80}")
    print(f"📊 A/B BACKTEST RESULTS — Explosive Uncap vs Baseline (Yahoo live data)")
    print(f"{'='*80}")
    print(f"{'Mode':<22} {'Trades':>7} {'WR%':>7} {'PF':>6} {'Return%':>9} {'AvgR%':>7} {'Time':>6}")
    print("-" * 80)
    for r in [baseline, explosive]:
        if r.get('trades', 0) > 0:
            print(f"{r['label']:<22} {r['trades']:>7} {r['win_rate']:>6.1f}% "
                  f"{r['profit_factor']:>6.2f} {r['total_return']:>+8.1f}% "
                  f"{r['avg_return']:>+6.2f}% {r['elapsed']:>5.0f}s")
        else:
            print(f"{r['label']:<22} {r.get('trades', 0):>7} — no trades (tickers_ok={r.get('tickers_ok', 0)})")
    print("-" * 80)

    # Winner
    valid = [r for r in [baseline, explosive] if r.get('trades', 0) > 0]
    if valid:
        best = max(valid, key=lambda x: x.get('total_return', -999))
        print(f"\n🏆 Best Return: {best['label']} ({best.get('total_return', 0):+.1f}%)")
        best_wr = max(valid, key=lambda x: x.get('win_rate', 0))
        print(f"🏆 Best Win Rate: {best_wr['label']} ({best_wr.get('win_rate', 0):.1f}%)")

        # Captured tickers
        for r in valid:
            if r.get('captured_tickers'):
                print(f"\n🎯 {r['label']} captured winners: {', '.join(r['captured_tickers'][:10])}")

    # Save results
    final = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'period': f'{START_DATE} → {END_DATE}',
        'tickers_tested': len(tickers),
        'baseline': baseline,
        'explosive': explosive,
    }
    (RESULTS_DIR / 'final_results.json').write_text(json.dumps(final, indent=2, default=str))
    print(f"\n💾 Results saved to: {RESULTS_DIR}")


if __name__ == '__main__':
    main()
