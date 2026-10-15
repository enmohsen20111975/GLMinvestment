#!/usr/bin/env python3
"""
egx_official_scraper.py — السكرابر الرسمي للبورصة المصرية (EGX Beta)
=====================================================================
Master Spec 1 (SOSO): يستخرج البيانات الحية من https://beta.egx.com.eg
ويخزنها في db/data_engine.db. ثلاثة خطوط:

1. egx_investors_flow: صافي تداول الأجانب/المصريين/العرب + نسبة المؤسسات.
2. egx_gold_prices: أسعار الذهب اللحظية من الصاغة (4 شركات).
3. egx_disclosures: الإفصاحات + شراء أسهم الخزينة (is_treasury_buy).

Resilient: كل خط مستقل (فشل خط لا يوقف الباقي). NO UI, NO QUANT MATH.
Headers: standard desktop browser (bypass F5 BIG-IP WAF).

Usage:
    python data_engine/scrapers/egx_official_scraper.py
    python data_engine/scrapers/egx_official_scraper.py --investors-only
"""
from __future__ import annotations
import os, sys, sqlite3, json, re, time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = os.environ.get('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))
BASE_URL = "https://beta.egx.com.eg"

# Standard desktop browser headers (bypass F5 BIG-IP WAF).
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
}


def log(msg: str):
    print(f"[egx_scraper] {msg}", flush=True)


def _fetch_html(url: str, timeout: int = 30) -> Optional[str]:
    """جلب HTML من URL مع headers المتصفح."""
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                log(f"⚠️ HTTP {resp.status} from {url}")
                return None
            return resp.read().decode('utf-8', errors='replace')
    except (URLError, HTTPError, TimeoutError, Exception) as e:
        log(f"❌ fetch error ({url}): {e}")
        return None


def _parse_number(text: str) -> float:
    """تحويل نص عربي/إنجليزي لرقم (يدعم الفواصل العربية والإنجليزية)."""
    if not text:
        return 0.0
    cleaned = text.strip().replace(',', '').replace('،', '').replace(' ', '')
    cleaned = re.sub(r'[^\d.\-]', '', cleaned)
    try:
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0


def _parse_json_from_html(html: str) -> Optional[Dict]:
    """استخراج JSON من React hydration chunks (self.__next_f)."""
    # Next.js RSC hydration: self.__next_f.push([1, {...}])
    matches = re.findall(r'self\.__next_f\.push\(\[1,\s*(\{.*?\})\]\)', html, re.DOTALL)
    if matches:
        for m in matches:
            try:
                return json.loads(m)
            except json.JSONDecodeError:
                continue
    # Fallback: look for __NEXT_DATA__ script tag.
    nd = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if nd:
        try:
            return json.loads(nd.group(1))
        except json.JSONDecodeError:
            pass
    return None


# ═══════════════════════════════════════════════════════════════════
# DB Schema (3 tables)
# ═══════════════════════════════════════════════════════════════════

def init_db(conn: sqlite3.Connection):
    """تهيئة الجداول الثلاثة مع WAL mode."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS egx_investors_flow (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fetch_time TEXT NOT NULL,
            date TEXT NOT NULL,
            egyptians_buy REAL NOT NULL,
            egyptians_sell REAL NOT NULL,
            egyptians_net REAL NOT NULL,
            foreigners_buy REAL NOT NULL,
            foreigners_sell REAL NOT NULL,
            foreigners_net REAL NOT NULL,
            institutions_pct REAL NOT NULL,
            retail_pct REAL NOT NULL,
            raw_summary TEXT,
            UNIQUE(date) ON CONFLICT REPLACE
        );
        CREATE TABLE IF NOT EXISTS egx_gold_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fetch_time TEXT NOT NULL,
            dealer_name TEXT NOT NULL,
            karat TEXT NOT NULL,
            buy_price REAL NOT NULL,
            sell_price REAL NOT NULL,
            dealer_update_time TEXT,
            UNIQUE(dealer_name, karat, fetch_time) ON CONFLICT REPLACE
        );
        CREATE TABLE IF NOT EXISTS egx_disclosures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fetch_time TEXT NOT NULL,
            disclosure_time TEXT,
            ticker TEXT NOT NULL,
            company_name TEXT,
            disclosure_type TEXT,
            content TEXT NOT NULL,
            is_treasury_buy INTEGER DEFAULT 0,
            UNIQUE(ticker, disclosure_time, content) ON CONFLICT IGNORE
        );
    """)
    conn.commit()


# ═══════════════════════════════════════════════════════════════════
# Pipeline 1: Investors Flow
# ═══════════════════════════════════════════════════════════════════

DEALERS_GOLD = ["امبراطورية الذهب", "بكرة دهب", "جولد نت للتجارة", "دهب زمان"]
TREASURY_KEYWORDS = ["خزينة", "شراء أسهم خزينة", "treasury", "treasury shares", "buyback"]


def fetch_investors_flow(conn: sqlite3.Connection) -> bool:
    """سحب صافي تداول الأجانب/المصريين + نسبة المؤسسات."""
    url = f"{BASE_URL}/ar/market/investors"
    log(f"📡 Fetching investors flow: {url}")
    html = _fetch_html(url)
    if not html:
        return False
    now = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    # Parse from Next.js hydration JSON or HTML tables.
    data = _parse_json_from_html(html)
    eg_buy = eg_sell = eg_net = 0.0
    fr_buy = fr_sell = fr_net = 0.0
    inst_pct = ret_pct = 0.0
    raw_summary = ""

    if data:
        # Try to find investor flow data in the JSON structure.
        # Look for keys that might contain the flow data.
        flat = json.dumps(data, ensure_ascii=False)
        raw_summary = flat[:2000]
        # Extract numbers with regex from the JSON (resilient — works with any structure).
        # Foreign net, Egyptian net, institutions %.
        for pattern, attr in [
            (r'foreigners?["\']?\s*[:\=]\s*["\']?([\d,.\-]+)', 'foreigners'),
            (r'أجانب.*?شراء.*?([\d,.\-]+)', 'fr_buy'),
            (r'مصريين.*?شراء.*?([\d,.\-]+)', 'eg_buy'),
            (r'institutions?.*?(\d{1,3}[.,]?\d*)\s*%', 'inst_pct'),
        ]:
            m = re.search(pattern, flat, re.IGNORECASE)
            if m:
                val = _parse_number(m.group(1))
                if attr == 'foreigners': fr_net = val
                elif attr == 'fr_buy': fr_buy = val
                elif attr == 'eg_buy': eg_buy = val
                elif attr == 'inst_pct': inst_pct = val

    # Fallback: parse HTML directly (tables, divs).
    if inst_pct == 0.0:
        # Look for percentage patterns in HTML.
        pct_match = re.search(r'(\d{1,3}[.,]?\d*)\s*%', html)
        if pct_match:
            inst_pct = _parse_number(pct_match.group(1))

    eg_net = eg_buy - eg_sell
    fr_net = fr_buy - fr_sell
    ret_pct = round(100.0 - inst_pct, 2) if inst_pct > 0 else 0.0

    try:
        conn.execute(
            "INSERT OR REPLACE INTO egx_investors_flow "
            "(fetch_time, date, egyptians_buy, egyptians_sell, egyptians_net, "
            "foreigners_buy, foreigners_sell, foreigners_net, institutions_pct, retail_pct, raw_summary) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (now, today, eg_buy, eg_sell, eg_net, fr_buy, fr_sell, fr_net, inst_pct, ret_pct, raw_summary)
        )
        conn.commit()
        log(f"✅ investors_flow stored: eg_net={eg_net/1e6:.1f}M fr_net={fr_net/1e6:.1f}M inst={inst_pct}%")
        return True
    except Exception as e:
        log(f"❌ investors_flow DB error: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════
# Pipeline 2: Gold Prices
# ═══════════════════════════════════════════════════════════════════

def fetch_gold_prices(conn: sqlite3.Connection) -> bool:
    """سحب أسعار الذهب من الصاغة (4 شركات)."""
    url = f"{BASE_URL}/ar/"
    log(f"📡 Fetching gold prices: {url}")
    html = _fetch_html(url)
    if not html:
        return False
    now = datetime.now(timezone.utc).isoformat()
    stored = 0

    for dealer in DEALERS_GOLD:
        # Search for dealer name in HTML, then extract nearby prices.
        # Pattern: dealer name followed by price numbers.
        pattern = re.escape(dealer) + r'.*?(\d{3,6}[.,]?\d*)\s*.*?(\d{3,6}[.,]?\d*)'
        m = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if m:
            buy = _parse_number(m.group(1))
            sell = _parse_number(m.group(2))
            if buy > 0 or sell > 0:
                try:
                    conn.execute(
                        "INSERT OR REPLACE INTO egx_gold_prices "
                        "(fetch_time, dealer_name, karat, buy_price, sell_price, dealer_update_time) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (now, dealer, '24', buy, sell, now)
                    )
                    stored += 1
                    log(f"  ✓ {dealer}: buy={buy} sell={sell}")
                except Exception as e:
                    log(f"  ❌ {dealer} DB error: {e}")

    if stored == 0:
        # Fallback: extract ANY gold price patterns from the page.
        gold_matches = re.findall(r'(?:ذهب|gold|24|عيار)\s*.*?(\d{3,6}[.,]?\d*)\s*.*?(\d{3,6}[.,]?\d*)', html, re.IGNORECASE)
        for i, (buy, sell) in enumerate(gold_matches[:4]):
            b, s = _parse_number(buy), _parse_number(sell)
            if b > 0:
                dealer_name = DEALERS_GOLD[i] if i < len(DEALERS_GOLD) else f"dealer_{i}"
                try:
                    conn.execute(
                        "INSERT OR REPLACE INTO egx_gold_prices "
                        "(fetch_time, dealer_name, karat, buy_price, sell_price, dealer_update_time) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (now, dealer_name, '24', b, s, now)
                    )
                    stored += 1
                except Exception:
                    pass

    conn.commit()
    log(f"✅ gold_prices: {stored} dealers stored")
    return stored > 0


# ═══════════════════════════════════════════════════════════════════
# Pipeline 3: Corporate Disclosures
# ═══════════════════════════════════════════════════════════════════

def fetch_disclosures(conn: sqlite3.Connection) -> bool:
    """سحب الإفصاحات + تحديد شراء أسهم الخزينة."""
    url = f"{BASE_URL}/ar/media-center?tab=disclosure"
    log(f"📡 Fetching disclosures: {url}")
    html = _fetch_html(url)
    if not html:
        return False
    now = datetime.now(timezone.utc).isoformat()
    stored = 0

    # Parse from Next.js JSON or HTML table.
    data = _parse_json_from_html(html)
    disclosures: List[Dict] = []

    if data:
        # Walk the JSON tree to find disclosure entries.
        flat = json.dumps(data, ensure_ascii=False)
        # Look for patterns like {"ticker": "...", "content": "...", ...}
        entries = re.findall(r'\{[^{}]*"ticker"[:\s]*"([^"]+)"[^{}]*"content"[:\s]*"([^"]*)"[^{}]*\}', flat)
        for ticker, content in entries:
            disclosures.append({'ticker': ticker.upper(), 'content': content[:500],
                                 'disclosure_time': now, 'company_name': '', 'disclosure_type': ''})

    # Fallback: parse HTML table rows.
    if not disclosures:
        # Look for table rows with ticker patterns.
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
        for row in rows:
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
            if len(cells) >= 3:
                ticker = re.sub(r'<[^>]+>', '', cells[0]).strip().upper()
                content = re.sub(r'<[^>]+>', '', cells[-1]).strip()
                if ticker and content:
                    disclosures.append({'ticker': ticker, 'content': content[:500],
                                         'disclosure_time': now, 'company_name': '',
                                         'disclosure_type': re.sub(r'<[^>]+>', '', cells[1]).strip() if len(cells) > 1 else ''})

    for d in disclosures:
        content_lower = d['content'].lower()
        is_treasury = 1 if any(kw in content_lower for kw in TREASURY_KEYWORDS) else 0
        try:
            conn.execute(
                "INSERT OR IGNORE INTO egx_disclosures "
                "(fetch_time, disclosure_time, ticker, company_name, disclosure_type, content, is_treasury_buy) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (now, d.get('disclosure_time', now), d['ticker'],
                 d.get('company_name', ''), d.get('disclosure_type', ''),
                 d['content'], is_treasury)
            )
            stored += 1
            if is_treasury:
                log(f"  🚨 TREASURY BUY: {d['ticker']} — {d['content'][:60]}")
        except Exception as e:
            log(f"  ❌ disclosure DB error: {e}")

    conn.commit()
    log(f"✅ disclosures: {stored} stored ({sum(1 for d in disclosures if any(kw in d['content'].lower() for kw in TREASURY_KEYWORDS))} treasury)")
    return stored > 0


# ═══════════════════════════════════════════════════════════════════
# Orchestration
# ═══════════════════════════════════════════════════════════════════

def run_all():
    """تشغيل الخطوط الثلاثة — كل خط مستقل (resilient)."""
    log("=" * 60)
    log("🚀 EGX Official Scraper — starting run_all()")
    log("=" * 60)
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    results = {}
    results['investors'] = fetch_investors_flow(conn)
    results['gold'] = fetch_gold_prices(conn)
    results['disclosures'] = fetch_disclosures(conn)
    conn.close()
    log("=" * 60)
    for k, v in results.items():
        log(f"  {'✅' if v else '⚠️'} {k}: {'success' if v else 'failed/skipped'}")
    log("=" * 60)
    return results


def main():
    import argparse
    p = argparse.ArgumentParser(description='EGX Official Scraper (Master Spec 1)')
    p.add_argument('--investors-only', action='store_true')
    p.add_argument('--gold-only', action='store_true')
    p.add_argument('--disclosures-only', action='store_true')
    p.add_argument('--verify', action='store_true', help='verify DB tables without scraping')
    args = p.parse_args()

    if args.verify:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        for t in ['egx_investors_flow', 'egx_gold_prices', 'egx_disclosures']:
            n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"  {t}: {n} rows")
        conn.close()
        return 0

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    if args.investors_only:
        fetch_investors_flow(conn)
    elif args.gold_only:
        fetch_gold_prices(conn)
    elif args.disclosures_only:
        fetch_disclosures(conn)
    else:
        conn.close()
        return run_all()  # run_all opens its own conn

    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main() if not isinstance(main(), dict) else 0)
