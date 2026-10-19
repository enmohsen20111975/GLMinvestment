#!/usr/bin/env python3
"""
liquidity_radar_v2.py — رادار السيولة الصارم (4 أعمدة فقط)
=================================================================================
Task BRAVO-RADAR-V2 (Owner Directive 2026-10-14)

الهدف: تحويل الرادر من شاشة تسميات إلى منظار قرار بسيط وقابل للاعتماد.

الـ 4 أعمدة الإلزامية:
  1. الحوت فين؟       → Money Flow Multiplier (MFM) — تدفق حقيقي
  2. حالة السوق       → فلتر إلزامي (صاعد / هابط / عرضي / Risk-Off)
  3. المرحلة          → 3 حالات: تراكم مع اتجاه / تراكم هادئ / تصريف
  4. مستوى الدخول والدفاع → سعر مرجعي للدخول + مستوى كسر = خروج

القيود الحديدية:
  - ممنوع مصطلحات Wyckoff (Spring / SOS / Buying Climax / تصريف ذكي)
  - MFM (Money Flow Multiplier) هو المعيار الكنسي للتدفق (مش close vs open)
  - أي سهم صافي تدفقه سالب أو حجمه ضعيف → ممنوع قائمة إيجابية
  - سوق هابط واضح → ممنوع إشارات تجميع/Pre-Surge
  - بيانات ناقصة → "بيانات غير كافية"
  - ممنوع أهداف صاعدة على أسهم هابطة

المصدر الكنسي:
  - db/stocks.db (stocks + stock_daily_prices + market_indices)
  - حجم التداول = volume × close (قيمة بالجنيه)
  - متوسط الفترة = 20 يوم

Usage:
    python3 scripts/liquidity_radar_v2.py                    # كل أسهم EGX
    python3 scripts/liquidity_radar_v2.py --market TADAWUL   # سوق محدد
    python3 scripts/liquidity_radar_v2.py --json             # JSON output
    python3 scripts/liquidity_radar_v2.py --ticker COMI      # سهم واحد
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = Path(os.environ.get('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db")))
DATA_ENGINE_DB = Path(os.environ.get('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db")))

# SEALED-DISPATCH-BRAVO-UNIFIED-RADAR (2026-10-17):
# Step 1: الرادار يقرأ من predictions.db (قراءة فقط، ما يكتبش) — مصدر واحد
#         للقرار. الـ predictions.db بيحتوي على توقعات V40.2 المكتوبة
#         بواسطة daily_predictor.py. الرادار بيدّي context إضافي (هل
#         التوقع نشط؟) بس ما بيتدخلّش في كتابته.
PREDICTIONS_DB = Path(os.environ.get('PREDICTIONS_DB', str(PROJECT_ROOT / "db" / "predictions.db")))

# TASK-BACKEND-BRAVO (2026-10-15): canonical liquidity classifier (mutually-exclusive).
# Add vps-service to sys.path so we can import the canonical classifier.
_VPS_SERVICE_ROOT = PROJECT_ROOT / 'vps-service'
if str(_VPS_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_SERVICE_ROOT))
try:
    from api.canonical_flow import classify_liquidity_bucket as _classify_liquidity_bucket
    from api.canonical_flow import BUCKET_LABEL_AR as _BUCKET_LABEL_AR
    # BRAVO-RADAR-PRED-AUDIT-001 Fix 4: unify Falling Knife with canonical.
    from api.canonical_flow import _is_falling_knife as _canonical_is_falling_knife
    from api.canonical_flow import _compute_ma as _canonical_compute_ma
    from api.canonical_flow import SMA50_PERIOD as _CANONICAL_SMA50_PERIOD
except Exception as _cf_err:  # graceful — radar still works without canonical classifier
    _classify_liquidity_bucket = None
    _BUCKET_LABEL_AR = {'neutral': 'حياد'}
    _canonical_is_falling_knife = None
    _canonical_compute_ma = None
    _CANONICAL_SMA50_PERIOD = 50
    print(f"[liquidity_radar_v2] WARN: canonical_flow import failed: {_cf_err}", flush=True)


def _classify_bucket_safe(conn, ticker: str, market: str) -> Dict[str, Any]:
    """Call the canonical classifier with full error isolation.

    Returns a fallback neutral classification if the classifier is unavailable
    or raises. Never lets the radar crash because of the canonical flow import.
    """
    fallback = {
        'liquidity_bucket': 'neutral',
        'liquidity_bucket_ar': _BUCKET_LABEL_AR.get('neutral', 'حياد'),
        'net_flow_5d': 0.0,
    }
    if _classify_liquidity_bucket is None:
        return fallback
    try:
        cls = _classify_liquidity_bucket(ticker, market, conn)
        return {
            'liquidity_bucket': cls.get('bucket', 'neutral'),
            'liquidity_bucket_ar': cls.get('bucket_ar', _BUCKET_LABEL_AR.get('neutral', 'حياد')),
            'net_flow_5d': float(cls.get('net_flow_5d', 0.0) or 0.0),
        }
    except Exception as e:
        print(f"[liquidity_radar_v2] WARN: classify failed for {ticker}: {e}", flush=True)
        return fallback


# Task BRAVO-RADAR-V2: استيراد قاموس تعريب القطاعات
import importlib.util as _ilu
_sector_arabic_path = Path(__file__).resolve().parent / "sector_arabic.py"
if _sector_arabic_path.exists():
    _spec = _ilu.spec_from_file_location("sector_arabic", _sector_arabic_path)
    _sector_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_sector_mod)
    arabize_sector = _sector_mod.arabize_sector
else:
    def arabize_sector(sector: Any) -> str:
        if not sector or not isinstance(sector, str):
            return 'متفرقات'
        return sector.strip()

# ─── الثوابت الكمية الصارمة ──────────────────────────────────────────────
LOOKBACK_DAYS = 20              # متوسط الفترة لصافي التدفق
MIN_CANDLES = 30                # أقل عدد شموع لازم للحكم
MIN_TURNOVER_EGP = 3_000_000    # حد السيولة الأدنى (3M EGP) — أقل من كده = ضعيف
MARKET_BEAR_THRESHOLD = -2.0    # لو المؤشر change% ≤ -2% → سوق هابط واضح
MARKET_BULL_THRESHOLD = 1.0     # لو المؤشر change% ≥ +1% → سوق صاعد
# لو بين -2% و +1% → عرضي

# ─── Task B-26: خريطة العملات + المؤشرات لكل سوق (Multi-Market SSOT) ──
# كل سوق ليه عملته الحقيقية + رمز مؤشره (مع fallbacks لو المؤشر مش في DB)
MARKET_CURRENCY_MAP = {
    'EGX': {'currency': 'ج.م', 'currency_ar': 'جنيه مصري', 'currency_en': 'EGP'},
    'TADAWUL': {'currency': 'ر.س', 'currency_ar': 'ريال سعودي', 'currency_en': 'SAR'},
    'KSE': {'currency': 'د.ك', 'currency_ar': 'دينار كويتي', 'currency_en': 'KWD'},
    'QSE': {'currency': 'ر.ق', 'currency_ar': 'ريال قطري', 'currency_en': 'QAR'},
    'US': {'currency': '$', 'currency_ar': 'دولار أمريكي', 'currency_en': 'USD'},
    'CRYPTO': {'currency': '$', 'currency_ar': 'دولار', 'currency_en': 'USD'},
    'GOLD': {'currency': '$', 'currency_ar': 'دولار', 'currency_en': 'USD'},
}

# خريطة السوق → قائمة مؤشرات محتملة (نجرّبهم بالترتيب لواحد لواحد)
MARKET_INDEX_FALLBACKS = {
    'EGX': ['EGX30', 'EGX70', 'EGX100', 'EGX50'],
    'TADAWUL': ['TASI', 'TADAWUL', 'Saudi', 'SPSI'],
    'KSE': ['KSE', 'Boursa Kuwait', 'Kuwait', 'KPW'],
    'QSE': ['QSE', 'QE', 'Qatar', 'QSI'],
    'US': ['SPX', 'DJI', 'IXIC', 'US'],
    'CRYPTO': ['BTC', 'CRYPTO'],
    'GOLD': ['XAU', 'GOLD'],
}


def get_market_currency(market: str) -> Dict[str, str]:
    """رجّع عملة السوق الحقيقية (SSOT)."""
    return MARKET_CURRENCY_MAP.get(market.upper(), MARKET_CURRENCY_MAP['EGX'])

# 3 مراحل بس (ممنوع أي تسميات تانية)
PHASE_ABSORBING = "تراكم مع اتجاه"           # MFM موجب قوي + سعر فوق MA20
PHASE_PREPARING = "تراكم هادئ"               # MFM موجب ضعيف/محايد + هيكل صاعد
PHASE_DISTRIBUTING = "تصريف"                 # MFM سالب
PHASE_INSUFFICIENT = "بيانات غير كافية"


def log(msg: str) -> None:
    print(f"[liquidity_radar_v2] {msg}", flush=True)


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


# ─── SEALED-DISPATCH-BRAVO-UNIFIED-RADAR (2026-10-17) — Step 1 + 2 ────────
# Step 1: read-only access to predictions.db (the radar must NEVER write
#         to predictions.db — that's the V40.2 engine's single-writer
#         responsibility per Rule 73 SINGLE-WRITER).
# Step 2: provide has_active_prediction(ticker) so scan_ticker() can
#         suppress the "تجميع" label when no active prediction exists
#         (this prevents fake accumulation signals — Rule 27 NO-FAKE-DATA).
def _fetch_active_prediction(ticker: str, market: str = 'EGX') -> Optional[Dict[str, Any]]:
    """Connects to predictions.db in READ-ONLY mode and returns the most
    recent ACTIVE prediction for `ticker` in `market`, or None if no
    active prediction exists.

    Rule 73 (SINGLE-WRITER): predictions.db is written by V40.2 (via
    `daily_predictor.py` → `PredictionTracker.record_prediction`) only.
    This function NEVER writes — `mode=ro` enforces that at the SQLite
    layer.

    "Active" definition:
      • signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY')
        (we only care about BUY-side predictions for accumulation context)
      • status NOT IN ('hit_target', 'hit_stop', 'expired', 'cancelled',
                       'closed', 'CLOSED', 'superceded', 'SUPERSEDED')
        (i.e. the prediction hasn't been closed yet)
      • prediction_date is the most recent for this ticker
    """
    if not PREDICTIONS_DB.exists():
        return None

    try:
        # mode=ro enforces READ-ONLY at the SQLite layer. Even if a bug
        # tried to commit a write, SQLite would refuse.
        conn = sqlite3.connect(f"file:{PREDICTIONS_DB}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, ticker, market, signal, status, score, confidence,
                   entry_price, target_price, stop_loss, risk_reward,
                   prediction_date, created_at
            FROM predictions
            WHERE ticker = ? COLLATE NOCASE
              AND (market = ? OR market IS NULL OR market = '')
              AND signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'INSTITUTIONAL_BUY')
              AND (
                status IS NULL
                OR status = ''
                OR lower(status) NOT IN (
                  'hit_target', 'hit_stop', 'expired', 'cancelled',
                  'closed', 'superceded', 'superseded'
                )
              )
            ORDER BY prediction_date DESC, created_at DESC
            LIMIT 1
        """, (ticker.upper(), market))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return None

        return {
            'prediction_id': row['id'],
            'ticker': row['ticker'],
            'signal': row['signal'],
            'status': row['status'],
            'score': row['score'],
            'confidence': row['confidence'],
            'entry_price': row['entry_price'],
            'target_price': row['target_price'],
            'stop_loss': row['stop_loss'],
            'risk_reward': row['risk_reward'],
            'prediction_date': row['prediction_date'],
            'created_at': row['created_at'],
        }
    except sqlite3.OperationalError as e:
        # Likely: table doesn't exist yet (fresh DB) or schema mismatch.
        # Return None — same as "no active prediction". Don't crash the radar.
        log(f"⚠️ predictions.db read failed for {ticker}: {e}")
        return None
    except Exception as e:
        log(f"⚠️ _fetch_active_prediction error for {ticker}: {e}")
        return None


def has_active_prediction(ticker: str, market: str = 'EGX') -> bool:
    """Step 2 guard: True iff there's an active (non-closed) BUY-side
    prediction for `ticker` in `market` inside predictions.db.

    Used by scan_ticker() to decide whether to allow the "تجميع" label
    (institutional accumulation). If False, accumulation_class is forced
    to None — preventing fake AIH (All-In Hold) signals.
    """
    return _fetch_active_prediction(ticker, market) is not None


# ─── END Step 1 + 2 helpers ────────────────────────────────────────────────


# ─── Task BRAVO-TV-MINE: TradingView data mine integration helpers ───────────


def _parse_egp_value(s: Any) -> Optional[float]:
    """Parse localized EGP value strings from tabs_data.

    Examples: '1.69 T EGP' → 1.69e12, '82.39 B EGP' → 8.239e10, '5 M EGP' → 5e6.
    Returns None for '—' / empty / unparseable.
    """
    if s is None:
        return None
    txt = str(s).replace('−', '-').strip()
    if not txt or txt in ('—', '-', '— '):
        return None
    import re
    m = re.match(r'^(-?[0-9]+(?:\.[0-9]+)?)\s*([TBMK]?)', txt)
    if not m:
        return None
    val = float(m.group(1))
    unit = (m.group(2) or '').upper()
    mult = {'T': 1e12, 'B': 1e9, 'M': 1e6, 'K': 1e3}.get(unit, 1.0)
    return val * mult


def _compute_fundamentals(ticker: str, de_conn: Optional[sqlite3.Connection]) -> Dict[str, Any]:
    """Fundamentals — pull cash, total_assets, free_cf, operating_cf, debt for a stock.

    Source priority (Task BRAVO-CASH-LINKAGE):
      1. data_engine.db/stocks.tabs_data JSON:
         - 'بَيَانُ المُوَازَنَة' array: [3]=total_assets, [7]=cash, [9]=debt.
         - 'التدفقات النقدية' array: [3]=operating_cf, [6]=free_cf.
      2. Fallback: tab_balance_sheet + tab_cash_flow tables by symbol (non-EGX numeric).

    Returns {free_cash_flow, cash_on_hand, operating_cf, total_assets, debt, cash_ratio, debt_ratio, source}.
    """
    result = {
        'free_cash_flow': None, 'cash_on_hand': None, 'operating_cf': None,
        'total_assets': None, 'debt': None, 'cash_ratio': None, 'debt_ratio': None,
        'source': 'unavailable',
    }
    if de_conn is None:
        return result
    # 1. tabs_data (TradingView balance sheet + cash flow arrays)
    try:
        row = de_conn.execute("SELECT tabs_data FROM stocks WHERE symbol = ? LIMIT 1", (ticker,)).fetchone()
        if row and row[0]:
            j = json.loads(row[0])
            bs = j.get('بَيَانُ المُوَازَنَة') or j.get('بيان الموازنة') or []
            cf = j.get('التدفقات النقدية') or []
            if isinstance(bs, list) and len(bs) >= 8:
                ta = _parse_egp_value(bs[3])     # index 3 = total_assets
                cash = _parse_egp_value(bs[7])   # index 7 = cash
                debt = _parse_egp_value(bs[9]) if len(bs) > 9 else None  # index 9 = debt
                if ta and ta > 0:
                    result['total_assets'] = round(ta, 0)
                if cash is not None:
                    result['cash_on_hand'] = round(cash, 0)
                if debt is not None:
                    result['debt'] = round(debt, 0)
                if ta and ta > 0 and cash is not None:
                    result['cash_ratio'] = round(cash / ta, 4)
                if ta and ta > 0 and debt is not None:
                    result['debt_ratio'] = round(debt / ta, 4)
            if isinstance(cf, list) and len(cf) >= 7:
                op_cf = _parse_egp_value(cf[3])    # index 3 = operating_cf
                free_cf = _parse_egp_value(cf[6])  # index 6 = free_cf
                if op_cf is not None:
                    result['operating_cf'] = round(op_cf, 0)
                if free_cf is not None:
                    result['free_cash_flow'] = round(free_cf, 0)
            if result['total_assets'] or result['free_cash_flow'] is not None:
                result['source'] = 'tabs_data (TradingView balance sheet + cash flow)'
                return result
    except Exception:
        pass
    # 2. Fallback: tab_balance_sheet + tab_cash_flow tables by symbol
    try:
        bs_row = de_conn.execute(
            "SELECT cash, total_assets, debt FROM tab_balance_sheet WHERE symbol = ? ORDER BY fiscal_end DESC LIMIT 1",
            (ticker,)).fetchone()
        cf_row = de_conn.execute(
            "SELECT operating_cf, free_cf FROM tab_cash_flow WHERE symbol = ? ORDER BY fiscal_end DESC LIMIT 1",
            (ticker,)).fetchone()
        if bs_row:
            cash = _to_float(bs_row[0]); ta = _to_float(bs_row[1]); debt = _to_float(bs_row[2])
            if ta > 0:
                result['total_assets'] = round(ta, 0)
                if cash >= 0:
                    result['cash_on_hand'] = round(cash, 0)
                result['cash_ratio'] = round(cash / ta, 4) if cash >= 0 else None
            if debt > 0:
                result['debt'] = round(debt, 0)
                result['debt_ratio'] = round(debt / ta, 4) if ta > 0 else None
        if cf_row:
            op_cf = _to_float(cf_row[0]); free_cf = _to_float(cf_row[1])
            if op_cf:
                result['operating_cf'] = round(op_cf, 0)
            if free_cf:
                result['free_cash_flow'] = round(free_cf, 0)
        if result['total_assets'] or result['free_cash_flow'] is not None:
            result['source'] = 'tab_balance_sheet + tab_cash_flow'
    except Exception:
        pass
    return result


def _check_tv_whale(ticker: str, de_conn: Optional[sqlite3.Connection]) -> Dict[str, Any]:
    """TradingView Screener flag — True if stock is in 'unusual_volume' or 'most_active' list.

    Source: data_engine.db/screener_lists (populated by tradingview_market_movers scraper).
    """
    result = {'tv_whale_spotted': False, 'tv_lists': [], 'tv_rank': None, 'source': 'screener_lists'}
    if de_conn is None:
        return result
    try:
        rows = de_conn.execute(
            "SELECT category, rank FROM screener_lists WHERE symbol = ? "
            "AND category IN ('unusual_volume','most_active') ORDER BY rank ASC",
            (ticker,)
        ).fetchall()
        if rows:
            result['tv_whale_spotted'] = True
            result['tv_lists'] = [r[0] for r in rows]
            result['tv_rank'] = rows[0][1]
    except Exception:
        pass
    return result


# ─── 1. فلتر حالة السوق (إلزامي أولًا) ─────────────────────────────────────


def detect_market_regime(conn: sqlite3.Connection, market: str) -> Dict[str, Any]:
    """فلتر حالة السوق الإلزامي (SSOT — Single Source of Truth).

    Task B-25 fix: نحسب change_pct من (current_value, previous_close) بدل
    الاعتماد على حقل change_percent الفاسد في الـ DB (كان بيرجع -32.9%
    بينما القيمة الحقيقية -0.83%). ده يضمن إن كل المستهلكين (liquidity_radar
    + commercial_feed + daily_predictor) يشوفوا نفس النسبة الصحيحة.

    يرجع:
       - regime: 'صاعد' / 'هابط' / 'عرضي' / 'Risk-Off'
       - change_pct: تغير المؤشر المحسوب من current/previous (مش من DB field)
       - index_symbol: رمز المؤشر المستخدم
    """
    # Task B-26: جرّب كل المؤشرات في قائمة fallbacks بالترتيب
    index_candidates = MARKET_INDEX_FALLBACKS.get(market, ['EGX30'])
    row = None
    index_symbol_used = index_candidates[0] if index_candidates else 'EGX30'

    for cand in index_candidates:
        try:
            row = conn.execute("""
                SELECT symbol, current_value, previous_close, change_percent
                FROM market_indices
                WHERE symbol = ? OR name LIKE ?
                ORDER BY last_update DESC
                LIMIT 1
            """, (cand, f'%{cand}%')).fetchone()
            if row is not None:
                index_symbol_used = row[0] if row[0] else cand
                break
        except Exception:
            continue

    # العملة الحقيقية للسوق
    currency_info = get_market_currency(market)

    if row is None:
        # fallback: لو مفيش مؤشر، اعتبر السوق "عرضي" (محايد)
        return {
            'regime': 'عرضي',
            'regime_en': 'sideways',
            'change_pct': 0.0,
            'index_symbol': index_symbol_used,
            'currency': currency_info['currency'],
            'currency_ar': currency_info['currency_ar'],
            'reason': f'مؤشر {market} غير متاح في DB — افتراض عرضي محايد (عملة: {currency_info["currency_ar"]})',
            'is_bear': False,
            'is_bull': False,
        }

    # Task B-25 SSOT: احسب change_pct من current_value و previous_close
    # (لا تعتمد على change_percent field — فاسد في بعض الصفوف)
    current_value = _to_float(row[1])
    previous_close = _to_float(row[2])
    if current_value > 0 and previous_close > 0:
        change_pct = ((current_value - previous_close) / previous_close) * 100.0
    else:
        # fallback: حاول من آخر شمعتين في stock_daily_prices (نفس مصدر market_regime_engine)
        # ده يضمن توحيد 100% بين liquidity_radar + daily_predictor
        try:
            candle_rows = conn.execute("""
                SELECT close FROM stock_daily_prices
                WHERE ticker = ? AND COALESCE(close, 0) > 0
                ORDER BY price_date DESC LIMIT 2
            """, (index_symbol_used,)).fetchall()
            if len(candle_rows) >= 2:
                c1 = _to_float(candle_rows[0][0])
                c2 = _to_float(candle_rows[1][0])
                if c1 > 0 and c2 > 0:
                    change_pct = ((c1 - c2) / c2) * 100.0
                else:
                    change_pct = _to_float(row[3])
            else:
                change_pct = _to_float(row[3])
        except Exception:
            change_pct = _to_float(row[3])

    if change_pct <= MARKET_BEAR_THRESHOLD:
        regime = 'هابط'
        regime_en = 'bear'
        is_bear = True
        is_bull = False
        reason = f'مؤشر {row[0]} هابط {change_pct:.2f}% (≤ -{abs(MARKET_BEAR_THRESHOLD)}%) — سوق Risk-Off'
        # لو هابط بقوة أكبر من -3% → Risk-Off صريح
        if change_pct <= -3.0:
            regime = 'Risk-Off'
            regime_en = 'risk_off'
            reason = f'مؤشر {row[0]} هابط بقوة {change_pct:.2f}% — Risk-Off صريح'
    elif change_pct >= MARKET_BULL_THRESHOLD:
        regime = 'صاعد'
        regime_en = 'bull'
        is_bear = False
        is_bull = True
        reason = f'مؤشر {row[0]} صاعد {change_pct:.2f}% (≥ +{MARKET_BULL_THRESHOLD}%)'
    else:
        regime = 'عرضي'
        regime_en = 'sideways'
        is_bear = False
        is_bull = False
        reason = f'مؤشر {row[0]} عرضي {change_pct:.2f}% (بين -{abs(MARKET_BEAR_THRESHOLD)}% و +{MARKET_BULL_THRESHOLD}%)'

    return {
        'regime': regime,
        'regime_en': regime_en,
        'change_pct': round(change_pct, 2),
        'index_symbol': row[0],
        'currency': currency_info['currency'],
        'currency_ar': currency_info['currency_ar'],
        'reason': reason,
        'is_bear': is_bear,
        'is_bull': is_bull,
    }


# ─── 2. الحوت فين؟ (صافي الكاش المطلق) ────────────────────────────────────


def compute_whale_flow(candles: List[Dict[str, Any]], cash_ratio: Optional[float] = None) -> Dict[str, Any]:
    """حساب تدفق السيولة بـ Money Flow Multiplier (MFM) — BRAVO RADAR-REBUILD.

    🔴 FIX (DeepSeek + Grock audit): شيلنا close vs open (غلط جوهريًا).
    بدّلناه بـ Money Flow Multiplier اللي بيقولك فين قفل السهم جوه الـ range.

    المنطق الجديد:
      MFM = ((close - low) - (high - close)) / (high - low)
      - MFM > 0 → قفل قريب من high → buying pressure
      - MFM < 0 → قفل قريب من low → selling pressure
      - MFM = 0 → قفل في النص (أو high = low)

      money_flow = volume × close × MFM
      net_flow = sum(money_flow) لآخر 20 يوم
      avg_daily_flow = متوسط |money_flow| يومي

    العتبة (نسبية مش مطلقة):
      whale_threshold = avg_daily_flow × 0.6
      - 0.6 لأن: الحوت = تدفق > 60% من المتوسط اليومي.
        أقل من كده = ضجيج عادي. أكتر = مؤسسي.
      - نسبي عشان الأسهم الصغيرة والكبيرة يتعاملوا بنفس المعيار.

    Cash Safety Multiplier:
      🔴 اتشال من كشف الحوت (خلط مفاهيم — cash = fundamental، مش flow).
      بيفضل في الـ output للـ risk assessment فقط (position sizing).

    Thresholds موثّقة:
      - whale_threshold_mult = 0.6 (نسبي، موثّق أعلاه)
      - LOOKBACK_DAYS = 20 (3 أسابيع تداول — كفاية للـ trend + مش طويل جدًا)
      - MIN_CANDLES = 30 (أقل عدد شموع للحكم)
    """
    n = len(candles)
    if n == 0:
        return {
            'net_flow_egp': 0,
            'avg_daily_flow_egp': 0,
            'whale_present': False,
            'flow_strength': 'بيانات غير كافية',
            'reason': 'لا شموع متاحة',
            'cash_ratio': round(cash_ratio, 4) if cash_ratio else None,
            'cash_safety_multiplier': 1.0,  # kept for risk only, not whale detection
            'flow_method': 'MFM',
        }

    # Window selection (same flexibility as before)
    if n < 5:
        recent = candles[-1:]
        flow_mode = f'intraday-proxy ({n} شمعة)'
    elif n < MIN_CANDLES:
        recent = candles[:]
        flow_mode = f'dynamic ({n} شمعة)'
    else:
        recent = candles[-LOOKBACK_DAYS:]
        flow_mode = f'standard ({LOOKBACK_DAYS} يوم)'

    daily_flows = []
    buy_pressure_total = 0.0
    sell_pressure_total = 0.0

    for c in recent:
        close = _to_float(c.get('close'))
        high = _to_float(c.get('high'))
        low = _to_float(c.get('low'))
        vol = _to_float(c.get('volume'))
        if close <= 0 or vol <= 0:
            continue

        # Money Flow Multiplier
        range_val = high - low
        if range_val <= 0:
            mfm = 0.0  # doji / no range → neutral
        else:
            mfm = ((close - low) - (high - close)) / range_val

        money_flow = vol * close * mfm
        daily_flows.append(money_flow)

        if mfm > 0:
            buy_pressure_total += money_flow
        elif mfm < 0:
            sell_pressure_total += abs(money_flow)

    net_flow = sum(daily_flows)  # موجب = buying، سالب = selling
    avg_daily_flow = sum(abs(f) for f in daily_flows) / len(daily_flows) if daily_flows else 0

    # Whale threshold — RELATIVE (not absolute 2M)
    # 0.6 = 60% of avg daily flow. Documented: whale = flow > 60% of average.
    WHALE_THRESHOLD_MULT = 0.6
    whale_threshold = avg_daily_flow * WHALE_THRESHOLD_MULT

    # Cash ratio — kept in output for RISK ASSESSMENT only (not whale detection)
    cash_ratio = cash_ratio if cash_ratio is not None else 0.0
    if cash_ratio >= 0.20:
        cash_safety = 1.5    # high cash = safer company (risk metric only)
    elif cash_ratio >= 0.10:
        cash_safety = 1.2
    else:
        cash_safety = 1.0

    # Whale detection — flow-based only (no cash boost)
    if avg_daily_flow <= 0:
        flow_strength = 'بيانات غير كافية'
        whale_present = False
    elif net_flow > 0 and net_flow > whale_threshold:
        flow_strength = 'تدفق شراء قوي (MFM+)' + (' + كاش عالي' if cash_safety >= 1.5 else '')
        whale_present = True
    elif net_flow > 0:
        flow_strength = 'تدفق شراء ضعيف (MFM+)'
        whale_present = False
    elif net_flow < 0 and abs(net_flow) > whale_threshold:
        flow_strength = 'تدفق بيع قوي (MFM−) — تصريف'
        whale_present = False
    else:
        flow_strength = 'تدفق بيع ضعيف (MFM−)'
        whale_present = False

    reason = (
        f"صافي التدفق {net_flow/1e6:+.1f}M EGP ({flow_mode}) "
        f"(متوسط يومي {avg_daily_flow/1e6:.1f}M، عتبة الحوت {whale_threshold/1e6:.1f}M = {WHALE_THRESHOLD_MULT:.0%}) — {flow_strength}"
    )

    return {
        'net_flow_egp': round(net_flow, 0),
        'avg_daily_flow_egp': round(avg_daily_flow, 0),
        'whale_present': whale_present,
        'flow_strength': flow_strength,
        'cash_ratio': round(cash_ratio, 4) if cash_ratio else None,
        'cash_safety_multiplier': cash_safety,  # risk only, NOT whale detection
        'flow_method': 'MFM',  # Money Flow Multiplier (new)
        'whale_threshold_egp': round(whale_threshold, 0),
        'reason': reason,
    }


# ─── 3. المرحلة (3 حالات فقط) ────────────────────────────────────────────


def classify_phase(
    whale: Dict[str, Any],
    market: Dict[str, Any],
    candles: List[Dict[str, Any]],
    stock_info: Dict[str, Any],
) -> Dict[str, Any]:
    """تصنيف المرحلة — 3 حالات (مصطلحات واضحة، ممنوع Wyckoff).

    BRAVO RADAR-REBUILD: شيلنا "بيبلع على الهادي" / "بيبلع في الخفاء" (Wyckoff متناقض).
    بدّلناها بـ:
      - تراكم مع اتجاه (Trend Accumulation): MFM+ قوي + سعر فوق MA20
      - تراكم هادئ (Quiet Accumulation): MFM+ ضعيف/محايد + هيكل صاعد
      - تصريف (Distribution): MFM− سالب
      - بيانات غير كافية

    القواعد الكمية الصارمة:
      - لو السوق هابط/Risk-Off → ممنوع تراكم → تصريف
      - لو MFM سالب → تصريف
      - لو whale_present + close > MA20 → تراكم مع اتجاه
      - لو net_flow > 0 + close > MA20 → تراكم هادئ
      - غير كده → تصريف (افتراضي محافظ)
    """
    # 1. بيانات ناقصة
    if whale['flow_strength'] == 'بيانات غير كافية':
        return {
            'phase': PHASE_INSUFFICIENT,
            'reason': whale['reason'],
        }

    # 2. السوق هابط → ممنوع تراكم
    if market['is_bear']:
        if whale['net_flow_egp'] < 0:
            return {
                'phase': PHASE_DISTRIBUTING,
                'reason': f"سوق هابط + MFM سالب ({whale['net_flow_egp']/1e6:.1f}M) — تصريف",
            }
        return {
            'phase': PHASE_DISTRIBUTING,
            'reason': f"سوق هابط ({market['change_pct']:.2f}%) — ممنوع تراكم في Risk-Off",
        }

    # 3. MFM سالب → تصريف
    if whale['net_flow_egp'] < 0:
        return {
            'phase': PHASE_DISTRIBUTING,
            'reason': f"MFM سالب ({whale['net_flow_egp']/1e6:.1f}M EGP) — تصريف",
        }

    # 4. حساب هيكل السعر
    closes = [_to_float(c.get('close')) for c in candles if _to_float(c.get('close')) > 0]
    if len(closes) < 20:
        return {
            'phase': PHASE_INSUFFICIENT,
            'reason': 'أقل من 20 شمعة للحكم على الهيكل',
        }
    ma20 = sum(closes[-20:]) / 20
    last_close = closes[-1]

    # 5. whale_present + close > MA20 → تراكم مع اتجاه
    if whale['whale_present']:
        if last_close > ma20:
            return {
                'phase': PHASE_ABSORBING,
                'reason': f"MFM+ قوي ({whale['net_flow_egp']/1e6:.1f}M EGP) فوق MA20 — تراكم مع اتجاه",
            }
        else:
            return {
                'phase': PHASE_PREPARING,
                'reason': f"MFM+ قوي ({whale['net_flow_egp']/1e6:.1f}M EGP) تحت MA20 — تراكم هادئ",
            }

    # 6. MFM+ بدون حوت → تراكم هادئ
    if whale['net_flow_egp'] > 0:
        return {
            'phase': PHASE_PREPARING,
            'reason': f"MFM+ ضعيف ({whale['net_flow_egp']/1e6:.1f}M EGP) — تراكم هادئ",
        }

    # 7. افتراضي → تصريف
    return {
        'phase': PHASE_DISTRIBUTING,
        'reason': f"MFM سالب ({whale['net_flow_egp']/1e6:.1f}M EGP) — تصريف",
    }


# ─── 4. مستوى الدخول والدفاع ──────────────────────────────────────────────


def compute_entry_defense(
    candles: List[Dict[str, Any]],
    stock_info: Dict[str, Any],
) -> Dict[str, Any]:
    """حساب مستوى الدخول + مستوى الدفاع (الكسر = خروج).

    BRAVO RADAR-REBUILD Finding #4: entry_level مش آخر close (ده chase).
    الجديد: entry = close - 0.5×ATR (pullback buffer تحت السعر الحالي).
    لو مفيش ATR → fallback لـ support أو close - 2%.

    المنطق:
      - ATR = متوسط True Range لآخر 14 يوم
      - entry_level = last_close - 0.5×ATR (buffer للـ pullback)
      - defense_level = min(recent_low_10d, table_support)
      - resistance_level = max(recent_high_10d, table_resistance)
      - rr_at_current = R/R محسوب على entry_level الجديد (مش التوقع القديم)
    """
    # Helper: compute ATR
    def _compute_atr(cands, period=14):
        if len(cands) < 2:
            return 0.0
        trs = []
        for i in range(1, len(cands)):
            h = _to_float(cands[i].get('high'))
            l = _to_float(cands[i].get('low'))
            pc = _to_float(cands[i-1].get('close'))
            if h <= 0 or l <= 0 or pc <= 0:
                continue
            tr = max(h - l, abs(h - pc), abs(l - pc))
            trs.append(tr)
        if not trs:
            return 0.0
        recent_trs = trs[-period:] if len(trs) >= period else trs
        return sum(recent_trs) / len(recent_trs)

    if len(candles) < 10:
        support = _to_float(stock_info.get('support'))
        resistance = _to_float(stock_info.get('resistance'))
        last_close = _to_float(stock_info.get('current_price'))
        if last_close <= 0:
            return {
                'entry_level': None,
                'defense_level': None,
                'reason': 'بيانات غير كافية لحساب المستويات',
            }
        # Fallback: entry = support (لو موجود) أو close - 2%
        entry = support if support > 0 and support < last_close else round(last_close * 0.98, 4)
        defense = round(support, 4) if support > 0 else round(last_close * 0.95, 4)
        return {
            'entry_level': round(entry, 4) if entry > 0 else None,
            'defense_level': defense,
            'resistance_level': round(resistance, 4) if resistance > 0 else None,
            'reason': f'مستويات من جدول stocks (entry={entry:.2f}, support={support:.2f})',
        }

    recent = candles[-10:]
    lows = [_to_float(c.get('low')) for c in recent if _to_float(c.get('low')) > 0]
    highs = [_to_float(c.get('high')) for c in recent if _to_float(c.get('high')) > 0]
    closes = [_to_float(c.get('close')) for c in recent if _to_float(c.get('close')) > 0]

    if not lows or not closes:
        return {
            'entry_level': None,
            'defense_level': None,
            'reason': 'بيانات غير كافية لحساب المستويات',
        }

    last_close = closes[-1]
    recent_low = min(lows)
    recent_high = max(highs) if highs else last_close

    table_support = _to_float(stock_info.get('support'))
    table_resistance = _to_float(stock_info.get('resistance'))

    # ATR-based entry (Finding #4 fix)
    atr = _compute_atr(candles, period=14)
    if atr > 0:
        entry_level = round(last_close - 0.5 * atr, 4)
        entry_method = f'close - 0.5×ATR (ATR={atr:.2f})'
    else:
        # Fallback: support or close - 2%
        if table_support > 0 and table_support < last_close:
            entry_level = round(table_support, 4)
            entry_method = f'table support ({table_support:.2f})'
        else:
            entry_level = round(last_close * 0.98, 4)
            entry_method = 'close - 2% (no ATR)'

    defense = min(recent_low, table_support) if table_support > 0 else recent_low
    resistance = max(recent_high, table_resistance) if table_resistance > 0 else recent_high

    reason = (
        f"دخول {entry_level:.2f} ({entry_method}) | دفاع {defense:.2f} "
        f"(أدنى قاع 10 أيام) | مقاومة {resistance:.2f}"
    )

    return {
        'entry_level': entry_level,
        'defense_level': round(defense, 4),
        'resistance_level': round(resistance, 4),
        'atr': round(atr, 4) if atr > 0 else None,
        'entry_method': entry_method,
        'reason': reason,
    }




# ─── Task BRAVO-FALLING-KNIFE: فحص السكين الساقط (Rule 78/79) ──────────


def check_falling_knife(
    candles: List[Dict[str, Any]],
    stock_info: Dict[str, Any],
    market_regime: Dict[str, Any],
) -> Dict[str, Any]:
    """فحص السكين الساقط — CANONICAL FIRST + structural layer.

    BRAVO-RADAR-PRED-AUDIT-001 Fix 4 (unify Falling Knife):
    طبقتان متكاملتان (مش متناقضتان):
      1. CANONICAL (api/canonical_flow.py:_is_falling_knife): short-term crash
         — drop_3d > 10% AND price < SMA50.
      2. STRUCTURAL (Rule 78/79): deviation_from_ma50 < -5% + MA50 < MA200
         + bear market + stock down.

    لو canonical يقول FK → نرجّع FK على طول (short-term crash = highest priority).
    لو canonical مش متاح OR مش FK → نطبق structural check.

    Returns:
        {
            'is_falling_knife': bool,
            'targets_available': bool,  # False لو falling knife أو سوق هابط
            'reason': str,               # سبب عربي مختصر
        }
    """
    current_price = _to_float(stock_info.get('current_price'))

    # ─── BRAVO RADAR-REBUILD Finding #7: Hard crash = AVOID regardless of MA50 ──
    # لو السهم نزل > 12% في 3 جلسات → سقوط حر → AVOID فوري.
    # ده OR مش AND — السهم ممكن يكون لسه فوق SMA50 بس النزول > 12% = خطر.
    if candles and len(candles) >= 3:
        recent_3 = candles[-3:]
        highs_3 = [_to_float(c.get('high')) for c in recent_3 if _to_float(c.get('high')) > 0]
        last_close_3 = _to_float(recent_3[-1].get('close'))
        if highs_3 and last_close_3 > 0:
            peak_3d = max(highs_3)
            drop_3d_pct = ((peak_3d - last_close_3) / peak_3d) * 100.0
            HARD_CRASH_THRESHOLD = 12.0  # موثّق: 12% في 3 جلسات = سقوط حر
            if drop_3d_pct > HARD_CRASH_THRESHOLD:
                return {
                    'is_falling_knife': True,
                    'targets_available': False,
                    'reason': f'[HARD-CRASH] هبوط {drop_3d_pct:.1f}% في 3 جلسات (>{HARD_CRASH_THRESHOLD}%) — سقوط حر — لا أهداف (Finding #7)',
                }

    # ─── Layer 1: CANONICAL short-term crash detector (drop_3d > 10% + below SMA50) ──
    # BRAVO-AUDIT Fix 4: ده الكنسي. لو متاح، نطبقه الأول عشان نتطابق مع
    # canonical_flow.classify_liquidity_bucket (نفس السهم = نفس الحكم).
    if _canonical_is_falling_knife is not None and candles:
        closes = [c for c in (_to_float(x.get('close')) for x in candles) if c > 0]
        sma50_canonical = _canonical_compute_ma(closes, _CANONICAL_SMA50_PERIOD) if _canonical_compute_ma else None
        if current_price > 0 and sma50_canonical is not None:
            is_fk, reason = _canonical_is_falling_knife(candles, current_price, sma50_canonical)
            if is_fk:
                return {
                    'is_falling_knife': True,
                    'targets_available': False,
                    'reason': f'[CANONICAL] {reason}',
                }

    # ─── Layer 2: STRUCTURAL breakdown (Rule 78/79 — deviation + MA200) ──────────
    ma_50 = _to_float(stock_info.get('ma_50'))
    ma_200 = _to_float(stock_info.get('ma_200'))
    change_pct = _to_float(stock_info.get('change_percent'))

    # Task BRAVO-MA200-UNCHOKE: لو MA200 أو MA50 مفقود من جدول stocks،
    # احسب EMA20 + SMA50 ديناميكياً من stock_daily_prices (candles).
    ema20 = 0.0
    sma50 = 0.0
    if candles:
        closes_all = [c for c in (_to_float(x.get('close')) for x in candles) if c > 0]
        if len(closes_all) >= 50:
            sma50 = sum(closes_all[-50:]) / 50
        elif len(closes_all) >= 20:
            sma50 = sum(closes_all) / len(closes_all)
        if len(closes_all) >= 20:
            k = 2 / (20 + 1)
            ema = sum(closes_all[:20]) / 20
            for p in closes_all[20:]:
                ema = (p - ema) * k + ema
            ema20 = ema

    # long-term trend: MA200 من جدول stocks، fallback لـ SMA50 (ديناميكي).
    long_ma = ma_200 if ma_200 > 0 else sma50
    # medium-term trend: MA50 من جدول stocks، fallback لـ EMA20 (ديناميكي).
    medium_ma = ma_50 if ma_50 > 0 else ema20
    ma_source = 'table' if (ma_200 > 0 and ma_50 > 0) else 'dynamic EMA20/SMA50 from stock_daily_prices'

    # Rule 79: Falling Knife — سهم تحت MA50 بـ >5% + MA50 < long_ma
    if medium_ma > 0 and long_ma > 0 and current_price > 0:
        deviation_from_ma50 = ((current_price - medium_ma) / medium_ma) * 100.0
        if deviation_from_ma50 < -5.0 and medium_ma < long_ma:
            return {
                'is_falling_knife': True,
                'targets_available': False,
                'reason': f'[STRUCTURAL] سكين ساقط: السعر تحت MA50 بـ {deviation_from_ma50:.1f}% + MA50 < MA200 — لا أهداف صاعدة (Rule 79)',
            }

    # Rule 78: سوق هابط + السهم هابط → لا أهداف
    if market_regime.get('is_bear') and change_pct < 0:
        return {
            'is_falling_knife': False,
            'targets_available': False,
            'reason': f'سوق هابط ({market_regime["change_pct"]:.2f}%) + السهم هابط ({change_pct:.2f}%) — لا أهداف صاعدة (Rule 78)',
        }

    # Task BRAVO-MA200-UNCHOKE: لا تعطّل الأهداف لمجرد غياب MA200.
    # لو في سعر إغلاق حقيقي + قاع دفاعي واضح (support أو recent low) → أهداف متاحة.
    support = _to_float(stock_info.get('support'))
    has_real_close = current_price > 0
    has_defense = support > 0 or (candles and ema20 > 0)
    if has_real_close and has_defense:
        return {
            'is_falling_knife': False,
            'targets_available': True,
            'reason': f'السهم سليم — أهداف متاحة (MA src: {ma_source})',
        }

    # فعلاً لا بيانات (لا سعر ولا قاع)
    return {
        'is_falling_knife': False,
        'targets_available': False,
        'reason': 'لا سعر إغلاق حقيقي ولا قاع دفاعي — لا أهداف',
    }


# ─── فحص السيولة الأدنى ──────────────────────────────────────────────────


def check_liquidity(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """فحص السيولة الأدنى. لو متوسط القيمة اليومية < 3M EGP/SAR → ضعيف."""
    n = len(candles)
    if n == 0:
        return {'liquid': False, 'reason': 'لا شموع متاحة'}

    # للأسواق المنضمة حديثاً (< MIN_CANDLES): احسب من الشموع المتاحة
    recent = candles if n < MIN_CANDLES else candles[-LOOKBACK_DAYS:]
    daily_values = []
    for c in recent:
        close = _to_float(c.get('close'))
        vol = _to_float(c.get('volume'))
        if close > 0 and vol > 0:
            daily_values.append(close * vol)

    if not daily_values:
        return {'liquid': False, 'reason': 'مفيش بيانات حجم'}

    avg_turnover = sum(daily_values) / len(daily_values)
    if avg_turnover < MIN_TURNOVER_EGP:
        return {
            'liquid': False,
            'reason': f'سيولة ضعيفة (متوسط {avg_turnover/1e6:.2f}M EGP < {MIN_TURNOVER_EGP/1e6}M)',
            'avg_turnover_egp': round(avg_turnover, 0),
        }

    return {
        'liquid': True,
        'reason': f'سيولة كافية (متوسط {avg_turnover/1e6:.2f}M EGP)',
        'avg_turnover_egp': round(avg_turnover, 0),
    }


# ─── المسح الكامل ──────────────────────────────────────────────────────────


def scan_ticker(conn: sqlite3.Connection, ticker: str, market: str, market_regime: Dict[str, Any]) -> Dict[str, Any]:
    """امسح سهم واحد ورجّع الـ 4 أعمدة."""
    # جلب بيانات السهم
    stock_row = conn.execute("""
        SELECT ticker, name, name_ar, market, sector, current_price,
               support, resistance, ma_50, ma_200, rsi, change_percent
        FROM stocks
        WHERE ticker = ? AND market = ?
    """, (ticker, market)).fetchone()

    if stock_row is None:
        return {
            'ticker': ticker,
            'market': market,
            'whale': {'whale_present': False, 'reason': 'السهم غير موجود'},
            'market_regime': market_regime,
            'phase': PHASE_INSUFFICIENT,
            'entry_defense': {'entry_level': None, 'defense_level': None},
            'reason': 'السهم غير موجود في قاعدة البيانات',
            # TASK-BACKEND-BRAVO: canonical mutually-exclusive bucket (neutral fallback).
            'liquidity_bucket': 'neutral',
            'liquidity_bucket_ar': _BUCKET_LABEL_AR.get('neutral', 'حياد'),
            'net_flow_5d': 0.0,
        }

    # بناء dict من stock_row باستخدام أسماء الأعمدة الصحيحة من الاستعلام الأول
    col_names = ['ticker', 'name', 'name_ar', 'market', 'sector', 'current_price',
                 'support', 'resistance', 'ma_50', 'ma_200', 'rsi', 'change_percent']
    stock_info = dict(zip(col_names, stock_row))

    # جلب الشموع
    candle_rows = conn.execute("""
        SELECT price_date, open, high, low, close, volume
        FROM stock_daily_prices
        WHERE ticker = ? AND COALESCE(close, 0) > 0 AND COALESCE(volume, 0) > 0
        ORDER BY price_date ASC
    """, (ticker,)).fetchall()
    candles = [dict(zip(['price_date', 'open', 'high', 'low', 'close', 'volume'], r)) for r in candle_rows]

    # 0. فحص السيولة أولًا
    liquidity = check_liquidity(candles)
    if not liquidity['liquid']:
        return {
            'ticker': ticker,
            'name': stock_info.get('name_ar') or stock_info.get('name') or ticker,
            'market': market,
            'sector': arabize_sector(stock_info.get('sector', '')),
            'whale': {
                'net_flow_egp': 0,
                'avg_daily_flow_egp': 0,
                'whale_present': False,
                'flow_strength': 'سيولة ضعيفة',
                'reason': liquidity['reason'],
            },
            'market_regime': market_regime,
            'phase': PHASE_INSUFFICIENT,
            'entry_defense': {'entry_level': None, 'defense_level': None, 'reason': 'سيولة ضعيفة'},
            'reason': f'سيولة ضعيفة — {liquidity["reason"]}',
            # TASK-BACKEND-BRAVO: even low-liquidity stocks get classified (usually neutral).
            'liquidity_bucket': 'neutral',
            'liquidity_bucket_ar': _BUCKET_LABEL_AR.get('neutral', 'حياد'),
            'net_flow_5d': 0.0,
        }

    # Task BRAVO-CASH-LINKAGE: فتح data_engine.db لسحب fundamentals (cash + free_cf + operating_cf + debt) + screener_lists.
    de_conn = sqlite3.connect(f"file:{DATA_ENGINE_DB}?mode=ro", uri=True) if DATA_ENGINE_DB.exists() else None
    fundamentals = _compute_fundamentals(ticker, de_conn)
    tv_whale = _check_tv_whale(ticker, de_conn)

    # 1. الحوت فين؟ (+ Cash Safety Multiplier من cash_ratio)
    whale = compute_whale_flow(candles, cash_ratio=fundamentals.get('cash_ratio'))
    if de_conn is not None:
        de_conn.close()

    # Task BRAVO-CASH-LINKAGE: قاعدة القرار — تجميع مؤسسي مدعوم بتدفق نقدي حقيقي vs مضاربة خطرة.
    _net_flow = whale.get('net_flow_egp', 0)
    _free_cf = fundamentals.get('free_cash_flow')
    _debt_ratio = fundamentals.get('debt_ratio')
    accumulation_class = None

    # ─── SEALED-DISPATCH Step 2 (2026-10-17): prevent fake "تجميع" when
    # there's no active BUY-side prediction in predictions.db.
    #
    # Rule 27 (NO-FAKE-DATA): لو V40.2 مكتوبش توقع نشط على السهم ده،
    # فالـ "تجميع مؤسسي" label بيبقى fake signal. لازم نشيله.
    #
    # AIH acceptance test: لما السهم مفيهوش توقع نشط، الـ accumulation_class
    # لازم يبقى None (ما يظهرش "تجميع" في الناتج).
    _active_pred = _fetch_active_prediction(ticker, market)
    if _active_pred is None:
        # No active prediction → suppress "تجميع" label entirely
        # (but still allow "مضاربة خطرة" if free_cf < 0 + debt > 0.5 —
        # that's a warning signal, not an accumulation claim)
        if _free_cf is not None and _free_cf < 0 and _debt_ratio is not None and _debt_ratio > 0.5:
            accumulation_class = 'مضاربة خطرة سريعة'
        # accumulation_class stays None — no fake "تجميع مؤسسي" label
    else:
        # Active prediction exists → safe to evaluate "تجميع مؤسسي" label
        if _net_flow > 0 and _free_cf is not None and _free_cf > 0:
            accumulation_class = 'تجميع مؤسسي مدعوم بتدفق نقدي حقيقي'
        elif _free_cf is not None and _free_cf < 0 and _debt_ratio is not None and _debt_ratio > 0.5:
            accumulation_class = 'مضاربة خطرة سريعة'

    # 2. حالة السوق (تم حسابها مسبقًا)
    # market_regime passed in

    # 3. المرحلة
    phase_info = classify_phase(whale, market_regime, candles, stock_info)

    # 4. مستوى الدخول والدفاع — LIVE-RADAR-005: dual-source architecture
    # SEALED-DISPATCH-LIVE-RADAR-005 (2026-10-18):
    #   - entry/stop/target from predictions.db (daily — V40.2's active prediction)
    #   - None when no active prediction (NOT fabricated — Rule 27 NO-FAKE-DATA)
    #   - The radar still shows the stock (price/whale/phase from stocks.db live);
    #     only the entry/stop/target columns show "—" when no prediction.
    if _active_pred is not None:
        entry_defense = {
            'entry_level': _active_pred.get('entry_price'),
            'defense_level': _active_pred.get('stop_loss'),
            'resistance_level': _active_pred.get('target_price'),
            'reason': 'من predictions.db — توقع V40.2 نشط',
            'targets_available': True,
            'source': 'predictions.db',
        }
    else:
        # No active prediction → entry/stop/target = None (Rule 27: no fabrication)
        # The stock STILL shows in the radar (price/whale/phase from stocks.db)
        entry_defense = {
            'entry_level': None,
            'defense_level': None,
            'resistance_level': None,
            'reason': 'مفيش توقع نشط في predictions.db — اعرض "—" في الدخول/الوقف/الهدف',
            'targets_available': False,
            'source': 'none',
        }

    # 5. Task BRAVO-FALLING-KNIFE: فحص السكين الساقط (Rule 78/79)
    falling_knife = check_falling_knife(candles, stock_info, market_regime)

    # Rule 78/79: لو falling knife → تعطيل entry_level حتى لو في توقع نشط
    # (السهم في هبوط حر — حتى V40.2's targets بتتعطّل)
    if not falling_knife['targets_available']:
        entry_defense = {
            'entry_level': None,
            'defense_level': entry_defense.get('defense_level'),
            'resistance_level': entry_defense.get('resistance_level'),
            'reason': f'الأهداف معطّلة — {falling_knife["reason"]}',
            'targets_available': False,
            'source': entry_defense.get('source', 'none'),
        }
    # else: keep entry_defense as-is (from predictions.db or none)

    # السبب المختصر (جملة واحدة)
    short_reason = (
        f"{phase_info['reason']} | {whale['reason']}"
    )
    if falling_knife['is_falling_knife']:
        short_reason += f" | ⚠️ {falling_knife['reason']}"

    # TASK-BACKEND-BRAVO (2026-10-15): canonical mutually-exclusive liquidity bucket.
    # This is the NEW canonical classification — the legacy `phase` field above
    # is kept for backward compatibility. `liquidity_bucket` is the SSOT.
    _bucket_cls = _classify_bucket_safe(conn, ticker, market)

    return {
        'ticker': ticker,
        'name': stock_info.get('name_ar') or stock_info.get('name') or ticker,
        'market': market,
        'sector': arabize_sector(stock_info.get('sector', '')),
        # BRAVO-LIQUIDITY-RADAR-AUDIT: add current_price + change_percent for UI
        'current_price': _to_float(stock_info.get('current_price')),
        'change_percent': _to_float(stock_info.get('change_percent')),
        'whale': whale,
        'market_regime': market_regime,
        'phase': phase_info['phase'],
        'phase_reason': phase_info['reason'],
        'entry_defense': entry_defense,
        'falling_knife': falling_knife,
        'targets_available': falling_knife['targets_available'],
        # Task BRAVO-CASH-LINKAGE: fundamentals + accumulation_class
        'fundamentals': fundamentals,
        'accumulation_class': accumulation_class,
        # SEALED-DISPATCH Step 1+2 (2026-10-17): expose the active prediction
        # reference (READ-ONLY from predictions.db). This is the source-of-truth
        # link between V40.2's prediction and the radar's contextual signal.
        # None means: V40.2 has not (yet) issued an active prediction for this
        # ticker → accumulation_class is forced to None (Step 2 guard).
        'active_prediction': _active_pred,
        'has_active_prediction': _active_pred is not None,
        'tv_whale_spotted': tv_whale['tv_whale_spotted'],
        'tv_lists': tv_whale.get('tv_lists', []),
        'tv_rank': tv_whale.get('tv_rank'),
        'reason': short_reason,
        # TASK-BACKEND-BRAVO: canonical mutually-exclusive liquidity bucket.
        'liquidity_bucket': _bucket_cls['liquidity_bucket'],
        'liquidity_bucket_ar': _bucket_cls['liquidity_bucket_ar'],
        'net_flow_5d': _bucket_cls['net_flow_5d'],
    }


def scan_market(market: str, tickers: Optional[List[str]] = None) -> Dict[str, Any]:
    """امسح سوق كامل ورجّع الـ 4 أعمدة لكل سهم."""
    if not STOCKS_DB.exists():
        return {
            'success': False,
            'error': f'stocks.db غير موجود: {STOCKS_DB}',
            'market': market,
            'market_regime': None,
            'scanned_count': 0,
            'phases_breakdown': {},
            'macro_summary': {
                'total_net_institutional_buy_egp_m': 0,
                'positive_flow_ratio_pct': 0,
                'positive_flow_count': 0,
                'targets_available_count': 0,
                'falling_knife_count': 0,
                'currency': 'ج.م',
                'currency_ar': 'جنيه مصري',
            },
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'stocks': [],
        }

    conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # 1. فلتر حالة السوق (إلزامي أولًا)
    market_regime = detect_market_regime(conn, market)
    log(f"حالة السوق ({market}): {market_regime['regime']} — {market_regime['reason']}")

    # 2. جلب قائمة الأسهم
    if tickers:
        ticker_list = tickers
    else:
        rows = conn.execute("""
            SELECT ticker FROM stocks
            WHERE market = ? AND is_active = 1 AND current_price IS NOT NULL AND current_price > 0
            ORDER BY ticker
        """, (market,)).fetchall()
        ticker_list = [r[0] for r in rows]

    log(f"جاري مسح {len(ticker_list)} سهم في سوق {market}...")

    results = []
    for i, ticker in enumerate(ticker_list):
        if (i + 1) % 50 == 0:
            log(f"  {i+1}/{len(ticker_list)}...")
        result = scan_ticker(conn, ticker, market, market_regime)
        results.append(result)

    conn.close()

    # إحصائيات سريعة
    phases = {}
    for r in results:
        p = r['phase']
        phases[p] = phases.get(p, 0) + 1

    # Task BRAVO-MACRO: حقول الماكرو الإجمالية لشريط النبض العلوي
    # 1. إجمالي صافي الشراء المؤسسي اليوم بالمليون (مجموع net_flow_egp لكل الأسهم)
    total_net_flow_egp = sum(
        r.get('whale', {}).get('net_flow_egp', 0) for r in results
    )
    total_net_institutional_buy_egp_m = round(total_net_flow_egp / 1e6, 1)

    # 2. نسبة سيولة الأسهم الإيجابية (نسبة الأسهم ذات التدفق الموجب)
    positive_flow_count = sum(
        1 for r in results
        if r.get('whale', {}).get('net_flow_egp', 0) > 0
    )
    positive_flow_ratio_pct = round(
        (positive_flow_count / len(results) * 100) if results else 0, 1
    )

    # 3. عدد الأسهم المتاحة للأهداف (targets_available = True)
    targets_available_count = sum(
        1 for r in results if r.get('targets_available', False)
    )

    # 4. عدد الأسهم المحذورة (falling knife)
    falling_knife_count = sum(
        1 for r in results
        if r.get('falling_knife', {}).get('is_falling_knife', False)
    )

    return {
        'success': True,
        'market': market,
        'market_regime': market_regime,
        'scanned_count': len(results),
        'phases_breakdown': phases,
        # Task BRAVO-MACRO: حقول الماكرو لشريط النبض العلوي
        'macro_summary': {
            'total_net_institutional_buy_egp_m': total_net_institutional_buy_egp_m,
            'positive_flow_ratio_pct': positive_flow_ratio_pct,
            'positive_flow_count': positive_flow_count,
            'targets_available_count': targets_available_count,
            'falling_knife_count': falling_knife_count,
            'currency': market_regime.get('currency', 'ج.م'),
            'currency_ar': market_regime.get('currency_ar', 'جنيه مصري'),
        },
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'stocks': results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="رادار السيولة الصارم — 4 أعمدة فقط")
    parser.add_argument('--market', type=str, default='EGX', help='السوق (EGX, TADAWUL, KSE, QSE)')
    parser.add_argument('--ticker', type=str, default=None, help='سهم محدد')
    parser.add_argument('--json', action='store_true', help='JSON output')
    args = parser.parse_args()

    tickers = [args.ticker] if args.ticker else None
    result = scan_market(args.market, tickers)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    else:
        log("=" * 70)
        log("🛰️ رادار السيولة الصارم — 4 أعمدة فقط")
        log("=" * 70)
        mr = result.get('market_regime', {})
        log(f"السوق: {result.get('market')} | حالة السوق: {mr.get('regime')} ({mr.get('change_pct')}%)")
        log(f"السبب: {mr.get('reason')}")
        log(f"إجمالي الأسهم: {result.get('scanned_count')}")
        log(f"توزيع المراحل: {result.get('phases_breakdown')}")
        log("")
        log("أول 10 أسهم:")
        for s in result.get('stocks', [])[:10]:
            log(f"  {s['ticker']:10} | {s['phase']:25} | تدفق={s['whale'].get('net_flow_egp',0)/1e6:+.1f}M | دخول={s['entry_defense'].get('entry_level')} | دفاع={s['entry_defense'].get('defense_level')}")
            cb = s.get('fundamentals', {})
            if cb.get('cash_on_hand') is not None:
                cash_str = f"كاش={(cb.get('cash_on_hand') or 0)/1e9:.2f}B | free_cf={(cb.get('free_cash_flow') or 0)/1e9:+.2f}B | op_cf={(cb.get('operating_cf') or 0)/1e9:.2f}B | نسبة_كاش={cb.get('cash_ratio')}"
            else:
                cash_str = "fundamentals=غير متاح"
            acc = s.get('accumulation_class')
            acc_str = f"⚡ {acc}" if acc else "محايد"
            tv_str = f"TV whale={'✓' if s.get('tv_whale_spotted') else '✗'} rank={s.get('tv_rank')} {','.join(s.get('tv_lists',[]))}" if s.get('tv_whale_spotted') else "TV whale=✗"
            log(f"    {cash_str}")
            log(f"    {tv_str} | {acc_str} | {s['reason'][:80]}")
        log("")

    return 0


if __name__ == '__main__':
    sys.exit(main())
