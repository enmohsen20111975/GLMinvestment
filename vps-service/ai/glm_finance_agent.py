#!/usr/bin/env python3
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional

# Lazy import لـ httpx — لو مش متثبّت، الباقي يفضل شغّال و AI بس يتعطّل
try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    httpx = None
    _HTTPX_AVAILABLE = False

logger = logging.getLogger(__name__)

# ============================================================================
# GLM-FAST-UNIFY: مصدر موحّد لإعدادات Ollama — كل القراءة من env في مكان واحد.
# ----------------------------------------------------------------------------
# البروتوكول الرسمي (قرار المالك — نهائي):
#   • الموديل الرسمي = glm-fast:latest (مبني من qwen2.5:1.5b — موجود على VPS).
#   • أقصى استخدام للـ AI المحلي: قرار + ثقة + شرح + ملخصات + مراقبة.
#   • ممنوع تنزيل موديلات جديدة — استخدم الموجود فقط.
#   • ممنوع استخدام qwen3:1.7b كافتراضي (أثقل — احتياطي فقط).
#   • كل الـ callers لازم تستخدم agent.call_fast() / agent.call_deep() (ممنوع hardcoded).
#   • الأرقام (سعر/هدف/وقف/Score) من المحركات الرقمية فقط — الـ AI يشرح ويرجّح.
# ============================================================================
# قراءة الـ base URL بأولوية OLLAMA_BASE_URL ثم OLLAMA_URL (legacy) ل التوافق مع البروتوكول.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL") or os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_GENERATE = f"{OLLAMA_BASE_URL}/api/generate"

# الموديلات (تُقرأ من env مع fallback آمن لـ glm-fast:latest — القيمة الموثّقة على الـ VPS)
# ملاحظة: qwen3:1.7b متاح كاحتياطي عبر OLLAMA_DEEP_MODEL لكنه ليس الافتراضي (أثقل).
FAST_MODEL = os.environ.get("OLLAMA_MODEL") or os.environ.get("LOCAL_AI_MODEL") or "glm-fast:latest"
DEEP_MODEL = os.environ.get("OLLAMA_DEEP_MODEL") or FAST_MODEL   # افتراضياً = نفس الموديل السريع

# ============================================================================
# SYSTEM PROMPT الإلزامي — يُمرّر في كل استدعاء AI (حماية مزدوجة مع Modelfile.qwen).
# صارم ضد الهلوسة الرقمية: لا تغيّر/تختلق سعر/هدف/وقف/نسبة/Score.
# ============================================================================
DEFAULT_SYSTEM_PROMPT = (
    "أنت محلل أسواق مالية محلي لمنصة استثمار تركز على البورصة المصرية والأسواق العربية.\n\n"
    "قواعد صارمة:\n"
    "1) لا تغيّر أي رقم يُمرّر إليك (سعر الدخول، الهدف، وقف الخسارة، النسبة، الـ Score، R:R).\n"
    "2) لا تختلق أسعارًا أو نسبًا أو بيانات غير موجودة في المدخلات.\n"
    "3) إذا نقصت بيانات مهمة، قل صراحة: «التحليل غير مكتمل» ولا تكمل بأرقام من عندك.\n"
    "4) اعتمد فقط على المؤشرات والسياق الممرَّر في الرسالة.\n"
    "5) الأرقام والحسابات صادرة من محركات رقمية؛ دورك: تفسير، ترجيح، وصياغة قرار واضح.\n"
    "6) اكتب بالعربية الفصحى البسيطة والواضحة، باختصار ومن دون حشو.\n"
    "7) لا تقدم ضمان ربح. اذكر أن الاستثمار ينطوي على مخاطر."
)

# حساب المسارات ديناميكياً لتناسب أي جهاز (سيرفر أو لابتوب)
AI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AI_DIR.parents[1]  # يصعد خطوتين ليصل لـ GLMinvestment root

PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
STOCKS_DB      = str(PROJECT_ROOT / "db" / "stocks.db")

class GLMFinanceAgent:
    def __init__(self, timeout: int = 90, system_prompt: str = None):
        self.timeout = timeout
        # GLM-FAST-UNIFY: الموديلات تُقرأ من env عند إنشاء الـ agent (مش module-level فقط)
        # عشان أي تغيير in env يشتغل من غير restart. أولوية:
        #   OLLAMA_MODEL → LOCAL_AI_MODEL (legacy) → glm-fast:latest (default).
        self.fast_model = (
            os.environ.get("OLLAMA_MODEL")
            or os.environ.get("LOCAL_AI_MODEL")
            or FAST_MODEL
        )
        self.deep_model = os.environ.get("OLLAMA_DEEP_MODEL") or self.fast_model
        # SYSTEM prompt الإلزامي لكل استدعاء (anti-hallucination).
        self.system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        if not _HTTPX_AVAILABLE:
            logger.warning(
                "⚠️ httpx غير متثبّت — طبقة AI معطّلة. ثبّته: pip install httpx"
            )
            self._ollama_ok = False
        else:
            self._ollama_ok = self._check_ollama()

    def _check_ollama(self) -> bool:
        if not _HTTPX_AVAILABLE:
            return False
        try:
            r = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=10)  # P2 fix: 5s → 10s
            models = [m["name"] for m in r.json().get("models", [])]
            logger.info(f"✅ Ollama متاح — النماذج المثبتة: {models}")
            return True
        except Exception as e:
            logger.warning(f"⚠️ Ollama غير متاح: {e}")
            return False

    def is_available(self) -> bool:
        if not _HTTPX_AVAILABLE:
            return False
        return self._check_ollama()

    def _call_ollama(
        self,
        model: str,
        prompt: str,
        system: str = "",
        max_tokens: int = 400,
        temperature: float = 0.3,
    ) -> str:
        if not _HTTPX_AVAILABLE:
            logger.warning("⚠️ httpx غير متثبّت — لا يمكن استدعاء Ollama.")
            return ""
        try:
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "num_predict": max_tokens,
                    "temperature": temperature,
                    "top_p": 0.9,
                    "num_ctx": 2048,
                },
            }
            resp = httpx.post(OLLAMA_GENERATE, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json().get("response", "").strip()
        except Exception as e:
            logger.error(f"❌ خطأ في Ollama ({model}): {e}")
            return ""

    def _parse_json_response(self, text: str) -> dict:
        text = text.strip()
        if "```" in text:
            parts = text.split("```")
            for part in parts:
                part = part.strip().lstrip("json").strip()
                try:
                    return json.loads(part)
                except Exception:
                    continue
        try:
            start = text.index("{")
            end   = text.rindex("}") + 1
            return json.loads(text[start:end])
        except Exception:
            return {"raw": text, "parse_error": True}

    # ========================================================================
    # GLM-FAST-UNIFY: Methods مساعدة موحّدة — كل الـ callers لازم تستخدم دول.
    # call_fast = الموديل السريع (glm-fast:latest) للشرح/المقارنة/القرار/الإجابة.
    # call_deep = نفس الموديل افتراضياً (قابل للتغيير عبر OLLAMA_DEEP_MODEL).
    # الاتنين بيحققوا الـ anti-hallucination guard عبر DEFAULT_SYSTEM_PROMPT.
    # ========================================================================
    def call_fast(self, prompt: str, system: str = None, max_tokens: int = 400,
                  temperature: float = 0.3) -> str:
        """استدعاء الموديل السريع (glm-fast:latest افتراضياً).
        للشرح والترجيح النصّي والقرار والملخصات. يمرّر DEFAULT_SYSTEM_PROMPT تلقائياً."""
        sys_prompt = system if system is not None else self.system_prompt
        return self._call_ollama(self.fast_model, prompt, system=sys_prompt,
                                 max_tokens=max_tokens, temperature=temperature)

    def call_deep(self, prompt: str, system: str = None, max_tokens: int = 600,
                  temperature: float = 0.4) -> str:
        """استدعاء الموديل الأعمق (افتراضياً = glm-fast:latest، قابل للتغيير عبر env).
        أقصى استخدام للـ AI المحلي — للـ premium predictions والقرارات المعقّدة."""
        sys_prompt = system if system is not None else self.system_prompt
        return self._call_ollama(self.deep_model, prompt, system=sys_prompt,
                                 max_tokens=max_tokens, temperature=temperature)

    def compare_stocks(self, tickers: list[str], indicators_list: list[dict]) -> str:
        stocks_info = "\n".join(
            f"- {t}: Maestro={ind.get('maestro_score','?')}, RSI={ind.get('rsi','?')}, التوصية={ind.get('recommendation','?')}"
            for t, ind in zip(tickers, indicators_list)
        )
        prompt = f"قارن بين هذه الأسهم واختر الأفضل للاستثمار:\n\n{stocks_info}\n\nرتّبها من الأفضل للأضعف مع سبب موجز لكل ترتيب. أجب بالعربية وبلهجة المحلل الصايع."
        return self.call_fast(prompt, max_tokens=400, temperature=0.3)

    def answer_question(self, question: str, context: dict = None) -> str:
        context_str = ""
        if context:
            context_str = f"\nبيانات السوق المتاحة:\n{json.dumps(context, ensure_ascii=False, indent=2)[:600]}\n"
        prompt = f"{context_str}\nسؤال المستخدم: {question}\n\nأجب بوضوح وإيجاز بالعربية وبلهجة المحلل الصايع المخضرم:"
        return self.call_fast(prompt, max_tokens=400, temperature=0.5)

    def _fetch_indicators(self, ticker: str) -> Optional[dict]:
        try:
            conn = sqlite3.connect(PREDICTIONS_DB)
            row = conn.execute("""
                SELECT recommendation, maestro_score, analysis_json
                FROM stored_analyses
                WHERE ticker = ?
                ORDER BY updated_at DESC
                LIMIT 1
            """, (ticker,)).fetchone()
            conn.close()

            if not row:
                return None

            rec, score, json_str = row
            indicators = {"recommendation": rec, "maestro_score": score}

            if json_str:
                data = json.loads(json_str)
                gambler = data.get("gambler", {})
                indicators.update({
                    "rsi":          gambler.get("rsi"),
                    "macd":         gambler.get("macd"),
                    "price":        gambler.get("current_price"),
                    "volume_ratio": gambler.get("volume_ratio"),
                })

            conn2 = sqlite3.connect(STOCKS_DB)
            pe_row = conn2.execute("SELECT pe_ratio FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
            conn2.close()
            if pe_row:
                indicators["pe_ratio"] = pe_row[0]

            return indicators
        except Exception as e:
            logger.error(f"خطأ في جلب بيانات {ticker}: {e}")
            return None
