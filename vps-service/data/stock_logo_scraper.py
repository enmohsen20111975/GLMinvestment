#!/usr/bin/env python3
"""
stock_logo_scraper.py — تحميل أيقونات الأسهم من TradingView CDN
=================================================================

الوظيفة:
  يقرأ كل tickers من stocks.db، ويجيب الـ logoid من TradingView scanner API،
  وينزّل الـ SVG لـ /public/stock-icons/{ticker}.svg.

السبب:
  - قبل كده: مفيش أيقونة لكل سهم (COMI و PHAR بيرجعوا 404)
  - دلوقتي: TradingView CDN عنده logos لأكتر سهم، بنجيبها أوتوماتيكياً.

القاعدة 20 (Python = العقل، Node = العرض):
  - ده Python scraper بينزّل الملفات مرة واحدة + يحدثها عند الحاجة
  - الـ frontend بقرا من /public/stock-icons/ (ملفات محلية، مش API calls)

القاعدة 27 (NO-FAKE-DATA):
  - لو TradingView ماعندوش logo للسهم → بنتخطاه (مش fabrication)
  - الـ frontend بيـ fallback ل sector emoji تلقائياً

الاستخدام:
  cd vps-service/data
  python3 stock_logo_scraper.py                    # EGX فقط
  python3 stock_logo_scraper.py --market=EGX       # سوق محدد
  python3 stock_logo_scraper.py --all-markets       # كل الأسواق
  python3 stock_logo_scraper.py --ticker=COMI       # سهم واحد بس
  python3 stock_logo_scraper.py --dry-run           # test بدون تحميل

آخر تحديث: 2026-10-10
"""

import os
import sys
import time
import json
import sqlite3
import argparse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, List, Dict, Tuple

# ─── Configuration ───────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]  # vps-service/data → project root
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
OUTPUT_DIR = PROJECT_ROOT / "public" / "stock-icons"

# TradingView scanner API — بيرجّع logoid لكل symbol
TV_SCANNER_URL = "https://scanner.tradingview.com/symbol?symbol={exchange}:{ticker}&fields=logoid"

# TradingView logo CDN — الـ SVG بيتخزن هنا
TV_LOGO_CDN_URL = "https://s3-symbol-logo.tradingview.com/{logoid}.svg"

# Rate limiting (0.5s between requests to avoid getting blocked)
REQUEST_DELAY = 0.5

# Request headers — TradingView بيتطلب Referer
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Referer": "https://www.tradingview.com/",
    "Accept": "*/*",
}

# Market → TradingView exchange mapping
MARKET_EXCHANGE_MAP = {
    "EGX": "EGX",
    "TADAWUL": "TADAWUL",  # Saudi
    "KSA": "TADAWUL",
    "KSE": "KSE",
    "QSE": "QSE",
    "US": "",  # US tickers بدون exchange prefix (AAPL)
    "DFM": "DFM",
    "CRYPTO": "",  # crypto بدون exchange prefix
}

# ─── HTTP helpers ────────────────────────────────────────────────────────────

def fetch_url(url: str, timeout: int = 10) -> Optional[bytes]:
    """يجيب محتوى URL مع headers + timeout."""
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                return resp.read()
            else:
                return None
    except (urllib.error.URLError, urllib.error.HTTPError, Exception) as e:
        return None


def fetch_logoid(exchange: str, ticker: str) -> Optional[str]:
    """يجيب logoid من TradingView scanner API."""
    symbol = f"{exchange}:{ticker}" if exchange else ticker
    url = TV_SCANNER_URL.format(exchange=exchange, ticker=ticker)
    if not exchange:
        url = f"https://scanner.tradingview.com/symbol?symbol={ticker}&fields=logoid"
    
    data = fetch_url(url)
    if not data:
        return None
    
    try:
        result = json.loads(data.decode("utf-8"))
        logoid = result.get("logoid")
        if logoid and isinstance(logoid, str) and logoid.strip():
            return logoid.strip()
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass
    return None


def download_logo_svg(logoid: str, output_path: Path) -> bool:
    """ينزّل الـ SVG من TradingView CDN ويحفظه محلياً."""
    url = TV_LOGO_CDN_URL.format(logoid=logoid)
    data = fetch_url(url)
    if not data:
        return False
    
    # تحقق إنه SVG حقيقي (مش error page)
    try:
        content = data.decode("utf-8", errors="replace")
        if "<svg" not in content or "</svg>" not in content:
            return False
        if len(data) < 50:  # SVG صغير جداً = غالباً خطأ
            return False
    except Exception:
        return False
    
    # احفظ الملف
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(data)
    return True


# ─── DB helpers ───────────────────────────────────────────────────────────────

def get_tickers_from_db(market: Optional[str] = None) -> List[Tuple[str, str]]:
    """
    يقرأ tickers + market من stocks.db.
    بيرجّع list of (ticker, market) tuples.
    FALLBACK: لو stocks.db مش موجود → يقرأ من egx_stocks_complete.py.
    """
    if STOCKS_DB.exists():
        conn = sqlite3.connect(str(STOCKS_DB))
        conn.row_factory = sqlite3.Row
        if market:
            rows = conn.execute(
                "SELECT ticker, market FROM stocks WHERE market = ? AND is_active = 1 ORDER BY ticker",
                (market,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ticker, market FROM stocks WHERE is_active = 1 ORDER BY ticker"
            ).fetchall()
        conn.close()
        return [(row["ticker"], row["market"] or "EGX") for row in rows]
    
    # FALLBACK: لو DB مش موجود → اقرأ من egx_stocks_complete.py
    print(f"⚠️  stocks.db مش موجود ({STOCKS_DB}) — fallback لـ egx_stocks_complete.py")
    egx_py = PROJECT_ROOT / "vps-service" / "data" / "egx_stocks_complete.py"
    if not egx_py.exists():
        print(f"❌ egx_stocks_complete.py مش موجود: {egx_py}")
        return []
    
    # اقرأ tickers من الملف (regex-free: exec the dict)
    import importlib.util
    spec = importlib.util.spec_from_file_location("egx_stocks", egx_py)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        stocks_dict = getattr(mod, "EGX_STOCKS", {})
        return [(ticker, "EGX") for ticker in stocks_dict.keys()]
    except Exception as e:
        print(f"❌ فشل قراءة egx_stocks_complete.py: {e}")
        return []


# ─── Main scraper ────────────────────────────────────────────────────────────

def scrape_ticker(ticker: str, market: str, dry_run: bool = False) -> str:
    """
    ينزّل logo لسهم واحد.
    بيرجّع: 'downloaded' / 'exists' / 'no_logoid' / 'failed'
    """
    output_path = OUTPUT_DIR / f"{ticker.upper()}.svg"
    
    # لو الملف موجود ومش فاضي → skip
    if output_path.exists() and output_path.stat().st_size > 50:
        return "exists"
    
    # TradingView exchange prefix
    exchange = MARKET_EXCHANGE_MAP.get(market, "EGX")
    
    # 1. اجيب logoid
    logoid = fetch_logoid(exchange, ticker)
    if not logoid:
        return "no_logoid"
    
    if dry_run:
        print(f"  [DRY-RUN] {ticker} → logoid={logoid}")
        return "downloaded"
    
    # 2. نزّل الـ SVG
    if download_logo_svg(logoid, output_path):
        return "downloaded"
    else:
        return "failed"


def main():
    parser = argparse.ArgumentParser(description="تحميل أيقونات الأسهم من TradingView CDN")
    parser.add_argument("--market", type=str, default="EGX", help="السوق (EGX/TADAWUL/KSE/QSE/US)")
    parser.add_argument("--all-markets", action="store_true", help="كل الأسواق")
    parser.add_argument("--ticker", type=str, help="سهم واحد بس")
    parser.add_argument("--dry-run", action="store_true", help="test بدون تحميل")
    args = parser.parse_args()
    
    print("=" * 70)
    print("📥 stock_logo_scraper.py — تحميل أيقونات الأسهم من TradingView")
    print("=" * 70)
    print(f"DB: {STOCKS_DB}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Delay: {REQUEST_DELAY}s between requests")
    if args.dry_run:
        print("⚠️ DRY-RUN MODE (بدون تحميل فعلي)")
    print()
    
    # جمع tickers
    if args.ticker:
        tickers = [(args.ticker.upper(), args.market)]
    elif args.all_markets:
        tickers = get_tickers_from_db()
    else:
        tickers = get_tickers_from_db(market=args.market)
    
    if not tickers:
        print("❌ مفيش tickers في الـ DB")
        sys.exit(1)
    
    print(f"📊 عدد الأسهم: {len(tickers)}")
    print()
    
    # إحصائيات
    stats = {"downloaded": 0, "exists": 0, "no_logoid": 0, "failed": 0}
    no_logoid_list = []
    failed_list = []
    
    for i, (ticker, market) in enumerate(tickers, 1):
        result = scrape_ticker(ticker, market, dry_run=args.dry_run)
        stats[result] = stats.get(result, 0) + 1
        
        if result == "downloaded":
            print(f"  [{i}/{len(tickers)}] ✅ {ticker} ({market}) — تم التحميل")
        elif result == "exists":
            pass  # skip silent
        elif result == "no_logoid":
            no_logoid_list.append(f"{ticker} ({market})")
        elif result == "failed":
            failed_list.append(f"{ticker} ({market})")
            print(f"  [{i}/{len(tickers)}] ❌ {ticker} ({market}) — فشل التحميل")
        
        # Rate limiting
        if not args.dry_run and result == "downloaded":
            time.sleep(REQUEST_DELAY)
    
    # تقرير نهائي
    print()
    print("=" * 70)
    print("📊 التقرير النهائي")
    print("=" * 70)
    print(f"  ✅ تم التحميل: {stats['downloaded']}")
    print(f"  ⏭️  موجود بالفعل: {stats['exists']}")
    print(f"  ⚠️  TradingView ماعندوش logo: {stats['no_logoid']}")
    print(f"  ❌ فشل التحميل: {stats['failed']}")
    print(f"  📁 إجمالي الأيقونات في /public/stock-icons/: {len(list(OUTPUT_DIR.glob('*.svg')))}")
    
    if no_logoid_list:
        print(f"\n⚠️  أسهم بدون logo في TradingView ({len(no_logoid_list)}):")
        for t in no_logoid_list[:20]:
            print(f"   - {t}")
        if len(no_logoid_list) > 20:
            print(f"   ... و {len(no_logoid_list) - 20} سهم آخر")
    
    if failed_list:
        print(f"\n❌ أسهم فشل تحميلها ({len(failed_list)}):")
        for t in failed_list[:10]:
            print(f"   - {t}")
    
    print()
    print("✅ خلص! الأيقونات المتاحة دلوقتي في /public/stock-icons/")


if __name__ == "__main__":
    main()
