"""
Support / Resistance Calculator
================================
حاسبة الدعم/المقاومة الحقيقية — بديل الـ percentage-based targets الفاضية.

الفلسفة:
- الـ percentage targets (+4%/-8% gambler, +10%/-12% investor) مش مستويات سعر حقيقية.
- الـ S/R الحقيقي بيتبنى من Swing Highs / Swing Lows اللى اتحققت (fractal pivots).
- target = أقرب مقاومة، stop = تحت أقرب دعم، مع Risk/Reward gating.

الاستخدام:
    from analyzers.support_resistance_calculator import calculate_support_resistance
    sr = calculate_support_resistance("COMI")
    if sr and sr["is_fresh"]:
        target = sr["resistance"]
        stop = sr["support"] * 0.98

CLI:
    python3 -m analyzers.support_resistance_calculator COMI
    python3 support_resistance_calculator.py COMI

المصدر: <project_root>/db/price_history.db → table `price_history`
(columns: id, ticker, date, open_price, high_price, low_price, close_price, volume)

Stdlib only (sqlite3) — no pandas — lightweight.
"""

from __future__ import annotations

import sqlite3
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr

# ==================== CONFIG ====================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = os.environ.get(
    "STOCKS_DB",
    str(_PROJECT_ROOT / "db" / "stocks.db"),
)

# Lookback window for swing detection (±lookback candles must be strictly lower/higher)
DEFAULT_LOOKBACK = 5
DEFAULT_DAYS = 90
MIN_ROWS = 30          # need at least 30 candles to talk about S/R
FRESH_DAYS = 7         # data within 7 days of today = fresh
ZONE_THRESHOLD = 0.05  # ±5% from nearest support/resistance defines "near" zone
BREAKOUT_BUFFER = 0.005  # 0.5% above all resistances = breakout confirmation
MAX_LEVELS = 3         # collect up to 3 nearest supports / 3 nearest resistances


# ==================== DB ACCESS ====================

def _get_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or DEFAULT_DB
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def _load_price_history(
    ticker: str,
    days: int = DEFAULT_DAYS,
    db_path: Optional[str] = None,
) -> List[Dict]:
    """
    يحمل آخر `days` يوم من stock_daily_prices للسهم.
    يرجع قائمة dict قديم → جديد (chronological).
    كل dict فيه: date, open_price, high_price, low_price, close_price, volume
    """
    try:
        conn = _get_connection(db_path)
        cur = conn.cursor()
        # Use stock_daily_prices (clean EODHD data) instead of price_history
        try:
            cur.execute(
                """
                SELECT price_date as date, open as open_price, high as high_price,
                       low as low_price, close as close_price, volume
                FROM stock_daily_prices
                WHERE ticker = ? AND close IS NOT NULL AND close > 0
                ORDER BY price_date DESC
                LIMIT ?
                """,
                (ticker.upper(), int(days)),
            )
            rows = [dict(r) for r in cur.fetchall()]
        except:
            # Fallback to price_history table
            cur.execute(
                """
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM price_history
                WHERE ticker = ?
                ORDER BY date DESC
                LIMIT ?
                """,
                (ticker.upper(), int(days)),
            )
            rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        rows.reverse()
        return rows
    except Exception as e:
        print(f"[S/R] DB error for {ticker}: {e}")
        return []


# ==================== SWING DETECTION ====================

def _detect_swing_highs(rows: List[Dict], lookback: int = DEFAULT_LOOKBACK) -> List[Tuple[int, float, str]]:
    """
    Swing High: candle high is the STRICT HIGHEST in a ±`lookback` window.
    Returns list of (index, price, date) tuples.
    """
    swings: List[Tuple[int, float, str]] = []
    n = len(rows)
    if n < 2 * lookback + 1:
        return swings
    for i in range(lookback, n - lookback):
        center_high = float(rows[i].get("high_price") or 0)
        if center_high <= 0:
            continue
        is_strict_max = True
        for j in range(i - lookback, i + lookback + 1):
            if j == i:
                continue
            other_high = float(rows[j].get("high_price") or 0)
            if other_high >= center_high:
                is_strict_max = False
                break
        if is_strict_max:
            swings.append((i, center_high, str(rows[i].get("date") or "")))
    return swings


def _detect_swing_lows(rows: List[Dict], lookback: int = DEFAULT_LOOKBACK) -> List[Tuple[int, float, str]]:
    """
    Swing Low: candle low is the STRICT LOWEST in a ±`lookback` window.
    Returns list of (index, price, date) tuples.
    """
    swings: List[Tuple[int, float, str]] = []
    n = len(rows)
    if n < 2 * lookback + 1:
        return swings
    for i in range(lookback, n - lookback):
        center_low = float(rows[i].get("low_price") or 0)
        if center_low <= 0:
            continue
        is_strict_min = True
        for j in range(i - lookback, i + lookback + 1):
            if j == i:
                continue
            other_low = float(rows[j].get("low_price") or 0)
            if other_low <= center_low:
                is_strict_min = False
                break
        if is_strict_min:
            swings.append((i, center_low, str(rows[i].get("date") or "")))
    return swings


def _calculate_atr(rows: List[Dict], period: int = 14) -> float:
    """
    بتحسب الـ Average True Range (ATR) للبيانات المعطاة.
    ATR بيقيس التقلبات — لو عالي يعني السهم متقلب كتير.

    BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
    Keeps backward-compat fallback (0.0) on insufficient data.
    """
    try:
        n = len(rows)
        if n < 2:
            return 0.0
        highs = [float(r.get("high_price") or 0) for r in rows]
        lows = [float(r.get("low_price") or 0) for r in rows]
        closes = [float(r.get("close_price") or 0) for r in rows]
        # filter invalid rows
        valid = [(h, l, c) for h, l, c in zip(highs, lows, closes) if h > 0 and l > 0 and c > 0]
        if len(valid) < 2:
            return 0.0
        v_highs, v_lows, v_closes = (list(t) for t in zip(*valid))
        atr = _canonical_calc_atr(v_highs, v_lows, v_closes, period=period)
        return atr if atr is not None else 0.0
    except Exception:
        return 0.0


def _calculate_dynamic_tolerance(rows: List[Dict], default: float = 0.015) -> float:
    """
    بتحسب الـ tolerance ديناميكياً بناءً على التقلبات.
    - تقلبات عالية (ATR > 3%): tolerance = 2.5%
    - تقلبات منخفضة (ATR < 1.5%): tolerance = 1.0%
    - عادي: 1.5% (الافتراضي)
    """
    try:
        current_price = float(rows[-1].get("close_price") or 0)
        if current_price <= 0:
            return default
        atr = _calculate_atr(rows)
        atr_pct = atr / current_price
        if atr_pct > 0.03:
            # تقلبات عالية — بنوسع الـ tolerance عشان نظبط المستويات
            return 0.025
        elif atr_pct < 0.015:
            # تقلبات منخفضة — بنضيق عشان نكون أدق
            return 0.010
        else:
            return default
    except Exception:
        return default


def _calculate_avg_daily_volume(rows: List[Dict]) -> float:
    """
    بتحسب متوسط الحجم اليومي.
    """
    try:
        volumes = [float(r.get("volume") or 0) for r in rows if float(r.get("volume") or 0) > 0]
        if not volumes:
            return 0.0
        return sum(volumes) / len(volumes)
    except Exception:
        return 0.0


def _calculate_volume_at_level(level_price: float, rows: List[Dict], band_pct: float = 0.02) -> float:
    """
    بتحسب إجمالي الحجم اللي اتبادل لما السعر كان ضمن 2% من المستوى ده.
    لو الحجم عالي يعني المستوى ده اتحطّب بقوة (strong level).
    """
    try:
        if level_price <= 0:
            return 0.0
        total_vol = 0.0
        upper = level_price * (1 + band_pct)
        lower = level_price * (1 - band_pct)
        for r in rows:
            high = float(r.get("high_price") or 0)
            low = float(r.get("low_price") or 0)
            vol = float(r.get("volume") or 0)
            # لو الشمعة لمست نطاق المستوى
            if low <= upper and high >= lower:
                total_vol += vol
        return total_vol
    except Exception:
        return 0.0


def _calculate_freshness(level_date: str, current_date: str) -> Tuple[int, str]:
    """
    بتحسب عدد الأيام من آخر اختبار للمستوى + درجة النضارة.
    - fresh: 0-10 أيام (المستوى لسه جديد ومؤثر)
    - recent: 10-30 يوم (مستوى متوسط الأهمية)
    - stale: 30+ يوم (مستوى قديم ممكن متأثرش كتير)
    """
    try:
        if not level_date or not current_date:
            return (999, "stale")
        dt_level = datetime.strptime(str(level_date)[:10], "%Y-%m-%d")
        dt_current = datetime.strptime(str(current_date)[:10], "%Y-%m-%d")
        days_diff = (dt_current - dt_level).days
        if days_diff < 0:
            days_diff = 0
        if days_diff <= 10:
            return (days_diff, "fresh")
        elif days_diff <= 30:
            return (days_diff, "recent")
        else:
            return (days_diff, "stale")
    except Exception:
        return (999, "stale")


def _determine_strength(volume_at_level: float, avg_daily_volume: float) -> str:
    """
    بتحدد قوة المستوى بناءً على الحجم.
    - strong: الحجم أكتر من ضعف المتوسط (2x)
    - moderate: الحجم أكتر من المتوسط (1x)
    - weak: الحجم أقل من المتوسط
    """
    try:
        if avg_daily_volume <= 0:
            return "weak"
        ratio = volume_at_level / avg_daily_volume
        if ratio > 2.0:
            return "strong"
        elif ratio > 1.0:
            return "moderate"
        else:
            return "weak"
    except Exception:
        return "weak"


def _cluster_levels(
    levels: List[Tuple[int, float, str]],
    tolerance: float = 0.015,
) -> List[Tuple[float, str, int]]:
    """
    بيجمع(levels) القريبة من بعض (داخل tolerance) في مستوى واحد
    عشان يشتغل stronger support/resistance.
    يرجع: list of (avg_price, last_date, tests_count)
    """
    if not levels:
        return []
    # sort by price ascending
    sorted_levels = sorted(levels, key=lambda x: x[1])
    clusters: List[List[Tuple[int, float, str]]] = [[sorted_levels[0]]]
    for lvl in sorted_levels[1:]:
        prev_price = clusters[-1][-1][1]
        if abs(lvl[1] - prev_price) / prev_price <= tolerance:
            clusters[-1].append(lvl)
        else:
            clusters.append([lvl])
    # average each cluster, pick latest date, count tests
    result: List[Tuple[float, str, int]] = []
    for cluster in clusters:
        avg_price = sum(c[1] for c in cluster) / len(cluster)
        # latest date in the cluster (string sort works for ISO dates)
        latest_date = max((c[2] for c in cluster if c[2]), default="")
        # عدد المرات اللي المستوى ده اتحطّب فيها
        tests_count = len(cluster)
        result.append((avg_price, latest_date, tests_count))
    return result


def _enrich_level(
    price: float,
    date: str,
    tests_count: int,
    rows: List[Dict],
    current_date: str,
    avg_daily_volume: float,
) -> Dict:
    """
    بتحوّل المستوى البسيط لـ dict غني بالمعلومات.
    بيشمل: السعر، القوة، الحجم، الأيام من آخر اختبار، النضارة، عدد الاختبارات.
    """
    try:
        vol_at_level = _calculate_volume_at_level(price, rows)
        strength = _determine_strength(vol_at_level, avg_daily_volume)
        days_since, freshness = _calculate_freshness(date, current_date)
        return {
            "price": round(price, 4),
            "strength": strength,
            "volume_at_level": vol_at_level,
            "days_since_test": days_since,
            "freshness": freshness,
            "tests_count": tests_count,
        }
    except Exception:
        return {
            "price": round(price, 4),
            "strength": "weak",
            "volume_at_level": 0.0,
            "days_since_test": 999,
            "freshness": "stale",
            "tests_count": tests_count,
        }


def _pick_primary_level(
    enriched_levels: List[Dict],
    prefer_fresh: bool = True,
) -> Optional[Dict]:
    """
    بختار أفضل مستوى (الأقرب والأقوى والأجدد) عشان الـ target/stop.
    بنفضّل المستوى الـ fresh والـ strong.
    """
    try:
        if not enriched_levels:
            return None
        # ترتيب حسب: نضارة أولاً، ثم قوة، ثم عدد اختبارات
        freshness_order = {"fresh": 0, "recent": 1, "stale": 2}
        strength_order = {"strong": 0, "moderate": 1, "weak": 2}
        sorted_levels = sorted(
            enriched_levels,
            key=lambda x: (
                freshness_order.get(x.get("freshness", "stale"), 2),
                strength_order.get(x.get("strength", "weak"), 2),
                -x.get("tests_count", 0),
            ),
        )
        return sorted_levels[0]
    except Exception:
        if enriched_levels:
            return enriched_levels[0]
        return None


def _detect_accumulation_distribution(
    rows: List[Dict],
    current_price: float,
    nearest_support_price: float,
    nearest_resistance_price: float,
    avg_daily_volume: float,
    consolidation_days: int = 10,
    range_pct: float = 0.03,
    volume_multiplier: float = 1.5,
) -> Tuple[bool, bool]:
    """
    بيكشف مناطق التجميع (accumulation) والتوزيع (distribution).
    - accumulation: السعر متراكم فوق الدعم مع حجم عالي (قبل breakthrough)
    - distribution: السعر متراكم تحت المقاومة مع حجم عالي (قبل breakdown)
    الشروط: السعر ضمن نطاق ضيق ≤ 3% لمدة 10+ أيام + حجم أعلى من 1.5x المتوسط
    """
    try:
        if len(rows) < consolidation_days:
            return (False, False)
        recent_rows = rows[-consolidation_days:]
        # حساب النطاق في الفترة الأخيرة
        recent_highs = [float(r.get("high_price") or 0) for r in recent_rows]
        recent_lows = [float(r.get("low_price") or 0) for r in recent_rows]
        if not recent_highs or not recent_lows:
            return (False, False)
        max_high = max(recent_highs)
        min_low = min(recent_lows)
        if min_low <= 0:
            return (False, False)
        actual_range_pct = (max_high - min_low) / min_low
        # لو النطاق أوسع من 3% — مش تراكم/توزيع
        if actual_range_pct > range_pct:
            return (False, False)
        # حساب متوسط الحجم في الفترة الأخيرة
        recent_volumes = [float(r.get("volume") or 0) for r in recent_rows]
        recent_avg_vol = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 0
        if avg_daily_volume <= 0 or recent_avg_vol < avg_daily_volume * volume_multiplier:
            return (False, False)
        # عندنا تراكم في نطاق ضيق مع حجم عالي — حدد نوعه
        # بنشوف المنطقة بتقرب من الدعم ولا المقاومة
        range_mid = (max_high + min_low) / 2.0
        accumulation = False
        distribution = False
        if nearest_support_price > 0 and nearest_resistance_price > 0:
            total_range = nearest_resistance_price - nearest_support_price
            if total_range > 0:
                # لو النطاق في النصف السفلي من الدعم/المقاومة → accumulation
                position_ratio = (range_mid - nearest_support_price) / total_range
                if position_ratio < 0.5:
                    accumulation = True
                else:
                    distribution = True
        elif nearest_support_price > 0:
            # مفيش مقاومة فوق — لو قريب من الدعم يبقى accumulation
            if current_price < (nearest_support_price + nearest_resistance_price) / 2 if nearest_resistance_price > 0 else True:
                accumulation = True
        elif nearest_resistance_price > 0:
            distribution = True
        return (accumulation, distribution)
    except Exception:
        return (False, False)


def _compute_vwap_proxy(rows: list) -> dict:
    """
    حساب VWAP Proxy من البيانات اليومية + كشف accumulation/distribution.
    
    لما بدنا intraday VWAP مش متاح، نستخدم daily proxy:
    - VWAP proxy = (High + Low + Close) / 3 لكل يوم، ثم weighted average
    - لو Close > Midpoint (High+Low)/2 + حجم عالي = buyer aggressive = accumulation
    - لو Close < Midpoint + حجم عالي = seller aggressive = distribution
    
    ملاحظة: rows مرتبة قديم → جديد (chronological).
    
    Returns:
        dict: {
            'vwap_proxy': float,  # VWAP تقريبي
            'current_vs_vwap': float,  # نسبة السعر الحالي لـ VWAP
            'accumulation_days': int,  # عدد أيام التجميع (آخر 20 يوم)
            'distribution_days': int,  # عدد أيام التصريف
            'net_flow': str,  # 'accumulation' | 'distribution' | 'neutral'
            'flow_strength': float,  # قوة الاتجاه (0-1)
        }
    """
    result = {
        'vwap_proxy': 0.0,
        'current_vs_vwap': 0.0,
        'accumulation_days': 0,
        'distribution_days': 0,
        'net_flow': 'neutral',
        'flow_strength': 0.0,
    }
    
    try:
        if not rows or len(rows) < 10:
            return result
        
        # rows مرتبة قديم → جديد — ناخد آخر 20 يوم
        recent = rows[-20:]
        n = len(recent)
        
        # حساب VWAP proxy: sum(typical_price * volume) / sum(volume)
        total_pv = 0.0
        total_v = 0.0
        acc_days = 0
        dist_days = 0
        
        # حساب متوسط الحجم لآخر 20 يوم مرة واحدة
        avg_vol = sum(float(r.get('volume', 0) or 0) for r in recent) / n if recent else 0
        
        for r in recent:
            h = float(r.get('high_price', 0) or 0)
            l = float(r.get('low_price', 0) or 0)
            c = float(r.get('close_price', 0) or 0)
            v = float(r.get('volume', 0) or 0)
            
            if h <= 0 or l <= 0 or c <= 0 or v <= 0:
                continue
            
            typical_price = (h + l + c) / 3
            total_pv += typical_price * v
            total_v += v
            
            # كشف accumulation/distribution لكل يوم
            midpoint = (h + l) / 2
            
            if v > avg_vol * 1.5:  # حجم أعلى من المتوسط 50%+
                if c > midpoint:
                    acc_days += 1  # buyer aggressive
                elif c < midpoint:
                    dist_days += 1  # seller aggressive
        
        if total_v > 0:
            vwap = total_pv / total_v
            # rows[-1] = أحدث يوم (chronological)
            current_close = float(recent[-1].get('close_price', 0) or 0)
            
            result['vwap_proxy'] = round(vwap, 4)
            result['current_vs_vwap'] = round((current_close - vwap) / vwap, 4) if vwap > 0 else 0
            result['accumulation_days'] = acc_days
            result['distribution_days'] = dist_days
            
            total_flow_days = acc_days + dist_days
            if total_flow_days > 0:
                if acc_days > dist_days * 1.5:
                    result['net_flow'] = 'accumulation'
                    result['flow_strength'] = round(acc_days / n, 2)
                elif dist_days > acc_days * 1.5:
                    result['net_flow'] = 'distribution'
                    result['flow_strength'] = round(dist_days / n, 2)
                else:
                    result['net_flow'] = 'neutral'
                    result['flow_strength'] = round(abs(acc_days - dist_days) / n, 2)
        
    except Exception:
        pass
    
    return result


# ==================== MAIN CALCULATOR ====================

def calculate_support_resistance(
    ticker: str,
    days: int = DEFAULT_DAYS,
    lookback: int = DEFAULT_LOOKBACK,
    db_path: Optional[str] = None,
) -> Optional[Dict]:
    """
    يحسب الدعوم/المقاومات الحقيقية للسهم + يحدد المنطقة (zone).
    بيشمل تحليل الحجم عند كل مستوى + نضارة المستوى + مناطق التجميع/التوزيع.

    Parameters
    ----------
    ticker : str
        رمز السهم.
    days : int
        عدد الأيام اللى بيتحسب عليها (default 90).
    lookback : int
        نافذة كشف الـ swing (±lookback candles) — default 5.
    db_path : str, optional
        مسار price_history.db (لو مش default).

    Returns
    -------
    dict or None
        {
          "support": float,
          "resistance": float,
          "far_support": float,
          "far_resistance": float,
          "pivot": float,
          "zone": str,  # near_support | near_resistance | middle | breakout | breakdown | testing_breakout | testing_support
          "current_price": float,
          "distance_to_support_pct": float,
          "distance_to_resistance_pct": float,
          "levels_count": int,
          "last_date": str,
          "is_fresh": bool,
          # === حقول جديدة ===
          "support_levels": [...],      # كل مستويات الدعم بالتفصيل
          "resistance_levels": [...],   # كل مستويات المقاومة بالتفصيل
          "primary_support": {...},     # أفضل دعم (الأجدد والأقوى)
          "primary_resistance": {...},  # أفضل مقاومة
          "avg_daily_volume": float,
          "accumulation_zone": bool,
          "distribution_zone": bool,
          "zone_type": str,  # 'accumulation' | 'distribution' | 'neutral' | 'neutral_vwap_conflict'
          "atr": float,
          "dynamic_tolerance": float,
          "vwap_proxy": float,
          "current_vs_vwap": float,
          "vwap_flow": str,  # 'accumulation' | 'distribution' | 'neutral'
          "vwap_flow_strength": float,
          "vwap_accumulation_days": int,
          "vwap_distribution_days": int,
        }
        None لو السهم مش موجود أو البيانات أقل من MIN_ROWS.
    """
    rows = _load_price_history(ticker, days=days, db_path=db_path)
    if not rows or len(rows) < MIN_ROWS:
        return None

    # current price = last close
    current_price = float(rows[-1].get("close_price") or 0)
    if current_price <= 0:
        # fallback to last high or low
        current_price = float(rows[-1].get("high_price") or rows[-1].get("low_price") or 0)
        if current_price <= 0:
            return None

    last_date = str(rows[-1].get("date") or "")[:10]

    # freshness check
    is_fresh = False
    if last_date:
        try:
            last_dt = datetime.strptime(last_date, "%Y-%m-%d")
            is_fresh = (datetime.now() - last_dt).days <= FRESH_DAYS
        except (ValueError, TypeError):
            is_fresh = False

    # === حساب ATR والـ tolerance الديناميكي ===
    try:
        atr = _calculate_atr(rows)
        dynamic_tolerance = _calculate_dynamic_tolerance(rows)
    except Exception:
        atr = 0.0
        dynamic_tolerance = 0.015

    # === حساب متوسط الحجم اليومي ===
    try:
        avg_daily_volume = _calculate_avg_daily_volume(rows)
    except Exception:
        avg_daily_volume = 0.0

    # detect swings
    swing_highs = _detect_swing_highs(rows, lookback=lookback)
    swing_lows = _detect_swing_lows(rows, lookback=lookback)

    # cluster & deduplicate — بنستخدم الـ tolerance الديناميكي
    # النتيجة بقت: [(price, date, tests_count), ...]
    try:
        resistance_levels = _cluster_levels(swing_highs, tolerance=dynamic_tolerance)
        support_levels = _cluster_levels(swing_lows, tolerance=dynamic_tolerance)
    except Exception:
        resistance_levels = _cluster_levels(swing_highs)
        support_levels = _cluster_levels(swing_lows)

    # collect nearest supports (below current price) & nearest resistances (above)
    supports_below = [(p, d, tc) for p, d, tc in support_levels if 0 < p < current_price]
    resistances_above = [(p, d, tc) for p, d, tc in resistance_levels if p > current_price]

    # sort by distance to current price (nearest first)
    supports_below.sort(key=lambda x: current_price - x[0])
    resistances_above.sort(key=lambda x: x[0] - current_price)

    # take up to MAX_LEVELS each
    nearest_supports = supports_below[:MAX_LEVELS]
    nearest_resistances = resistances_above[:MAX_LEVELS]

    # === إثراء المستويات بمعلومات الحجم والنضارة ===
    try:
        enriched_supports = [
            _enrich_level(p, d, tc, rows, last_date, avg_daily_volume)
            for p, d, tc in nearest_supports
        ]
        enriched_resistances = [
            _enrich_level(p, d, tc, rows, last_date, avg_daily_volume)
            for p, d, tc in nearest_resistances
        ]
    except Exception:
        enriched_supports = [
            {"price": round(p, 4), "strength": "weak", "volume_at_level": 0.0,
             "days_since_test": 999, "freshness": "stale", "tests_count": tc}
            for p, d, tc in nearest_supports
        ]
        enriched_resistances = [
            {"price": round(p, 4), "strength": "weak", "volume_at_level": 0.0,
             "days_since_test": 999, "freshness": "stale", "tests_count": tc}
            for p, d, tc in nearest_resistances
        ]

    # === اختيار المستوى الأساسي (الأفضل للـ target/stop) ===
    try:
        primary_support = _pick_primary_level(enriched_supports)
        primary_resistance = _pick_primary_level(enriched_resistances)
    except Exception:
        primary_support = enriched_supports[0] if enriched_supports else None
        primary_resistance = enriched_resistances[0] if enriched_resistances else None

    # ===== Build output =====
    support = nearest_supports[0][0] if nearest_supports else 0.0
    resistance = nearest_resistances[0][0] if nearest_resistances else 0.0
    far_support = nearest_supports[1][0] if len(nearest_supports) >= 2 else support
    far_resistance = nearest_resistances[1][0] if len(nearest_resistances) >= 2 else resistance

    # pivot = midpoint of nearest S/R (or current_price if either missing)
    if support > 0 and resistance > 0:
        pivot = (support + resistance) / 2.0
    elif support > 0:
        pivot = (support + current_price) / 2.0
    elif resistance > 0:
        pivot = (current_price + resistance) / 2.0
    else:
        pivot = current_price

    # distance metrics (% from current price)
    if support > 0:
        distance_to_support_pct = ((current_price - support) / support) * 100.0
    else:
        distance_to_support_pct = 0.0
    if resistance > 0:
        distance_to_resistance_pct = ((resistance - current_price) / current_price) * 100.0
    else:
        distance_to_resistance_pct = 0.0

    # ===== Zone detection =====
    # breakdown = current price below ALL supports (no support below)
    # breakout = current price above ALL resistances
    if not supports_below and not resistances_above:
        # no levels at all — ambiguous, treat as middle
        zone = "middle"
    elif not supports_below and resistances_above:
        # current price below all detected supports? No — supports_below empty
        # means current price is BELOW the lowest support → breakdown
        zone = "breakdown"
    elif supports_below and not resistances_above:
        # current price above all resistances → breakout
        zone = "breakout"
    else:
        # both present — check proximity
        near_support = (support > 0 and
                        0 <= distance_to_support_pct <= ZONE_THRESHOLD * 100)
        near_resistance = (resistance > 0 and
                           0 <= distance_to_resistance_pct <= ZONE_THRESHOLD * 100)
        if near_support:
            zone = "near_support"
        elif near_resistance:
            zone = "near_resistance"
        else:
            zone = "middle"

    # corner case: current_price is exactly at support (distance ~0)
    if support > 0 and abs(current_price - support) / support < 0.005:
        zone = "near_support"
    if resistance > 0 and abs(current_price - resistance) / resistance < 0.005:
        zone = "near_resistance"

    # === استخدام BREAKOUT_BUFFER في كشف اختراق/اختبار ===
    try:
        # لو السعر فوق المقاومة بـ BREAKOUT_BUFFER أو أقل — يبقى بيتست اختراق
        if resistance > 0 and 0 < (current_price - resistance) / resistance <= BREAKOUT_BUFFER:
            zone = "testing_breakout"
        # لو السعر تحت الدعم بـ BREAKOUT_BUFFER أو أقل — يبقى بيتست الدعم
        if support > 0 and 0 < (support - current_price) / support <= BREAKOUT_BUFFER:
            zone = "testing_support"
    except Exception:
        pass

    levels_count = len(nearest_supports) + len(nearest_resistances)

    # === كشف مناطق التجميع/التوزيع ===
    try:
        accumulation_zone, distribution_zone = _detect_accumulation_distribution(
            rows, current_price, support, resistance, avg_daily_volume,
        )
    except Exception:
        accumulation_zone = False
        distribution_zone = False

    # === VWAP Proxy — كشف accumulation/distribution حقيقي ===
    vwap_data = _compute_vwap_proxy(rows)

    # === مشتق zone_type من accumulation/distribution الحالي ===
    if accumulation_zone and not distribution_zone:
        zone_type = 'accumulation'
    elif distribution_zone and not accumulation_zone:
        zone_type = 'distribution'
    elif accumulation_zone and distribution_zone:
        zone_type = 'neutral'
    else:
        zone_type = 'neutral'

    # ⚡ VWAP Enhancement — تأكيد أو تعديل zone_type
    if vwap_data['net_flow'] == 'accumulation' and vwap_data['flow_strength'] > 0.3:
        # VWAP بيقول accumulation → لو zone_type كان distribution، نراجعه
        if zone_type == 'distribution':
            zone_type = 'neutral_vwap_conflict'
        elif zone_type == 'neutral':
            zone_type = 'accumulation'
    elif vwap_data['net_flow'] == 'distribution' and vwap_data['flow_strength'] > 0.3:
        if zone_type == 'accumulation':
            zone_type = 'neutral_vwap_conflict'
        elif zone_type == 'neutral':
            zone_type = 'distribution'

    return {
        # === الحقول الأصلية (محدش يتكسر) ===
        "support": round(support, 4),
        "resistance": round(resistance, 4),
        "far_support": round(far_support, 4),
        "far_resistance": round(far_resistance, 4),
        "pivot": round(pivot, 4),
        "zone": zone,
        "current_price": round(current_price, 4),
        "distance_to_support_pct": round(distance_to_support_pct, 2),
        "distance_to_resistance_pct": round(distance_to_resistance_pct, 2),
        "levels_count": levels_count,
        "last_date": last_date,
        "is_fresh": is_fresh,
        # === الحقول الجديدة ===
        "support_levels": enriched_supports,
        "resistance_levels": enriched_resistances,
        "primary_support": primary_support,
        "primary_resistance": primary_resistance,
        "avg_daily_volume": round(avg_daily_volume, 2),
        "accumulation_zone": accumulation_zone,
        "distribution_zone": distribution_zone,
        "zone_type": zone_type,
        "atr": round(atr, 4),
        "dynamic_tolerance": dynamic_tolerance,
        # ⚡ VWAP Proxy — كشف accumulation/distribution حقيقي
        "vwap_proxy": vwap_data['vwap_proxy'],
        "current_vs_vwap": vwap_data['current_vs_vwap'],
        "vwap_flow": vwap_data['net_flow'],  # 'accumulation' | 'distribution' | 'neutral'
        "vwap_flow_strength": vwap_data['flow_strength'],
        "vwap_accumulation_days": vwap_data['accumulation_days'],
        "vwap_distribution_days": vwap_data['distribution_days'],
    }


# ==================== CLI ====================

def _format_sr(sr: Optional[Dict]) -> str:
    if not sr:
        return "❌ مفيش بيانات كافية لحساب الدعم/المقاومة للسهم ده."

    lines = [
        "=" * 60,
        f"📈 Support/Resistance Analysis",
        "=" * 60,
        f"  Current Price:     {sr['current_price']:.4f}",
        f"  Last Date:         {sr['last_date']}",
        f"  Fresh:             {'✅' if sr['is_fresh'] else '❌ (بيانات قديمة)'}",
        f"  ATR:               {sr.get('atr', 0):.4f}",
        f"  Dynamic Tolerance: {sr.get('dynamic_tolerance', 0.015):.3f}",
        f"  Avg Daily Volume:  {sr.get('avg_daily_volume', 0):,.0f}",
        "",
        f"  🛡️  Nearest Support:    {sr['support']:.4f}   ({sr['distance_to_support_pct']:+.2f}%)",
        f"  🚀 Nearest Resistance: {sr['resistance']:.4f}  ({sr['distance_to_resistance_pct']:+.2f}%)",
        f"  🛡️  Far Support:        {sr['far_support']:.4f}",
        f"  🚀 Far Resistance:     {sr['far_resistance']:.4f}",
        f"  📊 Pivot:              {sr['pivot']:.4f}",
        "",
        f"  📍 Zone:             {sr['zone'].upper()}",
        f"  Levels Count:       {sr['levels_count']}",
    ]

    # عرض مناطق التجميع/التوزيع لو موجودة
    if sr.get("accumulation_zone"):
        lines.append(f"  📦 Accumulation Zone:  ✅ (تراكم فوق الدعم)")
    if sr.get("distribution_zone"):
        lines.append(f"  📤 Distribution Zone:  ✅ (توزيع تحت المقاومة)")

    # عرض VWAP Proxy
    vwap_proxy = sr.get("vwap_proxy", 0)
    if vwap_proxy > 0:
        vwap_flow = sr.get("vwap_flow", "neutral")
        flow_emoji = {"accumulation": "📈", "distribution": "📉", "neutral": "➖"}.get(vwap_flow, "➖")
        lines.append("")
        lines.append(f"  ⚡ VWAP Proxy:         {vwap_proxy:.4f}  (vs close: {sr.get('current_vs_vwap', 0):+.2%})")
        lines.append(f"  ⚡ VWAP Flow:          {flow_emoji} {vwap_flow}  (strength: {sr.get('vwap_flow_strength', 0):.2f})")
        lines.append(f"  ⚡ VWAP Acc/Dist Days: {sr.get('vwap_accumulation_days', 0)} acc / {sr.get('vwap_distribution_days', 0)} dist")
    zone_type = sr.get("zone_type", "")
    if zone_type:
        zone_type_ar = {
            "accumulation": "تجميع",
            "distribution": "تصريف",
            "neutral": "محايد",
            "neutral_vwap_conflict": "تعارض VWAP",
        }.get(zone_type, zone_type)
        lines.append(f"  ⚡ Zone Type:          {zone_type_ar} ({zone_type})")

    # عرض المستوى الأساسي للدعم
    ps = sr.get("primary_support")
    if ps and isinstance(ps, dict):
        lines.append("")
        lines.append(f"  ⭐ Primary Support:     {ps['price']:.4f}  [{ps['strength']}]  (freshness: {ps['freshness']}, tests: {ps['tests_count']})")
    # عرض المستوى الأساسي للمقاومة
    pr = sr.get("primary_resistance")
    if pr and isinstance(pr, dict):
        lines.append(f"  ⭐ Primary Resistance:  {pr['price']:.4f}  [{pr['strength']}]  (freshness: {pr['freshness']}, tests: {pr['tests_count']})")

    # عرض كل المستويات بالتفصيل
    for tag, key in [("Support Levels", "support_levels"), ("Resistance Levels", "resistance_levels")]:
        levels = sr.get(key)
        if levels and isinstance(levels, list):
            lines.append("")
            lines.append(f"  --- {tag} ---")
            for lv in levels:
                if isinstance(lv, dict):
                    vol_str = f"{lv['volume_at_level']:,.0f}" if lv.get('volume_at_level') else "0"
                    lines.append(
                        f"    • {lv['price']:.4f}  [{lv['strength']}]  "
                        f"fresh={lv['freshness']}  tests={lv['tests_count']}  vol@lvl={vol_str}"
                    )

    lines.append("=" * 60)
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 support_resistance_calculator.py <TICKER> [days] [lookback]")
        print("Example: python3 support_resistance_calculator.py COMI 90 5")
        sys.exit(1)

    _ticker = sys.argv[1]
    _days = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_DAYS
    _lookback = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_LOOKBACK

    _sr = calculate_support_resistance(_ticker, days=_days, lookback=_lookback)
    print(_format_sr(_sr))
