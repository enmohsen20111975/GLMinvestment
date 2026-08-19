#!/usr/bin/env python3
"""
purge_prediction_disasters.py — غسيل التاريخ السام من predictions.db
====================================================================

WHY
---
الإنتاج كان عنده:
  - avg actual_return الخام ≈ −3163% (رقم كاذب من صفوف AGIN/UNFO)
  - outcome_date = 0 للكل (الـ closer كان واقف)
  - target سالب، entry تافه (0.002)، stop≥entry، exit/entry = 23000×
  - is_correct كان بـ يتحدد من target_hit لوحده (كاذب)

السكربت ده بـ يعمل غسيل مرة واحدة (idempotent):

  1. Backup تلقائي لـ predictions.db → db/backups/predictions_*.db
  2. إضافة أعمدة إن نقصت: data_quality, quality_flags
  3. إعادة حساب actual_return من entry + (actual_exit_price|exit_price)
     BUY:  (exit-entry)/entry*100
     SELL: (entry-exit)/entry*100
  4. is_correct = (actual_return > 0) فقط — ممنوع من target_hit وحده
  5. تعليم clean/toxic/pending (من data_quality_rules)
  6. Backfill highest_price_reached / lowest_price_reached من price_history
     مع مطابقة ticker (raw/upper/strip + stock_ticker + variants)
  7. تقرير JSON تحت db/backups/purge_report_*.json

الاستخدام:
    python3 scripts/purge_prediction_disasters.py \\
        --pred-db db/predictions.db \\
        --ph-db   db/price_history.db \\
        --dry-run

    python3 scripts/purge_prediction_disasters.py \\
        --pred-db db/predictions.db \\
        --ph-db   db/price_history.db \\
        --apply

الـ dry-run بـ يطبع نفس التقرير بدون أي كتابة (ما عدا الـ backup دائماً).
الـ apply بـ ينفّذ كل الخطوات.
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# دعم الاستيراد من نفس المجلد
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from data_quality_rules import (  # noqa: E402
    CLEAN, TOXIC, PENDING,
    validate_write, classify_quality, compute_quality_flags,
    compute_return, normalize_ticker, ticker_variants,
    is_buy_signal, is_sell_signal, is_known_signal,
    ensure_quality_columns, RECOMPUTE_RETURN_SQL, CLEAN_WHERE,
    KNOWN_SIGNALS, MAX_REASONABLE_RETURN, MIN_ENTRY_PRICE,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _f(v, default=0.0):
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _connect(db_path: str) -> sqlite3.Connection:
    """اتصال WAL + busy_timeout (نفس patch الـ daily_closer)."""
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    return conn


def _has_column(conn, table, column):
    try:
        cur = conn.execute(f"PRAGMA table_info({table})")
        for row in cur.fetchall():
            if row[1].lower() == column.lower():
                return True
    except Exception:
        pass
    return False


def _date_str(val) -> str:
    """[:10] بس — '2026-01-15 14:30:00' → '2026-01-15'."""
    if not val:
        return ''
    return str(val)[:10]


def backup_db(db_path: str, backup_dir: str) -> str:
    """Backup تلقائي لـ predictions.db قبل أي تعديل."""
    os.makedirs(backup_dir, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = os.path.join(backup_dir, f'predictions_backup_{ts}.db')
    shutil.copy2(db_path, backup_path)
    return backup_path


# ──────────────────────────────────────────────────────────────────────────────
# Step 1: إضافة الأعمدة الناقصة
# ──────────────────────────────────────────────────────────────────────────────

def step_ensure_columns(conn) -> list:
    """أضف data_quality + quality_flags لو مش موجودين. Returns added cols."""
    return ensure_quality_columns(conn, 'predictions')


# ──────────────────────────────────────────────────────────────────────────────
# Step 2: إعادة حساب actual_return + is_correct
# ──────────────────────────────────────────────────────────────────────────────

def step_recompute_returns(conn, apply: bool) -> dict:
    """أعد حساب actual_return من entry + exit، و is_correct من علامة العائد."""
    cur = conn.cursor()

    # حدد عمود الـ exit الفعلي
    if _has_column(conn, 'predictions', 'actual_exit_price'):
        exit_col = 'actual_exit_price'
    elif _has_column(conn, 'predictions', 'exit_price'):
        exit_col = 'exit_price'
    else:
        exit_col = 'NULL'
    has_signal_type = _has_column(conn, 'predictions', 'signal_type')
    st_col = 'signal_type' if has_signal_type else "'' AS signal_type"

    # جيب كل الصفوف المقفولة اللي ليها exit price
    cur.execute(f"""
        SELECT id, ticker, signal, {st_col}, entry_price, target_price, stop_loss,
               {exit_col} AS exit_price, actual_return, is_correct, outcome_date
        FROM predictions
        WHERE outcome_date IS NOT NULL
    """)
    rows = cur.fetchall()

    stats = {
        'scanned': len(rows),
        'return_corrected': 0,
        'is_correct_corrected': 0,
        'no_exit_price': 0,
        'sample_corrections': [],
    }

    updates = []
    for r in rows:
        entry = _f(r['entry_price'])
        exit_price = _f(r['exit_price'])
        signal = r['signal'] or r['signal_type'] or ''
        old_ret = _f(r['actual_return'])

        if exit_price <= 0 or entry <= 0:
            stats['no_exit_price'] += 1
            continue

        new_ret = compute_return(entry, exit_price, signal)

        # is_correct من علامة العائد بس (مش target_hit).
        # compute_return direction-aware: SELL profitable → return > 0 (زي BUY).
        # فـ is_correct = (return > 0) للكل — مش محتاجين نميّز BUY/SELL هنا.
        if is_known_signal(signal):
            new_is_correct = 1 if new_ret > 0 else 0
        else:
            new_is_correct = None  # signal مش معروف → NULL

        # هل اتغير الـ return بشكل جوهري (>1pp)؟
        if abs(new_ret - old_ret) > 1.0:
            stats['return_corrected'] += 1
            if len(stats['sample_corrections']) < 10:
                stats['sample_corrections'].append({
                    'id': r['id'], 'ticker': r['ticker'], 'signal': signal,
                    'entry': entry, 'exit': exit_price,
                    'old_return': round(old_ret, 2), 'new_return': round(new_ret, 2),
                })

        # هل اتغير is_correct؟ (الـ bug الكبير: target_hit=1 بس return سالب)
        old_is_correct = r['is_correct']
        if new_is_correct is not None and old_is_correct is not None:
            if int(new_is_correct) != int(old_is_correct):
                stats['is_correct_corrected'] += 1

        updates.append((round(new_ret, 4), new_is_correct, r['id']))

    if apply and updates:
        cur.executemany(
            "UPDATE predictions SET actual_return = ?, is_correct = ? WHERE id = ?",
            updates
        )
        conn.commit()

    return stats


# ──────────────────────────────────────────────────────────────────────────────
# Step 3: Backfill highest_price_reached / lowest_price_reached
# ──────────────────────────────────────────────────────────────────────────────

def _find_ticker_match(ph_conn, ticker, stock_ticker=None) -> str:
    """جرّب كل variants لحد ما نلاقي match في price_history. Returns matched ticker or ''."""
    candidates = []
    if ticker:
        candidates.append(normalize_ticker(ticker))
        candidates.extend(ticker_variants(ticker))
    if stock_ticker:
        candidates.append(normalize_ticker(stock_ticker))
        candidates.extend(ticker_variants(stock_ticker))
    # dedup
    seen = set()
    candidates = [c for c in candidates if c and c not in seen and not seen.add(c)]

    cur = ph_conn.cursor()
    for cand in candidates:
        try:
            cur.execute(
                "SELECT COUNT(*) FROM price_history WHERE ticker = ?",
                (cand,)
            )
            cnt = cur.fetchone()[0]
            if cnt > 0:
                return cand
        except sqlite3.OperationalError:
            # table مش موجودة على sandbox
            return ''
    return ''


def step_backfill_highs_lows(conn, ph_conn, apply: bool) -> dict:
    """Backfill highest_price_reached / lowest_price_reached من price_history."""
    if not ph_conn:
        return {'skipped': True, 'reason': 'price_history.db not available'}

    # تحقّق إن جدول price_history موجود
    try:
        ph_conn.execute("SELECT 1 FROM price_history LIMIT 1")
    except sqlite3.OperationalError as e:
        return {'skipped': True, 'reason': f'price_history table: {e}'}

    cur = conn.cursor()
    has_stock_ticker = _has_column(conn, 'predictions', 'stock_ticker')
    st_col = 'stock_ticker' if has_stock_ticker else 'NULL AS stock_ticker'

    cur.execute(f"""
        SELECT id, ticker, {st_col}, signal, entry_price,
               prediction_date, created_at, outcome_date,
               highest_price_reached, lowest_price_reached
        FROM predictions
        WHERE outcome_date IS NOT NULL
    """)
    rows = cur.fetchall()

    stats = {
        'scanned': len(rows),
        'filled': 0,
        'already_filled': 0,
        'no_ticker_match': 0,
        'no_window': 0,
        'ticker_match_examples': [],
    }

    # cache لـ ticker matches (نفس الـ ticker بـ يتكرر)
    ticker_match_cache = {}

    updates = []
    for r in rows:
        ticker = r['ticker']
        stock_ticker = r['stock_ticker'] if has_stock_ticker else None
        entry = _f(r['entry_price'])
        pred_date = _date_str(r['prediction_date'] or str(r['created_at'] or ''))
        outcome_date = _date_str(r['outcome_date'])

        if not pred_date or not outcome_date:
            stats['no_window'] += 1
            continue

        # ابحث عن الـ ticker match (cached)
        if ticker not in ticker_match_cache:
            matched = _find_ticker_match(ph_conn, ticker, stock_ticker)
            ticker_match_cache[ticker] = matched
            if matched and len(stats['ticker_match_examples']) < 15:
                stats['ticker_match_examples'].append({
                    'pred_ticker': ticker,
                    'stock_ticker': stock_ticker,
                    'matched_to': matched,
                })
        matched_ticker = ticker_match_cache[ticker]

        if not matched_ticker:
            stats['no_ticker_match'] += 1
            continue

        # اقرأ أعلى/أقل سعر في النافذة (من اليوم اللي بعد الدخول لحد الإغلاق)
        # skip entry day (date == pred_date) عشان "reached" = بعد الدخول
        try:
            ph_cur = ph_conn.cursor()
            ph_cur.execute("""
                SELECT MAX(high_price) AS max_high, MIN(low_price) AS min_low
                FROM price_history
                WHERE ticker = ? AND date > ? AND date <= ?
                  AND high_price > 0 AND low_price > 0
            """, (matched_ticker, pred_date, outcome_date))
            ph_row = ph_cur.fetchone()
        except sqlite3.OperationalError:
            stats['no_ticker_match'] += 1
            continue

        if not ph_row:
            stats['no_window'] += 1
            continue

        max_high = _f(ph_row['max_high'])
        min_low = _f(ph_row['min_low'])

        # sanity: تجاهل قيم سبليت (high > 5× entry أو low < 0.2× entry)
        if entry > 0:
            if max_high > entry * 5.0:
                max_high = 0.0
            if min_low > 0 and min_low < entry * 0.2:
                min_low = 0.0

        old_high = _f(r['highest_price_reached'])
        old_low = _f(r['lowest_price_reached'])

        # اكتب بس لو فاضي أو القيمة الجديدة أكبر (للـ high) / أصغر (للـ low)
        write_high = max_high if (max_high > 0 and (old_high <= 0 or max_high > old_high)) else None
        write_low = min_low if (min_low > 0 and (old_low <= 0 or min_low < old_low)) else None

        if write_high is not None or write_low is not None:
            updates.append((write_high, write_low, r['id']))
            stats['filled'] += 1
        else:
            stats['already_filled'] += 1

    if apply and updates:
        cur.executemany(
            "UPDATE predictions SET highest_price_reached = COALESCE(?, highest_price_reached), "
            "lowest_price_reached = COALESCE(?, lowest_price_reached) WHERE id = ?",
            updates
        )
        conn.commit()

    return stats


# ──────────────────────────────────────────────────────────────────────────────
# Step 4: تعليم data_quality + quality_flags
# ──────────────────────────────────────────────────────────────────────────────

def step_mark_quality(conn, apply: bool) -> dict:
    """صنّف كل صف إلى clean/toxic/pending واكتب data_quality + quality_flags."""
    cur = conn.cursor()

    # عمود الـ exit: actual_exit_price (الأحدث) أو exit_price (القديم) أو NULL
    if _has_column(conn, 'predictions', 'actual_exit_price'):
        exit_col = 'actual_exit_price'
    elif _has_column(conn, 'predictions', 'exit_price'):
        exit_col = 'exit_price'
    else:
        exit_col = 'NULL'
    has_signal_type = _has_column(conn, 'predictions', 'signal_type')
    st_col = 'signal_type' if has_signal_type else "'' AS signal_type"

    cur.execute(f"""
        SELECT id, ticker, signal, {st_col}, entry_price, target_price, stop_loss,
               actual_return, {exit_col} AS exit_price, outcome_date
        FROM predictions
    """)
    rows = cur.fetchall()

    stats = {'total': len(rows), 'clean': 0, 'toxic': 0, 'pending': 0,
             'toxic_samples': [], 'clean_signals': {}}

    updates = []
    for r in rows:
        row_dict = {
            'outcome_date': r['outcome_date'],
            'entry_price': r['entry_price'],
            'target_price': r['target_price'],
            'stop_loss': r['stop_loss'],
            'signal': r['signal'] or r['signal_type'] or '',
            'actual_return': r['actual_return'],
            'actual_exit_price': r['exit_price'],
            'exit_price': r['exit_price'],
        }
        quality = classify_quality(row_dict)
        flags = compute_quality_flags(row_dict) if quality == TOXIC else ''

        stats[quality] += 1
        if quality == CLEAN:
            sig = (r['signal'] or r['signal_type'] or 'UNKNOWN').upper()
            stats['clean_signals'][sig] = stats['clean_signals'].get(sig, 0) + 1
        if quality == TOXIC and len(stats['toxic_samples']) < 5:
            stats['toxic_samples'].append({
                'id': r['id'], 'ticker': r['ticker'],
                'signal': r['signal'] or r['signal_type'],
                'entry': _f(r['entry_price']),
                'target': _f(r['target_price']),
                'stop': _f(r['stop_loss']),
                'exit': _f(r['exit_price']),
                'actual_return': round(_f(r['actual_return']), 2),
                'flags': flags,
            })

        updates.append((quality, flags, r['id']))

    if apply and updates:
        cur.executemany(
            "UPDATE predictions SET data_quality = ?, quality_flags = ? WHERE id = ?",
            updates
        )
        conn.commit()

    return stats


# ──────────────────────────────────────────────────────────────────────────────
# Step 5: ملخص الـ avg return على clean
# ──────────────────────────────────────────────────────────────────────────────

def compute_clean_summary(conn) -> dict:
    """احسب متوسط العائد على clean فقط (overall + BUY only).

    بـ يفتح اتصال نظيف عشان يشوف الـ commit النهائي (بعد step_mark_quality).
    """
    summary = {}
    db_path = conn.execute("PRAGMA database_list").fetchone()[2]
    fresh = _connect(db_path)
    try:
        cur = fresh.cursor()

        # overall clean
        try:
            cur.execute("""
                SELECT COUNT(*) AS n,
                       AVG(actual_return) AS avg_ret,
                       MIN(actual_return) AS min_ret,
                       MAX(actual_return) AS max_ret,
                       SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS n_correct
                FROM predictions
                WHERE data_quality = 'clean'
            """)
            r = dict(cur.fetchone())
            if r and r['n']:
                summary['clean_overall'] = {
                    'n': r['n'],
                    'avg_return': round(r['avg_ret'], 4),
                    'min_return': round(r['min_ret'], 2),
                    'max_return': round(r['max_ret'], 2),
                    'win_rate': round(r['n_correct'] / r['n'] * 100, 2),
                }
        except Exception as e:
            summary['clean_overall_error'] = str(e)

        # BUY only clean
        try:
            buy_list = ",".join(f"'{s}'" for s in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY'))
            cur.execute(f"""
                SELECT COUNT(*) AS n,
                       AVG(actual_return) AS avg_ret,
                       SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS n_correct
                FROM predictions
                WHERE data_quality = 'clean'
                  AND UPPER(TRIM(COALESCE(signal, signal_type, ''))) IN ({buy_list})
            """)
            r = dict(cur.fetchone())
            if r and r['n']:
                summary['clean_buy'] = {
                    'n': r['n'],
                    'avg_return': round(r['avg_ret'], 4),
                    'win_rate': round(r['n_correct'] / r['n'] * 100, 2),
                }
        except Exception as e:
            summary['clean_buy_error'] = str(e)
    finally:
        fresh.close()
    return summary


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description='غسيل التاريخ السام من predictions.db (data_quality + recompute + backfill)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument('--pred-db', required=True, help='path to predictions.db')
    ap.add_argument('--ph-db', required=True, help='path to price_history.db')
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--dry-run', action='store_true', help='عرض التقرير بدون كتابة')
    mode.add_argument('--apply', action='store_true', help='تنفيذ كل الخطوات + كتابة')
    args = ap.parse_args()

    pred_db = os.path.abspath(args.pred_db)
    ph_db = os.path.abspath(args.ph_db)
    apply = args.apply

    if not os.path.exists(pred_db):
        print(f"[ERROR] predictions.db not found: {pred_db}", file=sys.stderr)
        sys.exit(1)

    print(f"[purge] mode={'APPLY' if apply else 'DRY-RUN'}")
    print(f"[purge] pred_db = {pred_db}")
    print(f"[purge] ph_db   = {ph_db}")

    # ── Backup (دائماً، حتى في dry-run — أمان) ──
    backup_dir = os.path.join(os.path.dirname(pred_db), 'backups')
    backup_path = backup_db(pred_db, backup_dir)
    print(f"[purge] backup  = {backup_path}")

    report = {
        'timestamp': datetime.now().isoformat(),
        'mode': 'apply' if apply else 'dry-run',
        'databases': {'predictions': pred_db, 'price_history': ph_db, 'backup': backup_path},
        'steps': {},
    }

    # ── Step 1: إضافة الأعمدة ──
    conn = _connect(pred_db)
    try:
        added = step_ensure_columns(conn)
        # في dry-run، الـ ensure_quality_columns بـ يعمل commit للأعمدة (آمن —
        # إضافة عمود مش بـ يغيّر بيانات). بس لو عايزين dry-run صارم، نـ rollback.
        report['steps']['ensure_columns'] = {'added': added}
        print(f"[purge] step1 ensure_columns: added={added}")

        # ── Step 2: إعادة حساب returns ──
        ret_stats = step_recompute_returns(conn, apply=apply)
        report['steps']['recompute_returns'] = ret_stats
        print(f"[purge] step2 recompute_returns: scanned={ret_stats['scanned']} "
              f"corrected={ret_stats['return_corrected']} no_exit={ret_stats['no_exit_price']}")

        # ── Step 3: Backfill highs/lows ──
        ph_conn = _connect(ph_db) if os.path.exists(ph_db) else None
        try:
            backfill_stats = step_backfill_highs_lows(conn, ph_conn, apply=apply)
        finally:
            if ph_conn:
                ph_conn.close()
        report['steps']['backfill_highs_lows'] = backfill_stats
        if backfill_stats.get('skipped'):
            print(f"[purge] step3 backfill: SKIPPED ({backfill_stats['reason']})")
        else:
            print(f"[purge] step3 backfill: scanned={backfill_stats['scanned']} "
                  f"filled={backfill_stats['filled']} already={backfill_stats['already_filled']} "
                  f"no_match={backfill_stats['no_ticker_match']}")

        # ── Step 4: تعليم quality ──
        # لازم نـ re-read بعد الـ recompute عشان classify_quality يشوف القيم الجديدة
        q_stats = step_mark_quality(conn, apply=apply)
        report['steps']['mark_quality'] = q_stats
        print(f"[purge] step4 mark_quality: total={q_stats['total']} "
              f"clean={q_stats['clean']} toxic={q_stats['toxic']} pending={q_stats['pending']}")

        # ── Step 5: ملخص clean ──
        # في dry-run، الـ data_quality مش متكتبة بعد → استخدم CLEAN_WHERE fallback
        if apply:
            summary = compute_clean_summary(conn)
        else:
            # في dry-run، احسب على الـ where conditions مباشرة (بدون data_quality column)
            summary = _dry_run_summary(conn)
        report['clean_summary'] = summary
        if 'clean_overall' in summary:
            print(f"[purge] clean_overall: n={summary['clean_overall']['n']} "
                  f"avg={summary['clean_overall']['avg_return']}% "
                  f"win_rate={summary['clean_overall']['win_rate']}%")
        if 'clean_buy' in summary:
            print(f"[purge] clean_buy:    n={summary['clean_buy']['n']} "
                  f"avg={summary['clean_buy']['avg_return']}% "
                  f"win_rate={summary['clean_buy']['win_rate']}%")

    finally:
        conn.close()

    # ── اكتب التقرير JSON ──
    report_path = os.path.join(backup_dir, f'purge_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
    os.makedirs(backup_dir, exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"[purge] report  = {report_path}")
    print(f"\n[purge] {'DONE (applied)' if apply else 'DONE (dry-run — no writes except backup)'}")
    print(f"[purge] toxic samples:")
    for s in report['steps']['mark_quality']['toxic_samples']:
        print(f"   id={s['id']:>6} {s['ticker']:8s} sig={str(s['signal']):10s} "
              f"entry={s['entry']} exit={s['exit']} ret={s['actual_return']}% flags={s['flags']}")


def _dry_run_summary(conn) -> dict:
    """احسب ملخص clean في dry-run (بدون الـ data_quality column)."""
    cur = conn.cursor()
    summary = {}
    try:
        cur.execute(f"""
            SELECT COUNT(*) AS n,
                   AVG(actual_return) AS avg_ret,
                   SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS n_correct
            FROM predictions
            WHERE {CLEAN_WHERE}
        """)
        r = cur.fetchone()
        if r and r['n']:
            summary['clean_overall'] = {
                'n': r['n'],
                'avg_return': round(r['avg_ret'], 4),
                'win_rate': round(r['n_correct'] / r['n'] * 100, 2),
            }
    except Exception as e:
        summary['clean_overall_error'] = str(e)
    try:
        buy_list = ",".join(f"'{s}'" for s in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'T1_BUY', 'SWING_BUY'))
        cur.execute(f"""
            SELECT COUNT(*) AS n,
                   AVG(actual_return) AS avg_ret,
                   SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS n_correct
            FROM predictions
            WHERE {CLEAN_WHERE}
              AND UPPER(TRIM(COALESCE(signal, signal_type, ''))) IN ({buy_list})
        """)
        r = cur.fetchone()
        if r and r['n']:
            summary['clean_buy'] = {
                'n': r['n'],
                'avg_return': round(r['avg_ret'], 4),
                'win_rate': round(r['n_correct'] / r['n'] * 100, 2),
            }
    except Exception as e:
        summary['clean_buy_error'] = str(e)
    return summary


if __name__ == '__main__':
    main()
