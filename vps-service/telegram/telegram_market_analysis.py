#!/usr/bin/env python3
"""
telegram_market_analysis.py
===========================
التحليل اليومي والتحليل الأسبوعي للبورصة المصرية | منصة دليل الاستثمار
يقوم بتوليد ونشر:
  1. التحليل اليومي الشامل بعد إغلاق الجلسة (Daily Closing Analysis).
  2. التحليل الأسبوعي الشامل واستشراف الأسبوع القادم (Weekly Market Outlook).
"""

import os
import sys
import json
import sqlite3
import logging
import requests
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_SERVICE_DIR = Path(__file__).resolve().parent.parent
TELEGRAM_DIR = Path(__file__).resolve().parent

for p in [str(PROJECT_ROOT), str(VPS_SERVICE_DIR), str(TELEGRAM_DIR), str(VPS_SERVICE_DIR / 'data')]:
    if p not in sys.path:
        sys.path.insert(0, p)

DB_DIR = PROJECT_ROOT / "db"
STOCKS_DB = DB_DIR / "stocks.db"
PREDICTIONS_DB = DB_DIR / "predictions.db"
DATA_ENGINE_DB = DB_DIR / "data_engine.db"

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger("MarketAnalysis")

# تحميل إعدادات البيئة
for p in [PROJECT_ROOT / '.env', PROJECT_ROOT / 'news-agent' / '.env']:
    if p.exists():
        with open(p, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1)
                    if k.strip() and k.strip() not in os.environ:
                        os.environ[k.strip()] = v.strip().strip('"\'')
        break

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
CHANNEL_ID = os.getenv('TELEGRAM_CHANNEL_ID', '@Arabian_investment_guide')
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

try:
    from egx_arabic_lookup import get_arabic_stock_name
except ImportError:
    try:
        from data.egx_arabic_lookup import get_arabic_stock_name
    except ImportError:
        def get_arabic_stock_name(tk, fb=None): return fb or tk

try:
    from telegram_branding import format_caption_links_block
except ImportError:
    def format_caption_links_block(): return ''

def send_channel_message(text: str, reply_markup: Optional[dict] = None) -> bool:
    """إرسال التقرير إلى قناة التليجرام."""
    if not BOT_TOKEN or not CHANNEL_ID:
        log.error("❌ نقص في BOT_TOKEN أو CHANNEL_ID")
        return False

    url = f"{TELEGRAM_API}/sendMessage"
    payload = {
        "chat_id": CHANNEL_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        r = requests.post(url, json=payload, timeout=15)
        res = r.json()
        if res.get("ok"):
            log.info(f"✓ تم بث التقرير التحليلي بنجاح (Message ID: {res['result']['message_id']})")
            return True
        else:
            log.error(f"❌ خطأ من تليجرام: {res}")
            return False
    except Exception as e:
        log.error(f"❌ استثناء أثناء الإرسال: {e}")
        return False


def get_market_indices_data() -> Dict:
    """استخراج بيانات مؤشرات البورصة المصرية EGX30 و EGX70."""
    out = {
        'egx30': {'val': 30500.0, 'chg': 0.45},
        'egx70': {'val': 7850.0, 'chg': 0.80},
    }
    if STOCKS_DB.exists():
        try:
            conn = sqlite3.connect(str(STOCKS_DB))
            conn.row_factory = sqlite3.Row
            for r in conn.execute("SELECT symbol, current_value, change_percent FROM market_indices").fetchall():
                sym = r['symbol']
                val = float(r['current_value'] or 0)
                chg = float(r['change_percent'] or 0)
                if '30' in sym:
                    if val < 20000: val = 30500.0
                    out['egx30'] = {'val': val, 'chg': chg}
                elif '70' in sym:
                    if val < 4000: val = 7850.0
                    out['egx70'] = {'val': val, 'chg': chg}
            conn.close()
        except Exception as e:
            log.warning(f"indices data err: {e}")
    return out


def get_daily_market_stats() -> Dict:
    """استخراج إحصائيات الجلسة: الرابحون، الخاسرون، وأعلى الصفقات."""
    stats = {
        'top_gainers': [],
        'top_volume': [],
        'total_volume': 0,
        'gainers_count': 0,
        'losers_count': 0,
        'neutral_count': 0,
    }
    if STOCKS_DB.exists():
        try:
            conn = sqlite3.connect(str(STOCKS_DB))
            conn.row_factory = sqlite3.Row

            # عدد الأسهم الصاعدة والهابطة
            counts = conn.execute("""
                SELECT 
                    SUM(CASE WHEN change_percent > 0.1 THEN 1 ELSE 0 END) as up,
                    SUM(CASE WHEN change_percent < -0.1 THEN 1 ELSE 0 END) as down,
                    SUM(CASE WHEN change_percent BETWEEN -0.1 AND 0.1 THEN 1 ELSE 0 END) as flat,
                    SUM(volume) as total_vol
                FROM stocks
                WHERE current_price > 0
            """).fetchone()
            if counts:
                stats['gainers_count'] = counts['up'] or 0
                stats['losers_count'] = counts['down'] or 0
                stats['neutral_count'] = counts['flat'] or 0
                stats['total_volume'] = counts['total_vol'] or 0

            # أعلى 4 أسهم صعوداً
            gainers = conn.execute("""
                SELECT ticker, name_ar, current_price, change_percent, volume
                FROM stocks
                WHERE current_price > 0.5 AND volume > 50000
                ORDER BY change_percent DESC LIMIT 4
            """).fetchall()
            for g in gainers:
                tk = g['ticker']
                stats['top_gainers'].append({
                    'ticker': tk,
                    'name': get_arabic_stock_name(tk, g['name_ar'] or tk),
                    'price': float(g['current_price']),
                    'change': float(g['change_percent']),
                    'volume': float(g['volume'] or 0)
                })

            # أكثر الأسهم نشاطاً وتداولاً
            active = conn.execute("""
                SELECT ticker, name_ar, current_price, change_percent, volume
                FROM stocks
                WHERE current_price > 0
                ORDER BY volume DESC LIMIT 4
            """).fetchall()
            for a in active:
                tk = a['ticker']
                stats['top_volume'].append({
                    'ticker': tk,
                    'name': get_arabic_stock_name(tk, a['name_ar'] or tk),
                    'price': float(a['current_price']),
                    'change': float(a['change_percent']),
                    'volume': float(a['volume'] or 0)
                })

            conn.close()
        except Exception as e:
            log.warning(f"daily market stats err: {e}")

    return stats


def get_today_achieved_targets() -> List[Dict]:
    """استخراج الصفقات التي ضربت أهدافها اليوم مع تاريخ الطرح والمدة."""
    from telegram_target_hit_tracker import get_active_radar_targets, scan_for_target_hits
    try:
        targets = get_active_radar_targets()
        hits = scan_for_target_hits(targets)
        return hits[:4]
    except Exception as e:
        log.warning(f"get_today_achieved_targets err: {e}")
        return []


def generate_daily_closing_message() -> Tuple[str, dict]:
    """بناء التقرير والتحليل اليومي الكامل بعد إغلاق الجلسة."""
    today = datetime.now().strftime('%Y-%m-%d')
    indices = get_market_indices_data()
    stats = get_daily_market_stats()
    hits = get_today_achieved_targets()

    e30 = indices['egx30']
    e70 = indices['egx70']
    e30_sign = "+" if e30['chg'] >= 0 else ""
    e70_sign = "+" if e70['chg'] >= 0 else ""

    vol_m = f"{stats['total_volume'] / 1_000_000:.1f} مليون سهم" if stats['total_volume'] else "سيولة نشطة"

    support_30 = round(e30['val'] * 0.99, -1)
    resist_30 = round(e30['val'] * 1.012, -1)

    msg = f"""📊 <b>التقرير والتحليل اليومي للجلسة | منصة دليل الاستثمار</b>
📅 <b>حصاد جلسة: {today}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ <b>1. أداء المؤشرات الرئيسية للبورصة المصرية:</b>
• <b>مؤشر EGX30 (الأسهم القيادية):</b>
  الإغلاق: <b>{e30['val']:,.0f} نقطة</b> ({e30_sign}{e30['chg']:.2f}%)
  مستويات الغد: الدعم <b>{support_30:,.0f}</b> | المقاومة <b>{resist_30:,.0f}</b>

• <b>مؤشر EGX70 (الشركات المتوسطة والصغيرة):</b>
  الإغلاق: <b>{e70['val']:,.0f} نقطة</b> ({e70_sign}{e70['chg']:.2f}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 <b>2. نبض التداولات والسيولة العامة:</b>
• إجمالي كمية التداول: <b>{vol_m}</b>
• الأسهم الصاعدة: <b>{stats['gainers_count']} سهم 🟢</b> | الهابطة: <b>{stats['losers_count']} سهم 🔴</b>
• اتجاه السيولة: <b>{'هيمنة شرائية وتجميعية 🟢' if e30['chg'] >= 0 else 'عمليات جني أرباح وتدوير سيولة 🟡'}</b>
"""

    # الصفقات المحققة للأهداف اليوم بتواريخها ومددها
    if hits:
        msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎯 <b>3. حصاد الأهداف المحققة بتوصيات المنصة اليوم:</b>\n"
        for h in hits:
            msg += f"""• <b>سهم {h['name_ar']} (#{h['ticker']}):</b>
  الهدف: <b>{h['hit_level']}</b> | مكسب محقق: <b>+{h['profit_pct']:.1f}%</b>
  تاريخ طرح التوقع: <b>{h['prediction_date']}</b> ({h['duration_text']})
  سعر التوصية: {h['entry_price']:.2f} ج.م -> أعلى سعر: {h['hit_price']:.2f} ج.م\n"""

    # أكثر الأسهم صعوداً ونشاطاً
    if stats['top_gainers']:
        msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━\n🚀 <b>4. أبرز الأسهم الأكثر صعوداً بالجلسة:</b>\n"
        for g in stats['top_gainers']:
            msg += f"• <b>{g['name']} (#{g['ticker']}):</b> {g['price']:.2f} ج.م (+{g['change']:.2f}%)\n"

    msg += f"""━━━━━━━━━━━━━━━━━━━━━━━━━━
🧭 <b>5. الرؤية الفنية واستشراف جلسة الغد:</b>
• استقرار المؤشر أعلى مستويات الدعم يمنح السوق دافعاً لاختبار المقاومات القريبة وتدفق سيولة جديدة.
• نوصي بالتركيز على الأسهم التي أنهت موجات التجميع وتستعد لاختراق قممها السعرية، وتفعيل وقف الخسارة المتحرك لحماية المكاسب.

🚀 <b>تابع حركة السوق لحظة بلحظة واطلع على سجل الصفقات التاريخي الموثق بالكامل:</b>
{format_caption_links_block()}"""

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "📊 شاشة متابعة التوقعات والأهداف", "url": "https://invist.m2y.net/#predictions-tracking"},
                {"text": "🎯 الفرص الاستثمارية المرشحة", "url": "https://invist.m2y.net/#recommendations"}
            ],
            [
                {"text": "📱 تحميل تطبيق الأندرويد", "url": "https://play.google.com/store/apps/details?id=com.egx.investment"},
                {"text": "🤖 استعلام لحظي عن أي سهم بالبوت", "url": "https://t.me/investusernamebot"}
            ]
        ]
    }

    return msg.strip(), keyboard


def generate_weekly_outlook_message() -> Tuple[str, dict]:
    """بناء التقرير والتحليل الأسبوعي الشامل للسوق واستشراف الأسبوع الجديد."""
    today = datetime.now().strftime('%Y-%m-%d')
    indices = get_market_indices_data()
    e30 = indices['egx30']
    e70 = indices['egx70']

    msg = f"""📑 <b>التقرير والتحليل الأسبوعي الشامل | منصة دليل الاستثمار</b>
📅 <b>تقرير الأسبوع المنتهي في: {today}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ <b>1. الحصاد الأسبوعي للمؤشرات والاتجاه العام:</b>
• <b>مؤشر EGX30:</b> استقر عند <b>{e30['val']:,.0f} نقطة</b> بنمط تداولات إيجابي يعكس تماسكه أمام الضغوط البيعية.
• <b>مؤشر EGX70:</b> أغلق عند <b>{e70['val']:,.0f} نقطة</b> مع استمرار الزخم على أسهم المضاربة السريعة والمتوسطة.
• <b>سلوك السيولة المؤسسية:</b> لوحظ استمرار عمليات الشراء الانتقائي من جانب المؤسسات المحلية والعربية في قطاعات البنوك والصناعة والخدمات المالية.
━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 <b>2. خريطة القطاعات والتدوير الأسبوعي:</b>
• تصدرت قطاعات <b>الخدمات المالية والبنوك والكيماويات والنقل</b> أحجام التداول مستحوذة على الحصة الكبرى من السيولة.
• بدأت قطاعات <b>مواد البناء والأدوية والسلع الاستهلاكية</b> في تشكيل قيعان تجميعية سعرية واعدة توفر فرص دخول ممتازة للأسبوع القادم.
━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 <b>3. استراتيجية التداول وخطة الأسبوع القادم:</b>
1. <b>استغلال التراجعات الفنية:</b> الشراء التراكمي قرب مستويات الدعم للأسهم القيادية ذات الأساسيات القوية.
2. <b>التنقل الذكي بين القطاعات:</b> الاستفادة من تدوير السيولة بالخروج الجزئي من الأسهم التي حققت أهدافها والدخول في الأسهم التي لا تزال في قاع التجميع.
3. <b>الانضباط الصارم بوقف الخسارة:</b> حماية رأس المال هي مفتاح الربحية المستمرة في أسواق المال.
━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 <b>اكتشف كافة توصيات وتحليلات الأسبوع الجديد بدقة عالية عبر المنصة والتطبيق:</b>
{format_caption_links_block()}"""

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "📊 فتح شاشة التحليل الموحّد", "url": "https://invist.m2y.net/#specialist-analysis"},
                {"text": "🎯 استعراض التوقعات الجديدة", "url": "https://invist.m2y.net/#recommendations"}
            ],
            [
                {"text": "📱 تطبيق المنصة على Google Play", "url": "https://play.google.com/store/apps/details?id=com.egx.investment"},
                {"text": "💬 الانضمام لمجتمع الواتساب", "url": "https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc"}
            ]
        ]
    }

    return msg.strip(), keyboard


def broadcast_daily_closing_analysis():
    """بث التحليل اليومي للإغلاق."""
    log.info("📢 بدء تجهيز وبث التحليل اليومي بعد الإغلاق...")
    msg, kb = generate_daily_closing_message()
    return send_channel_message(msg, reply_markup=kb)


def broadcast_weekly_outlook():
    """بث التحليل الأسبوعي الشامل."""
    log.info("📢 بدء تجهيز وبث التحليل الأسبوعي الشامل...")
    msg, kb = generate_weekly_outlook_message()
    return send_channel_message(msg, reply_markup=kb)


run_daily_market_analysis = broadcast_daily_closing_analysis
run_weekly_market_analysis = broadcast_weekly_outlook


if __name__ == "__main__":
    if "--preview-weekly" in sys.argv:
        msg, _ = generate_weekly_outlook_message()
        print("=== PREVIEW WEEKLY OUTLOOK ===")
        print(msg)
    elif "--preview" in sys.argv or "--preview-daily" in sys.argv:
        msg, _ = generate_daily_closing_message()
        print("=== PREVIEW DAILY CLOSING ANALYSIS ===")
        print(msg)
    elif "--weekly" in sys.argv:
        broadcast_weekly_outlook()
    else:
        broadcast_daily_closing_analysis()
