"""
Fundamental Quality Gate
========================
بوابة الجودة الأساسية — 🔥 Step 4: Enhanced with Balance Sheet + Cash Flow

يقيم جودة السهم الأساسية باستخدام 7 جداول مالية:
1. tab_profitability (ROE, ROA, Net Margin, FCF Margin)
2. tab_valuation (P/E, P/B)
3. tab_performance (1Y, YTD, Volatility)
4. tab_dividends (cont_div, payout)
5. tab_income_statement (Revenue Growth)
6. tab_balance_sheet (Debt-to-Equity, Cash Ratio, Current Ratio) ← NEW
7. tab_cash_flow (FCF Yield, Operating CF positive) ← NEW

القرارات:
- PASS (score ≥ 60) → STRONG_BUY مسموح
- REVIEW (score 40-59) → BUY مع حذر
- FAIL (score < 40) → HOLD فقط
- NO_DATA → محايد (مش بيلغي)

Multi-market:
- STOCK (EGX/KSA/KSE/QSE/DFM) → 7 عوامل
- CRYPTO → 3 عوامل بس (لا أساسيات)

@author M2yDevelopers Team
@version 2.0.0 — Dual Persona Enhancement (July 2026)
"""

import os
import re
import sqlite3
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

try:
    from config import DATABASE_PATH, PROJECT_ROOT
    DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
except ImportError:
    BASE_DIR = Path(__file__).parent.parent.parent.resolve()
    DATA_ENGINE_DB = str(BASE_DIR / 'db' / 'data_engine.db')
    PROJECT_ROOT = BASE_DIR

# Market-specific thresholds
MARKET_THRESHOLDS = {
    'EGX': {
        'pass_score': 60,
        'review_score': 40,
        'factors': ['profitability', 'valuation', 'growth', 'stability', 'financial_health', 'cash_flow_quality', 'dividends'],
    },
    'KSA': {
        'pass_score': 55,
        'review_score': 35,
        'factors': ['profitability', 'valuation', 'growth', 'stability', 'financial_health', 'cash_flow_quality'],
    },
    'KSE': {
        'pass_score': 55,
        'review_score': 35,
        'factors': ['profitability', 'valuation', 'growth', 'stability', 'financial_health'],
    },
    'QSE': {
        'pass_score': 55,
        'review_score': 35,
        'factors': ['profitability', 'valuation', 'growth', 'stability', 'financial_health'],
    },
    'DFM': {
        'pass_score': 55,
        'review_score': 35,
        'factors': ['profitability', 'valuation', 'growth', 'stability', 'financial_health'],
    },
    'CRYPTO': {
        'pass_score': 30,  # Very low bar — no fundamentals
        'review_score': 15,
        'factors': ['volume', 'momentum', 'liquidity'],  # Crypto-style 3 factors
    },
    'DEFAULT': {
        'pass_score': 60,
        'review_score': 40,
        'factors': ['profitability', 'valuation', 'growth', 'stability'],
    },
}


# ============================================================================
# HELPERS
# ============================================================================

def parse_number(value) -> Optional[float]:
    """Parse a formatted financial number string like '335.05 M SAR' or '−4.5 M SAR'.
    
    Handles:
    - Unicode minus sign (−) and regular minus (-)
    - Suffixes: K, M, B, T (thousands, millions, billions, trillions)
    - Currency suffixes: SAR, EGP, KWD, QAR, AED, USD
    - Percentage signs
    - Plain numbers
    """
    if value is None:
        return None
    
    if isinstance(value, (int, float)):
        return float(value)
    
    s = str(value).strip()
    if not s or s.lower() in ('n/a', '-', '—', '–', 'na', 'null', 'none', ''):
        return None
    
    # Replace Unicode minus with regular minus
    s = s.replace('\u2212', '-').replace('\u2013', '-').replace('\u2014', '-')
    
    # Remove currency suffixes
    for currency in ['SAR', 'EGP', 'KWD', 'QAR', 'AED', 'USD', 'EGP']:
        s = s.replace(currency, '')
    
    s = s.strip()
    
    # Handle percentage
    if '%' in s:
        s = s.replace('%', '').strip()
        try:
            return float(s)
        except ValueError:
            return None
    
    # Handle suffixes (K, M, B, T)
    multiplier = 1.0
    s_upper = s.upper()
    if s_upper.endswith('T'):
        multiplier = 1_000_000_000_000
        s = s[:-1].strip()
    elif s_upper.endswith('B'):
        multiplier = 1_000_000_000
        s = s[:-1].strip()
    elif s_upper.endswith('M'):
        multiplier = 1_000_000
        s = s[:-1].strip()
    elif s_upper.endswith('K'):
        multiplier = 1_000
        s = s[:-1].strip()
    
    try:
        return float(s) * multiplier
    except ValueError:
        # Try extracting just the number
        nums = re.findall(r'-?[\d.]+', s)
        if nums:
            try:
                return float(nums[0]) * multiplier
            except ValueError:
                return None
        return None


def detect_market_type(ticker: str, market: str = '') -> Tuple[str, str]:
    """Detect market type and code from ticker and market.
    
    Returns:
        (market_type, market_code) — e.g. ('STOCK', 'EGX'), ('CRYPTO', 'CRYPTO')
    """
    market_upper = market.upper().strip()
    
    # Direct market mapping
    stock_markets = {'EGX', 'KSA', 'TADAWUL', 'KSE', 'QSE', 'DFM', 'SA', 'KW', 'QA', 'AE'}
    if market_upper in stock_markets:
        # Normalize
        if market_upper in ('TADAWUL', 'SA'):
            return ('STOCK', 'KSA')
        elif market_upper == 'KW':
            return ('STOCK', 'KSE')
        elif market_upper == 'QA':
            return ('STOCK', 'QSE')
        elif market_upper == 'AE':
            return ('STOCK', 'DFM')
        return ('STOCK', market_upper)
    
    if market_upper == 'CRYPTO':
        return ('CRYPTO', 'CRYPTO')
    
    # Auto-detect from ticker patterns
    crypto_prefixes = ('BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'DOT', 'MATIC', 'AVAX',
                        'SHIB', 'LINK', 'UNI', 'ATOM', 'LTC', 'TRX', 'TON')
    ticker_upper = ticker.upper()
    
    # Check for crypto ticker patterns
    if any(ticker_upper.startswith(p) for p in crypto_prefixes):
        return ('CRYPTO', 'CRYPTO')
    if 'USDT' in ticker_upper or 'BUSD' in ticker_upper:
        return ('CRYPTO', 'CRYPTO')
    
    # Saudi ticker patterns (4-digit numbers or .SR suffix)
    if re.match(r'^\d{4}$', ticker) or ticker.endswith('.SR'):
        return ('STOCK', 'KSA')
    
    # Default: EGX stock
    return ('STOCK', 'EGX')


# ============================================================================
# RESULT DATA CLASS
# ============================================================================

@dataclass
class QualityGateResult:
    """نتيجة فحص بوابة الجودة"""
    decision: str          # PASS, REVIEW, FAIL, NO_DATA
    score: float           # 0-100
    passed: bool           # True for PASS and NO_DATA
    components: Dict[str, float] = field(default_factory=dict)
    reasons: List[str] = field(default_factory=list)
    market_type: str = 'STOCK'
    market_code: str = 'EGX'
    
    def to_dict(self) -> dict:
        return {
            'decision': self.decision,
            'score': round(self.score, 1),
            'passed': self.passed,
            'components': {k: round(v, 1) for k, v in self.components.items()},
            'reasons': self.reasons,
            'market_type': self.market_type,
            'market_code': self.market_code,
        }


# ============================================================================
# FUNDAMENTAL QUALITY GATE
# ============================================================================

class FundamentalQualityGate:
    """بوابة الجودة الأساسية
    
    تقيم جودة السهم بناءً على 7 جداول مالية.
    للمستثمر 🏦: لازم PASS (score ≥ 60)
    للمضارب 🎰: فحص مبسط (سيولة + P/E مش سالب)
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DATA_ENGINE_DB
        self._conn = None
    
    def _get_connection(self):
        """Get database connection (lazy)."""
        if self._conn is not None:
            try:
                self._conn.execute('SELECT 1')
                return self._conn
            except Exception:
                self._conn = None
        
        if os.path.exists(self.db_path):
            try:
                self._conn = sqlite3.connect(self.db_path, timeout=15.0)
                self._conn.row_factory = sqlite3.Row
                self._conn.execute('PRAGMA journal_mode=WAL')
                return self._conn
            except Exception as e:
                logger.warning(f"Quality Gate: DB connection failed: {e}")
                return None
        return None
    
    def check(self, ticker: str, market: str = 'EGX', mode: str = 'full') -> QualityGateResult:
        """فحص جودة السهم الأساسية.
        
        Args:
            ticker: رمز السهم
            market: السوق (EGX, KSA, KSE, QSE, DFM, CRYPTO)
            mode: 'full' (Investor 🏦 — 7 factors), 'simple' (Gambler 🎰 — 3 factors)
        
        Returns:
            QualityGateResult
        """
        market_type, market_code = detect_market_type(ticker, market)
        
        # CRYPTO → auto PASS (no fundamental data)
        if market_type == 'CRYPTO':
            return QualityGateResult(
                decision='NO_DATA',
                score=50.0,
                passed=True,
                components={'volume': 50, 'momentum': 50, 'liquidity': 50},
                reasons=['CRYPTO — لا بيانات أساسية متاحة'],
                market_type='CRYPTO',
                market_code='CRYPTO',
            )
        
        # Get market thresholds
        thresholds = MARKET_THRESHOLDS.get(market_code, MARKET_THRESHOLDS['DEFAULT'])
        
        # Get financial data
        conn = self._get_connection()
        if not conn:
            return QualityGateResult(
                decision='NO_DATA',
                score=50.0,
                passed=True,
                reasons=['قاعدة البيانات غير متاحة'],
                market_type=market_type,
                market_code=market_code,
            )
        
        components = {}
        reasons = []
        
        try:
            # 🏦 Investor mode: full 7-factor analysis
            if mode == 'full':
                components, reasons = self._evaluate_full(conn, ticker, market_code)
            else:
                # 🎰 Gambler mode: simplified 3-factor check
                components, reasons = self._evaluate_simple(conn, ticker, market_code)
        except Exception as e:
            logger.error(f"Quality Gate error for {ticker}: {e}")
            return QualityGateResult(
                decision='NO_DATA',
                score=50.0,
                passed=True,
                reasons=[f'خطأ في التحليل: {str(e)[:50]}'],
                market_type=market_type,
                market_code=market_code,
            )
        
        # Calculate overall score (average of available components)
        if components:
            score = sum(components.values()) / len(components)
        else:
            score = 50.0
        
        # Determine decision
        pass_score = thresholds['pass_score']
        review_score = thresholds['review_score']
        
        if score >= pass_score:
            decision = 'PASS'
            passed = True
        elif score >= review_score:
            decision = 'REVIEW'
            passed = False
            reasons.append(f'درجة الجودة {score:.0f} — تحتاج مراجعة')
        else:
            decision = 'FAIL'
            passed = False
            reasons.append(f'درجة الجودة {score:.0f} — غير مقبول')
        
        return QualityGateResult(
            decision=decision,
            score=score,
            passed=passed,
            components=components,
            reasons=reasons,
            market_type=market_type,
            market_code=market_code,
        )
    
    def _evaluate_full(self, conn, ticker: str, market_code: str) -> Tuple[Dict[str, float], List[str]]:
        """🏦 Investor mode: Full 7-factor evaluation."""
        components = {}
        reasons = []
        
        cur = conn.cursor()
        
        # 1. Profitability (ROE, ROA, Net Margin)
        profitability_score = self._evaluate_profitability(cur, ticker, market_code)
        if profitability_score is not None:
            components['profitability'] = profitability_score
            if profitability_score < 40:
                reasons.append('الربحية ضعيفة')
        
        # 2. Valuation (P/E, P/B)
        valuation_score = self._evaluate_valuation(cur, ticker, market_code)
        if valuation_score is not None:
            components['valuation'] = valuation_score
            if valuation_score < 40:
                reasons.append('التقييم مرتفع')
        
        # 3. Growth (Revenue Growth)
        growth_score = self._evaluate_growth(cur, ticker, market_code)
        if growth_score is not None:
            components['growth'] = growth_score
            if growth_score < 40:
                reasons.append('النمو ضعيف أو سلبي')
        
        # 4. Stability (Performance, Volatility)
        stability_score = self._evaluate_stability(cur, ticker, market_code)
        if stability_score is not None:
            components['stability'] = stability_score
        
        # 5. Dividends
        dividend_score = self._evaluate_dividends(cur, ticker, market_code)
        if dividend_score is not None:
            components['dividends'] = dividend_score
            if dividend_score >= 70:
                reasons.append('توزيعات مستقرة')
        
        # 🔥 NEW: 6. Financial Health (Balance Sheet)
        health_score, health_reasons = self._evaluate_financial_health(cur, ticker, market_code)
        if health_score is not None:
            components['financial_health'] = health_score
            reasons.extend(health_reasons)
        
        # 🔥 NEW: 7. Cash Flow Quality
        cf_score, cf_reasons = self._evaluate_cash_flow(cur, ticker, market_code)
        if cf_score is not None:
            components['cash_flow_quality'] = cf_score
            reasons.extend(cf_reasons)
        
        return components, reasons
    
    def _evaluate_simple(self, conn, ticker: str, market_code: str) -> Tuple[Dict[str, float], List[str]]:
        """🎰 Gambler mode: Simplified 3-factor check (liquidity + not losing + price > 1)."""
        components = {}
        reasons = []
        
        cur = conn.cursor()
        
        # 1. Liquidity check
        try:
            cur.execute("SELECT volume FROM stocks WHERE ticker = ?", (ticker,))
            row = cur.fetchone()
            volume = parse_number(row['volume']) if row else None
            if volume and volume > 100_000:
                components['liquidity'] = 70
            elif volume and volume > 10_000:
                components['liquidity'] = 50
            else:
                components['liquidity'] = 30
                reasons.append('سيولة منخفضة')
        except Exception:
            components['liquidity'] = 50
        
        # 2. P/E not negative (company not losing money)
        valuation_score = self._evaluate_valuation(cur, ticker, market_code)
        if valuation_score is not None:
            components['valuation'] = valuation_score
            if valuation_score < 30:
                reasons.append('الشركة خاسرة — P/E سالب')
        else:
            components['valuation'] = 50
        
        # 3. Price > 1 (not penny stock)
        try:
            cur.execute("SELECT current_price FROM stocks WHERE ticker = ?", (ticker,))
            row = cur.fetchone()
            price = parse_number(row['current_price']) if row else None
            if price and price > 1:
                components['price_filter'] = 70
            else:
                components['price_filter'] = 30
                reasons.append('سعر أقل من 1 — penny stock')
        except Exception:
            components['price_filter'] = 50
        
        return components, reasons
    
    # ========================================================================
    # Individual Factor Evaluations
    # ========================================================================
    
    def _evaluate_profitability(self, cur, ticker: str, market_code: str) -> Optional[float]:
        """Evaluate profitability from tab_profitability."""
        try:
            cur.execute("""
                SELECT roe, roa, net_margin, fcf_margin 
                FROM tab_profitability 
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                return None
            
            scores = []
            roe = parse_number(row['roe'])
            roa = parse_number(row['roa'])
            net_margin = parse_number(row['net_margin'])
            fcf_margin = parse_number(row['fcf_margin'])
            
            # ROE scoring: >20 excellent, >15 good, >10 ok, >5 poor, <5 bad
            if roe is not None:
                if roe > 20: scores.append(90)
                elif roe > 15: scores.append(75)
                elif roe > 10: scores.append(60)
                elif roe > 5: scores.append(45)
                elif roe > 0: scores.append(30)
                else: scores.append(10)
            
            # ROA scoring
            if roa is not None:
                if roa > 10: scores.append(90)
                elif roa > 5: scores.append(70)
                elif roa > 2: scores.append(55)
                elif roa > 0: scores.append(35)
                else: scores.append(10)
            
            # Net Margin scoring
            if net_margin is not None:
                if net_margin > 20: scores.append(90)
                elif net_margin > 15: scores.append(75)
                elif net_margin > 10: scores.append(60)
                elif net_margin > 5: scores.append(45)
                elif net_margin > 0: scores.append(30)
                else: scores.append(10)
            
            # FCF Margin scoring
            if fcf_margin is not None:
                if fcf_margin > 10: scores.append(85)
                elif fcf_margin > 5: scores.append(65)
                elif fcf_margin > 0: scores.append(45)
                else: scores.append(15)
            
            return sum(scores) / len(scores) if scores else None
        except Exception as e:
            logger.debug(f"Profitability evaluation failed for {ticker}: {e}")
            return None
    
    def _evaluate_valuation(self, cur, ticker: str, market_code: str) -> Optional[float]:
        """Evaluate valuation from tab_valuation."""
        try:
            cur.execute("""
                SELECT pe_ratio, pb_ratio 
                FROM tab_valuation 
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                # Try from stocks table
                cur.execute("SELECT pe_ratio, pb_ratio FROM stocks WHERE ticker = ?", (ticker,))
                row = cur.fetchone()
            if not row:
                return None
            
            scores = []
            pe = parse_number(row['pe_ratio']) if 'pe_ratio' in row.keys() else parse_number(row[0])
            pb = parse_number(row['pb_ratio']) if 'pb_ratio' in row.keys() else parse_number(row[1])
            
            # P/E scoring: <10 undervalued, 10-20 fair, >30 overvalued, <0 losing
            if pe is not None:
                if pe < 0: scores.append(10)  # Losing money
                elif pe < 8: scores.append(90)  # Very cheap
                elif pe < 12: scores.append(80)
                elif pe < 20: scores.append(65)
                elif pe < 30: scores.append(45)
                elif pe < 50: scores.append(30)
                else: scores.append(15)
            
            # P/B scoring: <1 undervalued, 1-3 fair, >5 overvalued
            if pb is not None:
                if pb < 0.5: scores.append(90)
                elif pb < 1: scores.append(80)
                elif pb < 2: scores.append(65)
                elif pb < 3: scores.append(50)
                elif pb < 5: scores.append(35)
                else: scores.append(15)
            
            return sum(scores) / len(scores) if scores else None
        except Exception as e:
            logger.debug(f"Valuation evaluation failed for {ticker}: {e}")
            return None
    
    def _evaluate_growth(self, cur, ticker: str, market_code: str) -> Optional[float]:
        """Evaluate growth from tab_income_statement."""
        try:
            cur.execute("""
                SELECT revenue_growth 
                FROM tab_income_statement 
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                return None
            
            growth = parse_number(row['revenue_growth']) if 'revenue_growth' in row.keys() else parse_number(row[0])
            if growth is None:
                return None
            
            # Revenue growth scoring
            if growth > 30: return 90
            elif growth > 20: return 80
            elif growth > 10: return 65
            elif growth > 5: return 55
            elif growth > 0: return 40
            elif growth > -10: return 25
            else: return 10
        except Exception as e:
            logger.debug(f"Growth evaluation failed for {ticker}: {e}")
            return None
    
    def _evaluate_stability(self, cur, ticker: str, market_code: str) -> Optional[float]:
        """Evaluate stability from tab_performance."""
        try:
            cur.execute("""
                SELECT ytd_return, one_year_return, volatility 
                FROM tab_performance 
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                return None
            
            scores = []
            ytd = parse_number(row['ytd_return']) if 'ytd_return' in row.keys() else None
            one_y = parse_number(row['one_year_return']) if 'one_year_return' in row.keys() else None
            vol = parse_number(row['volatility']) if 'volatility' in row.keys() else None
            
            if ytd is not None:
                if ytd > 20: scores.append(80)
                elif ytd > 10: scores.append(70)
                elif ytd > 0: scores.append(55)
                elif ytd > -10: scores.append(40)
                else: scores.append(20)
            
            if one_y is not None:
                if one_y > 30: scores.append(80)
                elif one_y > 15: scores.append(70)
                elif one_y > 0: scores.append(55)
                elif one_y > -15: scores.append(40)
                else: scores.append(20)
            
            # Volatility: lower is better for stability
            if vol is not None:
                if vol < 15: scores.append(85)
                elif vol < 25: scores.append(70)
                elif vol < 35: scores.append(55)
                elif vol < 50: scores.append(35)
                else: scores.append(15)
            
            return sum(scores) / len(scores) if scores else None
        except Exception as e:
            logger.debug(f"Stability evaluation failed for {ticker}: {e}")
            return None
    
    def _evaluate_dividends(self, cur, ticker: str, market_code: str) -> Optional[float]:
        """Evaluate dividend quality from tab_dividends."""
        try:
            cur.execute("""
                SELECT cont_div, payout_ratio 
                FROM tab_dividends 
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                return None
            
            scores = []
            cont_div = parse_number(row['cont_div']) if 'cont_div' in row.keys() else None
            payout = parse_number(row['payout_ratio']) if 'payout_ratio' in row.keys() else None
            
            # Consecutive dividends: more years = better
            if cont_div is not None:
                if cont_div >= 10: scores.append(90)
                elif cont_div >= 5: scores.append(75)
                elif cont_div >= 3: scores.append(60)
                elif cont_div >= 1: scores.append(40)
                else: scores.append(20)
            
            # Payout ratio: 30-70% ideal, <30% too low, >90% unsustainable
            if payout is not None:
                if 30 <= payout <= 70: scores.append(80)
                elif 20 <= payout <= 85: scores.append(60)
                elif 0 < payout <= 95: scores.append(40)
                else: scores.append(20)
            
            return sum(scores) / len(scores) if scores else None
        except Exception as e:
            logger.debug(f"Dividend evaluation failed for {ticker}: {e}")
            return None
    
    # ========================================================================
    # 🔥 NEW: Financial Health (Balance Sheet) — Step 4
    # ========================================================================
    
    def _evaluate_financial_health(self, cur, ticker: str, market_code: str) -> Tuple[Optional[float], List[str]]:
        """🏦 NEW: Evaluate financial health from tab_balance_sheet.
        
        Metrics:
        - Debt-to-Equity = Total Debt / Total Equity → if > 1.0, penalize
        - Cash Ratio = Cash / Total Liabilities → if < 0.2, penalize  
        - Current Ratio = Current Assets / Current Liabilities → if < 1.0, penalize
        """
        reasons = []
        
        try:
            cur.execute("""
                SELECT total_assets, total_liabilities, total_equity, debt, cash, current_assets, current_liabilities
                FROM tab_balance_sheet
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                return None, []
            
            scores = []
            
            total_equity = parse_number(row['total_equity'])
            debt = parse_number(row['debt'])
            cash = parse_number(row['cash'])
            total_liabilities = parse_number(row['total_liabilities'])
            current_assets = parse_number(row['current_assets'])
            current_liabilities = parse_number(row['current_liabilities'])
            
            # Debt-to-Equity Ratio
            if debt is not None and total_equity is not None and total_equity > 0:
                dte = debt / total_equity
                if dte > 2.0:
                    scores.append(15)
                    reasons.append(f'ديون عالية جداً (D/E = {dte:.1f})')
                elif dte > 1.0:
                    scores.append(35)
                    reasons.append(f'ديون مرتفعة (D/E = {dte:.1f})')
                elif dte > 0.5:
                    scores.append(65)
                elif dte > 0:
                    scores.append(85)
                    reasons.append('ديون منخفضة ✅')
                else:
                    scores.append(95)
                    reasons.append('بدون ديون ✅')
            
            # Cash Ratio
            if cash is not None and total_liabilities is not None and total_liabilities > 0:
                cash_ratio = cash / total_liabilities
                if cash_ratio < 0.1:
                    scores.append(20)
                    reasons.append('سيولة نقدية منخفضة جداً')
                elif cash_ratio < 0.2:
                    scores.append(40)
                    reasons.append('سيولة نقدية منخفضة')
                elif cash_ratio < 0.5:
                    scores.append(65)
                else:
                    scores.append(85)
                    reasons.append('سيولة نقدية ممتازة ✅')
            
            # Current Ratio
            if current_assets is not None and current_liabilities is not None and current_liabilities > 0:
                current_ratio = current_assets / current_liabilities
                if current_ratio < 0.5:
                    scores.append(15)
                    reasons.append('نسبة متداولة خطيرة (< 0.5)')
                elif current_ratio < 1.0:
                    scores.append(35)
                    reasons.append('نسبة متداولة أقل من 1')
                elif current_ratio < 1.5:
                    scores.append(60)
                elif current_ratio < 3.0:
                    scores.append(80)
                else:
                    scores.append(90)
            
            avg = sum(scores) / len(scores) if scores else None
            return avg, reasons
        except Exception as e:
            logger.debug(f"Financial health evaluation failed for {ticker}: {e}")
            return None, []
    
    # ========================================================================
    # 🔥 NEW: Cash Flow Quality — Step 4
    # ========================================================================
    
    def _evaluate_cash_flow(self, cur, ticker: str, market_code: str) -> Tuple[Optional[float], List[str]]:
        """🏦 NEW: Evaluate cash flow quality from tab_cash_flow.
        
        Metrics:
        - FCF Yield = Free CF / Market Cap → if > 5%, boost
        - Operating CF positive → if negative, penalize heavily
        """
        reasons = []
        
        try:
            cur.execute("""
                SELECT operating_cf, investing_cf, financing_cf, free_cf
                FROM tab_cash_flow
                WHERE symbol = ? AND market = ?
            """, (ticker, market_code))
            row = cur.fetchone()
            if not row:
                return None, []
            
            scores = []
            
            operating_cf = parse_number(row['operating_cf'])
            free_cf = parse_number(row['free_cf'])
            investing_cf = parse_number(row['investing_cf'])
            
            # Operating CF: positive is essential
            if operating_cf is not None:
                if operating_cf > 0:
                    scores.append(80)
                else:
                    scores.append(15)
                    reasons.append('التدفقات التشغيلية سالبة ❌')
            
            # Free CF: positive means company generates surplus cash
            if free_cf is not None:
                if free_cf > 0:
                    scores.append(75)
                    reasons.append('تدفقات حرة موجبة ✅')
                else:
                    scores.append(25)
                    reasons.append('التدفقات الحرة سالبة')
            
            # Investing CF: negative is normal (reinvestment), very negative = heavy capex
            if investing_cf is not None:
                if investing_cf < 0:
                    scores.append(60)  # Normal reinvestment
                else:
                    scores.append(70)  # Selling assets — mixed signal
            
            # FCF Yield (approximate — need market cap)
            # We skip this if we can't get market cap easily
            try:
                cur.execute("SELECT market_cap FROM stocks WHERE ticker = ?", (ticker,))
                mcap_row = cur.fetchone()
                if mcap_row and free_cf is not None and free_cf > 0:
                    market_cap = parse_number(mcap_row['market_cap'])
                    if market_cap and market_cap > 0:
                        fcf_yield = (free_cf / market_cap) * 100
                        if fcf_yield > 8:
                            scores.append(90)
                            reasons.append(f'FCF Yield ممتاز ({fcf_yield:.1f}%) ✅')
                        elif fcf_yield > 5:
                            scores.append(80)
                            reasons.append(f'FCF Yield جيد ({fcf_yield:.1f}%) ✅')
                        elif fcf_yield > 2:
                            scores.append(55)
                        else:
                            scores.append(35)
            except Exception:
                pass
            
            avg = sum(scores) / len(scores) if scores else None
            return avg, reasons
        except Exception as e:
            logger.debug(f"Cash flow evaluation failed for {ticker}: {e}")
            return None, []
    
    def _compute_historical_trend(self, cur, ticker: str, market_code: str) -> Optional[dict]:
        """Compute historical trend for income statement data."""
        try:
            cur.execute("""
                SELECT fiscal_period, revenue, net_income, eps
                FROM tab_income_statement
                WHERE symbol = ? AND market = ?
                ORDER BY fiscal_period DESC
                LIMIT 4
            """, (ticker, market_code))
            rows = cur.fetchall()
            if len(rows) < 2:
                return None
            
            latest = rows[0]
            previous = rows[1]
            
            latest_revenue = parse_number(latest['revenue']) if 'revenue' in latest.keys() else None
            prev_revenue = parse_number(previous['revenue']) if 'revenue' in previous.keys() else None
            
            if latest_revenue and prev_revenue and prev_revenue > 0:
                growth = ((latest_revenue - prev_revenue) / prev_revenue) * 100
                return {
                    'trend_direction': 'up' if growth > 0 else 'down',
                    'trend_score': min(max(growth, -50), 50),
                    'periods_compared': 2,
                    'latest_period': latest['fiscal_period'] if 'fiscal_period' in latest.keys() else '',
                    'previous_period': previous['fiscal_period'] if 'fiscal_period' in previous.keys() else '',
                    'details': f'Revenue growth: {growth:.1f}%',
                }
            return None
        except Exception:
            return None


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

# Singleton instance
_quality_gate_instance = None

def _get_quality_gate() -> FundamentalQualityGate:
    """Get or create the singleton Quality Gate instance."""
    global _quality_gate_instance
    if _quality_gate_instance is None:
        _quality_gate_instance = FundamentalQualityGate()
    return _quality_gate_instance


def check_quality(ticker: str, market: str = 'EGX', mode: str = 'full') -> QualityGateResult:
    """Convenience function: Check quality for a ticker."""
    gate = _get_quality_gate()
    return gate.check(ticker, market, mode)


# Availability flag
QUALITY_GATE_AVAILABLE = True


__all__ = [
    'FundamentalQualityGate',
    'QualityGateResult',
    'check_quality',
    'detect_market_type',
    'MARKET_THRESHOLDS',
    'QUALITY_GATE_AVAILABLE',
    'parse_number',
]
