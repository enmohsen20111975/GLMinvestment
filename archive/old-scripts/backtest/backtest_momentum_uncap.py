#!/usr/bin/env python3
"""
Backtest Retrospective: MOMENTUM-UNCAP (v3.63.0 → v3.64.0)
============================================================
يقيس الفرق بين الـ targets القديمة (Persona Caps) والجديدة (Momentum Uncap)
على أسهم محددة، ويحسب الـ P&L hypothetical لو اتبعنا كل استراتيجية.

الهدف: نجاوب على سؤال محسن — "كنا هنجمع كام % زيادة لو الـ uncap كان شغّال
من بدري؟"

Workflow:
  1. لكل ticker، حمّل الـ price history الكامل.
  2. لكل أسبوع d في آخر N يوم (default 180):
     a. truncate الـ history لحد d (as-of-date simulation — ما يشوفش المستقبل).
     b. احسب volume_ratio, change_1w_pct, change_pct, is_breakout, ATR(14).
     c. حدد entry_price = close[d].
     d. شغّل compute_persona_rr_overrides() بطريقتين:
        - OLD: من غير volume_ratio/change_1w_pct (الـ Caps الافتراضية)
        - NEW: مع volume_ratio/change_1w_pct (الـ uncap لو الزخم انفجاري)
     e. شوف الـ future prices بعد d (forward window = 30 يوم):
        - highest_close في الـ forward window
        - close_at_end (آخر يوم في الـ window)
     f. احسب P&L hypothetical لكل persona (gambler/balanced/conservative):
        - لو highest_close >= target → exit عند target (WIN)
        - لو lowest_close <= stop  → exit عند stop  (LOSS)
        - غير كده → exit عند close_at_end (TIMEOUT)
  3. aggregate per ticker + per persona:
     - sum_pnl_old vs sum_pnl_new
     - delta_pct = (sum_pnl_new - sum_pnl_old) / |sum_pnl_old| * 100
  4. احفظ النتيجة في db/backtest_results/momentum_uncap_backtest.json

Usage:
    python3 scripts/backtest_momentum_uncap.py --tickers GALAXY,ISIN --days 180
    python3 scripts/backtest_momentum_uncap.py --tickers COMI,ETEL --days 90 --persona gambler
    python3 scripts/backtest_momentum_uncap.py --tickers GALAXY --days 365 --step 14

ملاحظة: الـ tickers الصحيحة لـ Galaxy و ابن سينا لازم تتحدد من stocks.db
على الـ VPS (الأسماء بتختلف بين Bloomberg/Reuters/EGX codes).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

OUTPUT_DIR = PROJECT_ROOT / 'db' / 'backtest_results'
OUTPUT_PATH = OUTPUT_DIR / 'momentum_uncap_backtest.json'

DEFAULT_DAYS = 180
DEFAULT_STEP = 7          # كل أسبوع (عشان نوفّر وقت)
DEFAULT_FORWARD = 30      # forward window بالأيام
PERSONAS = ('gambler', 'balanced', 'conservative')


# ============================================================================
# Helpers — نفس الـ formulas اللي في maestro_orchestrator.py
# ============================================================================

def _atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
    """ATR (Average True Range) — Wilder's smoothing."""
    if len(closes) < period + 1 or len(highs) < period + 1 or len(lows) < period + 1:
        return 0.0
    trs = []
    n = min(len(closes), len(highs), len(lows))
    for i in range(1, n):
        pc = closes[i - 1]
        if pc <= 0 or highs[i] <= 0 or lows[i] <= 0:
            continue
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - pc),
            abs(lows[i] - pc),
        )
        trs.append(tr)
    if not trs:
        return 0.0
    window = trs[-period:] if len(trs) >= period else trs
    return sum(window) / len(window)


def _volume_ratio(volumes: List[float], period: int = 20) -> float:
    """نسبة حجم تداول آخر يوم للمتوسط (SMA-20)."""
    if not volumes or len(volumes) < 2:
        return 1.0
    last = volumes[-1]
    window = [v for v in volumes[-(period + 1):-1] if v > 0]
    if not window or last <= 0:
        return 1.0
    return last / (sum(window) / len(window))


def _change_pct(closes: List[float], lookback: int) -> float:
    """نسبة التغير على lookback أيام (آخر close مقابل close[−lookback−1])."""
    if len(closes) < lookback + 1:
        return 0.0
    last = closes[-1]
    prev = closes[-(lookback + 1)]
    if prev <= 0:
        return 0.0
    return ((last - prev) / prev) * 100.0


def _is_breakout(closes: List[float], highs: List[float], period: int = 20) -> bool:
    """breakout: current close >= max(highs[-period:]) * 0.99."""
    if not closes or not highs:
        return False
    current = closes[-1]
    if current <= 0:
        return False
    window = [h for h in highs[-period:] if h > 0]
    if not window:
        return False
    return current >= max(window) * 0.99


# ============================================================================
# Persona RR — نستدعي نفس الـ function من core_scoring_engine (single source)
# ============================================================================

def _compute_persona_rr_safe(persona_type: str, entry_price: float,
                              volume_ratio: float, change_1w_pct: float,
                              atr: float, vol_pct: float):
    """Wrapper آمن لـ compute_persona_rr_overrides.

    OLD mode: نمرر volume_ratio=0, change_1w_pct=0 (يعني Caps الافتراضية).
    NEW mode: نمرر الـ values الحقيقية (يعني uncap لو الزخم انفجاري).
    """
    try:
        from analyzers.core_scoring_engine import compute_persona_rr_overrides
        return compute_persona_rr_overrides(
            persona_type=persona_type,
            entry_price=entry_price,
            atr=atr,
            vol_pct=vol_pct,
            stock_profile=None,
            volume_ratio=volume_ratio,
            change_1w_pct=change_1w_pct,
        )
    except Exception as e:
        print(f"  ⚠️  compute_persona_rr_overrides failed: {e}")
        return None


# ============================================================================
# Price history loader — same as load_price_history but returns raw arrays
# ============================================================================

def load_history_arrays(ticker: str, market: str = 'EGX') -> Dict:
    """Load full price history for a ticker and return as structured arrays.

    Returns dict with: dates, opens, highs, lows, closes, volumes.
    Returns empty dict if no data.
    """
    try:
        from data.prices import load_price_history
        history = load_price_history(ticker, limit=1000)
    except Exception as e:
        print(f"  ⚠️  load_price_history failed for {ticker}: {e}")
        return {}

    if not history or len(history) < 30:
        return {}

    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    for row in history:
        try:
            d = row.get('date') or row.get('trade_date') or row.get('day')
            o = float(row.get('open', 0) or 0)
            h = float(row.get('high', 0) or 0)
            l = float(row.get('low', 0) or 0)
            c = float(row.get('close', 0) or row.get('close_price', 0) or 0)
            v = float(row.get('volume', 0) or 0)
            if c <= 0:
                continue
            dates.append(d)
            opens.append(o)
            highs.append(h)
            lows.append(l)
            closes.append(c)
            volumes.append(v)
        except (TypeError, ValueError):
            continue

    if len(closes) < 30:
        return {}

    return {
        'dates': dates, 'opens': opens, 'highs': highs,
        'lows': lows, 'closes': closes, 'volumes': volumes,
    }


# ============================================================================
# P&L simulation — given entry/target/stop + forward window
# ============================================================================

def simulate_pnl(entry: float, target: float, stop: float,
                  forward_highs: List[float], forward_lows: List[float],
                  forward_closes: List[float]) -> Dict:
    """احسب الـ P&L hypothetical لصفقة BUY.

    Returns dict with: exit_price, exit_type (WIN/LOSS/TIMEOUT), pnl_pct, pnl_abs.
    """
    if entry <= 0 or target <= entry or stop >= entry:
        return {'exit_price': entry, 'exit_type': 'INVALID', 'pnl_pct': 0.0, 'pnl_abs': 0.0}

    for i in range(len(forward_closes)):
        h = forward_highs[i] if i < len(forward_highs) else forward_closes[i]
        l = forward_lows[i] if i < len(forward_lows) else forward_closes[i]

        # check stop first (conservative — assume worst case)
        if l > 0 and l <= stop:
            return {
                'exit_price': stop,
                'exit_type': 'LOSS',
                'pnl_pct': ((stop - entry) / entry) * 100.0,
                'pnl_abs': stop - entry,
            }
        # then check target
        if h > 0 and h >= target:
            return {
                'exit_price': target,
                'exit_type': 'WIN',
                'pnl_pct': ((target - entry) / entry) * 100.0,
                'pnl_abs': target - entry,
            }

    # timeout — exit at last close
    if forward_closes:
        last = forward_closes[-1]
        return {
            'exit_price': last,
            'exit_type': 'TIMEOUT',
            'pnl_pct': ((last - entry) / entry) * 100.0,
            'pnl_abs': last - entry,
        }
    return {'exit_price': entry, 'exit_type': 'NO_DATA', 'pnl_pct': 0.0, 'pnl_abs': 0.0}


# ============================================================================
# Main backtest loop
# ============================================================================

def backtest_ticker(ticker: str, days: int, step: int, forward: int,
                     persona_filter: Optional[str] = None) -> Dict:
    """Run backtest for a single ticker.

    Returns dict with: ticker, signals, summary.
    """
    arrays = load_history_arrays(ticker)
    if not arrays:
        return {'ticker': ticker, 'error': 'no price history', 'signals': [], 'summary': {}}

    dates = arrays['dates']
    highs = arrays['highs']
    lows = arrays['lows']
    closes = arrays['closes']
    volumes = arrays['volumes']
    n = len(closes)

    # نبدأ من يوم (n - days) ونخلّص قبل (n - forward) عشان يبقى فيه forward window
    start_idx = max(30, n - days)
    end_idx = n - forward
    if start_idx >= end_idx:
        return {'ticker': ticker, 'error': f'insufficient data (n={n}, days={days}, forward={forward})',
                'signals': [], 'summary': {}}

    signals = []
    personas_to_test = [persona_filter] if persona_filter else list(PERSONAS)

    for i in range(start_idx, end_idx, step):
        # truncate as-of date i (مش نعدّي i)
        asof_closes = closes[:i + 1]
        asof_highs = highs[:i + 1]
        asof_lows = lows[:i + 1]
        asof_volumes = volumes[:i + 1]

        entry_price = asof_closes[-1]
        if entry_price <= 0:
            continue

        # indicators (as-of date)
        vr = _volume_ratio(asof_volumes, period=20)
        c_1d = _change_pct(asof_closes, lookback=1)
        c_1w = _change_pct(asof_closes, lookback=7)
        breakout = _is_breakout(asof_closes, asof_highs, period=20)
        atr_val = _atr(asof_highs, asof_lows, asof_closes, period=14)
        vol_pct = (atr_val / entry_price * 100.0) if (entry_price > 0 and atr_val > 0) else 3.0

        # forward window (المستقبل اللي هنقارن بيه)
        fwd_highs = highs[i + 1: i + 1 + forward]
        fwd_lows = lows[i + 1: i + 1 + forward]
        fwd_closes = closes[i + 1: i + 1 + forward]

        signal_date = dates[i] if i < len(dates) else f'day_{i}'

        signal_record = {
            'date': signal_date,
            'entry': round(entry_price, 4),
            'volume_ratio': round(vr, 2),
            'change_1d_pct': round(c_1d, 2),
            'change_1w_pct': round(c_1w, 2),
            'is_breakout': breakout,
            'atr': round(atr_val, 4),
            'vol_pct': round(vol_pct, 2),
            'is_momentum_explosion': (vr >= 2.0 and c_1w >= 8.0),
            'forward_highest': round(max(fwd_highs) if fwd_highs else 0, 4),
            'forward_lowest': round(min(fwd_lows) if fwd_lows else 0, 4),
            'forward_end_close': round(fwd_closes[-1] if fwd_closes else 0, 4),
            'personas': {},
        }

        for persona in personas_to_test:
            # OLD: بدون volume_ratio/change_1w (الـ Caps الافتراضية)
            rr_old = _compute_persona_rr_safe(
                persona, entry_price,
                volume_ratio=0.0, change_1w_pct=0.0,
                atr=atr_val, vol_pct=vol_pct,
            )
            # NEW: مع الـ values الحقيقية (uncap لو الزخم انفجاري)
            rr_new = _compute_persona_rr_safe(
                persona, entry_price,
                volume_ratio=vr, change_1w_pct=c_1w,
                atr=atr_val, vol_pct=vol_pct,
            )

            if not rr_old or not rr_new:
                continue

            old_target = float(rr_old.get('target') or 0)
            old_stop = float(rr_old.get('stop') or 0)
            new_target = float(rr_new.get('target') or 0)
            new_stop = float(rr_new.get('stop') or 0)

            pnl_old = simulate_pnl(entry_price, old_target, old_stop, fwd_highs, fwd_lows, fwd_closes)
            pnl_new = simulate_pnl(entry_price, new_target, new_stop, fwd_highs, fwd_lows, fwd_closes)

            signal_record['personas'][persona] = {
                'old': {
                    'target': round(old_target, 4),
                    'stop': round(old_stop, 4),
                    'target_pct': rr_old.get('target_pct'),
                    'method': rr_old.get('method'),
                    'pnl_pct': round(pnl_old['pnl_pct'], 2),
                    'exit_type': pnl_old['exit_type'],
                },
                'new': {
                    'target': round(new_target, 4),
                    'stop': round(new_stop, 4),
                    'target_pct': rr_new.get('target_pct'),
                    'method': rr_new.get('method'),
                    'momentum_uncap': rr_new.get('momentum_uncap'),
                    'pnl_pct': round(pnl_new['pnl_pct'], 2),
                    'exit_type': pnl_new['exit_type'],
                },
                'delta_pnl_pct': round(pnl_new['pnl_pct'] - pnl_old['pnl_pct'], 2),
            }

        signals.append(signal_record)

    # aggregate
    summary = _aggregate_summary(signals, personas_to_test)
    return {'ticker': ticker, 'signals': signals, 'summary': summary}


def _aggregate_summary(signals: List[Dict], personas: List[str]) -> Dict:
    """Aggregate P&L across all signals per persona."""
    summary = {}
    for persona in personas:
        old_pnls = []
        new_pnls = []
        deltas = []
        wins_old = 0
        wins_new = 0
        total = 0
        momentum_signals = 0
        for s in signals:
            p = s.get('personas', {}).get(persona)
            if not p:
                continue
            total += 1
            old_pnls.append(p['old']['pnl_pct'])
            new_pnls.append(p['new']['pnl_pct'])
            deltas.append(p['delta_pnl_pct'])
            if p['old']['exit_type'] == 'WIN':
                wins_old += 1
            if p['new']['exit_type'] == 'WIN':
                wins_new += 1
            if p['new'].get('momentum_uncap'):
                momentum_signals += 1

        if total == 0:
            summary[persona] = {'total_signals': 0}
            continue

        sum_old = sum(old_pnls)
        sum_new = sum(new_pnls)
        summary[persona] = {
            'total_signals': total,
            'sum_pnl_old_pct': round(sum_old, 2),
            'sum_pnl_new_pct': round(sum_new, 2),
            'delta_pnl_pct': round(sum_new - sum_old, 2),
            'delta_relative_pct': round(((sum_new - sum_old) / abs(sum_old) * 100) if sum_old != 0 else 0, 2),
            'avg_pnl_old_pct': round(sum_old / total, 2),
            'avg_pnl_new_pct': round(sum_new / total, 2),
            'win_rate_old_pct': round(wins_old / total * 100, 1),
            'win_rate_new_pct': round(wins_new / total * 100, 1),
            'momentum_signals': momentum_signals,
            'momentum_pct': round(momentum_signals / total * 100, 1),
        }
    return summary


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Backtest retrospective: measure P&L delta between Persona Caps (OLD) and Momentum Uncap (NEW).'
    )
    parser.add_argument('--tickers', required=True,
                        help='Comma-separated tickers, e.g. GALAXY,ISIN')
    parser.add_argument('--days', type=int, default=DEFAULT_DAYS,
                        help=f'Lookback window in days (default {DEFAULT_DAYS})')
    parser.add_argument('--step', type=int, default=DEFAULT_STEP,
                        help=f'Signal step in days (default {DEFAULT_STEP} = weekly)')
    parser.add_argument('--forward', type=int, default=DEFAULT_FORWARD,
                        help=f'Forward window for P&L simulation (default {DEFAULT_FORWARD} days)')
    parser.add_argument('--persona', choices=PERSONAS,
                        help='Test only one persona (default: all 3)')
    parser.add_argument('--output', default=str(OUTPUT_PATH),
                        help=f'Output JSON path (default {OUTPUT_PATH})')
    args = parser.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
    if not tickers:
        print('❌ No tickers provided')
        sys.exit(1)

    print(f"\n{'=' * 78}")
    print(f"  Backtest Retrospective: MOMENTUM-UNCAP (v3.63.0 → v3.64.0)")
    print(f"  Tickers: {', '.join(tickers)}")
    print(f"  Window:  {args.days} days, step={args.step}d, forward={args.forward}d")
    print(f"  Persona: {args.persona or 'all (gambler/balanced/conservative)'}")
    print(f"{'=' * 78}\n")

    results = {
        'meta': {
            'generated_at': datetime.now().isoformat(),
            'days': args.days,
            'step': args.step,
            'forward': args.forward,
            'persona_filter': args.persona,
            'tickers': tickers,
        },
        'tickers': {},
    }

    for ticker in tickers:
        print(f"📊 Backtesting {ticker}...")
        result = backtest_ticker(
            ticker, days=args.days, step=args.step,
            forward=args.forward, persona_filter=args.persona,
        )
        results['tickers'][ticker] = result
        if 'error' in result:
            print(f"  ❌ {result['error']}")
            continue
        summary = result.get('summary', {})
        for persona, s in summary.items():
            if not s or s.get('total_signals', 0) == 0:
                continue
            print(f"  [{persona:12s}] signals={s['total_signals']:3d}  "
                  f"OLD: sum={s['sum_pnl_old_pct']:+8.2f}%  win={s['win_rate_old_pct']:5.1f}%  |  "
                  f"NEW: sum={s['sum_pnl_new_pct']:+8.2f}%  win={s['win_rate_new_pct']:5.1f}%  |  "
                  f"Δ={s['delta_pnl_pct']:+7.2f}%  (momentum={s['momentum_signals']})")
        print()

    # save
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)

    print(f"✅ Results saved to: {output_path}")

    # final summary table
    print(f"\n{'=' * 78}")
    print("  FINAL SUMMARY — P&L Delta (NEW vs OLD)")
    print(f"{'=' * 78}")
    print(f"  {'Ticker':<10} {'Persona':<14} {'OLD sum%':>10} {'NEW sum%':>10} {'Δ':>10} {'Momentum':>10}")
    print(f"  {'-' * 10} {'-' * 14} {'-' * 10} {'-' * 10} {'-' * 10} {'-' * 10}")
    for ticker, res in results['tickers'].items():
        if 'error' in res:
            print(f"  {ticker:<10} ❌ {res['error']}")
            continue
        for persona, s in res.get('summary', {}).items():
            if not s or s.get('total_signals', 0) == 0:
                continue
            print(f"  {ticker:<10} {persona:<14} {s['sum_pnl_old_pct']:>+10.2f} "
                  f"{s['sum_pnl_new_pct']:>+10.2f} {s['delta_pnl_pct']:>+10.2f} "
                  f"{s['momentum_signals']:>10}")
    print(f"{'=' * 78}\n")


if __name__ == '__main__':
    main()
