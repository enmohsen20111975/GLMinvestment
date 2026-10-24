#!/usr/bin/env python3
"""
logging_config.py — Central Logging Configuration (Phase 3 Task 4)
===================================================================

المشكلة (قبل Phase 3):
----------------------
الـ Backend بيطبع Debug logs و Warnings كتير جداً:
  - `INFO: 127.0.0.1:xxxxx - "GET /api/market-pulse HTTP/1.1" 200 OK` (uvicorn access log — كل طلب)
  - `WARNING: httpx retry attempt 1/3 for ...` (retry noise)
  - `WARNING: urllib3 connection pool full` (connection pool noise)
  - `INFO: apscheduler.executors.default: Running job ...` + `executed successfully` (every job tick)
  - `tab_valuation missing` (repeated 1000+ times during analysis)

ده بيملي الـ Log files بسرعة (python_backend.log وصل لـ 78KB في ساعتين) و
بيبطئ الـ I/O.

الحل (Phase 3):
--------------
`setup_logging()` بتعمل configuration مركزية للـ logging:

  1. **Root logger**: WARNING level (نظهر بس اللي مهم)
  2. **Our modules** (`vps-service.analyzers.*`, `vps-service.api.*`, `core.*`,
     `jobs.*`, `ai.*`): INFO/DEBUG level (نشوف الـ diagnostics بتاعتنا)
  3. **Libraries** (`httpx`, `urllib3`, `apscheduler.executors.default`,
     `apscheduler.scheduler`, `uvicorn.access`): WARNING level (نخفي الـ noise)
  4. **Pattern filter**: Suppress specific known-noise messages (e.g.
     `tab_valuation missing`, `httpx retry`) via regex filter.

Usage:
  >>> from core.logging_config import setup_logging
  >>> setup_logging()  # call once at startup (main.py / lightweight_server.py)
  >>> import logging
  >>> logging.getLogger(__name__).info("هتراها لأن الكود بتاعنا")

Author: دليل الاستثمار (Phase 3 — Arteries Cleanup & Fast Boot)
"""

from __future__ import annotations

import logging
import re
import os
import sys
from typing import List, Optional, Pattern


# ============================================================================
# Constants
# ============================================================================

# Default log level for our own modules (overridable via env var)
_OUR_MODULES_LEVEL = os.environ.get('LOG_LEVEL_OUR', 'INFO').upper()
# Default log level for third-party libraries
_LIB_LEVEL = os.environ.get('LOG_LEVEL_LIB', 'WARNING').upper()
# Default log level for the root logger
_ROOT_LEVEL = os.environ.get('LOG_LEVEL_ROOT', 'WARNING').upper()

# Our module name prefixes (these get the verbose level)
_OUR_MODULE_PREFIXES = (
    'vps-service',
    'vps_service',
    'core',
    'jobs',
    'ai',
    'analyzers',
    'api',
    'engine',
    'engines',
    'portfolio',
    'utils',
    'data',
    '__main__',  # scripts run directly
)

# Library loggers that should be silenced (WARNING level)
_NOISY_LIBS = (
    'httpx',
    'httpcore',
    'urllib3',
    'urllib3.connectionpool',
    'requests',
    'requests.packages.urllib3',
    'apscheduler.executors.default',  # "Running job X" + "executed successfully"
    'apscheduler.scheduler',          # "Added job X" + "Removed job X"
    'apscheduler.triggers.interval',
    'apscheduler.triggers.cron',
    'uvicorn.access',                 # "GET /api/market-pulse 200 OK" per request
    'uvicorn.asgi',
    'werkzeug',                       # Flask debug noise
    'asyncio',
    'filelock',
    'markdown_it',
    'chardet.charsetprober',
    'PIL.PngImagePlugin',
    'matplotlib',
    'matplotlib.font_manager',
)

# Specific message patterns to suppress entirely (regex, case-insensitive).
# These are known-noise messages that we've audited and decided aren't useful
# in production. They're suppressed via a Filter (not by raising the level),
# so genuine errors at WARNING/ERROR level still get through.
_SUPPRESSED_PATTERNS: List[str] = [
    # tab_valuation / tab_profitability missing during fundamental fetch
    r'tab_valuation\s+(missing|not available|empty)',
    r'tab_profitability\s+(missing|not available|empty)',
    # httpx retry noise
    r'httpx.*retry.*attempt',
    r'connection.*reset.*by.*peer',
    # urllib3 connection pool noise
    r'connection\s*pool\s*is\s*full',
    r'urllib3.*will\s*retry',
    # apscheduler per-tick execution messages (we have our own listener)
    r'apscheduler\.executors\.default.*Running job',
    r'apscheduler\.executors\.default.*executed successfully',
    r'apscheduler\.scheduler.*Added job',
    r'apscheduler\.scheduler.*Removed job',
    # uvicorn HTTP access noise (every single GET/POST)
    r'GET\s+/api/market-pulse\s+HTTP',
    r'POST\s+/api/market-pulse\s+HTTP',
    # Common connection retries on local services
    r'NewConnectionError.*127\.0\.0\.1:5000',  # data_engine heartbeat
    r'NewConnectionError.*127\.0\.0\.1:8010',  # self-references
]

# Compile patterns once at import time (small perf win)
_COMPILED_PATTERNS: List[Pattern[str]] = [
    re.compile(p, re.IGNORECASE) for p in _SUPPRESSED_PATTERNS
]


# ============================================================================
# Filter — suppresses messages matching the noise patterns
# ============================================================================

class NoiseFilter(logging.Filter):
    """Filter that suppresses log records matching known noise patterns.

    A filter (vs. raising the level) is the right tool here because:
      - The patterns are message-level, not logger-level (e.g. we want to keep
        genuine httpx ERROR logs but suppress INFO/WARNING retry noise).
      - Raising the level on `httpx` to WARNING would hide retried-and-succeeded
        warnings, which we DO want to know about.
      - The filter only drops the matching messages; everything else flows
        through to the normal handlers.
    """

    def __init__(self, name: str = 'NoiseFilter'):
        super().__init__(name)
        self._suppressed_count = 0

    def filter(self, record: logging.LogRecord) -> bool:
        """Return True to keep the record, False to suppress it."""
        try:
            msg = record.getMessage()
        except Exception:
            # If formatting fails, keep the record (safer than dropping)
            return True

        for pattern in _COMPILED_PATTERNS:
            if pattern.search(msg):
                self._suppressed_count += 1
                return False
        return True

    def stats(self) -> int:
        """Return the count of suppressed records (for observability)."""
        return self._suppressed_count


# Module-level singleton so we can query it from /api/admin/logging-status
_noise_filter = NoiseFilter()


# ============================================================================
# Custom formatter — concise + structured
# ============================================================================

class _ConciseFormatter(logging.Formatter):
    """Concise formatter: timestamp [LEVEL] logger: message.

    Example:
      2026-07-29 16:10:23 [INFO] core.scheduler_manager: Started (apscheduler, workers=4)
    """

    def __init__(self):
        super().__init__(
            fmt='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S',
        )

    def format(self, record: logging.LogRecord) -> str:
        # Truncate very long messages (prevents log-bomb from e.g. full DB dumps)
        msg = super().format(record)
        if len(msg) > 2000:
            return msg[:2000] + '... [truncated]'
        return msg


# ============================================================================
# Public API
# ============================================================================

def setup_logging(
    root_level: Optional[str] = None,
    our_level: Optional[str] = None,
    lib_level: Optional[str] = None,
    attach_to_handlers: bool = True,
) -> dict:
    """Configure logging across the entire application.

    Idempotent: safe to call multiple times. Subsequent calls just re-apply
    the level settings (cheap).

    Args:
        root_level: Level for the root logger (default: env LOG_LEVEL_ROOT or 'WARNING').
        our_level: Level for our own modules (default: env LOG_LEVEL_OUR or 'INFO').
        lib_level: Level for third-party libraries (default: env LOG_LEVEL_LIB or 'WARNING').
        attach_to_handlers: If True (default), attach NoiseFilter to all
            existing handlers (StreamHandler etc.).

    Returns:
        Summary dict with the configured levels (for admin UI / debugging).
    """
    root_lvl = (root_level or _ROOT_LEVEL).upper()
    our_lvl = (our_level or _OUR_MODULES_LEVEL).upper()
    lib_lvl = (lib_level or _LIB_LEVEL).upper()

    # 1. Configure the root logger
    root = logging.getLogger()
    root.setLevel(getattr(logging, root_lvl, logging.WARNING))

    # 2. Ensure there's at least one StreamHandler (with our formatter + filter)
    if not root.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(_ConciseFormatter())
        handler.addFilter(_noise_filter)
        root.addHandler(handler)
    elif attach_to_handlers:
        # Attach the filter + formatter to existing handlers (idempotent)
        for h in root.handlers:
            # Avoid attaching the filter twice
            if not any(getattr(f, 'name', '') == 'NoiseFilter'
                       for f in h.filters):
                h.addFilter(_noise_filter)
            if not isinstance(h.formatter, _ConciseFormatter):
                h.setFormatter(_ConciseFormatter())

    # 3. Set our modules to verbose
    for prefix in _OUR_MODULE_PREFIXES:
        logging.getLogger(prefix).setLevel(getattr(logging, our_lvl, logging.INFO))

    # 4. Silence noisy libraries
    for lib_name in _NOISY_LIBS:
        logging.getLogger(lib_name).setLevel(getattr(logging, lib_lvl, logging.WARNING))

    # 5. Special case: uvicorn's access logger — also silence at WARNING by default
    #    (overridable via env LOG_LEVEL_UVICORN_ACCESS)
    uv_access_lvl = os.environ.get('LOG_LEVEL_UVICORN_ACCESS', 'WARNING').upper()
    logging.getLogger('uvicorn.access').setLevel(
        getattr(logging, uv_access_lvl, logging.WARNING)
    )

    summary = {
        'root_level': root_lvl,
        'our_modules_level': our_lvl,
        'libraries_level': lib_lvl,
        'uvicorn_access_level': uv_access_lvl,
        'our_module_prefixes': list(_OUR_MODULE_PREFIXES),
        'silenced_libraries': list(_NOISY_LIBS),
        'suppressed_patterns_count': len(_SUPPRESSED_PATTERNS),
        'handlers_count': len(root.handlers),
    }
    logging.getLogger(__name__).info(
        "[logging_config] Setup complete — root=%s, our=%s, libs=%s, "
        "uvicorn.access=%s, suppressed_patterns=%d",
        root_lvl, our_lvl, lib_lvl, uv_access_lvl, len(_SUPPRESSED_PATTERNS),
    )
    return summary


def get_status() -> dict:
    """Return the current logging status (for admin UI / debugging)."""
    return {
        'suppressed_count': _noise_filter.stats(),
        'suppressed_patterns': _SUPPRESSED_PATTERNS,
        'silenced_libraries': list(_NOISY_LIBS),
        'our_module_prefixes': list(_OUR_MODULE_PREFIXES),
        'effective_levels': {
            'root': logging.getLevelName(logging.getLogger().level),
            'httpx': logging.getLevelName(logging.getLogger('httpx').level),
            'urllib3': logging.getLevelName(logging.getLogger('urllib3').level),
            'apscheduler.executors.default': logging.getLevelName(
                logging.getLogger('apscheduler.executors.default').level
            ),
            'uvicorn.access': logging.getLevelName(
                logging.getLogger('uvicorn.access').level
            ),
            'vps-service.analyzers': logging.getLevelName(
                logging.getLogger('vps-service.analyzers').level
            ),
            'core': logging.getLevelName(logging.getLogger('core').level),
        },
    }


def reset_filter_stats() -> int:
    """Reset the suppressed-count (returns the previous count)."""
    prev = _noise_filter._suppressed_count
    _noise_filter._suppressed_count = 0
    return prev


# ============================================================================
# Self-test (python3 core/logging_config.py)
# ============================================================================

def _self_test() -> int:
    """Smoke test: setup logging, emit some messages, verify filter works."""
    print("=" * 70)
    print("logging_config self-test")
    print("=" * 70)

    # 1. Setup
    summary = setup_logging()
    print(f"[1] Setup summary: {summary}")

    # 2. Verify our modules are at INFO
    our_logger = logging.getLogger('vps-service.analyzers.test')
    print(f"[2] our logger level: {logging.getLevelName(our_logger.level)}")
    assert our_logger.level <= logging.INFO, "our modules should be INFO or lower"

    # 3. Verify libraries are at WARNING
    httpx_logger = logging.getLogger('httpx')
    print(f"[3] httpx logger level: {logging.getLevelName(httpx_logger.level)}")
    assert httpx_logger.level >= logging.WARNING, "httpx should be WARNING or higher"

    # 4. Emit messages — some should be suppressed
    print("\n[4] Emitting test messages...")
    our_logger.info("This is our own INFO message — should be visible")
    our_logger.warning("This is our own WARNING — should be visible")
    httpx_logger.warning("httpx retry attempt 1/3 for localhost — should be SUPPRESSED")
    httpx_logger.warning("tab_valuation missing for COMI — should be SUPPRESSED")
    httpx_logger.error("httpx genuine error — should be VISIBLE")

    # 5. Check filter stats
    suppressed = _noise_filter.stats()
    print(f"\n[5] Filter suppressed {suppressed} messages")
    assert suppressed >= 2, f"expected at least 2 suppressed, got {suppressed}"

    # 6. Get status
    status = get_status()
    print(f"\n[6] Status: suppressed_count={status['suppressed_count']}")
    print(f"    effective_levels: {status['effective_levels']}")

    # 7. Reset stats
    prev = reset_filter_stats()
    print(f"\n[7] Reset filter stats (was {prev})")
    assert _noise_filter.stats() == 0

    print("\n✅ All self-tests passed.")
    return 0


if __name__ == '__main__':
    sys.exit(_self_test())
