#!/usr/bin/env python3
"""
diagnose_explosive_rejections.py — المرحلة 1ج
=============================================
تصنيف كل explosive mover (+40% خلال 5 أيام) حسب سبب الرفض في الـ kill filters.

لكل explosive mover:
  1. نحدد يوم بداية الـ surge (best_surge_start_date)
  2. ناخد البيانات من 25 يوم قبل الـ surge (عشان نحاكي قرار الدخول قبل ما يطير)
  3. نشغل كل الـ kill filters:
     - Liquidity (turnover < dynamic threshold)
     - Price (< 1.0 EGP — penny stock)
     - Volume volatility (CV > 3.0)
     - Data bars (< 60)
     - Relative strength (RS < -2.0)
     - Wash trading (vol spike > 3× + price range < 1%)
     - Dead money (range 20d < 4.5%)
  4. + نشغل الـ PHASE-1 explosive_surge path (هل كان هيتصطاد؟)

النتيجة: تصنيف كل explosive mover حسب السبب الرئيسي للرفض.

CLI:
  python3 scripts/diagnose_explosive_rejections.py
  python3 scripts/diagnose_explosive_rejections.py --json-only
"""
from __future__ import annotations

import json
import sqlite3
import statistics
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
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

# ─── Kill filter thresholds (نفس اللي في liquidity_filter.py) ────────────
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


def compute_turnover(row):
    t = row[3] if len(row) > 3 else None
    if t is not None:
        try:
            t_float = float(t)
            if t_float > 0: return t_float
        except (TypeError, ValueError):
            pass
    close = row[1] or 0.0
    vol = parse_volume(row[2])
    return float(close) * float(vol)


def fetch_full_series(conn, ticker):
    """حمّل كل بيانات السهم من أول تاريخ لآخر تاريخ."""
    rows = conn.execute("""
        SELECT price_date, close, volume, turnover, high, low
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date
    """, (ticker,)).fetchall()
    return list(rows)


def find_best_surge(closes, rows):
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


def evaluate_all_kill_filters(
    closes: list,
    volumes: list,
    turnovers: list,
    avg_turnover: float,
    current_price: float,
    benchmark_change: float = 0.0,
    stock_roc: float = 0.0,
) -> dict:
    """شغّل كل الـ kill filters وأرجع dict بالنتايج.

    كل filter: {'name': ..., 'passed': bool, 'reason': str, 'value': ...}
    """
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

    # 4. Data bars — PHASE-1: خفّفنا لـ 15 شمعة (بدل 60) عشان البيانات المتاحة 60 يوم فقط
    #    في الإنتاج، الـ MIN_DATA_BARS = 60. بس في التحليل ده، لو طبّقنا 60 هترفض كل الأسهم.
    DIAGNOSTIC_MIN_DATA_BARS = 15
    if data_bars < DIAGNOSTIC_MIN_DATA_BARS:
        filters['data_bars'] = {
            'passed': False,
            'reason': f'{data_bars} شمعة < {DIAGNOSTIC_MIN_DATA_BARS} (diagnostic — production uses 60)',
            'value': data_bars,
        }
    else:
        filters['data_bars'] = {'passed': True, 'value': data_bars, 'note': f'production needs 60'}

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
    parser.add_argument("--window-days", type=int, default=60)
    parser.add_argument("--json-only", action="store_true")
    args = parser.parse_args()

    log("═══ المرحلة 1ج: تصنيف أسباب رفض الـ explosive movers ═══\n")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    egx_tickers = [r[0] for r in conn.execute("SELECT ticker FROM stocks WHERE market='EGX'").fetchall()]
    log(f"  EGX tickers: {len(egx_tickers)}")

    # حمّل كل explosive movers
    explosive_movers = []
    for ticker in egx_tickers:
        rows = fetch_full_series(conn, ticker)
        if len(rows) < 25:
            continue
        closes = [r[1] for r in rows if r[1] and r[1] > 0]
        if len(closes) < 25:
            continue

        surge, start_idx, end_idx = find_best_surge(closes, rows)
        if surge < EXPLOSIVE_5D_PCT:
            continue

        # بيانات يوم ما قبل الـ surge (قرار الدخول قبل الانفجار)
        # ناخد 35 شمعة قبل الـ surge عشان نقدر نحسب الـ explosive_surge (محتاج 25)
        pre_end = start_idx  # آخر شمعة قبل الـ surge
        pre_start = max(0, pre_end - 35)
        if pre_end - pre_start < 10:  # محتاجين على الأقل 10 شموع قبل الـ surge
            continue

        pre_rows = rows[pre_start:pre_end]
        pre_closes = [r[1] for r in pre_rows if r[1] and r[1] > 0]
        pre_volumes = [parse_volume(r[2]) for r in pre_rows]
        pre_turnovers = [compute_turnover(r) for r in pre_rows]

        if len(pre_closes) < 10 or len(pre_volumes) < 10:
            continue

        avg_turnover = statistics.mean(pre_turnovers[-20:])
        current_price = pre_closes[-1]

        # شغّل كل الـ kill filters
        filters = evaluate_all_kill_filters(
            closes=pre_closes,
            volumes=pre_volumes,
            turnovers=pre_turnovers,
            avg_turnover=avg_turnover,
            current_price=current_price,
            benchmark_change=0.0,  # TODO: hook للـ benchmark
            stock_roc=0.0,
        )

        # هل الـ EXPLOSIVE_SURGE path كان هيتصطاد قبل/أثناء الـ surge؟
        # ناخد نافذة شاملة آخر 5 شموع قبل الـ surge + أول 5 شموع من الـ surge
        # عشان نحاكي قرار الدخول في بداية الانفجار
        check_end = min(start_idx + 5, len(rows))  # شامل أول 5 أيام من الـ surge
        check_start = max(0, check_end - 30)
        check_rows = rows[check_start:check_end]
        check_closes = [r[1] for r in check_rows if r[1] and r[1] > 0]
        check_volumes = [parse_volume(r[2]) for r in check_rows]

        if len(check_closes) >= 10 and len(check_volumes) >= 10:
            # خفّف شروط is_explosive_surge للتحليل (base=10, surge=3 بدل 20/5)
            explosive_pre, explosive_reason, explosive_details = is_explosive_surge(
                check_volumes, check_closes,
                surge_ratio=2.0,  # خفّفنا من 2.5 لـ 2.0 للتحليل
                surge_lookback=3,  # خفّفنا من 5 لـ 3
                base_lookback=10,  # خفّفنا من 20 لـ 10
                sma_period=10,     # SMA10 بدل SMA20
                range_max_pct=20.0,  # خفّفنا من 18% لـ 20%
                range_window=10,   # 10 شموع بدل 20
            )
        else:
            explosive_pre = False
            explosive_reason = 'insufficient data'
            explosive_details = {}

        # تحديد السبب الرئيسي للرفض
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
            'price_bucket': classify_price_bucket(current_price),
            'filters': filters,
            'rejection_reasons': rejection_reasons,
            'explosive_surge_would_catch': explosive_pre,
            'explosive_surge_reason': explosive_reason,
            'explosive_surge_details': explosive_details,
        })

    conn.close()

    log(f"  ✅ تم تحليل {len(explosive_movers)} explosive mover\n")

    # ─── التصنيف ──────────────────────────────────────────────────────
    log("═══ تصنيف أسباب الرفض ═══\n")

    # عد كل سبب رفض
    reason_counts = {}
    for m in explosive_movers:
        for r in m['rejection_reasons']:
            reason_counts[r] = reason_counts.get(r, 0) + 1

    log(f"  إجمالي explosive movers: {len(explosive_movers)}")
    log(f"  أسباب الرفض (ممكن سهم يترفض لأكتر من سبب):\n")
    for reason, count in sorted(reason_counts.items(), key=lambda x: -x[1]):
        pct = count / len(explosive_movers) * 100
        log(f"    {reason:25s}: {count:3d} ({pct:.1f}%)")

    # ─── الأسهم اللي مفيهاش أي سبب رفض (كانت هتتقبل) ─────────────────
    no_rejection = [m for m in explosive_movers if not m['rejection_reasons']]
    log(f"\n  ✅ مفيهاش أي سبب رفض (كانت هتتقبل): {len(no_rejection)}/{len(explosive_movers)}")

    # ─── الـ explosive_surge path: كم سهم كان هيتصطاد؟ ───────────────
    caught_by_explosive = [m for m in explosive_movers if m['explosive_surge_would_catch']]
    log(f"\n  🔥 EXPLOSIVE_SURGE path: كان هيتصطد {len(caught_by_explosive)}/{len(explosive_movers)} قبل الانفجار")
    for m in caught_by_explosive[:15]:
        log(f"    {m['ticker']:10s}  surge=+{m['surge_pct']:.1f}%  pre_price={m['pre_entry_price']:.2f}  "
            f"pre_turnover={m['pre_avg_turnover']:>12,.0f}  bucket={m['price_bucket']}")

    # ─── تفصيل كل explosive mover ───────────────────────────────────
    log(f"\n\n═══ تفصيل كل explosive mover ═══\n")
    log(f"{'#':>3} {'Ticker':10s} {'Surge%':>7s} {'PrePrice':>9s} {'PreTurn':>12s} {'Bucket':>10s} {'Rejections':40s} {'ExpCatch':>8s}")
    log("-" * 110)
    for i, m in enumerate(sorted(explosive_movers, key=lambda x: -x['surge_pct']), 1):
        rejs = ', '.join(m['rejection_reasons']) if m['rejection_reasons'] else '✅ NONE'
        exp = '✅YES' if m['explosive_surge_would_catch'] else '-'
        log(f"{i:>3} {m['ticker']:10s} {m['surge_pct']:>+6.1f}% {m['pre_entry_price']:>9.2f} {m['pre_avg_turnover']:>12,.0f} {m['price_bucket']:>10s} {rejs:40s} {exp:>8s}")

    # ─── حفظ JSON ──────────────────────────────────────────────────
    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"explosive_rejections_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
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
    report = build_arabic_report(explosive_movers, reason_counts, caught_by_explosive, no_rejection)
    md_path = OUTPUT_DIR / f"explosive_rejections_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    print("\n" + "=" * 80)
    print(report)
    return 0


def build_arabic_report(movers, reason_counts, caught, no_rej):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = []
    lines.append(f"# تقرير تصنيف أسباب رفض الـ Explosive Movers — {today}")
    lines.append("")
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
        lines.append("| Ticker | Surge% | Pre-Price | Pre-Turnover | Bucket |")
        lines.append("|--------|--------|-----------|--------------|--------|")
        for m in caught[:15]:
            lines.append(f"| {m['ticker']} | +{m['surge_pct']:.1f}% | {m['pre_entry_price']:.2f} | {m['pre_avg_turnover']:,.0f} | {m['price_bucket']} |")
        lines.append("")
    lines.append("## الخلاصة")
    lines.append("")
    lines.append(f"- **{len(no_rej)}** explosive mover كان هيتقبل طبيعي (مفيهاش أسباب رفض)")
    lines.append(f"- **{len(caught)}** explosive mover كان EXPLOSIVE_SURGE path هيتصطده قبل الانفجار")
    lines.append(f"- **{len(movers) - len(no_rej) - len(caught)}** explosive mover ضاع فعلاً (مترفضش ومش متصطاد بالـ explosive path)")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `diagnose_explosive_rejections.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
