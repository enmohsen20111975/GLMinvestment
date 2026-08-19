"""
data/analyses.py — THE data layer for analysis persistence.
================================================================

PHASE 3-A of SIMPLIFICATION_PLAN (v3.52.0).

This module is the data layer (per principle P4: Layered Architecture —
`data/` = all DB access) for everything related to `stored_analyses`,
`cached_analysis`, persona opportunity flags, market resolution, and
the unified write path used by `core.analysis_runner.run_analysis_batch`.

Public API
----------
    get_predictions_db() -> sqlite3.Connection
        Open predictions.db with WAL + 30s busy timeout.

    get_stocks_db() -> sqlite3.Connection
        Open stocks.db with WAL + 30s busy timeout.

    load_market_overrides() -> Dict[str, str]
        Cached symbol→market map from data_engine.db.egksco_stocks (10 min TTL).

    resolve_market(ticker, fallback_market='EGX') -> str
        Resolve the canonical market for a ticker.

    persist_analysis_with_persona(conn, result, market, stock, turnover_egp,
                                  technical_score, fundamental_score) -> bool
        THE unified write path used by run_analysis_batch and the
        trigger/maestro routes. Inserts a stored_analyses row with all
        persona flags.

    _safe_float(val) -> float
        Defensive float coercion (returns 0.0 on failure).

    _load_stocks_fundamentals_for_persona() -> dict
        Cached pe_ratio/roe/change_1d/... loader from stocks.db (10 min TTL).

    _compute_persona_opportunity_flags(ticker, stored_vol_ratio, rec,
                                       turnover_egp) -> dict
        Compute is_gambler/is_investor flags + rank scores via the C1
        `core.opportunity_quality` module (with legacy fallback).

    _ensure_cached_analysis_columns(conn) -> None
        Safe migration: ALTER TABLE cached_analysis ADD COLUMN ... (idempotent).

    _ensure_stored_analyses_columns(conn) -> None
        Safe migration: ALTER TABLE stored_analyses ADD COLUMN ... (idempotent).

Design
------
1. **Mechanical extraction**: these 10 functions + their module-level
   state were moved verbatim from `analyzers/background_analyzer.py`
   (PHASE 3-A, Task P3-2-EXTRACT). No logic changes.
2. **Backward-compat**: `background_analyzer.py` re-exports all 10 via
   `from data.analyses import (...)` so existing callers
   (`from analyzers.background_analyzer import persist_analysis_with_persona`)
   keep working.
3. **Caching**: `_market_override_cache`, `_PERSONA_FUND_CACHE` are
   process-level + remain in this module (they were global state in the
   old background_analyzer.py — moving them here preserves the cache
   lifecycle across requests).

Rules (enforced by CI in PHASE 7)
---------------------------------
- NO file outside `data/` may write to `stored_analyses` directly.
  All writes go through `persist_analysis_with_persona`.
- NO file outside `data/` may define `_ensure_stored_analyses_columns`
  or `_ensure_cached_analysis_columns` — schema migrations live here.
"""

import os
import sys
import sqlite3
import logging
from pathlib import Path
from typing import Dict, Optional

# Add parent directory to path so `from config import ...` and
# `from utils.helpers import ...` work when this module is imported as
# `data.analyses` (mirrors the sys.path setup in background_analyzer.py).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Module-level logger
logger = logging.getLogger(__name__)

# PROD-HOTFIX (P0-3): parse_volume لفك صيغ TradingView النصية ('792.7 K', '12.74 M').
# بيُستخدم في _load_stocks_fundamentals_for_persona عشان الـ live filter يشتغل صح.
try:
    from utils.helpers import parse_volume
except Exception:  # pragma: no cover - defensive
    def parse_volume(value):  # type: ignore[no-redef]
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

# Import config for correct database paths
try:
    from config import DATABASE_PATH, PROJECT_ROOT
    STOCKS_DB = DATABASE_PATH
except ImportError:
    # Fallback
    BASE_DIR = Path(__file__).parent.parent.parent.resolve()
    STOCKS_DB = str(BASE_DIR / 'db' / 'stocks.db')
    PROJECT_ROOT = BASE_DIR

# C1-PERSONA-OPPORTUNITY: منطق الفرص الموحّد (live filter + quality gate + investor fallback)
try:
    from core.opportunity_quality import compute_persona_flags as _c1_compute_persona_flags
    C1_OPPORTUNITY_AVAILABLE = True
except ImportError as e:
    print(f"[data.analyses] opportunity_quality not available: {e}")
    C1_OPPORTUNITY_AVAILABLE = False


# ============================================================================
# CONFIGURATION
# ============================================================================

# Predictions database for storing analysis results
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(PROJECT_ROOT / 'db' / 'predictions.db'))


# ============================================================================
# DATABASE HELPERS
# ============================================================================

def get_predictions_db():
    """Get predictions database connection."""
    conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=30000')
    return conn


def get_stocks_db():
    """Get stocks database connection."""
    conn = sqlite3.connect(STOCKS_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=30000')
    return conn


# ============================================================================
# DNA-WIRING / MARKET-ISOLATION (Axis B): data_engine.db cross-reference
# ============================================================================
# المشكلة: stocks.db عنده market column بس مش متحدث صح — أسهم سعودية (زي 9610)
# بتظهر كأنها EGX. ده بيسبب:
#   1. أسهم سعودية في توصيات EGX (محرج ومضلل)
#   2. Maestro admin tab بيبعت كل الأسهم مش بس مصرية
#   3. stored_analyses بتحفظ market غلط
#
# الحل: data_engine.db.egksco_stocks هو المرجع الرسمي لتصنيف السوق.
# الجدول فيه symbol + market لكل سهم. بنقرأه مرة واحدة في الذاكرة (cached)
# ونستخدمه لتصحيح الـ market field قبل أي تحليل أو تخزين.
_DATA_ENGINE_DB = os.environ.get('DATA_ENGINE_DB', str(PROJECT_ROOT / 'db' / 'data_engine.db'))
_market_override_cache: Dict[str, str] = {}
_market_override_ts = 0


def load_market_overrides() -> Dict[str, str]:
    """يحمّل خريطة symbol→market من data_engine.db.egksco_stocks.

    النتيجة متكاشة لمدة 10 دقايق عشان ما نقرأش DB في كل request.

    Returns:
        dict: {TICKER: 'TADAWUL'/'EGX'/...} — فاضي لو data_engine.db مش متاح
    """
    import time as _time
    global _market_override_cache, _market_override_ts

    now = _time.time()
    if _market_override_cache and (now - _market_override_ts) < 600:
        return _market_override_cache

    overrides = {}
    try:
        if os.path.exists(_DATA_ENGINE_DB):
            conn = sqlite3.connect(f'file:{_DATA_ENGINE_DB}?mode=ro', uri=True, timeout=10)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            # egksco_stocks هو جدول موحد لكل الأسواق فيه symbol + market
            try:
                cur.execute("SELECT symbol, market FROM egksco_stocks WHERE symbol IS NOT NULL")
                for row in cur.fetchall():
                    sym = (row['symbol'] or '').upper().strip()
                    mkt = (row['market'] or '').upper().strip()
                    if sym and mkt:
                        overrides[sym] = mkt
            except Exception:
                pass
            conn.close()
    except Exception as e:
        print(f"[MarketIsolation] ⚠️ Error loading market overrides: {e}")

    _market_override_cache = overrides
    _market_override_ts = now
    if overrides:
        print(f"[MarketIsolation] ✅ Loaded {len(overrides)} market overrides from data_engine.db")
    return overrides


def resolve_market(ticker: str, fallback_market: str = 'EGX') -> str:
    """يحدد السوق الصحيح للسهم باستخدام data_engine.db كمرجع.

    الأولوية:
      1. data_engine.db.egksco_stocks (المرجع الرسمي)
      2. fallback_market (من stocks.db)
      3. كشف من الـ ticker: 4 أرقام = TADAWUL، حروف = EGX

    Args:
        ticker: رمز السهم
        fallback_market: السوق من stocks.db (افتراضي EGX)

    Returns:
        str: السوق الصحيح ('EGX', 'TADAWUL', 'KSA', etc.)
    """
    ticker_upper = (ticker or '').upper().strip()
    if not ticker_upper:
        return fallback_market

    # 1. جرّب data_engine.db أولاً (المرجع الرسمي)
    overrides = load_market_overrides()
    if ticker_upper in overrides:
        return overrides[ticker_upper]

    # 2. كشف من الـ ticker: الأرقام (4 أرقام) = TADAWUL (السعودية)
    #    الأسهم السعودية في EGX Investment بتظهر بأرقام (9610, 2222, etc.)
    if ticker_upper.isdigit() and len(ticker_upper) == 4:
        return 'TADAWUL'

    # 3. ارجع للـ fallback
    return fallback_market


def _safe_float(val):
    """تحويل آمن لـ float — يرجع 0 لو فشل."""
    try:
        if val is None:
            return 0.0
        return float(val)
    except (ValueError, TypeError):
        return 0.0


# ============================================================================
# P16-PERSONA-DIVERGENCE: حساب فرص البرسونا بشكل مستقل
# ============================================================================
# لما الـ Analyzer بيحلل السوق كل 15 دقيقة، بيوفر بيانات volume_ratio و
# change_percent من result.phases. هنا بنحسب:
#   - is_gambler_opportunity: زخم (volume_ratio >= 1.5 و |change_1d| >= 2%)
#   - is_investor_opportunity: أساسيات (pe_ratio في [5,20] و roe >= 10 و change_1m في [-5,+10])
# لو السهم فيه زخم بس أساسياته وحشة → يتخزن كفرصة للمضارب بس.
# لو أساسياته كويسة بس مفيهوش زخم → يتخزن كفرصة للمستثمر بس.
# ده بيخلي الـ Pool بتاع الأسهم مختلف تماماً لكل Persona من الأساس.

_STOCKS_DB_PATH = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')
_PERSONA_FUND_CACHE: dict = {'data': {}, 'ts': 0.0}
_PERSONA_FUND_TTL = 600  # 10 دقايق


def _load_stocks_fundamentals_for_persona() -> dict:
    """تحميل pe_ratio, roe, change_1d, change_1m, volatility, fair_value من stocks.db.

    بيرجع dict: ticker (UPPER) → {...}. النتيجة متكاشة لمدة 10 دقايق.
    آمن تماماً — لو stocks.db ناقص أو الأعمدة مش موجودة، بيرجع {}.
    """
    import time as _time
    now = _time.time()
    if _PERSONA_FUND_CACHE['data'] and (now - _PERSONA_FUND_CACHE['ts']) < _PERSONA_FUND_TTL:
        return _PERSONA_FUND_CACHE['data']

    result: dict = {}
    try:
        if not os.path.exists(_STOCKS_DB_PATH):
            return result
        conn = sqlite3.connect(_STOCKS_DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # ── P0-FUND-ROBUST (v3.69.0):_COLUMN-ADAPTIVE SELECT ──────────────
        # ROOT CAUSE (اللي خلّى 542/542 صف g=0 i=0 على الإنتاج رغم P0-DYNAMIC):
        # الـ SELECTs القديمة (primary + fallback) الاتنين بـ يـ reference
        # أعمدة `avg_volume` و `rsi` اللي مش موجودة في schema الحقيقي للـ stocks
        # table. الـ primary كان بيرمي OperationalError → الـ fallback كان بـ
        # يـ reference نفس الأعمدة كمان فبيرمي Exception → rows=[] → result={}
        # → fund EMPTY لكل ticker → chg_1d=0, pe=0, roe=0 → كل بوابات المضارب/
        # المستثمر بتفشل → flags 0/0. الـ P0-DYNAMIC thresholds مكانش ليها تأثير
        # لأن الـ fund اللي بـ يغذّي البوابات كان فاضي.
        #
        # الحل: نكشف الأعمدة المتاحة بـ PRAGMA table_info، ونبني SELECT ديناميكي
        # بـ يستخدم `NULL AS <col>` لكل عمود ناقص. ده بيخلّي الـ query ما بيرمي
        # OperationalError أبداً مهما كان الـ schema ناقص/مختلف. الأعمدة الجوهرية
        # (ticker, change_percent, volume, current_price) لو ناقصة → بنرجّع فاضي
        # (مش هيحصل تحليل أصلاً).
        try:
            available = {str(row[1]).lower() for row in cur.execute(
                "PRAGMA table_info(stocks)").fetchall()}
        except Exception:
            available = set()

        def _col(name: str, alias: str = None) -> str:
            """ترجع 'name AS alias' لو العمود موجود، غير كده 'NULL AS alias'."""
            al = alias or name
            if name.lower() in available:
                return f"{name} AS {al}"
            return f"NULL AS {al}"

        # change_percent موجود دايماً في schema الإنتاجي؛ بنعمل alias لـ change_1d
        # لو change_1d نفسه مش موجود (الـ stocks table عنده change_percent بس).
        chg_1d_expr = "change_1d" if "change_1d" in available else (
            "change_percent AS change_1d" if "change_percent" in available else "NULL AS change_1d")

        select_sql = (
            "SELECT "
            "ticker, "
            + _col("pe_ratio") + ", "
            + _col("roe") + ", "
            + chg_1d_expr + ", "
            + _col("change_1m") + ", "
            + _col("volatility") + ", "
            + _col("volume") + ", "
            + _col("avg_volume") + ", "
            + _col("change_percent") + ", "
            + _col("fair_value") + ", "
            + _col("current_price") + ", "
            + _col("dividend_yield") + ", "
            + _col("sector") + ", "
            + _col("rsi") + ", "
            # last_update: prefer 'last_update', fallback 'last_updated'
            + ("last_update AS last_update" if "last_update" in available
               else ("last_updated AS last_update" if "last_updated" in available
                         else "NULL AS last_update")) + ", "
            + _col("is_suspended") + ", "
            + _col("turnover_egp") + ", "
            + _col("value_traded") + ", "
            + _col("is_active")
            + " FROM stocks"
        )
        where = " WHERE (is_active = 1 OR is_active IS NULL)" if "is_active" in available else ""
        cur.execute(select_sql + where)
        rows = cur.fetchall()

        # [PERSONA_FUND_LOAD] لوج إلزامي للـ diagnostics: لو 0 → الـ SELECT فشل أو
        # stocks.db فاضي. ده أول إشارة لـ صحة الـ fund path (اللي كان السبب الخفي
        # ورا 542/542 صف g=0). بنطبع كمان عينة من الأعمدة عشان نتأكد إن الـ PRAGMA
        # كشف الـ columns الصح.
        _avail_sample = sorted(available)[:14]
        print(f"[PERSONA_FUND_LOAD] loaded {len(rows)} funds from stocks.db "
              f"(available cols sample: {_avail_sample})")

        # متوسط P/E لكل قطاع (لحساب fair_value_upside التقريبي)
        sector_pes: dict = {}
        for r in rows:
            d = dict(r)
            try:
                pe = float(d.get('pe_ratio') or 0)
                sec = d.get('sector') or ''
                if pe > 0 and sec:
                    sector_pes.setdefault(sec, []).append(pe)
            except (ValueError, TypeError):
                pass
        sector_avg_pe = {s: sum(v) / len(v) for s, v in sector_pes.items() if v}

        for r in rows:
            d = dict(r)
            ticker = (d.get('ticker') or '').upper()
            if not ticker:
                continue
            try:
                pe = float(d.get('pe_ratio') or 0)
            except (ValueError, TypeError):
                pe = 0.0
            try:
                roe = float(d.get('roe') or 0)
            except (ValueError, TypeError):
                roe = 0.0
            try:
                chg_1d = float(d.get('change_1d') or d.get('change_percent') or 0)
            except (ValueError, TypeError):
                chg_1d = 0.0
            try:
                chg_1m = float(d.get('change_1m') or 0)
            except (ValueError, TypeError):
                chg_1m = 0.0
            try:
                volat = float(d.get('volatility') or 0)
            except (ValueError, TypeError):
                volat = 0.0
            # PROD-HOTFIX (P0-3): volume في stocks.db ممكن يكون نص من TradingView
            # ('792.7 K', '12.74 M'). float() بيرمي ValueError → كان بيتمسك ويرجع 0
            # بصمت، فالـ live filter (volume ≥ 10k) كان بيرفض كل الأسهم. نستخدم
            # parse_volume اللي بتفك الصيغ النصية.
            try:
                _raw_vol = d.get('volume')
                if isinstance(_raw_vol, str):
                    volume = float(parse_volume(_raw_vol))
                else:
                    volume = float(_raw_vol or 0)
            except (ValueError, TypeError):
                volume = 0.0
            try:
                _raw_avg_vol = d.get('avg_volume')
                if isinstance(_raw_avg_vol, str):
                    avg_vol = float(parse_volume(_raw_avg_vol))
                else:
                    avg_vol = float(_raw_avg_vol or 0)
            except (ValueError, TypeError):
                avg_vol = 0.0
            try:
                cur_price = float(d.get('current_price') or 0)
            except (ValueError, TypeError):
                cur_price = 0.0
            try:
                fv = float(d.get('fair_value') or 0)
            except (ValueError, TypeError):
                fv = 0.0
            try:
                div_yield = float(d.get('dividend_yield') or 0)
            except (ValueError, TypeError):
                div_yield = 0.0
            try:
                rsi = float(d.get('rsi') or 0)
            except (ValueError, TypeError):
                rsi = 0.0

            vr = round(volume / avg_vol, 2) if (avg_vol > 0 and volume > 0) else 1.0

            # حساب fair_value_upside:
            # Method 1: من fair_value column
            # Method 2: من sector_avg_pe - pe
            fvu = 0.0
            if fv > 0 and cur_price > 0:
                fvu = round(((fv - cur_price) / cur_price) * 100, 2)
            elif pe > 0 and cur_price > 0:
                avg_pe = sector_avg_pe.get(d.get('sector') or '', 0)
                if avg_pe > 0 and pe < avg_pe:
                    fvu = round(((avg_pe - pe) / pe) * 100, 2)

            result[ticker] = {
                'pe_ratio': pe,
                'roe': roe,
                'change_1d': chg_1d,
                'change_1m': chg_1m,
                'volatility': volat,
                'volume_ratio': vr,
                'fair_value': fv,
                'fair_value_upside': fvu,
                'current_price': cur_price,
                'dividend_yield': div_yield,
                'rsi': rsi,
                'sector': d.get('sector') or '',
                # C1.1-PERSONA-LIVE: حقول فلتر الأسهم الحية
                'volume': volume,
                'avg_volume': avg_vol,
                'last_update': d.get('last_update') or '',
                'is_suspended': int(d.get('is_suspended') or 0),
                'turnover_egp': float(d.get('turnover_egp') or 0),
                'value_traded': float(d.get('value_traded') or 0),
            }
        conn.close()
    except Exception as e:
        print(f"[BackgroundAnalyzer] persona fundamentals load failed: {e}")

    _PERSONA_FUND_CACHE['data'] = result
    _PERSONA_FUND_CACHE['ts'] = now
    return result


def _compute_persona_opportunity_flags(
    ticker: str,
    stored_vol_ratio: float = 0.0,
    rec: Optional[dict] = None,
    turnover_egp: Optional[float] = None,
) -> dict:
    """حساب is_gambler_opportunity و is_investor_opportunity + rank scores لسهم.

    C1-PERSONA-OPPORTUNITY (v3.48.0): بيوكل المنطق لـ core.opportunity_quality
    اللي بيطبّق:
      - C1.1 فلتر أسهم حية (strict للمضارب، loose للمستثمر)
      - C1.2 quality gate (score≥65, RR≥1.5, turnover≥500k, confidence≥55)
      - C1.3 investor fallback لما pe_ratio فاضي (roe/fvu/stability)

    Args:
        ticker: رمز السهم (UPPERCASE تلقائياً)
        stored_vol_ratio: volume_ratio من stored_analyses (احتياطي لو stocks.db ناقص)
        rec: dict فيه {recommendation, maestro_score, risk_reward, confidence}
             (لو مش متمرر، بنفترض BUY + score=0 → مش هيكون opportunity)
        turnover_egp: قيمة التداول (لو مش في rec)

    Returns:
        dict: {is_gambler, is_investor, gambler_rank, investor_rank, pe_ratio,
               roe, change_1d, change_1m, volatility, fair_value_upside}
    """
    fund = _load_stocks_fundamentals_for_persona().get((ticker or '').upper(), {})

    # PERSONA-FLAGS-FIX (v3.60.0): CACHE-BUST على fund فارغ.
    # المشكلة على الإنتاج: الـ vps-service process طويل العمر. لو stocks.db
    # كان فاضي/ناقص وقت بدء العملية (أو الـ data_engine لسه بـ يـ populateه)،
    # الـ _PERSONA_FUND_CACHE بتـ يتخزّن {} (فاضي) لمدة 10 دقايق. كل الـ triggers
    # في الـ 10 دقايق دي بـ تشوف fund={} → is_live_stock_strict بترفض → g=0.
    # الـ diagnose script بيشتغل في process منفصل فبـ يـ reload طازي → is_gambler=1.
    # ده بيخلّي الـ "diagnose=1 بس DB=0" divergence اللي شاغلنا.
    #
    # الحل: لو fund فاضي للسهم المطلوب (وهو في trigger list فـ مفروض يكون في
    # stocks.db)، نـ bust الـ cache ونعيد التحميل مرة واحدة. لو لسه فاضي →
    # السهم فعلاً مش في stocks.db (مش cache issue).
    if not fund and ticker:
        print(f"[PERSONA_CACHE_BUST] {ticker}: fund EMPTY in cached map — "
              f"busting _PERSONA_FUND_CACHE and reloading from stocks.db")
        try:
            _PERSONA_FUND_CACHE['data'] = {}
            _PERSONA_FUND_CACHE['ts'] = 0.0
            fund = _load_stocks_fundamentals_for_persona().get((ticker or '').upper(), {})
            if fund:
                print(f"[PERSONA_CACHE_BUST] {ticker}: reload SUCCESS — "
                      f"turnover_egp={fund.get('turnover_egp')} volume={fund.get('volume')} "
                      f"price={fund.get('current_price')}")
            else:
                print(f"[PERSONA_CACHE_BUST] {ticker}: reload STILL EMPTY — "
                      f"ticker not in stocks.db (or stocks.db missing the row)")
        except Exception as _cb_e:
            print(f"[PERSONA_CACHE_BUST] {ticker}: reload FAILED: {_cb_e}")

    # C1-PERSONA-OPPORTUNITY: لو الـ module متاح، وجّه المنطق له.
    if C1_OPPORTUNITY_AVAILABLE:
        rec = rec or {}
        if turnover_egp is not None and 'turnover_egp' not in rec:
            rec = {**rec, 'turnover_egp': turnover_egp}
        # PERSONA-FLAGS-FIX (v3.60.0): لو turnover_egp لسه None، ادمجه من fund.
        # كده stored.turnover_egp (داخل compute_persona_flags) هيبقى له قيمة →
        # الـ INSERT بـ يكتب turnover_egp حقيقي في DB (مش NULL) AND الـ quality
        # gate بـ يلاقي القيمة في stored قبل ما يقع على fund fallback.
        if turnover_egp is None and fund:
            try:
                _ft = float(fund.get('turnover_egp') or 0)
                if _ft > 0:
                    turnover_egp = _ft
                    if 'turnover_egp' not in rec:
                        rec = {**rec, 'turnover_egp': _ft}
                else:
                    _fvt = float(fund.get('value_traded') or 0)
                    if _fvt > 0:
                        turnover_egp = _fvt
                        if 'turnover_egp' not in rec:
                            rec = {**rec, 'turnover_egp': _fvt}
            except (TypeError, ValueError):
                pass
        # PERSONA-FLAGS-FIX (v3.62.0): COMPUTE turnover from price * volume.
        # لو fund.turnover_egp و fund.value_traded كمان فاضوا (زي حالة BONY
        # و AREH في الإنتاج)، نحسب turnover_egp = current_price × volume من
        # fund. ده بـ يخلي quality_gate تلاقي قيمة في stored.turnover_egp.
        if turnover_egp is None and fund:
            try:
                _cp = float(fund.get('current_price') or 0)
                _fv = fund.get('volume')
                _vol = 0.0
                if isinstance(_fv, str):
                    try:
                        from utils.helpers import parse_volume as _pv3
                        _vol = float(_pv3(_fv))
                    except Exception:
                        _vol = 0.0
                else:
                    _vol = float(_fv or 0)
                if _cp > 0 and _vol > 0:
                    turnover_egp = _cp * _vol
                    if 'turnover_egp' not in rec:
                        rec = {**rec, 'turnover_egp': turnover_egp}
            except (TypeError, ValueError):
                pass
        try:
            _c1_result = _c1_compute_persona_flags(rec, fund, stored_vol_ratio)
            # PERSONA-FLAGS-FIX (v3.59.0): trace log عشان نتأكد إن C1 path
            # بـ يشتغل مش بـ يقع على legacy. لو fund فاضي → warning.
            if not fund:
                print(f"[PERSONA_TRACE] {ticker}: C1 returned g={_c1_result.get('is_gambler')} "
                      f"i={_c1_result.get('is_investor')} (fund EMPTY — quality gate may fail on turnover)")
            return _c1_result
        except Exception as _c1_e:
            # PERSONA-FLAGS-FIX (v3.59.0): full traceback + print واضح.
            # قبل كده كان logger.warning بس → استثناء صامت بـ يقع على legacy
            # والـ legacy بـ يرجّع g=0 من غير ما حد يشوف ليه.
            import traceback as _tb
            logger.exception(
                "[BackgroundAnalyzer] C1 opportunity_quality FAILED for %s: %s — fallback to legacy",
                ticker, _c1_e,
            )
            print(f"[PERSONA_ERROR] {ticker}: C1 compute_persona_flags THREW EXCEPTION → falling back to legacy")
            print(f"[PERSONA_ERROR] {ticker}: exception type={type(_c1_e).__name__} msg={_c1_e}")
            _tb.print_exc()
            # وقوع لـ legacy logic (تحت)

    # Legacy logic (fallback لو الـ module مش متاح)
    if not fund:
        return {
            'is_gambler': 1 if (stored_vol_ratio or 0) >= 1.5 else 0,
            'is_investor': 0,
            'is_balanced': 0,
            'gambler_rank': round((stored_vol_ratio or 0) * 10, 2),
            'investor_rank': 0.0,
            'balanced_rank': round((stored_vol_ratio or 0) * 5, 2),
            'pe_ratio': None, 'roe': None, 'change_1d': None, 'change_1m': None,
            'volatility': None, 'fair_value_upside': None,
        }

    vr = float(fund.get('volume_ratio') or stored_vol_ratio or 0)
    chg_1d = float(fund.get('change_1d') or 0)
    pe = float(fund.get('pe_ratio') or 0)
    roe = float(fund.get('roe') or 0)
    chg_1m = float(fund.get('change_1m') or 0)
    volat = float(fund.get('volatility') or 0)
    fvu = float(fund.get('fair_value_upside') or 0)
    div = float(fund.get('dividend_yield') or 0)
    rsi = float(fund.get('rsi') or 50)

    is_gambler = 1 if ((vr >= 1.5 and abs(chg_1d) >= 2.0) or (stored_vol_ratio >= 1.5 and abs(chg_1d) >= 1.5)) else 0
    rsi_edge = abs(rsi - 50) * 2
    gambler_rank = round(vr * 10 + abs(chg_1d) * 3 + volat * 0.5 + rsi_edge, 2)

    is_investor = 1 if ((3 <= pe <= 30) and (roe >= 8) and (-10 <= chg_1m <= 15)) else 0
    pe_score = (30 - pe) * 1.5 if 0 < pe <= 30 else 0
    investor_rank = round(fvu * 1.5 + roe * 1.2 + div * 5 + pe_score, 2)

    # C3-BALANCED (v3.67.0): legacy fallback للمتوازن — تقاطع موزون ديناميكي.
    momentum_ok = chg_1d >= 0.5 or vr >= 1.2
    fundamental_ok = roe >= 8 or fvu >= 5 or chg_1m >= -5
    is_balanced = 1 if (momentum_ok and fundamental_ok) else 0
    balanced_rank = round(gambler_rank * 0.5 + investor_rank * 0.5, 2)

    return {
        'is_gambler': is_gambler,
        'is_investor': is_investor,
        'is_balanced': is_balanced,
        'gambler_rank': gambler_rank,
        'investor_rank': investor_rank,
        'balanced_rank': balanced_rank,
        'pe_ratio': pe,
        'roe': roe,
        'change_1d': chg_1d,
        'change_1m': chg_1m,
        'volatility': volat,
        'fair_value_upside': fvu,
    }


# ============================================================================
# PROD-HOTFIX (P0): مشاركة مسار الحفظ بين trigger-analysis و /api/maestro/run
# ============================================================================
# المشكلة على الإنتاج (invist.m2y.net):
#   trigger_analysis_manual و run_full_analysis كان كل واحد بيعمل INSERT خاص
#   بيه في stored_analyses من غير ما يكتب persona flags (is_gambler_opportunity،
#   is_investor_opportunity، gambler_rank_score، investor_rank_score، ...).
#   النتيجة: stored_analyses.flags = 0 للكل رغم إن التحليل بيشتغل.
#   الـ read path (/results?persona=) بيعيد حساب flags وقت القراءة من stocks.db
#   فالواجهة بتعرض حاجة → مضلّل.
# الحل: دالة موحّدة persist_analysis_with_persona() بيستخدمها المسارين، بتكتب
#   كل الـ persona columns بنفس الطريقة اللي BackgroundAnalyzer بيكتب بيها.
# ============================================================================


# PHASE 5-2 (v3.55.0): Shared INSERT SQL for stored_analyses (single source).
# Used by both persist_analysis_with_persona (single-row) and
# persist_analysis_batch (executemany). P5 principle "Write Batched" — one
# SQL string, one schema, one write path. The `id` column is generated by
# SQL (randomblob), updated_at/created_at by CURRENT_TIMESTAMP — so the
# 28 `?` placeholders are the only Python-supplied values.
_STORED_ANALYSES_INSERT_SQL = '''
    INSERT OR REPLACE INTO stored_analyses (
        id, ticker, market, maestro_score, recommendation, recommendation_ar,
        confidence, entry_price, target_price, stop_loss, risk_reward,
        regime, regime_score, timeframe_aligned, timeframe_count,
        volume_ratio, liquidity_rating,
        analysis_json, analysis_version, analysis_type, turnover_egp,
        updated_at, created_at,
        is_gambler_opportunity, is_investor_opportunity,
        gambler_rank_score, investor_rank_score,
        pe_ratio, roe, change_1d, change_1m, volatility, fair_value_upside
    ) VALUES (
        lower(hex(randomblob(16))), ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, '4.0-persona', 'manual', ?,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
'''


def _build_stored_analysis_row(
    result,
    market: str = 'EGX',
    stock: Optional[dict] = None,
    turnover_egp: Optional[float] = None,
) -> Optional[tuple]:
    """Build the 28-value tuple for a stored_analyses INSERT row (NO DB I/O).

    PHASE 5-2 (v3.55.0): Extracted from persist_analysis_with_persona so the
    row can be built entirely in memory. This lets run_analysis_batch collect
    all rows in the loop (zero predictions.db queries per stock) and write
    them in ONE executemany call afterwards (P5: Write Batched).

    The only I/O this function performs is reading stocks.db fundamentals via
    _compute_persona_opportunity_flags (cached, 10-min TTL) — it NEVER touches
    predictions.db. So building N rows costs 0 predictions.db queries.

    Args:
        result: MaestroResult from MaestroOrchestrator.analyze().
        market: 'EGX' / 'TADAWUL' / ...
        stock: dict from stocks table (for sector/price fallback, unused now
               but kept for API symmetry with persist_analysis_with_persona).
        turnover_egp: turnover value (close × volume). If None, estimated
                      from result.entry_price × volume_phase.current_volume.

    Returns:
        tuple of 28 values matching _STORED_ANALYSES_INSERT_SQL placeholders,
        or None if result is None / has no ticker.
    """
    import json as _json

    if result is None:
        return None

    ticker = getattr(result, 'ticker', '') or (stock or {}).get('ticker', '')
    if not ticker:
        return None

    # 1) استخراج phases من result
    phases = getattr(result, 'phases', None) or {}
    regime_phase = phases.get('regime', {}) if isinstance(phases, dict) else {}
    timeframe_phase = phases.get('timeframe', {}) if isinstance(phases, dict) else {}
    volume_phase = phases.get('volume', {}) if isinstance(phases, dict) else {}

    regime = (regime_phase.get('phase') if regime_phase else None) or getattr(result, 'regime', None) or 'range'
    regime_score = regime_phase.get('score', 50) if regime_phase else 50
    tf_aligned = 1 if (timeframe_phase.get('aligned', False) if timeframe_phase else False) else 0
    tf_count = (timeframe_phase.get('aligned_count', 1) if timeframe_phase else 1) or 1
    vol_ratio = (volume_phase.get('volume_ratio', 1.0) if volume_phase else 1.0) or 1.0
    liquidity = (volume_phase.get('liquidity_rating', 'NORMAL') if volume_phase else 'NORMAL') or 'NORMAL'

    # 2) حساب turnover_egp — fallback chain (PERSONA-FLAGS-FIX v3.58.0):
    #   (a) explicit param (if caller passed it)
    #   (b) stock.turnover_egp (from stocks.db — الأكثر موثوقية)
    #   (c) stock.value_traded (عمود بديل في stocks.db)
    #   (d) result.entry_price * volume_phase.current_volume (تقديري)
    # قبل الفكس ده، كان المسار بـ يقفز لـ (d) فقط → لو entry_price=0 أو
    # current_volume=0 → turnover=None → quality_gate بترفض (0 < 500k) →
    # is_gambler=0 لكل الـ BUY رغم إن stock dict فيه turnover_egp محفوظ.
    if turnover_egp is None and stock:
        try:
            _s_turn = float(stock.get('turnover_egp') or 0)
            if _s_turn > 0:
                turnover_egp = _s_turn
        except (TypeError, ValueError):
            pass
        if turnover_egp is None:
            try:
                _s_vt = float(stock.get('value_traded') or 0)
                if _s_vt > 0:
                    turnover_egp = _s_vt
            except (TypeError, ValueError):
                pass
    if turnover_egp is None:
        try:
            _entry = float(getattr(result, 'entry_price', 0) or 0)
            _vol = 0.0
            if volume_phase:
                _vol = float(volume_phase.get('current_volume', 0) or 0)
            if _entry > 0 and _vol > 0:
                turnover_egp = _entry * _vol
        except (TypeError, ValueError):
            turnover_egp = None
    # PERSONA-FLAGS-FIX (v3.59.0): fund-based turnover fallback.
    # الـ trigger SQL بـ يـ SELECT turnover_egp بس مش value_traded → stock dict
    # ما فيهوش value_traded. fund (من _load_stocks_fundamentals_for_persona)
    # بيحمّل الاتنين من stocks.db. لو الـ chain لسه None → نجرب fund.
    # ده بيضمن إن turnover مش هيبقى None طالما stocks.db فيه أي قيمة.
    if turnover_egp is None:
        try:
            _fund_map = _load_stocks_fundamentals_for_persona() or {}
            _fund = _fund_map.get((ticker or '').upper(), {}) or {}
            _f_turn = float(_fund.get('turnover_egp') or 0)
            if _f_turn > 0:
                turnover_egp = _f_turn
            else:
                _f_vt = float(_fund.get('value_traded') or 0)
                if _f_vt > 0:
                    turnover_egp = _f_vt
        except Exception:
            pass

    # PERSONA-FLAGS-FIX (v3.62.0): COMPUTE turnover from price * volume.
    # الـ root cause الفعلي اللي اكتشفناه عبر verify_persona_write_path.py:
    # stocks.db لـ BONY/AREH فيه turnover_egp=NULL و value_traded=0، بس فيه
    # volume=22,926,927 و current_price=5.07. الـ fallback chain فوق كان بـ
    # يرجّع None → quality_gate بترفض (turnover < 500k) → is_gambler=0.
    # الحل: turnover_egp by definition = current_price × volume. لو كل
    # المصادر above فشلت، نحسبه من price*volume (stock أو fund). ده مش تخفيض
    # عتبات — ده استرجاع لقيمة حقيقية بنحقّقها من بيانات موجودة.
    if turnover_egp is None:
        try:
            _cp = 0.0
            _vol = 0.0
            # prefer stock dict (fresh from trigger SELECT)
            if stock:
                _cp = float(stock.get('current_price') or 0)
                _sv = stock.get('volume')
                if isinstance(_sv, str):
                    try:
                        from utils.helpers import parse_volume as _pv
                        _vol = float(_pv(_sv))
                    except Exception:
                        _vol = 0.0
                else:
                    _vol = float(_sv or 0)
            # fallback to fund if stock missing
            if _cp <= 0 or _vol <= 0:
                _fund_map2 = _load_stocks_fundamentals_for_persona() or {}
                _fund2 = _fund_map2.get((ticker or '').upper(), {}) or {}
                if _cp <= 0:
                    _cp = float(_fund2.get('current_price') or 0)
                if _vol <= 0:
                    _fv = _fund2.get('volume')
                    if isinstance(_fv, str):
                        try:
                            from utils.helpers import parse_volume as _pv2
                            _vol = float(_pv2(_fv))
                        except Exception:
                            _vol = 0.0
                    else:
                        _vol = float(_fv or 0)
            if _cp > 0 and _vol > 0:
                turnover_egp = _cp * _vol
                print(f"[PERSONA_TURNOVER_COMPUTE] {ticker}: turnover_egp computed "
                      f"= current_price({_cp}) × volume({_vol}) = {turnover_egp:.2f} "
                      f"(stocks.db had NULL/0 for turnover_egp and value_traded)")
        except Exception as _tc_e:
            print(f"[PERSONA_TURNOVER_COMPUTE] {ticker}: compute FAILED: {_tc_e}")

    # 3) بناء analysis_json (persona_rr + gambler + investor + narrative)
    analysis_json: dict = {}
    try:
        _gambler = getattr(result, 'gambler', None) or {}
        _investor = getattr(result, 'investor', None) or {}
        _prr = getattr(result, 'persona_rr', None) or {}
        _narr = getattr(result, 'persona_narrative', None) or {}
        if _gambler or _investor or _prr or _narr:
            analysis_json = {
                'gambler': _gambler,
                'investor': _investor,
                'persona_rr': _prr,
                'narrative': _narr,
            }
    except Exception:
        analysis_json = {}

    # 4) حساب persona flags (reads stocks.db via cached loader, NOT predictions.db)
    # PERSONA-FLAGS-FIX (v3.57.0 + v3.58.0): نمرّر إشارات live-stock من الـ
    # result + stock dict عشان compute_persona_flags يبني stored dict فيه
    # updated_at=now + volume + current_price + turnover. قبل الفكس ده:
    #   - v3.57.0: أضفنا updated_at=now (حلّ الـ freshness check)
    #   - v3.58.0: أضفنا fallback لـ stock dict في volume/current_price/turnover
    #     (الـ result.entry_price و volume_phase.current_volume ممكن يكونوا 0
    #     في بعض نتائج التحليل → is_live_stock_strict كان بيرفض على price sanity)
    try:
        import time as _t_mod
        _now_iso = _t_mod.strftime('%Y-%m-%d %H:%M:%S')  # يطابق CURRENT_TIMESTAMP
        # fallback chain for volume: volume_phase → stock.volume
        _cur_vol = float(volume_phase.get('current_volume', 0) or 0) if volume_phase else 0.0
        if _cur_vol <= 0 and stock:
            try:
                from utils.helpers import parse_volume as _pv
                _sv = stock.get('volume')
                _cur_vol = float(_pv(_sv)) if isinstance(_sv, str) else float(_sv or 0)
            except Exception:
                try:
                    _cur_vol = float(stock.get('volume') or 0)
                except (TypeError, ValueError):
                    _cur_vol = 0.0
        # fallback chain for current_price: result.entry_price → stock.current_price
        _cur_price = float(getattr(result, 'entry_price', 0) or 0)
        if _cur_price <= 0 and stock:
            try:
                _cur_price = float(stock.get('current_price') or 0)
            except (TypeError, ValueError):
                _cur_price = 0.0
        persona_flags = _compute_persona_opportunity_flags(
            ticker,
            vol_ratio,
            rec={
                'ticker': ticker,
                'recommendation': getattr(result, 'recommendation', '') or 'hold',
                'maestro_score': getattr(result, 'maestro_score', 0) or 0,
                'risk_reward': getattr(result, 'risk_reward', 0) or 0,
                'confidence': getattr(result, 'confidence', 0) or 0,
                # live-stock fallbacks (انظر compute_persona_flags → stored dict)
                'updated_at': _now_iso,
                'volume': _cur_vol,
                'current_price': _cur_price,
                'is_suspended': int((stock or {}).get('is_suspended') or 0),
            },
            turnover_egp=float(turnover_egp) if turnover_egp is not None else None,
        )
    except Exception as _pe:
        # PERSONA-FLAGS-FIX (v3.59.0): logger.exception للحصول على full
        # traceback + print واضح في pm2 logs. قبل كده كان logger.warning بس
        # اللي بـ يطبع الرسالة فقط → ما كناش نشوف فين الاستثناء بالظبط.
        # ده بيخلّي أي exception صامت يبقى مرئي فوراً.
        import traceback as _tb
        logger.exception("[build_row] persona flags FAILED for %s — defaulting to 0/0: %s", ticker, _pe)
        print(f"[PERSONA_ERROR] {ticker}: persona flags computation THREW EXCEPTION → defaulted to g=0 i=0")
        print(f"[PERSONA_ERROR] {ticker}: exception type={type(_pe).__name__} msg={_pe}")
        _tb.print_exc()
        persona_flags = {
            'is_gambler': 0, 'is_investor': 0,
            'gambler_rank': 0.0, 'investor_rank': 0.0,
            'pe_ratio': None, 'roe': None, 'change_1d': None,
            'change_1m': None, 'volatility': None, 'fair_value_upside': None,
        }

    # PERSONA-FLAGS-FIX (v3.60.0): SAFETY-NET RECOMPUTE.
    # لو النتيجة g=0 بس السهم strong_buy + score>=80 → فيه مشكلة في الـ fund
    # أو الـ cache (المفروض _passes_gambler_confirmation بـ pass على score>=80
    # لوحده، فلو g=0 يبقى is_live_stock_strict أو quality_gate فشلوا — وغالباً
    # بسبب fund ناقص). نعيد الحساب مباشرةً بـ compute_persona_flags + fund طازج
    # (cache-bust). لو النتيجة bقت 1 → نستخدمها. ده مش تخفيض عتبات — ده ضمان
    # إن الـ compute بـ يشتغل بـ fund صحيح.
    _sn_score = float(getattr(result, 'maestro_score', 0) or 0)
    _sn_rec = (getattr(result, 'recommendation', '') or '').lower()
    if (C1_OPPORTUNITY_AVAILABLE
            and int(persona_flags.get('is_gambler', 0) or 0) == 0
            and _sn_rec in ('buy', 'strong_buy')
            and _sn_score >= 80):
        try:
            # cache-bust + direct reload
            _PERSONA_FUND_CACHE['data'] = {}
            _PERSONA_FUND_CACHE['ts'] = 0.0
            _sn_fund_map = _load_stocks_fundamentals_for_persona() or {}
            _sn_fund = _sn_fund_map.get((ticker or '').upper(), {}) or {}
            _sn_rec_dict = {
                'ticker': ticker,
                'recommendation': getattr(result, 'recommendation', '') or 'hold',
                'maestro_score': _sn_score,
                'risk_reward': float(getattr(result, 'risk_reward', 0) or 0),
                'confidence': float(getattr(result, 'confidence', 0) or 0),
                'updated_at': _now_iso,
                'volume': _cur_vol,
                'current_price': _cur_price,
                'is_suspended': int((stock or {}).get('is_suspended') or 0),
                'turnover_egp': float(turnover_egp) if turnover_egp is not None else (
                    float(_sn_fund.get('turnover_egp') or 0)
                    or float(_sn_fund.get('value_traded') or 0)
                    or None
                ),
            }
            _sn_turn = _sn_rec_dict.get('turnover_egp')
            if _sn_turn is None:
                _sn_turn = float(turnover_egp) if turnover_egp is not None else None
            _sn_flags = _c1_compute_persona_flags(_sn_rec_dict, _sn_fund, vol_ratio)
            print(
                f"[PERSONA_SAFETY_NET] {ticker}: first-pass g=0 (score={_sn_score}). "
                f"Recompute with fresh fund → g={_sn_flags.get('is_gambler')} "
                f"i={_sn_flags.get('is_investor')}. "
                f"fund.turnover_egp={_sn_fund.get('turnover_egp')} "
                f"fund.value_traded={_sn_fund.get('value_traded')} "
                f"fund.volume={_sn_fund.get('volume')} "
                f"fund.current_price={_sn_fund.get('current_price')} "
                f"fund.last_update={_sn_fund.get('last_update')!r}"
            )
            if int(_sn_flags.get('is_gambler', 0) or 0) == 1:
                print(f"[PERSONA_SAFETY_NET] {ticker}: OVERRIDE → using recomputed g=1 "
                      f"(first-pass was 0 due to stale/empty fund cache)")
                persona_flags = _sn_flags
                # كمان حدّث turnover_egp عشان الـ INSERT يكتب القيمة الصح
                if turnover_egp is None and _sn_rec_dict.get('turnover_egp') is not None:
                    turnover_egp = _sn_rec_dict['turnover_egp']
        except Exception as _sn_e:
            import traceback as _sn_tb
            print(f"[PERSONA_SAFETY_NET] {ticker}: recompute FAILED: {_sn_e}")
            _sn_tb.print_exc()

    rec_value = getattr(result, 'recommendation', 'hold') or 'hold'

    # PERSONA-FLAGS-FIX (v3.59.0): ALWAYS-ON pre-INSERT logging (مش behind
    # PERSONA_DEBUG flag). قبل كده كان behind flag → ما كنش بـ يطبع على
    # الإنتاج → ما كناش نعرف ليه g=0. دلوقتي بـ يطبع لكل سهم في الـ batch.
    # كمان فيه sanity check: لو strong_buy + score>=80 بس g=0 → CRITICAL.
    try:
        # detect turnover source (best-effort — for debugging only)
        if turnover_egp is not None:
            _s_turn = float((stock or {}).get('turnover_egp') or 0) if stock else 0
            _s_vt = float((stock or {}).get('value_traded') or 0) if stock else 0
            if _s_turn > 0 and abs(turnover_egp - _s_turn) < 0.01:
                _src = 'stock.turnover_egp'
            elif _s_vt > 0 and abs(turnover_egp - _s_vt) < 0.01:
                _src = 'stock.value_traded'
            else:
                _src = 'fund or entry*vol'
        else:
            _src = 'NONE'
        _g = persona_flags.get('is_gambler')
        _i = persona_flags.get('is_investor')
        _score = getattr(result, 'maestro_score', 0) or 0
        print(
            f"[PERSONA_WRITE] {ticker}: rec={rec_value} score={_score} "
            f"rr={getattr(result,'risk_reward',0)} conf={getattr(result,'confidence',0)} "
            f"turn={turnover_egp} (src={_src}) vol_ratio={vol_ratio} "
            f"g={_g} i={_i} "
            f"g_rank={persona_flags.get('gambler_rank')} i_rank={persona_flags.get('investor_rank')}"
        )
        # Sanity check: لو strong_buy + score>=80 بس g=0 → فيه مشكلة.
        # score>=80 بيـ pass _passes_gambler_confirmation بـ standalone شرط.
        # فلو g=0 → المشكلة في is_live_stock_strict أو _passes_quality_gate.
        if rec_value.lower() in ('buy', 'strong_buy') and float(_score or 0) >= 80 and int(_g or 0) == 0:
            print(
                f"[PERSONA_CRITICAL] {ticker}: strong_buy score={_score} >= 80 BUT is_gambler=0! "
                f"This should be 1. Check: fund data, turnover, exception logs above. "
                f"turn={turnover_egp} vol_ratio={vol_ratio}"
            )
    except Exception:
        pass

    # 5) Return the 28-value tuple (matches _STORED_ANALYSES_INSERT_SQL order)
    return (
        ticker,
        (market or 'EGX').upper(),
        float(getattr(result, 'maestro_score', 0) or 0),
        rec_value,
        getattr(result, 'recommendation_ar', '') or '',
        float(getattr(result, 'confidence', 0) or 0),
        float(getattr(result, 'entry_price', 0) or 0),
        getattr(result, 'target', None),
        getattr(result, 'stop_loss', None),
        float(getattr(result, 'risk_reward', 0) or 0),
        regime,
        float(regime_score or 0),
        int(tf_aligned),
        int(tf_count),
        float(vol_ratio or 0),
        liquidity,
        _json.dumps(analysis_json, default=str, ensure_ascii=False) if analysis_json else None,
        float(turnover_egp) if turnover_egp is not None else None,
        # persona flags + fundamentals
        int(persona_flags.get('is_gambler', 0)),
        int(persona_flags.get('is_investor', 0)),
        float(persona_flags.get('gambler_rank', 0.0) or 0),
        float(persona_flags.get('investor_rank', 0.0) or 0),
        persona_flags.get('pe_ratio'),
        persona_flags.get('roe'),
        persona_flags.get('change_1d'),
        persona_flags.get('change_1m'),
        persona_flags.get('volatility'),
        persona_flags.get('fair_value_upside'),
    )


def persist_analysis_batch(conn, rows: list) -> tuple:
    """Batch-write stored_analyses rows with ONE executemany + ONE commit.

    PHASE 5-2 (v3.55.0): P5 principle "Write Batched". Replaces N per-row
    INSERT+commit calls (which caused N fsyncs + N redundant PRAGMA
    table_info checks) with a single executemany + single commit.

    Behavior:
        1. _ensure_stored_analyses_columns(conn) — schema migration (ONCE).
        2. cur.executemany(_STORED_ANALYSES_INSERT_SQL, rows) — fast path.
        3. conn.commit() — ONE fsync for the whole batch.
        4. If executemany fails (e.g. a constraint violation on one row),
           rollback and fall back to per-row execute so partial success is
           still recorded with per-row error messages.

    Args:
        conn: sqlite3 connection on predictions.db (open).
        rows: list of 28-value tuples (from _build_stored_analysis_row).
              Empty list is a no-op returning (0, []).

    Returns:
        (success_count, errors) — errors is a list of per-row error strings
        (empty if the batch succeeded atomically).
    """
    if not rows:
        return (0, [])

    # Ensure schema once per batch (not once per row)
    try:
        _ensure_stored_analyses_columns(conn)
    except Exception as _e:
        logger.warning("[persist_batch] ensure columns failed: %s", _e)

    # PERSONA-FLAGS-FIX (v3.59.0): pre-INSERT log — اطبع is_gambler/is_investor
    # من الـ tuples قبل الـ executemany عشان نتأكد إن الـ tuple بـ يحمل القيم
    # الصح في الـ positions الصح. tuple[18] = is_gambler, tuple[19] = is_investor
    # (0-indexed). لو الـ tuple فيه 0 هنا → المشكلة في _build_stored_analysis_row
    # مش في الـ INSERT.
    try:
        for _r in rows[:10]:  # first 10 rows فقط (مشان ما نـ spam الـ logs)
            _tk = _r[0] if _r else '?'
            _g = _r[18] if len(_r) > 18 else '?'
            _i = _r[19] if len(_r) > 19 else '?'
            print(f"[PERSONA_INSERT] {_tk}: tuple[18]=is_gambler={_g} tuple[19]=is_investor={_i}")
    except Exception:
        pass

    # Fast path: atomic executemany
    try:
        cur = conn.cursor()
        cur.executemany(_STORED_ANALYSES_INSERT_SQL, rows)
        conn.commit()
        return (len(rows), [])
    except Exception as _batch_e:
        # Batch failed — rollback and fall back to per-row (partial success)
        try:
            conn.rollback()
        except Exception:
            pass
        logger.warning(
            "[persist_batch] executemany failed (%s) — falling back to per-row",
            _batch_e,
        )

    # Per-row fallback (identifies which rows failed)
    success = 0
    errors: list = []
    cur = conn.cursor()
    for i, row in enumerate(rows):
        try:
            cur.execute(_STORED_ANALYSES_INSERT_SQL, row)
            success += 1
        except Exception as _row_e:
            _tk = row[0] if row else f"row#{i}"
            errors.append(f"{_tk}: {_row_e}")
    try:
        conn.commit()
    except Exception as _ce:
        errors.append(f"commit: {_ce}")
    return (success, errors)


def persist_analysis_with_persona(
    conn,
    result,
    market: str = 'EGX',
    stock: Optional[dict] = None,
    turnover_egp: Optional[float] = None,
    technical_score: float = 50.0,
    fundamental_score: Optional[float] = None,
) -> bool:
    """احفظ نتيجة MaestroOrchestrator في stored_analyses WITH persona flags.

    PHASE 5-2 (v3.55.0): Now delegates row-building to `_build_stored_analysis_row`
    and uses the shared `_STORED_ANALYSES_INSERT_SQL`. For batch writes (N stocks),
    prefer `persist_analysis_batch` (1 executemany + 1 commit) over calling this
    N times (N executes + N commits).

    بيستخدمها:
      - core/analysis_runner.py::run_analysis_batch (single-row fallback only;
        the main batch path uses _build_stored_analysis_row + persist_analysis_batch)

    Args:
        conn: sqlite3 connection على predictions.db (مفتوح).
        result: MaestroResult من MaestroOrchestrator.analyze().
        market: 'EGX' / 'TADAWUL' / ...
        stock: dict من stocks table (لاستخراج sector/price fallback).
        turnover_egp: قيمة التداول (close × volume). لو None نحسبها تقديرياً.
        technical_score: (غير مستخدم — مش موجود في stored_analyses schema).
        fundamental_score: (غير مستخدم — محفوظ للتوافق الخلفي).

    Returns:
        True لو اتخزّن بنجاح، False لو فشل (مع log).
    """
    row = _build_stored_analysis_row(result, market, stock, turnover_egp)
    if row is None:
        return False

    # Migration آمن (مرة واحدة)
    try:
        _ensure_stored_analyses_columns(conn)
    except Exception as _e:
        logger.warning("[persist_analysis] ensure columns failed: %s", _e)

    # INSERT OR REPLACE بكل الأعمدة (shared SQL — نفس schema اللي
    # BackgroundAnalyzer بيكتبه و اللي persist_analysis_batch بيستخدمه)
    try:
        cur = conn.cursor()
        cur.execute(_STORED_ANALYSES_INSERT_SQL, row)
        conn.commit()
        return True
    except Exception as _ie:
        logger.warning("[persist_analysis] INSERT failed: %s", _ie)
        try:
            conn.rollback()
        except Exception:
            pass
        return False


# ============================================================================
# BACKGROUND ANALYZER
# ============================================================================


def _ensure_cached_analysis_columns(conn):
    """Migration آمن — يتأكد إن كل الـ columns موجودة في cached_analysis.
    
    لازم نعمل ADD COLUMN للـ tables القديمة اللي اتعملت قبل ما الـ schema يكتمل.
    ALTER TABLE ADD COLUMN آمنة (مش بتغيّر data) وبتتعمل مرة واحدة بس.
    """
    try:
        cur = conn.cursor()
        # جيب الـ columns الموجودة
        cur.execute("PRAGMA table_info(cached_analysis)")
        existing = {row[1] for row in cur.fetchall()}
        
        # الـ columns المطلوبة
        required = {
            'timing_score': 'REAL',
            'pattern_score': 'REAL',
            'market_regime_score': 'REAL',
            'liquidity_level': 'TEXT',
            'is_tradeable': 'INTEGER DEFAULT 1',
            'target_price': 'REAL',
            'stop_loss': 'REAL',
            'current_price': 'REAL',
            'confidence': 'REAL',
            'updated_at': 'TEXT',
        }
        
        for col, col_type in required.items():
            if col not in existing:
                try:
                    cur.execute(f"ALTER TABLE cached_analysis ADD COLUMN {col} {col_type}")
                except Exception as e:
                    logger.warning(f"cached_analysis column '{col}' already exists (expected): {e}")
        conn.commit()
    except Exception as e:
        logger.warning(f"cached_analysis table setup skipped (table will be created by CREATE TABLE, expected): {e}")


def _ensure_stored_analyses_columns(conn):
    """Migration آمن — يتأكد إن كل الـ columns موجودة في stored_analyses.

    DATA-UNIFY-007: أضفنا عمود turnover_egp لتوثيق قرار فلتر السيولة الصارم
    (MIN_TURNOVER_EGP = 500,000). كل INSERT جديد بيكتب القيمة، والـ rows
    القديمة بتفضي NULL وتُعتبر "غير مُوثّقة" (الـ API بيعاملها كـ unknown).

    P16-PERSONA-DIVERGENCE: أضفنا عمودين is_gambler_opportunity و is_investor_opportunity
    عشان الـ Analyzer يحسبهم بشكل مستقل كل دورة (15 دقيقة) بناءً على:
      - is_gambler_opportunity: volume_ratio >= 1.5 AND abs(change_1d) >= 2%
      - is_investor_opportunity: pe_ratio BETWEEN 5 AND 20 AND roe >= 10 AND change_1m BETWEEN -5% AND +10%
    ده بيخلي الـ Pool بتاع الأسهم مختلف تماماً لكل Persona من الأساس (مش بس
    تغيير الـ verdict/signal بعد اختيار نفس الأسهم).
    """
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(stored_analyses)")
        existing = {row[1] for row in cur.fetchall()}

        required = {
            'turnover_egp': 'REAL',
            # P16-PERSONA-DIVERGENCE: flags لفرصة كل persona (محسوبة من stocks.db)
            'is_gambler_opportunity': 'INTEGER DEFAULT 0',
            'is_investor_opportunity': 'INTEGER DEFAULT 0',
            'gambler_rank_score': 'REAL DEFAULT 0',
            'investor_rank_score': 'REAL DEFAULT 0',
            'pe_ratio': 'REAL',
            'roe': 'REAL',
            'change_1d': 'REAL',
            'change_1m': 'REAL',
            'volatility': 'REAL',
            'fair_value_upside': 'REAL',
        }
        for col, col_type in required.items():
            if col not in existing:
                try:
                    cur.execute(f"ALTER TABLE stored_analyses ADD COLUMN {col} {col_type}")
                    print(f"[BackgroundAnalyzer] ✅ Added column {col} to stored_analyses")
                except Exception as e:
                    logger.warning(f"stored_analyses column '{col}' already exists (expected): {e}")
        conn.commit()
    except Exception as e:
        logger.warning(f"stored_analyses column setup skipped: {e}")


__all__ = [
    # Public DB connection helpers
    'get_predictions_db',
    'get_stocks_db',
    'load_market_overrides',
    'resolve_market',
    'persist_analysis_with_persona',
    # PHASE 5-2 (v3.55.0): batch write path (P5: Write Batched)
    'persist_analysis_batch',
    '_build_stored_analysis_row',
    '_STORED_ANALYSES_INSERT_SQL',
    # Internal helpers (re-exported for backward compat with background_analyzer.py callers)
    '_safe_float',
    '_load_stocks_fundamentals_for_persona',
    '_compute_persona_opportunity_flags',
    '_ensure_cached_analysis_columns',
    '_ensure_stored_analyses_columns',
]
