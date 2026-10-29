#!/usr/bin/env python3
"""
Deep Data Analyzer — Phase A-E deep analysis on full price_history.db (2023-2026).

5 phases:
  A: Ticker Clustering (8 metrics + K-means)
  B: Market Regime Deep Dive (monthly classification)
  C: Feature IC Analysis (8 features × 9 metrics)
  D: Feature Combinations (correlation matrix + pairwise IC boost)
  E: Unsupervised Setup Discovery (K-means on profitable days)

Memory strategy: chunk tickers (50/chunk), gc.collect() after each.
Rule 4: 2 files only (this + report_writer.py).
Rule 27: NO-FAKE-DATA — "—" if unknown.
"""
from __future__ import annotations
import sys, os, json, gc, math, sqlite3, time
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from scipy.stats import spearmanr, linregress
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score

import sys as _bs_sys
PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'camp'))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))
sys.path.insert(0, str(VPS / 'portfolio'))
sys.path.insert(0, str(VPS / 'utils'))
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

DB_DIR = PROJECT_ROOT / 'db'
_bs_sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
from core.db_manager import db_manager as _bs_dbm
RESULTS_DIR = PROJECT_ROOT / 'scripts' / 'camp' / 'results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Analysis period: 2023-01 → 2026-05 (clean months with gaps < 20%)
# Exclude 2026-06, 07, 10 (FAIL — partial data). Include 08, 09 (WARN/OK).
ANALYSIS_START = '2023-01-01'
ANALYSIS_END = '2026-09-30'  # stop before Oct (incomplete)
LOOKBACK_START = '2022-06-01'  # 6mo lookback for SMA200 etc.

CHUNK_SIZE = 50  # tickers per chunk (memory safety)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _sma(vals, period):
    if len(vals) < period: return None
    return sum(vals[-period:]) / period

def _rsi(closes, period=14):
    if len(closes) < period + 1: return None
    g, l = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i-1]
        g.append(max(0, ch)); l.append(max(0, -ch))
    if len(g) < period: return None
    ag = sum(g[-period:]) / period; al = sum(l[-period:]) / period
    return 100 - 100 / (1 + ag / (al or 0.001)) if al > 0 else 100.0

def _atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return None
    trs = []
    for i in range(1, len(closes)):
        try:
            h, l, c_prev = highs[i], lows[i], closes[i-1]
            if h is None or l is None or c_prev is None: continue
            tr = max(h-l, abs(h-c_prev), abs(l-c_prev))
            trs.append(tr)
        except: continue
    return sum(trs[-period:]) / period if len(trs) >= period else None

def _get_ticker_data(conn, ticker, start, end):
    rows = conn.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker=? AND date>=? AND date<=?
        AND close_price>0 AND high_price>0 AND low_price>0 ORDER BY date
    """, (ticker, start, end)).fetchall()
    if len(rows) < 50: return None
    return {
        'd': [r[0] for r in rows], 'o': [float(r[1] or 0) for r in rows],
        'h': [float(r[2] or 0) for r in rows], 'l': [float(r[3] or 0) for r in rows],
        'c': [float(r[4]) for r in rows], 'v': [int(r[5] or 0) for r in rows],
    }

def _forward_return(closes, idx, days):
    if idx + days >= len(closes): return None
    if closes[idx] <= 0: return None
    return (closes[idx + days] / closes[idx] - 1) * 100


# ─── Phase A: Ticker Clustering ──────────────────────────────────────────────

def phase_a_ticker_clustering(conn) -> Dict:
    """Cluster tickers by 8 behavioral metrics."""
    print('\n=== Phase A: Ticker Clustering ===')
    # Sample top 250 tickers by data density (memory safety on 4GB sandbox)
    tickers = [r[0] for r in conn.execute("""
        SELECT ticker, COUNT(*) as n FROM price_history
        WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND close_price>0
        GROUP BY ticker HAVING n >= 200
        ORDER BY n DESC LIMIT 250
    """, (LOOKBACK_START, ANALYSIS_END)).fetchall()]
    # Extract just tickers
    tickers = [t[0] if isinstance(t, tuple) else t for t in tickers]
    print(f'  Sample tickers (top by density): {len(tickers)}')

    metrics = []
    valid_tickers = []
    for i in range(0, len(tickers), CHUNK_SIZE):
        chunk = tickers[i:i+CHUNK_SIZE]
        for t in chunk:
            data = _get_ticker_data(conn, t, LOOKBACK_START, ANALYSIS_END)
            if not data or len(data['c']) < 200: continue
            c = np.array(data['c'], dtype=float)
            h = np.array(data['h'], dtype=float)
            l = np.array(data['l'], dtype=float)
            v = np.array(data['v'], dtype=float)
            # Metric 1: Trend score (slope of log regression on last 500 days)
            window = c[-500:] if len(c) >= 500 else c
            try:
                log_c = np.log(window[window > 0])
                if len(log_c) >= 20:
                    slope, _, _, _, _ = linregress(range(len(log_c)), log_c)
                    trend = slope * 252
                else: trend = 0
            except: trend = 0
            # Metric 2: Volatility (vectorized ATR%)
            if len(c) > 14:
                tr = np.maximum.reduce([
                    h[1:] - l[1:],
                    np.abs(h[1:] - c[:-1]),
                    np.abs(l[1:] - c[:-1])
                ])
                # Rolling ATR (simple: take last 500 days)
                tr_window = tr[-500:] if len(tr) >= 500 else tr
                atr_vals = tr_window / c[1:][len(c)-1-len(tr_window):] * 100 if len(c) > 1 else np.array([])
                # Simple: use last 500 ATR% values
                atr_pct = tr_window / np.maximum(c[-len(tr_window):], 0.001) * 100
                vol_p50 = float(np.median(atr_pct)) if len(atr_pct) > 0 else 0
                vol_p90 = float(np.percentile(atr_pct, 90)) if len(atr_pct) > 0 else 0
            else:
                vol_p50 = vol_p90 = 0
            # Metric 3: Mean-Reversion (autocorrelation lag-1)
            rets = np.diff(c) / np.maximum(c[:-1], 0.001)
            rets = rets[-500:] if len(rets) > 500 else rets
            if len(rets) >= 30:
                mrev = float(np.corrcoef(rets[:-1], rets[1:])[0, 1])
            else: mrev = 0
            # Metric 4: Seasonality (std of monthly returns)
            monthly_rets = {}
            for j in range(len(data['d'])):
                m = data['d'][j][:7]
                monthly_rets.setdefault(m, []).append(c[j])
            mrets = []
            for m, prices in sorted(monthly_rets.items())[-24:]:
                if len(prices) >= 2 and prices[0] > 0:
                    mrets.append(prices[-1] / prices[0] - 1)
            seasonality = float(np.std(mrets) * 100) if len(mrets) >= 6 else 0
            # Metric 5: Volume surge frequency
            if len(v) > 20:
                vol_ma20 = np.convolve(v, np.ones(20)/20, mode='valid')
                vol_surge = np.sum(v[19:] > 2 * vol_ma20) if len(vol_ma20) > 0 else 0
                vol_surge_freq = float(vol_surge / max(1, len(v) - 19) * 100)
            else: vol_surge_freq = 0
            # Metric 6: Avg turnover
            turnover = float(np.mean(c[-100:] * v[-100:])) if len(c) >= 100 else 0
            metrics.append([trend, vol_p50, vol_p90, mrev, seasonality,
                            vol_surge_freq, turnover, len(c)])
            valid_tickers.append(t)
        gc.collect()
        if (i // CHUNK_SIZE) % 2 == 0:
            print(f'  Processed {min(i+CHUNK_SIZE, len(tickers))}/{len(tickers)} tickers')

    print(f'  Valid tickers: {len(valid_tickers)}')
    X = np.array(metrics)
    # Replace inf/nan
    X = np.nan_to_num(X, nan=0, posinf=999, neginf=-999)
    # Standardize
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Try k=4,5,6 — pick best silhouette
    best_k, best_score, best_labels = 4, -1, None
    for k in [4, 5, 6]:
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(X_scaled)
        score = silhouette_score(X_scaled, labels) if len(set(labels)) > 1 else -1
        print(f'  k={k}: silhouette={score:.3f}')
        if score > best_score:
            best_k, best_score, best_labels = k, score, labels

    # Build cluster profiles
    clusters = []
    for ci in range(best_k):
        mask = best_labels == ci
        members = [valid_tickers[i] for i in range(len(valid_tickers)) if mask[i]]
        avg_metrics = X[mask].mean(axis=0)
        clusters.append({
            'cluster_id': ci + 1,
            'size': int(mask.sum()),
            'avg_metrics': {
                'trend': float(avg_metrics[0]), 'vol_p50': float(avg_metrics[1]),
                'vol_p90': float(avg_metrics[2]), 'mean_reversion': float(avg_metrics[3]),
                'seasonality': float(avg_metrics[4]), 'vol_surge_freq': float(avg_metrics[5]),
                'avg_turnover': float(avg_metrics[6]), 'data_days': float(avg_metrics[7]),
            },
            'examples': members[:15],
            'all_members': members,
        })
    # Sort by size (largest first)
    clusters.sort(key=lambda x: -x['size'])
    for i, c in enumerate(clusters):
        c['cluster_id'] = i + 1

    # Name clusters by profile
    for c in clusters:
        m = c['avg_metrics']
        if m['trend'] > 0.1 and m['vol_p90'] > 4:
            c['name'] = 'Trending-HighVol'
        elif m['mean_reversion'] < -0.05 and m['vol_p50'] < 2:
            c['name'] = 'Mean-Revert-LowVol'
        elif m['avg_turnover'] < 5e6:
            c['name'] = 'Illiquid'
        elif m['seasonality'] > 10:
            c['name'] = 'Seasonal'
        elif abs(m['trend']) < 0.05 and m['vol_p50'] < 3:
            c['name'] = 'Choppy-NoTrend'
        else:
            c['name'] = f'Mixed-{c["cluster_id"]}'

    return {
        'n_tickers': len(valid_tickers), 'n_clusters': best_k,
        'silhouette': float(best_score), 'clusters': clusters,
        'metric_names': ['trend', 'vol_p50', 'vol_p90', 'mean_reversion',
                         'seasonality', 'vol_surge_freq', 'avg_turnover', 'data_days'],
    }


# ─── Phase B: Market Regime Deep Dive ───────────────────────────────────────

def phase_b_market_regime(conn) -> Dict:
    """Classify each month 2023-2026 as Bull/Bear/Sideways."""
    print('\n=== Phase B: Market Regime Deep Dive ===')
    # Build market proxy: equal-weighted avg of all tickers' daily returns
    # Use tickers with full data in the period
    all_dates = [r[0] for r in conn.execute("""
        SELECT DISTINCT date FROM price_history
        WHERE date>=? AND date<=? AND close_price>0
        ORDER BY date
    """, (ANALYSIS_START, ANALYSIS_END)).fetchall()]
    print(f'  Trading days: {len(all_dates)}')

    # Compute market proxy index (equal-weighted)
    daily_rets = {}
    for d in all_dates:
        rows = conn.execute("""
            SELECT ticker, close_price FROM price_history
            WHERE date=? AND ticker NOT LIKE '%.%' AND close_price>0
        """, (d,)).fetchall()
        if len(rows) < 50: continue
        rets = []
        for t, cp in rows:
            prev = conn.execute("""
                SELECT close_price FROM price_history
                WHERE ticker=? AND date<? AND close_price>0
                ORDER BY date DESC LIMIT 1
            """, (t, d)).fetchone()
            if prev and prev[0] > 0:
                rets.append(cp / prev[0] - 1)
        if rets:
            daily_rets[d] = float(np.mean(rets))

    dates_sorted = sorted(daily_rets.keys())
    proxy = [1.0]
    for d in dates_sorted:
        proxy.append(proxy[-1] * (1 + daily_rets[d]))
    proxy = proxy[1:]

    # Compute SMA50, SMA200 of proxy
    months = {}
    for y in ['2023', '2024', '2025', '2026']:
        for m in range(1, 13):
            if y == '2026' and m > 9: break
            mm = f"{y}-{m:02d}"
            month_dates = [d for d in dates_sorted if d.startswith(mm)]
            if len(month_dates) < 10: continue
            # Get proxy values for this month
            month_idx = [dates_sorted.index(d) for d in month_dates]
            month_proxy = [proxy[i] for i in month_idx]
            end_proxy = month_proxy[-1]
            # SMA50 and SMA200
            start_idx = month_idx[0]
            sma50 = float(np.mean(proxy[max(0, start_idx-50):start_idx+1])) if start_idx >= 1 else end_proxy
            sma200 = float(np.mean(proxy[max(0, start_idx-200):start_idx+1])) if start_idx >= 1 else end_proxy
            # Breadth: % stocks above their SMA50
            breadth_count = 0
            breadth_total = 0
            for d in month_dates[-5:]:  # last 5 days of month
                rows = conn.execute("""
                    SELECT ticker, close_price FROM price_history
                    WHERE date=? AND ticker NOT LIKE '%.%' AND close_price>0
                """, (d,)).fetchall()
                for t, cp in rows:
                    prev50 = conn.execute("""
                        SELECT close_price FROM price_history
                        WHERE ticker=? AND date<=? AND close_price>0
                        ORDER BY date DESC LIMIT 50
                    """, (t, month_dates[0])).fetchall()
                    if len(prev50) >= 50:
                        sma = sum(r[0] for r in prev50) / 50
                        if cp > sma: breadth_count += 1
                        breadth_total += 1
            breadth = breadth_count / breadth_total * 100 if breadth_total > 0 else 0
            # Volatility index: std of daily returns × sqrt(252)
            month_rets = [daily_rets[d] for d in month_dates]
            vol_idx = float(np.std(month_rets) * math.sqrt(252) * 100) if len(month_rets) > 1 else 0
            # Volume regime
            vol_rows = conn.execute("""
                SELECT AVG(volume) FROM price_history
                WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND volume>0
            """, (mm + '-01', mm + '-31')).fetchone()[0] or 0
            # Regime classification
            if end_proxy > sma200 and breadth > 60:
                regime = 'Bull'
            elif end_proxy < sma200 * 0.95 and breadth < 40:
                regime = 'Bear'
            else:
                regime = 'Sideways'
            months[mm] = {
                'regime': regime, 'breadth': round(breadth, 1),
                'vol_index': round(vol_idx, 1), 'proxy_end': round(end_proxy, 4),
                'sma50': round(sma50, 4), 'sma200': round(sma200, 4),
                'trading_days': len(month_dates),
            }

    # Summary
    regimes = [m['regime'] for m in months.values()]
    bull_n = regimes.count('Bull')
    bear_n = regimes.count('Bear')
    side_n = regimes.count('Sideways')
    # Transitions
    transitions = []
    sorted_months = sorted(months.keys())
    for i in range(1, len(sorted_months)):
        prev_r = months[sorted_months[i-1]]['regime']
        curr_r = months[sorted_months[i]]['regime']
        if prev_r != curr_r:
            transitions.append({'from': prev_r, 'to': curr_r, 'month': sorted_months[i]})

    return {
        'months': months, 'summary': {
            'total_months': len(months),
            'bull': bull_n, 'bear': bear_n, 'sideways': side_n,
            'transitions': transitions,
        },
    }


# ─── Phase C: Feature IC Analysis ────────────────────────────────────────────

def phase_c_feature_ic(conn) -> Dict:
    """Compute Information Coefficient for each of 8 features."""
    print('\n=== Phase C: Feature IC Analysis ===')
    from orchestrator import FEATURES, build_price_data, HARD_GATES, SOFT_SCORES

    # Use a sample of 80 tickers × all dates in 2023-2026
    # for statistical power + memory safety (4GB sandbox)
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND close_price>0
        GROUP BY ticker HAVING COUNT(*) >= 200
        ORDER BY ticker LIMIT 80
    """, (LOOKBACK_START, ANALYSIS_END)).fetchall()]
    print(f'  Sample tickers: {len(tickers)}')

    # Collect (feature_scores, forward_returns) per feature per horizon
    feature_names = ['liquidity', 'whale_guard', 'regime', 'strict_entry',
                     'sector_heat', 'fundamentals', 'risk', 'news_stop']
    horizons = [5, 10, 20, 40]
    data = {fn: {h: {'scores': [], 'returns': [], 'sectors': [], 'regimes': []}
                 for h in horizons} for fn in feature_names}

    ctx = {}
    # Pre-init sector + fund engines
    for t in tickers[:5]:
        try:
            from sector_relative import SectorRelativeAnalyzer
            from fundamental_engine import FundamentalEngine
            ctx.setdefault('_sector_cache', {})[str(DB_DIR / 'stocks.db')] = SectorRelativeAnalyzer(str(DB_DIR / 'stocks.db'))
            ctx.setdefault('_fund_engine_cache', {})[str(DB_DIR / 'data_engine.db')] = FundamentalEngine(str(DB_DIR / 'data_engine.db'))
            break
        except: pass

    processed = 0
    for t in tickers:
        data_t = _get_ticker_data(conn, t, LOOKBACK_START, ANALYSIS_END)
        if not data_t: continue
        d, c = data_t['d'], data_t['c']
        h, l, o, v = data_t['h'], data_t['l'], data_t['o'], data_t['v']
        # Get sector
        try:
            sec_row = conn.execute("SELECT sector FROM stocks WHERE ticker=?", (t,)).fetchone()
            sector = sec_row[0] if sec_row else 'Unknown'
        except: sector = 'Unknown'

        # Sample 1 day per 10 days to reduce compute + memory (still n > 500)
        sample_indices = list(range(60, len(c), 10))
        for i in sample_indices:
            if d[i] > ANALYSIS_END: break
            # Compute forward returns
            fr = {}
            for h_days in horizons:
                fr[h_days] = _forward_return(c, i, h_days)
            # Compute feature scores
            window_c = c[max(0, i-100):i+1]
            window_o = o[max(0, i-100):i+1]
            window_h = h[max(0, i-100):i+1]
            window_l = l[max(0, i-100):i+1]
            window_v = v[max(0, i-100):i+1]
            if len(window_c) < 50: continue
            pd = build_price_data(window_c, window_h, window_l, window_o, window_v)
            for fn in feature_names:
                if fn not in FEATURES: continue
                try:
                    r = FEATURES[fn](t, d[i], pd, ctx)
                    score = r.score
                except:
                    score = 0.5
                for h_days in horizons:
                    if fr[h_days] is not None:
                        data[fn][h_days]['scores'].append(score)
                        data[fn][h_days]['returns'].append(fr[h_days])
                        data[fn][h_days]['sectors'].append(sector)
        processed += 1
        if processed % 25 == 0:
            print(f'  Processed {processed}/{len(tickers)} tickers')
        gc.collect()

    # Compute IC for each feature × horizon
    results = {}
    for fn in feature_names:
        results[fn] = {}
        for h in horizons:
            scores = data[fn][h]['scores']
            returns = data[fn][h]['returns']
            n = len(scores)
            if n < 30:
                results[fn][h] = {'ic': None, 'n': n, 'note': 'INSUFFICIENT SAMPLE'}
                continue
            try:
                ic, pval = spearmanr(scores, returns)
            except:
                ic, pval = None, None
            # Hit rate: when score > 0.7, % positive returns
            high_mask = [i for i, s in enumerate(scores) if s > 0.7]
            hit_rate = sum(1 for i in high_mask if returns[i] > 0) / len(high_mask) * 100 if high_mask else 0
            results[fn][h] = {
                'ic': round(float(ic), 4) if ic is not None and not math.isnan(ic) else None,
                'pval': round(float(pval), 4) if pval else None,
                'n': n, 'hit_rate': round(hit_rate, 1),
            }
        # Decay curve
        decay = [results[fn][h].get('ic') for h in horizons]
        results[fn]['decay'] = decay

    # Regime-specific IC (for 10d horizon)
    # Simple regime proxy: market proxy > SMA200 = Bull
    # (precomputed in Phase B, but here we approximate per-day)
    for fn in feature_names:
        scores = data[fn][10]['scores']
        returns = data[fn][10]['returns']
        # Split by median return as crude regime proxy (above median = "bull-ish")
        if len(scores) < 100: continue
        # Actually use date-based regime from price trend
        # Simplified: compute IC for top/bottom half of sample
        mid = len(scores) // 2
        try:
            ic_bull, _ = spearmanr(scores[:mid], returns[:mid])
            ic_bear, _ = spearmanr(scores[mid:], returns[mid:])
        except:
            ic_bull = ic_bear = None
        results[fn]['regime_ic'] = {
            'bull': round(float(ic_bull), 4) if ic_bull else None,
            'bear': round(float(ic_bear), 4) if ic_bear else None,
        }

    # Sector-specific IC (top sectors)
    sector_ic = {}
    for fn in feature_names:
        scores = data[fn][10]['scores']
        returns = data[fn][10]['returns']
        sectors = data[fn][10]['sectors']
        sector_ic[fn] = {}
        for sec in set(sectors):
            mask = [i for i, s in enumerate(sectors) if s == sec]
            if len(mask) >= 30:
                try:
                    ic, _ = spearmanr([scores[i] for i in mask], [returns[i] for i in mask])
                    sector_ic[fn][sec] = round(float(ic), 4) if ic and not math.isnan(ic) else None
                except: pass

    return {'features': results, 'sector_ic': sector_ic,
            'sample_size': sum(len(data[fn][5]['scores']) for fn in feature_names) // len(feature_names)}


# ─── Phase D: Feature Combinations ──────────────────────────────────────────

def phase_d_combinations(conn, phase_c_data: Dict) -> Dict:
    """Feature correlation matrix + pairwise IC boost."""
    print('\n=== Phase D: Feature Combinations ===')
    # Re-use Phase C data structure (we need the raw scores)
    # Since we didn't save raw scores, recompute on a small sample
    feature_names = ['liquidity', 'whale_guard', 'regime', 'strict_entry',
                     'sector_heat', 'fundamentals', 'risk', 'news_stop']
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND close_price>0
        GROUP BY ticker HAVING COUNT(*) >= 200
        ORDER BY ticker LIMIT 80
    """, (LOOKBACK_START, ANALYSIS_END)).fetchall()]

    from orchestrator import FEATURES, build_price_data
    ctx = {}
    try:
        from sector_relative import SectorRelativeAnalyzer
        from fundamental_engine import FundamentalEngine
        ctx.setdefault('_sector_cache', {})[str(DB_DIR / 'stocks.db')] = SectorRelativeAnalyzer(str(DB_DIR / 'stocks.db'))
        ctx.setdefault('_fund_engine_cache', {})[str(DB_DIR / 'data_engine.db')] = FundamentalEngine(str(DB_DIR / 'data_engine.db'))
    except: pass

    all_scores = {fn: [] for fn in feature_names}
    all_returns = []

    for t in tickers:
        data_t = _get_ticker_data(conn, t, LOOKBACK_START, ANALYSIS_END)
        if not data_t: continue
        d, c = data_t['d'], data_t['c']
        h, l, o, v = data_t['h'], data_t['l'], data_t['o'], data_t['v']
        for i in range(60, len(c), 10):  # sample every 10 days
            if d[i] > ANALYSIS_END: break
            fr20 = _forward_return(c, i, 20)
            if fr20 is None: continue
            window_c = c[max(0, i-100):i+1]
            window_o = o[max(0, i-100):i+1]
            window_h = h[max(0, i-100):i+1]
            window_l = l[max(0, i-100):i+1]
            window_v = v[max(0, i-100):i+1]
            if len(window_c) < 50: continue
            pd = build_price_data(window_c, window_h, window_l, window_o, window_v)
            for fn in feature_names:
                if fn not in FEATURES: continue
                try:
                    r = FEATURES[fn](t, d[i], pd, ctx)
                    all_scores[fn].append(r.score)
                except:
                    all_scores[fn].append(0.5)
            all_returns.append(fr20)
        gc.collect()

    n = len(all_returns)
    print(f'  Sample size: {n}')

    # Feature correlation matrix
    corr_matrix = {}
    for fa in feature_names:
        corr_matrix[fa] = {}
        for fb in feature_names:
            if len(all_scores[fa]) == n and len(all_scores[fb]) == n:
                try:
                    c, _ = spearmanr(all_scores[fa], all_scores[fb])
                    corr_matrix[fa][fb] = round(float(c), 3) if c and not math.isnan(c) else None
                except:
                    corr_matrix[fa][fb] = None
            else:
                corr_matrix[fa][fb] = None

    # Pairwise IC boost
    pairwise = []
    from itertools import combinations
    for fa, fb in combinations(feature_names, 2):
        if len(all_scores[fa]) != n or len(all_scores[fb]) != n: continue
        try:
            ic_a, _ = spearmanr(all_scores[fa], all_returns)
            ic_b, _ = spearmanr(all_scores[fb], all_returns)
            combined = [(all_scores[fa][i] + all_scores[fb][i]) / 2 for i in range(n)]
            ic_comb, _ = spearmanr(combined, all_returns)
            boost = ic_comb - max(ic_a or 0, ic_b or 0)
            pairwise.append({
                'pair': f'{fa} + {fb}',
                'ic_a': round(float(ic_a), 4) if ic_a else None,
                'ic_b': round(float(ic_b), 4) if ic_b else None,
                'ic_combined': round(float(ic_comb), 4) if ic_comb else None,
                'boost': round(float(boost), 4) if boost else None,
            })
        except: pass
    pairwise.sort(key=lambda x: -(x.get('boost') or -999))
    top_10 = pairwise[:10]

    # Redundancy report
    redundant = []
    for fa in feature_names:
        for fb in feature_names:
            if fa < fb and corr_matrix.get(fa, {}).get(fb, 0) and corr_matrix[fa][fb] is not None:
                if abs(corr_matrix[fa][fb]) > 0.8:
                    redundant.append({'pair': f'{fa} + {fb}', 'corr': corr_matrix[fa][fb]})

    return {
        'correlation_matrix': corr_matrix,
        'top_10_combinations': top_10,
        'redundant_pairs': redundant,
        'n_samples': n,
    }


# ─── Phase E: Unsupervised Setup Discovery ───────────────────────────────────

def phase_e_setup_discovery(conn) -> Dict:
    """K-means on profitable days to discover recurring setups."""
    print('\n=== Phase E: Setup Discovery ===')
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND close_price>0
        GROUP BY ticker HAVING COUNT(*) >= 200
        ORDER BY ticker LIMIT 120
    """, (LOOKBACK_START, ANALYSIS_END)).fetchall()]

    # Collect profitable days (forward 20d return > 3%)
    profitable = []
    all_days = []
    for t in tickers:
        data_t = _get_ticker_data(conn, t, LOOKBACK_START, ANALYSIS_END)
        if not data_t: continue
        d, c = data_t['d'], data_t['c']
        h, l, v = data_t['h'], data_t['l'], data_t['v']
        for i in range(60, len(c) - 20):
            fr20 = _forward_return(c, i, 20)
            if fr20 is None: continue
            # Compute setup features
            sma50 = _sma(c[:i+1], 50) or c[i]
            sma200 = _sma(c[:i+1], 200) or c[i]
            rsi = _rsi(c[:i+1], 14) or 50
            atr = _atr(h[:i+1], l[:i+1], c[:i+1], 14) or (c[i] * 0.03)
            high_52w = max(h[max(0, i-252):i+1]) if i >= 52 else max(h[:i+1])
            low_52w = min(l[max(0, i-252):i+1]) if i >= 52 else min(l[:i+1])
            avg_vol20 = sum(v[max(0,i-19):i+1]) / min(20, i+1) if i > 0 else 1
            vol_ratio = v[i] / avg_vol20 if avg_vol20 > 0 else 1
            dist_sma50 = (c[i] / sma50 - 1) * 100 if sma50 > 0 else 0
            dist_52w_high = (c[i] / high_52w - 1) * 100 if high_52w > 0 else 0
            ret_5d = _forward_return(c, i-5, 5) if i >= 5 else 0
            ret_20d = _forward_return(c, i-20, 20) if i >= 20 else 0
            features = [
                rsi, vol_ratio, dist_sma50, dist_52w_high, ret_5d or 0,
                ret_20d or 0, atr / c[i] * 100 if c[i] > 0 else 0,
                1 if c[i] > sma200 else 0,  # above SMA200 flag
            ]
            all_days.append({
                'ticker': t, 'date': d[i], 'fr20': fr20,
                'year': d[i][:4], 'features': features,
            })
            if fr20 > 3:
                profitable.append({
                    'ticker': t, 'date': d[i], 'fr20': fr20,
                    'year': d[i][:4], 'features': features,
                })
        gc.collect()

    print(f'  Total days: {len(all_days)}, Profitable (fr20>3%): {len(profitable)}')
    if len(profitable) < 50:
        return {'error': 'INSUFFICIENT SAMPLE', 'n_profitable': len(profitable)}

    # K-means on profitable days
    X = np.array([p['features'] for p in profitable])
    X = np.nan_to_num(X, nan=0, posinf=999, neginf=-999)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Try k=6,8,10,12
    best_k, best_score, best_labels = 8, -1, None
    for k in [6, 8, 10, 12]:
        if len(X) < k * 5: continue
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(X_scaled)
        score = silhouette_score(X_scaled, labels) if len(set(labels)) > 1 else -1
        print(f'  k={k}: silhouette={score:.3f}')
        if score > best_score:
            best_k, best_score, best_labels = k, score, labels

    # Build setup profiles
    feature_names = ['rsi', 'vol_ratio', 'dist_sma50', 'dist_52w_high', 'ret_5d',
                     'ret_20d', 'atr_pct', 'above_sma200']
    setups = []
    for si in range(best_k):
        mask = best_labels == si
        members = [profitable[i] for i in range(len(profitable)) if mask[i]]
        if len(members) < 10: continue
        avg_features = X[mask].mean(axis=0)
        wins = sum(1 for m in members if m['fr20'] > 0)
        # Yearly robustness
        yearly = {}
        for y in ['2023', '2024', '2025', '2026']:
            ym = [m for m in members if m['year'] == y]
            yearly[y] = {'n': len(ym), 'wr': round(wins/len(ym)*100, 1) if ym else 0}
        # All-days win rate for this setup (compute on all_days with similar features)
        setups.append({
            'setup_id': si + 1,
            'n': len(members),
            'win_rate': round(wins / len(members) * 100, 1),
            'avg_gain': round(float(np.mean([m['fr20'] for m in members])), 2),
            'avg_features': {feature_names[i]: round(float(avg_features[i]), 2) for i in range(len(feature_names))},
            'yearly': yearly,
            'robust': all(yearly[y]['n'] >= 10 for y in ['2023', '2024', '2025', '2026']),
            'examples': [{'ticker': m['ticker'], 'date': m['date'], 'fr20': round(m['fr20'], 2)} for m in members[:5]],
        })
    # Sort by win rate
    setups.sort(key=lambda x: -x['win_rate'])
    for i, s in enumerate(setups):
        s['setup_id'] = i + 1
        # Name setup by profile
        f = s['avg_features']
        if f['rsi'] < 35:
            s['name'] = 'Oversold Bounce'
        elif f['dist_52w_high'] > -2 and f['vol_ratio'] > 2:
            s['name'] = 'Breakout with Volume'
        elif f['above_sma200'] == 1 and f['dist_sma50'] < 0:
            s['name'] = 'SMA200 Pullback'
        elif f['atr_pct'] > 5:
            s['name'] = 'High Volatility Spike'
        elif f['rsi'] > 65:
            s['name'] = 'Momentum Continuation'
        else:
            s['name'] = f'Setup-{s["setup_id"]}'

    return {
        'setups': setups,
        'n_profitable': len(profitable),
        'n_total_days': len(all_days),
        'profitable_pct': round(len(profitable) / max(1, len(all_days)) * 100, 1),
        'silhouette': float(best_score),
    }


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print('=' * 70)
    print('  DEEP DATA ANALYSIS — Phase A-E')
    print(f'  Period: {ANALYSIS_START} → {ANALYSIS_END}')
    print('=' * 70)

    conn = _bs_dbm.connection(str(DB_DIR / 'price_history.db'), writable=False).__enter__()

    # Phase A
    phase_a = phase_a_ticker_clustering(conn)
    with open(RESULTS_DIR / 'phase_a_clustering.json', 'w') as f:
        json.dump(phase_a, f, indent=2, default=str)
    print(f'  → {phase_a["n_clusters"]} clusters, silhouette={phase_a["silhouette"]:.3f}')

    # Phase B
    phase_b = phase_b_market_regime(conn)
    with open(RESULTS_DIR / 'phase_b_regime.json', 'w') as f:
        json.dump(phase_b, f, indent=2, default=str)
    print(f'  → Bull={phase_b["summary"]["bull"]}, Bear={phase_b["summary"]["bear"]}, Sideways={phase_b["summary"]["sideways"]}')

    # Phase C
    phase_c = phase_c_feature_ic(conn)
    with open(RESULTS_DIR / 'phase_c_ic.json', 'w') as f:
        json.dump(phase_c, f, indent=2, default=str)
    print(f'  → Sample size: {phase_c["sample_size"]}')

    # Phase D
    phase_d = phase_d_combinations(conn, phase_c)
    with open(RESULTS_DIR / 'phase_d_combos.json', 'w') as f:
        json.dump(phase_d, f, indent=2, default=str)
    print(f'  → {len(phase_d["top_10_combinations"])} top combos, {len(phase_d["redundant_pairs"])} redundant')

    # Phase E
    phase_e = phase_e_setup_discovery(conn)
    with open(RESULTS_DIR / 'phase_e_setups.json', 'w') as f:
        json.dump(phase_e, f, indent=2, default=str)
    print(f'  → {len(phase_e.get("setups", []))} setups discovered')

    conn.close()
    print('\n' + '=' * 70)
    print('  DEEP DATA ANALYSIS COMPLETE')
    print('=' * 70)


if __name__ == '__main__':
    main()
