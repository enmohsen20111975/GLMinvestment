#!/usr/bin/env python3
"""
Street Smart Phase A — RS_20 + Falling Knife + Liquidity Filter
==============================================================
Implements 3 street-smart filters as POST-HOC filters on replay trades.
This is RESEARCH ONLY — measures impact without changing production code.

Filters:
1. RS_20 = (stock 20-day return) / (market 20-day return)
   - RS < 1.0 → reject (stock weaker than market)
   - RS >= 1.0 → accept
   
2. Falling Knife: if stock dropped > 10% in last 5 days → reject
   (unless there's a volume spike = potential absorption)

3. Liquidity: if 20-day avg turnover < 500K EGP → reject

Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8
"""
import sqlite3, json, os, sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRICE_HISTORY_DB = str(PROJECT_ROOT / "db" / "price_history.db")
REPLAY_RESULTS = str(PROJECT_ROOT / "vps-service" / "research" / "replay_engine" / "results" / "v40_2_replay_results.json")
HARD_CAP = 50.0
ROUND_TRIP_COSTS = [0.40, 0.80]

def compute_kpis(trades, cost_pct):
    """Compute KPIs after cost."""
    valid = []
    for t in trades:
        r = t.get('return_pct', 0) - cost_pct
        if r != 0:
            valid.append(r)
    
    n = len(valid)
    if n == 0:
        return {'n': 0, 'wr': 0, 'pf': 0, 'exp': 0, 'avg_win': 0, 'avg_loss': 0}
    
    wins = [r for r in valid if r > 0]
    losses = [r for r in valid if r < 0]
    gp = sum(wins)
    gl = sum(abs(r) for r in losses)
    
    return {
        'n': n,
        'wr': round(len(wins) / n * 100, 2),
        'pf': round(gp / gl, 4) if gl > 0 else 0,
        'exp': round(sum(valid) / n, 4),
        'avg_win': round(gp / len(wins), 4) if wins else 0,
        'avg_loss': round(-(gl / len(losses)), 4) if losses else 0,
    }


def get_stock_20d_return(conn, ticker, date):
    """Get 20-day return for a stock."""
    rows = conn.execute("""
        SELECT close_price FROM price_history
        WHERE ticker = ? AND date <= ?
        ORDER BY date DESC LIMIT 21
    """, (ticker, date)).fetchall()
    if len(rows) < 21:
        return None
    last = float(rows[0]['close_price'] or 0)
    past = float(rows[20]['close_price'] or 0)
    if last <= 0 or past <= 0:
        return None
    return (last - past) / past * 100


def get_market_20d_return(conn, date):
    """Get EGX30ETF 20-day return as market proxy."""
    rows = conn.execute("""
        SELECT close_price FROM price_history
        WHERE ticker = 'EGX30ETF' AND date <= ?
        ORDER BY date DESC LIMIT 21
    """, (date,)).fetchall()
    if len(rows) < 21:
        return None
    last = float(rows[0]['close_price'] or 0)
    past = float(rows[20]['close_price'] or 0)
    if last <= 0 or past <= 0:
        return None
    return (last - past) / past * 100


def is_falling_knife(conn, ticker, date):
    """Check if stock dropped > 10% in last 5 days."""
    rows = conn.execute("""
        SELECT close_price FROM price_history
        WHERE ticker = ? AND date <= ?
        ORDER BY date DESC LIMIT 6
    """, (ticker, date)).fetchall()
    if len(rows) < 6:
        return False
    current = float(rows[0]['close_price'] or 0)
    past = float(rows[5]['close_price'] or 0)
    if current <= 0 or past <= 0:
        return False
    change = (current - past) / past * 100
    return change < -10.0


def get_avg_turnover(conn, ticker, date):
    """Get 20-day average turnover."""
    rows = conn.execute("""
        SELECT close_price * volume as turnover FROM price_history
        WHERE ticker = ? AND date <= ?
        ORDER BY date DESC LIMIT 20
    """, (ticker, date)).fetchall()
    if len(rows) < 20:
        return 0
    total = sum(float(r['turnover'] or 0) for r in rows)
    return total / len(rows)


def main():
    print("=" * 70)
    print("STREET SMART PHASE A — RS_20 + Falling Knife + Liquidity")
    print("=" * 70)
    
    # Load replay results
    if not os.path.exists(REPLAY_RESULTS):
        print(f"❌ Replay results not found: {REPLAY_RESULTS}")
        return
    
    with open(REPLAY_RESULTS) as f:
        replay = json.load(f)
    
    trades = replay.get('trades', [])
    print(f"Loaded {len(trades)} trades from replay results")
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    
    # Compute filters for each trade
    rs_values = {}
    fk_rejected = set()
    liq_rejected = set()
    rs_rejected = set()
    
    for t in trades:
        ticker = t.get('ticker', '')
        entry_date = t.get('entry_date', '')
        
        # 1. RS_20
        stock_ret = get_stock_20d_return(conn, ticker, entry_date)
        market_ret = get_market_20d_return(conn, entry_date)
        
        if stock_ret is not None and market_ret is not None and market_ret != 0:
            rs = stock_ret / market_ret
            rs_values[t.get('ticker', '') + '|' + t.get('entry_date', '')] = rs
            if rs < 1.0:
                rs_rejected.add(t.get('ticker', '') + '|' + t.get('entry_date', ''))
        else:
            rs_values[t.get('ticker', '') + '|' + t.get('entry_date', '')] = None
        
        # 2. Falling Knife
        if is_falling_knife(conn, ticker, entry_date):
            fk_rejected.add(t.get('ticker', '') + '|' + t.get('entry_date', ''))
        
        # 3. Liquidity
        avg_to = get_avg_turnover(conn, ticker, entry_date)
        if avg_to < 500_000:
            liq_rejected.add(t.get('ticker', '') + '|' + t.get('entry_date', ''))
    
    conn.close()
    
    # Apply filters progressively
    print(f"\n--- Filter Impact ---")
    print(f"RS < 1.0 (weak vs market): {len(rs_rejected)} trades rejected")
    print(f"Falling Knife (>10% drop in 5d): {len(fk_rejected)} trades rejected")
    print(f"Weak Liquidity (<500K turnover): {len(liq_rejected)} trades rejected")
    
    all_rejected = rs_rejected | fk_rejected | liq_rejected
    print(f"Total rejected (any filter): {len(all_rejected)} trades")
    print(f"Trades remaining: {len(trades) - len(all_rejected)}")
    
    # Compute KPIs for each scenario
    scenarios = {
        'baseline': trades,
        'no_rs<1': [t for t in trades if t.get('ticker', '') + '|' + t.get('entry_date', '') not in rs_rejected],
        'no_falling_knife': [t for t in trades if t.get('ticker', '') + '|' + t.get('entry_date', '') not in fk_rejected],
        'no_weak_liq': [t for t in trades if t.get('ticker', '') + '|' + t.get('entry_date', '') not in liq_rejected],
        'all_filters': [t for t in trades if t.get('ticker', '') + '|' + t.get('entry_date', '') not in all_rejected],
    }
    
    print(f"\n{'='*90}")
    print(f"{'STREET SMART PHASE A — RESULTS (after 0.40% cost)'}")
    print(f"{'='*90}")
    print(f"{'Scenario':<25} {'n':>5} {'WR%':>7} {'PF':>7} {'Exp%':>8} {'avg_win':>8} {'avg_loss':>9}")
    print(f"{'-'*70}")
    
    results = {}
    for name, subset in scenarios.items():
        for cost in ROUND_TRIP_COSTS:
            k = compute_kpis(subset, cost)
            if cost == 0.40:
                results[name] = k
                print(f"{name:<25} {k['n']:>5} {k['wr']:>7} {k['pf']:>7} {k['exp']:>8} {k['avg_win']:>8} {k['avg_loss']:>9}")
    
    # Also show 0.80% for best
    print(f"\n{'='*90}")
    print(f"{'RESULTS at 0.80% cost'}")
    print(f"{'='*90}")
    print(f"{'Scenario':<25} {'n':>5} {'WR%':>7} {'PF':>7} {'Exp%':>8}")
    print(f"{'-'*50}")
    for name, subset in scenarios.items():
        k = compute_kpis(subset, 0.80)
        print(f"{name:<25} {k['n']:>5} {k['wr']:>7} {k['pf']:>7} {k['exp']:>8}")
    
    # Verdict
    baseline_pf = results['baseline']['pf']
    best_name = max(results.items(), key=lambda x: x[1]['pf'])[0]
    best_pf = results[best_name]['pf']
    
    print(f"\n{'='*70}")
    print(f"VERDICT")
    print(f"{'='*70}")
    print(f"Baseline PF@0.4%: {baseline_pf}")
    print(f"Best scenario: {best_name} (PF={best_pf})")
    print(f"Delta: {best_pf - baseline_pf:+.4f}")
    
    if best_pf > baseline_pf:
        print(f"→ ADOPT: {best_name} improves PF by {best_pf - baseline_pf:+.4f}")
    else:
        print(f"→ NO IMPROVEMENT: filters don't help — exit logic is still the bottleneck")
    
    # Save
    report = {
        'task': 'STREET_SMART_PHASE_A',
        'baseline': results['baseline'],
        'filters': {
            'rs_rejected': len(rs_rejected),
            'fk_rejected': len(fk_rejected),
            'liq_rejected': len(liq_rejected),
            'total_rejected': len(all_rejected),
        },
        'scenarios': {k: v for k, v in results.items()},
        'best': best_name,
        'verdict': 'ADOPT' if best_pf > baseline_pf else 'NO_IMPROVEMENT',
    }
    
    output = str(PROJECT_ROOT / "scripts" / "street_smart_phase_a_results.json")
    with open(output, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nSaved: {output}")


if __name__ == '__main__':
    main()
