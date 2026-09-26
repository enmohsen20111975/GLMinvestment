#!/usr/bin/env python3
"""
V40.2 Detailed Backtest — تحليل تفصيلي لرفع كفاءة التوقعات
============================================================
تحليل عميق لـ V40.2 على فترة كاملة (6 شهور) بكل الـ tickers.
مش بس metrics aggregate، ده per-trade + per-ticker + per-exit-reason analysis.

الهدف: نحدد بالظبط فين المشاكل عشان نرفع كفاءة V40.2.

Outputs:
1. metrics aggregate (WR, PF, MaxDD, Total Return)
2. per-trade details (entry, target, stop, return, exit_type)
3. per-ticker breakdown (أحسن وأسوأ الأسهم)
4. per-exit-reason (target_hit vs stop_loss vs trailing)
5. losers analysis (ليه خسرنا؟ stop wide? entry bad? regime bear?)
6. winners analysis (ليه كسبنا؟ sector? explosive? news boost?)
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter

PROJECT_ROOT = Path('/home/z/my-project')
GLM_ROOT = PROJECT_ROOT / 'GLMinvestment'
V40_2_SCRIPT = GLM_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = GLM_ROOT / 'db' / 'vps_real' / 'predictions.db'
TEMP_DIR = GLM_ROOT / 'data' / 'v402_detailed_backtest'
RESULTS_DIR = GLM_ROOT / 'data' / 'merge_backtest_real'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MAX_TICKERS = '235'
PYTHON = sys.executable


def setup_temp_db(label: str) -> Path:
    """إنشاء temp DB للـ run."""
    temp_db = TEMP_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()
    src = sqlite3.connect(str(PREDICTIONS_DB))
    dst = sqlite3.connect(str(temp_db))
    src.backup(dst)
    dst.close()
    src.close()
    temp_db.chmod(0o644)
    c = sqlite3.connect(str(temp_db))
    try:
        c.execute('DELETE FROM predictions')
        c.commit()
    except Exception as e:
        print(f"  ⚠ DELETE failed: {e}")
    c.close()
    return temp_db


def run_v40_2(label: str, env_overrides: dict) -> tuple[dict, Path]:
    """تشغيل V40.2 backtest."""
    temp_db = setup_temp_db(label)

    env = os.environ.copy()
    for f in ['V40_2_REGIME_FILTER', 'V40_2_REGIME_MODE', 'V40_2_STRICT_ENTRY',
              'V40_2_DISCLOSURE_IMPACT', 'V40_2_NOTEBOOK_CONTEXT', 'V40_2_NEWS_IMPACT',
              'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT', 'V40_2_EXPERT_RECS']:
        env[f] = '0'
    env.update({
        'V40_2_BACKTEST_MODE': '1',
        'V40_2_SKIP_NEWS': '1',
        'BYPASS_PRED_CAP': '1',
        'V40_2_PREDICTIONS_DB': str(temp_db),
        'DATA_ENGINE_DB': str(GLM_ROOT / 'db' / 'data_engine.db'),
        'PYTHONPATH': str(GLM_ROOT / 'vps-service'),
    })
    env.update(env_overrides)

    cmd = [PYTHON, str(V40_2_SCRIPT),
           '--start', START_DATE, '--end', END_DATE,
           '--scan-interval', '1', '--max-tickers', MAX_TICKERS]

    print(f"\n[{label}] running V40.2 ({START_DATE}→{END_DATE}, {MAX_TICKERS} tickers)...")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=900)
    dt = time.time() - t0

    # Save stdout
    log_path = TEMP_DIR / f'{label}_stdout.log'
    log_path.write_text(proc.stdout, encoding='utf-8')

    metrics = {'label': label, 'runtime_sec': round(dt, 1), 'db_path': str(temp_db), 'log_path': str(log_path)}
    return metrics, temp_db


def detailed_analysis(db_path: Path, label: str) -> dict:
    """تحليل تفصيلي للـ predictions في الـ DB."""
    if not db_path.exists():
        return {'label': label, 'error': 'DB missing'}

    c = sqlite3.connect(str(db_path))
    c.row_factory = sqlite3.Row

    try:
        rows = c.execute('''
            SELECT ticker, signal, signal_type, prediction_date, outcome_date,
                   entry_price, target_price, stop_loss, actual_return, exit_type, is_correct,
                   score, confidence, persona, morning_bell
            FROM predictions
            WHERE prediction_date BETWEEN ? AND ?
            ORDER BY prediction_date, ticker
        ''', (START_DATE, END_DATE)).fetchall()
    except Exception as e:
        c.close()
        return {'label': label, 'error': str(e)}

    if not rows:
        c.close()
        return {'label': label, 'trades': 0, 'message': 'لا توجد صفقات'}

    trades = []
    for r in rows:
        ret = float(r['actual_return']) if r['actual_return'] is not None else 0.0
        holding = 0
        try:
            if r['prediction_date'] and r['outcome_date']:
                p = r['prediction_date'].split('T')[0]
                o = r['outcome_date'].split('T')[0]
                holding = (datetime.fromisoformat(o) - datetime.fromisoformat(p)).days
        except Exception:
            pass
        trades.append({
            'ticker': r['ticker'],
            'signal': r['signal'],
            'prediction_date': r['prediction_date'],
            'entry_price': r['entry_price'],
            'target_price': r['target_price'],
            'stop_loss': r['stop_loss'],
            'return_pct': ret,
            'exit_type': r['exit_type'] or 'unknown',
            'is_correct': r['is_correct'],
            'score': r['score'],
            'holding_days': max(holding, 0),
            'persona': r['persona'],
            'morning_bell': r['morning_bell'],
        })

    n = len(trades)
    rets = [t['return_pct'] for t in trades]
    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] <= 0]
    gross_win = sum(t['return_pct'] for t in wins)
    gross_loss = abs(sum(t['return_pct'] for t in losses))
    pf = (gross_win / gross_loss) if gross_loss > 0 else (float('inf') if gross_win > 0 else 0)

    equity = 1.0
    peak = 1.0
    max_dd = 0
    for r in rets:
        equity *= (1 + r / 100)
        peak = max(peak, equity)
        dd = (equity / peak - 1) * 100
        max_dd = min(max_dd, dd)
    total_ret = (equity - 1) * 100

    # Per-ticker breakdown
    per_ticker = defaultdict(list)
    for t in trades:
        per_ticker[t['ticker']].append(t['return_pct'])
    ticker_stats = []
    for tk, rets_list in per_ticker.items():
        ticker_stats.append({
            'ticker': tk,
            'trades': len(rets_list),
            'wins': sum(1 for r in rets_list if r > 0),
            'win_rate': round(sum(1 for r in rets_list if r > 0) / len(rets_list) * 100, 1),
            'avg_return': round(sum(rets_list) / len(rets_list), 2),
            'total_return': round(sum(rets_list), 2),
        })
    ticker_stats.sort(key=lambda x: x['total_return'])

    # Per-exit-type
    exit_types = Counter(t['exit_type'] for t in trades)

    # Per-month
    per_month = defaultdict(lambda: {'trades': 0, 'wins': 0, 'return': 0})
    for t in trades:
        month = (t['prediction_date'] or '')[:7]
        per_month[month]['trades'] += 1
        if t['return_pct'] > 0:
            per_month[month]['wins'] += 1
        per_month[month]['return'] += t['return_pct']

    # Winners analysis (top 5)
    winners = sorted(trades, key=lambda t: -t['return_pct'])[:5]
    # Losers analysis (bottom 5)
    losers = sorted(trades, key=lambda t: t['return_pct'])[:5]

    # Holding days distribution
    holding_buckets = {'1-3': 0, '4-7': 0, '8-14': 0, '15+': 0}
    for t in trades:
        d = t['holding_days']
        if d <= 3:
            holding_buckets['1-3'] += 1
        elif d <= 7:
            holding_buckets['4-7'] += 1
        elif d <= 14:
            holding_buckets['8-14'] += 1
        else:
            holding_buckets['15+'] += 1

    c.close()

    return {
        'label': label,
        'trades': n,
        'wins': len(wins),
        'losses': len(losses),
        'win_rate_pct': round(len(wins) / n * 100, 2) if n else 0,
        'avg_return_pct': round(sum(rets) / n, 3) if n else 0,
        'avg_winner_pct': round(gross_win / len(wins), 2) if wins else 0,
        'avg_loser_pct': round(-gross_loss / len(losses), 2) if losses else 0,
        'total_return_pct': round(total_ret, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.99,
        'avg_holding_days': round(sum(t['holding_days'] for t in trades) / n, 1) if n else 0,
        'exit_types': dict(exit_types),
        'per_ticker_count': len(per_ticker),
        'best_tickers': ticker_stats[-5:],
        'worst_tickers': ticker_stats[:5],
        'per_month': dict(per_month),
        'winners_top5': [
            {'ticker': w['ticker'], 'return_pct': w['return_pct'], 'exit_type': w['exit_type'],
             'holding_days': w['holding_days'], 'entry': w['entry_price'], 'target': w['target_price']}
            for w in winners
        ],
        'losers_bottom5': [
            {'ticker': l['ticker'], 'return_pct': l['return_pct'], 'exit_type': l['exit_type'],
             'holding_days': l['holding_days'], 'entry': l['entry_price'], 'stop': l['stop_loss']}
            for l in losers
        ],
        'holding_buckets': holding_buckets,
    }


def main():
    print("=" * 100)
    print("V40.2 DETAILED BACKTEST — تحليل تفصيلي لرفع كفاءة التوقعات")
    print(f"الفترة: {START_DATE} → {END_DATE} (6 شهور) | الكون: {MAX_TICKERS} سهم")
    print("=" * 100)

    # Run V40.2 baseline (without news, without expert recs - عشان نقيس V40.2 نفسه)
    run_meta, temp_db = run_v40_2('v40_2_baseline', {
        'V40_2_NEWS_IMPACT': '0',
        'V40_2_SKIP_NEWS': '1',
        'V40_2_EXPERT_RECS': '0',
    })

    # Detailed analysis
    print("\n" + "=" * 100)
    print("DETAILED ANALYSIS")
    print("=" * 100)
    result = detailed_analysis(temp_db, 'v40_2_baseline')

    # Print summary
    print(f"\n📊 AGGREGATE METRICS:")
    print(f"  Trades: {result.get('trades', 0)}")
    print(f"  Win Rate: {result.get('win_rate_pct', 0)}%")
    print(f"  Avg Return/Trade: {result.get('avg_return_pct', 0):+.3f}%")
    print(f"  Avg Winner: +{result.get('avg_winner_pct', 0)}%")
    print(f"  Avg Loser: {result.get('avg_loser_pct', 0)}%")
    print(f"  Total Return: {result.get('total_return_pct', 0):+.2f}%")
    print(f"  Max Drawdown: {result.get('max_drawdown_pct', 0):+.2f}%")
    print(f"  Profit Factor: {result.get('profit_factor', 0)}")
    print(f"  Avg Holding: {result.get('avg_holding_days', 0)} days")

    print(f"\n📈 EXIT TYPES:")
    for et, cnt in sorted(result.get('exit_types', {}).items(), key=lambda x: -x[1]):
        print(f"  {et:25s}: {cnt}")

    print(f"\n📅 PER MONTH:")
    for month, stats in sorted(result.get('per_month', {}).items()):
        wr = (stats['wins'] / stats['trades'] * 100) if stats['trades'] else 0
        print(f"  {month}: {stats['trades']} trades | WR={wr:.1f}% | return={stats['return']:+.2f}%")

    print(f"\n⏱️ HOLDING DAYS DISTRIBUTION:")
    for bucket, cnt in result.get('holding_buckets', {}).items():
        pct = (cnt / result.get('trades', 1) * 100) if result.get('trades') else 0
        print(f"  {bucket:5s} days: {cnt} ({pct:.1f}%)")

    print(f"\n🏆 TOP 5 WINNERS:")
    for w in result.get('winners_top5', []):
        print(f"  {w['ticker']:6s} | +{w['return_pct']:.2f}% | {w['exit_type']:15s} | {w['holding_days']}d | entry={w['entry']}")

    print(f"\n💀 BOTTOM 5 LOSERS:")
    for l in result.get('losers_bottom5', []):
        print(f"  {l['ticker']:6s} | {l['return_pct']:.2f}% | {l['exit_type']:15s} | {l['holding_days']}d | entry={l['entry']} | stop={l['stop']}")

    print(f"\n🎯 PER-TICKER STATS ({result.get('per_ticker_count', 0)} unique tickers):")
    print(f"\n  Worst 5 tickers:")
    for t in result.get('worst_tickers', []):
        print(f"    {t['ticker']:6s} | {t['trades']} trades | WR={t['win_rate']}% | total={t['total_return']:+.2f}%")
    print(f"\n  Best 5 tickers:")
    for t in result.get('best_tickers', []):
        print(f"    {t['ticker']:6s} | {t['trades']} trades | WR={t['win_rate']}% | total={t['total_return']:+.2f}%")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 DETAILED BACKTEST (production baseline)',
            'window': f'{START_DATE} → {END_DATE}',
            'universe': f'{MAX_TICKERS} EGX tickers',
            'flags': 'baseline only (no news, no expert recs)',
            'goal': 'تحديد فين المشاكل في V40.2 عشان نرفع كفاءة التوقعات',
        },
        'results': result,
        'timestamp': datetime.now().isoformat(),
    }
    out = RESULTS_DIR / 'v402_detailed_backtest.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved → {out}")
    print(f"📁 Stdout log → {run_meta.get('log_path')}")


if __name__ == '__main__':
    main()
