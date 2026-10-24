#!/usr/bin/env python3
"""
Phase-1 Monitor — راقب الـ guards لمدة أسبوع.

قرار المالك: "رافق أسبوع: متوسط planned R:R، عدد [RR_DIR_FIX]،
وهل لسه في stops ~10%+ وأهداف ~3%".

ده سكربت قياس (read-only) بـ يقرأ:
  1. predictions.db — للـ trades الحديثة (آخر N يوم): planned R:R، stop%، target%.
  2. الـ log file (dev.log / python_backend.log) — عدّ [ATR_STOP] / [RR_DIR_FIX] /
     [RR_PLAN] / [STOCK_ALIVE] / [RR_REJECT].

Usage:
    python scripts/phase1_monitor.py
    python scripts/phase1_monitor.py --days 7 --pred-db db/predictions.db
    python scripts/phase1_monitor.py --days 14 --log /path/to/python_backend.log

Acceptance (الأسبوع اللي بيقول إن الـ guards شغّالة):
  ✓ avg planned R:R ≥ 1.5 (لازم، بعد enforce_min_rr)
  ✓ 0% trades بـ stop ≥ 10% (الـ ATR stop بـ cap عند 8%)
  ✓ 0% trades بـ target ≤ 3% (بعد enforce_min_rr بيوسّع لـ R:R≥1.5)
  ✓ 0% trades بـ R:R < 1.5 (ممنوع بعد الـ guard)
  ✓ [ATR_STOP] ظاهر في الـ log (الـ guard شغّال)
  ✓ [RR_DIR_FIX] ظاهر لو فيه bugs بتـ catch (مؤشر إن الـ bug لسه موجود)
"""
import argparse
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timedelta

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

BUY_SIGNALS = ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY',
               'buy', 'strong_buy', 'accumulate', 't1_buy', 'swing_buy')


def _f(v, default=0.0):
    try:
        x = float(v)
        return x if x == x else default  # NaN check
    except (TypeError, ValueError):
        return default


def pct(x, total):
    return f"{(x / total * 100):.1f}%" if total > 0 else "0%"


def median(vals):
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def avg(vals):
    return sum(vals) / len(vals) if vals else 0.0


# ──────────────────────────────────────────────────────────────────────────────
# DB scan
# ──────────────────────────────────────────────────────────────────────────────

def scan_predictions(pred_db, days):
    """اقرأ الـ trades الحديثة واحسب planned R:R / stop% / target%."""
    if not os.path.exists(pred_db):
        print(f"[WARN] predictions DB not found: {pred_db}")
        return None

    cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(pred_db, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # كل التوقعات في آخر N يوم (مش بس المقفولة — عشان نقيس الـ planned R:R)
    try:
        cur.execute("""
            SELECT ticker, signal, persona, entry_price, target_price, stop_loss,
                   atr_at_entry, created_at, actual_return, outcome_date, exit_type
            FROM predictions
            WHERE created_at >= ?
            ORDER BY created_at DESC
        """, (cutoff,))
        rows = [dict(r) for r in cur.fetchall()]
    except sqlite3.OperationalError as e:
        print(f"[ERROR] DB query failed: {e}")
        conn.close()
        return None
    conn.close()

    if not rows:
        print(f"[INFO] No predictions in last {days} days in {pred_db}")
        return None

    # فلتر BUY signals بس (الـ guards بتشتغل عليهم)
    buy_rows = [r for r in rows if (r.get('signal') or '').upper().strip() in BUY_SIGNALS]
    if not buy_rows:
        print(f"[INFO] {len(rows)} predictions in last {days}d, but 0 BUY signals")
        return {
            'total': len(rows), 'buy': 0, 'days': days,
            'rrs': [], 'stop_pcts': [], 'target_pcts': [],
            'stop_ge_10': 0, 'target_le_3': 0, 'rr_lt_15': 0,
            'has_atr': 0, 'closed': 0, 'wins': 0,
        }

    rrs = []
    stop_pcts = []
    target_pcts = []
    stop_ge_10 = 0
    target_le_3 = 0
    rr_lt_15 = 0
    has_atr = 0
    closed = 0
    wins = 0

    for r in buy_rows:
        entry = _f(r.get('entry_price'))
        target = _f(r.get('target_price'))
        stop = _f(r.get('stop_loss'))
        atr = _f(r.get('atr_at_entry'))

        if entry <= 0 or stop <= 0:
            continue

        stop_pct = (entry - stop) / entry * 100
        target_pct = (target - entry) / entry * 100 if target > 0 else 0
        rr = (target - entry) / (entry - stop) if (entry - stop) > 0 and target > 0 else 0

        rrs.append(rr)
        stop_pcts.append(stop_pct)
        target_pcts.append(target_pct)

        if stop_pct >= 10:
            stop_ge_10 += 1
        if target_pct <= 3 and target_pct > 0:
            target_le_3 += 1
        if rr < 1.5 and rr > 0:
            rr_lt_15 += 1
        if atr > 0:
            has_atr += 1

        if r.get('actual_return') is not None:
            closed += 1
            if _f(r.get('actual_return')) > 0:
                wins += 1

    return {
        'total': len(rows), 'buy': len(buy_rows), 'days': days,
        'rrs': rrs, 'stop_pcts': stop_pcts, 'target_pcts': target_pcts,
        'stop_ge_10': stop_ge_10, 'target_le_3': target_le_3, 'rr_lt_15': rr_lt_15,
        'has_atr': has_atr, 'closed': closed, 'wins': wins,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Log scan
# ──────────────────────────────────────────────────────────────────────────────

def scan_logs(log_path, days):
    """عدّ [ATR_STOP] / [RR_DIR_FIX] / [RR_PLAN] / [STOCK_ALIVE] / [RR_REJECT] في الـ log."""
    if not log_path or not os.path.exists(log_path):
        print(f"[WARN] Log file not found: {log_path}")
        return None

    cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    counts = Counter()
    samples = {}

    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                # فلتر بس آخر N يوم (بناءً على timestamps في الـ log لو موجودة)
                for tag in ('[ATR_STOP]', '[RR_DIR_FIX]', '[RR_PLAN]', '[RR_REJECT]',
                            '[STOCK_ALIVE]', '[RR_GUARD_ERR]'):
                    if tag in line:
                        counts[tag] += 1
                        if tag not in samples:
                            samples[tag] = line.strip()[:200]
    except Exception as e:
        print(f"[ERROR] Failed to read log: {e}")
        return None

    return {'counts': dict(counts), 'samples': samples, 'log_path': log_path}


# ──────────────────────────────────────────────────────────────────────────────
# Report
# ──────────────────────────────────────────────────────────────────────────────

def print_report(db_stats, log_stats):
    print()
    print("=" * 72)
    print("  PHASE-1 MONITOR — تقرير الـ guards (ATR stop + direction + R:R)")
    print("=" * 72)

    if db_stats:
        n = db_stats['buy']
        print(f"\n┌─ PREDICTIONS DB (آخر {db_stats['days']} يوم)")
        print(f"│  إجمالي التوقعات:     {db_stats['total']}")
        print(f"│  BUY signals:         {n}")
        print(f"│  مقفولة:              {db_stats['closed']}  (wins: {db_stats['wins']})")
        print(f"│  عندهم atr_at_entry:  {db_stats['has_atr']} / {n}")

        if n > 0 and db_stats['rrs']:
            rrs = db_stats['rrs']
            stops = db_stats['stop_pcts']
            targets = db_stats['target_pcts']

            print(f"\n│  ── Planned R:R ──")
            print(f"│  avg:     {avg(rrs):.2f}")
            print(f"│  median:  {median(rrs):.2f}")
            print(f"│  min:     {min(rrs):.2f}")
            print(f"│  max:     {max(rrs):.2f}")

            print(f"\n│  ── Stop % (entry→stop) ──")
            print(f"│  avg:     {avg(stops):.2f}%")
            print(f"│  median:  {median(stops):.2f}%")
            print(f"│  min:     {min(stops):.2f}%")
            print(f"│  max:     {max(stops):.2f}%")

            print(f"\n│  ── Target % (entry→target) ──")
            print(f"│  avg:     {avg(targets):.2f}%")
            print(f"│  median:  {median(targets):.2f}%")
            print(f"│  min:     {min(targets):.2f}%")
            print(f"│  max:     {max(targets):.2f}%")

            print(f"\n│  ── RED FLAGS (المفروض 0 بعد الـ guards) ──")
            print(f"│  stops ≥ 10%:      {db_stats['stop_ge_10']:>4d} / {n}  {pct(db_stats['stop_ge_10'], n)}")
            print(f"│  targets ≤ 3%:     {db_stats['target_le_3']:>4d} / {n}  {pct(db_stats['target_le_3'], n)}")
            print(f"│  R:R < 1.5:        {db_stats['rr_lt_15']:>4d} / {n}  {pct(db_stats['rr_lt_15'], n)}")

            # Verdict
            print(f"\n│  ── ACCEPTANCE ──")
            ok = True
            if avg(rrs) < 1.5:
                print(f"│  ✗ avg R:R {avg(rrs):.2f} < 1.5 — الـ R:R guard مش شغّال")
                ok = False
            else:
                print(f"│  ✓ avg R:R {avg(rrs):.2f} ≥ 1.5")
            if db_stats['stop_ge_10'] > 0:
                print(f"│  ✗ فيه {db_stats['stop_ge_10']} صفقة stop ≥ 10% — الـ ATR stop مش شغّال أو اتـ skip")
                ok = False
            else:
                print(f"│  ✓ مفيش stops ≥ 10% (ATR stop بـ cap عند 8%)")
            if db_stats['target_le_3'] > 0:
                print(f"│  ⚠ فيه {db_stats['target_le_3']} صفقة target ≤ 3% — محتاج مراجعة")
            else:
                print(f"│  ✓ مفيش targets ≤ 3%")
            if db_stats['rr_lt_15'] > 0:
                print(f"│  ✗ فيه {db_stats['rr_lt_15']} صفقة R:R < 1.5 — الـ guard فشل")
                ok = False
            else:
                print(f"│  ✓ كل الصفقات R:R ≥ 1.5")
            print(f"│  {'= ACCEPTANCE PASS' if ok else '= ACCEPTANCE FAIL — راجع الـ logs'}")
        else:
            print(f"\n│  (مفيش BUY signals كافية للقياس في آخر {db_stats['days']} يوم)")

    if log_stats:
        print(f"\n┌─ LOG SCAN ({log_stats['log_path']})")
        counts = log_stats['counts']
        if not counts:
            print(f"│  مفيش tags للـ guards في الـ log.")
            print(f"│  محتاج تشغّل الـ backend علشان الـ guards تـ log.")
        else:
            for tag in ('[ATR_STOP]', '[RR_DIR_FIX]', '[RR_PLAN]', '[RR_REJECT]',
                        '[STOCK_ALIVE]', '[RR_GUARD_ERR]'):
                c = counts.get(tag, 0)
                marker = '✓' if c > 0 else '·'
                print(f"│  {marker} {tag:20s} = {c}")
            print(f"\n│  ── عيّنات (أول ظهور) ──")
            for tag, sample in log_stats['samples'].items():
                print(f"│  {tag}: {sample[:120]}")

    print()
    print("=" * 72)
    print("  ملاحظات:")
    print("  • [ATR_STOP] = الـ guard بدّل الـ fixed-% stop بـ ATR-based stop")
    print("  • [RR_DIR_FIX] = الـ guard لقى target ≤ entry وأصلحه (مؤشر للـ bug)")
    print("  • [RR_PLAN] = الـ guard وسّع الـ target لـ R:R ≥ 1.5")
    print("  • [STOCK_ALIVE] = فلتر الحي (LOG ONLY — ENFORCE=False)")
    print("  • [RR_REJECT] = صفقة اترفضت (inverted R:R أو entry≤0)")
    print("=" * 72)
    print()


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Phase-1 Monitor — راقب الـ guards')
    parser.add_argument('--days', type=int, default=7, help='عدد الأيام للرصد (default 7)')
    parser.add_argument('--pred-db', default='db/predictions.db', help='path to predictions.db')
    parser.add_argument('--log', default=None, help='path to log file (default: auto-detect)')
    args = parser.parse_args()

    # Auto-detect log file
    log_path = args.log
    if not log_path:
        for candidate in ('python_backend.log', 'dev.log', '/home/z/my-project/python_backend.log',
                          '/home/z/my-project/dev.log'):
            if os.path.exists(candidate):
                log_path = candidate
                break

    print(f"[Phase-1 Monitor] days={args.days} pred_db={args.pred_db} log={log_path or 'NOT FOUND'}")

    db_stats = scan_predictions(args.pred_db, args.days)
    log_stats = scan_logs(log_path, args.days) if log_path else None
    print_report(db_stats, log_stats)


if __name__ == '__main__':
    main()
