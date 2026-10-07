"""
Unified Learning Engine - محرك التعلم الموحد
============================================

This is THE BRAIN of the learning system in Python.
Combines all learning logic from Node.js into one unified engine.

Components:
1. Iterative Learning Engine - التعلم التكراري
2. Intelligent Learning (Bayesian Optimization) - التعلم الذكي
3. Mirror Analysis - آلية المرآة (6 أسئلة)
4. Indicator Trust Scores - درجات الثقة للمؤشرات
5. Pattern Detection - اكتشاف الأنماط
6. Lesson Mining - تعدين الدروس
7. Cross-Validation - التحقق المتقاطع

Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY
المعمارية: بايثون = الدماغ، نود جي إس = العرض فقط

@authorM2yDevelopers Team
@version 1.0.0 - Unified Python Brain
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import sqlite3
import json
import math
import random
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# TYPE DEFINITIONS
# ============================================================================

@dataclass
class LearningParameters:
    """بارامترات التعلم"""
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0
    rsi_weight: float = 15.0
    macd_weight: float = 10.0
    ma_weight: float = 12.0
    bollinger_weight: float = 8.0
    stop_loss_min: float = 3.0
    stop_loss_max: float = 8.0
    target_multiplier: float = 2.0
    confidence_threshold: float = 55.0
    min_indicators_agree: int = 2
    volume_threshold: float = 1.5
    volume_weight: float = 5.0


@dataclass
class IterationResult:
    """نتيجة دورة تعلم"""
    iteration: int
    win_rate: float
    total_trades: int
    total_return: float
    parameters: LearningParameters
    changes: List[str] = field(default_factory=list)
    lessons: List[str] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class MirrorAnalysisResult:
    """نتيجة تحليل المرآة"""
    question: str
    answer: bool
    insight: str
    severity: str  # 'info', 'warning', 'critical'


@dataclass
class IndicatorTrustScore:
    """درجة ثقة المؤشر"""
    indicator_name: str
    current_score: float
    base_score: float = 100.0
    total_signals: int = 0
    successful_signals: int = 0
    failed_signals: int = 0
    consecutive_losses: int = 0
    status: str = 'active'  # 'active', 'reflection', 'disabled'
    regime_scores: Dict = field(default_factory=dict)


@dataclass
class PatternResult:
    """نتيجة اكتشاف نمط"""
    pattern_name: str
    occurrences: int
    win_rate: float
    suggested_lesson: str
    suggested_action: str


@dataclass
class ExpectancyResult:
    """نتيجة القيمة المتوقعة"""
    indicator: str
    regime: str
    total_trades: int
    win_rate: float
    avg_win_percent: float
    avg_loss_percent: float
    expectancy: float
    recommendation: str  # 'increase_weight', 'maintain', 'reduce_weight', 'disable'


# ============================================================================
# PERSONA DEFAULTS
# ============================================================================

PERSONA_PARAMETERS = {
    'conservative': LearningParameters(
        rsi_oversold=35, rsi_overbought=65, rsi_weight=12, macd_weight=8,
        ma_weight=15, bollinger_weight=10, stop_loss_min=4, stop_loss_max=6,
        target_multiplier=1.5, confidence_threshold=70, min_indicators_agree=3
    ),
    'balanced': LearningParameters(
        rsi_oversold=30, rsi_overbought=70, rsi_weight=15, macd_weight=10,
        ma_weight=12, bollinger_weight=8, stop_loss_min=3, stop_loss_max=8,
        target_multiplier=2.0, confidence_threshold=55, min_indicators_agree=2
    ),
    'gambler': LearningParameters(
        rsi_oversold=20, rsi_overbought=80, rsi_weight=18, macd_weight=12,
        ma_weight=8, bollinger_weight=5, stop_loss_min=2, stop_loss_max=15,
        target_multiplier=3.0, confidence_threshold=40, min_indicators_agree=1
    ),
    'smart': LearningParameters(
        rsi_oversold=28, rsi_overbought=72, rsi_weight=14, macd_weight=11,
        ma_weight=13, bollinger_weight=9, stop_loss_min=3, stop_loss_max=7,
        target_multiplier=2.2, confidence_threshold=60, min_indicators_agree=2
    ),
    'trend_follower': LearningParameters(
        rsi_oversold=30, rsi_overbought=70, rsi_weight=10, macd_weight=18,
        ma_weight=20, bollinger_weight=6, stop_loss_min=5, stop_loss_max=10,
        target_multiplier=2.5, confidence_threshold=50, min_indicators_agree=2
    ),
}


# ============================================================================
# UNIFIED LEARNING ENGINE
# ============================================================================

class UnifiedLearningEngine:
    """
    محرك التعلم الموحد - THE BRAIN
    
    Combines all learning logic:
    1. Iterative Learning - with backtest
    2. Bayesian Optimization - intelligent parameter tuning
    3. Mirror Analysis - 6 questions after each trade
    4. Indicator Trust Scores - dynamic indicator weights
    5. Pattern Detection - find winning/losing patterns
    6. Lesson Mining - extract lessons from history
    """
    
    # Cross-validation data folds
    DATA_FOLDS = [
        {'name': 'Fold 1: Q1', 'start': '2025-01-01', 'end': '2025-03-31'},
        {'name': 'Fold 2: Q2', 'start': '2025-04-01', 'end': '2025-06-30'},
        {'name': 'Fold 3: Q3', 'start': '2025-07-01', 'end': '2025-09-30'},
        {'name': 'Fold 4: Q4', 'start': '2025-10-01', 'end': '2025-12-31'},
        {'name': 'Fold 5: Full Year', 'start': '2025-01-01', 'end': '2025-12-31'},
    ]
    
    # Indicator types
    INDICATORS = ['RSI', 'MACD', 'Ichimoku', 'Fibonacci', 'Bollinger', 
                  'MA', 'ADX', 'Stochastic', 'Volume', 'SupportResistance']
    
    # Win rate thresholds
    WR_BLOCK_THRESHOLD = 0.40
    WR_BOOST_THRESHOLD = 0.65
    MIN_SAMPLES_FOR_DECISION = 5
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.current_progress = None
        self.should_stop = False
        self.auto_apply_threshold = 60.0
        
    def get_connection(self) -> sqlite3.Connection:
        """الحصول على اتصال قاعدة البيانات"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    
    # ========================================================================
    # ITERATIVE LEARNING ENGINE
    # ========================================================================
    
    def run_iterative_learning(
        self,
        persona: str = 'balanced',
        target_win_rate: float = 75.0,
        max_iterations: int = 30,
        on_progress: callable = None
    ) -> Dict:
        """
        تشغيل التعلم التكراري
        
        Args:
            persona: نوع الشخصية
            target_win_rate: الهدف المطلوب
            max_iterations: أقصى عدد دورات
            on_progress: callback للتحديث
        
        Returns:
            Dict: نتائج التعلم
        """
        logger.info(f"Starting Iterative Learning - Persona: {persona}, Target: {target_win_rate}%")
        
        # Initialize parameters
        params = PERSONA_PARAMETERS.get(persona, PERSONA_PARAMETERS['balanced'])
        iterations = []
        best_win_rate = 0.0
        best_params = params
        improvement_history = []
        
        for i in range(1, max_iterations + 1):
            if self.should_stop:
                break
            
            # Run backtest simulation (using prediction_logs)
            result = self._run_backtest_iteration(params)
            
            # Analyze losses
            analysis = self._analyze_losses(result['trades'], params)
            
            # Record iteration
            iteration = IterationResult(
                iteration=i,
                win_rate=result['win_rate'],
                total_trades=result['total_trades'],
                total_return=result['total_return'],
                parameters=params,
                changes=[],
                lessons=analysis['issues']
            )
            iterations.append(iteration)
            improvement_history.append(result['win_rate'])
            
            # Update best
            if result['win_rate'] > best_win_rate:
                best_win_rate = result['win_rate']
                best_params = params
            
            # Callback
            if on_progress:
                on_progress(iteration)
            
            logger.info(f"Iteration {i}: Win Rate = {result['win_rate']:.1f}%")
            
            # Check target
            if result['win_rate'] >= target_win_rate:
                logger.info(f"TARGET REACHED! Win Rate: {result['win_rate']:.1f}%")
                break
            
            # Apply adjustments
            if i < max_iterations:
                changes = self._apply_adjustments(analysis['suggestions'], params)
                iteration.changes = changes
        
        return {
            'success': best_win_rate > 50,
            'target_achieved': best_win_rate >= target_win_rate,
            'final_win_rate': best_win_rate,
            'target_win_rate': target_win_rate,
            'total_iterations': len(iterations),
            'iterations': iterations,
            'best_parameters': best_params,
            'improvement_history': improvement_history
        }
    
    def _run_backtest_iteration(self, params: LearningParameters) -> Dict:
        """تشغيل دورة backtest"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Verify if tables have validated prediction logs
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'")
        has_table = cursor.fetchone() is not None
        
        predictions = []
        if has_table:
            # Get validated predictions
            cursor.execute('''
                SELECT 
                    ticker,
                    predicted_direction,
                    direction_correct_5d,
                    confidence
                FROM prediction_logs
                WHERE confidence >= ?
                ORDER BY prediction_date DESC
                LIMIT 1000
            ''', (params.confidence_threshold,))
            rows = cursor.fetchall()
            
            # Map database rows to dicts with fallback fields
            predictions = []
            for r in rows:
                predictions.append({
                    'ticker': r['ticker'],
                    'predicted_direction': r['predicted_direction'],
                    'direction_correct_5d': r['direction_correct_5d'],
                    'composite_score': r['confidence'],
                    'confidence': r['confidence'],
                    'market_regime': 'UNKNOWN'
                })
            
        conn.close()
        
        # If no real predictions exist in the DB, fallback to price history simulation
        if not predictions or len(predictions) < 15:
            logger.info("No validated predictions found in prediction_logs. Running simulation on stock_price_history...")
            sim_preds = self._get_simulated_predictions(params)
            predictions = [p for p in sim_preds if p['confidence'] >= params.confidence_threshold]
            
            if not predictions:
                return {'win_rate': 50.0, 'total_trades': 0, 'total_return': 0.0, 'trades': []}
                
            wins = sum(1 for p in predictions if p['direction_correct_5d'] == 1)
            total = len(predictions)
            win_rate = (wins / total * 100) if total > 0 else 50.0
            
            return {
                'win_rate': win_rate,
                'total_trades': total,
                'total_return': win_rate - 50.0,
                'trades': predictions
            }
            
        # Calculate win rate for real predictions
        wins = sum(1 for p in predictions if p['direction_correct_5d'] == 1)
        total = len(predictions)
        win_rate = (wins / total * 100) if total > 0 else 50.0
        
        return {
            'win_rate': win_rate,
            'total_trades': total,
            'total_return': win_rate - 50.0,
            'trades': predictions
        }
    
    def _analyze_losses(self, trades: List, params: LearningParameters) -> Dict:
        """تحليل الصفقات الخاسرة"""
        issues = []
        suggestions = []
        
        if not trades:
            return {'issues': issues, 'suggestions': suggestions}
        
        losers = [t for t in trades if t['direction_correct_5d'] != 1]
        winners = [t for t in trades if t['direction_correct_5d'] == 1]
        
        if not losers:
            return {'issues': ['All trades are winners!'], 'suggestions': []}
        
        # Analyze confidence
        low_conf_losers = [l for l in losers if l['confidence'] < 60]
        if len(low_conf_losers) > len(losers) * 0.4:
            issues.append(f"Low confidence trades: {len(low_conf_losers)} losses")
            suggestions.append(f"Raise confidence threshold to {min(85, params.confidence_threshold + 5)}")
        
        # Analyze regime
        bear_losers = [l for l in losers if l['market_regime'] == 'BEAR']
        if len(bear_losers) > len(losers) * 0.6:
            issues.append("Many losses in BEAR market")
            suggestions.append("Reduce position size in BEAR regime")
        
        return {'issues': issues, 'suggestions': suggestions}
    
    def _apply_adjustments(self, suggestions: List[str], params: LearningParameters) -> List[str]:
        """تطبيق التعديلات"""
        changes = []
        
        for suggestion in suggestions:
            if 'confidence' in suggestion.lower() and 'raise' in suggestion.lower():
                old = params.confidence_threshold
                params.confidence_threshold = min(85, old + 5)
                changes.append(f"Confidence: {old} -> {params.confidence_threshold}")
            
            elif 'position' in suggestion.lower():
                changes.append("Reduced position size for risky regimes")
        
        return changes
    
    # ========================================================================
    # MIRROR ANALYSIS - آلية المرآة
    # ========================================================================
    
    def run_mirror_analysis(self, trade_id: int) -> List[MirrorAnalysisResult]:
        """
        تحليل المرآة - 6 أسئلة بعد كل صفقة مغلقة
        
        Args:
            trade_id: معرف الصفقة
        
        Returns:
            List[MirrorAnalysisResult]: نتائج التحليل
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        
        results = []
        
        # Get trade, outcome, and signal data
        cursor.execute('''
            SELECT 
                ol.*,
                sl.ticker, sl.direction, sl.score, sl.indicators,
                sl.sector, sl.regime
            FROM outcome_logs ol
            JOIN signal_logs sl ON ol.trade_id = sl.id
            WHERE ol.trade_id = ?
        ''', (trade_id,))
        
        data = cursor.fetchone()
        conn.close()
        
        if not data:
            return results
        
        is_profit = data['profit_loss_percent'] > 0
        entry_price = data.get('actual_exit_price', 0)  # Simplified
        indicators = json.loads(data['indicators']) if data['indicators'] else []
        
        # Question 1: هل دخلت ضد السوق؟
        regime = data['regime'] or 'RANGE'
        direction = data['direction']
        
        if (regime == 'BEAR' and direction == 'buy') or (regime == 'BULL' and direction == 'sell'):
            results.append(MirrorAnalysisResult(
                question="هل دخلت ضد السوق؟",
                answer=True,
                insight="السباحة ضد التيار غالية - السوق كان ضدك" if not is_profit 
                        else "نجحت رغم السباحة ضد التيار - لكن هذا استثناء",
                severity='warning' if not is_profit else 'info'
            ))
        
        # Question 2: هل الدرجة كانت عالية والنتيجة سيئة؟
        score = data['score'] or 50
        if score > 80 and not is_profit:
            results.append(MirrorAnalysisResult(
                question="هل الدرجة العالية لم تتنبأ بالنتيجة؟",
                answer=True,
                insight="المؤشرات المتعددة ممكن تتفق على غلط - درجة عالية لا تعني ضمان",
                severity='critical'
            ))
        
        # Question 3: هل كان فيه خبر أثر؟
        # Check context_logs if available
        
        # Question 4: هل المؤشرات كانت متوافقة؟
        if len(indicators) < 2:
            results.append(MirrorAnalysisResult(
                question="هل المؤشرات كانت كافية؟",
                answer=False,
                insight=f"فقط {len(indicators)} مؤشر - قليل جداً للثقة",
                severity='warning'
            ))
        
        # Question 5: هل القطاع مناسب؟
        sector = data['sector']
        if sector:
            sector_win_rate = self._get_sector_win_rate(sector, regime)
            if sector_win_rate < 40:
                results.append(MirrorAnalysisResult(
                    question="هل القطاع مناسب في هذا الطور؟",
                    answer=False,
                    insight=f"قطاع {sector} في طور {regime} له Win Rate {sector_win_rate:.0f}%",
                    severity='warning'
                ))
        
        # Question 6: هل الـ Risk/Reward مناسب؟
        profit_pct = data['profit_loss_percent']
        if is_profit and profit_pct > 10:
            results.append(MirrorAnalysisResult(
                question="هل الربح مناسب؟",
                answer=True,
                insight=f"ربح {profit_pct:.1f}% - ممتاز!",
                severity='info'
            ))
        elif not is_profit and profit_pct < -8:
            results.append(MirrorAnalysisResult(
                question="هل الخسارة كبيرة جداً؟",
                answer=True,
                insight=f"خسارة {profit_pct:.1f}% - الوقف كان لازم يكون أقرب",
                severity='critical'
            ))
        
        return results
    
    def _get_sector_win_rate(self, sector: str, regime: str) -> float:
        """الحصول على Win Rate القطاع"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins
            FROM outcome_logs ol
            JOIN signal_logs sl ON ol.trade_id = sl.id
            WHERE sl.sector = ? AND sl.regime = ?
        ''', (sector, regime))
        
        result = cursor.fetchone()
        conn.close()
        
        if result and result['total'] > 0:
            return (result['wins'] / result['total']) * 100
        return 50.0
    
    # ========================================================================
    # INDICATOR TRUST SCORES - درجات الثقة للمؤشرات
    # ========================================================================
    
    def get_indicator_trust_scores(self) -> List[IndicatorTrustScore]:
        """الحصول على كل درجات الثقة"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM indicator_trust_scores')
        rows = cursor.fetchall()
        
        # If empty, populate with defaults
        if not rows:
            logger.info("Initializing indicator_trust_scores table with defaults...")
            for ind in self.INDICATORS:
                cursor.execute('''
                    INSERT OR IGNORE INTO indicator_trust_scores 
                    (indicator_name, current_score, base_score, status, regime_scores)
                    VALUES (?, 100.0, 100.0, 'active', '{}')
                ''', (ind,))
            conn.commit()
            cursor.execute('SELECT * FROM indicator_trust_scores')
            rows = cursor.fetchall()
            
        conn.close()
        
        scores = []
        for row in rows:
            scores.append(IndicatorTrustScore(
                indicator_name=row['indicator_name'],
                current_score=row['current_score'],
                base_score=row['base_score'],
                total_signals=row['total_signals'],
                successful_signals=row['successful_signals'],
                failed_signals=row['failed_signals'],
                consecutive_losses=row['consecutive_losses'],
                status=row['status'],
                regime_scores=json.loads(row['regime_scores']) if row['regime_scores'] else {}
            ))
        
        return scores
    
    def update_indicator_trust_score(
        self,
        indicator: str,
        profit_percent: float,
        is_profit: bool
    ) -> IndicatorTrustScore:
        """
        تحديث درجة ثقة المؤشر بعد صفقة
        
        CRITICAL FIX: Symmetric, proportional scoring
        - Score change = profitPercent × multiplier
        - Losses get proportional penalty (not excessive)
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Get current score
        cursor.execute(
            'SELECT * FROM indicator_trust_scores WHERE indicator_name = ?',
            (indicator,)
        )
        current = cursor.fetchone()
        
        if not current:
            # Initialize new indicator
            cursor.execute('''
                INSERT INTO indicator_trust_scores 
                (indicator_name, current_score, base_score, status)
                VALUES (?, 100, 100, 'active')
            ''', (indicator,))
            current_score = 100.0
            consecutive_losses = 0
        else:
            current_score = current['current_score']
            consecutive_losses = current['consecutive_losses']
        
        # Calculate score change (symmetric)
        base_multiplier = 1.5
        if is_profit:
            score_change = min(abs(profit_percent) * base_multiplier, 20)
            consecutive_losses = 0
        else:
            score_change = max(-abs(profit_percent) * base_multiplier, -15)
            consecutive_losses += 1
        
        new_score = max(0, min(200, current_score + score_change))
        
        # Determine status
        new_status = 'active'
        if new_score <= 30:
            new_status = 'disabled'
        elif consecutive_losses >= 3 or new_score < 60:
            new_status = 'reflection'
        
        # Update
        cursor.execute('''
            UPDATE indicator_trust_scores SET
                current_score = ?,
                total_signals = total_signals + 1,
                successful_signals = successful_signals + ?,
                failed_signals = failed_signals + ?,
                consecutive_losses = ?,
                status = ?,
                last_updated = datetime('now')
            WHERE indicator_name = ?
        ''', (new_score, 1 if is_profit else 0, 0 if is_profit else 1,
              consecutive_losses, new_status, indicator))
        
        conn.commit()
        conn.close()
        
        return IndicatorTrustScore(
            indicator_name=indicator,
            current_score=new_score,
            consecutive_losses=consecutive_losses,
            status=new_status
        )
    
    # ========================================================================
    # PATTERN DETECTION - اكتشاف الأنماط
    # ========================================================================
    
    def detect_patterns(self, months_back: int = 1) -> List[PatternResult]:
        """اكتشاف الأنماط المتكررة"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cutoff_date = (datetime.now() - timedelta(days=months_back * 30)).strftime('%Y-%m-%d')
        
        # Find patterns: indicators + regime + result
        cursor.execute('''
            SELECT 
                sl.indicators,
                sl.regime,
                sl.sector,
                COUNT(*) as cnt,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins
            FROM signal_logs sl
            JOIN outcome_logs ol ON ol.trade_id = sl.id
            WHERE sl.signal_date >= ?
            GROUP BY sl.indicators, sl.regime, sl.sector
            HAVING cnt >= 3
        ''', (cutoff_date,))
        
        patterns = cursor.fetchall()
        conn.close()
        
        results = []
        for p in patterns:
            win_rate = (p['wins'] / p['cnt']) * 100 if p['cnt'] > 0 else 50
            
            if win_rate < 40:  # Losing pattern
                indicators = json.loads(p['indicators']) if p['indicators'] else []
                results.append(PatternResult(
                    pattern_name=f"{'+'.join(indicators[:2])} in {p['regime']} ({p['sector']})",
                    occurrences=p['cnt'],
                    win_rate=win_rate,
                    suggested_lesson=f"تجنب {' و'.join(indicators[:2])} في السوق {p['regime']}",
                    suggested_action=f"تقليل وزن {indicators[0] if indicators else 'unknown'} 50%"
                ))

            elif win_rate > 65:  # Winning pattern
                indicators = json.loads(p['indicators']) if p['indicators'] else []
                results.append(PatternResult(
                    pattern_name=f"{'+'.join(indicators[:2])} in {p['regime']} ({p['sector']})",
                    occurrences=p['cnt'],
                    win_rate=win_rate,
                    suggested_lesson=f"تركيز على {' و'.join(indicators[:2])} في السوق {p['regime']}",
                    suggested_action=f"زيادة وزن {indicators[0] if indicators else 'unknown'} 20%"
                ))
        
        return results
    
    # ========================================================================
    # EXPECTANCY CALCULATION - القيمة المتوقعة
    # ========================================================================
    
    def calculate_expectancy(self, regime: str = None) -> List[ExpectancyResult]:
        """حساب القيمة المتوقعة للمؤشرات"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        results = []
        
        for indicator in self.INDICATORS:
            if regime:
                cursor.execute('''
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                        AVG(CASE WHEN ol.profit_loss_percent > 0 THEN ol.profit_loss_percent END) as avg_win,
                        AVG(CASE WHEN ol.profit_loss_percent <= 0 THEN ABS(ol.profit_loss_percent) END) as avg_loss
                    FROM signal_logs sl
                    JOIN outcome_logs ol ON ol.trade_id = sl.id
                    WHERE sl.indicators LIKE ? AND sl.regime = ?
                ''', (f'%{indicator}%', regime))
            else:
                cursor.execute('''
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                        AVG(CASE WHEN ol.profit_loss_percent > 0 THEN ol.profit_loss_percent END) as avg_win,
                        AVG(CASE WHEN ol.profit_loss_percent <= 0 THEN ABS(ol.profit_loss_percent) END) as avg_loss
                    FROM signal_logs sl
                    JOIN outcome_logs ol ON ol.trade_id = sl.id
                    WHERE sl.indicators LIKE ?
                ''', (f'%{indicator}%',))
            
            stats = cursor.fetchone()
            
            if stats['total'] < 5:
                continue
            
            win_rate = stats['wins'] / stats['total']
            avg_win = stats['avg_win'] or 0
            avg_loss = stats['avg_loss'] or 0
            
            # Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
            expectancy = (win_rate * avg_win) - ((1 - win_rate) * avg_loss)
            
            if expectancy > 3:
                recommendation = 'increase_weight'
            elif expectancy >= 1:
                recommendation = 'maintain'
            elif expectancy >= 0:
                recommendation = 'reduce_weight'
            else:
                recommendation = 'disable'
            
            results.append(ExpectancyResult(
                indicator=indicator,
                regime=regime or 'ALL',
                total_trades=stats['total'],
                win_rate=win_rate * 100,
                avg_win_percent=avg_win,
                avg_loss_percent=avg_loss,
                expectancy=expectancy,
                recommendation=recommendation
            ))
        
        conn.close()
        return sorted(results, key=lambda x: x.expectancy, reverse=True)
    
    # ========================================================================
    # LESSON MINING - تعدين الدروس
    # ========================================================================
    
    def mine_lessons(self) -> List[Dict]:
        """تعدين الدروس التلقائي"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        lessons = []
        
        # 1. Pattern-based lessons
        patterns = self.detect_patterns(1)
        for p in patterns:
            if p.win_rate < 40 and p.occurrences >= 3:
                cursor.execute('''
                    INSERT OR IGNORE INTO learned_lessons 
                    (lesson_type, title, description, trigger_conditions, action, confidence, occurrences)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    'direct',
                    f'نمط خاسر: {p.pattern_name}',
                    f'هذا النمط خسر {100-p.win_rate:.0f}% من المرات ({p.occurrences} محاولات)',
                    json.dumps({'pattern': p.pattern_name}),
                    p.suggested_action,
                    -10,
                    p.occurrences
                ))
                lessons.append({
                    'type': 'pattern',
                    'title': f'نمط خاسر: {p.pattern_name}',
                    'action': p.suggested_action
                })
        
        # 2. Sector-Regime lessons
        cursor.execute('''
            SELECT 
                sl.sector, sl.regime,
                COUNT(*) as total,
                SUM(CASE WHEN ol.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
                AVG(ol.profit_loss_percent) as avg_pnl
            FROM signal_logs sl
            JOIN outcome_logs ol ON ol.trade_id = sl.id
            WHERE sl.sector IS NOT NULL
            GROUP BY sl.sector, sl.regime
            HAVING total >= 5 AND (wins * 1.0 / total) < 0.4
        ''')
        
        bad_combos = cursor.fetchall()
        for combo in bad_combos:
            win_rate = (combo['wins'] / combo['total']) * 100
            cursor.execute('''
                INSERT OR IGNORE INTO learned_lessons 
                (lesson_type, title, description, trigger_conditions, action, confidence, occurrences)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                'environmental',
                f'تحذير قطاع: {combo["sector"]} في {combo["regime"]}',
                f'قطاع {combo["sector"]} في طور {combo["regime"]} لديه Win Rate {win_rate:.0f}%',
                json.dumps({'sector': combo['sector'], 'regime': combo['regime']}),
                f'تقليل التداول في {combo["sector"]} خلال {combo["regime"]}',
                -15,
                combo['total']
            ))
            lessons.append({
                'type': 'sector_regime',
                'title': f'تحذير قطاع: {combo["sector"]} في {combo["regime"]}',
                'action': f'تقليل التداول في {combo["sector"]} خلال {combo["regime"]}'
            })
        
        conn.commit()
        conn.close()
        
        return lessons
    
    # ========================================================================
    # CROSS-VALIDATION - التحقق المتقاطع
    # ========================================================================
    
    def cross_validate(
        self,
        params: LearningParameters,
        folds: int = 5
    ) -> Dict:
        """
        التحقق المتقاطع للبارامترات
        
        Returns:
            Dict: متوسط Win Rate والانحراف المعياري
        """
        results = []
        
        for i in range(min(folds, len(self.DATA_FOLDS))):
            fold = self.DATA_FOLDS[i]
            
            # Run backtest on this fold
            result = self._run_backtest_for_period(
                params,
                fold['start'],
                fold['end']
            )
            results.append(result)
        
        if not results:
            return {'avg_win_rate': 50.0, 'std_dev': 0, 'cv_score': 50.0}
        
        avg_win_rate = sum(r['win_rate'] for r in results) / len(results)
        variance = sum((r['win_rate'] - avg_win_rate) ** 2 for r in results) / len(results)
        std_dev = math.sqrt(variance)
        
        # CV Score = Average - (StdDev × 0.5)
        cv_score = avg_win_rate - (std_dev * 0.5)
        
        return {
            'avg_win_rate': avg_win_rate,
            'std_dev': std_dev,
            'cv_score': cv_score,
            'fold_results': results
        }
    
    def _run_backtest_for_period(
        self,
        params: LearningParameters,
        start_date: str,
        end_date: str
    ) -> Dict:
        """تشغيل backtest لفترة محددة"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                predicted_direction,
                direction_correct_5d,
                confidence
            FROM prediction_logs
            WHERE validated = 1
            AND prediction_date >= ?
            AND prediction_date <= ?
            AND confidence >= ?
        ''', (start_date, end_date, params.confidence_threshold))
        
        predictions = cursor.fetchall()
        conn.close()
        
        if not predictions:
            return {'win_rate': 50.0, 'total_trades': 0, 'period': f'{start_date} to {end_date}'}
        
        wins = sum(1 for p in predictions if p['direction_correct_5d'] == 1)
        total = len(predictions)
        
        return {
            'win_rate': (wins / total * 100) if total > 0 else 50.0,
            'total_trades': total,
            'period': f'{start_date} to {end_date}'
        }
    
    # ========================================================================
    # INTELLIGENT LEARNING (BAYESIAN) - التعلم الذكي
    # ========================================================================
    
    def run_intelligent_learning(
        self,
        target_win_rate: float = 75.0,
        max_iterations: int = 50,
        custom_initial_params: LearningParameters = None
    ) -> Dict:
        """
        تشغيل التعلم الذكي مع Bayesian Optimization
        
        Returns:
            Dict: نتائج التعلم
        """
        logger.info(f"Starting Intelligent Learning - Target: {target_win_rate}%")
        
        params = custom_initial_params or PERSONA_PARAMETERS['balanced']
        iterations = []
        best_win_rate = 0.0
        best_params = params
        no_improvement_count = 0
        
        for i in range(1, max_iterations + 1):
            if self.should_stop:
                break
            
            # Get random fold for this iteration
            fold_idx = i % len(self.DATA_FOLDS)
            fold = self.DATA_FOLDS[fold_idx]
            
            # Run backtest
            result = self._run_backtest_for_period(
                params, fold['start'], fold['end']
            )
            
            # Analyze parameter impact
            impacts = self._analyze_parameter_impact(result, params)
            
            # Bayesian suggestions
            bayesian = self._bayesian_suggest(iterations, params)
            
            # Record iteration
            iteration = {
                'iteration': i,
                'win_rate': result['win_rate'],
                'total_trades': result['total_trades'],
                'fold': fold['name'],
                'parameters': params,
                'changes': [],
                'timestamp': datetime.now().isoformat()
            }
            iterations.append(iteration)
            
            # Update best
            if result['win_rate'] > best_win_rate:
                best_win_rate = result['win_rate']
                best_params = params
                no_improvement_count = 0
                logger.info(f"NEW BEST: {best_win_rate:.1f}% on {fold['name']}")
            else:
                no_improvement_count += 1
            
            # Check target
            if result['win_rate'] >= target_win_rate:
                logger.info(f"TARGET REACHED! Win Rate: {result['win_rate']:.1f}%")
                break
            
            # Apply adjustments
            if no_improvement_count >= 10:
                # Radical reset — بدل random.randint، استخدم قيمة ثابتة (70)
                # CRITICAL FIX (2026-08-28): random كان بيخلي النظام غير reproducible
                # لو احتجنا radical reset مختلف كل مرة، لازم يكون deterministic (hash-based)
                params.confidence_threshold = 70
                iteration['changes'].append(f"Radical reset: confidence -> {params.confidence_threshold} (deterministic)")
                no_improvement_count = 0
            else:
                # Apply impacts and Bayesian
                for impact in impacts[:2]:
                    setattr(params, impact['param'], impact['value'])
                    iteration['changes'].append(f"{impact['param']} -> {impact['value']}")
        
        return {
            'success': best_win_rate > 50,
            'target_achieved': best_win_rate >= target_win_rate,
            'final_win_rate': best_win_rate,
            'target_win_rate': target_win_rate,
            'total_iterations': len(iterations),
            'iterations': iterations,
            'best_parameters': best_params
        }
    
    def _analyze_parameter_impact(
        self,
        result: Dict,
        params: LearningParameters
    ) -> List[Dict]:
        """تحليل تأثير البارامترات"""
        impacts = []
        
        # Confidence threshold impact
        if result['win_rate'] < 50:
            impacts.append({
                'param': 'confidence_threshold',
                'value': min(85, params.confidence_threshold + 5),
                'confidence': 0.7,
                'reason': 'Raising threshold to filter weak signals'
            })
        
        # Stop loss impact
        if result['win_rate'] < 45:
            impacts.append({
                'param': 'stop_loss_min',
                'value': min(6, params.stop_loss_min + 0.5),
                'confidence': 0.5,
                'reason': 'Tightening stop loss'
            })
        
        return impacts
    
    def _bayesian_suggest(
        self,
        history: List[Dict],
        params: LearningParameters
    ) -> Dict:
        """اقتراحات Bayesian بناءً على التاريخ"""
        if len(history) < 3:
            return {}
        
        # Find which parameter changes correlated with improvements
        suggestions = {}
        
        for i in range(1, len(history)):
            prev = history[i - 1]
            curr = history[i]
            
            if curr['win_rate'] > prev['win_rate']:
                # This iteration improved - note what changed
                # Simplified: just track confidence threshold
                diff = curr['parameters'].confidence_threshold - prev['parameters'].confidence_threshold
                if abs(diff) > 0.01:
                    suggestions['confidence_threshold'] = curr['parameters'].confidence_threshold + diff
        
        return suggestions
    
    def _get_simulated_predictions(self, params: LearningParameters) -> List[Dict]:
        """توليد توقعات محاكاة من تاريخ الأسعار الفعلي لملء الفراغ عند البداية الباردة"""
        import sqlite3
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # 1. الحصول على أنشط الأسهم في السوق المصري
        cursor.execute('''
            SELECT ticker FROM stocks 
            WHERE is_active = 1 
            ORDER BY volume DESC 
            LIMIT 15
        ''')
        tickers = [r['ticker'] for r in cursor.fetchall()]
        
        if not tickers:
            tickers = ['COMI', 'TALAT', 'FWRY', 'EAST', 'ABUK', 'HRHO', 'EKHO']
            
        predictions = []
        
        for ticker in tickers:
            # 2. الحصول على الأسعار التاريخية لكل سهم
            cursor.execute('''
                SELECT date, open, high, low, close, volume
                FROM stock_price_history
                WHERE ticker = ?
                ORDER BY date ASC
                LIMIT 150
            ''', (ticker,))
            bars = [dict(r) for r in cursor.fetchall()]
            
            if len(bars) < 25:
                continue
                
            # 3. حساب المتوسطات المتحركة والمؤشرات ومحاكاة إشارات تداول
            for i in range(14, len(bars) - 5):
                close_prices_14 = [b['close'] for b in bars[i-14:i]]
                close_price = bars[i]['close']
                
                sma_14 = sum(close_prices_14) / 14
                variance = sum((x - sma_14) ** 2 for x in close_prices_14) / 14
                std_dev = math.sqrt(variance) if variance > 0 else 1.0
                
                # RSI — CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
                # قبل كده: كان SMA-based على الـ 14 شمعة في النافذة فقط — غلط رياضيًا.
                from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
                _rsi_val = _canonical_calc_rsi(close_prices_14, 14)
                rsi = _rsi_val if _rsi_val is not None else 50.0
                
                # تحديد حالة الاتجاه (Regime)
                regime = 'BULL' if close_price > sma_14 else 'BEAR'
                
                is_buy_signal = False
                if close_price < (sma_14 - 1.0 * std_dev) or rsi < params.rsi_oversold:
                    is_buy_signal = True
                    
                if is_buy_signal:
                    entry_price = close_price
                    future_bars = bars[i+1:i+6]
                    high_future = max(b['high'] or b['close'] for b in future_bars)
                    low_future = min(b['low'] or b['close'] for b in future_bars)
                    
                    stop_loss_val = entry_price * (1 - params.stop_loss_min / 100)
                    target_val = entry_price * (1 + (params.stop_loss_min * params.target_multiplier) / 100)
                    
                    hit_target = high_future >= target_val
                    hit_stop = low_future <= stop_loss_val
                    
                    was_correct = 0
                    if hit_target and not hit_stop:
                        was_correct = 1
                    elif hit_stop:
                        was_correct = 0
                    else:
                        final_close = future_bars[-1]['close']
                        was_correct = 1 if final_close > entry_price else 0
                        
                    confidence_score = 60.0 + (params.rsi_oversold - rsi) if rsi < params.rsi_oversold else 65.0
                    confidence_score = min(95.0, max(45.0, confidence_score))
                    
                    predictions.append({
                        'ticker': ticker,
                        'predicted_direction': 'UP',
                        'direction_correct_5d': was_correct,
                        'composite_score': confidence_score + 5,
                        'confidence': confidence_score,
                        'market_regime': regime,
                        'prediction_date': bars[i]['date']
                    })
                    
        conn.close()
        return predictions

    def learn_from_errors(self, market: str = 'EGX', persona: str = 'balanced') -> Dict:
        """
        التعلم من الأخطاء الفعلية
        1. البحث عن الصفقات الخاسرة/التوقعات الخاطئة في قاعدة البيانات النشطة stocks.db
        2. في حال عدم وجود أخطاء مسجلة، المحاكاة من تاريخ الأسعار لاستخلاص الدروس وتحديث البارامترات
        3. ضبط الإعدادات لتجنب هذه الأخطاء مستقبلاً وحفظها في active_settings.json
        """
        import os
        import json
        logger.info(f"Running learn_from_errors for market: {market}, persona: {persona}")
        
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # 1. محاولة استخراج الأخطاء الفعلية من جدول التوقعات والتحليلات
        failures = []
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cursor.fetchall()]
        
        if 'predictions' in tables:
            try:
                cursor.execute("""
                    SELECT * FROM predictions
                    WHERE is_correct = 0
                    ORDER BY prediction_date DESC
                    LIMIT 200
                """)
                failures.extend([dict(r) for r in cursor.fetchall()])
            except Exception as e:
                logger.error(f"Error querying predictions: {e}")
                
        if 'prediction_logs' in tables:
            try:
                cursor.execute("""
                    SELECT * FROM prediction_logs
                    WHERE direction_correct_5d = 0
                    ORDER BY prediction_date DESC
                    LIMIT 200
                """)
                failures.extend([dict(r) for r in cursor.fetchall()])
            except Exception as e:
                logger.error(f"Error querying prediction_logs: {e}")
                
        if 'ExpertRecommendation' in tables:
            try:
                cursor.execute("""
                    SELECT stock_symbol as ticker, entry_price, target_price, stop_loss, profit_loss_percent, 'ExpertRecommendation' as source
                    FROM ExpertRecommendation
                    WHERE status = 'closed' AND (hit_stop_loss = 1 OR profit_loss_percent < 0)
                    LIMIT 100
                """)
                failures.extend([dict(r) for r in cursor.fetchall()])
            except Exception as e:
                logger.error(f"Error querying ExpertRecommendation: {e}")
                
        conn.close()
        
        # 2. إذا لم يكن هناك أخطاء فعلية مسجلة بعد، نقوم بمحاكاة الأخطاء من الأسعار التاريخية
        is_simulated = False
        if len(failures) < 5:
            logger.info("Few or no active database failures found. Running simulation to generate failures...")
            params = PERSONA_PARAMETERS.get(persona, PERSONA_PARAMETERS['balanced'])
            sim_preds = self._get_simulated_predictions(params)
            failures = [p for p in sim_preds if p['direction_correct_5d'] == 0]
            is_simulated = True
            
        total_failures = len(failures)
        lessons = []
        adjustments = {}
        
        if total_failures == 0:
            return {
                "success": True,
                "message": "لم يتم العثور على أخطاء كافية للتعلم منها حالياً.",
                "lessons": ["لم يتم العثور على أخطاء كافية في قاعدة الأسعار أو سجلات النظام لاستخلاص دروس."],
                "adjustments": {}
            }
            
        # 3. تحليل الأخطاء وتحديد القواسم المشتركة
        high_score_failures = 0
        bear_failures = 0
        
        for f in failures:
            score_val = f.get('confidence') or f.get('master_score') or 50.0
            if score_val > 75.0:
                high_score_failures += 1
                
            regime_val = f.get('market_regime') or f.get('regime') or 'UNKNOWN'
            if regime_val == 'BEAR':
                bear_failures += 1
                
        # 4. بناء الدروس وصياغة التعديلات الأمنية
        if high_score_failures > total_failures * 0.15:
            lessons.append(f"تم رصد أخطاء شراء بنسبة ثقة مرتفعة ({high_score_failures}/{total_failures}). تم رفع حد الدخول الأدنى (min_score_buy) لتفادي الفخاخ السعرية.")
            adjustments['min_score_buy'] = 72.0
            
        if bear_failures > total_failures * 0.25:
            lessons.append(f"غالبية الأخطاء ({bear_failures}/{total_failures}) وقعت في بيئة سوق هابطة BEAR. تم تقليص حجم المراكز إلى 5% وتضييق وقف الخسارة.")
            adjustments['position_size_pct'] = 5.0
            adjustments['stop_max_pct'] = 6.0
            
        lessons.append(f"تم تحليل {total_failures} خطأ تداول {'(محاكاة تاريخية)' if is_simulated else '(من السجلات الفعلية)'} وتثبيت معايير أمان إضافية.")
        adjustments['rsi_overbought'] = 68.0
        adjustments['rsi_oversold'] = 32.0
        adjustments['min_rr'] = 1.6
        
        # 5. حفظ التعديلات في active_settings.json
        if adjustments:
            from config.unified_config import load_active_settings, ACTIVE_SETTINGS_PATH
            settings = load_active_settings()
            
            if "markets" not in settings:
                settings["markets"] = {}
            if market not in settings["markets"]:
                settings["markets"][market] = {}
                
            if "personas" not in settings:
                settings["personas"] = {}
            if persona not in settings["personas"]:
                settings["personas"][persona] = {}
                
            market_fields = ['rsi_oversold', 'rsi_overbought', 'min_score_buy', 'min_rr', 'stop_max_pct']
            persona_fields = ['position_size_pct']
            
            for k, v in adjustments.items():
                if k in market_fields:
                    settings["markets"][market][k] = v
                elif k in persona_fields:
                    settings["personas"][persona][k] = v
                    
            try:
                os.makedirs(os.path.dirname(ACTIVE_SETTINGS_PATH), exist_ok=True)
                with open(ACTIVE_SETTINGS_PATH, "w", encoding="utf-8") as f:
                    json.dump(settings, f, indent=2, ensure_ascii=False)
            except Exception as e:
                logger.error(f"Error saving overrides to active_settings.json: {e}")
                
        return {
            "success": True,
            "message": f"تم تحليل {total_failures} خطأ بنجاح وتحديث معايير النظام لتجنبها.",
            "lessons": lessons,
            "adjustments": adjustments
        }

    # ========================================================================
    # CONTROL METHODS
    # ========================================================================
    
    def stop(self):
        """إيقاف التعلم"""
        self.should_stop = True
    
    def reset(self):
        """إعادة تعيين"""
        self.should_stop = False
        self.current_progress = None


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_unified_learning_engine(db_path: str) -> UnifiedLearningEngine:
    """الحصول على نسخة من المحرك"""
    return UnifiedLearningEngine(db_path)


def run_quick_learning(db_path: str, persona: str = 'balanced') -> Dict:
    """تشغيل تعلم سريع"""
    engine = UnifiedLearningEngine(db_path)
    return engine.run_iterative_learning(persona=persona, max_iterations=10)


def analyze_trade(db_path: str, trade_id: int) -> List[Dict]:
    """تحليل صفقة بالمرآة"""
    engine = UnifiedLearningEngine(db_path)
    results = engine.run_mirror_analysis(trade_id)
    return [{'question': r.question, 'answer': r.answer, 'insight': r.insight, 'severity': r.severity} 
            for r in results]


def get_learning_summary(db_path: str) -> Dict:
    """ملخص حالة التعلم"""
    engine = UnifiedLearningEngine(db_path)
    
    return {
        'indicator_scores': engine.get_indicator_trust_scores(),
        'patterns': engine.detect_patterns(1),
        'expectancy': engine.calculate_expectancy(),
        'lessons_count': len(engine.mine_lessons())
    }
