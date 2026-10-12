"""
lgbm_gatekeeper.py — LightGBM AI Signal Gatekeeper
==================================================
BRAVO-CO-DEPLOYMENT (B2): A centralised gatekeeper that loads the trained
LightGBM model (`models/lgbm_signal_gatekeeper.joblib`) and decides whether
a candidate signal should be emitted / written to DB / pushed to Telegram.

Decision rule
-------------
- If `predict_proba(features)[1] < 0.65` → REJECTED_BY_AI_GATEKEEPER
  (65% threshold: 78.95% historical win-rate per `models/lgbm_metrics.json`).
- Else → APPROVED (return the probability so callers can attach it to the
  prediction row for transparency).
- Any error (model missing, joblib not installed, feature mismatch) →
  SILENT FALLBACK with warning log. We never break the prediction pipeline
  because of an ML model issue (per owner directive + Rule 24: NO fake data,
  but also NO silent block of legitimate signals just because an optional
  model is unavailable).

Feature contract
----------------
The model expects these 12 features (in this exact order):
    1.  percentile_rank        — liquidity percentile 0..100
    2.  avg_turnover_20d_log    — log10 of 20-day avg turnover
    3.  rvol_20d                — today's volume / avg_20d volume
    4.  rsi_14                  — RSI(14) 0..100
    5.  mfi_14                  — Money Flow Index(14) 0..100
    6.  price_to_sma20         — close / SMA(20)
    7.  price_to_sma50         — close / SMA(50)
    8.  atr_14_pct              — ATR(14) / close
    9.  bollinger_bandwidth     — (upper-lower) / middle
    10. high_low_spread_pct     — (high-low) / close
    11. dist_from_20d_high      — (close - max_high_20d) / max_high_20d
    12. signal_type_code        — encoded signal type (int)

Callers can either:
  (a) Provide the full feature dict via `evaluate_signal(features=...)`, OR
  (b) Provide the candle list + auxiliary inputs and let us compute the
      features via `compute_features_from_candles()`.

Public API
----------
    from utils.lgbm_gatekeeper import (
        evaluate_signal,
        compute_features_from_candles,
        is_available,
        REASON_APPROVED,
        REASON_REJECTED,
        REASON_MODEL_UNAVAILABLE,
    )

    verdict = evaluate_signal(
        candles=candles,
        signal_type="B_explosive_surge",
        avg_turnover_20d=2_500_000,
        percentile_rank=72.0,
    )
    if verdict["approved"]:
        emit_signal(...)
    else:
        log_skip(...)
"""

from __future__ import annotations

import math
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
# Threshold chosen from `models/lgbm_metrics.json`:
#   - threshold=0.65 → accepted=57 / wins=45 → win_rate=78.95%
#   - threshold=0.60 → accepted=75 / wins=58 → win_rate=77.33%
# 0.65 yields the best precision/recall trade-off (highest win rate at
# 90 signals-per-month cadence). Owner directive (BRAVO-CO-DEPLOYMENT B2).
DEFAULT_WIN_PROBABILITY_THRESHOLD = 0.65

REASON_APPROVED = "APPROVED_BY_AI_GATEKEEPER"
REASON_REJECTED = "REJECTED_BY_AI_GATEKEEPER"
REASON_MODEL_UNAVAILABLE = "AI_GATEKEEPER_UNAVAILABLE_FALLBACK_THROUGH"
REASON_INSUFFICIENT_DATA = "AI_GATEKEEPER_INSUFFICIENT_DATA"

# Map signal_type strings to integer codes for `signal_type_code` feature.
# These codes mirror the training-time encoding (see analyzers/train_ml_model.py).
# Codes are ordered from "most bullish evidence" → "least bullish":
#   - PRE_SURGE / EXPLOSIVE_SURGE are the strongest evidence (highest code)
#   - ACCUMULATION is a slower build-up (mid code)
#   - HOLD/WAIT means no actionable signal (code=0)
_SIGNAL_TYPE_CODES: Dict[str, int] = {
    "WAIT": 0,
    "HOLD": 0,
    "SELL": 0,
    "STRONG_SELL": 0,
    "REDUCE": 0,
    # BUY-like signals
    "BUY": 3,
    "STRONG_BUY": 4,
    "INSTITUTIONAL_BUY": 5,
    "ACCUMULATE": 2,
    # Radar paths (maker_radar.py)
    "A_quiet_accumulation": 2,
    "B_explosive_surge": 5,
    "C_early_break": 4,
    "rvol_surge_breakout": 5,
    # Aliases used in some prediction paths
    "quiet_accumulation": 2,
    "explosive_surge": 5,
    "early_break": 4,
    "pre_surge": 5,
    "soft_surge": 3,
    "recovery_hunter": 3,
    "surge_hunter": 4,
}


def _signal_type_to_code(signal_type: str) -> int:
    """Map a signal_type string to the integer code used by the LGBM model.

    Unknown signals default to 3 (BUY) — neutral assumption so the gatekeeper
    doesn't accidentally REJECT legitimate unknown signals. The caller is
    expected to pass a recognizable signal_type so the model can do its job.
    """
    if not signal_type:
        return 3
    key = str(signal_type).strip().upper()
    if key in _SIGNAL_TYPE_CODES:
        return _SIGNAL_TYPE_CODES[key]
    # Try original case (radar paths use mixed case like 'A_quiet_accumulation')
    if signal_type in _SIGNAL_TYPE_CODES:
        return _SIGNAL_TYPE_CODES[signal_type]
    # Defensive default for unknown signal types — neutral BUY code 3
    return 3


# ─────────────────────────────────────────────────────────────────────────────
# Model loading (lazy + thread-safe singleton)
# ─────────────────────────────────────────────────────────────────────────────
# Lazy load so the model is only loaded the first time it's actually needed.
# This keeps startup time fast (especially for CLI backfills that don't need
# the gatekeeper) and avoids crashes when `joblib`/`lightgbm` are not installed.
_MODEL_PATH_CANDIDATES = (
    # repo-root / models (production layout)
    Path(__file__).resolve().parents[2] / "models" / "lgbm_signal_gatekeeper.joblib",
    # vps-service-local copy (sandbox layout)
    Path(__file__).resolve().parents[1] / "ml_models" / "lgbm_signal_gatekeeper.joblib",
)

_MODEL_LOCK = threading.Lock()
_MODEL: Any = None  # cached LGBMClassifier (or None if unavailable)
_MODEL_LOAD_TRIED = False  # so we don't keep retrying on every call
_MODEL_FEATURES: Optional[List[str]] = None
_MODEL_LOAD_ERROR: Optional[str] = None


def _find_model_path() -> Optional[Path]:
    """Return the first existing model path, or None."""
    for p in _MODEL_PATH_CANDIDATES:
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def _load_model() -> Tuple[Any, Optional[List[str]], Optional[str]]:
    """Load the LGBM model once. Returns (model, feature_names, error_msg).

    On any failure (joblib missing, model file missing, sklearn version
    mismatch, etc.) returns (None, None, error_msg). Subsequent calls reuse
    the cached result so we don't spam logs.
    """
    global _MODEL, _MODEL_FEATURES, _MODEL_LOAD_TRIED, _MODEL_LOAD_ERROR

    if _MODEL_LOAD_TRIED:
        return _MODEL, _MODEL_FEATURES, _MODEL_LOAD_ERROR

    with _MODEL_LOCK:
        if _MODEL_LOAD_TRIED:  # double-checked locking
            return _MODEL, _MODEL_FEATURES, _MODEL_LOAD_ERROR
        _MODEL_LOAD_TRIED = True

        model_path = _find_model_path()
        if model_path is None:
            _MODEL_LOAD_ERROR = (
                f"model file not found in any of {[str(p) for p in _MODEL_PATH_CANDIDATES]}"
            )
            print(f"[lgbm_gatekeeper] ⚠️ {_MODEL_LOAD_ERROR} — fallback passthrough")
            return None, None, _MODEL_LOAD_ERROR

        try:
            import joblib  # noqa: F401  (import-checked)
            model = joblib.load(str(model_path))
        except ImportError as e:
            _MODEL_LOAD_ERROR = (
                f"joblib not installed — install with `pip install joblib scikit-learn`. "
                f"Error: {e}"
            )
            print(f"[lgbm_gatekeeper] ⚠️ {_MODEL_LOAD_ERROR} — fallback passthrough")
            return None, None, _MODEL_LOAD_ERROR
        except Exception as e:
            _MODEL_LOAD_ERROR = f"joblib.load failed: {e}"
            print(f"[lgbm_gatekeeper] ⚠️ {_MODEL_LOAD_ERROR} — fallback passthrough")
            return None, None, _MODEL_LOAD_ERROR

        # Extract feature names — sklearn LGBMClassifier exposes them via
        # `feature_name_` (lightgbm 3.x) or `feature_names_in_` (sklearn 1.x).
        feats = getattr(model, "feature_name_", None) or getattr(
            model, "feature_names_in_", None
        )
        if feats is None and hasattr(model, "booster_"):
            try:
                feats = model.booster_.feature_name()
            except Exception:
                feats = None
        _MODEL = model
        _MODEL_FEATURES = list(feats) if feats else None
        if _MODEL_FEATURES:
            print(
                f"[lgbm_gatekeeper] ✅ model loaded ({model_path.name}) "
                f"— {len(_MODEL_FEATURES)} features"
            )
        else:
            print(
                f"[lgbm_gatekeeper] ⚠️ model loaded but feature_name_ unavailable "
                f"(sklearn/lightgbm version mismatch?) — predictions will use "
                f"positional order"
            )
        return _MODEL, _MODEL_FEATURES, _MODEL_LOAD_ERROR


def is_available() -> bool:
    """True iff the LGBM model was loaded successfully (or could be)."""
    model, _, _ = _load_model()
    return model is not None


def get_model_info() -> Dict[str, Any]:
    """Return diagnostic info about the gatekeeper state (for /healthz etc.)."""
    model, feats, err = _load_model()
    return {
        "available": model is not None,
        "model_path": str(_find_model_path()) if _find_model_path() else None,
        "feature_names": feats,
        "n_features": len(feats) if feats else 0,
        "threshold": DEFAULT_WIN_PROBABILITY_THRESHOLD,
        "error": err,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Feature computation (from candle list)
# ─────────────────────────────────────────────────────────────────────────────
def _sma(values: List[float], period: int) -> Optional[float]:
    if not values or len(values) < period or period <= 0:
        return None
    return sum(values[-period:]) / period


def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    """Wilder's RSI(14)."""
    if len(closes) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(-period, 0):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gains += diff
        else:
            losses += -diff
    avg_gain = gains / period
    avg_loss = losses / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _mfi(closes: List[float], volumes: List[int], period: int = 14) -> Optional[float]:
    """Money Flow Index (MFI)."""
    if len(closes) < period + 1 or len(volumes) < period + 1:
        return None
    pos_flow = 0.0
    neg_flow = 0.0
    for i in range(-period, 0):
        if i == 0 and len(closes) > period + 1:
            # Skip — need prev close
            continue
        idx = i
        prev_idx = i - 1
        if prev_idx < -len(closes):
            continue
        typical_price = closes[idx]
        prev_typical = closes[prev_idx]
        flow = typical_price * (volumes[idx] if volumes[idx] > 0 else 0)
        if typical_price > prev_typical:
            pos_flow += flow
        elif typical_price < prev_typical:
            neg_flow += flow
    if neg_flow == 0:
        return 100.0
    if pos_flow == 0:
        return 0.0
    mfr = pos_flow / neg_flow
    return 100.0 - (100.0 / (1.0 + mfr))


def _atr(
    highs: List[float], lows: List[float], closes: List[float], period: int = 14
) -> Optional[float]:
    if len(closes) < period + 1 or len(highs) < period + 1 or len(lows) < period + 1:
        return None
    trs = []
    for i in range(1, min(len(highs), len(lows), len(closes))):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if not trs:
        return None
    return sum(trs[-period:]) / min(len(trs), period)


def _bollinger_bandwidth(closes: List[float], period: int = 20) -> Optional[float]:
    """Bollinger bandwidth = (upper - lower) / middle SMA."""
    if len(closes) < period:
        return None
    sma = sum(closes[-period:]) / period
    if sma <= 0:
        return None
    variance = sum((c - sma) ** 2 for c in closes[-period:]) / period
    std = math.sqrt(variance)
    upper = sma + 2 * std
    lower = sma - 2 * std
    return (upper - lower) / sma


def compute_features_from_candles(
    candles: List[Dict[str, Any]],
    signal_type: str,
    avg_turnover_20d: Optional[float] = None,
    percentile_rank: Optional[float] = None,
) -> Optional[Dict[str, float]]:
    """Compute the 12 LGBM features from a candle list.

    Args:
        candles: list of {date, open, high, low, close, volume} dicts (oldest first).
        signal_type: e.g. 'B_explosive_surge', 'BUY', 'A_quiet_accumulation'.
        avg_turnover_20d: optional pre-computed avg turnover (saves recomputing).
        percentile_rank: optional liquidity percentile 0..100 (radar pre-computes).

    Returns:
        Dict of {feature_name: value} or None if insufficient data (e.g. <20
        candles means we can't compute SMA20 / Bollinger / RVol properly).
    """
    if not candles or len(candles) < 20:
        return None

    closes = [float(c.get("close") or 0) for c in candles if c.get("close")]
    highs = [float(c.get("high") or 0) for c in candles if c.get("high")]
    lows = [float(c.get("low") or 0) for c in candles if c.get("low")]
    volumes = [int(c.get("volume") or 0) for c in candles if c.get("volume") is not None]
    if not closes or len(closes) < 20:
        return None

    cp = closes[-1]
    if cp <= 0:
        return None

    # ── Liquidity features ──
    if avg_turnover_20d is None or avg_turnover_20d <= 0:
        # Compute from candle volumes × closes
        recent_n = min(20, len(closes))
        turnovers = [
            volumes[i] * closes[i] for i in range(-recent_n, 0) if volumes[i] > 0
        ]
        avg_turnover_20d = sum(turnovers) / len(turnovers) if turnovers else 0.0

    avg_turnover_20d_log = (
        math.log10(max(avg_turnover_20d, 1.0)) if avg_turnover_20d > 0 else 0.0
    )

    if percentile_rank is None:
        # Conservative default: 50 (median) — caller should pass the real value
        percentile_rank = 50.0

    # ── Volume surge (RVol) ──
    avg_vol_20d = sum(volumes[-20:]) / min(len(volumes), 20) if volumes else 0
    rvol_20d = (volumes[-1] / avg_vol_20d) if avg_vol_20d > 0 else 0.0

    # ── RSI(14) ──
    rsi_14 = _rsi(closes, 14)
    if rsi_14 is None:
        return None

    # ── MFI(14) ──
    mfi_14 = _mfi(closes, volumes, 14)
    if mfi_14 is None:
        mfi_14 = 50.0  # neutral fallback

    # ── SMA(20) and SMA(50) ──
    sma_20 = _sma(closes, 20)
    sma_50 = _sma(closes, 50) or sma_20 or cp
    if sma_20 is None or sma_20 <= 0:
        return None
    price_to_sma20 = cp / sma_20
    price_to_sma50 = cp / sma_50 if sma_50 > 0 else 1.0

    # ── ATR(14) % ──
    atr_14 = _atr(highs, lows, closes, 14) or (cp * 0.03)
    atr_14_pct = atr_14 / cp if cp > 0 else 0.0

    # ── Bollinger bandwidth ──
    bb_width = _bollinger_bandwidth(closes, 20) or 0.0

    # ── High-Low spread % ──
    last_high = highs[-1] if highs else cp
    last_low = lows[-1] if lows else cp
    high_low_spread_pct = (last_high - last_low) / cp if cp > 0 else 0.0

    # ── Distance from 20-day high ──
    max_high_20d = max(highs[-20:]) if len(highs) >= 20 else max(highs) if highs else cp
    dist_from_20d_high = (cp - max_high_20d) / max_high_20d if max_high_20d > 0 else 0.0

    # ── Signal type code ──
    signal_type_code = _signal_type_to_code(signal_type)

    return {
        "percentile_rank": float(percentile_rank),
        "avg_turnover_20d_log": float(avg_turnover_20d_log),
        "rvol_20d": float(rvol_20d),
        "rsi_14": float(rsi_14),
        "mfi_14": float(mfi_14),
        "price_to_sma20": float(price_to_sma20),
        "price_to_sma50": float(price_to_sma50),
        "atr_14_pct": float(atr_14_pct),
        "bollinger_bandwidth": float(bb_width),
        "high_low_spread_pct": float(high_low_spread_pct),
        "dist_from_20d_high": float(dist_from_20d_high),
        "signal_type_code": int(signal_type_code),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Verdict evaluation
# ─────────────────────────────────────────────────────────────────────────────
def evaluate_signal(
    candles: Optional[List[Dict[str, Any]]] = None,
    signal_type: str = "BUY",
    avg_turnover_20d: Optional[float] = None,
    percentile_rank: Optional[float] = None,
    features: Optional[Dict[str, float]] = None,
    threshold: float = DEFAULT_WIN_PROBABILITY_THRESHOLD,
) -> Dict[str, Any]:
    """Decide whether to approve a signal via the LGBM model.

    Args:
        candles: list of daily candles (oldest first). Optional if `features`
                 is provided directly.
        signal_type: e.g. 'B_explosive_surge', 'BUY', 'A_quiet_accumulation'.
        avg_turnover_20d: optional pre-computed turnover (improves accuracy).
        percentile_rank: optional liquidity percentile (radar pre-computes).
        features: optional pre-computed feature dict — bypasses candle parsing.
        threshold: win-probability threshold below which the signal is REJECTED.
                   Default 0.65 → 78.95% historical win rate.

    Returns:
        Dict with keys:
            - approved: bool
            - win_probability: float (0.0..1.0) or None if model unavailable
            - reason: str (REASON_APPROVED / REASON_REJECTED / ...)
            - threshold: float
            - features_used: dict (for transparency / debugging)
            - model_available: bool
            - error: Optional[str]
    """
    # ── 1) Load model (or fail-safe passthrough) ──
    model, model_feats, err = _load_model()
    if model is None:
        # Model unavailable — fail-open per owner directive (B2):
        # we MUST NOT silently block legitimate signals just because the ML
        # model is missing. Log the warning + approve with no probability.
        return {
            "approved": True,
            "win_probability": None,
            "reason": REASON_MODEL_UNAVAILABLE,
            "threshold": threshold,
            "features_used": {},
            "model_available": False,
            "error": err,
        }

    # ── 2) Build feature vector ──
    if features is None:
        if candles is None:
            return {
                "approved": True,  # fail-open
                "win_probability": None,
                "reason": REASON_INSUFFICIENT_DATA,
                "threshold": threshold,
                "features_used": {},
                "model_available": True,
                "error": "neither `features` nor `candles` provided",
            }
        features = compute_features_from_candles(
            candles=candles,
            signal_type=signal_type,
            avg_turnover_20d=avg_turnover_20d,
            percentile_rank=percentile_rank,
        )
        if features is None:
            return {
                "approved": True,  # fail-open — insufficient candle data
                "win_probability": None,
                "reason": REASON_INSUFFICIENT_DATA,
                "threshold": threshold,
                "features_used": {},
                "model_available": True,
                "error": "insufficient candle data (<20 rows) for feature extraction",
            }

    # ── 3) Build feature vector in the model's expected order ──
    if model_feats:
        # Use the model's feature_name_ ordering (most reliable)
        feat_vec = []
        missing = []
        for fname in model_feats:
            if fname in features:
                feat_vec.append(float(features[fname]))
            else:
                missing.append(fname)
                feat_vec.append(0.0)
        if missing:
            print(
                f"[lgbm_gatekeeper] ⚠️ missing features {missing} — filled with 0.0 "
                f"(predictions may be inaccurate)"
            )
    else:
        # Fall back to the canonical order (matches model.feature_name_)
        canonical_order = [
            "percentile_rank",
            "avg_turnover_20d_log",
            "rvol_20d",
            "rsi_14",
            "mfi_14",
            "price_to_sma20",
            "price_to_sma50",
            "atr_14_pct",
            "bollinger_bandwidth",
            "high_low_spread_pct",
            "dist_from_20d_high",
            "signal_type_code",
        ]
        feat_vec = [float(features.get(k, 0.0)) for k in canonical_order]

    # ── 4) Run prediction ──
    try:
        # LightGBM sklearn wrapper accepts both numpy arrays and DataFrames.
        # We use a 2D numpy array for minimum dependency surface.
        import numpy as np

        X = np.array([feat_vec], dtype=float)
        proba = model.predict_proba(X)[0]
        # classes_ = [0, 1] → index 1 is "win" probability
        win_prob = float(proba[1]) if len(proba) > 1 else float(proba[0])
    except Exception as e:
        # Prediction failed (e.g. NaN features, version mismatch) → fail-open
        return {
            "approved": True,
            "win_probability": None,
            "reason": REASON_MODEL_UNAVAILABLE,
            "threshold": threshold,
            "features_used": features,
            "model_available": True,
            "error": f"predict_proba failed: {e}",
        }

    # ── 5) Apply threshold ──
    approved = win_prob >= threshold
    reason = REASON_APPROVED if approved else REASON_REJECTED
    return {
        "approved": approved,
        "win_probability": round(win_prob, 4),
        "reason": reason,
        "threshold": threshold,
        "features_used": features,
        "model_available": True,
        "error": None,
    }


__all__ = [
    "evaluate_signal",
    "compute_features_from_candles",
    "is_available",
    "get_model_info",
    "DEFAULT_WIN_PROBABILITY_THRESHOLD",
    "REASON_APPROVED",
    "REASON_REJECTED",
    "REASON_MODEL_UNAVAILABLE",
    "REASON_INSUFFICIENT_DATA",
]


if __name__ == "__main__":
    # Smoke test: python3 -m utils.lgbm_gatekeeper
    info = get_model_info()
    print("Model info:")
    for k, v in info.items():
        print(f"  {k}: {v}")
    print()
    # Synthetic test with 30 candles
    import random
    random.seed(42)
    candles = []
    base = 100.0
    for i in range(30):
        base *= 1 + random.uniform(-0.02, 0.025)
        candles.append({
            "date": f"2026-09-{i+1:02d}",
            "open": base * 0.99,
            "high": base * 1.01,
            "low": base * 0.985,
            "close": base,
            "volume": random.randint(100_000, 500_000),
        })
    verdict = evaluate_signal(
        candles=candles,
        signal_type="B_explosive_surge",
        avg_turnover_20d=2_500_000,
        percentile_rank=72.0,
    )
    print("Verdict:")
    for k, v in verdict.items():
        print(f"  {k}: {v}")
