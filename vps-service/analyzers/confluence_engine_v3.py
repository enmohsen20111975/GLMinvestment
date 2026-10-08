"""
Confluence Engine v3 - Production Safe
=======================================
محرك التوحيد - النسخة الآمنة للإنتاج

مشاكل v2 اللي اتحلت:
- max_drawdown 100% ← خسارة كل الفلوس
- sharpe_ratio 0.01 ← عائد = مخاطرة
- 12,951 إشارة MACD في شهرين ← كل يوم!
- مافيش Fundamental ← اتضاف

التحسينات:
1. Fundamental Scores (Piotroski-style + Value + Quality)
2. Signal Filtering (min 3 indicators agree, 60% confidence)
3. Paper Trading Ready
4. Risk Management Built-in

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import sqlite3
import json
import os
from pathlib import Path as _P

# Relative project root
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# SUB-ENGINE-DISABLED (Task PHASE-3-DISABLE-SUB-ENGINES, Rule 73: SINGLE-DISPLAY-SOURCE)
# Confluence Engine v3 uses thresholds (75/65) that differ from the canonical
# thresholds (78/65) defined in canonical_signal.py. Producing a competing
# `signal` field here violates Rule 67 (CALCULATION-CANONICAL).
# Canonical signal comes from master_analyzer.py + canonical_signal.py.
# This file is kept for backward compatibility (Rule 4: NO-DELETION) but
# ConfluenceEngine.analyze() now short-circuits and returns None.
SUB_ENGINE_DISABLED = True


# ============================================================================
# WEIGHTS v5 - WHALE MATRIX (BRIEF-044)
# ============================================================================
# BRIEF-044: قلب الطاولة بالكامل - SMC هو المحرك الأساسي (60%)
# المؤشرات التقليدية (RSI, MACD) بقت "كاشف فخاخ" (Trap Detector) مش إشارات شراء
# التوقعات بقى بتطابق عقلية صناديق التحوط (Hedge Funds)
# ============================================================================

CONFLUENCE_WEIGHTS_V5 = {
    # ── SMC - Smart Money Concepts (60%) ── المحرك الأساسي للقرار
    'smc': 0.60,  # Order Blocks + Liquidity Sweeps + FVG
    # الحيتان مش بيستخدموا RSI/MACD للدخول - بيستخدموا الـ SMC

    # ── Fundamentals & Volume Profile (25%) ── تأكيد السيولة المؤسسية
    'fundamental': 0.15,  # Piotroski + Value + Quality (حماية رأس المال)
    'volume': 0.10,  # Volume Profile (أين تتداول المؤسسات)

    # ── Indicators - Trap Detector (15%) ── كاشف فخاخ فقط!
    'technical': 0.15,  # MA/MACD/RSI/Bollinger - تُستخدم عكسياً أو كـ trap detector
    # مش إشارات شراء مستقلة - لو MACD موجب بس مفيش SMC = WAIT
}

# SMC sub-weights (within 60%) - BRIEF-044 Whale Matrix
SMC_SUB_WEIGHTS = {
    'order_block': 0.50,    # 30% of total - محرك الدخول الأساسي (أين اشترى الحوت)
    'liquidity_sweep': 0.33,  # 20% of total - الشرارة (Trigger) - أين اصطيدت وقوف الخسارة
    'fvg': 0.17,            # 10% of total - منطقة الاستهداف (أين سيذهب السعر)
}

# Technical sub-weights (within 15%) - Trap Detector mode
# BRIEF-044: المؤشرات بقت فلاتر مش إشارات - أوزانها متساوية
TECHNICAL_SUB_WEIGHTS = {
    'ma_cross': 0.30,   # Moving Averages - 2/10 عند الخبراء (تُستخدم عكسياً)
    'macd': 0.25,       # MACD - 0/10 عند الخبراء (trap detector فقط)
    'rsi': 0.20,        # RSI - 0/10 عند الخبراء (كاشف تشبع/فخاخ)
    'bollinger': 0.15,  # Bollinger - تأكيد ثانوي
    'stochastic': 0.10, # Stochastic - تأكيد ثانوي
}

# Keep backward compatibility
CONFLUENCE_WEIGHTS_V4 = CONFLUENCE_WEIGHTS_V5
CONFLUENCE_WEIGHTS_V3 = CONFLUENCE_WEIGHTS_V5

# BRIEF-044: SMC Veto Thresholds
SMC_VETO_THRESHOLD = 40  # لو SMC score < 40 → رفض أي إشارة BUY
SMC_STRONG_THRESHOLD = 70  # SMC score >= 70 → إشارة قوية
TRAP_DETECTION_RSI_HIGH = 70  # RSI > 70 = تشبع شرائي محتمل (فخ)
TRAP_DETECTION_RSI_LOW = 30   # RSI < 30 = تشبع بيعي محتمل (فخ)

# Fundamental sub-weights (within 25%)
FUNDAMENTAL_SUB_WEIGHTS = {
    'value_score': 0.35,     # P/E, P/B, EV/EBITDA
    'quality_score': 0.35,   # ROE, ROA, Debt/Equity
    'growth_score': 0.30,    # EPS growth, Revenue growth
}


# ============================================================================
# SIGNAL FILTERING - Reduce False Signals (Adjusted)
# ============================================================================

MIN_INDICATORS_AGREE = 2     # At least 2 indicators must agree (adjusted from 3)
MIN_CONFIDENCE = 55          # Minimum confidence to generate signal (adjusted from 60)
SIGNAL_COOLDOWN_DAYS = 3     # Don't repeat same signal for same stock


# ============================================================================
# THRESHOLDS
# ============================================================================
# DISABLED engine (SUB_ENGINE_DISABLED=True above) — THRESHOLDS here are dead
# code. canonical_signal.py is the SSOT for signal classification.
# Task PHASE3-ENGINES: NOT changing values (engine is disabled; risky to
# touch dead code). If this engine is ever re-enabled, the values below MUST
# be brought in line with canonical_signal.SIGNAL_THRESHOLDS (78/65/55/40/25).
THRESHOLDS = {
    'STRONG_BUY': 75,   # Raised from 80
    'BUY': 65,
    'ACCUMULATE': 55,   # Raised from 50
    'HOLD': 45,
    'REDUCE': 35,
    'SELL': 25,
    'STRONG_SELL': 15,
}


# ============================================================================
# SEASONALITY WEIGHTS (EGX-Specific)
# ============================================================================

SEASONALITY_WEIGHTS = {
    'monthly': {
        3: -0.15,  # March Effect (أسوأ شهر)
        1: +0.10,  # January Effect
        11: +0.05, # November
        12: +0.05, # December
    },
    'weekday': {
        3: +0.10,  # Thursday (أحسن يوم)
        0: -0.10,  # Monday (أسوأ يوم)
    },
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class TechnicalSignal:
    """Technical indicator signal."""
    indicator: str
    signal: str  # BUY, SELL, HOLD
    score: float  # 0-100
    weight: float


@dataclass
class FundamentalScore:
    """Fundamental analysis score."""
    value_score: float      # 0-100
    quality_score: float    # 0-100
    growth_score: float     # 0-100
    total_score: float      # 0-100
    signals: List[str]


@dataclass
class ConfluenceResultV3:
    """Result of Confluence Analysis v3."""
    ticker: str
    signal: str
    signal_ar: str
    confidence: float
    master_score: float

    # Component scores
    technical_score: float
    fundamental_score: float
    seasonality_score: float
    dividend_score: float
    volume_score: float

    # Signal details
    indicators_agreeing: int
    indicators_breakdown: Dict

    # Risk
    risk_level: str
    suggested_position_pct: float

    # SMC-067: Smart Money Concepts score (optional - with defaults)
    smc_score: float = 50.0
    smc_signal: str = 'HOLD'
    smc_signals: list = None  # تفاصيل إشارات SMC

    # BRIEF-044: Whale Matrix fields
    whale_signal: str = 'WAIT'  # إشارة الحوت المستقلة (BUY/SELL/WAIT)
    trap_detected: bool = False  # هل تم كشف فخ
    trap_type: str = ''  # نوع الفخ (DISTRIBUTION_TRAP, NO_WHALE_SUPPORT, etc.)
    smc_zones: list = None  # مناطق OB و FVG لرسمها على الشارت

    # System 6: Sector Confluence (Maestro Human)
    sector_context: Optional[Dict] = None

    # Metadata
    timestamp: str = ""
    version: str = "v3.1-human"
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# FUNDAMENTAL ANALYZER
# ============================================================================

class FundamentalAnalyzer:
    """
    محلل أساسي - Fundamental Analysis
    
    Calculates:
    - Value Score (P/E, P/B, EV/EBITDA)
    - Quality Score (ROE, ROA, Debt/Equity, Current Ratio)
    - Growth Score (EPS, Revenue growth)
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
    
    def analyze(self, ticker: str) -> FundamentalScore:
        """
        Analyze fundamental metrics for a stock.
        
        Returns:
            FundamentalScore with all components
        """
        stock_data = self._get_stock_data(ticker)
        signals = []
        
        # Value Score (P/E, P/B, EV/EBITDA)
        value_score, value_signals = self._calculate_value_score(stock_data)
        signals.extend(value_signals)
        
        # Quality Score (ROE, ROA, Debt/Equity, Current Ratio)
        quality_score, quality_signals = self._calculate_quality_score(stock_data)
        signals.extend(quality_signals)
        
        # Growth Score (EPS growth, etc.)
        growth_score, growth_signals = self._calculate_growth_score(stock_data)
        signals.extend(growth_signals)
        
        # Total weighted score
        total_score = (
            value_score * FUNDAMENTAL_SUB_WEIGHTS['value_score'] +
            quality_score * FUNDAMENTAL_SUB_WEIGHTS['quality_score'] +
            growth_score * FUNDAMENTAL_SUB_WEIGHTS['growth_score']
        )
        
        return FundamentalScore(
            value_score=round(value_score, 1),
            quality_score=round(quality_score, 1),
            growth_score=round(growth_score, 1),
            total_score=round(total_score, 1),
            signals=signals
        )
    
    def _get_stock_data(self, ticker: str) -> Dict:
        """Get stock fundamental data from database."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT pe_ratio, pb_ratio, ps_ratio, NULL as ev_to_ebitda,
                       eps, roe, roa, debt_to_equity, current_ratio,
                       book_value_per_share, dividend_yield, sector
                FROM stocks
                WHERE ticker = ?
            ''', (ticker,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'pe_ratio': row[0],
                    'pb_ratio': row[1],
                    'ps_ratio': row[2],
                    'ev_to_ebitda': row[3],
                    'eps': row[4],
                    'roe': row[5],
                    'roa': row[6],
                    'debt_to_equity': row[7],
                    'current_ratio': row[8],
                    'book_value_per_share': row[9],
                    'dividend_yield': row[10],
                    'sector': row[11],
                }
        except Exception as e:
            pass
        
        return {}
    
    def _calculate_value_score(self, data: Dict) -> Tuple[float, List[str]]:
        """Calculate value score based on valuation metrics."""
        score = 50.0  # Start neutral
        signals = []
        
        # P/E Ratio (lower is better for value)
        pe = data.get('pe_ratio')
        if pe:
            if pe < 8:
                score += 20
                signals.append(f"P/E {pe:.1f} = Very Cheap")
            elif pe < 15:
                score += 10
                signals.append(f"P/E {pe:.1f} = Good Value")
            elif pe > 30:
                score -= 15
                signals.append(f"P/E {pe:.1f} = Expensive")
        
        # P/B Ratio (lower is better)
        pb = data.get('pb_ratio')
        if pb:
            if pb < 1.0:
                score += 15
                signals.append(f"P/B {pb:.2f} = Below Book Value!")
            elif pb < 2.0:
                score += 5
            elif pb > 4.0:
                score -= 10
        
        # EV/EBITDA (lower is better)
        ev_ebitda = data.get('ev_to_ebitda')
        if ev_ebitda:
            if ev_ebitda < 8:
                score += 10
            elif ev_ebitda > 15:
                score -= 10
        
        return max(0, min(100, score)), signals
    
    def _calculate_quality_score(self, data: Dict) -> Tuple[float, List[str]]:
        """Calculate quality score based on profitability and stability."""
        score = 50.0
        signals = []
        
        # ROE (Return on Equity)
        roe = data.get('roe')
        if roe:
            if roe > 20:
                score += 20
                signals.append(f"ROE {roe:.1f}% = Excellent")
            elif roe > 15:
                score += 10
                signals.append(f"ROE {roe:.1f}% = Good")
            elif roe < 5:
                score -= 15
                signals.append(f"ROE {roe:.1f}% = Poor")
        
        # ROA (Return on Assets)
        roa = data.get('roa')
        if roa:
            if roa > 10:
                score += 10
            elif roa < 2:
                score -= 10
        
        # Debt/Equity (lower is better)
        d_e = data.get('debt_to_equity')
        if d_e:
            if d_e < 0.5:
                score += 15
                signals.append(f"D/E {d_e:.2f} = Low Debt")
            elif d_e > 2.0:
                score -= 15
                signals.append(f"D/E {d_e:.2f} = High Debt Risk")
        
        # Current Ratio (higher is better)
        cr = data.get('current_ratio')
        if cr:
            if cr > 2.0:
                score += 10
            elif cr < 1.0:
                score -= 15
                signals.append(f"Current Ratio {cr:.2f} = Liquidity Risk!")
        
        return max(0, min(100, score)), signals
    
    def _calculate_growth_score(self, data: Dict) -> Tuple[float, List[str]]:
        """Calculate growth score."""
        score = 50.0
        signals = []
        
        # EPS
        eps = data.get('eps')
        if eps:
            if eps > 0:
                score += 10
                signals.append(f"EPS {eps:.2f} = Positive")
            else:
                score -= 20
                signals.append(f"EPS {eps:.2f} = Negative!")
        
        # Dividend Yield
        div_yield = data.get('dividend_yield')
        if div_yield and div_yield > 0:
            score += 5
            signals.append(f"Dividend Yield {div_yield:.1f}%")
        
        return max(0, min(100, score)), signals


# ============================================================================
# CONFLUENCE ENGINE V3
# ============================================================================

class ConfluenceEngineV3:
    """
    محرك التوحيد - النسخة الثالثة
    
    Features:
    - Fundamental Analysis Integration
    - Signal Filtering (min 3 indicators agree)
    - Confidence Threshold (60% minimum)
    - Paper Trading Ready
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
        self.weights = CONFLUENCE_WEIGHTS_V3.copy()
        self.technical_sub_weights = TECHNICAL_SUB_WEIGHTS.copy()
        self.thresholds = THRESHOLDS
        self.fundamental_analyzer = FundamentalAnalyzer(db_path)
        # Load dynamic weights from learning system
        self._load_regime_weights()
    
    def analyze(
        self,
        ticker: str,
        ma_cross_signal: str = 'HOLD',
        macd_signal: str = 'HOLD',
        rsi_signal: str = 'HOLD',
        bollinger_signal: str = 'HOLD',
        stochastic_signal: str = 'HOLD',
        volume_signal: str = 'HOLD',
        seasonality_signal: str = 'HOLD',
        dividend_signal: str = 'HOLD',
        # SMC-067: Smart Money Concepts signals (العقل الجديد)
        smc_signal: str = 'HOLD',  # إشارة SMC الإجمالية
        smc_score: float = 50.0,   # SMC score (0-100)
        smc_signals: list = None,  # تفاصيل إشارات SMC
    ) -> Optional[ConfluenceResultV3]:
        """
        Perform complete confluence analysis with SMC integration.

        SMC-067: الـ SMC بقى جزء أساسي من التوقع (20% من الـ master score)
        ده بيخلي التوقعات تمشي ورا عقلية الحيتان (المؤسسات)

        Returns None if signal doesn't meet quality thresholds.
        """
        # SUB-ENGINE-DISABLED (Task PHASE-3-DISABLE-SUB-ENGINES, Rule 73)
        # Canonical signal is produced only by master_analyzer.py + canonical_signal.py
        # (thresholds 78/65). Confluence thresholds (75/65) produce competing signals.
        # Short-circuit and return None — callers must consume the canonical source.
        if SUB_ENGINE_DISABLED:
            return None

        # Step 1: Calculate Technical Score
        technical_signals = [
            ('ma_cross', ma_cross_signal, self.technical_sub_weights['ma_cross']),
            ('macd', macd_signal, self.technical_sub_weights['macd']),
            ('rsi', rsi_signal, self.technical_sub_weights['rsi']),
            ('bollinger', bollinger_signal, self.technical_sub_weights['bollinger']),
            ('stochastic', stochastic_signal, self.technical_sub_weights['stochastic']),
        ]

        technical_score, indicators_agreeing, indicators_breakdown = self._calculate_technical(
            technical_signals
        )

        # Step 2: Calculate Fundamental Score
        fundamental = self.fundamental_analyzer.analyze(ticker)
        fundamental_score = fundamental.total_score

        # Step 3: Calculate other scores
        seasonality_score = self._signal_to_score(seasonality_signal)
        dividend_score = self._signal_to_score(dividend_signal)
        volume_score = self._signal_to_score(volume_signal)

        # SMC-067: Step 3b: Calculate SMC Score (Smart Money Concepts)
        # الـ SMC score بييجي من الـ SMCEngine (Order Blocks + FVG + Sweeps)
        # بنحوله لإشارة: score >= 70 → BUY, >= 40 → HOLD, < 40 → SELL
        smc_signal_calculated = smc_signal
        if smc_signal == 'HOLD' and smc_score != 50.0:
            if smc_score >= 70:
                smc_signal_calculated = 'BUY'
            elif smc_score < 40:
                smc_signal_calculated = 'SELL'
            else:
                smc_signal_calculated = 'HOLD'

        smc_final_score = self._signal_to_score(smc_signal_calculated)
        # لو عندنا SMC score فعلي (0-100)، نستخدمه بدل الـ signal conversion
        if smc_score != 50.0 and smc_score > 0:
            smc_final_score = smc_score

        # =====================================================================
        # BRIEF-044: WHALE MATRIX - SMC is the PRIMARY brain (60%)
        # =====================================================================
        # الحيتان مش بيستخدموا RSI/MACD للدخول - بيستخدموا الـ SMC
        # المؤشرات التقليدية بقت "Trap Detector" مش إشارات شراء مستقلة

        _weights = self.weights
        _has_smc_weight = 'smc' in _weights

        # BRIEF-044 Step 4: Calculate Master Score with Whale Matrix weights
        # SMC: 60% | Fundamentals: 15% | Volume: 10% | Technical: 15% (trap detector)
        if _has_smc_weight:
            # لو الـ weights فيها seasonality/dividend (backward compat)
            _w_tech = _weights.get('technical', 0.15)
            _w_smc = _weights.get('smc', 0.60)
            _w_fund = _weights.get('fundamental', 0.15)
            _w_vol = _weights.get('volume', 0.10)
            _w_seas = _weights.get('seasonality', 0.0)
            _w_div = _weights.get('dividend', 0.0)

            master_score = (
                smc_final_score * _w_smc +          # 60% - SMC is the engine
                fundamental_score * _w_fund +       # 15% - حماية رأس المال
                volume_score * _w_vol +             # 10% - تأكيد السيولة
                technical_score * _w_tech +         # 15% - trap detector فقط
                seasonality_score * _w_seas +       # 0% in v5 (backward compat)
                dividend_score * _w_div             # 0% in v5 (backward compat)
            )
        else:
            # Backward compatibility (لو الـ weights قديمة)
            master_score = (
                technical_score * _weights.get('technical', 0.40) +
                fundamental_score * _weights.get('fundamental', 0.25) +
                seasonality_score * _weights.get('seasonality', 0.15) +
                dividend_score * _weights.get('dividend', 0.10) +
                volume_score * _weights.get('volume', 0.10)
            )

        # Step 5: Apply Seasonality Adjustment (if weights include it)
        if _weights.get('seasonality', 0) > 0:
            master_score = self._apply_seasonality_adjustment(master_score)

        # =====================================================================
        # BRIEF-044: WHALE LOGIC - Veto Rule + Trap Detector
        # =====================================================================

        # ── BRIEF-044 Rule 1: VETO RULE (الرفض التلقائي) ──
        # لو الـ MACD موجب و الـ RSI > 50 بس مفيش SMC → WAIT/ACCUMULATE
        # السهم بيتحرك بدون دعم مؤسسي = الحوت مش موجود
        _whale_signal = smc_signal_calculated  # إشارة الحوت المستقلة
        _trap_detected = False
        _trap_type = None

        if smc_final_score < SMC_VETO_THRESHOLD:
            # مفيش أثر حيتان → رفض أي إشارة BUY قوية
            if master_score >= THRESHOLDS.get('BUY', 65):
                master_score = max(THRESHOLDS.get('HOLD', 45), master_score - 15)
                # تحويل لـ ACCUMULATE بدل BUY
                _trap_detected = True
                _trap_type = 'NO_WHALE_SUPPORT'

        # ── BRIEF-044 Rule 2: TRAP DETECTOR (كشف الفخاخ) ──
        # RSI > 70 = تشبع شرائي - العقل التقليدي بيقول "بيع"
        # العقل المطور بيتحقق من الـ SMC:
        # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
        # Previously fabricated _rsi_value = 25 (BUY) / 75 (SELL) based on
        # the rsi_signal label. Now: _rsi_value = None unless the caller
        # sets engine._passed_rsi_value = calc_rsi(closes) before calling
        # analyze(). The trap detector below is skipped when RSI is unknown
        # (the `if _rsi_value` guards short-circuit to False). This is
        # acceptable per Rule 27 — better to skip the check than fabricate.
        _rsi_value = getattr(self, '_passed_rsi_value', None)

        if _rsi_value and _rsi_value > TRAP_DETECTION_RSI_HIGH:
            # RSI > 70 - تشبع شرائي محتمل
            if smc_signal_calculated == 'BUY':
                # فيه Bullish Sweep + RSI > 70 = الحوت اصطاد وقوف الخسارة ويكمل صعود
                # → BUY (الحوت قوي)
                master_score += 5  # Whale confirmation boost
                _trap_type = 'BULLISH_TRAP_REVERSED'
            else:
                # RSI > 70 + لا يوجد Sweep + السعر تحت OB = الحوت يوزع
                # → SELL (فخ للبيع على المتداولين العاديين)
                master_score -= 10  # Trap penalty
                _trap_detected = True
                _trap_type = 'DISTRIBUTION_TRAP'

        elif _rsi_value and _rsi_value < TRAP_DETECTION_RSI_LOW:
            # RSI < 30 - تشبع بيعي محتمل
            if smc_signal_calculated == 'SELL':
                # Bearish Sweep + RSI < 30 = الحوت اصطاد شراء و بينزل
                master_score -= 5  # Bearish whale confirmation
                _trap_type = 'BEARISH_TRAP_REVERSED'
            else:
                # RSI < 30 + لا يوجد bearish sweep = امتصاص السيولة (الحوت بيشتري)
                master_score += 5  # Accumulation boost
                _trap_type = 'ACCUMULATION_DETECTED'

        # ── BRIEF-044 Rule 3: SMC Boost/Penalty (تعزيز الثقة) ──
        final_signal = self._get_signal_from_score(master_score)
        if smc_signal_calculated == 'BUY' and final_signal in ('BUY', 'STRONG_BUY'):
            master_score += 5  # SMC + Technical alignment = strong boost
        elif smc_signal_calculated == 'SELL' and final_signal in ('SELL', 'STRONG_SELL'):
            master_score += 5  # SMC + Technical alignment
        elif smc_signal_calculated == 'BUY' and final_signal in ('SELL', 'STRONG_SELL'):
            master_score -= 8  # SMC divergence = strong penalty (SMC wins)
        elif smc_signal_calculated == 'SELL' and final_signal in ('BUY', 'STRONG_BUY'):
            master_score -= 8  # SMC divergence = strong penalty (SMC wins)

        master_score = max(0, min(100, master_score))

        # Step 6: Determine Signal
        signal = self._get_signal_from_score(master_score)

        # BRIEF-044: لو الـ SMC ضعيف جداً، تحويل BUY لـ ACCUMULATE (مش BUY)
        if signal in ('BUY', 'STRONG_BUY') and smc_final_score < SMC_VETO_THRESHOLD:
            # لا توصية شراء قوية بدون دعم الحيتان
            signal = 'HOLD'  # ACCUMULATE
            master_score = min(master_score, THRESHOLDS.get('HOLD', 45) + 10)

        # Step 7: Calculate Confidence
        confidence = self._calculate_confidence(
            master_score,
            indicators_agreeing,
            fundamental_score
        )

        # BRIEF-044: SMC Confidence Boost/Penalty
        # لو الـ SMC score عالي و متطابق مع الإشارة → ثقة عالية جداً (90%+)
        if smc_score >= SMC_STRONG_THRESHOLD:
            if signal in ('BUY', 'STRONG_BUY') and smc_signal_calculated == 'BUY':
                confidence = max(confidence, 90)  # Hedge fund level confidence
            elif signal in ('SELL', 'STRONG_SELL') and smc_signal_calculated == 'SELL':
                confidence = max(confidence, 88)
            else:
                confidence += 5
        elif smc_score <= 25:
            # SMC ضعيف جداً → ثقة منخفضة
            confidence -= 10
        elif smc_score <= SMC_VETO_THRESHOLD:
            confidence -= 5

        # لو تم كشف فخ → ارفع الثقة في الإشارة المعاكسة
        if _trap_detected and _trap_type in ('DISTRIBUTION_TRAP', 'NO_WHALE_SUPPORT'):
            if signal in ('SELL', 'STRONG_SELL'):
                confidence += 5  # ثقة أعلى في بيع بعد كشف فخ

        confidence = max(0, min(100, confidence))

        # Step 8: FILTER - Reject low quality signals
        if signal == 'HOLD':
            return None  # Don't generate HOLD signals

        if indicators_agreeing < MIN_INDICATORS_AGREE:
            return None  # Not enough agreement
        
        if confidence < MIN_CONFIDENCE:
            return None  # Confidence too low
        
        # Step 9: Calculate Risk Level
        risk_level, position_pct = self._calculate_risk(
            master_score,
            fundamental_score,
            indicators_agreeing
        )
        
        # Step 10: System 6 — Sector Confluence (Maestro Human)
        sector_context = self._calculate_sector_confluence(ticker)
        
        return ConfluenceResultV3(
            ticker=ticker,
            signal=signal,
            signal_ar=self._get_signal_arabic(signal),
            confidence=round(confidence, 1),
            master_score=round(master_score, 2),
            technical_score=round(technical_score, 1),
            fundamental_score=round(fundamental_score, 1),
            seasonality_score=round(seasonality_score, 1),
            dividend_score=round(dividend_score, 1),
            volume_score=round(volume_score, 1),
            # SMC-067: SMC data in result
            smc_score=round(smc_final_score, 1),
            smc_signal=smc_signal_calculated,
            smc_signals=smc_signals or [],
            # BRIEF-044: Whale Matrix fields
            whale_signal=_whale_signal,
            trap_detected=_trap_detected,
            trap_type=_trap_type or '',
            smc_zones=[],  # يتم ملؤها من الـ API layer لو فيه ohlcv
            indicators_agreeing=indicators_agreeing,
            indicators_breakdown=indicators_breakdown,
            risk_level=risk_level,
            suggested_position_pct=position_pct,
            sector_context=sector_context,
            timestamp=datetime.now().isoformat()
        )
    
    def _calculate_sector_confluence(self, ticker: str) -> Optional[Dict]:
        """
        System 6: Sector Confluence — مقارنة أداء السهم بالقطاع
        
        الحالات:
        1. السهم نازل أكتر من القطاع → مشكلة داخلية
        2. السهم نازل أقل من القطاع → أقوى من القطاع (فرصة)
        3. السهم طالع والقطاع نازل → تمرد (خطر)
        4. السهم طالع مع القطاع → زخم حقيقي
        """
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            
            # جلب أداء السهم من stocks
            cur.execute('''SELECT change_percent, sector FROM stocks WHERE ticker = ?''', (ticker,))
            stock_row = cur.fetchone()
            
            if not stock_row or not stock_row['sector']:
                conn.close()
                return None
            
            stock_change = float(stock_row['change_percent'] or 0)
            sector_name = stock_row['sector']
            
            # جلب أداء القطاع من data_engine.db
            data_engine_path = self.db_path.replace('stocks.db', 'data_engine.db')
            if not os.path.exists(data_engine_path):
                conn.close()
                return None
            
            try:
                from core.db_manager import db_manager
                de_conn = db_manager.connection('data_engine', writable=False).__enter__()
            except Exception:
                de_conn = sqlite3.connect(data_engine_path)
            de_cur = de_conn.cursor()
            
            # محاولة جلب أداء القطاع
            de_cur.execute('''SELECT change_1m FROM tab_performance WHERE sector_name = ? LIMIT 1''', (sector_name,))
            sector_row = de_cur.fetchone()
            de_conn.close()
            
            if not sector_row:
                conn.close()
                return None
            
            sector_change = float(sector_row[0] or 0)
            difference = round(stock_change - sector_change, 2)
            
            # تحديد الحالة
            stock_abs = abs(stock_change)
            sector_abs = abs(sector_change)
            
            if stock_change < -10 and difference < -5:
                verdict = f'السهم أضعف من القطاع بـ {abs(difference):.1f}% — فيه مشكلة داخلية'
                impact = 'negative'
            elif stock_change < 0 and difference > 5:
                verdict = f'السهم أقوى من القطاع بـ {difference:.1f}% — لو القطاع رجع ده يطير'
                impact = 'positive'
            elif stock_change > 10 and sector_change < -3:
                verdict = f'السهم يتمرد على القطاع (القطاع نازل {sector_abs:.1f}%) — خطر'
                impact = 'negative'
            elif stock_change > 5 and sector_change > 0:
                verdict = f'زخم حقيقي — السهم والقطاع صاعدين'
                impact = 'positive'
            else:
                verdict = f'السهم والقطاع متقاربين (الفرق {difference:.1f}%)'
                impact = 'neutral'
            
            conn.close()
            
            return {
                'stock_perf': stock_change,
                'sector_name': sector_name,
                'sector_perf': sector_change,
                'difference': difference,
                'verdict': verdict,
                'impact': impact,
            }
            
        except Exception as e:
            print(f"[ConfluenceV3] Sector confluence error for {ticker}: {e}")
            return None
    
    def _load_regime_weights(self):
        """
        Load dynamic weights from the learning system.
        
        Reads from regime_indicator_weights table and updates:
        - self.weights (main category weights)
        - self.technical_sub_weights (indicator sub-weights)
        
        Falls back to static weights if table is empty.
        """
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Check if we have learned weights
            cursor.execute('''
                SELECT indicator_name, regime, weight, expectancy 
                FROM regime_indicator_weights
                WHERE weight IS NOT NULL
            ''')
            rows = cursor.fetchall()
            conn.close()
            
            if not rows:
                # No learned weights yet - use static defaults
                print("[ConfluenceV3] No regime weights found, using defaults")
                return
            
            # Aggregate weights by indicator
            indicator_weights = {}
            for row in rows:
                indicator = row['indicator_name']
                weight = row['weight']
                if indicator not in indicator_weights:
                    indicator_weights[indicator] = []
                indicator_weights[indicator].append(weight)
            
            # Calculate average weight per indicator
            avg_weights = {k: sum(v)/len(v) for k, v in indicator_weights.items()}
            
            # Update technical sub-weights based on learned performance
            # Map indicator names to our sub-weight keys
            indicator_mapping = {
                'ma_cross': 'ma_cross',
                'macd': 'macd',
                'rsi': 'rsi',
                'bollinger': 'bollinger',
                'stochastic': 'stochastic',
            }
            
            total_technical_weight = 0
            updated_count = 0
            
            for db_name, local_name in indicator_mapping.items():
                if db_name in avg_weights:
                    # Scale the learned weight (0.0-1.0) to sub-weight
                    new_weight = avg_weights[db_name]
                    # Keep weights reasonable (min 0.05, max 0.50)
                    new_weight = max(0.05, min(0.50, new_weight))
                    self.technical_sub_weights[local_name] = new_weight
                    total_technical_weight += new_weight
                    updated_count += 1
            
            # Normalize technical sub-weights to sum to 1.0
            if total_technical_weight > 0:
                for key in self.technical_sub_weights:
                    self.technical_sub_weights[key] /= total_technical_weight
            
            if updated_count > 0:
                print(f"[ConfluenceV3] Loaded {updated_count} learned weights from regime_indicator_weights")
                
        except Exception as e:
            print(f"[ConfluenceV3] Error loading regime weights: {e}")
            # Keep default weights on error
    
    def _calculate_technical(
        self, 
        signals: List[Tuple[str, str, float]]
    ) -> Tuple[float, int, Dict]:
        """
        Calculate technical score with indicator agreement.
        
        Returns:
            (score, indicators_agreeing, breakdown)
        """
        buy_score = 0.0
        sell_score = 0.0
        total_weight = 0.0
        buy_count = 0
        sell_count = 0
        breakdown = {}
        
        for indicator, signal, weight in signals:
            total_weight += weight
            
            if signal == 'BUY':
                buy_score += weight
                buy_count += 1
                breakdown[indicator] = 'BUY'
            elif signal == 'SELL':
                sell_score += weight
                sell_count += 1
                breakdown[indicator] = 'SELL'
            else:
                breakdown[indicator] = 'HOLD'
        
        # Calculate score (50 = neutral)
        if buy_score > sell_score:
            score = 50 + (buy_score / total_weight) * 50
            agreeing = buy_count
        elif sell_score > buy_score:
            score = 50 - (sell_score / total_weight) * 50
            agreeing = sell_count
        else:
            score = 50
            agreeing = 0
        
        return score, agreeing, breakdown
    
    def _signal_to_score(self, signal: str) -> float:
        """Convert signal to score."""
        if signal == 'BUY':
            return 80
        elif signal == 'SELL':
            return 20
        return 50
    
    def _apply_seasonality_adjustment(self, score: float) -> float:
        """Apply current seasonality adjustment."""
        now = datetime.now()
        month = now.month
        weekday = now.weekday()
        
        adjustment = 0
        adjustment += SEASONALITY_WEIGHTS['monthly'].get(month, 0)
        adjustment += SEASONALITY_WEIGHTS['weekday'].get(weekday, 0)
        
        adjusted = score * (1 + adjustment)
        return max(0, min(100, adjusted))
    
    def _calculate_confidence(
        self, 
        master_score: float,
        indicators_agreeing: int,
        fundamental_score: float
    ) -> float:
        """Calculate confidence based on multiple factors."""
        base_confidence = 50 + abs(master_score - 50)
        
        # Boost for indicator agreement
        agreement_boost = (indicators_agreeing - 1) * 5
        
        # Boost for fundamental support
        if master_score > 50 and fundamental_score > 60:
            base_confidence += 10
        elif master_score < 50 and fundamental_score < 40:
            base_confidence += 10
        
        return min(95, base_confidence + agreement_boost)
    
    def _calculate_risk(
        self,
        master_score: float,
        fundamental_score: float,
        indicators_agreeing: int
    ) -> Tuple[str, float]:
        """
        Calculate risk level and suggested position size.
        
        Returns:
            (risk_level, position_percentage)
        """
        # Risk level
        if indicators_agreeing >= 4 and fundamental_score > 60:
            risk_level = "LOW"
            position_pct = 5.0  # 5% of portfolio
        elif indicators_agreeing >= 3:
            risk_level = "MEDIUM"
            position_pct = 3.0
        else:
            risk_level = "HIGH"
            position_pct = 1.0
        
        # Adjust for fundamental quality
        if fundamental_score < 40:
            risk_level = "HIGH"
            position_pct = min(position_pct, 1.0)
        
        return risk_level, position_pct
    
    def _get_signal_from_score(self, score: float) -> str:
        """Convert score to signal."""
        if score >= self.thresholds['STRONG_BUY']:
            return 'STRONG_BUY'
        elif score >= self.thresholds['BUY']:
            return 'BUY'
        elif score >= self.thresholds['ACCUMULATE']:
            return 'ACCUMULATE'
        elif score >= self.thresholds['HOLD']:
            return 'HOLD'
        elif score >= self.thresholds['REDUCE']:
            return 'REDUCE'
        elif score >= self.thresholds['SELL']:
            return 'SELL'
        else:
            return 'STRONG_SELL'
    
    def _get_signal_arabic(self, signal: str) -> str:
        """Get Arabic signal name."""
        translations = {
            'STRONG_BUY': 'شراء قوي',
            'BUY': 'شراء',
            'ACCUMULATE': 'تجميع',
            'HOLD': 'احتفاظ',
            'REDUCE': 'تخفيف',
            'SELL': 'بيع',
            'STRONG_SELL': 'بيع قوي',
        }
        return translations.get(signal, signal)


# ============================================================================
# PAPER TRADING ENGINE
# ============================================================================

class PaperTradingEngine:
    """
    محرك التداول الورقي
    
    Simulates trades without real money to measure accuracy.
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
        self.confluence_engine = ConfluenceEngineV3(db_path)
        self._create_paper_trades_table()
    
    def _create_paper_trades_table(self):
        """Create paper_trades table if not exists."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS paper_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    signal TEXT NOT NULL,
                    confidence REAL,
                    entry_price REAL,
                    entry_date TEXT,
                    exit_price REAL,
                    exit_date TEXT,
                    return_pct REAL,
                    correct INTEGER,
                    master_score REAL,
                    technical_score REAL,
                    fundamental_score REAL,
                    indicators_agreeing INTEGER,
                    risk_level TEXT,
                    position_pct REAL,
                    status TEXT DEFAULT 'OPEN',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    closed_at TEXT
                )
            ''')
            
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error creating table: {e}")
    
    def record_signal(self, result: ConfluenceResultV3, entry_price: float):
        """Record a new paper trade signal."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO paper_trades (
                    ticker, signal, confidence, entry_price, entry_date,
                    master_score, technical_score, fundamental_score,
                    indicators_agreeing, risk_level, position_pct, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
            ''', (
                result.ticker,
                result.signal,
                result.confidence,
                entry_price,
                datetime.now().strftime('%Y-%m-%d'),
                result.master_score,
                result.technical_score,
                result.fundamental_score,
                result.indicators_agreeing,
                result.risk_level,
                result.suggested_position_pct
            ))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error recording signal: {e}")
            return False
    
    def close_trade(self, trade_id: int, exit_price: float):
        """Close a paper trade and calculate results."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get trade info
            cursor.execute('''
                SELECT entry_price, signal FROM paper_trades WHERE id = ?
            ''', (trade_id,))
            
            row = cursor.fetchone()
            if not row:
                return False
            
            entry_price, signal = row
            return_pct = ((exit_price - entry_price) / entry_price) * 100
            
            # Determine if correct
            if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                correct = 1 if return_pct > 0 else 0
            else:
                correct = 1 if return_pct < 0 else 0
            
            # Update trade
            cursor.execute('''
                UPDATE paper_trades SET
                    exit_price = ?,
                    exit_date = ?,
                    return_pct = ?,
                    correct = ?,
                    status = 'CLOSED',
                    closed_at = ?
                WHERE id = ?
            ''', (
                exit_price,
                datetime.now().strftime('%Y-%m-%d'),
                return_pct,
                correct,
                datetime.now().isoformat(),
                trade_id
            ))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error closing trade: {e}")
            return False
    
    def get_accuracy_stats(self) -> Dict:
        """Get accuracy statistics for paper trading."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('stocks', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Overall stats
            cursor.execute('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct,
                    AVG(return_pct) as avg_return
                FROM paper_trades
                WHERE status = 'CLOSED'
            ''')
            
            row = cursor.fetchone()
            conn.close()
            
            if row and row[0] > 0:
                return {
                    'total_trades': row[0],
                    'correct_trades': row[1],
                    'accuracy': round(row[1] / row[0] * 100, 1),
                    'avg_return': round(row[2], 2) if row[2] else 0
                }
            
            return {'total_trades': 0, 'accuracy': 0}
        except Exception as e:
            return {'error': str(e)}


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("CONFLUENCE ENGINE v3 - Production Safe")
    print("=" * 60)
    print()
    
    # Test with a stock
    engine = ConfluenceEngineV3()
    
    # Example: COMI with mixed signals
    result = engine.analyze(
        ticker='COMI',
        ma_cross_signal='BUY',
        macd_signal='BUY',
        rsi_signal='HOLD',
        bollinger_signal='SELL',
        stochastic_signal='BUY',
        volume_signal='BUY',
        seasonality_signal='HOLD',
        dividend_signal='HOLD'
    )
    
    if result:
        print(f"Ticker: {result.ticker}")
        print(f"Signal: {result.signal} ({result.signal_ar})")
        print(f"Confidence: {result.confidence}%")
        print(f"Master Score: {result.master_score}")
        print(f"Technical: {result.technical_score}")
        print(f"Fundamental: {result.fundamental_score}")
        print(f"Indicators Agreeing: {result.indicators_agreeing}")
        print(f"Risk Level: {result.risk_level}")
        print(f"Position Size: {result.suggested_position_pct}%")
    else:
        print("Signal filtered out (low quality)")
    
    print()
    print("=" * 60)
    print("FILTERING RULES")
    print("=" * 60)
    print(f"Min Indicators Agreeing: {MIN_INDICATORS_AGREE}")
    print(f"Min Confidence: {MIN_CONFIDENCE}%")
    print()
    
    # Test Paper Trading
    print("=" * 60)
    print("PAPER TRADING ENGINE")
    print("=" * 60)
    paper_engine = PaperTradingEngine()
    stats = paper_engine.get_accuracy_stats()
    print(f"Current Stats: {stats}")
