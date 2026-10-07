#!/usr/bin/env python3
"""
================================================================
run_backtest_versions.py — V40.2 4-config backtest (Wave 1 P0 Fix 2)
================================================================
Rebuilds the backtest that was claimed (fabricated) in the lost
commit 0b4f2f1 ("4 backtest versions, v4 winner PF=1.31") but for
which NO script ever existed — only 36 lines of markdown in
worklog.md describing a result that was never produced.

Per Rule 21: V40.2 is the SOLE source of truth. This script runs
the V38BacktestEngine (V40.2's canonical backtest engine, the same
one used by `vps-service/engines/backtest_engine.py`) under FOUR
DIFFERENT PARAMETER CONFIGS — NOT four competing engines.

  Config A — v40.2-baseline      (default thresholds, R:R 2.0/3.0, hold 7d)
  Config B — v40.2-aggressive    (lower buy threshold 65, R:R 2.5/3.5, hold 10d)
  Config C — v40.2-conservative  (higher buy threshold 85, R:R 1.5/2.5, hold 5d)
  Config D — v40.2-balanced      (mid threshold 70, R:R 2.0/3.0, hold 14d)

Each config produces a REAL BacktestSummary with a REAL profit_factor
value — replacing the fabricated PF=1.31 with verifiable numbers.

Sandbox-only (Rule 1):
  - Writes only to db/price_history.db + db/stocks.db + db/data_engine.db
  - Refuses to run if DB_DIR matches a production path
  - All inserts are idempotent (uses INSERT OR REPLACE / UNIQUE constraints)

Usage:
    python3 vps-service/tools/run_backtest_versions.py
    python3 vps-service/tools/run_backtest_versions.py --tickers 5
    python3 vps-service/tools/run_backtest_versions.py --days 300
    python3 vps-service/tools/run_backtest_versions.py --skip-seed   # if data already present

Outputs:
    vps-service/backtest_results/wave1_p0_backtest_versions.json
    vps-service/backtest_results/wave1_p0_backtest_versions.md
================================================================
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sqlite3
import sys
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Rule 61 — RELATIVE-PATHS-ONLY
SCRIPT_DIR = Path(__file__).resolve().parent
VPS_SERVICE_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = VPS_SERVICE_DIR.parent
DB_DIR = PROJECT_ROOT / "db"
RESULTS_DIR = VPS_SERVICE_DIR / "backtest_results"

# Rule 1 — refuse to run on production paths
PRODUCTION_PATH_MARKERS = ("/root/GLMinvestment", "/home/meme/my_apps/GLMinvestment")

# Path setup for V38BacktestEngine imports
if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))


# ============================================================================
# Rule 21 — V40.2 is the sole source of truth. 4 PARAMETER configs of V40.2,
# NOT 4 competing engines.
# ============================================================================
CONFIGS = [
    {
        "name":        "v40.2-baseline",
        "description": "Default thresholds (75) + canonical R:R (2.0/3.0) + 7-day hold",
        "buy_threshold": 75,
        "rr1":           2.0,
        "rr2":           3.0,
        "max_holding_days": 7,
        "scan_interval":  5,
    },
    {
        "name":        "v40.2-aggressive",
        "description": "Lower buy threshold (65) + wider R:R (2.5/3.5) + 10-day hold",
        "buy_threshold": 65,
        "rr1":           2.5,
        "rr2":           3.5,
        "max_holding_days": 10,
        "scan_interval":  4,
    },
    {
        "name":        "v40.2-conservative",
        "description": "Higher buy threshold (85) + tighter R:R (1.5/2.5) + 5-day hold",
        "buy_threshold": 85,
        "rr1":           1.5,
        "rr2":           2.5,
        "max_holding_days": 5,
        "scan_interval":  7,
    },
    {
        "name":        "v40.2-balanced",
        "description": "Mid threshold (70) + canonical R:R (2.0/3.0) + 14-day hold",
        "buy_threshold": 70,
        "rr1":           2.0,
        "rr2":           3.0,
        "max_holding_days": 14,
        "scan_interval":  6,
    },
]


# ============================================================================
# Synthetic test data — deterministic seed for reproducibility
# ============================================================================
SEED_TICKERS = [
    # ticker  base_price  drift  vol   sector
    ("TESTA",  10.0,      +0.0025, 0.018, "Technology"),
    ("TESTB",  50.0,      +0.0020, 0.022, "Healthcare"),
    ("TESTC", 100.0,      +0.0018, 0.015, "Financials"),
    ("TESTD",  25.0,      +0.0030, 0.025, "Consumer Discretionary"),
    ("TESTE", 200.0,      +0.0015, 0.020, "Communication Services"),
    ("TESTF",  75.0,      +0.0022, 0.019, "Energy"),
    ("TESTG",  40.0,      +0.0028, 0.024, "Industrials"),
    ("TESTH",  60.0,      +0.0019, 0.021, "Consumer Staples"),
    ("TESTI",  35.0,      +0.0024, 0.023, "Materials"),
    ("TESTJ",  90.0,      +0.0017, 0.017, "Utilities"),
]


def assert_sandbox() -> None:
    resolved = str(PROJECT_ROOT.resolve())
    for marker in PRODUCTION_PATH_MARKERS:
        if resolved.startswith(marker):
            print(f"❌ REFUSING to run on production path: {resolved}", file=sys.stderr)
            print("   Rule 1 (NEVER touch prod DBs). Aborting.", file=sys.stderr)
            sys.exit(2)


def gen_synthetic_prices(
    base_price: float,
    drift: float,
    vol: float,
    n_days: int,
    rng: random.Random,
) -> List[Tuple[float, float, float, float, int]]:
    """Generate n_days of (open, high, low, close, volume) tuples with a
    deterministic upward drift so the V38 engine has a chance to fire BUY signals.
    """
    rows: List[Tuple[float, float, float, float, int]] = []
    price = base_price
    for _ in range(n_days):
        # Geometric brownian motion with positive drift
        shock = rng.gauss(0.0, 1.0)
        ret = drift + vol * shock
        open_p = price
        close = round(open_p * (1.0 + ret), 4)
        # Intraday range proportional to vol
        intraday_range = max(0.005, abs(ret) + abs(rng.gauss(0.0, vol * 0.5)))
        high = round(max(open_p, close) * (1.0 + intraday_range * 0.5), 4)
        low = round(min(open_p, close) * (1.0 - intraday_range * 0.5), 4)
        # Rising volume on up-days (accumulation pattern)
        vol_mult = 1.5 if ret > 0 else 0.7
        volume = int(500_000 * vol_mult * (1.0 + abs(shock) * 0.3))
        rows.append((open_p, high, low, close, volume))
        price = close
    return rows


def seed_sandbox_data(n_days: int = 280) -> Tuple[int, int]:
    """Seed price_history + stocks + data_engine.egksco_price_history tables.

    Returns (n_tickers_seeded, n_price_rows_seeded).
    Idempotent: uses INSERT OR REPLACE; running twice produces the same data
    (deterministic seed).
    """
    rng = random.Random(20261001)  # deterministic — Wave 1 P0 Fix 2 seed

    # ─── 1. price_history.db: add production-style columns if missing ───
    ph_path = DB_DIR / "price_history.db"
    ph_path.parent.mkdir(parents=True, exist_ok=True)
    ph_conn = sqlite3.connect(str(ph_path))
    ph_cur = ph_conn.cursor()

    # Sandbox schema has `open, high, low, close`; engine reads `open_price, ...`
    # Add the production-style columns if missing (idempotent ALTER TABLE).
    cols = [c[1] for c in ph_cur.execute("PRAGMA table_info(price_history)").fetchall()]
    for col in ("open_price", "high_price", "low_price", "close_price"):
        if col not in cols:
            ph_cur.execute(f"ALTER TABLE price_history ADD COLUMN {col} REAL")
    ph_conn.commit()

    # ─── 2. data_engine.db: create egksco_price_history (PRIMARY source) ───
    de_path = DB_DIR / "data_engine.db"
    de_path.parent.mkdir(parents=True, exist_ok=True)
    de_conn = sqlite3.connect(str(de_path))
    de_cur = de_conn.cursor()
    de_cur.execute("""
        CREATE TABLE IF NOT EXISTS egksco_price_history (
            symbol TEXT NOT NULL,
            price_date TEXT NOT NULL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            volume INTEGER,
            turnover REAL,
            PRIMARY KEY (symbol, price_date)
        )
    """)
    de_conn.commit()

    # ─── 3. stocks.db: ensure stocks table has the right shape ───
    st_path = DB_DIR / "stocks.db"
    st_conn = sqlite3.connect(str(st_path))
    st_cur = st_conn.cursor()
    # Add currency column if missing (sandbox schema lacks it)
    st_cols = [c[1] for c in st_cur.execute("PRAGMA table_info(stocks)").fetchall()]
    if "currency" not in st_cols:
        st_cur.execute("ALTER TABLE stocks ADD COLUMN currency TEXT DEFAULT 'EGP'")
        st_conn.commit()

    # ─── 4. Seed all tickers ───
    start_date = datetime(2025, 6, 1, tzinfo=timezone.utc)
    n_rows = 0
    for ticker, base_price, drift, vol, sector in SEED_TICKERS:
        # Upsert into stocks.db.stocks
        st_cur.execute("""
            INSERT OR REPLACE INTO stocks (ticker, name, name_ar, market, sector, currency, is_active)
            VALUES (?, ?, ?, 'EGX', ?, 'EGP', 1)
        """, (ticker, f"Test Stock {ticker}", f"سهم اختبار {ticker}", sector))
        st_conn.commit()

        # Generate synthetic prices
        prices = gen_synthetic_prices(base_price, drift, vol, n_days, rng)

        # Insert into egksco_price_history (PRIMARY) + price_history (EXTENDED)
        for i, (o, h, l, c, v) in enumerate(prices):
            date_str = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
            # PRIMARY: egksco_price_history
            de_cur.execute("""
                INSERT OR REPLACE INTO egksco_price_history
                (symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (ticker, date_str, o, h, l, c, v, v * c))
            # EXTENDED: price_history (with both old + new column names)
            ph_cur.execute("""
                INSERT OR REPLACE INTO price_history
                (ticker, date, open, high, low, close, volume, open_price, high_price, low_price, close_price, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (ticker, date_str, o, h, l, c, v, o, h, l, c, "synthetic-wave1-p0-fix2"))
            n_rows += 1
        de_conn.commit()
        ph_conn.commit()

    n_tickers = len(SEED_TICKERS)
    st_conn.close()
    de_conn.close()
    ph_conn.close()
    return n_tickers, n_rows


def run_config(config: Dict[str, Any], tickers: List[str], start_date: str, end_date: str) -> Dict[str, Any]:
    """Run V38BacktestEngine (V40.2 backtest engine per Rule 21) under one config."""
    from engines.backtest_engine import V38BacktestEngine  # noqa: WPS433 (local import — heavy)

    engine = V38BacktestEngine(
        buy_threshold=config["buy_threshold"],
        rr1=config["rr1"],
        rr2=config["rr2"],
        max_holding_days=config["max_holding_days"],
        use_v393=True,  # V40.2 institutional_decision_engine path
    )
    summary = engine.run_backtest(
        tickers=tickers,
        start_date=start_date,
        end_date=end_date,
        scan_interval=config["scan_interval"],
        max_daily_picks=10,
        verbose=False,
    )

    return {
        "config_name":         config["name"],
        "description":         config["description"],
        "params": {
            "buy_threshold":    config["buy_threshold"],
            "rr1":              config["rr1"],
            "rr2":              config["rr2"],
            "max_holding_days": config["max_holding_days"],
            "scan_interval":    config["scan_interval"],
            "engine":           "V38BacktestEngine (V40.2 institutional_decision_engine path)",
        },
        "total_tickers_tested": summary.total_tickers_tested,
        "total_trades":         summary.total_trades,
        "winning_trades":       summary.winning_trades,
        "losing_trades":        summary.losing_trades,
        "win_rate":             round(summary.win_rate, 4),
        "avg_return":           round(summary.avg_return, 4),
        "gross_profit":         round(summary.gross_profit, 4),
        "gross_loss":           round(summary.gross_loss, 4),
        "profit_factor":        round(summary.profit_factor, 4)
                                if summary.profit_factor != float("inf") and summary.profit_factor < 999
                                else None,
        "avg_holding_days":     round(summary.avg_holding_days, 4),
        "max_drawdown_pct":     round(summary.max_drawdown_pct, 4),
        "sharpe_ratio":         round(summary.sharpe_ratio, 4),
        "final_equity":         round(summary.final_equity, 4),
        "model_quality":        summary.model_quality_ar,
    }


def write_outputs(results: List[Dict[str, Any]], elapsed_s: float) -> Tuple[Path, Path]:
    """Write JSON + Markdown report to vps-service/backtest_results/."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    json_path = RESULTS_DIR / f"wave1_p0_backtest_versions_{ts}.json"
    md_path   = RESULTS_DIR / f"wave1_p0_backtest_versions_{ts}.md"

    # JSON
    payload = {
        "wave1_p0_fix":     "backtest_versions_rebuild",
        "retraction_for":   "lost commit 0b4f2f1 (fabricated v4 PF=1.31 claim)",
        "rule_21_compliance": "V40.2 sole source — 4 PARAMETER configs of V38BacktestEngine, NOT 4 competing engines",
        "sandbox_only":     True,
        "engine":           "vps-service/engines/backtest_engine.py::V38BacktestEngine (use_v393=True)",
        "run_at_utc":       datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds":  round(elapsed_s, 2),
        "n_configs":         len(results),
        "results":           results,
    }
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    # Markdown
    lines = [
        "# Wave 1 P0 Fix 2 — V40.2 4-config backtest (RETRACTION)",
        "",
        f"- **Retracted claim:** lost commit `0b4f2f1` — \"4 backtest versions, v4 winner PF=1.31\"",
        "- **Why retracted:** the commit added only 36 lines of markdown to `worklog.md` describing",
        "  a result that was never produced. NO backtest script existed — the PF=1.31 figure was fabricated.",
        "- **Rule 21 compliance:** V40.2 is the SOLE source of truth. This script runs the canonical",
        "  `V38BacktestEngine` (with `use_v393=True` — the V40.2 institutional_decision_engine path)",
        "  under FOUR DIFFERENT PARAMETER CONFIGS, NOT four competing engines.",
        "- **Sandbox-only (Rule 1):** writes only to `db/price_history.db` + `db/stocks.db` + `db/data_engine.db`.",
        "- **Deterministic:** synthetic price data uses a fixed random seed (20261001) for reproducibility.",
        "",
        "## Real PF numbers (replacing the fabricated PF=1.31)",
        "",
        "| Config | Buy Thresh | R:R (rr1/rr2) | Hold (d) | Trades | Win% | Gross Profit | Gross Loss | **PF** | MaxDD% | Sharpe |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        pf = r["profit_factor"]
        pf_str = f"**{pf}**" if pf is not None else "— (no losing trades)"
        lines.append(
            f"| {r['config_name']} | {r['params']['buy_threshold']} | "
            f"{r['params']['rr1']}/{r['params']['rr2']} | {r['params']['max_holding_days']} | "
            f"{r['total_trades']} | {r['win_rate']} | "
            f"{r['gross_profit']} | {r['gross_loss']} | "
            f"{pf_str} | {r['max_drawdown_pct']} | {r['sharpe_ratio']} |"
        )
    lines += [
        "",
        "## Notes on the data",
        "",
        "- 10 synthetic EGX tickers (`TESTA`..`TESTJ`) × ~280 days of synthetic price history",
        "- Deterministic GBM with positive drift (so the engine has uptrends to detect)",
        "- Production data is the owner's responsibility — this script does NOT touch prod",
        "",
        f"- JSON results: `{json_path.relative_to(PROJECT_ROOT)}`",
        f"- Generated at: {datetime.now(timezone.utc).isoformat()}",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wave 1 P0 Fix 2 — V40.2 4-config backtest (retraction of fabricated v4 PF=1.31)"
    )
    parser.add_argument("--tickers", type=int, default=10, help="Number of synthetic tickers to seed (max 10)")
    parser.add_argument("--days",    type=int, default=280, help="Days of synthetic price history per ticker")
    parser.add_argument("--skip-seed", action="store_true", help="Skip seeding (data already present)")
    args = parser.parse_args()

    assert_sandbox()

    print("=" * 72)
    print("Wave 1 P0 Fix 2 — V40.2 4-config backtest")
    print("Retraction of lost commit 0b4f2f1 (fabricated v4 PF=1.31 claim)")
    print("=" * 72)
    print(f"  Project root: {PROJECT_ROOT}")
    print(f"  DB dir:       {DB_DIR}")
    print(f"  Results dir:  {RESULTS_DIR}")
    print()

    # Step 1 — seed sandbox data
    if not args.skip_seed:
        print("Step 1 — seeding sandbox data (idempotent)...")
        n_tickers, n_rows = seed_sandbox_data(n_days=args.days)
        print(f"  ✅ Seeded {n_tickers} tickers × {args.days} days = {n_rows} price rows")
    else:
        print("Step 1 — skipping seed (--skip-seed)")
    print()

    # Step 2 — run 4 configs
    tickers = [t[0] for t in SEED_TICKERS[: args.tickers]]
    start_date = "2025-06-01"
    end_date = (datetime(2025, 6, 1, tzinfo=timezone.utc) + timedelta(days=args.days - 1)).strftime("%Y-%m-%d")

    print(f"Step 2 — running 4 V40.2 configs on {len(tickers)} tickers ({start_date} → {end_date})...")
    results: List[Dict[str, Any]] = []
    t0 = datetime.now(timezone.utc)
    for i, cfg in enumerate(CONFIGS, 1):
        print(f"  [{i}/4] {cfg['name']} — buy_threshold={cfg['buy_threshold']}, "
              f"R:R={cfg['rr1']}/{cfg['rr2']}, hold={cfg['max_holding_days']}d ...", end=" ", flush=True)
        try:
            r = run_config(cfg, tickers, start_date, end_date)
            results.append(r)
            pf = r["profit_factor"]
            pf_str = f"PF={pf}" if pf is not None else "PF=— (no losing trades)"
            print(f"trades={r['total_trades']}, WR={r['win_rate']}%, {pf_str}")
        except Exception as e:
            print(f"❌ ERROR: {type(e).__name__}: {e}")
            results.append({
                "config_name": cfg["name"],
                "description": cfg["description"],
                "params": {**cfg, "engine": "V38BacktestEngine (V40.2)"},
                "error": f"{type(e).__name__}: {e}",
            })

    elapsed = (datetime.now(timezone.utc) - t0).total_seconds()
    print(f"\n  ✅ 4 configs completed in {elapsed:.2f}s")

    # Step 3 — write outputs
    print("\nStep 3 — writing JSON + Markdown report...")
    json_path, md_path = write_outputs(results, elapsed)
    print(f"  ✅ JSON: {json_path}")
    print(f"  ✅ MD:   {md_path}")

    # Step 4 — print summary
    print("\n" + "=" * 72)
    print("REAL PF NUMBERS (replacing the fabricated PF=1.31):")
    print("=" * 72)
    print(f"  {'Config':<24} {'Trades':>7} {'Win%':>6} {'GrossP':>9} {'GrossL':>9} {'PF':>8}")
    print("  " + "-" * 68)
    for r in results:
        if "error" in r:
            print(f"  {r['config_name']:<24} ERROR: {r['error']}")
            continue
        pf = r["profit_factor"]
        pf_str = f"{pf}" if pf is not None else "—"
        print(f"  {r['config_name']:<24} {r['total_trades']:>7} "
              f"{r['win_rate']:>6.1f} {r['gross_profit']:>9.2f} "
              f"{r['gross_loss']:>9.2f} {pf_str:>8}")
    print("=" * 72)
    print()
    print("These numbers are REAL — produced by actually running the V40.2 backtest")
    print("engine on deterministic synthetic data. The lost commit's PF=1.31 was")
    print("fabricated (no script existed). This script replaces that fabrication.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
