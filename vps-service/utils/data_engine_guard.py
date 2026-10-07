"""
data_engine_guard.py — حارس محرك البيانات (Port 5000)
========================================================

الوظيفة:
  - يتأكد إن الـ Data Engine (Flask على port 5000) حي قبل أي تحليل.
  - لو مات → يحاول يقومه (subprocess في background).
  - بعد الإحياء → يطلب refresh للأسعار (POST /trigger/stocks + /trigger/sync).
  - يرجّع True لو الـ engine حي (سواء كان حي أصلاً أو قمناه).

الاستخدام من الـ background_analyzer:
  from utils.data_engine_guard import (
      ensure_data_engine_alive,
      trigger_data_refresh,
      restart_data_engine,
  )

  if not ensure_data_engine_alive(timeout=5):
      # الـ engine ميت وما قدرناش نقومه — skip analysis
      return
  trigger_data_refresh()  # اطلب تحديث الأسعار قبل التحليل

الـ Documentation المرجعي:
  - HOW_WE_ANALYZE_AND_PREDICT.md §17.3 — Stale Price Veto
  - "لو last_update في data_engine.db أقدم من 24 ساعة → رفض التحليل"

@author M2y Platform
@version 1.0.0 — يوليو 2026 (Fix 3 — Force data engine restart)
"""
from __future__ import annotations

import os
import sys
import time
import socket
import logging
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ============================================================================
# Constants
# ============================================================================

DATA_ENGINE_HOST = os.environ.get("DATA_ENGINE_HOST", "127.0.0.1")
DATA_ENGINE_PORT = int(os.environ.get("DATA_ENGINE_PORT", "5000"))
DATA_ENGINE_HEALTH_URL = f"http://{DATA_ENGINE_HOST}:{DATA_ENGINE_PORT}/health"

# موقع سكريبت الـ engine (نبدأه منه لو مات) — canonical: data_engine/main.py
# (engine_server.py + simple_server.py حُذفا في Phase 1 — كانت stale)
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_ENGINE_SCRIPT = _PROJECT_ROOT / "data_engine" / "main.py"
# Log + pid files — honor LOG_DIR env override (Rule 61 — RELATIVE-PATHS-ONLY)
_LOG_DIR = os.environ.get("LOG_DIR", "/tmp")
_ENGINE_LOG = os.path.join(_LOG_DIR, "data_engine.log")
_ENGINE_PID_FILE = os.path.join(_LOG_DIR, "data_engine.pid")

# أقصى محاولات للإحياء
_MAX_REVIVE_ATTEMPTS = 1
_REVIVE_WAIT_SECONDS = 4.0


# ============================================================================
# Health Check
# ============================================================================

def _port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """افحص لو البورت مفتوح (TCP connect)."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def _http_health_ok(timeout: float = 3.0) -> bool:
    """اعمل HTTP GET /health ورجّع True لو status=200."""
    try:
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            DATA_ENGINE_HEALTH_URL,
            method="GET",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def is_data_engine_alive(timeout: float = 3.0) -> bool:
    """سريع: الـ engine حي؟ (HTTP health check)."""
    if not _port_open(DATA_ENGINE_HOST, DATA_ENGINE_PORT, timeout=min(timeout, 1.5)):
        return False
    return _http_health_ok(timeout=timeout)


# ============================================================================
# Restart Logic
# ============================================================================

def _find_python() -> str:
    """ارجع مسار python3 التنفيذي (يفضّل اللي شغّال الكود الحالي)."""
    # 1) sys.executable (الـ interpreter الحالي)
    if sys.executable and os.path.exists(sys.executable):
        return sys.executable
    # 2) python3 من PATH
    for cand in ("python3", "python"):
        try:
            result = subprocess.run(
                ["which", cand], capture_output=True, text=True, timeout=2
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            continue
    return "python3"


def _kill_existing_engine() -> None:
    """اقتل أي عملية Flask شغالة على port 5000 (عشان نتجنب conflict)."""
    try:
        # استخدم fuser لو موجود (أسرع وأأمن)
        result = subprocess.run(
            ["fuser", "-k", f"{DATA_ENGINE_PORT}/tcp"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            logger.info("[DataEngineGuard] Killed existing process on port 5000")
            time.sleep(1)
            return
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    # Fallback: pkill
    try:
        subprocess.run(
            ["pkill", "-f", "data_engine/main.py"],
            capture_output=True, text=True, timeout=5,
        )
        time.sleep(1)
    except Exception:
        pass


def restart_data_engine() -> bool:
    """
    اقوم الـ Data Engine من جديد.
    - يقتل أي عملية شغالة على port 5000.
    - يشغل engine_server.py في background (nohup-style).
    - ينتظر _REVIVE_WAIT_SECONDS ثم يفحص health.
    Returns: True لو الـ engine بقى حي.
    """
    if not _ENGINE_SCRIPT.exists():
        logger.error(f"[DataEngineGuard] engine script not found: {_ENGINE_SCRIPT}")
        return False

    _kill_existing_engine()

    python_bin = _find_python()
    logger.info(
        f"[DataEngineGuard] Starting data engine: {python_bin} {_ENGINE_SCRIPT} "
        f"(log={_ENGINE_LOG})"
    )

    try:
        # nohup-style: detach completely
        log_fp = open(_ENGINE_LOG, "a")
        proc = subprocess.Popen(
            [python_bin, str(_ENGINE_SCRIPT)],
            stdout=log_fp,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,  # detach from parent
            cwd=str(_PROJECT_ROOT),
        )
        # خزّن PID للمرجعية
        try:
            Path(_ENGINE_PID_FILE).write_text(str(proc.pid))
        except Exception:
            pass
        logger.info(f"[DataEngineGuard] data engine PID={proc.pid}")
    except Exception as e:
        logger.error(f"[DataEngineGuard] failed to start engine: {e}")
        return False

    # انتظر ثم افحص
    time.sleep(_REVIVE_WAIT_SECONDS)
    return is_data_engine_alive(timeout=3.0)


# ============================================================================
# Public API
# ============================================================================

def ensure_data_engine_alive(
    timeout: float = 5.0,
    auto_restart: bool = True,
) -> bool:
    """
    تأكد إن الـ Data Engine حي. لو مات وحابب — قومه.

    Args:
        timeout: مهلة فحص الـ health (ثانية).
        auto_restart: لو True، حاول قوم الـ engine لو ميت.

    Returns:
        True لو الـ engine حي (سواء كان حي أصلاً أو قمناه).
        False لو الـ engine ميت وما قدرناش نقومه.
    """
    # 1) فحص سريع
    if is_data_engine_alive(timeout=min(timeout, 2.0)):
        return True

    if not auto_restart:
        return False

    # 2) حاول الإحياء
    for attempt in range(1, _MAX_REVIVE_ATTEMPTS + 1):
        logger.warning(
            f"[DataEngineGuard] data engine dead — revive attempt {attempt}/"
            f"{_MAX_REVIVE_ATTEMPTS}"
        )
        if restart_data_engine():
            logger.info("[DataEngineGuard] ✅ data engine revived successfully")
            return True

    logger.error("[DataEngineGuard] ❌ failed to revive data engine")
    return False


def trigger_data_refresh(timeout: float = 5.0) -> dict:
    """
    اطلب من الـ Data Engine يعمل refresh للأسعار + sync.
    POST /trigger/stocks + POST /trigger/sync.

    Returns: dict فيه النتيجة لكل endpoint.
    """
    import urllib.request
    import urllib.error
    import json

    results = {"stocks": False, "sync": False}
    base = f"http://{DATA_ENGINE_HOST}:{DATA_ENGINE_PORT}"

    for endpoint in ("/trigger/stocks", "/trigger/sync"):
        key = endpoint.rsplit("/", 1)[-1]
        url = base + endpoint
        try:
            req = urllib.request.Request(url, method="POST", data=b"")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    results[key] = True
                    logger.info(f"[DataEngineGuard] refresh OK: {endpoint}")
        except Exception as e:
            logger.warning(f"[DataEngineGuard] refresh failed {endpoint}: {e}")

    return results


def get_engine_status() -> dict:
    """
    استعلم عن حالة الـ engine (GET /status).
    Returns: dict فيه engine_state + db_stats، أو {} لو الـ engine ميت.
    """
    if not is_data_engine_alive(timeout=2.0):
        return {"alive": False, "url": DATA_ENGINE_HEALTH_URL}
    try:
        import urllib.request
        import json
        url = f"http://{DATA_ENGINE_HOST}:{DATA_ENGINE_PORT}/status"
        with urllib.request.urlopen(url, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            data["alive"] = True
            return data
    except Exception as e:
        return {"alive": False, "error": str(e)}


# ============================================================================
# CLI Entry (للاختبار اليدوي)
# ============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(f"Data Engine script: {_ENGINE_SCRIPT}")
    print(f"Health URL:         {DATA_ENGINE_HEALTH_URL}")
    print(f"Alive (initial):    {is_data_engine_alive()}")
    print(f"Status:             {get_engine_status()}")
    print("---")
    print(f"ensure_data_engine_alive: {ensure_data_engine_alive(timeout=8)}")
    if is_data_engine_alive():
        print(f"trigger_data_refresh: {trigger_data_refresh()}")
