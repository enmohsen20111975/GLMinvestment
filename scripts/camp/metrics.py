"""Metrics calculator."""
import math
from .config import POSITION_SIZE, HOLDING_DAYS

def calc_metrics(trades):
    n = len(trades)
    if n == 0:
        return {'signals': 0, 'wr': 0, 'pf': 0, 'max_dd': 0, 'avg_ret': 0, 'sharpe': 0, 'expectancy': 0}
    
    wins = [t for t in trades if t['outcome'] == 'TARGET_HIT']
    losses = [t for t in trades if t['outcome'] == 'STOPPED']
    
    gp = sum(t['return_pct'] for t in trades if t['return_pct'] > 0)
    gl = abs(sum(t['return_pct'] for t in trades if t['return_pct'] < 0))
    pf = gp / gl if gl > 0 else 0
    
    wr = len(wins) / n * 100
    avg_ret = sum(t['return_pct'] for t in trades) / n
    
    # Max DD with position sizing
    equity = 100000
    peak = equity
    max_dd = 0
    for t in trades:
        equity += equity * POSITION_SIZE * (t['return_pct'] / 100)
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)
    
    # Sharpe
    rets = [t['return_pct'] for t in trades]
    std = math.sqrt(sum((r-avg_ret)**2 for r in rets)/(n-1)) if n > 1 else 0
    sharpe = (avg_ret / std * math.sqrt(n)) if std > 0 else 0
    
    return {
        'signals': n,
        'wins': len(wins), 'losses': len(losses),
        'wr': round(wr, 1), 'pf': round(pf, 2),
        'avg_ret': round(avg_ret, 2),
        'max_dd': round(max_dd, 1),
        'sharpe': round(sharpe, 2),
        'expectancy': round(avg_ret * POSITION_SIZE, 2),
        'gp': round(gp, 1), 'gl': round(gl, 1),
    }
