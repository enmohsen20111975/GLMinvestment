#!/usr/bin/env python3
"""
Flow System Engine — نظام التدفقات
====================================
النظام الذي "ينيك السوق" - يحلل 4 طبقات ويعطي Flow Score واحد

Layer 1: MACRO FLOWS (التدفقات الكبرى) - 25%
  - USD/EGP inverse correlation
  - CBE Interest Rate
  - Foreign Inflows
  - Oil Prices
  - Global markets

Layer 2: SECTOR FLOWS (دوران القطاعات) - 30%
  - Sector turnover vs 20-day avg
  - Sector vs EGX30 (outperforming)
  - Sector leader momentum
  - Sector breadth

Layer 3: STOCK FLOWS (تدفق السهم الواحد) - 25%
  - Volume vs 20-day avg
  - Price vs sector avg
  - Block trades detection
  - RSI not overbought
  - Near support not resistance

Layer 4: CROSS-VALIDATION (التحقق المتقاطع) - 20%
  - Stock direction = Sector direction
  - Sector direction = Market direction
  - Volume confirms price
  - No divergence

INTERPRETATION:
  Flow Score ≥ 80 → "نار" — دخول قوي
  Flow Score 60-79 → "شرارة" — دخول حذر
  Flow Score 40-59 → "رماد" — استنى
  Flow Score < 40 → "بارد" — ماتدخلش

Author: M2Y Developers Team
Version: 1.0.0
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


@dataclass
class FlowScore:
    """نتيجة Flow Score لسهم واحد"""
    ticker: str
    name: str
    current_price: float
    change_percent: float
    flow_score: float  # 0-100
    label: str  # "نار" / "شرارة" / "رماد" / "بارد"
    label_en: str  # FIRE / SPARK / ASH / COLD
    color: str  # red / orange / gray / blue

    # Layer scores (0-100 each)
    macro_flow: float
    sector_flow: float
    stock_flow: float
    cross_validation: float

    # Details
    sector: str
    volume_ratio: float  # volume / 20-day avg
    rsi: Optional[float]
    sector_turnover_ratio: float  # sector turnover / 20-day avg
    sector_breadth: float  # % stocks up in sector
    egx30_change: float
    sector_avg_change: float

    # Recommendation
    action: str  # "دخول قوي" / "دخول حذر" / "استنى" / "ماتدخلش"
    action_en: str  # STRONG_ENTRY / CAUTIOUS_ENTRY / WAIT / AVOID
    position_size: float  # % من رأس المال
    stop_loss: float  # %
    target: float  # %

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# RISK EVALUATION GATE (BRAVO-JIMMY task 2026-10-18)
# ============================================================================
# Rule 18 (CALCULATION-CANONICAL): R/R floor = 1.8 إلزامي. أي إشارة R/R < 1.8
#   تُقتل فورًا → signal = "CASH_WAIT", confidence = 0.0.
# Rule 19 (capital protection): أقصى حجم مركز = 2.5% (0.025) من رأس المال.
# المعادلة الكنسية: R/R = (Target - Entry) / (Entry - Stop)
# Position cap: Pos_Size = min(calculated_size, 0.025)
# ----------------------------------------------------------------------------

RR_FLOOR: float = 1.8          # Rule 18 (matches engine_settings.dynamic_rr_normal)
MAX_POSITION_SIZE: float = 0.025  # 2.5% hard cap (Rule 19 capital protection)


def evaluate_risk(
    entry_price: float,
    stop_loss: float,
    target_price: float,
    calculated_position_size: float = 0.025,
    confidence: float = 1.0,
) -> Dict[str, Any]:
    """Evaluate a candidate signal against the hardened R/R floor + position cap.

    BRAVO-JIMMY task (2026-10-18): Hardened Risk/Reward Floor + Position Sizing Cap.

    Formula (Rule 18 — CALCULATION-CANONICAL):
        R/R = (Target - Entry) / (Entry - Stop)

    Rules enforced:
        1. If R/R < 1.8 (RR_FLOOR) → KILL: signal="CASH_WAIT", confidence=0.0.
           (Rule 18 — any BUY signal must offer >=1.8 reward per 1.0 risk.)
        2. Position size capped: pos_size = min(calculated_size, 0.025).
           (Rule 19 — max 2.5% of capital per position, regardless of conviction.)
        3. Invalid geometry (stop >= entry, target <= entry, non-positive prices)
           → KILL with "INVALID_GEOMETRY" reason.

    Args:
        entry_price: planned entry price.
        stop_loss: planned stop-loss price (must be < entry).
        target_price: planned target price (must be > entry).
        calculated_position_size: fraction of capital (0.0-1.0). Capped to 0.025.
        confidence: caller-supplied confidence (0.0-1.0). Zeroed on kill.

    Returns:
        dict with keys:
            signal: "BUY" | "CASH_WAIT"
            confidence: float (0.0 if killed)
            rr: float | None (computed R/R, or None if invalid geometry)
            position_size: float (capped to 0.025)
            killed: bool (True if R/R < floor or invalid geometry)
            kill_reason: str ("" if not killed)
    """
    result: Dict[str, Any] = {
        'signal': 'BUY',
        'confidence': float(confidence) if confidence else 0.0,
        'rr': None,
        'position_size': min(float(calculated_position_size), MAX_POSITION_SIZE),
        'killed': False,
        'kill_reason': '',
    }

    # Geometry validation — invalid setup = kill, no fabrication.
    try:
        entry = float(entry_price)
        stop = float(stop_loss)
        target = float(target_price)
    except (TypeError, ValueError):
        result['signal'] = 'CASH_WAIT'
        result['confidence'] = 0.0
        result['killed'] = True
        result['kill_reason'] = 'INVALID_GEOMETRY: non-numeric prices'
        return result

    if entry <= 0 or stop <= 0 or target <= 0:
        result['signal'] = 'CASH_WAIT'
        result['confidence'] = 0.0
        result['killed'] = True
        result['kill_reason'] = 'INVALID_GEOMETRY: non-positive prices'
        return result

    if stop >= entry or target <= entry:
        result['signal'] = 'CASH_WAIT'
        result['confidence'] = 0.0
        result['killed'] = True
        result['kill_reason'] = (
            f'INVALID_GEOMETRY: stop={stop} must be < entry={entry}, '
            f'target={target} must be > entry'
        )
        return result

    risk = entry - stop
    reward = target - entry
    rr = round(reward / risk, 4)
    result['rr'] = rr

    # R/R floor gate — Rule 18 hard kill.
    if rr < RR_FLOOR:
        result['signal'] = 'CASH_WAIT'
        result['confidence'] = 0.0
        result['killed'] = True
        result['kill_reason'] = (
            f'R/R {rr:.3f} < floor {RR_FLOOR:.1f} (Rule 18) — signal killed'
        )
        return result

    return result


class FlowSystemEngine:
    """محرك نظام التدفقات"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or STOCKS_DB

    def _get_connection(self):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.db_path, writable=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _safe_float(self, val) -> Optional[float]:
        if val is None:
            return None
        try:
            return float(str(val).replace('−', '-').replace('،', '').strip())
        except (ValueError, TypeError):
            return None

    # ========================================================================
    # LAYER 1: MACRO FLOWS (25%)
    # ========================================================================

    def calculate_macro_flow(self, egx30_change: float) -> Dict:
        """
        التدفقات الكبرى
        ملاحظة: البيانات الماكرو تتطلب API خارجي (CBE, exchange rates)
        نستخدم EGX30 كـ proxy + بيانات متاحة
        """
        score = 50  # neutral start
        factors = {}

        # EGX30 direction (proxy for overall macro)
        if egx30_change and egx30_change > 1.0:
            score += 15
            factors['egx30'] = f"+{egx30_change:.2f}% (صاعد قوي)"
        elif egx30_change and egx30_change > 0.2:
            score += 8
            factors['egx30'] = f"+{egx30_change:.2f}% (صاعد)"
        elif egx30_change is not None and egx30_change > -0.2:
            score += 0
            factors['egx30'] = f"{egx30_change:.2f}% (محايد)"
        elif egx30_change is not None and egx30_change > -1.0:
            score -= 8
            factors['egx30'] = f"{egx30_change:.2f}% (هابط)"
        else:
            score -= 15
            factors['egx30'] = f"{egx30_change:.2f}% (هابط قوي)"

        # Clamp 0-100
        score = max(0, min(100, score))

        return {
            'score': score,
            'factors': factors,
            'note': 'يستخدم EGX30 كـ proxy + بيانات متاحة (USD/EGP, CBE rate تحتاج API خارجي)'
        }

    # ========================================================================
    # LAYER 2: SECTOR FLOWS (30%)
    # ========================================================================

    def calculate_sector_flow(self, sector: str, stock_change: float) -> Dict:
        """دوران القطاعات"""
        if not sector or sector == 'غير محدد':
            return {'score': 50, 'factors': {}, 'note': 'قطاع غير محدد'}

        conn = self._get_connection()
        cur = conn.cursor()

        # Sector stats today
        sector_row = cur.execute("""
            SELECT
                COUNT(*) as stock_count,
                AVG(CAST(change_percent AS REAL)) as avg_change,
                SUM(CAST(volume AS REAL) * CAST(current_price AS REAL)) as turnover,
                SUM(CASE WHEN CAST(change_percent AS REAL) > 0 THEN 1 ELSE 0 END) as gainers,
                SUM(CASE WHEN CAST(change_percent AS REAL) < 0 THEN 1 ELSE 0 END) as losers
            FROM stocks
            WHERE sector = ? AND current_price > 0 AND is_active = 1
        """, (sector,)).fetchone()

        if not sector_row or (self._safe_float(sector_row['stock_count']) or 0) == 0:
            conn.close()
            return {'score': 50, 'factors': {}, 'note': 'لا بيانات للقطاع'}

        sector_avg = self._safe_float(sector_row['avg_change']) or 0
        sector_turnover = self._safe_float(sector_row['turnover']) or 0
        sector_gainers = self._safe_float(sector_row['gainers']) or 0
        sector_losers = self._safe_float(sector_row['losers']) or 0
        total_sector_stocks = self._safe_float(sector_row['stock_count']) or 1

        # Sector breadth (% stocks up)
        breadth = (sector_gainers / total_sector_stocks * 100) if total_sector_stocks > 0 else 0

        # 20-day average turnover for sector (from stock_daily_prices)
        avg_turnover_row = cur.execute("""
            SELECT AVG(daily_turnover) as avg_turnover FROM (
                SELECT price_date, SUM(CAST(volume AS REAL) * CAST(close AS REAL)) as daily_turnover
                FROM stock_daily_prices
                WHERE ticker IN (SELECT ticker FROM stocks WHERE sector = ?)
                  AND price_date >= date('now', '-20 days')
                GROUP BY price_date
            )
        """, (sector,)).fetchone()
        avg_sector_turnover = self._safe_float(avg_turnover_row['avg_turnover']) if avg_turnover_row else 0

        # Ensure sector_turnover is float (might be string if volume/price stored as text)
        sector_turnover = self._safe_float(sector_turnover) or 0

        # Turnover ratio
        turnover_ratio = (sector_turnover / avg_sector_turnover) if avg_sector_turnover and avg_sector_turnover > 0 else 1.0

        # Score calculation
        score = 50
        factors = {}

        # Turnover vs 20-day avg (30 points max)
        if turnover_ratio and turnover_ratio > 2.0:
            score += 15
            factors['turnover'] = f"{turnover_ratio:.1f}x المتوسط (سيولة عالية جداً)"
        elif turnover_ratio and turnover_ratio > 1.5:
            score += 10
            factors['turnover'] = f"{turnover_ratio:.1f}x المتوسط (سيولة عالية)"
        elif turnover_ratio and turnover_ratio > 1.0:
            score += 5
            factors['turnover'] = f"{turnover_ratio:.1f}x المتوسط (فوق المتوسط)"
        elif turnover_ratio and turnover_ratio < 0.5:
            score -= 10
            factors['turnover'] = f"{turnover_ratio:.1f}x المتوسط (سيولة ضعيفة)"
        else:
            factors['turnover'] = f"{turnover_ratio:.1f}x المتوسط (عادي)"

        # Sector vs stock (outperformance) (25 points)
        if sector_avg and sector_avg > 1.0:
            score += 12
            factors['sector_direction'] = f"القطاع +{sector_avg:.2f}% (قيادي)"
        elif sector_avg and sector_avg > 0:
            score += 5
            factors['sector_direction'] = f"القطاع +{sector_avg:.2f}% (صاعد)"
        elif sector_avg and sector_avg < -1.0:
            score -= 12
            factors['sector_direction'] = f"القطاع {sector_avg:.2f}% (هابط)"
        elif sector_avg and sector_avg < 0:
            score -= 5
            factors['sector_direction'] = f"القطاع {sector_avg:.2f}% (ضعيف)"

        # Sector breadth (20 points)
        if breadth > 70:
            score += 10
            factors['breadth'] = f"{breadth:.0f}% صاعد (اتساع قوي)"
        elif breadth > 50:
            score += 5
            factors['breadth'] = f"{breadth:.0f}% صاعد"
        elif breadth < 30:
            score -= 10
            factors['breadth'] = f"{breadth:.0f}% صاعد (اتساع ضعيف)"

        conn.close()

        score = max(0, min(100, score))

        return {
            'score': score,
            'factors': factors,
            'turnover_ratio': round(turnover_ratio or 0, 2),
            'avg_change': round(sector_avg or 0, 2),
            'breadth': round(breadth, 1),
        }

    # ========================================================================
    # LAYER 3: STOCK FLOWS (25%)
    # ========================================================================

    def calculate_stock_flow(self, ticker: str) -> Dict:
        """تدفق السهم الواحد — AUDIT-FIX (2026-10-29): توحيد الـ flow.

        قبل كده: كان بـ يحسب volume + RSI + support/resistance + momentum لوحده.
        دلوقتي: بـ يستخدم compute_money_flow من shared_liquidity كالمصدر الوحيد
        لـ buy/sell pressure. FlowSystemEngine بـ يفضل للـ macro + sector + cross
        validation بس. ده بـ يمنع التضارب بين النظامين.
        """
        conn = self._get_connection()
        cur = conn.cursor()

        stock = cur.execute("""
            SELECT ticker, current_price, change_percent, volume, rsi, sector,
                   support, resistance, avg_volume
            FROM stocks WHERE ticker = ? AND current_price > 0
        """, (ticker,)).fetchone()

        if not stock:
            conn.close()
            return {'score': 50, 'factors': {}, 'note': 'السهم غير موجود'}

        price = self._safe_float(stock['current_price']) or 0
        change = self._safe_float(stock['change_percent']) or 0
        volume = stock['volume'] or 0
        rsi = self._safe_float(stock['rsi'])
        avg_volume = self._safe_float(stock['avg_volume']) or 0
        support = self._safe_float(stock['support'])
        resistance = self._safe_float(stock['resistance'])

        # Volume ratio (vs 20-day avg from daily prices)
        avg_vol_row = cur.execute("""
            SELECT AVG(volume) as avg_vol FROM stock_daily_prices
            WHERE ticker = ? AND price_date >= date('now', '-20 days')
        """, (ticker,)).fetchone()
        hist_avg_vol = self._safe_float(avg_vol_row['avg_vol']) if avg_vol_row else 0
        vol_baseline = hist_avg_vol or avg_volume or volume
        volume_ratio = (volume / vol_baseline) if vol_baseline and vol_baseline > 0 else 1.0

        # ── AUDIT-FIX: استخدم compute_money_flow من shared_liquidity ──
        # ده المصدر الوحيد لـ buy/sell pressure على مستوى السهم.
        money_flow = None
        try:
            import sys as _mf_sys
            _mf_sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from utils.shared_liquidity import compute_money_flow
            # اقرأ آخر 25 يوم من stock_daily_prices
            rows = cur.execute("""
                SELECT close, high, low, volume FROM stock_daily_prices
                WHERE ticker = ? AND close > 0 AND volume > 0
                ORDER BY price_date DESC LIMIT 25
            """, (ticker,)).fetchall()
            if rows and len(rows) >= 5:
                rows = list(reversed(rows))  # أقدم → أحدث
                closes = [self._safe_float(r['close']) or 0 for r in rows]
                highs = [self._safe_float(r['high']) or 0 for r in rows]
                lows = [self._safe_float(r['low']) or 0 for r in rows]
                vols = [self._safe_float(r['volume']) or 0 for r in rows]
                money_flow = compute_money_flow(closes, vols, highs, lows)
        except Exception:
            pass

        score = 50
        factors = {}

        # ─ـ AUDIT-FIX: buy/sell pressure من compute_money_flow بس ──
        if money_flow:
            buy_pct = money_flow.get('buy_pct', 50)
            sell_pct = money_flow.get('sell_pct', 50)
            mf_state = money_flow.get('money_flow_state', '')
            vol_ratio_mf = money_flow.get('vol_ratio', 1.0)

            # buy_pct → score adjustment (35 points max)
            if buy_pct >= 70:
                score += 18
                factors['money_flow'] = f"buy={buy_pct:.0f}% ({mf_state})"
            elif buy_pct >= 60:
                score += 12
                factors['money_flow'] = f"buy={buy_pct:.0f}% ({mf_state})"
            elif buy_pct >= 55:
                score += 6
                factors['money_flow'] = f"buy={buy_pct:.0f}% ({mf_state})"
            elif buy_pct <= 30:
                score -= 18
                factors['money_flow'] = f"sell={sell_pct:.0f}% ({mf_state})"
            elif buy_pct <= 40:
                score -= 10
                factors['money_flow'] = f"sell={sell_pct:.0f}% ({mf_state})"
            else:
                factors['money_flow'] = f"متوازن (buy={buy_pct:.0f}%)"

            # volume ratio من money_flow (مش محسوب لوحده)
            if vol_ratio_mf and vol_ratio_mf > 2.0:
                score += 7
                factors['volume'] = f"{vol_ratio_mf:.1f}x المتوسط (سيولة عالية جداً)"
            elif vol_ratio_mf and vol_ratio_mf > 1.5:
                score += 4
                factors['volume'] = f"{vol_ratio_mf:.1f}x المتوسط (سيولة عالية)"
            elif vol_ratio_mf and vol_ratio_mf < 0.3:
                score -= 5
                factors['volume'] = f"{vol_ratio_mf:.1f}x المتوسط (سيولة ضعيفة جداً)"
            else:
                factors['volume'] = f"{vol_ratio_mf:.1f}x المتوسط (عادي)"
        else:
            # fallback لو money_flow مش متاح
            if volume_ratio and volume_ratio > 2.0:
                score += 10
            elif volume_ratio and volume_ratio > 1.5:
                score += 7
            elif volume_ratio and volume_ratio < 0.3:
                score -= 7
            factors['volume'] = f"{volume_ratio:.1f}x المتوسط (fallback — money_flow unavailable)"

        # RSI (15 points) — لسه من stocks.db
        if rsi is not None:
            if rsi < 30:
                score += 10
                factors['rsi'] = f"RSI {rsi:.0f} (تشبع بيعي - فرصة)"
            elif rsi > 70:
                score -= 10
                factors['rsi'] = f"RSI {rsi:.0f} (تشبع شرائي - خطر)"
            elif 40 <= rsi <= 60:
                score += 5
                factors['rsi'] = f"RSI {rsi:.0f} (محايد - صحي)"
            else:
                factors['rsi'] = f"RSI {rsi:.0f}"

        # Near support/resistance (15 points)
        if support and price and support > 0:
            dist_to_support = ((price - support) / support * 100) if support > 0 else 100
            if abs(dist_to_support) < 3:
                score += 10
                factors['support'] = f"قريب من الدعم ({dist_to_support:+.1f}%)"
            elif resistance and price:
                dist_to_resistance = ((resistance - price) / price * 100) if price > 0 else 100
                if abs(dist_to_resistance) < 3:
                    score -= 8
                    factors['resistance'] = f"قريب من المقاومة ({dist_to_resistance:+.1f}%)"
                else:
                    factors['position'] = f"بين الدعم والمقاومة"
        else:
            factors['support'] = "لا بيانات دعم"

        # Price momentum (10 points)
        if change and change > 2.0:
            score += 8
            factors['momentum'] = f"+{change:.2f}% (زخم قوي)"
        elif change and change > 0.5:
            score += 4
            factors['momentum'] = f"+{change:.2f}% (صاعد)"
        elif change and change < -2.0:
            score -= 8
            factors['momentum'] = f"{change:.2f}% (هابط قوي)"
        elif change and change < -0.5:
            score -= 4
            factors['momentum'] = f"{change:.2f}% (هابط)"

        conn.close()
        score = max(0, min(100, score))

        return {
            'score': score,
            'factors': factors,
            'volume_ratio': round(volume_ratio or 0, 2),
            'rsi': round(rsi, 1) if rsi else None,
            'price': price,
            'change': change,
            'money_flow': money_flow,  # AUDIT-FIX: رجّع تفاصيل money_flow
        }

    # ========================================================================
    # LAYER 4: CROSS-VALIDATION (20%)
    # ========================================================================

    def calculate_cross_validation(self, stock_change: float, sector: str, egx30_change: float) -> Dict:
        """
        التحقق المتقاطع - Sector-Stock-Market correlation
        محسّن: يفحص التناقض بين السهم وقطاعه + دوران القطاعات
        """
        conn = self._get_connection()
        cur = conn.cursor()

        # Sector avg change today
        sector_row = cur.execute("""
            SELECT AVG(CAST(change_percent AS REAL)) as avg_change,
                   SUM(CASE WHEN CAST(change_percent AS REAL) > 0 THEN 1 ELSE 0 END) as gainers,
                   COUNT(*) as total
            FROM stocks
            WHERE sector = ? AND current_price > 0 AND is_active = 1
        """, (sector,)).fetchone() if sector else None
        sector_avg = self._safe_float(sector_row['avg_change']) if sector_row else 0
        sector_gainers = sector_row['gainers'] if sector_row else 0
        sector_total = sector_row['total'] if sector_row else 1
        sector_breadth = (sector_gainers / sector_total * 100) if sector_total > 0 else 0

        # Sector 7-day performance (from daily prices)
        sector_7d = 0
        try:
            rows = cur.execute("""
                SELECT sdp.close, sdp.price_date
                FROM stock_daily_prices sdp
                INNER JOIN stocks s ON s.ticker = sdp.ticker
                WHERE s.sector = ? AND sdp.close > 0
                ORDER BY sdp.price_date DESC LIMIT 7
            """, (sector,)).fetchall()
            if len(rows) >= 2:
                latest = self._safe_float(rows[0][0])
                oldest = self._safe_float(rows[-1][0])
                if oldest and oldest > 0:
                    sector_7d = ((latest - oldest) / oldest * 100)
        except:
            pass

        conn.close()

        score = 50
        factors = {}

        sc = stock_change or 0
        sa = sector_avg or 0
        s7 = sector_7d or 0

        # 1. Stock direction = Sector direction TODAY (25 points)
        if (sc > 0 and sa > 0) or (sc < 0 and sa < 0):
            score += 15
            factors['stock_sector'] = f"السهم والقطاع نفس الاتجاه ✓ ({sa:+.1f}%)"
        else:
            # CONTRARIAN: stock up but sector down = WARNING
            if sc > 3 and sa < -0.5:
                score -= 15
                factors['stock_sector'] = f"⚠️ السهم +{sc:.1f}% لكن القطاع {sa:.1f}% = مضاربة/فخ"
            elif sc > 1 and sa < 0:
                score -= 8
                factors['stock_sector'] = f"السهم عكس القطاع ⚠ (مراقبة)"
            else:
                score -= 5
                factors['stock_sector'] = f"السهم عكس القطاع"

        # 2. Sector 7-day trend (25 points) - is sector gaining momentum?
        if s7 > 5:
            score += 15
            factors['sector_trend'] = f"القطاع صاعد 7 أيام +{s7:.1f}% ✓ (زخم قوي)"
        elif s7 > 0:
            score += 8
            factors['sector_trend'] = f"القطاع صاعد 7 أيام +{s7:.1f}% ✓"
        elif s7 < -5:
            score -= 15
            factors['sector_trend'] = f"القطاع هابط 7 أيام {s7:.1f}% ✗ (ابعد)"
        elif s7 < 0:
            score -= 5
            factors['sector_trend'] = f"القطاع هابط 7 أيام {s7:.1f}%"
        else:
            factors['sector_trend'] = f"القطاع ثابت 7 أيام"

        # 3. Sector breadth (% stocks up in sector) (20 points)
        if sector_breadth > 70:
            score += 10
            factors['breadth'] = f"اتساع القطاع {sector_breadth:.0f}% صاعد ✓ (قوي)"
        elif sector_breadth > 50:
            score += 5
            factors['breadth'] = f"اتساع القطاع {sector_breadth:.0f}% صاعد"
        elif sector_breadth < 30:
            score -= 10
            factors['breadth'] = f"اتساع القطاع {sector_breadth:.0f}% صاعد ✗ (ضعيف)"

        # 4. Sector = Market direction (15 points)
        if ((sa or 0) > 0 and (egx30_change or 0) > 0) or ((sa or 0) < 0 and (egx30_change or 0) < 0):
            score += 8
            factors['sector_market'] = f"القطاع والسوق نفس الاتجاه ✓"
        else:
            score -= 5
            factors['sector_market'] = f"القطاع عكس السوق ⚠"

        # 5. Triple confirmation (15 points bonus)
        if (((sc or 0) > 0 and (sa or 0) > 0 and (egx30_change or 0) > 0) or
            ((sc or 0) < 0 and (sa or 0) < 0 and (egx30_change or 0) < 0)):
            score += 10
            factors['triple'] = f"تأكيد ثلاثي ✓✓✓ (سهم + قطاع + سوق)"
        elif ((sc or 0) > 0 and (sa or 0) > 0 and (egx30_change or 0) < 0):
            factors['triple'] = f"السهم والقطاع طالعون بس السوق نازل ⚠"
        elif ((sc or 0) > 0 and (sa or 0) < 0 and (egx30_change or 0) > 0):
            factors['triple'] = f"السهم طالع لوحده ⚠ (مضاربة - القطاع لا يؤكد)"
        elif ((sc or 0) > 2 and (sa or 0) < -0.5):
            factors['triple'] = f"⚠️ تناقض خطير: السهم +{sc:.1f}% والقطاع {sa:.1f}% = فخ!"
            score -= 10
        else:
            factors['triple'] = f"إشارات متضاربة"

        score = max(0, min(100, score))

        return {
            'score': score,
            'factors': factors,
            'stock_change': round(stock_change or 0, 2),
            'sector_change': round(sector_avg or 0, 2),
            'market_change': round(egx30_change or 0, 2),
        }

    # ========================================================================
    # FLOW SCORE CALCULATION
    # ========================================================================

    def calculate_flow_score(self, ticker: str) -> Optional[FlowScore]:
        """حساب Flow Score لسهم واحد - لا يرمي خطأ أبداً"""
        try:
            return self._calculate_flow_score_impl(ticker)
        except Exception as e:
            logger.debug(f"Flow score error for {ticker}: {e}")
            return None

    def _get_fundamentals_bonus(self, ticker: str) -> Dict:
        """
        Bonus points from data-engine.db fundamentals (up to +10)
        - ROE > 15% → +3
        - Net margin > 10% → +2
        - Dividend yield > 3% → +2
        - P/E < 10 → +3
        """
        bonus = 0
        factors = []
        try:
            import os as _os_f
            _de_path = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))), 'db', 'data_engine.db')
            if not _os.path.exists(_de_path):
                return {'bonus': 0, 'factors': []}

            import sqlite3 as _sql_f
            conn = _sql_f.connect(_de_path)
            conn.row_factory = _sql_f.Row
            cur = conn.cursor()
            # DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)

            # Profitability
            prof = cur.execute("SELECT * FROM tab_profitability WHERE symbol = ? LIMIT 1", (ticker,)).fetchone()
            if prof:
                def _extract_num(val):
                    if val is None: return 0
                    import re
                    m = re.search(r'([+-]?\d+\.?\d*)', str(val).replace('−','-'))
                    return float(m.group(1)) if m else 0

                roe = _extract_num(prof['roe']) if 'roe' in prof.keys() else 0
                net_margin = _extract_num(prof['net_margin']) if 'net_margin' in prof.keys() else 0
                if roe > 15:
                    bonus += 3; factors.append(f"ROE {roe:.1f}% > 15%")
                if net_margin > 10:
                    bonus += 2; factors.append(f"هامش صافي {net_margin:.1f}% > 10%")

            # Valuation — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            val = cur.execute("SELECT * FROM tab_valuation WHERE symbol = ? LIMIT 1", (ticker,)).fetchone()
            if val:
                pe = _extract_num(val['pe_ratio']) if val['pe_ratio'] else 0
                if 0 < pe < 10:
                    bonus += 3; factors.append(f"P/E {pe:.1f} < 10 (رخيص)")

            # Dividends — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            div = cur.execute("SELECT * FROM tab_dividends WHERE symbol = ? LIMIT 1", (ticker,)).fetchone()
            if div:
                div_yield = _extract_num(div['div_yield']) if div['div_yield'] else 0
                if div_yield > 3:
                    bonus += 2; factors.append(f"توزيعات {div_yield:.1f}% > 3%")

            conn.close()
        except Exception as e:
            logger.debug(f"Fundamentals bonus error for {ticker}: {e}")

        return {'bonus': min(bonus, 10), 'factors': factors}

    def _get_atr_for_ticker(self, ticker: str, period: int = 14) -> Optional[float]:
        """احسب ATR canonical (Wilder's) من stock_daily_prices.

        Rule 67(b) (CALCULATION-CANONICAL): ATR canonical source هو
        analyzers.indicators.atr.calc_atr (Wilder's smoothing).
        Rule 12 (DATA-UNIFY-007): بيانات الأسعار من stock_daily_prices.

        Returns: ATR value (absolute, بالجنيه) أو None لو مفيش بيانات كافية.
        """
        conn = None
        try:
            conn = self._get_connection()
            cur = conn.cursor()
            rows = cur.execute("""
                SELECT high, low, close FROM stock_daily_prices
                WHERE ticker = ? AND COALESCE(close, 0) > 0
                  AND COALESCE(high, 0) > 0 AND COALESCE(low, 0) > 0
                ORDER BY price_date ASC
                LIMIT ?
            """, (ticker, period + 50)).fetchall()  # +50 buffer للـ Wilder's seed
            if not rows or len(rows) < period + 1:
                return None
            highs = [self._safe_float(r['high']) for r in rows]
            lows = [self._safe_float(r['low']) for r in rows]
            closes = [self._safe_float(r['close']) for r in rows]
            # canonical ATR
            try:
                from analyzers.indicators.atr import calc_atr as _canonical_atr
                atr = _canonical_atr(highs, lows, closes, period)
                return atr
            except ImportError:
                # fallback: SMA-based ATR (مش canonical بس يقوم بالغرض)
                trs = []
                for i in range(1, len(rows)):
                    h, l = highs[i], lows[i]
                    pc = closes[i - 1]
                    tr = max(h - l, abs(h - pc), abs(l - pc))
                    trs.append(tr)
                if len(trs) < period:
                    return None
                return sum(trs[-period:]) / period
        except Exception as e:
            logger.debug(f"ATR error for {ticker}: {e}")
            return None
        finally:
            if conn:
                conn.close()

    def _compute_atr_stop_target(self, ticker: str, entry_price: float,
                                  min_pct: float = 5.0, max_pct: float = 9.0,
                                  min_rr: float = 1.8) -> Tuple[Optional[float], Optional[float]]:
        """احسب stop_loss + target ديناميكيًا من ATR + clamp [5%, 9%].

        Rule 8 (PILLAR-3): atr_stop_min_pct=5.0, atr_stop_max_pct=9.0.
        Rule 18: R/R ≥ 1.8 (dynamic_rr_normal).
        Rule 67(b): ATR canonical (Wilder's).

        المنطق:
          - atr_pct = (ATR / entry) × 100
          - stop_dist = clamp(atr_pct × 1.5, [min_pct, max_pct])  [1.5× buffer]
          - stop = entry × (1 - stop_dist/100)
          - target_dist = stop_dist × min_rr (≥ 1.8 × risk)
          - target = entry × (1 + target_dist/100)

        Returns: (stop_pct, target_pct) — قيم بالنسبة المئوية (مثال: -5.8, +10.4).
                 None, None لو مفيش ATR أو entry غير صالح.
        """
        if not entry_price or entry_price <= 0:
            return None, None

        # اقرأ thresholds من engine_settings (SSOT — Rule 11)
        try:
            from analyzers.engine_settings import get_setting
            min_pct = float(get_setting('atr_stop_min_pct', default=min_pct))
            max_pct = float(get_setting('atr_stop_max_pct', default=max_pct))
            min_rr = float(get_setting('dynamic_rr_normal', default=min_rr))
        except Exception:
            pass  # fallback للـ defaults (5%, 9%, 1.8)

        atr = self._get_atr_for_ticker(ticker)
        if not atr or atr <= 0:
            # BRAVO-JIMMY Phase 2 (2026-10-18): fallback safely to 6% (0.06)
            # if ATR is missing/unavailable. 6% = safe middle ground within
            # Rule 8 clamp [5%, 9%] — not the old fixed 3%/5% (Rule 8 violation).
            stop_dist = 6.0
        else:
            atr_pct = (atr / entry_price) * 100.0
            # stop = 1.5× ATR (buffer تحت القاع) — نفس منطق opportunity_quality
            stop_dist = atr_pct * 1.5
            # clamp لـ [min_pct, max_pct]
            if stop_dist < min_pct:
                stop_dist = min_pct
            elif stop_dist > max_pct:
                stop_dist = max_pct

        # target = entry + (stop_dist × min_rr) → R/R ≥ 1.8
        target_dist = stop_dist * min_rr

        return -round(stop_dist, 2), round(target_dist, 2)

    def _calculate_flow_score_impl(self, ticker: str) -> Optional[FlowScore]:
        """Implementation - may throw, wrapped by calculate_flow_score"""
        conn = self._get_connection()
        cur = conn.cursor()

        stock = cur.execute("""
            SELECT ticker, name, name_ar, current_price, change_percent, sector
            FROM stocks WHERE ticker = ? AND current_price > 0 AND is_active = 1
        """, (ticker,)).fetchone()

        egx30_row = cur.execute("""
            SELECT change_percent FROM market_indices WHERE symbol = 'EGX30'
        """).fetchone()
        conn.close()

        if not stock:
            return None

        egx30_change = self._safe_float(egx30_row['change_percent']) if egx30_row else 0
        price = self._safe_float(stock['current_price']) or 0
        change = self._safe_float(stock['change_percent']) or 0
        sector = stock['sector'] or 'غير محدد'
        name = stock['name_ar'] or stock['name'] or ticker

        # Calculate all 4 layers
        macro = self.calculate_macro_flow(egx30_change)
        sector_flow = self.calculate_sector_flow(sector, change)
        stock_flow = self.calculate_stock_flow(ticker)
        cross = self.calculate_cross_validation(change, sector, egx30_change)

        # Weighted total
        total_score = (
            macro['score'] * 0.25 +
            sector_flow['score'] * 0.30 +
            stock_flow['score'] * 0.25 +
            cross['score'] * 0.20
        )

        # BONUS: Add fundamentals from data-engine.db (up to +10 bonus points)
        fundamentals_bonus = self._get_fundamentals_bonus(ticker)
        total_score = min(100, total_score + fundamentals_bonus['bonus'])

        # Label
        # POSITION-CAP + ATR-STOP-TARGET (2026-10-18 — Owner directive via جيمي + جروك + كيمي):
        # POSITION: 2-3% كحد أقصى (Rule 19 حماية رأس المال — يتوافق مع shared_liquidity.py).
        # STOP/TARGET: ديناميكي من ATR canonical (Wilder's) + clamp [5%, 9%] (Rule 8).
        #              target = stop_dist × 1.8 (R/R ≥ 1.8 — Rule 18).
        #              لو مفيش ATR → stop=min_pct (5%) + target=5%×1.8=9%.
        # القيم الثابتة القديمة (-3/-5/+8/+12) اتمسحت — كانت بتخالف Rule 8 + Rule 18.
        # AUDIT-FIX (2026-10-29): position sizing كان معكوس — SPARK (2.5%) > FIRE (2%).
        # الحل: كل ما الـ score أعلى → position أكبر.
        if total_score >= 80:
            label, label_en, color = "نار", "FIRE", "red"
            action, action_en = "دخول قوي", "STRONG_ENTRY"
            position = 2.5  # AUDIT-FIX: كان 2 → 2.5 (الأعلى)
        elif total_score >= 70:
            label, label_en, color = "نار", "FIRE", "red"
            action, action_en = "دخول قوي", "STRONG_ENTRY"
            position = 2.0  # AUDIT-FIX: كان 2 → 2.0
        elif total_score >= 60:
            label, label_en, color = "شرارة", "SPARK", "orange"
            action, action_en = "دخول حذر", "CAUTIOUS_ENTRY"
            position = 1.5  # AUDIT-FIX: كان 2.5 → 1.5 (الأقل)
        elif total_score >= 40:
            label, label_en, color = "رماد", "ASH", "gray"
            action, action_en = "استنى", "WAIT"
            position = 0
        else:
            label, label_en, color = "بارد", "COLD", "blue"
            action, action_en = "ماتدخلش", "AVOID"
            position = 0

        # احسب stop/target ديناميكيًا من ATR (Rule 8 + Rule 18 + Rule 67b)
        # للأسهم اللي تستحق دخول (FIRE/SPARK) → احسب. للباقي → 0.
        if position > 0 and price > 0:
            _stop_pct, _target_pct = self._compute_atr_stop_target(ticker, price)
            stop = _stop_pct if _stop_pct is not None else 0.0
            target = _target_pct if _target_pct is not None else 0.0
        else:
            stop, target = 0.0, 0.0

        return FlowScore(
            ticker=ticker,
            name=name,
            current_price=price,
            change_percent=change,
            flow_score=round(total_score, 1),
            label=label,
            label_en=label_en,
            color=color,
            macro_flow=round(macro['score'], 1),
            sector_flow=round(sector_flow['score'], 1),
            stock_flow=round(stock_flow['score'], 1),
            cross_validation=round(cross['score'], 1),
            sector=sector,
            volume_ratio=stock_flow.get('volume_ratio', 1.0),
            rsi=stock_flow.get('rsi'),
            sector_turnover_ratio=sector_flow.get('turnover_ratio', 1.0),
            sector_breadth=sector_flow.get('breadth', 0),
            egx30_change=round(egx30_change or 0, 2),
            sector_avg_change=cross.get('sector_change', 0),
            action=action,
            action_en=action_en,
            position_size=position,
            stop_loss=stop,
            target=target,
        )

    def get_top_flow_stocks(self, limit: int = 20) -> List[Dict]:
        """أعلى الأسهم في Flow Score"""
        conn = self._get_connection()
        cur = conn.cursor()
        # Get all active stocks with prices
        tickers = cur.execute("""
            SELECT ticker FROM stocks
            WHERE current_price > 0 AND is_active = 1
              AND volume > 0
            ORDER BY (CAST(volume AS REAL) * CAST(current_price AS REAL)) DESC
            LIMIT ?
        """, (limit * 3,)).fetchall()  # get 3x to filter
        conn.close()

        results = []
        for row in tickers:
            ticker = row['ticker']
            try:
                flow = self.calculate_flow_score(ticker)
                if flow and flow.flow_score > 0:
                    results.append(flow.to_dict())
            except Exception as e:
                logger.debug(f"Error calculating flow score for {ticker}: {e}")
                continue  # Skip this stock, don't crash the whole thing

        # Sort by flow_score descending
        results.sort(key=lambda x: x['flow_score'], reverse=True)

        return results[:limit]

    def get_sector_heatmap(self) -> List[Dict]:
        """خريطة حرارية للقطاعات - أي قطاع بيجمع سيولة"""
        conn = self._get_connection()
        cur = conn.cursor()

        sectors = cur.execute("""
            SELECT
                COALESCE(sector, 'غير محدد') as sector,
                COUNT(*) as stock_count,
                AVG(CAST(change_percent AS REAL)) as avg_change,
                SUM(CAST(volume AS REAL) * CAST(current_price AS REAL)) as turnover,
                SUM(CASE WHEN CAST(change_percent AS REAL) > 0 THEN 1 ELSE 0 END) as gainers,
                SUM(CASE WHEN CAST(change_percent AS REAL) < 0 THEN 1 ELSE 0 END) as losers
            FROM stocks
            WHERE current_price > 0 AND is_active = 1
            GROUP BY sector
            ORDER BY turnover DESC
        """).fetchall()
        conn.close()

        total_turnover = sum(self._safe_float(s['turnover']) or 0 for s in sectors)

        heatmap = []
        for s in sectors:
            turnover = self._safe_float(s['turnover']) or 0
            avg_change = self._safe_float(s['avg_change']) or 0
            gainers = self._safe_float(s['gainers']) or 0
            stock_count = self._safe_float(s['stock_count']) or 1
            breadth = (gainers / stock_count * 100) if stock_count > 0 else 0

            # Heat level
            if avg_change > 2 and turnover > total_turnover * 0.15:
                heat = "HOT"
                heat_ar = "نار 🔥"
            elif avg_change > 0.5:
                heat = "WARM"
                heat_ar = "دافئ"
            elif avg_change < -2:
                heat = "COLD"
                heat_ar = "بارد ❄️"
            elif avg_change < -0.5:
                heat = "COOL"
                heat_ar = "بارد"
            else:
                heat = "NEUTRAL"
                heat_ar = "محايد"

            heatmap.append({
                'sector': s['sector'],
                'stock_count': int(stock_count),
                'avg_change': round(avg_change or 0, 2),
                'turnover': round(turnover, 0),
                'turnover_pct': round((turnover / total_turnover * 100) if total_turnover > 0 else 0, 1),
                'gainers': int(gainers),
                'losers': int(self._safe_float(s['losers']) or 0),
                'breadth': round(breadth, 1),
                'heat': heat,
                'heat_ar': heat_ar,
            })

        return heatmap

    # ========================================================================
    # SECTOR ROTATION DETECTION — كشف دوران السيولة بين القطاعات
    # ========================================================================

    def detect_sector_rotation(self, lookback_days: int = 5, min_turnover_change: float = 0.3) -> Dict:
        """
        كشف دوران السيولة بين القطاعات — PREDICTIVE مش REACTIVE.
        
        الفكرة: لو قطاع كان dead وبدأ الـ turnover يزيد 3 أيام متتالية → السيولة راجعة.
        لو قطاع كان hot والـ turnover بيقل 3 أيام → السيولة بتهرب.
        
        Args:
            lookback_days: عدد الأيام للنظر فيها (default 5)
            min_turnover_change: أدنى نسبة تغير في الـ turnover للاعتبار (default 30%)
        
        Returns:
            {
                'entering': [{'sector': 'BANKS', 'trend': 'rising', 'days_rising': 3, ...}],
                'leaving': [{'sector': 'REAL_ESTATE', 'trend': 'falling', 'days_falling': 2, ...}],
                'stable': [...],
                'rotation_signals': ['السيولة بتدخل البنوك', ...]
            }
        """
        result = {'entering': [], 'leaving': [], 'stable': [], 'rotation_signals': []}
        
        try:
            import sqlite3 as _sq3
            from datetime import datetime as _dt, timedelta as _td
            
            # Get sector turnover per day for the last N days
            conn = self._get_connection()
            cur = conn.cursor()
            
            # Try to get historical turnover from price_history.db
            # CANONICAL-PRICE (Task PHASE-3, Rule 72) — HISTORICAL closes only (for
            # sector turnover trend). LIVE current_price is already used above from
            # stocks.db.stocks.current_price (line ~796) for today's snapshot.
            ph_db = self.db_path.replace('stocks.db', 'price_history.db')
            if not os.path.exists(ph_db):
                ph_db = os.path.join(os.path.dirname(self.db_path), 'price_history.db')
            
            # Get current sector data (today)
            current_sectors = cur.execute("""
                SELECT COALESCE(sector, 'غير محدد') as sector,
                       SUM(CAST(volume AS REAL) * CAST(current_price AS REAL)) as turnover,
                       AVG(CAST(change_percent AS REAL)) as avg_change
                FROM stocks WHERE current_price > 0 AND is_active = 1
                GROUP BY sector
            """).fetchall()
            
            # Build current turnover map
            current_map = {}
            for s in current_sectors:
                sector = s['sector']
                turnover = self._safe_float(s['turnover']) or 0
                avg_change = self._safe_float(s['avg_change']) or 0
                current_map[sector] = {'turnover': turnover, 'avg_change': avg_change}
            
            conn.close()
            
            # Try to get historical sector data from price_history
            historical_data = {}
            if os.path.exists(ph_db):
                try:
                    # Step 1: Get ticker→sector mapping from stocks.db (same DB as current data)
                    ticker_sector_map = {}
                    s_conn = self._get_connection()
                    s_cur = s_conn.cursor()
                    for row in s_cur.execute("SELECT ticker, COALESCE(sector, 'غير محدد') FROM stocks WHERE sector IS NOT NULL"):
                        ticker_sector_map[row[0]] = row[1]
                    s_conn.close()
                    
                    # Step 2: Query price_history.db per-ticker (NO cross-DB JOIN needed)
                    ph_conn = _sq3.connect(ph_db)
                    ph_cur = ph_conn.cursor()
                    
                    # Find the most recent date with data (instead of assuming today)
                    latest_row = ph_cur.execute("SELECT MAX(date) FROM price_history").fetchone()
                    latest_date_str = latest_row[0] if latest_row else None
                    
                    if latest_date_str:
                        try:
                            latest_date = _dt.strptime(latest_date_str, '%Y-%m-%d')
                        except ValueError:
                            latest_date = _dt.now() - _td(days=1)
                        dates = [(latest_date - _td(days=i)).strftime('%Y-%m-%d') for i in range(0, lookback_days)]
                    else:
                        today = _dt.now()
                        dates = [(today - _td(days=i)).strftime('%Y-%m-%d') for i in range(1, lookback_days + 1)]
                    
                    for date_str in dates:
                        try:
                            # Per-ticker turnover from price_history (no JOIN needed)
                            rows = ph_cur.execute("""
                                SELECT ph.ticker,
                                       SUM(CAST(ph.volume AS REAL) * CAST(ph.close_price AS REAL)) as turnover
                                FROM price_history ph
                                WHERE ph.date = ? AND ph.close_price > 0
                                GROUP BY ph.ticker
                            """, (date_str,)).fetchall()
                            
                            for r in rows:
                                ticker = r[0]
                                sector = ticker_sector_map.get(ticker, 'غير محدد')
                                turnover = float(r[1]) if r[1] else 0
                                if sector not in historical_data:
                                    historical_data[sector] = []
                                historical_data[sector].append({'date': date_str, 'turnover': turnover})
                        except Exception:
                            continue
                    
                    ph_conn.close()
                except Exception:
                    pass
            
            # Analyze trends for each sector
            for sector, current in current_map.items():
                curr_turnover = current['turnover']
                curr_change = current['avg_change']
                
                if sector in historical_data and len(historical_data[sector]) >= 3:
                    hist = historical_data[sector]
                    # Check if turnover is rising or falling over consecutive days
                    rising_days = 0
                    falling_days = 0
                    
                    for i in range(len(hist) - 1):
                        if hist[i]['turnover'] > 0 and hist[i+1]['turnover'] > 0:
                            ratio = hist[i]['turnover'] / hist[i+1]['turnover']
                            if ratio > (1 + min_turnover_change):
                                rising_days += 1
                            elif ratio < (1 - min_turnover_change):
                                falling_days += 1
                    
                    avg_hist_turnover = sum(h['turnover'] for h in hist) / len(hist)
                    turnover_vs_avg = (curr_turnover / avg_hist_turnover - 1) if avg_hist_turnover > 0 else 0
                    
                    entry = {
                        'sector': sector,
                        'current_turnover': round(curr_turnover, 0),
                        'avg_hist_turnover': round(avg_hist_turnover, 0),
                        'turnover_vs_avg_pct': round(turnover_vs_avg * 100, 1),
                        'avg_change': round(curr_change, 2),
                        'rising_days': rising_days,
                        'falling_days': falling_days,
                    }
                    
                    if rising_days >= 3 or (turnover_vs_avg > 0.5 and rising_days >= 2):
                        entry['trend'] = 'entering'
                        result['entering'].append(entry)
                        result['rotation_signals'].append(f"🟢 السيولة بتدخل {sector} — {rising_days} أيام متتالية، turnover {'+' if turnover_vs_avg > 0 else ''}{turnover_vs_avg*100:.0f}% عن المتوسط")
                    elif falling_days >= 3 or (turnover_vs_avg < -0.3 and falling_days >= 2):
                        entry['trend'] = 'leaving'
                        result['leaving'].append(entry)
                        result['rotation_signals'].append(f"🔴 السيولة بتهرب من {sector} — {falling_days} أيام متتالية، turnover {turnover_vs_avg*100:.0f}% عن المتوسط")
                    else:
                        entry['trend'] = 'stable'
                        result['stable'].append(entry)
                else:
                    # No historical data — classify by current state
                    entry = {
                        'sector': sector,
                        'current_turnover': round(curr_turnover, 0),
                        'avg_change': round(curr_change, 2),
                        'trend': 'unknown',
                    }
                    result['stable'].append(entry)
            
            # Sort: entering by highest rising_days, leaving by highest falling_days
            result['entering'].sort(key=lambda x: x.get('rising_days', 0), reverse=True)
            result['leaving'].sort(key=lambda x: x.get('falling_days', 0), reverse=True)
            
        except Exception as e:
            result['rotation_signals'].append(f"خطأ في كشف الدوران: {str(e)[:100]}")
        
        return result

    def get_flow_summary(self) -> Dict:
        """ملخص نظام التدفقات للسوق كله"""
        egx30_change = None  # FIX (BRAVO-DISASTER 2026-10-28): was hardcoded 0 on failure
        try:
            conn = self._get_connection()
            cur = conn.cursor()

            egx30_row = cur.execute("SELECT change_percent FROM market_indices WHERE symbol = 'EGX30'").fetchone()
            egx30_change = self._safe_float(egx30_row['change_percent']) if egx30_row else None
            conn.close()
        except Exception as e:
            # FIX (BRAVO-DISASTER 2026-10-28): was bare except: egx30_change = 0
            # which fabricated a value and emitted a fake "neutral market" verdict.
            # Now we log and propagate the unavailable state downstream.
            import logging
            logging.getLogger(__name__).error(
                '[flow_system] get_flow_summary: failed to read EGX30 change — %s', e,
                exc_info=True
            )
            egx30_change = None

        # Top 10 flow stocks
        try:
            top_stocks = self.get_top_flow_stocks(10)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(
                '[flow_system] get_top_flow_stocks failed — %s', e, exc_info=True
            )
            top_stocks = []

        # Sector heatmap
        try:
            heatmap = self.get_sector_heatmap()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(
                '[flow_system] get_sector_heatmap failed — %s', e, exc_info=True
            )
            heatmap = []

        # Market flow assessment — only if we have real EGX30 data
        if egx30_change is None:
            # FIX: don't fabricate a verdict on missing data — report unavailable
            return {
                'available': False,
                'reason': 'EGX30 index data unavailable',
                'top_stocks': top_stocks,
                'heatmap': heatmap,
                'market_assessment': 'البيانات غير متاحة - تعطل المصدر',
                'market_action': 'انتظار',
                'egx30_change': None,
            }

        fire_count = len([s for s in top_stocks if s.get('label_en') == 'FIRE'])
        spark_count = len([s for s in top_stocks if s.get('label_en') == 'SPARK'])

        if egx30_change > 1.0 and fire_count >= 3:
            market_assessment = "السوق نشط - تيارات قوية"
            market_action = "دخول مدروس"
        elif egx30_change > 0 and spark_count >= 5:
            market_assessment = "السوق متحرك بحذر"
            market_action = "دخول منتقي"
        elif egx30_change < -1.0:
            market_assessment = "السوق بارد - امسك إيدك"
            market_action = "انتظار"
        else:
            market_assessment = "السوق محايد - استنى تأكيد"
            market_action = "مراقبة"

        conn.close()

        return {
            'cairo_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'egx30_change': round(egx30_change, 2),
            'market_assessment': market_assessment,
            'market_action': market_action,
            'fire_count': fire_count,
            'spark_count': spark_count,
            'top_stocks': top_stocks,
            'sector_heatmap': heatmap[:8],  # top 8 sectors
            'total_stocks_analyzed': len(top_stocks),
        }


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def get_flow_score(ticker: str) -> Optional[Dict]:
    """حساب Flow Score لسهم واحد"""
    engine = FlowSystemEngine()
    result = engine.calculate_flow_score(ticker)
    return result.to_dict() if result else None


def get_top_flow_stocks(limit: int = 20) -> List[Dict]:
    """أعلى الأسهم في Flow Score"""
    engine = FlowSystemEngine()
    return engine.get_top_flow_stocks(limit)


def get_flow_summary() -> Dict:
    """ملخص نظام التدفقات"""
    engine = FlowSystemEngine()
    return engine.get_flow_summary()


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    parser = argparse.ArgumentParser(description='Flow System Engine')
    parser.add_argument('--action', choices=['score', 'top', 'summary', 'heatmap'],
                        default='summary')
    parser.add_argument('--ticker', type=str, help='Ticker for single stock score')
    parser.add_argument('--limit', type=int, default=20)

    args = parser.parse_args()
    engine = FlowSystemEngine()

    if args.action == 'score':
        if not args.ticker:
            print("Error: --ticker required")
            sys.exit(1)
        result = engine.calculate_flow_score(args.ticker)
        if result:
            print(f"\n{'='*60}")
            print(f"Flow Score: {args.ticker}")
            print(f"{'='*60}")
            print(f"Price: {result.current_price} ({result.change_percent:+.2f}%)")
            print(f"Flow Score: {result.flow_score}/100 → {result.label} ({result.label_en})")
            print(f"Action: {result.action} (position: {result.position_size}%)")
            print(f"\nLayers:")
            print(f"  Macro Flow:        {result.macro_flow}/100 (25%)")
            print(f"  Sector Flow:       {result.sector_flow}/100 (30%)")
            print(f"  Stock Flow:        {result.stock_flow}/100 (25%)")
            print(f"  Cross Validation:  {result.cross_validation}/100 (20%)")
            print(f"\nDetails:")
            print(f"  Sector: {result.sector} ({result.sector_avg_change:+.2f}%)")
            print(f"  Volume ratio: {result.volume_ratio}x")
            print(f"  RSI: {result.rsi}")
            print(f"  EGX30: {result.egx30_change:+.2f}%")
        else:
            print(f"Stock {args.ticker} not found")

    elif args.action == 'top':
        results = engine.get_top_flow_stocks(args.limit)
        print(f"\nTop {len(results)} stocks by Flow Score:")
        print(f"{'Ticker':10s} {'Score':>6s} {'Label':8s} {'Price':>10s} {'Chg%':>7s} {'Action':15s}")
        print('-' * 70)
        for r in results:
            print(f"{r['ticker']:10s} {r['flow_score']:>6.1f} {r['label']:8s} {r['current_price']:>10.2f} {r['change_percent']:>+7.2f} {r['action']:15s}")

    elif args.action == 'heatmap':
        heatmap = engine.get_sector_heatmap()
        print(f"\nSector Heatmap:")
        print(f"{'Sector':25s} {'Avg%':>7s} {'Turnover%':>10s} {'Breadth':>8s} {'Heat':15s}")
        print('-' * 75)
        for s in heatmap:
            print(f"{s['sector'][:25]:25s} {s['avg_change']:>+7.2f} {s['turnover_pct']:>10.1f} {s['breadth']:>8.1f} {s['heat_ar']:15s}")

    elif args.action == 'summary':
        summary = engine.get_flow_summary()
        print(f"\n{'='*60}")
        print(f"Flow System Summary")
        print(f"{'='*60}")
        print(f"Time: {summary['cairo_time']}")
        print(f"EGX30: {summary['egx30_change']:+.2f}%")
        print(f"Market: {summary['market_assessment']}")
        print(f"Action: {summary['market_action']}")
        print(f"Fire stocks: {summary['fire_count']}")
        print(f"Spark stocks: {summary['spark_count']}")
        print(f"\nTop 5 Flow Stocks:")
        for s in summary['top_stocks'][:5]:
            print(f"  {s['ticker']:10s} {s['flow_score']:>5.1f} {s['label']:8s} {s['action']}")
