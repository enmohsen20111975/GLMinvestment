#!/usr/bin/env python3
"""
Continuous Learning — نظام التحديث المستمر (Relative Paths)
===========================================================
يُشغَّل أسبوعياً لجمع أمثلة جديدة من نتائج فعلية مؤكدة (wins + losses)
ويضيفها لـ training_data.jsonl لإعادة التدريب لاحقاً.

PHASE-A3 (أغسطس 2026): إصلاح حرج — التعلم من النتائج الفعلية مش من الـ score.
الكود القديم كان بيختار أمثلة بـ `maestro_score >= 75` بدون فحص النتيجة →
بيعلّم الـ AI إن \"سكور عالي = صح\" حتى لو خسرت. دلوقتي بنختار التوقعات
اللي اتأكدت نتيجتها (outcome_date IS NOT NULL) ونسمّيها win/loss.
"""
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

AI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AI_DIR.parents[1]  # يصعد خطوتين لـ GLMinvestment root

PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
TRAINING_FILE  = Path(__file__).parent / "training_data.jsonl"

SYSTEM_PROMPT = """أنت "جيم" — مستشار مالي متخصص في البورصة المصرية والسعودية.
تحلل البيانات وتعطي توصيات واضحة بالعربية."""

def ensure_learning_table():
    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ai_training_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker        TEXT,
            analysis_date TEXT,
            outcome       TEXT,
            added_at      TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()

def collect_verified_examples(limit: int = 100) -> list:
    """
    PHASE-A3 (أغسطس 2026): إصلاح حرج — التعلم من النتائج الفعلية مش من الـ score.

    الكود القديم كان بيختار أمثلة بـ `maestro_score >= 75` بدون فحص هل التوقع
    ربح ولا خسر → بيعلّم الـ AI إن "سكور عالي = صح" حتى لو خسرت الفلوس.
    ده مش closed-loop learning — ده تكرار للتحيز الموجود.

    الإصلاح: نختار التوقعات اللي اتأكدت نتيجتها (outcome_date IS NOT NULL)
    من جدول `predictions`، ونربطها بـ `stored_analyses` للحصول على سياق التحليل.
    نسمّي كل مثال بـ 'win' (hit_target=1) أو 'loss' (hit_stop=1) → الـ AI
    يتعلم الفرق بين تحليل قاد ربح وتحليل قاد خسارة.
    """
    conn = sqlite3.connect(PREDICTIONS_DB)
    # ربط predictions (لها نتيجة مؤكدة) مع stored_analyses (سياق التحليل)
    # عبر ticker + تقارب التاريخ (±2 يوم)
    rows = conn.execute("""
        SELECT p.id, p.ticker, p.signal, p.entry_price, p.target_price,
               p.stop_loss, p.outcome_date, p.actual_return,
               p.hit_target, p.hit_stop, p.prediction_date,
               p.maestro_score, p.persona,
               sa.analysis_json, sa.recommendation, sa.updated_at
        FROM predictions p
        LEFT JOIN stored_analyses sa
          ON sa.ticker = p.ticker
         AND date(sa.updated_at) >= date(p.prediction_date, '-2 days')
         AND date(sa.updated_at) <= date(p.prediction_date, '+2 days')
        WHERE p.outcome_date IS NOT NULL
          AND (p.hit_target = 1 OR p.hit_stop = 1)
          AND p.ticker NOT IN (
              SELECT ticker FROM ai_training_log
              WHERE analysis_date = p.prediction_date
                AND outcome = CASE WHEN p.hit_target = 1 THEN 'win' ELSE 'loss' END
          )
        ORDER BY p.outcome_date DESC
        LIMIT ?
    """, (limit,)).fetchall()
    conn.close()

    new_examples = []
    for (pid, ticker, signal, entry_price, target_price, stop_loss,
         outcome_date, actual_return, hit_target, hit_stop, pred_date,
         score, persona, json_str, rec, updated_at) in rows:

        try:
            data = json.loads(json_str) if json_str else {}
            gambler  = data.get("gambler", {})
            investor = data.get("investor", {})
            narrative = data.get("narrative", "")

            rec_arabic = {
                "strong_buy": "شراء قوي", "buy": "شراء",
                "hold": "انتظار", "sell": "بيع", "strong_sell": "بيع قوي",
            }.get(rec or signal, rec or signal or "N/A")

            # تسمية النتيجة الفعلية
            if hit_target == 1:
                outcome_label = "win"
                outcome_ar = "✅ نجح — وصل الهدف"
            else:
                outcome_label = "loss"
                outcome_ar = "❌ خسر — وصل الوقف"

            example = {
                "system": SYSTEM_PROMPT,
                "instruction": f"حلّل السهم {ticker} وأعطِ توصية استثمارية مُحدَّثة.",
                "input": (
                    f"السهم: {ticker}\n"
                    f"Maestro Score: {score or 'N/A'}/100\n"
                    f"التوصية الأصلية: {rec_arabic}\n"
                    f"سعر الدخول: {entry_price}\n"
                    f"الهدف: {target_price}\n"
                    f"الوقف: {stop_loss}\n"
                    f"Persona: {persona or 'N/A'}\n"
                    f"RSI: {gambler.get('rsi', 'N/A')}\n"
                    f"MACD: {gambler.get('macd', 'N/A')}\n"
                    f"P/E: {investor.get('pe_ratio', 'N/A')}\n"
                    f"تاريخ التحليل: {pred_date}\n"
                    f"تاريخ النتيجة: {outcome_date}\n"
                    f"العائد الفعلي: {actual_return}%"
                ),
                "output": (
                    f"النتيجة الفعلية: {outcome_ar}\n"
                    f"التوصية الأصلية كانت: {rec_arabic} (Score: {score or 'N/A'}/100)\n"
                    f"العائد المحقق: {actual_return}%\n"
                    f"{narrative[:300] if narrative else 'تحليل تقني قوي يدعم هذه التوصية.'}\n"
                    f"— هذا مثال {'ناجح' if hit_target == 1 else 'خاسر'} للتعلم منه."
                ),
                "outcome": outcome_label,
                "actual_return": actual_return,
            }
            new_examples.append((ticker, pred_date, outcome_label, example))
        except Exception as e:
            logger.debug(f"Skipping {ticker} {pred_date}: {e}")
            pass

    return new_examples

def append_to_training_file(examples: list) -> int:
    if not examples:
        return 0
    conn = sqlite3.connect(PREDICTIONS_DB)
    added = 0
    with open(TRAINING_FILE, "a", encoding="utf-8") as f:
        for ticker, analysis_date, outcome, example in examples:
            f.write(json.dumps(example, ensure_ascii=False) + "\n")
            conn.execute("""
                INSERT INTO ai_training_log (ticker, analysis_date, outcome)
                VALUES (?, ?, ?)
            """, (ticker, analysis_date, outcome))
            added += 1
    conn.commit()
    conn.close()
    return added

def show_dataset_stats():
    if not TRAINING_FILE.exists():
        return
    with open(TRAINING_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()
    logger.info(f"  📊 إجمالي الأمثلة في ملف التدريب: {len(lines)}")
    # إحصائية win/loss
    wins = losses = 0
    for line in lines:
        try:
            ex = json.loads(line)
            if ex.get("outcome") == "win":
                wins += 1
            elif ex.get("outcome") == "loss":
                losses += 1
        except Exception:
            pass
    logger.info(f"  ✅ Wins: {wins} | ❌ Losses: {losses}")

def run_continuous_learning():
    logger.info(f"🔄 بدء التحديث المستمر...")
    ensure_learning_table()
    new_examples = collect_verified_examples(limit=100)
    if not new_examples:
        logger.info("  ✅ لا توجد أمثلة جديدة مؤكدة هذا الأسبوع")
        return
    added = append_to_training_file(new_examples)
    logger.info(f"  ✅ تمت إضافة {added} مثال للـ training data (من نتائج فعلية مؤكدة)")
    show_dataset_stats()

if __name__ == '__main__':
    run_continuous_learning()
