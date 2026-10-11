#!/usr/bin/env python3
"""
telegram_target_hit_tracker.py — رادار متابعة الأهداف المحققة ونبض الصفقات الرابحة
==================================================================================
يقوم بمراقبة الأسهم التي أُوصي بها ونُشرت في تقارير التوقعات والرادار عالية الثقة:
  1. كشف لحظي فور وصول السهم إلى الهدف الأول (TP1) أو الهدف الثاني (TP2) بالاعتماد
     على أعلى سعر مسجل في الجلسة (Session High).
  2. حساب نسبة الأرباح المحققة بدقة من نقطة الدخول (Entry Price).
  3. استخراج الأسماء العربية الصحيحة لكافة الأسهم من قاموس الأسهم المصرية المعتمد.
  4. توليد بطاقة بصرية احترافية مبهرة تُبرز "المكسب المحقق %" كبطل رئيسي مع أختام الإنجاز.
  5. تضمين كافة الروابط الرسمية للمنصة والتطبيق ومجتمع الواتساب وكود QR.
  6. بث الإشعار فورياً كبرهان حي ومصداقية تسويقية مستمرة لقناة التليجرام.
  7. تسجيل الضربات في target_hit_state.json لضمان عدم التكرار نهائياً.

الاستخدام:
  python3 telegram_target_hit_tracker.py           # فحص دوري وبث الأهداف المحققة
  python3 telegram_target_hit_tracker.py --preview # معاينة الأهداف المحققة حالياً دون إرسال
  python3 telegram_target_hit_tracker.py --force   # إرسال إجباري لأول هدف متحقق للاختبار
"""

import os
import sys
import json
import sqlite3
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VPS_SERVICE_DIR = Path(__file__).resolve().parent.parent
if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))

# DEV-11 (2026-10-13 — PRODUCTION-AUDIT G1+G2): canonical active-prediction filter.
# Replaces every inline `status != 'INVALID'` (which excluded only one masked
# status) with the centralized filter that also excludes ARCHIVED + REJECTED_BAD_RR.
try:
    from core.query_helpers import ACTIVE_PREDICTION_FILTER as _DEV11_ACTIVE_FILTER
except ImportError as _dev11_err:
    print(f"[telegram_target_hit_tracker] core.query_helpers not available: {_dev11_err} — using inline filter", flush=True)
    _DEV11_ACTIVE_FILTER = "status NOT IN ('INVALID', 'ARCHIVED', 'REJECTED_BAD_RR')"

TELEGRAM_DIR = Path(__file__).resolve().parent
if str(TELEGRAM_DIR) not in sys.path:
    sys.path.insert(0, str(TELEGRAM_DIR))

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for signal/accumulation/money_flow classification.
try:
    from utils.canonical_signal import classify_accumulation
except ImportError:  # pragma: no cover - fallback if utils not on path
    def classify_accumulation(_buy_pct):  # type: ignore[no-redef]
        return None

DATA_DIR = VPS_SERVICE_DIR / 'data'
if str(DATA_DIR) not in sys.path:
    sys.path.insert(0, str(DATA_DIR))

# استيراد قاموس الأسماء العربية
try:
    from egx_arabic_lookup import get_arabic_stock_name
except ImportError:
    try:
        from data.egx_arabic_lookup import get_arabic_stock_name
    except ImportError:
        def get_arabic_stock_name(tk, fb=None): return fb or tk

# استيراد الهوية والروابط الرسمية وكود QR
try:
    from telegram_branding import (
        OFFICIAL_LINKS,
        render_branding_box_html,
        format_caption_links_block,
        get_official_inline_buttons
    )
except ImportError:
    OFFICIAL_LINKS = {
        'website': 'https://invist.m2y.net',
        'radar_url': 'https://invist.m2y.net/#recommendations',
        'chart_url': 'https://invist.m2y.net/#trading-chart',
        'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
        'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
        'telegram': 'https://t.me/Arabian_investment_guide',
        'channel': 'https://t.me/Arabian_investment_guide',
        'whatsapp': 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
        'bot': 'https://t.me/investusernamebot',
    }
    def render_branding_box_html(target_url='', theme='green'): return ''
    def format_caption_links_block(): return ''
    def get_official_inline_buttons(ticker=None): return []

DB_DIR = PROJECT_ROOT / 'db'
STOCKS_DB = DB_DIR / 'stocks.db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'
RADAR_OUTPUT_DIR = PROJECT_ROOT / 'scripts' / 'output'
REPORTS_DIR = PROJECT_ROOT / 'public' / 'reports'
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = Path(__file__).resolve().parent / 'target_hit_state.json'

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
TELEGRAM_CHANNEL_ID = os.environ.get('TELEGRAM_CHANNEL_ID', '')  # Task SECURITY-P0: removed hardcoded channel fallback

def load_hit_state() -> Dict:
    """تحميل سجل الضربات السابقة لمنع التكرار."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {'announced_hits': {}}

def save_hit_state(state: Dict):
    """حفظ سجل الضربات."""
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ خطأ حفظ حالة الأهداف المحققة: {e}")

def compute_duration_text(pred_date_str: str) -> Tuple[int, str]:
    """حساب عدد أيام التداول والمدة المنقضية بدقة حتى تحقيق الهدف."""
    try:
        p_date = datetime.strptime(str(pred_date_str)[:10], '%Y-%m-%d').date()
        today = datetime.now().date()
        days = (today - p_date).days
        if days <= 0:
            return 0, "خلال نفس جلسة التداول ⚡"
        elif days == 1:
            return 1, "خلال جلسة تداول واحدة (24 ساعة)"
        elif days == 2:
            return 2, "خلال جلستي تداول (48 ساعة)"
        elif days <= 10:
            return days, f"خلال {days} أيام تداول"
        else:
            return days, f"خلال {days} يوماً"
    except Exception:
        return 0, "جلسة اليوم"

# ──────────────────────────────────────────────
# 1. جمع التوصيات النشطة من الرادار وقاعدة التوقعات
# ──────────────────────────────────────────────
def get_active_radar_targets() -> List[Dict]:
    """جمع الأسهم المصرية (EGX) النشطة الموصى بها في رادار السيولة والتوقعات مع تواريخ الطرح."""
    active_items = {}
    today_str = datetime.now().strftime('%Y-%m-%d')

    # جمع رموز الأسهم المصرية الصالحة فقط للتحقق الحاسم
    egx_valid_tickers = set()
    if STOCKS_DB.exists():
        try:
            with sqlite3.connect(STOCKS_DB) as con_val:
                rows_tk = con_val.execute("SELECT ticker FROM stocks WHERE market = 'EGX'").fetchall()
                egx_valid_tickers = {r[0] for r in rows_tk}
        except Exception as e:
            print(f"⚠️ خطأ جلب رموز EGX: {e}")

    # أ) جلب أحدث ملف رادار السيولة للسوق المصري حصراً
    if RADAR_OUTPUT_DIR.exists():
        # نبحث أولاً عن ملفات EGX الصريحة maker_radar_EGX_*.json
        radar_files = sorted([f for f in os.listdir(RADAR_OUTPUT_DIR) if f.startswith('maker_radar_EGX_') and f.endswith('.json')])
        if not radar_files:
            # ملفات التوافق القديمة (maker_radar_YYYYMMDD.json) مع استبعاد أي أسواق أخرى
            radar_files = sorted([f for f in os.listdir(RADAR_OUTPUT_DIR) if f.startswith('maker_radar_20') and f.endswith('.json') and not any(m in f for m in ['_US_', '_TADAWUL_', '_CRYPTO_', '_GOLD_', '_KSE_'])])

        if radar_files:
            latest_file = RADAR_OUTPUT_DIR / radar_files[-1]
            try:
                import re
                m_date = re.search(r'maker_radar_(?:EGX_)?(\d{4})(\d{2})(\d{2})', latest_file.name)
                radar_date = f"{m_date.group(1)}-{m_date.group(2)}-{m_date.group(3)}" if m_date else today_str
                data = json.load(open(latest_file, 'r', encoding='utf-8'))
                
                # تأكيد أن ملف الرادار خاص بـ EGX
                file_market = str(data.get('market') or 'EGX').upper()
                if file_market == 'EGX':
                    combined_list = (
                        (data.get('top_explosions') or []) +
                        (data.get('explosive_list') or []) +
                        (data.get('pre_surge_list') or []) +
                        (data.get('under_microscope') or []) +
                        (data.get('quiet_list') or []) +
                        (data.get('surge_detector_list') or [])
                    )
                    for item in combined_list:
                        tk = item.get('ticker') or item.get('symbol', '').replace('.CA', '')
                        if not tk or tk in active_items:
                            continue
                        # فلترة صارمة: سهم مصري فقط
                        if egx_valid_tickers and tk not in egx_valid_tickers:
                            continue
                        entry = float(item.get('current_price') or item.get('close') or 0)
                        tp1 = float(item.get('target_1') or item.get('target_price') or 0)
                        tp2 = float(item.get('target_2') or item.get('target_price_2') or 0)
                        sl = float(item.get('stop_loss') or 0)

                        if entry <= 0:
                            continue

                        if tp1 <= 0:
                            tp1 = entry * 1.05
                        if tp2 <= 0:
                            tp2 = entry * 1.10
                        if sl <= 0:
                            sl = entry * 0.95

                        raw_name = item.get('name') or item.get('name_ar') or tk
                        name_ar = get_arabic_stock_name(tk, raw_name)
                        item_date = str(item.get('date') or item.get('entry_date') or radar_date)[:10]

                        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27 NO-FAKE-DATA)
                        # Don't fabricate buy_pct/confidence/vol_ratio — use None when source has no value.
                        _raw_conf = item.get('confidence_score')
                        _raw_buy = item.get('buy_pct')
                        _raw_vol = item.get('vol_ratio_now')
                        active_items[tk] = {
                            'ticker': tk,
                            'name_ar': name_ar,
                            'entry_price': entry,
                            'target_1': tp1,
                            'target_2': tp2,
                            'stop_loss': sl,
                            'confidence': float(_raw_conf) if _raw_conf is not None else None,
                            'buy_pct': float(_raw_buy) if _raw_buy is not None else None,
                            'vol_ratio': float(_raw_vol) if _raw_vol is not None else None,
                            'source': 'رادار السيولة والتجميع',
                            'prediction_date': item_date
                        }
            except Exception as e:
                print(f"⚠️ خطأ قراءة ملف الرادار: {e}")

    # ب) جلب التوقعات المؤكدة من predictions.db (EGX فقط)
    if PREDICTIONS_DB.exists():
        try:
            con_p = sqlite3.connect(PREDICTIONS_DB)
            con_p.row_factory = sqlite3.Row
            rows = con_p.execute("""
                SELECT ticker, signal, confidence, target_price, target_price_2, stop_loss, entry_price, prediction_date, created_at, market
                FROM predictions
                WHERE signal IN ('STRONG_BUY', 'BUY', 'ACCUMULATE')
                  AND (market = 'EGX' OR market IS NULL)
                ORDER BY id DESC LIMIT 100
            """).fetchall()
            con_p.close()

            for r in rows:
                tk = r['ticker']
                # فلترة صارمة: سهم مصري فقط
                if egx_valid_tickers and tk not in egx_valid_tickers:
                    continue
                p_date = str(r['prediction_date'] or (r['created_at'][:10] if r['created_at'] else today_str))[:10]
                if tk not in active_items:
                    entry = float(r['entry_price'] or 0)
                    tp1 = float(r['target_price'] or 0)
                    tp2 = float(r['target_price_2'] or 0)
                    sl = float(r['stop_loss'] or 0)
                    if entry > 0:
                        name_ar = get_arabic_stock_name(tk, tk)
                        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27 NO-FAKE-DATA)
                        # predictions.db rows don't carry buy_pct/vol_ratio — leave None
                        # instead of fabricating 70.0/1.1. Downstream classify_accumulation
                        # returns None for None input (Rule 27 compliant).
                        _raw_conf = r['confidence']
                        active_items[tk] = {
                            'ticker': tk,
                            'name_ar': name_ar,
                            'entry_price': entry,
                            'target_1': tp1 if tp1 > 0 else (entry * 1.05),
                            'target_2': tp2 if tp2 > 0 else (entry * 1.10),
                            'stop_loss': sl if sl > 0 else (entry * 0.95),
                            'confidence': float(_raw_conf) if _raw_conf is not None else None,
                            'buy_pct': None,
                            'vol_ratio': None,
                            'source': 'توقعات المنصة الذكية',
                            'prediction_date': p_date
                        }
                else:
                    # احتفظ بالتاريخ الأقدم إذا كانت التوصية مطروحة من قبل
                    curr_d = active_items[tk].get('prediction_date')
                    if curr_d and p_date < curr_d:
                        active_items[tk]['prediction_date'] = p_date
        except Exception as e:
            print(f"⚠️ خطأ قراءة predictions.db: {e}")

    return list(active_items.values())

# ──────────────────────────────────────────────
# 2. فحص حالة السوق اللحظية ورصد الضربات
# ──────────────────────────────────────────────
def scan_for_target_hits(active_targets: List[Dict]) -> List[Dict]:
    """
    فحص أسعار السوق الحالية ومقارنتها بمستويات الأهداف:
    القاعدة الذهبية: الاعتماد على أعلى سعر مسجل في الجلسة (high_price)
    إذا كان عند أو أعلى من الهدف، يتم إرسال إشعار النجاح فوراً.
    مقتصر حصراً على السوق المصري (EGX).
    """
    if not STOCKS_DB.exists():
        return []

    hits = []
    state = load_hit_state()
    announced = state.get('announced_hits', {})

    try:
        con_s = sqlite3.connect(STOCKS_DB)
        con_s.row_factory = sqlite3.Row
        stocks_map = {r['ticker']: dict(r) for r in con_s.execute("SELECT * FROM stocks WHERE market = 'EGX'").fetchall()}
        con_s.close()
    except Exception as e:
        print(f"⚠️ خطأ قراءة stocks.db: {e}")
        return []

    today_str = datetime.now().strftime('%Y-%m-%d')

    for target in active_targets:
        tk = target['ticker']
        s = stocks_map.get(tk)
        if not s:
            continue

        curr_p = float(s.get('current_price') or 0)
        # أعلى سعر مسجل في الجلسة هو الأساس المعتمد
        high_p = float(s.get('high_price') or curr_p)
        chg_pct = float(s.get('change_percent') or 0)
        entry_p = float(target.get('entry_price') or curr_p)
        tp1 = float(target.get('target_1') or 0)
        tp2 = float(target.get('target_2') or 0)
        sl = float(target.get('stop_loss') or 0)

        if entry_p <= 0 or (curr_p <= 0 and high_p <= 0):
            continue

        # نسبة المكسب المحققة من نقطة الدخول إلى أعلى سعر مسجل بالجلسة
        profit_pct = ((high_p - entry_p) / entry_p) * 100

        # فحص أمان صارم: أي مكسب أعلى من 25% أو أقل من 2% داخل الجلسة في البورصة المصرية هو شذوذ بياني
        if profit_pct > 25.0 or profit_pct < 2.0:
            continue

        # التحقق هل حقق أعلى سعر في الجلسة الهدف 2 أو الهدف 1
        hit_level = None
        hit_price = high_p
        target_goal_price = tp1

        if tp2 > 0 and high_p >= tp2:
            hit_level = 'TP2'
            hit_price = high_p
            target_goal_price = tp2
        elif tp1 > 0 and high_p >= tp1:
            hit_level = 'TP1'
            hit_price = high_p
            target_goal_price = tp1
        elif chg_pct >= 4.0 and profit_pct >= 4.0:
            hit_level = 'SURGE'
            hit_price = high_p
            target_goal_price = high_p

        if not hit_level:
            continue

        # مفتاح منع التكرار: Ticker + HitLevel + Today
        hit_key = f"{tk}_{hit_level}_{today_str}"
        if hit_key in announced:
            continue

        # استخراج الاسم العربي الصحيح 100%
        clean_arabic_name = get_arabic_stock_name(tk, s.get('name_ar') or target.get('name_ar') or tk)

        # تحديد المسار القادم (استكمال صعود أم جني أرباح؟)
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67 + Rule 27)
        # Was: float(... or 60.0) → fabricated 60% default. Now None when missing.
        # Was: hardcoded `if buy_pct >= 58.0`. Now uses canonical classify_accumulation
        # which maps 55+ → 'تجميع خفيف' (light accumulation) or higher. The 3
        # accumulation labels (تجميع قوي/تجميع/تجميع خفيف) trigger CONTINUE_RALLY.
        _raw_buy = s.get('buy_pct') or target.get('buy_pct')
        _raw_vol = s.get('vol_ratio') or target.get('vol_ratio')
        buy_pct = float(_raw_buy) if _raw_buy is not None else None
        vol_ratio = float(_raw_vol) if _raw_vol is not None else None

        _accum_label = classify_accumulation(buy_pct) if buy_pct is not None else None
        _is_accumulating = _accum_label in (
            'تجميع قوي', 'تجميع', 'تجميع خفيف'
        ) if _accum_label is not None else False

        if _is_accumulating and (vol_ratio is not None and vol_ratio >= 1.0):
            next_action = 'CONTINUE_RALLY'
            next_action_title = 'استكمال صعود قوي وحماية الأرباح'
            if hit_level == 'TP1':
                next_target = tp2 if tp2 > high_p else (high_p * 1.06)
            else:
                next_target = high_p * 1.08
            next_profit_pct = ((next_target - entry_p) / entry_p) * 100
            trailing_stop = max(sl, entry_p * 1.01, hit_price * 0.96)
            # Rule 27: don't fabricate buy_pct in the message text if missing.
            _buy_pct_txt = f"السيولة الشرائية لا تزال مهيمنة بنسبة ({buy_pct:.0f}%). " if buy_pct is not None else ""
            action_advice = (
                f"{_buy_pct_txt}"
                f"نوصي بالاستمرار مع السهم ورفع وقف الخسارة إلى ({trailing_stop:.2f} ج.م) "
                f"لتأمين الأرباح تماماً مع التطلع للهدف القادم ({next_target:.2f} ج.م)."
            )
        else:
            next_action = 'TAKE_PROFIT'
            next_action_title = 'جني أرباح جزئي وتأمين المكاسب'
            next_target = high_p * 1.03
            next_profit_pct = ((next_target - entry_p) / entry_p) * 100
            trailing_stop = hit_price * 0.97
            action_advice = (
                f"السهم أنجز المستهدف بكفاءة عالية. "
                f"يُفضل جني جزء من الأرباح (50% إلى 70%) لحماية رأس المال، "
                f"ووضع وقف ربح صارم عند ({trailing_stop:.2f} ج.م)."
            )

        pred_date = target.get('prediction_date') or today_str
        days_num, duration_txt = compute_duration_text(pred_date)

        hits.append({
            'hit_key': hit_key,
            'ticker': tk,
            'name_ar': clean_arabic_name,
            'hit_level': hit_level,
            'entry_price': entry_p,
            'hit_price': hit_price,
            'target_goal_price': target_goal_price,
            'current_price': curr_p,
            'profit_pct': profit_pct,
            'prediction_date': pred_date,
            'days_held': days_num,
            'duration_text': duration_txt,
            'next_action': next_action,
            'next_action_title': next_action_title,
            'next_target': next_target,
            'next_profit_pct': next_profit_pct,
            'trailing_stop': trailing_stop,
            'action_advice': action_advice,
            'buy_pct': buy_pct,
            'vol_ratio': vol_ratio,
            'source': target.get('source', 'توقعات المنصة الذكية')
        })

    return hits

# ──────────────────────────────────────────────
# 3. صياغة التقرير وتوليد بطاقة الهدف المحقق
# ──────────────────────────────────────────────
def render_hit_card_html(item: Dict) -> str:
    """توليد كود HTML المتطور لبطاقة تحقيق الهدف الاحترافية مع الروابط وQR Code وإبراز المكسب %."""
    tk = item['ticker']
    name = item['name_ar']
    profit = item['profit_pct']
    level_label = "الهدف الثاني (TP2)" if item['hit_level'] == 'TP2' else ("الهدف الأول (TP1)" if item['hit_level'] == 'TP1' else "انفجار سعري صاعد")
    target_link = f"{OFFICIAL_LINKS['radar_url']}?ticker={tk}"
    platforms_html = render_branding_box_html(target_link, theme='green')

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
      padding: 34px 40px;
      position: relative;
      overflow: hidden;
      background: radial-gradient(circle at 50% 10%, #0d3829 0%, #061c14 55%, #020705 100%);
    }}

    .frame-border {{
      position: absolute;
      top: 14px; left: 14px; right: 14px; bottom: 14px;
      border: 2px solid rgba(234, 179, 8, 0.45);
      border-radius: 26px;
      pointer-events: none;
    }}
    .frame-border-inner {{
      position: absolute;
      top: 20px; left: 20px; right: 20px; bottom: 20px;
      border: 1px solid rgba(234, 179, 8, 0.2);
      border-radius: 20px;
      pointer-events: none;
    }}

    /* الشريط العلوي */
    .top-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 6px;
    }}
    .brand-logo-area {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .brand-title {{
      font-size: 26px;
      font-weight: 900;
      color: #facc15;
      letter-spacing: 0.5px;
    }}
    .brand-sub {{
      font-size: 17px;
      font-weight: 700;
      color: #86efac;
    }}
    .ribbon-badge {{
      background: linear-gradient(135deg, #15803d 0%, #16a34a 50%, #22c55e 100%);
      padding: 9px 28px;
      border-radius: 30px;
      color: #fff;
      font-size: 20px;
      font-weight: 900;
      box-shadow: 0 8px 24px rgba(34, 197, 94, 0.35), inset 0 2px 4px rgba(255, 255, 255, 0.4);
      display: flex;
      align-items: center;
      gap: 8px;
    }}

    /* الصندوق الرئيسي */
    .main-box {{
      background: rgba(3, 14, 11, 0.94);
      border: 1px solid rgba(34, 197, 94, 0.35);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 22px 28px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.85);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }}

    .stock-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(234, 179, 8, 0.25);
      padding-bottom: 10px;
    }}
    .stock-title {{
      font-size: 32px;
      font-weight: 900;
      color: #fef08a;
    }}
    .stock-badge {{
      background: #10b981;
      color: #020705;
      font-size: 20px;
      font-weight: 800;
      padding: 5px 18px;
      border-radius: 12px;
    }}

    /* صندوق المكسب المحقق البطل الشامل HERO PROFIT BOX */
    .hero-profit-box {{
      background: linear-gradient(135deg, rgba(22, 101, 52, 0.55) 0%, rgba(6, 40, 28, 0.85) 100%);
      border: 2px solid #22c55e;
      border-radius: 18px;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 10px 30px rgba(34, 197, 94, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.3);
      position: relative;
      overflow: hidden;
    }}
    .hero-profit-box::after {{
      content: '';
      position: absolute;
      top: -50%;
      right: -20%;
      width: 250px;
      height: 250px;
      background: radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%);
      pointer-events: none;
    }}

    .profit-text-side {{
      display: flex;
      flex-direction: column;
      gap: 3px;
    }}
    .profit-stamp-tag {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(234, 179, 8, 0.2);
      border: 1px solid #eab308;
      color: #fef08a;
      font-size: 15px;
      font-weight: 800;
      padding: 3px 12px;
      border-radius: 20px;
      width: fit-content;
    }}
    .profit-statement {{
      font-size: 24px;
      font-weight: 900;
      color: #ffffff;
      margin-top: 3px;
    }}
    .profit-sub-note {{
      font-size: 15px;
      color: #86efac;
      font-weight: 700;
    }}

    .profit-number-side {{
      text-align: left;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }}
    .profit-giant-number {{
      font-size: 64px;
      font-weight: 900;
      line-height: 1;
      color: #4ade80;
      text-shadow: 0 0 25px rgba(74, 222, 128, 0.6);
      direction: ltr;
    }}
    .profit-giant-label {{
      font-size: 17px;
      font-weight: 800;
      color: #fef08a;
    }}

    /* شبكة الأسعار الدخول والهدف */
    .prices-grid {{
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }}
    .price-card {{
      background: rgba(15, 35, 28, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .price-label {{
      font-size: 15px;
      color: #94a3b8;
      font-weight: 700;
    }}
    .price-val {{
      font-size: 24px;
      font-weight: 800;
      color: #f8fafc;
    }}

    /* المسار القادم */
    .next-action-box {{
      background: rgba(22, 101, 52, 0.25);
      border-right: 5px solid #22c55e;
      border-radius: 12px;
      padding: 12px 16px;
    }}
    .action-title {{
      font-size: 18px;
      font-weight: 800;
      color: #86efac;
      margin-bottom: 2px;
    }}
    .action-text {{
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.5;
    }}

    /* الفوتر النهائي */
    .footer-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 8px;
    }}
    .footer-text {{
      font-size: 15px;
      font-weight: 700;
      color: #94a3b8;
    }}
    .footer-highlight {{
      color: #facc15;
      font-weight: 800;
    }}
  </style>
</head>
<body>
  <div class="frame-border"></div>
  <div class="frame-border-inner"></div>

  <!-- الشريط العلوي -->
  <div class="top-bar">
    <div class="brand-logo-area">
      <div class="brand-title">منصة دليل الاستثمار</div>
      <div class="brand-sub">| رادار السيولة المباشر</div>
    </div>
    <div class="ribbon-badge">
      <span>صفقة رابحة • مكسب محقق +{profit:.1f}%</span>
    </div>
  </div>

  <!-- الصندوق الرئيسي للأرقام والنتائج -->
  <div class="main-box">
    <div class="stock-header">
      <div class="stock-title">{name} ({tk})</div>
      <div class="stock-badge">{level_label}</div>
    </div>

    <!-- صندوق المكسب المحقق البطل الشامل -->
    <div class="hero-profit-box">
      <div class="profit-text-side">
        <div class="profit-stamp-tag">
          <span>✓</span>
          <span>مكسب تم تحقيقه بنجاح</span>
        </div>
        <div class="profit-statement">تم اقتناص المستهدف بأعلى سعر بالجلسة</div>
        <div class="profit-sub-note">أرباح مؤكدة بناء على رصد سيولة صانع السوق مسبقاً</div>
      </div>

      <div class="profit-number-side">
        <div class="profit-giant-number">+{profit:.1f}%</div>
        <div class="profit-giant-label">صافي نسبة المكسب المحقق</div>
      </div>
    </div>

    <!-- بطاقات تفاصيل الصفقة والتوثيق الزمني -->
    <div class="prices-grid">
      <div class="price-card">
        <span class="price-label">سعر الدخول المعتمد:</span>
        <span class="price-val">{item['entry_price']:.2f} ج.م</span>
      </div>
      <div class="price-card" style="border-color: rgba(234, 179, 8, 0.4);">
        <span class="price-label">أعلى سعر بالجلسة (الهدف):</span>
        <span class="price-val" style="color: #fef08a;">{item['hit_price']:.2f} ج.م</span>
      </div>
      <div class="price-card" style="border-color: rgba(34, 197, 94, 0.4);">
        <span class="price-label">تاريخ طرح التوقع:</span>
        <span class="price-val" style="font-size: 19px; color: #86efac;">{item['prediction_date']}</span>
      </div>
      <div class="price-card" style="border-color: rgba(234, 179, 8, 0.4);">
        <span class="price-label">المدة حتى تحقيق الهدف:</span>
        <span class="price-val" style="font-size: 18px; color: #facc15;">{item['duration_text']}</span>
      </div>
    </div>

    <div class="next-action-box">
      <div class="action-title">{item['next_action_title']}</div>
      <div class="action-text">
        <b>الهدف القادم:</b> {item['next_target']:.2f} ج.م (+{item['next_profit_pct']:.1f}%) • 
        <b>وقف الخسارة المحدث:</b> {item['trailing_stop']:.2f} ج.م (تأمين الأرباح المحققة)
      </div>
    </div>
  </div>

  <!-- قسم الروابط والمنصات الرسمية الشامل مع كود QR -->
  {platforms_html}

  <!-- الفوتر -->
  <div class="footer-bar">
    <div class="footer-text">
      تحليل لحظي بالذكاء الاصطناعي ورادار السيولة • <span class="footer-highlight">دليل الاستثمار</span>
    </div>
    <div class="footer-text" style="direction:ltr;">
      invist.m2y.net
    </div>
  </div>
</body>
</html>"""

async def generate_hit_card_image(item: Dict) -> Optional[Path]:
    """توليد صورة بطاقة الهدف المحقق بدقة 1080×1080."""
    html = render_hit_card_html(item)
    out_file = REPORTS_DIR / f"hit_{item['ticker']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={'width': 1080, 'height': 1080}, device_scale_factor=1.5)
            await page.set_content(html, wait_until='networkidle')
            await page.screenshot(path=str(out_file), type='png')
            await browser.close()
        return out_file
    except Exception as e:
        print(f"❌ خطأ توليد صورة الهدف المحقق: {e}")
        return None

def format_hit_caption(item: Dict) -> Tuple[str, dict]:
    """صياغة النص التسويقي التفاعلي المرافق لإشعار ضرب الهدف."""
    tk = item['ticker']
    name = item['name_ar']
    profit = item['profit_pct']
    level_label = "الهدف الثاني (TP2) 🏆" if item['hit_level'] == 'TP2' else ("الهدف الأول (TP1) 🎯" if item['hit_level'] == 'TP1' else "انفجار سعري صاعد 🚀")

    links_block = format_caption_links_block()

    caption = f"""🎯 <b>ضرب الهدف بنجاح! | نتائج صفقات وتوقعات المنصة</b> 🚀
━━━━━━━━━━━━━━━━━━━
سهم: <b>{name} (#{tk})</b>
المستوى المتحقق: <b>{level_label}</b>

📊 <b>التوثيق الرسمي للصفقة بالأرقام والتواريخ:</b>
📅 <b>تاريخ طرح التوقع:</b> <b>{item['prediction_date']}</b>
⏱️ <b>المدة المستغرقة حتى الهدف:</b> <b>{item['duration_text']}</b>
💰 <b>سعر الدخول المعتمد:</b> <b>{item['entry_price']:.2f} ج.م</b>
🎯 <b>أعلى سعر مسجل بالجلسة:</b> <b>{item['hit_price']:.2f} ج.م</b>
💵 <b>صافي المكسب المحقق:</b> <b>+{profit:.1f}% أرباح صريحة ومؤكدة!</b>
━━━━━━━━━━━━━━━━━━━
🧭 <b>المسار والتوجيه القادم للسهم:</b>
{item['next_action_title']}

🎯 <b>الهدف القادم:</b> <b>{item['next_target']:.2f} ج.م</b> (+{item['next_profit_pct']:.1f}%)
🛡️ <b>رفع وقف الخسارة (حماية الأرباح):</b> <b>{item['trailing_stop']:.2f} ج.م</b> (تأمين الأرباح تماماً)

💡 <b>توجيه التحليل الذكي:</b>
{item['action_advice']}
{links_block}"""

    buttons = get_official_inline_buttons(tk)

    return caption, {"inline_keyboard": buttons}

# ──────────────────────────────────────────────
# 4. إرسال الإشعار والتحديث
# ──────────────────────────────────────────────
def send_telegram_hit(photo_path: Optional[Path], caption: str, reply_markup: dict) -> bool:
    """إرسال بطاقة الهدف المتحقق إلى القناة."""
    if not TELEGRAM_BOT_TOKEN:
        print("❌ TELEGRAM_BOT_TOKEN غير مضبوط!")
        return False

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
                if r.json().get('ok'):
                    return True
        except Exception as e:
            print(f"⚠️ خطأ إرسال صورة الهدف: {e}")

    # Fallback to sendMessage
    url_msg = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        r = requests.post(
            url_msg,
            json={
                'chat_id': TELEGRAM_CHANNEL_ID,
                'text': caption,
                'parse_mode': 'HTML',
                'disable_web_page_preview': True,
                'reply_markup': reply_markup
            },
            timeout=15
        )
        return r.json().get('ok', False)
    except Exception as e:
        print(f"❌ خطأ إرسال رسالة الهدف: {e}")
        return False

def record_target_hit_in_db(item: Dict) -> bool:
    """تسجيل وتوثيق الهدف المحقق في قاعدة بيانات التوقعات predictions.db والمشروع."""
    if not PREDICTIONS_DB.exists():
        print(f"⚠️ قاعدة البيانات {PREDICTIONS_DB} غير موجودة لتسجيل الهدف.")
        return False

    today_str = datetime.now().strftime('%Y-%m-%d')
    now_iso = datetime.now().isoformat()
    tk = item.get('ticker')
    hit_level = item.get('hit_level', 'TP1')
    hit_price = float(item.get('hit_price', 0))
    entry_price = float(item.get('entry_price', 0))
    profit_pct = round(float(item.get('profit_pct', 0)), 2)
    days_held = int(item.get('days_held', 0))
    source = item.get('source', 'توقعات المنصة الذكية')
    pred_date = item.get('prediction_date', today_str)
    duration_text = item.get('duration_text', f"{days_held} أيام")
    exit_reason = f"تحقق {hit_level} عند {hit_price:.2f} ج.م بمكسب +{profit_pct:.1f}% ({duration_text})"

    try:
        conn = sqlite3.connect(PREDICTIONS_DB, timeout=15.0)
        cursor = conn.cursor()

        # فحص إذا كان هناك توقع نشط مسجل لهذا السهم
        # P1-B (2026-10-12): Skip placeholder predictions (status='INVALID')
        # so we don't UPDATE rogue placeholders with "صفقة رابحة مرصودة" notes.
        # DEV-11 (2026-10-13): Use canonical filter — also excludes ARCHIVED +
        # REJECTED_BAD_RR (masked-wipe victims + geometry-guard rejections).
        cursor.execute(f"""
            SELECT id, entry_price, prediction_date, notes
            FROM predictions
            WHERE ticker = ? AND status IN ('active', 'ACTIVE', 'PENDING') AND outcome_date IS NULL
              AND {_DEV11_ACTIVE_FILTER}  /* DEV-11: skip placeholders + archived + rejected (Rule 27) */
            ORDER BY id DESC LIMIT 1
        """, (tk,))
        row = cursor.fetchone()

        if row:
            pred_id = row[0]
            existing_notes = row[3] or ''
            new_note = f"حقق {hit_level} في {today_str} بسعر {hit_price:.2f} (ربح +{profit_pct:.1f}%) | مدة الانتظار: {duration_text} | المصدر: {source}"
            updated_notes = f"{existing_notes} | {new_note}" if existing_notes else new_note

            cursor.execute("""
                UPDATE predictions
                SET status = 'TARGET_HIT',
                    hit_target = 1,
                    outcome_date = ?,
                    actual_exit_price = ?,
                    exit_price = ?,
                    actual_return = ?,
                    pnl_pct = ?,
                    holding_days = ?,
                    days_to_close = ?,
                    exit_type = ?,
                    exit_reason = ?,
                    is_correct = 1,
                    closed_at = ?,
                    notes = ?
                WHERE id = ?
            """, (
                today_str,
                hit_price,
                hit_price,
                profit_pct,
                profit_pct,
                days_held,
                days_held,
                hit_level,
                exit_reason,
                now_iso,
                updated_notes,
                pred_id
            ))
            print(f"✅ تم تحديث التوقع النشط رقم {pred_id} لسهم {tk} كهدف محقق بنجاح في predictions.db")
        else:
            # Task PHASE3-ENGINES (Rule 27): do not fabricate prediction fields.
            # The previous code INSERTed a fully-fabricated row with hardcoded
            # signal='BUY' + confidence=75 + is_correct=1 + sl=entry*0.95 +
            # tp2=hit*1.05 — pretending a real prediction had existed. That
            # polluted predictions.db with synthetic rows the engine never
            # actually produced (Rule 27 violation: NULL means NULL).
            # Without a real active prediction in the DB, there is nothing to
            # close — we log + return without inserting fabricated data.
            print(
                f"⚠️ [PHASE3-ENGINES] لا يوجد توقع نشط لـ {tk} في predictions.db — "
                f"تخطّي INSERT الصفقة المُ fabrication (Rule 27). ضربة {hit_level} "
                f"@ {hit_price:.2f} (+{profit_pct:.1f}%) لن تُسجَّل كتوقع BUY وهمي."
            )
            conn.commit()
            conn.close()
            return True

        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"❌ خطأ تسجيل الهدف في predictions.db لسهم {tk}: {e}")
        return False


def run_target_hit_tracker(preview: bool = False, force: bool = False):
    """الدالة الرئيسية لفحص وإرسال الأهداف المحققة."""
    print("=" * 65)
    print("🎯 بدء فحص أهداف رادار السيولة المحققة بالجلسة...")
    print(f"⏰ الوقت: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    targets = get_active_radar_targets()
    print(f"📋 إجمالي التوصيات الخاضعة للمراقبة: {len(targets)} سهم")

    hits = scan_for_target_hits(targets)
    print(f"🔥 تم رصد {len(hits)} ضربة هدف جديدة بالجلسة")

    if preview:
        print("\n🔍 --- معاينة الأهداف المرصودة (بدون إرسال) ---")
        for h in hits[:10]:
            print(f"  • {h['name_ar']} ({h['ticker']}): توصية={h['entry_price']:.2f} -> أعلى جلسة={h['hit_price']:.2f} -> مكسب محقق=+{h['profit_pct']:.1f}% [{h['hit_level']}] (تاريخ: {h['prediction_date']}, مدة: {h['duration_text']})")
        return

    if not hits and not force:
        print("✅ لا توجد أهداف جديدة بحاجة للبث حالياً.")
        return

    state = load_hit_state()
    announced = state.setdefault('announced_hits', {})

    items_to_send = hits if not force else (hits if hits else targets[:1])

    sent_count = 0
    for item in items_to_send:
        tk = item.get('ticker')
        hit_key = item.get('hit_key', f"{tk}_FORCED_{datetime.now().strftime('%Y-%m-%d')}")

        if 'hit_price' not in item:
            item['hit_price'] = item['entry_price'] * 1.07
            item['profit_pct'] = 7.0
            item['hit_level'] = 'TP1'
            item['next_action_title'] = 'استكمال صعود قوي وحماية الأرباح'
            item['next_target'] = item['entry_price'] * 1.14
            item['next_profit_pct'] = 14.0
            item['trailing_stop'] = item['entry_price'] * 1.01
            item['action_advice'] = "السيولة إيجابية ويُفضل استمرار التداول مع رفع الوقف."

        print(f"\n🚀 معالجة سهم: {item['name_ar']} ({tk}) | مكسب محقق: +{item['profit_pct']:.1f}% | {item['hit_level']}")

        # 1. توثيق وتسجيل ضرب الهدف في قاعدة البيانات للمشروع والموقع أولاً
        record_target_hit_in_db(item)

        # ─── TELEGRAM-HIT-FILTER (Owner Directive: عدم إغراق القناة) ───
        max_hits_per_day = int(os.environ.get('MAX_TELEGRAM_HITS_PER_DAY', '2'))
        min_broadcast_profit = float(os.environ.get('MIN_BROADCAST_PROFIT_PCT', '5.0'))

        today_prefix = datetime.now().strftime('%Y-%m-%d')
        today_sent = sum(1 for v in announced.values() if isinstance(v, dict) and str(v.get('sent_at', '')).startswith(today_prefix))

        if not force and today_sent >= max_hits_per_day:
            print(f"ℹ️ تم بلوغ الحد اليومي لبث الأهداف على التليجرام ({today_sent}/{max_hits_per_day}) — تم توثيق الهدف بالموقع فقط لتجنب إغراق القناة.")
            continue

        if not force and item.get('profit_pct', 0) < min_broadcast_profit and item.get('hit_level') != 'TP2':
            print(f"ℹ️ الربح المحقق (+{item.get('profit_pct', 0):.1f}%) أقل من عتبة البث المميز ({min_broadcast_profit}%) — تم توثيقه بالقاعدة دون إزعاج المتابعين.")
            continue

        # 2. توليد البطاقة المصورة المتطورة
        card_img = asyncio.run(generate_hit_card_image(item))
        caption, reply_markup = format_hit_caption(item)

        print(f"🖼️ تم توليد البطاقة المصورة: {card_img}")
        print("📨 إرسال الإشعار والبطاقة إلى قناة التليجرام...")

        success = send_telegram_hit(card_img, caption, reply_markup)
        if success:
            print(f"✅ تم بث نجاح التوقع لسهم {tk} بنجاح!")
            announced[hit_key] = {
                'sent_at': datetime.now().isoformat(),
                'profit_pct': item['profit_pct'],
                'hit_level': item['hit_level'],
                'hit_price': item['hit_price'],
                'prediction_date': item.get('prediction_date'),
                'duration_text': item.get('duration_text'),
                'source': item.get('source')
            }
            save_hit_state(state)
            sent_count += 1
        else:
            print(f"❌ فشل إرسال إشعار السهم {tk}")

        if len(items_to_send) > 1:
            import time
            time.sleep(3)

    print(f"\n🏁 اكتمل الفحص: تم بث {sent_count} هدف محقق بنجاح.")


if __name__ == '__main__':
    preview_mode = '--preview' in sys.argv
    force_mode = '--force' in sys.argv
    run_target_hit_tracker(preview=preview_mode, force=force_mode)
