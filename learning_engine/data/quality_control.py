"""
data/quality_control.py — Data Quality Pipeline for Learning Engine.

Classifies each symbol into:
  - READY              (clean, training-ready)
  - READY_WITH_WARNINGS (minor issues, usable)
  - INCOMPLETE         (insufficient history, needs backfill)
  - REJECTED           (corrupted/fabricated, do not train)

Based on the HISTORICAL-DATA-READINESS-AUDIT.md findings.

CRITICAL: This module NEVER modifies production data.
It only READS and CLASSIFIES.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum
from datetime import datetime


class QualityClass(str, Enum):
    READY = "READY"
    READY_WITH_WARNINGS = "READY_WITH_WARNINGS"
    INCOMPLETE = "INCOMPLETE"
    REJECTED = "REJECTED"


@dataclass
class QualityReport:
    """Per-symbol quality report."""
    ticker: str
    market: str
    classification: QualityClass
    candle_count: int
    date_range: tuple  # (min_date, max_date)
    years_coverage: float
    issues: List[str] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)

    @property
    def is_trainable(self) -> bool:
        return self.classification in (QualityClass.READY, QualityClass.READY_WITH_WARNINGS)


@dataclass
class QualityThresholds:
    """Configurable thresholds (from LearningSettings)."""
    min_candles: int = 200
    min_years: float = 1.0
    max_flat_pct: float = 20.0
    max_zero_vol_pct: float = 80.0
    max_ohlc_violation_pct: float = 5.0
    max_stale_ratio_pct: float = 70.0


class QualityControl:
    """
    Data quality classifier for historical price data.
    Read-only. Uses MarketDataAdapter for data access.
    """

    def __init__(
        self,
        market_data_adapter,
        thresholds: Optional[QualityThresholds] = None,
    ):
        self._adapter = market_data_adapter
        self._thresholds = thresholds or QualityThresholds()

    def classify_symbol(self, ticker: str, market: str) -> QualityReport:
        """Classify a single symbol's data quality."""
        bars = self._adapter.get_history_bars(ticker, days=300, market=market)

        if not bars:
            return QualityReport(
                ticker=ticker, market=market,
                classification=QualityClass.REJECTED,
                candle_count=0, date_range=("", ""), years_coverage=0.0,
                issues=["NO_DATA: no candles found"],
            )

        candle_count = len(bars)
        min_date = bars[0].date
        max_date = bars[-1].date

        # Calculate years coverage
        try:
            d1 = datetime.strptime(min_date, "%Y-%m-%d")
            d2 = datetime.strptime(max_date, "%Y-%m-%d")
            years = (d2 - d1).days / 365.25
        except (ValueError, TypeError):
            years = 0.0

        # Calculate metrics
        flat_count = sum(1 for b in bars if b.is_flat)
        flat_pct = flat_count / candle_count * 100 if candle_count else 100

        zero_vol_count = sum(1 for b in bars if b.volume == 0)
        zero_vol_pct = zero_vol_count / candle_count * 100 if candle_count else 100

        ohlc_violations = sum(1 for b in bars if not b.is_ohlc_valid)
        ohlc_violation_pct = ohlc_violations / candle_count * 100 if candle_count else 100

        # Stale ratio (unique closes vs total)
        unique_closes = len(set(b.close for b in bars))
        stale_ratio = (candle_count - unique_closes) / candle_count * 100 if candle_count else 100

        issues = []
        if candle_count < self._thresholds.min_candles:
            issues.append(f"INSUFFICIENT_CANDLES: {candle_count} < {self._thresholds.min_candles}")
        if years < self._thresholds.min_years:
            issues.append(f"INSUFFICIENT_HISTORY: {years:.1f}y < {self._thresholds.min_years}y")
        if flat_pct > self._thresholds.max_flat_pct:
            issues.append(f"HIGH_FLAT: {flat_pct:.1f}% > {self._thresholds.max_flat_pct}%")
        if zero_vol_pct > self._thresholds.max_zero_vol_pct:
            issues.append(f"HIGH_ZERO_VOL: {zero_vol_pct:.1f}% > {self._thresholds.max_zero_vol_pct}%")
        if ohlc_violation_pct > self._thresholds.max_ohlc_violation_pct:
            issues.append(f"OHLC_VIOLATIONS: {ohlc_violation_pct:.1f}% > {self._thresholds.max_ohlc_violation_pct}%")
        if stale_ratio > self._thresholds.max_stale_ratio_pct:
            issues.append(f"HIGH_STALE: {stale_ratio:.1f}% > {self._thresholds.max_stale_ratio_pct}%")

        # Classify
        if not issues:
            classification = QualityClass.READY
        elif any("INSUFFICIENT" in i for i in issues):
            classification = QualityClass.INCOMPLETE
        elif any(i.startswith("HIGH_") and float(i.split(":")[1].split("%")[0]) > 50 for i in issues):
            classification = QualityClass.REJECTED
        else:
            classification = QualityClass.READY_WITH_WARNINGS

        return QualityReport(
            ticker=ticker, market=market,
            classification=classification,
            candle_count=candle_count,
            date_range=(min_date, max_date),
            years_coverage=round(years, 2),
            issues=issues,
            metrics={
                "flat_pct": round(flat_pct, 2),
                "zero_vol_pct": round(zero_vol_pct, 2),
                "ohlc_violation_pct": round(ohlc_violation_pct, 2),
                "stale_ratio_pct": round(stale_ratio, 2),
                "unique_closes": unique_closes,
            },
        )

    def classify_market(self, market: str) -> Dict[str, QualityReport]:
        """Classify all symbols in a market."""
        symbols = self._adapter.get_symbols_for_market(market)
        reports = {}
        for sym in symbols:
            reports[sym] = self.classify_symbol(sym, market)
        return reports

    def get_market_summary(self, market: str) -> Dict:
        """Get aggregate quality summary for a market."""
        reports = self.classify_market(market)
        total = len(reports)
        if total == 0:
            return {"market": market, "total": 0, "ready": 0}

        by_class = {}
        for r in reports.values():
            by_class[r.classification.value] = by_class.get(r.classification.value, 0) + 1

        return {
            "market": market,
            "total_symbols": total,
            "by_class": by_class,
            "ready_count": by_class.get("READY", 0) + by_class.get("READY_WITH_WARNINGS", 0),
            "ready_pct": (by_class.get("READY", 0) + by_class.get("READY_WITH_WARNINGS", 0)) / total * 100,
            "rejected_count": by_class.get("REJECTED", 0),
            "incomplete_count": by_class.get("INCOMPLETE", 0),
        }
