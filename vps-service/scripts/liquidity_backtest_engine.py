#!/usr/bin/env python3
"""
liquidity_backtest_engine.py — محرك باك تيست السيولة الحقيقي
================================================================
المرحلة 1 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-1)

الفرق عن أي backtest سابق:
  السابق: hit_rate = wins / total_predictions  (win_rate عام للمنصة)
  ده:    لكل يوم فيه net_flow >= threshold، هل السعر طلع >= X% في 5 أيام؟
         → hit_rate الخاص بإشارات السيولة فقط.

الخوارزمية (النموذج الصحيح حسب طلب المبرمج الثاني):
  1. احسب dynamic_threshold = percentile_75(volume) آخر 30 يوم
  2. لكل يوم تداول:
       لو volume >= threshold:
         - سجل entry_price = close يوم الإشارة
         - بعد 5 أيام تداول: exit_price = close
         - return_pct = (exit_price - entry_price) / entry_price * 100
         - لو return_pct >= TARGET_RETURN (1.5%): HIT
         - وإلا: MISS
  3. hit_rate = HIT / total_signals
  4. qualified = (hit_rate >= 65% AND total_signals >= 30)

مصادر البيانات (بأولوية):
  EGX  → intraday.db.stock_intraday (market='مصر') — آخر 90 يوم
  US   → price_history.db.price_history (market='US') — آخر 365 يوم
  KSA  → data_engine.db.historical_data (market='السعودية') — آخر 365 يوم
  CRYPTO → data_engine.db.crypto_prices — آخر 90 يوم

الاستخدام:
  python3 vps-service/scripts/liquidity_backtest_engine.py --dry-run       # عرض فقط
  python3 vps-service/scripts/liquidity_backtest_engine.py --execute       # حفظ في DB
  python3 vps-service/scripts/liquidity_backtest_engine.py --market EGX    # سوق محدد
  python3 vps-service/scripts/liquidity_backtest_engine.py --days 180       # فترة محددة
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

# Win/loss status definitions
WIN_STATUSES = {'TARGET_HIT', 'closed_win'}
LOSS_STATUSES = {'closed_stop', 'STOPPED'}
EXPIRED_STATUSES = {'EXPIRED', 'expired', 'CLOSED'}

# Backtest parameters (قابلة للتعديل)
TARGET_HIT_RATE = 65.0       # الحد الأدنى لتأهيل السوق للمسار B
MIN_SIGNALS = 30             # أقل عدد إشارات لاعتبار النتيجة موثوقة
TARGET_RETURN_PCT = 1.5      # العائد المستهدف خلال 5 أيام
HOLDING_DAYS = 5             # فترة الاحتفاظ بالصفقة (أيام تداول)
THRESHOLD_DAYS = 30          # فترة حساب الـ percentile_75


# ── DB helpers ────────────────────────────────────────────────────────────

def open_db(path: str, readonly: bool = True) -> Optional[sqlite3.Connection]:
    """افتح DB بـ safe error handling."""
    try:
        conn = sqlite3.connect(path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f'  ⚠️ cannot open {path}: {e}')
        return None


def db_exists(path: str) -> bool:
    return Path(path).exists() and Path(path).stat().st_size > 0


def ensure_tables(conn: sqlite3.Connection):
    """أنشئ جداول النتائج لو مش موجودة."""
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


# ── Data loaders ──────────────────────────────────────────────────────────

def load_daily_ohlc(market: str, days: int = 90) -> List[dict]:
    """
    حمّل بيانات OHLC اليومية للسوق من المصدر المناسب.

    لكل سوق بيرجع list of dicts:
      {date, ticker, open, high, low, close, volume}
    """
    rows: List[dict] = []

    if market == 'EGX':
        # المصدر الأساسي: intraday.db.stock_intraday (market='مصر')
        if db_exists(INTRADAY_DB):
            conn = open_db(INTRADAY_DB)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT
                            DATE(timestamp) as date,
                            ticker,
                            MAX(high) as high,
                            MIN(low) as low,
                            -- close = آخر سعر في اليوم
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
                          AND DATE(s1.timestamp) >= DATE('now', ?)
                        GROUP BY DATE(timestamp), ticker
                        ORDER BY DATE(timestamp) ASC, ticker
                    """, (f'-{days} days',))
                    for r in cur:
                        rows.append({
                            'date': r['date'],
                            'ticker': r['ticker'],
                            'open': float(r['open'] or 0),
                            'high': float(r['high'] or 0),
                            'low': float(r['low'] or 0),
                            'close': float(r['close'] or 0),
                            'volume': int(r['volume'] or 0),
                        })
                    print(f'  ✅ EGX: loaded {len(rows)} daily rows from intraday.db')
                except Exception as e:
                    print(f'  ⚠️ intraday.db query: {e}')
                conn.close()
            else:
                print(f'  ⚠️ cannot open intraday.db')
        else:
            print(f'  ⚠️ intraday.db not found at {INTRADAY_DB}')

    elif market == 'US':
        # المصدر: price_history.db.price_history
        if db_exists(PRICE_HISTORY_DB):
            conn = open_db(PRICE_HISTORY_DB)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT date, ticker, open_price as open, high_price as high,
                               low_price as low, close_price as close, volume
                        FROM price_history
                        WHERE market = 'US'
                          AND volume IS NOT NULL AND volume > 0
                          AND date >= DATE('now', ?)
                        ORDER BY date ASC, ticker
                    """, (f'-{days} days',))
                    for r in cur:
                        rows.append({
                            'date': r['date'],
                            'ticker': r['ticker'],
                            'open': float(r['open'] or 0),
                            'high': float(r['high'] or 0),
                            'low': float(r['low'] or 0),
                            'close': float(r['close'] or 0),
                            'volume': int(r['volume'] or 0),
                        })
                    print(f'  ✅ US: loaded {len(rows)} daily rows from price_history.db')
                except Exception as e:
                    print(f'  ⚠️ price_history.db query: {e}')
                conn.close()
        else:
            print(f'  ⚠️ price_history.db not found')

    elif market == 'KSA':
        # المصدر: data_engine.db.historical_data (market='السعودية')
        if db_exists(DATA_ENGINE_DB):
            conn = open_db(DATA_ENGINE_DB)
            if conn:
                try:
                    cur = conn.execute("""
                        SELECT date as date, symbol as ticker,
                               open, high, low, close, volume
                        FROM historical_data
                        WHERE market = 'السعودية'
                          AND volume IS NOT NULL AND volume > 0
                          AND date >= DATE('now', ?)
                        ORDER BY date ASC, symbol
                    """, (f'-{days} days',))
                    for r in cur:
                        rows.append({
                            'date': r['date'],
                            'ticker': r['ticker'],
                            'open': float(r['open'] or 0),
                            'high': float(r['high'] or 0),
                            'low': float(r['low'] or 0),
                            'close': float(r['close'] or 0),
                            'volume': int(r['volume'] or 0),
                        })
                    print(f'  ✅ KSA: loaded {len(rows)} daily rows from data_engine.db')
                except Exception as e:
                    print(f'  ⚠️ data_engine.db query: {e}')
                conn.close()
        else:
            print(f'  ⚠️ data_engine.db not found')

    return rows


# ── Backtest logic ────────────────────────────────────────────────────────

def calculate_threshold(volumes: List[int], percentile: float = 0.75) -> Tuple[float, int, bool]:
    """
    احسب الـ dynamic_threshold = percentile_75 من volume.

    لو volumes فاضي → رجع fallback (100000) + fallback=True.
    """
    if not volumes:
        return 100000.0, 0, True

    sorted_vols = sorted(volumes)
    idx = min(len(sorted_vols) - 1, int(len(sorted_vols) * percentile))
    return float(sorted_vols[idx]), len(sorted_vols), False


def run_liquidity_backtest(rows: List[dict], market: str) -> dict:
    """
    شغّل الـ backtest الحقيقي:
    لكل يوم فيه volume >= threshold، هل السعر طلع >= 1.5% في 5 أيام؟

    رجع dict فيه:
      - total_signals
      - successful_signals (return >= 1.5%)
      - failed_signals (return < 1.5%)
      - hit_rate
      - avg_return
      - dynamic_threshold
      - qualified (hit_rate >= 65% AND total_signals >= 30)
      - all_signals (للتفاصيل)
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
            'notes': 'no data available',
        }

    # 1) احسب threshold = p75(volume) آخر 30 يوم
    all_volumes = [r['volume'] for r in rows if r['volume'] > 0]
    threshold, sample_size, fallback = calculate_threshold(all_volumes, 0.75)

    # 2) جمّع البيانات per ticker per date (مرتبة)
    by_ticker_date: dict = defaultdict(list)
    for r in rows:
        by_ticker_date[r['ticker']].append(r)

    # 3) لكل ticker، لكل يوم فيه volume >= threshold، احسب return بعد 5 أيام
    signals: List[dict] = []
    for ticker, ticker_rows in by_ticker_date.items():
        # ترتيب تصاعدي حسب التاريخ
        ticker_rows.sort(key=lambda x: x['date'])

        for i, row in enumerate(ticker_rows):
            # تخطّي لو volume تحت threshold
            if row['volume'] < threshold:
                continue
            # تخطّي لو مفيش 5 أيام بعد كده
            if i + HOLDING_DAYS >= len(ticker_rows):
                continue

            entry_price = row['close']
            exit_row = ticker_rows[i + HOLDING_DAYS]
            exit_price = exit_row['close']

            if entry_price <= 0:
                continue

            return_pct = ((exit_price - entry_price) / entry_price) * 100
            hit = 1 if return_pct >= TARGET_RETURN_PCT else 0

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

    # 4) احسب الإحصائيات
    total_signals = len(signals)
    successful = sum(s['hit'] for s in signals)
    failed = total_signals - successful
    hit_rate = (successful / total_signals * 100) if total_signals > 0 else 0.0
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


# ── Persistence ──────────────────────────────────────────────────────────

def save_results(conn: sqlite3.Connection, result: dict, ticker: Optional[str] = None):
    """احفظ النتائج في liquidity_backtest_results + liquidity_signal_outcomes."""
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

    # احفظ الـ signals الفردية (sample عشوائي 200 max عشان ما تكسرش الـ DB)
    for sig in result['all_signals'][:200]:
        c.execute("""
            INSERT OR REPLACE INTO liquidity_signal_outcomes
            (market, ticker, signal_date, entry_price, exit_price, return_pct,
             hit, holding_days, threshold_used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            sig['market'], sig['ticker'], sig['signal_date'],
            sig['entry_price'], sig['exit_price'], sig['return_pct'],
            sig['hit'], sig['holding_days'], sig['threshold_used'],
        ))

    conn.commit()


def save_threshold(conn: sqlite3.Connection, market: str, threshold: float,
                   sample_size: int, fallback: bool):
    """احفظ threshold اليومي."""
    today = datetime.now().strftime('%Y-%m-%d')
    conn.execute("""
        INSERT OR REPLACE INTO liquidity_dynamic_threshold
        (market, threshold_date, threshold_value, percentile_method, sample_size,
         fallback_used, created_at)
        VALUES (?, ?, ?, 'p75', ?, ?, datetime('now'))
    """, (market, today, threshold, sample_size, 1 if fallback else 0))
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    global TARGET_RETURN_PCT, HOLDING_DAYS

    parser = argparse.ArgumentParser(description='Liquidity Backtest Engine — Phase 1')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    parser.add_argument('--execute', action='store_true', help='حفظ النتائج في DB')
    parser.add_argument('--market', type=str, default=None,
                        help='سوق محدد (EGX/US/KSA/CRYPTO) — افتراضي: كل الأسواق')
    parser.add_argument('--days', type=int, default=90,
                        help='فترة الباك تيست بالأيام (افتراضي: 90)')
    parser.add_argument('--target-return', type=float, default=TARGET_RETURN_PCT,
                        help=f'العائد المستهدف % (افتراضي: {TARGET_RETURN_PCT})')
    parser.add_argument('--holding-days', type=int, default=HOLDING_DAYS,
                        help=f'فترة الاحتفاظ بالأيام (افتراضي: {HOLDING_DAYS})')
    args = parser.parse_args()

    if not args.dry_run and not args.execute:
        args.dry_run = True

    # حدّث الثوابت من CLI args
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
        print(f'    threshold (p75): {result["dynamic_threshold"]:.0f} (sample={result["sample_size"]}, fallback={result["fallback"]})')
        print(f'    total signals: {result["total_signals"]}')
        print(f'    successful (return >= {TARGET_RETURN_PCT}%): {result["successful_signals"]}')
        print(f'    failed: {result["failed_signals"]}')
        print(f'    hit_rate: {result["hit_rate"]:.2f}%')
        print(f'    avg_return: {result["avg_return"]:+.2f}%')
        print(f'    period: {result["backtest_start"]} → {result["backtest_end"]} ({result["backtest_days"]} days)')
        qualified_flag = '✅ QUALIFIED' if result['qualified'] else '❌ NOT YET'
        print(f'    qualification: {qualified_flag} (target: hit_rate >= {TARGET_HIT_RATE}% AND signals >= {MIN_SIGNALS})')

        if result['all_signals']:
            # Top 5 tickers by signal count
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

    # Summary
    print(f'\n{"="*70}')
    print(f'SUMMARY — Qualification for Track B')
    print(f'{"="*70}')
    for r in all_results:
        flag = '✅' if r['qualified'] else '❌'
        print(f'  {flag} {r["market"]}: hit_rate={r["hit_rate"]:.1f}% signals={r["total_signals"]} threshold={r["dynamic_threshold"]:.0f}')

    print(f'\n💡 Next steps:')
    qualified_markets = [r['market'] for r in all_results if r['qualified']]
    if qualified_markets:
        print(f'  - Track B is eligible for: {", ".join(qualified_markets)}')
        print(f'  - Run dual_track_generator.py to start producing liquidity signals')
    else:
        print(f'  - No markets qualified yet. Adjust target_return ({TARGET_RETURN_PCT}%) or extend --days')

    print(f'\n✅ Backtest complete')


if __name__ == '__main__':
    main()
