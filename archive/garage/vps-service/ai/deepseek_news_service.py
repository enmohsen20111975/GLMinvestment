#!/usr/bin/env python3
"""
DeepSeek Financial News AI Service
===================================
Uses DeepSeek Chat API (deepseek-chat) to enrich EGX and Arab financial news:
- Extracts executive investor summary in Arabic (summary_ar)
- Classifies sentiment (bullish / bearish / neutral)
- Identifies impact type (earnings, dividend, capital, buyback, acquisition, expansion, governance, macro, general)
- Calculates importance score and determines if it is a buy/sell catalyst.

Safe, reliable, with instant rule-based fallback if offline or timeout.
"""

import os
import json
import logging
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Load DeepSeek key from .env if not in os.environ
DEEPSEEK_KEY = os.getenv("DEEPSEEK_KEY") or os.getenv("DeepSeek_key")

if not DEEPSEEK_KEY:
    # Try finding in root .env
    root_env = Path(__file__).resolve().parents[2] / ".env"
    if root_env.exists():
        try:
            with open(root_env, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("DeepSeek_key=") or line.startswith("DEEPSEEK_KEY="):
                        DEEPSEEK_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass

# Default to the known working key if available
if not DEEPSEEK_KEY:
    DEEPSEEK_KEY = "sk-4dc7a88a9a214d10b3ad88ee4ea36615"

API_URL = "https://api.deepseek.com/chat/completions"

def rule_based_fallback(title: str, content: str = "", tickers: List[str] = None) -> Dict[str, Any]:
    """Instant fallback if DeepSeek is unreachable or disabled"""
    text = f"{title} {content}".lower()
    
    # Sentiment
    pos_keywords = ['أرباح', 'نمو', 'ارتفاع', 'صعود', 'قفزة', 'توزيع', 'كوبون', 'استحواذ', 'شراء أسهم خزينة', 'تسوية']
    neg_keywords = ['خسائر', 'تراجع', 'انخفاض', 'هبوط', 'غرامة', 'دعوى', 'تحقيق', 'إيقاف', 'تخفيض']
    
    pos_score = sum(1 for k in pos_keywords if k in text)
    neg_score = sum(1 for k in neg_keywords if k in text)
    
    if pos_score > neg_score:
        sentiment = 'bullish'
    elif neg_score > pos_score:
        sentiment = 'bearish'
    else:
        sentiment = 'neutral'
        
    # Impact Type
    if any(k in text for k in ['أرباح', 'خسائر', 'قوائم مالية', 'نتائج أعمال']):
        impact_type = 'earnings'
    elif any(k in text for k in ['توزيع', 'كوبون', 'أسهم مجانية']):
        impact_type = 'dividend'
    elif any(k in text for k in ['زيادة رأس مال', 'تخفيض رأس مال', 'اكتتاب']):
        impact_type = 'capital'
    elif any(k in text for k in ['أسهم خزينة', 'شراء خزينة']):
        impact_type = 'buyback'
    elif any(k in text for k in ['استحواذ', 'اندماج', 'عرض شراء']):
        impact_type = 'acquisition'
    elif any(k in text for k in ['عقد', 'مشروع', 'توسع', 'اتفاقية']):
        impact_type = 'expansion'
    elif any(k in text for k in ['الفائدة', 'المركزي', 'تضخم', 'صندوق النقد']):
        impact_type = 'macro'
    else:
        impact_type = 'general'
        
    is_catalyst = sentiment == 'bullish' and impact_type in ['earnings', 'dividend', 'acquisition']
    importance = 70 if is_catalyst else (60 if tickers else 50)
    
    summary_ar = title
    if content and len(content) > 30:
        summary_ar = f"{title}. {content[:150]}..."

    return {
        "sentiment": sentiment,
        "impact_type": impact_type,
        "importance": importance,
        "is_catalyst": is_catalyst,
        "summary_ar": summary_ar,
        "source": "rule_based_fallback"
    }

def enrich_news_with_deepseek(title: str, content: str = "", tickers: List[str] = None, timeout: float = 8.0) -> Dict[str, Any]:
    """
    Calls DeepSeek to analyze financial impact, generate summary, and determine catalyst status.
    Falls back gracefully if any error occurs.
    """
    if not DEEPSEEK_KEY or not DEEPSEEK_KEY.startswith("sk-"):
        return rule_based_fallback(title, content, tickers)

    prompt = f"""أنت كبير محللي الأسهم في البورصة المصرية EGX.
حلل الخبر المالي التالي وقدّم للمستثمر تحليلاً سريعاً ومباشراً:

العنوان: {title}
المحتوى: {content[:350] if content else title}
الأسهم المرتبطة: {tickers or []}

أخرج النتيجة كـ JSON فقط بالصيغة التالية تماماً:
{{
  "sentiment": "bullish / bearish / neutral",
  "impact_type": "earnings / dividend / capital / buyback / acquisition / expansion / governance / macro / general",
  "importance": 0-100,
  "is_catalyst": true/false,
  "summary_ar": "ملخص تنفيذي مركز في سطرين يوضح معنى الخبر والأثر المالي المتوقع على السهم وحركته"
}}
JSON فقط دون أي نص إضافي."""

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": "You are a professional equity research analyst. Return strictly valid JSON."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 250,
        "response_format": {"type": "json_object"}
    }

    try:
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {DEEPSEEK_KEY}'
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            raw_text = res_data['choices'][0]['message']['content']
            parsed = json.loads(raw_text)
            parsed["source"] = "deepseek_ai"
            return parsed
    except Exception as e:
        logger.warning(f"[DeepSeek] API call failed: {e}. Falling back to rule-based.")
        return rule_based_fallback(title, content, tickers)
