#!/usr/bin/env python3
"""
maker_radar.py — رادار الميكرز اليومي
=====================================
يسحب بيانات كل أسهم EGX من db/production_snapshot.db ويشغل عليها 3 مسارات:

  مسار أ — Quiet Accumulation (التجميع الهادئ) → حجم 2%
  مسار ب — Explosive Surge (انفجار) → حجم 2%
  مسار ج — Early Break (اختراق مبكر) → حجم 2.5%

النتيجة: قائمة الأسهم اللي تحت الميكروسكوب + تصنيف كل سهم.

CLI:
  python3 scripts/maker_radar.py
  python3 scripts/maker_radar.py --json-only
  python3 scripts/maker_radar.py --limit 50   # فحص 50 سهم بس (للتجربة)
"""
from __future__ import annotations

import argparse
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
    detect_quiet_accumulation,
    is_explosive_surge,
    classify_price_bucket,
    dynamic_min_turnover,
    QUIET_ACCUMULATION_POSITION_SIZE,
    EXPLOSIVE_SURGE_POSITION_SIZE,
)


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
    t = row['turnover']
    if t is not None:
        try:
            t_float = float(t)
            if t_float > 0: return t_float
        except (TypeError, ValueError):
            pass
    close = row['close'] or 0.0
    vol = parse_volume(row['volume'])
    return float(close) * float(vol)


def fetch_ticker_series(conn, ticker, days=40):
    rows = conn.execute("""
        SELECT price_date, open, high, low, close, volume, turnover
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC
        LIMIT ?
    """, (ticker, days)).fetchall()
    return list(reversed(rows))


def is_early_break(closes, volumes, highs=None):
    """مسار ج — Early Break: السهم طلع من النطاق الضيق بحجم.

    الشروط:
      1. آخر شمعة اخترقت max آخر 20 يوم (close > max(closes[-21:-1]))
      2. volume آخر شمعة > 1.5× avg_20d
      3. الـ 20 يوم قبلها كانت range < 15% (منضغطة)
    """
    if not closes or len(closes) < 21 or not volumes or len(volumes) < 21:
        return False, 'insufficient data'

    last_close = closes[-1]
    prev_20 = closes[-21:-1]
    max_20 = max(prev_20)
    min_20 = min(prev_20)

    # 1. اختراق القمة
    if last_close <= max_20:
        return False, f'close {last_close:.2f} ≤ max_20 {max_20:.2f}'

    # 2. volume > 1.5× avg
    avg_20_vol = sum(volumes[-21:-1]) / 20
    last_vol = volumes[-1]
    if avg_20_vol <= 0:
        return False, 'avg_20_vol = 0'
    vol_ratio = last_vol / avg_20_vol
    if vol_ratio < 1.5:
        return False, f'vol {vol_ratio:.2f}× < 1.5×'

    # 3. range 20d < 15%
    if min_20 <= 0:
        return False, 'min_20 = 0'
    range_pct = (max_20 - min_20) / min_20 * 100
    if range_pct >= 15.0:
        return False, f'range {range_pct:.1f}% ≥ 15%'

    return True, f'break: close {last_close:.2f} > max_20 {max_20:.2f}, vol {vol_ratio:.2f}×, range {range_pct:.1f}%'


def scan_ticker(rows, ticker):
    """يفحص سهم واحد على الـ 3 مسارات."""
    if len(rows) < 25:
        return None

    closes = [r['close'] for r in rows if r['close'] and r['close'] > 0]
    volumes = [parse_volume(r['volume']) for r in rows]
    highs = [r['high'] or r['close'] for r in rows]
    lows = [r['low'] or r['close'] for r in rows]
    turnovers = [compute_turnover(r) for r in rows]

    if len(closes) < 25 or len(volumes) < 25:
        return None

    current_price = closes[-1]
    avg_turnover_20d = statistics.mean(turnovers[-20:]) if len(turnovers) >= 20 else 0

    # مسار أ: Quiet Accumulation
    quiet, quiet_reason, quiet_details = detect_quiet_accumulation(closes, volumes, highs, lows)

    # مسار ب: Explosive Surge
    explosive, explosive_reason, explosive_details = is_explosive_surge(volumes, closes)

    # مسار ج: Early Break
    early_break, break_reason = is_early_break(closes, volumes, highs)

    # تحديد المسار الفائز (أولوية: quiet > explosive > early_break)
    # ليه quiet الأول؟ لأنه أصغر مخاطرة (السهم لسه ماطلعش)
    winner_path = None
    winner_position_size = 0.0
    winner_reason = ''
    if quiet:
        winner_path = 'A_quiet_accumulation'
        winner_position_size = QUIET_ACCUMULATION_POSITION_SIZE
        winner_reason = quiet_reason
    elif explosive:
        winner_path = 'B_explosive_surge'
        winner_position_size = EXPLOSIVE_SURGE_POSITION_SIZE
        winner_reason = explosive_reason
    elif early_break:
        winner_path = 'C_early_break'
        winner_position_size = 0.025  # 2.5%
        winner_reason = break_reason

    return {
        'ticker': ticker,
        'current_price': round(current_price, 2),
        'price_bucket': classify_price_bucket(current_price),
        'avg_turnover_20d': round(avg_turnover_20d, 0),
        'avg_volume_20d': round(statistics.mean(volumes[-20:]), 0),
        'roc_10d': round((closes[-1] - closes[-11]) / closes[-11] * 100, 2) if len(closes) >= 11 and closes[-11] > 0 else None,
        'under_microscope': winner_path is not None,
        'path': winner_path,
        'position_size': winner_position_size,
        'reason': winner_reason,
        'quiet_details': quiet_details if quiet else None,
        'explosive_details': explosive_details if explosive else None,
        'break_reason': break_reason if early_break else None,
    }


def main():
    parser = argparse.ArgumentParser(description='رادار الميكرز اليومي')
    parser.add_argument('--limit', type=int, default=0, help='0 = كل الأسهم')
    parser.add_argument('--json-only', action='store_true')
    args = parser.parse_args()

    log("═══ رادار الميكرز اليومي ═══")
    log(f"  DB: {PROD_DB}")

    if not PROD_DB.exists():
        log(f"❌ {PROD_DB} مش موجود. شغّل scripts/fetch_production_data.py الأول.")
        return 1

    conn = sqlite3.connect(PROD_DB)
    conn.row_factory = sqlite3.Row

    # كل tickers
    tickers = [r[0] for r in conn.execute("SELECT DISTINCT ticker FROM stock_daily_prices").fetchall()]
    if args.limit > 0:
        tickers = tickers[: args.limit]
    log(f"  فحص {len(tickers)} سهم...")

    results = []
    for i, ticker in enumerate(tickers, 1):
        rows = fetch_ticker_series(conn, ticker, days=40)
        result = scan_ticker(rows, ticker)
        if result:
            results.append(result)
        if i % 100 == 0:
            log(f"    {i}/{len(tickers)} — {sum(1 for r in results if r['under_microscope'])} تحت الميكروسكوب")
    conn.close()

    # ─── تصنيف النتايج ──────────────────────────────────────────────────
    under_microscope = [r for r in results if r['under_microscope']]
    quiet_list = [r for r in under_microscope if r['path'] == 'A_quiet_accumulation']
    explosive_list = [r for r in under_microscope if r['path'] == 'B_explosive_surge']
    early_break_list = [r for r in under_microscope if r['path'] == 'C_early_break']

    log(f"\n═══ النتايج ═══")
    log(f"  إجمالي الأسهم المفحوصة: {len(results)}")
    log(f"  🔬 تحت الميكروسكوب: {len(under_microscope)} ({len(under_microscope)/len(results)*100 if results else 0:.1f}%)")
    log(f"    مسار أ — Quiet Accumulation: {len(quiet_list)}")
    log(f"    مسار ب — Explosive Surge: {len(explosive_list)}")
    log(f"    مسار ج — Early Break: {len(early_break_list)}")

    # ─── عرض الأسهم تحت الميكروسكوب ────────────────────────────────────
    if under_microscope:
        log(f"\n═══ الأسهم تحت الميكروسكوب ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'Path':>22s} {'Size':>5s}")
        log("-" * 100)
        # رتّب: quiet الأول، بعدين explosive، بعدين early_break
        sorted_list = quiet_list + explosive_list + early_break_list
        for i, r in enumerate(sorted_list, 1):
            path_label = {
                'A_quiet_accumulation': '🎯 QUIET_ACC',
                'B_explosive_surge': '🔥 EXPLOSIVE',
                'C_early_break': '⚡ EARLY_BREAK',
            }.get(r['path'], r['path'])
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {path_label:>22s} {r['position_size']*100:>4.1f}%")

        # تفاصيل Quiet Accumulation
        if quiet_list:
            log(f"\n══─ تفاصيل مسار أ — Quiet Accumulation ══")
            for r in quiet_list:
                qd = r.get('quiet_details', {})
                log(f"\n  🎯 {r['ticker']} (price={r['current_price']:.2f}, turnover={r['avg_turnover_20d']:,.0f})")
                log(f"     {qd.get('signal_count', 0)}/6 إشارات متحققة:")
                for s in qd.get('signals_met', []):
                    log(f"       ✅ {s}")
                for s in qd.get('signals_failed', []):
                    log(f"       ❌ {s}")

    # ─── حفظ JSON ──────────────────────────────────────────────────────
    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"maker_radar_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_scanned': len(results),
            'under_microscope_count': len(under_microscope),
            'quiet_count': len(quiet_list),
            'explosive_count': len(explosive_list),
            'early_break_count': len(early_break_list),
            'under_microscope': under_microscope,
            'all_results': results,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")

    if args.json_only:
        return 0

    # تقرير عربي
    report = build_arabic_report(results, under_microscope, quiet_list, explosive_list, early_break_list)
    md_path = OUTPUT_DIR / f"maker_radar_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    print("\n" + "=" * 80)
    print(report)
    return 0


def build_arabic_report(results, under_microscope, quiet_list, explosive_list, early_break_list):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = []
    lines.append(f"# 🎯 رادار الميكرز اليومي — {today}")
    lines.append("")
    lines.append(f"**إجمالي الأسهم المفحوصة:** {len(results)}")
    lines.append(f"**🔬 تحت الميكروسكوب:** {len(under_microscope)} ({len(under_microscope)/len(results)*100 if results else 0:.1f}%)")
    lines.append("")
    lines.append("## 📊 توزيع المسارات")
    lines.append("")
    lines.append("| المسار | العدد | Position Size |")
    lines.append("|-------|------|---------------|")
    lines.append(f"| 🎯 أ — Quiet Accumulation | {len(quiet_list)} | 2% |")
    lines.append(f"| 🔥 ب — Explosive Surge | {len(explosive_list)} | 2% |")
    lines.append(f"| ⚡ ج — Early Break | {len(early_break_list)} | 2.5% |")
    lines.append("")
    if under_microscope:
        lines.append("## 🔬 الأسهم تحت الميكروسكوب")
        lines.append("")
        lines.append("| # | Ticker | Price | Bucket | Turnover | ROC10 | المسار | الحجم |")
        lines.append("|---|--------|-------|--------|----------|-------|--------|------|")
        sorted_list = quiet_list + explosive_list + early_break_list
        for i, r in enumerate(sorted_list, 1):
            path_label = {
                'A_quiet_accumulation': '🎯 QUIET_ACC',
                'B_explosive_surge': '🔥 EXPLOSIVE',
                'C_early_break': '⚡ EARLY_BREAK',
            }.get(r['path'], r['path'])
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            lines.append(f"| {i} | {r['ticker']} | {r['current_price']:.2f} | {r['price_bucket']} | {r['avg_turnover_20d']:,.0f} | {roc_str} | {path_label} | {r['position_size']*100:.1f}% |")
        lines.append("")

    if quiet_list:
        lines.append("## 🎯 تفاصيل Quiet Accumulation (الأولوية القصوى)")
        lines.append("")
        for r in quiet_list:
            qd = r.get('quiet_details', {})
            lines.append(f"### {r['ticker']} (price={r['current_price']:.2f}, turnover={r['avg_turnover_20d']:,.0f})")
            lines.append(f"**{qd.get('signal_count', 0)}/6 إشارات متحققة:**")
            lines.append("")
            for s in qd.get('signals_met', []):
                lines.append(f"- ✅ {s}")
            for s in qd.get('signals_failed', []):
                lines.append(f"- ❌ {s}")
            lines.append("")

    lines.append("## 📋 الخطوات القادمة")
    lines.append("")
    lines.append("1. أي سهم من القائمة دي → يتحط **paper** بحجم صغير (2-2.5%)")
    lines.append("2. مراجعة يومية: هل السهم فضل بـ يتجمع ولا بدأ يفرّغ؟")
    lines.append("3. لو ظهر توزيع واضح → خروج فوري")
    lines.append("4. لو وصل 1.5R → بيع جزء (partial)")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `maker_radar.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
