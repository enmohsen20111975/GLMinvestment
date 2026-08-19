"""
Background Analyzer Engine
==========================
محرك التحليل الآلي في الخلفية

المهام:
- تحليل كامل كل ساعة لكل الأسواق
- تحليل تدريجي كل 5 دقائق للأسهم المتغيرة
- حفظ النتائج في قاعدة البيانات للعرض الفوري
- يستخدم MaestroOrchestrator (Human) بدل UnifiedMaestroEngine

@author M2yDevelopers Team
@version 2.0.0 - Maestro Human
"""

import os
import sys
import time
import json
import logging
import threading
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import asdict

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Module-level logger for engines wiring diagnostics
logger = logging.getLogger(__name__)

# ============================================================================
# PHASE 3-A (P3-2-EXTRACT, v3.52.0): data-layer functions moved to data.analyses
# ============================================================================
# The following 10 functions + their module-level state now live in
# `data/analyses.py` (per SIMPLIFICATION_PLAN principle P4: Layered
# Architecture — `data/` = all DB access). This module re-imports them so
# existing callers (`from analyzers.background_analyzer import ...`) keep
# working without code changes.
#   - get_predictions_db, get_stocks_db           (DB connections)
#   - load_market_overrides, resolve_market       (market isolation)
#   - _safe_float                                 (defensive coercion)
#   - _load_stocks_fundamentals_for_persona       (stocks.db reader, cached)
#   - _compute_persona_opportunity_flags          (C1 persona flags)
#   - persist_analysis_with_persona               (THE unified write path)
#   - _ensure_cached_analysis_columns             (schema migration helper)
#   - _ensure_stored_analyses_columns             (schema migration helper)
# `STOCKS_DB` is also re-exported here because BackgroundAnalyzer.__init__
# uses it as the default db_path.
# PHASE 5-2 (v3.55.0): also re-export the batch write path (P5: Write Batched)
#   - persist_analysis_batch                       (executemany batch INSERT)
#   - _build_stored_analysis_row                   (build row tuple, no DB I/O)
from data.analyses import (
    get_predictions_db,
    get_stocks_db,
    load_market_overrides,
    resolve_market,
    _safe_float,
    _load_stocks_fundamentals_for_persona,
    _compute_persona_opportunity_flags,
    persist_analysis_with_persona,
    persist_analysis_batch,
    _build_stored_analysis_row,
    _STORED_ANALYSES_INSERT_SQL,
    _ensure_cached_analysis_columns,
    _ensure_stored_analyses_columns,
    STOCKS_DB,
)

# ==================== glminvestment_engines WIRING (Phase 2) ====================
# Guarded import + runtime toggle. The env var ENABLE_ENGINES_VETO lets the
# operator disable the ATR dynamic-stop wiring without code changes if it
# misbehaves in production. When disabled or unset, the legacy fixed -8%
# stop_loss from the Maestro orchestrator is used unchanged.
_ENGINES_VETO_ENABLED = os.environ.get(
    'ENABLE_ENGINES_VETO', 'true'
).lower() in ('1', 'true', 'yes', 'on')

try:
    from glminvestment_engines.integration.risk_engine_patch import (
        create_trade_with_atr,
    )
    _ENGINES_RISK_AVAILABLE = True
except Exception as _eng_risk_imp_err:  # pragma: no cover - defensive
    logger.warning(
        "[BackgroundAnalyzer] glminvestment_engines.risk_engine_patch not "
        "available — ATR dynamic stop will be skipped: %s", _eng_risk_imp_err
    )
    _ENGINES_RISK_AVAILABLE = False

# 🧠 Expert Quality Gate — باب الجودة قبل أي توصية
try:
    from analyzers.expert_quality_gate import expert_quality_gate
    EXPERT_GATE_AVAILABLE = True
except ImportError as _expert_err:
    print(f"[BackgroundAnalyzer] ⚠️ Expert Quality Gate not available: {_expert_err}")
    EXPERT_GATE_AVAILABLE = False


from config.market_config import (
    MarketType,
    get_market_config,
    is_market_open,
    MARKET_CONFIGS,
)

# Import Maestro Orchestrator (Human) — THE BRAIN
try:
    from analyzers.maestro_orchestrator import MaestroOrchestrator, MaestroResult
    MAESTRO_ORCHESTRATOR_AVAILABLE = True
except ImportError as e:
    print(f"[BackgroundAnalyzer] MaestroOrchestrator not available: {e}")
    MAESTRO_ORCHESTRATOR_AVAILABLE = False

# Fallback: Unified Maestro (بدون Human data)
try:
    from analyzers.unified_maestro import UnifiedMaestroEngine, UnifiedMaestroResult
    UNIFIED_MAESTRO_AVAILABLE = True
except ImportError as e:
    print(f"[BackgroundAnalyzer] Unified Maestro not available: {e}")
    UNIFIED_MAESTRO_AVAILABLE = False

# Unified Persona Engine: safe storage layer (gambler + investor)
try:
    from core.persona_db import safe_store_full_analysis, ensure_persona_tables
    PERSONA_DB_AVAILABLE = True
except ImportError as e:
    print(f"[BackgroundAnalyzer] Persona DB not available: {e}")
    PERSONA_DB_AVAILABLE = False

# ============================================================================
# CONFIGURATION
# ============================================================================

# Analysis intervals
FULL_ANALYSIS_INTERVAL = 15 * 60    # 15 minutes
INCREMENTAL_INTERVAL = 5 * 60     # 5 minutes

# Markets to analyze
MARKETS = ['EGX', 'CRYPTO', 'KSA', 'KSE', 'QSE', 'DFM']


# ============================================================================
# CL7-UI-SECTORS — EGX Sector Intelligence (WRITE-time injection)
# ============================================================================
# المنطق: EGX بيتحرك قطاعات كاملة (أدوية/مطاحن/بنوك/عقارات). في كل دورة تحليل
# (كل 5/15 دقيقة) لازم نحسب خريطة سخونة القطاعات + دور كل سهم جوه قطاعه،
# ونـ logها عشان grep يلاقيها، ونحقن القرار: المضارب بيرفض laggard في قطاع ميت.
#
# الدوال الأساسية في core/opportunity_quality.py (موجودة من C2+P6). هنا بنـ
# callها على مستوى الـ batch (مرة واحدة لكل market) ونطبّق النتيجة على الـ persona
# flags قبل ما تتكتب في stored_analyses.
try:
    from core.opportunity_quality import (
        compute_sector_heat_map as _cl7_sector_heat_map,
        classify_sector_roles as _cl7_classify_sector_roles,
        get_sector_heat_status as _cl7_sector_status,
        SECTOR_HEAT_EXCLUDE as _CL7_SECTOR_EXCLUDE,
    )
    _CL7_SECTOR_AVAILABLE = True
except Exception as _cl7_imp_err:  # pragma: no cover - defensive
    print(f"[BackgroundAnalyzer] ⚠️ CL7 sector intelligence not available: {_cl7_imp_err}")
    _CL7_SECTOR_AVAILABLE = False
    _cl7_sector_heat_map = None
    _cl7_classify_sector_roles = None
    _cl7_sector_status = None
    _CL7_SECTOR_EXCLUDE = set()


def _compute_and_log_sector_intelligence(market: str) -> tuple:
    """CL7-UI-SECTORS: احسب وlog ذكاء القطاعات لسوق كامل في دورة التحليل.

    بيتعاطى مرة واحدة لكل market في _analyze_market (مش per-stock). بيرجّع:
      (heat_map, roles) — عشان الـ caller يخزّنهم على self ويستخدمهم في الـ veto.

    Logs:
      [SECTOR_HEAT]  — القطاع المهيمن (أعلى سيولة) + الساخن + الميت + ملخّص
      [SECTOR_ROLE]  — لكل سهم دوره (leader/mid/laggard) جوه قطاعه

    لو الـ module مش متاح أو الـ batch فاضي، بيرجّع ({}, {}) بصمت (no regression).
    """
    if not _CL7_SECTOR_AVAILABLE:
        return {}, {}
    try:
        fund_batch = _load_stocks_fundamentals_for_persona() or {}
        if not fund_batch:
            return {}, {}
        # فلتر للسوق المطلوب فقط (نفس منطق stored_analysis_routes)
        market_upper = (market or '').upper()
        if market_upper == 'KSA':
            market_upper = 'TADAWUL'
        market_fund = {
            t: f for t, f in fund_batch.items()
            if (f.get('market') or '').upper() == market_upper or not f.get('market')
        } if market_upper else fund_batch
        if not market_fund:
            market_fund = fund_batch  # fallback: كل الأسهم

        heat_map = _cl7_sector_heat_map(market_fund) or {}
        roles = _cl7_classify_sector_roles(market_fund) or {}

        # [SECTOR_HEAT] — القطاع المهيمن (أعلى سيولة) + الساخن + الميت
        hot = [(s, v) for s, v in heat_map.items() if v.get('status') == 'hot']
        dead = [(s, v) for s, v in heat_map.items() if v.get('status') == 'dead']
        neutral = [(s, v) for s, v in heat_map.items() if v.get('status') == 'neutral']
        # المهيمن = أعلى total_volume (سيولة القطاع)
        dominant = max(heat_map.items(), key=lambda kv: kv[1].get('total_volume', 0)) if heat_map else None
        hot.sort(key=lambda kv: -kv[1].get('avg_chg', 0))
        dead.sort(key=lambda kv: kv[1].get('avg_chg', 0))

        print(f"[SECTOR_HEAT] market={market_upper} total_sectors={len(heat_map)} "
              f"hot={len(hot)} dead={len(dead)} neutral={len(neutral)}")
        if dominant:
            dv = dominant[1]
            print(f"[SECTOR_HEAT] DOMINANT sector='{dominant[0]}' n={dv.get('n')} "
                  f"total_volume={dv.get('total_volume', 0):.0f} avg_chg={dv.get('avg_chg', 0):.2f}%")
        for s, v in hot[:3]:
            print(f"[SECTOR_HEAT] 🔥 HOT sector='{s}' n={v.get('n')} "
                  f"avg_chg={v.get('avg_chg', 0):.2f}% rising_ratio={v.get('rising_ratio', 0):.0%} "
                  f"boost=+{v.get('boost', 0):.0%}")
        for s, v in dead[:3]:
            print(f"[SECTOR_HEAT] ❄️ DEAD sector='{s}' n={v.get('n')} "
                  f"avg_chg={v.get('avg_chg', 0):.2f}% rising_ratio={v.get('rising_ratio', 0):.0%} "
                  f"boost={v.get('boost', 0):.0%}")

        # [SECTOR_ROLE] — لكل سهم دوره (sample أول 15 عشان ما ن Floodش اللوج)
        leaders = [(t, r) for t, r in roles.items() if r == 'leader']
        laggards = [(t, r) for t, r in roles.items() if r == 'laggard']
        print(f"[SECTOR_ROLE] market={market_upper} leaders={len(leaders)} "
              f"laggards={len(laggards)} mids={len(roles) - len(leaders) - len(laggards)}")
        for t, r in list(roles.items())[:15]:
            # دور على sector + status للسهم ده
            _sec = (market_fund.get(t) or {}).get('sector', '?')
            _st = _cl7_sector_status(_sec, heat_map) if _cl7_sector_status else 'neutral'
            print(f"[SECTOR_ROLE] ticker={t} sector={_sec} role={r} status={_st}")

        return heat_map, roles
    except Exception as _cl7_e:
        print(f"[BackgroundAnalyzer] CL7 sector intelligence error: {_cl7_e}")
        return {}, {}


def _apply_sector_veto_to_persona_flags(
    persona_flags: dict,
    ticker: str,
    heat_map: dict,
    roles: dict,
) -> dict:
    """CL7-UI-SECTORS: حقن القطاع في قرار المضارب (veto laggard-in-dead).

    القاعدة (من البروتوكول):
      - بوابة المضارب (Gambler): ترفض شراء Laggard في قطاع ميت.
        لو is_gambler=1 بس السهم laggard في قطاع dead → is_gambler=0 + log [SECTOR_VETO].
      - بوابة المستثمر (Investor): مفيش veto قطاعي (المستثمر بيهتم بالأساسيات
        والاستقرار، مش بـ day-trade القطاع). بس نـ log للشفافية لو كان laggard.

    ده "حقن خفيف" — مفيش إزالة للأسهم الكويسة فنياً، بس بنرفض laggard في قطاع ميت
    (أسوأ تركيبة للمضارب: قطاع هابط + السهم متأخر عن قطاعه).

    Returns: persona_flags (نفس الـ dict، ممكن معدّل is_gambler).
    """
    if not persona_flags or not heat_map or not roles:
        return persona_flags
    try:
        ticker_upper = (ticker or '').upper()
        role = roles.get(ticker_upper, 'mid')
        if role == 'mid':
            return persona_flags  # مفيش veto على mid
        # دور على sector + status
        fund_batch = _load_stocks_fundamentals_for_persona() or {}
        fund = fund_batch.get(ticker_upper, {}) or {}
        sector = fund.get('sector', '')
        if not sector or sector in _CL7_SECTOR_EXCLUDE:
            return persona_flags
        status = _cl7_sector_status(sector, heat_map) if _cl7_sector_status else 'neutral'
        if status == 'neutral':
            return persona_flags

        is_g = int(persona_flags.get('is_gambler', 0) or 0)
        # Veto: laggard في قطاع ميت → ارفع is_gambler
        if status == 'dead' and role == 'laggard' and is_g == 1:
            persona_flags['is_gambler'] = 0
            # خصم الـ rank برضو عشان الترتيب يطحّه لتحت
            _g_rank = float(persona_flags.get('gambler_rank', 0) or 0)
            persona_flags['gambler_rank'] = round(_g_rank * 0.5, 2)
            print(f"[SECTOR_VETO] ticker={ticker_upper} sector={sector} role={role} "
                  f"status={status} → is_gambler 1→0 (laggard in dead sector). "
                  f"gambler_rank {_g_rank:.1f}→{persona_flags['gambler_rank']:.1f}")
        else:
            # Log للشفافية بس (مش veto)
            print(f"[SECTOR_ROLE_APPLIED] ticker={ticker_upper} sector={sector} "
                  f"role={role} status={status} is_gambler={is_g} (no veto)")
        return persona_flags
    except Exception as _veto_e:
        print(f"[BackgroundAnalyzer] CL7 sector veto error for {ticker}: {_veto_e}")
        return persona_flags


def init_tables():
    """Initialize analysis tables."""
    conn = get_predictions_db()
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS stored_analyses (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                maestro_score REAL DEFAULT 0,
                recommendation TEXT DEFAULT 'hold',
                recommendation_ar TEXT,
                confidence REAL DEFAULT 0,
                entry_price REAL DEFAULT 0,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL DEFAULT 0,
                regime TEXT,
                regime_score REAL,
                regime_confidence REAL,
                timeframe_score REAL,
                timeframe_aligned INTEGER DEFAULT 0,
                timeframe_count INTEGER DEFAULT 0,
                volume_ratio REAL,
                liquidity_rating TEXT,
                news_risk_level TEXT,
                has_cbe_news INTEGER DEFAULT 0,
                analysis_json TEXT,
                analysis_type TEXT DEFAULT 'scheduled',
                analysis_version TEXT DEFAULT '2.0',
                turnover_egp REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, market)
            );
            
            CREATE INDEX IF NOT EXISTS idx_stored_ticker ON stored_analyses(ticker);
            CREATE INDEX IF NOT EXISTS idx_stored_market ON stored_analyses(market);
            CREATE INDEX IF NOT EXISTS idx_stored_score ON stored_analyses(maestro_score);
            CREATE INDEX IF NOT EXISTS idx_stored_rec ON stored_analyses(recommendation);
            
            CREATE TABLE IF NOT EXISTS analysis_engine_status (
                id TEXT PRIMARY KEY DEFAULT 'main',
                is_running INTEGER DEFAULT 0,
                current_market TEXT,
                current_ticker TEXT,
                total_analyzed INTEGER DEFAULT 0,
                total_pending INTEGER DEFAULT 0,
                last_full_analysis DATETIME,
                last_run DATETIME,
                next_scheduled_run DATETIME,
                error_count INTEGER DEFAULT 0,
                last_error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS analysis_jobs (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                job_type TEXT NOT NULL,
                market TEXT,
                ticker TEXT,
                status TEXT DEFAULT 'pending',
                progress REAL DEFAULT 0,
                total_items INTEGER DEFAULT 0,
                processed_items INTEGER DEFAULT 0,
                result_summary TEXT,
                error_message TEXT,
                started_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            INSERT OR IGNORE INTO analysis_engine_status (id) VALUES ('main');
        ''')
        conn.commit()
        # DATA-UNIFY-007: ensure turnover_egp column exists on legacy stored_analyses tables
        _ensure_stored_analyses_columns(conn)
        print("[BackgroundAnalyzer] Tables initialized")
    except Exception as e:
        print(f"[BackgroundAnalyzer] Error initializing tables: {e}")
    finally:
        conn.close()

    # Unified Persona Engine: إنشاء persona_predictions (آمن — CREATE TABLE IF NOT EXISTS)
    if PERSONA_DB_AVAILABLE:
        try:
            ensure_persona_tables()
            print("[BackgroundAnalyzer] Persona tables ensured ✅")
        except Exception as e:
            print(f"[BackgroundAnalyzer] Persona tables init failed: {e}")


# ============================================================================
# STORY ARC BUILDER — بناء القصة التاريخية للسهم بالعربي
# ============================================================================

def _build_story_arc(ticker, human_context, gambler, investor):
    """بناء القصة التاريخية للسهم بالعربي (3 أجزاء).

    يرجع dict فيه:
      - price_movement: حركة السعر من القمة/القاع
      - historical_context: السياق التاريخي (دعم/مقاومة)
      - dual_verdict: آراء الشخصيتين (gambler + investor)

    كل القيم بالعربي العامي. لو البيانات ناقصة، الحقل بيتسكّب.
    آمن 100% — كل حاجة في try/except.
    """
    story = {}
    try:
        # human_context ممكن يكون dataclass أو dict أو None
        tc = {}
        if human_context is not None:
            if hasattr(human_context, 'time_context'):
                tc = human_context.time_context or {}
            elif isinstance(human_context, dict):
                tc = human_context.get('time', {}) or human_context.get('time_context', {}) or {}

        current = _safe_float(tc.get('current_price') or tc.get('price'))
        high_52w = _safe_float(tc.get('high_52w') or tc.get('high_52_week'))
        low_52w = _safe_float(tc.get('low_52w') or tc.get('low_52_week'))
        support = _safe_float(tc.get('support'))
        resistance = _safe_float(tc.get('resistance'))

        # الجزء 1: حركة السعر من القمة السنوية
        if current > 0 and high_52w > 0:
            drop_pct = ((high_52w - current) / high_52w) * 100
            if drop_pct > 5:
                story['price_movement'] = (
                    f"السهم نزل من {high_52w:.2f} لـ {current:.2f}"
                    f" (-{drop_pct:.1f}% من القمة)"
                )
            elif drop_pct < -5:
                rise_pct = abs(drop_pct)
                story['price_movement'] = (
                    f"السهم طلع من {high_52w:.2f} لـ {current:.2f}"
                    f" (+{rise_pct:.1f}% فوق القمة السابقة)"
                )
            else:
                story['price_movement'] = f"السهم قرب أعلى مستوياته ({current:.2f})"
        elif current > 0 and low_52w > 0:
            rise_from_low = ((current - low_52w) / low_52w) * 100 if low_52w > 0 else 0
            if rise_from_low > 10:
                story['price_movement'] = (
                    f"السهم طلع من {low_52w:.2f} لـ {current:.2f}"
                    f" (+{rise_from_low:.1f}% من القاع)"
                )

        # الجزء 2: السياق التاريخي (دعم/مقاومة)
        if support > 0 and current > 0:
            dist_to_support = ((current - support) / current) * 100
            if dist_to_support < 5:
                story['historical_context'] = f"وصل منطقة دعم قوية عند {support:.2f}"
            elif dist_to_support < 15:
                story['historical_context'] = f"قريب من دعم {support:.2f} ({dist_to_support:.1f}% بُعد)"
            else:
                story['historical_context'] = f"الدعم عند {support:.2f} — بعيد حالياً"
        elif resistance > 0 and current > 0:
            dist_to_resistance = ((resistance - current) / current) * 100
            if dist_to_resistance < 5:
                story['historical_context'] = f"قرب مقاومة قوية عند {resistance:.2f}"
            elif dist_to_resistance < 15:
                story['historical_context'] = f"على بعد {dist_to_resistance:.1f}% من مقاومة {resistance:.2f}"

        # الجزء 3: رأي الشخصيتين
        g_verdict = ''
        i_verdict = ''
        if isinstance(gambler, dict):
            g_verdict = gambler.get('verdict', '') or ''
        if isinstance(investor, dict):
            i_verdict = investor.get('verdict', '') or ''
        if g_verdict or i_verdict:
            story['dual_verdict'] = {
                'gambler': g_verdict,
                'investor': i_verdict,
            }

    except Exception as e:
        print(f"[StoryArc] Error building story for {ticker}: {e}")

    return story


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


# PHASE 3-A (P3-2-EXTRACT): persist_analysis_with_persona + the migration
# helpers _ensure_cached_analysis_columns / _ensure_stored_analyses_columns
# now live in `data/analyses.py`. They are re-imported at the top of this
# module so existing callers (`from analyzers.background_analyzer import
# persist_analysis_with_persona`) keep working. See data/analyses.py for
# the canonical implementations.
# ============================================================================
# BACKGROUND ANALYZER
# ============================================================================


# ============================================================================
# TOOLKIT-UNIFY-013: Chart-unified indicators for the maestro side
# ============================================================================
# هذه الـ helpers بتوفر نفس المؤشرات اللي بيحسبها chart_routes.py للشارت
# التفاعلي، عشان نضمن إن الـ stored_analyses.analysis_json يحتوي على نفس
# البيانات (BOS, BB_Squeeze, CMF, RegimeDetector, SMA200, FlowSystemEngine).
# كل الدوال defensive — لو الـ history مش كافي، بترجع None أو 0 بدون رمي خطأ.

def _maestro_rolling_sma(data, period):
    """SMA as array — same logic as chart_routes._rolling_sma."""
    result = []
    for i in range(len(data)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(data[i - period + 1:i + 1]) / period)
    return result


def _maestro_rolling_atr(highs, lows, closes, period=14):
    """ATR as array — same logic as chart_routes._rolling_atr."""
    result = []
    tr_list = []
    for i in range(len(closes)):
        if i == 0:
            tr = highs[i] - lows[i]
        else:
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )
        tr_list.append(tr)
    for i in range(len(tr_list)):
        if i < period - 1:
            result.append(None)
        elif i == period - 1:
            result.append(round(sum(tr_list[:period]) / period, 4))
        else:
            prev_atr = result[-1] or (sum(tr_list[:period]) / period)
            result.append(round((prev_atr * (period - 1) + tr_list[i]) / period, 4))
    return result


def _maestro_rolling_std(data, period):
    """Rolling standard deviation — same logic as chart_routes._rolling_std."""
    import math as _math
    result = []
    for i in range(len(data)):
        if i < period - 1:
            result.append(None)
        else:
            window = data[i - period + 1:i + 1]
            mean = sum(window) / period
            variance = sum((x - mean) ** 2 for x in window) / period
            result.append(_math.sqrt(variance))
    return result


def _maestro_rolling_bollinger(closes, period=20, mult=2.0):
    """Bollinger Bands arrays."""
    sma = _maestro_rolling_sma(closes, period)
    std = _maestro_rolling_std(closes, period)
    upper, middle, lower = [], [], []
    for i in range(len(closes)):
        if sma[i] is None:
            upper.append(None); middle.append(None); lower.append(None)
        else:
            upper.append(sma[i] + mult * std[i])
            middle.append(sma[i])
            lower.append(sma[i] - mult * std[i])
    return upper, middle, lower


def _maestro_calc_cmf(highs, lows, closes, volumes, period=20):
    """Chaikin Money Flow — returns last value only (float)."""
    n = len(closes)
    if n < period or not volumes:
        return 0.0
    sum_cmf_vol = 0.0
    sum_vol = 0.0
    for j in range(n - period, n):
        if j < 0:
            continue
        h, l, c = highs[j], lows[j], closes[j]
        v = volumes[j] if j < len(volumes) else 0
        denom = h - l
        if denom == 0 or denom < 0.0001:
            denom = 0.0001
        mfm = ((c - l) - (h - c)) / denom
        sum_cmf_vol += mfm * v
        sum_vol += v
    return round(sum_cmf_vol / sum_vol, 6) if sum_vol > 0 else 0.0


def _maestro_detect_bos(closes, highs, lows, lookback=5):
    """Break of Structure detection — returns last 3 events (dicts)."""
    if len(closes) < lookback * 2 + 1:
        return []
    swing_highs = []
    swing_lows = []
    for i in range(lookback, len(highs) - lookback):
        window = highs[i - lookback:i + lookback + 1]
        if highs[i] == max(window):
            swing_highs.append((i, highs[i]))
        window_l = lows[i - lookback:i + lookback + 1]
        if lows[i] == min(window_l):
            swing_lows.append((i, lows[i]))
    events = []
    for idx in range(max(1, len(closes) - 30), len(closes)):  # last 30 candles
        for sh_idx, sh_val in swing_highs:
            if sh_idx < idx and closes[idx - 1] <= sh_val and closes[idx] > sh_val:
                events.append({'index': idx, 'type': 'bos_up',
                               'price': round(closes[idx], 4),
                               'level': round(sh_val, 4)})
                break
        for sl_idx, sl_val in swing_lows:
            if sl_idx < idx and closes[idx - 1] >= sl_val and closes[idx] < sl_val:
                events.append({'index': idx, 'type': 'bos_down',
                               'price': round(closes[idx], 4),
                               'level': round(sl_val, 4)})
                break
    return events[-5:]


def _maestro_detect_bb_squeeze(bb_upper, bb_lower, closes, highs, lows, period=20, kc_mult=1.5):
    """BB Squeeze: Bollinger Bands inside Keltner Channels."""
    if len(closes) < period or not bb_upper or not bb_lower:
        return {'state': 'normal', 'color': '#6b7280', 'text': 'بيانات غير كافية'}
    sub_highs = highs[-period * 3:] if len(highs) > period * 3 else highs
    sub_lows = lows[-period * 3:] if len(lows) > period * 3 else lows
    sub_closes = closes[-period * 3:] if len(closes) > period * 3 else closes
    atr_arr = _maestro_rolling_atr(sub_highs, sub_lows, sub_closes, period)
    atr_val = None
    for a in reversed(atr_arr):
        if a is not None:
            atr_val = a
            break
    if atr_val is None:
        atr_val = closes[-1] * 0.02
    sma_val = sum(closes[-period:]) / period
    kc_upper = sma_val + kc_mult * atr_val
    kc_lower = sma_val - kc_mult * atr_val
    bb_u = bb_upper[-1] if bb_upper[-1] is not None else sma_val + 2 * atr_val
    bb_l = bb_lower[-1] if bb_lower[-1] is not None else sma_val - 2 * atr_val
    if bb_l > kc_lower and bb_u < kc_upper:
        return {'state': 'squeeze_on', 'color': '#f97316', 'text': 'انضغاط (انفجار قادم) ⚡'}
    elif bb_l < kc_lower and bb_u < kc_upper:
        return {'state': 'squeeze_release', 'color': '#22c55e', 'text': 'بدء الانفجار السعري 🚀'}
    return {'state': 'normal', 'color': '#6b7280', 'text': 'طبيعي'}


def _maestro_compute_chart_unified_indicators(ticker, history, db_path):
    """Compute the 6 chart-only indicators for storage in analysis_json.

    Returns a dict with keys: bos_events, bb_squeeze, cmf, regime,
    sma200, flow_system. All values are JSON-serializable.

    Defensive — any error is swallowed; the missing key is set to None.
    """
    result = {
        'bos_events': [],
        'bb_squeeze': {'state': 'normal', 'color': '#6b7280', 'text': 'بيانات غير كافية'},
        'cmf': 0.0,
        'regime': {'regime': 'unknown', 'regime_ar': 'غير محدد', 'confidence': 0, 'color': '#6b7280'},
        'sma200': None,
        'flow_system': {'flow_score': 0, 'label_en': 'UNKNOWN', 'label_ar': 'غير مُقيّم',
                        'color': '#6b7280', 'action_en': 'WAIT'},
    }

    if not history or len(history) < 5:
        return result

    try:
        closes = [float(h.get('close', h.get('close_price', 0)) or 0) for h in history]
        highs = [float(h.get('high', h.get('high_price', 0)) or 0) for h in history]
        lows = [float(h.get('low', h.get('low_price', 0)) or 0) for h in history]
        volumes = [float(h.get('volume', 0) or 0) for h in history]

        # Filter zero closes
        if any(c <= 0 for c in closes[-5:]):
            return result

        # BOS events
        try:
            result['bos_events'] = _maestro_detect_bos(closes, highs, lows, lookback=5)
        except Exception as _bos_err:
            logger.debug(f"[BackgroundAnalyzer] BOS compute failed for {ticker}: {_bos_err}")

        # BB Squeeze
        try:
            bb_upper, bb_middle, bb_lower = _maestro_rolling_bollinger(closes, 20, 2.0)
            result['bb_squeeze'] = _maestro_detect_bb_squeeze(bb_upper, bb_lower, closes, highs, lows, period=20)
        except Exception as _bb_err:
            logger.debug(f"[BackgroundAnalyzer] BB Squeeze compute failed for {ticker}: {_bb_err}")

        # CMF (last value)
        try:
            result['cmf'] = _maestro_calc_cmf(highs, lows, closes, volumes, period=20)
        except Exception as _cmf_err:
            logger.debug(f"[BackgroundAnalyzer] CMF compute failed for {ticker}: {_cmf_err}")

        # SMA200 (only if we have enough data)
        try:
            if len(closes) >= 200:
                sma200_arr = _maestro_rolling_sma(closes, 200)
                last_sma200 = None
                for v in reversed(sma200_arr):
                    if v is not None:
                        last_sma200 = v
                        break
                if last_sma200 is not None:
                    result['sma200'] = round(last_sma200, 4)
        except Exception as _sma_err:
            logger.debug(f"[BackgroundAnalyzer] SMA200 compute failed for {ticker}: {_sma_err}")

        # RegimeDetector (DB-based, same as chart_routes)
        try:
            from analyzers.regime_detector import RegimeDetector
            detector = RegimeDetector(db_path)
            regime_data = None
            try:
                regime_data = detector.detect_regime(ticker)
            except Exception:
                try:
                    regime_data = detector.detect_market_regime()
                except Exception as _rd_err:
                    logger.debug(f"[BackgroundAnalyzer] RegimeDetector fallback failed for {ticker}: {_rd_err}")
            if regime_data:
                rv = regime_data.get('regime', 'unknown')
                rm = {
                    'bull_trend': ('صعودي 🟢', '#22c55e'),
                    'bear_trend': ('هبوطي 🔴', '#ef4444'),
                    'ranging': ('عرضي 🟡', '#eab308'),
                    'volatile': ('متقلب 🟠', '#f97316'),
                    'squeeze': ('منضغط ⚡', '#a855f7'),
                }
                ar, clr = rm.get(rv, ('غير محدد ⚪', '#6b7280'))
                result['regime'] = {
                    'regime': rv,
                    'regime_ar': regime_data.get('regime_ar', ar),
                    'confidence': regime_data.get('confidence', 0),
                    'color': clr,
                }
        except Exception as _reg_err:
            logger.debug(f"[BackgroundAnalyzer] RegimeDetector block failed for {ticker}: {_reg_err}")

        # FlowSystemEngine (with stub fallback)
        try:
            try:
                from engine.flow_system import FlowSystemEngine
            except ImportError:
                from analyzers.flow_system import FlowSystemEngine  # legacy path
            fe = FlowSystemEngine(db_path)
            fl = fe.calculate_flow_score(ticker)
            if fl:
                result['flow_system'] = {
                    'flow_score': fl.flow_score,
                    'label_en': fl.label_en,
                    'label_ar': fl.label,
                    'color': fl.color,
                    'action_en': fl.action_en,
                }
            else:
                # Stub fallback — keep the default UNKNOWN entry
                pass
        except Exception as _fl_err:
            logger.debug(f"[BackgroundAnalyzer] FlowSystemEngine failed for {ticker}: {_fl_err}")
            # Stub already in result
    except Exception as _big_err:
        logger.warning(f"[BackgroundAnalyzer] chart_unified_indicators block failed for {ticker}: {_big_err}")

    return result


class BackgroundAnalyzer:
    """
    محرك التحليل الآلي في الخلفية
    
    يقوم بـ:
    - تحليل كامل كل ساعة لكل الأسواق
    - تحليل تدريجي كل 5 دقائق للأسهم المتغيرة
    - حفظ النتائج في قاعدة البيانات
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or STOCKS_DB
        self.orchestrator = None
        self.unified_maestro = None
        self.running = False
        self.thread = None
        self.last_full_analysis = None
        self.last_incremental_analysis = None
        self.uses_human = False
        self.post_market_done = {}
        # 🔒 Lock لمنع تعارض scheduler tasks (P0 fix يوليو 2026)
        self._full_analysis_lock = threading.Lock()
        self._incremental_lock = threading.Lock()
        # ⚡ نبض السوق — بيتم تحديثه من market_scheduler عشان أي محلل يوصل إليه
        self._current_market_pulse = None
        # P0-KILLSWITCH-050 (v2): سبب آخر رفض للتحليل (لو الداتا قديمة)
        self._last_stale_reason: str | None = None
        # CL7-UI-SECTORS: خريطة سخونة القطاعات + أدوار الأسهم للسوق الحالي.
        # بيتحسب مرة واحدة في _analyze_market (لكل market) ويستخدم في الـ veto.
        self._sector_heat_map: dict = {}
        self._sector_roles: dict = {}
        self.stats = {
            'total_analyzed': 0,
            'total_buy_signals': 0,
            'errors': 0,
            'last_error': None
        }
        
        # Initialize Maestro Orchestrator (Human) — الأولوية الأولى
        if MAESTRO_ORCHESTRATOR_AVAILABLE:
            try:
                self.orchestrator = MaestroOrchestrator(self.db_path)
                self.uses_human = True
                print("[BackgroundAnalyzer] MaestroOrchestrator (Human) initialized ✅")
            except Exception as e:
                print(f"[BackgroundAnalyzer] Failed to init MaestroOrchestrator: {e}")
        
        # Fallback: Unified Maestro (بدون Human data)
        if not self.orchestrator and UNIFIED_MAESTRO_AVAILABLE:
            try:
                self.unified_maestro = UnifiedMaestroEngine(self.db_path)
                print("[BackgroundAnalyzer] Unified Maestro initialized (fallback - بدون Human)")
            except Exception as e:
                print(f"[BackgroundAnalyzer] Failed to init UnifiedMaestro: {e}")
        
        # Initialize tables
        init_tables()
    
    def start(self):
        """Start the background analyzer."""
        if self.running:
            print("[BackgroundAnalyzer] Already running")
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print("[BackgroundAnalyzer] Started")
    
    def stop(self):
        """Stop the background analyzer."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        print("[BackgroundAnalyzer] Stopped")
    
    def _run_loop(self):
        """Main loop for background analysis."""
        print("[BackgroundAnalyzer] Loop started")
        
        # Run initial analysis 5 seconds after startup in the background
        print("[BackgroundAnalyzer] Initial analysis scheduled in 5 seconds...")
        
        last_full = time.time() - FULL_ANALYSIS_INTERVAL + 5  # Run in 5 seconds
        last_incremental = time.time()
        
        while self.running:
            try:
                now = time.time()
                
                # Full analysis every hour
                if now - last_full >= FULL_ANALYSIS_INTERVAL:
                    print("[BackgroundAnalyzer] Starting scheduled full analysis...")
                    self._run_full_analysis()
                    last_full = now
                
                # Incremental analysis every 5 minutes
                elif now - last_incremental >= INCREMENTAL_INTERVAL:
                    print("[BackgroundAnalyzer] Starting incremental analysis...")
                    self._run_incremental_analysis()
                    last_incremental = now
                
                # Sleep for 30 seconds before checking again
                time.sleep(30)
                
            except Exception as e:
                print(f"[BackgroundAnalyzer] Error in loop: {e}")
                self.stats['errors'] += 1
                self.stats['last_error'] = str(e)
                time.sleep(60)
    
    def _run_full_analysis(self, market_pulse: dict = None):
        """Run full analysis for all markets."""
        if not self.orchestrator and not self.unified_maestro:
            print("[BackgroundAnalyzer] No analyzer available")
            return

        # P25-LIVING-ENGINE: أعد قراءة optimizer_params.json في بداية كل دورة
        # كاملة عشان تلتقط تعديلات السكريبت الأسبوعي (weekly_market_adjustment.py)
        # أو الأدمن فوراً — بدل ما تنتظر restart للباك-إند.
        try:
            from api.optimizer_params_routes import reload_optimizer_params
            reload_optimizer_params()
        except Exception as _op_err:
            logger.debug(f"[BackgroundAnalyzer] optimizer_params reload skipped: {_op_err}")

        # P0-KILLSWITCH-050 (v2): Stale Data Veto — بطل تحلل في داتا قديمة
        # قبل الـ veto، حاول إحياء الـ data engine لو مات (Fix 3 — يوليو 2026)
        try:
            from utils.data_engine_guard import ensure_data_engine_alive, trigger_data_refresh
            if not ensure_data_engine_alive(timeout=5):
                logger.warning(
                    "[BackgroundAnalyzer] Data Engine (port 5000) not responding — "
                    "attempting to skip with stale veto."
                )
            else:
                # الـ engine حي → اطلب refresh للأسعار قبل التحليل
                trigger_data_refresh()
        except Exception as _de_guard_err:
            logger.debug(f"[BackgroundAnalyzer] data_engine_guard skipped: {_de_guard_err}")

        if self._is_data_stale():
            _reason = getattr(self, '_last_stale_reason', None) or 'unknown'
            logger.error(
                f"🚨 DATA IS STALE! Skipping full analysis to prevent garbage predictions. "
                f"Reason: {_reason}"
            )
            print(f"[BackgroundAnalyzer] 🚨 STALE VETO (full): {_reason}")
            return

        # 🔒 لو فيه تحليل شغال، تجنّب التعارض (P0 fix يوليو 2026)
        if not self._full_analysis_lock.acquire(blocking=False):
            print("[BackgroundAnalyzer] Full analysis already running — skip")
            return
        try:
            self._run_full_analysis_inner(market_pulse=market_pulse)
        finally:
            self._full_analysis_lock.release()

    def _run_full_analysis_inner(self, market_pulse: dict = None):
        """المنطق الفعلي للتحليل الكامل."""
        # ⚡ نبض السوق — نحفظه عشان أي محلل يقدر يوصل إليه
        if market_pulse:
            self._current_market_pulse = market_pulse
            print(f"[BackgroundAnalyzer] Market pulse received: regime={market_pulse.get('regime')}, breadth={market_pulse.get('breadth', 0):.1%}")

        self._update_status(is_running=True, current_market='ALL')
        
        total_analyzed = 0
        total_buy = 0
        
        try:
            # حفظ حالة السوق اليومية (market regime)
            try:
                from analyzers.regime_detector import save_daily_regime
                regime_result = save_daily_regime(self.db_path)
                print(f"[BackgroundAnalyzer] Market regime: {regime_result.get('regime')} ({regime_result.get('action')})")
            except Exception as e:
                print(f"[BackgroundAnalyzer] Could not save market regime: {e}")
            
            for market in MARKETS:
                # Check if we should analyze this market based on session timing/standby rules
                should_run = False
                market_open = is_market_open(market)
                
                # Get current date in market timezone
                import pytz
                tz_name = 'Africa/Cairo'
                config = get_market_config(market)
                if config:
                    tz_name = config.timezone
                try:
                    market_tz = pytz.timezone(tz_name)
                    market_date = datetime.now(market_tz).strftime('%Y-%m-%d')
                except Exception:
                    market_date = datetime.now().strftime('%Y-%m-%d')
                
                if market_open:
                    should_run = True
                    # Reset the post-market run flag when the market is open
                    self.post_market_done[market] = None
                else:
                    # Market is closed. Check if we need to run a final post-market analysis to preserve the day's last predictions
                    if self.post_market_done.get(market) != market_date:
                        should_run = True
                        self.post_market_done[market] = market_date
                        print(f"[BackgroundAnalyzer] Market {market} is closed. Running final post-market analysis for {market_date}...")
                    else:
                        # Already done, skip this run to keep the engine in standby for this market
                        pass
                
                if should_run:
                    print(f"[BackgroundAnalyzer] Analyzing market: {market}")
                    analyzed, buy_count = self._analyze_market(market)
                    total_analyzed += analyzed
                    total_buy += buy_count
                    
                    # Auto-generate predictions for this market
                    try:
                        from api.ai_predictions_routes import generate_predictions_internal
                        # P26-FORCE-SAVE fixed to 60: أي سهم درجته < 60 لن يتم حفظه
                        success, preds = generate_predictions_internal(market=market, min_score=60)
                        if success:
                            print(f"[BackgroundAnalyzer] ✓ Auto-generated {len(preds)} AI predictions for market {market}")
                        else:
                            print(f"[BackgroundAnalyzer] Warning: failed to auto-generate predictions for {market}: {preds}")
                    except Exception as e:
                        print(f"[BackgroundAnalyzer] Error calling generate_predictions for {market}: {e}")
                else:
                    print(f"[BackgroundAnalyzer] Market {market} is closed and final predictions are already saved. Standby.")
            
            self.last_full_analysis = datetime.now()
            self.stats['total_analyzed'] = total_analyzed
            self.stats['total_buy_signals'] = total_buy
            
            self._update_status(
                is_running=False,
                total_analyzed=total_analyzed,
                last_full_analysis=self.last_full_analysis.isoformat(),
                last_run=datetime.now().isoformat(),
                next_scheduled_run=(datetime.now() + timedelta(hours=1)).isoformat()
            )
            
            print(f"[BackgroundAnalyzer] Full analysis cycle complete: {total_analyzed} stocks analyzed, {total_buy} buy signals found")
            
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error in full analysis: {e}")
            self._update_status(is_running=False, error=str(e))
    
    def _run_incremental_analysis(self, market_pulse: dict = None):
        """Run incremental analysis for recently changed stocks."""
        if not self.orchestrator and not self.unified_maestro:
            return

        # P0-KILLSWITCH-050 (v2): Stale Data Veto
        # لو الـ data engine مات، الـ incremental ما لوش قيمة — skip
        try:
            from utils.data_engine_guard import ensure_data_engine_alive
            if not ensure_data_engine_alive(timeout=3):
                logger.warning(
                    "[BackgroundAnalyzer] Data Engine not responding — skipping incremental."
                )
                return
        except Exception:
            pass

        if self._is_data_stale():
            _reason = getattr(self, '_last_stale_reason', None) or 'unknown'
            logger.error(
                f"🚨 DATA IS STALE! Skipping incremental analysis to prevent garbage. "
                f"Reason: {_reason}"
            )
            print(f"[BackgroundAnalyzer] 🚨 STALE VETO (incremental): {_reason}")
            return

        # 🔒 لو فيه incremental شغال، تجنّب التعارض (P0 fix يوليو 2026)
        if not self._incremental_lock.acquire(blocking=False):
            print("[BackgroundAnalyzer] Incremental analysis already running — skip")
            return
        try:
            self._run_incremental_analysis_inner(market_pulse=market_pulse)
        finally:
            self._incremental_lock.release()

    def _run_incremental_analysis_inner(self, market_pulse: dict = None):
        """المنطق الفعلي للتحليل التدريجي."""
        # ⚡ نبض السوق
        if market_pulse:
            self._current_market_pulse = market_pulse

        try:
            # Get stocks that changed in the last 5 minutes
            changed_stocks = self._get_changed_stocks()
            
            if not changed_stocks:
                return
            
            # Filter changed stocks: only analyze those belonging to open markets
            open_changed_stocks = []
            for stock in changed_stocks:
                market = stock.get('market', 'EGX')
                if is_market_open(market):
                    open_changed_stocks.append(stock)
            
            if not open_changed_stocks:
                return
            
            print(f"[BackgroundAnalyzer] Incremental analysis for {len(open_changed_stocks)} stocks (in open markets)")
            
            markets_to_generate = set()
            for stock in open_changed_stocks[:50]:  # Limit to 50 stocks
                result = self._analyze_and_store(stock['ticker'], stock['market'])
                if result:
                    markets_to_generate.add(stock['market'])
            
            # Auto-generate predictions for all affected markets
            if markets_to_generate:
                from api.ai_predictions_routes import generate_predictions_internal
                for market in markets_to_generate:
                    try:
                        # P26-FORCE-SAVE fixed to 60: أي سهم درجته < 60 لن يتم حفظه
                        success, preds = generate_predictions_internal(market=market, min_score=60)
                        if success:
                            print(f"[BackgroundAnalyzer] [Incremental] ✓ Auto-generated {len(preds)} AI predictions for market {market}")
                        else:
                            print(f"[BackgroundAnalyzer] [Incremental] Warning: failed to auto-generate predictions for {market}: {preds}")
                    except Exception as e:
                        print(f"[BackgroundAnalyzer] [Incremental] Error calling generate_predictions for {market}: {e}")
            
            self.last_incremental_analysis = datetime.now()
            self._update_status(last_run=datetime.now().isoformat())
            
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error in incremental analysis: {e}")
    
    def _analyze_market(self, market: str) -> tuple:
        """Analyze all stocks in a market."""
        analyzed = 0
        buy_count = 0
        
        try:
            # CL7-UI-SECTORS: احسب ذكاء القطاعات مرة واحدة لهذا السوق قبل الـ loop.
            # بيرجّع (heat_map, roles) ونخزّنهم على self عشان _analyze_and_store
            # يستخدمهم في الـ veto (laggard-in-dead → is_gambler=0).
            # بـ log [SECTOR_HEAT] + [SECTOR_ROLE] عشان grep يلاقيهم في trigger-analysis.
            self._sector_heat_map, self._sector_roles = _compute_and_log_sector_intelligence(market)

            # Get stocks for this market
            stocks = self._get_market_stocks(market)
            
            print(f"[BackgroundAnalyzer] Found {len(stocks)} stocks for {market}")
            
            for stock in stocks:
                try:
                    result = self._analyze_and_store(stock['ticker'], market, stock_data=stock)
                    if result:
                        analyzed += 1
                        if self.uses_human:
                            rec = getattr(result, 'recommendation', '')
                            if rec in ["buy", "strong_buy"]:
                                buy_count += 1
                        else:
                            if result.signal in ["STRONG_BUY", "BUY", "buy", "strong_buy"]:
                                buy_count += 1
                except Exception as e:
                    print(f"[BackgroundAnalyzer] Error analyzing {stock['ticker']}: {e}")
                
                # Update status periodically
                if analyzed % 10 == 0:
                    self._update_status(
                        current_market=market,
                        current_ticker=stock['ticker'],
                        total_analyzed=analyzed
                    )
        
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error analyzing market {market}: {e}")
        
        return analyzed, buy_count
    
    def _analyze_and_store(self, ticker: str, market: str, stock_data: Dict = None) -> Any:
        """Analyze a single ticker and store the result. Uses MaestroOrchestrator (Human) if available."""

        # ── MARKET-ISOLATION (Axis B): صحح السوق قبل أي شيء ──
        # لو الـ market اللي جاي من الـ caller غلط (سهم سعودي كأنه EGX)،
        # resolve_market() بيرجع للـ data_engine.db كمرجع رسمي ويصححه.
        # ده بيضمن إن stored_analyses دايماً يكون فيها market field صحيح.
        market = resolve_market(ticker, fallback_market=market)

        # === المسار الرئيسي: MaestroOrchestrator (Human) ===
        if self.orchestrator:
            try:
                # جلب بيانات السهم والسعر
                import sqlite3
                conn = sqlite3.connect(self.db_path)
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()

                # جلب بيانات السهم
                if not stock_data:
                    # P40-MARKET-ISOLATION: فلتر بالسوق في الـ fallback query عشان
                    # ما نجيبش سهم من سوق تاني لو الـ ticker متكرر عبر الأسواق.
                    if market == 'EGX':
                        cur.execute('''SELECT * FROM stocks WHERE ticker = ? AND (market = 'EGX' OR market IS NULL) AND (is_active = 1 OR is_active IS NULL)''', (ticker.upper(),))
                    else:
                        _db_m = 'TADAWUL' if market == 'KSA' else market
                        cur.execute('''SELECT * FROM stocks WHERE ticker = ? AND market = ? AND (is_active = 1 OR is_active IS NULL)''', (ticker.upper(), _db_m))
                    row = cur.fetchone()
                    stock_data = dict(row) if row else None
                
                if not stock_data or float(stock_data.get('current_price', 0) or 0) <= 0:
                    conn.close()
                    return None

                # =====================================================================
                # FIX 3b (أغسطس 2026) — فلتر الأسهم المتوقفة + تحذير البيانات القديمة
                # =====================================================================
                # المستخدم اشتكى إن التوصيات بتعرض أسهم متوقفة عن التداول (suspended)
                # وبيانات قديمة (أسعار الخميس). هنا بنفحص:
                #   (أ) is_suspended: لو السهم متوقف (is_suspended = 1) → اسكِب التحليل
                #       تماماً. العمود ده بيتضاف تلقائياً بواسطة الـ migrator (DEFAULT 0).
                #   (ب) last_update: لو آخر تحديث للسعر أقدم من النهارده → سجّل تحذير
                #       (التحليل بيكمل بس ننبّه إن السعر ممكن يكون قديم). الـ data engine
                #       guard فوق (في _run_full_analysis) بيبذل محاولة refresh قبل التحليل.
                # =====================================================================
                try:
                    _is_susp = int(stock_data.get('is_suspended', 0) or 0)
                except (TypeError, ValueError):
                    _is_susp = 0
                if _is_susp == 1:
                    print(f"[BackgroundAnalyzer] ⏸️ Skipping suspended stock {ticker}")
                    conn.close()
                    return None

                # Stale-price warning (لا يسكب التحليل، بس ينبه لو السعر قديم)
                # 🔥 P14 (أغسطس 2026): استخدم توقيت Cairo بدل naive datetime.now()
                # لو السرفر شغال بـ UTC، _dt.now() بيرجع تاريخ UTC → المقارنة مع
                # last_update (المسجل بتوقيت Cairo) هتكون خاطئة بحوالي ساعتين.
                _last_upd = stock_data.get('last_update') or stock_data.get('last_updated')
                if _last_upd:
                    try:
                        # استخدم توقيت Cairo (نفس اللي بيستخدمه market_scheduler)
                        try:
                            import pytz as _pz
                            _today_str = _dt.now(_pz.timezone('Africa/Cairo')).strftime('%Y-%m-%d')
                        except ImportError:
                            # fallback: UTC+2 (تقريب Cairo شتاء)
                            from datetime import timedelta as _td
                            _today_str = (_dt.utcnow() + _td(hours=2)).strftime('%Y-%m-%d')
                        _last_date = str(_last_upd).split('T')[0].split(' ')[0]
                        if _last_date < _today_str:
                            logger.debug(
                                f"[BackgroundAnalyzer] ⚠️ {ticker} price is stale "
                                f"(last_update={_last_date}, today={_today_str}) — "
                                f"analysis may use outdated price. Data engine should refresh."
                            )
                    except Exception:
                        pass  # تاريخ مش متاح أو مش صالح — مفيش حاجة نعملها

                # =====================================================================
                # DATA-UNIFY-007: توحيد بايبلاين البيانات
                # ---------------------------------------------------------------------
                # قبل: كنا بنجيب history من stock_daily_prices + fallback لـ price_history
                #       بدون أي فلتر للمصادر — ده كان السبب الجذري للـ "split-brain"
                #       بين الشارت التفاعلي (النظيف) ومايسترو التحليلات (الملوّث).
                # الآن: نستخدم load_merged_history() — نفس الدالة اللي بيستخدمها
                #       chart_routes.chart_full_analysis. بتطبّق:
                #       (أ) فلتر egksco (المرجع الرسمي) ضد egx_investment_migration
                #       (ب) تطبيع النسبة (ratio) لو بين 0.5 و 2.0
                #       (ج) _adjust_for_splits لكشف انقسامات الأسهم
                # النتيجة: الـ BackgroundAnalyzer بقرأ نفس بيانات الشارت التفاعلي 100%.
                # =====================================================================
                # PHASE 1 (v3.50.0): مصدر سعر موحد — data.prices.load_price_history
                # ي delegate لـ load_merged_history (egksco/migration normalization) + LRU cache.
                try:
                    from data.prices import load_price_history
                    history = load_price_history(ticker, limit=120)
                except Exception as _lph_err:
                    logger.warning(
                        f"[BackgroundAnalyzer] load_price_history failed for {ticker}: {_lph_err}"
                    )
                    history = []

                # =====================================================================
                # DATA-UNIFY-007 + REALITY-CHECK-023: فلتر الأسهم الميتة
                # ---------------------------------------------------------------------
                # أي سهم turnover يومي < 500K EGP يُسقط من stored_analyses لأنه
                # سيولة ميتة (مثل ACAP, ORDSENT...) — توصياته غير قابلة للتنفيذ.
                # الـ filter بيجيب آخر شمعة (close × volume) ويقرر.
                # لو history فاضي أو آخر شمعة ناقصة → نسقط السهم (آمن).
                #
                # REALITY-CHECK-023 (إضافة): volume < 100,000 → سهم ميت
                # حتى لو turnover أعلى من 500K (لو السهم رخيص جداً)،
                # لو volume أقل من 100K → مفيش سيولة حقيقية → اسقطه.
                # =====================================================================
                MIN_TURNOVER_EGP = 500_000
                MIN_VOLUME_SHARES = 100_000  # REALITY-CHECK-023: فلتر الأسهم الميتة
                last_candle = history[-1] if history else {}
                last_close = float(
                    last_candle.get('close', last_candle.get('close_price', 0)) or 0
                )
                last_volume = float(last_candle.get('volume', 0) or 0)
                # parse_volume يرجع int/float لكن load_merged_history بيرجع volume كـ int أصلاً
                try:
                    from utils.helpers import parse_volume as _parse_vol
                    last_volume = float(_parse_vol(last_volume) or 0)
                except Exception:
                    pass

                # P23-FILTER-HOTFIX: لو volume_today = 0 (بيانات اللحظي مش متحدثة في
                # الإنتاج — مشكلة شائعة)، استخدم avg_volume من آخر 20 يوم كـ fallback.
                # قبل كده: volume=0 → Dead stock filter بيطرد السهم → التوقعات فاضية.
                # الحل: لو last_volume=0، نحسب avg_volume_20d ونستخدمه.
                volume_was_estimated = False
                if last_volume == 0 and len(history) >= 5:
                    recent_vols = []
                    for h in history[-21:-1]:  # آخر 20 يوم قبل اليوم الحالي
                        try:
                            v = float(h.get('volume', 0) or 0)
                            if v > 0:
                                recent_vols.append(v)
                        except Exception:
                            pass
                    if recent_vols:
                        last_volume = sum(recent_vols) / len(recent_vols)
                        volume_was_estimated = True

                turnover_egp = last_close * last_volume

                conn.close()

                # P26-FORCE-SAVE: خفّضنا الحد الأدنى من 10 لـ 5 شموع.
                # قبل كده: أي سهم بياناته < 10 شموع كان بيتطرد → التوقعات فاضية.
                # دلوقتي: 5 شموع كفاية للـ RSI/MA الأساسي، والباقي بيتحسب defensive.
                if len(history) < 5:
                    return None

                # REALITY-CHECK-023: فلتر volume الصارم (أول من السيولة)
                # P23-FILTER-HOTFIX: لو الـ volume اتقدّر (fallback)، نطبّق حد أدنى
                # أقل صرامة (10K بدل 100K) عشان منطردش أسهم بياناتها مش متحدثة.
                effective_min_volume = MIN_VOLUME_SHARES if not volume_was_estimated else (MIN_VOLUME_SHARES // 10)
                # P26-FORCE-SAVE: لا نطرد السهم بسبب انخفاض السيولة.
                # قبل كده: return None → السهم يتطرد → التوقعات فاضية.
                # دلوقتي: نسجّل التحذير بس ونكمّل التحليل.
                if last_volume < effective_min_volume:
                    print(
                        f"[BackgroundAnalyzer] ⚠️ Low volume warning: {ticker} "
                        f"(volume={last_volume:,.0f} < {effective_min_volume:,}"
                        f"{', estimated' if volume_was_estimated else ''}) — kept anyway (P26-FORCE-SAVE)"
                    )

                effective_min_turnover = MIN_TURNOVER_EGP if not volume_was_estimated else (MIN_TURNOVER_EGP // 10)
                # P26-FORCE-SAVE: لا نطرد السهم بسبب انخفاض القيمة السوقية للتداول.
                # قبل كده: return None → السهم يتطرد → التوقعات فاضية.
                # دلوقتي: نسجّل التحذير بس ونكمّل التحليل.
                if turnover_egp < effective_min_turnover:
                    print(
                        f"[BackgroundAnalyzer] ⚠️ Low turnover warning: {ticker} "
                        f"(turnover={turnover_egp:,.0f} EGP < {effective_min_turnover:,}"
                        f"{', estimated' if volume_was_estimated else ''}) — kept anyway (P26-FORCE-SAVE)"
                    )

                # =====================================================================
                # FUNDAMENTAL-CATALYST-022: Blue-Chip Filter (فلتر الأسهم القيادية)
                # ---------------------------------------------------------------------
                # الأسهم اللي مفيهاش بيانات مالية خالص في data_engine.db → تجاهلها.
                # مفيش بيانات = مش هنعرف نحكم على جودة الشركة → التوصية هتبقى غير موثوقة.
                # الـ MasterAnalyzer بعدين هيرفض اللي درجتهم < 40، لكن هنا بنرفض
                # اللي مفيهمش بيانات خالص عشان نوفر CPU ونركز على الأسهم الحقيقية.
                # =====================================================================
                try:
                    from analyzers.fundamental_engine import get_fundamental_engine
                    _fe = get_fundamental_engine()
                    # P26-FORCE-SAVE: لا نطرد السهم بسبب نقص البيانات الأساسية.
                    # قبل كده: return None → السهم يتطرد → التوقعات فاضية.
                    # دلوقتي: نسجّل التحذير ونكمّل — العقل هيحلّل اللي يقدر عليه.
                    if not _fe.has_fundamental_data(ticker):
                        print(
                            f"[BackgroundAnalyzer] ⚠️ No fundamental data: {ticker} — kept anyway (P26-FORCE-SAVE)"
                        )
                except Exception as _bf_err:
                    # لو الـ filter فشل، سيب التحليل يكمّل (آمن — مش بنرفض بسبب خطأ)
                    logger.debug(f"Blue-chip filter error for {ticker}: {_bf_err}")

                # خزّن turnover_egp في result عشان _store_orchestrator_result يكتبه في DB
                # (لتوثيق القرار — يسهّل الـ audit لاحقاً)
                # =====================================================================
                
                # تشغيل MaestroOrchestrator.analyze() — فيه Human Context
                # CL7-UI-SECTORS: مرّر sector_status + sector_role لل orchestrator
                # عشان يطبّق sector_aware_refine_recommendation (المضارب بيرفض
                # laggard في قطاع ميت، المستثمر بيحذر القطاع الميت).
                _cl7_opts = {}
                if _CL7_SECTOR_AVAILABLE and self._sector_heat_map:
                    _cl7_ticker_up = (ticker or '').upper()
                    _cl7_role = self._sector_roles.get(_cl7_ticker_up, 'mid')
                    if _cl7_role != 'mid':
                        _cl7_fund = (_load_stocks_fundamentals_for_persona() or {}).get(_cl7_ticker_up, {}) or {}
                        _cl7_sector = _cl7_fund.get('sector', '')
                        if _cl7_sector and _cl7_sector not in _CL7_SECTOR_EXCLUDE:
                            _cl7_status = _cl7_sector_status(_cl7_sector, self._sector_heat_map) if _cl7_sector_status else 'neutral'
                            if _cl7_status != 'neutral':
                                _cl7_opts['sector_status'] = _cl7_status
                                _cl7_opts['sector_role'] = _cl7_role
                result = self.orchestrator.analyze(ticker, stock_data, history, _cl7_opts)
                
                if not result:
                    return None
                
                # جلب technical_score و quality_score (fundamental_score)
                quality_score = 50.0
                technical_score = 50.0
                # MAESTRO-UNIFY-015: نمرّر history للـ MasterAnalyzer عشان يحسب
                # الـ 8-layer confluence (MACD + Candlestick + Fibonacci) بنفس
                # الـ data اللي الشارت بيستخدمها — لا لزوم لـ load_merged_history
                # تاني (لازم نتجنب الـ redundant DB hit).
                # كمان بنخزّن الـ confluence fields لـ _store_orchestrator_result.
                _confluence_payload = None
                if self.orchestrator.master_analyzer:
                    try:
                        analysis = self.orchestrator.master_analyzer.analyze(
                            ticker, history=history
                        )
                        if analysis:
                            quality_score = getattr(analysis, 'quality_score', 50) or getattr(analysis, 'fundamental_score', 50) or 50
                            technical_score = getattr(analysis, 'technical_score', 50) or 50
                            # MAESTRO-UNIFY-015: capture the 8-layer confluence fields
                            # (macd_score, candlestick_score, fibonacci_score,
                            # candlestick_patterns, fibonacci_levels, confluence_score,
                            # confluence_breakdown, confluence_signal) for storage.
                            _confluence_payload = {
                                'macd_score': float(getattr(analysis, 'macd_score', 0.0) or 0.0),
                                'candlestick_score': float(getattr(analysis, 'candlestick_score', 0.0) or 0.0),
                                'fibonacci_score': float(getattr(analysis, 'fibonacci_score', 0.0) or 0.0),
                                'candlestick_patterns': list(getattr(analysis, 'candlestick_patterns', []) or []),
                                'fibonacci_levels': dict(getattr(analysis, 'fibonacci_levels', {}) or {}),
                                'confluence_score': float(getattr(analysis, 'confluence_score', 0.0) or 0.0),
                                'confluence_breakdown': dict(getattr(analysis, 'confluence_breakdown', {}) or {}),
                                'confluence_signal': str(getattr(analysis, 'confluence_signal', '') or ''),
                            }
                    except Exception as e:
                        logger.warning(f"master_analyzer.analyze failed for {ticker}: {e}")

                # حفظ النتيجة مع Human data
                # Pass `history` down so _store_orchestrator_result can compute
                # an ATR-based dynamic stop_loss via glminvestment_engines.
                # turnover_egp يُخزَّن لتوثيق قرار السيولة (DATA-UNIFY-007).
                # confluence_payload (MAESTRO-UNIFY-015): الـ 8-layer confluence
                # fields من MasterAnalyzer — تُخزَّن في analysis_json.
                # P40-MARKET-ISOLATION: فضّل سوق السهم الفعلي من stock_data على
                # سوق الـ loop. ده ضمان إضافي إن سهم سعودي ما يتحفظش بـ EGX حتى
                # لو الـ loop قاله EGX (مستحيل نظرياً، بس آمن).
                _effective_market = (stock_data.get('market') or market or 'EGX').upper()
                if _effective_market == 'KSA':
                    _effective_market = 'TADAWUL'
                self._store_orchestrator_result(
                    result, _effective_market, history=history,
                    technical_score=technical_score, fundamental_score=quality_score,
                    turnover_egp=turnover_egp,
                    confluence_payload=_confluence_payload,
                    stock_data=stock_data,
                )
                return result
                
            except Exception as e:
                print(f"[BackgroundAnalyzer] Error (Orchestrator) analyzing {ticker}: {e}")
                return None
        
        # === المسار البديل: UnifiedMaestro (بدون Human) ===
        if self.unified_maestro:
            try:
                result = self.unified_maestro.analyze(ticker, market)
                
                if not result:
                    return None
                
                self._store_result(result)
                return result
                
            except Exception as e:
                print(f"[BackgroundAnalyzer] Error (Unified) analyzing {ticker}: {e}")
                return None
        
        return None
    
    def _store_orchestrator_result(self, result, market: str = 'EGX', history: Optional[List[Dict]] = None, technical_score: float = 50.0, fundamental_score: float = 50.0, turnover_egp: Optional[float] = None, confluence_payload: Optional[Dict] = None, stock_data: Optional[Dict] = None):
        """Store MaestroOrchestrator result WITH Human data in database.

        Args:
            result: MaestroResult from the orchestrator.
            market: Market code (EGX, CRYPTO, ...).
            history: Optional OHLCV history list-of-dicts (passed down from
                _analyze_and_store). When provided AND ENABLE_ENGINES_VETO is
                truthy, the legacy fixed -8% stop_loss is augmented with a
                dynamic ATR-based stop_loss from glminvestment_engines.
            turnover_egp: قيمة التداول اليومية بالجنيه (close × volume) للسهم
                — تُخزَّن في stored_analyses.turnover_egp لتوثيق قرار فلتر
                السيولة الصارم (DATA-UNIFY-007).
            confluence_payload: MAESTRO-UNIFY-015 — dict with the 8-layer
                confluence fields (macd_score, candlestick_score,
                fibonacci_score, candlestick_patterns, fibonacci_levels,
                confluence_score, confluence_breakdown, confluence_signal)
                computed by MasterAnalyzer.analyze(history=...). When provided,
                these fields are added to analysis_json so the chart, screener,
                and stored-analysis routes all read the SAME confluence scoring
                the interactive chart displays.
        """
        # 🧠 Expert Quality Gate — افحص التوصية قبل التخزين
        # 🔥 P0-v6 FIX #8 (EXPERT-GATE-BYPASS-REMOVED):
        #    قبل كده، كنا بنـ skip الـ expert gate لو warnings فيها 'شراء' أو
        #    'شراء قوي'. ده كان بيـ bypass الـ VCP detection (اللي موجود جوه
        #    expert_quality_gate) لـ معظم BUYs → المضارب ما بيشوفش VCP أبداً.
        #    المالك عايز VCP يـ catches الأسهم اللي بتعمل +30-100%. فشلنا الـ bypass.
        #    لو في حاجة محتاجة skip، استخدم env var بدل keyword matching.
        _skip_expert_gate = False  # كان: True لو warnings فيها 'شراء'

        if EXPERT_GATE_AVAILABLE and not _skip_expert_gate:
            try:
                rec = getattr(result, 'recommendation', 'hold') or 'hold'
                if rec.lower() in ['buy', 'strong_buy']:
                    verdict = expert_quality_gate.evaluate(
                        ticker=getattr(result, 'ticker', ''),
                        recommendation=rec,
                        entry_price=getattr(result, 'entry_price', 0) or 0,
                        target_price=getattr(result, 'target', None),
                        stop_loss=getattr(result, 'stop_loss', None),
                        confidence=getattr(result, 'confidence', 50) or 50,
                        market=market,
                    )
                    result.confidence = verdict.adjusted_confidence
                    if not verdict.approved:
                        print(f"[BackgroundAnalyzer] 🧠 Expert rejected {result.ticker} {rec}: {verdict.rejection_reason[:80]}")
                        result.recommendation = 'hold'
                        result.recommendation_ar = 'انتظار (رفض الخبير)'
                    if not hasattr(result, 'expert_verdict') or result.expert_verdict is None:
                        result.expert_verdict = verdict
            except Exception as _expert_e:
                print(f"[BackgroundAnalyzer] Expert gate error: {_expert_e}")

        conn = get_predictions_db()
        try:
            # بناء analysis_json مع كل بيانات Human + Unified Persona Engine
            analysis_json = {}
            
            # Unified Persona Engine: gambler + investor + persona_narrative (جديد)
            if getattr(result, 'gambler', None) or getattr(result, 'investor', None) or getattr(result, 'persona_narrative', None):
                analysis_json['narrative'] = result.persona_narrative or {}
                analysis_json['gambler'] = result.gambler or {}
                analysis_json['investor'] = result.investor or {}
                # P26-PERSONA-SEPARATION: R/R الخاص بكل persona (gambler/balanced/conservative)
                # عشان الواجهة تقدر تبدّل الشخصيات وتشوف أرقام مختلفة فوراً.
                analysis_json['persona_rr'] = getattr(result, 'persona_rr', None) or {}
            elif result.human_narrative:
                # Fallback: الـ personas القديمة
                analysis_json['narrative'] = {
                    'line1': result.human_narrative.line1,
                    'line2': result.human_narrative.line2,
                    'line3': result.human_narrative.line3,
                }
                if result.human_personas:
                    analysis_json['personas'] = {
                        'hunter': result.human_personas.hunter,
                        'momentum': result.human_personas.momentum,
                        'value': result.human_personas.value,
                    }
            
            # Human Context
            if result.human_context:
                analysis_json['context'] = {
                    'time': result.human_context.time_context,
                    'sector': result.human_context.sector_context,
                    'market': result.human_context.market_context,
                    'historical': result.human_context.historical_context,
                    'behavioral': result.human_context.behavioral_context,
                }

            # Unified Persona Engine: story_arc — القصة التاريخية للسهم بالعربي
            # (3 أجزاء: حركة السعر + السياق التاريخي + رأي الشخصيتين)
            # آمن 100% — لو فشل، التحليل بيكمل بدون story_arc
            try:
                story = _build_story_arc(
                    ticker=getattr(result, 'ticker', ''),
                    human_context=getattr(result, 'human_context', None),
                    gambler=analysis_json.get('gambler') or {},
                    investor=analysis_json.get('investor') or {},
                )
                if story:
                    analysis_json['story_arc'] = story
            except Exception as _story_err:
                print(f"[BackgroundAnalyzer] story_arc failed for {getattr(result, 'ticker', '?')}: {_story_err}")

            # 🧠 Expert Quality Gate — بيانات الخبير في analysis_json
            if EXPERT_GATE_AVAILABLE and getattr(result, 'expert_verdict', None):
                try:
                    dv = result.expert_verdict
                    analysis_json['expert'] = {
                        'approved': dv.approved,
                        'score': dv.expert_score,
                        'level': dv.expert_level,
                        'adjusted_confidence': dv.adjusted_confidence,
                        'investor_play': dv.investor_play,
                        'gambler_play': dv.gambler_play,
                        'golden_rules': dv.golden_rules_triggered,
                        'tests': [
                            {
                                'name': t.test_name_ar,
                                'passed': t.passed,
                                'reason': t.reason,
                            } for t in dv.tests
                        ],
                    }
                except Exception as _dv_err:
                    print(f"[BackgroundAnalyzer] expert_verdict serialize error: {_dv_err}")

            # ── Phase 2: glminvestment_engines ATR Dynamic Stop ──
            # Replaces the legacy fixed -8% stop_loss (computed by the Maestro
            # orchestrator) with a dynamic ATR-based stop when:
            #   (a) ENABLE_ENGINES_VETO is truthy (runtime toggle),
            #   (b) the engines risk patch imported successfully,
            #   (c) the recommendation is still a BUY-direction signal after
            #       the Expert Quality Gate above (which may have downgraded
            #       it to 'hold'),
            #   (d) we have OHLCV history available.
            # Sanity floor: never accept an ATR stop wider than -15% (the
            # engine's max_stop_pct config also enforces this, but we double-
            # check here for defense-in-depth). On ANY exception we fall back
            # to the existing result.stop_loss unchanged.
            _engines_risk_plan_json = None
            if (_ENGINES_VETO_ENABLED and _ENGINES_RISK_AVAILABLE
                    and history
                    and (result.recommendation or '').lower() in ('buy', 'strong_buy', 't1_buy', 'swing_buy')):
                try:
                    import pandas as _pd_eng
                    _df_ohlcv = _pd_eng.DataFrame(history)
                    _col_map = {
                        'open_price': 'open', 'high_price': 'high',
                        'low_price': 'low', 'close_price': 'close', 'volume': 'volume',
                    }
                    _df_ohlcv = _df_ohlcv.rename(
                        columns={k: v for k, v in _col_map.items() if k in _df_ohlcv.columns}
                    )

                    _entry_price = float(getattr(result, 'entry_price', 0) or 0)
                    if _entry_price <= 0:
                        raise ValueError(f"invalid entry_price={_entry_price}")

                    # Map recommendation → persona. t1_buy is short-term → scalper;
                    # everything else → investor (the more conservative stop).
                    _persona = 'scalper' if (result.recommendation or '').lower() == 't1_buy' else 'investor'

                    # account_size only affects position sizing (shares), not the
                    # stop_loss itself. Use a sensible EGX default of 100k EGP.
                    _account_size = float(os.environ.get('ENGINES_DEFAULT_CAPITAL', '100000'))

                    _trade = create_trade_with_atr(
                        _df_ohlcv, result.ticker, _entry_price,
                        _persona, _account_size,
                    )

                    _atr_stop = float(_trade.get('stop_loss', 0) or 0)
                    _legacy_stop = float(getattr(result, 'stop_loss', 0) or 0)

                    # Sanity floor: reject ATR stops that are invalid, on the wrong
                    # side of entry, or wider than -15% (engine max_stop_pct).
                    _atr_stop_pct = (_entry_price - _atr_stop) / _entry_price if _entry_price > 0 else 0.0
                    if _atr_stop > 0 and _atr_stop < _entry_price and _atr_stop_pct <= 0.15:
                        # Accept the ATR stop. Mutate result.stop_loss so the
                        # INSERT below picks up the new value.
                        result.stop_loss = round(_atr_stop, 4)
                        logger.info(
                            "[Engines] ATR stop %s: %.4f (was %.4f, stop_pct=%.2f%%, persona=%s)",
                            result.ticker, _atr_stop, _legacy_stop,
                            _atr_stop_pct * 100.0, _persona,
                        )
                        # Serialize the take-profit tiers + plan summary for
                        # downstream consumers (e.g. a future take-profit-tier
                        # wiring that calls check_open_position). The non-JSON
                        # _risk_plan object is dropped intentionally.
                        _engines_risk_plan_json = {
                            'stop_loss': round(_atr_stop, 4),
                            'stop_pct': round(_atr_stop_pct, 4),
                            'shares': _trade.get('shares'),
                            'position_size_pct': _trade.get('position_size_pct'),
                            'risk_per_share': _trade.get('risk_per_share'),
                            'risk_reward_ratio': _trade.get('risk_reward_ratio'),
                            'trailing_method': _trade.get('trailing_method'),
                            'persona': _persona,
                            'take_profit_tiers': _trade.get('take_profit_tiers', []),
                            'legacy_stop_loss': round(_legacy_stop, 4) if _legacy_stop else None,
                        }
                    else:
                        logger.warning(
                            "[Engines] ATR stop for %s rejected (out-of-bounds): "
                            "atr_stop=%s entry=%s stop_pct=%.2f%% — keeping legacy stop %s",
                            result.ticker, _atr_stop, _entry_price,
                            _atr_stop_pct * 100.0, _legacy_stop,
                        )
                except Exception as _eng_risk_e:
                    logger.warning(
                        "[Engines] create_trade_with_atr failed for %s: %s "
                        "— falling back to legacy stop_loss",
                        getattr(result, 'ticker', '?'), _eng_risk_e
                    )
                    # Fall through with existing result.stop_loss unchanged.

            if _engines_risk_plan_json is not None:
                analysis_json['engines_risk_plan'] = _engines_risk_plan_json

            # =================================================================
            # TOOLKIT-UNIFY-013: Chart-unified indicators
            # -----------------------------------------------------------------
            # نضيف للـ analysis_json نفس المؤشرات اللي بيحسبها chart_routes.py
            # للشارت التفاعلي (BOS, BB_Squeeze, CMF, RegimeDetector, SMA200,
            # FlowSystemEngine) عشان نضمن إن الـ maestro والـ chart على نفس
            # الصفحة. كل الحسابات defensive — لو history غير كافي، بترجع
            # stub بدل ما تفشل.
            # =================================================================
            try:
                _chart_unified = _maestro_compute_chart_unified_indicators(
                    getattr(result, 'ticker', ''), history or [], self.db_path
                )
                if _chart_unified:
                    analysis_json['chart_unified'] = _chart_unified
                    # Expose individual keys at top-level for backward-compat
                    # consumers (stored-analysis routes, screener, etc).
                    analysis_json['bos_events'] = _chart_unified.get('bos_events', [])
                    analysis_json['bb_squeeze'] = _chart_unified.get('bb_squeeze', {})
                    analysis_json['cmf'] = _chart_unified.get('cmf', 0.0)
                    analysis_json['regime_db'] = _chart_unified.get('regime', {})
                    if _chart_unified.get('sma200') is not None:
                        analysis_json['sma200'] = _chart_unified['sma200']
                    analysis_json['flow_system'] = _chart_unified.get('flow_system', {})
            except Exception as _cu_err:
                logger.warning(
                    "[BackgroundAnalyzer] chart_unified_indicators storage failed for %s: %s",
                    getattr(result, 'ticker', '?'), _cu_err,
                )

            # =================================================================
            # MAESTRO-UNIFY-015: 8-LAYER CONFLUENCE (chart_routes parity)
            # -----------------------------------------------------------------
            # لو الـ confluence_payload موجود (من MasterAnalyzer.analyze(history=...)),
            # نضيف الـ 8-layer confluence fields لـ analysis_json. الـ fields دي
            # هي نفسها اللي chart_full_analysis بيرجعها للشارت التفاعلي:
            #   - macd_score (Layer 6, max 15)
            #   - candlestick_score (Layer 7, max 10)
            #   - fibonacci_score (Layer 8, max 10)
            #   - candlestick_patterns (list of {name, name_ar, signal, strength})
            #   - fibonacci_levels (dict: 0% / 23.6% / 38.2% / 50% / 61.8% / 78.6% / 100%)
            #   - confluence_score (total max ~135)
            #   - confluence_breakdown (per-layer points + details)
            #   - confluence_signal (STRONG_BUY / BUY / HOLD / SELL per new thresholds)
            # النتيجة: الـ stored_analyses والـ cached_analysis بقات تحتوي نفس
            # الـ scoring اللي الشارت بيعرضه — لا split-brain بعد كده.
            # =================================================================
            if confluence_payload and isinstance(confluence_payload, dict):
                try:
                    analysis_json['macd_score'] = confluence_payload.get('macd_score', 0.0)
                    analysis_json['candlestick_score'] = confluence_payload.get('candlestick_score', 0.0)
                    analysis_json['fibonacci_score'] = confluence_payload.get('fibonacci_score', 0.0)
                    analysis_json['candlestick_patterns'] = confluence_payload.get('candlestick_patterns', [])
                    analysis_json['fibonacci_levels'] = confluence_payload.get('fibonacci_levels', {})
                    analysis_json['confluence_score'] = confluence_payload.get('confluence_score', 0.0)
                    analysis_json['confluence_breakdown'] = confluence_payload.get('confluence_breakdown', {})
                    analysis_json['confluence_signal'] = confluence_payload.get('confluence_signal', '')
                    # Persist the 3 new layer sub-scores as a compact sub-dict
                    # so consumers can read them together if needed.
                    analysis_json['confluence_8layer'] = {
                        'macd': {
                            'score': confluence_payload.get('macd_score', 0.0),
                            'max': 15,
                        },
                        'candlestick': {
                            'score': confluence_payload.get('candlestick_score', 0.0),
                            'max': 10,
                            'patterns': confluence_payload.get('candlestick_patterns', []),
                        },
                        'fibonacci': {
                            'score': confluence_payload.get('fibonacci_score', 0.0),
                            'max': 10,
                            'levels': confluence_payload.get('fibonacci_levels', {}),
                        },
                        'total_score': confluence_payload.get('confluence_score', 0.0),
                        'total_max': 135,
                        'signal': confluence_payload.get('confluence_signal', ''),
                        'breakdown': confluence_payload.get('confluence_breakdown', {}),
                    }
                except Exception as _conf_store_err:
                    logger.warning(
                        "[BackgroundAnalyzer] confluence_payload storage failed for %s: %s",
                        getattr(result, 'ticker', '?'), _conf_store_err,
                    )

            # Phases
            if result.phases:
                analysis_json['phases'] = result.phases
            
            # تحديد حجم المكان
            phases = result.phases if result.phases else {}
            regime_phase = phases.get('regime', {})
            volume_phase = phases.get('volume', {})
            timeframe_phase = phases.get('timeframe', {})
            
            regime = regime_phase.get('phase', 'range') if regime_phase else 'range'
            regime_score = regime_phase.get('score', 50) if regime_phase else 50
            tf_aligned = 1 if timeframe_phase.get('aligned', False) else 0
            tf_count = timeframe_phase.get('aligned_count', 1) if timeframe_phase else 1
            vol_ratio = volume_phase.get('volume_ratio', 1.0) if volume_phase else 1.0
            liquidity = volume_phase.get('liquidity_rating', 'NORMAL') if volume_phase else 'NORMAL'

            # P16-PERSONA-DIVERGENCE: حساب فرص البرسونا بشكل مستقل
            # لو السهم فيه زخم → is_gambler_opportunity=1
            # لو أساسياته قوية → is_investor_opportunity=1
            # ممكن يكون الاتنين أو واحد بس أو ولا واحد.
            #
            # C1-PERSONA-OPPORTUNITY (v3.48.0): بنمشي الـ rec + turnover_egp
            # للـ module الجديد اللي بيطبّق:
            #   - فلتر أسهم حية (strict للمضارب، loose للمستثمر)
            #   - quality gate (score≥65, RR≥1.5, turnover≥500k, confidence≥55)
            #   - investor fallback لما pe_ratio فاضي
            _ba_turn = float(turnover_egp) if turnover_egp is not None else None
            _ba_sd = stock_data if isinstance(stock_data, dict) else {}
            try:
                # PERSONA-FLAGS-FIX (v3.57.0 + v3.58.0): same live-stock fallbacks
                # as _build_stored_analysis_row — updated_at=now + stock dict
                # fallbacks for volume/current_price/turnover.
                _ba_now = time.strftime('%Y-%m-%d %H:%M:%S')
                _ba_vol = float(volume_phase.get('current_volume', 0) or 0) if volume_phase else 0.0
                _ba_price = float(getattr(result, 'entry_price', 0) or 0)
                # v3.58.0: fallback to stock_data for volume/current_price
                _ba_sd = stock_data if isinstance(stock_data, dict) else {}
                if _ba_vol <= 0 and _ba_sd:
                    try:
                        from utils.helpers import parse_volume as _pv
                        _sv = _ba_sd.get('volume')
                        _ba_vol = float(_pv(_sv)) if isinstance(_sv, str) else float(_sv or 0)
                    except Exception:
                        try:
                            _ba_vol = float(_ba_sd.get('volume') or 0)
                        except (TypeError, ValueError):
                            _ba_vol = 0.0
                if _ba_price <= 0 and _ba_sd:
                    try:
                        _ba_price = float(_ba_sd.get('current_price') or 0)
                    except (TypeError, ValueError):
                        _ba_price = 0.0
                # v3.58.0: resolve turnover from stock_data if not already set
                _ba_turn = float(turnover_egp) if turnover_egp is not None else None
                if _ba_turn is None and _ba_sd:
                    try:
                        _st = float(_ba_sd.get('turnover_egp') or 0)
                        if _st > 0:
                            _ba_turn = _st
                        else:
                            _st2 = float(_ba_sd.get('value_traded') or 0)
                            if _st2 > 0:
                                _ba_turn = _st2
                    except (TypeError, ValueError):
                        pass
                # v3.59.0: fund-based turnover fallback (same as _build_stored_analysis_row)
                # stock_data ما فيهوش value_traded لو الـ SQL مش بـ يـ SELECTه.
                # fund بيحمّل turnover_egp AND value_traded من stocks.db.
                if _ba_turn is None:
                    try:
                        _ba_fund_map = _load_stocks_fundamentals_for_persona() or {}
                        _ba_fund = _ba_fund_map.get((getattr(result, 'ticker', '') or '').upper(), {}) or {}
                        _ba_f_turn = float(_ba_fund.get('turnover_egp') or 0)
                        if _ba_f_turn > 0:
                            _ba_turn = _ba_f_turn
                        else:
                            _ba_f_vt = float(_ba_fund.get('value_traded') or 0)
                            if _ba_f_vt > 0:
                                _ba_turn = _ba_f_vt
                    except Exception:
                        pass
                # PERSONA-FLAGS-FIX (v3.62.0): COMPUTE turnover from price*volume
                # لو fund.turnover_egp و fund.value_traded كمان فاضوا (زي BONY/
                # AREH في الإنتاج)، نحسب turnover = current_price × volume من
                # fund أو stock_data. ده بـ يخلي quality_gate تلاقي قيمة.
                if _ba_turn is None:
                    try:
                        _ba_cp = 0.0
                        _ba_vol2 = 0.0
                        if _ba_sd:
                            _ba_cp = float(_ba_sd.get('current_price') or 0)
                            _sv2 = _ba_sd.get('volume')
                            if isinstance(_sv2, str):
                                try:
                                    from utils.helpers import parse_volume as _bpv
                                    _ba_vol2 = float(_bpv(_sv2))
                                except Exception:
                                    _ba_vol2 = 0.0
                            else:
                                _ba_vol2 = float(_sv2 or 0)
                        if _ba_cp <= 0 or _ba_vol2 <= 0:
                            try:
                                _ba_fund_map2 = _load_stocks_fundamentals_for_persona() or {}
                                _ba_fund2 = _ba_fund_map2.get((getattr(result, 'ticker', '') or '').upper(), {}) or {}
                                if _ba_cp <= 0:
                                    _ba_cp = float(_ba_fund2.get('current_price') or 0)
                                if _ba_vol2 <= 0:
                                    _fv2 = _ba_fund2.get('volume')
                                    if isinstance(_fv2, str):
                                        try:
                                            from utils.helpers import parse_volume as _bpv2
                                            _ba_vol2 = float(_bpv2(_fv2))
                                        except Exception:
                                            _ba_vol2 = 0.0
                                    else:
                                        _ba_vol2 = float(_fv2 or 0)
                            except Exception:
                                pass
                        if _ba_cp > 0 and _ba_vol2 > 0:
                            _ba_turn = _ba_cp * _ba_vol2
                            print(f"[PERSONA_TURNOVER_COMPUTE] {getattr(result,'ticker','?')}: "
                                  f"turnover_egp computed = current_price({_ba_cp}) × volume({_ba_vol2}) "
                                  f"= {_ba_turn:.2f} (BG path)")
                    except Exception:
                        pass
                persona_flags = _compute_persona_opportunity_flags(
                    getattr(result, 'ticker', ''),
                    vol_ratio,
                    rec={
                        'ticker': getattr(result, 'ticker', ''),
                        'recommendation': getattr(result, 'recommendation', '') or 'hold',
                        'maestro_score': getattr(result, 'maestro_score', 0) or 0,
                        'risk_reward': getattr(result, 'risk_reward', 0) or 0,
                        'confidence': getattr(result, 'confidence', 0) or 0,
                        'updated_at': _ba_now,
                        'volume': _ba_vol,
                        'current_price': _ba_price,
                        'is_suspended': int(_ba_sd.get('is_suspended') or 0),
                    },
                    turnover_egp=_ba_turn,
                )
            except Exception as _persona_e:
                # v3.59.0: full traceback + print (same as _build_stored_analysis_row)
                import traceback as _tb
                logger.exception(
                    "[BackgroundAnalyzer] persona flags computation FAILED for %s: %s",
                    getattr(result, 'ticker', '?'), _persona_e,
                )
                print(f"[PERSONA_ERROR] {getattr(result, 'ticker', '?')}: BG persona flags THREW EXCEPTION → defaulted to 0/0")
                _tb.print_exc()
                persona_flags = {
                    'is_gambler': 0, 'is_investor': 0,
                    'gambler_rank': 0.0, 'investor_rank': 0.0,
                    'pe_ratio': None, 'roe': None, 'change_1d': None,
                    'change_1m': None, 'volatility': None, 'fair_value_upside': None,
                }

            # CL7-UI-SECTORS: حقن القطاع في قرار المضارب (veto laggard-in-dead).
            # لو السهم laggard في قطاع ميت → is_gambler=0 + log [SECTOR_VETO].
            persona_flags = _apply_sector_veto_to_persona_flags(
                persona_flags,
                getattr(result, 'ticker', ''),
                self._sector_heat_map,
                self._sector_roles,
            )

            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO stored_analyses (
                    id, ticker, market, maestro_score, recommendation, recommendation_ar,
                    confidence, entry_price, target_price, stop_loss, risk_reward,
                    regime, regime_score, timeframe_aligned, timeframe_count,
                    volume_ratio, liquidity_rating,
                    analysis_json, analysis_version, analysis_type, turnover_egp, updated_at, created_at,
                    is_gambler_opportunity, is_investor_opportunity,
                    gambler_rank_score, investor_rank_score,
                    pe_ratio, roe, change_1d, change_1m, volatility, fair_value_upside
                ) VALUES (
                    lower(hex(randomblob(16))), ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?,
                    ?, '4.0-persona', 'scheduled', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            ''', (
                result.ticker,
                market,
                result.maestro_score or 0,
                result.recommendation or 'hold',
                result.recommendation_ar or 'احتفاظ',
                result.confidence or 0,
                result.entry_price or 0,
                result.target,
                result.stop_loss,
                result.risk_reward or 0,
                regime,
                regime_score,
                tf_aligned,
                tf_count,
                vol_ratio,
                liquidity,
                json.dumps(analysis_json, default=str, ensure_ascii=False) if analysis_json else None,
                # PERSONA-FLAGS-FIX (v3.60.0): استخدم _ba_turn (المُحلَّل عبر
                # fallback chain: stock → value_traded → fund) بدل turnover_egp
                # المتغير الخارجي اللي ممكن يكون None. قبل الفكس ده، الـ INSERT
                # كان بـ يكتب NULL في عمود turnover_egp رغم إن _ba_turn اتحلّ صح.
                float(_ba_turn) if _ba_turn is not None else None,
                # P16-PERSONA-DIVERGENCE: persona flags + fundamentals
                persona_flags.get('is_gambler', 0),
                persona_flags.get('is_investor', 0),
                persona_flags.get('gambler_rank', 0.0),
                persona_flags.get('investor_rank', 0.0),
                persona_flags.get('pe_ratio'),
                persona_flags.get('roe'),
                persona_flags.get('change_1d'),
                persona_flags.get('change_1m'),
                persona_flags.get('volatility'),
                persona_flags.get('fair_value_upside'),
            ))
            conn.commit()

            # Save to cached_analysis in stocks.db for Next.js and frontend APIs to read instantly
            try:
                
                cached_data = {
                    'ticker': result.ticker,
                    'signal': (result.recommendation or 'hold').upper(),
                    'signal_ar': result.recommendation_ar or 'احتفاظ',
                    'master_score': result.maestro_score or 50,
                    'technical_score': technical_score,
                    'fundamental_score': fundamental_score,
                    'timing_score': timeframe_phase.get('score', 50) if timeframe_phase else 50,
                    'pattern_score': 50,
                    'market_regime_score': regime_score,
                    'liquidity_level': liquidity,
                    'is_tradeable': 1,
                    'entry_price': result.entry_price or 0,
                    'target_price': result.target,
                    'stop_loss': result.stop_loss,
                    'risk_reward': result.risk_reward or 0,
                    'market': market,
                    **analysis_json
                }

                w_conn = sqlite3.connect(self.db_path, timeout=30.0)
                w_cur = w_conn.cursor()
                _ensure_cached_analysis_columns(w_conn)
                w_cur.execute('''
                    CREATE TABLE IF NOT EXISTS cached_analysis (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker TEXT NOT NULL,
                        analysis_date TEXT NOT NULL,
                        analysis_json TEXT NOT NULL,
                        signal TEXT,
                        master_score REAL,
                        technical_score REAL,
                        fundamental_score REAL,
                        timing_score REAL,
                        pattern_score REAL,
                        market_regime_score REAL,
                        liquidity_level TEXT,
                        is_tradeable INTEGER DEFAULT 1,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(ticker, analysis_date)
                    )
                ''')
                w_conn.commit()
                
                query = '''
                    INSERT OR REPLACE INTO cached_analysis 
                    (ticker, analysis_date, analysis_json, signal, master_score, 
                     technical_score, fundamental_score, timing_score, pattern_score, 
                     market_regime_score, liquidity_level, is_tradeable, created_at,
                     target_price, stop_loss, current_price, confidence, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                '''
                
                w_cur.execute(query, (
                    result.ticker.upper(),
                    datetime.now().strftime('%Y-%m-%d'),
                    json.dumps(cached_data, ensure_ascii=False),
                    cached_data.get('signal'),
                    cached_data.get('master_score'),
                    cached_data.get('technical_score'),
                    cached_data.get('fundamental_score'),
                    cached_data.get('timing_score'),
                    cached_data.get('pattern_score'),
                    cached_data.get('market_regime_score'),
                    cached_data.get('liquidity_level'),
                    1 if cached_data.get('is_tradeable', True) else 0,
                    datetime.now().isoformat(),
                    getattr(result, 'target', None) or getattr(result, 'target_price', None) or 0,
                    getattr(result, 'stop_loss', None) or 0,
                    getattr(result, 'entry_price', None) or getattr(result, 'current_price', None) or 0,
                    getattr(result, 'confidence', None) or 0,
                ))
                w_conn.commit()
                w_conn.close()
            except Exception as cache_e:
                print(f"[BackgroundAnalyzer] Error saving to cached_analysis for {result.ticker}: {cache_e}")
            
            # Log BUY signals
            rec = result.recommendation or 'hold'
            if rec.lower() in ['buy', 'strong_buy']:
                has_human = '✅ Human' if (result.human_narrative and result.human_personas) else '⚠️ No Human'
                print(f"[BackgroundAnalyzer] ✓ Saved {result.ticker}: {rec} (score={result.maestro_score:.1f}) {has_human}")
            
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error storing {getattr(result, 'ticker', '?')}: {e}")
        finally:
            conn.close()

        # Unified Persona Engine: تخزين آمن في persona_predictions (gambler + investor)
        # لو أي حاجة فشلت، التحليل بيكمل — مفيش تعطيل.
        if PERSONA_DB_AVAILABLE and (getattr(result, 'gambler', None) or getattr(result, 'investor', None)):
            try:
                safe_store_full_analysis(
                    ticker=result.ticker,
                    market=market,
                    maestro_score=result.maestro_score or 0,
                    recommendation=result.recommendation or 'hold',
                    recommendation_ar=result.recommendation_ar or 'احتفاظ',
                    confidence=result.confidence or 0,
                    entry_price=result.entry_price or 0,
                    target_price=result.target,
                    stop_loss=result.stop_loss,
                    risk_reward=result.risk_reward or 0,
                    regime=regime,
                    regime_score=regime_score,
                    timeframe_aligned=tf_aligned,
                    timeframe_count=tf_count,
                    volume_ratio=vol_ratio,
                    liquidity_rating=liquidity,
                    narrative=result.persona_narrative or {},
                    gambler=result.gambler or {},
                    investor=result.investor or {},
                    context={
                        'time': result.human_context.time_context if result.human_context else {},
                        'sector': result.human_context.sector_context if result.human_context else {},
                        'market': result.human_context.market_context if result.human_context else {},
                        'historical': result.human_context.historical_context if result.human_context else {},
                        'behavioral': result.human_context.behavioral_context if result.human_context else {},
                    },
                )
            except Exception as e:
                # لو فشل التخزين في persona_predictions، التحليل بيكمل عادي
                print(f"[BackgroundAnalyzer] persona_predictions storage failed for {getattr(result, 'ticker', '?')}: {e}")
    
    def _store_result(self, result: UnifiedMaestroResult):
        """Store UnifiedMaestro result (fallback - بدون Human) in database."""
        conn = get_predictions_db()
        try:
            # Convert result to dict
            result_dict = asdict(result)
            
            # Clean up raw_result for JSON
            if 'raw_result' in result_dict:
                del result_dict['raw_result']

            # P16-PERSONA-DIVERGENCE: حساب فرص البرسونا (حتى في fallback path)
            # C1-PERSONA-OPPORTUNITY (v3.48.0): نفس المنطق المُوحّد — rec + turnover
            try:
                # PERSONA-FLAGS-FIX (v3.57.0 + v3.58.0): same live-stock fallbacks
                # (fallback path). v3.58.0: also fallback to stock_data for
                # volume/current_price/turnover.
                _fb_phases = getattr(result, 'phases', None) or {}
                _fb_vp = _fb_phases.get('volume', {}) if isinstance(_fb_phases, dict) else {}
                _fb_now = time.strftime('%Y-%m-%d %H:%M:%S')
                _fb_vol = float(_fb_vp.get('current_volume', 0) or 0) if _fb_vp else 0.0
                _fb_price = float(getattr(result, 'entry_price', 0) or 0)
                _fb_sd = stock_data if isinstance(stock_data, dict) else {}
                if _fb_vol <= 0 and _fb_sd:
                    try:
                        from utils.helpers import parse_volume as _pv
                        _sv = _fb_sd.get('volume')
                        _fb_vol = float(_pv(_sv)) if isinstance(_sv, str) else float(_sv or 0)
                    except Exception:
                        try:
                            _fb_vol = float(_fb_sd.get('volume') or 0)
                        except (TypeError, ValueError):
                            _fb_vol = 0.0
                if _fb_price <= 0 and _fb_sd:
                    try:
                        _fb_price = float(_fb_sd.get('current_price') or 0)
                    except (TypeError, ValueError):
                        _fb_price = 0.0
                _fb_turn = None
                if _fb_sd:
                    try:
                        _st = float(_fb_sd.get('turnover_egp') or 0)
                        if _st > 0:
                            _fb_turn = _st
                        else:
                            _st2 = float(_fb_sd.get('value_traded') or 0)
                            if _st2 > 0:
                                _fb_turn = _st2
                    except (TypeError, ValueError):
                        pass
                # v3.59.0: fund-based turnover fallback (same as _build_stored_analysis_row)
                if _fb_turn is None:
                    try:
                        _fb_fund_map = _load_stocks_fundamentals_for_persona() or {}
                        _fb_fund = _fb_fund_map.get((getattr(result, 'ticker', '') or '').upper(), {}) or {}
                        _fb_f_turn = float(_fb_fund.get('turnover_egp') or 0)
                        if _fb_f_turn > 0:
                            _fb_turn = _fb_f_turn
                        else:
                            _fb_f_vt = float(_fb_fund.get('value_traded') or 0)
                            if _fb_f_vt > 0:
                                _fb_turn = _fb_f_vt
                    except Exception:
                        pass
                persona_flags = _compute_persona_opportunity_flags(
                    getattr(result, 'ticker', ''),
                    getattr(result, 'volume_ratio', 0.0) or 0.0,
                    rec={
                        'ticker': getattr(result, 'ticker', ''),
                        'recommendation': getattr(result, 'signal', '') or 'hold',
                        'maestro_score': getattr(result, 'score', 0) or 0,
                        'risk_reward': getattr(result, 'risk_reward', 0) or 0,
                        'confidence': getattr(result, 'confidence', 0) or 0,
                        'updated_at': _fb_now,
                        'volume': _fb_vol,
                        'current_price': _fb_price,
                        'is_suspended': int(_fb_sd.get('is_suspended') or 0),
                    },
                    turnover_egp=_fb_turn,
                )
            except Exception as _fb_pe:
                # v3.59.0: full traceback + print (same as _build_stored_analysis_row)
                import traceback as _tb
                logger.exception(
                    "[BackgroundAnalyzer] FB persona flags FAILED for %s: %s",
                    getattr(result, 'ticker', '?'), _fb_pe,
                )
                print(f"[PERSONA_ERROR] {getattr(result, 'ticker', '?')}: FB persona flags THREW EXCEPTION → defaulted to 0/0")
                _tb.print_exc()
                persona_flags = {
                    'is_gambler': 0, 'is_investor': 0,
                    'gambler_rank': 0.0, 'investor_rank': 0.0,
                    'pe_ratio': None, 'roe': None, 'change_1d': None,
                    'change_1m': None, 'volatility': None, 'fair_value_upside': None,
                }

            # CL7-UI-SECTORS: حقن القطاع في قرار المضارب (veto laggard-in-dead).
            persona_flags = _apply_sector_veto_to_persona_flags(
                persona_flags,
                getattr(result, 'ticker', ''),
                self._sector_heat_map,
                self._sector_roles,
            )

            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO stored_analyses (
                    id, ticker, market, maestro_score, recommendation, recommendation_ar,
                    confidence, entry_price, target_price, stop_loss, risk_reward,
                    regime, regime_score, timeframe_aligned, timeframe_count,
                    analysis_json, analysis_type, updated_at, created_at,
                    is_gambler_opportunity, is_investor_opportunity,
                    gambler_rank_score, investor_rank_score,
                    pe_ratio, roe, change_1d, change_1m, volatility, fair_value_upside
                ) VALUES (
                    lower(hex(randomblob(16))), ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, 'scheduled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            ''', (
                result.ticker,
                result.market,
                result.score,
                result.signal.lower(),
                result.signal_ar,
                result.confidence,
                result.current_price,
                result.target,
                result.stop_loss,
                result.risk_reward,
                result.market_regime,
                50,  # regime_score placeholder
                1 if result.score >= 60 else 0,
                1,
                json.dumps(result_dict, default=str),
                # P16-PERSONA-DIVERGENCE: persona flags
                persona_flags.get('is_gambler', 0),
                persona_flags.get('is_investor', 0),
                persona_flags.get('gambler_rank', 0.0),
                persona_flags.get('investor_rank', 0.0),
                persona_flags.get('pe_ratio'),
                persona_flags.get('roe'),
                persona_flags.get('change_1d'),
                persona_flags.get('change_1m'),
                persona_flags.get('volatility'),
                persona_flags.get('fair_value_upside'),
            ))
            conn.commit()

            # Save to cached_analysis in stocks.db for Next.js and frontend APIs to read instantly
            try:
                
                cached_data = {
                    'ticker': result.ticker,
                    'signal': result.signal.upper(),
                    'signal_ar': result.signal_ar,
                    'master_score': result.score,
                    'technical_score': result.technical_score if hasattr(result, 'technical_score') else 50,
                    'fundamental_score': result.fundamental_score if hasattr(result, 'fundamental_score') else 50,
                    'timing_score': 50,
                    'pattern_score': 50,
                    'market_regime_score': 50,
                    'liquidity_level': 'NORMAL',
                    'is_tradeable': 1,
                    'entry_price': result.current_price,
                    'target_price': result.target,
                    'stop_loss': result.stop_loss,
                    'risk_reward': result.risk_reward,
                    'market': result.market,
                    **result_dict
                }

                w_conn = sqlite3.connect(self.db_path, timeout=30.0)
                w_cur = w_conn.cursor()
                _ensure_cached_analysis_columns(w_conn)
                w_cur.execute('''
                    CREATE TABLE IF NOT EXISTS cached_analysis (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker TEXT NOT NULL,
                        analysis_date TEXT NOT NULL,
                        analysis_json TEXT NOT NULL,
                        signal TEXT,
                        master_score REAL,
                        technical_score REAL,
                        fundamental_score REAL,
                        timing_score REAL,
                        pattern_score REAL,
                        market_regime_score REAL,
                        liquidity_level TEXT,
                        is_tradeable INTEGER DEFAULT 1,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(ticker, analysis_date)
                    )
                ''')
                w_conn.commit()
                
                query = '''
                    INSERT OR REPLACE INTO cached_analysis 
                    (ticker, analysis_date, analysis_json, signal, master_score, 
                     technical_score, fundamental_score, timing_score, pattern_score, 
                     market_regime_score, liquidity_level, is_tradeable, created_at,
                     target_price, stop_loss, current_price, confidence, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                '''
                
                w_cur.execute(query, (
                    result.ticker.upper(),
                    datetime.now().strftime('%Y-%m-%d'),
                    json.dumps(cached_data, ensure_ascii=False),
                    cached_data.get('signal'),
                    cached_data.get('master_score'),
                    cached_data.get('technical_score'),
                    cached_data.get('fundamental_score'),
                    cached_data.get('timing_score'),
                    cached_data.get('pattern_score'),
                    cached_data.get('market_regime_score'),
                    cached_data.get('liquidity_level'),
                    1 if cached_data.get('is_tradeable', True) else 0,
                    datetime.now().isoformat(),
                    getattr(result, 'target', None) or getattr(result, 'target_price', None) or 0,
                    getattr(result, 'stop_loss', None) or 0,
                    getattr(result, 'entry_price', None) or getattr(result, 'current_price', None) or 0,
                    getattr(result, 'confidence', None) or 0,
                ))
                w_conn.commit()
                w_conn.close()
            except Exception as cache_e:
                print(f"[BackgroundAnalyzer] Error saving to cached_analysis for {result.ticker}: {cache_e}")
            
            # Log successful saves for BUY signals
            if result.signal.upper() in ['BUY', 'STRONG_BUY']:
                print(f"[BackgroundAnalyzer] ✓ Saved {result.ticker}: {result.signal} (score={result.score:.1f})")
            
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error storing {result.ticker}: {e}")
        finally:
            conn.close()
    
    def _get_market_stocks(self, market: str, limit: int = 50) -> List[Dict]:
        """Get the TOP-LIQUIDITY active stocks for a market (default 50).

        Phase 8 — Persona Curation (الجودة بدل الكمية):
            قبل Phase 8: كنا بـ نسحب حتى 500 سهم ونشغّل المايسترو عليهم كلهم،
            وده بـ ياخد وقت طويل ويعبي الداتابيز بتوصيات HOLD. دلوقتي بنسحب
            أعلى 50 سهم سيولة فقط (`ORDER BY turnover_egp DESC LIMIT 50`).
            المايسترو بـ يوزّعهم على الشخصيات: المضارب يشوف الزخم فيهم،
            والمستثمر يشوف الأساسيات. التوصيات بقت "بريميوم" وسريعة، والواجهة
            بتفتح في ثانية. EGX بيتحرك قطاعياً، وأعلى 50 سيولة فيهم كل القادة.

        FIX 2 (أغسطس 2026 — resilient schema handling): if the `is_active` column
        is missing on a legacy DB (the exact crash that hung production), the
        first query fails with "no such column: is_active". Previously this
        returned an empty list → "0 stocks analyzed" → empty recommendations.
        Now we detect the column-missing error and RETRY without the is_active
        filter, so analysis still runs on legacy DBs that haven't been healed
        by the migrator yet. This is defense-in-depth — the migrator's
        _ensure_columns (Task 12) heals is_active on boot, but this guarantees
        the analyzer never silently produces zero results due to schema drift.
        """
        stocks = []

        # Bound the query so we never pull the whole market table into memory.
        # Phase 8: 50 سهم سيولة كافيين للـ persona curation (الجودة بدل الكمية).
        # limit اللي بييجي من caller (manual trigger) ممكن يرفع السقف لو محتاج.
        safe_limit = max(1, int(limit)) if limit is not None else 50

        # Build the base SELECT + market filter (shared by all branches)
        # turnover_egp ضفناه للـ SELECT عشان الـ ORDER BY + عشان _analyze_and_store
        # يلاقيه جاهز في stock_data (موثّق قرار السيولة).
        _base_select = (
            "SELECT ticker, name, name_ar, current_price, volume, "
            "turnover_egp, market, sector FROM stocks"
        )

        def _query(with_active_filter: bool):
            """Execute the market query, optionally filtering by is_active."""
            conn = get_stocks_db()
            try:
                cursor = conn.cursor()
                if market == 'EGX':
                    sql = _base_select + " WHERE (market = 'EGX' OR market IS NULL) AND current_price > 0"
                    if with_active_filter:
                        sql += " AND (is_active = 1 OR is_active IS NULL)"
                    sql += " ORDER BY turnover_egp DESC LIMIT ?"
                    cursor.execute(sql, (safe_limit,))
                elif market == 'CRYPTO':
                    sql = _base_select + " WHERE market = 'CRYPTO' AND current_price > 0"
                    if with_active_filter:
                        sql += " AND (is_active = 1 OR is_active IS NULL)"
                    sql += " ORDER BY turnover_egp DESC LIMIT ?"
                    cursor.execute(sql, (safe_limit,))
                else:
                    sql = _base_select + " WHERE market = ? AND current_price > 0"
                    if with_active_filter:
                        sql += " AND (is_active = 1 OR is_active IS NULL)"
                    sql += " ORDER BY turnover_egp DESC LIMIT ?"
                    cursor.execute(sql, (market, safe_limit))
                return [dict(row) for row in cursor.fetchall()]
            finally:
                conn.close()

        try:
            # First attempt: with is_active filter (the correct, fast path)
            stocks = _query(with_active_filter=True)
        except Exception as e:
            err_msg = str(e)
            # Detect column-missing errors and retry without the filter
            if 'no such column' in err_msg and 'is_active' in err_msg:
                print(f"[BackgroundAnalyzer] ⚠️ is_active column missing for {market} — retrying WITHOUT active filter (legacy DB). Fix: migrator will heal on next boot.")
                try:
                    stocks = _query(with_active_filter=False)
                    print(f"[BackgroundAnalyzer] ✓ Retry succeeded — {len(stocks)} stocks found for {market} (active filter skipped)")
                except Exception as e2:
                    print(f"[BackgroundAnalyzer] Error getting stocks for {market} (retry also failed): {e2}")
            else:
                print(f"[BackgroundAnalyzer] Error getting stocks for {market}: {e}")

        # ── MARKET-ISOLATION (Axis B): فلترة الأسهم اللي مش من السوق المطلوب ──
        # stocks.db ممكن يكون فيه market field غلط (أسهم سعودية كأنها EGX).
        # بنستخدم resolve_market() اللي بيرجع للـ data_engine.db كمرجع رسمي
        # عشان نتأكد إن كل سهم راجع من الـ query ده فعلاً من السوق المطلوب.
        # ده بيمنع ظهور أسهم سعودية (زي 9610) في توصيات EGX.
        if stocks and market:
            filtered = []
            for s in stocks:
                _ticker = s.get('ticker', '')
                _resolved = resolve_market(_ticker, fallback_market=s.get('market', 'EGX'))
                # للـ EGX: نقبل EGX أو NULL (الأسهم القديمة اللي مفيهاش market)
                if market.upper() == 'EGX':
                    if _resolved in ('EGX',) or not s.get('market'):
                        s['market'] = 'EGX'
                        filtered.append(s)
                else:
                    # لأي سوق تاني: لازم يتطابق بالظبط
                    if _resolved == market.upper():
                        s['market'] = _resolved
                        filtered.append(s)
            if len(filtered) != len(stocks):
                print(f"[MarketIsolation] {market}: filtered {len(stocks)}→{len(filtered)} stocks (removed {len(stocks)-len(filtered)} misclassified)")
            stocks = filtered

        return stocks

    def _get_changed_stocks(self, minutes: int = 5) -> List[Dict]:
        """Get stocks that changed in the last X minutes."""
        stocks = []

        try:
            conn = get_stocks_db()
            cursor = conn.cursor()

            # Get stocks with recent changes
            cursor.execute('''
                SELECT ticker, market
                FROM stocks
                WHERE updated_at >= datetime('now', ?)
                AND current_price > 0
            ''', (f'-{minutes} minutes',))

            stocks = [dict(row) for row in cursor.fetchall()]
            conn.close()

        except Exception as e:
            print(f"[BackgroundAnalyzer] Error getting changed stocks: {e}")

        # ── MARKET-ISOLATION (Axis B): صحح الـ market field لكل سهم ──
        # قبل ما نرجّع القائمة، نتأكد إن الـ market field صحيح باستخدام
        # data_engine.db كمرجع. ده بيمنع تحليل سهم سعودي كأنه EGX.
        if stocks:
            for s in stocks:
                _ticker = s.get('ticker', '')
                s['market'] = resolve_market(_ticker, fallback_market=s.get('market', 'EGX'))

        return stocks
    
    def _is_data_stale(self) -> bool:
        """
        P0-KILLSWITCH-050 (v2 — يوليو 2026): Stale Data Veto — بطل تحلل في داتا قديمة.

        التعريفات:
          - السهم "طازج" لو آخر تحديث له خلال آخر `STALE_DATA_HOURS` ساعة (default=24h).
          - السهم "قديم" لو آخر تحديث أقدم من كده.

        المرجعية (Documentation/HOW_WE_ANALYZE_AND_PREDICT.md §17.3):
          - لو `last_update` في data_engine.db أقدم من 24 ساعة → رفض التحليل.

        Returns:
          True  → الداتا قديمة → العقل يبطل يفكر (skip).
          False → الداتا طازجة (أو الفحص فشل دفاعياً) → يكم التحليل.
        """
        try:
            import sqlite3 as _sql
            from datetime import datetime as _dt
            from pathlib import Path as _Path

            # عتبة قابلة للضبط البيئي — default 24h حسب الـ Documentation
            try:
                _stale_hours = float(os.environ.get('STALE_DATA_HOURS', '24'))
            except (TypeError, ValueError):
                _stale_hours = 24.0
            _stale_seconds = _stale_hours * 3600.0

            _root = _Path(__file__).resolve().parent.parent.parent
            _stocks_db = str(_root / 'db' / 'stocks.db')
            _ph_db = str(_root / 'db' / 'price_history.db')

            now = _dt.now()
            reasons: list = []

            def _age_seconds(last_str: str) -> float | None:
                """حول نص تاريخ لفرق ثوانٍ من الآن. يرجّع None لو النص غير مفهوم."""
                if not last_str:
                    return None
                s = str(last_str).strip()
                # جرّب صيغ شائعة
                candidates = []
                # iso with T
                if 'T' in s:
                    candidates.append(s.split('.')[0].replace('T', ' '))
                candidates.append(s.split('.')[0])
                candidates.append(s.split(' ')[0])
                for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
                    for cand in candidates:
                        try:
                            return (now - _dt.strptime(cand, fmt)).total_seconds()
                        except ValueError:
                            continue
                return None

            # فحص stocks.db — last_update (طازج؟) — المصدر الأساسي للأسعار اللحظية
            stocks_db_stale = False
            try:
                conn = _sql.connect(_stocks_db)
                cur = conn.cursor()
                cur.execute("SELECT MAX(last_update) FROM stocks WHERE last_update IS NOT NULL")
                row = cur.fetchone()
                conn.close()
                if row and row[0]:
                    age = _age_seconds(str(row[0]))
                    if age is not None:
                        if age > _stale_seconds:
                            stocks_db_stale = True
                            reasons.append(
                                f"stocks.db:last_update={row[0]} (age={age/3600:.1f}h > {_stale_hours:.0f}h)"
                            )
            except Exception as _se:
                logger.debug(f"[StaleVeto] stocks.db check skipped: {_se}")

            # فحص price_history.db — MAX(date) (طازج؟) — مصدر تاريخي (secondary)
            # SMART-VETO (يوليو 2026): price_history.db بيتحدث من historical_fetcher
            # ببطء (يومي/أسبوعي)، فلازم نكون متسامحين معاه. لو stocks.db طازج
            # (الأسعار اللحظية)، نتجاهل price_history.db حتى لو قديم شوية.
            # بس لو stocks.db قديم برضه → نضيف price_history.db للسباب.
            try:
                conn = _sql.connect(_ph_db)
                cur = conn.cursor()
                _table = 'price_history'
                _col = 'date'
                try:
                    cur.execute(f"SELECT MAX({_col}) FROM {_table}")
                except _sql.OperationalError:
                    # fallback لـ stock_daily_prices
                    try:
                        cur.execute("SELECT MAX(price_date) FROM stock_daily_prices")
                    except _sql.OperationalError:
                        cur.execute("SELECT MAX(date) FROM stock_daily_prices")
                row = cur.fetchone()
                conn.close()
                if row and row[0]:
                    age = _age_seconds(str(row[0]))
                    # عتبة أوسع لـ price_history.db: 7 أيام بدل 24 ساعة
                    _ph_stale_seconds = 7 * 24 * 3600.0  # 7 days
                    if age is not None and age > _ph_stale_seconds and stocks_db_stale:
                        reasons.append(
                            f"price_history.db:MAX(date)={row[0]} (age={age/3600:.1f}h > 168h) [secondary]"
                        )
            except Exception as _pe:
                logger.debug(f"[StaleVeto] price_history.db check skipped: {_pe}")

            if reasons:
                # خزّن السبب عشان الـ admin يقدر يشوفه
                self._last_stale_reason = "; ".join(reasons)
                logger.error(f"🚨 STALE DATA VETO: {self._last_stale_reason}")
                return True

            self._last_stale_reason = None
            return False
        except Exception as _e:
            logger.warning(f"[StaleVeto] check failed (defensive fallback): {_e}")
            return False  # لو الفحص فشل، سيب التحليل يكم

    def _update_status(self, **kwargs):
        """Update engine status in database."""
        conn = get_predictions_db()
        try:
            cursor = conn.cursor()
            
            # Build update query
            updates = []
            params = []
            
            for key, value in kwargs.items():
                if key == 'is_running':
                    updates.append('is_running = ?')
                    params.append(1 if value else 0)
                elif key == 'error':
                    updates.append('last_error = ?')
                    updates.append('error_count = error_count + 1')
                    params.append(str(value))
                else:
                    updates.append(f'{key} = ?')
                    params.append(value)
            
            if updates:
                params.append('main')
                cursor.execute(f'''
                    UPDATE analysis_engine_status 
                    SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', params)
                conn.commit()
                
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error updating status: {e}")
        finally:
            conn.close()
    
    def get_status(self) -> Dict:
        """Get current engine status."""
        try:
            conn = get_predictions_db()
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM analysis_engine_status WHERE id = ?', ('main',))
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'isRunning': bool(row['is_running']),
                    'currentMarket': row['current_market'],
                    'currentTicker': row['current_ticker'],
                    'totalAnalyzed': row['total_analyzed'],
                    'lastFullAnalysis': row['last_full_analysis'],
                    'lastRun': row['last_run'],
                    'nextScheduledRun': row['next_scheduled_run'],
                    'errorCount': row['error_count'],
                    'lastError': row['last_error']
                }
        except Exception as e:
            print(f"[BackgroundAnalyzer] Error getting status: {e}")
        
        return {
            'isRunning': self.running,
            'lastFullAnalysis': str(self.last_full_analysis) if self.last_full_analysis else None
        }


# ============================================================================
# SINGLETON INSTANCE
# ============================================================================

_analyzer_instance = None

def get_background_analyzer() -> BackgroundAnalyzer:
    """Get or create the singleton analyzer instance."""
    global _analyzer_instance
    if _analyzer_instance is None:
        _analyzer_instance = BackgroundAnalyzer()
    return _analyzer_instance


def start_background_analyzer():
    """Start the background analyzer."""
    analyzer = get_background_analyzer()
    analyzer.start()
    return analyzer


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("BACKGROUND ANALYZER ENGINE")
    print("=" * 60)
    
    analyzer = BackgroundAnalyzer()
    analyzer.start()
    
    try:
        while True:
            time.sleep(60)
            status = analyzer.get_status()
            print(f"[Status] Running: {status['isRunning']}, Analyzed: {status.get('totalAnalyzed', 0)}")
    except KeyboardInterrupt:
        analyzer.stop()
        print("\nStopped.")
