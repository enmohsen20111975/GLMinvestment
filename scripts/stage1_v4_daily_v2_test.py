#!/usr/bin/env python3
"""
المرحلة 1 — اختبار V4-Daily v2 (5 تكوينات)
============================================
يختبر 5 تكوينات لإيجاد الأفضل:
  A: v1 baseline (score≥35, no filters)
  B: v2 strict (score≥45, vol≥1.5x, multi-day)
  C: v2 strict (score≥55, vol≥1.5x, multi-day)
  D: v2 relaxed (score≥45, vol≥1.2x, multi-day)
  E: v2 no-multi-day (score≥45, vol≥1.2x, no multi-day)

معايير النجاح:
  - Precision ≥ 25%
  - PF ≥ 1.5
  - Recall ≥ 35%
  - Max DD ≤ baseline
"""
import sqlite3
import sys
import os
from collections import defaultdict

sys.path.insert(0, '/home/z/my-project/vps-service')
os.chdir('/home/z/my-project')

exec(open('scripts/v4_daily_detector.py').read().split('# 5) التقرير')[0])

DB = '/tmp/dbs/data_engine.db'


def test_recall_v2(conn, explosive_list, lookback=62, min_score=45, **kwargs):
    results = []
    for exp in explosive_list:
        ticker = exp['ticker']
        exp_date = exp['date']
        hist = load_daily_history(conn, ticker, exp_date, lookback)
        if len(hist['closes']) < 60:
            results.append({'explosive': exp, 'tested': False, 'reason': 'بيانات غير كافية'})
            continue
        result = detect_v4_daily_v2(hist['closes'], hist['highs'], hist['lows'],
                                     hist['volumes'], min_score=min_score, **kwargs)
        results.append({
            'explosive': exp, 'tested': True,
            'is_hot': result['is_hot'], 'score': result['score'],
            'signals': result['signals'], 'reason': result['reason'],
            'filters': result.get('filters', {}),
            'prev_close': hist['closes'][-1],
        })
    return results


def test_precision_v2(conn, scan_date, lookback=62, future_days=5,
                       min_future_return=10.0, min_score=45, **kwargs):
    tickers = get_all_tickers(conn, min_avg_vol=100000, min_days=lookback + future_days + 5)
    results = {
        'total_signals': 0, 'true_signals': 0, 'false_signals': 0,
        'details': [], 'tested_count': 0,
        'filter_rejections': defaultdict(int),
    }
    for ticker, _, _ in tickers:
        hist = load_daily_history(conn, ticker, scan_date, lookback)
        if len(hist['closes']) < 60:
            continue
        results['tested_count'] += 1
        result = detect_v4_daily_v2(hist['closes'], hist['highs'], hist['lows'],
                                     hist['volumes'], min_score=min_score, **kwargs)
        if not result['is_hot']:
            filters = result.get('filters', {})
            if filters.get('base_rejected'):
                results['filter_rejections']['base_not_hot'] += 1
            elif filters.get('score_rejected'):
                results['filter_rejections']['score_too_low'] += 1
            elif not filters.get('trend_ok', True):
                results['filter_rejections']['trend'] += 1
            elif not filters.get('vol_confirm_ok', True):
                results['filter_rejections']['vol_confirm'] += 1
            elif not filters.get('multi_day_ok', True):
                results['filter_rejections']['multi_day'] += 1
            else:
                results['filter_rejections']['unknown'] += 1
            continue
        results['total_signals'] += 1
        future_rows = conn.execute("""
            SELECT price_date, close_price FROM egksco_price_history
            WHERE symbol=? AND price_date > ?
            ORDER BY price_date ASC LIMIT ?
        """, (ticker, scan_date, future_days)).fetchall()
        if not future_rows or len(future_rows) < 2:
            results['false_signals'] += 1
            continue
        entry_price = float(hist['closes'][-1])
        max_future = max(float(r[1] or 0) for r in future_rows)
        future_return = (max_future - entry_price) / entry_price * 100 if entry_price > 0 else 0
        detail = {
            'ticker': ticker, 'date': scan_date,
            'score': result['score'], 'signals': result['signals'],
            'filters': result.get('filters', {}),
            'entry': entry_price, 'max_future': max_future,
            'future_return': future_return,
            'is_true': future_return >= min_future_return,
        }
        results['details'].append(detail)
        if future_return >= min_future_return:
            results['true_signals'] += 1
        else:
            results['false_signals'] += 1
    return results


def compute_max_dd(trades, capital=100000, risk_pct=1.2):
    equity = capital
    peak = equity
    max_dd = 0
    for t in trades:
        pnl = equity * (t['return_pct'] / 100) * (risk_pct / 100)
        equity += pnl
        if equity > peak: peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd: max_dd = dd
    return max_dd


def run_config(conn, label, kwargs, version, testable, scan_dates):
    """شغّل تكوين واحد وارجع كل المقاييس."""
    if version == 'v1':
        recall_res = test_recall(conn, testable, lookback=62)
        prec_data = {'total': 0, 'true': 0, 'false': 0, 'tested': 0, 'details': []}
        for sd in scan_dates:
            p = test_precision(conn, sd, lookback=62, future_days=5,
                               min_future_return=10.0, min_score=kwargs['min_score'])
            prec_data['total'] += p['total_signals']
            prec_data['true'] += p['true_signals']
            prec_data['false'] += p['false_signals']
            prec_data['tested'] += p['tested_count']
            prec_data['details'].extend(p['details'])
    else:
        recall_res = test_recall_v2(conn, testable, lookback=62, **kwargs)
        prec_data = {'total': 0, 'true': 0, 'false': 0, 'tested': 0, 'details': []}
        for sd in scan_dates:
            p = test_precision_v2(conn, sd, lookback=62, future_days=5,
                                   min_future_return=10.0, **kwargs)
            prec_data['total'] += p['total_signals']
            prec_data['true'] += p['true_signals']
            prec_data['false'] += p['false_signals']
            prec_data['tested'] += p['tested_count']
            prec_data['details'].extend(p['details'])

    caught = [r for r in recall_res if r.get('is_hot')]
    tested = [r for r in recall_res if r.get('tested')]
    recall_pct = len(caught) / max(len(tested), 1) * 100
    prec_pct = prec_data['true'] / max(prec_data['total'], 1) * 100

    trades = []
    for d in prec_data['details']:
        trade = simulate_trade(conn, d['ticker'], d['date'], d['entry'],
                                stop_pct=8, target_pct=15, max_hold=10)
        if trade:
            trade['ticker'] = d['ticker']
            trade['date'] = d['date']
            trade['score'] = d['score']
            trades.append(trade)

    if trades:
        n = len(trades)
        wins = [t for t in trades if t['return_pct'] > 0]
        losses = [t for t in trades if t['return_pct'] < 0]
        gp = sum(t['return_pct'] for t in wins)
        gl = abs(sum(t['return_pct'] for t in losses))
        wr = len(wins) / n * 100
        pf = gp / gl if gl > 0 else 0
        avg_ret = sum(t['return_pct'] for t in trades) / n
        avg_hold = sum(t['exit_day'] for t in trades) / n
        max_dd = compute_max_dd(trades, capital=100000, risk_pct=1.2)
    else:
        wr = pf = avg_ret = avg_hold = max_dd = 0
        wins = []; losses = []

    return {
        'recall_pct': recall_pct, 'caught': len(caught),
        'prec_pct': prec_pct, 'total_signals': prec_data['total'],
        'true_signals': prec_data['true'], 'false_signals': prec_data['false'],
        'n_trades': len(trades), 'wr': wr, 'pf': pf,
        'avg_ret': avg_ret, 'avg_hold': avg_hold, 'max_dd': max_dd,
        'wins': len(wins), 'losses': len(losses),
        'trades': trades, 'caught_list': caught,
    }


def main():
    conn = sqlite3.connect(DB)

    print("╔" + "═"*78 + "╗")
    print("║" + "    المرحلة 1 — V4-Daily v2 (5 تكوينات) — تقرير الأرقام    ".center(78) + "║")
    print("╚" + "═"*78 + "╝")

    print("\n" + "─"*80)
    print("إعداد الاختبار")
    print("─"*80)
    print("  • الفلاتر: trend + vol_confirm + multi_day")
    print("  • 5 تكوينات لاختيار الأفضل:")
    print("    A: v1 baseline (score≥35, no filters)")
    print("    B: v2 strict (score≥45, vol≥1.5x, multi-day)")
    print("    C: v2 strict (score≥55, vol≥1.5x, multi-day)")
    print("    D: v2 relaxed (score≥45, vol≥1.2x, multi-day)")
    print("    E: v2 no-multi-day (score≥45, vol≥1.2x, no multi-day)")
    print("  • معايير النجاح: Precision ≥ 25%, PF ≥ 1.5, Recall ≥ 35%, Max DD ≤ baseline")

    explosive = find_explosive_days(conn, min_change=15.0, min_volume=100000)
    testable = [e for e in explosive if e['date'] < '2026-08-28']
    print(f"\nإجمالي الأيام الانفجارية: {len(testable)}")

    scan_dates = ['2026-07-15', '2026-07-30', '2026-08-06', '2026-08-14']

    configs = [
        ('A', 'v1 baseline (≥35)',           dict(min_score=35), 'v1'),
        ('B', 'v2 (≥45, vol≥1.5x, md)',      dict(min_score=45, vol_confirm_min=1.5, vol_confirm_max=5.0, require_multi_day=True), 'v2'),
        ('C', 'v2 (≥55, vol≥1.5x, md)',      dict(min_score=55, vol_confirm_min=1.5, vol_confirm_max=5.0, require_multi_day=True), 'v2'),
        ('D', 'v2 (≥45, vol≥1.2x, md)',      dict(min_score=45, vol_confirm_min=1.2, vol_confirm_max=5.0, require_multi_day=True), 'v2'),
        ('E', 'v2 (≥45, vol≥1.2x, no-md)',   dict(min_score=45, vol_confirm_min=1.2, vol_confirm_max=5.0, require_multi_day=False), 'v2'),
    ]

    results = {}
    for short, label, kwargs, version in configs:
        print(f"\n  شغّل {short}: {label}...")
        r = run_config(conn, label, kwargs, version, testable, scan_dates)
        results[short] = r
        print(f"    Recall={r['recall_pct']:.1f}%, Precision={r['prec_pct']:.1f}%, PF={r['pf']:.2f}, DD={r['max_dd']:.2f}%, trades={r['n_trades']}")

    # ─── الجدول الموحد ───
    print("\n" + "═"*80)
    print("القسم 1: الجدول الموحد — مقارنة 5 تكوينات")
    print("═"*80)
    print(f"\n{'المقياس':<28}", end='')
    for short, _label, _kw, _ver in configs:
        print(f" {short:>10}", end='')
    print()
    print("─"*82)
    for metric, key in [
        ('Recall %', 'recall_pct'),
        ('الصواريخ المُصطادة', 'caught'),
        ('Precision %', 'prec_pct'),
        ('إجمالي الإشارات', 'total_signals'),
        ('إشارات صحيحة', 'true_signals'),
        ('إشارات كاذبة', 'false_signals'),
        ('عدد الصفقات', 'n_trades'),
        ('Win Rate %', 'wr'),
        ('Profit Factor', 'pf'),
        ('متوسط العائد %', 'avg_ret'),
        ('متوسط مدة الاحتفاظ', 'avg_hold'),
        ('Max Drawdown %', 'max_dd'),
    ]:
        print(f"{metric:<28}", end='')
        for short, _label, _kw, _ver in configs:
            v = results[short][key]
            if isinstance(v, int):
                print(f" {v:>10}", end='')
            else:
                print(f" {v:>10.2f}", end='')
        print()

    # ─── معايير النجاح ───
    print("\n" + "═"*80)
    print("القسم 2: معايير النجاح")
    print("═"*80)
    baseline_dd = results['A']['max_dd']
    print(f"\n{'التكوين':<8} {'Prec≥25':>8} {'PF≥1.5':>8} {'Recall≥35':>10} {'DD≤base':>9} {'النتيجة':>12}")
    print("─"*60)
    for short, _label, _kw, _ver in configs:
        r = results[short]
        c1 = r['prec_pct'] >= 25
        c2 = r['pf'] >= 1.5
        c3 = r['recall_pct'] >= 35
        c4 = r['max_dd'] <= baseline_dd + 0.5
        all_ok = c1 and c2 and c3 and c4
        status = '✓ نجاح' if all_ok else '✗ فشل'
        print(f"{short:<8} {'✓' if c1 else '✗':>8} {'✓' if c2 else '✗':>8} {'✓' if c3 else '✗':>10} {'✓' if c4 else '✗':>9} {status:>12}")

    # ─── الأفضل ───
    best_label = None
    best_score = -1
    for short, _label, _kw, _ver in configs:
        r = results[short]
        if r['recall_pct'] >= 20 and r['pf'] > best_score:
            best_score = r['pf']
            best_label = short

    if best_label:
        print("\n" + "═"*80)
        print(f"القسم 3: أمثلة الصفقات في الأفضل ({best_label})")
        print("═"*80)
        trades = results[best_label]['trades']
        trades_sorted = sorted(trades, key=lambda x: -x['return_pct'])
        print(f"\n  {'date':<12} {'ticker':<8} {'score':>5} {'entry':>8} {'exit':>8} {'return%':>8} {'exit_type':<12} {'days':>5}")
        print("  " + "─"*75)
        for t in trades_sorted[:15]:
            print(f"  {t['date']:<12} {t['ticker']:<8} {t['score']:>5.0f} {t.get('entry', 0):>8.2f} {t['exit_price']:>8.2f} {t['return_pct']:>+7.1f}% {t['exit_type']:<12} {t['exit_day']:>5}")

    # ─── 5 أمثلة أسهم انفجارية ───
    if best_label and results[best_label]['caught_list']:
        print("\n" + "═"*80)
        print(f"القسم 4: 5 أمثلة أسهم انفجارية مُصطادة في {best_label}")
        print("═"*80)
        caught = results[best_label]['caught_list']
        caught.sort(key=lambda x: -x['explosive']['change_pct'])
        for r in caught[:5]:
            e = r['explosive']
            print(f"\n── {e['ticker']} @ {e['date']} (تغير +{e['change_pct']:.1f}%) ──")
            print(f"  score={r['score']:.0f} is_hot={r['is_hot']}")
            filters = r.get('filters', {})
            print(f"  filters: trend={filters.get('trend_ok', '?')} | vol={filters.get('vol_confirm_ok', '?')} ({filters.get('vol_confirm_reason', '')}) | multi_day={filters.get('multi_day_ok', '?')}")
            print(f"  signals: {r['signals']}")
            hist = load_daily_history(conn, e['ticker'], e['date'], 15)
            if len(hist['dates']) >= 5:
                print(f"  آخر 5 أيام قبل الانفجار:")
                prev = None
                for i in range(-5, 0):
                    d = hist['dates'][i]
                    cl = hist['closes'][i]
                    vol = hist['volumes'][i]
                    change = (cl - prev) / prev * 100 if prev else 0
                    print(f"    {d:<12} close={cl:>8.2f} vol={int(vol):>12,} {change:>+7.2f}%")
                    prev = cl

    # ─── القرار ───
    print("\n" + "═"*80)
    print("القسم 5: القرار المقترح")
    print("═"*80)

    best_ok = None
    for short, _label, _kw, _ver in configs:
        r = results[short]
        c1 = r['prec_pct'] >= 25
        c2 = r['pf'] >= 1.5
        c3 = r['recall_pct'] >= 35
        c4 = r['max_dd'] <= baseline_dd + 0.5
        if c1 and c2 and c3 and c4:
            if best_ok is None or r['pf'] > results[best_ok]['pf']:
                best_ok = short

    if best_ok:
        r = results[best_ok]
        verdict = f"✅ نعتمد — {best_ok} حقق كل المعايير (PF={r['pf']:.2f}, Prec={r['prec_pct']:.1f}%, Recall={r['recall_pct']:.1f}%)"
        next_step = "المرحلة 2: ربط V4-Daily كـ Discovery مع Maestro (بدون تجاوز الفلاتر الأساسية)"
    else:
        best_partial = None
        best_partial_score = -1
        for short, _label, _kw, _ver in configs:
            r = results[short]
            score = r['prec_pct'] + r['pf'] * 5 - max(0, 35 - r['recall_pct']) * 2
            if score > best_partial_score:
                best_partial_score = score
                best_partial = short
        if results[best_partial]['pf'] >= 1.5 and results[best_partial]['recall_pct'] >= 15:
            r = results[best_partial]
            verdict = f"⚠️ نعدل — {best_partial} فيه تحسن جزئي (PF={r['pf']:.2f}, Recall={r['recall_pct']:.1f}%) بس مش كامل"
            next_step = "نجرّب تكوينات إضافية: vol_min=1.0x أو نلغي multi-day لوحده"
        else:
            verdict = "❌ نرجع — مفيش تحسن حقيقي"
            next_step = "نقتل الفكرة مؤقتاً ونرجع للمختبر بفكرة جديدة"

    print(f"\n  القرار: {verdict}")
    print(f"  الخطوة التالية: {next_step}")

    conn.close()
    return results


if __name__ == '__main__':
    results = main()
