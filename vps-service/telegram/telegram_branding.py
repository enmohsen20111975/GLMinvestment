#!/usr/bin/env python3
"""
telegram_branding.py — منصات وهوية دليل الاستثمار الموحدة
============================================================
يوفر الروابط الرسمية، توليد كود QR المتجهي (SVG)، وأشرطة الهوية البصرية
لكافة البطاقات المصورة والتقارير المنشورة على التليجرام ومواقع التواصل.
"""

from typing import Dict, List, Optional
import qrcode
import qrcode.image.svg

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'stocks_url': 'https://invist.m2y.net/#stocks',
    'radar_url': 'https://invist.m2y.net/#recommendations',
    'chart_url': 'https://invist.m2y.net/#trading-chart',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
    'channel': 'https://t.me/Arabian_investment_guide',
    'whatsapp': 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
    'bot': 'https://t.me/investusernamebot',
}

def generate_qr_svg(url: str = 'https://invist.m2y.net/#recommendations') -> str:
    """توليد رمز QR بدقة متجهة SVG عالية النقاء لتضمينه في البطاقات المصورة."""
    try:
        factory = qrcode.image.svg.SvgPathImage
        img = qrcode.make(url, image_factory=factory, box_size=10, border=1)
        svg = img.to_string().decode('utf-8')
        return svg[svg.find('<svg'):]
    except Exception as e:
        print(f"⚠️ فشل توليد QR SVG: {e}")
        return ""

def render_branding_box_html(target_url: str = 'https://invist.m2y.net/#recommendations', theme: str = 'green') -> str:
    """توليد كود HTML متقدم لشريط المنصات والروابط الرسمية مع QR Code."""
    qr_svg = generate_qr_svg(target_url)

    accent_border = "rgba(34, 197, 94, 0.4)" if theme == 'green' else "rgba(234, 179, 8, 0.4)"

    return f"""
  <!-- قسم الروابط والمنصات الرسمية الشامل -->
  <div class="platforms-box" style="
    background: rgba(6, 20, 16, 0.95);
    border: 1.5px solid {accent_border};
    border-radius: 20px;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.65);
    margin-top: 10px;
  ">
    <div class="platforms-grid" style="
      flex: 1;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    ">
      <!-- 1. الموقع الرسمي -->
      <div class="platform-item" style="
        background: rgba(15, 38, 30, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <div style="
          width: 36px; height: 36px; border-radius: 10px;
          background: rgba(34, 197, 94, 0.2);
          display: flex; align-items: center; justify-content: center;
          color: #4ade80; flex-shrink: 0;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div style="font-size:14px; font-weight:800; color:#fef08a;">الموقع الرسمي والرادار الحي</div>
          <div style="font-size:13px; font-weight:700; color:#cbd5e1; direction:ltr; text-align:right;">invist.m2y.net</div>
        </div>
      </div>

      <!-- 2. تطبيق أندرويد -->
      <div class="platform-item" style="
        background: rgba(15, 38, 30, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <div style="
          width: 36px; height: 36px; border-radius: 10px;
          background: rgba(56, 189, 248, 0.2);
          display: flex; align-items: center; justify-content: center;
          color: #38bdf8; flex-shrink: 0;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
          </svg>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div style="font-size:14px; font-weight:800; color:#fef08a;">تطبيق Google Play</div>
          <div style="font-size:13px; font-weight:700; color:#cbd5e1;">دليل الاستثمار EGX</div>
        </div>
      </div>

      <!-- 3. قناة التليجرام -->
      <div class="platform-item" style="
        background: rgba(15, 38, 30, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <div style="
          width: 36px; height: 36px; border-radius: 10px;
          background: rgba(14, 165, 233, 0.2);
          display: flex; align-items: center; justify-content: center;
          color: #38bdf8; flex-shrink: 0;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div style="font-size:14px; font-weight:800; color:#fef08a;">قناة التليجرام الرسمية</div>
          <div style="font-size:13px; font-weight:700; color:#cbd5e1; direction:ltr; text-align:right;">@Arabian_investment_guide</div>
        </div>
      </div>

      <!-- 4. مجتمع الواتساب والفيسبوك -->
      <div class="platform-item" style="
        background: rgba(15, 38, 30, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <div style="
          width: 36px; height: 36px; border-radius: 10px;
          background: rgba(34, 197, 94, 0.2);
          display: flex; align-items: center; justify-content: center;
          color: #4ade80; flex-shrink: 0;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </div>
        <div style="display:flex; flex-direction:column;">
          <div style="font-size:14px; font-weight:800; color:#fef08a;">مجتمع الواتساب والفيسبوك</div>
          <div style="font-size:13px; font-weight:700; color:#cbd5e1;">جروب مستثمري البورصة</div>
        </div>
      </div>
    </div>

    <!-- كود المسح السريع QR -->
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #ffffff;
      padding: 8px 10px 10px 10px;
      border-radius: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      width: 125px;
      flex-shrink: 0;
    ">
      <div style="width: 86px; height: 86px; display:flex; align-items:center; justify-content:center;">
        {qr_svg}
      </div>
      <div style="font-size: 11px; font-weight: 900; color: #064e3b; text-align: center; line-height: 1.2;">
        امسح بالهاتف<br>لفتح المنصة
      </div>
    </div>
  </div>
"""

def format_caption_links_block() -> str:
    """كتلة الروابط الرسمية المنسقة لرسائل التليجرام."""
    return f"""━━━━━━━━━━━━━━━━━━━
🔗 <b>منصاتنا وقنواتنا الرسمية:</b>
🌐 <b>الموقع ورادار السيولة:</b> {OFFICIAL_LINKS['website']}
📱 <b>تطبيق الأندرويد:</b> {OFFICIAL_LINKS['android']}
✈️ <b>قناة التليجرام:</b> {OFFICIAL_LINKS['telegram']}
💬 <b>مجتمع الواتساب:</b> {OFFICIAL_LINKS['whatsapp']}
📘 <b>صفحة الفيسبوك:</b> {OFFICIAL_LINKS['facebook']}"""

def get_official_inline_buttons(ticker: Optional[str] = None) -> List[List[Dict[str, str]]]:
    """الأزرار التفاعلية الرسمية للرسائل."""
    radar_url = f"{OFFICIAL_LINKS['radar_url']}?ticker={ticker}" if ticker else OFFICIAL_LINKS['radar_url']
    return [
        [
            {"text": "📊 فتح رادار السيولة المباشر", "url": radar_url},
            {"text": "📱 تطبيق الأندرويد", "url": OFFICIAL_LINKS['android']}
        ],
        [
            {"text": "💬 انضم لمجتمع الواتساب", "url": OFFICIAL_LINKS['whatsapp']},
            {"text": "🤖 فحص بالبوت مجاناً", "url": OFFICIAL_LINKS['bot']}
        ]
    ]
