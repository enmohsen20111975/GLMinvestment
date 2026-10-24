#!/usr/bin/env python3
"""
telegram_chart_generator.py — مولد شارتات وبطاقات رادار الميكرز المرئية فائقة الجودة
===================================================================================
يقوم برسم شارت شموع يابانية احترافي (TradingView Style) للأسهم المصرية مع:
  1. الشموع اليابانية (OHLC) وأحجام التداول (Volume).
  2. مستويات رادار الميكرز: سعر الدخول، الهدف 1، الهدف 2، ووقف الخسارة.
  3. بطاقة معلومات متطورة ذات تصميم زجاجي داكن (Dark Emerald Glassmorphism).
  4. شعارات البورصة المصرية وهوية المنصة invist.m2y.net.

يستخدم Playwright لإنتاج صور PNG بدقة فائقة (High DPI) قابلة للنشر الفوري على التليجرام.
"""

import os
import sys
import json
import sqlite3
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for signal/accumulation/money_flow classification.
_VPS_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(_VPS_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_SERVICE_ROOT))
try:
    from utils.canonical_signal import classify_signal, signal_ar as canonical_signal_ar
except ImportError:  # pragma: no cover - fallback if utils not on path
    def classify_signal(_score):  # type: ignore[no-redef]
        return None
    def canonical_signal_ar(_sig):  # type: ignore[no-redef]
        return None

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'
PRICE_HISTORY_DB = DB_DIR / 'price_history.db'
STOCKS_DB = DB_DIR / 'stocks.db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'
OUTPUT_CHARTS_DIR = PROJECT_ROOT / 'public' / 'charts'
OUTPUT_CHARTS_DIR.mkdir(parents=True, exist_ok=True)

from playwright.async_api import async_playwright

def get_stock_candles(ticker: str, limit: int = 40) -> List[Dict]:
    """جلب بيانات الشموع اليومية للسهم من price_history.db."""
    if not PRICE_HISTORY_DB.exists():
        return []
    try:
        con = sqlite3.connect(PRICE_HISTORY_DB)
        con.row_factory = sqlite3.Row
        rows = con.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT ?
        """, (ticker, limit)).fetchall()
        con.close()
        
        # نعكس الترتيب ليكون تصاعدياً من الأقدم للأحدث على الشارت
        candles = []
        for r in reversed(rows):
            candles.append({
                'date': r['date'],
                'open': float(r['open_price'] or 0),
                'high': float(r['high_price'] or 0),
                'low': float(r['low_price'] or 0),
                'close': float(r['close_price'] or 0),
                'volume': int(r['volume'] or 0)
            })
        return candles
    except Exception as e:
        print(f"⚠️ خطأ جلب شموع {ticker}: {e}")
        return []

def get_stock_details(ticker: str) -> Dict:
    """جلب تفاصيل السهم ومستويات الرادار."""
    # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27 NO-FAKE-DATA)
    # Removed fabricated defaults: confidence=65, direction='تجميع صاعد مع الميكر'.
    # Numeric levels default to 0 / None — chart conditionally omits the
    # corresponding badges/lines (see build_svg_chart at lines ~210-243).
    data = {
        'ticker': ticker,
        'name': ticker,
        'name_ar': ticker,
        'current_price': 0.0,
        'change_pct': 0.0,
        'high': 0.0,
        'low': 0.0,
        'volume': 0,
        'tp1': 0.0,
        'tp2': 0.0,
        'sl': 0.0,
        'confidence': None,
        'direction': None,
        'signal': None,
    }

    if STOCKS_DB.exists():
        try:
            con = sqlite3.connect(STOCKS_DB)
            con.row_factory = sqlite3.Row
            r = con.execute("SELECT name, name_ar, current_price, change_percent, high_price, low_price, volume FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
            if r:
                data['name'] = r['name'] or ticker
                data['name_ar'] = r['name_ar'] or r['name'] or ticker
                data['current_price'] = float(r['current_price'] or 0)
                data['change_pct'] = float(r['change_percent'] or 0)
                data['high'] = float(r['high_price'] or 0)
                data['low'] = float(r['low_price'] or 0)
                data['volume'] = int(r['volume'] or 0)
            con.close()
        except Exception:
            pass

    if PREDICTIONS_DB.exists():
        try:
            con = sqlite3.connect(PREDICTIONS_DB)
            con.row_factory = sqlite3.Row
            r = con.execute("""
                SELECT target_price, target_price_2, stop_loss, confidence, signal
                FROM predictions
                WHERE ticker = ?
                ORDER BY id DESC LIMIT 1
            """, (ticker,)).fetchone()
            if r:
                data['tp1'] = float(r['target_price'] or 0)
                data['tp2'] = float(r['target_price_2'] or 0)
                data['sl'] = float(r['stop_loss'] or 0)
                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27)
                # Don't fabricate confidence=65 when NULL — preserve None.
                _raw_conf = r['confidence']
                data['confidence'] = int(_raw_conf) if _raw_conf is not None else None
                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
                # Stash canonical signal label so the chart card matches all
                # other screens (rule 67 — single source of truth).
                _raw_sig = r['signal']
                if _raw_sig:
                    data['signal'] = _raw_sig
                    data['direction'] = canonical_signal_ar(_raw_sig)
            con.close()
        except Exception:
            pass

    # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27 NO-FAKE-DATA)
    # Removed fabricated price-level fallbacks (was: tp1=p*1.055, tp2=p*1.115,
    # sl=p*0.955). Chart now conditionally skips drawing these levels when 0.
    return data

def build_svg_chart(candles: List[Dict], stock: Dict, width: int = 1000, height: int = 560) -> str:
    """بناء شارت شموع يابانية مخصص بنظام SVG فائق الوضوح والدقة."""
    if not candles:
        return f"<div style='color:white;text-align:center;padding:100px;'>لا تتوفر بيانات تاريخية كافية لسهم {stock['ticker']}</div>"

    # الهوامش
    m_top = 40
    m_bottom = 70
    m_left = 60
    m_right = 110 # للمستويات السعرية
    chart_w = width - m_left - m_right
    chart_h = height - m_top - m_bottom

    # حساب أعلى وأدنى سعر بما يشمل الأهداف ووقف الخسارة
    all_prices = [c['high'] for c in candles] + [c['low'] for c in candles]
    if stock['tp1'] > 0: all_prices.append(stock['tp1'])
    if stock['tp2'] > 0: all_prices.append(stock['tp2'])
    if stock['sl'] > 0: all_prices.append(stock['sl'])

    min_p = min(all_prices) * 0.985
    max_p = max(all_prices) * 1.015
    p_range = max(max_p - min_p, 0.001)

    max_vol = max([c['volume'] for c in candles] or [1])
    vol_h_max = chart_h * 0.22 # 22% من ارتفاع الشارت للفوليوم أسفل

    n = len(candles)
    step = chart_w / max(n, 1)
    candle_w = max(step * 0.65, 3)

    def y_coord(price):
        return m_top + chart_h - ((price - min_p) / p_range * chart_h)

    # خلفية الشبكة وخطوط الأسعار الأفقية
    grid_lines = []
    num_grids = 5
    for i in range(num_grids + 1):
        gp = min_p + (p_range * (i / num_grids))
        gy = y_coord(gp)
        grid_lines.append(f"""
            <line x1="{m_left}" y1="{gy}" x2="{width - m_right}" y2="{gy}" stroke="#1e3a34" stroke-width="1" stroke-dasharray="3,3" />
            <text x="{width - m_right + 8}" y="{gy + 4}" fill="#718096" font-size="12" font-family="'Cairo', sans-serif">{gp:.2f}</text>
        """)

    # رسم الشموع وأعمدة الفوليوم
    svg_elements = []
    date_labels = []
    label_step = max(n // 6, 1)

    for i, c in enumerate(candles):
        cx = m_left + (i * step) + (step / 2)
        cy_open = y_coord(c['open'])
        cy_close = y_coord(c['close'])
        cy_high = y_coord(c['high'])
        cy_low = y_coord(c['low'])

        is_bull = c['close'] >= c['open']
        c_color = "#10b981" if is_bull else "#ef4444"
        v_color = "rgba(16, 185, 129, 0.35)" if is_bull else "rgba(239, 68, 68, 0.35)"

        # عمود الفوليوم أسفل
        v_h = (c['volume'] / max_vol) * vol_h_max
        v_y = m_top + chart_h - v_h
        svg_elements.append(f'<rect x="{cx - candle_w/2}" y="{v_y}" width="{candle_w}" height="{v_h}" fill="{v_color}" rx="1"/>')

        # ظل الشمعة (Wick)
        svg_elements.append(f'<line x1="{cx}" y1="{cy_high}" x2="{cx}" y2="{cy_low}" stroke="{c_color}" stroke-width="1.5" />')

        # جسم الشمعة (Body)
        body_y = min(cy_open, cy_close)
        body_h = max(abs(cy_close - cy_open), 2)
        svg_elements.append(f'<rect x="{cx - candle_w/2}" y="{body_y}" width="{candle_w}" height="{body_h}" fill="{c_color}" rx="1"/>')

        # تواريخ المحور الأفقي
        if i % label_step == 0 or i == n - 1:
            d_str = c['date'][5:] # MM-DD
            date_labels.append(f'<text x="{cx}" y="{height - m_bottom + 22}" fill="#a0aec0" font-size="11" text-anchor="middle" font-family="sans-serif">{d_str}</text>')

    # رسم خطوط رادار الميكرز الأفقية مع علامات مميزة (Badges)
    maker_levels = []
    
    # 1. Target 2
    if stock['tp2'] > 0:
        y_tp2 = y_coord(stock['tp2'])
        maker_levels.append(f"""
            <line x1="{m_left}" y1="{y_tp2}" x2="{width - m_right}" y2="{y_tp2}" stroke="#059669" stroke-width="2" stroke-dasharray="6,4" />
            <rect x="{width - m_right + 6}" y="{y_tp2 - 12}" width="98" height="24" rx="5" fill="#059669" />
            <text x="{width - m_right + 55}" y="{y_tp2 + 4}" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle" font-family="'Cairo', sans-serif">🎯 TP2: {stock['tp2']:.2f}</text>
        """)

    # 2. Target 1
    if stock['tp1'] > 0:
        y_tp1 = y_coord(stock['tp1'])
        maker_levels.append(f"""
            <line x1="{m_left}" y1="{y_tp1}" x2="{width - m_right}" y2="{y_tp1}" stroke="#10b981" stroke-width="2.5" stroke-dasharray="5,3" />
            <rect x="{width - m_right + 6}" y="{y_tp1 - 12}" width="98" height="24" rx="5" fill="#10b981" />
            <text x="{width - m_right + 55}" y="{y_tp1 + 4}" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle" font-family="'Cairo', sans-serif">🎯 TP1: {stock['tp1']:.2f}</text>
        """)

    # 3. Current Entry
    if stock['current_price'] > 0:
        y_curr = y_coord(stock['current_price'])
        maker_levels.append(f"""
            <line x1="{m_left}" y1="{y_curr}" x2="{width - m_right}" y2="{y_curr}" stroke="#38bdf8" stroke-width="1.8" />
            <rect x="{width - m_right + 6}" y="{y_curr - 12}" width="98" height="24" rx="5" fill="#0284c7" />
            <text x="{width - m_right + 55}" y="{y_curr + 4}" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle" font-family="'Cairo', sans-serif">دخول: {stock['current_price']:.2f}</text>
        """)

    # 4. Stop Loss
    if stock['sl'] > 0:
        y_sl = y_coord(stock['sl'])
        maker_levels.append(f"""
            <line x1="{m_left}" y1="{y_sl}" x2="{width - m_right}" y2="{y_sl}" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,4" />
            <rect x="{width - m_right + 6}" y="{y_sl - 12}" width="98" height="24" rx="5" fill="#dc2626" />
            <text x="{width - m_right + 55}" y="{y_sl + 4}" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle" font-family="'Cairo', sans-serif">🛡 SL: {stock['sl']:.2f}</text>
        """)

    return f"""
    <svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0b1714" />
          <stop offset="100%" stop-color="#060e0c" />
        </linearGradient>
      </defs>
      <rect width="{width}" height="{height}" fill="url(#bgGrad)" rx="16" />
      
      <!-- شبكة الأسعار -->
      {''.join(grid_lines)}
      
      <!-- الشموع والفوليوم -->
      {''.join(svg_elements)}
      
      <!-- مستويات الرادار -->
      {''.join(maker_levels)}
      
      <!-- تواريخ المحور الأفقي -->
      {''.join(date_labels)}
      
      <!-- تسمية الحجم -->
      <text x="{m_left + 10}" y="{m_top + chart_h - vol_h_max - 8}" fill="#4a5568" font-size="10" font-family="sans-serif">VOLUME (20D HIST)</text>
    </svg>
    """

def render_html_card(stock: Dict, svg_chart: str) -> str:
    """بناء الصفحة الكاملة للبطاقة التسويقية المصورة."""
    change_color = '#10b981' if stock['change_pct'] >= 0 else '#ef4444'
    change_sign = '+' if stock['change_pct'] >= 0 else ''

    # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27 NO-FAKE-DATA)
    # Don't fabricate price levels when missing — show "—" placeholder.
    _cur = stock['current_price']
    tp1_gain = ((stock['tp1'] - _cur) / _cur * 100) if (_cur > 0 and stock['tp1'] > 0) else 0
    tp2_gain = ((stock['tp2'] - _cur) / _cur * 100) if (_cur > 0 and stock['tp2'] > 0) else 0
    sl_loss = ((_cur - stock['sl']) / _cur * 100) if (_cur > 0 and stock['sl'] > 0) else 0

    # Rule 27: when level missing, show "—" instead of fabricated value.
    tp1_val = f"{stock['tp1']:.2f} <span style='font-size:13px;'>(+{tp1_gain:.1f}%)</span>" if stock['tp1'] > 0 else "—"
    tp2_val = f"{stock['tp2']:.2f} <span style='font-size:13px;'>(+{tp2_gain:.1f}%)</span>" if stock['tp2'] > 0 else "—"
    sl_val = f"{stock['sl']:.2f} <span style='font-size:13px;'>(-{sl_loss:.1f}%)</span>" if stock['sl'] > 0 else "—"
    conf_val = f"{stock['confidence']}%" if stock.get('confidence') is not None else "—"

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
      background: #040908;
      width: 1080px;
      height: 1080px;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 32px;
      overflow: hidden;
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,78,59,0.2) 100%);
      border: 1px solid rgba(16,185,129,0.3);
      padding: 18px 26px;
      border-radius: 20px;
    }}
    .stock-title {{
      display: flex;
      align-items: center;
      gap: 16px;
    }}
    .ticker-badge {{
      background: #10b981;
      color: #040908;
      font-size: 28px;
      font-weight: 900;
      padding: 4px 18px;
      border-radius: 12px;
      letter-spacing: 1px;
    }}
    .stock-names {{
      display: flex;
      flex-direction: column;
    }}
    .stock-name-ar {{
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
    }}
    .stock-sub {{
      font-size: 13px;
      color: #94a3b8;
    }}
    .price-block {{
      text-align: left;
    }}
    .current-price {{
      font-size: 32px;
      font-weight: 900;
      color: #ffffff;
    }}
    .change-badge {{
      font-size: 16px;
      font-weight: 700;
      color: {change_color};
      background: rgba(255,255,255,0.06);
      padding: 2px 10px;
      border-radius: 8px;
      display: inline-block;
    }}
    .chart-container {{
      margin: 16px 0;
      border-radius: 18px;
      border: 1px solid #1a332d;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      display: flex;
      justify-content: center;
      align-items: center;
      background: #07120f;
    }}
    .metrics-row {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 16px;
    }}
    .metric-card {{
      background: rgba(15,35,30,0.7);
      border: 1px solid #1f473c;
      border-radius: 14px;
      padding: 12px 16px;
      text-align: center;
    }}
    .metric-label {{
      font-size: 13px;
      color: #94a3b8;
      font-weight: 600;
      margin-bottom: 4px;
    }}
    .metric-value {{
      font-size: 22px;
      font-weight: 900;
    }}
    .footer {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #081613;
      border-top: 1px solid #1c3d33;
      padding: 14px 24px;
      border-radius: 16px;
      font-size: 13px;
    }}
    .footer-left {{
      color: #d4af37;
      font-weight: 700;
    }}
    .footer-right {{
      color: #94a3b8;
    }}
  </style>
</head>
<body>

  <!-- رأس البطاقة -->
  <div class="header">
    <div class="stock-title">
      <div class="ticker-badge">{stock['ticker']}</div>
      <div class="stock-names">
        <div class="stock-name-ar">{stock['name_ar']}</div>
        <div class="stock-sub">بورصة مصر (EGX) • رادار الميكرز V40.2</div>
      </div>
    </div>
    <div class="price-block">
      <div class="current-price">{stock['current_price']:.2f} <span style="font-size:16px;color:#94a3b8;">ج.م</span></div>
      <div class="change-badge">{change_sign}{stock['change_pct']:.2f}%</div>
    </div>
  </div>

  <!-- الشارت -->
  <div class="chart-container">
    {svg_chart}
  </div>

  <!-- شبكة الأهداف ومؤشرات الرادار -->
  <div class="metrics-row">
    <div class="metric-card" style="border-color:#10b981;">
      <div class="metric-label">🎯 الهدف الأول (TP1)</div>
      <div class="metric-value" style="color:#10b981;">{tp1_val}</div>
    </div>
    <div class="metric-card" style="border-color:#059669;">
      <div class="metric-label">🚀 الهدف الثاني (TP2)</div>
      <div class="metric-value" style="color:#34d399;">{tp2_val}</div>
    </div>
    <div class="metric-card" style="border-color:#ef4444;">
      <div class="metric-label">🛡 وقف الخسارة (SL)</div>
      <div class="metric-value" style="color:#ef4444;">{sl_val}</div>
    </div>
    <div class="metric-card" style="border-color:#d4af37;">
      <div class="metric-label">🔒 دقة وثقة الرادار</div>
      <div class="metric-value" style="color:#d4af37;">{conf_val}</div>
    </div>
  </div>

  <!-- تذييل المنصة والروابط -->
  <div class="footer">
    <div class="footer-left">
      ⚡ invist.m2y.net — تداول كالمحترفين مع خوارزميات صانع السوق
    </div>
    <div class="footer-right">
      ✈️ التليجرام: @Arabian_investment_guide | 🤖 البوت: @investusernamebot
    </div>
  </div>

</body>
</html>
"""

async def generate_stock_chart_image(ticker: str) -> Optional[Path]:
    """توليد صورة الشارت بدقة عالية وحفظها كملف PNG."""
    candles = get_stock_candles(ticker, limit=35)
    stock = get_stock_details(ticker)
    
    svg = build_svg_chart(candles, stock, width=1016, height=580)
    html = render_html_card(stock, svg)
    
    out_file = OUTPUT_CHARTS_DIR / f"radar_chart_{ticker}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            )
            page = await browser.new_page(viewport={'width': 1080, 'height': 1080}, device_scale_factor=1.5)
            await page.set_content(html, wait_until='load', timeout=7000)
            await page.screenshot(path=str(out_file), type='png')
            await browser.close()
            
        print(f"✅ تم توليد شارت السهم بنجاح: {out_file}")
        return out_file
    except Exception as e:
        print(f"❌ خطأ أثناء توليد صورة الشارت: {e}")
        return None

if __name__ == '__main__':
    ticker_to_run = sys.argv[1] if len(sys.argv) > 1 else 'COMI'
    print(f"🎨 جاري توليد شارت احترافي لسهم {ticker_to_run}...")
    res = asyncio.run(generate_stock_chart_image(ticker_to_run))
    if res and res.exists():
        print(f"🎉 مسار الصورة الناتج: {res}")
    else:
        print("❌ فشل توليد الصورة")
