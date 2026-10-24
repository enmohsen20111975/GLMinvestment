#!/usr/bin/env python3
"""
Atomic, cross-process-safe I/O for optimizer_params.json.

Why this module exists
----------------------
Before this fix there were two non-atomic writers of
``config/optimizer_params.json``:

1. ``api/optimizer_params_routes.py::_save_params`` (Flask POST /params, reset)
2. ``jobs/learning_engine.py::_write_param_immediately`` (auto-tuner)

And one reader (``_load_params``) that, on a torn read (``JSONDecodeError``),
would **overwrite the file with DEFAULT_PARAMS** — silently wiping whatever the
other writer had just learned.

This module closes both holes:

* **Atomic write** — write to a temp file in the same directory, ``fsync``,
  then ``os.replace`` (POSIX-atomic). A reader therefore ever sees either the
  previous complete file or the new complete file, never a half-written one.
* **Cross-process lock** — an ``fcntl.flock`` on a sibling ``.optimizer_params.lock``
  file serializes the *read-modify-write* critical section so two concurrent
  writers cannot lose each other's updates (lost-update race).
* **No clobber on read failure** — ``read_params`` returns ``None`` on a corrupt
  / missing file instead of overwriting it; the caller decides the fallback
  (typically: use in-memory defaults, log loudly, and leave the file alone so a
  human can inspect it).

The lock is advisory and best-effort: if ``fcntl`` is unavailable (non-POSIX),
we degrade gracefully to lock-less atomic writes (which still fix the torn-read
bug; only the lost-update race would remain).
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import fcntl  # POSIX-only
    _HAS_FCNTL = True
except ImportError:  # pragma: no cover - Windows / non-POSIX fallback
    _HAS_FCNTL = False


def _lock_path(params_file: Path) -> Path:
    """Sibling lock file used to serialize cross-process read-modify-write."""
    return params_file.parent / f'.{params_file.stem}.lock'


def read_params(params_file: Path) -> Optional[dict]:
    """Read and parse ``params_file``.

    Returns ``None`` if the file is missing, unreadable, or contains invalid
    JSON. **Never raises** and **never overwrites** the file — the caller is
    responsible for choosing a fallback (defaults, alerting, etc.).

    This intentionally replaces the old "self-heal on JSONDecodeError" behavior
    that silently clobbered a possibly-still-being-written file with defaults.
    """
    try:
        if not params_file.exists():
            return None
        with open(params_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning(f"[ParamsIO] {params_file} content is not a dict — ignoring")
            return None
        return data
    except json.JSONDecodeError as e:
        # DO NOT overwrite — the file may be mid-write by another process, or
        # genuinely corrupted. Either way, clobbering silently destroys data.
        logger.error(f"[ParamsIO] JSON parse error on {params_file}: {e} — using in-memory defaults (file left untouched)")
        return None
    except OSError as e:
        logger.error(f"[ParamsIO] OS error reading {params_file}: {e} — using in-memory defaults")
        return None


def write_params_atomic(params_file: Path, params: dict) -> bool:
    """Atomically write ``params`` to ``params_file``.

    Uses ``tempfile + os.replace`` so a reader never observes a partially
    written file. Returns ``True`` on success, ``False`` on failure.
    """
    try:
        params_file.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix=f'.{params_file.stem}_',
            suffix='.tmp',
            dir=str(params_file.parent),
        )
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(params, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, params_file)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return True
    except Exception as e:
        logger.error(f"[ParamsIO] Atomic write failed for {params_file}: {e}")
        return False


class ParamsLock:
    """Context manager wrapping an exclusive ``fcntl.flock`` on a lock file.

    Use it to serialize a *read-modify-write* sequence across processes::

        with ParamsLock(params_file):
            current = read_params(params_file) or {}
            current['key'] = value
            write_params_atomic(params_file, current)

    On non-POSIX platforms (no ``fcntl``) it is a no-op — atomic writes still
    protect against torn reads, but concurrent writers could still lose updates.
    """

    def __init__(self, params_file: Path):
        self._lock_path = _lock_path(params_file)
        self._fh = None

    def __enter__(self) -> 'ParamsLock':
        if not _HAS_FCNTL:
            return self
        try:
            self._lock_path.parent.mkdir(parents=True, exist_ok=True)
            self._fh = open(self._lock_path, 'w')
            fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX)
        except OSError as e:
            # Best-effort: continue without the lock rather than crashing the
            # analysis pipeline. The atomic write still prevents torn reads.
            logger.warning(f"[ParamsLock] Could not acquire flock on {self._lock_path}: {e} — proceeding without lock")
            if self._fh is not None:
                try:
                    self._fh.close()
                except OSError:
                    pass
                self._fh = None
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._fh is None:
            return
        try:
            fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            try:
                self._fh.close()
            except OSError:
                pass
            self._fh = None


def locked_read_modify_write(params_file: Path, updater) -> bool:
    """Acquire the cross-process lock, read current params, apply ``updater``,
    and atomically write the result back.

    ``updater`` is a callable ``(current: dict | None) -> dict | None``. If it
    returns ``None``, the write is skipped (treat as a no-op). Returns ``True``
    if a write occurred (or was intentionally skipped), ``False`` on error.
    """
    try:
        with ParamsLock(params_file):
            current = read_params(params_file)
            new_params = updater(current)
            if new_params is None:
                return True  # caller signalled "no change"
            if not isinstance(new_params, dict):
                logger.error("[ParamsIO] updater did not return a dict — skipping write")
                return False
            return write_params_atomic(params_file, new_params)
    except Exception as e:
        logger.error(f"[ParamsIO] locked_read_modify_write failed: {e}")
        return False
