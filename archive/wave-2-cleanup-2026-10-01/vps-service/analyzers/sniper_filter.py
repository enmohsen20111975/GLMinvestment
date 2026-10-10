"""
SniperFilter — مصفى القناص (EGX-Optimized v3.0 — Trend-Following + EGX30 Filter)
===========================
6 بوابات تسلسلية لتصفية 260 سهم EGX لـ 2-5 فرص يومياً.

البوابات (Trend-Following + EGX30 Regime):
  Gate 0: نظام السوق EGX30 — Stage 4 (Bear) = رفض، Stage 2 (Bull) = قبول
  Gate 1: السيولة — حجم ≥ 500K سهم أو قيمة ≥ 2M جنيه (EGX-optimized)
  Gate 2: الاتجاه — سعر فوق SMA-50 + ADX > 25 + SMA-20 > SMA-50 (golden alignment)
  Gate 3: الاختراق — اختراق أعلى قناة 55 يوم (Donchian) أو ضمن 2% من أعلى قناة
  Gate 4: المخاطرة/العائد — ATR × SL_mult / Entry < 15% AND ATR × trail_mult / Entry > 5%
  Gate 5: التأكيد — نمط شموع صاعد + ارتفاع حجم ≥ 1.5x (breakout conviction)

فلسفة Trend-Following:
  - لا نشتري عند الدعم (mean-reversion) — نشتري عند الاختراق فقط
  - لا نحدد هدف ربح ثابت — trailing stop يتبع الاتجاه
  - ADX > 25 يضمن اتجاه قوي
  - EGX30 regime يحدد بيئة السوق الكلية

نتائج الاختبار السابقة (Mean-Reversion v2.0):
  Strategy D (ATR 2× + R/R≥2.5): PF=1.97, WR=79.5%, OOS PF=2.4
  Strategy E (ATR 1.5× + Resistance): PF=1.87, WR=69.2%, OOS PF=1.75

الفلسفة: بوابات تسلسلية — أول بوابة تفشل = خروج فوري (short-circuit)
"""

from __future__ import annotations
import sqlite3
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')


@dataclass
class FilterResult:
    """نتيجة التصفية لسهم واحد"""
    ticker: str
    market: str
    passed: bool
    gate_0_egx30_regime: bool
    gate_1_liquidity: bool
    gate_2_trend: bool
    gate_3_sr: bool
    gate_4_rr: bool
    gate_5_confirmation: bool
    gates_passed: int
    fail_reason: str  # First gate that failed, or '' if all passed
    volume: float
    value_traded: float
    price: float
    sma20: Optional[float]
    sma50: Optional[float]
    adx: Optional[float]
    donchian_high: Optional[float]
    atr: Optional[float]
    support: Optional[float]
    resistance: Optional[float]
    risk_reward: float
    volume_ratio: float
    candlestick_direction: str
    egx30_stage: str  # 'bull', 'bear', 'transition', or 'unknown'

    def to_dict(self) -> Dict:
        from dataclasses import asdict
        return asdict(self)


@dataclass
class FilterReport:
    """تقرير التصفية الكامل"""
    market: str
    total_stocks: int
    passed_filter: int
    results: List[FilterResult] = field(default_factory=list)
    gate_stats: Dict = field(default_factory=dict)  # {gate_name: {passed: N, failed: N}}
    egx30_stage: str = 'unknown'  # Market regime stage

    @property
    def top_opportunities(self) -> List[FilterResult]:
        """Get stocks that passed all 6 gates"""
        return [r for r in self.results if r.passed]


class SniperFilter:
    """مصفى القناص — 6 بوابات تسلسلية (Trend-Following + EGX30 Regime)"""

    # ATR stop-loss and trailing multiplier defaults
    SL_MULT = 2.0       # Stop-loss = ATR × SL_MULT
    TRAIL_MULT = 3.0    # Trailing stop room = ATR × TRAIL_MULT

    def __init__(self, stocks_db=None, data_engine_db=None, price_history_db=None):
        self.stocks_db = stocks_db or STOCKS_DB
        self.data_engine_db = data_engine_db or DATA_ENGINE_DB
        self.price_history_db = price_history_db or PRICE_HISTORY_DB
        # EGX30 regime cache: {(date_str): (stage, sma200, sma50, close)}
        self._egx30_cache: Optional[Dict] = None

    def _conn(self, db_path: str) -> sqlite3.Connection:
        c = sqlite3.connect(db_path, timeout=15.0)
        c.row_factory = sqlite3.Row
        return c

    # --- Gate 0: EGX30 Market Regime (NEW) ---
    def _load_egx30_regime(self) -> Dict:
        """Load EGX30 data and determine market regime.
        Returns dict with: stage, sma200, sma50, close, date
        """
        if self._egx30_cache is not None:
            return self._egx30_cache

        result = {
            'stage': 'unknown',
            'sma200': None,
            'sma50': None,
            'close': None,
            'date': None,
        }

        try:
            conn = self._conn(self.price_history_db)
            rows = conn.execute(
                "SELECT date, close_price FROM price_history "
                "WHERE ticker='EGX30' ORDER BY date DESC LIMIT 250"
            ).fetchall()
            conn.close()

            if not rows:
                logger.warning("No EGX30 data found in price_history.db")
                self._egx30_cache = result
                return result

            closes = [float(r['close_price']) for r in reversed(rows)]
            latest_date = rows[0]['date']  # Most recent date (DESC order)

            result['date'] = latest_date
            result['close'] = closes[-1]

            # SMA(200)
            if len(closes) >= 200:
                result['sma200'] = round(sum(closes[-200:]) / 200, 4)
            # SMA(50)
            if len(closes) >= 50:
                result['sma50'] = round(sum(closes[-50:]) / 50, 4)

            close = result['close']
            sma200 = result['sma200']
            sma50 = result['sma50']

            # Determine regime stage
            if sma200 is not None and sma50 is not None:
                if close < sma200:
                    # Below 200-SMA = Stage 4 (Bear market)
                    result['stage'] = 'bear'
                elif close > sma200 and sma50 > sma200:
                    # Above 200-SMA AND 50-SMA > 200-SMA = Stage 2 (Bull market)
                    result['stage'] = 'bull'
                else:
                    # Above 200-SMA but 50-SMA < 200-SMA = Stage 1/3 (Transition)
                    result['stage'] = 'transition'
            elif sma200 is not None:
                # Only have SMA200
                if close < sma200:
                    result['stage'] = 'bear'
                else:
                    result['stage'] = 'transition'
            else:
                # Not enough data for regime detection
                result['stage'] = 'unknown'

            logger.info(
                f"EGX30 regime: stage={result['stage']}, close={close}, "
                f"SMA200={sma200}, SMA50={sma50}"
            )

        except Exception as e:
            logger.error(f"Error loading EGX30 regime: {e}")

        self._egx30_cache = result
        return result

    def gate_egx30_regime(self) -> Tuple[bool, str]:
        """Gate 0: Check EGX30 market regime.
        Stage 4 (Bear) = REJECT (no trades)
        Stage 2 (Bull) = PROCEED (full trades)
        Stage 1/3 (Transition) = PROCEED with caution (still pass gate)
        Unknown = PROCEED (no data, don't block)

        Returns: (passed, stage_name)
        """
        regime = self._load_egx30_regime()
        stage = regime['stage']

        if stage == 'bear':
            return False, stage
        # bull, transition, unknown → all pass
        return True, stage

    # --- Gate 1: Liquidity (EGX-Optimized) ---
    # Backtest v2.0 showed EGX needs lower thresholds than Tadawul
    # EGX avg volume is 500K-5M vs Tadawul's 2M-20M
    def gate_liquidity(self, ticker: str, volume: float, value_traded: float) -> bool:
        """Gate 1: volume ≥ 500K shares OR value traded ≥ 2M EGP (EGX-optimized)"""
        if volume >= 500_000:
            return True
        if value_traded >= 2_000_000:
            return True
        return False

    # --- Gate 2: Trend (Trend-Following v3.0) ---
    def gate_trend(self, price: float, sma20: Optional[float],
                   sma50: Optional[float], adx: Optional[float]) -> bool:
        """Gate 2: Price > SMA-50 AND ADX > 25 AND SMA-20 > SMA-50 (golden alignment)
        Confirms we're buying in a CONFIRMED uptrend, not just above a short MA.
        """
        # Price must be above SMA-50
        above_sma50 = True  # Pass if no SMA data
        if sma50 and sma50 > 0:
            above_sma50 = price > sma50

        # ADX must indicate strong trend (> 25)
        adx_strong = True  # Pass if no ADX data
        if adx is not None:
            adx_strong = adx > 25

        # Golden alignment: SMA-20 > SMA-50 (short-term above long-term)
        golden_alignment = True  # Pass if no SMA data
        if sma20 and sma50 and sma20 > 0 and sma50 > 0:
            golden_alignment = sma20 > sma50

        return above_sma50 and adx_strong and golden_alignment

    # --- Gate 3: Breakout Position (Donchian — Trend-Following v3.0) ---
    def gate_sr_position(self, price: float, donchian_high: Optional[float],
                         support: Optional[float] = None,
                         resistance: Optional[float] = None) -> bool:
        """Gate 3: Breakout above 55-day Donchian high OR within 2% of 55-day high.
        BREAKOUT ONLY — no "near support" (that's mean-reversion).
        """
        if donchian_high and donchian_high > 0 and price > 0:
            # Confirmed breakout: close > 55-day Donchian high
            if price > donchian_high:
                return True
            # Near breakout: within 2% of 55-day high
            dist_pct = ((donchian_high - price) / price) * 100
            if dist_pct <= 2.0:
                return True
        return False

    # --- Gate 4: Risk/Reward — ATR-based (Trend-Following v3.0) ---
    def gate_rr(self, price: float, atr: Optional[float],
                persona: str = 'balanced') -> bool:
        """Gate 4: For trend-following, R/R is open-ended (trailing stop).
        Replace fixed R/R with:
        - Risk per share (ATR × SL_mult) / Entry price < 15% — stop isn't too far
        - ATR × trail_mult / entry price > 5% — trailing stop has room
        """
        if not atr or atr <= 0 or price <= 0:
            # No ATR data — use lenient threshold for conservative, pass others
            return persona not in ('conservative', 'cautious', 'hedger', 'investor')

        risk_pct = (atr * self.SL_MULT) / price * 100
        trail_room_pct = (atr * self.TRAIL_MULT) / price * 100

        # Stop not too far: risk < 15% of entry
        stop_ok = risk_pct < 15.0
        # Trailing stop has room: trail > 5% of entry
        trail_ok = trail_room_pct > 5.0

        return stop_ok and trail_ok

    # --- Gate 5: Confirmation (Breakout-Optimized v3.0) ---
    def gate_confirmation(self, candlestick_direction: str, volume_ratio: float) -> bool:
        """Gate 5: bullish candlestick + volume spike ≥ 1.5x
        Stronger conviction needed for breakouts (was 1.3x in mean-reversion).
        """
        if candlestick_direction == 'bullish' and volume_ratio >= 1.5:
            return True
        return False

    # --- Compute ADX (14-period) ---
    @staticmethod
    def _compute_adx(highs: List[float], lows: List[float], closes: List[float],
                     period: int = 14) -> Optional[float]:
        """Compute ADX from price arrays. Returns None if insufficient data."""
        if len(highs) < period * 2 + 1:
            return None

        # Calculate True Range and directional movement
        plus_dm_list = []
        minus_dm_list = []
        tr_list = []

        for i in range(1, len(highs)):
            high_diff = highs[i] - highs[i - 1]
            low_diff = lows[i - 1] - lows[i]

            plus_dm = high_diff if high_diff > low_diff and high_diff > 0 else 0
            minus_dm = low_diff if low_diff > high_diff and low_diff > 0 else 0

            # True Range
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )

            plus_dm_list.append(plus_dm)
            minus_dm_list.append(minus_dm)
            tr_list.append(tr)

        if len(tr_list) < period:
            return None

        # Smooth with Wilder's smoothing (first value = SMA, then EMA)
        def wilder_smooth(data: List[float], p: int) -> List[float]:
            smoothed = [sum(data[:p])]
            for i in range(p, len(data)):
                smoothed.append(smoothed[-1] - smoothed[-1] / p + data[i])
            return smoothed

        atr_smoothed = wilder_smooth(tr_list, period)
        plus_dm_smoothed = wilder_smooth(plus_dm_list, period)
        minus_dm_smoothed = wilder_smooth(minus_dm_list, period)

        # Calculate DX values
        dx_values = []
        for i in range(len(atr_smoothed)):
            if atr_smoothed[i] > 0:
                plus_di = 100 * plus_dm_smoothed[i] / atr_smoothed[i]
                minus_di = 100 * minus_dm_smoothed[i] / atr_smoothed[i]
                di_sum = plus_di + minus_di
                if di_sum > 0:
                    dx = 100 * abs(plus_di - minus_di) / di_sum
                    dx_values.append(dx)

        if len(dx_values) < period:
            return None

        # ADX = smoothed average of DX
        adx = sum(dx_values[:period]) / period
        for i in range(period, len(dx_values)):
            adx = (adx * (period - 1) + dx_values[i]) / period

        return round(adx, 2)

    # --- Compute ATR (14-period) ---
    @staticmethod
    def _compute_atr(highs: List[float], lows: List[float], closes: List[float],
                     period: int = 14) -> Optional[float]:
        """Compute ATR from price arrays. Returns None if insufficient data."""
        if len(highs) < period + 1:
            return None

        tr_list = []
        for i in range(1, len(highs)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )
            tr_list.append(tr)

        if len(tr_list) < period:
            return None

        # Wilder's smoothing for ATR
        atr = sum(tr_list[:period]) / period
        for i in range(period, len(tr_list)):
            atr = (atr * (period - 1) + tr_list[i]) / period

        return round(atr, 4)

    # --- Get stock data for filtering ---
    def _get_stock_basic_data(self, ticker: str) -> Dict:
        """Get basic stock data for filtering (with trend-following indicators)"""
        data = {
            'ticker': ticker, 'volume': 0, 'value_traded': 0, 'price': 0,
            'sma20': None, 'sma50': None, 'adx': None, 'donchian_high': None, 'atr': None,
            'support': None, 'resistance': None,
            'risk_reward': 0, 'volume_ratio': 1.0, 'candlestick_direction': 'neutral',
            'market_change': 0.0
        }

        # Try data_engine.db first
        try:
            conn = self._conn(self.data_engine_db)
            row = conn.execute(
                "SELECT volume, price, market_cap FROM stocks WHERE symbol=?",
                (ticker,)
            ).fetchone()
            if row:
                data['volume'] = float(row['volume'] or 0)
                data['price'] = float(row['price'] or 0)
            conn.close()
        except Exception:
            pass

        # Get price data for SMA, ADX, Donchian, ATR, volume ratio
        # Need at least 60 days for 55-day Donchian + buffer
        try:
            conn = self._conn(self.price_history_db)
            rows = conn.execute(
                "SELECT close_price, high_price, low_price, volume, open_price "
                "FROM price_history WHERE ticker=? ORDER BY date DESC LIMIT 70",
                (ticker.upper(),)
            ).fetchall()
            conn.close()
            if rows:
                closes = [float(r['close_price'] or 0) for r in reversed(rows)]
                volumes = [float(r['volume'] or 0) for r in reversed(rows)]
                highs = [float(r['high_price'] or 0) for r in reversed(rows)]
                lows = [float(r['low_price'] or 0) for r in reversed(rows)]
                opens = [float(r['open_price'] or 0) for r in reversed(rows)]

                if closes and closes[-1] > 0:
                    data['price'] = closes[-1]
                    data['volume'] = volumes[-1] if volumes else 0
                    data['value_traded'] = data['volume'] * data['price']

                    # SMA-20
                    if len(closes) >= 20:
                        data['sma20'] = round(sum(closes[-20:]) / 20, 4)

                    # SMA-50
                    if len(closes) >= 50:
                        data['sma50'] = round(sum(closes[-50:]) / 50, 4)

                    # ADX (14-period)
                    data['adx'] = self._compute_adx(highs, lows, closes, period=14)

                    # ATR (14-period)
                    data['atr'] = self._compute_atr(highs, lows, closes, period=14)

                    # 55-day Donchian high (highest high in last 55 days)
                    if len(highs) >= 55:
                        data['donchian_high'] = max(highs[-55:])
                    elif len(highs) > 0:
                        data['donchian_high'] = max(highs)

                    # Volume ratio (20-day average)
                    if len(volumes) >= 20:
                        vol_sma = sum(volumes[-20:]) / 20
                        data['volume_ratio'] = round(volumes[-1] / vol_sma, 2) if vol_sma > 0 else 1.0

                    # Simple S/R from highs/lows (kept for compatibility)
                    current_price = closes[-1]
                    recent_lows = [l for l in lows if 0 < l < current_price]
                    recent_highs = [h for h in highs if h > current_price]
                    data['support'] = min(recent_lows) if recent_lows else None
                    data['resistance'] = max(recent_highs) if recent_highs else None

                    # Quick R/R (using Donchian high as target if available)
                    if data['support'] and data['support'] > 0:
                        target = data['donchian_high'] if data['donchian_high'] else data['resistance']
                        if target and target > current_price:
                            stop = data['support'] * 0.98
                            # Rule 54: استخدم canonical compute_risk_reward
                            try:
                                from utils.risk_reward import compute_risk_reward
                                data['risk_reward'] = compute_risk_reward(current_price, target, stop, fallback=0.0)
                            except Exception:
                                risk = current_price - stop
                                reward = target - current_price
                                if risk > 0:
                                    data['risk_reward'] = round(reward / risk, 2)

                    # Candlestick direction
                    if len(opens) >= 1:
                        last_open = opens[-1]
                        last_close = closes[-1]
                        if last_close > last_open:
                            data['candlestick_direction'] = 'bullish'
                        elif last_close < last_open:
                            data['candlestick_direction'] = 'bearish'
        except Exception as e:
            logger.debug(f"Error getting price data for {ticker}: {e}")

        return data

    def filter_stock(self, ticker: str, persona: str = 'balanced') -> FilterResult:
        """Apply 6 gates to a single stock (short-circuit on first failure)"""
        data = self._get_stock_basic_data(ticker)

        # Common kwargs for building FilterResult on failure
        base_kwargs = dict(
            ticker=ticker, market='', price=data['price'],
            sma20=data['sma20'], sma50=data['sma50'], adx=data['adx'],
            donchian_high=data['donchian_high'], atr=data['atr'],
            support=data['support'], resistance=data['resistance'],
            risk_reward=data['risk_reward'], volume=data['volume'],
            value_traded=data['value_traded'], volume_ratio=data['volume_ratio'],
            candlestick_direction=data['candlestick_direction'],
        )

        # --- Gate 0: EGX30 Regime (FIRST — before anything else) ---
        g0, egx30_stage = self.gate_egx30_regime()
        if not g0:
            return FilterResult(passed=False, gate_0_egx30_regime=False,
                gate_1_liquidity=False, gate_2_trend=False, gate_3_sr=False,
                gate_4_rr=False, gate_5_confirmation=False, gates_passed=0,
                fail_reason='egx30_regime', egx30_stage=egx30_stage, **base_kwargs)

        # --- Gate 1: Liquidity ---
        g1 = self.gate_liquidity(ticker, data['volume'], data['value_traded'])
        if not g1:
            return FilterResult(passed=False, gate_0_egx30_regime=True,
                gate_1_liquidity=False, gate_2_trend=False, gate_3_sr=False,
                gate_4_rr=False, gate_5_confirmation=False, gates_passed=1,
                fail_reason='liquidity', egx30_stage=egx30_stage, **base_kwargs)

        # --- Gate 2: Trend (SMA-50 + ADX + golden alignment) ---
        g2 = self.gate_trend(data['price'], data['sma20'], data['sma50'], data['adx'])
        if not g2:
            return FilterResult(passed=False, gate_0_egx30_regime=True,
                gate_1_liquidity=True, gate_2_trend=False, gate_3_sr=False,
                gate_4_rr=False, gate_5_confirmation=False, gates_passed=2,
                fail_reason='trend', egx30_stage=egx30_stage, **base_kwargs)

        # --- Gate 3: Breakout Position (Donchian) ---
        g3 = self.gate_sr_position(data['price'], data['donchian_high'],
                                   data['support'], data['resistance'])
        if not g3:
            return FilterResult(passed=False, gate_0_egx30_regime=True,
                gate_1_liquidity=True, gate_2_trend=True, gate_3_sr=False,
                gate_4_rr=False, gate_5_confirmation=False, gates_passed=3,
                fail_reason='sr_position', egx30_stage=egx30_stage, **base_kwargs)

        # --- Gate 4: R/R (ATR-based) ---
        g4 = self.gate_rr(data['price'], data['atr'], persona)
        if not g4:
            return FilterResult(passed=False, gate_0_egx30_regime=True,
                gate_1_liquidity=True, gate_2_trend=True, gate_3_sr=True,
                gate_4_rr=False, gate_5_confirmation=False, gates_passed=4,
                fail_reason='risk_reward', egx30_stage=egx30_stage, **base_kwargs)

        # --- Gate 5: Confirmation ---
        g5 = self.gate_confirmation(data['candlestick_direction'], data['volume_ratio'])
        gates_passed = 5 + (1 if g5 else 0)

        return FilterResult(passed=g5,
            gate_0_egx30_regime=True, gate_1_liquidity=True,
            gate_2_trend=True, gate_3_sr=True,
            gate_4_rr=True, gate_5_confirmation=g5, gates_passed=gates_passed,
            fail_reason='' if g5 else 'confirmation',
            egx30_stage=egx30_stage, **base_kwargs)

    def filter_market(self, market: str = 'EGX', persona: str = 'balanced',
                      min_gates: int = 4) -> FilterReport:
        """Filter all stocks in a market"""
        stocks = self._get_market_stocks(market)

        report = FilterReport(market=market, total_stocks=len(stocks), passed_filter=0)

        # Get EGX30 regime for report
        _, egx30_stage = self.gate_egx30_regime()
        report.egx30_stage = egx30_stage

        gate_counts = {
            'egx30_regime': {'passed': 0, 'failed': 0},
            'liquidity': {'passed': 0, 'failed': 0},
            'trend': {'passed': 0, 'failed': 0},
            'sr_position': {'passed': 0, 'failed': 0},
            'risk_reward': {'passed': 0, 'failed': 0},
            'confirmation': {'passed': 0, 'failed': 0},
        }

        for stock in stocks:
            ticker = stock.get('symbol') or stock.get('ticker', '')
            if not ticker:
                continue

            result = self.filter_stock(ticker, persona)
            result.market = market

            # Track gate stats
            if result.gate_0_egx30_regime:
                gate_counts['egx30_regime']['passed'] += 1
            else:
                gate_counts['egx30_regime']['failed'] += 1
            if result.gate_1_liquidity:
                gate_counts['liquidity']['passed'] += 1
            else:
                gate_counts['liquidity']['failed'] += 1
            if result.gate_2_trend:
                gate_counts['trend']['passed'] += 1
            else:
                gate_counts['trend']['failed'] += 1
            if result.gate_3_sr:
                gate_counts['sr_position']['passed'] += 1
            else:
                gate_counts['sr_position']['failed'] += 1
            if result.gate_4_rr:
                gate_counts['risk_reward']['passed'] += 1
            else:
                gate_counts['risk_reward']['failed'] += 1
            if result.gate_5_confirmation:
                gate_counts['confirmation']['passed'] += 1
            else:
                gate_counts['confirmation']['failed'] += 1

            if result.gates_passed >= min_gates:
                report.results.append(result)
                if result.passed:
                    report.passed_filter += 1

        report.gate_stats = gate_counts
        # Sort by gates_passed desc, then by risk_reward desc
        report.results.sort(key=lambda r: (r.gates_passed, r.risk_reward), reverse=True)
        return report

    def _get_market_stocks(self, market: str = 'EGX') -> List[Dict]:
        """Get all stocks for a market"""
        # Try data_engine.db
        try:
            conn = self._conn(self.data_engine_db)
            market_map = {'EGX': 'مصر', 'TADAWUL': 'السعودية', 'KSE': 'الكويت', 'QSE': 'قطر'}
            db_market = market_map.get(market, market)
            rows = conn.execute("SELECT symbol, name, market FROM stocks WHERE market=? ORDER BY symbol", (db_market,)).fetchall()
            conn.close()
            if rows:
                return [dict(r) for r in rows]
        except Exception:
            pass

        # Try stocks.db
        try:
            conn = self._conn(self.stocks_db)
            rows = conn.execute("SELECT ticker as symbol, name, market FROM stocks WHERE market=? ORDER BY ticker", (market.upper(),)).fetchall()
            conn.close()
            if rows:
                return [dict(r) for r in rows]
        except Exception:
            pass

        return []


def main():
    """Run the filter standalone"""
    import sys
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    market = sys.argv[1] if len(sys.argv) > 1 else 'EGX'
    persona = sys.argv[2] if len(sys.argv) > 2 else 'balanced'
    min_gates = int(sys.argv[3]) if len(sys.argv) > 3 else 4

    f = SniperFilter()
    report = f.filter_market(market, persona, min_gates)

    print(f"\n🎯 SniperFilter Results for {market} (Trend-Following v3.0):")
    print(f"  EGX30 Regime: {report.egx30_stage}")
    print(f"  Total Stocks: {report.total_stocks}")
    print(f"  Passed Filter (≥{min_gates} gates): {len(report.results)}")
    print(f"  All 6 Gates: {report.passed_filter}")

    print(f"\n  Gate Statistics:")
    for gate, stats in report.gate_stats.items():
        total = stats['passed'] + stats['failed']
        pct = (stats['passed'] / total * 100) if total > 0 else 0
        print(f"    {gate}: {stats['passed']}/{total} ({pct:.1f}%)")

    if report.top_opportunities:
        print(f"\n  🏆 Top Opportunities (6/6 gates):")
        for r in report.top_opportunities[:5]:
            print(f"    {r.ticker}: R/R={r.risk_reward}, ADX={r.adx}, Volume={r.volume:.0f}, Price={r.price:.2f}, EGX30={r.egx30_stage}")


if __name__ == '__main__':
    main()
