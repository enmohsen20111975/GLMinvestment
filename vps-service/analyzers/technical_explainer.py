#!/usr/bin/env python3
"""
Technical Explanation Generator
================================
مولّد الشرح الفني الشامل — بيجمّع كل المحركات الفنية في نص واحد منظّم.

المحركات المستخدمة:
  1. CandlestickAnalyzer       → analyze_candles_batch + enrich_with_context (نمط الشموع + السياق)
  2. calculate_smc_score       → Order Blocks + FVG + Sweeps (Smart Money)
  3. VolumeProfileAnalyzer     → VWAP + OBV + طفرات الحجم + التجميع/التوزيع
  4. AIPatternAnalyzer          → Chart Patterns (Double Top, Head & Shoulders, Golden Cross, إلخ)
  5. build_humanized_reason     → السرد البشري الاحتياطي (لو المحركات فشلت)

يرجع dict بالشكل:
  {
    'summary':      سطر واحد ملخّص
    'candlestick':  نص قسم الشموع
    'smc':          نص قسم SMC
    'volume':       نص قسم الحجم
    'patterns':     نص قسم الأنماط الرسومية
    'proofs':       قائمة الإثباتات
    'risk_note':    ملاحظة المخاطرة (لو في trap_type)
    'full_text':    النص الكامل جاهز للعرض
    'compact_text': نسخة مختصرة للـ Telegram (4 أسطر بحد أقصى)
  }

قاعدة هامة: المحرك GRACEFUL — لو أي محرك فشل أو رجع None، بنتخطّى القسم ده ومبنطّشش.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


# ============================================================================
# Helpers
# ============================================================================

def _safe_float(v: Any, fallback: float = 0.0) -> float:
    """تحويل آمن لأرقام عشرية."""
    try:
        if v is None:
            return fallback
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _to_candle_data_list(
    closes: List[float],
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
    opens: Optional[List[float]] = None,
    volumes: Optional[List[float]] = None,
    max_n: int = 60,
) -> list:
    """يحوّل قوائم closes/highs/lows/opens/volumes إلى List[CandleData].

    لو opens/highs/lows مش موجودة، بيستنتجها من closes (شمعة مسطحة = open=close).
    بياخد آخر max_n شمعة لتسريع التحليل.
    """
    try:
        from analyzers.candlestick import CandleData
    except Exception:
        return []
    if not closes:
        return []
    n = len(closes)
    start = max(0, n - max_n)
    candles = []
    for i in range(start, n):
        c = _safe_float(closes[i])
        o = _safe_float(opens[i]) if opens and i < len(opens) else c
        h = _safe_float(highs[i]) if highs and i < len(highs) else max(o, c)
        l = _safe_float(lows[i]) if lows and i < len(lows) else min(o, c)
        v = _safe_float(volumes[i]) if volumes and i < len(volumes) else 0.0
        candles.append(CandleData(open=o, high=h, low=l, close=c, volume=v))
    return candles


def _compute_volume_ratio(volumes: List[float], window: int = 20) -> float:
    """نسبة حجم آخر شمعة لمتوسط آخر window شمعة."""
    if not volumes or len(volumes) < 2:
        return 1.0
    last = _safe_float(volumes[-1])
    if last <= 0:
        return 0.0
    recent = volumes[-(window + 1):-1] if len(volumes) > window else volumes[:-1]
    if not recent:
        return 1.0
    avg = sum(_safe_float(v) for v in recent) / len(recent)
    if avg <= 0:
        return 0.0
    return last / avg


def _compute_simple_rsi(closes: List[float], period: int = 14) -> float:
    """حساب RSI مبسّط من closes (للاستخدام في fallback narrative)."""
    if not closes or len(closes) < period + 1:
        return 50.0
    try:
        gains = 0.0
        losses = 0.0
        for i in range(1, period + 1):
            diff = _safe_float(closes[i]) - _safe_float(closes[i - 1])
            if diff >= 0:
                gains += diff
            else:
                losses -= diff
        avg_gain = gains / period
        avg_loss = losses / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100.0 - (100.0 / (1.0 + rs)), 2)
    except Exception:
        return 50.0


# ============================================================================
# Section Builders (كل واحد مستقل و GRACEFUL)
# ============================================================================

def _build_candlestick_section(
    closes: List[float],
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
    opens: Optional[List[float]] = None,
    volumes: Optional[List[float]] = None,
) -> str:
    """يبني نص قسم الشموع اليابانية CandlestickAnalyzer + enrich_with_context."""
    try:
        from analyzers.candlestick import CandlestickAnalyzer
        candles = _to_candle_data_list(closes, highs, lows, opens, volumes)
        if not candles or len(candles) < 3:
            return ''
        analyzer = CandlestickAnalyzer()
        signals = analyzer.analyze_candles_batch(candles, trend="NEUTRAL")
        if not signals:
            return ''
        # خد أقوى إشارة (get_best_signal بيرجّع أعلى confidence بسكّت الـ NEUTRAL)
        best = analyzer.get_best_signal(signals)
        if best is None:
            best = signals[0]
        # enrich بالسياق السعري
        try:
            best = analyzer.enrich_with_context(
                best, candles,
                volume_ratio=_compute_volume_ratio(volumes or []),
                market_regime='SIDEWAYS',
            )
        except Exception:
            pass
        # استخراج الحقول
        pattern_ar = getattr(best, 'pattern_name_ar', '') or ''
        strength = getattr(best, 'strength_label', '') or getattr(best, 'strength', '') or ''
        context_desc = getattr(best, 'context_desc', '') or ''
        direction = getattr(best, 'signal_direction', '') or ''
        # ترجمة الاتجاه
        dir_ar = {'BULLISH': 'صاعد', 'BEARISH': 'هابط', 'NEUTRAL': 'محايد'}.get(direction, direction)
        emoji = '🟢' if direction == 'BULLISH' else '🔴' if direction == 'BEARISH' else '🟡'
        # بناء النص
        parts = []
        if pattern_ar:
            _head = f'{emoji} {pattern_ar}'
            if dir_ar and dir_ar != direction:
                _head += f' ({dir_ar})'
            parts.append(_head)
        if strength and strength != dir_ar:
            parts.append(f'[{strength}]')
        if context_desc:
            parts.append(f'— {context_desc}')
        return ' '.join(parts) if parts else ''
    except Exception as e:
        logger.debug(f'[tech_explainer] candlestick section failed: {e}')
        return ''


def _build_smc_section(
    closes: List[float],
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
    opens: Optional[List[float]] = None,
    volumes: Optional[List[float]] = None,
) -> str:
    """يبني نص قسم Smart Money Concepts (Order Blocks + FVG + Sweeps)."""
    try:
        from analyzers.smc_engine import calculate_smc_score
        if not closes or len(closes) < 10:
            return ''
        # بناء ohlcv list of dicts للـ SMCEngine
        ohlcv = []
        n = len(closes)
        for i in range(n):
            c = _safe_float(closes[i])
            o = _safe_float(opens[i]) if opens and i < len(opens) else c
            h = _safe_float(highs[i]) if highs and i < len(highs) else max(o, c)
            l = _safe_float(lows[i]) if lows and i < len(lows) else min(o, c)
            v = _safe_float(volumes[i]) if volumes and i < len(volumes) else 0.0
            ohlcv.append({'date': i, 'open': o, 'high': h, 'low': l, 'close': c, 'volume': v})
        current_price = _safe_float(closes[-1])
        volume_ratio = _compute_volume_ratio(volumes or [])
        smc_result = calculate_smc_score(
            ohlcv=ohlcv,
            current_price=current_price,
            volume_ratio=volume_ratio,
            rsi=50.0,
            sma200=0.0,
        )
        signals = smc_result.get('signals', []) or []
        if not signals:
            # لو مفيش إشارات، اعرض ملخّص SMC score
            score = smc_result.get('score', 0)
            if score > 0:
                return f'📊 SMC Score: {score}/100'
            return ''
        # نظّف الإشارات: شيل الـ "+15" و "+20" الزيادة عشان النص يكون أنظف
        cleaned = []
        for s in signals[:4]:
            _s = str(s)
            # شيل الـ "+N" و "-N" في آخر السطر (مثلاً "✅ السعر فوق SMA200 (15.20) +15")
            import re as _re
            _s = _re.sub(r'\s*[+-]\d+\s*$', '', _s).strip()
            if _s:
                cleaned.append(_s)
        return ' + '.join(cleaned) if cleaned else ''
    except Exception as e:
        logger.debug(f'[tech_explainer] smc section failed: {e}')
        return ''


def _build_volume_section(
    closes: List[float],
    volumes: List[float],
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
) -> str:
    """يبني نص قسم تحليل الحجم (Volume Profile + VWAP + OBV + التجميع/التوزيع)."""
    try:
        from analyzers.volume_profile import VolumeProfileAnalyzer
        if not closes or not volumes or len(closes) < 2:
            return ''
        analyzer = VolumeProfileAnalyzer()
        result = analyzer.analyze(closes, volumes)
        parts = []
        # 1) نسبة الحجم للمتوسط
        ratio = _compute_volume_ratio(volumes)
        if ratio > 0:
            if ratio >= 1.5:
                parts.append(f'حجم {ratio:.1f}x المتوسط')
            elif ratio >= 1.2:
                parts.append(f'حجم {ratio:.1f}x المتوسط')
            elif ratio < 0.8:
                parts.append(f'حجم ضعيف ({ratio:.1f}x)')
        # 2) VWAP
        vwap = _safe_float(result.vwap)
        current_price = _safe_float(closes[-1])
        if vwap > 0 and current_price > 0:
            if current_price > vwap:
                parts.append(f'فوق VWAP ({vwap:.2f})')
            elif current_price < vwap:
                parts.append(f'تحت VWAP ({vwap:.2f})')
        # 3) OBV
        obv = _safe_float(result.obv)
        if obv > 0:
            parts.append('OBV صاعد')
        elif obv < 0:
            parts.append('OBV هابط')
        # 4) التجميع/التوزيع
        vol_trend = result.volume_trend or ''
        if vol_trend == 'accumulating':
            parts.append('تجميع مؤسسي')
        elif vol_trend == 'distributing':
            parts.append('توزيع محتمل')
        # 5) طفرة حجم
        if result.volume_spike:
            parts.append('طفرة حجم')
        # 6) عقدة حجم قريبة من السعر
        try:
            if result.volume_nodes and current_price > 0:
                closest = min(result.volume_nodes, key=lambda nd: abs(nd - current_price))
                if abs(closest - current_price) / current_price < 0.02:
                    parts.append(f'قرب عقدة حجم ({closest:.2f})')
        except Exception:
            pass
        # fallback: لو مفيش حاجة، استخدم signals من المحرك
        if not parts:
            engine_signals = result.signals or []
            if engine_signals:
                parts = engine_signals[:3]
        return ' + '.join(parts) if parts else ''
    except Exception as e:
        logger.debug(f'[tech_explainer] volume section failed: {e}')
        return ''


def _build_patterns_section(
    closes: List[float],
    volumes: List[float],
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
    opens: Optional[List[float]] = None,
    ticker: str = '',
) -> str:
    """يبني نص قسم الأنماط الرسومية (Double Top, Head & Shoulders, Golden Cross, إلخ)."""
    try:
        from analyzers.ai_pattern_analyzer import AIPatternAnalyzer
        if not closes or len(closes) < 10:
            return ''
        analyzer = AIPatternAnalyzer()
        result = analyzer.analyze(
            ticker=ticker or 'UNKNOWN',
            prices=list(closes),
            volumes=list(volumes) if volumes else None,
            highs=list(highs) if highs else None,
            lows=list(lows) if lows else None,
            opens=list(opens) if opens else None,
        )
        bullish = list(result.bullish_patterns or [])
        bearish = list(result.bearish_patterns or [])
        parts = []
        if bullish:
            parts.append('🟢 ' + ' + '.join(bullish[:3]))
        if bearish:
            parts.append('🔴 ' + ' + '.join(bearish[:3]))
        return ' | '.join(parts) if parts else ''
    except Exception as e:
        logger.debug(f'[tech_explainer] patterns section failed: {e}')
        return ''


def _build_narrative_fallback(
    ticker: str,
    closes: List[float],
    volumes: List[float],
    signal: str = 'BUY',
    entry_price: float = None,
    target_price: float = None,
    stop_price: float = None,
    score: float = 60.0,
) -> str:
    """يستخدم build_humanized_reason كـ fallback لو المحركات فشلت."""
    try:
        from analyzers.narrative_generator import build_humanized_reason
        rsi = _compute_simple_rsi(closes)
        volume_ratio = _compute_volume_ratio(volumes)
        # بسيط support/resistance من آخر 20 شمعة
        recent = closes[-20:] if len(closes) >= 20 else closes
        support = min(recent) if recent else None
        resistance = max(recent) if recent else None
        reason = build_humanized_reason(
            ticker=ticker or '',
            indicators={
                'rsi': rsi,
                'macd_hist': 0,
                'volume_ratio': volume_ratio,
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
            sr_levels={'support': support, 'resistance': resistance},
            score=score,
            regime='unknown',
        )
        return reason or ''
    except Exception as e:
        logger.debug(f'[tech_explainer] narrative fallback failed: {e}')
        return ''


# ============================================================================
# Proofs + Risk Note
# ============================================================================

_PROOF_KEY_LABELS = {
    'trend': 'الاتجاه',
    'benchmark': 'الأداء مقابل المؤشر',
    'sector': 'القطاع',
    'maker_buying': 'تجميع المؤسسات',
    'context_signals': 'إشارات السياق',
    'screener_tags': 'تصنيفات Screener',
    'fundamentals': 'الأساسيات',
    'bid_ask': 'سيولة السوق',
    'delta_volume': 'فرق الحجم',
    'radar_boost': 'رادار السيولة',
    'liquidity': 'السيولة',
    'technicals': 'المؤشرات الفنية',
    'early_trend': 'ترند مبكر',
    'volume': 'الحجم',
    'rsi_zone': 'منطقة RSI',
    'poc_distance': 'بُعد السعر عن POC',
    'accumulation': 'التجميع',
    'exit_radar_block': 'حظر Exit Radar',
    'exit_radar_warning': 'تحذير Exit Radar',
}


def _extract_proof_strings(proofs: Optional[Dict[str, Any]]) -> List[str]:
    """يستخرج نصوص قابلة للقراءة من dict الإثباتات."""
    if not proofs or not isinstance(proofs, dict):
        return []
    out: List[str] = []
    for key, val in proofs.items():
        # تجاهل المفاتيح الداخلية اللي مش نصية
        if key in ('technical_explanation',):
            continue
        if val is None:
            continue
        # لو القيمة dict/list، خد JSON نص
        if isinstance(val, (dict, list)):
            try:
                import json as _json
                val_str = _json.dumps(val, ensure_ascii=False)
            except Exception:
                continue
        else:
            val_str = str(val).strip()
        if not val_str or val_str.lower() in ('none', 'nan', 'null'):
            continue
        label = _PROOF_KEY_LABELS.get(key, key.replace('_', ' '))
        # اختيار الإيموجي حسب المحتوى
        if 'exit_radar_block' in key or 'block' in key:
            emoji = '🚫'
        elif 'warning' in key or '⚠' in val_str or 'احذر' in val_str or 'بارد' in val_str or 'ضعيف' in val_str:
            emoji = '⚠️'
        elif any(x in val_str for x in ['صاعد', 'تجميع', 'قوي', 'شراء', 'اختراق', 'boost', 'مؤسسي', 'صحية']):
            emoji = '✅'
        elif any(x in val_str for x in ['بيع', 'هابط', 'توزيع', 'سالب']):
            emoji = '⚠️'
        else:
            emoji = '✅'
        # قص القيمة لو طويلة جداً
        if len(val_str) > 140:
            val_str = val_str[:137] + '...'
        out.append(f'{emoji} {label}: {val_str}')
    return out


def _build_risk_note(trap_type: Optional[str]) -> str:
    """يبني ملاحظة المخاطرة حسب نوع الفخ."""
    if not trap_type:
        return ''
    _tt = str(trap_type).upper()
    if 'DISTRIBUTION' in _tt:
        return '⚠️ توزيع محتمل — احذر من فخ التوزيع'
    if 'BAG' in _tt or 'BAGHOLDER' in _tt:
        return '⚠️ السهم محتمل يكون في فخ التعلّق — احذر'
    if 'DEAD_CAT' in _tt:
        return '⚠️ فخ الارتداد — السهم في ترند هابط'
    if 'OVERBOUGHT' in _tt or 'OVER_EXTEND' in _tt or 'OVEREXTEND' in _tt:
        return '⚠️ السهم ممتد جداً — احذر التصحيح'
    if 'PUMP' in _tt or 'PUMP_DUMP' in _tt:
        return '⚠️ السهم في مرحلة Pump & Dump — ابتعد'
    return ''


# ============================================================================
# Summary Builder
# ============================================================================

def _build_summary_line(
    ticker: str,
    signal: str,
    candle_text: str,
    smc_text: str,
    volume_text: str,
    patterns_text: str,
) -> str:
    """يبني سطر واحد ملخّص (max 120 chars) يلخّص الفرضية الأساسية."""
    try:
        signal_ar = {'BUY': 'شراء', 'SELL': 'بيع', 'HOLD': 'متابعة'}.get(
            (signal or '').upper(), signal or ''
        )
        parts = []
        if ticker:
            parts.append(f'📈 {ticker}')
        if signal_ar:
            parts.append(signal_ar)
        # خد أهم نقطة من الحجم
        if volume_text:
            _v = volume_text.split('+')[0].strip()
            # شيل الإيموجي لو موجود
            for _e in ('📊', '✅', '⚠️'):
                _v = _v.replace(_e, '').strip()
            if _v:
                parts.append(_v)
        # خد أول نقطة من SMC
        if smc_text:
            _s = smc_text.split('+')[0].strip()
            for _e in ('📊', '✅', '⚠️', '🐋'):
                _s = _s.replace(_e, '').strip()
            if _s:
                parts.append(_s)
        elif candle_text:
            _c = candle_text.split('—')[0].strip()
            for _e in ('🟢', '🔴', '🟡', '🕯️'):
                _c = _c.replace(_e, '').strip()
            if _c:
                parts.append(_c)
        # لو لسه فاضي، حط نمط
        if not parts or (len(parts) <= 2 and patterns_text):
            _p = patterns_text.split('|')[0].strip()
            for _e in ('🟢', '🔴', '📐'):
                _p = _p.replace(_e, '').strip()
            if _p:
                parts.append(_p)
        summary = ' + '.join(parts[:4])
        if len(summary) > 120:
            summary = summary[:117] + '...'
        return summary
    except Exception:
        return f'📈 {ticker}'


# ============================================================================
# Main: build_technical_explanation
# ============================================================================

def build_technical_explanation(
    ticker: str,
    closes: List[float],
    volumes: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
    opens: List[float] = None,
    entry_price: float = None,
    target_price: float = None,
    stop_price: float = None,
    proofs: Dict = None,
    trap_type: str = None,
    signal: str = 'BUY',
) -> Dict[str, Any]:
    """يبني شرح فني شامل للتوقع — بيجمع الشموع + SMC + Volume Profile + Proofs.

    Args:
        ticker: رمز السهم (مثلاً COMI)
        closes: قائمة أسعار الإغلاق (الأقدم → الأحدث)
        volumes: قائمة أحجام التداول (بنفس ترتيب closes)
        highs: قائمة أعلى سعر (اختياري)
        lows: قائمة أقل سعر (اختياري)
        opens: قائمة سعر الافتتاح (اختياري)
        entry_price: سعر الدخول (للعرض)
        target_price: السعر المستهدف (للعرض)
        stop_price: سعر وقف الخسارة (للعرض)
        proofs: dict إثباتات من daily_predictor (مفاتيح: trend, sector, maker_buying, إلخ)
        trap_type: نوع الفخ لو موجود (مثلاً DISTRIBUTION_TRAP)
        signal: نوع الإشارة (BUY/SELL/HOLD)

    Returns:
        dict بالشكل الموصوف في docstring الموديول
    """
    # ─── حالات الحافة: بيانات قصيرة ───
    if not closes or not volumes or len(closes) < 20:
        narrative = _build_narrative_fallback(
            ticker=ticker,
            closes=list(closes or []),
            volumes=list(volumes or []),
            signal=signal,
            entry_price=entry_price,
            target_price=target_price,
            stop_price=stop_price,
        )
        proofs_list = _extract_proof_strings(proofs)
        risk_note = _build_risk_note(trap_type)
        _sig_ar = {'BUY': 'شراء', 'SELL': 'بيع', 'HOLD': 'متابعة'}.get(
            (signal or '').upper(), signal or ''
        )
        summary = f'📈 {ticker} — {_sig_ar}' if ticker else '📈 تحليل فني'
        full_text = narrative or summary
        return {
            'summary': summary,
            'candlestick': '',
            'smc': '',
            'volume': '',
            'patterns': '',
            'proofs': proofs_list,
            'risk_note': risk_note,
            'full_text': full_text,
            'compact_text': full_text,
        }

    # ─── خد آخر N شمعة لتسريع المحركات ───
    N = min(len(closes), 60)
    closes_r = list(closes[-N:])
    volumes_r = list(volumes[-N:]) if len(volumes) >= N else list(volumes or [])
    highs_r = list(highs[-N:]) if highs else None
    lows_r = list(lows[-N:]) if lows else None
    opens_r = list(opens[-N:]) if opens else None

    # ─── بناء كل قسم (graceful) ───
    candle_text = _build_candlestick_section(closes_r, highs_r, lows_r, opens_r, volumes_r)
    smc_text = _build_smc_section(closes_r, highs_r, lows_r, opens_r, volumes_r)
    volume_text = _build_volume_section(closes_r, volumes_r, highs_r, lows_r)
    patterns_text = _build_patterns_section(closes_r, volumes_r, highs_r, lows_r, opens_r, ticker)
    proofs_list = _extract_proof_strings(proofs)
    risk_note = _build_risk_note(trap_type)
    summary = _build_summary_line(ticker, signal, candle_text, smc_text, volume_text, patterns_text)

    # ─── النص الكامل (full_text) ───
    sections: List[str] = []
    if summary:
        sections.append(f'📊 {summary}')
    if candle_text:
        sections.append(f'🕯️ الشموع: {candle_text}')
    if smc_text:
        sections.append(f'🐋 SMC: {smc_text}')
    if volume_text:
        sections.append(f'📊 الحجم: {volume_text}')
    if patterns_text:
        sections.append(f'📐 الأنماط: {patterns_text}')
    if proofs_list:
        sections.append('✅ الإثباتات:\n' + '\n'.join(proofs_list))
    if risk_note:
        sections.append(risk_note)
    # fallback: لو كل المحركات فشلت، استخدم build_humanized_reason
    if not sections:
        narrative = _build_narrative_fallback(
            ticker=ticker,
            closes=closes,
            volumes=volumes,
            signal=signal,
            entry_price=entry_price,
            target_price=target_price,
            stop_price=stop_price,
        )
        if narrative:
            sections.append(narrative)
        else:
            _sig_ar = {'BUY': 'شراء', 'SELL': 'بيع', 'HOLD': 'متابعة'}.get(
                (signal or '').upper(), signal or ''
            )
            sections.append(f'📈 {ticker} — {_sig_ar}')
    full_text = '\n\n'.join(sections)

    # ─── النسخة المختصرة للـ Telegram (compact_text) ───
    compact_lines: List[str] = []
    if summary:
        compact_lines.append(f'📝 {summary}')
    if candle_text:
        compact_lines.append(f'🕯️ {candle_text}')
    if smc_text:
        compact_lines.append(f'🐋 {smc_text}')
    if volume_text:
        compact_lines.append(f'📊 {volume_text}')
    # قص لـ 4 أسطر كحد أقصى
    compact_lines = compact_lines[:4]
    if not compact_lines:
        compact_text = summary or f'📈 {ticker}'
    else:
        compact_text = '\n'.join(compact_lines)

    return {
        'summary': summary,
        'candlestick': candle_text,
        'smc': smc_text,
        'volume': volume_text,
        'patterns': patterns_text,
        'proofs': proofs_list,
        'risk_note': risk_note,
        'full_text': full_text,
        'compact_text': compact_text,
    }


# ============================================================================
# Helper: build_compact_telegram_section
# ============================================================================

def build_compact_telegram_section(explanation: Dict[str, Any]) -> str:
    """يرجع نص مختصر للـ Telegram — 4 أسطر بحد أقصى.

    يستخدم compact_text الجاهز لو موجود، وإلا بيبنيه من الحقول المنفصلة.
    """
    if not explanation or not isinstance(explanation, dict):
        return ''
    # الأولوية الأولى: compact_text الجاهز
    compact = explanation.get('compact_text')
    if compact and isinstance(compact, str) and compact.strip():
        lines = compact.split('\n')
        if len(lines) > 4:
            lines = lines[:4]
        return '\n'.join(lines)
    # الأولوية التانية: ابنِ من الحقول المنفصلة
    lines: List[str] = []
    _summary = explanation.get('summary')
    _candle = explanation.get('candlestick')
    _smc = explanation.get('smc')
    _volume = explanation.get('volume')
    if _summary:
        lines.append(f'📝 {_summary}')
    if _candle:
        lines.append(f'🕯️ {_candle}')
    if _smc:
        lines.append(f'🐋 {_smc}')
    if _volume:
        lines.append(f'📊 {_volume}')
    if len(lines) > 4:
        lines = lines[:4]
    return '\n'.join(lines) if lines else ''


__all__ = [
    'build_technical_explanation',
    'build_compact_telegram_section',
]
