#!/usr/bin/env python3
"""
train_from_prices.py — يدرب Direction Model من الأسعار الحقيقية مباشرة.

لا يحتاج predictions.db.
لا يحتاج synthetic predictions.
يقرا OHLCV من data_engine.db + stocks.db (مصادر حقيقية).

Usage:
  python3 -m learning_engine.cli.train_from_prices --market EGX --horizon 5
"""
from __future__ import annotations
import sys
import json
import pickle
import numpy as np
from pathlib import Path
from datetime import datetime
import argparse

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_PROJECT_ROOT))

from learning_engine.adapters.price_based_dataset_adapter import PriceBasedDatasetBuilder


def main():
    parser = argparse.ArgumentParser(description="Train Direction Model from real prices")
    parser.add_argument("--market", default="ALL", help="Market (EGX, US, ALL=all markets)")
    parser.add_argument("--horizon", type=int, default=5, help="Label horizon in days")
    parser.add_argument("--max-samples", type=int, default=50000, help="Max samples")
    parser.add_argument("--min-samples", type=int, default=50, help="Min samples to train")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"Learning Engine — Train from REAL PRICES")
    print(f"Market: {args.market} | Horizon: {args.horizon}d")
    print(f"{'='*60}")

    # 1. بناء dataset من الأسعار الحقيقية
    print(f"\n[1/4] Building dataset from real prices...")
    builder = PriceBasedDatasetBuilder()
    X_dicts, y, metadata = builder.build_dataset(
        market=args.market,
        horizon=args.horizon,
        max_samples=args.max_samples,
    )

    if len(X_dicts) < args.min_samples:
        print(f"\n❌ Insufficient samples: {len(X_dicts)} < {args.min_samples}")
        print(f"   Try: --market US (more data) or --max-samples 1000")
        sys.exit(1)

    # 2. تحويل لـ matrix
    print(f"\n[2/4] Preparing feature matrix...")
    # استخرج feature names (بدون _ prefix + بدون categorical strings)
    all_feature_names = set()
    for d in X_dicts:
        for k, v in d.items():
            if not k.startswith("_") and isinstance(v, (int, float)):
                all_feature_names.add(k)
    feature_names = sorted(all_feature_names)

    # تحويل market_regime لـ numeric (DEFENSIVE=0, NORMAL=1, AGGRESSIVE=2, UNKNOWN=-1)
    regime_map = {"DEFENSIVE": 0, "NORMAL": 1, "AGGRESSIVE": 2, "UNKNOWN": -1}

    X = []
    for d in X_dicts:
        row = []
        for fn in feature_names:
            val = d.get(fn, 0.0)
            row.append(float(val) if isinstance(val, (int, float)) else 0.0)
        # أضف regime كـ numeric
        regime_val = d.get("market_regime", "UNKNOWN")
        row.append(float(regime_map.get(regime_val, -1)))
        X.append(row)

    feature_names.append("market_regime_numeric")

    X_arr = np.array(X, dtype=np.float64)
    X_arr = np.nan_to_num(X_arr, nan=0.0, posinf=1e10, neginf=-1e10)
    y_arr = np.array(y, dtype=np.float64)
    # تحويل لـ binary (0/1) — إزالة الـ 0.5 (neutral)
    # neutral samples تـ تـستبعد
    non_neutral = y_arr != 0.5
    X_arr = X_arr[non_neutral]
    y_arr = y_arr[non_neutral]
    y_arr = (y_arr >= 0.5).astype(np.float64)  # 1.0 or 0.0

    print(f"  Features: {len(feature_names)}")
    print(f"  Samples: {len(X_arr)}")
    print(f"  Positive: {int(sum(y_arr))} ({int(sum(y_arr)*100/len(y_arr))}%)")
    print(f"  Negative: {int(len(y_arr) - sum(y_arr))} ({int((len(y_arr) - sum(y_arr))*100/len(y_arr))}%)")
    neutral_removed = len(y) - len(y_arr)
    if neutral_removed > 0:
        print(f"  Neutral (excluded): {neutral_removed}")

    # 3. Walk-forward training
    print(f"\n[3/4] Training LightGBM with walk-forward...")
    try:
        import lightgbm as lgb
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
    except ImportError:
        print("❌ Install: pip install lightgbm scikit-learn")
        sys.exit(1)

    # ترتيب زمني
    dates = [d.get("_date", "") for d in X_dicts]
    sorted_idx = sorted(range(len(X_arr)), key=lambda i: dates[i])
    X_sorted = X_arr[sorted_idx]
    y_sorted = y_arr[sorted_idx]

    tscv = TimeSeriesSplit(n_splits=5)
    fold_metrics = []

    for fold, (train_idx, test_idx) in enumerate(tscv.split(X_sorted), 1):
        X_train, X_test = X_sorted[train_idx], X_sorted[test_idx]
        y_train, y_test = y_sorted[train_idx], y_sorted[test_idx]

        if len(set(y_train)) < 2:
            print(f"  Fold {fold}: SKIP (one class)")
            continue

        model = lgb.LGBMClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
            verbose=-1,
        )

        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)[:, 1]

        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)

        try:
            auc = roc_auc_score(y_test, y_proba) if len(set(y_test)) > 1 else 0.5
        except:
            auc = 0.5

        fold_metrics.append({
            "fold": fold,
            "train_size": len(X_train),
            "test_size": len(X_test),
            "accuracy": round(acc, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "auc": round(auc, 4),
        })

        print(f"  Fold {fold}: train={len(X_train)} test={len(X_test)} | acc={acc:.3f} f1={f1:.3f} auc={auc:.3f}")

    # 4. تدريب نهائي على كل البيانات
    print(f"\n[4/4] Final training on full dataset...")
    final_model = lgb.LGBMClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        verbose=-1,
    )
    final_model.fit(X_sorted, y_sorted)

    # أهمية المتغيرات
    importance = dict(zip(feature_names, final_model.feature_importances_.tolist()))
    importance = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))

    # حفظ النموذج
    model_id = f"direction_h{args.horizon}_{args.market}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    registry_dir = _PROJECT_ROOT / "learning_engine" / "registry" / "artifacts"
    registry_dir.mkdir(parents=True, exist_ok=True)

    model_path = registry_dir / f"{model_id}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump({
            "model": final_model,
            "feature_names": feature_names,
            "metadata": metadata,
            "fold_metrics": fold_metrics,
            "importance": importance,
        }, f)

    # النتائج
    print(f"\n{'='*60}")
    print(f"RESULTS")
    print(f"{'='*60}")
    print(f"Model ID: {model_id}")
    print(f"Market: {args.market}")
    print(f"Samples: {len(X)}")
    print(f"Source: REAL PRICES (egksco + stock_daily_prices)")

    if fold_metrics:
        avg_acc = sum(m["accuracy"] for m in fold_metrics) / len(fold_metrics)
        avg_f1 = sum(m["f1"] for m in fold_metrics) / len(fold_metrics)
        avg_auc = sum(m["auc"] for m in fold_metrics) / len(fold_metrics)
        print(f"\nWalk-forward metrics (avg {len(fold_metrics)} folds):")
        print(f"  Accuracy: {avg_acc:.4f}")
        print(f"  F1:       {avg_f1:.4f}")
        print(f"  AUC:      {avg_auc:.4f}")

    print(f"\nTop 10 features:")
    for i, (name, imp) in enumerate(list(importance.items())[:10]):
        print(f"  {i+1}. {name}: {imp:.1f}")

    print(f"\nModel saved: {model_path}")
    print(f"\n✅ Training complete — trained from REAL price data")


if __name__ == "__main__":
    main()
