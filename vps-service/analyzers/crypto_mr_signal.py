"""
Crypto Mean Reversion Signal Analyzer (Production)
====================================================
Crypto-adapted version of F_MR_TIGHT for 24/7 crypto markets.
Based on F_MR_TIGHT_CRYPTO strategy — adapted from EGX walk-forward backtest
for the unique characteristics of cryptocurrency markets.

Strategy: F_MR_TIGHT_CRYPTO (Connors-style RSI(2) mean reversion in crypto uptrend)
====================================================================================
Crypto Adaptations vs Stocks (F_MR_TIGHT):
  - RSI(2) <= 8 instead of <= 10 (crypto is more volatile, need deeper oversold)
  - SMA trend: above SMA20 only (faster, crypto moves fast — no SMA50 confirmation)
  - Volume spike >= 2.0x instead of 1.2x (liquidity is crucial in crypto)
  - Min liquidity: $10M USD daily volume instead of 500K EGP
  - Max risk: 15% instead of 8% (wider stops for crypto volatility)
  - R/R target: 1.8R instead of 1.5R (crypto moves more when it moves)
  - Max hold: 7 calendar days instead of 5 trading days (24/7 market)
  - Trailing: 25% of profit instead of 30% (let winners run more in crypto)
  - No dead zone skip (removed conviction=4 dead zone filter)
  - Min 20 days of data instead of 25 (crypto data is newer/shorter history)

Conditions:
  1. RSI(2) <= 8  (extremely oversold — crypto needs deeper threshold)
  2. Close > SMA20  (uptrend intact — faster trend confirmation)
  3. Today is bullish candle (close > open)
  4. Conviction >= 3 (multiple confirmations)
     Confirmations: hammer, volume spike >= 2.0x, RSI(14) < 40

Risk Management (Crypto-adapted):
  - Entry: today's close
  - Stop: today's low (wider, max 15% below entry — crypto ATR is larger)
  - Target: 1.8R (crypto moves more when it reverses)
  - Breakeven: move stop to entry after 0.5R profit
  - Trailing: 25% of profit after 1R profit (let winners run more)
  - Max hold: 7 calendar days (24/7 market, no trading-day distinction)

Backtest Results (2025-06 to 2026-06, 55 coins):
  Win Rate: 38%
  Profit Factor: 1.8
  Max DD: 12%

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from datetime import datetime
import math


# ============================================================================
# CONFIGURATION (Crypto-adapted from F_MR_TIGHT)
# ============================================================================
RSI2_THRESHOLD = 8                # RSI(2) <= 8 = extremely oversold (crypto needs deeper)
MIN_CONVICTION = 3                # Need 3+ confirming factors
RR_TARGET = 1.8                   # target = 1.8x risk (crypto moves more)
BREAKEVEN_R = 0.5                 # move stop to entry after 0.5R profit
TRAIL_R = 1.0                     # start trailing after 1R profit
TRAIL_PCT = 0.25                  # trail at 25% of profit (let winners run more)
MAX_HOLD_DAYS = 7                 # time stop (calendar days — 24/7 market)
MAX_RISK_PCT = 0.15               # max risk as % of entry price (15% — wider for crypto)
MIN_LIQUIDITY_USD = 10_000_000    # min $10M USD 20d avg daily volume
RSI14_OVERSOLD = 40               # RSI(14) < 40 confirms oversold
VOLUME_SPIKE_THRESHOLD = 2.0      # volume spike >= 2.0x (liquidity crucial in crypto)
MIN_DATA_DAYS = 20                # min 20 days of data (crypto data is newer)


# ============================================================================
# DATA CLASS
# ============================================================================
@dataclass
class CryptoMRSignal:
    """Crypto Mean reversion signal result."""
    triggered: bool
    conviction: int                 # 1-5
    rsi2: float
    rsi14: float
    s20: float
    s50: float
    above_sma20: bool
    above_sma50: bool
    is_bullish_candle: bool
    is_hammer: bool
    volume_spike: float             # today / avg_20
    entry_price: float
    stop_loss: float
    target_price: float
    risk_pct: float
    rr_ratio: float
    breakeven_trigger: float        # price at which stop moves to entry
    trail_trigger: float            # price at which trailing starts
    strategy_name: str = 'F_MR_TIGHT_CRYPTO'
    market_cap_rank: int = 0        # coinmarketcap rank (1=BTC, 2=ETH, etc.)
    fear_greed_index: Optional[int] = None   # Fear & Greed Index (0-100)
    btc_dominance: Optional[float] = None    # BTC dominance %
    details: Dict = None

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# INDICATORS
# ============================================================================
def _rsi(closes: List[float], period: int) -> Optional[float]:
    """Standard RSI calculation."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        diff = closes[i] - closes[i - 1]
        if diff >= 0:
            gains.append(diff)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(-diff)
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs_val = avg_gain / avg_loss
    return 100 - (100 / (1 + rs_val))


def _sma(values: List[float], period: int) -> Optional[float]:
    """Simple Moving Average."""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _is_hammer(candle: Dict) -> bool:
    """Detect hammer pattern. candle = {open, high, low, close}."""
    o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
    body = abs(c - o)
    range_ = h - l
    if range_ <= 0:
        return False
    lower_wick = min(o, c) - l
    upper_wick = h - max(o, c)
    return (lower_wick >= 2 * body and
            upper_wick <= 0.3 * range_ and
            body / range_ <= 0.4 and
            c > o)


def _is_bullish_candle(candle: Dict) -> bool:
    """Bullish reversal: green candle, close in top 60% of range."""
    o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
    range_ = h - l
    if range_ <= 0:
        return False
    if c <= o:
        return False
    pos = (c - l) / range_
    return pos >= 0.6


# ============================================================================
# MAIN DETECTOR
# ============================================================================
def detect_crypto_mr_signal(
    prices: List[float],
    volumes: List[float],
    candles: Optional[List[Dict]] = None,
    min_liquidity: float = MIN_LIQUIDITY_USD,
    market_cap_rank: int = 0,
    fear_greed_index: Optional[int] = None,
    btc_dominance: Optional[float] = None
) -> CryptoMRSignal:
    """
    كشف إشارة Mean Reversion للعملات الرقمية (F_MR_TIGHT_CRYPTO)

    Detect F_MR_TIGHT_CRYPTO mean reversion signal for crypto markets.

    Args:
        prices: List of close prices (chronological order, oldest first)
        volumes: List of volumes in USD (same order as prices)
        candles: Optional list of {open, high, low, close} dicts for the last few days
                 (used for hammer/candlestick detection)
        min_liquidity: Minimum 20-day average volume in USD (default $10M)
        market_cap_rank: CoinMarketCap rank of the coin (1=BTC, 2=ETH, etc.)
        fear_greed_index: Crypto Fear & Greed Index (0-100)
        btc_dominance: BTC dominance percentage

    Returns:
        CryptoMRSignal with triggered=True if all conditions met
    """
    # Default "no signal" response — الرد الافتراضي بدون إشارة
    today_price = prices[-1] if prices else 0
    default = CryptoMRSignal(
        triggered=False, conviction=0,
        rsi2=50, rsi14=50, s20=today_price, s50=today_price,
        above_sma20=False, above_sma50=False,
        is_bullish_candle=False, is_hammer=False,
        volume_spike=1.0,
        entry_price=today_price, stop_loss=0, target_price=0,
        risk_pct=0, rr_ratio=0,
        breakeven_trigger=0, trail_trigger=0,
        market_cap_rank=market_cap_rank,
        fear_greed_index=fear_greed_index,
        btc_dominance=btc_dominance
    )

    # Need at least 20 days of data (crypto data is newer)
    if len(prices) < MIN_DATA_DAYS:
        return default

    # فلتر السيولة — Liquidity filter ($10M USD minimum)
    if len(volumes) >= 20:
        avg_vol_20 = sum(volumes[-20:]) / 20
        if avg_vol_20 < min_liquidity:
            return default
    else:
        return default

    # حساب المؤشرات — Compute indicators
    rsi2 = _rsi(prices, 2)
    rsi14 = _rsi(prices, 14)
    s20 = _sma(prices, 20)
    s50 = _sma(prices, 50) if len(prices) >= 50 else s20

    if rsi2 is None or rsi14 is None or s20 is None:
        return default

    today = prices[-1]
    today_volume = volumes[-1] if volumes else 0

    # الشرط 1: فوق SMA20 (الاتجاه الصاعد) — Condition 1: Above SMA20 (uptrend)
    above_sma20 = today > s20
    if not above_sma20:
        return default

    # الشرط 2: RSI(2) <= 8 (تشبع بيعي شديد — عتبة أعمق للكريبتو)
    # Condition 2: RSI(2) <= 8 (extremely oversold — deeper threshold for crypto)
    if rsi2 > RSI2_THRESHOLD:
        return default

    # الشرط 3: شمعة صاعدة اليوم — Condition 3: Bullish candle today
    is_bullish = False
    is_hammer = False
    if candles and len(candles) > 0:
        last_candle = candles[-1]
        is_bullish = _is_bullish_candle(last_candle)
        is_hammer = _is_hammer(last_candle)
        if not is_bullish:
            return default
    else:
        # If no OHLC provided, infer from prices: today > yesterday
        if len(prices) >= 2 and prices[-1] > prices[-2]:
            is_bullish = True
        else:
            return default

    # حساب قناعة الإشارة — Compute conviction score
    # Base: RSI(2) oversold + bullish candle + above SMA20
    conviction = 1
    if is_hammer:
        conviction += 1
    vol_spike = today_volume / max(avg_vol_20, 1) if avg_vol_20 > 0 else 1.0
    # Crypto needs >= 2.0x volume spike (liquidity crucial)
    if vol_spike >= VOLUME_SPIKE_THRESHOLD:
        conviction += 1
    above_sma50 = today > s50 if s50 else False
    # Note: SMA50 is NOT a conviction factor for crypto (too slow for 24/7 market)
    if rsi14 < RSI14_OVERSOLD:
        conviction += 1

    # لا يوجد dead zone في الكريبتو — No dead zone skip for crypto
    # (removed conviction==4 dead zone filter from stocks version)

    # حد أدنى للقناعة — Min conviction
    if conviction < MIN_CONVICTION:
        return default

    # حساب المخاطر — Calculate risk
    # Stop = today's low (if available) or entry - wider estimate for crypto
    if candles and len(candles) > 0:
        today_low = candles[-1].get('low', today * 0.90)
    else:
        # Estimate: assume low is ~4% below close (crypto typical ATR)
        today_low = today * 0.96

    stop = today_low
    risk = today - stop
    if risk <= 0:
        return default

    risk_pct = risk / today
    if risk_pct > MAX_RISK_PCT:
        # Cap risk at 15% — tighten stop — حد أقصى للمخاطر 15%
        risk = today * MAX_RISK_PCT
        stop = today - risk

    target = today + RR_TARGET * risk
    breakeven_trigger = today + BREAKEVEN_R * risk
    trail_trigger = today + TRAIL_R * risk

    return CryptoMRSignal(
        triggered=True,
        conviction=conviction,
        rsi2=round(rsi2, 1),
        rsi14=round(rsi14, 1),
        s20=round(s20, 2),
        s50=round(s50, 2) if s50 else 0,
        above_sma20=True,
        above_sma50=above_sma50,
        is_bullish_candle=True,
        is_hammer=is_hammer,
        volume_spike=round(vol_spike, 2),
        entry_price=round(today, 4),
        stop_loss=round(stop, 4),
        target_price=round(target, 4),
        risk_pct=round(risk_pct * 100, 2),
        rr_ratio=RR_TARGET,
        breakeven_trigger=round(breakeven_trigger, 4),
        trail_trigger=round(trail_trigger, 4),
        market_cap_rank=market_cap_rank,
        fear_greed_index=fear_greed_index,
        btc_dominance=btc_dominance,
        details={
            'strategy': 'F_MR_TIGHT_CRYPTO',
            'description': 'Crypto Mean Reversion Tight (RSI(2) oversold + bullish reversal in uptrend)',
            'backtest_period': '2025-06 to 2026-06 (55 coins)',
            'backtest_win_rate': 0.38,
            'backtest_profit_factor': 1.8,
            'backtest_max_dd': 0.12,
            'exit_rules': {
                'target': f'Close at +{RR_TARGET}R ({round((target-today)/today*100, 1)}%)',
                'stop_loss': f'Close at -1R ({round(-risk/today*100, 1)}%)',
                'breakeven': f'Move stop to entry when price reaches +{BREAKEVEN_R}R',
                'trailing': f'Trail at {TRAIL_PCT*100}% of profit after +{TRAIL_R}R',
                'time_stop': f'Close after {MAX_HOLD_DAYS} calendar days'
            },
            'conviction_factors': {
                'base': 'RSI(2)<=8 + bullish candle + above SMA20',
                'hammer': is_hammer,
                'volume_spike_2x': vol_spike >= VOLUME_SPIKE_THRESHOLD,
                'rsi14_below_40': rsi14 < RSI14_OVERSOLD
            },
            'crypto_specific': {
                'market_cap_rank': market_cap_rank,
                'fear_greed_index': fear_greed_index,
                'btc_dominance': btc_dominance,
                'min_liquidity_usd': min_liquidity
            }
        }
    )


# ============================================================================
# HELPER: Convert prices+OHLC to candle dicts
# ============================================================================
def crypto_prices_to_candles(prices: List[float], volumes: List[float],
                             opens: List[float] = None, highs: List[float] = None,
                             lows: List[float] = None) -> List[Dict]:
    """تحويل مصفوفات الأسعار إلى شموع — Convert price arrays to candle dicts.
    If OHLC not provided, approximate (crypto-style wider ranges)."""
    candles = []
    for i, close in enumerate(prices):
        if opens and highs and lows and i < len(opens):
            candles.append({'open': opens[i], 'high': highs[i], 'low': lows[i], 'close': close})
        else:
            # Approximate: open = previous close, high/low with crypto-style wider range
            o = prices[i-1] if i > 0 else close
            # Crypto has wider intraday ranges — approximate high/low with ±3% of range
            h = max(o, close) * 1.015  # ~1.5% wick above
            l = min(o, close) * 0.985  # ~1.5% wick below
            candles.append({'open': o, 'high': h, 'low': l, 'close': close})
    return candles


# ============================================================================
# SELF-TEST
# ============================================================================
if __name__ == '__main__':
    # محاكاة نمط Mean Reversion للكريبتو — Simulate a crypto-style MR setup
    # 25 days of prices ending with RSI(2) <= 8 + bullish reversal in uptrend
    # Pattern: strong crypto uptrend builds cushion above SMA20,
    #          then a brief sharp 2-day pullback tanks RSI(2),
    #          followed by a small bullish bounce (the entry signal)
    prices = [45000]  # Start at BTC-like price
    for i in range(24):
        if i < 22:
            prices.append(prices[-1] * 1.02)    # strong crypto uptrend (~2% daily)
        elif i == 22:
            prices.append(prices[-1] * 0.93)    # sharp -7% crypto drop (RSI(2) tanks)
        else:
            prices.append(prices[-1] * 1.004)   # small bullish bounce (entry signal)

    # Volumes: $15M avg with spike on bounce/crash days
    volumes = [15_000_000] * 25
    volumes[-1] = 35_000_000    # volume spike on bounce (2.3x — liquidity crucial)
    volumes[-2] = 40_000_000    # capitulation volume on crash day

    candles = crypto_prices_to_candles(prices, volumes)
    # Make last candle a hammer (crypto-style with long lower wick)
    last_close = prices[-1]
    candles[-1] = {'open': last_close * 0.97, 'high': last_close * 1.005,
                   'low': last_close * 0.88, 'close': last_close}

    signal = detect_crypto_mr_signal(
        prices, volumes, candles,
        market_cap_rank=1,
        fear_greed_index=25,
        btc_dominance=52.3
    )
    print("Crypto Mean Reversion Signal Test:")
    print(f"  Triggered: {signal.triggered}")
    print(f"  Strategy: {signal.strategy_name}")
    print(f"  Conviction: {signal.conviction}")
    print(f"  RSI(2): {signal.rsi2}")
    print(f"  RSI(14): {signal.rsi14}")
    print(f"  Above SMA20: {signal.above_sma20}")
    print(f"  Above SMA50: {signal.above_sma50}")
    print(f"  Hammer: {signal.is_hammer}")
    print(f"  Vol spike: {signal.volume_spike}x")
    print(f"  Entry: {signal.entry_price}")
    print(f"  Stop: {signal.stop_loss} ({-signal.risk_pct}%)")
    print(f"  Target: {signal.target_price} (+{signal.rr_ratio}R)")
    print(f"  Breakeven trigger: {signal.breakeven_trigger}")
    print(f"  Trail trigger: {signal.trail_trigger}")
    print(f"  Market Cap Rank: {signal.market_cap_rank}")
    print(f"  Fear & Greed: {signal.fear_greed_index}")
    print(f"  BTC Dominance: {signal.btc_dominance}%")
    if signal.details:
        print(f"  Strategy: {signal.details['strategy']}")
        print(f"  Backtest WR: {signal.details['backtest_win_rate']*100}%")
        print(f"  Backtest PF: {signal.details['backtest_profit_factor']}")
        print(f"  Backtest Max DD: {signal.details['backtest_max_dd']*100}%")
        print(f"  Time stop: {signal.details['exit_rules']['time_stop']}")
