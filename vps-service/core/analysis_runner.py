"""
core/analysis_runner.py — THE single write path for stock analysis.
====================================================================

PHASE 2 of SIMPLIFICATION_PLAN (v3.51.0).

This module replaces the **duplicate analysis loops** that existed in:
  - `api/misc_routes.py::trigger_analysis_manual` (manual trigger endpoint)
  - `api/maestro_routes.py::run_full_analysis` (maestro run endpoint)
  - `analyzers/background_analyzer.py` (background scheduler loop)

All three did the SAME thing:
    for stock in stocks:
        history = load_price_history(ticker)
        if len(history) < 10: skip
        result = orchestrator.analyze(ticker, stock, history, opts)
        persist_analysis_with_persona(conn, result, market, stock)

But each had subtle differences (history limit, gate threshold, error
handling, logging) that caused production bugs (e.g. trigger used 100-bar
fallback while maestro used 120-bar canonical — different stocks passed
the gate).

Now there is ONE function: `run_analysis_batch()`. The three callers
become thin wrappers that only differ in:
  - HOW they fetch the stock list (different filters)
  - HOW they format the response (trigger = summary, maestro = results array)
  - WHAT they do after (trigger generates predictions, maestro returns)

Public API
----------
    run_analysis_batch(stocks, persona, market, limit=120, min_bars=10,
                       generate_predictions=False, log_prefix="Runner")
        -> RunResult

    RunResult fields:
        analyzed: int          — count of stocks successfully analyzed
        persisted: int         — count written to stored_analyses
        buy_count: int         — count with 'buy' in recommendation
        errors: int            — count of exceptions
        insert_errors: List[str] — first N error messages
        results: List[Dict]    — camelCase dicts for frontend (maestro)
        predictions_generated: int — if generate_predictions=True

Design
------
1. **Owns the loop**: history → gate → analyze → persist. One place.
2. **Uses data.prices** (PHASE 1) for history — no inline SQL.
3. **Uses persist_analysis_with_persona** (P0 hotfix) for writes — one schema.
4. **Thread-safe**: opens its own predictions.db connection (callers don't
   need to manage connections).
5. **Observable**: logs progress every 10 stocks + final summary.
6. **No response formatting**: returns RunResult, callers format as they wish.

Rules (enforced going forward)
------------------------------
- NO caller may open a predictions.db connection and INSERT into
  stored_analyses directly. All writes go through run_analysis_batch.
- NO caller may call orchestrator.analyze() directly in a loop — use
  run_analysis_batch (which handles history loading + persistence).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # repo root
DB_DIR = _PROJECT_ROOT / "db"
STOCKS_DB = str(DB_DIR / "stocks.db")
PREDICTIONS_DB = str(DB_DIR / "predictions.db")


# ─────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class RunResult:
    """Result of run_analysis_batch — returned to all callers."""
    analyzed: int = 0
    persisted: int = 0
    buy_count: int = 0
    errors: int = 0
    insert_errors: List[str] = field(default_factory=list)
    results: List[Dict[str, Any]] = field(default_factory=list)  # camelCase for frontend
    predictions_generated: int = 0
    total_stocks: int = 0
    duration_seconds: float = 0.0
    query_count: int = 0  # PHASE 5 (v3.54.0): DB queries on predictions.db
    price_cache_hits: int = 0  # PHASE 5: LRU cache hits on data.prices
    price_cache_misses: int = 0  # PHASE 5: LRU cache misses on data.prices

    def to_summary(self) -> Dict[str, Any]:
        """Compact summary for trigger-style responses."""
        return {
            "analyzed": self.analyzed,
            "persisted": self.persisted,
            "buy_signals": self.buy_count,
            "errors": self.errors,
            "total_stocks": self.total_stocks,
            "predictions_generated": self.predictions_generated,
            "duration_seconds": round(self.duration_seconds, 2),
            "insert_errors": self.insert_errors[:5],
            # PHASE 5 (v3.54.0): observability metrics
            "query_count": self.query_count,
            "price_cache_hits": self.price_cache_hits,
            "price_cache_misses": self.price_cache_misses,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helper: extract human data for frontend (canonical implementation, PHASE 2)
# ─────────────────────────────────────────────────────────────────────────────
def _extract_human_data(result) -> Optional[Dict]:
    """Extract the structured 'human' narration dict from a MaestroResult.

    PHASE 2 (v3.51.0): This is the CANONICAL implementation. It was moved
    here from `api/maestro_routes.py` so that both `run_analysis_batch`
    (this module) and `get_maestro_results` (maestro_routes) share ONE
    definition. Accesses `result.human_narrative`, `result.human_personas`,
    `result.human_context` directly — these are the attributes that
    MaestroOrchestrator.analyze() returns.

    Returns:
        dict with keys: narrative, personas, context (each only present if
        the corresponding attribute is truthy on `result`).
        None if no human attributes are present.
    """
    human: Dict[str, Any] = {}

    human_narrative = getattr(result, "human_narrative", None)
    if human_narrative:
        human["narrative"] = {
            "line1": getattr(human_narrative, "line1", "") or "",
            "line2": getattr(human_narrative, "line2", "") or "",
            "line3": getattr(human_narrative, "line3", "") or "",
        }

    human_personas = getattr(result, "human_personas", None)
    if human_personas:
        human["personas"] = {
            "hunter": getattr(human_personas, "hunter", None),
            "momentum": getattr(human_personas, "momentum", None),
            "value": getattr(human_personas, "value", None),
        }

    human_context = getattr(result, "human_context", None)
    if human_context:
        human["context"] = {
            "time": getattr(human_context, "time_context", None),
            "sector": getattr(human_context, "sector_context", None),
            "market": getattr(human_context, "market_context", None),
            "historical": getattr(human_context, "historical_context", None),
            "behavioral": getattr(human_context, "behavioral_context", None),
        }

    return human if human else None


__all__ = ["run_analysis_batch", "RunResult", "_extract_human_data"]


# ─────────────────────────────────────────────────────────────────────────────
# THE single batch runner
# ─────────────────────────────────────────────────────────────────────────────
def run_analysis_batch(
    stocks: List[Dict[str, Any]],
    persona: str = None,
    market: str = "EGX",
    limit: int = 120,
    min_bars: int = 10,
    generate_predictions: bool = False,
    log_prefix: str = "Runner",
    orchestrator=None,
    stocks_db: str = STOCKS_DB,
    max_buy_recommendations: Optional[int] = None,
) -> RunResult:
    """Run MaestroOrchestrator on a batch of stocks — THE single write path.

    Args:
        stocks: List of stock dicts (must have 'ticker' key). Caller filters.
        persona: 'gambler' | 'balanced' | 'conservative' | 'investor'.
        market: 'EGX' | 'TADAWUL' | etc. (for stored_analyses.market column).
        limit: Max price-history bars to load per stock (default 120).
        min_bars: Minimum bars required to analyze (default 10).
        generate_predictions: If True, call generate_predictions_internal after.
        log_prefix: Prefix for log lines (e.g. "trigger", "Maestro", "BG").
        orchestrator: Optional pre-initialized MaestroOrchestrator. If None,
                      a new one is created (and closed) internally.
        stocks_db: Path to stocks.db (for orchestrator init).

    Returns:
        RunResult with analyzed/persisted/buy_count/errors/results.

    Side effects:
        - Writes to stored_analyses in predictions.db (via persist_analysis_with_persona)
        - Optionally generates aiPrediction rows (if generate_predictions=True)
        - Logs progress to stdout
    """
    start_time = datetime.now()
    result = RunResult(total_stocks=len(stocks))

    if not stocks:
        return result

    # ── 1) Initialize orchestrator (or reuse caller's) ──
    # KILL-MAESTRO: Maestro معطل — V40.2 هو العقل الوحيد
    _owns_orchestrator = False
    if orchestrator is None:
        # Maestro معطل بالكامل — مش بنعمل init
        orchestrator = None
        result.insert_errors.append("MaestroOrchestrator DISABLED — V40.2 is the only engine")
        print(f"[{log_prefix}] ⚠️ MaestroOrchestrator DISABLED — V40.2 is the only engine")
        result.duration_seconds = (datetime.now() - start_time).total_seconds()
        return result

    # ── 2) Open predictions.db connection (owned by this function) ──
    # PHASE 5 (v3.54.0): wrap with set_trace_callback to count queries.
    _sql_log: List[str] = []  # collects every SQL statement for counting
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        pred_conn = db_manager.get_connection(PREDICTIONS_DB, writable=False)
        pred_conn.row_factory = sqlite3.Row
        # Set trace callback BEFORE any execute() so we capture PRAGMA too
        pred_conn.set_trace_callback(lambda stmt: _sql_log.append(stmt))
        pred_conn.execute("PRAGMA busy_timeout=30000")
    except Exception as e:
        result.insert_errors.append(f"predictions.db connect failed: {e}")
        print(f"[{log_prefix}] ❌ predictions.db connect failed: {e}")
        result.duration_seconds = (datetime.now() - start_time).total_seconds()
        return result

    # ── 3) Import persist helper + price loader (lazy) ──
    # PHASE 5-2 (v3.55.0): use the BATCH write path (executemany) instead of
    # calling persist_analysis_with_persona per-stock. This collapses N
    # INSERTs + N commits + N PRAGMA table_info checks into 1 executemany +
    # 1 commit + 1 schema check — P5 principle "Write Batched".
    try:
        from analyzers.background_analyzer import (
            persist_analysis_batch,
            _build_stored_analysis_row,
        )
        from analyzers.background_analyzer import resolve_market
    except Exception as e:
        result.insert_errors.append(f"import persist_analysis_batch failed: {e}")
        print(f"[{log_prefix}] ❌ import failed: {e}")
        try:
            pred_conn.close()
        except Exception:
            pass
        result.duration_seconds = (datetime.now() - start_time).total_seconds()
        return result

    try:
        from data.prices import load_price_history
    except Exception as e:
        result.insert_errors.append(f"import data.prices failed: {e}")
        print(f"[{log_prefix}] ❌ data.prices import failed: {e}")
        try:
            pred_conn.close()
        except Exception:
            pass
        result.duration_seconds = (datetime.now() - start_time).total_seconds()
        return result

    # ── 4) THE loop — one place, one logic ──
    # PHASE 5-2 (v3.55.0): collect rows in-memory during the loop (zero
    # predictions.db I/O per stock), then batch-write once after the loop.
    _pending_rows: List[tuple] = []
    _pending_buy_rows: List[tuple] = []
    print(f"[{log_prefix}] ▶️ starting batch: {len(stocks)} stocks, persona={persona}, market={market}")

    # P0-DYNAMIC: احسب الـ thresholds الديناميكية من الـ batch قبل ما أي بوابة
    # تشتغل. ده بيخلي turnover/volume/|chg_1d| floors تتعدّل لـ واقع السوق
    # الحالي (max(FLOOR, percentile)) بدل الثوابت القاسية (500K/10K/3%).
    # قبل الفكس ده، 542/542 صف كانت g=0/i=0 لأن البوابات قاسية جداً على EGX.
    try:
        from core.opportunity_quality import set_dynamic_thresholds
        set_dynamic_thresholds(stocks)  # stocks = list of fund dicts from stocks.db
    except Exception as _sdt_e:
        print(f"[{log_prefix}] set_dynamic_thresholds failed (using floors): {_sdt_e}")

    for idx, stock in enumerate(stocks, 1):
        ticker = stock.get("ticker", "")
        if not ticker:
            continue
        
        # Filter ISINs (fatal bug: EGS72XL1C014 etc)
        if len(ticker) > 5 or ticker.upper().startswith('EGS'):
            continue

        try:
            # 4a) Load price history (PHASE 1: unified cached reader)
            try:
                history = load_price_history(ticker, limit=limit) or []
            except Exception as _lph_err:
                result.insert_errors.append(f"{ticker}: load_price_history error: {_lph_err}")
                continue

            # 4b) History gate
            if len(history) < min_bars:
                result.insert_errors.append(
                    f"{ticker}: insufficient history ({len(history)}/{min_bars} bars)"
                )
                continue

            # 4c) Analyze (P21: pass persona_type to orchestrator)
            analysis = orchestrator.analyze(
                ticker, stock, history, {"persona_type": persona}
            )

            if not analysis:
                result.insert_errors.append(f"{ticker}: orchestrator returned None")
                continue

            result.analyzed += 1
            rec_value = (getattr(analysis, "recommendation", "hold") or "hold").lower()
            is_buy = "buy" in rec_value
            if is_buy:
                result.buy_count += 1

            # 4d) Build the stored_analyses row IN-MEMORY (PHASE 5-2: no DB I/O
            # here — rows are batch-written once after the loop). Persona flags
            # are computed from stocks.db (cached) inside this call; predictions.db
            # is NOT touched. P0 hotfix: one write path, one schema.
            try:
                _stock_market = resolve_market(
                    ticker,
                    fallback_market=(stock.get("market") or market or "EGX"),
                ).upper()
            except Exception:
                _stock_market = (stock.get("market") or market or "EGX").upper()

            _row = None
            try:
                _row = _build_stored_analysis_row(
                    analysis, market=_stock_market, stock=stock
                )
            except Exception as _be:
                result.insert_errors.append(f"{ticker}: build_row error: {_be}")

            # R/R + percentage gate for BUY signals
            _rr_rejected = False
            if _row is not None and is_buy:
                _entry = float(getattr(analysis, "entry_price", 0) or 0)
                _target = float(getattr(analysis, "target", 0) or 0)
                _stop = float(getattr(analysis, "stop_loss", 0) or 0)

                if _entry > 0 and _target > 0 and _stop > 0:
                    if _target < _entry * 1.05:
                        _rr_rejected = True
                    elif _stop > _entry * 0.975:
                        _rr_rejected = True
                    elif (_entry - _stop) > 0 and ((_target - _entry) / (_entry - _stop)) < 2.0:
                        _rr_rejected = True

                if _rr_rejected:
                    result.insert_errors.append(
                        f"{ticker}: BUY rejected — target={_target:.2f} stop={_stop:.2f} "
                        f"entry={_entry:.2f} (requires target≥+5%, stop≤-2.5%, R/R≥2.0)"
                    )
                    result.buy_count -= 1
                else:
                    _pending_buy_rows.append((
                        float(getattr(analysis, "maestro_score", 0) or 0),
                        _row
                    ))
            elif _row is not None:
                _pending_rows.append(_row)

            # 4e) Build frontend result dict (camelCase, for maestro-style callers)
            phases = getattr(analysis, "phases", None) or {}
            regime_phase = phases.get("regime", {}) if isinstance(phases, dict) else {}
            timeframe_phase = phases.get("timeframe", {}) if isinstance(phases, dict) else {}
            volume_phase = phases.get("volume", {}) if isinstance(phases, dict) else {}

            volume_ratio = volume_phase.get("volume_ratio", 1.0) if volume_phase else 1.0
            volume_rating = min(100, max(0, int(float(volume_ratio) * 50)))

            result.results.append({
                "ticker": getattr(analysis, "ticker", ticker),
                "name": stock.get("name", ""),
                "nameAr": stock.get("name_ar", ""),
                "currentPrice": float(stock.get("current_price", 0) or 0),
                "maestroScore": float(getattr(analysis, "maestro_score", 50) or 50),
                "recommendation": getattr(analysis, "recommendation", "hold") or "hold",
                "recommendationAr": getattr(analysis, "recommendation_ar", "احتفاظ") or "احتفاظ",
                "regime": regime_phase.get("phase", "range") if regime_phase else "range",
                "timeframeConfluence": float(timeframe_phase.get("confluence_score", 50)) if timeframe_phase else 50.0,
                "volumeRating": float(volume_rating),
                "newsSentiment": "neutral",
                "newsSentimentScore": 0.0,
                "confidence": float(getattr(analysis, "confidence", 50) or 50),
                "stopLoss": float(analysis.stop_loss) if getattr(analysis, "stop_loss", None) is not None else None,
                "target": float(analysis.target) if getattr(analysis, "target", None) is not None else None,
                "sector": stock.get("sector", ""),
                "lastUpdated": datetime.now().isoformat(),
                "human": _extract_human_data(analysis),
            })

            # 4f) Progress log every 10 stocks
            if idx % 10 == 0:
                print(f"[{log_prefix}] 📊 {idx}/{len(stocks)} — analyzed={result.analyzed} persisted={result.persisted} buy={result.buy_count}")

        except Exception as e:
            result.errors += 1
            result.insert_errors.append(f"{ticker}: analyze error: {e}")
            # don't print full traceback per-stock (too noisy) — just the message

    # ── 4g) Cap BUY recommendations if max_buy_recommendations is set ──
    if _pending_buy_rows:
        if max_buy_recommendations is not None and max_buy_recommendations > 0:
            _pending_buy_rows.sort(key=lambda x: x[0], reverse=True)
            _capped = _pending_buy_rows[:max_buy_recommendations]
            _rejected_count = len(_pending_buy_rows) - len(_capped)
            if _rejected_count > 0:
                result.insert_errors.append(
                    f"[CAP] {log_prefix}: capped {_rejected_count} BUY recommendations "
                    f"to top {max_buy_recommendations} by score"
                )
                result.buy_count -= _rejected_count
            for _, row in _capped:
                _pending_rows.append(row)
        else:
            for _, row in _pending_buy_rows:
                _pending_rows.append(row)

    # ── 5) BATCH WRITE — one executemany + one commit (PHASE 5-2, P5) ──
    # All pending rows (built in-memory during the loop) are flushed to
    # stored_analyses in a single DB round-trip. This replaces N per-stock
    # INSERT+commit calls with 1 executemany + 1 commit + 1 schema check.
    if _pending_rows:
        try:
            _ok, _batch_errors = persist_analysis_batch(pred_conn, _pending_rows)
            result.persisted = _ok
            if _batch_errors:
                result.insert_errors.extend(_batch_errors[:10])  # cap to first 10
            print(
                f"[{log_prefix}] 💾 batch write: {_ok}/{len(_pending_rows)} rows "
                f"committed{' (per-row fallback)' if _batch_errors else ' (atomic)'}"
            )
        except Exception as _bwe:
            result.insert_errors.append(f"persist_analysis_batch: {_bwe}")
            print(f"[{log_prefix}] ⚠️ batch write failed: {_bwe}")

    # ── 6) Close predictions connection ──
    try:
        pred_conn.close()
    except Exception:
        pass

    # ── 7) Optional: generate aiPrediction rows (trigger-style) ──
    if generate_predictions and result.analyzed > 0:
        try:
            from api.ai_predictions_routes import generate_predictions_internal
            _ok, _preds = generate_predictions_internal(
                market=market, min_score=60, use_cached=True, persona=persona
            )
            if _ok and isinstance(_preds, list):
                result.predictions_generated = len(_preds)
        except Exception as e:
            result.insert_errors.append(f"generate_predictions: {e}")

    # ── 8) Final summary ──
    result.duration_seconds = (datetime.now() - start_time).total_seconds()
    result.query_count = len(_sql_log)  # PHASE 5: total SQL statements on predictions.db

    # PHASE 5: collect price cache stats (if available)
    try:
        from data.prices import get_cache_stats
        _pcs = get_cache_stats()
        result.price_cache_hits = _pcs.get("hits", 0)
        result.price_cache_misses = _pcs.get("misses", 0)
    except Exception:
        pass

    # PHASE 5: log observability metrics (queries per stock, cache hit rate)
    _qps = result.query_count / max(len(stocks), 1)  # queries per stock
    _cache_total = result.price_cache_hits + result.price_cache_misses
    _hit_rate = (result.price_cache_hits / _cache_total * 100) if _cache_total > 0 else 0.0
    print(
        f"[{log_prefix}] ✅ batch done: "
        f"analyzed={result.analyzed}/{len(stocks)} "
        f"persisted={result.persisted} "
        f"buy={result.buy_count} "
        f"errors={result.errors} "
        f"duration={result.duration_seconds:.1f}s "
        f"queries={result.query_count} ({_qps:.1f}/stock) "
        f"price_cache={_hit_rate:.0f}% ({result.price_cache_hits}/{_cache_total})"
    )

    return result
