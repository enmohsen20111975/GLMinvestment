#!/usr/bin/env python3
"""
telegram_breaking_news.py — رادار الأخبار الاقتصادية وإفصاحات البورصة المصرية الكبرى
=====================================================================================
يقوم بمراقبة جدول market_news في db/news.db وبث الأخبار الكبيرة والمؤثرة فقط على التليجرام:
  1. فلترة صارمة: فقط الأخبار الكبيرة (importance ≥ 75) ذات العلاقة المباشرة بالبورصة المصرية والشركات المقيدة.
  2. منع الإزعاج وتحديد التردد: فاصل زمني لا يقل عن 45 دقيقة بين كل خبر وآخر لمنع التكرار والإزعاج.
  3. بطاقة خبرية مرئية فائقة الجودة (Breaking News Photo Card) مستوحاة من كبرى القنوات المالية (Sahm Misr).
  4. استخراج الصورة الأصلية ورابط المصدر كاملاً (فيسبوك أو الموقع الإخباري) وتضمينه كرابط نشط داخل البوست والأزرار.
  5. ملخص سردي وافٍ وغني بتفاصيل الأثر المالي والشركات المتأثرة.

الاستخدام:
  python3 telegram_breaking_news.py           # فحص وبث الأخبار المؤهلة
  python3 telegram_breaking_news.py --preview # معاينة بطاقة الخبر بدون إرسال
  python3 telegram_breaking_news.py --force   # إرسال إجباري لأحدث خبر صالح دون انتظار الفاصل الزمني
"""

import os
import sys
import re
import json
import sqlite3
import asyncio
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_SERVICE_DIR = Path(__file__).resolve().parent.parent
if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))

DB_DIR = PROJECT_ROOT / 'db'
NEWS_DB = DB_DIR / 'news.db'
STOCKS_DB = DB_DIR / 'stocks.db'
BREAKING_DIR = PROJECT_ROOT / 'public' / 'breaking'
BREAKING_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = Path(__file__).resolve().parent / 'breaking_news_state.json'

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net/#dashboard',
    'radar_url': 'https://invist.m2y.net/#recommendations',
    'chart_url': 'https://invist.m2y.net/#trading-chart',
    'bot': 'https://t.me/investusernamebot',
    'channel': 'https://t.me/Arabian_investment_guide'
}

def load_env():
    for p in [PROJECT_ROOT / '.env', PROJECT_ROOT / 'news-agent' / '.env']:
        if p.exists():
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        val = v.strip().strip('"').strip("'")
                        if not os.environ.get(k.strip()):
                            os.environ[k.strip()] = val
            break

load_env()
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHANNEL_ID = os.environ.get('TELEGRAM_CHANNEL_ID', '@Arabian_investment_guide')

# ──────────────────────────────────────────────
# قواعد الفلترة الصارمة للبورصة المصرية فقط
# ──────────────────────────────────────────────
EGX_EXPLICIT_COMPANIES = [
    'البنك التجاري الدولي', 'تجاري دولي', 'طلعت مصطفى', 'مجموعة طلعت مصطفى', 'حديد عز', 'عز للصلب',
    'السويدي إليكتريك', 'السويدي اليكتريك', 'السويدى', 'فوري لتكنولوجيا', 'شركة فوري', 'فوري للمدفوعات',
    'إي إف جي هيرميس', 'هيرميس القابضة', 'المجموعة المالية هيرميس', 'بلتون القابضة', 'بلتون المالية',
    'بالم هيلز', 'مدينة مصر للإسكان', 'مدينة نصر للإسكان', 'مصر الجديدة للإسكان', 'سيدي كرير للبتروكيماويات',
    'سيدبك', 'أبو قير للأسمدة', 'ابوقير للاسمدة', 'مصر لإنتاج الأسمدة', 'موبكو', 'أموك', 'الإسكندرية للزيوت',
    'الشرقية للدخان', 'إيسترن كومباني', 'ايسترن كومباني', 'النساجون الشرقيون', 'الإسكندرية لتداول الحاويات',
    'إسكندرية للحاويات', 'جهينة للصناعات', 'ابن سينا فارما', 'المصرية للاتصالات', 'القلعة للاستشارات',
    'أوراسكوم كونستراكشون', 'أوراسكوم للتنمية', 'جي بي كوربوريشن', 'غبور أوتو', 'كريستمارك', 'ليفت سلاب',
    'الدولية للمحاصيل', 'وثاق للتأمين', 'بوسطة', 'دومتي', 'الصناعات الغذائية العربية', 'مستشفى كليوباترا',
    'القاهرة للاستثمار', 'تعليم لخدمات الإدارة', 'راية القابضة', 'راية لخدمات مراكز الاتصالات',
    'العاشر من رمضان', 'راميدا', 'دايس للملابس', 'مصر للأسمنت قنا', 'أسيك للتعدين', 'العامة للصوامع',
    'القاهرة للدواجن', 'إعمار مصر', 'أوراسكوم المالية', 'القابضة المصرية الكويتية', 'أوراسكوم للفنادق'
]

EGX_SOVEREIGN_TERMS = [
    'البورصة المصرية', 'البورصه المصريه', 'سوق المال المصري', 'مؤشر egx', 'مؤشر إيجي إكس', 'مؤشر ايجي اكس',
    'egx30', 'egx70', 'egx 30', 'egx 70', 'الهيئة العامة للرقابة المالية', 'الرقابة المالية',
    'البنك المركزي المصري', 'لجنة السياسة النقدية', 'سعر الفائدة في مصر', 'تثبيت الفائدة بمصر', 'رفع الفائدة بمصر',
    'الاحتياطي النقدي لمصر', 'أذون الخزانة المصرية', 'سندات الخزانة المصرية', 'الجنيه المصري',
    'رأس الحكمة', 'راس الحكمه', 'رأس بناس', 'الطروحات الحكومية بمصر', 'طروحات مصر'
]

EXCLUDED_FOREIGN_TERMS = [
    'الصين', 'بكين', 'اليابان', 'طوكيو', 'الين الياباني', 'سندات أميركية', 'سندات أمريكية',
    'وول ستريت', 'داو جونز', 'ستاندرد آند بورز', 'ناسداك', 'الأسهم الأوروبية', 'داكس', 'dax',
    'أوكرانيا', 'روسيا', 'إندونيسيا', 'سنغافورة', 'البيتكوين', 'إيثيريوم',
    'العملات المشفرة', 'الذهب عالميا', 'خام برنت عالميا', 'الفيدرالي الأمريكي'
]

CHAT_JUNK_REGEX = re.compile(
    r'(\[رد على|رد على[:\s]|in reply to|معايا بره|عاوز اعرف|عايز اعرف|يعني اي|يعني ايه|'
    r'ربنا يوفقك|صباح الخير|مساء الخير|يا شباب|يا رجالة|يا جماعة|حد يفيد|رأيكم ايه|'
    r'ميعادها امته|ميعادها امتى|تسلم|شكرا جزيلا|بالله عليك|هو كمان|لو سمحت|حد يفهمني)',
    re.IGNORECASE | re.UNICODE
)

def is_strictly_egx_news(item: Dict) -> Tuple[bool, str]:
    """تحقق حاسم من أن الخبر هام جداً وموجه حصراً للبورصة المصرية."""
    title = (item.get('title') or '').strip()
    content = (item.get('content') or '').strip()
    summary = (item.get('summary_ar') or '').strip()
    importance = item.get('importance') or 0
    text = f"{title} {content} {summary}"

    # 1. شرط اللغة العربية
    if not re.search(r'[\u0600-\u06FF]', title):
        return False, "ليس باللغة العربية"

    # 2. فحص الأهمية: لا يقل عن 85 للأخبار الحصرية والمؤثرة فقط (تقليل الإزعاج)
    if importance < 85:
        return False, f"أهمية غير كافية ({importance} < 85)"

    # 3. استبعاد الشات والرسائل القصيرة جداً
    if CHAT_JUNK_REGEX.search(text) or '[رد' in title or 'رد على' in title or len(text) < 40:
        return False, "رسالة دردشة أو قصيرة جداً"

    # 4. استبعاد التقارير الروتينية لأسعار العملات والذهب اليومية
    if re.search(r'(سعر اليورو اليوم|سعر الدولار اليوم|أسعار العملات اليوم|أسعار الذهب اليوم)', title):
        return False, "تحديث روتيني لأسعار العملات/الذهب"

    # 5. استبعاد الأخبار الدولية البحتة إلا لو ارتبطت صراحة بمصر
    has_foreign = any(f in text for f in EXCLUDED_FOREIGN_TERMS)
    has_egypt = any(e in text for e in ['مصر', 'المصرية', 'القاهرة', 'الجنيه'])
    if has_foreign and not has_egypt:
        return False, "خبر خارجي/دولي بحت"

    # 6. مطابقة الشركات المصرية بالاسم الصريح
    for comp in EGX_EXPLICIT_COMPANIES:
        if comp in text:
            return True, f"شركة مقيدة بالبورصة: {comp}"

    # 7. مطابقة المصطلحات السيادية وسوق المال المصري
    for term in EGX_SOVEREIGN_TERMS:
        if term in text:
            return True, f"حدث اقتصادي مصري: {term}"

    # 8. إذا ذُكرت مصر مع أحداث مالية كبرى
    if has_egypt and any(k in text for k in ['أرباح', 'خسائر', 'استحواذ', 'اندماج', 'زيادة رأس المال', 'طرح أسهم', 'سندات سيادية', 'احتياطي النقد']):
        return True, "حدث مالي مصري معتمد"

    return False, "غير مرتبط مباشرة بالسوق المصري"

# ──────────────────────────────────────────────
# التحكم في التردد والفاصل الزمني (Rate Limiting)
# ──────────────────────────────────────────────
COOLDOWN_MINUTES = 60 # لا نرسل أكثر من خبر كل 60 دقيقة لمنع الإزعاج
MAX_POSTS_PER_DAY = 3  # أقصى حد 3 أخبار عاجلة في اليوم للحفاظ على الهيبة والقيمة ومصداقية القناة

def load_breaking_state() -> Dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {'last_sent_at': None, 'sent_today_count': 0, 'today_date': None}

def save_breaking_state(state: Dict):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ خطأ حفظ حالة الأخبار العاجلة: {e}")

def can_send_breaking_news(force: bool = False, is_urgent: bool = False) -> Tuple[bool, str]:
    """التحقق من الفاصل الزمني والحد اليومي لتفادي إزعاج العملاء."""
    if force:
        return True, "إرسال إجباري للتجربة"

    state = load_breaking_state()
    today_str = datetime.now().strftime('%Y-%m-%d')
    if state.get('today_date') != today_str:
        state['today_date'] = today_str
        state['sent_today_count'] = 0
        save_breaking_state(state)

    if state.get('sent_today_count', 0) >= MAX_POSTS_PER_DAY:
        return False, f"تم بلوغ الحد الأقصى اليومي للأخبار العاجلة ({MAX_POSTS_PER_DAY} أخبار) لحماية العملاء من الإزعاج"

    last_sent_str = state.get('last_sent_at')
    if last_sent_str:
        try:
            last_sent = datetime.fromisoformat(last_sent_str)
            elapsed = (datetime.now() - last_sent).total_seconds() / 60
            required_cooldown = 15 if is_urgent else COOLDOWN_MINUTES
            if elapsed < required_cooldown:
                remaining = int(required_cooldown - elapsed)
                return False, f"في فترة تهدئة لمنع الإزعاج (متبقي {remaining} دقيقة)"
        except Exception:
            pass

    return True, "جاهز للإرسال"

# ──────────────────────────────────────────────
# استخراج الصورة الأصلية وتفاصيل الرابط
# ──────────────────────────────────────────────
def extract_original_image_and_desc(url: str, existing_images: str) -> Tuple[Optional[str], Optional[str]]:
    """استخراج رابط الصورة والوصف من image_paths أو من صفحة الخبر/الفيسبوك مباشرة."""
    # 1. إذا كانت الصورة مسجلة مسبقاً في قاعدة البيانات
    if existing_images and existing_images.strip() not in ('', '[]'):
        try:
            parsed = json.loads(existing_images) if existing_images.startswith('[') else [existing_images]
            for img in parsed:
                if img and isinstance(img, str) and (img.startswith('http') or Path(img).exists()):
                    return img, None
        except Exception:
            pass

    # 2. الفحص من خلال OpenGraph للرابط (og:image & og:description)
    if url and url.startswith('http'):
        try:
            resp = requests.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }, timeout=8)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, 'html.parser')
                og_img = soup.find('meta', property='og:image') or soup.find('meta', attrs={'name': 'twitter:image'})
                img_url = og_img['content'] if (og_img and og_img.get('content')) else None
                og_desc = soup.find('meta', property='og:description') or soup.find('meta', attrs={'name': 'description'})
                desc = og_desc['content'].strip() if (og_desc and og_desc.get('content')) else None
                return img_url, desc
        except Exception as e:
            print(f"⚠️ تعذر جلب OpenGraph من الرابط {url}: {e}")

    return None, None

# ──────────────────────────────────────────────
# توليد بطاقة الخبر العاجل المصورة (Breaking Card)
# ──────────────────────────────────────────────
def render_card_html(title: str, subtitle: str, bg_image_url: Optional[str], ticker_label: str, sentiment_label: str) -> str:
    """توليد كود HTML المتطور للبطاقة المصورة بتصميم ذهبي زمردي أنيق."""
    if bg_image_url and bg_image_url.startswith('http'):
        bg_style = f"""
            background: linear-gradient(180deg, rgba(4, 15, 12, 0.45) 0%, rgba(4, 15, 12, 0.88) 55%, #030a08 100%),
                        url('{bg_image_url}') center/cover no-repeat;
        """
    else:
        bg_style = """
            background: radial-gradient(circle at 50% 15%, #0f3d2f 0%, #061813 50%, #020705 100%);
        """

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{
      font-family: 'Cairo', sans-serif;
      width: 1080px;
      height: 1080px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 45px;
      position: relative;
      overflow: hidden;
      {bg_style}
    }}

    .frame-border {{
      position: absolute;
      top: 18px; left: 18px; right: 18px; bottom: 18px;
      border: 2px solid rgba(234, 179, 8, 0.4);
      border-radius: 26px;
      pointer-events: none;
    }}
    .frame-border-inner {{
      position: absolute;
      top: 24px; left: 24px; right: 24px; bottom: 24px;
      border: 1px solid rgba(234, 179, 8, 0.18);
      border-radius: 20px;
      pointer-events: none;
    }}

    /* شريط خبر عاجل */
    .header-ribbon {{
      display: flex;
      justify-content: center;
      align-items: center;
      margin-top: 8px;
      z-index: 10;
    }}
    .ribbon-badge {{
      background: linear-gradient(135deg, #b45309 0%, #d97706 40%, #fbbf24 75%, #d97706 100%);
      padding: 10px 48px;
      border-radius: 40px;
      color: #040908;
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 1px;
      box-shadow: 0 10px 30px rgba(217, 119, 6, 0.45), inset 0 2px 5px rgba(255, 255, 255, 0.6);
      display: flex;
      align-items: center;
      gap: 14px;
    }}

    /* صندوق محتوى الخبر */
    .content-box {{
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: 20px;
      margin-bottom: 20px;
      z-index: 10;
      background: rgba(3, 13, 10, 0.92);
      border: 1px solid rgba(234, 179, 8, 0.35);
      backdrop-filter: blur(20px);
      border-radius: 26px;
      padding: 38px 36px;
      box-shadow: 0 25px 60px rgba(0,0,0,0.85);
    }}

    .news-tags {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .tag-ticker {{
      background: #10b981;
      color: #040908;
      font-size: 22px;
      font-weight: 800;
      padding: 6px 20px;
      border-radius: 12px;
    }}
    .tag-sentiment {{
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #f1f5f9;
      font-size: 20px;
      font-weight: 700;
      padding: 6px 18px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .sentiment-dot {{
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
    }}
    .dot-bullish {{ background: #10b981; box-shadow: 0 0 10px #10b981; }}
    .dot-neutral {{ background: #94a3b8; }}
    .dot-bearish {{ background: #ef4444; box-shadow: 0 0 10px #ef4444; }}

    .news-title {{
      font-size: 40px;
      font-weight: 900;
      line-height: 1.38;
      color: #fef08a;
      text-shadow: 0 4px 18px rgba(0,0,0,0.8);
    }}

    .news-subtitle {{
      font-size: 25px;
      font-weight: 700;
      line-height: 1.55;
      color: #f8fafc;
      border-right: 5px solid #eab308;
      padding-right: 18px;
    }}

    /* الفوتر */
    .footer {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(234, 179, 8, 0.25);
      padding-top: 14px;
      z-index: 10;
    }}
    .footer-brand {{
      color: #facc15;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }}
    .footer-links {{
      color: #94a3b8;
      font-size: 18px;
      font-weight: 600;
      direction: ltr;
    }}
  </style>
</head>
<body>
  <div class="frame-border"></div>
  <div class="frame-border-inner"></div>

  <div class="header-ribbon">
    <div class="ribbon-badge">
      <span>///</span>
      <span>خبر عاجل</span>
      <span>///</span>
    </div>
  </div>

  <div class="content-box">
    <div class="news-tags">
      <span class="tag-ticker">{ticker_label}</span>
      <span class="tag-sentiment">
        <span class="sentiment-dot {'dot-bullish' if 'إيجابي' in sentiment_label else ('dot-bearish' if 'سلبي' in sentiment_label else 'dot-neutral')}"></span>
        <span>{sentiment_label.replace('🟢', '').replace('🔴', '').replace('⚪', '').strip()}</span>
      </span>
    </div>

    <h1 class="news-title">{title}</h1>
    <div class="news-subtitle">{subtitle}</div>
  </div>

  <div class="footer">
    <div class="footer-brand">
      <span>دليل الاستثمار | رادار البورصة المصرية</span>
    </div>
    <div class="footer-links">
      <span>invist.m2y.net • @Arabian_investment_guide</span>
    </div>
  </div>
</body>
</html>
"""

async def generate_breaking_card_image(news_id: int, title: str, subtitle: str, bg_image_url: Optional[str], ticker_label: str, sentiment_label: str) -> Optional[Path]:
    """توليد بطاقة الخبر العاجل المصورة بدقة 1080×1080 عبر Playwright."""
    html = render_card_html(title, subtitle, bg_image_url, ticker_label, sentiment_label)
    out_file = BREAKING_DIR / f"breaking_{news_id}.png"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={'width': 1080, 'height': 1080}, device_scale_factor=1.5)
            await page.set_content(html, wait_until='networkidle')
            await page.screenshot(path=str(out_file), type='png')
            await browser.close()
        return out_file
    except Exception as e:
        print(f"❌ خطأ في توليد صورة الخبر العاجل: {e}")
        return None

# ──────────────────────────────────────────────
# استخراج الأخبار المرشحة
# ──────────────────────────────────────────────
def get_breaking_news_candidates(limit: int = 1, include_sent: bool = False) -> List[Dict]:
    """جلب الأخبار غير المرسلة المطابقة لشروط الأهمية والبورصة المصرية."""
    candidates = []
    if not NEWS_DB.exists():
        return candidates

    try:
        con = sqlite3.connect(NEWS_DB)
        con.row_factory = sqlite3.Row
        
        cols = [c[1] for c in con.execute("PRAGMA table_info(market_news)").fetchall()]
        has_is_sent = 'is_sent' in cols
        
        query = """
            SELECT id, title, content, summary_ar, summary_en, source, url, 
                   tickers, importance, sentiment, impact_type, image_paths, published_at, is_sent
            FROM market_news
        """
        if has_is_sent and not include_sent:
            query += " WHERE is_sent = 0 AND importance >= 75"
        else:
            query += " WHERE importance >= 75"
            
        query += " ORDER BY id DESC LIMIT 50"
        
        rows = con.execute(query).fetchall()
        for r in rows:
            d = dict(r)
            is_valid, reason = is_strictly_egx_news(d)
            if is_valid:
                d['_reason'] = reason
                candidates.append(d)
                if len(candidates) >= limit:
                    break
            else:
                # وضع علامة is_sent = 1 تلقائياً للأخبار غير المؤهلة لمنع فحصها كل دورة
                try:
                    con.execute("UPDATE market_news SET is_sent = 1 WHERE id = ?", (d['id'],))
                except Exception:
                    pass

        con.commit()
        con.close()
    except Exception as e:
        print(f"⚠️ خطأ قراءة الأخبار: {e}")

    return candidates

def mark_news_as_sent(news_id: int):
    """تحديث حالة الخبر كمرسل مع تسجيل الوقت لمنع التكرار نهائياً."""
    try:
        con = sqlite3.connect(NEWS_DB)
        now_str = datetime.now().isoformat()
        con.execute("UPDATE market_news SET is_sent = 1, sent_at = ? WHERE id = ?", (now_str, news_id))
        con.commit()
        con.close()
    except Exception as e:
        print(f"⚠️ خطأ تحديث حالة الخبر {news_id}: {e}")

    # تحديث حالة التردد
    state = load_breaking_state()
    today_str = datetime.now().strftime('%Y-%m-%d')
    if state.get('today_date') != today_str:
        state['today_date'] = today_str
        state['sent_today_count'] = 0
    state['last_sent_at'] = datetime.now().isoformat()
    state['sent_today_count'] = state.get('sent_today_count', 0) + 1
    save_breaking_state(state)

# ──────────────────────────────────────────────
# صياغة التقرير والنص الكامل والرابط الأصلي
# ──────────────────────────────────────────────
def format_breaking_post(item: Dict, og_desc: Optional[str]) -> Tuple[str, dict, str, str, str]:
    """صياغة بطاقة الخبر العاجل مع التفاصيل الوافية والرابط الأصلي بالكامل."""
    sentiment = (item.get('sentiment') or 'neutral').lower()
    if 'bullish' in sentiment or 'إيجابي' in sentiment:
        sentiment_badge = "🟢 إيجابي للسوق"
        sentiment_short = "🟢 إيجابي للسوق"
    elif 'bearish' in sentiment or 'سلبي' in sentiment:
        sentiment_badge = "🔴 سلبي / حذر"
        sentiment_short = "🔴 سلبي / حذر"
    else:
        sentiment_badge = "⚪ محايد / للمتابعة"
        sentiment_short = "⚪ للمتابعة"

    title = (item.get('title') or '').strip()
    content = (item.get('content') or '').strip()
    summary = (item.get('summary_ar') or '').strip()
    news_url = (item.get('url') or '').strip()
    source = item.get('source') or 'البورصة المصرية'

    # استخدام تفاصيل سردية غنية ووافية (لا نختصر بتهور إلى جملة واحدة جافة)
    narrative_text = ""
    if content and len(content) > len(summary) and len(content) >= 80:
        narrative_text = content
    elif og_desc and len(og_desc) > len(summary):
        narrative_text = og_desc
    else:
        narrative_text = summary or title

    # تحسين الصياغة لتكون من فقرتين تشرحان الحدث وتأثيره
    if len(narrative_text) > 480:
        narrative_text = narrative_text[:475] + "..."

    # استخراج الشركات المتأثرة بدقة
    tickers_list = []
    try:
        from utils.egx_tickers import extract_egx_tickers
        smart_tickers = extract_egx_tickers(f"{title} {narrative_text}")
        if smart_tickers:
            tickers_list = smart_tickers
    except Exception:
        pass

    if not tickers_list and item.get('tickers'):
        try:
            raw_t = item['tickers']
            tickers_list = json.loads(raw_t) if raw_t.startswith('[') else [raw_t]
        except Exception:
            pass

    tickers_list = [t for t in tickers_list if t not in ('EGX', 'EGX30', 'EGX70', 'GENERAL')]
    ticker_tags = " ".join([f"#{t}" for t in tickers_list]) if tickers_list else "#البورصة_المصرية"
    primary_ticker = tickers_list[0] if tickers_list else "EGX"

    ticker_card_label = f"{primary_ticker} | EGX" if primary_ticker != "EGX" else "البورصة المصرية"

    # وقت النشر
    pub_time = item.get('published_at') or datetime.now().strftime('%Y-%m-%d %H:%M')
    if 'T' in pub_time:
        pub_time = pub_time.replace('T', ' ').split('.')[0]

    # صياغة الرابط النشط للمصدر
    link_html = f'🔗 <a href="{news_url}">اضغط هنا لعرض تفاصيل الخبر والمصدر كاملاً</a>' if news_url else ''

    caption = f"""🔴 <b>عاجل | أخبار وافصاحات البورصة المصرية</b>
━━━━━━━━━━━━━━━━━━━
📰 <b>{title}</b>

📣 {narrative_text}

📊 <b>تقييم الأثر:</b> {sentiment_badge}
🏢 <b>الشركات المتأثرة:</b> {ticker_tags}
📡 <b>المصدر:</b> {source} | ⏰ {pub_time}

{link_html}
━━━━━━━━━━━━━━━━━━━
⚡ <i>تابع حركة السيولة وتدفقات صانع السوق لحظياً عبر المنصة: invist.m2y.net</i>"""

    # أزرار التفاعل السريع
    buttons = []
    if primary_ticker and primary_ticker != "EGX":
        buttons.append([
            {
                "text": f"📊 فحص سهم {primary_ticker} على رادار السيولة",
                "url": f"{OFFICIAL_LINKS['radar_url']}?ticker={primary_ticker}"
            }
        ])

    action_row = []
    if news_url and news_url.startswith('http'):
        action_row.append({"text": "🔗 تفاصيل الخبر الأصلية", "url": news_url})
    action_row.append({"text": "🤖 فحص أي سهم عبر البوت", "url": OFFICIAL_LINKS['bot']})
    buttons.append(action_row)

    reply_markup = {"inline_keyboard": buttons}
    return caption, reply_markup, title, narrative_text[:140], ticker_card_label

# ──────────────────────────────────────────────
# إرسال الصورة والنص إلى التليجرام
# ──────────────────────────────────────────────
def send_telegram_breaking(photo_path: Optional[Path], caption: str, reply_markup: dict) -> bool:
    """إرسال الخبر بالصورة إلى القناة، مع الرجوع للنص في حال تعذر الصورة."""
    if not TELEGRAM_BOT_TOKEN:
        print("❌ TELEGRAM_BOT_TOKEN غير مضبوط!")
        return False

    # 1. الإرسال كصورة (sendPhoto) كما في الصورة المرفقة
    if photo_path and photo_path.exists():
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
        try:
            with open(photo_path, 'rb') as f:
                r = requests.post(
                    url,
                    data={
                        'chat_id': TELEGRAM_CHANNEL_ID,
                        'caption': caption,
                        'parse_mode': 'HTML',
                        'reply_markup': json.dumps(reply_markup)
                    },
                    files={'photo': f},
                    timeout=30
                )
                res = r.json()
                if res.get('ok'):
                    return True
                else:
                    print(f"⚠️ فشل إرسال sendPhoto: {res.get('description')} — جاري الرجوع للنص")
        except Exception as e:
            print(f"⚠️ خطأ أثناء إرسال الصورة: {e}")

    # 2. خطة بديلة (Fallback) في حال عدم توفر الصورة
    url_msg = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        r = requests.post(
            url_msg,
            json={
                'chat_id': TELEGRAM_CHANNEL_ID,
                'text': caption,
                'parse_mode': 'HTML',
                'disable_web_page_preview': False,
                'reply_markup': reply_markup
            },
            timeout=15
        )
        return r.json().get('ok', False)
    except Exception as e:
        print(f"❌ خطأ إرسال الرسالة النصية: {e}")
        return False

# ──────────────────────────────────────────────
# الدالة الرئيسية لتنفيذ فحص وبث الأخبار
# ──────────────────────────────────────────────
def run_breaking_news(preview: bool = False, force: bool = False, include_all: bool = False):
    print("=" * 65)
    print("📡 رادار الأخبار الكبيرة وإفصاحات البورصة المصرية (EGX Breaking)")
    print(f"📅 الوقت: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    candidates = get_breaking_news_candidates(limit=1, include_sent=(preview or include_all))
    if not candidates:
        print("ℹ️ لا توجد أخبار كبرى جديدة مطابقة لشروط البورصة المصرية حالياً.")
        return

    item = candidates[0]
    is_urgent = (item.get('importance') or 0) >= 90
    
    can_send, reason_msg = can_send_breaking_news(force=force, is_urgent=is_urgent)
    if not can_send and not preview:
        print(f"⏳ تم تخطي البث مؤقتاً: {reason_msg}")
        return

    print(f"🎯 تم ترشيح الخبر الكبير #{item['id']}: {item['title'][:60]}...")
    print(f"   السبب: {item.get('_reason', 'أهمية مرتفعة')}")

    # 1. استخراج الصورة الأصلية والوصف من الرابط
    og_img, og_desc = extract_original_image_and_desc(item.get('url') or '', item.get('image_paths') or '')

    # 2. صياغة النص والأزرار
    caption, kb, title, subtitle, ticker_label = format_breaking_post(item, og_desc)

    # 3. توليد بطاقة الخبر العاجل المصورة
    sentiment_label = "🟢 إيجابي للسوق" if 'bullish' in (item.get('sentiment') or '').lower() else "⚪ للمتابعة"
    print("🎨 جاري توليد بطاقة الخبر العاجل المصورة فائقة الجودة...")
    card_path = asyncio.run(generate_breaking_card_image(
        news_id=item['id'],
        title=title,
        subtitle=subtitle,
        bg_image_url=og_img,
        ticker_label=ticker_label,
        sentiment_label=sentiment_label
    ))

    if preview:
        print("\n--- [معاينة نص الخبر على التليجرام] ---")
        print(caption)
        print(f"صورة البطاقة: {card_path}")
        print("---------------------------------------")
        return

    print(f"🚀 إرسال بطاقة الخبر #{item['id']} المصورة إلى قناة التليجرام...")
    success = send_telegram_breaking(card_path, caption, kb)
    if success:
        print(f"✅ تم بث الخبر الكبير #{item['id']} بنجاح مع الصورة والتفاصيل والرابط!")
        mark_news_as_sent(item['id'])
    else:
        print(f"❌ فشل بث الخبر #{item['id']}")

if __name__ == '__main__':
    is_preview = '--preview' in sys.argv
    is_force = '--force' in sys.argv
    run_breaking_news(preview=is_preview, force=is_force)
