#!/usr/bin/env python3
"""
Fallback Chain — Universal Data Sources Orchestrator
=====================================================

الوظيفة:
  - يجيب أسعار الأسهم بـ "سلسلة بدائل إجبارية" (Phase 1 Data Sources Cleanup):
    1. TradingView (REST, NO Playwright) → لو وقع أو رجع فاضي →
    2. EGKSCO (prices only, HTTP) → لو وقع أو رجع فاضي →
    3. (dead-end) → إنذار تليجرام + وقف الـ Sync.

  تم حذف EGXPilot + Yahoo من سلسلة EGX (AGILE-PHASE1-034):
    - EGXPilot: المصدر ميت (ما بيرجّعش داتا fresh).
    - Yahoo: بيجيب بيانات أمس، مش اليوم (stale).
  الدوال `_try_egxpilot()` و `_try_yahoo()` لسه معرّفين للتوافق مع أي كود قديم،
  بس الـ fetch_egx_stocks_with_fallback() ما بيستدعيهومش.

الـ Documentation المرجعي:
  - HOW_WE_ANALYZE_AND_PREDICT.md §18 — Fallback Chain (TV REST → EGKSCO)

القواعد الصارمة:
  1. لو مصدر واحد وقع، الكود يكمل للمصدر التاني بدون ما يـ crash.
  2. لو المصدر رجع داتا فاضية []، الكود يعتبرها "فشل" ويروح للمصدر التالي.
  3. لو كل المصادر وقعت، الـ Sync يتوقف فوراً عشان نحافظ على الأسعار القديمة.

الـ thresholds:
  - TradingView REST: >= 50 سهم للنجاح.
  - EGKSCO: >= 30 سهم للنجاح.

الاستخدام من main.py:
    from fallback_chain import fetch_egx_stocks_with_fallback
    stocks, source = fetch_egx_stocks_with_fallback()
    if not stocks:
        send_telegram_alert("🚨 محرك البيانات وقف! كل مصادر الأسعار فشلت.")
    else:
        save_to_db(stocks)

@author M2y Platform
@version 2.0.0 — يوليو 2026 (Phase 1 Data Sources Cleanup: TV REST → EGKSCO)
"""
from __future__ import annotations

import os
import sys
import json
import logging
import asyncio
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple

# Make sure scrapers dir is importable
_THIS_DIR = Path(__file__).resolve().parent  # data_engine/scrapers/
_DATA_ENGINE_DIR = _THIS_DIR.parent
_PROJECT_ROOT = _DATA_ENGINE_DIR.parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

# ─── Phase 4 Task 1: Circuit Breaker integration ───────────────────────────
# حمّل الـ CircuitBreaker من vps-service/core/circuit_breaker.py. لو مش متاح
# (بيئة قديمة)، الـ fallback chain بتفضل شغّالة من غير circuit breaker.
# الـ circuit breaker بيمنع الـ retry storm لما مصدر بيانات يقع — بدل ما
# كل tick يفتح HTTP request لمصدر ميت، الـ circuit بيفتح (Open) ويرفض
# الطلب فوراً (Fail Fast) لمدة 5 دقايق.
_VPS_SERVICE_DIR = _PROJECT_ROOT / 'vps-service'
if str(_VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_VPS_SERVICE_DIR))

try:
    from core.circuit_breaker import (  # type: ignore
        circuit_registry as _circuit_registry,
        CircuitOpenError as _CircuitOpenError,
    )
    _HAS_CIRCUIT_BREAKER = True
except ImportError as _cb_err:
    _HAS_CIRCUIT_BREAKER = False
    _circuit_registry = None  # type: ignore
    _CircuitOpenError = None  # type: ignore
    # logger not defined yet — use print (will be replaced once logger is set up)
    print(f"[FallbackChain] CircuitBreaker not available — "
          f"running without Fail-Fast protection: {_cb_err}")

# Database path
DB_FILE = str(_PROJECT_ROOT / 'db' / 'data_engine.db')

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter('[%(asctime)s] [%(levelname)s] [FallbackChain] %(message)s', datefmt='%H:%M:%S'))
    logger.addHandler(_h)


def log(msg: str, level: str = 'info') -> None:
    """Compat log function."""
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}")
    getattr(logger, level.lower(), logger.info)(msg)


# ============================================================================
# Source adapters — each returns (stocks_list, status_message)
# ============================================================================

def _try_tradingview() -> Tuple[List[Dict], str]:
    """
    المحاولة الأولى: TradingView Scanner Live (NO Playwright).
    - بنستخدم الـ unified scanner engine (tradingview_scanner_live.py).
    - خفيف وسريع (~1-3 ثواني) بدل ما كان Playwright بـ 60-120 ثانية.
    - بيجيب 60 حقل (value_traded, relative_volume_10d, fundamentals, technicals).
    - الـ fetcher بيحفظ في stocks.db بنفسه كمان (via save_to_db).

    SCANNER-LIVE-2 (2026-10-27): tradingview_scanner_live هو المصدر الأساسي.
    tradingview_rest بقا كـ fallback لو الـ unified engine فشل.
    """
    log("📡 [1/2] محاولة TradingView Scanner Live (unified, no Playwright)...", 'info')
    try:
        from tradingview_scanner_live import fetch_market, save_to_db
        # Fetch egypt only (fallback_chain is EGX-focused per docstring)
        rows, elapsed = fetch_market('egypt')
        if rows:
            # Save to stocks.db (unified schema)
            db_path = Path(__file__).parent.parent.parent / 'db' / 'stocks.db'
            db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(db_path))
            from tradingview_scanner_live import _ensure_schema
            _ensure_schema(conn)
            saved = save_to_db(conn, rows)
            conn.close()
            log(f"  ✅ Scanner Live: {len(rows)} stocks in {elapsed:.0f}ms (saved {saved})", 'info')
            # Return in the unified dict shape expected by callers
            return rows, f"TradingView Scanner Live: {len(rows)} stocks"
        return [], "TradingView Scanner Live: 0 rows returned"
    except ImportError as e:
        log(f"  ⚠️ Scanner Live ImportError, falling back to REST: {e}", 'warning')
        # Fallback to the older REST module
        try:
            from tradingview_rest import fetch_tradingview_stocks
            return fetch_tradingview_stocks(market='egypt')
        except ImportError as e2:
            return [], f"TradingView (scanner+rest): ImportError - {e2}"
        except Exception as e2:
            return [], f"TradingView REST fallback: خطأ غير متوقع {str(e2)[:100]}"
    except Exception as e:
        log(f"  ⚠️ Scanner Live error, falling back to REST: {e}", 'warning')
        try:
            from tradingview_rest import fetch_tradingview_stocks
            return fetch_tradingview_stocks(market='egypt')
        except Exception as e2:
            return [], f"TradingView Scanner Live: خطأ غير متوقع {str(e)[:100]}, REST fallback: {e2}"


def _try_egksco() -> Tuple[List[Dict], str]:
    """المحاولة الثانية: EGKSCO (prices only, HTTP، سريع)."""
    log("📡 [2/2] محاولة EGKSCO scraper (prices only)...", 'info')
    try:
        from egksco_scraper import fetch_egksco_stocks
        return fetch_egksco_stocks()
    except ImportError as e:
        return [], f"EGKSCO: ImportError - {e}"
    except Exception as e:
        return [], f"EGKSCO: خطأ غير متوقع {str(e)[:100]}"


# ---------------------------------------------------------------------------
# DEPRECATED (AGILE-PHASE1-034) — kept for backward compat, NOT called in the
# Egypt fallback chain. EGXPilot is dead; Yahoo returns yesterday's data.
# ---------------------------------------------------------------------------

def _try_egxpilot() -> Tuple[List[Dict], str]:
    """DEPRECATED: EGXPilot (HTTP) — المصدر ميت. محتفظين بالدالة للتوافق فقط.
    DATA-ENGINE-UNIFY-1 Stage 1: egxpilot_scraper.py اتـ archive لـ archive/garage/.
    الدالة دي بقت no-op — بترجّع empty من غير ما تـ import."""
    log("⚠️ EGXPilot deprecated in Phase 1 (dead source, scraper archived).", 'warning')
    return [], "EGXPilot: deprecated + scraper archived (DATA-ENGINE-UNIFY-1 Stage 1)"


def _try_yahoo() -> Tuple[List[Dict], str]:
    """DEPRECATED: Yahoo Finance — بيرجّع بيانات أمس. محتفظين بالدالة للتوافق فقط.
    DATA-ENGINE-UNIFY-1 Stage 1: yahoo_scraper.py اتـ archive لـ archive/garage/.
    الدالة دي بقت no-op — بترجّع empty من غير ما تـ import."""
    log("⚠️ Yahoo deprecated in Phase 1 (returns yesterday's data, scraper archived).", 'warning')
    return [], "Yahoo: deprecated + scraper archived (DATA-ENGINE-UNIFY-1 Stage 1)"


# ============================================================================
# DB read helper (TV scraper writes directly)
# ============================================================================

def _read_stocks_from_data_engine_db(source_label: str) -> Tuple[List[Dict], str]:
    """قراءة الأسهم من data_engine.db بعد ما الـ TV scraper يحفظهم."""
    try:
        if not os.path.exists(DB_FILE):
            return [], f"{source_label}: data_engine.db غير موجود بعد الـ scrape"

        conn = sqlite3.connect(DB_FILE, timeout=15.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # نقرأ آخر تحديث خلال آخر 10 دقائق (عشان نتأكد إنهfresh)
        cur.execute("""
            SELECT symbol, name, price, change_percent, volume, market_cap, sector, market, tabs_data
            FROM stocks
            WHERE last_update IS NOT NULL
              AND datetime(last_update) >= datetime('now', '-10 minutes')
            ORDER BY last_update DESC
        """)
        rows = cur.fetchall()
        conn.close()

        if not rows:
            return [], f"{source_label}: لا يوجد أسعار حديثة في data_engine.db"

        stocks = []
        for r in rows:
            try:
                tabs = json.loads(r['tabs_data']) if r['tabs_data'] else {}
            except Exception:
                tabs = {}
            stocks.append({
                'symbol': r['symbol'],
                'name': r['name'],
                'price': float(r['price'] or 0),
                'change_percent': float(r['change_percent'] or 0),
                'volume': r['volume'] or '',
                'market_cap': r['market_cap'] or '',
                'sector': r['sector'] or '',
                'tabs_data': tabs,
            })

        if len(stocks) < 50:
            return [], f"{source_label}: بيانات غير كافية ({len(stocks)} سهم فقط)"

        log(f"✅ {source_label}: تم استلام {len(stocks)} سهم", 'info')
        return stocks, 'success'
    except Exception as e:
        return [], f"{source_label}: خطأ قراءة من DB - {str(e)[:100]}"


# ============================================================================
# Telegram alert (best-effort, no crash if it fails)
# ============================================================================

def send_telegram_alert(message: str) -> bool:
    """
    إرسال إنذار تليجرام للأدمن. Best-effort: لو فشل، مفيش crash.

    يحتاج env vars:
      - TELEGRAM_BOT_TOKEN
      - TELEGRAM_ADMIN_CHAT_ID
    """
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = os.environ.get('TELEGRAM_ADMIN_CHAT_ID')
    if not token or not chat_id:
        log("⚠️ TELEGRAM_BOT_TOKEN أو TELEGRAM_ADMIN_CHAT_ID غير مضبوطين — الإنذار لم يُرسل", 'warning')
        return False

    try:
        import urllib.request
        import urllib.parse
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = urllib.parse.urlencode({
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML',
        }).encode('utf-8')
        req = urllib.request.Request(url, data=data, method='POST')
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        log(f"⚠️ فشل إرسال إنذار التليجرام: {e}", 'warning')
        return False


# ============================================================================
# Main orchestrator
# ============================================================================

def fetch_egx_stocks_with_fallback(
    skip_tradingview: bool = False,
) -> Tuple[List[Dict], str, List[str]]:
    """
    سلسلة البدائل الإجباري لجلب أسعار أسهم EGX (Phase 1 Data Sources Cleanup).

    الترتيب الجديد:
      1. TradingView (REST, no Playwright) — threshold >= 50 سهم.
      2. EGKSCO (prices only, HTTP) — threshold >= 30 سهم.
      3. (dead-end) → إنذار تليجرام + وقف الـ Sync.

    ملاحظة: EGXPilot + Yahoo اتشالوا من السلسلة (EGXPilot ميت، Yahoo بيرجّع أمس).
    الدوال `_try_egxpilot()` و `_try_yahoo()` لسه معرّفين للتوافق، بس ما بنستدعيهومش.

    Phase 4 Task 1 (Resilience & Observability):
      كل مصدر بيمرّ عبر CircuitBreaker. لو المصدر فشل 5 مرات ورا بعض، الـ circuit
      بيفتح (OPEN) لمدة 5 دقايق، واي طلب في الخمس دقايق دول بيترفض فوراً (Fail
      Fast) من غير HTTP request. ده بيوفر CPU ويمنع الـ retry storm.

    Args:
        skip_tradingview: لو True، يبدأ من EGKSCO مباشرة (مفيد للـ testing).

    Returns:
        Tuple[List[Dict], str, List[str]]:
        - stocks_list: قائمة الأسهم (فاضي لو كل المصادر فشلت).
        - source_used: اسم المصدر الناجح ('tradingview' | 'egksco' | 'none').
        - failure_log: قائمة بأسباب فشل كل مصدر (للـ logs والأدمن).
    """
    failure_log: List[str] = []

    # 1) TradingView REST (no Playwright)
    if not skip_tradingview:
        # ─── Phase 4 Task 1: Circuit Breaker Fail-Fast ──────────────────
        # لو الـ circuit بتاع TradingView مفتوح (5 فشل ورا بعض)، نتخطّى
        # المصدر ده فوراً بدون HTTP request (CPU saving + fast response).
        if _HAS_CIRCUIT_BREAKER:
            cb_tv = _circuit_registry.get('tradingview')
            if cb_tv.is_open():
                retry_after = cb_tv.retry_after_seconds()
                msg = (
                    f"⚠️ TradingView circuit OPEN — Fail Fast "
                    f"(retry in {retry_after:.0f}s, "
                    f"failures={cb_tv.get_status()['consecutive_failures']})"
                )
                log(msg, 'warning')
                failure_log.append(msg)
                cb_tv.record_rejected()
            else:
                stocks, status = _try_tradingview()
                if stocks and len(stocks) >= 50:
                    cb_tv.record_success()
                    log(f"🎯 المصدر الناجح: TradingView REST ({len(stocks)} سهم)")
                    return stocks, 'tradingview', failure_log
                else:
                    cb_tv.record_failure()
                    msg = f"⚠️ TradingView REST فشل: {status}"
                    log(msg, 'warning')
                    failure_log.append(msg)
                    log("🔄 التحويل لـ EGKSCO...", 'info')
        else:
            # No circuit breaker — legacy path
            stocks, status = _try_tradingview()
            if stocks and len(stocks) >= 50:
                log(f"🎯 المصدر الناجح: TradingView REST ({len(stocks)} سهم)")
                return stocks, 'tradingview', failure_log
            else:
                msg = f"⚠️ TradingView REST فشل: {status}"
                log(msg, 'warning')
                failure_log.append(msg)
                log("🔄 التحويل لـ EGKSCO...", 'info')

    # 2) EGKSCO (prices only)
    if _HAS_CIRCUIT_BREAKER:
        cb_eg = _circuit_registry.get('egksco')
        if cb_eg.is_open():
            retry_after = cb_eg.retry_after_seconds()
            msg = (
                f"⚠️ EGKSCO circuit OPEN — Fail Fast "
                f"(retry in {retry_after:.0f}s, "
                f"failures={cb_eg.get_status()['consecutive_failures']})"
            )
            log(msg, 'warning')
            failure_log.append(msg)
            cb_eg.record_rejected()
            stocks, status = [], 'circuit_open'
        else:
            stocks, status = _try_egksco()
            if stocks and len(stocks) >= 30:
                cb_eg.record_success()
                log(f"🎯 المصدر الناجح: EGKSCO ({len(stocks)} سهم)")
                return stocks, 'egksco', failure_log
            else:
                cb_eg.record_failure()
                msg = f"⚠️ EGKSCO فشل: {status}"
                log(msg, 'warning')
                failure_log.append(msg)
    else:
        stocks, status = _try_egksco()
        if stocks and len(stocks) >= 30:  # EGKSCO smaller threshold
            log(f"🎯 المصدر الناجح: EGKSCO ({len(stocks)} سهم)")
            return stocks, 'egksco', failure_log
        else:
            msg = f"⚠️ EGKSCO فشل: {status}"
            log(msg, 'warning')
            failure_log.append(msg)

    # 🚨 كل المصادر وقعت — dead-end (إنذار تليجرام بيتعمل في run_fallback_chain_and_sync)
    log("🚨 FATAL: كل مصادر الأسعار فشلت! (TV REST + EGKSCO)", 'error')
    return [], 'none', failure_log


def run_fallback_chain_and_sync(skip_tradingview: bool = False) -> Dict:
    """
    تنفيذ الـ fallback chain + حفظ النتيجة في data_engine.db + إرجاع summary.

    Returns:
        Dict: {success, source, stocks_count, market, message, failures, telegram_alert_sent}
    """
    stocks, source_used, failures = fetch_egx_stocks_with_fallback(
        skip_tradingview=skip_tradingview
    )

    if not stocks:
        # كل المصادر فشلت — أوقف الـ Sync + ابعت إنذار
        alert_msg = (
            "🚨 <b>محرك البيانات وقف!</b>\n\n"
            "كل مصادر الأسعار فشلت (Phase 1 chain: TV REST → EGKSCO):\n"
            + "\n".join(f"• {f}" for f in failures)
            + "\n\n<b>الـ Sync متوقف</b> للحفاظ على الأسعار القديمة.\n"
            f"Timestamp: {datetime.now().isoformat()}"
        )
        alert_sent = send_telegram_alert(alert_msg)
        return {
            'success': False,
            'source': 'none',
            'stocks_count': 0,
            'market': 'EGX',
            'message': 'كل مصادر الأسعار فشلت — الـ Sync متوقف',
            'failures': failures,
            'telegram_alert_sent': alert_sent,
        }

    # مصدر واحد على الأقل نجح — احفظ في DB
    # TV REST + EGKSCO كلاهما عندهم save_to_db بنفس الـ signature.
    saved = 0
    if source_used == 'egksco':
        try:
            from egksco_scraper import save_to_db as _save
            saved = _save(stocks, market='مصر')
        except Exception as e:
            log(f"⚠️ فشل حفظ أسهم EGKSCO في DB: {e}", 'warning')
            saved = 0
    elif source_used == 'tradingview':
        # TV REST fetcher بيرجّع الـ stocks لكن ما بيحفظش تلقائياً — احفظه هنا.
        try:
            from tradingview_rest import save_to_db as _save
            saved = _save(stocks, market='مصر')
        except Exception as e:
            log(f"⚠️ فشل حفظ أسهم TradingView REST في DB: {e}", 'warning')
            saved = 0
    else:
        # fallback نادر (مثلاً sourceUsed قديم مثل 'egxpilot'/'yahoo' لو اتنادا يدوي)
        saved = len(stocks)

    return {
        'success': True,
        'source': source_used,
        'stocks_count': saved,
        'market': 'EGX',
        'message': f'تم حفظ {saved} سهم من {source_used}',
        'failures': failures,
        'telegram_alert_sent': False,
    }


# ============================================================================
# CLI Entry
# ============================================================================

def main() -> int:
    """CLI entry — يرجع 0 على النجاح، 1 على الفشل الكامل."""
    log("=" * 60)
    log("🛡️ Fallback Chain — EGX Stocks Data Sources Orchestrator (Phase 1)")
    log("Sources: TradingView REST → EGKSCO (prices only)")
    log("=" * 60)

    # Skip TradingView if SKIP_TV env is set (faster testing)
    skip_tv = os.environ.get('SKIP_TV', '').lower() in ('1', 'true', 'yes')
    result = run_fallback_chain_and_sync(skip_tradingview=skip_tv)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
