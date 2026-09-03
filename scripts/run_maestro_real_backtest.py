#!/usr/bin/env python3
"""
run_maestro_real_backtest.py
=============================
باك-تست باستخدام MaestroOrchestrator الحقيقي (مش simplified).
يستخدم vps-service/analyzers/maestro_orchestrator.py مباشرة.

الإصلاحات المطبقة:
  FIX-001: بناء proofs (6 إثباتات) في Maestro → evidence_count ≥ 3
  FIX-002: رفع Discovery Fallback من 60 لـ 70
  FIX-003: Entry Gate exception → SKIP (مش continue)

التشغيل:
  cd /path/to/GLMinvestment
  python3 scripts/run_maestro_real_backtest.py
"""
import sqlite3
import sys
import os
import json
import time
from datetime import datetime
from pathlib import Path
from collections import defaultdict

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = Path(os.environ.get("DB_DIR", PROJECT_ROOT / "db"))
RESULTS_DIR = PROJECT_ROOT / "data" / "maestro_real_backtest"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
TXT_OUTPUT = RESULTS_DIR / f"maestro_real_{TIMESTAMP}.txt"
JSON_OUTPUT = RESULTS_DIR / f"maestro_real_{TIMESTAMP}.json"

sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.chdir(PROJECT_ROOT)


def find_price_db():
    for db_path in [DB_DIR / "data_engine.db", DB_DIR / "price_history.db"]:
        if not db_path.exists(): continue
        try:
            conn = sqlite3.connect(str(db_path))
            r = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='egksco_price_history'").fetchone()
            if r and conn.execute("SELECT COUNT(*) FROM egksco_price_history").fetchone()[0] > 0:
                conn.close()
                return str(db_path)
            conn.close()
        except: pass
    return None


def load_daily_history(conn, ticker, end_date, days=60):
    rows = conn.execute("""
        SELECT price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol=? AND price_date <= ?
        ORDER BY price_date DESC LIMIT ?
    """, (ticker, end_date, days)).fetchall()
    rows = list(reversed(rows))
    clean = [r for r in rows if r[4] and float(r[4]) > 0]
    return {
        'dates': [str(r[0])[:10] for r in clean],
        'opens': [float(r[1] or 0) for r in clean],
        'highs': [float(r[2] or 0) for r in clean],
        'lows': [float(r[3] or 0) for r in clean],
        'closes': [float(r[4] or 0) for r in clean],
        'volumes': [float(r[5] or 0) for r in clean],
    }


def get_top_liquid_tickers(conn, n=40):
    rows = conn.execute("""
        SELECT symbol, AVG(volume) as avg_vol, COUNT(*) as days
        FROM egksco_price_history
        WHERE volume > 0 AND close_price > 0
        GROUP BY symbol
        HAVING days >= 60 AND avg_vol >= 100000
        ORDER BY avg_vol DESC LIMIT ?
    """, (n,)).fetchall()
    return [r[0] for r in rows]


def get_trading_days(conn, start_date, end_date):
    rows = conn.execute("""
        SELECT DISTINCT price_date FROM egksco_price_history
        WHERE price_date >= ? AND price_date <= ?
        ORDER BY price_date
    """, (start_date, end_date)).fetchall()
    return [str(r[0])[:10] for r in rows]


def simulate_trade(conn, ticker, entry_date, entry_price, target, stop,
                   max_hold_days=7, quick_exit_pct=5):
    future = conn.execute("""
        SELECT price_date, high_price, low_price, close_price
        FROM egksco_price_history
        WHERE symbol=? AND price_date > ?
        ORDER BY price_date ASC LIMIT ?
    """, (ticker, entry_date, max_hold_days)).fetchall()
    if not future:
        return None
    quick_stop = entry_price * (1 - quick_exit_pct / 100)
    for i, r in enumerate(future):
        hi = float(r[1] or 0)
        lo = float(r[2] or 0)
        cl = float(r[3] or 0)
        if lo <= quick_stop:
            return {'return_pct': -quick_exit_pct, 'exit_type': 'quick_stop',
                    'exit_day': i + 1, 'exit_price': quick_stop,
                    'exit_date': str(r[0])[:10]}
        if lo <= stop <= hi:
            ret = (stop - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'stop_loss',
                    'exit_day': i + 1, 'exit_price': stop,
                    'exit_date': str(r[0])[:10]}
        if hi >= target:
            ret = (target - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'target_hit',
                    'exit_day': i + 1, 'exit_price': target,
                    'exit_date': str(r[0])[:10]}
    last_close = float(future[-1][3] or entry_price)
    ret = (last_close - entry_price) / entry_price * 100
    return {'return_pct': ret, 'exit_type': 'expired',
            'exit_day': len(future), 'exit_price': last_close,
            'exit_date': str(future[-1][0])[:10]}


def compute_metrics(trades, capital=100000):
    if not trades:
        return {'n': 0, 'wr': 0, 'pf': 0, 'total_ret': 0, 'avg_hold': 0,
                'max_dd': 0, 'wins': 0, 'losses': 0}
    n = len(trades)
    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] < 0]
    gp = sum(t['return_pct'] for t in wins)
    gl = abs(sum(t['return_pct'] for t in losses))
    wr = len(wins) / n * 100
    pf = gp / gl if gl > 0 else 0
    avg_hold = sum(t.get('hold_days', 0) for t in trades) / n
    equity = capital
    peak = equity
    max_dd = 0
    for t in trades:
        pnl = equity * (t['return_pct'] / 100) * (t.get('pos_pct', 1.2) / 100)
        equity += pnl
        if equity > peak: peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd: max_dd = dd
    total_ret_pct = (equity - capital) / capital * 100
    return {'n': n, 'wr': wr, 'pf': pf, 'total_ret': total_ret_pct,
            'avg_hold': avg_hold, 'max_dd': max_dd,
            'wins': len(wins), 'losses': len(losses)}


def main():
    out_lines = []
    def log(msg=""):
        print(msg)
        out_lines.append(msg)

    log("╔" + "═"*78 + "╗")
    log("║" + "   باك-تست بالـ MaestroOrchestrator الحقيقي (مع الإصلاحات)   ".center(78) + "║")
    log("╚" + "═"*78 + "╝")
    log("")
    log(f"Timestamp: {TIMESTAMP}")

    db_path = find_price_db()
    if not db_path:
        log("❌ مفيش DB!")
        sys.exit(1)
    log(f"  ✅ DB: {db_path}")

    conn = sqlite3.connect(db_path)

    log("\n─"*40)
    log("الإصلاحات المطبقة:")
    log("─"*40)
    log("  FIX-001: بناء proofs (6 إثباتات) في Maestro → evidence_count ≥ 3")
    log("  FIX-002: رفع Discovery Fallback من 60 لـ 70")
    log("  FIX-003: Entry Gate exception → SKIP (مش continue)")
    log("")
    log("─"*40)
    log("الإعداد:")
    log("─"*40)
    log("  • المحرك: MaestroOrchestrator الحقيقي (مش simplified)")
    log("  • الفترة: Feb 2026 - Aug 2026")
    log("  • الأسهم: أعلى 40 سهم سائل (للتسريع)")
    log("  • التردد: كل 10 أيام تداول")
    log("  • max_daily_picks: 5")
    log("  • الخروج: max_hold=7 + quick_exit=-5%")
    log("  • Risk per trade: 1.2%")
    log("")

    # الأرقام المرجعية
    log("─"*40)
    log("الأرقام المرجعية:")
    log("─"*40)
    log("  V40.2 (39 بعد ENTRY-GATE): WR 69.2% | PF 6.04 | DD -4.71% | Return +51.6% ← الهدف")
    log("  Maestro قبل الإصلاح:        WR 43.5% | PF 0.93 | DD 17.17% | Return -8.9%  ← الخاسر")
    log("")

    # استورد MaestroOrchestrator
    log("─"*40)
    log("تحميل MaestroOrchestrator...")
    log("─"*40)
    try:
        from analyzers.maestro_orchestrator import MaestroOrchestrator
        maestro = MaestroOrchestrator(str(DB_DIR / 'predictions.db'), enable_tracking=False)
        log("  ✅ MaestroOrchestrator جاهز")
    except Exception as e:
        log(f"  ❌ خطأ في تحميل MaestroOrchestrator: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # حمّل الأسهم والأيام
    tickers = get_top_liquid_tickers(conn, n=40)
    log(f"  عدد الأسهم: {len(tickers)}")

    trading_days = get_trading_days(conn, '2026-02-01', '2026-08-27')
    scan_days = trading_days[::10]  # كل 10 أيام
    log(f"  أيام المسح: {len(scan_days)}")
    log("")

    # شغّل الباك-تست
    log("═"*80)
    log("تشغيل الباك-تست بالـ MaestroOrchestrator الحقيقي...")
    log("═"*80)

    all_trades = []
    total_analyzed = 0
    total_buy = 0
    total_rejected = 0
    errors = 0
    start_time = time.time()

    for day_idx, scan_day in enumerate(scan_days):
        day_picks = []
        day_rejected = 0

        for ticker in tickers:
            hist = load_daily_history(conn, ticker, scan_day, 60)
            if len(hist['closes']) < 50:
                continue

            # بناء stock dict + price_history للـ MaestroOrchestrator
            stock = {
                'ticker': ticker, 'symbol': ticker,
                'sector': 'Financial Services',  # default
                'price': hist['closes'][-1],
                'change_percent': ((hist['closes'][-1] - hist['closes'][-2]) / hist['closes'][-2] * 100) if len(hist['closes']) >= 2 else 0,
                'volume': hist['volumes'][-1],
            }
            price_history = []
            for i in range(len(hist['dates'])):
                price_history.append({
                    'date': hist['dates'][i],
                    'open': hist['opens'][i], 'open_price': hist['opens'][i],
                    'high': hist['highs'][i], 'high_price': hist['highs'][i],
                    'low': hist['lows'][i], 'low_price': hist['lows'][i],
                    'close': hist['closes'][i], 'close_price': hist['closes'][i],
                    'volume': hist['volumes'][i], 'volume_traded': hist['volumes'][i],
                })

            total_analyzed += 1

            # شغل MaestroOrchestrator الحقيقي
            try:
                result = maestro.analyze(ticker, stock, price_history,
                                          options={'scan_date': scan_day})
            except Exception as e:
                errors += 1
                continue

            # هل التوصية buy؟
            rec = result.recommendation.lower() if result.recommendation else ''
            if rec not in ('buy', 'strong_buy', 't1_buy', 'swing_buy'):
                continue

            total_buy += 1
            entry = result.entry_price
            stop = result.stop_loss
            target = result.target
            score = result.maestro_score

            # لو signal_id = None → الـ Entry Gate رفضه
            if result.signal_id is None:
                day_rejected += 1
                total_rejected += 1
                continue

            # محاكاة الصفقة
            trade_result = simulate_trade(conn, ticker, scan_day,
                                           entry, target, stop,
                                           max_hold_days=7, quick_exit_pct=5)
            if trade_result is None:
                continue

            trade = {
                'ticker': ticker, 'date': scan_day,
                'entry': entry, 'target': target, 'stop': stop,
                'exit': trade_result['exit_price'],
                'return_pct': trade_result['return_pct'],
                'exit_type': trade_result['exit_type'],
                'hold_days': trade_result['exit_day'],
                'exit_date': trade_result['exit_date'],
                'pos_pct': 1.2,  # risk-based
                'score': score,
                'regime': '',
            }
            day_picks.append(trade)

        # max_daily_picks
        if len(day_picks) > 5:
            day_picks.sort(key=lambda x: -x['score'])
            day_picks = day_picks[:5]

        all_trades.extend(day_picks)
        elapsed = time.time() - start_time
        log(f"  {scan_day}: {len(day_picks)} trades (rejected={day_rejected}) | total={len(all_trades)} | {elapsed:.0f}s")

    log(f"\n  ── الإحصائيات ──")
    log(f"  تحليل: {total_analyzed} (ticker × day)")
    log(f"  buy signals: {total_buy}")
    log(f"  rejected by Entry Gate: {total_rejected}")
    log(f"  errors: {errors}")
    log(f"  إجمالي الصفقات: {len(all_trades)}")
    log(f"  الوقت: {time.time() - start_time:.0f}s")
    log("")

    # المقاييس
    log("═"*80)
    log("القسم 1: نتائج Maestro الحقيقي (مع الإصلاحات)")
    log("═"*80)
    metrics = compute_metrics(all_trades, capital=100000)
    log(f"\n  عدد الصفقات: {metrics['n']}")
    log(f"  Win Rate: {metrics['wr']:.1f}%")
    log(f"  Profit Factor: {metrics['pf']:.2f}")
    log(f"  إجمالي العائد: {metrics['total_ret']:+.2f}%")
    log(f"  متوسط مدة الاحتفاظ: {metrics['avg_hold']:.1f} يوم")
    log(f"  Max Drawdown: {metrics['max_dd']:.2f}%")
    log(f"  رابحة: {metrics['wins']} | خاسرة: {metrics['losses']}")
    log("")

    # مقارنة
    log("═"*80)
    log("القسم 2: مقارنة شاملة")
    log("═"*80)
    log(f"\n  {'المحرك':<30} {'صفقات':>7} {'WR %':>7} {'PF':>7} {'Max DD %':>10} {'Return %':>10} {'Hold':>6}")
    log("  " + "─"*80)
    log(f"  {'V40.2 (39 — الهدف)':<30} {39:>7} {69.2:>6.1f}% {6.04:>7.2f} {'-4.71':>9}% {51.62:>+9.1f}% {5.0:>5.1f}ي")
    log(f"  {'Maestro قبل الإصلاح':<30} {115:>7} {43.5:>6.1f}% {0.93:>7.2f} {17.17:>+9.2f}% {-8.91:>+9.1f}% {5.1:>5.1f}ي")
    log(f"  {'Maestro بعد الإصلاح':<30} {metrics['n']:>7} {metrics['wr']:>6.1f}% {metrics['pf']:>7.2f} {metrics['max_dd']:>+9.2f}% {metrics['total_ret']:>+9.1f}% {metrics['avg_hold']:>5.1f}ي")
    log("")

    # معايير النجاح
    log("═"*80)
    log("القسم 3: معايير النجاح")
    log("═"*80)
    c1 = metrics['pf'] >= 2.5
    c2 = metrics['wr'] >= 55
    c3 = metrics['max_dd'] < 10
    c4 = metrics['total_ret'] > 0
    log(f"\n  PF ≥ 2.5:       {'✓' if c1 else '✗'} ({metrics['pf']:.2f})")
    log(f"  WR ≥ 55%:       {'✓' if c2 else '✗'} ({metrics['wr']:.1f}%)")
    log(f"  Max DD < 10%:   {'✓' if c3 else '✗'} ({metrics['max_dd']:.2f}%)")
    log(f"  Return > 0:     {'✓' if c4 else '✗'} ({metrics['total_ret']:+.1f}%)")
    log("")

    # الحكم
    log("═"*80)
    log("القسم 4: الحكم")
    log("═"*80)
    if c1 and c2 and c3 and c4:
        verdict = "✅ Maestro بعد الإصلاح حقق كل المعايير — جاهز للإنتاج"
    elif c4 and (c1 or c2):
        verdict = "⚠️ Maestro تحسن بس مش كامل — يحتاج tuning إضافي"
    elif c4:
        verdict = "⚠️ Maestro بقا مربح بس أقل من الهدف"
    else:
        verdict = "❌ Maestro لسه خاسر — محتاج إصلاحات إضافية"
    log(f"\n  {verdict}")

    # تحليل إضافي
    if metrics['n'] > 0:
        log(f"\n  ── تحليل الإشارات ──")
        log(f"  تحليل {total_analyzed} (ticker × day)")
        log(f"  buy signals: {total_buy} ({total_buy/max(total_analyzed,1)*100:.1f}%)")
        log(f"  rejected by Entry Gate: {total_rejected} ({total_rejected/max(total_buy,1)*100:.1f}% من buy)")
        log(f"  صفقات نهائية: {metrics['n']} ({metrics['n']/max(total_buy,1)*100:.1f}% من buy)")

    conn.close()

    # احفظ النتائج
    with open(TXT_OUTPUT, 'w', encoding='utf-8') as f:
        f.write("\n".join(out_lines))
    json_data = {
        'timestamp': TIMESTAMP, 'db_path': db_path,
        'metrics': metrics,
        'stats': {
            'total_analyzed': total_analyzed,
            'total_buy': total_buy,
            'total_rejected': total_rejected,
            'errors': errors,
            'elapsed_seconds': time.time() - start_time,
        },
        'criteria': {'pf_ok': c1, 'wr_ok': c2, 'dd_ok': c3, 'ret_ok': c4},
        'verdict': verdict,
    }
    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False, default=str)

    print("\n" + "═"*80)
    print("✅ تم حفظ النتائج:")
    print(f"  📄 Text:  {TXT_OUTPUT}")
    print(f"  📊 JSON:  {JSON_OUTPUT}")
    print("═"*80)


if __name__ == '__main__':
    main()
