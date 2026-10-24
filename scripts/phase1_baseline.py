#!/usr/bin/env python3
"""
phase1_baseline.py — V38 Baseline Metrics (Phase 1)
====================================================
Runs V38BacktestEngine on 100 tickers × 9 months.
Records: signals, win rate, profit factor, rejection reasons.
"""
from __future__ import annotations

import os, sys, json, time, sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

TRAIN_START = '2025-07-01'
TRAIN_END = '2026-03-31'
MAX_TICKERS = 100

def main():
    print(f"\n{'='*70}")
    print(f"  Phase 1: V38 Baseline Metrics")
    print(f"  Period: {TRAIN_START} → {TRAIN_END}")
    print(f"  Tickers: {MAX_TICKERS}")
    print(f"{'='*70}\n")
    
    # Load V38 engine
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    
    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals()
    engine._load_benchmark()
    
    # Get tickers
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date >= '2025-06-01' AND date <= ?
        AND ticker NOT LIKE '%.%'
        ORDER BY ticker LIMIT ?
    """, (TRAIN_END, MAX_TICKERS)).fetchall()]
    conn.close()
    
    print(f"  Loaded {len(tickers)} tickers")
    
    # Pre-cache prices
    pre_cache_price_history(tickers, engine)
    print(f"  Pre-cached prices")
    
    # Run analysis
    all_signals = []
    all_rejections = {'below_sma50': 0, 'low_volume': 0, 'low_momentum': 0, 'low_score': 0, 'other': 0}
    total_days = 0
    
    # Get trading dates
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    dates = [r[0] for r in conn.execute("""
        SELECT DISTINCT date FROM price_history
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
    """, (TRAIN_START, TRAIN_END)).fetchall()]
    conn.close()
    total_days = len(dates)
    print(f"  Trading days: {total_days}")
    
    t0 = time.time()
    processed = 0
    
    for ticker in tickers:
        processed += 1
        if processed % 20 == 0:
            print(f"  Processing {processed}/{len(tickers)}...")
        
        dates_t, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < 50:
            continue
        
        for i in range(50, len(closes)):
            if dates_t[i] < TRAIN_START or dates_t[i] > TRAIN_END:
                continue
            
            try:
                result = engine.analyze_single_day(ticker, dates_t, opens, highs, lows, closes, volumes, i)
                signal = result.get('signal', 'WAIT')
                score = result.get('score', 0)
                
                if signal in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
                    all_signals.append({
                        'date': dates_t[i],
                        'ticker': ticker,
                        'signal': signal,
                        'score': score,
                        'entry': result.get('entry_price', closes[i]),
                        'target': result.get('target_price'),
                        'stop': result.get('stop_loss'),
                    })
                elif signal == 'HOLD':
                    # Track rejection reason
                    vol_ratio = result.get('vol_ratio', 0)
                    if result.get('below_sma50'):
                        all_rejections['below_sma50'] += 1
                    elif vol_ratio and vol_ratio < 2.0:
                        all_rejections['low_volume'] += 1
                    elif result.get('roc5', 0) <= 3.0:
                        all_rejections['low_momentum'] += 1
                    else:
                        all_rejections['other'] += 1
            except Exception as e:
                pass  # skip errors
    
    elapsed = time.time() - t0
    
    # Calculate metrics
    total_signals = len(all_signals)
    signals_per_day = total_signals / total_days if total_days > 0 else 0
    
    # Calculate win rate (simplified: check if price hit target before stop)
    wins = 0
    losses = 0
    for sig in all_signals:
        ticker = sig['ticker']
        entry = sig['entry']
        target = sig.get('target') or entry * 1.10  # default +10%
        stop = sig.get('stop') or entry * 0.93  # default -7%
        date = sig['date']
        
        # Get future prices
        conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=10.0)
        future = conn.execute("""
            SELECT high_price, low_price FROM price_history
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT 30
        """, (ticker, date)).fetchall()
        conn.close()
        
        hit_target = any((h is not None and target is not None and h >= target) for h, l in future)
        hit_stop = any((l is not None and stop is not None and l <= stop) for h, l in future)
        
        # Check which came first: target or stop
        target_idx = None
        stop_idx = None
        for idx, (h, l) in enumerate(future):
            if h is not None and target is not None and h >= target and target_idx is None:
                target_idx = idx
            if l is not None and stop is not None and l <= stop and stop_idx is None:
                stop_idx = idx
            if target_idx is not None and stop_idx is not None:
                break
        
        if target_idx is not None and (stop_idx is None or target_idx < stop_idx):
            wins += 1
        elif stop_idx is not None:
            losses += 1
    
    closed = wins + losses
    win_rate = (wins / closed * 100) if closed > 0 else 0
    
    print(f"\n{'='*70}")
    print(f"  📊 V38 BASELINE RESULTS")
    print(f"{'='*70}")
    print(f"  Total Signals:      {total_signals}")
    print(f"  Signals per Day:    {signals_per_day:.1f}")
    print(f"  Win Rate:           {win_rate:.1f}%")
    print(f"  Closed (win+loss):  {closed}")
    print(f"  Wins:               {wins}")
    print(f"  Losses:             {losses}")
    print(f"  Processing Time:    {elapsed:.1f}s")
    print(f"  Rejection Reasons:")
    for reason, count in all_rejections.items():
        pct = count / max(1, sum(all_rejections.values())) * 100
        print(f"    {reason}: {count} ({pct:.0f}%)")
    
    # Save
    output_dir = PROJECT_ROOT / 'scripts' / 'baseline_data'
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / f'v38_baseline_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    
    baseline = {
        'timestamp': datetime.now().isoformat(),
        'period': f'{TRAIN_START} → {TRAIN_END}',
        'tickers_tested': len(tickers),
        'trading_days': total_days,
        'total_signals': total_signals,
        'signals_per_day': round(signals_per_day, 1),
        'win_rate': round(win_rate, 1),
        'wins': wins,
        'losses': losses,
        'closed': closed,
        'rejection_reasons': all_rejections,
        'processing_time_s': round(elapsed, 1),
        'signals_sample': all_signals[:20],
    }
    
    with open(output_path, 'w') as f:
        json.dump(baseline, f, indent=2, ensure_ascii=False, default=str)
    
    # Save markdown
    doc_path = PROJECT_ROOT / 'Documentation' / 'PHASE1-BASELINE.md'
    with open(doc_path, 'w') as f:
        f.write(f"# Phase 1 — V38 Baseline Metrics\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"| Metric | Value | Unit |\n")
        f.write(f"|--------|-------|------|\n")
        f.write(f"| Total Signals | {total_signals} | count |\n")
        f.write(f"| Signals per Day | {signals_per_day:.1f} | avg |\n")
        f.write(f"| Win Rate | {win_rate:.1f}% | percent |\n")
        f.write(f"| Closed (win+loss) | {closed} | count |\n")
        f.write(f"| Processing Time | {elapsed:.1f}s | seconds |\n\n")
        f.write(f"## Rejection Reasons\n\n")
        f.write(f"| Reason | Count | % |\n")
        f.write(f"|--------|-------|---|\n")
        for reason, count in all_rejections.items():
            pct = count / max(1, sum(all_rejections.values())) * 100
            f.write(f"| {reason} | {count} | {pct:.0f}% |\n")
    
    print(f"\n  💾 JSON: {output_path}")
    print(f"  📄 Report: {doc_path}")
    
    # Go/No-Go
    if total_signals >= 10:
        print(f"\n  ✅ GO — V38 produced {total_signals} signals (need 10+)")
    else:
        print(f"\n  ⚠️  CAUTION — V38 produced {total_signals} signals (need 10+)")
    
    print(f"{'='*70}\n")

if __name__ == '__main__':
    main()
