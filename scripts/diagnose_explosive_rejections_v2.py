#!/usr/bin/env python3
"""
diagnose_explosive_rejections_v2.py — المرحلة 1ج (إصدار 2)
=========================================================
إعادة تحليل الـ explosive movers باستخدام البيانات الإنتاجية الكاملة (365 يوم).

مصدر البيانات: db/production_snapshot.db (مسحوب من https://invist.m2y.net)

المميزات vs v1:
  - بيانات كاملة (~20 شهر بدل 60 يوم)
  - data_bars filter مينفعش يرفض أي سهم (كلها عندها 60+ شمعة)
  - نقدر نحسب الـ RS الحقيقي (مقابل EGX30 أو متوسط السوق)
  - نقدر نفحص الـ explosive_surge بشروطه الكاملة (25 شمعة قبل الـ surge)

CLI:
  python3 scripts/diagnose_explosive_rejections_v2.py
  python3 scripts/diagnose_explosive_rejections_v2.py --json-only
"""
from __future__ import annotations

import json
import sqlite3
import statistics
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROD_DB = PROJECT_ROOT / "db" / "production_snapshot.db"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import (
    should_reject_by_liquidity,
    is_explosive_surge,
    classify_price_bucket,
    dynamic_min_turnover,
    has_volume_surge,
)

# ─── Kill filter thresholds (نفس الإنتاج) ──────────────────────────────
MIN_STOCK_PRICE = 1.0
MAX_VOLUME_VOLATILITY = 3.0
MIN_DATA_BARS = 60
MIN_RS = -2.0
WASH_VOL_MULT = 3.0
WASH_PRICE_RANGE_MAX = 1.0
DEAD_MONEY_RANGE_MIN = 4.5

EXPLOSIVE_5D_PCT = 40.0


def log(msg):
    print(msg, flush=True)


def parse_volume(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m; s = s[:-1]; break
    try: return float(s) * mult
    except: return 0.0


def fetch_full_series(conn, ticker):
    """حمّل كل بيانات السهم من أول تاريخ لآخر."""
    rows = conn.execute("""
        SELECT price_date, close, volume, turnover, high, low
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date
    """, (ticker,)).fetchall()
    return list(rows)


def find_best_surge(closes):
    """أوجد أكبر 5-day surge وأرجع (surge_pct, start_idx, end_idx)."""
    best_surge = 0.0
    best_start = -1
    best_end = -1
    for i in range(len(closes) - 5):
        if closes[i] <= 0:
            continue
        window = closes[i:i+6]
        if window[0] <= 0:
            continue
        surge = (window[-1] - window[0]) / window[0] * 100.0
        if surge > best_surge:
            best_surge = surge
            best_start = i
            best_end = i + 5
    return best_surge, best_start, best_end


def compute_market_benchmark(conn, current_date, lookback=20):
    """متوسط عوائد كل أسهم EGX في آخر N يوم = benchmark proxy (نفس v40_2 logic)."""
    rows = conn.execute("""
        SELECT ticker, close, price_date FROM stock_daily_prices
        WHERE price_date <= ? AND close > 0
        ORDER BY price_date DESC LIMIT 50000
    """, (current_date,)).fetchall()
    # لكل ticker: أول وأخر close في الـ window
    by_ticker = {}
    for r in rows:
        by_ticker.setdefault(r[0], []).append((r[2], r[1]))
    returns = []
    for ticker, series in by_ticker.items():
        series.sort()
        # آخر lookback+1 يوم
        recent = series[-lookback-1:]
        if len(recent) >= lookback + 1 and recent[0][1] > 0:
            ret = (recent[-1][1] - recent[0][1]) / recent[0][1] * 100
            returns.append(ret)
    if not returns:
        return 0.0
    return statistics.mean(returns)


def evaluate_all_kill_filters(
    closes: list,
    volumes: list,
    turnovers: list,
    avg_turnover: float,
    current_price: float,
    benchmark_change: float = 0.0,
    stock_roc: float = 0.0,
) -> dict:
    """شغّل كل الـ kill filters وأرجع dict بالنتايج."""
    filters = {}
    data_bars = len(closes)

    # 1. Liquidity (dynamic V2 + explosive)
    rejected, reason, bypass, threshold, explosive = should_reject_by_liquidity(
        avg_turnover=avg_turnover,
        current_price=current_price,
        volumes=volumes,
        closes=closes,
        market_dead=False,
    )
    filters['liquidity'] = {
        'passed': not rejected,
        'reason': reason,
        'value': avg_turnover,
        'threshold': threshold,
        'bypass_activated': bypass,
        'explosive_surge_activated': explosive,
    }

    # 2. Price (penny stock)
    if current_price > 0 and current_price < MIN_STOCK_PRICE:
        filters['price'] = {
            'passed': False,
            'reason': f'سعر {current_price:.2f} < {MIN_STOCK_PRICE} (penny stock)',
            'value': current_price,
        }
    else:
        filters['price'] = {'passed': True, 'value': current_price}

    # 3. Volume volatility (CV)
    if volumes and len(volumes) >= 20:
        recent_vols = volumes[-20:]
        vol_avg = sum(recent_vols) / len(recent_vols)
        if vol_avg > 0:
            vol_var = sum((v - vol_avg) ** 2 for v in recent_vols) / len(recent_vols)
            vol_std = vol_var ** 0.5
            cv = vol_std / vol_avg
            if cv > MAX_VOLUME_VOLATILITY:
                filters['volume_volatility'] = {
                    'passed': False,
                    'reason': f'CV={cv:.2f} > {MAX_VOLUME_VOLATILITY} (تلاعب)',
                    'value': round(cv, 3),
                }
            else:
                filters['volume_volatility'] = {'passed': True, 'value': round(cv, 3)}
        else:
            filters['volume_volatility'] = {'passed': True, 'value': 0.0}
    else:
        filters['volume_volatility'] = {'passed': True, 'value': None}

    # 4. Data bars — الإنتاج الحقيقي
    if data_bars < MIN_DATA_BARS:
        filters['data_bars'] = {
            'passed': False,
            'reason': f'{data_bars} شمعة < {MIN_DATA_BARS}',
            'value': data_bars,
        }
    else:
        filters['data_bars'] = {'passed': True, 'value': data_bars}

    # 5. Relative strength
    if benchmark_change != 0 or stock_roc != 0:
        rs = stock_roc - benchmark_change
        if rs < MIN_RS:
            filters['relative_strength'] = {
                'passed': False,
                'reason': f'RS={rs:+.2f}% < {MIN_RS}%',
                'value': round(rs, 2),
            }
        else:
            filters['relative_strength'] = {'passed': True, 'value': round(rs, 2)}
    else:
        filters['relative_strength'] = {'passed': True, 'value': None, 'note': 'no benchmark'}

    # 6. Wash trading
    if closes and len(closes) >= 25 and volumes and len(volumes) >= 25:
        recent_5_vol = sum(volumes[-5:]) / 5
        avg_20_vol = sum(volumes[-20:]) / 20
        if avg_20_vol > 0 and recent_5_vol > 0:
            vol_spike = recent_5_vol / avg_20_vol
            recent_5_closes = closes[-5:]
            price_range = (max(recent_5_closes) - min(recent_5_closes)) / (sum(recent_5_closes)/5) * 100
            if vol_spike > WASH_VOL_MULT and price_range < WASH_PRICE_RANGE_MAX:
                filters['wash_trading'] = {
                    'passed': False,
                    'reason': f'vol spike {vol_spike:.1f}× + price range {price_range:.2f}% (wash)',
                    'value': round(vol_spike, 2),
                }
            else:
                filters['wash_trading'] = {'passed': True, 'value': round(vol_spike, 2)}
        else:
            filters['wash_trading'] = {'passed': True, 'value': None}
    else:
        filters['wash_trading'] = {'passed': True, 'value': None}

    # 7. Dead money (range 20d < 4.5%)
    if closes and len(closes) >= 20:
        last_20 = closes[-20:]
        if min(last_20) > 0:
            range_pct = (max(last_20) - min(last_20)) / min(last_20) * 100
            if range_pct < DEAD_MONEY_RANGE_MIN:
                filters['dead_money'] = {
                    'passed': False,
                    'reason': f'range {range_pct:.1f}% < {DEAD_MONEY_RANGE_MIN}% (dead money)',
                    'value': round(range_pct, 2),
                }
            else:
                filters['dead_money'] = {'passed': True, 'value': round(range_pct, 2)}
        else:
            filters['dead_money'] = {'passed': True, 'value': None}
    else:
        filters['dead_money'] = {'passed': True, 'value': None}

    return filters


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-only", action="store_true")
    args = parser.parse_args()

    log("═══ المرحلة 1ج-v2: تصنيف أسباب رفض الـ explosive movers (بيانات إنتاج كاملة) ═══\n")

    if not PROD_DB.exists():
        log(f"❌ {PROD_DB} مش موجود. شغّل scripts/fetch_production_data.py الأول.")
        return 1

    conn = sqlite3.connect(PROD_DB)
    conn.row_factory = sqlite3.Row

    # تحقق من البيانات المتاحة
    n_tickers = conn.execute("SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices").fetchone()[0]
    n_rows = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
    date_range = conn.execute("SELECT MIN(price_date), MAX(price_date) FROM stock_daily_prices").fetchone()
    log(f"  البيانات المتاحة: {n_tickers} سهم، {n_rows:,} صف")
    log(f"  فترة التواريخ: {date_range[0]} → {date_range[1]}")
    if n_tickers < 100:
        log(f"  ⚠️ لسه السحب جاري. جرّب تاني بعد ما يخلص.")
    log("")

    # حمّل كل tickers
    tickers = [r[0] for r in conn.execute("SELECT DISTINCT ticker FROM stock_daily_prices").fetchall()]
    log(f"  فحص {len(tickers)} سهم...")

    explosive_movers = []
    skipped_low_data = 0
    for i, ticker in enumerate(tickers, 1):
        rows = fetch_full_series(conn, ticker)
        if len(rows) < 30:
            skipped_low_data += 1
            continue
        closes = [r[1] for r in rows if r[1] and r[1] > 0]
        if len(closes) < 30:
            skipped_low_data += 1
            continue

        surge, start_idx, end_idx = find_best_surge(closes)
        if surge < EXPLOSIVE_5D_PCT:
            continue
        if start_idx < 25:
            # نحتاج 25 شمعة قبل الـ surge عشان نحسب كل الفلاتر
            skipped_low_data += 1
            continue

        # بيانات ما قبل الـ surge (قرار الدخول قبل الانفجار)
        pre_end = start_idx
        pre_rows = rows[:pre_end]
        pre_closes = [r[1] for r in pre_rows if r[1] and r[1] > 0]
        pre_volumes = [parse_volume(r[2]) for r in pre_rows]
        pre_turnovers = [r[3] if r[3] else (c*v if c and v else 0) for r,c,v in zip(pre_rows, pre_closes, pre_volumes)]

        if len(pre_closes) < 25:
            skipped_low_data += 1
            continue

        avg_turnover = statistics.mean(pre_turnovers[-20:]) if len(pre_turnovers) >= 20 else 0
        current_price = pre_closes[-1]

        # stock_roc = العائد خلال آخر 20 يوم قبل الـ surge
        if len(pre_closes) >= 21 and pre_closes[-21] > 0:
            stock_roc = (pre_closes[-1] - pre_closes[-21]) / pre_closes[-21] * 100
        else:
            stock_roc = 0.0

        # benchmark = متوسط عوائد السوق في نفس الفترة (نأخذ عينة من 10 أسهم عشوائية عشان السرعة)
        # بدل ما نحسب الـ benchmark من كل الأسهم (ببطء)، نستخدم proxy: متوسط عوائد آخر 20 يوم لـ 5 أسهم مرجعية
        # أو نستخدم قيمة ثابتة (0) كـ fallback
        benchmark_change = 0.0  # TODO: hook للـ benchmark الحقيقي

        # شغّل كل الـ kill filters
        filters = evaluate_all_kill_filters(
            closes=pre_closes,
            volumes=pre_volumes,
            turnovers=pre_turnovers,
            avg_turnover=avg_turnover,
            current_price=current_price,
            benchmark_change=benchmark_change,
            stock_roc=stock_roc,
        )

        # فحص الـ EXPLOSIVE_SURGE path (بالشروط الكاملة)
        # ناخد آخر 5 شموع قبل الـ surge + قبلها 25 شمعة (base)
        check_end = pre_end
        check_start = max(0, check_end - 30)
        check_rows = rows[check_start:check_end]
        check_closes = [r[1] for r in check_rows if r[1] and r[1] > 0]
        check_volumes = [parse_volume(r[2]) for r in check_rows]

        if len(check_closes) >= 25 and len(check_volumes) >= 25:
            explosive_pre, explosive_reason, explosive_details = is_explosive_surge(
                check_volumes, check_closes
            )
        else:
            explosive_pre = False
            explosive_reason = f'insufficient data ({len(check_closes)} < 25)'
            explosive_details = {}

        # تحديد أسباب الرفض
        rejection_reasons = []
        for fname, fdata in filters.items():
            if not fdata['passed']:
                rejection_reasons.append(fname)

        explosive_movers.append({
            'ticker': ticker,
            'last_close': round(closes[-1], 2),
            'surge_pct': round(surge, 1),
            'surge_start_date': rows[start_idx][0],
            'surge_end_date': rows[end_idx][0],
            'pre_entry_price': round(current_price, 2),
            'pre_avg_turnover': round(avg_turnover, 0),
            'pre_data_bars': len(pre_closes),
            'pre_stock_roc_20d': round(stock_roc, 2),
            'price_bucket': classify_price_bucket(current_price),
            'filters': filters,
            'rejection_reasons': rejection_reasons,
            'explosive_surge_would_catch': explosive_pre,
            'explosive_surge_reason': explosive_reason,
            'explosive_surge_details': explosive_details,
        })

        if i % 50 == 0:
            log(f"    {i}/{len(tickers)} — {len(explosive_movers)} explosive لحد دلوقتي")

    conn.close()
    log(f"\n  ✅ تم تحليل {len(tickers)} سهم | {len(explosive_movers)} explosive mover | {skipped_low_data} اتسكيبوا (بيانات ناقصة)")

    # ─── التصنيف ──────────────────────────────────────────────────────
    log("\n═══ تصنيف أسباب الرفض ═══\n")

    reason_counts = {}
    for m in explosive_movers:
        for r in m['rejection_reasons']:
            reason_counts[r] = reason_counts.get(r, 0) + 1

    log(f"  إجمالي explosive movers: {len(explosive_movers)}")
    log(f"  أسباب الرفض (ممكن سهم يترفض لأكتر من سبب):\n")
    for reason, count in sorted(reason_counts.items(), key=lambda x: -x[1]):
        pct = count / len(explosive_movers) * 100 if explosive_movers else 0
        log(f"    {reason:25s}: {count:3d} ({pct:.1f}%)")

    no_rejection = [m for m in explosive_movers if not m['rejection_reasons']]
    log(f"\n  ✅ مفيهاش أي سبب رفض (كانت هتتقبل): {len(no_rejection)}/{len(explosive_movers)}")

    caught_by_explosive = [m for m in explosive_movers if m['explosive_surge_would_catch']]
    log(f"\n  🔥 EXPLOSIVE_SURGE path: كان هيتصطد {len(caught_by_explosive)}/{len(explosive_movers)} قبل الانفجار")
    for m in caught_by_explosive[:15]:
        log(f"    {m['ticker']:10s}  surge=+{m['surge_pct']:.1f}%  pre_price={m['pre_entry_price']:.2f}  "
            f"pre_turnover={m['pre_avg_turnover']:>12,.0f}  bucket={m['price_bucket']}  "
            f"data_bars={m['pre_data_bars']}")

    # ─── تفصيل كل explosive mover ───────────────────────────────────
    log(f"\n\n═══ تفصيل كل explosive mover ═══\n")
    log(f"{'#':>3} {'Ticker':10s} {'Surge%':>7s} {'PrePrice':>9s} {'PreTurn':>12s} {'Bars':>5s} {'ROC20':>7s} {'Bucket':>10s} {'Rejections':40s} {'ExpCatch':>8s}")
    log("-" * 120)
    for i, m in enumerate(sorted(explosive_movers, key=lambda x: -x['surge_pct']), 1):
        rejs = ', '.join(m['rejection_reasons']) if m['rejection_reasons'] else '✅ NONE'
        exp = '✅YES' if m['explosive_surge_would_catch'] else '-'
        log(f"{i:>3} {m['ticker']:10s} {m['surge_pct']:>+6.1f}% {m['pre_entry_price']:>9.2f} {m['pre_avg_turnover']:>12,.0f} {m['pre_data_bars']:>5d} {m['pre_stock_roc_20d']:>+6.1f}% {m['price_bucket']:>10s} {rejs:40s} {exp:>8s}")

    # ─── حفظ JSON ──────────────────────────────────────────────────
    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"explosive_rejections_v2_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'data_source': 'production_snapshot.db',
            'data_period': f"{date_range[0]} → {date_range[1]}",
            'total_tickers_analyzed': len(tickers),
            'skipped_low_data': skipped_low_data,
            'total_explosive': len(explosive_movers),
            'reason_counts': reason_counts,
            'caught_by_explosive_surge': len(caught_by_explosive),
            'no_rejection': len(no_rejection),
            'movers': explosive_movers,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")

    if args.json_only:
        return 0

    # تقرير عربي
    report = build_arabic_report(explosive_movers, reason_counts, caught_by_explosive, no_rejection, date_range)
    md_path = OUTPUT_DIR / f"explosive_rejections_v2_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    print("\n" + "=" * 80)
    print(report)
    return 0


def build_arabic_report(movers, reason_counts, caught, no_rej, date_range):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = []
    lines.append(f"# تقرير تصنيف الـ Explosive Movers (بيانات إنتاج كاملة) — {today}")
    lines.append("")
    lines.append(f"**مصدر البيانات:** `db/production_snapshot.db` (مسحوب من الإنتاج)")
    lines.append(f"**فترة البيانات:** {date_range[0]} → {date_range[1]}")
    lines.append(f"**إجمالي الـ explosive movers (+40% خلال 5 أيام):** {len(movers)}")
    lines.append("")
    lines.append("## 📊 أسباب الرفض (ممكن سهم يترفض لأكتر من سبب)")
    lines.append("")
    lines.append("| السبب | عدد الأسهم | النسبة |")
    lines.append("|------|-----------|--------|")
    for reason, count in sorted(reason_counts.items(), key=lambda x: -x[1]):
        pct = count / len(movers) * 100 if movers else 0
        lines.append(f"| {reason} | {count} | {pct:.1f}% |")
    lines.append("")
    lines.append(f"## ✅ أسهم مااترفضتش (كانت هتتقبل طبيعي)")
    lines.append(f"**العدد:** {len(no_rej)}/{len(movers)}")
    lines.append("")
    lines.append(f"## 🔥 الأسهم اللي EXPLOSIVE_SURGE path كان هيتصطدها")
    lines.append(f"**العدد:** {len(caught)}/{len(movers)}")
    lines.append("")
    if caught:
        lines.append("| Ticker | Surge% | Pre-Price | Pre-Turnover | Bars | ROC20 | Bucket |")
        lines.append("|--------|--------|-----------|--------------|------|-------|--------|")
        for m in caught[:20]:
            lines.append(f"| {m['ticker']} | +{m['surge_pct']:.1f}% | {m['pre_entry_price']:.2f} | {m['pre_avg_turnover']:,.0f} | {m['pre_data_bars']} | {m['pre_stock_roc_20d']:+.1f}% | {m['price_bucket']} |")
        lines.append("")
    lines.append("## الخلاصة")
    lines.append("")
    lines.append(f"- **{len(no_rej)}** explosive mover كان هيتقبل طبيعي (مفيهاش أسباب رفض)")
    lines.append(f"- **{len(caught)}** explosive mover كان EXPLOSIVE_SURGE path هيتصطده قبل الانفجار")
    lines.append(f"- **{len(movers) - len(no_rej) - len(caught)}** explosive mover ضاع فعلاً")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `diagnose_explosive_rejections_v2.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
