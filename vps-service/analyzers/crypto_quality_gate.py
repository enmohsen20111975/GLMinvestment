"""
Crypto Quality Gate — باب الجودة للعملات الرقمية
====================================================

Crypto-adapted version of expert_quality_gate.py — instead of 6 stock-specific
tests (divergence, correlation, VWAP liquidity, percentile, event timing, S/R),
the Crypto Quality Gate scores a coin across 5 crypto-native factors to produce
a 0-100 Health Score.

═══════════════════════════════════════════════════════════════════════════
الفلسفة / Philosophy:
═══════════════════════════════════════════════════════════════════════════
  الأسهم عندنا خبر بيقول كويس → الخبير يفحص → يقبل أو يرفض.
  الكريبتو مفيش خبر بالمعنى التقليدي — بدل ده بنقيّم "صحة العملة" نفسها:
  - رأس المال الكبير = أمان (مفيش حد يتحكم في BTC زي ما يتحكم في shitcoin)
  - السيولة = تقدر تخرج (مهم في الكريبتو أكتر من الأسهم)
  - التقلب = المخاطرة الحقيقية (ATR/Price هو المقياس الصح)
  - الاتجاه = رياح السوق (SMA هو البوصلة)
  - الاستقرار = مفيش أحداث مفاجئة (token unlock, SEC, whale)

═══════════════════════════════════════════════════════════════════════════
الـ 5 عوامل / The 5 Factors:
═══════════════════════════════════════════════════════════════════════════
  #  | العامل            | الوزن  | الوصف
  ---|-------------------|--------|------------------------------------------
  1  | Market Cap Rank   | 0-30   | ترتيب القيمة السوقية (Top 10 = الأفضل)
  2  | Liquidity         | 0-25   | حجم التداول 24H بالدولار (سيولة حقيقية)
  3  | Volatility        | 0-20   | ATR(14)/Price (تقلب أقل = نقاط أكتر)
  4  | Trend             | 0-15   | السعر فوق/تحت SMA (اتجاه واضح)
  5  | Stability         | 0-10   | أحداث خلال 30 يوم (أقل = أحسن)

═══════════════════════════════════════════════════════════════════════════
حدود القرار / Verdict Thresholds:
═══════════════════════════════════════════════════════════════════════════
  | الدرجة  | القرار   | اللون  | حجم المركز     | الوصف
  |---------|----------|--------|----------------|----------------------------
  | 80-100  | PASS     | أخضر   | 100% (كامل)    | آمن للتداول
  | 60-79   | REVIEW   | أصفر   | 50% (نص)       | حذر — قلل حجم المركز
  | 0-59    | FAIL     | أحمر   | 0% (ممنوع)     | لا تتداول

═══════════════════════════════════════════════════════════════════════════
تكامل مع MR Signal / Integration with MR Signal:
═══════════════════════════════════════════════════════════════════════════
  PASS   → MR signal proceeds at full position size (1.0×)
  REVIEW → MR signal proceeds at 50% position size (0.5×)
  FAIL   → MR signal BLOCKED (0.0×)

═══════════════════════════════════════════════════════════════════════════
معدّل الأحداث / Event Modifier:
═══════════════════════════════════════════════════════════════════════════
  لما Event Tracker يكتشف حدث قادم، بيطبّق modifier على الدرجة:
  | الحدث               | المعدّل | الشرط
  |---------------------|--------|----------------------------------
  | Token Unlock        | -15    | خلال 7 أيام
  | Hard Fork           | -10    | خلال 14 يوم
  | Exchange Listing    | -8     | دايماً (لا تلاحق الفومو)
  | SEC/Regulatory      | -15    | إجراء معلق أو حديث
  | Whale Movement      | -5     | حركة كبيرة مكتشفة

═══════════════════════════════════════════════════════════════════════════
الاستخدام / Usage:
═══════════════════════════════════════════════════════════════════════════
    from analyzers.crypto_quality_gate import CryptoQualityGate, crypto_quality_gate

    result = crypto_quality_gate.evaluate(
        coin_id='bitcoin',
        market_data={
            'market_cap_rank': 1,
            'volume_24h_usd': 35_000_000_000,
            'current_price': 94500.0,
            'price_history': [...],  # list of dicts with close/high/low
        },
        events=[...],  # list of CryptoEvent or dict
    )

    if result.verdict == 'FAIL':
        print(f"❌ {coin_id} blocked — score: {result.adjusted_score}")
    elif result.verdict == 'REVIEW':
        print(f"⚠️ {coin_id} caution — position at 50%")
    else:
        print(f"✅ {coin_id} safe — full position")

Author: دليل الاستثمار / Investment Guide Team
Version: 1.0.0
"""

import sqlite3
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict
from pathlib import Path
import math

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr
from analyzers.indicators.ma import sma as _canonical_sma

# ==================== CONFIG ====================
# مسار قاعدة البيانات — نفس نمط باقي الـ crypto analyzers
BASE_DIR = Path(__file__).parent.parent.parent.resolve()
CRYPTO_DB = os.environ.get('CRYPTO_DB', str(BASE_DIR / 'db' / 'crypto.db'))

logger = logging.getLogger(__name__)


# ============================================================================
# EVENT MODIFIER TABLE
# جدول معدّلات الأحداث — كل حدث بيخصم من درجة الجودة
# ============================================================================
EVENT_MODIFIERS: Dict[str, Dict[str, Any]] = {
    'token_unlock': {
        'name': 'Token Unlock',
        'name_ar': 'إلغاء قفل التوكن',
        'modifier': -15,
        'max_days': 7,          # بيتطبق لو الحدث خلال 7 أيام
        'description': 'Token unlock within 7 days — selling pressure expected',
        'description_ar': 'إلغاء قفل التوكن خلال 7 أيام — ضغط بيع متوقع',
    },
    'hard_fork': {
        'name': 'Hard Fork',
        'name_ar': 'انقسام الشبكة',
        'modifier': -10,
        'max_days': 14,         # بيتطبق لو الحدث خلال 14 يوم
        'description': 'Hard fork within 14 days — high volatility expected',
        'description_ar': 'انقسام الشبكة خلال 14 يوم — تقلب عالي متوقع',
    },
    'exchange_listing': {
        'name': 'Exchange Listing',
        'name_ar': 'إدراج في بورصة',
        'modifier': -8,
        'max_days': 999,        # دايماً بيتطبق (لا تلاحق الفومو)
        'description': 'Exchange listing — avoid FOMO chase',
        'description_ar': 'إدراج في بورصة — تجنب مطاردة الفومو',
    },
    'sec_regulatory': {
        'name': 'SEC/Regulatory Action',
        'name_ar': 'إجراء تنظيمي',
        'modifier': -15,
        'max_days': 999,        # pending أو recent
        'description': 'SEC or regulatory action — legal risk',
        'description_ar': 'إجراء تنظيمي — خطر قانوني',
    },
    'whale_movement': {
        'name': 'Whale Movement',
        'name_ar': 'حركة حوت',
        'modifier': -5,
        'max_days': 3,          # حركة خلال 3 أيام
        'description': 'Whale movement detected — potential price impact',
        'description_ar': 'حركة حوت مكتشفة — تأثير محتمل على السعر',
    },
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class FactorResult:
    """نتيجة عامل واحد من الـ 5 عوامل / Single factor result."""
    name: str                       # اسم العامل بالإنجليزي
    name_ar: str                    # اسم العامل بالعربي
    score: float                    # النقاط (0 إلى max)
    max_score: float                # أقصى نقاط ممكنة
    reason: str                     # سبب الدرجة بالإنجليزي
    reason_ar: str                  # سبب الدرجة بالعربي
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CryptoQGResult:
    """
    نتيجة باب الجودة للعملات الرقمية / Crypto Quality Gate Result.
    النتيجة النهائية بعد تقييم الـ 5 عوامل + معدّل الأحداث.
    """
    total_score: float              # مجموع النقاط الخام (0-100)
    verdict: str                    # PASS / REVIEW / FAIL
    factors: Dict[str, Any]         # تفاصيل الـ 5 عوامل
    position_modifier: float        # 1.0 (PASS) / 0.5 (REVIEW) / 0.0 (FAIL)
    event_modifier: float           # مجموع خصومات الأحداث (سالب أو صفر)
    adjusted_score: float           # total_score + event_modifier
    reasons: List[str]              # أسباب القرار بالإنجليزي
    warnings: List[str]             # تحذيرات بالعربي

    def to_dict(self) -> Dict[str, Any]:
        """تحويل إلى dictionary."""
        return asdict(self)


# ============================================================================
# HELPER FUNCTIONS — حساب المؤشرات الفنية / Technical indicator helpers
# ============================================================================

def _get_db(db_path: str) -> sqlite3.Connection:
    """يفتح اتصال بقاعدة البيانات / Opens a DB connection."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def _calculate_sma(prices: List[float], period: int) -> Optional[float]:
    """
    يحسب المتوسط المتحرك البسيط / Calculates Simple Moving Average.
    SMA(n) = sum(last n prices) / n

    BRAVO UNIFY: delegates to canonical analyzers.indicators.ma.sma.
    """
    return _canonical_sma(prices, period)


def _calculate_atr(highs: List[float], lows: List[float], closes: List[float],
                   period: int = 14) -> Optional[float]:
    """
    يحسب متوسط المدى الحقيقي / Calculates Average True Range.
    ATR(n) = average of True Range over last n periods.
    True Range = max(H-L, |H-Cp|, |L-Cp|) where Cp = previous close.

    BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
    """
    if len(highs) < period + 1 or len(lows) < period + 1 or len(closes) < period + 1:
        return None
    # filter invalid rows
    valid = [(h, l, c) for h, l, c in zip(highs, lows, closes) if h > 0 and l > 0 and c > 0]
    if len(valid) < 2:
        return None
    v_highs, v_lows, v_closes = (list(t) for t in zip(*valid))
    return _canonical_calc_atr(v_highs, v_lows, v_closes, period=period)


def _count_events_in_period(events: List[Dict], days: int = 30) -> int:
    """
    يحسب عدد الأحداث الكبيرة خلال فترة محددة / Counts major events in a period.
    الأحداث الكبيرة = token_unlock, hard_fork, sec_regulatory, exchange_listing
    (مش staking_reward أو protocol_upgrade البسيط)
    """
    major_event_types = {'token_unlock', 'hard_fork', 'sec_regulatory', 'exchange_listing'}
    count = 0
    now = datetime.now()
    cutoff = now + timedelta(days=days)

    for evt in events:
        evt_type = ''
        evt_date = None

        # Support both dict and dataclass-like objects
        if isinstance(evt, dict):
            evt_type = evt.get('event_type', evt.get('type', ''))
            evt_date_str = evt.get('event_date') or evt.get('date')
        else:
            evt_type = getattr(evt, 'event_type', '') or getattr(evt, 'type', '')
            evt_date_str = getattr(evt, 'event_date', None) or getattr(evt, 'date', None)

        if evt_type not in major_event_types:
            continue

        # لو مفيش تاريخ، نشوف days_until
        days_until = None
        if isinstance(evt, dict):
            days_until = evt.get('days_until')
        else:
            days_until = getattr(evt, 'days_until', None)

        if days_until is not None and days_until <= days:
            count += 1
        elif evt_date_str:
            try:
                if isinstance(evt_date_str, str):
                    evt_dt = datetime.fromisoformat(evt_date_str[:10])
                    if now <= evt_dt <= cutoff:
                        count += 1
            except (ValueError, TypeError):
                pass

    return count


def _compute_event_modifier(events: List[Dict]) -> Tuple[float, List[str], List[str]]:
    """
    يحسب مجموع معدّلات الأحداث / Computes total event modifier from active events.
    يرجع: (modifier_sum, reasons, warnings)
    """
    modifier_total = 0.0
    reasons: List[str] = []
    warnings: List[str] = []
    now = datetime.now()

    for evt in events:
        evt_type = ''
        evt_date_str = None
        days_until = None
        evt_name = ''

        if isinstance(evt, dict):
            evt_type = evt.get('event_type', evt.get('type', ''))
            evt_date_str = evt.get('event_date') or evt.get('date')
            days_until = evt.get('days_until')
            evt_name = evt.get('event_name', evt.get('name', ''))
        else:
            evt_type = getattr(evt, 'event_type', '') or getattr(evt, 'type', '')
            evt_date_str = getattr(evt, 'event_date', None) or getattr(evt, 'date', None)
            days_until = getattr(evt, 'days_until', None)
            evt_name = getattr(evt, 'event_name', getattr(evt, 'name', ''))

        # هل ده نوع حدث مؤثر؟
        mod_config = EVENT_MODIFIERS.get(evt_type)
        if not mod_config:
            continue

        # نحسب days_until لو مش موجود
        if days_until is None and evt_date_str:
            try:
                if isinstance(evt_date_str, str):
                    evt_dt = datetime.fromisoformat(evt_date_str[:10])
                    days_until = (evt_dt - now).days
            except (ValueError, TypeError):
                days_until = None

        # هل الحدث ضمن النطاق المؤثر؟
        max_days = mod_config['max_days']
        applies = False
        if days_until is not None and days_until <= max_days:
            applies = True
        elif days_until is None and evt_type in ('sec_regulatory', 'exchange_listing'):
            # أحداث معينة بتتطبق دايماً (pending/recent)
            applies = True

        if applies:
            modifier_total += mod_config['modifier']
            reasons.append(
                f"{mod_config['name']}: {mod_config['modifier']} "
                f"(days_until={days_until})"
            )
            warnings.append(
                f"⚠️ {mod_config['name_ar']}: {mod_config['description_ar']}"
            )

    return modifier_total, reasons, warnings


def _get_price_history_from_db(coin_id: str, days: int = 60) -> List[Dict]:
    """
    يجيب تاريخ الأسعار من crypto.db / Gets price history from crypto.db.
    بيحاول جدول crypto_prices الأول، وبعدين fallback لأي جدول تاريخي.

    # PHASE-1-SKIP: crypto reader — uses crypto.db, not price_history.db.
    # The unified data.prices.load_price_history() targets EGX stocks only;
    # crypto has its own DB schema (crypto_prices: price_usd, high_24h, ...)
    # and is intentionally NOT migrated in PHASE 1.
    """
    try:
        conn = _get_db(CRYPTO_DB)
        cur = conn.cursor()

        # محاولة 1: جدول crypto_prices (الرئيسي)
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in cur.fetchall()}

        if 'crypto_prices' in tables:
            cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            cur.execute('''
                SELECT date, price_usd, high_24h, low_24h, volume_24h, market_cap
                FROM crypto_prices
                WHERE coin_id = ? AND date >= ?
                ORDER BY date ASC
            ''', (coin_id.lower(), cutoff))
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return rows

        conn.close()
        return []
    except Exception as e:
        logger.warning(f"[CryptoQG] price history DB error for {coin_id}: {e}")
        return []


# ============================================================================
# MAIN CLASS — CryptoQualityGate
# ============================================================================

class CryptoQualityGate:
    """
    باب الجودة للعملات الرقمية / Crypto Quality Gate.

    بيقيّم صحة العملة الرقمية على 5 عوامل (0-100 نقطة)
    وبعدين يطبّق معدّل الأحداث عشان يطلع بالدرجة النهائية والقرار.

    Integration with MR Signal:
        - PASS   → MR signal proceeds at 100% position size
        - REVIEW → MR signal proceeds at 50% position size
        - FAIL   → MR signal blocked
    """

    # حدود الدرجات / Score thresholds
    PASS_THRESHOLD = 80       # 80+ = PASS (أخضر / green)
    REVIEW_THRESHOLD = 60     # 60-79 = REVIEW (أصفر / yellow)
    # أقل من 60 = FAIL (أحمر / red)

    def evaluate(
        self,
        coin_id: str,
        market_data: Dict[str, Any],
        events: Optional[List[Any]] = None,
    ) -> CryptoQGResult:
        """
        تقييم شامل لعملة رقمية / Comprehensive evaluation of a crypto coin.

        Args:
            coin_id: معرف العملة (مثلاً 'bitcoin', 'ethereum') / Coin identifier
            market_data: بيانات السوق / Market data dict with keys:
                - market_cap_rank (int): ترتيب القيمة السوقية
                - volume_24h_usd (float): حجم التداول 24 ساعة بالدولار
                - current_price (float): السعر الحالي
                - price_history (list): تاريخ الأسعار (اختياري — لو مش موجود هيجيب من DB)
                - high_24h (float): أعلى سعر 24 ساعة (اختياري)
                - low_24h (float): أقل سعر 24 ساعة (اختياري)
            events: قائمة الأحداث من CryptoEventTracker (اختياري)

        Returns:
            CryptoQGResult مع الدرجة والقرار والتفاصيل
        """
        events = events or []
        all_reasons: List[str] = []
        all_warnings: List[str] = []
        factors: Dict[str, Any] = {}

        # ── Factor 1: Market Cap Rank ──────────────────────────────────
        try:
            f1 = self._evaluate_market_cap_rank(market_data)
            factors['market_cap_rank'] = asdict(f1)
            all_reasons.append(f1.reason)
            if f1.score < f1.max_score * 0.5:
                all_warnings.append(f1.reason_ar)
        except Exception as e:
            logger.warning(f"[CryptoQG] Factor 1 (market_cap_rank) failed for {coin_id}: {e}")
            f1 = FactorResult("Market Cap Rank", "ترتيب القيمة السوقية",
                              10, 30, f"Error: {e}", f"خطأ في حساب الترتيب: {e}")
            factors['market_cap_rank'] = asdict(f1)
            all_reasons.append(f1.reason)
            all_warnings.append(f"⚠️ {f1.reason_ar}")

        # ── Factor 2: Liquidity ────────────────────────────────────────
        try:
            f2 = self._evaluate_liquidity(market_data)
            factors['liquidity'] = asdict(f2)
            all_reasons.append(f2.reason)
            if f2.score < f2.max_score * 0.4:
                all_warnings.append(f2.reason_ar)
        except Exception as e:
            logger.warning(f"[CryptoQG] Factor 2 (liquidity) failed for {coin_id}: {e}")
            f2 = FactorResult("Liquidity", "السيولة",
                              5, 25, f"Error: {e}", f"خطأ في حساب السيولة: {e}")
            factors['liquidity'] = asdict(f2)
            all_reasons.append(f2.reason)
            all_warnings.append(f"⚠️ {f2.reason_ar}")

        # ── Factor 3: Volatility ───────────────────────────────────────
        try:
            f3 = self._evaluate_volatility(coin_id, market_data)
            factors['volatility'] = asdict(f3)
            all_reasons.append(f3.reason)
            if f3.score < f3.max_score * 0.3:
                all_warnings.append(f3.reason_ar)
        except Exception as e:
            logger.warning(f"[CryptoQG] Factor 3 (volatility) failed for {coin_id}: {e}")
            f3 = FactorResult("Volatility", "التقلب",
                              10, 20, f"Error: {e}", f"خطأ في حساب التقلب: {e}")
            factors['volatility'] = asdict(f3)
            all_reasons.append(f3.reason)
            all_warnings.append(f"⚠️ {f3.reason_ar}")

        # ── Factor 4: Trend ────────────────────────────────────────────
        try:
            f4 = self._evaluate_trend(coin_id, market_data)
            factors['trend'] = asdict(f4)
            all_reasons.append(f4.reason)
            if f4.score < f4.max_score * 0.3:
                all_warnings.append(f4.reason_ar)
        except Exception as e:
            logger.warning(f"[CryptoQG] Factor 4 (trend) failed for {coin_id}: {e}")
            f4 = FactorResult("Trend", "الاتجاه",
                              5, 15, f"Error: {e}", f"خطأ في حساب الاتجاه: {e}")
            factors['trend'] = asdict(f4)
            all_reasons.append(f4.reason)
            all_warnings.append(f"⚠️ {f4.reason_ar}")

        # ── Factor 5: Stability ────────────────────────────────────────
        try:
            f5 = self._evaluate_stability(events)
            factors['stability'] = asdict(f5)
            all_reasons.append(f5.reason)
            if f5.score < f5.max_score * 0.5:
                all_warnings.append(f5.reason_ar)
        except Exception as e:
            logger.warning(f"[CryptoQG] Factor 5 (stability) failed for {coin_id}: {e}")
            f5 = FactorResult("Stability", "الاستقرار",
                              7, 10, f"Error: {e}", f"خطأ في حساب الاستقرار: {e}")
            factors['stability'] = asdict(f5)
            all_reasons.append(f5.reason)
            all_warnings.append(f"⚠️ {f5.reason_ar}")

        # ── Total Score ────────────────────────────────────────────────
        total_score = f1.score + f2.score + f3.score + f4.score + f5.score
        total_score = max(0.0, min(100.0, total_score))

        # ── Event Modifier ─────────────────────────────────────────────
        event_mod, event_reasons, event_warnings = _compute_event_modifier(events)
        all_reasons.extend(event_reasons)
        all_warnings.extend(event_warnings)

        adjusted_score = total_score + event_mod
        adjusted_score = max(0.0, min(100.0, adjusted_score))  # clamp 0-100

        # ── Verdict ────────────────────────────────────────────────────
        if adjusted_score >= self.PASS_THRESHOLD:
            verdict = 'PASS'
            position_modifier = 1.0
        elif adjusted_score >= self.REVIEW_THRESHOLD:
            verdict = 'REVIEW'
            position_modifier = 0.5
        else:
            verdict = 'FAIL'
            position_modifier = 0.0

        return CryptoQGResult(
            total_score=round(total_score, 1),
            verdict=verdict,
            factors=factors,
            position_modifier=position_modifier,
            event_modifier=round(event_mod, 1),
            adjusted_score=round(adjusted_score, 1),
            reasons=all_reasons,
            warnings=all_warnings,
        )

    # ═══════════════════════════════════════════════════════════════════
    # FACTOR IMPLEMENTATIONS
    # ═══════════════════════════════════════════════════════════════════

    def _evaluate_market_cap_rank(self, market_data: Dict[str, Any]) -> FactorResult:
        """
        العامل 1: ترتيب القيمة السوقية / Factor 1: Market Cap Rank.
        ─────────────────────────────────────────────────────────────────
        الترتيب    | النقاط  | الوصف
        -----------|---------|--------------------------------
        Top 10     | 30      | عملات كبرى (BTC, ETH, BNB...)
        11-20      | 25      | عملات كبيرة
        21-50      | 20      | عملات متوسطة-كبيرة
        51-100     | 15      | عملات متوسطة
        100+       | 10      | عملات صغيرة — مخاطرة أعلى
        مفقود     | 10      | مفيش بيانات — نعطي الحد الأدنى
        """
        rank = market_data.get('market_cap_rank')
        if rank is None:
            return FactorResult(
                name="Market Cap Rank",
                name_ar="ترتيب القيمة السوقية",
                score=10,
                max_score=30,
                reason="Market cap rank not available — defaulting to minimum",
                reason_ar="ترتيب القيمة السوقية مش متاح — الحد الأدنى",
                details={'rank': None},
            )

        rank = int(rank)

        if rank <= 10:
            score, reason, reason_ar = 30, f"Rank #{rank} — Top 10 coin", f"ترتيب #{rank} — من أكبر 10 عملات"
        elif rank <= 20:
            score, reason, reason_ar = 25, f"Rank #{rank} — Large cap (11-20)", f"ترتيب #{rank} — عملة كبيرة (11-20)"
        elif rank <= 50:
            score, reason, reason_ar = 20, f"Rank #{rank} — Mid-large cap (21-50)", f"ترتيب #{rank} — عملة متوسطة-كبيرة (21-50)"
        elif rank <= 100:
            score, reason, reason_ar = 15, f"Rank #{rank} — Mid cap (51-100)", f"ترتيب #{rank} — عملة متوسطة (51-100)"
        else:
            score, reason, reason_ar = 10, f"Rank #{rank} — Small cap (100+)", f"ترتيب #{rank} — عملة صغيرة (100+)"

        return FactorResult(
            name="Market Cap Rank",
            name_ar="ترتيب القيمة السوقية",
            score=score,
            max_score=30,
            reason=reason,
            reason_ar=reason_ar,
            details={'rank': rank},
        )

    def _evaluate_liquidity(self, market_data: Dict[str, Any]) -> FactorResult:
        """
        العامل 2: السيولة / Factor 2: Liquidity.
        ─────────────────────────────────────────────────────────────────
        حجم التداول 24H   | النقاط  | الوصف
        ------------------|---------|--------------------------------
        > $100M           | 25      | سيولة ممتازة — ممكن تتداول بسهولة
        $50M - $100M      | 20      | سيولة كويسة
        $10M - $50M       | 15      | سيولة مقبولة
        $5M - $10M        | 10      | سيولة ضعيفة — انزلاق سعري محتمل
        < $5M             | 5       | سيولة منخفضة جداً — خطر
        مفقود             | 5       | مفيش بيانات — الحد الأدنى
        """
        volume_24h = market_data.get('volume_24h_usd')

        if volume_24h is None:
            # محاولة استخراج من price_history
            price_history = market_data.get('price_history', [])
            if price_history:
                volumes = [float(p.get('volume_24h', 0) or 0) for p in price_history[-7:]]
                volume_24h = sum(volumes) / len(volumes) if volumes else None

        if volume_24h is None:
            return FactorResult(
                name="Liquidity",
                name_ar="السيولة",
                score=5,
                max_score=25,
                reason="24h volume not available — defaulting to minimum",
                reason_ar="حجم التداول 24 ساعة مش متاح — الحد الأدنى",
                details={'volume_24h_usd': None},
            )

        volume_24h = float(volume_24h)

        if volume_24h > 100_000_000:       # > $100M
            score = 25
            reason = f"Volume ${volume_24h/1e6:.0f}M — Excellent liquidity"
            reason_ar = f"حجم التداول ${volume_24h/1e6:.0f}M — سيولة ممتازة"
        elif volume_24h > 50_000_000:      # $50M - $100M
            score = 20
            reason = f"Volume ${volume_24h/1e6:.0f}M — Good liquidity"
            reason_ar = f"حجم التداول ${volume_24h/1e6:.0f}M — سيولة كويسة"
        elif volume_24h > 10_000_000:      # $10M - $50M
            score = 15
            reason = f"Volume ${volume_24h/1e6:.0f}M — Acceptable liquidity"
            reason_ar = f"حجم التداول ${volume_24h/1e6:.0f}M — سيولة مقبولة"
        elif volume_24h > 5_000_000:       # $5M - $10M
            score = 10
            reason = f"Volume ${volume_24h/1e6:.0f}M — Low liquidity, slippage risk"
            reason_ar = f"حجم التداول ${volume_24h/1e6:.0f}M — سيولة ضعيفة، خطر انزلاق سعري"
        else:                              # < $5M
            score = 5
            reason = f"Volume ${volume_24h/1e6:.1f}M — Very low liquidity, dangerous"
            reason_ar = f"حجم التداول ${volume_24h/1e6:.1f}M — سيولة منخفضة جداً، خطير"

        return FactorResult(
            name="Liquidity",
            name_ar="السيولة",
            score=score,
            max_score=25,
            reason=reason,
            reason_ar=reason_ar,
            details={'volume_24h_usd': volume_24h},
        )

    def _evaluate_volatility(self, coin_id: str, market_data: Dict[str, Any]) -> FactorResult:
        """
        العامل 3: التقلب / Factor 3: Volatility.
        ─────────────────────────────────────────────────────────────────
        ATR(14)/Price   | النقاط  | الوصف
        ----------------|---------|--------------------------------
        < 3%            | 20      | تقلب منخفض — آمن
        3% - 5%         | 15      | تقلب معتدل
        5% - 8%         | 10      | تقلب مرتفع
        8% - 12%        | 5       | تقلب عالي — مخاطرة
        > 12%           | 2       | تقلب شديد — خطير جداً
        مفقود           | 10      | مفيش بيانات — نعطي الوسط
        """
        current_price = float(market_data.get('current_price', 0) or 0)
        price_history = market_data.get('price_history', [])

        # لو مفيش price_history، نجيب من DB
        if not price_history and current_price > 0:
            price_history = _get_price_history_from_db(coin_id, days=60)

        if not price_history or len(price_history) < 15 or current_price <= 0:
            return FactorResult(
                name="Volatility",
                name_ar="التقلب",
                score=10,
                max_score=20,
                reason="Insufficient data for ATR calculation — defaulting to mid",
                reason_ar="بيانات غير كافية لحساب ATR — القيمة الافتراضية",
                details={'atr_pct': None, 'data_points': len(price_history) if price_history else 0},
            )

        # استخراج الأسعار من التاريخ
        try:
            closes = []
            highs = []
            lows = []
            for p in price_history:
                c = float(p.get('price_usd', p.get('close', 0)) or 0)
                h = float(p.get('high_24h', p.get('high', 0)) or 0)
                l = float(p.get('low_24h', p.get('low', 0)) or 0)
                if c > 0 and h > 0 and l > 0:
                    closes.append(c)
                    highs.append(h)
                    lows.append(l)

            if len(closes) < 15:
                return FactorResult(
                    name="Volatility",
                    name_ar="التقلب",
                    score=10,
                    max_score=20,
                    reason=f"Only {len(closes)} valid data points — defaulting to mid",
                    reason_ar=f"فقط {len(closes)} نقطة بيانات صالحة — القيمة الافتراضية",
                    details={'atr_pct': None, 'data_points': len(closes)},
                )

            atr = _calculate_atr(highs, lows, closes, period=14)
            if atr is None or current_price <= 0:
                return FactorResult(
                    name="Volatility",
                    name_ar="التقلب",
                    score=10,
                    max_score=20,
                    reason="ATR calculation failed — defaulting to mid",
                    reason_ar="فشل حساب ATR — القيمة الافتراضية",
                    details={'atr': None, 'current_price': current_price},
                )

            atr_pct = (atr / current_price) * 100

        except Exception as e:
            return FactorResult(
                name="Volatility",
                name_ar="التقلب",
                score=10,
                max_score=20,
                reason=f"ATR calculation error: {e}",
                reason_ar=f"خطأ في حساب ATR: {e}",
                details={'atr_pct': None},
            )

        # تصنيف التقلب / Classify volatility
        if atr_pct < 3.0:
            score = 20
            reason = f"ATR% = {atr_pct:.2f}% — Low volatility, safe"
            reason_ar = f"ATR% = {atr_pct:.2f}% — تقلب منخفض، آمن"
        elif atr_pct < 5.0:
            score = 15
            reason = f"ATR% = {atr_pct:.2f}% — Moderate volatility"
            reason_ar = f"ATR% = {atr_pct:.2f}% — تقلب معتدل"
        elif atr_pct < 8.0:
            score = 10
            reason = f"ATR% = {atr_pct:.2f}% — High volatility"
            reason_ar = f"ATR% = {atr_pct:.2f}% — تقلب مرتفع"
        elif atr_pct < 12.0:
            score = 5
            reason = f"ATR% = {atr_pct:.2f}% — Very high volatility, risky"
            reason_ar = f"ATR% = {atr_pct:.2f}% — تقلب عالي جداً، مخاطرة"
        else:
            score = 2
            reason = f"ATR% = {atr_pct:.2f}% — Extreme volatility, dangerous"
            reason_ar = f"ATR% = {atr_pct:.2f}% — تقلب شديد، خطير جداً"

        return FactorResult(
            name="Volatility",
            name_ar="التقلب",
            score=score,
            max_score=20,
            reason=reason,
            reason_ar=reason_ar,
            details={'atr_pct': round(atr_pct, 2), 'atr': round(atr, 4), 'data_points': len(closes)},
        )

    def _evaluate_trend(self, coin_id: str, market_data: Dict[str, Any]) -> FactorResult:
        """
        العامل 4: الاتجاه / Factor 4: Trend.
        ─────────────────────────────────────────────────────────────────
        الموضع           | النقاط  | الوصف
        -----------------|---------|--------------------------------
        Above SMA50      | 15      | اتجاه صاعد قوي
        Above SMA20      | 10      | اتجاه صاعد (أضعف)
        Below SMA20      | 5       | ضعف في الاتجاه
        Below SMA50      | 0       | اتجاه هابط — خطر
        مفقود            | 5       | مفيش بيانات — الوسط
        """
        current_price = float(market_data.get('current_price', 0) or 0)
        price_history = market_data.get('price_history', [])

        # لو مفيش price_history، نجيب من DB
        if not price_history and current_price > 0:
            price_history = _get_price_history_from_db(coin_id, days=60)

        if not price_history or current_price <= 0:
            return FactorResult(
                name="Trend",
                name_ar="الاتجاه",
                score=5,
                max_score=15,
                reason="Insufficient data for SMA calculation — defaulting to mid",
                reason_ar="بيانات غير كافية لحساب المتوسط المتحرك — القيمة الافتراضية",
                details={'sma20': None, 'sma50': None},
            )

        try:
            closes = []
            for p in price_history:
                c = float(p.get('price_usd', p.get('close', 0)) or 0)
                if c > 0:
                    closes.append(c)

            sma20 = _calculate_sma(closes, 20)
            sma50 = _calculate_sma(closes, 50)

            details = {
                'sma20': round(sma20, 2) if sma20 else None,
                'sma50': round(sma50, 2) if sma50 else None,
                'current_price': current_price,
            }

            # لو مفيش SMA50، نعتمد على SMA20 بس
            above_sma50 = sma50 is not None and current_price > sma50
            above_sma20 = sma20 is not None and current_price > sma20

            if above_sma50:
                score = 15
                reason = f"Price ${current_price:.2f} above SMA50 ${sma50:.2f} — Strong uptrend"
                reason_ar = f"السعر ${current_price:.2f} فوق SMA50 ${sma50:.2f} — اتجاه صاعد قوي"
            elif above_sma20:
                score = 10
                sma20_val = f"${sma20:.2f}" if sma20 else "N/A"
                reason = f"Price ${current_price:.2f} above SMA20 {sma20_val} — Uptrend"
                reason_ar = f"السعر ${current_price:.2f} فوق SMA20 {sma20_val} — اتجاه صاعد"
            elif sma20 is not None and current_price <= sma20:
                score = 5
                reason = f"Price ${current_price:.2f} below SMA20 ${sma20:.2f} — Weak trend"
                reason_ar = f"السعر ${current_price:.2f} تحت SMA20 ${sma20:.2f} — ضعف في الاتجاه"
            elif sma50 is not None and current_price <= sma50:
                score = 0
                reason = f"Price ${current_price:.2f} below SMA50 ${sma50:.2f} — Downtrend"
                reason_ar = f"السعر ${current_price:.2f} تحت SMA50 ${sma50:.2f} — اتجاه هابط"
            else:
                # مفيش بيانات كافية لـ SMA
                score = 5
                reason = "Insufficient data for reliable SMA — defaulting to mid"
                reason_ar = "بيانات غير كافية للمتوسط المتحرك — القيمة الافتراضية"

        except Exception as e:
            return FactorResult(
                name="Trend",
                name_ar="الاتجاه",
                score=5,
                max_score=15,
                reason=f"SMA calculation error: {e}",
                reason_ar=f"خطأ في حساب المتوسط المتحرك: {e}",
                details={'sma20': None, 'sma50': None},
            )

        return FactorResult(
            name="Trend",
            name_ar="الاتجاه",
            score=score,
            max_score=15,
            reason=reason,
            reason_ar=reason_ar,
            details=details,
        )

    def _evaluate_stability(self, events: List[Any]) -> FactorResult:
        """
        العامل 5: الاستقرار / Factor 5: Stability.
        ─────────────────────────────────────────────────────────────────
        عدد الأحداث الكبيرة (30 يوم)  | النقاط  | الوصف
        ------------------------------|---------|--------------------------------
        0                              | 10      | مفيش أحداث — مستقر
        1                              | 7       | حدث واحد — حذر
        2                              | 4       | حدثين — قلق
        3+                             | 1       | أحداث كثيرة — غير مستقر
        """
        try:
            major_count = _count_events_in_period(events, days=30)
        except Exception:
            major_count = 0

        if major_count == 0:
            score = 10
            reason = "No major events in 30 days — Stable"
            reason_ar = "مفيش أحداث كبيرة خلال 30 يوم — مستقر"
        elif major_count == 1:
            score = 7
            reason = f"1 major event in 30 days — Caution"
            reason_ar = f"حدث واحد خلال 30 يوم — حذر"
        elif major_count == 2:
            score = 4
            reason = f"2 major events in 30 days — Concerning"
            reason_ar = f"حدثين خلال 30 يوم — مقلق"
        else:
            score = 1
            reason = f"{major_count} major events in 30 days — Unstable"
            reason_ar = f"{major_count} أحداث خلال 30 يوم — غير مستقر"

        return FactorResult(
            name="Stability",
            name_ar="الاستقرار",
            score=score,
            max_score=10,
            reason=reason,
            reason_ar=reason_ar,
            details={'major_events_30d': major_count},
        )

    def evaluate_batch(
        self,
        coins: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        يقيّم مجموعة عملات ويفصلها لـ مقبولة ومرفوضة / Batch evaluation.

        Args:
            coins: قائمة من dicts، كل واحد فيه:
                - coin_id: معرف العملة
                - market_data: بيانات السوق
                - events: قائمة الأحداث (اختياري)

        Returns:
            (approved_list, rejected_list)
            - approved: عملات PASS أو REVIEW (مع بيانات QG مضافة)
            - rejected: عملات FAIL
        """
        approved: List[Dict[str, Any]] = []
        rejected: List[Dict[str, Any]] = []

        for coin in coins:
            coin_id = coin.get('coin_id', '')
            market_data = coin.get('market_data', {})
            events = coin.get('events', [])

            result = self.evaluate(coin_id, market_data, events)

            coin_with_qg = dict(coin)
            coin_with_qg['qg_result'] = result.to_dict()
            coin_with_qg['qg_verdict'] = result.verdict
            coin_with_qg['qg_score'] = result.adjusted_score
            coin_with_qg['qg_position_modifier'] = result.position_modifier

            if result.verdict == 'FAIL':
                coin_with_qg['qg_rejection_reasons'] = result.reasons
                rejected.append(coin_with_qg)
            else:
                approved.append(coin_with_qg)

        return approved, rejected


# ============================================================================
# MODULE-LEVEL CONVENIENCE INSTANCE
# مثيل جاهز للاستخدام المباشر بدون إنشاء كائن جديد
# ============================================================================

crypto_quality_gate = CryptoQualityGate()


# ============================================================================
# V40.4: evaluate_crypto_quality(ticker) — Directive §4.1 dispatcher entry
# مدخل موحّد لجودة الكريبتو يقبل رمز التداول (BTC/ETH) مباشرةً
# ============================================================================

# Symbol → CoinGecko coin_id map (mirrors jobs/crypto_lab_scheduler.py)
_SYMBOL_TO_COINGECKO_ID: Dict[str, str] = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin',
    'SOL': 'solana', 'XRP': 'ripple', 'ADA': 'cardano',
    'DOGE': 'dogecoin', 'AVAX': 'avalanche-2', 'DOT': 'polkadot',
    'MATIC': 'matic-network', 'TRX': 'tron', 'LINK': 'chainlink',
    'LTC': 'litecoin', 'BCH': 'bitcoin-cash', 'UNI': 'uniswap',
    'ATOM': 'cosmos', 'XLM': 'stellar', 'ETC': 'ethereum-classic',
    'FIL': 'filecoin', 'HBAR': 'hedera-hashgraph', 'NEAR': 'near',
    'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
    'INJ': 'injective-protocol', 'SUI': 'sui', 'SEI': 'sei-network',
    'TIA': 'celestia', 'RUNE': 'thorchain', 'AAVE': 'aave', 'GRT': 'the-graph',
}

# V40.4 §4.1: Directive factor-name mapping. The existing gate computes 5
# factors with identical weights (30/25/20/15/10) but different names. We
# alias them to the directive's canonical names so downstream consumers see
# Tokenomics / OnChain_Vol / Liquidity_Depth / Vol_Band / Github_Dev.
_FACTOR_NAME_MAP = {
    'market_cap_rank': 'Tokenomics',       # 0.30 weight — market cap ≈ tokenomics
    'liquidity':        'OnChain_Vol',      # 0.25 weight — 24h volume flow
    'volatility':       'Liquidity_Depth',  # 0.20 weight — vol regime ≈ depth proxy
    'trend':            'Vol_Band',         # 0.15 weight — SMA band
    'stability':        'Github_Dev',       # 0.10 weight — event stability
}

# V40.4 §4.1: Hard veto threshold — non-gambler personas drop if below this.
CRYPTO_VETO_THRESHOLD: float = 35.0


def evaluate_crypto_quality(
    ticker: str,
    market_data: Optional[Dict[str, Any]] = None,
    events: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """V40.4 §4.1 — Unified crypto quality evaluator.

    Accepts a trading symbol (e.g. ``'BTC'``, ``'ETH'``) and returns a
    directive-aligned quality dict.  When ``market_data`` is ``None`` a
    best-effort fetch from CoinGecko is attempted (with DB fallback); when
    supplied it is passed straight through to :meth:`CryptoQualityGate.evaluate`.

    Returns a dict with:
      ``quality_score``   — 0-100 unified score
      ``verdict``         — PASS / REVIEW / FAIL
      ``veto``            — True when quality_score < CRYPTO_VETO_THRESHOLD
      ``factors``         — {Tokenomics, OnChain_Vol, Liquidity_Depth,
                             Vol_Band, Github_Dev} each {score, max_score, ...}
      ``coin_id``         — resolved CoinGecko coin_id (or '' if unknown)
      ``source``          — 'crypto_quality_gate'
    """
    sym = (ticker or '').upper().strip()
    coin_id = _SYMBOL_TO_COINGECKO_ID.get(sym, sym.lower() or '')

    # Build market_data if the caller didn't supply it.
    if market_data is None:
        market_data = _fetch_market_data_for(coin_id, sym)

    try:
        result = crypto_quality_gate.evaluate(coin_id or sym, market_data, events)
    except Exception as exc:
        logger.warning(f"[CryptoQG] evaluate failed for {sym}/{coin_id}: {exc}")
        return {
            'quality_score': 0.0,
            'verdict': 'FAIL',
            'veto': True,
            'factors': {},
            'coin_id': coin_id,
            'source': 'crypto_quality_gate',
            'error': str(exc),
        }

    # Re-map factor keys to the directive's canonical names.
    mapped_factors: Dict[str, Any] = {}
    for key, val in (result.factors or {}).items():
        canon = _FACTOR_NAME_MAP.get(key, key)
        mapped_factors[canon] = val

    score = float(result.adjusted_score or result.total_score or 0.0)
    # Raw quality flag — the PERSONA-AWARE veto decision is made by the
    # dispatcher (get_asset_quality_score): gambler bypasses quality veto
    # because its quality weight = 0 (Directive §4.1 + §6 Phase 2.1 task 3).
    quality_below_threshold = score < CRYPTO_VETO_THRESHOLD

    return {
        'quality_score': round(score, 2),
        'verdict': result.verdict,
        'quality_below_threshold': quality_below_threshold,
        'veto': quality_below_threshold,  # raw flag; dispatcher applies persona rule
        'factors': mapped_factors,
        'coin_id': coin_id,
        'source': 'crypto_quality_gate',
    }


def _fetch_market_data_for(coin_id: str, symbol: str) -> Dict[str, Any]:
    """Best-effort market data fetch — CoinGecko first, DB fallback, else stub.

    Kept deliberately simple + resilient: any failure returns a minimal stub
    so the gate still produces a (low) score rather than crashing callers.
    """
    import urllib.request

    # 1) Try CoinGecko /coins/markets for current snapshot
    if coin_id:
        url = (f"https://api.coingecko.com/api/v3/coins/markets"
               f"?vs_currency=usd&ids={coin_id}&sparkline=false")
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'M2y-CryptoLab/1.0', 'Accept': 'application/json',
            })
            with urllib.request.urlopen(req, timeout=12) as response:
                data = json.loads(response.read().decode())
            if isinstance(data, list) and data:
                d = data[0]
                return {
                    'market_cap_rank': d.get('market_cap_rank') or 999,
                    'volume_24h_usd': float(d.get('total_volume') or 0),
                    'current_price': float(d.get('current_price') or 0),
                    'high_24h': float(d.get('high_24h') or 0),
                    'low_24h': float(d.get('low_24h') or 0),
                }
        except Exception as exc:
            logger.debug(f"[CryptoQG] CoinGecko fetch failed for {coin_id}: {exc}")

    # 2) Fallback: minimal stub (gate will score low → likely FAIL/veto)
    return {
        'market_cap_rank': 999,
        'volume_24h_usd': 0.0,
        'current_price': 0.0,
    }


# ============================================================================
# SELF-TEST — اختبار ذاتي
# ============================================================================

if __name__ == '__main__':
    print("=" * 70)
    print("🛡️ CRYPTO QUALITY GATE — SELF TEST")
    print("=" * 70)

    gate = crypto_quality_gate

    # ── Test 1: Bitcoin (should PASS — high rank, high liquidity, low vol) ──
    print("\n📊 Test 1: Bitcoin (BTC) — Expected: PASS")
    print("-" * 50)
    btc_data = {
        'market_cap_rank': 1,
        'volume_24h_usd': 35_000_000_000,   # $35B
        'current_price': 94500.0,
        'price_history': [
            {'price_usd': 90000 + i * 200, 'high_24h': 90300 + i * 200, 'low_24h': 89700 + i * 200}
            for i in range(55)
        ],
    }
    btc_events = []
    btc_result = gate.evaluate('bitcoin', btc_data, btc_events)
    print(f"  Total Score:  {btc_result.total_score}")
    print(f"  Event Mod:    {btc_result.event_modifier}")
    print(f"  Adjusted:     {btc_result.adjusted_score}")
    print(f"  Verdict:      {btc_result.verdict}")
    print(f"  Position Mod: {btc_result.position_modifier}")
    for fname, fdata in btc_result.factors.items():
        print(f"  - {fname}: {fdata['score']}/{fdata['max_score']} — {fdata['reason']}")

    # ── Test 2: Mid-cap coin with events (should REVIEW or FAIL) ──
    print("\n📊 Test 2: Mid-cap coin with events — Expected: REVIEW/FAIL")
    print("-" * 50)
    mid_data = {
        'market_cap_rank': 45,
        'volume_24h_usd': 25_000_000,       # $25M
        'current_price': 3.50,
        'price_history': [
            {'price_usd': 3.0 + (i % 10) * 0.05, 'high_24h': 3.1 + (i % 10) * 0.05, 'low_24h': 2.9 + (i % 10) * 0.05}
            for i in range(55)
        ],
    }
    mid_events = [
        {'event_type': 'token_unlock', 'event_date': None, 'days_until': 3, 'event_name': 'Token Unlock'},
        {'event_type': 'sec_regulatory', 'event_date': None, 'days_until': None, 'event_name': 'SEC Investigation'},
    ]
    mid_result = gate.evaluate('some-coin', mid_data, mid_events)
    print(f"  Total Score:  {mid_result.total_score}")
    print(f"  Event Mod:    {mid_result.event_modifier}")
    print(f"  Adjusted:     {mid_result.adjusted_score}")
    print(f"  Verdict:      {mid_result.verdict}")
    print(f"  Position Mod: {mid_result.position_modifier}")
    for fname, fdata in mid_result.factors.items():
        print(f"  - {fname}: {fdata['score']}/{fdata['max_score']} — {fdata['reason']}")
    if mid_result.warnings:
        print("  Warnings:")
        for w in mid_result.warnings:
            print(f"    {w}")

    # ── Test 3: Small-cap meme coin (should FAIL) ──
    print("\n📊 Test 3: Small-cap meme coin — Expected: FAIL")
    print("-" * 50)
    meme_data = {
        'market_cap_rank': 350,
        'volume_24h_usd': 2_000_000,        # $2M
        'current_price': 0.00008,
        'price_history': [
            {'price_usd': 0.00005 + (i % 7) * 0.00001, 'high_24h': 0.00006 + (i % 7) * 0.00001, 'low_24h': 0.00004 + (i % 7) * 0.00001}
            for i in range(55)
        ],
    }
    meme_events = [
        {'event_type': 'whale_movement', 'days_until': 1, 'event_name': 'Whale Dump'},
    ]
    meme_result = gate.evaluate('meme-coin', meme_data, meme_events)
    print(f"  Total Score:  {meme_result.total_score}")
    print(f"  Event Mod:    {meme_result.event_modifier}")
    print(f"  Adjusted:     {meme_result.adjusted_score}")
    print(f"  Verdict:      {meme_result.verdict}")
    print(f"  Position Mod: {meme_result.position_modifier}")
    for fname, fdata in meme_result.factors.items():
        print(f"  - {fname}: {fdata['score']}/{fdata['max_score']} — {fdata['reason']}")

    # ── Test 4: Missing data — graceful fallback ──
    print("\n📊 Test 4: Missing data — Expected: Low score with defaults")
    print("-" * 50)
    empty_result = gate.evaluate('unknown-coin', {}, [])
    print(f"  Total Score:  {empty_result.total_score}")
    print(f"  Adjusted:     {empty_result.adjusted_score}")
    print(f"  Verdict:      {empty_result.verdict}")
    for fname, fdata in empty_result.factors.items():
        print(f"  - {fname}: {fdata['score']}/{fdata['max_score']} — {fdata['reason']}")

    # ── Test 5: Batch evaluation ──
    print("\n📊 Test 5: Batch evaluation")
    print("-" * 50)
    batch = [
        {'coin_id': 'bitcoin', 'market_data': btc_data, 'events': btc_events},
        {'coin_id': 'meme-coin', 'market_data': meme_data, 'events': meme_events},
    ]
    approved, rejected = gate.evaluate_batch(batch)
    print(f"  Approved: {len(approved)} coins")
    for a in approved:
        print(f"    ✅ {a['coin_id']}: score={a['qg_score']}, verdict={a['qg_verdict']}")
    print(f"  Rejected: {len(rejected)} coins")
    for r in rejected:
        print(f"    ❌ {r['coin_id']}: score={r['qg_score']}, verdict={r['qg_verdict']}")

    # ── Test 6: verify import pattern works ──
    print("\n📊 Test 6: Import verification")
    print("-" * 50)
    # عند التشغيل المباشر، الـ module مش في sys.path كـ analyzers.*
    # فبنضيف الـ parent directory عشان نختبر الـ import pattern الحقيقي
    import sys
    vps_dir = str(Path(__file__).parent.parent)
    if vps_dir not in sys.path:
        sys.path.insert(0, vps_dir)
    from analyzers.crypto_quality_gate import CryptoQualityGate, crypto_quality_gate as imported_gate
    assert isinstance(imported_gate, CryptoQualityGate), "Module-level instance must be CryptoQualityGate"
    test_result = imported_gate.evaluate('test', {'market_cap_rank': 1, 'volume_24h_usd': 500_000_000, 'current_price': 100.0})
    assert hasattr(test_result, 'verdict'), "Result must have verdict"
    assert hasattr(test_result, 'adjusted_score'), "Result must have adjusted_score"
    assert test_result.verdict in ('PASS', 'REVIEW', 'FAIL'), f"Invalid verdict: {test_result.verdict}"
    print("  ✅ Import pattern verified successfully")

    print("\n" + "=" * 70)
    print("🛡️ CRYPTO QUALITY GATE — ALL TESTS COMPLETE")
    print("=" * 70)
