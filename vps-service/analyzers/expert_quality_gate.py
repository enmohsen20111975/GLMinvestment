"""
🧠 Expert Quality Gate — باب الجودة قبل أي توصية
==============================================

الفلسفة:
النظام بيطلع 50 توصية → الخبير بيمر عليها → يطلع 10 بس بس صح.
الجودة أهم من الكمية. المستخدم عايز 10 توصيات يكسب منهم 8.

الـ 6 اختبارات:
1. Divergence Test          — الخبر بيقول كويس، بس السعر عمل إيه؟
2. Correlation Test          — السهم طالع، بس القطاع والسوق عاملين إيه؟
3. Liquidity Quality         — السيولة حقيقية ولا وهمية؟ (VWAP)
4. Percentile Test           — السعر فين بالتاريخ؟ (قرب القمة ولا القاع)
5. Event Timing              — فيه حدث مهم قريب؟ (CBE, أرباح)
6. Support/Resistance Test   — الهدف والوقف من مستويات حقيقية؟ (ممنوع وهمي)

الاستخدام:
    from analyzers.expert_quality_gate import expert_quality_gate
    
    result = expert_quality_gate.evaluate(
        ticker='COMI',
        recommendation='BUY',
        entry_price=132.0,
        target_price=145.0,
        stop_loss=125.0,
        confidence=70,
        market='EGX',
    )
    
    if not result['approved']:
        print(f"❌ {ticker} rejected: {result['rejection_reason']}")
    else:
        print(f"✅ {ticker} approved (adjusted confidence: {result['adjusted_confidence']})")
"""

import sqlite3
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from pathlib import Path
import json

# ==================== CONFIG ====================

BASE_DIR = Path(__file__).parent.parent.parent.resolve()
STOCKS_DB = os.environ.get('STOCKS_DB', str(BASE_DIR / 'db' / 'stocks.db'))
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(BASE_DIR / 'db' / 'predictions.db'))

# ==================== glminvestment_engines WIRING (Phase 2) ====================
# Guarded import: if glminvestment_engines isn't importable (cwd not vps-service/,
# missing pandas, etc.) we fall back to legacy expert-gate logic. The env var
# ENABLE_ENGINES_VETO lets the operator disable the wiring at runtime without
# code changes if it misbehaves in production.
logger = logging.getLogger(__name__)
_ENGINES_VETO_ENABLED = os.environ.get(
    'ENABLE_ENGINES_VETO', 'true'
).lower() in ('1', 'true', 'yes', 'on')

try:
    from glminvestment_engines.integration.expert_gate_patch import (
        stage2_veto_check,
        vcp_confidence_boost,
    )
    _ENGINES_GATE_AVAILABLE = True
except Exception as _eng_gate_imp_err:  # pragma: no cover - defensive
    logger.warning(
        "glminvestment_engines.expert_gate_patch not available — "
        "Stage 2 veto / VCP boost will be skipped: %s", _eng_gate_imp_err
    )
    _ENGINES_GATE_AVAILABLE = False

# ==================== DATA CLASSES ====================

@dataclass
class TestResult:
    """نتيجة اختبار واحد من الـ 6"""
    test_name: str
    test_name_ar: str
    passed: bool
    score: float  # -100 to +100
    reason: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExpertVerdict:
    """القرار النهائي للخبير"""
    approved: bool
    ticker: str
    recommendation: str
    original_confidence: float
    adjusted_confidence: float
    confidence_adjustment: float
    expert_score: float  # -100 to +100
    expert_level: str    # opportunity / wait / avoid / strong_avoid
    tests: List[TestResult]
    rejection_reason: str
    investor_play: str
    gambler_play: str
    golden_rules_triggered: List[str]


# ==================== HELPERS ====================

def _get_db(db_path: str) -> sqlite3.Connection:
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def _get_price_history(ticker: str, days: int = 100) -> List[Dict]:
    """يجيب تاريخ الأسعار من stocks.db — مع fallback لأسامي columns مختلفة.

    PHASE 1 (v3.50.0): delegate to data.prices — single source of truth.
    The PRAGMA column-name detection below is no longer needed because
    load_price_history normalizes column names upstream. Returns dicts with
    the original `_price`-suffixed keys (date, open_price, high_price,
    low_price, close_price, volume) so callers keep working unchanged.
    load_price_history already returns oldest-first ordering.
    """
    try:
        from data.prices import load_price_history
        history = load_price_history(ticker, limit=days)
        return [
            {
                'date': c.get('date'),
                'open_price': c.get('open', 0.0),
                'high_price': c.get('high', 0.0),
                'low_price': c.get('low', 0.0),
                'close_price': c.get('close', 0.0),
                'volume': c.get('volume', 0),
            }
            for c in history
        ]
    except Exception as e:
        print(f"[ExpertGate] price history error for {ticker}: {e}")
        return []


def _get_stock_info(ticker: str) -> Optional[Dict]:
    """يجيب بيانات السهم الحالية"""
    try:
        conn = _get_db(STOCKS_DB)
        cur = conn.cursor()
        cur.execute('''
            SELECT ticker, name, name_ar, market, sector, current_price, volume,
                   change_percent, previous_close
            FROM stocks WHERE ticker = ?
        ''', (ticker.upper(),))
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception as e:
        print(f"[ExpertGate] stock info error for {ticker}: {e}")
        return None


def _calculate_vwap(history: List[Dict]) -> Optional[float]:
    """يحسب VWAP من آخر 20 يوم"""
    if not history:
        return None
    recent = history[-20:] if len(history) >= 20 else history
    total_pv = 0
    total_v = 0
    for h in recent:
        typical_price = (float(h.get('high_price', 0)) + float(h.get('low_price', 0)) + float(h.get('close_price', 0))) / 3
        vol = float(h.get('volume', 0) or 0)
        total_pv += typical_price * vol
        total_v += vol
    if total_v == 0:
        return None
    return total_pv / total_v


def _calculate_percentile(current_price: float, history: List[Dict], window: int = 252) -> Optional[float]:
    """يحسب فين السعر بالنسبة لتاريخه (0-100%)

    Rule 27: percentile is a positional INDICATOR (not a score) — returns None
    when no valid historical prices are available instead of fabricating 50.0.
    Caller (test_percentile) handles None with an early-pass TestResult.
    """
    prices = [float(h.get('close_price', 0)) for h in history if float(h.get('close_price', 0)) > 0]
    if not prices:
        return None
    prices = prices[-window:]
    below = sum(1 for p in prices if p < current_price)
    return (below / len(prices)) * 100


def _get_sector_performance(sector: str) -> float:
    """يحسب أداء القطاع (متوسط تغير الأسهم في نفس القطاع)"""
    try:
        conn = _get_db(STOCKS_DB)
        cur = conn.cursor()
        cur.execute('''
            SELECT AVG(change_percent) as avg_change
            FROM stocks WHERE sector = ? AND change_percent IS NOT NULL
        ''', (sector,))
        row = cur.fetchone()
        conn.close()
        return float(row['avg_change']) if row and row['avg_change'] is not None else 0.0
    except Exception:
        return 0.0


def _get_market_change() -> float:
    """يحسب تغير السوق الكلي (EGX30 أو متوسط)"""
    try:
        conn = _get_db(STOCKS_DB)
        cur = conn.cursor()
        cur.execute('''
            SELECT AVG(change_percent) as avg_change
            FROM stocks WHERE market = 'EGX' AND change_percent IS NOT NULL
        ''')
        row = cur.fetchone()
        conn.close()
        return float(row['avg_change']) if row and row['avg_change'] is not None else 0.0
    except Exception:
        return 0.0


def _detect_falling_knife(history: List[Dict], lookback: int = 5, threshold: float = -15.0) -> Tuple[bool, float]:
    """يكشف لو السهم نزل أكتر من 15% في 5 أيام"""
    if len(history) < lookback + 1:
        return False, 0.0
    recent = history[-(lookback + 1):]
    start_price = float(recent[0].get('close_price', 0))
    end_price = float(recent[-1].get('close_price', 0))
    if start_price <= 0:
        return False, 0.0
    change = ((end_price - start_price) / start_price) * 100
    return change < threshold, change


def _detect_stock_splits(history: List[Dict]) -> List[Dict]:
    """يكشف stock splits في التاريخ (نزول > 30% في يوم)"""
    splits = []
    for i in range(1, len(history)):
        today = float(history[i].get('close_price', 0))
        yesterday = float(history[i - 1].get('close_price', 0))
        if yesterday <= 0 or today <= 0:
            continue
        ratio = today / yesterday
        if ratio < 0.70:  # نزول أكتر من 30%
            splits.append({
                'date': history[i].get('date'),
                'yesterday_close': yesterday,
                'today_close': today,
                'ratio': ratio,
            })
    return splits


def _adjust_history_for_splits(history: List[Dict], prediction_date: str = None) -> Tuple[List[Dict], bool]:
    """يعدّل التاريخ عشان يتعامل مع الـ splits (نفس منطق Node.js)"""
    if len(history) < 2:
        return history, False

    adjusted = [dict(h) for h in history]
    pred_day = (prediction_date or '')[:10]
    split_found = False
    SPLIT_THRESHOLD = 0.30

    for i in range(1, len(adjusted)):
        today_close = float(adjusted[i].get('close_price', 0))
        yesterday_close = float(adjusted[i - 1].get('close_price', 0))
        if yesterday_close <= 0 or today_close <= 0:
            continue
        change_ratio = today_close / yesterday_close

        if change_ratio < (1 - SPLIT_THRESHOLD):
            today_date = adjusted[i].get('date', '')
            # لو الـ split بعد تاريخ التوقع، نطبّق التعديل
            if not pred_day or today_date > pred_day:
                split_ratio = yesterday_close / today_close
                split_found = True
                # عدّل كل الأسعار من اليوم ده وبعده
                for j in range(i, len(adjusted)):
                    for field_name in ['open_price', 'high_price', 'low_price', 'close_price']:
                        if field_name in adjusted[j]:
                            adjusted[j][field_name] = float(adjusted[j][field_name]) * split_ratio
    return adjusted, split_found


def _get_upcoming_events(ticker: str, days: int = 14) -> List[Dict]:
    """يجيب الأحداث القادمة للسهم من special-events"""
    try:
        # استيراد local لو موجود، fallback لقائمة ثابتة
        events = []
        # محاولة قراءة من predictions.db لو فيه جدول
        conn = _get_db(PREDICTIONS_DB)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_events'")
        if cur.fetchone():
            future_date = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')
            today_str = datetime.now().strftime('%Y-%m-%d')
            cur.execute('''
                SELECT * FROM stock_events
                WHERE ticker = ? AND event_date >= ? AND event_date <= ?
                ORDER BY event_date ASC
            ''', (ticker.upper(), today_str, future_date))
            events = [dict(r) for r in cur.fetchall()]
        conn.close()
        return events
    except Exception as e:
        print(f"[ExpertGate] events error: {e}")
        return []


def _get_news_sentiment(ticker: str) -> Optional[Dict]:
    """يجيب آخر خبر ومشاعره للسهم"""
    # TODO: ربط بنظام الأخبار لو موجود
    # حالياً نرجع None ومحرك التناقض هيتعامل معاه
    return None


# ==================== الـ 5 اختبارات ====================

def test_divergence(ticker: str, recommendation: str, history: List[Dict], stock_info: Dict) -> TestResult:
    """
    الاختبار 1: "السوق بيقول إيه؟"
    الخبر بيقول كويس، بس السعر عمل إيه بعد الخبر؟
    """
    test_name = "Divergence Test"
    test_name_ar = "اختبار التناقض"
    
    if not history or len(history) < 2:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش بيانات كافية — يعدي")
    
    news = _get_news_sentiment(ticker)
    if not news:
        # مفيش خبر = مفيش تناقض محتمل
        return TestResult(test_name, test_name_ar, True, 0, "مفيش خبر حديث — يعدي")
    
    # آخر تغير في السعر
    last_change = float(stock_info.get('change_percent', 0) or 0)
    news_sentiment = news.get('sentiment', 'neutral')
    
    is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY', 'ACCUMULATE']
    is_sell = recommendation.upper() in ['SELL', 'STRONG_SELL', 'REDUCE']
    
    # خبر كويس + سعر نزل = توزيع (حد كبير بيبيع)
    if news_sentiment == 'positive' and last_change < -0.5:
        return TestResult(
            test_name, test_name_ar, False, -80,
            f"خبر كويس بس السعر نزل {last_change:.2f}% — توزيع (حد كبير بيبيع)",
            {'news_sentiment': news_sentiment, 'price_change': last_change, 'divergence_type': 'distribution'}
        )
    
    # خبر سيء + سعر طلع = تراكم وهمي (احذر)
    if news_sentiment == 'negative' and last_change > 0.5:
        return TestResult(
            test_name, test_name_ar, False, -60,
            f"خبر سيء بس السعر طلع {last_change:.2f}% — تراكم وهمي (احذر)",
            {'news_sentiment': news_sentiment, 'price_change': last_change, 'divergence_type': 'fake_accumulation'}
        )
    
    # مفيش تناقض
    return TestResult(
        test_name, test_name_ar, True, 10,
        f"الخبر والسعر متفقين — حركة طبيعية",
        {'news_sentiment': news_sentiment, 'price_change': last_change}
    )


def test_correlation(ticker: str, recommendation: str, stock_info: Dict) -> TestResult:
    """
    الاختبار 2: "السهم ده بيطلع لوحده؟"
    السهم طالع، بس القطاع والسوق عاملين إيه؟
    🧠 الخبير الجديد: لو السوق نازل، ممنوع BUY (المضارب والمستثمر)
    """
    test_name = "Correlation Test"
    test_name_ar = "اختبار الارتباط"
    
    sector = stock_info.get('sector')
    stock_change = float(stock_info.get('change_percent', 0) or 0)
    
    if not sector:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش بيانات قطاع — يعدي")
    
    sector_change = _get_sector_performance(sector)
    market_change = _get_market_change()
    
    is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY']
    
    # 🧠 الخبير الجديد — القاعدة الذهبية: ممنوع BUY لو السوق نازل
    # "مينفعش يدخل إلا لو السوق طالع أو عرضي"
    if is_buy and market_change < -0.3:
        return TestResult(
            test_name, test_name_ar, False, -90,
            f"🚫 السوق نازل ({market_change:.2f}%) — ممنوع BUY. السوق صح، أنا غلط.",
            {'stock': stock_change, 'sector': sector_change, 'market': market_change, 'rule': 'no_buy_in_falling_market'}
        )
    
    # السهم طالع + القطاع نازل + السوق نازل = تمرد (هينقلب)
    if is_buy and stock_change > 2 and sector_change < -0.5 and market_change < -0.5:
        return TestResult(
            test_name, test_name_ar, False, -70,
            f"السهم طالع {stock_change:.1f}% بس القطاع نازل {sector_change:.1f}% والسوق نازل {market_change:.1f}% — تمرد هينقلب",
            {'stock': stock_change, 'sector': sector_change, 'market': market_change}
        )
    
    # السهم نازل + القطاع طالع + السوق طالع = السهم ضعيف
    if is_buy and stock_change < -1 and sector_change > 0.5 and market_change > 0.5:
        return TestResult(
            test_name, test_name_ar, False, -50,
            f"السوق والقطاع طالعين بس السهم نازل {stock_change:.1f}% — السهم ضعيف",
            {'stock': stock_change, 'sector': sector_change, 'market': market_change}
        )
    
    # السهم ماشي مع القطاع والسوق
    return TestResult(
        test_name, test_name_ar, True, 15,
        f"السهم ماشي مع القطاع ({sector_change:.1f}%) والسوق ({market_change:.1f}%)",
        {'stock': stock_change, 'sector': sector_change, 'market': market_change}
    )


def test_liquidity_quality(ticker: str, recommendation: str, history: List[Dict], stock_info: Dict) -> TestResult:
    """
    الاختبار 3: "السيولة حقيقية ولا وهمية؟"
    🧠 الخبير الجديد: السيولة لازم تكون فوق 1M جنيه في اليوم للمضارب
    "السهم اللي سيولته أقل من 500 ألف جنيه في اليوم = اتشال"
    """
    test_name = "Liquidity Quality Test"
    test_name_ar = "اختبار جودة السيولة"
    
    if not history:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش بيانات — يعدي")
    
    current_price = float(stock_info.get('current_price', 0) or 0)
    if current_price <= 0:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش سعر حالي — يعدي")
    
    vwap = _calculate_vwap(history)
    if not vwap:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش VWAP — يعدي")
    
    # حساب السيولة الحالية مقابل المتوسط
    recent_volumes = [float(h.get('volume', 0) or 0) for h in history[-20:]] if len(history) >= 20 else [float(h.get('volume', 0) or 0) for h in history]
    avg_volume = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 1
    current_volume = float(stock_info.get('volume', 0) or 0)
    volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1.0
    
    # 🧠 الخبير الجديد — القاعدة الذهبية: السيولة بالقيمة المطلقة
    # "مينفعش يدخل إلا لو السيولة فوق 1M في اليوم" (للمضارب)
    # "السهم اللي سيولته أقل من 500 ألف جنيه في اليوم = اتشال"
    liquidity_value_egp = current_price * current_volume  # قيمة السيولة بالجنيه
    is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY']
    
    if is_buy and liquidity_value_egp < 500_000:
        return TestResult(
            test_name, test_name_ar, False, -90,
            f"🚫 السيولة {liquidity_value_egp/1000:.0f}K جنيه فقط — أقل من 500K. اتشال.",
            {'liquidity_egp': liquidity_value_egp, 'volume': current_volume, 'rule': 'min_liquidity_500k'}
        )
    
    # سيولة عالية + السعر تحت VWAP = بيع مؤسسي
    if volume_ratio > 1.5 and current_price < vwap and is_buy:
        return TestResult(
            test_name, test_name_ar, False, -75,
            f"سيولة عالية ({volume_ratio:.1f}x) بس السعر تحت VWAP ({vwap:.2f}) — بيع مؤسسي",
            {'volume_ratio': volume_ratio, 'vwap': vwap, 'price': current_price}
        )
    
    # سيولة منخفضة + السعر طلع = تلاعب
    if volume_ratio < 0.5 and stock_info.get('change_percent', 0) and float(stock_info['change_percent']) > 2 and is_buy:
        return TestResult(
            test_name, test_name_ar, False, -60,
            f"سيولة منخفضة ({volume_ratio:.1f}x) بس السعر طلع — تلاعب محتمل",
            {'volume_ratio': volume_ratio, 'price_change': float(stock_info.get('change_percent', 0))}
        )
    
    # سيولة كويسة + السعر فوق VWAP = جمع حقيقي
    if volume_ratio >= 1.0 and current_price > vwap:
        return TestResult(
            test_name, test_name_ar, True, 20,
            f"سيولة كويسة ({volume_ratio:.1f}x, {liquidity_value_egp/1_000_000:.2f}M جنيه) والسعر فوق VWAP — جمع حقيقي",
            {'volume_ratio': volume_ratio, 'vwap': vwap, 'price': current_price, 'liquidity_egp': liquidity_value_egp}
        )
    
    return TestResult(
        test_name, test_name_ar, True, 5,
        f"سيولة عادية ({volume_ratio:.1f}x, {liquidity_value_egp/1_000_000:.2f}M جنيه)",
        {'volume_ratio': volume_ratio, 'vwap': vwap, 'liquidity_egp': liquidity_value_egp}
    )


def test_percentile(ticker: str, recommendation: str, history: List[Dict], stock_info: Dict) -> TestResult:
    """
    الاختبار 4: "السعر فين بالتاريخ؟"
    🧠 الخبير الجديد:
    - المضارب: ممنوع BUY لو percentile > 80% (قرب القمة)
    - المستثمر: BUY فقط لو percentile 10-50% (قرب القاع)
    """
    test_name = "Percentile Test"
    test_name_ar = "اختبار الموضع التاريخي"
    
    if not history:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش تاريخ — يعدي")
    
    current_price = float(stock_info.get('current_price', 0) or 0)
    if current_price <= 0:
        return TestResult(test_name, test_name_ar, True, 0, "مفيش سعر — يعدي")
    
    percentile = _calculate_percentile(current_price, history)
    if percentile is None:
        # No valid historical close prices — skip the test gracefully
        return TestResult(test_name, test_name_ar, True, 0, "مفيش أسعار تاريخ صالحة — يعدي")
    is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY']
    
    # 🧠 الخبير الجديد — قاعدة المضارب: ممنوع BUY فوق percentile 80%
    if is_buy and percentile >= 80:
        return TestResult(
            test_name, test_name_ar, False, -85,
            f"🚫 السهم في percentile {percentile:.0f}% — قرب القمة. ممنوع دخول المضارب.",
            {'percentile': percentile, 'rule': 'gambler_no_high_percentile'}
        )
    
    # BUY + percentile 70-80 = غالي (مفيش مجال)
    if is_buy and percentile >= 70:
        return TestResult(
            test_name, test_name_ar, False, -65,
            f"السهم في percentile {percentile:.0f}% — غالي، مفيش مجال للصعود",
            {'percentile': percentile}
        )
    
    # BUY + percentile 0-10 = حتة سودة (مفيش حد بيشتريه ليه؟)
    if is_buy and percentile <= 10:
        return TestResult(
            test_name, test_name_ar, False, -55,
            f"السهم في percentile {percentile:.0f}% — كنز ولا فخ؟ مفيش حد بيشتريه",
            {'percentile': percentile}
        )
    
    # BUY + percentile 10-50 = قرب القاع = فرصة ممتازة للمستثمر
    if is_buy and 10 < percentile <= 50:
        return TestResult(
            test_name, test_name_ar, True, 30,
            f"السهم في percentile {percentile:.0f}% — قرب القاع، فرصة كويسة جداً",
            {'percentile': percentile}
        )
    
    # BUY + percentile 50-70 = مستوى متوسط
    if is_buy and 50 < percentile < 70:
        return TestResult(
            test_name, test_name_ar, True, 10,
            f"السهم في percentile {percentile:.0f}% — مستوى متوسط، ادخل بحذر",
            {'percentile': percentile}
        )
    
    return TestResult(
        test_name, test_name_ar, True, 5,
        f"السهم في percentile {percentile:.0f}% — مستوى متوسط",
        {'percentile': percentile}
    )


def test_event_timing(ticker: str, recommendation: str) -> TestResult:
    """
    الاختبار 5: "قبل الحدث ولا بعده؟"
    فيه حدث مهم قريب؟ (CBE, أرباح, توزيعات)
    """
    test_name = "Event Timing Test"
    test_name_ar = "اختبار توقيت الأحداث"
    
    events = _get_upcoming_events(ticker, days=14)
    
    if not events:
        return TestResult(test_name, test_name_ar, True, 5, "مفيش أحداث قريبة — يعدي")
    
    # أقرب حدث
    nearest = events[0]
    event_date_str = nearest.get('event_date', '')
    try:
        event_date = datetime.strptime(event_date_str, '%Y-%m-%d')
        days_until = (event_date - datetime.now()).days
    except Exception:
        return TestResult(test_name, test_name_ar, True, 0, "تاريخ الحدث مشظبط — يعدي")
    
    is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY']
    event_type = nearest.get('event_type', 'news')
    
    # حدث بعد أقل من 12 ساعة = ماتلحقش
    if days_until <= 0:
        return TestResult(
            test_name, test_name_ar, False, -70,
            f"الحدث '{nearest.get('title', '')}' دلوقتي أو قريب جداً — ماتلحقش",
            {'event': nearest.get('title'), 'days_until': days_until}
        )
    
    # حدث بعد 1-3 أيام = السوق بيترقب
    if days_until <= 3 and is_buy:
        # لو الحدث earnings أو regulatory = مخاطرة عالية
        if event_type in ['earnings', 'regulatory', 'corporate_action']:
            return TestResult(
                test_name, test_name_ar, False, -60,
                f"حدث {event_type} بعد {days_until} يوم — انتظر، السوق بيترقب",
                {'event': nearest.get('title'), 'days_until': days_until, 'event_type': event_type}
            )
    
    # حدث بعد 4-14 يوم = ممكن يعدي لو مفيش مخاطرة
    if days_until <= 14 and is_buy and event_type == 'earnings':
        return TestResult(
            test_name, test_name_ar, False, -30,
            f"نتائج أرباح بعد {days_until} يوم — قلل الثقة",
            {'event': nearest.get('title'), 'days_until': days_until}
        )
    
    return TestResult(
        test_name, test_name_ar, True, 10,
        f"أقرب حدث بعد {days_until} يوم — آمن",
        {'event': nearest.get('title'), 'days_until': days_until}
    )


def test_support_resistance(
    ticker: str,
    recommendation: str,
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    stock_info: Dict,
) -> TestResult:
    """
    الاختبار 6: "الهدف والوقف من مستويات حقيقية؟"
    🧠 الخبير v4: ممنوع هدف فوق المقاومة، ممنوع وقف فوق الدعم، ممنوع middle zone.
    الـ percentage targets الفاضية (+4%/-8%) اتلغت — لازم S/R حقيقي.
    """
    test_name = "Support/Resistance Test"
    test_name_ar = "اختبار الدعم/المقاومة"

    # Defensive: لو مفيش target/stop → يعدي (النظام مش هيعرض توصية بدونهم)
    if not target_price or not stop_loss or entry_price <= 0:
        return TestResult(
            test_name, test_name_ar, True, 0,
            "مفيش target/stop — يعدي",
            {'has_target': bool(target_price), 'has_stop': bool(stop_loss)}
        )

    # Lazy import to avoid circular imports if support_resistance_calculator
    # ever imports from expert_quality_gate.
    from analyzers.support_resistance_calculator import calculate_support_resistance
    sr = calculate_support_resistance(ticker)

    if not sr or not sr.get('is_fresh'):
        return TestResult(
            test_name, test_name_ar, False, -50,
            "مفيش دعم/مقاومة محسوبة أو البيانات قديمة",
            {'fresh': sr.get('is_fresh') if sr else False}
        )

    resistance = float(sr.get('resistance') or 0)
    support = float(sr.get('support') or 0)
    zone = sr.get('zone', 'middle')

    # 1. Target must not be >10% above resistance (would be fake)
    if resistance > 0 and float(target_price) > resistance * 1.10:
        return TestResult(
            test_name, test_name_ar, False, -70,
            f"الهدف {target_price} فوق المقاومة {resistance:.2f} — وهمي",
            {'target': float(target_price), 'resistance': resistance, 'violation': 'target_above_resistance'}
        )

    # 2. Stop must not be above support (trap)
    if support > 0 and float(stop_loss) > support:
        return TestResult(
            test_name, test_name_ar, False, -70,
            f"الوقف {stop_loss} فوق الدعم {support:.2f} — فخ",
            {'stop': float(stop_loss), 'support': support, 'violation': 'stop_above_support'}
        )

    # 3. No trading in middle zone
    if zone == 'middle':
        return TestResult(
            test_name, test_name_ar, False, -40,
            (f"السهم في منتصف النطاق — مفيش دعم/مقاومة قريبة "
             f"({sr['distance_to_support_pct']:.1f}% / "
             f"{sr['distance_to_resistance_pct']:.1f}%)"),
            {'zone': 'middle',
             'dS': sr['distance_to_support_pct'],
             'dR': sr['distance_to_resistance_pct']}
        )

    # 4. Breakdown zone = reject
    if zone == 'breakdown':
        return TestResult(
            test_name, test_name_ar, False, -80,
            "السهم تحت كل الدعوم — breakdown",
            {'zone': 'breakdown'}
        )

    return TestResult(
        test_name, test_name_ar, True, 20,
        f"OK — zone={zone}, support={support:.2f}, resistance={resistance:.2f}",
        {'zone': zone, 'support': support, 'resistance': resistance,
         'far_support': sr.get('far_support'), 'far_resistance': sr.get('far_resistance')}
    )


# ==================== القواعد الذهبية ====================

def _check_golden_rules(ticker: str, recommendation: str, history: List[Dict], stock_info: Dict, tests: List[TestResult]) -> List[str]:
    """يفحص القواعد الذهبية الثمانية ويرجع اللي اتفعلت"""
    triggered = []
    
    stock_change = float(stock_info.get('change_percent', 0) or 0)
    is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY']
    now_month = datetime.now().month
    
    # القاعدة 1: السوق صح — أنا غلط
    # (لو فيه divergence test فشل = الخبر كويس بس السعر نزل)
    for t in tests:
        if t.test_name == "Divergence Test" and not t.passed and is_buy:
            triggered.append("🚨 القاعدة 1: السوق صح، أنا غلط — خبر كويس بس السعر نزل")
    
    # القاعدة 2: مفيش سهم بيطلع لوحده
    for t in tests:
        if t.test_name == "Correlation Test" and not t.passed and is_buy:
            triggered.append("⚠️ القاعدة 2: السهم بيتحرّك لوحده — تمرد ممكن ينقلب")
    
    # القاعدة 3: السيولة هي الحقيقة
    for t in tests:
        if t.test_name == "Liquidity Quality Test" and not t.passed:
            triggered.append("⚠️ القاعدة 3: حركة من غير سيولة حقيقية = كذب")
    
    # القاعدة 6: السهم في percentile 5% = كنز أو فخ
    for t in tests:
        if t.test_name == "Percentile Test" and not t.passed:
            percentile = t.details.get('percentile', 50)
            if percentile <= 5:
                triggered.append(f"⚠️ القاعدة 6: السهم في percentile {percentile:.0f}% — كنز ولا فخ؟")
    
    # القاعدة 7: رمضان = سوق ميت
    if now_month in [6, 7]:  # يونيو/يوليه (رمضان غالباً)
        triggered.append("⚠️ القاعدة 7: رمضان — السوق ميت، الحركات المبالغ فيها مش حقيقية")
    
    # القاعدة 8: يناير = الأسهم الصغيرة بتطير
    if now_month == 1:
        triggered.append("🟢 القاعدة 8: يناير — الأسهم الصغيرة بتطير")
    
    # فلتر Falling Knife (إضافي)
    is_fk, fk_drop = _detect_falling_knife(history)
    if is_fk and is_buy:
        triggered.append(f"🔴 Falling Knife: السهم نزل {fk_drop:.1f}% في 5 أيام — ابعد")
    
    return triggered


# ==================== الـ GATE الرئيسي ====================

class ExpertQualityGate:
    """
    🧠 باب الجودة — يفحص أي توصية قبل ما توصل للمستخدم
    """
    
    def evaluate(
        self,
        ticker: str,
        recommendation: str,
        entry_price: float,
        target_price: Optional[float] = None,
        stop_loss: Optional[float] = None,
        confidence: float = 50.0,
        market: str = 'EGX',
        prediction_date: str = None,
    ) -> ExpertVerdict:
        """
        يفحص التوصية في الـ 5 اختبارات ويرجع القرار
        """
        ticker = ticker.upper()
        prediction_date = prediction_date or datetime.now().isoformat()
        
        # جلب البيانات
        stock_info = _get_stock_info(ticker) or {}
        raw_history = _get_price_history(ticker, days=100)
        
        # تعديل التاريخ للـ splits
        history, split_adjusted = _adjust_history_for_splits(raw_history, prediction_date)
        
        # تشغيل الـ 6 اختبارات
        tests = [
            test_divergence(ticker, recommendation, history, stock_info),
            test_correlation(ticker, recommendation, stock_info),
            test_liquidity_quality(ticker, recommendation, history, stock_info),
            test_percentile(ticker, recommendation, history, stock_info),
            test_event_timing(ticker, recommendation),
            # 🧠 الخبير v4: اختبار S/R الجديد — ممنوع هدف فوق المقاومة، ممنوع وقف فوق الدعم
            test_support_resistance(ticker, recommendation, entry_price, target_price, stop_loss, stock_info),
        ]
        
        # فحص القواعد الذهبية
        golden_rules = _check_golden_rules(ticker, recommendation, history, stock_info, tests)
        
        # حساب درجة الخبير
        expert_score = sum(t.score for t in tests) / len(tests) if tests else 0
        
        # لو فيه falling knife في القواعد، نقص 30 درجة إضافية
        for rule in golden_rules:
            if 'Falling Knife' in rule and recommendation.upper() in ['BUY', 'STRONG_BUY']:
                expert_score -= 30
        
        expert_score = max(-100, min(100, expert_score))
        
        # تعديل الثقة
        confidence_adjustment = expert_score * 0.3  # كل درجة خبير = 0.3 تعديل ثقة
        adjusted_confidence = max(0, min(100, confidence + confidence_adjustment))
        
        # تحديد المستوى
        if expert_score >= 20:
            expert_level = 'opportunity'
        elif expert_score >= -10:
            expert_level = 'wait'
        elif expert_score >= -40:
            expert_level = 'avoid'
        else:
            expert_level = 'strong_avoid'
        
        # القرار النهائي
        is_buy = recommendation.upper() in ['BUY', 'STRONG_BUY']
        rejection_reason = ""
        approved = True
        
        # لو فيه اختبار فشل AND التوقع BUY = ارفض
        failed_tests = [t for t in tests if not t.passed]
        if failed_tests and is_buy:
            # لو في falling knife = ارفض فوراً
            for rule in golden_rules:
                if 'Falling Knife' in rule:
                    approved = False
                    rejection_reason = f"🚫 Falling Knife — السهم نزل بشدة"
                    break

            # 🧠 الخبير v4: S/R test = HARD VETO
            # لو اختبار الدعم/المقاومة فشل → ارفض فوراً.
            # الـ percentage targets الفاضية اتلغت — لازم target/stop من مستويات حقيقية.
            if approved:
                for t in tests:
                    if t.test_name == "Support/Resistance Test" and not t.passed:
                        approved = False
                        rejection_reason = f"🚫 S/R: {t.reason}"
                        break

            # لو الخبير بيقول strong_avoid = ارفض
            if approved and expert_level == 'strong_avoid':
                approved = False
                rejection_reason = f"🚫 الخبير بيقول ابعد بقوة: {failed_tests[0].reason}"

            # لو الثقة بعد التعديل أقل من 40 = ارفض
            elif approved and adjusted_confidence < 40:
                approved = False
                rejection_reason = f"🚫 الثقة بعد تعديل الخبير منخفضة ({adjusted_confidence:.0f})"

        # ── Phase 2: glminvestment_engines Stage 2 Veto + VCP Boost ──
        # Additive gate — only acts on BUY/STRONG_BUY signals that survived
        # the legacy checks above. If the stock is in Stage 1/3/4 (not Stage 2),
        # the engine veto REJECTS the signal. If a VCP pattern is detected,
        # confidence is boosted (capped at 100). On ANY exception, falls back
        # to the legacy approved/adjusted_confidence values already computed.
        if (_ENGINES_VETO_ENABLED and _ENGINES_GATE_AVAILABLE
                and is_buy and approved and history):
            try:
                import pandas as _pd
                # Convert history (list of dicts) to OHLCV DataFrame
                # expected by glminvestment_engines (close/high/low/volume).
                _df_ohlcv = _pd.DataFrame(history)
                _col_map = {
                    'open_price': 'open', 'high_price': 'high',
                    'low_price': 'low', 'close_price': 'close', 'volume': 'volume',
                }
                _df_ohlcv = _df_ohlcv.rename(
                    columns={k: v for k, v in _col_map.items() if k in _df_ohlcv.columns}
                )

                # Stage 2 hard veto — both BUY and STRONG_BUY are treated as
                # "BUY" proposed_signal (the engine only vetoes BUY-direction).
                _veto = stage2_veto_check(_df_ohlcv, ticker, 'BUY')
                if _veto and _veto.get('reject'):
                    approved = False
                    rejection_reason = (
                        f"🚫 Engines veto: {_veto.get('reason', 'Stage not 2')}"
                    )
                    logger.info(
                        "[Engines] VETO %s stage=%s — %s",
                        ticker, _veto.get('stage'), _veto.get('reason', '')
                    )
                else:
                    # VCP confidence boost (only when not vetoed).
                    # adjusted_confidence is on 0-100 scale; engine uses 0-1.
                    _base_conf_01 = max(0.0, min(1.0, adjusted_confidence / 100.0))
                    _vcp_res = vcp_confidence_boost(_df_ohlcv, ticker, _base_conf_01)
                    if _vcp_res.get('boosted'):
                        _new_conf_01 = float(_vcp_res.get('new_confidence', _base_conf_01))
                        adjusted_confidence = min(100.0, _new_conf_01 * 100.0)
                        logger.info(
                            "[Engines] VCP boost %s: +%.2f%% (vcp_score=%s)",
                            ticker,
                            (_new_conf_01 - _base_conf_01) * 100.0,
                            _vcp_res.get('vcp_score', 0),
                        )
            except Exception as _eng_gate_e:
                logger.warning(
                    "stage2_veto_check/vcp_confidence_boost failed for %s: %s "
                    "— falling back to legacy expert-gate logic",
                    ticker, _eng_gate_e
                )
                # Fall through with existing approved/adjusted_confidence values.

        # اللعب لكل شخصية
        investor_play = self._build_investor_play(approved, recommendation, expert_level, ticker)
        gambler_play = self._build_gambler_play(approved, recommendation, expert_level, ticker)
        
        return ExpertVerdict(
            approved=approved,
            ticker=ticker,
            recommendation=recommendation,
            original_confidence=confidence,
            adjusted_confidence=round(adjusted_confidence, 1),
            confidence_adjustment=round(confidence_adjustment, 1),
            expert_score=round(expert_score, 1),
            expert_level=expert_level,
            tests=tests,
            rejection_reason=rejection_reason,
            investor_play=investor_play,
            gambler_play=gambler_play,
            golden_rules_triggered=golden_rules,
        )
    
    def _build_investor_play(self, approved: bool, recommendation: str, expert_level: str, ticker: str) -> str:
        """يبني نصيحة المستثمر"""
        if not approved:
            return f"لو مستثمر: ابعد عن {ticker} — الخبير رفض التوصية"
        if expert_level == 'opportunity':
            return f"لو مستثمر: اشترِ {ticker} على دفعتين، وقف خسارة تحت آخر قاع"
        if expert_level == 'wait':
            return f"لو مستثمر: راقب {ticker} — مفيش إشارة قوية"
        if expert_level == 'avoid':
            return f"لو مستثمر: انتظر {ticker} لحد ما السوق يوضح"
        return f"لو مستثمر: ابعد عن {ticker} — فيه خطر نزول حاد"
    
    def _build_gambler_play(self, approved: bool, recommendation: str, expert_level: str, ticker: str) -> str:
        """يبني نصيحة المغامر"""
        if not approved:
            return f"لو مغامر: لو عندك {ticker} — بيع. لو لسه — متدخلش"
        if expert_level == 'opportunity':
            return f"لو مغامر: ادخل {ticker} بمخاطرة محسوبة، هدف +5%"
        if expert_level == 'wait':
            return f"لو مغامر: السوق عرضي — مفيش لعبة واضحة على {ticker}"
        if expert_level == 'avoid':
            return f"لو مغامر: فيه فرصة بيع مكشوفة على {ticker} بس مخاطرة عالية"
        return f"لو مغامر: ابعد تماماً عن {ticker}"
    
    def filter_predictions(self, predictions: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
        """
        يفلتر قائمة توصيات كاملة
        يرجع: (approved_list, rejected_list)
        """
        approved_list = []
        rejected_list = []
        
        for pred in predictions:
            ticker = pred.get('ticker', '')
            recommendation = pred.get('recommendation') or pred.get('signal', 'HOLD')
            confidence = float(pred.get('confidence', 50) or 50)
            entry_price = float(pred.get('entry_price', 0) or 0)
            target_price = pred.get('target_price')
            stop_loss = pred.get('stop_loss')
            market = pred.get('market', 'EGX')
            
            verdict = self.evaluate(
                ticker=ticker,
                recommendation=recommendation,
                entry_price=entry_price,
                target_price=target_price,
                stop_loss=stop_loss,
                confidence=confidence,
                market=market,
            )
            
            if verdict.approved:
                # عدّل الثقة وأضف بيانات الخبير
                pred['confidence'] = verdict.adjusted_confidence
                pred['expert_score'] = verdict.expert_score
                pred['expert_level'] = verdict.expert_level
                pred['expert_investor_play'] = verdict.investor_play
                pred['expert_gambler_play'] = verdict.gambler_play
                pred['expert_rules'] = verdict.golden_rules_triggered
                approved_list.append(pred)
            else:
                pred['expert_rejection'] = verdict.rejection_reason
                pred['expert_score'] = verdict.expert_score
                rejected_list.append(pred)
        
        return approved_list, rejected_list


# ==================== SINGLETON ====================

expert_quality_gate = ExpertQualityGate()


# ==================== CLI للاختبار ====================

if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python expert_quality_gate.py <TICKER> [BUY|SELL]")
        sys.exit(1)
    
    ticker = sys.argv[1]
    rec = sys.argv[2] if len(sys.argv) > 2 else 'BUY'
    
    verdict = expert_quality_gate.evaluate(
        ticker=ticker,
        recommendation=rec,
        entry_price=100,
        confidence=70,
        market='EGX',
    )
    
    print(f"\n🧠 Expert Quality Gate — {ticker}")
    print("=" * 60)
    print(f"Approved: {'✅' if verdict.approved else '❌'}")
    print(f"Expert Score: {verdict.expert_score}")
    print(f"Expert Level: {verdict.expert_level}")
    print(f"Confidence: {verdict.original_confidence} → {verdict.adjusted_confidence}")
    print()
    print("Tests:")
    for t in verdict.tests:
        status = '✅' if t.passed else '❌'
        print(f"  {status} {t.test_name_ar}: {t.reason}")
    print()
    if verdict.golden_rules_triggered:
        print("Golden Rules:")
        for r in verdict.golden_rules_triggered:
            print(f"  {r}")
        print()
    print(f"Investor: {verdict.investor_play}")
    print(f"Gambler: {verdict.gambler_play}")
    if not verdict.approved:
        print(f"\nRejection: {verdict.rejection_reason}")
