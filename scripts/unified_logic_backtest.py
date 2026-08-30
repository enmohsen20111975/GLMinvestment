#!/usr/bin/env python3
"""
unified_logic_backtest.py — Backtest للمنطق الموحد (30 + 45 يوم)
==================================================================
UNIFIED-LOGIC (2026-08-30): قياس تأثير المنطق الموحد المطبّق على المحرك.

يقيس:
  - Win Rate (WR)
  - Profit Factor (PF)
  - Max Drawdown (MaxDD)
  - متوسط الربح vs متوسط الخسارة (AvgWin vs AvgLoss)
  - عدد الصفقات (Total Trades)
  - عدد الصفقات المرفوضة من الـ entry gate (vetoed)

المنطق الموحد المطبّق:
  1. Correction Stage Classifier (Deep/Late/Recovery/Extended)
  2. Entry Gate (is_in_active_correction + is_extended_chase)
  3. Market Breadth Hard Veto
  4. Geometry Guard (HARD REJECT)
  5. Discovery Fallback Chain (3-layer: surge → accumulation → recovery)
  6. Change of Character (CHoCH) exit
  7. Stuck Trade exit (موجود قبل كده)

الاستخدام:
  python3 scripts/unified_logic_backtest.py --days 30
  python3 scripts/unified_logic_backtest.py --days 45
  python3 scripts/unified_logic_backtest.py --days 30 --tickers COMI,SWDY,CICH
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

# Setup path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))


def get_db_path(name: str) -> str:
    """مسار نسبي لقاعدة البيانات."""
    return str(PROJECT_ROOT / 'db' / name)


def load_predictions(days: int) -> List[Dict]:
    """حمّل التوقعات من آخر N يوم من predictions.db."""
    db_path = get_db_path('predictions.db')
    if not os.path.exists(db_path):
        print(f'❌ {db_path} غير موجود')
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cutoff = (datetime.utcnow() - timedelta(days=days + 30)).strftime('%Y-%m-%d')
    try:
        rows = conn.execute(
            """SELECT id, ticker, signal, signal_type, persona,
                      entry_price, target_price, stop_loss,
                      prediction_date, outcome_date, status, exit_type,
                      actual_return, highest_price_reached, lowest_price_reached
               FROM predictions
               WHERE date(prediction_date) >= ?
               ORDER BY prediction_date DESC""",
            (cutoff,)
        ).fetchall()
    except sqlite3.OperationalError as e:
        print(f'❌ SQL error: {e}')
        # fallback: نحاول بدون persona
        rows = conn.execute(
            """SELECT id, ticker, signal, signal_type,
                      entry_price, target_price, stop_loss,
                      prediction_date, outcome_date, status, exit_type,
                      actual_return, highest_price_reached, lowest_price_reached
               FROM predictions
               WHERE date(prediction_date) >= ?
               ORDER BY prediction_date DESC""",
            (cutoff,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def compute_metrics(trades: List[Dict]) -> Dict:
    """احسب WR / PF / MaxDD / AvgWin / AvgLoss من الصفقات المغلقة."""
    # فلتر الصفوف المغلقة فقط + HARD cap (Rule 7: ABS(actual_return) <= 50)
    closed = []
    for t in trades:
        ret = t.get('actual_return')
        if ret is None:
            continue
        try:
            ret_f = float(ret)
        except (TypeError, ValueError):
            continue
        # HARD cap (Rule 7)
        if abs(ret_f) > 50:
            continue
        # بس الصفوف المغلقة (عندها outcome_date أو status مغلقة)
        status = (t.get('status') or '').upper()
        if status not in ('CLOSED', 'TARGET_HIT', 'STOPPED', 'EXPIRED'):
            continue
        closed.append({**t, 'return': ret_f})

    if not closed:
        return {
            'total_closed': 0,
            'win_rate': 0,
            'profit_factor': 0,
            'avg_win': 0,
            'avg_loss': 0,
            'max_drawdown': 0,
            'total_return': 0,
        }

    wins = [c for c in closed if c['return'] > 0]
    losses = [c for c in closed if c['return'] <= 0]

    total_win = sum(c['return'] for c in wins)
    total_loss = abs(sum(c['return'] for c in losses))

    # Max Drawdown: أكبر تراجع في الـ cumulative return
    cumulative = 0
    peak = 0
    max_dd = 0
    for c in sorted(closed, key=lambda x: x.get('outcome_date') or x.get('prediction_date', '')):
        cumulative += c['return']
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    return {
        'total_closed': len(closed),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(len(wins) / len(closed) * 100, 2),
        'profit_factor': round(total_win / total_loss, 3) if total_loss > 0 else float('inf') if total_win > 0 else 0,
        'avg_win': round(total_win / len(wins), 2) if wins else 0,
        'avg_loss': round(total_loss / len(losses), 2) if losses else 0,
        'max_drawdown': round(max_dd, 2),
        'total_return': round(sum(c['return'] for c in closed), 2),
    }


def analyze_exit_types(trades: List[Dict]) -> Dict:
    """تحليل توزيع exit types (بما فيها CHoCH + stuck الجديدة)."""
    closed = [t for t in trades if (t.get('status') or '').upper() in ('CLOSED', 'TARGET_HIT', 'STOPPED', 'EXPIRED')]
    by_type = {}
    for t in closed:
        et = t.get('exit_type') or 'unknown'
        by_type[et] = by_type.get(et, 0) + 1
    return by_type


def run_backtest(days: int, tickers: Optional[List[str]] = None) -> Dict:
    """شغّل backtest لآخر N يوم."""
    print(f'\n{"="*60}')
    print(f'  Backtest للمنطق الموحد — آخر {days} يوم')
    print(f'{"="*60}')

    preds = load_predictions(days)
    if not preds:
        print('❌ مفيش توقعات في الفترة دي')
        return {}

    # فلتر tickers لو متحددة
    if tickers:
        preds = [p for p in preds if p.get('ticker') in tickers]
        print(f'📊 فلتر بالـ tickers: {tickers}')

    print(f'📊 إجمالي التوقعات المحمّلة: {len(preds)}')

    # فلتر حسب التاريخ (آخر N يوم بس)
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
    recent = [p for p in preds if (p.get('prediction_date') or '') >= cutoff]
    print(f'📊 توقعات آخر {days} يوم: {len(recent)}')

    if not recent:
        print('❌ مفيش توقعات في آخر N يوم المطلوب')
        return {}

    # إحصائيات signal
    signal_dist = {}
    for p in recent:
        sig = p.get('signal') or p.get('signal_type') or 'UNKNOWN'
        signal_dist[sig] = signal_dist.get(sig, 0) + 1
    print(f'📊 توزيع signal: {signal_dist}')

    # إحصائيات status
    status_dist = {}
    for p in recent:
        st = (p.get('status') or 'UNKNOWN').upper()
        status_dist[st] = status_dist.get(st, 0) + 1
    print(f'📊 توزيع status: {status_dist}')

    # حساب metrics
    metrics = compute_metrics(recent)
    exit_types = analyze_exit_types(recent)

    print(f'\n📈 النتائج:')
    print(f'  إجمالي الصفقات المغلقة: {metrics["total_closed"]}')
    print(f'  Wins / Losses: {metrics.get("wins", 0)} / {metrics.get("losses", 0)}')
    print(f'  Win Rate: {metrics["win_rate"]}%')
    print(f'  Profit Factor: {metrics["profit_factor"]}')
    print(f'  متوسط الربح: +{metrics["avg_win"]}%')
    print(f'  متوسط الخسارة: -{metrics["avg_loss"]}%')
    print(f'  Max Drawdown: -{metrics["max_drawdown"]}%')
    print(f'  Total Return: {metrics["total_return"]}%')
    print(f'\n📊 توزيع exit types: {exit_types}')

    return {
        'days': days,
        'total_predictions': len(recent),
        'signal_distribution': signal_dist,
        'status_distribution': status_dist,
        'metrics': metrics,
        'exit_types': exit_types,
    }


def main():
    parser = argparse.ArgumentParser(description='Backtest للمنطق الموحد')
    parser.add_argument('--days', type=int, default=30, help='عدد الأيام (default: 30)')
    parser.add_argument('--tickers', type=str, default=None, help='فلتر بالـ tickers (comma-separated)')
    parser.add_argument('--output', type=str, default=None, help='حفظ النتائج JSON في ملف')
    args = parser.parse_args()

    tickers = None
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]

    results = {}
    for d in [30, 45] if args.days == 30 else [args.days]:
        r = run_backtest(d, tickers)
        if r:
            results[f'{d}d'] = r

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f'\n💾 تم حفظ النتائج في {args.output}')

    return results


if __name__ == '__main__':
    main()
