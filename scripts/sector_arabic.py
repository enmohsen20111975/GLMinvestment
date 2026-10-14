"""
sector_arabic.py — قاموس تعريب القطاعات (Canonical Sector Arabic Dictionary)
=================================================================================
Task B-21 (Owner Directive 2026-10-14)

القطاعات في stocks.db بتيجي بنوعين:
  - EGX: أسماء عربية أصلاً (مثل "القطاع المالي", "الصناعات التحويلية")
  - TADAWUL/KSE/QSE/US: أسماء إنجليزية (مثل "Finance", "Consumer Services")

الوحدة دي بترجم الأسماء الإنجليزية للكنون العربي الموحد.
القاموس ثابت (لا DB access) — آمن وآيدمبوتنت.

Rule 27 (NO-FAKE-DATA): ما بنخترعش أسماء — كل اسم عربي موجود فعلاً في EGX
كـ canonical reference. لو الاسم الإنجليزي مش في القاموس، نرجّعه زي ما هو.
"""
from __future__ import annotations

# القاموس الكنسي: English sector name → Arabic canonical name
# المصدر: EGX sectors (العربية الأصلية) + الترجمة القياسية لـ TADAWUL/KSE/QSE/US
SECTOR_ARABIC_MAP = {
    # Finance
    'Finance': 'القطاع المالي',
    # Miscellaneous / Diversified
    'Miscellaneous': 'متفرقات',
    'Diversified': 'متنوع',
    # Process Industries
    'Process Industries': 'الصناعات التحويلية',
    # Consumer Services
    'Consumer Services': 'خدمات المستهلك',
    # Distribution Services
    'Distribution Services': 'خدمات التوزيع',
    # Commercial Services
    'Commercial Services': 'الخدمات التجارية',
    # Technology Services
    'Technology Services': 'خدمات التكنولوجيا',
    # Health Services
    'Health Services': 'الخدمات الصحية',
    # Health Technology
    'Health Technology': 'تكنولوجيا الصحة',
    # Consumer Non-Durables
    'Consumer Non-Durables': 'مستهلك - غير معمرة',
    # Retail Trade
    'Retail Trade': 'تجارة التجزئة',
    # Transportation
    'Transportation': 'وسائل النقل',
    # Industrial Services
    'Industrial Services': 'الخدمات الصناعية',
    # Non-Energy Minerals
    'Non-Energy Minerals': 'المعادن الأخرى - غير مصادر الطاقة',
    # Energy Minerals
    'Energy Minerals': 'معادن الطاقة',
    # Consumer Durables
    'Consumer Durables': 'السلع الاستهلاكية المُعمرة',
    # Communications
    'Communications': 'الاتصالات',
    # Producer Manufacturing
    'Producer Manufacturing': 'الصناعات الموجهة للمنتجين',
    # Electronic Technology
    'Electronic Technology': 'التكنولوجيا الإلكترونية',
    # Utilities
    'Utilities': 'المرافق',
    # Real Estate
    'Real Estate': 'العقارات',
    # Edge cases
    '—': 'متفرقات',
    '': 'متفرقات',
    'Services': 'خدمات',
    'Unknown': 'متفرقات',
    'N/A': 'متفرقات',
}


def arabize_sector(sector: str | None) -> str:
    """رجّع الاسم العربي الكنسي للقطاع.

    - لو الاسم عربي أصلاً → رجّعه زي ما هو
    - لو الاسم إنجليزي في القاموس → رجّع الترجمة العربية
    - لو الاسم مش في القاموس → رجّعه زي ما هو (آمن، لا fabricate)
    - لو None/فاضي → رجّع "متفرقات"
    """
    if not sector or not isinstance(sector, str):
        return 'متفرقات'

    sector_stripped = sector.strip()
    if not sector_stripped:
        return 'متفرقات'

    # لو الاسم عربي أصلاً (فيه حروف عربية) → رجّعه زي ما هو
    if any('\u0600' <= ch <= '\u06FF' for ch in sector_stripped):
        return sector_stripped

    # لو في القاموس → رجّع الترجمة
    if sector_stripped in SECTOR_ARABIC_MAP:
        return SECTOR_ARABIC_MAP[sector_stripped]

    # fallback: رجّع الاسم زي ما هو (لا نخترع ترجمة)
    return sector_stripped


def arabize_sectors_batch(sectors: list[str | None]) -> list[str]:
    """تعريب دفعة من أسماء القطاعات."""
    return [arabize_sector(s) for s in sectors]


if __name__ == '__main__':
    # اختبار سريع
    test_cases = [
        'Finance',
        'Consumer Services',
        'Non-Energy Minerals',
        'القطاع المالي',
        'الصناعات التحويلية',
        None,
        '',
        '—',
        'Unknown Sector XYZ',  # مش في القاموس — fallback
    ]
    print('=== Sector Arabization Test ===')
    for tc in test_cases:
        print(f'  {tc!r:40} → {arabize_sector(tc)!r}')
