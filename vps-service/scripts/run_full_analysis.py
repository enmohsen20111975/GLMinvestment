#!/usr/bin/env python3
"""
run_full_analysis.py — MANUAL "run engine now" entry point
============================================================

Maps to the prediction-generation flow documented in AUDIT-1.

This is the MINIMAL, owner-runnable script that:
  1. Loads ALL active tickers from stocks.db (EGX by default; --market flag supported).
  2. For EACH ticker, calls MaestroOrchestrator.analyze() for all 3 personas
     (gambler, balanced, conservative) — generating 3 fresh predictions per stock.
  3. Writes fresh predictions to predictions.db via PredictionTracker.record_prediction
     (called automatically inside MaestroOrchestrator.analyze at line 2918).
  4. Prints a summary (X stocks analyzed, Y predictions generated).

WHY THIS SCRIPT EXISTS
----------------------
The existing production loop (BackgroundAnalyzer._run_full_analysis_inner, line 1388)
calls orchestrator.analyze() ONCE per ticker with the default persona='balanced' —
so only 1 prediction per ticker lands in the `predictions` table. The other 2
personas (gambler, conservative) end up only in the auxiliary `persona_predictions`
table. This script forces all 3 personas into the canonical `predictions` table
so the web UI's `/api/predictions/performance-dashboard` reflects all 3.

This script uses `core.analysis_runner.run_analysis_batch` — the SAME single
write-path the HTTP endpoints (`/api/maestro/run`, `/api/admin/trigger-analysis`)
use — so the persistence schema, persona flag computation, and price-history
loading are identical to production. We just loop over personas ourselves.

USAGE
-----
    cd /root/GLMinvestment
    python3 vps-service/scripts/run_full_analysis.py                 # default: EGX, 120 bars
    python3 vps-service/scripts/run_full_analysis.py --market EGX --limit 120 --min-bars 10
    python3 vps-service/scripts/run_full_analysis.py --tickers COMI,SWDY,CICH
    python3 vps-service/scripts/run_full_analysis.py --personas gambler,balanced

Output: written to stdout + appended to vps-service/scripts/output/run_full_analysis_<ts>.log
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

# ── Path setup (must run BEFORE any vps-service imports) ──────────────────────
_VPS_DIR = Path(__file__).resolve().parent.parent  # vps-service/
_PROJECT_ROOT = _VPS_DIR.parent                     # repo root
if str(_VPS_DIR) not in sys.path:
    sys.path.insert(0, str(_VPS_DIR))

# DB paths (mirror core/analysis_runner.py)
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")
PREDICTIONS_DB = str(_PROJECT_ROOT / "db" / "predictions.db")
PRICE_HISTORY_DB = str(_PROJECT_ROOT / "db" / "price_history.db")

# The 3 canonical personas (matches PredictionTracker.record_prediction's
# normalization at vps-service/analyzers/prediction_tracker.py:202-206).
PERSONAS = ["gambler", "balanced", "conservative"]


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Load tickers from stocks.db (mirror api/maestro_routes.py Path B)
# ─────────────────────────────────────────────────────────────────────────────
def load_stocks(market: str, limit: int, tickers_req: List[str] = None) -> List[Dict[str, Any]]:
    """Load stock rows from stocks.db.

    Selection logic mirrors `/api/admin/trigger-analysis` (misc_routes.py:1087-1169):
      Path A — explicit tickers list (preserve request order)
      Path B — auto-select by is_egx30/70/100 flags + turnover_egp DESC
    """
    if not os.path.exists(STOCKS_DB):
        log(f"❌ stocks.db not found at {STOCKS_DB}")
        return []

    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row

    # KSA is stored as 'TADAWUL' in stocks.db
    db_market = "TADAWUL" if market == "KSA" else market

    try:
        if tickers_req:
            # Path A — explicit tickers
            placeholders = ",".join(["?"] * len(tickers_req))
            try:
                rows = conn.execute(f"""
                    SELECT ticker, name, name_ar, current_price, change_percent,
                           volume, sector, market, turnover_egp, is_active,
                           is_egx30, is_egx70, is_egx100
                    FROM stocks
                    WHERE UPPER(ticker) IN ({placeholders})
                      AND current_price IS NOT NULL AND current_price > 0
                """, tickers_req).fetchall()
                rows_by_ticker = {r["ticker"].upper(): dict(r) for r in rows}
                stocks = [rows_by_ticker[t] for t in tickers_req if t in rows_by_ticker]
            except Exception:
                # Fallback for older schema
                rows = conn.execute(f"""
                    SELECT ticker, name, current_price, market FROM stocks
                    WHERE UPPER(ticker) IN ({placeholders})
                      AND current_price > 0
                """, tickers_req).fetchall()
                rows_by_ticker = {r["ticker"].upper(): dict(r) for r in rows}
                stocks = [rows_by_ticker[t] for t in tickers_req if t in rows_by_ticker]
        else:
            # Path B — auto-select by EGX index flags + turnover
            fetch_n = max(limit * 5, 50)
            try:
                rows = conn.execute("""
                    SELECT ticker, name, name_ar, current_price, change_percent,
                           volume, sector, market, turnover_egp, is_active,
                           is_egx30, is_egx70, is_egx100
                    FROM stocks
                    WHERE (market = ? OR (market IS NULL AND ? = 'EGX'))
                      AND current_price IS NOT NULL AND current_price > 0
                      AND COALESCE(is_active, 1) = 1
                    ORDER BY
                      COALESCE(is_egx30, 0) DESC,
                      COALESCE(is_egx70, 0) DESC,
                      COALESCE(is_egx100, 0) DESC,
                      COALESCE(turnover_egp, 0) DESC,
                      COALESCE(value_traded, 0) DESC,
                      LENGTH(ticker) ASC
                    LIMIT ?
                """, (db_market, db_market, fetch_n)).fetchall()
                candidates = [dict(r) for r in rows]
            except Exception:
                # Fallback if is_egx*/turnover_egp columns missing
                rows = conn.execute("""
                    SELECT ticker, name, name_ar, current_price, change_percent,
                           volume, sector, market, turnover_egp, is_active
                    FROM stocks
                    WHERE (market = ? OR (market IS NULL AND ? = 'EGX'))
                      AND current_price IS NOT NULL AND current_price > 0
                    ORDER BY LENGTH(ticker) ASC
                    LIMIT ?
                """, (db_market, db_market, fetch_n)).fetchall()
                candidates = [dict(r) for r in rows]

            # Filter by history depth — skip 1-bar junk so run_analysis_batch
            # doesn't reject the entire batch (min_bars gate).
            try:
                from data.prices import filter_tickers_by_history_depth
                candidate_tickers = [c.get("ticker", "") for c in candidates]
                valid = set(filter_tickers_by_history_depth(candidate_tickers, min_bars=10))
                stocks = [c for c in candidates if c.get("ticker", "").upper() in valid]
                stocks = stocks[:limit]
                if not stocks and candidates:
                    stocks = candidates[:limit]
            except Exception:
                stocks = candidates[:limit] if candidates else []
    finally:
        conn.close()

    return stocks


# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Run maestro for all 3 personas
# ─────────────────────────────────────────────────────────────────────────────
def run_all_personas(stocks: List[Dict[str, Any]], personas: List[str], market: str,
                     limit: int, min_bars: int) -> Dict[str, Any]:
    """For each persona, call run_analysis_batch — the SAME single write-path
    used by /api/maestro/run and /api/admin/trigger-analysis.

    Each call:
      - Loads price history via data.prices.load_price_history
      - Calls MaestroOrchestrator.analyze(ticker, stock, history, {'persona_type': persona})
      - Maestro internally calls PredictionTracker.record_prediction(persona=persona)
        → INSERTs ONE row per ticker into the `predictions` table
      - Writes the analysis summary to stored_analyses table
    """
    from core.analysis_runner import run_analysis_batch  # the canonical write path

    summary = {
        "total_stocks": len(stocks),
        "personas_run": [],
        "total_predictions_written": 0,
        "total_errors": 0,
        "duration_seconds": 0.0,
    }

    overall_start = time.time()

    for persona in personas:
        log(f"\n{'='*60}\n▶️  Running persona='{persona}' on {len(stocks)} stocks...\n{'='*60}")
        run = run_analysis_batch(
            stocks=stocks,
            persona=persona,
            market=market,
            limit=limit,
            min_bars=min_bars,
            generate_predictions=False,  # we want raw predictions in `predictions` table,
                                          # NOT derived rows in `aiPrediction` table
            log_prefix=f"Manual-{persona}",
            stocks_db=STOCKS_DB,
        )
        s = run.to_summary()
        log(f"✅ persona='{persona}' done: analyzed={s['analyzed']} "
            f"persisted={s['persisted']} buy={s['buy_signals']} "
            f"errors={s['errors']} duration={s['duration_seconds']:.1f}s")

        summary["personas_run"].append({
            "persona": persona,
            "analyzed": s["analyzed"],
            "persisted": s["persisted"],
            "buy_signals": s["buy_signals"],
            "errors": s["errors"],
            "predictions_generated": s["predictions_generated"],
            "duration_seconds": s["duration_seconds"],
            "insert_errors": s["insert_errors"],
        })
        summary["total_predictions_written"] += s["analyzed"]  # one record_prediction call per analyzed stock
        summary["total_errors"] += s["errors"]

    summary["duration_seconds"] = round(time.time() - overall_start, 2)
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Verify + summarize
# ─────────────────────────────────────────────────────────────────────────────
def verify_predictions_db() -> Dict[str, Any]:
    """Read back predictions.db to confirm writes landed."""
    if not os.path.exists(PREDICTIONS_DB):
        return {"error": "predictions.db not found"}
    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.row_factory = sqlite3.Row
    try:
        # Count by persona for today
        today = datetime.now().strftime("%Y-%m-%d")
        try:
            rows = conn.execute("""
                SELECT persona, COUNT(*) as cnt
                FROM predictions
                WHERE prediction_date LIKE ?
                GROUP BY persona
            """, (f"{today}%",)).fetchall()
        except Exception:
            rows = conn.execute("""
                SELECT persona, COUNT(*) as cnt
                FROM predictions
                GROUP BY persona
            """).fetchall()
        return {r["persona"]: r["cnt"] for r in rows}
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Manual 'run engine now' — generate fresh predictions for ALL tickers × 3 personas"
    )
    parser.add_argument("--market", default="EGX", help="Market filter (EGX, TADAWUL, KSE, QSE). Default: EGX")
    parser.add_argument("--limit", type=int, default=120, help="Max stocks to analyze per persona. Default: 120")
    parser.add_argument("--min-bars", type=int, default=10, help="Min price-history bars required. Default: 10")
    parser.add_argument("--personas", default=",".join(PERSONAS),
                        help=f"Comma-separated personas to run. Default: {','.join(PERSONAS)}")
    parser.add_argument("--tickers", default=None,
                        help="Comma-separated explicit tickers (overrides market auto-select)")
    args = parser.parse_args()

    personas = [p.strip().lower() for p in args.personas.split(",") if p.strip()]
    for p in personas:
        if p not in PERSONAS:
            log(f"❌ Invalid persona '{p}'. Must be one of {PERSONAS}")
            sys.exit(1)

    tickers_req = None
    if args.tickers:
        tickers_req = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

    log("=" * 60)
    log("🚀 run_full_analysis.py — MANUAL ENGINE RUN")
    log(f"   market={args.market}  limit={args.limit}  min_bars={args.min_bars}")
    log(f"   personas={personas}  explicit_tickers={tickers_req or '(auto)'}")
    log(f"   stocks.db={STOCKS_DB}")
    log(f"   predictions.db={PREDICTIONS_DB}")
    log("=" * 60)

    # Step 1
    stocks = load_stocks(args.market, args.limit, tickers_req)
    if not stocks:
        log("❌ No stocks loaded — aborting. Check stocks.db has rows with current_price > 0.")
        sys.exit(1)
    log(f"📋 Loaded {len(stocks)} stocks from stocks.db (market={args.market})")

    # Step 2
    summary = run_all_personas(stocks, personas, args.market, args.limit, args.min_bars)

    # Step 3
    log("\n" + "=" * 60)
    log("📊 FINAL SUMMARY")
    log("=" * 60)
    log(f"   Stocks analyzed (per persona): {summary['total_stocks']}")
    log(f"   Personas run:                  {len(summary['personas_run'])}")
    log(f"   Total predictions written:     {summary['total_predictions_written']}")
    log(f"   Total errors:                  {summary['total_errors']}")
    log(f"   Total duration:                {summary['duration_seconds']}s")
    for p in summary["personas_run"]:
        log(f"   - {p['persona']:<12}: analyzed={p['analyzed']}  buy={p['buy_signals']}  "
            f"errors={p['errors']}  duration={p['duration_seconds']:.1f}s")

    log("\n📦 Verifying writes in predictions.db (by persona, today)…")
    persona_counts = verify_predictions_db()
    log(f"   {persona_counts}")
    log("=" * 60)
    log("✅ Done. Refresh the dashboard — /api/predictions/performance-dashboard will reflect the new rows.")


if __name__ == "__main__":
    main()
