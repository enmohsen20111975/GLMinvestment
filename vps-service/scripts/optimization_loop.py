#!/usr/bin/env python3
"""
Optimization Loop — لوب تكراري لتحسين الاستراتيجيات
=====================================================
بيجرّب مجموعات مختلفة من البارامترات ويلاقي الأحسن.

لكل مجموعة:
1. يمسح predictions
2. يشغل backtesting
3. يسجّل النتائج (win rate, net P/L, profit factor)
4. يطبع جدول مقارنة

Usage:
    cd vps-service
    python3 scripts/optimization_loop.py
"""

import os
import sys
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List
from dataclasses import asdict

# Add vps-service to path
_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))

from scripts.backtesting_engine import (
    run_backtest, STRATEGIES, Strategy,
)


def clear_predictions():
    """يمسح كل predictions قبل كل تجربة"""
    db_path = str(_PROJECT_ROOT / 'db' / 'predictions.db')
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    db = db_manager.connection(db_path, writable=True).__enter__()
    db.execute('DELETE FROM predictions')
    db.commit()
    db.close()


def run_optimization():
    """يشغل لوب تحسين على مجموعات مختلفة من البارامترات"""
    print("=" * 70)
    print("🔄 OPTIMIZATION LOOP — تجربة استراتيجيات مختلفة")
    print("=" * 70)
    print()

    # تعريف مجموعات البارامترات للتجربة
    experiments = [
        # 1. Base strategies
        {'name': 'balanced', 'strategy': 'balanced'},
        {'name': 'conservative', 'strategy': 'conservative'},
        {'name': 'aggressive', 'strategy': 'aggressive'},

        # 2. RSI variations
        {'name': 'rsi_30_70', 'strategy': 'balanced', 'override': {'rsi_oversold': 30, 'rsi_overbought': 70}},
        {'name': 'rsi_25_75', 'strategy': 'balanced', 'override': {'rsi_oversold': 25, 'rsi_overbought': 75}},
        {'name': 'rsi_40_60', 'strategy': 'balanced', 'override': {'rsi_oversold': 40, 'rsi_overbought': 60}},

        # 3. R/R variations
        {'name': 'rr_1.0', 'strategy': 'balanced', 'override': {'min_rr': 1.0}},
        {'name': 'rr_2.0', 'strategy': 'balanced', 'override': {'min_rr': 2.0}},
        {'name': 'rr_3.0', 'strategy': 'balanced', 'override': {'min_rr': 3.0}},

        # 4. Target/Stop variations
        {'name': 'target_5_stop_3', 'strategy': 'balanced', 'override': {'target_pct': 0.05, 'stop_pct': 0.03}},
        {'name': 'target_15_stop_7', 'strategy': 'balanced', 'override': {'target_pct': 0.15, 'stop_pct': 0.07}},
        {'name': 'target_20_stop_10', 'strategy': 'balanced', 'override': {'target_pct': 0.20, 'stop_pct': 0.10}},

        # 5. Min score variations
        {'name': 'score_40', 'strategy': 'balanced', 'override': {'min_score': 40}},
        {'name': 'score_60', 'strategy': 'balanced', 'override': {'min_score': 60}},
        {'name': 'score_70', 'strategy': 'balanced', 'override': {'min_score': 70}},

        # 6. ATR multipliers
        {'name': 'atr_1.5_2.5', 'strategy': 'balanced', 'override': {'atr_stop_mult': 1.5, 'atr_target_mult': 2.5}},
        {'name': 'atr_3_4.5', 'strategy': 'balanced', 'override': {'atr_stop_mult': 3.0, 'atr_target_mult': 4.5}},

        # 7. Exit signals
        {'name': 'exit_rsi_70', 'strategy': 'balanced', 'override': {'exit_rsi_threshold': 70}},
        {'name': 'exit_rsi_80', 'strategy': 'balanced', 'override': {'exit_rsi_threshold': 80}},
        {'name': 'exit_trailing_3', 'strategy': 'balanced', 'override': {'exit_trailing_pct': 0.03}},
        {'name': 'exit_trailing_7', 'strategy': 'balanced', 'override': {'exit_trailing_pct': 0.07}},
    ]

    results = []

    for i, exp in enumerate(experiments, 1):
        print(f"\n{'='*60}")
        print(f"تجربة {i}/{len(experiments)}: {exp['name']}")
        print(f"{'='*60}")

        # Build strategy
        base_strategy = STRATEGIES[exp['strategy']]
        if 'override' in exp:
            # Create modified strategy
            strategy_dict = asdict(base_strategy)
            strategy_dict.update(exp['override'])
            strategy_dict['name'] = exp['name']
            strategy = Strategy(**strategy_dict)

            # Temporarily register
            STRATEGIES[exp['name']] = strategy
        else:
            strategy = base_strategy

        # Clear predictions
        clear_predictions()

        # Run backtest
        result = run_backtest(
            days_back=30,
            per_day=5,
            strategy_name=exp['name'],
            eval_window=30,
        )

        # Extract key metrics
        returns = result.get('returns', [])
        wins = result.get('outcomes', {}).get('TARGET_HIT', 0) + result.get('outcomes', {}).get('PROFIT_TAKEN', 0)
        # Actually use the wins from result
        win_rate = result.get('win_rate', 0)
        net_pl = result.get('net_pl', 0)
        total_trades = result.get('total_trades', 0)

        # Calculate profit factor
        if returns:
            gross_profit = sum(r for r in returns if r > 0)
            gross_loss = abs(sum(r for r in returns if r < 0))
            pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
            avg_return = sum(returns) / len(returns)
        else:
            pf = 0
            avg_return = 0

        results.append({
            'name': exp['name'],
            'params': exp.get('override', {}),
            'total_trades': total_trades,
            'win_rate': win_rate,
            'net_pl': round(net_pl, 2),
            'profit_factor': round(pf, 2) if pf != float('inf') else '∞',
            'avg_return': round(avg_return, 2),
            'wins': wins,
        })

        print(f"\n→ {exp['name']}: WR={win_rate:.1f}%, Net={net_pl:.2f}%, PF={pf:.2f}")

    # Print final comparison table
    print("\n" + "=" * 80)
    print("📊 OPTIMIZATION RESULTS — جدول مقارنة")
    print("=" * 80)
    print(f"{'Strategy':<25} {'Trades':>7} {'Win%':>7} {'Net P/L':>10} {'PF':>6} {'AvgRet':>8}")
    print("-" * 80)

    # Sort by win rate (descending)
    sorted_results = sorted(results, key=lambda x: x['win_rate'], reverse=True)

    for r in sorted_results:
        print(f"{r['name']:<25} {r['total_trades']:>7} {r['win_rate']:>6.1f}% {r['net_pl']:>+9.2f}% {str(r['profit_factor']):>6} {r['avg_return']:>+7.2f}%")

    print("-" * 80)
    print(f"\n🏆 BEST STRATEGY: {sorted_results[0]['name']}")
    print(f"   Win Rate: {sorted_results[0]['win_rate']:.1f}%")
    print(f"   Net P/L: {sorted_results[0]['net_pl']:+.2f}%")
    print(f"   Profit Factor: {sorted_results[0]['profit_factor']}")

    # Save results to JSON
    results_path = _PROJECT_ROOT / 'vps-service' / 'scripts' / 'optimization_results.json'
    with open(results_path, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'experiments': sorted_results,
        }, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Results saved to: {results_path}")

    return sorted_results


if __name__ == '__main__':
    run_optimization()
