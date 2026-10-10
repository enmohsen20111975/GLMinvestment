"""
Session Timing Analyzer
=======================
تحليل التوقيت - ديناميكا الجلسة (مش "أفضل ساعات")

القاعدة الذهبية: التوقيت = ديناميكا الجلسة، مش "أفضل ساعة"

Features:
- Session Phase Detection (Opening/Main/Closing)
- Volume Spike Detection
- Price Action Analysis per Phase
- Dynamic Confidence Adjustment

Author: دليل الاستثمار (Based on Kemi's Analysis)
"""

from typing import Dict, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
from datetime import datetime, time

# Safe pytz import with zoneinfo fallback (Python 3.9+)
try:
    import pytz
    CAIRO_TZ = pytz.timezone('Africa/Cairo')
except ImportError:
    from zoneinfo import ZoneInfo
    CAIRO_TZ = ZoneInfo('Africa/Cairo')


class SessionPhase(Enum):
    """مراحل جلسة التداول"""
    PRE_MARKET = "PRE_MARKET"       # قبل الجلسة
    OPENING = "OPENING"             # 10:30 - 11:00 (تقلبات عشوائية)
    MAIN = "MAIN"                   # 11:00 - 14:00 (الاتجاه الحقيقي)
    CLOSING = "CLOSING"             # 14:00 - 14:30 (صفقات إقفال)
    AFTER_HOURS = "AFTER_HOURS"     # بعد الجلسة
    WEEKEND = "WEEKEND"             # عطلة نهاية الأسبوع
    HOLIDAY = "HOLIDAY"             # عطلة رسمية


@dataclass
class SessionAnalysis:
    """تحليل الجلسة"""
    current_phase: SessionPhase
    phase_name_ar: str
    time_cairo: str
    
    # Trading recommendations per phase
    analysis_reliability: float     # 0-1 (كم التحليل موثوق في هذه المرحلة)
    volume_significance: float      # 0-1 (هل الحجم مؤشر مهم الآن)
    
    # Actions
    recommended_action: str         # ماذا تفعل
    confidence_adjustment: float    # تعديل الثقة
    
    # Notes
    notes: str
    
    def to_dict(self) -> Dict:
        return {
            'phase': self.current_phase.value,
            'phase_name_ar': self.phase_name_ar,
            'time_cairo': self.time_cairo,
            'analysis_reliability': round(self.analysis_reliability, 2),
            'volume_significance': round(self.volume_significance, 2),
            'recommended_action': self.recommended_action,
            'confidence_adjustment': round(self.confidence_adjustment, 2),
            'notes': self.notes
        }


class SessionTimingAnalyzer:
    """
    محلل ديناميكا الجلسة
    
    EGX Session (Cairo Time):
    - 10:30 - 11:00: OPENING (مراقبة فقط)
    - 11:00 - 14:00: MAIN (التحليل الفني فعال)
    - 14:00 - 14:30: CLOSING (صفقات إقفال)
    
    Usage:
        analyzer = SessionTimingAnalyzer()
        session = analyzer.analyze()
        
        if session.analysis_reliability > 0.7:
            # التحليل موثوق
        else:
            # تقليل الثقة
    """
    
    # EGX Trading Hours (Cairo Time - UTC+2)
    MARKET_OPEN = time(10, 30)
    OPENING_END = time(11, 0)
    MAIN_END = time(14, 0)
    MARKET_CLOSE = time(14, 30)
    
    # Cairo timezone (use module-level CAIRO_TZ)
    _CAIRO_TZ = CAIRO_TZ
    
    def __init__(self):
        pass
    
    def analyze(self, current_time: datetime = None) -> SessionAnalysis:
        """
        تحليل الجلسة الحالية
        
        Args:
            current_time: الوقت الحالي (اختياري - للاختبار)
            
        Returns:
            SessionAnalysis: تحليل الجلسة
        """
        if current_time is None:
            current_time = datetime.now(self._CAIRO_TZ)
        elif current_time.tzinfo is None:
            if hasattr(self._CAIRO_TZ, 'localize'):
                current_time = self._CAIRO_TZ.localize(current_time)
            else:
                current_time = current_time.replace(tzinfo=self._CAIRO_TZ)
        
        current_time_only = current_time.time()
        weekday = current_time.weekday()  # 0=Monday, 6=Sunday
        
        # Check weekend (Friday=4, Saturday=5 in Egypt)
        # Note: EGX closes on Friday and Saturday
        if weekday >= 5:  # Saturday or Sunday
            return self._create_session(
                SessionPhase.WEEKEND,
                current_time,
                analysis_reliability=0.0,
                volume_significance=0.0,
                recommended_action="السوق مغلق - لا تداول",
                confidence_adjustment=0.0,
                notes="عطلة نهاية الأسبوع"
            )
        
        # Friday in Egypt is weekend too
        if weekday == 4:  # Friday
            return self._create_session(
                SessionPhase.WEEKEND,
                current_time,
                analysis_reliability=0.0,
                volume_significance=0.0,
                recommended_action="السوق مغلق - لا تداول",
                confidence_adjustment=0.0,
                notes="عطلة الجمعة"
            )
        
        # Determine phase
        if current_time_only < self.MARKET_OPEN:
            # Pre-market
            return self._create_session(
                SessionPhase.PRE_MARKET,
                current_time,
                analysis_reliability=0.3,
                volume_significance=0.0,
                recommended_action="مراجعة المحفظة - السوق لم يفتح",
                confidence_adjustment=0.5,
                notes="قبل الجلسة - راجع الأخبار والتوقعات"
            )
        
        elif current_time_only < self.OPENING_END:
            # Opening (10:30 - 11:00)
            return self._create_session(
                SessionPhase.OPENING,
                current_time,
                analysis_reliability=0.3,
                volume_significance=0.4,  # Volume spike expected but not reliable
                recommended_action="مراقبة فقط - لا قرارات",
                confidence_adjustment=0.5,
                notes="جلسة الافتتاح - تقلبات عشوائية + أوامر متراكمة. الحجم أعلى 30% لكنه ليس إشارة موثوقة"
            )
        
        elif current_time_only < self.MAIN_END:
            # Main Session (11:00 - 14:00)
            return self._create_session(
                SessionPhase.MAIN,
                current_time,
                analysis_reliability=0.85,
                volume_significance=0.9,
                recommended_action="التحليل الفني فعال - قرارات موثوقة",
                confidence_adjustment=1.0,
                notes="الجلسة الرئيسية - الاتجاه الحقيقي يتشكل. لو السهم يعلو على حجم = تأكيد"
            )
        
        elif current_time_only < self.MARKET_CLOSE:
            # Closing (14:00 - 14:30)
            return self._create_session(
                SessionPhase.CLOSING,
                current_time,
                analysis_reliability=0.7,
                volume_significance=0.6,
                recommended_action="صفقات إقفال - راقب الإغلاق",
                confidence_adjustment=0.8,
                notes="جلسة الإقفال - صفقات إقفال + تعديلات. الإغلاق فوق/تحت مستوى مهم = إشارة لغداً"
            )
        
        else:
            # After hours
            return self._create_session(
                SessionPhase.AFTER_HOURS,
                current_time,
                analysis_reliability=0.2,
                volume_significance=0.0,
                recommended_action="السوق مغلق - تحليل لغداً",
                confidence_adjustment=0.3,
                notes="بعد الجلسة - راجع الأداء وخطط لغداً"
            )
    
    def _create_session(
        self,
        phase: SessionPhase,
        current_time: datetime,
        analysis_reliability: float,
        volume_significance: float,
        recommended_action: str,
        confidence_adjustment: float,
        notes: str
    ) -> SessionAnalysis:
        """إنشاء كائن SessionAnalysis"""
        phase_names = {
            SessionPhase.PRE_MARKET: "قبل الجلسة",
            SessionPhase.OPENING: "جلسة الافتتاح",
            SessionPhase.MAIN: "الجلسة الرئيسية",
            SessionPhase.CLOSING: "جلسة الإقفال",
            SessionPhase.AFTER_HOURS: "بعد الجلسة",
            SessionPhase.WEEKEND: "عطلة نهاية الأسبوع",
            SessionPhase.HOLIDAY: "عطلة رسمية",
        }
        
        return SessionAnalysis(
            current_phase=phase,
            phase_name_ar=phase_names.get(phase, phase.value),
            time_cairo=current_time.strftime('%H:%M:%S'),
            analysis_reliability=analysis_reliability,
            volume_significance=volume_significance,
            recommended_action=recommended_action,
            confidence_adjustment=confidence_adjustment,
            notes=notes
        )
    
    def is_market_open(self) -> bool:
        """هل السوق مفتوح الآن؟"""
        session = self.analyze()
        return session.current_phase in [SessionPhase.OPENING, SessionPhase.MAIN, SessionPhase.CLOSING]
    
    def get_trading_signal_modifier(self) -> Dict:
        """
        معاملات تعديل الإشارات حسب الجلسة
        
        Returns:
            Dict: معاملات التعديل
        """
        session = self.analyze()
        
        modifiers = {
            'volume_weight_multiplier': session.volume_significance,
            'confidence_multiplier': session.confidence_adjustment,
            'stop_loss_adjustment': 1.0,
            'take_profit_adjustment': 1.0,
        }
        
        # Opening phase: Volume spike should be discounted
        if session.current_phase == SessionPhase.OPENING:
            modifiers['volume_weight_multiplier'] = 0.3  # Volume not reliable
            modifiers['stop_loss_adjustment'] = 1.2      # Wider stops needed
        
        # Closing phase: Watch for reversals
        elif session.current_phase == SessionPhase.CLOSING:
            modifiers['take_profit_adjustment'] = 0.8    # Take profits quicker
        
        return modifiers
    
    def should_delay_trade(self) -> Tuple[bool, str]:
        """
        هل يجب تأخير الصفقة؟
        
        Returns:
            Tuple[bool, str]: (should_delay, reason)
        """
        session = self.analyze()
        
        if session.current_phase == SessionPhase.OPENING:
            return True, "انتظر حتى 11:00 - جلسة الافتتاح غير موثوقة"
        
        if session.current_phase == SessionPhase.PRE_MARKET:
            return True, "السوق لم يفتح بعد"
        
        if session.current_phase == SessionPhase.AFTER_HOURS:
            return True, "السوق مغلق"
        
        if session.current_phase == SessionPhase.WEEKEND:
            return True, "عطلة نهاية الأسبوع"
        
        return False, "يمكن التنفيذ"


# Convenience function
def get_current_session() -> SessionAnalysis:
    """الحصول على الجلسة الحالية"""
    analyzer = SessionTimingAnalyzer()
    return analyzer.analyze()


# For testing
if __name__ == "__main__":
    from datetime import time as t
    
    analyzer = SessionTimingAnalyzer()
    
    print("=== اختبار مراحل الجلسة ===\n")
    
    test_times = [
        t(9, 0),    # Pre-market
        t(10, 30),  # Opening start
        t(10, 45),  # Opening middle
        t(11, 15),  # Main session
        t(13, 0),   # Main session
        t(14, 15),  # Closing
        t(15, 0),   # After hours
    ]
    
    for test_time in test_times:
        dt = datetime.now().replace(hour=test_time.hour, minute=test_time.minute)
        session = analyzer.analyze(dt)
        print(f"{test_time} -> {session.phase_name_ar}: {session.recommended_action}")
