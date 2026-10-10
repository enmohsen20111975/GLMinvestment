#!/usr/bin/env python3
"""
weekly_radar_report.py — تقرير الرادار الأسبوعي
================================================================
Generates a weekly PDF + image report for subscribers, sent every Sunday.

Contents:
  1. Top 5 stocks for the upcoming week (from radar cache)
  2. Performance summary of last week's radar picks
  3. "Stock of the Week" — the highest-conviction pick with full analysis
  4. Market regime summary (DEFENSIVE/NORMAL/AGGRESSIVE)
  5. Sector heatmap summary

Output:
  - PDF:  scripts/output/weekly_radar_report_<date>.pdf
  - Image: scripts/output/weekly_radar_report_<date>.png (for Telegram)
  - JSON: scripts/output/weekly_radar_report_<date>.json (for API)

Usage:
  python3 scripts/weekly_radar_report.py
  python3 scripts/weekly_radar_report.py --market EGX
  python3 scripts/weekly_radar_report.py --dry-run  # print to stdout, no files
  python3 scripts/weekly_radar_report.py --json-only  # write JSON only, skip PDF/PNG
  python3 scripts/weekly_radar_report.py --send-telegram  # post to Telegram channel
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TRACKING_FILE = PROJECT_ROOT / "db" / "maker_radar_tracking.json"
FONTS_DIR = PROJECT_ROOT / "assets" / "fonts"
FONT_REG = FONTS_DIR / "NotoSansArabic.ttf"
FONT_BOLD = FONTS_DIR / "NotoSansArabic-Bold.ttf"

# Multi-market support — same DB discovery chain as maker_radar.py.
# Reused here so the weekly report works against every DB the project ships with.
DB_CANDIDATES = [
    ('db/data_engine.db', 'egksco_price_history', 'symbol', 'close_price', 'volume', 'turnover', 'price_date', 'open_price', 'high_price', 'low_price'),
    ('db/stocks.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
    ('db/data_engine.db', 'historical_data', 'symbol', 'close', 'volume', None, 'date', 'open', 'high', 'low'),
    ('db/production_snapshot.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
    ('db/vps_real/stocks.db', 'stock_daily_prices', 'ticker', 'close', 'volume', 'turnover', 'price_date', 'open', 'high', 'low'),
]

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
    'whatsapp': 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
}

PATH_LABELS_AR = {
    'A_pre_surge': 'Pre-Surge (تجميع مبكر جداً)',
    'B_quiet_accumulation_strong': 'تجميع قوي',
    'C_quiet_accumulation_weak': 'تجميع ضعيف',
    'D_explosive_surge': 'انفجار حجمي',
    'E_early_break': 'اختراق مبكر',
    'X1_distribution_strong': 'توزيع قوي',
    'X2_volume_divergence': 'تباعد حجمي',
    'X3_resistance_rejection': 'رفض عند مقاومة',
    'X4_exhaustion_gap': 'فجوة إرهاق',
    'X5_kill_switch_triggered': 'Kill Switch',
}

REGIME_LABELS_AR = {
    'DEFENSIVE': 'دِفاعي (شد اللجام)',
    'NORMAL': 'عادي',
    'AGGRESSIVE': 'هجومي (دوّسة على الجاز)',
}


# ============================================================================
# Portable DB discovery — same logic as maker_radar.py / exit_radar.py
# ============================================================================
def _find_radar_db():
    """اكتشف الـ DB المتاح تلقائياً. يرجع (db_path, table, columns...) أو None."""
    for db_rel, table, ticker_col, price_col, vol_col, turn_col, date_col, open_col, high_col, low_col in DB_CANDIDATES:
        db_path = PROJECT_ROOT / db_rel
        if not db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(db_path))
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,)
            )
            row = cur.fetchone()
            if not row:
                conn.close()
                continue
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.close()
            if n == 0:
                continue
            return db_path, table, ticker_col, price_col, vol_col, turn_col, date_col, open_col, high_col, low_col
        except Exception:
            continue
    return None


_DB_INFO = _find_radar_db()
if _DB_INFO:
    (PROD_DB, PROD_TABLE, TICKER_COL, PRICE_COL, VOL_COL, TURN_COL,
     DATE_COL, OPEN_COL, HIGH_COL, LOW_COL) = _DB_INFO
    DB_SOURCE_ID = f"{PROD_DB.name}::{PROD_TABLE}"
else:
    PROD_DB = None
    PROD_TABLE = None
    TICKER_COL = PRICE_COL = VOL_COL = TURN_COL = DATE_COL = OPEN_COL = HIGH_COL = LOW_COL = None
    DB_SOURCE_ID = None


def log(msg: str) -> None:
    print(msg, flush=True)


# ============================================================================
# Data loading
# ============================================================================
def find_latest_radar_cache(market: str = 'EGX') -> Optional[Path]:
    """أحدث ملف maker_radar_*.json في scripts/output."""
    if not OUTPUT_DIR.exists():
        return None
    files = sorted(
        [f for f in OUTPUT_DIR.iterdir()
         if f.name.startswith('maker_radar_') and f.name.endswith('.json')],
        reverse=True,
    )
    if not files:
        return None
    # Prefer files matching the market filter
    for f in files:
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
            if (data.get('market') or '').upper() == market.upper():
                return f
        except Exception:
            continue
    return files[0]


def load_radar_cache(market: str = 'EGX') -> Optional[Dict[str, Any]]:
    """Read the latest radar cache JSON. Returns None if no cache exists."""
    fp = find_latest_radar_cache(market)
    if not fp or not fp.exists():
        return None
    try:
        return json.loads(fp.read_text(encoding='utf-8'))
    except Exception as e:
        log(f"⚠️ فشل تحميل رادار الكاش: {e}")
        return None


def load_tracking() -> Dict[str, Dict[str, Any]]:
    """Read db/maker_radar_tracking.json — the tracked stocks from last week."""
    if not TRACKING_FILE.exists():
        return {}
    try:
        return json.loads(TRACKING_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}


def get_current_price(ticker: str) -> Optional[float]:
    """Get the latest closing price for a ticker from the radar DB."""
    if not PROD_DB:
        return None
    try:
        conn = sqlite3.connect(str(PROD_DB))
        query = (
            f"SELECT {PRICE_COL} FROM {PROD_TABLE} "
            f"WHERE {TICKER_COL} = ? AND {PRICE_COL} IS NOT NULL AND {PRICE_COL} > 0 "
            f"ORDER BY {DATE_COL} DESC LIMIT 1"
        )
        row = conn.execute(query, (ticker,)).fetchone()
        conn.close()
        if row and row[0]:
            return float(row[0])
    except Exception:
        pass
    return None


def load_market_regime(market: str = 'EGX') -> Dict[str, Any]:
    """
    Read current market regime from stocks.db.system_settings.
    Returns: { regime, last_update, confidence, reasons }
    Mirrors the logic in /api/market/regime (Next.js side) — Constitution §32:
    Python is the brain, this is a readonly SQLite read.
    """
    stocks_db = PROJECT_ROOT / 'db' / 'stocks.db'
    if not stocks_db.exists():
        return {'regime': 'NORMAL', 'last_update': None, 'reasons': [], 'source': 'default'}
    try:
        conn = sqlite3.connect(str(stocks_db))
        # 1) current state from system_settings
        settings_key = f"current_regime_{market}"
        row = conn.execute(
            "SELECT value FROM system_settings WHERE key = ?",
            (settings_key,),
        ).fetchone()
        state = {}
        if row and row[0]:
            try:
                state = json.loads(row[0])
            except Exception:
                state = {}
        # 2) latest log entry
        latest = None
        try:
            latest = conn.execute(
                "SELECT regime, confidence, reasons, computed_at FROM market_regime_log "
                "WHERE market = ? ORDER BY date DESC, id DESC LIMIT 1",
                (market,),
            ).fetchone()
        except Exception:
            pass
        conn.close()

        regime = (state.get('current_regime') or 'NORMAL').upper()
        reasons = []
        if latest and latest[2]:
            try:
                parsed = json.loads(latest[2])
                if isinstance(parsed, list):
                    reasons = parsed
                else:
                    reasons = [str(parsed)]
            except Exception:
                reasons = [str(latest[2])]

        return {
            'regime': regime,
            'regime_ar': REGIME_LABELS_AR.get(regime, regime),
            'last_update': state.get('last_update') or (latest[3] if latest else None),
            'confidence': latest[1] if latest else None,
            'reasons': reasons,
            'source': 'sqlite',
        }
    except Exception as e:
        return {
            'regime': 'NORMAL',
            'regime_ar': REGIME_LABELS_AR['NORMAL'],
            'last_update': None,
            'reasons': [],
            'source': 'fallback',
            'error': str(e),
        }


def load_sector_heatmap(market: str = 'EGX', top_n: int = 5) -> List[Dict[str, Any]]:
    """
    Read top sectors from stocks.db. Mirrors the /api/market/sectors/intelligence
    endpoint logic — read-only SQLite.
    Returns a list of { sector, stocks_count, avg_change_pct, direction, color }.
    """
    stocks_db = PROJECT_ROOT / 'db' / 'stocks.db'
    if not stocks_db.exists():
        return []
    try:
        conn = sqlite3.connect(str(stocks_db))
        # Defensive: check column availability
        cols = {r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()}
        if 'sector' not in cols or 'change_percent' not in cols:
            conn.close()
            return []
        rows = conn.execute(
            "SELECT sector, COUNT(*) AS n, AVG(change_percent) AS avg_change "
            "FROM stocks WHERE sector IS NOT NULL AND sector != '' "
            "GROUP BY sector HAVING n >= 3 ORDER BY AVG(turnover) DESC NULLS LAST LIMIT ?",
            (top_n * 3,),
        ).fetchall()
        conn.close()

        sectors = []
        for sector, n, avg_change in rows:
            avg_change = float(avg_change) if avg_change is not None else 0.0
            if avg_change > 0.5:
                direction, color, emoji = 'inflow', 'emerald', '🟢'
            elif avg_change < -0.5:
                direction, color, emoji = 'outflow', 'rose', '🔴'
            else:
                direction, color, emoji = 'neutral', 'amber', '🟡'
            sectors.append({
                'sector': sector,
                'stocks_count': n,
                'avg_change_pct': round(avg_change, 2),
                'direction': direction,
                'color': color,
                'emoji': emoji,
            })
        # Sort by avg_change_pct desc and take top_n
        sectors.sort(key=lambda x: -x['avg_change_pct'])
        return sectors[:top_n]
    except Exception:
        return []


# ============================================================================
# Report assembly — pick Top 5 + Stock of the Week + last-week performance
# ============================================================================
def pick_top_5(radar_data: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Pick top 5 stocks for the upcoming week.
    Priority: A_pre_surge + B_quiet_accumulation_strong, sorted by
    signal_count (desc) + volume_ratio (desc).
    """
    if not radar_data:
        return []
    candidates = []
    for key in ('pre_surge_list', 'quiet_list'):
        arr = radar_data.get(key) or []
        for s in arr:
            path = s.get('path') or key
            # Only accept the high-conviction paths
            if path not in ('A_pre_surge', 'B_quiet_accumulation_strong'):
                continue
            qd = s.get('quiet_details') or {}
            signal_count = qd.get('signal_count') or (
                s.get('pre_surge_details') or {}
            ).get('signal_count') or 0
            candidates.append({
                'ticker': s.get('ticker'),
                'path': path,
                'path_ar': PATH_LABELS_AR.get(path, path),
                'current_price': s.get('current_price'),
                'avg_turnover_20d': s.get('avg_turnover_20d'),
                'avg_volume_20d': s.get('avg_volume_20d'),
                'volume_ratio_10d_vs_20d': s.get('volume_ratio_10d_vs_20d'),
                'signal_count': signal_count,
                'roc_10d': s.get('roc_10d'),
                'price_stability': s.get('price_stability'),
                'reason': s.get('reason'),
                'kill_switch': s.get('kill_switch') or False,
            })

    # Sort: signal_count desc → volume_ratio desc → price_stability desc
    candidates.sort(
        key=lambda r: (
            -int(r['signal_count'] or 0),
            -float(r['volume_ratio_10d_vs_20d'] or 0),
            -float(r['price_stability'] or 0),
        )
    )
    # Dedup by ticker
    seen = set()
    out = []
    for c in candidates:
        if c['ticker'] in seen:
            continue
        seen.add(c['ticker'])
        out.append(c)
        if len(out) >= 5:
            break
    return out


def compute_target_stop(price: float, path: str) -> Tuple[float, float, float, float, float]:
    """
    Compute target_1, target_2, stop_loss for a stock based on its path.
    Returns (target_1, target_2, stop_loss, target_1_pct, stop_loss_pct).
    Defaults: +16% T1, +30% T2, -5% SL for pre-surge (high conviction)
              +10% T1, +20% T2, -5% SL for quiet accumulation
    """
    if path == 'A_pre_surge':
        t1_pct, t2_pct, sl_pct = 0.16, 0.30, -0.05
    elif path == 'B_quiet_accumulation_strong':
        t1_pct, t2_pct, sl_pct = 0.10, 0.20, -0.05
    else:
        t1_pct, t2_pct, sl_pct = 0.10, 0.18, -0.06
    if not price or price <= 0:
        return (0.0, 0.0, 0.0, 0.0, 0.0)
    return (
        round(price * (1 + t1_pct), 2),
        round(price * (1 + t2_pct), 2),
        round(price * (1 + sl_pct), 2),
        round(t1_pct * 100, 1),
        round(sl_pct * 100, 1),
    )


def pick_stock_of_week(top5: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Pick the highest-conviction stock: top signal_count + best risk/reward.
    risk/reward = (target_1_pct) / abs(stop_loss_pct)
    """
    if not top5:
        return None
    best = None
    best_score = -1
    for s in top5:
        price = s.get('current_price') or 0
        t1, t2, sl, t1_pct, sl_pct = compute_target_stop(price, s.get('path') or '')
        if sl_pct == 0:
            continue
        rr = t1_pct / abs(sl_pct)
        # Score = signal_count (×2 weight) + rr
        score = (s.get('signal_count') or 0) * 2 + rr
        if score > best_score:
            best_score = score
            best = {**s, 'target_1': t1, 'target_2': t2, 'stop_loss': sl,
                    'target_1_pct': t1_pct, 'stop_loss_pct': sl_pct,
                    'risk_reward': round(rr, 2)}
    return best


def compute_last_week_performance(tracking: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    For each tracked stock: get entry_price, current_price, compute return %,
    and rank them by return %. Mark as ✅ (gain), ⏳ (flat), ❌ (loss).
    """
    if not tracking:
        return []
    out = []
    for ticker, info in tracking.items():
        entry_price = float(info.get('entryPrice') or 0)
        entry_date = info.get('entryDate') or info.get('addedAt') or ''
        if entry_price <= 0:
            continue
        current_price = get_current_price(ticker)
        if current_price is None or current_price <= 0:
            # No price data — skip but note as "no data"
            out.append({
                'ticker': ticker,
                'entry_price': entry_price,
                'entry_date': entry_date,
                'current_price': None,
                'return_pct': None,
                'status': 'no_data',
                'status_emoji': '⏸️',
            })
            continue
        ret = (current_price - entry_price) / entry_price * 100
        if ret >= 1.5:
            status, emoji = 'win', '✅'
        elif ret <= -1.5:
            status, emoji = 'loss', '❌'
        else:
            status, emoji = 'flat', '⏳'
        out.append({
            'ticker': ticker,
            'entry_price': entry_price,
            'entry_date': entry_date,
            'current_price': current_price,
            'return_pct': round(ret, 1),
            'status': status,
            'status_emoji': emoji,
        })
    # Sort: wins first (desc), then flat, then losses (asc), then no_data
    status_order = {'win': 0, 'flat': 1, 'loss': 2, 'no_data': 3}
    out.sort(key=lambda r: (status_order.get(r['status'], 4), -(r['return_pct'] or -999)))
    return out


def build_report_data(market: str = 'EGX') -> Dict[str, Any]:
    """Assemble the full report payload (dict that becomes JSON)."""
    radar_data = load_radar_cache(market)
    tracking = load_tracking()
    regime = load_market_regime(market)
    sectors = load_sector_heatmap(market, top_n=5)

    top5 = pick_top_5(radar_data)
    stock_of_week = pick_stock_of_week(top5)
    last_week_perf = compute_last_week_performance(tracking)

    # Performance summary
    closed = [p for p in last_week_perf if p['status'] != 'no_data']
    if closed:
        avg_return = sum(p['return_pct'] or 0 for p in closed) / len(closed)
        wins = sum(1 for p in closed if p['status'] == 'win')
        win_rate = (wins / len(closed) * 100) if closed else 0
    else:
        avg_return = 0
        wins = 0
        win_rate = 0

    # Week range — Sunday to Saturday
    now = datetime.now()
    # Find the upcoming Sunday
    days_until_sunday = (6 - now.weekday()) % 7  # Monday=0, Sunday=6
    if days_until_sunday == 0:
        days_until_sunday = 7  # Always next week, not today
    upcoming_sunday = now + timedelta(days=days_until_sunday)
    upcoming_saturday = upcoming_sunday + timedelta(days=6)
    week_number = upcoming_sunday.isocalendar()[1]
    year = upcoming_sunday.year

    payload = {
        'generated_at': now.isoformat(),
        'market': market,
        'week_number': week_number,
        'year': year,
        'week_start': upcoming_sunday.strftime('%Y-%m-%d'),
        'week_end': upcoming_saturday.strftime('%Y-%m-%d'),
        'week_start_ar': _format_arabic_date(upcoming_sunday),
        'week_end_ar': _format_arabic_date(upcoming_saturday),
        'market_regime': regime,
        'stock_of_week': stock_of_week,
        'top_5': top5,
        'last_week_performance': {
            'stocks': last_week_perf,
            'avg_return_pct': round(avg_return, 1),
            'win_count': wins,
            'total_count': len(closed),
            'win_rate_pct': round(win_rate, 1),
        },
        'sector_heatmap': sectors,
        'db_source': DB_SOURCE_ID,
        'radar_cache_found': radar_data is not None,
        'tracking_count': len(tracking),
        'official_links': OFFICIAL_LINKS,
    }
    return payload


def _format_arabic_date(d: datetime) -> str:
    """Format date in Arabic style: 27 سبتمبر 2026"""
    months = [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ]
    return f"{d.day} {months[d.month - 1]} {d.year}"


# ============================================================================
# Arabic text shaping helpers (used by both PDF + PNG generation)
# ============================================================================
def _shape_arabic(text: str) -> str:
    """Reshape + apply BiDi algorithm so Arabic renders correctly in PDF/PNG."""
    if not text:
        return text
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        reshaped = arabic_reshaper.reshape(text)
        return get_display(reshaped)
    except Exception:
        return text


# ============================================================================
# PDF generation (ReportLab + Arabic font)
# ============================================================================
def _register_arabic_fonts():
    """Register NotoSansArabic fonts with ReportLab. Returns (reg_name, bold_name)."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    reg_name = 'NotoArabic'
    bold_name = 'NotoArabic-Bold'
    try:
        if FONT_REG.exists():
            pdfmetrics.registerFont(TTFont(reg_name, str(FONT_REG)))
        else:
            reg_name = 'Helvetica'
        if FONT_BOLD.exists():
            pdfmetrics.registerFont(TTFont(bold_name, str(FONT_BOLD)))
        else:
            bold_name = 'Helvetica-Bold'
    except Exception as e:
        log(f"⚠️ فشل تسجيل خط عربي: {e} — الرجوع لـ Helvetica")
        reg_name = 'Helvetica'
        bold_name = 'Helvetica-Bold'
    return reg_name, bold_name


def generate_pdf(payload: Dict[str, Any], output_path: Path) -> bool:
    """
    Generate the weekly report PDF using ReportLab. Returns True on success.
    Layout: A4 portrait, Arabic RTL via arabic_reshaper + python-bidi.
    Falls back to LTR if shaping libs aren't installed.
    """
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
        )
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_RIGHT, TA_CENTER
    except Exception as e:
        log(f"⚠️ reportlab غير متاح: {e}")
        return False

    reg, bold = _register_arabic_fonts()

    # Styles — Arabic-friendly with right alignment
    title_style = ParagraphStyle(
        'ar_title', fontName=bold, fontSize=18, leading=24,
        alignment=TA_CENTER, textColor=colors.HexColor('#0f766e'),
    )
    subtitle_style = ParagraphStyle(
        'ar_sub', fontName=reg, fontSize=12, leading=16,
        alignment=TA_CENTER, textColor=colors.HexColor('#475569'),
    )
    h2_style = ParagraphStyle(
        'ar_h2', fontName=bold, fontSize=14, leading=20,
        alignment=TA_RIGHT, textColor=colors.HexColor('#1e3a8a'),
        spaceBefore=12, spaceAfter=6,
    )
    body_style = ParagraphStyle(
        'ar_body', fontName=reg, fontSize=11, leading=18,
        alignment=TA_RIGHT, textColor=colors.HexColor('#0f172a'),
    )
    body_bold_style = ParagraphStyle(
        'ar_body_bold', fontName=bold, fontSize=11, leading=18,
        alignment=TA_RIGHT, textColor=colors.HexColor('#0f172a'),
    )
    small_style = ParagraphStyle(
        'ar_small', fontName=reg, fontSize=9, leading=12,
        alignment=TA_CENTER, textColor=colors.HexColor('#64748b'),
    )
    warning_style = ParagraphStyle(
        'ar_warn', fontName=reg, fontSize=11, leading=18,
        alignment=TA_CENTER, textColor=colors.HexColor('#dc2626'),
    )

    def P(text, style=body_style):
        return Paragraph(_shape_arabic(text), style)

    doc = SimpleDocTemplate(
        str(output_path), pagesize=A4,
        rightMargin=15 * mm, leftMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title="التقرير الأسبوعي للرادار",
    )
    story = []

    # ─── Header ───────────────────────────────────────────────────────────
    week_n = payload.get('week_number', '?')
    year = payload.get('year', '?')
    story.append(P(f"📊 التقرير الأسبوعي للرادار — الأسبوع {week_n}، {year}", title_style))
    story.append(Spacer(1, 4))
    story.append(P(f"📅 {payload.get('week_start_ar', '')} — {payload.get('week_end_ar', '')}", subtitle_style))
    regime = payload.get('market_regime') or {}
    regime_label = regime.get('regime_ar') or regime.get('regime', 'NORMAL')
    story.append(P(f"🏛️ حالة السوق: {regime.get('regime', 'NORMAL')} ({regime_label})", subtitle_style))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width='100%', thickness=1, color=colors.HexColor('#cbd5e1')))
    story.append(Spacer(1, 8))

    # ─── Stock of the Week ─────────────────────────────────────────────────
    sow = payload.get('stock_of_week')
    story.append(P("🌟 سهم الأسبوع", h2_style))
    if sow:
        price = sow.get('current_price') or 0
        rows = [
            [P(f"📊 السهم", body_bold_style), P(f"{sow.get('ticker', '—')}", body_style)],
            [P("📡 المسار", body_bold_style), P(f"{sow.get('path_ar', sow.get('path', '—'))}", body_style)],
            [P("💰 السعر الحالي", body_bold_style), P(f"{price:.2f}", body_style)],
            [P("🎯 الهدف الأول", body_bold_style),
             P(f"{sow.get('target_1', 0):.2f} (+{sow.get('target_1_pct', 0):.1f}%)", body_style)],
            [P("🎯 الهدف الثاني", body_bold_style),
             P(f"{sow.get('target_2', 0):.2f}", body_style)],
            [P("🛑 وقف الخسارة", body_bold_style),
             P(f"{sow.get('stop_loss', 0):.2f} ({sow.get('stop_loss_pct', 0):+.1f}%)", body_style)],
            [P("📊 قوة الإشارة", body_bold_style),
             P(f"{sow.get('signal_count', 0)}/6", body_style)],
            [P("📝 السبب", body_bold_style), P(sow.get('reason', '—')[:200], body_style)],
        ]
        t = Table(rows, colWidths=[55 * mm, 110 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0fdfa')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#a7f3d0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(t)
    else:
        story.append(P("لا يوجد سهم مميز هذا الأسبوع — الرادار فارغ أو بيتسخن.", warning_style))
    story.append(Spacer(1, 10))

    # ─── Top 5 ──────────────────────────────────────────────────────────────
    story.append(P("📋 أفضل 5 أسهم للأسبوع القادم", h2_style))
    top5 = payload.get('top_5') or []
    if top5:
        header = [
            P("#", body_bold_style),
            P("السهم", body_bold_style),
            P("المسار", body_bold_style),
            P("السعر", body_bold_style),
            P("الهدف", body_bold_style),
        ]
        rows = [header]
        for i, s in enumerate(top5, 1):
            price = s.get('current_price') or 0
            t1, _, _, _, _ = compute_target_stop(price, s.get('path') or '')
            rows.append([
                P(str(i), body_style),
                P(s.get('ticker', '—'), body_bold_style),
                P(s.get('path_ar', s.get('path', '—')), body_style),
                P(f"{price:.2f}" if price else "—", body_style),
                P(f"{t1:.2f}" if t1 else "—", body_style),
            ])
        t = Table(rows, colWidths=[10 * mm, 30 * mm, 60 * mm, 30 * mm, 30 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#ecfeff')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#67e8f9')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(t)
    else:
        story.append(P("لا توجد أسهم في الكاش — شغّل maker_radar.py أولاً.", warning_style))
    story.append(Spacer(1, 10))

    # ─── Last Week Performance ────────────────────────────────────────────
    story.append(P("📊 أداء أسهم الأسبوع الماضي", h2_style))
    perf = payload.get('last_week_performance') or {}
    perf_stocks = perf.get('stocks') or []
    if perf_stocks:
        header = [
            P("الحالة", body_bold_style),
            P("السهم", body_bold_style),
            P("سعر الدخول", body_bold_style),
            P("السعر الحالي", body_bold_style),
            P("العائد", body_bold_style),
        ]
        rows = [header]
        for s in perf_stocks:
            cur = s.get('current_price')
            cur_str = f"{cur:.2f}" if cur else "—"
            ret = s.get('return_pct')
            ret_str = f"{ret:+.1f}%" if ret is not None else "—"
            rows.append([
                P(s.get('status_emoji', '—'), body_style),
                P(s.get('ticker', '—'), body_bold_style),
                P(f"{s.get('entry_price', 0):.2f}", body_style),
                P(cur_str, body_style),
                P(ret_str, body_style),
            ])
        t = Table(rows, colWidths=[20 * mm, 30 * mm, 35 * mm, 35 * mm, 35 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#fef3c7')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#fcd34d')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(t)
        story.append(Spacer(1, 6))
        story.append(P(
            f"📈 متوسط العائد: {perf.get('avg_return_pct', 0):+.1f}%  |  "
            f"🎯 نسبة النجاح: {perf.get('win_count', 0)}/{perf.get('total_count', 0)} "
            f"({perf.get('win_rate_pct', 0):.0f}%)",
            body_bold_style,
        ))
    else:
        story.append(P("لا توجد أسهم متابَعة من الأسبوع الماضي.", warning_style))
    story.append(Spacer(1, 10))

    # ─── Sector heatmap ────────────────────────────────────────────────────
    story.append(P("🏛️ خريطة القطاعات", h2_style))
    sectors = payload.get('sector_heatmap') or []
    if sectors:
        rows = [[P("القطاع", body_bold_style), P("# أسهم", body_bold_style),
                 P("متوسط التغير", body_bold_style)]]
        for sec in sectors:
            rows.append([
                P(f"{sec.get('emoji', '•')} {sec.get('sector', '—')}", body_style),
                P(str(sec.get('stocks_count', 0)), body_style),
                P(f"{sec.get('avg_change_pct', 0):+.2f}%", body_style),
            ])
        t = Table(rows, colWidths=[80 * mm, 30 * mm, 40 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(t)
    else:
        story.append(P("لا توجد بيانات قطاعات متاحة.", warning_style))
    story.append(Spacer(1, 12))

    # ─── Footer ─────────────────────────────────────────────────────────────
    story.append(HRFlowable(width='100%', thickness=1, color=colors.HexColor('#cbd5e1')))
    story.append(Spacer(1, 6))
    story.append(P("📍 منصة دليل الاستثمار — invist.m2y.net", small_style))
    story.append(P("📱 Android | Telegram | Facebook | WhatsApp", small_style))
    story.append(Spacer(1, 4))
    story.append(P("⚠️ تحليل تلقائي — ليس نصيحة استثمارية. اتخذ قراراتك بناءً على بحثك الخاص.", small_style))

    try:
        doc.build(story)
        return True
    except Exception as e:
        log(f"⚠️ PDF build failed: {e}")
        traceback.print_exc()
        return False


# ============================================================================
# PNG generation (matplotlib — for Telegram)
# ============================================================================
def generate_png(payload: Dict[str, Any], output_path: Path) -> bool:
    """
    Generate the weekly report as a PNG image using matplotlib.
    Returns True on success. Used for Telegram (since PNG previews render inline).
    """
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from matplotlib import font_manager
        from matplotlib.patches import FancyBboxPatch, Rectangle
    except Exception as e:
        log(f"⚠️ matplotlib غير متاح: {e}")
        return False

    # Register the Arabic font + a Latin fallback (DejaVu Sans ships with
    # matplotlib and has the full Latin range — used as a fallback when
    # the text contains Latin chars like ticker symbols "AMIA", "COMI").
    if not FONT_REG.exists():
        log("⚠️ خط NotoSansArabic غير موجود — تخطّي PNG")
        return False
    try:
        font_manager.fontManager.addfont(str(FONT_REG))
        if FONT_BOLD.exists():
            font_manager.fontManager.addfont(str(FONT_BOLD))
        # Build a font fallback chain: Noto Sans Arabic → DejaVu Sans.
        # matplotlib >= 3.6 supports per-element font fallback.
        prop_reg = font_manager.FontProperties(fname=str(FONT_REG))
        prop_bold = font_manager.FontProperties(
            fname=str(FONT_BOLD) if FONT_BOLD.exists() else str(FONT_REG)
        )
        # Set the rcParam family to a list — matplotlib will fall back through
        # the list until it finds a font that has the required glyph.
        plt.rcParams['font.family'] = ['Noto Sans Arabic', 'DejaVu Sans']
    except Exception as e:
        log(f"⚠️ فشل تحميل خط عربي للـ matplotlib: {e}")
        return False

    # Layout: tall portrait card
    fig, ax = plt.subplots(figsize=(10, 14))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 140)
    ax.axis('off')
    fig.patch.set_facecolor('#f8fafc')

    def ar(text):
        return _shape_arabic(text or '')

    def text(x, y, s, size=11, weight='normal', color='#0f172a', ha='right', fontprops=None):
        # NOTE: We do NOT pass `fontproperties=` here — doing so would lock
        # matplotlib to a single font (NotoSansArabic) and bypass the
        # rcParams['font.family'] fallback chain. By relying on rcParams
        # + weight instead, matplotlib falls back to DejaVu Sans for Latin
        # glyphs (ticker symbols like "AMIA", "COMI") while still using
        # NotoSansArabic for Arabic letters.
        ax.text(x, y, ar(s), fontsize=size, color=color, ha=ha, va='top',
                fontweight=('bold' if weight == 'bold' else 'normal'), wrap=True)

    # ─── Background card ────────────────────────────────────────────────
    card = FancyBboxPatch((2, 2), 96, 136, boxstyle="round,pad=0.5,rounding_size=2",
                          facecolor='white', edgecolor='#cbd5e1', linewidth=1.5)
    ax.add_patch(card)

    y = 132
    # ─── Header ──────────────────────────────────────────────────────────
    week_n = payload.get('week_number', '?')
    year = payload.get('year', '?')
    text(50, y, f"📊 التقرير الأسبوعي للرادار — الأسبوع {week_n}، {year}",
         size=16, weight='bold', color='#0f766e', ha='center')
    y -= 5
    text(50, y, f"📅 {payload.get('week_start_ar', '')} — {payload.get('week_end_ar', '')}",
         size=11, color='#475569', ha='center')
    y -= 4
    regime = payload.get('market_regime') or {}
    regime_label = regime.get('regime_ar') or regime.get('regime', 'NORMAL')
    text(50, y, f"🏛️ حالة السوق: {regime.get('regime', 'NORMAL')} ({regime_label})",
         size=11, color='#1e3a8a', ha='center')
    y -= 3
    ax.plot([5, 95], [y, y], color='#cbd5e1', linewidth=0.8)
    y -= 4

    # ─── Stock of the Week ──────────────────────────────────────────────
    text(95, y, "🌟 سهم الأسبوع", size=13, weight='bold', color='#1e3a8a')
    y -= 5
    sow = payload.get('stock_of_week')
    if sow:
        price = sow.get('current_price') or 0
        t1 = sow.get('target_1') or 0
        t2 = sow.get('target_2') or 0
        sl = sow.get('stop_loss') or 0
        t1_pct = sow.get('target_1_pct') or 0
        sl_pct = sow.get('stop_loss_pct') or 0
        sc = sow.get('signal_count') or 0
        # Card background
        box = Rectangle((5, y - 22), 90, 22, facecolor='#f0fdfa', edgecolor='#a7f3d0')
        ax.add_patch(box)
        text(8, y - 2, f"📊 السهم: {sow.get('ticker', '—')}", size=12, weight='bold', ha='left')
        text(95, y - 2, f"💰 السعر: {price:.2f}", size=11, ha='right')
        y -= 4
        text(8, y, f"📡 المسار: {sow.get('path_ar', sow.get('path', '—'))}", size=10, ha='left')
        text(95, y, f"🎯 الهدف 1: {t1:.2f} (+{t1_pct:.1f}%)", size=10, ha='right')
        y -= 4
        text(8, y, f"🎯 الهدف 2: {t2:.2f}", size=10, ha='left')
        text(95, y, f"🛑 الوقف: {sl:.2f} ({sl_pct:+.1f}%)", size=10, ha='right')
        y -= 4
        text(8, y, f"📊 قوة الإشارة: {sc}/6", size=10, weight='bold', ha='left')
        y -= 4
        reason = (sow.get('reason') or '—')[:120]
        text(8, y, f"📝 {reason}", size=9, color='#475569', ha='left')
        y -= 6
    else:
        text(50, y, "لا يوجد سهم مميز هذا الأسبوع", size=11, color='#dc2626', ha='center')
        y -= 4

    ax.plot([5, 95], [y, y], color='#e2e8f0', linewidth=0.5)
    y -= 4

    # ─── Top 5 ───────────────────────────────────────────────────────────
    text(95, y, "📋 أفضل 5 أسهم للأسبوع القادم", size=13, weight='bold', color='#1e3a8a')
    y -= 5
    top5 = payload.get('top_5') or []
    if top5:
        for i, s in enumerate(top5, 1):
            price = s.get('current_price') or 0
            t1, _, _, _, _ = compute_target_stop(price, s.get('path') or '')
            row = f"{i}. {s.get('ticker', '—')}  —  {s.get('path_ar', s.get('path', '—'))}  →  {price:.2f}  →  {t1:.2f}"
            text(8, y, row, size=10, ha='left')
            y -= 3.5
        y -= 2
    else:
        text(50, y, "لا توجد أسهم في الكاش", size=10, color='#dc2626', ha='center')
        y -= 4

    ax.plot([5, 95], [y, y], color='#e2e8f0', linewidth=0.5)
    y -= 4

    # ─── Last Week Performance ──────────────────────────────────────────
    text(95, y, "📊 أداء أسهم الأسبوع الماضي", size=13, weight='bold', color='#1e3a8a')
    y -= 5
    perf = payload.get('last_week_performance') or {}
    perf_stocks = perf.get('stocks') or []
    if perf_stocks:
        for s in perf_stocks[:8]:
            cur = s.get('current_price')
            ret = s.get('return_pct')
            cur_str = f"{cur:.2f}" if cur else "—"
            ret_str = f"{ret:+.1f}%" if ret is not None else "—"
            emoji = s.get('status_emoji', '•')
            row = f"{emoji}  {s.get('ticker', '—')}   دخل {s.get('entry_price', 0):.2f}  →  الآن {cur_str}  ({ret_str})"
            text(8, y, row, size=9, ha='left')
            y -= 3
        y -= 1
        avg = perf.get('avg_return_pct', 0)
        win_n = perf.get('win_count', 0)
        total = perf.get('total_count', 0)
        wr = perf.get('win_rate_pct', 0)
        text(8, y, f"📈 متوسط العائد: {avg:+.1f}%  |  🎯 نسبة النجاح: {win_n}/{total} ({wr:.0f}%)",
             size=10, weight='bold', ha='left')
        y -= 5
    else:
        text(50, y, "لا توجد أسهم متابَعة", size=10, color='#dc2626', ha='center')
        y -= 4

    ax.plot([5, 95], [y, y], color='#e2e8f0', linewidth=0.5)
    y -= 4

    # ─── Sector heatmap ──────────────────────────────────────────────────
    text(95, y, "🏛️ خريطة القطاعات", size=13, weight='bold', color='#1e3a8a')
    y -= 5
    sectors = payload.get('sector_heatmap') or []
    if sectors:
        for sec in sectors[:5]:
            row = (f"{sec.get('emoji', '•')}  {sec.get('sector', '—')}:  "
                   f"{sec.get('avg_change_pct', 0):+.2f}%  ({sec.get('stocks_count', 0)} سهم)")
            color = '#16a34a' if sec.get('avg_change_pct', 0) > 0 else (
                '#dc2626' if sec.get('avg_change_pct', 0) < 0 else '#ca8a04'
            )
            text(8, y, row, size=10, color=color, ha='left')
            y -= 3.5
        y -= 3
    else:
        text(50, y, "لا توجد بيانات قطاعات", size=10, color='#dc2626', ha='center')
        y -= 4

    ax.plot([5, 95], [y, y], color='#e2e8f0', linewidth=0.5)
    y -= 4

    # ─── Footer ──────────────────────────────────────────────────────────
    text(50, y, "📍 منصة دليل الاستثمار — invist.m2y.net", size=10, color='#64748b', ha='center')
    y -= 3
    text(50, y, "📱 Android | Telegram | Facebook | WhatsApp", size=9, color='#64748b', ha='center')
    y -= 3
    text(50, y, "⚠️ تحليل تلقائي — ليس نصيحة استثمارية", size=8, color='#94a3b8', ha='center')

    try:
        plt.savefig(str(output_path), dpi=150, bbox_inches='tight',
                    facecolor=fig.get_facecolor(), edgecolor='none')
        plt.close(fig)
        return True
    except Exception as e:
        log(f"⚠️ PNG save failed: {e}")
        try:
            plt.close(fig)
        except Exception:
            pass
        return False


# ============================================================================
# Telegram sender — fire-and-forget (best-effort)
# ============================================================================
def send_to_telegram(payload: Dict[str, Any], image_path: Optional[Path]) -> Dict[str, Any]:
    """
    Send the weekly report to Telegram. Posts:
      1. The PNG image (if available) with a short caption
      2. A summary text message with top 5 + stock of the week
    Returns a dict { success, image_sent, text_sent, errors }.
    """
    bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    chat_id = (os.environ.get('TELEGRAM_CHAT_ID', '')
               or os.environ.get('TELEGRAM_CHANNEL_ID', ''))
    if not bot_token or not chat_id:
        return {'success': False, 'error': 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set',
                'image_sent': False, 'text_sent': False}

    import urllib.request
    import mimetypes

    result = {'success': True, 'image_sent': False, 'text_sent': False, 'errors': []}

    # 1. Send the PNG image with caption (top 5 + stock of week summary)
    caption = _build_telegram_caption(payload)
    if image_path and image_path.exists():
        try:
            url = f'https://api.telegram.org/bot{bot_token}/sendPhoto'
            with open(image_path, 'rb') as f:
                file_data = f.read()
            filename = image_path.name
            mime = mimetypes.guess_type(str(image_path))[0] or 'image/png'
            boundary = '----WeeklyRadarReportBoundary'
            body = (
                f'--{boundary}\r\n'
                f'Content-Disposition: form-data; name="chat_id"\r\n\r\n{chat_id}\r\n'
                f'--{boundary}\r\n'
                f'Content-Disposition: form-data; name="caption"\r\n\r\n{caption[:1024]}\r\n'
                f'--{boundary}\r\n'
                f'Content-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n'
                f'--{boundary}\r\n'
                f'Content-Disposition: form-data; name="photo"; filename="{filename}"\r\n'
                f'Content-Type: {mime}\r\n\r\n'
            ).encode('utf-8') + file_data + f'\r\n--{boundary}--\r\n'.encode('utf-8')
            req = urllib.request.Request(
                url, data=body,
                headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                tg_result = json.loads(resp.read().decode('utf-8'))
                if tg_result.get('ok'):
                    result['image_sent'] = True
                else:
                    result['errors'].append(f"sendPhoto: {tg_result.get('description')}")
                    result['success'] = False
        except Exception as e:
            result['errors'].append(f"sendPhoto exception: {e}")
            result['success'] = False

    # 2. Send the full text summary (without image — covers the long-form
    # content that doesn't fit in a 1024-char caption)
    try:
        full_text = _build_telegram_full_text(payload)
        # Telegram message limit is 4096 chars
        for i in range(0, len(full_text), 4000):
            chunk = full_text[i:i + 4000]
            url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
            data = (f'chat_id={chat_id}&text={urllib.parse.quote(chunk)}&parse_mode=HTML'
                    ).encode('utf-8')
            req = urllib.request.Request(
                url, data=data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                tg_result = json.loads(resp.read().decode('utf-8'))
                if tg_result.get('ok'):
                    result['text_sent'] = True
                else:
                    result['errors'].append(f"sendMessage: {tg_result.get('description')}")
                    result['success'] = False
    except Exception as e:
        result['errors'].append(f"sendMessage exception: {e}")
        result['success'] = False

    return result


def _build_telegram_caption(payload: Dict[str, Any]) -> str:
    """Short caption for the PNG image (≤1024 chars)."""
    sow = payload.get('stock_of_week') or {}
    top5 = payload.get('top_5') or []
    regime = payload.get('market_regime') or {}
    week_n = payload.get('week_number', '?')
    year = payload.get('year', '?')
    parts = [
        f"📊 <b>التقرير الأسبوعي للرادار — الأسبوع {week_n}، {year}</b>",
        f"📅 {payload.get('week_start_ar', '')} — {payload.get('week_end_ar', '')}",
        f"🏛️ حالة السوق: <b>{regime.get('regime', 'NORMAL')}</b> ({regime.get('regime_ar', '')})",
        "",
        f"🌟 <b>سهم الأسبوع:</b> {sow.get('ticker', '—')}",
        f"💰 السعر: {sow.get('current_price', 0):.2f}",
        f"🎯 الهدف: {sow.get('target_1', 0):.2f} (+{sow.get('target_1_pct', 0):.1f}%)",
        f"🛑 الوقف: {sow.get('stop_loss', 0):.2f}",
        "",
        "📋 <b>أفضل 5 أسهم:</b>",
    ]
    for i, s in enumerate(top5, 1):
        price = s.get('current_price') or 0
        parts.append(f"{i}. {s.get('ticker', '—')} — {price:.2f}")
    parts.append("")
    parts.append("📍 invist.m2y.net")
    parts.append("⚠️ تحليل تلقائي — ليس نصيحة استثمارية")
    return '\n'.join(parts)


def _build_telegram_full_text(payload: Dict[str, Any]) -> str:
    """Long-form text message — covers everything in detail."""
    sow = payload.get('stock_of_week') or {}
    top5 = payload.get('top_5') or []
    perf = payload.get('last_week_performance') or {}
    sectors = payload.get('sector_heatmap') or []
    regime = payload.get('market_regime') or {}

    parts = [
        f"📊 <b>التقرير الأسبوعي للرادار — الأسبوع {payload.get('week_number', '?')}، {payload.get('year', '?')}</b>",
        f"📅 {payload.get('week_start_ar', '')} — {payload.get('week_end_ar', '')}",
        f"🏛️ حالة السوق: <b>{regime.get('regime', 'NORMAL')}</b> ({regime.get('regime_ar', '')})",
        "",
        "═" * 30,
        "🌟 <b>سهم الأسبوع</b>",
        "═" * 30,
        f"📊 السهم: <b>{sow.get('ticker', '—')}</b>",
        f"📡 المسار: {sow.get('path_ar', sow.get('path', '—'))}",
        f"💰 السعر: <b>{sow.get('current_price', 0):.2f}</b>",
        f"🎯 الهدف 1: <b>{sow.get('target_1', 0):.2f}</b> (+{sow.get('target_1_pct', 0):.1f}%)",
        f"🎯 الهدف 2: {sow.get('target_2', 0):.2f}",
        f"🛑 وقف الخسارة: <b>{sow.get('stop_loss', 0):.2f}</b> ({sow.get('stop_loss_pct', 0):+.1f}%)",
        f"📊 قوة الإشارة: {sow.get('signal_count', 0)}/6",
        f"📝 السبب: {sow.get('reason', '—')[:300]}",
        "",
        "═" * 30,
        "📋 <b>أفضل 5 أسهم للأسبوع القادم</b>",
        "═" * 30,
    ]
    for i, s in enumerate(top5, 1):
        price = s.get('current_price') or 0
        parts.append(f"{i}. <b>{s.get('ticker', '—')}</b> — {s.get('path_ar', s.get('path', '—'))} — {price:.2f}")
    parts.append("")

    # Last week performance
    perf_stocks = perf.get('stocks') or []
    if perf_stocks:
        parts.append("═" * 30)
        parts.append("📊 <b>أداء أسهم الأسبوع الماضي</b>")
        parts.append("═" * 30)
        for s in perf_stocks[:10]:
            cur = s.get('current_price')
            cur_str = f"{cur:.2f}" if cur else "—"
            ret = s.get('return_pct')
            ret_str = f"{ret:+.1f}%" if ret is not None else "—"
            parts.append(
                f"{s.get('status_emoji', '•')} <b>{s.get('ticker', '—')}</b> "
                f"دخل {s.get('entry_price', 0):.2f} → الآن {cur_str} ({ret_str})"
            )
        parts.append(
            f"\n📈 متوسط العائد: <b>{perf.get('avg_return_pct', 0):+.1f}%</b>"
            f" | 🎯 نسبة النجاح: <b>{perf.get('win_count', 0)}/{perf.get('total_count', 0)}</b>"
            f" ({perf.get('win_rate_pct', 0):.0f}%)"
        )

    # Sectors
    if sectors:
        parts.append("")
        parts.append("═" * 30)
        parts.append("🏛️ <b>خريطة القطاعات</b>")
        parts.append("═" * 30)
        for sec in sectors:
            parts.append(
                f"{sec.get('emoji', '•')} {sec.get('sector', '—')}: "
                f"{sec.get('avg_change_pct', 0):+.2f}% ({sec.get('stocks_count', 0)} سهم)"
            )

    parts.append("")
    parts.append("📍 منصة دليل الاستثمار — invist.m2y.net")
    parts.append("📱 Android | Telegram | Facebook | WhatsApp")
    parts.append("⚠️ تحليل تلقائي — ليس نصيحة استثمارية")
    return '\n'.join(parts)


# ============================================================================
# Main
# ============================================================================
def main():
    parser = argparse.ArgumentParser(description='تقرير الرادار الأسبوعي')
    parser.add_argument('--market', type=str, default='EGX',
                        help='سوق (EGX, TADAWUL, KSE, QSE, ALL)')
    parser.add_argument('--dry-run', action='store_true',
                        help='اطبع التقرير على stdout بدون حفظ ملفات')
    parser.add_argument('--json-only', action='store_true',
                        help='احفظ JSON فقط بدون PDF/PNG')
    parser.add_argument('--send-telegram', action='store_true',
                        help='ابعت التقرير للتليجرام بعد التوليد')
    parser.add_argument('--stdout', action='store_true',
                        help='اطبع JSON على stdout (للـ cron)')
    args = parser.parse_args()

    log("═══ التقرير الأسبوعي للرادار ═══")
    log(f"  Market: {args.market}")
    log(f"  DB: {PROD_DB.name if PROD_DB else '(none)'}")
    log(f"  DB source: {DB_SOURCE_ID}")

    payload = build_report_data(args.market)

    if args.dry_run:
        # Print a readable Arabic summary to stdout
        log("\n" + "=" * 70)
        log(_build_telegram_full_text(payload))
        log("\n" + "=" * 70)
        log(f"Top 5 count: {len(payload.get('top_5') or [])}")
        log(f"Last-week perf stocks: {len((payload.get('last_week_performance') or {}).get('stocks') or [])}")
        log(f"Sectors: {len(payload.get('sector_heatmap') or [])}")
        log(f"Regime: {(payload.get('market_regime') or {}).get('regime')}")
        return 0

    # Always write the JSON
    today_str = datetime.now().strftime("%Y%m%d")
    json_path = OUTPUT_DIR / f"weekly_radar_report_{today_str}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    log(f"✅ JSON saved: {json_path}")

    pdf_path = OUTPUT_DIR / f"weekly_radar_report_{today_str}.pdf"
    png_path = OUTPUT_DIR / f"weekly_radar_report_{today_str}.png"

    if not args.json_only:
        # Generate PDF
        if generate_pdf(payload, pdf_path):
            log(f"✅ PDF saved: {pdf_path}")
        else:
            log("⚠️ PDF generation failed — falling back to PNG only")

        # Generate PNG
        if generate_png(payload, png_path):
            log(f"✅ PNG saved: {png_path}")
        else:
            log("⚠️ PNG generation failed")

    # Optionally send to Telegram
    if args.send_telegram:
        log("📤 Sending to Telegram...")
        img = png_path if png_path.exists() else None
        tg_result = send_to_telegram(payload, img)
        log(f"  Telegram: {tg_result}")
        payload['telegram_result'] = tg_result

    if args.stdout:
        print(json.dumps(payload, ensure_ascii=False, default=str))

    return 0


if __name__ == "__main__":
    sys.exit(main())
