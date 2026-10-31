#!/usr/bin/env python3
"""
train_from_prices.py — يدرب Direction Model من الأسعار الحقيقية مباشرة.

لا يحتاج predictions.db.
لا يحتاج synthetic predictions.
يقرا OHLCV من data_engine.db + stocks.db (مصادر حقيقية).

FIXES (2026-10-31):
  - class_weight='balanced' افتراضياً (يعالج اختلال EGX 98% صعود)
  - cost_threshold قابل للتمرير (--cost-threshold 0.3 / 0.25 / 0.2)
  - Purged TimeSeriesSplit (يمنع leakage بين train/test للـ forward labels)
  - Confusion matrix + precision/recall لكل كلاس في كل fold
  - Baseline accuracy (always-predict-majority-class) للمقارنة
  - تحذير صريح لو الـ imbalance شديد بعد الإصلاح

Usage:
  python3 -m learning_engine.cli.train_from_prices --market EGX --horizon 5
  python3 -m learning_engine.cli.train_from_prices --market ALL --horizon 5 \\
      --cost-threshold 0.3 --max-samples 50000
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


def _print_confusion_matrix(y_true, y_pred, label=""):
    """يطبع confusion matrix بشكل واضح."""
    try:
        from sklearn.metrics import confusion_matrix
        cm = confusion_matrix(y_true, y_pred, labels=[0.0, 1.0])
        # cm = [[TN, FP], [FN, TP]]
        tn, fp, fn, tp = cm.ravel()
        total = tn + fp + fn + tp
        print(f"      Confusion Matrix {label}:")
        print(f"        TrueNeg (down=down):  {tn:4d}   FalsePos (up=down):   {fp:4d}")
        print(f"        FalseNeg (down=up):   {fn:4d}   TruePos (up=up):      {tp:4d}")
        # Precision/Recall per class
        prec_up = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec_up = tp / (tp + fn) if (tp + fn) > 0 else 0
        prec_dn = tn / (tn + fn) if (tn + fn) > 0 else 0
        rec_dn = tn / (tn + fp) if (tn + fp) > 0 else 0
        print(f"        Up:    prec={prec_up:.3f}  recall={rec_up:.3f}")
        print(f"        Down:  prec={prec_dn:.3f}  recall={rec_dn:.3f}")
    except Exception as e:
        print(f"      (confusion matrix skipped: {e})")


def _purged_time_series_split(n_samples, n_splits=5, purge_gap=5):
    """
    TimeSeriesSplit مع PURGING.
    يفصل بين نهاية train وبداية test بـ purge_gap عينات.
    ده ضروري عشان labels بتكون forward-looking (horizon أيام).
    بدون purging، آخر عينة train بتحسب label على أساس سعر بعد horizon يوم،
    واللي ممكن يكون داخل في test set → leakage.

    Returns:
      list of (train_idx, test_idx) tuples (numpy arrays)
    """
    fold_size = n_samples // (n_splits + 1)
    if fold_size < 10:
        # عينة صغيرة جداً — fallback لـ TimeSeriesSplit بدون purging
        from sklearn.model_selection import TimeSeriesSplit
        tscv = TimeSeriesSplit(n_splits=n_splits)
        return [(np.array(tr), np.array(te)) for tr, te in tscv.split(np.zeros(n_samples))]

    splits = []
    for i in range(n_splits):
        train_end = (i + 1) * fold_size
        test_start = train_end + purge_gap  # purge_gap عينات skipped
        test_end = test_start + fold_size
        if test_end > n_samples:
            test_end = n_samples
        if test_start >= n_samples or test_start >= train_end + purge_gap + 1:
            # fallback: ضمان إن test مش فاضي
            test_start = min(train_end + 1, n_samples - 1)
        if test_end <= test_start:
            continue
        train_idx = np.arange(0, train_end)
        test_idx = np.arange(test_start, test_end)
        if len(train_idx) > 0 and len(test_idx) > 0:
            splits.append((train_idx, test_idx))
    return splits


def main():
    parser = argparse.ArgumentParser(description="Train Direction Model from real prices")
    parser.add_argument("--market", default="ALL", help="Market (EGX, US, ALL=all markets)")
    parser.add_argument("--horizon", type=int, default=5, help="Label horizon in days")
    parser.add_argument("--max-samples", type=int, default=50000, help="Max samples")
    parser.add_argument("--min-samples", type=int, default=50, help="Min samples to train")
    parser.add_argument(
        "--cost-threshold", type=float, default=0.5,
        help="Min %% return to be labeled up/down (default 0.5). "
             "Try 0.3 or 0.25 to reduce neutrals."
    )
    parser.add_argument(
        "--class-weight", default="balanced",
        help="LightGBM class_weight (default 'balanced'). Use 'none' for no balancing."
    )
    parser.add_argument(
        "--purge-gap", type=int, default=None,
        help="Purge gap (samples) between train/test in walk-forward. "
             "Default = horizon (recommended for forward-looking labels)."
    )
    args = parser.parse_args()

    # purge_gap افتراضي = horizon (anti-leakage)
    purge_gap = args.purge_gap if args.purge_gap is not None else args.horizon

    # class_weight للـ LightGBM
    cw = 'balanced' if args.class_weight == 'balanced' else None

    print(f"\n{'='*70}")
    print(f"Learning Engine — Train from REAL PRICES (v2 — fixed imbalance)")
    print(f"{'='*70}")
    print(f"  Market:          {args.market}")
    print(f"  Horizon:         {args.horizon}d")
    print(f"  Cost threshold:  {args.cost_threshold}٪")
    print(f"  Class weight:    {args.class_weight}")
    print(f"  Purge gap:       {purge_gap} samples (anti-leakage)")
    print(f"{'='*70}")

    # 1. بناء dataset من الأسعار الحقيقية
    print(f"\n[1/4] Building dataset from real prices...")
    builder = PriceBasedDatasetBuilder()
    X_dicts, y, metadata = builder.build_dataset(
        market=args.market,
        horizon=args.horizon,
        max_samples=args.max_samples,
        cost_threshold=args.cost_threshold,
    )

    if len(X_dicts) < args.min_samples:
        print(f"\n❌ Insufficient samples: {len(X_dicts)} < {args.min_samples}")
        print(f"   Try: --market US (more data) or --max-samples 1000")
        print(f"   Or:  --cost-threshold 0.3 (recovers more samples by reducing neutrals)")
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

    n_total = len(X_arr)
    n_pos = int(sum(y_arr))
    n_neg = n_total - n_pos
    pos_pct = n_pos * 100 / n_total if n_total else 0
    neg_pct = n_neg * 100 / n_total if n_total else 0

    print(f"  Features:        {len(feature_names)}")
    print(f"  Total samples:   {n_total}")
    print(f"  Positive (up):   {n_pos} ({pos_pct:.1f}٪)")
    print(f"  Negative (down): {n_neg} ({neg_pct:.1f}٪)")
    neutral_removed = len(y) - len(y_arr)
    if neutral_removed > 0:
        print(f"  Neutral (excluded): {neutral_removed}")

    # تحذير من الـ imbalance الشديد
    if pos_pct > 80 or neg_pct > 80:
        majority = "UP" if pos_pct > 80 else "DOWN"
        print(f"\n  ⚠️  WARNING: Heavy class imbalance detected ({majority} = {max(pos_pct, neg_pct):.1f}٪)")
        print(f"      class_weight='balanced' سيعوض جزئياً، لكن النموذج لا يزال محدوداً.")
        print(f"     Baseline (predict majority class) = {max(pos_pct, neg_pct):.1f}٪ accuracy.")
        print(f"      النموذج لازم يـتـفوق على الـ baseline ليكون مفيداً.")
    else:
        baseline_acc = max(pos_pct, neg_pct)
        print(f"\n  Baseline (predict majority class) = {baseline_acc:.1f}٪ accuracy.")

    # 3. Walk-forward training مع PURGING
    print(f"\n[3/4] Training LightGBM with PURGED walk-forward (gap={purge_gap})...")
    try:
        import lightgbm as lgb
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
    except ImportError:
        print("❌ Install: pip install lightgbm scikit-learn")
        sys.exit(1)

    # ترتيب زمني
    dates = [d.get("_date", "") for d in X_dicts]
    # لاحظ: dates هنا بـ ترتيب الـ original X_dicts (قبل non_neutral filter)
    # لازم نطبق نفس الـ filter على dates قبل الفرز
    non_neutral_dates = [d for d, keep in zip(dates, non_neutral) if keep]
    sorted_idx = sorted(range(len(X_arr)), key=lambda i: non_neutral_dates[i])
    X_sorted = X_arr[sorted_idx]
    y_sorted = y_arr[sorted_idx]

    splits = _purged_time_series_split(len(X_sorted), n_splits=5, purge_gap=purge_gap)
    print(f"  Total splits: {len(splits)}")

    fold_metrics = []

    for fold, (train_idx, test_idx) in enumerate(splits, 1):
        X_train, X_test = X_sorted[train_idx], X_sorted[test_idx]
        y_train, y_test = y_sorted[train_idx], y_sorted[test_idx]

        # توزيع الكلاسات في train + test
        n_tr_pos = int(sum(y_train))
        n_tr_neg = len(y_train) - n_tr_pos
        n_te_pos = int(sum(y_test))
        n_te_neg = len(y_test) - n_te_pos

        if len(set(y_train)) < 2:
            print(f"  Fold {fold}: SKIP (one class in train) — train_pos={n_tr_pos} train_neg={n_tr_neg}")
            continue

        model = lgb.LGBMClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.1,
            reg_lambda=1.0,
            class_weight=cw,
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
        except Exception:
            auc = 0.5

        # Baseline لهذا الـ fold (predict majority class)
        baseline_acc = max(n_te_pos, n_te_neg) * 100 / len(y_test) if len(y_test) else 0
        # delta من baseline
        delta = (acc * 100) - baseline_acc

        fold_metrics.append({
            "fold": fold,
            "train_size": len(X_train),
            "test_size": len(X_test),
            "train_pos": n_tr_pos, "train_neg": n_tr_neg,
            "test_pos": n_te_pos, "test_neg": n_te_neg,
            "baseline_acc": round(baseline_acc / 100, 4),
            "accuracy": round(acc, 4),
            "delta_vs_baseline_pct": round(delta, 2),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "auc": round(auc, 4),
        })

        print(f"\n  Fold {fold}: train={len(X_train)} (pos={n_tr_pos},neg={n_tr_neg}) "
              f"test={len(X_test)} (pos={n_te_pos},neg={n_te_neg})")
        print(f"    Baseline (majority): {baseline_acc:.1f}٪ | Model: {acc*100:.1f}٪ | Δ={delta:+.1f}pp")
        print(f"    acc={acc:.3f} prec={prec:.3f} rec={rec:.3f} f1={f1:.3f} auc={auc:.3f}")
        _print_confusion_matrix(y_test, y_pred, label=f"(fold {fold})")

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
        class_weight=cw,
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
            "config": {
                "cost_threshold": args.cost_threshold,
                "class_weight": args.class_weight,
                "purge_gap": purge_gap,
                "horizon": args.horizon,
                "market": args.market,
            },
        }, f)

    # النتائج
    print(f"\n{'='*70}")
    print(f"RESULTS")
    print(f"{'='*70}")
    print(f"  Model ID:        {model_id}")
    print(f"  Market:          {args.market}")
    print(f"  Total samples:  {n_total}")
    print(f"  Cost threshold:  {args.cost_threshold}٪")
    print(f"  Class weight:    {args.class_weight}")
    print(f"  Source:          REAL PRICES (egksco + stock_daily_prices)")

    if fold_metrics:
        avg_acc = sum(m["accuracy"] for m in fold_metrics) / len(fold_metrics)
        avg_f1 = sum(m["f1"] for m in fold_metrics) / len(fold_metrics)
        avg_auc = sum(m["auc"] for m in fold_metrics) / len(fold_metrics)
        avg_baseline = sum(m["baseline_acc"] for m in fold_metrics) / len(fold_metrics)
        avg_delta = sum(m["delta_vs_baseline_pct"] for m in fold_metrics) / len(fold_metrics)

        print(f"\n  Walk-forward metrics (avg {len(fold_metrics)} folds):")
        print(f"    Baseline (majority class): {avg_baseline*100:.1f}٪")
        print(f"    Model accuracy:            {avg_acc*100:.1f}٪  (Δ={avg_delta:+.1f}pp vs baseline)")
        print(f"    F1:                        {avg_f1:.4f}")
        print(f"    AUC:                       {avg_auc:.4f}")

        # تقييم نهائي: هل النموذج يفوق الـ baseline؟
        if avg_delta < 2:
            print(f"\n  ⚠️  النموذج لا يفوق baseline بـ 2pp — ضعيف كـ filter.")
        elif avg_delta < 5:
            print(f"\n  🔶 النموذج يفوق baseline بـ {avg_delta:.1f}pp — acceptable كـ filter ضعيف.")
        else:
            print(f"\n  ✅ النموذج يفوق baseline بـ {avg_delta:.1f}pp — صالح كـ filter.")

    print(f"\n  Top 10 features:")
    for i, (name, imp) in enumerate(list(importance.items())[:10]):
        print(f"    {i+1}. {name}: {imp:.1f}")

    print(f"\n  Model saved: {model_path}")

    # حفظ metrics في JSON لواحدها (للمقارنة بين التجارب)
    metrics_path = registry_dir / f"{model_id}_metrics.json"
    with open(metrics_path, "w") as f:
        json.dump({
            "model_id": model_id,
            "fold_metrics": fold_metrics,
            "config": {
                "cost_threshold": args.cost_threshold,
                "class_weight": args.class_weight,
                "purge_gap": purge_gap,
                "horizon": args.horizon,
                "market": args.market,
            },
            "dataset_stats": {
                "total_samples": n_total,
                "positive_samples": n_pos,
                "negative_samples": n_neg,
                "positive_pct": pos_pct,
                "negative_pct": neg_pct,
                "neutral_excluded": neutral_removed,
            },
            "top_features": dict(list(importance.items())[:10]),
        }, f, indent=2)
    print(f"  Metrics JSON: {metrics_path}")

    print(f"\n✅ Training complete — trained from REAL price data (v2 — imbalance-fixed)")


if __name__ == "__main__":
    main()
