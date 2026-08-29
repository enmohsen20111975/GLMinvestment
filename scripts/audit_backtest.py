#!/usr/bin/env python3
"""
GLMinvestment — Audit Backtest (read-only diagnostic)
=======================================================
سكربت فحص شامل لتشخيص كارثة الـ 0 signals في V40.2 backtest.

USAGE (من project root):
  python3 scripts/audit_backtest.py inventory    — فحص قواعد البيانات
  python3 scripts/audit_backtest.py detectors     — فحص الـ detectors على الأسهم الانفجارية
  python3 scripts/audit_backtest.py filters       — فحص كل filter بالترتيب
  python3 scripts/audit_backtest.py engine        — فحص V38 engine على عينة
  python3 scripts/audit_backtest.py all           — شغل كل الأوضاع بالترتيب

السكربت READ-ONLY: ما بـ يـ modifyش أي حاجة في الـ DBs.

Rule 27 (NO-FAKE-DATA): كل الأرقام جاية من الـ DBs الحقيقية على الإنتاج.
Rule 31 (NO-HYPE-LANGUAGE): تقرير فني بصيغة محايدة.
"""
import os
import sys
import sqlite3
import json
from collections import defaultdict
from pathlib import Path

# ─── Path setup (نفس منطق V40.2 generator) ───
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
os.chdir(PROJECT_ROOT)
os.environ['BYPASS_PRED_CAP'] = '1'

DB_DIR = PROJECT_ROOT / 'db'
PRICE_HISTORY_DB = str(DB_DIR / 'price_history.db')
DATA_ENGINE_DB = str(DB_DIR / 'data_engine.db')
STOCKS_DB = str(DB_DIR / 'stocks.db')
PREDICTIONS_DB = str(DB_DIR / 'predictions.db')

EXPLODER_TICKERS = ['BIOC', 'NIPH', 'AMES', 'GPIM', 'AFMC', 'GTWL', 'CRST']
SAMPLE_TICKERS = [
    'COMI', 'HRHO', 'IRON', 'CICH', 'ADIB', 'OCDI', 'PHDC', 'CNFN', 'ARVA', 'EBSC',
    'FERC', 'EAST', 'ABUK', 'MENA', 'ARZAN', 'AMER', 'PRCL', 'ISMQ', 'CLHO', 'ROTO',
]
SAMPLE_DATES = [
    '2026-01-12', '2026-02-15', '2026-03-24', '2026-05-18', '2026-07-15',
]


def section(title):
    print()
    print('=' * 70)
    print(f'  {title}')
    print('=' * 70)


def _connect(db_path):
    """Connect read-only with safe fallback."""
    try:
        if not os.path.exists(db_path):
            return None
        return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10.0)
    except Exception:
        return None


def _table_exists(conn, table):
    try:
        r = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()
        return r[0] > 0
    except Exception:
        return False


# ─── Mode 1: DB Inventory ──────────────────────────────────────────────────
def mode_inventory():
    """فحص شامل لكل الـ DBs — نتأكد إن الأسهم موجودة وفيها بيانات كافية."""
    section('AUDIT 1: DB INVENTORY')
    dbs = [
        ('price_history.db', PRICE_HISTORY_DB, 'price_history'),
        ('data_engine.db',  DATA_ENGINE_DB,  'egksco_price_history'),
        ('stocks.db',       STOCKS_DB,        'stock_daily_prices'),
    ]
    exploder_findings = {}

    for label, path, table in dbs:
        print(f'\n📁 {label}  →  {path}')
        if not os.path.exists(path):
            print('   ❌ NOT FOUND')
            continue
        size_mb = os.path.getsize(path) / (1024 * 1024)
        print(f'   Size: {size_mb:.1f} MB')
        conn = _connect(path)
        if conn is None:
            print('   ❌ Cannot open (read-only)')
            continue
        if not _table_exists(conn, table):
            print(f'   ⚠️  Table "{table}" not found')
            # list available tables
            tabs = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()]
            print(f'   Available tables: {tabs[:10]}{"..." if len(tabs) > 10 else ""}')
            conn.close()
            continue
        try:
            total = conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
            print(f'   Total rows: {total:,}')
        except Exception as e:
            print(f'   ❌ COUNT failed: {e}')
            conn.close()
            continue
        # find date column
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
        date_col = next((c for c in cols if c in ('date', 'price_date', 'trade_date')), None)
        ticker_col = next((c for c in cols if c in ('ticker', 'symbol')), None)
        if date_col and ticker_col:
            try:
                dr = conn.execute(
                    f'SELECT MIN({date_col}), MAX({date_col}) FROM {table}'
                ).fetchone()
                ntickers = conn.execute(
                    f'SELECT COUNT(DISTINCT {ticker_col}) FROM {table}'
                ).fetchone()[0]
                print(f'   Date range:  {dr[0]} → {dr[1]}')
                print(f'   Tickers:     {ntickers:,}')
                # Exploder tickers in this DB
                print(f'   Exploder tickers:')
                for t in EXPLODER_TICKERS:
                    r = conn.execute(
                        f'SELECT COUNT(*), MIN({date_col}), MAX({date_col}) '
                        f'FROM {table} WHERE {ticker_col} = ?',
                        (t,)
                    ).fetchone()
                    exploder_findings.setdefault(label, {})[t] = {
                        'rows': r[0], 'first': r[1], 'last': r[2]
                    }
                    status = '✓' if r[0] >= 100 else ('✗ (low)' if r[0] > 0 else '✗ (missing)')
                    print(f'      {t:6s}: {r[0]:6d} rows  {r[1] or "—":12s} → {r[2] or "—":12s}  {status}')
            except Exception as e:
                print(f'   ❌ Date/ticker query failed: {e}')
        conn.close()

    # Cross-DB comparison
    section('CROSS-DB COMPARISON: Exploder tickers')
    print(f'\n{"Ticker":8s}  ' + '  '.join(f'{l:24s}' for l, _, _ in dbs))
    for t in EXPLODER_TICKERS:
        row = [f'{t:8s}']
        for label, _, _ in dbs:
            info = exploder_findings.get(label, {}).get(t)
            if info is None:
                row.append(f'{"—":24s}')
            else:
                row.append(f'{info["rows"]:6d} ({info["first"] or "—"}..{info["last"] or "—"})')
        print('  '.join(row))

    # Predictions DB summary
    section('PREDICTIONS.DB SUMMARY')
    if not os.path.exists(PREDICTIONS_DB):
        print('❌ predictions.db NOT FOUND')
        return
    conn = _connect(PREDICTIONS_DB)
    if conn is None:
        print('❌ Cannot open predictions.db')
        return
    try:
        total = conn.execute('SELECT COUNT(*) FROM predictions').fetchone()[0]
        print(f'Total predictions: {total:,}')
        # closed predictions with actual_return
        closed = conn.execute(
            'SELECT COUNT(*) FROM predictions WHERE actual_return IS NOT NULL'
        ).fetchone()[0]
        print(f'Closed (with actual_return): {closed:,}')
        if closed > 0:
            r = conn.execute('''
                SELECT
                    SUM(CASE WHEN actual_return > 0 AND ABS(actual_return) <= 50 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN actual_return < 0 AND ABS(actual_return) <= 50 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN ABS(actual_return) <= 50 THEN actual_return ELSE 0 END)
                FROM predictions WHERE actual_return IS NOT NULL
            ''').fetchone()
            w, l, net = r
            wr = (w / (w + l) * 100) if (w + l) > 0 else 0
            print(f'Wins: {w}, Losses: {l}, WR: {wr:.1f}%, Net: {net:.1f}%')
        # Last 5 predictions
        print('\nLast 5 predictions (by id):')
        rows = conn.execute(
            'SELECT id, ticker, prediction_date, signal, actual_return '
            'FROM predictions ORDER BY id DESC LIMIT 5'
        ).fetchall()
        for r in rows:
            ar = f'{r[4]:.1f}%' if r[4] is not None else 'pending'
            print(f'  #{r[0]:6d} {r[1]:6s} {r[2]} {r[3]:14s} → {ar}')
    except Exception as e:
        print(f'❌ predictions.db query failed: {e}')
    conn.close()


# ─── Mode 2: Detectors on Exploder tickers ─────────────────────────────────
def mode_detectors():
    """تشغيل الـ 3 detectors على كل تاريخ لكل سهم انفجاري.
    الهدف: نعرف هل الـ detectors بـ يـ detect ولا لأ، وفي أي تاريخ."""
    section('AUDIT 2: DETECTOR AUDIT ON EXPLODER TICKERS')
    try:
        from analyzers.core_scoring_engine import (
            detect_volume_surge_rocket,
            detect_accumulation_phase,
            detect_recovery_from_base,
        )
    except Exception as e:
        print(f'❌ Cannot import detectors: {e}')
        return

    # Try data_engine.db first, then price_history.db (نفس منطق V40.2)
    db_attempts = [
        ('data_engine.db', DATA_ENGINE_DB, 'egksco_price_history',
         'symbol', 'price_date', 'open_price', 'high_price', 'low_price', 'close_price', 'volume'),
        ('price_history.db', PRICE_HISTORY_DB, 'price_history',
         'ticker', 'date', 'open', 'high', 'low', 'close', 'volume'),
    ]

    db_used = None
    conn = None
    for label, path, table, tc, dc, oc, hc, lc, cc, vc in db_attempts:
        if not os.path.exists(path):
            continue
        c = _connect(path)
        if c is None or not _table_exists(c, table):
            if c: c.close()
            continue
        # Verify columns exist
        cols = [r[1] for r in c.execute(f'PRAGMA table_info({table})').fetchall()]
        if tc in cols and dc in cols and cc in cols:
            conn = c
            db_used = label
            db_info = (table, tc, dc, oc, hc, lc, cc, vc)
            print(f'📊 Using: {label} (table={table})')
            break
        c.close()

    if conn is None:
        print('❌ No usable price DB found')
        return

    table, tc, dc, oc, hc, lc, cc, vc = db_info

    for ticker in EXPLODER_TICKERS:
        try:
            rows = conn.execute(
                f'SELECT {dc}, {oc}, {hc}, {lc}, {cc}, {vc} '
                f'FROM {table} WHERE {tc} = ? ORDER BY {dc} ASC',
                (ticker,)
            ).fetchall()
        except Exception as e:
            print(f'\n❌ {ticker}: query failed: {e}')
            continue

        if not rows:
            print(f'\n❌ {ticker}: لا توجد بيانات في {db_used}')
            continue

        dates = [r[0] for r in rows]
        opens = [float(r[1] or 0) for r in rows]
        highs = [float(r[2] or 0) for r in rows]
        lows = [float(r[3] or 0) for r in rows]
        closes = [float(r[4] or 0) for r in rows]
        # volume may be text ("105K") or numeric
        from engines.v38_backtest_engine import parse_volume
        volumes = [parse_volume(r[5]) for r in rows]

        print(f'\n📈 {ticker}: {len(rows)} rows, {dates[0]} → {dates[-1]}')

        surge_hits = []
        accum_hits = []
        recovery_hits = []
        all_fail = 0
        total = 0

        for day_idx in range(60, len(rows)):
            total += 1
            try:
                surge = detect_volume_surge_rocket(
                    closes[:day_idx + 1], highs[:day_idx + 1], lows[:day_idx + 1],
                    opens[:day_idx + 1], volumes[:day_idx + 1]
                )
                if surge.get('is_surge_rocket'):
                    surge_hits.append((dates[day_idx], surge.get('score', 0)))
                    continue
                accum = detect_accumulation_phase(
                    closes[:day_idx + 1], highs[:day_idx + 1], lows[:day_idx + 1],
                    opens[:day_idx + 1], volumes[:day_idx + 1],
                    benchmark_roc14=0.0
                )
                if accum.get('is_accumulation'):
                    accum_hits.append((dates[day_idx], accum.get('score', 0)))
                    continue
                recovery = detect_recovery_from_base(
                    closes[:day_idx + 1], highs[:day_idx + 1], lows[:day_idx + 1],
                    opens[:day_idx + 1], volumes[:day_idx + 1]
                )
                if recovery and recovery.get('is_recovery_signal'):
                    recovery_hits.append((dates[day_idx], recovery.get('score', 0)))
                    continue
                all_fail += 1
            except Exception:
                all_fail += 1

        pct_surge = (len(surge_hits) / total * 100) if total > 0 else 0
        pct_accum = (len(accum_hits) / total * 100) if total > 0 else 0
        pct_recov = (len(recovery_hits) / total * 100) if total > 0 else 0
        pct_fail = (all_fail / total * 100) if total > 0 else 0

        print(f'   Surge:      {len(surge_hits):4d} / {total}  ({pct_surge:5.1f}%)')
        print(f'   Accum:      {len(accum_hits):4d} / {total}  ({pct_accum:5.1f}%)')
        print(f'   Recovery:   {len(recovery_hits):4d} / {total}  ({pct_recov:5.1f}%)')
        print(f'   All failed: {all_fail:4d} / {total}  ({pct_fail:5.1f}%)')

        # Show first 3 hits of each detector (with score + date)
        if surge_hits:
            print(f'   🎯 First 3 surge hits:')
            for d, s in surge_hits[:3]:
                print(f'      {d}  score={s:.1f}')
        if accum_hits:
            print(f'   🎯 First 3 accum hits:')
            for d, s in accum_hits[:3]:
                print(f'      {d}  score={s:.1f}')
        if recovery_hits:
            print(f'   🎯 First 3 recovery hits:')
            for d, s in recovery_hits[:3]:
                print(f'      {d}  score={s:.1f}')

    conn.close()


# ─── Mode 3: Filter-by-filter audit ────────────────────────────────────────
def mode_filters():
    """على عينة 20 tickers × 5 scan dates، نطبق الفلاتر بالترتيب.
    الهدف: نعرف فين بالظبط الـ bottleneck اللي بـ يـ reject الـ 49K iteration."""
    section('AUDIT 3: FILTER-BY-FILTER AUDIT (20 tickers × 5 dates = 100 iter)')
    try:
        from engines.v38_backtest_engine import V38BacktestEngine, calc_atr
        from analyzers.core_scoring_engine import (
            detect_volume_surge_rocket,
            detect_accumulation_phase,
            detect_recovery_from_base,
        )
        from analyzers.liquidity_filter import set_strict_kill_filters
        from analyzers.engine_settings import get_dynamic_min_rr
    except Exception as e:
        print(f'❌ Cannot import engines: {e}')
        return

    set_strict_kill_filters(True)
    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)
    try:
        engine._load_fundamentals()
        engine._load_benchmark()
    except Exception:
        pass

    # Use the engine's own price data loader (matches production exactly)
    filter_stats = defaultdict(int)
    survive_counts = defaultdict(int)
    detector_paths = defaultdict(int)
    total = 0

    for ticker in SAMPLE_TICKERS:
        try:
            dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        except Exception as e:
            print(f'❌ {ticker}: get_price_data failed: {e}')
            continue
        if len(closes) < 60:
            print(f'⚠️  {ticker}: only {len(closes)} rows — skipping')
            continue

        date_to_idx = {d: i for i, d in enumerate(dates)}

        for scan_date in SAMPLE_DATES:
            total += 1
            day_idx = date_to_idx.get(scan_date)
            if day_idx is None:
                filter_stats['date_not_found'] += 1
                continue
            if day_idx < 60:
                filter_stats['insufficient_history'] += 1
                continue

            _sector_change = 0.0
            if day_idx >= 5:
                try:
                    _ref_close = closes[day_idx - 5] if closes[day_idx - 5] > 0 else closes[day_idx - 1]
                    if _ref_close > 0:
                        _sector_change = round(
                            (closes[day_idx] - _ref_close) / _ref_close * 100.0, 3
                        )
                except Exception:
                    pass

            # Filter 1: V38 engine
            try:
                result = engine.analyze_single_day_v393(
                    ticker, dates, opens, highs, lows, closes, volumes, day_idx, _sector_change,
                )
            except Exception:
                filter_stats['v38_exception'] += 1
                continue
            signal = result.get('signal', 'WAIT')

            _is_surge = False
            _is_accum = False
            _is_recovery = False

            if signal not in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                # Fallback chain (نفس منطق V40.2)
                try:
                    surge = detect_volume_surge_rocket(
                        closes[:day_idx + 1], highs[:day_idx + 1], lows[:day_idx + 1],
                        opens[:day_idx + 1], volumes[:day_idx + 1]
                    )
                except Exception:
                    surge = {'is_surge_rocket': False}
                if surge.get('is_surge_rocket'):
                    _is_surge = True
                    result['entry'] = surge['entry']
                    result['target'] = surge['target']
                    result['stop_loss'] = surge['stop']
                    result['score'] = surge['score']
                    result['signal'] = 'STRONG_BUY'
                    result['proofs'] = {'surge_hunter': True}
                    detector_paths['surge'] += 1
                else:
                    try:
                        _bench_roc = engine._benchmark_roc_by_date.get(scan_date, 0.0)
                        accum = detect_accumulation_phase(
                            closes[:day_idx + 1], highs[:day_idx + 1], lows[:day_idx + 1],
                            opens[:day_idx + 1], volumes[:day_idx + 1],
                            benchmark_roc14=_bench_roc,
                        )
                    except Exception:
                        accum = {'is_accumulation': False}
                    if accum.get('is_accumulation'):
                        _is_accum = True
                        result['entry'] = accum['entry']
                        result['target'] = accum['target']
                        result['stop_loss'] = accum['stop']
                        result['score'] = accum['score']
                        result['signal'] = 'STRONG_BUY'
                        result['proofs'] = {'accumulation_hunter': True}
                        detector_paths['accum'] += 1
                    else:
                        try:
                            recovery = detect_recovery_from_base(
                                closes[:day_idx + 1], highs[:day_idx + 1], lows[:day_idx + 1],
                                opens[:day_idx + 1], volumes[:day_idx + 1]
                            )
                        except Exception:
                            recovery = None
                        if recovery and recovery.get('is_recovery_signal'):
                            _is_recovery = True
                            result['entry'] = recovery['entry']
                            result['target'] = recovery['target']
                            result['stop_loss'] = recovery['stop']
                            result['score'] = recovery['score']
                            result['signal'] = 'STRONG_BUY'
                            result['proofs'] = {'recovery_hunter': True}
                            detector_paths['recovery'] += 1
                        else:
                            filter_stats['all_detectors_failed'] += 1
                            continue
            else:
                survive_counts['v38_signal'] += 1
                detector_paths['v38'] += 1

            # Filter 2: stop/entry validation
            entry = result.get('entry', 0)
            stop = result.get('stop_loss', 0)
            if stop >= entry or entry <= 0:
                filter_stats['invalid_entry_stop'] += 1
                continue

            # Filter 3: zero volume
            try:
                _today_vol = volumes[day_idx] if day_idx < len(volumes) else 0
                _yest_vol = volumes[day_idx - 1] if day_idx >= 1 else 0
                if _today_vol < 1000 or _yest_vol < 1000:
                    filter_stats['zero_volume'] += 1
                    continue
            except Exception:
                pass

            # Filter 4: Don't Chase
            try:
                _pc1 = closes[day_idx - 1] if day_idx >= 1 else entry
                _pc3 = closes[day_idx - 3] if day_idx >= 3 else entry
                _pc5 = closes[day_idx - 5] if day_idx >= 5 else entry
                _dg = ((entry - _pc1) / _pc1 * 100) if _pc1 > 0 else 0
                _r3 = ((entry - _pc3) / _pc3 * 100) if _pc3 > 0 else 0
                _r5 = ((entry - _pc5) / _pc5 * 100) if _pc5 > 0 else 0
                if _dg > 12.0:
                    filter_stats['chase_daily_gain'] += 1
                    continue
                elif _r3 > 18.0:
                    filter_stats['chase_roc3'] += 1
                    continue
                elif _r5 > 28.0:
                    filter_stats['chase_roc5'] += 1
                    continue
            except Exception:
                pass

            # Filter 5: Correction
            if not _is_surge and not _is_accum and not _is_recovery and day_idx >= 5:
                try:
                    _recent_high = max(highs[max(0, day_idx - 5):day_idx + 1])
                    _dd = ((_recent_high - entry) / _recent_high * 100) if _recent_high > 0 else 0
                    if _dd >= 5.0:
                        filter_stats['correction'] += 1
                        continue
                except Exception:
                    pass

            # Filter 6: future data
            future_closes = closes[day_idx + 1:]
            if len(future_closes) < 5:
                filter_stats['insufficient_future'] += 1
                continue

            # Filter 7: fundamentals-veto
            _fund_score = float(result.get('fundamental_score', 0.0) or 0.0)
            _fund_avail = bool(result.get('fundamentals_available', False))
            _persona = 'balanced'  # simplified
            if _persona != 'gambler' and _fund_avail and _fund_score < 30.0:
                filter_stats['fundamentals_veto'] += 1
                continue

            # Filter 8: R:R
            target = result.get('target', entry * 1.2)
            try:
                _regime = result.get('market_regime_trend', 'range')
                _min_rr = get_dynamic_min_rr(_regime)
            except Exception:
                _min_rr = 2.0
            r_mult = (target - entry) / (entry - stop) if (entry - stop) > 0 else 0
            if r_mult < _min_rr:
                filter_stats['low_rr'] += 1
                continue

            survive_counts['final_survivor'] += 1

    print(f'\n📊 Total iterations: {total}')

    print('\n🔴 Filter rejections (where they die):')
    if not filter_stats:
        print('  (none)')
    for k, v in sorted(filter_stats.items(), key=lambda x: -x[1]):
        pct = (v / total * 100) if total > 0 else 0
        bar = '█' * int(pct / 2)
        print(f'  {k:30s}: {v:5d} ({pct:5.1f}%) {bar}')

    print('\n🟢 Survivors (where they pass):')
    if not survive_counts:
        print('  (none)')
    for k, v in sorted(survive_counts.items(), key=lambda x: -x[1]):
        pct = (v / total * 100) if total > 0 else 0
        print(f'  {k:30s}: {v:5d} ({pct:5.1f}%)')

    print('\n🎯 Detector path distribution (which detector caught the signal):')
    if not detector_paths:
        print('  (none — no signals)')
    for k, v in sorted(detector_paths.items(), key=lambda x: -x[1]):
        print(f'  {k:30s}: {v:5d}')

    print(f'\n🎯 Final survivors (signals): {survive_counts.get("final_survivor", 0)}')
    if total > 0:
        expected_per_49k = survive_counts.get('final_survivor', 0) / total * 49000
        print(f'   Extrapolated to 49K iter: ~{expected_per_49k:.0f} signals')
        print(f'   (production gave 0 — gap = {expected_per_49k:.0f})')


# ─── Mode 4: V38 engine audit ───────────────────────────────────────────────
def mode_engine():
    """فحص V38 engine على عينة من tickers (exploders + sample).
    الهدف: نعرف الـ signal distribution اللي الـ engine بـ يطلعه."""
    section('AUDIT 4: V38 ENGINE AUDIT (exploders + sample tickers)')
    try:
        from engines.v38_backtest_engine import V38BacktestEngine
        from analyzers.liquidity_filter import set_strict_kill_filters
    except Exception as e:
        print(f'❌ Cannot import engine: {e}')
        return

    set_strict_kill_filters(True)
    engine = V38BacktestEngine(buy_threshold=75, use_v393=True)
    try:
        engine._load_fundamentals()
        engine._load_benchmark()
    except Exception:
        pass

    signal_dist = defaultdict(int)
    score_by_ticker = defaultdict(list)
    total = 0

    test_tickers = EXPLODER_TICKERS + SAMPLE_TICKERS[:6]

    for ticker in test_tickers:
        try:
            dates, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        except Exception as e:
            print(f'❌ {ticker}: get_price_data failed: {e}')
            continue
        if len(closes) < 60:
            print(f'⚠️  {ticker}: only {len(closes)} rows')
            continue

        print(f'\n📈 {ticker}: {len(closes)} rows, {dates[0]} → {dates[-1]}')
        ticker_signals = defaultdict(int)

        for scan_date in SAMPLE_DATES:
            if scan_date not in dates:
                continue
            day_idx = dates.index(scan_date)
            if day_idx < 60:
                continue
            total += 1
            _sector_change = 0.0
            if day_idx >= 5:
                try:
                    _ref = closes[day_idx - 5] if closes[day_idx - 5] > 0 else closes[day_idx - 1]
                    if _ref > 0:
                        _sector_change = round(
                            (closes[day_idx] - _ref) / _ref * 100.0, 3
                        )
                except Exception:
                    pass
            try:
                result = engine.analyze_single_day_v393(
                    ticker, dates, opens, highs, lows, closes, volumes, day_idx, _sector_change,
                )
                signal = result.get('signal', 'WAIT')
                score = result.get('score', 0)
                signal_dist[signal] += 1
                ticker_signals[signal] += 1
                score_by_ticker[ticker].append(score)
            except Exception as e:
                signal_dist['exception'] += 1
                ticker_signals['exception'] += 1

        for sig, cnt in sorted(ticker_signals.items(), key=lambda x: -x[1]):
            print(f'   {sig:20s}: {cnt}')

    print(f'\n📊 Total iterations: {total}')
    print('\n📊 Signal distribution (V38 engine):')
    for sig, cnt in sorted(signal_dist.items(), key=lambda x: -x[1]):
        pct = (cnt / total * 100) if total > 0 else 0
        bar = '█' * int(pct / 2)
        print(f'  {sig:20s}: {cnt:5d} ({pct:5.1f}%) {bar}')

    print('\n📊 Score stats by ticker:')
    for ticker, scores in score_by_ticker.items():
        if scores:
            avg = sum(scores) / len(scores)
            mn = min(scores)
            mx = max(scores)
            print(f'  {ticker:8s}: avg={avg:5.1f}  min={mn:5.1f}  max={mx:5.1f}  n={len(scores)}')


# ─── Main ──────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    mode = sys.argv[1].lower()
    if mode == 'all':
        mode_inventory()
        mode_detectors()
        mode_filters()
        mode_engine()
    elif mode == 'inventory':
        mode_inventory()
    elif mode == 'detectors':
        mode_detectors()
    elif mode == 'filters':
        mode_filters()
    elif mode == 'engine':
        mode_engine()
    else:
        print(f'Unknown mode: {mode}')
        print(__doc__)
        sys.exit(1)

    print()
    print('=' * 70)
    print('  AUDIT COMPLETE — all results are READ-ONLY (no DB writes)')
    print('=' * 70)


if __name__ == '__main__':
    main()
