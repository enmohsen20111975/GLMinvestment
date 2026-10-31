"""
cli/prepare_dataset.py — CLI to build a training dataset.

Usage:
  python -m learning_engine.cli.prepare_dataset --label-type direction --horizon 5 --market EGX

Outputs dataset summary (sample count, feature count, date range).
Does NOT train — just inspects data readiness.
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

# Make project root importable
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_PROJECT_ROOT))

from learning_engine.datasets.dataset_builder import DatasetBuilder
from learning_engine.labels.label_builder import LabelType
from learning_engine.config.settings import LearningSettings


def main():
    parser = argparse.ArgumentParser(description="Build a training dataset for Learning Engine")
    parser.add_argument(
        "--label-type", required=True,
        choices=["direction", "forward_return", "volatility", "trade_quality", "regime"],
        help="Type of label to build"
    )
    parser.add_argument("--horizon", type=int, default=5, help="Label horizon in days")
    parser.add_argument("--market", default=None, help="Filter by market (EGX, TADAWUL, etc.)")
    parser.add_argument("--min-samples", type=int, default=50, help="Minimum samples required")
    parser.add_argument("--output", default=None, help="Output JSON file for dataset summary")

    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"Learning Engine — Dataset Preparation")
    print(f"{'='*60}")
    print(f"Label type: {args.label_type}")
    print(f"Horizon: {args.horizon} days")
    print(f"Market: {args.market or 'all'}")
    print(f"Min samples: {args.min_samples}")

    # Check settings
    settings = LearningSettings()
    missing = settings.validate_paths()
    if missing:
        print(f"\n⚠️  Warning: missing production DBs:")
        for m in missing:
            print(f"   - {m}")
        print("   (Dataset may be empty without production data)")

    # Build dataset
    print(f"\nBuilding dataset...")
    builder = DatasetBuilder(settings=settings)
    label_type = LabelType(args.label_type)
    dataset = builder.build_dataset(
        label_type=label_type,
        horizon=args.horizon,
        market=args.market,
        min_samples=args.min_samples,
    )

    # Print summary
    print(f"\n{'='*60}")
    print(f"Dataset Summary")
    print(f"{'='*60}")
    print(f"Label type: {dataset.label_type.value}")
    print(f"Horizon: {dataset.horizon} days")
    print(f"Samples: {dataset.size}")
    print(f"Features: {len(dataset.feature_names)}")

    if dataset.metadata:
        print(f"\nMetadata:")
        print(f"  Total predictions: {dataset.metadata.get('total_predictions', 0)}")
        print(f"  Samples built: {dataset.metadata.get('samples_built', 0)}")
        print(f"  Skipped: {dataset.metadata.get('skipped', {})}")
        print(f"  Markets: {dataset.metadata.get('markets_included', [])}")
        print(f"  Date range: {dataset.metadata.get('date_range')}")

    if dataset.metadata.get("error"):
        print(f"\n❌ Error: {dataset.metadata['error']}")
        sys.exit(1)

    if dataset.size < args.min_samples:
        print(f"\n⚠️  Insufficient samples ({dataset.size} < {args.min_samples})")
        print(f"   Consider: lowering --min-samples, or checking data quality")
        sys.exit(1)

    # Label distribution
    if dataset.samples:
        label_values = [s.label_value for s in dataset.samples]
        if args.label_type in ("direction", "trade_quality"):
            pos = sum(1 for v in label_values if v >= 0.5)
            neg = len(label_values) - pos
            print(f"\nLabel distribution:")
            print(f"  Positive (1): {pos} ({pos/len(label_values)*100:.1f}%)")
            print(f"  Negative (0): {neg} ({neg/len(label_values)*100:.1f}%)")
        else:
            print(f"\nLabel stats:")
            print(f"  Min: {min(label_values):.4f}")
            print(f"  Max: {max(label_values):.4f}")
            print(f"  Mean: {sum(label_values)/len(label_values):.4f}")

    # Save summary
    if args.output:
        import json
        summary = {
            "label_type": dataset.label_type.value,
            "horizon": dataset.horizon,
            "sample_count": dataset.size,
            "feature_count": len(dataset.feature_names),
            "feature_names": dataset.feature_names,
            "metadata": {k: str(v) for k, v in dataset.metadata.items()},
        }
        Path(args.output).write_text(json.dumps(summary, indent=2, default=str))
        print(f"\n✅ Summary saved to {args.output}")

    print(f"\n✅ Dataset ready for training")


if __name__ == "__main__":
    main()
