#!/usr/bin/env python3
"""
V38 Orchestrator v2 — Blocks Architecture.

Clean-slate orchestrator. NO V38. NO old 8 features.
8 new EGX-specific blocks, auto-discovered from blocks/ folder.
Config-driven (features.yaml, weights.yaml, regimes.yaml).

Includes compute_egx30_historical() — official EGX30 computed from
price_history.db + canonical_indices.json (NOT snapshot).

Rule 4: this file + blocks/*.py + momentum_strategy.py only.
"""
from __future__ import annotations
import sys, os, json, sqlite3, math
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    yaml = None  # will fall back to JSON

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VPS = PROJECT_ROOT / 'vps-service'
CAMP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))

DB_DIR = PROJECT_ROOT / 'db'
CANONICAL_INDICES = VPS / 'data' / 'canonical_indices.json'
# Use complete_markets_indices_and_weights.json — same source as
# scripts/apply_master_stock_cleansing_and_indices.py (the production script).
WEIGHTS_FILE = PROJECT_ROOT / 'data' / 'complete_markets_indices_and_weights.json'

COMPOSITE_THRESHOLD = 0.6


# ─── EGX30 Historical Computation (v2 — using apply_master logic) ────────────

def _load_constituents(index_name: str = 'EGX30') -> List[Dict]:
    """Load constituents + weights from complete_markets_indices_and_weights.json
    (same source as apply_master_stock_cleansing_and_indices.py — the production
    script that feeds market_indices table shown in #market-status)."""
    with open(WEIGHTS_FILE) as f:
        meta = json.load(f)
    idx = meta['markets']['EGX']['indices'][index_name]
    return idx['constituents']


def compute_egx30_historical(start_date: str, end_date: str,
                              base_value: float = 53776.69,
                              base_date: str = None) -> Dict[str, float]:
    """
    Compute EGX30 index daily from price_history.db + complete_markets_indices_and_weights.json.

    Uses the SAME logic as scripts/apply_master_stock_cleansing_and_indices.py:
      For each trading day D:
        weighted_change% = Σ(weight_i × change_i%) / Σ(weight_i)
        where change_i% = (close_i[D] - close_i[D-1]) / close_i[D-1] × 100
      Then chain: index_D = index_D-1 × (1 + weighted_change% / 100)

    Reads prices DIRECTLY from price_history.db (per Rule: database is the canonical source).

    Args:
        start_date, end_date: 'YYYY-MM-DD' format
        base_value: starting index value (default = 53776.69 = real EGX30 snapshot 2026-10-10)
        base_date: date to anchor base_value (if None, uses end_date)

    Returns:
        Dict[str, float]: {date: egx30_value}
    """
    constituents = _load_constituents('EGX30')
    # From apply_master: TICKER_ALIASES = {'AUTO': 'GBCO'}
    ALIASES = {'AUTO': 'GBCO'}
    # Total weight (for normalization — same as apply_master line 159)
    total_weight = sum(s['weight_percentage'] for s in constituents)

    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)

    # Get all trading dates in range
    dates = [r[0] for r in conn.execute("""
        SELECT DISTINCT date FROM price_history
        WHERE date >= ? AND date <= ?
        AND ticker NOT LIKE '%.%' AND close_price > 0
        ORDER BY date
    """, (start_date, end_date)).fetchall()]

    if not dates:
        conn.close()
        return {}

    # Pre-load close prices for all constituents (one query per ticker)
    prices = {}
    for c in constituents:
        code = ALIASES.get(c['code'], c['code'])
        rows = conn.execute("""
            SELECT date, close_price FROM price_history
            WHERE ticker=? AND date>=? AND date<=? AND close_price>0
            ORDER BY date
        """, (code, start_date, end_date)).fetchall()
        if rows:
            prices[code] = {r[0]: float(r[1]) for r in rows}

    conn.close()

    # If base_date not given, use the LAST date (anchor at end, compute backwards)
    # But we need to compute forward in time, so we use earliest available date
    # before start_date as the anchor, OR use base_value at start_date.
    # Strategy: compute forward from base_value at the earliest date.
    # If base_date is None, anchor at the first date in range.
    if base_date is None:
        base_date = dates[0]

    # Build a list of (date, weighted_change%) pairs, then chain forward
    index_series = {}
    prev_date = None
    prev_index = base_value

    # If base_date is before start_date, we need to find it in prices
    # Otherwise, use the first available date as base
    if base_date not in dates:
        # base_date is outside our range — just use base_value at first date
        base_date = dates[0]

    index_series[base_date] = base_value
    prev_date = base_date
    prev_index = base_value

    # Only compute for dates AFTER base_date
    dates_to_compute = [d for d in dates if d > base_date]

    for date in dates_to_compute:
        total_w_used = 0.0
        weighted_change = 0.0
        matched = 0
        for c in constituents:
            code = ALIASES.get(c['code'], c['code'])
            weight = c.get('weight_percentage', 0)
            if code not in prices:
                continue
            tp = prices[code]
            today_close = tp.get(date)
            if today_close is None:
                # Fallback: last known price before today
                for d in sorted(tp.keys(), reverse=True):
                    if d < date:
                        today_close = tp[d]
                        break
            if today_close is None or today_close <= 0:
                continue
            prev_close = tp.get(prev_date)
            if prev_close is None:
                for d in sorted(tp.keys(), reverse=True):
                    if d < date:
                        prev_close = tp[d]
                        break
            if prev_close is None or prev_close <= 0:
                continue
            change_pct = (today_close - prev_close) / prev_close * 100
            # Same as apply_master line 173: egx30_change += (weight/total_weight) * chg
            weighted_change += (weight / total_weight) * change_pct
            total_w_used += weight
            matched += 1

        if total_w_used == 0:
            # No data — keep previous
            index_series[date] = prev_index
        else:
            # Same formula as apply_master line 176: val = base * (1 + change/100)
            new_index = prev_index * (1 + weighted_change / 100)
            index_series[date] = round(new_index, 2)
            prev_index = new_index

        prev_date = date

    return index_series


def compute_egx70_historical(start_date: str, end_date: str,
                               base_value: float = 19834.95,
                               base_date: str = None) -> Dict[str, float]:
    """EGX70 EWI — equal-weighted avg of change% of 70 non-EGX30 stocks.
    Uses same logic as apply_master line 192-198."""
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30)
    dates = [r[0] for r in conn.execute("""
        SELECT DISTINCT date FROM price_history
        WHERE date >= ? AND date <= ?
        AND ticker NOT LIKE '%.%' AND close_price > 0
        ORDER BY date
    """, (start_date, end_date)).fetchall()]
    if not dates:
        conn.close()
        return {}

    # Get 70 tickers not in EGX30 (use top by data density)
    egx30_codes = set(c['code'] for c in _load_constituents('EGX30'))
    tickers = [r[0] for r in conn.execute("""
        SELECT ticker, COUNT(*) as n FROM price_history
        WHERE date>=? AND date<=? AND ticker NOT LIKE '%.%' AND close_price>0
        GROUP BY ticker HAVING n >= 100 ORDER BY n DESC LIMIT 70
    """, (start_date, end_date)).fetchall()]
    # Filter out EGX30 constituents
    tickers = [t for t in tickers if t not in egx30_codes][:70]
    # Pre-load prices
    prices = {}
    for t in tickers:
        rows = conn.execute("SELECT date, close_price FROM price_history WHERE ticker=? AND date>=? AND date<=? AND close_price>0 ORDER BY date", (t, start_date, end_date)).fetchall()
        if rows:
            prices[t] = {r[0]: float(r[1]) for r in rows}
    conn.close()

    if base_date is None or base_date not in dates:
        base_date = dates[0]
    index_series = {base_date: base_value}
    prev_date = base_date
    prev_index = base_value
    for date in dates:
        if date <= base_date:
            continue
        changes = []
        for t in tickers:
            if t not in prices:
                continue
            tp = prices[t]
            today = tp.get(date)
            prev = tp.get(prev_date)
            if today is None:
                for d in sorted(tp.keys(), reverse=True):
                    if d < date:
                        today = tp[d]; break
            if prev is None:
                for d in sorted(tp.keys(), reverse=True):
                    if d < date:
                        prev = tp[d]; break
            if today and prev and prev > 0:
                changes.append((today - prev) / prev * 100)
        if not changes:
            index_series[date] = prev_index
        else:
            # Equal-weighted: simple average (same as apply_master line 196)
            avg_change = sum(changes) / len(changes)
            new_index = prev_index * (1 + avg_change / 100)
            index_series[date] = round(new_index, 2)
            prev_index = new_index
        prev_date = date
    return index_series


def compute_egx100_historical(egx30_series: Dict, egx70_series: Dict,
                                base_value: float = 26233.0) -> Dict[str, float]:
    """EGX100 = composite 30*EGX30_change + 70*EGX70_change (per apply_master line 218).
    Both series must have same dates. Returns {date: egx100_value}."""
    if not egx30_series or not egx70_series:
        return {}
    common_dates = sorted(set(egx30_series.keys()) & set(egx70_series.keys()))
    if not common_dates:
        return {}
    result = {common_dates[0]: base_value}
    prev_idx = base_value
    for i in range(1, len(common_dates)):
        d_prev, d_curr = common_dates[i-1], common_dates[i]
        chg_30 = (egx30_series[d_curr] / egx30_series[d_prev] - 1) * 100 if egx30_series[d_prev] > 0 else 0
        chg_70 = (egx70_series[d_curr] / egx70_series[d_prev] - 1) * 100 if egx70_series[d_prev] > 0 else 0
        # apply_master line 218: egx100_change = (30*egx30_change + 70*egx70_change)/100
        egx100_change = (30 * chg_30 + 70 * chg_70) / 100.0
        new_idx = prev_idx * (1 + egx100_change / 100)
        result[d_curr] = round(new_idx, 2)
        prev_idx = new_idx
    return result


# ─── Breadth (for regime classification) ─────────────────────────────────────

def compute_breadth(date: str, conn: sqlite3.Connection) -> float:
    """% of tickers above their SMA50 on given date."""
    rows = conn.execute("""
        SELECT ticker, close_price FROM price_history
        WHERE date=? AND ticker NOT LIKE '%.%' AND close_price>0
    """, (date,)).fetchall()
    if not rows:
        return 0.0
    above = 0
    total = 0
    for ticker, close in rows:
        # Get last 50 closes before this date
        prev = conn.execute("""
            SELECT close_price FROM price_history
            WHERE ticker=? AND date<? AND close_price>0
            ORDER BY date DESC LIMIT 50
        """, (ticker, date)).fetchall()
        if len(prev) >= 50:
            sma50 = sum(r[0] for r in prev) / 50
            if sma50 > 0:
                total += 1
                if close > sma50:
                    above += 1
    return (above / total * 100) if total > 0 else 0.0


# ─── Orchestrator ────────────────────────────────────────────────────────────

class Orchestrator:
    """Config-driven orchestrator. Auto-discovers blocks from blocks/ folder."""

    def __init__(self):
        self.config = self._load_configs()
        self.blocks = self._discover_blocks()

    def _load_configs(self) -> Dict:
        config_dir = CAMP_DIR / 'config'
        result = {'features': {}, 'weights': {}, 'regimes': {}}
        for name in ['features', 'weights', 'regimes']:
            yaml_path = config_dir / f'{name}.yaml'
            json_path = config_dir / f'{name}.json'
            if yaml and yaml_path.exists():
                with open(yaml_path) as f:
                    result[name] = yaml.safe_load(f.read()) or {}
            elif json_path.exists():
                with open(json_path) as f:
                    result[name] = json.load(f)
            else:
                # Fallback to inline defaults
                result[name] = self._default_config(name)
        return result

    def _default_config(self, name: str) -> Dict:
        if name == 'features':
            return {'blocks': {b: {'enabled': True} for b in [
                'momentum_20', 'momentum_60', 'sector_leadership',
                'volume_surge', 'distance_52w', 'egx30_trend',
                'volume_price_div', 'buy_sell_pressure'
            ]}}
        if name == 'weights':
            return {'default': {b: 0.125 for b in [
                'momentum_20', 'momentum_60', 'sector_leadership',
                'volume_surge', 'distance_52w', 'egx30_trend',
                'volume_price_div', 'buy_sell_pressure'
            ]}}
        if name == 'regimes':
            return {'regimes': {
                'Bull': {'egx30_vs_sma200': '>', 'breadth_min': 0.55},
                'Bear': {'egx30_vs_sma200': '<', 'breadth_max': 0.45},
                'Sideways': {'else': True}
            }}
        return {}

    def _discover_blocks(self) -> Dict:
        """Auto-discover: any .py in blocks/ with compute()."""
        blocks = {}
        blocks_dir = CAMP_DIR / 'blocks'
        if not blocks_dir.exists():
            return blocks
        import importlib
        for f in sorted(blocks_dir.glob('*.py')):
            if f.name == '__init__.py':
                continue
            name = f.stem
            try:
                # Add camp dir to path for import
                if str(CAMP_DIR) not in sys.path:
                    sys.path.insert(0, str(CAMP_DIR))
                module = importlib.import_module(f'blocks.{name}')
                if hasattr(module, 'compute'):
                    blocks[name] = module
            except Exception as e:
                print(f"WARNING: block {name} failed to load: {e}", file=sys.stderr)
        return blocks

    def detect_regime(self, breadth: float, egx30: float = None, egx30_sma200: float = None) -> str:
        """Breadth-only regime classification (no EGX30 — avoids splits contamination).
        Bull: breadth > 55%, Bear: breadth < 45%, Sideways: else.
        breadth = % of tickers above their SMA50."""
        if breadth > 55:
            return 'Bull'
        elif breadth < 45:
            return 'Bear'
        return 'Sideways'

    def evaluate(self, ticker: str, date: str, price_data: Dict,
                 regime: str = None, breadth: float = None) -> Dict:
        """Run all enabled blocks + combine with regime-specific weights.
        If regime not given, detect from breadth."""
        if regime is None and breadth is not None:
            regime = self.detect_regime(breadth)
        elif regime is None:
            regime = 'Sideways'  # default
        # Use regime weights if regime given, else default
        weights_cfg = self.config['weights']
        weights = weights_cfg.get(regime, weights_cfg.get('default', {}))

        total_score = 0.0
        total_weight = 0.0
        reasons = []
        block_results = {}

        for block_name, block_cfg in self.config['features'].get('blocks', {}).items():
            if not block_cfg.get('enabled', False):
                continue
            weight = weights.get(block_name, 0)
            if weight == 0:
                continue
            if block_name not in self.blocks:
                continue
            try:
                result = self.blocks[block_name].compute(ticker, date, price_data)
                total_score += result['score'] * weight
                total_weight += weight
                reasons.append(f"{block_name}: {result.get('reason','')}")
                block_results[block_name] = result
            except Exception as e:
                print(f"WARNING: block {block_name} failed for {ticker}: {e}", file=sys.stderr)
                continue

        final_score = total_score / total_weight if total_weight > 0 else 0.0

        return {
            'decision': 'BUY' if final_score >= COMPOSITE_THRESHOLD else 'HOLD',
            'score': round(final_score, 3),
            'regime': regime or 'Unknown',
            'reasons': reasons,
            'block_scores': {k: round(v.get('score', 0), 3) for k, v in block_results.items()},
        }


# ─── Indicator helpers (shared with blocks) ──────────────────────────────────

def sma(values, period):
    if len(values) < period: return None
    return sum(values[-period:]) / period

def build_price_data(closes, highs, lows, opens, volumes):
    """Build price_data dict for blocks."""
    import math as _m
    def _rsi(c, period=14):
        if len(c) < period + 1: return None
        g, l = [], []
        for i in range(1, len(c)):
            ch = c[i] - c[i-1]
            g.append(max(0, ch)); l.append(max(0, -ch))
        if len(g) < period: return None
        ag = sum(g[-period:]) / period; al = sum(l[-period:]) / period
        return 100 - 100 / (1 + ag / (al or 0.001)) if al > 0 else 100.0
    def _atr(h, l, c, period=14):
        if len(c) < period + 1: return None
        trs = []
        for i in range(1, len(c)):
            try:
                if h[i] is None or l[i] is None or c[i-1] is None: continue
                trs.append(max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])))
            except: continue
        return sum(trs[-period:]) / period if len(trs) >= period else None
    pd = {
        'closes': list(closes), 'highs': list(highs), 'lows': list(lows),
        'opens': list(opens), 'volumes': list(volumes),
    }
    pd['sma50'] = sma(pd['closes'], 50)
    pd['sma200'] = sma(pd['closes'], 200)
    pd['rsi'] = _rsi(pd['closes'], 14)
    pd['atr'] = _atr(pd['highs'], pd['lows'], pd['closes'], 14)
    return pd

def rsi(closes, period=14):
    if len(closes) < period + 1: return None
    g, l = [], []
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i-1]
        g.append(max(0, ch)); l.append(max(0, -ch))
    if len(g) < period: return None
    ag = sum(g[-period:]) / period; al = sum(l[-period:]) / period
    return 100 - 100 / (1 + ag / (al or 0.001)) if al > 0 else 100.0

def atr(highs, lows, closes, period=14):
    if len(closes) < period + 1: return None
    trs = []
    for i in range(1, len(closes)):
        try:
            h, l, c_prev = highs[i], lows[i], closes[i-1]
            if h is None or l is None or c_prev is None: continue
            trs.append(max(h-l, abs(h-c_prev), abs(l-c_prev)))
        except: continue
    return sum(trs[-period:]) / period if len(trs) >= period else None


# ─── Self-test ────────────────────────────────────────────────────────────────

def _self_test():
    """Test EGX30 computation against REAL_EGX30 benchmark."""
    print('=== orchestrator.py self-test ===')
    REAL_EGX30 = {
        '2026-09-22': 54930.89, '2026-09-23': 54224.93, '2026-09-24': 53776.69,
        '2026-09-27': 53031.69, '2026-09-28': 52468.71, '2026-09-29': 52297.12,
        '2026-09-30': 51894.83, '2026-10-01': 53055.03, '2026-10-04': 53911.10,
        '2026-10-05': 53553.41, '2026-10-06': 53298.14, '2026-10-07': 53265.16,
    }
    dates = sorted(REAL_EGX30.keys())
    print(f'\nComputing EGX30 from {dates[0]} to {dates[-1]}...')
    # Use first date as base with real value
    series = compute_egx30_historical(dates[0], dates[-1],
                                       base_value=REAL_EGX30[dates[0]],
                                       base_date=dates[0])
    print(f'Computed {len(series)} days')
    print(f'\n{"Date":<12} {"Real":>10} {"Computed":>10} {"Diff%":>8} {"Match":>6}')
    print('-' * 50)
    matched = 0
    for i, date in enumerate(dates):
        real = REAL_EGX30[date]
        computed = series.get(date)
        if computed is None:
            print(f'{date:<12} {real:>10,.2f} {"—":>10} {"—":>8} NO DATA')
            continue
        diff_pct = abs(computed - real) / real * 100
        status = '✓' if diff_pct < 0.5 else '⚠' if diff_pct < 2 else '✗'
        print(f'{date:<12} {real:>10,.2f} {computed:>10,.2f} {diff_pct:>7.2f}% {status}')
        if diff_pct < 0.5:
            matched += 1
    print(f'\nResult: {matched}/{len(dates)} days within 0.5%')
    print('\nOrchestrator init:')
    orch = Orchestrator()
    print(f'  Blocks discovered: {list(orch.blocks.keys())}')
    print(f'  Features config: {list(orch.config["features"].get("blocks",{}).keys())}')
    print('Self-test complete.')


if __name__ == '__main__':
    _self_test()
