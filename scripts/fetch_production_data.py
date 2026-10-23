#!/usr/bin/env python3
"""
fetch_production_data.py — سحب بيانات الإنتاج للـ sandbox/laptop (تجربة فقط)
================================================================================
⚠️ مهم: ده سكربت للـ sandbox/laptop فقط. مش للإنتاج.

في الإنتاج: الـ DBs موجودة أصلاً (db/stocks.db + db/data_engine.db).
الـ API بـ يقرا منها مباشرة عبر radar-db.ts fallback chain.

في الـ sandbox: مفيش DBs → السكربت ده بيسحب من الإنتاج عبر HTTPS API
وبيحفظ في db/production_snapshot.db للتجربة المحلية.

CLI:
  python3 scripts/fetch_production_data.py
  python3 scripts/fetch_production_data.py --days 365 --market EGX
  python3 scripts/fetch_production_data.py --limit 50  # سحب 50 سهم بس (للتجربة)
  python3 scripts/fetch_production_data.py --force     # اسحب حتى لو في الإنتاج
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DB = PROJECT_ROOT / "db" / "production_snapshot.db"
PROGRESS_FILE = PROJECT_ROOT / "db" / "production_snapshot_progress.json"

# PORTABLE: اكتشف بيئة التشغيل تلقائياً
# - في الإنتاج: db/stocks.db موجود أصلاً → مفيش حاجة للسحب
# - في sandbox/laptop: لازم نسحب من الإنتاج
def _is_production():
    """لو db/stocks.db موجود + فيه بيانات → إحنا في الإنتاج."""
    stocks_db = PROJECT_ROOT / "db" / "stocks.db"
    if not stocks_db.exists():
        return False
    try:
        import sqlite3 as _sql
        conn = _sql.connect(str(stocks_db))
        n = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
        conn.close()
        return n > 1000  # لو فيه أكتر من 1000 صف → إحنا في الإنتاج
    except Exception:
        return False

IS_PRODUCTION = _is_production()

# PRODUCTION_URL: من env variable لو موجود، غير كده استخدم default
PRODUCTION_URL = os.environ.get("PRODUCTION_URL", "https://invist.m2y.net")
TIMEOUT = 60
BATCH_SIZE = 3
SLEEP_BETWEEN_BATCHES = 1.0
MAX_RETRIES = 5
RETRY_BACKOFF = 2.0


def log(msg):
    print(msg, flush=True)


def fetch_json(url: str, timeout: int = TIMEOUT):
    """Fetch JSON من URL مع retry متدرّج."""
    req = Request(url, headers={"User-Agent": "GLMinvestment-Research/1.0", "Accept": "application/json"})
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            with urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data
        except (URLError, HTTPError, TimeoutError, ConnectionResetError, OSError) as e:
            last_error = e
            wait = RETRY_BACKOFF ** attempt  # 1s, 2s, 4s, 8s, 16s
            log(f"    ⚠️ retry {attempt+1}/{MAX_RETRIES} after {wait}s: {e}")
            time.sleep(wait)
            continue
    log(f"    ❌ فشل بعد {MAX_RETRIES} محاولات: {last_error}")
    return None


def fetch_egx_tickers():
    """اجلب قائمة كل أسهم EGX من الإنتاج."""
    log(f"  جلب قائمة أسهم EGX من {PRODUCTION_URL}/api/stocks?market=EGX&limit=2000 ...")
    data = fetch_json(f"{PRODUCTION_URL}/api/stocks?market=EGX&limit=2000")
    if not data or not data.get("success"):
        log(f"  ❌ فشل جلب الأسهم: {data}")
        return []
    stocks = data.get("stocks", [])
    tickers = [s["ticker"] for s in stocks if s.get("market") == "EGX" and s.get("ticker")]
    log(f"  ✅ {len(tickers)} سهم EGX")
    return tickers


def fetch_ticker_history(ticker: str, days: int = 365):
    """اجلب تاريخ سهم معين."""
    url = f"{PRODUCTION_URL}/api/stocks/{ticker}/history?days={days}"
    data = fetch_json(url, timeout=60)  # تاريخ أكبر = timeout أكبر
    if not data or not data.get("success"):
        return []
    return data.get("data", [])


def init_db(db_path: Path):
    """أنشئ الـ schema لو مش موجودة."""
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=True).__enter__()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stock_daily_prices (
            ticker TEXT,
            price_date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            turnover REAL,
            PRIMARY KEY (ticker, price_date)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fetch_log (
            ticker TEXT PRIMARY KEY,
            points INTEGER,
            first_date TEXT,
            last_date TEXT,
            fetched_at TEXT,
            status TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sdp_ticker ON stock_daily_prices(ticker)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sdp_date ON stock_daily_prices(price_date)")
    conn.commit()
    conn.close()


def load_progress():
    """حمّل التقدم المحفوظ."""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"fetched_tickers": [], "last_run": None}


def save_progress(progress):
    """احفظ التقدم."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)


def store_ticker_history(ticker: str, history: list, conn: sqlite3.Connection):
    """خزّن تاريخ سهم في الـ DB."""
    if not history:
        return 0
    rows = []
    for h in history:
        date = h.get("date") or h.get("price_date")
        if not date:
            continue
        close = h.get("close") or h.get("close_price")
        volume = h.get("volume") or h.get("volume_int") or 0
        turnover = h.get("turnover") or (close * volume if close and volume else None)
        rows.append((
            ticker,
            date,
            h.get("open") or h.get("open_price"),
            h.get("high") or h.get("high_price"),
            h.get("low") or h.get("low_price"),
            close,
            int(volume) if volume else 0,
            turnover,
        ))
    if not rows:
        return 0
    # احذف القديم وأدخل الجديد
    conn.execute("DELETE FROM stock_daily_prices WHERE ticker = ?", (ticker,))
    conn.executemany(
        "INSERT OR REPLACE INTO stock_daily_prices VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.execute(
        "INSERT OR REPLACE INTO fetch_log VALUES (?, ?, ?, ?, ?, ?)",
        (ticker, len(rows), rows[0][1], rows[-1][1], datetime.now().isoformat(), "ok"),
    )
    conn.commit()
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--market", type=str, default="EGX")
    parser.add_argument("--limit", type=int, default=0, help="0 = كل الأسهم")
    parser.add_argument("--resume", action="store_true", help="استئناف من حيث وقف")
    parser.add_argument("--force", action="store_true", help="اسحب حتى لو في الإنتاج")
    args = parser.parse_args()

    log("═══ سحب بيانات الإنتاج الكاملة ═══")
    log(f"  URL: {PRODUCTION_URL}")
    log(f"  DB: {OUTPUT_DB}")
    log(f"  days: {args.days}, market: {args.market}, limit: {args.limit}")
    log("")

    # PORTABLE: لو إحنا في الإنتاج، مفيش حاجة للسحب — الـ DBs موجودة
    if IS_PRODUCTION and not args.force:
        log("✅ إحنا في الإنتاج — db/stocks.db موجود أصلاً.")
        log("   مفيش حاجة للسحب. الـ APIs هتقرا من db/stocks.db مباشرة.")
        log("   (استخدم --force لو عايز تسحب بيانات للـ production_snapshot.db)")
        return 0

    if IS_PRODUCTION and args.force:
        log("⚠️ --force مفعّل — هنسحب للـ production_snapshot.db حتى لو إحنا في الإنتاج.")

    # 1. جلب قائمة الأسهم
    tickers = fetch_egx_tickers()
    if args.limit > 0:
        tickers = tickers[: args.limit]
        log(f"  محدد بـ {len(tickers)} سهم (limit)")

    # 2. استئناف لو مطلوب
    progress = load_progress() if args.resume else {"fetched_tickers": [], "last_run": None}
    already_fetched = set(progress.get("fetched_tickers", []))
    if already_fetched:
        log(f"  استئناف: {len(already_fetched)} سهم تم سحبهم بالفعل")

    # 3. init DB
    init_db(OUTPUT_DB)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(OUTPUT_DB, writable=False).__enter__()

    # 4. سحب كل سهم
    log(f"\n  بدء السحب لـ {len(tickers)} سهم...")
    total_points = 0
    failed = []
    success_count = 0
    start_time = time.time()

    for i, ticker in enumerate(tickers, 1):
        if ticker in already_fetched:
            continue
        try:
            history = fetch_ticker_history(ticker, days=args.days)
            n = store_ticker_history(ticker, history, conn)
            total_points += n
            success_count += 1
            progress["fetched_tickers"].append(ticker)
            progress["last_run"] = datetime.now().isoformat()
            if i % 10 == 0 or i == len(tickers):
                elapsed = time.time() - start_time
                rate = success_count / elapsed if elapsed > 0 else 0
                log(f"    [{i}/{len(tickers)}] {ticker:8s} → {n:4d} نقطة | إجمالي: {total_points:,} نقطة | {rate:.1f} سهم/ث")
                save_progress(progress)
            # rate limit
            if i % BATCH_SIZE == 0:
                time.sleep(SLEEP_BETWEEN_BATCHES)
        except Exception as e:
            log(f"    [{i}/{len(tickers)}] ❌ {ticker}: {e}")
            failed.append({"ticker": ticker, "error": str(e)})
            conn.execute(
                "INSERT OR REPLACE INTO fetch_log VALUES (?, ?, ?, ?, ?, ?)",
                (ticker, 0, None, None, datetime.now().isoformat(), f"error: {e}"),
            )
            conn.commit()

    conn.close()
    save_progress(progress)

    # 5. ملخص
    elapsed = time.time() - start_time
    log(f"\n═══ ملخص ═══")
    log(f"  ✅ نجح: {success_count} سهم")
    log(f"  ❌ فشل: {len(failed)} سهم")
    log(f"  📊 إجمالي النقاط: {total_points:,}")
    log(f"  ⏱️ الوقت: {elapsed:.1f} ثانية ({success_count/elapsed if elapsed > 0 else 0:.1f} سهم/ث)")
    log(f"  💾 DB: {OUTPUT_DB}")
    if failed:
        log(f"  ❌ الفاشلين: {[f['ticker'] for f in failed[:10]]}")

    # 6. حجم الـ DB
    if OUTPUT_DB.exists():
        size_mb = OUTPUT_DB.stat().st_size / (1024 * 1024)
        log(f"  📦 حجم DB: {size_mb:.1f} MB")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
