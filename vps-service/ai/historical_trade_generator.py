#!/usr/bin/env python3
"""
Historical Trade Generator — مولّد الصفقات التاريخية
=====================================================
يولّد آلاف الصفقات من البيانات التاريخية لتدريب الـ AI عليها.

الفكرة (مقترح المستخدم محسن):
بدل ما نستنى المستخدم يسجّل كل صفقة، نولّد صفقات تلقائياً من
البيانات التاريخية. كل سهم × كل يوم = صفقة محتملة. نحسب الـ outcome
(نجح/فشل) بناءً على حركة السعر بعد تاريخ الشراء. ده هيدي الـ AI:
- كم هائل من التجارب (آلاف الصفقات لكل سهم)
- أنماط مختلفة (breakout, reversal, accumulation, distribution)
- أوقات مختلفة (bull/bear/sideways markets)
- النجاح والفشل معاً (مهم جداً للتعلم المتوازن)

الـ outcomes بتدخل في:
1. trade_outcomes — للتحليل الإحصائي
2. stock_stories — للـ RAG AI (الـ AI يستخدمها في الـ prompts)
3. learned_lessons — للـ learning loop

Usage:
    from ai.historical_trade_generator import HistoricalTradeGenerator
    gen = HistoricalTradeGenerator()
    gen.generate_all_trades(days_back=180, max_trades_per_ticker=50)
    gen.feed_to_ai_learning()
"""

from __future__ import annotations

import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = str(_PROJECT_ROOT / "db" / "predictions.db")
PRICE_HISTORY_DB = str(_PROJECT_ROOT / "db" / "price_history.db")
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")

# استراتيجيات التداول اللي بنختبرها (كل واحدة بـ parameters مختلفة)
STRATEGIES = [
    {"name": "support_bounce",   "entry": "near_support",   "target_pct": 5,  "stop_pct": 3,  "hold_days": 10},
    {"name": "breakout_play",    "entry": "breakout",       "target_pct": 8,  "stop_pct": 4,  "hold_days": 7},
    {"name": "pullback_buy",     "entry": "pullback",       "target_pct": 6,  "stop_pct": 3,  "hold_days": 14},
    {"name": "momentum_ride",    "entry": "momentum",       "target_pct": 10, "stop_pct": 5,  "hold_days": 5},
    {"name": "value_dip",        "entry": "oversold",       "target_pct": 7,  "stop_pct": 4,  "hold_days": 20},
]


@dataclass
class HistoricalTrade:
    """صفقة تاريخية مولّدة من البيانات."""
    ticker: str
    strategy: str
    buy_date: str
    buy_price: float
    sell_date: str
    sell_price: float
    pnl_pct: float
    holding_days: int
    outcome: str           # WIN / LOSS / BREAKEVEN
    pattern_type: str      # breakout / volume_spike / reversal / accumulation / momentum
    market_condition: str  # bull / bear / sideways (based on trend before buy)
    rsi_at_buy: Optional[float]
    volume_ratio_at_buy: Optional[float]
    lesson_text: str


class HistoricalTradeGenerator:
    """يولّد صفقات تاريخية من البيانات + يربطها بـ AI learning."""

    def __init__(self):
        self.predictions_db = PREDICTIONS_DB
        self.price_db = PRICE_HISTORY_DB
        self.stocks_db = STOCKS_DB
        self._ensure_schema()

    def _conn(self, db_path: str) -> sqlite3.Connection:
        conn = sqlite3.connect(db_path, timeout=30.0)
        if not db_path.endswith(".temp"):
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=30000")
        return conn

    def _ensure_schema(self):
        """يتأكد إن الـ tables موجودة."""
        try:
            conn = self._conn(self.predictions_db)
            # جدول الصفقات التاريخية المولّدة
            conn.execute("""
                CREATE TABLE IF NOT EXISTS historical_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    strategy TEXT NOT NULL,
                    buy_date TEXT NOT NULL,
                    buy_price REAL NOT NULL,
                    sell_date TEXT,
                    sell_price REAL,
                    pnl_pct REAL,
                    holding_days INTEGER,
                    outcome TEXT,
                    pattern_type TEXT,
                    market_condition TEXT,
                    rsi_at_buy REAL,
                    volume_ratio_at_buy REAL,
                    lesson_text TEXT,
                    fed_to_ai INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_hist_ticker
                ON historical_trades(ticker)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_hist_pattern
                ON historical_trades(pattern_type, outcome)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_hist_strategy
                ON historical_trades(strategy, outcome)
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Schema error: {e}")

    # ─── Price History Access ────────────────────────────────────────────

    def _get_price_history(self, ticker: str, limit: int = 365) -> List[Dict]:
        """يجيب تاريخ السعر لسهم معيّن.

        PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        The unified reader returns ``[{date, open, high, low, close, volume}]``
        (oldest-first). Callers here access the legacy ``*_price`` column
        names, so we project back to that contract.
        """
        from data.prices import load_price_history

        candles = load_price_history(ticker, limit=limit)

        # Project to legacy caller contract (oldest-first, *_price keys).
        rows: List[Dict] = []
        for c in candles:
            rows.append({
                'date': c.get('date'),
                'open_price': c.get('open'),
                'high_price': c.get('high'),
                'low_price': c.get('low'),
                'close_price': c.get('close'),
                'volume': c.get('volume'),
            })
        return rows

    def _get_all_tickers(self) -> List[str]:
        """يجيب كل الـ tickers اللي عندها price history."""
        try:
            conn = self._conn(self.price_db)
            try:
                rows = conn.execute("""
                    SELECT DISTINCT ticker FROM stock_daily_prices
                    WHERE close IS NOT NULL AND close > 0
                """).fetchall()
            except Exception:
                rows = conn.execute("""
                    SELECT DISTINCT ticker FROM price_history
                    WHERE close_price > 0
                """).fetchall()
            conn.close()
            return [r[0] for r in rows if r[0]]
        except Exception as e:
            logger.error(f"Get tickers error: {e}")
            return []

    # ─── Technical Indicators (simple, fast) ─────────────────────────────

    def _calc_rsi(self, closes: List[float], period: int = 14) -> Optional[float]:
        """RSI سريع."""
        if len(closes) < period + 1:
            return None
        gains, losses = [], []
        for i in range(1, period + 1):
            change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses.append(max(-change, 0))
        avg_gain = sum(gains) / period
        avg_loss = sum(losses) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def _calc_volume_ratio(self, volumes: List[float], idx: int, period: int = 20) -> Optional[float]:
        """نسبة حجم اليوم لمتوسط آخر period يوم."""
        if idx < period or idx >= len(volumes):
            return None
        avg = sum(volumes[idx - period:idx]) / period
        if avg == 0:
            return None
        return volumes[idx] / avg

    def _calc_sma(self, closes: List[float], period: int) -> Optional[float]:
        if len(closes) < period:
            return None
        return sum(closes[-period:]) / period

    def _detect_market_condition(self, closes: List[float]) -> str:
        """يحدد حالة السوق قبل الشراء (bull/bear/sideways)."""
        if len(closes) < 30:
            return "unknown"
        sma20 = self._calc_sma(closes[-20:], 20)
        sma50 = self._calc_sma(closes[-50:], 50) if len(closes) >= 50 else sma20
        if sma20 is None or sma50 is None:
            return "unknown"
        diff_pct = (sma20 - sma50) / sma50 * 100
        if diff_pct > 2:
            return "bull"
        elif diff_pct < -2:
            return "bear"
        return "sideways"

    # ─── Strategy Entry Detectors ────────────────────────────────────────

    def _detect_entries(self, rows: List[Dict], idx: int) -> Dict[str, bool]:
        """يكتشف كل entry signals ممكنة في يوم idx."""
        if idx < 30 or idx >= len(rows) - 15:
            return {}
        closes = [float(r["close_price"] or 0) for r in rows[:idx + 1]]
        volumes = [float(r["volume"] or 0) for r in rows[:idx + 1]]
        if not closes or closes[-1] <= 0:
            return {}

        # support/resistance بسيط
        window = closes[max(0, idx - 20):idx]
        if not window:
            return {}
        support = min(window)
        resistance = max(window)
        current = closes[idx]
        rsi = self._calc_rsi(closes)
        vol_ratio = self._calc_volume_ratio(volumes, idx)

        entries = {}
        # near_support: السعر قرب الدعم (ضمن 3%)
        if support > 0 and (current - support) / support < 0.03:
            entries["near_support"] = True
        # breakout: السعر كسر المقاومة (ضمن 1% فوقها)
        if resistance > 0 and current > resistance * 0.99 and current < resistance * 1.02:
            entries["breakout"] = True
        # pullback: السعر نزل شوية بعد طلوع (within 5% of recent high)
        recent_high = max(closes[-10:]) if len(closes) >= 10 else max(closes)
        if recent_high > 0 and (recent_high - current) / recent_high < 0.05:
            entries["pullback"] = True
        # momentum: طلوع قوي (3%+ في آخر 3 أيام) + volume spike
        if len(closes) >= 4:
            recent_change = (closes[idx] - closes[idx - 3]) / closes[idx - 3] * 100
            if recent_change > 3 and vol_ratio and vol_ratio > 1.3:
                entries["momentum"] = True
        # oversold: RSI < 35
        if rsi is not None and rsi < 35:
            entries["oversold"] = True

        return entries

    # ─── Trade Simulation ────────────────────────────────────────────────

    def _simulate_trade(
        self,
        rows: List[Dict],
        buy_idx: int,
        strategy: Dict,
    ) -> Optional[HistoricalTrade]:
        """يحاكي صفقة واحدة: buy في buy_idx، sell عند target/stop/hold_days."""
        if buy_idx >= len(rows) - 1:
            return None

        ticker = rows[buy_idx].get("ticker") or ""
        buy_price = float(rows[buy_idx]["close_price"] or 0)
        if buy_price <= 0:
            return None

        target = buy_price * (1 + strategy["target_pct"] / 100)
        stop = buy_price * (1 - strategy["stop_pct"] / 100)
        max_hold = strategy["hold_days"]

        sell_price = None
        sell_date = None
        holding_days = 0

        # امسح الأيام اللي بعد الشراء
        for j in range(buy_idx + 1, min(buy_idx + 1 + max_hold, len(rows))):
            high = float(rows[j].get("high_price") or 0)
            low = float(rows[j].get("low_price") or 0)
            close = float(rows[j].get("close_price") or 0)
            holding_days += 1
            # stop loss أول (الخسارة تتصفّى الأول)
            if low <= stop:
                sell_price = stop
                sell_date = rows[j].get("date") or rows[j].get("price_date")
                break
            # target hit
            if high >= target:
                sell_price = target
                sell_date = rows[j].get("date") or rows[j].get("price_date")
                break
            # آخر يوم: sell at close
            if j == min(buy_idx + max_hold, len(rows) - 1):
                sell_price = close
                sell_date = rows[j].get("date") or rows[j].get("price_date")

        if sell_price is None or sell_date is None:
            return None

        pnl_pct = ((sell_price - buy_price) / buy_price) * 100
        if pnl_pct >= strategy["target_pct"] * 0.8:
            outcome = "WIN"
        elif pnl_pct <= -strategy["stop_pct"] * 0.8:
            outcome = "LOSS"
        else:
            outcome = "BREAKEVEN"

        # pattern detection
        closes = [float(r["close_price"] or 0) for r in rows[:buy_idx + 1]]
        volumes = [float(r["volume"] or 0) for r in rows[:buy_idx + 1]]
        rsi = self._calc_rsi(closes)
        vol_ratio = self._calc_volume_ratio(volumes, buy_idx)
        market_cond = self._detect_market_condition(closes)

        pattern = "unknown"
        if strategy["entry"] == "breakout":
            pattern = "breakout"
        elif strategy["entry"] == "near_support":
            pattern = "reversal" if rsi and rsi < 40 else "accumulation"
        elif strategy["entry"] == "momentum":
            pattern = "momentum"
        elif strategy["entry"] == "oversold":
            pattern = "reversal"
        elif strategy["entry"] == "pullback":
            pattern = "pullback"
        if vol_ratio and vol_ratio > 2.0:
            pattern = "volume_spike"

        # lesson text (للـ AI + stock_stories)
        rsi_str = f"{rsi:.0f}" if rsi else "N/A"
        vol_str = f"{vol_ratio:.1f}" if vol_ratio else "N/A"
        lesson = (
            f"استراتيجية {strategy['name']} على {ticker}: "
            f"شراء @ {buy_price:.2f} في {rows[buy_idx].get('date','')[:10]} "
            f"(RSI={rsi_str}, vol_ratio={vol_str}, "
            f"market={market_cond}). "
            f"بيع @ {sell_price:.2f} بعد {holding_days} يوم. "
            f"النتيجة: {outcome} ({pnl_pct:+.1f}%). "
            f"النمط: {pattern}."
        )

        return HistoricalTrade(
            ticker=ticker,
            strategy=strategy["name"],
            buy_date=(rows[buy_idx].get("date") or rows[buy_idx].get("price_date") or "")[:10],
            buy_price=round(buy_price, 2),
            sell_date=(sell_date or "")[:10],
            sell_price=round(sell_price, 2),
            pnl_pct=round(pnl_pct, 2),
            holding_days=holding_days,
            outcome=outcome,
            pattern_type=pattern,
            market_condition=market_cond,
            rsi_at_buy=round(rsi, 1) if rsi else None,
            volume_ratio_at_buy=round(vol_ratio, 2) if vol_ratio else None,
            lesson_text=lesson,
        )

    # ─── Main Generation Logic ───────────────────────────────────────────

    def generate_for_ticker(
        self,
        ticker: str,
        days_back: int = 180,
        max_trades: int = 50,
    ) -> int:
        """يولّد صفقات لسهم واحد. يرجّع عدد الصفقات المولّدة."""
        rows = self._get_price_history(ticker, limit=days_back + 30)
        if len(rows) < 40:
            return 0

        generated = 0
        conn = self._conn(self.predictions_db)
        try:
            for strategy in STRATEGIES:
                if generated >= max_trades:
                    break
                # امسح كل يوم، بس skip أيام عشوائية عشان نوزّع الصفقات
                step = max(1, len(rows) // (max_trades // len(STRATEGIES) + 1))
                for i in range(30, len(rows) - 15, step):
                    if generated >= max_trades:
                        break
                    entries = self._detect_entries(rows, i)
                    if strategy["entry"] not in entries:
                        continue
                    trade = self._simulate_trade(rows, i, strategy)
                    if not trade:
                        continue
                    # تخزين
                    try:
                        conn.execute("""
                            INSERT INTO historical_trades
                                (ticker, strategy, buy_date, buy_price, sell_date, sell_price,
                                 pnl_pct, holding_days, outcome, pattern_type, market_condition,
                                 rsi_at_buy, volume_ratio_at_buy, lesson_text)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """, (
                            trade.ticker, trade.strategy, trade.buy_date, trade.buy_price,
                            trade.sell_date, trade.sell_price, trade.pnl_pct, trade.holding_days,
                            trade.outcome, trade.pattern_type, trade.market_condition,
                            trade.rsi_at_buy, trade.volume_ratio_at_buy, trade.lesson_text,
                        ))
                        generated += 1
                    except Exception as e:
                        logger.error(f"Insert trade error: {e}")
            conn.commit()
        finally:
            conn.close()
            
        return generated

    def generate_all_trades(
        self,
        days_back: int = 180,
        max_trades_per_ticker: int = 50,
        ticker_limit: int = 0,
    ) -> Dict:
        """يولّد صفقات لكل الأسهم في قاعدة بيانات مؤقتة لتفادي الـ locks ثم يدمجها."""
        import os
        
        # 1. إعداد مسار الـ Temp DB
        temp_db_path = self.predictions_db + ".temp"
        if os.path.exists(temp_db_path):
            try:
                os.remove(temp_db_path)
            except Exception:
                pass
                
        # 2. إنشاء وتأمين الـ Schema في الـ Temp DB
        try:
            conn_temp = self._conn(temp_db_path)
            conn_temp.execute("""
                CREATE TABLE IF NOT EXISTS historical_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    strategy TEXT NOT NULL,
                    buy_date TEXT NOT NULL,
                    buy_price REAL NOT NULL,
                    sell_date TEXT,
                    sell_price REAL,
                    pnl_pct REAL,
                    holding_days INTEGER,
                    outcome TEXT,
                    pattern_type TEXT,
                    market_condition TEXT,
                    rsi_at_buy REAL,
                    volume_ratio_at_buy REAL,
                    lesson_text TEXT,
                    fed_to_ai INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn_temp.close()
        except Exception as e:
            logger.error(f"[HistGen] Temp DB schema error: {e}")
            return {"error": f"Failed to init temp DB: {e}"}

        # 3. توجيه الكتابة لـ Temp DB مؤقتاً أثناء التوليد
        original_db = self.predictions_db
        self.predictions_db = temp_db_path

        tickers = self._get_all_tickers()
        if ticker_limit > 0:
            tickers = tickers[:ticker_limit]

        logger.info(f"[HistGen] Generating trades for {len(tickers)} tickers in temporary DB...")
        total_trades = 0
        successful_tickers = 0
        start_time = datetime.now()

        for i, ticker in enumerate(tickers, 1):
            if i % 50 == 0:
                logger.info(f"[HistGen] Progress: {i}/{len(tickers)} tickers, {total_trades} trades so far")
            try:
                count = self.generate_for_ticker(ticker, days_back=days_back, max_trades=max_trades_per_ticker)
                if count > 0:
                    total_trades += count
                    successful_tickers += 1
            except Exception as e:
                logger.error(f"[HistGen] Error for {ticker}: {e}")

        # 4. إعادة توجيه الـ DB للمسار الأصلي
        self.predictions_db = original_db

        # 5. نقل البيانات من Temp DB للمسار الأصلي بصفقة سريعة وآمنة ضد الـ lock
        logger.info(f"[HistGen] Merging {total_trades} trades into real database...")
        merge_success = False
        try:
            conn_real = self._conn(self.predictions_db)
            conn_real.execute(f"ATTACH DATABASE '{temp_db_path}' AS temp_db")
            conn_real.execute("BEGIN TRANSACTION")
            conn_real.execute("""
                INSERT INTO historical_trades (
                    ticker, strategy, buy_date, buy_price, sell_date, sell_price,
                    pnl_pct, holding_days, outcome, pattern_type, market_condition,
                    rsi_at_buy, volume_ratio_at_buy, lesson_text, fed_to_ai
                )
                SELECT 
                    ticker, strategy, buy_date, buy_price, sell_date, sell_price,
                    pnl_pct, holding_days, outcome, pattern_type, market_condition,
                    rsi_at_buy, volume_ratio_at_buy, lesson_text, 0
                FROM temp_db.historical_trades t
                WHERE NOT EXISTS (
                    SELECT 1 FROM historical_trades h
                    WHERE h.ticker = t.ticker
                      AND h.strategy = t.strategy
                      AND h.buy_date = t.buy_date
                )
            """)
            conn_real.commit()
            conn_real.close()
            merge_success = True
            logger.info("[HistGen] Merge complete!")
        except Exception as e:
            logger.error(f"[HistGen] Merge failed: {e}")

        # 6. حذف الـ Temp DB والملفات المرافقة له
        for suffix in ["", "-shm", "-wal"]:
            p = temp_db_path + suffix
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(
            f"[HistGen] Done: {total_trades} trades from {successful_tickers}/{len(tickers)} tickers "
            f"in {elapsed:.1f}s"
        )
        return {
            "total_tickers": len(tickers),
            "successful_tickers": successful_tickers,
            "total_trades": total_trades,
            "elapsed_seconds": round(elapsed, 1),
            "merged": merge_success
        }

    # ─── AI Learning Integration ─────────────────────────────────────────

    def feed_to_ai_learning(self, limit: int = 5000) -> Dict:
        """يغذّي الـ AI بالصفقات التاريخية عبر stock_stories table.

        الـ RAG AI بيستخدم stock_stories للـ prompt building.
        كل صفقة تتحوّل لـ story بالعربي + pattern_type + outcome.
        """
        try:
            conn = self._conn(self.predictions_db)
            conn.row_factory = sqlite3.Row

            # الصفقات اللي لسه مت fed للـ AI
            trades = conn.execute("""
                SELECT * FROM historical_trades
                WHERE fed_to_ai = 0
                ORDER BY created_at ASC
                LIMIT ?
            """, (limit,)).fetchall()

            if not trades:
                conn.close()
                return {"fed": 0, "message": "مفيش صفقات جديدة للـ AI"}

            # التأكد من وجود stock_stories table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS stock_stories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT,
                    pattern_type TEXT,
                    story_date TEXT,
                    story_text TEXT,
                    keywords TEXT,
                    outcome_pct REAL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)

            fed_count = 0
            for t in trades:
                t = dict(t)
                # story بالعربي للـ AI
                story_text = self._build_arabic_story(t)
                keywords = f"{t['pattern_type']},{t['market_condition']},{t['outcome']},{t['strategy']}"

                # dedupe check
                exists = conn.execute("""
                    SELECT id FROM stock_stories
                    WHERE ticker = ? AND story_date = ? AND pattern_type = ?
                """, (t["ticker"], t["buy_date"], t["pattern_type"])).fetchone()

                if not exists:
                    conn.execute("""
                        INSERT INTO stock_stories
                            (ticker, pattern_type, story_date, story_text, keywords, outcome_pct)
                        VALUES (?,?,?,?,?,?)
                    """, (
                        t["ticker"], t["pattern_type"], t["buy_date"],
                        story_text, keywords, t["pnl_pct"],
                    ))
                    fed_count += 1

                # علّم إن الصفقة اتبعت للـ AI
                conn.execute("""
                    UPDATE historical_trades SET fed_to_ai = 1 WHERE id = ?
                """, (t["id"],))

            conn.commit()
            conn.close()
            logger.info(f"[HistGen] Fed {fed_count} stories to stock_stories (RAG AI)")
            return {"fed": fed_count, "total_pending": len(trades)}
        except Exception as e:
            logger.error(f"feed_to_ai_learning error: {e}")
            return {"fed": 0, "error": str(e)}

    def _build_arabic_story(self, trade: Dict) -> str:
        """يبني قصة عربية للـ AI يستخدمها في الـ RAG prompts."""
        outcome_ar = {"WIN": "نجح", "LOSS": "فشل", "BREAKEVEN": "محايد"}.get(
            trade["outcome"], trade["outcome"]
        )
        pattern_ar = {
            "breakout": "اختراق", "reversal": "ارتداد", "accumulation": "تجميع",
            "momentum": "زخم", "volume_spike": "انفجار حجم", "pullback": "تصحيح صعودي",
            "unknown": "غير محدد",
        }.get(trade["pattern_type"], trade["pattern_type"])
        market_ar = {
            "bull": "صاعد", "bear": "هابط", "sideways": "عرضي", "unknown": "غير محدد",
        }.get(trade["market_condition"], trade["market_condition"])

        rsi_str = f"RSI={trade['rsi_at_buy']:.0f}" if trade.get("rsi_at_buy") else "RSI=N/A"
        vol_str = f"حجم={trade['volume_ratio_at_buy']:.1f}x" if trade.get("volume_ratio_at_buy") else "حجم=N/A"

        return (
            f"سهم {trade['ticker']} — استراتيجية {trade['strategy']} ({pattern_ar}). "
            f"السوق كان {market_ar}. شراء @ {trade['buy_price']:.2f} في {trade['buy_date']}. "
            f"{rsi_str}، {vol_str}. "
            f"بيع @ {trade['sell_price']:.2f} بعد {trade['holding_days']} يوم. "
            f"النتيجة: {outcome_ar} ({trade['pnl_pct']:+.1f}%)."
        )

    # ─── Stats ───────────────────────────────────────────────────────────

    def get_stats(self) -> Dict:
        """إحصائيات الصفقات التاريخية المولّدة."""
        try:
            conn = self._conn(self.predictions_db)
            conn.row_factory = sqlite3.Row

            total = conn.execute("SELECT COUNT(*) FROM historical_trades").fetchone()[0]
            by_outcome = conn.execute("""
                SELECT outcome, COUNT(*) as cnt, AVG(pnl_pct) as avg_pnl
                FROM historical_trades GROUP BY outcome
            """).fetchall()
            by_pattern = conn.execute("""
                SELECT pattern_type, COUNT(*) as cnt,
                       SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
                       AVG(pnl_pct) as avg_pnl
                FROM historical_trades GROUP BY pattern_type ORDER BY cnt DESC
            """).fetchall()
            by_strategy = conn.execute("""
                SELECT strategy, COUNT(*) as cnt,
                       SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
                       AVG(pnl_pct) as avg_pnl
                FROM historical_trades GROUP BY strategy ORDER BY cnt DESC
            """).fetchall()
            by_market = conn.execute("""
                SELECT market_condition, COUNT(*) as cnt,
                       SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins
                FROM historical_trades GROUP BY market_condition
            """).fetchall()
            fed = conn.execute("SELECT COUNT(*) FROM historical_trades WHERE fed_to_ai=1").fetchone()[0]
            stories = conn.execute("SELECT COUNT(*) FROM stock_stories").fetchone()[0]

            conn.close()

            return {
                "total_historical_trades": total,
                "fed_to_ai_stories": fed,
                "total_stock_stories": stories,
                "by_outcome": [dict(r) for r in by_outcome],
                "by_pattern": [dict(r) for r in by_pattern],
                "by_strategy": [dict(r) for r in by_strategy],
                "by_market_condition": [dict(r) for r in by_market],
            }
        except Exception as e:
            logger.error(f"get_stats error: {e}")
            return {"error": str(e)}


# ─── CLI / Self-Test ─────────────────────────────────────────────────────

def main():
    """للتشغيل اليدوي: python3 ai/historical_trade_generator.py"""
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    gen = HistoricalTradeGenerator()

    # لو فيه argument "stats" بس اطبع الإحصائيات
    if len(sys.argv) > 1 and sys.argv[1] == "stats":
        stats = gen.get_stats()
        print(json.dumps(stats, indent=2, ensure_ascii=False, default=str))
        return

    # لو "feed" بس غذّي الـ AI بالصفقات الموجودة
    if len(sys.argv) > 1 and sys.argv[1] == "feed":
        result = gen.feed_to_ai_learning()
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    # default: ولّد صفقات + غذّي AI + اطبع stats
    # استخدم ticker_limit=10 للـ test السريع
    ticker_limit = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 10

    logger.info(f"Generating trades for up to {ticker_limit} tickers...")
    result = gen.generate_all_trades(days_back=180, max_trades_per_ticker=50, ticker_limit=ticker_limit)
    print("\n=== Generation Result ===")
    print(json.dumps(result, indent=2, ensure_ascii=False))

    # Feed to AI
    logger.info("Feeding trades to AI (stock_stories)...")
    feed_result = gen.feed_to_ai_learning()
    print("\n=== AI Feed Result ===")
    print(json.dumps(feed_result, indent=2, ensure_ascii=False))

    # Stats
    print("\n=== Final Stats ===")
    stats = gen.get_stats()
    print(json.dumps(stats, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    import json
    main()
