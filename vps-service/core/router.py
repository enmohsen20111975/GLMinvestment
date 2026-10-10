"""
router.py — موحّد العقل (Decision Router)
==========================================
(Phase 8 — Unify the Brain)

المشكلة اللي بتحلها:
    كان فيه محركات حسابية كتير (MasterAnalyzer, CoreScoring, V20 Fusion,
    LiveIndicatorEngine) والـ Frontend مش بيعرف مين الصح اللي يعرضه.
    كل endpoint بيستدعي محرك مختلف inline → نتايج متضاربة.

الحل:
    طبقة `DecisionRouter` دي هي اللي تقرر أي محرك يشغّل بناءً على:
      - intent (live/daily/full)
      - حالة السوق (جلسة فاتحة؟)
      - توفر البيانات (عدد الشموع، آخر update)

    المحركات القديمة (CoreScoring) بقت Internal Helpers — مفيش endpoint
    خارجي يناديها مباشرة، بس MasterAnalyzer بيستخدمها داخلياً.

الاستخدام:
    from core.router import decision_router

    # تحليل لحظي (خفيف، أثناء الجلسة)
    result = decision_router.route('COMI', intent='live')

    # تحليل يومي (ثقيل، V20 Fusion)
    result = decision_router.route('COMI', intent='daily')

    # تحليل كامل (الأثقل — MasterAnalyzer + V20 + كل الـ layers)
    result = decision_router.route('COMI', intent='full')

    # let the router decide تلقائياً بناءً على حالة السوق
    result = decision_router.route('COMI', intent='auto')

القرار (routing logic):
    - intent='live'  → LiveIndicatorEngine (30-80ms، أثناء الجلسة فقط)
    - intent='daily' → MasterAnalyzer + V20 Fusion (2-4s، تحليل كامل)
    - intent='full'  → MasterAnalyzer full pipeline (الأبطأ، الأشمل)
    - intent='auto'  → لو الجلسة فاتحة + فيه بيانات today → live
                       иначе → daily

    CoreScoringEngine بقت internal helper (بيستخدمها MasterAnalyzer بس).

Phase 9 additions (Performance & Stability):
    - In-memory TTL cache (60s) — لو 10 مستخدمين طلبوا COMI في نفس الدقيقة،
      المحرك بيشتغل مرة واحدة بس والباقي من الكاش (O(1)).
    - StandardAnalysisResponse — كل رد بيرجّع بنفس الـ shape (مفيش KeyError
      في الـ Frontend تاني). لو محرك مطلعش حاجة، الـ field بيبقى None.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Dict, Literal, Optional

# Phase 9: Caching + Standard Response
try:
    from core.cache_manager import analysis_cache
    from core.models import StandardAnalysisResponse
    _PHASE9_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PHASE9_AVAILABLE = False
    analysis_cache = None  # type: ignore[assignment]
    StandardAnalysisResponse = None  # type: ignore[assignment,misc]

# ---------------------------------------------------------------------------
# Cairo timezone (EGX session hours)
# ---------------------------------------------------------------------------
try:
    from zoneinfo import ZoneInfo
    _CAIRO_TZ = ZoneInfo("Africa/Cairo")
except Exception:  # pragma: no cover
    _CAIRO_TZ = None


def _cairo_now() -> datetime:
    """التوقيت الحالي بالقاهرة (EGX timezone)."""
    if _CAIRO_TZ:
        return datetime.now(_CAIRO_TZ)
    return datetime.now()


def _is_egx_session_open(now: Optional[datetime] = None) -> bool:
    """
    اتأكد إن جلسة EGX فاتحة.
    EGX بيشغل: الأحد → الخميس، 10:00 → 14:30 (cairo time).
    """
    now = now or _cairo_now()
    # weekday: Monday=0 ... Sunday=6. EGX: Sun(6),Mon(0),Tue(1),Wed(2),Thu(3)
    if now.weekday() not in (6, 0, 1, 2, 3):
        return False
    current_min = now.hour * 60 + now.minute
    # 10:00 = 600, 14:30 = 870
    return 600 <= current_min <= 870


# ---------------------------------------------------------------------------
# Intent type
# ---------------------------------------------------------------------------
Intent = Literal['auto', 'live', 'daily', 'full']


# ---------------------------------------------------------------------------
# DecisionRouter — الموحّد
# ---------------------------------------------------------------------------
class DecisionRouter:
    """
    موحّد قرارات التحليل. الـ endpoint الوحيد اللي الـ Frontend المفروض يناديه.

    الـ router بيقرر المحرك بناءً على:
      1. intent (لو محدد صراحة)
      2. حالة السوق (لو intent='auto')
      3. توفر البيانات (fallback لو الـ live مش متاح)

    المحركات المتاحة:
      - LiveIndicatorEngine: خفيف، 30-80ms، أثناء الجلسة فقط.
      - MasterAnalyzer: ثقيل، 2-4s، V20 Fusion + كل الـ layers.
    """

    _instance: Optional["DecisionRouter"] = None

    def __new__(cls) -> "DecisionRouter":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._logger = logging.getLogger("router")
        self._live_engine = None  # lazy init
        self._master_engine = None  # lazy init
        # إحصائيات
        self._stats: Dict[str, int] = {
            'live': 0,
            'daily': 0,
            'full': 0,
            'fallback_to_daily': 0,
            'errors': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            # P19: إحصائيات الـ cache bypass (لما DB أحدث من الكاش)
            'live_cache_bypass_stale': 0,
            'live_cache_bypass_no_ts': 0,
        }
        # P19: تتبع وقت آخر cache set لكل (ticker, intent, persona) — لتقرر
        # هل الكاش stale (الـ DB عنده سعر أحدث) ولا لأ.
        # Key: (ticker_upper, intent_lower, persona_lower_or_None) — نفس مفتاح cache_manager.
        # Value: monotonic time.time() عند آخر set.
        self._cache_set_times: Dict[tuple, float] = {}

    # -----------------------------------------------------------------
    # lazy accessors للمحركات (تجنب import cycles)
    # -----------------------------------------------------------------
    def _get_live_engine(self):
        """Lazy-init LiveIndicatorEngine."""
        if self._live_engine is None:
            try:
                from analyzers.live_indicator_engine import LiveIndicatorEngine
                self._live_engine = LiveIndicatorEngine()
            except Exception as e:
                self._logger.warning(f"LiveIndicatorEngine unavailable: {e}")
                self._live_engine = None
        return self._live_engine

    def _get_master_engine(self):
        """Lazy-init MasterAnalyzer."""
        if self._master_engine is None:
            try:
                from analyzers.master_analyzer import MasterAnalyzer
                self._master_engine = MasterAnalyzer()
            except Exception as e:
                self._logger.warning(f"MasterAnalyzer unavailable: {e}")
                self._master_engine = None
        return self._master_engine

    # -----------------------------------------------------------------
    # قرار التوجيه (routing decision)
    # -----------------------------------------------------------------
    def decide(self, intent: Intent = 'auto') -> str:
        """
        قرر أي محرك يشغّل. بيرجّع 'live' أو 'daily' أو 'full'.

        Logic:
          - 'live'  → live (لو الجلسة فاتحة + engine متاح، وإلا fallback لـ daily)
          - 'daily' → daily
          - 'full'  → full
          - 'auto'  → live لو جلسة فاتحة، وإلا daily
        """
        if intent == 'live':
            # لو الجلسة مقفولة أو الـ engine مش متاح → fallback لـ daily
            if not _is_egx_session_open():
                self._stats['fallback_to_daily'] += 1
                return 'daily'
            if self._get_live_engine() is None:
                self._stats['fallback_to_daily'] += 1
                return 'daily'
            return 'live'

        if intent == 'daily':
            return 'daily'

        if intent == 'full':
            return 'full'

        # intent == 'auto'
        if _is_egx_session_open() and self._get_live_engine() is not None:
            return 'live'
        return 'daily'

    # -----------------------------------------------------------------
    # التوجيه الفعلي (route)
    # -----------------------------------------------------------------
    def route(
        self,
        ticker: str,
        intent: Intent = 'auto',
        **kwargs,
    ) -> Dict[str, Any]:
        """
        وجّه طلب التحليل للمحرك المناسب + استخدم الكاش + موحّد الرد.

        Args:
            ticker: رمز السهم (مثال: 'COMI').
            intent: 'auto' (default) | 'live' | 'daily' | 'full'.
            **kwargs: options إضافية تمرّر للمحرك (prices, volumes, market_pulse, ...).

        Returns:
            StandardAnalysisResponse.to_dict() — نفس الـ shape دايماً:
              - success (bool), error (str|None)
              - ticker, engine, intent, mode
              - signal, signal_ar, direction, score, confidence
              - entry_price, target_price, stop_loss, risk_reward
              - reason, reason_ar, warnings
              - technical, fundamental, fusion_metrics, risk_profile, smc, v20, live_indicators
              - raw (الـ raw engine output)
              - timing_ms, cached (bool), fallback (bool), timestamp
        """
        if not ticker:
            if _PHASE9_AVAILABLE:
                return StandardAnalysisResponse.error_response(  # type: ignore[union-attr]
                    ticker='', intent=intent, error='ticker is required',
                ).to_dict()
            return {
                'success': False,
                'error': 'ticker is required',
                'engine': None,
                'intent_used': intent,
            }

        engine_choice = self.decide(intent)
        fallback = engine_choice != intent and intent != 'auto'

        # P15-LIVE-UX-AUTH-FIXES (Task 3): استخرج persona من kwargs عشان
        # تدمجها في الـ cache key. ده يمنع الـ investor و gambler من مشاركة
        # نفس الـ cached result.
        persona = kwargs.get('persona')
        persona_str = str(persona).strip().lower() if persona else None

        # ── P19-REAL-TIME-SYNC-PRACTICAL-ANALYSIS: Cache Bypass for Live ──
        # لو intent='live' و فيه cache entry، اتشيك على stocks.last_updated:
        #   - لو DB عنده سعر أحدث من وقت آخر cache set → الكاش stale، skipه
        #     وأعيد التحليل بناءً على السعر الطازج.
        #   - ده بيخلي الإشارة اللحظية بتبقى مبنية على آخر سعر في السوق،
        #     مش داتا قديمة في الكاش من 60 ثانية.
        # الـ 'daily' و 'full' بتفضل تستخدم الكاش عادي (تحليلهم ثقيل ومش
        # بيتغير كل 30 ثانية).
        skip_cache = False
        if engine_choice == 'live':
            skip_cache = self._is_live_cache_stale(ticker, persona_str)

        # ── Phase 9: cache lookup (key = ticker + engine_choice + persona) ──
        # لو 'auto' اتـ resolve لـ 'daily'، نستخدم 'daily' كـ cache key عشان
        # 'auto' و 'daily' يشاركوا نفس الـ entry.
        # P15: الـ persona بقى جزء من الـ key عشان كل persona ياخد cache مستقل.
        # P19: للـ 'live' بنعمل bypass لو الكاش stale (DB أحدث).
        if _PHASE9_AVAILABLE and analysis_cache is not None and not skip_cache:
            cached = analysis_cache.get(ticker, engine_choice, persona_str)
            if cached is not None:
                self._stats['cache_hits'] += 1
                # الـ cached response فيه كل الـ standard keys + cached=True
                return cached
            self._stats['cache_misses'] += 1
        elif skip_cache:
            self._stats['live_cache_bypass_stale'] += 1

        start = time.time()

        try:
            if engine_choice == 'live':
                raw_data = self._run_live(ticker, **kwargs)
                self._stats['live'] += 1
                engine_name = 'live_indicator_engine'
            elif engine_choice == 'full':
                raw_data = self._run_full(ticker, **kwargs)
                self._stats['full'] += 1
                engine_name = 'master_analyzer_full'
            else:  # 'daily'
                raw_data = self._run_daily(ticker, **kwargs)
                self._stats['daily'] += 1
                engine_name = 'master_analyzer'

            timing_ms = round((time.time() - start) * 1000, 1)

            # ── Phase 9: standardize response shape ──
            if _PHASE9_AVAILABLE and StandardAnalysisResponse is not None:
                response = StandardAnalysisResponse.from_engine_result(
                    ticker=ticker,
                    intent=engine_choice,
                    engine_result=raw_data if isinstance(raw_data, dict) else {'raw': str(raw_data)},
                    engine_name=engine_name,
                    timing_ms=timing_ms,
                    cached=False,
                    fallback=fallback,
                )
                result = response.to_dict()
            else:
                # Fallback للـ shape القديم (لو core.models مش متاح)
                result = {
                    'success': raw_data.get('success', True) if isinstance(raw_data, dict) else True,
                    'engine': engine_name,
                    'intent_requested': intent,
                    'intent_used': engine_choice,
                    'fallback': fallback,
                    'timing_ms': timing_ms,
                    'data': raw_data,
                }

            # ── Phase 9: cache the successful result ──
            # P15: stash the persona in the cache key so investor/gambler
            # results never bleed into each other.
            # P19: للـ 'live' بنسجل وقت الـ set عشان نقدر نقارنه مع DB last_updated.
            if _PHASE9_AVAILABLE and analysis_cache is not None and result.get('success', True):
                analysis_cache.set(ticker, engine_choice, result, persona_str)
                if engine_choice == 'live':
                    cache_key = (
                        str(ticker).strip().upper(),
                        str(engine_choice).strip().lower(),
                        persona_str,
                    )
                    self._cache_set_times[cache_key] = time.time()

            return result

        except Exception as e:
            self._stats['errors'] += 1
            self._logger.exception(f"Router error for {ticker} (intent={intent}): {e}")
            timing_ms = round((time.time() - start) * 1000, 1)
            if _PHASE9_AVAILABLE and StandardAnalysisResponse is not None:
                return StandardAnalysisResponse.error_response(  # type: ignore[union-attr]
                    ticker=ticker, intent=engine_choice, error=str(e),
                    engine=engine_name if 'engine_name' in locals() else None,
                    timing_ms=timing_ms,
                ).to_dict()
            return {
                'success': False,
                'error': str(e),
                'engine': None,
                'intent_requested': intent,
                'intent_used': engine_choice,
                'fallback': fallback,
                'timing_ms': timing_ms,
            }

    # -----------------------------------------------------------------
    # المحركات الفعلية (wrappers)
    # -----------------------------------------------------------------
    def _run_live(self, ticker: str, **kwargs) -> Dict[str, Any]:
        """
        LiveIndicatorEngine — تحليل لحظي خفيف (30-80ms).
        بيستخدم آخر cache + شمعة اليوم. مفيش تحليل كامل.
        """
        engine = self._get_live_engine()
        if engine is None:
            raise RuntimeError("LiveIndicatorEngine not available")

        result = engine.calculate_live_score(ticker)
        # normalize الـ output shape
        if not isinstance(result, dict):
            result = {'success': False, 'error': 'live engine returned non-dict'}
        # ضمان إن فيه fields أساسية
        result.setdefault('success', True)
        result.setdefault('engine', 'live_indicator_engine')
        result.setdefault('ticker', ticker)
        result.setdefault('mode', 'live')
        return result

    def _run_daily(self, ticker: str, **kwargs) -> Dict[str, Any]:
        """
        MasterAnalyzer + V20 Fusion — تحليل يومي كامل (2-4s).
        بيمرّ على كل الـ layers + الـ fundamental gatekeeper + V20 fusion.
        """
        engine = self._get_master_engine()
        if engine is None:
            raise RuntimeError("MasterAnalyzer not available")

        # استخرج kwargs اللي MasterAnalyzer.analyze بيفهمها
        prices = kwargs.get('prices')
        volumes = kwargs.get('volumes')
        market_pulse = kwargs.get('market_pulse')
        history = kwargs.get('history')

        analysis = engine.analyze(
            ticker=ticker,
            prices=prices,
            volumes=volumes,
            market_pulse=market_pulse,
            history=history,
        )

        # حوّل الـ MasterAnalysis dataclass لـ dict
        try:
            data = analysis.to_dict() if hasattr(analysis, 'to_dict') else analysis.__dict__
        except Exception:
            data = {'raw': str(analysis)}

        data.setdefault('success', True)
        data.setdefault('engine', 'master_analyzer')
        data.setdefault('ticker', ticker)
        data.setdefault('mode', 'daily')
        return data

    def _run_full(self, ticker: str, **kwargs) -> Dict[str, Any]:
        """
        MasterAnalyzer full pipeline (الأبطأ، الأشمل).
        نفس الـ daily بس مع analyze_with_learning لو متاح.
        """
        engine = self._get_master_engine()
        if engine is None:
            raise RuntimeError("MasterAnalyzer not available")

        prices = kwargs.get('prices')
        volumes = kwargs.get('volumes')
        market_pulse = kwargs.get('market_pulse')
        history = kwargs.get('history')

        # جرّب analyze_with_learning الأول (الأشمل)، fallback لـ analyze العادي
        try:
            if hasattr(engine, 'analyze_with_learning'):
                analysis = engine.analyze_with_learning(
                    ticker=ticker,
                    prices=prices,
                    volumes=volumes,
                    market_pulse=market_pulse,
                    history=history,
                )
            else:
                analysis = engine.analyze(
                    ticker=ticker,
                    prices=prices,
                    volumes=volumes,
                    market_pulse=market_pulse,
                    history=history,
                )
        except Exception:
            analysis = engine.analyze(
                ticker=ticker,
                prices=prices,
                volumes=volumes,
                market_pulse=market_pulse,
                history=history,
            )

        try:
            data = analysis.to_dict() if hasattr(analysis, 'to_dict') else analysis.__dict__
        except Exception:
            data = {'raw': str(analysis)}

        data.setdefault('success', True)
        data.setdefault('engine', 'master_analyzer_full')
        data.setdefault('ticker', ticker)
        data.setdefault('mode', 'full')
        return data

    # -----------------------------------------------------------------
    # أدوات مساعدة
    # -----------------------------------------------------------------
    def get_stats(self) -> Dict[str, int]:
        """إحصائيات التوجيه (live/daily/full/fallbacks/errors/cache_hits/misses)."""
        return dict(self._stats)

    def get_cache_stats(self) -> Dict[str, Any]:
        """إحصائيات الكاش (hits/misses/hit_rate/size) — Phase 9."""
        if _PHASE9_AVAILABLE and analysis_cache is not None:
            return analysis_cache.get_stats()
        return {'available': False, 'reason': 'cache_manager not loaded'}

    def invalidate_cache(
        self, ticker: str, intent: Optional[str] = None, persona: Optional[str] = None
    ) -> int:
        """
        امسح entries السهم من الكاش. استخدمها بعد أي analyze جديد عشان
        الكاش مايرجّعش stale data.

        Args:
            ticker: رمز السهم.
            intent: لو محدد، بيمسح intent واحد بس. لو None بيمسح الكل.
            persona: لو محدد مع intent، بيمسح persona واحدة بس. لو intent=None
                الـ persona بتتجاهل (بيمسح كل personas).

        Returns:
            عدد الـ entries اللي اتمسحت.
        """
        # P19: امسح كمان الـ set-time tracking
        ticker_u = str(ticker).strip().upper()
        intent_l = str(intent).strip().lower() if intent else None
        persona_l = str(persona).strip().lower() if persona else None
        if intent_l is None:
            # امسح كل entries الـ ticker ده (كل intents + personas)
            keys_to_drop = [k for k in self._cache_set_times if k[0] == ticker_u]
            for k in keys_to_drop:
                self._cache_set_times.pop(k, None)
        else:
            key = (ticker_u, intent_l, persona_l)
            self._cache_set_times.pop(key, None)

        if _PHASE9_AVAILABLE and analysis_cache is not None:
            return analysis_cache.invalidate(ticker, intent, persona)
        return 0

    # -----------------------------------------------------------------
    # P19-REAL-TIME-SYNC-PRACTICAL-ANALYSIS: Live cache freshness check
    # -----------------------------------------------------------------
    def _is_live_cache_stale(self, ticker: str, persona: Optional[str]) -> bool:
        """
        P19: اتشيك هل الكاش بتاع intent='live' للسهم ده stale (الـ DB عنده
        سعر أحدث من وقت آخر cache set) ولا لأ.

        Logic:
          1. لو مفيش cache entry أصلاً (مفيش set-time) → رجّع False (الكاش
             مش موجود أصلاً، مش بنعمل bypass، الـ lookup العادي هيرجع None
             والـ engine هيشتغل).
          2. لو الـ LiveIndicatorEngine مش متاح → رجّع False (مفيش DB check).
          3. اقرأ stocks.last_updated من DB.
          4. حوّل الـ ISO timestamp لـ epoch seconds.
          5. قارن مع الـ cache set time (monotonic time.time() → wall time).
             لو DB أحدث → رجّع True (stale → bypass الكاش).

        Args:
            ticker: رمز السهم.
            persona: persona string أو None.

        Returns:
            True لو الكاش stale ولازم نعمل bypass، False لو valid أو مش موجود.
        """
        cache_key = (
            str(ticker).strip().upper(),
            'live',
            str(persona).strip().lower() if persona else None,
        )
        cache_set_monotonic = self._cache_set_times.get(cache_key)
        if cache_set_monotonic is None:
            # مفيش cache entry — مش bypass، خلّي الـ lookup العادي يتعمل
            return False

        # اقرأ stocks.last_updated من DB عبر الـ LiveIndicatorEngine
        engine = self._get_live_engine()
        if engine is None:
            return False

        try:
            db_last_updated_str = engine.get_db_last_updated(ticker)
            if not db_last_updated_str:
                # الـ DB مفيهوش last_updated → مش بنقدر نقارن، اعتبر الكاش valid
                self._stats['live_cache_bypass_no_ts'] += 1
                return False

            # حوّل الـ ISO timestamp لـ epoch seconds
            db_epoch = self._parse_iso_to_epoch(db_last_updated_str)
            if db_epoch is None:
                return False

            # الـ cache_set_monotonic هو time.time() (wall clock) — نقارنه مباشرة
            # مع db_epoch (اللي هو wall clock من ISO).
            # لو DB أحدث من وقت الـ set بـ 1 ثانية على الأقل → stale
            if db_epoch > cache_set_monotonic + 1.0:
                return True
            return False
        except Exception:
            return False

    @staticmethod
    def _parse_iso_to_epoch(iso_str: str) -> Optional[float]:
        """حوّل ISO timestamp (مع أو بدون timezone) لـ epoch seconds."""
        if not iso_str:
            return None
        try:
            # محاولة parse بصيغ مختلفة
            from datetime import datetime as _dt
            # لو فيه 'T' وكسر ثواني → ISO format
            s = iso_str.strip()
            # شيل الـ 'Z' لو موجودة
            if s.endswith('Z'):
                s = s[:-1]
            # جرّب fromisoformat (Python 3.7+)
            try:
                dt = _dt.fromisoformat(s)
                return dt.timestamp()
            except ValueError:
                pass
            # جرّب صيغة بدون كسر ثواني: 'YYYY-MM-DD HH:MM:SS'
            for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M:%S.%f',
                        '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%S.%f'):
                try:
                    dt = _dt.strptime(s, fmt)
                    return dt.timestamp()
                except ValueError:
                    continue
            return None
        except Exception:
            return None

    def session_status(self) -> Dict[str, Any]:
        """حالة جلسة EGX الحالية."""
        now = _cairo_now()
        return {
            'cairo_time': now.strftime('%Y-%m-%d %H:%M:%S'),
            'is_session_open': _is_egx_session_open(now),
            'weekday': now.strftime('%A'),
            'live_engine_available': self._get_live_engine() is not None,
            'master_engine_available': self._get_master_engine() is not None,
        }


# ---------------------------------------------------------------------------
# الـ singleton instance — دي النقطة اللي الـ endpoints بتستخدمها
# ---------------------------------------------------------------------------
decision_router = DecisionRouter()


# ---------------------------------------------------------------------------
# دوال مستوى الـ module (للـ backward compat)
# ---------------------------------------------------------------------------
def route(ticker: str, intent: Intent = 'auto', **kwargs) -> Dict[str, Any]:
    """وجّه طلب تحليل للمحرك المناسب."""
    return decision_router.route(ticker, intent=intent, **kwargs)


def decide(intent: Intent = 'auto') -> str:
    """قرر المحرك بدون تشغيل."""
    return decision_router.decide(intent)


# ---------------------------------------------------------------------------
# اختبار سريع (python3 core/router.py)
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("DecisionRouter — Session Status + Phase 9 Cache")
    print("=" * 60)
    status = decision_router.session_status()
    for k, v in status.items():
        print(f"  {k:25s}: {v}")
    print()
    print("Decision for intent='auto':", decision_router.decide('auto'))
    print("Decision for intent='live':", decision_router.decide('live'))
    print("Decision for intent='daily':", decision_router.decide('daily'))
    print("Decision for intent='full':", decision_router.decide('full'))
    print()
    print("Phase 9 Cache stats:")
    cache_stats = decision_router.get_cache_stats()
    for k, v in cache_stats.items():
        print(f"  {k:20s}: {v}")
    print()
    print("Router stats:", decision_router.get_stats())
