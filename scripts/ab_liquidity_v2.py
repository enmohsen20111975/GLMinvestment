#!/usr/bin/env python3
"""
ab_liquidity_v2.py — A/B test للـ DYNAMIC-LIQUIDITY-V2
=======================================================
يقارن الـ kill filter القديم (3M strict / 500K closed) بالـ dynamic الجديد
(80K/200K/400K حسب سعر السهم + pump-and-dump guard + volume_surge_bypass).

المنهجية:
  1. لكل سهم EGX في آخر 60 يوم، احسب:
     - current_price
     - avg_turnover_20d (متوسط الـ turnover لآخر 20 يوم)
     - volumes_5d (آخر 5 شموع)
     - volumes_20d (متوسط 20 شموع)
     - closes (للـ MA20 + surge check)
  2. شغّل فلترين:
     - LEGACY (القديم): turnover >= 3M (strict) OR turnover >= 500K (closed)
     - DYNAMIC-V2 (الجديد): استخدم utils.shared_liquidity.should_reject_by_liquidity
  3. قارن:
     - عدد الأسهم المقبولة (tradeable)
     - كم explosive mover اتقبل بعد ما كان مرفوض
     - لو فيه backtest pipeline، شغّل PF/MaxDD على الـ tradeable universe

CLI:
  python3 scripts/ab_liquidity_v2.py
  python3 scripts/ab_liquidity_v2.py --json-only
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
from datetime import datetime
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# الـ imports من الـ vps-service
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

# استيراد الـ shared_liquidity الجديد
from utils.shared_liquidity import (
    dynamic_min_turnover as v2_dynamic_min_turnover,
    should_reject_by_liquidity as v2_should_reject,
    classify_price_bucket as v2_classify_bucket,
    DYNAMIC_TURNOVER_THRESHOLDS as V2_THRESHOLDS,
    LIQUIDITY_BYPASS_POSITION_SIZE,
)

# ─── Thresholds القديمة (LEGACY) ────────────────────────────────────────
LEGACY_STRICT_TURNOVER = 3_000_000      # MIN_TURNOVER (strict — السوق مفتوح)
LEGACY_CLOSED_TURNOVER = 500_000        # MIN_TURNOVER_CLOSED (السوق مقفول)

# عتبات الـ explosive movers (نفس اللي في diagnose_liquidity_rejections.py)
EXPLOSIVE_5D_PCT = 40.0


def log(msg: str):
    print(msg, flush=True)


def parse_volume(v):
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m
            s = s[:-1]
            break
    try:
        return float(s) * mult
    except Exception:
        return 0.0


def legacy_kill_filter(avg_turnover: float, strict_mode: bool = True) -> tuple[bool, str]:
    """الفلتر القديم: ثابت 3M (strict) أو 500K (closed)."""
    if avg_turnover <= 0:
        return False, "pump-and-dump guard — turnover=0"
    threshold = LEGACY_STRICT_TURNOVER if strict_mode else LEGACY_CLOSED_TURNOVER
    if avg_turnover < threshold:
        return False, f"turnover {avg_turnover:,.0f} < {threshold:,}"
    return True, f"turnover {avg_turnover:,.0f} ≥ {threshold:,}"


def v2_kill_filter(avg_turnover: float, current_price: float, volumes: list, closes: list) -> tuple[bool, str, bool, float]:
    """الفلتر الجديد: dynamic + pump-and-dump guard + volume_surge_bypass."""
    rejected, reason, bypass, threshold = v2_should_reject(
        avg_turnover=avg_turnover,
        current_price=current_price,
        volumes=volumes,
        closes=closes,
        market_dead=False,
    )
    return (not rejected), reason, bypass, threshold


def fetch_ticker_series(conn: sqlite3.Connection, ticker: str, days: int = 30):
    rows = conn.execute("""
        SELECT price_date, close, volume, turnover, high, low
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC
        LIMIT ?
    """, (ticker, days)).fetchall()
    return list(reversed(rows))


def compute_turnover(row) -> float:
    t = row[3]
    if t is not None:
        try:
            t_float = float(t)
            if t_float > 0:
                return t_float
        except (TypeError, ValueError):
            pass
    close = row[1] or 0.0
    vol = parse_volume(row[2])
    return float(close) * float(vol)


def analyze_ticker(rows, ticker: str):
    if len(rows) < 20:
        return None

    closes = [r[1] for r in rows if r[1] is not None and r[1] > 0]
    if not closes:
        return None

    last_close = closes[-1]
    last_20 = rows[-20:]
    turnovers = [compute_turnover(r) for r in last_20 if r[1] and r[1] > 0]
    avg_turnover_20d = statistics.mean(turnovers) if turnovers else 0.0
    volumes_20d = [parse_volume(r[2]) for r in last_20]

    # أكبر 5-day surge (للـ explosive classification)
    best_surge_pct = 0.0
    for i in range(len(closes) - 5):
        if closes[i] <= 0:
            continue
        window = closes[i:i+6]
        if window[0] <= 0:
            continue
        surge = (window[-1] - window[0]) / window[0] * 100.0
        if surge > best_surge_pct:
            best_surge_pct = surge

    is_explosive = best_surge_pct >= EXPLOSIVE_5D_PCT

    return {
        "ticker": ticker,
        "last_close": round(last_close, 4),
        "price_bucket": v2_classify_bucket(last_close),
        "avg_turnover_20d": round(avg_turnover_20d, 0),
        "volumes_20d": volumes_20d,
        "closes": closes,
        "best_surge_5d_pct": round(best_surge_pct, 2),
        "is_explosive": is_explosive,
    }


def main():
    parser = argparse.ArgumentParser(description="A/B test للـ DYNAMIC-LIQUIDITY-V2")
    parser.add_argument("--window-days", type=int, default=60)
    parser.add_argument("--json-only", action="store_true")
    args = parser.parse_args()

    log("═══ A/B Test: LEGACY (3M/500K) vs DYNAMIC-V2 (80K/200K/400K) ═══")
    log("")

    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row

    # كل EGX tickers مع بيانات كافية
    egx_tickers = {r[0] for r in conn.execute("SELECT ticker FROM stocks WHERE market = 'EGX'").fetchall()}
    rows = conn.execute("""
        SELECT DISTINCT ticker FROM stock_daily_prices
        WHERE price_date >= date((SELECT MAX(price_date) FROM stock_daily_prices), ?)
    """, (f"-{args.window_days} days",)).fetchall()
    tickers_with_data = egx_tickers & {r[0] for r in rows}
    log(f"  EGX tickers مع بيانات كافية: {len(tickers_with_data)}")

    results = []
    log(f"  بتحليل {len(tickers_with_data)} سهم...")
    for i, ticker in enumerate(sorted(tickers_with_data)):
        series = fetch_ticker_series(conn, ticker, days=args.window_days + 5)
        result = analyze_ticker(series, ticker)
        if result:
            # شغّل الفلترين على نفس السهم
            legacy_strict_passed, legacy_strict_reason = legacy_kill_filter(
                result["avg_turnover_20d"], strict_mode=True
            )
            legacy_closed_passed, legacy_closed_reason = legacy_kill_filter(
                result["avg_turnover_20d"], strict_mode=False
            )
            v2_passed, v2_reason, v2_bypass, v2_threshold = v2_kill_filter(
                result["avg_turnover_20d"],
                result["last_close"],
                result["volumes_20d"],
                result["closes"],
            )
            result["legacy_strict_passed"] = legacy_strict_passed
            result["legacy_closed_passed"] = legacy_closed_passed
            result["v2_passed"] = v2_passed
            result["v2_bypass"] = v2_bypass
            result["v2_threshold"] = v2_threshold
            result["v2_reason"] = v2_reason
            results.append(result)
        if (i + 1) % 100 == 0:
            log(f"    {i+1}/{len(tickers_with_data)}...")
    conn.close()

    log(f"\n✅ تم تحليل {len(results)} سهم")

    # ─── تحليل الـ A/B ─────────────────────────────────────────────────
    log("\n═══ A/B Comparison ═══\n")

    total = len(results)
    legacy_strict_count = sum(1 for r in results if r["legacy_strict_passed"])
    legacy_closed_count = sum(1 for r in results if r["legacy_closed_passed"])
    v2_count = sum(1 for r in results if r["v2_passed"])

    log(f"عدد الأسهم المقبولة:")
    log(f"  LEGACY (3M strict):    {legacy_strict_count:4d} ({legacy_strict_count/total*100:.1f}%)")
    log(f"  LEGACY (500K closed):  {legacy_closed_count:4d} ({legacy_closed_count/total*100:.1f}%)")
    log(f"  DYNAMIC-V2 (80K/200K/400K): {v2_count:4d} ({v2_count/total*100:.1f}%)")
    log(f"  الفرق (V2 - Closed): +{v2_count - legacy_closed_count} سهم")

    # explosive movers فقط
    explosive = [r for r in results if r["is_explosive"]]
    log(f"\n🔥 Explosive movers (+{EXPLOSIVE_5D_PCT}% خلال 5 أيام): {len(explosive)} سهم")
    legacy_strict_explosive = sum(1 for r in explosive if r["legacy_strict_passed"])
    legacy_closed_explosive = sum(1 for r in explosive if r["legacy_closed_passed"])
    v2_explosive = sum(1 for r in explosive if r["v2_passed"])
    log(f"  LEGACY (3M strict): قبل {legacy_strict_explosive}/{len(explosive)} ({legacy_strict_explosive/len(explosive)*100 if explosive else 0:.1f}%)")
    log(f"  LEGACY (500K closed): قبل {legacy_closed_explosive}/{len(explosive)} ({legacy_closed_explosive/len(explosive)*100 if explosive else 0:.1f}%)")
    log(f"  DYNAMIC-V2: قبل {v2_explosive}/{len(explosive)} ({v2_explosive/len(explosive)*100 if explosive else 0:.1f}%)")
    log(f"  الفرق (V2 - Closed): +{v2_explosive - legacy_closed_explosive} explosive إضافي تم قبوله ✅")

    # تفصيل الـ bypass
    bypass_count = sum(1 for r in results if r["v2_bypass"])
    bypass_explosive = sum(1 for r in explosive if r["v2_bypass"])
    log(f"\n📊 Volume Surge Bypass:")
    log(f"  إجمالي الـ bypass: {bypass_count} ({bypass_count/total*100:.1f}%)")
    log(f"  bypass في explosive: {bypass_explosive}/{len(explosive)}")

    # الأسهم اللي اترفضت في LEGACY بس اتعملها V2
    newly_accepted = [r for r in explosive if not r["legacy_closed_passed"] and r["v2_passed"]]
    log(f"\n🏆 Explosive movers اللي اتعملها V2 (كانت مرفوضة في LEGACY-Closed): {len(newly_accepted)}")
    for r in newly_accepted[:15]:
        log(f"  {r['ticker']:8s} price={r['last_close']:>8.2f}  surge=+{r['best_surge_5d_pct']:.1f}%  "
            f"bucket={r['price_bucket']:10s}  turnover={r['avg_turnover_20d']:>12,.0f}  "
            f"bypass={r['v2_bypass']}  threshold={r['v2_threshold']:,.0f}")

    # الأسهم اللي V2 بيرفضها بس LEGACY-Closed بيقبلها (نادر)
    newly_rejected = [r for r in explosive if r["legacy_closed_passed"] and not r["v2_passed"]]
    log(f"\n⚠️ Explosive movers V2 بيرفضها (LEGACY-Closed كان قبلها): {len(newly_rejected)}")
    for r in newly_rejected[:10]:
        log(f"  {r['ticker']:8s} price={r['last_close']:>8.2f}  surge=+{r['best_surge_5d_pct']:.1f}%  "
            f"bucket={r['price_bucket']:10s}  turnover={r['avg_turnover_20d']:>12,.0f}  "
            f"reason={r['v2_reason']}")

    # توزيع الـ accepted حسب bucket
    log(f"\n📊 توزيع الأسهم المقبولة حسب الـ price bucket:")
    log(f"  {'Bucket':12s} | {'LEGACY-3M':>10s} | {'LEGACY-500K':>11s} | {'DYNAMIC-V2':>11s} | {'Diff (V2-500K)':>15s}")
    log(f"  {'-'*12} | {'-'*10} | {'-'*11} | {'-'*11} | {'-'*15}")
    for bucket in ['low_price', 'mid_price', 'high_price']:
        legacy_3m = sum(1 for r in results if r["price_bucket"] == bucket and r["legacy_strict_passed"])
        legacy_500k = sum(1 for r in results if r["price_bucket"] == bucket and r["legacy_closed_passed"])
        v2_b = sum(1 for r in results if r["price_bucket"] == bucket and r["v2_passed"])
        diff = v2_b - legacy_500k
        log(f"  {bucket:12s} | {legacy_3m:>10d} | {legacy_500k:>11d} | {v2_b:>11d} | {diff:>+15d}")

    # حفظ JSON
    summary = {
        "generated_at": datetime.now().isoformat(),
        "window_days": args.window_days,
        "total_tickers": total,
        "legacy_strict_passed": legacy_strict_count,
        "legacy_closed_passed": legacy_closed_count,
        "v2_passed": v2_count,
        "explosive_count": len(explosive),
        "legacy_strict_explosive": legacy_strict_explosive,
        "legacy_closed_explosive": legacy_closed_explosive,
        "v2_explosive": v2_explosive,
        "bypass_count": bypass_count,
        "bypass_explosive": bypass_explosive,
        "newly_accepted_explosive_count": len(newly_accepted),
        "newly_rejected_explosive_count": len(newly_rejected),
        "v2_thresholds": V2_THRESHOLDS,
        "legacy_thresholds": {
            "strict": LEGACY_STRICT_TURNOVER,
            "closed": LEGACY_CLOSED_TURNOVER,
        },
    }

    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"ab_liquidity_v2_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "summary": summary,
            "results": results,
            "newly_accepted_explosive": newly_accepted,
            "newly_rejected_explosive": newly_rejected,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")

    if args.json_only:
        return 0

    # تقرير عربي
    report = build_arabic_report(summary, results, newly_accepted, newly_rejected)
    md_path = OUTPUT_DIR / f"ab_liquidity_v2_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    print("\n" + "="*80)
    print(report)
    return 0


def build_arabic_report(summary, results, newly_accepted, newly_rejected):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = []
    lines.append(f"# تقرير A/B Test — DYNAMIC-LIQUIDITY-V2 — {today}")
    lines.append("")
    lines.append("## المقارنة الأساسية")
    lines.append("")
    lines.append("| الفلتر | الحد | عدد الأسهم المقبولة | النسبة |")
    lines.append("|--------|-----|---------------------|--------|")
    lines.append(f"| LEGACY (Strict) | 3M EGP | {summary['legacy_strict_passed']} | {summary['legacy_strict_passed']/summary['total_tickers']*100:.1f}% |")
    lines.append(f"| LEGACY (Closed-relaxed) | 500K EGP | {summary['legacy_closed_passed']} | {summary['legacy_closed_passed']/summary['total_tickers']*100:.1f}% |")
    lines.append(f"| **DYNAMIC-V2** | 80K/200K/400K | **{summary['v2_passed']}** | **{summary['v2_passed']/summary['total_tickers']*100:.1f}%** |")
    lines.append("")
    lines.append(f"**الفرق (V2 - Closed-relaxed): +{summary['v2_passed'] - summary['legacy_closed_passed']} سهم إضافي**")
    lines.append("")
    lines.append("## 🔥 Explosive Movers (+40% خلال 5 أيام)")
    lines.append("")
    lines.append("| الفلتر | قبل | النسبة |")
    lines.append("|--------|-----|--------|")
    lines.append(f"| LEGACY (Strict 3M) | {summary['legacy_strict_explosive']}/{summary['explosive_count']} | {summary['legacy_strict_explosive']/summary['explosive_count']*100 if summary['explosive_count'] else 0:.1f}% |")
    lines.append(f"| LEGACY (Closed 500K) | {summary['legacy_closed_explosive']}/{summary['explosive_count']} | {summary['legacy_closed_explosive']/summary['explosive_count']*100 if summary['explosive_count'] else 0:.1f}% |")
    lines.append(f"| **DYNAMIC-V2** | **{summary['v2_explosive']}/{summary['explosive_count']}** | **{summary['v2_explosive']/summary['explosive_count']*100 if summary['explosive_count'] else 0:.1f}%** |")
    lines.append("")
    lines.append(f"**Explosive إضافي تم قبوله: +{summary['v2_explosive'] - summary['legacy_closed_explosive']}**")
    lines.append("")
    lines.append("## 📊 Volume Surge Bypass")
    lines.append("")
    lines.append(f"- إجمالي الـ bypass: {summary['bypass_count']}")
    lines.append(f"- bypass في explosive: {summary['bypass_explosive']}")
    lines.append(f"- position size للـ bypass: {LIQUIDITY_BYPASS_POSITION_SIZE*100}%")
    lines.append("")
    lines.append("## 🏆 Explosive movers اللي اتعملها V2 (كانت مرفوضة)")
    lines.append("")
    lines.append("| # | Ticker | Price | Bucket | Surge% | Turnover | Bypass |")
    lines.append("|---|--------|-------|--------|--------|----------|--------|")
    for i, r in enumerate(newly_accepted[:15], 1):
        bypass = "✅" if r["v2_bypass"] else "-"
        lines.append(f"| {i} | {r['ticker']} | {r['last_close']:.2f} | {r['price_bucket']} | +{r['best_surge_5d_pct']:.1f}% | {r['avg_turnover_20d']:,.0f} | {bypass} |")
    lines.append("")
    if newly_rejected:
        lines.append("## ⚠️ Explosive movers V2 بيرفضها (LEGACY كان يقبلها)")
        lines.append("")
        lines.append("| # | Ticker | Price | Bucket | Surge% | Turnover | السبب |")
        lines.append("|---|--------|-------|--------|--------|----------|------|")
        for i, r in enumerate(newly_rejected[:10], 1):
            lines.append(f"| {i} | {r['ticker']} | {r['last_close']:.2f} | {r['price_bucket']} | +{r['best_surge_5d_pct']:.1f}% | {r['avg_turnover_20d']:,.0f} | {r['v2_reason']} |")
        lines.append("")
    lines.append("## الخلاصة")
    lines.append("")
    lines.append(f"- **تم قبول +{summary['v2_explosive'] - summary['legacy_closed_explosive']} explosive mover إضافي** (كانت مرفوضة بالـ 500K)")
    lines.append(f"- **تم قبول +{summary['v2_passed'] - summary['legacy_closed_passed']} سهم إضافي** في الإجمالي")
    lines.append(f"- **{summary['bypass_count']} سهم** دخلوا بـ volume_surge_bypass (position size 2.5%)")
    lines.append(f"- **{summary['newly_rejected_explosive_count']} سهم** V2 رفضها (لو فيه أي حاجة غلط)")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `ab_liquidity_v2.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
