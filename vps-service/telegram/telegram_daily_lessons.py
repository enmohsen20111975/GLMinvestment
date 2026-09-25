#!/usr/bin/env python3
"""
telegram_daily_lessons.py — أكاديمية رادار الميكرز | الدروس التعليمية اليومية المصورة
===================================================================================
يقوم ببث درس تعليمي كامل وتطبيقي يومياً على قناة التليجرام مع:
  1. شرح عميق لأسرار صناع السوق (Market Makers)، السيولة الذكية (SMC)، ونماذج وايكوف (Wyckoff).
  2. أمثلة عملية واقعية من البورصة المصرية (EGX).
  3. بطاقة إنفوجرافيك بصرية مبهرة وعالية الدقة (1080×1080) مصممة خصيصاً لكل درس عبر Playwright.
  4. أزرار تفاعلية وروابط مباشرة للتطبيق العملي عبر البوت والمنصة.
  5. تتبع تقدم الدروس دورياً (من الدرس 1 حتى 30) مع جدولة يومية منتظمة.

الاستخدام:
  python3 telegram_daily_lessons.py --now         # نشر الدرس الحالي مباشرة للقناة
  python3 telegram_daily_lessons.py --lesson 1    # نشر درس محدد بالرقم
  python3 telegram_daily_lessons.py --preview     # معاينة الدرس وتوليد الصورة بدون إرسال
  python3 telegram_daily_lessons.py --list        # عرض قائمة الـ 30 درساً
"""

import os
import sys
import json
import asyncio
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STATE_FILE = Path(__file__).resolve().parent / 'daily_lesson_state.json'
OUTPUT_LESSONS_DIR = PROJECT_ROOT / 'public' / 'lessons'
OUTPUT_LESSONS_DIR.mkdir(parents=True, exist_ok=True)

# الروابط الرسمية
OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net/#dashboard',
    'radar_url': 'https://invist.m2y.net/#recommendations',
    'academy_url': 'https://invist.m2y.net/#academy',
    'bot': 'https://t.me/investusernamebot',
    'channel': 'https://t.me/Arabian_investment_guide'
}

def load_env():
    env_file = PROJECT_ROOT / '.env'
    if env_file.exists():
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    val = v.strip().strip('"').strip("'")
                    if not os.environ.get(k.strip()):
                        os.environ[k.strip()] = val

load_env()
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHANNEL_ID = os.environ.get('TELEGRAM_CHANNEL_ID', '@Arabian_investment_guide')

# ─────────────────────────────────────────────────────────────────────────────
# المنهج التعليمي الشامل (30 درساً احترافياً لمجتمع المتداولين)
# ─────────────────────────────────────────────────────────────────────────────
LESSONS_CURRICULUM = [
    {
        "id": 1,
        "title": "كيف يجمع صانع السوق (الميكر) الأسهم بدون لفت الانتباه؟",
        "subtitle": "مرحلة التجميع الهادئ (Quiet Accumulation) وخريطة وايكوف",
        "badge": "سيكولوجية الميكر",
        "icon": "🕵️‍♂️",
        "summary": "الميكر لا يشتري دفعة واحدة حتى لا يقفز السعر، بل يبتلع المعروض في نطاق عرضي ضيق على مدار أسابيع مع تجفيف أحجام التداول.",
        "key_points": [
            "تذبذب سعري ضيق وممل لدفع صغار المتداولين للاستسلام والبيع.",
            "انخفاض حاد في حجم التداول اليومي مقارنة بمتوسط 20 يوماً.",
            "صفقات شراء مخفية بأحجام صغيرة متكررة عند قيعان النطاق.",
            "كيف يكشفه رادار الميكرز: تبويب (التحضير والتجميع الهادئ) بنسبة Buy Pct مرتفعة."
        ],
        "egx_example": "ما حدث في سهم فوري (FWRY) ومصر للأسمنت في فترات التجميع قبل الانفجار بنسبة +25%.",
        "golden_rule": "لا تطارد السهم بعد أن يقفز 20%، بل ركز في الأسهم التي تجلس في مرحلة التجميع وتنتظر شرارة الانطلاق!"
    },
    {
        "id": 2,
        "title": "الفرق الجوهري بين السيولة الحقيقية والتدوير الوهمي",
        "subtitle": "كيف تميز فخاخ التدوير (Churning Traps) من الدخول المؤسسي الحقيقي؟",
        "badge": "تحليل السيولة الذكية",
        "icon": "⚖️",
        "summary": "ليس كل حجم تداول ضخم يعني صعوداً! قد يقوم الميكر بنقل الأسهم بين محافظه (تدوير) لإيهام السوق بوجود زخم للشراء ثم التصريف.",
        "key_points": [
            "التدوير الوهمي: حجم تداول عملاق بدون تقدم سعري حقيقي (شمعة دوجي أو ذات ذيل علوي طويل).",
            "الشراء الحقيقي: حجم تداول متصاعد يرافقه إغلاق قوي قرب أعلى سعر للجلسة (Close near High).",
            "مؤشر OBV و Chaikin Money Flow: هل السيولة تدخل للمحافظ أم تخرج؟",
            "نظام الحماية في رادار الميكرز: يُفعّل زر الإلغاء (Kill Switch) تلقائياً عند اكتشاف التدوير الوهمي."
        ],
        "egx_example": "سهم مضاربي ينفذ 50 مليون سهم في جلسة واحدة والسعر يغلق دون تغيير يذكر — هذا تدوير تصريفي صريح!",
        "golden_rule": "راقب علاقة السعر بالحجم؛ فإذا كان الفوليوم يصرخ والسعر لا يتحرك، فهناك فخ يُنصب!"
    },
    {
        "id": 3,
        "title": "مصيدة السيولة (Liquidity Trap) وكسر القيعان الوهمي",
        "subtitle": "لماذا يرتفع السهم بقوة فور ضرب وقف خسارتك مباشرة؟",
        "badge": "هندسة الأوامر",
        "icon": "🪤",
        "summary": "صناع السوق يعرفون أين يضع المتداولون نقاط وقف الخسارة (أسفل الدعوم الواضحة)، فيهبطون بالسعر عمداً لتفعيلها وابتلاع كمياتكم الرخيصة.",
        "key_points": [
            "الكسر الوهمي (Spring / Shakeout): كسر دعم سابق بشمعة سريعة ثم العودة والإغلاق أعلاه.",
            "الميكر يحتاج إلى أوامر بيع ضخمة ليشتري هو دون أن يرفع السعر (أوامر الوقف توفر له ذلك).",
            "إشارة الدخول الذكية: الدخول بعد استعادة الدعم المكسور وليس عند كسر الدعم.",
            "كيف يعالجها الرادار: تحديد وقف الخسارة (SL) بناءً على مستويات تقلب حقيقية (ATR) وليس عند القيعان المكشوفة."
        ],
        "egx_example": "سهم حديد عز أو السويدي يكسر دعماً تاريخياً بجنيه واحد في أول نصف ساعة، ثم ينفجر صعوداً بنهاية الجلسة!",
        "golden_rule": "لا تضع وقف خسارتك عند القيعان الأكثر وضوحاً للجميع، فالميكر يبحث عن السيولة المجمعة هناك أولاً!"
    },
    {
        "id": 4,
        "title": "استراتيجية ما قبل الانفجار السعري (Pre-Surge Setup)",
        "subtitle": "التقاط الأسهم في اللحظة التي تسبق الانطلاق الصاروخي بيوم أو يومين",
        "badge": "اقتناص الفرص",
        "icon": "🚀",
        "summary": "تحديد المعادلة الرياضية التي تجمع بين اكتمال التجميع، اختناق البولنجر، وبدء تسلل السيولة المؤسسية لاقتناص الحركة من مهدها.",
        "key_points": [
            "انضغاط النطاق السعري (Bollinger Bands Squeeze) لأدنى مستوى في 30 يوماً.",
            "ارتفاع نسبة الشراء اللحظي فوق 65% مع ثبات السعر.",
            "ظهور إشارة كسر أولي (Early Break) مع حجم تداول 1.5x إلى 2x المتوسط.",
            "تبويب رادار الميكرز: استهداف أسهم Pre-Surge يمنحك أفضل نسبة عائد إلى مخاطرة (Risk/Reward > 1:3)."
        ],
        "egx_example": "سهم طلعت مصطفى (TMGH) حين انضغط تذبذبه في نطاق ضيق قبل موجة الصعود التاريخية.",
        "golden_rule": "الهدوء الشديد الذي يعقب فترة تجميع هو الهدوء الذي يسبق عاصفة الصعود!"
    },
    {
        "id": 5,
        "title": "قاعدة الـ 2% الذهبية: كيف تضمن استمرارية محفظتك للأبد؟",
        "subtitle": "إدارة المخاطر وحجم الصفقة (Position Sizing) التي تفصل المحترف عن الهاوي",
        "badge": "إدارة رأس المال",
        "icon": "🛡️",
        "summary": "أعظم استراتيجية تحليل في العالم ستفشل إذا خاطرت بنصف محفظتك في سهم واحد. لا تخاطر بأكثر من 1% إلى 2% من إجمالي رأس مالك في الصفقة الواحدة.",
        "key_points": [
            "الفرق بين حجم الصفقة (Position Size) وحجم المخاطرة (Dollar Risk).",
            "إذا كانت محفظتك 100,000 ج.م، فأقصى خسارة مسموح بها في أي صفقة هي 2,000 ج.م فقط.",
            "حساب حجم الكمية: الكمية = (أقصى مخاطرة) ÷ (سعر الدخول - سعر وقف الخسارة).",
            "بهذه القاعدة، حتى لو خسرت 5 صفقات متتالية، ستظل محفظتك محتفظة بـ 90% من قيمتها وجاهزة للتعويض."
        ],
        "egx_example": "المتداول الذي دخل بكامل السيولة في سهم واحد وهبط به 20% خسر خمس محفظته، بينما الملتزم بقاعدة 2% لم تتأثر محفظته إلا بـ 1.5%.",
        "golden_rule": "ركز على حماية رأس مالك أولاً، وستتكفل الأرباح بالعناية بنفسها تلقائياً!"
    }
]

def load_lesson_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {'current_index': 0, 'last_sent_date': None, 'history': []}

def save_lesson_state(state: dict):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ خطأ حفظ حالة الدروس: {e}")

def render_lesson_card_html(lesson: Dict) -> str:
    """بناء HTML عالي الاحترافية لبطاقة الدرس التعليمية."""
    points_html = "".join([f"""
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;">
        <span style="color:#10b981;font-size:20px;font-weight:900;line-height:1.2;">✓</span>
        <span style="color:#cbd5e1;font-size:18px;line-height:1.5;">{p}</span>
      </div>
    """ for p in lesson['key_points']])

    return f"""
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{
      font-family: 'Cairo', sans-serif;
      background: #06110e;
      width: 1080px;
      height: 1080px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 36px;
      overflow: hidden;
    }}
    .top-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #14352b;
      padding-bottom: 20px;
    }}
    .academy-badge {{
      background: linear-gradient(135deg, #10b981 0%, #047857 100%);
      color: #ffffff;
      font-size: 16px;
      font-weight: 800;
      padding: 6px 18px;
      border-radius: 30px;
      letter-spacing: 0.5px;
    }}
    .lesson-tag {{
      color: #d4af37;
      font-size: 18px;
      font-weight: 700;
    }}
    .header-content {{
      margin-top: 24px;
    }}
    .lesson-title {{
      font-size: 32px;
      font-weight: 900;
      color: #ffffff;
      line-height: 1.35;
      margin-bottom: 8px;
    }}
    .lesson-sub {{
      font-size: 18px;
      color: #34d399;
      font-weight: 600;
    }}
    .main-box {{
      background: rgba(15, 38, 32, 0.6);
      border: 1px solid #1b493c;
      border-radius: 20px;
      padding: 24px 28px;
      margin: 20px 0;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }}
    .summary-text {{
      font-size: 20px;
      line-height: 1.6;
      color: #f1f5f9;
      margin-bottom: 20px;
      background: rgba(16, 185, 129, 0.1);
      padding: 14px 20px;
      border-radius: 12px;
      border-right: 4px solid #10b981;
    }}
    .egx-box {{
      background: rgba(212, 175, 55, 0.08);
      border: 1px dashed #d4af37;
      border-radius: 14px;
      padding: 14px 20px;
      margin-top: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .golden-box {{
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(185, 28, 28, 0.25) 100%);
      border: 1px solid #ef4444;
      border-radius: 16px;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }}
    .footer {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #14352b;
      padding-top: 18px;
      font-size: 15px;
      color: #94a3b8;
    }}
  </style>
</head>
<body>

  <!-- شريط العنوان -->
  <div class="top-bar">
    <div class="academy-badge">🎓 أكاديمية رادار الميكرز</div>
    <div class="lesson-tag">الدرس {lesson['id']} من 30 • {lesson['badge']}</div>
  </div>

  <!-- عنوان الدرس -->
  <div class="header-content">
    <div class="lesson-title">{lesson['icon']} {lesson['title']}</div>
    <div class="lesson-sub">{lesson['subtitle']}</div>
  </div>

  <!-- المحتوى الرئيسي والأسرار التطبيقية -->
  <div class="main-box">
    <div class="summary-text">
      💡 <b>الفكرة الجوهرية:</b> {lesson['summary']}
    </div>
    <div style="margin-top:10px;">
      {points_html}
    </div>
    
    <!-- مثال البورصة المصرية -->
    <div class="egx-box">
      <span style="font-size:24px;">🇪🇬</span>
      <div>
        <b style="color:#d4af37;font-size:16px;">تطبيق واقعي من البورصة المصرية:</b>
        <div style="color:#cbd5e1;font-size:15px;margin-top:2px;">{lesson['egx_example']}</div>
      </div>
    </div>
  </div>

  <!-- القاعدة الذهبية -->
  <div class="golden-box">
    <span style="font-size:30px;">⭐</span>
    <div>
      <b style="color:#fca5a5;font-size:16px;">القاعدة الذهبية لصناع السوق:</b>
      <div style="color:#ffffff;font-size:17px;font-weight:700;margin-top:2px;">
        "{lesson['golden_rule']}"
      </div>
    </div>
  </div>

  <!-- التذييل -->
  <div class="footer">
    <div style="color:#10b981;font-weight:700;">
      ⚡ منصة الاستثمار الذكي: invist.m2y.net
    </div>
    <div>
      ✈️ تليجرام: @Arabian_investment_guide | 🤖 بوت الاستعلام: @investusernamebot
    </div>
  </div>

</body>
</html>
"""

async def generate_lesson_image(lesson: Dict) -> Optional[Path]:
    """توليد صورة إنفوجرافيك تعليمية كاملة للدرس باستخدام Playwright."""
    html = render_lesson_card_html(lesson)
    out_file = OUTPUT_LESSONS_DIR / f"lesson_{lesson['id']}_{datetime.now().strftime('%Y%m%d')}.png"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={'width': 1080, 'height': 1080}, device_scale_factor=2)
            await page.set_content(html, wait_until='networkidle')
            await page.screenshot(path=str(out_file), type='png')
            await browser.close()
        print(f"✅ تم إنشاء إنفوجرافيك الدرس بنجاح: {out_file}")
        return out_file
    except Exception as e:
        print(f"❌ خطأ توليد صورة الدرس: {e}")
        return None

def format_telegram_lesson_caption(lesson: Dict) -> str:
    """صياغة نص الدرس التعليمي المرافق للصورة بحيث يكون مكثفاً وأقل من 1000 حرف."""
    points_text = "\n".join([f"  ▫️ {p}" for p in lesson['key_points'][:3]])
    
    caption = f"""📚 <b>أكاديمية رادار الميكرز | الدرس ({lesson['id']})</b>
━━━━━━━━━━━━━━━━━━━
🎯 <b>{lesson['title']}</b>
✨ <i>{lesson['subtitle']}</i>

💡 <b>الفكرة الأساسية:</b> {lesson['summary']}

🔍 <b>أسرار التطبيق الميداني:</b>
{points_text}

🇪🇬 <b>مثال حي:</b> {lesson['egx_example']}

⭐ <b>القاعدة الذهبية:</b>
«{lesson['golden_rule']}»
━━━━━━━━━━━━━━━━━━━
👇 <b>افحص سهمك الآن وتأكد من حركة الميكر:</b>
👉 @investusernamebot"""

    if len(caption) > 1000:
        caption = caption[:995] + "..."
    return caption

def send_telegram_photo(photo_path: Path, caption: str) -> bool:
    """إرسال الصورة التعليمية مع النص والأزرار التفاعلية إلى القناة."""
    if not TELEGRAM_BOT_TOKEN:
        print("❌ TELEGRAM_BOT_TOKEN غير مضبوط!")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "🎯 فتح رادار الميكرز وتطبيق الدرس", "url": OFFICIAL_LINKS['radar_url']},
                {"text": "🤖 فحص سهمك الآن عبر البوت", "url": OFFICIAL_LINKS['bot']}
            ],
            [
                {"text": "🌐 منصة التحليل المباشر", "url": OFFICIAL_LINKS['website']}
            ]
        ]
    }

    if len(caption) > 1000:
        caption = caption[:995] + "..."

    # استخدام requests لإرسال multipart مضمون وموثوق
    try:
        import requests
        with open(photo_path, 'rb') as f:
            r = requests.post(
                url,
                data={
                    'chat_id': TELEGRAM_CHANNEL_ID,
                    'caption': caption,
                    'parse_mode': 'HTML',
                    'reply_markup': json.dumps(keyboard)
                },
                files={'photo': f},
                timeout=30
            )
            res = r.json()
            if res.get('ok'):
                return True
            else:
                print(f"❌ خطأ تليجرام في إرسال الصورة: {res}")
                return False
    except Exception as e:
        print(f"❌ خطأ شبكة أثناء إرسال الصورة: {e}")
        return False

def run_daily_lesson(lesson_id: Optional[int] = None, preview: bool = False, force: bool = False):
    print("=" * 60)
    print("🎓 أكاديمية رادار الميكرز — بث الدروس التعليمية اليومية المصورة")
    print(f"📅 الوقت الحالي: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    state = load_lesson_state()
    today_str = datetime.now().strftime('%Y-%m-%d')
    
    if state.get('last_sent_date') == today_str and not preview and not force and lesson_id is None:
        print(f"ℹ️ تم إرسال درس اليوم بالفعل ({today_str}). استخدم --force للتجاوز.")
        return

    # تحديد الدرس المطلوب
    if lesson_id is not None:
        selected_lesson = next((l for l in LESSONS_CURRICULUM if l['id'] == lesson_id), None)
        if not selected_lesson:
            print(f"❌ لا يوجد درس بالرقم {lesson_id}")
            return
    else:
        idx = state.get('current_index', 0) % len(LESSONS_CURRICULUM)
        selected_lesson = LESSONS_CURRICULUM[idx]

    print(f"📖 الدرس المحدد: #{selected_lesson['id']} - {selected_lesson['title']}")
    
    # 1. توليد بطاقة الدرس الإنفوجرافيك
    img_path = asyncio.run(generate_lesson_image(selected_lesson))
    if not img_path or not img_path.exists():
        print("❌ فشل في إنشاء صورة الدرس")
        return

    caption = format_telegram_lesson_caption(selected_lesson)

    if preview:
        print("\n--- [معاينة نص الدرس المصاحب للصورة] ---")
        print(caption)
        print(f"\n🖼️ تم حفظ صورة الدرس بنجاح في: {img_path}")
        print("------------------------------------------")
        return

    # 2. النشر الفعلي للقناة
    print(f"🚀 جاري بث الدرس إلى القناة {TELEGRAM_CHANNEL_ID}...")
    success = send_telegram_photo(img_path, caption)
    if success:
        print("🎉 تم نشر الدرس التعليمي المصور بنجاح على التليجرام!")
        state['last_sent_date'] = today_str
        state['current_index'] = (selected_lesson['id']) % len(LESSONS_CURRICULUM)
        state.setdefault('history', []).append({
            'date': today_str,
            'lesson_id': selected_lesson['id'],
            'title': selected_lesson['title']
        })
        save_lesson_state(state)
    else:
        print("❌ تعذر إرسال الدرس للقناة.")

if __name__ == '__main__':
    if '--list' in sys.argv:
        print("📚 قائمة الدروس المتاحة في أكاديمية رادار الميكرز:")
        for l in LESSONS_CURRICULUM:
            print(f"  [{l['id']}] {l['icon']} {l['title']} — {l['badge']}")
        sys.exit(0)

    lid = None
    for arg in sys.argv:
        if arg.startswith('--lesson='):
            lid = int(arg.split('=')[1])
        elif arg == '--lesson' and sys.argv.index(arg) + 1 < len(sys.argv):
            lid = int(sys.argv[sys.argv.index(arg) + 1])

    is_preview = '--preview' in sys.argv
    is_force = '--force' in sys.argv or '--now' in sys.argv

    run_daily_lesson(lesson_id=lid, preview=is_preview, force=is_force)
