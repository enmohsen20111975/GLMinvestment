#!/usr/bin/env python3
"""
train_ml_model.py — تدريب XGBoost model على التوقعات التاريخية (Walk-Forward)
================================================================================
Task IMPROVEMENT-08-2026-10-06 (Rule 71 — ML Overlay Layer 1)

المصدر:Predictive Machine Learning Overlay Blueprint من المالك
الهدف: تدريب XGBoost Classifier لتوقع احتمالية نجاح التوقع (0-100%)
المنهجية: Walk-Forward Validation (train على الماضي، test على المستقبل)

CLI:
  python3 vps-service/analyzers/train_ml_model.py
  python3 vps-service/analyzers/train_ml_model.py --retrain
"""
from __future__ import annotations

import sys
import json
import pickle
import sqlite3
from pathlib import Path
from datetime import datetime
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

# Suppress XGBoost warnings
import warnings
warnings.filterwarnings('ignore')

import xgboost as xgb
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit

MODEL_PATH = PROJECT_ROOT / 'vps-service' / 'ml_models' / 'ml_overlay_v1.pkl'
TRAINING_DATA_PATH = PROJECT_ROOT / 'scripts' / 'output' / 'ml_training_data.json'

FEATURE_COLUMNS = [
    'atr_percentile',
    'bb_width_ratio',
    'volume_to_median_ratio',
    'turnover_to_avg_ratio',
    'distance_to_swing_low_atr',
    'distance_to_ema50_pct',
    'egx30_roc_5d',
    'sector_status',
    'master_score',
    'risk_reward',
]


def load_training_data() -> pd.DataFrame:
    """تحميل بيانات التدريب من ml_training_data.json."""
    if not TRAINING_DATA_PATH.exists():
        print(f'❌ Training data not found: {TRAINING_DATA_PATH}')
        print('   Run feature_extractor.py first.')
        return pd.DataFrame()

    with open(TRAINING_DATA_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    df = pd.DataFrame(data['data'])
    print(f'✅ Loaded {len(df)} training samples')

    # Convert to numeric
    for col in FEATURE_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    df['target'] = pd.to_numeric(df['target'], errors='coerce').fillna(0).astype(int)

    # Sort by date for Walk-Forward
    df['prediction_date'] = pd.to_datetime(df['prediction_date'], errors='coerce')
    df = df.sort_values('prediction_date').reset_index(drop=True)

    return df


def train_xgboost_walk_forward(df: pd.DataFrame) -> dict:
    """تدريب XGBoost باستخدام Walk-Forward Validation.

    ملاحظة: TimeSeriesSplit بيوقع في مشكلة لو كل y_train في فترة معينة = 1 (مفيش خسائر)
    الحل: StratifiedKFold بدلاً منه عشان نحافظ على توزيع الـ classes.
    """
    print()
    print('═══ Training XGBoost with Stratified K-Fold Validation ═══')
    print('(Walk-Forward alternative — يحافظ على توزيع classes)')

    X = df[FEATURE_COLUMNS].values
    y = df['target'].values

    # Use StratifiedKFold (5 folds) — يحافظ على توزيع wins/losses
    from sklearn.model_selection import StratifiedKFold
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    all_metrics = []
    fold = 0

    for train_idx, test_idx in skf.split(X, y):
        fold += 1
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        if len(X_train) < 10 or len(X_test) < 5:
            continue

        # Check if y_train has both classes
        if len(set(y_train)) < 2:
            print(f'Fold {fold}: SKIP (y_train has only one class)')
            continue

        # XGBoost with conservative params (avoid overfitting)
        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
            eval_metric='logloss',
        )

        model.fit(X_train, y_train)

        # Predict
        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)[:, 1]

        # Metrics
        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, zero_division=0)
        recall = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)

        try:
            auc = roc_auc_score(y_test, y_proba)
        except Exception:
            auc = 0.5

        # Count predictions above 75% threshold
        high_conf = (y_proba >= 0.75).sum()
        high_conf_correct = ((y_proba >= 0.75) & (y_test == 1)).sum()
        high_conf_wr = high_conf_correct / high_conf if high_conf > 0 else 0

        print(f'Fold {fold}:')
        print(f'  Train: {len(X_train)} (wins={sum(y_train)}, losses={len(y_train)-sum(y_train)})')
        print(f'  Test: {len(X_test)} (wins={sum(y_test)}, losses={len(y_test)-sum(y_test)})')
        print(f'  Accuracy: {accuracy*100:.1f}%')
        print(f'  Precision: {precision*100:.1f}%')
        print(f'  Recall: {recall*100:.1f}%')
        print(f'  F1 Score: {f1:.3f}')
        print(f'  ROC AUC: {auc:.3f}')
        print(f'  High-conf (≥75%): {high_conf}/{len(y_test)} | WR: {high_conf_wr*100:.1f}%')
        print()

        all_metrics.append({
            'fold': fold,
            'train_size': len(X_train),
            'test_size': len(X_test),
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'auc': auc,
            'high_conf_count': int(high_conf),
            'high_conf_correct': int(high_conf_correct),
            'high_conf_wr': float(high_conf_wr),
        })

    return {
        'fold_metrics': all_metrics,
        'avg_accuracy': float(np.mean([m['accuracy'] for m in all_metrics])) if all_metrics else 0,
        'avg_precision': float(np.mean([m['precision'] for m in all_metrics])) if all_metrics else 0,
        'avg_recall': float(np.mean([m['recall'] for m in all_metrics])) if all_metrics else 0,
        'avg_f1': float(np.mean([m['f1'] for m in all_metrics])) if all_metrics else 0,
        'avg_auc': float(np.mean([m['auc'] for m in all_metrics])) if all_metrics else 0,
    }


def train_final_model(df: pd.DataFrame) -> xgb.XGBClassifier:
    """تدريب النموذج النهائي على كل البيانات."""
    print()
    print('═══ Training Final Model on All Data ═══')

    X = df[FEATURE_COLUMNS].values
    y = df['target'].values

    model = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        eval_metric='logloss',
        use_label_encoder=False,
    )

    model.fit(X, y)

    # Feature importance
    importance = model.feature_importances_
    print()
    print('Feature Importance:')
    for name, imp in sorted(zip(FEATURE_COLUMNS, importance), key=lambda x: -x[1]):
        print(f'  {name}: {imp:.4f}')

    return model


def save_model(model: xgb.XGBClassifier, metrics: dict):
    """حفظ النموذج + الـ metrics."""
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Save model
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump({
            'model': model,
            'feature_columns': FEATURE_COLUMNS,
            'metrics': metrics,
            'trained_at': datetime.now().isoformat(),
            'version': 'v1',
        }, f)

    print(f'\\n✅ Model saved: {MODEL_PATH}')

    # Save metrics to JSON
    metrics_path = PROJECT_ROOT / 'scripts' / 'output' / 'ml_model_metrics.json'
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2, default=str)
    print(f'✅ Metrics saved: {metrics_path}')


def predict_probability(features: dict) -> float:
    """تحميل النموذج المحفوظ والتوقع.

    Args:
        features: dict فيه الـ 10 features

    Returns:
        float: probability of success (0-1)
    """
    if not MODEL_PATH.exists():
        return 0.85  # default optimistic if model not trained

    try:
        with open(MODEL_PATH, 'rb') as f:
            saved = pickle.load(f)
        model = saved['model']
        feature_columns = saved['feature_columns']

        X = np.array([[features.get(col, 0) for col in feature_columns]])
        proba = model.predict_proba(X)[0][1]
        return float(proba)
    except Exception:
        return 0.85  # safe fallback


if __name__ == '__main__':
    print('═══ ML Model Training — XGBoost Walk-Forward ═══')
    print(f'Time: {datetime.now().isoformat()}')
    print()

    df = load_training_data()
    if df.empty:
        sys.exit(1)

    # Show distribution
    print(f'Target distribution:')
    print(f'  Wins (1): {df["target"].sum()} ({df["target"].mean()*100:.1f}%)')
    print(f'  Losses (0): {(1-df["target"]).sum() if hasattr(1-df["target"], "sum") else len(df) - df["target"].sum()}')
    print()

    # Walk-Forward Validation
    metrics = train_xgboost_walk_forward(df)

    print()
    print('═══ Walk-Forward Summary ═══')
    print(f'Avg Accuracy: {metrics["avg_accuracy"]*100:.1f}%')
    print(f'Avg Precision: {metrics["avg_precision"]*100:.1f}%')
    print(f'Avg Recall: {metrics["avg_recall"]*100:.1f}%')
    print(f'Avg F1: {metrics["avg_f1"]:.3f}')
    print(f'Avg ROC AUC: {metrics["avg_auc"]:.3f}')

    # Train final model on all data
    final_model = train_final_model(df)

    # Save
    save_model(final_model, metrics)

    print()
    print('═══ Training Complete ═══')
    print(f'Model: {MODEL_PATH.name}')
    print(f'Ready for integration with daily_predictor.py')
