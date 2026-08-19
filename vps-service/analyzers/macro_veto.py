"""
macro_veto.py — مؤشر الاقتصاد الكلي (الدولار والفائدة) كـ Veto
=================================================================
السوق المصري بيتحرك بالدولار والفائدة.
- لو الدولار ارتفع > 2% خلال 3 أيام → Veto لأسهم الاستيراد + Boost للتصدير
- لو البنك المركزي رفع الفائدة → Veto للعقارات + Boost للبنوك
"""
import sqlite3
import os
from pathlib import Path
from typing import Dict, Any, Optional

_DB_PATH = Path(__file__).parent.parent.parent / 'db' / 'stocks.db'

# القطاعات الحساسة للاستيراد (تتضرر من ارتفاع الدولار)
IMPORT_SECTORS = ['السيارات', 'الكيمياويات', 'الاستيراد', 'AUTO', 'CHEMICALS',
                  'وسائل النقل', 'الصناعات التحويلية']
# القطاعات المستفيدة من ارتفاع الدولار (تصدير/سياحة/عقارات)
EXPORT_SECTORS = ['التصدير', 'السياحة', 'العقارات', 'EXPORT', 'TOURISM',
                  'REAL ESTATE', 'التطوير العقاري', 'الفنادق']
# قطاعات البنوك (تستفيد من ارتفاع الفائدة)
BANK_SECTORS = ['البنوك', 'القطاع المالي', 'BANKS', 'FINANCIAL', 'مصرف']
# قطاعات العقارات (تتضرر من ارتفاع الفائدة)
REAL_ESTATE_SECTORS = ['العقارات', 'التطوير العقاري', 'REAL ESTATE', 'العقارات والتطوير']


class MacroVeto:
    """مؤشر الاقتصاد الكلي - Veto للتوصيات في السوق المصري."""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or str(_DB_PATH)

    def _get_latest_indicators(self) -> Optional[Dict[str, Any]]:
        """يجلب آخر بيانات الاقتصاد الكلي.

        P23-FILTER-HOTFIX: الجدول macro_indicators اتعاد تصميمه لـ key-value schema
        (indicator_name → indicator_value) بواسطة fetch_inflation_worldbank.py.
        قبل كده الكود كان بيقرا أعمدة wide قديمة (date/usd_to_egp/cbe_interest_rate/
        usd_change_3d) اللي مش موجودة في الـ schema الجديد → خطأ
        "table macro_indicators has no column named ...".

        الحل: نقرا بالـ key-value schema. نعمل lookup لكل indicator_name ونرجّع
        dict موحّد. لو الجدول مش موجود أو فاضي → None (الـ evaluate بترجع محايد).
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # نتأكد إن الجدول موجود الأول (تجنّب OperationalError على الـ fresh install)
            try:
                cur.execute("SELECT 1 FROM macro_indicators LIMIT 1")
            except sqlite3.OperationalError:
                conn.close()
                return None  # الجدول مش موجود → محايد

            # اقرا كل الـ indicators المتاحة (key-value rows)
            cur.execute('''
                SELECT indicator_name, indicator_value, updated_at, recorded_at
                FROM macro_indicators
                ORDER BY updated_at DESC
            ''')
            rows = cur.fetchall()
            conn.close()

            if not rows:
                return None

            # ابنِ dict موحّد من الـ key-value rows.
            # نآخذ آخر قيمة لكل indicator_name (الـ ORDER BY updated_at DESC يضمن ده).
            indicators: Dict[str, Any] = {}
            latest_ts = None
            for r in rows:
                name = r['indicator_name']
                if name and name not in indicators:
                    indicators[name] = r['indicator_value']
                    ts = r['updated_at'] or r['recorded_at']
                    if ts and (latest_ts is None or ts > latest_ts):
                        latest_ts = ts

            # رجّع dict بنفس الـ keys اللي الـ evaluate() بيستخدمها،
            # بس بمصطلحات الـ key-value schema.
            return {
                'inflation_rate': indicators.get('inflation_rate', 0) or 0,
                'egypt_inflation': indicators.get('egypt_inflation', 0) or 0,
                # backward-compat keys (لو فيه بيانات wide قديمة على الإنتاج)
                'usd_to_egp': indicators.get('usd_to_egp', 0) or 0,
                'cbe_interest_rate': indicators.get('cbe_interest_rate', 0) or 0,
                'usd_change_3d': indicators.get('usd_change_3d', 0) or 0,
                'date': latest_ts,
            }
        except Exception:
            return None

    def evaluate(self, ticker: str, sector: str = '') -> Dict[str, Any]:
        """
        يُقيّم التوصية بناءً على الاقتصاد الكلي.

        Returns:
            {
                veto: bool,           # True = ارفض التوصية
                veto_reason: str,     # سبب الرفض
                boost: float,         # +10 أو 0
                warnings: list,       # قائمة تحذيرات
                usd_change_3d: float, # تغير الدولار خلال 3 أيام
                interest_rate: float  # سعر الفائدة الحالي
            }
        """
        result = {
            'veto': False,
            'veto_reason': '',
            'boost': 0.0,
            'warnings': [],
            'usd_change_3d': 0.0,
            'interest_rate': 0.0,
            'usd_to_egp': 0.0,
        }

        indicators = self._get_latest_indicators()
        if not indicators:
            return result  # لا توجد بيانات → تجاهل

        usd_change = indicators.get('usd_change_3d', 0) or 0
        interest_rate = indicators.get('cbe_interest_rate', 0) or 0
        usd_rate = indicators.get('usd_to_egp', 0) or 0

        result['usd_change_3d'] = usd_change
        result['interest_rate'] = interest_rate
        result['usd_to_egp'] = usd_rate

        sector_lower = (sector or '').lower().strip()

        # 1. لو الدولار ارتفع > 2% خلال 3 أيام
        if usd_change > 2.0:
            # Veto لأسهم الاستيراد
            for imp_sector in IMPORT_SECTORS:
                if imp_sector.lower() in sector_lower:
                    result['veto'] = True
                    result['veto_reason'] = f'🚨 الدولار ارتفع {usd_change:.1f}% خلال 3 أيام — سهم استيراد ({sector})'
                    result['warnings'].append('الدولار في ارتفاع حاد — أسهم الاستيراد معرضة للخسارة')
                    break

            # Boost لأسهم التصدير/السياحة
            if not result['veto']:
                for exp_sector in EXPORT_SECTORS:
                    if exp_sector.lower() in sector_lower:
                        result['boost'] = 10.0
                        result['warnings'].append(f'الدولار مرتفع — {sector} مستفيد (تصدير/سياحة)')
                        break

        # 2. لو سعر الفائدة مرتفع (> 25% — قيمة تقريبية للسوق المصري)
        if interest_rate >= 25.0 and not result['veto']:
            # Veto لأسهم العقارات
            for re_sector in REAL_ESTATE_SECTORS:
                if re_sector.lower() in sector_lower:
                    result['veto'] = True
                    result['veto_reason'] = f'🚨 سعر الفائدة {interest_rate}% — العقارات تتأثر سلباً'
                    result['warnings'].append('سعر الفائدة مرتفع — العقارات معرضة للضغط')
                    break

            # Boost لأسهم البنوك
            if not result['veto']:
                for bank_sector in BANK_SECTORS:
                    if bank_sector.lower() in sector_lower:
                        if result['boost'] < 10.0:
                            result['boost'] = 10.0
                        result['warnings'].append(f'سعر الفائدة {interest_rate}% — البنوك مستفيدة')
                        break

        return result


# Singleton
_macro_veto = None

def get_macro_veto() -> MacroVeto:
    global _macro_veto
    if _macro_veto is None:
        _macro_veto = MacroVeto()
    return _macro_veto
