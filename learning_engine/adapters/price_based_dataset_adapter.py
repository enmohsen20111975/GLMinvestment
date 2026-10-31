"""
adapters/price_based_dataset_adapter.py — Phase 1: Market Learning from Real Data.

OWNER DIRECTIVE (2026-10-30 — CHANGE OF LEARNING STRATEGY):
  "النموذج الأول يتعلم أنماط السوق والعلاقة بين خصائصه والعائد والمخاطر"
  "الـ Labels: تُشتق من حركة السعر الفعلية بعد تاريخ الملاحظة، وليس من
   BUY وSELL اخترعناها"

This module builds training datasets from REAL price data only:
  - Features = indicators from real OHLCV (Unified Library)
  - Labels = forward returns + direction from real prices
  - NO synthetic BUY/SELL signals
  - NO predictions.db needed
  - NO daily_closer needed

Labels derived from market reality:
  1. Forward return after N days (regression)
  2. Direction (binary: up/down)
  3. Max adverse excursion (max drawdown in horizon)
  4. Max favorable excursion (max gain in horizon)
"""
from __future__ import annotations
import sys
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_VPS_PATH = _PROJECT_ROOT / "vps-service"
if str(_VPS_PATH) not in sys.path:
    sys.path.insert(0, str(_VPS_PATH))

from learning_engine.adapters.unified_price_adapter import UnifiedPriceAdapter, UnifiedOHLCVBar, _parse_volume
from learning_engine.adapters.indicators_adapter import IndicatorsAdapter


@dataclass
class MarketLearningSample:
    """عينة تعلم من السوق — من أسعار حقيقية."""
    ticker: str
    market: str
    date: str
    features: Dict[str, float]
    # Labels from REAL price movement
    forward_return_5d: float       # العائد بعد 5 أيام
    forward_return_10d: float      # العائد بعد 10 أيام
    forward_return_20d: float      # العائد بعد 20 يوم
    direction_5d: float            # 1=صعود، 0=هبوط (5 أيام)
    direction_10d: float           # 1=صعود، 0=هبوط (10 أيام)
    direction_20d: float           # 1=صعود، 0=هبوط (20 يوم)
    max_adverse_excursion: float   # أكبر خسارة خلال الـ horizon (MAE)
    max_favorable_excursion: float # أكبر ربح خلال الـ horizon (MFE)
    entry_price: float
    source: str = "real_market_data"


class PriceBasedDatasetBuilder:
    """
    Phase 1: Market Learning from Real Data.
    يبني dataset من الأسعار الحقيقية — labels من حركة السعر الفعلية.
    لا يستخدم synthetic BUY/SELL signals.

    لكل سهم + لكل يوم:
      1. يحسب features من المؤشرات (RSI, ATR, MACD, SMA, Bollinger, ADX, MFI)
      2. يحسب labels من حركة السعر الفعلية:
         - forward_return (1d, 5d, 10d, 20d)
         - direction (binary: up/down)
         - max adverse/favorable excursion
      3. يحفظ العينة
    """

    def __init__(
        self,
        price_adapter: Optional[UnifiedPriceAdapter] = None,
        indicators_adapter: Optional[IndicatorsAdapter] = None,
    ):
        self._prices = price_adapter or UnifiedPriceAdapter()
        self._indicators = indicators_adapter or IndicatorsAdapter()

    def build_dataset(
        self,
        market: str = "ALL",
        horizon: int = 5,
        min_history: int = 30,
        max_samples: int = 50000,
        cost_threshold: float = 0.5,
    ) -> Tuple[List[Dict], List[float], Dict]:
        """
        يبني dataset من كل البيانات المتاحة.
        market='ALL' = استخدم كل الأسواق (EGX + US + أي مصدر متاح).
        Labels من حركة السعر الفعلية (مش synthetic signals).

        Args:
            cost_threshold: الحد الأدنى للعائد للتمييز بين up/down (٪).
                            القيم أقل من هذا (مطلقاً) تـُعتبر neutral.
                            افتراضي 0.5٪ (يغطي تكاليف التداول).
                            جرب 0.3 أو 0.25 لو عايز تـقلل الـ neutrals.
        """
        # إذا كان ALL، نجمع من كل المصادر
        if market == "ALL":
            all_X = []
            all_y = []
            all_returns = []
            total_skipped = {"insufficient_history": 0, "no_indicators": 0, "no_future": 0}
            markets_done = []

            for mkt in ["EGX", "US"]:
                X_mkt, y_mkt, meta_mkt = self._build_for_single_market(
                    mkt, horizon, min_history, max_samples - len(all_X),
                    cost_threshold=cost_threshold,
                )
                if X_mkt:
                    all_X.extend(X_mkt)
                    all_y.extend(y_mkt)
                    all_returns.extend(meta_mkt.get("returns_list", []))
                    for k in total_skipped:
                        total_skipped[k] += meta_mkt.get("skipped", {}).get(k, 0)
                    markets_done.append(mkt)

            metadata = {
                "market": "ALL",
                "horizon": horizon,
                "total_samples": len(all_X),
                "positive_samples": sum(1 for l in all_y if l >= 0.5),
                "negative_samples": sum(1 for l in all_y if l < 0.5),
                "avg_return": sum(all_returns) / len(all_returns) if all_returns else 0,
                "skipped": total_skipped,
                "markets_included": markets_done,
                "source": "real_prices (egksco + stock_daily_prices — ALL markets)",
            }

            print(f"\n[MarketLearning] ALL Markets")
            print(f"  Total samples: {len(all_X)}")
            print(f"  Positive: {metadata['positive_samples']}")
            print(f"  Negative: {metadata['negative_samples']}")
            print(f"  Markets: {markets_done}")

            return all_X, all_y, metadata

        return self._build_for_single_market(
            market, horizon, min_history, max_samples,
            cost_threshold=cost_threshold,
        )

    def _build_for_single_market(
        self,
        market: str,
        horizon: int = 5,
        min_history: int = 30,
        max_samples: int = 500000,
        cost_threshold: float = 0.5,
    ) -> Tuple[List[Dict], List[float], Dict]:
        """
        يبني dataset من الأسعار الحقيقية.
        Labels من حركة السعر الفعلية (مش synthetic signals).

        Args:
            cost_threshold: الحد الأدنى للعائد للتمييز بين up/down (٪).
                            افتراضي 0.5٪. لو عايز تـقلل الـ neutrals، جرّب 0.3.

        Returns:
          X: list of feature dicts
          y: list of labels (1.0 = up, 0.0 = down) for the specified horizon
          metadata: stats about the dataset
        """
        cov = self._prices.get_coverage_report(market)
        symbols = list(cov.get("symbols", {}).keys())

        print(f"\n[MarketLearning] Market: {market}")
        print(f"  Symbols available: {len(symbols)}")

        X: List[Dict] = []
        y: List[float] = []
        returns: List[float] = []
        skipped = {"insufficient_history": 0, "no_indicators": 0, "no_future": 0}

        # نحتاج 20 يوم مستقبلية لحساب كل الـ labels (5d, 10d, 20d)
        max_future = 20

        for sym_idx, sym in enumerate(symbols):
            if len(X) >= max_samples:
                break

            # اقرا كل التاريخ المتاح (مش عينة)
            bars = self._prices.get_unified_history(sym, market, days=10000)

            if len(bars) < min_history + max_future:
                skipped["insufficient_history"] += 1
                continue

            for i in range(50, len(bars) - max_future):
                if len(X) >= max_samples:
                    break

                bar = bars[i]
                future_bars = bars[i+1:i+1+max_future]

                if len(future_bars) < max_future:
                    skipped["no_future"] += 1
                    continue

                # المؤشرات من المكتبة الموحدة (PIT-correct)
                closes = [float(b.close) for b in bars[:i+1]]
                highs = [float(b.high) for b in bars[:i+1]]
                lows = [float(b.low) for b in bars[:i+1]]
                volumes = [_parse_volume(b.volume) for b in bars[:i+1]]

                if len(closes) < 20:
                    skipped["no_indicators"] += 1
                    continue

                features = self._compute_features(closes, highs, lows, volumes)
                if not features:
                    skipped["no_indicators"] += 1
                    continue

                # إضافة regime (حالة السوق وقت القرار)
                regime = self._get_regime_at_date(market, bar.date)
                if regime:
                    features["market_regime"] = regime
                else:
                    features["market_regime"] = "UNKNOWN"

                # Labels من حركة السعر الفعلية
                entry_price = float(bar.close)
                if entry_price <= 0:
                    continue

                # Forward returns at different horizons
                ret_5d = (float(future_bars[4].close) - entry_price) / entry_price * 100 if len(future_bars) >= 5 else 0
                ret_10d = (float(future_bars[9].close) - entry_price) / entry_price * 100 if len(future_bars) >= 10 else 0
                ret_20d = (float(future_bars[19].close) - entry_price) / entry_price * 100 if len(future_bars) >= 20 else 0

                # Direction labels — مع منطقة محايدة (±cost_threshold لتغطية تكاليف التداول)
                dir_5d = 1.0 if ret_5d > cost_threshold else (0.0 if ret_5d < -cost_threshold else 0.5)
                dir_10d = 1.0 if ret_10d > cost_threshold else (0.0 if ret_10d < -cost_threshold else 0.5)
                dir_20d = 1.0 if ret_20d > cost_threshold else (0.0 if ret_20d < -cost_threshold else 0.5)

                # Max Adverse/Favorable Excursion within horizon
                future_closes = [float(b.close) for b in future_bars[:horizon]]
                mae = min((c - entry_price) / entry_price * 100 for c in future_closes) if future_closes else 0
                mfe = max((c - entry_price) / entry_price * 100 for c in future_closes) if future_closes else 0

                # Use the specified horizon for the primary label
                if horizon == 5:
                    label = dir_5d
                    label_return = ret_5d
                elif horizon == 10:
                    label = dir_10d
                    label_return = ret_10d
                elif horizon == 20:
                    label = dir_20d
                    label_return = ret_20d
                else:
                    # Custom horizon
                    if len(future_bars) >= horizon:
                        exit_price = float(future_bars[horizon-1].close)
                        label_return = (exit_price - entry_price) / entry_price * 100
                        label = 1.0 if exit_price > entry_price else 0.0
                    else:
                        continue

                # Add all labels as features metadata (not used for training — for analysis)
                features["_ticker"] = sym
                features["_market"] = market
                features["_date"] = bar.date
                features["_entry_price"] = entry_price
                features["_forward_return_5d"] = ret_5d
                features["_forward_return_10d"] = ret_10d
                features["_forward_return_20d"] = ret_20d
                features["_direction_5d"] = dir_5d
                features["_direction_10d"] = dir_10d
                features["_direction_20d"] = dir_20d
                features["_mae"] = mae
                features["_mfe"] = mfe
                features["_source"] = "real_market_data"

                X.append(features)
                y.append(label)
                returns.append(label_return)

            if sym_idx % 100 == 0 and sym_idx > 0:
                print(f"  Processed {sym_idx}/{len(symbols)} symbols → {len(X)} samples")

        self._prices.close_all()

        # إحصائيات
        metadata = {
            "market": market,
            "horizon": horizon,
            "total_samples": len(X),
            "positive_samples": sum(1 for l in y if l >= 0.5),
            "negative_samples": sum(1 for l in y if l < 0.5),
            "avg_return": sum(returns) / len(returns) if returns else 0,
            "skipped": skipped,
            "symbols_processed": sym_idx + 1,
            "symbols_available": len(symbols),
            "source": "real_prices (egksco + stock_daily_prices)",
            "returns_list": returns,
        }

        print(f"\n[PriceDataset] Built {len(X)} samples")
        print(f"  Positive (up): {metadata['positive_samples']}")
        print(f"  Negative (down): {metadata['negative_samples']}")
        print(f"  Avg return: {metadata['avg_return']:.2f}%")
        print(f"  Skipped: {skipped}")

        return X, y, metadata

    def _compute_features(
        self,
        closes: List[float],
        highs: List[float],
        lows: List[float],
        volumes: List[float],
    ) -> Optional[Dict[str, float]]:
        """يحسب features من المكتبة الموحدة. يرجع None لو ناقصة."""

        features: Dict[str, float] = {}

        # RSI
        rsi = self._indicators.calc_rsi(closes, period=14)
        if rsi is not None:
            features["rsi_14"] = float(rsi)
        else:
            return None

        # ATR + atr_pct
        atr = self._indicators.calc_atr(highs, lows, closes, period=14)
        if atr is not None and atr > 0 and closes[-1] > 0:
            features["atr_14"] = float(atr)
            features["atr_pct"] = float(atr / closes[-1] * 100)
        else:
            return None

        # MACD
        macd_result = self._indicators.macd(closes)
        if macd_result and macd_result.get("line") is not None:
            features["macd_line"] = float(macd_result["line"])
            features["macd_signal"] = float(macd_result.get("signal", 0) or 0)
            features["macd_histogram"] = float(macd_result.get("histogram", 0) or 0)
        else:
            return None

        # SMA 20 + distance
        sma_20 = self._indicators.sma(closes, 20)
        if sma_20 is not None and sma_20 > 0:
            features["sma_20"] = float(sma_20)
            features["distance_to_sma_20_pct"] = float((closes[-1] - sma_20) / sma_20 * 100)

        # SMA 50 (optional)
        sma_50 = self._indicators.sma(closes, 50)
        if sma_50 is not None and sma_50 > 0:
            features["sma_50"] = float(sma_50)
            features["distance_to_sma_50_pct"] = float((closes[-1] - sma_50) / sma_50 * 100)

        # Bollinger
        bb = self._indicators.calc_bollinger(closes, period=20)
        if bb and bb.get("percent_b") is not None:
            features["bollinger_percent_b"] = float(bb["percent_b"])
            features["bollinger_bandwidth"] = float(bb.get("bandwidth", 0) or 0)

        # ADX
        adx = self._indicators.calc_adx(highs, lows, closes, period=14)
        if adx and adx.get("adx") is not None:
            features["adx_14"] = float(adx["adx"])
            features["plus_di"] = float(adx.get("plus_di", 0) or 0)
            features["minus_di"] = float(adx.get("minus_di", 0) or 0)

        # Returns
        if len(closes) >= 2 and closes[-2] > 0:
            features["return_1d"] = float((closes[-1] - closes[-2]) / closes[-2] * 100)
        if len(closes) >= 6 and closes[-6] > 0:
            features["return_5d"] = float((closes[-1] - closes[-6]) / closes[-6] * 100)
        if len(closes) >= 21 and closes[-21] > 0:
            features["return_20d"] = float((closes[-1] - closes[-21]) / closes[-21] * 100)

        # Volume
        if len(volumes) >= 20:
            avg_vol_20 = sum(volumes[-20:]) / 20
            if avg_vol_20 > 0:
                features["relative_volume_20d"] = float(volumes[-1] / avg_vol_20)

        # MFI
        mfi = self._indicators.calc_mfi(highs, lows, closes, volumes, period=14)
        if mfi is not None:
            features["mfi_14"] = float(mfi)

        return features if len(features) >= 5 else None

    def _get_regime_at_date(self, market: str, date_str: str) -> Optional[str]:
        """يقرا حالة السوق التاريخية من market_regime_log."""
        import sqlite3
        from pathlib import Path
        stocks_db = Path(__file__).resolve().parents[2] / "db" / "stocks.db"
        if not stocks_db.exists():
            return None
        try:
            conn = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute(
                "SELECT regime FROM market_regime_log WHERE market = ? AND date <= ? ORDER BY date DESC LIMIT 1",
                (market, date_str[:10])
            )
            row = cur.fetchone()
            conn.close()
            return row[0] if row else None
        except Exception:
            return None
