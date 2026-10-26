#!/usr/bin/env python3
"""
Radar Accuracy Report — تقرير دقة رادار السيولة (Historical Backtest)
=====================================================================
OWNER DIRECTIVE (2026-10-07):
'انت المفروض بتقرأ من البيانات القديمة وتفهم حركة السيولة وتتوقع الى جاي.
 مش العبط إني أجيب المستقبل.'

الـ script ده بيعمل **historical backtest**:
1. بيـ read كل الإشارات القديمة من radar_signal_tracking table
2. لكل إشارة (سواء pending أو verified) بـ يحسب الـ return بعد 7/14/30 يوم
   من **تاريخ الإشارة نفسها** باستخدام price_history
3. لو الـ future data موجود → بيـ compute الـ return
4. لو الـ future data مش موجود → بـ skip (يعني السهم مش عنده أسعار بعد كده)

الـ script مش بيـ wait للمستقبل — بيـ use الـ data التاريخية الموجودة.

Usage:
  python3 scripts/radar_accuracy_report.py
  python3 scripts/radar_accuracy_report.py --days 90
  python3 scripts/radar_accuracy_report.py --write   # update outcomes في الـ DB
"""
import sys
import os
import sqlite3
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Signal Tracker DB: radar_signal_tracking lives in stocks.db
TRACKER_DB_PATHS = [
    PROJECT_ROOT / 'db' / 'stocks.db',
    PROJECT_ROOT / 'db' / 'data_engine.db',
]

# Price history DBs — ordered by priority (try each one)
PRICE_DBS = [
    # 1. data_engine.db.historical_data (widest date range per docs)
    {
        'db_path': PROJECT_ROOT / 'db' / 'data_engine.db',
        'table': 'historical_data',
        'ticker_col': 'symbol',
        'date_col': 'date',
        'close_col': 'close',
    },
    # 2. price_history.db.price_history (canonical EGX prices)
    {
        'db_path': PROJECT_ROOT / 'db' / 'price_history.db',
        'table': 'price_history',
        'ticker_col': 'ticker',
        'date_col': 'date',
        'close_col': 'close_price',
    },
    # 3. stocks.db.stock_daily_prices (frontend live prices)
    {
        'db_path': PROJECT_ROOT / 'db' / 'stocks.db',
        'table': 'stock_daily_prices',
        'ticker_col': 'ticker',
        'date_col': 'price_date',
        'close_col': 'close',
    },
    # 4. data_engine.db.egksco_price_history
    {
        'db_path': PROJECT_ROOT / 'db' / 'data_engine.db',
        'table': 'egksco_price_history',
        'ticker_col': 'symbol',
        'date_col': 'price_date',
        'close_col': 'close_price',
    },
]

# Signal types
SIGNAL_TYPES = {
    'pre_surge':                  ('A', 'Pre-Surge 🚀'),
    'quiet_accumulation_strong':  ('B', 'Quiet Accum Strong 🐋'),
    'quiet_accumulation_weak':    ('C', 'Quiet Accum Weak'),
    'explosive_surge':            ('D', 'Explosive 💥'),
    'early_break':                ('E', 'Early Break ⚡'),
}


def find_tracker_db():
    for db_path in TRACKER_DB_PATHS:
        if not db_path.exists():
            continue
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(db_path), writable=False).__enter__()
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='radar_signal_tracking'")
            if cur.fetchone():
                conn.close()
                return db_path
            conn.close()
        except Exception:
            continue
    return None


def build_price_index():
    """Build a {ticker: {date_str: close_price}} index from ALL price DBs.

    OWNER DIRECTIVE (2026-10-07):
    'انت المفروض بتقرأ من البيانات القديمة' — لازم نـ merge كل مصادر الأسعار
    علشان نـ cover أوسع نطاق تواريخ ممكن.

    الـ bug في الـ version السابق: كان بـ pick أول source يلاقيه (historical_data
    اللي بيوصل لـ 2026-09-24 بس). بس الإشارات تبدأ من 2026-09-30 → مفيش overlap.

    الـ fix: بـ try كل المصادر + بـ merge كل الأسعار في index واحد. لو فيه
    تعارض (نفس ticker+date في مصدرين)، بـ prefer السعر الأحدث.

    Returns: (index, sources_used, date_range)
    """
    index = defaultdict(dict)
    sources_used = []
    for source in PRICE_DBS:
        db_path = source['db_path']
        if not db_path.exists():
            continue
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(db_path), writable=False).__enter__()
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            # Check if table exists + has rows
            cur.execute(f"SELECT COUNT(*) as c FROM {source['table']}")
            count = cur.fetchone()['c']
            if count == 0:
                conn.close()
                continue
            # Load all prices from this source
            # C2 FIX: filter by market='EGX' when the table has a market column,
            # to prevent cross-market contamination (US-tagged rows for EGX tickers).
            cur.execute(f"PRAGMA table_info({source['table']})")
            src_cols = [r[1] for r in cur.fetchall()]
            market_clause = "AND market = 'EGX'" if 'market' in src_cols else ""
            cur.execute(f"SELECT {source['ticker_col']}, {source['date_col']}, {source['close_col']} FROM {source['table']} WHERE {source['close_col']} > 0 {market_clause}")
            added = 0
            for row in cur:
                ticker = str(row[0] or '').upper().strip()
                date_str = str(row[1] or '').strip()
                close = row[2]
                if ticker and date_str and close:
                    # Merge: prefer the most recent price if conflict
                    # (we iterate sources in priority order, so later sources override)
                    index[ticker][date_str] = float(close)
                    added += 1
            conn.close()
            if added > 0:
                sources_used.append({
                    'name': f"{db_path.name}.{source['table']}",
                    'rows': added,
                })
        except Exception as e:
            continue

    if not index:
        return None, [], None

    # Get overall date range
    all_dates = [d for t in index.values() for d in t.keys()]
    return index, sources_used, (min(all_dates), max(all_dates))


def get_future_return(price_index, ticker, signal_date, horizon_days):
    """Get return at +horizon_days trading days after signal_date.

    Returns: (return_pct, entry_price, exit_price, exit_date) or None
    """
    ticker_upper = ticker.upper().strip()
    dates = price_index.get(ticker_upper)
    if not dates:
        return None

    # Find entry price: try exact date, then walk backwards up to 5 days
    entry_price = None
    entry_date = None
    base = datetime.strptime(signal_date, '%Y-%m-%d')
    for offset in range(0, 6):
        d = (base - timedelta(days=offset)).strftime('%Y-%m-%d')
        if d in dates and dates[d] > 0:
            entry_price = dates[d]
            entry_date = d
            break
    if entry_price is None or entry_price <= 0:
        return None

    # Find exit price at +horizon_days trading days after entry_date
    future_date = datetime.strptime(entry_date, '%Y-%m-%d')
    trading_days_count = 0
    for i in range(1, horizon_days * 2 + 15):  # allow weekends/holidays
        future_date = future_date + timedelta(days=1)
        ds = future_date.strftime('%Y-%m-%d')
        if ds in dates:
            trading_days_count += 1
            if trading_days_count >= horizon_days:
                exit_price = dates[ds]
                if exit_price > 0:
                    ret_pct = ((exit_price - entry_price) / entry_price) * 100.0
                    return (ret_pct, entry_price, exit_price, ds)
                break
    return None


def load_signals(db_path, days=90):
    """Load all signals from radar_signal_tracking."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    cur.execute("""
        SELECT id, ticker, signal_date, signal_type, entry_price,
               outcome_7d, outcome_14d, outcome_30d, status
        FROM radar_signal_tracking
        WHERE signal_date >= ?
        ORDER BY signal_date ASC, id ASC
    """, (cutoff,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def compute_stats(returns):
    """Compute WR, avg return, PF from a list of return values."""
    if not returns:
        return {'count': 0, 'wr': 0.0, 'avg': 0.0, 'pf': 0.0}
    wins = [r for r in returns if r > 0]
    losses = [r for r in returns if r < 0]
    wr = (len(wins) / len(returns)) * 100.0
    avg = sum(returns) / len(returns)
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
    return {
        'count': len(returns),
        'wins': len(wins),
        'losses': len(losses),
        'wr': wr,
        'avg': avg,
        'pf': pf,
    }


def main():
    parser = argparse.ArgumentParser(description='Radar Accuracy Report — Historical Backtest')
    parser.add_argument('--days', type=int, default=90, help='Lookback days (default: 90)')
    parser.add_argument('--write', action='store_true', help='Write outcomes back to DB')
    args = parser.parse_args()

    print('=' * 110)
    print('📊 تقرير دقة رادار السيولة — Historical Backtest')
    print(f'   Lookback: {args.days} days | Source: radar_signal_tracking + price_history')
    print('=' * 110)

    # Step 1: Find tracker DB
    db_path = find_tracker_db()
    if not db_path:
        print('\n❌ radar_signal_tracking table not found.')
        return 1
    print(f'\n📁 Tracker DB: {db_path}')

    # Step 2: Load signals
    signals = load_signals(db_path, args.days)
    print(f'\n📡 Total signals in last {args.days} days: {len(signals)}')
    if not signals:
        print('   No signals found. Run a radar warmup first.')
        return 1

    # Group by type
    by_type = defaultdict(list)
    for s in signals:
        by_type[s.get('signal_type', 'unknown')].append(s)
    print(f'\n📡 Signals by type:')
    for st in ['pre_surge', 'quiet_accumulation_strong', 'quiet_accumulation_weak', 'explosive_surge', 'early_break']:
        count = len(by_type.get(st, []))
        if count:
            code, label = SIGNAL_TYPES[st]
            print(f'   {code} ({label}): {count} signals')

    # Step 3: Build price index (merge ALL sources)
    print(f'\n💰 Loading price history (merging ALL sources)...')
    price_index, sources_used, date_range = build_price_index()
    if not price_index:
        print('   ❌ No price history DB found.')
        return 1
    print(f'   Sources merged: {len(sources_used)}')
    for src in sources_used:
        print(f'     • {src["name"]}: {src["rows"]:,} rows')
    print(f'   Overall date range: {date_range[0]} → {date_range[1]}')
    print(f'   Tickers: {len(price_index)}')

    # Step 4: Compute returns for each signal
    print(f'\n🔄 Computing returns at +7d / +14d / +30d for each signal...')
    updated_count = 0
    for s in signals:
        result_7d = get_future_return(price_index, s['ticker'], s['signal_date'], 7)
        result_14d = get_future_return(price_index, s['ticker'], s['signal_date'], 14)
        result_30d = get_future_return(price_index, s['ticker'], s['signal_date'], 30)

        s['_computed_7d'] = result_7d[0] if result_7d else None
        s['_computed_14d'] = result_14d[0] if result_14d else None
        s['_computed_30d'] = result_30d[0] if result_30d else None

        # Optionally write back to DB
        if args.write:
            try:
                # Phase 7.1: migrated to db_manager (writable=True)
                from core.db_manager import db_manager
                conn = db_manager.connection(str(db_path), writable=True).__enter__()
                cur = conn.cursor()
                cur.execute("""
                    UPDATE radar_signal_tracking
                    SET outcome_7d = ?, outcome_14d = ?, outcome_30d = ?,
                        status = CASE
                            WHEN ? IS NOT NULL THEN
                                CASE WHEN ? > 0.5 THEN 'verified_win'
                                     WHEN ? < -0.5 THEN 'verified_loss'
                                     ELSE 'verified_neutral' END
                            ELSE 'pending'
                        END
                    WHERE id = ?
                """, (s['_computed_7d'], s['_computed_14d'], s['_computed_30d'],
                      s['_computed_30d'], s['_computed_30d'], s['_computed_30d'],
                      s['id']))
                conn.commit()
                conn.close()
                updated_count += 1
            except Exception as e:
                pass

    if args.write:
        print(f'   ✅ Updated {updated_count} signals with computed outcomes')

    # Step 5: Compute stats per signal type
    stats_by_type = {}
    for st, sigs in by_type.items():
        returns_7d = [s['_computed_7d'] for s in sigs if s['_computed_7d'] is not None]
        returns_14d = [s['_computed_14d'] for s in sigs if s['_computed_14d'] is not None]
        returns_30d = [s['_computed_30d'] for s in sigs if s['_computed_30d'] is not None]
        stats_by_type[st] = {
            'total': len(sigs),
            '7d': {'verified': len(returns_7d), **compute_stats(returns_7d)},
            '14d': {'verified': len(returns_14d), **compute_stats(returns_14d)},
            '30d': {'verified': len(returns_30d), **compute_stats(returns_30d)},
        }

    # Step 6: Print report table
    print('\n')
    print('=' * 120)
    print('📋 RADAR ACCURACY REPORT — Win Rate by Path & Horizon (Historical Backtest)')
    print('=' * 120)
    print(f'{"Path":<6} {"Label":<26} {"Signals":>8} {"Ver7d":>6} {"WR7d":>7} {"Avg7d":>8} {"PF7d":>7} {"Ver14d":>7} {"WR14d":>7} {"Avg14d":>8} {"PF14d":>7} {"Ver30d":>7} {"WR30d":>7} {"Avg30d":>8} {"PF30d":>7}')
    print('-' * 120)

    for st in ['pre_surge', 'quiet_accumulation_strong', 'quiet_accumulation_weak', 'explosive_surge', 'early_break']:
        if st not in stats_by_type:
            continue
        stats = stats_by_type[st]
        code, label = SIGNAL_TYPES[st]

        def fmt_row(h):
            s = stats[h]
            if s['count'] == 0:
                return f'{"—":>6} {"—":>7} {"—":>8} {"—":>7}'
            pf_str = f'{s["pf"]:.2f}' if s['pf'] != float('inf') else '∞'
            return f'{s["verified"]:>6} {s["wr"]:>6.1f}% {s["avg"]:>+7.2f}% {pf_str:>7}'

        row = f'{code:<6} {label:<26} {stats["total"]:>8} '
        row += fmt_row('7d') + ' '
        row += fmt_row('14d') + ' '
        row += fmt_row('30d')
        print(row)

    print('-' * 120)

    # Step 7: Verdicts
    print('\n')
    print('=' * 120)
    print('🎯 VERDICTS — أي paths موثوقة وأيها عبط؟')
    print('=' * 120)
    for st in ['pre_surge', 'quiet_accumulation_strong', 'quiet_accumulation_weak', 'explosive_surge', 'early_break']:
        if st not in stats_by_type:
            continue
        stats = stats_by_type[st]
        code, label = SIGNAL_TYPES[st]
        s7 = stats['7d']
        s14 = stats['14d']
        s30 = stats['30d']
        # Use the best available horizon for the verdict (prefer 14d, fallback 7d)
        verdict_horizon = '14d' if s14['count'] >= 10 else ('7d' if s7['count'] >= 10 else None)
        if verdict_horizon is None:
            verdict = f'⚠️  بيانات غير كافية (7d: {s7["count"]} | 14d: {s14["count"]} | 30d: {s30["count"]} من {stats["total"]} signal)'
        else:
            s = stats[verdict_horizon]
            if s['wr'] >= 55 and s['pf'] >= 1.5:
                verdict = f'✅ موثوق — WR {s["wr"]:.1f}% / PF {s["pf"]:.2f} ({verdict_horizon})'
            elif s['wr'] >= 50 and s['pf'] >= 1.2:
                verdict = f'🟡 متوسط — WR {s["wr"]:.1f}% / PF {s["pf"]:.2f} ({verdict_horizon})'
            else:
                verdict = f'❌ ضعيف — WR {s["wr"]:.1f}% / PF {s["pf"]:.2f} ({verdict_horizon})'
        print(f'  {code} ({label}):')
        print(f'    {verdict}')
        print(f'    signals: {stats["total"]} | verified 7d: {s7["verified"]} | verified 14d: {s14["verified"]} | verified 30d: {s30["verified"]}')
        print()

    # Step 8: Recommendations
    print('=' * 120)
    print('💡 RECOMMENDATIONS')
    print('=' * 120)
    for st in ['pre_surge', 'quiet_accumulation_strong', 'quiet_accumulation_weak', 'explosive_surge', 'early_break']:
        if st not in stats_by_type:
            continue
        stats = stats_by_type[st]
        code, label = SIGNAL_TYPES[st]
        s7 = stats['7d']
        s14 = stats['14d']
        # Use the best available horizon
        s = s14 if s14['count'] >= 10 else s7
        if s['count'] < 10:
            print(f'  {code}: محتاجين بيانات أكتر (الآن 7d={s7["count"]} | 14d={s14["count"]} من {stats["total"]})')
        elif s['wr'] < 45 or s['pf'] < 1.0:
            print(f'  {code}: ❌ ضعيف — يُوصى بـ إيقافه أو تقليص وزنه')
        elif s['wr'] < 50:
            print(f'  {code}: 🟡 متوسط — راجع شروط التصنيف')
        else:
            print(f'  {code}: ✅ كويس — استمر')
    print('=' * 120)
    return 0


if __name__ == '__main__':
    sys.exit(main())
