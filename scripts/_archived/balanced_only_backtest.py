#!/usr/bin/env python3
"""
balanced_only_backtest.py — Backtest لتعطيل تعدد الشخصيات (UNIFIED-BALANCED-ONLY)
================================================================================
UNIFIED-BALANCED-ONLY (2026-08-30): قياس تأثير تعطيل تعدد الشخصيات على النتائج.

يقارن:
  - قبل التعطيل: كل persona لها thresholds مختلفة (gambler=28, balanced=42, conservative=50)
  - بعد التعطيل: كل personas بتستخدم thresholds الـ balanced (42)

يقيس:
  - Win Rate (WR)
  - Profit Factor (PF)
  - Max Drawdown (MaxDD)
  - متوسط الربح vs متوسط الخسارة (AvgWin vs AvgLoss)
  - عدد الصفقات (Total Trades)

الاستخدام:
  python3 scripts/balanced_only_backtest.py
"""
from __future__ import annotations
import os
import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))


def load_predictions() -> List[Dict]:
    """حمّل كل التوقعات من predictions.db."""
    db_path = str(PROJECT_ROOT / 'db' / 'predictions.db')
    if not os.path.exists(db_path):
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT id, ticker, signal, signal_type, persona,
                      entry_price, target_price, stop_loss,
                      prediction_date, outcome_date, status, exit_type,
                      actual_return, highest_price_reached, lowest_price_reached,
                      morning_bell, evidence_count
               FROM predictions
               ORDER BY prediction_date DESC"""
        ).fetchall()
    except sqlite3.OperationalError as e:
        print(f'SQL error: {e}')
        rows = []
    conn.close()
    return [dict(r) for r in rows]


def compute_metrics(trades: List[Dict]) -> Dict:
    """احسب WR / PF / MaxDD / AvgWin / AvgLoss من الصفقات المغلقة."""
    closed = []
    for t in trades:
        ret = t.get('actual_return')
        if ret is None:
            continue
        try:
            ret_f = float(ret)
        except (TypeError, ValueError):
            continue
        if abs(ret_f) > 50:  # HARD cap (Rule 7)
            continue
        status = (t.get('status') or '').upper()
        if status not in ('CLOSED', 'TARGET_HIT', 'STOPPED', 'EXPIRED'):
            continue
        closed.append({**t, 'return': ret_f})

    if not closed:
        return {
            'total_closed': 0, 'wins': 0, 'losses': 0,
            'win_rate': 0, 'profit_factor': 0,
            'avg_win': 0, 'avg_loss': 0, 'max_drawdown': 0, 'total_return': 0,
        }

    wins = [c for c in closed if c['return'] > 0]
    losses = [c for c in closed if c['return'] <= 0]
    total_win = sum(c['return'] for c in wins)
    total_loss = abs(sum(c['return'] for c in losses))

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


def simulate_balanced_only(trades: List[Dict]) -> List[Dict]:
    """模拟 "ماذا لو" كل التوقعات اتعملت بـ thresholds الـ balanced فقط.

    المنطق: لو السهم score ≥ 42 (balanced buy threshold) → قبل. غير كده → رفض.
    ده بـ يحاكي إننا مش بنـ allow gambler (threshold=28) ولا conservative (threshold=50).
    """
    accepted = []
    for t in trades:
        # لازم نعرف score التوقع — ممكن نستخدم master_score أو technical_score
        score = float(t.get('master_score') or t.get('technical_score') or 0)
        # balanced buy threshold = 42 (bull) / 45 (bear) / 40 (range)
        # بنـ use 42 كـ default (bull)
        if score >= 42 or (t.get('signal') or t.get('signal_type') in ('STRONG_BUY', 'BUY', 'WATCH')):
            # لو في إشارة شراء + score ≥ 42 → قبل
            accepted.append(t)
        elif (t.get('signal') or t.get('signal_type')) == 'WATCH':
            # WATCH = مش BUY — نرفضه (gambler كان بيقبل WATCH لو score ≥ 28)
            continue
        else:
            accepted.append(t)
    return accepted


def main():
    preds = load_predictions()
    print(f'\n{"="*70}')
    print(f'  Backtest: UNIFIED-BALANCED-ONLY (تعطيل تعدد الشخصيات)')
    print(f'{"="*70}')
    print(f'📊 إجمالي التوقعات: {len(preds)}')

    if not preds:
        return

    # توزيع persona في الـ DB
    persona_dist = {}
    for p in preds:
        pers = p.get('persona') or 'unknown'
        persona_dist[pers] = persona_dist.get(pers, 0) + 1
    print(f'📊 توزيع persona في DB: {persona_dist}')

    # توزيع signal
    signal_dist = {}
    for p in preds:
        sig = p.get('signal') or p.get('signal_type') or 'UNKNOWN'
        signal_dist[sig] = signal_dist.get(sig, 0) + 1
    print(f'📊 توزيع signal: {signal_dist}')

    # توزيع status
    status_dist = {}
    for p in preds:
        st = (p.get('status') or 'UNKNOWN').upper()
        status_dist[st] = status_dist.get(st, 0) + 1
    print(f'📊 توزيع status: {status_dist}')

    # ===== قبل التعطيل (كل التوقعات كما هي) =====
    print(f'\n{"─"*70}')
    print(f'  قبل التعطيل (كل personas بأ thresholds مختلفة)')
    print(f'{"─"*70}')
    before = compute_metrics(preds)
    print(f'  إجمالي الصفقات المغلقة: {before["total_closed"]}')
    print(f'  Wins / Losses: {before["wins"]} / {before["losses"]}')
    print(f'  Win Rate: {before["win_rate"]}%')
    print(f'  Profit Factor: {before["profit_factor"]}')
    print(f'  متوسط الربح: +{before["avg_win"]}%')
    print(f'  متوسط الخسارة: -{before["avg_loss"]}%')
    print(f'  Max Drawdown: -{before["max_drawdown"]}%')
    print(f'  Total Return: {before["total_return"]}%')

    # ===== بعد التعطيل (كل التوقعات balanced) =====
    print(f'\n{"─"*70}')
    print(f'  بعد التعطيل (UNIFIED-BALANCED-ONLY)')
    print(f'{"─"*70}')
    # محاكاة: نفلتر التوقعات اللي كانت هتقبلها الـ balanced بس
    # (يعني الـ gambler-specific trades اللي score<42 هتترفض)
    balanced_preds = []
    rejected_by_balanced = []
    for p in preds:
        sig = (p.get('signal') or p.get('signal_type') or '').upper()
        score = float(p.get('master_score') or t.get('technical_score') or 0) if False else 0
        # الـ DB مش بتحفظ master_score، فبنـ use logic مختلف:
        # لو persona = gambler + signal = STRONG_BUY/BUY → نـ reject (لأن gambler قبلها بـ score<42)
        # لو persona = balanced/conservative → قبل زي ما هي
        pers = (p.get('persona') or 'balanced').lower()
        if pers in ('gambler', 'active_trader'):
            # gambler-specific — بنـ reject (UNIFIED-BALANCED-ONLY)
            rejected_by_balanced.append(p)
        else:
            balanced_preds.append(p)

    after = compute_metrics(balanced_preds)
    print(f'  إجمالي الصفقات المغلقة: {after["total_closed"]}')
    print(f'  Wins / Losses: {after["wins"]} / {after["losses"]}')
    print(f'  Win Rate: {after["win_rate"]}%')
    print(f'  Profit Factor: {after["profit_factor"]}')
    print(f'  متوسط الربح: +{after["avg_win"]}%')
    print(f'  متوسط الخسارة: -{after["avg_loss"]}%')
    print(f'  Max Drawdown: -{after["max_drawdown"]}%')
    print(f'  Total Return: {after["total_return"]}%')

    # ===== التوقعات المرفوضة =====
    print(f'\n{"─"*70}')
    print(f'  التوقعات المرفوضة (gambler-specific — هتترفض)')
    print(f'{"─"*70}')
    rejected_metrics = compute_metrics(rejected_by_balanced)
    print(f'  عدد التوقعات المرفوضة: {len(rejected_by_balanced)}')
    print(f'  صفقات مغلقة فيهم: {rejected_metrics["total_closed"]}')
    print(f'  Wins / Losses: {rejected_metrics["wins"]} / {rejected_metrics["losses"]}')
    print(f'  Win Rate: {rejected_metrics["win_rate"]}%')
    print(f'  Profit Factor: {rejected_metrics["profit_factor"]}')
    print(f'  Total Return: {rejected_metrics["total_return"]}%')

    # ===== مقارنة نهائية =====
    print(f'\n{"="*70}')
    print(f'  مقارنة نهائية (النتائج هي الحكم)')
    print(f'{"="*70}')
    print(f'  {"المقياس":<25} {"قبل":<15} {"بعد":<15} {"التغيير":<15}')
    print(f'  {"─"*70}')
    def fmt(v):
        if isinstance(v, float) and v == float('inf'):
            return '∞'
        return str(v)
    def fmt_delta(v):
        if isinstance(v, float) and v == float('inf'):
            return '+∞'
        if isinstance(v, (int, float)):
            return f'{v:+.2f}'
        return str(v)
    print(f'  {"إجمالي المغلقة":<25} {before["total_closed"]:<15} {after["total_closed"]:<15} {after["total_closed"]-before["total_closed"]:+d}')
    print(f'  {"Win Rate %":<25} {before["win_rate"]:<15} {after["win_rate"]:<15} {fmt_delta(after["win_rate"]-before["win_rate"])}')
    print(f'  {"Profit Factor":<25} {fmt(before["profit_factor"]):<15} {fmt(after["profit_factor"]):<15} {fmt_delta(after["profit_factor"]-before["profit_factor"] if isinstance(after["profit_factor"], (int,float)) and isinstance(before["profit_factor"], (int,float)) else 0)}')
    print(f'  {"Avg Win %":<25} +{before["avg_win"]:<14} +{after["avg_win"]:<14} {fmt_delta(after["avg_win"]-before["avg_win"])}')
    print(f'  {"Avg Loss %":<25} -{before["avg_loss"]:<14} -{after["avg_loss"]:<14} {fmt_delta(before["avg_loss"]-after["avg_loss"])}')
    print(f'  {"Max Drawdown %":<25} -{before["max_drawdown"]:<14} -{after["max_drawdown"]:<14} {fmt_delta(before["max_drawdown"]-after["max_drawdown"])}')
    print(f'  {"Total Return %":<25} {before["total_return"]:<15} {after["total_return"]:<15} {fmt_delta(after["total_return"]-before["total_return"])}')

    # ===== الحكم =====
    print(f'\n{"="*70}')
    print(f'  الحكم (بناءً على النتائج)')
    print(f'{"="*70}')
    wr_improved = after['win_rate'] >= before['win_rate']
    pf_improved = (after['profit_factor'] >= before['profit_factor']) if before['profit_factor'] != float('inf') else True
    dd_improved = after['max_drawdown'] <= before['max_drawdown']

    verdicts = []
    if wr_improved:
        verdicts.append(f'✅ Win Rate: تحسن ({before["win_rate"]}% → {after["win_rate"]}%)')
    else:
        verdicts.append(f'⚠️ Win Rate: تراجع ({before["win_rate"]}% → {after["win_rate"]}%)')
    if pf_improved:
        verdicts.append(f'✅ Profit Factor: تحسن/ثابت ({fmt(before["profit_factor"])} → {fmt(after["profit_factor"])})')
    else:
        verdicts.append(f'⚠️ Profit Factor: تراجع ({fmt(before["profit_factor"])} → {fmt(after["profit_factor"])})')
    if dd_improved:
        verdicts.append(f'✅ Max Drawdown: تحسن/ثابت ({before["max_drawdown"]}% → {after["max_drawdown"]}%)')
    else:
        verdicts.append(f'⚠️ Max Drawdown: تراجع ({before["max_drawdown"]}% → {after["max_drawdown"]}%)')

    for v in verdicts:
        print(f'  {v}')

    all_improved = wr_improved and pf_improved and dd_improved
    print(f'\n  الخلاصة: {"✅ التعطيل مفيد — يُعتمد" if all_improved else "⚠️ نتائج مختلطة — يحتاج مراجعة"}')

    # حفظ النتائج
    output_path = str(PROJECT_ROOT / 'db' / 'balanced_only_backtest_results.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'total_predictions': len(preds),
            'persona_distribution': persona_dist,
            'signal_distribution': signal_dist,
            'status_distribution': status_dist,
            'before_metrics': before,
            'after_metrics': after,
            'rejected_metrics': rejected_metrics,
            'verdict': {
                'wr_improved': wr_improved,
                'pf_improved': pf_improved,
                'dd_improved': dd_improved,
                'all_improved': all_improved,
            },
        }, f, ensure_ascii=False, indent=2)
    print(f'\n💾 تم حفظ النتائج في {output_path}')


if __name__ == '__main__':
    main()
