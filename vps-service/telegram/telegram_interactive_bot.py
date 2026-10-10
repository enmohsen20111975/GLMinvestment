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
import difflib
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

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
ADMIN_TELEGRAM_IDS = {
    "6030948280",  # Eng Mohsen (المالك / الأدمن)
    *(tid.strip() for tid in os.environ.get("ADMIN_TELEGRAM_IDS", "").split(",") if tid.strip())
}
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
            {"text": "👤 حسابي واشتراكي"},
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


def normalize_arabic(text: str) -> str:
    """تطبيع النصوص العربية لإزالة الفروق الإملائية الشائعة."""
    if not text:
        return ""
    t = text.strip()
    t = re.sub(r"[أإآٱ]", "ا", t)
    t = re.sub(r"ة", "ه", t)
    t = re.sub(r"[ىي]", "ي", t)
    t = re.sub(r"[\u064B-\u065F\u0670]", "", t)  # إزالة التشكيل
    t = re.sub(r"\s+", " ", t)
    return t


def _row_to_stock_dict(d: Union[dict, sqlite3.Row], symbol_fallback: str) -> Dict:
    if hasattr(d, "keys"):
        d_dict = dict(d)
    else:
        d_dict = d
    return {
        'symbol': d_dict.get('ticker') or d_dict.get('symbol', symbol_fallback),
        'name_ar': d_dict.get('name_ar') or d_dict.get('name') or symbol_fallback,
        'name_en': d_dict.get('name') or symbol_fallback,
        'price': float(d_dict.get('current_price') or d_dict.get('close_price') or d_dict.get('price') or 0),
        'change': float(d_dict.get('change_percent') or d_dict.get('change') or 0),
        'open': float(d_dict.get('open_price') or 0),
        'high': float(d_dict.get('high_price') or 0),
        'low': float(d_dict.get('low_price') or 0),
        'volume': int(d_dict.get('volume') or 0),
        'market': 'EGX'
    }


def search_stock(query: str) -> Optional[Dict]:
    """البحث الذكي عن السهم بالرمز الإنجليزي، الاسم العربي، Anagrams، أو المطابقة التقريبية (Fuzzy)."""
    q = query.strip()
    if not q:
        return None
    q_upper = q.upper()

    # 1. مطابقة مباشرة لقاموس الأسماء العربية
    if q in ARABIC_ALIASES:
        q_upper = ARABIC_ALIASES[q]
    elif q.lower() in ARABIC_ALIASES:
        q_upper = ARABIC_ALIASES[q.lower()]
    else:
        q_norm = normalize_arabic(q)
        for alias, tk in sorted(ARABIC_ALIASES.items(), key=lambda x: len(x[0]), reverse=True):
            alias_norm = normalize_arabic(alias)
            if alias_norm == q_norm or (len(alias_norm) >= 3 and (alias_norm in q_norm or q_norm in alias_norm)):
                q_upper = tk
                break

    # 2. البحث الدقيق أو المباشر في stocks.db
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
                res = _row_to_stock_dict(row, q_upper)
                conn.close()
                return res

            # 3. مطابقة ذكية متقدمة (Anagram + Fuzzy Matching)
            all_rows = cur.execute("SELECT * FROM stocks WHERE ticker IS NOT NULL").fetchall()

            clean_q = re.sub(r"[^A-Za-z]", "", q_upper)
            # أ) Anagram Match: حل كتابة الحروف بترتيب مقلوب مثل ccgg -> GGCC أو capp -> CCAP
            if clean_q and len(clean_q) >= 3:
                q_sorted = sorted(clean_q)
                for r in all_rows:
                    tk = (r["ticker"] or "").upper()
                    if len(tk) == len(clean_q) and sorted(tk) == q_sorted:
                        res = _row_to_stock_dict(r, tk)
                        conn.close()
                        return res

            # ب) Fuzzy Match للرمز الإنجليزي (مثل fowry -> FWRY أو swedy -> SWDY)
            if clean_q and len(clean_q) >= 3:
                tickers_map = { (r["ticker"] or "").upper(): r for r in all_rows if r["ticker"] }
                close_tickers = difflib.get_close_matches(clean_q, tickers_map.keys(), n=1, cutoff=0.60)
                if close_tickers:
                    res = _row_to_stock_dict(tickers_map[close_tickers[0]], close_tickers[0])
                    conn.close()
                    return res

            # ج) Fuzzy Match للاسم العربي بعد التطبيع (مثل حديدعز -> حديد عز)
            q_norm = normalize_arabic(q)
            if q_norm and len(q_norm) >= 3:
                norm_map = {}
                for r in all_rows:
                    if r["name_ar"]:
                        norm_map[normalize_arabic(r["name_ar"])] = r
                close_names = difflib.get_close_matches(q_norm, norm_map.keys(), n=1, cutoff=0.55)
                if close_names:
                    matched_r = norm_map[close_names[0]]
                    res = _row_to_stock_dict(matched_r, matched_r["ticker"])
                    conn.close()
                    return res

            conn.close()
        except Exception as e:
            log.warning(f"خطأ في البحث الذكي في stocks.db: {e}")

    # 4. البحث في data_engine.db كـ fallback
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
                res = _row_to_stock_dict(row, q_upper)
                conn.close()
                return res
            conn.close()
        except Exception as e:
            log.warning(f"خطأ في البحث في data_engine.db: {e}")

    return None


def get_stock_suggestions(query: str, limit: int = 3) -> List[Tuple[str, str]]:
    """استخراج أفضل 3 اقتراحات لأسهم مقترحة عند عدم العثور على تطابق مباشر."""
    q = query.strip()
    if not q or not STOCKS_DB.exists():
        return []
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        rows = cur.execute("SELECT ticker, name_ar FROM stocks WHERE ticker IS NOT NULL").fetchall()
        conn.close()

        clean_q = re.sub(r"[^A-Za-z]", "", q).upper()
        q_norm = normalize_arabic(q)
        suggestions: List[Tuple[str, str]] = []
        seen = set()

        if clean_q and len(clean_q) >= 2:
            q_sorted = sorted(clean_q)
            for r in rows:
                tk = (r["ticker"] or "").upper()
                if tk not in seen and len(tk) == len(clean_q) and sorted(tk) == q_sorted:
                    suggestions.append((r["name_ar"] or tk, tk))
                    seen.add(tk)

            tickers_map = { (r["ticker"] or "").upper(): r["name_ar"] or r["ticker"] for r in rows if r["ticker"] }
            close_tickers = difflib.get_close_matches(clean_q, tickers_map.keys(), n=limit, cutoff=0.45)
            for tk in close_tickers:
                if tk not in seen:
                    suggestions.append((tickers_map[tk], tk))
                    seen.add(tk)

        if q_norm and len(q_norm) >= 2:
            names_map = {}
            for r in rows:
                if r["name_ar"]:
                    norm_k = normalize_arabic(r["name_ar"])
                    names_map[norm_k] = (r["name_ar"], r["ticker"])
            close_names = difflib.get_close_matches(q_norm, names_map.keys(), n=limit, cutoff=0.40)
            for nk in close_names:
                real_name, tk = names_map[nk]
                if tk not in seen:
                    suggestions.append((real_name, tk))
                    seen.add(tk)

        return suggestions[:limit]
    except Exception as e:
        log.warning(f"خطأ في get_stock_suggestions: {e}")
        return []

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

DAILY_QUERY_LIMIT_TRIAL = 50
# P1-FIX (2026-10-09, Round 2): persist daily query count في auth.db بدل in-memory
# قبل كده: _daily_query_counts Dict بتتمسح لما البوت يعمل restart
# دلوقتي: بنحفظ في auth.db.usage_daily (Prisma)
_daily_query_counts: Dict[str, int] = {}  # in-memory cache (fallback)

def _get_db_path() -> str:
    """جيب مسار auth.db."""
    return str(DB_DIR / "auth.db")

def check_and_increment_daily_limit(chat_id: int) -> Tuple[bool, int, int]:
    """
    فحص وزيادة عداد الاستعلامات اليومي لمستخدمي الفترة التجريبية.
    P1-FIX: persist في auth.db.usage_daily (مش in-memory بس).
    Returns: (is_allowed, current_count, remaining_today)
    """
    today_key = f"{chat_id}:{time.strftime('%Y-%m-%d')}"
    today_date = time.strftime('%Y-%m-%d')

    # 1) جيب العدد من DB (source of truth)
    db_count = 0
    try:
        import sqlite3
        db_path = _get_db_path()
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            # chat_id = user_id في البوت (بنستخدم telegram_chat_id)
            row = conn.execute(
                "SELECT ai_messages_used FROM usage_daily WHERE user_id = ? AND date = ?",
                (str(chat_id), today_date)
            ).fetchone()
            db_count = row[0] if row else 0
            conn.close()
    except Exception:
        # fallback لـ in-memory لو DB مش متاح
        db_count = _daily_query_counts.get(today_key, 0)

    # 2) in-memory cache (fast path)
    count = max(db_count, _daily_query_counts.get(today_key, 0))
    if count >= DAILY_QUERY_LIMIT_TRIAL:
        return False, count, 0

    new_count = count + 1
    _daily_query_counts[today_key] = new_count  # cache update

    # 3) persist في DB
    try:
        import sqlite3
        db_path = _get_db_path()
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            conn.execute("""
                INSERT INTO usage_daily (id, user_id, date, ai_messages_used, created_at, updated_at)
                VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now'), datetime('now'))
                ON CONFLICT(user_id, date) DO UPDATE SET
                    ai_messages_used = ?, updated_at = datetime('now')
            """, (str(chat_id), today_date, new_count, new_count))
            conn.commit()
            conn.close()
    except Exception:
        pass  # in-memory fallback

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
        badge_header = f"⏳ <b>فترة تجريبية نشطة (متبقي {days_left} أيام) | كامل المزايا</b>"
        tp2_line = f"🚀 <b>الهدف الثاني (TP2):</b> <code>{tp2_str} ج.م</code>{tp2_gain_str} [مقاومة م2: {r2_str}]"
        used_today = max(1, DAILY_QUERY_LIMIT_TRIAL - (remaining_queries if remaining_queries is not None else DAILY_QUERY_LIMIT_TRIAL))
        urgency_footer = f"""
━━━━━━━━━━━━━━━━━━━
⏳ <b>فترتك التجريبية نشطة:</b> متبقي لك <b>{days_left}</b> أيام بكامل المزايا والأهداف.
⚡ <b>الاستهلاك اليومي:</b> {used_today}/{DAILY_QUERY_LIMIT_TRIAL} فحص اليوم."""

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
                    {"text": "📊 فتح الشارت الحي على المنصة", "url": "https://invist.m2y.net/#trading-chart"}
                ],
                [
                    {"text": "🔍 فحص سهم آخر", "callback_data": "action:show_stock_menu"},
                    {"text": "🎯 رادار الميكرز", "callback_data": "action:show_radar_picks"}
                ],
                [
                    {"text": "💎 ترقية باقتك إلى VIP غير المحدود", "url": SUBSCRIPTION_UPGRADE_URL}
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
            if isinstance(data, dict) and data.get("linked"):
                return data
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
                paid_tiers = {"normal", "premium", "pro", "vip_pass", "b2b_starter", "b2b_pro", "b2b_enterprise", "developer", "admin"}
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
    """إشعار حصر البوت للمسجلين فقط في المنصة مع دعم الربط المباشر بالبريد."""
    link_data = generate_link_token(chat_id, user_name)
    link_url = link_data.get("link_url") or f"{PLATFORM_URL}/#auth"

    msg = f"""مرحباً بك <b>{user_name or 'عزيزي المستثمر'}</b>! 👋

🔒 <b>خدمة بوت الميكرز التفاعلي متاحة لأعضاء منصة دليل المستثمر.</b>

⚡ <b>إذا كان لديك حساب مسجل بالفعل على المنصة:</b>
أرسل بريدك الإلكتروني هنا في المحادثة مباشرة (مثال: <code>/link name@example.com</code> أو اكتب إيميلك فقط)،
وسيتم التعرف عليك وربط حسابك وتفعيل البوت فوراً! ✅

🌐 <b>إذا لم تكن مسجلاً بعد:</b>
1️⃣ اضغط على زر <b>التسجيل في المنصة</b> أدناه (أقل من دقيقة).
2️⃣ تحصل فوراً على <b>فترة تجريبية مجانية 7 أيام بكامل المزايا</b> (فحص الأسهم، الأهداف كاملة، والرادار).
3️⃣ ارجع هنا وأرسل إيميلك لتبدأ التداول الذكي فوراً! 🚀"""

    kb = {
        "inline_keyboard": [
            [{"text": "🔗 ربط سريع عبر المتصفح", "url": link_url}],
            [{"text": "🌐 فتح المنصة والتسجيل (تجربة 7 أيام مجاناً)", "url": f"{PLATFORM_URL}/#auth"}]
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
    """إشعار تجاوز الحد اليومي للاستعلامات للباقة التجريبية."""
    msg = f"""⚠️ <b>عزيزي {user_name or 'المتداول'}، لقد استنفدت حد الفحص اليومي ({DAILY_QUERY_LIMIT_TRIAL} استعلاماً)!</b>
━━━━━━━━━━━━━━━━━━━━
⚡ في الفترة التجريبية المجانية، الحد المتاح هو <b>{DAILY_QUERY_LIMIT_TRIAL} استعلاماً في اليوم</b> لضمان أفضل سرعة واستقرار للجميع.
يتجدد الرصيد تلقائياً صباح كل يوم ☀️.

💎 <b>هل ترغب في فحص أي سهم بلا حدود؟</b>
اشترك الآن في باقة <b>VIP</b> للحصول على:
• ♾️ استعلامات وفحص شارتات غير محدودة طوال اليوم
• 🎯 تنبيهات رادار الميكرز اللحظية على تليجرام
• 📊 شارتات احترافية ودراسات كمية متقدمة

👇 اضغط للترقية الفورية والوصول اللامحدود:"""

    kb = {
        "inline_keyboard": [
            [{"text": "💎 ترقية إلى باقة VIP غير المحدودة", "url": SUBSCRIPTION_UPGRADE_URL}],
            [{"text": "🎯 رادار الميكرز", "callback_data": "action:show_radar_picks"}]
        ]
    }
    send_message(chat_id, msg, reply_markup=kb)


def link_user_by_email(chat_id: int, email: str, username: str = "") -> bool:
    """ربط حساب التليجرام بالبريد الإلكتروني المسجل في auth.db مباشرة وبكل سهولة."""
    email_clean = email.strip().lower()
    auth_db_path = DB_DIR / "auth.db"
    if not auth_db_path.exists():
        send_message(chat_id, "⚠️ عذراً، قاعدة بيانات الحسابات غير متاحة حالياً.")
        return False
    try:
        conn = sqlite3.connect(str(auth_db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # التأكد من وجود جدول user_telegram_links
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_telegram_links (
                id                 TEXT PRIMARY KEY,
                user_id            TEXT NOT NULL UNIQUE,
                telegram_chat_id   TEXT NOT NULL UNIQUE,
                telegram_username  TEXT,
                linked_at          TEXT NOT NULL,
                is_active          INTEGER NOT NULL DEFAULT 1
            )
        """)

        user = cur.execute(
            "SELECT id, name, username, email, subscription_tier, trial_ends_at, created_at, is_active FROM User WHERE LOWER(TRIM(email)) = ?",
            (email_clean,)
        ).fetchone()

        if not user:
            conn.close()
            send_message(
                chat_id,
                f"❌ لم يتم العثور على حساب مسجل بالبريد: <code>{email_clean}</code>\n\n"
                f"🌐 يمكنك إنشاء حساب مجاناً في دقيقة واحدة وتفعيل تجربة الـ 7 أيام:\n"
                f"👉 <a href='https://invist.m2y.net/#auth'>اضغط هنا للتسجيل على المنصة</a>",
                reply_markup={"inline_keyboard": [[{"text": "🌐 إنشاء حساب جديد مجاناً", "url": "https://invist.m2y.net/#auth"}]]}
            )
            return False

        if user["is_active"] is not None and not user["is_active"]:
            conn.close()
            send_message(chat_id, "⚠️ هذا الحساب معطل حالياً. يرجى التواصل مع إدارة المنصة.")
            return False

        user_id = user["id"]
        # حذف أي ربط قديم لنفس المستخدم أو نفس chat_id لمنع تعارض الـ UNIQUE
        cur.execute("DELETE FROM user_telegram_links WHERE user_id = ? OR telegram_chat_id = ?", (user_id, str(chat_id)))

        import uuid
        link_id = f"link_{uuid.uuid4().hex[:12]}"
        tg_user = username or user["username"] or user["name"] or ""
        cur.execute(
            "INSERT INTO user_telegram_links (id, user_id, telegram_chat_id, telegram_username, linked_at, is_active) "
            "VALUES (?, ?, ?, ?, datetime('now'), 1)",
            (link_id, user_id, str(chat_id), tg_user)
        )
        conn.commit()
        conn.close()

        # لو الحساب admin أو خاص بالمالك، نفعله تلقائياً في ADMIN_TELEGRAM_IDS
        tier_raw = (user["subscription_tier"] or "free").lower()
        if tier_raw == "admin" or email_clean in ("mohsentaher42@gmail.com",):
            ADMIN_TELEGRAM_IDS.add(str(chat_id))

        # إعادة جلب بيانات الاشتراك لعرض تقرير الترحيب الشخصي
        sub = check_subscription(chat_id)
        display_name = user["name"] or user["username"] or email_clean.split('@')[0]
        tier = (sub.get("subscription_tier") or tier_raw).lower()
        is_paid = sub.get("is_paid", False)
        days_left = sub.get("days_left", 7)

        tier_names = {
            "admin": "👑 المالك / الإدارة (Admin VIP)",
            "developer": "💻 مطور معتمد",
            "b2b_enterprise": "🏢 باقة المؤسسات Enterprise VIP",
            "b2b_pro": "💼 باقة الشركات B2B Pro VIP",
            "b2b_starter": "🚀 باقة الشركات البداية B2B Starter VIP",
            "pro": "💎 باقة Pro VIP",
            "premium": "🌟 باقة Premium VIP",
            "normal": "✨ باقة VIP",
            "free": "⏳ باقة التجربة المجانية (Full Trial)"
        }
        tier_label = tier_names.get(tier, f"✨ {tier.upper()}")

        if is_paid:
            status_desc = "وصول غير محدود ♾️ لجميع ميزات رادار الميكرز وتحليلات الأسهم."
        else:
            status_desc = f"فترة تجريبية كاملة المزايا — متبقي لك <b>{days_left}</b> يوماً."

        success_msg = f"""🎉 <b>أهلاً بك يا {display_name}! تم ربط حسابك بنجاح ✅</b>
━━━━━━━━━━━━━━━━━━━━
📧 <b>البريد المرتبط:</b> <code>{email_clean}</code>
🏅 <b>الباقة:</b> {tier_label}
📊 <b>حالة الوصول:</b> {status_desc}

🚀 البوت الآن متصل بحسابك ويتعرف عليك في كل استعلام.
👇 يمكنك البدء فوراً باختيار سهم من القائمة أو تصفح رادار الميكرز:"""

        send_message(chat_id, success_msg, reply_markup=MAIN_MENU_KEYBOARD)
        return True
    except Exception as e:
        log.error(f"خطأ أثناء ربط الحساب بالبريد {email_clean}: {e}")
        send_message(chat_id, f"⚠️ حدث خطأ أثناء محاولة ربط الحساب: {e}")
        return False


def handle_account_status(chat_id: int, user_name: str = ""):
    """عرض معلومات الحساب الشخصي والاشتراك وحالة التجربة للمستخدم."""
    sub = check_subscription(chat_id)
    if not sub.get("linked"):
        _send_link_prompt(chat_id, user_name)
        return

    display_name = sub.get("display_name") or user_name or "المتداول"
    tier = (sub.get("subscription_tier") or "free").lower()
    is_paid = sub.get("is_paid", False)
    days_left = sub.get("days_left", 0)

    tier_names = {
        "admin": "👑 المالك / الإدارة (Admin VIP)",
        "developer": "💻 مطور معتمد",
        "b2b_enterprise": "🏢 باقة المؤسسات Enterprise VIP",
        "b2b_pro": "💼 باقة الشركات B2B Pro VIP",
        "b2b_starter": "🚀 باقة الشركات البداية B2B Starter VIP",
        "pro": "💎 باقة Pro VIP",
        "premium": "🌟 باقة Premium VIP",
        "normal": "✨ باقة VIP",
        "free": "⏳ باقة التجربة المجانية (Full Trial)"
    }
    tier_label = tier_names.get(tier, f"✨ {tier.upper()}")

    today_key = f"{chat_id}:{time.strftime('%Y-%m-%d')}"
    used_today = _daily_query_counts.get(today_key, 0)
    limit_text = "غير محدود ♾️" if is_paid else f"{used_today}/{DAILY_QUERY_LIMIT_TRIAL} فحص اليوم"
    expiry_text = "اشتراك دائم مدى الحياة ♾️" if is_paid else f"متبقي {days_left} أيام بكامل المزايا"

    msg = f"""👤 <b>بيانات حسابك في دليل المستثمر العربي:</b>
━━━━━━━━━━━━━━━━━━━━
👋 <b>الاسم:</b> {display_name}
🆔 <b>معرف تليجرام:</b> <code>{chat_id}</code>
🏅 <b>الباقة الحالية:</b> {tier_label}
⏳ <b>الصلاحية:</b> {expiry_text}
⚡ <b>الاستهلاك اليومي:</b> {limit_text}

🎯 <b>المزايا المتاحة لحسابك:</b>
• كشف منطقة الدخول والوقف الآمن ✅
• كشف أهداف السهم (الهدف 1 + الهدف 2) ✅
• رادار الميكرز V40.2 اللحظي بكامل الفرص ✅
• شارتات فنية فائقة الدقة لكل أسهم البورصة ✅"""

    kb = {
        "inline_keyboard": [
            [{"text": "🌐 فتح المنصة ولوحة التحكم", "url": "https://invist.m2y.net/#dashboard"}],
            [{"text": "💎 تفاصيل باقات VIP", "url": SUBSCRIPTION_UPGRADE_URL}]
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
    is_trial_active = bool(sub and sub.get("is_trial_active"))
    days_left = sub.get("days_left", 7) if sub else 7
    display_name = (sub and sub.get("display_name")) or user_name or "صديقنا المتداول"

    if is_vip:
        status_banner = f"👑 <b>أهلاً بك يا {display_name} | مشترك VIP مُميّز — وصول كامل غير محدود ♾️</b>"
    elif is_trial_active:
        status_banner = f"""⏳ <b>أهلاً بك يا {display_name} | فترتك التجريبية نشطة (متبقي {days_left} أيام)</b>
✨ <i>كامل المزايا مفتوحة لك: فحص الأسهم، الأهداف (TP1 و TP2)، ورادار الميكرز اللحظي.</i>"""
    else:
        status_banner = f"""⏳ <b>أهلاً بك يا {display_name} | فترة تجريبية مجانية</b>
💎 <a href="{SUBSCRIPTION_UPGRADE_URL}">اضغط هنا للترقية والوصول غير المحدود</a>"""

    welcome = f"""مرحباً بك يا <b>{display_name}</b> في <b>دليل المستثمر العربي</b> 📈!

{status_banner}

🤖 <b>البوت الآلي لرصد صناع السوق (الميكرز) بالبورصة المصرية V40.2.</b>

🔍 <b>ماذا يمكنني أن أقدم لك؟</b>
• <b>شارتات شموع يابانية فورية</b> لكل أسهم البورصة المصرية.
• <b>كشف التجميع السري</b> للميكرز قبل حدوث الانفجار السعري.
• <b>تحديد دقيق للأهداف</b>: الهدف 1، الهدف 2، ووقف الخسارة المحسوب رياضياً.
• <b>دروس تعليمية يومية مصورة</b> لاحتراف التداول وقراءة السيولة الذكية.

👇 <b>اختر من القائمة أدناه أو اكتب اسم سهمك فوراً:</b>"""

    send_message(chat_id, welcome.strip(), reply_markup=MAIN_MENU_KEYBOARD)


def handle_radar_command(chat_id: int, sub: Optional[Dict] = None):
    """عرض أسهم رادار الميكرز مع إتاحة كاملة للمشتركين والعملاء في التجربة."""
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
    is_trial_active = bool(sub and sub.get("is_trial_active"))
    days_left = sub.get("days_left", 7) if sub else 7

    buttons = []
    text_lines = ["🎯 <b>أبرز فرص رادار الميكرز V40.2 تحت المجهر اليوم:</b>\n"]

    for c in candidates:
        tk = c['ticker']
        conf = c['confidence'] or 70
        sig = c['signal']
        text_lines.append(f"▪️ <b>{tk}</b> — ثقة {conf}% ({sig})")
        buttons.append([{"text": f"📊 فحص وشارت {tk}", "callback_data": f"stock:{tk}"}])

    buttons.append([{"text": "🌐 فتح شاشة الرادار الحية على المنصة", "url": "https://invist.m2y.net/#recommendations"}])
    buttons.append([{"text": "🔍 فحص سهم آخر من القائمة", "callback_data": "action:show_stock_menu"}])

    if is_trial_active and not is_vip:
        text_lines.append(f"\n💡 <i>ملاحظة: فترتك التجريبية تتيح لك معاينة كامل فرص الرادار (متبقي {days_left} أيام).</i>")

    text_lines.append("\n👇 <b>اضغط على أي سهم لاستعراض شارت الشموع وأهدافه فوراً:</b>")

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
        elif data == "action:account_status":
            handle_account_status(chat_id, user_name)
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

    # فحص أوامر الربط المباشر بالبريد الإلكتروني
    email_to_link = None
    if text.startswith("/link"):
        parts = text.split(None, 1)
        if len(parts) > 1:
            email_to_link = parts[1].strip()
        else:
            send_message(
                chat_id,
                "ℹ️ <b>طريقة ربط حسابك بالبريد الإلكتروني:</b>\n\n"
                "أرسل الأمر متبوعاً ببريدك المسجل بالمنصة، مثال:\n"
                "<code>/link name@example.com</code>\n\n"
                "أو اكتب بريدك مباشرة في رسالة.",
                reply_markup=MAIN_MENU_KEYBOARD
            )
            return
    elif "@" in text and "." in text:
        import re
        match = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", text.strip())
        if match and len(text.strip().split()) == 1:
            email_to_link = match.group(0)

    if email_to_link:
        link_user_by_email(chat_id, email_to_link, user_name)
        return

    # أمر "المنصة" متاح للكل للتسجيل والاشتراك
    if text in ("🌐 منصة التحليل المباشر", "المنصة", "الموقع"):
        send_message(
            chat_id,
            "🌐 <b>رابط منصة التحليل المباشر ودليل المستثمر:</b>\n👉 https://invist.m2y.net/#dashboard",
            reply_markup=MAIN_MENU_KEYBOARD
        )
        return

    # استعلام عن بيانات الحساب والاشتراك
    if text in ("👤 حسابي واشتراكي", "حسابي", "اشتراكي", "معلومات حسابي", "/status", "/account", "/my_plan"):
        handle_account_status(chat_id, user_name)
        return

    # أوامر عامة لا تتطلب اشتراك مسبق
    if text in ("/id", "/myid", "ايدي", "معرفي", "id"):
        send_message(
            chat_id,
            f"🆔 <b>معرّف تليجرام الخاص بك (Chat ID):</b>\n<code>{chat_id}</code>\n"
            f"👤 الاسم: <b>{user_name}</b>\n\n"
            f"💡 <i>استخدم هذا المعرّف للربط أو إضافته لصلاحيات الأدمن والمالك.</i>"
        )
        return

    if text.startswith("/claim_admin") or text.startswith("/admin_login"):
        parts = text.split(None, 1)
        secret_input = parts[1].strip() if len(parts) > 1 else ""
        admin_tok = os.environ.get("ADMIN_TOKEN", "").strip()
        admin_pw = os.environ.get("ADMIN_PASSWORD", "").strip()
        shared_sec = os.environ.get("SHARED_SECRET", "").strip()
        bot_sec = os.environ.get("BOT_API_SECRET", "").strip()
        valid_secrets = {s for s in [admin_tok, admin_pw, shared_sec, bot_sec] if s}

        if secret_input and secret_input in valid_secrets:
            ADMIN_TELEGRAM_IDS.add(str(chat_id))
            # تثبيت في auth.db
            try:
                auth_db_path = DB_DIR / "auth.db"
                if auth_db_path.exists():
                    c = sqlite3.connect(str(auth_db_path))
                    c.execute(
                        "INSERT OR REPLACE INTO user_telegram_links (id, user_id, telegram_chat_id, telegram_username, linked_at, is_active) "
                        "VALUES (?, ?, ?, ?, datetime('now'), 1)",
                        (
                            f"admin_link_{chat_id}",
                            "48457b7f-40f2-4a7e-8955-d4d2cd1d79bd",
                            str(chat_id),
                            message.get("from", {}).get("username", user_name)
                        )
                    )
                    c.commit()
                    c.close()
            except Exception as ex:
                log.error(f"Error persisting admin link to auth.db: {ex}")

            # تثبيت في .env
            try:
                env_file = PROJECT_ROOT / ".env"
                if env_file.exists():
                    content = env_file.read_text(encoding="utf-8")
                    if "ADMIN_TELEGRAM_IDS=" in content:
                        import re
                        content = re.sub(
                            r"ADMIN_TELEGRAM_IDS=(.*)",
                            lambda m: f"ADMIN_TELEGRAM_IDS={m.group(1).strip()},{chat_id}" if str(chat_id) not in m.group(1) else m.group(0),
                            content
                        )
                    else:
                        content += f"\nADMIN_TELEGRAM_IDS={chat_id}\n"
                    env_file.write_text(content, encoding="utf-8")
            except Exception as ex:
                log.error(f"Error persisting to .env: {ex}")

            send_message(
                chat_id,
                f"👑 <b>أهلاً بك يا باشمهندس محسن (المالك / الأدمن)!</b> 👋\n\n"
                f"✅ تم تفعيل وتثبيت حساب التليجرام الخاص بك (Chat ID: <code>{chat_id}</code>) بصلاحيات <b>المالك الكاملة غير المحدودة مدى الحياة</b>.\n"
                f"• باقة الاشتراك: <b>Owner / Admin VIP</b>\n"
                f"• الاستعلامات: <b>غير محدودة ♾️</b>\n"
                f"• رادار الميكرز وشارتات الأسهم مفتوحة بالكامل بدون أي قيود.",
                reply_markup=MAIN_MENU_KEYBOARD
            )
            return
        else:
            send_message(
                chat_id,
                "❌ <b>رمز التحقق غير صحيح.</b>\n"
                "لتفعيل صلاحيات المالك أرسل الأمر متبوعاً بالرمز:\n"
                "<code>/claim_admin &lt;ADMIN_TOKEN_OR_PASSWORD&gt;</code>"
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
            suggestions = get_stock_suggestions(text, limit=3)
            if suggestions:
                buttons = []
                for name_ar, sym in suggestions:
                    buttons.append([{"text": f"📊 {name_ar} ({sym})", "callback_data": f"stock:{sym}"}])
                buttons.append([{"text": "🔍 فتح القائمة الكاملة للأسهم", "callback_data": "action:show_stock_menu"}])

                sugg_msg = f"""🔍 لم نجد سهماً بالاسم '<b>{text}</b>' بدقة.

💡 <b>هل كنت تقصد أحد هذه الأسهم القريبة؟</b>
اضغط على السهم المطلوب لفحصه ورسم شارت الميكرز فوراً:"""
                send_message(chat_id, sugg_msg, reply_markup={"inline_keyboard": buttons})
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
