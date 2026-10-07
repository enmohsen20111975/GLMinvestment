"""
ناشر الأخبار والتحليلات على منصات التواصل الاجتماعي
المنصة الحالية: Telegram Channel (@Arabian_investment_guide)
"""

import os
import sys
import re
import json
import logging
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from pathlib import Path

# ربط قاموس الأسهم المصرية لجلب الأسماء العربية
try:
    from config.paths import resolve_vps_service
    GLM_VPS = resolve_vps_service()
    if GLM_VPS:
        sys.path.insert(0, str(Path(GLM_VPS) / "analyzers"))
    from egx_stocks_dictionary import get_stock_display_info
except Exception:
    def get_stock_display_info(ticker: str) -> dict:
        return {'ticker': ticker, 'name_ar': ticker, 'name_en': ticker}

log = logging.getLogger('SocialPublisher')


def _escape_html(text: str) -> str:
    """تنظيف النصوص لمنع أخطاء Telegram HTML Parser"""
    if not text:
        return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class SocialPublisher:
    """ينشر الأخبار والتحليلات الاستثمارية على منصات التواصل (تليجرام) بتنسيق مالي احترافي"""

    def __init__(self):
        self.telegram_token = os.getenv('TELEGRAM_BOT_TOKEN', '8607763114:AAFkSWD5uvjbB0yzFl57R6J9rU_6ajrEi5U').strip()
        self.telegram_chat_id = (
            os.getenv('TELEGRAM_CHAT_ID') or
            os.getenv('TELEGRAM_CHANNEL_ID') or
            '@Arabian_investment_guide'
        ).strip()
        self.main_domain = os.getenv('MAIN_DOMAIN', 'https://invist.m2y.net').rstrip('/')

    async def publish(self, news: dict, platforms: list[str] = None) -> dict:
        """نشر خبر استثماري على المنصات المحددة"""
        if platforms is None:
            platforms = ['telegram']

        results = {}
        for platform in platforms:
            try:
                if platform == 'telegram':
                    result = await self._publish_telegram(news)
                    results['telegram'] = result
                else:
                    results[platform] = {'skipped': True, 'reason': 'not_implemented'}
            except Exception as e:
                log.error(f"خطأ النشر على {platform}: {e}", exc_info=True)
                results[platform] = {'error': str(e)}

        return results

    def _format_telegram_content(self, news: dict) -> tuple[str, str, dict]:
        """
        صياغة محتوى التليجرام بتنسيق مالي غني:
        - full_text (حتى 4000 حرف للرسائل النصية)
        - caption_text (حتى 1024 حرف للصور)
        - reply_markup (أزرار تفاعلية للشارت والتحليل)
        """
        title = news.get('title', '') or 'تحديث مالي عاجل'
        body = news.get('body', '') or ''
        summary_ar = news.get('summary_ar', '').strip()
        url = news.get('url', '').strip()
        source = news.get('source', '').strip()
        sentiment = (news.get('sentiment') or 'neutral').lower()
        impact_type = (news.get('impact_type') or 'general').lower()
        is_catalyst = bool(news.get('is_catalyst'))

        # استخراج وتحليل الأسهم
        raw_tickers = news.get('tickers', [])
        if isinstance(raw_tickers, str):
            try:
                tickers = json.loads(raw_tickers)
            except Exception:
                tickers = [t.strip().upper() for t in raw_tickers.split(',') if t.strip()]
        elif isinstance(raw_tickers, (list, set, tuple)):
            tickers = [str(t).strip().upper() for t in raw_tickers if str(t).strip()]
        else:
            tickers = []

        # استخراج أسماء الأسهم والهاشتاجات
        stock_tags = []
        stock_labels = []
        for t in tickers[:3]:
            info = get_stock_display_info(t)
            ar_name = info.get('name_ar') or t
            stock_tags.append(f"#{t}")
            # توليد وسم عربي مختصر ونظيف من اسم الشركة
            words = [w for w in re.sub(r'[^\w\s]', '', ar_name).split() if w not in ('شركة', 'ش.م.م', 'القابضة', 'والاستثمار', 'والصناعات', 'العامة')]
            if words:
                short_tag = "_".join(words[:2]).strip('_')
                if len(short_tag) >= 3:
                    stock_tags.append(f"#{short_tag}")
            stock_labels.append(f"{ar_name} ({t})")

        # التقييم والتصنيف المالي بشكل موضوعي وبسيط
        sentiment_map = {
            'bullish': 'إيجابي',
            'positive': 'إيجابي',
            'bearish': 'سلبي',
            'negative': 'سلبي',
            'neutral': 'محايد'
        }
        sentiment_badge = sentiment_map.get(sentiment, 'محايد')

        # نوع الحدث
        impact_map = {
            'earnings': 'نتائج مالية وأرباح',
            'dividend': 'توزيعات أرباح',
            'acquisition': 'صفقات واستحواذات',
            'merger': 'اندماج وشراكات',
            'capital': 'تعديل / زيادة رأس المال',
            'board': 'قرارات مجلس الإدارة',
            'regulatory': 'إفصاحات وقرارات رسمية',
            'expansion': 'مشروعات وتوسعات',
            'general': 'خبر اقتصادي'
        }
        impact_badge = impact_map.get(impact_type, 'خبر اقتصادي')

        # بناء الرسالة كخبر موضوعي مع تقييمه فقط
        lines = [f"📰 <b>{_escape_html(title)}</b>", ""]

        if stock_labels:
            lines.append(f"🏢 <b>السهم:</b> {_escape_html(' • '.join(stock_labels))}")

        lines.append(f"📊 <b>التقييم:</b> {sentiment_badge}")
        lines.append(f"📌 <b>التصنيف:</b> {impact_badge}")

        importance = news.get('importance', 0)
        if importance:
            lines.append(f"⚖️ <b>درجة الأهمية:</b> {importance}/100")

        lines.append("")

        # الملخص الفعلي للخبر
        content_text = summary_ar or body
        if content_text:
            clean_text = content_text.strip().replace('\r', '')
            if len(clean_text) > 450:
                clean_text = clean_text[:450] + "..."
            lines.append("📝 <b>الملخص:</b>")
            lines.append(f"{_escape_html(clean_text)}")
            lines.append("")

        # بيانات التوثيق
        meta_items = []
        if source:
            meta_items.append(f"المصدر: {_escape_html(source)}")
        meta_items.append(datetime.now().strftime('%Y-%m-%d %H:%M'))
        lines.append(f"ℹ️ {' • '.join(meta_items)}")

        # الهاشتاجات
        if stock_tags:
            lines.append("")
            tags_str = " ".join(dict.fromkeys(stock_tags[:3]))
            lines.append(f"{tags_str} #البورصة_المصرية")

        full_text = "\n".join(lines)

        # بناء Caption للصور (موجز وموضوعي دون تجاوز 1024 حرف)
        caption_lines = [f"📰 <b>{_escape_html(title)}</b>", ""]
        if stock_labels:
            caption_lines.append(f"🏢 <b>السهم:</b> {_escape_html(stock_labels[0])}")
        caption_lines.append(f"📊 <b>التقييم:</b> {sentiment_badge} | {impact_badge}")
        if importance:
            caption_lines.append(f"⚖️ <b>الأهمية:</b> {importance}/100")

        if content_text:
            caption_lines.append("")
            clean_text = content_text.strip().replace('\r', '')
            c_trim = clean_text[:380] + ("..." if len(clean_text) > 380 else "")
            caption_lines.append(f"📝 {_escape_html(c_trim)}")

        if stock_tags:
            caption_lines.append("")
            caption_lines.append(" ".join(dict.fromkeys(stock_tags[:2])))

        caption_text = "\n".join(caption_lines)
        if len(caption_text) > 1020:
            caption_text = caption_text[:1015] + "..."

        # الأزرار التفاعلية الرسمية الشاملة
        primary_ticker = tickers[0] if tickers else None
        radar_url = f"https://invist.m2y.net/#recommendations?ticker={primary_ticker}" if primary_ticker else "https://invist.m2y.net/#recommendations"
        chart_url = f"https://invist.m2y.net/#trading-chart?ticker={primary_ticker}" if primary_ticker else "https://invist.m2y.net/#trading-chart"
        radar_text = f"📊 رادار {primary_ticker} والتوصيات" if primary_ticker else "📊 رادار السيولة والتوصيات"
        chart_text = f"📈 شارت سهم {primary_ticker}" if primary_ticker else "📈 شارت التحليل الفني"

        buttons = []
        if url and url.startswith('http') and 'your-domain' not in url:
            buttons.append([{"text": "🔗 قراءة الخبر كاملاً", "url": url}])

        # الصف الأول: الموقع الرسمي + بوت التحليل الذكي
        buttons.append([
            {"text": "🌐 الموقع الرسمي", "url": "https://invist.m2y.net"},
            {"text": "🤖 بوت التحليل الذكي", "url": "https://t.me/investusernamebot"},
        ])

        # الصف الثاني: خدمات الموقع (الرادار الحي والشارت الفني)
        buttons.append([
            {"text": radar_text, "url": radar_url},
            {"text": chart_text, "url": chart_url},
        ])

        # الصف الثالث: خدمة الفلاتر من الموقع + التواصل المباشر (واتساب)
        buttons.append([
            {"text": "🔍 فلاتر وبورصة الأسهم", "url": "https://invist.m2y.net/#stock-filters"},
            {"text": "💬 تواصل عبر الواتساب", "url": "https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc"},
        ])

        reply_markup = {'inline_keyboard': buttons}

        return full_text, caption_text, reply_markup

    async def _publish_telegram(self, news: dict) -> dict:
        """النشر المباشر على تيليجرام"""
        if not self.telegram_token or not self.telegram_chat_id:
            log.warning("النشر متوقف لغياب بيانات TELEGRAM_BOT_TOKEN أو TELEGRAM_CHAT_ID")
            return {'skipped': True, 'reason': 'missing_credentials'}

        full_text, caption_text, reply_markup = self._format_telegram_content(news)

        # استخراج مسارات وروابط الصور إن وجدت
        image_paths = news.get('image_paths', [])
        if isinstance(image_paths, str):
            try:
                image_paths = json.loads(image_paths)
            except Exception:
                image_paths = []
        image_urls = news.get('image_urls', [])
        if isinstance(image_urls, str):
            try:
                image_urls = json.loads(image_urls)
            except Exception:
                image_urls = []

        all_images = (image_paths if isinstance(image_paths, list) else []) + \
                     (image_urls if isinstance(image_urls, list) else [])

        image_sent = False
        for img in all_images[:1]:
            if not img:
                continue
            try:
                if str(img).startswith('http'):
                    sent = self._telegram_send_photo_url(
                        self.telegram_token, self.telegram_chat_id,
                        str(img), caption_text, reply_markup
                    )
                else:
                    sent = self._telegram_send_photo_file(
                        self.telegram_token, self.telegram_chat_id,
                        str(img), caption_text, reply_markup
                    )
                if sent:
                    image_sent = True
                    break
            except Exception as e:
                log.debug(f"فشل إرسال صورة الخبر على تليجرام ({img}): {e}")

        # في حال عدم وجود صورة أو فشل إرسالها، نرسل الرسالة النصية الكاملة
        if not image_sent:
            sent = self._telegram_send_message(
                self.telegram_token, self.telegram_chat_id,
                full_text, reply_markup
            )
            if not sent:
                return {'error': 'failed_to_send'}

        return {
            'platform': 'telegram',
            'chat_id': self.telegram_chat_id,
            'status': 'sent',
            'with_photo': image_sent,
            'sent_at': datetime.now().isoformat()
        }

    def _telegram_send_message(self, token: str, chat_id: str, text: str, reply_markup: dict = None) -> bool:
        """إرسال رسالة نصية لـ Telegram"""
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {
            'chat_id': chat_id,
            'text': text,
            'parse_mode': 'HTML',
            'disable_web_page_preview': False,
        }
        if reply_markup:
            payload['reply_markup'] = json.dumps(reply_markup)

        data = urllib.parse.urlencode(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                return resp.status == 200
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            log.error(f"Telegram sendMessage HTTPError {e.code}: {err_body}")
            # محاولة الإرسال بدون أزرار أو تنظيف إضافي في حالة رفض التيليجرام
            try:
                plain_payload = {
                    'chat_id': chat_id,
                    'text': text,
                    'parse_mode': 'HTML'
                }
                plain_data = urllib.parse.urlencode(plain_payload).encode('utf-8')
                with urllib.request.urlopen(urllib.request.Request(url, data=plain_data), timeout=10) as r:
                    return r.status == 200
            except Exception:
                return False
        except Exception as e:
            log.error(f"Telegram sendMessage error: {e}")
            return False

    def _telegram_send_photo_url(self, token: str, chat_id: str, photo_url: str, caption: str, reply_markup: dict = None) -> bool:
        """إرسال صورة عبر URL لـ Telegram"""
        url = f"https://api.telegram.org/bot{token}/sendPhoto"
        payload = {
            'chat_id': chat_id,
            'photo': photo_url,
            'caption': caption[:1024],
            'parse_mode': 'HTML',
        }
        if reply_markup:
            payload['reply_markup'] = json.dumps(reply_markup)

        data = urllib.parse.urlencode(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.status == 200
        except Exception as e:
            log.debug(f"sendPhoto URL error: {e}")
            return False

    def _telegram_send_photo_file(self, token: str, chat_id: str, file_path: str, caption: str, reply_markup: dict = None) -> bool:
        """إرسال صورة من ملف محلي لـ Telegram عبر Multipart"""
        try:
            if not os.path.isfile(file_path):
                return False
            import mimetypes
            boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
            with open(file_path, 'rb') as f:
                file_data = f.read()
            filename = os.path.basename(file_path)
            mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

            parts = [
                f'--{boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{chat_id}\r\n',
                f'--{boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n{caption[:1024]}\r\n',
                f'--{boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n'
            ]
            if reply_markup:
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n{json.dumps(reply_markup)}\r\n')

            body = "".join(parts).encode('utf-8')
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="{filename}"\r\nContent-Type: {mime_type}\r\n\r\n'.encode('utf-8')
            body += file_data + f'\r\n--{boundary}--\r\n'.encode('utf-8')

            req = urllib.request.Request(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data=body,
                headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.status == 200
        except Exception as e:
            log.debug(f"sendPhoto file error: {e}")
            return False
