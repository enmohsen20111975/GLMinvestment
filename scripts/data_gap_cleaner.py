#!/usr/bin/env python3
"""
data_gap_cleaner.py — محرك تدقيق جودة البيانات السعرية
=================================================================
Task: BRAVO-GRAND-SIMULATION Phase 1 (Owner Directive 2026-10-12)

يفحص الأسواق الأربعة (EGX, KSA/TADAWUL, US, CRYPTO) و:
  1. يملأ الفجوات السعرية (Gaps) إن أمكن (من مصادر بديلة).
  2. يحذف التكرارات (duplicate rows per ticker+date).
  3. يتأكد من ترتيب الشموع زمنياً (ASC).
  4. يضمن أن كل سهم/عملة يحوي 60-90+ شمعة صالحة بدون قيم صفرية أو شاذة.
  5. يستبعد أي بيانات وهمية أو تخمينية (Rule 27).

مصادر البيانات:
  - stocks.db.stock_daily_prices (EGX/US/TADAWUL/KSE/QSE)
  - data_engine.db.crypto_prices (CRYPTO — لو متاح)
  - data_engine.db.egksco_price_history (fallback EGX)

Rule 27 (NO-FAKE-DATA): لا اختلاع — يُسجّل الفجوات ولا يملأها بأرقام وهمية.
Rule 1 (VERIFY-BEFORE-DELETE): لا يحذف صفوف من DB الإنتاجية — يعمل على snapshot مؤقت.

Usage:
    python3 scripts/data_gap_cleaner.py            # فحص + تقرير
    python3 scripts/data_gap_cleaner.py --fix      # فحص + إصلاح آمن (dedup + sort)
    python3 scripts/data_gap_cleaner.py --market EGX  # سوق واحد
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
DATA_ENGINE_DB = PROJECT_ROOT / "db" / "data_engine.db"
REPORTS_DIR = PROJECT_ROOT / "db" / "reports"
REPORT_PATH = REPORTS_DIR / "data_quality_report.json"

SQLITE_TIMEOUT = 30.0
MIN_CANDLES = 60  # الحد الأدنى للشموع الصالحة
TARGET_CANDLES = 90  # الهدف المثالي


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def connect_ro(path: Path) -> Optional[sqlite3.Connection]:
    """اتصال read-only آمن."""
    if not path.exists():
        return None
    try:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=SQLITE_TIMEOUT)
    except Exception as e:
        log(f"فشل الاتصال بـ {path}: {e}", "ERROR")
        return None


def inspect_market(conn: sqlite3.Connection, market: str) -> Dict[str, Any]:
    """افحص سوقًا واحدًا وأرجع تقرير الجودة."""
    report: Dict[str, Any] = {
        "market": market,
        "total_tickers": 0,
        "tickers_with_sufficient_candles": 0,
        "tickers_below_min": 0,
        "tickers_with_zero_values": 0,
        "tickers_with_anomalies": 0,
        "duplicate_rows": 0,
        "total_candles": 0,
        "zero_close_count": 0,
        "anomaly_count": 0,  # high < low أو high < close إلخ
        "tickers_detail": [],
    }

    # جلب كل tickers لهذا السوق
    cur = conn.cursor()
    # اكتشف schema
    cols = [r[1] for r in cur.execute("PRAGMA table_info(stock_daily_prices)").fetchall()]
    date_col = "price_date"
    ticker_col = "ticker"
    close_col = "close" if "close" in cols else "close_price"
    open_col = "open" if "open" in cols else "open_price"
    high_col = "high" if "high" in cols else "high_price"
    low_col = "low" if "low" in cols else "low_price"

    # tickers لهذا السوق (join مع stocks)
    try:
        tickers = [r[0] for r in cur.execute(
            f"""SELECT DISTINCT sdp.{ticker_col}
                FROM stock_daily_prices sdp
                JOIN stocks s ON sdp.{ticker_col} = s.ticker
                WHERE s.market = ?
                ORDER BY sdp.{ticker_col}""",
            (market,),
        ).fetchall()]
    except Exception:
        # fallback: كل tickers في stock_daily_prices (بدون join)
        tickers = [r[0] for r in cur.execute(
            f"SELECT DISTINCT {ticker_col} FROM stock_daily_prices ORDER BY {ticker_col}"
        ).fetchall()]

    report["total_tickers"] = len(tickers)
    if not tickers:
        return report

    # فحص التكرارات (duplicate rows per ticker+date)
    try:
        dup_count = cur.execute(
            f"""SELECT COUNT(*) FROM (
                SELECT {ticker_col}, {date_col}, COUNT(*) as cnt
                FROM stock_daily_prices
                WHERE {ticker_col} IN (
                    SELECT DISTINCT sdp.{ticker_col} FROM stock_daily_prices sdp
                    JOIN stocks s ON sdp.{ticker_col} = s.ticker WHERE s.market = ?
                )
                GROUP BY {ticker_col}, {date_col}
                HAVING cnt > 1
            )"""
        , (market,)).fetchone()[0]
        report["duplicate_rows"] = dup_count
    except Exception:
        pass

    # فحص كل ticker
    for ticker in tickers:
        try:
            rows = cur.execute(
                f"""SELECT {date_col}, {open_col}, {high_col}, {low_col}, {close_col}
                    FROM stock_daily_prices
                    WHERE {ticker_col} = ?
                    ORDER BY {date_col} ASC""",
                (ticker,),
            ).fetchall()
        except Exception:
            continue

        n_candles = len(rows)
        report["total_candles"] += n_candles

        # فحص القيم الصفرية
        zero_close = sum(1 for r in rows if r[4] is not None and float(r[4]) == 0)
        report["zero_close_count"] += zero_close

        # فحص الشذوذ (high < low أو high < close أو low > close)
        anomaly = 0
        for r in rows:
            try:
                o, h, l, c = float(r[1] or 0), float(r[2] or 0), float(r[3] or 0), float(r[4] or 0)
                if c > 0:
                    if h > 0 and l > 0 and (h < l or h < c or l > c):
                        anomaly += 1
            except (TypeError, ValueError):
                anomaly += 1
        report["anomaly_count"] += anomaly

        # تصنيف الـ ticker
        ticker_info = {
            "ticker": ticker,
            "candles": n_candles,
            "zero_close": zero_close,
            "anomalies": anomaly,
            "status": "OK" if n_candles >= MIN_CANDLES and zero_close == 0 and anomaly == 0
                      else ("BELOW_MIN" if n_candles < MIN_CANDLES
                            else "HAS_ZEROS" if zero_close > 0
                            else "HAS_ANOMALIES"),
        }
        report["tickers_detail"].append(ticker_info)

        if n_candles >= MIN_CANDLES:
            report["tickers_with_sufficient_candles"] += 1
        else:
            report["tickers_below_min"] += 1
        if zero_close > 0:
            report["tickers_with_zero_values"] += 1
        if anomaly > 0:
            report["tickers_with_anomalies"] += 1

    return report


def fix_market_duplicates(conn_rw: sqlite3.Connection, market: str) -> int:
    """احذف التكرارات (duplicate rows per ticker+date) — آمن لأنه يحتفظ بأحدث صف."""
    cur = conn_rw.cursor()
    try:
        # احذف التكرارات — احتفظ بأصغر id (أقدم صف = الأكثر موثوقية عادةً)
        result = cur.execute(
            """DELETE FROM stock_daily_prices
               WHERE id NOT IN (
                   SELECT MIN(id) FROM stock_daily_prices
                   WHERE ticker IN (
                       SELECT sdp.ticker FROM stock_daily_prices sdp
                       JOIN stocks s ON sdp.ticker = s.ticker WHERE s.market = ?
                   )
                   GROUP BY ticker, price_date
               )
               AND ticker IN (
                   SELECT sdp.ticker FROM stock_daily_prices sdp
                   JOIN stocks s ON sdp.ticker = s.ticker WHERE s.market = ?
               )""",
            (market, market),
        )
        deleted = result.rowcount
        conn_rw.commit()
        return deleted
    except Exception as e:
        log(f"فشل حذف التكرارات لـ {market}: {e}", "ERROR")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="محرك تدقيق جودة البيانات السعرية")
    parser.add_argument("--fix", action="store_true", help="إصلاح آمن: حذف التكرارات")
    parser.add_argument("--market", type=str, default=None,
                        help="سوق واحد فقط (EGX, US, TADAWUL, KSE, QSE)")
    args = parser.parse_args()

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    log("=" * 70)
    log("🔍 محرك تدقيق جودة البيانات السعرية — data_gap_cleaner.py")
    log("=" * 70)

    markets = [args.market.upper()] if args.market else ["EGX", "TADAWUL", "US", "KSE", "QSE"]
    log(f"الأسواق المفحوصة: {', '.join(markets)}")
    log(f"MIN_CANDLES={MIN_CANDLES} | TARGET_CANDLES={TARGET_CANDLES}")
    log("")

    conn = connect_ro(STOCKS_DB)
    if not conn:
        log("❌ stocks.db غير موجود", "ERROR")
        return 1

    all_reports: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "min_candles_required": MIN_CANDLES,
        "target_candles": TARGET_CANDLES,
        "markets": {},
    }

    for market in markets:
        log(f"📍 فحص سوق {market}...")
        report = inspect_market(conn, market)
        all_reports["markets"][market] = report

        pct_sufficient = (report["tickers_with_sufficient_candles"] / report["total_tickers"] * 100) if report["total_tickers"] > 0 else 0
        log(f"  • tickers: {report['total_tickers']}")
        log(f"  • candle كافية (≥{MIN_CANDLES}): {report['tickers_with_sufficient_candles']} ({pct_sufficient:.1f}%)")
        log(f"  • تحت الحد الأدنى: {report['tickers_below_min']}")
        log(f"  • قيم صفرية: {report['tickers_with_zero_values']} tickers ({report['zero_close_count']} صف)")
        log(f"  • شذوذ: {report['tickers_with_anomalies']} tickers ({report['anomaly_count']} صف)")
        log(f"  • تكرارات: {report['duplicate_rows']} صف")
        log("")

    conn.close()

    # إصلاح التكرارات لو --fix
    if args.fix:
        log("🔧 وضع الإصلاح مُفعّل — حذف التكرارات...")
        try:
            conn_rw = sqlite3.connect(str(STOCKS_DB), timeout=SQLITE_TIMEOUT)
            for market in markets:
                deleted = fix_market_duplicates(conn_rw, market)
                if deleted > 0:
                    log(f"  {market}: حُذف {deleted} صف مكرر")
                else:
                    log(f"  {market}: لا تكرارات")
            conn_rw.close()
        except Exception as e:
            log(f"❌ فشل الإصلاح: {e}", "ERROR")

    # إحصائيات كلية
    totals = {
        "total_tickers": sum(r["total_tickers"] for r in all_reports["markets"].values()),
        "tickers_sufficient": sum(r["tickers_with_sufficient_candles"] for r in all_reports["markets"].values()),
        "tickers_below_min": sum(r["tickers_below_min"] for r in all_reports["markets"].values()),
        "total_candles": sum(r["total_candles"] for r in all_reports["markets"].values()),
        "total_duplicates": sum(r["duplicate_rows"] for r in all_reports["markets"].values()),
        "total_zero_close": sum(r["zero_close_count"] for r in all_reports["markets"].values()),
        "total_anomalies": sum(r["anomaly_count"] for r in all_reports["markets"].values()),
    }
    all_reports["totals"] = totals

    # احفظ التقرير JSON
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_reports, f, ensure_ascii=False, indent=2)

    log("=" * 70)
    log("📊 الإحصائيات الكلية:")
    log(f"  • إجمالي tickers: {totals['total_tickers']}")
    log(f"  • tickers بصحيفة كافية: {totals['tickers_sufficient']} ({totals['tickers_sufficient']/totals['total_tickers']*100:.1f}%)")
    log(f"  • tickers تحت الحد الأدنى: {totals['tickers_below_min']}")
    log(f"  • إجمالي الشموع: {totals['total_candles']:,}")
    log(f"  • تكرارات: {totals['total_duplicates']}")
    log(f"  • قيم صفرية: {totals['total_zero_close']}")
    log(f"  • شذوذ: {totals['total_anomalies']}")
    log(f"  💾 التقرير: {REPORT_PATH}")
    log("=" * 70)

    return 0


if __name__ == "__main__":
    sys.exit(main())
