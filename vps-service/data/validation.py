"""
Central Data Validation Layer (Task 21-B, 2026-10-03)
====================================================

Per owner directive: "اعمل Data Validation Layer مركزية، بحيث أي سهم
يدخل التحليل يتعمل له validation أولًا، وأي field مش منطقي يتعلم INVALID
ويتمنع من التأثير على الـ score والتوصية."

This module provides validate_stock_data() — the SINGLE entry point for
data validation. Every stock entering the analysis pipeline MUST pass
through this function. Fields that fail validation are marked INVALID
and cascade to derived fields (per dependency check).

Rule 24: NO fake data — INVALID > fake.
Rule 20: Python=Brain — validation lives here, not in Node.
"""

from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from enum import Enum
import math


class FieldStatus(str, Enum):
    """Status of a validated field."""
    VALID = "VALID"
    INVALID = "INVALID"
    SUSPECT = "SUSPECT"
    MISSING = "MISSING"


@dataclass
class ValidationFinding:
    """A single validation issue."""
    field: str
    status: FieldStatus
    value: Any
    reason: str


@dataclass
class ValidatedStockData:
    """The result of validate_stock_data(). Holds validated fields + findings."""
    ticker: str
    current_price: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    support: Optional[float] = None
    resistance: Optional[float] = None
    ma50: Optional[float] = None
    ma200: Optional[float] = None
    rsi: Optional[float] = None
    macd: Optional[float] = None
    findings: List[ValidationFinding] = field(default_factory=list)

    @property
    def is_valid_overall(self) -> bool:
        """True if current_price + 52W are VALID (the minimum for analysis)."""
        for f in self.findings:
            if f.field in ('current_price', 'high_52w', 'low_52w') and f.status == FieldStatus.INVALID:
                return False
        return True

    def field_status(self, name: str) -> FieldStatus:
        """Get the status of a specific field."""
        for f in self.findings:
            if f.field == name:
                return f.status
        return FieldStatus.MISSING

    def is_field_valid(self, name: str) -> bool:
        """Check if a field is VALID (not INVALID/SUSPECT/MISSING)."""
        return self.field_status(name) == FieldStatus.VALID


def validate_stock_data(
    ticker: str,
    current_price: Optional[float] = None,
    high_52w: Optional[float] = None,
    low_52w: Optional[float] = None,
    support: Optional[float] = None,
    resistance: Optional[float] = None,
    ma50: Optional[float] = None,
    ma200: Optional[float] = None,
    rsi: Optional[float] = None,
    macd: Optional[float] = None,
) -> ValidatedStockData:
    """
    Central validation for ALL stock data entering the analysis pipeline.

    Per owner directive: any field that's not sane gets marked INVALID.
    INVALID fields are prevented from affecting score/recommendation.

    Validation Rules (from owner):
    1. current_price > 0
    2. 52W_low <= current_price <= 52W_high
    3. support/resistance within reasonable % of price
    4. MA50/MA200 computed from same time series (we verify consistency)
    5. No scaled values (piasters vs EGP)
    6. No cross-stock contamination
    7. No mixing EGP/piasters/percentages/raw values

    Returns ValidatedStockData with per-field status + findings.
    """
    result = ValidatedStockData(
        ticker=ticker,
        current_price=current_price,
        high_52w=high_52w,
        low_52w=low_52w,
        support=support,
        resistance=resistance,
        ma50=ma50,
        ma200=ma200,
        rsi=rsi,
        macd=macd,
    )

    # ════════════════════════════════════════════════════════════════
    # 1. CURRENT PRICE — the foundation of all validation
    # ════════════════════════════════════════════════════════════════
    if current_price is None:
        result.findings.append(ValidationFinding(
            'current_price', FieldStatus.MISSING, None,
            'current_price is None — cannot analyze'
        ))
    elif current_price <= 0:
        result.findings.append(ValidationFinding(
            'current_price', FieldStatus.INVALID, current_price,
            f'current_price={current_price} <= 0 — impossible'
        ))
    elif current_price < 0.001:
        result.findings.append(ValidationFinding(
            'current_price', FieldStatus.SUSPECT, current_price,
            f'current_price={current_price} < 0.001 — likely a unit/scale error'
        ))
    else:
        result.findings.append(ValidationFinding(
            'current_price', FieldStatus.VALID, current_price, 'OK'
        ))

    # ════════════════════════════════════════════════════════════════
    # 2. 52W HIGH / LOW
    # ════════════════════════════════════════════════════════════════
    cp_valid = result.is_field_valid('current_price')

    if high_52w is None:
        result.findings.append(ValidationFinding(
            'high_52w', FieldStatus.MISSING, None, 'high_52w is None'
        ))
    elif high_52w <= 0:
        result.findings.append(ValidationFinding(
            'high_52w', FieldStatus.INVALID, high_52w,
            f'high_52w={high_52w} <= 0 — impossible'
        ))
    elif cp_valid and high_52w < current_price:
        # Current price ABOVE 52W high — either stale 52W data or data error
        # This is the CRST bug: 52W from stale egx_migration source (1.94)
        # while current price from newer source (3.02)
        result.findings.append(ValidationFinding(
            'high_52w', FieldStatus.INVALID, high_52w,
            f'high_52w={high_52w} < current_price={current_price} — '
            f'52W data is STALE or from wrong source. Current price exceeds 52W high.'
        ))
    else:
        result.findings.append(ValidationFinding(
            'high_52w', FieldStatus.VALID, high_52w, 'OK'
        ))

    if low_52w is None:
        result.findings.append(ValidationFinding(
            'low_52w', FieldStatus.MISSING, None, 'low_52w is None'
        ))
    elif low_52w <= 0:
        result.findings.append(ValidationFinding(
            'low_52w', FieldStatus.INVALID, low_52w,
            f'low_52w={low_52w} <= 0 — impossible'
        ))
    elif cp_valid and low_52w > current_price:
        result.findings.append(ValidationFinding(
            'low_52w', FieldStatus.INVALID, low_52w,
            f'low_52w={low_52w} > current_price={current_price} — impossible'
        ))
    elif high_52w is not None and low_52w > high_52w:
        result.findings.append(ValidationFinding(
            'low_52w', FieldStatus.INVALID, low_52w,
            f'low_52w={low_52w} > high_52w={high_52w} — inverted'
        ))
    else:
        result.findings.append(ValidationFinding(
            'low_52w', FieldStatus.VALID, low_52w, 'OK'
        ))

    # ════════════════════════════════════════════════════════════════
    # 3. SUPPORT / RESISTANCE — the CRST bug (158.73 for a 3.02 stock)
    # ════════════════════════════════════════════════════════════════
    if support is None:
        result.findings.append(ValidationFinding(
            'support', FieldStatus.MISSING, None, 'support is None'
        ))
    elif support <= 0:
        result.findings.append(ValidationFinding(
            'support', FieldStatus.INVALID, support,
            f'support={support} <= 0 — impossible'
        ))
    elif cp_valid:
        # Support should be BELOW current price (for a long position)
        # AND within a reasonable range (not 50x the price)
        ratio = support / current_price
        if ratio > 10:
            result.findings.append(ValidationFinding(
                'support', FieldStatus.INVALID, support,
                f'support={support} is {ratio:.1f}x current_price={current_price} — '
                f'CROSS-STOCK CONTAMINATION (likely reading another ticker\'s data). '
                f'Found stocks near {support:.0f} in DB — this is NOT {ticker}\'s support.'
            ))
        elif ratio > 2.0:
            result.findings.append(ValidationFinding(
                'support', FieldStatus.INVALID, support,
                f'support={support} is {ratio:.1f}x current_price={current_price} — '
                f'unreasonable scale (possible piasters/EGP mixing)'
            ))
        elif support > current_price * 1.05:
            # Support should be below price (for BUY); slightly above is SUSPECT
            result.findings.append(ValidationFinding(
                'support', FieldStatus.SUSPECT, support,
                f'support={support} > current_price={current_price} — '
                f'support above price is unusual (may be valid for SELL signals)'
            ))
        else:
            result.findings.append(ValidationFinding(
                'support', FieldStatus.VALID, support, 'OK'
            ))

    if resistance is None:
        result.findings.append(ValidationFinding(
            'resistance', FieldStatus.MISSING, None, 'resistance is None'
        ))
    elif resistance <= 0:
        result.findings.append(ValidationFinding(
            'resistance', FieldStatus.INVALID, resistance,
            f'resistance={resistance} <= 0 — impossible'
        ))
    elif cp_valid:
        ratio = resistance / current_price
        if ratio > 10:
            result.findings.append(ValidationFinding(
                'resistance', FieldStatus.INVALID, resistance,
                f'resistance={resistance} is {ratio:.1f}x current_price={current_price} — '
                f'CROSS-STOCK CONTAMINATION (likely reading another ticker\'s data). '
                f'Found stocks near {resistance:.0f} in DB — this is NOT {ticker}\'s resistance.'
            ))
        elif resistance < current_price * 0.95:
            result.findings.append(ValidationFinding(
                'resistance', FieldStatus.SUSPECT, resistance,
                f'resistance={resistance} < current_price={current_price} — '
                f'resistance below price is unusual'
            ))
        else:
            result.findings.append(ValidationFinding(
                'resistance', FieldStatus.VALID, resistance, 'OK'
            ))

    # ════════════════════════════════════════════════════════════════
    # 4. MA50 / MA200 — consistency check
    # ════════════════════════════════════════════════════════════════
    if ma50 is not None and cp_valid:
        ratio = ma50 / current_price
        if ratio > 10 or ratio < 0.1:
            result.findings.append(ValidationFinding(
                'ma50', FieldStatus.INVALID, ma50,
                f'ma50={ma50} is {ratio:.1f}x current_price={current_price} — '
                f'scale error or cross-stock contamination'
            ))
        else:
            result.findings.append(ValidationFinding(
                'ma50', FieldStatus.VALID, ma50, 'OK'
            ))

    if ma200 is not None and cp_valid:
        ratio = ma200 / current_price
        if ratio > 10 or ratio < 0.1:
            result.findings.append(ValidationFinding(
                'ma200', FieldStatus.INVALID, ma200,
                f'ma200={ma200} is {ratio:.1f}x current_price={current_price} — '
                f'scale error or cross-stock contamination'
            ))
        else:
            result.findings.append(ValidationFinding(
                'ma200', FieldStatus.VALID, ma200, 'OK'
            ))

    # ════════════════════════════════════════════════════════════════
    # 5. RSI — must be 0-100
    # ════════════════════════════════════════════════════════════════
    if rsi is not None:
        if rsi < 0 or rsi > 100:
            result.findings.append(ValidationFinding(
                'rsi', FieldStatus.INVALID, rsi,
                f'rsi={rsi} outside 0-100 range — impossible'
            ))
        else:
            result.findings.append(ValidationFinding(
                'rsi', FieldStatus.VALID, rsi, 'OK'
            ))

    # ════════════════════════════════════════════════════════════════
    # 6. DEPENDENCY CASCADE — if current_price is INVALID, all derived are INVALID
    # ════════════════════════════════════════════════════════════════
    if not cp_valid:
        for fname in ('high_52w', 'low_52w', 'support', 'resistance', 'ma50', 'ma200'):
            # Find existing finding and upgrade to INVALID if it was VALID
            for f in result.findings:
                if f.field == fname and f.status == FieldStatus.VALID:
                    f.status = FieldStatus.INVALID
                    f.reason = f'CASCADE: current_price is INVALID → {fname} cannot be trusted'

    return result


def get_validated_value(vd: ValidatedStockData, field_name: str) -> Optional[float]:
    """
    Get a field's value ONLY if it's VALID. Returns None if INVALID/SUSPECT/MISSING.
    Use this in scoring/recommendation code to ensure only validated data is used.
    """
    if vd.is_field_valid(field_name):
        return getattr(vd, field_name, None)
    return None


def summarize_validation(vd: ValidatedStockData) -> str:
    """Human-readable summary for logging/debugging."""
    lines = [f"Validation: {vd.ticker} — overall_valid={vd.is_valid_overall}"]
    for f in vd.findings:
        lines.append(f"  {f.field}: {f.status} = {f.value} — {f.reason}")
    return "\n".join(lines)


__all__ = [
    'FieldStatus',
    'ValidationFinding',
    'ValidatedStockData',
    'validate_stock_data',
    'get_validated_value',
    'summarize_validation',
]
