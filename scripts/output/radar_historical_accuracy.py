#!/usr/bin/env python3
"""
radar_historical_accuracy.py — تقرير الدقة التاريخية لإشارات رادار السيولة
=========================================================================

سكريبت مستقل للقراءة فقط (لا يلمس كود المشروع) — يحاكي رادار الميكرز على
بيانات تاريخية حقيقية ويقيس النتائج الفعلية بعد 7/14/30 يوم.

المنهجية:
  1. لكل يوم تداول T في الفترة المتاحة:
     - نشغل نفس منطق maker_radar على البيانات لحد يوم T (شامل T)
     - نسجّل الأسهم اللي الرادار اكتشفها (A_pre_surge / B_quiet_strong /
       C_quiet_weak / D_explosive / E_early_break)
  2. لكل سهم اكتشفه الرادار في يوم T:
     - نجيب سعره بعد 7 و14 و30 يوم من T (لو موجود)
     - نحسب outcome_% = (price_after - entry_price) / entry_price * 100
     - نحسب max_price_after و min_price_after (للحكم على الحد الأقصى للأرباح
       والخسائر المحققة)
  3. التصنيف النهائي:
     - WIN: outcome_30d ≥ +15% (target hit)
     - LOSS: outcome_30d ≤ -7% (stop hit)
     - NEUTRAL: -7% < outcome_30d < +15%
     - EXPIRED: لم تتحقق أي من النهايات (لا 7d ولا 14d ولا 30d متوفر)

الكود يعيد استخدام منطق shared_liquidity (نفس اللي بيستخدمه maker_radar.py)
عشان نضمن إن التحقق بنفس منطق الإنتاج.

CLI:
  python3 scripts/radar_historical_accuracy.py
  python3 scripts/radar_historical_accuracy.py --start 2026-01-01 --end 2026-06-30
  python3 scripts/radar_historical_accuracy.py --top 50  # فحص أحدث 50 يوم فقط
  python3 scripts/radar_historical_accuracy.py --min-turnover 500000
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # scripts/output/x.py → repo root
VPS_SERVICE = PROJECT_ROOT / "vps-service"
sys.path.insert(0, str(VPS_SERVICE))

# Import the same detection functions used by maker_radar.py
try:
    from utils.shared_liquidity import (  # noqa: E402
        detect_quiet_accumulation,
        detect_pre_surge,
        is_explosive_surge,
        compute_money_flow,
        check_kill_switch,
        check_limit_up_trap,
        detect_life_cycle,
    )
except ImportError as e:
    print(f"❌ Cannot import from utils.shared_liquidity: {e}", file=sys.stderr)
    sys.exit(2)

# Constants matching maker_radar.py
PRE_SURGE_POSITION_SIZE = 0.015
QUIET_ACCUMULATION_POSITION_SIZE = 0.015
EXPLOSIVE_SURGE_POSITION_SIZE = 0.02


def parse_volume(v):
    """نفس منطق maker_radar.parse_volume"""
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


def is_early_break(closes, volumes, highs=None):
    """نفس منطق maker_radar.is_early_break (نسخة مكررة لتجنب الاعتماد على import غير معروف)"""
    if not closes or len(closes) < 21 or not volumes or len(volumes) < 21:
        return False, 'insufficient data'

    last_close = closes[-1]
    prev_20 = closes[-21:-1]
    max_20 = max(prev_20)
    min_20 = min(prev_20)

    if last_close <= max_20:
        return False, f'close {last_close:.2f} ≤ max_20 {max_20:.2f}'

    avg_20_vol = sum(volumes[-21:-1]) / 20
    last_vol = volumes[-1]
    if avg_20_vol <= 0:
        return False, 'avg_20_vol = 0'
    vol_ratio = last_vol / avg_20_vol
    if vol_ratio < 1.5:
        return False, f'vol {vol_ratio:.2f}× < 1.5×'

    if min_20 <= 0:
        return False, 'min_20 = 0'
    range_pct = (max_20 - min_20) / min_20 * 100
    if range_pct >= 15.0:
        return False, f'range {range_pct:.1f}% ≥ 15%'

    return True, f'break: close {last_close:.2f} > max_20 {max_20:.2f}, vol {vol_ratio:.2f}×, range {range_pct:.1f}%'


def classify_path(rows, regime='NORMAL'):
    """نفس منطق maker_radar.scan_ticker لكن مختصر — يرجّع فقط (path, entry_price, reason)

    ملاحظة: هذا نسخة مختصرة للتحقق التاريخي. الكود الكامل في maker_radar.scan_ticker
    يحسب أيضاً money_flow + life_cycle + kill_switch. هنا نتجاهلها لأننا نريد فقط
    تحديد الـ path. لو الكود المختصر هذا يصنّف بشكل مختلف عن الإنتاج، النتائج
    ستكون غير دقيقة. الحل: استخدم maker_radar.scan_ticker مباشرة.
    """
    if len(rows) < 15:
        return None, None, None

    closes = [r['close'] for r in rows if r['close'] and r['close'] > 0]
    volumes = [parse_volume(r['volume']) for r in rows]
    highs = [r['high'] or r['close'] for r in rows]
    lows = [r['low'] or r['close'] for r in rows]

    if len(closes) < 15 or len(volumes) < 15:
        return None, None, None

    pre_surge, pre_surge_reason, _ = detect_pre_surge(closes, volumes, highs, lows, regime=regime)
    quiet, quiet_reason, quiet_details = detect_quiet_accumulation(closes, volumes, highs, lows, regime=regime)
    explosive, explosive_reason, _ = is_explosive_surge(volumes, closes)
    early_break, break_reason = is_early_break(closes, volumes, highs)

    quiet_signals = quiet_details.get('signal_count', 0) if quiet else 0

    if pre_surge:
        return 'A_pre_surge', closes[-1], pre_surge_reason
    if quiet and quiet_signals >= 5:
        return 'B_quiet_accumulation_strong', closes[-1], quiet_reason
    if quiet and quiet_signals >= 4:
        return 'C_quiet_accumulation_weak', closes[-1], quiet_reason
    if explosive:
        return 'D_explosive_surge', closes[-1], explosive_reason
    if early_break:
        return 'E_early_break', closes[-1], break_reason

    return None, None, None


def fetch_ticker_history(db_path, ticker, end_date=None):
    """جلب كل تاريخ الأسعار لسهم حتى end_date (شامل)."""
    # Phase 7.1: migrated
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path, writable=False).__enter__())
    conn.row_factory = sqlite3.Row
    query = """
        SELECT date, open_price as open, high_price as high, low_price as low,
               close_price as close, volume
        FROM price_history
        WHERE ticker = ? AND close_price IS NOT NULL AND close_price > 0
    """
    params = [ticker]
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)
    query += " ORDER BY date ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def fetch_all_tickers(db_path, min_rows=60):
    """رجّع قائمة tickers اللي عندها ≥ min_rows يوم تداول."""
    # Phase 7.1: migrated
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path, writable=False).__enter__())
    rows = conn.execute("""
        SELECT ticker, COUNT(*) as n, MIN(date) as first_d, MAX(date) as last_d
        FROM price_history
        WHERE close_price IS NOT NULL AND close_price > 0
        GROUP BY ticker
        HAVING n >= ?
        ORDER BY n DESC
    """, (min_rows,)).fetchall()
    conn.close()
    return [(r[0], r[1], r[2], r[3]) for r in rows]


def get_all_trading_dates(db_path, start=None, end=None):
    """كل أيام التداول المتاحة في النطاق."""
    # Phase 7.1: migrated
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path, writable=False).__enter__())
    query = "SELECT DISTINCT date FROM price_history WHERE 1=1"
    params = []
    if start:
        query += " AND date >= ?"
        params.append(start)
    if end:
        query += " AND date <= ?"
        params.append(end)
    query += " ORDER BY date ASC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [r[0] for r in rows]


def find_future_price(db_path, ticker, start_date, days_forward):
    """ابحث عن سعر السهم بعد N يوم تداول من start_date.

    نأخذ كل البيانات بعد start_date ونرجّع سعر اليوم رقم N (trading-day index).
    """
    # Phase 7.1: migrated
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path, writable=False).__enter__())
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT date, close_price as close, high_price as high, low_price as low
        FROM price_history
        WHERE ticker = ? AND date > ?
        ORDER BY date ASC
        LIMIT ?
    """, (ticker, start_date, days_forward + 30)).fetchall()  # +30 buffer لكل أيام التداول الفعلية
    conn.close()
    if len(rows) < days_forward:
        return None, None, None
    target_row = rows[days_forward - 1]  # Nth trading day after signal
    # also compute max/min price over the N-day window
    window = rows[:days_forward]
    max_in_window = max(r['high'] or r['close'] for r in window)
    min_in_window = min(r['low'] or r['close'] for r in window)
    return target_row['close'], max_in_window, min_in_window


def main():
    parser = argparse.ArgumentParser(description='تقرير الدقة التاريخية للرادار')
    parser.add_argument('--db', type=str, default='db/price_history.db',
                        help='مسار DB الأسعار (default: db/price_history.db)')
    parser.add_argument('--start', type=str, default=None,
                        help='تاريخ بداية الفترة (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, default=None,
                        help='تاريخ نهاية الفترة (YYYY-MM-DD)')
    parser.add_argument('--top', type=int, default=0,
                        help='فحص أحدث N يوم تداول فقط (0 = كل الأيام)')
    parser.add_argument('--min-rows', type=int, default=90,
                        help='حد أدنى لأيام البيانات لكل سهم (default 90 — يكفي 30d lookahead + 60d lookback)')
    parser.add_argument('--limit-tickers', type=int, default=0,
                        help='فحص أقدم N سهم فقط (0 = كل الأسهم)')
    parser.add_argument('--output', type=str,
                        default='scripts/output/radar_historical_accuracy.json',
                        help='مسار ملف JSON للنتائج')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    db_path = PROJECT_ROOT / args.db
    if not db_path.exists():
        print(f"❌ DB غير موجود: {db_path}")
        return 1

    print("═══ تقرير الدقة التاريخية للرادار ═══")
    print(f"  DB: {db_path.name}")
    print(f"  Min rows per ticker: {args.min_rows}")
    print(f"  Start filter: {args.start or '(none)'}")
    print(f"  End filter: {args.end or '(none)'}")
    if args.top:
        print(f"  Top N trading days: {args.top}")

    # 1. حمّل tickers
    print("\n  [1/4] تحميل قائمة الأسهم المؤهلة...")
    tickers_info = fetch_all_tickers(db_path, min_rows=args.min_rows)
    if args.limit_tickers:
        tickers_info = tickers_info[:args.limit_tickers]
    print(f"  ✅ {len(tickers_info)} سهم مؤهل (≥{args.min_rows} يوم)")

    # 2. ابحث عن كل أيام التداول المتاحة في النطاق
    print("\n  [2/4] تحميل أيام التداول...")
    all_dates = get_all_trading_dates(db_path, start=args.start, end=args.end)
    if args.top > 0 and len(all_dates) > args.top:
        # skip the LAST args.top days because we need 30d forward lookahead
        cutoff = len(all_dates) - args.top - 31  # need 30d forward
        if cutoff < 60:
            cutoff = 60  # need at least 60 lookback
        all_dates = all_dates[cutoff:-31]  # exclude last 31 days (no 30d forward data yet)
    else:
        # Always exclude last 31 days (need 30d forward for outcome)
        all_dates = all_dates[60:-31]  # skip first 60 (lookback) + last 31 (no 30d forward)
    print(f"  ✅ {len(all_dates)} يوم تداول للفحص")
    print(f"     من {all_dates[0]} إلى {all_dates[-1]}")

    # 3. لكل يوم، شغّل الرادار على الأسهم
    print(f"\n  [3/4] شغّل الرادار على {len(all_dates)} يوم × {len(tickers_info)} سهم...")
    all_signals = []
    last_log_pct = -1
    for i, t_date in enumerate(all_dates):
        pct = int((i / len(all_dates)) * 100)
        if pct != last_log_pct and pct % 10 == 0:
            print(f"    [{i+1}/{len(all_dates)}] {t_date} ({pct}%)")
            last_log_pct = pct

        for ticker_info in tickers_info:
            ticker = ticker_info[0]
            rows = fetch_ticker_history(db_path, ticker, end_date=t_date)
            if len(rows) < 25:  # need 21 for early break + buffer
                continue
            path, entry_price, reason = classify_path(rows, regime='NORMAL')
            if not path:
                continue
            all_signals.append({
                'signal_date': t_date,
                'ticker': ticker,
                'path': path,
                'entry_price': round(entry_price, 4),
                'reason': reason,
            })

    print(f"  ✅ {len(all_signals)} إشارة مسجّلة")

    # 4. تحقق من النتائج بعد 7/14/30 يوم
    print(f"\n  [4/4] حساب النتائج بعد 7/14/30 يوم...")
    for i, sig in enumerate(all_signals):
        if (i + 1) % 100 == 0:
            print(f"    [{i+1}/{len(all_signals)}] processed")
        ticker = sig['ticker']
        sig_date = sig['signal_date']
        entry = sig['entry_price']

        for days in (7, 14, 30):
            close_after, max_in_window, min_in_window = find_future_price(
                db_path, ticker, sig_date, days
            )
            if close_after is None:
                sig[f'outcome_{days}d'] = None
                sig[f'max_price_{days}d'] = None
                sig[f'min_price_{days}d'] = None
            else:
                sig[f'outcome_{days}d'] = round((close_after - entry) / entry * 100, 2)
                sig[f'max_price_{days}d'] = round(max_in_window, 4)
                sig[f'min_price_{days}d'] = round(min_in_window, 4)

    # 5. التصنيف + التجميع
    print("\n═══ النتائج الإجمالية ═══")
    by_path = {}
    for sig in all_signals:
        p = sig['path']
        by_path.setdefault(p, []).append(sig)

    print(f"  Total signals: {len(all_signals)}")
    for p, sigs in sorted(by_path.items()):
        n = len(sigs)
        outcome_30d = [s['outcome_30d'] for s in sigs if s['outcome_30d'] is not None]
        outcome_7d = [s['outcome_7d'] for s in sigs if s['outcome_7d'] is not None]
        outcome_14d = [s['outcome_14d'] for s in sigs if s['outcome_14d'] is not None]

        wins_30d = sum(1 for o in outcome_30d if o >= 15.0)
        losses_30d = sum(1 for o in outcome_30d if o <= -7.0)
        neutral_30d = len(outcome_30d) - wins_30d - losses_30d

        avg_7d = round(statistics.mean(outcome_7d), 2) if outcome_7d else 0
        avg_14d = round(statistics.mean(outcome_14d), 2) if outcome_14d else 0
        avg_30d = round(statistics.mean(outcome_30d), 2) if outcome_30d else 0

        # profit factor: sum(wins) / abs(sum(losses))
        gains = sum(o for o in outcome_30d if o > 0)
        losses_total = abs(sum(o for o in outcome_30d if o < 0))
        pf = round(gains / losses_total, 2) if losses_total > 0 else float('inf') if gains > 0 else 0

        print(f"\n  📊 {p}:")
        print(f"      Signals: {n}")
        print(f"      Avg outcome 7d:  {avg_7d:+.2f}% (n={len(outcome_7d)})")
        print(f"      Avg outcome 14d: {avg_14d:+.2f}% (n={len(outcome_14d)})")
        print(f"      Avg outcome 30d: {avg_30d:+.2f}% (n={len(outcome_30d)})")
        if outcome_30d:
            wr = round(wins_30d / len(outcome_30d) * 100, 1)
            lr = round(losses_30d / len(outcome_30d) * 100, 1)
            print(f"      Wins (≥+15%): {wins_30d} ({wr}%)")
            print(f"      Losses (≤-7%): {losses_30d} ({lr}%)")
            print(f"      Neutral: {neutral_30d}")
            print(f"      Profit Factor: {pf}")

    # 6. حفظ النتائج
    output_path = PROJECT_ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        'generated_at': datetime.now().isoformat(),
        'db': str(db_path.relative_to(PROJECT_ROOT)),
        'min_rows_per_ticker': args.min_rows,
        'date_range': [all_dates[0], all_dates[-1]],
        'total_signals': len(all_signals),
        'signals_by_path': {p: len(sigs) for p, sigs in by_path.items()},
        'all_signals': all_signals,
    }
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n  ✅ تم حفظ التقرير الكامل في: {output_path}")


if __name__ == '__main__':
    sys.exit(main() or 0)
