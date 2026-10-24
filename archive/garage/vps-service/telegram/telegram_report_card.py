#!/usr/bin/env python3
"""
telegram_report_card.py — مولد بطاقات التقارير الأسبوعية واليومية المصورة الفخمة
================================================================================
يقوم بإنشاء صور بيانية مذهلة بدقة 1080×1080 للتقارير اليومية والأسبوعية
تضم:
  - مؤشرات نبض واتساع السوق
  - أفضل الأسهم الصاعدة
  - أبرز فرص وتوقعات الأسبوع القادم / الغد بنقاط الدخول والأهداف 1 و2 ووقف الخسارة
  - الهوية الرسمية للمنصة وكود QR
"""

import os
import sys
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_SERVICE_DIR = Path(__file__).resolve().parent.parent
TELEGRAM_DIR = Path(__file__).resolve().parent

for p in [str(PROJECT_ROOT), str(VPS_SERVICE_DIR), str(TELEGRAM_DIR), str(VPS_SERVICE_DIR / 'data')]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from egx_arabic_lookup import get_arabic_stock_name
except ImportError:
    def get_arabic_stock_name(tk, fb=None): return fb or tk

try:
    from telegram_branding import render_branding_box_html, OFFICIAL_LINKS
except ImportError:
    def render_branding_box_html(target_url='', theme='green'): return ''
    OFFICIAL_LINKS = {'website': 'https://invist.m2y.net'}

REPORTS_DIR = PROJECT_ROOT / 'public' / 'reports'
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def render_report_card_html(report: Dict, report_type: str = 'weekly') -> str:
    """توليد كود HTML داكن فخم عالي الجودة للتقرير الأسبوعي أو اليومي."""
    summary = report.get('summary', {})
    gainers = summary.get('gainers', 0)
    losers = summary.get('losers', 0)
    breadth = summary.get('market_breadth', 0)
    total_stocks = summary.get('total_stocks', 0)

    is_weekly = (report_type == 'weekly')
    title_text = "التقرير الأسبوعي الشامل" if is_weekly else "حصاد الجلسة والفرص القادمة"
    badge_label = "حصاد الأسبوع وتوقعات القادم" if is_weekly else "تقرير الجلسة اليومي"

    if is_weekly:
        week = report.get('week_range', {})
        date_str = f"الأسبوع: {week.get('start', '')} إلى {week.get('end', '')}"
    else:
        date_str = datetime.now().strftime('جلسة %Y-%m-%d')

    # أفضل الصاعدات (Top 4)
    top_gainers = report.get('top_gainers', [])[:4]
    gainers_html = ""
    for g in top_gainers:
        sym = g.get('symbol') or g.get('ticker') or ''
        name_ar = get_arabic_stock_name(sym, sym)
        chg = float(g.get('change_percent') or 0)
        gainers_html += f"""
        <div class="gainer-chip">
          <span class="gainer-name">{name_ar} ({sym})</span>
          <span class="gainer-val">+{chg:.1f}%</span>
        </div>
        """

    # التوقعات والفرص (Top 4)
    recs = report.get('recommendations', [])
    seen = set()
    valid_recs = []
    for r in recs:
        s = r.get('symbol') or r.get('ticker')
        if s and s not in seen:
            seen.add(s)
            valid_recs.append(r)

    recs_cards_html = ""
    for r in valid_recs[:4]:
        sym = r.get('symbol') or r.get('ticker')
        name_ar = r.get('name_ar') or get_arabic_stock_name(sym, sym)
        entry = float(r.get('entry_price') or 0)
        tp1 = float(r.get('target_price') or 0)
        tp2 = float(r.get('target_price_2') or (tp1 * 1.05 if tp1 else 0))
        sl = float(r.get('stop_loss') or 0)
        conf = float(r.get('confidence') or r.get('score') or 80)

        tp1_pct = ((tp1 - entry) / entry * 100) if entry > 0 and tp1 > 0 else 6.0
        tp2_pct = ((tp2 - entry) / entry * 100) if entry > 0 and tp2 > 0 else 12.0
        sl_pct = ((sl - entry) / entry * 100) if entry > 0 and sl > 0 else -4.0

        recs_cards_html += f"""
        <div class="rec-card">
          <div class="rec-header">
            <div class="rec-title-group">
              <span class="rec-ticker">{sym}</span>
              <span class="rec-name">{name_ar}</span>
            </div>
            <div class="rec-conf-tag">ثقة {conf:.0f}%</div>
          </div>
          <div class="rec-levels-grid">
            <div class="level-cell entry-cell">
              <span class="level-lbl">سعر الدخول</span>
              <span class="level-num">{entry:.2f} ج.م</span>
            </div>
            <div class="level-cell tp1-cell">
              <span class="level-lbl">الهدف 1</span>
              <span class="level-num">{tp1:.2f} <small>(+{tp1_pct:.1f}%)</small></span>
            </div>
            <div class="level-cell tp2-cell">
              <span class="level-lbl">الهدف 2</span>
              <span class="level-num">{tp2:.2f} <small>(+{tp2_pct:.1f}%)</small></span>
            </div>
            <div class="level-cell sl-cell">
              <span class="level-lbl">وقف الخسارة</span>
              <span class="level-num">{sl:.2f} <small>({sl_pct:.1f}%)</small></span>
            </div>
          </div>
        </div>
        """

    branding_html = render_branding_box_html(OFFICIAL_LINKS.get('website', 'https://invist.m2y.net'), theme='green')

    return f"""<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
      font-family: 'Cairo', sans-serif;
      background: radial-gradient(circle at 50% 10%, #0d281e 0%, #05130e 55%, #020705 100%);
      width: 1080px;
      height: 1080px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 32px;
      overflow: hidden;
      position: relative;
    }}

    .frame-border {{
      position: absolute;
      inset: 12px;
      border: 1px solid rgba(34, 197, 94, 0.35);
      border-radius: 24px;
      pointer-events: none;
    }}

    /* Top Bar */
    .top-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid rgba(34, 197, 94, 0.25);
      padding-bottom: 12px;
    }}
    .brand-title {{
      font-size: 26px;
      font-weight: 900;
      color: #4ade80;
      letter-spacing: -0.5px;
    }}
    .badge-tag {{
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid #22c55e;
      color: #86efac;
      padding: 4px 14px;
      border-radius: 20px;
      font-weight: 800;
      font-size: 14px;
    }}

    /* Title & Date */
    .report-title-row {{
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 10px;
    }}
    .main-title {{
      font-size: 28px;
      font-weight: 900;
      color: #ffffff;
    }}
    .date-badge {{
      font-size: 15px;
      font-weight: 700;
      color: #fef08a;
      background: rgba(234, 179, 8, 0.15);
      border: 1px solid rgba(234, 179, 8, 0.4);
      padding: 3px 12px;
      border-radius: 10px;
    }}

    /* Stats Bar */
    .stats-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-top: 12px;
    }}
    .stat-box {{
      background: rgba(15, 35, 28, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 8px 12px;
      text-align: center;
    }}
    .stat-lbl {{
      font-size: 12px;
      font-weight: 700;
      color: #94a3b8;
    }}
    .stat-num {{
      font-size: 20px;
      font-weight: 900;
      margin-top: 2px;
    }}

    /* Top Gainers chips */
    .gainers-section {{
      margin-top: 12px;
    }}
    .sec-header {{
      font-size: 14px;
      font-weight: 800;
      color: #86efac;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }}
    .gainers-strip {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }}
    .gainer-chip {{
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.35);
      border-radius: 10px;
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .gainer-name {{
      font-size: 13px;
      font-weight: 800;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .gainer-val {{
      font-size: 14px;
      font-weight: 900;
      color: #4ade80;
      direction: ltr;
    }}

    /* Recs Grid */
    .recs-section {{
      margin-top: 14px;
      flex-grow: 1;
    }}
    .recs-container {{
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .rec-card {{
      background: rgba(13, 31, 24, 0.85);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 14px;
      padding: 8px 14px;
    }}
    .rec-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }}
    .rec-title-group {{
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .rec-ticker {{
      background: #22c55e;
      color: #05130e;
      font-weight: 900;
      font-size: 14px;
      padding: 2px 8px;
      border-radius: 6px;
    }}
    .rec-name {{
      font-size: 16px;
      font-weight: 800;
      color: #ffffff;
    }}
    .rec-conf-tag {{
      background: rgba(234, 179, 8, 0.2);
      border: 1px solid #eab308;
      color: #fef08a;
      font-size: 12px;
      font-weight: 800;
      padding: 2px 10px;
      border-radius: 12px;
    }}
    .rec-levels-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }}
    .level-cell {{
      background: rgba(5, 19, 14, 0.6);
      border-radius: 8px;
      padding: 5px 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }}
    .level-lbl {{
      font-size: 11px;
      font-weight: 700;
      color: #94a3b8;
    }}
    .level-num {{
      font-size: 14px;
      font-weight: 900;
      color: #ffffff;
      margin-top: 1px;
    }}
    .level-num small {{
      font-size: 11px;
      font-weight: 800;
    }}
    .entry-cell {{ border-color: rgba(59, 130, 246, 0.3); }}
    .entry-cell .level-num {{ color: #93c5fd; }}
    .tp1-cell {{ border-color: rgba(34, 197, 94, 0.4); }}
    .tp1-cell .level-num {{ color: #86efac; }}
    .tp2-cell {{ border-color: rgba(234, 179, 8, 0.4); }}
    .tp2-cell .level-num {{ color: #fde047; }}
    .sl-cell {{ border-color: rgba(239, 68, 68, 0.3); }}
    .sl-cell .level-num {{ color: #fca5a5; }}

    /* Footer Branding */
    .branding-wrap {{
      margin-top: 10px;
    }}
    .footer-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
      color: #94a3b8;
      font-weight: 700;
    }}
  </style>
</head>
<body>
  <div class="frame-border"></div>

  <!-- Top Bar -->
  <div class="top-bar">
    <div class="brand-title">منصة دليل الاستثمار | EGX</div>
    <div class="badge-tag">{badge_label}</div>
  </div>

  <!-- Title & Date -->
  <div class="report-title-row">
    <div class="main-title">📊 {title_text}</div>
    <div class="date-badge">📅 {date_str}</div>
  </div>

  <!-- Market Stats -->
  <div class="stats-grid">
    <div class="stat-box">
      <div class="stat-lbl">إجمالي الأسهم</div>
      <div class="stat-num" style="color: #cbd5e1;">{total_stocks}</div>
    </div>
    <div class="stat-box" style="border-color: rgba(34, 197, 94, 0.35);">
      <div class="stat-lbl">الأسهم الصاعدة 🟢</div>
      <div class="stat-num" style="color: #4ade80;">{gainers}</div>
    </div>
    <div class="stat-box" style="border-color: rgba(239, 68, 68, 0.35);">
      <div class="stat-lbl">الأسهم الهابطة 🔴</div>
      <div class="stat-num" style="color: #f87171;">{losers}</div>
    </div>
    <div class="stat-box" style="border-color: rgba(234, 179, 8, 0.35);">
      <div class="stat-lbl">اتساع السوق</div>
      <div class="stat-num" style="color: #facc15;">{breadth:.1f}%</div>
    </div>
  </div>

  <!-- Top Gainers Strip -->
  <div class="gainers-section">
    <div class="sec-header">🏆 أفضل الأسهم الصاعدة:</div>
    <div class="gainers-strip">
      {gainers_html}
    </div>
  </div>

  <!-- Recs Section -->
  <div class="recs-section">
    <div class="sec-header">🎯 أبرز فرص وتوقعات الأسبوع القادم بنقاط الدخول والأهداف:</div>
    <div class="recs-container">
      {recs_cards_html}
    </div>
  </div>

  <!-- Official Platform Branding & QR Code -->
  <div class="branding-wrap">
    {branding_html}
  </div>

  <!-- Footer -->
  <div class="footer-bar">
    <span>تحليل كمي بالذكاء الاصطناعي ورادار السيولة • منصة دليل الاستثمار</span>
    <span style="direction: ltr;">invist.m2y.net</span>
  </div>
</body>
</html>"""


async def generate_report_card_image(report: Dict, report_type: str = 'weekly') -> Optional[Path]:
    """توليد صورة بطاقة التقرير بدقة 1080×1080 عبر Playwright."""
    html = render_report_card_html(report, report_type)
    t_stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_file = REPORTS_DIR / f"report_{report_type}_{t_stamp}.png"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={'width': 1080, 'height': 1080}, device_scale_factor=1.5)
            await page.set_content(html, wait_until='networkidle')
            await page.screenshot(path=str(out_file), type='png')
            await browser.close()
        return out_file
    except Exception as e:
        print(f"❌ خطأ توليد صورة بطاقة التقرير: {e}")
        return None
