#!/usr/bin/env python3
"""
audit_predictions_deep.py — التدقيق القضائي للصفقات المغلقة
=================================================================================
Task BRAVO-PURGE-1 (Owner Directive 2026-10-14)

الهدف: تدقيق جدول predictions التاريخي ومطابقة الصفقات المغلقة مع الشموع
الفعلية في stocks.db.stock_daily_prices، وإعدام أي فوز ورقي وهمي.

القواعد القضائية:
  1. أي صفقة مسجلة TARGET_HIT لازم High يلمس سعر الهدف في الشموع اليومية
     خلال فترة (prediction_date → outcome_date). لو ملمسش → INVALID_WIN → STOPPED.
  2. أي صفقة مسجلة STOPPED لازم Low يلمس سعر الوقف. لو ملمسش → مراجعة.
  3. استبعاد القيعان الصفرية (low=0) أو القفزات الشاذة (stock splits).
  4. أي صفقة مفتوحة >30 يوم بدون هدف/وقف → EXPIRED.
  5. إعادة حساب audited_performance بناءً على الأرقام الحقيقية المصفاة.

Usage:
    python3 scripts/audit_predictions_deep.py                # تنفيذ + تقرير
    python3 scripts/audit_predictions_deep.py --dry-run      # تقرير فقط
    python3 scripts/audit_predictions_deep.py --json         # JSON output
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
STALE_DAYS = 30  # الصفقات المعلقة أكتر من 30 يوم → EXPIRED


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


def get_candles_in_range(conn: sqlite3.Connection, ticker: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """جلب الشموع بين تاريخ الدخول والخروج (شامل)."""
    rows = conn.execute("""
        SELECT price_date, high, low, close, open
        FROM stock_daily_prices
        WHERE ticker = ?
          AND price_date >= ?
          AND price_date <= ?
          AND COALESCE(high, 0) > 0
          AND COALESCE(low, 0) > 0
        ORDER BY price_date ASC
    """, (ticker, start_date, end_date)).fetchall()
    return [dict(zip(['price_date', 'high', 'low', 'close', 'open'], r)) for r in rows]


def audit_trade(
    conn: sqlite3.Connection,
    trade: sqlite3.Row,
) -> Dict[str, Any]:
    """تدقيق صفقة واحدة ضد الشموع الفعلية.

    Returns:
        dict with:
          - verdict: 'CONFIRMED' / 'INVALID_WIN' / 'INVALID_STOP' / 'STALE' / 'NO_CANDLES'
          - old_status: original hit_target/hit_stop
          - new_status: corrected hit_target/hit_stop (if changed)
          - reason: explanation
          - candles_checked: count
    """
    d = dict(trade)
    ticker = d['ticker']
    prediction_date = d.get('prediction_date') or ''
    outcome_date = d.get('outcome_date') or ''
    entry = _to_float(d.get('entry_price'))
    target = _to_float(d.get('target_price'))
    stop = _to_float(d.get('stop_loss'))
    hit_target = int(d.get('hit_target') or 0)
    hit_stop = int(d.get('hit_stop') or 0)
    lowest_reached = _to_float(d.get('lowest_price_reached'))
    highest_reached = _to_float(d.get('highest_price_reached'))

    result = {
        'id': d.get('id'),
        'ticker': ticker,
        'prediction_date': prediction_date,
        'outcome_date': outcome_date,
        'entry': entry,
        'target': target,
        'stop': stop,
        'old_hit_target': hit_target,
        'old_hit_stop': hit_stop,
        'verdict': 'CONFIRMED',
        'new_hit_target': hit_target,
        'new_hit_stop': hit_stop,
        'reason': '',
        'candles_checked': 0,
    }

    # ── استبعاد القيعان الصفرية / القفزات الشاذة ──
    if lowest_reached == 0 and hit_stop == 1:
        result['verdict'] = 'INVALID_STOP'
        result['new_hit_stop'] = 0
        result['new_hit_target'] = 0
        result['reason'] = f'قاع شاذ (low=0) + hit_stop=1 — صفقة فاسدة، تُلغى'
        return result

    # لو مفيش outcome_date → صفقة معلقة → فحص الـ stale
    if not outcome_date:
        # صفقة معلقة — فحص لو >30 يوم
        try:
            pred_dt = datetime.strptime(prediction_date, '%Y-%m-%d')
            now_dt = datetime.now(timezone.utc)
            days_open = (now_dt - pred_dt).days
            if days_open > STALE_DAYS:
                result['verdict'] = 'STALE'
                result['reason'] = f'صفقة معلقة {days_open} يوم (>{STALE_DAYS}) → EXPIRED'
                return result
        except Exception:
            pass
        result['verdict'] = 'OPEN_OK'
        result['reason'] = 'صفقة معلقة حديثة (<30 يوم)'
        return result

    # جلب الشموع في الفترة
    candles = get_candles_in_range(conn, ticker, prediction_date, outcome_date)
    result['candles_checked'] = len(candles)

    if not candles:
        result['verdict'] = 'NO_CANDLES'
        result['reason'] = f'مفيش شموع بين {prediction_date} و {outcome_date} — لا يمكن التحقق'
        return result

    # حساب أعلى high وأدنى low فعليين في الفترة
    actual_high = max(_to_float(c.get('high')) for c in candles)
    actual_low = min(_to_float(c.get('low')) for c in candles)

    # ── تدقيق TARGET_HIT ──
    if hit_target == 1:
        # لازم High يلمس سعر الهدف
        if target > 0 and actual_high >= target:
            result['verdict'] = 'CONFIRMED'
            result['reason'] = f'تأكد: High الفعلي ({actual_high:.2f}) لمس الهدف ({target:.2f})'
        else:
            # فوز وهمي — الهدف لم يُلمس
            result['verdict'] = 'INVALID_WIN'
            result['new_hit_target'] = 0
            # لو Low لمس الوقف → تصحيح لـ STOPPED
            if stop > 0 and actual_low <= stop:
                result['new_hit_stop'] = 1
                result['reason'] = f'فوز وهمي: High ({actual_high:.2f}) لم يلمس الهدف ({target:.2f})، لكن Low ({actual_low:.2f}) لمس الوقف ({stop:.2f}) → تصحيح لـ STOPPED'
            else:
                result['reason'] = f'فوز وهمي: High ({actual_high:.2f}) لم يلمس الهدف ({target:.2f}) ولا Low لمس الوقف → EXPIRED'
        return result

    # ── تدقيق STOPPED ──
    if hit_stop == 1:
        if stop > 0 and actual_low <= stop:
            result['verdict'] = 'CONFIRMED'
            result['reason'] = f'تأكد: Low الفعلي ({actual_low:.2f}) لمس الوقف ({stop:.2f})'
        else:
            # وقف وهمي
            result['verdict'] = 'INVALID_STOP'
            result['new_hit_stop'] = 0
            # لو High لمس الهدف → تصحيح لـ TARGET_HIT
            if target > 0 and actual_high >= target:
                result['new_hit_target'] = 1
                result['reason'] = f'وقف وهمي: Low ({actual_low:.2f}) لم يلمس الوقف ({stop:.2f})، لكن High ({actual_high:.2f}) لمس الهدف ({target:.2f}) → تصحيح لـ TARGET_HIT'
            else:
                result['reason'] = f'وقف وهمي: Low ({actual_low:.2f}) لم يلمس الوقف ({stop:.2f}) → EXPIRED'
        return result

    # ── صفقة بدون hit_target/hit_stop (EXPIRED أصلاً) ──
    result['verdict'] = 'CONFIRMED'
    result['reason'] = 'صفقة EXPIRED (لا هدف ولا وقف) — مؤكد'
    return result


def recompute_audited_performance(conn: sqlite3.Connection) -> Dict[str, Any]:
    """إعادة حساب audited_performance بناءً على الأرقام الحقيقية المصفاة."""
    rows = conn.execute("""
        SELECT hit_target, hit_stop, actual_return, outcome_date, prediction_date
        FROM predictions
        WHERE outcome_date IS NOT NULL
          AND outcome_date >= prediction_date
          AND (lowest_price_reached > 0 OR lowest_price_reached IS NULL OR hit_target = 1)
    """).fetchall()

    # فلتر القيعان الشاذة
    valid_trades = []
    for r in rows:
        hit_target, hit_stop, actual_return, outcome_date, prediction_date = r
        # استبعاد hit_stop=1 + low=0 (تم فلترها في commercial_feed كمان)
        valid_trades.append({
            'hit_target': hit_target,
            'hit_stop': hit_stop,
            'actual_return': _to_float(actual_return),
        })

    total = len(valid_trades)
    wins = sum(1 for t in valid_trades if t['hit_target'] == 1)
    losses = sum(1 for t in valid_trades if t['hit_stop'] == 1)
    expired = total - wins - losses

    win_rate = round(wins / total * 100, 1) if total > 0 else 0
    avg_return = round(sum(t['actual_return'] for t in valid_trades) / total, 2) if total > 0 else 0
    best_return = max((t['actual_return'] for t in valid_trades), default=0)
    worst_return = min((t['actual_return'] for t in valid_trades), default=0)
    gross_profit = round(sum(t['actual_return'] for t in valid_trades if t['hit_target'] == 1), 2)
    gross_loss = round(abs(sum(t['actual_return'] for t in valid_trades if t['hit_stop'] == 1)), 2)
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0

    return {
        'total_closed': total,
        'wins': wins,
        'losses': losses,
        'expired': expired,
        'win_rate': win_rate,
        'avg_return': avg_return,
        'best_return': best_return,
        'worst_return': worst_return,
        'profit_factor': profit_factor,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="التدقيق القضائي للصفقات المغلقة")
    parser.add_argument('--dry-run', action='store_true', help='تقرير فقط بدون تعديل الـ DB')
    parser.add_argument('--json', action='store_true', help='JSON output')
    parser.add_argument('--market', type=str, default=None, help='فلتر حسب السوق (EGX, TADAWUL, KSE, QSE) — يقرأ من notes JSON')
    args = parser.parse_args()

    log("=" * 70)
    log("🔍 التدقيق القضائي للصفقات المغلقة — Audit Predictions Deep")
    log("=" * 70)
    log(f"Mode: {'🔍 DRY-RUN' if args.dry_run else '⚡ EXECUTE'}")
    if args.market:
        log(f"Market filter: {args.market}")
    log("")

    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return 1

    # نسخة احتياطية قبل أي تعديل
    if not args.dry_run:
        backup_path = STOCKS_DB.parent / "backups" / f"stocks_db_before_audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.copy2(STOCKS_DB, backup_path)
        log(f"💾 نسخة احتياطية: {backup_path.name}", "OK")

    conn = sqlite3.connect(str(STOCKS_DB))
    conn.row_factory = sqlite3.Row

    # جلب كل الصفقات
    rows = conn.execute("""
        SELECT id, ticker, signal_type, prediction_date, outcome_date,
               entry_price, target_price, stop_loss, exit_price, actual_return,
               hit_target, hit_stop, is_correct, holding_days,
               highest_price_reached, lowest_price_reached, notes
        FROM predictions
        ORDER BY id ASC
    """).fetchall()

    # Task B-27: فلتر حسب السوق لو --market محدد (نقرأ market من notes JSON)
    if args.market:
        target_market = args.market.strip().upper()
        filtered_rows = []
        for trade in rows:
            notes_raw = trade['notes'] if 'notes' in trade.keys() else ''
            trade_market = 'EGX'  # default
            if notes_raw and isinstance(notes_raw, str) and notes_raw.strip().startswith('{'):
                try:
                    nm = json.loads(notes_raw)
                    trade_market = (nm.get('market') or 'EGX').upper()
                except Exception:
                    pass
            if trade_market == target_market:
                filtered_rows.append(trade)
        log(f"📊 فلتر السوق: {target_market} — {len(filtered_rows)}/{len(rows)} صفقة")
        rows = filtered_rows

    log(f"📊 إجمالي الصفقات للفحص: {len(rows)}")

    # تدقيق كل صفقة
    verdicts: List[Dict[str, Any]] = []
    corrections: List[Dict[str, Any]] = []
    stale_closures: List[Dict[str, Any]] = []
    market_breakdown: Dict[str, Dict[str, int]] = {}  # Task B-27: تفصيل حسب السوق

    for trade in rows:
        result = audit_trade(conn, trade)
        verdicts.append(result)

        # Task B-27: استخراج market من notes
        notes_raw = trade['notes'] if 'notes' in trade.keys() else ''
        trade_market = 'EGX'
        if notes_raw and isinstance(notes_raw, str) and notes_raw.strip().startswith('{'):
            try:
                nm = json.loads(notes_raw)
                trade_market = (nm.get('market') or 'EGX').upper()
            except Exception:
                pass
        result['market'] = trade_market

        # تفصيل حسب السوق
        if trade_market not in market_breakdown:
            market_breakdown[trade_market] = {'total': 0, 'wins': 0, 'losses': 0, 'expired': 0}
        market_breakdown[trade_market]['total'] += 1
        if result.get('new_hit_target') == 1:
            market_breakdown[trade_market]['wins'] += 1
        elif result.get('new_hit_stop') == 1:
            market_breakdown[trade_market]['losses'] += 1
        else:
            market_breakdown[trade_market]['expired'] += 1

        verdict = result['verdict']
        if verdict in ('INVALID_WIN', 'INVALID_STOP'):
            corrections.append(result)
        elif verdict == 'STALE':
            stale_closures.append(result)

    # إحصائيات
    verdict_counts: Dict[str, int] = {}
    for v in verdicts:
        verdict_counts[v['verdict']] = verdict_counts.get(v['verdict'], 0) + 1

    # Task B-27: تقرير تفصيلي حسب السوق
    log("")
    log("📊 تفصيل حسب السوق:")
    for mkt, stats in sorted(market_breakdown.items()):
        wr = round(stats['wins'] / stats['total'] * 100, 1) if stats['total'] > 0 else 0
        log(f"  {mkt}: total={stats['total']} wins={stats['wins']} losses={stats['losses']} expired={stats['expired']} win_rate={wr}%")

    log("")
    log("📊 توزيع الأحكام:")
    for v, c in sorted(verdict_counts.items()):
        log(f"  {v}: {c}")

    log("")
    log(f"❌ صفقات فوز/وقف وهمية (هتتصلح): {len(corrections)}")
    for c in corrections[:10]:
        log(f"  id={c['id']} {c['ticker']:8} | {c['verdict']} | {c['reason'][:100]}")
    if len(corrections) > 10:
        log(f"  ... و {len(corrections) - 10} صفقة أخرى")

    log("")
    log(f"⏳ صفقات معلقة >{STALE_DAYS} يوم (هتتقفل EXPIRED): {len(stale_closures)}")
    for s in stale_closures[:10]:
        log(f"  id={s['id']} {s['ticker']:8} | {s['reason'][:80]}")

    # ── تنفيذ التصحيحات ──
    if not args.dry_run:
        log("")
        log("⚡ جاري تنفيذ التصحيحات...")

        # 1. تصحيح الأحكام الوهمية
        for c in corrections:
            new_return = _to_float(c.get('actual_return', 0))
            # لو INVALID_WIN → تصحيح لـ STOPPED أو EXPIRED
            if c['verdict'] == 'INVALID_WIN':
                if c['new_hit_stop'] == 1:
                    # تصحيح لـ STOPPED
                    new_return = round(((c['stop'] - c['entry']) / c['entry']) * 100, 2) if c['entry'] > 0 else 0
                    conn.execute("""
                        UPDATE predictions
                        SET hit_target = 0, hit_stop = 1, is_correct = 0,
                            actual_return = ?, exit_price = ?
                        WHERE id = ?
                    """, (new_return, c['stop'], c['id']))
                else:
                    # EXPIRED — نحسب العائد من آخر close في الفترة
                    candles = get_candles_in_range(conn, c['ticker'], c['prediction_date'], c['outcome_date'])
                    if candles:
                        last_close = _to_float(candles[-1].get('close'))
                        new_return = round(((last_close - c['entry']) / c['entry']) * 100, 2) if c['entry'] > 0 else 0
                    conn.execute("""
                        UPDATE predictions
                        SET hit_target = 0, hit_stop = 0, is_correct = ?,
                            actual_return = ?
                        WHERE id = ?
                    """, (1 if new_return > 0 else 0, new_return, c['id']))

            # لو INVALID_STOP → تصحيح لـ TARGET_HIT أو EXPIRED
            elif c['verdict'] == 'INVALID_STOP':
                if c['new_hit_target'] == 1:
                    # تصحيح لـ TARGET_HIT
                    new_return = round(((c['target'] - c['entry']) / c['entry']) * 100, 2) if c['entry'] > 0 else 0
                    conn.execute("""
                        UPDATE predictions
                        SET hit_target = 1, hit_stop = 0, is_correct = 1,
                            actual_return = ?, exit_price = ?
                        WHERE id = ?
                    """, (new_return, c['target'], c['id']))
                else:
                    # EXPIRED
                    candles = get_candles_in_range(conn, c['ticker'], c['prediction_date'], c['outcome_date'])
                    if candles:
                        last_close = _to_float(candles[-1].get('close'))
                        new_return = round(((last_close - c['entry']) / c['entry']) * 100, 2) if c['entry'] > 0 else 0
                    conn.execute("""
                        UPDATE predictions
                        SET hit_target = 0, hit_stop = 0, is_correct = ?,
                            actual_return = ?
                        WHERE id = ?
                    """, (1 if new_return > 0 else 0, new_return, c['id']))

        # 2. قفل الصفقات المعلقة >30 يوم كـ EXPIRED
        now_iso = datetime.now(timezone.utc).isoformat()
        for s in stale_closures:
            # نحسب العائد من آخر close متاح
            candles = get_candles_in_range(conn, s['ticker'], s['prediction_date'], datetime.now(timezone.utc).strftime('%Y-%m-%d'))
            last_close = _to_float(candles[-1].get('close')) if candles else s.get('entry', 0)
            new_return = round(((last_close - s['entry']) / s['entry']) * 100, 2) if s['entry'] > 0 else 0
            conn.execute("""
                UPDATE predictions
                SET outcome_date = ?, hit_target = 0, hit_stop = 0,
                    is_correct = ?, actual_return = ?, exit_price = ?
                WHERE id = ?
            """, (datetime.now(timezone.utc).strftime('%Y-%m-%d'),
                  1 if new_return > 0 else 0, new_return, last_close, s['id']))

        conn.commit()
        log(f"✅ تم تصحيح {len(corrections)} صفقة + قفل {len(stale_closures)} صفقة stale", "OK")

    # ── إعادة حساب audited_performance ──
    log("")
    log("📊 إعادة حساب audited_performance (الأرقام الحقيقية المصفاة):")
    real_stats = recompute_audited_performance(conn)
    for k, v in real_stats.items():
        log(f"  {k}: {v}")

    conn.close()

    # تقرير نهائي
    report = {
        'audit_timestamp': datetime.now(timezone.utc).isoformat(),
        'mode': 'dry-run' if args.dry_run else 'execute',
        'total_trades_audited': len(verdicts),
        'verdict_counts': verdict_counts,
        'invalid_wins_corrected': len([c for c in corrections if c['verdict'] == 'INVALID_WIN']),
        'invalid_stops_corrected': len([c for c in corrections if c['verdict'] == 'INVALID_STOP']),
        'stale_closed_expired': len(stale_closures),
        'real_audited_performance': real_stats,
    }

    log("")
    log("=" * 70)
    log("📊 التقرير النهائي:")
    log(f"  إجمالي الصفقات المدققة: {len(verdicts)}")
    log(f"  فوز وهمي ملغي: {report['invalid_wins_corrected']}")
    log(f"  وقف وهمي ملغي: {report['invalid_stops_corrected']}")
    log(f"  صفقات stale → EXPIRED: {report['stale_closed_expired']}")
    log(f"  Real Win Rate: {real_stats['win_rate']}%")
    log(f"  Real Avg Return: {real_stats['avg_return']}%")
    log(f"  Real Profit Factor: {real_stats['profit_factor']}")
    log("=" * 70)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, default=str, indent=2))

    return 0


if __name__ == '__main__':
    sys.exit(main())
