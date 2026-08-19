#!/usr/bin/env python3
"""
Smart Confluence Engine - محرك التحليل الموحد
يستخدم بيانات TradingView من data_engine.db

يدعم الأسواق:
  - السعودية (Tadawul)
  - مصر (EGX)
  - الكويت (KSE)
  - قطر (QSE)
  - العملات الرقمية (Crypto)
"""

import os
import sys
import json
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

try:
    from risk_management_advanced import (
        calculate_dynamic_stop_loss,
        calculate_dynamic_targets,
        calculate_dynamic_trailing_stop,
        calculate_dynamic_rr,
    )
except ImportError:
    calculate_dynamic_stop_loss = None
    calculate_dynamic_targets = None
    calculate_dynamic_trailing_stop = None
    calculate_dynamic_rr = None

try:
    from engines.market_regime import get_index_stage
except ImportError:
    try:
        from .market_regime import get_index_stage
    except ImportError:
        def get_index_stage(index_symbol="EGX30", target_date=None, lookback=300):
            return {"stage": 1, "reason": "Fallback", "close": 0.0, "sma200": 0.0}

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
STOCKS_DB = os.path.join(PROJECT_ROOT, 'db', 'stocks.db')
PRICE_HISTORY_DB = os.path.join(PROJECT_ROOT, 'db', 'price_history.db')

# ---------------------------------------------------------------------------
# خريطة شاملة لكل أسماء الأسواق (database → canonical)
# ---------------------------------------------------------------------------
MARKET_MAP = {
    # السعودية (Tadawul)
    'SA': 'السعودية', 'السعودية': 'السعودية', 'TADAWUL': 'السعودية', 'KSA': 'السعودية',
    # مصر
    'EGX': 'مصر', 'egx': 'مصر', 'مصر': 'مصر',
    # الكويت
    'KW': 'الكويت', 'الكويت': 'الكويت', 'KSE': 'الكويت',
    # قطر
    'QA': 'قطر', 'قطر': 'قطر', 'QSE': 'قطر',
    # العملات الرقمية (Crypto)
    'CRYPTO': 'العملات الرقمية', 'العملات الرقمية': 'العملات الرقمية',
}

# الأسواق التي لا يوجد لها جدول stocks (تعتمد كلياً على historical_data)
NON_STOCK_MARKETS = {'العملات الرقمية'}


def _safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        s = str(val).replace('%', '').replace(',', '').replace('SAR', '').replace('EGP', '').strip()
        return float(s) if s and s != '' else default
    except (ValueError, TypeError):
        return default


class SmartConfluenceEngine:
    """محرك التحليل الموحد - يحسب درجة توحيدية من البيانات الفنية والأساسية"""

    def __init__(self):
        self.data_engine_db = DATA_ENGINE_DB
        self.predictions_db = PREDICTIONS_DB
        self.stocks_db = STOCKS_DB
        self.price_history_db = PRICE_HISTORY_DB

    def _conn(self, db_path):
        c = sqlite3.connect(db_path, timeout=15.0)
        c.row_factory = sqlite3.Row
        return c

    def get_all_stocks(self) -> List[Dict]:
        """جلب كل الأسهم المتاحة"""
        try:
            conn = self._conn(self.data_engine_db)
            rows = conn.execute(
                "SELECT symbol, name, price, change_percent, volume, market_cap, market, sector "
                "FROM stocks ORDER BY market, symbol"
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception:
            try:
                conn = self._conn(self.stocks_db)
                rows = conn.execute(
                    "SELECT ticker as symbol, name, current_price as price, 0 as change_percent, "
                    "volume, market_cap, market, sector FROM stocks ORDER BY market, ticker"
                ).fetchall()
                conn.close()
                return [dict(r) for r in rows]
            except Exception:
                return []

    def _resolve_market(self, market: str) -> str:
        """تحويل اسم السوق إلى الصيغة المخزنة في قاعدة البيانات"""
        return MARKET_MAP.get(market, market)

    def get_stock_full_data(self, symbol: str, market: str = None) -> Optional[Dict]:
        """جلب البيانات الكاملة لسهم/أصل واحد (يدعم كل الأسواق)"""
        # 1) حاول stocks في data_engine.db أولاً
        try:
            conn = self._conn(self.data_engine_db)
            stock = conn.execute("SELECT * FROM stocks WHERE symbol=?", (symbol,)).fetchone()
            if stock:
                result = dict(stock)
                for table in ['tab_technical_analysis', 'tab_valuation', 'tab_profitability', 'tab_dividends']:
                    try:
                        row = conn.execute(f"SELECT * FROM {table} WHERE symbol=?", (symbol,)).fetchone()
                        result[table] = dict(row) if row else {}
                    except Exception:
                        result[table] = {}
                conn.close()
                return result
            conn.close()
        except Exception:
            pass

        # 2) حاول stocks.db → stocks
        try:
            conn2 = sqlite3.connect(self.stocks_db, timeout=10.0)
            stock2 = conn2.execute(
                "SELECT ticker as symbol, name as name, market, sector, current_price as price, "
                "pe_ratio, pb_ratio, roe, roa, volume, market_cap "
                "FROM stocks WHERE ticker=?", (symbol,)
            ).fetchone()
            if stock2:
                result = dict(stock2)
                conn2.close()
                conn.close()
                return result
            conn2.close()
        except Exception:
            pass

        conn.close()

        # 3) لغير الأسهم (ذهب، عملات، إلخ) → نبني data minimal من historical_data
        if market:
            db_market = self._resolve_market(market)
            try:
                conn = self._conn(self.data_engine_db)
                row = conn.execute(
                    "SELECT symbol, name, market FROM historical_data WHERE symbol=? AND market=? LIMIT 1",
                    (symbol, db_market)
                ).fetchone()
                if row:
                    result = dict(row)
                    conn.close()
                    return result
                conn.close()
            except Exception:
                pass

        return None

    def get_historical_prices(self, symbol: str, market: str,
                              before_date: str = None, limit: int = 100) -> List[Dict]:
        """جلب historical prices - يجرب data_engine أولاً ثم stocks.db و gold_prices.db كـ fallback"""
        db_market = MARKET_MAP.get(market, market)

        # Try data_engine.db first (historical_data table)
        try:
            conn = self._conn(self.data_engine_db)
            if before_date:
                rows = conn.execute(
                    "SELECT date,open,high,low,close,volume FROM historical_data "
                    "WHERE symbol=? AND market=? AND date<=? ORDER BY date DESC LIMIT ?",
                    (symbol, db_market, before_date, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT date,open,high,low,close,volume FROM historical_data "
                    "WHERE symbol=? AND market=? ORDER BY date DESC LIMIT ?",
                    (symbol, db_market, limit)
                ).fetchall()
            conn.close()
            if rows:
                return [dict(r) for r in reversed(rows)]
        except Exception:
            pass

        # Fallback: price_history.db
        try:
            conn = self._conn(self.price_history_db)
            if before_date:
                rows = conn.execute(
                    "SELECT date, open_price as open, high_price as high, low_price as low, "
                    "close_price as close, volume FROM price_history "
                    "WHERE ticker=? AND date<=? ORDER BY date DESC LIMIT ?",
                    (symbol, before_date, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT date, open_price as open, high_price as high, low_price as low, "
                    "close_price as close, volume FROM price_history "
                    "WHERE ticker=? ORDER BY date DESC LIMIT ?",
                    (symbol, limit)
                ).fetchall()
            conn.close()
            if rows:
                return [dict(r) for r in reversed(rows)]
        except Exception:
            pass

        # Fallback: stocks.db → stock_price_history
        try:
            conn = sqlite3.connect(self.stocks_db, timeout=10.0)
            if before_date:
                rows = conn.execute(
                    "SELECT date, open_price as open, high_price as high, low_price as low, "
                    "close_price as close, volume FROM stock_price_history "
                    "WHERE ticker=? AND date<=? ORDER BY date DESC LIMIT ?",
                    (symbol, before_date, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT date, open_price as open, high_price as high, low_price as low, "
                    "close_price as close, volume FROM stock_price_history "
                    "WHERE ticker=? ORDER BY date DESC LIMIT ?",
                    (symbol, limit)
                ).fetchall()
            conn.close()
            if rows:
                return [dict(r) for r in reversed(rows)]
        except Exception:
            pass

        return []

    def get_available_dates(self, market: str = None) -> List[str]:
        """جلب التواريخ المتاحة - يجمع من كل قواعد البيانات"""
        dates = set()
        db_market = self._resolve_market(market) if market else None

        # From data_engine.db historical_data
        try:
            conn = self._conn(self.data_engine_db)
            if db_market:
                rows = conn.execute(
                    "SELECT DISTINCT date FROM historical_data WHERE market=? ORDER BY date",
                    (db_market,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT DISTINCT date FROM historical_data ORDER BY date"
                ).fetchall()
            for r in rows:
                dates.add(r['date'])
            conn.close()
        except Exception:
            pass

        # From price_history.db
        try:
            conn = self._conn(self.price_history_db)
            rows = conn.execute("SELECT DISTINCT date FROM price_history ORDER BY date").fetchall()
            for r in rows:
                dates.add(r['date'])
            conn.close()
        except Exception:
            pass

        # From stocks.db stock_price_history
        try:
            conn = sqlite3.connect(self.stocks_db, timeout=10.0)
            rows = conn.execute("SELECT DISTINCT date FROM stock_price_history ORDER BY date").fetchall()
            for r in rows:
                dates.add(r['date'])
            conn.close()
        except Exception:
            pass

        return sorted(dates)

    def get_stocks_at_date(self, date: str, market: str = None) -> List[str]:
        """جلب الرموز المتاحة بتاريخ محدد لكل الأسواق"""
        symbols = set()
        db_market = self._resolve_market(market) if market else None

        # ── 1) historical_data (data_engine.db) ──────────────────────
        try:
            conn = self._conn(self.data_engine_db)
            if db_market:
                rows = conn.execute(
                    "SELECT DISTINCT symbol FROM historical_data WHERE market=? AND date=?",
                    (db_market, date)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT DISTINCT symbol FROM historical_data WHERE date=?",
                    (date,)
                ).fetchall()
            for r in rows:
                symbols.add(r['symbol'])
            conn.close()
        except Exception:
            pass

        # ── 2) price_history.db (أسواق الأسهم) ──────────────────────
        try:
            conn = self._conn(self.price_history_db)
            rows = conn.execute(
                "SELECT DISTINCT ticker FROM price_history WHERE date=?",
                (date,)
            ).fetchall()
            for r in rows:
                symbols.add(r['ticker'])
            conn.close()
        except Exception:
            pass

        # ── 3) stocks.db → stock_price_history (fallback) ────────────
        try:
            conn = sqlite3.connect(self.stocks_db, timeout=10.0)
            rows = conn.execute(
                "SELECT DISTINCT ticker FROM stock_price_history WHERE date=?",
                (date,)
            ).fetchall()
            for r in rows:
                symbols.add(r['ticker'])
            conn.close()
        except Exception:
            pass

        # ── 4) تصفية حسب السوق ───────────────────────────────────────
        if db_market and symbols:
            if db_market in NON_STOCK_MARKETS:
                # الأسواق غير المخزنة في stocks → ابقِ Historical_data فقط
                try:
                    conn = self._conn(self.data_engine_db)
                    dh_rows = conn.execute(
                        "SELECT DISTINCT symbol FROM historical_data WHERE market=?",
                        (db_market,)
                    ).fetchall()
                    conn.close()
                    valid = {r['symbol'] for r in dh_rows}
                    symbols = symbols & valid if valid else symbols
                except Exception:
                    pass
            else:
                # أسواق الأسهم → تصفية باستخدام stocks
                try:
                    conn = self._conn(self.data_engine_db)
                    rows = conn.execute(
                        "SELECT symbol FROM stocks WHERE market=?",
                        (db_market,)
                    ).fetchall()
                    market_symbols = {r['symbol'] for r in rows}
                    conn.close()
                    # أيضاً من stocks.db
                    try:
                        conn2 = sqlite3.connect(self.stocks_db, timeout=10.0)
                        # Map Arabic market names to English codes for stocks.db
                        mkt_code = {'السعودية': 'TADAWUL', 'مصر': 'EGX', 'الكويت': 'KSE', 'قطر': 'QSE'}.get(db_market, market.upper())
                        rows2 = conn2.execute(
                            "SELECT ticker FROM stocks WHERE market=?", (mkt_code,)
                        ).fetchall()
                        conn2.close()
                        market_symbols.update(r['ticker'] for r in rows2)
                    except Exception:
                        pass
                    symbols = symbols & market_symbols
                except Exception:
                    pass

        return list(symbols)

    def compute_rsi(self, closes: List[float], period: int = 14) -> float:
        """حساب RSI"""
        if len(closes) < period + 1:
            return 50.0
        gains, losses = [], []
        for i in range(1, len(closes)):
            diff = closes[i] - closes[i - 1]
            gains.append(max(0, diff))
            losses.append(max(0, -diff))
        if len(gains) < period:
            return 50.0
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100 - (100 / (1 + rs)), 2)

    def compute_macd(self, closes: List[float]) -> Dict:
        """حساب MACD مبسط"""
        if len(closes) < 26:
            return {'macd': 0, 'signal': 'NEUTRAL', 'histogram': 0}

        def ema(data, period):
            k = 2 / (period + 1)
            result = [data[0]]
            for i in range(1, len(data)):
                result.append(data[i] * k + result[-1] * (1 - k))
            return result

        ema12 = ema(closes, 12)
        ema26 = ema(closes, 26)
        macd_line = [a - b for a, b in zip(ema12, ema26)]
        signal_line = ema(macd_line, 9)

        macd_val = macd_line[-1]
        sig_val = signal_line[-1]
        hist = macd_val - sig_val

        if macd_val > sig_val and hist > 0:
            signal = 'BULLISH'
        elif macd_val < sig_val and hist < 0:
            signal = 'BEARISH'
        else:
            signal = 'NEUTRAL'

        return {'macd': round(macd_val, 4), 'signal': signal, 'histogram': round(hist, 4)}

    def compute_moving_averages(self, closes: List[float]) -> Dict:
        """حساب المتوسطات المتحركة"""
        result = {}
        for period in [20, 50, 200]:
            if len(closes) >= period:
                ma = sum(closes[-period:]) / period
                result[f'sma{period}'] = round(ma, 4)
            else:
                result[f'sma{period}'] = None
        return result

    def analyze(self, symbol: str, target_date: str = None, market_hint: str = None) -> Optional[Dict]:
        """
        تحليل سهم/أصل واحد وحساب درجة التوحيد
        يدعم كل الأسواق (السعودية، مصر، الكويت، قطر، العملات الرقمية)

        Args:
            symbol: رمز الأصل (مثل COMI, 2222, BTC)
            target_date: تاريخ التحليل (اختياري)
            market_hint: تلميح للسوق (اختياري، يحسن سرعة البحث)
        """
        data = self.get_stock_full_data(symbol, market_hint)
        if not data:
            return None

        market = data.get('market', market_hint or '')
        db_market = self._resolve_market(market) if market else None
        is_non_stock = db_market in NON_STOCK_MARKETS if db_market else False

        prices = self.get_historical_prices(symbol, market, target_date, 100)
        if not prices:
            return None

        closes = [float(p['close']) for p in prices if p.get('close')]
        if len(closes) < 10:
            return None

        current_price = closes[-1]

        # ====================================================================
        # Technical Score (من RSI + MACD + MA)
        # ====================================================================
        tech = data.get('tab_technical_analysis', {})

        # RSI
        rsi = self.compute_rsi(closes)
        rsi_score = 25 if rsi < 30 else 20 if rsi < 40 else 15 if rsi < 50 else 10 if rsi < 60 else 5 if rsi < 70 else 0

        # MACD
        macd = self.compute_macd(closes)
        macd_score = 25 if macd['signal'] == 'BULLISH' else 0 if macd['signal'] == 'NEUTRAL' else -5

        # MA trend
        mas = self.compute_moving_averages(closes)
        ma_score = 10
        if mas.get('sma20') and mas.get('sma50'):
            if current_price > mas['sma20'] > mas['sma50']:
                ma_score = 20
            elif current_price < mas['sma20'] < mas['sma50']:
                ma_score = 0

        # Technical rating (فقط للأسهم)
        tech_rating = str(tech.get('technical_rating', '') or '')
        rating_score = 10
        if 'شراء قوي' in tech_rating:
            rating_score = 20
        elif 'شراء' in tech_rating:
            rating_score = 15
        elif 'بيع قوي' in tech_rating:
            rating_score = 0
        elif 'بيع' in tech_rating:
            rating_score = 5

        technical_score = max(0, min(100, rsi_score + macd_score + ma_score + rating_score))

        # ====================================================================
        # Fundamental Score - 0 للأسواق غير التقليدية (ذهب، عملات، إلخ)
        # ====================================================================
        if is_non_stock:
            # الأصول غير التقليدية → ما عندها fundamental
            fundamental_score = 40  # قيمة افتراضية وسط
            pe = None
            roe = None
            pe_score = 0
            roe_score = 0
            margin_score = 0
        else:
            val = data.get('tab_valuation', {})
            prof = data.get('tab_profitability', {})

            pe = _safe_float(val.get('pe_ratio'))
            roe = _safe_float(prof.get('roe'))
            net_margin = _safe_float(prof.get('net_margin'))

            pe_score = 30 if 0 < pe < 10 else 20 if 0 < pe < 20 else 10 if 0 < pe < 40 else 5
            roe_score = 25 if roe > 20 else 20 if roe > 15 else 15 if roe > 10 else 10 if roe > 5 else 5
            margin_score = 20 if net_margin > 15 else 15 if net_margin > 10 else 10 if net_margin > 5 else 5

            fundamental_score = max(0, min(100, pe_score + roe_score + margin_score))

        # ====================================================================
        # Volume & Seasonal Score
        # ====================================================================
        vol_score = 50
        if len(prices) > 10:
            recent_vol = [float(p.get('volume', 0) or 0) for p in prices[-10:]]
            avg_recent = sum(recent_vol) / len(recent_vol) if recent_vol else 0
            if len(prices) > 20:
                older_vol = [float(p.get('volume', 0) or 0) for p in prices[-20:-10]]
                avg_older = sum(older_vol) / len(older_vol) if older_vol else 1
                if avg_older > 0:
                    vol_change = (avg_recent - avg_older) / avg_older
                    vol_score += int(vol_change * 20)

        # Seasonality
        month = datetime.now().month if not target_date else int(target_date.split('-')[1])
        seasonal_bonus = {1: 5, 2: 3, 3: 5, 4: 10, 5: 10, 6: 5, 7: 0, 8: -5, 9: 0, 10: 5, 11: 10, 12: 15}
        vol_score += seasonal_bonus.get(month, 0)
        vol_score = max(0, min(100, vol_score))

        # ====================================================================
        # Confluence Score (نسبة مختلفة للأسواق غير التقليدية)
        # ====================================================================
        if is_non_stock:
            # غير تقليدي → تركيز أكبر على التحليل الفني
            confluence = int(technical_score * 0.55 + fundamental_score * 0.15 + vol_score * 0.25)
        else:
            confluence = int(technical_score * 0.4 + fundamental_score * 0.3 + vol_score * 0.2)

        # EGX30 Market Regime Veto / Modifier
        egx30_stage_info = None
        if db_market == 'مصر':
            try:
                egx30_stage_info = get_index_stage("EGX30", target_date)
                stage = egx30_stage_info.get("stage", 1)
                if stage == 4:
                    # Bear market penalty
                    confluence = max(0, confluence - 20)
                elif stage == 2:
                    # Bull market bonus
                    confluence = min(100, confluence + 5)
            except Exception as e:
                print(f"Error applying EGX30 regime: {e}")

        # ====================================================================
        # Determine Signal
        # ====================================================================
        if confluence >= 75:
            signal = 'STRONG BUY'
        elif confluence >= 65:
            signal = 'BUY'
        elif confluence >= 55:
            signal = 'ACCUMULATE'
        elif confluence >= 45:
            signal = 'HOLD'
        elif confluence >= 35:
            signal = 'REDUCE'
        elif confluence >= 25:
            signal = 'SELL'
        else:
            signal = 'STRONG SELL'

        # Override based on RSI
        # مراجعة (يوليو 2026): RSI > 75 بقى SELL (مش بس 80) عشان حساسية أعلى
        if rsi < 25:
            signal = 'BUY' if confluence < 75 else signal
        if rsi > 75:
            # SELL عند تشبع شرائي قوي، بشرط إن السهم مش ضعيف جداً (confluence > 20)
            if confluence > 20:
                signal = 'SELL'
            # لو confluence ≤ 20 والسهم ضعيف + RSI مرتفع = STRONG SELL
            else:
                signal = 'STRONG SELL'

        # EGX30 Bear Market Veto (منطق كبار المضاربين)
        # مراجعة (يوليو 2026): في bear market، حتى HOLD بقى REDUCE و ACCUMULATE بقى SELL
        # قبل: BUY/STRONG_BUY → HOLD فقط
        # بعد: BUY/STRONG_BUY → REDUCE | HOLD/ACCUMULATE → SELL (أقرب للواقع في bear)
        if db_market == 'مصر' and egx30_stage_info and egx30_stage_info.get("stage") == 4:
            if signal in ['STRONG BUY', 'BUY']:
                signal = 'REDUCE'
            elif signal in ['ACCUMULATE', 'HOLD']:
                signal = 'SELL'

        # ====================================================================
        # Target & Stop Loss (ديناميكي بناءً على ATR بدل نسب ثابتة)
        # ====================================================================
        highs = [float(p.get('high', 0) or 0) for p in prices if p.get('high')]
        lows = [float(p.get('low', 0) or 0) for p in prices if p.get('low')]

        # حساب ATR من البيانات التاريخية
        atr_value = None
        if highs and lows and len(highs) >= 14 and len(lows) >= 14:
            atr_values = []
            for i in range(1, 15):
                tr = max(
                    highs[-i] - lows[-i],
                    abs(highs[-i] - (closes[-i - 1] if i < len(closes) else highs[-i])),
                    abs(lows[-i] - (closes[-i - 1] if i < len(closes) else lows[-i])),
                )
                atr_values.append(tr)
            if atr_values:
                atr_value = sum(atr_values) / len(atr_values)

        if db_market == 'العملات الرقمية':
            stop_multiplier = 2.5
            target_multiplier_base = 1.5
        else:
            stop_multiplier = 2.0
            target_multiplier_base = 1.5

        if signal in ['STRONG BUY', 'BUY', 'ACCUMULATE']:
            stop_mult = stop_multiplier
            target_mult = target_multiplier_base + (confluence / 1000) * 1.5
        elif signal in ['SELL', 'REDUCE']:
            stop_mult = stop_multiplier * 0.75
            target_mult = target_multiplier_base * 0.5
        else:
            stop_mult = stop_multiplier * 1.2
            target_mult = target_multiplier_base * 0.6

        # حساب وقف خسارة ديناميكي
        if calculate_dynamic_stop_loss:
            stop_result = calculate_dynamic_stop_loss(
                entry_price=current_price,
                closes=closes,
                highs=highs,
                lows=lows,
                atr=atr_value,
                atr_period=14,
                multiplier=stop_mult,
                symbol=symbol,
                market=db_market,
            )
            stop_loss = stop_result['stop_price']
        else:
            # Fallback: ATR-based stop using recent price range
            recent_range = max(closes[-10:]) - min(closes[-10:]) if len(closes) >= 10 else current_price * 0.03
            fallback_atr = recent_range / 2
            fallback_stop_distance = stop_mult * fallback_atr
            stop_loss = round(current_price - fallback_stop_distance, 4)
            min_stop = current_price * 0.97
            stop_loss = round(max(stop_loss, min_stop), 4)

        # حساب أهداف ربح ديناميكية
        if calculate_dynamic_targets:
            regime = 'bull' if (egx30_stage_info and egx30_stage_info.get("stage") == 2) else \
                     'bear' if (egx30_stage_info and egx30_stage_info.get("stage") == 4) else 'ranging'
            target_result = calculate_dynamic_targets(
                entry_price=current_price,
                stop_price=stop_loss,
                closes=closes,
                highs=highs,
                lows=lows,
                atr=atr_value,
                atr_period=14,
                regime=regime,
            )
            target_price = target_result['targets'][0]['price'] if target_result.get('targets') else current_price * (1 + target_mult)
        else:
            # Fallback: ATR-based target using recent price range
            recent_range = max(closes[-10:]) - min(closes[-10:]) if len(closes) >= 10 else current_price * 0.03
            fallback_atr = recent_range / 2
            fallback_target_distance = target_mult * fallback_atr
            target_price = round(current_price + fallback_target_distance, 4)

        confidence = min(95, max(20, confluence + 5))

        # اسم الأصل
        name = str(data.get('name', data.get('name_ar', symbol)))

        return {
            'symbol': symbol,
            'name': name,
            'market': market,
            'signal': signal,
            'confidence': confidence,
            'entry_price': round(current_price, 4),
            'target_price': target_price,
            'stop_loss': stop_loss,
            'technical_score': technical_score,
            'fundamental_score': fundamental_score,
            'volume_seasonal_score': vol_score,
            'confluence_score': confluence,
            'rsi': rsi,
            'macd_signal': macd['signal'],
            'pe_ratio': pe if pe and pe > 0 else None,
            'roe': roe if roe and roe > 0 else None,
            'technical_rating': tech_rating,
            'phase_scores': {
                'technical': {'rsi_score': rsi_score, 'macd_score': macd_score, 'ma_score': ma_score, 'rating_score': rating_score},
                'fundamental': {'pe_score': pe_score, 'roe_score': roe_score, 'margin_score': margin_score},
                'volume_seasonal': {'volume': vol_score, 'seasonal_bonus': seasonal_bonus.get(month, 0)}
            }
        }

# Global instance
_engine = None

def get_engine() -> SmartConfluenceEngine:
    global _engine
    if _engine is None:
        _engine = SmartConfluenceEngine()
    return _engine