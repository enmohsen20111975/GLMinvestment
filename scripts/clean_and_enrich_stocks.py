import sqlite3
import re

def is_arabic(text):
    if not text:
        return False
    # Check if string contains Arabic characters
    return bool(re.search(r'[\u0600-\u06FF]', text))

def clean_and_enrich():
    conn = sqlite3.connect('db/stocks.db')
    c = conn.cursor()

    print("=== Step 1: Fix Arabic names stored in `name` column for KSE/EGX/etc. ===")
    rows = c.execute("SELECT ticker, name, name_ar, market FROM stocks WHERE name_ar IS NULL OR trim(name_ar) = ''").fetchall()
    fixed_names = 0
    for ticker, name, name_ar, market in rows:
        if name and is_arabic(name):
            c.execute("UPDATE stocks SET name_ar = ? WHERE ticker = ?", (name.strip(), ticker))
            fixed_names += 1
    print(f"Fixed {fixed_names} stocks where Arabic name was in English `name` column.")

    print("\n=== Step 2: Map known Egyptian ISIN codes to real tickers ===")
    isin_map = {
        'EGS370O1C013': ('NPRT', 'الشركة الوطنية للطباعة', 'Commercial Services'),
        'EGS3E071C013': ('ACRO', 'أكرو مصر للشدات والسقالات المعدنية', 'Producer Manufacturing'),
        'EGS3E071C013-EGP': ('ACRO', 'أكرو مصر للشدات والسقالات المعدنية', 'Producer Manufacturing'),
        'EGS385S1C012': ('FERC', 'فيركيم مصر للأسمدة والكيماويات', 'Process Industries'),
        'EGS30AJ1C016': ('IDIC', 'الدولية للثلج الجاف', 'Process Industries'),
        'EGS30AJ1C016-EGP': ('IDIC', 'الدولية للثلج الجاف', 'Process Industries'),
        'EGS48271C018': ('EGSA_COMM', 'مصر جنوب افريقيا للاتصالات', 'Communications'),
        'EGS48271C018-EGP': ('EGSA_COMM', 'مصر جنوب افريقيا للاتصالات', 'Communications'),
        'EGS65621C012': ('ELSH', 'النصر للاسكان والتعمير', 'Real Estate'),
        'EGS65861C014': ('EGYC', 'المصرية للمقاولات - العبد', 'Industrial Services'),
        'EGS72L31C011': ('SOLR', 'سولارسول للطاقة', 'Utilities'),
        'EGS220N1C016': ('NASR', 'النصر للمباني والإنشاءات', 'Industrial Services'),
    }

    for isin, (new_ticker, arabic_name, sector) in isin_map.items():
        exists = c.execute("SELECT 1 FROM stocks WHERE ticker = ?", (new_ticker,)).fetchone()
        if exists:
            # new_ticker exists, update its name_ar if empty and delete the ISIN duplicate
            c.execute("UPDATE stocks SET name_ar = ? WHERE ticker = ? AND (name_ar IS NULL OR name_ar = '')", (arabic_name, new_ticker))
            c.execute("DELETE FROM stocks WHERE ticker = ?", (isin,))
        else:
            c.execute("""
                UPDATE stocks 
                SET ticker = ?, name_ar = ?, sector = CASE WHEN sector IS NULL OR sector = '' THEN ? ELSE sector END
                WHERE ticker = ?
            """, (new_ticker, arabic_name, sector, isin))

    # Clean remaining orphaned raw EGS tickers by deleting or flagging them
    c.execute("DELETE FROM stocks WHERE ticker LIKE 'EGS%' OR ticker LIKE 'EGX%'")
    deleted_raw_isin = c.rowcount
    print(f"Purged {deleted_raw_isin} orphaned raw ISIN stocks.")

    # Fix Kuwaiti and Saudi common tickers missing name_ar
    known_arabic = {
        'NBKE': 'بنك الكويت الوطني - مصر',
        'CANA': 'بنك قناة السويس',
        'MFPC': 'مصر لإنتاج الأسمدة - موبكو',
        'ABUK': 'أبو قير للأسمدة والصناعات الكيماوية',
        'EGAL': 'مصر للألومنيوم',
        'VALU': 'فاليو لخدمات البيع بالتقسيط',
        'IEEC': 'المصرية للمشاريع الهندسية - إيسيك',
        'SPMD': 'سبيد ميديكال',
        'GGCC': 'الجيزة العامة للمقاولات والاستثمار العقاري',
        'MHOT': 'مصر للفنادق',
        'ORAS': 'أوراسكوم كونستراكشون بي ال سي',
        'FWRY': 'فوري لتكنولوجيا البنوك والمدفوعات الإلكترونية',
        'COMI': 'البنك التجاري الدولي - مصر (CIB)',
        'ETEL': 'المصرية للاتصالات (وي)',
        'TMGH': 'مجموعة طلعت مصطفى القابضة',
        'SWDY': 'السويدي إليكتريك',
        'EKHO': 'القابضة المصرية الكويتية',
        'MNHD': 'مدينة مصر للإسكان والتعمير',
        'HELI': 'مصر الجديدة للإسكان والتعمير',
        'ESRS': 'حديد عز',
        'AMOC': 'الإسكندرية للزيوت المعدنية - أموك',
        'SKPC': 'سيدي كرير للبتروكيماويات - سيدبك',
        'JUFO': 'جهينة للصناعات الغذائية',
        'EFID': 'إيديتا للصناعات الغذائية',
        'DOMN': 'دومتي - الصناعات الغذائية العربية',
        'PHDC': 'بالم هيلز للتعمير',
        'HRHO': 'مجموعة إي إف جي القابضة (هيرميس)',
        'BTFH': 'بلتون القابضة',
        'ISPH': 'ابن سينا فارما',
        'CIEB': 'بنك كريدي أجريكول مصر',
        'ADIB': 'مصرف أبو ظبي الإسلامي - مصر',
        'ALUM': 'العربية للألومنيوم',
        'RAYA': 'راية القابضة للاستثمارات المالية',
        'KABO': 'النصر للملابس والمنسوجات - كابو',
        'CCAP': 'القلعة للاستشارات المالية',
        'AJWA': 'أجواء للصناعات الغذائية - مصر',
        # TADAWUL Major Stocks
        '1120': 'مصرف الراجحي',
        '2222': 'أرامكو السعودية',
        '2010': 'سابك (الشركة السعودية للصناعات الأساسية)',
        '1180': 'البنك الأهلي السعودي',
        '7010': 'إس تي سي (الاتصالات السعودية)',
        '2380': 'بترورابغ',
        '1010': 'بنك الرياض',
        '1150': 'مصرف الإنماء',
        '2280': 'المراعي',
        '2020': 'سابك للمغذيات الزراعية',
        '4030': 'البحري',
        '1211': 'معادن (شركة التعدين العربية السعودية)',
        '2350': 'كيان السعودية',
        '4190': 'جرير للتسويق',
        '2170': 'اللجين',
        '4001': 'أسواق العثيم',
        # KSE Major Stocks
        'KFH': 'بيت التمويل الكويتي (بيتك)',
        'NBK': 'بنك الكويت الوطني',
        'ZAIN': 'زين الكويت للاتصالات',
        'AGLTY': 'أجيليتي للمخازن العمومية',
        'BOUBYAN': 'بنك بوبيان',
        'BURG': 'بنك برقان',
        'KIB': 'بنك الكويت الدولي',
        'HUMANSOFT': 'هيومن سوفت القابضة',
        'MABANEE': 'شركة المباني',
        'ALIMTI': 'مجموعة الامتياز الاستثمارية',
        'SHUAIBA': 'شركة الشعيبة الصناعية',
    }

    updated_names = 0
    for tk, ar in known_arabic.items():
        c.execute("UPDATE stocks SET name_ar = ? WHERE ticker = ?", (ar, tk))
        if c.rowcount > 0:
            updated_names += 1
    print(f"Enriched {updated_names} major stocks with canonical Arabic names.")

    conn.commit()
    conn.close()

    print("\n=== Step 3: Clean predictions.db from weird ISIN/broken tickers ===")
    conn2 = sqlite3.connect('db/predictions.db')
    c2 = conn2.cursor()
    c2.execute("DELETE FROM predictions WHERE ticker LIKE 'EGS%' OR ticker LIKE 'EGX%'")
    deleted_p = c2.rowcount
    print(f"Deleted {deleted_p} predictions with ISIN codes.")

    # Also update any ticker in predictions matching isin_map
    for isin, (new_ticker, _, _) in isin_map.items():
        c2.execute("UPDATE predictions SET ticker = ? WHERE ticker = ?", (new_ticker, isin))

    conn2.commit()
    conn2.close()

    print("\n✅ Database cleanup & enrichment complete!")

if __name__ == '__main__':
    clean_and_enrich()
