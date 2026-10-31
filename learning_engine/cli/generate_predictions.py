#!/usr/bin/env python3
"""
generate_synthetic_predictions.py — يبني توقعات من التاريخ المتاح للتدريب

لا يكتب في predictions.db الإنتاجي.
يبني dataset وهمي في learning.db من الأسعار الفعلية + مؤشرات V3.

Usage:
  python3 -m learning_engine.cli.generate_predictions --market EGX --days 60
"""
from __future__ import annotations
import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_PROJECT_ROOT))

from learning_engine.adapters.unified_price_adapter import UnifiedPriceAdapter
from learning_engine.adapters.indicators_adapter import IndicatorsAdapter
from learning_engine.config.settings import LearningSettings


def generate_predictions(market: str, days: int = 60):
    """يبني توقعات synthetic من الأسعار الفعلية + يخلي النموذج يتعلم."""

    print(f"\n{'='*60}")
    print(f"Generating synthetic predictions for {market} ({days} days)")
    print(f"{'='*60}")

    adapter = UnifiedPriceAdapter()
    indicators = IndicatorsAdapter()
    settings = LearningSettings()

    # learning.db (معزول — مش predictions.db)
    learning_db = settings.learning_db
    learning_db.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(learning_db))
    cur = conn.cursor()

    # جدول synthetic predictions
    cur.execute("""
        CREATE TABLE IF NOT EXISTS synthetic_predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT NOT NULL,
            prediction_date TEXT NOT NULL,
            signal TEXT NOT NULL,
            entry_price REAL NOT NULL,
            target_price REAL,
            stop_loss REAL,
            master_score REAL,
            technical_score REAL,
            confidence REAL,
            risk_reward REAL,
            -- outcome (بيتحسب بعد horizon أيام)
            outcome_date TEXT,
            exit_price REAL,
            actual_return REAL,
            hit_target INTEGER DEFAULT 0,
            hit_stop INTEGER DEFAULT 0,
            holding_days INTEGER DEFAULT 0,
            exit_type TEXT,
            -- features وقت التوقع
            rsi_14 REAL,
            atr_14 REAL,
            macd_line REAL,
            sma_20 REAL,
            sma_50 REAL,
            bollinger_percent_b REAL,
            adx_14 REAL,
            volume REAL,
            -- metadata
            source TEXT DEFAULT 'synthetic_v3_like',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, market, prediction_date)
        )
    """)
    conn.commit()

    # الحصول على الأسهم المتاحة
    cov = adapter.get_coverage_report(market)
    symbols = list(cov.get("symbols", {}).keys())
    print(f"\nSymbols available: {len(symbols)}")

    if not symbols:
        print("❌ No symbols found")
        conn.close()
        return

    # لكل سهم: بناء توقعات من التاريخ
    total_predictions = 0
    total_resolved = 0
    horizon = 5  # أيام

    for sym in symbols:
        # الحصول على الأسعار
        bars = adapter.get_unified_history(sym, market, days=days + horizon + 50)
        if len(bars) < 50 + horizon:
            continue

        # لكل يوم (بعد أول 50 شمعة للمؤشرات)
        for i in range(50, len(bars) - horizon):
            bar = bars[i]
            pred_date = bar.date

            # حساب المؤشرات لحد هذا اليوم (PIT-correct)
            closes_up_to = [b.close for b in bars[:i+1]]
            highs_up_to = [b.high for b in bars[:i+1]]
            lows_up_to = [b.low for b in bars[:i+1]]
            volumes_up_to = [b.volume for b in bars[:i+1]]

            if len(closes_up_to) < 20:
                continue

            # المؤشرات (من المكتبة الموحدة)
            rsi = indicators.calc_rsi(closes_up_to, period=14)
            atr = indicators.calc_atr(highs_up_to, lows_up_to, closes_up_to, period=14)
            macd_result = indicators.macd(closes_up_to)
            sma_20 = indicators.sma(closes_up_to, 20)
            sma_50 = indicators.sma(closes_up_to, 50) if len(closes_up_to) >= 50 else None
            bb = indicators.calc_bollinger(closes_up_to, period=20)
            adx_result = indicators.calc_adx(highs_up_to, lows_up_to, closes_up_to, period=14)

            if rsi is None or atr is None or macd_result is None:
                continue

            # قواعد V3-like لاتخاذ القرار
            entry_price = bar.close
            signal = "HOLD"
            master_score = 50.0
            confidence = 50.0

            # قاعدة 1: RSI < 30 + above SMA20 → BUY
            if rsi < 35 and sma_20 and entry_price > sma_20:
                signal = "BUY"
                master_score = 65.0 + (35 - rsi)
                confidence = 60.0
            # قاعدة 2: RSI > 65 + below SMA20 → SELL
            elif rsi > 65 and sma_20 and entry_price < sma_20:
                signal = "SELL"
                master_score = 35.0 - (rsi - 65)
                confidence = 60.0
            # قاعدة 3: ADX > 25 + MACD bullish → STRONG_BUY
            elif adx_result and adx_result.get("adx", 0) > 25:
                macd_line = macd_result.get("line", 0)
                macd_signal = macd_result.get("signal", 0)
                if macd_line > macd_signal and rsi < 60:
                    signal = "STRONG_BUY"
                    master_score = 75.0
                    confidence = 70.0
                elif macd_line < macd_signal and rsi > 40:
                    signal = "SELL"
                    master_score = 30.0
                    confidence = 65.0
            else:
                continue  # skip HOLD — ماينفعش للتعلم

            # Target + Stop (V3-like: ATR-based)
            if atr > 0 and entry_price > 0:
                if signal in ("BUY", "STRONG_BUY"):
                    target_price = entry_price + (atr * 1.8)  # target = 1.8× ATR
                    stop_loss = entry_price - (atr * 1.2)     # stop = 1.2× ATR
                else:  # SELL
                    target_price = entry_price - (atr * 1.8)
                    stop_loss = entry_price + (atr * 1.2)
            else:
                continue

            risk_reward = abs(target_price - entry_price) / abs(entry_price - stop_loss) if abs(entry_price - stop_loss) > 0 else 0

            # حساب الـ outcome (بعد horizon أيام)
            future_bars = bars[i+1:i+1+horizon]
            if len(future_bars) < horizon:
                continue

            outcome_bar = future_bars[-1]
            outcome_date = outcome_bar.date
            exit_price = outcome_bar.close
            actual_return = (exit_price - entry_price) / entry_price * 100

            # hit target / stop
            hit_target = 0
            hit_stop = 0
            exit_type = "timeout"

            for fb in future_bars:
                if signal in ("BUY", "STRONG_BUY"):
                    if fb.low <= stop_loss:
                        hit_stop = 1
                        exit_type = "stop_loss"
                        exit_price = stop_loss
                        actual_return = (exit_price - entry_price) / entry_price * 100
                        break
                    if fb.high >= target_price:
                        hit_target = 1
                        exit_type = "target_hit"
                        exit_price = target_price
                        actual_return = (exit_price - entry_price) / entry_price * 100
                        break
                else:  # SELL
                    if fb.high >= stop_loss:
                        hit_stop = 1
                        exit_type = "stop_loss"
                        exit_price = stop_loss
                        actual_return = (exit_price - entry_price) / entry_price * 100
                        break
                    if fb.low <= target_price:
                        hit_target = 1
                        exit_type = "target_hit"
                        exit_price = target_price
                        actual_return = (exit_price - entry_price) / entry_price * 100
                        break

            # حساب holding_days
            holding_days = horizon
            if hit_target or hit_stop:
                for j, fb in enumerate(future_bars):
                    if signal in ("BUY", "STRONG_BUY"):
                        if (hit_stop and fb.low <= stop_loss) or (hit_target and fb.high >= target_price):
                            holding_days = j + 1
                            break
                    else:
                        if (hit_stop and fb.high >= stop_loss) or (hit_target and fb.low <= target_price):
                            holding_days = j + 1
                            break

            # حفظ في learning.db
            try:
                cur.execute("""
                    INSERT OR REPLACE INTO synthetic_predictions
                    (ticker, market, prediction_date, signal, entry_price,
                     target_price, stop_loss, master_score, technical_score,
                     confidence, risk_reward, outcome_date, exit_price,
                     actual_return, hit_target, hit_stop, holding_days,
                     exit_type, rsi_14, atr_14, macd_line, sma_20, sma_50,
                     bollinger_percent_b, adx_14, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    sym, market, pred_date, signal, entry_price,
                    target_price, stop_loss, master_score,
                    float(sma_20) if sma_20 else 50.0,
                    confidence, risk_reward,
                    outcome_date, exit_price, actual_return,
                    hit_target, hit_stop, holding_days,
                    exit_type,
                    float(rsi), float(atr),
                    float(macd_result.get("line", 0)),
                    float(sma_20) if sma_20 else None,
                    float(sma_50) if sma_50 else None,
                    float(bb.get("percent_b", 50)) if bb else 50.0,
                    float(adx_result.get("adx", 25)) if adx_result else 25.0,
                    float(bar.volume),
                ))
                total_predictions += 1
                total_resolved += 1
            except sqlite3.Error:
                continue

    conn.commit()

    # إحصائيات
    cur.execute("SELECT COUNT(*) FROM synthetic_predictions WHERE market = ?", (market,))
    total = cur.fetchone()[0]
    cur.execute("SELECT signal, COUNT(*) FROM synthetic_predictions WHERE market = ? GROUP BY signal", (market,))
    by_signal = {r[0]: r[1] for r in cur.fetchall()}
    cur.execute("SELECT SUM(hit_target), SUM(hit_stop) FROM synthetic_predictions WHERE market = ?", (market,))
    r = cur.fetchone()
    targets, stops = r[0] or 0, r[1] or 0

    conn.close()
    adapter.close_all()

    print(f"\n{'='*60}")
    print(f"Generated: {total} predictions ({total_resolved} resolved)")
    print(f"By signal: {by_signal}")
    print(f"Targets hit: {targets} | Stops hit: {stops}")
    wr = targets * 100 / (targets + stops) if (targets + stops) > 0 else 0
    print(f"Win rate: {wr:.1f}%")
    print(f"Saved to: {learning_db}")
    print(f"\nالآن شغل التدريب:")
    print(f"  python3 -m learning_engine.cli.train_model --label-type direction --horizon 5 --market {market}")
    print(f"{'='*60}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate synthetic predictions for training")
    parser.add_argument("--market", default="EGX", help="Market (EGX, TADAWUL, US)")
    parser.add_argument("--days", type=int, default=60, help="History days to use")
    args = parser.parse_args()
    generate_predictions(args.market, args.days)


if __name__ == "__main__":
    main()
