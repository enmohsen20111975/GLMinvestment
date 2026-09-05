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
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import (
    detect_quiet_accumulation,
    detect_pre_surge,
    is_explosive_surge,
    classify_price_bucket,
    dynamic_min_turnover,
    QUIET_ACCUMULATION_POSITION_SIZE,
    PRE_SURGE_POSITION_SIZE,
    EXPLOSIVE_SURGE_POSITION_SIZE,
)


# ============================================================================
# PORTABLE DB DETECTION — يشتغل في sandbox + laptop + production
# ============================================================================
# Fallback chain:
#   1. db/production_snapshot.db  (sandbox — بيانات مسحوبة من الإنتاج)
#   2. db/vps_real/stocks.db       (sandbox — نسخة من VPS)
#   3. db/stocks.db                (production)
#   4. db/data_engine.db (historical_data) — fallback أخير
def _find_radar_db():
    """اكتشف الـ DB المتاح تلقائياً. يرجع (db_path, table_name, columns...).
    يتحقق إن الجدول مش فاضي (عشان egksco_price_history الفاضية ما تفضلش).
    """
    candidates = [
        # 1. data_engine.db.egksco_price_history — الـ source of truth في الإنتاج
        #    schema حقيقي: symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover
        ('db/data_engine.db', 'egksco_price_history', 'symbol', 'close_price', 'volume', 'turnover', 'price_date', 'open_price', 'high_price', 'low_price'),
        # 2. stocks.db.stock_daily_prices — fallback (فيه EGX في الإنتاج + sandbox)
        ('db/stocks.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
        # 3. data_engine.db.historical_data — fallback للأسواق التانية (سعودي/أمريكي)
        #    schema: symbol, date, open, high, low, close, volume (مفيش turnover)
        ('db/data_engine.db', 'historical_data', 'symbol', 'close', 'volume', None, 'date', 'open', 'high', 'low'),
        # 4. sandbox fallbacks
        ('db/production_snapshot.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
        ('db/vps_real/stocks.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
    ]
    for db_rel, table, ticker_col, price_col, vol_col, turn_col, date_col, open_col, high_col, low_col in candidates:
        db_path = PROJECT_ROOT / db_rel
        if not db_path.exists():
            continue
        try:
            import sqlite3 as _sql
            conn = _sql.connect(str(db_path))
            # تحقق إن الـ table موجود
            cur = conn.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
            row = cur.fetchone()
            if not row:
                conn.close()
                continue
            # تحقق إن الجدول مش فاضي
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.close()
            if n == 0:
                continue  # جرّب اللي بعده
            return db_path, table, ticker_col, price_col, vol_col, turn_col, date_col, open_col, high_col, low_col
        except Exception:
            continue
    return None, None, None, None, None, None, None, None, None, None


PROD_DB, PROD_TABLE, TICKER_COL, PRICE_COL, VOL_COL, TURN_COL, DATE_COL, OPEN_COL, HIGH_COL, LOW_COL = _find_radar_db()


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
    """احسب turnover من row — portable (يدعم turnover/value field أو close × volume)."""
    t = None
    try:
        if TURN_COL and TURN_COL in row.keys():
            t = row[TURN_COL]
    except Exception:
        pass
    if t is not None:
        try:
            t_float = float(t)
            if t_float > 0: return t_float
        except (TypeError, ValueError):
            pass
    close = row.get(PRICE_COL) or row.get('close') or 0.0
    vol = parse_volume(row.get(VOL_COL) or row.get('volume'))
    return float(close) * float(vol)


def fetch_ticker_series(conn, ticker, days=40):
    """جلب بيانات سهم — portable (يستخدم column names المكتشفة)."""
    # استخدم column names المكتشفة بدلاً من hardcoded names
    cols = f"{DATE_COL}, {OPEN_COL} as open, {HIGH_COL} as high, {LOW_COL} as low, {PRICE_COL} as close, {VOL_COL} as volume"
    if TURN_COL:
        cols += f", {TURN_COL} as turnover"
    else:
        cols += ", NULL as turnover"
    query = f"""
        SELECT {cols}
        FROM {PROD_TABLE}
        WHERE {TICKER_COL} = ? AND {PRICE_COL} IS NOT NULL AND {PRICE_COL} > 0
        ORDER BY {DATE_COL} DESC
        LIMIT ?
    """
    rows = conn.execute(query, (ticker, days)).fetchall()
    # رجّع standardized keys عشان باقي الكود يشتغل
    normalized = []
    for r in rows:
        d = dict(r)
        # unify keys
        d['price_date'] = d.get(DATE_COL) or d.get('date') or d.get('price_date')
        d['close'] = d.get('close') or d.get(PRICE_COL)
        d['volume'] = d.get('volume') or d.get(VOL_COL)
        d['turnover'] = d.get('turnover') if TURN_COL else None
        d['open'] = d.get('open') or d.get(OPEN_COL)
        d['high'] = d.get('high') or d.get(HIGH_COL)
        d['low'] = d.get('low') or d.get(LOW_COL)
        normalized.append(d)
    return list(reversed(normalized))


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
    """يفحص سهم واحد على الـ 4 مسارات (مع Pre-Surge كأولوية أولى)."""
    # تخفيف الـ lookback من 25 لـ 15 يوم (قرار المالك 2026-09-05)
    if len(rows) < 15:
        return None

    closes = [r['close'] for r in rows if r['close'] and r['close'] > 0]
    volumes = [parse_volume(r['volume']) for r in rows]
    highs = [r['high'] or r['close'] for r in rows]
    lows = [r['low'] or r['close'] for r in rows]
    turnovers = [compute_turnover(r) for r in rows]

    if len(closes) < 15 or len(volumes) < 15:
        return None

    current_price = closes[-1]
    avg_turnover_20d = statistics.mean(turnovers[-20:]) if len(turnovers) >= 20 else (statistics.mean(turnovers) if turnovers else 0)
    avg_volume_20d = statistics.mean(volumes[-20:]) if len(volumes) >= 20 else (statistics.mean(volumes) if volumes else 0)
    avg_volume_10d = statistics.mean(volumes[-10:]) if len(volumes) >= 10 else 0

    # مقاييس الترتيب: قوة الحجم النسبي + استقرار السعر
    volume_ratio_10d_vs_20d = (avg_volume_10d / avg_volume_20d) if avg_volume_20d > 0 else 0
    # استقرار السعر: 1 - (range_10d_pct / 20) → كل ما range أقل، كل ما stability أعلى
    min_10 = min(closes[-10:])
    max_10 = max(closes[-10:])
    range_10d_pct = ((max_10 - min_10) / min_10 * 100) if min_10 > 0 else 0
    price_stability = max(0.0, 1.0 - (range_10d_pct / 20.0))  # 0..1

    # PHASE-3: Pre-Surge (الأولوية الأولى — تجميع مبكر جداً)
    pre_surge, pre_surge_reason, pre_surge_details = detect_pre_surge(closes, volumes, highs, lows)

    # مسار أ: Quiet Accumulation
    quiet, quiet_reason, quiet_details = detect_quiet_accumulation(closes, volumes, highs, lows)

    # مسار ب: Explosive Surge
    explosive, explosive_reason, explosive_details = is_explosive_surge(volumes, closes)

    # مسار ج: Early Break
    early_break, break_reason = is_early_break(closes, volumes, highs)

    # تحديد المسار الفائز (ترتيب الأولوية الجديد):
    # 1. Pre-Surge (تجميع مبكر جدًا) → حجم 1.5%
    # 2. Quiet Accumulation 5-6/6 → حجم 2%
    # 3. Quiet Accumulation 4/6 → حجم 1.5%
    # 4. Explosive Surge → حجم 2%
    # 5. Early Break → حجم 2.5%
    winner_path = None
    winner_position_size = 0.0
    winner_reason = ''
    quiet_signals = quiet_details.get('signal_count', 0) if quiet else 0

    if pre_surge:
        winner_path = 'A_pre_surge'
        winner_position_size = PRE_SURGE_POSITION_SIZE  # 1.5%
        winner_reason = pre_surge_reason
    elif quiet and quiet_signals >= 5:
        winner_path = 'B_quiet_accumulation_strong'
        winner_position_size = QUIET_ACCUMULATION_POSITION_SIZE  # 2%
        winner_reason = quiet_reason
    elif quiet and quiet_signals >= 4:
        winner_path = 'C_quiet_accumulation_weak'
        winner_position_size = 0.015  # 1.5% (أضعف)
        winner_reason = quiet_reason
    elif explosive:
        winner_path = 'D_explosive_surge'
        winner_position_size = EXPLOSIVE_SURGE_POSITION_SIZE  # 2%
        winner_reason = explosive_reason
    elif early_break:
        winner_path = 'E_early_break'
        winner_position_size = 0.025  # 2.5%
        winner_reason = break_reason

    return {
        'ticker': ticker,
        'current_price': round(current_price, 2),
        'price_bucket': classify_price_bucket(current_price),
        'avg_turnover_20d': round(avg_turnover_20d, 0),
        'avg_volume_20d': round(avg_volume_20d, 0),
        'avg_volume_10d': round(avg_volume_10d, 0),
        'volume_ratio_10d_vs_20d': round(volume_ratio_10d_vs_20d, 2),
        'price_stability': round(price_stability, 3),
        'range_10d_pct': round(range_10d_pct, 2),
        'roc_10d': round((closes[-1] - closes[-11]) / closes[-11] * 100, 2) if len(closes) >= 11 and closes[-11] > 0 else None,
        'under_microscope': winner_path is not None,
        'path': winner_path,
        'position_size': winner_position_size,
        'reason': winner_reason,
        'pre_surge_details': pre_surge_details if pre_surge else None,
        'quiet_details': quiet_details if quiet else None,
        'explosive_details': explosive_details if explosive else None,
        'break_reason': break_reason if early_break else None,
    }


def main():
    parser = argparse.ArgumentParser(description='رادار الميكرز اليومي')
    parser.add_argument('--limit', type=int, default=0, help='0 = كل الأسهم')
    parser.add_argument('--market', type=str, default='EGX', help='فلتر السوق (EGX, TADAWUL, KSE, QSE, ALL)')
    parser.add_argument('--min-quiet-signals', type=int, default=5, help='حد أدنى للإشارات في Quiet Accumulation (default 5/6)')
    parser.add_argument('--min-price', type=float, default=1.0, help='استبعاد الأسهم تحت ده السعر (default 1.0)')
    parser.add_argument('--json-only', action='store_true')
    args = parser.parse_args()

    log("═══ رادار الميكرز اليومي (نظيف) ═══")
    log(f"  DB: {PROD_DB}")
    log(f"  Market filter: {args.market}")
    log(f"  Min Quiet signals: {args.min_quiet_signals}/6")
    log(f"  Min price: {args.min_price} EGP")

    if not PROD_DB or not PROD_DB.exists():
        log("❌ مفيش DB متاح. جرّب:")
        log("   - sandbox: شغّل scripts/fetch_production_data.py")
        log("   - production: تأكد إن db/stocks.db أو db/data_engine.db موجود")
        return 1

    log(f"  DB: {PROD_DB.name} (table: {PROD_TABLE})")

    conn = sqlite3.connect(str(PROD_DB))
    conn.row_factory = sqlite3.Row

    # فلتر السوق (EGX افتراضياً)
    # محاولة JOIN مع stocks table (لو موجود) — fallback لكل الأسهم لو مفيش stocks table
    has_stocks_table = bool(conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'"
    ).fetchone())

    if args.market.upper() == 'ALL' or not has_stocks_table:
        tickers = [r[0] for r in conn.execute(f"""
            SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
        """).fetchall()]
    else:
        # JOIN مع stocks table عشان نفلتر بـ market
        # لو الـ ticker column في stocks table اسمه مختلف، استخدم ticker
        try:
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT p.{TICKER_COL} FROM {PROD_TABLE} p
                JOIN stocks s ON p.{TICKER_COL} = s.ticker
                WHERE s.market = ?
            """, (args.market.upper(),)).fetchall()]
        except Exception:
            # fallback: كل الأسهم (لو الـ JOIN فشل)
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
            """).fetchall()]
    if args.limit > 0:
        tickers = tickers[: args.limit]
    log(f"  فحص {len(tickers)} سهم (market={args.market})...")

    results = []
    for i, ticker in enumerate(tickers, 1):
        rows = fetch_ticker_series(conn, ticker, days=40)
        result = scan_ticker(rows, ticker)
        if result:
            results.append(result)
        if i % 100 == 0:
            log(f"    {i}/{len(tickers)} — {sum(1 for r in results if r['under_microscope'])} تحت الميكروسكوب")
    conn.close()

    # ─── تصنيف + تنظيف النتايج ────────────────────────────────────────
    # 1. فلتر: السعر >= args.min_price (استبعاد penny stocks)
    results = [r for r in results if r['current_price'] >= args.min_price]

    # 2. فلتر Quiet: بس اللي signals >= args.min_quiet_signals
    under_microscope_raw = [r for r in results if r['under_microscope']]
    quiet_list = [
        r for r in under_microscope_raw
        if r['path'] == 'A_quiet_accumulation'
        and (r.get('quiet_details', {}) or {}).get('signal_count', 0) >= args.min_quiet_signals
    ]
    explosive_list = [r for r in under_microscope_raw if r['path'] == 'B_explosive_surge']
    early_break_list = [r for r in under_microscope_raw if r['path'] == 'C_early_break']

    # 3. ترتيب حسب: signals → volume_ratio → price_stability (للـ quiet)
    def quiet_sort_key(r):
        qd = r.get('quiet_details', {}) or {}
        return (
            -qd.get('signal_count', 0),       # أكثر signals أول
            -r.get('volume_ratio_10d_vs_20d', 0),  # أعلى volume ratio
            -r.get('price_stability', 0),     # أعلى stability
        )
    quiet_list.sort(key=quiet_sort_key)

    # للـ explosive: حسب volume_ratio (أعلى surge أول)
    explosive_list.sort(key=lambda r: -r.get('volume_ratio_10d_vs_20d', 0))

    # للـ early_break: حسب ROC10 (أعلى ROC أول)
    early_break_list.sort(key=lambda r: -(r.get('roc_10d') or 0))

    under_microscope = quiet_list + explosive_list + early_break_list

    log(f"\n═══ النتايج النظيفة (market={args.market}, price≥{args.min_price}) ═══")
    log(f"  إجمالي المفحوصين (بعد فلتر السعر): {len(results)}")
    log(f"  🔬 تحت الميكروسكوب: {len(under_microscope)}")
    log(f"    🎯 Quiet Accumulation (≥{args.min_quiet_signals}/6): {len(quiet_list)}")
    log(f"    🔥 Explosive Surge: {len(explosive_list)}")
    log(f"    ⚡ Early Break: {len(early_break_list)}")

    # ─── عرض الأسهم تحت الميكروسكوب ────────────────────────────────────
    if quiet_list:
        log(f"\n═══ 🎯 مسار أ — Quiet Accumulation (≥{args.min_quiet_signals}/6) ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'VolRatio':>8s} {'Stability':>9s} {'Signals':>7s}")
        log("-" * 100)
        for i, r in enumerate(quiet_list, 1):
            qd = r.get('quiet_details', {}) or {}
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {r['volume_ratio_10d_vs_20d']:>7.2f}x "
                f"{r['price_stability']:>8.2f} {qd.get('signal_count', 0):>5d}/6")

    if explosive_list:
        log(f"\n═══ 🔥 مسار ب — Explosive Surge ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'VolRatio':>8s} {'Range10':>8s}")
        log("-" * 90)
        for i, r in enumerate(explosive_list, 1):
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {r['volume_ratio_10d_vs_20d']:>7.2f}x "
                f"{r['range_10d_pct']:>7.1f}%")

    if early_break_list:
        log(f"\n═══ ⚡ مسار ج — Early Break ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'VolRatio':>8s}")
        log("-" * 80)
        for i, r in enumerate(early_break_list, 1):
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {r['volume_ratio_10d_vs_20d']:>7.2f}x")

    # تفاصيل Quiet Accumulation (لأعلى 5 بس)
    if quiet_list:
        log(f"\n══─ تفاصيل أعلى 5 Quiet Accumulation ══")
        for r in quiet_list[:5]:
            qd = r.get('quiet_details', {}) or {}
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
            'market': args.market,
            'min_quiet_signals': args.min_quiet_signals,
            'min_price': args.min_price,
            'total_scanned': len(results),
            'under_microscope_count': len(under_microscope),
            'quiet_count': len(quiet_list),
            'explosive_count': len(explosive_list),
            'early_break_count': len(early_break_list),
            'quiet_list': quiet_list,
            'explosive_list': explosive_list,
            'early_break_list': early_break_list,
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
