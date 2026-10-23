"""
Liquidity Filter
================
فلتر السيولة - أول خطوة قبل أي تحليل

القاعدة الذهبية: السيولة أولاً، التحليل تانياً

Features:
- Daily Volume Filter
- Daily Turnover Filter
- Liquidity Level Classification
- EXCLUDED stocks list
- Penny Stock Filter (price < 1.00 EGP)

CRITICAL RULES:
- Penny stocks (price < 1.00 EGP) = EXCLUDED (manipulation risk)
- Low liquidity stocks = EXCLUDED (cannot exit position)

Author: دليل الاستثمار (Based on Kemi's Analysis)
Updated: Added Penny Stock Filter
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from enum import Enum
import sqlite3
import re
from datetime import datetime, timedelta

# DYNAMIC-SYSTEM-001: استيراد الإعدادات الديناميكية + سياق السوق
try:
    from analyzers.engine_settings import get_setting
    from analyzers.dynamic_context_engine import get_dynamic_context
    _DYNAMIC_AVAILABLE = True
except ImportError:
    _DYNAMIC_AVAILABLE = False

    def get_setting(key, default=None):
        return float(default) if default is not None else 0.0

    def get_dynamic_context(ticker, use_cache=True):
        return None  # type: ignore

# DYNAMIC-LIQUIDITY-V2 (2026-09-04): المرجع الموحّد للحد الديناميكي المبني على سعر السهم.
# قرارات المالك: < 5 → 80K, 5-15 → 200K, > 15 → 400K + pump-and-dump guard + volume_surge_bypass.
try:
    from utils.shared_liquidity import (
        dynamic_min_turnover as _shared_dynamic_min_turnover,
        should_reject_by_liquidity as _shared_should_reject_by_liquidity,
        has_volume_surge as _shared_has_volume_surge,
        classify_price_bucket as _shared_classify_price_bucket,
        DYNAMIC_TURNOVER_THRESHOLDS as _SHARED_DYNAMIC_THRESHOLDS,
        PUMP_AND_DUMP_TURNOVER_FLOOR as _SHARED_PUMP_AND_DUMP_FLOOR,
        LIQUIDITY_BYPASS_POSITION_SIZE as _SHARED_BYPASS_POSITION_SIZE,
    )
    _SHARED_LIQUIDITY_AVAILABLE = True
except ImportError:
    _SHARED_LIQUIDITY_AVAILABLE = False
    _SHARED_DYNAMIC_THRESHOLDS = {'low_price': 80_000, 'mid_price': 200_000, 'high_price': 400_000}
    _SHARED_PUMP_AND_DUMP_FLOOR = 0.0
    _SHARED_BYPASS_POSITION_SIZE = 0.025

    def _shared_dynamic_min_turnover(price, market_dead=False):
        if market_dead:
            return 700_000
        if price <= 0:
            return 400_000
        if price < 5:
            return 80_000
        if price <= 15:
            return 200_000
        return 400_000

    def _shared_classify_price_bucket(price):
        if price <= 0:
            return 'unknown'
        if price < 5:
            return 'low_price'
        if price <= 15:
            return 'mid_price'
        return 'high_price'

    def _shared_should_reject_by_liquidity(avg_turnover, current_price, volumes=None, closes=None, market_dead=False):
        if avg_turnover <= 0:
            return (True, 'pump-and-dump guard — turnover=0', False, 0.0)
        threshold = _shared_dynamic_min_turnover(current_price, market_dead)
        if avg_turnover >= threshold:
            return (False, 'ok', False, float(threshold))
        return (True, f'turnover {avg_turnover:,.0f} < {threshold:,}', False, float(threshold))

    def _shared_has_volume_surge(volumes, closes=None, surge_ratio=1.5, surge_lookback=5, base_lookback=20, ma_period=20):
        if not volumes or len(volumes) < base_lookback:
            return (False, 'insufficient data')
        recent_avg = sum(volumes[-surge_lookback:]) / surge_lookback
        base_avg = sum(volumes[-base_lookback:]) / base_lookback
        if base_avg <= 0:
            return (False, 'avg_20d = 0')
        ratio = recent_avg / base_avg
        if ratio < surge_ratio:
            return (False, f'ratio {ratio:.2f} < {surge_ratio}')
        if closes and len(closes) >= ma_period:
            ma20 = sum(closes[-ma_period:]) / ma_period
            if closes[-1] <= ma20:
                return (False, 'price under MA20')
        return (True, f'surge {ratio:.2f}x + above MA20')


def ctx_turnover_display(ctx) -> str:
    """DYNAMIC-SYSTEM-001: نص موجز لعرض قيم السيولة في الـ warnings."""
    if ctx is None:
        return 'لا يوجد سياق'
    return (
        f'الحالي {ctx.current_turnover:,.0f} / المتوسط {ctx.avg_turnover_baseline:,.0f} جنيه'
    )


# V40.2: Strict-mode flag for backtests — disables the market-open relaxation
# (which is keyed on wall-clock time and would otherwise let illiquid stocks
# through when a backtest runs outside EGX trading hours).
_STRICT_KILL_FILTERS = False


def set_strict_kill_filters(enabled: bool) -> None:
    """Enable/disable strict kill-filter mode (backtests should enable it).

    When enabled, the closed-market relaxation (3M→600K turnover, 60→9 bars)
    is bypassed so backtests always use the full thresholds regardless of the
    wall-clock time the script is executed.
    """
    global _STRICT_KILL_FILTERS
    _STRICT_KILL_FILTERS = bool(enabled)

# RELAX-CLOSED-MARKET-001: لما السوق مقفول (أو بنعمل backtest)، السيولة
# اللحظية بتبقى 0 لأن مفيش تداول حقيقي. الفلتر الصارم (3M EGP/day) بيخنق
# كل الأسهم ويطلّع شاشة فاضية. الحل: لما السوق مقفول، نرخّف الفلاتر ونستخدم
# المتوسط التاريخي بدل القيمة اللحظية.
def _is_egx_market_open() -> bool:
    """تحقق إن بورصة مصر (EGX) مفتوحة دلوقتي.

    أيام التداول: الأحد - الخميس (weekday 6=Sun ... 3=Thu in Python).
    عطلة: الجمعة (4) والسبت (5).
    ساعات الجلسة: 10:00 - 15:00 بتوقيت القاهرة.
    """
    try:
        # Africa/Cairo timezone
        import zoneinfo
        now_cairo = datetime.now(zoneinfo.ZoneInfo('Africa/Cairo'))
    except Exception:
        now_cairo = datetime.now()  # fallback to local
    # Python weekday(): Mon=0 ... Sun=6, Sat=5
    # EGX weekend = Friday(4) + Saturday(5)
    if now_cairo.weekday() in (4, 5):
        return False
    current_minutes = now_cairo.hour * 60 + now_cairo.minute
    return 10 * 60 <= current_minutes < 15 * 60


def _parse_volume_string(val) -> float:
    """MARKET-REALITY-SLAP-027: يحول نصوص الحجم بأ suffixes K/M/B لرقم.

    جدول stocks بيخزن الحجم كـ string ("2.28 M", "86.45 M", "559.83 K")
    مع Unicode narrow no-break space (\\u202f). float() العادية بتفشل على ده.
    ده اللي كان سبب إن الـ liquidity filter بيرجع "لا توجد بيانات حجم" لكل الأسهم!
    """
    if val is None:
        return 0.0
    try:
        if isinstance(val, (int, float)):
            return float(val)
        s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').replace('\xa0', '').strip()
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
            return num if num == num else 0.0  # NaN check
        return 0.0
    except (ValueError, TypeError):
        return 0.0


class LiquidityLevel(Enum):
    """مستويات السيولة"""
    EXCLUDED = "EXCLUDED"      # < 100K shares or < 500K EGP turnover
    WEAK = "WEAK"              # 100K-300K shares
    MODERATE = "MODERATE"      # 300K-1M shares
    LIQUID = "LIQUID"          # 1M-5M shares
    HIGH_LIQUIDITY = "HIGH"    # > 5M shares


@dataclass
class LiquidityProfile:
    """ملف سيولة السهم"""
    ticker: str
    avg_daily_volume: float
    avg_daily_turnover: float
    volume_20d: float
    turnover_20d: float
    level: LiquidityLevel
    is_tradeable: bool
    warning: Optional[str] = None
    # FREE-FLOAT-023: نسبة الأسهم الحرة المتاحة للتداول (NULL = غير معروف → لا تحذر)
    free_float_percentage: Optional[float] = None
    free_float_shares: Optional[int] = None
    # تحذير مستقل عن الأسهم الحرة القليلة (يظهر للواجهة)
    free_float_warning: Optional[str] = None
    # معامل السيولة الكلي (يجمع تأثير المستوى + الأسهم الحرة)
    liquidity_mult: float = 1.0
    # V40: Kill Filters result — نتيجة فلاتر الاستبعاد الإجبارية
    kill_filter_result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict:
        return {
            'ticker': self.ticker,
            'avg_daily_volume': round(self.avg_daily_volume, 0),
            'avg_daily_turnover': round(self.avg_daily_turnover, 2),
            'level': self.level.value,
            'is_tradeable': self.is_tradeable,
            'warning': self.warning,
            'free_float_percentage': self.free_float_percentage,
            'free_float_shares': self.free_float_shares,
            'free_float_warning': self.free_float_warning,
            'liquidity_mult': self.liquidity_mult,
            'kill_filter_result': self.kill_filter_result,
        }


# ============================================================================
# P24-DYNAMIC-LIQUIDITY (Aug 2026): Dynamic minimum turnover
# ============================================================================
def dynamic_min_turnover(ticker: str, avg_market_turnover: float = 0.0,
                         stock_avg_volume_20d: float = 0.0,
                         volume_spike_ratio: float = 1.0,
                         market_turnover_today: float = 0.0,
                         base_min_turnover: float = 3_000_000) -> float:
    """حد السيولة الأدنى المُتكيّف لكل سهم (بدل الحد الثابت 3M).

    القواعد (من بروتوكول المالك):
      - لو volume_spike_ratio > 2.5 (سهم عليه ضغط شراء) → اقبل 300K (الزخم يبرر).
      - لو السوق كله ميّت (market_turnover_today < avg * 0.7) → ارفع لـ 700K
        (تجنّب أسهم تربية الدجاج في سوق راكد).
      - غير كده → استخدم base_min_turnover (3M افتراضياً).

    Args:
        ticker: رمز السهم.
        avg_market_turnover: متوسط الـ turnover الكلي للسوق (EGP). 0 → تجاهل.
        stock_avg_volume_20d: متوسط حجم السهم 20 يوم (مرجعية).
        volume_spike_ratio: today_volume / avg_volume_20d (1.0 = عادي).
        market_turnover_today: إجمالي سيولة السوق اليوم (EGP). 0 → تجاهل.
        base_min_turnover: الحد الأساسي (default 3M).

    Returns:
        الحد الأدنى المُتكيّف للـ turnover (EGP).
    """
    try:
        _spike = float(volume_spike_ratio) if volume_spike_ratio else 1.0
    except (TypeError, ValueError):
        _spike = 1.0

    # 1. لو فيه volume spike قوي → اقبل سيولة أقل (الزخم يبرر الدخول)
    if _spike > 2.5:
        return 300_000.0

    # 2. لو السوق كله ميّت → ارفع الحد (تجنّب الأسهم الميتة في سوق راكد)
    try:
        _avg_mkt = float(avg_market_turnover) if avg_market_turnover else 0.0
        _today_mkt = float(market_turnover_today) if market_turnover_today else 0.0
    except (TypeError, ValueError):
        _avg_mkt, _today_mkt = 0.0, 0.0
    if _avg_mkt > 0 and _today_mkt > 0:
        if _today_mkt < (_avg_mkt * 0.7):
            return 700_000.0

    # 3. افتراضي
    return float(base_min_turnover)


# ============================================================================
# V40: Kill Filters — طبقة فلاتر الاستبعاد الإجبارية قبل أي تحليل
# ============================================================================
def evaluate_kill_filters(
    ticker: str,
    closes: List[float] = None,
    volumes: List[float] = None,
    current_price: float = 0.0,
    avg_turnover: float = 0.0,
    benchmark_change: float = 0.0,
    stock_roc: float = 0.0,
    data_bars_count: int = 0,
) -> Dict[str, Any]:
    """
    V40: طبقة Kill Filters — فلاتر استبعاد إجبارية قبل أي تحليل.

    أي سهم فاشل في أي فلتر → مفيش تحليل أصلًا (HOLD فوري).

    الفلاتر:
      1. السيولة: avg_turnover < kill_filter_min_turnover_egp → EXCLUDED
      2. السعر: current_price < kill_filter_min_stock_price → EXCLUDED
      3. تذبذب الحجم: std/avg > kill_filter_max_volume_volatility → EXCLUDED (تلاعب)
      4. البيانات: data_bars_count < kill_filter_min_data_bars → EXCLUDED
      5. القوة النسبية: (stock_roc - benchmark_change) < kill_filter_min_relative_strength → EXCLUDED

    Returns:
        dict فيه:
          - passed: bool — هل السهم عدّى كل الفلاتر؟
          - kill_reasons: List[str] — أسباب الاستبعاد (عربي)
          - kill_details: dict — تفاصيل كل فلتر
          - kill_filter_active: bool — هل تم تفعيل أي فلتر؟
    """
    kill_reasons = []
    kill_details = {}

    # DYNAMIC-LIQUIDITY-V2 (2026-09-04): استبدلنا الحد الثابت 3M بحد ديناميكي
    # مبني على سعر السهم (utils.shared_liquidity.dynamic_min_turnover).
    # الجديد: < 5 → 80K, 5-15 → 200K, > 15 → 400K.
    # + pump-and-dump guard (turnover=0 → ارفض فوري)
    # + volume_surge_bypass (لو surge ≥ 1.5× + السعر فوق MA20 → اقبل بحجم صغير)
    # الـ admin settings لسه تقرأ كـ legacy fallback لو shared_liquidity مش متاحة.
    _admin_min_turnover = float(get_setting('kill_filter_min_turnover_egp', default=3_000_000.0))
    _min_price = get_setting('kill_filter_min_stock_price', default=1.0)
    _max_vol_volatility = get_setting('kill_filter_max_volume_volatility', default=3.0)
    # V40.2-DATA-FIX: was 60, then 30, but data_engine.db has ~26 days per ticker
    _min_data_bars = int(get_setting('kill_filter_min_data_bars', default=20))
    _min_rs = get_setting('kill_filter_min_relative_strength', default=-2.0)

    # RELAX-CLOSED-MARKET-001: في السوق المقفول، الـ intraday data بتكون قليلة
    # (load_merged_history بتجمع آخر يوم تداول فقط). نخفف الحد الأدنى للبيانات
    # لـ 15% من القيمة الأصلية عشان نسمح بالتحليل في السوق المقفول.
    # V40.2: في الـ backtest، نشيل الترخيص ده عشان الفلاتر تفضل صارمة بغض النظر
    # عن وقت تشغيل السكريبت (set_strict_kill_filters(True) من الباكتست).
    _market_open = _is_egx_market_open()
    if not _market_open and not _STRICT_KILL_FILTERS:
        _min_data_bars = max(int(_min_data_bars * 0.15), 8)  # 60 → 9 (حد أدنى 8)
        # ملاحظة: في السوق المقفول، الـ dynamic_min_turnover(price) لسه بيتطبّق.
        # مش بنستخدم _admin_min_turnover * 0.2 (اللي كان 600K) — الـ dynamic أحسن.

    # Filter 1: السيولة — DYNAMIC-LIQUIDITY-V2
    # استخدم shared_liquidity.should_reject_by_liquidity (شامل pump-and-dump guard + volume_surge_bypass)
    _liquidity_rejected = False
    _liquidity_reason = ''
    _liquidity_bypass = False
    _effective_threshold = float(_admin_min_turnover)

    if _SHARED_LIQUIDITY_AVAILABLE:
        _liquidity_rejected, _liquidity_reason, _liquidity_bypass, _effective_threshold, _liquidity_explosive = _shared_should_reject_by_liquidity(
            avg_turnover=avg_turnover,
            current_price=current_price,
            volumes=volumes,
            closes=closes,
            market_dead=False,  # TODO: hook لـ market_dead detector
        )
    else:
        # LEGACY FALLBACK: لو shared_liquidity مش متاح، استخدم الـ admin setting القديم
        _effective_threshold = _admin_min_turnover
        _liquidity_explosive = False
        if not _market_open and not _STRICT_KILL_FILTERS:
            _effective_threshold = _admin_min_turnover * 0.2
        if avg_turnover <= 0:
            _liquidity_rejected = True
            _liquidity_reason = f'pump-and-dump guard — turnover=0'
        elif avg_turnover < _effective_threshold:
            _liquidity_rejected = True
            _liquidity_reason = f'turnover {avg_turnover:,.0f} < {_effective_threshold:,.0f}'
        else:
            _liquidity_rejected = False
            _liquidity_reason = 'ok'
            _liquidity_bypass = False

    if _liquidity_rejected:
        kill_reasons.append(
            f'🚨 سيولة ميتة — {_liquidity_reason}'
        )
        kill_details['liquidity'] = {
            'passed': False,
            'value': avg_turnover,
            'threshold': _effective_threshold,
            'bypass_activated': _liquidity_bypass,
            'explosive_surge_activated': _liquidity_explosive,
            'dynamic_v2': _SHARED_LIQUIDITY_AVAILABLE,
            'price_bucket': _shared_classify_price_bucket(current_price) if _SHARED_LIQUIDITY_AVAILABLE else 'unknown',
        }
    else:
        kill_details['liquidity'] = {
            'passed': True,
            'value': avg_turnover,
            'threshold': _effective_threshold,
            'bypass_activated': _liquidity_bypass,
            'explosive_surge_activated': _liquidity_explosive,
            'dynamic_v2': _SHARED_LIQUIDITY_AVAILABLE,
            'price_bucket': _shared_classify_price_bucket(current_price) if _SHARED_LIQUIDITY_AVAILABLE else 'unknown',
        }

    # Filter 2: السعر
    if current_price > 0 and current_price < _min_price:
        kill_reasons.append(
            f'🚨 سهم قرش — سعر {current_price:.2f} جنيه < {_min_price}'
        )
        kill_details['price'] = {
            'passed': False,
            'value': current_price,
            'threshold': _min_price,
        }
    else:
        kill_details['price'] = {'passed': True, 'value': current_price}

    # Filter 3: تذبذب الحجم (كشف التلاعب)
    if volumes and len(volumes) >= 20:
        recent_vols = volumes[-20:]
        vol_avg = sum(recent_vols) / len(recent_vols)
        if vol_avg > 0:
            vol_variance = sum((v - vol_avg) ** 2 for v in recent_vols) / len(recent_vols)
            vol_std = vol_variance ** 0.5
            vol_volatility = vol_std / vol_avg  # coefficient of variation
            if vol_volatility > _max_vol_volatility:
                kill_reasons.append(
                    f'🚨 تذبذب حجم مشبوه — CV={vol_volatility:.2f} > {_max_vol_volatility} (تلاعب محتمل)'
                )
                kill_details['volume_volatility'] = {
                    'passed': False,
                    'value': round(vol_volatility, 3),
                    'threshold': _max_vol_volatility,
                }
            else:
                kill_details['volume_volatility'] = {
                    'passed': True,
                    'value': round(vol_volatility, 3),
                }
        else:
            kill_details['volume_volatility'] = {'passed': True, 'value': 0.0}
    else:
        kill_details['volume_volatility'] = {'passed': True, 'value': None, 'note': 'بيانات غير كافية'}

    # Filter 4: عدد الشموع
    if data_bars_count > 0 and data_bars_count < _min_data_bars:
        kill_reasons.append(
            f'🚨 بيانات ناقصة — {data_bars_count} شمعة < {_min_data_bars} المطلوبة'
        )
        kill_details['data_bars'] = {
            'passed': False,
            'value': data_bars_count,
            'threshold': _min_data_bars,
        }
    else:
        kill_details['data_bars'] = {'passed': True, 'value': data_bars_count}

    # Filter 5: القوة النسبية — PHASE-1-RS-BYPASS (2026-09-04)
    # قرار المالك: الأسهم الانفجارية بتيجي ضعيفة عن السوق قبل ما تنفجر (الـ RS سلبي).
    # لو الـ EXPLOSIVE_SURGE path اشتغل (vol ≥ 2.5× + فوق SMA20 + range منضغط)
    # → نشيل الرفض ونحوله لـ penalty (warning) + position size 2%.
    # غير كده → nسيب الـ kill زي ما هو.
    if benchmark_change != 0 or stock_roc != 0:
        relative_strength = stock_roc - benchmark_change
        if relative_strength < _min_rs:
            # لو فيه explosive_surge → bypass الرفض
            if _liquidity_explosive:
                kill_details['relative_strength'] = {
                    'passed': True,  # bypass — مش kill
                    'value': round(relative_strength, 2),
                    'threshold': _min_rs,
                    'bypassed_by_explosive_surge': True,
                    'note': f'RS={relative_strength:+.2f}% ضعيف، بس EXPLOSIVE_SURGE بـ يبرر الدخول بـ position size 2%',
                }
            else:
                kill_reasons.append(
                    f'🚨 ضعف نسبي واضح — RS={relative_strength:+.2f}% < {_min_rs}% مقابل المؤشر'
                )
                kill_details['relative_strength'] = {
                    'passed': False,
                    'value': round(relative_strength, 2),
                    'threshold': _min_rs,
                }
        else:
            kill_details['relative_strength'] = {
                'passed': True,
                'value': round(relative_strength, 2),
            }
    else:
        kill_details['relative_strength'] = {'passed': True, 'value': None, 'note': 'بيانات المؤشر غير متاحة'}

    # Filter 6: AXIS-6 Wash Trading Guard — volume spike بلا حركة سعر
    # لو آخر 5 شموع حجمها > 3× متوسط 20 يوم، بس مدى السعر (high-low)/close < 1%
    # → تلاعب (wash trading): حجم مضخّم بدون تذبذب سعر = تضليل السوق.
    if closes and len(closes) >= 25 and volumes and len(volumes) >= 25:
        recent_5_vol = sum(volumes[-5:]) / 5
        avg_20_vol = sum(volumes[-20:]) / 20
        if avg_20_vol > 0 and recent_5_vol > 0:
            vol_spike_ratio = recent_5_vol / avg_20_vol
            recent_5_closes = closes[-5:]
            price_range_pct = (max(recent_5_closes) - min(recent_5_closes)) / (sum(recent_5_closes)/5) * 100 if recent_5_closes else 0
            _wash_vol_mult = get_setting('kill_filter_wash_vol_spike_mult', default=3.0)
            _wash_price_range_max = get_setting('kill_filter_wash_price_range_max_pct', default=1.0)
            if vol_spike_ratio > _wash_vol_mult and price_range_pct < _wash_price_range_max:
                kill_reasons.append(
                    f'🚨 تلاعب غسيل (Wash Trading) — حجم {vol_spike_ratio:.1f}× المتوسط بدون حركة سعر ({price_range_pct:.2f}%)'
                )
                kill_details['wash_trading'] = {
                    'passed': False,
                    'vol_spike_ratio': round(vol_spike_ratio, 2),
                    'price_range_pct': round(price_range_pct, 2),
                }
            else:
                kill_details['wash_trading'] = {
                    'passed': True,
                    'vol_spike_ratio': round(vol_spike_ratio, 2),
                    'price_range_pct': round(price_range_pct, 2),
                }
        else:
            kill_details['wash_trading'] = {'passed': True, 'value': None, 'note': 'حجم صفري'}
    else:
        kill_details['wash_trading'] = {'passed': True, 'value': None, 'note': 'بيانات غير كافية'}

    # Filter 7: AXIS-6 Distribution Trap — تصريف مؤسسي خفي
    # لو متوسط حجم أيام الهبوط > 1.5× متوسط حجم أيام الصعود، والسعر نازل
    # → ميكرز بـ يـ distribution (يبيعوا على الريال).
    if closes and len(closes) >= 10 and volumes and len(volumes) >= 10:
        last_10_closes = closes[-10:]
        last_10_vols = volumes[-10:]
        # Note: index alignment — recompute properly
        up_vols = []
        dn_vols = []
        for i in range(1, min(len(last_10_closes), len(last_10_vols))):
            if last_10_closes[i] > last_10_closes[i-1]:
                up_vols.append(last_10_vols[i])
            elif last_10_closes[i] < last_10_closes[i-1]:
                dn_vols.append(last_10_vols[i])
        if up_vols and dn_vols:
            up_avg = sum(up_vols) / len(up_vols)
            dn_avg = sum(dn_vols) / len(dn_vols)
            if up_avg > 0:
                dist_ratio = dn_avg / up_avg
                price_change = (last_10_closes[-1] - last_10_closes[0]) / last_10_closes[0] * 100 if last_10_closes[0] > 0 else 0
                _dist_ratio_threshold = get_setting('kill_filter_distribution_ratio', default=1.5)
                _dist_price_drop_max = get_setting('kill_filter_distribution_price_drop_pct', default=-1.0)
                if dist_ratio > _dist_ratio_threshold and price_change < _dist_price_drop_max:
                    kill_reasons.append(
                        f'🚨 فخ تصريف — حجم الهبوط {dist_ratio:.1f}× حجم الصعود والسعر نزل {price_change:.1f}%'
                    )
                    kill_details['distribution_trap'] = {
                        'passed': False,
                        'dist_ratio': round(dist_ratio, 2),
                        'price_change_pct': round(price_change, 2),
                    }
                else:
                    kill_details['distribution_trap'] = {
                        'passed': True,
                        'dist_ratio': round(dist_ratio, 2),
                        'price_change_pct': round(price_change, 2),
                    }
            else:
                kill_details['distribution_trap'] = {'passed': True, 'value': None, 'note': 'لا أيام صاعدة'}
        else:
            kill_details['distribution_trap'] = {'passed': True, 'value': None, 'note': 'بيانات اتجاه غير كافية'}
    else:
        kill_details['distribution_trap'] = {'passed': True, 'value': None, 'note': 'بيانات غير كافية'}

    # Filter 8: AXIS-6 Dead Money Filter — سهم راكد بلا حياة
    # لو مدى 20 يوم (max-min)/avg < 6% → السهم ميت (لا تذبذب = لا فرصة)
    if closes and len(closes) >= 20:
        last_20 = closes[-20:]
        avg_20 = sum(last_20) / len(last_20)
        if avg_20 > 0:
            range_pct = (max(last_20) - min(last_20)) / avg_20 * 100
            _dead_money_range_min = get_setting('kill_filter_dead_money_range_min_pct', default=4.5)
            if range_pct < _dead_money_range_min:
                kill_reasons.append(
                    f'🚨 سهم ميت (Dead Money) — مدى 20 يوم {range_pct:.1f}% < {_dead_money_range_min}% — رأس مال محبوس'
                )
                kill_details['dead_money'] = {
                    'passed': False,
                    'range_pct': round(range_pct, 2),
                    'threshold': _dead_money_range_min,
                }
            else:
                kill_details['dead_money'] = {
                    'passed': True,
                    'range_pct': round(range_pct, 2),
                }
        else:
            kill_details['dead_money'] = {'passed': True, 'value': None, 'note': 'سعر صفري'}
    else:
        kill_details['dead_money'] = {'passed': True, 'value': None, 'note': 'بيانات غير كافية'}

    passed = len(kill_reasons) == 0
    return {
        'passed': passed,
        'kill_reasons': kill_reasons,
        'kill_details': kill_details,
        'kill_filter_active': not passed,
    }


class LiquidityFilter:
    """
    فلتر السيولة - يُنفذ قبل أي تحليل
    
    القواعد:
    - avg_daily_volume < 100,000 → EXCLUDED
    - avg_daily_turnover < 500,000 EGP → EXCLUDED
    - الأسهم المستبعدة لا يُطبق عليها التحليل
    
    Usage:
        filter = LiquidityFilter(db_path)
        profile = filter.analyze('COMI')
        if profile.is_tradeable:
            # Proceed with analysis
    """
    
    # Thresholds
    MIN_VOLUME = 100_000          # 100K shares
    # DYNAMIC-LIQUIDITY-V2 (2026-09-04): الـ MIN_TURNOVER الثابت ده بقي LEGACY FALLBACK.
    # الـ effective threshold دلوقتي بيرجع من utils.shared_liquidity.dynamic_min_turnover(price)
    # ومبني على سعر السهم: < 5 → 80K, 5-15 → 200K, > 15 → 400K.
    # القرار بعد تحليل 42 explosive mover: الـ 3M كان بيرفض 14/39 (35.9%) من الفرص الحقيقية.
    # الـ dynamic الجديد بـ يخفف الرفض الخاطئ لـ 5/39 (12.8%).
    # شوف: Documentation/LIQUIDITY_DYNAMIC_THRESHOLD_PROPOSAL.md
    MIN_TURNOVER = 3_000_000      # LEGACY FALLBACK — used only if shared_liquidity unavailable

    # RELAX-CLOSED-MARKET-001: لما السوق مقفول، السيولة اللحظية = 0.
    # الفلاتر الصارمة بتخنق كل الأسهم → شاشة فاضية. الحل: نرخّف الفلاتر
    # ونستخدم المتوسط التاريخي بدل القيمة اللحظية. كده المحرك يقدر يطلّع
    # توقعات بناءً على التحليل الفني حتى والسوق مقفول.
    MIN_VOLUME_CLOSED = 50_000        # 50K shares (نص الحد الأصلي)
    MIN_TURNOVER_CLOSED = 500_000     # LEGACY — overriden by dynamic per-price threshold

    # P24-DYNAMIC-LIQUIDITY (Aug 2026): حدود السيولة الديناميكية.
    # بدل حد ثابت واحد، بنحسب الحد الأدنى للـ turnover حسب سياق السهم والسوق.
    # لو السهم عنده volume_spike > 2.5 → نقبل السيولة لو فوق 300K (الزخم يبرر).
    # لو السوق كله ميّت (turnover اليوم < 70% من المتوسط) → نرفع الحد لـ 700K
    # عشان نتجنب أسهم تربية الدجاج في سوق راكد.
    DYNAMIC_TURNOVER_VOLUME_SPIKE_THRESHOLD = 2.5   # × المتوسط
    DYNAMIC_TURNOVER_SPIKE_FLOOR = 300_000          # 300K EGP لو فيه spike
    DYNAMIC_TURNOVER_DEAD_MARKET_RATIO = 0.7        # < 70% من المتوسط = سوق ميت
    DYNAMIC_TURNOVER_DEAD_MARKET_CEILING = 700_000  # 700K EGP لو السوق ميت

    # Penny Stock Threshold
    MIN_STOCK_PRICE = 1.00        # EGX: Stocks under 1 EGP are penny stocks

    # FREE-FLOAT-023: عتبات الأسهم الحرة (Free Float Thresholds)
    # لو free_float_percentage < 5% → خطير جداً (mult=0.2)
    # لو free_float_percentage < 15% → مخاطرة عالية (mult=0.5)
    FREE_FLOAT_CRITICAL = 5.0     # % — خطير جداً (avoid)
    FREE_FLOAT_RISKY = 15.0       # % — مخاطرة عالية
    FREE_FLOAT_CRITICAL_MULT = 0.2
    FREE_FLOAT_RISKY_MULT = 0.5

    # Levels
    VOLUME_LEVELS = {
        'EXCLUDED': 100_000,
        'WEAK': 300_000,
        'MODERATE': 1_000_000,
        'LIQUID': 5_000_000,
    }

    def __init__(self, db_path: str):
        self.db_path = db_path

    def analyze(
        self,
        ticker: str,
        closes: List[float] = None,
        volumes: List[float] = None,
        benchmark_change: float = 0.0,
        stock_roc: float = 0.0,
        data_bars_count: int = 0,
    ) -> LiquidityProfile:
        """
        تحليل سيولة سهم معين

        Args:
            ticker: رمز السهم
            closes (V40 optional): قائمة الأسعار الإغلاق — لتعبئة Kill Filters.
            volumes (V40 optional): قائمة أحجام التداول — لكشف تذبذب الحجم المشبوه.
            benchmark_change (V40 optional): تغير المؤشر (EGX30) خلال الفترة (%).
            stock_roc (V40 optional): Rate-of-Change للسهم خلال نفس الفترة (%).
            data_bars_count (V40 optional): عدد الشموع المتاحة للتحليل.

        Returns:
            LiquidityProfile: ملف السيولة
        """
        # Get volume data from database
        volume_data = self._get_volume_data(ticker)

        if not volume_data:
            # حتى في حالة فشل بيانات الحجم، نجرب نقرأ الـ free float
            # عشان الـ warning يظهر حتى لو السيولة مش متاحة
            ff_pct, ff_shares = self._get_free_float(ticker)
            # RELAX-CLOSED-MARKET-001: لما السوق مقفول، لا نرفض السهم تماماً
            # لمجرد عدم وجود بيانات حجم. نسمح بتحليله بناءً على السعر الحالي
            # والتحليل الفني. السهم يبقى "ضعيف السيولة" بس مش EXCLUDED.
            _market_open = _is_egx_market_open()
            if not _market_open:
                profile = LiquidityProfile(
                    ticker=ticker,
                    avg_daily_volume=0,
                    avg_daily_turnover=0,
                    volume_20d=0,
                    turnover_20d=0,
                    level=LiquidityLevel.WEAK,
                    is_tradeable=True,  # اسمح بالتحليل (السوق مقفول)
                    warning='لا توجد بيانات حجم — السوق مقفول، التحليل مبني على السعر الحالي',
                    free_float_percentage=ff_pct,
                    free_float_shares=ff_shares,
                    liquidity_mult=0.6,  # WEAK level mult
                )
                self._apply_free_float_check(profile)
                return profile
            profile = LiquidityProfile(
                ticker=ticker,
                avg_daily_volume=0,
                avg_daily_turnover=0,
                volume_20d=0,
                turnover_20d=0,
                level=LiquidityLevel.EXCLUDED,
                is_tradeable=False,
                warning='لا توجد بيانات حجم',
                free_float_percentage=ff_pct,
                free_float_shares=ff_shares,
                liquidity_mult=0.0,  # EXCLUDED
            )
            self._apply_free_float_check(profile)
            return profile

        avg_volume = volume_data.get('avg_volume', 0)
        avg_turnover = volume_data.get('avg_turnover', 0)
        volume_20d = volume_data.get('volume_20d', 0)
        turnover_20d = volume_data.get('turnover_20d', 0)
        current_price = volume_data.get('current_price', 0)

        # DYNAMIC-SYSTEM-001: اقرأ الإعدادات من الـ Admin (لو متاحة)
        # كل threshold دلوقتي admin-configurable via /api/admin/engine-settings
        _min_price_setting = get_setting('min_stock_price', default=self.MIN_STOCK_PRICE)
        _min_volume_setting = get_setting('min_volume_shares', default=self.MIN_VOLUME)
        _min_turnover_setting = get_setting('min_turnover_egp', default=self.MIN_TURNOVER)

        # RELAX-CLOSED-MARKET-001: لما السوق مقفول، نرخّف الفلاتر لـ 50% من القيمة
        _market_open = _is_egx_market_open()
        if not _market_open:
            _min_volume = _min_volume_setting * 0.5
            _min_turnover = _min_turnover_setting * 0.2  # 20% من الحد الأصلي
        else:
            _min_volume = _min_volume_setting
            _min_turnover = _min_turnover_setting

        # DYNAMIC-SYSTEM-001: سياق السهم الديناميكي (متوسطات + نسب)
        # ده اللي بيخلّي الفلتر "نسبي" بدل "مطلق". سهم متوسطه 500K لو بيع
        # بـ 400K → سيولة ضعيفة شوية (ننقص درجات). سهم متوسطه 200K لو بيع
        # بـ 150K → سيولة طبيعية تماماً.
        _ctx = get_dynamic_context(ticker) if _DYNAMIC_AVAILABLE else None
        _has_baseline = (
            _ctx is not None
            and _ctx.has_history
            and _ctx.avg_turnover_baseline > 0
        )

        # Determine level
        level = self._classify_level(avg_volume, avg_turnover)

        # Check if tradeable
        is_tradeable = True
        warning = None

        # ========== PENNY STOCK CHECK ==========
        # MUST check price BEFORE liquidity — penny stocks rejected always
        if current_price > 0 and current_price < _min_price_setting:
            is_tradeable = False
            level = LiquidityLevel.EXCLUDED
            warning = f'⚠️ سهم قرش (سعر {current_price:.2f} جنيه < {_min_price_setting}) - مرفوض للتلاعب المحتمل وسيولة ضعيفة'
        elif _has_baseline:
            # DYNAMIC-SYSTEM-001: فلتر سيولة نسبي — نسبة من متوسط السهم نفسه
            # لو current_turnover < avg_baseline * liquidity_dead_ratio → رفض تام
            # لو < avg_baseline * liquidity_ratio_threshold → عقاب (بس نسمح بالتحليل)
            _dead_ratio = get_setting('liquidity_dead_ratio', default=0.1)
            _weak_ratio = get_setting('liquidity_ratio_threshold', default=0.5)
            if _ctx.turnover_ratio < _dead_ratio:
                is_tradeable = False
                warning = (
                    f'🚨 سيولة ميتة — {ctx_turnover_display(_ctx)} '
                    f'(نسبة {(_ctx.turnover_ratio*100):.0f}% من المتوسط < {_dead_ratio*100:.0f}%)'
                )
            elif _ctx.turnover_ratio < _weak_ratio:
                # سيولة ضعيفة — نسمح بالتحليل بس نحذّر (العقاب بيحصل في الـ scoring)
                warning = (
                    f'⚠️ سيولة ضعيفة — {ctx_turnover_display(_ctx)} '
                    f'(نسبة {(_ctx.turnover_ratio*100):.0f}% من المتوسط)'
                )
        elif avg_volume < _min_volume:
            is_tradeable = False
            warning = f'الحجم أقل من {_min_volume:,.0f} سهم — لا يمكن التحليل الموثوق'
        elif avg_turnover < _min_turnover:
            # 🔥 MOMENTUM LIQUIDITY BYPASS (P14 — أغسطس 2026)
            # لو السهم عنده سيولة طارئة (turnover_ratio >= 1.5 = أعلى من المتوسط)،
            # السيولة الحالية أهم من المتوسط التاريخي. نتخطى شرط الـ 3M جنيه.
            _momentum_surge = (
                _has_baseline and _ctx.turnover_ratio >= 1.5
            )
            # P24-DYNAMIC-LIQUIDITY (Aug 2026): حد ديناميكي بدل الثابت.
            # لو volume_spike_ratio > 2.5 → نقبل السيولة لو فوق 300K.
            # لو السوق ميت → نرفع لـ 700K. غير كده → الثابت (3M).
            _dyn_vol_spike = float(_ctx.turnover_ratio) if _has_baseline else 1.0
            _dyn_min_turnover = dynamic_min_turnover(
                ticker=ticker,
                volume_spike_ratio=_dyn_vol_spike,
                base_min_turnover=_min_turnover,
            )
            if _market_open and not _momentum_surge and avg_turnover < _dyn_min_turnover:
                is_tradeable = False
                warning = (f'🚨 سيولة ضعيفة — معدل الدوران {avg_turnover:,.0f} جنيه < '
                           f'{_dyn_min_turnover:,.0f} (حد ديناميكي: '
                           f'{"spike→300K" if _dyn_min_turnover == 300_000 else "سوق ميت→700K" if _dyn_min_turnover == 700_000 else "أساسي"}). '
                           f'سهم ميت لا يستحق التحليل')
            elif _market_open and (_momentum_surge or avg_turnover >= _dyn_min_turnover):
                # سيولة طارئة أو فوق الحد الديناميكي — نسمح بالتحليل
                warning = (
                    f'🔥 سيولة طارئة — {ctx_turnover_display(_ctx)} '
                    f'(نسبة {(_ctx.turnover_ratio*100):.0f}% من المتوسط ≥ 150% → تجاوز حد الـ {_min_turnover:,.0f} جنيه)'
                )
            else:
                # RELAX-CLOSED-MARKET-001: السوق مقفول → نرخّف ونسمح بالتحليل
                warning = f'⚠️ سيولة ضعيفة ({avg_turnover:,.0f} جنيه) — السوق مقفول، التحليل مبني على المتوسط التاريخي'

        # معامل السيولة الابتدائي من المستوى (level-based)
        liquidity_mult = self.get_liquidity_multiplier(level)

        # FREE-FLOAT-023: اقرأ نسبة الأسهم الحرة من الـ DB
        ff_pct, ff_shares = self._get_free_float(ticker)

        profile = LiquidityProfile(
            ticker=ticker,
            avg_daily_volume=avg_volume,
            avg_daily_turnover=avg_turnover,
            volume_20d=volume_20d,
            turnover_20d=turnover_20d,
            level=level,
            is_tradeable=is_tradeable,
            warning=warning,
            free_float_percentage=ff_pct,
            free_float_shares=ff_shares,
            liquidity_mult=liquidity_mult,
        )

        # طبّق فحص الأسهم الحرة (يعدّل liquidity_mult + يضيف free_float_warning)
        self._apply_free_float_check(profile)

        # V40: Kill Filters — فلاتر استبعاد إجبارية قبل أي تحليل
        # بتشتغل بس لما الـ caller يمرر بيانات (closes/volumes/benchmark/roc/bars).
        # لو مفيش بيانات ممررة → الـ callers القدام بيشغلوا زي ما هي (backward compatible).
        if closes is not None or volumes is not None or benchmark_change != 0 or stock_roc != 0 or data_bars_count > 0:
            # لو volumes مش متمررة، استخدم بيانات volume_data المتاحة (volume_20d)
            _volumes_for_kill = volumes
            if not _volumes_for_kill and volume_data:
                _vol_20d = volume_data.get('volume_20d', 0)
                _volumes_for_kill = [_vol_20d] if _vol_20d and _vol_20d > 0 else None
            _kill = evaluate_kill_filters(
                ticker=ticker,
                closes=closes,
                volumes=_volumes_for_kill,
                current_price=current_price,
                avg_turnover=avg_turnover,
                benchmark_change=benchmark_change,
                stock_roc=stock_roc,
                data_bars_count=data_bars_count or (len(closes) if closes else 0),
            )
            profile.kill_filter_result = _kill
            if not _kill['passed']:
                profile.is_tradeable = False
                profile.level = LiquidityLevel.EXCLUDED
                profile.warning = ' | '.join(_kill['kill_reasons'])
                profile.liquidity_mult = 0.0

        return profile

    # ====================================================================
    # FREE-FLOAT-023: Free Float Helpers
    # ====================================================================

    def _get_free_float(self, ticker: str) -> Tuple[Optional[float], Optional[int]]:
        """
        قراءة free_float_percentage و free_float_shares من جدول stocks.
        آمن لـ migration: لو الأعمدة مش موجودة بعد، يرجّع (None, None)
        بدون كسر الـ analyze().
        """
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            # PRAGMA عشان نتأكد إن الأعمدة موجودة قبل الـ SELECT
            cursor.execute("PRAGMA table_info(stocks)")
            col_names = {row[1] for row in cursor.fetchall()}
            if 'free_float_percentage' not in col_names or 'free_float_shares' not in col_names:
                conn.close()
                return None, None
            cursor.execute(
                "SELECT free_float_percentage, free_float_shares "
                "FROM stocks WHERE ticker = ?",
                (ticker,),
            )
            row = cursor.fetchone()
            conn.close()
            if not row:
                return None, None
            pct_raw, shares_raw = row[0], row[1]
            # 0 من الـ DB يُعتبر "غير معروف" (لا تحذر) — متوافق مع المتطلبات
            pct = float(pct_raw) if (pct_raw is not None and pct_raw > 0) else None
            shares = int(shares_raw) if (shares_raw is not None and shares_raw > 0) else None
            return pct, shares
        except sqlite3.Error:
            return None, None
        except Exception:
            return None, None

    def _apply_free_float_check(self, profile: LiquidityProfile) -> None:
        """
        فحص الأسهم الحرة وتعديل liquidity_mult + free_float_warning.
        - لو free_float_percentage IS NULL أو = 0 → تجاهل (لا تحذر)
        - لو < critical (5%) → 🚨 خطير جداً (mult=0.2)
        - لو < risky (15%) → ⚠️ مخاطرة عالية (mult=0.5)
        يعدّل الـ profile في-place.

        DYNAMIC-SYSTEM-001: العتبات دلوقتي admin-configurable via engine_settings.
        """
        pct = profile.free_float_percentage
        # تجاهل لو NULL أو 0 (مطلوب صراحةً في FREE-FLOAT-023)
        if pct is None or pct <= 0:
            return

        # DYNAMIC-SYSTEM-001: اقرأ العتبات من الـ Admin settings
        critical_pct = get_setting('free_float_critical_pct', default=self.FREE_FLOAT_CRITICAL)
        risky_pct = get_setting('free_float_risky_pct', default=self.FREE_FLOAT_RISKY)
        critical_mult = get_setting('free_float_critical_mult', default=self.FREE_FLOAT_CRITICAL_MULT)
        risky_mult = get_setting('free_float_risky_mult', default=self.FREE_FLOAT_RISKY_MULT)

        if pct < critical_pct:
            # خطير جداً — استخدم الأقل بين معامل المستوى و critical_mult
            profile.free_float_warning = (
                f"🚨 أسهم حرة حرجة جداً - تجنب التداول "
                f"(free float = {pct:.1f}% < {critical_pct:.0f}%)"
            )
            profile.liquidity_mult = min(profile.liquidity_mult, critical_mult)
        elif pct < risky_pct:
            # مخاطرة عالية — استخدم الأقل بين معامل المستوى و risky_mult
            profile.free_float_warning = (
                f"⚠️ أسهم حرة قليلة - مخاطرة عالية "
                f"(free float = {pct:.1f}% < {risky_pct:.0f}%)"
            )
            profile.liquidity_mult = min(profile.liquidity_mult, risky_mult)
        # لو pct >= risky_pct → لا تحذر، liquidity_mult يفضل زي ما هو
    
    def _get_volume_data(self, ticker: str) -> Optional[Dict]:
        """جلب بيانات الحجم والسعر من قاعدة البيانات"""
        # 1. Get current price from stocks table
        current_price = 0.0
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            cursor.execute('SELECT current_price FROM stocks WHERE ticker = ?', (ticker,))
            result = cursor.fetchone()
            if result and result[0]:
                current_price = float(result[0])
            conn.close()
        except:
            pass

        # 2. Get 30-day average volume and turnover from price_history.db
        try:
            from pathlib import Path
            price_history_db = str(Path(self.db_path).parent / 'price_history.db')
            if Path(price_history_db).exists():
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.get_connection(price_history_db, writable=False)
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT AVG(volume), AVG(volume * close_price)
                    FROM price_history
                    WHERE ticker = ?
                    AND date >= date('now', '-30 days')
                ''', (ticker,))
                result = cursor.fetchone()
                conn.close()
                
                if result and result[0] and result[0] > 0:
                    avg_volume = float(result[0] or 0)
                    avg_turnover = float(result[1] or 0)
                    # If current_price wasn't found, try to use the last close_price from history
                    if current_price <= 0:
                        try:
                            # Phase 7.1: migrated to db_manager (writable=False)
                            from core.db_manager import db_manager
                            conn = db_manager.get_connection(price_history_db, writable=False)
                            cursor = conn.cursor()
                            cursor.execute('SELECT close_price FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1', (ticker,))
                            res_price = cursor.fetchone()
                            if res_price and res_price[0]:
                                current_price = float(res_price[0])
                            conn.close()
                        except:
                            pass
                    
                    return {
                        'avg_volume': avg_volume,
                        'avg_turnover': avg_turnover,
                        'volume_20d': avg_volume,
                        'turnover_20d': avg_turnover,
                        'current_price': current_price
                    }
        except:
            pass

        # Fallback to single-day volume from stocks table if price_history has no records
        # MARKET-REALITY-SLAP-027: جدول stocks بيخزن الحجم كـ string ("2.28 M").
        # بنستخدم _parse_volume_string عشان نحول الـ K/M/B suffixes لرقم.
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            cursor.execute('SELECT volume, current_price FROM stocks WHERE ticker = ?', (ticker,))
            result = cursor.fetchone()
            conn.close()

            if result and result[0]:
                volume = _parse_volume_string(result[0])
                if volume > 0:
                    price = _parse_volume_string(result[1]) if current_price <= 0 else current_price
                    if price <= 0:
                        price = _parse_volume_string(result[1])
                    turnover = volume * price if price > 0 else volume * 100
                    return {
                        'avg_volume': volume,
                        'avg_turnover': turnover,
                        'volume_20d': volume,
                        'turnover_20d': turnover,
                        'current_price': price
                    }
        except:
            pass

        return None
    
    def _classify_level(self, avg_volume: float, avg_turnover: float) -> LiquidityLevel:
        """تحديد مستوى السيولة"""
        if avg_volume < self.MIN_VOLUME or avg_turnover < self.MIN_TURNOVER:
            return LiquidityLevel.EXCLUDED
        elif avg_volume < 300_000:
            return LiquidityLevel.WEAK
        elif avg_volume < 1_000_000:
            return LiquidityLevel.MODERATE
        elif avg_volume < 5_000_000:
            return LiquidityLevel.LIQUID
        else:
            return LiquidityLevel.HIGH_LIQUIDITY
    
    def filter_stocks(self, tickers: List[str]) -> Tuple[List[str], List[Dict]]:
        """
        فلترة قائمة أسهم وإرجاع الأسهم المتاحة للتداول
        
        Args:
            tickers: قائمة الرموز
            
        Returns:
            Tuple: (tradeable_tickers, excluded_profiles)
        """
        tradeable = []
        excluded = []
        
        for ticker in tickers:
            profile = self.analyze(ticker)
            if profile.is_tradeable:
                tradeable.append(ticker)
            else:
                excluded.append(profile.to_dict())
        
        return tradeable, excluded
    
    def get_liquidity_multiplier(self, level: LiquidityLevel) -> float:
        """
        معامل السيولة لتعديل الثقة
        
        المستويات العالية = ثقة أعلى
        المستويات المنخفضة = ثقة أقل
        """
        multipliers = {
            LiquidityLevel.EXCLUDED: 0.0,
            LiquidityLevel.WEAK: 0.6,
            LiquidityLevel.MODERATE: 0.8,
            LiquidityLevel.LIQUID: 1.0,
            LiquidityLevel.HIGH_LIQUIDITY: 1.1,
        }
        return multipliers.get(level, 0.5)


def check_liquidity_first(ticker: str, db_path: str) -> Tuple[bool, Optional[LiquidityProfile]]:
    """
    دالة مساعدة للتحقق من السيولة قبل أي تحليل
    
    Usage:
        is_tradeable, profile = check_liquidity_first('COMI', db_path)
        if not is_tradeable:
            return {'signal': 'EXCLUDED', 'reason': profile.warning}
    """
    filter = LiquidityFilter(db_path)
    profile = filter.analyze(ticker)
    return profile.is_tradeable, profile
