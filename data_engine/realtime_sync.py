"""
realtime_sync.py — التحديث اللحظي: webhook + post-scrape hook
================================================================
Step 4 من الخطة: بدل المزامنة المجدولة المتباعدة، نُعلِم Next.js فور
انتهاء كل عملية جلب/مزامنة عشان يعيد تحميل الكاش وتظهر البيانات لحظياً.

المكوّنات:
    1) notify_nextjs(event, payload)  — POST webhook لـ Next.js reload endpoint
    2) post_scrape_hook(scraper, sync_result) — يُستدعى بعد كل مزامنة ناجحة
    3) should_notify(scraper) — فلتر: نُعلِم بس للمصادر اللي بتأثر UI

الإعداد (.env في data_engine):
    NEXTJS_WEBHOOK_URL=http://localhost:3000/api/data-engine/reload
    WEBHOOK_SHARED_SECRET=<نفس قيمة SHARED_SECRET في Next.js>
    NEXTJS_WEBHOOK_TIMEOUT=5   (اختياري)

الاستخدام (في main.py run_scraper_and_sync بعد run_full_sync):
    from realtime_sync import post_scrape_hook
    post_scrape_hook(scraper_name, sync_result)

مبدأ التصميم:
    - Non-blocking: لو الـ webhook فشل، ما يوقفش الـ sync (best-effort).
    - Retry خفيف (محاولة واحدة إضافية).
    - Timeout قصير (5ث افتراضي) عشان ما يعلّقش السكريبر.
    - Shared secret للتحقق من الهوية (منع النداءات الخارجية).
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime
from typing import Any


# ──────────────────────────────────────────────────────────────────────────
# Configuration (from env)
# ──────────────────────────────────────────────────────────────────────────

def _webhook_url() -> str | None:
    return os.environ.get("NEXTJS_WEBHOOK_URL")


def _shared_secret() -> str:
    return os.environ.get("WEBHOOK_SHARED_SECRET", os.environ.get("SHARED_SECRET", ""))


def _timeout() -> int:
    try:
        return int(os.environ.get("NEXTJS_WEBHOOK_TIMEOUT", "5"))
    except ValueError:
        return 5


# المصادر اللي بتأثر واجهة Next.js (نُعلِم بس دي)
NOTIFY_SOURCES = {"stocks", "crypto", "metals", "gold", "forex", "historical", "sync"}


def should_notify(scraper_name: str) -> bool:
    """هل نُعلِم Next.js بعد هذا الـ scraper؟"""
    return scraper_name.lower() in NOTIFY_SOURCES


# ──────────────────────────────────────────────────────────────────────────
# Webhook notifier
# ──────────────────────────────────────────────────────────────────────────

def notify_nextjs(event: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    أرسل webhook لـ Next.js لإعادة تحميل الكاش.

    Args:
        event: نوع الحدث ('stocks_synced', 'crypto_synced', 'metals_synced', ...)
        payload: بيانات إضافية (counts, timestamp, ...)

    Returns:
        {success, status, retries, error}
    """
    url = _webhook_url()
    if not url:
        return {"success": False, "status": None, "retries": 0, "error": "NEXTJS_WEBHOOK_URL not set"}

    body = {
        "event": event,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": payload or {},
    }
    secret = _shared_secret()
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Webhook-Secret"] = secret

    data = json.dumps(body).encode("utf-8")
    timeout = _timeout()
    max_retries = 1  # محاولة واحدة إضافية

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = resp.status
                if 200 <= status < 300:
                    return {"success": True, "status": status, "retries": attempt, "error": None}
                last_error = f"HTTP {status}"
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code in (401, 403):
                # secret غلط — ما يعيدش المحاولة
                break
        except urllib.error.URLError as e:
            last_error = f"URLError: {e.reason}"
        except Exception as e:
            last_error = str(e)[:120]

        if attempt < max_retries:
            time.sleep(0.5)

    return {"success": False, "status": None, "retries": max_retries, "error": last_error}


# ──────────────────────────────────────────────────────────────────────────
# Post-scrape hook (يُستدعى بعد كل مزامنة ناجحة)
# ──────────────────────────────────────────────────────────────────────────

def post_scrape_hook(scraper_name: str, sync_result: dict | None = None) -> dict[str, Any]:
    """
    يُستدعى بعد نجاح الـ scraper + المزامنة. يُعلِم Next.js لإعادة تحميل الكاش.

    Args:
        scraper_name: 'stocks' | 'crypto' | 'metals' | 'gold' | 'forex' | ...
        sync_result: ناتج run_full_sync ({stocks_synced, prices_saved, ...})

    Returns:
        ناتج notify_nextjs (أو {skipped: True} لو المصدر مش في NOTIFY_SOURCES)
    """
    scraper_name = (scraper_name or "").lower()

    if not should_notify(scraper_name):
        return {"skipped": True, "reason": f"{scraper_name} not in notify list"}

    event = f"{scraper_name}_synced"
    payload = {
        "scraper": scraper_name,
        "sync": sync_result or {},
    }

    result = notify_nextjs(event, payload)
    # اللوج هنا best-effort — ما يرفعش استثناء
    try:
        if result.get("success"):
            print(f"📢 Notified Next.js: {event} (HTTP {result['status']})", flush=True)
        elif result.get("error") and "not set" not in (result.get("error") or ""):
            print(f"⚠️  Webhook failed: {result['error']}", flush=True)
    except Exception:
        pass
    return result


# ──────────────────────────────────────────────────────────────────────────
# CLI (للاختبار اليدوي)
# ──────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    event = sys.argv[1] if len(sys.argv) > 1 else "manual_test"
    print(f"Testing webhook: event={event}")
    print(f"  NEXTJS_WEBHOOK_URL = {_webhook_url() or '(not set)'}")
    print(f"  secret set         = {bool(_shared_secret())}")
    print(f"  timeout            = {_timeout()}s")
    res = notify_nextjs(event, {"test": True, "source": "cli"})
    print(f"  result = {res}")
    sys.exit(0 if res.get("success") else 1)
