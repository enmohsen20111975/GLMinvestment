from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from joblib import dump
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

logger = logging.getLogger(__name__)

DEFAULT_MODEL_VERSION = "v1.0"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MIN_TRAINING_SAMPLES = 20


class PredictionCreate(BaseModel):
    prediction_id: str = Field(default_factory=lambda: str(uuid4()))
    stock_symbol: str
    predicted_price: float
    prediction_date: str
    target_date: str
    features_snapshot: dict[str, Any]
    model_version: str = DEFAULT_MODEL_VERSION
    confidence: float | None = None
    sector: str | None = None
    source: str = "nodejs"


class PredictionStatusResponse(BaseModel):
    prediction_id: str
    status: str
    stock_symbol: str
    predicted_price: float
    prediction_date: str
    target_date: str
    created_at: str
    model_version: str
    confidence: float | None = None
    sector: str | None = None
    features_snapshot: dict[str, Any]
    validation_date: str | None = None
    actual_price: float | None = None
    error_percent: float | None = None
    direction_correct: bool | None = None
    validated_at: str | None = None
    validation_horizon: str | None = None


class ModelStatusResponse(BaseModel):
    current_version: str
    deployed_at: str
    status: str
    last_validation_at: str | None = None
    metrics: dict[str, float] = Field(default_factory=dict)


class CorrectionFactorResponse(BaseModel):
    ticker: str
    sector: str | None
    base_confidence: float | None
    sector_adjustment: float
    market_volatility_factor: float
    corrected_confidence: float
    recommended_bias: str


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _validate_iso_date(date_string: str) -> str:
    try:
        datetime.fromisoformat(date_string)
        return date_string
    except ValueError as exc:
        raise ValueError(f"Invalid ISO date format: {date_string}") from exc


def _create_prediction_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS predictions (
            prediction_id TEXT PRIMARY KEY,
            stock_symbol TEXT NOT NULL,
            predicted_price REAL NOT NULL,
            confidence REAL,
            prediction_date TEXT NOT NULL,
            target_date TEXT NOT NULL,
            features_snapshot TEXT NOT NULL,
            model_version TEXT NOT NULL,
            sector TEXT,
            source TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT NOT NULL,
            validation_date TEXT NOT NULL,
            actual_price REAL,
            error_percent REAL,
            direction_correct INTEGER,
            validated_at TEXT,
            validation_horizon TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prediction_validations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prediction_id TEXT NOT NULL,
            actual_price REAL,
            error_percent REAL,
            direction_correct INTEGER,
            validated_at TEXT,
            remark TEXT,
            FOREIGN KEY(prediction_id) REFERENCES predictions(prediction_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS model_versions (
            version TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            deployed_at TEXT NOT NULL,
            status TEXT NOT NULL,
            description TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS model_performance_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_version TEXT NOT NULL,
            evaluated_at TEXT NOT NULL,
            metric_name TEXT NOT NULL,
            metric_value REAL NOT NULL,
            details TEXT,
            FOREIGN KEY(model_version) REFERENCES model_versions(version)
        )
        """
    )


def ensure_prediction_schema(db_path: Path | None) -> None:
    if db_path is None:
        logger.warning("Prediction schema initialization skipped because local DB path is missing.")
        return

    with sqlite3.connect(str(db_path)) as conn:
        _create_prediction_tables(conn)
        baseline = conn.execute(
            "SELECT COUNT(*) AS count FROM model_versions WHERE status = 'deployed'"
        ).fetchone()
        if baseline is None or baseline[0] == 0:
            conn.execute(
                "INSERT OR IGNORE INTO model_versions (version, created_at, deployed_at, status, description) VALUES (?, ?, ?, ?, ?)",
                (
                    DEFAULT_MODEL_VERSION,
                    _utc_now_iso(),
                    _utc_now_iso(),
                    "deployed",
                    "Baseline initial model",
                ),
            )
        conn.commit()


def _validation_date_for_target(target_date: str) -> str:
    _validate_iso_date(target_date)
    return target_date


def save_prediction(conn: sqlite3.Connection, payload: PredictionCreate) -> dict[str, Any]:
    prediction_dict = payload.dict()
    validation_date = _validation_date_for_target(prediction_dict["target_date"])
    conn.execute(
        """
        INSERT OR REPLACE INTO predictions (
            prediction_id, stock_symbol, predicted_price, confidence, prediction_date,
            target_date, features_snapshot, model_version, sector, source,
            status, submitted_at, validation_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            prediction_dict["prediction_id"],
            prediction_dict["stock_symbol"].upper().strip(),
            float(prediction_dict["predicted_price"]),
            float(prediction_dict["confidence"]) if prediction_dict["confidence"] is not None else None,
            _validate_iso_date(prediction_dict["prediction_date"]),
            _validate_iso_date(prediction_dict["target_date"]),
            json.dumps(prediction_dict["features_snapshot"], ensure_ascii=False),
            prediction_dict["model_version"],
            prediction_dict.get("sector"),
            prediction_dict["source"],
            "pending",
            _utc_now_iso(),
            validation_date,
        ),
    )
    return get_prediction_by_id(conn, prediction_dict["prediction_id"])


def get_prediction_by_id(conn: sqlite3.Connection, prediction_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM predictions WHERE prediction_id = ?",
        (prediction_id,),
    ).fetchone()
    if row is None:
        raise KeyError(f"Prediction {prediction_id} not found")

    record = dict(row)
    record["features_snapshot"] = json.loads(record["features_snapshot"] or "{}")
    record["direction_correct"] = bool(record["direction_correct"]) if record["direction_correct"] is not None else None
    return record


def get_model_status(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute(
        "SELECT version, created_at, deployed_at, status, description FROM model_versions WHERE status = 'deployed' ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    if row is None:
        row = (DEFAULT_MODEL_VERSION, _utc_now_iso(), _utc_now_iso(), "deployed", "Baseline model")

    version, created_at, deployed_at, status, description = row
    metrics_rows = conn.execute(
        "SELECT metric_name, metric_value FROM model_performance_metrics WHERE model_version = ?",
        (version,),
    ).fetchall()
    metrics = {metric_name: float(metric_value) for metric_name, metric_value in metrics_rows}
    return {
        "current_version": version,
        "deployed_at": deployed_at,
        "status": status,
        "last_validation_at": None,
        "metrics": metrics,
        "description": description,
    }


def compute_correction_factor(
    ticker: str,
    base_confidence: float | None = None,
    sector: str | None = None,
    market_volatility: float | None = None,
) -> dict[str, Any]:
    ticker = ticker.upper().strip()
    base_confidence = float(base_confidence) if base_confidence is not None else 0.70
    sector_adj = 1.0
    if sector:
        sector_key = sector.lower().strip()
        if sector_key in {"financials", "banking", "banks"}:
            sector_adj = 0.90
        elif sector_key in {"real estate", "materials"}:
            sector_adj = 0.95
        elif sector_key in {"health care", "consumer staples"}:
            sector_adj = 1.05
        else:
            sector_adj = 1.00

    market_volatility_factor = 1.0
    if market_volatility is not None:
        market_volatility_factor = max(0.7, min(1.2, 1.0 - (market_volatility - 1.0) * 0.15))
    else:
        market_volatility_factor = 0.95

    corrected_confidence = max(0.0, min(1.0, base_confidence * sector_adj * market_volatility_factor))
    recommended_bias = "0%"
    if corrected_confidence < base_confidence:
        recommended_bias = "-0.5%"
    elif corrected_confidence > base_confidence:
        recommended_bias = "+0.5%"

    return {
        "ticker": ticker,
        "sector": sector,
        "base_confidence": base_confidence,
        "sector_adjustment": round(sector_adj, 3),
        "market_volatility_factor": round(market_volatility_factor, 3),
        "corrected_confidence": round(corrected_confidence, 3),
        "recommended_bias": recommended_bias,
    }


def _ensure_model_dir() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_feature_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _flatten_feature_snapshot(features: dict[str, Any]) -> dict[str, float]:
    if not isinstance(features, dict):
        return {}

    flattened: dict[str, float] = {}
    for key, value in features.items():
        if isinstance(value, dict):
            for nested_key, nested_value in value.items():
                normalized = _normalize_feature_value(nested_value)
                if normalized is not None:
                    flattened[f"{key}.{nested_key}"] = normalized
        else:
            normalized = _normalize_feature_value(value)
            if normalized is not None:
                flattened[str(key)] = normalized
    return flattened


def fetch_pending_predictions(conn: sqlite3.Connection, as_of_iso: str | None = None) -> list[dict[str, Any]]:
    if as_of_iso is None:
        as_of_iso = _utc_now_iso()

    rows = conn.execute(
        "SELECT * FROM predictions WHERE status = 'pending' AND validation_date <= ? ORDER BY validation_date ASC",
        (as_of_iso,),
    ).fetchall()
    return [dict(row) for row in rows]


def save_validation_record(
    conn: sqlite3.Connection,
    prediction_id: str,
    actual_price: float,
    error_percent: float,
    direction_correct: bool,
    remark: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO prediction_validations (prediction_id, actual_price, error_percent, direction_correct, validated_at, remark) VALUES (?, ?, ?, ?, ?, ?)",
        (prediction_id, actual_price, error_percent, int(direction_correct), _utc_now_iso(), remark),
    )


def mark_prediction_validated(
    conn: sqlite3.Connection,
    prediction_id: str,
    actual_price: float,
    error_percent: float,
    direction_correct: bool,
    validation_horizon: str,
) -> dict[str, Any]:
    conn.execute(
        "UPDATE predictions SET status = 'validated', actual_price = ?, error_percent = ?, direction_correct = ?, validated_at = ?, validation_horizon = ? WHERE prediction_id = ?",
        (actual_price, error_percent, int(direction_correct), _utc_now_iso(), validation_horizon, prediction_id),
    )
    save_validation_record(conn, prediction_id, actual_price, error_percent, direction_correct, "Auto-validated prediction")
    return get_prediction_by_id(conn, prediction_id)


def get_validation_metrics(conn: sqlite3.Connection, model_version: str | None = None) -> dict[str, float]:
    query = "SELECT error_percent, direction_correct FROM predictions WHERE status = 'validated'"
    params: tuple[Any, ...] = ()
    if model_version:
        query += " AND model_version = ?"
        params = (model_version,)

    rows = conn.execute(query, params).fetchall()
    if not rows:
        return {
            "mae": 0.0,
            "directional_accuracy": 0.0,
            "validated_samples": 0,
        }

    errors = [float(row[0]) for row in rows if row[0] is not None]
    directions = [bool(row[1]) for row in rows if row[1] is not None]
    mae = float(sum(errors) / len(errors)) if errors else 0.0
    directional_accuracy = float(sum(directions) / len(directions)) if directions else 0.0
    return {
        "mae": mae,
        "directional_accuracy": directional_accuracy,
        "validated_samples": len(rows),
    }


def _horizon_group(prediction_date: str, target_date: str) -> str:
    start = datetime.fromisoformat(prediction_date).date()
    end = datetime.fromisoformat(target_date).date()
    diff = (end - start).days
    if diff <= 1:
        return "short"
    if 2 <= diff <= 5:
        return "medium"
    return "long"


def _training_dataset(conn: sqlite3.Connection, horizon: str, limit: int = 500) -> tuple[list[list[float]], list[float], list[str]]:
    rows = conn.execute(
        "SELECT predicted_price, features_snapshot, actual_price, prediction_date, target_date FROM predictions WHERE status = 'validated' AND validation_horizon = ? ORDER BY validated_at DESC LIMIT ?",
        (horizon, limit),
    ).fetchall()

    features_list: list[dict[str, float]] = []
    y: list[float] = []
    for row in rows:
        snapshot = json.loads(row[1] or "{}")
        flattened = _flatten_feature_snapshot(snapshot)
        if not flattened or row[2] is None:
            continue
        flattened["predicted_price"] = float(row[0])
        flattened["prediction_span_days"] = float((datetime.fromisoformat(row[4]).date() - datetime.fromisoformat(row[3]).date()).days)
        features_list.append(flattened)
        y.append(float(row[2]))

    if not features_list:
        return [], [], []

    feature_names = sorted({key for features in features_list for key in features.keys()})
    X: list[list[float]] = []
    for features in features_list:
        X.append([features.get(name, 0.0) for name in feature_names])

    return X, y, feature_names


def _save_model(model, version: str, horizon: str) -> str:
    _ensure_model_dir()
    path = MODEL_DIR / f"{version}_{horizon}.joblib"
    dump(model, path)
    return str(path)


def register_model_version(conn: sqlite3.Connection, version: str, status: str, description: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO model_versions (version, created_at, deployed_at, status, description) VALUES (?, ?, ?, ?, ?)",
        (version, _utc_now_iso(), _utc_now_iso(), status, description),
    )


def add_model_metric(conn: sqlite3.Connection, version: str, metric_name: str, metric_value: float, details: str | None = None) -> None:
    conn.execute(
        "INSERT INTO model_performance_metrics (model_version, evaluated_at, metric_name, metric_value, details) VALUES (?, ?, ?, ?, ?)",
        (version, _utc_now_iso(), metric_name, float(metric_value), details),
    )


def train_models(conn: sqlite3.Connection, version: str | None = None, limit: int = 500) -> dict[str, Any]:
    if version is None:
        version = datetime.now(timezone.utc).strftime("v%Y%m%d%H%M%S")

    register_model_version(conn, version, "candidate", "Auto-trained candidate model")
    horizon_summary: dict[str, Any] = {}
    for horizon in ["short", "medium", "long"]:
        X, y, feature_names = _training_dataset(conn, horizon, limit=limit)
        if len(X) < MIN_TRAINING_SAMPLES:
            horizon_summary[horizon] = {
                "trained": False,
                "reason": f"not enough validated {horizon} predictions ({len(X)} samples)"
            }
            continue

        model = RandomForestRegressor(n_estimators=50, random_state=42)
        model.fit(X, y)
        predictions = model.predict(X)
        mae = mean_absolute_error(y, predictions)
        direction_hits = 0
        for actual, predicted in zip(y, predictions):
            direction_hits += 1 if (actual >= predicted and predicted >= 0) or (actual < predicted and predicted < 0) else 0
        directional_accuracy = float(direction_hits) / len(y) if y else 0.0
        model_path = _save_model(model, version, horizon)
        add_model_metric(conn, version, f"{horizon}_mae", mae, details=f"features={len(feature_names)}")
        add_model_metric(conn, version, f"{horizon}_directional_accuracy", directional_accuracy, details=f"features={len(feature_names)}")

        horizon_summary[horizon] = {
            "trained": True,
            "samples": len(y),
            "feature_count": len(feature_names),
            "mae": mae,
            "directional_accuracy": directional_accuracy,
            "model_path": model_path,
        }

    conn.commit()
    return {
        "model_version": version,
        "status": "candidate",
        "horizon_summary": horizon_summary,
    }


def deploy_model_version(conn: sqlite3.Connection, version: str) -> None:
    conn.execute("UPDATE model_versions SET status = 'archived' WHERE status = 'deployed'")
    conn.execute(
        "UPDATE model_versions SET status = 'deployed', deployed_at = ? WHERE version = ?",
        (_utc_now_iso(), version),
    )
