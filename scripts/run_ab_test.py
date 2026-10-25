#!/usr/bin/env python3
"""
run_ab_test.py
==============
Phase 7: A/B Testing CLI — يُشغّل BacktestEngine.run_ab_test() ويقارن
الأداء WITH vs WITHOUT learned lessons.

الـ "control group" يشغّل MasterAnalyzer.analyze() بـ disable_lessons=True
(يتخطّى تطبيق learned_lessons). الـ "treatment group" يشغّلها بالافتراضي
(disable_lessons=False) — الدروس تُطبَّق.

النتيجة:
  - تُطبع جدول مقارنة (CONTROL vs TREATMENT vs DELTA).
  - تُحفظ في db/ab_test_results.json (الـ frontend يقرأها عبر GET
    /api/admin/ab-test).

Usage:
    # Top-20 liquid tickers (auto):
    python3 scripts/run_ab_test.py \\
        --tickers auto --start 2026-01-01 --end 2026-06-01 --horizon 30

    # Explicit list:
    python3 scripts/run_ab_test.py \\
        --tickers COMI,SWDY,EFIH --start 2026-01-01 --end 2026-06-01
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup — make `from analyzers.backtest_engine import BacktestEngine`
# work when invoked as a script.
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
VPS_SERVICE_DIR = PROJECT_ROOT / "vps-service"

if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))

from analyzers.backtest_engine import BacktestEngine, _parse_volume  # noqa: E402

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_STOCKS_DB = str(PROJECT_ROOT / "db" / "stocks.db")
DEFAULT_PRICE_HISTORY_DB = str(PROJECT_ROOT / "db" / "price_history.db")
DEFAULT_PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
DEFAULT_OUTPUT_PATH = str(PROJECT_ROOT / "db" / "ab_test_results.json")


def fetch_top_liquid_tickers(count: int = 20,
                             stocks_db: str = DEFAULT_STOCKS_DB,
                             price_history_db: str = DEFAULT_PRICE_HISTORY_DB
                             ) -> list:
    """
    Fetch top `count` tickers by avg volume.

    Tries price_history.db first (AVG(volume) GROUP BY ticker). Falls back
    to stocks.db / stocks table (parses '990.2 K' / '1.44 M' volume text).
    """
    # ---- Source 1: price_history.db (preferred) ----
    try:
        if os.path.exists(price_history_db):
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(price_history_db, writable=False).__enter__()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT ticker, AVG(volume) AS avg_vol
                    FROM price_history
                    GROUP BY ticker
                    ORDER BY avg_vol DESC
                    LIMIT ?
                    """,
                    (count,),
                )
                tickers = [row[0] for row in cursor.fetchall()]
                if tickers:
                    return tickers
            except sqlite3.OperationalError:
                pass
            finally:
                conn.close()
    except Exception as e:
        print(f"[run_ab_test] price_history.db query failed: {e}")

    # ---- Source 2 (fallback): stocks.db / stocks ----
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(stocks_db, writable=False).__enter__()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ticker, volume, avg_volume
            FROM stocks
            WHERE market = 'EGX'
              AND is_active = 1
              AND current_price IS NOT NULL
              AND current_price > 0
            """
        )
        rows = cursor.fetchall()
        conn.close()

        def _key(row):
            _t, vol, avg_vol = row
            v = _parse_volume(vol)
            a = _parse_volume(avg_vol)
            return max(v, a)

        rows.sort(key=_key, reverse=True)
        return [r[0] for r in rows[:count]]
    except Exception as e:
        print(f"[run_ab_test] stocks.db query failed: {e}")
        return []


def print_comparison_table(result: dict) -> None:
    """Pretty-print the A/B test comparison as a table."""
    control = result.get("control", {}) or {}
    treatment = result.get("treatment", {}) or {}
    comp = result.get("comparison", {}) or {}

    c_pred = control.get("valid_signals", 0)
    t_pred = treatment.get("valid_signals", 0)
    c_wr = control.get("win_rate_pct", 0.0)
    t_wr = treatment.get("win_rate_pct", 0.0)
    c_ar = control.get("avg_return_pct", 0.0)
    t_ar = treatment.get("avg_return_pct", 0.0)
    c_nr = control.get("net_return_pct", 0.0)
    t_nr = treatment.get("net_return_pct", 0.0)

    wr_d = comp.get("win_rate_delta", round(t_wr - c_wr, 2))
    ar_d = comp.get("avg_return_delta", round(t_ar - c_ar, 2))
    nr_d = comp.get("net_return_delta", round(t_nr - c_nr, 2))
    pr_d = comp.get("prediction_count_delta", t_pred - c_pred)
    verdict = comp.get("verdict", "neutral")

    verdict_emoji = {
        "lessons_help": "✅",
        "lessons_hurt": "❌",
        "neutral": "⚖️",
    }.get(verdict, "")

    print()
    print("=== A/B Test Results ===")
    print(
        f"{'':20s}{'CONTROL (no lessons)':>26s}"
        f"{'TREATMENT (with lessons)':>28s}{'DELTA':>14s}"
    )
    print(
        f"{'Predictions:':20s}{c_pred:>26d}"
        f"{t_pred:>28d}{pr_d:>+14d}"
    )
    print(
        f"{'Win rate:':20s}{c_wr:>25.2f}%"
        f"{t_wr:>27.2f}%{wr_d:>+13.2f}%"
    )
    print(
        f"{'Avg return:':20s}{c_ar:>+25.2f}%"
        f"{t_ar:>+27.2f}%{ar_d:>+13.2f}%"
    )
    print(
        f"{'Net return:':20s}{c_nr:>+25.2f}%"
        f"{t_nr:>+27.2f}%{nr_d:>+13.2f}%"
    )
    print()
    print(f"Verdict: {verdict} {verdict_emoji}")


def save_result_to_json(result: dict,
                        output_path: str = DEFAULT_OUTPUT_PATH) -> None:
    """Save the A/B test result to db/ab_test_results.json."""
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        # Add a timestamp so the frontend can display "last run".
        result_to_save = dict(result)
        result_to_save["generated_at"] = datetime.now().isoformat(
            timespec="seconds"
        )
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result_to_save, f, indent=2, ensure_ascii=False)
        print(f"\n[run_ab_test] Result saved to: {output_path}")
    except Exception as e:
        print(f"[run_ab_test] Failed to save JSON: {e}")


def parse_tickers_arg(tickers_arg: str) -> list:
    """
    Parse the --tickers argument:
      - 'auto' → fetch top 20 by volume (caller resolves)
      - 'auto:N' → fetch top N by volume
      - 'COMI,SWDY,EFIH' → split by comma
    Returns the literal list (or ['auto'] / ['auto:N'] to signal caller).
    """
    if not tickers_arg:
        return []
    s = tickers_arg.strip()
    if s.lower().startswith("auto"):
        # Could be 'auto' or 'auto:30'
        return [s]
    return [t.strip() for t in s.split(",") if t.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Phase 7: A/B Testing — compare backtest performance WITH vs "
            "WITHOUT learned lessons."
        )
    )
    parser.add_argument(
        "--tickers",
        type=str,
        default="auto",
        help=(
            "Comma-separated ticker list (e.g. 'COMI,SWDY,EFIH') or 'auto' "
            "for top-20 by volume, or 'auto:N' for top-N (default: auto)."
        ),
    )
    parser.add_argument(
        "--start",
        type=str,
        default="2026-01-01",
        help="Start date YYYY-MM-DD (default: 2026-01-01).",
    )
    parser.add_argument(
        "--end",
        type=str,
        default="2026-06-01",
        help="End date YYYY-MM-DD (default: 2026-06-01).",
    )
    parser.add_argument(
        "--horizon",
        type=int,
        default=30,
        help="Forward horizon in trading days (default: 30).",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=DEFAULT_OUTPUT_PATH,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT_PATH}).",
    )
    parser.add_argument(
        "--no-clear",
        action="store_true",
        help="Do NOT clear existing backtest_results rows before running.",
    )
    args = parser.parse_args()

    print("=" * 70)
    print("  Phase 7: A/B Testing CLI — run_ab_test.py")
    print(f"  start={args.start}  end={args.end}  horizon={args.horizon}d")
    print(f"  tickers_arg={args.tickers}  clear_existing={not args.no_clear}")
    print("=" * 70)

    # Resolve ticker list.
    raw = parse_tickers_arg(args.tickers)
    if not raw:
        print("[run_ab_test] No tickers provided. Exiting.")
        return 1

    if raw[0].lower().startswith("auto"):
        # 'auto' or 'auto:N'
        token = raw[0]
        if ":" in token:
            try:
                n = int(token.split(":", 1)[1])
            except ValueError:
                n = 20
        else:
            n = 20
        tickers = fetch_top_liquid_tickers(n)
        if not tickers:
            print(
                "[run_ab_test] Failed to fetch top liquid tickers. "
                "Pass an explicit list via --tickers COMI,SWDY,..."
            )
            return 2
        print(f"[run_ab_test] Auto-selected {len(tickers)} tickers: {', '.join(tickers)}")
    else:
        tickers = raw
        print(f"[run_ab_test] Explicit ticker list ({len(tickers)}): {', '.join(tickers)}")

    # Run the A/B test.
    try:
        engine = BacktestEngine()
    except Exception as e:
        print(f"[run_ab_test] Failed to init BacktestEngine: {e}")
        return 3

    try:
        result = engine.run_ab_test(
            tickers=tickers,
            start_date=args.start,
            end_date=args.end,
            horizon_days=args.horizon,
            clear_existing=not args.no_clear,
        )
    except Exception as e:
        print(f"[run_ab_test] run_ab_test() failed: {e}")
        import traceback
        traceback.print_exc()
        return 4

    # Print + save.
    print_comparison_table(result)
    save_result_to_json(result, output_path=args.output)

    print("\n[run_ab_test] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
