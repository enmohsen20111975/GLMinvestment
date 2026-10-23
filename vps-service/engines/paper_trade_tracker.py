"""
Paper Trade Tracker - متتبع الصفقات الافتراضية
================================================

الهدف: تتبع الصفقات الافتراضية وتقييم نتائجها

الفرق بين التعلم التاريخي والتعلم التكراري:
==========================================
1. التعلم التاريخي (Historical Learning):
   - يطبق الاستراتيجيات على بيانات الماضي (6 شهور فاتت)
   - يحسب كيف كان النظام سيتصرف
   - يستخرج دروس من الماضي
   - يعمل مرة واحدة أو عند طلب التحديث

2. التعلم التكراري (Iterative Learning):
   - يضع توقعات اليوم للأسابيع القادمة
   - يتتبع النتائج الفعلية مع مرور الوقت
   - يعدل الأوزان بناءً على الأداء الفعلي
   - يعمل بشكل مستمر (يومي/أسبوعي)

هذا الملف يدمج الاثنين معاً:
- يسمح بتتبع صفقات افتراضية من أي تاريخ
- يقيس النتائج بعد 1/5/10/20 يوم
- يغذي النتائج في نظام التعلم

Author: دليل الاستثمار
Version: 1.0.0
"""

import sqlite3
import json
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict, field
from pathlib import Path
import logging
from enum import Enum

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================================
# ENUMS
# ============================================================================

class TradeStatus(str, Enum):
    """حالة الصفقة"""
    OPEN = "open"           # مفتوحة - في الانتظار
    CLOSED = "closed"       # مغلقة - تم تقييمها
    CANCELLED = "cancelled" # ملغاة


class TradeResult(str, Enum):
    """نتيجة الصفقة"""
    WIN = "win"             # ربح
    LOSS = "loss"           # خسارة
    BREAKEVEN = "breakeven" # تعادل


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class PaperTrade:
    """صفقة افتراضية"""
    trade_id: str
    ticker: str
    stock_id: int
    
    # بيانات الدخول
    entry_date: str
    entry_price: float
    direction: str  # long, short
    signal: str     # STRONG_BUY, BUY, etc.
    composite_score: float
    confidence: float
    
    # الأهداف والمخاطر
    target_price: float
    stop_loss: float
    risk_reward_ratio: float
    
    # المؤشرات وقت الدخول
    indicators: Dict = field(default_factory=dict)
    market_regime: str = "RANGE"
    persona: str = "balanced"
    
    # النتائج (تُملأ لاحقاً)
    status: str = "open"
    exit_date: Optional[str] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None
    
    # التقييم
    result: Optional[str] = None
    profit_pct: Optional[float] = None
    days_held: Optional[int] = None
    max_drawdown: Optional[float] = None
    max_profit: Optional[float] = None
    target_reached: bool = False
    stop_hit: bool = False
    
    # التحقق
    verified_1d: bool = False
    verified_5d: bool = False
    verified_10d: bool = False
    verified_20d: bool = False
    
    price_1d: Optional[float] = None
    price_5d: Optional[float] = None
    price_10d: Optional[float] = None
    price_20d: Optional[float] = None
    
    direction_correct_5d: Optional[bool] = None
    direction_correct_10d: Optional[bool] = None
    direction_correct_20d: Optional[bool] = None
    
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class TradeEvaluation:
    """تقييم مجموعة صفقات"""
    total_trades: int = 0
    open_trades: int = 0
    closed_trades: int = 0
    
    wins: int = 0
    losses: int = 0
    breakeven: int = 0
    
    win_rate: float = 0.0
    avg_profit: float = 0.0
    avg_loss: float = 0.0
    total_return: float = 0.0
    
    avg_days_held: float = 0.0
    avg_max_drawdown: float = 0.0
    
    # حسب الشخصية
    by_persona: Dict = field(default_factory=dict)
    
    # حسب الإشارة
    by_signal: Dict = field(default_factory=dict)
    
    # حسب حالة السوق
    by_regime: Dict = field(default_factory=dict)
    
    # أفضل وأسوأ
    best_trade: Optional[Dict] = None
    worst_trade: Optional[Dict] = None
    
    # الدروس المستفادة
    lessons: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# PAPER TRADE TRACKER
# ============================================================================

class PaperTradeTracker:
    """
    متتبع الصفقات الافتراضية
    
    الوظائف:
    1. إنشاء صفقات افتراضية من التحليلات
    2. تتبع نتائجها بعد فترات محددة
    3. تقييم الأداء واستخراج الدروس
    4. تحديث أوزان النظام بناءً على النتائج
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None
        
        # أوزان التحليل (يمكن تعديلها بناءً على الأداء)
        self.weights = {
            'rsi': 0.20,
            'macd': 0.15,
            'trend': 0.20,
            'volume': 0.15,
            'bollinger': 0.10,
            'adx': 0.10,
            'price_position': 0.10,
        }
        
        # عتبات الإشارات
        self.thresholds = {
            'STRONG_BUY': 80,
            'BUY': 65,
            'ACCUMULATE': 50,
            'HOLD': 35,
            'REDUCE': 25,
            'SELL': 15,
            'STRONG_SELL': 5,
        }
        
        # الشخصيات
        self.personas = {
            'conservative': {'buy_threshold': 75, 'name_ar': 'المحافظ'},
            'cautious': {'buy_threshold': 70, 'name_ar': 'المتوسط الحذر'},
            'balanced': {'buy_threshold': 65, 'name_ar': 'المتوازن'},
            'active_trader': {'buy_threshold': 60, 'name_ar': 'المضارب المنتظم'},
            'adventurer': {'buy_threshold': 55, 'name_ar': 'المغامر'},
            'gambler': {'buy_threshold': 50, 'name_ar': 'المقامر المحسن'},
        }
        
        logger.info(f"PaperTradeTracker initialized with db: {db_path}")
    
    def connect(self):
        """الاتصال بقاعدة البيانات"""
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        self.conn = db_manager.get_connection(self.db_path, writable=False)
        self.conn.row_factory = sqlite3.Row
        self._ensure_tables()
        logger.info("Database connected and tables ensured")
    
    def disconnect(self):
        """قطع الاتصال"""
        if self.conn:
            self.conn.close()
            logger.info("Database disconnected")
    
    def _ensure_tables(self):
        """التأكد من وجود الجداول"""
        cursor = self.conn.cursor()
        
        # جدول الصفقات الافتراضية
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS paper_trades (
                trade_id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                stock_id INTEGER,
                
                entry_date TEXT NOT NULL,
                entry_price REAL NOT NULL,
                direction TEXT NOT NULL,
                signal TEXT NOT NULL,
                composite_score REAL,
                confidence REAL,
                
                target_price REAL,
                stop_loss REAL,
                risk_reward_ratio REAL,
                
                indicators TEXT,
                market_regime TEXT DEFAULT 'RANGE',
                persona TEXT DEFAULT 'balanced',
                
                status TEXT DEFAULT 'open',
                exit_date TEXT,
                exit_price REAL,
                exit_reason TEXT,
                
                result TEXT,
                profit_pct REAL,
                days_held INTEGER,
                max_drawdown REAL,
                max_profit REAL,
                target_reached INTEGER DEFAULT 0,
                stop_hit INTEGER DEFAULT 0,
                
                verified_1d INTEGER DEFAULT 0,
                verified_5d INTEGER DEFAULT 0,
                verified_10d INTEGER DEFAULT 0,
                verified_20d INTEGER DEFAULT 0,
                
                price_1d REAL,
                price_5d REAL,
                price_10d REAL,
                price_20d REAL,
                
                direction_correct_5d INTEGER,
                direction_correct_10d INTEGER,
                direction_correct_20d INTEGER,
                
                created_at TEXT,
                updated_at TEXT
            )
        ''')
        
        # جدول دروس التعلم التكراري
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS iterative_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_type TEXT NOT NULL,
                ticker TEXT,
                sector TEXT,
                
                trigger_conditions TEXT,
                observation TEXT,
                action_taken TEXT,
                
                before_weight REAL,
                after_weight REAL,
                
                sample_size INTEGER,
                success_rate REAL,
                
                created_at TEXT,
                status TEXT DEFAULT 'active'
            )
        ''')
        
        # جدول تاريخ الأوزان
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weight_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                indicator TEXT NOT NULL,
                old_weight REAL,
                new_weight REAL,
                change_reason TEXT,
                performance_data TEXT,
                changed_at TEXT
            )
        ''')
        
        self.conn.commit()
        logger.info("Tables ensured")
    
    # ========================================================================
    # إنشاء صفقات افتراضية
    # ========================================================================
    
    def create_paper_trade(
        self,
        ticker: str,
        stock_id: int,
        entry_date: str,
        entry_price: float,
        signal: str,
        composite_score: float,
        confidence: float,
        target_price: float,
        stop_loss: float,
        indicators: Dict = None,
        market_regime: str = "RANGE",
        persona: str = "balanced"
    ) -> PaperTrade:
        """إنشاء صفقة افتراضية جديدة"""
        
        # تحديد الاتجاه
        if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
            direction = "long"
        elif signal in ['SELL', 'STRONG_SELL', 'REDUCE']:
            direction = "short"
        else:
            direction = "neutral"
        
        # حساب R:R
        if direction == "long":
            risk = entry_price - stop_loss
            reward = target_price - entry_price
        else:
            risk = stop_loss - entry_price
            reward = entry_price - target_price
        
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=0.0)
        except Exception:
            if entry_price < target_price:
                risk = entry_price - stop_loss
                reward = target_price - entry_price
            else:
                risk = stop_loss - entry_price
                reward = entry_price - target_price
            risk_reward = round(reward / risk, 2) if risk > 0 else 0
        
        # إنشاء ID
        trade_id = f"PAPER-{ticker}-{entry_date.replace('-', '')}"
        
        trade = PaperTrade(
            trade_id=trade_id,
            ticker=ticker,
            stock_id=stock_id,
            entry_date=entry_date,
            entry_price=entry_price,
            direction=direction,
            signal=signal,
            composite_score=composite_score,
            confidence=confidence,
            target_price=target_price,
            stop_loss=stop_loss,
            risk_reward_ratio=risk_reward,
            indicators=indicators or {},
            market_regime=market_regime,
            persona=persona,
        )
        
        # حفظ في قاعدة البيانات
        self._save_trade(trade)
        
        logger.info(f"Created paper trade: {trade_id}")
        return trade
    
    def _save_trade(self, trade: PaperTrade):
        """حفظ الصفقة في قاعدة البيانات"""
        cursor = self.conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO paper_trades (
                trade_id, ticker, stock_id,
                entry_date, entry_price, direction, signal,
                composite_score, confidence,
                target_price, stop_loss, risk_reward_ratio,
                indicators, market_regime, persona,
                status, exit_date, exit_price, exit_reason,
                result, profit_pct, days_held,
                max_drawdown, max_profit,
                target_reached, stop_hit,
                verified_1d, verified_5d, verified_10d, verified_20d,
                price_1d, price_5d, price_10d, price_20d,
                direction_correct_5d, direction_correct_10d, direction_correct_20d,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            trade.trade_id, trade.ticker, trade.stock_id,
            trade.entry_date, trade.entry_price, trade.direction, trade.signal,
            trade.composite_score, trade.confidence,
            trade.target_price, trade.stop_loss, trade.risk_reward_ratio,
            json.dumps(trade.indicators), trade.market_regime, trade.persona,
            trade.status, trade.exit_date, trade.exit_price, trade.exit_reason,
            trade.result, trade.profit_pct, trade.days_held,
            trade.max_drawdown, trade.max_profit,
            1 if trade.target_reached else 0, 1 if trade.stop_hit else 0,
            1 if trade.verified_1d else 0, 1 if trade.verified_5d else 0,
            1 if trade.verified_10d else 0, 1 if trade.verified_20d else 0,
            trade.price_1d, trade.price_5d, trade.price_10d, trade.price_20d,
            1 if trade.direction_correct_5d else 0 if trade.direction_correct_5d is False else None,
            1 if trade.direction_correct_10d else 0 if trade.direction_correct_10d is False else None,
            1 if trade.direction_correct_20d else 0 if trade.direction_correct_20d is False else None,
            trade.created_at, trade.updated_at
        ))
        
        self.conn.commit()
    
    # ========================================================================
    # تتبع النتائج
    # ========================================================================
    
    def verify_trades(self, days_back: int = 30) -> Dict:
        """
        التحقق من نتائج الصفقات الافتراضية
        
        يمر على الصفقات المفتوحة ويتحقق من:
        - السعر بعد 1/5/10/20 يوم
        - هل الهدف تحقق؟
        - هل الوقوف تم تفعيله؟
        - صحة التوقع
        """
        cursor = self.conn.cursor()
        
        # الصفقات المفتوحة
        cursor.execute('''
            SELECT * FROM paper_trades 
            WHERE status = 'open'
            ORDER BY entry_date
        ''')
        
        open_trades = cursor.fetchall()
        
        results = {
            'trades_checked': 0,
            'trades_verified_5d': 0,
            'trades_verified_10d': 0,
            'trades_verified_20d': 0,
            'trades_closed': 0,
            'errors': 0,
        }
        
        for trade_row in open_trades:
            try:
                trade = self._row_to_trade(trade_row)
                
                # الحصول على أسعار المستقبل
                future_prices = self._get_future_prices(
                    trade.stock_id,
                    trade.entry_date,
                    20
                )
                
                if not future_prices:
                    continue
                
                results['trades_checked'] += 1
                
                # تحديث الأسعار
                updated = False
                
                # يوم 1
                if len(future_prices) >= 1 and not trade.verified_1d:
                    trade.price_1d = future_prices[0]['close']
                    trade.verified_1d = True
                    updated = True
                
                # يوم 5
                if len(future_prices) >= 5 and not trade.verified_5d:
                    trade.price_5d = future_prices[4]['close']
                    trade.verified_5d = True
                    trade.direction_correct_5d = self._check_direction(
                        trade.direction, trade.entry_price, trade.price_5d
                    )
                    updated = True
                    results['trades_verified_5d'] += 1
                
                # يوم 10
                if len(future_prices) >= 10 and not trade.verified_10d:
                    trade.price_10d = future_prices[9]['close']
                    trade.verified_10d = True
                    trade.direction_correct_10d = self._check_direction(
                        trade.direction, trade.entry_price, trade.price_10d
                    )
                    updated = True
                    results['trades_verified_10d'] += 1
                
                # يوم 20 - إغلاق الصفقة
                if len(future_prices) >= 20 and not trade.verified_20d:
                    trade.price_20d = future_prices[19]['close']
                    trade.verified_20d = True
                    trade.direction_correct_20d = self._check_direction(
                        trade.direction, trade.entry_price, trade.price_20d
                    )
                    
                    # حساب الأداء
                    self._calculate_performance(trade, future_prices)
                    trade.status = "closed"
                    trade.exit_date = future_prices[19]['date']
                    trade.exit_price = trade.price_20d
                    trade.exit_reason = "20_day_expiry"
                    
                    updated = True
                    results['trades_verified_20d'] += 1
                    results['trades_closed'] += 1
                
                if updated:
                    trade.updated_at = datetime.now().isoformat()
                    self._save_trade(trade)
                
            except Exception as e:
                logger.error(f"Error verifying trade {trade_row['trade_id']}: {e}")
                results['errors'] += 1
        
        logger.info(f"Verification complete: {results}")
        return results
    
    def _get_future_prices(self, stock_id: int, entry_date: str, days: int) -> List[Dict]:
        """الحصول على أسعار المستقبل"""
        cursor = self.conn.cursor()
        
        entry_dt = datetime.strptime(entry_date, '%Y-%m-%d')
        end_dt = entry_dt + timedelta(days=days + 10)  # +10 for weekends
        
        cursor.execute('''
            SELECT date, close, high, low
            FROM stock_price_history
            WHERE stock_id = ? AND date > ?
            ORDER BY date ASC
            LIMIT ?
        ''', (stock_id, entry_date, days + 10))
        
        prices = []
        for row in cursor.fetchall():
            prices.append({
                'date': row['date'],
                'close': row['close'],
                'high': row['high'],
                'low': row['low'],
            })
        
        return prices
    
    def _check_direction(self, direction: str, entry: float, exit_price: float) -> bool:
        """التحقق من صحة الاتجاه"""
        if direction == "long":
            return exit_price > entry
        elif direction == "short":
            return exit_price < entry
        else:
            return abs(exit_price - entry) / entry < 0.02  # Within 2%
    
    def _calculate_performance(self, trade: PaperTrade, future_prices: List[Dict]):
        """حساب أداء الصفقة"""
        
        if trade.direction == "long":
            # حساب العائد
            trade.profit_pct = (trade.price_20d - trade.entry_price) / trade.entry_price * 100
            
            # أقصى ربح وخسارة
            highs = [p['high'] for p in future_prices[:20]]
            lows = [p['low'] for p in future_prices[:20]]
            
            trade.max_profit = (max(highs) - trade.entry_price) / trade.entry_price * 100
            trade.max_drawdown = (trade.entry_price - min(lows)) / trade.entry_price * 100
            
            # هل تحقق الهدف؟
            trade.target_reached = any(p['high'] >= trade.target_price for p in future_prices[:20])
            trade.stop_hit = any(p['low'] <= trade.stop_loss for p in future_prices[:20])
            
        elif trade.direction == "short":
            # للصفقات القصيرة
            trade.profit_pct = (trade.entry_price - trade.price_20d) / trade.entry_price * 100
            
            highs = [p['high'] for p in future_prices[:20]]
            lows = [p['low'] for p in future_prices[:20]]
            
            trade.max_profit = (trade.entry_price - min(lows)) / trade.entry_price * 100
            trade.max_drawdown = (max(highs) - trade.entry_price) / trade.entry_price * 100
            
            trade.target_reached = any(p['low'] <= trade.target_price for p in future_prices[:20])
            trade.stop_hit = any(p['high'] >= trade.stop_loss for p in future_prices[:20])
        
        # تحديد النتيجة
        if trade.profit_pct > 2:
            trade.result = "win"
        elif trade.profit_pct < -2:
            trade.result = "loss"
        else:
            trade.result = "breakeven"
        
        # عدد الأيام
        trade.days_held = 20
    
    def _row_to_trade(self, row) -> PaperTrade:
        """تحويل row إلى PaperTrade"""
        return PaperTrade(
            trade_id=row['trade_id'],
            ticker=row['ticker'],
            stock_id=row['stock_id'],
            entry_date=row['entry_date'],
            entry_price=row['entry_price'],
            direction=row['direction'],
            signal=row['signal'],
            composite_score=row['composite_score'],
            confidence=row['confidence'],
            target_price=row['target_price'],
            stop_loss=row['stop_loss'],
            risk_reward_ratio=row['risk_reward_ratio'],
            indicators=json.loads(row['indicators']) if row['indicators'] else {},
            market_regime=row['market_regime'],
            persona=row['persona'],
            status=row['status'],
            exit_date=row['exit_date'],
            exit_price=row['exit_price'],
            exit_reason=row['exit_reason'],
            result=row['result'],
            profit_pct=row['profit_pct'],
            days_held=row['days_held'],
            max_drawdown=row['max_drawdown'],
            max_profit=row['max_profit'],
            target_reached=bool(row['target_reached']),
            stop_hit=bool(row['stop_hit']),
            verified_1d=bool(row['verified_1d']),
            verified_5d=bool(row['verified_5d']),
            verified_10d=bool(row['verified_10d']),
            verified_20d=bool(row['verified_20d']),
            price_1d=row['price_1d'],
            price_5d=row['price_5d'],
            price_10d=row['price_10d'],
            price_20d=row['price_20d'],
            direction_correct_5d=bool(row['direction_correct_5d']) if row['direction_correct_5d'] is not None else None,
            direction_correct_10d=bool(row['direction_correct_10d']) if row['direction_correct_10d'] is not None else None,
            direction_correct_20d=bool(row['direction_correct_20d']) if row['direction_correct_20d'] is not None else None,
            created_at=row['created_at'],
            updated_at=row['updated_at'],
        )
    
    # ========================================================================
    # تقييم الأداء
    # ========================================================================
    
    def evaluate_trades(self, days: int = 30, persona: str = None) -> TradeEvaluation:
        """تقييم الصفقات الافتراضية"""
        cursor = self.conn.cursor()
        
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        query = '''
            SELECT * FROM paper_trades
            WHERE entry_date >= ?
        '''
        params = [cutoff]
        
        if persona:
            query += ' AND persona = ?'
            params.append(persona)
        
        cursor.execute(query, params)
        
        trades = [self._row_to_trade(row) for row in cursor.fetchall()]
        
        evaluation = TradeEvaluation()
        evaluation.total_trades = len(trades)
        
        closed_trades = [t for t in trades if t.status == 'closed']
        open_trades = [t for t in trades if t.status == 'open']
        
        evaluation.open_trades = len(open_trades)
        evaluation.closed_trades = len(closed_trades)
        
        if not closed_trades:
            return evaluation
        
        # حساب الإحصائيات
        wins = [t for t in closed_trades if t.result == 'win']
        losses = [t for t in closed_trades if t.result == 'loss']
        breakeven = [t for t in closed_trades if t.result == 'breakeven']
        
        evaluation.wins = len(wins)
        evaluation.losses = len(losses)
        evaluation.breakeven = len(breakeven)
        
        evaluation.win_rate = len(wins) / len(closed_trades) * 100 if closed_trades else 0
        
        # العائد
        total_profit = sum(t.profit_pct for t in closed_trades if t.profit_pct)
        evaluation.total_return = round(total_profit, 2)
        
        evaluation.avg_profit = sum(t.profit_pct for t in wins) / len(wins) if wins else 0
        evaluation.avg_loss = sum(t.profit_pct for t in losses) / len(losses) if losses else 0
        
        evaluation.avg_days_held = sum(t.days_held for t in closed_trades if t.days_held) / len(closed_trades)
        evaluation.avg_max_drawdown = sum(t.max_drawdown for t in closed_trades if t.max_drawdown) / len(closed_trades)
        
        # حسب الشخصية
        for p in self.personas.keys():
            p_trades = [t for t in closed_trades if t.persona == p]
            if p_trades:
                p_wins = [t for t in p_trades if t.result == 'win']
                evaluation.by_persona[p] = {
                    'name_ar': self.personas[p]['name_ar'],
                    'trades': len(p_trades),
                    'wins': len(p_wins),
                    'win_rate': round(len(p_wins) / len(p_trades) * 100, 1),
                    'avg_return': round(sum(t.profit_pct for t in p_trades if t.profit_pct) / len(p_trades), 2),
                }
        
        # حسب الإشارة
        for signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL', 'STRONG_SELL']:
            s_trades = [t for t in closed_trades if t.signal == signal]
            if s_trades:
                s_wins = [t for t in s_trades if t.result == 'win']
                evaluation.by_signal[signal] = {
                    'trades': len(s_trades),
                    'wins': len(s_wins),
                    'win_rate': round(len(s_wins) / len(s_trades) * 100, 1),
                }
        
        # حسب حالة السوق
        for regime in ['BULL', 'BEAR', 'RANGE']:
            r_trades = [t for t in closed_trades if t.market_regime == regime]
            if r_trades:
                r_wins = [t for t in r_trades if t.result == 'win']
                evaluation.by_regime[regime] = {
                    'trades': len(r_trades),
                    'wins': len(r_wins),
                    'win_rate': round(len(r_wins) / len(r_trades) * 100, 1),
                }
        
        # أفضل وأسوأ صفقة
        if closed_trades:
            sorted_trades = sorted(closed_trades, key=lambda t: t.profit_pct or 0)
            
            if sorted_trades:
                best = sorted_trades[-1]
                worst = sorted_trades[0]
                
                evaluation.best_trade = {
                    'ticker': best.ticker,
                    'signal': best.signal,
                    'profit_pct': round(best.profit_pct, 2),
                    'entry_date': best.entry_date,
                }
                
                evaluation.worst_trade = {
                    'ticker': worst.ticker,
                    'signal': worst.signal,
                    'profit_pct': round(worst.profit_pct, 2),
                    'entry_date': worst.entry_date,
                }
        
        # استخراج الدروس
        evaluation.lessons = self._extract_lessons(closed_trades)
        
        return evaluation
    
    def _extract_lessons(self, trades: List[PaperTrade]) -> List[str]:
        """استخراج دروس من الصفقات"""
        lessons = []
        
        if not trades:
            return lessons
        
        # 1. درس Win Rate
        wins = [t for t in trades if t.result == 'win']
        win_rate = len(wins) / len(trades) * 100
        
        if win_rate < 40:
            lessons.append(f"⚠️ Win Rate منخفض ({win_rate:.1f}%) - راجع استراتيجية الدخول")
        elif win_rate > 60:
            lessons.append(f"✅ Win Rate جيد ({win_rate:.1f}%) - استمر في الاستراتيجية الحالية")
        
        # 2. درس Drawdown
        avg_dd = sum(t.max_drawdown for t in trades if t.max_drawdown) / len(trades)
        if avg_dd > 10:
            lessons.append(f"⚠️ متوسط Drawdown عالي ({avg_dd:.1f}%) - ضع وقوف أقرب")
        
        # 3. درس Stop Hit
        stop_hits = [t for t in trades if t.stop_hit]
        if len(stop_hits) > len(trades) * 0.3:
            lessons.append(f"⚠️ كثير من الصفقات تفعّل الوقوف ({len(stop_hits)} صفقة) - اجعل الوقوف أوسع")
        
        # 4. درس Target Reached
        targets_reached = [t for t in trades if t.target_reached]
        if len(targets_reached) > len(trades) * 0.5:
            lessons.append(f"✅ أهداف محققة جيداً ({len(targets_reached)} صفقة) - يمكن رفع الأهداف")
        
        # 5. درس حسب الإشارة
        buy_trades = [t for t in trades if t.signal in ['STRONG_BUY', 'BUY']]
        accumulate_trades = [t for t in trades if t.signal == 'ACCUMULATE']
        
        if buy_trades and accumulate_trades:
            buy_wins = len([t for t in buy_trades if t.result == 'win'])
            acc_wins = len([t for t in accumulate_trades if t.result == 'win'])
            
            buy_wr = buy_wins / len(buy_trades) * 100
            acc_wr = acc_wins / len(accumulate_trades) * 100
            
            if buy_wr < acc_wr:
                lessons.append(f"💡 إشارات ACCUMULATE أفضل من BUY ({acc_wr:.1f}% vs {buy_wr:.1f}%)")
        
        return lessons
    
    # ========================================================================
    # التعلم التكراري
    # ========================================================================
    
    def run_iterative_learning(self) -> Dict:
        """
        تشغيل التعلم التكراري
        
        يحلل الصفقات المغلقة ويعدّل الأوزان
        """
        cursor = self.conn.cursor()
        
        # الحصول على الصفقات المغلقة
        cursor.execute('''
            SELECT * FROM paper_trades
            WHERE status = 'closed'
            ORDER BY entry_date DESC
            LIMIT 100
        ''')
        
        closed_trades = [self._row_to_trade(row) for row in cursor.fetchall()]
        
        if len(closed_trades) < 10:
            return {
                'success': False,
                'message': 'لا توجد صفقات كافية للتعلم (أقل من 10)',
                'trades_count': len(closed_trades),
            }
        
        # تحليل الأداء حسب المؤشر
        indicator_performance = {}
        
        for trade in closed_trades:
            indicators = trade.indicators
            is_win = trade.result == 'win'
            
            for ind_name, ind_value in indicators.items():
                if ind_name not in indicator_performance:
                    indicator_performance[ind_name] = {'total': 0, 'wins': 0}
                
                indicator_performance[ind_name]['total'] += 1
                if is_win:
                    indicator_performance[ind_name]['wins'] += 1
        
        # حساب الأوزان الجديدة
        weight_changes = []
        
        for ind_name, perf in indicator_performance.items():
            if perf['total'] < 5:
                continue
            
            win_rate = perf['wins'] / perf['total'] * 100
            old_weight = self.weights.get(ind_name, 0.1)
            
            # تعديل الوزن
            if win_rate > 60:
                new_weight = min(old_weight * 1.1, 0.3)  # زيادة 10%
            elif win_rate < 40:
                new_weight = max(old_weight * 0.9, 0.05)  # تخفيض 10%
            else:
                new_weight = old_weight
            
            if new_weight != old_weight:
                weight_changes.append({
                    'indicator': ind_name,
                    'old_weight': round(old_weight, 3),
                    'new_weight': round(new_weight, 3),
                    'win_rate': round(win_rate, 1),
                    'sample_size': perf['total'],
                })
                
                # تحديث الوزن
                self.weights[ind_name] = new_weight
                
                # حفظ في التاريخ
                cursor.execute('''
                    INSERT INTO weight_history (
                        indicator, old_weight, new_weight,
                        change_reason, performance_data, changed_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    ind_name, old_weight, new_weight,
                    f"Win rate: {win_rate:.1f}%",
                    json.dumps(perf),
                    datetime.now().isoformat()
                ))
        
        self.conn.commit()
        
        # استخراج دروس جديدة
        new_lessons = []
        
        for change in weight_changes:
            lesson = {
                'lesson_type': 'weight_adjustment',
                'indicator': change['indicator'],
                'observation': f"Win rate was {change['win_rate']}% over {change['sample_size']} trades",
                'action_taken': f"Weight adjusted from {change['old_weight']} to {change['new_weight']}",
            }
            
            cursor.execute('''
                INSERT INTO iterative_lessons (
                    lesson_type, trigger_conditions, observation,
                    action_taken, before_weight, after_weight,
                    sample_size, success_rate, created_at, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                lesson['lesson_type'],
                json.dumps({'indicator': change['indicator']}),
                lesson['observation'],
                lesson['action_taken'],
                change['old_weight'],
                change['new_weight'],
                change['sample_size'],
                change['win_rate'],
                datetime.now().isoformat(),
                'active'
            ))
            
            new_lessons.append(lesson)
        
        self.conn.commit()
        
        return {
            'success': True,
            'trades_analyzed': len(closed_trades),
            'weight_changes': weight_changes,
            'new_lessons': new_lessons,
            'current_weights': self.weights,
        }
    
    # ========================================================================
    # إنشاء صفقات من التاريخ
    # ========================================================================
    
    def generate_paper_trades_from_history(
        self,
        days_back: int = 7,
        min_score: float = 60,
        signal_types: List[str] = None
    ) -> Dict:
        """
        إنشاء صفقات افتراضية من التحليلات التاريخية
        
        Args:
            days_back: عدد الأيام للرجوع (افتراضياً أسبوع)
            min_score: الحد الأدنى للدرجة
            signal_types: أنواع الإشارات المطلوبة
        """
        cursor = self.conn.cursor()
        
        cutoff = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
        
        # الحصول على التوقعات من prediction_logs
        # Using 'recommendation' column instead of 'predicted_signal'
        query = '''
            SELECT 
                p.id, p.ticker, p.stock_id, p.prediction_date,
                p.entry_price, p.recommendation, p.composite_score, p.confidence,
                p.target_price, p.stop_loss, p.market_regime, p.source
            FROM prediction_logs p
            WHERE p.prediction_date >= ?
            AND p.composite_score >= ?
        '''
        params = [cutoff, min_score]
        
        if signal_types:
            placeholders = ','.join('?' * len(signal_types))
            query += f' AND p.recommendation IN ({placeholders})'
            params.extend(signal_types)
        
        cursor.execute(query, params)
        
        predictions = cursor.fetchall()
        
        created_trades = []
        skipped = 0
        
        for pred in predictions:
            # التحقق من عدم وجود الصفقة
            trade_id = f"PAPER-{pred['ticker']}-{pred['prediction_date'].replace('-', '')}"
            
            cursor.execute('SELECT 1 FROM paper_trades WHERE trade_id = ?', (trade_id,))
            if cursor.fetchone():
                skipped += 1
                continue
            
            # إنشاء الصفقة
            trade = self.create_paper_trade(
                ticker=pred['ticker'],
                stock_id=pred['stock_id'],
                entry_date=pred['prediction_date'],
                entry_price=pred['entry_price'],
                signal=pred['recommendation'] or 'HOLD',
                composite_score=pred['composite_score'],
                confidence=pred['confidence'],
                target_price=pred['target_price'],
                stop_loss=pred['stop_loss'],
                indicators={'source': pred['source'] or 'unknown'},
                market_regime=pred['market_regime'] or 'RANGE',
                persona='balanced'
            )
            
            created_trades.append(trade)
        
        return {
            'success': True,
            'trades_created': len(created_trades),
            'skipped': skipped,
            'days_back': days_back,
            'trades': [t.to_dict() for t in created_trades[:10]],  # أول 10 فقط
        }
    
    # ========================================================================
    # التقارير
    # ========================================================================
    
    def get_recent_trades_report(self, limit: int = 20) -> Dict:
        """تقرير الصفقات الأخيرة"""
        cursor = self.conn.cursor()
        
        cursor.execute('''
            SELECT * FROM paper_trades
            ORDER BY entry_date DESC
            LIMIT ?
        ''', (limit,))
        
        trades = [self._row_to_trade(row) for row in cursor.fetchall()]
        
        return {
            'total': len(trades),
            'trades': [t.to_dict() for t in trades],
            'generated_at': datetime.now().isoformat(),
        }
    
    def get_summary(self) -> Dict:
        """ملخص سريع"""
        cursor = self.conn.cursor()
        
        # إحصائيات عامة
        cursor.execute('SELECT COUNT(*) FROM paper_trades')
        total = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'open'")
        open_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM paper_trades WHERE status = 'closed'")
        closed_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM paper_trades WHERE result = 'win'")
        wins = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM paper_trades WHERE result = 'loss'")
        losses = cursor.fetchone()[0]
        
        # الدروس
        cursor.execute('SELECT COUNT(*) FROM iterative_lessons WHERE status = "active"')
        lessons = cursor.fetchone()[0]
        
        return {
            'total_trades': total,
            'open_trades': open_count,
            'closed_trades': closed_count,
            'wins': wins,
            'losses': losses,
            'win_rate': round(wins / closed_count * 100, 1) if closed_count > 0 else 0,
            'active_lessons': lessons,
        }


# ============================================================================
# CLI INTERFACE
# ============================================================================

def main():
    """واجهة سطر الأوامر"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Paper Trade Tracker')
    parser.add_argument('--db', default=str(Path(__file__).resolve().parents[2] / "db" / "stocks.db"), help='Database path')
    parser.add_argument('command', choices=[
        'generate', 'verify', 'evaluate', 'learn', 'summary', 'report'
    ], help='Command to run')
    parser.add_argument('--days', type=int, default=7, help='Days back')
    parser.add_argument('--min-score', type=float, default=60, help='Minimum score')
    
    args = parser.parse_args()
    
    # Initialize
    tracker = PaperTradeTracker(args.db)
    tracker.connect()
    
    try:
        if args.command == 'generate':
            result = tracker.generate_paper_trades_from_history(
                days_back=args.days,
                min_score=args.min_score
            )
            print(json.dumps(result, indent=2, ensure_ascii=False))
        
        elif args.command == 'verify':
            result = tracker.verify_trades(days_back=args.days)
            print(json.dumps(result, indent=2, ensure_ascii=False))
        
        elif args.command == 'evaluate':
            evaluation = tracker.evaluate_trades(days=args.days)
            print(json.dumps(evaluation.to_dict(), indent=2, ensure_ascii=False))
        
        elif args.command == 'learn':
            result = tracker.run_iterative_learning()
            print(json.dumps(result, indent=2, ensure_ascii=False))
        
        elif args.command == 'summary':
            summary = tracker.get_summary()
            print(json.dumps(summary, indent=2, ensure_ascii=False))
        
        elif args.command == 'report':
            report = tracker.get_recent_trades_report(limit=20)
            print(json.dumps(report, indent=2, ensure_ascii=False))
    
    finally:
        tracker.disconnect()


if __name__ == '__main__':
    main()
