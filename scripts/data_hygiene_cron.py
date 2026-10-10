#!/usr/bin/env python3
"""
🧹 Data Hygiene Cron — التنظيف اليومي للبيانات (Phase 8: Stability & Data Hygiene)
====================================================================================

الجدولة: يُشغّل يومياً قبل فتح السوق (الساعة 9:00 صباحاً بتوقيت القاهرة).
    مثال crontab (على الـ VPS):
        0 9 * * 1-6  cd /opt/app && /usr/bin/python3 scripts/data_hygiene_cron.py >> logs/hygiene.log 2>&1
    أو عبر pm2 / market_scheduler (نافذة pre-market).

المشكلة اللي بتحلها:
    الساندبوكس والإنتاج بيتراكم فيهم "بيانات ملطخة" (Data Anemia):
      - شموع بـ close_price = 0 (فشل سحب من المصدر)
      - شموع بـ volume = 0 (يوم متوقف/نقص بيانات)
      - تواريخ مستقبلية (UTC/Cairo mismatch عند الكتابة)
      - أسهم نشطة (is_active=1) بس current_price = 0 (تحديث ناقص)
    ده بـ يلوّث التحليل: MA بتتأثر بالأصفار، RSI بيتخانق، والمستثمر بيشوف
    سهم "نشط" بس سعره صفر → فرصة وهمية.

المهمة (4 خطوات):
    1. price_history.db.price_history       → امسح close=0 OR volume=0 OR date>today
    2. stocks.db.stock_daily_prices         → امسح close_price=0 OR volume=0 OR price_date>today
    3. stocks.db.stocks (is_active=1)        → لو current_price<=0 اسحبه من آخر شمعة
    4. db/backups/data_hygiene_report.json   → تقرير بعدد الصفوف المشيلة + الأسهم المصلحة

المعمارية (Single Source of Truth):
    كل الـ DB access بيمر عبر `core/db_manager.py` (البوابة الموحّدة بـ WAL +
    busy_timeout=30000). مفيش sqlite3.connect() مباشر هنا — ده نموذج تطبيقي
    لقاعدة Phase 8.

الاستخدام:
    python scripts/data_hygiene_cron.py            # تنفيذ فعلي
    python scripts/data_hygiene_cron.py --dry-run  # عرض فقط بدون كتابة
    python scripts/data_hygiene_cron.py --market EGX  # قصر التنظيف على سوق

Exit codes:
    0 = نجح (حتى لو 0 صفوف اتشالت)
    1 = خطأ في الـ DB / الـ connection
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Path setup — خلّي vps-service قابل للاستيراد عشان نستخدم db_manager
# ─────────────────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
_VPS_DIR = _PROJECT_ROOT / "vps-service"
if str(_VPS_DIR) not in sys.path:
    sys.path.insert(0, str(_VPS_DIR))

# cwd = project root (عشان db_manager يلاقي db/ عبر utils/db_paths)
import os
os.chdir(_PROJECT_ROOT)

try:
    from core.db_manager import db_manager  # البوابة الموحّدة (Phase 8)
except Exception as _imp_err:  # pragma: no cover
    print(f"[data_hygiene] FATAL: cannot import db_manager: {_imp_err}", file=sys.stderr)
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _today_iso() -> str:
    """تاريخ اليوم بصيغة YYYY-MM-DD (للـ comparison مع أعمدة التواريخ)."""
    return datetime.now().strftime("%Y-%m-%d")


def _now_iso() -> str:
    """طابع زمني ISO كامل للـ report."""
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _safe_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# 1) تنظيف price_history.db → price_history (close=0 OR volume=0 OR future date)
# ─────────────────────────────────────────────────────────────────────────────
# الـ schema: ticker, date, open, high, low, close, volume, source, change_percent
# (متحقّق منه فعلياً ضد db/price_history.db — العمود اسمه `close` مش `close_price`)
def clean_price_history(dry_run: bool, today: str) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        "table": "price_history",
        "db": "price_history",
        "deleted_zero_close": 0,
        "deleted_zero_volume": 0,
        "deleted_future_date": 0,
        "total_deleted": 0,
        "remaining_rows": 0,
    }
    db = "price_history"
    if not db_manager.table_exists(db, "price_history"):
        stats["skipped"] = "table price_history not found"
        return stats

    # عدد الصفوف قبل التنظيف
    before = db_manager.query_one(db, "SELECT COUNT(*) AS c FROM price_history")
    stats["rows_before"] = _safe_int(before.get("c")) if before else 0

    if dry_run:
        # احسب كم سيتشال بدون حذف
        zero_close = db_manager.query_one(
            db, "SELECT COUNT(*) AS c FROM price_history WHERE close = 0"
        )
        zero_vol = db_manager.query_one(
            db, "SELECT COUNT(*) AS c FROM price_history WHERE volume = 0"
        )
        future = db_manager.query_one(
            db, "SELECT COUNT(*) AS c FROM price_history WHERE date > ?", (today,)
        )
        stats["deleted_zero_close"] = _safe_int(zero_close.get("c")) if zero_close else 0
        stats["deleted_zero_volume"] = _safe_int(zero_vol.get("c")) if zero_vol else 0
        stats["deleted_future_date"] = _safe_int(future.get("c")) if future else 0
        stats["total_deleted"] = (
            stats["deleted_zero_close"] + stats["deleted_zero_volume"] + stats["deleted_future_date"]
        )
        return stats

    # حذف فعلي (3 جمل منفصلة عشان الـ stats تكون دقيقة)
    # note: close=0 و volume=0 ممكن يتداخلوا (نفس الصف)؛ الـ total_deleted بـ
    # يُعاد حسابه من COUNT(*) بعد الحذف عشان يكون صادق.
    n1 = db_manager.execute(db, "DELETE FROM price_history WHERE close = 0")
    stats["deleted_zero_close"] = n1
    n2 = db_manager.execute(db, "DELETE FROM price_history WHERE volume = 0")
    stats["deleted_zero_volume"] = n2
    n3 = db_manager.execute(db, "DELETE FROM price_history WHERE date > ?", (today,))
    stats["deleted_future_date"] = n3

    after = db_manager.query_one(db, "SELECT COUNT(*) AS c FROM price_history")
    stats["remaining_rows"] = _safe_int(after.get("c")) if after else 0
    stats["total_deleted"] = stats["rows_before"] - stats["remaining_rows"]
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# 2) تنظيف stocks.db → stock_daily_prices (close_price=0 OR volume=0 OR future)
# ─────────────────────────────────────────────────────────────────────────────
# الـ schema: id, ticker, price_date, open_price, high_price, low_price,
#             close_price, volume, turnover, change_percent
def clean_stock_daily_prices(dry_run: bool, today: str) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        "table": "stock_daily_prices",
        "db": "stocks",
        "deleted_zero_close": 0,
        "deleted_zero_volume": 0,
        "deleted_future_date": 0,
        "total_deleted": 0,
        "remaining_rows": 0,
    }
    db = "stocks"
    if not db_manager.table_exists(db, "stock_daily_prices"):
        stats["skipped"] = "table stock_daily_prices not found"
        return stats

    before = db_manager.query_one(db, "SELECT COUNT(*) AS c FROM stock_daily_prices")
    stats["rows_before"] = _safe_int(before.get("c")) if before else 0

    if dry_run:
        zc = db_manager.query_one(
            db, "SELECT COUNT(*) AS c FROM stock_daily_prices WHERE close_price = 0"
        )
        zv = db_manager.query_one(
            db, "SELECT COUNT(*) AS c FROM stock_daily_prices WHERE volume = 0"
        )
        fut = db_manager.query_one(
            db, "SELECT COUNT(*) AS c FROM stock_daily_prices WHERE price_date > ?", (today,)
        )
        stats["deleted_zero_close"] = _safe_int(zc.get("c")) if zc else 0
        stats["deleted_zero_volume"] = _safe_int(zv.get("c")) if zv else 0
        stats["deleted_future_date"] = _safe_int(fut.get("c")) if fut else 0
        stats["total_deleted"] = (
            stats["deleted_zero_close"] + stats["deleted_zero_volume"] + stats["deleted_future_date"]
        )
        return stats

    n1 = db_manager.execute(db, "DELETE FROM stock_daily_prices WHERE close_price = 0")
    stats["deleted_zero_close"] = n1
    n2 = db_manager.execute(db, "DELETE FROM stock_daily_prices WHERE volume = 0")
    stats["deleted_zero_volume"] = n2
    n3 = db_manager.execute(
        db, "DELETE FROM stock_daily_prices WHERE price_date > ?", (today,)
    )
    stats["deleted_future_date"] = n3

    after = db_manager.query_one(db, "SELECT COUNT(*) AS c FROM stock_daily_prices")
    stats["remaining_rows"] = _safe_int(after.get("c")) if after else 0
    stats["total_deleted"] = stats["rows_before"] - stats["remaining_rows"]
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# 3) إصلاح current_price للأسم النشطة (is_active=1) من آخر شمعة
# ─────────────────────────────────────────────────────────────────────────────
# القاعدة: كل سهم نشط (is_active=1) لازم يكون له current_price > 0. لو صفر،
# نسحبه من آخر شمعة في price_history (أحدث date للـ ticker). لو مفيش شموع،
# نـ log السهم في قائمة unrepairable.
def repair_zero_current_price(
    market_filter: Optional[str], dry_run: bool = False
) -> Dict[str, Any]:
    """أصلح current_price للأسم النشطة (is_active=1) من آخر شمعة.

    لو ``dry_run=True``: نحسب فقط (zero_price_found / unrepairable) بدون أي
    كتابة على stocks.current_price. ده بيحمي عقد الـ --dry-run.
    """
    stats: Dict[str, Any] = {
        "table": "stocks",
        "db": "stocks",
        "active_total": 0,
        "zero_price_found": 0,
        "repaired": 0,
        "unrepairable": [],
        "market_filter": market_filter or "ALL",
        "dry_run": bool(dry_run),
    }

    if not db_manager.table_exists("stocks", "stocks"):
        stats["skipped"] = "table stocks not found"
        return stats

    # جمّع الأسهم النشطة (نقبل is_active=1 فقط). لو فيه market filter نطبّقه.
    if market_filter and market_filter.upper() == "EGX":
        rows = db_manager.query(
            "stocks",
            "SELECT ticker, market, current_price FROM stocks "
            "WHERE is_active = 1 AND (market = 'EGX' OR market IS NULL)",
        )
    elif market_filter:
        rows = db_manager.query(
            "stocks",
            "SELECT ticker, market, current_price FROM stocks "
            "WHERE is_active = 1 AND market = ?",
            (market_filter,),
        )
    else:
        rows = db_manager.query(
            "stocks",
            "SELECT ticker, market, current_price FROM stocks WHERE is_active = 1",
        )

    stats["active_total"] = len(rows)

    for r in rows:
        ticker = r.get("ticker")
        try:
            cur_price = float(r.get("current_price") or 0)
        except (TypeError, ValueError):
            cur_price = 0.0
        if cur_price > 0:
            continue
        stats["zero_price_found"] += 1

        # اسحب آخر شمعة من price_history (أحدث date)
        last = db_manager.query_one(
            "price_history",
            "SELECT close FROM price_history "
            "WHERE ticker = ? AND close > 0 "
            "ORDER BY date DESC LIMIT 1",
            (ticker,),
        )
        if not last:
            stats["unrepairable"].append(ticker)
            continue
        try:
            new_price = float(last.get("close") or 0)
        except (TypeError, ValueError):
            new_price = 0.0
        if new_price <= 0:
            stats["unrepairable"].append(ticker)
            continue

        # في dry-run نتوقف هنا — بدون كتابة على stocks.current_price
        if dry_run:
            continue

        # اكتب السعر المسحوب في stocks.current_price
        db_manager.execute(
            "stocks",
            "UPDATE stocks SET current_price = ? WHERE ticker = ?",
            (new_price, ticker),
        )
        stats["repaired"] += 1

    return stats


# ─────────────────────────────────────────────────────────────────────────────
# 4) كتابة التقرير JSON
# ─────────────────────────────────────────────────────────────────────────────
def write_report(report: Dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # احتفظ بآخر N تقارير (rotate بسيط: اسم الملف ثابت + .timestamp backup)
    if path.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = path.with_name(f"{path.stem}.{ts}.json")
        try:
            path.rename(backup)
        except OSError:
            pass
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 8 — Data Hygiene Cron")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="احسب فقط بدون حذف/كتابة",
    )
    parser.add_argument(
        "--market", default=None,
        help="قصر إصلاح current_price على سوق معين (EGX/KSA/KSE/QSE). افتراضي: الكل",
    )
    parser.add_argument(
        "--report-path", default=None,
        help="مسار التقرير JSON (افتراضي: db/backups/data_hygiene_report.json)",
    )
    args = parser.parse_args()

    today = _today_iso()
    print("=" * 70)
    print(f"  🧹 Data Hygiene Cron  |  {today}  |  dry_run={args.dry_run}")
    print("=" * 70)

    report: Dict[str, Any] = {
        "run_at": _now_iso(),
        "run_date": today,
        "dry_run": bool(args.dry_run),
        "market_filter": args.market or "ALL",
        "price_history": {},
        "stock_daily_prices": {},
        "current_price_repair": {},
        "summary": {},
    }

    try:
        # 1) price_history.db
        print("\n[1/3] تنظيف price_history.db → price_history ...")
        ph = clean_price_history(args.dry_run, today)
        report["price_history"] = ph
        print(f"     zero_close={ph['deleted_zero_close']}  zero_volume={ph['deleted_zero_volume']}  "
              f"future_date={ph['deleted_future_date']}  total_deleted={ph['total_deleted']}")

        # 2) stocks.db.stock_daily_prices
        print("\n[2/3] تنظيف stocks.db → stock_daily_prices ...")
        sdp = clean_stock_daily_prices(args.dry_run, today)
        report["stock_daily_prices"] = sdp
        print(f"     zero_close={sdp['deleted_zero_close']}  zero_volume={sdp['deleted_zero_volume']}  "
              f"future_date={sdp['deleted_future_date']}  total_deleted={sdp['total_deleted']}")

        # 3) إصلاح current_price
        print("\n[3/3] إصلاح current_price للأسم النشطة ...")
        cpr = repair_zero_current_price(args.market, dry_run=args.dry_run)
        report["current_price_repair"] = cpr
        repaired_disp = cpr["repaired"]
        if args.dry_run:
            repaired_disp = "(dry-run: not applied)"
            print(f"     active={cpr['active_total']}  zero_price_found={cpr['zero_price_found']}  "
                  f"repaired={repaired_disp}  unrepairable={len(cpr['unrepairable'])}")
        else:
            print(f"     active={cpr['active_total']}  zero_price_found={cpr['zero_price_found']}  "
                  f"repaired={repaired_disp}  unrepairable={len(cpr['unrepairable'])}")

    except Exception as e:
        report["error"] = str(e)
        print(f"\n[ERROR] {e}", file=sys.stderr)
        # نكتب التقرير حتى مع الخطأ (للمراجعة)
        _write_and_print(report, args)
        return 1

    # ملخص
    report["summary"] = {
        "total_deleted_price_history": report["price_history"].get("total_deleted", 0),
        "total_deleted_stock_daily_prices": report["stock_daily_prices"].get("total_deleted", 0),
        "stocks_repaired": (
            report["current_price_repair"].get("repaired", 0)
            if isinstance(report["current_price_repair"].get("repaired"), int) else 0
        ),
        "stocks_unrepairable": len(report["current_price_repair"].get("unrepairable", [])),
    }
    _write_and_print(report, args)

    print("\n" + "=" * 70)
    print("  ✅ Data Hygiene complete.")
    print(f"     rows purged (price_history): {report['summary']['total_deleted_price_history']}")
    print(f"     rows purged (stock_daily_prices): {report['summary']['total_deleted_stock_daily_prices']}")
    print(f"     stocks repaired (current_price): {report['summary']['stocks_repaired']}")
    print(f"     stocks unrepairable: {report['summary']['stocks_unrepairable']}")
    print("=" * 70)
    return 0


def _write_and_print(report: Dict[str, Any], args) -> None:
    report_path = (
        Path(args.report_path)
        if args.report_path
        else (_PROJECT_ROOT / "db" / "backups" / "data_hygiene_report.json")
    )
    try:
        write_report(report, report_path)
        print(f"\n[report] written → {report_path}")
    except Exception as we:
        print(f"\n[report] FAILED to write {report_path}: {we}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
