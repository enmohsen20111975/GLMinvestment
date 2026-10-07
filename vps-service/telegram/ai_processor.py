#!/usr/bin/env python3
"""
AI Processor for Telegram Messages
===================================
معالجة الرسائل باستخدام الذكاء الاصطناعي
- استخراج التوقعات
- استخراج الأخبار
- تحديد السوق والأسهم
"""

import re
import json
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict


@dataclass
class ExtractedRecommendation:
    """توقعة مستخرجة"""
    symbol: str
    action: str  # buy, sell, hold
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    timeframe: Optional[str] = None
    confidence: float = 0.0
    reasoning: str = ""


@dataclass
class ExtractedNews:
    """خبر مستخرج"""
    title: str
    content: str
    sentiment: str = "neutral"
    importance: int = 1
    symbols_mentioned: List[str] = None

    def __post_init__(self):
        if self.symbols_mentioned is None:
            self.symbols_mentioned = []


class MessageClassifier:
    """تصنيف الرسائل"""

    # كلمات دالة للتوقعات
    RECOMMENDATION_KEYWORDS = [
        # عربي
        'توقعة', 'شراء', 'بيع', 'سعر الدخول', 'سعر المستهدف', 'وقف خسارة',
        'هدف', 'استهدف', 'ادخل', 'اخرج', 'تراكم', 'تجميع', 'تصريف',
        'دعم', 'مقاومة', 'اختراق', 'ارتداد', 'قاع', 'قمة',
        # إنجليزي
        'buy', 'sell', 'target', 'entry', 'stop loss', 'stoploss',
        'long', 'short', 'accumulate', 'breakout', 'break down',
        'support', 'resistance', 'breakout'
    ]

    # كلمات دالة للأخبار
    NEWS_KEYWORDS = [
        # عربي
        'خبر', 'إعلان', 'قرار', 'تقرير', 'نتيجة', 'أرباح',
        'توزيعات', 'اجتماع', 'جمعية', 'عمومية', 'استثمار',
        'مشروع', 'تعاقد', 'شراكة', 'استحواذ', 'دمج',
        # إنجليزي
        'news', 'announce', 'report', 'earnings', 'dividend',
        'meeting', 'investment', 'project', 'contract', 'partnership',
        'acquisition', 'merger', 'fda', 'approval'
    ]

    # كلمات النقاش (غير مهمة)
    DISCUSSION_KEYWORDS = [
        'رأيكم', 'وش رايكم', 'ما رأيكم', 'سؤال', 'استفسار',
        'الاخوان', 'ياجماعة', 'يا جماعة', 'اللي', 'الذين',
        'what do you think', 'question', 'opinion'
    ]

    @classmethod
    def classify(cls, text: str) -> Tuple[str, float]:
        """
        تصنيف الرسالة
        Returns: (type, confidence)
        type: 'recommendation', 'news', 'discussion', 'general'
        """
        if not text:
            return 'general', 0.0

        text_lower = text.lower()

        # عد الكلمات الدالة
        rec_count = sum(1 for kw in cls.RECOMMENDATION_KEYWORDS if kw in text_lower)
        news_count = sum(1 for kw in cls.NEWS_KEYWORDS if kw in text_lower)
        disc_count = sum(1 for kw in cls.DISCUSSION_KEYWORDS if kw in text_lower)

        # حساب الثقة
        total = rec_count + news_count + disc_count
        if total == 0:
            return 'general', 0.0

        # تحديد النوع
        if rec_count >= news_count and rec_count >= disc_count:
            confidence = rec_count / (total + 1)
            return 'recommendation', min(confidence * 2, 1.0)
        elif news_count >= disc_count:
            confidence = news_count / (total + 1)
            return 'news', min(confidence * 2, 1.0)
        else:
            return 'discussion', disc_count / (total + 1)


class SymbolExtractor:
    """استخراج رموز الأسهم والعملات"""

    # رموز الأسهم المصرية الشائعة
    EGX_SYMBOLS = [
        'COMI', 'ETAL', 'HRHO', 'VLMR', 'SWDY', 'AMOC', 'ADCI', 'ATFA',
        'BLAC', 'BTFH', 'CIRA', 'DCRC', 'EGTS', 'HELI', 'MTIE', 'ORAS',
        'PHDW', 'PRCL', 'RMDA', 'SAFS', 'SKPC', 'TALA', 'ALCN', 'ALGL',
        'AMER', 'APHI', 'BIOE', 'CCAP', 'CHWE', 'EFIC', 'EGX 30', 'EGX70',
        'EMFD', 'EZDK', 'FIRA', 'FWRY', 'GCFO', 'GFWA', 'GLBL', 'GTFH',
        'HOEC', 'ISFA', 'MCQE', 'MASR', 'MOIC', 'NTRA', 'OAIS', 'OCDI',
        'OCDP', 'OFIC', 'OILS', 'ORWE', 'PHDC', 'PIOC', 'PMFA', 'PPHC',
        'QEIA', 'RAYE', 'SBM', 'SCFM', 'SIPC', 'SPRS', 'THET', 'TPRM',
        'UEFM', 'UIPS', 'WAVS', 'ZMCS', 'ABUK', 'ACPHA', 'ALBL', 'ALEX',
        'AMNS', 'APRI', 'BRIO', 'CAED', 'EGIC', 'EGPA', 'EIP', 'EIPO',
        'FMIC', 'GENA', 'GNCI', 'FCMD', 'INFI', 'KABO', 'LUXE', 'MEDH',
        'OATS', 'OIM', 'OLIV', 'RACC', 'SKCR', 'SODA', 'TETS', 'VINR'
    ]

    # رموز الأسهم السعودية الشائعة
    TADAWUL_SYMBOLS = [
        '2222', '1120', '1150', '1180', '1210', '1211', '1212', '1213',
        '1214', '1301', '1302', '1303', '1304', '1320', '1321', '1322',
        '2001', '2002', '2010', '2020', '2030', '2040', '2050', '2060',
        '2100', '2110', '2120', '2130', '2140', '2150', '2160', '2170',
        '2180', '2201', '2202', '2203', '2204', '2205', '2206', '2207',
        '3001', '3002', '3003', '3004', '3005', '3006', '3007', '3008',
        '4001', '4002', '4003', '4004', '4005', '4006', '4007', '4008',
        '4009', '4010', '4011', '4012', '4020', '4021', '4030', '4040',
        '4050', '4060', '4070', '4080', '4090', '4100', '4101', '4102',
        '4110', '4120', '4130', '4140', '4150', '4160', '4170', '4180',
        '4190', '4200', '4201', '4202', '4203', '4204', '4205', '4210',
        '4220', '4221', '4222', '4230', '4231', '4232', '4240', '4250',
        '4260', '4270', '4280', '4290', '4300', '4310', '4320', '4330',
        # الأسماء الشائعة
        'أرامكو', 'الراجحي', 'الأهلي', 'سامبا', ' STC', 'الاتصالات',
        'سابك', 'المملكة', 'التعاونية', 'المراعي', 'صافولا', 'سدافكو'
    ]

    # رموز العملات الرقمية
    CRYPTO_SYMBOLS = [
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'SOL', 'DOT', 'MATIC',
        'LTC', 'SHIB', 'AVAX', 'LINK', 'ATOM', 'UNI', 'XMR', 'ETC', 'XLM',
        'BCH', 'ALGO', 'VET', 'FIL', 'ICP', 'NEAR', 'AAVE', 'APT', 'ARB',
        'OP', 'INJ', 'TIA', 'SEI', 'SUI', 'PEPE', 'BONK', 'WIF',
        # أسماء
        'بيتكوين', 'ايثيريوم', 'إيثيريوم', 'ريبل', 'كاردانو', 'دوجكوين',
        'سولانا', 'بولكادوت', 'لايتكوين', 'شيبا', 'تتر', 'USDT', 'USDC'
    ]

    @classmethod
    def extract_symbols(cls, text: str) -> List[Dict]:
        """
        استخراج الرموز من النص
        Returns: list of {symbol, market, confidence}
        """
        if not text:
            return []

        text_upper = text.upper()
        symbols_found = []

        # البحث عن الأسهم المصرية
        for symbol in cls.EGX_SYMBOLS:
            if symbol in text_upper:
                symbols_found.append({
                    'symbol': symbol,
                    'market': 'egypt',
                    'confidence': 0.9
                })

        # البحث عن الأسهم السعودية
        for symbol in cls.TADAWUL_SYMBOLS:
            if symbol in text_upper or symbol in text:
                symbols_found.append({
                    'symbol': symbol,
                    'market': 'saudi',
                    'confidence': 0.9
                })

        # البحث عن العملات الرقمية
        for symbol in cls.CRYPTO_SYMBOLS:
            # تجنب الأخطاء مثل "TARGET" -> "TAR"
            pattern = r'\b' + symbol + r'\b'
            if re.search(pattern, text_upper):
                symbols_found.append({
                    'symbol': symbol,
                    'market': 'crypto',
                    'confidence': 0.95
                })

        return symbols_found

    @classmethod
    def extract_prices(cls, text: str) -> Dict:
        """استخراج الأسعار من النص"""
        result = {
            'entry_price': None,
            'target_price': None,
            'stop_loss': None
        }

        if not text:
            return result

        # أنماط استخراج الأسعار
        # عربي
        patterns_ar = [
            (r'سعر\s*الدخول\s*[:\s]*([\d.,]+)', 'entry_price'),
            (r'الدخول\s*[:\s]*([\d.,]+)', 'entry_price'),
            (r'الهدف\s*[:\s]*([\d.,]+)', 'target_price'),
            (r'المستهدف\s*[:\s]*([\d.,]+)', 'target_price'),
            (r'وقف\s*الخسارة\s*[:\s]*([\d.,]+)', 'stop_loss'),
            (r'الوقف\s*[:\s]*([\d.,]+)', 'stop_loss'),
        ]

        # إنجليزي
        patterns_en = [
            (r'entry\s*[:\s]*\$?([\d.,]+)', 'entry_price'),
            (r'target\s*[:\s]*\$?([\d.,]+)', 'target_price'),
            (r'stop\s*loss\s*[:\s]*\$?([\d.,]+)', 'stop_loss'),
            (r'sl\s*[:\s]*\$?([\d.,]+)', 'stop_loss'),
            (r'tp\s*[:\s]*\$?([\d.,]+)', 'target_price'),
        ]

        for pattern, key in patterns_ar + patterns_en:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    price = float(match.group(1).replace(',', ''))
                    if result[key] is None:
                        result[key] = price
                except:
                    pass

        return result

    @classmethod
    def extract_action(cls, text: str) -> str:
        """تحديد نوع الصفقة (شراء/بيع)"""
        if not text:
            return 'hold'

        text_lower = text.lower()

        buy_keywords = ['شراء', 'buy', 'long', 'ادخل', 'تراكم', 'تجميع', 'accumulate']
        sell_keywords = ['بيع', 'sell', 'short', 'اخرج', 'تصريف', 'خذ أرباح']

        buy_count = sum(1 for kw in buy_keywords if kw in text_lower)
        sell_count = sum(1 for kw in sell_keywords if kw in text_lower)

        if buy_count > sell_count:
            return 'buy'
        elif sell_count > buy_count:
            return 'sell'
        return 'hold'


class AIProcessor:
    """المعالج الرئيسي للرسائل"""

    def __init__(self):
        self.classifier = MessageClassifier()
        self.symbol_extractor = SymbolExtractor()

    def process_message(self, message: Dict) -> Dict:
        """
        معالجة رسالة واحدة
        Returns: {
            'type': 'recommendation' | 'news' | 'discussion' | 'general',
            'confidence': float,
            'recommendation': ExtractedRecommendation | None,
            'news': ExtractedNews | None,
            'symbols': List[Dict]
        }
        """
        text = message.get('text', '')

        # تصنيف الرسالة
        msg_type, confidence = self.classifier.classify(text)

        # استخراج الرموز
        symbols = self.symbol_extractor.extract_symbols(text)

        result = {
            'type': msg_type,
            'confidence': confidence,
            'symbols': symbols,
            'recommendation': None,
            'news': None
        }

        if msg_type == 'recommendation':
            rec = self._extract_recommendation(message, symbols)
            result['recommendation'] = asdict(rec) if rec else None

        elif msg_type == 'news':
            news = self._extract_news(message, symbols)
            result['news'] = asdict(news) if news else None

        return result

    def _extract_recommendation(self, message: Dict, symbols: List[Dict]) -> Optional[ExtractedRecommendation]:
        """استخراج توقعة من الرسالة"""
        text = message.get('text', '')

        if not symbols:
            return None

        # أخذ أول رمز
        symbol_data = symbols[0]
        symbol = symbol_data['symbol']
        market = symbol_data['market']

        # تحديد العمل
        action = self.symbol_extractor.extract_action(text)

        # استخراج الأسعار
        prices = self.symbol_extractor.extract_prices(text)

        # تحديد الإطار الزمني
        timeframe = self._extract_timeframe(text)

        # بناء التوقعة
        rec = ExtractedRecommendation(
            symbol=symbol,
            action=action,
            entry_price=prices.get('entry_price'),
            target_price=prices.get('target_price'),
            stop_loss=prices.get('stop_loss'),
            timeframe=timeframe,
            confidence=self._calculate_confidence(text, prices),
            reasoning=text[:500] if len(text) > 500 else text
        )

        return rec

    def _extract_news(self, message: Dict, symbols: List[Dict]) -> Optional[ExtractedNews]:
        """استخراج خبر من الرسالة"""
        text = message.get('text', '')

        if not text:
            return None

        # تحديد العنوان (أول سطر أو أول جملة)
        lines = text.split('\n')
        title = lines[0] if lines else text[:100]

        # تحديد المشاعر
        sentiment = self._analyze_sentiment(text)

        # تحديد الأهمية
        importance = self._calculate_importance(text)

        # الرموز المذكورة
        symbols_mentioned = [s['symbol'] for s in symbols]

        news = ExtractedNews(
            title=title[:200],
            content=text[:2000],
            sentiment=sentiment,
            importance=importance,
            symbols_mentioned=symbols_mentioned
        )

        return news

    def _extract_timeframe(self, text: str) -> str:
        """استخراج الإطار الزمني"""
        text_lower = text.lower()

        if any(kw in text_lower for kw in ['يوم', 'day', 'intraday', 'scalp']):
            return 'short'
        elif any(kw in text_lower for kw in ['أسبوع', 'week', 'swing']):
            return 'medium'
        elif any(kw in text_lower for kw in ['شهر', 'month', 'long term', 'استثمار']):
            return 'long'

        return 'unknown'

    def _calculate_confidence(self, text: str, prices: Dict) -> float:
        """حساب ثقة التوقعة"""
        score = 0.5

        # وجود سعر دخول
        if prices.get('entry_price'):
            score += 0.15

        # وجود هدف
        if prices.get('target_price'):
            score += 0.15

        # وجود وقف خسارة
        if prices.get('stop_loss'):
            score += 0.1

        # طول النص (تفاصيل أكثر = ثقة أعلى)
        if len(text) > 100:
            score += 0.05
        if len(text) > 300:
            score += 0.05

        return min(score, 1.0)

    def _analyze_sentiment(self, text: str) -> str:
        """تحليل مشاعر النص"""
        text_lower = text.lower()

        positive_words = ['إيجابي', 'positive', 'ارتفاع', 'نمو', 'أرباح', 'زيادة',
                          'rise', 'gain', 'profit', 'growth', 'bullish']
        negative_words = ['سلبي', 'negative', 'انخفاض', 'خسارة', 'تراجع', 'هبوط',
                          'fall', 'loss', 'decline', 'bearish']

        pos_count = sum(1 for w in positive_words if w in text_lower)
        neg_count = sum(1 for w in negative_words if w in text_lower)

        if pos_count > neg_count:
            return 'positive'
        elif neg_count > pos_count:
            return 'negative'
        return 'neutral'

    def _calculate_importance(self, text: str) -> int:
        """حساب أهمية الخبر"""
        importance = 1

        high_importance_keywords = ['عاجل', 'urgent', 'breaking', 'هام', 'important',
                                    'قرار', 'decision', 'fda', 'موافقة']
        medium_importance_keywords = ['تقرير', 'report', 'نتيجة', 'result', 'أرباح', 'earnings']

        text_lower = text.lower()

        if any(kw in text_lower for kw in high_importance_keywords):
            importance = 3
        elif any(kw in text_lower for kw in medium_importance_keywords):
            importance = 2

        return importance


# Singleton
ai_processor = AIProcessor()
