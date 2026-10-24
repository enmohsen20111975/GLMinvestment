#!/usr/bin/env python3
"""
V40.2 LIVE SIMULATION — بيانات طازجة من الإنتاج
=================================================
بدل backtest تاريخي (اللي مش هينفع عشان الأخبار طازجة 2026-09-01/02)،
ده بيشتغل على آخر 5 أيام من البيانات الحقيقية.

يقيس تأثير:
  1. V40.2 baseline (بدون أخبار + بدون توصيات خبراء)
  2. V40.2 + NEWS_IMPACT (أخبار طازجة من الإنتاج)
  3. V40.2 + NEWS_IMPACT + EXPERT_RECS (توصيات خبراء من الإنتاج)

توجيه المالك (2026-09-02):
  "بس الاخبار كلها جديدة مش هاتأثر مع بيانات قديمة"
  → لازم live simulation على آخر فترة فيها أخبار حقيقية.

الفترة: آخر 5 أيام تداول (لو متوفرة في data_engine.db)
الكون: 50 سهم EGX (للأداء)
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path('/home/z/my-project')
GLM_ROOT = PROJECT_ROOT / 'GLMinvestment'
V40_2_SCRIPT = GLM_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = GLM_ROOT / 'db' / 'vps_real' / 'predictions.db'
TEMP_DIR = GLM_ROOT / 'data' / 'v402_live_simulation'
RESULTS_DIR = GLM_ROOT / 'data' / 'merge_backtest_real'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# آخر 5 أيام تداول متاحة في data_engine.db
PYTHON = sys.executable


def get_recent_dates(days: int = 5) -> tuple[str, str]:
    """جلب آخر N يوم تداول من data_engine.db (egksco_price_history.price_date)."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(str(GLM_ROOT / 'db' / 'data_engine.db'), writable=False).__enter__()
    try:
        # العمود الصحيح هو price_date (مش scan_date)
        rows = c.execute('''
            SELECT DISTINCT price_date as d
            FROM egksco_price_history
            WHERE price_date IS NOT NULL
            ORDER BY d DESC
            LIMIT ?
        ''', (days,)).fetchall()
        if not rows:
            end = datetime.now().strftime('%Y-%m-%d')
            start = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            return start, end
        dates = [r[0] for r in rows]
        return dates[-1], dates[0]
    except Exception as e:
        print(f"⚠ data_engine.db query error: {e}")
        end = datetime.now().strftime('%Y-%m-%d')
        start = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        return start, end
    finally:
        c.close()


def extract_v40_metrics(db_path: Path, label: str) -> dict:
    """Read predictions table + compute metrics."""
    if not db_path.exists():
        return {'label': label, 'trades': 0, 'error': 'DB missing'}

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(str(db_path), writable=False).__enter__()
    try:
        rows = c.execute('''
            SELECT ticker, entry_price, target_price, stop_loss, actual_return,
                   exit_type, is_correct, prediction_date, outcome_date
            FROM predictions
            ORDER BY prediction_date
        ''').fetchall()
    except Exception as e:
        c.close()
        return {'label': label, 'error': str(e)}

    if not rows:
        c.close()
        return {
            'label': label, 'trades': 0, 'wins': 0, 'losses': 0,
            'win_rate_pct': 0, 'avg_return_pct': 0, 'total_return_pct': 0,
            'max_drawdown_pct': 0, 'profit_factor': 0,
            'news_actions': {'VETO': 0, 'BOOST': 0, 'BOOST_STRONG': 0, 'REDUCE': 0, 'NEUTRAL': 0},
            'expert_actions': {'VETO': 0, 'STRONG_BUY': 0, 'BUY': 0, 'SELL': 0, 'HOLD': 0, 'NO_DATA': 0},
        }

    trades = []
    for r in rows:
        ret = float(r[4]) if r[4] is not None else 0.0
        trades.append({'ticker': r[0], 'return_pct': ret, 'exit_type': r[5] or 'unknown'})

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
    }


def parse_actions_from_log(stdout: str) -> tuple[dict, dict]:
    """Extract NEWS-*/EXPERT-* counts from V40.2 stdout."""
    news_counts = {'VETO': 0, 'BOOST': 0, 'BOOST_STRONG': 0, 'REDUCE': 0, 'NEUTRAL': 0}
    expert_counts = {'VETO': 0, 'STRONG_BUY': 0, 'BUY': 0, 'SELL': 0, 'HOLD': 0, 'NO_DATA': 0}
    for line in stdout.split('\n'):
        if '[NEWS-VETO]' in line:
            news_counts['VETO'] += 1
        elif '[NEWS-BOOST_STRONG]' in line:
            news_counts['BOOST_STRONG'] += 1
        elif '[NEWS-BOOST]' in line:
            news_counts['BOOST'] += 1
        elif '[NEWS-REDUCE]' in line:
            news_counts['REDUCE'] += 1
        elif '[NEWS-NEUTRAL]' in line:
            news_counts['NEUTRAL'] += 1
        elif '[EXPERT-VETO]' in line:
            expert_counts['VETO'] += 1
        elif '[EXPERT-STRONG_BUY]' in line:
            expert_counts['STRONG_BUY'] += 1
        elif '[EXPERT-BUY]' in line:
            expert_counts['BUY'] += 1
        elif '[EXPERT-SELL]' in line:
            expert_counts['SELL'] += 1
        elif '[EXPERT-HOLD]' in line:
            expert_counts['HOLD'] += 1
    return news_counts, expert_counts


def run_v40_2(label: str, env_overrides: dict, start_date: str, end_date: str) -> dict:
    """Run V40.2 simulation with env overrides."""
    temp_db = TEMP_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()
    # Use sqlite3 backup (handles WAL/SHM properly)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    src = db_manager.connection(str(PREDICTIONS_DB), writable=False).__enter__()
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    dst = db_manager.connection(str(temp_db), writable=False).__enter__()
    src.backup(dst)
    dst.close()
    src.close()
    temp_db.chmod(0o644)
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    c = db_manager.connection(str(temp_db), writable=True).__enter__()
    try:
        c.execute('DELETE FROM predictions')
        c.commit()
    except Exception as e:
        print(f"  ⚠ DELETE failed: {e}")
    c.close()

    env = os.environ.copy()
    for f in ['V40_2_REGIME_FILTER', 'V40_2_REGIME_MODE', 'V40_2_STRICT_ENTRY',
              'V40_2_DISCLOSURE_IMPACT', 'V40_2_NOTEBOOK_CONTEXT', 'V40_2_NEWS_IMPACT',
              'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT', 'V40_2_EXPERT_RECS']:
        env[f] = '0'
    env.update({
        'V40_2_BACKTEST_MODE': '1',
        'BYPASS_PRED_CAP': '1',
        'V40_2_PREDICTIONS_DB': str(temp_db),
        'DATA_ENGINE_DB': str(GLM_ROOT / 'db' / 'data_engine.db'),
        'PYTHONPATH': str(GLM_ROOT / 'vps-service'),
    })
    env.update(env_overrides)

    cmd = [PYTHON, str(V40_2_SCRIPT),
           '--start', start_date, '--end', end_date,
           '--scan-interval', '1', '--max-tickers', '235']

    print(f"\n[{label}] running V40.2 ({start_date} → {end_date}, 235 tickers)...")
    print(f"  env: NEWS_IMPACT={env.get('V40_2_NEWS_IMPACT')}, FORCE_NEWS={env.get('V40_2_FORCE_NEWS_IN_BACKTEST')}, EXPERT_RECS={env.get('V40_2_EXPERT_RECS')}")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=540)
    dt = time.time() - t0

    metrics = extract_v40_metrics(temp_db, label)
    metrics['runtime_sec'] = round(dt, 1)
    na, ea = parse_actions_from_log(proc.stdout)
    metrics['news_actions'] = na
    metrics['expert_actions'] = ea

    log_path = TEMP_DIR / f'{label}_stdout.log'
    log_path.write_text(proc.stdout, encoding='utf-8')
    metrics['stdout_log'] = str(log_path)

    # Print key lines
    for line in proc.stdout.split('\n')[-30:]:
        if any(k in line for k in ['Total predictions', 'Overall win rate', 'Profit Factor',
                                    'NEWS-', 'EXPERT-', 'Signals found', 'Processed']):
            print(f"  {line.strip()}")

    return metrics


def main():
    print("=" * 95)
    print("V40.2 LIVE SIMULATION — بيانات طازجة من الإنتاج")
    print("توجيه المالك: 'بس الاخبار كلها جديدة مش هاتأثر مع بيانات قديمة'")
    print("=" * 95)

    # Get recent trading dates from data_engine.db
    start_date, end_date = get_recent_dates(days=30)
    print(f"\n📅 فترة المحاكاة: {start_date} → {end_date} (آخر 30 يوم تداول متاحة)")

    # Verify DBs
    print(f"\nDBs verified:")
    dbs = [
        ('db/data_engine.db', GLM_ROOT / 'db' / 'data_engine.db'),
        ('db/news.db', GLM_ROOT / 'db' / 'news.db'),
        ('db/vps_real/predictions.db', PREDICTIONS_DB),
    ]
    for label, path in dbs:
        if path.exists():
            print(f"  ✓ {label} ({path.stat().st_size//1024//1024} MB)")
        else:
            print(f"  ✗ {label} MISSING")

    # Run configurations
    runs = [
        {
            'label': 'baseline_no_news_no_expert',
            'env': {
                'V40_2_NEWS_IMPACT': '0',
                'V40_2_SKIP_NEWS': '1',
                'V40_2_FORCE_NEWS_IN_BACKTEST': '0',
                'V40_2_EXPERT_RECS': '0',
                'V40_2_FORCE_EXPERT_RECS_IN_BACKTEST': '0',
            },
            'description': 'V40.2 baseline — بدون أخبار + بدون توصيات خبراء',
        },
        {
            'label': 'with_news_only',
            'env': {
                'V40_2_NEWS_IMPACT': '1',
                'V40_2_SKIP_NEWS': '0',
                'V40_2_FORCE_NEWS_IN_BACKTEST': '1',
                'V40_2_EXPERT_RECS': '0',
                'V40_2_FORCE_EXPERT_RECS_IN_BACKTEST': '0',
            },
            'description': 'V40.2 + NEWS_IMPACT فقط (أخبار طازجة من الإنتاج)',
        },
        {
            'label': 'with_news_and_expert',
            'env': {
                'V40_2_NEWS_IMPACT': '1',
                'V40_2_SKIP_NEWS': '0',
                'V40_2_FORCE_NEWS_IN_BACKTEST': '1',
                'V40_2_EXPERT_RECS': '1',
                'V40_2_FORCE_EXPERT_RECS_IN_BACKTEST': '1',
            },
            'description': 'V40.2 + NEWS_IMPACT + EXPERT_RECS (أخبار + توصيات خبراء)',
        },
    ]

    results = {}
    for run in runs:
        label = run['label']
        print(f"\n{'='*95}")
        print(f"RUN: {label}")
        print(f"  Description: {run['description']}")
        print(f"{'='*95}")
        try:
            m = run_v40_2(label, run['env'], start_date, end_date)
        except subprocess.TimeoutExpired:
            m = {'label': label, 'error': 'timeout (9 min)'}
        except Exception as e:
            m = {'label': label, 'error': str(e)}
        results[label] = m

    # Comparison
    print("\n" + "=" * 120)
    print("FINAL COMPARISON — V40.2 baseline vs +NEWS vs +NEWS+EXPERT")
    print(f"Window: {start_date} → {end_date} (آخر 5 أيام تداول، 50 tickers)")
    print("=" * 120)
    print(f"{'Run':35s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s} | {'N-VETO':>6s} | {'N-BOOST':>7s} | {'E-VETO':>6s} | {'E-BUY':>5s}")
    print("-" * 120)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:35s} | ERROR: {m['error'][:60]}")
            continue
        na = m.get('news_actions', {})
        ea = m.get('expert_actions', {})
        n_veto = na.get('VETO', 0)
        n_boost = na.get('BOOST', 0) + na.get('BOOST_STRONG', 0)
        e_veto = ea.get('VETO', 0)
        e_buy = ea.get('STRONG_BUY', 0) + ea.get('BUY', 0)
        print(f"{label:35s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f} | {n_veto:6d} | {n_boost:7d} | {e_veto:6d} | {e_buy:5d}")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 LIVE SIMULATION (fresh production data)',
            'window': f'{start_date} → {end_date}',
            'universe': '50 EGX tickers',
            'data_source': 'data_engine.db (local) + news.db (local) + production (news-feed + expert-recs)',
            'goal': 'هل تأثير الأخبار + التوصيات البشرية فعلي على V40.2 (بيانات طازجة)؟',
            'owner_directive': 'بس الاخبار كلها جديدة مش هاتأثر مع بيانات قديمة',
        },
        'results': results,
        'timestamp': datetime.now().isoformat(),
    }
    out = RESULTS_DIR / 'v402_live_simulation.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved → {out}")
    print(f"📁 Stdout logs → {TEMP_DIR}/*_stdout.log")


if __name__ == '__main__':
    main()
