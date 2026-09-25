#!/usr/bin/env python3
"""
telegram_sectors_report.py
==========================
تقرير حركة وتدوير قطاعات البورصة المصرية (Sector Rotation & Liquidity Flow)
منصة دليل الاستثمار (GLMinvestment)
يستخرج حركة السيولة، تدوير الأموال الذكية، والقطاعات الساخنة وأسهم القيادة.
"""

import os
import sys
import json
import sqlite3
import logging
import requests
from datetime import datetime
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

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger("SectorsReport")

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

SECTOR_NAMES_AR = {
    'Finance': 'الخدمات المالية غير المصرفية والمدفوعات',
    'Banks': 'البنوك والقطاع المصرفي',
    'Health Services': 'الرعاية الصحية والمستشفيات',
    'Producer Manufacturing': 'الصناعات والسلع الإنتاجية',
    'Industrial Services': 'الخدمات والتوريدات الصناعية',
    'Process Industries': 'الصناعات التحويلية والبتروكيماويات',
    'Communications': 'الاتصالات وتكنولوجيا المعلومات',
    'Consumer Durables': 'السلع المعمرة والأجهزة الكهربائية',
    'Health Technology': 'الأدوية والتكنولوجيا الطبية',
    'Utilities': 'المرافق والطاقة النظيفة',
    'Commercial Services': 'الخدمات التجارية واللوجستية',
    'Distribution Services': 'التجارة والموزعون',
    'Consumer Non-Durables': 'الأغذية والمشروبات والسلع الأساسية',
    'Technology Services': 'البرمجيات وتكنولوجيا الدفع',
    'Non-Energy Minerals': 'المعادن والصلب ومواد البناء',
    'Energy Minerals': 'الطاقة والتعدين والغاز',
    'Consumer Services': 'السياحة والفنادق والترفيه',
    'Transportation': 'النقل واللوجستيات والشحن والتفريغ',
    'Retail Trade': 'تجارة التجزئة والمطاحن الاستراتيجية',
    'Real Estate': 'العقارات والإنشاءات والتطوير العمراني',
}

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
            log.info(f"✓ تم بث تقرير القطاعات بنجاح (Message ID: {res['result']['message_id']})")
            return True
        else:
            log.error(f"❌ خطأ من تليجرام: {res}")
            return False
    except Exception as e:
        log.error(f"❌ استثناء أثناء الإرسال: {e}")
        return False

def get_detailed_sectors_data() -> Dict:
    """جلب بيانات القطاعات وتحليل التدفقات والتدوير."""
    sectors = []
    total_volume = 0
    
    # 1. محاولة استدعاء backend API
    try:
        r = requests.get("http://127.0.0.1:8010/api/sectors/tracking?market=EGX&with_stocks=1", timeout=4)
        if r.status_code == 200:
            data = r.json()
            if data.get('success') and data.get('sectors'):
                raw_sectors = data['sectors']
                for s in raw_sectors:
                    sec_name = s.get('sector', '')
                    if not sec_name or sec_name in ('—', 'Diversified', 'Miscellaneous'):
                        continue
                    ar_name = SECTOR_NAMES_AR.get(sec_name, sec_name)
                    leader_tk = s.get('leader_ticker', '')
                    leader_ar = get_arabic_stock_name(leader_tk, leader_tk)
                    turnover = float(s.get('turnover') or 0)
                    total_volume += turnover
                    
                    stocks_list = []
                    for st in (s.get('stocks') or [])[:3]:
                        st_tk = st.get('ticker')
                        st_name = get_arabic_stock_name(st_tk, st.get('name_ar') or st_tk)
                        stocks_list.append({
                            'ticker': st_tk,
                            'name': st_name,
                            'change': float(st.get('change_percent') or 0),
                            'price': float(st.get('current_price') or 0)
                        })

                    sectors.append({
                        'sector_key': sec_name,
                        'name': ar_name,
                        'avg_change': float(s.get('avg_change') or 0),
                        'heat': s.get('heat_ar', 'نشط 🔥') if float(s.get('avg_change') or 0) >= 0.5 else 'هادئ 🟡',
                        'gainers': int(s.get('gainers') or 0),
                        'losers': int(s.get('losers') or 0),
                        'leader_ticker': leader_tk,
                        'leader_name': leader_ar,
                        'leader_change': float(s.get('leader_change') or 0),
                        'turnover': turnover,
                        'top_stocks': stocks_list
                    })
                if sectors:
                    sectors.sort(key=lambda x: x['turnover'], reverse=True)
                    return {'sectors': sectors, 'total_volume': total_volume}
    except Exception:
        pass

    # 2. Fallback لقاعدة stocks.db
    if STOCKS_DB.exists():
        try:
            conn = sqlite3.connect(str(STOCKS_DB))
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT sector, count(*) as count, round(avg(change_percent), 2) as avg_chg, sum(volume) as total_vol
                FROM stocks
                WHERE sector IS NOT NULL AND sector != '' AND sector NOT IN ('—', 'Diversified', 'Miscellaneous')
                GROUP BY sector
                ORDER BY total_vol DESC
            """).fetchall()
            
            for r in rows:
                sec_raw = r['sector']
                ar_name = SECTOR_NAMES_AR.get(sec_raw, sec_raw)
                vol = float(r['total_vol'] or 0)
                total_volume += vol
                
                # قائد القطاع
                lead_row = conn.execute("""
                    SELECT ticker, name_ar, current_price, change_percent
                    FROM stocks
                    WHERE sector = ?
                    ORDER BY volume DESC LIMIT 1
                """, (sec_raw,)).fetchone()
                
                lead_tk = lead_row['ticker'] if lead_row else ''
                lead_ar = get_arabic_stock_name(lead_tk, lead_row['name_ar'] if lead_row else lead_tk)
                lead_chg = float(lead_row['change_percent'] if lead_row else 0)

                # أعلى 3 أسهم نشاطاً
                top_rows = conn.execute("""
                    SELECT ticker, name_ar, current_price, change_percent
                    FROM stocks
                    WHERE sector = ?
                    ORDER BY volume DESC LIMIT 3
                """, (sec_raw,)).fetchall()
                st_list = []
                for st in top_rows:
                    st_tk = st['ticker']
                    st_list.append({
                        'ticker': st_tk,
                        'name': get_arabic_stock_name(st_tk, st['name_ar'] or st_tk),
                        'change': float(st['change_percent'] or 0),
                        'price': float(st['current_price'] or 0)
                    })

                avg_c = float(r['avg_chg'] or 0)
                sectors.append({
                    'sector_key': sec_raw,
                    'name': ar_name,
                    'avg_change': avg_c,
                    'heat': 'نشط 🔥' if avg_c >= 0.5 else ('معتدل ⚖️' if avg_c >= 0 else 'تصحيحي ❄️'),
                    'gainers': 0,
                    'losers': 0,
                    'leader_ticker': lead_tk,
                    'leader_name': lead_ar,
                    'leader_change': lead_chg,
                    'turnover': vol,
                    'top_stocks': st_list
                })
            conn.close()
        except Exception as e:
            log.warning(f"fallback sectors err: {e}")

    return {'sectors': sectors, 'total_volume': total_volume}

def generate_sectors_report_message() -> Tuple[str, dict]:
    """توليد نص التقرير الاحترافي لحركة وتدوير القطاعات."""
    today = datetime.now().strftime('%Y-%m-%d')
    res = get_detailed_sectors_data()
    sectors = res.get('sectors', [])

    msg = f"""🌐 <b>تقرير حركة وتدوير قطاعات السوق | منصة دليل الاستثمار</b>
📅 <b>تاريخ التقرير: {today}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 <b>خارطة تدفق السيولة بين القطاعات (Sector Flow):</b>
ترصد خوارزميات المنصة حركة الأموال الذكية والمؤسسية وتدويرها بين قطاعات السوق لتحديد الوجهة القادمة للفرص:
"""

    if sectors:
        # 1. أفضل 3 قطاعات ساخنة متصدرة
        msg += "\n🔥 <b>القطاعات الأكثر جذباً للسيولة والصعود:</b>\n"
        for idx, sec in enumerate(sectors[:4], 1):
            sign = "+" if sec['avg_change'] >= 0 else ""
            turnover_str = f"{sec['turnover'] / 1_000_000:.1f}M سهم/ج.م"
            lead_sign = "+" if sec['leader_change'] >= 0 else ""
            msg += f"""
<b>{idx}. {sec['name']}</b> ({sec['heat']})
• متوسط أداء القطاع: <b>{sign}{sec['avg_change']:.2f}%</b>
• حجم السيولة المتدفقة: <b>{turnover_str}</b>
• السهم القائد: <b>{sec['leader_name']} (#{sec['leader_ticker']})</b> ({lead_sign}{sec['leader_change']:.2f}%)"""

            # عرض أهم أسهم القطاع
            if sec.get('top_stocks'):
                stocks_line = " | ".join([f"{s['name']}: {('+' if s['change']>=0 else '')}{s['change']:.1f}%" for s in sec['top_stocks'][:3]])
                msg += f"\n  <i>أبرز الأسهم: {stocks_line}</i>\n"

        # 2. قطاعات التجميع الهادئ
        quiet_sectors = [s for s in sectors[4:8] if s['avg_change'] >= -1.0]
        if quiet_sectors:
            msg += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚓ <b>قطاعات في طور التجميع والهدوء النسبي:</b>\n"
            for q in quiet_sectors[:3]:
                sign = "+" if q['avg_change'] >= 0 else ""
                msg += f"• <b>{q['name']}</b> ({sign}{q['avg_change']:.2f}%) — القائد: <b>{q['leader_name']}</b>\n"

        msg += """
━━━━━━━━━━━━━━━━━━━━━━━━━━
🧭 <b>نصيحة التدوير القطاعي (Sector Rotation Insight):</b>
• عندما يهدأ الزخم على القطاعات المرتفعة، تبدأ السيولة في الانتقال إلى قطاعات التجميع ذات الأسعار المتدنية.
• راقب الأسهم القيادية في قطاعات التجميع لاقتناص بداية الموجة الصاعدة قبل الانطلاق.
"""
    else:
        msg += "\n🔍 <i>جاري تحليل بيانات تدفقات القطاعات وتحديث التقرير...</i>\n"

    msg += f"""━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 <b>استكشف خريطة القطاعات التفاعلية ورادار السيولة الحية:</b>
{format_caption_links_block()}"""

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "🌐 فتح خريطة القطاعات التفاعلية", "url": "https://invist.m2y.net/#specialist-analysis"},
                {"text": "🎯 شاشة التوقعات والفرص", "url": "https://invist.m2y.net/#recommendations"}
            ],
            [
                {"text": "📱 تحميل تطبيق الأندرويد", "url": "https://play.google.com/store/apps/details?id=com.egx.investment"},
                {"text": "🤖 فحص قطاع أو سهم بالبوت", "url": "https://t.me/investusernamebot"}
            ]
        ]
    }

    return msg.strip(), keyboard

def broadcast_sectors_report():
    """تنفيذ بث تقرير القطاعات إلى القناة."""
    log.info("📢 بدء تجهيز وبث تقرير القطاعات...")
    msg, kb = generate_sectors_report_message()
    success = send_channel_message(msg, reply_markup=kb)
    return success

run_sectors_report = broadcast_sectors_report

if __name__ == "__main__":
    if "--preview" in sys.argv:
        msg, _ = generate_sectors_report_message()
        print("=== PREVIEW SECTORS REPORT ===")
        print(msg)
    else:
        broadcast_sectors_report()
