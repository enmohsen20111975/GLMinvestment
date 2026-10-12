#!/usr/bin/env python3
"""
align_stock_sectors_ar.py
=========================
تعريب وتوحيد قطاعات البورصة المصرية في db/stocks.db.

يضيف عمود ``sector_ar`` إلى جدول ``stocks`` ويملأه للأسهم النشطة (is_active = 1)
وفق 10 قطاعات معتمدة:

    1.  بنوك
    2.  خدمات مالية غير مصرفية
    3.  عقارات
    4.  موارد أساسية وكيماويات
    5.  أغذية ومشروبات
    6.  رعاية صحية وأدوية
    7.  اتصالات وتكنولوجيا
    8.  مواد بناء
    9.  مقاولات وإنشاءات
    10. سياحة وترفيه

المنطق (Smart Mapping):
    يعتمد على ``sector`` + ``industry`` + ``name`` + ``name_ar`` معًا. الكلمات
    المفتاحية الإنجليزية تُطابَق بـ word-boundary (\\b)، والعربية بـ substring
    (لأن \\b في Python re لا يدعم الحروف العربية).

    ترتيب الفحوصات مهم — الأخص دائمًا أولًا:
        Bank → Insurance → Pharma → Tourism → Tech → Building → Food
        → Construction → RealEstate → Resources → FinServices → SectorDefault

قاعدة Rule 27 (NO-FAKE-DATA):
    إذا تعذّر تحديد القطاع بثقة، يُترك ``sector_ar = NULL`` — لا اختلاق.

السكريبت idempotent — آمن لإعادة التشغيل.
"""

from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "stocks.db"

# =====================================================================
# القطاعات المعتمدة (10 فقط)
# =====================================================================
SECTOR_BANKS = "بنوك"
SECTOR_FIN_SERVICES = "خدمات مالية غير مصرفية"
SECTOR_REAL_ESTATE = "عقارات"
SECTOR_RESOURCES = "موارد أساسية وكيماويات"
SECTOR_FOOD = "أغذية ومشروبات"
SECTOR_HEALTHCARE = "رعاية صحية وأدوية"
SECTOR_TECH = "اتصالات وتكنولوجيا"
SECTOR_BUILDING = "مواد بناء"
SECTOR_CONSTRUCTION = "مقاولات وإنشاءات"
SECTOR_TOURISM = "سياحة وترفيه"

VALID_SECTORS = {
    SECTOR_BANKS,
    SECTOR_FIN_SERVICES,
    SECTOR_REAL_ESTATE,
    SECTOR_RESOURCES,
    SECTOR_FOOD,
    SECTOR_HEALTHCARE,
    SECTOR_TECH,
    SECTOR_BUILDING,
    SECTOR_CONSTRUCTION,
    SECTOR_TOURISM,
}

# =====================================================================
# الكلمات المفتاحية لكل قطاع (عربي + إنجليزي)
# =====================================================================
# ملاحظات:
# - للعربية نستخدم substring (لأن \b لا يدعم Unicode في re).
# - للإنجليزية نستخدم \b للحدود الكلمة (case-insensitive).
# - لا نضع كلمات مفتاحية مشتركة بين قطاعين إلا إذا كان ترتيب الفحص يحل التعارض.

KW_BANK = [
    # صيغ المفرد فقط — الجمع ("البنوك"، "البنكية"، "المصارف") تم إزالتها لأنها
    # قد تظهر في أسماء شركات تقدم خدمات للبنوك دون أن تكون بنوكًا (مثل Fawry
    # التي اسمها العربي "فوري لتكنولوجيا البنوك" — هي شركة تكنولوجيا مدفوعات).
    "بنك", "البنك", "مصرف", "المصرف",
    r"\bbank\b", r"\bbanks\b", r"\bbanque\b",
]

KW_INSURANCE = [
    "تأمين", "التأمين", "إعادة التأمين", "تكافل", "التكافل",
    r"\binsurance\b", r"\breinsurance\b", r"\btakaful\b", r"\binsurer\b",
]

KW_PHARMA = [
    "أدوية", "الدوائية", "للأدوية", "فارما", "صيدل", "الصيدلية", "الصيدلية",
    "مستشفى", "مستشفيات", "مستشفي", "صحية", "الصحية", "رعاية صحية",
    "التغليف الطبي", "العبوات الطبية", "الطبى", "الطبي",
    r"\bpharma\b", r"\bpharmaceutical", r"\bmedical\b", r"\bmedicine\b",
    r"\bdrugs?\b", r"\bhospitals?\b", r"\bhealthcare\b", r"\bhealth care\b",
    r"\bclinics?\b",
]

KW_TOURISM = [
    "سياح", "السياحة", "للسياحة", "للسياحى", "السياحية", "السياحيه",
    "فنادق", "الفنادق", "فندق", "منتجع", "منتجعات", "المنتجعات",
    "ترفيه", "الترفيه", "قرى سياحية", "القرى السياحية", "تنمية سياحية",
    r"\btourism\b", r"\btouristic\b", r"\bhotels?\b", r"\bresorts?\b",
    r"\bleisure\b", r"\bcruises?\b",
]

KW_TECH = [
    "تكنولوجيا", "التكنولوجيا", "للتكنولوجيا", "اتصالات", "الاتصالات",
    "للاتصالات", "الأقمار", "الأقمار الصناعية", "الإلكترونية", "الالكترونية",
    "البرمجيات", "الرقمية", "الرقمي", "للرقمية", "المعلوماتية",
    r"\btechnolog", r"\btelecom", r"\bcommunications?\b", r"\bcommunications?\b",
    r"\bsatellites?\b", r"\belectronic\b", r"\bsoftware\b", r"\bdigital\b",
    r"\binternet\b", r"\bcellular\b", r"\bmobile\b", r"\bcyber\b",
    r"\bdata centers?\b", r"\bcloud\b", r"\bsemiconductor",
    r"\bchips?\b", r"\bprocessors?\b",
]

KW_BUILDING = [
    "أسمنت", "الأسمنت", "لأسمنت", "للاسمنت", "خزف", "الخزف", "للخزف",
    "حديد", "لحديد", "الصلب", "للصلب", "الصيني", "البورسلين", "البورسلان",
    "زجاج", "الزجاج", "جبس", "الجبس", "رخام", "الرخام", "طوب", "الطوب",
    "السيراميك", "سيراميك", "بورسلين", "بورسلان", "للرخام",
    # مواد البناء (القطاع العام) — يلتقط شركات مثل BLDG
    "مواد بناء", "مواد البناء", "للمواد البناء", "مواد التشييد",
    r"\bcement\b", r"\bceramic", r"\bporcelain\b", r"\bporcelan\b",
    r"\bsteel\b", r"\bglass\b", r"\bgypsum\b", r"\bmarble\b",
    r"\bbrick", r"\bsanitar", r"\bsanitaryware\b", r"\bbuilding materials\b",
]

KW_FOOD = [
    "أغذية", "للأغذية", "الغذائية", "للصناعات الغذائية", "مطاحن", "المطاحن",
    "مخابز", "المخابز", "صوامع", "الصوامع", "السكر", "للسكر",
    "الزيوت المستخلصة",  # edible extracted oils — محدد لتجنب "Mineral Oils"
    "دواجن", "للدواجن", "مشروبات", "للمشروبات",
    "ألبان", "للألبان", "لحليج", "حليج", "قطن", "للقطن", "لحوم", "لللحوم",
    "أسماك", "للأسماك", "دقيق", "الأعلاف", "للأعلاف", "أعلاف", "الشوفان",
    "القهوة", "الشاي", "التمور", "العصائر", "المياه", "الغذائى", "الغذائي",
    r"\bfood\b", r"\bfoods?\b", r"\bfoodstuff", r"\b mills?\b", r"\bflour\b",
    r"\bsugar\b", r"\bedible oils?\b", r"\bcooking oils?\b",
    r"\bpoultr", r"\bbeverage", r"\bjuice", r"\bdairy\b", r"\bcotton\b",
    r"\bginning\b", r"\bbaker", r"\bsilos?\b", r"\bmeat\b", r"\bfish\b",
    r"\bfarming\b", r"\bagricultur",
    # ملاحظة: r'\boils?\b' تم إزالتها — "Alexandria Mineral Oils" ليست أغذية
    # (هي زيوت معدنية صناعية). الـ edible oils لها keyword محدد: r'\bedible oils?\b'.
]
# تنبيه: r"\bagricultur" قد يلتقط شركات زراعية ليست أغذية بالضرورة، لكن في سياق
# البورصة المصرية أغلب شركات الاستثمار الزراعي تنتج أغذية (دواجن/أسماك/محاصيل).
# تنبيه: r"\bfertiliz" تم إزالتها من هنا — الأسمدة تذهب لموارد أساسية وكيماويات
# (أنظر KW_RESOURCES) لأن أغلب شركات الأسمدة في EGX صناعات كيماوية.
KW_FOOD = [k for k in KW_FOOD if k not in (r"\bfertiliz", r"\bdistribut")]

KW_CONSTRUCTION = [
    "مقاولات", "للمقاولات", "الإنشاءات", "الانشاءات", "للإنشاء", "للانشاء",
    "للأعمال المدنية", "الأعمال المدنية", "لإنشاء", "لانشاء", "للإنشاءات",
    "للانشاءات", "لإعادة التعمير", "للتعمير والإعمار", "للإنشاء والتعمير",
    "للانشاء والتعمير", "إنشاءات", "لإنشاءات", "للانشاءات",
    r"\bconstruction\b", r"\bcontracting\b", r"\bcontractors?\b",
    r"\brebuilding\b", r"\bcivil works\b", r"\binfrastructur",
]

KW_REAL_ESTATE = [
    "عقار", "عقارية", "عقاري", "العقارية", "العقاري", "للعقارية", "للعقاري",
    "للإسكان", "للاسكان", "الإسكان", "الاسكان", "للتطوير العقاري",
    "التنمية العمرانية", "العمرانية", "للتعمير", "للاستثمار العقاري",
    "للتطوير العقارى", "للتطوير العقاري", "العقارية للتطوير", "العقارية للاستثمار",
    "للاستثمار العقاريى", "للتعمير والتنمية",
    r"\breal estate\b", r"\breits?\b", r"\bproperties\b", r"\bhousing\b",
    r"\bland reclamation\b", r"\burban development\b",
]

KW_RESOURCES = [
    "معادن", "المعادن", "المعدنية", "أسمدة", "الأسمدة", "كيماوية",
    "الكيماوية", "للكيماويات", "بتروكيماويات", "البتروكيماويات",
    "الألومنيوم", "الالومنيوم", "للألمنيوم", "للألومنيوم", "نحاس", "النحاس",
    "ذهب", "الذهب", "تعدين", "التعدين", "بترول", "البترول", "الزيوت المعدنية",
    "للزيوت المعدنية", "فحم", "الفحم", "ملح", "الملح", "كبريت", "الكبريت",
    "بلاستيك", "البلاستيك", "مطاط", "المطاط", "دهانات", "الدهانات",
    "ألياف", "الألياف", "الصناعات الكيماوية", "للصناعات الكيماوية", "بتروكيماوى",
    "للصناعات البترولية", "البترولية", "الصناعات البترولية والكيماوية",
    r"\bminerals?\b", r"\bmining\b", r"\bore\b", r"\bfertiliz",
    r"\bchemical", r"\bpetrochemical", r"\baluminum\b", r"\baluminium\b",
    r"\bcopper\b", r"\bgold\b", r"\bsilver\b", r"\bpetroleum\b",
    r"\bcoal\b", r"\bsalt\b", r"\bsulfur\b", r"\bsulphur\b", r"\bplastic\b",
    r"\brubber\b", r"\bpaints?\b", r"\bcoatings?\b", r"\bfibers?\b",
    r"\bfibres?\b", r"\bmineral oils?\b", r"\biron\b", r"\bzinc\b",
    r"\bnickel\b", r"\bsteel\b",  # steel here too, but KW_BUILDING fires first
]
# ملاحظة: r'\bsteel\b' مكرر في KW_BUILDING و KW_RESOURCES — لكن KW_BUILDING
# يُفحص أولًا (خطوة 6) فيعترض شركات الصلب لمواد البناء. هذا متعمد.

KW_FIN_SERVICES = [
    "قابضة", "القابضة", "للاستثمار", "استثمار", "الاستثمار", "للاستثمارات",
    "للاستثمارات المالية", "للاستثمارات الاقتصادية", "للاستشارات المالية",
    "للأوراق المالية", "للأوراق المالية والسندات", "تداول", "سمسرة", "السمسرة",
    "للسمسرة", "للتأجير التمويلي", "لإدارة الأصول", "للتمويل", "تمويل استهلاكي",
    "المالية القابضة", "رأس المال", "راس المال", "للتداول", "للصرافة",
    "للخدمات المالية", "للاستثمارات المالية والاقتصادية", "للاستثمار والتطوير",
    "للاستثمار المالي", "للتمويل والاستثمار", "للاستثمارات العقارية",  # RE catches first
    r"\bholding\b", r"\binvestment", r"\bcapital\b", r"\bsecurities\b",
    r"\bbrokerage\b", r"\basset management\b", r"\bleasing\b",
    r"\bconsumer finance\b", r"\bfinancial services?\b", r"\bfinancial holding\b",
    r"\bfx\b", r"\bexchange\b", r"\bventure capital\b", r"\bprivate equity\b",
]

# =====================================================================
# القطاعات عالية الوضوح — sector-name → approved sector (لا حاجة لفحص الاسم)
# =====================================================================
SECTOR_DIRECT_MAP = {
    # عقارات
    "Real Estate": SECTOR_REAL_ESTATE,
    # موارد أساسية وكيماويات
    "Energy Minerals": SECTOR_RESOURCES,
    "معادن الطاقة": SECTOR_RESOURCES,
    "Non-Energy Minerals": SECTOR_RESOURCES,
    "المعادن الأخرى - غير مصادر الطاقة": SECTOR_RESOURCES,
    # رعاية صحية وأدوية
    "Health Technology": SECTOR_HEALTHCARE,
    "Health Services": SECTOR_HEALTHCARE,
    "الخدمات الصحية": SECTOR_HEALTHCARE,
    "تكنولوجيا الصحة": SECTOR_HEALTHCARE,
    # اتصالات وتكنولوجيا
    "Technology Services": SECTOR_TECH,
    "خدمات التكنولوجيا": SECTOR_TECH,
    "Communications": SECTOR_TECH,
    "الاتصالات": SECTOR_TECH,
    "Electronic Technology": SECTOR_TECH,
    "التكنولوجيا الإلكترونية": SECTOR_TECH,
}

# القطاعات ذات الافتراضي الواضح (per directive)
# - Process Industries / الصناعات التحويلية → موارد أساسية وكيماويات (إن لم تكن أغذية)
SECTOR_DEFAULT_MAP = {
    "Process Industries": SECTOR_RESOURCES,
    "الصناعات التحويلية": SECTOR_RESOURCES,
}

# القطاعات المالية التي قد تُصنَّف خدمات مالية غير مصرفية إذا لم يظهر اسم قطاع آخر
FINANCIAL_SECTORS = {"Finance", "القطاع المالي", "Diversified", "متفرقات", "Miscellaneous"}


def has_any(text: str, keywords) -> bool:
    """Return True if any regex keyword matches text (case-insensitive)."""
    for kw in keywords:
        try:
            if re.search(kw, text, re.IGNORECASE):
                return True
        except re.error:
            # كلمة عادية (ليست regex) — استخدم substring
            if kw.lower() in text.lower():
                return True
    return False


def classify(stock: dict) -> str | None:
    """تحديد القطاع المعتمد من sector + industry + name + name_ar.

    Returns:
        أحد قيم VALID_SECTORS أو None (Rule 27 — لا اختلاق).
    """
    sector = (stock.get("sector") or "").strip()
    industry = (stock.get("industry") or "").strip()
    name = (stock.get("name") or "").strip()
    name_ar = (stock.get("name_ar") or "").strip()
    # text يجمع كل الحقول للبحث الموحد
    text = f"{sector} | {industry} | {name} | {name_ar}"

    # ===== ترتيب الفحوصات: الأخص أولًا =====

    # 1. بنوك
    if has_any(text, KW_BANK):
        return SECTOR_BANKS

    # 2. تأمين (خدمات مالية غير مصرفية)
    if has_any(text, KW_INSURANCE):
        return SECTOR_FIN_SERVICES

    # 3. رعاية صحية وأدوية
    if has_any(text, KW_PHARMA):
        return SECTOR_HEALTHCARE

    # 4. سياحة وترفيه
    if has_any(text, KW_TOURISM):
        return SECTOR_TOURISM

    # 5. اتصالات وتكنولوجيا
    if has_any(text, KW_TECH):
        return SECTOR_TECH

    # 6. مواد بناء (الصلب/الأسمنت/الخزف/الزجاج...)
    if has_any(text, KW_BUILDING):
        return SECTOR_BUILDING

    # 7. أغذية ومشروبات
    if has_any(text, KW_FOOD):
        return SECTOR_FOOD

    # 8. مقاولات وإنشاءات
    if has_any(text, KW_CONSTRUCTION):
        return SECTOR_CONSTRUCTION

    # 9. عقارات
    if has_any(text, KW_REAL_ESTATE):
        return SECTOR_REAL_ESTATE

    # 10. موارد أساسية وكيماويات
    if has_any(text, KW_RESOURCES):
        return SECTOR_RESOURCES

    # 11a. "Holding" / "قابضة" — مؤشر قوي على شركة قابضة (خدمات مالية غير مصرفية)
    # يعمل بغض النظر عن sector لأن "Holding" بنية مالية بشكل عام.
    # (لو كان الاسم يحوي إشارة قطاع أخرى كـ Real Estate / Pharma، كانت ستُلتقط
    # في خطوات 1-10 قبل هذه الخطوة.)
    if has_any(text, [r"\bholding\b", "قابضة", "القابضة"]):
        return SECTOR_FIN_SERVICES

    # 11b. باقي الكلمات المالية (Investment, Capital, Securities, Brokerage, ...)
    # — فقط لو القطاع مالي (لتجنب الإفراط في التصنيف).
    if sector in FINANCIAL_SECTORS and has_any(text, KW_FIN_SERVICES):
        return SECTOR_FIN_SERVICES

    # 12. القطاعات عالية الوضوح (sector-name → approved sector مباشرة)
    if sector in SECTOR_DIRECT_MAP:
        return SECTOR_DIRECT_MAP[sector]

    # 13. القطاعات ذات الافتراضي (Process Industries → موارد)
    if sector in SECTOR_DEFAULT_MAP:
        return SECTOR_DEFAULT_MAP[sector]

    # ===== Rule 27: لا يمكن التأكد → NULL =====
    return None


def main() -> int:
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # -----------------------------------------------------------------
    # 1. ضمان وجود عمود sector_ar (idempotent)
    # -----------------------------------------------------------------
    cols = [r[1] for r in cur.execute("PRAGMA table_info(stocks)").fetchall()]
    if "sector_ar" not in cols:
        cur.execute("ALTER TABLE stocks ADD COLUMN sector_ar TEXT")
        conn.commit()
        print("[setup] Added column sector_ar to stocks table.")
    else:
        print("[setup] Column sector_ar already exists.")

    # -----------------------------------------------------------------
    # 2. BEFORE: التوزيع الحالي لـ sector_ar للأسهم النشطة
    # -----------------------------------------------------------------
    print("\n=== BEFORE — sector_ar distribution (active stocks) ===")
    before = cur.execute(
        "SELECT COALESCE(sector_ar, '(null)') AS s, COUNT(*) AS n "
        "FROM stocks WHERE is_active = 1 GROUP BY sector_ar ORDER BY n DESC"
    ).fetchall()
    for r in before:
        print(f"  {r['s']:<45} {r['n']}")

    # -----------------------------------------------------------------
    # 3. اقرأ كل الأسهم النشطة
    # -----------------------------------------------------------------
    stocks = cur.execute(
        "SELECT id, ticker, name, name_ar, sector, industry "
        "FROM stocks WHERE is_active = 1"
    ).fetchall()
    print(f"\n[scan] {len(stocks)} active stocks to classify.")

    # -----------------------------------------------------------------
    # 4. صنّف وحدّث
    # -----------------------------------------------------------------
    updates = []
    classified = 0
    null_count = 0
    for s in stocks:
        stock_dict = {
            "sector": s["sector"],
            "industry": s["industry"],
            "name": s["name"],
            "name_ar": s["name_ar"],
        }
        result = classify(stock_dict)
        updates.append((result, s["id"]))
        if result:
            classified += 1
        else:
            null_count += 1

    cur.executemany("UPDATE stocks SET sector_ar = ? WHERE id = ?", updates)
    conn.commit()
    print(f"[update] {classified} classified, {null_count} left NULL (Rule 27).")

    # -----------------------------------------------------------------
    # 5. AFTER: التوزيع الجديد لـ sector_ar
    # -----------------------------------------------------------------
    print("\n=== AFTER — sector_ar distribution (active stocks) ===")
    after = cur.execute(
        "SELECT COALESCE(sector_ar, '(null)') AS s, COUNT(*) AS n "
        "FROM stocks WHERE is_active = 1 GROUP BY sector_ar ORDER BY n DESC"
    ).fetchall()
    for r in after:
        print(f"  {r['s']:<45} {r['n']}")

    # -----------------------------------------------------------------
    # 6. تحقق: هل توجد قيم sector_ar خارج الـ 10 المعتمدة؟
    # -----------------------------------------------------------------
    placeholders = ",".join(["?"] * len(VALID_SECTORS))
    invalid = cur.execute(
        f"SELECT sector_ar, COUNT(*) FROM stocks "
        f"WHERE is_active = 1 AND sector_ar IS NOT NULL "
        f"AND sector_ar NOT IN ({placeholders}) "
        f"GROUP BY sector_ar",
        list(VALID_SECTORS),
    ).fetchall()
    if invalid:
        print(f"\n[WARN] Invalid sector_ar values found: {invalid}")
    else:
        print("\n[validate] All sector_ar values are within the 10 approved sectors.")

    # -----------------------------------------------------------------
    # 7. عينة من الأسهم غير المصنفة (NULL) للمراجعة
    # -----------------------------------------------------------------
    print("\n=== Sample unclassified (sector_ar = NULL) — first 20 ===")
    nulls = cur.execute(
        "SELECT ticker, sector, name, name_ar FROM stocks "
        "WHERE is_active = 1 AND sector_ar IS NULL LIMIT 20"
    ).fetchall()
    for r in nulls:
        sec = (r["sector"] or "")[:25]
        nm = (r["name"] or "")[:35]
        nm_ar = (r["name_ar"] or "")[:30]
        print(f"  {r['ticker']:<10} | sector={sec!r:<28} | en={nm!r:<37} | ar={nm_ar!r}")

    # -----------------------------------------------------------------
    # 8. عينة من الأسهم المصنفة لكل قطاع (للتحقق البصري)
    # -----------------------------------------------------------------
    print("\n=== Sample classified per sector (3 each) ===")
    for sec in sorted(VALID_SECTORS):
        rows = cur.execute(
            "SELECT ticker, name, name_ar, sector FROM stocks "
            "WHERE is_active = 1 AND sector_ar = ? LIMIT 3",
            (sec,),
        ).fetchall()
        print(f"\n  --- {sec} ({len(rows)} shown) ---")
        for r in rows:
            nm = (r["name"] or "")[:35]
            print(f"    {r['ticker']:<10} | {nm!r:<37} | orig_sector={(r['sector'] or '')[:25]!r}")

    conn.close()
    print("\n[done] sector_ar aligned successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
