"""
⚠️  P1-ENGINE-DISABLED (2026-10-14): This engine is DISABLED.
================================================================
Engine: board_of_analysts
Status: SUB_ENGINE_DISABLED = True (line 29)

This engine has been disabled (returns short-circuit "disabled" signal).
However, its TS routes and UI components are still wired in:
  - /api/v82/* endpoints
  - V82DecisionPanel.tsx component
  - case 'v82' in page.tsx

Rule 73 (SINGLE-DISPLAY-SOURCE): canonical signal comes from
master_analyzer.py only. This disabled engine should be REMOVED entirely
in Phase P2 (including its TS routes + UI components).

See AUDIT_REPORT_FULL.md Section 4.5 (AUDIT-D) for details.

DO NOT re-enable this engine. If you need its functionality, port it
to master_analyzer.py instead.
"""

import os
import sys
import sqlite3
import math
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime

# Resolve default database path
from pathlib import Path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# Try importing existing engines for code reuse
try:
    from analyzers.technical import TechnicalAnalyzer
    from analyzers.confluence_engine_v3 import FundamentalAnalyzer
except ImportError:
    TechnicalAnalyzer = None
    FundamentalAnalyzer = None

# SUB-ENGINE-DISABLED (Task PHASE-3-DISABLE-SUB-ENGINES, Rule 73: SINGLE-DISPLAY-SOURCE)
# Board of Analysts uses thresholds (78/68) that differ from the canonical
# thresholds (78/65) defined in canonical_signal.py. Producing a competing
# `signal` field here violates Rule 67 (CALCULATION-CANONICAL).
# Canonical signal comes from master_analyzer.py + canonical_signal.py.
# This file is kept for backward compatibility (Rule 4: NO-DELETION) but
# generate_final_report() now short-circuits and returns no decision.
SUB_ENGINE_DISABLED = True

# ============================================================================
# ROBUST PRICE HISTORY RETRIEVER
# ============================================================================

def _get_price_history(ticker: str, limit: int = 100, db_path: str = STOCKS_DB) -> List[Tuple[float, float, float, float]]:
    """
    Retrieves price history (close, high, low, volume) for the given ticker.
    Supports querying from stock_daily_prices or stock_price_history tables.
    Returns: List of (close, high, low, volume) tuples, sorted oldest to newest.

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    The db_path argument is accepted for signature compatibility but ignored;
    load_price_history uses the canonical DB paths (stocks.db / price_history.db).
    Volume string cleaning (M/K/\u202f handling) is no longer needed because
    data.prices normalizes volume to int upstream.
    """
    try:
        from data.prices import load_price_history
        history = load_price_history(ticker, limit=limit)
        return [
            (float(c['close']), float(c['high']), float(c['low']), int(c['volume']))
            for c in history
        ]
    except Exception as e:
        print(f"[BoardOfAnalysts] Error fetching price history for {ticker}: {e}")
        return []


# ============================================================================
# BASE ANALYST (EMPLOYEE)
# ============================================================================

class BaseAnalyst(ABC):
    """
    البنية الأساسية لكل المحللين (الموظفين)
    """
    def __init__(self, key: str, name_ar: str, default_weight: float):
        self.key = key
        self.name_ar = name_ar
        self.weight = default_weight
        self.active = True

    @abstractmethod
    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        """
        تقوم كل فئة فرعية بتنفيذ منطق التحليل الخاص بها وإرجاع قاموس يحتوى على:
        - signal: 'STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL', 'AVOID'
        - confidence: 0 to 100
        - reason_ar: شرح باللغة العربية
        - details: تفاصيل حسابية إضافية
        """
        pass

    def get_signal_arabic(self, signal: str) -> str:
        mapping = {
            'STRONG_BUY': 'شراء قوي',
            'BUY': 'شراء',
            'ACCUMULATE': 'تراكم',
            'HOLD': 'انتظار',
            'REDUCE': 'تخفيف',
            'SELL': 'بيع',
            'STRONG_SELL': 'بيع قوي',
            'AVOID': 'تجنب',
            'NEUTRAL': 'محايد'
        }
        return mapping.get(signal, signal)


# ============================================================================
# CONCRETE ANALYSTS (SPECIALIZED EMPLOYEES)
# ============================================================================

class TechnicalAnalyst(BaseAnalyst):
    """
    المحلل الفني - "العجوز"
    יהتم بالشموع اليابانية، مؤشر القوة النسبية (RSI)، ومستويات الدعم والمقاومة.
    """
    def __init__(self):
        super().__init__(key='technical', name_ar='العجوز (فني)', default_weight=0.25)

    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        try:
            rows = _get_price_history(ticker, 100, db_path)

            if not rows or len(rows) < 3:
                return {
                    'signal': 'HOLD',
                    'confidence': 50,
                    'reason_ar': 'بيانات غير كافية للتحليل الفني (مطلوب 3 أيام على الأقل)',
                    'details': {}
                }

            closes = [r[0] for r in rows]
            highs = [r[1] for r in rows]
            lows = [r[2] for r in rows]
            
            # RSI Calculation — CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
            # Backward-compatible wrapper: previously inline Wilder's (math was correct
            # but duplicated). Now delegates to analyzers.indicators.rsi.calc_rsi.
            rsi = 50.0
            if len(closes) >= 15:
                # CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing
                from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
                _rsi_val = _canonical_calc_rsi(closes, 14)
                if _rsi_val is not None:
                    rsi = _rsi_val

            current_price = closes[-1]
            
            # Support/Resistance heuristic (adapt to available days)
            lookback = min(20, len(rows))
            support = min(lows[-lookback:])
            resistance = max(highs[-lookback:])
            
            # Formulate signal
            if rsi <= 35 or current_price <= support * 1.02:
                signal = 'STRONG_BUY' if rsi <= 25 else 'BUY'
                confidence = 80 if rsi <= 25 else 70
                reason = f"السهم فنيًا عند منطقة تشبع بيعي RSI ({rsi:.1f}) وقريب من الدعم ({support:.2f})"
            elif rsi >= 65 or current_price >= resistance * 0.98:
                signal = 'STRONG_SELL' if rsi >= 75 else 'SELL'
                confidence = 80 if rsi >= 75 else 70
                reason = f"السهم فنيًا عند منطقة تشبع شرائي RSI ({rsi:.1f}) وقريب من المقاومة ({resistance:.2f})"
            else:
                signal = 'HOLD'
                confidence = 50
                reason = f"السهم في وضعية محايدة فنيًا، RSI ({rsi:.1f})"

            return {
                'signal': signal,
                'confidence': confidence,
                'reason_ar': reason,
                'details': {'rsi': round(rsi, 2), 'support': round(support, 2), 'resistance': round(resistance, 2)}
            }
        except Exception as e:
            return {
                'signal': 'HOLD',
                'confidence': 40,
                'reason_ar': f"خطأ في التحليل الفني: {str(e)}",
                'details': {}
            }


class FundamentalAnalyst(BaseAnalyst):
    """
    المحلل الأساسي - "المحاسب"
    يهتم بمكررات الربحية والشركات ذات الأرقام القوية والقيمة العادلة.
    """
    def __init__(self):
        super().__init__(key='fundamental', name_ar='المحاسب (أساسي)', default_weight=0.30)

    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT pe_ratio, pb_ratio, roe, dividend_yield, book_value_per_share, sector
                FROM stocks WHERE ticker = ?
            ''', (ticker,))
            row = cursor.fetchone()
            conn.close()

            if not row:
                return {
                    'signal': 'HOLD',
                    'confidence': 50,
                    'reason_ar': 'بيانات مالية غير متوفرة',
                    'details': {}
                }

            pe, pb, roe, div_yield, bv, sector = row
            pe = pe if pe else 15
            pb = pb if pb else 1.5
            roe = roe if roe else 10
            div_yield = div_yield if div_yield else 0

            # Scoring logic
            score = 50
            reasons = []

            if pe < 10:
                score += 15
                reasons.append(f"مكرر ربحية رخيص ({pe:.1f})")
            elif pe > 25:
                score -= 15
                reasons.append(f"مكرر ربحية مرتفع ({pe:.1f})")

            if roe > 15:
                score += 15
                reasons.append(f"معدل عائد على الملكية قوي ({roe:.1f}%)")
            elif roe < 5:
                score -= 10
                reasons.append(f"معدل عائد ضعيف على الملكية ({roe:.1f}%)")

            if div_yield > 5:
                score += 10
                reasons.append(f"توزيعات أرباح مجزية ({div_yield:.1f}%)")

            if score >= 70:
                signal = 'STRONG_BUY' if score >= 80 else 'BUY'
                confidence = int(score)
            elif score <= 35:
                signal = 'SELL'
                confidence = int(100 - score)
            else:
                signal = 'HOLD'
                confidence = 60

            reason_ar = "السهم " + ("ممتاز ماليًا: " if signal in ['BUY', 'STRONG_BUY'] else "ضعيف ماليًا: " if signal == 'SELL' else "متوازن ماليًا: ") + "، ".join(reasons)

            return {
                'signal': signal,
                'confidence': confidence,
                'reason_ar': reason_ar,
                'details': {'pe': pe, 'pb': pb, 'roe': roe, 'div_yield': div_yield}
            }
        except Exception as e:
            return {
                'signal': 'HOLD',
                'confidence': 40,
                'reason_ar': f"خطأ في التحليل الأساسي: {str(e)}",
                'details': {}
            }


class TrendAnalyst(BaseAnalyst):
    """
    المحلل الاتجاهي - "الصياد"
    يهتم بركوب الترند واختراقات القمم.
    """
    def __init__(self):
        super().__init__(key='trend', name_ar='الصياد (اتجاهي)', default_weight=0.25)

    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        try:
            rows = _get_price_history(ticker, 50, db_path)

            if not rows or len(rows) < 3:
                return {
                    'signal': 'HOLD',
                    'confidence': 50,
                    'reason_ar': 'بيانات غير كافية لتحليل الاتجاه (مطلوب 3 أيام على الأقل)',
                    'details': {}
                }

            closes = [r[0] for r in rows]
            
            # Simple SMA based on available rows
            lookback_20 = min(20, len(closes))
            lookback_50 = min(50, len(closes))
            
            sma_20 = sum(closes[-lookback_20:]) / lookback_20
            sma_50 = sum(closes[-lookback_50:]) / lookback_50
            current_price = closes[-1]

            if current_price >= sma_20 >= sma_50:
                signal = 'BUY'
                confidence = 75
                reason = "السعر في اتجاه صاعد فوق المتوسطات المتحركة المتاحة"
            elif current_price <= sma_20 <= sma_50:
                signal = 'SELL'
                confidence = 75
                reason = "السعر في اتجاه هابط تحت المتوسطات المتحركة المتاحة"
            else:
                signal = 'HOLD'
                confidence = 50
                reason = "السعر يتحرك بشكل عرضي متذبذب حول المتوسطات"

            return {
                'signal': signal,
                'confidence': confidence,
                'reason_ar': reason,
                'details': {'sma_20': round(sma_20, 2), 'sma_50': round(sma_50, 2)}
            }
        except Exception as e:
            return {
                'signal': 'HOLD',
                'confidence': 40,
                'reason_ar': f"خطأ في تحليل الاتجاه: {str(e)}",
                'details': {}
            }


class TapeAnalyst(BaseAnalyst):
    """
    محلل السيولة - "الجاسوس"
    يهتم بأحجام التداول والتدفقات المالية وحركات المضاربين الكبار.
    """
    def __init__(self):
        super().__init__(key='tape', name_ar='الجاسوس (سيولة)', default_weight=0.10)

    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        try:
            rows = _get_price_history(ticker, 20, db_path)

            if not rows or len(rows) < 2:
                return {
                    'signal': 'HOLD',
                    'confidence': 50,
                    'reason_ar': 'بيانات السيولة غير متوفرة (مطلوب يومين على الأقل)',
                    'details': {}
                }

            volumes = [r[3] if r[3] else 0 for r in rows]
            avg_volume = sum(volumes[:-1]) / (len(volumes) - 1) if len(volumes) > 1 else 1
            today_volume = volumes[-1]
            volume_ratio = today_volume / avg_volume if avg_volume > 0 else 1

            if volume_ratio >= 1.5:
                signal = 'BUY'
                confidence = 80
                reason = f"ارتفاع في أحجام التداول بمعدل ({volume_ratio:.1f}x) مما يشير لدخول سيولة إيجابية"
            elif volume_ratio <= 0.4:
                signal = 'HOLD'
                confidence = 60
                reason = f"ضعف شديد في أحجم التداول على السهم ({volume_ratio:.2f}x)"
            else:
                signal = 'HOLD'
                confidence = 50
                reason = f"أحجام تداول طبيعية وضمن المعدلات المعتادة ({volume_ratio:.1f}x)"

            return {
                'signal': signal,
                'confidence': confidence,
                'reason_ar': reason,
                'details': {'volume_ratio': round(volume_ratio, 2), 'today_volume': today_volume}
            }
        except Exception as e:
            return {
                'signal': 'HOLD',
                'confidence': 40,
                'reason_ar': f"خطأ في تحليل السيولة: {str(e)}",
                'details': {}
            }


class MacroAnalyst(BaseAnalyst):
    """
    المحلل السوقي - "الفيلسوف"
    يهتم بنظرة السوق العامة والمؤشر العام والقطاعات.
    """
    def __init__(self):
        super().__init__(key='macro', name_ar='الفيلسوف (سوقي)', default_weight=0.10)

    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT value FROM app_state WHERE key = 'market_regime'
            ''')
            row = cursor.fetchone()
            
            regime = 'NORMAL'
            if row:
                regime = row[0]
            else:
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_regime_log'")
                if cursor.fetchone():
                    cursor.execute("SELECT regime FROM market_regime_log ORDER BY date DESC LIMIT 1")
                    reg_row = cursor.fetchone()
                    if reg_row:
                        regime = reg_row[0]
            
            conn.close()

            if regime in ['BEARISH', 'BEAR', 'DOWNWARD']:
                signal = 'AVOID'
                confidence = 85
                reason = "السوق العام هابط للغاية، الفيلسوف ينصح بالبقاء في الكاش وتجنب الدخول"
            elif regime in ['BULLISH', 'BULL', 'UPWARD']:
                signal = 'BUY'
                confidence = 75
                reason = "السوق العام في اتجاه صاعد قوي (Stage 2) وهو الوقت الأمثل للشراء"
            else:
                signal = 'HOLD'
                confidence = 50
                reason = "السوق العام محايد أو عرضي حاليًا، تداول بحذر"

            return {
                'signal': signal,
                'confidence': confidence,
                'reason_ar': reason,
                'details': {'market_regime': regime}
            }
        except Exception as e:
            return {
                'signal': 'HOLD',
                'confidence': 50,
                'reason_ar': "السوق العام غير واضح حالياً، تداول بحذر",
                'details': {}
            }


class PersonalityAnalyst(BaseAnalyst):
    """
    محلل الشخصية - "المعالج النفسي"
    يحدد سلوك وطباع السهم التاريخي (نطاقي، اتجاهي، متلاعب، ميت).
    """
    def __init__(self):
        super().__init__(key='personality', name_ar='المعالج (شخصية)', default_weight=0.10)

    def analyze(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        try:
            rows = _get_price_history(ticker, 120, db_path)

            if not rows or len(rows) < 3:
                return {
                    'signal': 'HOLD',
                    'confidence': 50,
                    'reason_ar': 'بيانات تاريخية غير كافية لتحديد الشخصية (مطلوب 3 أيام على الأقل)',
                    'details': {'personality': 'unknown'}
                }

            closes = [r[0] for r in rows]
            volumes = [r[3] if r[3] else 0 for r in rows]
            
            # Calculations for classification
            mean_price = sum(closes) / len(closes)
            std_price = math.sqrt(sum((x - mean_price)**2 for x in closes) / len(closes))
            cv_price = std_price / mean_price if mean_price > 0 else 0
            
            avg_volume = sum(volumes) / len(volumes)
            
            # 1. Check if Dead stock (low volume/low volatility)
            if avg_volume < 10000 or cv_price < 0.01:
                personality = 'dead'
                signal = 'AVOID'
                confidence = 90
                reason = "سهم ميت: سيولة ضعيفة جداً وتذبذبات منعدمة، لا يصلح للمتاجرة"
            
            # 2. Check if Range-Bound (High stability in range)
            elif cv_price < 0.08:
                personality = 'range'
                min_p, max_p = min(closes), max(closes)
                range_size = max_p - min_p
                current = closes[-1]
                position_pct = (current - min_p) / range_size if range_size > 0 else 0.5
                
                if position_pct < 0.35:
                    signal = 'BUY'
                    confidence = 75
                    reason = "سهم نطاقي: السعر قريب حاليًا من القاع التاريخي للنطاق العرضي"
                elif position_pct > 0.65:
                    signal = 'SELL'
                    confidence = 75
                    reason = "سهم نطاقي: السعر قريب حاليًا من قمة النطاق العرضي وهو وقت مناسب للبيع"
                else:
                    signal = 'HOLD'
                    confidence = 50
                    reason = "سهم نطاقي: السعر يتحرك في منتصف النطاق العرضي المعتاد"
            
            # 3. Check if Whale-Played (Volume spikes, gaps)
            elif max(volumes) > avg_volume * 4:
                personality = 'whale'
                signal = 'BUY' if closes[-1] >= closes[-2] else 'SELL'
                confidence = 70
                reason = "سهم متلاعب: يخضع لسيطرة صانع سوق أو مضاربين بحركات عنيفة وأحجام ضخمة مفاجئة"
                
            # 4. Otherwise Trending
            else:
                personality = 'trend'
                signal = 'BUY' if closes[-1] > closes[0] else 'SELL'
                confidence = 65
                reason = "سهم اتجاهي: يتحرك في موجة اتجاهية واضحة ومستمرة"

            return {
                'signal': signal,
                'confidence': confidence,
                'reason_ar': reason,
                'details': {'personality': personality, 'cv_price': cv_price, 'avg_volume': avg_volume}
            }
        except Exception as e:
            return {
                'signal': 'HOLD',
                'confidence': 50,
                'reason_ar': f"خطأ في تحليل الشخصية: {str(e)}",
                'details': {'personality': 'unknown'}
            }


# ============================================================================
# DEPARTMENT MANAGER (BOARD MANAGER)
# ============================================================================

class BoardManager(ABC):
    """
    الفئة الأساسية لمدير الإدارة (Board Manager)
    يقوم بالتنسيق بين الخبراء العاملين تحت إدارته وتجميع آرائهم لإصدار التقرير النهائي.
    """
    def __init__(self, market: str, default_weights: Dict[str, float], sell_strategy: str):
        self.market = market.upper()
        self.default_weights = default_weights
        self.sell_strategy = sell_strategy
        self.analysts: Dict[str, BaseAnalyst] = {}
        self.initialize_analysts()

    @abstractmethod
    def initialize_analysts(self):
        """تخصيص المحللين وتحديد أوزانهم التلقائية"""
        pass

    def configure_analysts(self, settings: Dict[str, Any]):
        """
        تحديث الإعدادات (تشغيل/إطفاء المحللين وتغيير أوزانهم) ديناميكياً
        settings: {'technical': {'active': True, 'weight': 0.3}, ...}
        """
        for key, config in settings.items():
            if key in self.analysts:
                if 'active' in config:
                    self.analysts[key].active = bool(config['active'])
                if 'weight' in config:
                    self.analysts[key].weight = float(config['weight'])

    def generate_final_report(self, ticker: str, db_path: str = STOCKS_DB) -> Dict[str, Any]:
        """
        يقوم المدير بتشغيل المحللين النشطين، حساب النقاط المرجحة، وتحديد التوصية المناسبة.
        """
        # SUB-ENGINE-DISABLED (Task PHASE-3-DISABLE-SUB-ENGINES, Rule 73)
        # Canonical signal is produced only by master_analyzer.py + canonical_signal.py
        # (thresholds 78/65). Board thresholds (78/68) produce competing signals.
        # Short-circuit and return no decision — callers must consume the canonical source.
        if SUB_ENGINE_DISABLED:
            return {
                'ticker': ticker,
                'market': getattr(self, 'market', None),
                'success': True,
                'disabled': True,
                'signal': None,
                'recommendation': None,
                'signal_ar': None,
                'confidence': 0.0,
                'master_score': 0.0,
                'opinions': {},
                'reason_ar': 'تم إيقاف محرك مجلس المحللين — استخدم canonical_signal.py',
                'canonical_source': 'master_analyzer.py',
                'timestamp': datetime.now().isoformat(),
            }

        active_analysts = [a for a in self.analysts.values() if a.active]
        if not active_analysts:
            return {
                'ticker': ticker,
                'market': self.market,
                'success': False,
                'error': 'لا يوجد محللون نشطون في هذا المجلس حالياً'
            }

        total_weight = sum(a.weight for a in active_analysts)
        normalized_weights = {a.key: (a.weight / total_weight if total_weight > 0 else 0) for a in active_analysts}

        opinions = {}
        weighted_score = 0.0
        reasons_list = []
        avoids_count = 0
        buys_count = 0
        sells_count = 0

        # Helper: Convert signal to score for mathematical aggregation
        signal_scores = {
            'STRONG_BUY': 90,
            'BUY': 75,
            'ACCUMULATE': 60,
            'HOLD': 50,
            'NEUTRAL': 50,
            'REDUCE': 40,
            'SELL': 25,
            'STRONG_SELL': 10,
            'AVOID': 0
        }

        for analyst in active_analysts:
            opinion = analyst.analyze(ticker, db_path)
            opinions[analyst.key] = {
                'name': analyst.name_ar,
                'signal': opinion['signal'],
                'signal_ar': analyst.get_signal_arabic(opinion['signal']),
                'confidence': opinion['confidence'],
                'reason_ar': opinion['reason_ar'],
                'details': opinion.get('details', {})
            }
            
            sig = opinion['signal']
            if sig == 'AVOID':
                avoids_count += 1
            elif sig in ['BUY', 'STRONG_BUY']:
                buys_count += 1
            elif sig in ['SELL', 'STRONG_SELL']:
                sells_count += 1

            base_score = signal_scores.get(sig, 50)
            weighted_score += base_score * normalized_weights[analyst.key]
            
            if sig != 'HOLD':
                reasons_list.append(f"{analyst.name_ar}: {opinion['reason_ar']}")

        # Determine consolidated signal
        if avoids_count >= 1:
            final_signal = 'AVOID'
            final_confidence = 90.0
        elif weighted_score >= 68:
            final_signal = 'BUY' if weighted_score < 78 else 'STRONG_BUY'
            final_confidence = weighted_score
        elif weighted_score <= 38:
            final_signal = 'SELL'
            final_confidence = 100 - weighted_score
        else:
            final_signal = 'HOLD'
            final_confidence = 50.0

        # Determine recommendations based on current price
        rows = _get_price_history(ticker, 1, db_path)
        current_price = rows[0][0] if rows else 1.0
        entry = current_price
        
        # Calculate targets and stops based on Sell Strategy
        if self.sell_strategy == 'range_bound':
            target = current_price * 1.12
            stop = current_price * 0.96
            strategy_desc = "جني ربح جزئي (بيع 50% عند القمة، 50% انتظار اختراق)"
        elif self.sell_strategy == 'trailing_stop':
            target = current_price * 1.25
            stop = current_price * 0.94
            strategy_desc = "وقف متحرك متطور (ملاحقة الاتجاه لأقصى مدى)"
        else: # quick
            target = current_price * 1.08
            stop = current_price * 0.97
            strategy_desc = "جني ربح سريع (خروج سريع وبكميات أصغر للوقاية)"

        final_reason = f"تقرير رئيس مجلس إدارة سوق {self.market}: " + (" ، ".join(reasons_list[:3]) if reasons_list else "السوق محايد حاليًا")

        return {
            'ticker': ticker,
            'market': self.market,
            'success': True,
            'signal': final_signal,
            'signal_ar': self.analysts[active_analysts[0].key].get_signal_arabic(final_signal),
            'confidence': round(final_confidence, 1),
            'master_score': round(weighted_score, 1),
            'opinions': opinions,
            'sell_strategy': self.sell_strategy,
            'sell_strategy_desc': strategy_desc,
            'entry_price': round(entry, 2),
            'target_price': round(target, 2),
            'stop_loss': round(stop, 2),
            'reason_ar': final_reason,
            'timestamp': datetime.now().isoformat()
        }


# ============================================================================
# CONCRETE MARKET BOARDS (DEPARTMENTS)
# ============================================================================

class EGXBoardManager(BoardManager):
    """
    مجلس إدارة البورصة المصرية (EGX Board)
    """
    def __init__(self):
        # Default Weights: Fundamental 35%, Technical 30%, Personality 20%, Macro 10%, Trend 5%
        weights = {
            'fundamental': 0.35,
            'technical': 0.30,
            'personality': 0.20,
            'macro': 0.10,
            'trend': 0.05
        }
        super().__init__(market='EGX', default_weights=weights, sell_strategy='range_bound')

    def initialize_analysts(self):
        self.analysts['fundamental'] = FundamentalAnalyst()
        self.analysts['technical'] = TechnicalAnalyst()
        self.analysts['personality'] = PersonalityAnalyst()
        self.analysts['macro'] = MacroAnalyst()
        self.analysts['trend'] = TrendAnalyst()
        
        for key, w in self.default_weights.items():
            if key in self.analysts:
                self.analysts[key].weight = w


class TadawulBoardManager(BoardManager):
    """
    مجلس إدارة السوق السعودي (Tadawul Board)
    """
    def __init__(self):
        # Default Weights: Trend 40%, Technical 25%, Macro 20%, Fundamental 10%, Tape 5%
        weights = {
            'trend': 0.40,
            'technical': 0.25,
            'macro': 0.20,
            'fundamental': 0.10,
            'tape': 0.05
        }
        super().__init__(market='TADAWUL', default_weights=weights, sell_strategy='trailing_stop')

    def initialize_analysts(self):
        self.analysts['trend'] = TrendAnalyst()
        self.analysts['technical'] = TechnicalAnalyst()
        self.analysts['macro'] = MacroAnalyst()
        self.analysts['fundamental'] = FundamentalAnalyst()
        self.analysts['tape'] = TapeAnalyst()

        for key, w in self.default_weights.items():
            if key in self.analysts:
                self.analysts[key].weight = w


class CryptoBoardManager(BoardManager):
    """
    مجلس إدارة سوق العملات الرقمية (Crypto Board)
    """
    def __init__(self):
        # Default Weights: Tape 35%, Trend 30%, Macro 20%, Technical 15%
        weights = {
            'tape': 0.35,
            'trend': 0.30,
            'macro': 0.20,
            'technical': 0.15
        }
        super().__init__(market='CRYPTO', default_weights=weights, sell_strategy='quick')

    def initialize_analysts(self):
        self.analysts['tape'] = TapeAnalyst()
        self.analysts['trend'] = TrendAnalyst()
        self.analysts['macro'] = MacroAnalyst()
        self.analysts['technical'] = TechnicalAnalyst()

        for key, w in self.default_weights.items():
            if key in self.analysts:
                self.analysts[key].weight = w


class KuwaitBoardManager(BoardManager):
    """
    مجلس إدارة السوق الكويتي (Kuwait Board)
    """
    def __init__(self):
        weights = {
            'trend': 0.40,
            'technical': 0.25,
            'macro': 0.20,
            'fundamental': 0.10,
            'tape': 0.05
        }
        super().__init__(market='KSE', default_weights=weights, sell_strategy='trailing_stop')

    def initialize_analysts(self):
        self.analysts['trend'] = TrendAnalyst()
        self.analysts['technical'] = TechnicalAnalyst()
        self.analysts['macro'] = MacroAnalyst()
        self.analysts['fundamental'] = FundamentalAnalyst()
        self.analysts['tape'] = TapeAnalyst()

        for key, w in self.default_weights.items():
            if key in self.analysts:
                self.analysts[key].weight = w


class QatarBoardManager(BoardManager):
    """
    مجلس إدارة السوق القطري (Qatar Board)
    """
    def __init__(self):
        weights = {
            'trend': 0.40,
            'technical': 0.25,
            'macro': 0.20,
            'fundamental': 0.10,
            'tape': 0.05
        }
        super().__init__(market='QSE', default_weights=weights, sell_strategy='trailing_stop')

    def initialize_analysts(self):
        self.analysts['trend'] = TrendAnalyst()
        self.analysts['technical'] = TechnicalAnalyst()
        self.analysts['macro'] = MacroAnalyst()
        self.analysts['fundamental'] = FundamentalAnalyst()
        self.analysts['tape'] = TapeAnalyst()

        for key, w in self.default_weights.items():
            if key in self.analysts:
                self.analysts[key].weight = w


# Helper to get the correct manager for a market
def get_board_manager(market: str) -> BoardManager:
    m = market.upper()
    if m in ['EGX', 'EGYPT']:
        return EGXBoardManager()
    elif m in ['TADAWUL', 'KSA', 'SAUDI']:
        return TadawulBoardManager()
    elif m in ['CRYPTO', 'BITCOIN']:
        return CryptoBoardManager()
    elif m in ['KSE', 'KUWAIT']:
        return KuwaitBoardManager()
    elif m in ['QSE', 'QATAR']:
        return QatarBoardManager()
    else:
        return TadawulBoardManager()
