#!/usr/bin/env python3
"""
Phase 1: Fundamentals Activation + Hard Caps Fix
=================================================

What this script does (RESEARCH ONLY — does NOT modify production):
1. Computes REAL fundamental_score for every prediction in DB
2. Identifies which predictions WOULD BE REJECTED by the fundamental veto (score < 30)
3. Identifies which predictions have stop_loss exceeding the -7% hard loss ceiling
4. Reports the impact on KPIs if these fixes were applied

Dataset MD5: 0947bdf6c2eff1a75ff8af6c3e576ed8
"""
import sys, os, sqlite3, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'vps-service'))
os.environ['DATA_ENGINE_DB'] = os.path.join(os.path.dirname(__file__), '..', 'db', 'data_engine.db')

from analyzers.fundamental_data_provider import get_fundamental_score

PREDICTIONS_DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'predictions.db')
HARD_CAP = 50.0
HARD_LOSS_CEILING = 7.0  # engine_settings.hard_loss_ceiling_pct

def compute_return(row):
    """Compute return from hit_target/hit_stop."""
    entry = float(row['entry_price'] or 0)
    if entry <= 0:
        return None
    if row['hit_target'] == 1 and row['target_price']:
        target = float(row['target_price'])
        if target > 0:
            ret = ((target - entry) / entry) * 100
            return max(-HARD_CAP, min(HARD_CAP, ret))
    if row['hit_stop'] == 1 and row['stop_loss']:
        stop = float(row['stop_loss'])
        if stop > 0:
            ret = ((stop - entry) / entry) * 100
            return max(-HARD_CAP, min(HARD_CAP, ret))
    return None

def main():
    print("=" * 70)
    print("PHASE 1: Fundamentals Activation + Hard Caps Impact Analysis")
    print("=" * 70)

    # Connect to predictions.db
    conn = sqlite3.connect(f"file:{PREDICTIONS_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # Get all balanced BUY predictions
    rows = conn.execute("""
        SELECT id, ticker, prediction_date, entry_price, target_price, stop_loss,
               hit_target, hit_stop, status, morning_bell, signal,
               fundamental_score
        FROM predictions
        WHERE (morning_bell = 0 OR morning_bell IS NULL)
          AND entry_price > 0
          AND signal LIKE '%BUY%'
        ORDER BY prediction_date
    """).fetchall()

    print(f"\nBalanced BUY predictions: {len(rows)}")

    # Dedup
    seen = set()
    trades = []
    for row in rows:
        ticker = str(row['ticker'] or '').strip().upper()
        key = f"{ticker}|{row['prediction_date']}|{float(row['entry_price']):.4f}"
        if key in seen:
            continue
        seen.add(key)
        trades.append(row)

    print(f"After dedup: {len(trades)}")

    # Phase 1a: Compute REAL fundamental scores
    print("\n--- Phase 1a: Real Fundamental Scores ---")
    fund_scores = {}
    fund_available = {}
    fund_rejected = []

    for t in trades:
        ticker = str(t['ticker'] or '').strip().upper()
        result = get_fundamental_score(ticker)
        score = result.get('score')
        available = result.get('available', False)

        fund_scores[t['id']] = score
        fund_available[t['id']] = available

        if available and score is not None and score < 30.0:
            fund_rejected.append({
                'id': t['id'],
                'ticker': ticker,
                'date': t['prediction_date'],
                'fund_score': round(score, 1),
                'reason': 'fundamental_score < 30'
            })

    n_scored = sum(1 for v in fund_available.values() if v)
    n_rejected = len(fund_rejected)

    print(f"  Fundamentals available: {n_scored}/{len(trades)} ({round(n_scored/len(trades)*100,1)}%)")
    print(f"  Would be REJECTED (score < 30): {n_rejected}")
    print(f"  Score distribution:")
    scores = [v for v in fund_scores.values() if v is not None]
    if scores:
        print(f"    min={min(scores):.1f} max={max(scores):.1f} avg={sum(scores)/len(scores):.1f}")
        bands = {'0-30': 0, '30-50': 0, '50-70': 0, '70-100': 0}
        for s in scores:
            if s < 30: bands['0-30'] += 1
            elif s < 50: bands['30-50'] += 1
            elif s < 70: bands['50-70'] += 1
            else: bands['70-100'] += 1
        for band, count in bands.items():
            print(f"    {band}: {count} ({round(count/len(scores)*100,1)}%)")

    if fund_rejected:
        print(f"\n  Rejected trades:")
        for r in fund_rejected[:10]:
            print(f"    ID={r['id']} {r['ticker']} {r['date']} score={r['fund_score']}")

    # Phase 1b: Hard Loss Ceiling check
    print("\n--- Phase 1b: Hard Loss Ceiling (-7%) ---")
    ceiling_violations = []
    for t in trades:
        entry = float(t['entry_price'])
        stop = float(t['stop_loss'] or 0)
        if entry > 0 and stop > 0:
            stop_pct = abs((stop - entry) / entry) * 100
            if stop_pct > HARD_LOSS_CEILING:
                ceiling_violations.append({
                    'id': t['id'],
                    'ticker': str(t['ticker']),
                    'date': t['prediction_date'],
                    'entry': entry,
                    'stop': stop,
                    'stop_pct': round(stop_pct, 2),
                    'current_return': compute_return(t),
                })

    print(f"  Trades with stop > {HARD_LOSS_CEILING}%: {len(ceiling_violations)}")
    for v in ceiling_violations[:10]:
        ret = v['current_return']
        print(f"    ID={v['id']} {v['ticker']} {v['date']} stop={v['stop_pct']}% return={ret:.2f}%" if ret else f"    ID={v['id']} {v['ticker']} {v['date']} stop={v['stop_pct']}%")

    # Phase 1c: Impact on KPIs
    print("\n--- Phase 1c: KPI Impact ---")

    # Current KPIs (all trades)
    all_returns = [compute_return(t) for t in trades]
    valid = [r for r in all_returns if r is not None]

    # KPIs after fundamental veto (remove rejected)
    post_fund_returns = []
    for t in trades:
        if t['id'] in [r['id'] for r in fund_rejected]:
            continue
        ret = compute_return(t)
        if ret is not None:
            post_fund_returns.append(ret)

    # KPIs after hard loss ceiling clamp (cap returns at -7%)
    post_clamp_returns = []
    for t in trades:
        ret = compute_return(t)
        if ret is not None:
            # Clamp negative returns at -7%
            if ret < -HARD_LOSS_CEILING:
                ret = -HARD_LOSS_CEILING
            post_clamp_returns.append(ret)

    # KPIs after BOTH (fundamental veto + loss ceiling)
    post_both_returns = []
    for t in trades:
        if t['id'] in [r['id'] for r in fund_rejected]:
            continue
        ret = compute_return(t)
        if ret is not None:
            if ret < -HARD_LOSS_CEILING:
                ret = -HARD_LOSS_CEILING
            post_both_returns.append(ret)

    def kpis(returns):
        n = len(returns)
        if n == 0:
            return {'n': 0, 'wr': 0, 'pf': 0, 'exp': 0}
        wins = [r for r in returns if r > 0]
        losses = [r for r in returns if r < 0]
        gp = sum(wins)
        gl = sum(abs(r) for r in losses)
        return {
            'n': n,
            'wr': round(len(wins) / n * 100, 2),
            'pf': round(gp / gl, 4) if gl > 0 else 0,
            'exp': round(sum(returns) / n, 4),
        }

    k_current = kpis(valid)
    k_fund = kpis(post_fund_returns)
    k_clamp = kpis(post_clamp_returns)
    k_both = kpis(post_both_returns)

    print(f"\n{'Scenario':<40} {'n':>5} {'WR%':>7} {'PF':>7} {'Exp%':>8}")
    print("-" * 70)
    print(f"{'Current (placeholder 50.0)':<40} {k_current['n']:>5} {k_current['wr']:>7} {k_current['pf']:>7} {k_current['exp']:>8}")
    print(f"{'After Fundamental Veto':<40} {k_fund['n']:>5} {k_fund['wr']:>7} {k_fund['pf']:>7} {k_fund['exp']:>8}")
    print(f"{'After Loss Ceiling Clamp':<40} {k_clamp['n']:>5} {k_clamp['wr']:>7} {k_clamp['pf']:>7} {k_clamp['exp']:>8}")
    print(f"{'After BOTH (veto + clamp)':<40} {k_both['n']:>5} {k_both['wr']:>7} {k_both['pf']:>7} {k_both['exp']:>8}")

    print(f"\n--- Impact Summary ---")
    print(f"  Fundamental veto removes: {n_rejected} trades ({round(n_rejected/len(trades)*100,1)}%)")
    print(f"  Loss ceiling clamps: {len(ceiling_violations)} trades ({round(len(ceiling_violations)/len(trades)*100,1)}%)")
    print(f"  PF delta (fundamental): {k_fund['pf'] - k_current['pf']:+.4f}")
    print(f"  PF delta (clamp): {k_clamp['pf'] - k_current['pf']:+.4f}")
    print(f"  PF delta (both): {k_both['pf'] - k_current['pf']:+.4f}")

    # Save report
    report = {
        'fundamental_scores': {str(k): v for k, v in fund_scores.items()},
        'fundamental_available': {str(k): v for k, v in fund_available.items()},
        'fundamental_rejected': fund_rejected,
        'loss_ceiling_violations': ceiling_violations,
        'kpi_impact': {
            'current': k_current,
            'after_fundamental_veto': k_fund,
            'after_loss_ceiling': k_clamp,
            'after_both': k_both,
        }
    }

    output_path = os.path.join(os.path.dirname(__file__), 'phase1_impact_analysis.json')
    with open(output_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nReport saved: {output_path}")

    conn.close()

if __name__ == '__main__':
    main()
