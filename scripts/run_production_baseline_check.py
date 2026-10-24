#!/usr/bin/env python3
"""
run_production_baseline_check.py
=================================
التحقق من إن Maestro Baseline القوي لسه موجود.
يعيد نفس باك-تست الإنتاج اللي عملناه قبل كده على 68 صفقة.

السيناريوهات:
  1. BASELINE: 68 صفقة بالـ actual_return الأصلي
  2. مدة 7 أيام: cap holding_days = 7 (re-simulate)
  3. إلغاء WATCH: شيل صفقات WATCH (68 → 56)
  4. خروج سريع -5%: وقف على -5% بدل stop الأصلي
  5. كل التوصيات معاً: 1+2+3 → السيناريو القوي (48 صفقة، WR 60.4%، PF 6.20)

الأرقام المرجعية (من worklog BACKTEST-PRODUCTION-2026-08-31):
  BASELINE:        68T | WR 52.9% | PF 2.79 | return +404.8% | hold 7.5d
  كل التوصيات معاً: 48T | WR 60.4% | PF 6.20 | return +440.5% | hold 2.4d

التشغيل:
  python3 scripts/run_production_baseline_check.py
"""
import sqlite3
import sys
import os
import json
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_DIR = Path(os.environ.get("DB_DIR", PROJECT_ROOT / "db"))
RESULTS_DIR = PROJECT_ROOT / "data" / "production_baseline_check"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
TXT_OUTPUT = RESULTS_DIR / f"baseline_check_{TIMESTAMP}.txt"
JSON_OUTPUT = RESULTS_DIR / f"baseline_check_{TIMESTAMP}.json"

TRADES_FILE = PROJECT_ROOT / "data" / "closed_predictions_export.txt"


def find_price_db():
    """يكتشف الـ DB اللي فيه egksco_price_history."""
    for db_path in [DB_DIR / "data_engine.db", DB_DIR / "price_history.db", DB_DIR / "market.db"]:
        if not db_path.exists(): continue
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(db_path), writable=False).__enter__()
            r = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='egksco_price_history'").fetchone()
            if r:
                cnt = conn.execute("SELECT COUNT(*) FROM egksco_price_history").fetchone()[0]
                if cnt > 0:
                    conn.close()
                    return str(db_path)
            conn.close()
        except: pass
    return None


def load_trades():
    """حمّل الـ 68 صفقة من ملف الإنتاج."""
    trades = []
    with open(TRADES_FILE) as f:
        for line in f:
            parts = line.strip().split('\t')
            if len(parts) < 15: continue
            trades.append({
                'ticker': parts[0], 'signal': parts[1],
                'pred_date': parts[2], 'entry': float(parts[3]),
                'target': float(parts[4]), 'stop': float(parts[5]),
                'outcome_date': parts[6],
                'exit_price_raw': parts[7],
                'return_pct': float(parts[8]) if parts[8] != 'None' else 0,
                'hit_target': int(parts[9]), 'hit_stop': int(parts[10]),
                'holding_days': int(parts[11]) if parts[11] else 0,
                'confidence': float(parts[12]), 'market': parts[13],
                'persona': parts[14],
            })
    return trades


def compute_metrics(trades):
    """احسب WR, PF, return, avg_hold, max_dd."""
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
    avg_hold = sum(t['holding_days'] for t in trades) / n
    total_ret = sum(t['return_pct'] for t in trades)
    # Max DD — على أساس equity curve (1% risk per trade)
    equity = 100.0
    peak = equity
    max_dd = 0
    for t in trades:
        equity += t['return_pct'] * 0.01  # 1% risk per trade
        if equity > peak: peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd: max_dd = dd
    return {
        'n': n, 'wr': wr, 'pf': pf, 'total_ret': total_ret,
        'avg_hold': avg_hold, 'max_dd': max_dd,
        'wins': len(wins), 'losses': len(losses),
    }


def resimulate_trade(conn, ticker, entry_date, entry_price, target, stop,
                     max_hold_days=7, quick_exit_pct=None):
    """إعادة محاكاة الصفقة باستخدام daily prices.
    - max_hold_days: cap على مدة الاحتفاظ
    - quick_exit_pct: لو السهم نزل أكثر من ده %، اخرج فوراً (default: None)
    """
    future = conn.execute("""
        SELECT price_date, high_price, low_price, close_price
        FROM egksco_price_history
        WHERE symbol=? AND price_date > ?
        ORDER BY price_date ASC LIMIT ?
    """, (ticker, entry_date, max_hold_days)).fetchall()
    if not future:
        return None

    quick_stop = entry_price * (1 - quick_exit_pct / 100) if quick_exit_pct else None

    for i, r in enumerate(future):
        hi = float(r[1] or 0)
        lo = float(r[2] or 0)
        cl = float(r[3] or 0)
        # وقف سريع (-5%)
        if quick_stop and lo <= quick_stop:
            return {
                'return_pct': -quick_exit_pct,
                'exit_type': 'quick_stop',
                'holding_days': i + 1,
            }
        # وقف أساسي
        if lo <= stop <= hi:
            ret = (stop - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'stop_loss', 'holding_days': i + 1}
        # هدف
        if hi >= target:
            ret = (target - entry_price) / entry_price * 100
            return {'return_pct': ret, 'exit_type': 'target_hit', 'holding_days': i + 1}
    # انتهت المدة
    last_close = float(future[-1][3] or entry_price)
    ret = (last_close - entry_price) / entry_price * 100
    return {'return_pct': ret, 'exit_type': 'expired', 'holding_days': len(future)}


def main():
    out_lines = []
    def log(msg=""):
        print(msg)
        out_lines.append(msg)

    log("╔" + "═"*78 + "╗")
    log("║" + "   التحقق من Maestro Baseline — هل الأرقام القوية لسه موجودة؟   ".center(78) + "║")
    log("╚" + "═"*78 + "╝")
    log("")
    log(f"Timestamp: {TIMESTAMP}")
    log(f"Data file: {TRADES_FILE}")
    log(f"Results: {RESULTS_DIR}")
    log("")

    # حمّل الصفقات
    trades = load_trades()
    log(f"  ✅ حمّلت {len(trades)} صفقة من ملف الإنتاج")
    log(f"  • STRONG_BUY: {sum(1 for t in trades if t['signal'] == 'STRONG_BUY')}")
    log(f"  • WATCH: {sum(1 for t in trades if t['signal'] == 'WATCH')}")
    log("")

    # الأرقام المرجعية (من worklog)
    log("─"*80)
    log("الأرقام المرجعية (من worklog BACKTEST-PRODUCTION-2026-08-31):")
    log("─"*80)
    log("  BASELINE:         68T | WR 52.9% | PF 2.79 | return +404.8% | hold 7.5d")
    log("  كل التوصيات معاً: 48T | WR 60.4% | PF 6.20 | return +440.5% | hold 2.4d")
    log("")

    # ─── 1. BASELINE ───
    log("═"*80)
    log("السيناريو 1: BASELINE (الـ 68 صفقة بالأرقام الأصلية)")
    log("═"*80)
    baseline = compute_metrics(trades)
    log(f"\n  عدد الصفقات: {baseline['n']}")
    log(f"  Win Rate: {baseline['wr']:.1f}%")
    log(f"  Profit Factor: {baseline['pf']:.2f}")
    log(f"  إجمالي العائد: {baseline['total_ret']:+.1f}%")
    log(f"  متوسط مدة الاحتفاظ: {baseline['avg_hold']:.1f} يوم")
    log(f"  Max Drawdown: {baseline['max_dd']:.2f}%")
    log(f"  رابحة: {baseline['wins']} | خاسرة: {baseline['losses']}")
    log("")

    # مقارنة بالأرقام القديمة
    log("  ── مقارنة بالأرقام القديمة ──")
    log(f"  {'المقياس':<25} {'القديم':>12} {'الحالي':>12} {'الفارق':>10} {'الحالة':>10}")
    log("  " + "─"*72)
    deltas = [
        ('عدد الصفقات', 68, baseline['n'], 'd'),
        ('Win Rate %', 52.9, baseline['wr'], 'f1'),
        ('Profit Factor', 2.79, baseline['pf'], 'f2'),
        ('إجمالي العائد %', 404.8, baseline['total_ret'], 'f1'),
        ('مدة الاحتفاظ (يوم)', 7.5, baseline['avg_hold'], 'f1'),
    ]
    for name, old, cur, fmt in deltas:
        d = cur - old
        if fmt == 'd':
            old_s = f"{old:>12}"
            cur_s = f"{cur:>12}"
            d_s = f"{d:>+10}"
        elif fmt == 'f1':
            old_s = f"{old:>11.1f}"
            cur_s = f"{cur:>11.1f}"
            d_s = f"{d:>+9.1f}"
        elif fmt == 'f2':
            old_s = f"{old:>11.2f}"
            cur_s = f"{cur:>11.2f}"
            d_s = f"{d:>+9.2f}"
        status = '✓' if (abs(d) < 0.01 if fmt == 'd' else abs(d) < 0.5) else '⚠️'
        log(f"  {name:<25} {old_s} {cur_s} {d_s} {status:>10}")
    log("")

    # ─── 2. اكتشف الـ DB للإعادة محاكاة ───
    db_path = find_price_db()
    if not db_path:
        log("⚠️ مفيش DB فيه egksco_price_history — مش هقدر أعيد المحاكاة")
        log("   هعرض BASELINE فقط.")
        results = {'baseline': baseline}
    else:
        log("─"*80)
        log(f"اكتشفت DB الأسعار: {db_path}")
        log("─"*80)
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()

        # ─── 3. إلغاء WATCH ───
        log("\n" + "═"*80)
        log("السيناريو 2: إلغاء WATCH (شيل صفقات WATCH)")
        log("═"*80)
        no_watch = [t for t in trades if t['signal'] != 'WATCH']
        # نسخ الـ return الأصلي (بدون إعادة محاكاة)
        no_watch_copy = [dict(t) for t in no_watch]
        m_no_watch = compute_metrics(no_watch_copy)
        log(f"\n  عدد الصفقات: {m_no_watch['n']} (من 68 → {m_no_watch['n']})")
        log(f"  Win Rate: {m_no_watch['wr']:.1f}%")
        log(f"  Profit Factor: {m_no_watch['pf']:.2f}")
        log(f"  إجمالي العائد: {m_no_watch['total_ret']:+.1f}%")
        log(f"  متوسط مدة الاحتفاظ: {m_no_watch['avg_hold']:.1f} يوم")
        log("")

        # ─── 4. مدة 7 أيام + خروج سريع -5% (re-simulate) ───
        log("═"*80)
        log("السيناريو 3: مدة 7 أيام + خروج سريع -5% (re-simulate على كل الصفقات)")
        log("═"*80)
        resim_trades = []
        missing = 0
        for t in trades:
            res = resimulate_trade(conn, t['ticker'], t['pred_date'],
                                    t['entry'], t['target'], t['stop'],
                                    max_hold_days=7, quick_exit_pct=5)
            if res is None:
                missing += 1
                # استخدم الـ return الأصلي
                resim_trades.append({**t, 'return_pct': t['return_pct'],
                                      'holding_days': min(t['holding_days'], 7)})
            else:
                resim_trades.append({**t, 'return_pct': res['return_pct'],
                                      'holding_days': res['holding_days']})
        m_resim = compute_metrics(resim_trades)
        log(f"\n  عدد الصفقات: {m_resim['n']} (missing price data: {missing})")
        log(f"  Win Rate: {m_resim['wr']:.1f}%")
        log(f"  Profit Factor: {m_resim['pf']:.2f}")
        log(f"  إجمالي العائد: {m_resim['total_ret']:+.1f}%")
        log(f"  متوسط مدة الاحتفاظ: {m_resim['avg_hold']:.1f} يوم")
        log(f"  Max Drawdown: {m_resim['max_dd']:.2f}%")
        log("")

        # ─── 5. كل التوصيات معاً (إلغاء WATCH + مدة 7 + خروج -5%) ───
        log("═"*80)
        log("السيناريو 4: كل التوصيات معاً (إلغاء WATCH + مدة 7 + خروج -5%)")
        log("═"*80)
        all_together = []
        missing = 0
        for t in trades:
            if t['signal'] == 'WATCH': continue  # إلغاء WATCH
            res = resimulate_trade(conn, t['ticker'], t['pred_date'],
                                    t['entry'], t['target'], t['stop'],
                                    max_hold_days=7, quick_exit_pct=5)
            if res is None:
                missing += 1
                all_together.append({**t, 'return_pct': t['return_pct'],
                                      'holding_days': min(t['holding_days'], 7)})
            else:
                all_together.append({**t, 'return_pct': res['return_pct'],
                                      'holding_days': res['holding_days']})
        m_all = compute_metrics(all_together)
        log(f"\n  عدد الصفقات: {m_all['n']} (missing: {missing})")
        log(f"  Win Rate: {m_all['wr']:.1f}%")
        log(f"  Profit Factor: {m_all['pf']:.2f}")
        log(f"  إجمالي العائد: {m_all['total_ret']:+.1f}%")
        log(f"  متوسط مدة الاحتفاظ: {m_all['avg_hold']:.1f} يوم")
        log(f"  Max Drawdown: {m_all['max_dd']:.2f}%")
        log(f"  رابحة: {m_all['wins']} | خاسرة: {m_all['losses']}")
        log("")

        # مقارنة نهائية
        log("═"*80)
        log("المقارنة النهائية: الأرقام القديمة vs الحالية")
        log("═"*80)
        log(f"\n  {'المقياس':<25} {'القديم (worklog)':>18} {'الحالي':>18} {'الفارق':>12} {'الحالة':>10}")
        log("  " + "─"*85)
        comparisons = [
            ('BASELINE: عدد الصفقات', 68, baseline['n'], 'd'),
            ('BASELINE: WR %', 52.9, baseline['wr'], 'f1'),
            ('BASELINE: PF', 2.79, baseline['pf'], 'f2'),
            ('BASELINE: Return %', 404.8, baseline['total_ret'], 'f1'),
            ('BASELINE: Hold days', 7.5, baseline['avg_hold'], 'f1'),
            ('كل التوصيات: عدد', 48, m_all['n'], 'd'),
            ('كل التوصيات: WR %', 60.4, m_all['wr'], 'f1'),
            ('كل التوصيات: PF', 6.20, m_all['pf'], 'f2'),
            ('كل التوصيات: Return %', 440.5, m_all['total_ret'], 'f1'),
            ('كل التوصيات: Hold days', 2.4, m_all['avg_hold'], 'f1'),
        ]
        for name, old, cur, fmt in comparisons:
            d = cur - old
            if fmt == 'd':
                old_s = f"{old:>18}"
                cur_s = f"{cur:>18}"
                d_s = f"{d:>+12}"
                status = '✓' if abs(d) <= 1 else '⚠️'
            elif fmt == 'f1':
                old_s = f"{old:>17.1f}"
                cur_s = f"{cur:>17.1f}"
                d_s = f"{d:>+11.1f}"
                status = '✓' if abs(d) < 1.0 else '⚠️'
            elif fmt == 'f2':
                old_s = f"{old:>17.2f}"
                cur_s = f"{cur:>17.2f}"
                d_s = f"{d:>+11.2f}"
                status = '✓' if abs(d) < 1.0 else '⚠️'
            log(f"  {name:<25} {old_s} {cur_s} {d_s} {status:>10}")
        log("")

        # ─── الحكم ───
        log("═"*80)
        log("الحكم النهائي")
        log("═"*80)
        baseline_ok = (abs(baseline['n'] - 68) <= 1
                       and abs(baseline['wr'] - 52.9) < 2
                       and abs(baseline['pf'] - 2.79) < 0.5)
        all_ok = (abs(m_all['n'] - 48) <= 5
                  and m_all['wr'] >= 55
                  and m_all['pf'] >= 4.0)

        log(f"\n  BASELINE مطابق للأرقام القديمة: {'✅ نعم' if baseline_ok else '❌ لأ'}")
        log(f"  'كل التوصيات معاً' لسه قوي: {'✅ نعم' if all_ok else '❌ لأ'}")
        log("")
        if baseline_ok and all_ok:
            verdict = "✅ المحرك الأساسي لسه شغال بالأرقام القوية. مفيش حاجة اتضرب."
        elif baseline_ok and not all_ok:
            verdict = "⚠️ BASELINE سليم بس 'كل التوصيات معاً' ضعف. فيه تعديل أثر على الـ re-simulation."
        else:
            verdict = "❌ الأرقام القوية ضاعت. لازم نحدد إيه اللي اتغير."
        log(f"  القرار: {verdict}")

        conn.close()
        results = {
            'baseline': baseline,
            'no_watch': m_no_watch,
            'resim_7d_q5': m_resim,
            'all_together': m_all,
            'verdict': verdict,
        }

    # احفظ النتائج
    with open(TXT_OUTPUT, 'w', encoding='utf-8') as f:
        f.write("\n".join(out_lines))
    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump({k: v for k, v in results.items()}, f, indent=2, ensure_ascii=False, default=str)

    print("\n" + "═"*80)
    print("✅ تم حفظ النتائج:")
    print(f"  📄 Text:  {TXT_OUTPUT}")
    print(f"  📊 JSON:  {JSON_OUTPUT}")
    print("═"*80)


if __name__ == '__main__':
    main()
