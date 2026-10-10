#!/usr/bin/env python3
"""
diagnose_liquidity_rejections.py
================================
تحليل جنائي: كم explosive mover كان هيُرفض بسبب الـ kill filter الثابت؟

السؤال الأساسي للمدير:
  "الـ filter بتاع سيولة ميتة ثابت على 600 ألف جنيه. الأسهم اللي بعد كده
   عملت 40% و 100% و أكتر كانت بتتداول بـ 100-500 سهم في اليوم قبل ما تنفجر.
   النظام شافها ميتة ورفضها، وبعدين هي طارت."

المنهجية:
  1. لكل سهم EGX، احسب آخر close + متوسط daily turnover لآخر 20 يوم
     (لو turnover field NULL → close × volume).
  2. حدد explosive movers: أي نافذة 5-أيام طلعت +40% أو أكثر.
  3. لكل explosive mover، احسب سيولته قبل الانفجار بـ 5 أيام
     (هل كان هيتعرض؟).
  4. صنّف الأسهم لـ 3 فئات حسب السعر:
     - low_price:  < 5 EGP       (مقترح المدير: حد 80-100K)
     - mid_price:  5-15 EGP      (مقترح المدير: حد 150-250K)
     - high_price: > 15 EGP      (مقترح المدير: حد 400-600K)
  5. لكل فئة: كم سهم، كم explosive، كم واحد كان هيُرفض بالـ 3M / 500K؟

CLI:
  python3 scripts/diagnose_liquidity_rejections.py
  python3 scripts/diagnose_liquidity_rejections.py --json-only
  python3 scripts/diagnose_liquidity_rejections.py --window-days 60
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ─── Thresholds الحالية في النظام ────────────────────────────────────────
MIN_TURNOVER_STRICT = 3_000_000      # liquidity_filter.py MIN_TURNOVER
MIN_TURNOVER_CLOSED = 500_000        # liquidity_filter.py MIN_TURNOVER_CLOSED
# المقترح الديناميكي (المدير):
#   low_price  (< 5 EGP):   80K-100K
#   mid_price  (5-15 EGP):  150K-250K
#   high_price (> 15 EGP):  400K-600K
DYNAMIC_TURNOVER_PROPOSED = {
    "low_price":  100_000,   # الحد الأعلى من مقترح المدير
    "mid_price":  250_000,
    "high_price": 600_000,
}

# عتبات الانفجار
EXPLOSIVE_5D_PCT = 40.0    # +40% خلال 5 أيام
SUPER_EXPLOSIVE_5D_PCT = 100.0   # +100% (الأكثر إثارة)


def log(msg: str):
    print(msg, flush=True)


def parse_volume(v):
    """يحوّل نص الحجم مع suffixes K/M/B لرقم (يتعامل مع Unicode narrow no-break space)."""
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


def classify_price_bucket(price: float) -> str:
    if price <= 0:
        return "unknown"
    if price < 5:
        return "low_price"
    if price <= 15:
        return "mid_price"
    return "high_price"


def get_egx_tickers(conn: sqlite3.Connection) -> set:
    rows = conn.execute("SELECT ticker FROM stocks WHERE market = 'EGX'").fetchall()
    return {r[0] for r in rows}


def get_market_tickers(conn: sqlite3.Connection) -> dict:
    """كل الأسواق، للتحليل العابر."""
    rows = conn.execute("SELECT ticker, market FROM stocks").fetchall()
    return {r[0]: r[1] for r in rows}


def fetch_ticker_series(conn: sqlite3.Connection, ticker: str, days: int):
    rows = conn.execute("""
        SELECT price_date, close, volume, turnover, high, low
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC
        LIMIT ?
    """, (ticker, days)).fetchall()
    # رتّب تصاعدي (الأقدم أولاً)
    rows = list(reversed(rows))
    return rows


def compute_turnover(row) -> float:
    """استخدم turnover field لو متاح، غير كده close × volume (parse_volume يدعم نصوص K/M/B)."""
    t = row[3]  # turnover
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
    """للسهم الواحد: حساب السعر الحالي + متوسط turnover 20d + أكبر 5-day surge."""
    if len(rows) < 6:
        return None

    closes = [r[1] for r in rows if r[1] is not None and r[1] > 0]
    if not closes:
        return None

    last_close = closes[-1]
    last_price_bucket = classify_price_bucket(last_close)

    # متوسط الـ turnover لآخر 20 يوم
    last_20 = rows[-20:]
    turnovers = [compute_turnover(r) for r in last_20 if r[1] and r[1] > 0]
    avg_turnover_20d = statistics.mean(turnovers) if turnovers else 0.0

    # متوسط الـ volume لآخر 20 يوم
    vols = [parse_volume(r[2]) for r in last_20]
    avg_volume_20d = statistics.mean(vols) if vols else 0.0

    # أكبر 5-day surge (نافذة متحركة)
    best_surge_pct = 0.0
    best_surge_idx = -1
    best_surge_start_date = None
    best_surge_end_date = None
    best_surge_start_price = None
    best_surge_end_price = None
    best_surge_turnover_before = 0.0  # سيولة السهم قبل الـ surge بـ 5 أيام

    for i in range(len(closes) - 5):
        if closes[i] <= 0:
            continue
        window = closes[i:i+6]  # 6 closes = 5-day move (د1→د6)
        if window[0] <= 0:
            continue
        surge = (window[-1] - window[0]) / window[0] * 100.0
        if surge > best_surge_pct:
            best_surge_pct = surge
            best_surge_idx = i
            best_surge_start_date = rows[i][0]
            best_surge_end_date = rows[i+5][0]
            best_surge_start_price = window[0]
            best_surge_end_price = window[-1]
            # turnover قبل الـ surge بـ 5 أيام (متوسط الـ 5 أيام السابقة على بداية الـ surge)
            pre_start = max(0, i - 5)
            pre_window = rows[pre_start:i] if i > 0 else rows[0:1]
            if pre_window:
                pre_turns = [compute_turnover(r) for r in pre_window if r[1] and r[1] > 0]
                best_surge_turnover_before = statistics.mean(pre_turns) if pre_turns else 0.0

    return {
        "ticker": ticker,
        "last_close": round(last_close, 4),
        "price_bucket": last_price_bucket,
        "avg_turnover_20d": round(avg_turnover_20d, 0),
        "avg_volume_20d": round(avg_volume_20d, 0),
        "best_surge_5d_pct": round(best_surge_pct, 2),
        "best_surge_start_date": best_surge_start_date,
        "best_surge_end_date": best_surge_end_date,
        "best_surge_start_price": round(best_surge_start_price, 4) if best_surge_start_price else None,
        "best_surge_end_price": round(best_surge_end_price, 4) if best_surge_end_price else None,
        "turnover_before_surge": round(best_surge_turnover_before, 0),
        "data_points": len(closes),
    }


def classify_explosive(result: dict) -> str:
    """قيمة الـ surge"""
    surge = result.get("best_surge_5d_pct", 0)
    if surge >= SUPER_EXPLOSIVE_5D_PCT:
        return "super_explosive"   # +100%
    if surge >= EXPLOSIVE_5D_PCT:
        return "explosive"          # +40%
    if surge >= 20:
        return "strong_mover"      # +20%
    if surge >= 10:
        return "mild_mover"        # +10%
    return "stagnant"


def would_be_killed_by(turnover_before_surge: float, threshold: float) -> bool:
    if turnover_before_surge <= 0:
        return True  # مفيش سيولة أصلاً
    return turnover_before_surge < threshold


def proposed_dynamic_threshold(price: float) -> int:
    bucket = classify_price_bucket(price)
    return DYNAMIC_TURNOVER_PROPOSED.get(bucket, MIN_TURNOVER_CLOSED)


def build_analysis(days: int = 30):
    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row

    # فترة البيانات
    r = conn.execute("SELECT MIN(price_date) mn, MAX(price_date) mx FROM stock_daily_prices").fetchone()
    log(f"  فترة البيانات: {r['mn']} → {r['mx']}")

    # هحلل EGX (م market الأساسي في التحليل بتاعنا)
    egx_tickers = get_egx_tickers(conn)
    log(f"  EGX tickers في stocks table: {len(egx_tickers)}")

    # ناخد الأسهم اللي عندها بيانات في آخر {days*2} يوم على الأقل
    window_days = max(days * 2, 30)  # على الأقل 30 يوم عشان نقدر نحسب 5-day surge + pre-surge turnover
    all_tickers_with_data = set()
    rows = conn.execute("""
        SELECT DISTINCT ticker FROM stock_daily_prices
        WHERE price_date >= date((SELECT MAX(price_date) FROM stock_daily_prices), ?)
    """, (f"-{window_days} days",)).fetchall()
    for row in rows:
        all_tickers_with_data.add(row[0])
    log(f"  tickers مع بيانات في آخر {window_days} يوم: {len(all_tickers_with_data)}")

    # فلتر EGX بس
    egx_with_data = egx_tickers & all_tickers_with_data
    log(f"  EGX tickers مع بيانات كافية: {len(egx_with_data)}")

    results = []
    log(f"  بتحليل {len(egx_with_data)} سهم...")
    for i, ticker in enumerate(sorted(egx_with_data)):
        series = fetch_ticker_series(conn, ticker, days=window_days + 5)
        result = analyze_ticker(series, ticker)
        if result:
            result["explosive_class"] = classify_explosive(result)
            results.append(result)
        if (i + 1) % 100 == 0:
            log(f"    {i+1}/{len(egx_with_data)} تحليلين...")
    conn.close()

    return results, {"window_days": window_days, "start_date": r["mn"], "end_date": r["mx"]}


def summarize(results: list, info: dict):
    """تحليل إحصائي للنتائج."""
    total = len(results)
    log(f"\n═══ ملخص تحليل {total} سهم EGX ═══")
    log(f"  فترة البيانات: {info['start_date']} → {info['end_date']} ({info['window_days']} يوم)")

    # 1) توزيع الـ explosive classes
    log("\n[1] توزيع الـ explosive classes:")
    class_counts = {}
    for r in results:
        c = r["explosive_class"]
        class_counts[c] = class_counts.get(c, 0) + 1
    for c, n in sorted(class_counts.items(), key=lambda x: -x[1]):
        pct = n / total * 100
        log(f"    {c:20s}: {n:4d} ({pct:5.1f}%)")

    # 2) توزيع الأسعار (buckets)
    log("\n[2] توزيع الأسعار:")
    bucket_counts = {}
    for r in results:
        b = r["price_bucket"]
        bucket_counts[b] = bucket_counts.get(b, 0) + 1
    for b, n in sorted(bucket_counts.items(), key=lambda x: -x[1]):
        pct = n / total * 100
        log(f"    {b:12s}: {n:4d} ({pct:5.1f}%)")

    # 3) Explosive movers فقط — تحليل القتل
    explosive = [r for r in results if r["explosive_class"] in ("explosive", "super_explosive")]
    log(f"\n[3] 🔥 EXPLOSIVE MOVERS ({len(explosive)} سهم بـ +40%+ خلال 5 أيام):")
    log(f"    توزيع الأسعار في الـ explosive:")
    for b in ["low_price", "mid_price", "high_price"]:
        n = sum(1 for r in explosive if r["price_bucket"] == b)
        pct = n / len(explosive) * 100 if explosive else 0
        log(f"      {b:12s}: {n:3d} ({pct:5.1f}%)")

    # 4) هل الـ explosive movers كان هيُرفض بالـ strict / closed threshold؟
    log(f"\n[4] ❌ كم explosive mover كان هيُرفض بالـ kill filter الحالي؟")
    killed_strict = []
    killed_closed = []
    killed_dynamic = []
    for r in explosive:
        tb = r["turnover_before_surge"]
        if tb <= 0:
            killed_strict.append(r)
            killed_closed.append(r)
            killed_dynamic.append(r)
            continue
        if tb < MIN_TURNOVER_STRICT:
            killed_strict.append(r)
        if tb < MIN_TURNOVER_CLOSED:
            killed_closed.append(r)
        # الحد الديناميكي المقترح
        dyn_t = proposed_dynamic_threshold(r["last_close"])
        if tb < dyn_t:
            killed_dynamic.append(r)

    log(f"    {len(killed_strict):3d}/{len(explosive)} ({len(killed_strict)/len(explosive)*100 if explosive else 0:.1f}%) كان هيتعرض بالـ strict (3M EGP)")
    log(f"    {len(killed_closed):3d}/{len(explosive)} ({len(killed_closed)/len(explosive)*100 if explosive else 0:.1f}%) كان هيتعرض بالـ closed-relaxed (500K EGP)")
    log(f"    {len(killed_dynamic):3d}/{len(explosive)} ({len(killed_dynamic)/len(explosive)*100 if explosive else 0:.1f}%) كان هيتعرض بالـ dynamic المقترح (low=100K/mid=250K/high=600K)")

    # 5) التوزيع حسب الـ price bucket لكل الـ explosive movers
    log(f"\n[5] 📊 توزيع الـ explosive movers حسب سيولتهم قبل الانفجار:")
    for b in ["low_price", "mid_price", "high_price"]:
        sub = [r for r in explosive if r["price_bucket"] == b]
        if not sub:
            continue
        killed_strict_b = [r for r in sub if r["turnover_before_surge"] < MIN_TURNOVER_STRICT]
        killed_closed_b = [r for r in sub if r["turnover_before_surge"] < MIN_TURNOVER_CLOSED]
        dyn_t = DYNAMIC_TURNOVER_PROPOSED[b]
        killed_dyn_b = [r for r in sub if r["turnover_before_surge"] < dyn_t]
        log(f"\n  {b} ({len(sub)} explosive, المقترح {dyn_t:,} EGP):")
        log(f"    killed by 3M strict:  {len(killed_strict_b):3d}/{len(sub)} ({len(killed_strict_b)/len(sub)*100 if sub else 0:.1f}%)")
        log(f"    killed by 500K closed:{len(killed_closed_b):3d}/{len(sub)} ({len(killed_closed_b)/len(sub)*100 if sub else 0:.1f}%)")
        log(f"    killed by dyn {dyn_t:>7,}: {len(killed_dyn_b):3d}/{len(sub)} ({len(killed_dyn_b)/len(sub)*100 if sub else 0:.1f}%)")
        # median turnover
        turns = sorted([r["turnover_before_surge"] for r in sub])
        if turns:
            median_t = turns[len(turns) // 2]
            log(f"    median turnover قبل الانفجار: {median_t:,.0f} EGP")
            log(f"    range: {turns[0]:,.0f} → {turns[-1]:,.0f} EGP")

    return {
        "total": total,
        "explosive_count": len(explosive),
        "class_counts": class_counts,
        "bucket_counts": bucket_counts,
        "explosive_by_bucket": {b: sum(1 for r in explosive if r["price_bucket"] == b) for b in ["low_price", "mid_price", "high_price"]},
        "killed_strict": len(killed_strict),
        "killed_closed": len(killed_closed),
        "killed_dynamic": len(killed_dynamic),
    }


def top_explosive_table(results: list, top_n: int = 20):
    explosive = [r for r in results if r["explosive_class"] in ("explosive", "super_explosive")]
    explosive.sort(key=lambda x: x["best_surge_5d_pct"], reverse=True)
    lines = []
    lines.append(f"\n[6] 🏆 Top-{min(top_n, len(explosive))} explosive movers — مع تحليل الرفض:")
    lines.append("")
    lines.append(f"{'#':>3} {'Ticker':8s} {'Price':>8s} {'Bucket':>10s} {'Surge%':>7s} {'5d Window':>24s} {'TurnBefore':>12s} {'3Mkill':>6s} {'500Kkill':>8s} {'DynKill':>7s}")
    for i, r in enumerate(explosive[:top_n], 1):
        tb = r["turnover_before_surge"]
        kill_strict = "Y" if tb < MIN_TURNOVER_STRICT else "-"
        kill_closed = "Y" if tb < MIN_TURNOVER_CLOSED else "-"
        dyn_t = proposed_dynamic_threshold(r["last_close"])
        kill_dyn = "Y" if tb < dyn_t else "-"
        window = f"{r['best_surge_start_date']}→{r['best_surge_end_date']}"
        lines.append(
            f"{i:>3} {r['ticker']:8s} {r['last_close']:>8.2f} {r['price_bucket']:>10s} "
            f"{r['best_surge_5d_pct']:>7.1f} {window:>24s} {tb:>12,.0f} {kill_strict:>6s} {kill_closed:>8s} {kill_dyn:>7s}"
        )
    return "\n".join(lines)


def build_arabic_report(results: list, summary: dict, info: dict) -> str:
    today = datetime.now().strftime("%Y-%m-%d")
    lines = []
    lines.append(f"# تقرير تشخيص الرفض بسبب السيولة — {today}")
    lines.append(f"")
    lines.append(f"**فترة البيانات:** {info['start_date']} → {info['end_date']} ({info['window_days']} يوم)")
    lines.append(f"**إجمالي الأسهم المحللة:** {summary['total']} سهم EGX")
    lines.append(f"**Explosive movers (+40% خلال 5 أيام):** {summary['explosive_count']}")
    lines.append(f"")
    lines.append(f"## الملخص التنفيذي")
    lines.append(f"")
    lines.append(f"السؤال: كم explosive mover كان هيُرفض بالـ kill filter الثابت الحالي؟")
    lines.append(f"")
    lines.append(f"| الـ Kill Filter | الحد | Explosive movers هيُرفض | النسبة |")
    lines.append(f"|----------------|-----|------------------------|--------|")
    e = summary["explosive_count"]
    lines.append(f"| Strict (السوق مفتوح) | 3,000,000 EGP | {summary['killed_strict']} | {summary['killed_strict']/e*100 if e else 0:.1f}% |")
    lines.append(f"| Closed-relaxed (السوق مقفول) | 500,000 EGP | {summary['killed_closed']} | {summary['killed_closed']/e*100 if e else 0:.1f}% |")
    lines.append(f"| **Dynamic المقترح (price-tiered)** | 100K/250K/600K | {summary['killed_dynamic']} | {summary['killed_dynamic']/e*100 if e else 0:.1f}% |")
    lines.append(f"")
    lines.append(f"## توزيع الأسعار في الـ explosive movers")
    lines.append(f"")
    lines.append(f"| الـ bucket | عدد explosive movers | النسبة | المقترح (EGP) |")
    lines.append(f"|-----------|---------------------|--------|---------------|")
    for b in ["low_price", "mid_price", "high_price"]:
        n = summary["explosive_by_bucket"].get(b, 0)
        pct = n / e * 100 if e else 0
        threshold = DYNAMIC_TURNOVER_PROPOSED[b]
        lines.append(f"| {b} | {n} | {pct:.1f}% | {threshold:,} |")
    lines.append(f"")
    lines.append(f"## التوصية")
    lines.append(f"")
    lines.append(f"بناءً على التحليل أعلاه:")
    lines.append(f"1. لو {summary['killed_closed']} من {e} explosive movers (≈{summary['killed_closed']/e*100 if e else 0:.1f}%) كان هيُرفض بـ 500K → دي خسارة فادحة.")
    lines.append(f"2. لو الـ dynamic المقترح بـ يقتل {summary['killed_dynamic']} بس → تخفيف ممتاز بدون قتل النظام.")
    lines.append(f"3. لازم نشوف توزيع الـ turnover قبل الانفجار في كل bucket (median + range) عشان نحدد الحد الأدنى بدقة.")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"*تم التوليد بواسطة `diagnose_liquidity_rejections.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="تشخيص الرفض بسبب السيولة")
    parser.add_argument("--window-days", type=int, default=30, help="فترة التحليل (افتراضي 30)")
    parser.add_argument("--json-only", action="store_true")
    args = parser.parse_args()

    log("═══ تشخيص الرفض بسبب السيولة ═══")
    log(f"فترة التحليل: آخر {args.window_days} يوم")
    log("")

    results, info = build_analysis(days=args.window_days)
    log(f"\n✅ تم تحليل {len(results)} سهم EGX")

    if args.json_only:
        data = {
            "generated_at": datetime.now().isoformat(),
            "info": info,
            "results": results,
            "thresholds": {
                "MIN_TURNOVER_STRICT": MIN_TURNOVER_STRICT,
                "MIN_TURNOVER_CLOSED": MIN_TURNOVER_CLOSED,
                "DYNAMIC_PROPOSED": DYNAMIC_TURNOVER_PROPOSED,
            },
        }
        today_str = datetime.now().strftime("%Y%m%d")
        out_path = OUTPUT_DIR / f"liquidity_rejections_{today_str}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        log(f"\n✅ JSON saved: {out_path}")
        return 0

    summary = summarize(results, info)
    print(top_explosive_table(results, top_n=20))

    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"liquidity_rejections_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "info": info,
            "summary": summary,
            "results": results,
            "thresholds": {
                "MIN_TURNOVER_STRICT": MIN_TURNOVER_STRICT,
                "MIN_TURNOVER_CLOSED": MIN_TURNOVER_CLOSED,
                "DYNAMIC_PROPOSED": DYNAMIC_TURNOVER_PROPOSED,
            },
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")

    report = build_arabic_report(results, summary, info)
    md_path = OUTPUT_DIR / f"liquidity_rejections_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
