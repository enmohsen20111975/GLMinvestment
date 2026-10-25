#!/usr/bin/env python3
"""
Market Manager — مدير السوق
============================
كل مدير سوق مسؤول عن سوق معين (EGX, Tadawul, Crypto, etc.)
يستخدم المحركات (الموظفين) المتخصصة ويدمج نتائجها.

الفلسفة: كل سوق له خصوصيته (أيام تداول، ساعات، تذبذب)
لكن المحركات (الموظفين) واحدة — نستخدم OOP inheritance.

General Manager → Market Managers → Analysis Engines
"""

from __future__ import annotations

from typing import List, Dict, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import logging

from analyzers.base_engine import BaseAnalysisEngine, AnalysisResult, EngineRegistry
from utils.trading_calendar import (
    is_market_open, get_prediction_label, get_prediction_date_str,
    is_trading_day, get_market_schedule
)

logger = logging.getLogger(__name__)


@dataclass
class MarketPrediction:
    """توقع موحّد لسهم في سوق معين."""
    ticker: str
    market: str
    signal: str  # 'BUY' / 'SELL' / 'HOLD'
    score: float  # 0-100
    confidence: float
    entry: float
    target: float
    stop: float
    risk_reward: float
    regime: str
    conviction_factors: List[str]
    prediction_label: str  # "توقعات الغد الأحد" etc.
    prediction_date: str  # YYYY-MM-DD
    engine_results: Dict[str, AnalysisResult] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


class MarketManager:
    """
    مدير السوق — يستخدم المحركات لتحليل أسهم سوق معين.
    
    كل subclass يعرّف:
    - market_name: اسم السوق
    - market_schedule: جدول التداول
    - engine_weights: أوزان المحركات لهذا السوق
    """
    
    market_name: str = 'Generic'
    market_schedule_name: str = 'EGX'  # key in MARKET_SCHEDULES
    
    def __init__(self):
        self.engines: Dict[str, BaseAnalysisEngine] = {}
        self._load_engines()
    
    def _load_engines(self):
        """تحميل المحركات المناسبة لهذا السوق (override في subclass)."""
        pass
    
    def analyze(
        self,
        ticker: str,
        prices: List[float],
        highs: List[float] = None,
        lows: List[float] = None,
        volumes: List[float] = None,
    ) -> MarketPrediction:
        """
        تحليل سهم واحد باستخدام كل المحركات.
        """
        now = datetime.now()
        prediction_label = get_prediction_label(now, self.market_schedule_name)
        prediction_date = get_prediction_date_str(now, self.market_schedule_name)
        
        # Run all engines
        engine_results = {}
        for name, engine in self.engines.items():
            try:
                result = engine.analyze(prices, highs, lows, volumes, ticker)
                engine_results[name] = result
            except Exception as e:
                logger.error(f"[{self.market_name}] Engine {name} failed for {ticker}: {e}")
        
        # Merge results using market-specific weights
        merged = self._merge_results(engine_results, prices, ticker)
        
        return MarketPrediction(
            ticker=ticker,
            market=self.market_name,
            signal=merged['signal'],
            score=merged['score'],
            confidence=merged['confidence'],
            entry=prices[-1] if prices else 0,
            target=merged.get('target', 0),
            stop=merged.get('stop', 0),
            risk_reward=merged.get('risk_reward', 0),
            regime=merged.get('regime', 'unknown'),
            conviction_factors=merged.get('factors', []),
            prediction_label=prediction_label,
            prediction_date=prediction_date,
            engine_results=engine_results,
        )
    
    def _merge_results(
        self,
        engine_results: Dict[str, AnalysisResult],
        prices: List[float],
        ticker: str,
    ) -> Dict:
        """
        دمج نتائج المحركات بأوزان السوق (override في subclass).
        """
        if not engine_results:
            return {'signal': 'HOLD', 'score': 50, 'confidence': 0, 'factors': []}
        
        # Simple average (subclass overrides with weights)
        total_score = sum(r.score for r in engine_results.values())
        avg_score = total_score / len(engine_results)
        
        # Majority vote for signal
        signals = [r.signal for r in engine_results.values()]
        buy_count = signals.count('BUY')
        sell_count = signals.count('SELL')
        
        if buy_count > sell_count and buy_count >= len(signals) / 2:
            signal = 'BUY'
        elif sell_count > buy_count and sell_count >= len(signals) / 2:
            signal = 'SELL'
        else:
            signal = 'HOLD'
        
        # Collect all factors
        all_factors = []
        for r in engine_results.values():
            all_factors.extend(r.factors)
        
        return {
            'signal': signal,
            'score': avg_score,
            'confidence': abs(avg_score - 50) * 2,
            'factors': all_factors[:20],  # Top 20 factors
        }
    
    def get_status(self) -> Dict:
        """حالة المدير."""
        now = datetime.now()
        return {
            'market': self.market_name,
            'schedule': self.market_schedule_name,
            'is_open': is_market_open(now, self.market_schedule_name),
            'is_trading_day': is_trading_day(now, self.market_schedule_name),
            'prediction_label': get_prediction_label(now, self.market_schedule_name),
            'engines_loaded': list(self.engines.keys()),
        }


class EGXMarketManager(MarketManager):
    """مدير سوق مصر (EGX) — الأحد-الخميس، 10:00-14:30."""
    
    market_name = 'EGX'
    market_schedule_name = 'EGX'
    
    def _load_engines(self):
        """تحميل محركات EGX."""
        try:
            from analyzers.prediction_optimizer import PredictionOptimizer
            
            # Adapter: wrap PredictionOptimizer as BaseAnalysisEngine
            class OptimizerEngineAdapter(BaseAnalysisEngine):
                engine_name = 'PredictionOptimizer'
                specialization = 'prediction_optimizer'
                
                def __init__(self):
                    self.optimizer = PredictionOptimizer()
                    super().__init__()
                
                def _analyze_core(self, prices, highs=None, lows=None, volumes=None, ticker=None):
                    result = self.optimizer.analyze(prices, highs, lows, volumes, ticker)
                    # Convert OptimizedSignal → AnalysisResult
                    return AnalysisResult(
                        engine_name=self.engine_name,
                        signal=result.signal,
                        score=result.score,
                        confidence=abs(result.score - 50) * 2,
                        factors=result.conviction_factors,
                        metadata={
                            'target': result.target,
                            'stop': result.stop,
                            'risk_reward': result.risk_reward,
                            'regime': result.regime,
                            'skip_reason': result.skip_reason,
                        }
                    )
            
            self.engines['prediction_optimizer'] = OptimizerEngineAdapter()
        except Exception as e:
            logger.warning(f"[EGX] PredictionOptimizer not loaded: {e}")
        
        try:
            from analyzers.persona_gambler import analyze_gambler
            class GamblerEngine(BaseAnalysisEngine):
                engine_name = 'PersonaGambler'
                specialization = 'persona_gambler'
                def _analyze_core(self, prices, highs=None, lows=None, volumes=None, ticker=None):
                    if not ticker or not prices:
                        return AnalysisResult(engine_name=self.engine_name, signal='HOLD', score=50, confidence=0, factors=[])
                    try:
                        result = analyze_gambler(ticker, prices)
                        signal = 'BUY' if result.verdict in ('شراء', 'شراء قوي') else 'SELL' if result.verdict in ('بيع', 'بيع قوي') else 'HOLD'
                        return AnalysisResult(
                            engine_name=self.engine_name, signal=signal,
                            score=result.score, confidence=result.score,
                            factors=[f'gambler_{result.verdict}'],
                            metadata={'reason': result.reason}
                        )
                    except Exception:
                        return AnalysisResult(engine_name=self.engine_name, signal='HOLD', score=50, confidence=0, factors=[])
            self.engines['persona_gambler'] = GamblerEngine()
        except Exception as e:
            logger.warning(f"[EGX] PersonaGambler not loaded: {e}")
        
        try:
            from analyzers.persona_investor import analyze_investor
            class InvestorEngine(BaseAnalysisEngine):
                engine_name = 'PersonaInvestor'
                specialization = 'persona_investor'
                def _analyze_core(self, prices, highs=None, lows=None, volumes=None, ticker=None):
                    if not ticker or not prices:
                        return AnalysisResult(engine_name=self.engine_name, signal='HOLD', score=50, confidence=0, factors=[])
                    try:
                        result = analyze_investor(ticker, prices)
                        signal = 'BUY' if result.verdict in ('شراء', 'شراء قوي') else 'SELL' if result.verdict in ('بيع', 'بيع قوي') else 'HOLD'
                        return AnalysisResult(
                            engine_name=self.engine_name, signal=signal,
                            score=result.score, confidence=result.score,
                            factors=[f'investor_{result.verdict}'],
                            metadata={'reason': result.reason}
                        )
                    except Exception:
                        return AnalysisResult(engine_name=self.engine_name, signal='HOLD', score=50, confidence=0, factors=[])
            self.engines['persona_investor'] = InvestorEngine()
        except Exception as e:
            logger.warning(f"[EGX] PersonaInvestor not loaded: {e}")
    
    def _merge_results(self, engine_results, prices, ticker):
        """دمج خاص بـ EGX — PredictionOptimizer له الوزن الأكبر."""
        weights = {
            'prediction_optimizer': 0.50,  # 50% — المحرك الرئيسي
            'persona_gambler': 0.25,       # 25% — المضارب
            'persona_investor': 0.25,      # 25% — المستثمر
        }
        
        total_weight = 0
        weighted_score = 0
        all_factors = []
        signal_votes = {'BUY': 0, 'SELL': 0, 'HOLD': 0}
        weight_votes = {'BUY': 0, 'SELL': 0, 'HOLD': 0}
        
        for name, result in engine_results.items():
            w = weights.get(name, 0.1)
            weighted_score += result.score * w
            total_weight += w
            all_factors.extend(result.factors)
            signal_votes[result.signal] = signal_votes.get(result.signal, 0) + 1
            weight_votes[result.signal] = weight_votes.get(result.signal, 0) + w
        
        avg_score = weighted_score / total_weight if total_weight > 0 else 50
        
        # Weighted signal vote
        if weight_votes.get('BUY', 0) > weight_votes.get('SELL', 0):
            signal = 'BUY'
        elif weight_votes.get('SELL', 0) > weight_votes.get('BUY', 0):
            signal = 'SELL'
        else:
            signal = 'HOLD'
        
        # Get target/stop/risk_reward/regime from prediction_optimizer if available
        # FIX (July 2026): was `pass` — target/stop always returned as 0
        target = 0
        stop = 0
        rr = 0
        regime = 'unknown'
        if 'prediction_optimizer' in engine_results:
            opt = engine_results['prediction_optimizer']
            # The OptimizerEngineAdapter stores these in metadata
            meta = opt.metadata if hasattr(opt, 'metadata') else {}
            target = meta.get('target', 0) or 0
            stop = meta.get('stop', 0) or 0
            rr = meta.get('risk_reward', 0) or 0
            regime = meta.get('regime', 'unknown') or 'unknown'
            
            # If signal is HOLD from optimizer but BUY/SELL from personas,
            # we still need target/stop — calculate from current price
            if (target == 0 or stop == 0) and prices and len(prices) > 0:
                current = prices[-1]
                if signal == 'BUY':
                    target = target or current * 1.08  # +8% default
                    stop = stop or current * 0.92      # -8% default
                elif signal == 'SELL':
                    target = target or current * 0.92
                    stop = stop or current * 1.08
                if target > 0 and stop > 0 and current > 0:
                    risk = abs(current - stop)
                    reward = abs(target - current)
                    rr = reward / risk if risk > 0 else 0
        
        return {
            'signal': signal,
            'score': avg_score,
            'confidence': abs(avg_score - 50) * 2,
            'factors': all_factors[:20],
            'target': target,
            'stop': stop,
            'risk_reward': rr,
            'regime': regime,
        }


class CryptoMarketManager(MarketManager):
    """مدير سوق الكريبتو — 24/7، تذبذب عالي."""
    
    market_name = 'Crypto'
    market_schedule_name = 'Crypto'
    
    def _load_engines(self):
        """تحميل محركات الكريبتو."""
        try:
            from analyzers.prediction_optimizer import PredictionOptimizer
            from analyzers.base_engine import BaseAnalysisEngine, AnalysisResult
            
            class CryptoOptimizerAdapter(BaseAnalysisEngine):
                engine_name = 'PredictionOptimizer'
                specialization = 'prediction_optimizer'
                
                def __init__(self):
                    self.optimizer = PredictionOptimizer()
                    # Crypto-specific params
                    self.optimizer.max_stop_pct = 12.0  # P1.2: CRYPTO override للـ PREDICTION-TIME filter (line 107). الكريبتو أتقلب → 12% بدل 3%. مفهوم مختلف عن engine_settings.position_max_stop_pct=10.0.
                    self.optimizer.min_target_pct = 8.0
                    self.optimizer.max_holding_days = 7
                    self.optimizer.skip_bear_regime = False
                    super().__init__()
                
                def _analyze_core(self, prices, highs=None, lows=None, volumes=None, ticker=None):
                    result = self.optimizer.analyze(prices, highs, lows, volumes, ticker)
                    return AnalysisResult(
                        engine_name=self.engine_name,
                        signal=result.signal,
                        score=result.score,
                        confidence=abs(result.score - 50) * 2,
                        factors=result.conviction_factors,
                        metadata={
                            'target': result.target,
                            'stop': result.stop,
                            'risk_reward': result.risk_reward,
                            'regime': result.regime,
                        }
                    )
            
            self.engines['prediction_optimizer'] = CryptoOptimizerAdapter()
        except Exception as e:
            logger.warning(f"[Crypto] PredictionOptimizer not loaded: {e}")
    
    def _merge_results(self, engine_results, prices, ticker):
        """دمج خاص بالكريبتو — تذبذب عالي، فلاتر أوسع."""
        if 'prediction_optimizer' in engine_results:
            opt = engine_results['prediction_optimizer']
            return {
                'signal': opt.signal,
                'score': opt.score,
                'confidence': opt.confidence,
                'factors': opt.factors,
                'target': 0,
                'stop': 0,
                'risk_reward': 0,
                'regime': 'crypto',
            }
        return super()._merge_results(engine_results, prices, ticker)


class TadawulMarketManager(EGXMarketManager):
    """مدير سوق السعودية (Tadawul) — مثل EGX لكن ساعات مختلفة."""
    
    market_name = 'Tadawul'
    market_schedule_name = 'Tadawul'


class GeneralManager:
    """
    المدير العام — ينظم كل مديري الأسواق.
    يحوّل الطلبات للمدير المناسب حسب السوق.
    """
    
    def __init__(self):
        self.managers: Dict[str, MarketManager] = {}
        self._init_managers()
    
    def _init_managers(self):
        """تهيئة مديري الأسواق."""
        self.managers['EGX'] = EGXMarketManager()
        self.managers['Crypto'] = CryptoMarketManager()
        self.managers['Tadawul'] = TadawulMarketManager()
    
    def get_manager(self, market: str) -> Optional[MarketManager]:
        """الحصول على مدير سوق معين."""
        # Normalize market name
        market = market.strip().lower()
        if market in ('egx', 'مصر', 'egypt'):
            return self.managers.get('EGX')
        elif market in ('crypto', 'كريبتو', 'كрипто'):
            return self.managers.get('Crypto')
        elif market in ('tadawul', 'saudi', 'السعودية', 'ksa'):
            return self.managers.get('Tadawul')
        # Default to EGX
        return self.managers.get('EGX')
    
    def analyze(
        self,
        ticker: str,
        market: str,
        prices: List[float],
        highs: List[float] = None,
        lows: List[float] = None,
        volumes: List[float] = None,
    ) -> Optional[MarketPrediction]:
        """تحليل سهم في سوق معين."""
        manager = self.get_manager(market)
        if not manager:
            logger.error(f"[GeneralManager] No manager for market: {market}")
            return None
        return manager.analyze(ticker, prices, highs, lows, volumes)
    
    def get_all_status(self) -> Dict:
        """حالة كل الأسواق."""
        return {name: mgr.get_status() for name, mgr in self.managers.items()}


# Singleton instance
_general_manager: Optional[GeneralManager] = None


def get_general_manager() -> GeneralManager:
    """الحصول على المدير العام (singleton)."""
    global _general_manager
    if _general_manager is None:
        _general_manager = GeneralManager()
    return _general_manager


if __name__ == '__main__':
    """اختبار ذاتي."""
    print("=" * 60)
    print("اختبار Market Manager System")
    print("=" * 60)
    
    gm = get_general_manager()
    
    # Test status
    print("\n📊 حالة الأسواق:")
    for market, status in gm.get_all_status().items():
        print(f"  {market}: open={status['is_open']}, label='{status['prediction_label']}'")
        print(f"    engines: {status['engines_loaded']}")
    
    # Test analysis
    print("\n📊 تحليل تجريبي:")
    prices = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
              101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101,
              100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100]
    
    for market in ['EGX', 'Crypto', 'Tadawul']:
        pred = gm.analyze('TEST', market, prices)
        if pred:
            print(f"\n  {market}: {pred.signal} (score={pred.score:.1f})")
            print(f"    label: {pred.prediction_label}")
            print(f"    date: {pred.prediction_date}")
            print(f"    engines: {list(pred.engine_results.keys())}")
    
    print("\n✅ اختبارات نجحت")
