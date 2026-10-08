#!/usr/bin/env python3
"""
Telegram Auto Post Scheduler
============================
جدولة النشر التلقائي على قناة التليجرام.

المهام المجدولة:
1. التقرير اليومي + التوقعات - يومياً بعد إغلاق السوق (3:00 م بتوقيت مصر)
2. التقرير الأسبوعي - كل يوم أحد (10:00 ص)
3. التقرير الشهري - أول يوم من كل شهر (10:00 ص)

نظام التقارير الذكية (ReportsEngine):
- توقعات الغد: 8:30 ص (قبل افتتاح السوق) - أيام عمل فقط
- ملخص اليوم: 4:00 م (بعد إغلاق السوق) - أيام عمل فقط
- ملخص الأسبوع: يوم الجمعة 9:00 ص
- ملخص الشهر: أول يوم في الشهر 10:00 ص

التشغيل:
  python3 auto_post_scheduler.py           # تشغيل الجدولة
  python3 auto_post_scheduler.py --now daily    # نشر فوري للتقرير اليومي
  python3 auto_post_scheduler.py --now weekly   # نشر فوري للأسبوعي
  python3 auto_post_scheduler.py --now monthly  # نشر فوري للشهري
  python3 auto_post_scheduler.py --status       # حالة الجدولة

الـ environment variables:
  AUTO_POST_ENABLED=true           # تفعيل/تعطيل النشر التلقائي (default: true)
  AUTO_POST_DAILY_HOUR=15          # ساعة النشر اليومي (default: 15 = 3 مساءً)
  AUTO_POST_WEEKLY_DAY=6           # يوم النشر الأسبوعي (default: 6 = الأحد)
  AUTO_POST_WEEKLY_HOUR=10         # ساعة النشر الأسبوعي (default: 10 صباحاً)
  TELEGRAM_CHANNEL_ID=@channel     # معرّف القناة
"""

import os
import sys
import json
import asyncio
import time
import signal
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for signal/accumulation/money_flow classification.
try:
    from utils.canonical_signal import signal_ar as canonical_signal_ar
except ImportError:  # pragma: no cover - fallback if utils not on path
    def canonical_signal_ar(_sig):  # type: ignore[no-redef]
        return 'انتظار'

try:
    from analyzers.trader_levels_engine import get_unified_trader_levels
except ImportError:
    try:
        from trader_levels_engine import get_unified_trader_levels
    except ImportError:
        get_unified_trader_levels = None

# Import the auto poster and report generator
try:
    from telegram.auto_poster import TelegramAutoPoster, get_top_recommendations, get_market_summary
    from analyzers.market_daily_report import MarketDailyReport
    REPORTS_AVAILABLE = True
except Exception as e:
    print(f"⚠️ Reports not available: {e}")
    REPORTS_AVAILABLE = False

try:
    from egx_arabic_lookup import get_arabic_stock_name
except ImportError:
    def get_arabic_stock_name(tk, fb=None): return fb or tk

# Import ReportsEngine (نظام التقارير الذكية الجديد - daily_tomorrow / daily_summary / weekly / monthly)
try:
    from analyzers.reports_engine import ReportsEngine
    REPORTS_ENGINE_AVAILABLE = True
except Exception:
    REPORTS_ENGINE_AVAILABLE = False

# Import market hours (للتحقق من أيام العمل والعطلات)
try:
    # نضيف data-engine للمسار
    _data_engine_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data-engine')
    if _data_engine_path not in sys.path:
        sys.path.insert(0, _data_engine_path)
    from market_config.market_hours import is_market_open, get_egypt_time, MARKET_HOURS
    MARKET_HOURS_AVAILABLE = True
except Exception as e:
    print(f"⚠️ Market hours not available: {e}")
    MARKET_HOURS_AVAILABLE = False

# P18 Morning Bell: استيراد core logic من stored_analysis_routes (نفس المصدر
# اللي بيرجّع الـ /api/market/morning-bell للواجهة — Python = THE BRAIN، مفيش
# تكرار للمنطق). الـ scheduler بيستخدم الـ helper مباشرة بدون HTTP roundtrip.
try:
    from api.stored_analysis_routes import _get_morning_bell_data
    MORNING_BELL_DATA_AVAILABLE = True
except Exception as _mb_err:
    print(f"⚠️ Morning Bell data not available: {_mb_err}")
    MORNING_BELL_DATA_AVAILABLE = False


# ============================================================================
# CONFIGURATION
# ============================================================================
STATE_FILE = os.path.join(os.path.dirname(__file__), 'auto_post_state.json')

DAILY_HOUR = int(os.environ.get('AUTO_POST_DAILY_HOUR', '15'))       # 3 PM Egypt
WEEKLY_DAY = int(os.environ.get('AUTO_POST_WEEKLY_DAY', '6'))        # Sunday (6)
WEEKLY_HOUR = int(os.environ.get('AUTO_POST_WEEKLY_HOUR', '10'))     # 10 AM
MONTHLY_DAY = 1                                                       # 1st of month
MONTHLY_HOUR = 10                                                     # 10 AM

# ─────────────────────────────────────────────────────────────────────────────
# ReportsEngine Schedule (نظام التقارير الذكية الجديد - Africa/Cairo)
# ─────────────────────────────────────────────────────────────────────────────
# توقعات الغد: 8:30 ص (قبل افتتاح السوق) - أيام عمل فقط
TOMORROW_PICKS_HOUR = int(os.environ.get('REPORT_TOMORROW_HOUR', '8'))
TOMORROW_PICKS_MIN  = int(os.environ.get('REPORT_TOMORROW_MIN', '30'))
# ملخص اليوم: 4:00 م (بعد إغلاق السوق) - أيام عمل فقط
DAILY_SUMMARY_HOUR  = int(os.environ.get('REPORT_DAILY_SUMMARY_HOUR', '16'))
DAILY_SUMMARY_MIN   = int(os.environ.get('REPORT_DAILY_SUMMARY_MIN', '0'))
# ملخص الأسبوع: يوم الجمعة 9:00 ص
WEEKLY_SUMMARY_DAY  = int(os.environ.get('REPORT_WEEKLY_DAY', '4'))  # 4 = Friday
WEEKLY_SUMMARY_HOUR = int(os.environ.get('REPORT_WEEKLY_HOUR', '9'))
WEEKLY_SUMMARY_MIN  = int(os.environ.get('REPORT_WEEKLY_MIN', '0'))
# ملخص الشهر: أول يوم في الشهر 10:00 ص
MONTHLY_SUMMARY_DAY  = 1
MONTHLY_SUMMARY_HOUR = int(os.environ.get('REPORT_MONTHLY_HOUR', '10'))
MONTHLY_SUMMARY_MIN  = int(os.environ.get('REPORT_MONTHLY_MIN', '0'))

# ─────────────────────────────────────────────────────────────────────────────
# P18 Morning Bell Schedule (جرس الصباح — 9:45 ص قبل افتتاح السوق بـ 15 دقيقة)
# أيام عمل: الأحد(6) للخميس(3). بيُنشر على قناة تيليجرام العملاء البريميوم.
# ─────────────────────────────────────────────────────────────────────────────
MORNING_BELL_HOUR = int(os.environ.get('MORNING_BELL_HOUR', '9'))
MORNING_BELL_MIN  = int(os.environ.get('MORNING_BELL_MIN', '45'))

# working days: الأحد(6) إلى الخميس(3) — Python weekday()
WORKING_DAYS = (6, 0, 1, 2, 3)


# ============================================================================
# AUDIT-PUBLISH-QUALITY (Task 2026-10-08, Rule 27 — NO-FAKE-DATA)
# ============================================================================
# Mandatory legal disclaimer for every published message (constitution req).
LEGAL_DISCLAIMER = '⚠️ *تحليل كمي بالذكاء الاصطناعي — إدارة رأس المال مسؤوليتك أولاً*'


def _fmt_price(value, digits: int = 2) -> str:
    """Format a price for display. Returns '—' when value is None / NaN /
    non-finite instead of fabricating '0.00'."""
    if value is None:
        return '—'
    try:
        f = float(value)
    except (TypeError, ValueError):
        return '—'
    if f != f:  # NaN check
        return '—'
    if not (-1e12 < f < 1e12):  # guard against absurd overflow values
        return '—'
    return f"{f:.{digits}f}"


def _fmt_pct(value, digits: int = 1) -> str:
    """Format a percentage for display. Returns '—' when value is None / NaN."""
    if value is None:
        return '—'
    try:
        f = float(value)
    except (TypeError, ValueError):
        return '—'
    if f != f:
        return '—'
    return f"{f:+.{digits}f}%"


# ============================================================================
# STATE MANAGEMENT
# ============================================================================
def load_state() -> Dict:
    """تحميل حالة آخر نشر"""
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
    except Exception:
        pass
    return {
        'last_daily': None,
        'last_weekly': None,
        'last_monthly': None,
        'last_tomorrow_picks': None,    # جديد - توقعات الغد
        'last_daily_summary': None,     # جديد - ملخص اليوم
        'last_weekly_summary': None,    # جديد - ملخص الأسبوع
        'last_monthly_summary': None,   # جديد - ملخص الشهر
        'last_morning_bell': None,      # P18 - جرس الصباح (Telegram 9:45)
        'posts_count': 0,
        'errors': [],
    }


def save_state(state: Dict):
    """حفظ حالة آخر نشر"""
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving state: {e}")


# ============================================================================
# POSTING FUNCTIONS
# ============================================================================
async def post_daily_predictions(market: str = 'EGX') -> Dict:
    """
    نشر التقرير اليومي + التوقعات على التليجرام
    """
    print(f"[{datetime.now()}] 📅 Generating daily predictions post...")

    if not REPORTS_AVAILABLE:
        return {"success": False, "error": "Reports module not available"}

    try:
        # توليد التقرير اليومي
        reporter = MarketDailyReport()
        report = reporter.generate_daily_report(market, for_next_session=True)

        if not report or 'report_text' not in report:
            return {"success": False, "error": "Failed to generate daily report"}

        # استخدام نص التقرير أو تنسيق بوست خاص
        post_text = _format_daily_post(report, market)

        # توليد بطاقة التقرير المصورة عالية الدقة
        card_image = None
        try:
            from telegram_report_card import generate_report_card_image
            card_image = await generate_report_card_image(report, 'daily')
        except Exception as img_err:
            print(f"⚠️ Could not generate daily report image: {img_err}")

        # النشر على التليجرام
        poster = TelegramAutoPoster()
        connect_result = await poster.connect()
        if not connect_result.get('success'):
            return {"success": False, "error": f"Telegram connect failed: {connect_result.get('error')}"}

        if card_image and card_image.exists():
            if len(post_text) <= 1000:
                result = await poster.send_photo(str(card_image), caption=post_text, parse_mode='md')
            else:
                summary_caption = f"""🌅 **التقرير اليومي وحصاد الجلسة - منصة دليل الاستثمار**
📅 الجلسة: {report.get('target_session', {}).get('date', datetime.now().strftime('%Y-%m-%d'))}

🟢 الصاعدات: {report.get('summary', {}).get('gainers', 0)} | 🔴 الهابطات: {report.get('summary', {}).get('losers', 0)}
📊 اتساع السوق: {report.get('summary', {}).get('market_breadth', 0)}%

👇 **التفاصيل الكاملة وتوقعات الغد بنقاط الدخول والأهداف في الرسالة التالية:**"""
                await poster.send_photo(str(card_image), caption=summary_caption, parse_mode='md')
                result = await poster.send_message(post_text, parse_mode='md')
        else:
            result = await poster.send_message(post_text, parse_mode='md')

        await poster.disconnect()

        if result.get('success'):
            print(f"[{datetime.now()}] ✅ Daily post sent successfully (msg_id: {result.get('message_id')})")
        else:
            print(f"[{datetime.now()}] ❌ Daily post failed: {result.get('error')}")

        return result

    except Exception as e:
        print(f"[{datetime.now()}] ❌ Daily post error: {e}")
        return {"success": False, "error": str(e)}


async def post_weekly_report(market: str = 'EGX') -> Dict:
    """نشر التقرير الأسبوعي"""
    print(f"[{datetime.now()}] 📊 Generating weekly report post...")

    if not REPORTS_AVAILABLE:
        return {"success": False, "error": "Reports module not available"}

    try:
        reporter = MarketDailyReport()
        report = reporter.generate_weekly_report(market)

        if not report or 'report_text' not in report:
            return {"success": False, "error": "Failed to generate weekly report"}

        post_text = _format_weekly_post(report, market)

        # توليد بطاقة التقرير المصورة عالية الدقة
        card_image = None
        try:
            from telegram_report_card import generate_report_card_image
            card_image = await generate_report_card_image(report, 'weekly')
        except Exception as img_err:
            print(f"⚠️ Could not generate weekly report image: {img_err}")

        poster = TelegramAutoPoster()
        connect_result = await poster.connect()
        if not connect_result.get('success'):
            return {"success": False, "error": f"Telegram connect failed: {connect_result.get('error')}"}

        if card_image and card_image.exists():
            if len(post_text) <= 1000:
                result = await poster.send_photo(str(card_image), caption=post_text, parse_mode='md')
            else:
                week = report.get('week_range', {})
                summary_caption = f"""📊 **التقرير الأسبوعي الشامل - منصة دليل الاستثمار**
📅 الأسبوع: {week.get('start', '')} إلى {week.get('end', '')}

🟢 الأسهم الصاعدة: {report.get('summary', {}).get('gainers', 0)} | 🔴 الهابطة: {report.get('summary', {}).get('losers', 0)}
📊 اتساع السوق: {report.get('summary', {}).get('market_breadth', 0)}%

👇 **التفاصيل الكاملة وتوقعات الأسبوع القادم بنقاط الدخول والأهداف في الرسالة التالية:**"""
                await poster.send_photo(str(card_image), caption=summary_caption, parse_mode='md')
                result = await poster.send_message(post_text, parse_mode='md')
        else:
            result = await poster.send_message(post_text, parse_mode='md')

        await poster.disconnect()

        if result.get('success'):
            print(f"[{datetime.now()}] ✅ Weekly post sent successfully")
        else:
            print(f"[{datetime.now()}] ❌ Weekly post failed: {result.get('error')}")

        return result

    except Exception as e:
        print(f"[{datetime.now()}] ❌ Weekly post error: {e}")
        return {"success": False, "error": str(e)}


async def post_weekly_radar_report(market: str = 'EGX') -> Dict:
    """
    L2-WEEKLY-RADAR-REPORT: نشر تقرير الرادار الأسبوعي
    ===================================================
    مشابه لـ post_weekly_report لكنه بـ يستخدم scripts/weekly_radar_report.py
    بدلاً من analyzers/market_daily_report.py. الفرق:
      - التقرير ده بيركّز على أفضل 5 أسهم + سهم الأسبوع من رادار الميكرز
      - بيشمل أداء أسهم الأسبوع اللي فات (من maker_radar_tracking.json)
      - بيشمل حالة السوق (regime) + خريطة القطاعات
      - بيولّد PDF + PNG + JSON في scripts/output/

    بيشتغل كل يوم أحد 08:00 Cairo time (06:00 UTC) — نفس توقيت post_weekly_report
    الأصلي لكنه لو فشل بيرجّع للقديم.

    Returns: { success, image_sent, text_sent, files, errors }
    """
    print(f"[{datetime.now()}] 📊 Generating weekly RADAR report...")

    # Step 1: Run the report generator (PDF + PNG + JSON)
    import subprocess
    project_root = Path(__file__).resolve().parent.parent
    script_path = project_root / 'scripts' / 'weekly_radar_report.py'

    if not script_path.exists():
        return {"success": False, "error": f"Script not found: {script_path}"}

    # Resolve python binary (same portable chain as radar-cache.ts)
    python_bin = os.environ.get('PYTHON', '')
    if not python_bin or not Path(python_bin).exists():
        venv = os.environ.get('VIRTUAL_ENV', '')
        if venv:
            for candidate in ['python3', 'python']:
                p = Path(venv) / 'bin' / candidate
                if p.exists():
                    python_bin = str(p)
                    break
        if not python_bin:
            for candidate in [
                project_root / '.venv' / 'bin' / 'python3',
                project_root / '.venv' / 'bin' / 'python',
            ]:
                if candidate.exists():
                    python_bin = str(candidate)
                    break
        if not python_bin:
            python_bin = 'python3'

    try:
        result_proc = subprocess.run(
            [python_bin, str(script_path), '--market', market, '--send-telegram'],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=180,
            env={**os.environ, 'PYTHONUNBUFFERED': '1'},
        )
        if result_proc.returncode != 0:
            print(f"[{datetime.now()}] ⚠️ weekly_radar_report.py exit={result_proc.returncode}")
            print(f"  stderr: {result_proc.stderr[:500]}")
            return {
                "success": False,
                "error": f"weekly_radar_report.py exited with code {result_proc.returncode}",
                "stderr": result_proc.stderr[:1000],
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "weekly_radar_report.py timed out (180s)"}
    except Exception as e:
        return {"success": False, "error": f"subprocess failed: {e}"}

    # Step 2: Verify outputs
    today_str = datetime.now().strftime("%Y%m%d")
    output_dir = project_root / 'scripts' / 'output'
    pdf_path = output_dir / f'weekly_radar_report_{today_str}.pdf'
    png_path = output_dir / f'weekly_radar_report_{today_str}.png'
    json_path = output_dir / f'weekly_radar_report_{today_str}.json'

    files = {
        'pdf': str(pdf_path) if pdf_path.exists() else None,
        'png': str(png_path) if png_path.exists() else None,
        'json': str(json_path) if json_path.exists() else None,
    }

    # Step 3: If --send-telegram was used inside the script, the Telegram
    # message has already been sent. Return success.
    if files.get('json'):
        print(f"[{datetime.now()}] ✅ Weekly RADAR report generated")
        print(f"  PDF: {files['pdf']}")
        print(f"  PNG: {files['png']}")
        print(f"  JSON: {files['json']}")
        return {
            "success": True,
            "image_sent": True,  # the script handles Telegram send
            "text_sent": True,
            "files": files,
        }

    return {
        "success": False,
        "error": "No JSON output produced — weekly_radar_report.py may have failed silently",
        "files": files,
    }


async def post_monthly_report(market: str = 'EGX') -> Dict:
    """نشر التقرير الشهري"""
    print(f"[{datetime.now()}] 📈 Generating monthly report post...")

    if not REPORTS_AVAILABLE:
        return {"success": False, "error": "Reports module not available"}

    try:
        reporter = MarketDailyReport()
        report = reporter.generate_monthly_report(market)

        if not report or 'report_text' not in report:
            return {"success": False, "error": "Failed to generate monthly report"}

        post_text = _format_monthly_post(report, market)

        poster = TelegramAutoPoster()
        connect_result = await poster.connect()
        if not connect_result.get('success'):
            return {"success": False, "error": f"Telegram connect failed: {connect_result.get('error')}"}

        result = await poster.send_message(post_text, parse_mode='md')
        await poster.disconnect()

        if result.get('success'):
            print(f"[{datetime.now()}] ✅ Monthly post sent successfully")
        else:
            print(f"[{datetime.now()}] ❌ Monthly post failed: {result.get('error')}")

        return result

    except Exception as e:
        print(f"[{datetime.now()}] ❌ Monthly post error: {e}")
        return {"success": False, "error": str(e)}


# ============================================================================
# FORMATTERS - تنسيق البوستات
# ============================================================================
def _format_daily_post(report: Dict, market: str) -> str:
    """تنسيق بوست التقرير اليومي"""
    summary = report.get('summary', {})
    target = report.get('target_session', {})
    recs = report.get('recommendations', [])

    date_ar = datetime.now().strftime('%d/%m/%Y')
    day_name = target.get('day', '')

    text = f"""🌅 **التقرير اليومي وحصاد الجلسة - دليل الاستثمار**

📅 **{date_ar}** | الجلسة القادمة: {day_name}

📊 **ملخص أداء السوق:**
"""
    gainers = summary.get('gainers', 0)
    losers = summary.get('losers', 0)
    total = summary.get('total_stocks', 0)
    unchanged = total - gainers - losers if total else 0

    text += f"""• 📈 الصاعدات: {gainers} 🟢
• 📉 الهابطات: {losers} 🔴
• ➡️ ثابتة: {unchanged}
• 📊 اتساع السوق: {summary.get('market_breadth', 0)}%

"""

    # أعلى الصاعدات
    top_gainers = report.get('top_gainers', [])[:5]
    if top_gainers:
        text += "🔥 **أعلى الأسهم صعوداً بالجلسة:**\n"
        for i, stock in enumerate(top_gainers, 1):
            sym = stock.get('symbol', stock.get('ticker', ''))
            name_ar = get_arabic_stock_name(sym, sym)
            change = stock.get('change_percent', 0)
            text += f"{i}. {name_ar} (`{sym}`): +{change:.2f}%\n"

    # أعلى الهابطات
    top_losers = report.get('top_losers', [])[:3]
    if top_losers:
        text += "\n📉 **أبرز التراجعات:**\n"
        for i, stock in enumerate(top_losers, 1):
            sym = stock.get('symbol', stock.get('ticker', ''))
            name_ar = get_arabic_stock_name(sym, sym)
            change = stock.get('change_percent', 0)
            text += f"{i}. {name_ar} (`{sym}`): {change:.2f}%\n"

    # التوقعات للجلسة القادمة مع تفاصيل الدخول والأهداف والتحليل
    seen_recs = set()
    valid_recs = []
    for r in recs:
        s = r.get('symbol') or r.get('ticker')
        if s and s not in seen_recs:
            seen_recs.add(s)
            valid_recs.append(r)

    if valid_recs:
        text += "\n🎯 **أبرز التوقعات والفرص الاستثمارية المرشحة للجلسة القادمة:**\n"
        text += "━━━━━━━━━━━━━━━━━━━\n"
        for i, rec in enumerate(valid_recs[:5], 1):
            sym = rec.get('symbol') or rec.get('ticker', '')
            name_ar = rec.get('name_ar') or rec.get('name') or get_arabic_stock_name(sym, sym)
            # AUDIT-PUBLISH-QUALITY (Rule 27 — NO-FAKE-DATA): keep None when
            # entry/confidence missing so we render "—" instead of "0.00".
            entry_raw = rec.get('entry_price')
            try:
                entry = float(entry_raw) if entry_raw is not None else None
            except (TypeError, ValueError):
                entry = None
            score_raw = rec.get('confidence')
            if score_raw is None:
                score_raw = rec.get('score')
            try:
                score = float(score_raw) if score_raw is not None else None
            except (TypeError, ValueError):
                score = None

            # AUDIT-PUBLISH-QUALITY: derive support/resistance only when
            # entry is a real positive number. Otherwise skip the level
            # block entirely (Rule 27 — no fabricated levels from a 0 base).
            if entry is None or entry <= 0:
                # Skip this rec entirely — we cannot fabricate buy zones
                # from a missing entry. Show name + confidence + analysis only.
                conf_label = f"{score:.0f}%" if score is not None else "—"
                text += f"🔹 **{i}. {name_ar} (#{sym})** | نسبة الثقة: **{conf_label}**\n"
                analysis = rec.get('analysis') or rec.get('notes') or ''
                if analysis:
                    text += f"  • 💡 التحليل الفني: {analysis}\n\n"
                else:
                    text += "\n"
                continue

            entry_min = entry * 0.99
            entry_max = entry * 1.01
            s1 = entry * 0.96
            s2 = entry * 0.92
            r1 = entry * 1.06
            r2 = entry * 1.12
            tp1 = float(rec.get('target_price') or (r1 * 0.995))
            tp2 = float(rec.get('target_price_2') or (r2 * 0.995))
            sl = float(rec.get('stop_loss') or (s1 * 0.985))

            if get_unified_trader_levels:
                try:
                    ul = get_unified_trader_levels(sym, current_price=entry)
                    if ul:
                        entry_min = ul['entry_min']
                        entry_max = ul['entry_max']
                        tp1 = ul['target_1']
                        tp2 = ul['target_2']
                        sl = ul['stop_loss']
                        s1 = ul['support_1']
                        s2 = ul['support_2']
                        r1 = ul['resistance_1']
                        r2 = ul['resistance_2']
                except Exception:
                    pass

            tp1_gain = ((tp1 - entry) / entry * 100) if entry > 0 and tp1 > 0 else 0
            tp2_gain = ((tp2 - entry) / entry * 100) if entry > 0 and tp2 > 0 else 0
            sl_loss = ((sl - entry) / entry * 100) if entry > 0 and sl > 0 else 0

            conf_label = f"{score:.0f}%" if score is not None else "—"
            text += f"🔹 **{i}. {name_ar} (#{sym})** | نسبة الثقة: **{conf_label}**\n"
            text += f"  • 📍 نطاق الدخول: `{entry_min:.2f} - {entry_max:.2f} ج.م` (لا تطارد أعلى من `{entry_max:.2f}`)\n"
            text += f"  • 🎯 الهدف الأول: `{tp1:.2f} ج.م` (+{tp1_gain:.1f}%) [مقاومة م1: `{r1:.2f}`]\n"
            text += f"  • 🚀 الهدف الثاني: `{tp2:.2f} ج.م` (+{tp2_gain:.1f}%) [مقاومة م2: `{r2:.2f}`]\n"
            text += f"  • 🛡️ وقف الخسارة الصارم: `{sl:.2f} ج.م` ({sl_loss:.1f}%) [كسر دعم د1: `{s1:.2f}`]\n"
            text += f"  • 🧱 خارطة المستويات: د1=`{s1:.2f}` | د2=`{s2:.2f}` ▫️ م1=`{r1:.2f}` | م2=`{r2:.2f}`\n"

            # التحليل
            analysis = rec.get('analysis') or rec.get('notes') or ''
            if not analysis:
                # AUDIT-PUBLISH-QUALITY (Rule 27): do NOT fabricate a default
                # "تجميعي + اختراق سيولة" string with fake "3 أدلة تأكيدية"
                # when there is no real upstream analysis. Render a safe
                # placeholder instead.
                analysis = '— لا يتوفر نص تحليلي لهذه الفرصة حالياً.'
            text += f"  • 💡 التحليل الفني: {analysis}\n\n"

    # Footer
    text += """━━━━━━━━━━━━━━━━━━━
🔗 روابطنا الرسمية:
🌐 https://invist.m2y.net
📱 https://play.google.com/store/apps/details?id=com.egx.investment
📘 https://www.facebook.com/profile.php?id=61590600300048
✈️ https://t.me/Arabian_investment_guide
━━━━━━━━━━━━━━━━━━━
⚠️ *تحليل كمي بالذكاء الاصطناعي — إدارة رأس المال مسؤوليتك أولاً*
📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

#البورصة_المصرية #توقعات_يومية #EGX #الاستثمار"""

    return text


def _format_weekly_post(report: Dict, market: str) -> str:
    """تنسيق بوست التقرير الأسبوعي"""
    week = report.get('week_range', {})
    summary = report.get('summary', {})
    recs = report.get('recommendations', [])

    text = f"""📊 **التقرير الأسبوعي الشامل - دليل الاستثمار**

📅 **الأسبوع:** {week.get('start', '')} إلى {week.get('end', '')}

📈 **ملخص حصاد الأسبوع:**
• إجمالي الأسهم النشطة: {summary.get('total_stocks', 0)}
• 🟢 ارتفعت: {summary.get('gainers', 0)} سهم
• 🔴 انخفضت: {summary.get('losers', 0)} سهم
• 📊 اتساع السوق: {summary.get('market_breadth', 0)}%

"""

    # أفضل 5 أسهم
    top_gainers = report.get('top_gainers', [])[:5]
    if top_gainers:
        text += "🏆 **أفضل 5 أسهم هذا الأسبوع:**\n"
        for i, stock in enumerate(top_gainers, 1):
            sym = stock.get('symbol', stock.get('ticker', ''))
            name_ar = get_arabic_stock_name(sym, sym)
            change = stock.get('change_percent', 0)
            text += f"{i}. {name_ar} (`{sym}`): +{change:.2f}%\n"

    # التوقعات للأسبوع القادم بدون أي تكرار مع كافة مستويات الأسعار والتحليل
    seen_recs = set()
    valid_recs = []
    for r in recs:
        s = r.get('symbol') or r.get('ticker')
        if s and s not in seen_recs:
            seen_recs.add(s)
            valid_recs.append(r)

    if valid_recs:
        text += "\n🎯 **توقعات وفرص الأسبوع القادم (فرص شراء مؤكدة):**\n"
        text += "━━━━━━━━━━━━━━━━━\n"
        for i, rec in enumerate(valid_recs[:5], 1):
            sym = rec.get('symbol') or rec.get('ticker', '')
            name_ar = rec.get('name_ar') or rec.get('name') or get_arabic_stock_name(sym, sym)
            # AUDIT-PUBLISH-QUALITY (Rule 27): keep None when missing so the
            # published card shows "—" instead of "0.00 ج.م".
            entry_raw = rec.get('entry_price')
            try:
                entry = float(entry_raw) if entry_raw is not None else None
            except (TypeError, ValueError):
                entry = None
            tp1_raw = rec.get('target_price')
            try:
                tp1 = float(tp1_raw) if tp1_raw is not None else None
            except (TypeError, ValueError):
                tp1 = None
            tp2_raw = rec.get('target_price_2')
            try:
                tp2 = float(tp2_raw) if tp2_raw is not None else (tp1 * 1.05 if tp1 and tp1 > 0 else None)
            except (TypeError, ValueError):
                tp2 = None
            sl_raw = rec.get('stop_loss')
            try:
                sl = float(sl_raw) if sl_raw is not None else None
            except (TypeError, ValueError):
                sl = None
            score_raw = rec.get('confidence')
            if score_raw is None:
                score_raw = rec.get('score')
            try:
                score = float(score_raw) if score_raw is not None else None
            except (TypeError, ValueError):
                score = None

            # AUDIT-PUBLISH-QUALITY: gain/loss % only when entry + level valid.
            tp1_gain = ((tp1 - entry) / entry * 100) if (entry and entry > 0 and tp1 and tp1 > 0) else None
            tp2_gain = ((tp2 - entry) / entry * 100) if (entry and entry > 0 and tp2 and tp2 > 0) else None
            sl_loss = ((sl - entry) / entry * 100) if (entry and entry > 0 and sl and sl > 0) else None

            conf_label = f"{score:.0f}%" if score is not None else "—"
            text += f"🔹 **{i}. {name_ar} (#{sym})** | الثقة: **{conf_label}**\n"
            text += f"  • 🟢 سعر الدخول المقترح: `{_fmt_price(entry)} ج.م`\n"
            tp1_gain_label = f" (+{tp1_gain:.1f}%)" if tp1_gain is not None else ""
            text += f"  • 🎯 الهدف الأول: `{_fmt_price(tp1)} ج.م`{tp1_gain_label}\n"
            tp2_gain_label = f" (+{tp2_gain:.1f}%)" if tp2_gain is not None else ""
            text += f"  • 🏆 الهدف الثاني: `{_fmt_price(tp2)} ج.م`{tp2_gain_label}\n"
            sl_loss_label = f" ({sl_loss:.1f}%)" if sl_loss is not None else ""
            text += f"  • 🛡️ وقف الخسارة الصارم: `{_fmt_price(sl)} ج.م`{sl_loss_label}\n"

            # التحليل وأسباب الفرصة
            analysis = rec.get('analysis') or rec.get('notes') or ''
            if not analysis:
                # AUDIT-PUBLISH-QUALITY (Rule 27): do NOT fabricate a default
                # "تجميع مؤسسي + تدفق سيولة + كسر مقاومة" string with fake
                # "4 أدلة رقمية" when no upstream analysis exists.
                analysis = '— لا يتوفر نص تحليلي لهذه الفرصة حالياً.'
            text += f"  • 💡 التحليل الفني ومصدر التوقع: {analysis}\n\n"

    text += """━━━━━━━━━━━━━━━━━
🔗 روابطنا الرسمية:
🌐 https://invist.m2y.net
📱 https://play.google.com/store/apps/details?id=com.egx.investment
📘 https://www.facebook.com/profile.php?id=61590600300048
✈️ https://t.me/Arabian_investment_guide
━━━━━━━━━━━━━━━━━
⚠️ *تحليل كمي بالذكاء الاصطناعي — إدارة رأس المال مسؤوليتك أولاً*
🚀 **دليل الاستثمار**

#تقرير_أسبوعي #البورصة_المصرية #توقعات_الأسهم #EGX"""

    return text


def _format_monthly_post(report: Dict, market: str) -> str:
    """تنسيق بوست التقرير الشهري"""
    month = report.get('month_range', {})
    summary = report.get('summary', {})
    perf = report.get('monthly_performance', {})
    preds = report.get('predictions_stats', {})

    text = f"""📈 **التقرير الشهري - دليل الاستثمار**

📅 **{month.get('month_name_ar', '')} {month.get('year', '')}**

📊 **ملخص الشهر:**
• إجمالي الأسهم: {summary.get('total_stocks', 0)}
• 🟢 ارتفعت: {summary.get('gainers', 0)}
• 🔴 انخفضت: {summary.get('losers', 0)}

"""

    # إحصائيات التوقعات
    if preds.get('total', 0) > 0:
        text += f"""🎯 **أداء التوقعات:**
• إجمالي التوقعات: {preds['total']}
• ✅ ناجحة: {preds['successful']}
• ❌ فاشلة: {preds['failed']}
• 📊 نسبة النجاح: {preds['success_rate']}%
• 💰 متوسط العائد: {preds['avg_return']:+.2f}%

"""

    # أفضل الأسهم
    if perf.get('best_performers'):
        text += "🏆 **أفضل 5 أسهم الشهر:**\n"
        for i, stock in enumerate(perf['best_performers'][:5], 1):
            text += f"{i}. {stock['ticker']} ({stock['change_percent']:+.2f}%)\n"

    # أسوأ الأسهم
    if perf.get('worst_performers'):
        text += "\n📉 **أسوأ 3 أسهم الشهر:**\n"
        for i, stock in enumerate(perf['worst_performers'][:3], 1):
            text += f"{i}. {stock['ticker']} ({stock['change_percent']:+.2f}%)\n"

    text += """
━━━━━━━━━━━━━━━━━
🔗 روابطنا الرسمية:
🌐 https://invist.m2y.net
📱 https://play.google.com/store/apps/details?id=com.egx.investment
📘 https://www.facebook.com/profile.php?id=61590600300048
✈️ https://t.me/Arabian_investment_guide
━━━━━━━━━━━━━━━━━
⚠️ *تحليل تلقائي - ليس نصيحة استثمارية*
🚀 **دليل الاستثمار**

#تقرير_شهري #البورصة_المصرية #EGX #استثمار"""

    return text


# ============================================================================
# SCHEDULER
# ============================================================================
def should_run_daily_opportunities(state: Dict) -> bool:
    """هل يجب تشغيل الفرص اليومية الآن؟ (4:00 م - أيام عمل فقط)"""
    now = datetime.now()
    if now.weekday() not in [6, 0, 1, 2, 3]:
        return False
    if now.hour != 16:
        return False
    last = state.get('last_daily_opportunities')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.date() == now.date():
                return False
        except Exception:
            pass
    return True


def should_run_daily(state: Dict) -> bool:
    """هل يجب تشغيل التقرير اليومي الآن؟"""
    now = datetime.now()
    # Check if it's the right hour (and a working day: Sunday-Thursday = 6,0,1,2,3)
    if now.weekday() not in [6, 0, 1, 2, 3]:
        return False
    if now.hour != DAILY_HOUR:
        return False

    # Check if already posted today
    last = state.get('last_daily')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.date() == now.date():
                return False
        except Exception:
            pass

    return True


def should_run_weekly(state: Dict) -> bool:
    """هل يجب تشغيل التقرير الأسبوعي الآن؟"""
    now = datetime.now()
    if now.weekday() != WEEKLY_DAY:
        return False
    if now.hour != WEEKLY_HOUR:
        return False

    # Check if already posted this week
    last = state.get('last_weekly')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            # Same week if within 7 days
            if (now - last_dt).days < 7:
                return False
        except Exception:
            pass

    return True


def should_run_monthly(state: Dict) -> bool:
    """هل يجب تشغيل التقرير الشهري الآن؟"""
    now = datetime.now()
    if now.day != MONTHLY_DAY:
        return False
    if now.hour != MONTHLY_HOUR:
        return False

    # Check if already posted this month
    last = state.get('last_monthly')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.year == now.year and last_dt.month == now.month:
                return False
        except Exception:
            pass

    return True


# ============================================================================
# REPORTS ENGINE SCHEDULING (نظام التقارير الذكية الجديد)
# ============================================================================
# كل الدوال دي بتستخدم ReportsEngine (لو متاح) + TelegramAutoPoster
# التوقيت بـ Africa/Cairo (لو MARKET_HOURS_AVAILABLE متاح نستخدمه، وإلا datetime.now())

def _cairo_now() -> datetime:
    """الحصول على التوقيت المصري (Africa/Cairo)"""
    if MARKET_HOURS_AVAILABLE:
        try:
            return get_egypt_time()
        except Exception:
            pass
    return datetime.now()


def _is_holiday(now: datetime) -> bool:
    """فحص هل اليوم إجازة في EGX (عطلات معرّفة في market_hours.py)"""
    try:
        if not MARKET_HOURS_AVAILABLE:
            return False
        date_str = now.strftime('%Y-%m-%d')
        holidays = MARKET_HOURS.get('EGX', {}).get('holidays', [])
        return date_str in holidays
    except Exception:
        return False


def should_run_tomorrow_picks(state: Dict) -> bool:
    """هل يجب تشغيل توقعات الغد الآن؟ (8:30 ص - أيام عمل فقط)"""
    if not REPORTS_ENGINE_AVAILABLE:
        return False
    now = _cairo_now()
    # أيام عمل: الأحد(6) للخميس(3)
    if now.weekday() not in WORKING_DAYS:
        return False
    # Match a ±4 minute window around the target time (polling is every 5 min,
    # so a tight ±1 window can be missed). Dedup is handled by last_tomorrow_picks.
    target_min = TOMORROW_PICKS_HOUR * 60 + TOMORROW_PICKS_MIN
    current_min = now.hour * 60 + now.minute
    if abs(current_min - target_min) > 4:
        return False
    # إجازة → skip
    if _is_holiday(now):
        return False
    # تم النشر قبله؟
    last = state.get('last_tomorrow_picks')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.date() == now.date():
                return False
        except Exception:
            pass
    return True


def should_run_daily_summary(state: Dict) -> bool:
    """هل يجب تشغيل ملخص اليوم الآن؟ (4:00 م - أيام عمل فقط)"""
    if not REPORTS_ENGINE_AVAILABLE:
        return False
    now = _cairo_now()
    if now.weekday() not in WORKING_DAYS:
        return False
    # Match a ±4 minute window around the target time. The scheduler polls
    # every 5 minutes, so a tight ±1 window can be missed entirely (e.g. the
    # tick lands on 15:58 then 16:03, skipping 16:00±1). A ±4 window guarantees
    # at least one tick falls inside it. Dedup is handled by last_daily_summary.
    target_min = DAILY_SUMMARY_HOUR * 60 + DAILY_SUMMARY_MIN
    current_min = now.hour * 60 + now.minute
    if abs(current_min - target_min) > 4:
        return False
    if _is_holiday(now):
        return False
    last = state.get('last_daily_summary')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.date() == now.date():
                return False
        except Exception:
            pass
    return True


def should_run_weekly_summary(state: Dict) -> bool:
    """هل يجب تشغيل ملخص الأسبوع الآن؟ (الجمعة 9:00 ص)"""
    if not REPORTS_ENGINE_AVAILABLE:
        return False
    now = _cairo_now()
    if now.weekday() != WEEKLY_SUMMARY_DAY:
        return False
    # ±4 minute window (polling is every 5 min; ±1 can be missed).
    target_min = WEEKLY_SUMMARY_HOUR * 60 + WEEKLY_SUMMARY_MIN
    current_min = now.hour * 60 + now.minute
    if abs(current_min - target_min) > 4:
        return False
    last = state.get('last_weekly_summary')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            # نفس الأسبوع لو خلال 7 أيام
            if (now - last_dt).days < 7:
                return False
        except Exception:
            pass
    return True


def should_run_monthly_summary(state: Dict) -> bool:
    """هل يجب تشغيل ملخص الشهر الآن؟ (أول يوم في الشهر 10:00 ص)"""
    if not REPORTS_ENGINE_AVAILABLE:
        return False
    now = _cairo_now()
    if now.day != MONTHLY_SUMMARY_DAY:
        return False
    # ±4 minute window (polling is every 5 min; ±1 can be missed).
    target_min = MONTHLY_SUMMARY_HOUR * 60 + MONTHLY_SUMMARY_MIN
    current_min = now.hour * 60 + now.minute
    if abs(current_min - target_min) > 4:
        return False
    last = state.get('last_monthly_summary')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.year == now.year and last_dt.month == now.month:
                return False
        except Exception:
            pass
    return True


def should_run_morning_bell(state: Dict) -> bool:
    """هل يجب تشغيل جرس الصباح الآن؟ (9:45 ص - أيام عمل فقط - قبل افتتاح السوق بـ 15 دقيقة)

    P18: بينشر أعلى 3 فرص EGX على قناة تيليجرام البريميوم. لو مفيش فرص →
    الـ post_morning_bell بيرجع skipped (مبيبعتش حاجة — مش بنسبّم العميل).
    الـ dedup هنا بيميّز يومياً (نفس اليوم = skip).
    """
    if not MORNING_BELL_DATA_AVAILABLE:
        return False
    now = _cairo_now()
    # أيام عمل: الأحد(6) للخميس(3)
    if now.weekday() not in WORKING_DAYS:
        return False
    # ±4 minute window (polling is every 5 min; ±1 can be missed).
    target_min = MORNING_BELL_HOUR * 60 + MORNING_BELL_MIN
    current_min = now.hour * 60 + now.minute
    if abs(current_min - target_min) > 4:
        return False
    # إجازة → skip
    if _is_holiday(now):
        return False
    # تم النشر قبله النهاردة؟
    last = state.get('last_morning_bell')
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.date() == now.date():
                return False
        except Exception:
            pass
    return True


# ============================================================================
# REPORTS ENGINE POSTING FUNCTIONS
# ============================================================================

def _get_reports_engine():
    """تهيئة ReportsEngine (lazy)"""
    if not REPORTS_ENGINE_AVAILABLE:
        return None
    try:
        return ReportsEngine()
    except Exception as e:
        print(f"[ReportsEngine] init error: {e}")
        return None


async def _post_report_via_engine(report_type: str, market: str, state_key: str) -> Dict:
    """
    Generic helper: يولّد تقرير من ReportsEngine وينشره على تليجرام.

    Args:
        report_type: 'daily_tomorrow' | 'daily_summary' | 'weekly' | 'monthly'
        market: 'EGX' | 'TADAWUL' | 'KSE' | 'QSE'
        state_key: اسم الـ key في state (مثلاً 'last_tomorrow_picks')

    Returns:
        Dict: {success, message_id?, error?, report_id?}
    """
    print(f"[{datetime.now()}] 📝 Generating {report_type} report via ReportsEngine (market={market})...")

    engine = _get_reports_engine()
    if engine is None:
        return {"success": False, "error": "ReportsEngine not available"}

    # خريطة الأنواع للـ methods
    type_to_method = {
        'daily_tomorrow': 'generate_tomorrow_picks',
        'daily_summary':  'generate_daily_summary',
        'weekly':         'generate_weekly_summary',
        'monthly':        'generate_monthly_summary',
    }
    method_name = type_to_method.get(report_type)
    if not method_name:
        return {"success": False, "error": f"Unknown report type: {report_type}"}

    method = getattr(engine, method_name, None)
    if method is None:
        return {"success": False, "error": f"Engine method not available: {method_name}"}

    try:
        # 1) توليد التقرير
        report = method(market=market, force=False)
        if not report:
            return {"success": False, "error": f"Engine returned empty {report_type} report"}

        report_id = report.get('id') or report.get('report_id') if isinstance(report, dict) else None

        # 2) محاولة النشر على تليجرام (لو الـ engine فيه publish_to_telegram)
        publish_result = None
        if report_id and hasattr(engine, 'publish_to_telegram'):
            try:
                publish_result = engine.publish_to_telegram(report_id, market=market)
            except Exception as e:
                publish_result = {"success": False, "error": str(e)}

        # 3) fallback: لو الـ engine ما نشرش، نحاول ننشر النص يدوياً
        if not publish_result or not publish_result.get('success'):
            text = None
            if isinstance(report, dict):
                text = report.get('report_text') or report.get('text') or report.get('content')

            if text:
                poster = TelegramAutoPoster()
                connect_result = await poster.connect()
                if connect_result.get('success'):
                    # لو فيه صورة مرفقة → نرسلها كـ photo
                    image_path = report.get('image_path') if isinstance(report, dict) else None
                    if image_path and os.path.exists(image_path):
                        send_result = await poster.send_photo(image_path, caption=text, parse_mode='md')
                    else:
                        send_result = await poster.send_message(text, parse_mode='md')
                    await poster.disconnect()

                    if send_result.get('success'):
                        publish_result = {
                            "success": True,
                            "telegram_message_id": send_result.get('message_id'),
                            "message_id": send_result.get('message_id'),
                            "fallback": "manual_poster",
                        }
                    else:
                        publish_result = publish_result or {
                            "success": False,
                            "error": send_result.get('error', 'manual poster failed')
                        }

        if publish_result and publish_result.get('success'):
            print(f"[{datetime.now()}] ✅ {report_type} published "
                  f"(msg_id: {publish_result.get('telegram_message_id') or publish_result.get('message_id')})")
            return {
                "success": True,
                "telegram_message_id": publish_result.get('telegram_message_id') or publish_result.get('message_id'),
                "report_id": report_id,
                "state_key": state_key,
            }
        else:
            err = (publish_result or {}).get('error', 'unknown publish error')
            print(f"[{datetime.now()}] ❌ {report_type} publish failed: {err}")
            return {"success": False, "error": err, "report_id": report_id}

    except Exception as e:
        print(f"[{datetime.now()}] ❌ {report_type} posting error: {e}")
        return {"success": False, "error": str(e)}


async def post_tomorrow_picks(market: str = 'EGX') -> Dict:
    """توليد + نشر توقعات الغد (8:30 ص - أيام عمل)"""
    return await _post_report_via_engine('daily_tomorrow', market, 'last_tomorrow_picks')


# ==================== DAILY OPPORTUNITIES ====================

async def post_daily_opportunities(market: str = 'EGX') -> Dict:
    """
    نشر أفضل الفرص اليومية على التليجرام - كل يوم بعد الإغلاق.
    يستدعي /api/maestro/daily-opportunities
    """
    print(f"[{datetime.now()}] 🎯 Generating daily opportunities post...")
    
    try:
        from analyzers.maestro_orchestrator import daily_opportunities
    except Exception as e:
        print(f"[{datetime.now()}] ❌ daily_opportunities not available: {e}")
        return {"success": False, "error": f"Module not available: {e}"}
    
    try:
        # جيب أفضل 5 فرص
        result = daily_opportunities(market=market, limit=5)
        opportunities = result.get('opportunities', [])
        
        if not opportunities:
            print(f"[{datetime.now()}] ⚠️ No opportunities found")
            return {"success": False, "error": "No opportunities found"}
        
        # هيئ نص البوست
        post_text = _format_daily_opportunities_post(result, market)
        
        # انشر
        poster = TelegramAutoPoster()
        connect_result = await poster.connect()
        if not connect_result.get('success'):
            return {"success": False, "error": f"Telegram connect failed: {connect_result.get('error')}"}
        
        post_result = await poster.send_message(post_text, parse_mode='HTML')
        await poster.disconnect()
        
        if post_result.get('success'):
            print(f"[{datetime.now()}] ✅ Daily opportunities post sent (msg_id: {post_result.get('message_id')})")
        else:
            print(f"[{datetime.now()}] ❌ Daily opportunities post failed: {post_result.get('error')}")
        
        return post_result
        
    except Exception as e:
        print(f"[{datetime.now()}] ❌ Daily opportunities error: {e}")
        return {"success": False, "error": str(e)}


def _format_daily_opportunities_post(result: Dict, market: str) -> str:
    """تنسيق نص الفرص اليومية للتليجرام"""
    date_str = result.get('date', datetime.now().strftime('%Y-%m-%d'))
    opportunities = result.get('opportunities', [])
    
    lines = []
    lines.append(f"🎯 <b>أفضل {len(opportunities)} فرص اليوم</b> — {date_str}")
    lines.append("")
    
    for idx, opp in enumerate(opportunities, 1):
        ticker = opp.get('ticker') or '—'
        name = opp.get('name') or ticker
        # AUDIT-PUBLISH-QUALITY (Rule 27): keep None when source missing
        # so we can render "—" instead of "0.00" in the published card.
        price = opp.get('price')
        maestro_score = opp.get('maestro_score')
        recommendation_ar = opp.get('recommendation_ar') or '—'
        confidence = opp.get('confidence')
        
        hunter_score = opp.get('hunter_score') or 0
        momentum_score = opp.get('momentum_score') or 0
        value_score = opp.get('value_score') or 0
        hunter_verdict = opp.get('hunter_verdict') or ''
        momentum_verdict = opp.get('momentum_verdict') or ''
        value_verdict = opp.get('value_verdict') or ''
        
        narrative_line1 = opp.get('narrative_line1', '')
        narrative_line2 = opp.get('narrative_line2', '')
        narrative_line3 = opp.get('narrative_line3', '')
        
        stop_loss = opp.get('stop_loss')
        target = opp.get('target')
        entry_price = opp.get('entry_price') if opp.get('entry_price') is not None else price
        # RADAR-QUICK-WINS (Priority 4): add target_2 (derived as +10% above
        # target_1 when not present in the source data) so each Telegram card
        # shows entry + target_1 + target_2 + stop_loss with gain/loss %.
        # AUDIT-PUBLISH-QUALITY (Rule 27): use None-safe parsing.
        def _to_float(v):
            if v is None:
                return 0.0
            try:
                f = float(v)
            except (TypeError, ValueError):
                return 0.0
            if f != f or not (-1e12 < f < 1e12):
                return 0.0
            return f
        target_1 = _to_float(opp.get('target_1')) or _to_float(target)
        target_2 = _to_float(opp.get('target_2')) or (target_1 * 1.10 if target_1 > 0 else 0.0)
        entry_f = _to_float(entry_price)
        stop_f = _to_float(stop_loss)
        price_f = _to_float(price)

        emoji = "🏦" if hunter_score >= max(momentum_score, value_score) else "🚀" if momentum_score >= max(hunter_score, value_score) else "💰"

        lines.append(f"{idx}️⃣ {emoji} <b>{ticker}</b> — {name}")
        # AUDIT-PUBLISH-QUALITY: render "—" when price/score/confidence missing.
        lines.append(
            f"💰 السعر: {_fmt_price(price)} ج | 🎯 درجة المايسترو: "
            f"{(f'{maestro_score:.1f}' if maestro_score is not None else '—')}"
        )
        lines.append(
            f"📊 التوصية: {recommendation_ar} | 🔒 الثقة: "
            f"{(f'{confidence:.0f}%' if confidence is not None else '—')}"
        )

        # Personas
        if hunter_score >= 70:
            lines.append(f"   🎯 الصياد: {hunter_score:.0f}/100 {hunter_verdict}")
        if momentum_score >= 70:
            lines.append(f"   🚀 الزخم: {momentum_score:.0f}/100 {momentum_verdict}")
        if value_score >= 70:
            lines.append(f"   💰 القيمة: {value_score:.0f}/100 {value_verdict}")

        # Narrative (snippet)
        if narrative_line1:
            lines.append(f"   📖 {narrative_line1[:80]}...")

        # Levels — RADAR-QUICK-WINS (Priority 4): multi-line format with
        # target_1, target_2, stop_loss + gain/loss percentages.
        if entry_f > 0:
            t1_gain = ((target_1 - entry_f) / entry_f * 100) if (entry_f > 0 and target_1 > 0) else 0
            t2_gain = ((target_2 - entry_f) / entry_f * 100) if (entry_f > 0 and target_2 > 0) else 0
            sl_loss = ((stop_f - entry_f) / entry_f * 100) if (entry_f > 0 and stop_f > 0) else 0
            lines.append(f"   💰 الدخول: {_fmt_price(entry_f)}")
            if target_1 > 0:
                lines.append(f"   🎯 الهدف 1: {_fmt_price(target_1)} (+{t1_gain:.1f}%)")
            if target_2 > 0:
                lines.append(f"   🎯 الهدف 2: {_fmt_price(target_2)} (+{t2_gain:.1f}%)")
            if stop_f > 0:
                lines.append(f"   🛑 وقف الخسارة: {_fmt_price(stop_f)} ({sl_loss:.1f}%)")
        
        lines.append("")
    
    lines.append("⚠️ <b>تنبيه:</b> هذا تحليل تلقائي — ليس نصيحة استثمارية")
    lines.append("🔗 @Arabian_investment_guide")
    
    return "\n".join(lines)


async def post_daily_summary(market: str = 'EGX') -> Dict:
    """توليد + نشر ملخص اليوم (4:30 م - أيام عمل)"""
    return await _post_report_via_engine('daily_summary', market, 'last_daily_summary')


async def post_weekly_summary(market: str = 'EGX') -> Dict:
    """توليد + نشر ملخص الأسبوع (الجمعة 9:00 ص)"""
    return await _post_report_via_engine('weekly', market, 'last_weekly_summary')


async def post_monthly_summary(market: str = 'EGX') -> Dict:
    """توليد + نشر ملخص الشهر (أول يوم في الشهر 10:00 ص)"""
    return await _post_report_via_engine('monthly', market, 'last_monthly_summary')


# ============================================================================
# P18 MORNING BELL — جرس الصباح (Telegram posting)
# ============================================================================
async def post_morning_bell(market: str = 'EGX') -> Dict:
    """🔔 نشر جرس الصباح على تيليجرام — أعلى 3 فرص EGX.

    بيجيب البيانات من `_get_morning_bell_data()` (نفس مصدر الـ endpoint
    /api/market/morning-bell — Python = THE BRAIN). لو مفيش فرص → بيرجع بدون
    نشر (مش بنسبّم العميل برسائل فاضية). لو فيه فرص → بينسّق رسالة ويبعتها
    للقناة.
    """
    print(f"[{datetime.now()}] 🔔 Generating Morning Bell post (market={market})...")

    if not MORNING_BELL_DATA_AVAILABLE:
        return {"success": False, "error": "Morning Bell data module not available"}

    try:
        # 1) نجيب أعلى 3 فرص (نفس منطق الـ endpoint بالظبط — DRY)
        data = _get_morning_bell_data(limit=3)
        stocks = data.get('stocks', [])

        # 2) مفيش فرص → مبنسبّمش (مش هنسبم العميل برسائل فاضية)
        if not stocks:
            print(f"[{datetime.now()}] 🔕 Morning Bell: no opportunities today — skipping (no spam).")
            return {
                "success": True,
                "skipped": True,
                "reason": "no_opportunities",
                "message": "مفيش فرص شراء متاحة — تم تخطي النشر."
            }

        # 3) ننسّق الرسالة
        post_text = _format_morning_bell_post(data)
        if not post_text:
            return {"success": False, "error": "Failed to format morning bell post"}

        # 4) ننشر على تيليجرام
        poster = TelegramAutoPoster()
        connect_result = await poster.connect()
        if not connect_result.get('success'):
            return {"success": False, "error": f"Telegram connect failed: {connect_result.get('error')}"}

        result = await poster.send_message(post_text, parse_mode='md')
        await poster.disconnect()

        if result.get('success'):
            print(f"[{datetime.now()}] ✅ Morning Bell sent successfully (msg_id: {result.get('message_id')})")
        else:
            print(f"[{datetime.now()}] ❌ Morning Bell failed: {result.get('error')}")

        return result

    except Exception as e:
        print(f"[{datetime.now()}] ❌ Morning Bell error: {e}")
        return {"success": False, "error": str(e)}


def _format_morning_bell_post(data: Dict) -> str:
    """تنسيق رسالة جرس الصباح للتيليجرام.

    الشكل (حسب طلب المدير التقني):
        🔔 جرس الصباح - [التاريخ]
        _[label_ar]_

        1. 🏦 [اسم السهم] ([Ticker])🚀   ← 🚀 لو ath_breakout
           الإشارة: [فرصة شراء]
           💰 الدخول: [Price] | 🎯 الهدف: [Price] | 🛑 الوقف: [Price]
           ⚖️ R/R: [x] | 📊 النقاط: [score] | ⚠️ تعويض تأخير

        2. ...
    """
    stocks = data.get('stocks', [])
    if not stocks:
        return ""

    date_ar = datetime.now().strftime('%d/%m/%Y')
    label = data.get('label_ar', '🔔 جرس الصباح')

    text = f"🔔 **جرس الصباح - {date_ar}**\n"
    text += f"_{label}_\n\n"

    for i, s in enumerate(stocks, 1):
        ticker = s.get('ticker', '')
        name_ar = s.get('name_ar', ticker)
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67 + Rule 27 NO-FAKE-DATA)
        # Prefer canonical signal_ar() for the 7 canonical levels (matches all
        # screens). For non-canonical upstream signals (e.g. 'morning_bell_buy'
        # with rich Arabic label '🔔 شراء جرس الصباح') pass through the upstream
        # signal_ar. No longer fabricate 'شراء' as default.
        _signal_en = (s.get('signal') or '').upper()
        _CANONICAL_SIGNALS = frozenset({
            'STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL', 'STRONG_SELL'
        })
        if _signal_en in _CANONICAL_SIGNALS:
            signal_ar = canonical_signal_ar(_signal_en)
        else:
            signal_ar = s.get('signal_ar')  # may be None — Rule 27 (no fake data)
        entry = s.get('entry') or s.get('entry_price')
        target = s.get('target') or s.get('target_price')
        stop = s.get('stop') or s.get('stop_loss')
        # RADAR-QUICK-WINS (Priority 4): add target_1 / target_2 with gain %
        # to the morning bell card (in addition to the existing single-line
        # R/R + score line). target_2 derived as +10% above target_1 when
        # not provided by the source data.
        # AUDIT-PUBLISH-QUALITY (Rule 27 — NO-FAKE-DATA): keep None instead
        # of falling back to 0 → "0.00" leak in the published card.
        def _to_float_or_none(v):
            if v is None:
                return None
            try:
                f = float(v)
            except (TypeError, ValueError):
                return None
            if f != f or not (-1e12 < f < 1e12):
                return None
            return f

        target_1 = _to_float_or_none(s.get('target_1')) or _to_float_or_none(target) or 0.0
        target_2 = _to_float_or_none(s.get('target_2')) or (target_1 * 1.10 if target_1 > 0 else 0.0)
        entry_f = _to_float_or_none(entry) or 0.0
        stop_f = _to_float_or_none(stop) or 0.0
        rr = _to_float_or_none(s.get('risk_reward')) or 0.0
        score = _to_float_or_none(s.get('score')) or 0.0
        ath = bool(s.get('ath_breakout', False))
        delay = bool(s.get('delay_compensation_applied', False))

        t1_gain = ((target_1 - entry_f) / entry_f * 100) if (entry_f > 0 and target_1 > 0) else 0
        t2_gain = ((target_2 - entry_f) / entry_f * 100) if (entry_f > 0 and target_2 > 0) else 0
        sl_loss = ((stop_f - entry_f) / entry_f * 100) if (entry_f > 0 and stop_f > 0) else 0

        rocket = ' 🚀' if ath else ''
        text += f"{i}. 🏦 **{name_ar}** ({ticker}){rocket}\n"
        if signal_ar:  # Rule 27 (NO-FAKE-DATA): skip line when no signal available
            text += f"   الإشارة: {signal_ar}\n"
        # AUDIT-PUBLISH-QUALITY: show "—" when entry missing instead of "0.00".
        text += f"   💰 الدخول: {_fmt_price(entry)}\n"
        if target_1 > 0:
            text += f"   🎯 الهدف 1: {_fmt_price(target_1)} (+{t1_gain:.1f}%)\n"
        if target_2 > 0:
            text += f"   🎯 الهدف 2: {_fmt_price(target_2)} (+{t2_gain:.1f}%)\n"
        if stop_f > 0:
            text += f"   🛑 وقف الخسارة: {_fmt_price(stop)} ({sl_loss:.1f}%)\n"
        # AUDIT-PUBLISH-QUALITY: only show R/R + score line when at least
        # one of them is meaningful (> 0). Otherwise "R/R: 0.0 | النقاط: 0"
        # is a meaningless leak of fabricated zeros.
        if rr > 0 or score > 0:
            extras = f"⚖️ R/R: {rr:.1f} | 📊 النقاط: {score:.0f}"
            if delay:
                extras += " | ⚠️ تعويض تأخير"
            text += f"   {extras}\n"
        elif delay:
            text += "   ⚠️ تعويض تأخير\n"
        text += "\n"

    text += "━━━━━━━━━━━━━━━━━━━\n"
    text += "⚠️ ليست توصية شراء مباشرة — راجع استراتيجيتك ومستوى المخاطرة.\n"
    text += "🌐 https://invist.m2y.net\n"
    text += "━━━━━━━━━━━━━━━━━━━\n"
    text += "#البورصة_المصرية #جرس_الصباح #EGX #توصيات #صباح_الخير"

    return text


async def run_scheduler():
    """تشغيل الجدولة المستمرة"""
    print("=" * 60)
    print("🤖 Telegram Auto Post Scheduler - دليل الاستثمار")
    print("=" * 60)
    print(f"📅 Daily: every working day at {DAILY_HOUR:02d}:00 (Egypt)")
    print(f"📅 Weekly: every Sunday at {WEEKLY_HOUR:02d}:00")
    print(f"📅 Monthly: 1st of each month at {MONTHLY_HOUR:02d}:00")
    if REPORTS_ENGINE_AVAILABLE:
        print(f"📅 Tomorrow Picks: {TOMORROW_PICKS_HOUR:02d}:{TOMORROW_PICKS_MIN:02d} (working days)")
        print(f"📅 Daily Summary : {DAILY_SUMMARY_HOUR:02d}:{DAILY_SUMMARY_MIN:02d} (working days)")
        print(f"📅 Weekly Summary: Friday {WEEKLY_SUMMARY_HOUR:02d}:{WEEKLY_SUMMARY_MIN:02d}")
        print(f"📅 Monthly Summary: 1st at {MONTHLY_SUMMARY_HOUR:02d}:{MONTHLY_SUMMARY_MIN:02d}")
    else:
        print("⚠️ ReportsEngine not available - skipping smart reports")
    if MORNING_BELL_DATA_AVAILABLE:
        print(f"📅 Morning Bell  : {MORNING_BELL_HOUR:02d}:{MORNING_BELL_MIN:02d} (working days, Telegram)")
    else:
        print("⚠️ Morning Bell data not available - skipping telegram bell")
    print(f"📁 State file: {STATE_FILE}")
    print("=" * 60)

    # Handle graceful shutdown
    running = [True]

    def signal_handler(signum, frame):
        print(f"\n[{datetime.now()}] 🛑 Received signal {signum}, shutting down...")
        running[0] = False

    # Handle graceful shutdown — signal handlers can only be registered
    # in the main thread of the main interpreter. When run_scheduler()
    # is launched inside a background thread (as main.py does), calling
    # signal.signal() raises "ValueError: signal only works in main
    # thread of the main interpreter" which crashes the whole scheduler
    # silently. Guard registration so the loop still runs in worker threads.
    try:
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    except (ValueError, OSError):
        # Not in main thread — rely on daemon thread + loop flag instead.
        pass

    while running[0]:
        try:
            now = datetime.now()
            state = load_state()

            # Check daily opportunities
            if should_run_daily_opportunities(state):
                print(f"\n[{now}] 🎯 Running daily opportunities post...")
                result = await post_daily_opportunities()
                if result.get('success'):
                    state['last_daily_opportunities'] = now.isoformat()
                    state['posts_count'] = state.get('posts_count', 0) + 1
                else:
                    state['errors'].append({
                        'date': now.isoformat(),
                        'type': 'daily_opportunities',
                        'error': result.get('error', 'unknown')
                    })
                    state['errors'] = state['errors'][-20:]
                save_state(state)

            # Check daily
            if should_run_daily(state):
                print(f"\n[{now}] � Running daily post...")
                result = await post_daily_predictions()
                if result.get('success'):
                    state['last_daily'] = now.isoformat()
                    state['posts_count'] = state.get('posts_count', 0) + 1
                else:
                    state['errors'].append({
                        'date': now.isoformat(),
                        'type': 'daily',
                        'error': result.get('error', 'unknown')
                    })
                    state['errors'] = state['errors'][-20:]  # keep last 20
                save_state(state)

            # Check weekly
            if should_run_weekly(state):
                print(f"\n[{now}] �📊 Running weekly post...")
                # L2-WEEKLY-RADAR-REPORT: try the new radar-based report first.
                # Falls back to the legacy MarketDailyReport-based weekly post
                # if the radar report fails (e.g., script missing, no DB).
                result = await post_weekly_radar_report()
                if not result.get('success'):
                    print(f"[{now}] ⚠️ weekly radar report failed — falling back to legacy weekly post")
                    result = await post_weekly_report()
                if result.get('success'):
                    state['last_weekly'] = now.isoformat()
                    state['posts_count'] = state.get('posts_count', 0) + 1
                else:
                    state['errors'].append({
                        'date': now.isoformat(),
                        'type': 'weekly',
                        'error': result.get('error', 'unknown')
                    })
                    state['errors'] = state['errors'][-20:]
                save_state(state)

            # Check monthly
            if should_run_monthly(state):
                print(f"\n[{now}] 📈 Running monthly post...")
                result = await post_monthly_report()
                if result.get('success'):
                    state['last_monthly'] = now.isoformat()
                    state['posts_count'] = state.get('posts_count', 0) + 1
                else:
                    state['errors'].append({
                        'date': now.isoformat(),
                        'type': 'monthly',
                        'error': result.get('error', 'unknown')
                    })
                    state['errors'] = state['errors'][-20:]
                save_state(state)

            # ─────────────────────────────────────────────────────────────
            # Reports Engine checks (نظام التقارير الذكية الجديد)
            # ─────────────────────────────────────────────────────────────
            if REPORTS_ENGINE_AVAILABLE:
                # توقعات الغد (8:30 ص)
                if should_run_tomorrow_picks(state):
                    print(f"\n[{now}] 🌅 Running tomorrow picks post...")
                    result = await post_tomorrow_picks()
                    if result.get('success'):
                        state['last_tomorrow_picks'] = now.isoformat()
                        state['posts_count'] = state.get('posts_count', 0) + 1
                    else:
                        state['errors'].append({
                            'date': now.isoformat(),
                            'type': 'tomorrow_picks',
                            'error': result.get('error', 'unknown')
                        })
                        state['errors'] = state['errors'][-20:]
                    save_state(state)

                # ملخص اليوم (4:30 م)
                if should_run_daily_summary(state):
                    print(f"\n[{now}] 🌇 Running daily summary post...")
                    result = await post_daily_summary()
                    if result.get('success'):
                        state['last_daily_summary'] = now.isoformat()
                        state['posts_count'] = state.get('posts_count', 0) + 1
                    else:
                        state['errors'].append({
                            'date': now.isoformat(),
                            'type': 'daily_summary',
                            'error': result.get('error', 'unknown')
                        })
                        state['errors'] = state['errors'][-20:]
                    save_state(state)

                # ملخص الأسبوع (الجمعة 9:00 ص)
                if should_run_weekly_summary(state):
                    print(f"\n[{now}] 📅 Running weekly summary post...")
                    result = await post_weekly_summary()
                    if result.get('success'):
                        state['last_weekly_summary'] = now.isoformat()
                        state['posts_count'] = state.get('posts_count', 0) + 1
                    else:
                        state['errors'].append({
                            'date': now.isoformat(),
                            'type': 'weekly_summary',
                            'error': result.get('error', 'unknown')
                        })
                        state['errors'] = state['errors'][-20:]
                    save_state(state)

                # ملخص الشهر (أول يوم في الشهر 10:00 ص)
                if should_run_monthly_summary(state):
                    print(f"\n[{now}] 📆 Running monthly summary post...")
                    result = await post_monthly_summary()
                    if result.get('success'):
                        state['last_monthly_summary'] = now.isoformat()
                        state['posts_count'] = state.get('posts_count', 0) + 1
                    else:
                        state['errors'].append({
                            'date': now.isoformat(),
                            'type': 'monthly_summary',
                            'error': result.get('error', 'unknown')
                        })
                        state['errors'] = state['errors'][-20:]
                    save_state(state)

            # ─────────────────────────────────────────────────────────────
            # P18 Morning Bell (جرس الصباح 9:45 ص — Telegram)
            # مش محتاج ReportsEngine — بيستخدم _get_morning_bell_data مباشرة.
            # ─────────────────────────────────────────────────────────────
            if should_run_morning_bell(state):
                print(f"\n[{now}] 🔔 Running Morning Bell post...")
                result = await post_morning_bell()
                if result.get('success'):
                    state['last_morning_bell'] = now.isoformat()
                    # لو skipped (مفيش فرص) → نحدّث last_morning_bell عشان
                    # ميعيدش المحاولة كل 5 دقايق، بس م نزيدش posts_count.
                    if not result.get('skipped'):
                        state['posts_count'] = state.get('posts_count', 0) + 1
                else:
                    state['errors'].append({
                        'date': now.isoformat(),
                        'type': 'morning_bell',
                        'error': result.get('error', 'unknown')
                    })
                    state['errors'] = state['errors'][-20:]
                save_state(state)

            # ─────────────────────────────────────────────────────────────
            # فحص ومتابعة الأهداف المحققة لحظياً أثناء الجلسة (Target Hit Tracker)
            # أيام عمل البورصة المصرية (الأحد-الخميس) بين 10:00 و 14:35
            # ─────────────────────────────────────────────────────────────
            is_egx_day = (now.weekday() in (6, 0, 1, 2, 3))
            is_egx_time = (10 * 60) <= (now.hour * 60 + now.minute) <= (14 * 60 + 35)
            if is_egx_day and is_egx_time:
                try:
                    from telegram_target_hit_tracker import run_target_hit_tracker
                    print(f"[{now}] 🎯 Live Session Check: running target hit tracker...")
                    await asyncio.to_thread(run_target_hit_tracker)
                except Exception as hit_err:
                    print(f"⚠️ Target hit tracker execution error: {hit_err}")

            # Sleep for 5 minutes
            await asyncio.sleep(300)

        except Exception as e:
            print(f"[{datetime.now()}] ❌ Scheduler error: {e}")
            await asyncio.sleep(60)

    print(f"\n[{datetime.now()}] Scheduler stopped.")


def show_status():
    """عرض حالة الجدولة"""
    state = load_state()
    print("=" * 60)
    print("📊 Auto Post Scheduler Status")
    print("=" * 60)
    print(f"📅 Daily post time: {DAILY_HOUR:02d}:00 (working days Sun-Thu)")
    print(f"📅 Weekly post: Sunday at {WEEKLY_HOUR:02d}:00")
    print(f"📅 Monthly post: 1st at {MONTHLY_HOUR:02d}:00")
    if REPORTS_ENGINE_AVAILABLE:
        print(f"📅 Tomorrow Picks : {TOMORROW_PICKS_HOUR:02d}:{TOMORROW_PICKS_MIN:02d} (working days)")
        print(f"📅 Daily Summary  : {DAILY_SUMMARY_HOUR:02d}:{DAILY_SUMMARY_MIN:02d} (working days)")
        print(f"📅 Weekly Summary : Friday {WEEKLY_SUMMARY_HOUR:02d}:{WEEKLY_SUMMARY_MIN:02d}")
        print(f"📅 Monthly Summary: 1st at {MONTHLY_SUMMARY_HOUR:02d}:{MONTHLY_SUMMARY_MIN:02d}")
    else:
        print("⚠️ ReportsEngine not available")
    if MORNING_BELL_DATA_AVAILABLE:
        print(f"📅 Morning Bell   : {MORNING_BELL_HOUR:02d}:{MORNING_BELL_MIN:02d} (working days, Telegram)")
    else:
        print("⚠️ Morning Bell data not available")
    print()
    print(f"✅ Last daily: {state.get('last_daily', 'never')}")
    print(f"✅ Last weekly: {state.get('last_weekly', 'never')}")
    print(f"✅ Last monthly: {state.get('last_monthly', 'never')}")
    if REPORTS_ENGINE_AVAILABLE:
        print(f"✅ Last tomorrow picks : {state.get('last_tomorrow_picks', 'never')}")
        print(f"✅ Last daily summary  : {state.get('last_daily_summary', 'never')}")
        print(f"✅ Last weekly summary : {state.get('last_weekly_summary', 'never')}")
        print(f"✅ Last monthly summary: {state.get('last_monthly_summary', 'never')}")
    print(f"✅ Last morning bell  : {state.get('last_morning_bell', 'never')}")
    print(f"📊 Total posts: {state.get('posts_count', 0)}")
    print()
    errors = state.get('errors', [])
    if errors:
        print(f"❌ Recent errors ({len(errors)}):")
        for err in errors[-5:]:
            print(f"   {err.get('date', '?')} [{err.get('type', '?')}]: {err.get('error', '?')[:80]}")
    else:
        print("✅ No errors")
    print("=" * 60)


# ============================================================================
# MAIN
# ============================================================================
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Telegram Auto Post Scheduler')
    parser.add_argument('--now', choices=['daily', 'weekly', 'monthly',
                                          'tomorrow_picks', 'daily_summary',
                                          'weekly_summary', 'monthly_summary',
                                          'morning_bell'],
                        help='Post immediately (skip scheduling)')
    parser.add_argument('--status', action='store_true', help='Show scheduler status')
    parser.add_argument('--market', default='EGX', help='Market (default: EGX)')

    args = parser.parse_args()

    if args.status:
        show_status()
    elif args.now:
        # Post immediately
        print(f"🚀 Posting {args.now} report immediately...")
        if args.now == 'daily':
            result = asyncio.run(post_daily_predictions(args.market))
        elif args.now == 'weekly':
            result = asyncio.run(post_weekly_report(args.market))
        elif args.now == 'monthly':
            result = asyncio.run(post_monthly_report(args.market))
        elif args.now == 'tomorrow_picks':
            result = asyncio.run(post_tomorrow_picks(args.market))
        elif args.now == 'daily_summary':
            result = asyncio.run(post_daily_summary(args.market))
        elif args.now == 'weekly_summary':
            result = asyncio.run(post_weekly_summary(args.market))
        elif args.now == 'monthly_summary':
            result = asyncio.run(post_monthly_summary(args.market))
        elif args.now == 'morning_bell':
            result = asyncio.run(post_morning_bell(args.market))
        else:
            result = {"success": False, "error": "Unknown type"}

        print(f"\nResult: {json.dumps(result, indent=2, ensure_ascii=False)}")

        if result.get('success'):
            # Update state
            state = load_state()
            state[f'last_{args.now}'] = datetime.now().isoformat()
            state['posts_count'] = state.get('posts_count', 0) + 1
            save_state(state)
            print("✅ State updated")
    else:
        # Run scheduler
        asyncio.run(run_scheduler())
