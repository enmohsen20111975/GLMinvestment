#!/usr/bin/env python3
"""
V40.1 Position Sizing Comparison
=================================
Recomputes backtest metrics WITH position sizing (fixed fractional risk)
vs WITHOUT (full capital per trade — the old behavior).

Key insight: Position Sizing does NOT change which trades are taken.
It changes HOW we measure risk-adjusted performance:
  - Old: equity_change = return_pct / 100  (assumes 100% capital per trade)
  - New: equity_change = (risk_pct * R_multiple) / 100  (fixed 1.5% risk per trade)

R_multiple = (exit - entry) / (entry - stop)
  → losing at stop = -1R  (you lose exactly your risk: 1.5%)
  → winning at 2R target = +2R (you gain 2 × risk = 3.0%)
"""
import json
import math
from collections import Counter

TRADES_PATH = '/home/z/my-project/vps-service/backtest_results/v40_backtest_egx_all_trades.json'
RISK_PCT = 1.5  # fixed fractional risk per trade

def compute_r_multiple(t):
    """R = (exit-entry)/(entry-stop), derived from return_pct (price return)."""
    entry = t.get('entry_price', 0)
    stop = t.get('stop_loss', 0)
    if entry > 0 and stop < entry:
        stop_distance = entry - stop
        return (t.get('return_pct', 0) / 100.0) * (entry / stop_distance)
    return 0.0

def compute_stats(trades, use_position_sizing):
    """Compute all metrics. If use_position_sizing, use pnl_pct=risk*R; else return_pct."""
    total = len(trades)
    if total == 0:
        return {'total_trades': 0}

    # Determine the per-trade equity impact
    impacts = []
    r_multiples = []
    for t in trades:
        r = compute_r_multiple(t)
        r_multiples.append(r)
        if use_position_sizing:
            impacts.append(RISK_PCT * r)
        else:
            impacts.append(t.get('return_pct', 0))

    winning = [impacts[i] for i, t in enumerate(trades) if t.get('is_win', False)]
    losing = [impacts[i] for i, t in enumerate(trades) if not t.get('is_win', False)]
    win_count = len(winning)
    lose_count = len(losing)
    win_rate = win_count / total * 100

    gross_profit = sum(winning)
    gross_loss = abs(sum(losing))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    avg_win = gross_profit / win_count if win_count > 0 else 0
    avg_loss = gross_loss / lose_count if lose_count > 0 else 0
    avg_return = sum(impacts) / total
    avg_r_multiple = sum(r_multiples) / total

    # Equity curve (compounded)
    equity = [100.0]
    peak = 100.0
    max_dd = 0.0
    for imp in impacts:
        equity.append(equity[-1] * (1 + imp / 100))
        peak = max(peak, equity[-1])
        dd = (peak - equity[-1]) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)
    final_equity = equity[-1]

    # Sharpe (annualized, simplified)
    if len(impacts) > 1:
        avg_ret = sum(impacts) / len(impacts)
        variance = sum((r - avg_ret) ** 2 for r in impacts) / (len(impacts) - 1)
        std_ret = math.sqrt(variance) if variance > 0 else 1.0
        sharpe = (avg_ret / std_ret) * math.sqrt(252) if std_ret > 0 else 0
    else:
        sharpe = 0

    # Calmar
    calmar = 0.0
    if max_dd > 0:
        holding = [t.get('holding_days', 0) for t in trades if t.get('holding_days', 0) > 0]
        avg_hold = sum(holding) / len(holding) if holding else 1
        annual_return = avg_return * 252 / avg_hold
        calmar = annual_return / max_dd

    holding = [t.get('holding_days', 0) for t in trades if t.get('holding_days', 0) > 0]
    avg_holding = sum(holding) / len(holding) if holding else 0
    exit_reasons = Counter(t.get('exit_reason', 'unknown') for t in trades)
    unique_tickers = len(set(t.get('ticker', '') for t in trades))
    dates = sorted(set(t.get('entry_date', '') for t in trades if t.get('entry_date')))

    return {
        'total_trades': total,
        'unique_tickers': unique_tickers,
        'win_rate': round(win_rate, 2),
        'profit_factor': round(profit_factor, 3),
        'avg_win': round(avg_win, 3),
        'avg_loss': round(avg_loss, 3),
        'avg_return': round(avg_return, 4),
        'avg_r_multiple': round(avg_r_multiple, 4),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'sharpe_ratio': round(sharpe, 2),
        'calmar_ratio': round(calmar, 3),
        'avg_holding_days': round(avg_holding, 1),
        'final_equity': round(final_equity, 2),
        'total_return_compound': round(final_equity - 100, 2),
        'exit_reasons': dict(exit_reasons),
        'date_range': f"{dates[0] if dates else 'N/A'} → {dates[-1] if dates else 'N/A'}",
        'scan_dates': len(dates),
    }

def print_comparison(label, old_stats, new_stats):
    print("=" * 105)
    print(f"{label}")
    print("=" * 105)
    print(f"{'Metric':<32} {'بدون Position Sizing':>22} {'مع Position Sizing':>22} {'التغيير':>18}")
    print("-" * 105)
    metrics = [
        ('Total trades', 'total_trades', 'int'),
        ('Unique tickers', 'unique_tickers', 'int'),
        ('Win rate %', 'win_rate', 'float'),
        ('Profit factor', 'profit_factor', 'float'),
        ('Avg win % (equity impact)', 'avg_win', 'float'),
        ('Avg loss % (equity impact)', 'avg_loss', 'float'),
        ('Avg R-multiple', 'avg_r_multiple', 'float'),
        ('Avg return % (per trade)', 'avg_return', 'float'),
        ('Gross profit', 'gross_profit', 'float'),
        ('Gross loss', 'gross_loss', 'float'),
        ('Max drawdown %', 'max_drawdown_pct', 'float'),
        ('Sharpe ratio', 'sharpe_ratio', 'float'),
        ('Calmar ratio', 'calmar_ratio', 'float'),
        ('Final equity (start=100)', 'final_equity', 'float'),
        ('Total return (compound) %', 'total_return_compound', 'float'),
        ('Avg holding days', 'avg_holding_days', 'float'),
    ]
    for lbl, key, typ in metrics:
        o = old_stats.get(key, 0)
        n = new_stats.get(key, 0)
        d = n - o if isinstance(n, (int, float)) and isinstance(o, (int, float)) else 'N/A'
        if typ == 'float':
            print(f"{lbl:<32} {o:>22.3f} {n:>22.3f} {d:>+18.3f}")
        else:
            print(f"{lbl:<32} {o:>22} {n:>22} {d:>+18}")

def main():
    with open(TRADES_PATH) as f:
        all_trades = json.load(f)

    # Same period as V39.3 v3 baseline (2026-02-01 → 2026-06-08)
    same_period = [t for t in all_trades if '2026-02-01' <= t.get('entry_date', '') <= '2026-06-08']

    print(f"Loaded {len(all_trades)} V40-new trades (full period)")
    print(f"Same-period (2026-02-01 → 2026-06-08): {len(same_period)} trades")
    print(f"Risk per trade: {RISK_PCT}%\n")

    # Compute stats
    old_full = compute_stats(all_trades, use_position_sizing=False)
    new_full = compute_stats(all_trades, use_position_sizing=True)
    old_sp = compute_stats(same_period, use_position_sizing=False)
    new_sp = compute_stats(same_period, use_position_sizing=True)

    print_comparison("SAME PERIOD (2026-02-01 → 2026-06-08)", old_sp, new_sp)
    print()
    print_comparison("FULL PERIOD (2025-06-01 → 2026-06-08)", old_full, new_full)

    # Save report
    report = {
        'risk_per_trade_pct': RISK_PCT,
        'methodology': 'Position Sizing: each trade risks fixed 1.5% of equity. '
                       'pnl_pct = risk_pct × R_multiple. R_multiple = (exit-entry)/(entry-stop). '
                       'Losing at stop = -1R = -1.5% equity. Winning at 2R target = +2R = +3.0% equity.',
        'same_period': {'without_position_sizing': old_sp, 'with_position_sizing': new_sp},
        'full_period': {'without_position_sizing': old_full, 'with_position_sizing': new_full},
    }
    out_path = '/home/z/my-project/vps-service/backtest_results/v40_position_sizing_comparison.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Comparison saved: {out_path}")

    # Markdown report
    md = generate_markdown(old_sp, new_sp, old_full, new_full)
    md_path = '/home/z/my-project/vps-service/backtest_results/V40_POSITION_SIZING_REPORT.md'
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md)
    print(f"📄 Markdown report: {md_path}")

def generate_markdown(old_sp, new_sp, old_full, new_full):
    def table(old, new, title):
        rows = [
            ('Win Rate %', 'win_rate'),
            ('Profit Factor', 'profit_factor'),
            ('Avg Win % (equity)', 'avg_win'),
            ('Avg Loss % (equity)', 'avg_loss'),
            ('Avg R-multiple', 'avg_r_multiple'),
            ('Max Drawdown %', 'max_drawdown_pct'),
            ('Sharpe Ratio', 'sharpe_ratio'),
            ('Calmar Ratio', 'calmar_ratio'),
            ('Final Equity (start=100)', 'final_equity'),
            ('Total Return (compound) %', 'total_return_compound'),
        ]
        out = f"### {title}\n\n"
        out += "| Metric | بدون Position Sizing | مع Position Sizing (1.5% risk) | التغيير |\n"
        out += "|--------|---------------------|-------------------------------|---------|\n"
        for label, key in rows:
            o = old.get(key, 0)
            n = new.get(key, 0)
            d = n - o
            out += f"| {label} | {o:.3f} | {n:.3f} | {d:+.3f} |\n"
        return out

    md = "# V40.1 Position Sizing — تقرير المقارنة\n\n"
    md += f"**نسبة المخاطرة لكل صفقة:** {RISK_PCT}% من رأس المال\n\n"
    md += "**المنهجية:** كل صفقة تخاطر بنسبة ثابتة (1.5%) من رأس المال. "
    md += "حجم المركز يُحسب من المسافة بين سعر الدخول والستوب. "
    md += "تأثير الصفقة على رأس المال = `risk_pct × R-multiple`.\n\n"
    md += "- خسارة عند الستوب = -1R = -1.5% من رأس المال\n"
    md += "- ربح عند هدف 2R = +2R = +3.0% من رأس المال\n\n"
    md += "---\n\n"
    md += table(old_sp, new_sp, "نفس الفترة (2026-02-01 → 2026-06-08)")
    md += "\n"
    md += table(old_full, new_full, "الفترة الكاملة (2025-06-01 → 2026-06-08)")
    md += "\n---\n\n"
    md += "## الخلاصة\n\n"
    md += f"- **Max Drawdown** انخفض من **{old_full['max_drawdown_pct']:.2f}%** إلى **{new_full['max_drawdown_pct']:.2f}%** "
    md += f"(تحسّن بمقدار {old_full['max_drawdown_pct'] - new_full['max_drawdown_pct']:.2f} نقطة)\n"
    md += f"- **Profit Factor** تغيّر من **{old_full['profit_factor']:.3f}** إلى **{new_full['profit_factor']:.3f}**\n"
    md += f"- **Avg Win** (تأثير رأس المال) = **+{new_full['avg_win']:.3f}%** | **Avg Loss** = **{new_full['avg_loss']:.3f}%**\n"
    md += f"- **Final Equity** = **{new_full['final_equity']:.2f}** (عائد مركب {new_full['total_return_compound']:+.2f}%)\n"
    return md

if __name__ == '__main__':
    main()
