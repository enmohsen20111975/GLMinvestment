#!/usr/bin/env python3
"""
diagnose_v3_backtest.py — تشخيص كارثة V3 على آخر 3 شهور.

ينتج جدولين فقط (بدون تعديل أي حاجة):
  جدول 1: توزيع الخسائر حسب State
  جدول 2: مقارنة رابح vs خاسر

Usage:
  python3 -m learning_engine.cli.diagnose_v3_backtest \\
      --json backtest_results/v3_backtest_EGX_20261031_023659.json

  # أو لو عندك أكتر من ملف، استخدم الأحدث:
  python3 -m learning_engine.cli.diagnose_v3_backtest --latest
"""
from __future__ import annotations
import sys
import json
import argparse
import sqlite3
from pathlib import Path
from collections import defaultdict, Counter
from statistics import mean, median

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _safe_mean(values, default=0.0):
    """متوسط آمن (يتجاهل None)."""
    nums = [v for v in values if v is not None and isinstance(v, (int, float))]
    return mean(nums) if nums else default


def _safe_median(values, default=0.0):
    nums = [v for v in values if v is not None and isinstance(v, (int, float))]
    return median(nums) if nums else default


def _load_backtest(json_path: Path) -> dict:
    """يقرأ ملف الـ backtest JSON."""
    if not json_path.exists():
        raise FileNotFoundError(f"Backtest JSON not found: {json_path}")
    with open(json_path) as f:
        return json.load(f)


def _get_market_features_at_entry(ticker: str, signal_date: str, db_path: Path) -> dict:
    """
    يحسب ATR٪, relative_volume_20d, distance_to_sma_20٪ وقت الدخول.
    Reads from stocks.db.stock_daily_prices (read-only).
    """
    feats = {"atr_pct": None, "relative_volume_20d": None, "distance_to_sma_20_pct": None}
    if not db_path.exists():
        return feats

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()
        # جيب آخر 50 شمعة قبل أو يوم signal_date
        cur.execute(
            """SELECT price_date, high, low, close, volume
               FROM stock_daily_prices
               WHERE ticker = ? AND market = 'EGX' AND price_date <= ?
               ORDER BY price_date DESC LIMIT 50""",
            (ticker, signal_date)
        )
        rows = cur.fetchall()
        conn.close()

        if len(rows) < 20:
            return feats

        # رتّب تصاعدي (الأقدم أولاً)
        rows = list(reversed(rows))
        highs = [r[1] for r in rows if r[1] is not None]
        lows = [r[2] for r in rows if r[2] is not None]
        closes = [r[3] for r in rows if r[3] is not None]
        vols = [r[4] for r in rows if r[4] is not None]

        if len(closes) < 14 or closes[-1] <= 0:
            return feats

        # ATR (Wilder's simple version — average TR over last 14)
        trs = []
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i-1]),
                abs(lows[i] - closes[i-1])
            )
            trs.append(tr)
        if len(trs) >= 14:
            atr = mean(trs[-14:])
            feats["atr_pct"] = (atr / closes[-1]) * 100 if closes[-1] > 0 else None

        # Relative volume (current vs 20-day avg)
        if len(vols) >= 21:
            avg_vol_20 = mean(vols[-21:-1])
            if avg_vol_20 and avg_vol_20 > 0:
                feats["relative_volume_20d"] = vols[-1] / avg_vol_20

        # Distance to SMA20
        if len(closes) >= 20:
            sma_20 = mean(closes[-20:])
            if sma_20 > 0:
                feats["distance_to_sma_20_pct"] = ((closes[-1] - sma_20) / sma_20) * 100

        return feats
    except Exception:
        return feats


def _table_1_loss_distribution(trades: list) -> None:
    """جدول 1: توزيع الخسائر حسب State."""
    print("\n" + "=" * 94)
    print("جدول 1: توزيع الصفقات والخسائر حسب State")
    print("=" * 94)

    # تجميع حسب state_code
    by_state = defaultdict(list)
    for t in trades:
        state = t.get("state_code") or "UNKNOWN"
        by_state[state].append(t)

    # header
    print(f"\n{'State':<8}{'#Trades':>8}{'Win٪':>8}{'AvgPnL٪':>10}{'MedPnL٪':>10}"
          f"{'AvgStop٪':>10}{'AvgTgt٪':>10}{'StopHits':>10}{'TgtHits':>10}{'Timeouts':>10}")
    print("-" * 98)

    # rows
    all_pnl = []
    for state in sorted(by_state.keys()):
        trades_s = by_state[state]
        n = len(trades_s)
        pnls = [t.get("pnl_pct", 0) or 0 for t in trades_s]
        wins = sum(1 for p in pnls if p > 0)
        win_rate = wins * 100 / n if n else 0
        avg_pnl = _safe_mean(pnls)
        med_pnl = _safe_median(pnls)

        # stop / target distances
        stop_dists = []
        tgt_dists = []
        for t in trades_s:
            entry = t.get("entry_price", 0) or 0
            stop = t.get("stop_loss", 0) or 0
            tgt = t.get("target_price", 0) or 0
            if entry > 0:
                if stop > 0:
                    stop_dists.append(abs(entry - stop) / entry * 100)
                if tgt > 0:
                    tgt_dists.append(abs(tgt - entry) / entry * 100)

        avg_stop = _safe_mean(stop_dists)
        avg_tgt = _safe_mean(tgt_dists)

        # exit reasons
        reasons = Counter(t.get("exit_reason", "unknown") for t in trades_s)
        stop_hits = reasons.get("stop_hit", 0)
        tgt_hits = reasons.get("target_hit", 0)
        timeouts = reasons.get("no_future_data", 0) + reasons.get("timeout", 0)

        all_pnl.extend(pnls)

        print(f"{state:<8}{n:>8}{win_rate:>7.1f}٪{avg_pnl:>9.2f}٪{med_pnl:>9.2f}٪"
              f"{avg_stop:>9.2f}٪{avg_tgt:>9.2f}٪{stop_hits:>10}{tgt_hits:>10}{timeouts:>10}")

    # totals
    n_all = len(all_pnl)
    if all_pnl:
        wins_all = sum(1 for p in all_pnl if p > 0)
        wr_all = wins_all * 100 / n_all
        print("-" * 98)
        all_reasons = Counter(t.get("exit_reason", "unknown") for t in trades)
        print(f"{'TOTAL':<8}{n_all:>8}{wr_all:>7.1f}٪{_safe_mean(all_pnl):>9.2f}٪"
              f"{_safe_median(all_pnl):>9.2f}٪{'':>10}{'':>10}"
              f"{all_reasons.get('stop_hit', 0):>10}{all_reasons.get('target_hit', 0):>10}"
              f"{all_reasons.get('no_future_data', 0) + all_reasons.get('timeout', 0):>10}")

    # ملخص سريع
    print("\n📌 ملاحظات سريعة:")
    top_state = Counter(t.get('state_code', '?') for t in trades).most_common(1)
    if top_state:
        print(f"  - أغلب الصفقات في State: {top_state[0]}")
    print(f"  - متوسط PnL الكلي: {_safe_mean(all_pnl):.2f}٪")
    stop_pct = sum(1 for t in trades if t.get('exit_reason') == 'stop_hit') * 100 / len(trades) if trades else 0
    tgt_pct = sum(1 for t in trades if t.get('exit_reason') == 'target_hit') * 100 / len(trades) if trades else 0
    print(f"  - نسبة Stop hits: {stop_pct:.1f}٪")
    print(f"  - نسبة Target hits: {tgt_pct:.1f}٪")


def _table_2_winner_vs_loser(trades: list, db_path: Path) -> None:
    """جدول 2: مقارنة رابح vs خاسر."""
    print("\n" + "=" * 94)
    print("جدول 2: مقارنة رابح vs خاسر (Features وقت الدخول)")
    print("=" * 94)

    # فلترة الصفقات المغلقة فقط (عشان الـ winner/loser واضحة)
    closed = [t for t in trades if t.get("exit_reason") in ("stop_hit", "target_hit")]
    if not closed:
        closed = trades  # fallback

    winners = [t for t in closed if (t.get("pnl_pct") or 0) > 0]
    losers = [t for t in closed if (t.get("pnl_pct") or 0) <= 0]

    print(f"\n  الصفقات المغلقة: {len(closed)} (winners={len(winners)}, losers={len(losers)})")

    # لو مفيش رابحين، نطبع تحذير ونكمل باللي عندنا
    if not winners:
        print("  ⚠️  مفيش رابحين في العينة دي — جدول 2 هيكون ناقص خانة Winners")

    # تجميع الـ features من قاعدة بيانات الأسعار
    print(f"\n  بانتظار حساب ATR٪, relative_volume, distance_to_sma_20 لكل صفقة...")

    def collect_features(trade_list):
        feats_list = []
        for t in trade_list:
            ticker = t.get("ticker", "")
            signal_date = t.get("signal_date", "")
            # جرّب_egksco ticker إذا فشل الـ stock_daily_prices
            base_feats = _get_market_features_at_entry(ticker, signal_date, db_path)
            # لو فاضي، جرّب بدون "_EGX" suffix لو موجود
            if all(v is None for v in base_feats.values()) and "_" in ticker:
                base_ticker = ticker.split("_")[0]
                base_feats = _get_market_features_at_entry(base_ticker, signal_date, db_path)

            feats_list.append({
                **base_feats,
                "master_score": t.get("master_score", 0) or 0,
                "confidence": t.get("confidence", 0) or 0,
                "holding_days": t.get("holding_days", 0) or 0,
            })
        return feats_list

    w_feats = collect_features(winners)
    l_feats = collect_features(losers)

    # طباعة جدول المقارنة
    metrics = [
        ("ATR٪ (volatility)",           "atr_pct"),
        ("Relative Volume 20d",          "relative_volume_20d"),
        ("Distance to SMA20٪",           "distance_to_sma_20_pct"),
        ("Master Score",                 "master_score"),
        ("Confidence",                   "confidence"),
        ("Holding Days",                 "holding_days"),
    ]

    print(f"\n  {'Metric':<28}{'Winners (avg)':>18}{'Losers (avg)':>18}{'Δ (W-L)':>14}{'إشارة':>18}")
    print("  " + "-" * 94)

    for label, key in metrics:
        w_vals = [f[key] for f in w_feats if f.get(key) is not None]
        l_vals = [f[key] for f in l_feats if f.get(key) is not None]

        w_avg = _safe_mean(w_vals)
        l_avg = _safe_mean(l_vals)
        delta = w_avg - l_avg

        # تفسير سريع
        signal = ""
        if w_vals and l_vals:
            if key == "atr_pct":
                if delta > 0.2: signal = "🔥 خاسرين في تقلب أعلى"
                elif delta < -0.2: signal = "✅ رابحين في تقلب أعلى"
            elif key == "relative_volume_20d":
                if delta > 0.1: signal = "🔥 خاسرين بحجم أعلى (FOMO)"
                elif delta < -0.1: signal = "✅ رابحين بحجم طبيعي"
            elif key == "distance_to_sma_20_pct":
                if delta > 1.0: signal = "🔥 خاسرين أبعد عن SMA20 (extended)"
                elif delta < -1.0: signal = "✅ رابحين قريبين من SMA20"
            elif key == "master_score":
                if delta > 2: signal = "🔥 خاسرين بـ score أعلى"
                elif delta < -2: signal = "⚠️ رابحين بـ score أقل"
            elif key == "confidence":
                if delta > 2: signal = "🔥 خاسرين بـ confidence أعلى"
                elif delta < -2: signal = "⚠️ رابحين بـ confidence أقل"

        w_str = f"{w_avg:.2f}" if w_vals else "N/A"
        l_str = f"{l_avg:.2f}" if l_vals else "N/A"
        d_str = f"{delta:+.2f}" if w_vals and l_vals else "N/A"

        print(f"  {label:<28}{w_str:>18}{l_str:>18}{d_str:>14}{signal:>18}")

    # ملخص
    print("\n📌 خلاصة جدول 2:")
    n_w_atr = sum(1 for f in w_feats if f.get("atr_pct") is not None)
    n_l_atr = sum(1 for f in l_feats if f.get("atr_pct") is not None)
    print(f"  - تم حساب ATR٪ لـ {n_w_atr}/{len(winners)} رابح + {n_l_atr}/{len(losers)} خاسر")
    if (n_w_atr + n_l_atr) < len(closed) * 0.5:
        print(f"  - ⚠️  أقل من 50٪ من الصفقات اتقدر حساب الـ ATR ليها — تأكد من إن الـ tickers موجودة في stocks.db")


def main():
    parser = argparse.ArgumentParser(description="Diagnose V3 backtest disaster (last 3 months)")
    parser.add_argument("--json", type=str, help="Path to backtest JSON file")
    parser.add_argument("--latest", action="store_true",
                        help="Use latest v3_backtest_*.json in backtest_results/")
    parser.add_argument("--db", type=str, default="db/stocks.db",
                        help="Path to stocks.db for ATR/Volume features")
    args = parser.parse_args()

    # تحديد ملف الـ JSON
    if args.latest:
        results_dir = _PROJECT_ROOT / "backtest_results"
        if not results_dir.exists():
            print(f"❌ backtest_results/ not found: {results_dir}")
            sys.exit(1)
        jsons = sorted(results_dir.glob("v3_backtest_*.json"))
        if not jsons:
            print(f"❌ No v3_backtest_*.json files in {results_dir}")
            sys.exit(1)
        json_path = jsons[-1]  # الأحدث
        print(f"📂 Using latest: {json_path}")
    elif args.json:
        json_path = Path(args.json)
        if not json_path.is_absolute():
            json_path = _PROJECT_ROOT / args.json
    else:
        parser.error("Specify --json PATH or --latest")

    # تحميل
    data = _load_backtest(json_path)
    trades = data.get("trades", [])

    print(f"\n📊 V3 Backtest Diagnosis")
    print(f"   File: {json_path.name}")
    print(f"   Market: {data.get('market', '?')}")
    print(f"   Period: {data.get('start_date', '?')} → {data.get('end_date', '?')}")
    print(f"   Trades: {len(trades)} (closed: {data.get('closed_trades', '?')})")
    print(f"   Total return: {data.get('total_return_pct', '?'):.2f}٪")
    print(f"   Win rate: {data.get('win_rate', '?'):.2f}٪")
    print(f"   Sharpe: {data.get('sharpe_ratio', '?'):.2f}")

    if not trades:
        print("\n❌ No trades in JSON — cannot diagnose")
        sys.exit(1)

    # جدول 1
    _table_1_loss_distribution(trades)

    # جدول 2
    db_path = _PROJECT_ROOT / args.db if not Path(args.db).is_absolute() else Path(args.db)
    _table_2_winner_vs_loser(trades, db_path)

    print("\n" + "=" * 94)
    print("✅ التشخيص اكتمل — بلا تعديل على V3 أو بناء موديلات")
    print("=" * 94)


if __name__ == "__main__":
    main()
