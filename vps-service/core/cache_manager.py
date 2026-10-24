"""
cache_manager.py — طبقة الـ Caching الموحّدة (In-Memory TTL Cache)
==================================================================
(Phase 9 — Performance & Stability under load)

المشكلة اللي بتحلها:
    أي طلب من الـ Frontend بيحسب التحليل من الصفر. لو 10 مستخدمين طلبوا
    تحليل COMI في نفس الدقيقة، الـ Python هيحسب 10 مرات والـ CPU هيقلب.
    ده هدران كامل للموارد — نفس النتيجة بتت computed 10x.

الحل:
    طبقة `AnalysisCache` دي بتخزن نتايج التحليل في الذاكرة لمدة 60 ثانية.
    أي طلب تحليل في الـ 60 ثانية دي ياخد النتيجة من الكاش (O(1) lookup)
    بدل ما يشغّل المحرك من جديد.

    الاستخدام:
        from core.cache_manager import analysis_cache

        # قبل ما تشغّل المحرك — اتشيك على الكاش
        cached = analysis_cache.get('COMI', intent='daily')
        if cached is not None:
            return cached  # O(1) hit — مفيش CPU

        # الكاش فاض → شغّل المحرك
        result = decision_router._run_daily('COMI', ...)

        # خزّن النتيجة
        analysis_cache.set('COMI', intent='daily', data=result)

مبدأ التصميم:
    - TTL = 60 ثانية للتحليلات (short-lived — الأسعار بتتغير كل دقيقة).
    - maxsize = 512 entry (يكفي لـ ~100 سهم × 5 intents).
    - Thread-safe (cachetools.TTLCache + threading.Lock).
    - Key = (ticker_upper, intent) — عشان `COMI` و `comi` نفس الكاش.
    - بيفضّل `cachetools.TTLCache` (لو متاح) ويسقط لـ `functools.lru_cache`
      fallback مكتوب يدوياً (لو cachetools مش متاح).
    - invalidate(ticker) لمسح كل entries السهم لما يجي تحليل جديد.
    - إحصائيات (hits/misses/hit_rate) للـ monitoring.

ملاحظة:
    الكاش ده للـ READS (نتايج التحليل) بس — مش للـ DB writes.
    لو فيه تحليل جديد اتعمل (analyze + store)، الـ caller لازم ينادي
    `analysis_cache.invalidate(ticker)` عشان الكاش مايرجّعش stale data.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional, Tuple

# ---------------------------------------------------------------------------
# cachetools (preferred) مع fallback لـ in-memory dict + timestamps
# ---------------------------------------------------------------------------
try:
    from cachetools import TTLCache  # type: ignore

    _HAS_CACHETOOLS = True
except ImportError:  # pragma: no cover
    _HAS_CACHETOOLS = False


# ---------------------------------------------------------------------------
# الإعدادات الافتراضية
# ---------------------------------------------------------------------------
DEFAULT_TTL_SECONDS = 60       # التحليل بيتخزن لـ 60 ثانية
DEFAULT_MAX_SIZE = 512         # max ~100 سهم × 5 intents


# ---------------------------------------------------------------------------
# AnalysisCache — الـ Singleton
# ---------------------------------------------------------------------------
class AnalysisCache:
    """
    In-memory TTL cache لنتايج التحليل (DecisionRouter output).

    - Key: (ticker_upper, intent) — لو الـ intent='auto'، بيتـ resolve للـ intent
      الفعلي (live/daily/full) قبل التخزين عشان `auto` و `daily` ميتخزنوش منفصلين.
    - Value: الـ dict اللي الـ router بيرجّعه (شامل `data` + `timing_ms` + ...).
    - TTL: 60 ثانية افتراضياً.
    - Thread-safe: كل العمليات بتمرّ بـ `self._lock`.
    """

    _instance: Optional["AnalysisCache"] = None
    _instance_lock = threading.Lock()

    def __new__(cls, *args, **kwargs) -> "AnalysisCache":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(
        self,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        max_size: int = DEFAULT_MAX_SIZE,
    ) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._logger = logging.getLogger("cache_manager")
        self._ttl = ttl_seconds
        self._max_size = max_size
        self._lock = threading.Lock()

        if _HAS_CACHETOOLS:
            # TTLCache بيمسح الـ expired entries تلقائياً عند الـ access
            self._cache: Any = TTLCache(maxsize=max_size, ttl=ttl_seconds)
        else:
            # Fallback: dict + timestamps يدوي
            self._cache = {}  # type: ignore[assignment]
            self._timestamps: Dict[Tuple[str, str], float] = {}

        # إحصائيات
        self._stats: Dict[str, int] = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'invalidations': 0,
            'evictions': 0,
        }

    # -----------------------------------------------------------------
    # Key builder
    # -----------------------------------------------------------------
    @staticmethod
    def _make_key(
        ticker: str, intent: str, persona: Optional[str] = None
    ) -> Tuple[str, str, Optional[str]]:
        """بناء الـ cache key.

        بيوّحد الحالة (uppercase ticker + lowercase intent + lowercase persona).

        P15-LIVE-UX-AUTH-FIXES (Task 3): الـ persona بقى جزء من الـ cache key
        عشان الـ investor و الـ gambler ما يشاركوش نفس الـ cached result.
        لو persona=None أو فارغة، الـ key بيبقى (ticker, intent, None) —
        backward compatible مع اللي بياخدوا تحليل من غير persona.
        """
        p = str(persona).strip().lower() if persona else None
        return (str(ticker).strip().upper(), str(intent).strip().lower(), p)

    # -----------------------------------------------------------------
    # GET — هل فيه نتيجة محفوظة؟
    # -----------------------------------------------------------------
    def get(
        self, ticker: str, intent: str, persona: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        رجّع النتيجة المحفوظة لو لسه valid، وإلا None.

        Args:
            ticker: رمز السهم.
            intent: 'live' | 'daily' | 'full' | 'auto'.
            persona: 'investor' | 'gambler' | None. لو متحدد، الـ cache key
                بيشمله عشان كل persona ياخد نتيجته الخاصة.

        Returns:
            dict (نسخة من الـ cached result) أو None لو مفيش/انتهى.
            النتيجة فيها `cached: True` flag عشان الـ caller يعرف.
        """
        key = self._make_key(ticker, intent, persona)
        with self._lock:
            if _HAS_CACHETOOLS:
                value = self._cache.get(key)
                if value is not None:
                    self._stats['hits'] += 1
                    # رجّع نسخة + flag
                    result = dict(value)
                    result['cached'] = True
                    return result
                self._stats['misses'] += 1
                return None
            else:
                # Fallback: اتشيك على الـ TTL يدوياً
                if key not in self._cache:
                    self._stats['misses'] += 1
                    return None
                age = time.time() - self._timestamps.get(key, 0)
                if age > self._ttl:
                    # expired — امسحه
                    self._cache.pop(key, None)
                    self._timestamps.pop(key, None)
                    self._stats['misses'] += 1
                    return None
                self._stats['hits'] += 1
                result = dict(self._cache[key])
                result['cached'] = True
                return result

    # -----------------------------------------------------------------
    # SET — خزّن نتيجة
    # -----------------------------------------------------------------
    def set(
        self,
        ticker: str,
        intent: str,
        data: Dict[str, Any],
        persona: Optional[str] = None,
    ) -> None:
        """
        خزّن نتيجة تحليل. بياخد نسخة من الـ data عشان التعديلات الخارجية
        ماتأثرش بالكاش.

        Args:
            ticker: رمز السهم.
            intent: 'live' | 'daily' | 'full' | 'auto'.
            data: الـ dict اللي الـ router بيرجّعه.
            persona: 'investor' | 'gambler' | None. لو متحدد، الـ cache key
                بيشمله عشان كل persona ياخد نتيجته الخاصة.
        """
        key = self._make_key(ticker, intent, persona)
        # نسخة نظيفة — بشيل الـ `cached` flag لو موجود (بيتحط عند الـ get)
        clean = {k: v for k, v in data.items() if k != 'cached'}
        with self._lock:
            if _HAS_CACHETOOLS:
                # cachetools بيتكفّل بالـ eviction
                pre_size = len(self._cache)
                self._cache[key] = dict(clean)
                post_size = len(self._cache)
                if post_size <= pre_size and key not in ():
                    # size مازاد أو ثابت → حصل eviction
                    self._stats['evictions'] += 1
            else:
                self._cache[key] = dict(clean)
                self._timestamps[key] = time.time()
                # eviction يدوي لو تعدّى max_size
                if len(self._cache) > self._max_size:
                    # امسح أقدم entry
                    oldest = min(self._timestamps, key=self._timestamps.get)  # type: ignore[arg-type]
                    self._cache.pop(oldest, None)
                    self._timestamps.pop(oldest, None)
                    self._stats['evictions'] += 1
            self._stats['sets'] += 1

    # -----------------------------------------------------------------
    # INVALIDATE — امسح entries سهم معيّن
    # -----------------------------------------------------------------
    def invalidate(
        self, ticker: str, intent: Optional[str] = None, persona: Optional[str] = None
    ) -> int:
        """
        امسح كل entries السهم ده (أو intent محدد لو اتصدر).

        استخدمها لما يتعمل analyze جديد للسهم عشان الكاش مايرجّعش stale data.

        Args:
            ticker: رمز السهم.
            intent: لو متحدد، بيمسح entries الـ intent ده بس.
            persona: لو متحدد مع intent، بيمسح entry الـ persona دي بس.
                لو intent=None، الـ persona بتتجاهل (بيمسح كل personas).

        Returns:
            عدد الـ entries اللي اتمسحت.
        """
        ticker_u = str(ticker).strip().upper()
        removed = 0
        with self._lock:
            if intent is not None:
                key = self._make_key(ticker, intent, persona)
                if key in self._cache:
                    self._cache.pop(key, None)
                    if not _HAS_CACHETOOLS:
                        self._timestamps.pop(key, None)
                    removed += 1
            else:
                # امسح كل الـ keys اللي الـ ticker بتاعها = ticker_u
                # (كل intents و كل personas)
                keys_to_remove = [
                    k for k in list(self._cache.keys())
                    if isinstance(k, tuple) and len(k) >= 1 and k[0] == ticker_u
                ]
                for k in keys_to_remove:
                    self._cache.pop(k, None)
                    if not _HAS_CACHETOOLS:
                        self._timestamps.pop(k, None)
                    removed += 1
            self._stats['invalidations'] += removed
        return removed

    # -----------------------------------------------------------------
    # CLEAR — امسح الكاش كله
    # -----------------------------------------------------------------
    def clear(self) -> int:
        """امسح كل الـ entries. بيرجّع العدد قبل المسح."""
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            if not _HAS_CACHETOOLS:
                self._timestamps.clear()
            return count

    # -----------------------------------------------------------------
    # STATS — إحصائيات للأداء
    # -----------------------------------------------------------------
    def get_stats(self) -> Dict[str, Any]:
        """إحصائيات الكاش (hits/misses/hit_rate/size/evictions)."""
        with self._lock:
            hits = self._stats['hits']
            misses = self._stats['misses']
            total = hits + misses
            hit_rate = round(hits / total, 4) if total > 0 else 0.0
            return {
                'hits': hits,
                'misses': misses,
                'hit_rate': hit_rate,
                'sets': self._stats['sets'],
                'invalidations': self._stats['invalidations'],
                'evictions': self._stats['evictions'],
                'current_size': len(self._cache),
                'max_size': self._max_size,
                'ttl_seconds': self._ttl,
                'backend': 'cachetools.TTLCache' if _HAS_CACHETOOLS else 'dict+timestamps(fallback)',
            }

    def reset_stats(self) -> None:
        """صفر الإحصائيات (للـ benchmarking)."""
        with self._lock:
            self._stats = {
                'hits': 0, 'misses': 0, 'sets': 0,
                'invalidations': 0, 'evictions': 0,
            }


# ---------------------------------------------------------------------------
# الـ singleton instance — دي النقطة اللي الـ router بيستخدمها
# ---------------------------------------------------------------------------
analysis_cache = AnalysisCache()


# ---------------------------------------------------------------------------
# دوال مستوى الـ module (للـ backward compat + استدعاءات مختصرة)
# ---------------------------------------------------------------------------
def get(
    ticker: str, intent: str, persona: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Shortcut: analysis_cache.get(ticker, intent, persona)."""
    return analysis_cache.get(ticker, intent, persona)


def set_(
    ticker: str,
    intent: str,
    data: Dict[str, Any],
    persona: Optional[str] = None,
) -> None:
    """Shortcut: analysis_cache.set(ticker, intent, data, persona). (`set` reserved word.)"""
    analysis_cache.set(ticker, intent, data, persona)


def invalidate(
    ticker: str, intent: Optional[str] = None, persona: Optional[str] = None
) -> int:
    """Shortcut: analysis_cache.invalidate(ticker, intent, persona)."""
    return analysis_cache.invalidate(ticker, intent, persona)


def clear() -> int:
    """Shortcut: analysis_cache.clear()."""
    return analysis_cache.clear()


def get_stats() -> Dict[str, Any]:
    """Shortcut: analysis_cache.get_stats()."""
    return analysis_cache.get_stats()


# ---------------------------------------------------------------------------
# اختبار سريع (python3 core/cache_manager.py)
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("AnalysisCache — Self Test")
    print("=" * 60)
    print(f"Backend: {'cachetools.TTLCache' if _HAS_CACHETOOLS else 'dict+timestamps(fallback)'}")
    print(f"TTL: {DEFAULT_TTL_SECONDS}s | Max size: {DEFAULT_MAX_SIZE}")
    print()

    # Test 1: miss → set → hit
    cache = AnalysisCache(ttl_seconds=60, max_size=10)
    print("Test 1: miss → set → hit")
    r = cache.get('COMI', 'daily')
    print(f"  get('COMI','daily') before set → {r}")
    cache.set('COMI', 'daily', {'success': True, 'signal': 'BUY', 'engine': 'master_analyzer'})
    r = cache.get('COMI', 'daily')
    print(f"  get('COMI','daily') after  set → cached={r.get('cached')}, signal={r.get('signal')}")
    assert r is not None and r['cached'] is True and r['signal'] == 'BUY'

    # Test 2: case-insensitive
    print()
    print("Test 2: case-insensitive (comi == COMI)")
    r2 = cache.get('comi', 'DAILY')
    print(f"  get('comi','DAILY') → cached={r2 is not None and r2.get('cached')}")
    assert r2 is not None

    # Test 3: different intent = different cache entry
    print()
    print("Test 3: different intent = different entry")
    r3 = cache.get('COMI', 'live')
    print(f"  get('COMI','live') → {r3} (expected None)")
    assert r3 is None

    # Test 4: invalidate
    print()
    print("Test 4: invalidate('COMI')")
    n = cache.invalidate('COMI')
    print(f"  removed {n} entries")
    print(f"  get('COMI','daily') after invalidate → {cache.get('COMI', 'daily')}")
    assert cache.get('COMI', 'daily') is None

    # Test 5: stats
    print()
    print("Test 5: stats")
    stats = cache.get_stats()
    for k, v in stats.items():
        print(f"  {k:20s}: {v}")

    print()
    print("✅ All tests passed.")


# ===========================================================================
# ApiResponseCache (Phase 8.4) — endpoint-level response caching
# ===========================================================================
# Separate from AnalysisCache (which caches per-ticker analysis results).
# ApiResponseCache caches full HTTP endpoint responses (JSON payloads) keyed
# by (endpoint_name, params_dict). Useful for slow endpoints that return
# market-overview / sector-tracking / investor-flows style data that changes
# on the order of minutes, not seconds.
#
# Design:
#   - TTL per entry (default 300s = 5 minutes).
#   - maxsize eviction (LRU by expiry timestamp when over capacity).
#   - Thread-safe via a single threading.Lock.
#   - Stats: hits/misses/sets/evictions/hit_rate/size.
#   - Singleton instance `api_cache` exported at module level.
# ===========================================================================
class ApiResponseCache:
    """
    In-memory TTL cache for HTTP API endpoint responses.

    Cache key: (endpoint_name, params_canonical_string).
    Cache value: (expiry_timestamp, data).

    Usage:
        from core.cache_manager import api_cache

        # At the start of an endpoint:
        cached = api_cache.get('sector_tracking', params={'market': 'EGX'})
        if cached is not None:
            return cached  # already jsonify'd? — caller decides

        # ... compute response ...
        response_data = {...}
        api_cache.set('sector_tracking', response_data, ttl=300,
                      params={'market': 'EGX'})
        return response_data
    """

    def __init__(self, default_ttl: int = 300, maxsize: int = 256) -> None:
        self._default_ttl = default_ttl
        self._maxsize = maxsize
        # key (str) → (expiry_ts (float), data (Any))
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self._logger = logging.getLogger("api_cache")
        # Stats
        self._stats: Dict[str, int] = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'evictions': 0,
        }

    # ------------------------------------------------------------------
    # Key builder
    # ------------------------------------------------------------------
    @staticmethod
    def _make_key(endpoint: str, params: Optional[Dict[str, Any]] = None) -> str:
        """Build a canonical cache key from endpoint + params.

        The key is endpoint_name|sorted_params_string. Sorting makes the key
        order-independent so {'a':1,'b':2} and {'b':2,'a':1} hit the same entry.
        """
        ep = (endpoint or '').strip().lower()
        if not params:
            return ep
        # Sort keys, stringify values (handle bool/None gracefully).
        items = sorted((str(k), str(v)) for k, v in params.items())
        params_str = '&'.join(f"{k}={v}" for k, v in items)
        return f"{ep}|{params_str}"

    # ------------------------------------------------------------------
    # GET
    # ------------------------------------------------------------------
    def get(
        self, endpoint: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[Any]:
        """Return cached data if present and not expired, else None."""
        key = self._make_key(endpoint, params)
        now = time.time()
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                self._stats['misses'] += 1
                return None
            expiry_ts, data = entry
            if expiry_ts < now:
                # Expired — remove and miss.
                self._cache.pop(key, None)
                self._stats['misses'] += 1
                return None
            # Hit.
            self._stats['hits'] += 1
            return data

    # ------------------------------------------------------------------
    # SET
    # ------------------------------------------------------------------
    def set(
        self,
        endpoint: str,
        data: Any,
        ttl: Optional[int] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Cache `data` for `ttl` seconds (default = self._default_ttl)."""
        key = self._make_key(endpoint, params)
        effective_ttl = self._default_ttl if ttl is None else int(ttl)
        expiry_ts = time.time() + effective_ttl
        with self._lock:
            # Eviction if at capacity and this is a new key.
            if key not in self._cache and len(self._cache) >= self._maxsize:
                # Evict the entry with the earliest expiry_ts (LRU-by-expiry).
                oldest_key = min(self._cache, key=lambda k: self._cache[k][0])
                self._cache.pop(oldest_key, None)
                self._stats['evictions'] += 1
            self._cache[key] = (expiry_ts, data)
            self._stats['sets'] += 1

    # ------------------------------------------------------------------
    # INVALIDATE
    # ------------------------------------------------------------------
    def invalidate(
        self, endpoint: str, params: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Remove a specific cache entry. Returns True if removed, False if not found."""
        key = self._make_key(endpoint, params)
        with self._lock:
            if key in self._cache:
                self._cache.pop(key, None)
                return True
            return False

    # ------------------------------------------------------------------
    # CLEAR
    # ------------------------------------------------------------------
    def clear(self) -> int:
        """Remove all entries. Returns count before clear."""
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            return count

    # ------------------------------------------------------------------
    # STATS
    # ------------------------------------------------------------------
    def get_stats(self) -> Dict[str, Any]:
        """Return cache statistics."""
        with self._lock:
            hits = self._stats['hits']
            misses = self._stats['misses']
            total = hits + misses
            hit_rate = round(hits / total, 4) if total > 0 else 0.0
            return {
                'hits': hits,
                'misses': misses,
                'sets': self._stats['sets'],
                'evictions': self._stats['evictions'],
                'hit_rate': hit_rate,
                'size': len(self._cache),
                'maxsize': self._maxsize,
                'default_ttl': self._default_ttl,
            }

    def reset_stats(self) -> None:
        """Zero the stats counters (for benchmarking)."""
        with self._lock:
            self._stats = {'hits': 0, 'misses': 0, 'sets': 0, 'evictions': 0}


# ---------------------------------------------------------------------------
# Singleton instance — the entry point used by the API layer.
# ---------------------------------------------------------------------------
api_cache = ApiResponseCache(default_ttl=300, maxsize=256)
