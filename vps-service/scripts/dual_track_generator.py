#!/usr/bin/env python3
"""
dual_track_generator.py — مولّد التوقعات المزدوج (Track A + Track B)
=====================================================================
المرحلة 3 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-3)

الوظيفة:
  يولّد توقعات يومية على مسارين:
    Track A (full_analysis): نفس منطق V40.2 الحالي (تحليل فني + مالي + سيولة متوازنة)
                              — حد أقصى 5 توقعات يومياً
    Track B (liquidity):     سيولة مؤسسية استثنائية فقط (بلا حد)
                              — net_flow >= dynamic_threshold (p75 آخر 30 يوم)
                              — buy_pressure >= 80%
                              — volume >= 2× avg_volume_20
                              — السوق مؤهل من Phase 1 (hit_rate >= 65%)

شروط التأهيل للمسار B:
  1. السوق مؤهل من liquidity_backtest_results (qualified=1)
  2. الـ threshold اليومي محسوب في liquidity_dynamic_threshold
  3. السهم عنده:
     - volume >= threshold
     - volume >= 2× avg_volume_20
     - buy_pressure >= 80% (لو buy_volume متوفر)
     - net_flow >= 0 (volume_in - volume_out > 0)

الاستخدام:
  python3 vps-service/scripts/dual_track_generator.py --dry-run       # عرض فقط
  python3 vps-service/scripts/dual_track_generator.py --execute       # حفظ في DB
  python3 vps-service/scripts/dual_track_generator.py --market EGX    # سوق محدد
  python3 vps-service/scripts/dual_track_generator.py --track B       # المسار B فقط
  python3 vps-service/scripts/dual_track_generator.py --max-a 5       # حد أقصى للمسار A
"""

import sqlite3
import sys
import argparse
import statistics
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
INTRADAY_DB = str(PROJECT_ROOT / 'db' / 'intraday.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')

# Track A limits (full analysis — balanced, capped)
TRACK_A_DAILY_LIMIT = 5

# Track B entry filters (liquidity — strict, uncapped)
TRACK_B_BUY_PRESSURE_MIN = 80.0    # %
TRACK_B_VOLUME_RATIO_MIN = 2.0      # × avg_volume_20
TRACK_B_NET_FLOW_MIN = 0            # positive net inflow


# ── DB helpers ────────────────────────────────────────────────────────────

def open_db(path: str, readonly: bool = False) -> Optional[sqlite3.Connection]:
    try:
        conn = sqlite3.connect(path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f'  ⚠️ cannot open {path}: {e}')
        return None


def db_exists(path: str) -> bool:
    return Path(path).exists() and Path(path).stat().st_size > 0


def ensure_track_column(conn: sqlite3.Connection, table: str):
    """أضف track column للجدول لو مش موجود."""
    try:
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
        if 'track' not in cols:
            conn.execute(
                f"ALTER TABLE {table} ADD COLUMN track TEXT DEFAULT 'full_analysis'"
            )
            conn.commit()
            print(f'  ✅ added track column to {table}')
    except Exception as e:
        print(f'  ⚠️ cannot add track column to {table}: {e}')


# ── Qualification check ──────────────────────────────────────────────────

def get_qualified_markets(conn: sqlite3.Connection) -> List[str]:
    """رجّع قائمة الأسواق المؤهلة للمسار B من liquidity_backtest_results."""
    try:
        rows = conn.execute("""
            SELECT DISTINCT market FROM liquidity_backtest_results
            WHERE qualified = 1
        """).fetchall()
        return [r[0] for r in rows]
    except Exception:
        return []


def get_today_threshold(conn: sqlite3.Connection, market: str) -> Tuple[float, bool]:
    """رجّع الـ threshold اليومي للسوق من liquidity_dynamic_threshold."""
    today = datetime.now().strftime('%Y-%m-%d')
    try:
        row = conn.execute("""
            SELECT threshold_value, fallback_used
            FROM liquidity_dynamic_threshold
            WHERE market = ?
            ORDER BY threshold_date DESC
            LIMIT 1
        """, (market,)).fetchone()
        if row:
            return float(row[0]), bool(row[1])
    except Exception:
        pass
    return 100000.0, True  # fallback


# ── Liquidity data loader ────────────────────────────────────────────────

def load_today_liquidity(market: str) -> List[dict]:
    """
    حمّل بيانات سيولة اليوم لكل الأسهم في السوق.

    لكل سهم بيرجع:
      {ticker, date, open, high, low, close, volume,
       avg_volume_20, buy_volume, sell_volume, net_flow, buy_pressure}
    """
    rows: List[dict] = []

    if market == 'EGX' and db_exists(INTRADAY_DB):
        conn = open_db(INTRADAY_DB, readonly=True)
        if conn:
            try:
                # بيانات اليوم + آخر 20 يوم لحساب avg_volume_20
                cur = conn.execute("""
                    SELECT
                        DATE(timestamp) as date,
                        ticker,
                        MAX(high) as high,
                        MIN(low) as low,
                        (SELECT price FROM stock_intraday s2
                         WHERE s2.ticker = s1.ticker AND s2.market = s1.market
                           AND DATE(s2.timestamp) = DATE(s1.timestamp)
                         ORDER BY s2.timestamp DESC LIMIT 1) as close,
                        SUM(volume) as volume,
                        (SELECT price FROM stock_intraday s3
                         WHERE s3.ticker = s1.ticker AND s3.market = s1.market
                           AND DATE(s3.timestamp) = DATE(s1.timestamp)
                         ORDER BY s3.timestamp ASC LIMIT 1) as open
                    FROM stock_intraday s1
                    WHERE s1.market = 'مصر'
                      AND s1.volume IS NOT NULL AND s1.volume > 0
                      AND DATE(s1.timestamp) >= DATE('now', '-30 days')
                    GROUP BY DATE(timestamp), ticker
                    ORDER BY ticker, DATE(timestamp) ASC
                """)
                grouped: dict = defaultdict(list)
                for r in cur:
                    grouped[r['ticker']].append({
                        'date': r['date'],
                        'open': float(r['open'] or 0),
                        'high': float(r['high'] or 0),
                        'low': float(r['low'] or 0),
                        'close': float(r['close'] or 0),
                        'volume': int(r['volume'] or 0),
                    })

                for ticker, ticker_rows in grouped.items():
                    if len(ticker_rows) < 21:
                        continue  # محتاجين 20 يوم تاريخ + اليوم
                    today_row = ticker_rows[-1]
                    last_20 = ticker_rows[-21:-1]  # آخر 20 يوم قبل اليوم
                    avg_vol_20 = sum(r['volume'] for r in last_20) / len(last_20) if last_20 else 0

                    rows.append({
                        'ticker': ticker,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': today_row['volume'],
                        'avg_volume_20': int(avg_vol_20),
                        'buy_volume': None,   # intraday.db ما عندهوش buy/sell split
                        'sell_volume': None,
                        'net_flow': today_row['volume'],  # placeholder
                        'buy_pressure': None,
                    })
                print(f'  ✅ EGX: loaded {len(rows)} tickers with 20-day history')
            except Exception as e:
                print(f'  ⚠️ intraday query: {e}')
            conn.close()

    elif market == 'US' and db_exists(PRICE_HISTORY_DB):
        conn = open_db(PRICE_HISTORY_DB, readonly=True)
        if conn:
            try:
                cur = conn.execute("""
                    SELECT date, ticker, open_price, high_price, low_price,
                           close_price, volume, buy_volume, sell_volume
                    FROM price_history
                    WHERE market = 'US'
                      AND volume IS NOT NULL AND volume > 0
                      AND date >= DATE('now', '-30 days')
                    ORDER BY ticker, date ASC
                """)
                grouped: dict = defaultdict(list)
                for r in cur:
                    grouped[r['ticker']].append({
                        'date': r['date'],
                        'open': float(r['open_price'] or 0),
                        'high': float(r['high_price'] or 0),
                        'low': float(r['low_price'] or 0),
                        'close': float(r['close_price'] or 0),
                        'volume': int(r['volume'] or 0),
                        'buy_volume': int(r['buy_volume']) if r['buy_volume'] else None,
                        'sell_volume': int(r['sell_volume']) if r['sell_volume'] else None,
                    })

                for ticker, ticker_rows in grouped.items():
                    if len(ticker_rows) < 21:
                        continue
                    today_row = ticker_rows[-1]
                    last_20 = ticker_rows[-21:-1]
                    avg_vol_20 = sum(r['volume'] for r in last_20) / len(last_20) if last_20 else 0

                    buy_vol = today_row.get('buy_volume')
                    sell_vol = today_row.get('sell_volume')
                    net_flow = (buy_vol - sell_vol) if (buy_vol is not None and sell_vol is not None) else today_row['volume']
                    buy_pressure = (buy_vol / (buy_vol + sell_vol) * 100) if (buy_vol and sell_vol and (buy_vol + sell_vol) > 0) else None

                    rows.append({
                        'ticker': ticker,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': today_row['volume'],
                        'avg_volume_20': int(avg_vol_20),
                        'buy_volume': buy_vol,
                        'sell_volume': sell_vol,
                        'net_flow': net_flow,
                        'buy_pressure': buy_pressure,
                    })
                print(f'  ✅ US: loaded {len(rows)} tickers with 20-day history')
            except Exception as e:
                print(f'  ⚠️ price_history query: {e}')
            conn.close()

    elif market == 'KSA' and db_exists(DATA_ENGINE_DB):
        conn = open_db(DATA_ENGINE_DB, readonly=True)
        if conn:
            try:
                cur = conn.execute("""
                    SELECT date, symbol, open, high, low, close, volume
                    FROM historical_data
                    WHERE market = 'السعودية'
                      AND volume IS NOT NULL AND volume > 0
                      AND date >= DATE('now', '-30 days')
                    ORDER BY symbol, date ASC
                """)
                grouped: dict = defaultdict(list)
                for r in cur:
                    grouped[r['symbol']].append({
                        'date': r['date'],
                        'open': float(r['open'] or 0),
                        'high': float(r['high'] or 0),
                        'low': float(r['low'] or 0),
                        'close': float(r['close'] or 0),
                        'volume': int(r['volume'] or 0),
                    })

                for ticker, ticker_rows in grouped.items():
                    if len(ticker_rows) < 21:
                        continue
                    today_row = ticker_rows[-1]
                    last_20 = ticker_rows[-21:-1]
                    avg_vol_20 = sum(r['volume'] for r in last_20) / len(last_20) if last_20 else 0

                    rows.append({
                        'ticker': ticker,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': today_row['volume'],
                        'avg_volume_20': int(avg_vol_20),
                        'buy_volume': None,
                        'sell_volume': None,
                        'net_flow': today_row['volume'],
                        'buy_pressure': None,
                    })
                print(f'  ✅ KSA: loaded {len(rows)} tickers with 20-day history')
            except Exception as e:
                print(f'  ⚠️ data_engine query: {e}')
            conn.close()

    return rows


# ── Track B filter logic ─────────────────────────────────────────────────

def filter_track_b_candidates(rows: List[dict], threshold: float) -> List[dict]:
    """
    رشّح الأسهم اللي تستوفي شروط المسار B:
      - volume >= threshold (dynamic p75)
      - volume >= 2× avg_volume_20
      - buy_pressure >= 80% (لو متوفر)
      - net_flow > 0
    """
    candidates: List[dict] = []

    for r in rows:
        if r['volume'] < threshold:
            continue
        if r['avg_volume_20'] > 0 and r['volume'] < r['avg_volume_20'] * TRACK_B_VOLUME_RATIO_MIN:
            continue
        if r['buy_pressure'] is not None and r['buy_pressure'] < TRACK_B_BUY_PRESSURE_MIN:
            continue
        if r['net_flow'] <= TRACK_B_NET_FLOW_MIN:
            continue

        # احسب risk/reward أساسي
        entry = r['close']
        target = entry * 1.05   # +5% target
        stop = entry * 0.95     # -5% stop
        risk_reward = 1.0       # 5/5 = 1.0

        candidates.append({
            'ticker': r['ticker'],
            'market': 'EGX',  # هيتحدّث في الـ caller
            'signal': 'BUY',
            'signal_type': 'LIQUIDITY_RADAR',
            'track': 'liquidity',
            'entry_price': round(entry, 4),
            'target_price': round(target, 4),
            'target_price_2': round(entry * 1.10, 4),  # +10% target 2
            'stop_loss': round(stop, 4),
            'risk_reward': risk_reward,
            'confidence': 75,   # default
            'prediction_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'status': 'active',
            'volume': r['volume'],
            'avg_volume_20': r['avg_volume_20'],
            'volume_ratio': round(r['volume'] / r['avg_volume_20'], 2) if r['avg_volume_20'] > 0 else 0,
            'buy_pressure': r['buy_pressure'],
            'net_flow': r['net_flow'],
            'threshold_used': threshold,
            'reasoning': f'volume={r["volume"]} >= p75({threshold:.0f}), vol_ratio={r["volume"]/max(r["avg_volume_20"],1):.2f}x',
        })

    return candidates


# ── Persistence ──────────────────────────────────────────────────────────

def save_track_b_predictions(conn: sqlite3.Connection, predictions: List[dict]):
    """احفظ توقعات المسار B في predictions table."""
    saved = 0
    for p in predictions:
        try:
            conn.execute("""
                INSERT INTO predictions
                (ticker, signal, signal_type, prediction_date, entry_price,
                 target_price, target_price_2, stop_loss, status, confidence,
                 risk_reward, market, track, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (
                p['ticker'], p['signal'], p['signal_type'], p['prediction_date'],
                p['entry_price'], p['target_price'], p['target_price_2'],
                p['stop_loss'], p['status'], p['confidence'], p['risk_reward'],
                p['market'], p['track'], p['reasoning'],
            ))
            saved += 1
        except Exception as e:
            print(f'  ⚠️ save {p["ticker"]}: {e}')
    conn.commit()
    return saved


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Dual-Track Generator — Phase 3')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    parser.add_argument('--execute', action='store_true', help='حفظ في DB')
    parser.add_argument('--market', type=str, default=None,
                        help='سوق محدد (EGX/US/KSA) — افتراضي: كل المؤهلة')
    parser.add_argument('--track', type=str, default='B', choices=['A', 'B', 'both'],
                        help='المسار: A (full) / B (liquidity) / both (افتراضي: B)')
    parser.add_argument('--max-a', type=int, default=TRACK_A_DAILY_LIMIT,
                        help=f'حد أقصى للمسار A (افتراضي: {TRACK_A_DAILY_LIMIT})')
    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        args.dry_run = True

    print(f'\n{"#"*70}')
    print(f'# DUAL-TRACK GENERATOR — Phase 3')
    print(f'# Date: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'# Mode: {"DRY-RUN" if args.dry_run else "EXECUTE"}')
    print(f'# Track: {args.track}  |  Market: {args.market or "ALL qualified"}')
    print(f'{"#"*70}')

    if not db_exists(PREDICTIONS_DB):
        print('\n⚠️ predictions.db not found — cannot proceed')
        return

    conn = open_db(PREDICTIONS_DB, readonly=False)
    if not conn:
        return

    # تأكد إن track column موجود
    ensure_track_column(conn, 'predictions')

    # 1) حدّد الأسواق المؤهلة
    qualified = get_qualified_markets(conn)
    markets_to_process = [args.market] if args.market else qualified

    if not markets_to_process:
        print('\n⚠️ no qualified markets found for Track B')
        print('  → Run liquidity_backtest_engine.py --execute first')
        conn.close()
        return

    print(f'\nQualified markets: {markets_to_process}')

    total_b_generated = 0
    for market in markets_to_process:
        print(f'\n{"="*60}')
        print(f'Market: {market}')
        print(f'{"="*60}')

        # 2) احصل على threshold اليومي
        threshold, fallback = get_today_threshold(conn, market)
        print(f'  threshold: {threshold:.0f} (fallback={fallback})')

        # 3) حمّل بيانات سيولة اليوم
        rows = load_today_liquidity(market)
        if not rows:
            print(f'  ⚠️ no liquidity data for {market}')
            continue

        # 4) رشّح أسهم المسار B
        candidates = filter_track_b_candidates(rows, threshold)
        for c in candidates:
            c['market'] = market

        print(f'  Track B candidates: {len(candidates)}')
        for c in candidates[:10]:  # أول 10 للعرض
            print(f'    - {c["ticker"]}: vol={c["volume"]} ratio={c["volume_ratio"]}x entry={c["entry_price"]} target={c["target_price"]}')

        if args.track in ('B', 'both') and args.execute:
            saved = save_track_b_predictions(conn, candidates)
            print(f'  ✅ saved {saved} Track B predictions to DB')
            total_b_generated += saved

        if args.track == 'A':
            print(f'  ℹ️ Track A generation uses existing V40.2 generator (not implemented here)')

    # Summary
    print(f'\n{"="*70}')
    print(f'SUMMARY')
    print(f'{"="*70}')
    print(f'  Track B generated: {total_b_generated}')
    if args.dry_run:
        print(f'  (dry-run: nothing saved. Use --execute to persist.)')

    conn.close()
    print(f'\n✅ Generator complete')


if __name__ == '__main__':
    main()
