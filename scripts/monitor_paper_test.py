#!/usr/bin/env python3
"""
monitor_paper_test.py — مراقبة يومية لـ paper test v2
======================================================
يسحب أحدث أسعار الأسهم الـ 7 من db/production_snapshot.db و يحسب:
  - P&L لكل صفقة (unrealized)
  - هل وصلت للـ stop / target / 1.5R partial
  - هل ظهر توزيع → exit signal
  - هل السيولة اختفت → exit signal

CLI:
  python3 scripts/monitor_paper_test.py
  python3 scripts/monitor_paper_test.py --refresh-data   # اسحب أحدث بيانات من الإنتاج الأول
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PAPER_CONFIG = PROJECT_ROOT / "db" / "paper_test_v2.json"
PROD_DB = PROJECT_ROOT / "db" / "production_snapshot.db"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import detect_quiet_accumulation, has_volume_surge


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


def fetch_latest_data(conn, ticker, days=30):
    rows = conn.execute("""
        SELECT price_date, open, high, low, close, volume, turnover
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC
        LIMIT ?
    """, (ticker, days)).fetchall()
    return list(reversed(rows))


def check_distribution(closes, volumes, highs=None, lows=None):
    """فحص ظهور توزيع (distribution) في آخر 3 أيام.

    distribution = close < (high+low)/2 AND volume > avg_20d AND close < prev_close
    """
    if len(closes) < 23 or len(volumes) < 23:
        return False, 'insufficient data'

    avg_20_vol = sum(volumes[-23:-3]) / 20 if len(volumes) >= 23 else 0
    if avg_20_vol <= 0:
        return False, 'avg_20_vol = 0'

    dist_days = 0
    for i in range(-3, 0):
        if i < -len(closes):
            continue
        h = highs[i] if highs and i < -len(highs) else max(closes[i], closes[i-1])
        l = lows[i] if lows and i < -len(lows) else min(closes[i], closes[i-1])
        c = closes[i]
        v = volumes[i]
        prev_c = closes[i-1] if i > -len(closes) else c

        if h > l and avg_20_vol > 0:
            mid = (h + l) / 2
            # distribution: close تحت الـ mid + volume عالي + close نازل
            if c < mid and v > avg_20_vol and c < prev_c:
                dist_days += 1

    if dist_days >= 2:
        return True, f'distribution detected: {dist_days}/3 days'
    return False, f'distribution ok: {dist_days}/3 days'


def compute_turnover(row, close, volume):
    """احسب turnover: استخدم field لو موجود، غير كده close × volume."""
    t = row['turnover'] if 'turnover' in row.keys() else None
    if t is not None:
        try:
            t_float = float(t)
            if t_float > 0:
                return t_float
        except (TypeError, ValueError):
            pass
    return float(close) * float(volume) if close and volume else 0


def check_liquidity_disappear(turnovers, avg_turnover_baseline):
    """فحص اختفاء السيولة (turnover نزل تحت 50% من المتوسط التاريخي)."""
    if not turnovers or avg_turnover_baseline <= 0:
        return False, 'no baseline'
    # خد آخر 3 turnovers valid
    last_3 = [t for t in turnovers[-3:] if t and t > 0]
    if len(last_3) < 2:
        return False, 'insufficient recent turnover data'
    avg_3 = sum(last_3) / len(last_3)
    ratio = avg_3 / avg_turnover_baseline
    if ratio < 0.5:
        return True, f'liquidity dropped: avg_3d {avg_3:,.0f} < 50% of baseline {avg_turnover_baseline:,.0f}'
    return False, f'liquidity ok: avg_3d/baseline = {ratio:.2f}'


def main():
    parser = argparse.ArgumentParser(description='مراقبة يومية لـ paper test v2')
    parser.add_argument('--refresh-data', action='store_true', help='اسحب أحدث بيانات من الإنتاج قبل المراقبة')
    args = parser.parse_args()

    log(f"═══ مراقبة paper test v2 — {datetime.now().strftime('%Y-%m-%d %H:%M')} ═══\n")

    if not PAPER_CONFIG.exists():
        log(f"❌ {PAPER_CONFIG} مش موجود.")
        return 1
    config = json.load(open(PAPER_CONFIG))

    if not PROD_DB.exists():
        log(f"❌ {PROD_DB} مش موجود.")
        return 1

    # لو طلب refresh، اسحب البيانات من الإنتاج
    if args.refresh_data:
        log("  ⚠️ --refresh-data مش متاح دلوقتي (الإنتاج تحت ضغط). استخدم البيانات المحلية.")
        log("  💡 لو محتاج تحدّث، شغّل scripts/fetch_production_data.py يدوياً.\n")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PROD_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    stocks = config['stocks']
    log(f"  الصفقات الورقية: {len(stocks)}")
    log(f"  رأس المال الافتراضي: {config['capital_virtual_egp']:,} EGP")
    log(f"  إجمالي المستثمر: {config['total_position_amount_egp']:,} EGP ({config['total_position_amount_egp']/config['capital_virtual_egp']*100:.1f}%)\n")

    today_str = datetime.now().strftime("%Y-%m-%d")
    total_unrealized_pnl = 0
    total_risk_taken = 0
    daily_tracking_entry = {'date': today_str, 'stocks': []}
    exit_signals = []

    log(f"{'#':>3} {'Ticker':8s} {'Entry':>8s} {'Current':>8s} {'P&L%':>7s} {'P&L EGP':>10s} {'Status':>15s} {'Signal':>30s}")
    log("-" * 110)

    for s in stocks:
        ticker = s['ticker']
        entry_price = s['entry_price']
        stop_price = s['stop_price']
        target_price = s['target_price']
        shares = s['shares']

        rows = fetch_latest_data(conn, ticker, days=30)
        if not rows:
            log(f"{s['priority']:>3} {ticker:8s} {entry_price:>8.2f} {'N/A':>8s} {'N/A':>7s} {'N/A':>10s} {'NO_DATA':>15s}")
            continue

        latest = rows[-1]
        current_price = latest['close']
        latest_date = latest['price_date']

        closes = [r['close'] for r in rows if r['close'] and r['close'] > 0]
        volumes = [parse_volume(r['volume']) for r in rows]
        highs = [r['high'] or r['close'] for r in rows]
        lows = [r['low'] or r['close'] for r in rows]
        turnovers = [compute_turnover(r, c, v) for r,c,v in zip(rows, closes, volumes)]

        # P&L
        pnl_pct = (current_price - entry_price) / entry_price * 100
        pnl_egp = (current_price - entry_price) * shares
        total_unrealized_pnl += pnl_egp

        # R multiple
        risk_per_share = entry_price - stop_price
        r_multiple = (current_price - entry_price) / risk_per_share if risk_per_share > 0 else 0
        total_risk_taken += s['risk_amount_egp']

        # تحقق من exit signals
        status = 'OPEN'
        exit_reason = ''

        # 1. Stop loss
        if current_price <= stop_price:
            status = 'STOPPED_OUT'
            exit_reason = f'hit stop {stop_price:.2f}'

        # 2. Target
        elif current_price >= target_price:
            status = 'TARGET_HIT'
            exit_reason = f'hit target {target_price:.2f}'

        # 3. Distribution
        elif current_price < entry_price:  # بس لو خسران
            dist_detected, dist_reason = check_distribution(closes, volumes, highs, lows)
            if dist_detected:
                status = 'EXIT_DISTRIBUTION'
                exit_reason = dist_reason

        # 4. Liquidity disappeared
        liq_disappeared, liq_reason = check_liquidity_disappear(
            turnovers, s['avg_turnover_20d']
        )
        if liq_disappeared and status == 'OPEN':
            status = 'EXIT_LIQUIDITY'
            exit_reason = liq_reason

        # 5. 1.5R partial exit signal
        partial_signal = ''
        if r_multiple >= 1.5 and status == 'OPEN':
            partial_signal = '🎯 1.5R partial'

        # تحديث الـ tracking
        tracking = {
            'date': latest_date,
            'current_price': current_price,
            'pnl_pct': round(pnl_pct, 2),
            'pnl_egp': round(pnl_egp, 2),
            'r_multiple': round(r_multiple, 2),
            'status': status,
            'exit_reason': exit_reason,
            'partial_signal': partial_signal,
        }
        s['daily_tracking'].append(tracking)
        daily_tracking_entry['stocks'].append(tracking)

        if status != 'OPEN':
            exit_signals.append({'ticker': ticker, 'status': status, 'reason': exit_reason})

        # عرض
        pnl_str = f"{pnl_pct:+.2f}%"
        pnl_egp_str = f"{pnl_egp:+.1f}"
        signal_str = exit_reason or partial_signal or '-'
        log(f"{s['priority']:>3} {ticker:8s} {entry_price:>8.2f} {current_price:>8.2f} {pnl_str:>7s} {pnl_egp_str:>10s} {status:>15s} {signal_str:>30s}")

    conn.close()

    # ملخص
    log(f"\n═══ الملخص ═══")
    log(f"  إجمالي P&L غير المحقق: {total_unrealized_pnl:+.2f} EGP ({total_unrealized_pnl/config['total_position_amount_egp']*100:+.2f}%)")
    log(f"  إجمالي المخاطرة المأخوذة: {total_risk_taken:.2f} EGP")
    log(f"  صفقات لسه مفتوحة: {sum(1 for s in stocks if s['status']=='OPEN')}/{len(stocks)}")
    log(f"  ⚠️ exit signals: {len(exit_signals)}")
    for es in exit_signals:
        log(f"    - {es['ticker']}: {es['status']} ({es['reason']})")

    # احفظ الـ config المحدّث
    config['last_monitoring_at'] = datetime.now().isoformat()
    config['total_unrealized_pnl_egp'] = round(total_unrealized_pnl, 2)
    with open(PAPER_CONFIG, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # احفظ قراءة اليوم
    today_short = datetime.now().strftime("%Y%m%d")
    out_path = OUTPUT_DIR / f"paper_test_monitor_{today_short}.json"
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({
            'monitoring_date': today_str,
            'total_unrealized_pnl_egp': round(total_unrealized_pnl, 2),
            'total_position_amount_egp': config['total_position_amount_egp'],
            'open_positions': sum(1 for s in stocks if s['status']=='OPEN'),
            'exit_signals': exit_signals,
            'daily_tracking': daily_tracking_entry,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ Daily monitor saved: {out_path}")
    log(f"✅ Paper config updated: {PAPER_CONFIG}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
