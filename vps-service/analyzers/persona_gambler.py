"""
Persona Gambler - المغامر (قصر المدى)
@version 1.0.0

منطق المغامر:
- change_1d, change_1w (حركة السعر السريعة)
- volume spike (انفجار السيولة)
- breakout (اختراق مقاومة)
- sector hot (القطاع نار)
- RSI extremes (تشبع بيعي/شرائي)

القرارات: "شراء قوي" / "شراء" / "انتظر" / "بيع" / "بيع قوي" / "ابعد"
النصوص بالعربى العامى.
"""

from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
import sqlite3
from pathlib import Path

from analyzers.support_resistance_calculator import calculate_support_resistance

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


@dataclass
class GamblerResult:
    verdict: str  # "شراء قوي" / "شراء" / "انتظر" / "بيع" / "بيع قوي" / "ابعد"
    score: float  # 0-100
    reason: str  # شرح بالعربى العامي
    signal: str  # BUY / SELL / HOLD
    entry: Optional[float] = None
    target: Optional[float] = None
    stop: Optional[float] = None
    conditions: List[str] = field(default_factory=list)
    # 🧠 S/R info (so frontend can display real levels, not empty percentages)
    support: Optional[float] = None
    resistance: Optional[float] = None
    zone: Optional[str] = None
    rr: Optional[float] = None
    # 🎯 نظام مستويات الوقف المتحرك (Trailing Stop Levels)
    # ملاحظة: في EGX معظم الـ brokers مش بيدعموا البيع الجزئي
    # عشان كده الأهداف دي = مستويات لتحريك الوقف، مش أوامر بيع
    target_1: float = 0.0  # المستوى الأول — لو وصلته: نقل الوقف لـ breakeven
    target_2: float = 0.0  # المستوى التاني — لو وصلته: نقل الوقف لـ target_1
    target_3: float = 0.0  # المستوى التالت — خليه يركض مع trailing stop
    target_1_pct: float = 0.0  # نسبة المستوى الأول من الدخول
    target_2_pct: float = 0.0  # نسبة المستوى التاني من الدخول
    target_3_pct: float = 0.0  # نسبة المستوى التالت من الدخول
    # 🛑 مستويات الوقف المرتبطة بكل target
    stop_level_1: float = 0.0  # وقف breakeven (ينشط لو وصل target_1)
    stop_level_2: float = 0.0  # وقف عند target_1 (ينشط لو وصل target_2)
    stop_level_3: float = 0.0  # وقف trailing عند target_2 (ينشط لو وصل target_3)
    trailing_stop: float = 0.0  # سعر الوقف الأولي
    trailing_stop_logic: str = ''  # شرح عربي لمنطق تحريك الوقف
    stop_triggers_ar: str = ''  # شرح كامل بالعربي لخطوات تحريك الوقف (للواجهة)
    # 📊 تفاصيل النتيجة
    regime_note: str = ''  # ملاحظة عن تعديل الأهداف حسب وضع السوق
    is_fallback: bool = False  # هل الأهداف من S/R حقيقية ولا تقديرية
    score_breakdown: Dict = field(default_factory=dict)  # تفصيل كل عامل في النتيجة


def _clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, v))


# 🧠 الخبير v3: حساب high_52w, low_52w, avg_volume من price_history
# لأن الـ stocks table مفيهاش الأعمدة دي
_price_cache: Dict[str, list] = {}


def _load_price_history(ticker: str) -> list:
    """حمّل آخر 260 يوم من price_history للسهم (مع cache)."""
    if ticker in _price_cache:
        return _price_cache[ticker]
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('''
            SELECT date, high_price, low_price, close_price, volume
            FROM stock_price_history
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT 260
        ''', (ticker,))
        rows = cur.fetchall()
        conn.close()
        _price_cache[ticker] = [dict(r) for r in rows]
        return _price_cache[ticker]
    except Exception:
        _price_cache[ticker] = []
        return []


def _compute_52w(ticker: str) -> tuple:
    """حساب high_52w و low_52w من آخر 252 يوم."""
    rows = _load_price_history(ticker)
    if not rows:
        return 0.0, 0.0
    highs = [r['high_price'] for r in rows if r.get('high_price') and r['high_price'] > 0]
    lows = [r['low_price'] for r in rows if r.get('low_price') and r['low_price'] > 0]
    return (max(highs) if highs else 0.0, min(lows) if lows else 0.0)


def _compute_avg_volume(ticker: str, days: int = 30) -> float:
    """متوسط حجم التداول آخر 30 يوم."""
    rows = _load_price_history(ticker)
    if not rows:
        return 0.0
    vols = [r.get('volume') or 0 for r in rows[:days]]
    vols = [v for v in vols if v > 0]
    return sum(vols) / len(vols) if vols else 0.0


def analyze_gambler(
    ticker: str,
    stock: Dict[str, Any],
    context: Dict[str, Any],
    master_score_v13: float = 0.0,  # Phase 8.1: Score from V13 Quant Engine
) -> GamblerResult:
    """
    تحليل المغامر للسهم.
    stock: بيانات من stocks.db (current_price, change_percent, volume, rsi, support_level, resistance_level)
    context: MaestroHumanContext كـ dict

    🧠 الخبير v3: high_52w, low_52w, avg_volume بيتحسبوا من price_history
    لأن الـ stocks table مفيهاش الأعمدة دي.

    context keys:
      - screener_most_active (bool): السهم في قائمة الأكثر نشاطاً → يخفف min_rr من 1.2 → 1.0

    FREE-FLOAT-023: لو free_float_percentage < 15% → نحوّل الإشارة لـ HOLD
    مع reason = "أسهم حرة قليلة - مخاطرة التلاعب بالسعر".
    ده بيحمي المضارب من الأسهم اللي بتتلاعب بسهولة بسبب قلة الأسهم الحرة.
    لو free_float_percentage IS NULL أو = 0 → نتجاهل (لا نحذر).
    """
    conditions: List[str] = []
    score = 0.0
    score_breakdown: Dict[str, float] = {}  # تفصيل كل عامل في النتيجة

    current_price = float(stock.get('current_price') or 0)
    if current_price <= 0:
        return GamblerResult(
            verdict='ابعد', score=0, reason='مفيش سعر متاح للسهم.',
            signal='HOLD', conditions=['السعر غير متاح'],
        )

    # ========== FREE-FLOAT-023: حماية المضارب من الأسهم الحرة القليلة ==========
    # لو الأسهم الحرة قليلة جداً (< 15%) → تحويل الإشارة لـ HOLD فوراً
    # لأن الأسهم دي بتتلاعب بسهولة والمضارب هيتضرر.
    # لو free_float_percentage IS NULL أو = 0 → نتجاهل (لا نحذر).
    try:
        ff_raw = stock.get('free_float_percentage')
        ff_pct = float(ff_raw) if (ff_raw is not None and float(ff_raw) > 0) else None
    except (TypeError, ValueError):
        ff_pct = None

    if ff_pct is not None and ff_pct < 15.0:
        _ff_emoji = '🚨' if ff_pct < 5.0 else '⚠️'
        _ff_note = (
            f"أسهم حرة حرجة جداً ({ff_pct:.1f}% < 5%) - تجنب التداول"
            if ff_pct < 5.0
            else f"أسهم حرة قليلة ({ff_pct:.1f}% < 15%) - مخاطرة عالية"
        )
        return GamblerResult(
            verdict='انتظر',
            score=0,
            reason=f"{_ff_emoji} أسهم حرة قليلة - مخاطرة التلاعب بالسعر ({_ff_note})",
            signal='HOLD',
            conditions=[f'free_float={ff_pct:.1f}%'],
        )

    change_1d = float(stock.get('change_percent') or 0)
    volume = stock.get('volume') or 0
    # تحويل volume لو نص (مثل "1.37 M")
    if isinstance(volume, str):
        try:
            v_clean = volume.replace(' ', '').replace('\u202f', '').upper()
            if v_clean.endswith('M'):
                volume = float(v_clean[:-1]) * 1_000_000
            elif v_clean.endswith('K'):
                volume = float(v_clean[:-1]) * 1_000
            elif v_clean.endswith('B'):
                volume = float(v_clean[:-1]) * 1_000_000_000
            else:
                volume = float(v_clean)
        except (ValueError, TypeError):
            volume = 0
    volume = float(volume or 0)

    # 🧠 الخبير v3: support/resistance بأسماء الأعمدة الصح + fallback
    rsi = float(stock.get('rsi') or 0)
    support = float(stock.get('support_level') or stock.get('support') or 0)
    resistance = float(stock.get('resistance_level') or stock.get('resistance') or 0)

    # 🧠 الخبير v3: high_52w, low_52w, avg_volume من price_history
    high_52w, low_52w = _compute_52w(ticker)
    avg_volume = float(stock.get('avg_volume') or 0)
    if avg_volume <= 0:
        avg_volume = _compute_avg_volume(ticker, 30)

    # من context
    tc = context.get('time_context', {}) or {}
    sc = context.get('sector_context', {}) or {}
    bc = context.get('behavioral_context', {}) or {}
    mc = context.get('market_context', {}) or {}

    change_1w = tc.get('change_1w')
    change_1m = tc.get('change_1m')
    stock_perf_1w = sc.get('stock_perf_1w')
    market_regime = mc.get('regime', 'SIDEWAYS')
    vol_ratio = bc.get('volume_ratio') or (volume / avg_volume if avg_volume > 0 else 1.0)

    # ========== 1. حجم السيولة (أهم عامل للمغامر) ==========
    if vol_ratio >= 2.0:
        score += 30
        conditions.append(f'السيولة ولعت ({vol_ratio:.1f}x المتوسط) 🔥')
        score_breakdown['volume_spike'] = 30
    elif vol_ratio >= 1.5:
        score += 22
        conditions.append(f'سيولة مرتفعة ({vol_ratio:.1f}x)')
        score_breakdown['volume_spike'] = 22
    elif vol_ratio >= 1.0:
        score += 10
        conditions.append(f'سيولة عادية ({vol_ratio:.1f}x)')
        score_breakdown['volume_spike'] = 10
    elif vol_ratio > 0 and vol_ratio < 0.5:
        score -= 15
        conditions.append(f'السيولة ميتة ({vol_ratio:.1f}x) 💀')
        score_breakdown['volume_spike'] = -15

    # ========== 2. حركة اليوم (change_1d) ==========
    if change_1d > 5:
        score += 20
        conditions.append(f'السهم طالع {change_1d:.1f}% النهاردة 🚀')
        score_breakdown['price_change_1d'] = 20
    elif change_1d > 2:
        score += 12
        conditions.append(f'طلوع كويس {change_1d:.1f}%')
        score_breakdown['price_change_1d'] = 12
    elif change_1d < -5:
        # المغامر بيحب الانخفاض الحاد لو فيه ارتداد
        score += 10
        conditions.append(f'السهم اتهبد {abs(change_1d):.1f}% — ممكن يرتد')
        score_breakdown['price_change_1d'] = 10
    elif change_1d < -2:
        score += 5
        conditions.append(f'السهم نازل {abs(change_1d):.1f}%')
        score_breakdown['price_change_1d'] = 5

    # ========== 3. حركة الأسبوع (change_1w) ==========
    if change_1w is not None:
        if change_1w > 10:
            score += 18
            conditions.append(f'زخم أسبوعي قوي +{change_1w:.1f}%')
            score_breakdown['price_change_1w'] = 18
        elif change_1w > 5:
            score += 10
            conditions.append(f'الأسبوع طالع {change_1w:.1f}%')
            score_breakdown['price_change_1w'] = 10
        elif change_1w < -10:
            score += 8
            conditions.append(f'نزول أسبوعي {abs(change_1w):.1f}% — فرصة ارتداد')
            score_breakdown['price_change_1w'] = 8

    # ========== 4. RSI (تشبع بيعي = فرصة للمغامر) ==========
    if rsi > 0:
        if rsi < 30:
            score += 25
            conditions.append(f'RSI {rsi:.0f} — تشبع بيعي حاد، السهم ناضي')
            score_breakdown['rsi'] = 25
        elif rsi < 40:
            score += 12
            conditions.append(f'RSI {rsi:.0f} — قرب التشبع البيعي')
            score_breakdown['rsi'] = 12
        elif rsi > 80:
            score -= 15
            conditions.append(f'RSI {rsi:.0f} — تشبع شرائي، السهم هينزل')
            score_breakdown['rsi'] = -15
        elif rsi > 70:
            score -= 8
            conditions.append(f'RSI {rsi:.0f} — قرب التشبع الشرائي')
            score_breakdown['rsi'] = -8

    # ========== 5. اختراق المقاومة (breakout) ==========
    # حماية: المقاومة لازم تكون قريبة من السعر (ضمن نطاق 30%)
    if resistance > 0 and current_price > resistance and resistance >= current_price * 0.7:
        score += 20
        conditions.append(f'كسر المقاومة ({resistance:.2f}) — breakout! ✅')
        score_breakdown['breakout'] = 20
    elif resistance > 0 and current_price > resistance * 0.98 and resistance >= current_price * 0.7:
        score += 10
        conditions.append(f'قرب المقاومة ({resistance:.2f}) — ممكن يكسر')
        score_breakdown['breakout'] = 10

    # ========== 6. القطاع نار؟ ==========
    if stock_perf_1w is not None:
        if stock_perf_1w > 5:
            score += 12
            conditions.append(f'القطاع ولع (+{stock_perf_1w:.1f}% أسبوعياً) 🔥')
            score_breakdown['sector_hot'] = 12
        elif stock_perf_1w < -5:
            score -= 8
            conditions.append(f'القطاع نازل ({stock_perf_1w:.1f}%) — رياح عكسية')
            score_breakdown['sector_hot'] = -8

    # ========== 7. وضع السوق ==========
    if market_regime == 'BULL':
        score += 8
        conditions.append('السوق في حالة صعود — رياح مواتية')
        score_breakdown['market_regime'] = 8
    elif market_regime == 'BEAR':
        score -= 10
        conditions.append('السوق نازل — رياح عكسية')
        score_breakdown['market_regime'] = -10

    # ========== 8. قرب القاع السنوي (للمغامر ده فرصة) ==========
    if high_52w > 0 and low_52w > 0:
        distance_from_low = ((current_price - low_52w) / low_52w) * 100 if low_52w > 0 else 0
        if 0 < distance_from_low < 10:
            score += 15
            conditions.append(f'على القاع السنوي ({distance_from_low:.1f}% من القاع)')
            score_breakdown['near_52w_low'] = 15

    score = _clamp(score)

    # ========== القرار النهائي ==========
    # 🧠 الخبير v7 (يوليو 2026): الـ verdict والـ reason بيتحددوا بعد ما S/R + R/R gates تخلص
    # عشان مفيش تناقض بين "شراء" و "محتاج تأكيد" أو "بيع فوري"

    # 1. signal أولي من الـ score (بدون verdict/reason)
    has_strong_signal = (
        vol_ratio >= 1.3
        or (rsi > 0 and rsi < 40)
        or abs(change_1d) >= 4
        or (change_1w is not None and abs(change_1w) >= 6)
        or (resistance > 0 and current_price > resistance and current_price < resistance * 1.05)
    )

    # Phase 8.1: V13 Engine blend
    if master_score_v13 > 0:
        score = (master_score_v13 * 0.60) + (score * 0.40)
        score_breakdown['v13_quant'] = master_score_v13

    if score >= 50:
        signal = 'BUY'
        entry = round(current_price, 2)
    elif score >= 20:
        signal = 'BUY'
        entry = round(current_price, 2)
    elif score >= 15 and has_strong_signal:
        signal = 'BUY'
        entry = round(current_price, 2)
    elif score >= 10 and has_strong_signal:
        signal = 'HOLD'
        entry = None
        target = None
        stop = None
    else:
        signal = 'HOLD'
        entry = None
        target = None
        stop = None

    # ========== 🧠 الخبير v4: S/R-based target/stop + R/R gating ==========
    # المستخدم اكتشف إن الـ percentage targets (+4%/-8%) فاضية — مش مستويات سعر حقيقية.
    # بدّلناها بـ: target = المقاومة الحقيقية، stop = تحت الدعم الحقيقي،
    # مع Risk/Reward gate >= 1.5:1.
    # مراجعة (يوليو 2026): fallback تدريجي بدل ما نرجّع "انتظر" بشكل أعمى
    # كان بيطلب is_fresh + 90 يوم → كتير من الأسهم كانت بترجع "مفيش بيانات S/R"
    sr = None
    for _days in (90, 60, 30, 20):
        sr = calculate_support_resistance(ticker, days=_days)
        if sr and sr.get('is_fresh'):
            break
    # لو لسه مفيش S/R fresh، جرّب آخر واحد متاح (حتى لو مش fresh)
    if not sr or not sr.get('is_fresh'):
        for _days in (90, 60, 30):
            sr = calculate_support_resistance(ticker, days=_days)
            if sr:
                break
    sr_support: Optional[float] = None
    sr_resistance: Optional[float] = None
    sr_zone: Optional[str] = None
    sr_rr: Optional[float] = None
    is_fallback = False  # هل بنستخدم S/R تقديرية ولا حقيقية

    if not sr:
        # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
        # Previously fabricated sr_support=current_price*0.95 and
        # sr_resistance=current_price*1.08 as "تقديري" (estimated) values.
        # Now: leave sr_support/sr_resistance as None — the downstream BUY
        # logic returns HOLD when target/stop are None (cannot compute a
        # real R/R without real S/R levels). The is_fallback flag is still
        # set to True so callers know S/R was unavailable.
        if current_price and current_price > 0:
            sr_support = None
            sr_resistance = None
            sr_zone = None
            is_fallback = True  # S/R unavailable — caller should treat as HOLD
            # كمّل التحليل: downstream will return HOLD due to None S/R.
        else:
            return GamblerResult(
                verdict='انتظر', score=round(score, 1),
                reason='مفيش بيانات سعر كافية للمضارب',
                signal='HOLD', conditions=conditions + ['لا يوجد سعر'],
                score_breakdown=score_breakdown,
            )
    else:
        sr_support = sr['support']
        sr_resistance = sr['resistance']
        sr_zone = sr['zone']

    # Breakdown zone = بيع قوي (السهم كسر كل الدعوم)
    if sr and sr.get('zone') == 'breakdown':
        return GamblerResult(
            verdict='بيع قوي', score=round(score, 1),
            reason='السهم كسر كل الدعوم — بيع فوري',
            signal='SELL', conditions=conditions + ['zone=breakdown'],
            support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
        )

    # مراجعة (يوليو 2026): guard لو sr None (احنا استخدمنا fallback values)
    # في الحالة دي، sr_zone = 'middle' و sr_support/sr_resistance معروفين
    _sr_zone = sr['zone'] if sr else (sr_zone or 'middle')
    _sr_support = sr['support'] if sr else sr_support
    _sr_resistance = sr['resistance'] if sr else sr_resistance

    # Middle zone = مفيش دعم/مقاومة قريبة → انتظر
    # مراجعة: لو احنا في fallback mode (sr=None)، نشوف السهم عندنا دعم/مقاومة ولا لأ
    if _sr_zone == 'middle' and sr:
        return GamblerResult(
            verdict='انتظر', score=round(score, 1),
            reason=(f"السهم في منتصف النطاق — مفيش دعم/مقاومة قريبة "
                    f"({sr['distance_to_support_pct']:.1f}% / "
                    f"{sr['distance_to_resistance_pct']:.1f}%)"),
            signal='HOLD', conditions=conditions + ['zone=middle'],
            support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
        )

    # Near resistance = مفيش مجال للصعود → انتظر (مش شراء)
    if _sr_zone == 'near_resistance':
        return GamblerResult(
            verdict='انتظر', score=round(score, 1),
            reason=f"السهم قرب المقاومة ({_sr_resistance}) — مفيش مجال للصعود. استنى اختراق أو تراجع.",
            signal='HOLD', conditions=conditions + ['zone=near_resistance'],
            support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
        )

    # Initialize متغيرات الأهداف (defaults للـ HOLD paths)
    # 🔧 FIX (P0 — Data-Unify followup): _stop_level_* و _stop_triggers_ar
    # كانوا معرّفين فقط داخل `if signal == 'BUY'` block، لكنهم يُستخدموا في
    # الـ GamblerResult النهائي (السطر ~676) في كل المسارات (BUY/SELL/HOLD).
    # لو signal != 'BUY' → UnboundLocalError → Runtime Error 500 وقت الجلسة.
    # الحل: تهيئتهم هنا مع باقي المتغيرات الافتراضية.
    _target_1 = 0.0
    _target_2 = 0.0
    _target_3 = 0.0
    _target_1_pct = 0.0
    _target_2_pct = 0.0
    _target_3_pct = 0.0
    _trailing_stop = 0.0
    _trailing_stop_logic = ''
    _regime_note = ''
    _stop_level_1 = 0.0
    _stop_level_2 = 0.0
    _stop_level_3 = 0.0
    _stop_triggers_ar = ''

    # Calculate target/stop from S/R (zone is near_support or breakout)
    # Task FINALIZE-UNIFICATION (Rule 27 — NO-FAKE-DATA):
    # Previously the fallbacks fabricated target=current_price*1.05 and
    # stop=current_price*0.95 when no real S/R level was available. Now:
    # target/stop are None when no real S/R exists. Downstream R/R filter
    # returns HOLD when target/stop are None (cannot compute a real R/R).
    if signal == 'BUY':
        # Breakout: target = NULL if no real resistance ceiling (was price * 1.05).
        if _sr_zone == 'breakout':
            target = None
            # In breakout, use the last distant support as stop if available.
            stop = round(_sr_support * 0.98, 2) if _sr_support and _sr_support > 0 else None
        else:
            # near_support: target = real resistance, stop = under real support.
            target = round(_sr_resistance, 2) if _sr_resistance else None
            stop = round(_sr_support * 0.98, 2) if _sr_support and _sr_support > 0 else None

        # R/R filter (gambler needs >= 1.5:1)
        # مراجعة (يوليو 2026): خفّضنا من 1.5 → 1.2 عشان نطلّع فرص أكتر
        # Rule 27 (FINALIZE-UNIFICATION): if target/stop are None (no real
        # S/R), we cannot compute a real R/R → return HOLD.
        if target is None or stop is None:
            return GamblerResult(
                verdict='انتظار', score=round(score, 1),
                reason='لا توجد مستويات دعم/مقاومة حقيقية لحساب الهدف/الوقف (Rule 27)',
                signal='HOLD', conditions=conditions + ['no_real_sr'],
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
            )
        risk = current_price - stop
        reward = target - current_price
        if risk <= 0:
            return GamblerResult(
                verdict='ابعد', score=round(score, 1),
                reason='السعر فوق الدعم بمرحلة خطرة',
                signal='HOLD', conditions=conditions + ['risk<=0'],
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
            )

        # 🚨 FIX (يوليو 2026): لو target < entry للشراء = R/R سالب = إشارة فاسدة
        # كان بيرجع "ادخل" بالرغم إن الهدف أقل من الدخول!
        if reward <= 0:
            return GamblerResult(
                verdict='ابعد', score=round(score, 1),
                reason=f'الهدف {target} أقل من سعر الدخول {current_price} — إشارة فاسدة',
                signal='HOLD', conditions=conditions + [f'target<{current_price}'],
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
            )

        rr = reward / risk
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            rr = compute_risk_reward(current_price, target, stop, fallback=rr)
        except Exception:
            pass  # keep inline rr computed above
        sr_rr = round(rr, 2)

        # 🚨 FIX: لو R/R < 1.0 = المخاطرة أكبر من الربح = ابعد فوراً
        if rr < 1.0:
            return GamblerResult(
                verdict='ابعد', score=round(score, 1),
                reason=f"R/R {rr:.2f}:1 — المخاطرة أكبر من الربح. ماتدخلش.",
                signal='HOLD', conditions=conditions + [f'rr={rr:.2f}<1.0'],
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=sr_rr,
            )

        # لو السهم في قائمة الأكثر نشاطاً، نقبل R/R أضعف شوية (سيولة عالية = دخول أسرع)
        _min_rr_soft = 1.0 if context.get('screener_most_active') else 1.2
        if rr < _min_rr_soft:
            return GamblerResult(
                verdict='انتظر', score=round(score, 1),
                reason=f"R/R ضعيف {rr:.2f}:1 — استنى فرصة أحسن",
                signal='HOLD', conditions=conditions + [f'rr={rr:.2f}'],
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=sr_rr,
            )
        # Pass — target & stop already set above
        _s_disp = f"{_sr_support:.2f}" if _sr_support else "N/A"
        _r_disp = f"{_sr_resistance:.2f}" if _sr_resistance else "N/A"
        conditions.append(
            f"S={_s_disp} R={_r_disp} "
            f"zone={_sr_zone} R/R={rr:.2f}:1"
        )

        # ========== 🎯 نظام الأهداف الثلاثة (3-tier targets) ==========
        try:
            _entry = current_price  # entry = current_price
            # target = الهدف الرئيسي الحالي (المقاومة أو +5%)
            _resistance_for_targets = _sr_resistance if (_sr_resistance and _sr_resistance > _entry) else None

            if _resistance_for_targets:
                # عندنا مقاومة حقيقية — نحسب الأهداف نسبة من المسافة ليها
                _gap_to_resistance = (_resistance_for_targets - _entry) / _entry
                t1 = round(_entry * (1 + min(0.03, _gap_to_resistance * 0.3)), 2)
                t2 = round(_entry * (1 + min(0.06, _gap_to_resistance * 0.7)), 2)
                t3 = round(_resistance_for_targets * 0.99, 2)
            else:
                # مفيش مقاومة — أهداف ثابتة
                t1 = round(_entry * 1.03, 2)
                t2 = round(_entry * 1.06, 2)
                t3 = round(_entry * 1.10, 2)

            # ترتيب: لازم target_1 < target_2 < target_3 وكلهم > entry
            targets_raw = sorted([t1, t2, t3])
            _target_1 = max(targets_raw[0], _entry + 0.01)
            _target_2 = max(targets_raw[1], _target_1 + 0.01)
            _target_3 = max(targets_raw[2], _target_2 + 0.01)

            # نسب كل هدف من سعر الدخول
            _target_1_pct = round(((_target_1 - _entry) / _entry) * 100, 2)
            _target_2_pct = round(((_target_2 - _entry) / _entry) * 100, 2)
            _target_3_pct = round(((_target_3 - _entry) / _entry) * 100, 2)
        except Exception:
            _target_1 = round(current_price * 1.03, 2)
            _target_2 = round(current_price * 1.06, 2)
            _target_3 = round(current_price * 1.10, 2)
            _target_1_pct = 3.0
            _target_2_pct = 6.0
            _target_3_pct = 10.0

        # ========== 🛑 حساب مستويات الوقف المرتبطة بكل target ==========
        # (التهيئة الافتراضية تمت مسبقاً في السطر 423-426 — آمن لكل المسارات)
        try:
            _entry = current_price
            # Stop Level 1: Breakeven + حماية 0.5% (ينشط لو وصل target_1)
            _stop_level_1 = round(_entry * 1.005, 2)
            # Stop Level 2: عند target_1 (قفل الربح الأول) — ينشط لو وصل target_2
            _stop_level_2 = round(_target_1, 2)
            # Stop Level 3: عند target_2 (قفل الربح التاني) — ينشط لو وصل target_3
            _stop_level_3 = round(_target_2, 2)

            # شرح عربي كامل للواجهة
            _stop_triggers_ar = (
                f"📍 عند {_target_1} (الهدف الأول): نقل الوقف لـ {_stop_level_1} (breakeven + حماية) — "
                f"بنضمن ماخلشفش | "
                f"📍 عند {_target_2} (الهدف التاني): نقل الوقف لـ {_stop_level_2} (قفل الربح الأول) — "
                f"الحد الأدنى ربح {_target_1_pct:.1f}% | "
                f"📍 عند {_target_3} (الهدف التالت): وقف متحرك عند {_stop_level_3} — "
                f"خلي الفائز يركض، الحد الأدنى ربح {_target_2_pct:.1f}%"
            )
        except Exception:
            pass

        # ========== 🛑 وقف متحرك (trailing stop) ==========
        _trailing_stop = 0.0
        _trailing_stop_logic = ''
        try:
            if sr_support and sr_support > 0:
                # وقف أولي تحت الدعم الحقيقي
                _initial_stop = round(sr_support * 0.99, 2)
            else:
                # مفيش دعم — وقف بناءً على ATR
                rows_hist = _load_price_history(ticker)
                if rows_hist and len(rows_hist) >= 14:
                    highs = [r['high_price'] for r in rows_hist[:14] if r.get('high_price') and r['high_price'] > 0]
                    lows = [r['low_price'] for r in rows_hist[:14] if r.get('low_price') and r['low_price'] > 0]
                    if highs and lows:
                        atr = sum(h - l for h, l in zip(highs, lows)) / len(highs)
                        _initial_stop = round(current_price - 2 * atr, 2)
                    else:
                        # Task FINALIZE-UNIFICATION (Rule 27): no ATR data
                        # → NULL (was current_price * 0.95).
                        _initial_stop = None
                else:
                    # Rule 27: no price history → NULL (was current_price * 0.95).
                    _initial_stop = None

            _trailing_stop = _initial_stop if _initial_stop is not None else None
            # شرح عربي لمنطق تحريك الوقف
            # Rule 27 (FINALIZE-UNIFICATION): if _initial_stop is None
            # (no real S/R + no ATR data), skip the risk-percentage display.
            if _initial_stop is not None:
                _trailing_stop_logic = (
                    f"الوقف الأولي عند {_initial_stop} (تحت الدعم) — مخاطرة {((current_price - _initial_stop) / current_price * 100):.1f}% | "
                    f"① لو وصل {_target_1} (+{_target_1_pct:.1f}%): وقف ← {_stop_level_1} (breakeven) | "
                    f"② لو وصل {_target_2} (+{_target_2_pct:.1f}%): وقف ← {_stop_level_2} (ربح مضمون {_target_1_pct:.1f}%) | "
                    f"③ لو وصل {_target_3} (+{_target_3_pct:.1f}%): وقف ← {_stop_level_3} (خليه يركض)"
                )
            else:
                _trailing_stop_logic = 'الوقف المتحرك — مفيش بيانات S/R أو ATR كافية لحساب دقيق (Rule 27)'
        except Exception:
            # Task FINALIZE-UNIFICATION (Rule 27): was fabricated as
            # current_price * 0.95 — now NULL.
            _trailing_stop = None
            _trailing_stop_logic = 'الوقف المتحرك — مفيش بيانات كافية لحساب دقيق'

        # ========== 📊 تعديل الأهداف حسب وضع السوق (regime-aware) ==========
        _regime_note = ''
        try:
            _regime_lower = (market_regime or '').upper()
            if _regime_lower == 'BEAR' or _regime_lower == 'BEARISH':
                # سوق هابط — محافظ شديد، هدف واحد بس
                _target_2 = _target_1
                _target_3 = _target_1
                _target_2_pct = _target_1_pct
                _target_3_pct = _target_1_pct
                _regime_note = 'سوق هابط — بنستهدف الهدف الأول بس (محافظ شديد)'
            elif _regime_lower == 'BULL' or _regime_lower == 'BULLISH':
                # سوق صاعد — خلي الفائز يركض
                _target_3 = round(_target_3 * 1.20, 2)
                _target_3_pct = round(((_target_3 - current_price) / current_price) * 100, 2)
                _regime_note = 'سوق صاعد — مددنا الهدف التالت 20% عشان الفائز يركض'
            else:
                _regime_note = f'وضع السوق: {market_regime or "SIDEWAYS"} — أهداف عادية'
        except Exception:
            _regime_note = ''

        # حدّث target الرئيسي لـ target_2 (للتوافق مع القديم)
        target = _target_2

    # لو السهم نازل بشدة بدون سيولة = خطر
    if change_1d < -7 and vol_ratio < 0.8:
        signal = 'SELL' if score < 40 else 'HOLD'
        score = _clamp(score - 20)
        return GamblerResult(
            verdict='ابعد', score=round(score, 1),
            reason=f'السهم بينهار ({change_1d:.1f}%) والسيولة ميتة — فخ! ابعد فوراً.',
            signal=signal,
            entry=None, target=None, stop=None,
            conditions=conditions,
            support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=sr_rr,
        )

    # 🧠 الخبير v7: verdict + reason يتبنوا هنا بعد كل gates عشان متناسقين
    # DATA-UNIFY-007: نص verdict داتا-درايڤن بدل الجمل الوهمية الثابتة.
    # قبل: كان بيتقال 'السيولة ولعت' بغض النظر عن vol_ratio الفعلي.
    # الآن: النص بيتولّد من vol_ratio و score و rr المتاحة فعلياً.
    def _liq_phrase_g():
        if vol_ratio >= 2.0:
            return f'السيولة ولعت ({vol_ratio:.1f}x) 🔥'
        if vol_ratio >= 1.5:
            return f'سيولة مرتفعة ({vol_ratio:.1f}x)'
        if vol_ratio >= 1.0:
            return f'سيولة عادية ({vol_ratio:.1f}x)'
        if vol_ratio > 0:
            return f'سيولة ضعيفة ({vol_ratio:.1f}x)'
        return 'السيولة غير مُقيّمة'

    _g_liq = _liq_phrase_g()
    if signal == 'BUY':
        if score >= 50 and rr and rr >= 2.0:
            verdict = 'شراء قوي'
            _base_reason = f'{_g_liq} والحركة قوية — نتيجة {score:.0f} و R/R {rr:.2f}:1 — فرصة مغامرة حقيقية.'
        elif score >= 50:
            verdict = 'شراء'
            _base_reason = f'{_g_liq} — نتيجة {score:.0f} و R/R {rr:.2f}:1.'
        elif score >= 20:
            verdict = 'شراء'
            _base_reason = f'{_g_liq} — نتيجة {score:.0f} و R/R {rr:.2f}:1.'
        elif score >= 15 and has_strong_signal:
            verdict = 'شراء'
            _base_reason = f'إشارات قوية — نتيجة {score:.0f} و R/R {rr:.2f}:1 — دخول بحذر.'
        else:
            verdict = 'انتظر'
            _base_reason = f'بعض الإشارات موجودة ({_g_liq}) بس محتاج تأكيد.'

        # HUMANIZE-034: ادمج السرد البشري مع السبب الأساسي
        try:
            from analyzers.narrative_generator import build_humanized_reason
            _humanized = build_humanized_reason(
                ticker=ticker,
                indicators={
                    'rsi': float(stock.get('rsi') or 0) if 'stock' in dir() else 0,
                    'macd_hist': 0,  # persona_gambler لا يحسب MACD
                    'volume_ratio': vol_ratio if 'vol_ratio' in dir() else 1.0,
                    'bb_lower': None,
                    'bb_upper': None,
                    'sma50': None,
                    'sma200': None,
                },
                pine_flags={
                    'is_golden_pullback': False,
                    'is_dead_cat': False,
                    'is_bullish_divergence': False,
                },
                sr_levels={
                    'support': sr_support,
                    'resistance': sr_resistance,
                    'far_support': None,
                    'far_resistance': None,
                },
                score=score,
                regime='unknown',  # persona_gambler لا يمرر regime
            )
            reason = f"{_humanized} — {_base_reason}"
        except Exception:
            reason = _base_reason

    elif score >= 10 and has_strong_signal:
        verdict = 'انتظر'
        reason = f'بعض الإشارات موجودة ({_g_liq}) بس محتاج تأكيد.'
    else:
        verdict = 'ابعد'
        reason = 'السهم نايم. مفيش حركة ولا سيولة.' if not has_strong_signal else 'الإشارات مش كافية للدخول.'

    return GamblerResult(
        verdict=verdict,
        score=round(score, 1),
        reason=reason,
        signal=signal,
        entry=entry,
        target=target,
        stop=stop,
        conditions=conditions,
        support=sr_support,
        resistance=sr_resistance,
        zone=sr_zone,
        rr=sr_rr,
        # 🎯 الأهداف الثلاثة
        target_1=_target_1,
        target_2=_target_2,
        target_3=_target_3,
        target_1_pct=_target_1_pct,
        target_2_pct=_target_2_pct,
        target_3_pct=_target_3_pct,
        # 🛑 وقف متحرك
        trailing_stop=_trailing_stop,
        trailing_stop_logic=_trailing_stop_logic,
        # 🛑 مستويات الوقف
        stop_level_1=_stop_level_1,
        stop_level_2=_stop_level_2,
        stop_level_3=_stop_level_3,
        # 📝 شرح خطوات الوقف
        stop_triggers_ar=_stop_triggers_ar,
        # 📊 تفاصيل
        regime_note=_regime_note,
        is_fallback=is_fallback,
        score_breakdown=score_breakdown,
    )


def gambler_to_dict(result: GamblerResult) -> Dict[str, Any]:
    """تحويل GamblerResult لـ dict للـ JSON."""
    return {
        'verdict': result.verdict,
        'score': result.score,
        'reason': result.reason,
        'signal': result.signal,
        'entry': result.entry,
        'target': result.target,
        'stop': result.stop,
        'conditions': result.conditions,
        # 🧠 S/R info للواجهة
        'support': result.support,
        'resistance': result.resistance,
        'zone': result.zone,
        'rr': result.rr,
        # 🎯 نظام الأهداف الثلاثة
        'target_1': result.target_1,
        'target_2': result.target_2,
        'target_3': result.target_3,
        'target_1_pct': result.target_1_pct,
        'target_2_pct': result.target_2_pct,
        'target_3_pct': result.target_3_pct,
        # 🛑 وقف متحرك
        'trailing_stop': result.trailing_stop,
        'trailing_stop_logic': result.trailing_stop_logic,
        # 🛑 مستويات الوقف المرتبطة بكل target
        'stop_level_1': result.stop_level_1,
        'stop_level_2': result.stop_level_2,
        'stop_level_3': result.stop_level_3,
        'stop_triggers_ar': result.stop_triggers_ar,
        # 📊 تفاصيل إضافية
        'regime_note': result.regime_note,
        'is_fallback': result.is_fallback,
        'score_breakdown': result.score_breakdown,
    }
