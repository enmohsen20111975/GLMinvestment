"""
core/indicators.py — المؤشرات الفنية المشتركة
=============================================
كل المؤشرات مكتوبة بـ pandas/numpy ومتحقّق من صحتها رياضياً.

ملاحظة مهمة (مصدر أخطاء شائع):
    ATR و RSI و ADX لازم يستخدموا Wilder's smoothing (RMA)،
    مش Simple Moving Average. الكتير من المكتبات بتغلط هنا.
    RMA = ewm(alpha=1/period, adjust=False)
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def rolling_max(series: pd.Series, window: int) -> pd.Series:
    """أعلى قيمة في آخر N فترة."""
    return series.rolling(window=window, min_periods=window).max()


def rolling_min(series: pd.Series, window: int) -> pd.Series:
    """أدنى قيمة في آخر N فترة."""
    return series.rolling(window=window, min_periods=window).min()


def percentile_rank(series: pd.Series, window: int = 252) -> pd.Series:
    """
    ترتيب السعر الحالي كنسبة مئوية مقابل آخر `window` فترة.
    يُستخدم لقاعدة Minervini "السهم خلال 25% من أعلى 52 أسبوع".
    """
    def _rank(window_slice: np.ndarray) -> float:
        if len(window_slice) == 0:
            return np.nan
        current = window_slice[-1]
        count_below = np.sum(window_slice < current)
        return (count_below / (len(window_slice) - 1)) * 100.0 if len(window_slice) > 1 else 50.0

    return series.rolling(window=window, min_periods=max(10, window // 4)).apply(_rank, raw=True)


# ──────────────────────────────────────────────────────────────────────────
# True Range + ATR (Wilder)
# ──────────────────────────────────────────────────────────────────────────

def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """
    True Range لكل شمعة:
        TR = max(H - L, |H - prev_C|, |L - prev_C|)
    أول قيمة = H - L (مفيش prev close).
    """
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    # أول صف = H - L فقط (مفيش سابق)
    tr.iloc[0] = high.iloc[0] - low.iloc[0]
    return tr


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """
    Average True Range باستخدام Wilder's smoothing (RMA).

    ATR_t = (ATR_{t-1} × (n-1) + TR_t) / n

    Args:
        df: DataFrame فيه columns: high, low, close
        period: فترة ATR (افتراضي 14 حسب Wilder)

    Returns:
        pd.Series بنفس طول df، أول `period` قيم可能 NaN.
    """
    required = {"high", "low", "close"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame missing required columns: {missing}")

    tr = true_range(df["high"], df["low"], df["close"])
    # Wilder's RMA = ewm(alpha=1/period, adjust=False)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


# ──────────────────────────────────────────────────────────────────────────
# Moving Averages
# ──────────────────────────────────────────────────────────────────────────

def sma(series: pd.Series, period: int) -> pd.Series:
    """Simple Moving Average."""
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


# ──────────────────────────────────────────────────────────────────────────
# RSI (Wilder)
# ──────────────────────────────────────────────────────────────────────────

def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """
    Relative Strength Index بطريقة Wilder الأصلية.

    RSI = 100 - (100 / (1 + RS))
    RS = avg_gain / avg_loss  (بـ Wilder's smoothing)
    """
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)

    # Wilder's smoothing للمكسب والخسارة
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi_val = 100.0 - (100.0 / (1.0 + rs))
    # لو avg_loss = 0 (صعود مستمر) → RSI = 100
    rsi_val = rsi_val.where(avg_loss > 0, 100.0)
    # لو avg_gain = 0 (هبوط مستمر) → RSI = 0
    rsi_val = rsi_val.where(avg_gain > 0, 0.0)
    return rsi_val


# ──────────────────────────────────────────────────────────────────────────
# Donchian Channels (Turtle / Covel)
# ──────────────────────────────────────────────────────────────────────────

def donchian_channels(
    df: pd.DataFrame,
    entry_period: int = 20,
    exit_period: int = 10,
) -> pd.DataFrame:
    """
    قنوات دونشيان — استراتيجية Turtles الأصلية.

    - entry_period (20): اختراق أعلى 20 شمعة = إشارة دخول
    - exit_period (10): كسر أدنى 10 شمعة = خروج
    - القناة محسوبة WITHOUT الشمعة الحالية (shift 1) عشان نتجنب
      الإشارة اللي تشير لنفسها (self-referencing).

    Returns:
        DataFrame فيه: dc_upper, dc_lower, dc_mid, dc_exit_low
    """
    upper = df["high"].rolling(window=entry_period).max().shift(1)
    lower = df["low"].rolling(window=entry_period).min().shift(1)
    mid = (upper + lower) / 2.0
    exit_low = df["low"].rolling(window=exit_period).min().shift(1)

    return pd.DataFrame(
        {
            "dc_upper": upper,
            "dc_lower": lower,
            "dc_mid": mid,
            "dc_exit_low": exit_low,
        },
        index=df.index,
    )


# ──────────────────────────────────────────────────────────────────────────
# ADX (trend strength) — Wilder
# ──────────────────────────────────────────────────────────────────────────

def adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """
    Average Directional Index — قوة الاتجاه (مش اتجاهه).

    ADX > 25  → اتجاه قوي
    ADX < 20  → سوق جانبي

    Returns:
        DataFrame فيه: adx, plus_di, minus_di
    """
    high, low, close = df["high"], df["low"], df["close"]

    # Directional Movement
    up_move = high.diff()
    down_move = -low.diff()

    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0),
                        index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0),
                         index=df.index)

    tr = true_range(high, low, close)

    # Wilder's smoothing
    atr_ = tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    plus_dm_smooth = plus_dm.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    minus_dm_smooth = minus_dm.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()

    plus_di = 100.0 * plus_dm_smooth / atr_.replace(0.0, np.nan)
    minus_di = 100.0 * minus_dm_smooth / atr_.replace(0.0, np.nan)

    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    adx_val = dx.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()

    return pd.DataFrame(
        {"adx": adx_val, "plus_di": plus_di, "minus_di": minus_di},
        index=df.index,
    )


# ──────────────────────────────────────────────────────────────────────────
# Convenience: full indicator snapshot for the latest bar
# ──────────────────────────────────────────────────────────────────────────

def latest_snapshot(df: pd.DataFrame) -> dict[str, float]:
    """
    لقطة بآخر قيم المؤشرات — مفيدة للـ logging والـ debugging.
    """
    snap: dict[str, float] = {}
    snap["atr_14"] = float(atr(df, 14).iloc[-1])
    snap["sma_50"] = float(sma(df["close"], 50).iloc[-1])
    snap["sma_200"] = float(sma(df["close"], 200).iloc[-1])
    snap["ema_20"] = float(ema(df["close"], 20).iloc[-1])
    snap["rsi_14"] = float(rsi(df["close"], 14).iloc[-1])
    dc = donchian_channels(df)
    snap["dc_upper_20"] = float(dc["dc_upper"].iloc[-1])
    snap["dc_lower_20"] = float(dc["dc_lower"].iloc[-1])
    adx_df = adx(df)
    snap["adx_14"] = float(adx_df["adx"].iloc[-1])
    snap["pct_rank_252"] = float(percentile_rank(df["close"], 252).iloc[-1])
    return snap
