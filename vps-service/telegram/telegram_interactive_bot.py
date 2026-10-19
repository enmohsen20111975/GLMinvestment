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
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for signal/accumulation/money_flow classification.
try:
    from utils.canonical_signal import (
        classify_signal, signal_ar as canonical_signal_ar,
        classify_stock_phase, classify_accumulation,
    )
except ImportError:  # pragma: no cover - fallback if utils not on path
    def classify_signal(_score):  # type: ignore[no-redef]
        return None
    def canonical_signal_ar(_sig):  # type: ignore[no-redef]
        return None
    def classify_stock_phase(*_a, **_kw):  # type: ignore[no-redef]
        return None
    def classify_accumulation(*_a, **_kw):  # type: ignore[no-redef]
        return None

try:
    from analyzers.trader_levels_engine import get_unified_trader_levels
except ImportError:
    try:
        from trader_levels_engine import get_unified_trader_levels
    except ImportError:
        get_unified_trader_levels = None

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
                        key = k.strip()
                        val = v.strip().strip('"').strip("'")
                        # تعيين القيمة إذا لم تكن موجودة أو كانت فارغة
                        if not os.environ.get(key):
                            os.environ[key] = val
            break

load_env()
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHANNEL_ID = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()  # Task SECURITY-P0: removed hardcoded channel fallback

# ─── ADMIN-TELEGRAM-BYPASS (Task DEEP-AUDIT-FIX, Rule 50 + Rule 72) ────────
# قبل كده: البوت كان بـ يطلب من الأدمن يسجّل + يربط حسابه رغم إنه المالك.
# السبب: check_subscription() بـ يتحقق من user_telegram_links table — لو
# الـ chat_id مش متسجل هناك، البوت بيرفض الدخول حتى لو كان الأدمن نفسه.
# الحل: قائمة ADMIN_TELEGRAM_IDS من env vars — أي chat_id فيها بـ يدخل مباشرة.
ADMIN_TELEGRAM_IDS = set(
    tid.strip() for tid in os.environ.get("ADMIN_TELEGRAM_IDS", "").split(",") if tid.strip()
)
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
PLATFORM_URL = "https://invist.m2y.net"

# BOT-SUBSCRIPTION-GATE (2026-10-01): الـ API base اللي البوت بيكلمه على الموقع.
BOT_API_SECRET = os.environ.get("BOT_API_SECRET", "").strip()
NEXT_PUBLIC_API_URL = (os.environ.get("NEXT_PUBLIC_API_URL") or "").strip() or PLATFORM_URL
SUBSCRIPTION_UPGRADE_URL = f"{PLATFORM_URL}/#subscription"

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
    "حليج الاقطان": "ACGC",
    "الاقطان": "ACGC",
    "أكرو": "ACGC",
    "النيل للادوية": "NIPH",
    "النيل للأدوية": "NIPH",
    "النيل للادويه": "NIPH",
    "النيل": "NIPH",
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
        res = r.json()
        if not res.get("ok"):
            log.warning(f"⚠️ خطأ في تسليم الرسالة إلى {chat_id}: {res}")
        return res
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

# EXPERT-ANALYSIS-ENGINE (2026-10-09):
# جلب تحليل خبير احترافي من Node API
def _fetch_bot_expert_analysis(ticker: str) -> str:
    """جلب تحليل خبير من /api/stocks/[ticker]/expert-analysis للبوت."""
    if not ticker:
        return "—"
    try:
        import requests
        url = f"http://localhost:3000/api/stocks/{ticker.upper()}/expert-analysis"
        resp = requests.get(url, timeout=5)
        if not resp.ok:
            return "—"
        data = resp.json()
        if not data.get('success') or not data.get('analysis'):
            return "—"
        a = data['analysis']
        tech = a.get('technical', {})
        fund = a.get('fundamental', {})
        risk = a.get('risk', {})

        lines = []
        # ملخص فني
        rsi = tech.get('rsi', {})
        ma = tech.get('movingAverages', {})
        sr = tech.get('supportResistance', {})
        if rsi.get('value') is not None:
            lines.append(f"📈 RSI: <b>{rsi['value']:.1f}</b> ({rsi.get('signal_ar', '—')})")
        if ma.get('trend_ar'):
            lines.append(f"📊 الترند: <b>{ma['trend_ar']}</b>")
        if sr.get('support') is not None or sr.get('resistance') is not None:
            lines.append(f"🎯 دعم: <code>{sr.get('support', '—')}</code> | مقاومة: <code>{sr.get('resistance', '—')}</code>")

        # ملخص أساسي
        roe = fund.get('roe', {})
        pe = fund.get('peRatio', {})
        div = fund.get('dividend', {})
        eps = fund.get('eps', {})
        if roe.get('value') is not None:
            lines.append(f"🏦 ROE: <b>{roe['value']:.1f}%</b> ({roe.get('rating_ar', '—')})")
        if pe.get('value') is not None:
            lines.append(f"💰 P/E: <b>{pe['value']:.1f}x</b> ({pe.get('rating_ar', '—')})")
        if eps.get('value') is not None:
            lines.append(f"💵 EPS: <b>{eps['value']:.2f} جنيه</b>")
        if div.get('value') is not None:
            lines.append(f"💸 توزيعات: <b>{div['value']:.2f}%</b> ({div.get('rating_ar', '—')})")

        # مخاطر
        if risk.get('level_ar'):
            lines.append(f"⚠️ المخاطرة: <b>{risk['level_ar']}</b>")
        if risk.get('positionSize_ar'):
            lines.append(f"📏 المركز: {risk['positionSize_ar']}")

        return '\n'.join(lines) if lines else "—"
    except Exception:
        return "—"


def search_stock(query: str) -> Optional[Dict]:
    """البحث عن السهم بالرمز الإنجليزي أو الاسم العربي الشائع."""
    q = query.strip()
    q_upper = q.upper()

    # 1. مطابقة مباشرة لقاموس الأسماء العربية
    if q in ARABIC_ALIASES:
        q_upper = ARABIC_ALIASES[q]
    elif q.lower() in ARABIC_ALIASES:
        q_upper = ARABIC_ALIASES[q.lower()]
    else:
        # ترتيب الألقاب بالأطول أولاً لتجنب الكلمات القصيرة مثل 'وي'
        for alias, tk in sorted(ARABIC_ALIASES.items(), key=lambda x: len(x[0]), reverse=True):
            if len(alias) >= 3 and (alias in q or (len(q) >= 3 and q in alias)):
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

def get_stock_radar_status(symbol: str, current_price: Optional[float] = None) -> Dict:
    """استخراج إشارات رادار الميكرز V40.2 ومستويات الأهداف الموحدة هندسياً من trader_levels_engine (SSOT)."""
    sym = symbol.upper().strip()
    # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67 + Rule 27 NO-FAKE-DATA)
    # signal/direction/confidence/vol_ratio previously had fabricated defaults
    # ('تجميع صاعد', 'تجميع صاعد مع صانع السوق', 75, 1.2). Now None — only
    # populated when a real source provides them.
    radar_info = {
        'signal': None,
        'confidence': None,
        'entry': 0.0,
        'entry_min': 0.0,
        'entry_max': 0.0,
        'entry_range_str': '',
        'target_1': 0.0,
        'target_2': 0.0,
        'stop_loss': 0.0,
        'support_1': 0.0,
        'support_2': 0.0,
        'resistance_1': 0.0,
        'resistance_2': 0.0,
        'risk_reward': None,
        'vol_ratio': None,
        'direction': None,
        'advice': ''
    }

    # 1. جلب المستويات الحسابية الموحدة الهندسية (Single Source of Truth)
    if get_unified_trader_levels:
        try:
            levels = get_unified_trader_levels(sym, current_price=current_price)
            if levels:
                radar_info['entry_min'] = levels.get('entry_min', 0.0)
                radar_info['entry_max'] = levels.get('entry_max', 0.0)
                radar_info['entry'] = levels.get('entry_max', 0.0)
                radar_info['entry_range_str'] = levels.get('entry_range_str', '')
                radar_info['target_1'] = levels.get('target_1', 0.0)
                radar_info['target_2'] = levels.get('target_2', 0.0)
                radar_info['stop_loss'] = levels.get('stop_loss', 0.0)
                radar_info['support_1'] = levels.get('support_1', 0.0)
                radar_info['support_2'] = levels.get('support_2', 0.0)
                radar_info['resistance_1'] = levels.get('resistance_1', 0.0)
                radar_info['resistance_2'] = levels.get('resistance_2', 0.0)
                radar_info['risk_reward'] = levels.get('risk_reward', 2.0)
                radar_info['advice'] = levels.get('advice', '')
        except Exception as e:
            log.warning(f"خطأ في trader_levels_engine لـ {sym}: {e}")

    # 2. قراءة حالة الرادار ومسار السيولة التجميعية من predictions.db
    if PREDICTIONS_DB.exists():
        try:
            conn = sqlite3.connect(str(PREDICTIONS_DB))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cols = [c[1] for c in cur.execute("PRAGMA table_info(predictions)").fetchall()]
            vol_col = ', vol_ratio_now' if 'vol_ratio_now' in cols else ''
            query = f"""
                SELECT signal, confidence, direction{vol_col}
                FROM predictions
                WHERE ticker = ?
                ORDER BY id DESC LIMIT 1
            """
            row = cur.execute(query, (sym,)).fetchone()

            if row:
                d = dict(row)
                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 27)
                # Don't fabricate values when DB rows are missing — keep None.
                if d.get('signal'):
                    radar_info['signal'] = d.get('signal')
                if d.get('confidence') is not None:
                    try:
                        radar_info['confidence'] = int(d.get('confidence'))
                    except (TypeError, ValueError):
                        pass
                if 'vol_ratio_now' in cols and d.get('vol_ratio_now') is not None:
                    try:
                        radar_info['vol_ratio'] = float(d.get('vol_ratio_now'))
                    except (TypeError, ValueError):
                        pass
                if d.get('direction'):
                    radar_info['direction'] = d.get('direction')
            conn.close()
        except Exception as e:
            log.warning(f"خطأ قراءة predictions.db لـ {sym}: {e}")

    return radar_info

DAILY_QUERY_LIMIT_TRIAL = 5
_daily_query_counts: Dict[str, int] = {}

def check_and_increment_daily_limit(chat_id: int) -> Tuple[bool, int, int]:
    """
    فحص وزيادة عداد الاستعلامات اليومي لمستخدمي الفترة التجريبية.
    Returns: (is_allowed, current_count, remaining_today)
    """
    today_key = f"{chat_id}:{time.strftime('%Y-%m-%d')}"
    if len(_daily_query_counts) > 5000:
        _daily_query_counts.clear()

    count = _daily_query_counts.get(today_key, 0)
    if count >= DAILY_QUERY_LIMIT_TRIAL:
        return False, count, 0
    new_count = count + 1
    _daily_query_counts[today_key] = new_count
    remaining = max(0, DAILY_QUERY_LIMIT_TRIAL - new_count)
    return True, new_count, remaining


def build_stock_card(
    stock: Dict,
    radar: Dict,
    sub: Optional[Dict] = None,
    remaining_queries: Optional[int] = None
) -> Tuple[str, dict]:
    """
    بناء كارت المتداول الاحترافي الموحد (SSOT) مع الشارت المصور:
    - منطقة الدخول المحسوبة (من كذا لكذا) لمنع مطاردة السعر.
    - الهدف الأول (TP1) المرتكز على المقاومة الأولى R1 لتأمين 50%.
    - الهدف الثاني (TP2) المرتكز على المقاومة الثانية R2 (محجوب للتجريبي / مكشوف لـ VIP).
    - وقف الخسارة الصارم المرتكز على كسر الدعم الأول S1.
    - خارطة الدعوم والمقاومات الهيكلية (د1، د2، م1، م2).
    """
    sym = stock['symbol']
    name = stock['name_ar']
    # AUDIT-PUBLISH-QUALITY (Rule 27): keep None for price when source has
    # no real price → render "—" placeholders instead of fabricating "0.00".
    try:
        _raw_price = stock.get('price')
        price = float(_raw_price) if _raw_price is not None else 0.0
    except (TypeError, ValueError):
        price = 0.0
    try:
        chg = float(stock.get('change') or 0.0)
    except (TypeError, ValueError):
        chg = 0.0

    chg_icon = "🟢 +" if chg >= 0 else "🔴 "
    chg_str = f"{chg_icon}{abs(chg):.2f}%" if price > 0 else "—"

    # AUDIT-PUBLISH-QUALITY: derive fallback levels ONLY when price is real.
    # When price is missing (0), set everything to None so the card renders
    # "—" placeholders instead of "0.00 ج.م" everywhere.
    if price > 0:
        entry_min = float(radar.get('entry_min') or (price * 0.99))
        entry_max = float(radar.get('entry_max') or (price * 1.01))
        s1 = float(radar.get('support_1') or (price * 0.96))
        s2 = float(radar.get('support_2') or (price * 0.92))
        r1 = float(radar.get('resistance_1') or (price * 1.06))
        r2 = float(radar.get('resistance_2') or (price * 1.12))
        tp1 = float(radar.get('target_1') or (r1 * 0.995))
        tp2 = float(radar.get('target_2') or (r2 * 0.995))
        sl = float(radar.get('stop_loss') or (s1 * 0.985))
    else:
        entry_min = entry_max = s1 = s2 = r1 = r2 = tp1 = tp2 = sl = None
    # AUDIT-PUBLISH-QUALITY (Rule 27): do NOT fabricate R/R = 2.0 by default.
    try:
        rr = float(radar.get('risk_reward')) if radar.get('risk_reward') is not None else None
    except (TypeError, ValueError):
        rr = None
    if price > 0 and entry_min and entry_max:
        advice = radar.get('advice') or f"السعر داخل نطاق الشراء الآمن ({entry_min:,.2f} - {entry_max:,.2f} ج.م) — التزم بالوقف والأهداف"
    else:
        advice = radar.get('advice') or '— لا تتوفر بيانات كافية لتحديد توجيه محدد لهذا السهم حالياً.'

    tp1_gain = ((tp1 - price) / price * 100) if (price > 0 and tp1 is not None) else 0
    tp2_gain = ((tp2 - price) / price * 100) if (price > 0 and tp2 is not None) else 0
    sl_loss = ((price - sl) / price * 100) if (price > 0 and sl is not None) else 0

    # AUDIT-PUBLISH-QUALITY helper: render "—" when level is None.
    def _lv(v):
        if v is None:
            return '—'
        try:
            f = float(v)
        except (TypeError, ValueError):
            return '—'
        if f != f or not (-1e12 < f < 1e12):
            return '—'
        return f"{f:,.2f}"

    price_str = _lv(price) if price > 0 else '—'
    entry_min_str = _lv(entry_min)
    entry_max_str = _lv(entry_max)
    s1_str = _lv(s1)
    s2_str = _lv(s2)
    r1_str = _lv(r1)
    r2_str = _lv(r2)
    tp1_str = _lv(tp1)
    tp2_str = _lv(tp2)
    sl_str = _lv(sl)
    rr_str = f"{rr:.1f}" if rr is not None and rr == rr else '—'

    is_paid = bool(sub and sub.get("is_paid"))
    is_fail_open = bool(sub and sub.get("_fail_open"))
    is_vip = is_paid or is_fail_open

    days_left = sub.get("days_left", 7) if sub else 7

    # AUDIT-PUBLISH-QUALITY: render gain/loss % only when level is valid
    # (otherwise the card leaks "+0.0%" / "-0.0%" placeholders).
    tp1_gain_str = f" (+{tp1_gain:.1f}%)" if (tp1 is not None and price > 0) else ""
    tp2_gain_str = f" (+{tp2_gain:.1f}%)" if (tp2 is not None and price > 0) else ""
    sl_loss_str = f" (-{sl_loss:.1f}%)" if (sl is not None and price > 0) else ""

    # سطر الهدف الثاني وحالة العضوية
    if is_vip:
        badge_header = "👑 <b>مشترك VIP | فحص غير محدود</b>"
        tp2_line = f"🚀 <b>الهدف الثاني (TP2):</b> <code>{tp2_str} ج.م</code>{tp2_gain_str} [مقاومة م2: {r2_str}]"
        urgency_footer = ""
    else:
        badge_header = f"⏳ <b>فترة تجريبية (متبقي {days_left} أيام)</b>"
        tp2_line = "🚀 <b>الهدف الثاني (TP2):</b> 🔒 <i>[محجوب — متاح لمشتركي باقات VIP فقط]</i>"
        used_today = DAILY_QUERY_LIMIT_TRIAL - (remaining_queries if remaining_queries is not None else 0)
        urgency_footer = f"""
━━━━━━━━━━━━━━━━━━━
⏳ <b>تنبيه التجربة المجانية (7 أيام):</b> متبقي لك <b>{days_left}</b> أيام فقط!
⚡ <b>الاستهلاك اليومي:</b> تم استخدام {used_today}/{DAILY_QUERY_LIMIT_TRIAL} استعلامات اليوم.
💎 <b>اشترك الآن لفتح الهدف الثاني (TP2) والوصول اللامحدود:</b>"""

    # EXPERT-ANALYSIS-ENGINE (2026-10-09): جلب تحليل خبير احترافي
    expert_analysis_text = _fetch_bot_expert_analysis(sym)

    msg = f"""📊 <b>سهم {sym} — {name}</b>
{badge_header}
━━━━━━━━━━━━━━━━━━━
💰 <b>السعر الحالي:</b> <code>{price_str} ج.م</code> ({chg_str})

📍 <b>نطاق الدخول المقترح (Buy Zone):</b>
   من <code>{entry_min_str}</code> إلى <code>{entry_max_str}</code> ج.م
   ⚠️ <i>لا تطارد السعر إذا تجاوز أعلى نقطة ({entry_max_str} ج.م)!</i>

🎯 <b>المستهدفات التداولية:</b>
   🎯 <b>الهدف الأول (TP1):</b> <code>{tp1_str} ج.م</code>{tp1_gain_str}
      └ <i>عند مقاومة م1 ({r1_str} ج.م) — جني 50% وتأمين الصفقة بنقل الوقف لدخولك.</i>
   {tp2_line}

🛡️ <b>وقف الخسارة الصارم (SL):</b> <code>{sl_str} ج.م</code>{sl_loss_str}
   └ <i>كسر الدعم د1 ({s1_str} ج.م) بإغلاق يلغي الإيجابية.</i>
   ⚖️ <b>نسبة العائد للمخاطرة (R:R):</b> 1 : {rr_str}

🧱 <b>خارطة الدعوم والمقاومات الهيكلية:</b>
   🛡️ <b>الدعوم:</b> د1 = <code>{s1_str}</code> ج.م | د2 = <code>{s2_str}</code> ج.م
   🚀 <b>المقاومات:</b> م1 = <code>{r1_str}</code> ج.م | م2 = <code>{r2_str}</code> ج.م

💡 <b>توجيه المحلل الخبير:</b>
   {advice}
━━━━━━━━━━━━━━━━━━━
🔍 <b>رادار الميكرز V40.2:</b>
• الحالة: {radar.get('signal') or '—'} (ثقة {radar.get('confidence') or '—'}%)
• المسار: {radar.get('direction') or '—'}

💡 <i>مستويات محسوبة هندسياً من قيعان وقمم السيولة الحقيقية.</i>

━━━━━━━━━━━━━━━━━━━
🎓 <b>تحليل خبير احترافي:</b>
{expert_analysis_text}

━━━━━━━━━━━━━━━━━━━
⚠️ <i>تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.</i>{urgency_footer}"""

    if is_vip:
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "📊 فتح الشارت الحي على المنصة", "url": "https://invist.m2y.net/#trading-chart"},
                    {"text": "🎯 رادار الميكرز", "url": "https://invist.m2y.net/#recommendations"}
                ],
                [
                    {"text": "🔍 فحص سهم آخر من القائمة", "callback_data": "action:show_stock_menu"},
                    {"text": "🌐 منصة التحليل المباشر", "url": "https://invist.m2y.net/#dashboard"}
                ]
            ]
        }
    else:
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "💎 فتح الهدف الثاني واشتراك VIP", "url": SUBSCRIPTION_UPGRADE_URL}
                ],
                [
                    {"text": "🔍 فحص سهم آخر", "callback_data": "action:show_stock_menu"},
                    {"text": "🎯 رادار الميكرز", "callback_data": "action:show_radar_picks"}
                ],
                [
                    {"text": "🌐 ترقية باقتك على المنصة", "url": SUBSCRIPTION_UPGRADE_URL}
                ]
            ]
        }

    return msg.strip(), keyboard

def send_stock_analysis_response(
    chat_id: int,
    stock: Dict,
    sub: Optional[Dict] = None,
    remaining_queries: Optional[int] = None
):
    """توليد صورة الشارت وإرسالها مع التحليل الكامل للمستخدم."""
    radar = get_stock_radar_status(stock['symbol'], current_price=stock.get('price', 0.0))
    msg, kb = build_stock_card(stock, radar, sub=sub, remaining_queries=remaining_queries)

    # 1. إشعار فوري بأن الشارت جاري رسمه
    wait_msg = send_message(chat_id, f"⏳ جاري رسم شارت <b>{stock['symbol']}</b> وفحص مستويات الميكرز...", reply_markup=None)
    wait_msg_id = wait_msg.get('result', {}).get('message_id') if wait_msg else None

    # 2. رسم الشارت فائق الدقة
    photo_sent = False
    try:
        try:
            from telegram_chart_generator import generate_stock_chart_image
        except ImportError:
            from telegram.telegram_chart_generator import generate_stock_chart_image
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

# ============================================================================
# BOT-SUBSCRIPTION-GATE (2026-10-01): Subscription gate helpers
# ----------------------------------------------------------------------------
# حصر البوت التفاعلي للأعضاء المسجلين على الموقع حصرياً مع فترة تجريبية 7 أيام.
# عند انتهاء الـ 7 أيام، يقفل البوت بالكامل مع توجيه مباشر للاشتراك المدفوع.
# ============================================================================

def _bot_headers() -> dict:
    """Shared headers for the bot→website API calls."""
    return {
        "X-Bot-Secret": BOT_API_SECRET,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def check_subscription(chat_id: int) -> dict:
    """
    اسأل الموقع هل الـ chat_id ده مربوط بحساب + هل الحساب مدفوع/في trial نشطة (7 أيام).
    """
    # ─── ADMIN-TELEGRAM-BYPASS (Task DEEP-AUDIT-FIX, Rule 50) ──────────────
    # لو chat_id في قائمة ADMIN_TELEGRAM_IDS → ادخل مباشرة بدون أي فحص.
    if str(chat_id) in ADMIN_TELEGRAM_IDS:
        log.info(f"[ADMIN-BYPASS] chat_id={chat_id} is in ADMIN_TELEGRAM_IDS — granting full access")
        return {
            "linked": True,
            "user_id": "admin",
            "subscription_tier": "admin",
            "is_paid": True,
            "is_trial_active": True,
            "days_left": 999,
            "trial_ends_at": None,
            "display_name": "المالك / الأدمن",
            "_admin_bypass": True,
        }

    if not BOT_API_SECRET:
        # Task SECURITY-P0 (fail-closed): كان fail-open (يرجع is_paid=True) → أي مستخدم VIP.
        # الآن fail-closed: لو BOT_API_SECRET فارغ → رفض الوصول (is_paid=False).
        log.error("BOT_API_SECRET is empty — subscription gate CLOSED (fail-closed). Set BOT_API_SECRET env var.")
        return {"linked": False, "is_paid": False, "_fail_closed": True, "error": "bot_api_secret_missing"}
    try:
        r = requests.get(
            f"{NEXT_PUBLIC_API_URL}/api/bot/check-subscription",
            params={"chat_id": chat_id},
            headers=_bot_headers(),
            timeout=4,
        )
        if r.ok:
            data = r.json()
            if isinstance(data, dict):
                return data
        log.warning(f"check_subscription HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        log.warning(f"check_subscription HTTP failed: {e}")

    # Fallback: فحص مباشر لقاعدة بيانات auth.db محلياً في حالة بطء أو إعادة تشغيل سيرفر الويب
    auth_db_path = DB_DIR / "auth.db"
    if auth_db_path.exists():
        try:
            conn = sqlite3.connect(str(auth_db_path))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            link = cur.execute(
                "SELECT user_id FROM user_telegram_links WHERE telegram_chat_id = ? AND is_active = 1",
                (str(chat_id),)
            ).fetchone()
            if not link:
                conn.close()
                return {"linked": False}
            user_id = link["user_id"]
            user = cur.execute(
                "SELECT id, subscription_tier, trial_ends_at, created_at, name, username, is_active FROM User WHERE id = ?",
                (user_id,)
            ).fetchone()
            conn.close()
            if user:
                if user["is_active"] is not None and not user["is_active"]:
                    return {"linked": False}
                tier = (user["subscription_tier"] or "free").lower()
                paid_tiers = {"normal", "premium", "pro", "b2b_starter", "b2b_pro", "b2b_enterprise", "developer", "admin"}
                is_paid = tier in paid_tiers

                # حساب فترة التجربة 7 أيام
                from datetime import datetime, timezone, timedelta
                import math

                now = datetime.now(timezone.utc)
                trial_ends = None
                if user["trial_ends_at"]:
                    try:
                        trial_ends = datetime.fromisoformat(str(user["trial_ends_at"]).replace("Z", "+00:00"))
                    except Exception:
                        pass
                if not trial_ends and user["created_at"]:
                    try:
                        created = datetime.fromisoformat(str(user["created_at"]).replace("Z", "+00:00"))
                        trial_ends = created + timedelta(days=7)
                    except Exception:
                        pass
                if not trial_ends:
                    trial_ends = now + timedelta(days=7)

                if is_paid:
                    is_trial_active = True
                    days_left = 999
                else:
                    is_trial_active = (trial_ends > now)
                    if is_trial_active:
                        diff = (trial_ends - now).total_seconds()
                        days_left = max(1, int(math.ceil(diff / 86400.0)))
                    else:
                        days_left = 0

                return {
                    "linked": True,
                    "user_id": user["id"],
                    "subscription_tier": tier,
                    "is_paid": is_paid,
                    "is_trial_active": is_trial_active,
                    "days_left": days_left,
                    "trial_ends_at": trial_ends.isoformat() if trial_ends else None,
                    "display_name": user["name"] or user["username"] or "عزيزي المستثمر"
                }
        except Exception as db_err:
            log.warning(f"Local auth.db fallback query failed: {db_err}")

    return {"_error": True, "error": "gate_offline"}


def _send_gate_unavailable(chat_id: int):
    """الموقع مش راد — رسالة مؤقتة، وم重要的是 ما نقولش للمستخدم 'اربط حسابك'."""
    send_message(
        chat_id,
        "⚠️ <b>في مشكلة مؤقتة في الاتصال بالمنصة</b>\n\n"
        "البوت مش قادر يتأكد من اشتراكك دلوقتي. جرّب تاني بعد دقيقة، "
        "ولو المشكلة استمرت تواصل مع الدعم.",
    )


def generate_link_token(chat_id: int, username: str = "") -> dict:
    """
    اطلب من الموقع توليد رمز ربط لمرة واحدة (TTL=10min) ونرجّعه للبوت
    عشان يعرضه كزر URL في الشات.
    """
    if not BOT_API_SECRET:
        return {}
    try:
        r = requests.post(
            f"{NEXT_PUBLIC_API_URL}/api/bot/link-token",
            json={"chat_id": chat_id, "username": username},
            headers=_bot_headers(),
            timeout=5,
        )
        if r.ok:
            return r.json()
        log.warning(f"generate_link_token HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        log.warning(f"generate_link_token failed: {e}")
    return {}


def _send_link_prompt(chat_id: int, user_name: str = ""):
    """إشعار حصر البوت للمسجلين فقط في المنصة."""
    link_data = generate_link_token(chat_id, user_name)
    link_url = link_data.get("link_url") or f"{PLATFORM_URL}/#auth"

    msg = f"""مرحباً بك <b>{user_name or 'عزيزي المستثمر'}</b>! 👋

🔒 <b>خدمة بوت الميكرز التفاعلي متاحة حصرياً للأعضاء المسجلين في منصتنا.</b>

للاستفادة من تحليلات البوت، فحص الأسهم، وشارتات الشموع اللحظية:
1️⃣ أنشئ حسابك مجاناً على المنصة (أو سجّل دخولك إذا كان لديك حساب).
2️⃣ تحصل فوراً على <b>فترة تجريبية مجانية لمدة أسبوع (7 أيام)</b> بكافة المزايا.
3️⃣ اضغط على زر <b>🔗 ربط حسابك في الموقع</b> أدناه لتفعيل البوت فوراً! ✅

🌐 <b>رابط المنصة للتسجيل والتفعيل:</b>
👉 https://invist.m2y.net/"""

    kb = {
        "inline_keyboard": [
            [{"text": "🔗 ربط حسابك في الموقع (تفعيل فوري)", "url": link_url}],
            [{"text": "🌐 فتح المنصة والتسجيل (تجربة 7 أيام)", "url": "https://invist.m2y.net/"}]
        ]
    }
    send_message(chat_id, msg, reply_markup=kb)


def _send_trial_expired_prompt(chat_id: int, user_name: str = ""):
    """إشعار انتهاء الفترة التجريبية (7 أيام) وغلق البوت بالكامل مع روابط الترقية الفورية."""
    msg = f"""⛔ <b>عفواً {user_name or 'صديقنا المتداول'}، انتهت فترتك التجريبية المجانية (7 أيام)!</b> ⏳
━━━━━━━━━━━━━━━━━━━━
🔒 <b>تم قفل ميزات البوت التفاعلي ورادار الميكرز بالكامل.</b>

للاستمرار في اقتناص صفقات صناع السوق وتحقيق أفضل أداء استثماري:
• 🎯 إشارات رادار الميكرز V40.2 اللحظية ونسب التجميع المؤسسي
• 🚀 الأهداف الصاعدة الكاملة (الهدف الأول TP1 + الهدف الثاني TP2)
• 🛡️ مستويات وقف الخسارة الدقيقة وإدارة المخاطر الصارمة
• 📊 شارتات فنية فائقة الدقة لكل أسهم البورصة المصرية
• ♾️ فحص واستعلامات غير محدودة طوال اليوم

👇 <b>اختر باقتك الآن لتفعيل اشتراكك الفوري ومتابعة التداول:</b>"""

    kb = {
        "inline_keyboard": [
            [{"text": "💎 اشترك الآن في باقة Premium (فوري / كروت / كاش)", "url": SUBSCRIPTION_UPGRADE_URL}],
            [{"text": "💳 خيارات الدفع والاشتراك السريع", "url": SUBSCRIPTION_UPGRADE_URL}],
            [{"text": "🌐 تصفح المنصة والباقات", "url": "https://invist.m2y.net/"}]
        ]
    }
    send_message(chat_id, msg, reply_markup=kb)


def _send_daily_limit_exceeded_prompt(chat_id: int, user_name: str = ""):
    """إشعار تجاوز الحد اليومي للاستعلامات (5 استعلامات) للباقة التجريبية."""
    msg = f"""⚠️ <b>عزيزي {user_name or 'المتداول'}، لقد استنفدت حد الفحص اليومي!</b>
━━━━━━━━━━━━━━━━━━━━
⚡ في الفترة التجريبية المجانية، الحد المتاح هو <b>5 استعلامات فقط في اليوم</b>.

💎 <b>هل ترغب في فحص أي سهم بلا حدود؟</b>
اشترك الآن في باقة <b>Premium</b> للحصول على:
• ♾️ استعلامات وفحص شارتات غير محدودة
• 🔓 فتح الهدف الثاني (TP2) لجميع الأسهم
• 🎯 الوصول الكامل لكل فرص رادار الميكرز اللحظية

👇 اضغط للترقية فوراً وبدء الوصول اللامحدود:"""

    kb = {
        "inline_keyboard": [
            [{"text": "💎 ترقية إلى باقة Premium غير المحدودة", "url": SUBSCRIPTION_UPGRADE_URL}],
            [{"text": "🎯 رادار الميكرز", "callback_data": "action:show_radar_picks"}]
        ]
    }
    send_message(chat_id, msg, reply_markup=kb)


def _send_upgrade_prompt(chat_id: int, user_name: str = "", tier: str = "free"):
    """رسالة ترقية اختيارية لباقة Premium."""
    msg = f"""مرحباً {user_name or 'صديقنا'}! 👋

✅ حسابك مربوط، اشتراكك الحالي: <b>{tier or 'مجاني'}</b>

💎 <b>للحصول على مميزات الباقة المتقدمة:</b>
• أولوية تنبيهات رادار الميكرز اللحظية
• تقارير التجميع المؤسسي الاحترافية

👇 اضغط للترقية:"""
    kb = {"inline_keyboard": [[{"text": "💎 تفاصيل باقات Premium", "url": SUBSCRIPTION_UPGRADE_URL}]]}
    send_message(chat_id, msg, reply_markup=kb)


def get_user_access_status(sub: dict) -> Tuple[bool, str]:
    """
    التحقق من حالة وصول المستخدم:
    - 'paid' -> مشترك مدفوع VIP (وصول كامل دون قيود)
    - 'trial_active' -> تجربة مجانية نشطة (7 أيام) (وصول مقيد مع ضغط تسويقي)
    - 'trial_expired' -> تجربة منتهية (قفل البوت بالكامل)
    - 'not_linked' -> غير مسجل أو غير مربوط بالمنصة (حظر كامل)
    - 'error' -> خطأ شبكي مؤقت
    """
    if sub.get("_fail_open"):
        return True, "paid"
    if sub.get("_error"):
        return False, "error"
    if not sub.get("linked"):
        return False, "not_linked"
    if sub.get("is_paid"):
        return True, "paid"
    if sub.get("is_trial_active"):
        return True, "trial_active"
    return False, "trial_expired"


def is_user_allowed(sub: dict) -> bool:
    """هل يُسمح للمستخدم بأي وصول؟ مسموح فقط للمدفوع أو في فترة التجربة النشطة."""
    allowed, _ = get_user_access_status(sub)
    return allowed


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


def handle_start(chat_id: int, user_name: str = "", start_param: str = ""):
    """
    الرد على أمر /start — مع بوابة الاشتراك ودعم فحص الأسهم المباشر (Deep Linking).
    """
    sub = check_subscription(chat_id)

    if sub.get("_fail_open"):
        pass
    elif sub.get("_error"):
        return _send_gate_unavailable(chat_id)
    else:
        allowed, status = get_user_access_status(sub)
        if status == "not_linked":
            return _send_link_prompt(chat_id, user_name)
        if status == "trial_expired":
            return _send_trial_expired_prompt(chat_id, user_name)

    # لو وصل المستخدم عبر رابط فحص مباشر لسهم: /start COMI
    if start_param:
        clean_ticker = start_param.replace("stock_", "").replace("analyze_", "").strip().upper()
        stock = search_stock(clean_ticker)
        if stock:
            rem = None
            allowed, status = get_user_access_status(sub)
            if status == "trial_active":
                can_query, count, rem = check_and_increment_daily_limit(chat_id)
                if not can_query:
                    _send_daily_limit_exceeded_prompt(chat_id, user_name)
                    return
            send_stock_analysis_response(chat_id, stock, sub=sub, remaining_queries=rem)
            return

    return _send_full_welcome(chat_id, user_name, sub)


def _send_full_welcome(chat_id: int, user_name: str = "", sub: Optional[Dict] = None):
    """الترحيب وعرض القائمة مع توضيح حالة الحساب (VIP أو تجربة نشطة)."""
    is_vip = bool(sub and (sub.get("is_paid") or sub.get("_fail_open")))
    days_left = sub.get("days_left", 7) if sub else 7

    if is_vip:
        status_banner = "👑 <b>حسابك: مشترك VIP مُميّز — وصول كامل غير محدود</b>"
    else:
        status_banner = f"""⏳ <b>حسابك: فترة تجريبية مجانية (متبقي {days_left} أيام فقط)</b>
⚡ <i>الحد اليومي: 5 استعلامات/يوم | الهدف الثاني محجوب لمشتركي VIP</i>
💎 <a href="{SUBSCRIPTION_UPGRADE_URL}">اضغط هنا للترقية وإلغاء القيود فوراً</a>"""

    welcome = f"""مرحباً بك يا <b>{user_name or 'صديقنا المتداول'}</b> في <b>دليل المستثمر العربي</b> 📈!

{status_banner}

🤖 <b>البوت الآلي الأول لرصد صناع السوق (الميكرز) بالبورصة المصرية V40.2.</b>

🔍 <b>ماذا يمكنني أن أقدم لك؟</b>
• <b>شارتات شموع يابانية فورية</b> لكل أسهم البورصة المصرية.
• <b>كشف التجميع السري</b> للميكرز قبل حدوث الانفجار السعري.
• <b>تحديد دقيق للأهداف</b>: الهدف 1، الهدف 2، ووقف الخسارة المحسوب رياضياً.
• <b>دروس تعليمية يومية مصورة</b> لاحتراف التداول وقراءة السيولة الذكية.

👇 <b>اختر من القائمة أدناه أو اكتب اسم سهمك فوراً:</b>"""

    send_message(chat_id, welcome.strip(), reply_markup=MAIN_MENU_KEYBOARD)


def handle_radar_command(chat_id: int, sub: Optional[Dict] = None):
    """عرض أسهم رادار الميكرز مع تفرقة بين الـ VIP والـ Trial (زيادة ضغط التحويل)."""
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

    is_vip = bool(sub and (sub.get("is_paid") or sub.get("_fail_open")))

    buttons = []
    text_lines = ["🎯 <b>أبرز فرص رادار الميكرز تحت المجهر اليوم:</b>\n"]

    if is_vip:
        for c in candidates:
            tk = c['ticker']
            conf = c['confidence'] or 70
            sig = c['signal']
            text_lines.append(f"▪️ <b>{tk}</b> — ثقة {conf}% ({sig})")
            buttons.append([{"text": f"📊 تحليل وشارت {tk}", "callback_data": f"stock:{tk}"}])

        buttons.append([{"text": "🌐 فتح شاشة الرادار الكاملة", "url": "https://invist.m2y.net/#recommendations"}])
        text_lines.append("\n👇 <b>اضغط على أي سهم لاستعراض شارت الشموع وأهدافه فوراً:</b>")
    else:
        # للمستخدم في التجربة: نعرض سهم واحد فقط ونقفل الباقي للتشويق وزيادة التحويل
        top_cand = candidates[0]
        tk = top_cand['ticker']
        conf = top_cand['confidence'] or 70
        sig = top_cand['signal']
        text_lines.append(f"▪️ <b>{tk}</b> — ثقة {conf}% ({sig}) [معاينة تجريبية]")
        buttons.append([{"text": f"📊 معاينة تحليل وشارت {tk}", "callback_data": f"stock:{tk}"}])

        text_lines.append(f"""
🔒 <b>+4 فرص ذهبية أخرى رصدها الرادار محجوبة الآن!</b>
رادار الميكرز رصد سيولة ذكية تجميعية عالية في أسهم أخرى لكنها متاحة حصرياً للمشتركين المدفوعين.

💎 <b>اشترك في Premium لفتح كامل قائمة رادار الميكرز فوراً:</b>""")

        buttons.append([{"text": "💎 فتح كامل أسهم رادار الميكرز", "url": SUBSCRIPTION_UPGRADE_URL}])
        buttons.append([{"text": "🔍 فحص سهم آخر من القائمة", "callback_data": "action:show_stock_menu"}])

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
        user_name = (cb.get("from") or {}).get("first_name", "")

        answer_callback_query(cb_id)
        if not chat_id:
            return

        if not data.startswith("stock:") and not data.startswith("action:"):
            return

        sub = check_subscription(chat_id)
        allowed, status = get_user_access_status(sub)

        if status == "error":
            _send_gate_unavailable(chat_id)
            return
        if status == "not_linked":
            _send_link_prompt(chat_id, user_name)
            return
        if status == "trial_expired":
            _send_trial_expired_prompt(chat_id, user_name)
            return

        if data.startswith("stock:"):
            symbol = data.split(":", 1)[1]
            stock = search_stock(symbol)
            if not stock:
                send_message(chat_id, f"عفواً، لم أتمكن من تحميل بيانات السهم: {symbol}")
                return

            rem = None
            if status == "trial_active":
                can_query, count, rem = check_and_increment_daily_limit(chat_id)
                if not can_query:
                    _send_daily_limit_exceeded_prompt(chat_id, user_name)
                    return

            send_stock_analysis_response(chat_id, stock, sub=sub, remaining_queries=rem)

        elif data == "action:show_stock_menu":
            send_stock_picker_menu(chat_id)
        elif data == "action:show_radar_picks":
            handle_radar_command(chat_id, sub=sub)
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

    # تخطي الرسائل المتراكمة القديمة جداً (أكثر من 30 دقيقة)
    msg_date = message.get("date", 0)
    if msg_date and (time.time() - msg_date) > 1800:
        log.info(f"⏩ تخطي رسالة قديمة من {chat_id} ({user_name}): {text}")
        return

    log.info(f"رسالة واردة من {chat_id} ({user_name}): {text}")

    if text.startswith("/start") or text in ("/help", "بدء"):
        start_arg = ""
        if text.startswith("/start") and len(text.split()) > 1:
            start_arg = text.split(None, 1)[1].strip()
        handle_start(chat_id, user_name, start_param=start_arg)
        return

    # أمر "المنصة" متاح للكل للتسجيل والاشتراك
    if text in ("🌐 منصة التحليل المباشر", "المنصة", "الموقع"):
        send_message(
            chat_id,
            "🌐 <b>رابط منصة التحليل المباشر ودليل المستثمر:</b>\n👉 https://invist.m2y.net/#dashboard",
            reply_markup=MAIN_MENU_KEYBOARD
        )
        return

    # كل الأوامر والبحث تخضع للبوابة الحصرية
    sub = check_subscription(chat_id)
    allowed, status = get_user_access_status(sub)

    if status == "error":
        _send_gate_unavailable(chat_id)
        return
    if status == "not_linked":
        _send_link_prompt(chat_id, user_name)
        return
    if status == "trial_expired":
        _send_trial_expired_prompt(chat_id, user_name)
        return

    # مستخدم مسموح له (VIP أو Trial نشطة)
    if text in ("🔍 فحص سهم من القائمة", "/list", "قائمة الاسهم", "الاسهم"):
        send_stock_picker_menu(chat_id)
    elif text in ("🎯 رادار الميكرز اليوم", "/radar", "الرادار", "🚀 أسهم الانفجار السعري", "انفجار"):
        handle_radar_command(chat_id, sub=sub)
    elif text in ("📚 درس اليوم التعليمي", "/lesson", "الدروس", "درس اليوم"):
        handle_daily_lesson_command(chat_id)
    else:
        # فحص سهم محدد بالاسم أو الرمز
        stock = search_stock(text)
        if stock:
            rem = None
            if status == "trial_active":
                can_query, count, rem = check_and_increment_daily_limit(chat_id)
                if not can_query:
                    _send_daily_limit_exceeded_prompt(chat_id, user_name)
                    return

            send_stock_analysis_response(chat_id, stock, sub=sub, remaining_queries=rem)
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
    if not BOT_TOKEN:
        log.critical("❌ خطأ فادح: لم يتم العثور على TELEGRAM_BOT_TOKEN في البيئة أو ملف .env!")
        return

    log.info(f"🚀 بدء تشغيل بوت التليجرام التفاعلي الذكي (Interactive Bot)... [Token: {BOT_TOKEN[:7]}...]")
    offset = 0

    while True:
        try:
            url = f"{TELEGRAM_API}/getUpdates?offset={offset}&timeout=20"
            r = requests.get(url, timeout=25)
            data = r.json()

            if data.get("ok"):
                updates = data.get("result", [])
                if updates:
                    log.info(f"📩 معالجة {len(updates)} رسالة واردة من تليجرام...")
                for upd in updates:
                    offset = upd["update_id"] + 1
                    process_update(upd)
            else:
                log.error(f"❌ خطأ من تليجرام API (getUpdates): {data}")
                time.sleep(5)
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
