#!/usr/bin/env python3
"""
Hot Stocks Detector — كاشف الأسهم الساخنة
==========================================
يكتشف الأسهم اللي بتبدأ تطلع أثناء الجلسة (intraday) قبل ما تطلع كتير.
المشكلة الحالية: المشروع بيحلل يومي/ساعي، بس الـ momentum بيحصل بالدقايق.

بيوفّر 3 منتجات:
  1. detect_hot_stocks()     — أسهم طالعة النهارده بحجم أعلى من المتوسط + RSI معقول + maestro_score كويس
  2. detect_breakouts()      — أسهم اخترقت resistance في آخر N يوم مع volume spike
  3. detect_volume_spikes()  — أسهم volume النهارده > 2x متوسط 10 أيام (مؤشر مبكر جداً)

يقرأ من:
  - stocks.db         (جدول: stocks)
  - price_history.db  (جدول: price_history) — لو مش موجود بيfallback لـ stock_price_history / stock_daily_prices
  - predictions.db    (لو موجود) — بيستخدم master_score

نمط الكود متبوع من smart_portfolio_monitor.py.
"""

from __future__ import annotations

import re
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

# --- مسارات الـ DBs — نفس pattern بتاع smart_portfolio_monitor.py ---
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')

# --- اختصارات لوحدات الحجم (K / M / B) ---
# البيانات بتدخل أحياناً كنص: "2.28 M" أو "382.72 K" مع مسافة narrow no-break (U+202F).
_VOL_SUFFIXES: Dict[str, float] = {
    'K': 1_000.0,
    'M': 1_000_000.0,
    'B': 1_000_000_000.0,
}


def _parse_volume(value: Any) -> float:
    """
    تحويل قيمة الـ volume لرقم عشري بسيط.

    يدعم:
      - "2.28 M" / "2.28M" / "2.28\\u202fM"  → 2_280_000.0
      - "382.72 K"                            → 382_720.0
      - "14.17 B"                             → 14_170_000_000.0
      - 123 (int/float)                       → 123.0
      - "123.45"                              → 123.45
      - None / ""                             → 0.0
    """
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    # إزالة أي مسافات (عادية أو narrow no-break U+202F)
    s = re.sub(r'[\s\u202f]+', '', str(value).strip())
    if not s:
        return 0.0
    last = s[-1].upper()
    if last in _VOL_SUFFIXES:
        try:
            return float(s[:-1]) * _VOL_SUFFIXES[last]
        except ValueError:
            return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


# ============================================================================
# Dataclasses للنتائج
# ============================================================================

@dataclass
class HotStock:
    """سهم ساخن مكتشف أثناء الجلسة."""
    ticker: str
    name: str
    current_price: float
    change_pct: float
    volume_ratio: float
    rsi: float
    maestro_score: float
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BreakoutStock:
    """سهم اخترق resistance."""
    ticker: str
    breakout_price: float
    volume_spike: float
    days_since_breakout: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VolumeSpikeStock:
    """سهم فيه volume spike."""
    ticker: str
    today_volume: float
    avg_volume: float
    spike_ratio: float
    price_change: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================================
# HotStocksDetector
# ============================================================================

class HotStocksDetector:
    """كاشف الأسهم الساخنة أثناء الجلسة."""

    def __init__(self):
        """تحديد مسارات الـ DBs الثلاثة."""
        self.stocks_db = STOCKS_DB
        self.ph_db = PRICE_HISTORY_DB
        self.predictions_db = PREDICTIONS_DB

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------

    def _connect(self, db_path: str) -> Optional[sqlite3.Connection]:
        """فتح اتصال آمن بـ DB. يرجع None لو الملف مش موجود أو فشل الفتح."""
        if not Path(db_path).exists():
            logger.warning("DB مش موجود: %s", db_path)
            return None
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(db_path, writable=False)
            conn.row_factory = sqlite3.Row  # للوصول بالاسم
            return conn
        except sqlite3.Error as e:
            logger.warning("فشل فتح DB %s: %s", db_path, e)
            return None

    def _has_table(self, conn: sqlite3.Connection, table: str) -> bool:
        """فحص وجود table في الـ DB."""
        try:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            return row is not None
        except sqlite3.Error:
            return False

    def _has_column(self, conn: sqlite3.Connection, table: str, column: str) -> bool:
        """فحص وجود column في table معينة."""
        try:
            rows = conn.execute(f'PRAGMA table_info({table})').fetchall()
            return any(r[1] == column for r in rows)
        except sqlite3.Error:
            return False

    # ------------------------------------------------------------------
    # maestro_score: مصادر متعددة + fallback
    # ------------------------------------------------------------------

    def _get_maestro_scores(self, conn: sqlite3.Connection) -> Dict[str, float]:
        """
        جلب maestro_score لكل تيكر من stocks.db.

        أولوية المصادر:
          1. column `maestro_score` في جدول `stocks` (لو موجود)
          2. أحدث `master_score` من جدول `cached_analysis` (0-100 معقول)
          3. أحدث `master_score` من جدول `predictions` (fallback أخير)

        لو مفيش أي مصدر، نرجّع dict فاضي والـ caller يلجأ للدرجة الـ synthetic.
        """
        scores: Dict[str, float] = {}

        # 1. column مباشر في stocks
        try:
            if self._has_column(conn, 'stocks', 'maestro_score'):
                for row in conn.execute(
                    'SELECT ticker, maestro_score FROM stocks '
                    'WHERE ticker IS NOT NULL AND maestro_score IS NOT NULL'
                ).fetchall():
                    scores[row['ticker']] = float(row['maestro_score'])
                if scores:
                    return scores
        except sqlite3.Error as e:
            logger.warning("فشل قراءة maestro_score من stocks: %s", e)

        # 2. cached_analysis (الأولوية الثانية — درجاته 0-100 سليمة)
        try:
            if self._has_table(conn, 'cached_analysis') and self._has_column(conn, 'cached_analysis', 'master_score'):
                for row in conn.execute(
                    'SELECT ticker, master_score FROM cached_analysis '
                    'WHERE master_score IS NOT NULL AND ticker IS NOT NULL '
                    'AND id IN (SELECT MAX(id) FROM cached_analysis GROUP BY ticker)'
                ).fetchall():
                    scores[row['ticker']] = float(row['master_score'])
                if scores:
                    return scores
        except sqlite3.Error as e:
            logger.warning("فشل قراءة master_score من cached_analysis: %s", e)

        # 3. predictions (fallback أخير)
        try:
            if self._has_table(conn, 'predictions') and self._has_column(conn, 'predictions', 'master_score'):
                for row in conn.execute(
                    'SELECT ticker, master_score FROM predictions '
                    'WHERE master_score IS NOT NULL AND ticker IS NOT NULL '
                    'AND id IN (SELECT MAX(id) FROM predictions GROUP BY ticker)'
                ).fetchall():
                    scores[row['ticker']] = float(row['master_score'])
                if scores:
                    return scores
        except sqlite3.Error as e:
            logger.warning("فشل قراءة master_score من predictions: %s", e)

        return scores

    def _compute_synthetic_score(
        self, change_pct: float, rsi: float, volume_ratio: float
    ) -> float:
        """
        درجة synthetic (0-100) لو maestro_score مش متوفر لأي سهم.

        بتعتمد على:
          - momentum (change_pct × 5 + volume_ratio × 10) — أقصى 50
          - RSI score: الأفضل قرب 60 (مكان فيه مجال للطلوع بدون overbought)
        """
        momentum = min(50.0, change_pct * 5.0 + volume_ratio * 10.0)
        if rsi and 0 < rsi <= 100:
            rsi_score = max(0.0, 50.0 - abs(rsi - 60.0) * 1.5)
        else:
            rsi_score = 25.0  # قيمة محايدة لو RSI غير متوفر
        score = momentum + rsi_score
        return max(0.0, min(100.0, score))

    # ------------------------------------------------------------------
    # price_history helper (للـ breakouts و volume_spikes)
    # ------------------------------------------------------------------

    def _get_price_history_rows(
        self, ticker: str, lookback_days: int
    ) -> List[Dict[str, Any]]:
        """
        جلب آخر N يوم من price history لسهم معين.

        PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
        The unified reader returns candles oldest-first as
        ``[{date, open, high, low, close, volume}, ...]``. We reverse to
        newest-first (matching the previous contract — callers use
        ``rows[0]`` as the latest bar) and project to the legacy column names
        (``date``, ``high_price``, ``close_price``, ``volume``) so callers
        keep working unchanged.
        """
        from data.prices import load_price_history

        # Fetch a few extra rows to absorb any recent-day gaps.
        candles = load_price_history(ticker, limit=lookback_days + 5)

        # Reverse to newest-first and project to legacy column names.
        rows: List[Dict[str, Any]] = []
        for c in reversed(candles):
            rows.append({
                'date': c.get('date'),
                'high_price': c.get('high'),
                'close_price': c.get('close'),
                'volume': c.get('volume'),
            })
        return rows

    def _get_tickers_for_market(self, market: str) -> List[str]:
        """جلب كل التيكرز لسوق معيّن من stocks.db."""
        conn = self._connect(self.stocks_db)
        if conn is None:
            return []
        try:
            rows = conn.execute(
                'SELECT ticker FROM stocks WHERE market = ? AND ticker IS NOT NULL',
                (market,),
            ).fetchall()
            conn.close()
            return [r['ticker'] for r in rows if r['ticker']]
        except sqlite3.Error as e:
            logger.warning("فشل جلب tickers للسوق %s: %s", market, e)
            conn.close()
            return []

    def _get_avg_volumes_from_history(
        self, tickers: List[str], lookback_days: int = 20
    ) -> Dict[str, float]:
        """
        جلب متوسط حجم آخر N يوم لكل تيكر من price_history.

        أعلى موثوقية من column `avg_volume` في stocks table (اللي وحداته مختلفة
        عن column `volume`). بيستخدم window function عشان يستثني أحدث يوم.

        الأولوية للمصادر:
          1. price_history.db → table `price_history`
          2. stocks.db → table `stock_price_history`
          3. stocks.db → table `stock_daily_prices`

        يرجّع dict {ticker: avg_volume} بالوحدات الفعلية (shares).
        """
        if not tickers:
            return {}
        result: Dict[str, float] = {}
        placeholders = ','.join('?' * len(tickers))

        # 1. price_history.db
        conn = self._connect(self.ph_db)
        if conn is not None:
            try:
                rows = conn.execute(
                    f'''SELECT ticker, AVG(volume) as avg_vol
                        FROM (
                            SELECT ticker, volume,
                                   ROW_NUMBER() OVER (
                                       PARTITION BY ticker ORDER BY date DESC
                                   ) as rn
                            FROM price_history
                            WHERE ticker IN ({placeholders})
                        )
                        WHERE rn > 1 AND rn <= ?
                        GROUP BY ticker''',
                    (*tickers, lookback_days + 1),
                ).fetchall()
                for r in rows:
                    if r['avg_vol']:
                        result[r['ticker']] = float(r['avg_vol'])
                conn.close()
                if result:
                    return result
            except sqlite3.Error as e:
                logger.debug("price_history avg_volume فشل: %s", e)
                conn.close()

        # 2. stock_price_history أو stock_daily_prices داخل stocks.db
        conn = self._connect(self.stocks_db)
        if conn is None:
            return {}
        try:
            if self._has_table(conn, 'stock_price_history'):
                table, date_col, vol_col = 'stock_price_history', 'date', 'volume'
            elif self._has_table(conn, 'stock_daily_prices'):
                table, date_col, vol_col = 'stock_daily_prices', 'price_date', 'volume'
            else:
                conn.close()
                return {}
            rows = conn.execute(
                f'''SELECT ticker, AVG({vol_col}) as avg_vol
                    FROM (
                        SELECT ticker, {vol_col},
                               ROW_NUMBER() OVER (
                                   PARTITION BY ticker ORDER BY {date_col} DESC
                               ) as rn
                        FROM {table}
                        WHERE ticker IN ({placeholders})
                    )
                    WHERE rn > 1 AND rn <= ?
                    GROUP BY ticker''',
                (*tickers, lookback_days + 1),
            ).fetchall()
            for r in rows:
                if r['avg_vol']:
                    result[r['ticker']] = float(r['avg_vol'])
        except sqlite3.Error as e:
            logger.debug("stock_price_history avg_volume فشل: %s", e)
        conn.close()
        return result

    # ------------------------------------------------------------------
    # 1) detect_hot_stocks
    # ------------------------------------------------------------------

    def detect_hot_stocks(
        self,
        market: str = 'EGX',
        min_change_pct: float = 2.0,
        min_volume_ratio: float = 1.5,
    ) -> List[Dict[str, Any]]:
        """
        كشف الأسهم الساخنة أثناء الجلسة.

        الفلترة:
          - change_pct     >= min_change_pct   (طلوع النهارده)
          - volume_ratio   >= min_volume_ratio (حجم أعلى من المتوسط)
          - rsi BETWEEN 45 AND 70              (مش overbought، فيه مجال للطلوع)
          - maestro_score  >= 40               (سهم كويس أصلاً)

        يرجّع list of dicts:
          ticker, name, current_price, change_pct, volume_ratio, rsi, maestro_score, reason
        """
        conn = self._connect(self.stocks_db)
        if conn is None:
            return []

        # جلب maestro_scores مرة واحدة (تحسين الأداء)
        maestro_scores = self._get_maestro_scores(conn)

        # فحص الأعمدة المتوفرة في stocks
        has_rsi = self._has_column(conn, 'stocks', 'rsi')
        has_avg_vol = self._has_column(conn, 'stocks', 'avg_volume')
        has_volume = self._has_column(conn, 'stocks', 'volume')
        has_change = self._has_column(conn, 'stocks', 'change_percent')

        cols = [
            'ticker',
            'name',
            'current_price',
            'change_percent' if has_change else 'NULL as change_percent',
            'volume' if has_volume else 'NULL as volume',
            'avg_volume' if has_avg_vol else 'NULL as avg_volume',
            'rsi' if has_rsi else 'NULL as rsi',
        ]
        query = (
            f"SELECT {', '.join(cols)} FROM stocks "
            "WHERE market = ? AND ticker IS NOT NULL"
        )
        try:
            rows = conn.execute(query, (market,)).fetchall()
        except sqlite3.Error as e:
            logger.warning("فشل query stocks في detect_hot_stocks: %s", e)
            conn.close()
            return []
        conn.close()

        # جلب متوسط الحجم من price_history دفعة واحدة لكل التيكرز
        # (أعلى موثوقية من column avg_volume اللي وحداته مختلفة عن volume)
        all_tickers = [r['ticker'] for r in rows if r['ticker']]
        hist_avg_volumes = self._get_avg_volumes_from_history(all_tickers, lookback_days=20)

        results: List[Dict[str, Any]] = []
        for row in rows:
            try:
                ticker = row['ticker'] or ''
                if not ticker:
                    continue
                name = row['name'] or ticker
                current_price = float(row['current_price'] or 0)
                change_pct = float(row['change_percent'] or 0)

                # حجم اليوم (من stocks.volume — بالوحدات الفعلية)
                volume = _parse_volume(row['volume'])

                # متوسط الحجم: نفضّل price_history (موثوق)، وإلا نرجع لـ stocks.avg_volume
                avg_volume = hist_avg_volumes.get(ticker)
                avg_reliable = avg_volume is not None and avg_volume > 0
                if not avg_reliable:
                    avg_volume = float(row['avg_volume'] or 0) if has_avg_vol else 0.0
                volume_ratio = (volume / avg_volume) if avg_volume > 0 else 0.0

                # فحص منطقية: volume_ratio > 200x غالباً بيشير لمشكلة وحدات
                # بين stocks.volume (shares فعلية) والمصدر التاني.
                # نلغي القيمة عشان نفلتر السهم بأمان.
                if volume_ratio > 200.0:
                    volume_ratio = 0.0

                # RSI
                rsi = float(row['rsi'] or 0) if has_rsi else 0.0

                # maestro_score
                maestro_score = maestro_scores.get(ticker)
                if maestro_score is None:
                    maestro_score = self._compute_synthetic_score(
                        change_pct, rsi, volume_ratio
                    )

                # --- الفلترة ---
                reasons: List[str] = []

                if change_pct < min_change_pct:
                    continue
                reasons.append(f"change +{change_pct:.2f}%")

                if volume_ratio < min_volume_ratio:
                    continue
                reasons.append(f"vol {volume_ratio:.2f}x")

                # RSI: لو موجود نطبّق الفلتر، لو مش موجود نتخطاه
                if has_rsi and rsi > 0:
                    if not (45 <= rsi <= 70):
                        continue
                    reasons.append(f"RSI {rsi:.1f}")
                else:
                    reasons.append("RSI غير متوفر")

                if maestro_score < 40:
                    continue
                reasons.append(f"maestro {maestro_score:.0f}")

                results.append({
                    'ticker': ticker,
                    'name': name,
                    'current_price': round(current_price, 4),
                    'change_pct': round(change_pct, 2),
                    'volume_ratio': round(volume_ratio, 2),
                    'rsi': round(rsi, 2),
                    'maestro_score': round(maestro_score, 2),
                    'reason': ' | '.join(reasons),
                })
            except (TypeError, ValueError) as e:
                logger.debug("تجاهل سهم بسبب خطأ parse: %s", e)
                continue

        # ترتيب: الأعلى في change_pct ثم volume_ratio
        results.sort(
            key=lambda x: (x['change_pct'], x['volume_ratio']),
            reverse=True,
        )
        return results

    # ------------------------------------------------------------------
    # 2) detect_breakouts
    # ------------------------------------------------------------------

    def detect_breakouts(
        self,
        market: str = 'EGX',
        lookback_days: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        كشف الأسهم اللي اخترقت resistance (breakout) في آخر N يوم.

        المعايير:
          - close اليوم > max(highs آخر lookback_days يوم قبل اليوم ده)
          - volume اليوم > 1.5x متوسط volume نفس الفترة

        يرجّع:
          ticker, breakout_price, volume_spike, days_since_breakout
        """
        tickers = self._get_tickers_for_market(market)
        if not tickers:
            return []

        results: List[Dict[str, Any]] = []
        for ticker in tickers:
            try:
                rows = self._get_price_history_rows(ticker, lookback_days)
                if len(rows) < 3:
                    continue

                # الصف الأول = الأحدث (مرشّح الـ breakout)
                latest = rows[0]
                latest_date = latest['date']
                latest_close = float(latest['close_price'] or 0)
                latest_volume = _parse_volume(latest['volume'])

                # الـ lookback السابق (نستثني اليوم ده)
                prev_rows = rows[1:lookback_days + 1]
                if not prev_rows:
                    continue

                prev_highs = [float(r['high_price'] or 0) for r in prev_rows]
                prev_volumes = [_parse_volume(r['volume']) for r in prev_rows]
                max_high = max(prev_highs) if prev_highs else 0
                avg_volume = (
                    sum(prev_volumes) / len(prev_volumes) if prev_volumes else 0
                )

                if max_high <= 0 or avg_volume <= 0:
                    continue

                # --- معايير breakout ---
                if latest_close <= max_high:
                    continue
                volume_spike = latest_volume / avg_volume
                if volume_spike < 1.5:
                    continue

                # حساب days_since_breakout
                days_since = 0
                try:
                    latest_dt = datetime.fromisoformat(
                        str(latest_date).split(' ')[0]
                    )
                    days_since = max(0, (datetime.now() - latest_dt).days)
                except (ValueError, TypeError):
                    days_since = 0

                results.append({
                    'ticker': ticker,
                    'breakout_price': round(latest_close, 4),
                    'volume_spike': round(volume_spike, 2),
                    'days_since_breakout': days_since,
                })
            except (TypeError, ValueError) as e:
                logger.debug("تجاهل %s في detect_breakouts: %s", ticker, e)
                continue

        # ترتيب: الأحدث breakout أولاً (أقل days_since) ثم أكبر volume_spike
        results.sort(
            key=lambda x: (x['days_since_breakout'], -x['volume_spike'])
        )
        return results

    # ------------------------------------------------------------------
    # 3) detect_volume_spikes
    # ------------------------------------------------------------------

    def detect_volume_spikes(
        self,
        market: str = 'EGX',
        min_spike: float = 2.0,
    ) -> List[Dict[str, Any]]:
        """
        كشف volume spikes — مؤشر مبكر جداً (الـ volume غالباً يسبق price movement).

        المعايير:
          - volume اليوم > min_spike × متوسط آخر 10 أيام

        يرجّع:
          ticker, today_volume, avg_volume, spike_ratio, price_change
        """
        tickers = self._get_tickers_for_market(market)
        if not tickers:
            return []

        results: List[Dict[str, Any]] = []
        for ticker in tickers:
            try:
                rows = self._get_price_history_rows(ticker, 10)
                if len(rows) < 2:
                    continue

                latest = rows[0]
                today_volume = _parse_volume(latest['volume'])
                if today_volume <= 0:
                    continue

                # آخر 10 أيام قبل اليوم ده
                prev_rows = rows[1:11]
                prev_volumes = [
                    _parse_volume(r['volume']) for r in prev_rows
                    if r['volume'] is not None
                ]
                if not prev_volumes:
                    continue
                avg_volume = sum(prev_volumes) / len(prev_volumes)
                if avg_volume <= 0:
                    continue

                spike_ratio = today_volume / avg_volume
                if spike_ratio < min_spike:
                    continue

                # price change (اليوم ده مقارنة بالأمس)
                latest_close = float(latest['close_price'] or 0)
                prev_close = float(prev_rows[0]['close_price'] or 0) if prev_rows else 0
                price_change = (
                    (latest_close - prev_close) / prev_close * 100
                    if prev_close > 0 else 0.0
                )

                results.append({
                    'ticker': ticker,
                    'today_volume': round(today_volume, 0),
                    'avg_volume': round(avg_volume, 0),
                    'spike_ratio': round(spike_ratio, 2),
                    'price_change': round(price_change, 2),
                })
            except (TypeError, ValueError) as e:
                logger.debug("تجاهل %s في detect_volume_spikes: %s", ticker, e)
                continue

        # ترتيب: أكبر spike_ratio أولاً
        results.sort(key=lambda x: x['spike_ratio'], reverse=True)
        return results


# ============================================================================
# main() للـ self-test
# ============================================================================

def main() -> None:
    """self-test — يطبع نتائج الكشف الثلاثة."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )

    detector = HotStocksDetector()
    print(f"\n{'=' * 70}")
    print("🔥 Hot Stocks Detector — كاشف الأسهم الساخنة")
    print(f"{'=' * 70}")
    print(f"  STOCKS_DB        : {STOCKS_DB}")
    print(f"  PRICE_HISTORY_DB : {PRICE_HISTORY_DB}")
    print(f"  PREDICTIONS_DB   : {PREDICTIONS_DB}")

    # 1) Hot Stocks
    print(f"\n--- 1️⃣  Hot Stocks  (change ≥ 2% / vol ≥ 1.5x / RSI 45-70 / maestro ≥ 40) ---")
    hot = detector.detect_hot_stocks(
        market='EGX', min_change_pct=2.0, min_volume_ratio=1.5
    )
    print(f"  Found: {len(hot)} stock(s)")
    for s in hot[:20]:
        print(
            f"  • {s['ticker']:<8} | {s['name'][:24]:<24} | "
            f"price={s['current_price']:<10} chg={s['change_pct']:+.2f}% | "
            f"vol={s['volume_ratio']:.2f}x | RSI={s['rsi']:.1f} | "
            f"ms={s['maestro_score']:.0f}"
        )
        print(f"      reason: {s['reason']}")

    # 2) Breakouts
    print(f"\n--- 2️⃣  Breakouts  (close > 20d-high + vol > 1.5x avg) ---")
    bo = detector.detect_breakouts(market='EGX', lookback_days=20)
    print(f"  Found: {len(bo)} stock(s)")
    for b in bo[:20]:
        print(
            f"  • {b['ticker']:<8} | breakout_price={b['breakout_price']:<10} | "
            f"vol_spike={b['volume_spike']:.2f}x | days_ago={b['days_since_breakout']}"
        )

    # 3) Volume Spikes
    print(f"\n--- 3️⃣  Volume Spikes  (today > 2x avg of last 10 days) ---")
    vs = detector.detect_volume_spikes(market='EGX', min_spike=2.0)
    print(f"  Found: {len(vs)} stock(s)")
    for v in vs[:20]:
        print(
            f"  • {v['ticker']:<8} | today_vol={v['today_volume']:<14,.0f} | "
            f"avg_vol={v['avg_volume']:<14,.0f} | spike={v['spike_ratio']:.2f}x | "
            f"price_chg={v['price_change']:+.2f}%"
        )

    print(f"\n{'=' * 70}")
    print(f"Done.  hot={len(hot)} | breakouts={len(bo)} | volume_spikes={len(vs)}")
    print(f"{'=' * 70}\n")


if __name__ == '__main__':
    main()
