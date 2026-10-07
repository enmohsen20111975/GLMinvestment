#!/usr/bin/env python3
"""
Comparison Report: Crypto vs EGX
================================
تقرير مقارنة بين الكريبتو والبورصة المصرية
"""

import json
from datetime import datetime
from pathlib import Path

# Results
EGX_RESULTS = {
    "period": "2025-04-01 to 2025-05-20",
    "total_trades": 9,
    "winning_trades": 5,
    "losing_trades": 4,
    "win_rate": 55.6,
    "avg_win_pct": 6.45,
    "avg_loss_pct": -7.79,
    "total_pnl_pct": 0.09,
    "initial_capital": 100000,
    "final_capital": 100089.33,
    "stop_loss_pct": 8.0,
    "target_pct": 10.0,
    "time_stop_days": 15,
    "min_adx": 20.0
}

CRYPTO_RESULTS = {
    "period": "2026-01-01 to 2026-03-01",
    "total_trades": 9,
    "winning_trades": 3,
    "losing_trades": 6,
    "win_rate": 33.3,
    "avg_win_pct": 3.39,
    "avg_loss_pct": -9.51,
    "total_pnl_pct": -4.69,
    "initial_capital": 100000,
    "final_capital": 95313.21,
    "max_drawdown_pct": 5.65,
    "stop_loss_pct": 15.0,
    "target_pct": 25.0,
    "time_stop_days": 7,
    "min_adx": 30.0
}

def generate_comparison():
    """إنشاء تقرير المقارنة"""
    
    report = {
        "timestamp": datetime.now().isoformat(),
        "title": "Crypto vs EGX Strategy Comparison",
        "summary": {
            "egx": {
                "period": EGX_RESULTS["period"],
                "total_trades": EGX_RESULTS["total_trades"],
                "win_rate": EGX_RESULTS["win_rate"],
                "total_pnl_pct": EGX_RESULTS["total_pnl_pct"],
                "avg_win_pct": EGX_RESULTS["avg_win_pct"],
                "avg_loss_pct": EGX_RESULTS["avg_loss_pct"],
                "final_capital": EGX_RESULTS["final_capital"]
            },
            "crypto": {
                "period": CRYPTO_RESULTS["period"],
                "total_trades": CRYPTO_RESULTS["total_trades"],
                "win_rate": CRYPTO_RESULTS["win_rate"],
                "total_pnl_pct": CRYPTO_RESULTS["total_pnl_pct"],
                "avg_win_pct": CRYPTO_RESULTS["avg_win_pct"],
                "avg_loss_pct": CRYPTO_RESULTS["avg_loss_pct"],
                "max_drawdown_pct": CRYPTO_RESULTS["max_drawdown_pct"],
                "final_capital": CRYPTO_RESULTS["final_capital"]
            }
        },
        "comparison": {
            "better_market": "EGX" if EGX_RESULTS["win_rate"] > CRYPTO_RESULTS["win_rate"] else "Crypto",
            "win_rate_diff": round(EGX_RESULTS["win_rate"] - CRYPTO_RESULTS["win_rate"], 1),
            "pnl_diff": round(EGX_RESULTS["total_pnl_pct"] - CRYPTO_RESULTS["total_pnl_pct"], 2),
            "risk_reward_egx": round(abs(EGX_RESULTS["target_pct"]) / abs(EGX_RESULTS["stop_loss_pct"]), 2),
            "risk_reward_crypto": round(abs(CRYPTO_RESULTS["target_pct"]) / abs(CRYPTO_RESULTS["stop_loss_pct"]), 2)
        },
        "parameters": {
            "egx": {
                "stop_loss_pct": EGX_RESULTS["stop_loss_pct"],
                "target_pct": EGX_RESULTS["target_pct"],
                "time_stop_days": EGX_RESULTS["time_stop_days"],
                "min_adx": EGX_RESULTS["min_adx"]
            },
            "crypto": {
                "stop_loss_pct": CRYPTO_RESULTS["stop_loss_pct"],
                "target_pct": CRYPTO_RESULTS["target_pct"],
                "time_stop_days": CRYPTO_RESULTS["time_stop_days"],
                "min_adx": CRYPTO_RESULTS["min_adx"]
            }
        },
        "analysis": {
            "winner": "EGX",
            "reasons": [
                "EGX Win Rate 55.6% > Crypto 33.3%",
                "EGX Total Return +0.09% > Crypto -4.69%",
                "EGX Better Risk/Reward Execution",
                "Crypto Hit Stop Loss More Frequently",
                "Crypto Time Stop Too Short (7 days)"
            ],
            "crypto_issues": [
                "Stop Loss 15% too wide - price swings trigger late",
                "Target 25% too ambitious - rarely hit",
                "Time Stop 7 days too short - positions closed before recovery",
                "ADX > 30 too strict - fewer valid entries"
            ],
            "recommendations": [
                "For Crypto: Reduce Stop Loss to 10%, Target to 15%, Time Stop to 14 days",
                "For EGX: Continue with current parameters (Win Rate > 50%)",
                "Both markets need different strategies - not one-size-fits-all",
                "Consider adding News Context for Crypto (SEC, Regulations)"
            ]
        },
        "conclusion": {
            "status": "NEITHER_MARKET_MEETS_CRITERIA",
            "criteria": "Win Rate > 50%",
            "egx_meets_criteria": True,  # 55.6% > 50%
            "crypto_meets_criteria": False,  # 33.3% < 50%
            "next_steps": [
                "EGX: Ready for Paper Trading (Win Rate 55.6%)",
                "Crypto: Needs parameter tuning before deployment",
                "Suggested: Reduce Crypto Stop Loss to 10%, increase Time Stop to 14 days"
            ]
        }
    }
    
    return report

def print_report(report):
    """طباعة التقرير"""
    print("=" * 70)
    print("📊 CRYPTO vs EGX COMPARISON REPORT")
    print("=" * 70)
    print()
    
    print("┌─────────────────────────────────────────────────────────────────┐")
    print("│                    📈 PERFORMANCE SUMMARY                       │")
    print("├─────────────────────┬───────────────────┬───────────────────────┤")
    print("│ Metric              │ EGX               │ Crypto                │")
    print("├─────────────────────┼───────────────────┼───────────────────────┤")
    print(f"│ Period              │ {report['summary']['egx']['period']:<17} │ {report['summary']['crypto']['period']:<21} │")
    print(f"│ Total Trades        │ {report['summary']['egx']['total_trades']:<17} │ {report['summary']['crypto']['total_trades']:<21} │")
    print(f"│ Win Rate            │ {report['summary']['egx']['win_rate']}%{' '*12} │ {report['summary']['crypto']['win_rate']}%{' '*16} │")
    print(f"│ Total Return        │ {report['summary']['egx']['total_pnl_pct']:+.2f}%{' '*12} │ {report['summary']['crypto']['total_pnl_pct']:+.2f}%{' '*16} │")
    print(f"│ Avg Win             │ +{report['summary']['egx']['avg_win_pct']:.2f}%{' '*12} │ +{report['summary']['crypto']['avg_win_pct']:.2f}%{' '*17} │")
    print(f"│ Avg Loss            │ {report['summary']['egx']['avg_loss_pct']:.2f}%{' '*13} │ {report['summary']['crypto']['avg_loss_pct']:.2f}%{' '*18} │")
    print(f"│ Final Capital       │ ${report['summary']['egx']['final_capital']:,.0f}{' '*8} │ ${report['summary']['crypto']['final_capital']:,.0f}{' '*12} │")
    print("└─────────────────────┴───────────────────┴───────────────────────┘")
    
    print()
    print("┌─────────────────────────────────────────────────────────────────┐")
    print("│                    📋 PARAMETERS USED                           │")
    print("├─────────────────────┬───────────────────┬───────────────────────┤")
    print("│ Parameter           │ EGX               │ Crypto                │")
    print("├─────────────────────┼───────────────────┼───────────────────────┤")
    print(f"│ Stop Loss           │ {report['parameters']['egx']['stop_loss_pct']}%{' '*14} │ {report['parameters']['crypto']['stop_loss_pct']}%{' '*18} │")
    print(f"│ Target              │ {report['parameters']['egx']['target_pct']}%{' '*15} │ {report['parameters']['crypto']['target_pct']}%{' '+18*' '}│")
    print(f"│ Time Stop           │ {report['parameters']['egx']['time_stop_days']} days{' '*11} │ {report['parameters']['crypto']['time_stop_days']} days{' '+15*' '}│")
    print(f"│ Min ADX             │ {report['parameters']['egx']['min_adx']}{' '*15} │ {report['parameters']['crypto']['min_adx']}{' '+19*' '}│")
    print("└─────────────────────┴───────────────────┴───────────────────────┘")
    
    print()
    print("=" * 70)
    print("📊 ANALYSIS")
    print("=" * 70)
    print()
    print(f"🏆 WINNER: {report['comparison']['better_market']}")
    print(f"   Win Rate Difference: {report['comparison']['win_rate_diff']}% in favor of {report['comparison']['better_market']}")
    print()
    print("❌ CRYPTO ISSUES:")
    for issue in report['analysis']['crypto_issues']:
        print(f"   • {issue}")
    print()
    print("✅ RECOMMENDATIONS:")
    for rec in report['analysis']['recommendations']:
        print(f"   • {rec}")
    
    print()
    print("=" * 70)
    print("📊 CONCLUSION")
    print("=" * 70)
    print()
    print(f"EGX Win Rate: {report['summary']['egx']['win_rate']}% {'✅ PASS (>50%)' if report['conclusion']['egx_meets_criteria'] else '❌ FAIL'}")
    print(f"Crypto Win Rate: {report['summary']['crypto']['win_rate']}% {'✅ PASS (>50%)' if report['conclusion']['crypto_meets_criteria'] else '❌ FAIL'}")
    print()
    print("NEXT STEPS:")
    for step in report['conclusion']['next_steps']:
        print(f"   → {step}")
    
    print()
    print("=" * 70)
    
    return report

def main():
    report = generate_comparison()
    
    # Print report
    print_report(report)
    
    # Save report (relative path)
    _project_root = Path(__file__).resolve().parent.parent.parent
    output_dir = _project_root / 'simulation_results'
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / 'comparison_report.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print(f"\n📄 Report saved: {output_path}")

if __name__ == "__main__":
    main()
