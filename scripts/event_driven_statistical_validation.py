#!/usr/bin/env python3
"""
event_driven_statistical_validation.py — تحليل إحصائي صارم للـ Event-driven

بناءً على critique المحلل — 5 خطوات:

1. Standard Deviation + Sharpe Ratio + Sortino Ratio
2. توزيع الصفقات (قطاع/شهر)
3. مراجعة p-value (Bootstrap + Block Bootstrap)
4. Null Model محسن (نفس الأسهم + نفس الفلاتر + نفس Hold)
5. اختبار على 2023 و 2024
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

# Import event-driven strategy
sys.path.insert(0, str(PROJECT / 'scripts'))
from event_driven_and_trend_egx30 import (
    generate_event_driven_signals, generate_random_signals,
    load_ticker_data, calc_stats
)

# ═══════════════════════════════════════════════════════════════════════
# STEP 1: Standard Deviation + Sharpe + Sortino
# ═══════════════════════════════════════════════════════════════════════

def calc_risk_metrics(returns, period_label='Strategy'):
    """
    حساب:
      - Standard Deviation (annualized)
      - Sharpe Ratio (Rf = 0)
      - Sortino Ratio (downside deviation)
      - Max Drawdown
      - Skewness + Kurtosis
    """
    if not returns:
        return None

    returns_arr = np.array(returns)
    n = len(returns_arr)
    mean_r = np.mean(returns_arr)
    std_r = np.std(returns_arr, ddof=1)

    # Annualization factor (10-day holding → ~25 trades/year)
    # Sharpe = mean / std * sqrt(25)
    annualization = np.sqrt(25)
    sharpe = (mean_r / std_r * annualization) if std_r > 0 else 0

    # Sortino: downside deviation only
    downside = returns_arr[returns_arr < 0]
    downside_std = np.std(downside, ddof=1) if len(downside) > 1 else 0
    sortino = (mean_r / downside_std * annualization) if downside_std > 0 else 0

    # Max Drawdown (cumulative)
    cumulative = np.cumsum(returns_arr)
    peak = np.maximum.accumulate(cumulative)
    drawdowns = peak - cumulative
    max_dd = np.max(drawdowns) if len(drawdowns) > 0 else 0

    # Skewness + Kurtosis
    skewness = scipy_stats.skew(returns_arr)
    kurtosis = scipy_stats.kurtosis(returns_arr)

    # % positive vs negative
    pct_positive = np.sum(returns_arr > 0) / n * 100
    pct_negative = np.sum(returns_arr < 0) / n * 100

    # Worst + best trade
    worst = np.min(returns_arr)
    best = np.max(returns_arr)

    return {
        'period': period_label,
        'n': n,
        'mean': float(mean_r),
        'std': float(std_r),
        'sharpe': float(sharpe),
        'sortino': float(sortino),
        'max_drawdown': float(max_dd),
        'skewness': float(skewness),
        'kurtosis': float(kurtosis),
        'pct_positive': float(pct_positive),
        'pct_negative': float(pct_negative),
        'worst_trade': float(worst),
        'best_trade': float(best),
    }


# ═══════════════════════════════════════════════════════════════════════
# STEP 2: توزيع الصفقات (قطاع/شهر)
# ═══════════════════════════════════════════════════════════════════════

def load_sector_map():
    """تحميل ticker → sector من stocks.db"""
    sector_map = {}
    try:
        conn = sqlite3.connect(str(DB_DIR / 'stocks.db'))
        conn.row_factory = sqlite3.Row
        for r in conn.execute("SELECT ticker, sector FROM stocks WHERE sector IS NOT NULL").fetchall():
            sector_map[r['ticker']] = r['sector'] or 'UNKNOWN'
        conn.close()
    except Exception:
        pass
    return sector_map


def analyze_distribution(signals, sector_map):
    """تحليل توزيع الصفقات"""
    if not signals:
        return None

    # By sector
    by_sector = defaultdict(list)
    for s in signals:
        sector = sector_map.get(s['ticker'], 'UNKNOWN')
        by_sector[sector].append(s['net_return'])

    # By month
    by_month = defaultdict(list)
    for s in signals:
        month = s['signal_date'][:7]  # YYYY-MM
        by_month[month].append(s['net_return'])

    # By ticker (clustering check)
    by_ticker = defaultdict(list)
    for s in signals:
        by_ticker[s['ticker']].append(s['net_return'])

    # Sector stats
    sector_stats = []
    for sector, rets in sorted(by_sector.items(), key=lambda x: -len(x[1])):
        sector_stats.append({
            'sector': sector,
            'n_trades': len(rets),
            'pct_of_total': len(rets) / len(signals) * 100,
            'mean': float(np.mean(rets)),
            'win_rate': float(np.sum(np.array(rets) > 0) / len(rets) * 100),
        })

    # Month stats
    month_stats = []
    for month, rets in sorted(by_month.items()):
        month_stats.append({
            'month': month,
            'n_trades': len(rets),
            'pct_of_total': len(rets) / len(signals) * 100,
            'mean': float(np.mean(rets)),
            'win_rate': float(np.sum(np.array(rets) > 0) / len(rets) * 100),
        })

    # Ticker concentration
    ticker_counts = sorted([(t, len(r)) for t, r in by_ticker.items()], key=lambda x: -x[1])
    top_10_tickers = ticker_counts[:10]
    top_10_trades = sum(c for _, c in top_10_tickers)
    top_10_pct = top_10_trades / len(signals) * 100

    return {
        'total_signals': len(signals),
        'unique_tickers': len(by_ticker),
        'unique_sectors': len(by_sector),
        'unique_months': len(by_month),
        'top_10_ticker_concentration_pct': float(top_10_pct),
        'top_10_tickers': [{'ticker': t, 'n_trades': c} for t, c in top_10_tickers],
        'sector_distribution': sector_stats,
        'month_distribution': month_stats,
    }


# ═══════════════════════════════════════════════════════════════════════
# STEP 3: p-value methods (Bootstrap + Block Bootstrap)
# ═══════════════════════════════════════════════════════════════════════

def pvalue_normal_approx(strategy_returns, null_returns):
    """
    Normal Approximation: t-test
    H0: mean(strategy) == mean(null)
    """
    if not strategy_returns or not null_returns:
        return None

    s_mean = np.mean(strategy_returns)
    n_mean = np.mean(null_returns)
    s_std = np.std(strategy_returns, ddof=1)
    n_std = np.std(null_returns, ddof=1)
    s_n = len(strategy_returns)
    n_n = len(null_returns)

    # Two-sample t-test
    pooled_se = np.sqrt(s_std**2/s_n + n_std**2/n_n)
    if pooled_se == 0:
        return None
    t_stat = (s_mean - n_mean) / pooled_se
    # One-tailed p-value (strategy > null)
    p_value = 1 - scipy_stats.norm.cdf(t_stat)

    return {
        'method': 'normal_approx',
        't_stat': float(t_stat),
        'p_value': float(p_value * 100),  # %
        'edge': p_value < 0.05,
    }


def pvalue_bootstrap(strategy_returns, null_returns, n_bootstrap=10000):
    """
    Bootstrap: resample strategy + null, compare means
    """
    if not strategy_returns or not null_returns:
        return None

    np.random.seed(42)
    s_arr = np.array(strategy_returns)
    n_arr = np.array(null_returns)

    # Observed difference
    observed_diff = np.mean(s_arr) - np.mean(n_arr)

    # Bootstrap: combine + resample
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
    # p-value: % من bootstrap_diffs > observed_diff
    p_value = np.sum(bootstrap_diffs >= observed_diff) / n_bootstrap

    # 95% CI
    ci_lower = np.percentile(bootstrap_diffs, 2.5)
    ci_upper = np.percentile(bootstrap_diffs, 97.5)

    return {
        'method': 'bootstrap',
        'observed_diff': float(observed_diff),
        'p_value': float(p_value * 100),
        'ci_95': [float(ci_lower), float(ci_upper)],
        'edge': p_value < 0.05,
    }


def pvalue_block_bootstrap(strategy_returns, null_returns, block_size=10, n_bootstrap=10000):
    """
    Block Bootstrap: resample بـ blocks (عشان نحافظ على الـ autocorrelation)
    """
    if not strategy_returns or not null_returns:
        return None

    np.random.seed(42)
    s_arr = np.array(strategy_returns)
    n_arr = np.array(null_returns)

    observed_diff = np.mean(s_arr) - np.mean(n_arr)
    combined = np.concatenate([s_arr, n_arr])
    n_s = len(s_arr)
    n_total = len(combined)

    def block_resample(arr, block_size, n_target):
        """Resample بـ blocks"""
        n_blocks = (n_target + block_size - 1) // block_size
        result = []
        for _ in range(n_blocks):
            start = np.random.randint(0, max(1, len(arr) - block_size))
            result.extend(arr[start:start + block_size])
        return np.array(result[:n_target])

    bootstrap_diffs = []
    for _ in range(n_bootstrap):
        s_sample = block_resample(combined, block_size, n_s)
        n_sample = block_resample(combined, block_size, n_total - n_s)
        bootstrap_diffs.append(np.mean(s_sample) - np.mean(n_sample))

    bootstrap_diffs = np.array(bootstrap_diffs)
    p_value = np.sum(bootstrap_diffs >= observed_diff) / n_bootstrap

    return {
        'method': 'block_bootstrap',
        'block_size': block_size,
        'observed_diff': float(observed_diff),
        'p_value': float(p_value * 100),
        'edge': p_value < 0.05,
    }


# ═══════════════════════════════════════════════════════════════════════
# STEP 4: Null Model محسن (نفس الأسهم + نفس الفلاتر + نفس Hold)
# ═══════════════════════════════════════════════════════════════════════

def generate_matched_null_signals(ticker_data, event_signals, start_date, end_date):
    """
    Null Model محسن:
      - لكل event-driven signal، ندخل random entry في نفس السهم + نفس الفترة
      - نفس SL/TGT/Hold
    ده بـ يـلغي أي edge من الـ stock selection
    """
    if not event_signals:
        return []

    np.random.seed(42)
    null_signals = []

    # Group event signals بـ ticker
    by_ticker = defaultdict(list)
    for s in event_signals:
        by_ticker[s['ticker']].append(s)

    for ticker, ticker_signals in by_ticker.items():
        hist = ticker_data.get(ticker, [])
        if len(hist) < 60:
            continue

        closes = [r['close_price'] for r in hist]
        opens = [r['open_price'] for r in hist]
        highs = [r['high_price'] for r in hist]
        lows = [r['low_price'] for r in hist]
        volumes = [r['volume'] or 0 for r in hist]
        dates = [r['date'] for r in hist]

        # لكل event signal، نـعمل n random entries في نفس السهم
        n_random_per_event = 3
        for ev_sig in ticker_signals:
            ev_signal_date = ev_sig['signal_date']

            for _ in range(n_random_per_event):
                # Random entry في أي يوم في نفس السنة
                ev_year = ev_signal_date[:4]
                year_start = f'{ev_year}-01-01'
                year_end = f'{ev_year}-12-31'

                # لاقي indices في نفس السنة
                valid_indices = []
                for i in range(50, len(closes) - 15):
                    if year_start <= dates[i] <= year_end:
                        # فلتر السيولة (نفس condition)
                        avg_vol_20 = sum(volumes[max(0, i-20):i]) / 20 if i >= 20 else 0
                        turnover = avg_vol_20 * closes[i]
                        if turnover >= 50_000_000:  # نفس فلتر الـ event-driven
                            valid_indices.append(i)

                if not valid_indices:
                    continue

                # Random choice
                i = valid_indices[np.random.randint(0, len(valid_indices))]

                # Entry: next-day open
                entry_idx = i + 1
                if entry_idx >= len(closes):
                    continue
                entry = opens[entry_idx]
                entry_date = dates[entry_idx]

                if entry <= 0:
                    continue

                # نفس SL/TGT/Hold
                sl = entry * (1 - 5.0 / 100)
                target = entry * (1 + 15.0 / 100)

                # Exit
                exit_price = None
                exit_date = None
                exit_reason = None
                exit_idx_max = min(entry_idx + 10, len(closes) - 1)

                for j in range(entry_idx + 1, exit_idx_max + 1):
                    if lows[j] <= sl:
                        exit_price = sl
                        exit_date = dates[j]
                        exit_reason = 'STOP_LOSS'
                        break
                    if highs[j] >= target:
                        exit_price = target
                        exit_date = dates[j]
                        exit_reason = 'TARGET'
                        break

                if exit_price is None:
                    exit_price = closes[exit_idx_max]
                    exit_date = dates[exit_idx_max]
                    exit_reason = 'TIME_EXIT'

                gross_ret = ((exit_price - entry) / entry) * 100
                net_ret = gross_ret - 1.0  # COST_RT

                null_signals.append({
                    'ticker': ticker,
                    'signal_date': dates[i],
                    'entry_date': entry_date,
                    'exit_date': exit_date,
                    'entry_price': entry,
                    'exit_price': exit_price,
                    'net_return': net_ret,
                    'exit_reason': exit_reason,
                })

    return null_signals


# ═══════════════════════════════════════════════════════════════════════
# Main validation
# ═══════════════════════════════════════════════════════════════════════

def validate_period(ticker_data, sector_map, period_name, start_date, end_date):
    print(f"\n{'='*100}")
    print(f"  📊 Validation: {period_name} ({start_date} → {end_date})")
    print(f"{'='*100}")

    # Event-driven signals
    event_signals = generate_event_driven_signals(ticker_data, start_date, end_date)
    print(f"\n  📈 Event-driven signals: {len(event_signals)}")

    if not event_signals:
        return {'period': period_name, 'error': 'no event signals'}

    # Step 1: Risk metrics
    print(f"\n  ── STEP 1: Risk Metrics ──")
    event_returns = [s['net_return'] for s in event_signals]
    risk_metrics = calc_risk_metrics(event_returns, f'Event-driven {period_name}')
    print(f"    N: {risk_metrics['n']}")
    print(f"    Mean: {risk_metrics['mean']:+.2f}%")
    print(f"    Std Dev: {risk_metrics['std']:.2f}%")
    print(f"    Sharpe (annualized): {risk_metrics['sharpe']:.2f}")
    print(f"    Sortino (annualized): {risk_metrics['sortino']:.2f}")
    print(f"    Max Drawdown: {risk_metrics['max_drawdown']:.2f}%")
    print(f"    Skewness: {risk_metrics['skewness']:.2f}")
    print(f"    Kurtosis: {risk_metrics['kurtosis']:.2f}")
    print(f"    % Positive: {risk_metrics['pct_positive']:.1f}%")
    print(f"    Worst trade: {risk_metrics['worst_trade']:.2f}%")
    print(f"    Best trade: {risk_metrics['best_trade']:.2f}%")

    # Step 2: Distribution analysis
    print(f"\n  ── STEP 2: Distribution Analysis ──")
    dist = analyze_distribution(event_signals, sector_map)
    print(f"    Total signals: {dist['total_signals']}")
    print(f"    Unique tickers: {dist['unique_tickers']}")
    print(f"    Unique sectors: {dist['unique_sectors']}")
    print(f"    Unique months: {dist['unique_months']}")
    print(f"    Top 10 ticker concentration: {dist['top_10_ticker_concentration_pct']:.1f}%")
    print(f"\n    Top 5 sectors:")
    for s in dist['sector_distribution'][:5]:
        print(f"      {s['sector'][:30]:30s} | {s['n_trades']:>3} trades ({s['pct_of_total']:.1f}%) | mean={s['mean']:+.2f}% | WR={s['win_rate']:.1f}%")
    print(f"\n    Month distribution:")
    for m in dist['month_distribution']:
        print(f"      {m['month']} | {m['n_trades']:>3} trades ({m['pct_of_total']:.1f}%) | mean={m['mean']:+.2f}% | WR={m['win_rate']:.1f}%")

    # Step 4: Matched Null Model
    print(f"\n  ── STEP 4: Matched Null Model (نفس الأسهم + نفس الفلاتر + نفس Hold) ──")
    matched_null = generate_matched_null_signals(ticker_data, event_signals, start_date, end_date)
    print(f"    Matched Null signals: {len(matched_null)}")
    null_returns = [s['net_return'] for s in matched_null]
    null_risk = calc_risk_metrics(null_returns, f'Matched Null {period_name}')
    if null_risk:
        print(f"    Null Mean: {null_risk['mean']:+.2f}%")
        print(f"    Null Std: {null_risk['std']:.2f}%")
        print(f"    Null Sharpe: {null_risk['sharpe']:.2f}")

    # Step 3: p-value (3 methods)
    print(f"\n  ── STEP 3: p-value Methods ──")

    # Method 1: Normal Approximation (t-test)
    pv_normal = pvalue_normal_approx(event_returns, null_returns)
    if pv_normal:
        print(f"    Normal Approx: t={pv_normal['t_stat']:.2f}, p={pv_normal['p_value']:.1f}%, edge={pv_normal['edge']}")

    # Method 2: Bootstrap
    pv_bootstrap = pvalue_bootstrap(event_returns, null_returns, n_bootstrap=5000)
    if pv_bootstrap:
        print(f"    Bootstrap: observed_diff={pv_bootstrap['observed_diff']:+.2f}%, p={pv_bootstrap['p_value']:.1f}%, CI95=[{pv_bootstrap['ci_95'][0]:+.2f}, {pv_bootstrap['ci_95'][1]:+.2f}], edge={pv_bootstrap['edge']}")

    # Method 3: Block Bootstrap
    pv_block = pvalue_block_bootstrap(event_returns, null_returns, block_size=10, n_bootstrap=5000)
    if pv_block:
        print(f"    Block Bootstrap (block=10): p={pv_block['p_value']:.1f}%, edge={pv_block['edge']}")

    return {
        'period': period_name,
        'start_date': start_date,
        'end_date': end_date,
        'n_event_signals': len(event_signals),
        'risk_metrics': risk_metrics,
        'distribution': dist,
        'matched_null_n': len(matched_null),
        'matched_null_risk': null_risk,
        'pvalue_normal': pv_normal,
        'pvalue_bootstrap': pv_bootstrap,
        'pvalue_block_bootstrap': pv_block,
    }


def main():
    print(f"\n{'#'*100}")
    print(f"  🔬 EVENT-DRIVEN STATISTICAL VALIDATION")
    print(f"  Steps: Risk Metrics + Distribution + p-value (3 methods) + Matched Null + Extended Periods")
    print(f"{'#'*100}")

    # Load data (من 2022 لـ 2026 عشان نـtest 4 سنين)
    ticker_data = load_ticker_data(start_date='2022-01-01', end_date='2026-10-18')
    sector_map = load_sector_map()
    print(f"\n  Sector map: {len(sector_map)} tickers")

    # Validate on 4 periods
    results = []
    # 2026 (Sep-Oct)
    results.append(validate_period(ticker_data, sector_map, '2026', '2026-01-01', '2026-10-18'))
    # 2025
    results.append(validate_period(ticker_data, sector_map, '2025', '2025-01-01', '2025-12-31'))
    # 2024
    results.append(validate_period(ticker_data, sector_map, '2024', '2024-01-01', '2024-12-31'))
    # 2023 (لو في data)
    try:
        results.append(validate_period(ticker_data, sector_map, '2023', '2023-01-01', '2023-12-31'))
    except Exception as e:
        print(f"\n  ⚠️ 2023 skipped: {e}")

    # Final summary
    print(f"\n{'='*120}")
    print(f"  🎯 FINAL STATISTICAL VALIDATION SUMMARY")
    print(f"{'='*120}")
    print(f"\n  {'Period':10s} | {'N':>5} | {'Mean':>7} | {'Std':>6} | {'Sharpe':>7} | {'Sortino':>8} | {'MaxDD':>7} | {'Null Mean':>9} | {'p_normal':>9} | {'p_boot':>7} | {'p_block':>8} | {'Edge?':>6}")
    print(f"  {'-'*115}")

    for r in results:
        if 'error' in r:
            print(f"  {r['period']:10s} | {r['error']}")
            continue
        rm = r.get('risk_metrics') or {}
        nr = r.get('matched_null_risk') or {}
        pn = r.get('pvalue_normal') or {}
        pb = r.get('pvalue_bootstrap') or {}
        pblk = r.get('pvalue_block_bootstrap') or {}

        n = rm.get('n', 0)
        mean = f"{rm.get('mean', 0):+.2f}%" if rm else 'N/A'
        std = f"{rm.get('std', 0):.2f}%" if rm else 'N/A'
        sharpe = f"{rm.get('sharpe', 0):.2f}" if rm else 'N/A'
        sortino = f"{rm.get('sortino', 0):.2f}" if rm else 'N/A'
        maxdd = f"{rm.get('max_drawdown', 0):.2f}%" if rm else 'N/A'
        null_mean = f"{nr.get('mean', 0):+.2f}%" if nr else 'N/A'
        p_norm = f"{pn.get('p_value', 0):.1f}%" if pn else 'N/A'
        p_boot = f"{pb.get('p_value', 0):.1f}%" if pb else 'N/A'
        p_block = f"{pblk.get('p_value', 0):.1f}%" if pblk else 'N/A'

        # Edge = True لو أي method قالت p < 5%
        edge = '✅' if (pn.get('edge') or pb.get('edge') or pblk.get('edge')) else '❌'

        print(f"  {r['period']:10s} | {n:>5} | {mean:>7} | {std:>6} | {sharpe:>7} | {sortino:>8} | {maxdd:>7} | {null_mean:>9} | {p_norm:>9} | {p_boot:>7} | {p_block:>8} | {edge:>6}")

    print(f"\n{'='*120}")

    # Save JSON
    output_path = PROJECT / 'vps-service' / 'backtest_results' / f'event_driven_validation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'results': results,
        }, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 JSON saved: {output_path}")


if __name__ == '__main__':
    main()
