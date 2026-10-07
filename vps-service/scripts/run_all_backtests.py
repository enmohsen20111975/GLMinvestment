#!/usr/bin/env python3
"""
Run All Market Backtests - Multi-Market Analysis
تشغيل كل اختبارات الأسواق - تحليل متعدد الأسواق

This script runs backtests for all 5 markets and generates a summary report.
"""

import sys
import os
import json
from datetime import datetime
from pathlib import Path

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPTS_DIR))

# Import individual backtest functions
from backtest_egx import run_egx_backtest
from backtest_tadawul import run_tadawul_backtest
from backtest_kse import run_kse_backtest
from backtest_qse import run_qse_backtest
from backtest_crypto import run_crypto_backtest

OUTPUT_DIR = Path(__file__).parent.parent / 'backtest_results'
OUTPUT_DIR.mkdir(exist_ok=True)


def run_all_backtests():
    """
    Run all 5 market backtests and collect results.
    """
    print("\n" + "="*80)
    print("🚀 MULTI-MARKET BACKTEST - ALL 5 MARKETS")
    print("="*80)
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    results = {}
    
    # 1. EGX
    print("\n" + "-"*40)
    print("1️⃣ EGX (Egypt) - T+1 Strategy")
    print("-"*40)
    try:
        results['EGX'] = run_egx_backtest()
    except Exception as e:
        print(f"❌ EGX Error: {e}")
        results['EGX'] = {'status': 'ERROR', 'error': str(e)}
    
    # 2. TADAWUL
    print("\n" + "-"*40)
    print("2️⃣ TADAWUL (Saudi) - T+1 + Swing Strategy")
    print("-"*40)
    try:
        results['TADAWUL'] = run_tadawul_backtest()
    except Exception as e:
        print(f"❌ TADAWUL Error: {e}")
        results['TADAWUL'] = {'status': 'ERROR', 'error': str(e)}
    
    # 3. KSE
    print("\n" + "-"*40)
    print("3️⃣ KSE (Kuwait) - Swing Strategy")
    print("-"*40)
    try:
        results['KSE'] = run_kse_backtest()
    except Exception as e:
        print(f"❌ KSE Error: {e}")
        results['KSE'] = {'status': 'ERROR', 'error': str(e)}
    
    # 4. QSE
    print("\n" + "-"*40)
    print("4️⃣ QSE (Qatar) - Swing Selective Strategy")
    print("-"*40)
    try:
        results['QSE'] = run_qse_backtest()
    except Exception as e:
        print(f"❌ QSE Error: {e}")
        results['QSE'] = {'status': 'ERROR', 'error': str(e)}
    
    # 5. Crypto
    print("\n" + "-"*40)
    print("5️⃣ Crypto - Breakout Strategy")
    print("-"*40)
    try:
        results['Crypto'] = run_crypto_backtest()
    except Exception as e:
        print(f"❌ Crypto Error: {e}")
        results['Crypto'] = {'status': 'ERROR', 'error': str(e)}
    
    # ==================== SUMMARY ====================
    
    print("\n" + "="*80)
    print("📊 SUMMARY REPORT - ALL MARKETS")
    print("="*80)
    
    summary_table = []
    
    for market, data in results.items():
        if data is None:
            summary_table.append({
                'market': market,
                'strategy': 'N/A',
                'trades': 0,
                'win_rate': 0.0,
                'realistic_pnl': 0.0,
                'status': 'NO_DATA',
                'decision': 'SKIP'
            })
            continue
        
        summary_table.append({
            'market': market,
            'strategy': data.get('strategy', 'N/A'),
            'trades': data.get('total_trades', 0),
            'win_rate': data.get('win_rate', 0.0),
            'realistic_pnl': data.get('realistic_pnl', 0.0),
            'status': data.get('status', 'UNKNOWN'),
            'decision': data.get('decision', 'SKIP')
        })
    
    # Print table
    print("\n| {:^10} | {:^15} | {:^7} | {:^8} | {:^10} | {:^12} |".format(
        "السوق", "الاستراتيجية", "الصفقات", "Win Rate", "P&L واقعي", "القرار"
    ))
    print("|" + "-"*12 + "|" + "-"*17 + "|" + "-"*9 + "|" + "-"*10 + "|" + "-"*12 + "|" + "-"*14 + "|")
    
    for row in summary_table:
        status_icon = {
            'SUCCESS': '✅',
            'NEEDS_TUNING': '⚠️',
            'FAILED': '❌',
            'DRY_MARKET': '🏜️',
            'LOW_LIQUIDITY': '🏜️',
            'ERROR': '❌',
            'NO_DATA': '❓'
        }.get(row['status'], '❓')
        
        print("| {:^10} | {:^15} | {:^7} | {:^6.1f}% | {:^+9.2f}% | {:^12} |".format(
            row['market'],
            row['strategy'][:15],
            row['trades'],
            row['win_rate'],
            row['realistic_pnl'],
            row['decision']
        ) + f" {status_icon}")
    
    # Save combined results
    final_report = {
        'generated_at': datetime.now().isoformat(),
        'period': '2025-04-01 to 2025-05-31',
        'markets': results,
        'summary': summary_table
    }
    
    output_path = OUTPUT_DIR / 'all_markets_summary.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(final_report, f, indent=2, ensure_ascii=False)
    
    print("\n" + "="*80)
    print(f"📁 Full report saved to: {output_path}")
    print(f"📅 Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80 + "\n")
    
    return final_report


if __name__ == '__main__':
    report = run_all_backtests()
    
    # Print final decision
    print("\n" + "="*80)
    print("🎯 FINAL DECISIONS")
    print("="*80)
    
    for market, data in report.get('markets', {}).items():
        if data is None:
            continue
        decision = data.get('decision', 'SKIP')
        status = data.get('status', 'UNKNOWN')
        
        if decision == 'CONTINUE':
            print(f"✅ {market}: نكمل - الاستراتيجية ناجحة")
        elif decision == 'ADJUST_PARAMS':
            print(f"⚠️ {market}: نعدل المعاملات - يحتاج تحسين")
        elif decision == 'TRY_BUY_DIP':
            print(f"🔄 {market}: نجرب Buy Dip بدل Breakout")
        else:
            print(f"❌ {market}: نوقف - الاستراتيجية فشلت")
    
    print("="*80 + "\n")
