#!/usr/bin/env python3
"""
retroactive_radar_test.py — الاختبار الجامد للرادار
======================================================
اختبار retroactive: شغل الرادار في الماضي، وشوف هل قدر يكتشف
الأسهم الانفجارية قبل ما تنفجر.

المنهجية:
  1. لكل يوم تداول T في الفترة المتاحة:
     - شغل الرادار على البيانات لحد يوم T (مش شامل T)
     - سجّل الأسهم اللي الرادار اكتشفها (quiet/explosive/early_break)
  2. لكل سهم اكتشفه الرادار في يوم T:
     - شوف سعره بعد 5/10/15 يوم من T
     - هل حقق +15% (target) أو -7% (stop) أو فضل ثابت؟
  3. كمان شوف الأسهم اللي انفجرت (+40% خلال 5 أيام) بعد T
     - هل الرادار اكتشفها قبل كده؟

النتيجة:
  - Precision: % الأسهم اللي الرادار اكتشفها فعلاً انفجرت
  - Recall: % الأسهم الانفجارية اللي الرادار اكتشفها
  - Early detection rate: % الأسهم الانفجارية اللي الرادار اكتشفها قبل الانفجار
  - R:R متوسط للصفقات الافتراضية

CLI:
  python3 scripts/retroactive_radar_test.py
  python3 scripts/retroactive_radar_test.py --market EGX --lookforward 10
"""
from __future__ import annotations

import argparse
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


def is_early_break(closes, volumes):
    """مسار ج — Early Break."""
    if not closes or len(closes) < 21 or not volumes or len(volumes) < 21:
        return False
    last_close = closes[-1]
    prev_20 = closes[-21:-1]
    max_20 = max(prev_20)
    if last_close <= max_20:
        return False
    avg_20_vol = sum(volumes[-21:-1]) / 20
    last_vol = volumes[-1]
    if avg_20_vol <= 0:
        return False
    vol_ratio = last_vol / avg_20_vol
    if vol_ratio < 1.5:
        return False
    min_20 = min(prev_20)
    if min_20 <= 0:
        return False
    range_pct = (max_20 - min_20) / min_20 * 100
    if range_pct >= 15.0:
        return False
    return True


def fetch_all_data(db_path, market='EGX'):
    """حمّل كل بيانات كل الأسهم في dict."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # فلتر السوق (لو stocks table موجود)
    has_stocks = bool(conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'").fetchone())
    if market == 'ALL' or not has_stocks:
        rows = conn.execute("""
            SELECT symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover
            FROM egksco_price_history
            WHERE close_price IS NOT NULL AND close_price > 0
            ORDER BY symbol, price_date
        """).fetchall()
    else:
        rows = conn.execute("""
            SELECT p.symbol, p.price_date, p.open_price, p.high_price, p.low_price, p.close_price, p.volume, p.turnover
            FROM egksco_price_history p
            JOIN stocks s ON p.symbol = s.symbol
            WHERE s.market = ? AND p.close_price IS NOT NULL AND p.close_price > 0
            ORDER BY p.symbol, p.price_date
        """, (market,)).fetchall()
    conn.close()

    # بناء dict: ticker → list of {date, ohlc, volume, turnover}
    by_ticker = {}
    for r in rows:
        t = r['symbol']
        by_ticker.setdefault(t, []).append({
            'date': r['price_date'],
            'open': r['open_price'],
            'high': r['high_price'],
            'low': r['low_price'],
            'close': r['close_price'],
            'volume': parse_volume(r['volume']),
            'turnover': r['turnover'] if r['turnover'] else (r['close_price'] * parse_volume(r['volume'])),
        })
    return by_ticker


def run_radar_at_t(by_ticker, t_date, min_price=1.0):
    """شغل الرادار على البيانات لحد t_date (مش شامل)."""
    detections = {
        'pre_surge': [],
        'quiet': [],
        'explosive': [],
        'early_break': [],
    }

    for ticker, series in by_ticker.items():
        # خد البيانات لحد t_date
        data_up_to_t = [d for d in series if d['date'] < t_date]
        # lookback = 18 يوم
        if len(data_up_to_t) < 18:
            continue

        closes = [d['close'] for d in data_up_to_t]
        volumes = [d['volume'] for d in data_up_to_t]
        highs = [d['high'] for d in data_up_to_t]
        lows = [d['low'] for d in data_up_to_t]
        turnovers = [d['turnover'] for d in data_up_to_t]

        current_price = closes[-1]
        if current_price < min_price:
            continue

        # PHASE-3: Pre-Surge (الأولوية الأولى)
        pre_surge, _, pre_surge_details = detect_pre_surge(closes, volumes, highs, lows)
        if pre_surge and pre_surge_details.get('signal_count', 0) >= 3:
            detections['pre_surge'].append({
                'ticker': ticker,
                'date': t_date,
                'price': current_price,
                'signal_count': pre_surge_details.get('signal_count', 0),
            })

        # مسار أ: Quiet Accumulation (4/6 كحد أدنى دلوقتي)
        quiet, _, quiet_details = detect_quiet_accumulation(closes, volumes, highs, lows)
        if quiet and quiet_details.get('signal_count', 0) >= 4:
            detections['quiet'].append({
                'ticker': ticker,
                'date': t_date,
                'price': current_price,
                'signal_count': quiet_details.get('signal_count', 0),
            })

        # مسار ب: Explosive Surge
        explosive, _, _ = is_explosive_surge(volumes, closes)
        if explosive:
            detections['explosive'].append({
                'ticker': ticker,
                'date': t_date,
                'price': current_price,
            })

        # مسار ج: Early Break
        if is_early_break(closes, volumes):
            detections['early_break'].append({
                'ticker': ticker,
                'date': t_date,
                'price': current_price,
            })

    return detections


def find_explosive_moves(by_ticker, start_date, end_date, window=5, threshold=15.0):
    """ارجع الأسهم اللي حققت +threshold% خلال window أيام، بدأت في [start_date, end_date]."""
    explosive_moves = []
    for ticker, series in by_ticker.items():
        # فلتر البيانات في النافذة
        series_in_window = [d for d in series if start_date <= d['date'] <= end_date]
        if len(series_in_window) < window + 1:
            continue
        # ابحث عن أي window متتالية حققت +threshold%
        for i in range(len(series_in_window) - window):
            start_close = series_in_window[i]['close']
            end_close = series_in_window[i + window]['close']
            if start_close <= 0:
                continue
            surge = (end_close - start_close) / start_close * 100
            if surge >= threshold:
                explosive_moves.append({
                    'ticker': ticker,
                    'start_date': series_in_window[i]['date'],
                    'end_date': series_in_window[i + window]['date'],
                    'start_price': start_close,
                    'end_price': end_close,
                    'surge_pct': surge,
                })
    return explosive_moves


def evaluate_detections(detections, by_ticker, lookforward=10):
    """قيم كل detection: شوف السعر بعد lookforward."""
    results = []
    for path, dets in detections.items():
        for det in dets:
            ticker = det['ticker']
            entry_date = det['date']
            entry_price = det['price']
            series = by_ticker.get(ticker, [])
            # خد الأسعار بعد entry_date
            future = [d for d in series if d['date'] > entry_date][:lookforward]
            if not future:
                continue
            # أعلى/أقل سعر في فترة lookforward
            future_high = max(d['high'] for d in future)
            future_low = min(d['low'] for d in future)
            final_close = future[-1]['close']

            # هل حقق target (+15%)؟
            target_price = entry_price * 1.15
            hit_target = future_high >= target_price
            # هل حقق stop (-7%)؟
            stop_price = entry_price * 0.93
            hit_stop = future_low <= stop_price

            # R:R محقق
            if hit_target and not hit_stop:
                outcome = 'TARGET_HIT'
                rr = 1.0  # 1R (target)
            elif hit_stop and not hit_target:
                outcome = 'STOPPED'
                rr = -1.0  # -1R (stop)
            elif hit_target and hit_stop:
                outcome = 'BOTH_HIT'
                rr = 0.0  # ambiguous
            else:
                # ما hit ولا stop — شوف الـ return النهائي
                ret = (final_close - entry_price) / entry_price
                rr = ret / 0.15  # نسبة من الـ target
                outcome = 'NEUTRAL'

            results.append({
                'path': path,
                'ticker': ticker,
                'entry_date': entry_date,
                'entry_price': entry_price,
                'final_close': final_close,
                'return_pct': (final_close - entry_price) / entry_price * 100,
                'max_high_pct': (future_high - entry_price) / entry_price * 100,
                'min_low_pct': (future_low - entry_price) / entry_price * 100,
                'outcome': outcome,
                'rr': rr,
            })
    return results


def main():
    parser = argparse.ArgumentParser(description='اختبار جامد للرادار')
    parser.add_argument('--market', type=str, default='EGX')
    parser.add_argument('--lookforward', type=int, default=10, help='كم يوم في المستقبل نقيس النتيجة')
    parser.add_argument('--min-quiet-signals', type=int, default=5)
    parser.add_argument('--surge-threshold', type=float, default=15.0, help='% الحركة اللي بتعتبر انفجارية')
    args = parser.parse_args()

    log("═══ الاختبار الجامد للرادار (Retroactive) ═══\n")

    # 1. حمّل كل البيانات
    db_path = PROJECT_ROOT / 'db' / 'data_engine.db'
    if not db_path.exists():
        log(f"❌ {db_path} مش موجود")
        return 1

    log(f"  تحميل البيانات من {db_path.name} (market={args.market})...")
    by_ticker = fetch_all_data(db_path, market=args.market)
    log(f"  ✅ {len(by_ticker)} سهم")

    # 2. ابحث عن كل أيام التداول المتاحة
    all_dates = sorted(set(d['date'] for series in by_ticker.values() for d in series))
    if len(all_dates) < 30:
        log(f"❌ مفيش أيام كفاية ({len(all_dates)} < 30)")
        return 1
    log(f"  فترة الاختبار: {all_dates[0]} → {all_dates[-1]} ({len(all_dates)} يوم تداول)")

    # 3. لكل يوم T، شغل الرادار (على البيانات لحد T)
    log(f"\n  شغل الرادار على {len(all_dates)-1} نقطة زمنية...")
    all_detections = []
    for i, t_date in enumerate(all_dates[:-1]):
        # محتاجين على الأقل 25 يوم قبل t_date
        # lookback = 18 يوم (تشديد من 15)
        if i < 18:
            continue
        detections = run_radar_at_t(by_ticker, t_date)
        n_total = sum(len(v) for v in detections.values())
        if n_total > 0:
            all_detections.append({
                'date': t_date,
                'detections': detections,
            })
        if (i+1) % 10 == 0:
            log(f"    [{i+1}/{len(all_dates)-1}] {t_date} → {n_total} detection")

    log(f"\n  ✅ شغل الرادار على {len(all_detections)} يوم")
    total_detections = sum(
        len(d['detections'][path])
        for d in all_detections
        for path in ['pre_surge', 'quiet', 'explosive', 'early_break']
    )
    log(f"  إجمالي detections: {total_detections}")

    # 4. قيم كل detection
    log(f"\n  تقييم detections (lookforward={args.lookforward} أيام)...")
    results = []
    for d in all_detections:
        eval_results = evaluate_detections(d['detections'], by_ticker, lookforward=args.lookforward)
        for r in eval_results:
            r['detection_date'] = d['date']
            results.append(r)

    log(f"  ✅ تم تقييم {len(results)} detection")

    # 5. ابحث عن الأسهم الانفجارية (ground truth)
    log(f"\n  البحث عن الأسهم الانفجارية (+{args.surge_threshold}% خلال 5 أيام)...")
    explosive_moves = find_explosive_moves(
        by_ticker, all_dates[0], all_dates[-1],
        window=5, threshold=args.surge_threshold
    )
    log(f"  ✅ {len(explosive_moves)} سهم انفجاري")

    # 6. تحليل: هل الرادار اكتشف الأسهم الانفجارية قبل ما تنفجر؟
    log(f"\n  تحليل early detection...")
    detected_explosive = 0
    early_detected = 0  # اكتشفها قبل الانفجار
    for move in explosive_moves:
        ticker = move['ticker']
        surge_start = move['start_date']
        # هل الرادار اكتشف السهم ده في أي يوم قبل surge_start؟
        was_detected_before = False
        for d in all_detections:
            if d['date'] >= surge_start:
                break
            for path in ['pre_surge', 'quiet', 'explosive', 'early_break']:
                for det in d['detections'][path]:
                    if det['ticker'] == ticker:
                        was_detected_before = True
                        break
                if was_detected_before:
                    break
            if was_detected_before:
                break
        if was_detected_before:
            detected_explosive += 1
            early_detected += 1

    # 7. الملخص
    log(f"\n\n═══ النتائج الجامدة ═══\n")

    # Precision: % detections اللي حققت target
    target_hits = sum(1 for r in results if r['outcome'] == 'TARGET_HIT')
    stopped = sum(1 for r in results if r['outcome'] == 'STOPPED')
    precision = (target_hits / len(results) * 100) if results else 0

    log(f"📊 Precision (detections → target hit):")
    log(f"  إجمالي detections: {len(results)}")
    log(f"  ✅ hit target (+15%): {target_hits} ({precision:.1f}%)")
    log(f"  ❌ stopped (-7%): {stopped} ({stopped/len(results)*100 if results else 0:.1f}%)")
    log(f"  ➖ neutral: {len(results) - target_hits - stopped} ({(len(results) - target_hits - stopped)/len(results)*100 if results else 0:.1f}%)")

    # R:R متوسط
    avg_rr = statistics.mean([r['rr'] for r in results]) if results else 0
    log(f"\n  متوسط R:R: {avg_rr:+.2f}")

    # Recall: % الأسهم الانفجارية اللي الرادار اكتشفها
    recall = (detected_explosive / len(explosive_moves) * 100) if explosive_moves else 0
    log(f"\n📊 Recall (explosive moves detected):")
    log(f"  إجمالي أسهم انفجارية: {len(explosive_moves)}")
    log(f"  ✅ الرادار اكتشفها قبل: {detected_explosive} ({recall:.1f}%)")

    # حسب المسار
    log(f"\n📊 توزيع detections حسب المسار:")
    for path in ['pre_surge', 'quiet', 'explosive', 'early_break']:
        path_results = [r for r in results if r['path'] == path]
        path_target = sum(1 for r in path_results if r['outcome'] == 'TARGET_HIT')
        path_stopped = sum(1 for r in path_results if r['outcome'] == 'STOPPED')
        path_precision = (path_target / len(path_results) * 100) if path_results else 0
        avg_return = statistics.mean([r['return_pct'] for r in path_results]) if path_results else 0
        log(f"  {path:15s}: {len(path_results):3d} detections | target: {path_target} ({path_precision:.1f}%) | stopped: {path_stopped} | avg_return: {avg_return:+.1f}%")

    # Top detections
    log(f"\n🏆 Top 10 detections (حسب الـ return):")
    top_results = sorted(results, key=lambda x: -x['return_pct'])[:10]
    log(f"  {'Ticker':8s} {'Path':15s} {'Entry':>8s} {'Final':>8s} {'Return':>8s} {'Outcome':>12s} {'Date':12s}")
    for r in top_results:
        log(f"  {r['ticker']:8s} {r['path']:15s} {r['entry_price']:>8.2f} {r['final_close']:>8.2f} {r['return_pct']:>+7.1f}% {r['outcome']:>12s} {r['detection_date']}")

    # أسهم انفجارية missed
    log(f"\n❌ أسهم انفجارية الرادار مالقطهاش:")
    missed = []
    for move in explosive_moves:
        ticker = move['ticker']
        was_detected = False
        for d in all_detections:
            for path in ['pre_surge', 'quiet', 'explosive', 'early_break']:
                for det in d['detections'][path]:
                    if det['ticker'] == ticker:
                        was_detected = True
                        break
                if was_detected:
                    break
            if was_detected:
                break
        if not was_detected:
            missed.append(move)
    for m in missed[:10]:
        log(f"  {m['ticker']:8s}  surge: +{m['surge_pct']:.1f}%  from {m['start_price']:.2f} → {m['end_price']:.2f}  ({m['start_date']} → {m['end_date']})")

    # حفظ
    today_str = datetime.now().strftime("%Y%m%d")
    out_path = OUTPUT_DIR / f"retroactive_radar_test_{today_str}.json"
    import json
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'market': args.market,
            'lookforward': args.lookforward,
            'min_quiet_signals': args.min_quiet_signals,
            'surge_threshold': args.surge_threshold,
            'total_detections': len(results),
            'target_hits': target_hits,
            'stopped': stopped,
            'precision': precision,
            'avg_rr': avg_rr,
            'explosive_moves': len(explosive_moves),
            'detected_explosive': detected_explosive,
            'recall': recall,
            'results': results,
            'explosive_moves_detail': explosive_moves,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
