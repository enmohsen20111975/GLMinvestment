#!/usr/bin/env python3
"""
V3 Backtest Engine — بنا جديد بالكامل على المعمارية الحديثة
================================================================
ALPHA (2026-10-30): محرك backtest حقيقي يـ simulate V3 predictor
على بيانات تاريخية فعلية.

الـ features:
1. بـ يستخدم V3 stack الحقيقي (orchestrator_v3 + executor_v3)
2. بـ يقرأ البيانات من stocks.db + data_engine.db (DAL)
3. بـ يـ simulate كل يوم تداول كأنه V3 بيشتغل فيه
4. بـ يحسب النتائج الفعلية (entry/exit/pnl/holding_days)
5. بـ يـ generate تقرير شامل (Markdown + JSON)

الـ usage:
  python3 vps-service/scripts/v3_backtest.py --market EGX --start 2025-09-22 --end 2026-10-25
  python3 vps-service/scripts/v3_backtest.py --market EGX --start 2026-01-01 --end 2026-06-30 --max-tickers 50
  python3 v3-service/scripts/v3_backtest.py --market EGX --start 2026-01-01 --end 2026-06-30 --dry-run

المتطلبات:
  - stocks.db في db/ (مع stock_daily_prices)
  - vps-service/core/orchestrator_v3.py + executor_v3.py
"""

from __future__ import annotations
import os
import sys
import json
import sqlite3
import argparse
import logging
from datetime import datetime, timedelta
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple
from collections import defaultdict

# ============================================================
# Paths
# ============================================================
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

# Add vps-service to path
sys.path.insert(0, str(VPS_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('V3Backtest')


# ============================================================
# Types
# ============================================================

@dataclass
class BacktestTrade:
    """صفقة واحدة في الـ backtest."""
    ticker: str
    market: str
    signal_date: str
    signal: str
    entry_price: float
    target_price: float
    stop_loss: float
    master_score: float
    confidence: float
    state_code: str
    # النتيجة الفعلية:
    exit_price: float = 0.0
    exit_date: str = ''
    exit_reason: str = 'pending'  # target_hit / stop_hit / timeout / still_open
    pnl_pct: float = 0.0
    holding_days: int = 0
    max_favorable_pct: float = 0.0  # أعلى ربح وصل له
    max_adverse_pct: float = 0.0   # أكبر خسارة وصل لها
    # ALPHA-DYNAMIC: بيانات إضافية من V3 risk_profile
    atr: float = 0.0
    atr_pct: float = 0.0
    support: float = 0.0
    resistance: float = 0.0
    method: str = 'static'  # static / ATR+support/resistance (dynamic)


@dataclass
class BacktestResult:
    """نتيجة الـ backtest الكاملة."""
    market: str
    start_date: str
    end_date: str
    total_tickers_tested: int = 0
    total_trades: int = 0
    closed_trades: int = 0
    open_trades: int = 0
    # الإحصائيات:
    wins: int = 0
    losses: int = 0
    target_hits: int = 0
    stop_hits: int = 0
    timeouts: int = 0
    # الأداء:
    total_return_pct: float = 0.0
    avg_return_pct: float = 0.0
    win_rate: float = 0.0
    avg_holding_days: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    # trades:
    trades: List[BacktestTrade] = field(default_factory=list)


# ============================================================
# Data Loader — بـ يقرأ البيانات التاريخية
# ============================================================

class HistoricalDataLoader:
    """بـ يحمل البيانات التاريخية من stocks.db + data_engine.db."""

    def __init__(self, stocks_db: Path, data_engine_db: Path):
        self.stocks_db = stocks_db
        self.data_engine_db = data_engine_db
        self._cache: Dict[str, List[dict]] = {}

    def get_tickers(self, market: str) -> List[str]:
        """جيب كل tickers لسوق معين."""
        conn = sqlite3.connect(str(self.stocks_db))
        cur = conn.cursor()
        if market == 'EGX':
            # egksco_price_history فيه بيانات EGX حقيقية
            conn2 = sqlite3.connect(str(self.data_engine_db))
            cur2 = conn2.cursor()
            cur2.execute("""
                SELECT DISTINCT symbol FROM egksco_price_history
                WHERE close_price IS NOT NULL AND close_price > 0
                ORDER BY symbol
            """)
            tickers = [r[0] for r in cur2.fetchall()]
            conn2.close()
        else:
            cur.execute("""
                SELECT DISTINCT ticker FROM stock_daily_prices
                WHERE market = ? AND close IS NOT NULL AND close > 0
                ORDER BY ticker
            """, (market,))
            tickers = [r[0] for r in cur.fetchall()]
        conn.close()
        return tickers

    def get_price_history(self, ticker: str, market: str, start_date: str, end_date: str) -> List[dict]:
        """جيب تاريخ الأسعار لـ ticker معين.

        Returns:
            list of dicts: [{date, open, high, low, close, volume}, ...]
            مرتبة من الأقدم للأحدث.
        """
        cache_key = f"{ticker}_{market}_{start_date}_{end_date}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        if market == 'EGX':
            # egksco_price_history فيه OHLCV + buy/sell volume
            conn = sqlite3.connect(str(self.data_engine_db))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("""
                SELECT price_date as date, open_price as open, high_price as high,
                       low_price as low, close_price as close, volume,
                       buy_volume, sell_volume, delta_volume, pressure
                FROM egksco_price_history
                WHERE symbol = ? AND price_date >= ? AND price_date <= ?
                  AND close_price IS NOT NULL AND close_price > 0
                ORDER BY price_date ASC
            """, (ticker, start_date, end_date))
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
        else:
            # stock_daily_prices
            conn = sqlite3.connect(str(self.stocks_db))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("""
                SELECT price_date as date, open, high, low, close, volume
                FROM stock_daily_prices
                WHERE ticker = ? AND market = ? AND price_date >= ? AND price_date <= ?
                  AND close IS NOT NULL AND close > 0
                ORDER BY price_date ASC
            """, (ticker, market, start_date, end_date))
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()

        self._cache[cache_key] = rows
        return rows


# ============================================================
# V3 Simulator — بـ يـ simulate V3 على كل يوم
# ============================================================

class V3Simulator:
    """بـ يـ simulate V3 predictor على بيانات تاريخية."""

    def __init__(self):
        self._orchestrator = None
        self._executor = None
        self._initialized = False

    def _initialize(self):
        """Lazy import لـ V3 modules."""
        if self._initialized:
            return
        try:
            from core.orchestrator_v3 import create_v3_plan, classify_regime
            from core.executor_v3 import execute_v3
            self._create_v3_plan = create_v3_plan
            self._classify_regime = classify_regime
            self._execute_v3 = execute_v3
            self._initialized = True
            logger.info("✓ V3 modules loaded (orchestrator_v3 + executor_v3)")
        except ImportError as e:
            logger.error(f"✗ Failed to import V3 modules: {e}")
            raise

    def analyze_day(self, ticker: str, market: str,
                    prices: List[float], volumes: List[float],
                    highs: List[float] = None, lows: List[float] = None,
                    opens: List[float] = None) -> Optional[dict]:
        """بـ يحلل سهم واحد في يوم واحد.

        Args:
            ticker: رمز السهم
            market: السوق
            prices: أسعار الإغلاق (آخرها في النهاية)
            volumes: أحجام التداول
            highs: أعلى الأسعار (optional)
            lows: أدنى الأسعار (optional)
            opens: أسعار الافتتاح (optional)

        Returns:
            dict with: signal, entry_price, target_price, stop_loss,
                       master_score, confidence, state_code
            أو None لو مفيش بيانات كفاية.
        """
        self._initialize()

        if not prices or len(prices) < 20:
            return None

        try:
            # 1. classify regime (بـ يـ حدد S1-S11)
            market_regime, state_code = self._classify_regime(prices, volumes)

            # 2. create plan (note: create_v3_plan بـ يطلب 50 يوم، بس بنعديها 20 عشان الـ backtest)
            # لو أقل من 50 → بـ ترجع no_trade. فـ لازم نـ patch هنا.
            plan = self._create_v3_plan(
                ticker=ticker,
                market=market,
                prices=prices,
                volumes=volumes,
            )

            # لو V3 قال no_trade بسبب نقص بيانات (< 50)، نـ try بـ classify + manual execute
            if plan.decision_policy == 'no_trade' and 'insufficient' in (plan.no_trade_reason or ''):
                # Fallback: نحلل بـ 20 يوم بس
                from core.orchestrator_v3 import normalize_weights, RAW_WEIGHTS
                state_code = state_code or 'S9'
                raw = RAW_WEIGHTS.get(state_code, RAW_WEIGHTS['S9'])
                available = ['TREND', 'MOM', 'MR', 'BRK', 'FLOW']
                weights = normalize_weights(raw, available)
                if not weights:
                    return None
                # بناء plan يدوياً
                from core.orchestrator_v3 import V3Plan
                plan = V3Plan(
                    ticker=ticker, market=market, state_code=state_code,
                    market_regime=market_regime, stock_regime=state_code,
                    available_families=available, normalized_weights=weights,
                    selected_engines=['technical', 'breakout_signal', 'candlestick', 'smc_engine', 'liquidity_filter'],
                    skipped_engines=[], execution_order=['FLOW', 'TREND', 'MOM', 'MR', 'BRK'],
                    decision_policy='partial',
                )

            if plan.decision_policy == 'no_trade':
                return None

            # 3. execute
            result = self._execute_v3(
                plan, prices=prices, volumes=volumes,
                ticker=ticker, market=market,
                highs=highs, lows=lows, opens=opens,
            )

            if result.final_signal == 'NO_TRADE':
                return None

            # ALPHA-DYNAMIC (2026-10-31): استخدم risk_profile من V3 (مش نسب ثابتة)
            risk_profile = getattr(result, 'risk_profile', {}) or {}
            
            if risk_profile and risk_profile.get('entry_price'):
                # V3 بـ يـ emit risk_profile — استخدمه (الـ levels الديناميكية)
                entry_price = float(risk_profile.get('entry_price', prices[-1]))
                target_price = float(risk_profile.get('target_price', 0.0))
                stop_loss = float(risk_profile.get('stop_loss', 0.0))
            else:
                # fallback: لو risk_profile مش موجود
                entry_price = prices[-1]
                target_price = prices[-1] * 1.05 if 'BUY' in result.final_signal else prices[-1] * 0.95
                stop_loss = prices[-1] * 0.97 if 'BUY' in result.final_signal else prices[-1] * 1.03

            return {
                'signal': result.final_signal,
                'entry_price': entry_price,
                'target_price': target_price,
                'stop_loss': stop_loss,
                'master_score': result.signal_score,
                'confidence': result.confidence,
                'state_code': state_code,
                'risk_profile': risk_profile,  # للحفظ في notes
            }
        except Exception as e:
            logger.debug(f"  {ticker}: analyze failed: {e}")
            return None


# ============================================================
# Trade Simulator — بـ يحسب النتيجة الفعلية للصفقة
# ============================================================

class TradeSimulator:
    """بـ يحسب النتيجة الفعلية لكل صفقة."""

    def __init__(self, max_holding_days: int = 20):
        self.max_holding_days = max_holding_days

    def simulate_trade(self, trade: BacktestTrade,
                       future_prices: List[dict]) -> BacktestTrade:
        """بـ يحسب نتيجة الصفقة على الأسعار المستقبلية.

        Args:
            trade: الصفقة (بتحتوي entry_price, target, stop)
            future_prices: الأسعار بعد يوم الدخول [{date, open, high, low, close}, ...]

        Returns:
            trade محدّث بـ exit_price, exit_date, exit_reason, pnl_pct, holding_days
        """
        if not future_prices:
            trade.exit_reason = 'no_future_data'
            return trade

        entry = trade.entry_price
        target = trade.target_price
        stop = trade.stop_loss
        is_buy = 'BUY' in trade.signal.upper()

        max_fav = 0.0
        max_adv = 0.0

        for i, day in enumerate(future_prices[:self.max_holding_days]):
            day_high = day.get('high') or day.get('high_price') or 0
            day_low = day.get('low') or day.get('low_price') or 0
            day_close = day.get('close') or day.get('close_price') or 0

            if day_high == 0 or day_low == 0:
                continue

            # احسب أعلى ربح/خسارة
            if is_buy:
                fav = (day_high - entry) / entry * 100
                adv = (entry - day_low) / entry * 100
            else:
                fav = (entry - day_low) / entry * 100
                adv = (day_high - entry) / entry * 100

            max_fav = max(max_fav, fav)
            max_adv = max(max_adv, adv)

            # فحص الهدف + الوقف
            if is_buy:
                if day_high >= target:
                    trade.exit_price = target
                    trade.exit_date = day['date']
                    trade.exit_reason = 'target_hit'
                    trade.pnl_pct = (target - entry) / entry * 100
                    trade.holding_days = i + 1
                    break
                if day_low <= stop:
                    trade.exit_price = stop
                    trade.exit_date = day['date']
                    trade.exit_reason = 'stop_hit'
                    trade.pnl_pct = (stop - entry) / entry * 100
                    trade.holding_days = i + 1
                    break
            else:  # SELL
                if day_low <= target:
                    trade.exit_price = target
                    trade.exit_date = day['date']
                    trade.exit_reason = 'target_hit'
                    trade.pnl_pct = (entry - target) / entry * 100
                    trade.holding_days = i + 1
                    break
                if day_high >= stop:
                    trade.exit_price = stop
                    trade.exit_date = day['date']
                    trade.exit_reason = 'stop_hit'
                    trade.pnl_pct = (entry - stop) / entry * 100
                    trade.holding_days = i + 1
                    break
        else:
            # timeout — استخدم آخر سعر
            last_day = future_prices[min(len(future_prices) - 1, self.max_holding_days - 1)]
            last_close = last_day.get('close') or last_day.get('close_price') or entry
            trade.exit_price = last_close
            trade.exit_date = last_day['date']
            trade.exit_reason = 'timeout'
            if is_buy:
                trade.pnl_pct = (last_close - entry) / entry * 100
            else:
                trade.pnl_pct = (entry - last_close) / entry * 100
            trade.holding_days = self.max_holding_days

        trade.max_favorable_pct = max_fav
        trade.max_adverse_pct = max_adv
        return trade


# ============================================================
# Database Writer — يكتب النتائج في predictions.db (جدول predictions)
# ============================================================

class BacktestDatabaseWriter:
    """بـ يكتب نتائج الـ backtest في جدول 'predictions' نفسه.

    القاعدة: مفيش schema جديدة — بـ نضيف column 'is_backtest' فقط.
    كل صفوف الـ backtest بـ is_backtest=1.
    صفوف الإنتاج (V3) بـ is_backtest=0 (أو NULL).

    wipe_old_backtests() بـ يمسح بس الصفوف اللي is_backtest=1.
    """

    # الـ schema بتاع جدول predictions (من src/lib/honest-tracking/maestro.ts)
    ENSURE_TABLE_SQL = '''
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            signal TEXT,
            signal_type TEXT NOT NULL,
            prediction_date TEXT NOT NULL,
            entry_price REAL NOT NULL,
            target_price REAL,
            stop_loss REAL,
            master_score REAL,
            technical_score REAL,
            fundamental_score REAL,
            ai_pattern_score REAL,
            sentiment_score REAL,
            risk_reward REAL,
            atr_at_entry REAL,
            highest_price_reached REAL,
            outcome_date TEXT,
            exit_price REAL,
            actual_return REAL,
            exit_reason TEXT,
            hit_target INTEGER DEFAULT 0,
            hit_stop INTEGER DEFAULT 0,
            is_correct INTEGER,
            holding_days INTEGER,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    '''

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self.run_id = datetime.now().strftime('%Y%m%d_%H%M%S')

    def connect(self):
        """فتح الاتصال + إنشاء الجدول لو مش موجود + إضافة column is_backtest."""
        self._conn = sqlite3.connect(str(self.db_path))
        cur = self._conn.cursor()

        # 1. إنشاء جدول predictions لو مش موجود
        cur.execute(self.ENSURE_TABLE_SQL)

        # 2. إضافة column is_backtest لو مش موجود
        cols = [r[1] for r in cur.execute("PRAGMA table_info(predictions)").fetchall()]
        if 'is_backtest' not in cols:
            cur.execute('ALTER TABLE predictions ADD COLUMN is_backtest INTEGER DEFAULT 0')
            logger.info("  ✓ Added column 'is_backtest' to predictions table")
        if 'persona' not in cols:
            cur.execute('ALTER TABLE predictions ADD COLUMN persona TEXT DEFAULT NULL')
            logger.info("  ✓ Added column 'persona' to predictions table")

        # 3. indexes
        cur.execute('CREATE INDEX IF NOT EXISTS idx_pred_is_backtest ON predictions(is_backtest)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_pred_ticker ON predictions(ticker)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_pred_market ON predictions(market)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_pred_date ON predictions(prediction_date)')

        self._conn.commit()
        logger.info(f"✓ Connected to {self.db_path.name} (predictions table ready with is_backtest column)")

    def wipe_old_backtests(self):
        """يمسح كل صفوف الـ backtest القديمة (is_backtest=1) بلا رجعة.

        القاعدة: 'الآن خلية يمسح الى موجود ويبدأ من جديد'
        بـ يمسح بس الصفوف اللي is_backtest=1 — صفوف الإنتاج (is_backtest=0) بـ تفضل زي ما هي.
        """
        if not self._conn:
            self.connect()
        cur = self._conn.cursor()
        cur.execute('DELETE FROM predictions WHERE is_backtest = 1')
        deleted = cur.rowcount
        self._conn.commit()
        logger.info(f"✓ Wiped {deleted} old backtest trades (is_backtest=1 — production rows untouched)")

    def save_trade(self, trade: BacktestTrade):
        """حفظ صفقة واحدة في جدول predictions بـ is_backtest=1.

        mapping:
          BacktestTrade → predictions columns
          ticker → ticker
          market → market
          signal → signal + signal_type
          signal_date → prediction_date
          entry_price → entry_price
          target_price → target_price
          stop_loss → stop_loss
          master_score → master_score
          exit_price → exit_price
          exit_date → outcome_date
          exit_reason → exit_reason
          pnl_pct → actual_return
          holding_days → holding_days
          hit_target (1 if target_hit) → hit_target
          hit_stop (1 if stop_hit) → hit_stop
          confidence + state_code + max_fav + max_adv + run_id → notes (JSON)
          is_backtest = 1
          persona = 'backtest'
        """
        if not self._conn:
            self.connect()
        cur = self._conn.cursor()

        # بناء notes كـ JSON (بيانات إضافية مش ليها columns مخصصة)
        notes_json = json.dumps({
            'confidence': trade.confidence,
            'state_code': trade.state_code,
            'max_favorable_pct': round(trade.max_favorable_pct, 2),
            'max_adverse_pct': round(trade.max_adverse_pct, 2),
            'atr': round(trade.atr, 4),
            'atr_pct': round(trade.atr_pct, 2),
            'support': round(trade.support, 4),
            'resistance': round(trade.resistance, 4),
            'method': trade.method,
            'backtest_run_id': self.run_id,
        }, ensure_ascii=False)

        # hit_target / hit_stop
        hit_target = 1 if trade.exit_reason == 'target_hit' else 0
        hit_stop = 1 if trade.exit_reason == 'stop_hit' else 0

        cur.execute('''
            INSERT INTO predictions
                (ticker, market, signal, signal_type, prediction_date,
                 entry_price, target_price, stop_loss, master_score,
                 outcome_date, exit_price, actual_return, exit_reason,
                 hit_target, hit_stop, holding_days, notes,
                 is_backtest, persona, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'backtest', datetime('now'))
        ''', (
            trade.ticker,
            trade.market,
            trade.signal,
            trade.signal,          # signal_type = signal (NOT NULL)
            trade.signal_date,      # prediction_date
            trade.entry_price,
            trade.target_price,
            trade.stop_loss,
            trade.master_score,
            trade.exit_date or None,    # outcome_date
            trade.exit_price or 0,      # exit_price
            trade.pnl_pct,              # actual_return
            trade.exit_reason,          # exit_reason
            hit_target,
            hit_stop,
            trade.holding_days,
            notes_json,
        ))

    def save_all(self, trades: List[BacktestTrade]):
        """حفظ كل الصفقات مرة واحدة."""
        if not self._conn:
            self.connect()
        for trade in trades:
            self.save_trade(trade)
        self._conn.commit()
        logger.info(f"✓ Saved {len(trades)} backtest trades to predictions table (is_backtest=1, run_id={self.run_id})")

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def get_stats(self) -> dict:
        """جيب إحصائيات الـ backtest من جدول predictions (is_backtest=1 فقط)."""
        if not self._conn:
            self.connect()
        cur = self._conn.cursor()

        cur.execute('SELECT COUNT(*) FROM predictions WHERE is_backtest = 1 AND notes LIKE ?', (f'%{self.run_id}%',))
        total = cur.fetchone()[0]

        cur.execute('SELECT COUNT(*) FROM predictions WHERE is_backtest = 1 AND notes LIKE ? AND exit_reason != "pending"', (f'%{self.run_id}%',))
        closed = cur.fetchone()[0]

        cur.execute('SELECT COUNT(*) FROM predictions WHERE is_backtest = 1 AND notes LIKE ? AND actual_return > 0', (f'%{self.run_id}%',))
        wins = cur.fetchone()[0]

        cur.execute('SELECT AVG(actual_return) FROM predictions WHERE is_backtest = 1 AND notes LIKE ?', (f'%{self.run_id}%',))
        avg_pnl = cur.fetchone()[0] or 0

        cur.execute('SELECT SUM(actual_return) FROM predictions WHERE is_backtest = 1 AND notes LIKE ?', (f'%{self.run_id}%',))
        total_pnl = cur.fetchone()[0] or 0

        return {
            'run_id': self.run_id,
            'total_trades': total,
            'closed_trades': closed,
            'wins': wins,
            'win_rate': (wins / closed * 100) if closed > 0 else 0,
            'avg_pnl_pct': avg_pnl,
            'total_pnl_pct': total_pnl,
        }


# ============================================================
# Main Backtest Engine
# ============================================================

class V3BacktestEngine:
    """المحرك الرئيسي للـ backtest."""

    def __init__(self, market: str, start_date: str, end_date: str,
                 max_tickers: int = 0, dry_run: bool = False,
                 db_writer: Optional[BacktestDatabaseWriter] = None):
        self.market = market
        self.start_date = start_date
        self.end_date = end_date
        self.max_tickers = max_tickers
        self.dry_run = dry_run
        self.db_writer = db_writer

        self.loader = HistoricalDataLoader(STOCKS_DB, DATA_ENGINE_DB)
        self.simulator = V3Simulator()
        self.trade_sim = TradeSimulator(max_holding_days=20)

        self.result = BacktestResult(
            market=market,
            start_date=start_date,
            end_date=end_date,
        )

    def run(self) -> BacktestResult:
        """تشغيل الـ backtest الكامل."""
        logger.info(f"{'='*60}")
        logger.info(f"  V3 Backtest — {self.market}")
        logger.info(f"  Period: {self.start_date} → {self.end_date}")
        logger.info(f"  Max tickers: {self.max_tickers or 'ALL'}")
        logger.info(f"  Dry-run: {self.dry_run}")
        logger.info(f"{'='*60}")

        # 0. لو فيه DB writer → امسح القديم قبل ما تبدأ
        if self.db_writer and not self.dry_run:
            self.db_writer.connect()
            self.db_writer.wipe_old_backtests()

        # 1. جيب كل tickers
        tickers = self.loader.get_tickers(self.market)
        if self.max_tickers > 0:
            tickers = tickers[:self.max_tickers]
        logger.info(f"  Tickers to test: {len(tickers)}")
        self.result.total_tickers_tested = len(tickers)

        if self.dry_run:
            logger.info("  [DRY-RUN] Skipping actual backtest")
            return self.result

        # 2. لكل ticker، حلل كل يوم + سجل الصفقات
        for i, ticker in enumerate(tickers):
            if (i + 1) % 50 == 0:
                logger.info(f"  Progress: {i+1}/{len(tickers)} tickers...")

            prices_data = self.loader.get_price_history(
                ticker, self.market, self.start_date, self.end_date
            )

            if len(prices_data) < 25:  # محتاجين 20 يوم على الأقل لـ V3
                continue

            # حلل كل يوم (بداية من اليوم 20)
            for day_idx in range(20, len(prices_data)):
                # الأسعار لحد اليوم الحالي
                history = prices_data[:day_idx + 1]
                prices = [d.get('close') or d.get('close_price') or 0 for d in history]
                volumes = [d.get('volume') or 0 for d in history]
                highs = [d.get('high') or d.get('high_price') or 0 for d in history]
                lows = [d.get('low') or d.get('low_price') or 0 for d in history]
                opens = [d.get('open') or d.get('open_price') or 0 for d in history]

                # فلتر الأسعار الصفرية
                if 0 in prices[-20:]:
                    continue

                # حلل بـ V3
                analysis = self.simulator.analyze_day(
                    ticker, self.market, prices, volumes, highs, lows, opens
                )

                if analysis is None:
                    continue

                # سجل الصفقة
                # ALPHA-DYNAMIC: استخراج بيانات risk_profile
                _rp = analysis.get('risk_profile', {})
                trade = BacktestTrade(
                    ticker=ticker,
                    market=self.market,
                    signal_date=history[-1]['date'],
                    signal=analysis['signal'],
                    entry_price=analysis['entry_price'],
                    target_price=analysis['target_price'],
                    stop_loss=analysis['stop_loss'],
                    master_score=analysis['master_score'],
                    confidence=analysis['confidence'],
                    state_code=analysis['state_code'],
                    # ALPHA-DYNAMIC: بيانات الـ risk_profile
                    atr=float(_rp.get('atr', 0) or 0),
                    atr_pct=float(_rp.get('atr_pct', 0) or 0),
                    support=float(_rp.get('support', 0) or 0),
                    resistance=float(_rp.get('resistance', 0) or 0),
                    method=str(_rp.get('method', 'static')),
                )

                # جيب الأسعار المستقبلية
                future_prices = prices_data[day_idx + 1:]

                # حساب النتيجة الفعلية
                trade = self.trade_sim.simulate_trade(trade, future_prices)

                self.result.trades.append(trade)
                self.result.total_trades += 1

                if trade.exit_reason in ('target_hit', 'stop_hit', 'timeout'):
                    self.result.closed_trades += 1
                    if trade.pnl_pct > 0:
                        self.result.wins += 1
                    else:
                        self.result.losses += 1
                    if trade.exit_reason == 'target_hit':
                        self.result.target_hits += 1
                    elif trade.exit_reason == 'stop_hit':
                        self.result.stop_hits += 1
                    else:
                        self.result.timeouts += 1
                else:
                    self.result.open_trades += 1

        # 3. حساب الإحصائيات النهائية
        self._calculate_stats()

        return self.result

    def _calculate_stats(self):
        """حساب الإحصائيات النهائية."""
        closed = [t for t in self.result.trades if t.exit_reason in ('target_hit', 'stop_hit', 'timeout')]
        if not closed:
            return

        returns = [t.pnl_pct for t in closed]
        self.result.total_return_pct = sum(returns)
        self.result.avg_return_pct = sum(returns) / len(returns)
        self.result.win_rate = (self.result.wins / len(closed) * 100) if closed else 0
        self.result.avg_holding_days = sum(t.holding_days for t in closed) / len(closed)

        # Max drawdown
        cumulative = 0
        peak = 0
        max_dd = 0
        for r in returns:
            cumulative += r
            if cumulative > peak:
                peak = cumulative
            dd = peak - cumulative
            if dd > max_dd:
                max_dd = dd
        self.result.max_drawdown_pct = max_dd

        # Sharpe ratio (simplified)
        if len(returns) > 1:
            import math
            mean_r = sum(returns) / len(returns)
            std_r = math.sqrt(sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1))
            self.result.sharpe_ratio = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0


# ============================================================
# Report Generator
# ============================================================

def generate_report(result: BacktestResult, output_dir: Path) -> Tuple[Path, Path]:
    """بـ يـ generate تقرير Markdown + JSON."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # JSON
    json_path = output_dir / f'v3_backtest_{result.market}_{timestamp}.json'
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump({
            'market': result.market,
            'start_date': result.start_date,
            'end_date': result.end_date,
            'total_tickers_tested': result.total_tickers_tested,
            'total_trades': result.total_trades,
            'closed_trades': result.closed_trades,
            'open_trades': result.open_trades,
            'wins': result.wins,
            'losses': result.losses,
            'target_hits': result.target_hits,
            'stop_hits': result.stop_hits,
            'timeouts': result.timeouts,
            'total_return_pct': round(result.total_return_pct, 2),
            'avg_return_pct': round(result.avg_return_pct, 2),
            'win_rate': round(result.win_rate, 2),
            'avg_holding_days': round(result.avg_holding_days, 1),
            'max_drawdown_pct': round(result.max_drawdown_pct, 2),
            'sharpe_ratio': round(result.sharpe_ratio, 2),
            'trades': [asdict(t) for t in result.trades[:100]],  # أول 100 صفقة
        }, f, ensure_ascii=False, indent=2)

    # Markdown
    md_path = output_dir / f'v3_backtest_{result.market}_{timestamp}.md'
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(f"# V3 Backtest Report — {result.market}\n\n")
        f.write(f"**التاريخ:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write(f"**السوق:** {result.market}\n")
        f.write(f"**الفترة:** {result.start_date} → {result.end_date}\n\n")
        f.write(f"---\n\n## 📊 الملخص\n\n")
        f.write(f"| المقياس | القيمة |\n|---|---|\n")
        f.write(f"| الأسهم المختبرة | {result.total_tickers_tested} |\n")
        f.write(f"| إجمالي الصفقات | {result.total_trades} |\n")
        f.write(f"| الصفقات المغلقة | {result.closed_trades} |\n")
        f.write(f"| الصفقات المفتوحة | {result.open_trades} |\n\n")
        f.write(f"## 📈 الأداء\n\n")
        f.write(f"| المقياس | القيمة |\n|---|---|\n")
        f.write(f"| إجمالي العائد | {result.total_return_pct:.2f}% |\n")
        f.write(f"| متوسط العائد لكل صفقة | {result.avg_return_pct:.2f}% |\n")
        f.write(f"| نسبة الفوز | {result.win_rate:.2f}% |\n")
        f.write(f"| متوسط مدة الاحتفاظ | {result.avg_holding_days:.1f} يوم |\n")
        f.write(f"| أقصى خسارة | {result.max_drawdown_pct:.2f}% |\n")
        f.write(f"| Sharpe Ratio | {result.sharpe_ratio:.2f} |\n\n")
        f.write(f"## 🎯 النتائج\n\n")
        f.write(f"| النوع | العدد |\n|---|---|\n")
        f.write(f"| هدف مضروب | {result.target_hits} |\n")
        f.write(f"| وقف مضروب | {result.stop_hits} |\n")
        f.write(f"| انتهاء المدة | {result.timeouts} |\n")
        f.write(f"| رابحة | {result.wins} |\n")
        f.write(f"| خاسرة | {result.losses} |\n\n")
        f.write(f"## 📋 أفضل 10 صفقات\n\n")
        f.write(f"| ticker | signal | date | entry | exit | pnl% | days | reason |\n")
        f.write(f"|---|---|---|---|---|---|---|---|\n")
        top_trades = sorted(result.trades, key=lambda t: t.pnl_pct, reverse=True)[:10]
        for t in top_trades:
            f.write(f"| {t.ticker} | {t.signal} | {t.signal_date} | {t.entry_price:.2f} | {t.exit_price:.2f} | {t.pnl_pct:.2f}% | {t.holding_days} | {t.exit_reason} |\n")
        f.write(f"\n## 📋 أسوأ 10 صفقات\n\n")
        f.write(f"| ticker | signal | date | entry | exit | pnl% | days | reason |\n")
        f.write(f"|---|---|---|---|---|---|---|---|\n")
        worst_trades = sorted(result.trades, key=lambda t: t.pnl_pct)[:10]
        for t in worst_trades:
            f.write(f"| {t.ticker} | {t.signal} | {t.signal_date} | {t.entry_price:.2f} | {t.exit_price:.2f} | {t.pnl_pct:.2f}% | {t.holding_days} | {t.exit_reason} |\n")

    return md_path, json_path


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='V3 Backtest Engine')
    parser.add_argument('--market', default='EGX',
                        choices=['EGX', 'US', 'CRYPTO'],
                        help='السوق (default: EGX)')
    parser.add_argument('--start', default='2025-09-22',
                        help='تاريخ البداية (YYYY-MM-DD)')
    parser.add_argument('--end', default='2026-10-25',
                        help='تاريخ النهاية (YYYY-MM-DD)')
    parser.add_argument('--max-tickers', type=int, default=0,
                        help='أقصى عدد أسهم (0 = الكل)')
    parser.add_argument('--dry-run', action='store_true',
                        help='تجربة جافة (بدون backtest فعلي)')
    parser.add_argument('--output-dir', default='backtest_results',
                        help='مجلد الإخراج')
    parser.add_argument('--no-db', action='store_true',
                        help='عدم الكتابة في predictions.db')
    args = parser.parse_args()

    # تحقق من الـ DBs
    if not STOCKS_DB.exists():
        logger.error(f"stocks.db not found at {STOCKS_DB}")
        sys.exit(1)

    # إعداد الـ DB writer
    db_writer = None
    if not args.no_db and not args.dry_run:
        PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
        db_writer = BacktestDatabaseWriter(PREDICTIONS_DB)

    # تشغيل الـ backtest
    engine = V3BacktestEngine(
        market=args.market,
        start_date=args.start,
        end_date=args.end,
        max_tickers=args.max_tickers,
        dry_run=args.dry_run,
        db_writer=db_writer,
    )
    result = engine.run()

    # حفظ الصفقات في الـ DB
    if db_writer and result.trades:
        db_writer.save_all(result.trades)
        db_stats = db_writer.get_stats()
        print(f"\n  📊 DB Stats (run_id={db_stats['run_id']}):")
        print(f"    trades in DB: {db_stats['total_trades']}")
        print(f"    win rate: {db_stats['win_rate']:.2f}%")
        print(f"    avg pnl: {db_stats['avg_pnl_pct']:.2f}%")
        print(f"    total pnl: {db_stats['total_pnl_pct']:.2f}%")
        db_writer.close()

    # طباعة الملخص
    print(f"\n{'='*60}")
    print(f"  ✅ V3 Backtest Complete — {result.market}")
    print(f"{'='*60}")
    print(f"  الأسهم المختبرة: {result.total_tickers_tested}")
    print(f"  إجمالي الصفقات: {result.total_trades}")
    print(f"  الصفقات المغلقة: {result.closed_trades}")
    print(f"  نسبة الفوز: {result.win_rate:.2f}%")
    print(f"  متوسط العائد: {result.avg_return_pct:.2f}%")
    print(f"  إجمالي العائد: {result.total_return_pct:.2f}%")
    print(f"  أقصى خسارة: {result.max_drawdown_pct:.2f}%")
    print(f"  Sharpe Ratio: {result.sharpe_ratio:.2f}")
    print(f"{'='*60}\n")

    # حفظ التقرير (Markdown + JSON)
    if not args.dry_run:
        output_dir = PROJECT_ROOT / args.output_dir
        md_path, json_path = generate_report(result, output_dir)
        print(f"  📄 Markdown: {md_path}")
        print(f"  📄 JSON: {json_path}")


if __name__ == '__main__':
    main()
