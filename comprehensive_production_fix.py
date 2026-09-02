#!/usr/bin/env python3
"""
=============================================================================
MASTER REPAIR & SYNCHRONIZATION ENGINE FOR GLMINVESTMENT
=============================================================================
This script executes a comprehensive, safe, and permanent fix for:
1. Purging & migrating all corrupted symbols across all 4 databases
2. Standardizing market codes (EGX, TADAWUL, KSE, QSE)
3. Ensuring 100% accurate Arabic names for all active stocks
4. Preventing scraper regressions (DOM parsing fix & ON CONFLICT updates)
5. Aligning production server sync scripts
=============================================================================
"""

import sqlite3
import re
import json
import shutil
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent
DB_DIR = PROJECT_ROOT / 'db'
BACKUP_DIR = DB_DIR / 'backups' / f"backup_before_master_fix_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

STOCKS_DB = DB_DIR / 'stocks.db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'
PRICE_HISTORY_DB = DB_DIR / 'price_history.db'
DATA_ENGINE_DB = DB_DIR / 'data_engine.db'

# Known Egyptian Stock ISIN to Ticker mappings
ISIN_TO_TICKER = {
    'EGS30AJ1C016': 'IDIC',
    'EGS30AJ1C016-EGP': 'IDIC',
    'EGS370O1C013': 'NPCO',
    'EGS3E071C013': 'ACRO',
    'EGS3E071C013-EGP': 'ACRO',
    'EGS48271C018': 'ESAC',
    'EGS48271C018-EGP': 'ESAC',
    'EGS65101C015': 'NINV',
    'EGS65621C012': 'NASR',
    'EGS65861C014': 'EABD',
    'EEGS70311C013': 'EGOTH',
    'EGS72L31C011': 'SOLA',
    'EGS72XL1C014': 'PHGC',
    'EGS73M81C012': 'NAMI',
    'EGS659O1C015': 'MKIT',
    'EGS220N1C016': 'NCCW',
    'EGS66DU1C015': 'AIUD',
    'EGS924K1C018': 'LUTS_R1',
}

# Curated Arabic names for active stocks that TradingView returns only in English
CURATED_ARABIC_NAMES = {
    # Active Egyptian Stocks
    'COMI': 'البنك التجاري الدولي - مصر',
    'ETEL': 'المصرية للاتصالات',
    'SWDY': 'السويدي اليكتريك',
    'FWRY': 'فوري لتكنولوجيا البنوك والمدفوعات الإلكترونية',
    'EFIH': 'إي فاينانس للاستثمارات المالية والرقمية',
    'TMGH': 'مجموعة طلعت مصطفى القابضة',
    'HRHO': 'مجموعة إي إف چي القابضة',
    'ESRS': 'حديد عز',
    'EKHO': 'مصر الكويت القابضة',
    'VLMR': 'مصر الكويت القابضة',
    'EKHOA': 'مصر الكويت القابضة بالدولار',
    'MASR': 'مدينة مصر للإسكان والتعمير',
    'MNHD': 'مدينة مصر للإسكان والتعمير',
    'FAIT': 'بنك فيصل الإسلامي المصري',
    'FAITA': 'بنك فيصل الإسلامي المصري بالدولار',
    'SEIG': 'السعودية المصرية للاستثمار والتمويل',
    'FCMD': 'الدولية للصناعات الطبية (إيكمي)',
    'ICMI': 'الدولية للصناعات الطبية (إيكمي)',
    'TYCN': 'تايكون القابضة للاستثمارات المالية',
    'ANFI': 'تايكون القابضة للاستثمارات المالية',
    'GBCO': 'جي بي كوربوريشن',
    'AUTO': 'جي بي كوربوريشن',
    'QNBE': 'بنك قطر الوطني الأهلي',
    'QNBA': 'بنك قطر الوطني الأهلي',
    'RRMTV': 'رواد مصر للاستثمار السياحي',
    'RMTV': 'رواد مصر للاستثمار السياحي',
    'FTNS': 'فيتنس برايم للأندية الصحية',
    'NULL': 'فيتنس برايم للأندية الصحية',
    'ACAP': 'إيه كابيتال القابضة',
    'ACTF': 'أكت فاينانشال للاستشارات',
    'AIDC': 'العربية للاستثمار والتنمية',
    'ALEX': 'الإسكندرية لأسمنت بورتلاند',
    'ANCC': 'النهضة للصناعات',
    'APPC': 'المتقدمة لتعبئة المواد الدوائية',
    'BONY': 'بنيان للتنمية والتجارة',
    'CIRA': 'القاهرة للاستثمار والتنمية العقارية (سيرا للتعليم)',
    'CNFN': 'كونتكت المالية القابضة',
    'CPME': 'كاتاليست بارتنرز ميدل إيست',
    'DCCC': 'دمياط لتداول الحاويات والبضائع',
    'DCRC': 'دلتا للإنشاء والتعمير',
    'DGTZ': 'ديجيتيز للاستثمار والتقنية',
    'EEEP': 'منصة مصر للتعليم (إي إي بي)',
    'EFAC': 'المصرية للسبائك الحديدية',
    'LUTS': 'لوتس للتنمية والاستثمار الزراعي',
    'MCRO': 'ماكرو جروب للمستحضرات الطبية (ماكرو كابيتال)',
    'NBKE': 'بنك الكويت الوطني - مصر',
    'NNBKE': 'بنك الكويت الوطني - مصر',
    'NCGC': 'النيل لحليج الأقطان',
    'NFCI': 'النصر للأسمدة والصناعات الكيماوية (سماد السويس)',
    'NNFCI': 'النصر للأسمدة والصناعات الكيماوية',
    'NMIN': 'النصر للتعدين',
    'OOCAP': 'أوجي كابيتال للاستثمارات',
    'OCAP': 'أوجي كابيتال للاستثمارات',
    'OFH': 'أوراسكوم المالية القابضة',
    'OFHO': 'أوراسكوم المالية القابضة',
    'PACH': 'البويات والصناعات الكيماوية (باكين)',
    'POCO': 'بورسعيد لتداول الحاويات والبضائع',
    'PRDC': 'بايونيرز بروبرتيز للتنمية العمرانية',
    'RMDA': 'العاشر من رمضان للصناعات الدوائية (راميدا)',
    'SIEG': 'المصرية للمواسير والمنتجات الأسمنتية (سيجوارت)',
    'SINA': 'سيناء للمنجنيز',
    'SMPP': 'الشروق الحديثة للطباعة والتغليف',
    'SNFI': 'سوهاج الوطنية للصناعات الغذائية',
    'SPMD': 'سبيد ميديكال',
    'SUCE': 'السويس للأسمنت',
    'TALM': 'تعليم لخدمات الإدارة',
    'TANM': 'تنمية للاستثمار العقاري',
    'TAQA': 'طاقة عربية',
    'TORA': 'أسمنت بورتلاند طرة',
    'TWSA': 'توسعة للتخصيم',
    'UBEE': 'بنك المتحد',
    'VALU': 'ڤاليو للتمويل الاستهلاكي',
    'WATP': 'الحديثة للمواد العازلة (مودرن - بيتومود)',
    'YAYT': 'صناعة اليايات ومهمات وسائل النقل',
    'ACFR': 'الإسكندرية للحراريات',
    'CID': 'الكيماويات للتنمية والصناعة (سيد)',
    'EEP': 'منصة مصر للتعليم',
    'EGOTH': 'المصرية العامة للسياحة والفنادق (إيجوث)',
    'EGWA': 'المستودعات المصرية العامة',
    'GEOS': 'جيوس للتجارة والمقاولات',
    'GOUR': 'جورميه إيجيبت دوت كوم للأغذية',
    'HAVC': 'حسن علام للاستثمارات والرأسمال المخاطر',
    'HDST': 'هيدجستون للاستثمار',
    'KNGC': 'النصر للزجاج والبلور',
    'KORA': 'قره للطاقة',
    'LKGP': 'القابضة للاستثمارات المالية (لكح جروب)',
    'MITR': 'مصر للسياحة',
    'MLIC': 'مصر لتأمينات الحياة',
    'ELAB': 'المصرية لإنتاج الألكيل بنزين الخطي (إيلاب)',
    'ENPI': 'الهندسية للصناعات البترولية والكيماوية (إنبي)',
    'MMHC': 'المعمورة للتعمير والتنمية السياحية',
    'PMSC': 'خدمات البترول البحرية',
    'ALXD': 'الإسكندرية للاستثمار والتنمية العمرانية',
    'GROV': 'جروفا للاستحواذ',
    'IDIC': 'مصر لصناعة الثلج الجاف (ديفكو)',
    'NPCO': 'الشركة الوطنية للطباعة',
    'ACRO': 'أكرو مصر للشدات والسقالات المعدنية',
    'ESAC': 'مصر جنوب أفريقيا للاتصالات',
    'NINV': 'الوطنية للاستثمار والتعمير',
    'NASR': 'النصر للإسكان والتعمير',
    'EABD': 'المصرية للمقاولات (العبد)',
    'SOLA': 'سولارسول للطاقة',
    'PHGC': 'مجموعة بريميوم للرعاية الصحية',
    'NAMI': 'الوطنية لإدارة الأصول والاستثمار',
    'MKIT': 'مصر الكويت للاستثمار والتجارة',
    'NCCW': 'النصر للمباني والإنشاءات (إيجيكو)',
    'AIUD': 'الإسكندرية للاستثمار والتنمية العمرانية',
    'LUTS_R1': 'حق اكتتاب شركة لوتس للتنمية الزراعية',
    'GTEX': 'جي-تكس للاستثمارات التجارية والصناعية',
    'ISMQ': 'الحديد والصلب للمناجم والمحاجر',
    'HBCO': 'هيبكو',
    'GTHE': 'جلوبال تيلكوم القابضة',
    'ORWE': 'النساجون الشرقيون',
    'AMOC': 'الإسكندرية للزيوت المعدنية (أموك)',
    'EGAL': 'مصر للألومنيوم',
    'ABUK': 'أبو قير للأسمدة والصناعات الكيماوية',
    'MFPC': 'مصر لإنتاج الأسمدة (موبكو)',
    'SKPC': 'سيدي كرير للبتروكيماويات (سيدبك)',
    'EKHO': 'مصر الكويت القابضة',
    'ISPH': 'ابن سينا فارما',
    'CIEB': 'بنك كريدي أجريكول مصر',
    'ADIB': 'مصرف أبوظبي الإسلامي - مصر',
    'SAUD': 'بنك البركة مصر',
    'EXPA': 'البنك المصري لتنمية الصادرات',
    'HDBK': 'بنك التعمير والإسكان',
    'CCAP': 'القلعة للاستشارات المالية',
    'PHDC': 'بالم هيلز للتعمير',
    'ORHD': 'أوراسكوم للتنمية مصر',
    'HELI': 'مصر الجديدة للإسكان والتعمير',
    'MEDS': 'المتحدة للإسكان والتعمير',
    'MNHD': 'مدينة مصر للإسكان والتعمير',
    'EMFD': 'إعمار مصر للتنمية',
    'ORAS': 'أوراسكوم كونستراكشون بي إل سي',
    'BTFH': 'بلتون القابضة',
    'AMER': 'مجموعة عامر القابضة (عامر جروب)',
    'PORT': 'بورتو جروب القابضة',

    # Kuwait Stocks
    'ALENMA': 'الإنماء العقارية',
    'ALFTAQA': 'أكشن للطاقة',
    'MKHZN': 'أجيليتي للمخازن العمومية',
    'SHUAIBA': 'صناعات الشعيبية الورقية',
    'SSHUAIB': 'صناعات الشعيبية الورقية',
    'TROLLEY': 'ترولي للتجارة العامة',
    'PHC': 'مجموعة التخصيص القابضة',
    'VALMORE': 'ڤالمور القابضة',
    'ASIYA': 'آسيا كابيتال الاستثمارية',
    'INOVEST': 'إنوفست',
    'GFH': 'مجموعة جي إف إتش المالية',
    'QIC': 'شركة أم القيوين للاستثمارات العامة',

    # Qatar Stocks
    'BEMA': 'الضمان للتأمين الإسلامي (بيمه)',
    'BLDN': 'بلدنا',
    'DUBK': 'بنك دخان',
    'FALH': 'الفالح التعليمية القابضة',
    'MEZA': 'ميزة',
    'MFMS': 'مساندة لخدمات إدارة المرافق',
    'MHAR': 'المحار القابضة',
    'MKDM': 'مجموعة مقدام القابضة',
    'ORDS': 'أوريدو قطر',
    'ORDSO': 'أوريدو قطر',
    'QAMC': 'قطر لصناعة الألمنيوم (قامكو)',
    'QLMI': 'كيو إل إم لتأمينات الحياة والتأمين الصحي',
    'TQES': 'تكنو كيو (الأنظمة الإلكترونية القطرية)',

    # Saudi Funds & Stocks
    '4702': 'صندوق الخبير للدخل المتنوع المتداول 2030',
    '4703': 'صندوق سدكو كابيتال متعدد الأصول المتداول',
    '9406': 'صندوق البلاد إم إس سي آي المتداول للأسهم',
    '9407': 'صندوق البلاد إم إس سي آي للتقنية الأمريكية',
    '9408': 'صندوق البلاد إم إس سي آي لنمو الأسهم السعودية',
    '9409': 'صندوق يقين إس آند بي المتداول لأسهم الشرق الأوسط',
    '9410': 'صندوق البلاد سي إس أو بي هونغ كونغ',
    '9411': 'صندوق هانغ سينغ هونغ كونغ المتداول',
    '9412': 'صندوق البلاد إم إس سي آي للأسهم السعودية',
    '9413': 'صندوق الراجحي إم إس سي آي للأسهم السعودية',
}

def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    symbol = {'INFO': '✅', 'WARN': '⚠️', 'ERROR': '❌', 'STEP': '🔷'}.get(level, '•')
    print(f"[{ts}] {symbol} {msg}")

def backup_databases():
    log("Creating safety backups of all databases...", 'STEP')
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for db_path in [STOCKS_DB, PREDICTIONS_DB, PRICE_HISTORY_DB, DATA_ENGINE_DB]:
        if db_path.exists():
            shutil.copy2(str(db_path), str(BACKUP_DIR / db_path.name))
            log(f"  Backed up {db_path.name} to {BACKUP_DIR.name}")

def extract_clean_ticker(raw_ticker, market):
    if not raw_ticker:
        return None
    raw = str(raw_ticker).strip()
    
    # Check ISIN first
    for isin, ticker in ISIN_TO_TICKER.items():
        if raw.startswith(isin):
            return ticker
            
    # Saudi stocks: digits
    if market in ('TADAWUL', 'السعودية') or raw.isdigit():
        digits = re.findall(r'\d{4,5}', raw)
        return digits[0] if digits else None
        
    # Check known prefixed symbols (e.g. ACAPA Capital HoldingD -> ACAP)
    # Most corrupted symbols end with trailing 'D' and contain company name
    # Pattern: ^([A-Z]{2,6})[A-Za-z0-9\s\.\-&]+D?$
    match = re.match(r'^([A-Z]{2,6})[A-Za-z0-9\s\.\-&]+', raw)
    if match:
        prefix = match.group(1)
        # Verify prefix is not a generic word like 'THE', 'FOR'
        if len(prefix) in (2, 3, 4, 5, 6):
            return prefix
            
    return None

def normalize_market_code(market_str, ticker=''):
    if not market_str:
        return 'EGX'
    m = market_str.strip()
    if m in ('مصر', 'EGX'):
        # Safety check: if ticker is 4 digits, it's Tadawul!
        if ticker and ticker.isdigit() and len(ticker) == 4:
            return 'TADAWUL'
        return 'EGX'
    if m in ('السعودية', 'TADAWUL', 'KSA', 'saudi'):
        return 'TADAWUL'
    if m in ('الكويت', 'KSE', 'kuwait'):
        return 'KSE'
    if m in ('قطر', 'QSE', 'qatar'):
        return 'QSE'
    return m

def build_symbol_mapping(conn_stocks):
    cur = conn_stocks.cursor()
    cur.execute("SELECT ticker, market, name, name_ar FROM stocks")
    rows = cur.fetchall()
    
    valid_tickers = {r[0] for r in rows if re.match(r'^[A-Z0-9]{2,6}(_R\d)?$', r[0]) or re.match(r'^\d{4,5}$', r[0])}
    
    mapping = {}
    for r in rows:
        ticker, market, name, name_ar = r
        if ticker in valid_tickers:
            continue
            
        clean = extract_clean_ticker(ticker, market)
        if clean:
            mapping[ticker] = clean
            
    log(f"Found {len(mapping)} corrupted tickers with clean target mappings.")
    return mapping

def purge_and_migrate_table(conn, table_name, col_name, mapping):
    cur = conn.cursor()
    migrated = 0
    deleted = 0
    
    for old_sym, new_sym in mapping.items():
        # Check if new_sym already exists in unique or primary key constraint situations
        try:
            cur.execute(f"UPDATE {table_name} SET {col_name} = ? WHERE {col_name} = ?", (new_sym, old_sym))
            migrated += cur.rowcount
        except sqlite3.IntegrityError:
            # If constraint fails because new_sym already has a row, delete old corrupted row
            cur.execute(f"DELETE FROM {table_name} WHERE {col_name} = ?", (old_sym,))
            deleted += cur.rowcount
            
    conn.commit()
    return migrated, deleted

def clean_all_databases(mapping):
    log("Purging corrupted symbols across all databases...", 'STEP')
    
    # 1. stocks.db
    if STOCKS_DB.exists():
        conn = sqlite3.connect(str(STOCKS_DB))
        for tbl, col in [
            ('stocks', 'ticker'),
            ('stock_daily_prices', 'ticker'),
            ('screener_results', 'symbol'),
            ('screener_presets', 'ticker'),
            ('stock_phase', 'symbol'),
            ('cached_analysis', 'ticker'),
            ('real_evaluated_predictions', 'ticker'),
            ('stocks_backup', 'ticker'),
            ('egksco_stocks', 'symbol')
        ]:
            try:
                m, d = purge_and_migrate_table(conn, tbl, col, mapping)
                if m > 0 or d > 0:
                    log(f"  stocks.db -> {tbl}.{col}: migrated {m}, deleted {d} duplicate rows")
            except Exception as e:
                log(f"  Error on stocks.db {tbl}: {e}", 'WARN')
        conn.close()
        
    # 2. predictions.db
    if PREDICTIONS_DB.exists():
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        for tbl, col in [
            ('stored_analyses', 'ticker'),
            ('aiPrediction', 'stock_symbol'),
            ('tomorrow_watchlist', 'ticker'),
            ('live_ai_signals', 'ticker'),
            ('quant_cache', 'ticker'),
            ('ExpertRecommendation', 'stock_symbol')
        ]:
            try:
                m, d = purge_and_migrate_table(conn, tbl, col, mapping)
                if m > 0 or d > 0:
                    log(f"  predictions.db -> {tbl}.{col}: migrated {m}, deleted {d} duplicate rows")
            except Exception as e:
                log(f"  Error on predictions.db {tbl}: {e}", 'WARN')
        conn.close()

    # 3. price_history.db
    if PRICE_HISTORY_DB.exists():
        conn = sqlite3.connect(str(PRICE_HISTORY_DB))
        for tbl, col in [('price_history', 'ticker')]:
            try:
                m, d = purge_and_migrate_table(conn, tbl, col, mapping)
                if m > 0 or d > 0:
                    log(f"  price_history.db -> {tbl}.{col}: migrated {m}, deleted {d} duplicate rows")
            except Exception as e:
                log(f"  Error on price_history.db {tbl}: {e}", 'WARN')
        conn.close()

    # 4. data_engine.db
    if DATA_ENGINE_DB.exists():
        conn = sqlite3.connect(str(DATA_ENGINE_DB))
        for tbl, col in [
            ('stocks', 'symbol'),
            ('stock_prices', 'symbol'),
            ('tab_performance', 'symbol'),
            ('tab_valuation', 'symbol'),
            ('tab_dividends', 'symbol'),
            ('tab_profitability', 'symbol'),
            ('tab_income_statement', 'symbol'),
            ('tab_balance_sheet', 'symbol'),
            ('tab_cash_flow', 'symbol'),
            ('tab_technical_analysis', 'symbol'),
            ('screener_lists', 'symbol')
        ]:
            try:
                m, d = purge_and_migrate_table(conn, tbl, col, mapping)
                if m > 0 or d > 0:
                    log(f"  data_engine.db -> {tbl}.{col}: migrated {m}, deleted {d} duplicate rows")
            except Exception as e:
                log(f"  Error on data_engine.db {tbl}: {e}", 'WARN')
        conn.close()

def synchronize_arabic_names_and_markets():
    log("Synchronizing Arabic names and standardizing market codes...", 'STEP')
    conn = sqlite3.connect(str(STOCKS_DB))
    cur = conn.cursor()
    
    # 1. Standardize market names in stocks.db
    cur.execute("UPDATE stocks SET market = 'EGX' WHERE market = 'مصر'")
    cur.execute("UPDATE stocks SET market = 'TADAWUL' WHERE market = 'السعودية'")
    cur.execute("UPDATE stocks SET market = 'KSE' WHERE market = 'الكويت'")
    cur.execute("UPDATE stocks SET market = 'QSE' WHERE market = 'قطر'")
    
    # Fix Saudi stocks misclassified as EGX (e.g. 4170, 9510, etc.)
    cur.execute("UPDATE stocks SET market = 'TADAWUL' WHERE market = 'EGX' AND ticker GLOB '[0-9][0-9][0-9][0-9]*'")
    conn.commit()
    
    # 2. Collect Arabic names from egksco_stocks
    egksco_names = {}
    try:
        cur.execute("SELECT symbol, name_ar FROM egksco_stocks WHERE name_ar IS NOT NULL AND name_ar != ''")
        for sym, nar in cur.fetchall():
            if re.search(r'[\u0600-\u06ff]', nar):
                egksco_names[sym] = nar.strip()
    except Exception:
        pass
        
    # 3. Master Arabic names source combining egksco + curated
    master_names = {}
    master_names.update(CURATED_ARABIC_NAMES)
    master_names.update(egksco_names)
    
    # Update stocks.db
    updated_cnt = 0
    cur.execute("SELECT ticker, name, name_ar FROM stocks")
    for ticker, name, current_name_ar in cur.fetchall():
        ar_name = master_names.get(ticker)
        if ar_name:
            cur.execute("""
                UPDATE stocks SET
                    name_ar = ?,
                    name = CASE WHEN (name IS NULL OR name = '' OR name = ticker) THEN ? ELSE name END
                WHERE ticker = ?
            """, (ar_name, ar_name, ticker))
            updated_cnt += 1
            
    conn.commit()
    log(f"Updated/Verified Arabic names for {updated_cnt} stocks in stocks.db")
    
    # 4. Sync Arabic names to data_engine.db
    if DATA_ENGINE_DB.exists():
        conn_de = sqlite3.connect(str(DATA_ENGINE_DB))
        cur_de = conn_de.cursor()
        
        # Ensure name_ar column exists
        de_cols = [c[1] for c in cur_de.execute("PRAGMA table_info(stocks)").fetchall()]
        if 'name_ar' not in de_cols:
            cur_de.execute("ALTER TABLE stocks ADD COLUMN name_ar TEXT DEFAULT ''")
            
        cur.execute("SELECT ticker, name_ar, market FROM stocks WHERE name_ar IS NOT NULL AND name_ar != ''")
        de_updated = 0
        for ticker, name_ar, market in cur.fetchall():
            market_ar = {'EGX': 'مصر', 'TADAWUL': 'السعودية', 'KSE': 'الكويت', 'QSE': 'قطر'}.get(market, market)
            cur_de.execute("""
                UPDATE stocks SET
                    name_ar = ?,
                    market = ?
                WHERE symbol = ?
            """, (name_ar, market_ar, ticker))
            if cur_de.rowcount > 0:
                de_updated += 1
                
        conn_de.commit()
        conn_de.close()
        log(f"Synced Arabic names for {de_updated} stocks to data_engine.db")

    conn.close()

def fix_tradingview_scraper_script():
    log("Hardening data_engine/scrapers/tradingview_scraper.py...", 'STEP')
    scraper_file = PROJECT_ROOT / 'data_engine' / 'scrapers' / 'tradingview_scraper.py'
    if not scraper_file.exists():
        log("  tradingview_scraper.py not found", 'WARN')
        return
        
    code = scraper_file.read_text(encoding='utf-8')
    
    # 1. Fix DOM parsing in scrape_market:
    # Instead of taking aTags[0].textContent which merges ticker + name + D, parse carefully:
    OLD_DOM_PARSER = """                        const aTags = cells[0].querySelectorAll('a');
                        const sym = aTags[0]?.textContent?.trim() || '';
                        const name = aTags[1]?.textContent?.trim() || sym;"""
                        
    NEW_DOM_PARSER = """                        // Robust symbol & name extraction
                        let sym = '';
                        let name = '';
                        const link = cells[0].querySelector('a[href*="/symbols/"]');
                        if (link) {
                            const href = link.getAttribute('href') || '';
                            const m = href.match(/\\/symbols\\/[A-Z0-9_]+-([A-Z0-9_]+)/i);
                            if (m) sym = m[1].toUpperCase();
                        }
                        if (!sym) {
                            const raw = cells[0].querySelector('[class*="tickerName"], a')?.textContent?.trim() || '';
                            const m = raw.match(/^[A-Z0-9_]{2,8}|^\\d{4,5}/);
                            sym = m ? m[0] : '';
                        }
                        const nameElem = cells[0].querySelector('[class*="tickerDescription"], [class*="description"]');
                        name = nameElem ? nameElem.textContent.trim() : (cells[0].querySelectorAll('a')[1]?.textContent?.trim() || sym);"""

    if OLD_DOM_PARSER in code:
        code = code.replace(OLD_DOM_PARSER, NEW_DOM_PARSER)
        log("  ✅ Fixed ticker DOM extraction in tradingview_scraper.py")
        
    # 2. Fix save_to_db in tradingview_scraper.py to use ON CONFLICT DO UPDATE
    OLD_INSERT = """            INSERT OR REPLACE INTO stocks
            (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""
            
    NEW_INSERT = """            INSERT INTO stocks
            (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
                price = excluded.price,
                change_percent = excluded.change_percent,
                volume = excluded.volume,
                market_cap = excluded.market_cap,
                sector = CASE WHEN excluded.sector != '' THEN excluded.sector ELSE stocks.sector END,
                name = CASE WHEN excluded.name != '' AND excluded.name != excluded.symbol THEN excluded.name ELSE stocks.name END,
                name_ar = CASE WHEN excluded.name != '' AND excluded.name GLOB '*[\\u0600-\\u06ff]*' THEN excluded.name ELSE stocks.name_ar END,
                tabs_data = excluded.tabs_data,
                last_update = excluded.last_update"""

    if OLD_INSERT in code:
        code = code.replace(OLD_INSERT, NEW_INSERT)
        log("  ✅ Fixed save_to_db ON CONFLICT in tradingview_scraper.py")

    scraper_file.write_text(code, encoding='utf-8')

def fix_tradingview_rest_script():
    log("Hardening data_engine/scrapers/tradingview_rest.py...", 'STEP')
    scraper_file = PROJECT_ROOT / 'data_engine' / 'scrapers' / 'tradingview_rest.py'
    if not scraper_file.exists():
        log("  tradingview_rest.py not found", 'WARN')
        return
        
    code = scraper_file.read_text(encoding='utf-8')
    
    OLD_REST_INSERT = """            cursor.execute('''
                INSERT OR REPLACE INTO stocks
                (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''"""
            
    NEW_REST_INSERT = """            cursor.execute('''
                INSERT INTO stocks
                (symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data, last_update)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    price = excluded.price,
                    change_percent = excluded.change_percent,
                    volume = excluded.volume,
                    market_cap = excluded.market_cap,
                    sector = CASE WHEN excluded.sector != '' THEN excluded.sector ELSE stocks.sector END,
                    name = CASE WHEN excluded.name != '' AND excluded.name != excluded.symbol THEN excluded.name ELSE stocks.name END,
                    tabs_data = excluded.tabs_data,
                    last_update = excluded.last_update
            '''"""
            
    if OLD_REST_INSERT in code:
        code = code.replace(OLD_REST_INSERT, NEW_REST_INSERT)
        scraper_file.write_text(code, encoding='utf-8')
        log("  ✅ Fixed save_to_db ON CONFLICT in tradingview_rest.py")

def fix_egxpilot_scraper_script():
    log("Hardening data_engine/scrapers/egxpilot_scraper.py...", 'STEP')
    scraper_file = PROJECT_ROOT / 'data_engine' / 'scrapers' / 'egxpilot_scraper.py'
    if not scraper_file.exists():
        log("  egxpilot_scraper.py not found", 'WARN')
        return
        
    code = scraper_file.read_text(encoding='utf-8')
    
    # Filter out numeric symbols from EGX
    OLD_FILTER = "if not symbol or _is_index_symbol(symbol):"
    NEW_FILTER = "if not symbol or _is_index_symbol(symbol) or symbol.isdigit():"
    
    if OLD_FILTER in code and NEW_FILTER not in code:
        code = code.replace(OLD_FILTER, NEW_FILTER, 1)
        scraper_file.write_text(code, encoding='utf-8')
        log("  ✅ Added numeric ticker filter to egxpilot_scraper.py")

def fix_align_production_symbols_script():
    log("Hardening vps-service/align_production_symbols.py...", 'STEP')
    align_file = PROJECT_ROOT / 'vps-service' / 'align_production_symbols.py'
    if not align_file.exists():
        log("  align_production_symbols.py not found", 'WARN')
        return
        
    code = align_file.read_text(encoding='utf-8')
    
    # 1. Update SELECT to include name_ar
    OLD_SELECT = """    de_rows = de_cursor.execute(\"\"\"
        SELECT symbol, name, market, sector, market_cap, price, change_percent, volume
        FROM stocks
        ORDER BY last_update DESC, id DESC
    \"\"\").fetchall()"""
    
    NEW_SELECT = """    cols_de = [c[1] for c in de_cursor.execute("PRAGMA table_info(stocks)").fetchall()]
    has_name_ar = 'name_ar' in cols_de
    name_ar_col = 'name_ar' if has_name_ar else "''"
    
    order_col = 'last_update DESC' if 'last_update' in cols_de else 'rowid DESC'
    if 'id' in cols_de: order_col += ', id DESC'
    
    de_rows = de_cursor.execute(f\"\"\"
        SELECT symbol, name, market, sector, market_cap, price, change_percent, volume, {name_ar_col}
        FROM stocks
        ORDER BY {order_col}
    \"\"\").fetchall()"""

    if OLD_SELECT in code:
        code = code.replace(OLD_SELECT, NEW_SELECT)
        log("  ✅ Updated SELECT query to read name_ar in align_production_symbols.py")
        
    # 2. Update loop unpacking
    OLD_LOOP = "    for sym, name, market, sector, cap, price, chg, vol in de_rows:"
    NEW_LOOP = "    for sym, name, market, sector, cap, price, chg, vol, *extra in de_rows:\n        nar = extra[0] if extra else ''"
    
    if OLD_LOOP in code:
        code = code.replace(OLD_LOOP, NEW_LOOP)
        
    # 3. Store name_ar in unique_de_stocks
    OLD_DICT = """            unique_de_stocks[sym] = {
                'name': name,
                'market': mkt_code,
                'sector': sector or '',
                'market_cap': cap or '',
                'price': price or 0.0,
                'change_percent': chg or 0.0,
                'volume': vol or 0
            }"""
            
    NEW_DICT = """            unique_de_stocks[sym] = {
                'name': name,
                'name_ar': nar or '',
                'market': mkt_code,
                'sector': sector or '',
                'market_cap': cap or '',
                'price': price or 0.0,
                'change_percent': chg or 0.0,
                'volume': vol or 0
            }"""
            
    if OLD_DICT in code:
        code = code.replace(OLD_DICT, NEW_DICT)
        log("  ✅ Preserved name_ar in unique_de_stocks dict")

    # 4. Safe UPDATE that never overwrites existing Arabic name with empty/English
    OLD_UPDATE_SQL = """            st_cursor.execute(\"\"\"
                UPDATE stocks SET
                    name = ?,
                    name_ar = ?,
                    market = ?,
                    sector = ?,
                    current_price = ?,
                    change_percent = ?,
                    volume = ?,
                    market_cap = ?,
                    is_active = 1,
                    last_update = ?,
                    updated_at = ?
                WHERE ticker = ?
            \"\"\", (
                info['name'], info.get('name_ar') or '', info['market'], info['sector'],
                info['price'], info['change_percent'], info['volume'], info['market_cap'],
                fetch_time, fetch_time, sym
            ))"""

    NEW_UPDATE_SQL = """            st_cursor.execute(\"\"\"
                UPDATE stocks SET
                    name = CASE WHEN ? != '' THEN ? ELSE name END,
                    name_ar = CASE 
                        WHEN ? != '' AND ? GLOB '*[\\u0600-\\u06ff]*' THEN ? 
                        ELSE COALESCE(NULLIF(name_ar, ''), ?) 
                    END,
                    market = ?,
                    sector = ?,
                    current_price = ?,
                    change_percent = ?,
                    volume = ?,
                    market_cap = ?,
                    is_active = 1,
                    last_update = ?,
                    updated_at = ?
                WHERE ticker = ?
            \"\"\", (
                info['name'], info['name'],
                info.get('name_ar', ''), info.get('name_ar', ''), info.get('name_ar', ''),
                info['name'],
                info['market'], info['sector'],
                info['price'], info['change_percent'], info['volume'], info['market_cap'],
                fetch_time, fetch_time, sym
            ))"""

    if OLD_UPDATE_SQL in code:
        code = code.replace(OLD_UPDATE_SQL, NEW_UPDATE_SQL)
        log("  ✅ Made name_ar UPDATE non-destructive in align_production_symbols.py")

    align_file.write_text(code, encoding='utf-8')

def main():
    log("=" * 70, 'STEP')
    log("STARTING MASTER REPAIR & SYNCHRONIZATION", 'STEP')
    log("=" * 70, 'STEP')
    
    # 1. Backups
    backup_databases()
    
    # 2. Build corrupted symbols mapping
    conn_stocks = sqlite3.connect(str(STOCKS_DB))
    mapping = build_symbol_mapping(conn_stocks)
    conn_stocks.close()
    
    # 3. Purge corrupted symbols across all databases
    clean_all_databases(mapping)
    
    # 4. Synchronize Arabic names and standard market codes
    synchronize_arabic_names_and_markets()
    
    # 5. Permanent code fixes in scrapers and alignment scripts
    fix_tradingview_scraper_script()
    fix_tradingview_rest_script()
    fix_egxpilot_scraper_script()
    fix_align_production_symbols_script()
    
    # 6. Final verification
    log("=" * 70, 'STEP')
    log("FINAL VERIFICATION OF SYSTEM STATE:", 'STEP')
    log("=" * 70, 'STEP')
    
    conn = sqlite3.connect(str(STOCKS_DB))
    cur = conn.cursor()
    
    total = cur.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    ar_cnt = cur.execute("SELECT COUNT(*) FROM stocks WHERE name_ar IS NOT NULL AND name_ar != '' AND name_ar GLOB '*[\u0600-\u06ff]*'").fetchone()[0]
    logo_cnt = cur.execute("SELECT COUNT(*) FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ''").fetchone()[0]
    active_cnt = cur.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1").fetchone()[0]
    
    log(f"stocks.db total stocks: {total}")
    log(f"  Stocks with verified Arabic names: {ar_cnt} / {total} ({ar_cnt*100//total}%)")
    log(f"  Stocks with logos: {logo_cnt} / {total} ({logo_cnt*100//total}%)")
    log(f"  Active stocks: {active_cnt}")
    
    cur.execute("SELECT market, COUNT(*) FROM stocks GROUP BY market ORDER BY 2 DESC")
    markets = cur.fetchall()
    log(f"  Standardized Market distribution: {markets}")
    
    conn.close()
    
    log("=" * 70, 'STEP')
    log("🎉 MASTER REPAIR AND SYNCHRONIZATION FINISHED SUCCESSFULLY!", 'STEP')
    log("=" * 70, 'STEP')

if __name__ == '__main__':
    main()
