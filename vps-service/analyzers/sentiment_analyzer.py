"""
Sentiment Analyzer
==================
محلل المشاعر للسوق المصري

Phase 3: AI & Sentiment Analysis

Features:
- Price-based sentiment (momentum)
- Volume sentiment (institutional activity)
- News sentiment (if available)
- Market regime sentiment
- Sector correlation sentiment

Author: دليل الاستثمار (Phase 3)
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import sqlite3
from datetime import datetime, timedelta
import random


# ============================================================================
# SENTIMENT WEIGHTS
# ============================================================================

SENTIMENT_CONFIG = {
    # Price-based sentiment weights
    'price_momentum_weight': 0.35,
    'volume_sentiment_weight': 0.25,
    'sector_correlation_weight': 0.20,
    'market_regime_weight': 0.20,
    
    # Thresholds
    'very_bullish': 70,
    'bullish': 60,
    'neutral_high': 55,
    'neutral_low': 45,
    'bearish': 40,
    'very_bearish': 30,
}


@dataclass
class SentimentResult:
    """Data class for sentiment analysis result."""
    ticker: str
    overall_sentiment: float = 50.0  # 0-100 (0=very bearish, 100=very bullish)
    sentiment_label: str = 'NEUTRAL'
    
    # Components
    price_momentum: float = 50.0
    volume_sentiment: float = 50.0
    sector_sentiment: float = 50.0
    market_sentiment: float = 50.0
    news_sentiment: Optional[float] = None
    
    # Details
    bullish_signals: List[str] = None
    bearish_signals: List[str] = None
    confidence: float = 50.0
    
    # Impact on recommendation
    score_adjustment: float = 0.0
    
    def to_dict(self) -> Dict:
        result = asdict(self)
        if self.bullish_signals is None:
            result['bullish_signals'] = []
        if self.bearish_signals is None:
            result['bearish_signals'] = []
        return result


class SentimentAnalyzer:
    """
    محلل المشاعر
    
    يحلل المشاعر من مصادر متعددة:
    1. Price Momentum - زخم السعر
    2. Volume Analysis - تحليل الحجم
    3. Sector Correlation - الارتباط القطاعي
    4. Market Regime - حالة السوق
    5. News (if available) - الأخبار
    
    Usage:
        analyzer = SentimentAnalyzer(db_path)
        sentiment = analyzer.analyze('COMI', prices, volumes)
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self.config = SENTIMENT_CONFIG
    
    def analyze(
        self, 
        ticker: str, 
        prices: List[float] = None, 
        volumes: List[float] = None,
        sector: str = None
    ) -> SentimentResult:
        """
        Perform sentiment analysis.
        
        Args:
            ticker: Stock symbol
            prices: Price history (last 50 days)
            volumes: Volume history
            sector: Stock sector
            
        Returns:
            SentimentResult: Complete sentiment analysis
        """
        result = SentimentResult(ticker=ticker)
        
        bullish_signals = []
        bearish_signals = []
        
        # Get stock data if not provided
        if self.db_path and (prices is None or sector is None):
            stock_data = self._get_stock_data(ticker)
            if sector is None:
                sector = stock_data.get('sector', 'DEFAULT')
        
        # ========================================
        # 1. PRICE MOMENTUM SENTIMENT
        # ========================================
        if prices and len(prices) >= 10:
            result.price_momentum = self._analyze_price_momentum(prices, bullish_signals, bearish_signals)
        else:
            result.price_momentum = 50  # Neutral
        
        # ========================================
        # 2. VOLUME SENTIMENT
        # ========================================
        if volumes and len(volumes) >= 10:
            result.volume_sentiment = self._analyze_volume_sentiment(prices, volumes, bullish_signals, bearish_signals)
        else:
            result.volume_sentiment = 50
        
        # ========================================
        # 3. SECTOR CORRELATION SENTIMENT
        # ========================================
        if sector and self.db_path:
            result.sector_sentiment = self._analyze_sector_sentiment(ticker, sector, bullish_signals, bearish_signals)
        else:
            result.sector_sentiment = 50
        
        # ========================================
        # 4. MARKET REGIME SENTIMENT
        # ========================================
        if self.db_path:
            result.market_sentiment = self._analyze_market_sentiment(bullish_signals, bearish_signals)
        else:
            result.market_sentiment = 50
        
        # ========================================
        # 5. NEWS SENTIMENT (if available)
        # ========================================
        if self.db_path:
            result.news_sentiment = self._analyze_news_sentiment(ticker, bullish_signals, bearish_signals)
        
        # ========================================
        # CALCULATE OVERALL SENTIMENT
        # ========================================
        weights = self.config
        
        # Base weights (news is optional)
        total_weight = (
            weights['price_momentum_weight'] +
            weights['volume_sentiment_weight'] +
            weights['sector_correlation_weight'] +
            weights['market_regime_weight']
        )
        
        result.overall_sentiment = (
            result.price_momentum * weights['price_momentum_weight'] +
            result.volume_sentiment * weights['volume_sentiment_weight'] +
            result.sector_sentiment * weights['sector_correlation_weight'] +
            result.market_sentiment * weights['market_regime_weight']
        ) / total_weight
        
        # Add news if available
        if result.news_sentiment is not None:
            result.overall_sentiment = result.overall_sentiment * 0.85 + result.news_sentiment * 0.15
        
        # Determine label
        result.sentiment_label = self._get_sentiment_label(result.overall_sentiment)
        
        # Calculate score adjustment (how much to adjust recommendation score)
        # Positive sentiment = boost score, Negative sentiment = reduce score
        result.score_adjustment = (result.overall_sentiment - 50) * 0.3  # -15 to +15
        
        # Calculate confidence
        result.confidence = self._calculate_confidence(prices, volumes, result.news_sentiment)
        
        # Finalize
        result.bullish_signals = bullish_signals
        result.bearish_signals = bearish_signals
        
        return result
    
    def _analyze_price_momentum(
        self, 
        prices: List[float], 
        bullish: List[str], 
        bearish: List[str]
    ) -> float:
        """Analyze price momentum sentiment."""
        sentiment = 50
        
        if len(prices) < 10:
            return sentiment
        
        # Short-term momentum (5 days)
        if len(prices) >= 5:
            change_5d = (prices[-1] - prices[-5]) / prices[-5] * 100 if prices[-5] > 0 else 0
            
            if change_5d > 10:
                sentiment += 15
                bullish.append(f"زخم صعودي قوي (+{change_5d:.1f}% في 5 أيام)")
            elif change_5d > 5:
                sentiment += 10
                bullish.append(f"زخم صعودي (+{change_5d:.1f}% في 5 أيام)")
            elif change_5d < -10:
                sentiment -= 15
                bearish.append(f"زخم هبوطي قوي ({change_5d:.1f}% في 5 أيام)")
            elif change_5d < -5:
                sentiment -= 10
                bearish.append(f"زخم هبوطي ({change_5d:.1f}% في 5 أيام)")
        
        # Medium-term momentum (20 days)
        if len(prices) >= 20:
            change_20d = (prices[-1] - prices[-20]) / prices[-20] * 100 if prices[-20] > 0 else 0
            
            if change_20d > 15:
                sentiment += 10
                bullish.append(f"اتجاه صعودي متوسط (+{change_20d:.1f}% في 20 يوم)")
            elif change_20d > 8:
                sentiment += 5
            elif change_20d < -15:
                sentiment -= 10
                bearish.append(f"اتجاه هبوطي متوسط ({change_20d:.1f}% في 20 يوم)")
            elif change_20d < -8:
                sentiment -= 5
        
        # Moving average position
        if len(prices) >= 20:
            sma_20 = sum(prices[-20:]) / 20
            current = prices[-1]
            
            if current > sma_20 * 1.05:
                sentiment += 8
                bullish.append("السعر فوق المتوسط المتحرك 20 يوم")
            elif current < sma_20 * 0.95:
                sentiment -= 8
                bearish.append("السعر تحت المتوسط المتحرك 20 يوم")
        
        # Higher highs and higher lows pattern
        if len(prices) >= 10:
            highs = prices[-10:]
            lows = prices[-10:]
            
            # Check for higher highs
            higher_highs = sum(1 for i in range(1, len(highs)) if highs[i] > highs[i-1])
            higher_lows = sum(1 for i in range(1, len(lows)) if lows[i] > lows[i-1])
            
            if higher_highs >= 6 and higher_lows >= 6:
                sentiment += 8
                bullish.append("نمط قمم وقيعان صاعدة")
            elif higher_highs <= 3 and higher_lows <= 3:
                sentiment -= 8
                bearish.append("نمط قمم وقيعان هابطة")
        
        return max(0, min(100, sentiment))
    
    def _analyze_volume_sentiment(
        self, 
        prices: List[float], 
        volumes: List[float],
        bullish: List[str],
        bearish: List[str]
    ) -> float:
        """Analyze volume-based sentiment."""
        sentiment = 50
        
        if len(volumes) < 10:
            return sentiment
        
        # Volume trend
        recent_vol = sum(volumes[-5:]) / 5
        prior_vol = sum(volumes[-10:-5]) / 5 if len(volumes) >= 10 else recent_vol
        
        vol_change = (recent_vol - prior_vol) / prior_vol * 100 if prior_vol > 0 else 0
        
        # Price direction in same period
        price_change = (prices[-1] - prices[-5]) / prices[-5] * 100 if prices and len(prices) >= 5 and prices[-5] > 0 else 0
        
        # Volume on up moves = bullish
        # Volume on down moves = bearish
        if vol_change > 30 and price_change > 0:
            sentiment += 15
            bullish.append(f"حجم مرتفع مع صعود (+{vol_change:.0f}% حجم)")
        elif vol_change > 30 and price_change < 0:
            sentiment -= 10
            bearish.append(f"حجم مرتفع مع هبوط (ضغط بيعي)")
        elif vol_change > 20 and price_change > 0:
            sentiment += 8
            bullish.append("زيادة الحجم مع الصعود")
        elif vol_change < -30:
            sentiment -= 5
            bearish.append("انخفاض الحجم (قلة الاهتمام)")
        
        # Volume spike detection
        avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else recent_vol
        latest_vol = volumes[-1]
        
        if latest_vol > avg_vol * 2:
            if price_change > 0:
                sentiment += 10
                bullish.append("طفرة حجم مع صعود (دخول قوي)")
            else:
                sentiment -= 5
                bearish.append("طفرة حجم مع هبوط")
        
        return max(0, min(100, sentiment))
    
    def _analyze_sector_sentiment(
        self, 
        ticker: str, 
        sector: str,
        bullish: List[str],
        bearish: List[str]
    ) -> float:
        """Analyze sector correlation sentiment."""
        sentiment = 50
        
        if not self.db_path:
            return sentiment
        
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            cursor = conn.cursor()
            
            # Get sector performance
            cursor.execute('''
                SELECT ticker, change_percent 
                FROM stocks 
                WHERE sector = ? AND ticker != ?
            ''', (sector, ticker))
            
            peers = cursor.fetchall()
            conn.close()
            
            if not peers:
                return sentiment
            
            # Calculate sector average change
            changes = [p[1] for p in peers if p[1] is not None]
            if changes:
                sector_avg = sum(changes) / len(changes)
                
                if sector_avg > 3:
                    sentiment += 10
                    bullish.append(f"القطاع في صعود (+{sector_avg:.1f}%)")
                elif sector_avg > 1:
                    sentiment += 5
                elif sector_avg < -3:
                    sentiment -= 10
                    bearish.append(f"القطاع في هبوط ({sector_avg:.1f}%)")
                elif sector_avg < -1:
                    sentiment -= 5
        
        except Exception as e:
            pass
        
        return max(0, min(100, sentiment))
    
    def _analyze_market_sentiment(
        self,
        bullish: List[str],
        bearish: List[str]
    ) -> float:
        """Analyze overall market sentiment from EGX30."""
        sentiment = 50
        
        if not self.db_path:
            return sentiment
        
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            cursor = conn.cursor()
            
            # Check EGX30 index
            cursor.execute('''
                SELECT change_percent 
                FROM market_indices 
                WHERE name LIKE '%EGX30%' OR name LIKE '%EGX 30%'
                LIMIT 1
            ''')
            
            row = cursor.fetchone()
            
            if row and row[0] is not None:
                market_change = row[0]
                
                if market_change > 2:
                    sentiment += 15
                    bullish.append(f"السوق صاعد (EGX30 +{market_change:.1f}%)")
                elif market_change > 0.5:
                    sentiment += 8
                    bullish.append("السوق إيجابي")
                elif market_change < -2:
                    sentiment -= 15
                    bearish.append(f"السوق هابط (EGX30 {market_change:.1f}%)")
                elif market_change < -0.5:
                    sentiment -= 8
                    bearish.append("السوق سلبي")
            
            conn.close()
        
        except Exception as e:
            pass
        
        return max(0, min(100, sentiment))
    
    def _analyze_news_sentiment(
        self, 
        ticker: str,
        bullish: List[str],
        bearish: List[str]
    ) -> Optional[float]:
        """Analyze news sentiment if available."""
        if not self.db_path:
            return None

        try:
            # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
            # Was reading a legacy table in stocks.db via self.db_path (0 rows — phantom).
            try:
                from utils.db_paths import DBPaths
                _news_db = DBPaths.NEWS_DB
            except Exception:
                _news_db = self.db_path
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(_news_db, writable=False).__enter__()
            cursor = conn.cursor()

            # Check for recent news (tickers column = JSON array, filter with LIKE)
            cursor.execute('''
                SELECT title, content, impact_type AS category, published_at
                FROM market_news
                WHERE tickers LIKE ?
                ORDER BY published_at DESC
                LIMIT 5
            ''', (f'%"{ticker}"%',))

            news = cursor.fetchall()
            conn.close()
            
            if not news:
                return None
            
            # Simple keyword-based sentiment
            sentiment = 50
            
            positive_keywords = [
                'أرباح', 'توزيعات', 'نمو', 'ارتفاع', 'توسع', 'عقد', 
                'شراكة', 'نجاح', 'زيادة', 'إيجابي', 'صعود', 'استحواذ'
            ]
            
            negative_keywords = [
                'خسارة', 'انخفاض', 'هبوط', 'تخفيض', 'مشاكل', 'قضية',
                'غرامة', 'تحذير', 'سلب', 'إيقاف', 'بيع', 'تراجع'
            ]
            
            for title, content, category, date in news:
                text = f"{title or ''} {content or ''}"
                
                pos_count = sum(1 for kw in positive_keywords if kw in text)
                neg_count = sum(1 for kw in negative_keywords if kw in text)
                
                if pos_count > neg_count:
                    sentiment += 5
                elif neg_count > pos_count:
                    sentiment -= 5
            
            if sentiment > 55:
                bullish.append("أخبار إيجابية")
            elif sentiment < 45:
                bearish.append("أخبار سلبية")
            
            return max(0, min(100, sentiment))
        
        except Exception as e:
            return None
    
    def _get_sentiment_label(self, score: float) -> str:
        """Convert sentiment score to label."""
        if score >= self.config['very_bullish']:
            return 'VERY_BULLISH'
        elif score >= self.config['bullish']:
            return 'BULLISH'
        elif score >= self.config['neutral_low']:
            return 'NEUTRAL'
        elif score >= self.config['bearish']:
            return 'BEARISH'
        else:
            return 'VERY_BEARISH'
    
    def _calculate_confidence(
        self, 
        prices: List[float], 
        volumes: List[float],
        news_sentiment: Optional[float]
    ) -> float:
        """Calculate confidence in sentiment analysis."""
        confidence = 40  # Base confidence
        
        # More price data = higher confidence
        if prices and len(prices) >= 50:
            confidence += 20
        elif prices and len(prices) >= 20:
            confidence += 15
        elif prices and len(prices) >= 10:
            confidence += 10
        
        # Volume data available
        if volumes and len(volumes) >= 20:
            confidence += 10
        
        # News available
        if news_sentiment is not None:
            confidence += 10
        
        return min(confidence, 85)
    
    def _get_stock_data(self, ticker: str) -> Dict:
        """Get stock data from database."""
        if not self.db_path:
            return {}
        
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT sector, change_percent, volume
                FROM stocks WHERE ticker = ?
            ''', (ticker,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'sector': row[0],
                    'change_percent': row[1],
                    'volume': row[2],
                }
        except:
            pass
        
        return {}


def get_sentiment_boost(sentiment_score: float) -> Tuple[float, str]:
    """
    Get sentiment boost for recommendation score.
    
    Returns:
        Tuple: (boost_amount, reason)
    """
    if sentiment_score >= 70:
        return 10, "مشاعر إيجابية قوية"
    elif sentiment_score >= 60:
        return 5, "مشاعر إيجابية"
    elif sentiment_score <= 30:
        return -10, "مشاعر سلبية قوية"
    elif sentiment_score <= 40:
        return -5, "مشاعر سلبية"
    else:
        return 0, "مشاعر محايدة"
