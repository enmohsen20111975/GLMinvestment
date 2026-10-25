#!/usr/bin/env python3
"""
event_driven_4point_verification.py — التحقق من الـ 4 نقاط (محسن طلبها)

النقطة 1: re-run validation بدون 2023 (2025 + 2026 بس = 641 صفقة)
النقطة 2: إصلاح MaxDD calculation (cumprod على equity curve بدل cumsum على returns)
النقطة 3: اختبار Regime Filter على 2024 (استبعاد شهور BEAR في COMI)
النقطة 4: Matched Null Model (مؤكد في الشات القديم — بس هـ re-verify)

المنطق:
  - Event-driven: شراء بعد تصحيح حاد (drop > 15% في 5d | SL 5% | TGT 15% | Hold 10d | 50M turnover)
  - Regime: COMI (proxy EGX30) فوق 200-day MA = BULL/RANGE، تحت = BEAR
  - MaxDD الصح: equity = initial * prod(1 + r_i/100) → peak → drawdown = (peak-equity)/peak * 100
"""
import sys
import os
import sqlite3
import json
import numpy as np
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from scipy import stats as scipy_stats

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'

sys.path.insert(0, str(PROJECT / 'scripts'))
from event_driven_and_trend_egx30 import (
    generate_event_driven_signals, load_ticker_data, calc_stats
)
from event_driven_statistical_validation import generate_matched_null_signals

# ═══════════════════════════════════════════════════════════════════════
# FIXED MaxDD calculation (النقطة 2)
# ═══════════════════════════════════════════════════════════════════════

def calc_risk_metrics_fixed(returns_pct, period_label='Strategy'):
    """
    حساب metrics إحصائية مع MaxDD مظبوط.

    BUG القديم: cumsum على returns نسبوية → MaxDD ممكن يطلع > 100% (مستحيل).
    FIX: equity curve بـ compounding → MaxDD دايمًا < 100%.
    """
    if not returns_pct:
        return None

    arr = np.array(returns_pct) / 100.0  # تحويل لنسب عشرية (5% → 0.05)
    n = len(arr)
    mean_r = np.mean(arr)
    std_r = np.std(arr, ddof=1)

    # Annualization (10-day hold → ~25 trades/year)
    annualization = np.sqrt(25)
    sharpe = (mean_r / std_r * annualization) if std_r > 0 else 0

    # Sortino (downside only)
    downside = arr[arr < 0]
    downside_std = np.std(downside, ddof=1) if len(downside) > 1 else 0
    sortino = (mean_r / downside_std * annualization) if downside_std > 0 else 0

    # ✅ FIX: Equity curve بـ compounding (initial = 1.0)
    equity = np.cumprod(1 + arr)  # equity[i] = 1.0 * prod(1+r_j)
    peak = np.maximum.accumulate(equity)
    drawdown_pct = (peak - equity) / peak * 100  # drawdown كـ % من peak
    max_dd = float(np.max(drawdown_pct)) if len(drawdown_pct) > 0 else 0.0

    # Final equity
    final_equity = float(equity[-1])
    total_return_pct = (final_equity - 1.0) * 100

    # Skewness + Kurtosis
    skewness = float(scipy_stats.skew(arr))
    kurtosis = float(scipy_stats.kurtosis(arr))

    pct_positive = float(np.sum(arr > 0) / n * 100)
    pct_negative = float(np.sum(arr < 0) / n * 100)
    worst = float(np.min(arr) * 100)
    best = float(np.max(arr) * 100)

    return {
        'period': period_label,
        'n': n,
        'mean_pct': float(mean_r * 100),
        'std_pct': float(std_r * 100),
        'sharpe': float(sharpe),
        'sortino': float(sortino),
        'max_drawdown_pct': max_dd,  # ✅ FIXED — دايمًا < 100%
        'final_equity': final_equity,
        'total_return_pct': total_return_pct,
        'skewness': skewness,
        'kurtosis': kurtosis,
        'pct_positive': pct_positive,
        'pct_negative': pct_negative,
        'worst_trade_pct': worst,
        'best_trade_pct': best,
    }


# ═══════════════════════════════════════════════════════════════════════
# Regime Filter (النقطة 3) — COMI proxy لـ EGX30
# ═══════════════════════════════════════════════════════════════════════

def load_comi_regime(start_date='2023-01-01', end_date='2026-10-18'):
    """
    تحميل COMI + حساب 200-day MA.
    Regime:
      - BULL/RANGE: COMI close >= 200-day MA
      - BEAR: COMI close < 200-day MA
    رجّع dict: {date: regime} عشان نـ filter الإشارات.
    """
    ph_db = DB_DIR / 'price_history.db'
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    con = db_manager.connection(str(ph_db), writable=False).__enter__()
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        SELECT date, close_price FROM price_history
        WHERE ticker = 'COMI' AND date >= ? AND date <= ?
        ORDER BY date
    """, (start_date, end_date)).fetchall()
    con.close()

    if len(rows) < 200:
        print(f'  ⚠️  COMI data insufficient: {len(rows)} rows (need 200+ for 200-day MA)')
        return {}

    dates = [r['date'] for r in rows]
    closes = [r['close_price'] for r in rows]

    regime_map = {}
    bear_days = 0
    bull_days = 0
    for i in range(200, len(closes)):
        ma_200 = np.mean(closes[i-200:i])
        if closes[i] >= ma_200:
            regime_map[dates[i]] = 'BULL'
            bull_days += 1
        else:
            regime_map[dates[i]] = 'BEAR'
            bear_days += 1

    print(f'  📊 COMI regime: {bull_days} BULL days + {bear_days} BEAR days ({bear_days/(bull_days+bear_days)*100:.1f}% BEAR)')
    return regime_map


def filter_signals_by_regime(signals, regime_map, skip_bear=True):
    """فلترة الإشارات: skip لو يوم الدخول في BEAR regime."""
    if not skip_bear:
        return signals, []
    kept = []
    skipped = []
    for s in signals:
        entry_date = s.get('entry_date') or s.get('signal_date')
        regime = regime_map.get(entry_date)
        if regime == 'BEAR':
            skipped.append(s)
        else:
            kept.append(s)
    return kept, skipped


# ═══════════════════════════════════════════════════════════════════════
# p-value (3 methods)
# ═══════════════════════════════════════════════════════════════════════

def pvalue_normal_approx(strategy_returns, null_returns):
    if not strategy_returns or not null_returns:
        return None
    s_mean = np.mean(strategy_returns)
    n_mean = np.mean(null_returns)
    s_std = np.std(strategy_returns, ddof=1)
    n_std = np.std(null_returns, ddof=1)
    s_n = len(strategy_returns)
    n_n = len(null_returns)
    pooled_se = np.sqrt(s_std**2/s_n + n_std**2/n_n)
    if pooled_se == 0:
        return None
    t_stat = (s_mean - n_mean) / pooled_se
    p_value = 1 - scipy_stats.norm.cdf(t_stat)
    return {'method': 'normal', 't_stat': float(t_stat), 'p_value_pct': float(p_value * 100), 'edge': p_value < 0.05}


def pvalue_bootstrap(strategy_returns, null_returns, n_bootstrap=5000):
    if not strategy_returns or not null_returns:
        return None
    np.random.seed(42)
    s_arr = np.array(strategy_returns)
    n_arr = np.array(null_returns)
    observed_diff = np.mean(s_arr) - np.mean(n_arr)
    combined = np.concatenate([s_arr, n_arr])
    n_s = len(s_arr)
    n_total = len(combined)
    bootstrap_diffs = []
    for _ in range(n_bootstrap):
        idx = np.random.choice(n_total, n_total, replace=True)
        s_sample = combined[idx[:n_s]]
        n_sample = combined[idx[n_s:]]
        bootstrap_diffs.append(np.mean(s_sample) - np.mean(n_sample))
    bootstrap_diffs = np.array(bootstrap_diffs)
    p_value = np.sum(bootstrap_diffs >= observed_diff) / n_bootstrap
    ci_lower = np.percentile(bootstrap_diffs, 2.5)
    ci_upper = np.percentile(bootstrap_diffs, 97.5)
    return {'method': 'bootstrap', 'observed_diff': float(observed_diff), 'p_value_pct': float(p_value * 100), 'ci_95': [float(ci_lower), float(ci_upper)], 'edge': p_value < 0.05}


def pvalue_block_bootstrap(strategy_returns, null_returns, block_size=10, n_bootstrap=5000):
    if not strategy_returns or not null_returns:
        return None
    np.random.seed(42)
    s_arr = np.array(strategy_returns)
    n_arr = np.array(null_returns)
    observed_diff = np.mean(s_arr) - np.mean(n_arr)
    combined = np.concatenate([s_arr, n_arr])
    n_s = len(s_arr)
    n_total = len(combined)
    def block_resample(arr, bs, nt):
        n_blocks = (nt + bs - 1) // bs
        result = []
        for _ in range(n_blocks):
            start = np.random.randint(0, max(1, len(arr) - bs))
            result.extend(arr[start:start + bs])
        return np.array(result[:nt])
    bootstrap_diffs = []
    for _ in range(n_bootstrap):
        s_sample = block_resample(combined, block_size, n_s)
        n_sample = block_resample(combined, block_size, n_total - n_s)
        bootstrap_diffs.append(np.mean(s_sample) - np.mean(n_sample))
    bootstrap_diffs = np.array(bootstrap_diffs)
    p_value = np.sum(bootstrap_diffs >= observed_diff) / n_bootstrap
    return {'method': 'block_bootstrap', 'block_size': block_size, 'p_value_pct': float(p_value * 100), 'edge': p_value < 0.05}


# ═══════════════════════════════════════════════════════════════════════
# Validation per period
# ═══════════════════════════════════════════════════════════════════════

def validate_period(ticker_data, regime_map, period_name, start_date, end_date, apply_regime_filter=False):
    print(f"\n{'='*100}")
    regime_label = ' + Regime Filter' if apply_regime_filter else ''
    print(f"  📊 {period_name} ({start_date} → {end_date}){regime_label}")
    print(f"{'='*100}")

    # Event-driven signals
    event_signals = generate_event_driven_signals(ticker_data, start_date, end_date)
    print(f"\n  📈 Event-driven signals (raw): {len(event_signals)}")

    if not event_signals:
        return {'period': period_name, 'regime_filter': apply_regime_filter, 'error': 'no signals'}

    # Apply regime filter (النقطة 3)
    if apply_regime_filter:
        event_signals, skipped = filter_signals_by_regime(event_signals, regime_map, skip_bear=True)
        print(f"  🚫 Regime Filter: skipped {len(skipped)} BEAR signals → kept {len(event_signals)}")

    if not event_signals:
        return {'period': period_name, 'regime_filter': apply_regime_filter, 'error': 'all signals filtered by regime'}

    event_returns = [s['net_return'] for s in event_signals]

    # ✅ النقطة 2: Risk metrics بـ MaxDD fixed
    print(f"\n  ── STEP 1: Risk Metrics (MaxDD FIXED — cumprod equity curve) ──")
    risk = calc_risk_metrics_fixed(event_returns, f'{period_name}')
    print(f"    N: {risk['n']}")
    print(f"    Mean: {risk['mean_pct']:+.2f}%")
    print(f"    Std Dev: {risk['std_pct']:.2f}%")
    print(f"    Sharpe (annualized): {risk['sharpe']:.2f}")
    print(f"    Sortino (annualized): {risk['sortino']:.2f}")
    print(f"    Max Drawdown: {risk['max_drawdown_pct']:.2f}%  ← FIXED (< 100% دايمًا)")
    print(f"    Final Equity (from 1.0): {risk['final_equity']:.4f}")
    print(f"    Total Return: {risk['total_return_pct']:+.2f}%")
    print(f"    Skewness: {risk['skewness']:.2f} | Kurtosis: {risk['kurtosis']:.2f}")
    print(f"    % Positive: {risk['pct_positive']:.1f}% | % Negative: {risk['pct_negative']:.1f}%")
    print(f"    Worst: {risk['worst_trade_pct']:.2f}% | Best: {risk['best_trade_pct']:.2f}%")

    # ✅ النقطة 4: Matched Null Model (نفس الأسهم + نفس الفلاتر + توقيت عشوائي)
    print(f"\n  ── STEP 4: Matched Null Model (نفس الأسهم + توقيت عشوائي) ──")
    matched_null = generate_matched_null_signals(ticker_data, event_signals, start_date, end_date)
    null_returns = [s['net_return'] for s in matched_null]
    null_risk = calc_risk_metrics_fixed(null_returns, f'Null {period_name}') if null_returns else None
    print(f"    Matched Null signals: {len(matched_null)}")
    if null_risk:
        print(f"    Null Mean: {null_risk['mean_pct']:+.2f}%")
        print(f"    Null Sharpe: {null_risk['sharpe']:.2f}")
        print(f"    Null MaxDD: {null_risk['max_drawdown_pct']:.2f}%")

    # p-value (3 methods)
    print(f"\n  ── STEP 3: p-value (3 methods) ──")
    pv_n = pvalue_normal_approx(event_returns, null_returns)
    pv_b = pvalue_bootstrap(event_returns, null_returns, n_bootstrap=5000)
    pv_blk = pvalue_block_bootstrap(event_returns, null_returns, block_size=10, n_bootstrap=5000)
    if pv_n: print(f"    Normal: t={pv_n['t_stat']:.2f}, p={pv_n['p_value_pct']:.1f}%, edge={pv_n['edge']}")
    if pv_b: print(f"    Bootstrap: diff={pv_b['observed_diff']:+.2f}%, p={pv_b['p_value_pct']:.1f}%, CI95=[{pv_b['ci_95'][0]:+.2f},{pv_b['ci_95'][1]:+.2f}], edge={pv_b['edge']}")
    if pv_blk: print(f"    Block Bootstrap (b=10): p={pv_blk['p_value_pct']:.1f}%, edge={pv_blk['edge']}")

    return {
        'period': period_name,
        'start_date': start_date,
        'end_date': end_date,
        'regime_filter': apply_regime_filter,
        'n_event_signals': len(event_signals),
        'risk_metrics': risk,
        'matched_null_n': len(matched_null),
        'matched_null_risk': null_risk,
        'pvalue_normal': pv_n,
        'pvalue_bootstrap': pv_b,
        'pvalue_block_bootstrap': pv_blk,
    }


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

def main():
    print(f"\n{'#'*100}")
    print(f"  🔬 EVENT-DRIVEN 4-POINT VERIFICATION (محسن طلبها)")
    print(f"  1: re-run بدون 2023 (2025+2026)")
    print(f"  2: MaxDD fixed (cumprod equity curve)")
    print(f"  3: Regime Filter على 2024 (استبعاد BEAR)")
    print(f"  4: Matched Null Model (re-verify)")
    print(f"{'#'*100}")

    # Load data
    ticker_data = load_ticker_data(start_date='2023-01-01', end_date='2026-10-18')
    regime_map = load_comi_regime(start_date='2023-01-01', end_date='2026-10-18')

    results = []

    # ════════ النقطة 1: 2025 + 2026 بس (بدون 2023) ════════
    print(f"\n\n{'═'*100}")
    print(f"  POINT 1: re-run validation بدون 2023 (2025 + 2026 بس = 641 صفقة متوقعة)")
    print(f"{'═'*100}")

    r2026 = validate_period(ticker_data, regime_map, '2026', '2026-01-01', '2026-10-18', apply_regime_filter=False)
    results.append(r2026)
    r2025 = validate_period(ticker_data, regime_map, '2025', '2025-01-01', '2025-12-31', apply_regime_filter=False)
    results.append(r2025)

    # ════════ النقطة 3: Regime Filter على 2024 ════════
    print(f"\n\n{'═'*100}")
    print(f"  POINT 3: Regime Filter على 2024 (BEAR filter)")
    print(f"{'═'*100}")

    # 2024 بدون filter (baseline)
    r2024_base = validate_period(ticker_data, regime_map, '2024-baseline', '2024-01-01', '2024-12-31', apply_regime_filter=False)
    results.append(r2024_base)

    # 2024 + Regime Filter (skip BEAR)
    r2024_regime = validate_period(ticker_data, regime_map, '2024+regime', '2024-01-01', '2024-12-31', apply_regime_filter=True)
    results.append(r2024_regime)

    # ════════ نقطة إضافية: 2025 + 2026 + Regime Filter (للتأكيد) ════════
    print(f"\n\n{'═'*100}")
    print(f"  BONUS: 2025 + 2026 + Regime Filter (للتأكيد)")
    print(f"{'═'*100}")

    r2026_regime = validate_period(ticker_data, regime_map, '2026+regime', '2026-01-01', '2026-10-18', apply_regime_filter=True)
    results.append(r2026_regime)
    r2025_regime = validate_period(ticker_data, regime_map, '2025+regime', '2025-01-01', '2025-12-31', apply_regime_filter=True)
    results.append(r2025_regime)

    # ════════ Final summary ════════
    print(f"\n\n{'='*130}")
    print(f"  🎯 FINAL 4-POINT VERIFICATION SUMMARY")
    print(f"{'='*130}")
    print(f"\n  {'Period':18s} | {'N':>5} | {'Mean':>7} | {'Std':>6} | {'Sharpe':>7} | {'MaxDD':>7} | {'TotRet':>7} | {'Null':>7} | {'p_norm':>7} | {'p_boot':>7} | {'p_blk':>7} | {'Edge':>5}")
    print(f"  {'-'*125}")

    for r in results:
        if 'error' in r:
            print(f"  {r['period']:18s} | ERROR: {r['error']}")
            continue
        rm = r.get('risk_metrics') or {}
        nr = r.get('matched_null_risk') or {}
        pn = r.get('pvalue_normal') or {}
        pb = r.get('pvalue_bootstrap') or {}
        pblk = r.get('pvalue_block_bootstrap') or {}

        n = rm.get('n', 0)
        mean = f"{rm.get('mean_pct',0):+.2f}%" if rm else 'N/A'
        std = f"{rm.get('std_pct',0):.2f}%" if rm else 'N/A'
        sharpe = f"{rm.get('sharpe',0):.2f}" if rm else 'N/A'
        maxdd = f"{rm.get('max_drawdown_pct',0):.2f}%" if rm else 'N/A'
        totret = f"{rm.get('total_return_pct',0):+.2f}%" if rm else 'N/A'
        null_m = f"{nr.get('mean_pct',0):+.2f}%" if nr else 'N/A'
        p_n = f"{pn.get('p_value_pct',0):.1f}%" if pn else 'N/A'
        p_b = f"{pb.get('p_value_pct',0):.1f}%" if pb else 'N/A'
        p_blk = f"{pblk.get('p_value_pct',0):.1f}%" if pblk else 'N/A'
        edge = '✅' if (pn.get('edge') or pb.get('edge') or pblk.get('edge')) else '❌'

        print(f"  {r['period']:18s} | {n:>5} | {mean:>7} | {std:>6} | {sharpe:>7} | {maxdd:>7} | {totret:>7} | {null_m:>7} | {p_n:>7} | {p_b:>7} | {p_blk:>7} | {edge:>5}")

    print(f"\n{'='*130}")

    # Save JSON
    output_path = PROJECT / 'vps-service' / 'backtest_results' / f'event_driven_4point_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'verification_points': ['1: no 2023', '2: MaxDD fixed', '3: Regime Filter 2024', '4: Matched Null'],
            'results': results,
        }, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 JSON saved: {output_path}")


if __name__ == '__main__':
    main()
