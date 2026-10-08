"""
 Hunting Engine V2 — الصياد الجديد
====================================
محرك صياد جديد مبني جنب المحرك القديم (maestro_orchestrator) من غير ما يمسّه.
3 مراحل: Screener → Expert Eye → Boss Pick

القاعدة الذهبية: مفيش أي تعديل في maestro_orchestrator.py أو hunter_routes.py القديم.
ده ملف جديد مستقل يستورد بس الدوال المطلوبة (gather_context, calculate_personas, generate_narrative).

@version 2.0.0 - Hunter V2
"""

import os
import re
import sys
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple


# ============================================================
# Helper: تنظيف الـ ticker من الحروف العربية (التحسين 5)
# ============================================================
# stocks.db بيستخدم ticker نظيف زي "AALR"
# لكن data_engine.db ممكن يكون فيها "AALRالعامة" أو "AALR العامة"
# فلازم ننظف الـ ticker قبل ما نستدعي calculate_personas()
_ARABIC_CHARS_RE = re.compile(r'[\u0600-\u06FF\u0750-\u077F\s]+')


def _clean_ticker(ticker: str) -> str:
    """ينظف الـ ticker من الحروف العربية والمسافات الزيادة.

    مثال: "AALRالعامة" → "AALR", "AALR العامة" → "AALR"
    """
    if not ticker:
        return ''
    cleaned = _ARABIC_CHARS_RE.sub('', ticker).strip()
    return cleaned or ticker

# ضمان إن الـ imports بتاعت maestro تشتغل
_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))

STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
NEWS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')  # Consolidated July 2026
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')

# استيراد دوال maestro بدون ما نلمس الكود القديم
try:
    from analyzers.maestro_orchestrator import (
        gather_context, calculate_personas, generate_narrative,
        MaestroHumanContext, MaestroPersonas, MaestroNarrative,
    )
    MAESTRO_AVAILABLE = True
except Exception as _e:
    MAESTRO_AVAILABLE = False
    _MAESTRO_IMPORT_ERROR = str(_e)


# ============================================================
# Utilities
# ============================================================

def _connect(db_path: str) -> Optional[sqlite3.Connection]:
    """اتصال آمن بـ SQLite مع WAL و busy_timeout."""
    if not os.path.exists(db_path):
        return None
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('PRAGMA busy_timeout=30000;')
        return conn
    except Exception:
        return None


def _safe_float(v, default=0.0) -> float:
    try:
        if v is None or v == '':
            return default
        return float(v)
    except Exception:
        return default


def _safe_int(v, default=0) -> int:
    try:
        if v is None or v == '':
            return default
        return int(float(v))
    except Exception:
        return default


def _parse_volume(v, default=0) -> int:
    """🔧 V2.2.1: parses volume strings like '1.44 M', '652.32 K', '1,234', 1234.
    stocks.db (new) stores volume as TEXT with M/K suffixes. This normalizes to int."""
    try:
        if v is None or v == '':
            return default
        if isinstance(v, (int, float)):
            return int(v)
        s = str(v).strip().replace(',', '').upper()
        mult = 1
        if s.endswith('M'):
            mult = 1_000_000
            s = s[:-1].strip()
        elif s.endswith('K'):
            mult = 1_000
            s = s[:-1].strip()
        elif s.endswith('B'):
            mult = 1_000_000_000
            s = s[:-1].strip()
        return int(float(s) * mult)
    except Exception:
        return default


def _market_filter(market: str) -> str:
    """تحويل كود السوق من الـ frontend لـ كود الـ DB.
    🔧 V2.2.1: مدعوم من stocks.db الجديد: EGX, KSE, QSE, TADAWUL.
    """
    m = (market or 'EGX').upper()
    if m in ('TADAWUL', 'KSA', 'SAUDI', 'SA'):
        return 'TADAWUL'
    if m in ('EGX', 'KSE', 'QSE', 'CRYPTO'):
        return m
    return 'EGX'


# ============================================================
# Helper: حساب avg_volume + 52-week high/low من price_history
# ============================================================

def _get_price_stats(ticker: str, days: int = 30, ref_price: float = 0.0) -> Dict[str, Any]:
    """
    بيرجع إحصائيات السعر للسهم من price_history.db:
    - avg_volume: متوسط حجم التداول (آخر `days` يوم)
    - high: أعلى سعر (آخر `days` يوم)
    - low: أدنى سعر (آخر `days` يوم)
    - last_close: آخر إغلاق
    - prev_close: الإغلاق اللي قبله (لحساب change_percent)
    - change_pct: التغير اليومي (من price_history)
    - history: آخر N يوم (list of dicts)
    - prices_compatible: هل الأسعار متوافقة مع ref_price؟ (ضمن ±50%)

    ملاحظة: price_history.db قديمة ومش متزامنة مع stocks.db، فلازم نفحص التوافق.
    """
    result = {
        'avg_volume': 0,
        'high': 0.0,
        'low': 0.0,
        'last_close': 0.0,
        'prev_close': 0.0,
        'change_pct': 0.0,
        'history': [],
        'prices_compatible': True,
    }
    conn = _connect(PRICE_HISTORY_DB)
    if not conn:
        return result
    try:
        cur = conn.cursor()
        # 🔧 V2.1: ناخد ضعف الأيام عشان نعوض الصفوف الشاذة اللي هتتفلتر (splits)
        # price_history فيها بيانات مختلطة قبل/بعد splits، فلازم نفلترها
        cur.execute(
            "SELECT date, open_price, high_price, low_price, close_price, volume "
            "FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?",
            (ticker, days * 3)
        )
        rows = cur.fetchall()
        if not rows:
            # محاولة fallback على stock_daily_prices في stocks.db
            conn.close()
            return _get_price_stats_from_stocks_db(ticker, days)

        # 🔧 V2.1: حدد السعر المرجعي من آخر صف (الأحدث)
        # كل الصفوف اللي أسعارها بعيدة عنه بأكثر من 50% هي shah (splits)
        # بنستخدم آخر close كـ anchor
        raw_anchor = _safe_float(dict(rows[0]).get('close_price'))
        anchor = raw_anchor if raw_anchor > 0 else ref_price

        volumes = []
        highs = []
        lows = []
        closes = []
        history = []
        for r in rows:
            d = dict(r)
            v = _safe_int(d.get('volume'))
            h = _safe_float(d.get('high_price'))
            l = _safe_float(d.get('low_price'))
            c = _safe_float(d.get('close_price'))

            # فلتر الصفوف الشاذة (splits): الأسعار لازم تكون ضمن 50%-200% من anchor
            if anchor > 0:
                if h > 0 and (h / anchor < 0.5 or h / anchor > 2.0):
                    continue
                if l > 0 and (l / anchor < 0.5 or l / anchor > 2.0):
                    continue
                if c > 0 and (c / anchor < 0.5 or c / anchor > 2.0):
                    continue

            if v > 0:
                volumes.append(v)
            if h > 0:
                highs.append(h)
            if l > 0:
                lows.append(l)
            if c > 0:
                closes.append(c)
            history.append({
                'date': d.get('date', ''),
                'open': _safe_float(d.get('open_price')),
                'high': h,
                'low': l,
                'close': c,
                'volume': v,
            })

        result['avg_volume'] = sum(volumes) / len(volumes) if volumes else 0
        result['high'] = max(highs) if highs else 0.0
        result['low'] = min(lows) if lows else 0.0
        result['last_close'] = closes[0] if closes else 0.0
        result['prev_close'] = closes[1] if len(closes) > 1 else 0.0
        if result['last_close'] > 0 and result['prev_close'] > 0:
            result['change_pct'] = ((result['last_close'] - result['prev_close']) / result['prev_close']) * 100
        result['history'] = history

        # فحص التوافق: لو ref_price موجود و last_close مختلف بشكل كبير (>50%)،
        # معناه إن price_history قديمة ومش متزامنة مع stocks.db
        if ref_price > 0 and result['last_close'] > 0:
            ratio = result['last_close'] / ref_price
            if ratio < 0.5 or ratio > 2.0:
                result['prices_compatible'] = False
    except Exception:
        pass
    finally:
        conn.close()
    return result


def _get_price_stats_from_stocks_db(ticker: str, days: int = 30) -> Dict[str, Any]:
    """fallback من stocks.db.stock_daily_prices لو price_history.db فاضي."""
    result = {
        'avg_volume': 0, 'high': 0.0, 'low': 0.0, 'last_close': 0.0,
        'prev_close': 0.0, 'change_pct': 0.0, 'history': [],
    }
    conn = _connect(STOCKS_DB)
    if not conn:
        return result
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT price_date, open, high, low, close, volume "
            "FROM stock_daily_prices WHERE ticker = ? ORDER BY price_date DESC LIMIT ?",
            (ticker, days)
        )
        rows = cur.fetchall()
        volumes, highs, lows, closes, history = [], [], [], [], []
        for r in rows:
            d = dict(r)
            v = _safe_int(d.get('volume'))
            h = _safe_float(d.get('high'))
            l = _safe_float(d.get('low'))
            c = _safe_float(d.get('close'))
            if v > 0: volumes.append(v)
            if h > 0: highs.append(h)
            if l > 0: lows.append(l)
            if c > 0: closes.append(c)
            history.append({
                'date': d.get('price_date', ''),
                'open': _safe_float(d.get('open')),
                'high': h, 'low': l, 'close': c, 'volume': v,
            })
        result['avg_volume'] = sum(volumes) / len(volumes) if volumes else 0
        result['high'] = max(highs) if highs else 0.0
        result['low'] = min(lows) if lows else 0.0
        result['last_close'] = closes[0] if closes else 0.0
        result['history'] = history
    except Exception:
        pass
    finally:
        conn.close()
    return result


# ============================================================
# STAGE 1: Screener — فلتر أولي سريع
# ============================================================

def stage1_screener(market: str = 'EGX', limit: int = 100) -> List[Dict[str, Any]]:
    """
    المرحلة الأولى: فلترة سريعة من stocks.db + price_history.db.

    🔧 تحسين V2.1: السعر الصحيح بيجي من price_history (آخر إغلاق)،
    لأن stocks.db.current_price قديمة بعد عمليات التجزئة (splits).
    لو price_history مش متاحة، fallback على stocks.db.

    الشروط:
    - is_active = 1
    - current_price > 0 و volume > 0
    - 🔧 V2.1: current_price >= 5.0 (التحسين 4 — امسح الأسهم الرخيصة)
    - volume > avg_volume * 1.2  (سيولة أعلى من المتوسط)
    - |change_percent| > 1.5  (فيه حركة)
    - liquidity_value >= 2,000,000  (سيولة كافية)
    - مش قرب القمة (current_price < high_30d * 0.90)
    - مش قرب القاع (current_price > low_30d * 1.10)

    بيرجع أول `limit` سهم مرتبين حسب liquidity_value DESC.
    """
    market_code = _market_filter(market)
    conn = _connect(STOCKS_DB)
    if not conn:
        return []
    candidates: List[Dict[str, Any]] = []
    try:
        cur = conn.cursor()
        # بناخد كل الأسهم النشطة في السوق المختار
        # 🔧 V2.2.1: stocks.db الجديد أعمدته: high_52w, low_52w, support, resistance
        # (مش ath, atl, support_level, resistance_level) + مفيش is_crypto (كريبتو في crypto.db)
        if market_code == 'CRYPTO':
            cur.execute(
                "SELECT ticker, name, name_ar, sector, current_price, change_percent, "
                "volume, market_cap, is_active, high_52w, low_52w, support, resistance, "
                "last_update "
                "FROM stocks WHERE is_active = 1 "
                "AND current_price > 0 AND volume > 0"
            )
        else:
            cur.execute(
                "SELECT ticker, name, name_ar, sector, current_price, change_percent, "
                "volume, market_cap, is_active, high_52w, low_52w, support, resistance, "
                "last_update "
                "FROM stocks WHERE is_active = 1 AND market = ? "
                "AND current_price > 0 AND volume > 0",
                (market_code,)
            )
        rows = cur.fetchall()

        for r in rows:
            d = dict(r)
            ticker = d.get('ticker', '')
            stocks_price = _safe_float(d.get('current_price'))
            stocks_volume = _parse_volume(d.get('volume'))
            change_pct = _safe_float(d.get('change_percent'))

            # 🔧 V2.1: السعر الصحيح من price_history (آخر إغلاق)
            # stocks.db.current_price قديمة بعد الـ splits، فprice_history هو المصدر الموثوق
            stats = _get_price_stats(ticker, days=30, ref_price=stocks_price)
            avg_volume = stats['avg_volume']
            high_30d = stats['high']
            low_30d = stats['low']
            last_close = stats['last_close']

            # السعر الصحيح = last_close من price_history لو متاح،
            # ونطبق prices_compatible check (ratio بين 0.5 و 2.0)
            prices_compatible = stats.get('prices_compatible', True)
            if last_close > 0 and prices_compatible:
                current_price = last_close
            else:
                # fallback على stocks.db (مع رفض لو غير متوافق بشكل كبير)
                current_price = stocks_price

            # 🔧 V2.1: نستخدم change_pct من price_history (أدق) لو متاح ومتوافق
            if prices_compatible and stats.get('change_pct', 0.0) != 0.0:
                change_pct = stats['change_pct']

            # 🔧 V2.1: نستخدم volume من price_history (آخر يوم) لو متوافق
            # لأن stocks.db.volume قديمة بعد الـ splits
            history = stats.get('history', [])
            if prices_compatible and history and history[0].get('volume', 0) > 0:
                volume = history[0]['volume']
            else:
                volume = stocks_volume

            # Skip لو مفيش بيانات كافية
            if current_price <= 0 or volume <= 0:
                continue

            # 🔧 V2.3 (طلب الخبير محسن): السعر الأدنى 3 جنيه (مش 5) عشان يدخل أسهم متوسطة
            if market_code != 'CRYPTO' and current_price < 3.0:
                continue

            # فلتر السيولة: 2 مليون على الأقل (أو 200k للكريبتو)
            liquidity_value = volume * current_price
            min_liquidity = 200_000 if market_code == 'CRYPTO' else 2_000_000
            if liquidity_value < min_liquidity:
                continue

            # فلتر الحركة: |change_percent| > 1.5% OR (volume_ratio > 1.2)
            # volume_ratio بنحسبها بس لو prices_compatible (لأن avg_volume من price_history موثوق)
            if prices_compatible and avg_volume > 0:
                volume_ratio = volume / avg_volume
            else:
                volume_ratio = 1.0  # افتراضي لو price_history غير متوافقة
            has_movement = abs(change_pct) > 1.5 or volume_ratio > 1.2
            if not has_movement:
                continue

            # فلتر الموقع: مش عند القمة بالظبط ولا عند القاع بالظبط
            # 🔧 V2.1: أرخّينا الفلتر لـ 95% (بدل 90%) عشان نسمح بأسهم فيها momentum
            # وفلتر القاع 1.05 (بدل 1.10) عشان نسمح بأسهم مرتدة من دعم
            if prices_compatible and high_30d > 0:
                high_ref = high_30d
            else:
                high_ref = _safe_float(d.get('high_52w'))
            if prices_compatible and low_30d > 0:
                low_ref = low_30d
            else:
                low_ref = _safe_float(d.get('low_52w'))

            if high_ref > 0 and current_price > high_ref * 0.95:
                # السهم قرب القمة جداً — نتجاهله
                continue
            if low_ref > 0 and current_price < low_ref * 1.05:
                # السهم قرب القاع جداً — نتجاهله (خطر)
                continue

            candidates.append({
                'ticker': ticker,
                'name': d.get('name') or ticker,
                'name_ar': d.get('name_ar') or d.get('name') or ticker,
                'sector': d.get('sector') or '',
                'price': current_price,
                'change_1d': change_pct,
                'volume': volume,
                'avg_volume': avg_volume,
                'volume_ratio': round(volume_ratio, 2),
                'high_30d': high_ref,
                'low_30d': low_ref,
                'market_cap': _safe_float(d.get('market_cap')),
                'support_level': _safe_float(d.get('support')),
                'resistance_level': _safe_float(d.get('resistance')),
                'liquidity_value': liquidity_value,
                'prices_compatible': prices_compatible,
            })

        # ترتيب حسب liquidity_value DESC (أكتر سيولة الأول) وأخذ أول `limit`
        candidates.sort(key=lambda x: x.get('liquidity_value', 0), reverse=True)
        return candidates[:limit]
    except Exception:
        return []
    finally:
        conn.close()


# ============================================================
# STAGE 2: Expert Eye — فلترة قطاعية + أخبار + سياق سوق
# ============================================================

def _get_sector_performance(market: str, sector: str) -> Optional[float]:
    """متوسط أداء القطاع من price_history.db (آخر 30 يوم)."""
    if not sector:
        return None
    conn_stocks = _connect(STOCKS_DB)
    if not conn_stocks:
        return None
    tickers: List[str] = []
    try:
        cur = conn_stocks.cursor()
        market_code = _market_filter(market)
        cur.execute(
            "SELECT ticker FROM stocks WHERE market = ? AND sector = ? AND is_active = 1",
            (market_code, sector)
        )
        tickers = [r[0] for r in cur.fetchall()]
    except Exception:
        pass
    finally:
        conn_stocks.close()

    if not tickers:
        return None

    conn_ph = _connect(PRICE_HISTORY_DB)
    if not conn_ph:
        return None
    perfs: List[float] = []
    try:
        cur = conn_ph.cursor()
        for t in tickers[:30]:  # عينة 30 سهم كحد أقصى
            cur.execute(
                "SELECT close_price FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 31",
                (t,)
            )
            closes = [r[0] for r in cur.fetchall() if r[0]]
            if len(closes) >= 2:
                # تغير النسبة من أقدم لأحدث في آخر 30 يوم
                old = closes[-1]
                new = closes[0]
                if old > 0:
                    perfs.append(((new - old) / old) * 100)
    except Exception:
        pass
    finally:
        conn_ph.close()

    if not perfs:
        return None
    return sum(perfs) / len(perfs)


def _detect_market_regime(market: str) -> str:
    """
    كشف حالة السوق (BULL/BEAR/SIDEWAYS) بسيط:
    بنحسب أداء آخر 30 يوم لمؤشر السوق (نستخدم متوسط أكبر 5 أسهم).
    """
    market_code = _market_filter(market)
    if market_code == 'CRYPTO':
        return 'SIDEWAYS'  # الكريبتو 24/7، نعتبره sideways افتراضياً

    conn = _connect(STOCKS_DB)
    if not conn:
        return 'SIDEWAYS'
    try:
        cur = conn.cursor()
        # نستخدم أكبر 5 أسهم في السوق كـ proxy للمؤشر
        cur.execute(
            "SELECT ticker FROM stocks WHERE market = ? AND is_active = 1 "
            "ORDER BY market_cap DESC LIMIT 5",
            (market_code,)
        )
        top_tickers = [r[0] for r in cur.fetchall()]
        if not top_tickers:
            return 'SIDEWAYS'
    except Exception:
        return 'SIDEWAYS'
    finally:
        conn.close()

    conn_ph = _connect(PRICE_HISTORY_DB)
    if not conn_ph:
        return 'SIDEWAYS'
    changes: List[float] = []
    try:
        cur = conn_ph.cursor()
        for t in top_tickers:
            cur.execute(
                "SELECT close_price FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 31",
                (t,)
            )
            closes = [r[0] for r in cur.fetchall() if r[0]]
            if len(closes) >= 2:
                old = closes[-1]
                new = closes[0]
                if old > 0:
                    changes.append(((new - old) / old) * 100)
    except Exception:
        pass
    finally:
        conn_ph.close()

    if not changes:
        return 'SIDEWAYS'
    avg_change = sum(changes) / len(changes)
    if avg_change > 5:
        return 'BULL'
    if avg_change < -5:
        return 'BEAR'
    return 'SIDEWAYS'


def _get_recent_news(ticker: str, hours: int = 48) -> List[Dict[str, Any]]:
    """آخر أخبار السهم من news.db خلال `hours` ساعة."""
    conn = _connect(NEWS_DB)
    if not conn:
        return []
    try:
        cur = conn.cursor()
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
        # FIX-WAVE-2-DATA (AUDIT-DEEP-5 #4): table renamed news_articles → market_news
        # per Rule 44. Column mapping: summary→summary_ar, market_code→market,
        # symbol→tickers (JSON array — filter with LIKE), category→impact_type.
        cur.execute(
            "SELECT title, summary_ar AS summary, source, published_at, "
            "market, market AS market_code, tickers AS symbol, impact_type AS category "
            "FROM market_news "
            "WHERE tickers LIKE ? "
            "AND published_at >= ? "
            "ORDER BY published_at DESC LIMIT 10",
            (f'%"{ticker}"%', cutoff)
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()


def _is_negative_news(news_list: List[Dict[str, Any]]) -> bool:
    """كشف بسيط لو فيه أخبار سلبية (keywords)."""
    if not news_list:
        return False
    negative_keywords = [
        'خسارة', 'خسائر', 'نزول', 'انهيار', 'تحقيق', 'مخالفات', 'توقيف',
        'إيقاف', 'تأجيل', 'تحذير', 'هبوط', 'تراجع', 'بيع', 'تخفيض',
        'loss', 'decline', 'fall', 'investigation', 'fraud', 'delist',
    ]
    for n in news_list:
        text = ((n.get('title') or '') + ' ' + (n.get('summary') or '')).lower()
        for kw in negative_keywords:
            if kw.lower() in text:
                return True
    return False


def stage2_expert_eye(tickers_list: List[Dict[str, Any]], market: str = 'EGX') -> List[Dict[str, Any]]:
    """
    المرحلة التانية: فلترة "عين الخبير".
    لكل سهم:
    - نجيب أداء القطاع (آخر 30 يوم)
    - نكشف حالة السوق (BULL/BEAR/SIDEWAYS)
    - نجيب آخر أخبار (48 ساعة)

    بنمسح السهم لو:
    - السهم أضعف من قطاعه بـ 10%+ (stock_perf_1m < sector_perf - 10)
    - فيه أخبار سلبية في 48 ساعة
    - السوق BEAR والسهم طالع > 15%

    بيرجع أول 20 سهم مع `reason` بالعربي.
    """
    if not tickers_list:
        return []

    market_code = _market_filter(market)
    market_regime = _detect_market_regime(market)

    # cache لأداء القطاعات (تجنب إعادة الحساب)
    sector_cache: Dict[str, Optional[float]] = {}

    survivors: List[Dict[str, Any]] = []
    for stock in tickers_list:
        ticker = stock.get('ticker', '')
        sector = stock.get('sector', '')
        change_1d = stock.get('change_1d', 0.0)

        # أداء القطاع
        if sector not in sector_cache:
            sector_cache[sector] = _get_sector_performance(market, sector)
        sector_perf = sector_cache[sector]

        # نحسب أداء السهم في آخر 30 يوم
        stock_perf_30d = None
        stats = _get_price_stats(ticker, days=30, ref_price=stock.get('price', 0))
        history = stats.get('history', [])
        # بنحسب stock_perf_30d بس لو الأسعار متوافقة (prices_compatible=True)
        if stats.get('prices_compatible', True) and len(history) >= 2:
            # history مرتب DESC (الأحدث أول)
            new_close = history[0].get('close', 0)
            old_close = history[-1].get('close', 0)
            if old_close > 0:
                stock_perf_30d = ((new_close - old_close) / old_close) * 100

        # الأخبار
        news = _get_recent_news(ticker, hours=48)
        has_negative = _is_negative_news(news)

        reasons: List[str] = []
        skip = False

        # 1) فلتر القطاع
        if sector_perf is not None and stock_perf_30d is not None:
            if stock_perf_30d < sector_perf - 10:
                # السهم أضعف من قطاعه بـ 10%+
                skip = True
            elif stock_perf_30d > sector_perf + 5:
                reasons.append(f"أقوى من قطاعه ({sector}) بـ {stock_perf_30d - sector_perf:.1f}%")
            else:
                reasons.append(f"مواكب قطاعه ({sector})")
        elif sector:
            reasons.append(f"القطاع: {sector}")

        # 2) فلتر الأخبار السلبية
        if has_negative:
            skip = True

        # 3) فلتر السوق الهابط
        if market_regime == 'BEAR' and (stock_perf_30d or 0) > 15:
            skip = True
            reasons.append("السوق هابط والسهم طالع كتير — خطر")

        if skip:
            continue

        # 🔧 التحسين 3: بناء reason حقيقي ذكي (مش template)
        # كل سهم لازم يبقى له سبب فريد بناءً على:
        # 1) أداء السهم vs أداء القطاع
        # 2) السيولة (volume_ratio)
        # 3) حالة السوق (regime)
        smart_reason_parts: List[str] = []

        # (1) أداء السهم vs القطاع
        if sector_perf is not None and stock_perf_30d is not None:
            diff = stock_perf_30d - sector_perf
            if diff > 5:
                smart_reason_parts.append(f"أقوى من قطاعه ({sector}) بـ {diff:.1f}% — قائد القطاع")
            elif diff < -10:
                # ده كان هيتعمله skip فوق، بس لو وصل لهنا نذكره
                smart_reason_parts.append(f"أضعف من قطاعه بـ {abs(diff):.1f}%")
            else:
                smart_reason_parts.append(f"أداؤه مواكب لقطاعه ({sector})")
        elif sector:
            smart_reason_parts.append(f"القطاع: {sector}")

        # (2) السيولة
        vol_ratio = stock.get('volume_ratio', 1.0)
        if vol_ratio > 2.0:
            smart_reason_parts.append("السيولة متفجرة (تجميع)")
        elif vol_ratio > 1.5:
            smart_reason_parts.append("السيولة مرتفعة")
        elif vol_ratio > 1.0:
            smart_reason_parts.append(f"السيولة عادية ({vol_ratio:.1f}x)")
        else:
            smart_reason_parts.append("السيولة هادية")

        # (3) حالة السوق
        if market_regime == 'BULL':
            smart_reason_parts.append("السوق طالع (Bull)")
        elif market_regime == 'BEAR':
            smart_reason_parts.append("السوق نازل (Bear)")
        else:
            smart_reason_parts.append("السوق عرضي")

        # (4) التغير اليومي
        if abs(change_1d) > 5:
            if change_1d > 0:
                smart_reason_parts.append(f"طالع {change_1d:.1f}% النهاردة")
            else:
                smart_reason_parts.append(f"نزل {abs(change_1d):.1f}% النهاردة")

        reason_ar = ' — '.join(smart_reason_parts)

        survivors.append({
            **stock,
            'sector_perf': round(sector_perf, 1) if sector_perf is not None else None,
            'stock_perf_30d': round(stock_perf_30d, 1) if stock_perf_30d is not None else None,
            'market_regime': market_regime,
            'news_count': len(news),
            'has_negative_news': has_negative,
            'vol_ratio': round(vol_ratio, 2),
            'reason': reason_ar,
        })

        if len(survivors) >= 20:
            break

    return survivors


# ============================================================
# STAGE 3: Boss Pick — حساب entry/stop/target + personas + narrative
# ============================================================

def _calculate_support_resistance(ticker: str, current_price: float,
                                  stock_support: float = 0, stock_resistance: float = 0,
                                  days: int = 30) -> Tuple[float, float]:
    """
    🔧 تحسين V2.1: حساب الدعم والمقاومة من price_history.db بشكل ذكي.

    الأولوية:
    1) لو موجودين وصحيحين في stocks.db (support_level/resistance_level > 0) → نستخدمهم
    2) من price_history.db: نتجاهل الصفوف اللي أسعارها شاذة (بعد splits)
       بنحسب low = MIN(low_price) و high = MAX(high_price) من الصفوف المتوافقة
       (ضمن ±30% من current_price)
    3) fallback منطقي: -4% / +12% (R/R = 3.0)

    ملحوظة: price_history فيها بيانات مختلطة قبل/بعد splits، فلازم نفلتر الصفوف الشاذة.
    """
    # 1) من stocks.db (لو موجودين وصحيحين)
    if stock_support > 0 and stock_resistance > 0:
        # نتأكد إن support تحت current_price وresistance فوقها
        if stock_support < current_price and stock_resistance > current_price:
            return stock_support, stock_resistance

    # 2) من price_history مع فلترة الصفوف الشاذة (splits)
    # 🔧 V2.1: بنستخدم آخر 10 أيام بس (أقرب للسعر الحالي) بدل 30 يوم
    # عشان نتجنب dips/spikes قديمة. ونجيب support = min(low) و resistance = max(high)
    conn = _connect(PRICE_HISTORY_DB)
    if conn:
        try:
            cur = conn.cursor()
            # ناخد آخر 30 يوم ونفلتر الصفوف الشاذة (splits)
            # الأسعار لازم تكون ضمن 50%-200% من current_price
            cur.execute(
                "SELECT high_price, low_price, close_price FROM price_history "
                "WHERE ticker = ? ORDER BY date DESC LIMIT 30",
                (ticker,)
            )
            rows = cur.fetchall()
            valid_highs = []
            valid_lows = []
            valid_closes = []
            for r in rows:
                h = _safe_float(r[0])
                l = _safe_float(r[1])
                c = _safe_float(r[2])
                if h <= 0 or l <= 0:
                    continue
                # فلتر الصفوف الشاذة
                if current_price > 0:
                    if h / current_price < 0.5 or h / current_price > 2.0:
                        continue
                    if l / current_price < 0.5 or l / current_price > 2.0:
                        continue
                valid_highs.append(h)
                valid_lows.append(l)
                if c > 0:
                    valid_closes.append(c)

            if valid_highs and valid_lows:
                # 🔧 V2.1: support = متوسط أقل 3 lows (مش min — عشان نتجنب dip شاذ)
                # resistance = متوسط أعلى 3 highs (مش max — عشان نتجنب spike شاذ)
                sorted_lows = sorted(valid_lows)
                sorted_highs = sorted(valid_highs, reverse=True)
                # نأخذ أقل 3 lows ونعملهم avg
                support = sum(sorted_lows[:3]) / min(3, len(sorted_lows))
                # نأخذ أعلى 3 highs ونعملهم avg
                resistance = sum(sorted_highs[:3]) / min(3, len(sorted_highs))

                # نتأكد إن support تحت current_price وresistance فوقها
                if support < current_price and resistance > current_price:
                    return support, resistance
        except Exception:
            pass
        finally:
            conn.close()

    # 3) fallback منطقي: -4% / +12% = R/R 3.0
    return current_price * 0.96, current_price * 1.12


def _get_30d_max_high(ticker: str, current_price: float) -> float:
    """
    🔧 V2.2: يجيب أعلى سعر (high) في آخر 30 يوم من price_history.db
    مع فلترة الصفوف الشاذة (splits) — نفس منطق _calculate_support_resistance.
    بيرجع 0 لو مفيش بيانات (عشان الـ caller يستخدم fallback).
    """
    if current_price <= 0:
        return 0.0
    conn = _connect(PRICE_HISTORY_DB)
    if not conn:
        return 0.0
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT high_price FROM price_history "
            "WHERE ticker = ? ORDER BY date DESC LIMIT 30",
            (ticker,)
        )
        rows = cur.fetchall()
        valid_highs = []
        for r in rows:
            h = _safe_float(r[0])
            if h <= 0:
                continue
            # فلتر الصفوف الشاذة (splits): ضمن 50%-200% من current_price
            ratio = h / current_price
            if ratio < 0.5 or ratio > 2.0:
                continue
            valid_highs.append(h)
        return max(valid_highs) if valid_highs else 0.0
    except Exception:
        return 0.0
    finally:
        conn.close()


def stage3_boss_pick(tickers_list: List[Dict[str, Any]], market: str = 'EGX') -> List[Dict[str, Any]]:
    """
    المرحلة التالتة: اختيار الـ Boss (أحسن 5).
    🔧 V2.2:
    - target = أعلى سعر في آخر 30 يوم + 5% (واقعي، مش 52-week high)
    - fallback target = current_price + 15% (لو مفيش بيانات 30 يوم)
    - فلتر R/R >= 3.0 ثابت دائماً (مش متكيف مع regime)
    - reward <= 20% (هدف واقعي)
    - مسح أي pick ناقص (entry/stop/target/R/R)

    لكل سهم:
    - entry = current_price
    - stop = support × 0.98 (fallback -4%)
    - target = max(high_30d, current_price) × 1.05  (fallback +15%)
    - risk_reward = reward / risk

    بنمسح لو:
    - risk_reward < 3.0
    - risk < 4% أو risk > 30%
    - reward > 20%
    - أي بيانات ناقصة (entry/stop/target/R/R = 0 أو غير منطقي)

    بيرجع أحسن 5 مرتبين حسب risk_reward DESC.
    كل سهم فيه entry_trigger, stop_loss, target, timeframe, reason, narrative, personas.
    """
    if not tickers_list:
        return []

    market_code = _market_filter(market)
    picks: List[Dict[str, Any]] = []

    for stock in tickers_list:
        ticker = stock.get('ticker', '')
        name_ar = stock.get('name_ar') or stock.get('name') or ticker
        current_price = _safe_float(stock.get('price'))
        change_1d = _safe_float(stock.get('change_1d'))

        if current_price <= 0:
            continue

        stock_support = _safe_float(stock.get('support_level') or stock.get('support'))
        stock_resistance = _safe_float(stock.get('resistance_level') or stock.get('resistance'))

        support, resistance = _calculate_support_resistance(
            ticker, current_price, stock_support, stock_resistance, days=30
        )

        # 🔧 التحسين 1: stop و target بناءً على الدعم/المقاومة الحقيقيين
        # stop = support × 0.98 (تحت الدعم بـ 2% — لو الدعم منطقي)
        # target = resistance × 1.02 (فوق المقاومة بـ 2% — لو المقاومة منطقي)
        # fallback لو support/resistance غير منطقيين

        # Stop loss
        if 0 < support < current_price:
            # الدعم تحت السعر → وقف تحت الدعم بـ 2%
            stop = support * 0.98
        else:
            # الدعم مش منطقي → fallback -4% (R/R 3.0 مع +12%)
            stop = current_price * 0.96

        # 🔧 V2.2 Fix 1: الهدف الواقعي = أعلى سعر في آخر 30 يوم + 5%
        # لو مفيش بيانات 30 يوم → fallback السعر الحالي + 15% (مش 50%)
        # النتيجة: R/N يبقى 2-4 (واقعي) مش 8 (حلم)
        # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
        # Previously fabricated target as ref_high * 1.05 / current * 1.15
        # when no real resistance ceiling was available. Now: target = None
        # → downstream `continue`s this stock (cannot compute a real R:R).
        max_high_30d = _get_30d_max_high(ticker, current_price)
        if max_high_30d > 0:
            # max() عشان لو السهم كسر القمة النهاردة (current > max_high_30d)
            # Rule 27: the 30-day high is REAL data, but using it as a target
            # via * 1.05 is a fabrication. Use the 30-day high as the target
            # itself (a real resistance ceiling), or NULL if no high.
            ref_high = max(max_high_30d, current_price)
            target = ref_high  # real 30-day high as the resistance ceiling
        else:
            # Rule 27: no 30-day high → NULL target (was current * 1.15).
            target = None

        # entry = current_price
        entry = current_price

        # Rule 27: if target is None, cannot compute a real R:R → skip this stock.
        if target is None:
            continue

        risk = entry - stop
        reward = target - entry
        if risk <= 0:
            continue
        risk_reward = reward / risk
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry, target, stop, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above

        risk_pct = (risk / entry) * 100
        reward_pct = (reward / entry) * 100

        # فلاتر المرحلة 3
        # 🔧 V2.3 (طلب الخبير محسن): فلتر R/R >= 2.5 ثابت (مش 3.0)
        # عتبة 2.5 أقل صرامة عشان يدخل 5-7 picks بدل 2 فقط.
        if risk_reward < 2.5:
            continue
        if risk_pct < 4.0:
            continue  # وقف قريب جداً
        if risk_pct > 30.0:
            continue  # 🔧 V2.1: وقف بعيد جداً (بيانات شاذة أو سهم شديد التذبذب)
        # 🔧 V2.3 (طلب الخبير محسن): هدف واقعي (max 25% — مش 20%) عشان يدخل أسهم عندها مجال
        if reward_pct > 25.0:
            continue

        # 🔧 التحسين 2: entry_trigger يكون "شرط" مش "أمر"
        # 3 حالات حسب موقع السعر الحالي relative للدعم/المقاومة:
        #   1) عند الدعم (price <= support * 1.05) → "ادخل من X (عند الدعم)"
        #   2) قرب المقاومة (price >= resistance * 0.95) → "ادخل لو كسر R بسيولة"
        #   3) في الهوا (بينهم) → "استنى لحد ما يوصل S أو يكسر R"
        if support > 0 and current_price <= support * 1.05:
            entry_trigger = f"ادخل من {current_price:.2f} (عند الدعم)"
        elif resistance > 0 and current_price >= resistance * 0.95:
            entry_trigger = f"ادخل لو كسر {resistance:.2f} بسيولة"
        elif support > 0 and resistance > 0:
            entry_trigger = f"استنى لحد ما يوصل {support:.2f} أو يكسر {resistance:.2f}"
        else:
            entry_trigger = f"ادخل من {current_price:.2f}"

        # بناء الـ narrative + personas
        # ملاحظة: gather_context من maestro بيقرأ من price_history.db (القديمة)
        # فلو الأسعار مش متوافقة، نبني context يدوي ونمرره لـ calculate_personas/generate_narrative
        narrative_lines: List[str] = []
        personas_summary: Dict[str, Any] = {'hunter': 0, 'momentum': 0, 'value': 0}

        # نبني context يدوي من البيانات الصحيحة (stocks.db + price_history المتوافقة)
        stock_stats = _get_price_stats(ticker, days=30, ref_price=current_price)
        prices_ok = stock_stats.get('prices_compatible', True)

        # time_context
        time_context: Dict[str, Any] = {
            'current_price': current_price,
            'change_1d': change_1d,
        }
        if prices_ok and stock_stats.get('last_close', 0) > 0:
            time_context['high_52w'] = stock_stats.get('high', 0)
            time_context['low_52w'] = stock_stats.get('low', 0)
            # نحسب change_1m من history لو متاح
            history = stock_stats.get('history', [])
            if len(history) >= 22:  # ~22 يوم تداول = شهر
                new_c = history[0].get('close', 0)
                old_c = history[21].get('close', 0) if len(history) > 21 else history[-1].get('close', 0)
                if old_c > 0:
                    time_context['change_1m'] = ((new_c - old_c) / old_c) * 100
                if len(history) >= 65:  # ~65 يوم تداول = 3 شهور
                    old_3m = history[64].get('close', 0)
                    if old_3m > 0:
                        time_context['change_3m'] = ((new_c - old_3m) / old_3m) * 100
        else:
            # fallback: نستخدم high_52w/low_52w من stocks.db (V2.2.1: أسماء جديدة)
            time_context['high_52w'] = _safe_float(stock.get('high_52w') or stock.get('ath')) if (stock.get('high_52w') or stock.get('ath')) else 0
            time_context['low_52w'] = _safe_float(stock.get('low_52w') or stock.get('atl')) if (stock.get('low_52w') or stock.get('atl')) else 0

        # distance_from_high/low
        high_52w = time_context.get('high_52w', 0)
        low_52w = time_context.get('low_52w', 0)
        if high_52w > 0 and current_price > 0:
            time_context['distance_from_high_pct'] = ((high_52w - current_price) / high_52w) * 100
        if low_52w > 0 and current_price > 0:
            time_context['distance_from_low_pct'] = ((current_price - low_52w) / low_52w) * 100

        # behavioral_context
        behavioral_context = {
            'volume_ratio': stock.get('volume_ratio', 1.0),
            'volume_today': stock.get('volume', 0),
        }

        # sector_context
        sector_context = {
            'sector_name': stock.get('sector', ''),
            'stock_perf_1w': None,
            'stock_perf_1m': time_context.get('change_1m'),
        }
        if stock.get('sector_perf') is not None:
            sector_context['stock_perf_1w'] = stock.get('sector_perf')

        # market_context
        market_context = {
            'regime': stock.get('market_regime', 'SIDEWAYS'),
        }

        # نبني MaestroHumanContext يدوي
        try:
            from analyzers.maestro_orchestrator import MaestroHumanContext
            context = MaestroHumanContext(
                time_context=time_context,
                sector_context=sector_context,
                market_context=market_context,
                behavioral_context=behavioral_context,
            )
        except Exception:
            context = None

        if MAESTRO_AVAILABLE and context is not None:
            try:
                # 🔧 التحسين 5: تنظيف الـ ticker من الحروف العربية قبل calculate_personas
                # لأن stocks.db بيستخدم ticker نظيف (AALR) بينما data_engine.db
                # ممكن يكون فيها "AALRالعامة" → calculate_personas بترجع 0
                clean_ticker = _clean_ticker(ticker)
                personas = calculate_personas(clean_ticker, context, stock)
                narrative = generate_narrative(clean_ticker, context, personas, name_ar)

                if narrative.line1:
                    narrative_lines.append(narrative.line1)
                if narrative.line2:
                    narrative_lines.append(narrative.line2)
                if narrative.line3:
                    narrative_lines.append(narrative.line3)

                # نلخص الـ personas في scores
                if personas.hunter:
                    personas_summary['hunter'] = personas.hunter.get('score', 0)
                    personas_summary['hunter_verdict'] = personas.hunter.get('verdict', '')
                if personas.momentum:
                    personas_summary['momentum'] = personas.momentum.get('score', 0)
                    personas_summary['momentum_verdict'] = personas.momentum.get('verdict', '')
                if personas.value:
                    personas_summary['value'] = personas.value.get('score', 0)
                    personas_summary['value_verdict'] = personas.value.get('verdict', '')
            except Exception as _e:
                pass

        # لو maestro فشل أو مفيش narrative، نبني واحد بسيط
        if not narrative_lines:
            line_parts = [f"السهم بسعر {current_price:.2f}"]
            chg = change_1d
            if chg > 5:
                line_parts.append(f"طالع {chg:.1f}% — حركة قوية")
            elif chg < -5:
                line_parts.append(f"نزل {abs(chg):.1f}% — مرتبك حالياً")
            elif chg != 0:
                line_parts.append(f"تغير {chg:.1f}%")
            if time_context.get('distance_from_high_pct') is not None:
                dh = time_context['distance_from_high_pct']
                if dh > 30:
                    line_parts.append(f"بعيد {dh:.0f}% عن قمة السنة")
                elif dh < 10:
                    line_parts.append(f"قرب القمة ({dh:.0f}%)")
            narrative_lines.append(' — '.join(line_parts))

            line2 = []
            if stock.get('sector'):
                line2.append(f"القطاع: {stock.get('sector')}")
            regime = stock.get('market_regime', 'SIDEWAYS')
            if regime == 'BULL':
                line2.append("السوق صاعد")
            elif regime == 'BEAR':
                line2.append("السوق هابط")
            else:
                line2.append("السوق عرضي")
            vol_r = stock.get('volume_ratio', 1.0)
            if vol_r > 1.5:
                line2.append(f"سيولة {vol_r:.1f}x")
            narrative_lines.append(' — '.join(line2) if line2 else '')

        # نحدد الـ timeframe
        if reward_pct >= 15:
            timeframe = "3-6 أسابيع"
        elif reward_pct >= 8:
            timeframe = "2-4 أسابيع"
        else:
            timeframe = "1-2 أسبوع"

        # reason نهائي
        reason_parts = [stock.get('reason', '')]
        if personas_summary.get('hunter', 0) >= 70:
            reason_parts.append("فرصة صياد قوية")
        if personas_summary.get('momentum', 0) >= 70:
            reason_parts.append("زخم حقيقي")
        if personas_summary.get('value', 0) >= 70:
            reason_parts.append("قيمة عادلة")
        reason = ' — '.join([p for p in reason_parts if p])

        # 🔧 V2.2 Fix 3: مسح الـ picks الناقصة (مش زي ECAP اللي طلع فاضي)
        # أي بيانات ناقصة أو غير منطقية → skip تماماً
        if not (entry > 0 and stop > 0 and target > 0 and risk_reward > 0):
            continue
        if stop >= entry or target <= entry:
            continue  # stop لازم تحت entry، target لازم فوق entry
        if not (0 < risk_pct <= 30 and 0 < reward_pct <= 25):
            continue  # تأكيد إضافي على نطاق القيم (V2.3: reward حتى 25%)

        picks.append({
            'ticker': ticker,
            'name': stock.get('name', ticker),
            'name_ar': name_ar,
            'sector': stock.get('sector', ''),
            'market': market_code,
            'price': round(current_price, 2),
            'entry': round(entry, 2),
            'entry_trigger': entry_trigger,
            'stop_loss': round(stop, 2),
            'stop_pct': round(risk_pct, 1),
            'target': round(target, 2),
            'target_pct': round(reward_pct, 1),
            'risk_reward': round(risk_reward, 1),
            'timeframe': timeframe,
            'reason': reason,
            'narrative': narrative_lines,
            'personas': personas_summary,
            'support': round(support, 2),
            'resistance': round(resistance, 2),
            'volume_ratio': stock.get('volume_ratio', 1.0),
            'change_1d': stock.get('change_1d', 0.0),
            'market_regime': stock.get('market_regime', 'SIDEWAYS'),
        })

    # 🔧 V2.3 (طلب الخبير محسن): فلتر Hunter الأدنى 30
    # عشان نرفض الـ picks الضعيفة (Hunter < 30 = النظام مش واثق فيها)
    picks = [p for p in picks if p.get('personas', {}).get('hunter', 0) >= 30]

    # ترتيب حسب risk_reward DESC
    # 🔧 V2.3: أحسن 7 (مش 5) — عتبة R/R 2.5 الأقل صرامة هتدخل picks أكتر
    picks.sort(key=lambda x: x.get('risk_reward', 0), reverse=True)
    return picks[:7]


# ============================================================
# PIPELINE: run_hunting_pipeline
# ============================================================

def run_hunting_pipeline(market: str = 'EGX') -> Dict[str, Any]:
    """
    تشغيل الـ pipeline الكامل: 3 مراحل.
    بيرجع dict فيه:
    - stage1_count: عدد اللي عدّوا المرحلة 1
    - stage2_count: عدد اللي عدّوا المرحلة 2
    - stage3_count: عدد اللي عدّوا المرحلة 3 (max 7)
    - picks: قائمة الـ 7 أسهم بالتفصيل
    - meta: معلومات إضافية (market, timestamp, maestro_available)
    """
    start_time = datetime.now()

    market_code = _market_filter(market)

    # المرحلة 1
    stage1_results = stage1_screener(market=market_code, limit=100)
    stage1_count = len(stage1_results)

    # المرحلة 2
    stage2_results = stage2_expert_eye(stage1_results, market=market_code)
    stage2_count = len(stage2_results)

    # المرحلة 3
    picks = stage3_boss_pick(stage2_results, market=market_code)
    stage3_count = len(picks)

    elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)

    return {
        'success': True,
        'date': datetime.now().strftime('%Y-%m-%d'),
        'timestamp': datetime.now().isoformat(),
        'market': market_code,
        'elapsed_ms': elapsed_ms,
        'stage1_count': stage1_count,
        'stage2_count': stage2_count,
        'stage3_count': stage3_count,
        'picks': picks,
        'meta': {
            'maestro_available': MAESTRO_AVAILABLE,
            'maestro_error': None if MAESTRO_AVAILABLE else _MAESTRO_IMPORT_ERROR,
            'engine_version': '2.0.0',
        },
    }
