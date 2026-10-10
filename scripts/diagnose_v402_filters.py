#!/usr/bin/env python3
"""
تشخيص: ليه V40.2 بيرفض ABUK رغم إنه قبل entry_gate؟
شغّل: .venv/bin/python3 scripts/diagnose_v402_filters.py
"""
import sys, os, json
sys.path.insert(0, 'vps-service')
from engines.v38_backtest_engine import V38BacktestEngine, calc_atr
from utils.entry_gate import check_entry_gate
from analyzers.liquidity_filter import set_strict_kill_filters
import sqlite3
from pathlib import Path

# Enable strict kill filters (same as V40.2)
set_strict_kill_filters(True)

engine = V38BacktestEngine()
engine._load_fundamentals()
engine._load_benchmark()

# V68 flags
V68_DIRTY_DIST_REJECT = os.environ.get('V68_DIRTY_DIST_REJECT', '1') == '1'
V72_HIDDEN_DIST_BLOCK = os.environ.get('V72_HIDDEN_DIST_BLOCK', '1') == '1'
V73_DESERT_PHASE_REJECT = os.environ.get('V73_DESERT_PHASE_REJECT', '1') == '1'

conn = sqlite3.connect('db/price_history.db')
cur = conn.cursor()

def parse_volume(val):
    if val is None: return 0.0
    if isinstance(val, (int, float)): return float(val)
    s = str(val).strip().replace('\u202f', '').replace(' ', '')
    if not s: return 0.0
    for suffix, mult in {'K': 1000, 'M': 1_000_000, 'B': 1_000_000_000}.items():
        if s.upper().endswith(suffix):
            try: return float(s[:-1]) * mult
            except: return 0.0
    try: return float(s)
    except: return 0.0

# Test ABUK + a few others
test_tickers = ['ABUK', 'EGAL', 'HELI', 'MFPC', 'MICH']

for ticker in test_tickers:
    cur.execute('''SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? ORDER BY date ASC''', (ticker,))
    rows = cur.fetchall()
    if not rows or len(rows) < 200:
        print(f'{ticker}: NO DATA ({len(rows) if rows else 0} rows)')
        continue
    
    dates = [r[0] for r in rows]
    opens = [float(r[1] or 0) for r in rows]
    highs = [float(r[2] or 0) for r in rows]
    lows = [float(r[3] or 0) for r in rows]
    closes = [float(r[4] or 0) for r in rows]
    volumes = [parse_volume(r[5]) for r in rows]
    
    day_idx = len(closes) - 1
    scan_date = dates[day_idx]
    
    print(f'\n{"="*80}')
    print(f'{ticker}: {len(closes)} rows, last_date={scan_date}, last_close={closes[-1]}')
    
    # 1. Analyze
    result = engine.analyze_single_day_v393(
        ticker, dates, opens, highs, lows, closes, volumes, day_idx, 0.0
    )
    signal = result.get('signal', 'WAIT')
    score = result.get('score', 0)
    entry = result.get('entry', 0)
    target = result.get('target', 0)
    stop = result.get('stop_loss', 0) or result.get('stop', 0)
    proofs = result.get('proofs', {})
    evidence = sum(1 for v in proofs.values() if v and '✅' in str(v))
    
    print(f'  Signal: {signal} | Score: {score}')
    print(f'  Entry: {entry} | Target: {target} | Stop: {stop}')
    
    if signal in ('WAIT', 'HOLD', 'WATCH', 'NEUTRAL'):
        print(f'  → SKIPPED (signal not BUY)')
        continue
    
    # 2. Entry Gate
    gate_data = {
        'entry_price': entry, 'target_price': target, 'stop_price': stop,
        'evidence_count': evidence, 'proofs': proofs,
        'closes': closes[:day_idx+1], 'volumes': volumes[:day_idx+1],
        'market_regime_trend': result.get('market_regime_trend', ''),
        'stock_roc': float(result.get('stock_roc', 0) or 0),
        'benchmark_change': float(result.get('benchmark_change', 0) or 0),
        'signal_type': signal, 'score': score,
    }
    gate_result = check_entry_gate(gate_data)
    if not gate_result['passed']:
        print(f'  ❌ ENTRY GATE REJECTED: {gate_result["reasons_failed"]}')
        continue
    print(f'  ✅ Entry Gate PASSED (8/8)')
    
    # 3. Sector-Liquidity Filter
    try:
        _sec_db = str(Path('vps-service').resolve().parents[0] / 'db' / 'stocks.db')
        _sec_conn = sqlite3.connect(_sec_db, timeout=5.0)
        _sec_conn.row_factory = sqlite3.Row
        _sec_row = _sec_conn.execute("SELECT sector FROM stocks WHERE ticker = ? AND market = 'EGX' LIMIT 1", (ticker,)).fetchone()
        _stock_sector = _sec_row['sector'] if _sec_row and _sec_row['sector'] else None
        if _stock_sector:
            _sec_stats = _sec_conn.execute("""SELECT COUNT(*) as n, AVG(change_percent) as avg_chg,
                SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as rising
                FROM stocks WHERE market = 'EGX' AND sector = ? AND change_percent IS NOT NULL""", (_stock_sector,)).fetchone()
            if _sec_stats and _sec_stats['n'] >= 3:
                _avg_chg = float(_sec_stats['avg_chg'] or 0)
                _rising_pct = int(_sec_stats['rising'] or 0) / _sec_stats['n']
                if _avg_chg <= -1.0 and _rising_pct <= 0.25:
                    print(f'  ❌ SECTOR-DEAD: sector={_stock_sector} avg={_avg_chg:+.2f}% rising={_rising_pct:.0%}')
                    _sec_conn.close()
                    continue
                print(f'  ✅ Sector OK: {_stock_sector} avg={_avg_chg:+.2f}% rising={_rising_pct:.0%}')
        _sec_conn.close()
    except Exception as e:
        print(f'  ⚠️ Sector filter error: {e}')
    
    # 4. BOS/ChoCH Filter
    try:
        from engines.v38_backtest_engine import detect_order_blocks_and_sweeps
        _ob_state = detect_order_blocks_and_sweeps(highs[:day_idx+1], lows[:day_idx+1], closes[:day_idx+1], lookback=5)
        if _ob_state.get('choch_bear'):
            print(f'  ❌ CHOCH-BEAR: ترند هابط')
            continue
        print(f'  ✅ BOS/ChoCH OK')
    except Exception as e:
        print(f'  ⚠️ BOS/ChoCH error: {e}')
    
    # 5. V68 Dirty Distribution
    try:
        from analyzers.v68_oracle_engine import V68OracleEngine
        _v68_engine = V68OracleEngine()
        _v68 = _v68_engine.analyze(closes[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1], volumes[:day_idx+1])
        if V68_DIRTY_DIST_REJECT and _v68.get('dirty_distribution'):
            print(f'  ❌ V68-DIRTY-DIST: الحوت بيفرغ')
            continue
        if _v68.get('no_chase_2d'):
            print(f'  ⚠️ V68-NO-CHASE-2D (not rejected)')
        print(f'  ✅ V68 OK (prob={_v68.get("probability",0):.0f}%)')
    except Exception as e:
        print(f'  ⚠️ V68 error: {e}')
    
    # 6. V72 Hidden Distribution
    try:
        from analyzers.v72_multipath_engine import detect_wash_trade, detect_hidden_distribution
        _v72_highs = highs[:day_idx+1][-20:]
        _v72_lows = lows[:day_idx+1][-20:]
        _v72_vols = volumes[:day_idx+1][-20:]
        _v72_hd = detect_hidden_distribution(_v72_highs, _v72_lows, _v72_vols, len(_v72_highs))
        if V72_HIDDEN_DIST_BLOCK and _v72_hd:
            print(f'  ❌ V72-HIDDEN-DIST: توزيع خفي')
            continue
        print(f'  ✅ V72 OK')
    except Exception as e:
        print(f'  ⚠️ V72 error: {e}')
    
    # 7. V73 Desert Phase
    try:
        from analyzers.v73_desert_phase_engine import detect_desert_phase
        _v73_dp = detect_desert_phase(closes[:day_idx+1], volumes[:day_idx+1])
        if V73_DESERT_PHASE_REJECT and _v73_dp:
            print(f'  ❌ V73-DESERT: الموت السريري')
            continue
        print(f'  ✅ V73 OK')
    except Exception as e:
        print(f'  ⚠️ V73 error: {e}')
    
    # 8. Regime Filter (if enabled)
    _regime_enabled = os.environ.get('V40_2_REGIME_FILTER', '0') == '1'
    if _regime_enabled:
        try:
            from analyzers.regime_filter import is_bullish_regime
            _regime_closes = closes[:day_idx+1]
            _regime = is_bullish_regime(_regime_closes, mode='A')
            if not _regime['is_bullish']:
                print(f'  ❌ REGIME-FILTER: {_regime["reason"]}')
                continue
            print(f'  ✅ Regime OK')
        except Exception as e:
            print(f'  ⚠️ Regime error: {e}')
    else:
        print(f'  ➖ Regime filter OFF (skip)')
    
    # 9. Strict Entry Filter (if enabled)
    _strict_enabled = os.environ.get('V40_2_STRICT_ENTRY', '0') == '1'
    if _strict_enabled:
        try:
            from analyzers.strict_entry_filters import evaluate_strict_entry
            _entry = evaluate_strict_entry(closes[:day_idx+1], highs[:day_idx+1], lows[:day_idx+1], volumes[:day_idx+1])
            if _entry['decision'] == 'REJECT':
                print(f'  ❌ STRICT-ENTRY: {_entry["reason"]}')
                continue
            print(f'  ✅ Strict Entry OK')
        except Exception as e:
            print(f'  ⚠️ Strict Entry error: {e}')
    else:
        print(f'  ➖ Strict Entry OFF (skip)')
    
    # If we got here → signal should be appended!
    print(f'\n  🎯 PASSED ALL FILTERS → signal should be appended to signals_by_date!')
    print(f'     entry={entry}, target={target}, stop={stop}, signal={signal}')

conn.close()
print(f'\n{"="*80}')
print('✓ التشخيص كامل')
