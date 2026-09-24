#!/usr/bin/env python3
"""
telegram_interactive_bot.py
===========================
بوت التليجرام التفاعلي الذكي لدليل المستثمر العربي (GLMinvestment) — منافس egxbot.com المطور.
الرد الآلي على استفسارات المتداولين، قائمة اختيار الأسهم الفورية، إرسال شارتات الشموع فائقة الدقة،
وعرض إشارات رادار الميكرز V40.2 مع أزرار تسويقية تفاعلية.
"""

import os
import sys
import json
import time
import asyncio
import sqlite3
import logging
import requests
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# مسارات المشروع
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
DB_DIR = PROJECT_ROOT / "db"
STOCKS_DB = DB_DIR / "stocks.db"
DATA_ENGINE_DB = DB_DIR / "data_engine.db"
PREDICTIONS_DB = DB_DIR / "predictions.db"
NEWS_DB = DB_DIR / "news.db"

# إعداد التسجيل
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger("InteractiveBot")

# قراءة إعدادات البيئة
def load_env():
    for p in [PROJECT_ROOT / '.env', PROJECT_ROOT / 'news-agent' / '.env']:
        if p.exists():
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            break

load_env()
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHANNEL_ID = os.environ.get("TELEGRAM_CHANNEL_ID", "@Arabian_investment_guide")
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
PLATFORM_URL = "https://invist.m2y.net"

# ─────────────────────────────────────────────────────────────────────────────
# لوحات المفاتيح والأزرار الدائمة (Keyboards)
# ─────────────────────────────────────────────────────────────────────────────
MAIN_MENU_KEYBOARD = {
    "keyboard": [
        [
            {"text": "🔍 فحص سهم من القائمة"},
            {"text": "🎯 رادار الميكرز اليوم"}
        ],
        [
            {"text": "🚀 أسهم الانفجار السعري"},
            {"text": "📚 درس اليوم التعليمي"}
        ],
        [
            {"text": "🌐 منصة التحليل المباشر"}
        ]
    ],
    "resize_keyboard": True,
    "persistent": True
}

POPULAR_STOCKS = [
    ("فوري (FWRY)", "FWRY"),
    ("التجاري الدولي (COMI)", "COMI"),
    ("طلعت مصطفى (TMGH)", "TMGH"),
    ("السويدي إليكتريك (SWDY)", "SWDY"),
    ("حديد عز (ESRS)", "ESRS"),
    ("أبو قير للأسمدة (ABUK)", "ABUK"),
    ("بلتون المالية (BTFH)", "BTFH"),
    ("مصر للألومنيوم (EGAL)", "EGAL"),
    ("سيدي كرير (SKPC)", "SKPC"),
    ("بالم هيلز (PHDC)", "PHDC"),
    ("القلعة (CCAP)", "CCAP"),
    ("إيديتا (EFID)", "EFID")
]

ARABIC_ALIASES = {
    "فوري": "FWRY",
    "فوري لتكنولوجيا البنوك": "FWRY",
    "السويدي": "SWDY",
    "السويدى": "SWDY",
    "السويدي اليكتريك": "SWDY",
    "السويدى اليكتريك": "SWDY",
    "طلعت مصطفى": "TMGH",
    "مجموعة طلعت مصطفى": "TMGH",
    "طلعت": "TMGH",
    "التجاري الدولي": "COMI",
    "التجارى الدولى": "COMI",
    "البنك التجاري الدولي": "COMI",
    "سي اي بي": "COMI",
    "سيب": "COMI",
    "ابوقير": "ABUK",
    "ابو قير": "ABUK",
    "أبو قير": "ABUK",
    "ابوقير للاسمدة": "ABUK",
    "سيدي كرير": "SKPC",
    "سيدى كرير": "SKPC",
    "سيدبك": "SKPC",
    "مصر للالومنيوم": "EGAL",
    "مصر للالمونيوم": "EGAL",
    "الالومنيوم": "EGAL",
    "حديد عز": "ESRS",
    "عز الدخيلة": "ESRS",
    "عز": "ESRS",
    "بلتون": "BTFH",
    "بلتون القابضة": "BTFH",
    "بلتون المالية": "BTFH",
    "بالم هيلز": "PHDC",
    "بالم": "PHDC",
    "القلعة": "CCAP",
    "القلعه": "CCAP",
    "شركة القلعة": "CCAP",
    "المصرية للاتصالات": "ETEL",
    "وي": "ETEL",
    "we": "ETEL",
    "ابن سينا": "ISPH",
    "ابن سينا فارما": "ISPH",
    "جهينة": "JUFO",
    "جهينه": "JUFO",
    "مدينة نصر": "MNHD",
    "مدينة مصر": "MNHD",
    "مدينه مصر": "MNHD",
    "مدينة مصر للاسكان": "MNHD",
    "اوراسكوم كونستراكشون": "ORAS",
    "اوراسكوم": "ORAS",
    "اي فاينانس": "EFIH",
    "إي فاينانس": "EFIH",
    "موبكو": "MFPC",
    "مصر لانتاج الاسمدة": "MFPC",
    "اسكندرية للحاويات": "ALCN",
    "الاسكندرية لتداول الحاويات": "ALCN",
    "حاويات": "ALCN",
    "النساجون الشرقيون": "ORWE",
    "النساجون": "ORWE",
    "جي بي اوتو": "AUTO",
    "جي بي كورب": "AUTO",
    "غبور": "AUTO",
    "زهراء المعادي": "ZMID",
    "المطورون العرب": "ARVA",
    "عرب ديفيلوبرز": "ARVA",
    "سبيد ميديكال": "SPMD",
    "سبيد": "SPMD",
    "دايس": "DSCW",
    "كفر الزيات": "KZPC",
    "ام ام جروب": "MTIE",
    "مستشفى كليوباترا": "CLHO",
    "كليوباترا": "CLHO",
    "راميدا": "RMDA",
    "القاهرة للادوية": "CPCI",
    "الاهلي للتنمية": "AFDI",
    "الاهلى": "AFDI",
    "الملتقى العربي": "AMIA",
    "راية القابضة": "RAYA",
    "راية لخدمات مراكز الاتصالات": "RACC",
    "قناة السويس لتوطين التكنولوجيا": "SCTS",
    "فوديكو": "FAIT",
    "دومتي": "DOMT",
    "عبور لاند": "OLFI",
    "مطاحن مصر الوسطى": "CEFM",
    "مطاحن مصر العليا": "UFM",
    "مطاحن شرق الدلتا": "EDFM",
    "مطاحن شمال القاهرة": "MILS",
    "مطاحن الاسكندرية": "AFMC",
    "التعمير والاستشارات": "DAPH",
    "ارابيا انفستمنتس": "AIH",
    "ارابيا": "AIH",
    "العربية لحليج الاقطان": "ACGC",
    "الوادى للاستثمار": "WAHO",
    "اليكو": "AICO",
}

# ─────────────────────────────────────────────────────────────────────────────
# دوال التليجرام الأساسية (Telegram Bot API)
# ─────────────────────────────────────────────────────────────────────────────
def send_message(chat_id: int, text: str, reply_markup: Optional[dict] = None, parse_mode: str = "HTML"):
    """إرسال رسالة نصية مع أزرار تفاعلية."""
    url = f"{TELEGRAM_API}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        r = requests.post(url, json=payload, timeout=10)
        return r.json()
    except Exception as e:
        log.error(f"خطأ في إرسال الرسالة إلى {chat_id}: {e}")
        return None

def send_photo(chat_id: int, photo_path: Path, caption: str, reply_markup: Optional[dict] = None) -> Optional[dict]:
    """إرسال صورة وشارت عالي الدقة مع التسمية التوضيحية والأزرار التفاعلية."""
    url = f"{TELEGRAM_API}/sendPhoto"
    
    # ضمان ألا تتجاوز التسمية 1024 حرفاً حسب قيود تليجرام
    if len(caption) > 1000:
        caption = caption[:995] + "..."

    data = {
        "chat_id": chat_id,
        "caption": caption,
        "parse_mode": "HTML"
    }
    if reply_markup:
        data["reply_markup"] = json.dumps(reply_markup)
        
    try:
        with open(photo_path, 'rb') as f:
            files = {'photo': f}
            r = requests.post(url, data=data, files=files, timeout=25)
            res = r.json()
            if not res.get('ok'):
                log.warning(f"فشل إرسال الصورة عبر sendPhoto: {res}")
            return res
    except Exception as e:
        log.error(f"خطأ في إرسال الصورة إلى {chat_id}: {e}")
        return None

def answer_callback_query(callback_query_id: str, text: str = ""):
    """إغلاق مؤشر الانتظار عند النقر على الأزرار التفاعلية."""
    try:
        requests.post(f"{TELEGRAM_API}/answerCallbackQuery", json={
            "callback_query_id": callback_query_id,
            "text": text
        }, timeout=5)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────────────────────
# محرك البحث عن الأسهم واستخراج البيانات
# ─────────────────────────────────────────────────────────────────────────────
def search_stock(query: str) -> Optional[Dict]:
    """البحث عن السهم بالرمز الإنجليزي أو الاسم العربي الشائع."""
    q = query.strip()
    q_upper = q.upper()

    # 1. مطابقة مباشرة لقاموس الأسماء العربية
    if q in ARABIC_ALIASES:
        q_upper = ARABIC_ALIASES[q]
    else:
        for alias, tk in ARABIC_ALIASES.items():
            if alias in q or q in alias:
                q_upper = tk
                break

    # 2. البحث في stocks.db
    if STOCKS_DB.exists():
        try:
            conn = sqlite3.connect(str(STOCKS_DB))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            row = cur.execute(
                "SELECT * FROM stocks WHERE ticker = ? LIMIT 1", (q_upper,)
            ).fetchone()

            if not row:
                row = cur.execute(
                    "SELECT * FROM stocks WHERE ticker LIKE ? OR name_ar LIKE ? OR name LIKE ? LIMIT 1",
                    (f"%{q_upper}%", f"%{q}%", f"%{q}%")
                ).fetchone()

            if row:
                d = dict(row)
                conn.close()
                return {
                    'symbol': d.get('ticker') or d.get('symbol', q_upper),
                    'name_ar': d.get('name_ar') or d.get('name') or q_upper,
                    'name_en': d.get('name') or q_upper,
                    'price': float(d.get('current_price') or d.get('close_price') or 0),
                    'change': float(d.get('change_percent') or d.get('change') or 0),
                    'open': float(d.get('open_price') or 0),
                    'high': float(d.get('high_price') or 0),
                    'low': float(d.get('low_price') or 0),
                    'volume': int(d.get('volume') or 0),
                    'market': 'EGX'
                }
            conn.close()
        except Exception as e:
            log.warning(f"خطأ في البحث في stocks.db: {e}")

    # 3. البحث في data_engine.db
    if DATA_ENGINE_DB.exists():
        try:
            conn = sqlite3.connect(str(DATA_ENGINE_DB))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            row = cur.execute(
                "SELECT * FROM stock_prices WHERE symbol = ? OR symbol LIKE ? LIMIT 1",
                (q_upper, f"%{q_upper}%")
            ).fetchone()
            if row:
                d = dict(row)
                conn.close()
                return {
                    'symbol': d.get('symbol', q_upper),
                    'name_ar': d.get('name', q_upper),
                    'name_en': d.get('name', q_upper),
                    'price': float(d.get('price') or d.get('close') or 0),
                    'change': float(d.get('change_percent') or 0),
                    'volume': int(d.get('volume') or 0),
                    'market': 'EGX'
                }
            conn.close()
        except Exception as e:
            log.warning(f"خطأ في البحث في data_engine.db: {e}")

    return None

def get_stock_radar_status(symbol: str) -> Dict:
    """استخراج إشارات رادار الميكرز V40.2 ومستويات الأهداف من predictions.db وملفات الرادار."""
    radar_info = {
        'signal': 'مراقبة هادئة',
        'confidence': 65,
        'entry': 0.0,
        'target_1': 0.0,
        'target_2': 0.0,
        'stop_loss': 0.0,
        'vol_ratio': 1.2,
        'direction': 'تجميع صاعد مع الميكر'
    }

    if PREDICTIONS_DB.exists():
        try:
            conn = sqlite3.connect(str(PREDICTIONS_DB))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            row = cur.execute("""
                SELECT signal, confidence, target_price, target_price_2, stop_loss, entry_price, vol_ratio_now, direction
                FROM predictions
                WHERE ticker = ?
                ORDER BY id DESC LIMIT 1
            """, (symbol,)).fetchone()

            if row:
                d = dict(row)
                radar_info['signal'] = d.get('signal') or 'ACCUMULATE'
                radar_info['confidence'] = int(d.get('confidence') or 65)
                radar_info['entry'] = float(d.get('entry_price') or 0)
                radar_info['target_1'] = float(d.get('target_price') or 0)
                radar_info['target_2'] = float(d.get('target_price_2') or 0)
                radar_info['stop_loss'] = float(d.get('stop_loss') or 0)
                radar_info['vol_ratio'] = float(d.get('vol_ratio_now') or 1.2)
                radar_info['direction'] = d.get('direction') or 'تجميع صاعد مع الميكر'
            conn.close()
        except Exception as e:
            log.warning(f"خطأ قراءة predictions.db: {e}")

    return radar_info

def build_stock_card(stock: Dict, radar: Dict) -> Tuple[str, dict]:
    """بناء التسمية التوضيحية للشارت المصور والأزرار التفاعلية."""
    sym = stock['symbol']
    name = stock['name_ar']
    price = stock['price']
    chg = stock['change']

    chg_icon = "🟢 +" if chg >= 0 else "🔴 "
    chg_str = f"{chg_icon}{abs(chg):.2f}%"

    raw_tp1 = float(radar.get('target_1') or 0)
    raw_tp2 = float(radar.get('target_2') or 0)
    raw_sl = float(radar.get('stop_loss') or 0)

    # حماية من البيانات الشاذة والتجزئات غير المعدلة (منع أهداف فلكية مثل +1400%)
    if price > 0 and raw_tp1 > price and raw_tp1 <= price * 1.25:
        tp1 = raw_tp1
    else:
        tp1 = (price * 1.06) if price > 0 else 0

    if price > 0 and raw_tp2 > tp1 and raw_tp2 <= price * 1.35:
        tp2 = raw_tp2
    else:
        tp2 = (tp1 * 1.06) if tp1 > 0 else 0

    if price > 0 and raw_sl < price and raw_sl >= price * 0.88:
        sl = raw_sl
    else:
        sl = (price * 0.95) if price > 0 else 0

    tp1_gain = ((tp1 - price) / price * 100) if price > 0 else 0
    tp2_gain = ((tp2 - price) / price * 100) if price > 0 else 0
    sl_loss = ((price - sl) / price * 100) if price > 0 else 0

    msg = f"""📊 <b>سهم {sym} — {name}</b>
━━━━━━━━━━━━━━━━━━━
💰 <b>السعر الحالي:</b> {price:,.2f} ج.م ({chg_str})
🎯 <b>الهدف الأول (TP1):</b> {tp1:,.2f} ج.م (+{tp1_gain:.1f}%)
🚀 <b>الهدف الثاني (TP2):</b> {tp2:,.2f} ج.م (+{tp2_gain:.1f}%)
🛡️ <b>وقف الخسارة (SL):</b> {sl:,.2f} ج.م (-{sl_loss:.1f}%)
━━━━━━━━━━━━━━━━━━━
🔍 <b>رادار الميكرز V40.2:</b>
• الحالة: {radar['signal']} (ثقة {radar['confidence']}%)
• المسار: {radar['direction']}

💡 <i>تم رصد مستويات السيولة التجميعية بواسطة الذكاء الاصطناعي.</i>"""

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "📊 فتح الشارت الحي على المنصة", "url": "https://invist.m2y.net/#trading-chart"},
                {"text": "🎯 رادار الميكرز", "url": "https://invist.m2y.net/#recommendations"}
            ],
            [
                {"text": "🔍 فحص سهم آخر من القائمة", "callback_data": "action:show_stock_menu"},
                {"text": "⭐ تفعيل التنبيهات الحية", "url": "https://invist.m2y.net/#subscription"}
            ]
        ]
    }

    return msg.strip(), keyboard

def send_stock_analysis_response(chat_id: int, stock: Dict):
    """توليد صورة الشارت وإرسالها مع التحليل الكامل للمستخدم."""
    radar = get_stock_radar_status(stock['symbol'])
    msg, kb = build_stock_card(stock, radar)

    # 1. إشعار فوري بأن الشارت جاري رسمه
    wait_msg = send_message(chat_id, f"⏳ جاري رسم شارت <b>{stock['symbol']}</b> وفحص مستويات الميكرز...", reply_markup=None)
    wait_msg_id = wait_msg.get('result', {}).get('message_id') if wait_msg else None

    # 2. رسم الشارت فائق الدقة
    photo_sent = False
    try:
        from telegram_chart_generator import generate_stock_chart_image
        chart_path = asyncio.run(generate_stock_chart_image(stock['symbol']))
        if chart_path and Path(chart_path).exists():
            r = send_photo(chat_id, Path(chart_path), msg, reply_markup=kb)
            if r and r.get('ok'):
                photo_sent = True
    except Exception as e:
        log.warning(f"تعذر رسم شارت {stock['symbol']}: {e}")

    # 3. مسح رسالة الانتظار
    if wait_msg_id:
        try:
            requests.post(f"{TELEGRAM_API}/deleteMessage", json={"chat_id": chat_id, "message_id": wait_msg_id}, timeout=5)
        except Exception:
            pass

    # 4. إذا فشلت الصورة نرسل التحليل كنص أنيق
    if not photo_sent:
        send_message(chat_id, msg, reply_markup=kb)

# ─────────────────────────────────────────────────────────────────────────────
# معالجة الأوامر والقوائم التفاعلية
# ─────────────────────────────────────────────────────────────────────────────
def send_stock_picker_menu(chat_id: int):
    """إرسال شبكة تفاعلية تضم أشهر أسهم البورصة المصرية بنقرة واحدة."""
    buttons = []
    for i in range(0, len(POPULAR_STOCKS), 2):
        row = []
        name1, sym1 = POPULAR_STOCKS[i]
        row.append({"text": name1, "callback_data": f"stock:{sym1}"})
        if i + 1 < len(POPULAR_STOCKS):
            name2, sym2 = POPULAR_STOCKS[i+1]
            row.append({"text": name2, "callback_data": f"stock:{sym2}"})
        buttons.append(row)

    buttons.append([
        {"text": "🎯 أسهم رادار الميكرز النشطة الآن", "callback_data": "action:show_radar_picks"}
    ])

    menu_text = """🔍 <b>اختر السهم المراد تحليله من القائمة:</b>

أو اكتب اسم أي سهم تريده في رسالة مباشرة (مثال: <code>جهينة</code>، <code>إي فاينانس</code>، <code>حديد عز</code>، <code>SWDY</code>)."""

    send_message(chat_id, menu_text, reply_markup={"inline_keyboard": buttons})

def handle_start(chat_id: int, user_name: str = ""):
    """الرد على أمر /start مع إظهار القائمة الدائمة فوراً."""
    welcome = f"""مرحباً بك يا <b>{user_name or 'صديقنا المتداول'}</b> في <b>دليل المستثمر العربي</b> 📈!

🤖 <b>البوت الآلي الأول لرصد صناع السوق (الميكرز) بالبورصة المصرية V40.2.</b>

🔍 <b>ماذا يمكنني أن أقدم لك؟</b>
• <b>شارتات شموع يابانية فورية</b> لكل أسهم البورصة المصرية.
• <b>كشف التجميع السري</b> للميكرز قبل حدوث الانفجار السعري.
• <b>تحديد دقيق للأهداف</b>: الهدف 1، الهدف 2، ووقف الخسارة المحسوب رياضياً.
• <b>دروس تعليمية يومية مصورة</b> لاحتراف التداول وقراءة السيولة الذكية.

👇 <b>اختر من القائمة أدناه أو اكتب اسم سهمك فوراً:</b>"""

    send_message(chat_id, welcome.strip(), reply_markup=MAIN_MENU_KEYBOARD)

def handle_radar_command(chat_id: int):
    """عرض أعلى أسهم رادار الميكرز النشطة حالياً كأزرار مباشرة."""
    candidates = []
    if PREDICTIONS_DB.exists():
        try:
            conn = sqlite3.connect(str(PREDICTIONS_DB))
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT ticker, signal, confidence, target_price, stop_loss
                FROM predictions
                WHERE signal IN ('STRONG_BUY', 'BUY', 'ACCUMULATE')
                ORDER BY id DESC LIMIT 5
            """).fetchall()
            for r in rows:
                candidates.append(dict(r))
            conn.close()
        except Exception as e:
            log.warning(f"خطأ في قراءة رادار الميكرز: {e}")

    if not candidates:
        send_message(chat_id, "ℹ️ جاري تحديث مسح رادار الميكرز للجلسة القادمة، يرجى المحاولة بعد قليل.", reply_markup=MAIN_MENU_KEYBOARD)
        return

    buttons = []
    text_lines = ["🎯 <b>أبرز فرص رادار الميكرز تحت المجهر اليوم:</b>\n"]
    for c in candidates:
        tk = c['ticker']
        conf = c['confidence'] or 70
        sig = c['signal']
        text_lines.append(f"▪️ <b>{tk}</b> — ثقة {conf}% ({sig})")
        buttons.append([{"text": f"📊 تحليل وشارت {tk}", "callback_data": f"stock:{tk}"}])

    buttons.append([{"text": "🌐 فتح شاشة الرادار الكاملة", "url": "https://invist.m2y.net/#recommendations"}])

    text_lines.append("\n👇 <b>اضغط على أي سهم لاستعراض شارت الشموع وأهدافه فوراً:</b>")
    send_message(chat_id, "\n".join(text_lines), reply_markup={"inline_keyboard": buttons})

def handle_daily_lesson_command(chat_id: int):
    """إرسال الدرس التعليمي اليومي المصور للمستخدم."""
    try:
        from telegram_daily_lessons import LESSONS_CURRICULUM, generate_lesson_image, format_telegram_lesson_caption, load_lesson_state
        state = load_lesson_state()
        idx = state.get('current_index', 0) % len(LESSONS_CURRICULUM)
        lesson = LESSONS_CURRICULUM[idx]

        img_path = asyncio.run(generate_lesson_image(lesson))
        caption = format_telegram_lesson_caption(lesson)

        kb = {
            "inline_keyboard": [
                [{"text": "🎯 فتح رادار الميكرز وتطبيق الدرس", "url": "https://invist.m2y.net/#recommendations"}],
                [{"text": "🔍 فحص سهم من القائمة", "callback_data": "action:show_stock_menu"}]
            ]
        }

        if img_path and Path(img_path).exists():
            send_photo(chat_id, Path(img_path), caption, reply_markup=kb)
        else:
            send_message(chat_id, caption, reply_markup=kb)
    except Exception as e:
        log.error(f"خطأ إرسال الدرس التعليمي: {e}")
        send_message(chat_id, "⚠️ جاري إعداد الدرس اليومي، يرجى المحاولة بعد قليل.")

# ─────────────────────────────────────────────────────────────────────────────
# موزع التحديثات الرئيسي (Update Dispatcher)
# ─────────────────────────────────────────────────────────────────────────────
def process_update(update: dict):
    """معالجة كافة أنواع التحديثات (نصوص، أزرار، وأوامر)."""
    
    # 1. معالجة النقرات على الأزرار التفاعلية (Callback Queries)
    if "callback_query" in update:
        cb = update["callback_query"]
        cb_id = cb.get("id")
        data = cb.get("data", "")
        chat_id = cb.get("message", {}).get("chat", {}).get("id")

        answer_callback_query(cb_id)
        if not chat_id:
            return

        if data.startswith("stock:"):
            symbol = data.split(":", 1)[1]
            stock = search_stock(symbol)
            if stock:
                send_stock_analysis_response(chat_id, stock)
            else:
                send_message(chat_id, f"عفواً، لم أتمكن من تحميل بيانات السهم: {symbol}")
        elif data == "action:show_stock_menu":
            send_stock_picker_menu(chat_id)
        elif data == "action:show_radar_picks":
            handle_radar_command(chat_id)
        return

    # 2. معالجة الرسائل النصية
    message = update.get("message")
    if not message:
        return

    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "").strip()
    user_name = message.get("from", {}).get("first_name", "")

    if not chat_id or not text:
        return

    log.info(f"رسالة واردة من {chat_id} ({user_name}): {text}")

    # الأوامر والأزرار الدائمة
    if text in ("/start", "/help", "بدء"):
        handle_start(chat_id, user_name)
    elif text in ("🔍 فحص سهم من القائمة", "/list", "قائمة الاسهم", "الاسهم"):
        send_stock_picker_menu(chat_id)
    elif text in ("🎯 رادار الميكرز اليوم", "/radar", "الرادار"):
        handle_radar_command(chat_id)
    elif text in ("🚀 أسهم الانفجار السعري", "انفجار"):
        handle_radar_command(chat_id)
    elif text in ("📚 درس اليوم التعليمي", "/lesson", "الدروس", "درس اليوم"):
        handle_daily_lesson_command(chat_id)
    elif text in ("🌐 منصة التحليل المباشر", "المنصة", "الموقع"):
        send_message(
            chat_id,
            "🌐 <b>رابط منصة التحليل المباشر ودليل المستثمر:</b>\n👉 https://invist.m2y.net/#dashboard",
            reply_markup=MAIN_MENU_KEYBOARD
        )
    else:
        # البحث عن اسم أو رمز السهم المكتوب
        stock = search_stock(text)
        if stock:
            send_stock_analysis_response(chat_id, stock)
        else:
            not_found_msg = f"""عفواً، لم أتعرف على السهم: <b>{text}</b> 🔍

💡 <b>يمكنك:</b>
1. اختيار السهم مباشرة من القائمة أدناه.
2. أو كتابة الرمز مثل: <code>COMI</code> أو <code>FWRY</code> أو <code>SWDY</code>
3. أو كتابة الاسم العربي مثل: <code>فوري</code> أو <code>طلعت مصطفى</code> أو <code>السويدي</code>"""
            
            send_message(chat_id, not_found_msg.strip(), reply_markup=MAIN_MENU_KEYBOARD)
            send_stock_picker_menu(chat_id)

def run_polling():
    """تشغيل البوت في وضع الاستقبال المستمر (Long Polling)."""
    log.info("🚀 بدء تشغيل بوت التليجرام التفاعلي الذكي (Interactive Bot)...")
    offset = 0

    while True:
        try:
            url = f"{TELEGRAM_API}/getUpdates?offset={offset}&timeout=20"
            r = requests.get(url, timeout=25)
            data = r.json()

            if data.get("ok"):
                updates = data.get("result", [])
                for upd in updates:
                    offset = upd["update_id"] + 1
                    process_update(upd)
            else:
                time.sleep(2)
        except Exception as e:
            log.error(f"خطأ في استقبال التحديثات: {e}")
            time.sleep(5)

if __name__ == "__main__":
    test_query = None
    for arg in sys.argv:
        if arg.startswith("--test-query="):
            test_query = arg.split("=")[1]
        elif arg == "--test-query" and sys.argv.index(arg) + 1 < len(sys.argv):
            test_query = sys.argv[sys.argv.index(arg) + 1]

    if test_query:
        print(f"🔎 اختبار البحث عن: '{test_query}'...")
        res = search_stock(test_query)
        if res:
            radar_res = get_stock_radar_status(res['symbol'])
            card_msg, card_kb = build_stock_card(res, radar_res)
            print("\n--- البطاقة المولدة ---")
            print(card_msg)
            print("الأزرار التفاعلية:", json.dumps(card_kb, ensure_ascii=False, indent=2))
        else:
            print("❌ لم يتم العثور على السهم")
        sys.exit(0)

    run_polling()
