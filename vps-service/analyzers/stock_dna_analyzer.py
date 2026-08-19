#!/usr/bin/env python3
"""
Stock DNA Analyzer (محلل بصمة السهم)
====================================
بيولّد "بصمة السهم" - ملخص سردي لسلوك السهم على مدار السنة،
مناطق التجميع، المواسم القوية، والأحداث التاريخية.

المصادر:
  1. stock_daily_prices (stocks.db) — لتحليل الأداء الشهري والتذبذب
  2. seasonality_scorer — لأنماط EGX المُتحقَّق منها
  3. learned_lessons — لدروس الـ RAG المخزنة
  4. stocks table — للقطاع والاسم

المخرجات:
  {
    "summary": "🧬 بصمة السهم: سهم أساسي بيحب يطلع في الربع الرابع...",
    "personality_type": "سهم أساسي دفاعي",
    "best_months": [{"month": "يناير", "avg_change": 2.3}, ...],
    "worst_months": [...],
    "best_weekday": "الخميس",
    "worst_weekday": "الإثنين",
    "typical_range": {"min": 30, "max": 45, "current_position": "منتصف"},
    "volatility": "متوسطة",
    "annual_return": 12.5,
    "sector": "البنوك",
    "dividend_timing": "عادة يعلن في مارس",
    "behavioral_tags": ["سهم رالي يناير", "يتأثر برمضان"],
    "narrative": "نص سردي كامل"
  }

Author: M2yDevelopers Team
@version 1.0.0
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime, date
import sqlite3
import math
import os
import json
from pathlib import Path
from collections import defaultdict

# P25-LIVING-ENGINE: استيراد مسارات DB الموحّدة (بدل المسارات النسبية الهشّة).
try:
    from utils.db_paths import DBPaths
    _STOCKS_DB = DBPaths.STOCKS_DB
    _PRICE_HISTORY_DB = DBPaths.PRICE_HISTORY_DB
    _PREDICTIONS_DB = DBPaths.PREDICTIONS_DB
except Exception:
    _BASE_DIR = Path(__file__).resolve().parent.parent.parent
    _STOCKS_DB = str(_BASE_DIR / 'db' / 'stocks.db')
    _PRICE_HISTORY_DB = str(_BASE_DIR / 'db' / 'price_history.db')
    _PREDICTIONS_DB = str(_BASE_DIR / 'db' / 'predictions.db')


# ============================================================================
# ثوابت
# ============================================================================
MONTH_NAMES_AR = [
    '', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
]
WEEKDAY_NAMES_AR = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد']


@dataclass
class StockDNA:
    """بصمة السهم"""
    ticker: str
    name: str
    sector: str
    summary: str                    # ملخص قصير
    narrative: str                  # نص سردي كامل
    personality_type: str           # نوع شخصية السهم
    personality_type_en: str
    best_months: List[Dict]
    worst_months: List[Dict]
    best_weekday: str
    worst_weekday: str
    typical_range: Dict
    volatility: str
    volatility_en: str
    annual_return: Optional[float]
    dividend_timing: Optional[str]
    behavioral_tags: List[str]
    sample_months: int
    confidence: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================================
# Stock DNA Analyzer
# ============================================================================
class StockDNAAnalyzer:
    """
    محلل بصمة السهم — بيجمع البيانات من price history + seasonality + lessons.
    """

    def __init__(self, stocks_db: str = None, predictions_db: str = None):
        self.stocks_db = stocks_db or _STOCKS_DB
        self.predictions_db = predictions_db or _PREDICTIONS_DB

    # ── قراءة معلومات السهم الأساسية ──────────────────────────────────
    def _get_stock_info(self, ticker: str) -> Tuple[str, str]:
        """يرجع (name, sector) للسهم"""
        try:
            conn = sqlite3.connect(f'file:{self.stocks_db}?mode=ro', uri=True, timeout=10)
            cur = conn.cursor()
            cur.execute(
                "SELECT name, name_ar, sector FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1",
                (ticker,)
            )
            row = cur.fetchone()
            conn.close()
            if row:
                name = row[1] or row[0] or ticker
                sector = row[2] or 'غير محدد'
                return name, sector
        except Exception:
            pass
        return ticker, 'غير محدد'

    # ── قراءة التاريخ السعري ──────────────────────────────────────────
    def _get_price_history(self, ticker: str, limit: int = 500) -> List[Dict]:
        """يرجع تاريخ الأسعار اليومية.

        PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        The unified reader returns ``[{date, open, high, low, close, volume}]``
        (oldest-first). The legacy caller also expects ``change_percent`` —
        we recompute it from consecutive closes since the unified reader does
        not return it.
        """
        from data.prices import load_price_history

        candles = load_price_history(ticker, limit=limit)

        history: List[Dict] = []
        prev_close = 0.0
        for c in candles:
            try:
                close = float(c.get('close') or 0)
            except (TypeError, ValueError):
                close = 0.0
            if prev_close > 0:
                change = ((close - prev_close) / prev_close) * 100
            else:
                change = 0.0
            history.append({
                'date': c.get('date'),
                'open': c.get('open') or 0,
                'high': c.get('high') or 0,
                'low': c.get('low') or 0,
                'close': close or 0,
                'volume': c.get('volume') or 0,
                'change_percent': change,
            })
            prev_close = close
        return history

    # ── تحليل الأداء الشهري ───────────────────────────────────────────
    def _analyze_monthly_performance(
        self, history: List[Dict]
    ) -> Tuple[Dict[int, List[float]], Dict[int, float]]:
        """
        يحسب متوسط التغير % لكل شهر.
        Returns: (month_changes, month_avg)
        """
        month_changes: Dict[int, List[float]] = defaultdict(list)
        for h in history:
            try:
                dt = datetime.strptime(h['date'][:10], '%Y-%m-%d')
                change = float(h.get('change_percent', 0))
                if math.isfinite(change):
                    month_changes[dt.month].append(change)
            except (ValueError, TypeError):
                continue

        month_avg: Dict[int, float] = {}
        for m, changes in month_changes.items():
            if changes:
                month_avg[m] = sum(changes) / len(changes)
        return month_changes, month_avg

    # ── تحليل أداء أيام الأسبوع ───────────────────────────────────────
    def _analyze_weekday_performance(
        self, history: List[Dict]
    ) -> Dict[int, float]:
        """يحسب متوسط التغير % لكل يوم أسبوع.
        
        ملاحظة مهمة: البورصة المصرية (EGX) مغلقة يومي الجمعة (4) والسبت (5).
        نستبعد هذين اليومين تماماً من التحليل لأن أي صفوف موجودة لهما في
        قاعدة البيانات هي بيانات ملوّثة (سعر محمول من الخميس بتغير 0%)
        ولا تعكس نشاط تداول حقيقي. بدون هذا الفلتر يظهر "أضعف يوم: الجمعة"
        بشكل خاطئ لأن متوسط التغير فيها = 0%.
        """
        # EGX weekend: Friday(4) & Saturday(5) per Python weekday()
        EGX_WEEKEND = {4, 5}
        weekday_changes: Dict[int, List[float]] = defaultdict(list)
        for h in history:
            try:
                dt = datetime.strptime(h['date'][:10], '%Y-%m-%d')
                wd = dt.weekday()
                # Skip EGX weekend days (market closed — polluted/zero-change rows)
                if wd in EGX_WEEKEND:
                    continue
                change = float(h.get('change_percent', 0))
                if math.isfinite(change):
                    weekday_changes[wd].append(change)
            except (ValueError, TypeError):
                continue

        weekday_avg: Dict[int, float] = {}
        for w, changes in weekday_changes.items():
            if changes:
                weekday_avg[w] = sum(changes) / len(changes)
        return weekday_avg

    # ── حساب التذبذب والمدى ───────────────────────────────────────────
    def _calculate_volatility(self, history: List[Dict]) -> Tuple[str, str, float]:
        """يحسب التذبذب السنوي. Returns: (volatility_ar, volatility_en, annual_vol_pct)"""
        if len(history) < 10:
            return 'غير محدد', 'unknown', 0.0

        daily_returns = []
        for h in history:
            change = float(h.get('change_percent', 0))
            if math.isfinite(change):
                daily_returns.append(change)

        if not daily_returns:
            return 'غير محدد', 'unknown', 0.0

        mean_return = sum(daily_returns) / len(daily_returns)
        variance = sum((r - mean_return) ** 2 for r in daily_returns) / len(daily_returns)
        daily_vol = math.sqrt(variance)
        annual_vol = daily_vol * math.sqrt(252)  # سنوي

        if annual_vol > 40:
            return 'عالية', 'high', round(annual_vol, 1)
        elif annual_vol > 20:
            return 'متوسطة', 'medium', round(annual_vol, 1)
        else:
            return 'منخفضة', 'low', round(annual_vol, 1)

    # ── حساب المدى السعري ─────────────────────────────────────────────
    def _calculate_typical_range(
        self, history: List[Dict]
    ) -> Dict[str, Any]:
        """يحسب المدى السعري النموذجي للسهم"""
        if not history:
            return {'min': 0, 'max': 0, 'current': 0, 'current_position': 'غير محدد'}

        # خد آخر سنة بس للمدى النموذجي
        recent = history[-252:] if len(history) > 252 else history
        highs = [h['high'] for h in recent if h['high'] > 0]
        lows = [h['low'] for h in recent if h['low'] > 0]

        if not highs or not lows:
            return {'min': 0, 'max': 0, 'current': 0, 'current_position': 'غير محدد'}

        price_min = min(lows)
        price_max = max(highs)
        current = history[-1]['close'] if history else 0

        # نسبة موقع السعر الحالي
        if price_max > price_min:
            position_pct = ((current - price_min) / (price_max - price_min)) * 100
            if position_pct < 25:
                position = 'قرب القاع'
            elif position_pct < 50:
                position = 'الثلث السفلي'
            elif position_pct < 75:
                position = 'الثلث الأعلى'
            else:
                position = 'قرب القمة'
        else:
            position = 'مدى ضيق'

        return {
            'min': round(price_min, 2),
            'max': round(price_max, 2),
            'current': round(current, 2),
            'current_position': position,
            'position_pct': round(position_pct, 1) if price_max > price_min else 0,
        }

    # ── حساب العائد السنوي ────────────────────────────────────────────
    def _calculate_annual_return(self, history: List[Dict]) -> Optional[float]:
        """يحسب العائد السنوي التقريبي"""
        if len(history) < 60:  # محتاجين على الأقل ~3 شهور
            return None
        try:
            # آخر سنة
            year_ago = history[-252] if len(history) >= 252 else history[0]
            current = history[-1]
            if year_ago['close'] > 0:
                ret = ((current['close'] - year_ago['close']) / year_ago['close']) * 100
                return round(ret, 1)
        except Exception:
            return None
        return None

    # ── قراءة الدروس المخزنة ──────────────────────────────────────────
    def _get_learned_lessons(self, ticker: str) -> List[str]:
        """يقرأ الدروس المخزنة عن السهم من learned_lessons.

        B2 (Closed-Loop) fix: الـ schema القديم كان بـ يستعلم أعمدة غير موجودة
        (lesson_text, context_json) → silent failure. دلوقتي بنقرأ من مخزن الدروس
        الموحّد (utils.lesson_store) اللي بـ يستخدم الـ schema الفعلي.
        """
        try:
            from utils.lesson_store import get_ticker_lesson_notes
            return get_ticker_lesson_notes(ticker, limit=5)
        except Exception:
            return []

    # ── تحديد نوع شخصية السهم ─────────────────────────────────────────
    def _determine_personality(
        self,
        sector: str,
        volatility_en: str,
        annual_return: Optional[float],
        typical_range: Dict,
    ) -> Tuple[str, str]:
        """يحدد نوع شخصية السهم"""
        # تصنيف بناءً على القطاع والتذبذب والعائد
        is_financial = any(k in sector for k in ['بنك', 'مال', 'Bank', 'Financial'])
        is_real_estate = any(k in sector for k in ['عقار', 'Real', 'Estate'])
        is_industrial = any(k in sector for k in ['صنا', 'Industrial', 'Manufact'])

        if volatility_en == 'low' and annual_return is not None and annual_return > 5:
            return 'سهم دفاعي مستقر', 'defensive_stable'
        elif volatility_en == 'high' and annual_return is not None and annual_return > 15:
            return 'سهم مضاربي صاعد', 'speculative_bull'
        elif volatility_en == 'high':
            return 'سهم مضاربي متذبذب', 'speculative_volatile'
        elif is_financial:
            return 'سهم بنكي أساسي', 'banking_core'
        elif is_real_estate:
            return 'سهم عقاري', 'real_estate'
        elif is_industrial:
            return 'سهم صناعي', 'industrial'
        elif annual_return is not None and annual_return > 10:
            return 'سهم نمو', 'growth'
        else:
            return 'سهم عام', 'general'

    # ── توليد الـ Behavioral Tags ─────────────────────────────────────
    def _generate_behavioral_tags(
        self,
        ticker: str,
        month_avg: Dict[int, float],
        weekday_avg: Dict[int, float],
    ) -> List[str]:
        """يولّد وسوم سلوكية للسهم"""
        tags = []

        # وسوم شهرية
        if 1 in month_avg and month_avg[1] > 1.0:
            tags.append('سهم رالي يناير')
        if 3 in month_avg and month_avg[3] < -1.0:
            tags.append('يتأثر سلبياً بمارس')
        if 11 in month_avg and month_avg[11] > 1.0:
            tags.append('قوي في نوفمبر')
        if 12 in month_avg and month_avg[12] > 1.0:
            tags.append('تأثير ديسمبر الإيجابي')
        # وسوم صيفية
        summer_avg = [month_avg.get(m, 0) for m in [6, 7, 8]]
        if summer_avg and sum(summer_avg) / len(summer_avg) > 0.5:
            tags.append('قوي في الصيف')

        # وسوم أيام الأسبوع
        if 3 in weekday_avg and weekday_avg[3] > 0.2:  # Thursday
            tags.append('قوي يوم الخميس')
        if 0 in weekday_avg and weekday_avg[0] < -0.2:  # Monday
            tags.append('ضعيف يوم الإثنين')

        # وسوم من seasonality_scorer (EGX-specific)
        try:
            from analyzers.seasonality_scorer import STOCK_SPECIFIC_SEASONALITY
            if ticker.upper() in STOCK_SPECIFIC_SEASONALITY:
                stock_data = STOCK_SPECIFIC_SEASONALITY[ticker.upper()]
                if 'january_boost' in stock_data:
                    tags.append('محفّز يناير')
                if 'ramadan_penalty' in stock_data:
                    tags.append('يتأثر برمضان')
                if 'summer_boost' in stock_data:
                    tags.append('قوة صيفية')
        except Exception:
            pass

        return tags[:5]  # حد أقصى 5 وسوم

    # ── توليد الملخص السردي ───────────────────────────────────────────
    def _generate_narrative(
        self,
        ticker: str,
        name: str,
        sector: str,
        personality_ar: str,
        best_months: List[Dict],
        worst_months: List[Dict],
        best_weekday: str,
        worst_weekday: str,
        typical_range: Dict,
        volatility_ar: str,
        annual_return: Optional[float],
        behavioral_tags: List[str],
        lessons: List[str],
    ) -> Tuple[str, str]:
        """يولّد النص السردي الكامل + الملخص القصير"""
        # الملخص القصير
        summary_parts = [f"🧬 بصمة السهم: {personality_ar}"]
        if sector and sector != 'غير محدد':
            summary_parts.append(f"قطاع {sector}")
        if volatility_ar != 'غير محدد':
            summary_parts.append(f"تذبذب {volatility_ar}")
        if annual_return is not None:
            direction = 'صاعد' if annual_return >= 0 else 'هابط'
            summary_parts.append(f"عائد سنوي {direction} {abs(annual_return)}%")
        if typical_range.get('current_position'):
            summary_parts.append(f"حالياً {typical_range['current_position']}")
        summary = ' | '.join(summary_parts)

        # النص الكامل
        lines = []
        lines.append(f"🧬 بصمة السهم — {name} ({ticker})")
        lines.append("")
        lines.append(f"📌 النوع: {personality_ar} — قطاع {sector}")
        if volatility_ar != 'غير محدد':
            lines.append(f"📊 التذبذب: {volatility_ar}")
        if annual_return is not None:
            direction = '📈 صاعد' if annual_return >= 0 else '📉 هابط'
            lines.append(f"📊 العائد السنوي: {direction} {abs(annual_return)}%")

        if typical_range.get('min') and typical_range.get('max'):
            lines.append(
                f"📐 المدى السعري: {typical_range['min']} - {typical_range['max']} جنيه "
                f"(حالياً {typical_range.get('current_position', 'غير محدد')})"
            )

        if best_months:
            best_str = '، '.join(f"{m['month']} ({m['avg_change']:+.1f}%)" for m in best_months[:3])
            lines.append(f"🟢 أفضل الشهور: {best_str}")

        if worst_months:
            worst_str = '، '.join(f"{m['month']} ({m['avg_change']:+.1f}%)" for m in worst_months[:3])
            lines.append(f"🔴 أضعف الشهور: {worst_str}")

        if best_weekday:
            lines.append(f"📅 أفضل يوم: {best_weekday}")
        if worst_weekday:
            lines.append(f"📅 أضعف يوم: {worst_weekday}")

        if behavioral_tags:
            lines.append(f"🏷️ الوسوم: {' · '.join(behavioral_tags)}")

        if lessons:
            lines.append("")
            lines.append("🧠 دروس مخزنة من الذاكرة الخبيرة:")
            for lesson in lessons[:3]:
                lines.append(f"  • {lesson}")

        narrative = '\n'.join(lines)
        return summary, narrative

    # ── تحليل رئيسي ───────────────────────────────────────────────────
    def analyze(
        self,
        ticker: str,
        history: Optional[List[Dict]] = None,
    ) -> Optional[StockDNA]:
        """
        يحلل بصمة السهم بالكامل.

        Args:
            ticker: رمز السهم
            history: تاريخ سعري اختياري (لو متوفر من chart_routes).
                     لو None، بيحاول يقرأه من stock_daily_prices.

        Returns:
            StockDNA أو None لو مفيش بيانات كافية
        """
        ticker = ticker.upper().strip()

        # 1. معلومات أساسية
        name, sector = self._get_stock_info(ticker)

        # 2. التاريخ السعري — استخدم المُمرر أو اقرأ من DB
        if history is None:
            history = self._get_price_history(ticker, limit=500)
        if len(history) < 10:
            return None

        # 3. تحليل الأداء الشهري
        _, month_avg = self._analyze_monthly_performance(history)

        # 4. تحليل أيام الأسبوع
        weekday_avg = self._analyze_weekday_performance(history)

        # 5. التذبذب
        volatility_ar, volatility_en, _ = self._calculate_volatility(history)

        # 6. المدى السعري
        typical_range = self._calculate_typical_range(history)

        # 7. العائد السنوي
        annual_return = self._calculate_annual_return(history)

        # 8. الدروس المخزنة
        lessons = self._get_learned_lessons(ticker)

        # 9. نوع الشخصية
        personality_ar, personality_en = self._determine_personality(
            sector, volatility_en, annual_return, typical_range
        )

        # 10. أفضل/أضعف الشهور
        sorted_months = sorted(month_avg.items(), key=lambda x: x[1], reverse=True)
        best_months = [
            {'month': MONTH_NAMES_AR[m], 'month_num': m, 'avg_change': round(avg, 2)}
            for m, avg in sorted_months[:3] if avg > 0
        ]
        worst_months = [
            {'month': MONTH_NAMES_AR[m], 'month_num': m, 'avg_change': round(avg, 2)}
            for m, avg in sorted_months[-3:] if avg < 0
        ]

        # 11. أفضل/أضعف أيام الأسبوع
        sorted_weekdays = sorted(weekday_avg.items(), key=lambda x: x[1], reverse=True)
        best_weekday = WEEKDAY_NAMES_AR[sorted_weekdays[0][0]] if sorted_weekdays else ''
        worst_weekday = WEEKDAY_NAMES_AR[sorted_weekdays[-1][0]] if sorted_weekdays else ''

        # 12. الوسوم السلوكية
        behavioral_tags = self._generate_behavioral_tags(
            ticker, month_avg, weekday_avg
        )

        # 13. الثقة
        sample_months = len(month_avg)
        if sample_months >= 6 and len(history) >= 120:
            confidence = 'عالية'
        elif sample_months >= 3:
            confidence = 'متوسطة'
        else:
            confidence = 'منخفضة'

        # 14. النص السردي
        summary, narrative = self._generate_narrative(
            ticker, name, sector, personality_ar,
            best_months, worst_months, best_weekday, worst_weekday,
            typical_range, volatility_ar, annual_return,
            behavioral_tags, lessons
        )

        return StockDNA(
            ticker=ticker,
            name=name,
            sector=sector,
            summary=summary,
            narrative=narrative,
            personality_type=personality_ar,
            personality_type_en=personality_en,
            best_months=best_months,
            worst_months=worst_months,
            best_weekday=best_weekday,
            worst_weekday=worst_weekday,
            typical_range=typical_range,
            volatility=volatility_ar,
            volatility_en=volatility_en,
            annual_return=annual_return,
            dividend_timing=None,  # TODO: from dividend_checker
            behavioral_tags=behavioral_tags,
            sample_months=sample_months,
            confidence=confidence,
        )

    # ========================================================================
    # P25-LIVING-ENGINE (Aug 2026): Quantitative Stock DNA
    # ---------------------------------------------------------------------
    # ملف تعريف السهم الديناميكي (Stock DNA) — حقول كمية بيتعبّيها سكريبت
    # يومي (scripts/build_stock_profiles.py) من price_history.db (حتى 25 سنة
    # بيانات على الإنتاج). ده اللي بيخلّي المنصة "كائن حي" يفهم طبيعة كل
    # سهم بدل معادلات عامة ثابتة.
    #
    # الحقول:
    #   - volatility_percentile_90d: أين يقف تذبذب 20 يوم الحالي مقابل توزيع
    #     تذبذبه próprio آخر 90 يوم (0-100).
    #   - avg_atr_pct: متوسط ATR/price*100 (مدى يومي طبيعي).
    #   - avg_volume_20d + volume_spike_threshold: حجمه العادي ومتى يعتبر زخم.
    #   - typical_move_1d/5d/15d: النطاق الحقيقي اللي بيتحرك فيه.
    #   - reaction_to_market_crashes: defensive/resilient/correlated/amplifier.
    # ========================================================================

    def _load_full_history(self, ticker: str) -> List[Dict]:
        """تحميل كامل التاريخ السعري المتاح لسهم (من price_history.db أولاً).

        بيجيب كل الصفوف المتاحة (حتى 25 سنة على الإنتاج) مرتبة زمنياً صعوداً.
        fallback لـ stock_daily_prices في stocks.db لو price_history.db فاضي/ناقص.
        """
        history: List[Dict] = []
        # 1. جرّب price_history.db أولاً (الأرشيف الكامل)
        try:
            if os.path.exists(_PRICE_HISTORY_DB):
                conn = sqlite3.connect(f'file:{_PRICE_HISTORY_DB}?mode=ro', uri=True, timeout=10)
                cur = conn.cursor()
                cur.execute(
                    "SELECT date, open_price, high_price, low_price, close_price, volume "
                    "FROM price_history WHERE ticker = ? COLLATE NOCASE "
                    "AND close_price IS NOT NULL AND close_price > 0 "
                    "ORDER BY date ASC",
                    (ticker,)
                )
                rows = cur.fetchall()
                conn.close()
                if rows:
                    prev_close = None
                    for r in rows:
                        close = float(r[4] or 0)
                        chg = 0.0
                        if prev_close and prev_close > 0:
                            chg = ((close - prev_close) / prev_close) * 100.0
                        history.append({
                            'date': str(r[0] or '')[:10],
                            'open': float(r[1] or r[4] or 0),
                            'high': float(r[2] or r[4] or 0),
                            'low': float(r[3] or r[4] or 0),
                            'close': close,
                            'volume': float(r[5] or 0),
                            'change_percent': chg,
                        })
                        prev_close = close
        except Exception:
            history = []

        # 2. fallback لـ stock_daily_prices (لو price_history فاضي/ناقص)
        if len(history) < 20:
            try:
                conn = sqlite3.connect(f'file:{self.stocks_db}?mode=ro', uri=True, timeout=10)
                cur = conn.cursor()
                cur.execute(
                    "SELECT price_date, open_price, high_price, low_price, close_price, volume, change_percent "
                    "FROM stock_daily_prices WHERE ticker = ? COLLATE NOCASE "
                    "AND close_price IS NOT NULL AND close_price > 0 "
                    "ORDER BY price_date ASC",
                    (ticker,)
                )
                rows = cur.fetchall()
                conn.close()
                if rows:
                    history = []
                    for r in rows:
                        history.append({
                            'date': str(r[0] or '')[:10],
                            'open': float(r[1] or r[4] or 0),
                            'high': float(r[2] or r[4] or 0),
                            'low': float(r[3] or r[4] or 0),
                            'close': float(r[4] or 0),
                            'volume': float(r[5] or 0),
                            'change_percent': float(r[6] or 0),
                        })
            except Exception:
                pass
        return history

    @staticmethod
    def _compute_atr_series(highs: List[float], lows: List[float],
                            closes: List[float], period: int = 14) -> List[float]:
        """حساب سلسلة ATR لكل نقطة (بعد أول period)."""
        n = min(len(highs), len(lows), len(closes))
        if n < period + 1:
            return []
        trs = []
        for i in range(1, n):
            pc = closes[i - 1]
            if pc <= 0:
                trs.append(0.0)
                continue
            tr = max(highs[i] - lows[i], abs(highs[i] - pc), abs(lows[i] - pc))
            trs.append(max(0.0, tr))
        # ATR = rolling mean of TR over `period`
        atrs = []
        for i in range(period - 1, len(trs)):
            window = trs[i - period + 1: i + 1]
            atrs.append(sum(window) / period)
        return atrs

    @staticmethod
    def _percentile_rank(value: float, distribution: List[float]) -> float:
        """نسبة القيم في التوزيع الأقل من value (0-100)."""
        if not distribution:
            return 50.0
        below = sum(1 for v in distribution if v < value)
        return round(100.0 * below / len(distribution), 1)

    def _classify_crash_reaction(self, ticker: str, history: List[Dict]) -> Tuple[str, float, float]:
        """تصنيف رد فعل السهم في الأزمات.

        الاستراتيجية:
          1. نحاول نلاقي مؤشر سوق (EGX30/EGX100) في price_history.db ونحسب أيام
             الأزمة (هبوط المؤشر > 2%)، ونقيس متوسط هبوط السهم في تلك الأيام +
             أيام التعافي.
          2. fallback: نستخدم أسوأ 5% من أيام السهم نفسه (أيام هبوطه > 3%).

        Returns:
            (reaction_class, avg_drawdown_pct, avg_recovery_days)
            reaction_class ∈ {defensive, resilient, correlated, amplifier, unknown}
        """
        if len(history) < 30:
            return 'unknown', 0.0, 0.0

        closes = [h['close'] for h in history if h['close'] > 0]
        if len(closes) < 30:
            return 'unknown', 0.0, 0.0

        # 1. جرّب مؤشر السوق من price_history.db
        crash_days_idx: List[int] = []
        try:
            if os.path.exists(_PRICE_HISTORY_DB):
                conn = sqlite3.connect(f'file:{_PRICE_HISTORY_DB}?mode=ro', uri=True, timeout=10)
                cur = conn.cursor()
                # ابحث عن مؤشر EGX (EGX30, EGX100, أو أي ticker يبدأ بـ EGX ويحتوي رقم)
                cur.execute(
                    "SELECT DISTINCT ticker FROM price_history "
                    "WHERE UPPER(ticker) LIKE 'EGX%' AND ticker NOT IN "
                    "(SELECT ticker FROM stocks) LIMIT 10"
                )
                idx_tickers = [r[0] for r in cur.fetchall()]
                conn.close()
                if idx_tickers:
                    # خد أول مؤشر ونحسب أيام الأزمة
                    conn = sqlite3.connect(f'file:{_PRICE_HISTORY_DB}?mode=ro', uri=True, timeout=10)
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT date, close_price FROM price_history "
                        "WHERE ticker = ? AND close_price > 0 ORDER BY date ASC",
                        (idx_tickers[0],)
                    )
                    idx_rows = cur.fetchall()
                    conn.close()
                    idx_by_date = {str(r[0])[:10]: float(r[1]) for r in idx_rows}
                    # أيام الأزمة = المؤشر هبط > 2%
                    prev = None
                    for h in history:
                        d = h['date']
                        ic = idx_by_date.get(d)
                        if ic and prev and prev > 0:
                            idx_chg = (ic - prev) / prev * 100.0
                            if idx_chg <= -2.0:
                                crash_days_idx.append(history.index(h))
                        prev = ic
        except Exception:
            crash_days_idx = []

        # 2. fallback: أسوأ 5% من أيام السهم نفسه (هبوط > 3%)
        if len(crash_days_idx) < 3:
            crash_days_idx = []
            for i in range(1, len(history)):
                chg = history[i].get('change_percent', 0)
                try:
                    if float(chg) <= -3.0:
                        crash_days_idx.append(i)
                except (TypeError, ValueError):
                    pass

        if len(crash_days_idx) < 2:
            return 'unknown', 0.0, 0.0

        # متوسط هبوط السهم في أيام الأزمة
        drawdowns = []
        recoveries = []
        for idx in crash_days_idx:
            chg = float(history[idx].get('change_percent', 0))
            drawdowns.append(min(0.0, chg))  # سالب
            # أيام التعافي: كم يوم لحد ما السعر يرجع لـ close ما قبل الأزمة
            pre_close = history[idx - 1]['close'] if idx > 0 else history[idx]['close']
            if pre_close <= 0:
                continue
            rec_days = 0
            for j in range(idx + 1, len(history)):
                rec_days += 1
                if history[j]['close'] >= pre_close:
                    break
                if rec_days >= 60:  # cap
                    break
            recoveries.append(rec_days)

        avg_dd = abs(sum(drawdowns) / len(drawdowns)) if drawdowns else 0.0
        avg_rec = sum(recoveries) / len(recoveries) if recoveries else 0.0

        # تصنيف
        if avg_dd < 4.0 and avg_rec < 8.0:
            cls = 'defensive'
        elif avg_dd < 6.0 and avg_rec < 15.0:
            cls = 'resilient'
        elif avg_dd < 9.0:
            cls = 'correlated'
        elif avg_dd >= 9.0 or avg_rec >= 30.0:
            cls = 'amplifier'
        else:
            cls = 'correlated'
        return cls, round(avg_dd, 2), round(avg_rec, 1)

    def compute_quantitative_dna(self, ticker: str,
                                 history: Optional[List[Dict]] = None) -> Optional[Dict[str, Any]]:
        """حساب الـ Stock DNA الكمي لسهم.

        Args:
            ticker: رمز السهم.
            history: تاريخ سعري اختياري (لو None، بيتحمّل كامل من DB).

        Returns:
            dict بالحقول الكمية، أو None لو مفيش بيانات كافية (< 20 يوم).
        """
        ticker = ticker.upper().strip()
        if history is None:
            history = self._load_full_history(ticker)
        if not history or len(history) < 20:
            return None

        closes = [h['close'] for h in history if h['close'] > 0]
        highs = [h['high'] for h in history if h['high'] > 0]
        lows = [h['low'] for h in history if h['low'] > 0]
        volumes = [h['volume'] for h in history]
        changes = [h.get('change_percent', 0) for h in history]
        if len(closes) < 20:
            return None

        # ── ATR + avg_atr_pct ──
        atrs = self._compute_atr_series(highs, lows, closes, period=14)
        atr_pct_series = []
        for i, atr in enumerate(atrs):
            c_idx = i + 14  # يقابل close في السلسلة الأصلية
            if c_idx < len(closes) and closes[c_idx] > 0:
                atr_pct_series.append((atr / closes[c_idx]) * 100.0)
        avg_atr_pct = round(sum(atr_pct_series) / len(atr_pct_series), 3) if atr_pct_series else 0.0

        # ── volatility_percentile_90d ──
        # توزيع تذبذب 20 يوم (rolling std of returns) آخر 90 يوم.
        daily_returns = []
        for i in range(1, len(closes)):
            if closes[i - 1] > 0:
                daily_returns.append((closes[i] - closes[i - 1]) / closes[i - 1] * 100.0)
        rolling_vols = []
        for i in range(20, len(daily_returns) + 1):
            window = daily_returns[i - 20: i]
            if len(window) == 20:
                mean_r = sum(window) / 20
                var = sum((r - mean_r) ** 2 for r in window) / 20
                rolling_vols.append(math.sqrt(var))
        vol_pct_90d = 50.0
        if rolling_vols:
            current_vol = rolling_vols[-1]
            recent_dist = rolling_vols[-90:] if len(rolling_vols) >= 90 else rolling_vols
            vol_pct_90d = self._percentile_rank(current_vol, recent_dist)

        # ── avg_volume_20d + volume_spike_threshold ──
        avg_vol_20 = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 0.0
        vol_mean = sum(volumes) / len(volumes) if volumes else 0.0
        vol_var = sum((v - vol_mean) ** 2 for v in volumes) / len(volumes) if volumes else 0.0
        vol_std = math.sqrt(vol_var)
        spike_thresh = 2.0
        if vol_mean > 0 and vol_std > 0:
            spike_thresh = (vol_mean + 2 * vol_std) / vol_mean
            spike_thresh = max(1.8, min(4.0, spike_thresh))

        # ── typical_move_1d/5d/15d ──
        abs_changes = [abs(float(c)) for c in changes if math.isfinite(float(c or 0))]
        typical_1d = round(sum(abs_changes) / len(abs_changes), 3) if abs_changes else 0.0

        def _window_range_pct(window: List[Dict]) -> float:
            hs = [w['high'] for w in window if w['high'] > 0]
            ls = [w['low'] for w in window if w['low'] > 0]
            if not hs or not ls:
                return 0.0
            mn, mx = min(ls), max(hs)
            return ((mx - mn) / mn) * 100.0 if mn > 0 else 0.0

        ranges_5d = [_window_range_pct(history[i:i + 5]) for i in range(0, len(history) - 5, 5)]
        ranges_15d = [_window_range_pct(history[i:i + 15]) for i in range(0, len(history) - 15, 15)]
        typical_5d = round(sum(ranges_5d) / len(ranges_5d), 3) if ranges_5d else 0.0
        typical_15d = round(sum(ranges_15d) / len(ranges_15d), 3) if ranges_15d else 0.0

        # ── reaction_to_market_crashes ──
        crash_cls, crash_dd, crash_rec = self._classify_crash_reaction(ticker, history)

        # ── personality (reuse existing classifier) ──
        name, sector = self._get_stock_info(ticker)
        vol_annual = avg_atr_pct * math.sqrt(252)  # تقدير سنوي
        vol_en = 'high' if vol_annual > 40 else ('medium' if vol_annual > 20 else 'low')
        # annual return estimate
        annual_ret = None
        if len(closes) >= 60:
            lookback = closes[-252] if len(closes) >= 252 else closes[0]
            if lookback > 0:
                annual_ret = round((closes[-1] - lookback) / lookback * 100, 1)
        _, personality_en = self._determine_personality(sector, vol_en, annual_ret, {})

        # confidence
        hist_days = len(history)
        if hist_days >= 252:
            confidence = 'high'
        elif hist_days >= 90:
            confidence = 'medium'
        else:
            confidence = 'low'

        return {
            'ticker': ticker,
            'sector': sector,
            'volatility_percentile_90d': round(vol_pct_90d, 1),
            'avg_atr_pct': avg_atr_pct,
            'avg_volume_20d': round(avg_vol_20, 0),
            'volume_spike_threshold': round(spike_thresh, 2),
            'typical_move_1d': typical_1d,
            'typical_move_5d': typical_5d,
            'typical_move_15d': typical_15d,
            'reaction_to_market_crashes': crash_cls,
            'crash_avg_drawdown': crash_dd,
            'crash_recovery_days': crash_rec,
            'personality_type_en': personality_en,
            'history_days': hist_days,
            'history_start_date': history[0]['date'] if history else '',
            'history_end_date': history[-1]['date'] if history else '',
            'confidence': confidence,
        }

    def build_and_persist_profile(self, ticker: str,
                                  history: Optional[List[Dict]] = None) -> Optional[Dict[str, Any]]:
        """حساب الـ Stock DNA الكمي وحفظه في stock_adaptive_profiles.

        Returns:
            الـ profile dict اللي اتحفظ، أو None لو مفيش بيانات كافية.
        """
        profile = self.compute_quantitative_dna(ticker, history=history)
        if not profile:
            return None
        try:
            conn = sqlite3.connect(self.stocks_db, timeout=15)
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO stock_adaptive_profiles (
                    ticker, sector, volatility_percentile_90d, avg_atr_pct,
                    avg_volume_20d, volume_spike_threshold,
                    typical_move_1d, typical_move_5d, typical_move_15d,
                    reaction_to_market_crashes, crash_avg_drawdown, crash_recovery_days,
                    personality_type_en, history_days, history_start_date,
                    history_end_date, confidence, updated_at, profile_json
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(ticker) DO UPDATE SET
                    sector=excluded.sector,
                    volatility_percentile_90d=excluded.volatility_percentile_90d,
                    avg_atr_pct=excluded.avg_atr_pct,
                    avg_volume_20d=excluded.avg_volume_20d,
                    volume_spike_threshold=excluded.volume_spike_threshold,
                    typical_move_1d=excluded.typical_move_1d,
                    typical_move_5d=excluded.typical_move_5d,
                    typical_move_15d=excluded.typical_move_15d,
                    reaction_to_market_crashes=excluded.reaction_to_market_crashes,
                    crash_avg_drawdown=excluded.crash_avg_drawdown,
                    crash_recovery_days=excluded.crash_recovery_days,
                    personality_type_en=excluded.personality_type_en,
                    history_days=excluded.history_days,
                    history_start_date=excluded.history_start_date,
                    history_end_date=excluded.history_end_date,
                    confidence=excluded.confidence,
                    updated_at=excluded.updated_at,
                    profile_json=excluded.profile_json
                """,
                (
                    profile['ticker'], profile['sector'],
                    profile['volatility_percentile_90d'], profile['avg_atr_pct'],
                    profile['avg_volume_20d'], profile['volume_spike_threshold'],
                    profile['typical_move_1d'], profile['typical_move_5d'],
                    profile['typical_move_15d'],
                    profile['reaction_to_market_crashes'], profile['crash_avg_drawdown'],
                    profile['crash_recovery_days'], profile['personality_type_en'],
                    profile['history_days'], profile['history_start_date'],
                    profile['history_end_date'], profile['confidence'],
                    datetime.now().isoformat(timespec='seconds'),
                    json.dumps(profile, ensure_ascii=False),
                )
            )
            conn.commit()
            conn.close()
            # امسح الـ cache عشان المحركات تقرأ النسخة الجديدة
            invalidate_profile_cache(ticker)
        except Exception as e:
            print(f"[StockDNA] persist failed for {ticker}: {e}")
        return profile

    def load_profile(self, ticker: str) -> Optional[Dict[str, Any]]:
        """قراءة الـ Stock DNA المحفوظ من stock_adaptive_profiles.

        Returns:
            dict بالـ profile، أو None لو مش موجود/الجدول مش متاح.
        """
        ticker = ticker.upper().strip()
        try:
            conn = sqlite3.connect(f'file:{self.stocks_db}?mode=ro', uri=True, timeout=10)
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(stock_adaptive_profiles)")
            if not cur.fetchall():
                conn.close()
                return None
            cur.execute(
                """SELECT ticker, sector, volatility_percentile_90d, avg_atr_pct,
                          avg_volume_20d, volume_spike_threshold,
                          typical_move_1d, typical_move_5d, typical_move_15d,
                          reaction_to_market_crashes, crash_avg_drawdown, crash_recovery_days,
                          personality_type_en, history_days, confidence, profile_json
                   FROM stock_adaptive_profiles WHERE ticker = ? COLLATE NOCASE LIMIT 1""",
                (ticker,)
            )
            row = cur.fetchone()
            conn.close()
            if not row:
                return None
            return {
                'ticker': row[0],
                'sector': row[1],
                'volatility_percentile_90d': row[2],
                'avg_atr_pct': row[3],
                'avg_volume_20d': row[4],
                'volume_spike_threshold': row[5],
                'typical_move_1d': row[6],
                'typical_move_5d': row[7],
                'typical_move_15d': row[8],
                'reaction_to_market_crashes': row[9],
                'crash_avg_drawdown': row[10],
                'crash_recovery_days': row[11],
                'personality_type_en': row[12],
                'history_days': row[13],
                'confidence': row[14],
                'profile_json': row[15],
            }
        except Exception:
            return None


# ============================================================================
# Singleton + convenience
# ============================================================================


def get_stock_dna_analyzer() -> StockDNAAnalyzer:
    global _analyzer_instance
    if _analyzer_instance is None:
        _analyzer_instance = StockDNAAnalyzer()
    return _analyzer_instance


def analyze_stock_dna(
    ticker: str,
    history: Optional[List[Dict]] = None,
) -> Optional[Dict[str, Any]]:
    """Convenience function — main entry point for chart_routes.py

    Accepts an optional history list (already loaded by chart_routes) to avoid
    duplicate DB reads.
    """
    analyzer = get_stock_dna_analyzer()
    result = analyzer.analyze(ticker, history=history)
    if result is None:
        return None
    return result.to_dict()


# ============================================================================
# P25-LIVING-ENGINE: Stock DNA profile cache + loaders (for the adaptive engines)
# ============================================================================
# المحركات الديناميكية (get_adaptive_weights / adaptive_rr) بتقرأ الـ profile
# ده كل مرة تحليل. عشان نتجنب DB hit لكل سهم في كل دورة، بنعمل cache بسيط
# في الذاكرة. السكريبت اليومي بيعمل invalidate بعد ما يكتب.
_profile_cache: Dict[str, Optional[Dict[str, Any]]] = {}
_PROFILE_CACHE_SIZE = 512


def get_stock_profile(ticker: str) -> Optional[Dict[str, Any]]:
    """قراءة الـ Stock DNA المحفوظ (مع cache في الذاكرة).

    ده اللي بتستخدمه المحركات الديناميكية:
      - get_adaptive_weights() عشان تكيّف الأوزان حسب طبيعة السهم.
      - adaptive_rr() عشان تحسب الستوب/الهدف من النطاق الحقيقي للسهم.
    """
    ticker = ticker.upper().strip()
    if ticker in _profile_cache:
        return _profile_cache[ticker]
    profile = None
    try:
        analyzer = get_stock_dna_analyzer()
        profile = analyzer.load_profile(ticker)
    except Exception:
        profile = None
    # cache (even None عشان م نرجعش DB لو السهم ملوش profile)
    if len(_profile_cache) < _PROFILE_CACHE_SIZE:
        _profile_cache[ticker] = profile
    return profile


def invalidate_profile_cache(ticker: str = None) -> None:
    """إبطال الـ cache (بيستدعيها build_and_persist_profile بعد الكتابة)."""
    if ticker is None:
        _profile_cache.clear()
    else:
        _profile_cache.pop(ticker.upper().strip(), None)


def build_stock_profile(ticker: str,
                        history: Optional[List[Dict]] = None) -> Optional[Dict[str, Any]]:
    """Convenience — احسب واحفظ الـ Stock DNA لسهم."""
    analyzer = get_stock_dna_analyzer()
    return analyzer.build_and_persist_profile(ticker, history=history)


# ============================================================================
# Self-test
# ============================================================================
if __name__ == '__main__':
    # Test with synthetic data (since local dev DB may be empty)
    import random
    random.seed(42)
    test_history = []
    price = 30.0
    from datetime import datetime, timedelta
    base_date = datetime(2024, 1, 1)
    for i in range(300):
        o = price
        # Simulate seasonal effect: stronger in Jan, Nov, Dec
        month = base_date.month
        seasonal = 0.01 if month in [1, 11, 12] else 0
        seasonal = -0.01 if month == 3 else seasonal
        change = random.uniform(-0.02, 0.025) + seasonal
        c = o * (1 + change)
        h = max(o, c) * (1 + random.uniform(0, 0.008))
        l = min(o, c) * (1 - random.uniform(0, 0.008))
        test_history.append({
            'date': base_date.strftime('%Y-%m-%d'),
            'open': o, 'high': h, 'low': l, 'close': c,
            'volume': random.randint(10000, 100000),
            'change_percent': change * 100,
        })
        price = c
        base_date += timedelta(days=1)

    print("=== Testing Stock DNA Analyzer with synthetic data ===")
    result = analyze_stock_dna('TEST', history=test_history)
    if result:
        print(result['summary'])
        print()
        print(result['narrative'])
    else:
        print("❌ No result")
