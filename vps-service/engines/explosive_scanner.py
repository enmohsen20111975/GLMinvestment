#!/usr/bin/env python3
"""
Explosive Scanner v2 — ماسح القنابل (الصايع الحقيقي)
=====================================================
bulletproof ضد أي بيانات + منطق الشارع الحقيقي

المنطق الجديد (الصايع):
1. لو الحجم عالي والسعر ثابت = "تجميع خفي" (الكنز)
2. لو الحجم عالي والسعر طالع = "انفجار" (شراء)
3. لو الحجم عالي والسعر نازل = "تصريف" (بيع - فخ!)
4. لو الحجم عالي عند الدعم = "شراء ذكي"
5. لو الحجم عالي عند المقاومة = "فخ" (بيع للعربان)

EXPLOSIVE_SCORE = Volume_Surge(25%) + Price_Position(30%) + Sector_Heat(20%) + Smart_Money(15%) + Market(10%)

Author: M2Y Developers Team
Version: 2.0.0 - Bulletproof
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

MIN_PRICE = 5.0
MIN_VOLUME_RATIO = 1.5


def _safe_float(val, default=0.0):
    """تحويل آمن 100% - يتعامل مع K/M/B suffixes و Unicode spaces"""
    if val is None:
        return default
    try:
        s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').replace('\xa0', '').strip()
        # Handle K/M/B suffixes (e.g. "219.87K" → 219870)
        import re
        m = re.match(r'^([+-]?\d+\.?\d*)\s*([KMBkmb])?$', s)
        if m:
            num = float(m.group(1))
            suffix = (m.group(2) or '').upper()
            if suffix == 'K':
                num *= 1_000
            elif suffix == 'M':
                num *= 1_000_000
            elif suffix == 'B':
                num *= 1_000_000_000
            return num if num == num else default  # NaN check
        return default
    except (ValueError, TypeError):
        return default


def _safe_div(num, denom, default=0.0):
    """قسمة آمنة 100%"""
    n = _safe_float(num)
    d = _safe_float(denom)
    if d == 0:
        return default
    try:
        result = n / d
        if result != result:  # NaN
            return default
        return min(result, 100.0)  # cap at 100x
    except:
        return default


@dataclass
class ExplosiveScore:
    """نتيجة Explosive Score"""
    ticker: str
    name: str
    current_price: float
    change_percent: float
    explosive_score: float
    label: str
    label_en: str
    color: str
    volume_surge: float
    price_position: float
    sector_heat: float
    smart_money: float
    market_condition: float
    sector: str
    volume_ratio: float
    avg_volume_20d: float
    rsi: Optional[float]
    dist_to_52w_high: float
    dist_to_support: float
    sector_turnover_pct: float
    # Smart money analysis
    pattern: str  # "تجميع خفي" / "انفجار" / "تصريف" / "طبيعي"
    pattern_en: str
    action: str
    action_en: str
    position_size: float
    stop_loss: float
    target: float
    excluded: bool
    exclusion_reason: str
    # BRIEF-042: Early Trend Catcher flag
    is_early_trend: bool = False
    early_trend_reason: str = ''

    def to_dict(self) -> Dict:
        return asdict(self)


class ExplosiveScanner:
    """ماسح القنابل - الصايع الحقيقي"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or STOCKS_DB

    def _get_conn(self):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.db_path, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        return conn

    def _get_market_condition(self, conn) -> float:
        """Layer 5: Market Condition (10%)"""
        try:
            cur = conn.cursor()
            egx30 = cur.execute("SELECT change_percent FROM market_indices WHERE symbol = 'EGX30'").fetchone()
            if not egx30:
                return 50.0
            change = _safe_float(egx30['change_percent'], 0.0)
            if change > 1.0:
                return 100.0
            elif change > 0.3:
                return 75.0
            elif change > -0.3:
                return 50.0
            elif change > -1.0:
                return 25.0
            else:
                return 0.0
        except:
            return 50.0

    def _get_sector_turnover_pct(self, conn, sector: str) -> float:
        """نسبة القطاع من سيولة السوق - مع fallback لـ stock_daily_prices"""
        try:
            if not sector:
                return 10.0  # default neutral if no sector
            cur = conn.cursor()

            # Method 1: stocks table (live volume * price)
            total_row = cur.execute("""
                SELECT SUM(CAST(volume AS REAL) * CAST(current_price AS REAL)) as t
                FROM stocks WHERE current_price > 0 AND is_active = 1
            """).fetchone()
            total = _safe_float(total_row['t'] if total_row else 0)

            sector_row = cur.execute("""
                SELECT SUM(CAST(volume AS REAL) * CAST(current_price AS REAL)) as t
                FROM stocks WHERE sector = ? AND current_price > 0 AND is_active = 1
            """, (sector,)).fetchone()
            sector_total = _safe_float(sector_row['t'] if sector_row else 0)

            # If total is 0 (no volume data), use stock count as proxy
            if total <= 0 or sector_total <= 0:
                # Fallback: use number of stocks in sector vs total
                sector_count = cur.execute("""
                    SELECT COUNT(*) FROM stocks
                    WHERE sector = ? AND current_price > 0 AND is_active = 1
                """, (sector,)).fetchone()[0]
                total_count = cur.execute("""
                    SELECT COUNT(*) FROM stocks
                    WHERE current_price > 0 AND is_active = 1
                """).fetchone()[0]

                if total_count > 0:
                    return (sector_count / total_count * 100)
                return 10.0  # neutral

            return _safe_div(sector_total, total, 0.0) * 100
        except:
            return 10.0  # neutral on error

    def _get_avg_volume_20d(self, conn, ticker: str) -> float:
        """متوسط حجم 20 يوم - من البيانات التاريخية"""
        try:
            cur = conn.cursor()
            row = cur.execute("""
                SELECT AVG(CAST(volume AS REAL)) as avg_vol
                FROM stock_daily_prices
                WHERE ticker = ? AND price_date >= date('now', '-20 days')
                  AND volume > 100
            """, (ticker,)).fetchone()
            return _safe_float(row['avg_vol'] if row else 0)
        except:
            return 0.0

    def _detect_smart_money_pattern(self, volume_ratio, change_percent, price_position_score, ticker=None, conn=None):
        """
        منطق الصايع الحقيقي - "السعر بيكذب، الحجم بيقول الحقيقة"

        النمط الذهبي المكتشف من تحليل EGAS (+51.6%):
        1. حجم منخفض جداً + سعر ثابت = تجميع صامت (الكنز!)
        2. انفجار حجم مفاجئ = الإشارة (الكبير بدأ التحرك)
        3. استقرار السعر بعد القفزة = تأكيد

        أنماط إضافية:
        - حجم عالي + سعر ثابت = تجميع خفي
        - حجم عالي + سعر طالع = انفجار (شراء)
        - حجم عالي + سعر نازل = تصريف (فخ!)
        """
        try:
            change = _safe_float(change_percent, 0.0)
            vol = _safe_float(volume_ratio, 1.0)

            # === النمط الذهبي: التجميع الصامت → الصحوة ===
            if ticker and conn:
                try:
                    cur = conn.cursor()
                    vol_rows = cur.execute("""
                        SELECT volume FROM stock_daily_prices
                        WHERE ticker = ? AND volume > 0
                        ORDER BY price_date DESC LIMIT 7
                    """, (ticker,)).fetchall()

                    if len(vol_rows) >= 6:
                        vols = [_safe_float(r[0] if isinstance(r[0], (int, float)) else 0, 0) for r in vol_rows]
                        latest_vol = vols[0]
                        prev_5_avg = sum(vols[1:6]) / 5 if len(vols) >= 6 else 0

                        # نمط EGAS: حجم < 5000 لـ 5 أيام ثم انفجار 10x+
                        if prev_5_avg > 0 and prev_5_avg < 5000 and latest_vol > prev_5_avg * 10:
                            surge_ratio = latest_vol / prev_5_avg
                            if surge_ratio > 100:
                                return "صحوة من النوم (كنز!)", "SLEEPER_AWAKEN", 100.0
                            elif surge_ratio > 50:
                                return "صحوة من النوم", "SLEEPER_AWAKEN", 90.0
                            elif surge_ratio > 10:
                                return "تجميع صامت -> صحوة", "SILENT_ACCUMULATION", 85.0

                        # تجميع صامت: حجم منخفض + سعر ثابت (لم يصحوا بعد)
                        if prev_5_avg < 5000 and abs(change) < 2:
                            return "تجميع صامت (مراقبة)", "SILENT_WAIT", 70.0

                        # استقرار بعد القفزة: تأكيد المكسب
                        if len(vols) >= 4 and vols[1] > 0 and vols[2] > 0:
                            day2_surge = vols[1] / vols[2] if vols[2] > 0 else 1
                            if day2_surge > 5 and vols[0] < vols[1] * 0.8:
                                return "استقرار بعد القفزة (مكسب مؤكد)", "POST_BREAKOUT_STABLE", 95.0
                except:
                    pass

            # === الأنماط الكلاسيكية ===
            if vol >= 2.0:
                if abs(change) < 0.5:
                    # Volume surge but price barely moved = ACCUMULATION (الكنز!)
                    return "تجميع خفي", "ACCUMULATION", 80.0
                elif change > 3.0:
                    # Volume surge + price UP a lot = DISTRIBUTION disguised (الكبير بيبيع للعربان)
                    return "انفجار صاعد (فخ)", "BREAKOUT_TRAP", 30.0
                elif change > 1.0:
                    # Volume surge + price up moderately = possible breakout (راقب)
                    return "صعود بحجم كبير", "BULLISH_VOLUME_SURGE", 50.0
                elif change < -1.0:
                    # Volume surge + price down = DISTRIBUTION (selling = trap!)
                    return "تصريف", "DISTRIBUTION", 10.0
                else:
                    return "حركة طفيفة", "MILD_ACTION", 40.0
            elif vol >= 1.5:
                if abs(change) < 0.5:
                    return "تجميع خفيف", "LIGHT_ACCUMULATION", 60.0
                elif change > 0.5:
                    return "صعود بحجم", "BULLISH_VOLUME", 55.0
                elif change < -0.5:
                    return "هبوط بحجم", "BEARISH_VOLUME", 25.0
                else:
                    return "طبيعي", "NORMAL", 40.0
            else:
                return "هادئ", "QUIET", 20.0
        except:
            return "طبيعي", "NORMAL", 50.0

    def calculate_explosive_score(self, ticker: str) -> Optional[ExplosiveScore]:
        """حساب Explosive Score - bulletproof"""
        conn = self._get_conn()
        cur = conn.cursor()

        try:
            stock = cur.execute("""
                SELECT ticker, name, name_ar, current_price, change_percent, volume,
                       rsi, sector, support, resistance, high_52w, low_52w, avg_volume
                FROM stocks WHERE ticker = ? AND current_price > 0 AND is_active = 1
            """, (ticker,)).fetchone()
        except:
            stock = None

        if not stock:
            conn.close()
            return None

        # Safe extraction
        price = _safe_float(stock['current_price'], 0)
        change = _safe_float(stock['change_percent'], 0)
        volume = _safe_float(stock['volume'], 0)
        rsi = _safe_float(stock['rsi']) if stock['rsi'] else None
        sector = stock['sector'] or 'غير محدد'
        support = _safe_float(stock['support'], 0)
        resistance = _safe_float(stock['resistance'], 0)
        high_52w = _safe_float(stock['high_52w'], 0)
        name = stock['name_ar'] or stock['name'] or ticker

        # ============ EXCLUSION CHECKS ============
        excluded = False
        exclusion_reason = ""

        if price < MIN_PRICE:
            excluded = True
            exclusion_reason = f"سعر < {MIN_PRICE} جنيه (penny = فخ)"

        # Volume ratio - use 20d average, fallback to avg_volume field
        avg_vol_20d = self._get_avg_volume_20d(conn, ticker)
        # avg_volume field is unreliable (sometimes tiny), use it only if > 100
        field_avg_vol = _safe_float(stock['avg_volume'], 0)
        if field_avg_vol < 100:
            field_avg_vol = 0

        # If current volume is 0 (EODHD didn't update it), use latest daily_price volume
        if volume == 0:
            try:
                cur2 = conn.cursor()
                latest_vol_row = cur2.execute("""
                    SELECT volume FROM stock_daily_prices
                    WHERE ticker = ? AND volume > 0
                    ORDER BY price_date DESC LIMIT 1
                """, (ticker,)).fetchone()
                if latest_vol_row:
                    volume = _safe_float(latest_vol_row['volume'], 0)
            except:
                pass

        vol_baseline = avg_vol_20d or field_avg_vol or 0
        if vol_baseline > 100 and volume > 0:
            volume_ratio = min(volume / vol_baseline, 20.0)
        else:
            volume_ratio = 1.0  # can't determine

        # NOTE: Don't exclude low volume stocks!
        # Sleeper pattern (تجميع صامت) needs LOW volume to detect.
        # The smart money detector will check if volume is waking up.
        # Only exclude if volume is 0 (no data at all)
        if not excluded and volume == 0:
            excluded = True
            exclusion_reason = "لا يوجد حجم (لا توجد بيانات)"

        # Sector turnover
        sector_turnover_pct = self._get_sector_turnover_pct(conn, sector)
        if not excluded and sector_turnover_pct < 1:
            excluded = True
            exclusion_reason = f"القطاع بارد ({sector_turnover_pct:.1f}%)"

        # Market condition
        market_condition = self._get_market_condition(conn)
        if not excluded and market_condition < 25:
            excluded = True
            exclusion_reason = "السوق هابط بشدة"

        # Note: don't close conn yet - needed for smart money pattern detection

        # ============ LAYER SCORES ============

        # Layer 1: Volume Surge (25%)
        if volume_ratio >= 5.0:
            vol_score = 100.0
        elif volume_ratio >= 3.0:
            vol_score = 75.0
        elif volume_ratio >= 2.0:
            vol_score = 50.0
        elif volume_ratio >= 1.5:
            vol_score = 25.0
        else:
            vol_score = 0.0

        # Layer 2: Price Position (30%)
        price_score = 50.0
        dist_to_52w_high = 0.0
        dist_to_support = 0.0

        # Distance to 52W high (only if high_52w is valid > 0)
        if high_52w > 0 and price > 0:
            dist_to_52w_high = ((high_52w - price) / high_52w) * 100

        # Distance to support (only if support is valid and < price)
        if support > 0 and support < price:
            dist_to_support = ((price - support) / price) * 100

        # Near support (within 3%) = 80 (opportunity)
        if support > 0 and support < price and dist_to_support < 3:
            price_score = 80.0
        # Near 52W high (within 5%) = 20 (danger)
        elif high_52w > 0 and dist_to_52w_high < 5:
            price_score = 20.0
        # Breaking 52W high = 10 (trap)
        elif high_52w > 0 and dist_to_52w_high < 0:
            price_score = 10.0
        else:
            # Check consolidation from historical data
            try:
                conn2 = self._get_conn()
                cur2 = conn2.cursor()
                vol_row = cur2.execute("""
                    SELECT MIN(CAST(close AS REAL)) as min_c,
                           MAX(CAST(close AS REAL)) as max_c,
                           AVG(CAST(close AS REAL)) as avg_c,
                           COUNT(*) as days
                    FROM stock_daily_prices
                    WHERE ticker = ? AND price_date >= date('now', '-90 days')
                """, (ticker,)).fetchone()
                conn2.close()

                if vol_row and vol_row['days'] and vol_row['days'] > 20:
                    min_c = _safe_float(vol_row['min_c'], 0)
                    max_c = _safe_float(vol_row['max_c'], 0)
                    avg_c = _safe_float(vol_row['avg_c'], 1)
                    if avg_c > 0:
                        range_pct = ((max_c - min_c) / avg_c) * 100
                        if range_pct < 10 and price > max_c * 0.98:
                            price_score = 100.0  # Breaking consolidation
                        elif range_pct < 15:
                            price_score = 60.0
            except:
                pass

        # Layer 3: Sector Heat (20%)
        if sector_turnover_pct >= 25:
            sector_score = 100.0
        elif sector_turnover_pct >= 15:
            sector_score = 75.0
        elif sector_turnover_pct >= 10:
            sector_score = 50.0
        else:
            sector_score = 25.0

        # Layer 4: Smart Money (15%) - منطق الصايع + النمط الذهبي
        pattern_ar, pattern_en, smart_score = self._detect_smart_money_pattern(
            volume_ratio, change, price_score, ticker=ticker, conn=conn
        )

        # Layer 5: Market Condition (10%)
        market_score = market_condition

        # ============ TOTAL ============
        total = (
            vol_score * 0.25 +
            price_score * 0.30 +
            sector_score * 0.20 +
            smart_score * 0.15 +
            market_score * 0.10
        )

        # ============ LABEL ============
        if total >= 75:
            label, label_en, color = "قنبلة", "BOMB", "red"
            action, action_en = "دخول فوري", "ENTER_NOW"
            position, stop, target = 25, -5, 20
        elif total >= 65:
            label, label_en, color = "صاروخ", "ROCKET", "orange"
            action, action_en = "دخول بحذر", "CAUTIOUS_ENTRY"
            position, stop, target = 15, -5, 15
        elif total >= 50:
            label, label_en, color = "شرارة", "SPARK", "amber"
            action, action_en = "استنى تأكيد", "WAIT_CONFIRM"
            position, stop, target = 0, 0, 0
        else:
            label, label_en, color = "ميت", "DEAD", "gray"
            action, action_en = "فوت", "SKIP"
            position, stop, target = 0, 0, 0

        if excluded:
            label, label_en, color = "مستثنى", "EXCLUDED", "slate"
            action, action_en = "ممنوع", "FORBIDDEN"
            position, stop, target = 0, 0, 0
            total = 0.0

        conn.close()

        return ExplosiveScore(
            ticker=ticker,
            name=name,
            current_price=round(price, 2),
            change_percent=round(change, 2),
            explosive_score=round(total, 1),
            label=label,
            label_en=label_en,
            color=color,
            volume_surge=round(vol_score, 1),
            price_position=round(price_score, 1),
            sector_heat=round(sector_score, 1),
            smart_money=round(smart_score, 1),
            market_condition=round(market_score, 1),
            sector=sector,
            volume_ratio=round(volume_ratio, 2),
            avg_volume_20d=round(avg_vol_20d, 0),
            rsi=round(rsi, 1) if rsi else None,
            dist_to_52w_high=round(dist_to_52w_high, 1),
            dist_to_support=round(dist_to_support, 1),
            sector_turnover_pct=round(sector_turnover_pct, 1),
            pattern=pattern_ar,
            pattern_en=pattern_en,
            action=action,
            action_en=action_en,
            position_size=position,
            stop_loss=stop,
            target=target,
            excluded=excluded,
            exclusion_reason=exclusion_reason,
        )

        # BRIEF-042: Early Trend Catcher — كشف الترند الصاعد المبكر
        try:
            is_early, early_reason = self.detect_early_trend(ticker, price, support, avg_vol_20d, conn)
            if is_early:
                result.is_early_trend = True
                result.early_trend_reason = early_reason
                # رفع الـ Score بـ +15 نقطة
                result.explosive_score = round(result.explosive_score + 15, 1)
                # ترقية الـ label لو كان أقل من "صاروخ"
                if result.explosive_score >= 65 and result.label == "شرارة":
                    result.label = "🚀 ترند مبكر"
                    result.label_en = "EARLY_TREND"
                    result.color = "cyan"
                    result.action = "دخول بحذر — ترند مبكر"
                    result.action_en = "CAUTIOUS_ENTRY_EARLY"
        except Exception as _et_e:
            logger.debug(f"Early trend detection failed for {ticker}: {_et_e}")

        return result

    def detect_early_trend(self, ticker: str, current_price: float,
                           support: float, avg_vol_20d: float,
                           conn=None) -> tuple:
        """
        BRIEF-042: كشف الترند الصاعد المبكر قبل الانفجار السعري.

        الشروط الثلاثة:
        1. نضوب البيع: avg_volume_5d < 0.6 * avg_volume_20d (السيولة جفت في النزول)
        2. بداية الانعكاس: today_close > SMA20
        3. الارتداد من الدعم: distance_to_support_pct < 3.0%

        Returns: (is_early_trend: bool, reason: str)
        """
        try:
            _conn = conn or self._get_conn()
            _cur = _conn.cursor()

            # 1. حساب avg_volume_5d (آخر 5 أيام)
            try:
                vol_rows = _cur.execute("""
                    SELECT volume FROM stock_daily_prices
                    WHERE ticker = ? AND volume > 0
                    ORDER BY price_date DESC LIMIT 5
                """, (ticker,)).fetchall()
                vols_5d = [_safe_float(r['volume'], 0) for r in vol_rows if _safe_float(r['volume'], 0) > 0]
                avg_vol_5d = sum(vols_5d) / len(vols_5d) if vols_5d else 0
            except Exception:
                avg_vol_5d = 0

            # 2. حساب avg_volume_20d (آخر 20 يوم)
            if avg_vol_20d <= 0:
                avg_vol_20d = self._get_avg_volume_20d(_conn, ticker)

            # الشرط 1: نضوب البيع (السيولة جفت في النزول)
            if avg_vol_20d <= 0 or avg_vol_5d <= 0:
                if conn is None:
                    _conn.close()
                return (False, '')
            vol_dryup_ratio = avg_vol_5d / avg_vol_20d
            if vol_dryup_ratio >= 0.6:
                if conn is None:
                    _conn.close()
                return (False, '')

            # الشرط 2: بداية الانعكاس (today_close > SMA20)
            try:
                sma_rows = _cur.execute("""
                    SELECT close FROM stock_daily_prices
                    WHERE ticker = ? AND close > 0
                    ORDER BY price_date DESC LIMIT 20
                """, (ticker,)).fetchall()
                closes = [_safe_float(r['close'], 0) for r in sma_rows if _safe_float(r['close'], 0) > 0]
                if len(closes) < 20:
                    if conn is None:
                        _conn.close()
                    return (False, '')
                sma20 = sum(closes) / len(closes)
            except Exception:
                if conn is None:
                    _conn.close()
                return (False, '')

            if current_price <= sma20:
                if conn is None:
                    _conn.close()
                return (False, '')

            # الشرط 3: الارتداد من الدعم (distance < 3%)
            if support <= 0:
                if conn is None:
                    _conn.close()
                return (False, '')
            distance_to_support_pct = abs((current_price - support) / current_price) * 100
            if distance_to_support_pct >= 3.0:
                if conn is None:
                    _conn.close()
                return (False, '')

            # كل الشروط تحققت → ترند مبكر!
            reason = (
                f'🚀 فرصة ترند مبكر — السيولة جفت في النزول ({vol_dryup_ratio:.1f}x)، '
                f'السهم كسر SMA20 ({sma20:.2f}) وارتد من دعم قوي ({support:.2f})'
            )
            if conn is None:
                _conn.close()
            return (True, reason)

        except Exception:
            return (False, '')

    def scan_market(self, limit: int = 30) -> Dict:
        """فحص السوق كله"""
        conn = self._get_conn()
        cur = conn.cursor()
        tickers = cur.execute("""
            SELECT ticker FROM stocks
            WHERE current_price >= ? AND is_active = 1 AND volume > 0
            ORDER BY (CAST(volume AS REAL) * CAST(current_price AS REAL)) DESC
            LIMIT ?
        """, (MIN_PRICE, limit * 5)).fetchall()
        conn.close()

        results = []
        excluded_count = 0
        excluded_reasons = {}

        for row in tickers:
            try:
                score = self.calculate_explosive_score(row['ticker'])
                if score:
                    if score.excluded:
                        excluded_count += 1
                        reason = score.exclusion_reason or 'unknown'
                        excluded_reasons[reason] = excluded_reasons.get(reason, 0) + 1
                    else:
                        results.append(score.to_dict())
            except Exception as e:
                logger.debug(f"Error scanning {row['ticker']}: {e}")

        results.sort(key=lambda x: x['explosive_score'], reverse=True)

        return {
            'top_stocks': results[:limit],
            'excluded_count': excluded_count,
            'excluded_reasons': excluded_reasons,
            'total_scanned': len(tickers),
        }

    def get_top_explosive(self, limit: int = 10) -> List[Dict]:
        result = self.scan_market(limit * 3)
        return result['top_stocks'][:limit]


def scan_for_explosive_stocks(limit: int = 30) -> Dict:
    scanner = ExplosiveScanner()
    return scanner.scan_market(limit)

def get_top_explosive(limit: int = 10) -> List[Dict]:
    scanner = ExplosiveScanner()
    return scanner.get_top_explosive(limit)

def get_explosive_score(ticker: str) -> Optional[Dict]:
    scanner = ExplosiveScanner()
    result = scanner.calculate_explosive_score(ticker.upper())
    return result.to_dict() if result else None
