#!/usr/bin/env python3
"""
commercial_feed.py — الـ Single Commercial Feed الموحد للمنصة
================================================================
Task B-15 (Owner Directive 2026-10-13)

يفصل التوصيات إلى مسارين صريحين:
  1. Active Live Signals — صفقات حية صالحة للشراء الآن
  2. Audited Performance History — سجل أداء موثق للصفقات المغلقة

يقرأ من predictions table (SSOT — Single Source of Truth).
منع أي كويريات عشوائية مكررة.

Usage:
    python3 scripts/commercial_feed.py                    # طباعة التقرير
    python3 scripts/commercial_feed.py --json             # JSON output
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"


def log(msg: str) -> None:
    print(f"[commercial_feed] {msg}", flush=True)


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


def get_active_live_signals() -> List[Dict[str, Any]]:
    """المسار الأول: الصفقات الحية الصالحة للشراء الآن فقط."""
    signals = []
    # جرّب predictions.db أولاً (SSOT الكنسي) ثم stocks.db
    for db_path in [PREDICTIONS_DB, STOCKS_DB]:
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT p.ticker, p.signal, p.signal_type, p.entry_price,
                       p.target_price, p.stop_loss,
                       p.master_score, p.technical_score, p.risk_reward,
                       p.prediction_date,
                       s.name, s.name_ar, s.market, s.sector,
                       s.current_price
                FROM predictions p
                LEFT JOIN stocks s ON p.ticker = s.ticker
                WHERE p.entry_price IS NOT NULL AND p.entry_price > 0
                  AND p.target_price IS NOT NULL AND p.target_price > 0
                  AND p.stop_loss IS NOT NULL AND p.stop_loss > 0
                  AND p.outcome_date IS NULL
                ORDER BY p.master_score DESC
            """).fetchall()
            conn.close()
            for r in rows:
                d = dict(r)
                entry = _to_float(d.get('entry_price'))
                target = _to_float(d.get('target_price'))
                stop = _to_float(d.get('stop_loss'))
                target2 = 0.0  # target_price_2 may not exist
                confidence = _to_float(d.get('master_score'))
                rr_stored = _to_float(d.get('risk_reward'))
                risk = entry - stop
                reward = target - entry
                rr = rr_stored if rr_stored > 0 else (round(reward / risk, 2) if risk > 0 else 0)

                # الأفق الزمني
                if rr >= 2.5:
                    horizon = '⚡ يومية/قصيرة (1-5 أيام)'
                    horizon_icon = '⚡'
                elif rr >= 1.5:
                    horizon = '🎯 أسبوعية/متوسطة (2-4 أسابيع)'
                    horizon_icon = '🎯'
                else:
                    horizon = '🛡️ استراتيجية (شهر+)'
                    horizon_icon = '🛡️'

                # الأهداف
                target1_pct = round((target - entry) / entry * 100, 1) if entry > 0 else 0

                signals.append({
                    'ticker': d['ticker'],
                    'name': d.get('name_ar') or d.get('name') or d['ticker'],
                    'market': d.get('market') or 'EGX',
                    'sector': d.get('sector') or '',
                    'signal': d.get('signal') or 'BUY',
                    'signal_type': d.get('signal_type') or 'institutional_scan',
                    'entry_price': round(entry, 4),
                    'target_1': round(target, 4),
                    'target_1_pct': target1_pct,
                    'target_2': None,
                    'target_2_pct': None,
                    'stop_loss': round(stop, 4),
                    'risk_reward': rr,
                    'confidence': round(confidence, 1),
                    'horizon': horizon,
                    'horizon_icon': horizon_icon,
                    'prediction_date': str(d.get('prediction_date') or ''),
                    'current_price': round(_to_float(d.get('current_price')), 4) if d.get('current_price') else None,
                    'source': 'predictions_table',
                })
            if signals:
                break  # وجدنا بيانات — لا حاجة للـ DB التالي
        except Exception as e:
            log(f"DB {db_path.name} failed: {e}")
    return signals


def get_audited_performance() -> List[Dict[str, Any]]:
    """المسار الثاني: سجل الأداء الموثق للصفقات المغلقة."""
    history = []
    for db_path in [PREDICTIONS_DB, STOCKS_DB]:
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row

            # تحقق من وجود الأعمدة المطلوبة
            cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
            has_hpr = 'highest_price_reached' in cols
            has_lpr = 'lowest_price_reached' in cols

            hpr_col = 'highest_price_reached' if has_hpr else '0 as highest_price_reached'
            lpr_col = 'lowest_price_reached' if has_lpr else '0 as lowest_price_reached'

            rows = conn.execute(f"""
                SELECT p.ticker, p.signal, p.entry_price, p.target_price,
                       p.stop_loss, p.exit_price, p.actual_return,
                       p.hit_target, p.hit_stop, p.is_correct,
                       p.holding_days, p.outcome_date, p.prediction_date,
                       p.master_score,
                       {hpr_col}, {lpr_col},
                       s.name, s.name_ar, s.market, s.sector
                FROM predictions p
                LEFT JOIN stocks s ON p.ticker = s.ticker
                WHERE p.outcome_date IS NOT NULL
                ORDER BY p.outcome_date DESC
                LIMIT 200
            """).fetchall()
            conn.close()
            for r in rows:
                d = dict(r)
                entry = _to_float(d.get('entry_price'))
                exit_price = _to_float(d.get('exit_price'))
                actual_return = _to_float(d.get('actual_return'))
                highest = _to_float(d.get('highest_price_reached'))
                lowest = _to_float(d.get('lowest_price_reached'))

                # تصنيف النتيجة
                if d.get('hit_target'):
                    status = 'win'
                    status_ar = '✅ نجاح — حقق الهدف'
                elif d.get('hit_stop'):
                    status = 'loss'
                    status_ar = '❌ خسارة — ضرب الوقف'
                else:
                    status = 'expired'
                    status_ar = '⏳ انتهى — لم يحقق الهدف ولا الوقف'

                history.append({
                    'ticker': d['ticker'],
                    'name': d.get('name_ar') or d.get('name') or d['ticker'],
                    'market': d.get('market') or 'EGX',
                    'sector': d.get('sector') or '',
                    'signal': d.get('signal') or 'BUY',
                    'entry_price': round(entry, 4),
                    'exit_price': round(exit_price, 4) if exit_price else None,
                    'target_price': round(_to_float(d.get('target_price')), 4),
                    'stop_loss': round(_to_float(d.get('stop_loss')), 4),
                    'highest_price': round(highest, 4) if highest > 0 else None,
                    'lowest_price': round(lowest, 4) if lowest > 0 else None,
                    'actual_return_pct': round(actual_return, 2),
                    'status': status,
                    'status_ar': status_ar,
                    'hit_target': bool(d.get('hit_target')),
                    'hit_stop': bool(d.get('hit_stop')),
                    'holding_days': d.get('holding_days') or 0,
                    'outcome_date': str(d.get('outcome_date') or ''),
                    'prediction_date': str(d.get('prediction_date') or ''),
                    'confidence': round(_to_float(d.get('master_score')), 1),
                })
            if history:
                break
        except Exception as e:
            log(f"DB {db_path.name} failed: {e}")
    return history


def compute_summary(active: List[Dict], audited: List[Dict]) -> Dict[str, Any]:
    """احسب ملخص إحصائي شامل."""
    wins = [a for a in audited if a['status'] == 'win']
    losses = [a for a in audited if a['status'] == 'loss']
    expired = [a for a in audited if a['status'] == 'expired']
    total_closed = len(audited)

    win_rate = round(len(wins) / total_closed * 100, 1) if total_closed > 0 else 0
    avg_return = round(sum(a['actual_return_pct'] for a in audited) / total_closed, 2) if total_closed > 0 else 0
    best_return = max((a['actual_return_pct'] for a in audited), default=0)
    worst_return = min((a['actual_return_pct'] for a in audited), default=0)
    gross_profit = round(sum(a['actual_return_pct'] for a in wins), 2)
    gross_loss = round(abs(sum(a['actual_return_pct'] for a in losses)), 2)
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0

    avg_rr = round(sum(s['risk_reward'] for s in active) / len(active), 2) if active else 0
    avg_conf = round(sum(s['confidence'] for s in active) / len(active), 1) if active else 0

    return {
        'active_signals': {
            'count': len(active),
            'avg_rr': avg_rr,
            'avg_confidence': avg_conf,
        },
        'audited_performance': {
            'total_closed': total_closed,
            'wins': len(wins),
            'losses': len(losses),
            'expired': len(expired),
            'win_rate': win_rate,
            'avg_return': avg_return,
            'best_return': best_return,
            'worst_return': worst_return,
            'profit_factor': profit_factor,
        },
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Single Commercial Feed")
    parser.add_argument('--json', action='store_true', help='JSON output')
    args = parser.parse_args()

    active = get_active_live_signals()
    audited = get_audited_performance()
    summary = compute_summary(active, audited)

    result = {
        'success': True,
        'summary': summary,
        'active_live_signals': active,
        'audited_performance_history': audited,
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    else:
        log("=" * 60)
        log("📊 Single Commercial Feed — التوصيات الموحدة")
        log("=" * 60)
        log(f"Active Live Signals: {len(active)}")
        log(f"  avg R:R = {summary['active_signals']['avg_rr']}")
        log(f"  avg confidence = {summary['active_signals']['avg_confidence']}%")
        log(f"Audited Performance: {len(audited)} closed")
        log(f"  win_rate = {summary['audited_performance']['win_rate']}%")
        log(f"  avg_return = {summary['audited_performance']['avg_return']}%")
        log(f"  profit_factor = {summary['audited_performance']['profit_factor']}")
        log("")
        log("--- Top 5 Active Signals ---")
        for s in active[:5]:
            log(f"  {s['horizon_icon']} {s['ticker']:8} | entry={s['entry_price']:.2f} | target={s['target_1']:.2f} | stop={s['stop_loss']:.2f} | R:R={s['risk_reward']:.2f} | conf={s['confidence']:.0f}%")
        log("")
        log("--- Top 5 Audited Trades ---")
        for a in audited[:5]:
            exit_str = f"{a['exit_price']:.2f}" if a['exit_price'] else 'N/A'
            log(f"  {a['status_ar']} {a['ticker']:8} | entry={a['entry_price']:.2f} | exit={exit_str} | return={a['actual_return_pct']:.1f}% | {a['outcome_date']}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
