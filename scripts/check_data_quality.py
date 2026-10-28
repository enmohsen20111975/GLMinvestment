#!/usr/bin/env python3
"""
check_data_quality.py — فحص جودة البيانات في stocks.db
==========================================================
بيشوف:
  1. كم سهم ليهم بيانات حقيقية (أسعار متغيرة)
  2. كم سهم "flat" (سعر ثابت لـ 60 يوم = بيانات ميتة)
  3. كم سهم فيه volume حقيقي
  4. الأسهم اللي الـ V3 predictor هيحللها بجد (مفيهاش بيانات كافية)

Usage:
    python3 scripts/check_data_quality.py
    python3 scripts/check_data_quality.py --market EGX
    python3 scripts/check_data_quality.py --market TADAWUL --verbose
"""
import sqlite3
import argparse
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'


def check_market(market: str, verbose: bool = False):
    """فحص جودة البيانات لسوق معين."""
    if not STOCKS_DB.exists():
        print(f'❌ stocks.db مش موجود في: {STOCKS_DB}')
        return
    
    conn = sqlite3.connect(str(STOCKS_DB))
    
    print(f'\n{"="*60}')
    print(f'  فحص جودة البيانات — {market}')
    print(f'  DB: {STOCKS_DB}')
    print(f'  Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'{"="*60}\n')
    
    # 1. إحصائيات عامة
    print('📊 إحصائيات عامة:')
    total_stocks = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE market = ? AND is_active = 1", (market,)
    ).fetchone()[0]
    
    stocks_with_history = conn.execute("""
        SELECT COUNT(DISTINCT s.ticker) 
        FROM stocks s 
        INNER JOIN stock_daily_prices p ON s.ticker = p.ticker 
        WHERE s.market = ? AND s.is_active = 1
    """, (market,)).fetchone()[0]
    
    total_price_rows = conn.execute("""
        SELECT COUNT(*) FROM stock_daily_prices p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE s.market = ?
    """, (market,)).fetchone()[0]
    
    print(f'  - أسهم نشطة في {market}: {total_stocks}')
    print(f'  - أسهم ليها تاريخ أسعار: {stocks_with_history}')
    print(f'  - إجمالي صفوف الأسعار: {total_price_rows}')
    print(f'  - متوسط الأيام لكل سهم: {total_price_rows / stocks_with_history:.1f}' if stocks_with_history > 0 else '  - مفيش بيانات')
    
    # 2. الأسهم الـ flat (سعر ثابت)
    print(f'\n🔴 الأسهم "الميتة" (سعر ثابت لكل الأيام):')
    flat_stocks = conn.execute("""
        SELECT p.ticker, COUNT(*) as days, MIN(p.close_price) as min_p, MAX(p.close_price) as max_p,
               AVG(p.volume) as avg_vol
        FROM stock_daily_prices p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE s.market = ?
        GROUP BY p.ticker
        HAVING min_p = max_p
        ORDER BY days DESC
    """, (market,)).fetchall()
    
    print(f'  - عدد الأسهم flat: {len(flat_stocks)}')
    if verbose and flat_stocks:
        print(f'  - أمثلة (أول 20):')
        for r in flat_stocks[:20]:
            print(f'      {r[0]}: {r[1]} يوم، سعر = {r[2]}, avg_vol = {r[4]:.0f}')
    
    # 3. الأسهم اللي فيها volume = 0
    print(f'\n⚠️  أسهم بـ volume = 0:')
    zero_vol = conn.execute("""
        SELECT COUNT(DISTINCT p.ticker)
        FROM stock_daily_prices p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE s.market = ? AND p.volume = 0
    """, (market,)).fetchone()[0]
    print(f'  - أسهم بـ volume = 0: {zero_vol}')
    
    # 4. الأسهم اللي بياناتها كويسة (حركة + volume)
    print(f'\n✅ أسهم ببيانات كويسة (10+ أسعار مختلفة + تذبذب 5-100%):')
    good_stocks = conn.execute("""
        SELECT p.ticker, COUNT(*) as days, 
               MIN(p.close_price) as min_p, MAX(p.close_price) as max_p,
               COUNT(DISTINCT p.close_price) as unique_prices,
               AVG(p.volume) as avg_vol
        FROM stock_daily_prices p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE s.market = ?
        GROUP BY p.ticker
        HAVING unique_prices >= 10 
           AND min_p > 0 
           AND min_p != max_p
           AND (MAX(p.close_price) - MIN(p.close_price)) / MIN(p.close_price) BETWEEN 0.05 AND 1.0
        ORDER BY unique_prices DESC
    """, (market,)).fetchall()
    
    print(f'  - عدد الأسهم الكويسة: {len(good_stocks)}')
    if good_stocks:
        print(f'  - أمثلة (أول 10):')
        for r in good_stocks[:10]:
            range_pct = (r[3] - r[2]) / r[2] * 100 if r[2] > 0 else 0
            print(f'      {r[0]}: {r[1]} يوم | {r[4]} سعر مختلف | range={range_pct:.1f}% | avg_vol={r[5]:.0f}')
    
    # 5. الأسهم اللي الـ V3 predictor مفروض يحللها
    print(f'\n🎯 الأسهم اللي الـ V3 هيحللها بجد (أسعار متغيرة + volume > 0):')
    analyzable = conn.execute("""
        SELECT COUNT(DISTINCT p.ticker)
        FROM stock_daily_prices p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE s.market = ?
          AND p.volume > 0
          AND p.ticker IN (
            SELECT ticker FROM stock_daily_prices 
            WHERE ticker IN (SELECT ticker FROM stocks WHERE market = ?)
            GROUP BY ticker 
            HAVING COUNT(DISTINCT close_price) >= 5
          )
    """, (market, market)).fetchone()[0]
    print(f'  - أسهم قابلة للتحليل: {analyzable}')
    
    # 6. ملخص نهائي
    print(f'\n{"="*60}')
    print(f'  الملخص — {market}')
    print(f'{"="*60}')
    print(f'  إجمالي الأسهم النشطة:     {total_stocks}')
    print(f'  أسهم ليها تاريخ:         {stocks_with_history}')
    print(f'  أسهم flat (ميتة):        {len(flat_stocks)} ({len(flat_stocks)*100//max(stocks_with_history,1)}%)')
    print(f'  أسهم بـ volume = 0:       {zero_vol}')
    print(f'  أسهم ببيانات كويسة:      {len(good_stocks)}')
    print(f'  أسهم قابلة للتحليل:      {analyzable}')
    print(f'{"="*60}')
    
    if len(flat_stocks) > stocks_with_history * 0.3:
        print(f'\n⚠️  تحذير: {len(flat_stocks)*100//max(stocks_with_history,1)}% من الأسهم بياناتها flat!')
        print(f'  ده معناه إن الـ V3 predictor مش هيلاقي حاجة يحللها في معظم الأسهم.')
        print(f'  محتاجين نـ sync الأسعار من مصدر موثوق.')
    
    conn.close()


def main():
    parser = argparse.ArgumentParser(description='فحص جودة البيانات في stocks.db')
    parser.add_argument('--market', default='ALL', 
                        choices=['ALL', 'EGX', 'TADAWUL', 'KSE', 'QSE', 'US'],
                        help='السوق المراد فحصه (default: ALL)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='اطبع كل الأسهم الـ flat')
    args = parser.parse_args()
    
    if args.market == 'ALL':
        for m in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']:
            check_market(m, args.verbose)
    else:
        check_market(args.market, args.verbose)


if __name__ == '__main__':
    main()
