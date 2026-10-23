#!/usr/bin/env python3
"""
liquidity_alerts.py — تنبيهات تدفق السيولة للتليجرام (2026-10-07)
=================================================================
أربعة أنواع تنبيهات بتُتبع للقناة (Owner directive — TELEGRAM-LIQUIDITY-EXPLORE):

  1. Sector liquidity flow IN  — "🟢 السيولة بتدخل قطاع كذا"
     المصدر:  FlowSystemEngine.detect_sector_rotation().entering[]
  2. Sector liquidity flow OUT — "🔴 السيولة بتهرب من قطاع كذا"
     المصدر:  FlowSystemEngine.detect_sector_rotation().leaving[]
  3. Stock accumulation        — "🐋 السهم بيجمع سيولة مؤسسية"
     المصدر:  scripts/output/maker_radar_EGX_*.json
     التريجر: money_flow_state ∈ {'🟢 سيولة داخلة قوية', '🟢 سيولة داخلة'}
              (legacy: {'🔥 دخول قوي', '🟢 سيولة داخلة'})
              AND path ∈ {'A_pre_surge', 'B_quiet_accumulation_strong'}
  4. Stock distribution        — "⚠️ السهم فيه خروج سيولة"
     المصدر:  scripts/output/maker_radar_EGX_*.json + scripts/output/exit_radar_*.json
     التريجر: money_flow_state ∈ {'🔴 سيولة خارجة قوية', '🔴 سيولة خارجة'}
              (legacy: {'🔥 خروج قوي', '🔴 سيولة خارجة'})
              OR exit_radar.path == 'X1_distribution_strong'

Design rules:
  - يستخدم الـ SEND infrastructure الموجود في telegram_notifier.py
    (لا يفتح HTTP client جديد — `TelegramNotifier._send()` هو الـ canonical outbound).
  - كل التنبيهات dedupe per day per entity عن طريق state file:
      db/liquidity_alerts_state.json
    Structure:
      {
        "2026-10-07": {
          "sector_in":          {"Finance": true, "Real Estate": true},
          "sector_out":         {"Technology": true},
          "stock_accumulation": {"AMOC": true, "COMI": true},
          "stock_distribution": {"EKRS": true}
        }
      }
    At end of day the file is auto-cleaned: only today's bucket is kept.
  - Safe-by-design: كل call خارجي ملفوف try/except — مايوقعش الـ caller أبداً.
    لو الـ radar JSON مش موجود أو FlowSystem بيوقع، بسكّت ويرجع 0.
  - No fake data: مايبعتش تنبيه غير مبني على JSON / rotation فعلية.

Hook points:
  - vps-service/jobs/intraday_scanner.py  → run_liquidity_alerts() كل 5 دقايق
  - scripts/telegram_comprehensive_report.py → build_liquidity_digest() يومي 14:30 UTC

Usage:
    from telegram.liquidity_alerts import run_liquidity_alerts, build_liquidity_digest
    run_liquidity_alerts()                    # كل 5 دقايق
    digest_lines = build_liquidity_digest()   # لتقرير 14:30 UTC
"""

from __future__ import annotations
import os
import sys
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
# This module lives at: <project>/vps-service/telegram/liquidity_alerts.py
#   parents[0] = telegram/
#   parents[1] = vps-service/
#   parents[2] = <project>/     ← project root (where db/ + scripts/ live)
_VPS_SERVICE_ROOT = Path(__file__).resolve().parents[1]
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

if str(_VPS_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_SERVICE_ROOT))

# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Single source of truth for money_flow classification.
try:
    from utils.canonical_signal import classify_money_flow
except ImportError:  # pragma: no cover - fallback if utils not on path
    def classify_money_flow(_b, _s, _n=None):  # type: ignore[no-redef]
        return '🟡 سيولة متوازنة'

_DB_DIR = _PROJECT_ROOT / 'db'
_RADAR_OUTPUT_DIR = _PROJECT_ROOT / 'scripts' / 'output'
_STATE_FILE = _DB_DIR / 'liquidity_alerts_state.json'

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Trigger thresholds (per owner directive)
# CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
# Migrated from legacy labels {'🔥 دخول قوي', '🟢 سيولة داخلة'} to the
# canonical 5-level taxonomy produced by classify_money_flow().
# Legacy '🔥 دخول قوي' is now '🟢 سيولة داخلة قوية';
# Legacy '🔥 خروج قوي' is now '🔴 سيولة خارجة قوية'.
# ---------------------------------------------------------------------------
ACCUMULATION_MONEY_FLOW_STATES = {'🟢 سيولة داخلة قوية', '🟢 سيولة داخلة'}
ACCUMULATION_PATHS = {'A_pre_surge', 'B_quiet_accumulation_strong'}

DISTRIBUTION_MONEY_FLOW_STATES = {'🔴 سيولة خارجة قوية', '🔴 سيولة خارجة'}
DISTRIBUTION_EXIT_PATHS = {'X1_distribution_strong'}

# Legacy → canonical money_flow_state label map (radar JSON files older than
# the canonical migration still emit the legacy strings).
_LEGACY_MFS_TO_CANONICAL: Dict[str, str] = {
    '🔥 دخول قوي':  '🟢 سيولة داخلة قوية',
    '🟢 سيولة داخلة': '🟢 سيولة داخلة',
    '🟡 سيولة متوازنة': '🟡 سيولة متوازنة',
    '🔴 سيولة خارجة': '🔴 سيولة خارجة',
    '🔥 خروج قوي':  '🔴 سيولة خارجة قوية',
}


def _canonical_money_flow_state(stock: Dict) -> str:
    """CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
    Prefer computing money_flow_state from buy_pct/sell_pct via canonical
    classifier. Fall back to mapping the legacy upstream label to canonical
    when numeric inputs are unavailable. Returns '🟡 سيولة متوازنة' if no
    signal can be derived (Rule 27: not fabricated as 'inflow').
    """
    buy_pct = stock.get('buy_pct')
    sell_pct = stock.get('sell_pct')
    if buy_pct is not None and sell_pct is not None:
        try:
            return classify_money_flow(float(buy_pct), float(sell_pct))
        except (TypeError, ValueError):
            pass
    legacy = stock.get('money_flow_state') or ''
    return _LEGACY_MFS_TO_CANONICAL.get(legacy, legacy or '🟡 سيولة متوازنة')

# Arabic labels for radar paths (mirrors scripts/telegram_comprehensive_report.py
# and src/lib/schedulers/radar-alerts.ts PATH_SHORT_AR).
PATH_LABEL_AR: Dict[str, str] = {
    'A_pre_surge': 'Pre-Surge 🚀',
    'B_quiet_accumulation_strong': 'تجميع قوي 🎯',
    'C_quiet_accumulation_weak': 'تجميع ضعيف',
    'A_quiet_accumulation': 'تجميع هادي',
    'D_explosive_surge': 'انفجار 🔥',
    'B_explosive_surge': 'انفجار 🔥',
    'E_early_break': 'اختراق ⚡',
    'C_early_break': 'اختراق مبكر ⚡',
    'X1_distribution_strong': 'توزيع قوي 🚫',
    'X2_volume_divergence': 'تباين حجمي',
    'X3_resistance_rejection': 'رفض من المقاومة',
    'X4_exhaustion_gap': 'فجوة إرهاق',
    'X5_kill_switch_triggered': 'Kill Switch 🛑',
}


# ===========================================================================
# Helpers — money formatting
# ===========================================================================

def _fmt_money(n: Any) -> str:
    """Compact money formatter (K/M/B). Returns '—' on None; '0' on 0/empty."""
    if n is None:
        return '—'
    try:
        n = float(n)
    except (ValueError, TypeError):
        return '—'
    if abs(n) >= 1e9:
        return f"{n/1e9:.1f}B"
    if abs(n) >= 1e6:
        return f"{n/1e6:.1f}M"
    if abs(n) >= 1e3:
        return f"{n/1e3:.0f}K"
    return f"{n:.0f}"


def _today_str() -> str:
    return datetime.now().strftime('%Y-%m-%d')


def _now_str() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M')


# ===========================================================================
# STATE MANAGEMENT — per-day dedupe (db/liquidity_alerts_state.json)
# ===========================================================================

def _load_state() -> Dict:
    """Load dedupe state. Returns {} on any error (defensive)."""
    try:
        if not _STATE_FILE.exists():
            return {}
        with open(_STATE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f) or {}
    except Exception as e:
        logger.warning(f"liquidity_state load failed: {e}")
        return {}


def _save_state(state: Dict) -> None:
    """Persist state. Auto-cleans: keeps only today's bucket (drops stale days)."""
    try:
        _DB_DIR.mkdir(parents=True, exist_ok=True)
        today = _today_str()
        cleaned = {k: v for k, v in state.items() if k == today}
        with open(_STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cleaned, f, ensure_ascii=False, indent=2, default=str)
    except Exception as e:
        logger.warning(f"liquidity_state save failed: {e}")


def _should_send_alert(alert_key: str) -> bool:
    """Return True if this alert_key hasn't been sent today.

    alert_key format: '<bucket>::<entity_id>'
        e.g. 'sector_in::Finance', 'stock_accumulation::COMI'
    """
    today = _today_str()
    state = _load_state()
    today_state = state.get(today, {})
    try:
        bucket, entity_id = alert_key.split('::', 1)
    except ValueError:
        bucket, entity_id = 'misc', alert_key
    sent_set = today_state.get(bucket, {})
    return entity_id not in sent_set


def _mark_alert_sent(alert_key: str) -> None:
    """Mark an alert as sent today so it won't fire again."""
    today = _today_str()
    state = _load_state()
    today_state = state.setdefault(today, {})
    try:
        bucket, entity_id = alert_key.split('::', 1)
    except ValueError:
        bucket, entity_id = 'misc', alert_key
    today_state.setdefault(bucket, {})[entity_id] = True
    _save_state(state)


# ===========================================================================
# DATA READERS — radar JSON + FlowSystemEngine + stocks.db lookups
# ===========================================================================

def _read_latest_radar(prefix: str) -> Optional[Dict]:
    """Find newest JSON file matching `prefix` (e.g. 'maker_radar_EGX_')
    in scripts/output/, parse it, return dict. None on missing/parse-fail.
    """
    try:
        if not _RADAR_OUTPUT_DIR.exists():
            return None
        files = sorted(
            [f for f in os.listdir(_RADAR_OUTPUT_DIR)
             if f.startswith(prefix) and f.endswith('.json')],
            reverse=True,
        )
        if not files:
            return None
        with open(_RADAR_OUTPUT_DIR / files[0], 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"read radar {prefix}* failed: {e}")
        return None


def _get_rotation_data() -> Optional[Dict]:
    """Call FlowSystemEngine.detect_sector_rotation(). None on failure."""
    try:
        from engine.flow_system import FlowSystemEngine
        engine = FlowSystemEngine()
        return engine.detect_sector_rotation()
    except Exception as e:
        logger.warning(f"FlowSystemEngine.detect_sector_rotation failed: {e}")
        return None


def _fetch_stock_meta(ticker: str) -> Dict[str, Any]:
    """Lookup name_ar + sector for a ticker from db/stocks.db.
    Returns {'name_ar': ticker, 'sector': None} on miss/error.
    """
    out = {'name_ar': ticker, 'sector': None}
    try:
        stocks_db = _DB_DIR / 'stocks.db'
        if not stocks_db.exists():
            return out
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(stocks_db), writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT name_ar, sector FROM stocks WHERE ticker = ? LIMIT 1",
            (ticker,),
        ).fetchone()
        conn.close()
        if row:
            if row['name_ar']:
                out['name_ar'] = row['name_ar']
            if row['sector']:
                out['sector'] = row['sector']
    except Exception:
        pass
    return out


def _extract_radar_candidates(radar_data: Optional[Dict]) -> List[Dict]:
    """Pull per-stock records from a maker_radar JSON.
    Prefers `all_results` (most complete); falls back to concatenation of
    under_microscope + quiet_list + pre_surge_list + explosive_list + early_break_list.
    """
    if not radar_data:
        return []
    if radar_data.get('all_results'):
        return radar_data['all_results']
    out: List[Dict] = []
    for key in ('under_microscope', 'pre_surge_list', 'quiet_list',
                'explosive_list', 'early_break_list'):
        out.extend(radar_data.get(key, []) or [])
    return out


# ===========================================================================
# NOTIFIER access — reuse TelegramNotifier (HTTP Bot API, canonical outbound)
# ===========================================================================

def _get_notifier():
    """Lazy TelegramNotifier init. Returns None if env vars not set / import fails."""
    try:
        from telegram.telegram_notifier import TelegramNotifier
        return TelegramNotifier()
    except Exception as e:
        logger.warning(f"TelegramNotifier init failed: {e}")
        return None


# ===========================================================================
# MESSAGE FORMATTERS — Arabic + HTML (match telegram_notifier.py style)
# ===========================================================================

def _format_sector_alert(direction: str, entry: Dict) -> str:
    """Build Arabic HTML message for sector liquidity alert.
    direction = 'in' or 'out'.
    entry     = one item from rotation_data['entering'] or rotation_data['leaving'].
    """
    sector = entry.get('sector', '???')
    avg_change = entry.get('avg_change', 0) or 0
    current_turnover = entry.get('current_turnover', 0) or 0
    turnover_pct = entry.get('turnover_vs_avg_pct', 0) or 0

    if direction == 'in':
        days = entry.get('rising_days', 0)
        days_label = f"📈 {days} أيام متتالية صعود"
        sign = '+' if turnover_pct >= 0 else ''
        emoji = '🟢'
        title = "تنبيه: السيولة بتدخل قطاع"
        action = ("السيولة بـ accumulate في القطاع ده — "
                  "ممكن نلاقي فرص شراء فيه قريب.")
    else:
        days = entry.get('falling_days', 0)
        days_label = f"📉 {days} أيام متتالية هبوط"
        sign = ''
        emoji = '🔴'
        title = "تنبيه: السيولة بتهرب من قطاع"
        action = ("السيولة بتبعد عن القطاع ده — "
                  "خد بالك لو معاك أسهم فيه، راجع الـ stops.")

    msg = f"""{emoji} <b>{title}</b>

📊 القطاع: <b>{sector}</b>
{days_label}
💰 Turnover: <b>{sign}{turnover_pct:.0f}%</b> عن المتوسط
📉 متوسط التغير: <b>{avg_change:+.2f}%</b>
💧 Turnover اليوم: {_fmt_money(current_turnover)} ج.م

💡 {action}
⏰ {_now_str()}"""
    return msg


def _format_stock_accumulation(stock: Dict, name_ar: str) -> str:
    """Build Arabic HTML message for stock accumulation alert."""
    ticker = stock.get('ticker', '???')
    price = float(stock.get('current_price', 0) or 0)
    path = stock.get('path', '') or ''
    path_ar = PATH_LABEL_AR.get(path, path or '—')
    # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
    money_flow_state = _canonical_money_flow_state(stock)
    if money_flow_state == '🟡 سيولة متوازنة' and not stock.get('money_flow_state'):
        money_flow_state = '—'  # display placeholder when no source signal
    turnover = stock.get('avg_turnover_20d', 0) or 0
    net_flow = float(stock.get('net_flow_egp', 0) or 0)
    buy_pct = float(stock.get('buy_pct', 0) or 0)

    # net_flow sign for display
    if net_flow >= 0:
        net_str = f"+{_fmt_money(net_flow)}"
    else:
        net_str = f"-{_fmt_money(abs(net_flow))}"

    msg = f"""🐋 <b>تنبيه: السهم {ticker} بيجمع سيولة مؤسسية</b>

🏦 {name_ar}
📊 السهم: <b>{ticker}</b>
💰 السعر: <b>{price:.2f}</b> ج.م
🛰️ رادار السيولة: <b>{path_ar}</b>
💧 تدفق السيولة: <b>{money_flow_state}</b>
📊 Turnover: {_fmt_money(turnover)} ج.م
💰 Net Flow: <b>{net_str}</b> ج.م ({buy_pct:.0f}% شراء)

💡 السهم تحت الميكروسكوب — تجميع قوي هادئ. خد بالك من حركة الإغلاق.
⏰ {_now_str()}"""
    return msg


def _format_stock_distribution(stock: Dict, name_ar: str,
                                exit_radar: Optional[Dict] = None) -> str:
    """Build Arabic HTML message for stock distribution WARNING alert."""
    ticker = stock.get('ticker', '???')
    price = float(stock.get('current_price', 0) or 0)
    # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
    money_flow_state = _canonical_money_flow_state(stock)
    if money_flow_state == '🟡 سيولة متوازنة' and not stock.get('money_flow_state'):
        money_flow_state = '—'  # display placeholder when no source signal
    kill_reason = stock.get('kill_reason')

    exit_path_str = ''
    if exit_radar:
        ex_path = exit_radar.get('path', '') or ''
        ex_path_ar = PATH_LABEL_AR.get(ex_path, ex_path or '—')
        ex_reason = exit_radar.get('reason', '') or ''
        exit_path_str = (f"\n🚫 Exit Radar: <b>{ex_path_ar}</b>"
                         + (f" — {ex_reason}" if ex_reason else ''))

    kill_str = f"\n🛑 Kill Reason: {kill_reason}" if kill_reason else ''

    msg = f"""⚠️ <b>تحذير: السهم {ticker} فيه خروج سيولة</b>

🏦 {name_ar}
📊 السهم: <b>{ticker}</b>
💰 السعر: <b>{price:.2f}</b> ج.م
🔴 تدفق السيولة: <b>{money_flow_state}</b>{exit_path_str}{kill_str}

💡 <b>خد بالك لو معاك السهم ده — فيه توزيع قوي / خروج سيولة. راجع الـ stop بتاعك.</b>
⏰ {_now_str()}"""
    return msg


# ===========================================================================
# ALERT FUNCTIONS — the 4 types (each deduped per day per entity)
# ===========================================================================

def notify_sector_liquidity_flow(rotation_data: Optional[Dict] = None) -> int:
    """Alert 1 + 2: Sector liquidity flow IN + OUT.
    Sends a Telegram message for each newly-entering / newly-leaving sector.
    Returns count of alerts sent.
    """
    if rotation_data is None:
        rotation_data = _get_rotation_data()
    if not rotation_data:
        return 0

    notifier = _get_notifier()
    if not notifier or not notifier.enabled:
        return 0

    sent_count = 0

    # Alert 1: SECTOR IN (entering)
    for entry in rotation_data.get('entering', []) or []:
        sector = entry.get('sector')
        if not sector:
            continue
        alert_key = f"sector_in::{sector}"
        if not _should_send_alert(alert_key):
            continue
        try:
            msg = _format_sector_alert('in', entry)
            if notifier._send(msg):
                _mark_alert_sent(alert_key)
                sent_count += 1
        except Exception as e:
            logger.warning(f"sector_in alert failed for {sector}: {e}")

    # Alert 2: SECTOR OUT (leaving)
    for entry in rotation_data.get('leaving', []) or []:
        sector = entry.get('sector')
        if not sector:
            continue
        alert_key = f"sector_out::{sector}"
        if not _should_send_alert(alert_key):
            continue
        try:
            msg = _format_sector_alert('out', entry)
            if notifier._send(msg):
                _mark_alert_sent(alert_key)
                sent_count += 1
        except Exception as e:
            logger.warning(f"sector_out alert failed for {sector}: {e}")

    return sent_count


def notify_stock_accumulation(radar_data: Optional[Dict] = None) -> int:
    """Alert 3: Stock accumulation.
    Trigger: money_flow_state ∈ {🔥 دخول قوي, 🟢 سيولة داخلة}
             AND path ∈ {A_pre_surge, B_quiet_accumulation_strong}
    Returns count of alerts sent.
    """
    if radar_data is None:
        radar_data = _read_latest_radar('maker_radar_EGX_')
    if not radar_data:
        return 0

    notifier = _get_notifier()
    if not notifier or not notifier.enabled:
        return 0

    candidates = _extract_radar_candidates(radar_data)
    sent_count = 0
    for stock in candidates:
        ticker = stock.get('ticker', '')
        if not ticker:
            continue
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — canonical label
        money_flow_state = _canonical_money_flow_state(stock)
        path = stock.get('path', '') or ''
        if (money_flow_state in ACCUMULATION_MONEY_FLOW_STATES
                and path in ACCUMULATION_PATHS):
            alert_key = f"stock_accumulation::{ticker}"
            if not _should_send_alert(alert_key):
                continue
            try:
                meta = _fetch_stock_meta(ticker)
                msg = _format_stock_accumulation(stock, meta['name_ar'])
                if notifier._send(msg, ticker=ticker):
                    _mark_alert_sent(alert_key)
                    sent_count += 1
            except Exception as e:
                logger.warning(f"stock_accumulation alert failed for {ticker}: {e}")

    return sent_count


def notify_stock_distribution(radar_data: Optional[Dict] = None,
                               exit_radar_data: Optional[Dict] = None) -> int:
    """Alert 4: Stock distribution (WARNING).
    Trigger:
      (a) money_flow_state ∈ {🔥 خروج قوي, 🔴 سيولة خارجة} in maker_radar
      (b) exit_radar.path == 'X1_distribution_strong' (independent of maker_radar)
    Returns count of alerts sent.
    """
    if radar_data is None:
        radar_data = _read_latest_radar('maker_radar_EGX_')
    if exit_radar_data is None:
        exit_radar_data = _read_latest_radar('exit_radar_')

    notifier = _get_notifier()
    if not notifier or not notifier.enabled:
        return 0

    # Build exit_radar ticker lookup for cross-referencing
    exit_radar_by_ticker: Dict[str, Dict] = {}
    if exit_radar_data:
        for er in exit_radar_data.get('exit_list', []) or []:
            t = er.get('ticker')
            if t:
                exit_radar_by_ticker[t] = er

    sent_count = 0
    distribution_tickers_seen: set = set()

    # (a) Stocks flagged in maker_radar with distribution money_flow_state
    for stock in _extract_radar_candidates(radar_data):
        ticker = stock.get('ticker', '')
        if not ticker:
            continue
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — canonical label
        money_flow_state = _canonical_money_flow_state(stock)
        if money_flow_state not in DISTRIBUTION_MONEY_FLOW_STATES:
            continue
        distribution_tickers_seen.add(ticker)
        alert_key = f"stock_distribution::{ticker}"
        if not _should_send_alert(alert_key):
            continue
        try:
            meta = _fetch_stock_meta(ticker)
            exit_entry = exit_radar_by_ticker.get(ticker)
            msg = _format_stock_distribution(stock, meta['name_ar'], exit_entry)
            if notifier._send(msg, ticker=ticker):
                _mark_alert_sent(alert_key)
                sent_count += 1
        except Exception as e:
            logger.warning(f"stock_distribution alert failed for {ticker}: {e}")

    # (b) Stocks flagged ONLY in exit_radar with X1_distribution_strong
    #     (that we didn't already alert for via maker_radar)
    for ticker, er in exit_radar_by_ticker.items():
        ex_path = er.get('path', '') or ''
        if ex_path not in DISTRIBUTION_EXIT_PATHS:
            continue
        if ticker in distribution_tickers_seen:
            continue  # already alerted via maker_radar
        alert_key = f"stock_distribution::{ticker}"
        if not _should_send_alert(alert_key):
            continue
        try:
            meta = _fetch_stock_meta(ticker)
            # Synthesize a "stock" dict from exit_radar entry so we can reuse
            # the same formatter (gives a consistent look across both paths).
            # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — canonical label
            # for synthetic exit_radar distribution record (no buy_pct available
            # so we mark it as the canonical distribution label).
            synthetic = {
                'ticker': ticker,
                'current_price': er.get('current_price', 0),
                'money_flow_state': '🔴 سيولة خارجة',
                'kill_reason': er.get('reason'),
            }
            msg = _format_stock_distribution(synthetic, meta['name_ar'], er)
            if notifier._send(msg, ticker=ticker):
                _mark_alert_sent(alert_key)
                sent_count += 1
        except Exception as e:
            logger.warning(f"stock_distribution (exit_radar) alert failed for {ticker}: {e}")

    return sent_count


# ===========================================================================
# MAIN ENTRY POINT — called by intraday_scanner.py every 5 min during market
# ===========================================================================

def run_liquidity_alerts() -> Dict[str, int]:
    """Run all 4 liquidity alert types in one pass.
    Returns summary: {'sector': N, 'accumulation': N, 'distribution': N, 'total': N}
    Safe-by-design — never raises; logs failures and continues.
    """
    summary = {'sector': 0, 'accumulation': 0, 'distribution': 0, 'total': 0}

    try:
        summary['sector'] = notify_sector_liquidity_flow()
    except Exception as e:
        logger.warning(f"notify_sector_liquidity_flow failed: {e}")

    radar_data = _read_latest_radar('maker_radar_EGX_')
    exit_radar_data = _read_latest_radar('exit_radar_')

    try:
        summary['accumulation'] = notify_stock_accumulation(radar_data)
    except Exception as e:
        logger.warning(f"notify_stock_accumulation failed: {e}")

    try:
        summary['distribution'] = notify_stock_distribution(radar_data, exit_radar_data)
    except Exception as e:
        logger.warning(f"notify_stock_distribution failed: {e}")

    summary['total'] = (
        summary['sector']
        + summary['accumulation']
        + summary['distribution']
    )
    if summary['total'] > 0:
        print(f"[LIQUIDITY-ALERTS] sent: {summary}", flush=True)
    return summary


# ===========================================================================
# DAILY DIGEST — used by scripts/telegram_comprehensive_report.py (14:30 UTC)
# ===========================================================================

def build_liquidity_digest(top_n: int = 3) -> List[str]:
    """Build a list of HTML lines summarising today's liquidity picture.
    Returns lines (no trailing newline) suitable for joining into a Telegram
    message. Empty list if no data available (caller should skip section).

    Sections:
      📊 ملخص السيولة بالقطاعات
        - Top N sectors with liquidity inflow (entering)
        - Top N sectors with liquidity outflow (leaving)
        - Top N stocks accumulating (money_flow_state + path A/B)
        - Top N stocks distributing (money_flow_state + exit_radar)
    """
    lines: List[str] = []
    has_any_data = False

    # ── Sector flow (rotation) ────────────────────────────────────────────
    rotation = _get_rotation_data()
    entering = (rotation or {}).get('entering', []) or []
    leaving = (rotation or {}).get('leaving', []) or []

    if entering or leaving:
        has_any_data = True
        lines.append("📊 <b>ملخص السيولة بالقطاعات</b>")
        lines.append("")

    if entering:
        lines.append(f"🟢 <b>أعلى {min(top_n, len(entering))} قطاعات سيولة داخلة</b>")
        for entry in entering[:top_n]:
            sector = entry.get('sector', '???')
            days = entry.get('rising_days', 0)
            pct = entry.get('turnover_vs_avg_pct', 0) or 0
            sign = '+' if pct >= 0 else ''
            lines.append(f"   • <b>{sector}</b> — {days} أيام صعود، turnover {sign}{pct:.0f}%")
        lines.append("")

    if leaving:
        lines.append(f"🔴 <b>أعلى {min(top_n, len(leaving))} قطاعات سيولة خارجة</b>")
        for entry in leaving[:top_n]:
            sector = entry.get('sector', '???')
            days = entry.get('falling_days', 0)
            pct = entry.get('turnover_vs_avg_pct', 0) or 0
            lines.append(f"   • <b>{sector}</b> — {days} أيام هبوط، turnover {pct:.0f}%")
        lines.append("")

    # ── Stock accumulation + distribution (from radar) ────────────────────
    radar_data = _read_latest_radar('maker_radar_EGX_')
    exit_radar_data = _read_latest_radar('exit_radar_')

    candidates = _extract_radar_candidates(radar_data)
    exit_radar_by_ticker: Dict[str, Dict] = {}
    if exit_radar_data:
        for er in exit_radar_data.get('exit_list', []) or []:
            t = er.get('ticker')
            if t:
                exit_radar_by_ticker[t] = er

    # Accumulation candidates
    accum_stocks: List[Dict] = []
    for s in candidates:
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — canonical label
        if (_canonical_money_flow_state(s) in ACCUMULATION_MONEY_FLOW_STATES
                and s.get('path', '') in ACCUMULATION_PATHS):
            accum_stocks.append(s)
    # Sort: stronger flow first (🟢 سيولة داخلة قوية > 🟢 سيولة داخلة), then by net_flow_egp desc
    state_rank = {'🟢 سيولة داخلة قوية': 2, '🟢 سيولة داخلة': 1}
    accum_stocks.sort(
        key=lambda s: (state_rank.get(_canonical_money_flow_state(s), 0),
                       float(s.get('net_flow_egp', 0) or 0)),
        reverse=True,
    )

    if accum_stocks:
        has_any_data = True
        lines.append(f"🐋 <b>أعلى {min(top_n, len(accum_stocks))} أسهم بتجمع سيولة</b>")
        for s in accum_stocks[:top_n]:
            ticker = s.get('ticker', '???')
            price = float(s.get('current_price', 0) or 0)
            mfs = _canonical_money_flow_state(s)  # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
            path = s.get('path', '') or ''
            path_ar = PATH_LABEL_AR.get(path, path or '—')
            net = float(s.get('net_flow_egp', 0) or 0)
            sign = '+' if net >= 0 else '-'
            lines.append(
                f"   • <b>{ticker}</b> — {price:.2f} ج.م | {mfs} | {path_ar} | Net {sign}{_fmt_money(abs(net))}"
            )
        lines.append("")

    # Distribution candidates (from radar + exit_radar cross-ref)
    dist_stocks: List[Dict] = []
    seen_tickers: set = set()
    for s in candidates:
        # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — canonical label
        if _canonical_money_flow_state(s) in DISTRIBUTION_MONEY_FLOW_STATES:
            t = s.get('ticker', '')
            if t and t not in seen_tickers:
                dist_stocks.append(s)
                seen_tickers.add(t)
    # Also include X1_distribution_strong from exit_radar that weren't in radar
    for t, er in exit_radar_by_ticker.items():
        if er.get('path', '') in DISTRIBUTION_EXIT_PATHS and t not in seen_tickers:
            dist_stocks.append({
                'ticker': t,
                'current_price': er.get('current_price', 0),
                # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67) — canonical label
                'money_flow_state': '🔴 سيولة خارجة',
                '_exit_path': er.get('path', ''),
                '_exit_reason': er.get('reason', ''),
            })
            seen_tickers.add(t)
    # Sort: stronger flow first (🔴 قوية > 🔴 خارجة), then by exit_radar presence
    dist_rank = {'🔴 سيولة خارجة قوية': 2, '🔴 سيولة خارجة': 1}
    dist_stocks.sort(
        key=lambda s: dist_rank.get(_canonical_money_flow_state(s), 0),
        reverse=True,
    )

    if dist_stocks:
        has_any_data = True
        lines.append(f"⚠️ <b>أعلى {min(top_n, len(dist_stocks))} أسهم فيها خروج سيولة</b>")
        for s in dist_stocks[:top_n]:
            ticker = s.get('ticker', '???')
            price = float(s.get('current_price', 0) or 0)
            mfs = _canonical_money_flow_state(s)  # CANONICAL-CALCULATIONS (Task PHASE-3, Rule 67)
            ex_path = (s.get('_exit_path')
                       or exit_radar_by_ticker.get(ticker, {}).get('path', ''))
            ex_path_ar = PATH_LABEL_AR.get(ex_path, ex_path) if ex_path else ''
            ex_str = f" | 🚫 {ex_path_ar}" if ex_path_ar else ''
            lines.append(
                f"   • <b>{ticker}</b> — {price:.2f} ج.م | {mfs}{ex_str}"
            )
        lines.append("")

    if not has_any_data:
        return []

    return lines


# ===========================================================================
# CLI for quick testing
# ===========================================================================

if __name__ == '__main__':
    import argparse
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s - %(levelname)s - %(message)s')
    p = argparse.ArgumentParser(description='Liquidity flow Telegram alerts (4 types)')
    p.add_argument('--dry-digest', action='store_true',
                   help='Print the daily digest lines without sending alerts')
    p.add_argument('--reset-state', action='store_true',
                   help='Clear today\'s dedupe state (next run will resend alerts)')
    args = p.parse_args()

    if args.reset_state:
        try:
            if _STATE_FILE.exists():
                _STATE_FILE.unlink()
                print(f"✅ Cleared state file: {_STATE_FILE}")
        except Exception as e:
            print(f"❌ Failed to clear state: {e}")

    if args.dry_digest:
        print("\n".join(build_liquidity_digest()))
    else:
        result = run_liquidity_alerts()
        print(f"\nDone. Summary: {result}")
