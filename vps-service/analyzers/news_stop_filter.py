"""
News Stop Filter Engine
محرك فلتر الأخبار المبسط

كيمي اقترح تبسيط الـ News لـ Stop Filter فقط
ده أوثق من الـ sentiment analysis المعقد اللي ممكن يدي false positives

القواعد:
1. لو فيه خبر على السهم في آخر 24 ساعة → HOLD (خوف من التقلب)
2. لو فيه خبر CBE في آخر 24 ساعة → كل التوقعات HOLD
3. لو مفيش أخبار → عادي نكمل التحليل

@version 2.0.0 - Simplified Stop Filter
@authorM2yDevelopers Team
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
import sqlite3
import os

# ==================== TYPES ====================

@dataclass
class NewsStopFilterResult:
    """نتيجة فحص الأخبار للـ Stop Filter"""
    has_news: bool
    has_cbe_news: bool
    news_count: int
    should_hold: bool
    reason: str
    reason_ar: str
    risk_level: str  # 'low', 'medium', 'high'
    latest_news_date: Optional[str] = None


# ==================== DATABASE FUNCTIONS ====================

# DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
# market_news lives in news.db (1019 rows). Was reading a legacy table in stocks.db (0 rows).
try:
    from utils.db_paths import DBPaths as _DBPaths
    _CANONICAL_NEWS_DB = _DBPaths.NEWS_DB
except Exception:
    import os as _os
    _CANONICAL_NEWS_DB = str(_os.path.join(
        _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
        'db', 'news.db'))


def _resolve_news_db(db_path: str) -> str:
    """ارجع المسار الكنسي لـ news.db (DBPaths.NEWS_DB).

    الـ db_path اللي بيت PASS من الـ callers بيتجاهل عمدًا لأن market_news موجودة
    فقط في news.db (stocks.db عندها جدول أخبار قديم فاضي). ده بيحافظ على الـ signature
    مع ضمان إن القراءة دايماً من المصدر الكنسي.
    """
    return _CANONICAL_NEWS_DB


def get_db_connection(db_path: str):
    """الحصول على اتصال قاعدة البيانات (يفتح دايماً news.db الكنسي)."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(_resolve_news_db(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


# ==================== MAIN FUNCTIONS ====================

def check_news_stop_filter(
    ticker: str,
    db_path: str,
    days_back: int = 1
) -> NewsStopFilterResult:
    """
    فحص الأخبار - Stop Filter بسيط
    
    Args:
        ticker: رمز السهم
        db_path: مسار قاعدة البيانات
        days_back: عدد الأيام للرجوع (افتراضي 1 يوم)
    
    Returns:
        NewsStopFilterResult: نتيجة الفلتر
    """
    try:
        conn = get_db_connection(db_path)
        cursor = conn.cursor()
        
        start_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
        
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        # جلب أخبار السهم (tickers column = JSON array، فلترة بـ LIKE)
        cursor.execute('''
            SELECT * FROM market_news
            WHERE tickers LIKE ? AND published_at >= ?
            ORDER BY published_at DESC
            LIMIT 5
        ''', (f'%"{ticker.upper()}"%', start_date))
        recent_news = cursor.fetchall()
        
        # جلب أخبار CBE (market-wide) — كشف بالمحتوى (مفيش عمود category='cbe')
        cursor.execute('''
            SELECT * FROM market_news
            WHERE (content LIKE '%بنك مركزي%' OR content LIKE '%CBE%')
              AND published_at >= ?
            ORDER BY published_at DESC
            LIMIT 3
        ''', (start_date,))
        cbe_news = cursor.fetchall()
        
        conn.close()
        
        has_news = len(recent_news) > 0
        has_cbe_news = len(cbe_news) > 0
        news_count = len(recent_news)
        
        # تحديد القرار
        if has_cbe_news:
            return NewsStopFilterResult(
                has_news=has_news,
                has_cbe_news=True,
                news_count=news_count,
                should_hold=True,
                reason='CBE decision within 24h - market uncertainty high',
                reason_ar='قرار بنك مركزي في آخر 24 ساعة - مخاطرة عالية',
                risk_level='high',
                latest_news_date=cbe_news[0]['published_at'] if cbe_news else None
            )
        
        if has_news:
            return NewsStopFilterResult(
                has_news=True,
                has_cbe_news=False,
                news_count=news_count,
                should_hold=True,
                reason=f'{news_count} news item(s) in last 24h - volatility expected',
                reason_ar=f'{news_count} خبر في آخر 24 ساعة - توقع تقلب',
                risk_level='medium',
                latest_news_date=recent_news[0]['published_at'] if recent_news else None
            )
        
        # مفيش أخبار - عادي
        return NewsStopFilterResult(
            has_news=False,
            has_cbe_news=False,
            news_count=0,
            should_hold=False,
            reason='No recent news - proceed with analysis',
            reason_ar='لا توجد أخبار حديثة - استمر في التحليل',
            risk_level='low'
        )
        
    except Exception as e:
        print(f'[NewsStopFilter] Error: {e}')
        # في حالة الخطأ، نرجع low risk عشان نوصلش النظام
        return NewsStopFilterResult(
            has_news=False,
            has_cbe_news=False,
            news_count=0,
            should_hold=False,
            reason='Error checking news - proceeding with caution',
            reason_ar='خطأ في فحص الأخبار - استمرار بحذر',
            risk_level='low'
        )


def has_recent_cbe_news(db_path: str, days_back: int = 1) -> bool:
    """فحص سريع لوجود أخبار CBE
    
    Phase 2 (V40): بيفحص كمان أخبار CBE مجدولة في الـ 24 ساعة الجاية.
    لو فيه قرار بنك مركزي بعد 24 ساعة → Hard Veto (max_position=0)
    عشان السوق بيرجع متوتر قبل القرار والحجم بيجف.
    """
    try:
        conn = get_db_connection(db_path)
        cursor = conn.cursor()
        
        start_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
        # Phase 2: بيفحص كمان أخبار مجدولة في الـ 24 ساعة الجاية
        end_date = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        # CBE news veto — كشف بالمحتوى (مفيش عمود category='cbe' في market_news)
        cursor.execute('''
            SELECT COUNT(*) as count FROM market_news
            WHERE (content LIKE '%بنك مركزي%' OR content LIKE '%CBE%')
              AND published_at >= ? AND published_at <= ?
        ''', (start_date, end_date))
        
        result = cursor.fetchone()
        conn.close()
        
        return result['count'] > 0
    except:
        return False


def get_news_sentiment_summary(ticker: str, db_path: str, days_back: int = 7) -> Dict[str, Any]:
    """
    الحصول على ملخص مشاعر الأخبار (للتوافق مع الكود القديم)
    """
    result = check_news_stop_filter(ticker, db_path, days_back)
    
    return {
        'ticker': ticker,
        'has_news': result.has_news,
        'has_cbe_news': result.has_cbe_news,
        'news_count': result.news_count,
        'should_hold': result.should_hold,
        'reason': result.reason,
        'reason_ar': result.reason_ar,
        'risk_level': result.risk_level,
        'sentiment': 'neutral',  # لا نحدد المشاعر
        'sentiment_score': 0,
        'impact_score': 0.9 if result.has_cbe_news else 0.5 if result.has_news else 0
    }


# ==================== CIRCUIT BREAKER ====================
# كيمي اقترحت الـ Circuit Breaker لحماية المستخدم من "أيام البلطجة"

@dataclass
class CircuitBreakerResult:
    """نتيجة فحص Circuit Breaker"""
    triggered: bool
    level: str  # 'none', 'warning', 'critical', 'extreme'
    action: str  # 'proceed', 'caution', 'hold_all', 'no_signals'
    reason: str
    reason_ar: str
    egx30_change: Optional[float] = None
    consecutive_down_days: Optional[int] = None


def check_circuit_breaker(egx30_history: List[Dict]) -> CircuitBreakerResult:
    """
    Circuit Breaker - حماية من تقلبات السوق الشديدة
    
    القواعد:
    1. EGX30 نازل >2% في يوم واحد → CAUTION
    2. EGX30 نازل >3% في يوم واحد → HOLD_ALL
    3. EGX30 نازل >3% في 3 أيام متتالية → NO_SIGNALS
    4. EGX30 طالع >3% في 3 أيام متتالية → CAUTION (السوق سخن)
    
    Args:
        egx30_history: قائمة بتاريخ EGX30 [{date, close, change_percent}, ...]
    
    Returns:
        CircuitBreakerResult
    """
    default_result = CircuitBreakerResult(
        triggered=False,
        level='none',
        action='proceed',
        reason='Normal market conditions',
        reason_ar='ظروف سوق طبيعية'
    )
    
    if not egx30_history:
        return default_result
    
    # ترتيب حسب التاريخ (الأحدث أولاً)
    sorted_history = sorted(
        egx30_history,
        key=lambda x: x.get('date', ''),
        reverse=True
    )
    
    if not sorted_history:
        return default_result
    
    latest = sorted_history[0]
    change_today = float(latest.get('change_percent', 0))
    
    # القاعدة 1: نزول حاد في يوم واحد (>2%)
    if change_today < -2:
        return CircuitBreakerResult(
            triggered=True,
            level='warning',
            action='caution',
            reason=f'EGX30 down {abs(change_today):.1f}% today - reduce position sizes',
            reason_ar=f'EGX30 نزل {abs(change_today):.1f}% اليوم - قلل أحجام المراكز',
            egx30_change=change_today
        )
    
    # القاعدة 2: نزول حاد في يوم واحد (>3%)
    if change_today < -3:
        return CircuitBreakerResult(
            triggered=True,
            level='critical',
            action='hold_all',
            reason=f'EGX30 crashed {abs(change_today):.1f}% - HOLD all positions',
            reason_ar=f'EGX30 انهار {abs(change_today):.1f}% - احتفظ بكل المراكز',
            egx30_change=change_today
        )
    
    # القاعدة 3: نزول متتالي (3 أيام)
    if len(sorted_history) >= 3:
        last3 = sorted_history[:3]
        all_down = all(float(d.get('change_percent', 0)) < 0 for d in last3)
        total_drop = sum(float(d.get('change_percent', 0)) for d in last3)
        
        if all_down and total_drop < -3:
            return CircuitBreakerResult(
                triggered=True,
                level='extreme',
                action='no_signals',
                reason=f'EGX30 down {abs(total_drop):.1f}% over 3 consecutive days - NO SIGNALS',
                reason_ar=f'EGX30 نزل {abs(total_drop):.1f}% خلال 3 أيام متتالية - لا إشارات',
                consecutive_down_days=3,
                egx30_change=total_drop
            )
    
    # القاعدة 4: صعود متتالي (السوق سخن)
    if len(sorted_history) >= 3:
        last3 = sorted_history[:3]
        all_up = all(float(d.get('change_percent', 0)) > 0 for d in last3)
        total_rise = sum(float(d.get('change_percent', 0)) for d in last3)
        
        if all_up and total_rise > 3:
            return CircuitBreakerResult(
                triggered=True,
                level='warning',
                action='caution',
                reason=f'EGX30 up {total_rise:.1f}% over 3 days - market is "hot", raise min score to 80',
                reason_ar=f'EGX30 طلع {total_rise:.1f}% خلال 3 أيام - السوق سخن، ارفع الحد الأدنى للدرجة لـ 80',
                egx30_change=total_rise
            )
    
    return default_result


def apply_circuit_breaker_to_recommendation(
    recommendation: Dict[str, Any],
    circuit_breaker: CircuitBreakerResult
) -> Dict[str, Any]:
    """تطبيق Circuit Breaker على التوقعة"""
    if not circuit_breaker.triggered:
        return recommendation
    
    modified = recommendation.copy()
    
    if circuit_breaker.action == 'hold_all':
        modified['recommendation'] = 'hold'
        modified['recommendation_ar'] = 'احتفاظ (Circuit Breaker)'
        modified['warnings'] = modified.get('warnings', [])
        modified['warnings'].append(circuit_breaker.reason_ar)
    
    elif circuit_breaker.action == 'no_signals':
        modified['recommendation'] = 'hold'
        modified['recommendation_ar'] = 'لا إشارات (Circuit Breaker)'
        modified['maestro_score'] = min(modified.get('maestro_score', 50), 40)
        modified['warnings'] = modified.get('warnings', [])
        modified['warnings'].append('⚠️ تحذير حرج: ' + circuit_breaker.reason_ar)
    
    elif circuit_breaker.action == 'caution':
        modified['warnings'] = modified.get('warnings', [])
        modified['warnings'].append(circuit_breaker.reason_ar)
        if 'position_size_percent' in modified:
            modified['position_size_percent'] *= 0.5
    
    return modified
