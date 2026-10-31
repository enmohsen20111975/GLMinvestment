"""
cli/train_model.py — CLI to train a model (runs on LAPTOP).

Usage:
  python -m learning_engine.cli.train_model --label-type direction --horizon 5 --market EGX

Trains LightGBM model with walk-forward validation.
Registers model in registry (status=shadow).
Does NOT touch production. Does NOT promote to active.
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_PROJECT_ROOT))

from learning_engine.training.trainer import Trainer
from learning_engine.config.settings import LearningSettings


def main():
    parser = argparse.ArgumentParser(description="Train a Learning Engine model (LAPTOP)")
    parser.add_argument(
        "--label-type", required=True,
        choices=["direction", "forward_return", "volatility", "trade_quality", "regime"],
    )
    parser.add_argument("--horizon", type=int, default=5)
    parser.add_argument("--market", default=None)
    parser.add_argument("--min-samples", type=int, default=10, help="Minimum samples required (default: 10)")

    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"Learning Engine — Training (LAPTOP)")
    print(f"{'='*60}")

    settings = LearningSettings()
    missing = settings.validate_paths()
    if missing:
        print(f"\n❌ Missing production DBs:")
        for m in missing:
            print(f"   - {m}")
        sys.exit(1)

    trainer = Trainer(settings=settings)

    if args.label_type == "direction":
        result = trainer.train_direction_model(
            horizon=args.horizon,
            market=args.market,
            min_samples=args.min_samples,
        )
    else:
        print(f"❌ Label type '{args.label_type}' not yet implemented in trainer")
        print(f"   Only 'direction' is available in v0.1.0")
        sys.exit(1)

    if not result.success:
        print(f"\n❌ Training failed: {result.error}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"Training Result")
    print(f"{'='*60}")
    print(f"Model ID: {result.model_id}")
    print(f"Label: {result.label_type} (horizon={result.horizon}d)")
    print(f"Samples: {result.sample_count}")
    print(f"Status: shadow (not active)")
    print(f"\nMetrics:")
    for k, v in result.metrics.items():
        if k != "fold_details" and isinstance(v, (int, float)):
            print(f"  {k}: {v:.4f}")

    print(f"\n✅ Model registered as SHADOW. To promote: use cli/evaluate_model.py")
    print(f"   To disable learning engine: simply don't run shadow_runner. V3 is unaffected.")


if __name__ == "__main__":
    main()
