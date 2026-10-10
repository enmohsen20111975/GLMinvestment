"""
تصنيف الأسهم إلى قطاعات
======================
سكريبت لتصنيف الـ 370 سهم بدون قطاع

التصنيف بناءً على:
1. اسم السهم (عربي/إنجليزي)
2. رمز السهم
3. نمط التداول
"""

import sqlite3
import os
from pathlib import Path

# مسار قاعدة البيانات
BASE_DIR = Path(__file__).parent.parent.resolve()
DB_PATH = os.environ.get('DATABASE_PATH', str(BASE_DIR / 'db' / 'stocks.db'))

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
    'Retail & Consumer Services': {
        'arabic': ['تجزئة', 'متاجر', 'سوبر ماركت', 'مولات', 'بيع بالتجزئة'],
        'english': ['retail', 'stores', 'supermarket', 'mall', 'consumer services', 'shopping'],
        'tickers': ['OAHA', 'CIRA', 'PRDC', 'BMHI'],
    },
    'Investment & Financial Services': {
        'arabic': ['استثمار', 'استثمارات', 'تداول', 'وساطة', 'محافظ', 'تمويل'],
        'english': ['investment', 'investments', 'trading', 'brokerage', 'portfolio', 'finance', 'financial services', 'capital'],
        'tickers': ['HRHO', 'EKHO', 'GTHE', 'BFRI', 'HELI', 'ACI', 'EFIH', 'EFA', 'AIOC', 'FICT'],
    },
    'Technology': {
        'arabic': ['تكنولوجيا', 'تقنية', 'برمجيات', 'حاسب', 'آلي', 'اتصالات تكنولوجيا'],
        'english': ['technology', 'tech', 'software', 'it', 'digital', 'computer', 'electronics', 'automation'],
        'tickers': ['MTIE', 'EGTS', 'EGS1', 'IORA', 'EDNV', 'ATLC'],
    },
    'Tourism & Entertainment': {
        'arabic': ['سياحة', 'فنادق', 'سفر', 'ترفيه', 'منتجعات'],
        'english': ['tourism', 'hotel', 'hotels', 'travel', 'entertainment', 'resort', 'leisure'],
        'tickers': ['EGTH', 'MENA', 'HRHO', 'EGTS', 'ALCN', 'ZMKD', 'EEEG'],
    },
    'Transportation & Logistics': {
        'arabic': ['نقل', 'شحن', 'لوجستيات', 'ملاحة', 'طيران', 'مطار'],
        'english': ['transport', 'transportation', 'shipping', 'logistics', 'maritime', 'aviation', 'airport'],
        'tickers': ['EGTS', 'ESRS', 'GWC', 'AMOC', 'EGTS'],
    },
    'Textiles & Apparel': {
        'arabic': ['منسوجات', 'ملابس', 'غزل', 'نسيج', 'قطن'],
        'english': ['textiles', 'apparel', 'clothing', 'cotton', 'weaving', 'spinning', 'garment'],
        'tickers': ['ARAB', 'AMTC', 'NITS', 'EGTS', 'KABO'],
    },
    'Construction & Building Materials': {
        'arabic': ['مقاولات', 'بناء', 'أسمنت', 'رخام', 'جرانيت', 'طوب', 'مواد بناء'],
        'english': ['construction', 'contracting', 'cement', 'marble', 'granite', 'bricks', 'building materials'],
        'tickers': ['ORHD', 'MCIE', 'Suez', 'AMER', 'ALUM', 'ELPA', 'AINP'],
    },
    'Agriculture': {
        'arabic': ['زراعة', 'مزارع', 'ري', 'محاصيل', 'خضروات', 'فاكهة'],
        'english': ['agriculture', 'farming', 'irrigation', 'crops', 'vegetables', 'fruits'],
        'tickers': ['SEDI', 'KABO', 'OHUA', 'NTRA'],
    },
    'Media & Publishing': {
        'arabic': ['إعلام', 'صحافة', 'نشر', 'طباعة', 'تلفزيون', 'راديو'],
        'english': ['media', 'publishing', 'press', 'printing', 'television', 'radio', 'newspaper'],
        'tickers': ['EGTS', 'PRDC'],
    },
    'Education': {
        'arabic': ['تعليم', 'مدارس', 'جامعات', 'كليات', 'معاهد'],
        'english': ['education', 'schools', 'universities', 'colleges', 'institutes', 'learning'],
        'tickers': ['CIRA', 'ERES', 'SEDI'],
    },
}

# قطاعات أسماء الشركات المعروفة
COMPANY_SECTOR_MAP = {
    # Banks
    'COMI': 'Banks', 'CIEB': 'Banks', 'ADIB': 'Banks', 'FAIT': 'Banks',
    'SAUD': 'Banks', 'ABUK': 'Banks', 'QNBE': 'Banks', 'ETBA': 'Banks',
    'BUEI': 'Banks', 'CABK': 'Banks', 'MIDG': 'Banks', 'CAIH': 'Banks',
    
    # Real Estate
    'TMGH': 'Real Estate', 'MNHD': 'Real Estate', 'ORHD': 'Real Estate',
    'HELI': 'Investment & Financial Services', 'ALCN': 'Real Estate',
    
    # Telecom
    'ETEL': 'Telecom', 'ESRS': 'Telecom',
    
    # Food
    'JUFO': 'Food & Beverage', 'SKPC': 'Food & Beverage', 'AJWA': 'Food & Beverage',
    'EFID': 'Food & Beverage', 'SWDY': 'Food & Beverage',
    
    # Energy
    'EGAS': 'Energy & Utilities', 'AMOC': 'Energy & Utilities', 'EGPC': 'Energy & Utilities',
    
    # Healthcare
    'PHDC': 'Healthcare & Pharmaceuticals', 'RMDA': 'Healthcare & Pharmaceuticals',
    
    # Investment
    'HRHO': 'Investment & Financial Services', 'EKHO': 'Investment & Financial Services',
    'GTHE': 'Investment & Financial Services',
    
    # Industrial
    'ALUM': 'Industrial', 'AMER': 'Industrial', 'ORWE': 'Industrial',
    
    # Technology
    'MTIE': 'Technology', 'EGTS': 'Technology',
    
    # Tourism
    'EGTH': 'Tourism & Entertainment', 'MENA': 'Tourism & Entertainment',
    
    # Education
    'CIRA': 'Education',
    
    # Retail
    'OAHA': 'Retail & Consumer Services',
}


def classify_stock(ticker: str, name: str) -> str:
    """
    تصنيف سهم بناءً على رمزه واسمه
    
    Args:
        ticker: رمز السهم
        name: اسم السهم (عربي أو إنجليزي)
    
    Returns:
        اسم القطاع
    """
    ticker = ticker.upper().strip() if ticker else ''
    name = name.lower() if name else ''
    
    # 1. تحقق من القطاع المعروف مسبقاً
    if ticker in COMPANY_SECTOR_MAP:
        return COMPANY_SECTOR_MAP[ticker]
    
    # 2. تحقق من الكلمات المفتاحية
    best_match = None
    best_score = 0
    
    for sector, keywords in SECTOR_KEYWORDS.items():
        score = 0
        
        # تحقق من الرمز
        for kw in keywords.get('tickers', []):
            if kw in ticker or ticker in kw:
                score += 10
        
        # تحقق من الكلمات الإنجليزية
        for kw in keywords.get('english', []):
            if kw in name:
                score += 3
        
        # تحقق من الكلمات العربية
        for kw in keywords.get('arabic', []):
            if kw in name:
                score += 3
        
        if score > best_score:
            best_score = score
            best_match = sector
    
    # 3. إذا لم نجد تطابق، نحاول التخمين من الرمز
    if not best_match or best_score < 2:
        # رموز البنوك
        if any(x in ticker for x in ['BNK', 'BANK', 'CIB', 'ADIB', 'FAIT', 'SAUD', 'QNBE']):
            return 'Banks'
        
        # رموز العقارات
        if any(x in ticker for x in ['RE', 'EST', 'HD', 'MGH', 'NHD']):
            return 'Real Estate'
        
        # رموز الاتصالات
        if any(x in ticker for x in ['TEL', 'COM', 'MOB']):
            return 'Telecom'
        
        # رموز الطاقة
        if any(x in ticker for x in ['GAS', 'OIL', 'PET', 'PWR', 'EGAS', 'AMOC']):
            return 'Energy & Utilities'
        
        # رموز الصناعة
        if any(x in ticker for x in ['IND', 'MFG', 'STEEL', 'CEM', 'ALUM']):
            return 'Industrial'
        
        # رموز الغذاء
        if any(x in ticker for x in ['FOOD', 'MILL', 'OIL', 'SUG', 'EGP']):
            return 'Food & Beverage'
        
        # رموز الصحة
        if any(x in ticker for x in ['PH', 'MED', 'DRUG', 'HOSP']):
            return 'Healthcare & Pharmaceuticals'
        
        # رموز الاستثمار
        if any(x in ticker for x in ['INV', 'CAP', 'FIN', 'HOLD', 'INV']):
            return 'Investment & Financial Services'
        
        # رموز التكنولوجيا
        if any(x in ticker for x in ['TECH', 'IT', 'SOFT', 'SYS']):
            return 'Technology'
        
        # رموز السياحة
        if any(x in ticker for x in ['TOUR', 'HOT', 'TRAV', 'RES']):
            return 'Tourism & Entertainment'
    
    return best_match if best_match else 'Diversified'


def get_all_stocks_without_sector():
    """الحصول على كل الأسهم بدون قطاع"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT ticker, name, name_ar 
        FROM stocks 
        WHERE sector IS NULL OR sector = '' OR sector = 'N/A'
        ORDER BY ticker
    ''')
    
    stocks = cursor.fetchall()
    conn.close()
    
    return stocks


def update_stock_sector(ticker: str, sector: str):
    """تحديث قطاع السهم"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        UPDATE stocks 
        SET sector = ?, last_update = datetime('now')
        WHERE ticker = ?
    ''', (sector, ticker))
    
    conn.commit()
    conn.close()


def main():
    """الدالة الرئيسية"""
    print("=" * 60)
    print("🏭 تصنيف الأسهم إلى قطاعات")
    print("=" * 60)
    
    # الحصول على الأسهم بدون قطاع
    stocks = get_all_stocks_without_sector()
    print(f"\n📊 عدد الأسهم بدون قطاع: {len(stocks)}")
    
    if not stocks:
        print("✅ كل الأسهم ليها قطاع!")
        return
    
    # تصنيف كل سهم
    results = {}
    unclassified = []
    
    for ticker, name, name_ar in stocks:
        # استخدام الاسم العربي أو الإنجليزي
        full_name = f"{name or ''} {name_ar or ''}"
        sector = classify_stock(ticker, full_name)
        
        if sector:
            results[ticker] = sector
        else:
            unclassified.append(ticker)
    
    # عرض النتائج
    print("\n" + "=" * 60)
    print("📋 نتائج التصنيف:")
    print("=" * 60)
    
    sector_counts = {}
    for ticker, sector in results.items():
        sector_counts[sector] = sector_counts.get(sector, 0) + 1
    
    for sector, count in sorted(sector_counts.items(), key=lambda x: -x[1]):
        print(f"  {sector}: {count} سهم")
    
    print(f"\n  ⚠️ غير مصنف: {len(unclassified)} سهم")
    
    # تحديث قاعدة البيانات
    print("\n" + "=" * 60)
    print("💾 تحديث قاعدة البيانات...")
    print("=" * 60)
    
    for ticker, sector in results.items():
        update_stock_sector(ticker, sector)
        print(f"  ✅ {ticker} → {sector}")
    
    # عرض الأسهم غير المصنفة
    if unclassified:
        print("\n" + "=" * 60)
        print("⚠️ الأسهم غير المصنفة (تحتاج تصنيف يدوي):")
        print("=" * 60)
        for ticker in unclassified[:20]:  # أول 20 بس
            print(f"  - {ticker}")
        if len(unclassified) > 20:
            print(f"  ... و {len(unclassified) - 20} سهم آخر")
    
    # الإحصائيات النهائية
    print("\n" + "=" * 60)
    print("📊 الإحصائيات النهائية:")
    print("=" * 60)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('SELECT COUNT(*) FROM stocks WHERE sector IS NOT NULL AND sector != ""')
    with_sector = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM stocks')
    total = cursor.fetchone()[0]
    
    cursor.execute('''
        SELECT sector, COUNT(*) as cnt 
        FROM stocks 
        WHERE sector IS NOT NULL AND sector != ""
        GROUP BY sector 
        ORDER BY cnt DESC
    ''')
    sectors = cursor.fetchall()
    
    print(f"  إجمالي الأسهم: {total}")
    print(f"  بقطاع محدد: {with_sector} ({with_sector/total*100:.1f}%)")
    print(f"  بدون قطاع: {total - with_sector} ({(total-with_sector)/total*100:.1f}%)")
    print("\n  توزيع القطاعات:")
    for sector, count in sectors:
        print(f"    {sector}: {count}")
    
    conn.close()
    
    print("\n✅ تم الانتهاء!")


if __name__ == '__main__':
    main()
