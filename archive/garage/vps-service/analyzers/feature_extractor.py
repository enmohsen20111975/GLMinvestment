#!/usr/bin/env python3
"""
feature_extractor.py — استخراج المتغيرات (Features) للتدريب ML
=================================================================
Task IMPROVEMENT-08-2026-10-06 (Rule 71 — ML Overlay Layer 1)

المصدر:Predictive Machine Learning Overlay (Blueprint من المالك)
الهدف: استخراج 10 متغيرات من التوقعات التاريخية + بيانات الأسعار
المتغير المستهدف (Y): is_correct (1 لو TARGET_HIT، 0 لو STOPPED)

CLI:
  python3 vps-service/analyzers/feature_extractor.py
"""
from __future__ import annotations

import sqlite3
import sys
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))


def extract_features_for_prediction(prediction_row: Dict[str, Any], price_history_db: str = None) -> Dict[str, float]:
    """استخراج 10 متغيرات لتوقع واحد.

    Args:
        prediction_row: صف من predictions table
        price_history_db: مسار price_history.db

    Returns:
        dict فيه الـ 10 features + target (is_correct)
    """
    if price_history_db is None:
        price_history_db = str(PROJECT_ROOT / 'db' / 'price_history.db')

    features = {
        'atr_percentile': 0.0,
        'bb_width_ratio': 0.0,
        'volume_to_median_ratio': 0.0,
        'turnover_to_avg_ratio': 0.0,
        'distance_to_swing_low_atr': 0.0,
        'distance_to_ema50_pct': 0.0,
        'egx30_roc_5d': 0.0,
        'sector_status': 0.0,  # 0=dead, 1=neutral, 2=hot
        'master_score': 0.0,
        'risk_reward': 0.0,
    }

    ticker = prediction_row.get('ticker', '')
    entry = prediction_row.get('entry_price', 0) or 0
    target = prediction_row.get('target_price', 0) or 0
    stop = prediction_row.get('stop_loss', 0) or 0
    prediction_date = prediction_row.get('prediction_date', '')
    master_score = prediction_row.get('master_score', 0) or 0
    atr_at_entry = prediction_row.get('atr_at_entry', 0) or 0

    if not ticker or not entry or not prediction_date:
        return features

    # R:R
    if entry > 0 and stop > 0 and target > 0 and (entry - stop) > 0:
        features['risk_reward'] = (target - entry) / (entry - stop)

    features['master_score'] = master_score

    # قراءة بيانات الأسعار التاريخية
    try:
        conn = sqlite3.connect(price_history_db)
        conn.row_factory = sqlite3.Row

        # آخر 200 يوم قبل prediction_date
        rows = conn.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date <= ? AND close_price IS NOT NULL AND close_price > 0
            ORDER BY date DESC LIMIT 200
        ''', (ticker, prediction_date)).fetchall()

        if len(rows) >= 30:
            closes = [float(r['close_price']) for r in reversed(rows)]
            highs = [float(r['high_price']) for r in reversed(rows)]
            lows = [float(r['low_price']) for r in reversed(rows)]
            volumes = [float(r['volume'] or 0) for r in reversed(rows)]

            # 1) ATR Percentile
            if atr_at_entry > 0 and len(closes) >= 50:
                # calculate ATR historical
                trs = []
                for i in range(1, min(len(closes), 200)):
                    tr = max(
                        highs[i] - lows[i],
                        abs(highs[i] - closes[i-1]),
                        abs(lows[i] - closes[i-1])
                    )
                    trs.append(tr)
                if trs:
                    atr_avg = sum(trs) / len(trs)
                    if atr_avg > 0:
                        features['atr_percentile'] = atr_at_entry / atr_avg

            # 2) BB Width Ratio (Bollinger Bands width / avg width)
            if len(closes) >= 50:
                sma_20 = sum(closes[-20:]) / 20
                std_20 = (sum((c - sma_20) ** 2 for c in closes[-20:]) / 20) ** 0.5
                bb_width_current = 4 * std_20  # ±2 std

                # historical BB width (last 50 periods)
                bb_widths = []
                for i in range(20, len(closes)):
                    sma_i = sum(closes[i-20:i]) / 20
                    std_i = (sum((c - sma_i) ** 2 for c in closes[i-20:i]) / 20) ** 0.5
                    bb_widths.append(4 * std_i)

                if bb_widths and sum(bb_widths) > 0:
                    bb_width_avg = sum(bb_widths) / len(bb_widths)
                    if bb_width_avg > 0:
                        features['bb_width_ratio'] = bb_width_current / bb_width_avg

            # 3) Volume to Median Ratio
            if len(volumes) >= 50 and volumes[-1] > 0:
                sorted_vols = sorted(volumes[-50:])
                median_vol = sorted_vols[len(sorted_vols) // 2]
                if median_vol > 0:
                    features['volume_to_median_ratio'] = volumes[-1] / median_vol

            # 4) Turnover to Avg Ratio (لو entry هو close price)
            if len(volumes) >= 20 and entry > 0:
                last_turnover = entry * volumes[-1]
                avg_turnover = entry * (sum(volumes[-21:-1]) / 20) if len(volumes) >= 21 else 1
                if avg_turnover > 0:
                    features['turnover_to_avg_ratio'] = last_turnover / avg_turnover

            # 5) Distance to Swing Low (in ATR units)
            if len(lows) >= 20 and atr_at_entry > 0:
                swing_low = min(lows[-20:])
                distance = entry - swing_low
                features['distance_to_swing_low_atr'] = distance / atr_at_entry if atr_at_entry > 0 else 0

            # 6) Distance to EMA50 (%)
            if len(closes) >= 50:
                ema_50 = sum(closes[-50:]) / 50
                if ema_50 > 0:
                    features['distance_to_ema50_pct'] = (entry - ema_50) / ema_50 * 100

        conn.close()
    except Exception:
        pass

    # 7) EGX30 ROC 5d (macro)
    try:
        conn = sqlite3.connect(price_history_db)
        conn.row_factory = sqlite3.Row
        egx30_rows = conn.execute('''
            SELECT close_price FROM price_history
            WHERE ticker IN ('EGX30', 'EGX30ETF', 'EGS30', 'EGS30ETF', '^EGX30') AND date <= ?
            ORDER BY date DESC LIMIT 6
        ''', (prediction_date,)).fetchall()
        if len(egx30_rows) >= 6:
            today_close = float(egx30_rows[0]['close_price'])
            five_days_ago = float(egx30_rows[5]['close_price'])
            if five_days_ago > 0:
                features['egx30_roc_5d'] = (today_close - five_days_ago) / five_days_ago * 100
        conn.close()
    except Exception:
        pass

    # 8) Sector status (from predictions.db if available)
    sector = prediction_row.get('sector', '')
    if not sector:
        sector = ''
    if 'hot' in sector.lower():
        features['sector_status'] = 2
    elif 'dead' in sector.lower() or 'weak' in sector.lower():
        features['sector_status'] = 0
    else:
        features['sector_status'] = 1  # neutral default

    # Target variable (Y)
    status = prediction_row.get('status', '')
    if status == 'TARGET_HIT':
        target_y = 1
    elif status == 'STOPPED':
        target_y = 0
    else:
        target_y = None  # ignore active/expired

    features['target'] = target_y
    features['ticker'] = ticker
    features['prediction_date'] = prediction_date

    return features


def extract_all_training_data() -> Tuple[List[Dict[str, float]], List[Dict[str, float]]]:
    """استخراج كل التوقعات المحسومة (TARGET_HIT + STOPPED) من predictions.db.

    Returns:
        (training_data, metadata)
        training_data: list of feature dicts
        metadata: list of {ticker, prediction_date, status}
    """
    predictions_db = str(PROJECT_ROOT / 'db' / 'predictions.db')

    conn = sqlite3.connect(predictions_db)
    conn.row_factory = sqlite3.Row

    rows = conn.execute('''
        SELECT ticker, signal, prediction_date, entry_price, target_price, stop_loss,
               master_score, atr_at_entry, status, persona
        FROM predictions
        WHERE status IN ('TARGET_HIT', 'STOPPED')
          AND entry_price IS NOT NULL
          AND entry_price > 0
          AND target_price IS NOT NULL
          AND target_price > 0
          AND stop_loss IS NOT NULL
          AND stop_loss > 0
          AND prediction_date >= '2026-06-01'
        ORDER BY prediction_date ASC
    ''').fetchall()

    conn.close()

    training_data = []
    metadata = []

    for row in rows:
        row_dict = dict(row)
        features = extract_features_for_prediction(row_dict)

        if features.get('target') is not None:
            training_data.append(features)
            metadata.append({
                'ticker': features['ticker'],
                'prediction_date': features['prediction_date'],
                'status': row_dict['status'],
            })

    return training_data, metadata


if __name__ == '__main__':
    print('═══ Feature Extractor — ML Overlay Layer 1 ═══')
    print()

    data, meta = extract_all_training_data()

    print(f'Total resolved predictions: {len(data)}')
    if not data:
        print('❌ No training data available')
        sys.exit(1)

    # distribution
    targets = [d['target'] for d in data]
    wins = sum(targets)
    losses = len(targets) - wins
    print(f'Wins (TARGET_HIT): {wins}')
    print(f'Losses (STOPPED): {losses}')
    print(f'Win Rate: {wins/len(targets)*100:.1f}%')

    print()
    print('Sample features (first 3):')
    for i, d in enumerate(data[:3]):
        print(f'\\n[{i+1}] {meta[i]["ticker"]} {meta[i]["prediction_date"]} ({meta[i]["status"]})')
        for k, v in d.items():
            if k not in ('target', 'ticker', 'prediction_date'):
                print(f'  {k}: {v:.4f}')

    # save to JSON for train_ml_model.py
    output_path = PROJECT_ROOT / 'scripts' / 'output' / 'ml_training_data.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({'data': data, 'meta': meta}, f, ensure_ascii=False, indent=2, default=str)
    print(f'\\n✅ Training data saved: {output_path}')
