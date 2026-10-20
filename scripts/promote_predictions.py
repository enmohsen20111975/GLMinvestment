#!/usr/bin/env python3
"""
BRAVO-PROMOTION-LOGIC-1
=======================
ترقية التوقعات من 'testing' → 'proven' بناءً على الأداء التاريخي.

الـ lifecycle:
  testing  → توقع جديد (staging lane — ألفا بـ تعرضه في «تحت الاختبار»)
  proven   → توقع نشط تم ترقيته (main lane — «التوقعات الأساسية»)
  closed   → توقع مقفول (outcome_date NOT NULL — daily_closer بيكتبه)

منطق الترقية:
  لكل persona:
    1. اجمع آخر N توقع مقفول (status='closed') — default N=20
    2. احسب:
       - wins     = توقعات hit_target=1
       - losses   = توقعات hit_stop=1
       - PF       = sum(positive actual_return) / abs(sum(negative actual_return))
       - win_rate = wins / total
    3. قاعدة الترقية (ممحوسن طلبها):
       PF > 1.5  AND  wins >= 3
       → UPDATE predictions SET status='proven'
         WHERE persona=? AND status='testing' AND outcome_date IS NULL
    4. قاعدة الـ demotion (اختياري — --demote):
       PF < 0.8  AND  losses >= 3
       → التوقعات testing تفضل testing (ما تـ promoteش) + log تحذير

الأمان:
  - dry-run mode (--dry-run): يـحسب ويـ log من غير ما يـ UPDATE
  - transaction كامل
  - backup تلقائي قبل التنفيذ
  - log مفصل لكل persona (PF, wins, losses, decision)

الاستخدام:
  python3 scripts/promote_predictions.py --dry-run          # شوف بس
  python3 scripts/promote_predictions.py                    # نفّذ
  python3 scripts/promote_predictions.py --window 30        # آخر 30 توقع مقفول
  python3 scripts/promote_predictions.py --pf-threshold 1.5 --min-wins 3
"""
import sqlite3
import shutil
import os
import sys
import argparse
import json
from datetime import datetime
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "db" / "predictions.db"
BACKUP_DIR = PROJECT_ROOT / "db" / "backups"

# قواعد الترقية الافتراضية (محسن طلبها)
DEFAULT_PF_THRESHOLD = 1.5
DEFAULT_MIN_WINS = 3
DEFAULT_WINDOW = 20  # آخر 20 توقع مقفول لكل persona


def log(msg):
    print(f"  {msg}", flush=True)


def compute_persona_stats(con, persona, window):
    """احسب إحصائيات الأداء لـ persona من التوقعات المقفولة."""
    cur = con.cursor()
    rows = cur.execute("""
        SELECT hit_target, hit_stop, actual_return, exit_type, outcome_date
        FROM predictions
        WHERE persona = ?
          AND status = 'closed'
          AND outcome_date IS NOT NULL
        ORDER BY outcome_date DESC
        LIMIT ?
    """, (persona, window)).fetchall()

    if not rows:
        return None

    wins = sum(1 for r in rows if r[0] == 1)  # hit_target=1
    losses = sum(1 for r in rows if r[1] == 1)  # hit_stop=1
    total = len(rows)

    pos_returns = sum(r[2] for r in rows if r[2] and r[2] > 0)
    neg_returns = abs(sum(r[2] for r in rows if r[2] and r[2] < 0))

    pf = pos_returns / neg_returns if neg_returns > 0 else (float('inf') if pos_returns > 0 else 0.0)
    win_rate = (wins / total * 100) if total > 0 else 0.0
    avg_return = (sum(r[2] for r in rows if r[2]) / total) if total > 0 else 0.0

    return {
        'persona': persona,
        'sample_size': total,
        'wins': wins,
        'losses': losses,
        'other': total - wins - losses,  # expired/breakeven
        'pf': round(pf, 3),
        'win_rate': round(win_rate, 1),
        'avg_return': round(avg_return, 2),
        'pos_returns_sum': round(pos_returns, 2),
        'neg_returns_sum': round(neg_returns, 2),
    }


def get_testing_count(con, persona):
    """عد التوقعات testing المفتوحة لـ persona."""
    cur = con.cursor()
    row = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE persona = ? AND status = 'testing' AND outcome_date IS NULL
    """, (persona,)).fetchone()
    return row[0]


def run_promotion(db_path, pf_threshold, min_wins, window, dry_run=False):
    if not db_path.exists():
        print(f"ERROR: DB not found: {db_path}", file=sys.stderr)
        return 1

    print(f"=" * 60)
    print(f"BRAVO-PROMOTION-LOGIC-1")
    print(f"DB: {db_path}")
    print(f"mode: {'DRY-RUN (no changes)' if dry_run else 'EXECUTE'}")
    print(f"rules: PF > {pf_threshold} AND wins >= {min_wins} | window={window}")
    print(f"=" * 60)

    # --- 1. Backup ---
    if not dry_run:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%dT%H%M%S")
        backup_path = BACKUP_DIR / f"predictions.db.pre-promotion.{ts}"
        print(f"\n[1/3] Backup → {backup_path}")
        shutil.copy2(db_path, backup_path)
        log(f"backup size: {backup_path.stat().st_size / 1e6:.1f} MB")
    else:
        print(f"\n[1/3] Backup (skipped — dry-run)")

    # --- 2. Compute stats per persona ---
    print(f"\n[2/3] Computing performance per persona")
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row

    # اكتشف كل personas اللي عندها توقعات testing
    cur = con.cursor()
    personas = [r[0] for r in cur.execute("""
        SELECT DISTINCT persona FROM predictions
        WHERE status = 'testing' AND outcome_date IS NULL AND persona IS NOT NULL
    """).fetchall()]

    if not personas:
        log("no personas with testing predictions → nothing to promote")
        con.close()
        print(f"\n{'='*60}\n✅ DONE — no testing predictions to evaluate")
        return 0

    log(f"personas with testing predictions: {len(personas)}")
    decisions = []
    for persona in personas:
        stats = compute_persona_stats(con, persona, window)
        testing_count = get_testing_count(con, persona)
        if stats is None:
            log(f"\n  [{persona}] no closed predictions yet — cannot evaluate")
            log(f"    testing predictions: {testing_count} (will stay testing)")
            decisions.append({'persona': persona, 'action': 'skip', 'reason': 'no_history', 'testing': testing_count})
            continue

        promote = stats['pf'] > pf_threshold and stats['wins'] >= min_wins
        action = 'promote' if promote else 'hold'
        reason = (f"PF={stats['pf']} > {pf_threshold} AND wins={stats['wins']} >= {min_wins}"
                  if promote else
                  f"PF={stats['pf']} or wins={stats['wins']} below threshold")

        log(f"\n  [{persona}]")
        log(f"    closed sample: {stats['sample_size']} (window={window})")
        log(f"    wins={stats['wins']}  losses={stats['losses']}  other={stats['other']}")
        log(f"    PF={stats['pf']}  win_rate={stats['win_rate']}%  avg_return={stats['avg_return']}%")
        log(f"    testing predictions (open): {testing_count}")
        log(f"    decision: {action.upper()} — {reason}")

        decisions.append({
            'persona': persona, 'action': action, 'reason': reason,
            'testing': testing_count, 'stats': stats
        })

    # --- 3. Execute promotions ---
    print(f"\n[3/3] Execute promotions")
    if dry_run:
        log("(dry-run — no UPDATEs)")
        total_would_promote = sum(d['testing'] for d in decisions if d['action'] == 'promote')
        log(f"would promote: {total_would_promote} predictions")
    else:
        total_promoted = 0
        try:
            cur = con.cursor()
            cur.execute("BEGIN IMMEDIATE TRANSACTION;")
            for d in decisions:
                if d['action'] != 'promote':
                    continue
                r = cur.execute("""
                    UPDATE predictions SET status = 'proven'
                    WHERE persona = ? AND status = 'testing' AND outcome_date IS NULL
                """, (d['persona'],))
                log(f"  [{d['persona']}] promoted {r.rowcount} testing → proven")
                total_promoted += r.rowcount
            con.commit()
            log(f"\nCOMMITTED ✓ — total promoted: {total_promoted}")
        except Exception as e:
            con.rollback()
            log(f"ROLLBACK — error: {e}")
            con.close()
            return 2

    # --- Summary ---
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    for d in decisions:
        status_emoji = '🟢' if d['action'] == 'promote' else '🟡' if d['action'] == 'hold' else '⚪'
        s = d.get('stats', {})
        pf_str = f"PF={s.get('pf','?')}" if s else "no history"
        print(f"  {status_emoji} {d['persona']:20s} {d['action']:8s} | {pf_str} | testing={d['testing']}")

    con.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description="Promote predictions testing→proven based on performance")
    parser.add_argument("--dry-run", action="store_true", help="Show decisions without executing")
    parser.add_argument("--db", default=str(DB_PATH), help="Path to predictions.db")
    parser.add_argument("--pf-threshold", type=float, default=DEFAULT_PF_THRESHOLD, help="Min Profit Factor to promote")
    parser.add_argument("--min-wins", type=int, default=DEFAULT_MIN_WINS, help="Min wins in window to promote")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW, help="Number of recent closed predictions to evaluate")
    args = parser.parse_args()
    return run_promotion(Path(args.db), args.pf_threshold, args.min_wins, args.window, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
