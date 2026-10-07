"""
Helper Functions
================
Common utility functions.
"""

import re
from typing import Optional


def format_number(value: Optional[float], decimals: int = 2) -> str:
    """Format number with thousand separators."""
    if value is None:
        return "N/A"
    
    if abs(value) >= 1_000_000_000:
        return f"{value / 1_000_000_000:.{decimals}f}B"
    elif abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.{decimals}f}M"
    elif abs(value) >= 1_000:
        return f"{value / 1_000:.{decimals}f}K"
    else:
        return f"{value:.{decimals}f}"


def format_percent(value: Optional[float], decimals: int = 2) -> str:
    """Format percentage with sign."""
    if value is None:
        return "N/A"
    
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.{decimals}f}%"


def calculate_change(current: Optional[float], previous: Optional[float]) -> dict:
    """Calculate change amount and percentage."""
    if current is None or previous is None or previous == 0:
        return {
            'change': None,
            'change_percent': None
        }
    
    change = current - previous
    change_percent = (change / previous) * 100
    
    return {
        'change': round(change, 4),
        'change_percent': round(change_percent, 2)
    }


def parse_volume(value) -> int:
    """
    تحويل قيمة الحجم إلى رقم صحيح
    """
    if value is None:
        return 0
    
    if isinstance(value, (int, float)):
        return int(value)
    
    try:
        s = str(value).strip().upper().replace('\u202f', '').replace(' ', '').replace(',', '')
        mult = 1.0
        for suffix, m in (('K', 1e3), ('M', 1e6), ('B', 1e9)):
            if suffix in s:
                mult = m
                s = s.replace(suffix, '')
                break
        clean_num = re.sub(r'[^\d.]', '', s)
        return int(float(clean_num) * mult) if clean_num else 0
    except Exception:
        return 0
