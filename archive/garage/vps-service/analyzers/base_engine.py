#!/usr/bin/env python3
"""
Base Analysis Engine — المحرك الأساسي (الموظف النموذجي)
==========================================================
هذا هو الـ base class الذي ترث منه كل المحركات.
يوفّر:
- واجهة موحّدة (analyze method)
- إدارة المعاملات
- نظام scoring مشترك
- logging

كل محرك متخصص (موظف) يرث من هذا وينفّذ منطقه الخاص.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AnalysisResult:
    """نتيجة تحليل موحّدة لكل المحركات."""
    engine_name: str
    signal: str  # 'BUY' / 'SELL' / 'HOLD'
    score: float  # 0-100
    confidence: float  # 0-100
    factors: List[str] = field(default_factory=list)  # العوامل التي اتفقت
    metadata: Dict[str, Any] = field(default_factory=dict)  # بيانات إضافية
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


class BaseAnalysisEngine(ABC):
    """
    المحرك الأساسي — القالب الذي يرث منه كل الموظفين (المحركات المتخصصة).
    
    كل محرك متخصص ينفّذ:
    - _analyze_core(): المنطق الخاص
    - engine_name: اسم المحرك
    - specialization: تخصص المحرك
    
    المحرك الأساسي يوفّر:
    - analyze(): الواجهة العامة (يستدعي _analyze_core)
    - get_params(): قراءة المعاملات
    - set_params(): تحديث المعاملات
    """
    
    # كل subclass يعرّف هذه
    engine_name: str = 'BaseEngine'
    specialization: str = 'general'  # 'technical', 'fundamental', 'volume', 'multi_timeframe', etc.
    
    def __init__(self, params: Optional[Dict] = None):
        self.params = params or {}
        self._validate_params()
    
    def _validate_params(self):
        """التحقق من المعاملات (override في subclass)."""
        pass
    
    @abstractmethod
    def _analyze_core(
        self,
        prices: List[float],
        highs: List[float] = None,
        lows: List[float] = None,
        volumes: List[float] = None,
        ticker: str = None,
    ) -> AnalysisResult:
        """
        المنطق الخاص بكل محرك — يجب تنفيذه في subclass.
        """
        pass
    
    def analyze(
        self,
        prices: List[float],
        highs: List[float] = None,
        lows: List[float] = None,
        volumes: List[float] = None,
        ticker: str = None,
    ) -> AnalysisResult:
        """
        الواجهة العامة للتحليل.
        تتعامل مع الأخطاء + الـ logging + إرجاع نتيجة موحّدة.
        """
        if not prices or len(prices) < 10:
            return AnalysisResult(
                engine_name=self.engine_name,
                signal='HOLD',
                score=50,
                confidence=0,
                factors=['insufficient_data'],
                metadata={'error': f'need 10+ prices, got {len(prices) if prices else 0}'}
            )
        
        try:
            result = self._analyze_core(prices, highs, lows, volumes, ticker)
            # Ensure engine_name is set
            if not result.engine_name:
                result.engine_name = self.engine_name
            return result
        except Exception as e:
            return AnalysisResult(
                engine_name=self.engine_name,
                signal='HOLD',
                score=50,
                confidence=0,
                factors=[f'error: {str(e)[:50]}'],
                metadata={'error': str(e)}
            )
    
    def get_params(self) -> Dict:
        """قراءة المعاملات."""
        return dict(self.params)
    
    def set_params(self, params: Dict):
        """تحديث المعاملات."""
        self.params.update(params)
        self._validate_params()
    
    def get_info(self) -> Dict:
        """معلومات عن المحرك."""
        return {
            'engine_name': self.engine_name,
            'specialization': self.specialization,
            'params': self.get_params(),
        }


class EngineRegistry:
    """
    سجل المحركات — يحفظ كل المحركات المتاحة (الموظفين).
    المدير يستخدم هذا السجل لاستدعاء المحركات.
    """
    
    _engines: Dict[str, BaseAnalysisEngine] = {}
    
    @classmethod
    def register(cls, engine: BaseAnalysisEngine):
        """تسجيل محرك في السجل."""
        cls._engines[engine.engine_name] = engine
    
    @classmethod
    def get(cls, name: str) -> Optional[BaseAnalysisEngine]:
        """الحصول على محرك بالاسم."""
        return cls._engines.get(name)
    
    @classmethod
    def get_all(cls) -> Dict[str, BaseAnalysisEngine]:
        """كل المحركات المسجّلة."""
        return dict(cls._engines)
    
    @classmethod
    def get_by_specialization(cls, spec: str) -> List[BaseAnalysisEngine]:
        """كل المحركات بتخصص معين."""
        return [e for e in cls._engines.values() if e.specialization == spec]


if __name__ == '__main__':
    """اختبار ذاتي."""
    print("=" * 60)
    print("اختبار Base Analysis Engine")
    print("=" * 60)
    
    # Create a test engine
    class TestEngine(BaseAnalysisEngine):
        engine_name = 'TestEngine'
        specialization = 'technical'
        
        def _analyze_core(self, prices, highs=None, lows=None, volumes=None, ticker=None):
            score = 50 + (prices[-1] - prices[0]) / prices[0] * 100
            signal = 'BUY' if score > 55 else 'SELL' if score < 45 else 'HOLD'
            return AnalysisResult(
                engine_name=self.engine_name,
                signal=signal,
                score=min(100, max(0, score)),
                confidence=abs(score - 50) * 2,
                factors=['price_trend'],
            )
    
    engine = TestEngine()
    EngineRegistry.register(engine)
    
    # Test
    prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]
    result = engine.analyze(prices)
    print(f"\n  Engine: {result.engine_name}")
    print(f"  Signal: {result.signal}")
    print(f"  Score: {result.score:.1f}")
    print(f"  Confidence: {result.confidence:.1f}")
    print(f"  Factors: {result.factors}")
    
    # Registry test
    all_engines = EngineRegistry.get_all()
    print(f"\n  Registered engines: {list(all_engines.keys())}")
    
    print("\n✅ اختبارات نجحت")
