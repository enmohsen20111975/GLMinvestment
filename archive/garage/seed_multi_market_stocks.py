#!/usr/bin/env python3
"""
Multi-Market Stock Seeder
=========================
سكريبت لإضافة أسهم الأسواق العربية إلى قاعدة البيانات

الأسواق المدعومة:
- TADAWUL (السعودية)
- KSE (الكويت)
- QSE (قطر)
- DFM (دبي)
- ADX (أبوظبي)

Usage:
    python scripts/seed_multi_market_stocks.py
"""

import sys
import os
import sqlite3
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import market data
from data.enhanced_multi_market import POPULAR_STOCKS, MARKET_CONFIG

# Market name mapping (code -> Arabic name used in DB)
MARKET_NAMES = {
    'EGX': 'مصر',
    'KSA': 'السعودية',  # TADAWUL
    'KSE': 'الكويت',
    'QSE': 'قطر',
    'DFM': 'الإمارات',  # Dubai
    'ADX': 'الإمارات',  # Abu Dhabi
    'BSE': 'البحرين',
}

# Stock names (ticker -> Arabic name)
STOCK_NAMES = {
    # السعودية - TADawul
    '1120': 'بنك الراجحي',
    '1180': 'البنك الأهلي السعودي',
    '1020': 'البنك السعودي البريطاني',
    '1060': 'البنك السعودي للاستثمار',
    '1210': 'بنك الرياض',
    '1150': 'البنك السعودي الأول',
    '2222': 'أرامكو السعودية',
    '2002': 'كيان السعودية',
    '2010': 'سابك',
    '2020': 'ينساب',
    '2380': 'الصناعات الكيماوية السعودية',
    '7010': 'الاتصالات السعودية',
    '8110': 'موبايلي',
    '7030': 'زين السعودية',
    '4160': 'جرير',
    '4170': 'العثيم ماركت',
    '4200': 'اكسترا',
    '4320': 'دار الأركان',
    '4150': 'إعمار المدينة الاقتصادية',
    '8070': 'بوبا العربية',
    '8010': 'التعاونية',
    '8080': 'الراجحي للتأمين التعاوني',
    '3040': 'أسمنت السعودية',
    '3050': 'أسمنت ينبع',
    '3060': 'أسمنت القصيم',
    '6010': 'المراعي',
    '6020': 'سافولا',
    '6030': 'الصافي دانون',
    
    # الكويت - KSE
    'BURG': 'بنك برقان',
    'MEEM': 'ميم',
    'KFI': 'بيت التمويل الكويتي',
    'ALKOUT': 'الكوت الصناعية',
    'AMERICANA': 'أمريكانا',
    'NATIONAL': 'البنك الكويتي الوطني',
    'GULF': 'بنك الخليج',
    'BOUBYAN': 'بنك بوبيان',
    'ZAIN': 'زين الكويت',
    'OOREDOO': 'أوريدو الكويت',
    'AAYAN': 'عيان للايجار والاستثمار',
    
    # قطر - QSE
    'QNB': 'البنك القطري',
    'INDUSTRY': 'صناعات قطر',
    'OOREDOO': 'أوريدو قطر',
    'COMMERCIAL': 'البنك التجاري القطري',
    'ISLAMIC': 'البنك الإسلامي القطري',
    'BARWA': 'بروة العقارية',
    'ZAD': 'زاد القابضة',
    'VODAFONE': 'فودافون قطر',
    'NAKILAT': 'ناقلات',
    'MANNAI': 'مناعي',
    'MASRAF': 'مصرف الريان',
    'QATAR': 'قطر للتأمين',
    'DOHA': 'بنك الدوحة',
    'ALKHALIJI': 'الخليجي',
    'QEWC': 'قطر للكهرباء والماء',
    'WOQOD': 'وقود',
    'EZDAN': 'إزدان',
    
    # دبي - DFM
    'DFM': 'سوق دبي المالي',
    'EMAAR': 'إعمار العقارية',
    'DIB': 'بنك دبي الإسلامي',
    'ARABTEC': 'عربتك',
    'DU': 'دو',
    'AIRARABIA': 'العربية للطيران',
    'DAMAC': 'داماك',
    'UNION': 'اتحاد الخصوصيات',
    'GULFNAV': 'الملاحة الخليجية',
    'SHUAA': 'شعاع كابيتال',
    'Deyaar': 'ديار',
    'AMAN': 'أمان',
    'TABREED': 'تبريد',
    'AJMANBANK': 'بنك عجمان',
    
    # أبوظبي - ADX
    'ADCB': 'بنك أبوظبي التجاري',
    'ADNOC': 'أدنوك للتوزيع',
    'ETISALAT': 'اتصالات',
    'FAB': 'بنك أبوظبي الأول',
    'ALDAR': 'الدار العقارية',
    'TAQA': 'طاقة',
    'ADNH': 'فنادق أبوظبي الوطنية',
    'Waha': 'واهة كابيتال',
    'RAKBANK': 'بنك رأس الخيمة',
    'DANA': 'دانة غاز',
    'AGTHIA': 'أغثية',
    'ARAM': 'أرامكس',
}

def get_db_path():
    """Get database path."""
    try:
        from config import DATABASE_PATH
        return DATABASE_PATH
    except ImportError:
        base_dir = Path(__file__).parent.parent.parent.resolve()
        return str(base_dir / 'db' / 'stocks.db')

def seed_stocks(market_code: str, dry_run: bool = False):
    """Seed stocks for a specific market."""
    db_path = get_db_path()
    
    if not os.path.exists(db_path):
        print(f"❌ Database not found: {db_path}")
        return 0
    
    market_name = MARKET_NAMES.get(market_code)
    if not market_name:
        print(f"❌ Unknown market: {market_code}")
        return 0
    
    tickers = POPULAR_STOCKS.get(market_code, [])
    if not tickers:
        print(f"❌ No stocks defined for {market_code}")
        return 0
    
    print(f"\n📊 Seeding {market_code} ({market_name}): {len(tickers)} stocks")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    inserted = 0
    updated = 0
    
    for ticker in tickers:
        name_ar = STOCK_NAMES.get(ticker, f'{ticker} - {market_name}')
        name_en = f"{ticker} - {MARKET_CONFIG.get(market_code, {}).get('name', market_code)}"
        
        # Check if exists
        cursor.execute('SELECT ticker FROM stocks WHERE ticker = ?', (ticker,))
        exists = cursor.fetchone()
        
        if exists:
            # Update market if needed
            cursor.execute('''
                UPDATE stocks SET market = ?, name = ?, name_ar = ?
                WHERE ticker = ? AND (market IS NULL OR market = '')
            ''', (market_name, name_en, name_ar, ticker))
            if cursor.rowcount > 0:
                updated += 1
        else:
            if dry_run:
                print(f"  Would insert: {ticker} - {name_ar}")
                inserted += 1
            else:
                # Insert new stock
                cursor.execute('''
                    INSERT INTO stocks (
                        ticker, name, name_ar, market, is_active,
                        current_price, previous_close, last_update
                    ) VALUES (?, ?, ?, ?, 1, NULL, NULL, datetime('now'))
                ''', (ticker, name_en, name_ar, market_name))
                inserted += 1
    
    if not dry_run:
        conn.commit()
    
    conn.close()
    
    print(f"  ✅ Inserted: {inserted}, Updated: {updated}")
    return inserted

def seed_all_markets(dry_run: bool = False):
    """Seed all markets."""
    print("=" * 60)
    print("🌍 Multi-Market Stock Seeder")
    print("=" * 60)
    
    markets = ['KSA', 'KSE', 'QSE', 'DFM', 'ADX']
    total = 0
    
    for market in markets:
        count = seed_stocks(market, dry_run)
        total += count
    
    print(f"\n✅ Total stocks processed: {total}")
    print("=" * 60)
    
    return total

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Seed multi-market stocks')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done')
    parser.add_argument('--market', type=str, help='Specific market to seed')
    
    args = parser.parse_args()
    
    if args.market:
        seed_stocks(args.market.upper(), args.dry_run)
    else:
        seed_all_markets(args.dry_run)
