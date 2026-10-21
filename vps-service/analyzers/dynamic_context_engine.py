"""
Dynamic Market Context Engine (مزود سياق السوق الديناميكي)
=============================================================
DYNAMIC-SYSTEM-001: يحسب "سياق السوق اللحظي" قبل أي تحليل للسهم.

الفلسفة: أي رقم في الكود لازم يتحسب كنسبة من حالة السهم/السوق في اللحظة دي،
مش كرقم ثابت. السياق ده بيتحسب من آخر 20 يوم تداول وبيطلع:

  - dynamic_volatility: متوسط تذبذب السهم (ATR%) — عشان نحدد وقف خسارة ديناميكي
  - avg_volume_baseline: متوسط حجم التداول الطبيعي للسهم ده بالذات
  - avg_turnover_baseline: متوسط السيولة اليومية الطبيعية للسهم
  - market_regime: هل السوق كله هادي (calm) ولا صاخب (busy)؟ (من EGX30 تذبذب)
  - trend_strength: قوة ترند السهم (0..1) — عشان نعدّل عتبات RSI

الـ context ده بيتغذّى لكل الفلاتر والمحركات:
  - liquidity_filter: بيستخدم avg_turnover_baseline عشان يحسب نسبة السيولة
  - master_analyzer: بيستخدم market_regime + trend_strength لـ RSI/volume ديناميكي
  - dynamic_target_engine: بيستخدم dynamic_volatility لـ stop loss ديناميكي

Usage:
    from analyzers.dynamic_context_engine import get_dynamic_context
    ctx = get_dynamic_context('COMI')
    if ctx.turnover_ratio < 0.5:  # سيولة < 50% من المتوسط
        score -= 10  # عقاب
"""

from __future__ import annotations

import sqlite3
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional, Tuple
from datetime import datetime

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")
PRICE_HISTORY_DB = str(_PROJECT_ROOT / "db" / "price_history.db")

# In-memory cache (TTL = 5 minutes) — عشان ما نقرأش الـ DB في كل analyze()
_CACHE_TTL = 300  # seconds
_cache_lock = __import__('threading').Lock()
_cache: Dict[str, Tuple["DynamicContext", float]] = {}


@dataclass
class DynamicContext:
    """سياق السوق الديناميكي لسهم معيّن."""
    ticker: str
    # ── متوسطات السهم نفسه (baseline) ──
    avg_volume_baseline: float = 0.0       # متوسط حجم التداول (20 يوم)
    avg_turnover_baseline: float = 0.0     # متوسط السيولة اليومية (20 يوم)
    avg_close_price: float = 0.0           # متوسط سعر الإغلاق (20 يوم)
    # ── تذبذب السهم ──
    dynamic_volatility: float = 0.0        # ATR كنسبة من السعر (%) — لـ stop loss ديناميكي
    atr_value: float = 0.0                 # قيمة ATR المطلقة
    # ── القيم اللحظية ──
    current_volume: float = 0.0            # حجم اليوم
    current_turnover: float = 0.0          # سيولة اليوم
    current_price: float = 0.0
    # ── نسب الديناميكية (0..1 أو أكتر) ──
    volume_ratio: float = 1.0              # current_volume / avg_volume_baseline
    turnover_ratio: float = 1.0            # current_turnover / avg_turnover_baseline
    # ── ترند السهم ──
    trend_strength: float = 0.0            # 0..1 (0 = لا ترند، 1 = ترند قوي)
    trend_direction: str = 'neutral'       # 'up' / 'down' / 'neutral'
    # ── سياق السوق كله ──
    market_regime: str = 'range'           # 'bull' / 'bear' / 'range'
    market_volatility_pct: float = 0.0     # تذبذب EGX30 (%) — عشان نحدد calm/busy
    # ── metadata ──
    has_history: bool = False              # هل فيه بيانات تاريخية كافية؟
    data_points: int = 0                   # كم شمعة متاحة
    computed_at: str = ''

    def to_dict(self) -> Dict:
        return {
            'ticker': self.ticker,
            'avg_volume_baseline': round(self.avg_volume_baseline, 0),
            'avg_turnover_baseline': round(self.avg_turnover_baseline, 2),
            'avg_close_price': round(self.avg_close_price, 4),
            'dynamic_volatility_pct': round(self.dynamic_volatility, 2),
            'atr_value': round(self.atr_value, 4),
            'current_volume': round(self.current_volume, 0),
            'current_turnover': round(self.current_turnover, 2),
            'current_price': round(self.current_price, 4),
            'volume_ratio': round(self.volume_ratio, 2),
            'turnover_ratio': round(self.turnover_ratio, 2),
            'trend_strength': round(self.trend_strength, 2),
            'trend_direction': self.trend_direction,
            'market_regime': self.market_regime,
            'market_volatility_pct': round(self.market_volatility_pct, 2),
            'has_history': self.has_history,
            'data_points': self.data_points,
            'computed_at': self.computed_at,
        }


# ──────────────────────────────────────────────────────────────────────────
# DB Helpers
# ──────────────────────────────────────────────────────────────────────────

def _load_price_history(ticker: str, days: int = 20) -> list:
    """حمّل آخر N يوم من price_history.db للسهم."""
    try:
        if not Path(PRICE_HISTORY_DB).exists():
            return []
        conn = sqlite3.connect(PRICE_HISTORY_DB, timeout=10.0)
        cur = conn.execute(
            """SELECT date, high_price, low_price, close_price, volume
               FROM price_history
               WHERE ticker = ?
               ORDER BY date DESC
               LIMIT ?""",
            (ticker, days),
        )
        rows = cur.fetchall()
        conn.close()
        # rows مرتبة DESC (الأحدث أول) — نعكسها لـ ASC للحسابات
        return list(reversed(rows))
    except sqlite3.Error as e:
        logger.debug("price_history load failed for %s: %s", ticker, e)
        return []


def _load_current_stock_data(ticker: str) -> Dict:
    """حمّل السعر والحجم الحالي من stocks.db."""
    try:
        conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
        cur = conn.execute(
            "SELECT current_price, volume, value_traded, turnover_egp FROM stocks WHERE ticker = ?",
            (ticker,),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return {}
        return {
            'current_price': float(row[0]) if row[0] else 0.0,
            'volume': float(row[1]) if row[1] else 0.0,
            'value_traded': float(row[2]) if row[2] else 0.0,
            'turnover_egp': float(row[3]) if row[3] else 0.0,
        }
    except (sqlite3.Error, ValueError, TypeError) as e:
        logger.debug("stocks load failed for %s: %s", ticker, e)
        return {}


def _load_market_volatility() -> Tuple[float, str]:
    """
    حمّل تذبذب السوق كله من EGX30.
    Returns: (volatility_pct, regime) — regime = 'bull'/'bear'/'range'
    """
    try:
        conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
        # جرّب market_indices أو stocks (لو EGX30 موجود كـ ticker)
        cur = conn.execute(
            """SELECT current_value, previous_close, change_percent
               FROM market_indices
               WHERE symbol LIKE '%EGX30%' OR name LIKE '%EGX30%'
               ORDER BY last_updated DESC LIMIT 1"""
        )
        row = cur.fetchone()
        conn.close()
        if row and row[0] and row[1]:
            current = float(row[0])
            prev = float(row[1])
            change_pct = abs(float(row[2])) if row[2] else abs((current - prev) / prev * 100) if prev > 0 else 0
            # regime: لو change > +1% → bull، لو < -1% → bear، else range
            net_change = float(row[2]) if row[2] else ((current - prev) / prev * 100) if prev > 0 else 0
            if net_change > 1.0:
                regime = 'bull'
            elif net_change < -1.0:
                regime = 'bear'
            else:
                regime = 'range'
            return (change_pct, regime)
    except (sqlite3.Error, ValueError, TypeError) as e:
        logger.debug("market_indices load failed: %s", e)
    # Fallback: نرجّع range بأقل تذبذب
    return (0.0, 'range')


# ──────────────────────────────────────────────────────────────────────────
# Calculations
# ──────────────────────────────────────────────────────────────────────────

def _calculate_atr(history: list) -> Tuple[float, float]:
    """
    احسب ATR (Average True Range) من الـ history.
    Returns: (atr_value, atr_pct) — atr_pct = ATR كنسبة من آخر سعر (%)

    BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
    Keeps backward-compat fallback (0.0, 0.0) on insufficient data.
    """
    if len(history) < 2:
        return (0.0, 0.0)
    highs = [float(row[1] or 0) for row in history]
    lows = [float(row[2] or 0) for row in history]
    closes = [float(row[3] or 0) for row in history]
    if any(h <= 0 for h in highs) or any(l <= 0 for l in lows) or any(c <= 0 for c in closes):
        # fall back to filtered valid rows
        valid = [(h, l, c) for h, l, c in zip(highs, lows, closes) if h > 0 and l > 0 and c > 0]
        if len(valid) < 2:
            return (0.0, 0.0)
        highs, lows, closes = (list(t) for t in zip(*valid))
    atr = _canonical_calc_atr(highs, lows, closes, period=14)
    if atr is None:
        return (0.0, 0.0)
    last_close = float(history[-1][3] or 0)
    atr_pct = (atr / last_close * 100) if last_close > 0 else 0.0
    return (atr, atr_pct)


def _calculate_trend_strength(history: list) -> Tuple[float, str]:
    """
    احسب قوة الترند (0..1) واتجاهه من الـ history.
    بنستخدم: linear regression slope على الـ closes + R².
    Returns: (strength, direction)
    """
    if len(history) < 5:
        return (0.0, 'neutral')
    closes = [float(r[3] or 0) for r in history if r[3]]
    if len(closes) < 5 or min(closes) <= 0:
        return (0.0, 'neutral')
    n = len(closes)
    x = list(range(n))
    x_mean = sum(x) / n
    y_mean = sum(closes) / n
    # Linear regression: slope + R²
    num_slope = sum((x[i] - x_mean) * (closes[i] - y_mean) for i in range(n))
    den_slope = sum((x[i] - x_mean) ** 2 for i in range(n))
    if den_slope == 0:
        return (0.0, 'neutral')
    slope = num_slope / den_slope
    # R² for strength
    y_pred = [y_mean + slope * (x[i] - x_mean) for i in range(n)]
    ss_res = sum((closes[i] - y_pred[i]) ** 2 for i in range(n))
    ss_tot = sum((closes[i] - y_mean) ** 2 for i in range(n))
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
    # Normalize: strength = max(0, R²) — bounded 0..1
    strength = max(0.0, min(1.0, r_squared))
    # Direction: slope sign relative to mean price
    if slope > 0:
        direction = 'up'
    elif slope < 0:
        direction = 'down'
    else:
        direction = 'neutral'
    return (strength, direction)


def _clean_number(val) -> float:
    if not val: return 0.0
    if isinstance(val, (int, float)): return float(val)
    s = str(val).upper().replace(',', '').replace('\u202F', '').replace(' ', '')
    multiplier = 1.0
    if s.endswith('K'):
        multiplier = 1000.0
        s = s[:-1]
    elif s.endswith('M'):
        multiplier = 1000000.0
        s = s[:-1]
    elif s.endswith('B'):
        multiplier = 1000000000.0
        s = s[:-1]
    try:
        return float(s) * multiplier
    except ValueError:
        return 0.0

def _calculate_baselines(history: List[Tuple]) -> Tuple[float, float, float]:
    """Calculate 30-day baselines for volume, turnover, and close."""
    if not history:
        return 0.0, 0.0, 0.0
        
    recent = history[-30:] if len(history) >= 30 else history
    volumes = [_clean_number(r[4]) for r in recent]
    closes = [_clean_number(r[3]) for r in recent]
    avg_volume = sum(volumes) / len(volumes) if volumes else 0.0
    avg_close = sum(closes) / len(closes) if closes else 0.0
    # turnover = volume * close (تقريبي لو مفيش بيانات turnover فعلية)
    turnovers = [volumes[i] * closes[i] for i in range(len(volumes)) if closes[i] > 0]
    avg_turnover = sum(turnovers) / len(turnovers) if turnovers else 0.0
    return (avg_volume, avg_turnover, avg_close)


# ──────────────────────────────────────────────────────────────────────────
# Main API
# ──────────────────────────────────────────────────────────────────────────

def get_dynamic_context(ticker: str, use_cache: bool = True) -> DynamicContext:
    """
    احسب سياق السوق الديناميكي للسهم.

    Args:
        ticker: رمز السهم
        use_cache: استخدم الكاش (TTL = 5 دقايق)

    Returns:
        DynamicContext dataclass بكل القيم المحسوبة
    """
    # Check cache
    if use_cache:
        with _cache_lock:
            cached = _cache.get(ticker)
            if cached is not None:
                ctx, ts = cached
                if (datetime.now().timestamp() - ts) < _CACHE_TTL:
                    return ctx

    ctx = DynamicContext(ticker=ticker, computed_at=datetime.now().isoformat())

    # 1. Load history (20 days)
    history = _load_price_history(ticker, days=20)
    ctx.data_points = len(history)
    ctx.has_history = len(history) >= 5

    # 2. Calculate baselines from history
    if history:
        avg_vol, avg_turn, avg_close = _calculate_baselines(history)
        ctx.avg_volume_baseline = avg_vol
        ctx.avg_turnover_baseline = avg_turn
        ctx.avg_close_price = avg_close

    # 3. Calculate ATR (volatility)
    if history:
        atr_val, atr_pct = _calculate_atr(history)
        ctx.atr_value = atr_val
        ctx.dynamic_volatility = atr_pct

    # 4. Calculate trend strength + direction
    if history:
        strength, direction = _calculate_trend_strength(history)
        ctx.trend_strength = strength
        ctx.trend_direction = direction

    # 5. Load current stock data
    current = _load_current_stock_data(ticker)
    if current:
        ctx.current_price = current.get('current_price', 0.0)
        ctx.current_volume = current.get('volume', 0.0)
        # turnover: prefer turnover_egp, then value_traded, fallback volume*price
        ctx.current_turnover = (
            current.get('turnover_egp', 0.0)
            or current.get('value_traded', 0.0)
            or (ctx.current_volume * ctx.current_price if ctx.current_price > 0 else 0.0)
        )

    # 6. Calculate ratios (current vs baseline)
    if ctx.avg_volume_baseline > 0:
        ctx.volume_ratio = ctx.current_volume / ctx.avg_volume_baseline
    if ctx.avg_turnover_baseline > 0:
        ctx.turnover_ratio = ctx.current_turnover / ctx.avg_turnover_baseline

    # 7. Market context (EGX30 volatility + regime)
    mkt_vol, regime = _load_market_volatility()
    ctx.market_volatility_pct = mkt_vol
    ctx.market_regime = regime

    # 8. Cache it
    with _cache_lock:
        _cache[ticker] = (ctx, datetime.now().timestamp())

    return ctx


def invalidate_context_cache(ticker: Optional[str] = None) -> None:
    """إفراغ الكاش (لو ticker=None، يمسح الكل)."""
    with _cache_lock:
        if ticker is None:
            _cache.clear()
        else:
            _cache.pop(ticker, None)


# ──────────────────────────────────────────────────────────────────────────
# Convenience helpers — للـ engines اللي بتستهلك الـ context
# ──────────────────────────────────────────────────────────────────────────

def get_liquidity_penalty(ticker: str) -> float:
    """
    احسب عقاب السيولة بناءً على نسبة السيولة الحالية للمتوسط.
    - turnover_ratio >= 0.8 → 0 (لا عقاب)
    - 0.5 <= ratio < 0.8 → -5 درجات (سيولة ضعيفة)
    - 0.1 <= ratio < 0.5 → -10 درجات (سيولة ضعيفة جداً)
    - ratio < 0.1 → رفض تام (يعني -100)
    """
    ctx = get_dynamic_context(ticker)
    if not ctx.has_history:
        return 0.0  # لا نعاقب لو مفيش بيانات تاريخية
    ratio = ctx.turnover_ratio
    if ratio >= 0.8:
        return 0.0
    if ratio >= 0.5:
        return -5.0
    if ratio >= 0.1:
        return -10.0
    return -100.0  # رفض تام


def is_liquidity_dead(ticker: str) -> bool:
    """هل السيولة ميتة تماماً (أقل من 10% من المتوسط)؟"""
    ctx = get_dynamic_context(ticker)
    if not ctx.has_history:
        return False
    return ctx.turnover_ratio < 0.1


def get_volume_surge_bonus(ticker: str) -> float:
    """
    احسب مكافأة الزخم بناءً على نسبة الحجم الحالي للمتوسط.
    - volume_ratio >= 2.0 → +10 درجات (زخم قوي)
    - 1.5 <= ratio < 2.0 → +5 درجات (زخم متوسط)
    - 1.0 <= ratio < 1.5 → +2 درجات (زخم خفيف)
    - < 1.0 → 0
    """
    ctx = get_dynamic_context(ticker)
    if not ctx.has_history:
        return 0.0
    ratio = ctx.volume_ratio
    if ratio >= 2.0:
        return 10.0
    if ratio >= 1.5:
        return 5.0
    if ratio >= 1.0:
        return 2.0
    return 0.0


# ──────────────────────────────────────────────────────────────────────────
# Self-test
# ──────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 70)
    print("🧪 Dynamic Context Engine — اختبار ذاتي")
    print("=" * 70)
    # Test with a sample ticker
    for t in ['COMI', 'ETEL', 'SWDY']:
        print(f"\n📊 {t}:")
        ctx = get_dynamic_context(t)
        print(f"   has_history: {ctx.has_history} ({ctx.data_points} points)")
        print(f"   avg_volume_baseline: {ctx.avg_volume_baseline:,.0f}")
        print(f"   avg_turnover_baseline: {ctx.avg_turnover_baseline:,.0f}")
        print(f"   dynamic_volatility: {ctx.dynamic_volatility:.2f}%")
        print(f"   trend: {ctx.trend_direction} (strength={ctx.trend_strength:.2f})")
        print(f"   market_regime: {ctx.market_regime} (vol={ctx.market_volatility_pct:.2f}%)")
        print(f"   volume_ratio: {ctx.volume_ratio:.2f}x")
        print(f"   turnover_ratio: {ctx.turnover_ratio:.2f}x")
    print("\n" + "=" * 70)
    print("✅ Dynamic Context Engine جاهز")
