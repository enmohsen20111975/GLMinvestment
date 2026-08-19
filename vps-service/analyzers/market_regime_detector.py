"""
Market Regime Detector — كاشف حالة السوق الديناميكي
=====================================================
يحسب حالة السوق العامة (bull/bear/sideways) + التقلب + السيولة
ويرجع معامل تعديل للثقة + thresholds.

فلسفة المحرك (استجابةً لطلب المالك):
- "المنظومة مبنية على نسب ديناميكية بناء على حركة السوق وحركة كل سهم"
- "مافيش ثوابت فى سوق متغير خالص"
- بدل ما ثابت threshold = 75، نخليه ديناميكي:
  * في سوق صاعد قوي: threshold = 70 (كن أكثر عدوانية)
  * في سوق هابط: threshold = 85 (كن أكثر حذراً)
  * في سوق متقلب: threshold = 80 + reduce position size

الاختبارات أثبتت:
- June 2026: 62.1% WR (سوق هابط) → threshold كان عالي جداً
- Dec 2025: 87.3% WR (سوق صاعد) → threshold كان مناسب
- لازم النظام يكتشف الفرق ويتأقلم

Usage:
    from analyzers.market_regime_detector import detect_market_regime
    regime = detect_market_regime()
    # regime = {
    #     'regime': 'bull' | 'bear' | 'sideways' | 'volatile',
    #     'regime_ar': 'صاعد' | 'هابط' | 'عرضي' | 'متقلب',
    #     'market_score': 0-100,
    #     'confidence_adjustment': +0 to -15 (كام نقطة نخصم من confidence),
    #     'threshold_adjustment': -5 to +10 (كام نقطة نزيد على threshold),
    #     'position_size_mult': 0.5 to 1.2 (معامل حجم المركز),
    #     'reason': '...'
    # }
"""
from __future__ import annotations

import sqlite3
import math
from typing import Dict, Any, Tuple, List
from pathlib import Path
from datetime import datetime, timedelta


_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


def _safe_query_prices(tickers: List[str], days: int = 30) -> Dict[str, List[Dict]]:
    """يجلب أسعار آخر N يوم لقائمة من الأسهم."""
    conn = sqlite3.connect(_PRICE_HISTORY_DB, timeout=10.0)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    results = {}

    for ticker in tickers:
        for table in ['stock_daily_prices', 'daily_prices', 'prices']:
            try:
                cur.execute(f'''
                    SELECT date, close_price, volume
                    FROM {table}
                    WHERE ticker = ? AND date >= ?
                    ORDER BY date ASC
                ''', (ticker, cutoff))
                rows = [dict(r) for r in cur.fetchall()]
                if rows:
                    results[ticker] = rows
                    break
            except Exception:
                continue

    conn.close()
    return results


def _get_top_egx_tickers(limit: int = 20) -> List[str]:
    """يجلب أهم أسهم EGX من stocks.db."""
    conn = sqlite3.connect(_STOCKS_DB, timeout=10.0)
    cur = conn.cursor()
    try:
        cur.execute('''
            SELECT ticker FROM stocks
            WHERE market = 'EGX' AND is_active = 1
            ORDER BY turnover_egp DESC
            LIMIT ?
        ''', (limit,))
        return [r[0] for r in cur.fetchall()]
    except Exception:
        # Fallback: get any tickers
        try:
            cur.execute('SELECT DISTINCT ticker FROM stocks LIMIT ?', (limit,))
            return [r[0] for r in cur.fetchall()]
        except Exception:
            return []
    finally:
        conn.close()


def _compute_market_breadth(prices_by_ticker: Dict) -> Dict:
    """يحسب اتساع السوق: كم سهم صاعد vs هابط + متوسط التغير."""
    advances = 0
    declines = 0
    unchanged = 0
    pct_changes = []

    for ticker, prices in prices_by_ticker.items():
        if len(prices) < 2:
            continue
        # Compare last close vs 20 days ago (or first available)
        ref_idx = max(0, len(prices) - 20)
        ref_price = prices[ref_idx].get('close_price', 0)
        last_price = prices[-1].get('close_price', 0)
        if ref_price > 0 and last_price > 0:
            pct = (last_price - ref_price) / ref_price * 100
            pct_changes.append(pct)
            if pct > 1:
                advances += 1
            elif pct < -1:
                declines += 1
            else:
                unchanged += 1

    total = advances + declines + unchanged
    if total == 0:
        return {'advances': 0, 'declines': 0, 'avg_change': 0, 'breadth_ratio': 0.5}

    avg_change = sum(pct_changes) / len(pct_changes) if pct_changes else 0
    # Breadth ratio: 1.0 = all advancing, 0.0 = all declining
    breadth_ratio = advances / total if total else 0.5

    return {
        'advances': advances,
        'declines': declines,
        'unchanged': unchanged,
        'avg_change': round(avg_change, 2),
        'breadth_ratio': round(breadth_ratio, 3),
    }


def _compute_market_volatility(prices_by_ticker: Dict) -> float:
    """يحسب تقلب السوق العام: متوسط ATR% لكل الأسهم."""
    atr_pcts = []
    for ticker, prices in prices_by_ticker.items():
        if len(prices) < 14:
            continue
        # Simple ATR calculation
        ranges = []
        for i in range(1, len(prices)):
            close = prices[i].get('close_price', 0)
            prev_close = prices[i-1].get('close_price', 0)
            if close > 0 and prev_close > 0:
                daily_range = abs(close - prev_close) / prev_close * 100
                ranges.append(daily_range)
        if len(ranges) >= 10:
            # Average of last 14 days
            recent = ranges[-14:]
            avg_atr = sum(recent) / len(recent)
            atr_pcts.append(avg_atr)

    if not atr_pcts:
        return 3.0  # default medium volatility

    return round(sum(atr_pcts) / len(atr_pcts), 2)


def detect_market_regime() -> Dict[str, Any]:
    """
    يكتشف حالة السوق الحالية ويرجع معاملات التعديل.

    Returns:
        {
            'regime': 'bull' | 'bear' | 'sideways' | 'volatile',
            'regime_ar': str,
            'market_score': 0-100,
            'confidence_adjustment': float (نخصم من confidence),
            'threshold_adjustment': float (نزيد على threshold),
            'position_size_mult': float (0.5-1.2),
            'breadth': Dict,
            'volatility': float,
            'reason': str,
        }
    """
    # Get top EGX tickers
    tickers = _get_top_egx_tickers(20)
    if not tickers:
        # Fallback: default regime if no data
        return {
            'regime': 'sideways',
            'regime_ar': 'عرضي',
            'market_score': 50,
            'confidence_adjustment': 0,
            'threshold_adjustment': 0,
            'position_size_mult': 1.0,
            'breadth': {},
            'volatility': 3.0,
            'reason': 'لا توجد بيانات كافية — استخدام الإعدادات الافتراضية',
        }

    # Get last 30 days of prices
    prices_by_ticker = _safe_query_prices(tickers, days=30)

    # Compute market metrics
    breadth = _compute_market_breadth(prices_by_ticker)
    volatility = _compute_market_volatility(prices_by_ticker)

    # Market score (0-100): 50 = neutral
    # + breadth_ratio * 30 (0-30)
    # + avg_change * 2 (-20 to +20)
    # - volatility penalty (-0 to -20)
    market_score = 50
    market_score += breadth['breadth_ratio'] * 30  # 0-30
    market_score += max(-20, min(20, breadth['avg_change'] * 2))  # -20 to +20
    # Volatility penalty: 2-4% = no penalty, >4% = penalty
    if volatility > 4:
        market_score -= min(20, (volatility - 4) * 5)
    market_score = max(0, min(100, market_score))

    # Determine regime
    if volatility > 6:
        regime = 'volatile'
        regime_ar = 'متقلب'
        confidence_adj = -15  # heavy penalty
        threshold_adj = +10   # be more selective
        position_mult = 0.5   # half position size
        reason = f'سوق متقلب جداً (ATR={volatility}%) — تقليل الثقة + تصغير المراكز'
    elif market_score >= 65:
        regime = 'bull'
        regime_ar = 'صاعد'
        confidence_adj = 0    # no penalty
        threshold_adj = -5    # be less selective (more trades)
        position_mult = 1.2   # larger positions
        reason = f'سوق صاعد (score={market_score:.0f}, breadth={breadth["breadth_ratio"]:.2f}) — عدوانية معتدلة'
    elif market_score <= 35:
        regime = 'bear'
        regime_ar = 'هابط'
        confidence_adj = -10  # penalty
        threshold_adj = +10   # be very selective
        position_mult = 0.6   # smaller positions
        reason = f'سوق هابط (score={market_score:.0f}, declines={breadth["declines"]}) — حذر شديد'
    else:
        regime = 'sideways'
        regime_ar = 'عرضي'
        confidence_adj = -3   # slight penalty
        threshold_adj = 0     # normal
        position_mult = 1.0   # normal positions
        reason = f'سوق عرضي (score={market_score:.0f}) — إعدادات افتراضية'

    return {
        'regime': regime,
        'regime_ar': regime_ar,
        'market_score': round(market_score, 1),
        'confidence_adjustment': confidence_adj,
        'threshold_adjustment': threshold_adj,
        'position_size_mult': position_mult,
        'breadth': breadth,
        'volatility': volatility,
        'reason': reason,
        'analyzed_at': datetime.now().isoformat(),
        'tickers_analyzed': len(tickers),
    }


def apply_regime_to_confidence(confidence: float, regime: Dict) -> Tuple[float, str]:
    """يطبق معامل السوق على نسبة الثقة.

    Args:
        confidence: نسبة الثقة الأصلية (0-100)
        regime: نتيجة detect_market_regime()

    Returns:
        (adjusted_confidence, adjustment_reason)
    """
    adj = regime.get('confidence_adjustment', 0)
    adjusted = max(0, min(100, confidence + adj))
    reason = f"تعديل السوق ({regime.get('regime_ar', '')}): {adj:+d} نقطة"
    return round(adjusted, 1), reason


def get_dynamic_threshold(base_threshold: float, regime: Dict) -> float:
    """يحسب threshold ديناميكي بناءً على حالة السوق.

    Args:
        base_threshold: الحد الأدنى الأساسي (مثل 75 لـ TOP_PICK)
        regime: نتيجة detect_market_regime()

    Returns:
        adjusted threshold
    """
    adj = regime.get('threshold_adjustment', 0)
    return max(40, min(90, base_threshold + adj))


# ---------------------------------------------------------------------------
# Module self-test
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("📊 Market Regime Detector — Self Test")
    print("=" * 60)

    regime = detect_market_regime()
    print(f"\nRegime: {regime['regime_ar']} ({regime['regime']})")
    print(f"Market Score: {regime['market_score']}/100")
    print(f"Volatility: {regime['volatility']}%")
    print(f"Breadth: {regime['breadth']}")
    print(f"Confidence Adjustment: {regime['confidence_adjustment']:+d}")
    print(f"Threshold Adjustment: {regime['threshold_adjustment']:+d}")
    print(f"Position Size Multiplier: {regime['position_size_mult']}x")
    print(f"Reason: {regime['reason']}")

    # Test apply_regime_to_confidence
    print(f"\n--- Testing apply_regime_to_confidence ---")
    test_confidences = [90, 75, 60, 45]
    for conf in test_confidences:
        adjusted, reason = apply_regime_to_confidence(conf, regime)
        print(f"  Original: {conf}% → Adjusted: {adjusted}% ({reason})")

    # Test get_dynamic_threshold
    print(f"\n--- Testing get_dynamic_threshold ---")
    base_thresholds = [75, 60, 45]  # TOP_PICK, STRONG, WATCH
    for base in base_thresholds:
        dynamic = get_dynamic_threshold(base, regime)
        print(f"  Base: {base} → Dynamic: {dynamic}")
