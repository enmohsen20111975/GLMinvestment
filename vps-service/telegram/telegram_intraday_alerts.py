#!/usr/bin/env python3
"""
telegram_intraday_alerts.py — تنبيهات الاختراق اللحظية لرادار الميكرز أثناء الجلسة
================================================================================
الذراع الإعلاني والتسويقي الميداني أثناء جلسة التداول (10:00 ص - 2:30 م بتوقيت القاهرة).

المهام:
  1. رصد إشارات الاختراق اللحظية وحجم التداول غير الطبيعي (Volume Spikes) للأسهم الخاضعة لتجميع الميكرز.
  2. استخراج مستويات الدخول، الهدف الأول (TP1)، الهدف الثاني (TP2)، ووقف الخسارة (SL).
  3. صياغة بطاقة تسويقية واحترافية عالية الجاذبية مع أزرار دعوة لاتخاذ إجراء (Call to Action).
  4. منع التكرار والإزعاج (Throttling) عبر ملف حالة intraday_alerts_state.json.

الاستخدام:
  python3 telegram_intraday_alerts.py           # فحص ونشر التنبيهات المؤهلة
  python3 telegram_intraday_alerts.py --preview # استعراض بدون إرسال فعلي
  python3 telegram_intraday_alerts.py --force   # إرسال حتى لو كانت خارج أوقات الجلسة
"""

import os
import sys
import json
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime, time
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'
STOCKS_DB = DB_DIR / 'stocks.db'
DATA_ENGINE_DB = DB_DIR / 'data_engine.db'
STATE_FILE = Path(__file__).resolve().parent / 'intraday_alerts_state.json'

# Platform Links
OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net/#dashboard',
    'radar_url': 'https://invist.m2y.net/#recommendations',
    'chart_url': 'https://invist.m2y.net/#trading-chart',
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

def is_market_hours() -> bool:
    """التحقق من أن التوقيت الحالي يقع داخل جلسة البورصة المصرية (10:00 ص - 2:30 م)."""
    now = datetime.now()
    # أيام التداول في البورصة المصرية: الأحد (6) إلى الخميس (3) في تقويم بايثون:
    # Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6
    if now.weekday() in (4, 5): # الجمعة والسبت عطلة
        return False
    market_open = time(10, 0)
    market_close = time(14, 30)
    return market_open <= now.time() <= market_close

def load_alert_state() -> dict:
    today_str = datetime.now().strftime('%Y-%m-%d')
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if data.get('date') == today_str:
                    return data
        except Exception:
            pass
    return {'date': today_str, 'sent_tickers': [], 'alert_count': 0}

def save_alert_state(state: dict):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ خطأ في حفظ حالة التنبيهات: {e}")

def get_intraday_breakout_candidates():
    """استخراج الأسهم التي تظهر إشارات اختراق أو نشاط استثنائي من predictions.db ورادار الميكرز."""
    candidates = []
    
    # 1. فحص ملف الرادار الأحدث
    output_dir = PROJECT_ROOT / 'scripts' / 'output'
    radar_file = None
    if output_dir.exists():
        files = sorted([f for f in output_dir.iterdir() if f.name.startswith('maker_radar_') and f.name.endswith('.json')])
        if files:
            radar_file = files[-1]
            
    radar_data = {}
    if radar_file and radar_file.exists():
        try:
            with open(radar_file, 'r', encoding='utf-8') as f:
                radar_data = json.load(f)
        except Exception:
            pass

    # جمع القوائم النشطة من الرادار
    radar_stocks = (
        (radar_data.get('top_explosions') or []) +
        (radar_data.get('surge_detector_list') or []) +
        (radar_data.get('explosive_list') or []) +
        (radar_data.get('pre_surge_list') or []) +
        (radar_data.get('early_break_list') or [])
    )
    
    radar_dict = {s.get('ticker'): s for s in radar_stocks if s.get('ticker')}

    # أسماء الأسهم وأسعارها اللحظية من stocks.db
    stocks_info = {}
    if STOCKS_DB.exists():
        try:
            s_con = sqlite3.connect(STOCKS_DB)
            s_con.row_factory = sqlite3.Row
            for r in s_con.execute("SELECT ticker, name, name_ar, current_price, change_percent, volume FROM stocks").fetchall():
                stocks_info[r['ticker']] = dict(r)
            s_con.close()
        except Exception as e:
            print(f"⚠️ خطأ في قراءة stocks.db: {e}")

    # 2. الاستعلام من predictions.db للأسهم النشطة والمحدثة فقط
    pred_rows = []
    if PREDICTIONS_DB.exists():
        try:
            con = sqlite3.connect(PREDICTIONS_DB)
            con.row_factory = sqlite3.Row
            pred_rows = con.execute("""
                SELECT p.ticker, p.signal, p.confidence, p.target_price, p.target_price_2, 
                       p.stop_loss, p.entry_price, p.created_at, p.prediction_date
                FROM predictions p
                WHERE p.signal IN ('STRONG_BUY', 'BUY')
                  AND (p.prediction_date >= date('now', '-2 days') OR p.status = 'active')
                ORDER BY p.id DESC
                LIMIT 30
            """).fetchall()
            con.close()
        except Exception as e:
            print(f"⚠️ خطأ في قراءة بيانات التوقعات: {e}")

    # المرشحين يجب أن يكونوا حصراً من الأسهم النشطة في رادار الميكرز اللحظي
    # ممنوع جلب أسهم عشوائية أو قديمة من جدول predictions.db إذا لم تكن في الرادار
    all_tickers = list(radar_dict.keys())
    pred_map = {r['ticker']: dict(r) for r in pred_rows}

    for tk in all_tickers:
        s_data = stocks_info.get(tk, {})
        current_price = float(s_data.get('current_price') or 0)
        change_pct = float(s_data.get('change_percent') or 0)
        vol = float(s_data.get('volume') or 0)
        name_ar = s_data.get('name_ar') or s_data.get('name') or tk

        if current_price <= 0:
            continue

        # استبعاد الأسهم الهابطة أو السلبية تماماً — لا تنبيه اختراق على سهم هابط
        if change_pct < -0.2:
            continue

        r_item = radar_dict.get(tk, {})
        r_pred = pred_map.get(tk, {})

        # استبعاد الفخاخ والترند الهابط وفلاتر الأمان والتصريف
        if r_item.get('kill_switch') or r_item.get('limit_up_trap'):
            continue
        if r_item.get('signal_type') in ('SELL', 'STRONG_SELL'):
            continue
        accum_state = str(r_item.get('accumulation') or '')
        if 'تصريف' in accum_state or 'خروج' in accum_state:
            continue
        timing_str = str(r_item.get('entry_timing', ''))
        if 'هابط' in timing_str or 'تجنب' in timing_str:
            continue

        # الثقة وحجم التداول
        radar_conf = float(r_item.get('confidence_score') or r_item.get('confidence') or 0)
        vol_ratio = float(r_item.get('vol_ratio_now') or r_item.get('volume_ratio_10d_vs_20d') or 1.2)
        direction = r_item.get('expected_dir') or 'صاعد لاختراق الهدف'

        if radar_conf < 75 or vol_ratio < 1.3:
            continue

        # ─── حساب وضبط مستويات الأهداف والوقف بأمان مالي صارم ───
        tl = r_item.get('trade_levels') or {}
        raw_tp1 = float(tl.get('target_1') or 0)
        raw_tp2 = float(tl.get('target_2') or 0)
        raw_sl = float(tl.get('stop') or 0)

        # فحص سلامة البيانات الحسابية: إذا كان الهدف خيالياً (أكبر من 25% من السعر الحالي مثل 147 لـ 9 جنيه)
        # فهذا مؤشر قطعي على خلل تاريخي أو تجزئة لم تعدل — نستبعد السهم تماماً فوراً
        if raw_tp1 > current_price * 1.25 or (raw_tp1 > 0 and raw_tp1 <= current_price):
            print(f"⚠️ استبعاد {tk}: الهدف الأول الشاذ ({raw_tp1}) غير متناسق مع السعر الحالي ({current_price}).")
            continue

        # 1. الهدف الأول TP1: بين +4% و +10% فوق سعر الدخول
        if raw_tp1 > current_price and raw_tp1 <= current_price * 1.12:
            tp1 = round(raw_tp1, 2)
        else:
            tp1 = round(current_price * 1.06, 2)

        # 2. الهدف الثاني TP2: أعلى من TP1 وأقل من +20% من السعر
        if raw_tp2 > tp1 and raw_tp2 <= current_price * 1.22:
            tp2 = round(raw_tp2, 2)
        else:
            tp2 = round(tp1 * 1.06, 2)

        # 3. وقف الخسارة SL: تحت سعر الدخول بـ 3% إلى 6%
        if raw_sl < current_price and raw_sl >= current_price * 0.92:
            sl = round(raw_sl, 2)
        else:
            sl = round(current_price * 0.95, 2)

        potential_gain = round(((tp1 - current_price) / current_price * 100), 1)
        potential_risk = round(((current_price - sl) / current_price * 100), 1)

        if potential_gain < 3.0 or potential_gain > 15.0 or potential_risk <= 0:
            continue

        raw_rr = potential_gain / potential_risk
        # نسبة العائد للمخاطرة مقيدة بحد أقصى 3.5 لمنع الأرقام الفلكية (مثل 1 إلى 246)
        if raw_rr < 1.4 or raw_rr > 4.5:
            continue
        rr_ratio = round(min(3.5, max(1.5, raw_rr)), 1)

        candidates.append({
            'ticker': tk,
            'name': name_ar,
            'current_price': current_price,
            'change_pct': change_pct,
            'volume': vol,
            'confidence': radar_conf,
            'vol_ratio': vol_ratio,
            'direction': direction,
            'tp1': tp1,
            'tp2': tp2,
            'sl': sl,
            'potential_gain': potential_gain,
            'rr_ratio': rr_ratio
        })

    # الترتيب حسب الثقة وتدفق السيولة
    candidates.sort(key=lambda x: (x['confidence'], x['vol_ratio']), reverse=True)
    return candidates

def format_alert_message(c: dict) -> str:
    """صياغة رسالة التنبيه بصيغة تسويقية جاذبة."""
    now_time = datetime.now().strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')
    
    price_str = f"{c['current_price']:.2f} ج.م" if c['current_price'] > 0 else "قيد التحديث"
    change_icon = '🟢 +' if c['change_pct'] >= 0 else '🔴 '
    change_str = f"{change_icon}{abs(c['change_pct']):.2f}%"
    
    tp1_str = f"{c['tp1']:.2f} ج.م (+{c['potential_gain']:.1f}%)"
    tp2_gain = ((c['tp2'] - c['current_price']) / c['current_price'] * 100) if c['current_price'] > 0 else 0
    tp2_str = f"{c['tp2']:.2f} ج.م (+{tp2_gain:.1f}%)" if c['tp2'] > 0 else "مفتوح"
    sl_str = f"{c['sl']:.2f} ج.م" if c['sl'] > 0 else "وقف كسر الدعم"
    
    vol_text = f"🔥 تدفق سيولة مؤسسية: {c['vol_ratio']:.1f}x المتوسط" if c['vol_ratio'] > 1.2 else "⚡ رصد تجميع هادئ"

    message = f"""🚀 <b>إشارة اختراق لحظية | رادار الميكرز V40.2</b>
⏰ {now_time}

سهم <b>{c['ticker']}</b> ({c['name']})
━━━━━━━━━━━━━━━━━━━
💰 <b>سعر الدخول الحالي:</b> {price_str} ({change_str})
🎯 <b>الهدف الأول (TP1):</b> {tp1_str}
🎯 <b>الهدف الثاني (TP2):</b> {tp2_str}
🛡 <b>وقف الخسارة (SL):</b> {sl_str}
⚖️ <b>نسبة العائد/المخاطرة:</b> 1 إلى {c['rr_ratio']:.1f}
━━━━━━━━━━━━━━━━━━━
🔍 <b>تحليل الرادار:</b>
• الثقة التنبؤية: {c['confidence']:.0f}%
• {vol_text}
• المسار المتوقع: {c['direction']}

💡 <i>هذه الإشارة مبنية على خوارزميات رادار الميكرز وتدفق السيولة الذكية في البورصة المصرية.</i>

📲 <b>استعلم عن أي سهم الآن مجاناً عبر البوت:</b>
👉 @investusernamebot"""

    return message

def send_telegram_alert(text: str, ticker: str) -> bool:
    """إرسال التنبيه عبر Telegram Bot API كصورة شارت مصورة مع أزرار تفاعلية."""
    if not TELEGRAM_BOT_TOKEN:
        print("❌ TELEGRAM_BOT_TOKEN غير مضبوط!")
        return False
        
    # Inline Buttons
    keyboard = {
        "inline_keyboard": [
            [
                {
                    "text": f"📊 شارت وتحليل {ticker}",
                    "url": OFFICIAL_LINKS['chart_url']
                },
                {
                    "text": "🎯 رادار الميكرز المباشر",
                    "url": OFFICIAL_LINKS['radar_url']
                }
            ],
            [
                {
                    "text": "🤖 تجربة فحص سهمك مجاناً عبر البوت",
                    "url": OFFICIAL_LINKS['bot']
                }
            ]
        ]
    }
    
    # محاولة توليد شارت احترافي للسهم
    photo_path = None
    try:
        import asyncio
        from telegram_chart_generator import generate_stock_chart_image
        photo_path = asyncio.run(generate_stock_chart_image(ticker))
    except Exception as e:
        print(f"⚠️ تعذر رسم شارت {ticker}: {e}")

    # إذا توفرت الصورة نرسلها عبر sendPhoto
    if photo_path and Path(photo_path).exists():
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
        alert_caption = text
        if len(alert_caption) > 1000:
            alert_caption = alert_caption[:995] + "..."

        try:
            import requests
            with open(photo_path, 'rb') as f:
                r = requests.post(
                    url,
                    data={
                        'chat_id': TELEGRAM_CHANNEL_ID,
                        'caption': alert_caption,
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
                    print(f"⚠️ فشل إرسال صورة الشارت: {res}")
        except Exception as e:
            print(f"⚠️ فشل إرسال الصورة لسهم {ticker}، جاري الإرسال كنص: {e}")

    # الاحتياطي: إرسال الرسالة كنص
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': TELEGRAM_CHANNEL_ID,
        'text': text,
        'parse_mode': 'HTML',
        'disable_web_page_preview': True,
        'reply_markup': keyboard
    }
    
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            return res.get('ok', False)
    except Exception as e:
        print(f"❌ خطأ أثناء إرسال التنبيه: {e}")
        return False

def run_intraday_alerts(force: bool = False, preview: bool = False):
    print("=" * 60)
    print("⚡ رادار الميكرز — محرك التنبيهات اللحظية والإعلانية")
    print(f"📅 الوقت الحالي: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    in_session = is_market_hours()
    if not in_session and not force and not preview:
        print("ℹ️ السوق مغلق حالياً (التنبيهات تعمل من 10:00 ص إلى 2:30 م أيام الأحد-الخميس). استخدم --force للتجاوز.")
        return

    state = load_alert_state()
    max_daily_alerts = 2  # حد أقصى تنبيهين فقط طوال اليوم في القناة كلها لمنع الإزعاج
    min_cooldown_seconds = 7200  # ساعتين كاملتين (120 دقيقة) على الأقل بين أي تنبيه والآخر

    if state.get('alert_count', 0) >= max_daily_alerts and not force:
        print(f"ℹ️ تم بلوغ الحد الأقصى للتنبيهات اليومية ({max_daily_alerts} تنبيهات) لتفادي الإزعاج والمحافظة على قيمة القناة.")
        return

    last_ts = state.get('last_alert_timestamp', 0)
    now_ts = datetime.now().timestamp()
    if (now_ts - last_ts) < min_cooldown_seconds and not force and not preview:
        elapsed_min = int((now_ts - last_ts) / 60)
        remaining_min = int((min_cooldown_seconds - (now_ts - last_ts)) / 60)
        print(f"ℹ️ فترة انتظار بين التنبيهات (مرت {elapsed_min} دقيقة، متبقي {remaining_min} دقيقة) لتجنب التتابع المزعج.")
        return

    candidates = get_intraday_breakout_candidates()
    if not candidates:
        print("ℹ️ لا توجد إشارات اختراق جديدة مكتملة الشروط حالياً.")
        return

    print(f"🔍 تم العثور على {len(candidates)} مرشحين محتملين فائقين الجودة.")
    
    sent_now = 0
    for cand in candidates:
        tk = cand['ticker']
        if tk in state.get('sent_tickers', []) and not force:
            continue
            
        msg = format_alert_message(cand)
        
        if preview:
            print(f"\n--- [معاينة التنبيه لسهم {tk}] ---")
            print(msg)
            print("-" * 40)
            sent_now += 1
            if sent_now >= 2: # في وضع المعاينة نكتفي بسهمين
                break
            continue

        # إرسال فعلي
        print(f"🚀 إرسال تنبيه اختراق لسهم {tk} إلى {TELEGRAM_CHANNEL_ID}...")
        success = send_telegram_alert(msg, tk)
        if success:
            print(f"✅ تم الإرسال بنجاح لسهم {tk}!")
            state['sent_tickers'].append(tk)
            state['alert_count'] = state.get('alert_count', 0) + 1
            state['last_alert_timestamp'] = now_ts
            save_alert_state(state)
            sent_now += 1
            # نرسل تنبيه واحد فقط وننتظر ساعتين على الأقل
            break
        else:
            print(f"❌ فشل إرسال تنبيه {tk}")

    if sent_now == 0 and not preview:
        print("ℹ️ جميع المرشحين تم إرسال تنبيهات سابقة لهم اليوم.")

if __name__ == '__main__':
    force_run = '--force' in sys.argv
    preview_run = '--preview' in sys.argv
    run_intraday_alerts(force=force_run, preview=preview_run)
