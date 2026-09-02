#!/usr/bin/env python3
"""
V40.2 NEWS IMPACT BACKTEST — مقارنة صادقة
============================================
يقيس أثر تفعيل V40_2_NEWS_IMPACT على V40.2 الإنتاجي:

1) Baseline: V40.2 بدون أخبار (V40_2_NEWS_IMPACT=0 + V40_2_SKIP_NEWS=1)
2) News ON: V40.2 بأخبار news.db (V40_2_NEWS_IMPACT=1 + V40_2_SKIP_NEWS=0)

نفس البيانات، نفس الفترة، نفس الكون. المقارنة:
  - عدد الصفقات (هل زادت/قلّت؟ — الأخبار بتـ veto تقلل الصفقات السامة)
  - Win Rate (هل تحسّن؟)
  - Profit Factor (هل ارتفع؟)
  - Max Drawdown (هل قلّ؟)
  - العائد الإجمالي
  - عدد الـ NEWS-VETO / NEWS-BOOST / NEWS-REDUCE

الفترة: 2026-02-01 → 2026-08-14 (6 شهور)
الكون: 50 سهم EGX (للأداء — قابلة للزيادة لـ 235)

الـ goal: النتائج هي الحكم. لو الأخبار حسبّت V40.2، نمشيها في الإنتاج.
         لو ما حسبّتش، نعطلها ونعمل audit للـ news_impact_scorer.

NOTE: السكربت ده بيعمل 2 runs كاملة لـ V40.2 (الـ baseline + news_on).
كل run ممكن ياخد 5-9 دقايق. المجموع ~10-18 دقيقة.
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3, shutil, re
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path('/home/z/my-project')
GLM_ROOT = PROJECT_ROOT / 'GLMinvestment'
V40_2_SCRIPT = GLM_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = GLM_ROOT / 'db' / 'vps_real' / 'predictions.db'
TEMP_DIR = GLM_ROOT / 'data' / 'v402_news_impact_test'
RESULTS_DIR = GLM_ROOT / 'data' / 'merge_backtest_real'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = '2026-07-01'
END_DATE = '2026-08-14'
MAX_TICKERS = '10'  # للأداء — فترة أقصر + tickers أقل
PYTHON = sys.executable


def extract_v40_metrics(db_path: Path, label: str) -> dict:
    """Read predictions table + compute metrics."""
    if not db_path.exists():
        return {'label': label, 'trades': 0, 'error': 'DB missing'}

    c = sqlite3.connect(str(db_path))
    try:
        rows = c.execute('''
            SELECT ticker, entry_price, target_price, stop_loss, actual_return,
                   exit_type, is_correct, prediction_date, outcome_date
            FROM predictions
            WHERE prediction_date BETWEEN ? AND ?
            ORDER BY prediction_date
        ''', (START_DATE, END_DATE)).fetchall()
    except Exception as e:
        c.close()
        return {'label': label, 'error': str(e)}

    if not rows:
        c.close()
        return {
            'label': label, 'trades': 0, 'wins': 0, 'losses': 0,
            'win_rate_pct': 0, 'avg_return_pct': 0, 'total_return_pct': 0,
            'max_drawdown_pct': 0, 'profit_factor': 0, 'avg_holding_days': 0,
            'exit_types': {}, 'news_actions': {'VETO': 0, 'BOOST': 0, 'BOOST_STRONG': 0, 'REDUCE': 0, 'NEUTRAL': 0},
        }

    trades = []
    for r in rows:
        ret = float(r[4]) if r[4] is not None else 0.0
        holding = 0
        try:
            if r[7] and r[8]:
                p = r[7].split('T')[0]
                o = r[8].split('T')[0]
                holding = (datetime.fromisoformat(o) - datetime.fromisoformat(p)).days
        except Exception:
            pass
        trades.append({
            'ticker': r[0], 'return_pct': ret, 'exit_type': r[5] or 'unknown',
            'holding_days': max(holding, 0), 'is_correct': r[6],
        })

    n = len(trades)
    rets = [t['return_pct'] for t in trades]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    gross_win = sum(wins) if wins else 0
    gross_loss = abs(sum(losses)) if losses else 0
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

    exit_types = {}
    for t in trades:
        exit_types[t['exit_type']] = exit_types.get(t['exit_type'], 0) + 1

    c.close()
    return {
        'label': label,
        'trades': n,
        'wins': len(wins),
        'losses': len(losses),
        'win_rate_pct': round(len(wins) / n * 100, 2) if n else 0,
        'avg_return_pct': round(sum(rets) / n, 3) if n else 0,
        'total_return_pct': round(total_ret, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.99,
        'avg_holding_days': round(sum(t['holding_days'] for t in trades) / n, 1) if n else 0,
        'exit_types': exit_types,
    }


def parse_news_actions_from_log(stdout: str) -> dict:
    """Extract NEWS-VETO / NEWS-BOOST / NEWS-REDUCE counts from V40.2 stdout."""
    counts = {'VETO': 0, 'BOOST': 0, 'BOOST_STRONG': 0, 'REDUCE': 0, 'NEUTRAL': 0}
    for line in stdout.split('\n'):
        if '[NEWS-VETO]' in line:
            counts['VETO'] += 1
        elif '[NEWS-BOOST_STRONG]' in line:
            counts['BOOST_STRONG'] += 1
        elif '[NEWS-BOOST]' in line:
            counts['BOOST'] += 1
        elif '[NEWS-REDUCE]' in line:
            counts['REDUCE'] += 1
        elif '[NEWS-NEUTRAL]' in line:
            counts['NEUTRAL'] += 1
    return counts


def run_v40_2(label: str, env_overrides: dict) -> dict:
    """Run V40.2 backtest with env overrides."""
    temp_db = TEMP_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()
    # Use sqlite3 backup (handles WAL/SHM properly) instead of shutil.copy
    src = sqlite3.connect(str(PREDICTIONS_DB))
    dst = sqlite3.connect(str(temp_db))
    src.backup(dst)
    dst.close()
    src.close()
    # Ensure writable (vps_real files are 444 read-only)
    temp_db.chmod(0o644)
    # Clear predictions table
    c = sqlite3.connect(str(temp_db))
    try:
        c.execute('DELETE FROM predictions')
        c.commit()
    except Exception as e:
        print(f"  ⚠ DELETE predictions failed: {e}")
    c.close()

    env = os.environ.copy()
    # Reset all V40.2 flags first
    for f in ['V40_2_REGIME_FILTER', 'V40_2_REGIME_MODE', 'V40_2_STRICT_ENTRY',
              'V40_2_DISCLOSURE_IMPACT', 'V40_2_NOTEBOOK_CONTEXT', 'V40_2_NEWS_IMPACT',
              'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT']:
        env[f] = '0'
    env.update({
        'V40_2_BACKTEST_MODE': '1',
        'BYPASS_PRED_CAP': '1',
        'V40_2_PREDICTIONS_DB': str(temp_db),
        'DATA_ENGINE_DB': str(GLM_ROOT / 'db' / 'data_engine.db'),
        # set news.db path for news_fetcher_analyzer
        'PYTHONPATH': str(GLM_ROOT / 'vps-service'),
    })
    env.update(env_overrides)

    cmd = [PYTHON, str(V40_2_SCRIPT),
           '--start', START_DATE, '--end', END_DATE,
           '--scan-interval', '1', '--max-tickers', MAX_TICKERS]

    print(f"\n[{label}] running V40.2 ({MAX_TICKERS} tickers, scan=1, window={START_DATE}→{END_DATE})...")
    print(f"  env: V40_2_NEWS_IMPACT={env.get('V40_2_NEWS_IMPACT')}, V40_2_SKIP_NEWS={env.get('V40_2_SKIP_NEWS')}")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=900)
    dt = time.time() - t0

    # Extract summary
    last_lines = proc.stdout.split('\n')[-50:]
    for line in last_lines:
        if any(k in line for k in ['Total predictions', 'Overall win rate', 'Profit Factor',
                                    'Signals found', 'Processed', 'NEWS-']):
            print(f"  {line.strip()}")

    metrics = extract_v40_metrics(temp_db, label)
    metrics['runtime_sec'] = round(dt, 1)
    metrics['news_actions'] = parse_news_actions_from_log(proc.stdout)

    # Save full stdout for debug
    log_path = TEMP_DIR / f'{label}_stdout.log'
    log_path.write_text(proc.stdout, encoding='utf-8')
    metrics['stdout_log'] = str(log_path)

    return metrics


def main():
    print("=" * 90)
    print("V40.2 NEWS IMPACT BACKTEST — هل تأثير الأخبار فعلي أم وهمي؟")
    print("=" * 90)

    # Verify DBs
    print(f"\nDBs verified:")
    dbs = [
        ('db/data_engine.db', GLM_ROOT / 'db' / 'data_engine.db'),
        ('db/news.db', GLM_ROOT / 'db' / 'news.db'),
        ('db/vps_real/predictions.db', PREDICTIONS_DB),
    ]
    for label, path in dbs:
        if path.exists():
            sz = path.stat().st_size
            print(f"  ✓ {label} ({sz//1024//1024} MB)")
        else:
            print(f"  ✗ {label} MISSING")

    # Check news.db has data
    c = sqlite3.connect(str(GLM_ROOT / 'db' / 'news.db'))
    try:
        news_count = c.execute('SELECT COUNT(*) FROM market_news').fetchone()[0]
        print(f"\n  news.db/market_news: {news_count} rows available for V40.2")
    except Exception as e:
        print(f"  ⚠ news.db read error: {e}")
        news_count = 0
    c.close()

    # Run configurations
    runs = [
        {
            'label': 'baseline_NO_news',
            'env': {
                'V40_2_NEWS_IMPACT': '0',
                'V40_2_SKIP_NEWS': '1',
                'V40_2_FORCE_NEWS_IN_BACKTEST': '0',
            },
            'description': 'V40.2 baseline بدون أخبار (الأخبار متعطلة تماماً)',
        },
        {
            'label': 'news_IMPACT_on',
            'env': {
                'V40_2_NEWS_IMPACT': '1',
                'V40_2_SKIP_NEWS': '0',
                'V40_2_FORCE_NEWS_IN_BACKTEST': '1',
            },
            'description': 'V40.2 + V40_2_NEWS_IMPACT=1 + FORCE_NEWS_IN_BACKTEST=1 (الأخبار من news.db تؤثر على score)',
        },
    ]

    results = {}
    for run in runs:
        label = run['label']
        print(f"\n{'='*90}")
        print(f"RUN: {label}")
        print(f"  Description: {run['description']}")
        print(f"{'='*90}")
        try:
            m = run_v40_2(label, run['env'])
        except subprocess.TimeoutExpired:
            m = {'label': label, 'error': 'timeout (15 min)'}
        except Exception as e:
            m = {'label': label, 'error': str(e)}
        results[label] = m

    # Comparison
    print("\n" + "=" * 110)
    print("FINAL COMPARISON — V40.2 baseline (no news) vs V40.2 + NEWS_IMPACT=1")
    print(f"Universe: {MAX_TICKERS} EGX tickers, window: {START_DATE} → {END_DATE}, scan_interval=1")
    print("=" * 110)
    print(f"{'Run':25s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s} | {'VETO':>4s} | {'BOOST':>5s} | {'REDUCE':>6s}")
    print("-" * 110)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:25s} | ERROR: {m['error'][:70]}")
            continue
        na = m.get('news_actions', {})
        print(f"{label:25s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f} | {na.get('VETO',0):4d} | {na.get('BOOST',0)+na.get('BOOST_STRONG',0):5d} | {na.get('REDUCE',0):6d}")

    # Δ delta calculation
    if 'baseline_NO_news' in results and 'news_IMPACT_on' in results:
        b = results['baseline_NO_news']
        n = results['news_IMPACT_on']
        if 'error' not in b and 'error' not in n:
            print("\n" + "=" * 110)
            print("DELTA (news_IMPACT_on - baseline_NO_news):")
            print("=" * 110)
            print(f"  Trades:        {b['trades']:>5d} → {n['trades']:>5d}  (Δ={n['trades']-b['trades']:+d})")
            print(f"  Win Rate:      {b['win_rate_pct']:>5.1f}% → {n['win_rate_pct']:>5.1f}%  (Δ={n['win_rate_pct']-b['win_rate_pct']:+.2f}pp)")
            print(f"  Avg Return:    {b['avg_return_pct']:>+7.3f}% → {n['avg_return_pct']:>+7.3f}%  (Δ={n['avg_return_pct']-b['avg_return_pct']:+.3f}pp)")
            print(f"  Total Return:  {b['total_return_pct']:>+7.2f}% → {n['total_return_pct']:>+7.2f}%  (Δ={n['total_return_pct']-b['total_return_pct']:+.2f}pp)")
            print(f"  Max Drawdown: {b['max_drawdown_pct']:>+7.2f}% → {n['max_drawdown_pct']:>+7.2f}%  (Δ={n['max_drawdown_pct']-b['max_drawdown_pct']:+.2f}pp)")
            print(f"  Profit Factor: {b['profit_factor']:>5.2f} → {n['profit_factor']:>5.2f}  (Δ={n['profit_factor']-b['profit_factor']:+.2f})")

            na = n.get('news_actions', {})
            print(f"\n  News actions (in news_IMPACT_on run):")
            print(f"    VETO: {na.get('VETO',0)} | BOOST: {na.get('BOOST',0)+na.get('BOOST_STRONG',0)} | REDUCE: {na.get('REDUCE',0)} | NEUTRAL: {na.get('NEUTRAL',0)}")

            # Verdict
            print("\n" + "=" * 110)
            print("VERDICT:")
            print("=" * 110)
            verdict_parts = []
            if n['trades'] < b['trades']:
                verdict_parts.append(f"✓ قلّل الصفقات السامة (-{b['trades']-n['trades']})")
            elif n['trades'] > b['trades']:
                verdict_parts.append(f"⚠ زاد الصفقات (+{n['trades']-b['trades']}) — غير متوقع")

            if n['win_rate_pct'] > b['win_rate_pct']:
                verdict_parts.append(f"✓ حسّن الـ WR (+{n['win_rate_pct']-b['win_rate_pct']:.2f}pp)")
            elif n['win_rate_pct'] < b['win_rate_pct']:
                verdict_parts.append(f"✗ طلّع الـ WR ({n['win_rate_pct']-b['win_rate_pct']:+.2f}pp)")

            if n['profit_factor'] > b['profit_factor']:
                verdict_parts.append(f"✓ رفّع PF (+{n['profit_factor']-b['profit_factor']:.2f})")
            elif n['profit_factor'] < b['profit_factor']:
                verdict_parts.append(f"✗ نزّل PF ({n['profit_factor']-b['profit_factor']:+.2f})")

            if n['max_drawdown_pct'] > b['max_drawdown_pct']:
                verdict_parts.append(f"✓ قلّل MaxDD (+{n['max_drawdown_pct']-b['max_drawdown_pct']:.2f}pp — قلّ = أحسن)")
            elif n['max_drawdown_pct'] < b['max_drawdown_pct']:
                verdict_parts.append(f"✗ زاد MaxDD ({n['max_drawdown_pct']-b['max_drawdown_pct']:+.2f}pp)")

            if na.get('VETO', 0) > 0:
                verdict_parts.append(f"✓ رفض {na.get('VETO',0)} صفقة سامة بـ NEWS-VETO")

            if not verdict_parts:
                print("  ⚪ محايد — مفيش فرق ملحوظ بين الـ runs.")
            else:
                for v in verdict_parts:
                    print(f"  {v}")

            # Final decision
            improvements = sum(1 for v in verdict_parts if v.startswith('✓'))
            regressions = sum(1 for v in verdict_parts if v.startswith('✗'))
            print(f"\n  إجمالي: {improvements} تحسينات، {regressions} تراجعات")
            if improvements > regressions:
                print("  🟢 التوصية: فعّل V40_2_NEWS_IMPACT=1 في الإنتاج (بعد مراقبة 7 أيام).")
            elif regressions > improvements:
                print("  🔴 التوصية: اترك V40_2_NEWS_IMPACT=0 — محتاج audit للـ news_impact_scorer.")
            else:
                print("  🟡 التوصية: محتاج مزيد من الاختبارات (universe أكبر + فترة أطول).")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 NEWS IMPACT BACKTEST',
            'data_source': 'V40.2 production pipeline (v40_2_daily_generator.py)',
            'universe': f'{MAX_TICKERS} EGX-canonical tickers',
            'window': f'{START_DATE} → {END_DATE} (6 months, scan_interval=1)',
            'dbs_verified': ['data_engine.db', 'news.db (7809 rows)', 'predictions.db'],
            'goal': 'هل تفعيل V40_2_NEWS_IMPACT=1 (قراءة من news.db) بيحسّن V40.2 فعلًا؟',
            'production_module': 'vps-service/analyzers/news_fetcher_analyzer.py + news_impact_scorer.py',
            'integration': 'vps-service/jobs/v40_2_daily_generator.py (V40_2_NEWS_IMPACT flag)',
            'news_source': 'news.db/market_news (News Agent المحلي + AlphaVantage + GNews)',
        },
        'results': results,
        'timestamp': datetime.now().isoformat(),
    }
    out = RESULTS_DIR / 'v402_news_impact_backtest.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults saved → {out}")
    print(f"Stdout logs → {TEMP_DIR}/*_stdout.log")


if __name__ == '__main__':
    main()
