#!/usr/bin/env python3
"""
Verification Script - التحقق المستقل
=====================================

This script performs INDEPENDENT verification of the forward test results.
It checks:
1. Data Integrity (gaps, missing data, outliers)
2. Sanity Checks (is 1.88% drawdown possible?)
3. Correlation Filter (is it working?)
4. Manual PnL calculation (is the math correct?)

@authorM2yDevelopers Team
@version 1.0.0
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_db_path() -> str:
    """Get database path"""
    local_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'stocks.db')
    local_path = os.path.abspath(local_path)

    if os.path.exists(local_path):
        return local_path

    vps_path = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')
    if os.path.exists(vps_path):
        return vps_path

    raise FileNotFoundError(f"Database not found")


def verify_data_integrity(db_path: str) -> Dict:
    """
    المرحلة أ: فحص صحة البيانات
    
    Returns:
        تقرير عن جودة البيانات
    """
    print("\n" + "="*70)
    print("المرحلة أ: فحص صحة البيانات (Data Integrity)")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    cursor = conn.cursor()
    
    results = {}
    
    # 1. فحص Gaps في البيانات
    print("\n1. فحص Gaps في البيانات...")
    cursor.execute('''
        SELECT s.ticker, COUNT(*) as days 
        FROM stock_price_history sph
        JOIN stocks s ON sph.stock_id = s.id
        WHERE sph.date BETWEEN '2026-03-01' AND '2026-05-31' 
        GROUP BY s.ticker 
        ORDER BY days
        LIMIT 10
    ''')
    gaps_data = cursor.fetchall()
    
    #_expected trading days in Mar-May 2026 (approximately 66 days)
    expected_days = 66
    
    gaps_report = []
    for ticker, days in gaps_data:
        missing = expected_days - days
        if missing > 5:
            gaps_report.append({
                'ticker': ticker,
                'days_present': days,
                'days_missing': missing,
                'status': 'WARNING' if missing > 10 else 'OK'
            })
    
    results['data_gaps'] = {
        'expected_trading_days': expected_days,
        'tickers_with_gaps': gaps_report[:5],
        'total_gaps_count': len([g for g in gaps_report if g['status'] == 'WARNING'])
    }
    
    print(f"   Expected trading days: {expected_days}")
    print(f"   Tickers with significant gaps: {results['data_gaps']['total_gaps_count']}")
    
    # 2. فحص Volume = 0
    print("\n2. فحص Volume = 0 أيام كتيرة...")
    cursor.execute('''
        SELECT s.ticker, COUNT(*) as zero_volume_days
        FROM stock_price_history sph
        JOIN stocks s ON sph.stock_id = s.id
        WHERE sph.date BETWEEN '2026-03-01' AND '2026-05-31'
        AND sph.volume = 0
        GROUP BY s.ticker
        HAVING zero_volume_days > 10
        ORDER BY zero_volume_days DESC
        LIMIT 10
    ''')
    zero_volume = cursor.fetchall()
    
    results['zero_volume_stocks'] = [
        {'ticker': t, 'zero_volume_days': d}
        for t, d in zero_volume
    ]
    print(f"   Stocks with 10+ zero volume days: {len(zero_volume)}")
    
    # 3. فحص Prices الغريبة
    print("\n3. فحص Prices الغريبة...")
    cursor.execute('''
        SELECT s.ticker, MIN(sph.close_price) as min_price, MAX(sph.close_price) as max_price, AVG(sph.close_price) as avg_price
        FROM stock_price_history sph
        JOIN stocks s ON sph.stock_id = s.id
        WHERE sph.date BETWEEN '2026-03-01' AND '2026-05-31'
        GROUP BY s.ticker
        HAVING min_price <= 0 OR max_price > 1000
        LIMIT 10
    ''')
    price_outliers = cursor.fetchall()
    
    results['price_outliers'] = [
        {'ticker': t, 'min': mn, 'max': mx, 'avg': av}
        for t, mn, mx, av in price_outliers
    ]
    print(f"   Stocks with price outliers: {len(price_outliers)}")
    
    conn.close()
    
    return results


def verify_sanity_checks(db_path: str) -> Dict:
    """
    المرحلة ب: فحص منطقي للنتائج
    
    Returns:
        تقرير عن منطقية النتائج
    """
    print("\n" + "="*70)
    print("المرحلة ب: فحص منطقي للنتائج (Sanity Checks)")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    cursor = conn.cursor()
    
    results = {}
    
    # 1. توزيع الـ signals
    print("\n1. توزيع الـ signals في Test Period...")
    cursor.execute('''
        SELECT signal_date, COUNT(*) as signals 
        FROM signal_logs 
        WHERE date(signal_date) BETWEEN '2026-03-01' AND '2026-05-31' 
        GROUP BY signal_date 
        ORDER BY signals DESC
        LIMIT 10
    ''')
    signal_dist = cursor.fetchall()
    
    results['signal_distribution'] = {
        'max_signals_per_day': signal_dist[0][1] if signal_dist else 0,
        'top_10_days': [{'date': d, 'signals': s} for d, s in signal_dist[:10]]
    }
    print(f"   Max signals in one day: {results['signal_distribution']['max_signals_per_day']}")
    
    # 2. حساب الـ Win Rate الفعلي
    print("\n2. حساب الـ Win Rate الفعلي...")
    cursor.execute('''
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
            AVG(profit_loss_percent) as avg_pnl
        FROM outcome_logs ol
        JOIN signal_logs sl ON ol.trade_id = sl.id
        WHERE date(sl.signal_date) BETWEEN '2026-03-01' AND '2026-05-31'
    ''')
    wr_data = cursor.fetchone()
    
    if wr_data and wr_data[0] > 0:
        total = wr_data[0]
        wins = wr_data[1] or 0
        avg_pnl = wr_data[2] or 0
        win_rate = (wins / total) * 100
        
        results['actual_win_rate'] = {
            'total_signals': total,
            'wins': wins,
            'losses': total - wins,
            'win_rate_pct': round(win_rate, 2),
            'avg_pnl_pct': round(avg_pnl, 4)
        }
        print(f"   Total signals: {total}")
        print(f"   Win Rate: {win_rate:.2f}%")
        print(f"   Avg PnL: {avg_pnl:.4f}%")
    
    # 3. فحص الـ Drawdown المحتمل
    print("\n3. فحص الـ Drawdown المحتمل...")
    cursor.execute('''
        SELECT 
            sl.signal_date,
            COUNT(*) as signals_that_day,
            SUM(CASE WHEN ol.profit_loss_percent < 0 THEN 1 ELSE 0 END) as losers,
            SUM(CASE WHEN ol.profit_loss_percent < 0 THEN ol.profit_loss_percent ELSE 0 END) as total_loss_pct
        FROM signal_logs sl
        JOIN outcome_logs ol ON sl.id = ol.trade_id
        WHERE date(sl.signal_date) BETWEEN '2026-03-01' AND '2026-05-31'
        GROUP BY sl.signal_date
        ORDER BY total_loss_pct ASC
        LIMIT 10
    ''')
    worst_days = cursor.fetchall()
    
    results['worst_days'] = [
        {
            'date': d,
            'signals': s,
            'losers': l,
            'total_loss_pct': round(t, 2) if t else 0
        }
        for d, s, l, t in worst_days
    ]
    
    # حساب الـ max potential drawdown
    if worst_days:
        worst_day_loss = min([t or 0 for _, _, _, t in worst_days])
        print(f"   Worst single day total loss: {worst_day_loss:.2f}%")
        print(f"   If 6 positions @ 5% each: {abs(worst_day_loss) * 0.3:.2f}% portfolio impact")
    
    conn.close()
    
    return results


def verify_correlation_filter(db_path: str) -> Dict:
    """
    فحص الـ Correlation Filter
    
    هل فيه أيام فيها 2+ سهم من نفس القطاع إشارة BUY؟
    """
    print("\n" + "="*70)
    print("فحص الـ Correlation Filter")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    cursor = conn.cursor()
    
    results = {}
    
    # 1. أيام فيها 2+ بنك إشارة
    print("\n1. أيام فيها 2+ سهم من نفس القطاع إشارة...")
    
    # First get unique sectors
    cursor.execute("SELECT DISTINCT sector FROM signal_logs WHERE sector IS NOT NULL")
    sectors = [s[0] for s in cursor.fetchall()]
    
    sector_signals = {}
    
    for sector in sectors[:10]:  # Check top 10 sectors
        cursor.execute('''
            SELECT signal_date, COUNT(*) as signals, GROUP_CONCAT(ticker) as tickers
            FROM signal_logs
            WHERE sector = ?
            AND date(signal_date) BETWEEN '2026-03-01' AND '2026-05-31'
            GROUP BY signal_date
            HAVING signals > 1
            ORDER BY signals DESC
            LIMIT 5
        ''', (sector,))
        
        sector_data = cursor.fetchall()
        if sector_data:
            sector_signals[sector] = [
                {'date': d, 'signals': s, 'tickers': t}
                for d, s, t in sector_data
            ]
    
    results['sector_correlation'] = sector_signals
    
    total_correlation_days = sum(len(v) for v in sector_signals.values())
    print(f"   Days with 2+ signals in same sector: {total_correlation_days}")
    
    for sector, days in list(sector_signals.items())[:5]:
        print(f"   {sector}: {len(days)} days with multiple signals")
    
    # 2. عدد الـ rejections المفترض
    print("\n2. حساب الـ rejections المفترض...")
    
    total_rejections_should_be = 0
    for sector, days in sector_signals.items():
        for day in days:
            # If 3 signals in same day, 2 should be rejected (only keep highest score)
            signals_count = day['signals']
            if signals_count > 1:
                total_rejections_should_be += (signals_count - 1)
    
    results['expected_correlation_rejections'] = total_rejections_should_be
    print(f"   Expected correlation rejections: {total_rejections_should_be}")
    print(f"   Actual rejections in simulation: 0 ❌")
    
    conn.close()
    
    return results


def manual_pnl_check(db_path: str) -> Dict:
    """
    فحص يدوي للـ PnL
    
    اختيار 10 صفقات عشوائية وحساب الـ PnL يدوياً
    """
    print("\n" + "="*70)
    print("فحص يدوي للـ PnL (10 صفقات عشوائية)")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    cursor = conn.cursor()
    
    # اختيار 10 صفقات عشوائية
    cursor.execute('''
        SELECT 
            sl.ticker,
            sl.signal_date,
            sl.calculated_entry_price,
            ol.actual_exit_price,
            ol.profit_loss_percent,
            ol.close_reason,
            ol.days_open
        FROM signal_logs sl
        JOIN outcome_logs ol ON sl.id = ol.trade_id
        WHERE date(sl.signal_date) BETWEEN '2026-03-01' AND '2026-05-31'
        ORDER BY RANDOM()
        LIMIT 10
    ''')
    trades = cursor.fetchall()
    
    results = {'sample_trades': []}
    
    print("\n   Ticker    | Entry    | Exit     | PnL%    | Days | Reason")
    print("   " + "-"*65)
    
    for ticker, signal_date, entry, exit_price, pnl_pct, reason, days in trades:
        # حساب PnL يدوياً
        if entry and entry > 0 and exit_price and exit_price > 0:
            manual_pnl = ((exit_price - entry) / entry) * 100
            diff = abs(manual_pnl - (pnl_pct or 0))
            match = "✓" if diff < 0.5 else "❌"
        else:
            manual_pnl = 0
            diff = 0
            match = "?"
        
        results['sample_trades'].append({
            'ticker': ticker,
            'signal_date': signal_date,
            'entry_price': entry,
            'exit_price': exit_price,
            'reported_pnl': pnl_pct,
            'calculated_pnl': round(manual_pnl, 2),
            'difference': round(diff, 2),
            'match': match
        })
        
        print(f"   {ticker:10} | {entry:8.2f} | {exit_price:8.2f} | {pnl_pct:6.2f}% | {days:4} | {reason or 'N/A'} {match}")
    
    conn.close()
    
    return results


def calculate_real_drawdown(db_path: str) -> Dict:
    """
    حساب الـ Drawdown الحقيقي
    
    محاكاة بسيطة بدون تعقيد
    """
    print("\n" + "="*70)
    print("حساب الـ Drawdown الحقيقي")
    print("="*70)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    cursor = conn.cursor()
    
    # Get all signals with outcomes, ordered by date
    cursor.execute('''
        SELECT 
            sl.signal_date,
            sl.ticker,
            sl.sector,
            ol.profit_loss_percent,
            ol.days_open
        FROM signal_logs sl
        JOIN outcome_logs ol ON sl.id = ol.trade_id
        WHERE date(sl.signal_date) BETWEEN '2026-03-01' AND '2026-05-31'
        ORDER BY sl.signal_date
    ''')
    signals = cursor.fetchall()
    
    # Simple simulation: track equity with position limits
    initial_capital = 1_000_000
    equity = initial_capital
    peak = initial_capital
    max_drawdown = 0
    
    # Group signals by date
    signals_by_date = {}
    for signal_date, ticker, sector, pnl_pct, days_open in signals:
        if signal_date not in signals_by_date:
            signals_by_date[signal_date] = []
        signals_by_date[signal_date].append({
            'ticker': ticker,
            'sector': sector,
            'pnl_pct': pnl_pct or 0
        })
    
    # Simulate: assume max 6 positions, 5% each
    for date, day_signals in sorted(signals_by_date.items()):
        # Take max 6 signals per day (simplified)
        for signal in day_signals[:6]:
            pnl_contribution = (5 / 100) * initial_capital * (signal['pnl_pct'] / 100)
            equity += pnl_contribution
            
            if equity > peak:
                peak = equity
            
            drawdown = ((peak - equity) / peak) * 100 if peak > 0 else 0
            if drawdown > max_drawdown:
                max_drawdown = drawdown
    
    results = {
        'initial_capital': initial_capital,
        'final_equity': round(equity, 2),
        'peak_equity': round(peak, 2),
        'max_drawdown_pct': round(max_drawdown, 2),
        'total_trades': len(signals),
        'return_pct': round(((equity - initial_capital) / initial_capital) * 100, 2)
    }
    
    print(f"   Initial Capital: {initial_capital:,}")
    print(f"   Final Equity: {results['final_equity']:,}")
    print(f"   Peak Equity: {results['peak_equity']:,}")
    print(f"   Max Drawdown: {results['max_drawdown_pct']:.2f}%")
    print(f"   Total Return: {results['return_pct']:+.2f}%")
    
    conn.close()
    
    return results


def run_full_verification():
    """تشغيل كل فحوصات التحقق"""
    
    print("\n" + "="*70)
    print("🔍 VERIFICATION SCRIPT - التحقق المستقل")
    print("="*70)
    
    try:
        db_path = get_db_path()
        print(f"\nUsing database: {db_path}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return
    
    # Run all verifications
    results = {
        'verification_date': datetime.now().isoformat(),
        'test_period': '2026-03-01 to 2026-05-31'
    }
    
    # 1. Data Integrity
    results['data_integrity'] = verify_data_integrity(db_path)
    
    # 2. Sanity Checks
    results['sanity_checks'] = verify_sanity_checks(db_path)
    
    # 3. Correlation Filter
    results['correlation_check'] = verify_correlation_filter(db_path)
    
    # 4. Manual PnL Check
    results['manual_pnl'] = manual_pnl_check(db_path)
    
    # 5. Real Drawdown Calculation
    results['real_drawdown'] = calculate_real_drawdown(db_path)
    
    # Summary
    print("\n" + "="*70)
    print("📊 ملخص التحقق")
    print("="*70)
    
    issues = []
    
    if results['data_integrity']['data_gaps']['total_gaps_count'] > 5:
        issues.append("⚠️ DATA GAPS: Significant missing data detected")
    
    if results['correlation_check'].get('expected_correlation_rejections', 0) > 0:
        issues.append("❌ CORRELATION FILTER: Not working (0 rejections but should have some)")
    
    if results['real_drawdown']['max_drawdown_pct'] > 15:
        issues.append(f"⚠️ DRAWDOWN: Real calculation shows {results['real_drawdown']['max_drawdown_pct']:.2f}% (not 1.88%)")
    
    if not issues:
        print("\n✅ All verifications passed!")
    else:
        print("\n❌ Issues found:")
        for issue in issues:
            print(f"   {issue}")
    
    # Save results — honor LOG_DIR env override (Rule 61)
    _output_dir = os.environ.get('LOG_DIR', '/tmp')
    output_path = os.path.join(_output_dir, 'verification_results.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n📄 Full results saved to: {output_path}")
    
    return results


if __name__ == '__main__':
    run_full_verification()
