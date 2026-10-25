#!/usr/bin/env python3
"""
🎨 Social Card Generator
========================
مولّد الصور الاجتماعية للمنصة - بيحوّل HTML template لـ PNG.

الأنواع المدعومة:
- tomorrow_picks   (1080×1350) — فرص الغد (1-2 سهم)
- daily_summary    (1080×1350) — ملخص يومي للسوق
- weekly_summary   (1200×628)  — ملخص أسبوعي
- monthly_summary  (1200×628)  — ملخص شهري

يستخدم Playwright (Chromium) لتحويل HTML → PNG بأبعاد Social Media.
لو Playwright مش متاح → بيرجع None والنص يفضل متاح بدون صورة.

Author: GLMinvestment Platform
"""

import os
import sys
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List

# ─────────────────────────────────────────────────────────────────────────────
# Playwright availability check (lazy import inside the function too)
# ─────────────────────────────────────────────────────────────────────────────
try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
    PLAYWRIGHT_IMPORT_ERROR = None
except Exception as _e:  # pragma: no cover
    PLAYWRIGHT_AVAILABLE = False
    PLAYWRIGHT_IMPORT_ERROR = str(_e)


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Project root:  vps-service/analyzers/social_card_generator.py → up 3 levels
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# Output directory for the generated PNG cards
OUTPUT_DIR = PROJECT_ROOT / 'public' / 'reports'

# Brand colors
COLOR_GOLD = '#d4af37'
COLOR_BG = '#0f172a'
COLOR_BG_LIGHT = '#1e293b'
COLOR_GREEN = '#10b981'
COLOR_RED = '#ef4444'
COLOR_TEXT = '#f8fafc'
COLOR_MUTED = '#94a3b8'

# Official links block (footer)
OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
}

# Template dimensions
TEMPLATE_DIMENSIONS = {
    'tomorrow_picks': (1080, 1350),
    'daily_summary': (1080, 1350),
    'weekly_summary': (1200, 628),
    'monthly_summary': (1200, 628),
}


# ─────────────────────────────────────────────────────────────────────────────
# SVG chart helpers (sparkline + bar chart)
# ─────────────────────────────────────────────────────────────────────────────

def _render_sparkline_svg(values: List[float], width: int = 200, height: int = 50,
                          color: str = COLOR_GREEN, fill_opacity: float = 0.2) -> str:
    """يرجع SVG sparkline من list of values.
    - line chart مع gradient fill تحت الخط
    - dot على آخر نقطة
    - responsive (viewBox)
    لو values فاضية或少 من 2 → رجع placeholder (خط متقطع)."""
    # Validate input
    if not values or len(values) < 2:
        mid_y = height / 2
        return (
            f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
            f'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">'
            f'<line x1="0" y1="{mid_y:.1f}" x2="{width}" y2="{mid_y:.1f}" '
            f'stroke="{COLOR_MUTED}" stroke-width="1" stroke-dasharray="3,3" opacity="0.4"/>'
            f'<text x="{width/2:.1f}" y="{mid_y + 4:.1f}" text-anchor="middle" '
            f'font-size="10" fill="{COLOR_MUTED}" font-family="Cairo,sans-serif">—</text>'
            f'</svg>'
        )

    # Normalize values to y-coordinates
    vmin = float(min(values))
    vmax = float(max(values))
    if vmax == vmin:
        # كل القيم متساوية → خط أفقي في النص
        normalized = [0.5] * len(values)
    else:
        rng = vmax - vmin
        normalized = [(float(v) - vmin) / rng for v in values]

    pad = 4  # padding علوي/سفلي
    usable_h = height - 2 * pad
    n = len(values)
    # x evenly spaced
    xs = [0.0 if n == 1 else (i / (n - 1)) * width for i in range(n)]
    # y مقلوب (SVG y بيكبر لتحت)
    ys = [pad + (1 - nv) * usable_h for nv in normalized]

    # polyline points
    points_str = ' '.join(f'{x:.2f},{y:.2f}' for x, y in zip(xs, ys))
    # polygon fill (الخط + ركنين تحت)
    fill_points = f'0,{height} ' + points_str + f' {width},{height}'

    last_x, last_y = xs[-1], ys[-1]
    # gradient id فريد (مبني على hash القيم)
    gid = 'spkl_' + str(abs(hash(tuple(round(float(v), 6) for v in values))) % 1000000)

    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">'
        f'<defs>'
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="{color}" stop-opacity="{fill_opacity}"/>'
        f'<stop offset="100%" stop-color="{color}" stop-opacity="0"/>'
        f'</linearGradient>'
        f'</defs>'
        f'<polygon points="{fill_points}" fill="url(#{gid})" />'
        f'<polyline points="{points_str}" fill="none" stroke="{color}" '
        f'stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />'
        f'<circle cx="{last_x:.2f}" cy="{last_y:.2f}" r="2.6" fill="{color}" '
        f'stroke="{COLOR_BG}" stroke-width="1" />'
        f'</svg>'
    )


def _render_bar_chart_svg(items: List[Dict], width: int = 400, height: int = 120) -> str:
    """Bar chart أفقي للـ top performers: [{ticker, change_percent}, ...]
    - كل bar لونه أخضر لو +ive، أحمر لو -ive
    - label الـ ticker جنب كل bar (يمين RTL)
    - قيمة النسبة في الآخر (يسار)
    لو items فاضي → placeholder."""
    if not items:
        return (
            f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
            f'xmlns="http://www.w3.org/2000/svg" font-family="Cairo,sans-serif">'
            f'<text x="{width/2:.1f}" y="{height/2:.1f}" text-anchor="middle" '
            f'font-size="13" fill="{COLOR_MUTED}">لا توجد بيانات</text>'
            f'</svg>'
        )

    n = len(items)
    label_w = 58   # يمين: ticker label
    value_w = 56   # يسار: قيمة النسبة
    gap = 6
    bar_area_x = value_w + gap
    bar_area_w = width - label_w - value_w - 2 * gap
    bar_right_edge = bar_area_x + bar_area_w  # الـ bars بتنمو لليسار من هنا
    row_h = height / n
    bar_h = min(row_h * 0.55, 14.0)

    # مقياس: أكبر |change_percent|
    max_abs = 0.0
    for it in items:
        try:
            max_abs = max(max_abs, abs(float(it.get('change_percent', 0) or 0)))
        except (TypeError, ValueError):
            pass
    if max_abs <= 0:
        max_abs = 1.0

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg" font-family="Cairo,sans-serif">'
    ]
    # خط الأساس الصفري (في نص منطقة الـ bars تقريباً — بس بما إن أغلب الـ top performers موجبة،
    # نرسم خط خفيف على يمين منطقة الـ bars كمرجع)
    parts.append(
        f'<line x1="{bar_right_edge:.1f}" y1="0" x2="{bar_right_edge:.1f}" y2="{height}" '
        f'stroke="{COLOR_MUTED}" stroke-width="0.5" opacity="0.25"/>'
    )

    for i, it in enumerate(items):
        ticker = str(it.get('ticker') or it.get('symbol') or '?')
        if len(ticker) > 7:
            ticker = ticker[:7]
        try:
            chg = float(it.get('change_percent', 0) or 0)
        except (TypeError, ValueError):
            chg = 0.0
        color = COLOR_GREEN if chg >= 0 else COLOR_RED
        cy = i * row_h + row_h / 2
        bar_len = (abs(chg) / max_abs) * bar_area_w
        if bar_len < 1:
            bar_len = 1  # الحد الأدنى عشان يبان
        bx = bar_right_edge - bar_len  # الحافة اليسرى للـ bar
        # الـ bar نفسه
        parts.append(
            f'<rect x="{bx:.1f}" y="{cy - bar_h/2:.1f}" '
            f'width="{bar_len:.1f}" height="{bar_h:.1f}" '
            f'rx="2" fill="{color}" opacity="0.85"/>'
        )
        # label الـ ticker (يمين)
        parts.append(
            f'<text x="{width - gap}" y="{cy + 4:.1f}" text-anchor="end" '
            f'font-size="12" font-weight="700" fill="{COLOR_TEXT}">{ticker}</text>'
        )
        # قيمة النسبة (يسار)
        sign = '+' if chg >= 0 else ''
        parts.append(
            f'<text x="{gap}" y="{cy + 4:.1f}" text-anchor="start" '
            f'font-size="11" font-weight="700" fill="{color}">{sign}{chg:.1f}%</text>'
        )

    parts.append('</svg>')
    return ''.join(parts)


def _sparkline_color(values: List[float]) -> str:
    """يلوّن الـ sparkline: أخضر لو القيمة الأخيرة >= الأولى، أحمر غير كده.
    لو values ناقصة → رمادي."""
    if not values or len(values) < 2:
        return COLOR_MUTED
    try:
        return COLOR_GREEN if float(values[-1]) >= float(values[0]) else COLOR_RED
    except (TypeError, ValueError):
        return COLOR_MUTED


# ─────────────────────────────────────────────────────────────────────────────
# Main class
# ─────────────────────────────────────────────────────────────────────────────

class SocialCardGenerator:
    """مولّد الصور الاجتماعية للمنصة (HTML → PNG via Playwright)"""

    def __init__(self, output_dir: Optional[str] = None):
        """
        Args:
            output_dir: مسار حفظ الصور (افتراضي = public/reports/)
        """
        if output_dir:
            self.output_dir = Path(output_dir)
        else:
            self.output_dir = OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def generate_card(self, template_type: str, data: Dict) -> Optional[str]:
        """
        توليد صورة Social Card من template + data.

        Args:
            template_type: 'tomorrow_picks' | 'daily_summary' | 'weekly_summary' | 'monthly_summary'
            data: dict يحتوي على البيانات المطلوبة لكل template

        Returns:
            مسار الصورة المولّدة، أو None لو فشل التوليد (Playwright مش متاح مثلاً)
        """
        if template_type not in TEMPLATE_DIMENSIONS:
            print(f"[SocialCardGenerator] Unknown template_type: {template_type}")
            return None

        if not PLAYWRIGHT_AVAILABLE:
            print(
                f"[SocialCardGenerator] Playwright not available "
                f"({PLAYWRIGHT_IMPORT_ERROR}). Returning None."
            )
            return None

        # Build HTML
        try:
            html_content = self._build_html(template_type, data)
        except Exception as e:
            print(f"[SocialCardGenerator] HTML build error: {e}")
            return None

        # Output filename
        date_str = datetime.now().strftime('%Y%m%d')
        filename = f"report_{template_type}_{date_str}.png"
        output_path = self.output_dir / filename

        width, height = TEMPLATE_DIMENSIONS[template_type]

        # Render via Playwright
        try:
            asyncio.run(self._html_to_png(html_content, str(output_path), width, height))
        except RuntimeError:
            # Event loop already running — try nest_asyncio fallback or run in thread
            try:
                import nest_asyncio
                nest_asyncio.apply()
                asyncio.run(self._html_to_png(html_content, str(output_path), width, height))
            except Exception as e:
                print(f"[SocialCardGenerator] asyncio run error: {e}")
                return None
        except Exception as e:
            print(f"[SocialCardGenerator] Playwright render error: {e}")
            return None

        if output_path.exists():
            return str(output_path)
        return None

    # ─────────────────────────────────────────────────────────────────────────
    # Playwright HTML → PNG
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    async def _html_to_png(html_content: str, output_path: str,
                           width: int = 1080, height: int = 1350) -> None:
        """تحويل HTML إلى PNG باستخدام Playwright (Chromium)."""
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page(viewport={'width': width, 'height': height})
                # set_content مع wait_until=networkidle لضمان تحميل الخطوط
                await page.set_content(html_content, wait_until='networkidle')
                # انتظار إضافي للتأكد من تحميل Google Fonts
                try:
                    await page.wait_for_timeout(800)
                except Exception:
                    pass
                await page.screenshot(path=output_path, full_page=False)
            finally:
                await browser.close()

    # ─────────────────────────────────────────────────────────────────────────
    # HTML builders
    # ─────────────────────────────────────────────────────────────────────────

    def _build_html(self, template_type: str, data: Dict) -> str:
        """يبني HTML كامل حسب نوع التقرير"""
        if template_type == 'tomorrow_picks':
            body = self._render_tomorrow_picks(data)
        elif template_type == 'daily_summary':
            body = self._render_daily_summary(data)
        elif template_type == 'weekly_summary':
            body = self._render_weekly_summary(data)
        elif template_type == 'monthly_summary':
            body = self._render_monthly_summary(data)
        else:
            body = '<div>Unknown template</div>'

        date_str = data.get('date') or datetime.now().strftime('%Y-%m-%d')

        return self._wrap_html(body, date_str, template_type)

    def _wrap_html(self, body: str, date_str: str, template_type: str) -> str:
        """غلاف HTML عام مع خط Cairo + RTL + header/footer"""
        title_map = {
            'tomorrow_picks': 'فرص الغد',
            'daily_summary': 'ملخص اليوم',
            'weekly_summary': 'ملخص الأسبوع',
            'monthly_summary': 'ملخص الشهر',
        }
        page_title = title_map.get(template_type, 'دليل الاستثمار')

        return f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>{page_title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    background: {COLOR_BG};
    color: {COLOR_TEXT};
    width: 100%;
    height: 100%;
    overflow: hidden;
  }}
  .card {{
    width: 100%;
    height: 100%;
    background: linear-gradient(160deg, {COLOR_BG} 0%, {COLOR_BG_LIGHT} 100%);
    display: flex;
    flex-direction: column;
    padding: 32px;
    position: relative;
  }}
  .header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid {COLOR_GOLD};
    padding-bottom: 16px;
    margin-bottom: 24px;
  }}
  .logo {{
    font-size: 28px;
    font-weight: 900;
    color: {COLOR_GOLD};
  }}
  .date {{ font-size: 18px; color: {COLOR_MUTED}; }}
  .body-area {{ flex: 1; overflow: hidden; }}
  .footer {{
    border-top: 1px solid rgba(212,175,55,0.3);
    padding-top: 12px;
    margin-top: 12px;
    font-size: 13px;
    color: {COLOR_MUTED};
    line-height: 1.7;
  }}
  .footer .links {{ display: flex; flex-direction: column; gap: 2px; }}
  .disclaimer {{
    margin-top: 6px;
    font-size: 11px;
    color: {COLOR_RED};
    opacity: 0.85;
  }}
  .tag {{
    display: inline-block;
    background: rgba(212,175,55,0.15);
    color: {COLOR_GOLD};
    border: 1px solid {COLOR_GOLD};
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 8px;
  }}
  h1 {{ font-size: 38px; font-weight: 900; color: {COLOR_TEXT}; margin-bottom: 8px; }}
  h2 {{ font-size: 24px; font-weight: 700; color: {COLOR_GOLD}; margin-bottom: 8px; }}
  .up {{ color: {COLOR_GREEN}; }}
  .down {{ color: {COLOR_RED}; }}
  .neutral {{ color: {COLOR_MUTED}; }}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="logo">📊 دليل الاستثمار</div>
    <div class="date">{date_str}</div>
  </div>
  <div class="body-area">{body}</div>
  <div class="footer">
    <div class="links">
      <span>🌐 invist.m2y.net</span>
      <span>📱 play.google.com/store/apps/details?id=com.egx.investment</span>
      <span>📘 facebook.com/profile.php?id=61590600300048</span>
      <span>✈️ t.me/Arabian_investment_guide</span>
    </div>
    <div class="disclaimer">📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈</div>
    <div class="disclaimer" style="margin-top:4px;">⚠️ تحليل تلقائي — ليس توقعة استثمارية</div>
  </div>
</div>
</body>
</html>"""

    # ─────────────────────────────────────────────────────────────────────────
    # Template: tomorrow_picks (1080×1350 — فرصة أو فرصتين للغد)
    # ─────────────────────────────────────────────────────────────────────────

    def _render_tomorrow_picks(self, data: Dict) -> str:
        picks: List[Dict] = data.get('picks') or []
        if not picks:
            return '<div style="text-align:center;color:#94a3b8;padding:40px;">لا توجد فرص واضحة للغد</div>'

        cards_html = []
        for i, p in enumerate(picks, 1):
            symbol = p.get('symbol', '-')
            name = p.get('name', '')
            price = p.get('price', 0)
            target = p.get('target', 0)
            stop = p.get('stop_loss', 0)
            upside = p.get('upside_pct') or (
                round((target - price) / price * 100, 1) if price else 0
            )
            reason = p.get('reason', '')
            cards_html.append(f"""
  <div style="background:rgba(30,41,59,0.85);border:2px solid {COLOR_GOLD};
                 border-radius:18px;padding:24px;margin-bottom:18px;">
    <div style="display:flex;justify-content:space-between;align-items:start;">
      <div>
        <div style="font-size:34px;font-weight:900;color:{COLOR_GOLD};">{symbol}</div>
        <div style="font-size:18px;color:{COLOR_MUTED};margin-top:4px;">{name}</div>
      </div>
      <div style="text-align:left;">
        <div style="font-size:14px;color:{COLOR_MUTED};">صعود متوقع</div>
        <div style="font-size:30px;font-weight:900;color:{COLOR_GREEN};">+{upside}%</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:20px;font-size:18px;">
      <div>💰 السعر<br><b style="font-size:24px;color:{COLOR_TEXT};">{price}</b></div>
      <div>🎯 الهدف<br><b style="font-size:24px;color:{COLOR_GREEN};">{target}</b></div>
      <div>🛑 وقف الخسارة<br><b style="font-size:24px;color:{COLOR_RED};">{stop}</b></div>
    </div>
    {f'<div style="margin-top:16px;font-size:15px;color:{COLOR_MUTED};line-height:1.6;">📌 {reason}</div>' if reason else ''}
  </div>""")

        picks_count = len(picks)
        return f"""
<div>
  <div class="tag">🌅 فرص الغد</div>
  <h1>توقعات الغد للسوق المصري</h1>
  <p style="color:{COLOR_MUTED};font-size:18px;margin-bottom:20px;">
    {picks_count} فرصة مختارة بعناية بناءً على درجة المايسترو + إشارة شراء
  </p>
  {''.join(cards_html)}
</div>"""

    # ─────────────────────────────────────────────────────────────────────────
    # Template: daily_summary (1080×1350 — ملخص يومي)
    # ─────────────────────────────────────────────────────────────────────────

    def _render_daily_summary(self, data: Dict) -> str:
        summary = data.get('summary') or {}
        gainers = data.get('top_gainers') or []
        losers = data.get('top_losers') or []
        gold = data.get('gold') or {}
        usd = data.get('usd_rate')

        total = summary.get('total_stocks', 0)
        up = summary.get('gainers', 0)
        down = summary.get('losers', 0)
        breadth = summary.get('market_breadth', 0)

        gainers_html = ''.join(
            f"<tr><td style='padding:6px 8px;color:{COLOR_TEXT};'>{i+1}. {g.get('symbol','')}</td>"
            f"<td style='padding:6px 8px;color:{COLOR_GREEN};font-weight:700;'>+{g.get('change_percent',0):.1f}%</td></tr>"
            for i, g in enumerate(gainers[:3])
        ) or '<tr><td colspan="2" style="color:#94a3b8;">—</td></tr>'

        losers_html = ''.join(
            f"<tr><td style='padding:6px 8px;color:{COLOR_TEXT};'>{i+1}. {l.get('symbol','')}</td>"
            f"<td style='padding:6px 8px;color:{COLOR_RED};font-weight:700;'>{l.get('change_percent',0):.1f}%</td></tr>"
            for i, l in enumerate(losers[:3])
        ) or '<tr><td colspan="2" style="color:#94a3b8;">—</td></tr>'

        gold_html = ''
        if gold:
            gold_html = (
                f"<div style='margin-top:14px;font-size:16px;'>"
                f"🥇 ذهب عيار 21: <b style='color:{COLOR_GOLD};'>{gold.get('price_21', '—')} ج.م</b>"
                f"</div>"
            )

        usd_html = ''
        if usd:
            usd_html = (
                f"<div style='font-size:16px;'>"
                f"💵 دولار: <b style='color:{COLOR_GOLD};'>{usd} ج.م</b>"
                f"</div>"
            )

        return f"""
<div>
  <div class="tag">📈 ملخص اليوم</div>
  <h1>أداء سوق مصر اليوم</h1>
  <div style="display:flex;justify-content:space-between;margin:24px 0;">
    <div style="background:rgba(30,41,59,0.6);border-radius:14px;padding:18px;flex:1;margin-left:8px;text-align:center;">
      <div style="font-size:14px;color:{COLOR_MUTED};">إجمالي الأسهم</div>
      <div style="font-size:30px;font-weight:900;">{total}</div>
    </div>
    <div style="background:rgba(16,185,129,0.12);border-radius:14px;padding:18px;flex:1;margin:0 8px;text-align:center;">
      <div style="font-size:14px;color:{COLOR_GREEN};">الصاعدات</div>
      <div style="font-size:30px;font-weight:900;color:{COLOR_GREEN};">{up}</div>
    </div>
    <div style="background:rgba(239,68,68,0.12);border-radius:14px;padding:18px;flex:1;margin:0 8px;text-align:center;">
      <div style="font-size:14px;color:{COLOR_RED};">الهابطات</div>
      <div style="font-size:30px;font-weight:900;color:{COLOR_RED};">{down}</div>
    </div>
    <div style="background:rgba(212,175,55,0.12);border-radius:14px;padding:18px;flex:1;margin-right:8px;text-align:center;">
      <div style="font-size:14px;color:{COLOR_GOLD};">اتساع السوق</div>
      <div style="font-size:30px;font-weight:900;color:{COLOR_GOLD};">{breadth}%</div>
    </div>
  </div>
  <div style="display:flex;gap:18px;">
    <div style="flex:1;background:rgba(30,41,59,0.6);border-radius:14px;padding:18px;">
      <h2 style="color:{COLOR_GREEN};font-size:20px;">🟢 أعلى الصاعدات</h2>
      <table style="width:100%;font-size:18px;">{gainers_html}</table>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.6);border-radius:14px;padding:18px;">
      <h2 style="color:{COLOR_RED};font-size:20px;">🔴 أعلى الهابطات</h2>
      <table style="width:100%;font-size:18px;">{losers_html}</table>
    </div>
  </div>
  <div style="background:rgba(30,41,59,0.6);border-radius:14px;padding:18px;margin-top:18px;">
    <h2 style="font-size:20px;">💰 أسعار المرجعية</h2>
    {gold_html}
    {usd_html}
  </div>
</div>"""

    # ─────────────────────────────────────────────────────────────────────────
    # Template: weekly_summary (1200×628 — ملخص أسبوعي)
    # ─────────────────────────────────────────────────────────────────────────

    def _render_weekly_summary(self, data: Dict) -> str:
        egx_perf = data.get('egx30_perf')
        best_stock = data.get('best_stock') or {}
        worst_stock = data.get('worst_stock') or {}
        gold_perf = data.get('gold_perf')
        usd_perf = data.get('usd_perf')
        lessons = data.get('lessons') or []
        watchlist = data.get('watchlist') or []
        # Sparkline + bar chart data (financial visualizations)
        spkl_egx = data.get('sparkline_egx') or []
        spkl_gold = data.get('sparkline_gold') or []
        spkl_usd = data.get('sparkline_usd') or []
        top_performers = data.get('top_performers') or []

        egx_html = (
            f"<span class='{'up' if (egx_perf or 0) >= 0 else 'down'}'>"
            f"{'+' if (egx_perf or 0) >= 0 else ''}{egx_perf}%</span>"
            if egx_perf is not None else '<span class="neutral">—</span>'
        )

        # Sparklines (160×36) — لون أخضر/أحمر حسب الاتجاه
        spkl_egx_svg = _render_sparkline_svg(spkl_egx, width=160, height=36,
                                             color=_sparkline_color(spkl_egx))
        spkl_gold_svg = _render_sparkline_svg(spkl_gold, width=160, height=36,
                                              color=_sparkline_color(spkl_gold))
        spkl_usd_svg = _render_sparkline_svg(spkl_usd, width=160, height=36,
                                             color=_sparkline_color(spkl_usd))
        # Bar chart لأفضل 5 أسهم (400×100)
        bar_chart_svg = _render_bar_chart_svg(top_performers, width=400, height=100)

        lessons_html = ''.join(
            f"<li style='font-size:13px;color:{COLOR_TEXT};margin:3px 0;'>{l}</li>"
            for l in lessons[:3]
        ) or f'<li style="color:{COLOR_MUTED};font-size:13px;">—</li>'

        watch_html = ''.join(
            f"<span style='background:rgba(212,175,55,0.15);color:{COLOR_GOLD};"
            f"border:1px solid {COLOR_GOLD};padding:3px 9px;border-radius:8px;"
            f"font-size:12px;margin-left:5px;display:inline-block;'>{s}</span>"
            for s in watchlist[:3]
        )

        return f"""
<div>
  <div class="tag" style="font-size:12px;">📅 ملخص الأسبوع</div>
  <h1 style="font-size:25px;margin-bottom:2px;">أداء الأسبوع: البورصة vs الذهب vs الدولار</h1>
  <!-- Row 1: stat cards مع sparklines (7 أيام) -->
  <div style="display:flex;gap:12px;margin:8px 0;">
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:12px;padding:9px 10px;text-align:center;">
      <div style="font-size:12px;color:{COLOR_MUTED};">EGX30</div>
      <div style="font-size:21px;font-weight:900;">{egx_html}</div>
      <div style="margin-top:3px;">{spkl_egx_svg}</div>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:12px;padding:9px 10px;text-align:center;">
      <div style="font-size:12px;color:{COLOR_MUTED};">🥇 الذهب</div>
      <div style="font-size:21px;font-weight:900;color:{COLOR_GOLD};">
        {('+' + str(gold_perf) + '%') if (gold_perf or 0) >= 0 else (str(gold_perf) + '%') if gold_perf is not None else '—'}
      </div>
      <div style="margin-top:3px;">{spkl_gold_svg}</div>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:12px;padding:9px 10px;text-align:center;">
      <div style="font-size:12px;color:{COLOR_MUTED};">💵 الدولار</div>
      <div style="font-size:21px;font-weight:900;color:{COLOR_GOLD};">
        {('+' + str(usd_perf) + '%') if (usd_perf or 0) >= 0 else (str(usd_perf) + '%') if usd_perf is not None else '—'}
      </div>
      <div style="margin-top:3px;">{spkl_usd_svg}</div>
    </div>
  </div>
  <!-- Row 2: bar chart لأفضل 5 أسهم أسبوعياً -->
  <div style="background:rgba(30,41,59,0.7);border-radius:12px;padding:6px 14px;margin:6px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;">
      <h2 style="font-size:13px;color:{COLOR_GREEN};">🏆 أفضل 5 أسهم أسبوعياً</h2>
      <span style="font-size:10px;color:{COLOR_MUTED};">آخر 7 أيام تداول</span>
    </div>
    <div>{bar_chart_svg}</div>
  </div>
  <!-- Row 3: best / worst / lessons -->
  <div style="display:flex;gap:12px;">
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:12px;padding:9px 11px;">
      <h2 style="font-size:13px;color:{COLOR_GREEN};">🏆 الأفضل</h2>
      <div style="font-size:15px;font-weight:700;">{best_stock.get('symbol','—')}</div>
      <div class="up" style="font-size:13px;">+{best_stock.get('change_percent',0):.1f}%</div>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:12px;padding:9px 11px;">
      <h2 style="font-size:13px;color:{COLOR_RED};">⚠️ الأسوأ</h2>
      <div style="font-size:15px;font-weight:700;">{worst_stock.get('symbol','—')}</div>
      <div class="down" style="font-size:13px;">{worst_stock.get('change_percent',0):.1f}%</div>
    </div>
    <div style="flex:1.5;background:rgba(30,41,59,0.7);border-radius:12px;padding:9px 11px;">
      <h2 style="font-size:13px;">💡 دروس للأسبوع</h2>
      <ul style="list-style:none;padding:0;">{lessons_html}</ul>
    </div>
  </div>
  <div style="margin-top:5px;font-size:12px;color:{COLOR_MUTED};">
    👀 أسهم للمتابعة: {watch_html or '—'}
  </div>
</div>"""

    # ─────────────────────────────────────────────────────────────────────────
    # Template: monthly_summary (1200×628 — ملخص شهري)
    # ─────────────────────────────────────────────────────────────────────────

    def _render_monthly_summary(self, data: Dict) -> str:
        month_name = data.get('month_name', '')
        egx_perf = data.get('egx30_perf')
        best5 = data.get('best_5') or []
        worst5 = data.get('worst_5') or []
        pred_stats = data.get('predictions_stats') or {}
        sectors = data.get('sectors') or []
        gold_perf = data.get('gold_perf')
        usd_perf = data.get('usd_perf')
        cert_rate = data.get('cert_rate')
        # Sparkline + bar chart data (financial visualizations — 30 يوم)
        spkl_egx = data.get('sparkline_egx') or []
        spkl_gold = data.get('sparkline_gold') or []
        spkl_usd = data.get('sparkline_usd') or []
        top_performers = data.get('top_performers') or []

        egx_html = (
            f"<span class='{'up' if (egx_perf or 0) >= 0 else 'down'}' style='font-weight:900;'>"
            f"{'+' if (egx_perf or 0) >= 0 else ''}{egx_perf}%</span>"
            if egx_perf is not None else '<span class="neutral">—</span>'
        )

        # Sparklines (200×50) للـ 30 يوم — لون حسب الاتجاه
        spkl_egx_svg = _render_sparkline_svg(spkl_egx, width=200, height=50,
                                             color=_sparkline_color(spkl_egx))
        spkl_gold_svg = _render_sparkline_svg(spkl_gold, width=200, height=50,
                                              color=_sparkline_color(spkl_gold))
        spkl_usd_svg = _render_sparkline_svg(spkl_usd, width=200, height=50,
                                             color=_sparkline_color(spkl_usd))
        # Bar chart لأفضل 5 أسهم شهرياً (top_performers = best5)
        bar_chart_svg = _render_bar_chart_svg(top_performers, width=400, height=110)

        worst_html = ''.join(
            f"<span style='font-size:12px;color:{COLOR_RED};margin-left:5px;'>"
            f"{s.get('symbol','—')} {s.get('change_percent',0):.0f}%</span>"
            for s in worst5[:5]
        ) or f'<span style="color:{COLOR_MUTED};">—</span>'

        sectors_html = ''.join(
            f"<span style='background:rgba(212,175,55,0.15);color:{COLOR_GOLD};"
            f"border:1px solid {COLOR_GOLD};padding:2px 7px;border-radius:6px;"
            f"font-size:11px;margin-left:4px;display:inline-block;'>{s}</span>"
            for s in sectors[:3]
        )

        pred_total = pred_stats.get('total', 0)
        pred_rate = pred_stats.get('success_rate', 0)

        return f"""
<div>
  <div class="tag" style="font-size:12px;">🗓️ ملخص {month_name}</div>
  <h1 style="font-size:25px;margin-bottom:2px;">التقرير الشهري لسوق مصر</h1>
  <!-- Row 1: EGX30 / Gold / USD مع sparklines (30 يوم) -->
  <div style="display:flex;gap:10px;margin:8px 0;">
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:10px;padding:8px 10px;text-align:center;">
      <div style="font-size:12px;color:{COLOR_MUTED};">EGX30 الشهري</div>
      <div style="font-size:19px;">{egx_html}</div>
      <div style="margin-top:3px;">{spkl_egx_svg}</div>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:10px;padding:8px 10px;text-align:center;">
      <div style="font-size:12px;color:{COLOR_MUTED};">🥇 الذهب</div>
      <div style="font-size:19px;font-weight:900;color:{COLOR_GOLD};">
        {('+' + str(gold_perf) + '%') if (gold_perf or 0) >= 0 else (str(gold_perf) + '%') if gold_perf is not None else '—'}
      </div>
      <div style="margin-top:3px;">{spkl_gold_svg}</div>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:10px;padding:8px 10px;text-align:center;">
      <div style="font-size:12px;color:{COLOR_MUTED};">💵 الدولار</div>
      <div style="font-size:19px;font-weight:900;color:{COLOR_GOLD};">
        {('+' + str(usd_perf) + '%') if (usd_perf or 0) >= 0 else (str(usd_perf) + '%') if usd_perf is not None else '—'}
      </div>
      <div style="margin-top:3px;">{spkl_usd_svg}</div>
    </div>
  </div>
  <!-- Row 2: bar chart لأفضل 5 أسهم شهرياً -->
  <div style="background:rgba(30,41,59,0.7);border-radius:10px;padding:5px 14px;margin:5px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2 style="font-size:13px;color:{COLOR_GREEN};">🏆 أفضل 5 أسهم شهرياً</h2>
      <span style="font-size:10px;color:{COLOR_MUTED};">أداء {month_name}</span>
    </div>
    <div>{bar_chart_svg}</div>
  </div>
  <!-- Row 3: cert + predictions + worst5 -->
  <div style="display:flex;gap:10px;margin:5px 0;">
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:10px;padding:8px 10px;text-align:center;">
      <div style="font-size:11px;color:{COLOR_MUTED};">🏦 شهادات الادخار</div>
      <div style="font-size:17px;font-weight:900;color:{COLOR_GOLD};">{cert_rate if cert_rate else '—'}%</div>
    </div>
    <div style="flex:1;background:rgba(30,41,59,0.7);border-radius:10px;padding:8px 10px;text-align:center;">
      <div style="font-size:11px;color:{COLOR_MUTED};">🎯 التوقعات</div>
      <div style="font-size:17px;font-weight:900;color:{COLOR_GOLD};">{pred_rate}%</div>
      <div style="font-size:9px;color:{COLOR_MUTED};">{pred_total} توقع</div>
    </div>
    <div style="flex:1.6;background:rgba(239,68,68,0.08);border-radius:10px;padding:8px 10px;">
      <h2 style="font-size:12px;color:{COLOR_RED};">🔴 أسوأ 5</h2>
      <div style="line-height:1.6;">{worst_html}</div>
    </div>
  </div>
  <div style="font-size:11px;color:{COLOR_MUTED};margin-top:2px;">
    🔍 قطاعات للمتابعة: {sectors_html or '—'}
  </div>
</div>"""


# ─────────────────────────────────────────────────────────────────────────────
# CLI entrypoint
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Demo: generate one card of each type
    gen = SocialCardGenerator()
    print(f"Output dir: {gen.output_dir}")
    print(f"Playwright available: {PLAYWRIGHT_AVAILABLE}")

    samples = {
        'tomorrow_picks': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'picks': [{
                'symbol': 'COMI',
                'name': 'البنك التجاري الدولي',
                'price': 25.50,
                'target': 28.00,
                'stop_loss': 24.00,
                'upside_pct': 9.8,
                'reason': 'اختراق مقاومة 25.4 بتزامن مع ارتفاع حجم التداول'
            }]
        },
        'daily_summary': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'summary': {'total_stocks': 200, 'gainers': 120, 'losers': 60, 'market_breadth': 60.0},
            'top_gainers': [{'symbol': 'COMI', 'change_percent': 9.8},
                            {'symbol': 'ETEL', 'change_percent': 7.2},
                            {'symbol': 'EFIH', 'change_percent': 5.4}],
            'top_losers': [{'symbol': 'AMOC', 'change_percent': -4.1},
                           {'symbol': 'ABUK', 'change_percent': -3.6},
                           {'symbol': 'FWRY', 'change_percent': -2.9}],
            'gold': {'price_21': 3411.24},
            'usd_rate': 51.82,
        },
        'weekly_summary': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'egx30_perf': 2.4,
            'best_stock': {'symbol': 'COMI', 'change_percent': 12.3},
            'worst_stock': {'symbol': 'AMOC', 'change_percent': -8.7},
            'gold_perf': 1.2,
            'usd_perf': 0.1,
            'lessons': ['الالتزام بوقف الخسارة يحمي رأس المال', 'السيولة العالية تقلل التذبذب'],
            'watchlist': ['COMI', 'ETEL', 'EFIH'],
            'sparkline_egx': [0.0, 0.4, 0.2, 0.9, 1.3, 1.1, 2.4],
            'sparkline_gold': [3380, 3395, 3401, 3408, 3415, 3412, 3420],
            'sparkline_usd': [51.8, 51.9, 51.85, 51.95, 51.9, 51.88, 51.86],
            'top_performers': [
                {'ticker': 'COMI', 'change_percent': 12.3},
                {'ticker': 'ETEL', 'change_percent': 9.8},
                {'ticker': 'EFIH', 'change_percent': 7.4},
                {'ticker': 'HRHO', 'change_percent': 5.6},
                {'ticker': 'SWDY', 'change_percent': 4.2},
            ],
        },
        'monthly_summary': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'month_name': 'يونيو',
            'egx30_perf': 5.8,
            'best_5': [{'symbol': 'COMI', 'change_percent': 22.1},
                       {'symbol': 'ETEL', 'change_percent': 18.4},
                       {'symbol': 'EFIH', 'change_percent': 15.2},
                       {'symbol': 'HRHO', 'change_percent': 12.0},
                       {'symbol': 'SWDY', 'change_percent': 10.5}],
            'worst_5': [{'symbol': 'AMOC', 'change_percent': -14.2},
                        {'symbol': 'ABUK', 'change_percent': -11.5},
                        {'symbol': 'FWRY', 'change_percent': -9.3},
                        {'symbol': 'CCAP', 'change_percent': -7.8},
                        {'symbol': 'MFPC', 'change_percent': -6.1}],
            'predictions_stats': {'total': 24, 'success_rate': 67},
            'sectors': ['البنوك', 'الاتصالات', 'العقارات'],
            'gold_perf': 3.4,
            'usd_perf': 1.2,
            'cert_rate': 27,
            'sparkline_egx': [0.0, 1.2, 0.8, 2.1, 3.4, 2.9, 4.1, 3.8, 4.5, 5.0, 4.7, 5.3, 5.8],
            'sparkline_gold': [3350, 3360, 3370, 3380, 3390, 3400, 3410, 3420, 3430, 3440, 3450, 3460, 3470],
            'sparkline_usd': [51.2, 51.3, 51.4, 51.5, 51.6, 51.7, 51.8, 51.9, 52.0, 52.1, 52.2, 52.3, 52.4],
            'top_performers': [
                {'ticker': 'COMI', 'change_percent': 22.1},
                {'ticker': 'ETEL', 'change_percent': 18.4},
                {'ticker': 'EFIH', 'change_percent': 15.2},
                {'ticker': 'HRHO', 'change_percent': 12.0},
                {'ticker': 'SWDY', 'change_percent': 10.5},
            ],
        },
    }

    for ttype, payload in samples.items():
        print(f"\nGenerating {ttype}...")
        path = gen.generate_card(ttype, payload)
        if path:
            print(f"  ✓ {path}")
        else:
            print(f"  ✗ failed (Playwright or render issue)")
