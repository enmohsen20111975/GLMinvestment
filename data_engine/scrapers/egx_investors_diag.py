#!/usr/bin/env python3
"""
egx_investors_diag.py — Diagnostic tool to find the EGX investor-flow API.

The EGX foreign-trading page (egx.com.eg/en/Market/ForeignInvestorsTrading)
is JS-rendered: requests.get() returns a 6KB HTML shell with NO data.
This script analyzes that shell to find the backend JSON API that the
page's JavaScript calls to load the actual investor-flow numbers.

Usage:
    python3 scripts/egx_investors_diag.py
    python3 scripts/egx_investors_diag.py --url https://www.egx.com.eg/ar/Market/ForeignInvestorsTrading

Outputs:
    - All <script src="..."> URLs (the JS bundles)
    - All inline <script> content (searches for fetch/ajax/XHR patterns)
    - Any URL-like strings that look like API endpoints
    - A snippet of the raw HTML for manual inspection
"""
import argparse
import re
import sys

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

DEFAULT_URL = "https://www.egx.com.eg/en/Market/ForeignInvestorsTrading"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Patterns that indicate an API call in JavaScript source
API_PATTERNS = [
    r'fetch\s*\(\s*["\']([^"\']+)["\']',
    r'\$\.ajax\s*\(\s*\{[^}]*url\s*:\s*["\']([^"\']+)["\']',
    r'\$\.get\s*\(\s*["\']([^"\']+)["\']',
    r'\$\.post\s*\(\s*["\']([^"\']+)["\']',
    r'XMLHttpRequest[^;]*open\s*\(\s*["\'][A-Z]+["\']\s*,\s*["\']([^"\']+)["\']',
    r'axios\.\w+\s*\(\s*["\']([^"\']+)["\']',
    r'url\s*:\s*["\']([^"\']*(?:api|market|trading|investor|foreign)[^"\']*)["\']',
    r'data-src\s*=\s*["\']([^"\']+)["\']',
    r'action\s*=\s*["\']([^"\']+)["\']',
]

# URL-like strings that look like API endpoints
URL_RE = re.compile(r'["\'](/[^"\']*\?(?:[^"\']*)|/api/[^"\']+|/Market/[^"\']+|https?://[^"\']+)["\']')


def fetch_page(url: str) -> str:
    """Fetch the EGX page HTML."""
    resp = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,ar;q=0.8"}, timeout=15)
    print(f"URL: {url}")
    print(f"HTTP {resp.status_code}, body={len(resp.text)} chars")
    print(f"Content-Type: {resp.headers.get('content-type', '?')}")
    return resp.text


def extract_script_srcs(html: str) -> list:
    """Find all <script src="..."> URLs."""
    srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.IGNORECASE)
    return srcs


def extract_inline_scripts(html: str) -> list:
    """Extract inline <script> blocks (no src)."""
    blocks = re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', html, re.IGNORECASE | re.DOTALL)
    return [b.strip() for b in blocks if b.strip()]


def find_api_endpoints(html: str, inline_scripts: list) -> list:
    """Search for API endpoint patterns in HTML and inline scripts."""
    found = set()
    # Search inline scripts
    for block in inline_scripts:
        for pattern in API_PATTERNS:
            for m in re.findall(pattern, block, re.IGNORECASE):
                found.add(m)
        # Also find any URL-like strings
        for m in URL_RE.findall(block):
            found.add(m)
    # Search raw HTML too
    for pattern in API_PATTERNS:
        for m in re.findall(pattern, html, re.IGNORECASE):
            found.add(m)
    return sorted(found)


def fetch_js_bundle(url: str, base_url: str) -> str:
    """Fetch a JS bundle (resolve relative URLs)."""
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        from urllib.parse import urlparse
        p = urlparse(base_url)
        url = f"{p.scheme}://{p.netloc}{url}"
    elif not url.startswith("http"):
        return ""  # skip weird ones
    try:
        resp = requests.get(url, headers={"User-Agent": UA}, timeout=15)
        if resp.status_code == 200:
            return resp.text
    except Exception:
        pass
    return ""


def main():
    p = argparse.ArgumentParser(description="EGX investor-flow API diagnostic")
    p.add_argument("--url", default=DEFAULT_URL, help="EGX page URL to analyze")
    p.add_argument("--fetch-bundles", action="store_true", help="Also fetch and analyze JS bundles")
    args = p.parse_args()

    html = fetch_page(args.url)
    print("=" * 80)

    # 1. Script srcs
    srcs = extract_script_srcs(html)
    print(f"\n▶ <script src> URLs found: {len(srcs)}")
    for s in srcs:
        print(f"  {s}")

    # 2. Inline scripts
    inline = extract_inline_scripts(html)
    print(f"\n▶ Inline <script> blocks: {len(inline)}")
    for i, block in enumerate(inline):
        snippet = block[:300].replace("\n", " ")
        print(f"  [{i}] ({len(block)} chars): {snippet}...")

    # 3. API endpoints
    apis = find_api_endpoints(html, inline)
    print(f"\n▶ API endpoint candidates: {len(apis)}")
    for a in apis:
        print(f"  {a}")

    # 4. If fetch-bundles, download JS and search for API calls
    if args.fetch_bundles and srcs:
        print(f"\n▶ Fetching JS bundles to search for API calls...")
        for src in srcs:
            js = fetch_js_bundle(src, args.url)
            if js:
                print(f"\n  Bundle: {src} ({len(js)} chars)")
                for pattern in API_PATTERNS:
                    for m in re.findall(pattern, js, re.IGNORECASE):
                        print(f"    API call: {m}")
                # search for investor/foreign/trading keywords
                for kw in ["investor", "foreign", "arab", "egyptian", "trading", "ForeignInvestors"]:
                    if kw.lower() in js.lower():
                        # find context around it
                        idx = js.lower().find(kw.lower())
                        ctx = js[max(0, idx - 40):idx + 80].replace("\n", " ")
                        print(f"    keyword '{kw}' found: ...{ctx}...")

    # 5. Raw HTML snippet
    print(f"\n▶ Raw HTML (first 2000 chars):")
    print(html[:2000])
    print("=" * 80)


if __name__ == "__main__":
    main()
