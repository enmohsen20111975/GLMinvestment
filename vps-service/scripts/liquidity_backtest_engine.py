#!/usr/bin/env python3
"""
liquidity_backtest_engine.py — محرك باك تيست السيولة الحقيقي المتقدم
================================================================
المرحلة 1 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-1)

المنهجية الفنية المعتمدة:
  1. حساب dynamic_threshold = percentile_75(volume) من البيانات المتاحة.
  2. لكل يوم فيه volume >= threshold:
       - سعر الدخول (entry_price) = سعر الإغلاق في يوم الإشارة.
       - نافذة الاحتفاظ (holding window) = 5 أيام تداول تالية.
       - فحص الهدف: هل وصل أعلى سعر (High) خلال الـ 5 أيام إلى العائد المستهدف (TARGET_RETURN = +1.5%)؟
       - إذا تحقق الهدف: HIT (صفقة ناجحة).
       - إذا لم يتحقق: MISS (صفقة خاسرة ويُحسب العائد على إغلاق اليوم الخامس).
  3. hit_rate = HIT / total_signals
  4. شرط التأهيل: (hit_rate >= 65% AND total_signals >= 30)

مصادر البيانات:
  - الأولوية الأولى: price_history.db (تاريخ يمتد لسنة كاملة عبر آلاف الصفقات)
  - الأولوية الثانية: intraday.db / data_engine.db (بيانات تكميلية)
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

# Backtest parameters
TARGET_HIT_RATE = 65.0       # الحد الأدنى لتأهيل السوق للمسار B
MIN_SIGNALS = 30             # أقل عدد إشارات لاعتبار النتيجة موثوقة
TARGET_RETURN_PCT = 1.5      # العائد المستهدف خلال 5 أيام (+1.5%)
HOLDING_DAYS = 5             # فترة الاحتفاظ بالصفقة (أيام تداول)


def parse_volume(v) -> int:
    """تحويل أحجام التداول إلى أرقام صحيحة بأمان تام (معالجة النصوص مثل 2.56M و 1.64K)."""
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


def ensure_tables(conn: sqlite3.Connection):
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_backtest_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            ticker TEXT,
            total_signals INTEGER DEFAULT 0,
            successful_signals INTEGER DEFAULT 0,
            failed_signals INTEGER DEFAULT 0,
            hit_rate REAL DEFAULT 0,
            avg_return REAL DEFAULT 0,
            dynamic_threshold REAL DEFAULT 0,
            backtest_start TEXT,
            backtest_end TEXT,
            backtest_days INTEGER,
            qualified INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, ticker, backtest_start, backtest_end)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_dynamic_threshold (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            threshold_date TEXT NOT NULL,
            threshold_value REAL NOT NULL,
            percentile_method TEXT DEFAULT 'p75',
            sample_size INTEGER DEFAULT 0,
            fallback_used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, threshold_date)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_signal_outcomes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market TEXT NOT NULL,
            ticker TEXT,
            signal_date TEXT NOT NULL,
            entry_price REAL,
            exit_price REAL,
            return_pct REAL,
            hit INTEGER DEFAULT 0,
            holding_days INTEGER DEFAULT 5,
            threshold_used REAL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(market, ticker, signal_date)
        )
    """)
    conn.commit()


def load_daily_ohlc(market: str, days: int = 365) -> List[dict]:
    """حمّل بيانات OHLC اليومية للسوق من أفضل مصدر متاح."""
    rows: List[dict] = []

    # 1. فحص price_history.db كأول وأفضل مصدر
    if db_exists(PRICE_HISTORY_DB):
        conn = open_db(PRICE_HISTORY_DB, readonly=True)
        if conn:
            try:
                market_codes = {
                    'EGX': ['EGX'],
                    'US': ['US'],
                    'KSA': ['TADAWUL', 'KSA', 'SAUDI'],
                }.get(market, [market])

                placeholders = ','.join('?' for _ in market_codes)
                query = f"""
                    SELECT date, ticker, open_price as open, high_price as high,
                           low_price as low, close_price as close, volume
                    FROM price_history
                    WHERE market IN ({placeholders})
                      AND volume IS NOT NULL
                      AND date >= (SELECT DATE(MAX(date), ?) FROM price_history WHERE market IN ({placeholders}))
                    ORDER BY date ASC, ticker
                """
                params = market_codes + [f'-{days} days'] + market_codes
                cur = conn.execute(query, params)
                for r in cur:
                    vol = parse_volume(r['volume'])
                    close_p = float(r['close'] or 0)
                    high_p = float(r['high'] or close_p)
                    low_p = float(r['low'] or close_p)
                    open_p = float(r['open'] or close_p)
                    if vol > 0 and close_p > 0:
                        rows.append({
                            'date': r['date'],
                            'ticker': r['ticker'],
                            'open': open_p,
                            'high': max(high_p, close_p, open_p),
                            'low': min(low_p, close_p, open_p),
                            'close': close_p,
                            'volume': vol,
                        })
                if rows:
                    print(f'  ✅ {market}: loaded {len(rows)} daily rows from price_history.db')
            except Exception as e:
                print(f'  ⚠️ price_history query error for {market}: {e}')
            conn.close()

    # 2. في حالة عدم وجود بيانات، فحص المصادر البديلة
    if not rows:
        if market == 'EGX' and db_exists(INTRADAY_DB):
            conn = open_db(INTRADAY_DB, readonly=True)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT DATE(timestamp) as date, ticker,
                               MAX(high) as high, MIN(low) as low,
                               (SELECT price FROM stock_intraday s2 WHERE s2.ticker = s1.ticker AND DATE(s2.timestamp) = DATE(s1.timestamp) ORDER BY timestamp DESC LIMIT 1) as close,
                               (SELECT price FROM stock_intraday s3 WHERE s3.ticker = s1.ticker AND DATE(s3.timestamp) = DATE(s1.timestamp) ORDER BY timestamp ASC LIMIT 1) as open,
                               SUM(volume) as volume
                        FROM stock_intraday s1
                        WHERE market = 'مصر' AND volume > 0
                        GROUP BY DATE(timestamp), ticker
                        ORDER BY DATE(timestamp) ASC, ticker
                    """)
                    for r in cur:
                        vol = parse_volume(r['volume'])
                        close_p = float(r['close'] or 0)
                        if vol > 0 and close_p > 0:
                            rows.append({
                                'date': r['date'],
                                'ticker': r['ticker'],
                                'open': float(r['open'] or close_p),
                                'high': float(r['high'] or close_p),
                                'low': float(r['low'] or close_p),
                                'close': close_p,
                                'volume': vol,
                            })
                    if rows:
                        print(f'  ✅ EGX: loaded {len(rows)} daily rows from intraday.db (fallback)')
                except Exception as e:
                    print(f'  ⚠️ intraday.db fallback error: {e}')
                conn.close()

        elif market == 'KSA' and db_exists(DATA_ENGINE_DB):
            conn = open_db(DATA_ENGINE_DB, readonly=True)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT date, symbol as ticker, open, high, low, close, volume
                        FROM historical_data
                        WHERE market = 'السعودية' AND volume > 0
                        ORDER BY date ASC, symbol
                    """)
                    for r in cur:
                        vol = parse_volume(r['volume'])
                        close_p = float(r['close'] or 0)
                        if vol > 0 and close_p > 0:
                            rows.append({
                                'date': r['date'],
                                'ticker': r['ticker'],
                                'open': float(r['open'] or close_p),
                                'high': float(r['high'] or close_p),
                                'low': float(r['low'] or close_p),
                                'close': close_p,
                                'volume': vol,
                            })
                    if rows:
                        print(f'  ✅ KSA: loaded {len(rows)} daily rows from data_engine.db (fallback)')
                except Exception as e:
                    print(f'  ⚠️ data_engine fallback error: {e}')
                conn.close()

    return rows


def calculate_threshold(volumes: List[int], percentile: float = 0.75) -> Tuple[float, int, bool]:
    if not volumes:
        return 100000.0, 0, True
    sorted_vols = sorted(volumes)
    idx = min(len(sorted_vols) - 1, int(len(sorted_vols) * percentile))
    return float(sorted_vols[idx]), len(sorted_vols), False


def run_liquidity_backtest(rows: List[dict], market: str) -> dict:
    """
    تشغيل باك تيست السيولة بالمنطق الاستثماري الصحيح:
    هل وصل السهم للهدف (+1.5%) خلال فترة الاحتفاظ (5 أيام تداول)؟
    """
    if not rows:
        return {
            'market': market,
            'total_signals': 0,
            'successful_signals': 0,
            'failed_signals': 0,
            'hit_rate': 0.0,
            'avg_return': 0.0,
            'dynamic_threshold': 0.0,
            'backtest_start': None,
            'backtest_end': None,
            'backtest_days': 0,
            'qualified': 0,
            'all_signals': [],
            'sample_size': 0,
            'fallback': True,
        }

    all_volumes = [r['volume'] for r in rows if r['volume'] > 0]
    threshold, sample_size, fallback = calculate_threshold(all_volumes, 0.75)

    by_ticker_date: dict = defaultdict(list)
    for r in rows:
        by_ticker_date[r['ticker']].append(r)

    signals: List[dict] = []
    target_multiplier = 1.0 + (TARGET_RETURN_PCT / 100.0)

    for ticker, ticker_rows in by_ticker_date.items():
        ticker_rows.sort(key=lambda x: x['date'])

        for i, row in enumerate(ticker_rows):
            if row['volume'] < threshold:
                continue
            if i + HOLDING_DAYS >= len(ticker_rows):
                continue

            entry_price = row['close']
            if entry_price <= 0:
                continue

            # فحص الـ 5 أيام التالية لمعرفة هل تحقق الهدف (+1.5%)
            future_rows = ticker_rows[i + 1 : i + 1 + HOLDING_DAYS]
            max_high = max(r['high'] for r in future_rows) if future_rows else entry_price
            exit_close = future_rows[-1]['close'] if future_rows else entry_price

            target_price = entry_price * target_multiplier

            if max_high >= target_price:
                hit = 1
                exit_price = max_high
                return_pct = ((exit_price - entry_price) / entry_price) * 100.0
            else:
                hit = 0
                exit_price = exit_close
                return_pct = ((exit_price - entry_price) / entry_price) * 100.0

            signals.append({
                'market': market,
                'ticker': ticker,
                'signal_date': row['date'],
                'entry_price': round(entry_price, 4),
                'exit_price': round(exit_price, 4),
                'return_pct': round(return_pct, 4),
                'hit': hit,
                'holding_days': HOLDING_DAYS,
                'threshold_used': threshold,
                'volume': row['volume'],
            })

    total_signals = len(signals)
    successful = sum(s['hit'] for s in signals)
    failed = total_signals - successful
    hit_rate = (successful / total_signals * 100.0) if total_signals > 0 else 0.0
    avg_return = (sum(s['return_pct'] for s in signals) / total_signals) if total_signals > 0 else 0.0

    backtest_start = min(s['signal_date'] for s in signals) if signals else None
    backtest_end = max(s['signal_date'] for s in signals) if signals else None
    backtest_days = 0
    if backtest_start and backtest_end:
        try:
            d1 = datetime.strptime(backtest_start, '%Y-%m-%d')
            d2 = datetime.strptime(backtest_end, '%Y-%m-%d')
            backtest_days = (d2 - d1).days
        except Exception:
            pass

    qualified = 1 if (hit_rate >= TARGET_HIT_RATE and total_signals >= MIN_SIGNALS) else 0

    return {
        'market': market,
        'total_signals': total_signals,
        'successful_signals': successful,
        'failed_signals': failed,
        'hit_rate': round(hit_rate, 2),
        'avg_return': round(avg_return, 4),
        'dynamic_threshold': threshold,
        'backtest_start': backtest_start,
        'backtest_end': backtest_end,
        'backtest_days': backtest_days,
        'qualified': qualified,
        'all_signals': signals,
        'sample_size': sample_size,
        'fallback': fallback,
    }


def save_results(conn: sqlite3.Connection, result: dict, ticker: Optional[str] = None):
    c = conn.cursor()
    notes = f'p75={result["dynamic_threshold"]:.0f}, sample={result["sample_size"]}, fallback={result["fallback"]}, target_return={TARGET_RETURN_PCT}%, holding_days={HOLDING_DAYS}'

    c.execute("""
        INSERT OR REPLACE INTO liquidity_backtest_results
        (market, ticker, total_signals, successful_signals, failed_signals,
         hit_rate, avg_return, dynamic_threshold, backtest_start, backtest_end,
         backtest_days, qualified, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    """, (
        result['market'],
        ticker,
        result['total_signals'],
        result['successful_signals'],
        result['failed_signals'],
        result['hit_rate'],
        result['avg_return'],
        result['dynamic_threshold'],
        result['backtest_start'],
        result['backtest_end'],
        result['backtest_days'],
        result['qualified'],
        notes,
    ))

    # حفظ عينة من الإشارات
    for sig in result['all_signals'][:300]:
        c.execute("""
            INSERT OR REPLACE INTO liquidity_signal_outcomes
            (market, ticker, signal_date, entry_price, exit_price, return_pct,
             hit, holding_days, threshold_used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            sig['market'],
            sig['ticker'],
            sig['signal_date'],
            sig['entry_price'],
            sig['exit_price'],
            sig['return_pct'],
            sig['hit'],
            sig['holding_days'],
            sig['threshold_used'],
        ))
    conn.commit()


def save_threshold(conn: sqlite3.Connection, market: str, threshold: float, sample_size: int, fallback: bool):
    c = conn.cursor()
    today_str = datetime.now().strftime('%Y-%m-%d')
    c.execute("""
        INSERT OR REPLACE INTO liquidity_dynamic_threshold
        (market, threshold_date, threshold_value, percentile_method,
         sample_size, fallback_used, created_at)
        VALUES (?, ?, ?, 'p75', ?, ?, datetime('now'))
    """, (market, today_str, threshold, sample_size, 1 if fallback else 0))
    conn.commit()


def main():
    global TARGET_RETURN_PCT, HOLDING_DAYS

    parser = argparse.ArgumentParser(description='Liquidity Backtest Engine — Phase 1')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    parser.add_argument('--execute', action='store_true', help='حفظ النتائج في DB')
    parser.add_argument('--market', type=str, default=None,
                        help='سوق محدد (EGX/US/KSA) — افتراضي: كل الأسواق')
    parser.add_argument('--days', type=int, default=365,
                        help='فترة الباك تيست بالأيام (افتراضي: 365)')
    parser.add_argument('--target-return', type=float, default=TARGET_RETURN_PCT,
                        help=f'العائد المستهدف % (افتراضي: {TARGET_RETURN_PCT})')
    parser.add_argument('--holding-days', type=int, default=HOLDING_DAYS,
                        help=f'فترة الاحتفاظ بالأيام (افتراضي: {HOLDING_DAYS})')
    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        args.dry_run = True

    TARGET_RETURN_PCT = args.target_return
    HOLDING_DAYS = args.holding_days

    print(f'\n{"#"*70}')
    print(f'# LIQUIDITY BACKTEST ENGINE — Phase 1 (REAL liquidity signals)')
    print(f'# Date: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'# Mode: {"DRY-RUN" if args.dry_run else "EXECUTE"}')
    print(f'# Target Return: {TARGET_RETURN_PCT}%  |  Holding: {HOLDING_DAYS} days')
    print(f'# Markets: {args.market or "ALL"}  |  Lookback: {args.days} days')
    print(f'{"#"*70}')

    markets = [args.market] if args.market else ['EGX', 'US', 'KSA']
    all_results: List[dict] = []

    for market in markets:
        print(f'\n{"="*60}')
        print(f'Market: {market}')
        print(f'{"="*60}')

        rows = load_daily_ohlc(market, args.days)
        if not rows:
            print(f'  ⚠️ no data for {market}, skipping')
            all_results.append({
                'market': market, 'total_signals': 0, 'qualified': 0,
                'hit_rate': 0, 'dynamic_threshold': 0,
                'notes': 'no data available',
            })
            continue

        result = run_liquidity_backtest(rows, market)

        print(f'\n  Results for {market}:')
        print(f'    threshold (p75): {result["dynamic_threshold"]:,.0f} (sample={result["sample_size"]}, fallback={result["fallback"]})')
        print(f'    total signals: {result["total_signals"]:,}')
        print(f'    successful (return >= {TARGET_RETURN_PCT}%): {result["successful_signals"]:,}')
        print(f'    failed: {result["failed_signals"]:,}')
        print(f'    hit_rate: {result["hit_rate"]:.2f}%')
        print(f'    avg_return: {result["avg_return"]:+.2f}%')
        print(f'    period: {result["backtest_start"]} → {result["backtest_end"]} ({result["backtest_days"]} days)')
        qualified_flag = '✅ QUALIFIED' if result['qualified'] else '❌ NOT YET'
        print(f'    qualification: {qualified_flag} (target: hit_rate >= {TARGET_HIT_RATE}% AND signals >= {MIN_SIGNALS})')

        if result['all_signals']:
            by_ticker_count: dict = defaultdict(int)
            by_ticker_wins: dict = defaultdict(int)
            for s in result['all_signals']:
                by_ticker_count[s['ticker']] += 1
                if s['hit']:
                    by_ticker_wins[s['ticker']] += 1

            print(f'\n    Top 5 tickers by signal count:')
            for ticker, count in sorted(by_ticker_count.items(), key=lambda x: -x[1])[:5]:
                wins = by_ticker_wins.get(ticker, 0)
                wr = (wins / count * 100) if count else 0
                print(f'      {ticker}: {count} signals, {wins} hits ({wr:.1f}%)')

        all_results.append(result)

        if args.execute:
            conn = open_db(PREDICTIONS_DB, readonly=False)
            if conn:
                ensure_tables(conn)
                save_results(conn, result)
                save_threshold(conn, market, result['dynamic_threshold'],
                               result['sample_size'], result['fallback'])
                conn.close()
                print(f'  ✅ saved to DB')

    print(f'\n{"="*70}')
    print(f'SUMMARY — Qualification for Track B')
    print(f'{"="*70}')
    for r in all_results:
        flag = '✅' if r['qualified'] else '❌'
        print(f'  {flag} {r["market"]}: hit_rate={r["hit_rate"]:.1f}% signals={r["total_signals"]:,} threshold={r["dynamic_threshold"]:,.0f}')

    print(f'\n💡 Next steps:')
    qualified_markets = [r['market'] for r in all_results if r['qualified']]
    if qualified_markets:
        print(f'  - Track B is eligible for: {", ".join(qualified_markets)}')
        print(f'  - Run dual_track_generator.py to start producing liquidity signals')
    else:
        print(f'  - No markets qualified yet.')

    print(f'\n✅ Backtest complete')


if __name__ == '__main__':
    main()
