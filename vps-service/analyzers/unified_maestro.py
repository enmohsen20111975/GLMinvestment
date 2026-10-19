"""
Unified Maestro Engine
======================
المحرك الموحد للمايسترو

يختار المحرك المناسب حسب السوق:
- EGX → MaestroOrchestrator
- CRYPTO → CryptoMaestroOrchestrator
- الأسواق العربية → ArabMarketsMaestro

@authorM2yDevelopers Team
@version 1.0.0
"""

import sys
import os
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path as _P

# Relative project root
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# MAESTRO-DISABLED (Task PHASE-2-MAESTRO-PYTHON, Rule 73)
# Unified Maestro engine has been permanently disabled by owner directive:
#   "أمسح كل حاجة ليها علاقة بالمايسترو" (kill everything Maestro-related).
# Canonical signal now comes from canonical_signal.py + unified-stock-data.ts.
# This file is kept for backward compatibility (Rule 4: NO-DELETION) but
# every main entry point returns None so callers short-circuit cleanly.
MAESTRO_DISABLED = True

from config.market_config import (
    MarketConfig,
    MarketType,
    get_market_config,
    detect_market_from_ticker,
    get_regime_settings,
    is_market_open,
)

# Import EGX Maestro
try:
    # BRAVO-FIX (2026-10-19): maestro_orchestrator.py removed (MAESTRO-CANCER-1)
    # from analyzers.maestro_orchestrator import MaestroOrchestrator, MaestroResult
    EGX_MAESTRO_AVAILABLE = True
except ImportError as e:
    print(f"[UnifiedMaestro] EGX Maestro not available: {e}")
    EGX_MAESTRO_AVAILABLE = False

# Import Crypto Maestro
try:
    from analyzers.crypto_maestro import CryptoMaestroOrchestrator, CryptoMaestroResult
    CRYPTO_MAESTRO_AVAILABLE = True
except ImportError as e:
    print(f"[UnifiedMaestro] Crypto Maestro not available: {e}")
    CRYPTO_MAESTRO_AVAILABLE = False


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def parse_volume(value) -> int:
    """
    تحويل قيمة الحجم إلى رقم صحيح
    يدعم: '988.35K', '2.26M', '1.5B', أو أرقام عادية
    """
    if value is None:
        return 0
    
    # إذا كان رقم عادي
    if isinstance(value, (int, float)):
        return int(value)
    
    # إذا كان نص
    value_str = str(value).strip().upper()
    
    # إزالة المسافات والـ unicode spaces
    value_str = value_str.replace('\u202f', '').replace(' ', '')
    
    # استخراج الرقم والوحدة
    multipliers = {
        'K': 1_000,
        'M': 1_000_000,
        'B': 1_000_000_000,
    }
    
    for suffix, multiplier in multipliers.items():
        if value_str.endswith(suffix):
            try:
                num = float(value_str[:-1])
                return int(num * multiplier)
            except ValueError:
                return 0
    
    # محاولة تحويله كرقم عادي
    try:
        return int(float(value_str))
    except ValueError:
        return 0


# ============================================================================
# UNIFIED RESULT TYPE
# ============================================================================

@dataclass
class UnifiedMaestroResult:
    """نتيجة موحدة من أي محرك"""
    # Basic info
    ticker: str
    market: str
    market_name_ar: str
    timestamp: str
    
    # Signal
    signal: str
    signal_ar: str
    score: float  # 0-100
    confidence: float  # 0-100
    
    # Prices
    current_price: float
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: float
    
    # Position
    position_size_pct: float
    
    # Market context
    market_regime: str
    is_market_open: bool
    
    # Warnings
    warnings: List[str] = field(default_factory=list)
    warnings_ar: List[str] = field(default_factory=list)
    
    # Details
    phases: Dict[str, Any] = field(default_factory=dict)
    
    # Raw result from underlying engine
    raw_result: Optional[Any] = None


# ============================================================================
# ARAB MARKETS MAESTRO
# ============================================================================

class ArabMarketsMaestro:
    """
    مايسترو الأسواق العربية
    
    للأسواق التي لا يوجد لها محرك خاص:
    - KSA (تداول)
    - KSE (الكويت)
    - QSE (قطر)
    - DFM (دبي)
    """
    
    def __init__(self, db_path: str, market: str):
        self.db_path = db_path
        self.market = market
        self.config = get_market_config(market)
        
        if not self.config:
            raise ValueError(f"Unknown market: {market}")
    
    def analyze(self, ticker: str, stock_data: Dict = None) -> Optional[UnifiedMaestroResult]:
        """تحليل سهم من الأسواق العربية"""
        import sqlite3
        
        # Get stock data if not provided
        if not stock_data:
            try:
                conn = sqlite3.connect(self.db_path)
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT ticker, name, current_price, volume, change_percent,
                           high_price, low_price, open_price, previous_close
                    FROM stocks 
                    WHERE ticker = ? AND market = ?
                ''', (ticker, self.market))
                row = cursor.fetchone()
                conn.close()
                
                if row:
                    stock_data = {
                        'ticker': row[0],
                        'name': row[1],
                        'current_price': row[2],
                        'volume': row[3],
                        'change_percent': row[4],
                        'high_price': row[5],
                        'low_price': row[6],
                        'open_price': row[7],
                        'previous_close': row[8],
                    }
            except Exception as e:
                print(f"[ArabMarketsMaestro] Error fetching stock: {e}")
                return None
        
        if not stock_data:
            return None
        
        current_price = float(stock_data.get('current_price', 0))
        if current_price <= 0:
            return None
        
        # Get regime settings
        regime = self._detect_regime()
        regime_settings = get_regime_settings(self.market, regime)
        
        # Calculate basic score
        score = self._calculate_score(stock_data)
        
        # Determine signal
        signal, signal_ar = self._determine_signal(score, regime)
        
        # Calculate prices
        stop_loss_pct = regime_settings['stop_loss']
        target_pct = regime_settings['target']
        
        stop_loss = current_price * (1 - stop_loss_pct / 100)
        target = current_price * (1 + target_pct / 100)
        entry_price = current_price * 0.995
        
        risk_reward = (target - entry_price) / (entry_price - stop_loss) if entry_price > stop_loss else 0
        
        # Warnings
        warnings = []
        warnings_ar = []
        
        volume = parse_volume(stock_data.get('volume', 0))
        if volume < self.config.min_volume:
            warnings.append("Low volume")
            warnings_ar.append("حجم تداول منخفض")
        
        if not is_market_open(self.market):
            warnings.append("Market closed")
            warnings_ar.append("السوق مغلق")
        
        return UnifiedMaestroResult(
            ticker=ticker,
            market=self.market,
            market_name_ar=self.config.name_ar,
            timestamp=datetime.now().isoformat(),
            signal=signal,
            signal_ar=signal_ar,
            score=score,
            confidence=min(50 + abs(score - 50), 85),  # Arab markets have lower confidence
            current_price=current_price,
            entry_price=round(entry_price, 4),
            stop_loss=round(stop_loss, 4),
            target=round(target, 4),
            risk_reward=round(risk_reward, 2),
            position_size_pct=regime_settings['max_position'],
            market_regime=regime,
            is_market_open=is_market_open(self.market),
            warnings=warnings,
            warnings_ar=warnings_ar,
            phases={
                'basic_analysis': True,
                'regime': regime,
            }
        )
    
    def _detect_regime(self) -> str:
        """تحديد حالة السوق - مبسط للأسواق العربية"""
        # TODO: Implement real regime detection for each market
        return "range"
    
    def _calculate_score(self, stock_data: Dict) -> float:
        """حساب درجة السهم"""
        score = 50.0
        
        # Price momentum
        change = float(stock_data.get('change_percent', 0))
        if change > 5:
            score += 15
        elif change > 2:
            score += 8
        elif change < -5:
            score -= 15
        elif change < -2:
            score -= 8
        
        # Volume
        volume = parse_volume(stock_data.get('volume', 0))
        if volume >= self.config.min_volume * 2:
            score += 10
        elif volume < self.config.min_volume:
            score -= 10
        
        # Position relative to day range
        high = float(stock_data.get('high_price', 0))
        low = float(stock_data.get('low_price', 0))
        current = float(stock_data.get('current_price', 0))
        
        if high > low:
            position = (current - low) / (high - low)
            if position < 0.3:  # Near low
                score += 5
            elif position > 0.7:  # Near high
                score -= 5
        
        return max(0, min(100, score))
    
    def _determine_signal(self, score: float, regime: str) -> tuple:
        """تحديد الإشارة"""
        regime_settings = get_regime_settings(self.market, regime)
        min_score = regime_settings['min_score']
        
        if score >= min_score + 15:
            return "STRONG_BUY", "شراء قوي"
        elif score >= min_score:
            return "BUY", "شراء"
        elif score >= 40:
            return "HOLD", "احتفاظ"
        elif score >= 25:
            return "SELL", "بيع"
        else:
            return "STRONG_SELL", "بيع قوي"


# ============================================================================
# UNIFIED MAESTRO ENGINE
# ============================================================================

class UnifiedMaestroEngine:
    """
    المحرك الموحد للمايسترو
    
    تم تحديثه ليعتمد على CoreScoringEngine + PersonaProfile بالكامل
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        
        # استدعاء المحرك الموحد الجديد
        from analyzers.core_scoring_engine import get_engine
        self.core_engine = get_engine()
        print("[UnifiedMaestro] CoreScoringEngine initialized inside UnifiedMaestro")
    
    def analyze(
        self,
        ticker: str,
        market: str = None,
        stock_data: Dict = None,
        price_history: List[Dict] = None,
        options: Dict = None
    ) -> Optional[UnifiedMaestroResult]:
        """
        تحليل موحد لأي سهم من أي سوق باستخدام CoreScoringEngine
        """
        # MAESTRO-DISABLED (Task PHASE-2-MAESTRO-PYTHON, Rule 73)
        if MAESTRO_DISABLED:
            return None  # canonical_signal.py is now the source of truth
        # Detect market if not provided
        if not market:
            market = detect_market_from_ticker(ticker)
        
        # Get persona from options or default to 'trader'
        persona = (options or {}).get("persona", "trader") if options else "trader"
        
        # Load price history if not provided
        if not price_history:
            price_history = self._get_price_history(ticker)
            
        if not price_history:
            # Fallback: check stock_data or load from stocks table
            if not stock_data:
                stock_data = self._get_stock_data(ticker)
                
            p = float(stock_data.get('current_price', 0)) if stock_data else 0
            if p > 0:
                price_history = [{
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'open': p * 0.99,
                    'high': p * 1.01,
                    'low': p * 0.98,
                    'close': p,
                    'volume': parse_volume(stock_data.get('volume', 1000000))
                }]
            else:
                return None
                
        # Transform price history to lists for CoreScoringEngine
        opens = [float(h.get('open') or h['close']) for h in price_history]
        highs = [float(h.get('high') or h['close']) for h in price_history]
        lows = [float(h.get('low') or h['close']) for h in price_history]
        closes = [float(h['close']) for h in price_history]
        volumes = [parse_volume(h.get('volume')) for h in price_history]
        dates = [h.get('date') for h in price_history]

        price_data = {
            "opens": opens,
            "highs": highs,
            "lows": lows,
            "closes": closes,
            "volumes": volumes,
            "dates": dates,
        }
        
        # Run unified analysis
        from config.unified_config import get_unified_config, translate_signal
        
        result = self.core_engine.analyze(
            ticker=ticker,
            price_data=price_data,
            market=market,
            persona=persona
        )
        
        config = get_unified_config(market, persona)
        
        # Translate warnings
        warnings_ar = [translate_signal(w) for w in result.warnings]
        
        return UnifiedMaestroResult(
            ticker=result.ticker,
            market=result.market,
            market_name_ar=config.market_profile.market_name_ar,
            timestamp=result.timestamp,
            signal=result.signal,
            signal_ar=result.signal_ar,
            score=result.score,
            confidence=result.confidence,
            current_price=result.current_price,
            entry_price=result.entry_price,
            stop_loss=result.stop_loss,
            target=result.target_1,
            risk_reward=result.risk_reward,
            position_size_pct=config.position_size_pct,
            market_regime=result.market_regime,
            is_market_open=is_market_open(market),
            warnings=result.warnings,
            warnings_ar=warnings_ar,
            phases={
                "technical_score": result.technical_score,
                "volume_score": result.volume_score,
                "candle_score": result.candle_score,
                "fundamental_score": result.fundamental_score,
                "sentiment_score": result.sentiment_score,
                "sector_score": result.sector_score,
                "rsi": result.rsi,
                "macd_signal": result.macd_signal,
                "rsi_override": result.rsi_override,
                "rr_valid": result.rr_valid,
                "rejection_reason": result.rejection_reason,
            },
            raw_result=result
        )

    def _get_stock_data(self, ticker: str) -> Dict:
        """الحصول على بيانات السهم من قاعدة البيانات"""
        import sqlite3
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT ticker, name, current_price, volume, sector
                FROM stocks WHERE ticker = ?
            ''', (ticker,))
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'ticker': row[0],
                    'name': row[1],
                    'current_price': row[2],
                    'volume': row[3],
                    'sector': row[4],
                }
        except Exception as e:
            print(f"[UnifiedMaestro] Error getting stock data: {e}")
        
        return {}
        
    def _get_price_history(self, ticker: str, limit: int = 100) -> List[Dict]:
        """الحصول على تاريخ الأسعار من قاعدة البيانات المدمجة (يومي + لحظي).

        PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        The previous body called `analyzers.master_analyzer.load_merged_history`
        directly; `data.prices.load_price_history` wraps that same canonical
        reader with a 5-min LRU cache, so callers in the same analysis run
        now hit the DB once per (ticker, limit).
        """
        try:
            from data.prices import load_price_history
            return load_price_history(ticker, limit=limit)
        except Exception as e:
            print(f"[UnifiedMaestro] Error getting price history: {e}")
            return []

    def scan_market(
        self,
        market: str,
        limit: int = 20
    ) -> List[UnifiedMaestroResult]:
        """
        فحص سوق كامل وإرجاع أفضل الفرص
        """
        import sqlite3
        
        results = []
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get stocks for this market
            if market == "EGX":
                cursor.execute('''
                    SELECT ticker FROM stocks 
                    WHERE (market = 'EGX' OR market IS NULL)
                    AND current_price > 0 AND volume > 0
                    ORDER BY volume DESC
                    LIMIT ?
                ''', (limit * 3,))
            else:
                cursor.execute('''
                    SELECT ticker FROM stocks 
                    WHERE market = ?
                    AND current_price > 0 AND volume > 0
                    ORDER BY volume DESC
                    LIMIT ?
                ''', (market, limit * 3,))
            
            tickers = [row[0] for row in cursor.fetchall()]
            conn.close()
            
            # Analyze each ticker
            for ticker in tickers[:limit * 2]:
                result = self.analyze(ticker, market)
                if result and result.signal in ["STRONG_BUY", "BUY", "ACCUMULATE"]:
                    results.append(result)
            
            # Sort by score
            results.sort(key=lambda x: x.score, reverse=True)
            
        except Exception as e:
            print(f"[UnifiedMaestro] Scan error: {e}")
        
        return results[:limit]


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def analyze_ticker(
    ticker: str,
    market: str = None,
    db_path: str = None
) -> Optional[UnifiedMaestroResult]:
    """
    تحليل سهم من أي سوق

    Example:
        result = analyze_ticker("COMI")  # EGX
        result = analyze_ticker("1120.SR", "KSA")  # Saudi
        result = analyze_ticker("bitcoin", "CRYPTO")  # Crypto
    """
    # MAESTRO-DISABLED (Task PHASE-2-MAESTRO-PYTHON, Rule 73)
    if MAESTRO_DISABLED:
        return None
    engine = UnifiedMaestroEngine(db_path)
    return engine.analyze(ticker, market)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("UNIFIED MAESTRO ENGINE TEST")
    print("=" * 60)
    
    engine = UnifiedMaestroEngine(_DEFAULT_STOCKS_DB)
    
    # Test EGX
    print("\n📊 Testing EGX (COMI)...")
    result = engine.analyze("COMI", "EGX")
    if result:
        print(f"  Signal: {result.signal_ar}")
        print(f"  Score: {result.score}")
        print(f"  Price: {result.current_price}")
    
    # Test Crypto
    print("\n₿ Testing Crypto (Bitcoin)...")
    result = engine.analyze("bitcoin", "CRYPTO")
    if result:
        print(f"  Signal: {result.signal_ar}")
        print(f"  Score: {result.score}")
        print(f"  Price: ${result.current_price:,.2f}")
    
    print("\n" + "=" * 60)
