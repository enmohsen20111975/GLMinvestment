"""
features/tv_field_mapping.py — TradingView Field-to-Feature Mapping (Phase D).

Maps the 97 columns in stocks.db.stocks to canonical Feature Definitions.
Every field is documented with:
  - TV field name
  - Feature name (in FeatureSchema)
  - Data group (valuation, profitability, technicals, etc.)
  - Coverage % (how many stocks have non-null values)
  - PIT status (snapshot only — needs archive for historical use)
  - Unit + currency notes

CRITICAL: stocks.db.stocks is a SNAPSHOT (current values only).
These fields CANNOT be used as point-in-time features for historical
training without building a fundamental_snapshots archive first.

For NOW (v0.2.x):
  - These fields are available for SHADOW inference (current decisions)
  - These fields are NOT available for historical training (look-ahead bias)

For FUTURE (after fundamental_snapshots archive is built):
  - Fields with high coverage (>60%) can become PIT features
  - Fields with low coverage (<30%) should use MissingDataPolicy.NULL
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum


class TVDataGroup(str, Enum):
    """TradingView data groups (matches TV screener tabs)."""
    OVERVIEW = "overview"
    PERFORMANCE = "performance"
    TECHNICALS = "technicals"
    VALUATION = "valuation"
    PROFITABILITY = "profitability"
    INCOME_STATEMENT = "income_statement"
    BALANCE_SHEET = "balance_sheet"
    CASH_FLOW = "cash_flow"
    DIVIDENDS = "dividends"
    LIQUIDITY = "liquidity"


class PITStatus(str, Enum):
    """Point-in-time availability status."""
    SNAPSHOT_ONLY = "snapshot_only"       # current value only (look-ahead risk)
    HISTORICAL_AVAILABLE = "historical"   # has time series (safe for PIT)
    NOT_AVAILABLE = "not_available"       # field doesn't exist or always null


@dataclass(frozen=True)
class TVFieldMapping:
    """Mapping of one TradingView field to a learning feature."""
    tv_column: str              # column name in stocks.db.stocks
    feature_name: str           # canonical feature name in FeatureSchema
    tv_group: TVDataGroup       # TV screener group
    description: str            # what this field represents
    unit: str                   # "%", "ratio", "EGP", "USD", "count"
    coverage_pct: float         # % of stocks with non-null values
    pit_status: PITStatus       # snapshot vs historical
    usable_for_training: bool   # can be used in historical training?
    usable_for_shadow: bool     # can be used in shadow inference?
    notes: str = ""


# ─── The 97-column mapping (from actual DB inspection 2026-10-30) ──────────
TV_FIELD_MAPPINGS: List[TVFieldMapping] = [
    # ─── OVERVIEW (أساسية + سعرية) ────────────────────────────────────────
    TVFieldMapping("ticker", "ticker", TVDataGroup.OVERVIEW,
                   "Stock symbol", "text", 100, PITStatus.HISTORICAL_AVAILABLE,
                   True, True, "Primary key — used for joining"),
    TVFieldMapping("market", "market", TVDataGroup.OVERVIEW,
                   "Market slug", "category", 100, PITStatus.HISTORICAL_AVAILABLE,
                   True, True, "EGX/TADAWUL/KSE/QSE/US — needs normalize (america→US)"),
    TVFieldMapping("sector", "sector", TVDataGroup.OVERVIEW,
                   "Sector", "category", 99, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — sector changes are rare"),
    TVFieldMapping("industry", "industry", TVDataGroup.OVERVIEW,
                   "Industry", "category", 88, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — industry changes are rare"),
    TVFieldMapping("current_price", "current_price", TVDataGroup.OVERVIEW,
                   "Current price", "price", 84, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use OHLCV for historical"),
    TVFieldMapping("market_cap", "market_cap", TVDataGroup.OVERVIEW,
                   "Market capitalization", "currency", 46, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — needed for liquidity_intensity"),
    TVFieldMapping("volume", "volume", TVDataGroup.OVERVIEW,
                   "Current volume", "count", 93, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use OHLCV volume for historical"),

    # ─── VALUATION (تقييم) ────────────────────────────────────────────────
    TVFieldMapping("pe_ratio", "pe_ratio", TVDataGroup.VALUATION,
                   "P/E ratio (price-to-earnings)", "ratio", 52, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — needs fundamental_snapshots archive"),
    TVFieldMapping("pb_ratio", "pb_ratio", TVDataGroup.VALUATION,
                   "P/B ratio (price-to-book)", "ratio", 67, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("ps_ratio", "ps_ratio", TVDataGroup.VALUATION,
                   "P/S ratio (price-to-sales)", "ratio", 62, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("eps", "eps", TVDataGroup.VALUATION,
                   "Earnings per share", "currency", 67, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("eps_diluted", "eps_diluted", TVDataGroup.VALUATION,
                   "Diluted EPS", "currency", 63, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("enterprise_value", "enterprise_value", TVDataGroup.VALUATION,
                   "Enterprise value (EV)", "currency", 63, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("ev_to_revenue", "ev_to_revenue", TVDataGroup.VALUATION,
                   "EV/Revenue ratio", "ratio", 65, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── PROFITABILITY (ربحية) ────────────────────────────────────────────
    TVFieldMapping("roe", "roe", TVDataGroup.PROFITABILITY,
                   "Return on equity", "%", 64, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("roa", "roa", TVDataGroup.PROFITABILITY,
                   "Return on assets", "%", 63, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("roic", "roic", TVDataGroup.PROFITABILITY,
                   "Return on invested capital", "%", 62, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("gross_margin", "gross_margin", TVDataGroup.PROFITABILITY,
                   "Gross profit margin", "%", 56, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("operating_margin", "operating_margin", TVDataGroup.PROFITABILITY,
                   "Operating margin", "%", 64, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("profit_margin", "profit_margin", TVDataGroup.PROFITABILITY,
                   "Net profit margin", "%", 65, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("dividend_yield", "dividend_yield", TVDataGroup.DIVIDENDS,
                   "Dividend yield", "%", 45, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("dps_ttm", "dps_ttm", TVDataGroup.DIVIDENDS,
                   "Dividend per share (TTM)", "currency", 41, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── BALANCE SHEET (ميزانية) ──────────────────────────────────────────
    TVFieldMapping("total_assets", "total_assets", TVDataGroup.BALANCE_SHEET,
                   "Total assets", "currency", 69, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("total_current_assets", "total_current_assets", TVDataGroup.BALANCE_SHEET,
                   "Total current assets", "currency", 68, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("total_debt", "total_debt", TVDataGroup.BALANCE_SHEET,
                   "Total debt", "currency", 65, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("shares_outstanding", "shares_outstanding", TVDataGroup.BALANCE_SHEET,
                   "Shares outstanding", "count", 75, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── INCOME STATEMENT (قائمة الدخل) ──────────────────────────────────
    TVFieldMapping("total_revenue", "total_revenue", TVDataGroup.INCOME_STATEMENT,
                   "Total revenue", "currency", 69, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("gross_profit", "gross_profit", TVDataGroup.INCOME_STATEMENT,
                   "Gross profit", "currency", 63, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("net_income", "net_income", TVDataGroup.INCOME_STATEMENT,
                   "Net income", "currency", 70, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── CASH FLOW (تدفقات نقدية) ─────────────────────────────────────────
    TVFieldMapping("free_cash_flow", "free_cash_flow", TVDataGroup.CASH_FLOW,
                   "Free cash flow", "currency", 59, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── TECHNICALS (فنية — من TV Scanner) ────────────────────────────────
    TVFieldMapping("rsi", "tv_rsi", TVDataGroup.TECHNICALS,
                   "TV RSI (snapshot)", "float", 96, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use Unified Indicators Library for PIT"),
    TVFieldMapping("macd", "tv_macd", TVDataGroup.TECHNICALS,
                   "TV MACD line (snapshot)", "float", 87, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use Unified Library for PIT"),
    TVFieldMapping("macd_signal", "tv_macd_signal", TVDataGroup.TECHNICALS,
                   "TV MACD signal (snapshot)", "float", 87, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("atr", "tv_atr", TVDataGroup.TECHNICALS,
                   "TV ATR (snapshot)", "float", 87, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use Unified Library for PIT"),
    TVFieldMapping("sma20", "tv_sma20", TVDataGroup.TECHNICALS,
                   "TV SMA20 (snapshot)", "float", 87, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use Unified Library for PIT"),
    TVFieldMapping("sma50", "tv_sma50", TVDataGroup.TECHNICALS,
                   "TV SMA50 (snapshot)", "float", 87, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use Unified Library for PIT"),
    TVFieldMapping("sma200", "tv_sma200", TVDataGroup.TECHNICALS,
                   "TV SMA200 (snapshot)", "float", 85, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use Unified Library for PIT"),
    TVFieldMapping("recommend_all", "tv_recommend_all", TVDataGroup.TECHNICALS,
                   "TV overall recommendation (-1 to 1)", "float", 86, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — TV's combined technical rating"),
    TVFieldMapping("recommend_ma", "tv_recommend_ma", TVDataGroup.TECHNICALS,
                   "TV MA recommendation", "float", 83, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("recommend_other", "tv_recommend_other", TVDataGroup.TECHNICALS,
                   "TV oscillators recommendation", "float", 63, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("trend", "tv_trend", TVDataGroup.TECHNICALS,
                   "TV trend label", "category", 56, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — Arabic values (صاعد/هابط/عرضي)"),

    # ─── LIQUIDITY (سيولة) ────────────────────────────────────────────────
    TVFieldMapping("turnover_egp", "turnover_egp", TVDataGroup.LIQUIDITY,
                   "Turnover in EGP", "currency", 86, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — EGX only"),
    TVFieldMapping("value_traded", "value_traded", TVDataGroup.LIQUIDITY,
                   "Value traded", "currency", 86, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("relative_volume_10d", "relative_volume_10d", TVDataGroup.LIQUIDITY,
                   "Relative volume vs 10d average", "ratio", 86, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── PERFORMANCE (أداء) ───────────────────────────────────────────────
    # Note: perf_* columns are NOT in the 97 columns (they're in tab_performance)
    # stocks.db.stocks has change_percent only
    TVFieldMapping("change_percent", "change_percent", TVDataGroup.PERFORMANCE,
                   "Daily change %", "%", 88, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — use OHLCV for historical returns"),

    # ─── 52-week range ────────────────────────────────────────────────────
    TVFieldMapping("high_52w", "high_52w", TVDataGroup.PERFORMANCE,
                   "52-week high", "price", 58, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("low_52w", "low_52w", TVDataGroup.PERFORMANCE,
                   "52-week low", "price", 58, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("support", "support_level", TVDataGroup.TECHNICALS,
                   "Support level", "price", 58, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),
    TVFieldMapping("resistance", "resistance_level", TVDataGroup.TECHNICALS,
                   "Resistance level", "price", 58, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot"),

    # ─── Fundamental score (computed by V3) ───────────────────────────────
    TVFieldMapping("fundamental_score", "fundamental_score", TVDataGroup.OVERVIEW,
                   "V3 fundamental score (0-100)", "float", 100, PITStatus.SNAPSHOT_ONLY,
                   False, True, "Snapshot — computed by V3 engine"),
]


class TVFieldMapper:
    """Maps TV fields to learning features + tracks PIT status."""

    def __init__(self, mappings: Optional[List[TVFieldMapping]] = None):
        self._mappings = mappings or TV_FIELD_MAPPINGS
        self._by_column: Dict[str, TVFieldMapping] = {
            m.tv_column: m for m in self._mappings
        }

    def get_mapping(self, tv_column: str) -> Optional[TVFieldMapping]:
        return self._by_column.get(tv_column)

    def get_by_group(self, group: TVDataGroup) -> List[TVFieldMapping]:
        return [m for m in self._mappings if m.tv_group == group]

    def get_trainable_fields(self) -> List[TVFieldMapping]:
        """Fields usable for historical training (PIT-safe)."""
        return [m for m in self._mappings if m.usable_for_training]

    def get_shadow_fields(self) -> List[TVFieldMapping]:
        """Fields usable for shadow inference (current decisions)."""
        return [m for m in self._mappings if m.usable_for_shadow]

    def get_snapshot_only_fields(self) -> List[TVFieldMapping]:
        """Fields that are snapshot only (need archive for training)."""
        return [m for m in self._mappings if m.pit_status == PITStatus.SNAPSHOT_ONLY]

    def get_high_coverage_fields(self, min_coverage: float = 60.0) -> List[TVFieldMapping]:
        """Fields with coverage >= min_coverage %."""
        return [m for m in self._mappings if m.coverage_pct >= min_coverage]

    def summary(self) -> Dict:
        """Summary statistics."""
        total = len(self._mappings)
        return {
            "total_fields": total,
            "trainable": len(self.get_trainable_fields()),
            "shadow_usable": len(self.get_shadow_fields()),
            "snapshot_only": len(self.get_snapshot_only_fields()),
            "high_coverage_60": len(self.get_high_coverage_fields(60)),
            "by_group": {
                g.value: len([m for m in self._mappings if m.tv_group == g])
                for g in TVDataGroup
            },
        }
