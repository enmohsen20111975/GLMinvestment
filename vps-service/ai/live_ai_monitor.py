#!/usr/bin/env python3
"""
Live AI Monitor — مراقبة AI أثناء الجلسة
==========================================
Module بيخلّي الـ AI (Ollama/glm-fast) يشتغل أثناء الجلسة (مش بس 2 AM).
بيستقبل الأسهم اللي الـ Hot Stocks Detector لقاها، يحللها بالـ RAG AI ويعطي قرار سريع.

بيشتغل كل 15 دقيقة (مثلاً من scheduler):
  1. يستدعى HotStocksDetector.detect_hot_stocks()
  2. ياخد أعلى N سهم (sorted by volume_ratio)
  3. لكل سهم: يجيب indicators + يحلل بالـ AI
  4. يخزن النتائج في live_ai_signals table
  5. يرجّع summary

جدول live_ai_signals (في predictions.db):
  - ticker, decision, confidence, reason, narrative
  - source ('live_ai' / 'hot_stock' / 'breakout' / 'volume_spike')
  - indicators_json (snapshot من المؤشرات وقت الكشف)
  - detected_at (ISO timestamp وقت الكشف)

نمط الكود متبوع من nightly_analysis.py (Arabic docstrings + typing + logging + try/except).

Author: M2Y Team
Version: 1.0
"""

from __future__ import annotations

import json
import logging
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# --- مسارات الـ DBs — نفس pattern بتاع hot_stocks_detector.py / nightly_analysis.py ---
_AI_DIR = Path(__file__).resolve().parent
_VPS_DIR = _AI_DIR.parent
_PROJECT_ROOT = _VPS_DIR.parent
# خلي vps-service قابل للاستيراد عشان `from ai.xxx import ...` يشتغل
sys.path.insert(0, str(_VPS_DIR))

PREDICTIONS_DB = str(_PROJECT_ROOT / "db" / "predictions.db")

# --- إعدادات الـ AI للـ live mode (سريعة عشان الـ scheduler ما يعلّقش) ---
AI_TIMEOUT_SEC = 30   # timeout قصير (مش 90s زي nightly)
AI_MAX_TOKENS = 300   # tokens قليلة → response أسرع
AI_RAG_LIMIT = 2      # عدد similar stories (limit=2 للسرعة)
HOT_MIN_CHANGE_PCT = 2.0  # نفس default بتاع HotStocksDetector


class LiveAIMonitor:
    """
    مراقب AI أثناء الجلسة.

    Lazy initialization:
        الـ modules (GLMFinanceAgent, HotStocksDetector, DecisionEngine) ما
        يتلّعمش إلا لما methods تتستدعى — عشان لو module ناقص أو DBs مش
        متوفرة، الكلاس يفضل قابل للاستيراد بدون انهيار.
    """

    def __init__(self, db_path: str = PREDICTIONS_DB):
        """
        Lazy initialization — ما نستوردهش الـ modules هنا.

        بس نحدد المسار ونعلّم الـ schema بأنه مش جاهز (هيتإنشاء عند أول
        استخدام في `_ensure_schema`).
        """
        self.db_path = db_path
        self._schema_ready = False

    # ------------------------------------------------------------------
    # Lazy helpers — استيراد الـ modules داخل methods
    # ------------------------------------------------------------------

    def _get_agent(self):
        """Lazy-load GLMFinanceAgent بـ timeout قصير للـ live mode."""
        from ai.glm_finance_agent import GLMFinanceAgent
        return GLMFinanceAgent(timeout=AI_TIMEOUT_SEC)

    def _get_detector(self):
        """Lazy-load HotStocksDetector."""
        from ai.hot_stocks_detector import HotStocksDetector
        return HotStocksDetector()

    def _get_decision_engine(self):
        """Lazy-load DecisionEngine."""
        from ai.decision_engine import DecisionEngine
        return DecisionEngine()

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def _ensure_schema(self) -> None:
        """Create live_ai_signals table + indexes (IF NOT EXISTS)."""
        if self._schema_ready:
            return
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=True)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS live_ai_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    decision TEXT,
                    confidence INTEGER,
                    reason TEXT,
                    narrative TEXT,
                    source TEXT,
                    indicators_json TEXT,
                    detected_at TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_live_ai_ticker "
                "ON live_ai_signals(ticker)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_live_ai_detected "
                "ON live_ai_signals(detected_at)"
            )
            conn.commit()
            conn.close()
            self._schema_ready = True
            logger.debug("live_ai_signals schema جاهز في %s", self.db_path)
        except sqlite3.Error as e:
            # مش مميت — الكلاس يفضل شغّال، بس الـ storage هيفشل
            logger.error("فشل إنشاء schema live_ai_signals: %s", e)

    # ------------------------------------------------------------------
    # analyze_hot_stock
    # ------------------------------------------------------------------

    def analyze_hot_stock(self, ticker: str, indicators: dict) -> dict:
        """
        تحليل سهم واحد بالـ AI أثناء الجلسة.

        Steps:
          1. يدوّر على حالات مشابهة (RAG من stock_stories) — limit=2 للسرعة
          2. يبني RAG prompt ذكي
          3. يستدعي glm-fast بـ timeout قصير (30s) و max_tokens قليلة (300)
          4. يرجّع decision dict (decision / confidence / reason / narrative)

        Args:
            ticker: كود السهم (زي "COMI")
            indicators: dict فيه على الأقل {rsi, maestro_score, recommendation, ...}

        Returns:
            dict: {decision, confidence, reason, narrative} لو AI نجح،
            أو {} فاضي لو فشل (Ollama مش متاح / timeout / parse error).
            الـ caller بيخزّن بدون تحليل لو رجّع {}.
        """
        # Lazy import — لو module ناقص، نرجّع {} بدون انهيار الكلاس
        try:
            agent = self._get_agent()
            engine = self._get_decision_engine()
        except Exception as e:
            logger.warning("ما قدرناش نحمّل AI modules لـ %s: %s", ticker, e)
            return {}

        # لو AI (Ollama) مش متاح → نرجّع {} فوراً (caller يخزّن بدون تحليل)
        try:
            if not agent.is_available():
                logger.info("Ollama مش متاح — skip AI لـ %s", ticker)
                return {}
        except Exception as e:
            logger.warning("فشل فحص Ollama لـ %s: %s", ticker, e)
            return {}

        # --- RAG: similar stories (limit=2 للسرعة) ---
        # current_rsi لازم يكون float أو None (مش string) عشان Comparison ما يفشلش
        rsi_raw = indicators.get("rsi")
        if isinstance(rsi_raw, (int, float)) and rsi_raw:
            rsi_for_engine: Optional[float] = float(rsi_raw)
        else:
            rsi_for_engine = None

        rec_val = (
            indicators.get("recommendation")
            or indicators.get("signal")
            or ""
        )

        try:
            similar = engine.find_similar_stories(
                ticker=ticker,
                current_rsi=rsi_for_engine,
                current_recommendation=str(rec_val),
                limit=AI_RAG_LIMIT,
            )
        except Exception as e:
            logger.warning("فشل find_similar_stories لـ %s: %s", ticker, e)
            similar = []

        # --- Build RAG prompt ---
        try:
            prompt = engine.build_rag_prompt(ticker, indicators, similar)
        except Exception as e:
            logger.warning("فشل build_rag_prompt لـ %s: %s", ticker, e)
            return {}

        # --- Call AI (timeout قصير + tokens قليلة) ---
        # QWEN-UNIFY: call_fast = الموديل الموحّد من env (glm-fast default).
        try:
            raw = agent.call_fast(
                prompt, max_tokens=AI_MAX_TOKENS
            )
        except Exception as e:
            logger.warning("فشل استدعاء Ollama لـ %s: %s", ticker, e)
            return {}

        if not raw:
            logger.info("Ollama رجّع response فاضي لـ %s", ticker)
            return {}

        # --- Parse JSON response ---
        try:
            decision = agent._parse_json_response(raw)
        except Exception as e:
            logger.warning("فشل parse response لـ %s: %s", ticker, e)
            return {}

        if "decision" not in decision:
            logger.info("AI response ما فيهش decision key لـ %s", ticker)
            return {}

        # كل شي تمام — نرجّع الـ decision
        logger.info(
            "✅ AI لـ %s: %s (confidence=%s)",
            ticker,
            decision.get("decision"),
            decision.get("confidence"),
        )
        return decision

    # ------------------------------------------------------------------
    # scan_and_analyze
    # ------------------------------------------------------------------

    def scan_and_analyze(self, market: str = "EGX", max_stocks: int = 10) -> dict:
        """
        المسح الكامل أثناء الجلسة:

        Flow:
          1. يستدعى HotStocksDetector.detect_hot_stocks(market, min_change_pct=2.0)
          2. لو مفيش نتائج → return {"analyzed": 0, "signals": []}
          3. ياخد أعلى max_stocks (sorted by volume_ratio desc)
          4. لكل سهم:
             a. indicators = agent._fetch_indicators(ticker)
             b. لو مفيش indicators → skip السهم ده
             c. similar = DecisionEngine().find_similar_stories(ticker, rsi, rec, limit=2)
             d. prompt = DecisionEngine().build_rag_prompt(ticker, indicators, similar)
             e. raw = agent.call_fast(prompt, max_tokens=300)  # QWEN-UNIFY
             f. decision = agent._parse_json_response(raw)
             g. لو "decision" in decision → خزّن في live_ai_signals (source='live_ai')
                غير كده → خزّن بدون تحليل (source='hot_stock')
          5. لو Ollama مش متاح أصلاً → خزّن كل الـ hot stocks بدون تحليل AI

        Args:
            market: السوق (default 'EGX')
            max_stocks: أقصى عدد أسهم نحللها (default 10)

        Returns:
            {
                "analyzed": int,        # إجمالي الأسهم اللي اتدخلوا (اتخزّنوا)
                "success": int,         # عدد اللي AI نجح فيهم (source='live_ai')
                "failed": int,          # عدد اللي AI فشل فيهم (source='hot_stock')
                "skipped": int,         # عدد اللي اتـskipوا (مفيش indicators)
                "signals": List[dict],  # اللي اتخزّنوا
            }
        """
        self._ensure_schema()

        logger.info("=" * 60)
        logger.info("⚡ بدء Live AI Monitor — market=%s, max=%d", market, max_stocks)
        logger.info("=" * 60)

        # --- 1) Lazy-load HotStocksDetector ---
        try:
            detector = self._get_detector()
        except Exception as e:
            logger.error("ما قدرناش نحمّل HotStocksDetector: %s", e)
            return {
                "analyzed": 0, "success_count": 0, "failed": 0, "skipped": 0,
                "signals": [],
            }

        # --- 2) كشف الأسهم الساخنة ---
        try:
            hot = detector.detect_hot_stocks(
                market, min_change_pct=HOT_MIN_CHANGE_PCT
            )
        except Exception as e:
            logger.error("فشل detect_hot_stocks: %s", e)
            return {
                "analyzed": 0, "success_count": 0, "failed": 0, "skipped": 0,
                "signals": [],
            }

        if not hot:
            logger.info("مفيش أسهم ساخنة في %s — نخرج", market)
            return {
                "analyzed": 0, "success_count": 0, "failed": 0, "skipped": 0,
                "signals": [],
            }

        logger.info("🔍 %d سهم ساخن اتكشف في %s", len(hot), market)

        # --- 3) Sort by volume_ratio desc + take top N ---
        hot_sorted = sorted(
            hot, key=lambda s: s.get("volume_ratio", 0), reverse=True
        )
        top_stocks = hot_sorted[:max_stocks]
        logger.info(
            "📋 هنحلل أعلى %d سهم (sorted by volume_ratio desc)",
            len(top_stocks),
        )

        # --- 4) Lazy-load AI agent + pre-check availability ---
        agent = None
        try:
            agent = self._get_agent()
        except Exception as e:
            logger.error("ما قدرناش نحمّل GLMFinanceAgent: %s", e)
            # هنكمّل بدون AI — نخزّن الـ hot stocks بدون تحليل

        ai_available = False
        if agent is not None:
            try:
                ai_available = agent.is_available()
            except Exception as e:
                logger.warning("فشل فحص Ollama: %s", e)
                ai_available = False

        if ai_available:
            logger.info("✅ Ollama متاح — هيتم تحليل الأسهم بالـ AI")
        else:
            logger.warning(
                "⚠️ Ollama مش متاح — هنخزّن الـ hot stocks بدون تحليل AI"
            )

        # --- 5) حلقة التحليل ---
        signals: List[dict] = []
        success = 0
        failed = 0
        skipped = 0

        for i, stock in enumerate(top_stocks, 1):
            ticker = stock.get("ticker") or ""
            if not ticker:
                continue
            detected_at = datetime.now().isoformat()

            logger.info(
                "[%d/%d] %s (chg=%+.2f%% / vol=%.2fx / RSI=%.1f)",
                i, len(top_stocks), ticker,
                float(stock.get("change_pct", 0) or 0),
                float(stock.get("volume_ratio", 0) or 0),
                float(stock.get("rsi", 0) or 0),
            )

            # --- Step a: indicators = agent._fetch_indicators(ticker) ---
            indicators: Optional[dict] = None
            if ai_available and agent is not None:
                try:
                    indicators = agent._fetch_indicators(ticker)
                except Exception as e:
                    logger.debug(
                        "_fetch_indicators فشل لـ %s: %s", ticker, e
                    )
                    indicators = None

            # --- Step b: لو مفيش indicators (و AI متاح) → skip ---
            # لو AI مش متاح أصلاً، نكمّل ونخزّن من غير indicators من _fetch_indicators
            if ai_available and indicators is None:
                logger.info(
                    "⏭️  مفيش indicators لـ %s → skip", ticker
                )
                skipped += 1
                continue

            # --- Merge: hot stock data (base/live) + _fetch_indicators (enrich) ---
            # الـ hot stock data يفضل (live)، بس نضيف fields جديدة من _fetch_indicators
            merged: Dict[str, Any] = dict(stock)
            if indicators:
                for k, v in indicators.items():
                    if k not in merged or merged.get(k) in (None, "", 0):
                        merged[k] = v

            # لو مفيش recommendation في أي مصدر → "HOT" (مؤشر على أنه hot stock)
            if not merged.get("recommendation") and not merged.get("signal"):
                merged["recommendation"] = "HOT"

            # --- Steps c-f: AI analysis (تتعمل جوّاز analyze_hot_stock) ---
            if ai_available:
                decision = self.analyze_hot_stock(ticker, merged)
            else:
                decision = {}  # AI مش متاح — هنخزّن بدون تحليل

            # --- Step g: تخزين في live_ai_signals ---
            if decision and "decision" in decision:
                source = "live_ai"
                row = {
                    "ticker": ticker,
                    "decision": str(decision.get("decision", "HOLD"))[:20],
                    "confidence": _safe_int(decision.get("confidence"), 50),
                    "reason": (decision.get("reason") or "")[:500],
                    "narrative": (decision.get("narrative") or "")[:1000],
                    "source": source,
                    "indicators_json": _safe_json(merged),
                    "detected_at": detected_at,
                }
                success += 1
                logger.info(
                    "  ✅ stored: decision=%s conf=%s",
                    row["decision"], row["confidence"],
                )
            else:
                # AI فشل أو مش متاح → نخزّن الـ hot stock بدون تحليل
                source = "hot_stock"
                row = {
                    "ticker": ticker,
                    "decision": None,
                    "confidence": None,
                    "reason": (stock.get("reason") or "")[:500],
                    "narrative": None,
                    "source": source,
                    "indicators_json": _safe_json(merged),
                    "detected_at": detected_at,
                }
                failed += 1
                logger.info("  📝 stored (بدون تحليل AI): source=hot_stock")

            self._store_signal(row)
            signals.append(row)

        # --- 6) Summary ---
        logger.info("=" * 60)
        logger.info("📊 النتائج:")
        logger.info("  ✅ AI نجح            : %d", success)
        logger.info("  📝 AI فشل/غير متاح : %d", failed)
        logger.info("  ⏭️  skip (no indic.): %d", skipped)
        logger.info("  📋 إجمالي متخزّن    : %d", len(signals))
        logger.info("=" * 60)

        return {
            "analyzed": len(signals),
            "success_count": success,
            "failed": failed,
            "skipped": skipped,
            "signals": signals,
        }

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------

    def _store_signal(self, row: dict) -> bool:
        """تخزين signal واحد في live_ai_signals table."""
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=True)
            conn.execute("""
                INSERT INTO live_ai_signals
                    (ticker, decision, confidence, reason, narrative,
                     source, indicators_json, detected_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row.get("ticker"),
                row.get("decision"),
                row.get("confidence"),
                row.get("reason"),
                row.get("narrative"),
                row.get("source"),
                row.get("indicators_json"),
                row.get("detected_at"),
            ))
            conn.commit()
            conn.close()
            return True
        except sqlite3.Error as e:
            logger.error(
                "فشل تخزين signal لـ %s: %s", row.get("ticker"), e
            )
            return False

    # ------------------------------------------------------------------
    # get_live_signals
    # ------------------------------------------------------------------

    def get_live_signals(self, market: str = "EGX", hours: int = 4) -> List[dict]:
        """
        جلب آخر الإشارات اللي AI عملها في آخر N ساعة.

        Args:
            market: السوق (للـ future filtering — حالياً بيجرّب كل tickers
                    لأن الـ table ما عندهاش column market؛ الـ filter بيتم
                    عبر الـ tickers اللي الـ HotStocksDetector لقاها).
            hours: عدد الساعات للنظر للوراء (default 4)

        Returns:
            List of dicts (الأحدث أولاً) — كل dict فيه:
              {id, ticker, decision, confidence, reason, narrative,
               source, indicators_json, detected_at, created_at}
        """
        self._ensure_schema()
        try:
            cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT * FROM live_ai_signals
                   WHERE detected_at >= ?
                   ORDER BY detected_at DESC
                   LIMIT 200""",
                (cutoff,),
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except sqlite3.Error as e:
            logger.error("فشل get_live_signals: %s", e)
            return []


# ============================================================================
# Helpers
# ============================================================================

def _safe_int(val: Any, default: int = 50) -> int:
    """تحويل آمن لـ int (لو val مش رقم، نرجّع default)."""
    try:
        if val is None:
            return default
        return int(float(val))
    except (TypeError, ValueError):
        return default


def _safe_json(obj: Any, max_chars: int = 4000) -> str:
    """JSON dump آمن + truncate لعشان ما يطولش الـ DB."""
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
        return s[:max_chars]
    except Exception:
        return ""


# ============================================================================
# main() للـ self-test
# ============================================================================

def main() -> None:
    """self-test — يشغّل scan_and_analyze(market='EGX', max_stocks=5)."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    print(f"\n{'=' * 70}")
    print("⚡ Live AI Monitor — Self Test")
    print(f"{'=' * 70}")
    print(f"  PREDICTIONS_DB : {PREDICTIONS_DB}")
    print(f"  AI_TIMEOUT_SEC : {AI_TIMEOUT_SEC}s")
    print(f"  AI_MAX_TOKENS  : {AI_MAX_TOKENS}")
    print(f"  AI_RAG_LIMIT   : {AI_RAG_LIMIT}")

    monitor = LiveAIMonitor()
    summary = monitor.scan_and_analyze(market="EGX", max_stocks=5)

    print(f"\n{'=' * 70}")
    print("📊 Summary:")
    print(f"  analyzed : {summary.get('analyzed', 0)}")
    print(f"  success  : {summary.get('success', 0)}")
    print(f"  failed   : {summary.get('failed', 0)}")
    print(f"  skipped  : {summary.get('skipped', 0)}")
    print(f"  signals  : {len(summary.get('signals', []))}")

    # اطبع آخر 4 ساعات إشارات من الـ DB
    print(f"\n--- آخر 4 ساعات من live_ai_signals ---")
    recent = monitor.get_live_signals(market="EGX", hours=4)
    print(f"  Found: {len(recent)} signal(s)")
    for s in recent[:10]:
        print(
            f"  • {s.get('ticker', '?'):<8} | "
            f"{str(s.get('decision') or '-'):>6} | "
            f"conf={s.get('confidence') if s.get('confidence') is not None else '-':>3} | "
            f"src={s.get('source', '-'):<10} | "
            f"detected={str(s.get('detected_at', ''))[:19]}"
        )

    print(f"\n{'=' * 70}\n")


if __name__ == "__main__":
    main()
