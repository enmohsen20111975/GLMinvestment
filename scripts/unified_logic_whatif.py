#!/usr/bin/env python3
"""
unified_logic_whatif.py — تحليل "ماذا لو" للمنطق الموحد على التوقعات الموجودة
=============================================================================
UNIFIED-LOGIC (2026-08-30): قياس تأثير المنطق الموحد على التوقعات الموجودة.

لكل توقع في predictions.db:
  1. حمّل price_history قبله من prices.db (egx_prices)
  2. طبّق المنطق الموحد:
     - classify_correction_stage (DEEP/LATE/RECOVERY/EXTENDED/NONE)
     - is_in_active_correction (entry gate)
     - is_extended_chase (Don't Chase)
  3. لو أي gate رفض → سجّله كـ "would be vetoed"
  4. قارن النتيجة الفعلية للتوقعات المقبولة vs المرفوضة

الهدف: نعرف كم توقع سيء كان هيتم رفضه بالمنطق الموحد.
"""
from __future__ import annotations
import os
import sys
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

from utils.stock_state import (
    classify_correction_stage,
    is_in_active_correction,
    is_extended_chase,
    confirm_recovery_starting,
)


def load_price_history(ticker: str, before_date: str, db_path: str, days: int = 60) -> List[Dict]:
    """حمّل آخر N يوم من price_history قبل تاريخ معين."""
    if not os.path.exists(db_path):
        return []
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT ticker, price_date, open_price, high_price, low_price,
                      close_price, volume
               FROM egx_prices
               WHERE ticker = ? AND price_date <= ?
               ORDER BY price_date DESC
               LIMIT ?""",
            (ticker, before_date, days)
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    conn.close()
    # رتّع من قديم لجديد
    return [dict(r) for r in reversed(rows)]


def load_predictions() -> List[Dict]:
    """حمّل كل التوقعات من predictions.db."""
    db_path = str(PROJECT_ROOT / 'db' / 'predictions.db')
    if not os.path.exists(db_path):
        return []
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT id, ticker, signal, signal_type, persona,
                      entry_price, target_price, stop_loss,
                      prediction_date, outcome_date, status, exit_type,
                      actual_return
               FROM predictions
               ORDER BY prediction_date DESC"""
        ).fetchall()
    except sqlite3.OperationalError as e:
        print(f'SQL error: {e}')
        rows = []
    conn.close()
    return [dict(r) for r in rows]


def analyze_prediction(pred: Dict, prices_db: str) -> Dict:
    """حلّل توقع واحد بالمنطق الموحد."""
    ticker = pred.get('ticker', '')
    pred_date = pred.get('prediction_date', '')[:10]
    if not ticker or not pred_date:
        return {'vetoed': True, 'reason': 'بيانات ناقصة'}

    price_history = load_price_history(ticker, pred_date, prices_db, days=60)
    if len(price_history) < 20:
        return {'vetoed': True, 'reason': f'بيانات أسعار غير كافية ({len(price_history)} يوم)'}

    # بناء stock dict
    closes = [float(p['close_price']) for p in price_history if p['close_price'] and p['close_price'] > 0]
    if not closes:
        return {'vetoed': True, 'reason': 'مفيش أسعار صالحة'}

    last_price = closes[-1]
    avg_vol_arr = [float(p['volume'] or 0) for p in price_history[-20:]]
    avg_vol = sum(avg_vol_arr) / len(avg_vol_arr) if avg_vol_arr else 0
    last_vol = float(price_history[-1].get('volume') or 0)

    # حساب MA50
    ma50 = sum(closes[-50:]) / len(closes[-50:]) if len(closes) >= 50 else None
    # RSI بسيط (14 يوم)
    rsi = None
    if len(closes) >= 15:
        gains = []
        losses = []
        for i in range(1, min(15, len(closes))):
            diff = closes[-(i)] - closes[-(i+1)]
            if diff > 0:
                gains.append(diff)
            else:
                losses.append(abs(diff))
        avg_gain = sum(gains) / 14 if gains else 0
        avg_loss = sum(losses) / 14 if losses else 0
        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

    # change_percent (آخر يوم)
    change = 0
    if len(closes) >= 2:
        change = ((closes[-1] - closes[-2]) / closes[-2]) * 100

    stock = {
        'current_price': last_price,
        'change_percent': change,
        'ma_50': ma50,
        'rsi': rsi,
        'avg_volume': avg_vol,
        'volume': last_vol,
        'high_52w': max(closes) if closes else None,
        'low_52w': min(closes) if closes else None,
    }

    # طبّق المنطق الموحد
    stage = classify_correction_stage(stock, price_history)
    in_active = is_in_active_correction(stock)
    is_chase = is_extended_chase(stock, price_history)

    vetoed = False
    reasons = []
    if stage.get('stage') in ('DEEP_CORRECTION', 'EXTENDED_CHASE'):
        vetoed = True
        reasons.append(f"stage={stage.get('stage')}: {stage.get('reason')}")
    if in_active:
        vetoed = True
        reasons.append('active_correction')
    if is_chase:
        vetoed = True
        reasons.append("Don't Chase")

    return {
        'vetoed': vetoed,
        'reasons': '; '.join(reasons) if reasons else '',
        'stage': stage.get('stage'),
        'stage_ar': stage.get('stage_ar'),
        'drawdown_pct': stage.get('drawdown_pct'),
        'roc_3d': stage.get('roc_3d'),
        'roc_5d': stage.get('roc_5d'),
    }


def main():
    prices_db = str(PROJECT_ROOT / 'db' / 'prices.db')
    if not os.path.exists(prices_db):
        print(f'❌ {prices_db} غير موجود')
        return

    preds = load_predictions()
    print(f'📊 إجمالي التوقعات: {len(preds)}')
    if not preds:
        return

    # حلّل كل توقع
    accepted = []
    vetoed_list = []
    for p in preds:
        result = analyze_prediction(p, prices_db)
        p['_whatif'] = result
        if result['vetoed']:
            vetoed_list.append(p)
        else:
            accepted.append(p)

    print(f'\n📈 تحليل "ماذا لو" للمنطق الموحد:')
    print(f'  توقعات مقبولة: {len(accepted)} ({len(accepted)/len(preds)*100:.1f}%)')
    print(f'  توقعات مرفوضة: {len(vetoed_list)} ({len(vetoed_list)/len(preds)*100:.1f}%)')

    # أسباب الرفض
    reason_dist = {}
    for v in vetoed_list:
        reasons_str = v['_whatif'].get('reasons', '') or ''
        for r in reasons_str.split('; '):
            if r:
                # اختصر السبب للـ first part
                short = r.split(':')[0].split('(')[0].strip()
                reason_dist[short] = reason_dist.get(short, 0) + 1
    print(f'\n📊 أسباب الرفض:')
    for r, c in sorted(reason_dist.items(), key=lambda x: -x[1]):
        print(f'  {r}: {c}')

    # توزيع stages
    stage_dist = {}
    for p in preds:
        s = p['_whatif'].get('stage') or 'NONE'
        stage_dist[s] = stage_dist.get(s, 0) + 1
    print(f'\n📊 توزيع correction stages:')
    for s, c in sorted(stage_dist.items(), key=lambda x: -x[1]):
        print(f'  {s}: {c}')

    # قارن النتائج الفعلية: accepted vs vetoed
    def compute_metrics(trades):
        closed = [t for t in trades
                  if (t.get('status') or '').upper() in ('CLOSED', 'TARGET_HIT', 'STOPPED', 'EXPIRED')
                  and t.get('actual_return') is not None
                  and abs(float(t['actual_return'])) <= 50]
        if not closed:
            return {'total': 0, 'wr': 0, 'pf': 0, 'avg_win': 0, 'avg_loss': 0, 'total_ret': 0}
        wins = [t for t in closed if float(t['actual_return']) > 0]
        losses = [t for t in closed if float(t['actual_return']) <= 0]
        total_win = sum(float(t['actual_return']) for t in wins)
        total_loss = abs(sum(float(t['actual_return']) for t in losses))
        return {
            'total': len(closed),
            'wins': len(wins),
            'losses': len(losses),
            'wr': round(len(wins)/len(closed)*100, 1) if closed else 0,
            'pf': round(total_win/total_loss, 3) if total_loss > 0 else float('inf') if total_win > 0 else 0,
            'avg_win': round(total_win/len(wins), 2) if wins else 0,
            'avg_loss': round(total_loss/len(losses), 2) if losses else 0,
            'total_ret': round(sum(float(t['actual_return']) for t in closed), 2),
        }

    print(f'\n📈 مقارنة النتائج الفعلية (قبل vs بعد المنطق الموحد):')
    print(f'\nقبل المنطق الموحد (كل التوقعات):')
    before = compute_metrics(preds)
    print(f'  صفقات مغلقة: {before["total"]}')
    print(f'  Win Rate: {before["wr"]}%')
    print(f'  Profit Factor: {before["pf"]}')
    print(f'  Avg Win: +{before["avg_win"]}% | Avg Loss: -{before["avg_loss"]}%')
    print(f'  Total Return: {before["total_ret"]}%')

    print(f'\nبعد المنطق الموحد (المقبولة بس):')
    after = compute_metrics(accepted)
    print(f'  صفقات مغلقة: {after["total"]}')
    print(f'  Win Rate: {after["wr"]}%')
    print(f'  Profit Factor: {after["pf"]}')
    print(f'  Avg Win: +{after["avg_win"]}% | Avg Loss: -{after["avg_loss"]}%')
    print(f'  Total Return: {after["total_ret"]}%')

    print(f'\nالتوقعات المرفوضة (سيتم منعها):')
    rejected_metrics = compute_metrics(vetoed_list)
    print(f'  صفقات مغلقة: {rejected_metrics["total"]}')
    print(f'  Win Rate: {rejected_metrics["wr"]}%')
    print(f'  Profit Factor: {rejected_metrics["pf"]}')
    print(f'  Avg Win: +{rejected_metrics["avg_win"]}% | Avg Loss: -{rejected_metrics["avg_loss"]}%')
    print(f'  Total Return: {rejected_metrics["total_ret"]}%')

    # حفظ النتائج
    output_path = str(PROJECT_ROOT / 'db' / 'unified_logic_whatif_results.json')
    import json
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'total_predictions': len(preds),
            'accepted': len(accepted),
            'vetoed': len(vetoed_list),
            'reason_distribution': reason_dist,
            'stage_distribution': stage_dist,
            'before_metrics': before,
            'after_metrics': after,
            'rejected_metrics': rejected_metrics,
            'vetoed_details': [{
                'ticker': v.get('ticker'),
                'prediction_date': v.get('prediction_date'),
                'signal': v.get('signal') or v.get('signal_type'),
                'actual_return': v.get('actual_return'),
                'status': v.get('status'),
                'reasons': v['_whatif'].get('reasons', ''),
                'stage': v['_whatif'].get('stage'),
            } for v in vetoed_list],
        }, f, ensure_ascii=False, indent=2)
    print(f'\n💾 تم حفظ النتائج في {output_path}')


if __name__ == '__main__':
    main()
