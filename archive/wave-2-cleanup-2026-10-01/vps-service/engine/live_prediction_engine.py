#!/usr/bin/env python3
"""
Live Prediction Engine — محرك التوقعات الحية
=============================================
يحلل كل سهم ببيانات حية ويولد توقعات للفرص الحقيقية

المصادر:
- EGXPilot: أسعار لحظية + توصيات
- stock_daily_prices: بيانات تاريخية
- data-engine.db: مؤشرات فنية + أساسية

المنطق:
1. يجلب كل الأسهم بأسعار حية
2. يحسب المؤشرات الفنية (RSI, MACD, MA, Support/Resistance)
3. يحسب درجة التدفق (Flow Score)
4. يحسب درجة القنابل (Explosive Score)
5. يولد توقعات: BUY/STRONG_BUY مع entry/target/stop

Author: M2Y Developers Team
Version: 1.0.0
"""

import os
import sys
import sqlite3
import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path
from analyzers.engine_settings import get_setting

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')


def _sf(val, default=0.0):
    if val is None: return default
    try: return float(str(val).replace('−','-').replace('،','').strip())
    except: return default


class LivePredictionEngine:
    """محرك التوقعات الحية - يحلل ويكتشف الفرص"""

    def __init__(self):
        self.stocks_db = STOCKS_DB
        self.data_engine_db = DATA_ENGINE_DB

    def _get_stocks_conn(self):
        conn = sqlite3.connect(self.stocks_db)
        conn.row_factory = sqlite3.Row
        return conn

    def _get_de_conn(self):
        if not os.path.exists(self.data_engine_db): return None
        conn = sqlite3.connect(self.data_engine_db)
        conn.row_factory = sqlite3.Row
        return conn

    def _calculate_rsi(self, prices: List[float], period: int = 14) -> float:
        """حساب RSI من الأسعار التاريخية"""
        if len(prices) < period + 1:
            return 50.0
        gains = []
        losses = []
        for i in range(1, len(prices)):
            change = prices[i] - prices[i-1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return round(rsi, 1)

    def _calculate_sma(self, prices: List[float], period: int) -> float:
        """Simple Moving Average"""
        if len(prices) < period:
            return sum(prices) / len(prices) if prices else 0
        return sum(prices[-period:]) / period

    def _calculate_ema(self, prices: List[float], period: int) -> float:
        """Exponential Moving Average"""
        if len(prices) < period:
            return self._calculate_sma(prices, period)
        multiplier = 2 / (period + 1)
        ema = self._calculate_sma(prices[:period], period)
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
        return ema

    def _calculate_macd(self, prices: List[float]) -> Dict:
        """MACD"""
        if len(prices) < 26:
            return {'macd': 0, 'signal': 0, 'histogram': 0}
        ema12 = self._calculate_ema(prices, 12)
        ema26 = self._calculate_ema(prices, 26)
        macd = ema12 - ema26
        # Signal line = EMA9 of MACD (simplified)
        signal = macd * 0.9  # Approximation
        return {
            'macd': round(macd, 4),
            'signal': round(signal, 4),
            'histogram': round(macd - signal, 4)
        }

    def _get_price_history(self, ticker: str, days: int = 60) -> List[float]:
        """جلب الأسعار التاريخية"""
        # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        # load_closes returns close prices oldest-first, filtered to > 0 — same
        # shape the previous stock_daily_prices query produced.
        from data.prices import load_closes
        return load_closes(ticker, limit=days)

    def _get_technical_from_data_engine(self, ticker: str) -> Dict:
        """جلب المؤشرات الفنية من data-engine.db"""
        conn = self._get_de_conn()
        if not conn:
            return {}
        cur = conn.cursor()
        # PILLAR-2: tab_* tables use `ticker` PRIMARY KEY (not `symbol`).
        row = cur.execute("""
            SELECT * FROM tab_technical_analysis
            WHERE ticker = ? LIMIT 1
        """, (ticker,)).fetchone()
        conn.close()
        if not row:
            return {}
        import re
        def _extract(val):
            if val is None: return None
            m = re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
            return float(m.group(1)) if m else None

        return {
            'rating': row['technical_rating'],
            'ma_rating': row['ma_rating'],
            'oscillators_rating': row['oscillators_rating'],
            'trend': _extract(row['trend']),
            'momentum': _extract(row['momentum']),
            'rsi': _extract(row['rsi']),
            'macd': _extract(row['macd']),
            'stoch': _extract(row['stoch']),
            'adx': _extract(row['adx']),
            'atr': _extract(row['atr']),
        }

    def _get_fundamentals_from_data_engine(self, ticker: str) -> Dict:
        """جلب البيانات الأساسية"""
        conn = self._get_de_conn()
        if not conn:
            return {}
        cur = conn.cursor()
        result = {}

        # Valuation
        row = cur.execute("SELECT * FROM tab_valuation WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()
        if row:
            import re
            def _extract(val):
                if val is None: return None
                m = re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
                return float(m.group(1)) if m else None
            result['pe_ratio'] = _extract(row['pe_ratio'])
            result['pb_ratio'] = _extract(row['pb_ratio'])
            result['ps_ratio'] = _extract(row['ps_ratio'])

        # Profitability
        row = cur.execute("SELECT * FROM tab_profitability WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()
        if row:
            def _extract(val):
                if val is None: return None
                m = re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
                return float(m.group(1)) if m else None
            result['gross_margin'] = _extract(row['gross_margin'])
            result['net_margin'] = _extract(row['net_margin'])
            result['roe'] = _extract(row['roe'])
            result['roa'] = _extract(row['roa'])

        # Dividends
        row = cur.execute("SELECT * FROM tab_dividends WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()
        if row:
            def _extract(val):
                if val is None: return None
                m = re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
                return float(m.group(1)) if m else None
            result['div_yield'] = _extract(row['div_yield'])

        # Performance
        row = cur.execute("SELECT * FROM tab_performance WHERE ticker = ? LIMIT 1", (ticker,)).fetchone()
        if row:
            def _extract(val):
                if val is None: return None
                m = re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
                return float(m.group(1)) if m else None
            result['perf_1w'] = _extract(row['perf_1w'])
            result['perf_1m'] = _extract(row['perf_1m'])
            result['perf_3m'] = _extract(row['perf_3m'])
            result['perf_1y'] = _extract(row['perf_1y'])

        conn.close()
        return result

    def analyze_stock(self, ticker: str) -> Optional[Dict]:
        """تحليل سهم واحد وإنشاء توقع"""
        conn = self._get_stocks_conn()
        cur = conn.cursor()
        stock = cur.execute("""
            SELECT ticker, name, name_ar, current_price, change_percent, volume,
                   sector, market_cap, pe_ratio, eps, roe
            FROM stocks WHERE ticker = ? AND current_price > 0 AND is_active = 1
        """, (ticker,)).fetchone()
        conn.close()

        if not stock:
            return None

        price = _sf(stock['current_price'])
        change = _sf(stock['change_percent'])
        volume = _sf(stock['volume'])
        name = stock['name_ar'] or stock['name'] or ticker

        # 1. Technical indicators from price history
        prices = self._get_price_history(ticker, 60)
        rsi = self._calculate_rsi(prices) if len(prices) >= 15 else 50
        sma20 = self._calculate_sma(prices, 20) if len(prices) >= 5 else price
        sma50 = self._calculate_sma(prices, 50) if len(prices) >= 10 else price
        macd = self._calculate_macd(prices)

        # 2. Support/Resistance
        if prices:
            recent_high = max(prices[-20:]) if len(prices) >= 20 else max(prices)
            recent_low = min(prices[-20:]) if len(prices) >= 20 else min(prices)
        else:
            recent_high = price * 1.05
            recent_low = price * 0.95

        support = max(recent_low, price * 0.92)
        resistance = min(recent_high, price * 1.15)

        # 3. Data from data-engine.db
        tech_de = self._get_technical_from_data_engine(ticker)
        fund = self._get_fundamentals_from_data_engine(ticker)

        # 4. Scoring (0-100)
        tech_score = get_setting('tech_score_base', default=50)
        fund_score = 50
        momentum_score = 50

        # Technical scoring
        if rsi < 30: tech_score += get_setting('live_rsi_oversold_bonus', default=20)  # Oversold = buy
        elif rsi > 70: tech_score -= get_setting('live_rsi_overbought_penalty', default=15)  # Overbought = sell
        elif 40 <= rsi <= 60: tech_score += 5

        if price > sma20 > sma50: tech_score += get_setting('live_uptrend_bonus', default=15)  # Uptrend
        elif price < sma20 < sma50: tech_score -= 10  # Downtrend

        if macd['histogram'] > 0: tech_score += get_setting('live_macd_bonus', default=10)  # MACD bullish
        elif macd['histogram'] < 0: tech_score -= 5

        if price <= support * 1.03: tech_score += 15  # Near support
        elif price >= resistance * 0.97: tech_score -= 10  # Near resistance

        # Data-engine technical rating
        if tech_de:
            rating = str(tech_de.get('rating', '')).lower()
            if 'strong buy' in rating: tech_score += 15
            elif 'buy' in rating: tech_score += 8
            elif 'sell' in rating: tech_score -= 10

        # Fundamental scoring
        pe = fund.get('pe_ratio') or _sf(stock['pe_ratio'])
        if pe and 0 < pe < 10: fund_score += 20
        elif pe and pe < 15: fund_score += 10
        elif pe and pe > 30: fund_score -= 10

        roe = fund.get('roe') or _sf(stock['roe'])
        if roe and roe > 15: fund_score += 15
        elif roe and roe > 10: fund_score += 8

        net_margin = fund.get('net_margin')
        if net_margin and net_margin > 15: fund_score += 10

        div_yield = fund.get('div_yield')
        if div_yield and div_yield > 3: fund_score += 10

        # Momentum scoring
        if change > 2: momentum_score += 20
        elif change > 0.5: momentum_score += 10
        elif change < -2: momentum_score -= 15

        perf_1w = fund.get('perf_1w')
        if perf_1w and perf_1w > 3: momentum_score += 15
        elif perf_1w and perf_1w < -5: momentum_score -= 10

        perf_1m = fund.get('perf_1m')
        if perf_1m and perf_1m > 10: momentum_score += 15
        elif perf_1m and perf_1m < -10: momentum_score -= 10

        # Clamp scores
        tech_score = max(0, min(100, tech_score))
        fund_score = max(0, min(100, fund_score))
        momentum_score = max(0, min(100, momentum_score))

        # Master score (weighted)
        master_score = (
            tech_score * get_setting('live_weight_tech', default=0.35) +
            fund_score * get_setting('live_weight_fund', default=0.30) +
            momentum_score * get_setting('live_weight_mom', default=0.25) +
            (50 if volume > 0 else 0) * get_setting('live_weight_vol', default=0.10)
        )

        # Signal
        strong_buy_thresh = get_setting('live_strong_buy_threshold', default=75)
        buy_thresh = get_setting('live_buy_threshold', default=60)
        hold_thresh = get_setting('live_hold_threshold', default=45)
        sell_thresh = get_setting('live_sell_threshold', default=30)
        if master_score >= strong_buy_thresh:
            signal = 'STRONG_BUY'
            signal_ar = 'شراء قوي'
        elif master_score >= buy_thresh:
            signal = 'BUY'
            signal_ar = 'شراء'
        elif master_score >= hold_thresh:
            signal = 'HOLD'
            signal_ar = 'تمسك'
        elif master_score >= sell_thresh:
            signal = 'SELL'
            signal_ar = 'بيع'
        else:
            signal = 'STRONG_SELL'
            signal_ar = 'بيع قوي'

        # Entry/Target/Stop (only for BUY signals)
        if signal in ('STRONG_BUY', 'BUY'):
            entry = price
            target_pct = get_setting('live_target_pct', default=10) / 100 if master_score >= strong_buy_thresh else get_setting('live_target_pct', default=10) * 0.8 / 100
            stop_pct = get_setting('live_stop_pct', default=5) / 100
            target = round(entry * (1 + target_pct), 2)
            stop = round(entry * (1 - stop_pct), 2)
            risk_reward = round(target_pct / stop_pct, 2)
            position_size = get_setting('live_position_strong', default=25) if master_score >= strong_buy_thresh else get_setting('live_position_moderate', default=15)
        else:
            entry = price
            target = None
            stop = None
            risk_reward = 0
            position_size = 0

        return {
            'ticker': ticker,
            'name': name,
            'price': round(price, 2),
            'change_percent': round(change, 2),
            'volume': int(volume),
            'sector': stock['sector'],
            'signal': signal,
            'signal_ar': signal_ar,
            'master_score': round(master_score, 1),
            'technical_score': round(tech_score, 1),
            'fundamental_score': round(fund_score, 1),
            'momentum_score': round(momentum_score, 1),
            'rsi': rsi,
            'sma20': round(sma20, 2),
            'sma50': round(sma50, 2),
            'macd': macd,
            'support': round(support, 2),
            'resistance': round(resistance, 2),
            'entry_price': entry,
            'target_price': target,
            'stop_loss': stop,
            'risk_reward': risk_reward,
            'position_size': position_size,
            'technical_rating': tech_de.get('rating'),
            'pe_ratio': pe,
            'roe': roe,
            'div_yield': div_yield,
            'perf_1w': perf_1w,
            'perf_1m': perf_1m,
            'analysis_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    def scan_market(self, min_score: float = 50) -> Dict:
        """فحص السوق كامل وإنشاء توقعات"""
        conn = self._get_stocks_conn()
        cur = conn.cursor()
        stocks = cur.execute("""
            SELECT ticker FROM stocks
            WHERE current_price > 0 AND is_active = 1
            ORDER BY (CAST(volume AS REAL) * CAST(current_price AS REAL)) DESC
            LIMIT 300
        """).fetchall()
        conn.close()

        results = []
        buy_count = 0
        strong_buy_count = 0
        errors = 0

        for row in stocks:
            ticker = row['ticker']
            try:
                analysis = self.analyze_stock(ticker)
                if analysis and analysis['master_score'] >= min_score:
                    results.append(analysis)
                    if analysis['signal'] == 'BUY':
                        buy_count += 1
                    elif analysis['signal'] == 'STRONG_BUY':
                        strong_buy_count += 1
            except Exception as e:
                errors += 1
                logger.debug(f"Error analyzing {ticker}: {e}")

        # Sort by master_score
        results.sort(key=lambda x: x['master_score'], reverse=True)

        return {
            'success': True,
            'total_analyzed': len(stocks),
            'total_opportunities': len(results),
            'buy_count': buy_count,
            'strong_buy_count': strong_buy_count,
            'errors': errors,
            'predictions': results,
            'scan_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    def get_top_opportunities(self, limit: int = 20) -> List[Dict]:
        """أفضل الفرص فقط"""
        result = self.scan_market(min_score=55)
        return result['predictions'][:limit]

    def save_predictions(self, predictions: List[Dict]) -> int:
        """حفظ التوقعات في cached_analysis"""
        conn = self._get_stocks_conn()
        cur = conn.cursor()
        saved = 0
        for p in predictions:
            try:
                cur.execute('''
                    INSERT OR REPLACE INTO cached_analysis
                        (ticker, current_price, signal, confidence, master_score,
                         technical_score, fundamental_score, target_price, stop_loss,
                         risk_level, trend, updated_at, analysis_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                ''', (
                    p['ticker'], p['price'], p['signal'], p['master_score'],
                    p['master_score'], p['technical_score'], p['fundamental_score'],
                    p.get('target_price'), p.get('stop_loss'),
                    'low' if p['master_score'] >= 70 else 'medium',
                    'bullish' if p['master_score'] >= 60 else 'neutral',
                ))
                saved += 1
            except Exception as e:
                logger.debug(f"Error saving {p['ticker']}: {e}")
        conn.commit()
        conn.close()
        return saved
