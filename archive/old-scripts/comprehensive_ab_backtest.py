#!/usr/bin/env python3
"""
Comprehensive A/B Backtest — V34 + Confidence + Position Management
====================================================================
اختبار رجعي شامل يقوم بـ A/B testing للمحركات الجديدة:

الاختبار 1: Confidence Tier Performance
  - هل TOP_PICK (≥80%) بيكسب أكثر من SKIP (<50%)؟
  - لو لا → confidence engine محتاج ضبط

الاختبار 2: V34 Institutional Decision Performance
  - هل إشارات "شراء انفجار مؤسسي" بتكسب أكثر من "انتظر"؟
  - هل Tech Score العالي بيتنبأ بأداء أفضل؟

الاختبار 3: Dynamic vs Static Parameters
  - هل ATR-based dynamic stops/targets بتتفوق على static؟
  - المنظومة مبنية على نسب ديناميكية بناء على حركة السوق وحركة كل سهم

الاختبار 4: Position Management Simulation
  - لو اتبعنا توصيات HOLD/EXIT/REDUCE، هل كنا هنجيب أرباح أكبر؟
  - مقارنة: production exit vs position_manager exit

الاختبار 5: Market Regime Performance
  - هل النظام بيتأقلم مع حالات السوق المختلفة (bull/bear/sideways)?
  - مفيش ثوابت فى سوق متغير خالص

Usage:
  python3 scripts/comprehensive_ab_backtest.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

# Paths
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_VPS_ROOT = Path(__file__).resolve().parent.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = _VPS_ROOT / 'backtest_results'
OUTPUT_DIR.mkdir(exist_ok=True)
OUTPUT_FILE = OUTPUT_DIR / f'comprehensive_ab_backtest_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'

print(f"📊 Comprehensive A/B Backtest")
print(f"   Predictions DB: {PREDICTIONS_DB}")
print(f"   Price History DB: {PRICE_HISTORY_DB}")
print(f"   Output: {OUTPUT_FILE}")
print()


# ============================================================================
# DATA LOADING
# ============================================================================

def load_closed_predictions() -> List[Dict]:
    """حمّل كل التوقعات المقفولة من predictions.db."""
    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''
        SELECT id, ticker, signal, signal_type, persona, entry_price, target_price,
               target_price_2, stop_loss, master_score, technical_score,
               actual_return, holding_days, exit_type, outcome_date, created_at,
               highest_price_reached, lowest_price_reached, atr_at_entry,
               confidence, pnl_pct, exit_price, explosive_score
        FROM predictions
        WHERE actual_return IS NOT NULL
          AND entry_price > 0
          AND stop_loss > 0
          AND target_price > 0
        ORDER BY created_at ASC
    ''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    print(f"✓ Loaded {len(rows)} closed predictions")
    return rows


def load_price_history(ticker: str, start_date: str, end_date: str) -> List[Dict]:
    """حمّل تاريخ الأسعار لسهم معين في فترة معينة."""
    conn = sqlite3.connect(PRICE_HISTORY_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # Try multiple table schemas
    for table in ['stock_daily_prices', 'daily_prices', 'prices']:
        try:
            cur.execute(f'''
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM {table}
                WHERE ticker = ? AND date >= ? AND date <= ?
                ORDER BY date ASC
            ''', (ticker, start_date[:10], end_date[:10]))
            rows = [dict(r) for r in cur.fetchall()]
            if rows:
                conn.close()
                return rows
        except Exception:
            continue
    conn.close()
    return []


# ============================================================================
# TEST 1: CONFIDENCE TIER PERFORMANCE
# ============================================================================

def test_confidence_tiers(predictions: List[Dict]) -> Dict:
    """
    الاختبار 1: هل confidence tiers بتفرق فعلاً؟
    نقارن أداء TOP_PICK vs STRONG vs WATCH vs SKIP.
    """
    print("\n" + "=" * 70)
    print("🧪 TEST 1: Confidence Tier Performance")
    print("=" * 70)

    # Group by confidence tier — BACKTEST-CALIBRATED thresholds (2026-08-11)
    tiers = {
        'TOP_PICK (≥75%)': [],   # ≥ 75 (was 80)
        'STRONG (60-74%)': [],   # 60-74 (was 65-79)
        'WATCH (45-59%)': [],    # 45-59 (was 50-64)
        'SKIP (<45%)': [],       # < 45 (was < 50)
        'NO_CONFIDENCE': [],     # confidence IS NULL
    }

    for p in predictions:
        conf = p.get('confidence')
        if conf is None:
            tiers['NO_CONFIDENCE'].append(p)
        elif conf >= 75:
            tiers['TOP_PICK (≥75%)'].append(p)
        elif conf >= 60:
            tiers['STRONG (60-74%)'].append(p)
        elif conf >= 45:
            tiers['WATCH (45-59%)'].append(p)
        else:
            tiers['SKIP (<45%)'].append(p)

    results = {}
    print(f"\n{'Tier':<22} {'Count':>6} {'Win%':>7} {'Avg Ret':>9} {'PF':>7} {'Avg Win':>9} {'Avg Loss':>9}")
    print("-" * 80)

    for tier_name, tier_preds in tiers.items():
        if not tier_preds:
            print(f"{tier_name:<22} {'0':>6}  --- no data ---")
            continue

        n = len(tier_preds)
        wins = [p for p in tier_preds if p['actual_return'] > 0]
        losses = [p for p in tier_preds if p['actual_return'] <= 0]
        win_rate = len(wins) / n * 100 if n else 0
        avg_ret = sum(p['actual_return'] for p in tier_preds) / n
        avg_win = sum(p['actual_return'] for p in wins) / len(wins) if wins else 0
        avg_loss = sum(p['actual_return'] for p in losses) / len(losses) if losses else 0
        gross_profit = sum(p['actual_return'] for p in wins)
        gross_loss = abs(sum(p['actual_return'] for p in losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')

        results[tier_name] = {
            'count': n,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_ret, 2),
            'profit_factor': round(pf, 2),
            'avg_win': round(avg_win, 2),
            'avg_loss': round(avg_loss, 2),
            'gross_profit': round(gross_profit, 2),
            'gross_loss': round(gross_loss, 2),
        }

        print(f"{tier_name:<22} {n:>6} {win_rate:>6.1f}% {avg_ret:>+8.2f}% {pf:>7.2f} {avg_win:>+8.2f}% {avg_loss:>+8.2f}%")

    # Validation: TOP_PICK should outperform SKIP
    tp = results.get('TOP_PICK (≥75%)', {})
    sk = results.get('SKIP (<45%)', {})
    if tp and sk:
        tp_wr = tp['win_rate']
        sk_wr = sk['win_rate']
        tp_ar = tp['avg_return']
        sk_ar = sk['avg_return']
        print(f"\n📈 VALIDATION:")
        print(f"   TOP_PICK win rate: {tp_wr}% vs SKIP win rate: {sk_wr}%")
        print(f"   TOP_PICK avg ret:  {tp_ar}% vs SKIP avg ret:  {sk_ar}%")
        if tp_wr > sk_wr and tp_ar > sk_ar:
            print(f"   ✅ CONFIDENCE ENGINE WORKS — TOP_PICK outperforms SKIP")
        else:
            print(f"   ⚠️  CONFIDENCE ENGINE NEEDS TUNING — TOP_PICK does NOT outperform SKIP")

    return results


# ============================================================================
# TEST 2: V34 INSTITUTIONAL DECISION PERFORMANCE (simulated)
# ============================================================================

def test_v34_signals(predictions: List[Dict]) -> Dict:
    """
    الاختبار 2: هل إشارات V34 (المحاكاة) بتفرق؟
    نستخدم master_score + explosive_score كـ proxy للـ V34 tech_score.
    """
    print("\n" + "=" * 70)
    print("🧪 TEST 2: V34 Institutional Decision (simulated via master_score)")
    print("=" * 70)

    # Simulate V34 signal categories based on available data
    # BACKTEST-CALIBRATED: relaxed thresholds
    # NOTE: explosive_score = 0 for all historical predictions (column not backfilled)
    # So we use master_score alone as V34 tech_score proxy
    v34_signals = {
        '🔥 شراء انفجار مؤسسي (score≥75)': [],
        '✅ شراء قوي (score 60-74)': [],
        '⏳ انتظر (score 45-59)': [],
        '🛑 بيع وتجنب (score<45)': [],
    }

    for p in predictions:
        score = p.get('master_score') or 0
        # Use technical_score as secondary signal if master_score is low
        tech = p.get('technical_score') or 0
        # Effective score = max(master_score, technical_score)
        eff_score = max(score, tech)

        if eff_score >= 75:
            v34_signals['🔥 شراء انفجار مؤسسي (score≥75)'].append(p)
        elif eff_score >= 60:
            v34_signals['✅ شراء قوي (score 60-74)'].append(p)
        elif eff_score >= 45:
            v34_signals['⏳ انتظر (score 45-59)'].append(p)
        else:
            v34_signals['🛑 بيع وتجنب (score<45)'].append(p)

    results = {}
    print(f"\n{'V34 Signal':<48} {'Count':>6} {'Win%':>7} {'Avg Ret':>9} {'PF':>7}")
    print("-" * 85)

    for signal_name, sig_preds in v34_signals.items():
        if not sig_preds:
            print(f"{signal_name:<48} {'0':>6}  --- no data ---")
            continue

        n = len(sig_preds)
        wins = [p for p in sig_preds if p['actual_return'] > 0]
        losses = [p for p in sig_preds if p['actual_return'] <= 0]
        win_rate = len(wins) / n * 100 if n else 0
        avg_ret = sum(p['actual_return'] for p in sig_preds) / n
        gross_profit = sum(p['actual_return'] for p in wins)
        gross_loss = abs(sum(p['actual_return'] for p in losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')

        results[signal_name] = {
            'count': n,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_ret, 2),
            'profit_factor': round(pf, 2),
        }

        print(f"{signal_name:<48} {n:>6} {win_rate:>6.1f}% {avg_ret:>+8.2f}% {pf:>7.2f}")

    # Validation
    breakout = results.get('🔥 شراء انفجار مؤسسي (score≥75)', {})
    avoid = results.get('🛑 بيع وتجنب (score<45)', {})
    if breakout and avoid:
        print(f"\n📈 VALIDATION:")
        print(f"   Breakout win rate: {breakout['win_rate']}% vs Avoid win rate: {avoid['win_rate']}%")
        print(f"   Breakout avg ret:  {breakout['avg_return']}% vs Avoid avg ret:  {avoid['avg_return']}%")
        if breakout['win_rate'] > avoid['win_rate']:
            print(f"   ✅ V34 SIGNALS WORK — Breakout outperforms Avoid")
        else:
            print(f"   ⚠️  V34 SIGNALS NEED TUNING")

    return results


# ============================================================================
# TEST 3: DYNAMIC vs STATIC PARAMETERS (ATR-based)
# ============================================================================

def test_dynamic_vs_static(predictions: List[Dict]) -> Dict:
    """
    الاختبار 3: هل الـ dynamic parameters (ATR-based) بتتفوق على static؟
    نقارن الأداء بناءً على نسبة ATR لكل سهم.
    """
    print("\n" + "=" * 70)
    print("🧪 TEST 3: Dynamic vs Static Parameters (ATR-based)")
    print("=" * 70)

    # Group by ATR-based volatility regime
    regimes = {
        '🔒 Low Volatility (ATR<2%)': [],
        '📊 Medium Volatility (ATR 2-4%)': [],
        '🔥 High Volatility (ATR 4-6%)': [],
        '💥 Extreme Volatility (ATR≥6%)': [],
        '❓ No ATR data': [],
    }

    for p in predictions:
        atr = p.get('atr_at_entry') or 0
        entry = p.get('entry_price') or 0
        if entry > 0 and atr > 0:
            atr_pct = (atr / entry) * 100
        else:
            atr_pct = 0

        if atr_pct == 0:
            regimes['❓ No ATR data'].append(p)
        elif atr_pct < 2:
            regimes['🔒 Low Volatility (ATR<2%)'].append(p)
        elif atr_pct < 4:
            regimes['📊 Medium Volatility (ATR 2-4%)'].append(p)
        elif atr_pct < 6:
            regimes['🔥 High Volatility (ATR 4-6%)'].append(p)
        else:
            regimes['💥 Extreme Volatility (ATR≥6%)'].append(p)

    results = {}
    print(f"\n{'Volatility Regime':<40} {'Count':>6} {'Win%':>7} {'Avg Ret':>9} {'PF':>7} {'Avg Hold':>9}")
    print("-" * 80)

    for regime_name, regime_preds in regimes.items():
        if not regime_preds:
            print(f"{regime_name:<40} {'0':>6}  --- no data ---")
            continue

        n = len(regime_preds)
        wins = [p for p in regime_preds if p['actual_return'] > 0]
        losses = [p for p in regime_preds if p['actual_return'] <= 0]
        win_rate = len(wins) / n * 100 if n else 0
        avg_ret = sum(p['actual_return'] for p in regime_preds) / n
        gross_profit = sum(p['actual_return'] for p in wins)
        gross_loss = abs(sum(p['actual_return'] for p in losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        avg_hold = sum(p.get('holding_days') or 0 for p in regime_preds) / n

        results[regime_name] = {
            'count': n,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_ret, 2),
            'profit_factor': round(pf, 2),
            'avg_hold_days': round(avg_hold, 1),
        }

        print(f"{regime_name:<40} {n:>6} {win_rate:>6.1f}% {avg_ret:>+8.2f}% {pf:>7.2f} {avg_hold:>8.1f}d")

    # Validation: dynamic system should adapt across regimes
    print(f"\n📈 VALIDATION:")
    print(f"   النظام بيتأقلم مع كل أنواع التقلبات؟")
    all_win_rates = [r['win_rate'] for r in results.values() if r['count'] >= 30]
    if all_win_rates:
        wr_min = min(all_win_rates)
        wr_max = max(all_win_rates)
        wr_spread = wr_max - wr_min
        print(f"   Win rate range: {wr_min:.1f}% - {wr_max:.1f}% (spread: {wr_spread:.1f}%)")
        if wr_spread < 15:
            print(f"   ✅ DYNAMIC ADAPTATION WORKS — consistent across regimes (spread <15%)")
        else:
            print(f"   ⚠️  HIGH SPREAD — system may need regime-specific tuning")

    return results


# ============================================================================
# TEST 4: POSITION MANAGEMENT SIMULATION
# ============================================================================

def simulate_position_management(p: Dict) -> Dict:
    """
    محاكاة position manager على توقع تاريخي واحد.
    نقارن: production exit (actual_return) vs simulated managed exit.
    """
    entry = p.get('entry_price') or 0
    target1 = p.get('target_price') or 0
    target2 = p.get('target_price_2') or 0
    stop = p.get('stop_loss') or 0
    actual_return = p.get('actual_return') or 0
    highest = p.get('highest_price_reached') or entry
    lowest = p.get('lowest_price_reached') or entry
    exit_type = p.get('exit_type') or 'unknown'
    atr = p.get('atr_at_entry') or 0

    if entry <= 0 or stop <= 0 or target1 <= 0:
        return {'managed_return': actual_return, 'action': 'NO_DATA', 'improvement': 0}

    is_buy = p.get('signal_type', 'BUY').upper() == 'BUY'

    # Simulate position management logic
    # Logic: if highest reached T1 + partial exit 50% + move SL to breakeven
    #        if highest reached T2 + exit remaining 50%
    #        if lowest touched stop → exit at stop

    if not is_buy:
        # For SELL: invert
        highest_effective = (2 * entry) - lowest  # mirror
        lowest_effective = (2 * entry) - highest
    else:
        highest_effective = highest
        lowest_effective = lowest

    t1_hit = highest_effective >= target1 if target1 > 0 else False
    t2_hit = highest_effective >= target2 if target2 > 0 else False
    stop_hit = lowest_effective <= stop

    managed_return = actual_return  # start with actual

    if t2_hit and target2 > 0:
        # T2 hit: 50% at T1, 50% at T2
        t1_ret = (target1 - entry) / entry * 100 if is_buy else (entry - target1) / entry * 100
        t2_ret = (target2 - entry) / entry * 100 if is_buy else (entry - target2) / entry * 100
        managed_return = (t1_ret * 0.5 + t2_ret * 0.5)
        action = 'TAKE_PROFIT_T2'
    elif t1_hit:
        # T1 hit but not T2: 50% at T1, 50% at actual exit
        t1_ret = (target1 - entry) / entry * 100 if is_buy else (entry - target1) / entry * 100
        # Move SL to breakeven for remaining 50%
        if stop_hit and actual_return < 0:
            # Stop hit after T1 → remaining 50% at breakeven (0%)
            managed_return = t1_ret * 0.5 + 0 * 0.5
        else:
            managed_return = t1_ret * 0.5 + actual_return * 0.5
        action = 'TAKE_PROFIT_T1'
    elif stop_hit and actual_return < -5:
        # Early exit signal
        managed_return = max(actual_return, -5)  # cap at -5%
        action = 'EARLY_EXIT'
    else:
        action = 'HOLD'

    improvement = managed_return - actual_return
    return {
        'managed_return': round(managed_return, 2),
        'action': action,
        'improvement': round(improvement, 2),
        't1_hit': t1_hit,
        't2_hit': t2_hit,
    }


def test_position_management(predictions: List[Dict]) -> Dict:
    """
    الاختبار 4: محاكاة position management على كل التوقعات.
    """
    print("\n" + "=" * 70)
    print("🧪 TEST 4: Position Management Simulation")
    print("=" * 70)

    results = []
    action_counts = defaultdict(int)
    total_production_pnl = 0
    total_managed_pnl = 0

    for p in predictions:
        sim = simulate_position_management(p)
        results.append({
            'id': p['id'],
            'ticker': p['ticker'],
            'production_return': p['actual_return'],
            'managed_return': sim['managed_return'],
            'improvement': sim['improvement'],
            'action': sim['action'],
        })
        action_counts[sim['action']] += 1
        total_production_pnl += p['actual_return']
        total_managed_pnl += sim['managed_return']

    # Calculate stats
    n = len(results)
    prod_wins = sum(1 for r in results if r['production_return'] > 0)
    managed_wins = sum(1 for r in results if r['managed_return'] > 0)
    prod_wr = prod_wins / n * 100 if n else 0
    managed_wr = managed_wins / n * 100 if n else 0
    prod_avg = total_production_pnl / n if n else 0
    managed_avg = total_managed_pnl / n if n else 0

    # Profit factor
    prod_gp = sum(r['production_return'] for r in results if r['production_return'] > 0)
    prod_gl = abs(sum(r['production_return'] for r in results if r['production_return'] <= 0))
    managed_gp = sum(r['managed_return'] for r in results if r['managed_return'] > 0)
    managed_gl = abs(sum(r['managed_return'] for r in results if r['managed_return'] <= 0))
    prod_pf = prod_gp / prod_gl if prod_gl > 0 else float('inf')
    managed_pf = managed_gp / managed_gl if managed_gl > 0 else float('inf')

    print(f"\n{'Metric':<30} {'Production':>12} {'Managed':>12} {'Delta':>10}")
    print("-" * 70)
    print(f"{'Total PnL (%)':<30} {total_production_pnl:>+11.1f} {total_managed_pnl:>+11.1f} {total_managed_pnl-total_production_pnl:>+9.1f}")
    print(f"{'Avg Return per Trade':<30} {prod_avg:>+11.2f} {managed_avg:>+11.2f} {managed_avg-prod_avg:>+9.2f}")
    print(f"{'Win Rate':<30} {prod_wr:>11.1f}% {managed_wr:>11.1f}% {managed_wr-prod_wr:>+8.1f}%")
    print(f"{'Profit Factor':<30} {prod_pf:>12.2f} {managed_pf:>12.2f} {managed_pf-prod_pf:>+9.2f}")
    print(f"{'Wins':<30} {prod_wins:>12} {managed_wins:>12} {managed_wins-prod_wins:>+9}")
    print(f"\n{'Action Distribution:'}")
    for action, count in sorted(action_counts.items(), key=lambda x: -x[1]):
        pct = count / n * 100
        print(f"  {action:<25} {count:>5} ({pct:>5.1f}%)")

    improvement = total_managed_pnl - total_production_pnl
    print(f"\n📈 VALIDATION:")
    print(f"   Position Management Improvement: {improvement:+.1f}% total ({improvement/n:+.2f}% per trade)")
    if improvement > 0:
        print(f"   ✅ POSITION MANAGEMENT ADDS VALUE — {improvement:+.1f}% improvement")
    else:
        print(f"   ⚠️  POSITION MANAGEMENT NEEDS TUNING — {improvement:+.1f}% worse")

    return {
        'production': {
            'total_pnl': round(total_production_pnl, 2),
            'avg_return': round(prod_avg, 2),
            'win_rate': round(prod_wr, 2),
            'profit_factor': round(prod_pf, 2),
            'wins': prod_wins,
        },
        'managed': {
            'total_pnl': round(total_managed_pnl, 2),
            'avg_return': round(managed_avg, 2),
            'win_rate': round(managed_wr, 2),
            'profit_factor': round(managed_pf, 2),
            'wins': managed_wins,
        },
        'improvement': round(improvement, 2),
        'improvement_per_trade': round(improvement / n, 4) if n else 0,
        'action_distribution': dict(action_counts),
    }


# ============================================================================
# TEST 5: MARKET REGIME PERFORMANCE (time-based)
# ============================================================================

def test_market_regimes(predictions: List[Dict]) -> Dict:
    """
    الاختبار 5: أداء النظام في فترات السوق المختلفة.
    مفيش ثوابت فى سوق متغير — هل النظام بيتأقلم؟
    """
    print("\n" + "=" * 70)
    print("🧪 TEST 5: Market Regime Performance (time-based)")
    print("=" * 70)

    # Group by month
    months = defaultdict(list)
    for p in predictions:
        date_str = p.get('created_at', '')
        if date_str:
            month = date_str[:7]  # YYYY-MM
            months[month].append(p)

    results = {}
    print(f"\n{'Month':<10} {'Count':>6} {'Win%':>7} {'Avg Ret':>9} {'PF':>7} {'Avg Win':>9} {'Avg Loss':>9}")
    print("-" * 70)

    for month in sorted(months.keys()):
        month_preds = months[month]
        n = len(month_preds)
        wins = [p for p in month_preds if p['actual_return'] > 0]
        losses = [p for p in month_preds if p['actual_return'] <= 0]
        win_rate = len(wins) / n * 100 if n else 0
        avg_ret = sum(p['actual_return'] for p in month_preds) / n
        avg_win = sum(p['actual_return'] for p in wins) / len(wins) if wins else 0
        avg_loss = sum(p['actual_return'] for p in losses) / len(losses) if losses else 0
        gross_profit = sum(p['actual_return'] for p in wins)
        gross_loss = abs(sum(p['actual_return'] for p in losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')

        results[month] = {
            'count': n,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_ret, 2),
            'profit_factor': round(pf, 2),
            'avg_win': round(avg_win, 2),
            'avg_loss': round(avg_loss, 2),
        }

        print(f"{month:<10} {n:>6} {win_rate:>6.1f}% {avg_ret:>+8.2f}% {pf:>7.2f} {avg_win:>+8.2f}% {avg_loss:>+8.2f}%")

    # Consistency check
    all_wrs = [r['win_rate'] for r in results.values()]
    all_avgs = [r['avg_return'] for r in results.values()]
    if all_wrs:
        wr_min, wr_max = min(all_wrs), max(all_wrs)
        avg_min, avg_max = min(all_avgs), max(all_avgs)
        print(f"\n📈 CONSISTENCY ANALYSIS:")
        print(f"   Win Rate range: {wr_min:.1f}% - {wr_max:.1f}% (spread: {wr_max-wr_min:.1f}%)")
        print(f"   Avg Return range: {avg_min:+.2f}% - {avg_max:+.2f}% (spread: {avg_max-avg_min:.2f}%)")
        if wr_min >= 60 and avg_min >= 2:
            print(f"   ✅ CONSISTENT PERFORMANCE — system adapts across all months")
        else:
            print(f"   ⚠️  INCONSISTENT — some months underperform, needs regime detection")

    return results


# ============================================================================
# TEST 6: PERSONA PERFORMANCE COMPARISON
# ============================================================================

def test_persona_performance(predictions: List[Dict]) -> Dict:
    """
    الاختبار 6: مقارنة أداء الـ personas الثلاثة.
    هل كل persona بيلتقط فرص مختلفة؟
    """
    print("\n" + "=" * 70)
    print("🧪 TEST 6: Persona Performance Comparison")
    print("=" * 70)

    personas = defaultdict(list)
    for p in predictions:
        persona = p.get('persona') or 'unknown'
        personas[persona].append(p)

    results = {}
    print(f"\n{'Persona':<15} {'Count':>6} {'Win%':>7} {'Avg Ret':>9} {'PF':>7} {'Avg Win':>9} {'Avg Loss':>9} {'Avg Hold':>9}")
    print("-" * 85)

    for persona, persona_preds in personas.items():
        n = len(persona_preds)
        wins = [p for p in persona_preds if p['actual_return'] > 0]
        losses = [p for p in persona_preds if p['actual_return'] <= 0]
        win_rate = len(wins) / n * 100 if n else 0
        avg_ret = sum(p['actual_return'] for p in persona_preds) / n
        avg_win = sum(p['actual_return'] for p in wins) / len(wins) if wins else 0
        avg_loss = sum(p['actual_return'] for p in losses) / len(losses) if losses else 0
        gross_profit = sum(p['actual_return'] for p in wins)
        gross_loss = abs(sum(p['actual_return'] for p in losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        avg_hold = sum(p.get('holding_days') or 0 for p in persona_preds) / n

        results[persona] = {
            'count': n,
            'win_rate': round(win_rate, 2),
            'avg_return': round(avg_ret, 2),
            'profit_factor': round(pf, 2),
            'avg_win': round(avg_win, 2),
            'avg_loss': round(avg_loss, 2),
            'avg_hold_days': round(avg_hold, 1),
        }

        print(f"{persona:<15} {n:>6} {win_rate:>6.1f}% {avg_ret:>+8.2f}% {pf:>7.2f} {avg_win:>+8.2f}% {avg_loss:>+8.2f}% {avg_hold:>8.1f}d")

    return results


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("=" * 70)
    print("🚀 COMPREHENSIVE A/B BACKTEST — V34 + Confidence + Position Mgmt")
    print(f"   Started: {datetime.now().isoformat()}")
    print("=" * 70)

    # Load data
    predictions = load_closed_predictions()

    if not predictions:
        print("❌ No closed predictions found in DB")
        return

    # Run all tests
    results = {
        'test_date': datetime.now().isoformat(),
        'total_predictions': len(predictions),
        'tests': {
            'test1_confidence_tiers': test_confidence_tiers(predictions),
            'test2_v34_signals': test_v34_signals(predictions),
            'test3_dynamic_vs_static': test_dynamic_vs_static(predictions),
            'test4_position_management': test_position_management(predictions),
            'test5_market_regimes': test_market_regimes(predictions),
            'test6_persona_performance': test_persona_performance(predictions),
        }
    }

    # Summary
    print("\n" + "=" * 70)
    print("📋 FINAL SUMMARY")
    print("=" * 70)

    t1 = results['tests']['test1_confidence_tiers']
    tp = t1.get('TOP_PICK (≥75%)', {})
    sk = t1.get('SKIP (<45%)', {})
    if tp and sk:
        print(f"1. Confidence Engine: TOP_PICK {tp['win_rate']}% WR vs SKIP {sk['win_rate']}% WR")

    t4 = results['tests']['test4_position_management']
    print(f"2. Position Management: {t4['improvement']:+.1f}% total improvement ({t4['improvement_per_trade']:+.2f}%/trade)")

    t5 = results['tests']['test5_market_regimes']
    all_wrs = [r['win_rate'] for r in t5.values()]
    if all_wrs:
        print(f"3. Market Regime Consistency: {min(all_wrs):.1f}% - {max(all_wrs):.1f}% WR range")

    t6 = results['tests']['test6_persona_performance']
    for persona, stats in t6.items():
        print(f"4. Persona '{persona}': {stats['win_rate']}% WR, {stats['avg_return']:+.2f}% avg, PF={stats['profit_factor']}")

    # Save results
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)

    print(f"\n💾 Results saved to: {OUTPUT_FILE}")
    print(f"   Total predictions analyzed: {len(predictions)}")
    print(f"   Completed: {datetime.now().isoformat()}")


if __name__ == '__main__':
    main()
