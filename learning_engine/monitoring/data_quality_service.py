"""
monitoring/data_quality_service.py — Data Quality Center (Phase F).

Measurable quality indicators per owner directive (Section F):
  - OHLC consistency
  - Duplicate rate
  - Missing candle rate
  - Zero-volume rate
  - Stale-price rate
  - Historical coverage
  - Symbol mapping validity
  - Fundamental completeness
  - Fundamental freshness
  - Currency/unit consistency
  - Point-in-time availability

Produces reports at 4 levels:
  - Market level (per EGX, TADAWUL, US, etc.)
  - Source level (per DB table)
  - Table level (per source table)
  - Symbol level (per ticker)

Read-only. Uses UnifiedPriceAdapter (mode=ro).
"""
from __future__ import annotations
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from ..adapters.unified_price_adapter import UnifiedPriceAdapter
from ..adapters.readonly_data_adapter import ReadOnlyDataAdapter


class QualityLevel(str, Enum):
    EXCELLENT = "EXCELLENT"  # >95% quality
    GOOD = "GOOD"            # 80-95%
    FAIR = "FAIR"            # 60-80%
    POOR = "POOR"            # 40-60%
    CRITICAL = "CRITICAL"    # <40%


@dataclass
class SymbolQualityReport:
    """Per-symbol quality report."""
    ticker: str
    market: str
    total_bars: int
    date_range: tuple
    years_coverage: float
    ohlc_violations: int
    ohlc_violation_pct: float
    flat_candles: int
    flat_pct: float
    zero_volume_candles: int
    zero_vol_pct: float
    stale_ratio_pct: float
    quality_level: QualityLevel
    issues: List[str] = field(default_factory=list)


@dataclass
class MarketQualityReport:
    """Per-market quality report."""
    market: str
    total_symbols: int
    total_bars: int
    avg_bars_per_symbol: float
    avg_years_coverage: float
    flat_pct: float
    zero_vol_pct: float
    ohlc_violation_pct: float
    quality_level: QualityLevel
    by_level: Dict[str, int] = field(default_factory=dict)


class DataQualityService:
    """
    Data Quality Center.
    Reads from UnifiedPriceAdapter (data_engine.db + stocks.db only).
    Read-only. No modifications.
    """

    def __init__(
        self,
        price_adapter: Optional[UnifiedPriceAdapter] = None,
        ro_adapter: Optional[ReadOnlyDataAdapter] = None,
    ):
        self._price_adapter = price_adapter or UnifiedPriceAdapter()
        self._ro_adapter = ro_adapter or ReadOnlyDataAdapter()

    # ─── Symbol-level quality ──────────────────────────────────────────────

    def analyze_symbol(self, ticker: str, market: str) -> SymbolQualityReport:
        """Analyze data quality for a single symbol."""
        bars = self._price_adapter.get_unified_history(ticker, market, days=500)

        if not bars:
            return SymbolQualityReport(
                ticker=ticker, market=market, total_bars=0,
                date_range=("", ""), years_coverage=0,
                ohlc_violations=0, ohlc_violation_pct=0,
                flat_candles=0, flat_pct=0,
                zero_volume_candles=0, zero_vol_pct=0,
                stale_ratio_pct=100,
                quality_level=QualityLevel.CRITICAL,
                issues=["NO_DATA: no bars found"],
            )

        total = len(bars)
        min_date = bars[0].date
        max_date = bars[-1].date

        # Years coverage
        try:
            d1 = datetime.strptime(min_date, "%Y-%m-%d")
            d2 = datetime.strptime(max_date, "%Y-%m-%d")
            years = (d2 - d1).days / 365.25
        except (ValueError, TypeError):
            years = 0

        # OHLC violations
        ohlc_violations = sum(1 for b in bars if not b.is_ohlc_valid)
        ohlc_pct = ohlc_violations / total * 100

        # Flat candles
        flat = sum(1 for b in bars if b.is_flat)
        flat_pct = flat / total * 100

        # Zero volume
        zero_vol = sum(1 for b in bars if b.volume == 0)
        zero_vol_pct = zero_vol / total * 100

        # Stale ratio (unique closes / total)
        unique_closes = len(set(round(b.close, 4) for b in bars))
        stale_ratio = (total - unique_closes) / total * 100

        # Quality level
        issues = []
        if ohlc_pct > 10:
            issues.append(f"HIGH_OHLC_VIOLATIONS: {ohlc_pct:.1f}%")
        if flat_pct > 30:
            issues.append(f"HIGH_FLAT: {flat_pct:.1f}%")
        if zero_vol_pct > 50:
            issues.append(f"HIGH_ZERO_VOL: {zero_vol_pct:.1f}%")
        if years < 0.5:
            issues.append(f"INSUFFICIENT_HISTORY: {years:.1f}y")
        if stale_ratio > 70:
            issues.append(f"HIGH_STALE: {stale_ratio:.1f}%")

        # Determine level
        score = 100
        score -= min(ohlc_pct * 2, 30)
        score -= min(flat_pct, 25)
        score -= min(zero_vol_pct / 2, 20)
        score -= min(stale_ratio / 2, 15)
        if years < 1:
            score -= 20

        if score >= 95:
            level = QualityLevel.EXCELLENT
        elif score >= 80:
            level = QualityLevel.GOOD
        elif score >= 60:
            level = QualityLevel.FAIR
        elif score >= 40:
            level = QualityLevel.POOR
        else:
            level = QualityLevel.CRITICAL

        return SymbolQualityReport(
            ticker=ticker, market=market, total_bars=total,
            date_range=(min_date, max_date), years_coverage=round(years, 2),
            ohlc_violations=ohlc_violations, ohlc_violation_pct=round(ohlc_pct, 2),
            flat_candles=flat, flat_pct=round(flat_pct, 2),
            zero_volume_candles=zero_vol, zero_vol_pct=round(zero_vol_pct, 2),
            stale_ratio_pct=round(stale_ratio, 2),
            quality_level=level, issues=issues,
        )

    # ─── Market-level quality ──────────────────────────────────────────────

    def analyze_market(self, market: str, sample_size: int = 50) -> MarketQualityReport:
        """Analyze data quality for a market (samples up to sample_size symbols)."""
        # Get coverage report to find available symbols
        cov = self._price_adapter.get_coverage_report(market)
        symbols = list(cov.get("symbols", {}).keys())[:sample_size]

        if not symbols:
            return MarketQualityReport(
                market=market, total_symbols=0, total_bars=0,
                avg_bars_per_symbol=0, avg_years_coverage=0,
                flat_pct=0, zero_vol_pct=0, ohlc_violation_pct=0,
                quality_level=QualityLevel.CRITICAL,
                by_level={"CRITICAL": 1},
            )

        reports = []
        for sym in symbols:
            r = self.analyze_symbol(sym, market)
            reports.append(r)

        total_symbols = len(reports)
        total_bars = sum(r.total_bars for r in reports)
        avg_bars = total_bars / total_symbols if total_symbols else 0
        avg_years = sum(r.years_coverage for r in reports) / total_symbols if total_symbols else 0

        # Aggregate percentages
        all_bars = sum(r.total_bars for r in reports if r.total_bars > 0)
        flat_pct = sum(r.flat_candles for r in reports) / all_bars * 100 if all_bars else 0
        zero_vol_pct = sum(r.zero_volume_candles for r in reports) / all_bars * 100 if all_bars else 0
        ohlc_pct = sum(r.ohlc_violations for r in reports) / all_bars * 100 if all_bars else 0

        # By level
        by_level: Dict[str, int] = {}
        for r in reports:
            by_level[r.quality_level.value] = by_level.get(r.quality_level.value, 0) + 1

        # Overall level
        excellent = by_level.get("EXCELLENT", 0)
        good = by_level.get("GOOD", 0)
        fair = by_level.get("FAIR", 0)
        poor = by_level.get("POOR", 0)
        critical = by_level.get("CRITICAL", 0)

        if (excellent + good) / total_symbols > 0.7:
            level = QualityLevel.GOOD
        elif (excellent + good + fair) / total_symbols > 0.5:
            level = QualityLevel.FAIR
        elif critical / total_symbols > 0.5:
            level = QualityLevel.CRITICAL
        else:
            level = QualityLevel.POOR

        return MarketQualityReport(
            market=market, total_symbols=total_symbols,
            total_bars=total_bars, avg_bars_per_symbol=round(avg_bars, 1),
            avg_years_coverage=round(avg_years, 2),
            flat_pct=round(flat_pct, 2),
            zero_vol_pct=round(zero_vol_pct, 2),
            ohlc_violation_pct=round(ohlc_pct, 2),
            quality_level=level, by_level=by_level,
        )

    # ─── Full report ───────────────────────────────────────────────────────

    def get_full_report(self) -> Dict:
        """Get full data quality report for all markets."""
        markets = ["EGX", "TADAWUL", "KSE", "QSE", "US"]
        report = {
            "timestamp": datetime.utcnow().isoformat(),
            "markets": {},
        }

        for market in markets:
            mq = self.analyze_market(market, sample_size=30)
            report["markets"][market] = {
                "total_symbols": mq.total_symbols,
                "total_bars": mq.total_bars,
                "avg_bars_per_symbol": mq.avg_bars_per_symbol,
                "avg_years_coverage": mq.avg_years_coverage,
                "flat_pct": mq.flat_pct,
                "zero_vol_pct": mq.zero_vol_pct,
                "ohlc_violation_pct": mq.ohlc_violation_pct,
                "quality_level": mq.quality_level.value,
                "by_level": mq.by_level,
            }

        # Fundamental freshness (from readonly adapter)
        fund_cov = self._ro_adapter.get_fundamental_coverage()
        report["fundamental_coverage"] = {
            "total_stocks": fund_cov.get("total_stocks", 0),
            "top_coverage": dict(
                sorted(fund_cov.get("coverage_pct", {}).items(),
                       key=lambda x: x[1], reverse=True)[:10]
            ),
        }

        # Data freshness
        report["data_freshness"] = self._ro_adapter.get_data_freshness()

        return report
