#!/usr/bin/env python3
"""
circuit_breaker.py — قاطع الدائرة لمحركات البيانات (Phase 4 Task 1)
====================================================================

المشكلة (قبل Phase 4):
----------------------
لما TradingView أو EGKSCO (أو EGXPilot/Yahoo القديمين) بيقع، الـ Fallback
chain بتفضل تحاول (Retry) في كل مرة الـ Scheduler بيـ tick. ده بيسبّب:
  - CPU waste: كل tick بيفتح HTTP request + يـ parse response + يكتب log
    لمصدر ميت، حتى لو الموقع راجع 5xx من ساعة.
  - Slow response: المستخدم بياخد timeout كامل (10-30s) قبل ما الـ chain
    تنتقل للمصدر التالي.
  - Log noise: كل فشل بيتسجّل → بيملي الـ log files بلا فايدة.

الحل (Phase 4 — Resilience & Observability):
--------------------------------------------
`CircuitBreaker` بياخد فكرة الـ Circuit Breaker Pattern (martinfowler.com)
ويطبّقها على مصادر البيانات:

  3 حالات (States):
  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │   CLOSED ─── failures >= threshold ───> OPEN                │
  │      ▲                                  │                   │
  │      │                                  │ (after cool-down) │
  │      │                                  ▼                   │
  │   success                          HALF_OPEN                │
  │      ▲                                  │                   │
  │      │                                  │                   │
  │      └──── success ─────────────────────┘                   │
  │      └──── failure ──────────> OPEN (reset cool-down)       │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

  - **CLOSED** (الطبيعي): كل الطلبات بتمرّ. بنعدّ الفشل.
  - **OPEN** (مفتوح = Fail Fast): كل طلب بيترفض فوراً (بدون HTTP/DB) عن طريق
    رفع `CircuitOpenError`. ده بيوفر CPU + time. بيفضل Open لمدة `cool_down_seconds`.
  - **HALF_OPEN** (نصف مفتوح): بعد الـ cool-down، بنسمح بـ طلب واحد بس (probe).
    لو نجح → CLOSE. لو فشل → يرجع OPEN مع reset الـ cool-down.

الـ thresholds (defaults حسب رسالة التوجيه):
  - failure_threshold = 5 (5 فشل ورا بعض → Open)
  - cool_down_seconds = 300 (5 دقايق Open)
  - half_open_max_calls = 1 (probe واحد بس)

الاستخدام (في fallback_chain.py):
  >>> from core.circuit_breaker import circuit_registry
  >>> cb = circuit_registry.get('tradingview')
  >>> if cb.is_open():
  ...     # Fail Fast — ماتستدعيش الـ scraper
  ...     return [], 'CircuitBreaker OPEN (5 consecutive failures)'
  >>> try:
  ...     stocks = fetch_tradingview_stocks()
  ...     cb.record_success()
  ...     return stocks, 'success'
  ... except Exception as e:
  ...     cb.record_failure()
  ...     return [], str(e)

الـ Registry:
  بنستخدم `CircuitBreakerRegistry` (singleton) عشان كل الـ circuit breakers
  يكونوا في مكان واحد. ده بيسمح للـ /api/health endpoint يعرض حالتهم كلهم.

التوافق:
  - backward compatible: الـ fallback_chain القديم بيفضل شغّال. الـ circuit
    breaker بيتـ integrate بس لو الـ import ناجح (try/except).
  - ما بيتسمّش أي ملف نظام تشغيل ولا `.env`.

Author: دليل الاستثمار (Phase 4 — Resilience & Observability)
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================================
# Exceptions
# ============================================================================

class CircuitOpenError(Exception):
    """يرفعه الـ CircuitBreaker لما يكون OPEN (Fail Fast).

    الـ caller يعتبرها "فشل مصدر" وينتقل للمصدر التالي في الـ fallback chain،
    بس من غير ما يستهلك HTTP/DB resources.
    """

    def __init__(self, name: str, retry_after_seconds: float):
        self.breaker_name = name
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"CircuitBreaker '{name}' is OPEN — Fail Fast "
            f"(retry in {retry_after_seconds:.0f}s)"
        )


# ============================================================================
# States
# ============================================================================

class CircuitState(str, Enum):
    """حالات الـ Circuit Breaker."""
    CLOSED = 'closed'        # عادي — كل الطلبات بتمرّ
    OPEN = 'open'            # مفتوح — Fail Fast
    HALF_OPEN = 'half_open'  # نصف مفتوح — probe واحد بس


# ============================================================================
# CircuitBreaker
# ============================================================================

class CircuitBreaker:
    """قاطع دائرة واحد لمصدر بيانات واحد.

    Thread-safe (كل الـ mutations بتمرّ بـ `self._lock`).

    Args:
        name: اسم المصدر (زي 'tradingview', 'egksco').
        failure_threshold: عدد الفشل المتتالي اللي يفتح الـ circuit (default 5).
        cool_down_seconds: مدة الـ OPEN قبل الـ HALF_OPEN (default 300s = 5 min).
        half_open_max_calls: عدد الـ probes في HALF_OPEN (default 1).
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        cool_down_seconds: int = 300,
        half_open_max_calls: int = 1,
    ) -> None:
        self.name = name
        self.failure_threshold = max(1, int(failure_threshold))
        self.cool_down_seconds = max(1, int(cool_down_seconds))
        self.half_open_max_calls = max(1, int(half_open_max_calls))

        self._lock = threading.RLock()
        self._state: CircuitState = CircuitState.CLOSED
        self._consecutive_failures: int = 0
        self._consecutive_successes: int = 0
        self._opened_at: Optional[float] = None  # epoch seconds
        self._half_open_calls: int = 0  # probes in current HALF_OPEN window

        # إحصائيات (للـ /api/health + الـ monitoring)
        self._stats: Dict[str, int] = {
            'total_calls': 0,
            'total_successes': 0,
            'total_failures': 0,
            'total_rejected': 0,  # طلبات اترفضت في OPEN (Fail Fast)
            'total_state_transitions': 0,
        }

    # ------------------------------------------------------------------
    # State checks
    # ------------------------------------------------------------------

    @property
    def state(self) -> CircuitState:
        """حالة الـ circuit دلوقتي (مع auto-transition OPEN → HALF_OPEN)."""
        with self._lock:
            self._maybe_transition_to_half_open()
            return self._state

    def is_open(self) -> bool:
        """True لو الـ circuit OPEN (Fail Fast مطلوب).

        لو الـ cool-down خلص، بيتحوّل تلقائياً لـ HALF_OPEN ويرجّع False
        (عشان الـ caller يقدر يعمل probe).
        """
        with self._lock:
            self._maybe_transition_to_half_open()
            # في HALF_OPEN بنسمح بـ probe واحد بس. لو الـ probe ده لسه شغّال
            # (half_open_calls >= max)، نعتبره OPEN للـ callers التانيين.
            if self._state == CircuitState.HALF_OPEN:
                if self._half_open_calls >= self.half_open_max_calls:
                    return True
                return False
            return self._state == CircuitState.OPEN

    def can_pass(self) -> bool:
        """True لو الطلب ممكن يعدّ (CLOSED أو HALF_OPEN مع slot فاضي)."""
        return not self.is_open()

    def retry_after_seconds(self) -> float:
        """لو OPEN، كم ثانية لحد الـ HALF_OPEN؟ (للـ /api/health + Retry-After)."""
        with self._lock:
            if self._state != CircuitState.OPEN or self._opened_at is None:
                return 0.0
            elapsed = time.time() - self._opened_at
            remaining = self.cool_down_seconds - elapsed
            return max(0.0, remaining)

    # ------------------------------------------------------------------
    # Recording outcomes
    # ------------------------------------------------------------------

    def record_success(self) -> None:
        """سجّل نجاح الطلب. في HALF_OPEN → CLOSE. في CLOSED → reset counter."""
        with self._lock:
            self._stats['total_calls'] += 1
            self._stats['total_successes'] += 1
            self._consecutive_failures = 0
            self._consecutive_successes += 1
            self._half_open_calls = 0  # reset probe window

            if self._state == CircuitState.HALF_OPEN:
                self._transition_to(CircuitState.CLOSED)
                logger.info(
                    "[CircuitBreaker:%s] HALF_OPEN → CLOSED (probe succeeded)",
                    self.name,
                )
            elif self._state == CircuitState.CLOSED:
                # Stay closed — just clear failure count (already done above).
                pass
            # In OPEN: success shouldn't be recorded (call shouldn't have passed).
            # But if it is (race), ignore — the OPEN state is authoritative.

    def record_failure(self) -> None:
        """سجّل فشل الطلب. لو وصلنا للـ threshold → OPEN."""
        with self._lock:
            self._stats['total_calls'] += 1
            self._stats['total_failures'] += 1
            self._consecutive_successes = 0
            self._consecutive_failures += 1
            self._half_open_calls = 0  # probe failed — reset

            if self._state == CircuitState.HALF_OPEN:
                # Probe failed → back to OPEN with fresh cool-down.
                self._transition_to(CircuitState.OPEN)
                logger.warning(
                    "[CircuitBreaker:%s] HALF_OPEN → OPEN (probe failed, "
                    "cool-down reset to %ds)",
                    self.name, self.cool_down_seconds,
                )
            elif self._state == CircuitState.CLOSED:
                if self._consecutive_failures >= self.failure_threshold:
                    self._transition_to(CircuitState.OPEN)
                    logger.warning(
                        "[CircuitBreaker:%s] CLOSED → OPEN (%d consecutive "
                        "failures, cool-down=%ds)",
                        self.name, self._consecutive_failures,
                        self.cool_down_seconds,
                    )

    def record_rejected(self) -> None:
        """سجّل طلب اترفض في OPEN (Fail Fast). بنادها قبل ما نرفع CircuitOpenError."""
        with self._lock:
            self._stats['total_rejected'] += 1

    # ------------------------------------------------------------------
    # Manual control (admin)
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Reset الـ circuit لـ CLOSED (يدوي — للـ admin endpoint)."""
        with self._lock:
            prev = self._state
            self._state = CircuitState.CLOSED
            self._consecutive_failures = 0
            self._consecutive_successes = 0
            self._opened_at = None
            self._half_open_calls = 0
            if prev != CircuitState.CLOSED:
                self._stats['total_state_transitions'] += 1
                logger.info(
                    "[CircuitBreaker:%s] Manual reset → CLOSED (was %s)",
                    self.name, prev.value,
                )

    def force_open(self) -> None:
        """افتح الـ circuit يدوياً (للـ maintenance)."""
        with self._lock:
            self._transition_to(CircuitState.OPEN)
            logger.info("[CircuitBreaker:%s] Force OPEN (manual)", self.name)

    # ------------------------------------------------------------------
    # Status (للـ /api/health + admin UI)
    # ------------------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        """حالة الـ circuit كاملة للـ monitoring."""
        with self._lock:
            self._maybe_transition_to_half_open()
            return {
                'name': self.name,
                'state': self._state.value,
                'failure_threshold': self.failure_threshold,
                'cool_down_seconds': self.cool_down_seconds,
                'consecutive_failures': self._consecutive_failures,
                'consecutive_successes': self._consecutive_successes,
                'opened_at': (
                    datetime.fromtimestamp(self._opened_at).isoformat()
                    if self._opened_at else None
                ),
                'retry_after_seconds': round(self.retry_after_seconds(), 1),
                'is_open': self._state == CircuitState.OPEN,
                'stats': dict(self._stats),
            }

    # ------------------------------------------------------------------
    # Internal: state transitions
    # ------------------------------------------------------------------

    def _transition_to(self, new_state: CircuitState) -> None:
        """غيّر الحالة + حدّث الـ meta (opened_at, counters)."""
        if self._state == new_state:
            return
        self._state = new_state
        self._stats['total_state_transitions'] += 1
        if new_state == CircuitState.OPEN:
            self._opened_at = time.time()
            self._half_open_calls = 0
        elif new_state == CircuitState.HALF_OPEN:
            self._half_open_calls = 0
        elif new_state == CircuitState.CLOSED:
            self._opened_at = None
            self._consecutive_failures = 0
            self._half_open_calls = 0

    def _maybe_transition_to_half_open(self) -> None:
        """لو OPEN والـ cool-down خلص → حوّل لـ HALF_OPEN (atomic)."""
        if self._state != CircuitState.OPEN or self._opened_at is None:
            return
        elapsed = time.time() - self._opened_at
        if elapsed >= self.cool_down_seconds:
            self._transition_to(CircuitState.HALF_OPEN)
            logger.info(
                "[CircuitBreaker:%s] OPEN → HALF_OPEN (cool-down elapsed, "
                "allowing 1 probe)",
                self.name,
            )

    # ------------------------------------------------------------------
    # Context manager: مع auto record_success/record_failure
    # ------------------------------------------------------------------

    def call(self, func, *args, **kwargs):
        """شغّل دالة في حماية الـ circuit breaker.

        - لو OPEN: بيرفع CircuitOpenError (Fail Fast) بدون استدعاء func.
        - لو CLOSED/HALF_OPEN: بيستدعي func.
          - نجح → record_success + بيرجّع النتيجة.
          - فشل → record_failure + بيرفع الـ exception الأصلي.

        Example:
            >>> stocks = cb.call(fetch_tradingview_stocks, market='egypt')

        Note: الـ caller لازم يـ catch CircuitOpenError لو عايز Fail Fast
        بدون crash (زي في الـ fallback chain).
        """
        if self.is_open():
            self.record_rejected()
            raise CircuitOpenError(
                self.name, self.retry_after_seconds()
            )
        try:
            result = func(*args, **kwargs)
            self.record_success()
            return result
        except Exception:
            self.record_failure()
            raise


# ============================================================================
# Registry (singleton — كل الـ breakers في مكان واحد)
# ============================================================================

class CircuitBreakerRegistry:
    """Registry مركزي لكل الـ CircuitBreakers.

    بنستخدمه عشان:
      1. الـ /api/health endpoint يعرض حالة كل الـ breakers مرة واحدة.
      2. fallback_chain.py يـ get('tradingview') من غير ما يـ create كل مرة.
      3. الـ admin endpoint يقدر يعمل reset لأي breaker بالاسم.
    """

    _instance: Optional["CircuitBreakerRegistry"] = None
    _instance_lock = threading.Lock()

    def __new__(cls) -> "CircuitBreakerRegistry":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self._lock = threading.RLock()
        self._breakers: Dict[str, CircuitBreaker] = {}
        # Pre-register الـ sources المعروفة (موحّد عبر الـ fallback chain).
        # الـ defaults حسب رسالة التوجيه: 5 failures → 5 min cool-down.
        self._pre_register_defaults()

    def _pre_register_defaults(self) -> None:
        """سجّل الـ sources المعروفة بـ الـ defaults المطلوبة."""
        defaults = [
            # (name, failure_threshold, cool_down_seconds)
            ('tradingview', 5, 300),
            ('egksco', 5, 300),
            # deprecated sources — لسه معرّفين للتوافق بس
            ('egxpilot', 3, 600),   # ميت أصلاً → cool-down أطول
            ('yahoo', 3, 600),      # stale data → cool-down أطول
        ]
        for name, ft, cd in defaults:
            self._breakers[name] = CircuitBreaker(
                name=name, failure_threshold=ft, cool_down_seconds=cd,
            )

    def get(
        self,
        name: str,
        failure_threshold: int = 5,
        cool_down_seconds: int = 300,
    ) -> CircuitBreaker:
        """ارجع الـ breaker للـ source ده (أنشئه لو مش موجود)."""
        key = name.lower().strip()
        with self._lock:
            if key not in self._breakers:
                self._breakers[key] = CircuitBreaker(
                    name=key,
                    failure_threshold=failure_threshold,
                    cool_down_seconds=cool_down_seconds,
                )
            return self._breakers[key]

    def get_status(self) -> Dict[str, Any]:
        """حالة كل الـ breakers (للـ /api/health)."""
        with self._lock:
            breakers = {
                name: cb.get_status()
                for name, cb in self._breakers.items()
            }
            open_count = sum(
                1 for cb in breakers.values() if cb.get('is_open')
            )
        return {
            'total_breakers': len(breakers),
            'open_breakers': open_count,
            'breakers': breakers,
        }

    def reset_all(self) -> int:
        """Reset كل الـ breakers لـ CLOSED (للـ admin). بيرجّع العدد."""
        with self._lock:
            count = 0
            for cb in self._breakers.values():
                cb.reset()
                count += 1
            logger.info(
                "[CircuitBreakerRegistry] Reset all %d breakers to CLOSED",
                count,
            )
            return count

    def reset(self, name: str) -> bool:
        """Reset breaker واحد بالاسم."""
        key = name.lower().strip()
        with self._lock:
            cb = self._breakers.get(key)
            if cb is None:
                return False
            cb.reset()
            return True

    def list_names(self) -> List[str]:
        """أسماء كل الـ breakers المسجّلين."""
        with self._lock:
            return list(self._breakers.keys())


# ============================================================================
# Module-level singleton
# ============================================================================

circuit_registry = CircuitBreakerRegistry()


# ============================================================================
# Module-level convenience API
# ============================================================================

def get_breaker(name: str) -> CircuitBreaker:
    """Shortcut: circuit_registry.get(name)."""
    return circuit_registry.get(name)


def is_open(name: str) -> bool:
    """Shortcut: circuit_registry.get(name).is_open()."""
    return circuit_registry.get(name).is_open()


def record_success(name: str) -> None:
    """Shortcut: circuit_registry.get(name).record_success()."""
    circuit_registry.get(name).record_success()


def record_failure(name: str) -> None:
    """Shortcut: circuit_registry.get(name).record_failure()."""
    circuit_registry.get(name).record_failure()


def get_status() -> Dict[str, Any]:
    """Shortcut: circuit_registry.get_status()."""
    return circuit_registry.get_status()


# ============================================================================
# Self-test (python3 core/circuit_breaker.py)
# ============================================================================

def _self_test() -> int:
    print("=" * 70)
    print("CircuitBreaker self-test (Phase 4 Task 1)")
    print("=" * 70)

    # Test 1: starts CLOSED
    cb = CircuitBreaker('test_source', failure_threshold=3, cool_down_seconds=2)
    print(f"\n[1] Initial state: {cb.state.value} (expected: closed)")
    assert cb.state == CircuitState.CLOSED, "should start CLOSED"
    assert not cb.is_open(), "is_open() should be False initially"
    print("    ✅ starts CLOSED")

    # Test 2: failures below threshold stay CLOSED
    cb.record_failure()
    cb.record_failure()
    print(f"[2] After 2 failures (threshold=3): {cb.state.value} (expected: closed)")
    assert cb.state == CircuitState.CLOSED, "should stay CLOSED below threshold"
    print("    ✅ stays CLOSED below threshold")

    # Test 3: reaching threshold → OPEN
    cb.record_failure()
    print(f"[3] After 3 failures: {cb.state.value} (expected: open)")
    assert cb.state == CircuitState.OPEN, "should be OPEN at threshold"
    assert cb.is_open(), "is_open() should be True"
    print(f"    retry_after_seconds: {cb.retry_after_seconds():.1f}s")
    print("    ✅ transitions to OPEN at threshold")

    # Test 4: OPEN rejects (Fail Fast)
    rejected = False
    cb.record_rejected()
    stats = cb.get_status()['stats']
    print(f"[4] record_rejected() → total_rejected={stats['total_rejected']}")
    assert stats['total_rejected'] == 1, "rejected count should increment"
    print("    ✅ Fail Fast counter increments")

    # Test 5: call() raises CircuitOpenError when OPEN
    raised = False
    try:
        cb.call(lambda: 'should not run')
    except CircuitOpenError as e:
        raised = True
        print(f"[5] call() raised CircuitOpenError: {e}")
    assert raised, "call() should raise CircuitOpenError when OPEN"
    print("    ✅ call() raises CircuitOpenError (Fail Fast)")

    # Test 6: after cool-down → HALF_OPEN
    print(f"[6] Waiting 2.1s for cool-down to elapse...")
    import time as _t
    _t.sleep(2.1)
    state = cb.state  # triggers _maybe_transition_to_half_open
    print(f"    state after cool-down: {state.value} (expected: half_open)")
    assert state == CircuitState.HALF_OPEN, "should be HALF_OPEN after cool-down"
    print("    ✅ transitions to HALF_OPEN after cool-down")

    # Test 7: probe success → CLOSED
    result = cb.call(lambda: 'probe ok')
    print(f"[7] Probe call result: {result!r} → state: {cb.state.value}")
    assert result == 'probe ok'
    assert cb.state == CircuitState.CLOSED, "should be CLOSED after probe success"
    print("    ✅ HALF_OPEN → CLOSED on probe success")

    # Test 8: probe failure → back to OPEN
    # First trigger OPEN again
    cb.record_failure()
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    _t.sleep(2.1)
    assert cb.state == CircuitState.HALF_OPEN
    # Now probe fails
    raised2 = False
    try:
        cb.call(lambda: (_ for _ in ()).throw(ValueError('probe failed')))
    except ValueError:
        raised2 = True
    assert raised2, "probe should raise ValueError"
    print(f"[8] Probe failed → state: {cb.state.value} (expected: open)")
    assert cb.state == CircuitState.OPEN, "should be OPEN after probe failure"
    print("    ✅ HALF_OPEN → OPEN on probe failure (cool-down reset)")

    # Test 9: Registry
    print(f"\n[9] Registry status:")
    reg_status = circuit_registry.get_status()
    print(f"    total_breakers: {reg_status['total_breakers']}")
    print(f"    open_breakers: {reg_status['open_breakers']}")
    print(f"    names: {circuit_registry.list_names()}")
    assert 'tradingview' in circuit_registry.list_names()
    assert 'egksco' in circuit_registry.list_names()
    print("    ✅ registry pre-registered default sources")

    # Test 10: reset
    cb.reset()
    print(f"\n[10] After reset(): state={cb.state.value}")
    assert cb.state == CircuitState.CLOSED
    print("     ✅ reset() → CLOSED")

    print("\n" + "=" * 70)
    print("✅ All CircuitBreaker self-tests passed.")
    print("=" * 70)
    return 0


if __name__ == '__main__':
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    sys.exit(_self_test())
