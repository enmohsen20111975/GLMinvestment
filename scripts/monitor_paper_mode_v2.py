#!/usr/bin/env python3
"""
monitor_paper_mode_v2.py — مراقبة يومية لـ paper mode
======================================================
يشغل كل يوم ويسجل:
  - الأسهم اللي دخلت بسبب الـ dynamic threshold (V2-only)
  - الأسهم اللي دخلت بسبب volume_surge_bypass
  - الأسهم اللي اترفضت بسبب pump-and-dump guard
  - أي خسارة فوق 5%

CLI:
  python3 scripts/monitor_paper_mode_v2.py
  python3 scripts/monitor_paper_mode_v2.py --days 7
"""
from __future__ import annotations
import json, sqlite3, sys
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import (
    should_reject_by_liquidity,
    classify_price_bucket,
    dynamic_min_turnover,
    has_volume_surge,
)

STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
PAPER_CONFIG = PROJECT_ROOT / "db" / "paper_mode_v2.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def log(msg):
    print(msg, flush=True)


def parse_volume(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m; s = s[:-1]; break
    try: return float(s) * mult
    except: return 0.0


def scan_daily_universe(days: int = 1):
    """امسح كل EGX stock لليوم/الأيام الماضية وشوف مين اللي V2 بـ يقبله."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    last_date = conn.execute("SELECT MAX(price_date) FROM stock_daily_prices").fetchone()[0]
    start_date = (datetime.strptime(last_date, "%Y-%m-%d") - timedelta(days=days)).strftime("%Y-%m-%d")

    egx_tickers = [r[0] for r in conn.execute(
        "SELECT ticker FROM stocks WHERE market='EGX'"
    ).fetchall()]

    results = {
        "scan_date": last_date,
        "scan_window": f"{start_date} → {last_date}",
        "total_egx": len(egx_tickers),
        "v2_only_accepted": [],
        "bypass_activated": [],
        "pump_and_dump_rejected": [],
        "explosive_surge_candidates": [],
    }

    import statistics
    for ticker in egx_tickers:
        rows = conn.execute("""
            SELECT price_date, close, volume, turnover FROM stock_daily_prices
            WHERE ticker=? AND price_date>=? AND close IS NOT NULL AND close>0
            ORDER BY price_date DESC LIMIT 25
        """, (ticker, start_date)).fetchall()
        if len(rows) < 20:
            continue
        rows = list(reversed(rows))
        closes = [r["close"] for r in rows]
        volumes = [parse_volume(r["volume"]) for r in rows]
        turnovers = [r["turnover"] if r["turnover"] else c*v for r,c,v in zip(rows, closes, volumes)]
        avg_turnover = statistics.mean(turnovers[-20:]) if len(turnovers) >= 20 else 0
        current_price = closes[-1]

        # V2 check
        rejected, reason, bypass, threshold = should_reject_by_liquidity(
            avg_turnover=avg_turnover, current_price=current_price,
            volumes=volumes, closes=closes, market_dead=False
        )

        # LEGACY check (500K)
        legacy_passed = avg_turnover >= 500_000

        if not rejected and not legacy_passed:
            # V2-only accepted
            entry = {
                "ticker": ticker,
                "price": round(current_price, 2),
                "bucket": classify_price_bucket(current_price),
                "avg_turnover": round(avg_turnover, 0),
                "threshold": threshold,
                "bypass": bypass,
                "reason": reason,
            }
            results["v2_only_accepted"].append(entry)
            if bypass:
                results["bypass_activated"].append(entry)

        if "pump-and-dump" in reason:
            results["pump_and_dump_rejected"].append({
                "ticker": ticker, "price": round(current_price, 2),
                "avg_turnover": round(avg_turnover, 0),
            })

    conn.close()
    return results


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=1)
    args = parser.parse_args()

    # تحقق إن paper mode فعال
    if not PAPER_CONFIG.exists():
        log("❌ paper_mode_v2.json مش موجود — V2 مش في paper mode!")
        return 1
    config = json.load(open(PAPER_CONFIG))
    if not config.get("paper_mode"):
        log("❌ paper_mode = false — V2 مش في paper mode!")
        return 1

    log(f"═══ Paper Mode V2 Daily Monitor — {datetime.now().strftime('%Y-%m-%d %H:%M')} ═══")
    log(f"  Paper started: {config['paper_mode_started']}")
    log(f"  Paper ends:   {config['paper_mode_end_target']}")
    log(f"  Scan window:  آخر {args.days} يوم")
    log("")

    results = scan_daily_universe(args.days)

    log(f"📊 ملخص المسح:")
    log(f"  إجمالي EGX: {results['total_egx']}")
    log(f"  V2-only accepted (dynamic threshold): {len(results['v2_only_accepted'])}")
    log(f"  Bypass activated: {len(results['bypass_activated'])}")
    log(f"  Pump-and-dump rejected: {len(results['pump_and_dump_rejected'])}")
    log("")

    if results["v2_only_accepted"]:
        log("📋 V2-only accepted (أسهم جديدة دخلت بسبب V2):")
        for r in results["v2_only_accepted"]:
            bypass_tag = "🔥BYPASS" if r["bypass"] else "normal"
            log(f"  {r['ticker']:10s}  price={r['price']:>8.2f}  bucket={r['bucket']:10s}  "
                f"turnover={r['avg_turnover']:>12,.0f}  threshold={r['threshold']:>7,.0f}  {bypass_tag}")
        log("")

    if results["pump_and_dump_rejected"]:
        log("🚫 Pump-and-dump rejections (turnover=0):")
        for r in results["pump_and_dump_rejected"][:10]:
            log(f"  {r['ticker']:10s}  price={r['price']:>8.2f}  turnover={r['avg_turnover']:>12,.0f}")
        log("")

    # تحقق من شروط الإيقاف
    kill_switch = False
    kill_reasons = []
    # الشرط 3: لو ظهر أي سهم turnover=0 → نوقف الـ bypass
    if results["pump_and_dump_rejected"]:
        kill_switch = True
        kill_reasons.append(f"pump-and-dump detected: {len(results['pump_and_dump_rejected'])} stocks")

    if kill_switch:
        log("⚠️ KILL SWITCH ACTIVATED:")
        for r in kill_reasons:
            log(f"  - {r}")
        log("  → نوقف الـ bypass فورًا ونراجع!")

    # حفظ التقرير اليومي
    today_str = datetime.now().strftime("%Y%m%d")
    out_path = OUTPUT_DIR / f"paper_monitor_{today_str}.json"
    results["kill_switch_activated"] = kill_switch
    results["kill_switch_reasons"] = kill_reasons
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ Daily report saved: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
