"""
adapters/indicators_adapter.py — Unified Indicators Library Bridge.

CRITICAL CONTRACT (Section 4 of the directive):
  This module is a BRIDGE ONLY. It does NOT compute indicators.
  All indicator computations MUST go through vps-service/analyzers/indicators/.
  NO duplicate formulas. NO parallel implementations.

  If an indicator is needed but not in the Unified Library, document it
  in Documentation/Learning-Engine/UNIFIED-INDICATORS-INTEGRATION.md
  and request its addition to the library. Do NOT compute it here.

Usage:
  from learning_engine.adapters.indicators_adapter import IndicatorsAdapter
  adapter = IndicatorsAdapter()
  rsi = adapter.calc_rsi(closes, period=14)
  atr = adapter.calc_atr(highs, lows, closes, period=14)
"""
from __future__ import annotations
import sys
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

# ─── Path setup: make vps-service importable ───────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_VPS_PATH = _PROJECT_ROOT / "vps-service"
if str(_VPS_PATH) not in sys.path:
    sys.path.insert(0, str(_VPS_PATH))

# ─── Import from Unified Indicators Library (SSOT — Rule 67) ───────────────
# These are the ONLY authorized indicator implementations.
# Any feature that needs an indicator MUST call these functions.
from analyzers.indicators import (  # noqa: E402
    calc_atr,
    calc_rsi,
    calc_srsi,
    calc_bollinger,
    calc_bollinger_series,
    calc_mfi,
    calc_adx,
    calc_vwap,
    calc_vwap_premium,
    calc_volume_profile,
    sma,
    ema,
    macd,
)
from analyzers.indicators.flow_indicators import (  # noqa: E402
    calc_cmf,
    calc_obv,
    obv_trend,
)
from utils.shared_liquidity import (  # noqa: E402
    compute_money_flow,
    dynamic_min_turnover,
    is_explosive_surge,
    detect_quiet_accumulation,
    detect_pre_surge,
)


@dataclass
class IndicatorResult:
    """Wrapper for indicator results with provenance metadata."""
    value: Any
    source_function: str
    source_module: str
    schema_version: str
    computation_timestamp: str


class IndicatorsAdapter:
    """
    Bridge to the Unified Indicators Library.

    Every method here is a thin wrapper that:
      1. Validates inputs.
      2. Calls the canonical function from analyzers/indicators/.
      3. Returns the result (wrapped with provenance if requested).

    NO formulas are implemented here. NO duplicate calculations.
    """

    # ─── Price-based indicators ────────────────────────────────────────────

    def calc_rsi(self, closes: List[float], period: int = 14) -> Optional[float]:
        """Wilder's RSI. Source: analyzers/indicators/rsi.py::calc_rsi"""
        return calc_rsi(closes, period=period)

    def calc_srsi(self, closes: List[float], period: int = 14,
                  smooth_k: int = 3, smooth_d: int = 3) -> Optional[Dict]:
        """Stochastic RSI. Source: analyzers/indicators/srsi.py::calc_srsi"""
        return calc_srsi(closes, period=period, smooth_k=smooth_k, smooth_d=smooth_d)

    def calc_atr(self, highs: List[float], lows: List[float],
                 closes: List[float], period: int = 14) -> Optional[float]:
        """Wilder's ATR. Source: analyzers/indicators/atr.py::calc_atr"""
        return calc_atr(highs, lows, closes, period=period)

    def calc_adx(self, highs: List[float], lows: List[float],
                 closes: List[float], period: int = 14) -> Optional[Dict]:
        """ADX/DMI. Source: analyzers/indicators/adx.py::calc_adx
        Returns: dict{adx, plus_di, minus_di}
        """
        return calc_adx(highs, lows, closes, period=period)

    def calc_bollinger(self, closes: List[float], period: int = 20,
                       std_dev: float = 2.0) -> Optional[Dict]:
        """Bollinger Bands. Source: analyzers/indicators/bollinger.py::calc_bollinger
        Returns: dict{middle, upper, lower, bandwidth, percent_b}
        """
        return calc_bollinger(closes, period=period, std_dev=std_dev)

    def calc_bollinger_series(self, closes: List[float], period: int = 20,
                              std_dev: float = 2.0) -> Optional[Dict]:
        """Bollinger Bands (full series for plotting). Source: calc_bollinger_series"""
        return calc_bollinger_series(closes, period=period, std_dev=std_dev)

    # ─── Moving averages ───────────────────────────────────────────────────

    def sma(self, data: List[float], period: int) -> Optional[float]:
        """Simple Moving Average. Source: analyzers/indicators/ma.py::sma"""
        return sma(data, period)

    def ema(self, data: List[float], period: int) -> Optional[float]:
        """Exponential Moving Average. Source: analyzers/indicators/ma.py::ema"""
        return ema(data, period)

    def macd(self, closes: List[float], fast: int = 12, slow: int = 26,
             signal_period: int = 9) -> Optional[Dict]:
        """MACD. Source: analyzers/indicators/ma.py::macd
        Returns: dict{line, signal, histogram}
        """
        return macd(closes, fast=fast, slow=slow, signal_period=signal_period)

    # ─── Volume-weighted indicators ────────────────────────────────────────

    def calc_mfi(self, highs: List[float], lows: List[float],
                 closes: List[float], volumes: List[float],
                 period: int = 14) -> Optional[float]:
        """Money Flow Index. Source: analyzers/indicators/mfi.py::calc_mfi"""
        return calc_mfi(highs, lows, closes, volumes, period=period)

    def calc_vwap(self, highs: List[float], lows: List[float],
                  closes: List[float], volumes: List[float],
                  period: Optional[int] = None) -> Optional[float]:
        """VWAP. Source: analyzers/indicators/vwap.py::calc_vwap
        period=None → cumulative session; period=int → rolling
        """
        return calc_vwap(highs, lows, closes, volumes, period=period)

    def calc_vwap_premium(self, closes: List[float], vwap: float) -> Optional[float]:
        """VWAP premium %. Source: analyzers/indicators/vwap.py::calc_vwap_premium"""
        return calc_vwap_premium(closes, vwap)

    def calc_volume_profile(self, closes: List[float], volumes: List[float],
                            bins: int = 20, value_area_pct: float = 0.70) -> Optional[Dict]:
        """Volume Profile. Source: analyzers/indicators/volume_profile.py::calc_volume_profile
        Returns: dict{poc, vah, val, total_volume, nodes}
        """
        return calc_volume_profile(closes, volumes, bins=bins, value_area_pct=value_area_pct)

    # ─── Flow indicators (from flow_indicators.py) ─────────────────────────

    def calc_cmf(self, highs: List[float], lows: List[float],
                 closes: List[float], volumes: List[float],
                 period: int = 20) -> Optional[float]:
        """Chaikin Money Flow. Source: flow_indicators.py::calc_cmf"""
        return calc_cmf(highs, lows, closes, volumes, period=period)

    def calc_obv(self, closes: List[float], volumes: List[float]) -> Optional[List[float]]:
        """On-Balance Volume. Source: flow_indicators.py::calc_obv"""
        return calc_obv(closes, volumes)

    def obv_trend(self, obv_series: List[float], lookback: int = 20) -> str:
        """OBV trend direction. Source: flow_indicators.py::obv_trend
        Returns: 'up' | 'down' | 'flat'
        """
        return obv_trend(obv_series, lookback=lookback)

    # ─── Liquidity indicators (from shared_liquidity.py) ───────────────────

    def liquidity_intensity(self, turnover: float, market_cap: float) -> Optional[float]:
        """Turnover/market_cap %. Source: shared_liquidity.py::liquidity_intensity"""
        return liquidity_intensity(turnover, market_cap)

    def compute_money_flow(self, closes: List[float], volumes: List[float],
                           highs: List[float], lows: List[float]) -> Dict:
        """6-layer money flow. Source: shared_liquidity.py::compute_money_flow
        Returns: dict{buy_pct, sell_pct, ...}
        """
        return compute_money_flow(closes, volumes, highs, lows)

    def dynamic_min_turnover(self, price: float, market_dead: bool = False) -> int:
        """Dynamic minimum turnover threshold. Source: shared_liquidity.py"""
        return dynamic_min_turnover(price, market_dead=market_dead)

    def is_explosive_surge(self, volumes: List[float], closes: List[float]) -> Dict:
        """Explosive surge detection. Source: shared_liquidity.py::is_explosive_surge"""
        return is_explosive_surge(volumes, closes)

    def detect_quiet_accumulation(self, closes: List[float], volumes: List[float],
                                  highs: List[float], lows: List[float]) -> Dict:
        """Quiet accumulation detection. Source: shared_liquidity.py::detect_quiet_accumulation"""
        return detect_quiet_accumulation(closes, volumes, highs, lows)

    def detect_pre_surge(self, closes: List[float], volumes: List[float],
                         highs: List[float], lows: List[float]) -> Dict:
        """Pre-surge detection. Source: shared_liquidity.py::detect_pre_surge"""
        return detect_pre_surge(closes, volumes, highs, lows)

    # ─── Provenance ────────────────────────────────────────────────────────

    def list_available_indicators(self) -> List[Dict[str, str]]:
        """Return list of all available indicators with their source modules."""
        return [
            {"name": "calc_rsi", "source": "analyzers.indicators.rsi", "type": "price"},
            {"name": "calc_srsi", "source": "analyzers.indicators.srsi", "type": "price"},
            {"name": "calc_atr", "source": "analyzers.indicators.atr", "type": "price"},
            {"name": "calc_adx", "source": "analyzers.indicators.adx", "type": "price"},
            {"name": "calc_bollinger", "source": "analyzers.indicators.bollinger", "type": "price"},
            {"name": "sma", "source": "analyzers.indicators.ma", "type": "price"},
            {"name": "ema", "source": "analyzers.indicators.ma", "type": "price"},
            {"name": "macd", "source": "analyzers.indicators.ma", "type": "price"},
            {"name": "calc_mfi", "source": "analyzers.indicators.mfi", "type": "liquidity"},
            {"name": "calc_vwap", "source": "analyzers.indicators.vwap", "type": "liquidity"},
            {"name": "calc_vwap_premium", "source": "analyzers.indicators.vwap", "type": "liquidity"},
            {"name": "calc_volume_profile", "source": "analyzers.indicators.volume_profile", "type": "liquidity"},
            {"name": "calc_cmf", "source": "analyzers.indicators.flow_indicators", "type": "liquidity"},
            {"name": "calc_obv", "source": "analyzers.indicators.flow_indicators", "type": "liquidity"},
            {"name": "obv_trend", "source": "analyzers.indicators.flow_indicators", "type": "liquidity"},
            {"name": "liquidity_intensity", "source": "utils.shared_liquidity", "type": "liquidity"},
            {"name": "compute_money_flow", "source": "utils.shared_liquidity", "type": "liquidity"},
            {"name": "dynamic_min_turnover", "source": "utils.shared_liquidity", "type": "liquidity"},
            {"name": "is_explosive_surge", "source": "utils.shared_liquidity", "type": "liquidity"},
            {"name": "detect_quiet_accumulation", "source": "utils.shared_liquidity", "type": "liquidity"},
            {"name": "detect_pre_surge", "source": "utils.shared_liquidity", "type": "liquidity"},
        ]
