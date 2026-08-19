#!/usr/bin/env python3
"""
Crypto Prediction Engine v2
===========================
نظام تحليل وتوقعات العملات الرقمية - مدمج مع النظام الموجود

Features:
- يستخدم CryptoMaestroOrchestrator الموجود
- يستخدم CryptoIterativeLearningEngine للتعلم
- تتبع وتقييم التوقعات
- تحسين مستمر للـ Parameters

Integration:
- crypto_maestro.py - التحليل الرئيسي
- crypto_learning_routes.py - التعلم التكراري
- crypto_database.py - قاعدة البيانات
"""

import os
import sys
import json
import math
import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from enum import Enum
import statistics

# Add parent directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# استيراد المكونات الموجودة
from analyzers.crypto_maestro import CryptoMaestroOrchestrator, analyze_crypto
from analyzers.crypto_regime import CryptoRegimeDetector, get_crypto_regime

# Database path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_DIR = os.path.join(BASE_DIR, 'db')
CRYPTO_DB = os.path.join(DB_DIR, 'crypto.db')
LEARNING_DB = os.path.join(DB_DIR, 'crypto_learning.db')


class SignalType(Enum):
    STRONG_BUY = "strong_buy"
    BUY = "buy"
    NEUTRAL = "neutral"
    SELL = "sell"
    STRONG_SELL = "strong_sell"


@dataclass
class PredictionResult:
    """نتيجة التوقع"""
    symbol: str
    name: str
    current_price: float
    predicted_price_1d: float
    predicted_price_7d: float
    predicted_change_1d: float
    predicted_change_7d: float
    confidence: float
    signal: str
    trend: str
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: float
    position_size_pct: float
    indicators: Dict
    support_levels: List[float]
    resistance_levels: List[float]
    fear_greed_index: int
    market_regime: str
    market_sentiment: str
    risk_level: str
    reasons: List[str]
    warnings: List[str]
    timestamp: str


class CryptoPredictionEngine:
    """
    محرك التوقعات - يستخدم المكونات الموجودة
    
    يعمل مع:
    - CryptoMaestroOrchestrator للتحليل
    - CryptoRegimeDetector لحالة السوق
    - crypto_learning.db للتعلم التكراري
    """

    def __init__(self):
        self.db_path = CRYPTO_DB
        self.learning_db = LEARNING_DB
        self.maestro = CryptoMaestroOrchestrator()
        self.regime_detector = CryptoRegimeDetector()
        self._init_prediction_tables()

    def _init_prediction_tables(self):
        """إنشاء جداول التتبع والتقييم"""
        os.makedirs(os.path.dirname(self.learning_db), exist_ok=True)
        
        with sqlite3.connect(self.learning_db) as conn:
            cursor = conn.cursor()
            
            # جدول التوقعات اليومية للتتبع
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS daily_predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    name TEXT,
                    prediction_date TEXT NOT NULL,
                    current_price REAL,
                    predicted_price_1d REAL,
                    predicted_price_7d REAL,
                    predicted_change_1d REAL,
                    predicted_change_7d REAL,
                    confidence REAL,
                    signal TEXT,
                    trend TEXT,
                    entry_price REAL,
                    stop_loss REAL,
                    target REAL,
                    market_regime TEXT,
                    fear_greed_index INTEGER,
                    indicators TEXT,
                    reasons TEXT,
                    warnings TEXT,
                    -- التقييم (يُملأ لاحقاً)
                    validated INTEGER DEFAULT 0,
                    validated_at TEXT,
                    actual_price_1d REAL,
                    actual_price_7d REAL,
                    actual_change_1d REAL,
                    actual_change_7d REAL,
                    direction_correct_1d INTEGER,
                    direction_correct_7d INTEGER,
                    target_reached INTEGER DEFAULT 0,
                    stop_hit INTEGER DEFAULT 0,
                    max_drawdown REAL,
                    max_profit REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # جدول إحصائيات الأداء
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS prediction_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    total_predictions INTEGER DEFAULT 0,
                    validated_predictions INTEGER DEFAULT 0,
                    correct_direction_1d INTEGER DEFAULT 0,
                    correct_direction_7d INTEGER DEFAULT 0,
                    accuracy_1d REAL DEFAULT 0,
                    accuracy_7d REAL DEFAULT 0,
                    avg_confidence REAL DEFAULT 0,
                    targets_reached INTEGER DEFAULT 0,
                    stops_hit INTEGER DEFAULT 0,
                    avg_return_1d REAL DEFAULT 0,
                    avg_return_7d REAL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(date)
                )
            ''')
            
            # جدول الدروس المستفادة
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS learned_patterns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pattern_type TEXT NOT NULL,
                    conditions TEXT,
                    outcome TEXT,
                    success_rate REAL DEFAULT 0,
                    occurrences INTEGER DEFAULT 1,
                    last_seen TEXT,
                    recommendation TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()

    def get_crypto_data(self, symbol: str) -> Optional[Dict]:
        """الحصول على بيانات العملة من crypto.db"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT * FROM cryptos 
                    WHERE symbol = ? AND is_active = 1
                ''', (symbol.upper(),))
                
                row = cursor.fetchone()
                if row:
                    return dict(row)
        except Exception as e:
            print(f"Error getting crypto data: {e}")
        
        return None

    def get_all_cryptos(self) -> List[Dict]:
        """الحصول على كل العملات"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT * FROM cryptos 
                    WHERE is_active = 1 
                    ORDER BY rank
                ''')
                
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            print(f"Error getting cryptos: {e}")
            return []

    def analyze_crypto(self, symbol: str) -> Optional[PredictionResult]:
        """
        تحليل عملة باستخدام CryptoMaestro الموجود
        """
        # استخدام المايسترو الموجود
        result = self.maestro.analyze(symbol.lower())
        
        if not result:
            # محاولة بديلة من قاعدة البيانات
            crypto = self.get_crypto_data(symbol)
            if not crypto:
                return None
            
            # إنشاء تحليل بسيط
            return self._create_simple_prediction(crypto)
        
        # تحويل النتيجة للتنسيق المطلوب
        current_price = result.current_price
        
        # حساب التوقعات بناءً على الهدف والاستوب
        if result.signal in ['STRONG_BUY', 'BUY']:
            predicted_change_1d = ((result.target - current_price) / current_price * 100) * 0.3  # 30% من الهدف
            predicted_change_7d = ((result.target - current_price) / current_price * 100) * 0.7  # 70% من الهدف
        elif result.signal in ['STRONG_SELL', 'SELL']:
            predicted_change_1d = ((result.stop_loss - current_price) / current_price * 100) * 0.3
            predicted_change_7d = ((result.stop_loss - current_price) / current_price * 100) * 0.7
        else:
            predicted_change_1d = 0
            predicted_change_7d = 0
        
        prediction = PredictionResult(
            symbol=result.symbol,
            name=result.name,
            current_price=current_price,
            predicted_price_1d=current_price * (1 + predicted_change_1d / 100),
            predicted_price_7d=current_price * (1 + predicted_change_7d / 100),
            predicted_change_1d=predicted_change_1d,
            predicted_change_7d=predicted_change_7d,
            confidence=result.confidence,
            signal=result.signal.lower(),
            trend=result.market_regime,
            entry_price=result.entry_price,
            stop_loss=result.stop_loss,
            target=result.target,
            risk_reward=result.risk_reward,
            position_size_pct=result.position_size_pct,
            indicators={
                'rsi': result.raw_analysis.technical_indicators.get('rsi', 50) if result.raw_analysis else 50,
                'macd_trend': 'bullish' if result.raw_analysis and result.raw_analysis.technical_indicators.get('macd', 0) > 0 else 'bearish',
                'bb_position': 0.5,
            },
            support_levels=[result.stop_loss] if result.stop_loss else [],
            resistance_levels=[result.target] if result.target else [],
            fear_greed_index=result.fear_greed,
            market_regime=result.market_regime,
            market_sentiment=self._get_sentiment_label(result.fear_greed),
            risk_level=self._calculate_risk_level(result.risk_reward, result.market_regime),
            reasons=result.reasons,
            warnings=result.warnings,
            timestamp=datetime.now().isoformat()
        )
        
        # حفظ التوقع للتتبع
        self._save_prediction(prediction)
        
        return prediction

    def _create_simple_prediction(self, crypto: Dict) -> PredictionResult:
        """إنشاء توقع بسيط من بيانات العملة"""
        current_price = crypto.get('current_price_usd', 0)
        change_24h = crypto.get('price_change_24h', 0)
        
        # توقع بسيط بناءً على الزخم
        predicted_change_1d = change_24h * 0.5
        predicted_change_7d = change_24h * 1.5
        
        signal = 'buy' if change_24h > 5 else 'sell' if change_24h < -5 else 'neutral'
        
        return PredictionResult(
            symbol=crypto.get('symbol', ''),
            name=crypto.get('name', ''),
            current_price=current_price,
            predicted_price_1d=current_price * (1 + predicted_change_1d / 100),
            predicted_price_7d=current_price * (1 + predicted_change_7d / 100),
            predicted_change_1d=predicted_change_1d,
            predicted_change_7d=predicted_change_7d,
            confidence=50,
            signal=signal,
            trend='unknown',
            entry_price=current_price * 0.995,
            stop_loss=current_price * 0.85,
            target=current_price * 1.15,
            risk_reward=2.0,
            position_size_pct=3.0,
            indicators={'rsi': 50, 'macd_trend': 'neutral', 'bb_position': 0.5},
            support_levels=[current_price * 0.9],
            resistance_levels=[current_price * 1.1],
            fear_greed_index=50,
            market_regime='RANGE',
            market_sentiment='Neutral',
            risk_level='medium',
            reasons=['تحليل تلقائي من بيانات السوق'],
            warnings=['بيانات محدودة - تحقق من التحليل'],
            timestamp=datetime.now().isoformat()
        )

    def _get_sentiment_label(self, fear_greed: int) -> str:
        """تحويل Fear & Greed لوصف"""
        if fear_greed <= 25:
            return "Extreme Fear"
        elif fear_greed <= 45:
            return "Fear"
        elif fear_greed <= 55:
            return "Neutral"
        elif fear_greed <= 75:
            return "Greed"
        else:
            return "Extreme Greed"

    def _calculate_risk_level(self, risk_reward: float, regime: str) -> str:
        """حساب مستوى المخاطرة"""
        if regime in ['ALT_SEASON', 'BTC_SEASON']:
            return 'medium' if risk_reward >= 2 else 'high'
        elif regime == 'EXTREME_FEAR':
            return 'low'  # فرصة
        elif regime == 'EXTREME_GREED':
            return 'very_high'  # خطر
        else:
            return 'medium'

    def _save_prediction(self, prediction: PredictionResult):
        """حفظ التوقع للتتبع والتقييم"""
        try:
            with sqlite3.connect(self.learning_db) as conn:
                cursor = conn.cursor()
                
                cursor.execute('''
                    INSERT INTO daily_predictions 
                    (symbol, name, prediction_date, current_price, predicted_price_1d, 
                     predicted_price_7d, predicted_change_1d, predicted_change_7d,
                     confidence, signal, trend, entry_price, stop_loss, target,
                     market_regime, fear_greed_index, indicators, reasons, warnings)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    prediction.symbol,
                    prediction.name,
                    datetime.now().strftime('%Y-%m-%d'),
                    prediction.current_price,
                    prediction.predicted_price_1d,
                    prediction.predicted_price_7d,
                    prediction.predicted_change_1d,
                    prediction.predicted_change_7d,
                    prediction.confidence,
                    prediction.signal,
                    prediction.trend,
                    prediction.entry_price,
                    prediction.stop_loss,
                    prediction.target,
                    prediction.market_regime,
                    prediction.fear_greed_index,
                    json.dumps(prediction.indicators),
                    json.dumps(prediction.reasons),
                    json.dumps(prediction.warnings)
                ))
                
                conn.commit()
        except Exception as e:
            print(f"Error saving prediction: {e}")

    def analyze_all(self) -> List[PredictionResult]:
        """تحليل كل العملات"""
        cryptos = self.get_all_cryptos()
        results = []
        
        for crypto in cryptos:
            try:
                result = self.analyze_crypto(crypto['symbol'])
                if result:
                    results.append(result)
            except Exception as e:
                print(f"Error analyzing {crypto['symbol']}: {e}")
        
        return results

    def get_top_signals(self, signal_type: str = 'buy', limit: int = 10) -> List[Dict]:
        """الحصول على أفضل الإشارات"""
        results = self.analyze_all()
        
        # فلترة حسب النوع
        if signal_type == 'buy':
            filtered = [r for r in results if r.signal in ['strong_buy', 'buy']]
        elif signal_type == 'sell':
            filtered = [r for r in results if r.signal in ['strong_sell', 'sell']]
        else:
            filtered = results
        
        # ترتيب حسب الثقة
        sorted_results = sorted(filtered, key=lambda x: x.confidence, reverse=True)[:limit]
        
        return [asdict(r) for r in sorted_results]

    def validate_predictions(self) -> Dict:
        """
        تقييم التوقعات السابقة
        هذه هي الحلقة التكرارية للتعلم!
        """
        validated_count = 0
        correct_1d = 0
        correct_7d = 0
        
        try:
            with sqlite3.connect(self.learning_db) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # التوقعات غير المُقيّمة منذ أكثر من يوم
                cursor.execute('''
                    SELECT * FROM daily_predictions 
                    WHERE validated = 0 
                    AND date(prediction_date) < date('now', '-1 day')
                ''')
                
                predictions = cursor.fetchall()
                
                for pred in predictions:
                    # الحصول على السعر الفعلي الحالي
                    current_data = self.get_crypto_data(pred['symbol'])
                    if not current_data:
                        continue
                    
                    actual_price = current_data.get('current_price_usd', 0)
                    if actual_price == 0:
                        continue
                    
                    pred_price = pred['current_price']
                    
                    # حساب التغير الفعلي
                    actual_change = ((actual_price - pred_price) / pred_price * 100) if pred_price > 0 else 0
                    
                    # تحديد صحة الاتجاه
                    predicted_direction = pred['predicted_change_1d']
                    direction_correct = 1 if (predicted_direction > 0 and actual_change > 0) or \
                                             (predicted_direction < 0 and actual_change < 0) else 0
                    
                    # تحديث السجل
                    cursor.execute('''
                        UPDATE daily_predictions 
                        SET validated = 1,
                            validated_at = ?,
                            actual_price_1d = ?,
                            actual_change_1d = ?,
                            direction_correct_1d = ?
                        WHERE id = ?
                    ''', (
                        datetime.now().isoformat(),
                        actual_price,
                        actual_change,
                        direction_correct,
                        pred['id']
                    ))
                    
                    validated_count += 1
                    if direction_correct:
                        correct_1d += 1
                    
            except Exception as e:
                print(f"Error validating predictions: {e}")
        
        # تحديث الإحصائيات
        accuracy = (correct_1d / validated_count * 100) if validated_count > 0 else 0
        
        return {
            'validated': validated_count,
            'correct_direction': correct_1d,
            'accuracy': round(accuracy, 2)
        }

    def get_performance_stats(self, days: int = 30) -> Dict:
        """الحصول على إحصائيات الأداء"""
        try:
            with sqlite3.connect(self.learning_db) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # إحصائيات التوقعات
                cursor.execute('''
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN validated = 1 THEN 1 ELSE 0 END) as validated,
                        SUM(CASE WHEN direction_correct_1d = 1 THEN 1 ELSE 0 END) as correct_1d,
                        AVG(confidence) as avg_confidence,
                        SUM(CASE WHEN target_reached = 1 THEN 1 ELSE 0 END) as targets_reached,
                        SUM(CASE WHEN stop_hit = 1 THEN 1 ELSE 0 END) as stops_hit
                    FROM daily_predictions
                    WHERE date(created_at) >= date('now', ?)
                ''', (f'-{days} days',))
                
                row = cursor.fetchone()
                
                total = row['total'] or 0
                validated = row['validated'] or 0
                correct = row['correct_1d'] or 0
                
                return {
                    'total_predictions': total,
                    'validated_predictions': validated,
                    'correct_direction': correct,
                    'accuracy_1d': round((correct / validated * 100), 2) if validated > 0 else 0,
                    'avg_confidence': round(row['avg_confidence'] or 0, 2),
                    'targets_reached': row['targets_reached'] or 0,
                    'stops_hit': row['stops_hit'] or 0,
                    'win_rate': round(((row['targets_reached'] or 0) / max(validated, 1)) * 100, 2)
                }
        except Exception as e:
            return {'error': str(e)}


# Singleton instance
prediction_engine = CryptoPredictionEngine()


# CLI test
if __name__ == "__main__":
    print("\n🚀 Crypto Prediction Engine v2 - Integration Test")
    print("=" * 60)
    
    # تحليل BTC
    result = prediction_engine.analyze_crypto('BTC')
    if result:
        print(f"\n📊 {result.symbol} - {result.name}")
        print(f"  السعر: ${result.current_price:,.2f}")
        print(f"  التوقع 1D: ${result.predicted_price_1d:,.2f} ({result.predicted_change_1d:+.2f}%)")
        print(f"  الإشارة: {result.signal.upper()}")
        print(f"  الثقة: {result.confidence:.0f}%")
        print(f"  الدخول: ${result.entry_price:,.2f}")
        print(f"  الهدف: ${result.target:,.2f}")
        print(f"  الاستوب: ${result.stop_loss:,.2f}")
        print(f"  R:R: 1:{result.risk_reward}")
        print(f"  Fear & Greed: {result.fear_greed_index}")
        print(f"  Market Regime: {result.market_regime}")
    
    # إحصائيات الأداء
    print("\n📈 Performance Stats:")
    stats = prediction_engine.get_performance_stats()
    print(f"  Total Predictions: {stats.get('total_predictions', 0)}")
    print(f"  Accuracy 1D: {stats.get('accuracy_1d', 0)}%")
