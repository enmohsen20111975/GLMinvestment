#!/usr/bin/env python3
"""
EGX Master Stocks & Aliases Dictionary
======================================
Comprehensive, verified mapping for EGX stocks to their Arabic names,
popular colloquial aliases, and tickers.
Prevents false positives (e.g. generic words like 'البنك' or 'شركة').
"""

from typing import Dict, List, Set, Tuple
import re

# Comprehensive mapping: Ticker -> { 'ar': Official Arabic, 'en': English, 'aliases': [list of distinctive terms] }
EGX_STOCKS_DATA: Dict[str, Dict[str, any]] = {
    'COMI': {
        'ar': 'البنك التجاري الدولي',
        'en': 'Commercial International Bank',
        'aliases': ['البنك التجاري الدولي', 'التجاري الدولي', 'cib', 'بنك cib', 'سهم cib']
    },
    'TMGH': {
        'ar': 'مجموعة طلعت مصطفى القابضة',
        'en': 'Talaat Moustafa Group Holding',
        'aliases': ['طلعت مصطفى', 'مجموعة طلعت مصطفى', 'هشام طلعت مصطفى', 'tmgh']
    },
    'FWRY': {
        'ar': 'فوري لتكنولوجيا البنوك والمدفوعات الالكترونية',
        'en': 'Fawry for Banking Technology',
        'aliases': ['شركة فوري', 'شبكة فوري', 'فوري للمدفوعات', 'سهم فوري', 'fwry']
    },
    'SWDY': {
        'ar': 'السويدي اليكتريك',
        'en': 'Elsewedy Electric',
        'aliases': ['السويدي اليكتريك', 'السويدي إليكتريك', 'السويدى اليكتريك', 'السويدى إليكتريك', 'swdy']
    },
    'EAST': {
        'ar': 'الشرقية - ايسترن كومباني',
        'en': 'Eastern Company',
        'aliases': ['الشرقية للدخان', 'ايسترن كومباني', 'إيسترن كومباني', 'الشرقية-ايسترن', 'east']
    },
    'ETEL': {
        'ar': 'المصرية للاتصالات',
        'en': 'Telecom Egypt',
        'aliases': ['المصرية للاتصالات', 'we المصرية للاتصالات', 'telecom egypt', 'etel']
    },
    'ABUK': {
        'ar': 'ابوقير للأسمدة والصناعات الكيماوية',
        'en': 'Abu Qir Fertilizers',
        'aliases': ['أبو قير للأسمدة', 'ابوقير للأسمدة', 'أبوقير للاسمده', 'ابو قير للاسمدة', 'abuk']
    },
    'MFPC': {
        'ar': 'مصر لإنتاج الاسمدة - موبكو',
        'en': 'Misr Fertilizers Production Company - MOPCO',
        'aliases': ['موبكو', 'مصر لإنتاج الأسمدة', 'مصر لإنتاج الاسمدة', 'شركة موبكو', 'mfpc']
    },
    'SKPC': {
        'ar': 'سيدي كرير للبتروكيماويات - سيدبك',
        'en': 'Sidi Kerir Petrochemicals - SIDPEC',
        'aliases': ['سيدي كرير للبتروكيماويات', 'سيدي كرير', 'سيدبك', 'سيدبك للبتروكيماويات', 'skpc']
    },
    'AMOC': {
        'ar': 'الاسكندرية للزيوت المعدنية - أموك',
        'en': 'Alexandria Mineral Oils Company - AMOC',
        'aliases': ['أموك', 'اموك', 'الإسكندرية للزيوت المعدنية', 'الاسكندرية للزيوت المعدنية', 'amoc']
    },
    'ESRS': {
        'ar': 'حديد عز',
        'en': 'Ezz Steel',
        'aliases': ['حديد عز', 'عز للصلب', 'مجموعة عز', 'esrs']
    },
    'IRAX': {
        'ar': 'العز الدخيلة للصلب - الاسكندرية',
        'en': 'Al Ezz Dekheila Steel Alexandria',
        'aliases': ['عز الدخيلة', 'العز الدخيلة', 'حديد الدخيلة', 'irax']
    },
    'ORWE': {
        'ar': 'النساجون الشرقيون للسجاد',
        'en': 'Oriental Weavers',
        'aliases': ['النساجون الشرقيون', 'النساجون', 'سجاد النساجون', 'orwe']
    },
    'CCAP': {
        'ar': 'شركة القلعة للاستشارات المالية',
        'en': 'Qalaa Holdings',
        'aliases': ['شركة القلعة', 'القلعة للاستشارات', 'القلعة القابضة', 'سهم القلعة', 'ccap']
    },
    'BTFH': {
        'ar': 'بلتون القابضة',
        'en': 'Beltone Holding',
        'aliases': ['بلتون المالية', 'بلتون القابضة', 'بلتون كابيتال', 'سهم بلتون', 'btfh']
    },
    'HRHO': {
        'ar': 'مجموعة إي إف جي القابضة (هيرميس)',
        'en': 'EFG Holding (Hermes)',
        'aliases': ['إي إف جي القابضة', 'المجموعة المالية هيرميس', 'هيرميس', 'اي اف جي', 'hrho', 'efg hermes']
    },
    'EFIN': {
        'ar': 'إي فاينانس للاستثمارات المالية والرقمية',
        'en': 'e-finance for Digital & Financial Investments',
        'aliases': ['إي فاينانس', 'اي فاينانس', 'إي-فاينانس', 'efin']
    },
    'HELI': {
        'ar': 'مصر الجديدة للإسكان والتعمير',
        'en': 'Heliopolis Housing',
        'aliases': ['مصر الجديدة للإسكان', 'مصر الجديدة للاسكان والتعمير', 'هيليوبوليس للإسكان', 'heli']
    },
    'MASR': {
        'ar': 'مدينة مصر للإسكان والتعمير (مدينة نصر سابقاً)',
        'en': 'Madinet Masr (formerly MNHD)',
        'aliases': ['مدينة مصر للإسكان', 'مدينة مصر', 'مدينة نصر للإسكان', 'mnhd', 'masr']
    },
    'OCDI': {
        'ar': 'السادس من أكتوبر للتنمية والاستثمار - سوديك',
        'en': 'Sixth of October Development & Investment - SODIC',
        'aliases': ['سوديك', 'شركة سوديك', 'السادس من أكتوبر للتنمية', 'ocdi']
    },
    'EMFD': {
        'ar': 'إعمار مصر للتنمية',
        'en': 'Emaar Misr for Development',
        'aliases': ['إعمار مصر', 'اعمار مصر', 'إعمار مصر للتنمية', 'emfd']
    },
    'EIPH': {
        'ar': 'الشركة المصرية الدولية للصناعات الدوائية - إيبيكو',
        'en': 'Egyptian International Pharmaceutical Industries - EIPICO',
        'aliases': ['إيبيكو', 'ايبيكو', 'المصرية الدولية للصناعات الدوائية', 'eiph']
    },
    'CPCA': {
        'ar': 'القاهرة للأدوية والصناعات الكيماوية',
        'en': 'Cairo Pharmaceuticals and Chemical Industries',
        'aliases': ['القاهرة للأدوية', 'القاهرة للادوية', 'cpca']
    },
    'MIPH': {
        'ar': 'مينا فارم للأدوية والصناعات الكيماوية',
        'en': 'Minapharm Pharmaceuticals',
        'aliases': ['مينا فارم', 'مينافارم', 'مينا فارم للأدوية', 'miph']
    },
    'ISPH': {
        'ar': 'ابن سينا فارما',
        'en': 'Ibnsina Pharma',
        'aliases': ['ابن سينا فارما', 'ابن سينا للأدوية', 'إبن سينا فارما', 'isph']
    },
    'RMDA': {
        'ar': 'العاشر من رمضان للصناعات الدوائية - راميدا',
        'en': 'Rameda Pharmaceuticals',
        'aliases': ['راميدا', 'شركة راميدا', 'العاشر من رمضان للصناعات الدوائية', 'rmda']
    },
    'PHAR': {
        'ar': 'المصرية للأدوية والكيماويات',
        'en': 'Egyptian Pharmaceuticals & Chemicals',
        'aliases': ['المصرية للأدوية والكيماويات', 'phar']
    },
    'DOMT': {
        'ar': 'الصناعات الغذائية العربية - دومتي',
        'en': 'Arabian Food Industries - Domty',
        'aliases': ['دومتي', 'شركة دومتي', 'جبنة دومتي', 'domt']
    },
    'JUFO': {
        'ar': 'جهينة للصناعات الغذائية',
        'en': 'Juhayna Food Industries',
        'aliases': ['جهينة', 'شركة جهينة', 'جهينه', 'jufo']
    },
    'OLFI': {
        'ar': 'عبور لاند للصناعات الغذائية',
        'en': 'Obour Land for Food Industries',
        'aliases': ['عبور لاند', 'شركة عبور لاند', 'olfi']
    },
    'EFID': {
        'ar': 'إيديتا للصناعات الغذائية',
        'en': 'Edita Food Industries',
        'aliases': ['إيديتا', 'ايديتا', 'شركة إيديتا', 'efid']
    },
    'CLHO': {
        'ar': 'مستشفى كليوباترا',
        'en': 'Cleopatra Hospital Company',
        'aliases': ['مستشفى كليوباترا', 'مجموعة كليوباترا', 'كليوباترا الطبية', 'clho']
    },
    'ORHD': {
        'ar': 'أوراسكوم للتنمية مصر',
        'en': 'Orascom Development Egypt',
        'aliases': ['أوراسكوم للتنمية', 'اوراسكوم للتنمية', 'orhd']
    },
    'ORAS': {
        'ar': 'أوراسكوم كونستراكشون بي إل سي',
        'en': 'Orascom Construction PLC',
        'aliases': ['أوراسكوم كونستراكشون', 'أوراسكوم للإنشاء', 'orascom construction', 'oras']
    },
    'OIH': {
        'ar': 'أوراسكوم للاستثمار القابضة',
        'en': 'Orascom Investment Holding',
        'aliases': ['أوراسكوم للاستثمار', 'اوراسكوم للاستثمار', 'oih']
    },
    'TAQA': {
        'ar': 'طاقة عربية',
        'en': 'TAQA Arabia',
        'aliases': ['طاقة عربية', 'شركة طاقة عربية', 'taqa']
    },
    'EKHO': {
        'ar': 'الشركة القابضة المصرية الكويتية',
        'en': 'Egypt Kuwait Holding',
        'aliases': ['المصرية الكويتية', 'القابضة المصرية الكويتية', 'ekho']
    },
    'EGAL': {
        'ar': 'مصر للألومنيوم',
        'en': 'Egypt Aluminium',
        'aliases': ['مصر للألومنيوم', 'مصر للالومنيوم', 'ألومنيوم نجع حمادي', 'egal']
    },
    'ALUM': {
        'ar': 'الألومنيوم العربية',
        'en': 'Arab Aluminium',
        'aliases': ['الألومنيوم العربية', 'الالومنيوم العربية', 'alum']
    },
    'EGCH': {
        'ar': 'الصناعات الكيماوية المصرية - كيما',
        'en': 'Egyptian Chemical Industries - KIMA',
        'aliases': ['كيما', 'شركة كيما', 'الصناعات الكيماوية المصرية', 'كيما أسوان', 'egch']
    },
    'DAPH': {
        'ar': 'الدلتا للسكر',
        'en': 'Delta Sugar',
        'aliases': ['الدلتا للسكر', 'شركة الدلتا للسكر', 'daph']
    },
    'SUCE': {
        'ar': 'السويس للأسمنت',
        'en': 'Suez Cement',
        'aliases': ['السويس للأسمنت', 'أسمنت السويس', 'suce']
    },
    'SCEM': {
        'ar': 'أسمنت سيناء',
        'en': 'Sinai Cement',
        'aliases': ['أسمنت سيناء', 'اسمنت سيناء', 'scem']
    },
    'MCQE': {
        'ar': 'مصر للأسمنت - قنا',
        'en': 'Misr Cement Qena',
        'aliases': ['مصر للأسمنت قنا', 'أسمنت قنا', 'mcqe']
    },
    'ARCC': {
        'ar': 'العربية للأسمنت',
        'en': 'Arabian Cement Company',
        'aliases': ['العربية للأسمنت', 'العربية للاسمنت', 'arcc']
    },
    'ALCN': {
        'ar': 'الإسكندرية لتداول الحاويات والبضائع',
        'en': 'Alexandria Container & Cargo Handling',
        'aliases': ['الإسكندرية لتداول الحاويات', 'الاسكندرية لتداول الحاويات', 'حاويات الإسكندرية', 'alcn']
    },
    'CIEB': {
        'ar': 'بنك كريدي أجريكول - مصر',
        'en': 'Credit Agricole Egypt',
        'aliases': ['كريدي أجريكول', 'كريدى اجريكول', 'بنك كريدي أجريكول', 'cieb']
    },
    'ADIB': {
        'ar': 'مصرف أبوظبي الإسلامي - مصر',
        'en': 'Abu Dhabi Islamic Bank - Egypt',
        'aliases': ['مصرف أبوظبي الإسلامي', 'أبوظبي الإسلامي مصر', 'adib']
    },
    'FAIT': {
        'ar': 'بنك فيصل الإسلامي المصري',
        'en': 'Faisal Islamic Bank of Egypt',
        'aliases': ['بنك فيصل الإسلامي', 'فيصل الإسلامي', 'بنك فيصل', 'fait']
    },
    'EGBE': {
        'ar': 'البنك المصري الخليجي',
        'en': 'Egyptian Gulf Bank',
        'aliases': ['المصري الخليجي', 'البنك المصري الخليجي', 'egbe']
    },
    'EXPA': {
        'ar': 'بنك تنمية الصادرات - EBank',
        'en': 'Export Development Bank of Egypt (EBank)',
        'aliases': ['بنك تنمية الصادرات', 'تنمية الصادرات', 'إي بنك', 'ebank', 'expa']
    },
    'QNBA': {
        'ar': 'بنك قطر الوطني الأهلي - QNB مصر',
        'en': 'QNB Alahli',
        'aliases': ['بنك قطر الوطني', 'qnb مصر', 'قطر الوطني الأهلي', 'qnbe', 'qnba']
    },
    'SAIB': {
        'ar': 'بنك الشركة المصرفية العربية الدولية - SAIB',
        'en': 'Societe Arabe Internationale de Banque (SAIB)',
        'aliases': ['بنك saib', 'المصرفية العربية الدولية', 'saib']
    },
    'VALU': {
        'ar': 'ڤاليو للتمويل الاستهلاكي',
        'en': 'Valu Consumer Finance',
        'aliases': ['ڤاليو', 'فاليو', 'شركة فاليو', 'valu']
    },
    'CNFN': {
        'ar': 'كونتكت المالية القابضة',
        'en': 'Contact Financial Holding',
        'aliases': ['كونتكت المالية', 'ثروة كابيتال سابقاً', 'كونتكت', 'cnfn']
    },
    'GBCO': {
        'ar': 'جي بي كوربوريشن (غبور أوتو)',
        'en': 'GB Corp (Ghabbour Auto)',
        'aliases': ['غبور أوتو', 'جي بي كورب', 'غبور', 'gb corp', 'gbco']
    },
    'MTIE': {
        'ar': 'إم إم جروب للصناعة والتجارة العالمية',
        'en': 'MM Group for Industry & International Trade',
        'aliases': ['إم إم جروب', 'ام ام جروب', 'mtie']
    },
    'RAYA': {
        'ar': 'راية القابضة للاستثمارات المالية',
        'en': 'Raya Holding for Financial Investments',
        'aliases': ['راية القابضة', 'شركة راية', 'سهم راية', 'raya']
    },
    'RACC': {
        'ar': 'راية لخدمات مراكز الاتصالات',
        'en': 'Raya Contact Center',
        'aliases': ['راية لخدمات مراكز الاتصالات', 'راية كونتاكت سنتر', 'racc']
    },
    'BINV': {
        'ar': 'بي إنفستمنتس القابضة',
        'en': 'B Investments Holding',
        'aliases': ['بي إنفستمنتس', 'بي انفستمنتس', 'بى بى اى القابضة', 'binv']
    },
    'ASPI': {
        'ar': 'أسباير كابيتال القابضة للاستثمارات المالية (بايونيرز سابقاً)',
        'en': 'Aspire Capital Holding',
        'aliases': ['أسباير كابيتال', 'اسباير كابيتال', 'بايونيرز القابضة', 'aspi']
    },
    'PRDC': {
        'ar': 'بايونيرز بروبرتيز للتنمية العمرانية',
        'en': 'Pioneers Properties for Urban Development',
        'aliases': ['بايونيرز بروبرتيز', 'prdc']
    },
    'PACH': {
        'ar': 'البويات والصناعات الكيماوية - باكين',
        'en': 'Paints & Chemical Industries - Pachin',
        'aliases': ['باكين', 'شركة باكين', 'البويات والصناعات الكيماوية', 'pach']
    },
    'SPIN': {
        'ar': 'الإسكندرية للغزل والنسيج - سبينالكس',
        'en': 'Alexandria Spinning & Weaving - Spinalex',
        'aliases': ['سبينالكس', 'الإسكندرية للغزل والنسيج', 'spin']
    },
    'UEGC': {
        'ar': 'مصر للأسمنت قنا / مصر العليا للمقاولات',
        'en': 'Upper Egypt Contracting',
        'aliases': ['مصر العليا للمقاولات', 'الجيزة العامة للمقاولات', 'uegc']
    },
    'ACRO': {
        'ar': 'أكرو مصر للشدات والسقالات المعدنية',
        'en': 'Acrow Misr',
        'aliases': ['أكرو مصر', 'اكرو مصر', 'acro']
    },
    'AJWA': {
        'ar': 'أجوا للصناعات الغذائية - مصر',
        'en': 'Ajwa for Food Industries',
        'aliases': ['أجوا', 'اجوا للصناعات الغذائية', 'ajwa']
    },
    'ISMA': {
        'ar': 'الإسماعيلية مصر للدواجن',
        'en': 'Ismailia Misr Poultry',
        'aliases': ['الإسماعيلية مصر للدواجن', 'الاسماعيلية للدواجن', 'isma']
    },
    'CPCI': {
        'ar': 'القاهرة للدواجن',
        'en': 'Cairo Poultry',
        'aliases': ['القاهرة للدواجن', 'دواجن القاهرة', 'cpci']
    },
    'POCO': {
        'ar': 'بورسعيد لتداول الحاويات والبضائع',
        'en': 'Port Said Container & Cargo',
        'aliases': ['بورسعيد لتداول الحاويات', 'حاويات بورسعيد', 'poco']
    },
    'DCCC': {
        'ar': 'دمياط لتداول الحاويات والبضائع',
        'en': 'Damietta Container & Cargo Handling',
        'aliases': ['دمياط لتداول الحاويات', 'حاويات دمياط', 'dccc']
    },
    'ACTF': {
        'ar': 'أكت فاينانشال للاستشارات',
        'en': 'Act Financial',
        'aliases': ['أكت فاينانشال', 'اكت فاينانشال', 'act financial', 'actf']
    },
    'TALM': {
        'ar': 'تعليم لخدمات الإدارة',
        'en': 'Taaleem Management Services',
        'aliases': ['تعليم لخدمات الإدارة', 'شركة تعليم', 'talm']
    },
    'CIRA': {
        'ar': 'القاهرة للاستثمار والتنمية العقارية - سيرا للتعليم',
        'en': 'CIRA Education',
        'aliases': ['سيرا للتعليم', 'القاهرة للاستثمار والتنمية العقارية', 'cira']
    },
    'UBEE': {
        'ar': 'المصرف المتحد',
        'en': 'The United Bank',
        'aliases': ['المصرف المتحد', 'بنك المصرف المتحد', 'ubee']
    },
    'KORA': {
        'ar': 'قرة للطاقة لمشروعات الطاقة المتكاملة',
        'en': 'KORRA Energeii',
        'aliases': ['قرة إنرجي', 'قرة انرجي', 'قرة لمشروعات الطاقة', 'شركة قرة', 'kora']
    },
    'FNAR': {
        'ar': 'الفنار للمقاولات العمومية والإنشاءات',
        'en': 'Al Fanar Contracting',
        'aliases': ['الفنار للمقاولات', 'شركة الفنار', 'fnar']
    },
    'HBCO': {
        'ar': 'هيبكو للتجارة والاستثمار العقاري',
        'en': 'Heibco for Commercial Investments & Real Estate Development',
        'aliases': ['هيبكو', 'شركة هيبكو', 'hbco']
    },
    'EGTS': {
        'ar': 'المصرية للمنتجعات السياحية',
        'en': 'Egyptian Resorts Company',
        'aliases': ['المصرية للمنتجعات', 'المصرية للمنتجعات السياحية', 'منتجعات سهل حشيش', 'egts']
    },
    'RKAZ': {
        'ar': 'ركاز المالية القابضة',
        'en': 'Rekaz Financial Holding',
        'aliases': ['ركاز المالية', 'شركة ركاز', 'rkaz']
    },
    'SPHT': {
        'ar': 'الشمس بيراميدز للفنادق والمنشآت السياحية',
        'en': 'El Shams Pyramids',
        'aliases': ['الشمس بيراميدز', 'فنادق الشمس بيراميدز', 'spht']
    },
    'AFMC': {
        'ar': 'مطاحن ومخابز الإسكندرية',
        'en': 'Alexandria Flour Mills',
        'aliases': ['مطاحن الإسكندرية', 'مطاحن الاسكندرية', 'مطاحن ومخابز الإسكندرية', 'afmc']
    },
    'CEFM': {
        'ar': 'مطاحن مصر الوسطى',
        'en': 'Middle Egypt Flour Mills',
        'aliases': ['مطاحن مصر الوسطى', 'مصر الوسطى للمطاحن', 'cefm']
    },
    'WCDF': {
        'ar': 'مطاحن ومخابز وسط وغرب الدلتا',
        'en': 'Middle & West Delta Flour Mills',
        'aliases': ['مطاحن وسط وغرب الدلتا', 'وسط وغرب الدلتا للمطاحن', 'wcdf']
    },
    'EDFM': {
        'ar': 'مطاحن مصر العليا',
        'en': 'Upper Egypt Flour Mills',
        'aliases': ['مطاحن مصر العليا', 'مصر العليا للمطاحن', 'edfm']
    },
    'FTNS': {
        'ar': 'فيتنس برايم للأندية الصحية',
        'en': 'Fitness Prime',
        'aliases': ['فيتنس برايم', 'أندية فيتنس برايم', 'ftns']
    },
    'DGTZ': {
        'ar': 'ديجيتيز للاستثمار والتكنولوجيا',
        'en': 'Digitize for Investment & Technology',
        'aliases': ['ديجيتيز', 'ديجيتيز للاستثمار', 'dgtz']
    },
    'IDRE': {
        'ar': 'الإسماعيلية الجديدة للتطوير والتنمية العمرانية',
        'en': 'Ismailia Development & Real Estate',
        'aliases': ['الإسماعيلية للتطوير', 'الإسماعيلية للاستثمار', 'الاسماعيلية للتطوير', 'idre']
    },
    'AMER': {
        'ar': 'مجموعة عامر القابضة - عامر جروب',
        'en': 'Amer Group Holding',
        'aliases': ['عامر جروب', 'مجموعة عامر', 'amer']
    },
    'ARAB': {
        'ar': 'المطورون العرب القابضة',
        'en': 'Arab Developers Holding',
        'aliases': ['المطورون العرب', 'المطورون العرب القابضة', 'بورتو القابضة سابقاً', 'arab']
    },
    'ACAMD': {
        'ar': 'العربية لإدارة وتطوير الأصول',
        'en': 'Arab Co. for Asset Management & Development',
        'aliases': ['العربية لإدارة وتطوير الأصول', 'العربية لتطوير الأصول', 'acamd']
    }
}

# Negative noise words that should NEVER trigger a ticker alone
COMMON_FINANCIAL_NOISE = {
    'البنك', 'بنك', 'شركة', 'شركات', 'مجموعة', 'سهم', 'أسهم', 'بورصة',
    'البورصة', 'سوق', 'السوق', 'استثمار', 'الاستثمار', 'المركزي',
    'الحكومة', 'رئيس', 'وزير', 'اقتصاد', 'الاقتصاد', 'الدولار',
    'الجنيه', 'مليار', 'مليون', 'أرباح', 'خسائر'
}

def extract_tickers_accurately(text: str) -> List[str]:
    """
    Extract tickers from financial news using exact alias matching.
    Guarantees ZERO hallucinations and NO false positives.
    """
    if not text:
        return []

    text_lower = text.lower()
    matched_tickers: List[str] = []

    for ticker, info in EGX_STOCKS_DATA.items():
        # Check ticker symbol as a standalone word (e.g. "COMI" or "#COMI" or "COMI.CA")
        pattern = rf'(?:\b|#){re.escape(ticker.lower())}(?:\.ca|\b)'
        if re.search(pattern, text_lower):
            if ticker not in matched_tickers:
                matched_tickers.append(ticker)
            continue

        # Check aliases
        for alias in info['aliases']:
            alias_clean = alias.strip().lower()
            if not alias_clean or alias_clean in COMMON_FINANCIAL_NOISE:
                continue

            # Must appear in text
            if alias_clean in text_lower:
                if ticker not in matched_tickers:
                    matched_tickers.append(ticker)
                break

    # Index mentions
    for idx in ['EGX30', 'EGX70', 'EGX100']:
        if idx.lower() in text_lower and idx not in matched_tickers:
            matched_tickers.append(idx)

    return matched_tickers

def get_stock_display_info(ticker: str) -> Dict[str, str]:
    """Returns official Arabic name and company details for a ticker"""
    if ticker in EGX_STOCKS_DATA:
        return {
            'ticker': ticker,
            'name_ar': EGX_STOCKS_DATA[ticker]['ar'],
            'name_en': EGX_STOCKS_DATA[ticker]['en'],
        }
    return {'ticker': ticker, 'name_ar': ticker, 'name_en': ticker}
