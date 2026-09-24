#!/usr/bin/env python3
"""
dual_track_generator.py — مٌولّد توقعات المسار المزدوج (المسار B: السيولة الاستثنائية)
================================================================
المرحلة 3 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-3)

الشروط الصارمة لتوليد إشارة المسار B (السيولة):
  1. حجم تداول السهم اليوم >= dynamic_threshold (p75 للسوق).
  2. حجم التداول اليومي >= 1.5x متوسط حجم آخر 20 يوماً (مؤشر زخم سيولة ومشتري مؤسسي).
  3. شمعة الشراء خضراء (Close >= Open) للتأكد من أنها سيولة تجميع ودخول وليست تصريفاً.
  4. السوق مؤهل ومعتمد من الـ Backtest (hit_rate >= 65%).
"""

import sqlite3
import sys
import argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Optional, List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
INTRADAY_DB = str(PROJECT_ROOT / 'db' / 'intraday.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')

TRACK_A_DAILY_LIMIT = 5
TRACK_B_VOLUME_RATIO_MIN = 1.5   # 1.5x متوسط 20 يوم


def parse_volume(v) -> int:
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    v_str = str(v).replace('\u202f', '').replace(' ', '').replace(',', '').strip().upper()
    if not v_str:
        return 0
    try:
        if v_str.endswith('B'):
            return int(float(v_str[:-1]) * 1_000_000_000)
        if v_str.endswith('M'):
            return int(float(v_str[:-1]) * 1_000_000)
        if v_str.endswith('K'):
            return int(float(v_str[:-1]) * 1_000)
        return int(float(v_str))
    except Exception:
        return 0


def open_db(path: str, readonly: bool = True) -> Optional[sqlite3.Connection]:
    try:
        conn = sqlite3.connect(path, timeout=15.0)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f'  ⚠️ cannot open {path}: {e}')
        return None


def db_exists(path: str) -> bool:
    return Path(path).exists() and Path(path).stat().st_size > 0


def ensure_track_column(conn: sqlite3.Connection, table_name: str = 'predictions'):
    try:
        cur = conn.execute(f"PRAGMA table_info({table_name})")
        cols = [r['name'] for r in cur.fetchall()]
        if 'track' not in cols:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN track TEXT DEFAULT 'full_analysis'")
            conn.commit()
            print(f'  ✅ added track column to {table_name}')
    except Exception as e:
        print(f'  ⚠️ ensure_track_column error: {e}')


def get_qualified_markets(conn: sqlite3.Connection) -> List[str]:
    try:
        cur = conn.execute("""
            SELECT DISTINCT market FROM liquidity_backtest_results
            WHERE qualified = 1
        """)
        return [r['market'] for r in cur.fetchall()]
    except Exception as e:
        print(f'  ⚠️ error reading qualified markets: {e}')
        return []


def get_today_threshold(conn: sqlite3.Connection, market: str) -> Tuple[float, bool]:
    try:
        cur = conn.execute("""
            SELECT threshold_value FROM liquidity_dynamic_threshold
            WHERE market = ?
            ORDER BY threshold_date DESC, id DESC LIMIT 1
        """, (market,))
        row = cur.fetchone()
        if row and row['threshold_value'] > 0:
            return float(row['threshold_value']), False
    except Exception:
        pass
    fallbacks = {'EGX': 1500000.0, 'US': 10000000.0, 'KSA': 200000.0}
    return fallbacks.get(market, 500000.0), True


def load_recent_market_liquidity(market: str) -> List[dict]:
    """تحميل بيانات أحدث جلسات التداول لجميع الأسهم لحساب متوسط 20 يوم والسيولة الحالية."""
    rows: List[dict] = []

    market_codes = {
        'EGX': ['EGX'],
        'US': ['US'],
        'KSA': ['TADAWUL', 'KSA', 'SAUDI'],
    }.get(market, [market])

    if db_exists(PRICE_HISTORY_DB):
        conn = open_db(PRICE_HISTORY_DB, readonly=True)
        if conn:
            try:
                placeholders = ','.join('?' for _ in market_codes)
                # جلب آخر 60 يوماً من أحدث تاريخ في قاعدة البيانات
                query = f"""
                    SELECT date, ticker, open_price as open, high_price as high,
                           low_price as low, close_price as close, volume
                    FROM price_history
                    WHERE market IN ({placeholders})
                      AND volume IS NOT NULL
                      AND date >= (SELECT DATE(MAX(date), '-60 days') FROM price_history WHERE market IN ({placeholders}))
                    ORDER BY ticker, date ASC
                """
                cur = conn.execute(query, market_codes + market_codes)
                grouped = defaultdict(list)
                for r in cur:
                    vol = parse_volume(r['volume'])
                    close_p = float(r['close'] or 0)
                    open_p = float(r['open'] or close_p)
                    high_p = float(r['high'] or close_p)
                    low_p = float(r['low'] or close_p)
                    if vol > 0 and close_p > 0:
                        grouped[r['ticker']].append({
                            'date': r['date'],
                            'open': open_p,
                            'high': high_p,
                            'low': low_p,
                            'close': close_p,
                            'volume': vol,
                        })

                for ticker, t_rows in grouped.items():
                    if len(t_rows) < 3:
                        continue  # نحتاج على الأقل 3 أيام تداول مسجلة
                    today_row = t_rows[-1]
                    hist = t_rows[:-1]
                    avg_vol_20 = sum(x['volume'] for x in hist[-20:]) / len(hist[-20:]) if hist else today_row['volume']

                    rows.append({
                        'ticker': ticker,
                        'market': market,
                        'date': today_row['date'],
                        'open': today_row['open'],
                        'high': today_row['high'],
                        'low': today_row['low'],
                        'close': today_row['close'],
                        'volume': today_row['volume'],
                        'avg_volume_20': int(avg_vol_20),
                        'buy_pressure': 85.0 if today_row['close'] >= today_row['open'] else 40.0,
                        'net_flow': today_row['volume'],
                    })
                if rows:
                    print(f'  ✅ {market}: loaded {len(rows)} active tickers from price_history.db')
            except Exception as e:
                print(f'  ⚠️ error loading liquidity for {market}: {e}')
            conn.close()

    return rows


def filter_track_b_candidates(rows: List[dict], threshold: float) -> List[dict]:
    """تصفية الأسهم التي تحقق شروط السيولة الاستثنائية للمسار B."""
    candidates = []
    for r in rows:
        # 1. تخطي إذا كان الحجم أقل من العتبة الديناميكية p75
        if r['volume'] < threshold:
            continue
        # 2. مؤشر الزخم المؤسسي: الحجم الحالي >= 1.5x متوسط 20 يوم
        if r['avg_volume_20'] > 0 and r['volume'] < (r['avg_volume_20'] * TRACK_B_VOLUME_RATIO_MIN):
            continue
        # 3. التأكد من اتجاه الشراء (الشمعة خضراء Close >= Open)
        if r['close'] < r['open']:
            continue

        entry_price = round(r['close'], 4)
        target_1 = round(entry_price * 1.025, 4)   # هدف أول 2.5%
        target_2 = round(entry_price * 1.050, 4)   # هدف ثانٍ 5.0%
        stop_loss = round(entry_price * 0.975, 4)  # وقف خسارة 2.5%

        vol_ratio = r['volume'] / max(r['avg_volume_20'], 1)

        candidates.append({
            'ticker': r['ticker'],
            'market': r['market'],
            'prediction_date': r['date'],
            'signal': 'BUY',
            'signal_type': 'LIQUIDITY_BREAKOUT',
            'entry_price': entry_price,
            'target_price': target_1,
            'target_price_2': target_2,
            'stop_loss': stop_loss,
            'status': 'ACTIVE',
            'confidence': 88.0,
            'risk_reward': 1.5,
            'track': 'liquidity',
            'volume': r['volume'],
            'avg_volume_20': r['avg_volume_20'],
            'vol_ratio': vol_ratio,
            'reasoning': f'💧 سيولة استثنائية {vol_ratio:.1f}x ضعف المتوسط مع شمعة شرائية صاعدة وتجاوز عتبة p75 ({threshold:,.0f})',
        })

    candidates.sort(key=lambda x: -x['vol_ratio'])
    return candidates


def save_track_b_predictions(conn: sqlite3.Connection, predictions: List[dict]):
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
            print(f'  ⚠️ save error for {p["ticker"]}: {e}')
    conn.commit()
    return saved


def main():
    parser = argparse.ArgumentParser(description='Dual-Track Generator — Phase 3')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    parser.add_argument('--execute', action='store_true', help='حفظ في DB')
    parser.add_argument('--market', type=str, default=None,
                        help='سوق محدد (EGX/US/KSA) — افتراضي: كل المؤهلة')
    parser.add_argument('--track', type=str, default='B', choices=['A', 'B', 'both'])
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

    ensure_track_column(conn, 'predictions')

    qualified = get_qualified_markets(conn)
    markets_to_process = [args.market] if args.market else qualified

    if not markets_to_process:
        print('\n⚠️ no qualified markets found in liquidity_backtest_results')
        print('  → Run liquidity_backtest_engine.py --execute first')
        conn.close()
        return

    print(f'\nQualified markets: {markets_to_process}')

    total_b_generated = 0
    for market in markets_to_process:
        print(f'\n{"="*60}')
        print(f'Market: {market}')
        print(f'{"="*60}')

        threshold, fallback = get_today_threshold(conn, market)
        print(f'  threshold: {threshold:,.0f} (fallback={fallback})')

        rows = load_recent_market_liquidity(market)
        if not rows:
            print(f'  ⚠️ no liquidity data for {market}')
            continue

        candidates = filter_track_b_candidates(rows, threshold)
        print(f'  🎯 Found {len(candidates)} Track B liquidity candidate(s):')
        for c in candidates[:10]:
            print(f"    - {c['ticker']}: entry={c['entry_price']} | target={c['target_price']} | vol_ratio={c['vol_ratio']:.1f}x | {c['reasoning']}")

        if args.execute and candidates:
            saved = save_track_b_predictions(conn, candidates)
            print(f'  ✅ Saved {saved} Track B prediction(s) to DB')
            total_b_generated += saved
        else:
            total_b_generated += len(candidates)

    conn.close()
    print(f'\n{"="*70}')
    print(f'SUMMARY: Track B generated: {total_b_generated}')
    print(f'{"="*70}')


if __name__ == '__main__':
    main()
