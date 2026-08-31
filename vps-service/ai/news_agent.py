#!/usr/bin/env python3
"""
news_agent.py — وكيل جلب الأخبار وتحليلها بالذكاء الاصطناعي المحلي
=====================================================================
يستخدم:
  - duckduckgo_search للبحث المجاني
  - trafilatura لاستخلاص النصوص من صفحات الأخبار
  - Ollama (qwen2.5) للتحليل المحلي

الاستخدام:
  from ai.news_agent import NewsAgent
  agent = NewsAgent()
  result = agent.analyze_stock_news("COMI", "Commercial International Bank Egypt")
  # result = {sentiment: "positive"/"negative"/"neutral", score: 0-100, summary: "..."}

التشغيل:
  1. شغل Ollama: ollama serve
  2. اسحب النموذج: ollama pull qwen2.5:1.5b
  3. شغل الـ Agent
"""
import os
import sys
import json
import time
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════
# استيراد آمن (safe imports)
# ═══════════════════════════════════════════════════════════════════

try:
    from ddgs import DDGS
    DDGS_AVAILABLE = True
except ImportError:
    try:
        from duckduckgo_search import DDGS
        DDGS_AVAILABLE = True
    except ImportError:
        DDGS_AVAILABLE = False
        logger.warning("ddgs/duckduckgo_search مش موجود — البحث هيتعطل")

try:
    import trafilatura
    TRAFILATURA_AVAILABLE = True
except ImportError:
    TRAFILATURA_AVAILABLE = False
    logger.warning("trafilatura مش موجود — استخلاص النصوص هيتعطل")

try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    OLLAMA_AVAILABLE = False
    logger.warning("ollama مش موجود — التحليل بالـ AI هيتعطل")


class NewsAgent:
    """وكيل جلب الأخبار وتحليلها بالذكاء الاصطناعي المحلي."""

    def __init__(self, model_name: str = "qwen2.5:1.5b", ollama_host: str = "http://127.0.0.1:11434"):
        self.model_name = model_name
        self.ollama_host = ollama_host
        self.ollama_client = None

        if OLLAMA_AVAILABLE:
            try:
                self.ollama_client = ollama.Client(host=ollama_host)
                # اختبر الاتصال
                self.ollama_client.list()
                logger.info(f"✅ Ollama متصل على {ollama_host}")
            except Exception as e:
                logger.warning(f"⚠️ Ollama مش شغال على {ollama_host}: {e}")
                self.ollama_client = None

    def is_ready(self) -> bool:
        """هل الـ Agent جاهز للعمل؟"""
        return DDGS_AVAILABLE and TRAFILATURA_AVAILABLE and self.ollama_client is not None

    def search_news(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        """ابحث عن الأخبار باستخدام DuckDuckGo.

        Args:
            query: كلمات البحث (مثال: "COMI Egypt stock news")
            max_results: حد أقصى للنتائج

        Returns:
            list of {title, url, snippet}
        """
        if not DDGS_AVAILABLE:
            return []

        results = []
        try:
            with DDGS() as ddgs:
                for r in ddgs.news(query, max_results=max_results):
                    results.append({
                        'title': r.get('title', ''),
                        'url': r.get('url', '') or r.get('link', ''),
                        'snippet': r.get('body', '') or r.get('snippet', ''),
                        'date': r.get('date', ''),
                        'source': r.get('source', ''),
                    })
        except Exception as e:
            logger.warning(f"بحث DuckDuckGo فشل: {e}")

        return results

    def extract_article(self, url: str) -> Optional[str]:
        """استخرج نص المقال من URL باستخدام trafilatura.

        Args:
            url: رابط المقال

        Returns:
            نص المقال (أو None لو فشل)
        """
        if not TRAFILATURA_AVAILABLE:
            return None

        try:
            import urllib.request
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode('utf-8', errors='ignore')

            text = trafilatura.extract(html, include_comments=False, include_tables=False)
            return text if text and len(text) > 50 else None
        except Exception as e:
            logger.debug(f"استخلاص {url} فشل: {e}")
            return None

    def analyze_with_llm(self, ticker: str, company_name: str,
                          news_texts: List[str]) -> Dict[str, Any]:
        """حلل الأخبار باستخدام النموذج المحلي (Ollama).

        Args:
            ticker: رمز السهم (مثال: COMI)
            company_name: اسم الشركة
            news_texts: list of news article texts

        Returns:
            {sentiment, score, summary, confidence}
        """
        if not self.ollama_client:
            return self._keyword_fallback(ticker, news_texts)

        # ادمج النصوص (حد 2000 حرف عشان النموذج الصغير)
        combined = "\n\n---\n\n".join(news_texts[:3])[:2000]

        prompt = f"""أنت محلل مالي محترف. حلل الأخبار التالية للسهم {ticker} ({company_name}):

{combined}

أعطني تحليل في JSON فقط بالشكل:
{{
  "sentiment": "positive" أو "negative" أو "neutral",
  "score": رقم من 0 إلى 100 (50 = محايد، > 50 = إيجابي، < 50 = سلبي),
  "summary": "ملخص قصير بالعربية في سطر واحد",
  "confidence": رقم من 0 إلى 1
}}

JSON:"""

        try:
            response = self.ollama_client.chat(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "أنت محلل مالي خبير. أجب بـ JSON فقط."},
                    {"role": "user", "content": prompt}
                ],
                options={"temperature": 0.1, "num_predict": 200},
            )

            raw = response['message']['content'].strip()

            # استخرج JSON من الرد
            if '{' in raw:
                start = raw.index('{')
                end = raw.rindex('}') + 1
                raw = raw[start:end]

            result = json.loads(raw)
            return {
                'sentiment': result.get('sentiment', 'neutral'),
                'score': int(result.get('score', 50)),
                'summary': result.get('summary', ''),
                'confidence': float(result.get('confidence', 0.5)),
                'source': 'ollama',
            }

        except Exception as e:
            logger.warning(f"تحليل Ollama فشل: {e}")
            return self._keyword_fallback(ticker, news_texts)

    def _keyword_fallback(self, ticker: str, news_texts: List[str]) -> Dict[str, Any]:
        """تحليل بالكلمات المفتاحية — محسّن بقاموس أوسع + أوزان."""
        combined = " ".join(news_texts).lower()

        # قاموس موسّع — كلمات إيجابية (مع وزن لكل كلمة)
        positive_words = {
            # عربي
            'أرباح': 3, 'نمو': 2, 'توسع': 2, 'عقد': 3, 'توزيع': 3, 'زيادة': 2,
            'ارتفاع': 2, 'تحسن': 2, 'نجاح': 2, 'طلب': 1, 'شراكة': 3, 'استحواذ': 3,
            'إيجابي': 2, 'قوي': 1, 'ربحية': 3, 'منتظم': 1, 'تاريخي': 1, 'قمة': 1,
            'طفرة': 3, 'انطلاق': 2, 'طموح': 1, 'فرصة': 2, 'صعود': 2, 'ممتاز': 2,
            'استثنائي': 3, 'تحقيق': 1, 'منح': 2, 'موافقة': 2, 'ترقية': 2, 'توصية': 1,
            'تجميع': 2, 'شراء': 2, 'دعم': 1, 'اختراق': 2, 'مقاومة': 1, 'كسر': 1,
            'سيولة': 1, 'استثمار': 1, 'تطوير': 2, 'مشروع': 2, 'افتتاح': 2, 'إطلاق': 2,
            # إنجليزي
            'profit': 3, 'growth': 2, 'increase': 2, 'rise': 2, 'gain': 2,
            'positive': 2, 'bullish': 3, 'buy': 2, 'upgrade': 3, 'beat': 3,
            'surge': 3, 'soar': 3, 'rally': 2, 'breakout': 3, 'support': 1,
            'acquisition': 3, 'partnership': 3, 'dividend': 3, 'expansion': 2,
            'strong': 2, 'record': 2, 'high': 1, 'award': 3, 'contract': 3,
        }

        # قاموس موسّع — كلمات سلبية (مع وزن لكل كلمة)
        negative_words = {
            # عربي
            'خسارة': 3, 'انخفاض': 2, 'تراجع': 2, 'هبوط': 2, 'ديون': 3, 'مشاكل': 2,
            'تحقيق': 1, 'تخفيض': 2, 'سلبي': 2, 'ضعف': 2, 'بيع': 2, 'خروج': 2,
            'انهيار': 3, 'أزمة': 3, 'تأجيل': 2, 'إلغاء': 3, 'تأخر': 1, 'تعثر': 3,
            'إفلاس': 3, 'تخفيض': 2, 'تصريف': 3, 'فخ': 2, 'وهمي': 2, 'هبوط': 2,
            'نزول': 2, 'انخفاض': 2, 'خسائر': 3, 'مخاطر': 2, 'تحذير': 3, 'مخالفة': 2,
            'غرامة': 3, 'قضية': 2, 'محكمة': 2, 'شكوى': 2, 'توقف': 3, 'إيقاف': 3,
            'تجميد': 3, 'حرج': 2, 'أزمة': 3, 'تخبط': 2, 'فشل': 3, 'تسريح': 2,
            # إنجليزي
            'loss': 3, 'decline': 2, 'drop': 2, 'fall': 2, 'debt': 3,
            'negative': 2, 'bearish': 3, 'sell': 2, 'downgrade': 3, 'miss': 3,
            'crash': 3, 'plunge': 3, 'suspend': 3, 'investigation': 3,
            'lawsuit': 3, 'fraud': 3, 'warning': 2, 'risk': 1, 'weak': 2,
            'concern': 2, 'halt': 3, 'freeze': 3, 'cancel': 3, 'delay': 2,
            'cut': 2, 'reduce': 2, 'close': 1, 'shut': 2, 'fired': 2,
        }

        # احسب النقاط الموزونة
        pos_score = sum(weight for word, weight in positive_words.items() if word in combined)
        neg_score = sum(weight for word, weight in negative_words.items() if word in combined)

        # احسب عدد الكلمات (للـ summary)
        pos_count = sum(1 for word in positive_words if word in combined)
        neg_count = sum(1 for word in negative_words if word in combined)

        # القرار
        if pos_score > neg_score:
            sentiment = 'positive'
            score = 50 + min(pos_score * 5, 45)  # max 95
        elif neg_score > pos_score:
            sentiment = 'negative'
            score = 50 - min(neg_score * 5, 40)  # min 10
        else:
            sentiment = 'neutral'
            score = 50

        # summary بالعربية
        if pos_count > 0 or neg_count > 0:
            summary = f'تحليل آلي: {pos_count} كلمات إيجابية (وزن {pos_score}) / {neg_count} كلمات سلبية (وزن {neg_score})'
        else:
            summary = 'لا توجد كلمات مؤثرة في الأخبار'

        return {
            'sentiment': sentiment,
            'score': score,
            'summary': summary,
            'confidence': min(0.3 + (pos_count + neg_count) * 0.1, 0.8),
            'source': 'keyword',
        }

    def analyze_stock_news(self, ticker: str, company_name: str = "",
                            max_articles: int = 3) -> Dict[str, Any]:
        """تحليل شامل لأخبار سهم معين.

        Args:
            ticker: رمز السهم (مثال: COMI)
            company_name: اسم الشركة (اختياري)
            max_articles: حد أقصى للمقالات المستخرجة

        Returns:
            {
                sentiment: "positive"/"negative"/"neutral",
                score: 0-100,
                summary: str,
                confidence: 0-1,
                articles_found: int,
                articles_analyzed: int,
                source: "ollama"/"keyword",
            }
        """
        start_time = time.time()

        # 1. ابحث عن الأخبار
        query = f"{ticker} {company_name} Egypt stock" if company_name else f"{ticker} Egypt stock"
        news_results = self.search_news(query, max_results=max_articles + 2)

        if not news_results:
            return {
                'sentiment': 'neutral',
                'score': 50,
                'summary': 'لا توجد أخبار حديثة',
                'confidence': 0.0,
                'articles_found': 0,
                'articles_analyzed': 0,
                'source': 'none',
                'elapsed': time.time() - start_time,
            }

        # 2. استخرج نصوص المقالات
        article_texts = []
        for news in news_results[:max_articles]:
            # استخدم الـ snippet لو موجود، لو لا حاول تستخرج من URL
            text = news.get('snippet', '')
            if len(text) < 100 and news.get('url'):
                extracted = self.extract_article(news['url'])
                if extracted:
                    text = extracted[:500]  # أول 500 حرف

            if text and len(text) > 30:
                article_texts.append(text)

        if not article_texts:
            return {
                'sentiment': 'neutral',
                'score': 50,
                'summary': 'أخبار موجودة بس ما قدرناش نستخرج المحتوى',
                'confidence': 0.0,
                'articles_found': len(news_results),
                'articles_analyzed': 0,
                'source': 'none',
                'elapsed': time.time() - start_time,
            }

        # 3. حلل بالـ AI (أو keyword fallback)
        result = self.analyze_with_llm(ticker, company_name, article_texts)
        result['articles_found'] = len(news_results)
        result['articles_analyzed'] = len(article_texts)
        result['elapsed'] = time.time() - start_time

        return result


# ═══════════════════════════════════════════════════════════════════
# اختبار سريع
# ═══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("╔═══════════════════════════════════════════════════════════╗")
    print("║   News Agent — اختبار جلب وتحليل الأخبار               ║")
    print("╚═══════════════════════════════════════════════════════════╝\n")

    agent = NewsAgent()

    print(f"Agent ready: {agent.is_ready()}")
    print(f"DDGS: {DDGS_AVAILABLE} | Trafilatura: {TRAFILATURA_AVAILABLE} | Ollama: {agent.ollama_client is not None}")
    print()

    # اختبار على 3 أسهم
    test_stocks = [
        ('COMI', 'Commercial International Bank Egypt'),
        ('SWDY', 'Ezz Steel'),
        ('HRHO', 'Hassan Allam Construction'),
    ]

    for ticker, name in test_stocks:
        print(f"── {ticker} ({name}) ──")
        result = agent.analyze_stock_news(ticker, name, max_articles=3)
        print(f"  sentiment: {result['sentiment']}")
        print(f"  score: {result['score']}/100")
        print(f"  summary: {result['summary']}")
        print(f"  confidence: {result['confidence']}")
        print(f"  articles: {result['articles_found']} found / {result['articles_analyzed']} analyzed")
        print(f"  source: {result['source']}")
        print(f"  elapsed: {result.get('elapsed', 0):.1f}s")
        print()
