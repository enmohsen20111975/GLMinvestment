#!/usr/bin/env python3
"""
Nightly AI Analysis — التحليل الليلي بالذكاء الاصطناعي
=====================================================
يعمل 2:00 AM بعد إغلاق السوق:

Pipeline:
1. يجيب الأسهم اللي MaestroOrchestrator حللها (cached_analysis)
2. يفلتر: score > 50 + فيه حركة (change > ±2% أو volume_ratio > 1.5x)
3. لكل سهم (20-30 سهم):
   a. يجيب بيانات Maestro (score, signal, target, stop, indicators)
   b. يدور على حالات مشابهة (RAG من stock_stories)
   c. يبني prompt ذكي
   d. يشغل AI (Ollama → LM Studio → Fallback)
   e. يخزن: ai_narrative + ai_confidence_adjustment
4. النتيجة: المستخدم يلاقي تحليل AI جاهز الصباح

Author: M2Y Team
Version: 2.0 - Pipeline redesign
"""

import json
import logging
import sqlite3
import time
from datetime import datetime
from pathlib import Path
import sys

# Setup paths
_AI_DIR = Path(__file__).resolve().parent
_VPS_DIR = _AI_DIR.parent
_PROJECT_ROOT = _VPS_DIR.parent
sys.path.insert(0, str(_VPS_DIR))

from ai.glm_finance_agent import GLMFinanceAgent
from ai.decision_engine import DecisionEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

PREDICTIONS_DB = str(_PROJECT_ROOT / "db" / "predictions.db")
STOCKS_DB = str(_PROJECT_ROOT / "db" / "stocks.db")

DELAY_SEC = 0.5
MAX_STOCKS = 30  # مش 260 — بس اللي يستاهل


def ensure_ai_columns():
    """Ensure stored_analyses has AI columns"""
    conn = sqlite3.connect(PREDICTIONS_DB)
    columns = [
        ("ai_decision", "TEXT"),
        ("ai_confidence", "INTEGER"),
        ("ai_reason", "TEXT"),
        ("ai_narrative", "TEXT"),
        ("ai_confidence_adjustment", "INTEGER"),
        ("ai_raw", "TEXT"),
        ("ai_updated_at", "TEXT"),
    ]
    for col, col_type in columns:
        try:
            conn.execute(f"ALTER TABLE stored_analyses ADD COLUMN {col} {col_type}")
            conn.commit()
        except Exception:
            pass
    conn.close()


def get_candidates() -> list:
    """
    فلتر الأسهم: مش 260 سهم — 20-30 سهم بس
    
    معايير الفلتر:
    1. Maestro Score > 50 (مش EXCLUDED)
    2. فيه حركة: change > ±2% أو volume_ratio > 1.5x
    3. سعر > 1 EGP (مش penny)
    """
    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Get stocks from cached_analysis with score > 50
    rows = cur.execute("""
        SELECT ca.ticker, ca.signal, ca.master_score, ca.target_price, ca.stop_loss,
               ca.current_price, ca.confidence, ca.technical_score, ca.fundamental_score,
               s.change_percent, s.volume, s.rsi, s.sector, s.name_ar, s.name
        FROM cached_analysis ca
        INNER JOIN stocks s ON s.ticker = ca.ticker
        WHERE ca.master_score > 50
          AND s.current_price > 1
          AND s.is_active = 1
        ORDER BY ca.master_score DESC
        LIMIT 100
    """).fetchall()

    candidates = []
    for r in rows:
        change = _safe_float(r['change_percent'], 0)
        # Get volume ratio from cached_analysis or stock_daily_prices
        volume_ratio = 1.0
        try:
            vol_row = cur.execute("""
                SELECT volume FROM stock_daily_prices
                WHERE ticker = ? AND volume > 0
                ORDER BY price_date DESC LIMIT 2
            """, (r['ticker'],)).fetchall()
            if len(vol_row) >= 2:
                latest_vol = _safe_float(vol_row[0]['volume'], 0)
                prev_vol = _safe_float(vol_row[1]['volume'], 1)
                if prev_vol and prev_vol > 0:
                    volume_ratio = latest_vol / prev_vol
        except:
            pass

        # Filter: must have movement (change > ±2% OR volume_ratio > 1.5x)
        if abs(change) >= 2.0 or volume_ratio >= 1.5:
            candidates.append({
                'ticker': r['ticker'],
                'name': r['name_ar'] or r['name'] or r['ticker'],
                'signal': r['signal'],
                'score': _safe_float(r['master_score'], 0),
                'target': _safe_float(r['target_price'], 0),
                'stop': _safe_float(r['stop_loss'], 0),
                'price': _safe_float(r['current_price'], 0),
                'confidence': _safe_float(r['confidence'], 0),
                'tech_score': _safe_float(r['technical_score'], 50),
                'fund_score': _safe_float(r['fundamental_score'], 50),
                'change_pct': change,
                'volume_ratio': round(volume_ratio, 2),
                'rsi': _safe_float(r['rsi'], 50),
                'sector': r['sector'] or '',
            })

        if len(candidates) >= MAX_STOCKS:
            break

    conn.close()
    return candidates


def _safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        import re
        s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').strip()
        m = re.match(r'^([+-]?\d+\.?\d*)', s)
        return float(m.group(1)) if m else default
    except:
        return default


def build_prompt(stock: dict, similar_cases: list) -> str:
    """بناء Prompt ذكي بلهجة المحلل الصايع"""
    
    # Similar cases section
    cases_text = ""
    if similar_cases:
        for i, case in enumerate(similar_cases[:3], 1):
            cases_text += f"\n{i}. {case.get('ticker', '?')}: {case.get('story_text', '')[:100]} → النتيجة: {case.get('outcome_pct', 0):+.1f}%"
    else:
        cases_text = "\n(لا توجد حالات مشابهة كافية)"

    prompt = f"""أنت محلل بورصة مصري محنك. اقرأ البيانات واكتب رأيك باختصار.

السهم: {stock['ticker']} ({stock['name']})
السعر: {stock['price']} ({stock['change_pct']:+.1f}%)
التوصية الداخلية: {stock['signal']} (Score: {stock['score']}, ثقة: {stock['confidence']}%)

المؤشرات:
- RSI: {stock['rsi']}
- الحجم: {stock['volume_ratio']}x المتوسط
- تقني: {stock['tech_score']}/100 | أساسي: {stock['fund_score']}/100
- الهدف: {stock['target']} | الوقف: {stock['stop']}

حالات مشابهة من التاريخ:{cases_text}

اكتب JSON بهذا الشكل بالضبط:
{{
  "decision": "BUY أو SELL أو HOLD",
  "confidence": رقم من 0 لـ 100,
  "reason": "رأيك في 2-3 سطور بالعربي - ليه القرار صح أو غلط",
  "narrative": "شرح بالمحلل الصايع - اذكر الدعم/المقاومة/الحجم",
  "confidence_adjustment": رقم من -20 لـ +20 (تعديل على ثقة Maestro)
}}

اكتب JSON فقط، بدون كلام إضافي."""

    return prompt


def fallback_narrative(stock: dict) -> dict:
    """Fallback لو AI مش متاح - يولد narrative داخلي"""
    signal = stock['signal']
    score = stock['score']
    rsi = stock['rsi']
    vol = stock['volume_ratio']
    change = stock['change_pct']

    narrative_parts = []
    
    if 'BUY' in signal.upper() or 'STRONG_BUY' in signal.upper():
        narrative_parts.append(f"السهم {stock['ticker']} عنده زخم إيجابي (Score: {score})")
        if rsi < 30:
            narrative_parts.append(f"RSI منخفض ({rsi}) = تشبع بيعي = فرصة ارتداد")
        elif rsi > 70:
            narrative_parts.append(f"RSI مرتفع ({rsi}) = تشبع شرائي = حذر")
        if vol > 2:
            narrative_parts.append(f"الحجم {vol}x المتوسط = اهتمام قوي من المستثمرين")
        if change > 5:
            narrative_parts.append(f"طلع {change:+.1f}% اليوم = حركة قوية")
    elif 'SELL' in signal.upper():
        narrative_parts.append(f"السهم {stock['ticker']} عنده ضغط بيعي (Score: {score})")
        if rsi > 70:
            narrative_parts.append(f"RSI مرتفع ({rsi}) = وقت التصريف")
        if change < -3:
            narrative_parts.append(f"نزل {change:.1f}% اليوم = ضغط بيعي قوي")
    else:
        narrative_parts.append(f"السهم {stock['ticker']} متعادل (Score: {score}) — ينتقل كسر واضح")

    narrative = ". ".join(narrative_parts) + "."
    
    return {
        "decision": signal,
        "confidence": int(stock['confidence']),
        "reason": narrative[:200],
        "narrative": narrative,
        "confidence_adjustment": 0,
        "source": "fallback_internal"
    }


def save_ai_result(ticker: str, result: dict, raw: str = ""):
    """حفظ نتيجة AI في stored_analyses.

    # SINGLE-WRITER (Task PHASE-3, Rule 73) — DISABLED. daily_predictor.py is the
    # canonical writer. This function now logs a skip and returns without touching
    # stored_analyses. Set SKIP_STORED_ANALYSES_WRITE = False to re-enable.
    """
    # SINGLE-WRITER (Task PHASE-3, Rule 73)
    # Only daily_predictor.py is allowed to write to stored_analyses.
    # This writer is disabled to prevent conflicting decisions (last-writer-wins).
    SKIP_STORED_ANALYSES_WRITE = True
    if SKIP_STORED_ANALYSES_WRITE:
        logger.info('[SINGLE-WRITER] Skipping stored_analyses write in nightly_analysis.save_ai_result — use daily_predictor.py')
        return
    conn = sqlite3.connect(PREDICTIONS_DB)
    try:
        # Check if ticker exists
        exists = conn.execute("SELECT ticker FROM stored_analyses WHERE ticker = ?", (ticker,)).fetchone()
        
        if exists:
            conn.execute("""
                UPDATE stored_analyses SET
                    ai_decision = ?,
                    ai_confidence = ?,
                    ai_reason = ?,
                    ai_narrative = ?,
                    ai_confidence_adjustment = ?,
                    ai_raw = ?,
                    ai_updated_at = datetime('now')
                WHERE ticker = ?
            """, (
                result.get("decision", "HOLD"),
                int(result.get("confidence", 50)),
                result.get("reason", "")[:500],
                result.get("narrative", "")[:1000],
                int(result.get("confidence_adjustment", 0)),
                raw[:2000],
                ticker
            ))
        else:
            conn.execute("""
                INSERT INTO stored_analyses
                    (ticker, ai_decision, ai_confidence, ai_reason, ai_narrative,
                     ai_confidence_adjustment, ai_raw, ai_updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (
                ticker,
                result.get("decision", "HOLD"),
                int(result.get("confidence", 50)),
                result.get("reason", "")[:500],
                result.get("narrative", "")[:1000],
                int(result.get("confidence_adjustment", 0)),
                raw[:2000],
            ))
        conn.commit()
    except Exception as e:
        logger.error(f"Error saving AI result for {ticker}: {e}")
    finally:
        conn.close()


def run_nightly_analysis():
    """الpipeline الرئيسي - يعمل 2:00 AM"""
    logger.info("=" * 60)
    logger.info("🌙 بدء التحليل الليلي AI Pipeline")
    logger.info("=" * 60)

    ensure_ai_columns()

    # Step 1: Get candidates (20-30 stocks)
    candidates = get_candidates()
    logger.info(f"📋 Phase 1: {len(candidates)} سهم مرشح للتحليل")

    if not candidates:
        logger.info("لا توجد أسهم تستحق تحليل AI الليلة")
        return

    # Step 2: Initialize AI
    agent = GLMFinanceAgent(timeout=45)
    ai_available = agent.is_available()
    if ai_available:
        logger.info("✅ Ollama متاح — سيتم استخدام AI")
    else:
        logger.warning("⚠️ Ollama غير متاح — سيتم استخدام Fallback الداخلي")

    db_engine = DecisionEngine()

    # Step 3: Analyze each stock
    success = 0
    fallback = 0
    errors = 0

    for i, stock in enumerate(candidates, 1):
        ticker = stock['ticker']
        logger.info(f"[{i}/{len(candidates)}] {ticker} (score={stock['score']}, signal={stock['signal']})")

        try:
            if ai_available:
                # RAG: Find similar stories
                similar = db_engine.find_similar_stories(
                    ticker=ticker,
                    current_rsi=stock['rsi'],
                    current_recommendation=stock['signal'],
                    limit=3
                )

                # Build prompt
                prompt = build_prompt(stock, similar)

                # Call AI
                # QWEN-UNIFY: call_fast = الموديل الموحّد من env (glm-fast default).
                raw = agent.call_fast(prompt, max_tokens=400, temperature=0.3)
                result = agent._parse_json_response(raw)

                if "decision" in result:
                    result["source"] = "ollama"
                    save_ai_result(ticker, result, raw)
                    logger.info(f"  ✅ AI: {result.get('decision')} | adj: {result.get('confidence_adjustment', 0):+d}")
                    success += 1
                else:
                    # Parse failed — use fallback
                    fb = fallback_narrative(stock)
                    save_ai_result(ticker, fb, raw)
                    logger.warning(f"  ⚠️ AI parse failed — fallback used")
                    fallback += 1
            else:
                # AI not available — use fallback
                fb = fallback_narrative(stock)
                save_ai_result(ticker, fb, "")
                logger.info(f"  📝 Fallback: {fb['decision']}")
                fallback += 1

        except Exception as e:
            logger.error(f"  ❌ Error: {e}")
            errors += 1

        time.sleep(DELAY_SEC)

    # Summary
    logger.info("=" * 60)
    logger.info(f"📊 النتائج:")
    logger.info(f"  ✅ AI نجح: {success}")
    logger.info(f"  📝 Fallback: {fallback}")
    logger.info(f"  ❌ أخطاء: {errors}")
    logger.info(f"  📋 إجمالي: {len(candidates)}")
    logger.info("=" * 60)


if __name__ == '__main__':
    run_nightly_analysis()
