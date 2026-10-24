#!/usr/bin/env python3
"""
Sector Classification Script for VPS
=====================================
سكريبت تصنيف الأسهم إلى قطاعات

Run on VPS:
cd <project_root>/vps-service && python3 scripts/classify_sectors.py
"""

import os
import sys
import sqlite3
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# تعريف القطاعات والكلمات المفتاحية
SECTOR_KEYWORDS = {
    'Banks': {
        'arabic': ['بنك', 'مصرف', 'بنوك'],
        'english': ['bank', 'banks', 'banking', 'cib', 'adib', 'fait', 'qnbe', 'saud'],
        'tickers': ['COMI', 'CIEB', 'ADIB', 'FAIT', 'SAUD', 'ABUK', 'QNBE', 'ETBA', 'BUEI', 'CABK', 'MIDG', 'CAIH'],
    },
    'Real Estate': {
        'arabic': ['عقار', 'عقارات', 'إسكان', 'تطوير عقاري', 'مدن'],
        'english': ['real estate', 'properties', 'housing', 'development', 'construction', 'talaat', 'madinet'],
        'tickers': ['TMGH', 'MNHD', 'ORHD', 'HELI', 'ALCN', 'MCIE', 'ELQA', 'UDCI', 'NIRE', 'OCDI'],
    },
    'Telecom': {
        'arabic': ['اتصال', 'اتصالات', 'موبايل', 'تليفون'],
        'english': ['telecom', 'telecommunications', 'mobile', 'phone', 'communication'],
        'tickers': ['ETEL', 'ESRS', 'MOBI'],
    },
    'Food & Beverage': {
        'arabic': ['غذاء', 'أغذية', 'طعام', 'مشروبات', 'مطاحن', 'زيت', 'سكر', 'دجاج'],
        'english': ['food', 'beverage', 'mills', 'oils', 'sugar', 'poultry', 'chicken', 'juice', 'edible'],
        'tickers': ['JUFO', 'SKPC', 'AJWA', 'EFID', 'SWDY', 'CAID', 'ZEOT', 'CICH', 'SPMD', 'DOMT', 'KABO'],
    },
    'Energy & Utilities': {
        'arabic': ['طاقة', 'كهرباء', 'غاز', 'بترول', 'نفط', 'محروقات'],
        'english': ['energy', 'electricity', 'gas', 'petroleum', 'oil', 'fuel', 'power', 'utility'],
        'tickers': ['EGAS', 'AMOC', 'ESRS', 'EGPC', 'SAMP', 'ESPA', 'ELPA', 'CCPA'],
    },
    'Industrial': {
        'arabic': ['صناعة', 'صناعات', 'مصنع', 'مصانع', 'ألومنيوم', 'حديد', 'صلب', 'أسمنت'],
        'english': ['industrial', 'industries', 'factory', 'manufacturing', 'aluminum', 'steel', 'cement', 'pipes'],
        'tickers': ['SWDY', 'ESGH', 'ALUM', 'AMER', 'ORWE', 'AINP', 'NIPD', 'EIPM', 'UNBP'],
    },
    'Healthcare & Pharmaceuticals': {
        'arabic': ['صحة', 'طبية', 'دواء', 'أدوية', 'مستشفى', 'صيدلة'],
        'english': ['healthcare', 'health', 'medical', 'pharma', 'pharmaceutical', 'hospital', 'drug', 'medicine'],
        'tickers': ['PHDC', 'RMDA', 'EGCH', 'PACH', 'EKRI', 'MOIC'],
    },
    'Investment & Financial Services': {
        'arabic': ['استثمار', 'استثمارات', 'تداول', 'وساطة', 'محافظ', 'تمويل'],
        'english': ['investment', 'investments', 'trading', 'brokerage', 'portfolio', 'finance', 'financial services', 'capital'],
        'tickers': ['HRHO', 'EKHO', 'GTHE', 'BFRI', 'HELI', 'ACI', 'EFIH', 'EFA', 'AIOC', 'FICT'],
    },
    'Technology': {
        'arabic': ['تكنولوجيا', 'تقنية', 'برمجيات', 'حاسب', 'آلي'],
        'english': ['technology', 'tech', 'software', 'it ', 'digital', 'computer', 'electronics', 'automation'],
        'tickers': ['MTIE', 'EGTS', 'EGS1', 'IORA', 'EDNV', 'ATLC'],
    },
    'Tourism & Entertainment': {
        'arabic': ['سياحة', 'فنادق', 'سفر', 'ترفيه', 'منتجعات'],
        'english': ['tourism', 'hotel', 'hotels', 'travel', 'entertainment', 'resort', 'leisure'],
        'tickers': ['EGTH', 'MENA', 'HRHO', 'EGTS', 'ALCN', 'ZMKD', 'EEEG'],
    },
    'Retail & Consumer Services': {
        'arabic': ['تجزئة', 'متاجر', 'سوبر ماركت', 'مولات'],
        'english': ['retail', 'stores', 'supermarket', 'mall', 'consumer services', 'shopping'],
        'tickers': ['OAHA', 'CIRA', 'PRDC', 'BMHI'],
    },
    'Education': {
        'arabic': ['تعليم', 'مدارس', 'جامعات', 'كليات', 'معاهد'],
        'english': ['education', 'schools', 'universities', 'colleges', 'institutes', 'learning'],
        'tickers': ['CIRA', 'ERES', 'SEDI'],
    },
}

# خريطة الشركات المعروفة
COMPANY_SECTOR_MAP = {
    'COMI': 'Banks', 'CIEB': 'Banks', 'ADIB': 'Banks', 'FAIT': 'Banks',
    'SAUD': 'Banks', 'ABUK': 'Banks', 'QNBE': 'Banks', 'ETBA': 'Banks',
    'TMGH': 'Real Estate', 'MNHD': 'Real Estate', 'ORHD': 'Real Estate',
    'ETEL': 'Telecom', 'ESRS': 'Telecom',
    'JUFO': 'Food & Beverage', 'SKPC': 'Food & Beverage', 'AJWA': 'Food & Beverage',
    'EGAS': 'Energy & Utilities', 'AMOC': 'Energy & Utilities',
    'PHDC': 'Healthcare & Pharmaceuticals', 'RMDA': 'Healthcare & Pharmaceuticals',
    'HRHO': 'Investment & Financial Services', 'EKHO': 'Investment & Financial Services',
    'ALUM': 'Industrial', 'AMER': 'Industrial',
    'CIRA': 'Education',
}


def classify_stock(ticker: str, name: str = None, name_ar: str = None) -> str:
    """تصنيف سهم بناءً على رمزه واسمه"""
    upper_ticker = ticker.upper().strip() if ticker else ''
    lower_name = f"{name or ''} {name_ar or ''}".lower()
    
    # تحقق من القطاع المعروف
    if upper_ticker in COMPANY_SECTOR_MAP:
        return COMPANY_SECTOR_MAP[upper_ticker]
    
    # تحقق من الكلمات المفتاحية
    best_match = None
    best_score = 0
    
    for sector, keywords in SECTOR_KEYWORDS.items():
        score = 0
        
        # تحقق من Ticker
        for kw in keywords.get('tickers', []):
            if kw in upper_ticker or upper_ticker in kw:
                score += 10
        
        # تحقق من الكلمات الإنجليزية
        for kw in keywords.get('english', []):
            if kw in lower_name:
                score += 3
        
        # تحقق من الكلمات العربية
        for kw in keywords.get('arabic', []):
            if kw in lower_name:
                score += 3
        
        if score > best_score:
            best_score = score
            best_match = sector
    
    return best_match if best_match else 'Diversified'


def main():
    print('🔍 Sector Classification Script for VPS')
    print('=' * 50)
    print()
    
    # تحديد مسار قاعدة البيانات
    base_dir = Path(__file__).parent.parent.parent  # GLMinvestment root
    db_path = os.environ.get('DATABASE_PATH', str(base_dir / 'db' / 'stocks.db'))
    
    if not os.path.exists(db_path):
        # Try alternative paths
        alt_paths = [
            str(base_dir / 'db' / 'stocks.db'),
        ]
        for alt in alt_paths:
            if os.path.exists(alt):
                db_path = alt
                break
    
    print(f'📂 Database: {db_path}')
    
    if not os.path.exists(db_path):
        print(f'❌ Database not found at {db_path}')
        return
    
    # الاتصال بقاعدة البيانات
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(db_path, writable=False)
    cursor = conn.cursor()
    
    # فحص عدد الأسهم الكلي
    cursor.execute('SELECT COUNT(*) FROM stocks')
    total_stocks = cursor.fetchone()[0]
    print(f'📊 Total stocks in database: {total_stocks}')
    
    # فحص الأسهم بدون قطاع
    cursor.execute('''
        SELECT COUNT(*) FROM stocks 
        WHERE sector IS NULL OR sector = '' OR sector = 'N/A'
    ''')
    without_sector = cursor.fetchone()[0]
    print(f'📊 Stocks without sector: {without_sector}')
    print()
    
    if without_sector == 0:
        print('✅ All stocks already have sectors!')
        
        # عرض التوزيع الحالي
        cursor.execute('''
            SELECT sector, COUNT(*) as cnt 
            FROM stocks 
            WHERE sector IS NOT NULL AND sector != ''
            GROUP BY sector 
            ORDER BY cnt DESC
        ''')
        sectors = cursor.fetchall()
        
        print('\n📊 Current Sector Distribution:')
        total_classified = 0
        for sector, count in sectors:
            print(f'   {sector}: {count} stocks')
            total_classified += count
        
        coverage = (total_classified / total_stocks * 100) if total_stocks > 0 else 0
        print(f'\n📊 Coverage: {total_classified}/{total_stocks} ({coverage:.1f}%)')
        
        conn.close()
        return
    
    # الحصول على الأسهم بدون قطاع
    cursor.execute('''
        SELECT ticker, name, name_ar 
        FROM stocks 
        WHERE sector IS NULL OR sector = '' OR sector = 'N/A'
    ''')
    stocks = cursor.fetchall()
    
    # تصنيف الأسهم
    classified = {}
    sector_counts = {}
    unclassified = []
    
    for ticker, name, name_ar in stocks:
        sector = classify_stock(ticker, name, name_ar)
        
        if sector and sector != 'Diversified':
            classified[ticker] = sector
            sector_counts[sector] = sector_counts.get(sector, 0) + 1
            print(f'✅ {ticker} → {sector}')
        else:
            unclassified.append(ticker)
            print(f'⚠️ {ticker} → Diversified')
            sector_counts['Diversified'] = sector_counts.get('Diversified', 0) + 1
    
    # تحديث قاعدة البيانات
    print('\n📝 Updating database...')
    
    for ticker, sector in classified.items():
        cursor.execute('UPDATE stocks SET sector = ? WHERE ticker = ?', (sector, ticker))
    
    # Set Diversified for unclassified
    for ticker in unclassified:
        cursor.execute('UPDATE stocks SET sector = ? WHERE ticker = ?', ('Diversified', ticker))
    
    conn.commit()
    
    # الإحصائيات النهائية
    print('\n' + '=' * 50)
    print('📈 Classification Results:')
    print(f'   ✅ Classified: {len(classified)}')
    print(f'   ⚠️ Set to Diversified: {len(unclassified)}')
    print('\n📊 Sector Distribution:')
    
    for sector, count in sorted(sector_counts.items(), key=lambda x: -x[1]):
        print(f'   {sector}: {count} stocks')
    
    # التحقق من التغطية الكلية
    cursor.execute('SELECT COUNT(*) FROM stocks WHERE sector IS NOT NULL AND sector != ""')
    with_sector = cursor.fetchone()[0]
    coverage = (with_sector / total_stocks * 100) if total_stocks > 0 else 0
    
    print(f'\n📊 Total Coverage: {with_sector}/{total_stocks} ({coverage:.1f}%)')
    
    conn.close()
    print('\n✅ Done!')


if __name__ == '__main__':
    main()
