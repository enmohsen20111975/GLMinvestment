"""
evaluation/walk_forward.py — Walk-forward validation (v0.1.1 CORRECTED).

v0.1.1 fixes (Section 4 of correction directive):
  - Temporal sort of samples BEFORE splitting (enforced)
  - Purging: remove samples from train that overlap with test label horizon
  - Embargo: add gap between train and test to prevent label leakage
  - Per-fold metrics preserved (not just averages)
  - Final model trained on FULL dataset SEPARATELY (not inside validation loop)

NO look-ahead bias. NO shuffle. NO label leakage.
"""
from __future__ import annotations
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field
import numpy as np
from datetime import datetime

from ..models.base_model import BaseModel


@dataclass
class FoldResult:
    """Per-fold validation result (v0.1.1)."""
    fold_number: int
    train_start: str  # date range
    train_end: str
    test_start: str
    test_end: str
    train_size: int
    test_size: int
    purged_from_train: int  # samples removed by purging
    embargo_gap_days: int
    metrics: Dict = field(default_factory=dict)
    error: Optional[str] = None


class WalkForwardValidator:
    """
    Time-series walk-forward validation with Purging + Embargo.
    Prevents look-ahead bias AND label leakage.
    """

    def __init__(
        self,
        n_splits: int = 5,
        purge_horizon: int = 5,  # label horizon to purge
        embargo_days: int = 5,   # gap between train end and test start
    ):
        self.n_splits = n_splits
        self.purge_horizon = purge_horizon
        self.embargo_days = embargo_days

    def validate(
        self,
        model: BaseModel,
        X: List[List[float]],
        y: List[float],
        feature_names: List[str],
        sample_dates: Optional[List[str]] = None,
        sample_prediction_ids: Optional[List[int]] = None,
    ) -> Dict:
        """
        Run walk-forward validation with purging + embargo.

        Args:
            model: model to validate (will be re-trained per fold)
            X, y: feature matrix + labels
            feature_names: feature names
            sample_dates: prediction_date for each sample (REQUIRED for temporal sort)
            sample_prediction_ids: prediction IDs (for dedup tracking)

        Returns:
            dict with per_fold results + aggregated metrics
        """
        # v0.1.1: ENFORCE temporal sort before any splitting
        if sample_dates is None:
            return {
                "error": "sample_dates required for temporal sort (v0.1.1)",
                "folds_run": 0,
            }

        # Sort samples by date (ascending)
        sorted_indices = sorted(range(len(X)), key=lambda i: sample_dates[i])
        X_sorted = [X[i] for i in sorted_indices]
        y_sorted = [y[i] for i in sorted_indices]
        dates_sorted = [sample_dates[i] for i in sorted_indices]

        # Check for duplicates
        if sample_prediction_ids:
            ids_sorted = [sample_prediction_ids[i] for i in sorted_indices]
            unique_ids = set(ids_sorted)
            if len(unique_ids) != len(ids_sorted):
                return {
                    "error": f"Duplicate prediction_ids detected: {len(ids_sorted) - len(unique_ids)} duplicates",
                    "folds_run": 0,
                }

        n = len(X_sorted)
        if n < 20:
            return {"error": f"Insufficient samples: {n} < 20", "folds_run": 0}

        # v0.1.1: Use TimeSeriesSplit (preserves temporal order, NO shuffle)
        from sklearn.model_selection import TimeSeriesSplit
        tscv = TimeSeriesSplit(n_splits=self.n_splits)

        fold_results: List[FoldResult] = []

        for fold_num, (train_idx, test_idx) in enumerate(tscv.split(X_sorted), 1):
            # Get train/test date ranges
            train_dates = [dates_sorted[i] for i in train_idx]
            test_dates = [dates_sorted[i] for i in test_idx]

            train_start = train_dates[0] if train_dates else ""
            train_end = train_dates[-1] if train_dates else ""
            test_start = test_dates[0] if test_dates else ""
            test_end = test_dates[-1] if test_dates else ""

            # v0.1.1: PURGING — remove train samples whose label horizon
            # overlaps with the test period start
            purged_count = 0
            if self.purge_horizon > 0 and train_idx:
                # Parse test_start as datetime
                try:
                    test_start_dt = datetime.strptime(test_start[:10], "%Y-%m-%d")
                    purge_cutoff = test_start_dt - timedelta_days(self.purge_horizon)

                    kept_train = []
                    for i in train_idx:
                        sample_date = dates_sorted[i][:10]
                        try:
                            sample_dt = datetime.strptime(sample_date, "%Y-%m-%d")
                            # Keep sample only if its label horizon ends before purge_cutoff
                            label_end = sample_dt + timedelta_days(self.purge_horizon)
                            if label_end <= purge_cutoff:
                                kept_train.append(i)
                            else:
                                purged_count += 1
                        except ValueError:
                            kept_train.append(i)  # keep if date parsing fails
                    train_idx_purged = kept_train
                except (ValueError, TypeError):
                    train_idx_purged = list(train_idx)
            else:
                train_idx_purged = list(train_idx)

            # v0.1.1: EMBARGO — skip test samples within embargo_days of train end
            embargo_removed = 0
            if self.embargo_days > 0 and train_idx_purged:
                train_end_dt = datetime.strptime(train_end[:10], "%Y-%m-%d")
                embargo_cutoff = train_end_dt + timedelta_days(self.embargo_days)

                kept_test = []
                for i in test_idx:
                    sample_date = dates_sorted[i][:10]
                    try:
                        sample_dt = datetime.strptime(sample_date, "%Y-%m-%d")
                        if sample_dt >= embargo_cutoff:
                            kept_test.append(i)
                        else:
                            embargo_removed += 1
                    except ValueError:
                        kept_test.append(i)
                test_idx_embargoed = kept_test
            else:
                test_idx_embargoed = list(test_idx)

            if len(train_idx_purged) < 10 or len(test_idx_embargoed) < 5:
                fold_results.append(FoldResult(
                    fold_number=fold_num,
                    train_start=train_start, train_end=train_end,
                    test_start=test_start, test_end=test_end,
                    train_size=len(train_idx_purged),
                    test_size=len(test_idx_embargoed),
                    purged_from_train=purged_count,
                    embargo_gap_days=self.embargo_days,
                    error="Insufficient samples after purging/embargo",
                ))
                continue

            X_train = [X_sorted[i] for i in train_idx_purged]
            y_train = [y_sorted[i] for i in train_idx_purged]
            X_test = [X_sorted[i] for i in test_idx_embargoed]
            y_test = [y_sorted[i] for i in test_idx_embargoed]

            # Check class balance in train
            if len(set(y_train)) < 2:
                fold_results.append(FoldResult(
                    fold_number=fold_num,
                    train_start=train_start, train_end=train_end,
                    test_start=test_start, test_end=test_end,
                    train_size=len(X_train), test_size=len(X_test),
                    purged_from_train=purged_count,
                    embargo_gap_days=self.embargo_days,
                    error="Only one class in training set",
                ))
                continue

            # Train model on this fold's training data
            try:
                model.train(X_train, y_train, feature_names)
                y_pred = model.predict(X_test)
                metrics = self._compute_metrics(y_test, y_pred)

                fold_results.append(FoldResult(
                    fold_number=fold_num,
                    train_start=train_start, train_end=train_end,
                    test_start=test_start, test_end=test_end,
                    train_size=len(X_train), test_size=len(X_test),
                    purged_from_train=purged_count,
                    embargo_gap_days=self.embargo_days,
                    metrics=metrics,
                ))
            except Exception as e:
                fold_results.append(FoldResult(
                    fold_number=fold_num,
                    train_start=train_start, train_end=train_end,
                    test_start=test_start, test_end=test_end,
                    train_size=len(X_train), test_size=len(X_test),
                    purged_from_train=purged_count,
                    embargo_gap_days=self.embargo_days,
                    error=str(e),
                ))

        # Aggregate (only valid folds)
        valid_folds = [f for f in fold_results if f.error is None]

        if not valid_folds:
            return {
                "error": "All folds failed",
                "folds_run": 0,
                "fold_details": [self._fold_to_dict(f) for f in fold_results],
            }

        agg = {
            "folds_run": len(valid_folds),
            "folds_total": len(fold_results),
            "folds_failed": len(fold_results) - len(valid_folds),
            "avg_accuracy": float(np.mean([f.metrics.get("accuracy", 0) for f in valid_folds])),
            "avg_precision": float(np.mean([f.metrics.get("precision", 0) for f in valid_folds])),
            "avg_recall": float(np.mean([f.metrics.get("recall", 0) for f in valid_folds])),
            "avg_f1": float(np.mean([f.metrics.get("f1", 0) for f in valid_folds])),
            "avg_auc": float(np.mean([f.metrics.get("auc", 0.5) for f in valid_folds])),
            "avg_brier": float(np.mean([f.metrics.get("brier", 0) for f in valid_folds])),
            "std_accuracy": float(np.std([f.metrics.get("accuracy", 0) for f in valid_folds])),
            "std_f1": float(np.std([f.metrics.get("f1", 0) for f in valid_folds])),
            "purge_horizon_days": self.purge_horizon,
            "embargo_days": self.embargo_days,
            "total_purged_samples": sum(f.purged_from_train for f in fold_results),
            "fold_details": [self._fold_to_dict(f) for f in fold_results],
        }

        # v0.1.1: DO NOT retrain on full dataset here.
        # Final model training is SEPARATE (in Trainer, after evaluation).
        # This prevents the validation from contaminating the final model.

        return agg

    def _compute_metrics(self, y_true: List[float], y_pred: List[float]) -> Dict:
        """Compute classification metrics."""
        from sklearn.metrics import (
            accuracy_score, precision_score, recall_score,
            f1_score, roc_auc_score, brier_score_loss
        )

        y_true_arr = np.array(y_true)
        y_pred_arr = np.array(y_pred)
        y_pred_binary = (y_pred_arr >= 0.5).astype(int)

        metrics = {
            "accuracy": float(accuracy_score(y_true_arr, y_pred_binary)),
            "precision": float(precision_score(y_true_arr, y_pred_binary, zero_division=0)),
            "recall": float(recall_score(y_true_arr, y_pred_binary, zero_division=0)),
            "f1": float(f1_score(y_true_arr, y_pred_binary, zero_division=0)),
            "brier": float(brier_score_loss(y_true_arr, y_pred_arr)) if len(set(y_true)) > 1 else 0.0,
        }

        try:
            metrics["auc"] = float(roc_auc_score(y_true_arr, y_pred_arr)) if len(set(y_true)) > 1 else 0.5
        except Exception:
            metrics["auc"] = 0.5

        return metrics

    def _fold_to_dict(self, fold: FoldResult) -> Dict:
        return {
            "fold": fold.fold_number,
            "train_period": [fold.train_start, fold.train_end],
            "test_period": [fold.test_start, fold.test_end],
            "train_size": fold.train_size,
            "test_size": fold.test_size,
            "purged_from_train": fold.purged_from_train,
            "embargo_gap_days": fold.embargo_gap_days,
            "metrics": fold.metrics,
            "error": fold.error,
        }


def timedelta_days(days: int):
    """Helper: create timedelta without importing at module level."""
    from datetime import timedelta
    return timedelta(days=days)
