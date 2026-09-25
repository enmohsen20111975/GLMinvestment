#!/usr/bin/env python3
"""
telegram_radar_notifier.py — نشر رادار الميكرز على التليجرام
=================================================================
بينشر:
  1. توقعات الرادار عالية الثقة (مرة واحدة فقط يومياً بتوقيت القاهرة)
  2. أسهم Surge Detector
  3. تنبيهات الانفجارات (كل ما سهم بـ يدخل تحت الميكروسكوب بثقة عالية)
  4. الأخبار المهمة
"""
import os
import sys
import sqlite3
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
NEWS_DB = PROJECT_ROOT / 'db' / 'news.db'
STATE_FILE = Path(__file__).resolve().parent / 'radar_notifier_state.json'

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
    'whatsapp': 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
}

COMMUNITY_PROMPT = 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈'

OFFICIAL_LINKS_BLOCK = f"""
{COMMUNITY_PROMPT}

🔗 روابطنا الرسمية:
🌐 الموقع: {OFFICIAL_LINKS['website']}
📱 أندرويد: {OFFICIAL_LINKS['android']}
📘 فيسبوك: {OFFICIAL_LINKS['facebook']}
✈️ تليجرام: {OFFICIAL_LINKS['telegram']}
💬 واتساب: {OFFICIAL_LINKS['whatsapp']}"""


def get_cairo_now():
    """الحصول على التوقيت الحالي لمدينة القاهرة بدقة (تجنب أخطاء توقيت UTC مثل 12:39 بدلاً من 15:39)."""
    try:
        import zoneinfo
        return datetime.now(zoneinfo.ZoneInfo('Africa/Cairo'))
    except Exception:
        # Fallback: UTC+3 (Egypt Standard Time)
        return datetime.now(timezone(timedelta(hours=3)))


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_state(state: dict):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ خطأ حفظ حالة رادار التليجرام: {e}")


class TelegramRadarNotifier:
    """نشر رادار الميكرز على التليجرام مع حماية كاملة من التكرار العشوائي وتضارب البيانات."""

    def __init__(self):
        self.bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
        self.chat_id = os.environ.get('TELEGRAM_CHANNEL_ID', '') or os.environ.get('TELEGRAM_CHAT_ID', '')
        self.enabled = bool(self.bot_token and self.chat_id)

    def _send(self, message: str) -> bool:
        """إرسال رسالة للتليجرام."""
        if not self.enabled:
            return False
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            data = urllib.parse.urlencode({
                'chat_id': self.chat_id,
                'text': message,
                'parse_mode': 'HTML',
                'disable_web_page_preview': True
            }).encode('utf-8')
            req = urllib.request.Request(url, data=data, method='POST')
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.status == 200
        except Exception as e:
            print(f"[TelegramRadarNotifier] send failed: {e}", flush=True)
            return False

    def post_radar_predictions(self, radar_json_path=None, force=False):
        """نشر توقعات الرادار عالية الثقة مرة واحدة فقط لكل جلسة لمنع التكرار والتضارب."""
        if not self.enabled:
            return False

        cairo_now = get_cairo_now()
        today_str = cairo_now.strftime('%Y-%m-%d')
        now_ts = cairo_now.timestamp()

        # قفل حماية من التكرار اليومي: منع النشر أكثر من مرة في اليوم الواحد
        state = load_state()
        last_date = state.get('last_post_date')
        last_ts = state.get('last_post_timestamp', 0)

        if not force:
            if last_date == today_str:
                print(f"[TelegramRadarNotifier] ℹ️ تم نشر تقرير الرادار بالفعل اليوم ({today_str}). تخطي الإرسال المتكرر لحماية القناة.", flush=True)
                return False
            if (now_ts - last_ts) < 21600:  # 6 ساعات كحد أدنى بين أي تقرير وآخر
                print(f"[TelegramRadarNotifier] ℹ️ فترة التهدئة نشطة (أقل من 6 ساعات منذ آخر نشر).", flush=True)
                return False

        # اقرأ آخر radar cache
        if not radar_json_path:
            output_dir = PROJECT_ROOT / 'scripts' / 'output'
            files = sorted([f for f in os.listdir(output_dir) if f.startswith('maker_radar_') and f.endswith('.json')])
            if not files:
                return False
            radar_json_path = output_dir / files[-1]

        try:
            with open(radar_json_path, 'r', encoding='utf-8') as f:
                radar = json.load(f)
        except Exception as e:
            print(f"[TelegramRadarNotifier] خطأ في قراءة ملف الرادار: {e}", flush=True)
            return False

        total_scanned = radar.get('total_scanned', 0)
        # إذا كان الفحص يضم أسواق مختلطة غير مدققة (أكثر من 300 سهم)، نتأكد من عدم نشر بيانات ملوثة
        if total_scanned > 310 and not force:
            print(f"[TelegramRadarNotifier] ⚠️ تم رصد فحص موسع غير مقيد بـ EGX ({total_scanned} سهم). تخطي النشر لمنع تضارب البيانات.", flush=True)
            return False

        # جمّع الأسهم تحت الميكروسكوب
        all_stocks = (
            (radar.get('top_explosions') or []) +
            (radar.get('surge_detector_list') or []) +
            (radar.get('pre_surge_list') or []) +
            (radar.get('quiet_list') or []) +
            (radar.get('explosive_list') or []) +
            (radar.get('early_break_list') or [])
        )

        # فلترة الأسهم عالية الجودة فقط: ثقة >= 65%، استبعاد الهابط والعرضي السلبي
        filtered_stocks = []
        seen_tickers = set()
        for s in all_stocks:
            tk = s.get('ticker')
            if not tk or tk in seen_tickers:
                continue
            conf = float(s.get('confidence_score') or 0)
            if conf < 65:
                continue
            direction = str(s.get('expected_dir') or '')
            if 'هبوط' in direction or 'هابط' in direction:
                continue
            buy_pct = float(s.get('buy_pct') or 0)
            roc5 = float(s.get('roc_5d') or 0)
            # استبعاد الأسهم العرضية ذات الشراء الضعيف أو الزخم السلبي الحاد
            if 'عرضي' in direction and (buy_pct < 55 or roc5 < -2.0):
                continue

            seen_tickers.add(tk)
            filtered_stocks.append(s)

        if not filtered_stocks:
            print("[TelegramRadarNotifier] لا توجد أسهم صاعدة عالية الثقة مؤهلة للنشر حالياً.", flush=True)
            return False

        # رتّب حسب الثقة وتدفق السيولة
        filtered_stocks.sort(key=lambda x: (
            float(x.get('confidence_score') or 0),
            float(x.get('vol_ratio_now') or x.get('volume_ratio_10d_vs_20d') or 1.0)
        ), reverse=True)

        # بناء الرسالة الرسمية الموحدة بتوقيت القاهرة
        cairo_time_str = cairo_now.strftime('%Y-%m-%d %H:%M')
        lines = []
        lines.append("🎯 <b>رادار الميكرز — توقعات عالية الثقة</b>")
        lines.append(f"📅 {cairo_time_str} (توقيت القاهرة)")
        lines.append(f"📊 مفحوصين: {total_scanned} | تحت الميكروسكوب: {radar.get('under_microscope_count', 0)}")
        lines.append("━━━━━━━━━━━━━━━━━━━")
        lines.append("")

        for i, s in enumerate(filtered_stocks[:8], 1):
            ticker = s.get('ticker', '?')
            price = float(s.get('current_price') or 0)
            conf = float(s.get('confidence_score') or 0)
            level = s.get('confidence_level', '')
            direction = s.get('expected_dir', '')
            timing = s.get('expected_timing', '')
            buy_pct = float(s.get('buy_pct') or 0)
            vol_ratio = float(s.get('vol_ratio_now') or s.get('volume_ratio_10d_vs_20d') or 0)
            roc5 = float(s.get('roc_5d') or 0)

            # أيقونة الاتجاه
            icon = '🟢'
            if 'انفجار' in direction:
                icon = '🚀'
            elif 'صاعد' in direction or 'ميكرز' in direction:
                icon = '🟢'
            else:
                icon = '📈'

            lines.append(f"{i}. {icon} <b>{ticker}</b> — {conf:.0f}% {level}")
            lines.append(f"   💰 السعر: {price:.2f} ج.م | 📈 ROC5: {roc5:+.1f}%")
            lines.append(f"   📊 buy: {buy_pct:.0f}% | vol: {vol_ratio:.2f}x")
            lines.append(f"   🧭 {direction} | ⏰ {timing}")
            lines.append("")

        lines.append("━━━━━━━━━━━━━━━━━━━")
        lines.append(OFFICIAL_LINKS_BLOCK)

        message = '\n'.join(lines)
        success = self._send(message)
        if success:
            state['last_post_date'] = today_str
            state['last_post_timestamp'] = now_ts
            save_state(state)
            print(f"[TelegramRadarNotifier] ✅ تم نشر التقرير بنجاح وتحديث تاريخ النشر لليوم ({today_str}).", flush=True)
            return True
        return False

    def post_surge_alert(self, ticker, price, surge_pct, vol_ratio, confidence):
        """تنبيه فوري لسهم انفجر."""
        if not self.enabled:
            return False

        now = get_cairo_now().strftime('%H:%M:%S')
        message = f"""💥 <b>تنبيه انفجار لحظي!</b>

📊 <b>{ticker}</b> — السعر: {price:.2f} ج.م
🚀 ارتفاع: +{surge_pct:.1f}%
📈 تدفق سيولة: {vol_ratio:.2f}× المتوسط
🔒 الثقة التنبؤية: {confidence}%

⏰ {now}
{OFFICIAL_LINKS_BLOCK}"""
        return self._send(message)

    def post_important_news(self, title, source, url=None):
        """نشر خبر اقتصادي مهم."""
        if not self.enabled:
            return False

        message = f"""📰 <b>خبر اقتصادي عاجل</b>

📌 {title}
📡 المصدر: {source}
"""
        if url:
            message += f"🔗 {url}\n"
        message += OFFICIAL_LINKS_BLOCK

        return self._send(message)


if __name__ == '__main__':
    force_mode = '--force' in sys.argv
    notifier = TelegramRadarNotifier()
    if not notifier.enabled:
        print("❌ Telegram Bot Token أو Channel ID مش موجودين في .env")
        sys.exit(1)

    print("═══ نشر رادار الميكرز على التليجرام ═══")
    result = notifier.post_radar_predictions(force=force_mode)
    print(f"✅ تم النشر: {result}" if result else "ℹ️ لم يتم النشر (تم النشر مسبقاً أو غير مؤهل)")
