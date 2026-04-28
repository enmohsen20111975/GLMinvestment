from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_SERVICE_URL = os.getenv("EGXPY_SERVICE_URL", "http://127.0.0.1:8010")


def _build_url(path: str) -> str:
    return urllib.parse.urljoin(DEFAULT_SERVICE_URL.rstrip("/"), path)


def _call_api(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    url = _build_url(path)
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to connect to {url}: {exc}") from exc


def run_validation() -> dict:
    return _call_api("/api/predictions/validate-due", method="POST")


def run_retrain() -> dict:
    return _call_api("/api/predictions/retrain", method="POST")


if __name__ == "__main__":
    print(f"Running EGXPy prediction scheduler against {DEFAULT_SERVICE_URL}")
    result = run_validation()
    print("Validation result:")
    print(json.dumps(result, indent=2, ensure_ascii=False))

    result = run_retrain()
    print("Retrain result:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
