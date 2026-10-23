"""
Regime Detector - كاشف حالة السوق
=====================================
يحدد هل السوق في حالة:
- صاعد واضح (Bull Trend)
- هابط واضح (Bear Trend)
- متراوح (Ranging/Sideways)

المؤشرات المستخدمة:
1. ADX (Average Directional Index)
2. Bollinger Band Width
3. MA50 Slope

Author:pers
Version: 1.1 - Fixed stock_id query
"""

import sqlite3
import json
from typing import Dict, List, Optional
from datetime import datetime


class RegimeDetector:
    """
    كاشف حالة السوق
    
    يحلل EGX30 أو أي سهم لتحديد:
    - حالة السوق (Trending vs Ranging)
    - اتجاه السوق (Bullish vs Bearish)
    - قوة الاتجاه (Strong vs Weak)
    """
    
    ADX_TREND_THRESHOLD = 25
    ADX_STRONG_THRESHOLD = 40
    ROC_THRESHOLD_BULL = 5.0
    ROC_THRESHOLD_BEAR = -5.0
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def calculate_adx(self, prices: List[Dict], period: int = 14) -> Dict:
        if len(prices) < period + 1:
            return {'adx': None, 'trend_strength': 'unknown', 'direction': 'neutral'}
        
        tr_list, plus_dm_list, minus_dm_list = [], [], []
        
        for i in range(1, len(prices)):
            high, low, close_prev = prices[i]['high'], prices[i]['low'], prices[i-1]['close']
            tr = max(high - low, abs(high - close_prev), abs(low - close_prev))
            tr_list.append(tr)
            
            up_move = high - prices[i-1]['high']
            down_move = prices[i-1]['low'] - low
            plus_dm = up_move if up_move > down_move and up_move > 0 else 0
            minus_dm = down_move if down_move > up_move and down_move > 0 else 0
            plus_dm_list.append(plus_dm)
            minus_dm_list.append(minus_dm)
        
        def smooth(values, p):
            return [sum(values[max(0,i-p+1):i+1]) / min(i+1, p) for i in range(len(values))]
        
        tr_s = smooth(tr_list, period)
        plus_s = smooth(plus_dm_list, period)
        minus_s = smooth(minus_dm_list, period)
        
        plus_di = [(plus_s[i] / tr_s[i] * 100) if tr_s[i] > 0 else 0 for i in range(len(tr_s))]
        minus_di = [(minus_s[i] / tr_s[i] * 100) if tr_s[i] > 0 else 0 for i in range(len(tr_s))]
        
        dx_list = [abs(plus_di[i] - minus_di[i]) / (plus_di[i] + minus_di[i]) * 100 
                   if (plus_di[i] + minus_di[i]) > 0 else 0 for i in range(len(plus_di))]
        
        adx = smooth(dx_list, period)[-1] if dx_list else 0
        
        if adx > self.ADX_STRONG_THRESHOLD:
            strength = 'strong'
        elif adx > self.ADX_TREND_THRESHOLD:
            strength = 'moderate'
        else:
            strength = 'weak'
        
        return {
            'adx': round(adx, 2),
            'plus_di': round(plus_di[-1], 2) if plus_di else 0,
            'minus_di': round(minus_di[-1], 2) if minus_di else 0,
            'trend_strength': strength,
            'direction': 'bullish' if (plus_di[-1] if plus_di else 0) > (minus_di[-1] if minus_di else 0) else 'bearish'
        }
    
    def calculate_roc(self, prices: List[Dict], period: int = 20) -> Dict:
        if len(prices) < period + 1:
            return {'roc': None, 'status': 'unknown'}
        
        current = prices[-1]['close']
        old = prices[-(period+1)]['close']
        roc = ((current - old) / old) * 100 if old > 0 else 0
        
        if roc > self.ROC_THRESHOLD_BULL:
            status = 'bullish'
        elif roc < self.ROC_THRESHOLD_BEAR:
            status = 'bearish'
        else:
            status = 'ranging'
        
        return {'roc': round(roc, 2), 'status': status}
    
    def _get_stock_id(self, cursor, ticker: str) -> Optional[int]:
        """Get stock_id from ticker"""
        cursor.execute('SELECT id FROM stocks WHERE ticker = ?', (ticker,))
        row = cursor.fetchone()
        return row[0] if row else None
    
    def detect_regime(self, ticker: str = 'EGX30') -> Dict:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        cursor = conn.cursor()
        
        # Check if ticker exists in stock_price_history (uses ticker column, not stock_id)
        cursor.execute('SELECT 1 FROM stock_price_history WHERE ticker = ? LIMIT 1', (ticker,))
        ticker_exists = cursor.fetchone()
        
        # Get columns in stock_price_history to handle schema variations dynamically
        cursor.execute("PRAGMA table_info(stock_price_history)")
        columns = [r[1] for r in cursor.fetchall()]
        
        has_open_price = 'open_price' in columns
        open_col = 'open_price' if has_open_price else 'open'
        high_col = 'high_price' if has_open_price else 'high'
        low_col = 'low_price' if has_open_price else 'low'
        close_col = 'close_price' if has_open_price else 'close'
        
        if ticker_exists:
            # Use ticker for query
            cursor.execute(f'''
                SELECT date, {open_col}, {high_col}, {low_col}, {close_col}, volume
                FROM stock_price_history WHERE ticker = ?
                ORDER BY date DESC LIMIT 100
            ''', (ticker,))
        else:
            # For indices like EGX30, try to get market data from any available stock
            cursor.execute(f'''
                SELECT date, {open_col}, {high_col}, {low_col}, {close_col}, volume
                FROM stock_price_history 
                ORDER BY date DESC LIMIT 100
            ''')
        
        rows = cursor.fetchall()
        conn.close()
        
        if len(rows) < 50:
            return {
                'ticker': ticker,
                'regime': 'unknown',
                'regime_ar': 'غير معروف',
                'confidence': 0,
                'reason': 'بيانات غير كافية (أقل من 50 يوم)',
                'indicators': {'adx': {'adx': None}, 'roc': {'roc': None}},
                'timestamp': datetime.now().isoformat()
            }
        
        prices = [{'date': r[0], 'open': r[1] or r[4], 'high': r[2] or r[4], 'low': r[3] or r[4], 'close': r[4], 'volume': r[5]} 
                  for r in reversed(rows)]
        
        adx = self.calculate_adx(prices)
        roc = self.calculate_roc(prices)
        
        # Determine regime
        bull = (3 if adx['adx'] and adx['adx'] > self.ADX_TREND_THRESHOLD and adx['direction'] == 'bullish' else 0)
        bear = (3 if adx['adx'] and adx['adx'] > self.ADX_TREND_THRESHOLD and adx['direction'] == 'bearish' else 0)
        bull += 2 if roc['status'] == 'bullish' else 0
        bear += 2 if roc['status'] == 'bearish' else 0
        
        if bull > bear and bull > 2:
            regime, regime_ar = 'bull_trend', 'صاعد واضح'
        elif bear > bull and bear > 2:
            regime, regime_ar = 'bear_trend', 'هابط واضح'
        else:
            regime, regime_ar = 'ranging', 'متراوح'
        
        confidence = round(max(bull, bear, 3) / 7 * 100, 1)
        
        return {
            'ticker': ticker,
            'regime': regime,
            'regime_ar': regime_ar,
            'confidence': confidence,
            'indicators': {'adx': adx, 'roc': roc},
            'timestamp': datetime.now().isoformat()
        }
    
    def detect_market_regime(self) -> Dict:
        """Detect overall market regime using EGX30 or top stocks"""
        # Try EGX30 first
        egx30_result = self.detect_regime('EGX30')
        
        if egx30_result['regime'] != 'unknown':
            return egx30_result
        
        # Fallback: analyze top liquid stocks (stock_price_history uses ticker, not stock_id)
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT ticker, COUNT(*) as cnt
            FROM stock_price_history
            GROUP BY ticker
            ORDER BY cnt DESC
            LIMIT 10
        ''')
        top_stocks = cursor.fetchall()
        conn.close()
        
        if not top_stocks:
            return {
                'ticker': 'MARKET',
                'regime': 'unknown',
                'regime_ar': 'غير معروف',
                'confidence': 0,
                'reason': 'لا توجد بيانات متاحة',
                'timestamp': datetime.now().isoformat()
            }
        
        # Analyze top stock as proxy
        top_ticker = top_stocks[0][0]
        return self.detect_regime(top_ticker)


def save_daily_regime(db_path: str = None) -> Dict:
    """
    يحسب حالة السوق اليومي ويحفظها في market_regime_log.
    يستخدم مرة واحدة يدوياً، أو كل يوم في الـ cron.
    """
    if db_path is None:
        from pathlib import Path
        db_path = str(Path(__file__).parent.parent.parent / 'db' / 'stocks.db')
    
    detector = RegimeDetector(db_path)
    result = detector.detect_market_regime()
    
    # Ensure table exists
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=True).__enter__()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS market_regime_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            regime TEXT NOT NULL,
            regime_ar TEXT,
            confidence REAL,
            ticker TEXT,
            reason TEXT,
            indicators TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Add missing columns if table already existed without them
    missing_cols = [
        'ALTER TABLE market_regime_log ADD COLUMN regime_ar TEXT',
        'ALTER TABLE market_regime_log ADD COLUMN confidence REAL',
        'ALTER TABLE market_regime_log ADD COLUMN ticker TEXT',
        'ALTER TABLE market_regime_log ADD COLUMN reason TEXT',
        'ALTER TABLE market_regime_log ADD COLUMN indicators TEXT',
    ]
    for stmt in missing_cols:
        try:
            cursor.execute(stmt)
        except Exception:
            pass
    
    # Check if today's record exists
    today = datetime.now().strftime('%Y-%m-%d')
    cursor.execute('SELECT id FROM market_regime_log WHERE date = ?', (today,))
    existing = cursor.fetchone()
    
    regime = result.get('regime', 'unknown')
    regime_ar = result.get('regime_ar', 'غير معروف')
    confidence = result.get('confidence', 0)
    ticker = result.get('ticker', 'EGX30')
    reason = result.get('reason', '')
    indicators_json = json.dumps(result.get('indicators', {}))
    
    if existing:
        cursor.execute('''
            UPDATE market_regime_log
            SET regime = ?, regime_ar = ?, confidence = ?, ticker = ?, reason = ?, indicators = ?
            WHERE date = ?
        ''', (regime, regime_ar, confidence, ticker, reason, indicators_json, today))
        action = 'updated'
    else:
        cursor.execute('''
            INSERT INTO market_regime_log (date, regime, regime_ar, confidence, ticker, reason, indicators)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (today, regime, regime_ar, confidence, ticker, reason, indicators_json))
        action = 'inserted'
    
    conn.commit()
    conn.close()
    
    return {
        'action': action,
        'date': today,
        'regime': regime,
        'regime_ar': regime_ar,
        'confidence': confidence,
        'ticker': ticker,
    }
