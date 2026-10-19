"""
models.py — نماذج البيانات الموحّدة (Standard Data Models)
============================================================
(Phase 9 — API Response Standardization)

المشكلة اللي بتحلها:
    الـ Frontend بياخد JSON shapes مختلفة من محركات مختلفة:
      - V20 Fusion بيرجّع {fusion_metrics, smc, v20}
      - MasterAnalyzer بيرجّع {maestro_score, risk_profile, composite_score}
      - LiveIndicatorEngine بيرجّع {live_score, live_indicators, breakdown}
    وفيه حاجات `null` وحاجات ناقصة → الـ Frontend بيـ crash أو بيـ render غلط.

الحل:
    `StandardAnalysisResponse` @dataclass دي الـ contract الموحّد. كل محرك
    بيرجّع شكل مختلف، بس الـ router بيحوّله للـ dataclass ده قبل ما يبعت للـ Frontend.

    الـ Frontend دلوقتي مضمون إنه هيلاقي نفس الـ keys في أي رد:
      - signal, signal_ar, direction, score, confidence
      - entry_price, target_price, stop_loss, risk_reward
      - reason, reason_ar
      - engine, intent, mode, timing_ms
      - technical, fundamental, fusion_metrics, risk_profile, smc, v20, live_indicators
      - success, error, warnings, cached, fallback
      - timestamp

    لو محرك معيّن مطلعش حاجة (زي fusion_metrics من LiveEngine)، الـ field بيبقى None.
    مفيش KeyError تاني في الـ Frontend.

الاستخدام:
    from core.models import StandardAnalysisResponse

    # من نتيجة محرك
    response = StandardAnalysisResponse.from_engine_result(
        ticker='COMI',
        intent='daily',
        engine_result=raw_engine_dict,  # الـ dict اللي المحرك بيرجّعه
        engine_name='master_analyzer',
        timing_ms=148.7,
    )

    # تحويل لـ JSON-safe dict
    return response.to_dict()

مبدأ التصميم:
    - كل الـ fields Optional (default None) — مفيش KeyError.
    - `from_engine_result` بيـ map الـ common keys من أي محرك للـ standard shape.
    - `to_dict()` بيرجّع dict نظيف (بNone مش missing keys) عشان الـ JSON serialization.
    - Backward compatible: الـ raw engine data لسه موجود في `raw` field.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# StandardAnalysisResponse — الـ contract الموحّد
# ---------------------------------------------------------------------------
@dataclass
class StandardAnalysisResponse:
    """
    الـ contract الموحّد لأي رد تحليل. كل المحركات بتـ map للـ dataclass ده.

    الـ fields مقسّمة لـ 5 مجموعات:
      1. Identity:        ticker, engine, intent, mode
      2. Signal & Trade:  signal, signal_ar, direction, score, confidence,
                          entry_price, target_price, stop_loss, risk_reward
      3. Explanation:     reason, reason_ar, warnings
      4. Engine Payload:  technical, fundamental, fusion_metrics, risk_profile,
                          smc, v20, live_indicators, raw
      5. Meta:            success, error, timing_ms, cached, fallback, timestamp
    """

    # ── 1. Identity ──
    ticker: str = ''
    engine: Optional[str] = None
    intent: Optional[str] = None          # 'live' | 'daily' | 'full'
    mode: Optional[str] = None            # 'live' | 'daily' | 'full' (من المحرك)

    # ── 2. Signal & Trade Plan ──
    signal: Optional[str] = None          # BUY / SELL / HOLD / STRONG_BUY / ...
    signal_ar: Optional[str] = None       # شراء / بيع / انتظار / ...
    direction: Optional[str] = None       # 'LONG' | 'SHORT'
    score: Optional[float] = None         # 0-100 composite score
    confidence: Optional[float] = None    # 0-1 or 0-100 (حسب المحرك)
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    risk_reward: Optional[float] = None   # R:R ratio (reward/risk)

    # ── 3. Explanation ──
    reason: Optional[str] = None
    reason_ar: Optional[str] = None
    warnings: List[str] = field(default_factory=list)

    # ── 4. Engine Payload (None لو المحرك مطلعش الحاجة دي) ──
    technical: Optional[Dict[str, Any]] = None         # RSI, MACD, SMA, Bollinger, ...
    fundamental: Optional[Dict[str, Any]] = None       # PE, ROE, debt, FundamentalVerdict
    fusion_metrics: Optional[Dict[str, Any]] = None    # V20 fusion breakdown
    risk_profile: Optional[Dict[str, Any]] = None      # entry/sl/tp/rr + direction
    smc: Optional[Dict[str, Any]] = None               # Order Blocks / FVG / Sweeps
    v20: Optional[Dict[str, Any]] = None               # V20 fusion layer details
    live_indicators: Optional[Dict[str, Any]] = None   # LiveEngine breakdown
    raw: Optional[Dict[str, Any]] = None               # الـ raw engine output كله

    # ── 5. Meta ──
    success: bool = True
    error: Optional[str] = None
    timing_ms: Optional[float] = None
    cached: bool = False                  # True لو رجّع من الكاش
    fallback: bool = False                # True لو حصل fallback (live → daily)
    timestamp: str = ''

    def __post_init__(self) -> None:
        """ضمانات بعد الـ construction."""
        # timestamp دايماً موجود (ISO 8601 UTC)
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()

        # ticker دايماً uppercase
        if self.ticker:
            self.ticker = self.ticker.strip().upper()

    # -----------------------------------------------------------------
    # من نتيجة محرك → StandardAnalysisResponse
    # -----------------------------------------------------------------
    @classmethod
    def from_engine_result(
        cls,
        ticker: str,
        intent: str,
        engine_result: Dict[str, Any],
        engine_name: str,
        timing_ms: Optional[float] = None,
        cached: bool = False,
        fallback: bool = False,
    ) -> "StandardAnalysisResponse":
        """
        بناء StandardAnalysisResponse من الـ raw dict اللي أي محرك بيرجّعه.

        الـ mapping بيجرّب أسماء شائعة لكل field (زي `signal` أو `recommendation`
        أو `final_signal`) وياخد أول واحد موجود.

        Args:
            ticker: رمز السهم.
            intent: الـ intent المطلوب ('live'|'daily'|'full').
            engine_result: الـ raw dict اللي المحرك بيرجّعه.
            engine_name: اسم المحرك ('live_indicator_engine'|'master_analyzer'|...).
            timing_ms: زمن التنفيذ بالملي ثانية.
            cached: True لو النتيجة من الكاش.
            fallback: True لو حصل fallback.
        """
        if not isinstance(engine_result, dict):
            engine_result = {'raw': str(engine_result), 'success': False}

        # helper: خد أول key موجودة من قائمة أسماء بديلة
        def pick(*keys: str, default: Any = None) -> Any:
            for k in keys:
                if k in engine_result and engine_result[k] is not None:
                    return engine_result[k]
            return default

        # ── Signal extraction (محركات مختلفة بتسمّيه بأسماء مختلفة) ──
        signal = pick('signal', 'final_signal', 'recommendation', 'recommendation_label')
        signal_ar = pick('signal_ar', 'recommendation_ar', 'final_signal_ar')

        # ── Score extraction ──
        score = pick('score', 'maestro_score', 'composite_score', 'live_score',
                     'final_score', 'total_score')
        # حوّل لـ float لو ممكن
        if score is not None:
            try:
                score = float(score)
            except (TypeError, ValueError):
                score = None

        confidence = pick('confidence', 'confidence_score', 'confidence_level')
        if confidence is not None:
            try:
                confidence = float(confidence)
            except (TypeError, ValueError):
                confidence = None

        # ── Trade plan (entry / target / stop / RR) ──
        entry_price = pick('entry_price', 'entry', 'entryPrice', 'price_entry')
        target_price = pick('target_price', 'target', 'tp1', 'targetPrice', 'price_target')
        stop_loss = pick('stop_loss', 'stop', 'sl', 'stopLoss', 'stop_loss_price')
        risk_reward = pick('risk_reward', 'rr', 'risk_reward_ratio', 'R_R')

        # حوّل الأرقام لـ float
        def to_float(v: Any) -> Optional[float]:
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        entry_price = to_float(entry_price)
        target_price = to_float(target_price)
        stop_loss = to_float(stop_loss)
        risk_reward = to_float(risk_reward)

        # ── Direction (LONG/SHORT) ──
        direction = pick('direction')
        # لو مش موجود، حاول تستنتجه من الـ signal
        if direction is None and signal:
            sig_upper = str(signal).upper()
            sell_signals = {'SELL', 'STRONG_SELL', 'REDUCE', 'BEARISH', 'SHORT', 'UNDERWEIGHT'}
            direction = 'SHORT' if sig_upper in sell_signals else 'LONG'

        # ── Reason ──
        reason = pick('reason', 'rationale', 'explanation', 'reasoning')
        reason_ar = pick('reason_ar', 'rationale_ar', 'explanation_ar')

        # ── Engine payloads (بياخد الـ sub-dicts لو موجودة) ──
        def extract_dict(*keys: str) -> Optional[Dict[str, Any]]:
            for k in keys:
                v = engine_result.get(k)
                if isinstance(v, dict):
                    return v
            return None

        technical = extract_dict('technical', 'technical_analysis', 'indicators')
        fundamental = extract_dict('fundamental', 'fundamental_analysis', 'fundamentals')
        fusion_metrics = extract_dict('fusion_metrics', 'fusion', 'fusion_breakdown')
        risk_profile = extract_dict('risk_profile', 'risk')
        smc = extract_dict('smc', 'smc_analysis', 'smart_money')
        v20 = extract_dict('v20', 'v20_fusion', 'fusion_v20')
        live_indicators = extract_dict('live_indicators', 'live_breakdown', 'breakdown')

        # ── Warnings ──
        warnings_raw = engine_result.get('warnings', [])
        if isinstance(warnings_raw, list):
            warnings = [str(w) for w in warnings_raw]
        else:
            warnings = []

        # ── Success / Error ──
        success = bool(engine_result.get('success', True))
        error = engine_result.get('error') or engine_result.get('error_message')

        # ── Mode ──
        mode = pick('mode', 'engine')

        return cls(
            ticker=str(ticker).strip().upper(),
            engine=engine_name,
            intent=intent,
            mode=mode,
            signal=signal,
            signal_ar=signal_ar,
            direction=direction,
            score=score,
            confidence=confidence,
            entry_price=entry_price,
            target_price=target_price,
            stop_loss=stop_loss,
            risk_reward=risk_reward,
            reason=reason,
            reason_ar=reason_ar,
            warnings=warnings,
            technical=technical,
            fundamental=fundamental,
            fusion_metrics=fusion_metrics,
            risk_profile=risk_profile,
            smc=smc,
            v20=v20,
            live_indicators=live_indicators,
            raw=engine_result,
            success=success,
            error=error,
            timing_ms=timing_ms,
            cached=cached,
            fallback=fallback,
        )

    # -----------------------------------------------------------------
    # خطأ موحّد
    # -----------------------------------------------------------------
    @classmethod
    def error_response(
        cls,
        ticker: str,
        intent: str,
        error: str,
        engine: Optional[str] = None,
        timing_ms: Optional[float] = None,
    ) -> "StandardAnalysisResponse":
        """بناء رد خطأ موحّد."""
        return cls(
            ticker=str(ticker).strip().upper(),
            engine=engine,
            intent=intent,
            success=False,
            error=error,
            timing_ms=timing_ms,
        )

    # -----------------------------------------------------------------
    # تحويل لـ JSON-safe dict
    # -----------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        """
        تحويل لـ dict نظيف. كل الـ fields موجودة (None لو مش متاح).
        آمن للـ JSON serialization.
        """
        d = asdict(self)
        # clean: شيل أي nested None dicts مش ضرورية (اختياري — نسيبها للـ frontend)
        return d


# ---------------------------------------------------------------------------
# اختبار سريع (python3 core/models.py)
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("StandardAnalysisResponse — Self Test")
    print("=" * 60)

    # Test 1: MasterAnalyzer-style result
    print("\nTest 1: MasterAnalyzer-style result")
    master_result = {
        'success': True,
        'signal': 'BUY',
        'signal_ar': 'شراء',
        'maestro_score': 72.5,
        'confidence': 0.85,
        'entry_price': 25.40,
        'target_price': 28.50,
        'stop_loss': 23.80,
        'risk_reward': 1.83,
        'reason': 'Strong technical breakout + bullish MACD crossover',
        'technical': {'rsi': 58, 'macd': 'bullish'},
        'risk_profile': {'entry': 25.40, 'stop': 23.80, 'target': 28.50},
        'mode': 'daily',
    }
    resp = StandardAnalysisResponse.from_engine_result(
        ticker='comi',
        intent='daily',
        engine_result=master_result,
        engine_name='master_analyzer',
        timing_ms=148.7,
    )
    d = resp.to_dict()
    print(f"  ticker    : {d['ticker']}")
    print(f"  signal    : {d['signal']}")
    print(f"  direction : {d['direction']}  (auto-derived from BUY → LONG)")
    print(f"  score     : {d['score']}")
    print(f"  entry     : {d['entry_price']} | target: {d['target_price']} | stop: {d['stop_loss']}")
    print(f"  technical : {d['technical']}")
    print(f"  fusion_metrics: {d['fusion_metrics']}  (expected None — MasterAnalyzer doesn't produce it)")
    assert d['ticker'] == 'COMI'
    assert d['direction'] == 'LONG'
    assert d['fusion_metrics'] is None

    # Test 2: LiveEngine-style result (different keys)
    print("\nTest 2: LiveIndicatorEngine-style result (different keys)")
    live_result = {
        'success': True,
        'live_score': 65,
        'final_signal': 'SELL',
        'breakdown': {'rsi': 72, 'macd_hist': -0.3},
        'mode': 'live',
    }
    resp2 = StandardAnalysisResponse.from_engine_result(
        ticker='ETEL',
        intent='live',
        engine_result=live_result,
        engine_name='live_indicator_engine',
        timing_ms=45.2,
    )
    d2 = resp2.to_dict()
    print(f"  ticker    : {d2['ticker']}")
    print(f"  signal    : {d2['signal']}  (mapped from 'final_signal')")
    print(f"  direction : {d2['direction']}  (auto-derived from SELL → SHORT)")
    print(f"  score     : {d2['score']}  (mapped from 'live_score')")
    print(f"  live_indicators: {d2['live_indicators']}  (mapped from 'breakdown')")
    print(f"  entry_price: {d2['entry_price']}  (expected None — LiveEngine doesn't produce trade plan)")
    assert d2['signal'] == 'SELL'
    assert d2['direction'] == 'SHORT'
    assert d2['live_indicators'] == {'rsi': 72, 'macd_hist': -0.3}
    assert d2['entry_price'] is None

    # Test 3: Error response
    print("\nTest 3: Error response")
    err_resp = StandardAnalysisResponse.error_response(
        ticker='XYZ',
        intent='daily',
        error='MasterAnalyzer not available',
        timing_ms=2.1,
    )
    d3 = err_resp.to_dict()
    print(f"  success: {d3['success']}, error: {d3['error']}")
    assert d3['success'] is False
    assert d3['error'] == 'MasterAnalyzer not available'

    # Test 4: All standard keys present (no KeyError for frontend)
    print("\nTest 4: All standard keys present in every response")
    standard_keys = {
        'ticker', 'engine', 'intent', 'mode',
        'signal', 'signal_ar', 'direction', 'score', 'confidence',
        'entry_price', 'target_price', 'stop_loss', 'risk_reward',
        'reason', 'reason_ar', 'warnings',
        'technical', 'fundamental', 'fusion_metrics', 'risk_profile',
        'smc', 'v20', 'live_indicators', 'raw',
        'success', 'error', 'timing_ms', 'cached', 'fallback', 'timestamp',
    }
    for label, dd in [('master', d), ('live', d2), ('error', d3)]:
        missing = standard_keys - set(dd.keys())
        print(f"  {label}: missing keys = {missing if missing else 'NONE ✓'}")
        assert not missing, f"Missing keys in {label}: {missing}"

    print("\n✅ All tests passed — StandardAnalysisResponse guarantees consistent shape.")
